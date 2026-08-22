// produceChangedTestInventoryV2() -- TP approved v1.15 §11b.10c, §6 ordered classification,
// §11b.9c envelope, on shared approved v1.15 §9.
//
// SCOPE. This produces the in-memory ChangedTestInventoryV2 and nothing else. It does not lift the
// unsupported-populated-inventory gate, does not make the product entry point accept a populated
// inventory, does not satisfy AC118, AC136, AC137 or AC138, and does not mean Phase 2 is ready. The
// product path goes on refusing every v2 envelope, including one this function just produced --
// both facts hold at once, and AC173 (j) requires them to.
//
// Nothing here writes: not the store, not the explicit config, not the registry, not
// .ctide/output/**. The envelope is a return value.
import {
  canonicalJson, compareCodePoint, indexStore, statusOf, applicable, mechanicallyApplicable,
  checkSourceIntegrity,
} from "./provenance-store.mjs";
import { computeInventoryV2Digest, V2_INVENTORY_KEYS } from "./changed-test-inventory.mjs";
import { buildDiscoveryAnalysisPreimage } from "./adapter-discovery-preimage.mjs";
import { matchBaseHeadDeclarations } from "./base-head-declaration-matcher.mjs";
import { runWithGovernanceContext } from "./governance-seed-preimage.mjs";
import { checkProducerRequest, ProducerRequestError } from "./producer-request.mjs";

export class InventoryProducerError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = "InventoryProducerError";
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}
const fail = (code, message, detail) => new InventoryProducerError(code, message, detail);

const INVENTORY_VERSION = 2;
const CONTENT_CHANGE = "content-change";
const GOVERNANCE_AFFECTED = "governance-affected";

// --- signals (§6: each computed once per matched pair, and no others may be added) ---------------

const bodyChangedOf = (pair) => pair.base.bodyDigest !== pair.head.bodyDigest;
const tagChangedOf = (pair) => canonicalJson(pair.base.tag) !== canonicalJson(pair.head.tag);

// The reverse closure, and its whole definition: the HEAD-side tag is a clause binding whose
// clauseRef is in the seed. "Currently bound" means the post-state binding, which is why base plays
// no part. { expl: true }, null and a test with no head declaration are all false -- and membership
// is decided on the canonical clauseRef alone, never on a dpRef, a path, a bodyDigest or how similar
// two tag strings look.
function governanceHitOf(pair, seed) {
  const tag = pair.head === null ? null : pair.head.tag;
  if (tag === null || typeof tag !== "object" || typeof tag.clauseRef !== "string") return false;
  return seed.includes(tag.clauseRef);
}

// --- binding semantic validation (§11b.10c v1.16) --------------------------------------------------
//
// Nothing here re-defines a judgement. shared approved v1.15 §9's two-phase table and this document's
// §7 own the rules; this decides only WHO validates, against WHICH snapshot, and under WHICH T0.

const clauseOf = (store, ref) => (store.clauses || []).find((c) => c.id === ref);
const sourceOf = (store, ref) => (store.sources || []).find((x) => x.sourceId === ref);

// A pre-state is a historical fact. shared §9's preChangeBinding row asks only that the clause and
// its Source resolve in B and that Check A holds -- NOT active, NOT mechanicallyApplicable, NOT
// Check B, NOT expiry. Charging current effectivity here would block the repair the model exists to
// encourage; current effectivity decides governanceHit and nothing else.
function assertPreBinding(base, tag, where) {
  if (tag === null || typeof tag !== "object" || typeof tag.clauseRef !== "string") return; // null / EXPL
  const clause = clauseOf(base, tag.clauseRef);
  if (clause === undefined) {
    throw fail("E_BASE_BINDING_UNRESOLVED",
      `${where}: the base-side binding names clause ${tag.clauseRef}, which does not resolve in the base-tree store`,
      { side: "base", clauseRef: tag.clauseRef });
  }
  const source = sourceOf(base, clause.sourceRef);
  if (source === undefined) {
    throw fail("E_BASE_BINDING_UNRESOLVED",
      `${where}: base clause ${clause.id} names source ${JSON.stringify(clause.sourceRef)}, which does not resolve in the base-tree store`,
      { side: "base", clauseRef: clause.id });
  }
  const integrity = checkSourceIntegrity(source);
  if (!integrity.ok) {
    throw fail("E_BASE_BINDING_INTEGRITY",
      `${where}: base source ${source.sourceId} fails Check A (${integrity.reason})`,
      { side: "base", source: source.sourceId, reason: integrity.reason });
  }
}

// The post-state is charged current effectivity in full: shared §9's postChangeBinding row, against
// the SAME parsed G1 and the SAME T0. applicable() already carries active, mechanicallyApplicable,
// Check A and the exception chain including expiry, so it is called rather than re-implemented.
function assertPostBinding(index, current, taskState, tag, where, t0) {
  if (tag === null || typeof tag !== "object" || typeof tag.clauseRef !== "string") return; // EXPL
  const clause = clauseOf(current, tag.clauseRef);
  if (clause === undefined) {
    throw fail("E_HEAD_BINDING_UNRESOLVED",
      `${where}: the head-side binding names clause ${tag.clauseRef}, which does not resolve in the current store`,
      { side: "head", clauseRef: tag.clauseRef });
  }
  if (statusOf(index, clause.id) !== "active") {
    throw fail("E_HEAD_BINDING_INACTIVE",
      `${where}: head-side clause ${clause.id} is not active in the current store`,
      { side: "head", clauseRef: clause.id });
  }
  const mech = mechanicallyApplicable(index, clause.id, t0);
  if (!mech.ok) {
    throw fail("E_HEAD_BINDING_NOT_APPLICABLE",
      `${where}: head-side clause ${clause.id} is not mechanically applicable (${mech.reason})`,
      { side: "head", clauseRef: clause.id, reason: mech.reason });
  }
  assertReqAtDp(index, current, taskState, clause, tag, where, t0);
}

const isExceptionBacked = (current, clause) => {
  const source = sourceOf(current, clause.sourceRef);
  return source !== undefined && source.contentKind === "exception-grant";
};

// §7, all five conditions, never a subset. The qualified form applies to an exception-backed REQ
// only; the bare form infers a DP within currentTaskDpIds and then checks the same five.
function assertReqAtDp(index, current, taskState, clause, tag, where, t0) {
  const qualified = typeof tag.dpRef === "string";
  const backed = clause.id.startsWith("REQ-") && isExceptionBacked(current, clause);
  if (qualified && !backed) {
    throw fail("E_DP_QUALIFIER_UNSUPPORTED",
      `${where}: ${clause.id} is not exception-backed, so it carries no DP qualifier; attaching one asserts a scope promise that does not exist`,
      { clauseRef: clause.id, dpRef: tag.dpRef });
  }
  if (!backed) return;

  const scope = taskState.currentTaskDpIds || [];
  let dpId = tag.dpRef;
  if (!qualified) {
    // Bare form: infer ONLY inside the current task. A historical DP must not manufacture a
    // candidate, so zero and many are both fail-closed and the message says to qualify.
    const candidates = scope.filter((id) => {
      const dp = index.dps.get(id);
      return dp !== undefined && dp.resolvedBy === clause.id;
    });
    if (candidates.length !== 1) {
      throw fail("E_DP_INFERENCE",
        `${where}: the bare form of ${clause.id} matched ${candidates.length} DPs inside currentTaskDpIds; use the qualified form @DP-y`,
        { clauseRef: clause.id, candidates: candidates.length });
    }
    [dpId] = candidates;
  }

  const complain = (reason, detail) => {
    throw fail("E_REQ_AT_DP", `${where}: ${clause.id}@${dpId} fails §7 -- ${reason}`, { clauseRef: clause.id, dpRef: dpId, ...detail });
  };
  if (!scope.includes(dpId)) complain("the DP is not in this task's currentTaskDpIds");
  const dp = index.dps.get(dpId);
  if (dp === undefined) complain("the DP does not resolve in the current store");
  if (dp.status !== "resolved") complain(`the DP status is ${JSON.stringify(dp.status)}, not "resolved"`);
  if (dp.resolvedBy !== clause.id) complain(`the DP resolves to ${JSON.stringify(dp.resolvedBy)}`);
  if (!applicable(index, clause.id, dp, t0).ok) complain("applicable(REQ, DP) does not hold");
  const ruling = dp.scopeRulingRef;
  const record = ruling && typeof ruling.ref === "string" ? index.records.get(ruling.ref) : undefined;
  if (record === undefined || record.subjectRef !== dpId) {
    complain("the DP's scopeRulingRef does not name that DP as its subject");
  }
}

// --- §6's single ordered precedence, first match wins --------------------------------------------

function classify(pair, seed) {
  if (pair.relation === "added") return "added";
  if (pair.relation === "deleted") return "deleted";
  // A move wins outright: body change, retag and a governance hit all lose to it.
  if (pair.relation === "moved") return "moved";
  if (bodyChangedOf(pair)) return "modified";          // neither a retag nor governance overrides this
  if (tagChangedOf(pair)) return "retagged";           // nor does governance override this
  if (governanceHitOf(pair, seed)) return GOVERNANCE_AFFECTED; // row 6, the ONLY row it can reach
  return "unchanged";                                   // row 7 -- omitted, never a placeholder
}

// --- exact side projection (§11b.10c: the six statuses never mix their sides) --------------------

const testRefOf = (locator) => ({
  path: locator.path, adapterId: locator.adapterId, structuralId: locator.structuralId,
});

function project(pair, status) {
  const reason = status === GOVERNANCE_AFFECTED ? GOVERNANCE_AFFECTED : CONTENT_CHANGE;

  if (status === "added") {
    // Everything from head. baseBodyDigest is ABSENT, not null: the key set is exact, and an
    // explicit null would be a claim about a base side that does not exist.
    return {
      testRef: testRefOf(pair.head), status, reason,
      tagBefore: null, tagAfter: pair.head.tag,
      framework: pair.head.framework, implementationIdentity: pair.head.implementationIdentity,
      headBodyDigest: pair.head.bodyDigest,
    };
  }
  if (status === "deleted") {
    // Everything from base, symmetrically; headBodyDigest is ABSENT.
    return {
      testRef: testRefOf(pair.base), status, reason,
      tagBefore: pair.base.tag, tagAfter: null,
      framework: pair.base.framework, implementationIdentity: pair.base.implementationIdentity,
      baseBodyDigest: pair.base.bodyDigest,
    };
  }
  // moved / modified / retagged / governance-affected: identity from head, the "before" columns
  // from base, the "after" columns from head. Mixing these is how an entry starts describing two
  // different tests at once.
  return {
    testRef: testRefOf(pair.head), status, reason,
    tagBefore: pair.base.tag, tagAfter: pair.head.tag,
    framework: pair.head.framework, implementationIdentity: pair.head.implementationIdentity,
    baseBodyDigest: pair.base.bodyDigest, headBodyDigest: pair.head.bodyDigest,
  };
}

const refKey = (entry) => [entry.testRef.path, entry.testRef.adapterId, entry.testRef.structuralId];

function assertStrictlyAscending(entries) {
  for (let i = 1; i < entries.length; i += 1) {
    const a = refKey(entries[i - 1]);
    const b = refKey(entries[i]);
    const order = compareCodePoint(a[0], b[0]) || compareCodePoint(a[1], b[1]) || compareCodePoint(a[2], b[2]);
    if (order >= 0) {
      throw fail("E_ENTRY_ORDER",
        `entries must be strictly ascending by the (path, adapterId, structuralId) code-point tuple; `
        + `(${a.join(", ")}) is not before (${b.join(", ")})`,
        { previous: a, next: b });
    }
  }
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return value;
}

// AC172 (6). The registry digest an envelope declares must be the one the analysed preimage is
// bound to. There is no legal way for a second registry to appear here, so this is a defensive
// branch: it exists because "no legal entry point" is not the same as "cannot happen", and the
// spec requires the mixed case to be REFUSED rather than silently preferred.
function assertRegistryBinding(discovery) {
  const bound = discovery.registryDigest;
  if (typeof bound !== "string" || !/^[0-9a-f]{64}$/.test(bound)) {
    throw fail("E_REGISTRY_BINDING",
      `the discovery preimage carries no usable registryDigest (${JSON.stringify(bound)}); the envelope may not invent one`,
      { registryDigest: bound });
  }
  return bound;
}

// --- the operation ---------------------------------------------------------------------------------

export async function produceChangedTestInventoryV2(request) {
  let checked;
  try {
    checked = checkProducerRequest(request, arguments.length, "produceChangedTestInventoryV2");
  } catch (error) {
    if (error instanceof ProducerRequestError) throw fail(error.code, error.message, error.detail);
    throw error;
  }
  const { repoRoot, baseTreeOid, taskId } = checked;

  // Both preimages come from HERE, from the same exact request. A caller cannot supply either.
  const discovery = await buildDiscoveryAnalysisPreimage({ repoRoot, baseTreeOid });

  // The governance context, NOT a finished carrier: everything below runs between G1 and G2, so G2
  // still witnesses the interval the envelope claims. Taking a completed four-key carrier and then
  // validating bindings against G1 afterwards is exactly what §11b.10c v1.16 forbids.
  const { carrier: governance, value: entries } = await runWithGovernanceContext(
    { repoRoot, baseTreeOid, taskId }, 1, "produceChangedTestInventoryV2",
    async (ctx) => {
      // AC172 cross-binding, before anything is derived from either side. Exact code-point
      // equality; no side preferred, nothing re-run and re-stitched, no partial result.
      if (discovery.baseTreeOid !== baseTreeOid) {
        throw fail("E_CROSS_BINDING",
          `the two preimages disagree about baseTreeOid (request ${baseTreeOid}, discovery `
          + `${discovery.baseTreeOid}); neither side is preferred and no partial result is returned`,
          { request: baseTreeOid, discovery: discovery.baseTreeOid });
      }
      if (discovery.headViewDigest !== ctx.snapshot.headViewDigest) {
        throw fail("E_CROSS_BINDING",
          `the two preimages were taken against different head views (discovery ${discovery.headViewDigest}, `
          + `governance ${ctx.snapshot.headViewDigest}); an envelope built from both would declare a freshness `
          + "carrier from one instant and classify against another",
          { discovery: discovery.headViewDigest, governance: ctx.snapshot.headViewDigest });
      }
      // AC172 (6): registryDigest is the one the analysed preimage is bound to. Reading a second
      // registry and mixing it in is fail-closed, not a value to prefer.
      assertRegistryBinding(discovery);

      const index = indexStore(ctx.current);
      const pairs = matchBaseHeadDeclarations(discovery);
      const out = [];
      for (const pair of pairs) {
        const status = classify(pair, ctx.lifecycleAffectedClauses);
        if (status === "unchanged") continue;
        if (status !== "deleted" && (pair.head === null || pair.head.tag === null)) {
          throw fail("E_POST_BINDING_MISSING",
            `${pair.head === null ? "a paired test" : pair.head.path} has status ${status} with no head-side `
            + "binding; a non-deleted entry must carry tagAfter, and this is not filled in with EXPL or omitted",
            { status });
        }
        // Binding semantics BEFORE the entry is emitted -- pre against B, post against the same G1
        // and the same T0. A deleted pair has no post-state to charge.
        const where = (pair.head ?? pair.base).path;
        if (pair.base !== null) assertPreBinding(ctx.base, pair.base.tag, where);
        if (status !== "deleted") assertPostBinding(index, ctx.current, ctx.taskState, pair.head.tag, where, ctx.t0);
        out.push(project(pair, status));
      }
      assertStrictlyAscending(out);
      return out;
    });

  const body = {
    inventoryVersion: INVENTORY_VERSION,
    baseTreeOid,
    registryDigest: discovery.registryDigest,
    headViewDigest: discovery.headViewDigest,
    inputProvenanceStoreDigest: governance.inputProvenanceStoreDigest,
    entries,
  };
  const envelope = { ...body, inventoryDigest: computeInventoryV2Digest(body) };

  // AC172 (6), on the value actually emitted. The envelope's registryDigest must BE the one the
  // analysed discovery preimage is bound to -- not merely digest-shaped. A second registry read and
  // mixed in here is refused, never preferred.
  if (envelope.registryDigest !== discovery.registryDigest) {
    throw fail("E_REGISTRY_BINDING",
      `the envelope declares registryDigest ${envelope.registryDigest} but the analysed discovery preimage is bound to ${discovery.registryDigest}; a second registry may not be mixed in`,
      { emitted: envelope.registryDigest, bound: discovery.registryDigest });
  }

  // Exactly seven keys. No evaluationTime, producedAt, clockDigest or equivalent: T0 is not
  // persisted, and taskId is a request key, never a carrier or envelope field.
  const keys = Object.keys(envelope).sort();
  const wanted = [...V2_INVENTORY_KEYS].sort();
  if (keys.length !== wanted.length || keys.some((k, i) => k !== wanted[i])) {
    throw fail("E_ENVELOPE_SHAPE",
      `the envelope must carry exactly ${JSON.stringify(wanted)}; got ${JSON.stringify(keys)}`, { keys });
  }
  return deepFreeze(envelope);
}
