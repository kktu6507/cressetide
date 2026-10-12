// TP §11b.9c Step 6: the committed-batch consumer.
//
// WHAT IT IS. One async component that takes an exact repository/task request and decides whether the
// batch a task has ALREADY committed converges. It reads the validated current store, that task's
// unique committed head and the version-2 inventory preimage inside it — and nothing else. Scratch is
// never read, the producer is never re-run, and no writer-time value is replayed from persisted
// hashes.
//
// WHERE IT IS NOW WIRED, and what that does not mean. `contract-check.mjs --provenance` delegates to
// this component: that mode requires `--task <id>` and refuses `--inventory`, because the authority
// is the committed snapshot and scratch is never an input. It emits no artifact (that is
// changed-test-inventory-artifact.mjs's single job), it does not wire the seven-step loop, and it
// does not make Phase 2 READY. The unsupported-populated-inventory gate this comment used to name is
// retired -- the public parser rolled to v2 and refuses v1 envelopes instead.
//
// PROOF ORDER, and why. Authority first, because every later phase reads values that only a validated
// store makes meaningful. Then source freshness, because §11b.9c step 1 places it before accepting
// any inventory or batch and it is far cheaper than the semantic work. Then coverage, then the full
// binding table, then the resolution mode and acknowledgement, then outcome correspondence. Each
// phase has its own diagnostic code, so a shape failure can never be mistaken for an anti-borrowing
// refusal.
//
// AUTHORITY BOUNDARIES. Upstream typed errors — the canonical inventory reader's, the store's, the
// Git reader's — propagate UNCHANGED: this component wraps nothing, because a wrapper would replace a
// diagnosable cause with its own opinion. Its own judgments carry E_STEP6_* codes and nothing else
// does. It captures its own single S3 and its own single fresh registry read; it accepts no snapshot,
// no context, no callback and no clock.
import {
  CANONICAL_STORE_PATH, PROVENANCE_VERSION, loadStore, validateStoreSchema, validateAll, indexStore,
  batchInventoryPreimage, canonicalJson, digestOf, parseStore, validateHistoricalStore,
  LEGACY_PROVENANCE_VERSION, emptyStore, storeDigest, sortTypedRefs, resolutionGroupDigest,
  clauseKindOf, isCanonicalClauseRef, statusOf, activeSuccessorChainEnd, mechanicallyApplicable,
  isExceptionBacked, checkSourceIntegrity, principalsEqual, parseCanonicalExpiry,
  effectiveTransition, applicable, compareCodePoint, FINDING_KIND_ORDER,
} from "./provenance-store.mjs";
import { computeInventoryV2Digest } from "./changed-test-inventory.mjs";
import { captureHeadViewSnapshot } from "./head-view-snapshot.mjs";
import { readTestAdapterRegistryRootFresh } from "./adapter-registry.mjs";
import { readHeadExplicitConfig, registryDigestOf } from "./explicit-config.mjs";
import { compareSourceDigests } from "./source-digest-comparison.mjs";
import { buildSearchView, checkSourceOccurrence } from "./source-occurrence.mjs";
import { readExactTreeBlob } from "./exact-tree-blob.mjs";
import {
  refTypeFault, tagFault, sideObservationFault, projectionFault, bindingShapeFault, clauseTagOf,
} from "./batch-result-binding.mjs";

export class CommittedBatchError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = "CommittedBatchError";
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

const fail = (code, message, detail) => new CommittedBatchError(code, message, detail);
const REQUEST_KEYS = ["repoRoot", "taskId"];
const GENERAL_FINDING_KINDS = FINDING_KIND_ORDER.filter((k) => k !== "assum-reading-change");
const RESOLUTION_KEYS = {
  "this-round": ["mode", "semanticEvidenceRef", "transitionRef"],
  "historical-convergence": ["mode", "transitionRef"],
};
const TEST_DISCIPLINE = { kind: "discipline", discipline: "test" };
const INTENT_DISCIPLINE = { kind: "discipline", discipline: "intent" };
const keyOf = (ref) => canonicalJson([ref?.path, ref?.adapterId, ref?.structuralId]);
const refKey = (ref) => canonicalJson({ kind: ref.kind, ref: ref.ref });

// A typed RecordRef is EXACTLY { kind, ref }, both nonempty strings. Charged before refKey or
// sortTypedRefs sees the value, because BOTH OF THOSE CONSTRUCT A NEW TWO-FIELD OBJECT from the ref
// they are given -- refKey is canonicalJson({ kind, ref }) and sortTypedRefs rebuilds each member as
// { kind: r.kind, ref: r.ref } -- so an extra member never reaches the string they compare. That is a
// property of those two projections, NOT of canonicalJson, which retains every ordinary defined key
// and omits only keys whose value is undefined. The same declared type appears in a group's
// semanticEvidenceRefs, in its governanceWitnessRef and nested inside a finding's
// resolutionRef.semanticEvidenceRef, so one predicate charges all three -- it is the same data type in
// three locations, not three rules.
function typedRefFault(ref) {
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) return "is not an object";
  const keys = Object.keys(ref).sort(compareCodePoint);
  if (keys.length !== 2 || keys[0] !== "kind" || keys[1] !== "ref") {
    return `declares ${canonicalJson(keys)} rather than exactly ["kind","ref"]`;
  }
  if (typeof ref.kind !== "string" || ref.kind === "" || typeof ref.ref !== "string" || ref.ref === "") {
    return "carries a kind or ref that is not a nonempty string";
  }
  return null;
}

// --- phase 1: authority ---------------------------------------------------------------------------

function loadAuthority(repoRoot, taskId) {
  const loaded = loadStore(repoRoot);                 // parse errors propagate unchanged
  const store = loaded.store;
  if (store.provenanceVersion !== PROVENANCE_VERSION) {
    throw fail("E_STEP6_STORE_VERSION",
      `the current store is provenanceVersion ${JSON.stringify(store.provenanceVersion)}; this consumer is `
      + "read-only and will not migrate it",
      { provenanceVersion: store.provenanceVersion });
  }
  // Clock-free schema work FIRST, then ONE T0 sample, then the full validation against that instant.
  // Sampling before the schema pass would put a clock reading in front of rules that never needed one;
  // sampling twice would let two halves of the same verdict disagree about "now".
  validateStoreSchema(store);
  const t0 = Date.now();
  validateAll(store, { now: t0 });

  const index = indexStore(store);
  const ts = index.taskStates.get(taskId);
  if (!ts) {
    throw fail("E_STEP6_UNKNOWN_TASK", `no TaskState for taskId ${JSON.stringify(taskId)}`, { taskId });
  }
  const head = ts.committedProvenanceBatchRef;
  if (!head) {
    throw fail("E_STEP6_NO_COMMITTED_BATCH",
      `task ${taskId} has no committedProvenanceBatchRef: nothing has been submitted, so there is no committed `
      + "provenance to verify. Rerun the loop through Step 5",
      { taskId });
  }
  const batch = index.records.get(head.ref);
  if (!batch || batch.kind !== "provenance-batch") {
    throw fail("E_STEP6_HEAD_UNRESOLVABLE",
      `committedProvenanceBatchRef ${head.ref} does not resolve to a provenance-batch record`, { ref: head.ref });
  }
  if (batch.taskId !== ts.taskId) {
    throw fail("E_STEP6_HEAD_TASK",
      `batch ${batch.recordId} belongs to task ${batch.taskId}, not ${ts.taskId}`, { batch: batch.recordId });
  }
  // The version-2 preimage, through the ONE accepted authority. A legacy record refuses HERE with the
  // reader's own E_NO_INVENTORY_PREIMAGE rather than through a second version test written here.
  const inventory = batchInventoryPreimage(batch);

  // §11b.9c step 2 (a)(b)(c), and only those. The historical three-value equality is the WRITER's
  // transaction-time invariant over values that are not persisted state, so it is not re-evaluated;
  // and step 3 forbids comparing the current store digest with inputProvenanceStoreDigest at all,
  // because a legitimate Step 5 mutation necessarily moves the first (AC127).
  const recomputed = computeInventoryV2Digest(inventory);
  if (recomputed !== inventory.inventoryDigest) {
    throw fail("E_STEP6_INVENTORY_DIGEST",
      `the committed inventorySnapshot digests to ${recomputed} but declares ${inventory.inventoryDigest}`,
      { declared: inventory.inventoryDigest, actual: recomputed });
  }
  if (batch.inventoryDigest !== inventory.inventoryDigest) {
    throw fail("E_STEP6_DERIVED_DIGEST",
      `batch ${batch.recordId} declares inventoryDigest ${batch.inventoryDigest} while its snapshot's own digest is `
      + `${inventory.inventoryDigest}`,
      { batch: batch.recordId });
  }
  if (typeof inventory.inputProvenanceStoreDigest !== "string") {
    throw fail("E_STEP6_INVENTORY_DIGEST",
      "the committed inventorySnapshot carries no inputProvenanceStoreDigest", { batch: batch.recordId });
  }
  if (digestOf(batch.batchSnapshot) !== batch.batchDigest) {
    throw fail("E_STEP6_BATCH_DIGEST",
      `batch ${batch.recordId} batchDigest does not cover its own batchSnapshot, so nothing inside it is committed`,
      { batch: batch.recordId });
  }
  const base = ts.baseProvenance;
  if (canonicalJson(batch.batchSnapshot.baseProvenance) !== canonicalJson(base)) {
    throw fail("E_STEP6_BASE_WITNESS",
      `batch ${batch.recordId} states a baseProvenance witness that differs from task ${ts.taskId}'s tracked witness`,
      { batch: batch.recordId });
  }
  if (base.storePath !== CANONICAL_STORE_PATH) {
    throw fail("E_STEP6_BASE_WITNESS",
      `task ${ts.taskId} baseProvenance.storePath is ${base.storePath}, not the canonical ${CANONICAL_STORE_PATH}`,
      { taskId });
  }
  if (base.treeOid !== inventory.baseTreeOid) {
    throw fail("E_STEP6_BASE_WITNESS",
      `baseProvenance.treeOid ${base.treeOid} does not equal the inventory's baseTreeOid ${inventory.baseTreeOid}`,
      { taskId });
  }
  return { store, index, t0, ts, base, batch, inventory };
}

// --- phase 2: ONE S3, one fresh registry ------------------------------------------------------------

async function captureSources(repoRoot, inventory) {
  // Exactly one capture and one fresh registry read for the whole invocation. A cached registry root
  // would let a second verification report fresh against a registry that has already changed, and a
  // second capture would let freshness and Check B answer about different worlds.
  const snapshot = await captureHeadViewSnapshot({ repoRoot });
  const registryRoot = readTestAdapterRegistryRootFresh();
  const explicitConfig = readHeadExplicitConfig(snapshot, registryRoot);
  const registryDigest = registryDigestOf(registryRoot, explicitConfig);
  const { fresh, stale, detail } = compareSourceDigests(
    { headViewDigest: inventory.headViewDigest, registryDigest: inventory.registryDigest },
    { headViewDigest: snapshot.headViewDigest, registryDigest },
  );
  if (!fresh) {
    throw fail("E_STEP6_SOURCE_STALE",
      `source freshness failed: ${stale.join(" and ")} ${stale.length === 1 ? "does" : "do"} not match the current `
      + "repository, so the committed batch describes a world that has moved",
      detail);
  }
  return {
    snapshot,
    registryRoot,
    searchView: buildSearchView(snapshot),      // the RETAINED S3, reused by Check B below
    headViewDigest: snapshot.headViewDigest,
    registryDigest,
  };
}

// --- phase 3: coverage ------------------------------------------------------------------------------

function coverEntries(inventory, results, batchId) {
  if (!Array.isArray(results)) {
    throw fail("E_STEP6_RESULT_SHAPE", `batch ${batchId} carries no results array`, { batch: batchId });
  }
  const entries = new Map();
  for (const entry of inventory.entries) entries.set(keyOf(entry.testRef), entry);
  const paired = [];
  const seen = new Set();
  for (const result of results) {
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw fail("E_STEP6_RESULT_SHAPE", `batch ${batchId} carries a result that is not an object`, { batch: batchId });
    }
    const id = keyOf(result.testRef);
    const entry = entries.get(id);
    if (entry === undefined) {
      throw fail("E_STEP6_COVERAGE",
        `result ${id} names no entry in the committed inventory; results are one-to-one with entries`,
        { batch: batchId, result: id });
    }
    if (seen.has(id)) {
      throw fail("E_STEP6_COVERAGE", `entry ${id} has more than one result`, { batch: batchId, result: id });
    }
    seen.add(id);
    paired.push({ result, entry, id });
  }
  if (seen.size !== inventory.entries.length) {
    const missing = [...entries.keys()].filter((k) => !seen.has(k));
    throw fail("E_STEP6_COVERAGE",
      `${missing.length} inventory entr${missing.length === 1 ? "y has" : "ies have"} no result; a partially `
      + "reviewed batch must not read as reviewed-clean",
      { batch: batchId, missing: missing.slice(0, 5) });
  }
  return paired;
}

// --- phase 4: binding -------------------------------------------------------------------------------

function assertResultBinding(result, entry, id) {
  const ref = refTypeFault(result.testRef, entry.testRef);
  if (ref !== null) {
    throw fail("E_STEP6_RESULT_SHAPE",
      `result ${id}'s testRef is not the entry's exact declared type (${ref.kind})`, { result: id, fault: ref.kind });
  }
  for (const side of ["tagBefore", "tagAfter"]) {
    const fault = tagFault(result, entry, side);
    if (fault !== null) {
      throw fail("E_STEP6_RESULT_BINDING",
        `result ${id} ${fault.kind === "absent" ? `states no ${side}` : `states a ${side} the inventory does not`}`,
        { result: id, side, fault: fault.kind });
    }
  }
  for (const side of ["base", "head"]) {
    const fault = sideObservationFault(result, entry, side);
    if (fault !== null) {
      throw fail("E_STEP6_RESULT_BINDING",
        `result ${id} states a ${side}-side observation the inventory does not support (${fault.kind})`,
        { result: id, side, fault: fault.kind });
    }
  }
  const projection = projectionFault(result, entry);
  if (projection !== null) {
    throw fail("E_STEP6_RESULT_BINDING",
      `result ${id}'s clauseRef/dpRef projection is not one actual side of its entry taken whole (${projection.kind})`,
      { result: id, fault: projection.kind });
  }
  if (!Array.isArray(result.findings)) {
    throw fail("E_STEP6_RESULT_SHAPE",
      `result ${id} needs a findings array; no finding means clean, an absent array means nothing at all`,
      { result: id });
  }
  for (const finding of result.findings) {
    if (!finding || typeof finding !== "object" || !FINDING_KIND_ORDER.includes(finding.kind)) {
      throw fail("E_STEP6_FINDING_SHAPE",
        `result ${id} carries a finding of unknown kind ${JSON.stringify(finding && finding.kind)}`, { result: id });
    }
    if (typeof finding.evidence !== "string" || finding.evidence === "") {
      throw fail("E_STEP6_FINDING_SHAPE",
        `result ${id} carries a ${finding.kind} finding with no evidence string`, { result: id });
    }
    if (finding.binding !== undefined) {
      const fault = bindingShapeFault(finding.binding);
      if (fault !== null) {
        throw fail("E_STEP6_FINDING_SHAPE",
          `result ${id} carries a finding binding that is not { clauseRef, dpRef? } (${fault.kind})`,
          { result: id, fault: fault.kind });
      }
    }
  }
}

// §11b.9b: the entry states the identity the CURRENT registry binds to that adapterId. The registry
// root is the one this invocation read fresh, so a mutated registry is observed here and not from a
// cache taken earlier.
function assertEntryIdentity(entry, registryRoot, id) {
  const adapter = (registryRoot.adapters || []).find((a) => a.adapterId === entry.testRef.adapterId);
  if (adapter === undefined) {
    throw fail("E_STEP6_ENTRY_IDENTITY",
      `entry ${id} names adapterId ${JSON.stringify(entry.testRef.adapterId)}, which the current registry does not `
      + "declare",
      { entry: id, adapterId: entry.testRef.adapterId });
  }
  if (canonicalJson(entry.implementationIdentity) !== canonicalJson(adapter.implementationIdentity)) {
    throw fail("E_STEP6_ENTRY_IDENTITY",
      `entry ${id} states an implementationIdentity the current registry does not bind to `
      + `${JSON.stringify(entry.testRef.adapterId)}`,
      {
        entry: id,
        declared: entry.implementationIdentity,
        actual: adapter.implementationIdentity,
      });
  }
}

// IS §4's direct Source set, dispatched by clause kind exactly as the accepted producer does. A REQ
// names its Source directly; a DEC or ASSUM follows only PLAIN "S-…" basis strings. A free-form string
// is an ObservationalRef -- disclosure-only, and never resolved -- and an object is a RecordRef or a
// typed ObservationalRef and is not followed either. Treating every basis string as a Source refuses a
// legitimate clause that records a plain textual observation beside a real Source.
function directSourceRefs(clause) {
  if (clauseKindOf(clause.id) === "REQ") return typeof clause.sourceRef === "string" ? [clause.sourceRef] : [];
  const refs = [];
  for (const basis of clause.basisRefs || []) {
    if (typeof basis === "string" && basis.startsWith("S-")) refs.push(basis);
  }
  return refs;
}

// shared §9's PRE-change row: resolvability and Check A only, resolved IN THE VERIFIED BASE STORE.
// The pre-state is a historical fact about B, which is why the accepted producer's own
// assertPreBinding takes `base` and says "does not resolve in the base-tree store". Current activity,
// applicability, live-current and expiry are deliberately NOT charged here -- the legitimate repair is
// precisely to move a test off a binding that has since been invalidated.
function assertPreBinding(baseIndex, tag, id) {
  const clauseTag = clauseTagOf(tag);
  if (clauseTag === null) return;                    // null (added / untagged legacy) or EXPL
  const clause = baseIndex.clauses.get(clauseTag.clauseRef);
  if (clause === undefined) {
    throw fail("E_STEP6_PRE_BINDING",
      `entry ${id}'s pre-side binding ${clauseTag.clauseRef} does not resolve in the verified base store`,
      { entry: id, clauseRef: clauseTag.clauseRef });
  }
  for (const ref of directSourceRefs(clause)) {
    const source = baseIndex.sources.get(ref);
    if (source === undefined) {
      throw fail("E_STEP6_PRE_BINDING",
        `entry ${id}'s pre-side clause ${clause.id} names source ${JSON.stringify(ref)}, which does not resolve in `
        + "the verified base store",
        { entry: id, sourceId: ref });
    }
    const integrity = checkSourceIntegrity(source);
    if (!integrity.ok) {
      throw fail("E_STEP6_PRE_BINDING",
        `entry ${id}'s pre-side source ${ref} fails Check A (${integrity.reason})`,
        { entry: id, sourceId: ref, reason: integrity.reason });
    }
  }
}

// shared §9's POST-change row, complete and unwaived. The producer's ob-3/ob-5/ob-8 lifecycle-seed
// exemptions excuse a PRODUCER obligation against a witness; they grant no gate acceptance and are
// not consulted here.
function assertPostBinding(context, tag, id, observations) {
  const { index, t0, ts, searchView } = context;
  const clauseTag = clauseTagOf(tag);
  if (clauseTag === null) return;                    // null (deleted) or EXPL binds no clause
  const clauseRef = clauseTag.clauseRef;
  const clause = index.clauses.get(clauseRef);
  if (clause === undefined) {
    throw fail("E_STEP6_POST_BINDING",
      `entry ${id}'s post-side binding ${clauseRef} does not resolve in the current store`,
      { entry: id, clauseRef });
  }
  if (statusOf(index, clauseRef) !== "active") {
    throw fail("E_STEP6_POST_BINDING",
      `entry ${id}'s post-side clause ${clauseRef} is ${statusOf(index, clauseRef)}, not active`,
      { entry: id, clauseRef });
  }
  const mechanical = mechanicallyApplicable(index, clauseRef, t0);
  if (!mechanical.ok) {
    throw fail("E_STEP6_POST_BINDING",
      `entry ${id}'s post-side clause ${clauseRef} is not mechanically applicable (${mechanical.reason})`,
      { entry: id, clauseRef, reason: mechanical.reason });
  }
  assertReqAtDp(context, clauseTag, clause, id);
  // Source obligations for a POST-side binding: Check A always, plus Check B against the retained S3
  // and the full exception chain with current effectivity.
  for (const ref of directSourceRefs(clause)) {
    const source = index.sources.get(ref);
    if (source === undefined) {
      throw fail("E_STEP6_POST_BINDING",
        `entry ${id}'s post-side clause ${clause.id} names source ${JSON.stringify(ref)}, which does not resolve`,
        { entry: id, sourceId: ref });
    }
    const integrity = checkSourceIntegrity(source);
    if (!integrity.ok) {
      throw fail("E_STEP6_POST_BINDING",
        `entry ${id}'s post-side source ${ref} fails Check A (${integrity.reason})`,
        { entry: id, sourceId: ref, reason: integrity.reason });
    }
    const occurrence = checkSourceOccurrence(source, searchView);
    if (!occurrence.analysable) {
      throw fail("E_STEP6_SOURCE_UNANALYSABLE",
        `source ${ref} cannot be evaluated for Check B (${occurrence.reason}); this fails closed rather than `
        + "defaulting to not-drift",
        { entry: id, sourceId: ref, reason: occurrence.reason });
    }
    if (occurrence.applicable && occurrence.drifts) {
      throw fail("E_STEP6_SOURCE_DRIFT",
        `source ${ref} has zero live occurrences in the current repository, so the post-side binding of `
        + `${clauseRef} rests on text that is no longer there`,
        { entry: id, sourceId: ref });
    }
    // Two or more is an anchor-ambiguity OBSERVATION and explicitly not drift; one is not drift even
    // when the locator points elsewhere, because a locator is a stale-tolerant hint.
    if (occurrence.ambiguous) observations.set(ref, occurrence.count);
    if (source.contentKind === "exception-grant") assertGrantChain(index, source, t0, id);
  }
}

function assertGrantChain(index, source, t0, id) {
  const target = index.clauses.get(source.targetConstraintRef);
  if (target === undefined) {
    throw fail("E_STEP6_EXCEPTION_CHAIN",
      `exception grant ${source.sourceId} names targetConstraintRef ${JSON.stringify(source.targetConstraintRef)}, `
      + "which does not resolve",
      { entry: id, sourceId: source.sourceId });
  }
  if (clauseKindOf(target.id) !== "REQ" || target.authority !== "hard-constraint") {
    throw fail("E_STEP6_EXCEPTION_CHAIN",
      `exception grant ${source.sourceId} targets ${target.id}, which is not a hard-constraint REQ`,
      { entry: id, sourceId: source.sourceId, target: target.id });
  }
  if (canonicalJson(source.grantAuthorityRef) !== canonicalJson(target.ownerRef)) {
    throw fail("E_STEP6_EXCEPTION_CHAIN",
      `exception grant ${source.sourceId} was issued by an authority that is not ${target.id}'s ownerRef`,
      { entry: id, sourceId: source.sourceId, target: target.id });
  }
  const expiresAt = parseCanonicalExpiry(source.expiry);
  if (expiresAt === null) {
    throw fail("E_STEP6_EXCEPTION_CHAIN",
      `exception grant ${source.sourceId} carries a non-canonical expiry, so it can never be shown live`,
      { entry: id, sourceId: source.sourceId });
  }
  // shared v1.15 §2: expiryInstant <= T0 is EXPIRED, and exactly equal counts as expired. Judged
  // against the ONE T0 this invocation sampled, never against a second reading.
  if (expiresAt <= t0) {
    throw fail("E_STEP6_EXCEPTION_CHAIN",
      `exception grant ${source.sourceId} expired at ${source.expiry}`,
      { entry: id, sourceId: source.sourceId, expiry: source.expiry });
  }
}

// §7's REQ@DP rule, all five conditions, in the shape the accepted producer's assertReqAtDp uses.
//
// The QUALIFIED form names its DP and that DP is used -- never a search. The BARE form is inferred
// ONLY inside this task's membership and only by an EXACT `resolvedBy` match, with zero and many both
// fail-closed: an active-successor chain walk is not a substitute, because it lets a DP whose terminal
// merely leads to the clause stand in for the DP that actually resolved it. A qualifier on a clause
// that is NOT exception-backed asserts a scope promise that does not exist and is refused outright.
function assertReqAtDp(context, tag, clause, id) {
  const { index, ts, t0 } = context;
  const qualified = typeof tag.dpRef === "string";
  const backed = clauseKindOf(clause.id) === "REQ" && isExceptionBacked(index, clause);
  if (qualified && !backed) {
    throw fail("E_STEP6_DP_QUALIFIER",
      `entry ${id} qualifies ${clause.id} with ${JSON.stringify(tag.dpRef)}, but that clause is not exception-backed, `
      + "so it carries no DP qualifier",
      { entry: id, clauseRef: clause.id, dpRef: tag.dpRef });
  }
  if (!backed) return;

  const scope = ts.currentTaskDpIds || [];
  let dpId = tag.dpRef;
  if (!qualified) {
    const candidates = scope.filter((candidate) => {
      const dp = index.dps.get(candidate);
      return dp !== undefined && dp.resolvedBy === clause.id;
    });
    if (candidates.length !== 1) {
      throw fail("E_STEP6_DP_SCOPE",
        `entry ${id} binds exception-backed ${clause.id} in bare form, but task ${ts.taskId} holds `
        + `${candidates.length} DP(s) resolved by it; exactly one is required, otherwise qualify the tag`,
        { entry: id, clauseRef: clause.id, candidates: candidates.length });
    }
    [dpId] = candidates;
  }
  // (1) membership -- a DP outside this task cannot supply the scope for this task's binding.
  if (!scope.includes(dpId)) {
    throw fail("E_STEP6_DP_SCOPE",
      `entry ${id} names DP ${JSON.stringify(dpId)}, which is not in task ${ts.taskId}'s membership`,
      { entry: id, clauseRef: clause.id, dpId });
  }
  const dp = index.dps.get(dpId);
  if (dp === undefined) {
    throw fail("E_STEP6_DP_SCOPE", `entry ${id} names DP ${JSON.stringify(dpId)}, which does not resolve`,
      { entry: id, clauseRef: clause.id, dpId });
  }
  // (2) status and (3) the EXACT terminal. An open DP has settled nothing, and a DP resolved by some
  // other clause is not this binding's scope however its successors run.
  if (dp.status !== "resolved") {
    throw fail("E_STEP6_DP_SCOPE",
      `entry ${id} binds ${clause.id} at DP ${dpId}, whose status is ${JSON.stringify(dp.status)}, not resolved`,
      { entry: id, clauseRef: clause.id, dpId, status: dp.status });
  }
  if (dp.resolvedBy !== clause.id) {
    throw fail("E_STEP6_DP_SCOPE",
      `entry ${id} binds ${clause.id} at DP ${dpId}, which is resolved by ${JSON.stringify(dp.resolvedBy)}`,
      { entry: id, clauseRef: clause.id, dpId });
  }
  // (4) applicability AT THIS DP, against the one T0 this invocation sampled.
  const app = applicable(index, clause.id, dp, t0);
  if (!app.ok) {
    throw fail("E_STEP6_DP_SCOPE",
      `entry ${id}'s exception-backed ${clause.id} is not applicable at DP ${dpId} (${app.reason})`,
      { entry: id, clauseRef: clause.id, dpId, reason: app.reason });
  }
  // (5) the actual intent scope ruling about THIS DP.
  const ref = dp.scopeRulingRef;
  const ruling = ref && ref.kind === "review-ruling" ? index.records.get(ref.ref) : undefined;
  if (!ruling || ruling.kind !== "review-ruling") {
    throw fail("E_STEP6_DP_SCOPE",
      `DP ${dpId}'s scopeRulingRef does not resolve to a review-ruling for exception-backed ${clause.id}`,
      { entry: id, clauseRef: clause.id, dpId });
  }
  if (!principalsEqual(ruling.by, INTENT_DISCIPLINE) || ruling.subjectRef !== dpId) {
    throw fail("E_STEP6_DP_SCOPE",
      `DP ${dpId}'s scope ruling ${ruling.recordId} is not the intent discipline's verdict about this DP`,
      { entry: id, clauseRef: clause.id, dpId });
  }
}

// --- phase 5: resolution mode and acknowledgement ---------------------------------------------------

// The authoritative preimage for "this acknowledgement covers this evidence". A resolutionGroupDigest
// is one-way, so a digest alone can never name the set it covers: the persisted ResolutionGroup is the
// only place that set exists, and it is looked for along THIS TASK's committed chain.
// SCOPE, stated because it is narrow on purpose. Discovery is TOLERANT: an element counts only if it
// is an object whose `transitionRef` is the claimed id. Anything else is not a candidate and is
// skipped WITHOUT judgment -- auditing the semantics of unrelated historical groups is a separate
// obligation, and charging it here would retroactively condemn readable history for facts this claim
// does not rest on. Validation of an element that IS a candidate is exact, below.
//
// The container itself is a different question from its contents. An ABSENT `resolutions` field is
// legal in readable prior history -- neither recordPayloadComplete nor the accepted v2 reader requires
// it -- and contributes no candidates. A PRESENT non-array is a stated field of the wrong declared
// type: a typed refusal, never silently an empty list and never a leaked TypeError.
function candidateGroups(index, ts, transitionId, id) {
  const found = [];
  let ref = ts.committedProvenanceBatchRef;
  const walked = new Set();
  while (ref) {
    if (walked.has(ref.ref)) break;                  // a cycle cannot occur in a validated store
    walked.add(ref.ref);
    const record = index.records.get(ref.ref);
    if (!record || record.kind !== "provenance-batch") break;
    const snapshot = record.batchSnapshot;
    if (snapshot && Object.prototype.hasOwnProperty.call(snapshot, "resolutions")) {
      const groups = snapshot.resolutions;
      if (!Array.isArray(groups)) {
        throw fail("E_STEP6_GROUP_CONTAINER",
          `batch ${record.recordId} states a resolutions field that is not an array; a stated field of the wrong `
          + "declared type is refused rather than read as an empty list",
          { result: id, batch: record.recordId });
      }
      for (const group of groups) {
        if (group && typeof group === "object" && !Array.isArray(group) && group.transitionRef === transitionId) {
          found.push({ group, batch: record.recordId });
        }
      }
    }
    ref = record.previousBatchRef;
  }
  return found;
}

const GROUP_KEYS = ["governanceWitnessRef", "semanticEvidenceRefs", "subjectRef", "transitionRef"];

// The EXACT declared shape of a candidate, charged before the equivalence key is built. That key is
// an explicitly CONSTRUCTED four-field object whose evidence array goes through sortTypedRefs, and
// sortTypedRefs rebuilds each member as { kind, ref } -- so a group or ref carrying an undeclared
// member would have it projected out of the comparison and would normalise into a valid shape. The
// projection is what discards it; canonicalJson itself retains ordinary defined keys.
function assertCandidateShape(group, batch, transitionId, id) {
  const bad = (why, detail) => fail("E_STEP6_GROUP_MALFORMED",
    `the resolution group naming ${transitionId} in batch ${batch} ${why}`,
    { result: id, transitionRef: transitionId, batch, ...detail });
  const keys = Object.keys(group).sort(compareCodePoint);
  if (keys.length !== GROUP_KEYS.length || keys.some((k, i) => k !== GROUP_KEYS[i])) {
    throw bad(`declares ${canonicalJson(keys)} rather than exactly ${canonicalJson(GROUP_KEYS)}`, { keys });
  }
  if (typeof group.subjectRef !== "string" || group.subjectRef === "") {
    throw bad("carries a subjectRef that is not a nonempty string");
  }
  const witnessFault = typedRefFault(group.governanceWitnessRef);
  if (witnessFault !== null) throw bad(`carries a governanceWitnessRef that ${witnessFault}`);
  const refs = group.semanticEvidenceRefs;
  if (!Array.isArray(refs) || refs.length === 0) throw bad("carries no semanticEvidenceRefs array");
  for (const ref of refs) {
    const refFault = typedRefFault(ref);
    if (refFault !== null) throw bad(`carries an evidence ref that ${refFault}`);
  }
  // Duplicates are refused BEFORE normalisation: sortTypedRefs deduplicates, so a repeated member
  // would otherwise disappear silently rather than being reported as the malformed input it is. This
  // is a group-set integrity rule, not a claim that a duplicate would change the digest.
  const keyed = refs.map(refKey);
  if (new Set(keyed).size !== keyed.length) {
    throw bad("repeats an evidence ref; a repeated member is not a set");
  }
}

// Canonical-equivalent candidates carry ONE meaning; the normalisation is the digest formula's own
// sorted typed-ref representation, so a permutation of the evidence array is not a conflict. Duplicate
// refs are refused BEFORE normalisation, because sortTypedRefs deduplicates: a repeated member would
// otherwise be normalised away silently rather than reported as the malformed group input it is.
function resolveGroup(index, ts, transitionId, id) {
  const candidates = candidateGroups(index, ts, transitionId, id);
  if (candidates.length === 0) return null;
  const shapes = new Set();
  for (const { group, batch } of candidates) {
    assertCandidateShape(group, batch, transitionId, id);
    shapes.add(canonicalJson({
      subjectRef: group.subjectRef,
      transitionRef: group.transitionRef,
      governanceWitnessRef: group.governanceWitnessRef,
      semanticEvidenceRefs: sortTypedRefs(group.semanticEvidenceRefs),
    }));
  }
  if (shapes.size !== 1) {
    throw fail("E_STEP6_GROUP_CONFLICT",
      `${candidates.length} resolution groups name ${transitionId} and they do not agree; a conflicting candidate is `
      + "refused rather than resolved by taking the first, and it may not fall back to a singleton proof",
      { result: id, transitionRef: transitionId, candidates: candidates.length });
  }
  return candidates[0].group;
}

function assertAckCoverage(context, transition, evidenceRef, id) {
  const { index, ts } = context;
  const ackRef = transition.ackRef;
  const ack = ackRef ? index.records.get(ackRef.ref) : undefined;
  if (!ack || ack.kind !== ackRef.kind) {
    throw fail("E_STEP6_ACK_UNRESOLVABLE",
      `transition ${transition.id}'s ackRef does not resolve to a ${ackRef && ackRef.kind}`,
      { result: id, transitionRef: transition.id });
  }
  const successor = transition.successor === undefined ? null : transition.successor;
  const group = resolveGroup(index, ts, transition.id, id);
  if (group !== null) {
    if (group.subjectRef !== transition.subject) {
      throw fail("E_STEP6_GROUP_MALFORMED",
        `the resolution group naming ${transition.id} states subject ${JSON.stringify(group.subjectRef)} while the `
        + `transition's subject is ${JSON.stringify(transition.subject)}`,
        { result: id, transitionRef: transition.id });
    }
    if (canonicalJson(group.governanceWitnessRef) !== canonicalJson({ kind: ackRef.kind, ref: ackRef.ref })) {
      throw fail("E_STEP6_ACK_IDENTITY",
        `the resolution group naming ${transition.id} declares a governance witness the transition does not cite`,
        { result: id, transitionRef: transition.id });
    }
    const refs = sortTypedRefs(group.semanticEvidenceRefs);
    for (const ref of refs) {
      const record = index.records.get(ref.ref);
      if (!record || record.kind !== ref.kind) {
        throw fail("E_STEP6_ACK_UNRESOLVABLE",
          `the resolution group naming ${transition.id} cites ${ref.kind}/${ref.ref}, which does not resolve`,
          { result: id, transitionRef: transition.id, evidence: ref.ref });
      }
    }
    const expected = resolutionGroupDigest({
      subjectRef: group.subjectRef, action: transition.action, successor, semanticEvidenceRefs: refs,
    });
    if (ack.resolutionGroupDigest !== expected) {
      throw fail("E_STEP6_ACK_COVERAGE",
        `witness ${ack.recordId} does not cover the resolution group naming ${transition.id}`,
        { result: id, transitionRef: transition.id, witness: ack.recordId });
    }
    if (!refs.some((r) => refKey(r) === refKey(evidenceRef))) {
      throw fail("E_STEP6_ACK_COVERAGE",
        `the acknowledged evidence set for ${transition.id} does not include ${evidenceRef.ref}`,
        { result: id, transitionRef: transition.id, evidence: evidenceRef.ref });
    }
    return;
  }
  // ZERO CANDIDATES IN THE AUTHORITATIVE TASK CHAIN -- which is not "no group anywhere". The singleton
  // candidate preimage is then NAMED and CHECKED rather than assumed: recompute the digest over the
  // one evidence ref actually claimed and require the ACTUAL witness to carry it. An acknowledgement
  // taken over a larger set cannot be satisfied this way, because the formula hashes the whole sorted
  // set; guessing an unknown sibling is not possible and is not attempted.
  //
  // THE EXACT CLAIM, narrowly. Editing an already-malformed candidate so that it no longer names T can
  // turn a shape refusal into a valid singleton proof, so this is NOT a general assertion that
  // obscuring data cannot change the outcome. What cannot be fabricated is COVERAGE: whichever branch
  // is taken, the actual witness must reproduce the exact digest over the exact evidence set claimed.
  const singleton = resolutionGroupDigest({
    subjectRef: transition.subject,
    action: transition.action,
    successor,
    semanticEvidenceRefs: sortTypedRefs([evidenceRef]),
  });
  if (ack.resolutionGroupDigest !== singleton) {
    throw fail("E_STEP6_ACK_COVERAGE",
      `no resolution group in task ${ts.taskId}'s committed chain names ${transition.id}, and witness `
      + `${ack.recordId} does not cover the claimed evidence as a single-member group either`,
      { result: id, transitionRef: transition.id, witness: ack.recordId });
  }
}

function assertThisRoundEvidence(context, result, finding, entry, evidenceRef, id) {
  const { index, ts } = context;
  // The SAME declared two-field typed RecordRef as a group's evidence refs, charged with the same
  // predicate. It has to happen here, before refKey sees the value: refKey is
  // canonicalJson({ kind, ref }), a constructed two-field object, so a nested ref carrying an extra
  // field would have it projected away and its membership test would then succeed against a set it
  // does not actually belong to.
  const nestedFault = typedRefFault(evidenceRef);
  if (nestedFault !== null) {
    throw fail("E_STEP6_RESOLUTION_SHAPE",
      `result ${id}'s semanticEvidenceRef ${nestedFault}`, { result: id });
  }
  const evidence = index.records.get(evidenceRef.ref);
  if (!evidence || evidence.kind !== evidenceRef.kind) {
    throw fail("E_STEP6_EVIDENCE_UNRESOLVABLE",
      `result ${id} cites ${evidenceRef.kind}/${evidenceRef.ref}, which does not resolve`,
      { result: id, evidence: evidenceRef.ref });
  }
  // The fixed carrier: TP §6:558-560 gives it as a test-discipline ruling whose subjectRef is the
  // ASSUM, independently of how the transition arose.
  if (evidence.kind !== "review-ruling") {
    throw fail("E_STEP6_EVIDENCE_BINDING",
      `result ${id}'s semantic evidence ${evidenceRef.ref} is a ${evidence.kind}; the carrier is a test-reviewer `
      + "review-ruling",
      { result: id, evidence: evidenceRef.ref });
  }
  if (!principalsEqual(evidence.by, TEST_DISCIPLINE)) {
    throw fail("E_STEP6_EVIDENCE_BINDING",
      `result ${id}'s semantic evidence ${evidenceRef.ref} was not issued by the test discipline`,
      { result: id, evidence: evidenceRef.ref });
  }
  const bound = finding.binding.clauseRef;
  if (evidence.subjectRef !== bound) {
    throw fail("E_STEP6_EVIDENCE_BINDING",
      `result ${id}'s semantic evidence ${evidenceRef.ref} is about ${JSON.stringify(evidence.subjectRef)}, not the `
      + `ASSUM ${JSON.stringify(bound)} this finding binds`,
      { result: id, evidence: evidenceRef.ref });
  }
  // TP §6:786-790's equalities, over the ACTUAL entry and result rather than the caller's say-so.
  if (evidence.taskId !== ts.taskId) {
    throw fail("E_STEP6_EVIDENCE_BINDING",
      `result ${id}'s semantic evidence ${evidenceRef.ref} states taskId ${JSON.stringify(evidence.taskId)}, not this `
      + `task ${JSON.stringify(ts.taskId)}`,
      { result: id, evidence: evidenceRef.ref });
  }
  if (canonicalJson(evidence.testRef ?? null) !== canonicalJson(entry.testRef)) {
    throw fail("E_STEP6_EVIDENCE_BINDING",
      `result ${id}'s semantic evidence ${evidenceRef.ref} is about a different test`,
      { result: id, evidence: evidenceRef.ref });
  }
  if (evidence.findingKind !== "assum-reading-change") {
    throw fail("E_STEP6_EVIDENCE_BINDING",
      `result ${id}'s semantic evidence ${evidenceRef.ref} states findingKind ${JSON.stringify(evidence.findingKind)}`,
      { result: id, evidence: evidenceRef.ref });
  }
  if (canonicalJson(evidence.binding ?? null) !== canonicalJson(finding.binding)) {
    throw fail("E_STEP6_EVIDENCE_BINDING",
      `result ${id}'s semantic evidence ${evidenceRef.ref} records a different binding than the finding it resolves`,
      { result: id, evidence: evidenceRef.ref });
  }
  for (const [carried, observed] of [
    ["baseBodyDigest", "observedBaseBodyDigest"],
    ["headBodyDigest", "observedHeadBodyDigest"],
  ]) {
    if (evidence[carried] === undefined && result[observed] === undefined) continue;
    if (evidence[carried] !== result[observed]) {
      throw fail("E_STEP6_EVIDENCE_BINDING",
        `result ${id}'s semantic evidence ${evidenceRef.ref} states ${carried} ${JSON.stringify(evidence[carried])} `
        + `against the reviewed ${JSON.stringify(result[observed])}`,
        { result: id, evidence: evidenceRef.ref, side: carried });
    }
  }
}

// --- phase 6: historical convergence and outcome ----------------------------------------------------

async function loadBaseStore(context) {
  const { base } = context;
  const read = await readExactTreeBlob({
    repoRoot: context.repoRoot, treeOid: base.treeOid, path: base.storePath,
  });
  if (!read.present) {
    // The ONE canonical empty store. Only genuine absence reaches here: an unresolvable name, a
    // non-tree object, an ambiguous listing, a non-regular entry and every Git failure all threw.
    if (base.storeDigest !== storeDigest(emptyStore())) {
      throw fail("E_STEP6_BASE_STORE",
        `base tree ${base.treeOid} holds no ${base.storePath}, so the witness digest must be the canonical empty `
        + `store's; it states ${base.storeDigest}`,
        { treeOid: base.treeOid });
    }
    return { store: emptyStore(), present: false };
  }
  // RAW bytes before any decode. Normalising first would let a store whose bytes differ from the
  // witness pass by being cleaned up on the way in.
  if (read.rawDigest !== base.storeDigest) {
    throw fail("E_STEP6_BASE_STORE",
      `the base tree store's raw-byte digest ${read.rawDigest} does not equal the witness ${base.storeDigest}`,
      { treeOid: base.treeOid, actual: read.rawDigest });
  }
  const store = parseStore(read.rawBytes.toString("utf8"));
  if (store.provenanceVersion !== PROVENANCE_VERSION && store.provenanceVersion !== LEGACY_PROVENANCE_VERSION) {
    throw fail("E_STEP6_BASE_STORE",
      `the base tree store declares provenanceVersion ${JSON.stringify(store.provenanceVersion)}, which is not `
      + "analysable",
      { treeOid: base.treeOid });
  }
  // ONE entry point for both versions: validateHistoricalStore itself dispatches v1 to
  // validateHistoricalLegacyV1, so a caller-maintained version branch here would duplicate a decision
  // that module already owns. Clock-free by construction -- a historical store is judged on structure,
  // never against today's instant, so an exception that has since expired does not retroactively
  // invalidate history while every non-temporal rule still applies. No migration, no write-back.
  validateHistoricalStore(store);
  return { store, present: true };
}

function assertHistoricalChain(context, baseStore, transition, entry, id) {
  const byId = new Map((baseStore.transitions || []).map((t) => [t.id, t]));
  const historical = byId.get(transition.id);
  if (historical === undefined) {
    throw fail("E_STEP6_HISTORICAL_CHAIN",
      `historical-convergence cites transition ${transition.id}, which is not in the verified base store`,
      { result: id, transitionRef: transition.id });
  }
  // Membership by id AND payload: a same-id/different-payload transition is an INV-3 integrity
  // failure, not a historical variant of the same fact.
  if (canonicalJson(historical) !== canonicalJson(transition)) {
    throw fail("E_STEP6_HISTORICAL_CHAIN",
      `transition ${transition.id} has a different payload in the base store than in the current one`,
      { result: id, transitionRef: transition.id });
  }
  const preTag = clauseTagOf(entry.tagBefore);
  if (preTag === null || preTag.clauseRef !== transition.subject) {
    throw fail("E_STEP6_HISTORICAL_CHAIN",
      `historical-convergence requires the entry's pre-side tag to be the transition's subject `
      + `${JSON.stringify(transition.subject)}`,
      { result: id, transitionRef: transition.id });
  }
  // CLEANUP TERMINATES HERE. §6:803 scopes the whole-chain obligation to "T 以及用來對位 post binding
  // 的完整 successor chain" -- the chain USED to align the post binding -- and §6:795 makes an EXPL or
  // deleted post an allowed cleanup terminus, which aligns nothing. So there is no used chain, and no
  // onward transition is inspected: a later transition minted in C after B was captured is not part of
  // this proof and is not a reason to refuse.
  const post = clauseTagOf(entry.tagAfter);
  if (post === null) return;

  // A CLAUSE outcome. The proof is about the path the CURRENT store actually uses to reach the post
  // binding, checked against B -- not an unconditional traversal of B's onward links, which would
  // attest to some historical path rather than the one being relied on, and would let a first
  // historical match stand in for a current transition that has since changed.
  const baseTransitions = new Map((baseStore.transitions || []).map((t) => [t.id, t]));
  const baseClauses = new Map((baseStore.clauses || []).map((c) => [c.id, c]));
  const currentClauses = context.index.clauses;
  const seen = new Set([transition.id]);
  let cursor = transition.successor === undefined ? null : transition.successor;
  let used = transition;
  for (;;) {
    if (cursor === null || cursor === undefined) {
      throw fail("E_STEP6_HISTORICAL_CHAIN",
        `the current successor path from ${transition.id} ends without reaching ${post.clauseRef}`,
        { result: id, post: post.clauseRef });
    }
    // Each successor clause on the used path is compared by payload too: a same-id/different-payload
    // clause is an INV-3 integrity failure, not a historical variant of the same fact.
    const inBase = baseClauses.get(cursor);
    if (inBase === undefined) {
      throw fail("E_STEP6_HISTORICAL_CHAIN",
        `successor ${cursor}, used to reach the post binding, is not in the verified base store`,
        { result: id, link: cursor });
    }
    const live = currentClauses.get(cursor);
    if (live !== undefined && canonicalJson(inBase) !== canonicalJson(live)) {
      throw fail("E_STEP6_HISTORICAL_CHAIN",
        `clause ${cursor} has a different payload in the base store than in the current one`,
        { result: id, link: cursor });
    }
    if (cursor === post.clauseRef) return;           // the used path reached the post binding
    // Follow the CURRENT store's effective transition for this clause; B only ever checks it.
    used = effectiveTransition(context.index, cursor);
    if (!used) {
      throw fail("E_STEP6_HISTORICAL_CHAIN",
        `the current successor path stops at ${cursor} without reaching ${post.clauseRef}`,
        { result: id, link: cursor });
    }
    if (seen.has(used.id)) break;
    seen.add(used.id);
    const historicalUsed = baseTransitions.get(used.id);
    if (historicalUsed === undefined) {
      throw fail("E_STEP6_HISTORICAL_CHAIN",
        `transition ${used.id}, used by the current path to reach the post binding, is not in the verified base store`,
        { result: id, transitionRef: used.id });
    }
    if (canonicalJson(historicalUsed) !== canonicalJson(used)) {
      throw fail("E_STEP6_HISTORICAL_CHAIN",
        `transition ${used.id} has a different payload in the base store than in the current one, so the current `
        + "path is not the same historical fact",
        { result: id, transitionRef: used.id });
    }
    cursor = used.successor === undefined ? null : used.successor;
  }
  throw fail("E_STEP6_HISTORICAL_CHAIN",
    `the current successor path from ${transition.id} cycles without reaching ${post.clauseRef}`,
    { result: id, post: post.clauseRef });
}

function assertOutcome(context, transition, entry, id) {
  const post = clauseTagOf(entry.tagAfter);
  if (post === null) return;                     // EXPL or deleted: an independently valid cleanup end
  const successor = transition.successor === undefined ? null : transition.successor;
  if (successor === null) {
    throw fail("E_STEP6_OUTCOME",
      `result ${id} still binds ${post.clauseRef} while its transition retires the subject with no successor`,
      { result: id, transitionRef: transition.id });
  }
  const end = activeSuccessorChainEnd(context.index, successor);
  if (post.clauseRef !== successor && post.clauseRef !== end) {
    throw fail("E_STEP6_OUTCOME",
      `result ${id}'s post-side binding ${post.clauseRef} is neither the transition's successor ${successor} nor its `
      + `active successor chain end ${end}`,
      { result: id, transitionRef: transition.id });
  }
}

function assertResolution(context, result, entry, finding, id) {
  const { index } = context;
  const ref = finding.resolutionRef;
  if (ref === undefined) {
    throw fail("E_STEP6_UNRESOLVED_FINDING",
      `result ${id} carries an assum-reading-change finding with no resolutionRef, so this batch has not converged`,
      { result: id });
  }
  if (!ref || typeof ref !== "object" || Array.isArray(ref) || !RESOLUTION_KEYS[ref.mode]) {
    throw fail("E_STEP6_RESOLUTION_SHAPE",
      `result ${id}'s resolutionRef declares no known mode`, { result: id });
  }
  const wanted = RESOLUTION_KEYS[ref.mode];
  const keys = Object.keys(ref).sort();
  if (keys.length !== wanted.length || keys.some((k, i) => k !== wanted[i])) {
    throw fail("E_STEP6_RESOLUTION_SHAPE",
      `result ${id}'s ${ref.mode} resolutionRef must declare exactly ${JSON.stringify(wanted)}`,
      { result: id, keys });
  }
  if (finding.binding === undefined) {
    throw fail("E_STEP6_RESOLUTION_SHAPE",
      `result ${id} carries a resolutionRef but no finding binding`, { result: id });
  }
  // The binding is anchored to the ACTUAL pre-side tag, not to agreement between the caller's finding
  // and its own evidence. TP §2:227 builds the candidate set from entries whose tagBefore is ASSUM-x,
  // so an unrelated ASSUM cannot stand in for the affected one. Whole-tag equality also settles the
  // optional qualifier: a clause tag has exactly two shapes and an ASSUM tag can carry no dpRef, so an
  // invented qualifier is refused by the same comparison.
  const preTag = clauseTagOf(entry.tagBefore);
  if (preTag === null || canonicalJson(finding.binding) !== canonicalJson(preTag)) {
    throw fail("E_STEP6_FINDING_ASSOCIATION",
      `result ${id}'s assum-reading-change binding is not the entry's actual pre-side tag`,
      { result: id, binding: finding.binding, tagBefore: entry.tagBefore });
  }
  if (!isCanonicalClauseRef(preTag.clauseRef) || clauseKindOf(preTag.clauseRef) !== "ASSUM") {
    throw fail("E_STEP6_FINDING_ASSOCIATION",
      `result ${id} claims an assum-reading-change against ${JSON.stringify(preTag.clauseRef)}, which is not a `
      + "canonical ASSUM clause ref",
      { result: id });
  }
  const transition = index.transitions.get(ref.transitionRef);
  if (transition === undefined) {
    throw fail("E_STEP6_RESOLUTION_UNRESOLVABLE",
      `result ${id} cites transition ${JSON.stringify(ref.transitionRef)}, which is not in the current store`,
      { result: id });
  }
  if (transition.subject !== preTag.clauseRef) {
    throw fail("E_STEP6_RESOLUTION_SHAPE",
      `result ${id} resolves ${preTag.clauseRef} through a transition whose subject is `
      + `${JSON.stringify(transition.subject)}`,
      { result: id, transitionRef: transition.id });
  }
  if (ref.mode === "this-round") {
    assertThisRoundEvidence(context, result, finding, entry, ref.semanticEvidenceRef, id);
    assertAckCoverage(context, transition, ref.semanticEvidenceRef, id);
    assertOutcome(context, transition, entry, id);
    return;
  }
  // Historical-convergence charges its outcome INSIDE the chain walk, against links proved to be in
  // B. Running the ordinary outcome check as well would resolve the chain end in the current store and
  // hand this branch a shortcut through state that is not historical.
  assertHistoricalChain(context, context.baseStore.store, transition, entry, id);
}

// --- the operation ---------------------------------------------------------------------------------

/**
 * Verify the committed batch at a task's head.
 *
 * @param {{ repoRoot: string, taskId: string }} request exact key set; a snapshot, a store, a clock,
 *   a registry, a callback or a captured context cannot be supplied.
 * @returns {Promise<Readonly<object>>} a recursively frozen verdict. Refusals throw: this component's
 *   own judgments as CommittedBatchError with an E_STEP6_* code, and every upstream typed cause
 *   unchanged.
 */
export async function verifyCommittedBatch(request) {
  if (arguments.length !== 1) {
    throw fail("E_API_ARGUMENTS",
      "verifyCommittedBatch takes exactly one argument; a head-view snapshot, a store, a registry, a clock, an "
      + "explicit config, a filesystem, a Git executable or a capture hook cannot be supplied");
  }
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    throw fail("E_API_ARGUMENTS", "the verifyCommittedBatch request must be a JSON object");
  }
  // Own keys, not merely the enumerable string ones; symbols refused before the sort and the message.
  const ownKeys = Reflect.ownKeys(request);
  const symbolKeys = ownKeys.filter((key) => typeof key !== "string");
  if (symbolKeys.length > 0) {
    throw fail("E_API_ARGUMENTS",
      `the verifyCommittedBatch request carries symbol-keyed own properties `
      + `(${symbolKeys.map(String).join(", ")}); it must declare exactly ${JSON.stringify(REQUEST_KEYS)}`);
  }
  const keys = ownKeys.sort();
  if (keys.length !== REQUEST_KEYS.length || keys.some((k, i) => k !== REQUEST_KEYS[i])) {
    throw fail("E_API_ARGUMENTS",
      `the verifyCommittedBatch request must declare exactly ${JSON.stringify(REQUEST_KEYS)}; got `
      + `${JSON.stringify(keys)}`);
  }
  // ONE read of each owned value; the checks and every awaited stage below use the locals.
  const captured = {};
  for (const key of REQUEST_KEYS) captured[key] = request[key];
  for (const key of REQUEST_KEYS) {
    if (typeof captured[key] !== "string" || captured[key] === "") {
      throw fail("E_API_ARGUMENTS", `${key} must be a non-empty string`);
    }
  }
  const { repoRoot, taskId } = captured;

  // 1. authority, INCLUDING the historical witness. B is read, digest-checked against the witness,
  // parsed and validated for EVERY success -- not only when a historical-convergence claim happens to
  // need it. Making it conditional dropped the base verification the existing consumer already
  // performed unconditionally, so a batch could name a tree that does not exist, a symlink, a commit
  // or a store whose bytes do not match its witness, and still pass on a clean result.
  const authority = loadAuthority(repoRoot, taskId);
  const { batch, inventory, ts } = authority;
  const baseStore = await loadBaseStore({ ...authority, repoRoot });
  const baseIndex = indexStore(baseStore.store);

  // 2. one S3, one fresh registry
  const sources = await captureSources(repoRoot, inventory);
  const context = {
    ...authority, repoRoot, baseStore, baseIndex, searchView: sources.searchView,
  };

  // 3. coverage
  const paired = coverEntries(inventory, batch.batchSnapshot.results, batch.recordId);

  // 4. binding
  const observations = new Map();
  for (const { result, entry, id } of paired) {
    assertResultBinding(result, entry, id);
    assertEntryIdentity(entry, sources.registryRoot, id);
    assertPreBinding(baseIndex, entry.tagBefore, id);
    assertPostBinding(context, entry.tagAfter, id, observations);
  }

  // 5/6. findings, resolution mode, acknowledgement and outcome.
  let resolved = 0;
  for (const { result, entry, id } of paired) {
    for (const finding of result.findings) {
      if (GENERAL_FINDING_KINDS.includes(finding.kind)) {
        throw fail("E_STEP6_UNRESOLVED_FINDING",
          `result ${id} carries an unresolved ${finding.kind} finding; a fresh batch converges only with none of `
          + `${JSON.stringify(GENERAL_FINDING_KINDS)}`,
          { result: id, kind: finding.kind });
      }
      assertResolution(context, result, entry, finding, id);
      resolved += 1;
    }
  }

  // The shared code-point comparator, not `<`. JavaScript's relational operators compare UTF-16 code
  // UNITS, which orders every non-BMP character before U+E000-U+FFFF -- so a U+10000 source id sorted
  // ahead of a U+E000 one. Deduplicated by construction: one observation per Source.
  const sourceObservations = [...observations.entries()]
    .sort((a, b) => compareCodePoint(a[0], b[0]))
    .map(([sourceId, occurrenceCount]) => Object.freeze({
      sourceId, kind: "ambiguous-source-occurrence", occurrenceCount,
    }));

  return Object.freeze({
    converged: true,
    taskId: ts.taskId,
    // The TYPED head ref, frozen with the verdict, so a later integration can bind this result to the
    // exact committed record rather than to a bare string.
    committedBatchRef: Object.freeze({ kind: "provenance-batch", ref: batch.recordId }),
    batchDigest: batch.batchDigest,
    inventoryDigest: inventory.inventoryDigest,
    baseTreeOid: authority.base.treeOid,
    // ACTUAL metadata about work that was really performed. B is now read on every success, so these
    // describe the base store rather than encoding "this was not done" into a field that means
    // something else: absent B is false/null, present B reports its own declared version.
    historicalVersion: baseStore.present ? baseStore.store.provenanceVersion : null,
    priorStateExists: baseStore.present,
    entryCount: inventory.entries.length,
    headViewDigest: sources.headViewDigest,
    registryDigest: sources.registryDigest,
    resolvedFindingCount: resolved,
    sourceObservations: Object.freeze(sourceObservations),
  });
}
