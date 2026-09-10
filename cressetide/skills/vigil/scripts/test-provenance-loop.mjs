// TP v1.21: the review-loop controller — eight public operations and their CLI.
//
// SCOPE, stated so no success here is read as more than it is. This controller records what it
// actually did: which inventory it emitted and how it bound the artifact, that the persisted review
// bytes passed raw and canonical validation and matched the emitted content, that a named batch
// record exists matching the retained expected record, and what a fresh consumer returned. It does
// NOT establish that a reviewer ran (§D5.2), does not prove Step 6 convergence by itself, and makes
// no readiness claim.
//
// RETURN VERSUS THROW (§D3). An owned attempt that produced durable bookkeeping returns a structured
// outcome carrying the actual stage, class and code; every precondition throws, because nothing was
// attempted and nothing was recorded. Upstream typed causes keep their identity in both directions,
// and where a cause genuinely carries no code, `code` is null rather than fabricated.
import fs from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { canonicalJson, sha256Hex } from "./canonical-json.mjs";
import {
  loadStore, validateStoreSchema, validateAll, indexStore, makeIdFactory,
  resolutionGroupDigest, sortTypedRefs, assertProspectiveTransitionAuthority,
  successorDraftPresenceFault, previewTestProvenanceBatch, runTransactionFromPayloadText,
  principalsEqual, batchInventoryPreimage, reject,
} from "./provenance-store.mjs";
import { parseCanonicalInventoryV2 } from "./changed-test-inventory.mjs";
// §D4 step 7's authority sample, taken through the SAME source-owned path the Step 6 consumer uses
// (`committed-batch-consumer.mjs:182-185`). Reading the head view and the registry any other way
// here would create a second and competing definition of the two digests being compared.
import { captureHeadViewSnapshot } from "./head-view-snapshot.mjs";
import { readTestAdapterRegistryRootFresh } from "./adapter-registry.mjs";
import { readHeadExplicitConfig, registryDigestOf } from "./explicit-config.mjs";
import { emitChangedTestInventory } from "./changed-test-inventory-artifact.mjs";
import { observeInventoryTelemetry } from "./inventory-telemetry-observer.mjs";
import { verifyCommittedBatch } from "./committed-batch-consumer.mjs";
import {
  LoopError, fail, loopPaths, newId, rawSha256, readState, publishState, advance, initialState,
  assertContainedPrefix, assertRegularOrAbsent, withLock, admissionOf, currentAdmission, isTerminal,
  describeState, MAX_EPOCH_ADMISSIONS, SLOT_NAMES, WITNESS_BRANCHES, WITNESS_SOURCES,
} from "./test-provenance-loop-state.mjs";
import {
  ingestInputs, parseGovernanceDocument, evaluateFindings, reconcilePending, computeFingerprint, buildPayload,
} from "./test-provenance-loop-review.mjs";
import {
  GENERAL_FINDING_KINDS, evidenceCoverageFault, findingIdentityKey, observedBodies,
  retainedResultFault, retainedResultFor, sortFindingIdentities,
} from "./batch-review-validation.mjs";

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const freeze = (v) => Object.freeze(v);

// --- §D3 request capture -------------------------------------------------------------------------------

// OWN keys, not merely the enumerable string ones: a required non-enumerable own key is legal, a
// hidden or symbol EXTRA is not. Each declared value is read EXACTLY ONCE, before any await, so a
// caller's mutable object or accessor cannot make one stage of an operation describe a different
// world than another.
function capture(request, wanted, operation) {
  if (!isPlainObject(request)) {
    throw fail("E_API_ARGUMENTS", `the ${operation} request must be a JSON object`, operation);
  }
  const ownKeys = Reflect.ownKeys(request);
  const symbols = ownKeys.filter((k) => typeof k !== "string");
  if (symbols.length > 0) {
    throw fail("E_API_ARGUMENTS",
      `the ${operation} request carries symbol-keyed own properties (${symbols.map(String).join(", ")}); `
      + `it must declare exactly ${JSON.stringify(wanted)}`, operation);
  }
  const actual = ownKeys.sort();
  const sorted = [...wanted].sort();
  if (actual.length !== sorted.length || actual.some((k, i) => k !== sorted[i])) {
    throw fail("E_API_ARGUMENTS",
      `the ${operation} request must declare exactly ${JSON.stringify(sorted)}; got ${JSON.stringify(actual)}`, operation);
  }
  const captured = {};
  for (const key of sorted) captured[key] = request[key];
  for (const key of ["repoRoot", "taskId"]) {
    if (sorted.includes(key) && (typeof captured[key] !== "string" || captured[key] === "")) {
      throw fail("E_API_ARGUMENTS", `${key} must be a non-empty string`, operation);
    }
  }
  return captured;
}

function requireArity(count, operation) {
  if (count !== 1) {
    throw fail("E_API_ARGUMENTS",
      `${operation} takes exactly one argument; a clock, a callback, a verdict, a digest, a store, an index or a `
      + "file path cannot be supplied", operation);
  }
}

// --- shared authority capture ---------------------------------------------------------------------------

// Every top-level operation performs its OWN load and validation and resolves the named TaskState
// itself. No caller may supply a store, an index or a cached authority.
function currentAuthority(repoRoot, taskId) {
  const loaded = loadStore(repoRoot);
  validateStoreSchema(loaded.store);
  validateAll(loaded.store);
  const index = indexStore(loaded.store);
  const ts = index.taskStates.get(taskId);
  if (!ts) throw fail("E_LOOP_UNKNOWN_TASK", `no TaskState for taskId ${JSON.stringify(taskId)}`, taskId);
  return { loaded, index, ts };
}

// §D4 step 7's three authority samples, taken FRESH and independently of the artifact being bound.
// The head view and the registry are read through the SAME source-owned path the Step 6 consumer
// uses, so the two components compare the same two digests instead of each defining its own.
async function sampleAuthority(repoRoot) {
  const loaded = loadStore(repoRoot);
  const snapshot = await captureHeadViewSnapshot({ repoRoot });
  const registryRoot = readTestAdapterRegistryRootFresh();
  const explicitConfig = readHeadExplicitConfig(snapshot, registryRoot);
  return {
    loaded,
    storeTextDigest: loaded.digest,
    headViewDigest: snapshot.headViewDigest,
    registryDigest: registryDigestOf(registryRoot, explicitConfig),
  };
}

// All three equalities, charged one at a time so the diagnosis names which sample actually moved.
function requireAuthorityEqualities(sampled, header, taskId, phrase) {
  for (const [what, actual, expected] of [
    ["the store text", sampled.storeTextDigest, header.inputProvenanceStoreDigest],
    ["the HEAD view", sampled.headViewDigest, header.headViewDigest],
    ["the adapter registry", sampled.registryDigest, header.registryDigest],
  ]) {
    if (actual !== expected) {
      throw fail("E_LOOP_PRESTATE_MOVED", `${what} digests to ${actual} but ${phrase} ${expected}`, taskId);
    }
  }
}

const contextFault = (state, taskId, ts) => {
  if (state.taskId !== taskId) return `the control state belongs to task ${JSON.stringify(state.taskId)}`;
  if (canonicalJson(state.baseProvenance) !== canonicalJson(ts.baseProvenance)) {
    return "the control state's base witness does not equal the tracked TaskState witness";
  }
  return null;
};

function requireOwnState(repoRoot, taskId, ts) {
  const read = readState(repoRoot, taskId);
  if (!read.present) throw fail("E_LOOP_NO_EMISSION", "no control state exists; run begin first", taskId);
  const fault = contextFault(read.state, taskId, ts);
  if (fault !== null) throw fail("E_LOOP_CONTEXT", fault, taskId);
  return read;
}

const baselineRecordIds = (index) => [...index.records.keys()].sort();

// §D5.1: an ABSENT governance file is legal and yields []. A PRESENT one is put through its full
// structural, raw and schema validation, with only the current-emission binding omitted so the read
// stays non-circular — no Emission need exist here.
function baselineDraftIds(paths, taskId) {
  if (!fs.existsSync(paths.governance)) return [];
  const doc = parseGovernanceDocument(fs.readFileSync(paths.governance, "utf8"), taskId, paths.governance);
  return [...new Set(doc.packages.map((p) => p.recordId))].sort();
}

// §D4.1 slot discipline. A pending slot found by a MUTATING operation is resolved to unknown with its
// uncertainty flag set, and a resolved VERIFICATION slot also closes the admission it names —
// otherwise that admission stays `committed` forever and, since new emission is terminal-only, every
// future iteration is blocked with no exit.
function resolvePendingSlots(state) {
  const resolved = [];
  const attempts = { ...state.attempts };
  const counters = {
    adapterMisses: { ...state.counters.adapterMisses },
    staleBatchRejections: { ...state.counters.staleBatchRejections },
    lastStaleSubject: state.counters.lastStaleSubject,
  };
  let admitted = state.epoch.admitted;
  for (const slot of SLOT_NAMES) {
    const occupant = attempts[slot];
    if (occupant === null || occupant.phase !== "pending") continue;
    attempts[slot] = { ...occupant, phase: "completed", outcome: { kind: "unknown" } };
    resolved.push(slot);
    if (slot === "emit" || slot === "observe") counters.adapterMisses.uncertain = true;
    if (slot === "verification") {
      counters.staleBatchRejections.uncertain = true;
      admitted = admitted.map((a) => (a.admissionId !== occupant.admissionId || a.phase !== "committed" ? a : {
        ...a,
        phase: "refused",
        closeReason: { stage: "verification", kind: "unknown", class: null, code: null },
      }));
    }
  }
  return { resolved, attempts, counters, admitted };
}

// §D4.1: occupants found `pending` by a MUTATING operation are resolved in ONE publication before any
// is reused. Every mutating operation runs this immediately after reading its state, so a later
// attempt never has to overwrite pending evidence — which §D2.2 invariant 10 forbids outright, and
// `advance` now refuses.
function reconcileSlots(paths, state) {
  const slots = resolvePendingSlots(state);
  if (slots.resolved.length === 0) return { state, resolved: [] };
  return {
    state: publishState(paths, advance(state, {
      attempts: slots.attempts,
      counters: slots.counters,
      epoch: { ...state.epoch, admitted: slots.admitted },
    })),
    resolved: slots.resolved,
  };
}

// §D2.2 invariant 7: the baselines are APPEND-ONLY within one control file's life, so a refresh is a
// union. Recomputing them outright would drop a governance draft id whose package the author has
// since deleted, and §D9's novelty test would then accept that same witness again as new.
const mergeBaseline = (prior, incoming) => [...new Set([...prior, ...incoming])].sort();

// ============================================================================================
// 1. beginTaskLoop
// ============================================================================================

export async function beginTaskLoop(request) {
  requireArity(arguments.length, "beginTaskLoop");
  const { repoRoot, taskId } = capture(request, ["repoRoot", "taskId"], "beginTaskLoop");
  const paths = loopPaths(repoRoot, taskId);
  // §D2.4 steps 1-2, before any lock, read or write.
  assertContainedPrefix(repoRoot, { create: true });

  return withLock(paths.taskLock, async () => {
    const { loaded, index, ts } = currentAuthority(repoRoot, taskId);
    const existing = readState(repoRoot, taskId);
    if (!existing.present) {
      const created = initialState({
        taskId,
        baseProvenance: ts.baseProvenance,
        createdAgainstStoreDigest: loaded.digest,
        knownRecordIds: baselineRecordIds(index),
        knownDraftIds: baselineDraftIds(paths, taskId),
      });
      // revision counts successful publications; the creating one is the first, so it is published
      // with revision 1 rather than advanced from 0.
      const published = publishState(paths, created);
      return begunResponse(published, "created", []);
    }

    const fault = contextFault(existing.state, taskId, ts);
    if (fault !== null) throw fail("E_LOOP_CONTEXT", `${fault}; the state is left exactly as found`, taskId);

    let state = existing.state;
    const slots = reconcileSlots(paths, state);
    state = slots.state;
    const reconciled = reconcileIntent(paths, state, ts, index);
    if (reconciled.state !== state) state = reconciled.state;
    return begunResponse(state, reconciled.kind, slots.resolved);
  });
}

const begunResponse = (state, reconciled, resolvedPendingSlots) => freeze({
  revision: state.revision,
  status: state.status,
  epochOrdinal: state.epoch.ordinal,
  observedIterations: state.observedIterations,
  observedEpochs: state.observedEpochs,
  closedEpochAdmissions: state.closedEpochAdmissions,
  currentAdmissionId: state.currentAdmissionId,
  lock: state.lock,
  reconciled,
  resolvedPendingSlots: freeze([...resolvedPendingSlots]),
});

// §D8.3 recovery. Matching is the NAMED record only — no task or digest search — compared field by
// field against the retained expectedBatchRecord.
//
// AND THE HEAD. §D8.3:781 states what recovery proves: "the immutable named batch record, its taskId,
// inventoryDigest, previousBatchRef AND the head pointing at it", and the `attempted` conflict row is
// "record present but head OR digest conflicts". A record that exists while the task's typed head
// points somewhere else is exactly that row: the write may have landed without the head advancing, or
// another path may have moved the head since. Adopting it would publish a `committed` naming a head
// this admission never installed — which the next verification would then report as a misbinding,
// one operation too late and under the wrong code.
function reconcileIntent(paths, state, ts, index) {
  const intent = state.pendingCommit;
  if (intent === null) return { state, kind: state.revision === 1 ? "created" : "none" };
  const record = index.records.get(intent.batchRecordId) || null;
  const matches = record !== null
    && canonicalJson(record) === canonicalJson(intent.expectedBatchRecord);

  if (record !== null && !matches) {
    throw fail("E_LOOP_COMMIT_CONFLICT",
      `the named record ${intent.batchRecordId} does not match the retained expected record; failing closed with no repair`,
      intent.batchRecordId);
  }
  if (matches) {
    // The head is read from the in-lock validated TaskState, never synthesised from the intent.
    const head = ts.committedProvenanceBatchRef || null;
    const headFault = headPointsAtFault(head, intent.batchRecordId);
    if (headFault !== null) {
      throw fail("E_LOOP_COMMIT_CONFLICT",
        `the named record ${intent.batchRecordId} exists but ${headFault}; failing closed with no repair`,
        intent.batchRecordId);
    }
    return { state: publishState(paths, adoptCommitted(state, intent, head, index)), kind: "adopted" };
  }
  if (intent.phase === "prepared") {
    return { state, kind: "prepared-resumable" };
  }
  // attempted with the named record absent: UNKNOWN and SPENT. Never a known non-attempt, never
  // retriable, never reset to prepared.
  const admitted = state.epoch.admitted.map((a) => (a.admissionId !== intent.admissionId ? a : {
    ...a,
    phase: "refused",
    closeReason: { stage: "writer", kind: "unknown", class: null, code: null },
  }));
  return {
    state: publishState(paths, advance(state, {
      epoch: { ...state.epoch, admitted },
      pendingCommit: null,
    })),
    kind: "attempt-unknown",
  };
}

// A typed head that is absent, malformed, or names another record is not "the head pointing at it".
// All three are the same §D8.3 conflict row and are reported as one, naming which it was.
function headPointsAtFault(head, batchRecordId) {
  if (head === null) return "the task has no committed head, so nothing points at it";
  if (!isPlainObject(head) || typeof head.kind !== "string" || typeof head.ref !== "string") {
    return `the task's committed head ${canonicalJson(head)} is not a typed record ref`;
  }
  if (head.kind !== "provenance-batch") return `the task's committed head is a ${head.kind}`;
  if (head.ref !== batchRecordId) return `the task's committed head points at ${head.ref}`;
  return null;
}

function adoptCommitted(state, intent, head, index) {
  const record = index.records.get(intent.batchRecordId);
  const admission = admissionOf(state, intent.admissionId);
  const preimage = batchInventoryPreimage(record);
  const admitted = state.epoch.admitted.map((a) => (a.admissionId !== intent.admissionId ? a : { ...a, phase: "committed" }));
  return advance(state, {
    epoch: { ...state.epoch, admitted },
    pendingCommit: null,
    committed: {
      admissionId: intent.admissionId,
      // The head ACTUALLY read from the validated TaskState, verified above to name this record.
      headRef: { kind: head.kind, ref: head.ref },
      batchDigest: record.batchDigest,
      // AC124: `record.inventoryDigest` is DERIVED and equal to
      // batchSnapshot.inventorySnapshot.inventoryDigest. It is the committed store's own value, which
      // is what an adoption must carry — the intent's copy is this controller's prior expectation.
      inventoryDigest: record.inventoryDigest,
      baseProvenance: { ...state.baseProvenance },
      headViewDigest: preimage.headViewDigest,
      registryDigest: preimage.registryDigest,
      payloadRawDigest: intent.payloadRawDigest,
      fingerprint: admission.fingerprint,
      expectedBatchRecord: intent.expectedBatchRecord,
    },
  });
}

// ============================================================================================
// 2. runProposalIteration
// ============================================================================================

export async function runProposalIteration(request) {
  requireArity(arguments.length, "runProposalIteration");
  const { repoRoot, taskId } = capture(request, ["repoRoot", "taskId"], "runProposalIteration");
  const paths = loopPaths(repoRoot, taskId);
  assertContainedPrefix(repoRoot, { create: true });

  return withLock(paths.emitLock, async () => withLock(paths.taskLock, async () => {
    const { ts } = currentAuthority(repoRoot, taskId);
    const read = requireOwnState(repoRoot, taskId, ts);
    let state = reconcileSlots(paths, read.state).state;
    if (state.status === "locked") throw fail("E_LOOP_LOCKED", "this epoch is locked; open a new one first", taskId);
    if (state.pendingCommit !== null) {
      throw fail("E_LOOP_INTENT_UNRESOLVED", "a commit intent is unresolved; run begin to reconcile it", taskId);
    }
    const current = currentAdmission(state);
    if (current !== null && !isTerminal(current)) {
      throw fail("E_LOOP_ADMISSION_OPEN",
        `admission ${current.admissionId} is ${current.phase}; a new cycle needs a terminal current admission`, taskId);
    }

    // §D4 step 2: the cap, BEFORE any external work and BEFORE any clearing, in a state where
    // currentAdmissionId still names the locking admission so invariant 12 holds. Nothing is counted.
    if (state.epoch.admitted.length >= MAX_EPOCH_ADMISSIONS) {
      const last = current || state.epoch.admitted[state.epoch.admitted.length - 1];
      publishState(paths, advance(state, {
        currentAdmissionId: last.admissionId,
        status: "locked",
        lock: {
          reason: "cap-exhausted",
          fingerprint: last.fingerprint,
          at: Date.now(),
          duplicateOf: null,
          lockedFindings: last.findingIdentities,
        },
      }));
      throw fail("E_LOOP_CAP",
        `this epoch has admitted ${MAX_EPOCH_ADMISSIONS}; requesting a new cycle spends it, so the epoch is now locked`,
        taskId);
    }

    const emissionId = newId();
    // A: pass invalidated, references cleared, emit slot pending — one publication, then the call.
    state = publishState(paths, advance(state, {
      currentPassInvalidated: true,
      lastEmission: null,
      currentAdmissionId: null,
      attempts: {
        ...state.attempts,
        emit: { attemptId: newId(), at: Date.now(), epochOrdinal: state.epoch.ordinal, emissionId, admissionId: null, headRef: null, phase: "pending", outcome: null },
      },
    }));

    let returned;
    let emitOutcome;
    try {
      returned = await emitChangedTestInventory({ repoRoot, baseTreeOid: ts.baseProvenance.treeOid, taskId });
      emitOutcome = { kind: "ok" };
    } catch (error) {
      emitOutcome = { kind: "refused", class: error && error.name ? error.name : "Error", code: error && error.code ? error.code : null };
      // B is published FIRST, then the actual cause is re-thrown unchanged.
      publishState(paths, advance(state, {
        attempts: { ...state.attempts, emit: { ...state.attempts.emit, phase: "completed", outcome: emitOutcome } },
        counters: aggregate(state.counters, "adapterMisses", emitOutcome),
      }));
      throw error;
    }
    // B: the emitter outcome is durable before the fallible binding and sampling reads may throw.
    state = publishState(paths, advance(state, {
      attempts: { ...state.attempts, emit: { ...state.attempts.emit, phase: "completed", outcome: emitOutcome } },
      counters: aggregate(state.counters, "adapterMisses", emitOutcome),
    }));

    // 6. bind the returned artifact BEFORE sampling any authority. The artifact is read through the
    //    CANONICAL v2 reader, not JSON.parse: that reader is the one authority on the envelope's key
    //    set and its entry and nested member ordering, and a plain parse would accept a header this
    //    controller then went on to treat as validated.
    const artifactBytes = fs.readFileSync(returned.path);
    const artifactRawDigest = rawSha256(artifactBytes);
    const artifact = parseCanonicalInventoryV2(artifactBytes.toString("utf8"));
    const requestedBaseTreeOid = ts.baseProvenance.treeOid;
    if (artifact.baseTreeOid !== ts.baseProvenance.treeOid || artifact.baseTreeOid !== requestedBaseTreeOid) {
      throw fail("E_LOOP_ARTIFACT_MOVED", "the emitted artifact names another base tree", taskId);
    }
    if (artifact.inventoryDigest !== returned.inventoryDigest) {
      throw fail("E_LOOP_ARTIFACT_MOVED", "the emitted artifact's digest does not equal the emitter's return", taskId);
    }
    // 7. only then sample authority — all THREE of it. "Sampling after emission does not bind them;
    //    these equalities are what bind it." Copying the artifact's own headViewDigest and
    //    registryDigest into the captured fields made two of the three equalities compare a value
    //    with itself, so a source or config move between the emitter's read and this point was
    //    invisible and the recorded capture was stale by construction.
    const sampled = await sampleAuthority(repoRoot);
    requireAuthorityEqualities(sampled, {
      inputProvenanceStoreDigest: artifact.inputProvenanceStoreDigest,
      headViewDigest: artifact.headViewDigest,
      registryDigest: artifact.registryDigest,
    }, taskId, "the artifact was produced against");

    const emission = {
      emissionId,
      request: { repoRoot, baseTreeOid: ts.baseProvenance.treeOid, taskId },
      returned: { path: returned.path, inventoryDigest: returned.inventoryDigest },
      artifactRawDigest,
      artifactHeader: {
        baseTreeOid: artifact.baseTreeOid,
        headViewDigest: artifact.headViewDigest,
        registryDigest: artifact.registryDigest,
        inputProvenanceStoreDigest: artifact.inputProvenanceStoreDigest,
        inventoryDigest: artifact.inventoryDigest,
      },
      // The INDEPENDENTLY sampled values, which is what makes the three equalities above evidence.
      storeTextDigest: sampled.storeTextDigest,
      capturedHeadViewDigest: sampled.headViewDigest,
      capturedRegistryDigest: sampled.registryDigest,
      observation: null,
    };

    // C: the complete lastEmission, the refreshed baselines and the observe slot — one publication,
    // then the observer call.
    const freshIndex = indexStore(sampled.loaded.store);
    state = publishState(paths, advance(state, {
      lastEmission: emission,
      knownRecordIds: mergeBaseline(state.knownRecordIds, baselineRecordIds(freshIndex)),
      knownDraftIds: mergeBaseline(state.knownDraftIds, baselineDraftIds(paths, taskId)),
      attempts: {
        ...state.attempts,
        observe: { attemptId: newId(), at: Date.now(), epochOrdinal: state.epoch.ordinal, emissionId, admissionId: null, headRef: null, phase: "pending", outcome: null },
      },
    }));

    let observation = null;
    let observeOutcome;
    try {
      const observed = await observeInventoryTelemetry({ repoRoot, baseTreeOid: ts.baseProvenance.treeOid, taskId });
      observation = { inventoryDigest: observed.inventoryDigest, oracleDepTriggered: observed.oracleDepTriggered };
      observeOutcome = { kind: "ok" };
    } catch (error) {
      // Observer failure is NON-GATING and is reported in observeOutcome.
      observeOutcome = { kind: "refused", class: error && error.name ? error.name : "Error", code: error && error.code ? error.code : null };
    }
    // D
    state = publishState(paths, advance(state, {
      lastEmission: { ...emission, observation },
      attempts: { ...state.attempts, observe: { ...state.attempts.observe, phase: "completed", outcome: observeOutcome } },
      counters: aggregate(state.counters, "adapterMisses", observeOutcome),
    }));

    return freeze({
      revision: state.revision,
      emissionId,
      inventoryDigest: returned.inventoryDigest,
      artifactRawDigest,
      emitOutcome: freeze(emitOutcome),
      observeOutcome: freeze(observeOutcome),
      observation: observation === null ? null : freeze(observation),
    });
  }));
}

// The telemetry amendment §B.4 allow-list, verbatim. Membership is by an explicit (errorClass, code)
// PAIR: "A code-name pattern is forbidden — it would silently absorb future codes and cannot
// distinguish a source-form refusal from caller misuse." Matching on the code alone was exactly that
// mistake, and the two names it carried are raised by no component at all, so every real refusal
// counted 0.
//
// Everything not listed contributes 0 by construction, which is how §B.4's exclusions are honoured:
// E_API_ARGUMENTS and E_VIEW_INPUT in every class, and registry/build, provenance store, artifact
// emission, producer and Git failures, which are preserved separately and are not per-file claims.
const ADAPTER_MISS_PAIRS = new Map([
  ["DiscoveryPreimageError", new Set([
    "E_PARSER", "E_FORCED_SUBJECT", "E_MANIFEST_LEVEL_UNAUTHORISED", "E_AMBIGUOUS_EVIDENCE",
    "E_UNKNOWN_ADAPTER", "E_IDENTITY_DRIFT", "E_DUPLICATE_STRUCTURAL_ID", "E_ORDER",
    "E_DUPLICATE_MODULE", "E_CROSS_VIEW_ADAPTER",
    // §B.4: the ExplicitConfigError codes keep their identity through a DiscoveryPreimageError
    // wrapper, "which must preserve the underlying E_CONFIG_* code".
    "E_CONFIG_SHAPE", "E_CONFIG_FIELD", "E_CONFIG_CARRIER", "E_CONFIG_DUPLICATE_MEMBER",
  ])],
  ["NodeTestAdapterError", new Set([
    "E_MODULE_FORMAT", "E_PACKAGE_BOUNDARY", "E_ENTRY_TYPE", "E_MODULE_MISSING",
    "E_UNSUPPORTED_IMPORT", "E_UNSUPPORTED_SYNTAX", "E_PLACEMENT", "E_DIRECTIVE_MALFORMED",
    "E_DIRECTIVE_UNATTACHED", "E_DIRECTIVE_AMBIGUOUS", "E_DIRECTIVE_BORROWED", "E_TAG_CARDINALITY",
    "E_TID_CARDINALITY", "E_STRUCTURAL_DUPLICATE", "E_TID_DUPLICATE", "E_ORACLE_BINDING",
    "E_ORACLE_RESOLVE", "E_ORACLE_UNCLASSIFIED", "E_SNAPSHOT_FORM", "E_SNAPSHOT_PATH", "E_DEP_BYTES",
    // Included because of their SUBJECT, not their names: these refuse the analysed module's
    // callback form, and paths and import specifiers in the analysed source. They are profile
    // refusals about repository content.
    "E_PATH", "E_SPECIFIER", "E_ARGUMENTS",
  ])],
  ["ExplicitConfigError", new Set([
    "E_CONFIG_SHAPE", "E_CONFIG_FIELD", "E_CONFIG_CARRIER", "E_CONFIG_DUPLICATE_MEMBER",
  ])],
]);

const isAllowedMiss = (outcome) => {
  const codes = ADAPTER_MISS_PAIRS.get(outcome.class);
  return codes !== undefined && typeof outcome.code === "string" && codes.has(outcome.code);
};

// The emit call and the observe call are two separate ACTUAL invocations, each contributing its own
// first refusal. An unknown outcome is never counted as zero — it sets the uncertainty flag instead.
function aggregate(counters, name, outcome) {
  const next = {
    adapterMisses: { ...counters.adapterMisses },
    staleBatchRejections: { ...counters.staleBatchRejections },
    lastStaleSubject: counters.lastStaleSubject,
  };
  if (outcome.kind === "unknown") { next[name].uncertain = true; return next; }
  if (outcome.kind === "refused" && isAllowedMiss(outcome)) next[name].observed += 1;
  return next;
}

// ============================================================================================
// 3. submitReviewedProposal
// ============================================================================================

export async function submitReviewedProposal(request) {
  requireArity(arguments.length, "submitReviewedProposal");
  const { repoRoot, taskId } = capture(request, ["repoRoot", "taskId"], "submitReviewedProposal");
  const paths = loopPaths(repoRoot, taskId);
  assertContainedPrefix(repoRoot, { create: true });

  return withLock(paths.taskLock, async () => {
    const { index, ts } = currentAuthority(repoRoot, taskId);
    const read = requireOwnState(repoRoot, taskId, ts);
    const state = reconcileSlots(paths, read.state).state;
    if (state.status === "locked") throw fail("E_LOOP_LOCKED", "this epoch is locked", taskId);
    if (state.lastEmission === null) throw fail("E_LOOP_NO_EMISSION", "no emission is available to review", taskId);
    const emission = state.lastEmission;

    const reviewBytes = fs.readFileSync(paths.review);
    const reviewRawDigest = rawSha256(reviewBytes);
    const governanceRawDigest = fs.existsSync(paths.governance)
      ? rawSha256(fs.readFileSync(paths.governance)) : sha256Hex("");

    // 2. the retry check, BEFORE anything is consumed.
    const retry = state.epoch.admitted.find((a) =>
      a.phase === "open" && a.emissionId === emission.emissionId
      && a.reviewRawDigest === reviewRawDigest && a.governanceRawDigest === governanceRawDigest);
    if (retry) {
      return freeze({
        revision: state.revision, admissionId: retry.admissionId, fingerprint: retry.fingerprint,
        commitReady: retry.commitReady, wasSeen: false, admittedCount: state.epoch.admitted.length,
        retry: true, status: state.status, lock: state.lock, phase: retry.phase,
      });
    }
    if (state.epoch.admitted.some((a) => a.emissionId === emission.emissionId)) {
      throw fail("E_LOOP_EMISSION_SPENT",
        `emission ${emission.emissionId} is already admitted; a new cycle needs a new emission`, taskId);
    }

    // 4. ingestion; 5. emission binding.
    const ingested = ingestInputs({ paths, taskId, taskState: ts, emission });
    const artifactNow = rawSha256(fs.readFileSync(emission.returned.path));
    if (artifactNow !== emission.artifactRawDigest) {
      throw fail("E_LOOP_ARTIFACT_MOVED", "the emitted artifact's bytes have changed since emission", taskId);
    }
    // §D7 step 5: "§D4 step 7's authority EQUALITIES still hold" — all three of them, re-sampled here
    // inside the task lock rather than carried in from a snapshot taken before it was acquired. A
    // source or config change after publication C leaves the store text untouched, so comparing the
    // store alone admitted a review of a world that had already moved.
    const sampled = await sampleAuthority(repoRoot);
    requireAuthorityEqualities(sampled, emission.artifactHeader, taskId, "this emission was bound to");

    // 6. §D5.8b's EXHAUSTIVE per-finding scan, then the fingerprint.
    const evaluated = evaluateFindings({
      batch: ingested.batch, taskId, preIndex: index,
      recordsToCreate: ingested.governance ? ingested.governance.recordsToCreate : [],
      resolutions: ingested.governance ? ingested.governance.resolutions : [],
    });
    if (evaluated.refusals.length > 0) {
      throw fail("E_LOOP_REVIEW_INVALID",
        `the review carries ${evaluated.refusals.length} invalid claim(s), refused before admission: ${evaluated.refusals.join("; ")}`,
        taskId);
    }
    const pending = reconcilePending(evaluated.unresolvedIdentities, ingested.governance);
    const commitReady = evaluated.commitReady && pending.length === 0;
    const fingerprint = computeFingerprint({
      inventoryDigest: ingested.inventorySnapshot.inventoryDigest, batch: ingested.batch, pending,
    });

    // 7. the cap. A ninth is never admitted.
    if (state.epoch.admitted.length >= MAX_EPOCH_ADMISSIONS) {
      throw fail("E_LOOP_CAP", `this epoch has already admitted ${MAX_EPOCH_ADMISSIONS}`, taskId);
    }
    // 8. wasSeen on the PRE-append history.
    const duplicate = state.epoch.admitted.find((a) => a.fingerprint === fingerprint) || null;
    const wasSeen = duplicate !== null;
    const eighth = state.epoch.admitted.length + 1 === MAX_EPOCH_ADMISSIONS;

    // 9. the FINAL disposition, still in memory.
    const admissionId = newId();
    let phase = "open";
    let closeReason = null;
    let lock = null;
    let status = "open";
    if (wasSeen) {
      phase = "closed";
      closeReason = { stage: "not-ready", kind: "repeat", class: null, code: null };
      lock = {
        reason: "repeat", fingerprint, at: Date.now(),
        duplicateOf: { epochOrdinal: duplicate.epochOrdinal, admissionId: duplicate.admissionId },
        lockedFindings: evaluated.findingIdentities,
      };
      status = "locked";
    } else if (!commitReady) {
      phase = "closed";
      closeReason = { stage: "not-ready", kind: "not-ready", class: null, code: null };
      if (eighth) {
        lock = { reason: "cap-exhausted", fingerprint, at: Date.now(), duplicateOf: null, lockedFindings: evaluated.findingIdentities };
        status = "locked";
      }
    }

    // 10. allocate and retain. The exclusive wx creation is a filesystem action owned by §D8.5 and
    // happens BEFORE the publication, never inside it.
    const batchRecordId = allocateBatchRecordId(index);
    const payloadText = buildPayload({
      taskId, batchRecordId, expectedInputProvenanceStoreDigest: sampled.storeTextDigest,
      batch: { ...ingested.batch, inventorySnapshot: ingested.inventorySnapshot },
      governance: ingested.governance,
    });
    const retainedPayloadPath = paths.payload(admissionId);
    let payloadCreated = false;
    try {
      const handle = fs.openSync(retainedPayloadPath, "wx");
      fs.writeFileSync(handle, `${payloadText}\n`, "utf8");
      fs.closeSync(handle);
      payloadCreated = true;
    } catch (error) {
      if (error && error.code === "EEXIST") {
        throw fail("E_LOOP_ID_EXHAUSTED", `a retained payload already occupies ${retainedPayloadPath}`, admissionId);
      }
      throw fail("E_LOOP_IO", `cannot retain the payload (${error && error.code})`, { path: retainedPayloadPath });
    }
    const payloadRawDigest = rawSha256(fs.readFileSync(retainedPayloadPath));

    const admission = {
      admissionId, at: Date.now(), epochOrdinal: state.epoch.ordinal, emissionId: emission.emissionId,
      reviewRawDigest, governanceRawDigest, fingerprint,
      commitReady,                                  // recorded AS COMPUTED, including true on a repeat
      batchRecordId, retainedPayloadPath, payloadRawDigest,
      admittedClaims: {
        taskId,
        baseProvenance: { ...ingested.batch.baseProvenance },
        inventoryDigest: ingested.batch.inventoryDigest,
      },
      findingIdentities: evaluated.findingIdentities,
      phase, closeReason,
    };

    // 11. ONE publication. There is no second admission publication, and no temporary open state is
    // ever durable for a repeat or an unready proposal.
    let published;
    try {
      published = publishState(paths, advance(state, {
        epoch: { ...state.epoch, admitted: [...state.epoch.admitted, admission] },
        observedIterations: state.observedIterations + 1,
        lastTwo: [{ fingerprint, epochOrdinal: state.epoch.ordinal, admissionId }, state.lastTwo[0]],
        currentAdmissionId: admissionId,
        pending,
        status, lock,
        knownRecordIds: mergeBaseline(state.knownRecordIds, baselineRecordIds(index)),
        knownDraftIds: mergeBaseline(state.knownDraftIds, baselineDraftIds(paths, taskId)),
      }));
    } catch (error) {
      // §D8.5 immediate failed-publication cleanup: this invocation created the file, still holds the
      // task lock, its publication is confirmed not to have landed, and no admission or intent
      // references this admissionId. Anything less certain is retained and diagnosed.
      if (payloadCreated) {
        const confirm = readState(repoRoot, taskId);
        const adopted = confirm.present
          && (confirm.state.epoch.admitted.some((a) => a.admissionId === admissionId)
            || (confirm.state.pendingCommit && confirm.state.pendingCommit.admissionId === admissionId));
        if (!adopted) { try { fs.rmSync(retainedPayloadPath, { force: true }); } catch { /* retained and diagnosed */ } }
      }
      throw error;
    }

    return freeze({
      revision: published.revision, admissionId, fingerprint, commitReady, wasSeen,
      admittedCount: published.epoch.admitted.length, retry: false,
      status: published.status, lock: published.lock, phase,
    });
  });
}

function allocateBatchRecordId(index) {
  const mint = makeIdFactory();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const id = mint("R");
    if (!index.records.has(id)) return id;
  }
  throw fail("E_LOOP_ID_EXHAUSTED", "three bounded attempts did not yield an unused batch record id");
}

// ============================================================================================
// 4. commitReviewedBatch
// ============================================================================================

export async function commitReviewedBatch(request) {
  requireArity(arguments.length, "commitReviewedBatch");
  const { repoRoot, taskId } = capture(request, ["repoRoot", "taskId"], "commitReviewedBatch");
  const paths = loopPaths(repoRoot, taskId);
  assertContainedPrefix(repoRoot, { create: true });

  return withLock(paths.taskLock, async () => {
    const { index, ts } = currentAuthority(repoRoot, taskId);
    const read = requireOwnState(repoRoot, taskId, ts);
    let state = reconcileSlots(paths, read.state).state;
    const admission = currentAdmission(state);
    if (admission === null || admission.phase !== "open") {
      throw fail("E_LOOP_NOT_COMMIT_READY", "there is no open current admission to commit", taskId);
    }
    if (!admission.commitReady) {
      throw fail("E_LOOP_NOT_COMMIT_READY", `admission ${admission.admissionId} is not commit-ready`, admission.admissionId);
    }
    if (state.pendingCommit !== null
        && !(state.pendingCommit.admissionId === admission.admissionId && state.pendingCommit.phase === "prepared")) {
      throw fail("E_LOOP_ATTEMPT_SPENT", "this admission's single writer chance is already spent", admission.admissionId);
    }

    // 1. named-record reconciliation, BEFORE any disposal.
    const namedRecord = index.records.get(admission.batchRecordId) || null;
    if (namedRecord !== null) {
      const expected = state.pendingCommit ? state.pendingCommit.expectedBatchRecord : null;
      if (expected !== null && canonicalJson(namedRecord) === canonicalJson(expected)) {
        // The same §D8.3 proof `beginTaskLoop` applies: the record AND the head pointing at it.
        const head = ts.committedProvenanceBatchRef || null;
        const headFault = headPointsAtFault(head, admission.batchRecordId);
        if (headFault !== null) {
          throw fail("E_LOOP_COMMIT_CONFLICT",
            `the named record ${admission.batchRecordId} exists but ${headFault}; failing closed with no repair`,
            admission.batchRecordId);
        }
        state = publishState(paths, adoptCommitted(state, state.pendingCommit, head, index));
        return freeze({
          ok: true, revision: state.revision, admissionId: admission.admissionId,
          batchRecordId: admission.batchRecordId, headRef: state.committed.headRef,
          batchDigest: state.committed.batchDigest, inventoryDigest: state.committed.inventoryDigest,
          phase: "committed",
        });
      }
      throw fail("E_LOOP_COMMIT_CONFLICT",
        `the named record ${admission.batchRecordId} already exists and does not match; failing closed`, admission.batchRecordId);
    }

    // 2. hash BEFORE parse.
    const preflight = (klass, code, message) => {
      const admitted = state.epoch.admitted.map((a) => (a.admissionId !== admission.admissionId ? a : {
        ...a, phase: "closed", closeReason: { stage: "preview", kind: "refused", class: klass, code },
      }));
      const clearIntent = state.pendingCommit !== null && state.pendingCommit.phase === "prepared";
      const eighth = state.epoch.admitted.length === MAX_EPOCH_ADMISSIONS;
      const next = advance(state, {
        epoch: { ...state.epoch, admitted },
        pendingCommit: clearIntent ? null : state.pendingCommit,
        ...(eighth ? {
          status: "locked",
          lock: {
            reason: "cap-exhausted", fingerprint: admission.fingerprint, at: Date.now(),
            duplicateOf: null, lockedFindings: admission.findingIdentities,
          },
        } : {}),
      });
      const published = publishState(paths, next);
      return freeze({
        ok: false, revision: published.revision, admissionId: admission.admissionId,
        stage: "preview", class: klass, code, phase: "closed", writerInvoked: false,
      });
    };

    if (!assertRegularOrAbsent(admission.retainedPayloadPath, "the retained payload")) {
      return preflight("LoopError", "E_LOOP_PAYLOAD_MOVED", "the retained payload is absent");
    }
    const bytes = fs.readFileSync(admission.retainedPayloadPath);
    if (rawSha256(bytes) !== admission.payloadRawDigest) {
      return preflight("LoopError", "E_LOOP_PAYLOAD_MOVED", "the retained payload's bytes have changed");
    }

    // 3. parse, then EVERY admitted claim at its exact nested path.
    const payloadText = bytes.toString("utf8");
    let parsed;
    try {
      parsed = JSON.parse(payloadText);
    } catch {
      return preflight("LoopError", "E_LOOP_PAYLOAD_MOVED", "the retained payload is no longer valid JSON");
    }
    const claimFault = admittedClaimFault(parsed, admission, state.pendingCommit);
    if (claimFault !== null) return preflight("LoopError", "E_LOOP_CLAIM_MISMATCH", claimFault);

    // 4. the approved TP v1.19 preview. Its typed cause is caught and carried VERBATIM.
    let expectedBatchRecord;
    try {
      expectedBatchRecord = previewTestProvenanceBatch({ repoRoot, payloadText }).expectedBatchRecord;
    } catch (error) {
      return preflight(error && error.name ? error.name : "Error", error && error.code ? error.code : null, "preview refused");
    }

    // 6. one publication: the prior committed cleared AND the prepared intent, together.
    if (state.pendingCommit === null) {
      state = publishState(paths, advance(state, {
        committed: null,
        pendingCommit: {
          admissionId: admission.admissionId,
          batchRecordId: admission.batchRecordId,
          expectedPreviousBatchRef: ts.committedProvenanceBatchRef || null,
          expectedInputProvenanceStoreDigest: parsed.expectedInputProvenanceStoreDigest,
          inventoryDigest: parsed.batchSnapshot.inventoryDigest,
          expectedBatchRecord,
          payloadRawDigest: admission.payloadRawDigest,
          retainedPayloadPath: admission.retainedPayloadPath,
          phase: "prepared", attemptedAt: null, outcome: null,
        },
      }));
    }
    // 7. attempted, published BEFORE the writer call.
    state = publishState(paths, advance(state, {
      pendingCommit: { ...state.pendingCommit, phase: "attempted", attemptedAt: Date.now() },
    }));

    // 8. the actual file-text writer.
    try {
      runTransactionFromPayloadText(repoRoot, "commit-test-provenance-batch", payloadText);
    } catch (error) {
      const klass = error && error.name ? error.name : "Error";
      const code = error && error.code ? error.code : null;
      const admitted = state.epoch.admitted.map((a) => (a.admissionId !== admission.admissionId ? a : {
        ...a, phase: "refused", closeReason: { stage: "writer", kind: "refused", class: klass, code },
      }));
      const eighth = state.epoch.admitted.length === MAX_EPOCH_ADMISSIONS;
      const published = publishState(paths, advance(state, {
        epoch: { ...state.epoch, admitted },
        pendingCommit: null,
        ...(eighth ? {
          status: "locked",
          lock: { reason: "cap-exhausted", fingerprint: admission.fingerprint, at: Date.now(), duplicateOf: null, lockedFindings: admission.findingIdentities },
        } : {}),
      }));
      return freeze({
        ok: false, revision: published.revision, admissionId: admission.admissionId,
        stage: "writer", class: klass, code, phase: "refused", writerInvoked: true,
      });
    }

    // The writer has just advanced the head, so the post-writer authority is re-read and the head is
    // taken from THAT TaskState. Synthesising it from the intent would record a head this operation
    // never actually observed, and the §D8.3 conflict rows would have nothing to disagree with.
    const afterStore = loadStore(repoRoot);
    const afterIndex = indexStore(afterStore.store);
    const afterTs = afterIndex.taskStates.get(taskId);
    const afterHead = afterTs ? afterTs.committedProvenanceBatchRef || null : null;
    const headFault = headPointsAtFault(afterHead, admission.batchRecordId);
    if (headFault !== null) {
      throw fail("E_LOOP_COMMIT_CONFLICT",
        `the writer reported success for ${admission.batchRecordId} but ${headFault}; failing closed with no repair`,
        admission.batchRecordId);
    }
    state = publishState(paths, adoptCommitted(state, state.pendingCommit, afterHead, afterIndex));
    return freeze({
      ok: true, revision: state.revision, admissionId: admission.admissionId,
      batchRecordId: admission.batchRecordId, headRef: state.committed.headRef,
      batchDigest: state.committed.batchDigest, inventoryDigest: state.committed.inventoryDigest,
      phase: "committed",
    });
  });
}

// EVERY admitted claim, at its exact nested path. baseProvenance and inventoryDigest live only inside
// batchSnapshot; a top-level inventoryDigest is the writer's own forbidden field and is not read here.
function admittedClaimFault(parsed, admission, intent) {
  const claims = admission.admittedClaims;
  if (parsed.taskId !== claims.taskId) return "the retained payload's taskId moved";
  if (!isPlainObject(parsed.batchSnapshot)) return "the retained payload states no batchSnapshot";
  if (parsed.batchSnapshot.taskId !== claims.taskId) return "the retained payload's batchSnapshot.taskId moved";
  if (canonicalJson(parsed.batchSnapshot.baseProvenance) !== canonicalJson(claims.baseProvenance)) {
    return "the retained payload's batchSnapshot.baseProvenance moved";
  }
  if (parsed.batchSnapshot.inventoryDigest !== claims.inventoryDigest) {
    return "the retained payload's batchSnapshot.inventoryDigest moved";
  }
  if (parsed.batchRecordId !== admission.batchRecordId) return "the retained payload's batchRecordId moved";
  if (intent !== null && parsed.expectedInputProvenanceStoreDigest !== intent.expectedInputProvenanceStoreDigest) {
    return "the retained payload's expectedInputProvenanceStoreDigest moved since the intent was prepared";
  }
  return null;
}

// ============================================================================================
// 5. recordVerification
// ============================================================================================

export async function recordVerification(request) {
  requireArity(arguments.length, "recordVerification");
  const { repoRoot, taskId } = capture(request, ["repoRoot", "taskId"], "recordVerification");
  const paths = loopPaths(repoRoot, taskId);
  assertContainedPrefix(repoRoot, { create: true });

  return withLock(paths.taskLock, async () => {
    const { ts } = currentAuthority(repoRoot, taskId);
    const read = requireOwnState(repoRoot, taskId, ts);
    let state = reconcileSlots(paths, read.state).state;
    const admission = currentAdmission(state);
    if (admission === null) throw fail("E_LOOP_NO_COMMIT", "there is no current admission to verify", taskId);

    // A historical outcome belongs to the CURRENT admission only. After an epoch open clears
    // currentAdmissionId this is unreachable, so a prior-epoch outcome is never borrowed.
    const slot = state.attempts.verification;
    if (slot !== null && slot.phase === "completed" && slot.admissionId === admission.admissionId) {
      return verificationResponse(state, admission, slot.attemptId, slot.outcome, true);
    }
    if (admission.phase !== "committed") {
      throw fail("E_LOOP_NO_COMMIT", `admission ${admission.admissionId} is ${admission.phase}, not committed`, admission.admissionId);
    }
    if (state.committed === null) throw fail("E_LOOP_NO_COMMIT", "no committed evidence is recorded", taskId);

    const attemptId = newId();
    state = publishState(paths, advance(state, {
      attempts: {
        ...state.attempts,
        verification: {
          attemptId, at: Date.now(), epochOrdinal: state.epoch.ordinal, emissionId: null,
          admissionId: admission.admissionId, headRef: state.committed.headRef, phase: "pending", outcome: null,
        },
      },
    }));

    let outcome;
    try {
      const verdict = await verifyCommittedBatch({ repoRoot, taskId });
      const bindingFault = verificationBindingFault(verdict, state, admission, repoRoot, taskId);
      outcome = bindingFault === null
        ? { kind: "pass", verdict: projectVerdict(verdict) }
        : { kind: "refused", class: "LoopError", code: "E_LOOP_VERIFICATION_MISBOUND" };
    } catch (error) {
      outcome = { kind: "refused", class: error && error.name ? error.name : "Error", code: error && error.code ? error.code : null };
    }

    const passed = outcome.kind === "pass";
    const counters = {
      adapterMisses: { ...state.counters.adapterMisses },
      staleBatchRejections: { ...state.counters.staleBatchRejections },
      lastStaleSubject: state.counters.lastStaleSubject,
    };
    // Only E_STEP6_SOURCE_STALE moves this counter. A misbinding is never counted here and
    // fabricates no counter of its own.
    if (outcome.kind === "refused" && outcome.code === "E_STEP6_SOURCE_STALE") {
      counters.staleBatchRejections.observed += 1;
      counters.lastStaleSubject = state.committed.headRef.ref;
    }
    const admitted = state.epoch.admitted.map((a) => (a.admissionId !== admission.admissionId ? a : {
      ...a,
      phase: passed ? "verified" : "refused",
      closeReason: passed ? null : { stage: "verification", kind: "refused", class: outcome.class, code: outcome.code },
    }));
    const eighth = state.epoch.admitted.length === MAX_EPOCH_ADMISSIONS;
    state = publishState(paths, advance(state, {
      epoch: { ...state.epoch, admitted },
      attempts: { ...state.attempts, verification: { ...state.attempts.verification, phase: "completed", outcome } },
      counters,
      currentPassInvalidated: passed ? false : state.currentPassInvalidated,
      ...(!passed && eighth ? {
        status: "locked",
        lock: { reason: "cap-exhausted", fingerprint: admission.fingerprint, at: Date.now(), duplicateOf: null, lockedFindings: admission.findingIdentities },
      } : {}),
    }));
    return verificationResponse(state, admissionOf(state, admission.admissionId), attemptId, outcome, false);
  });
}

const VERDICT_IDENTITY = ["taskId", "committedBatchRef", "batchDigest", "inventoryDigest", "baseTreeOid", "headViewDigest", "registryDigest"];
const projectVerdict = (verdict) => freeze(Object.fromEntries(VERDICT_IDENTITY.map((k) => [k, verdict[k]])));

// (a) the seven ACTUAL consumer identities against THIS admission's committed evidence, then (b) a
// FULLY VALIDATED store after-read comparing the whole task/base/head/expected-record identity. The
// consumer resolves its own head, and a per-task controller lock does not lock out other writer
// paths, so a converged verdict for a head this admission did not commit is not its success.
function verificationBindingFault(verdict, state, admission, repoRoot, taskId) {
  const c = state.committed;
  if (verdict.taskId !== state.taskId) return "the verdict names another task";
  if (canonicalJson(verdict.committedBatchRef) !== canonicalJson(c.headRef)) return "the verdict names another head";
  if (c.headRef.ref !== admission.batchRecordId) return "the committed head is not this admission's record";
  for (const [field, expected] of [
    ["batchDigest", c.batchDigest], ["inventoryDigest", c.inventoryDigest],
    ["baseTreeOid", c.baseProvenance.treeOid], ["headViewDigest", c.headViewDigest],
    ["registryDigest", c.registryDigest],
  ]) {
    if (verdict[field] !== expected) return `the verdict's ${field} does not equal this admission's committed evidence`;
  }
  const after = loadStore(repoRoot);
  validateStoreSchema(after.store);
  validateAll(after.store);
  const index = indexStore(after.store);
  const ts = index.taskStates.get(taskId);
  if (!ts) return "the task disappeared from the store during verification";
  if (ts.taskId !== state.taskId) return "the after-read task identity moved";
  if (canonicalJson(ts.baseProvenance) !== canonicalJson(state.baseProvenance)) return "the after-read base witness moved";
  if (canonicalJson(ts.committedProvenanceBatchRef) !== canonicalJson(c.headRef)) return "the head moved during verification";
  if (canonicalJson(index.records.get(c.headRef.ref)) !== canonicalJson(c.expectedBatchRecord)) {
    return "the named record no longer equals the retained expected record";
  }
  return null;
}

const verificationResponse = (state, admission, attemptId, outcome, historical) => freeze({
  ok: outcome.kind === "pass",
  revision: state.revision,
  admissionId: admission.admissionId,
  attemptId,
  historical,
  stage: "verification",
  outcome: freeze(outcome),
  currentPassInvalidated: state.currentPassInvalidated,
  phase: admission.phase,
});

// ============================================================================================
// 6. openEpoch
// ============================================================================================

export async function openEpoch(request) {
  requireArity(arguments.length, "openEpoch");
  const { repoRoot, taskId, witness } = capture(request, ["repoRoot", "taskId", "witness"], "openEpoch");
  const w = capture(witness, ["branch", "source", "recordId"], "openEpoch witness");
  if (!WITNESS_BRANCHES.includes(w.branch)) throw fail("E_API_ARGUMENTS", "witness.branch is unknown", "openEpoch");
  if (!WITNESS_SOURCES.includes(w.source)) throw fail("E_API_ARGUMENTS", "witness.source is unknown", "openEpoch");
  if (typeof w.recordId !== "string" || w.recordId === "") {
    throw fail("E_API_ARGUMENTS", "witness.recordId must be a non-empty string", "openEpoch");
  }
  const paths = loopPaths(repoRoot, taskId);
  assertContainedPrefix(repoRoot, { create: true });

  return withLock(paths.taskLock, async () => {
    const { index, ts } = currentAuthority(repoRoot, taskId);
    const read = requireOwnState(repoRoot, taskId, ts);
    const state = read.state;
    if (state.status !== "locked") throw fail("E_LOOP_NOT_LOCKED", "this epoch is not locked", taskId);
    if (state.pendingCommit !== null) {
      throw fail("E_LOOP_INTENT_UNRESOLVED", "a commit intent is unresolved; run begin to reconcile it", taskId);
    }
    const governance = readGovernance(paths, taskId);

    // 2. novelty against the OLD baselines. knownRecordIds is a BASELINE SNAPSHOT, not the current
    // store, so a record persisted after the last refresh is present now and absent here.
    const packageFor = w.source === "draft"
      ? (governance.packages || []).find((p) => p.recordId === w.recordId) || null : null;
    if (w.source === "draft" && packageFor === null) {
      throw fail("E_LOOP_WITNESS_UNAUTHORIZED", `no GovernancePackage declares ${w.recordId}`, w.recordId);
    }
    const packageDigest = packageFor === null ? null : computePackageDigest(packageFor);
    const isNew = !state.knownRecordIds.includes(w.recordId)
      && !state.knownDraftIds.includes(w.recordId)
      && !state.consumedWitnesses.some((c) => c.recordId === w.recordId
        && (packageDigest === null || c.packageDigest === packageDigest));
    if (!isNew) throw fail("E_LOOP_WITNESS_NOT_NEW", `witness ${w.recordId} is not new for this epoch`, w.recordId);

    // 3. authorize by branch.
    if (w.branch === "semantic-reconsideration") {
      authorizeReconsideration(state, w, packageFor, index);
    } else {
      authorizeTransitionGovernance({ state, witness: w, packageFor, governance, index, repoRoot, taskId });
    }

    // 4. union the baselines; 5. close and open atomically.
    const witnessRef = { branch: w.branch, source: w.source, recordId: w.recordId, packageDigest };
    const slots = resolvePendingSlots(state);
    const closedCount = state.epoch.admitted.length;
    const published = publishState(paths, advance(state, {
      knownRecordIds: [...new Set([...state.knownRecordIds, ...index.records.keys()])].sort(),
      knownDraftIds: [...new Set([...state.knownDraftIds, ...(governance.packages || []).map((p) => p.recordId)])].sort(),
      consumedWitnesses: [...state.consumedWitnesses, { recordId: w.recordId, packageDigest, branch: w.branch, atEpoch: state.epoch.ordinal }],
      epoch: { ordinal: state.epoch.ordinal + 1, openedBy: witnessRef, admitted: [] },
      closedEpochAdmissions: state.closedEpochAdmissions + closedCount,
      observedEpochs: state.observedEpochs + 1,
      lock: null, status: "open",
      currentAdmissionId: null, committed: null, lastEmission: null, pending: [],
      currentPassInvalidated: true,
      attempts: slots.attempts,
      counters: slots.counters,                     // lastStaleSubject and both counters PRESERVED
    }));
    return freeze({
      revision: published.revision, epochOrdinal: published.epoch.ordinal, openedBy: freeze(witnessRef),
      closedEpochAdmissions: published.closedEpochAdmissions, observedEpochs: published.observedEpochs,
    });
  });
}

function readGovernance(paths, taskId) {
  if (!fs.existsSync(paths.governance)) {
    throw fail("E_LOOP_WITNESS_UNAUTHORIZED", "no governance file is present to authorize an unlock", taskId);
  }
  return parseGovernanceDocument(fs.readFileSync(paths.governance, "utf8"), taskId, paths.governance);
}

// §D9.3, over the package's DECLARED fields only. No `pending` field enters it, so the draft witness
// reference is one-way and non-circular, and no undeclared field is smuggled in.
function computePackageDigest(pkg) {
  return sha256Hex(canonicalJson({
    recordId: pkg.recordId,
    branch: pkg.branch,
    // The SAME sorted-and-deduplicated projection the authorization below compares against. A raw
    // sort left the digest covering a list that could differ from the set actually authorized, and
    // its comparator never returned 0 for equal keys, which is not a valid comparator at all.
    findingKeys: sortFindingIdentities(pkg.findingKeys),
    transitionDraft: pkg.transitionDraft,
    successorClauseDraft: pkg.successorClauseDraft === undefined ? null : pkg.successorClauseDraft,
    witnessDraft: pkg.witnessDraft,
    semanticEvidenceRefs: sortTypedRefs(pkg.semanticEvidenceRefs),
  }));
}

// §D9.2/§D9.4. This branch invokes NONE of §D9.1a/b/c: it authorizes no transition, declares no
// evidence and needs no body comparands, so there is nothing for those steps to charge.
function authorizeReconsideration(state, w, packageFor, index) {
  const carrier = w.source === "draft" ? packageFor.witnessDraft : (index.records.get(w.recordId) || null);
  if (carrier === null) throw fail("E_LOOP_WITNESS_UNAUTHORIZED", `witness ${w.recordId} does not exist`, w.recordId);
  const bad = (m) => { throw fail("E_LOOP_WITNESS_UNAUTHORIZED", m, w.recordId); };
  if (carrier.kind !== "review-ruling") bad("a loopReconsideration carrier is a review-ruling");
  const testDiscipline = { kind: "discipline", discipline: "test" };
  if (!principalsEqual(carrier.by, testDiscipline) && !principalsEqual(carrier.by, { kind: "arbiter" })) {
    bad("a loopReconsideration is issued by the test discipline or an arbiter");
  }
  const annotation = carrier.loopReconsideration;
  if (!isPlainObject(annotation)) bad("the carrier states no loopReconsideration annotation");
  const members = Object.keys(annotation).sort();
  if (canonicalJson(members) !== canonicalJson(["decision", "findings", "lockedFingerprint", "taskId"])) {
    bad("loopReconsideration declares exactly {taskId, lockedFingerprint, findings, decision}");
  }
  if (annotation.taskId !== state.taskId) bad("loopReconsideration.taskId is not this task");
  if (carrier.subjectRef !== state.taskId) bad("the carrier's subjectRef is not this task");
  if (annotation.lockedFingerprint !== state.lock.fingerprint) bad("loopReconsideration.lockedFingerprint is not this lock's");
  if (annotation.decision !== "re-review") bad('loopReconsideration.decision must be "re-review"');

  const general = state.lock.lockedFindings.filter((i) => GENERAL_FINDING_KINDS.includes(i.kind));
  const offered = sortFindingIdentities(annotation.findings || []);
  if (canonicalJson(offered) !== canonicalJson(sortFindingIdentities(general))) {
    bad("loopReconsideration.findings must equal the locked general subset exactly");
  }
  // The genuine empty-WHOLE-set rule: findings [] is legal only when the ENTIRE locked set is empty.
  // A purely-ASSUM locked set has an empty general subset for a different reason, and an empty
  // witness there would name none of the real findings while granting budget past all of them.
  if (offered.length === 0 && state.lock.lockedFindings.length !== 0) {
    bad("an empty findings set is legal only when the entire locked set is empty; a purely assum-reading-change lock uses transition-governance");
  }
  if (w.source === "draft" && canonicalJson(packageFor.findingKeys.length ? sortFindingIdentities(packageFor.findingKeys) : [])
      !== canonicalJson(sortFindingIdentities(general))) {
    bad("the package's findingKeys must equal the locked general subset exactly");
  }
}

// §D9.1. The two sources are separate paths and neither dereferences a member the other lacks.
function authorizeTransitionGovernance({ state, witness: w, packageFor, governance, index, repoRoot, taskId }) {
  const bad = (m) => { throw fail("E_LOOP_WITNESS_UNAUTHORIZED", m, w.recordId); };
  let group;
  let findingKeys;
  let successorDraft;
  let citedRecords = governance.recordsToCreate || [];
  let witnessRecord;

  if (w.source === "persisted") {
    witnessRecord = index.records.get(w.recordId) || null;
    if (witnessRecord === null) bad(`persisted witness ${w.recordId} does not exist in the validated store`);
    if (witnessRecord.kind !== "review-ruling" && witnessRecord.kind !== "plan-gate") {
      bad(`persisted witness ${w.recordId} is a ${witnessRecord.kind}`);
    }
    // Select by ref ALONE, then charge the complete typed comparison, so a wrongly advertised kind is
    // a refusal rather than a group that silently fails to match.
    const matches = (governance.resolutions || []).filter((g) => g.governanceWitnessRef.ref === w.recordId);
    if (matches.length !== 1) bad(`${matches.length} governance.resolutions groups name witness ${w.recordId}; exactly one must`);
    group = matches[0];
    if (canonicalJson(group.governanceWitnessRef) !== canonicalJson({ kind: witnessRecord.kind, ref: w.recordId })) {
      bad(`the group advertises ${canonicalJson(group.governanceWitnessRef)} while the record is a ${witnessRecord.kind}`);
    }
    if (canonicalJson(group.transitionDraft.ackRef) !== canonicalJson(group.governanceWitnessRef)) {
      bad("the group's transitionDraft.ackRef does not equal its advertised governanceWitnessRef");
    }
    findingKeys = state.lock.lockedFindings.filter((i) =>
      i.kind === "assum-reading-change" && i.binding !== null && i.binding.clauseRef === group.subjectRef);
    if (findingKeys.length === 0) bad(`the retained lock holds no assum-reading-change identity bound to ${group.subjectRef}`);

    // Charge the ORIGINAL successorClauseDraft presence, then convert only ABSENCE.
    const successorId = group.transitionDraft.successor === undefined ? null : group.transitionDraft.successor;
    const stated = Object.prototype.hasOwnProperty.call(group, "successorClauseDraft");
    const presence = successorDraftPresenceFault(
      stated ? group.successorClauseDraft : undefined, successorId, successorId !== null && index.clauses.has(successorId));
    if (presence === "retire") bad(`group ${group.subjectRef} retires, so it carries no successorClauseDraft`);
    if (presence === "exists") bad(`successor ${successorId} already exists in pre-state, so it is cited rather than drafted`);
    successorDraft = stated ? group.successorClauseDraft : null;
  } else {
    group = packageFor;
    witnessRecord = packageFor.witnessDraft;
    if (witnessRecord.recordId !== w.recordId) bad("the package's witnessDraft names another record");
    if (index.records.has(w.recordId)) bad(`draft witness ${w.recordId} already exists in the pre-state`);
    if (canonicalJson(group.transitionDraft.ackRef) !== canonicalJson({ kind: witnessRecord.kind, ref: w.recordId })) {
      bad("the package's transitionDraft.ackRef does not name its own witnessDraft");
    }
    findingKeys = sortFindingIdentities(packageFor.findingKeys);
    if (findingKeys.length === 0) bad("a transition-governance package needs a non-empty findingKeys[]");
    const locked = new Set(state.lock.lockedFindings
      .filter((i) => i.kind === "assum-reading-change").map((i) => findingIdentityKey(i)));
    for (const identity of findingKeys) {
      if (!locked.has(findingIdentityKey(identity))) bad(`findingKeys names ${findingIdentityKey(identity)}, which is not a locked assum-reading-change identity`);
    }
    successorDraft = packageFor.successorClauseDraft === undefined ? null : packageFor.successorClauseDraft;
  }

  // §D9.1b: the authoritative body comparands, from the LOCKING admission's retained payload.
  const retained = readRetainedPayload(state);
  // §D9.1c: the per-finding equalities BEFORE the group digest.
  const drafted = new Map(citedRecords.map((r) => [r.recordId, r]));
  for (const identity of findingKeys) {
    const resultFault = retainedResultFault(retained.batchSnapshot.results, identity);
    if (resultFault !== null) bad(resultFault);
    const bodies = observedBodies(retainedResultFor(retained.batchSnapshot.results, identity));
    const covered = (group.semanticEvidenceRefs || []).some((ref) => {
      const record = drafted.get(ref.ref) || index.records.get(ref.ref) || null;
      if (record === null || record.kind !== ref.kind) return false;
      return evidenceCoverageFault(record, identity, state.taskId, bodies) === null;
    });
    if (!covered) bad(`no declared semanticEvidenceRef covers ${findingIdentityKey(identity)}`);
  }
  const expectedDigest = resolutionGroupDigest({
    subjectRef: group.subjectRef || group.transitionDraft.subject,
    action: group.transitionDraft.action,
    successor: group.transitionDraft.successor === undefined ? null : group.transitionDraft.successor,
    semanticEvidenceRefs: sortTypedRefs(group.semanticEvidenceRefs),
  });
  // §D9.1c draws the line itself: an UNCOVERED identity above is E_LOOP_WITNESS_UNAUTHORIZED, and
  // "only then" is the group digest compared — "the same E_WITNESS_COVERAGE rule the writer charges".
  // That is a source-owned typed cause, so it is raised through the store's own `reject` and keeps
  // its identity, rather than being remapped to this controller's code by the local `bad()`.
  if (witnessRecord.resolutionGroupDigest !== expectedDigest) {
    reject("E_WITNESS_COVERAGE",
      `governance witness ${w.recordId} does not cover this resolution group — resolutionGroupDigest mismatch `
      + "(a missing sibling evidence ref, or a different action/successor, changes the digest)",
      w.recordId);
  }

  // The ORIGINAL validated transitionDraft, unmodified. No property is added, removed, reordered or
  // normalized, so `assertCompatibilityPresence`'s hasOwnProperty rule sees what the caller wrote.
  assertProspectiveTransitionAuthority(index, {
    transitionDraft: group.transitionDraft,
    successorDraft,
    witness: { source: w.source, recordId: w.recordId, record: w.source === "draft" ? witnessRecord : null },
    citedRecords,
  });
}

// §D9.1b. Hash BEFORE parse, then every admitted claim, on the LOCKING admission (invariant 12).
function readRetainedPayload(state) {
  const admission = currentAdmission(state);
  if (admission === null) throw fail("E_LOOP_WITNESS_UNAUTHORIZED", "no locking admission is recorded", state.taskId);
  if (!assertRegularOrAbsent(admission.retainedPayloadPath, "the retained payload")) {
    throw fail("E_LOOP_PAYLOAD_MOVED", "the locking admission's retained payload is absent", admission.admissionId);
  }
  const bytes = fs.readFileSync(admission.retainedPayloadPath);
  if (rawSha256(bytes) !== admission.payloadRawDigest) {
    throw fail("E_LOOP_PAYLOAD_MOVED", "the locking admission's retained payload has changed", admission.admissionId);
  }
  const parsed = JSON.parse(bytes.toString("utf8"));
  const fault = admittedClaimFault(parsed, admission, null);
  if (fault !== null) throw fail("E_LOOP_CLAIM_MISMATCH", fault, admission.admissionId);
  return parsed;
}

// ============================================================================================
// 7. inspectLoopState  (read-only)
// ============================================================================================

export async function inspectLoopState(request) {
  requireArity(arguments.length, "inspectLoopState");
  const { repoRoot, taskId } = capture(request, ["repoRoot", "taskId"], "inspectLoopState");
  try {
    // The store/task read happens even when no control state exists, so an unknown task is DIAGNOSED
    // rather than reported as mere absence. Every evaluated cause is contained here.
    let authority = null;
    let diagnostic = null;
    try {
      authority = currentAuthority(repoRoot, taskId);
    } catch (error) {
      diagnostic = upstreamDiagnostic(error);
    }
    // A read-only operation creates nothing, so an absent prefix is simply absent state.
    const prefix = assertContainedPrefix(repoRoot, { create: false });
    if (!prefix.present) return unreadableInspection(diagnostic, false);
    const read = readState(repoRoot, taskId);
    if (!read.present) return unreadableInspection(diagnostic, false);
    const state = read.state;
    if (diagnostic === null && authority !== null) {
      const fault = contextFault(state, taskId, authority.ts);
      if (fault !== null) diagnostic = loopDiagnostic("E_LOOP_CONTEXT", fault);
    }
    return freeze({
      present: true, corrupt: false, diagnostic,
      revision: state.revision, status: state.status, epochOrdinal: state.epoch.ordinal,
      admittedCount: state.epoch.admitted.length, closedEpochAdmissions: state.closedEpochAdmissions,
      observedIterations: state.observedIterations, observedEpochs: state.observedEpochs,
      priorHistory: "unknown", lastTwo: freeze(state.lastTwo), lock: state.lock,
      taskId: state.taskId, baseProvenance: freeze({ ...state.baseProvenance }),
      currentAdmissionId: state.currentAdmissionId,
      currentAdmissionPhase: currentAdmission(state) === null ? null : currentAdmission(state).phase,
      currentPassInvalidated: state.currentPassInvalidated,
      committed: state.committed === null ? null : freeze({
        admissionId: state.committed.admissionId, headRef: state.committed.headRef,
        batchDigest: state.committed.batchDigest, inventoryDigest: state.committed.inventoryDigest,
        baseProvenance: state.committed.baseProvenance, headViewDigest: state.committed.headViewDigest,
        registryDigest: state.committed.registryDigest,
        expectedBatchRecord: state.committed.expectedBatchRecord,
      }),
      counters: freeze({
        adapterMisses: freeze({ ...state.counters.adapterMisses }),
        staleBatchRejections: freeze({ ...state.counters.staleBatchRejections }),
        lastStaleSubject: state.counters.lastStaleSubject,
      }),
      unresolvedSlots: freeze(SLOT_NAMES.filter((s) => state.attempts[s] !== null && state.attempts[s].phase === "pending")),
    });
  } catch (error) {
    if (error instanceof LoopError && error.code === "E_API_ARGUMENTS") throw error;
    const diagnostic = error instanceof LoopError
      ? loopDiagnostic(error.code, error.message) : upstreamDiagnostic(error);
    // §D2.3 makes "absent" and "corrupt" two DIFFERENT rows, and absence is detected as "no state
    // file". A state file that exists but does not parse or does not satisfy its contract is present
    // and corrupt; reporting it as absent would tell a reader that no loop was ever begun. The
    // projections stay null either way, because no valid field can be read out of a corrupt state.
    return unreadableInspection(diagnostic, diagnostic.loopCode === "E_LOOP_STATE_CORRUPT");
  }
}

const loopDiagnostic = (code, message) => freeze({ origin: "loop", code, class: "LoopError", message, loopCode: code });

// An upstream cause keeps its ACTUAL class, code and message; `code` is null when the cause has none,
// and a code is never fabricated. `loopCode` is the separately declared controller classification.
function upstreamDiagnostic(error) {
  const code = error && typeof error.code === "string" ? error.code : null;
  const loopCode = code === "E_LOOP_STATE_CORRUPT" ? "E_LOOP_STATE_CORRUPT"
    : code === "E_LOOP_CONTEXT" ? "E_LOOP_CONTEXT"
      : code === "E_LOOP_UNKNOWN_TASK" ? "E_LOOP_UNKNOWN_TASK"
        : code === "E_LOOP_IO" ? "E_LOOP_IO" : "E_LOOP_STATE_CORRUPT";
  return freeze({
    origin: code && code.startsWith("E_LOOP_") ? "loop" : "upstream",
    code,
    class: error && error.name ? error.name : "Error",
    message: error && error.message ? error.message : String(error),
    loopCode,
  });
}

// The one shape both unreadable cases return. `present` says whether a state file is there; `corrupt`
// says whether what is there could be read. They are independent booleans and are not collapsed.
const unreadableInspection = (diagnostic, corrupt) => freeze({
  present: corrupt, corrupt,
  diagnostic, revision: null, status: null, epochOrdinal: null, admittedCount: null,
  closedEpochAdmissions: null, observedIterations: null, observedEpochs: null,
  priorHistory: "unknown", lastTwo: freeze([null, null]), lock: null,
  taskId: null, baseProvenance: null, currentAdmissionId: null, currentAdmissionPhase: null,
  currentPassInvalidated: null, committed: null,
  counters: null,                                   // UNAVAILABLE, never a fabricated zero
  unresolvedSlots: freeze([]),
});

// ============================================================================================
// 8. evaluateGate  (read-only)
// ============================================================================================

export async function evaluateGate(request) {
  requireArity(arguments.length, "evaluateGate");
  const { repoRoot, taskId } = capture(request, ["repoRoot", "taskId"], "evaluateGate");

  // 0. the BEFORE inspection: without a declared baseline, "unchanged" has nothing to compare to.
  let before = null;
  try {
    const read = readState(repoRoot, taskId);
    before = read.present ? controlSnapshot(read.state) : null;
  } catch (error) {
    before = { fault: error };
  }

  const provenance = await evaluateProvenance(repoRoot, taskId);
  const loop = evaluateLoop(repoRoot, taskId, before, provenance);
  return freeze({ loop: freeze(loop), provenance: freeze(provenance), combined: loop.pass && provenance.pass });
}

const controlSnapshot = (state) => ({
  revision: state.revision, status: state.status, epochOrdinal: state.epoch.ordinal,
  currentAdmissionId: state.currentAdmissionId,
  currentAdmissionPhase: currentAdmission(state) === null ? null : currentAdmission(state).phase,
  lock: state.lock, currentPassInvalidated: state.currentPassInvalidated,
  committed: state.committed,
});

async function evaluateProvenance(repoRoot, taskId) {
  try {
    const first = currentAuthority(repoRoot, taskId);
    const head = first.ts.committedProvenanceBatchRef;
    if (!head) {
      return { pass: false, diagnostic: loopDiagnostic("E_LOOP_NO_COMMIT", "the task has no committed head"), headRef: null, verdict: null };
    }
    const record = first.index.records.get(head.ref);
    const preimage = batchInventoryPreimage(record);
    const verdict = await verifyCommittedBatch({ repoRoot, taskId });
    // §D12 source 6: repeat sources 1-4 FULLY VALIDATED, and compare them field by field. Comparing
    // only the head ref and the named record left sources 2's other two members unchecked, so a
    // TaskState whose taskId or base witness moved during the evaluation still read as unchanged.
    // Whole-store byte equality is deliberately NOT required, so an unrelated valid append passes.
    const after = currentAuthority(repoRoot, taskId);
    const identical = after.ts.taskId === first.ts.taskId
      && canonicalJson(after.ts.baseProvenance) === canonicalJson(first.ts.baseProvenance)
      && canonicalJson(after.ts.committedProvenanceBatchRef) === canonicalJson(head)
      && canonicalJson(after.index.records.get(head.ref)) === canonicalJson(record);
    const matched = verdict.taskId === first.ts.taskId
      && canonicalJson(verdict.committedBatchRef) === canonicalJson(head)
      && verdict.batchDigest === record.batchDigest
      && verdict.inventoryDigest === preimage.inventoryDigest
      && verdict.baseTreeOid === preimage.baseTreeOid
      && verdict.headViewDigest === preimage.headViewDigest
      && verdict.registryDigest === preimage.registryDigest;
    return {
      pass: identical && matched,
      diagnostic: identical && matched ? null
        : loopDiagnostic("E_LOOP_VERIFICATION_MISBOUND", identical ? "the verdict does not match its sources" : "the store moved during evaluation"),
      headRef: head,
      verdict: projectVerdict(verdict),
    };
  } catch (error) {
    return { pass: false, diagnostic: upstreamDiagnostic(error), headRef: null, verdict: null };
  }
}

function evaluateLoop(repoRoot, taskId, before, provenance) {
  const nope = (reason) => ({ pass: false, reason, revision: before && before.revision ? before.revision : null, epochOrdinal: null, admissionId: null });
  if (before === null) return nope("no-loop-state");
  if (before.fault) {
    return nope(before.fault.code === "E_LOOP_CONTEXT" ? "context-mismatch" : "corrupt-loop-state");
  }
  let read;
  let authority;
  try {
    read = readState(repoRoot, taskId);
    authority = currentAuthority(repoRoot, taskId);
  } catch (error) {
    return nope(error.code === "E_LOOP_CONTEXT" ? "context-mismatch" : "corrupt-loop-state");
  }
  if (!read.present) return nope("no-loop-state");
  const state = read.state;
  const after = controlSnapshot(state);
  if (canonicalJson(after) !== canonicalJson(before)) return nope("state-changed-during-evaluation");
  const base = { revision: state.revision, epochOrdinal: state.epoch.ordinal, admissionId: state.currentAdmissionId };
  if (contextFault(state, taskId, authority.ts) !== null) return { pass: false, reason: "context-mismatch", ...base };
  if (state.status !== "open") return { pass: false, reason: "locked", ...base };
  if (state.currentAdmissionId === null) return { pass: false, reason: "no-current-admission", ...base };
  const admission = currentAdmission(state);
  if (admission.phase !== "verified") return { pass: false, reason: "admission-not-verified", ...base };
  if (state.currentPassInvalidated) return { pass: false, reason: "pass-invalidated", ...base };
  if (state.committed === null || state.committed.admissionId !== state.currentAdmissionId) {
    return { pass: false, reason: "committed-identity-mismatch", ...base };
  }
  const head = authority.ts.committedProvenanceBatchRef;
  if (canonicalJson(head) !== canonicalJson(state.committed.headRef)
      || canonicalJson(authority.index.records.get(state.committed.headRef.ref)) !== canonicalJson(state.committed.expectedBatchRecord)) {
    return { pass: false, reason: "committed-identity-mismatch", ...base };
  }
  return { pass: true, reason: null, ...base };
}

// ============================================================================================
// CLI (§D3.3)
// ============================================================================================

const OPERATIONS = {
  begin: beginTaskLoop, emit: runProposalIteration, submit: submitReviewedProposal,
  commit: commitReviewedBatch, verify: recordVerification, "open-epoch": openEpoch,
  inspect: inspectLoopState, evaluate: evaluateGate,
};
const WITNESS_FLAGS = ["--witness-branch", "--witness-source", "--witness-record"];

export function parseArgs(argv) {
  const bad = (message) => { throw fail("E_API_ARGUMENTS", message, "cli"); };
  const [operation, ...rest] = argv;
  if (!operation || !Object.prototype.hasOwnProperty.call(OPERATIONS, operation)) {
    bad(`unknown operation ${JSON.stringify(operation)}; expected one of ${Object.keys(OPERATIONS).join(", ")}`);
  }
  const allowed = new Set(["--cwd", "--task", ...(operation === "open-epoch" ? WITNESS_FLAGS : [])]);
  const seen = new Map();
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    if (!flag.startsWith("--")) bad(`bare positional argument ${JSON.stringify(flag)}`);
    if (!allowed.has(flag)) bad(`unknown flag ${flag} for ${operation}`);
    if (seen.has(flag)) bad(`${flag} appears more than once`);
    const value = rest[i + 1];
    if (value === undefined || value.startsWith("--")) bad(`${flag} needs a value`);
    if (value === "") bad(`${flag} must not be empty`);
    seen.set(flag, value);
    i += 1;
  }
  if (!seen.has("--task")) bad("--task is required");
  if (operation === "open-epoch") {
    for (const flag of WITNESS_FLAGS) if (!seen.has(flag)) bad(`${flag} is required for open-epoch`);
    if (!WITNESS_BRANCHES.includes(seen.get("--witness-branch"))) bad("--witness-branch is not a known branch");
    if (!WITNESS_SOURCES.includes(seen.get("--witness-source"))) bad("--witness-source is not a known source");
  }
  const request = { repoRoot: seen.get("--cwd") || process.cwd(), taskId: seen.get("--task") };
  if (operation === "open-epoch") {
    request.witness = {
      branch: seen.get("--witness-branch"), source: seen.get("--witness-source"), recordId: seen.get("--witness-record"),
    };
  }
  return { operation, request };
}

export async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs(argv);
    const response = await OPERATIONS[parsed.operation](parsed.request);
    // ONE exit rule: 1 iff the operation threw OR returned an owned failure.
    const ownedFailure = response.ok === false || response.combined === false;
    const stream = ownedFailure ? process.stderr : process.stdout;
    stream.write(`${JSON.stringify(response, null, 2)}\n`);
    return ownedFailure ? 1 : 0;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: error && typeof error.code === "string" ? error.code : null,
      message: error && error.message ? error.message : String(error),
      detail: error && error.detail !== undefined ? error.detail : null,
    }, null, 2)}\n`);
    return 1;
  }
}

// The direct-CLI entry point. This is deliberately NOT the garden d5 `isInvokedDirectly()` cluster
// copy: it carries an extra conjunct those byte-identical sites do not, so it is named differently
// and stays outside that guard.
//
// TWO THINGS MUST BOTH HOLD.
//
// 1. This file is really the process entry, compared through `fs.realpathSync` and `fileURLToPath` —
//    the form the repository's other CLI entry points already use. The previous hand-written
//    comparison resolved `import.meta.url` by hand, so a space in an ancestor directory (which the
//    URL percent-encodes and that code never decoded) or a symlinked/junctioned ancestor (which it
//    never resolved) made the two sides differ and silently disabled the CLI — no output, exit 0.
//
// 2. This is not Node's test runner. The file name matches the runner's default `test-*` discovery
//    pattern, and the runner spawns the file as `node <file>`, so argv[1] IS this file and check 1
//    alone cannot tell a runner child from a direct run; the CLI would then run with no operation and
//    exit 1, failing the whole-suite `node --test`. `NODE_TEST_CONTEXT` is the marker Node's own
//    test-runner main reads to know it is a runner child. PRESENCE is the test — never truthiness,
//    which would read a deliberately empty value as "no runner", and never a fixed value or set,
//    because the value differs across supported Node versions and an unrecognised one must still mean
//    "in the runner".
//
//    It is narrowed by "no operation" so ONLY the discovery collision is suppressed: discovery always
//    arrives with no arguments, while a nested test may still spawn a real argument-bearing CLI child
//    without scrubbing the inherited marker. If a future Node ever passed arguments to a discovered
//    file this conjunct would stop matching — which the shipped `node --test` case detects, so that
//    direction fails loudly rather than silently.
function isDirectCliInvocation() {
  if (!process.argv[1]) return false;
  if (process.env.NODE_TEST_CONTEXT !== undefined && process.argv.slice(2).length === 0) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isDirectCliInvocation()) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
