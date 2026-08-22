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
  canonicalJson, compareCodePoint,
} from "./provenance-store.mjs";
import { computeInventoryV2Digest, V2_INVENTORY_KEYS } from "./changed-test-inventory.mjs";
import { buildDiscoveryAnalysisPreimage } from "./adapter-discovery-preimage.mjs";
import { matchBaseHeadDeclarations } from "./base-head-declaration-matcher.mjs";
import { buildGovernanceSeedPreimage } from "./governance-seed-preimage.mjs";
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

// --- the operation ---------------------------------------------------------------------------------

export async function produceChangedTestInventoryV2(request) {
  let checked;
  try {
    checked = checkProducerRequest(request, arguments.length, "produceChangedTestInventoryV2");
  } catch (error) {
    if (error instanceof ProducerRequestError) throw fail(error.code, error.message, error.detail);
    throw error;
  }
  const { repoRoot, baseTreeOid } = checked;

  // Both preimages are obtained HERE, from the same exact request. A caller cannot supply either,
  // which is what makes the envelope's freshness carrier describe the inputs actually analysed.
  const discovery = await buildDiscoveryAnalysisPreimage({ repoRoot, baseTreeOid });
  const governance = await buildGovernanceSeedPreimage({ repoRoot, baseTreeOid });

  // AC172 cross-binding, before anything is derived from either side. Exact code-point equality.
  // No side is preferred, nothing is re-run and re-stitched, and no partial result escapes: a
  // caller that wants to retry restarts one whole invocation.
  if (discovery.baseTreeOid !== baseTreeOid || governance.baseTreeOid !== baseTreeOid) {
    throw fail("E_CROSS_BINDING",
      `the two preimages disagree about baseTreeOid (request ${baseTreeOid}, discovery `
      + `${discovery.baseTreeOid}, governance ${governance.baseTreeOid}); neither side is preferred `
      + "and no partial result is returned",
      { request: baseTreeOid, discovery: discovery.baseTreeOid, governance: governance.baseTreeOid });
  }
  if (discovery.headViewDigest !== governance.headViewDigest) {
    throw fail("E_CROSS_BINDING",
      `the two preimages were taken against different head views (discovery ${discovery.headViewDigest}, `
      + `governance ${governance.headViewDigest}); an envelope built from both would declare a freshness `
      + "carrier from one instant and classify against another",
      { discovery: discovery.headViewDigest, governance: governance.headViewDigest });
  }

  // registryDigest comes from the discovery preimage that was actually analysed, and from nowhere
  // else: reading a second registry here would reintroduce the TOCTOU window §11b.9c closes.
  const registryDigest = discovery.registryDigest;
  const seed = governance.lifecycleAffectedClauses;

  const pairs = matchBaseHeadDeclarations(discovery);

  const entries = [];
  for (const pair of pairs) {
    const status = classify(pair, seed);
    if (status === "unchanged") continue; // row 7: omitted entirely, with no marker of any kind
    // §2's post-state binding invariant: anything that is not deleted must carry a head binding.
    // An absent one is fail-closed -- never an implied EXPL, never a silently dropped entry.
    if (status !== "deleted" && (pair.head === null || pair.head.tag === null)) {
      throw fail("E_POST_BINDING_MISSING",
        `${pair.head === null ? "a paired test" : pair.head.path} has status ${status} with no head-side `
        + "binding; a non-deleted entry must carry tagAfter, and this is not filled in with EXPL or omitted",
        { status });
    }
    entries.push(project(pair, status));
  }

  // The matcher already returns its records in this order, so this is an assertion rather than a
  // sort: if it ever stops holding, the right answer is to stop, not to quietly reorder.
  assertStrictlyAscending(entries);

  const body = {
    inventoryVersion: INVENTORY_VERSION,
    baseTreeOid,
    registryDigest,
    headViewDigest: discovery.headViewDigest,
    inputProvenanceStoreDigest: governance.inputProvenanceStoreDigest,
    entries,
  };
  const envelope = { ...body, inventoryDigest: computeInventoryV2Digest(body) };

  // Exactly seven keys. No evaluationTime, producedAt, clockDigest or any equivalent: T0 is not
  // persisted, and adding a field here would need a new inventory schema and version.
  const keys = Object.keys(envelope).sort();
  const wanted = [...V2_INVENTORY_KEYS].sort();
  if (keys.length !== wanted.length || keys.some((k, i) => k !== wanted[i])) {
    throw fail("E_ENVELOPE_SHAPE",
      `the envelope must carry exactly ${JSON.stringify(wanted)}; got ${JSON.stringify(keys)}`, { keys });
  }
  return deepFreeze(envelope);
}
