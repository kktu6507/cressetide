// The ONE internal implementation of TP approved v1.17 §11b.10c's two logical operations.
//
// WHY ONE MODULE. Both operations need the same ordering -- G1, then T0, then (producer only) task
// resolution, then the lifecycle seed, then everything G1-dependent, and only after the LAST use of
// G1 does G2 run. v1.16's implementation shared that ordering through an EXPORTED
// runWithGovernanceContext(request, …, work) that handed { base, current, taskState, t0, snapshot,
// lifecycleAffectedClauses } to a caller-supplied callback. §11b.10c forbids exactly that: it is a
// new public operation and a ready-made test seam in one. So the shared core lives here, the
// continuation is INTERNAL, and the two public facades re-export only their operation and their
// error class.
//
// EXPORT BOUNDARY (AC176 (9b)/(9b-layout)): this module exports the two operations and the two error
// classes and nothing else. No context, no callback, no capture hook, no clock, no store, no
// snapshot, no seed. The facades export the same and nothing else.
//
// SCOPE. These produce an in-memory GovernanceSeedPreimage and an in-memory ChangedTestInventoryV2.
// Nothing here writes the store, the explicit config, the registry or .ctide/output/**;
// AC118/AC136/AC137/AC138 are not established by this module and Phase 2 stays not READY.
//
// STATUS, corrected rather than left standing. This comment used to add that "the product entry point
// goes on refusing every populated v2 envelope, including one this module just produced", which
// AC173 (j) required alongside production. That was true of the unsupported-populated-inventory gate,
// and that gate is retired: parseInventory now returns the canonical v2 result for empty AND
// populated envelopes and refuses v1 ones instead. Writing the produced envelope to
// .ctide/output/** is a separate operation (changed-test-inventory-artifact.mjs), and it is still
// not this one -- the producer's own no-write boundary is unchanged.
import crypto from "node:crypto";
import path from "node:path";

import {
  CANONICAL_STORE_PATH, PROVENANCE_VERSION, LEGACY_PROVENANCE_VERSION,
  emptyStore, storeDigest, parseStore, canonicalJson, canonicalText,
  compareCodePoint, sha256Hex, validateAll, validateStoreSchema, validateHistoricalStore,
  parseCanonicalExpiry, isCanonicalClauseRef, indexStore, statusOf, applicable,
  checkSourceIntegrity, basisRefsResolvable, isReviewerPrincipal,
} from "./provenance-store.mjs";
import { withStableHeadView } from "./head-view-snapshot.mjs";
// The fixed internal store-loader import AC171 (vii)'s shape-B proxy points at. One import, one
// call site, one read per capture -- see current-store-load.mjs for why it is its own module.
import { readCurrentStoreFile } from "./current-store-load.mjs";
// The accepted hardened object-database reader, shared rather than re-implemented. Raw execFile
// here was a real defect, not a style point: without --no-replace-objects a replacement ref makes
// "read tree A" return tree B end to end, so the exact-tree witness this component is built on
// would have been whatever refs/replace currently points at. The exact-tree regular-blob read built
// on it is now one module, shared with the Step 6 consumer; only bytes and scalars cross that
// boundary, never a captured context.
import { readExactTreeBlob, ExactTreeBlobError } from "./exact-tree-blob.mjs";
// shared §9's Check B byte rule, search face and occurrence count -- one definition, used here and
// by the Step 6 consumer over its own captured S3.
import { buildSearchView, checkSourceOccurrence } from "./source-occurrence.mjs";
import {
  checkProducerRequest, checkSeedRequest, ProducerRequestError,
} from "./producer-request.mjs";
import { computeInventoryV2Digest, V2_INVENTORY_KEYS } from "./changed-test-inventory.mjs";
import { buildDiscoveryAnalysisPreimage } from "./adapter-discovery-preimage.mjs";
import { matchBaseHeadDeclarations } from "./base-head-declaration-matcher.mjs";

export class GovernanceSeedPreimageError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = "GovernanceSeedPreimageError";
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

export class InventoryProducerError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = "InventoryProducerError";
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

// Which error type a failure wears depends on which operation the caller invoked, so the failure
// surface of each facade is unchanged by the move into this module.
const SEED = "buildGovernanceSeedPreimage";
const PRODUCER = "produceChangedTestInventoryV2";
const failFor = (operation) => (code, message, detail) => (operation === PRODUCER
  ? new InventoryProducerError(code, message, detail)
  : new GovernanceSeedPreimageError(code, message, detail));

const IMMUTABLE_SECTIONS = ["sources", "clauses", "transitions", "records"];
const ID_KEY = { sources: "sourceId", clauses: "id", transitions: "id", records: "recordId" };

const INVENTORY_VERSION = 2;
const CONTENT_CHANGE = "content-change";
const GOVERNANCE_AFFECTED = "governance-affected";

// --- request ---------------------------------------------------------------------------------

function requireRequest(request, argumentCount, operation) {
  const fail = failFor(operation);
  try {
    const checked = operation === PRODUCER
      ? checkProducerRequest(request, argumentCount, operation)
      : checkSeedRequest(request, argumentCount, operation);
    return { ...checked, repoRoot: path.resolve(checked.repoRoot) };
  } catch (error) {
    if (error instanceof ProducerRequestError) throw fail(error.code, error.message, error.detail);
    throw error;
  }
}

// --- stores ----------------------------------------------------------------------------------

// The one canonical empty store, taken from shared §2 through provenance-store rather than
// re-spelled here: a second literal would be a second authority for what "empty" means.
const EMPTY = () => emptyStore();
const EMPTY_DIGEST = () => storeDigest(emptyStore());

// The RAW digest -- sha256 over the bytes as they stand. Deliberately not sha256Hex(), which
// canonicalises its input first: that is the current store's CAS notation, and shared §9 requires
// the historical base witness to be verified against the file's ORIGINAL bytes. Confusing the two
// makes every base store with a BOM or CRLF permanently mismatch, and the failure looks like a race
// rather than a notation error.
const rawSha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

// One capture = one read. The parsed store, its canonical digest and (for G1) the seed derivation
// all come from THIS object; nothing re-reads the file between them.
function captureCurrentStore(repoRoot, label, operation) {
  const fail = failFor(operation);
  const text = readCurrentStoreFile(repoRoot);
  if (text === null) {
    // Absence is not a signal of its own: it maps onto the canonical empty v2 store, and its digest
    // is that store's digest -- not null, not the empty string.
    return { present: false, store: EMPTY(), digest: EMPTY_DIGEST() };
  }
  let store;
  // PARSE AND VALIDATION ERRORS PASS THROUGH UNCHANGED. §11b.10c's layer-1 rule is explicit: the
  // upstream authoritative code AND cause are preserved as they stand, because that layer is where
  // the refusal belongs and its detail (the offending clause, source or DP id) is the whole
  // diagnosis. The previous wrapper flattened E_DANGLING_REF into
  // E_CURRENT_STORE_SCHEMA + { cause: "E_DANGLING_REF" }, which loses the subject and re-labels an
  // authoritative refusal as this component's own.
  store = parseStore(text);
  if (store.provenanceVersion === LEGACY_PROVENANCE_VERSION) {
    throw fail("E_CURRENT_STORE_VERSION",
      `${label}: the current store is provenanceVersion ${LEGACY_PROVENANCE_VERSION}. It must go `
      + "through the existing migration transaction first; this producer does not migrate and does "
      + "not write back",
      { label, provenanceVersion: store.provenanceVersion });
  }
  if (store.provenanceVersion !== PROVENANCE_VERSION) {
    throw fail("E_CURRENT_STORE_VERSION",
      `${label}: the current store declares provenanceVersion ${JSON.stringify(store.provenanceVersion)}; `
      + `only ${PROVENANCE_VERSION} is a current store`,
      { label, provenanceVersion: store.provenanceVersion });
  }
  // Authoritative schema validation, and it reads no clock. Doing it HERE is what lets T0 be
  // sampled after "G1 parse/schema validation" and before the first time-dependent decision, per
  // §11b.10c step 4 -- rather than after a validateAll() that would already have needed a clock.
  // It covers the WHOLE store, taskStates included: this operation does not SELECT a task, which is
  // a different thing from not validating one. Its errors are re-thrown as they are, per above.
  validateStoreSchema(store);

  // THE CURRENT-STORE CAS DIGEST IS OVER THE CAPTURED TEXT, not over a re-serialisation of the
  // parsed object. §11b.9c fixes it as sha256(canonicalText(file text)) -- canonicalText strips a
  // leading BOM and maps CRLF/CR to LF and does nothing else -- and that is the value Step 5's CAS
  // compares against. Hashing canonicalStoreBytes(store) instead re-sorts keys and re-indents, so a
  // pretty-printed store reported the canonical-serialisation digest of a DIFFERENT byte sequence:
  // a formatting-only change between G1 and G2 became invisible, and the emitted
  // inputProvenanceStoreDigest did not match the file it names. sha256Hex() already applies
  // canonicalText, and this is the SAME text the parse above used -- there is no second read.
  return { present: true, store, digest: sha256Hex(text) };
}

// B comes from the exact tree named in the request and from nowhere else. Reading the live current
// store as a stand-in would compare the run against itself and make lifecycleAffectedClauses
// permanently empty -- which is why this never touches the working tree.
//
// This half takes the RAW bytes and stops. Parsing, the version dispatch and the historical
// validation all happen later, because the producer must settle the base witness against the bytes
// it actually captured BEFORE B is allowed to drive any historical existence, closure or binding
// decision.
async function captureBaseRaw(repoRoot, baseTreeOid, operation) {
  const fail = failFor(operation);
  // The hardened exact-tree read now lives in ONE module, shared with the Step 6 consumer: the
  // controlled environment (replacement and lazy fetch closed in both spellings), the object's own
  // type, the ambiguous-listing refusal and the regular-blob MODE check are all charged there. What
  // stays here is everything store-specific -- this operation's error identity, and the mapping of
  // absence onto shared §9's one canonical empty store.
  //
  // Every code, message and detail this function raised before the extraction is reproduced below,
  // so nothing a caller of either facade can observe has changed.
  let read;
  try {
    read = await readExactTreeBlob({ repoRoot, treeOid: baseTreeOid, path: CANONICAL_STORE_PATH });
  } catch (error) {
    if (!(error instanceof ExactTreeBlobError)) throw error;
    if (error.code === "E_GIT_FAILED") throw fail("E_GIT_FAILED", error.message, error.detail);
    if (error.code === "E_TREE_OID") {
      const detail = error.detail || {};
      throw detail.type === undefined
        ? fail("E_BASE_TREE_OID", `baseTreeOid ${baseTreeOid} is not an object in this repository`,
          { baseTreeOid, cause: detail.cause })
        : fail("E_BASE_TREE_OID",
          `baseTreeOid ${baseTreeOid} is a ${detail.type}, not a tree; an object that merely PEELS to a tree is not the tree`,
          { baseTreeOid, type: detail.type });
    }
    if (error.code === "E_TREE_ENTRY_KIND") {
      const { mode, objectType } = error.detail || {};
      throw fail("E_BASE_STORE_ENTRY",
        `${CANONICAL_STORE_PATH} in tree ${baseTreeOid} is mode ${mode} (${objectType}); only a regular blob is a base store`,
        { mode, objectType });
    }
    if (error.code === "E_GIT_OUTPUT") throw fail("E_GIT_OUTPUT", "an ls-tree record carries no tab separator");
    throw fail(error.code, error.message, error.detail);
  }
  if (!read.present) {
    // Absent B: shared §9's one canonical empty store, and the witness digest is that store's
    // canonical digest -- the single defined value for "no store in that tree".
    return { present: false, rawBytes: null, rawDigest: EMPTY_DIGEST() };
  }
  // The raw digest comes from the shared reader, so both callers hash the captured bytes in ONE
  // notation. `rawSha256` below is retained for the same reason it always existed: naming why this
  // is not the store's canonicalising sha256Hex.
  return { present: true, rawBytes: read.rawBytes, rawDigest: read.rawDigest };
}

// Parse, dispatch the historical version, and validate -- in that order, and only after the caller
// has settled whatever witness it is able to settle.
function decodeBaseStore(raw, baseTreeOid, operation) {
  const fail = failFor(operation);
  if (!raw.present) return EMPTY();
  let store;
  try {
    store = parseStore(raw.rawBytes.toString("utf8"));
  } catch (error) {
    throw fail("E_BASE_STORE_SCHEMA",
      `the base governance state in tree ${baseTreeOid} is not readable as a store (${error && error.message})`,
      { baseTreeOid, cause: error && error.code });
  }
  // Historical, immutable, read-only: 1 and 2 are both analysable here. The migration-only
  // restriction belongs to the CURRENT mutable store and must not be pushed onto a base tree.
  if (store.provenanceVersion !== PROVENANCE_VERSION && store.provenanceVersion !== LEGACY_PROVENANCE_VERSION) {
    throw fail("E_BASE_STORE_VERSION",
      `the base store declares provenanceVersion ${JSON.stringify(store.provenanceVersion)}, which is not analysable`,
      { provenanceVersion: store.provenanceVersion });
  }
  // §11b.10c step 6b. The historical pass, not validateAll(now) and not validateStoreSchema():
  // every non-temporal rule of THIS store's own version is charged, and only the comparison against
  // the current instant is left unevaluated. No migration, no normalisation, no write-back.
  try {
    validateHistoricalStore(store);
  } catch (error) {
    throw fail("E_BASE_STORE_INVALID",
      `the base governance state in tree ${baseTreeOid} is not a valid store for its own version `
      + `(${error && error.message}); the historical read excludes only evaluation against the current `
      + "instant, never the non-temporal rules",
      { baseTreeOid, cause: error && error.code });
  }
  return store;
}

// --- task resolution and the base witness (producer only) --------------------------------------

// TP approved v1.16: taskId resolves against the SAME parsed G1, never a second read. A store may
// hold several TaskStates, so "the current task" is a fact the caller states and this function
// checks -- it is never inferred from DPs, the head view or any heuristic.
function resolveTaskState(store, taskId, baseTreeOid, operation) {
  const fail = failFor(operation);
  const matches = (store.taskStates || []).filter((t) => t.taskId === taskId);
  if (matches.length === 0) {
    throw fail("E_UNKNOWN_TASK",
      `taskId ${JSON.stringify(taskId)} names no TaskState in the current store; §7 resolves REQ@DP against that task's currentTaskDpIds, so an unknown task is fail-closed rather than guessed`,
      { taskId });
  }
  if (matches.length > 1) {
    throw fail("E_AMBIGUOUS_TASK",
      `taskId ${JSON.stringify(taskId)} matches ${matches.length} TaskStates; the store is internally inconsistent and no task may be chosen from among them`,
      { taskId, matches: matches.length });
  }
  const [taskState] = matches;
  const witness = taskState.baseProvenance && taskState.baseProvenance.treeOid;
  if (witness !== baseTreeOid) {
    throw fail("E_TASK_BASE_MISMATCH",
      `task ${taskId} records baseProvenance.treeOid ${JSON.stringify(witness)} but the request names ${JSON.stringify(baseTreeOid)}; neither side is preferred and the run stops`,
      { taskId, taskState: witness, request: baseTreeOid });
  }
  return taskState;
}

// shared §9's base provenance witness, charged where it can actually be charged: the PRODUCER has a
// selected TaskState, so it has the storePath/treeOid/storeDigest triple to compare against the
// bytes it captured. buildGovernanceSeedPreimage() has neither a taskId nor a witness and does not
// invent one -- it takes B from the content-addressed tree, which is self-witnessing for identity
// but says nothing about which task agreed to that base.
//
// The digest compared here is the RAW one. shared §9's historical-read rule is explicit that the
// raw bytes are what the witness attests to, and that normalised bytes must never be compared
// against a raw digest.
function assertBaseWitness(taskState, raw, taskId) {
  const fail = failFor(PRODUCER);
  const witness = taskState.baseProvenance || {};
  if (witness.storePath !== CANONICAL_STORE_PATH) {
    throw fail("E_BASE_WITNESS",
      `task ${taskId} records baseProvenance.storePath ${JSON.stringify(witness.storePath)}, but the base store is read from the runtime contract's canonical path ${CANONICAL_STORE_PATH}; a witness that names another file is not a witness for this one`,
      { taskId, storePath: witness.storePath, expected: CANONICAL_STORE_PATH });
  }
  if (witness.storeDigest !== raw.rawDigest) {
    throw fail("E_BASE_WITNESS",
      `task ${taskId} records baseProvenance.storeDigest ${JSON.stringify(witness.storeDigest)} but the base store captured from that tree hashes to ${raw.rawDigest}`
      + `${raw.present ? "" : " (the tree carries no store, so the canonical empty-store digest is the one defined value)"}; `
      + "the witness is verified against the file's ORIGINAL bytes before B decides anything",
      { taskId, witness: witness.storeDigest, captured: raw.rawDigest, present: raw.present });
  }
}

// --- cross-snapshot immutability ---------------------------------------------------------------

function typedIndex(store, side, operation) {
  const fail = failFor(operation);
  const map = new Map();
  for (const section of IMMUTABLE_SECTIONS) {
    for (const item of store[section] || []) {
      const id = item[ID_KEY[section]];
      const typed = `${section}:${id}`;
      if (map.has(typed)) {
        throw fail("E_DUPLICATE_TYPED_ID", `${side} carries ${typed} twice`, { side, typed });
      }
      map.set(typed, canonicalJson(item));
    }
  }
  return map;
}

// Typed-ID set difference plus a shared-ID exact-equality assertion, which shared v1.15 §9 names as
// the ONE algorithm. Same id with a different payload violates INV-3, so it is an integrity failure
// and never a lifecycle seed -- a legitimate semantic update is always a NEW Clause.
function assertCrossSnapshotImmutability(base, current, operation) {
  const fail = failFor(operation);
  const b = typedIndex(base, "the base store", operation);
  const c = typedIndex(current, "the current store", operation);
  for (const [typed, payload] of b) {
    const here = c.get(typed);
    if (here === undefined) {
      throw fail("E_BASE_OBJECT_MISSING",
        `${typed} exists in the base store but not in the current store; immutable objects are append-only (INV-3), so this is an integrity failure, not a lifecycle seed`,
        { typed });
    }
    if (here !== payload) {
      throw fail("E_IMMUTABLE_DIVERGED",
        `${typed} has a different payload in the base and current stores; same id with different bytes violates INV-3, so this is an integrity failure, not a lifecycle seed`,
        { typed });
    }
  }
  return { b, c };
}

// --- Check B: the ONE per-Source search, used by drift and by ob-5 -------------------------------
//
// The byte rule, the search face of H and the occurrence count now live in source-occurrence.mjs so
// the Step 6 consumer charges the SAME Check B over its own captured S3. Only buffers and a data
// verdict cross that boundary; this operation keeps its own error identity below.

// The ONE per-Source Check B, shared by driftedClauses and by post-binding ob-5 so the two can never
// answer differently about the same Source and the same H. Returns true for drift (zero
// occurrence); one is not drift even when the locator points elsewhere, and two or more is an
// anchor-ambiguity observation and explicitly not drift. The shared predicate answers with DATA; the
// two unanalysable cases keep this operation's own code, message and detail exactly as before.
function sourceDrifts(source, view, operation) {
  const fail = failFor(operation);
  const verdict = checkSourceOccurrence(source, view);
  if (!verdict.analysable) {
    if (verdict.reason === "no-string-excerpt") {
      throw fail("E_SOURCE_UNANALYSABLE",
        `source ${source.sourceId} has no string excerpt, so Check B cannot be evaluated; this fails closed rather than defaulting to not-drift`,
        { source: source.sourceId });
    }
    throw fail("E_SOURCE_UNANALYSABLE",
      `source ${source.sourceId} has an empty canonical excerpt, so an occurrence count is meaningless; this fails closed`,
      { source: source.sourceId });
  }
  return verdict.drifts;                                   // snapshot-only reports applicable:false
}

// --- the four sets -----------------------------------------------------------------------------

const clauseIds = (store) => (store.clauses || []).map((c) => c.id);

function semanticallyChangedClauses(base, current) {
  const before = new Set(clauseIds(base));
  return clauseIds(current).filter((id) => !before.has(id));
}

function transitionedClauses(base, current, operation) {
  const fail = failFor(operation);
  const beforeIds = new Set((base.transitions || []).map((t) => t.id));
  const fresh = (current.transitions || []).filter((t) => !beforeIds.has(t.id));
  const clauses = new Set(clauseIds(current));
  const effective = new Map();
  const out = [];
  for (const t of fresh) {
    if (!t.subject || !clauses.has(t.subject)) {
      throw fail("E_TRANSITION_DANGLING",
        `transition ${t.id} names subject ${JSON.stringify(t.subject)}, which is not a clause in the current store`,
        { transition: t.id, subject: t.subject });
    }
    if (effective.has(t.subject)) {
      throw fail("E_TRANSITION_DUPLICATE",
        `clause ${t.subject} has more than one newly effective transition (${effective.get(t.subject)} and ${t.id}); at most one is allowed`,
        { subject: t.subject });
    }
    effective.set(t.subject, t.id);
    out.push(t.subject);
  }
  // The successor is deliberately NOT added: a successor that is a new Clause is already carried by
  // semanticallyChangedClauses, and adding it here would be transitive guessing.
  return out;
}

// The direct Source set, exact and NOT recursive: a REQ's sourceRef, and for DEC/ASSUM only those
// basisRefs members whose discriminated union says Source. RecordRefs, ObservationalRefs, DPs,
// transitions and free text are never followed.
function directSourceRefs(clause) {
  if (clause.id.startsWith("REQ-")) return clause.sourceRef ? [clause.sourceRef] : [];
  const refs = [];
  for (const basis of clause.basisRefs || []) {
    // IS §4: a Source basis is a PLAIN "S-…" string. A free-form string that is not a source id is
    // an ObservationalRef and is not followed; an object is a RecordRef or a typed ObservationalRef
    // and is not followed either.
    if (typeof basis === "string" && basis.startsWith("S-")) refs.push(basis);
  }
  return refs;
}

function driftedClauses(current, view, operation) {
  const fail = failFor(operation);
  const sources = new Map((current.sources || []).map((s) => [s.sourceId, s]));
  const out = [];
  for (const clause of current.clauses || []) {
    let drifted = false;
    for (const ref of directSourceRefs(clause)) {
      const source = sources.get(ref);
      if (source === undefined) {
        throw fail("E_SOURCE_DANGLING",
          `clause ${clause.id} names source ${JSON.stringify(ref)}, which is not in the current store`,
          { clause: clause.id, source: ref });
      }
      if (sourceDrifts(source, view, operation)) drifted = true;
    }
    if (drifted) out.push(clause.id);
  }
  return out;
}

function expiredClauses(current, t0, operation) {
  const fail = failFor(operation);
  const sources = new Map((current.sources || []).map((s) => [s.sourceId, s]));
  const out = [];
  for (const clause of current.clauses || []) {
    if (!clause.id.startsWith("REQ-")) continue; // a DEC/ASSUM never expires through its basisRefs
    const source = sources.get(clause.sourceRef);
    if (source === undefined || source.contentKind !== "exception-grant") continue;
    // The exact grammar from shared v1.15 §2, through the one authority. A legacy Date.parse
    // reading is not the v1.15 authority and is never consulted here.
    const at = parseCanonicalExpiry(source.expiry);
    if (at === null) {
      throw fail("E_EXPIRY_GRAMMAR",
        `source ${source.sourceId} has a non-canonical expiry ${JSON.stringify(source.expiry)}; a malformed chain is a validation failure, not a membership answer`,
        { source: source.sourceId });
    }
    if (at <= t0) out.push(clause.id); // equality counts as expired
  }
  return out;
}

function canonicalUnion(operation, ...sets) {
  const fail = failFor(operation);
  const seen = new Set();
  for (const set of sets) for (const id of set) seen.add(id);
  const out = [...seen];
  for (const id of out) {
    // Defence in depth ONLY, through the upstream authority -- never a second grammar of this
    // component's own, and never the layer this relies on.
    if (!isCanonicalClauseRef(id)) {
      throw fail("E_CLAUSE_REF_GRAMMAR",
        `${JSON.stringify(id)} reached the carrier without being a canonical ClauseRef; store schema validation should already have refused it`,
        { clauseRef: id });
    }
  }
  out.sort(compareCodePoint);
  return out;
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return value;
}

// --- the shared orchestration (module-private; the continuation is internal) ----------------------

// §11b.10c's exact order, once, for both operations:
//   1 G1 fresh-load + parse + clock-free schema validation
//   2 T0, sampled exactly once
//   3 task resolution + base witness            (producer only)
//   4 lifecycle seed derivation
//   5..6 everything else G1-dependent           (producer only, through `continuation`)
//   7 G2, after the LAST use of G1, before anything is returned
//
// `continuation` is not a caller entry point: it is supplied by produceChangedTestInventoryV2()
// inside this module and can never be reached from outside it.
async function runGovernance(request, argumentCount, operation, continuation) {
  const fail = failFor(operation);
  const producing = operation === PRODUCER;
  const { repoRoot, baseTreeOid, taskId } = requireRequest(request, argumentCount, operation);

  // Raw B first, and nothing decided from it yet.
  const raw = await captureBaseRaw(repoRoot, baseTreeOid, operation);

  const stable = await withStableHeadView({
    repoRoot,
    evaluate: async (snapshot) => {
      const g1 = captureCurrentStore(repoRoot, "G1", operation);
      const t0 = Date.now();

      if (g1.present) validateAll(g1.store, { now: t0 });

      // The producer -- and only the producer -- has a task, so only the producer has a witness to
      // compare. Both happen BEFORE B is decoded, so no historical fact is used before the witness
      // that vouches for it has been settled.
      const taskState = producing ? resolveTaskState(g1.store, taskId, baseTreeOid, operation) : null;
      if (producing) assertBaseWitness(taskState, raw, taskId);

      const base = decodeBaseStore(raw, baseTreeOid, operation);
      assertCrossSnapshotImmutability(base, g1.store, operation);

      const view = buildSearchView(snapshot);
      const seed = {
        semantic: semanticallyChangedClauses(base, g1.store),
        transitioned: transitionedClauses(base, g1.store, operation),
        drifted: driftedClauses(g1.store, view, operation),
        expired: expiredClauses(g1.store, t0, operation),
      };
      const lifecycleAffectedClauses = canonicalUnion(
        operation, seed.semantic, seed.transitioned, seed.drifted, seed.expired,
      );

      // Everything the caller needs G1 for happens HERE, before G2 is taken.
      const value = continuation === undefined ? undefined : await continuation({
        base, current: g1.store, taskState, t0, snapshot, view, seed, lifecycleAffectedClauses,
      });

      // G2: after the last use of G1, before anything is returned. Same version and clock-free
      // schema rules as G1, then the full time-dependent validation under the SAME T0, and only
      // then the digest comparison -- a malformed G2 must not be reported as "the store moved".
      const g2 = captureCurrentStore(repoRoot, "G2", operation);
      if (g2.present) validateAll(g2.store, { now: t0 });
      if (g2.digest !== g1.digest) {
        throw fail("E_STORE_MOVED",
          `the current provenance store changed while the governance seed was being derived (G1 ${g1.digest}, G2 ${g2.digest}); no carrier is produced`,
          { g1: g1.digest, g2: g2.digest });
      }
      return { inputProvenanceStoreDigest: g1.digest, lifecycleAffectedClauses, value };
    },
  });

  return {
    carrier: deepFreeze({
      baseTreeOid,
      headViewDigest: stable.snapshot.headViewDigest,
      inputProvenanceStoreDigest: stable.value.inputProvenanceStoreDigest,
      lifecycleAffectedClauses: stable.value.lifecycleAffectedClauses,
    }),
    value: stable.value.value,
  };
}

// --- binding semantic validation (§11b.10c v1.17) --------------------------------------------------
//
// Nothing here re-defines a judgement. shared approved v1.15 §9's two-phase table and this
// document's §7 own the rules; this decides only WHO validates, against WHICH snapshot, and under
// WHICH T0 -- and, for the ten obligations, which single lifecycle witness may excuse which one.

const failBinding = failFor(PRODUCER);
const clauseOf = (store, ref) => (store.clauses || []).find((c) => c.id === ref);
const sourceOf = (store, ref) => (store.sources || []).find((x) => x.sourceId === ref);

const testRefOf = (locator) => ({
  path: locator.path, adapterId: locator.adapterId, structuralId: locator.structuralId,
});

// Every reachable binding failure names the test, the binding, the side and WHICH obligation.
// "the binding is invalid" is not an acceptable message.
function bindingFailure(code, obligation, side, locator, tag, what, detail) {
  const testRef = testRefOf(locator);
  return failBinding(code,
    `${testRef.path} [${testRef.structuralId}]: the ${side}-side binding ${canonicalJson(tag)} fails ${obligation} -- ${what}`,
    { testRef, side, binding: tag, obligation, ...detail });
}

// A pre-state is a historical fact. shared §9's preChangeBinding row asks only that the clause and
// its direct Sources resolve in B and that Check A holds -- NOT active, NOT mechanicallyApplicable,
// NOT Check B, NOT expiry. Charging current effectivity here would block the repair the model
// exists to encourage; current effectivity decides governanceHit and nothing else.
function assertPreBinding(base, tag, locator) {
  if (tag === null || typeof tag !== "object" || typeof tag.clauseRef !== "string") return; // null / EXPL
  const clause = clauseOf(base, tag.clauseRef);
  if (clause === undefined) {
    throw bindingFailure("E_BASE_BINDING_UNRESOLVED", "pre-binding clause resolution", "base", locator, tag,
      `clause ${tag.clauseRef} does not resolve in the base-tree store`, { clauseRef: tag.clauseRef });
  }
  for (const ref of directSourceRefs(clause)) {
    const source = sourceOf(base, ref);
    if (source === undefined) {
      throw bindingFailure("E_BASE_BINDING_UNRESOLVED", "pre-binding Source resolution", "base", locator, tag,
        `base clause ${clause.id} names source ${JSON.stringify(ref)}, which does not resolve in the base-tree store`,
        { clauseRef: clause.id, sourceRef: ref });
    }
    const integrity = checkSourceIntegrity(source);
    if (!integrity.ok) {
      throw bindingFailure("E_BASE_BINDING_INTEGRITY", "pre-binding Check A", "base", locator, tag,
        `base source ${source.sourceId} fails Check A (${integrity.reason})`,
        { clauseRef: clause.id, sourceRef: source.sourceId, reason: integrity.reason });
    }
  }
}

// The ten indivisible postChangeBinding obligations, charged individually against the SAME parsed
// G1, the SAME H and the SAME T0 -- and each excused, if at all, only by ITS OWN witness.
//
// mechanicallyApplicable() is deliberately NOT called wholesale here. It returns not-active first,
// so an ob-3 exemption would still be blocked by it; and for DEC/ASSUM it carries no Source check at
// all, so calling it would silently omit ob-4/ob-5 for exactly those clauses. The per-kind meaning
// is preserved by reusing the same authority primitives it uses.
function assertPostBinding(ctx, index, tag, locator) {
  if (tag === null || typeof tag !== "object" || typeof tag.clauseRef !== "string") return; // EXPL
  const current = ctx.current;
  const clauseRef = tag.clauseRef;

  // ob-1 -- never exemptible.
  const clause = clauseOf(current, clauseRef);
  if (clause === undefined) {
    throw bindingFailure("E_HEAD_BINDING_UNRESOLVED", "ob-1", "head", locator, tag,
      `clause ${clauseRef} does not resolve in the current store`, { clauseRef });
  }
  const witness = {
    1: ctx.seed.transitioned.includes(clauseRef),   // ob-3 only
    2: ctx.seed.drifted.includes(clauseRef),        // ob-5 only
    3: ctx.seed.expired.includes(clauseRef),        // ob-8 only
  };

  // ob-2 -- never exemptible. Quantified over the WHOLE direct Source set, per kind.
  const refs = directSourceRefs(clause);
  const sources = [];
  for (const ref of refs) {
    const source = sourceOf(current, ref);
    if (source === undefined) {
      throw bindingFailure("E_HEAD_BINDING_SOURCE_UNRESOLVED", "ob-2", "head", locator, tag,
        `clause ${clause.id} names source ${JSON.stringify(ref)}, which does not resolve in the current store`,
        { clauseRef: clause.id, sourceRef: ref });
    }
    sources.push(source);
  }

  // ob-3 -- exemptible by witness-1 (transitionedClauses) and by nothing else. A clause retired
  // ALREADY IN B is not this run's governance event: it carries no new effective transition, so it
  // is not in transitionedClauses and this stays fail-closed.
  if (statusOf(index, clause.id) !== "active" && !witness[1]) {
    throw bindingFailure("E_HEAD_BINDING_INACTIVE", "ob-3", "head", locator, tag,
      `clause ${clause.id} is not active in the current store and is not in transitionedClauses`,
      { clauseRef: clause.id });
  }

  // ob-4 -- never exemptible, per member. No lifecycle set corresponds to snapshot integrity:
  // drift is Check B, and a clause that drifted does not thereby get to fail Check A.
  for (const source of sources) {
    const integrity = checkSourceIntegrity(source);
    if (!integrity.ok) {
      throw bindingFailure("E_HEAD_BINDING_CHECK_A", "ob-4", "head", locator, tag,
        `source ${source.sourceId} fails Check A (${integrity.reason})`,
        { clauseRef: clause.id, sourceRef: source.sourceId, reason: integrity.reason });
    }
  }

  // ob-5 -- exemptible by witness-2 (driftedClauses) and by nothing else. Evaluated EXPLICITLY
  // against H, per repo-file member, through the same private routine the seed used: applicable()
  // cannot carry this, because it never sees H.
  for (const source of sources) {
    if (!sourceDrifts(source, ctx.view, PRODUCER)) continue;
    if (witness[2]) continue;
    throw bindingFailure("E_HEAD_BINDING_CHECK_B", "ob-5", "head", locator, tag,
      `source ${source.sourceId} has zero occurrences in the head view (Check B drift) and ${clause.id} is not in driftedClauses`,
      { clauseRef: clause.id, sourceRef: source.sourceId });
  }

  // ob-6 / ob-6b / ob-7 / ob-8 -- the exception chain, charged on every exception-grant Source the
  // binding actually references. Only ob-8 is exemptible, and only by witness-3.
  for (const source of sources) {
    if (source.contentKind !== "exception-grant") continue;
    const target = clauseOf(current, source.targetConstraintRef);
    if (target === undefined) {
      throw bindingFailure("E_HEAD_BINDING_EXCEPTION_CHAIN", "ob-6", "head", locator, tag,
        `exception-grant ${source.sourceId} names targetConstraintRef ${JSON.stringify(source.targetConstraintRef)}, which does not resolve`,
        { clauseRef: clause.id, sourceRef: source.sourceId });
    }
    if (!target.id.startsWith("REQ-") || target.authority !== "hard-constraint") {
      throw bindingFailure("E_HEAD_BINDING_EXCEPTION_CHAIN", "ob-6b", "head", locator, tag,
        `exception-grant ${source.sourceId} targets ${target.id}, which is not an authority=hard-constraint REQ`,
        { clauseRef: clause.id, sourceRef: source.sourceId, target: target.id });
    }
    if (canonicalJson(source.grantAuthorityRef) !== canonicalJson(target.ownerRef)) {
      throw bindingFailure("E_HEAD_BINDING_EXCEPTION_CHAIN", "ob-7", "head", locator, tag,
        `exception-grant ${source.sourceId} carries a grantAuthorityRef that is not the target REQ's ownerRef`,
        { clauseRef: clause.id, sourceRef: source.sourceId, target: target.id });
    }
    const at = parseCanonicalExpiry(source.expiry);
    if (at === null) {
      throw bindingFailure("E_HEAD_BINDING_EXCEPTION_CHAIN", "ob-8", "head", locator, tag,
        `exception-grant ${source.sourceId} has a non-canonical expiry ${JSON.stringify(source.expiry)}; a malformed grammar is a validation failure, never a membership answer`,
        { clauseRef: clause.id, sourceRef: source.sourceId });
    }
    if (at <= ctx.t0 && !witness[3]) {
      throw bindingFailure("E_HEAD_BINDING_EXPIRED", "ob-8", "head", locator, tag,
        `exception-grant ${source.sourceId} expired at ${source.expiry} and ${clause.id} is not in expiredClauses`
        + `${clause.id.startsWith("REQ-") ? "" : " (a DEC/ASSUM never enters expiredClauses through its basisRefs, so this has no witness by construction)"}`,
        { clauseRef: clause.id, sourceRef: source.sourceId });
    }
  }

  // ob-9 -- the REST of mechanicallyApplicable's per-kind items, never exemptible. Charged from the
  // same primitives rather than by calling the whole predicate, so an exempted ob-3/ob-5/ob-8
  // cannot be re-charged here through the back door.
  const kind = clause.id.startsWith("DEC-") ? "DEC" : (clause.id.startsWith("ASSUM-") ? "ASSUM" : "REQ");
  if (kind !== "REQ") {
    const principal = kind === "DEC" ? clause.approvedBy : clause.governedBy;
    if (!isReviewerPrincipal(principal)) {
      throw bindingFailure("E_HEAD_BINDING_NOT_APPLICABLE", "ob-9", "head", locator, tag,
        `${clause.id} carries a ${kind === "DEC" ? "approvedBy" : "governedBy"} that is not a legal reviewer principal`,
        { clauseRef: clause.id, reason: kind === "DEC" ? "bad-approvedBy" : "bad-governedBy" });
    }
    if (!index.dps.get(clause.derivedFrom)) {
      throw bindingFailure("E_HEAD_BINDING_NOT_APPLICABLE", "ob-9", "head", locator, tag,
        `${clause.id} derivedFrom ${JSON.stringify(clause.derivedFrom)} does not resolve`,
        { clauseRef: clause.id, reason: "derivedFrom-unresolvable" });
    }
    const basis = basisRefsResolvable(index, clause.basisRefs);
    if (!basis.ok) {
      throw bindingFailure("E_HEAD_BINDING_NOT_APPLICABLE", "ob-9", "head", locator, tag,
        `${clause.id} has an unresolvable basisRef (${basis.reason})`,
        { clauseRef: clause.id, reason: basis.reason });
    }
  }

  assertReqAtDp(ctx, index, clause, tag, locator);
}

const isExceptionBackedHere = (current, clause) => {
  const source = sourceOf(current, clause.sourceRef);
  return source !== undefined && source.contentKind === "exception-grant";
};

// §7, all five conditions, never a subset, and NEVER inside the carve-out: the qualified form
// applies to an exception-backed REQ only; the bare form infers a DP within currentTaskDpIds and
// then checks the same five.
function assertReqAtDp(ctx, index, clause, tag, locator) {
  const current = ctx.current;
  const qualified = typeof tag.dpRef === "string";
  const backed = clause.id.startsWith("REQ-") && isExceptionBackedHere(current, clause);
  if (qualified && !backed) {
    throw bindingFailure("E_DP_QUALIFIER_UNSUPPORTED", "§7 qualified form", "head", locator, tag,
      `${clause.id} is not exception-backed, so it carries no DP qualifier; attaching one asserts a scope promise that does not exist`,
      { clauseRef: clause.id, dpRef: tag.dpRef });
  }
  if (!backed) return;

  const scope = (ctx.taskState && ctx.taskState.currentTaskDpIds) || [];
  let dpId = tag.dpRef;
  if (!qualified) {
    // Bare form: infer ONLY inside the current task. A historical DP must not manufacture a
    // candidate, so zero and many are both fail-closed and the message says to qualify.
    const candidates = scope.filter((id) => {
      const dp = index.dps.get(id);
      return dp !== undefined && dp.resolvedBy === clause.id;
    });
    if (candidates.length !== 1) {
      throw bindingFailure("E_DP_INFERENCE", "§7 bare form", "head", locator, tag,
        `the bare form of ${clause.id} matched ${candidates.length} DPs inside currentTaskDpIds; use the qualified form @DP-y`,
        { clauseRef: clause.id, candidates: candidates.length });
    }
    [dpId] = candidates;
  }

  const complain = (reason, detail) => {
    throw bindingFailure("E_REQ_AT_DP", "§7", "head", locator, tag,
      `${clause.id}@${dpId} fails §7 -- ${reason}`, { clauseRef: clause.id, dpRef: dpId, ...detail });
  };
  if (!scope.includes(dpId)) complain("the DP is not in this task's currentTaskDpIds");
  const dp = index.dps.get(dpId);
  if (dp === undefined) complain("the DP does not resolve in the current store");
  if (dp.status !== "resolved") complain(`the DP status is ${JSON.stringify(dp.status)}, not "resolved"`);
  if (dp.resolvedBy !== clause.id) complain(`the DP resolves to ${JSON.stringify(dp.resolvedBy)}`);
  if (!applicable(index, clause.id, dp, ctx.t0).ok) complain("applicable(REQ, DP) does not hold");
  const ruling = dp.scopeRulingRef;
  const record = ruling && typeof ruling.ref === "string" ? index.records.get(ruling.ref) : undefined;
  if (record === undefined || record.subjectRef !== dpId) {
    complain("the DP's scopeRulingRef does not name that DP as its subject");
  }
}

// --- §6's single ordered precedence, first match wins --------------------------------------------

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
      throw failBinding("E_ENTRY_ORDER",
        `entries must be strictly ascending by the (path, adapterId, structuralId) code-point tuple; `
        + `(${a.join(", ")}) is not before (${b.join(", ")})`,
        { previous: a, next: b });
    }
  }
}

// AC172 (6). The registry digest an envelope declares must be the one the analysed preimage is
// bound to. There is no legal way for a second registry to appear here, so this is a defensive
// branch: it exists because "no legal entry point" is not the same as "cannot happen", and the
// spec requires the mixed case to be REFUSED rather than silently preferred.
function assertRegistryBinding(discovery) {
  const bound = discovery.registryDigest;
  if (typeof bound !== "string" || !/^[0-9a-f]{64}$/.test(bound)) {
    throw failBinding("E_REGISTRY_BINDING",
      `the discovery preimage carries no usable registryDigest (${JSON.stringify(bound)}); the envelope may not invent one`,
      { registryDigest: bound });
  }
  return bound;
}

// --- the two public operations -------------------------------------------------------------------

export async function buildGovernanceSeedPreimage(request) {
  const { carrier } = await runGovernance(request, arguments.length, SEED);
  return carrier;
}

export async function produceChangedTestInventoryV2(request) {
  // The request is checked HERE first so an illegal one fails before any observation happens.
  const { repoRoot, baseTreeOid, taskId } = requireRequest(request, arguments.length, PRODUCER);

  // Both preimages come from HERE, from the same exact request, through the { repoRoot, baseTreeOid }
  // projection. A caller cannot supply either, and taskId reaches neither.
  const discovery = await buildDiscoveryAnalysisPreimage({ repoRoot, baseTreeOid });

  // The governance seed is derived INLINE, through the shared module-private orchestration: calling
  // the finished public operation would put G2 before binding validation and would hand back no
  // TaskState, and §11b.10c forbids both.
  const { carrier: governance, value: entries } = await runGovernance(
    { repoRoot, baseTreeOid, taskId }, 1, PRODUCER,
    async (ctx) => {
      // AC172 cross-binding, before anything is derived from either side. Exact code-point
      // equality; no side preferred, nothing re-run and re-stitched, no partial result.
      if (discovery.baseTreeOid !== baseTreeOid) {
        throw failBinding("E_CROSS_BINDING",
          `the two preimages disagree about baseTreeOid (request ${baseTreeOid}, discovery `
          + `${discovery.baseTreeOid}); neither side is preferred and no partial result is returned`,
          { request: baseTreeOid, discovery: discovery.baseTreeOid });
      }
      if (discovery.headViewDigest !== ctx.snapshot.headViewDigest) {
        throw failBinding("E_CROSS_BINDING",
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

        // BINDING SEMANTICS FIRST, FOR EVERY PAIR -- pre against B, post against the same G1, the
        // same H and the same T0. §11b.10c's ordering step 6 says ALL pre- and post-binding
        // validation, and omission is a projection decision taken afterwards. Skipping `unchanged`
        // first was a real hole: a test still bound to a clause retired in an EARLIER run has no
        // witness-1, so AC176 (3)/(11d-1) require fail-closed -- but with body, tag and path all
        // equal it classified as unchanged and was waived. A deleted pair has no post-state to
        // charge (INV-B1/B2), and null/EXPL do no clause resolution on either side.
        const locator = pair.head ?? pair.base;
        if (pair.base !== null) assertPreBinding(ctx.base, pair.base.tag, locator);
        if (status !== "deleted" && pair.head !== null) assertPostBinding(ctx, index, pair.head.tag, locator);

        // Row 7: omitted entirely, and only now -- after the checks it never had a licence to skip.
        if (status === "unchanged") continue;
        if (status !== "deleted" && (pair.head === null || pair.head.tag === null)) {
          throw failBinding("E_POST_BINDING_MISSING",
            `${pair.head === null ? "a paired test" : pair.head.path} has status ${status} with no head-side `
            + "binding; a non-deleted entry must carry tagAfter, and this is not filled in with EXPL or omitted",
            { status });
        }
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
    throw failBinding("E_REGISTRY_BINDING",
      `the envelope declares registryDigest ${envelope.registryDigest} but the analysed discovery preimage is bound to ${discovery.registryDigest}; a second registry may not be mixed in`,
      { emitted: envelope.registryDigest, bound: discovery.registryDigest });
  }

  // Exactly seven keys. No evaluationTime, producedAt, clockDigest or equivalent: T0 is not
  // persisted, and taskId is a request key, never a carrier or envelope field.
  const keys = Object.keys(envelope).sort();
  const wanted = [...V2_INVENTORY_KEYS].sort();
  if (keys.length !== wanted.length || keys.some((k, i) => k !== wanted[i])) {
    throw failBinding("E_ENVELOPE_SHAPE",
      `the envelope must carry exactly ${JSON.stringify(wanted)}; got ${JSON.stringify(keys)}`, { keys });
  }
  return deepFreeze(envelope);
}
