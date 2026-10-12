// The ledger collector: TP v1.18 amendment §A/§C.3 as amended by TP v1.21 §D10 and §D11.1.
//
// WHAT IT IS. One operation that builds the run ledger's `testProvenance` block — approved §11's
// eighteen keys, unchanged in name and meaning — from authority it reads ITSELF. It accepts no
// store, no index, no verdict, no metric and no telemetry blob from a caller.
//
// TWO LITERALS THAT ARE NOT INTERCHANGEABLE. `null` is an ESTABLISHED ABSENCE: validated authority
// was reached and says the thing is not there. `"unknown"` is an UNAVAILABLE OBSERVATION: the
// authority that would decide was not reached, or its proof was not available. Neither may be read
// as the other, and neither may be coerced to 0 or false. The single exception is `converged`, a
// required combined fail-closed gate: an unestablished gate returns its closed default `false`,
// which is the gate answering rather than an unknown being promoted.
//
// FIVE OBSERVATIONS, IN THIS ORDER, EXACTLY ONCE EACH (§D11.1). For every non-null identity:
//
//   1. inspect₁       — the read-only loop inspection that supplies the metric window;
//   2. own store read — loadStore → provenanceVersion → validateStoreSchema → validateAll → indexStore;
//   3. ONE consumer   — `verifyCommittedBatch`, attempted even for an absent store, an unknown task,
//                       a null head or a legacy head, where it refuses with its own source-owned code;
//   4. after-read     — the same four calls again, attempted even after a consumer refusal;
//   5. inspect₂       — the second inspection, attempted once whatever happened above.
//
// They are not five filesystem reads: each inspection performs its own validated store read, so the
// literal count is higher. What is fixed is the ORDER, the TWO inspections and the EXACTLY ONE
// consumer. No non-null path returns early, because an early return would skip a later observation;
// failures are CARRIED as unavailable facts instead. The collector never calls `recordVerification`,
// never calls `evaluateGate` (which would run a second consumer), never mutates and never accepts a
// caller verdict.
//
// TWO INDEPENDENT HALVES. `provenanceHalf` is the collector's own consumer identity proof plus its
// after-read; `loopHalf` is the loop inspection plus the collector's own store read. Loop-state
// movement, or a context diagnosis in inspect₂, invalidates the LOOP half only and never a
// provenance result the collector proved itself. `converged = loopHalf && provenanceHalf`.
//
// WHAT `converged` CLAIMS, precisely: that both halves held across the five observed instants. It is
// not a claim about now. A change landing after inspect₂ returns is undetectable here by
// construction — every gate has a last instant — so this is a bounded window statement, not a
// guarantee of current state.
//
// AUTHORITY BOUNDARIES. This operation throws ONLY `E_API_ARGUMENTS`, for programmer misuse. Every
// authority outcome — an absent store, an invalid one, an unknown task, a null head, a legacy head,
// a refusing consumer — RETURNS a block, because the ledger is fail-open and one record is written
// whatever the authority says.
import {
  loadStore, validateStoreSchema, validateAll, indexStore, batchInventoryPreimage,
  canonicalJson, clauseKindOf, isCanonicalClauseRef, PROVENANCE_VERSION,
} from "./provenance-store.mjs";
import { parseCanonicalInventoryV2 } from "./changed-test-inventory.mjs";
import { verifyCommittedBatch } from "./committed-batch-consumer.mjs";
import { defaultTestProvenance } from "./run-ledger.mjs";
import { readBoundObservation } from "./inventory-telemetry-observer.mjs";
// §D11.1's loop evidence. Static, and it introduces no cycle: the controller imports neither this
// module nor run-ledger.mjs, and run-ledger's own reach back to this file stays a DYNAMIC import
// inside its append path, which is what keeps run-reconcile/run-consolidate off the provenance stack.
import { inspectLoopState } from "./test-provenance-loop.mjs";

export class TestProvenanceBlockError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TestProvenanceBlockError";
    this.code = code;
  }
}

const REQUEST_KEYS = ["provenanceTaskId", "repoRoot"];
const TAG_KINDS = ["REQ", "DEC", "ASSUM"];
const INVENTORY_STATUSES = ["added", "modified", "deleted", "retagged", "moved"];
const FINDING_KINDS = ["wrong-tag", "missing-source", "scope-violation", "assum-reading-change"];

// A count is written only when it is a finite non-negative safe integer; anything else is not a
// measurement and the field takes its unavailable literal instead.
const countOrUnknown = (n) => (Number.isSafeInteger(n) && n >= 0 ? n : "unknown");

// --- canonical projections over the committed inventory ---------------------------------------------

// §11's taggedTests: the HEAD-side tag when the entry has one, else the DELETED base-side tag. A null
// tag contributes to no counter; `{ expl: true }` counts to EXPL. Inventory entries only — never
// repo-wide.
function taggedTestsOf(entries) {
  const counts = { REQ: 0, DEC: 0, ASSUM: 0, EXPL: 0 };
  for (const entry of entries) {
    const tag = entry.status === "deleted" ? entry.tagBefore : entry.tagAfter;
    if (tag === null || tag === undefined) continue;
    if (tag.expl === true) { counts.EXPL += 1; continue; }
    if (typeof tag.clauseRef !== "string" || !isCanonicalClauseRef(tag.clauseRef)) continue;
    const kind = clauseKindOf(tag.clauseRef);
    if (TAG_KINDS.includes(kind)) counts[kind] += 1;
  }
  return counts;
}

// FIVE of the six §6 statuses. `governance-affected` is deliberately absent: it has its own field,
// because it names the otherwise-unchanged siblings the reverse closure pulled in and counting it
// here would put the same entries in two places.
function inventoryOf(entries) {
  const counts = {};
  for (const status of INVENTORY_STATUSES) counts[status] = 0;
  for (const entry of entries) {
    if (Object.hasOwn(counts, entry.status)) counts[entry.status] += 1;
  }
  return counts;
}

// The exact status count, NOT a count of seed hits. §6's ordered precedence reaches
// `governance-affected` only after moved/modified/retagged have all failed, so an entry that changed
// on its own merits is classified by the higher-precedence row and is counted in `inventory` instead.
const governanceAffectedOf = (entries) => entries.filter((e) => e.status === "governance-affected").length;

// --- verdict-dependent counts -------------------------------------------------------------------------
//
// Reached ONLY when the consumer returned a successful verdict for this exact head, because that
// verdict is the proof that results[] is structurally sound and one-to-one with the entries. A stored
// results[] array on its own is not that proof, and these fields are `"unknown"` without it.

function findingCountsOf(results) {
  const kinds = {};
  for (const kind of FINDING_KINDS) kinds[kind] = 0;
  let entriesWithoutFindings = 0;
  for (const result of results) {
    const findings = Array.isArray(result.findings) ? result.findings : [];
    if (findings.length === 0) entriesWithoutFindings += 1;
    for (const finding of findings) {
      if (finding && Object.hasOwn(kinds, finding.kind)) kinds[finding.kind] += 1;
    }
  }
  return { kinds, entriesWithoutFindings };
}

// DISTINCT cited transition refs of ACTUAL assum-reading-change findings, deduplicated by ref, each
// one validated before it counts:
//   1. the finding's kind is exactly assum-reading-change;
//   2. it carries a resolutionRef naming a transitionRef, and a binding whose clauseRef is a
//      canonical ASSUM;
//   3. the referenced transition resolves in the store AND its own subject is that ASSUM.
// It is a disclosure count over ONE named batch. It is not `resolutions.length` — equivalent
// duplicate groups exist and groups also concern DEC — and it is NOT mint history: a citation is not
// evidence that a transition was minted during this run.
function assumTransitionsOf(results, index) {
  const refs = new Set();
  for (const result of results) {
    const findings = Array.isArray(result.findings) ? result.findings : [];
    for (const finding of findings) {
      if (!finding || finding.kind !== "assum-reading-change") continue;
      const resolution = finding.resolutionRef;
      if (!resolution || typeof resolution !== "object" || typeof resolution.transitionRef !== "string") continue;
      const binding = finding.binding;
      if (!binding || typeof binding.clauseRef !== "string") continue;
      if (!isCanonicalClauseRef(binding.clauseRef) || clauseKindOf(binding.clauseRef) !== "ASSUM") continue;
      const transition = index.transitions.get(resolution.transitionRef);
      if (transition === undefined || transition.subject !== binding.clauseRef) continue;
      refs.add(resolution.transitionRef);
    }
  }
  return refs.size;
}

// --- §D10 / §D11.1: the loop half ----------------------------------------------------------------------

// An inspection this collector may reason from. `inspectLoopState` throws only `E_API_ARGUMENTS`, and
// this collector validated its own request first, so a throw here would be a defect rather than an
// authority outcome — it is still contained, because the ledger writes one record whatever happens.
async function inspectOrNull(repoRoot, taskId) {
  try {
    return await inspectLoopState({ repoRoot, taskId });
  } catch {
    return null;
  }
}

// Trustworthy means the inspection reached its own authority and diagnosed nothing. A reading that
// reports it could not trust its authority is not an operand: §D10 makes `converged` require a
// read-only loop inspection to HOLD, and one carrying a diagnostic does not hold.
const trustworthy = (i) => i !== null && i.present === true && i.diagnostic === null;

// §D11.1's movement comparands, exactly these seven and no others. Adding a field here would change
// the settled equality; the trust predicate above is a separate condition on each reading's own
// validity, not a widening of this comparison.
const MOVEMENT_FIELDS = ["revision", "status", "epochOrdinal", "currentAdmissionId",
  "currentAdmissionPhase", "currentPassInvalidated"];

function unmoved(first, second) {
  for (const field of MOVEMENT_FIELDS) {
    if (first[field] !== second[field]) return false;
  }
  return canonicalJson(first.committed) === canonicalJson(second.committed);
}

// The five §D10 metrics, from inspect₁ ONLY. They are a window fact — "since this loop control was
// established" — not a freshness claim, so later movement changes `converged` and never these. A
// counter projects `"unknown"` exactly when its own `uncertain` flag is set; a known zero stays 0,
// because zero is a measurement and `"unknown"` is the absence of one. `lastStaleSubject` is
// three-valued: `"unknown"` when unavailable, `null` when the controller recorded no stale refusal,
// else the named head ref string (§D10 — never a typed object).
function projectLoopMetrics(block, inspect1) {
  if (inspect1 === null || inspect1.present !== true || inspect1.diagnostic !== null) return;
  const counters = inspect1.counters;
  if (counters === null || typeof counters !== "object") return;
  block.reviewLoopIterations = countOrUnknown(inspect1.observedIterations);
  block.convergenceEpochs = countOrUnknown(inspect1.observedEpochs);
  block.adapterMisses = counters.adapterMisses.uncertain
    ? "unknown" : countOrUnknown(counters.adapterMisses.observed);
  block.staleBatchRejections = counters.staleBatchRejections.uncertain
    ? "unknown" : countOrUnknown(counters.staleBatchRejections.observed);
  block.lastStaleSubject = counters.lastStaleSubject;
}

// §D11.1's loop half: inspect₁ plus the collector's OWN store read, with both inspections trustworthy
// and unmoved. Every comparison is whole — the full typed head and the COMPLETE expected record —
// because §D3.2 carries them precisely so this can be a field-level comparison rather than a digest
// shortcut.
function loopHalfHolds(inspect1, inspect2, ts, index, taskId) {
  if (!trustworthy(inspect1) || !trustworthy(inspect2)) return false;
  if (!unmoved(inspect1, inspect2)) return false;
  if (ts === undefined || ts === null || index === null) return false;
  if (inspect1.status !== "open") return false;
  if (inspect1.currentAdmissionId === null) return false;
  if (inspect1.currentAdmissionPhase !== "verified") return false;
  if (inspect1.currentPassInvalidated !== false) return false;
  const committed = inspect1.committed;
  if (committed === null) return false;
  if (committed.admissionId !== inspect1.currentAdmissionId) return false;
  if (canonicalJson(committed.headRef) !== canonicalJson(ts.committedProvenanceBatchRef)) return false;
  if (canonicalJson(committed.expectedBatchRecord)
      !== canonicalJson(index.records.get(committed.headRef.ref))) return false;
  if (inspect1.taskId !== taskId) return false;
  return canonicalJson(inspect1.baseProvenance) === canonicalJson(ts.baseProvenance);
}

// --- the operation -------------------------------------------------------------------------------------

/**
 * Build the run ledger's testProvenance block.
 *
 * @param {{ repoRoot: string, provenanceTaskId: string|null }} request exactly two own keys.
 *   `null` is the EXPLICIT no-identity value the default ledger CLI passes; an absent key, an extra
 *   key or a non-string non-null value is programmer misuse, not silently "no identity".
 * @returns {Promise<object>} the eighteen-key block.
 */
export async function buildTestProvenanceBlock(request) {
  if (arguments.length !== 1) {
    throw new TestProvenanceBlockError("E_API_ARGUMENTS",
      "buildTestProvenanceBlock takes exactly one argument; a store, an index, a verdict, a metric or a telemetry "
      + "block cannot be supplied");
  }
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    throw new TestProvenanceBlockError("E_API_ARGUMENTS", "the buildTestProvenanceBlock request must be a JSON object");
  }
  // Own keys, not merely the enumerable string ones; symbols refused before the sort and the message.
  const ownKeys = Reflect.ownKeys(request);
  const symbolKeys = ownKeys.filter((key) => typeof key !== "string");
  if (symbolKeys.length > 0) {
    throw new TestProvenanceBlockError("E_API_ARGUMENTS",
      `the buildTestProvenanceBlock request carries symbol-keyed own properties `
      + `(${symbolKeys.map(String).join(", ")}); it must declare exactly ${JSON.stringify(REQUEST_KEYS)}`);
  }
  const keys = ownKeys.sort();
  if (keys.length !== REQUEST_KEYS.length || keys.some((k, i) => k !== REQUEST_KEYS[i])) {
    throw new TestProvenanceBlockError("E_API_ARGUMENTS",
      `the buildTestProvenanceBlock request must declare exactly ${JSON.stringify(REQUEST_KEYS)}; got `
      + `${JSON.stringify(keys)}`);
  }
  // ONE read of each owned value; the consumer call and the after-read below use the locals.
  const { provenanceTaskId, repoRoot } = request;
  if (typeof repoRoot !== "string" || repoRoot === "") {
    throw new TestProvenanceBlockError("E_API_ARGUMENTS", "repoRoot must be a non-empty string");
  }
  if (provenanceTaskId !== null && (typeof provenanceTaskId !== "string" || provenanceTaskId === "")) {
    throw new TestProvenanceBlockError("E_API_ARGUMENTS",
      "provenanceTaskId must be a non-empty string or null. The store treats a task id as an opaque map key and "
      + "defines no length or character rule, so none is invented here; membership is decided by lookup");
  }

  const block = defaultTestProvenance();

  // R1 — NO IDENTITY. No observation of any kind is attempted, and `taskId` is null because no task
  // was requested: that is an established absence, not an unavailable observation. This is the one
  // expressly accepted zero-read path; every other request performs all five observations.
  if (provenanceTaskId === null) return block;

  // ---- OBSERVATION 1: inspect₁, and the metric window it fixes ----------------------------------
  const inspect1 = await inspectOrNull(repoRoot, provenanceTaskId);
  projectLoopMetrics(block, inspect1);

  // ---- OBSERVATION 2: the collector's own validated store read -----------------------------------
  //
  // R2 — CURRENT AUTHORITY UNAVAILABLE. An absent file, an unreadable or unparseable one, a store
  // that fails validation, and a store that is not provenanceVersion 2 all land here: none of them
  // supplies a trusted identity, so `taskId` is "unknown" rather than the caller's argument.
  block.taskId = "unknown";
  let index = null;
  try {
    const loaded = loadStore(repoRoot);
    if (loaded.exists && loaded.store.provenanceVersion === PROVENANCE_VERSION) {
      validateStoreSchema(loaded.store);
      validateAll(loaded.store, { now: Date.now() });
      index = indexStore(loaded.store);
    }
  } catch {
    index = null;                      // no trusted metadata of any kind
  }

  // The stored-fact precedence, exactly as accepted, but decided by SETTING fields rather than by
  // returning: every branch below still owes observations 3, 4 and 5.
  let ts = null;
  let head = null;
  let batch = null;
  let inventory = null;
  if (index !== null) {
    // R1 again — a VALIDATED store that simply has no such task PROVES the absence, so this is null
    // and not "unknown". A validated but empty store reaches exactly this line.
    const found = index.taskStates.get(provenanceTaskId);
    if (found === undefined) {
      block.taskId = null;
    } else {
      ts = found;
      block.taskId = ts.taskId;
      // R3 — VALIDATED, NO HEAD. `committedProvenanceBatchRef: null` is legitimate uncommitted state
      // (TP §8), and it is an established absence: the ref and the digest are null, not "unknown".
      head = ts.committedProvenanceBatchRef || null;
      if (head === null) {
        block.provenanceBatchRef = null;
        block.batchDigest = null;
        block.inventoryDigest = null;
      } else {
        const found2 = index.records.get(head.ref);
        // Unreachable on a validated store; if it ever fires, nothing about the head is reported.
        if (found2 && found2.kind === "provenance-batch") {
          // Defensive: a validated store's head-state rule makes a cross-task head unreachable. If it
          // ever fires, nothing about the head may be reported and the identity itself is untrusted.
          if (found2.taskId !== ts.taskId) {
            block.taskId = "unknown";
          } else {
            batch = found2;
            block.provenanceBatchRef = { kind: head.kind, ref: head.ref };
            block.batchDigest = batch.batchDigest;
            // R4 — LEGACY HEAD: the historical v1.12 batch record format inside a validated current
            // v2 store. Its recordId and batchDigest are readable history; its record-level
            // inventoryDigest carries no preimage authority (AC128), so the field stays "unknown".
            try {
              inventory = parseCanonicalInventoryV2(canonicalJson(batchInventoryPreimage(batch)));
            } catch {
              inventory = null;
            }
            if (inventory !== null) {
              // R5/R6 — canonical facts ABOUT THE STORED HEAD, carrying no claim of current
              // freshness; `converged` below is what speaks to that. A consumer refusal keeps them.
              block.inventoryDigest = inventory.inventoryDigest;
              block.taggedTests = taggedTestsOf(inventory.entries);
              block.inventory = inventoryOf(inventory.entries);
              block.governanceAffectedEntries = countOrUnknown(governanceAffectedOf(inventory.entries));
              // The sidecar, under its full validation. A fault here affects ONE field and nothing
              // else: the record is still appended with every other value intact.
              try {
                block.oracleDepTriggered =
                  countOrUnknown(readBoundObservation(repoRoot, inventory).oracleDepTriggered);
              } catch {
                block.oracleDepTriggered = "unknown";
              }
            }
          }
        }
      }
    }
  }

  // ---- OBSERVATION 3: EXACTLY ONE consumer -------------------------------------------------------
  //
  // Attempted for every non-null identity, including an absent store, an unknown task, a null head
  // and a legacy head — each of which refuses with the consumer's or the reader's own source-owned
  // code. The producer is NEVER re-run and nothing is re-derived against post-Step-5 state: this
  // reads the committed head as it stands. The request carries the captured `provenanceTaskId`, which
  // is the same string as `ts.taskId` whenever a TaskState was found, since that was the lookup key.
  let verdict = null;
  try {
    verdict = await verifyCommittedBatch({ repoRoot, taskId: provenanceTaskId });
  } catch {
    verdict = null;                    // R5: the stored facts stay, the verdict-dependent ones do not
  }

  // ALL SEVEN returned fields against what THIS block loaded, then a current-head re-read. Both are
  // required. The re-read alone is insufficient: an A→B→A change between the two reads leaves it
  // satisfied while the verdict describes B, and a verdict about B can never authorize counts about
  // A. headViewDigest and registryDigest are comparable rather than merely recorded — the consumer's
  // freshness phase compares its fresh pair directly against the committed inventory's and refuses
  // on inequality, so a successful verdict carries values already proved equal to the stored ones.
  const agrees = verdict !== null && ts !== null && head !== null && batch !== null && inventory !== null
    && verdict.taskId === ts.taskId
    && canonicalJson(verdict.committedBatchRef) === canonicalJson({ kind: head.kind, ref: head.ref })
    && verdict.batchDigest === batch.batchDigest
    && verdict.inventoryDigest === inventory.inventoryDigest
    && verdict.baseTreeOid === inventory.baseTreeOid
    && verdict.headViewDigest === inventory.headViewDigest
    && verdict.registryDigest === inventory.registryDigest;

  // THE CURRENT-AUTHORITY RECHECK. §C.3's requirement is "the same named head and the same digests",
  // and comparing a ref string and a batch digest does not establish that: a store whose head ref is
  // preserved while its typed kind changes still satisfies both, while `validateAll` now refuses it.
  // Counts attached to that head would be facts of a store nobody could validate.
  //
  // ITS OWN FRESH INSTANT. This is a third, later load, so it samples its own clock rather than
  // reusing the first one — validating a later store against an earlier instant is the weaker
  // statement. The clock reach is narrow and is NOT a second consumer run: `validateAll` consults a
  // clock only through `applicable()`, at validateInvariants' INV-4 terminal check and
  // validateReopenCauseCoherence's successor-applicability check. It is not a Source Check B, not a
  // continuous-freshness re-evaluation, and it does not recheck every grant expiry in the store. An
  // expiry-sensitive invariant that flipped between the two captures therefore refuses here, which
  // is fail-closed and deliberate. The accepted consumer's own single-T0 protocol is untouched.
  //
  // WHAT DOES NOT INVALIDATE IT: an unrelated VALID append. Whole-store-text equality is not
  // required and would be wrong — the store legitimately advances after Step 5 — and the counts rest
  // on the identity and validity of THIS head and its preimage, not on the absence of other records.
  //
  // OBSERVATION 4, and it is ATTEMPTED WHATEVER OBSERVATION 3 RETURNED. The four calls are a distinct
  // ordered observation, not a step conditional on a passing verdict; when observation 2 produced no
  // comparands the identity comparison simply cannot hold.
  let afterReadHolds = false;
  try {
    const after = loadStore(repoRoot);
    if (after.exists && after.store.provenanceVersion === PROVENANCE_VERSION) {
      validateStoreSchema(after.store);
      validateAll(after.store, { now: Date.now() });
      const afterIndex = indexStore(after.store);
      if (ts !== null && head !== null && batch !== null && inventory !== null) {
        const afterTask = afterIndex.taskStates.get(provenanceTaskId);
        const afterHead = afterTask === undefined
          ? null : afterTask.committedProvenanceBatchRef || null;
        const afterBatch = afterHead === null ? undefined : afterIndex.records.get(afterHead.ref);
        afterReadHolds = afterTask !== undefined
          && afterTask.taskId === ts.taskId
          // The task's base witness, whole: treeOid, storePath and storeDigest together.
          && canonicalJson(afterTask.baseProvenance) === canonicalJson(ts.baseProvenance)
          // The FULL typed ref, compared whole: kind and ref together, and no undeclared member.
          && afterHead !== null && canonicalJson(afterHead) === canonicalJson(head)
          // The COMPLETE named record, field for field. §D11.1 refuses a preserved ref whose typed
          // kind, record or base validity changed, and §D3.2 carries the complete record precisely so
          // this can be that comparison rather than a digest shortcut.
          && afterBatch !== undefined && canonicalJson(afterBatch) === canonicalJson(batch)
          // The derived inventory identity the counts were actually taken from. Whole-record equality
          // above already implies it; it is retained deliberately as defence in depth, so a preimage
          // that ever stopped being purely record-derived could not slip through unnoticed.
          && batchInventoryPreimage(afterBatch).inventoryDigest === inventory.inventoryDigest;
      }
    }
  } catch {
    afterReadHolds = false;
  }

  // ---- OBSERVATION 5: inspect₂, attempted once whatever happened above ---------------------------
  const inspect2 = await inspectOrNull(repoRoot, provenanceTaskId);

  // ---- the two independent halves ----------------------------------------------------------------
  const provenanceHalf = agrees && afterReadHolds;

  // The verdict-dependent counts rest on the PROVENANCE half alone. The verdict is bound to the same
  // head this block describes, so its proof extends to results[]: the consumer's own coverage and
  // binding phases are what validated them. Loop state — absent, corrupt, context-mismatched or
  // moved — never withholds them, because the collector proved this itself.
  if (provenanceHalf) {
    const results = Array.isArray(batch.batchSnapshot.results) ? batch.batchSnapshot.results : [];
    const { kinds, entriesWithoutFindings } = findingCountsOf(results);
    block.findingKinds = kinds;
    block.entriesWithoutFindings = countOrUnknown(entriesWithoutFindings);
    block.assumTransitions = countOrUnknown(assumTransitionsOf(results, index));
  }

  // `converged` is the COMBINED result of two independent gates, each proved by this collector from
  // authority it read itself. It is a bounded window statement — both halves held across the five
  // observed instants — and never a claim about now: a change landing after inspect₂ returns is
  // undetectable here by construction. A gate that is not established returns its closed default
  // `false`, which is the gate answering rather than an unknown being promoted.
  block.converged = loopHalfHolds(inspect1, inspect2, ts, index, provenanceTaskId) && provenanceHalf;
  return block;
}

// Exported for the ledger and its tests: the same eighteen keys the block always carries, in one
// place, so a reader can check a record's shape without restating the list.
export const TEST_PROVENANCE_KEYS = Object.keys(defaultTestProvenance());
