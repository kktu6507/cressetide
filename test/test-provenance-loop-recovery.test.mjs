// TP v1.21 §D8: the commit preflight gates, §D8.3's recovery table, §D8.4's verification binding and
// §D8.5's retained-payload ownership.
//
// HOW INTERRUPTION IS SIMULATED, stated exactly. No process is killed. Each case drives the real
// operations to a real durable state and then edits ONLY the controller's own state file or its
// retained payload to stand in for what a crash would have left behind — the same durable evidence
// `beginTaskLoop` would find. The store, the writer and the consumer are always the real ones.
//
// SCOPE. Mechanical recovery behaviour on shipped synthetic fixtures. No reviewer ran; nothing here
// claims convergence or readiness.
import { test } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";

import {
  beginTaskLoop, runProposalIteration, submitReviewedProposal, commitReviewedBatch,
  recordVerification, evaluateGate, inspectLoopState,
} from "../cressetide/skills/vigil/scripts/test-provenance-loop.mjs";
import {
  loopPaths, advance, publishState, MAX_EPOCH_ADMISSIONS,
} from "../cressetide/skills/vigil/scripts/test-provenance-loop-state.mjs";
import {
  canonicalJson, loadStore, indexStore, applyTransaction, canonicalStoreBytes,
  CANONICAL_STORE_PATH,
} from "../cressetide/skills/vigil/scripts/provenance-store.mjs";
import {
  TASK, OPTS, withRepo, seedWorld, writeReview, writeGovernance, emptyGovernance,
  generalFinding, readLoopState, bumpHead,
} from "./fixtures/test-provenance-loop-fixture.mjs";

const refused = async (promise, what) => {
  let error = null;
  try { await promise; } catch (e) { error = e; }
  assert.ok(error, `${what}: expected a refusal, got none`);
  return error;
};

// A world driven to ONE open, commit-ready admission — the state every §D8 case starts from.
async function readyToCommit(repo) {
  const world = await seedWorld(repo);
  await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
  await runProposalIteration({ repoRoot: repo.root, taskId: TASK });
  writeReview(repo, { base: world.base });
  writeGovernance(repo, emptyGovernance());
  const admitted = await submitReviewedProposal({ repoRoot: repo.root, taskId: TASK });
  assert.strictEqual(admitted.commitReady, true);
  assert.strictEqual(admitted.phase, "open");
  return { world, admission: readLoopState(repo).epoch.admitted[0], paths: loopPaths(repo.root, TASK) };
}

// --- 1. the commit preflight gates (§D8.1 steps 2-5) ------------------------------------------------------

test("a moved retained payload refuses at the HASH gate, before any parse, preview or writer call",
  () => withRepo(async (repo) => {
    const { admission } = await readyToCommit(repo);
    const storeBefore = fs.readFileSync(`${repo.root}/${CANONICAL_STORE_PATH}`, "utf8");
    // Byte-different but still valid JSON: only a byte comparison can tell.
    const text = fs.readFileSync(admission.retainedPayloadPath, "utf8");
    fs.writeFileSync(admission.retainedPayloadPath, `${text.trimEnd()}  \n`, "utf8");

    const outcome = await commitReviewedBatch({ repoRoot: repo.root, taskId: TASK });
    assert.strictEqual(outcome.ok, false);
    assert.strictEqual(outcome.stage, "preview");
    assert.strictEqual(outcome.code, "E_LOOP_PAYLOAD_MOVED");
    assert.strictEqual(outcome.class, "LoopError");
    assert.strictEqual(outcome.phase, "closed", "the response phase matches the persisted phase");
    assert.strictEqual(outcome.writerInvoked, false);

    const state = readLoopState(repo);
    assert.strictEqual(state.epoch.admitted[0].phase, "closed");
    assert.deepStrictEqual(state.epoch.admitted[0].closeReason,
      { stage: "preview", kind: "refused", class: "LoopError", code: "E_LOOP_PAYLOAD_MOVED" });
    assert.strictEqual(state.pendingCommit, null, "no intent was created");
    assert.strictEqual(fs.readFileSync(`${repo.root}/${CANONICAL_STORE_PATH}`, "utf8"), storeBefore,
      "the store is untouched");
  }));

test("a moved ADMITTED CLAIM refuses after the parse and before the preview", () => withRepo(async (repo) => {
  const { admission } = await readyToCommit(repo);
  // Rewrite the payload so its bytes hash to the RECORDED digest is impossible; instead move the
  // claim and re-record the digest, so the hash gate passes and the claim gate is what refuses.
  const parsed = JSON.parse(fs.readFileSync(admission.retainedPayloadPath, "utf8"));
  parsed.batchSnapshot.inventoryDigest = "0".repeat(64);
  const moved = `${canonicalJson(parsed)}\n`;
  fs.writeFileSync(admission.retainedPayloadPath, moved, "utf8");
  const state = readLoopState(repo);
  const admitted = state.epoch.admitted.map((a) => ({
    ...a,
    payloadRawDigest: crypto.createHash("sha256").update(fs.readFileSync(admission.retainedPayloadPath)).digest("hex"),
  }));
  publishState(loopPaths(repo.root, TASK), advance(state, { epoch: { ...state.epoch, admitted } }));

  const outcome = await commitReviewedBatch({ repoRoot: repo.root, taskId: TASK });
  assert.strictEqual(outcome.ok, false);
  assert.strictEqual(outcome.code, "E_LOOP_CLAIM_MISMATCH");
  assert.strictEqual(outcome.writerInvoked, false);
  assert.strictEqual(readLoopState(repo).epoch.admitted[0].phase, "closed");
}));

test("a preview refusal carries the UPSTREAM class and code verbatim and invokes no writer",
  () => withRepo(async (repo) => {
    const { admission } = await readyToCommit(repo);
    // Move the store so the payload's captured pre-state no longer holds: the approved preview helper
    // raises its own E_CAS_MISMATCH, which the controller carries through unchanged.
    const loaded = loadStore(repo.root);
    const moved = applyTransaction(loaded.store, "append-source", {
      source: {
        sourceId: "S-later", contentKind: "requirement", driftMode: "snapshot-only",
        locator: "conversation#2", excerpt: "an unrelated later source",
      },
    }, OPTS);
    fs.writeFileSync(`${repo.root}/${CANONICAL_STORE_PATH}`, canonicalStoreBytes(moved), "utf8");

    const outcome = await commitReviewedBatch({ repoRoot: repo.root, taskId: TASK });
    assert.strictEqual(outcome.ok, false);
    assert.strictEqual(outcome.stage, "preview");
    assert.strictEqual(outcome.code, "E_CAS_MISMATCH", "the preview's OWN code, never remapped");
    assert.strictEqual(outcome.class, "ProvenanceError", "and its own class");
    assert.strictEqual(outcome.writerInvoked, false);
    assert.deepStrictEqual(readLoopState(repo).epoch.admitted[0].closeReason,
      { stage: "preview", kind: "refused", class: "ProvenanceError", code: "E_CAS_MISMATCH" });
    assert.strictEqual(admission.batchRecordId.startsWith("R-"), true);
    assert.strictEqual(indexStore(loadStore(repo.root).store).records.has(admission.batchRecordId), false,
      "no record was written");
  }));

test("a preflight refusal on the EIGHTH admission also locks cap-exhausted", () => withRepo(async (repo) => {
  const world = await seedWorld(repo);
  await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
  for (let n = 0; n < MAX_EPOCH_ADMISSIONS - 1; n += 1) {
    bumpHead(repo, n);
    // eslint-disable-next-line no-await-in-loop
    await runProposalIteration({ repoRoot: repo.root, taskId: TASK });
    writeReview(repo, { base: world.base, findings: [generalFinding()] });
    writeGovernance(repo, emptyGovernance());
    // eslint-disable-next-line no-await-in-loop
    await submitReviewedProposal({ repoRoot: repo.root, taskId: TASK });
  }
  // The eighth is CLEAN, so it is admitted open and commit-ready.
  bumpHead(repo, 99);
  await runProposalIteration({ repoRoot: repo.root, taskId: TASK });
  writeReview(repo, { base: world.base });
  // §D5.4's declared inventoryDigest is bound to the emission under review, so the governance file is
  // restated for THIS emission rather than left describing the seventh.
  writeGovernance(repo, emptyGovernance());
  const eighth = await submitReviewedProposal({ repoRoot: repo.root, taskId: TASK });
  assert.strictEqual(eighth.admittedCount, MAX_EPOCH_ADMISSIONS);
  assert.strictEqual(eighth.phase, "open");
  assert.strictEqual(eighth.status, "open", "a verified eighth may still converge");

  const admission = readLoopState(repo).epoch.admitted[MAX_EPOCH_ADMISSIONS - 1];
  fs.writeFileSync(admission.retainedPayloadPath, `${fs.readFileSync(admission.retainedPayloadPath, "utf8")} `, "utf8");
  const outcome = await commitReviewedBatch({ repoRoot: repo.root, taskId: TASK });
  assert.strictEqual(outcome.ok, false);
  const state = readLoopState(repo);
  assert.strictEqual(state.status, "locked");
  assert.strictEqual(state.lock.reason, "cap-exhausted");
  assert.strictEqual(state.lock.fingerprint, admission.fingerprint, "invariant 12 holds in this state");
}));

// --- 2. §D8.3 recovery -----------------------------------------------------------------------------------

test("prepared with the named record ABSENT is resumable once, with no duplicate write",
  () => withRepo(async (repo) => {
    const { admission, paths } = await readyToCommit(repo);
    // The durable evidence a crash between the prepare and the writer call would leave.
    const state = readLoopState(repo);
    const preview = (await import("../cressetide/skills/vigil/scripts/provenance-store.mjs"))
      .previewTestProvenanceBatch({
        repoRoot: repo.root,
        payloadText: fs.readFileSync(admission.retainedPayloadPath, "utf8"),
      });
    publishState(paths, advance(state, {
      committed: null,
      pendingCommit: {
        admissionId: admission.admissionId, batchRecordId: admission.batchRecordId,
        expectedPreviousBatchRef: null,
        expectedInputProvenanceStoreDigest: preview.inputProvenanceStoreDigest,
        inventoryDigest: admission.admittedClaims.inventoryDigest,
        expectedBatchRecord: preview.expectedBatchRecord,
        payloadRawDigest: admission.payloadRawDigest,
        retainedPayloadPath: admission.retainedPayloadPath,
        phase: "prepared", attemptedAt: null, outcome: null,
      },
    }));

    const begun = await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
    assert.strictEqual(begun.reconciled, "prepared-resumable");
    assert.strictEqual(readLoopState(repo).pendingCommit.phase, "prepared", "the intent survives untouched");

    const resumed = await commitReviewedBatch({ repoRoot: repo.root, taskId: TASK });
    assert.strictEqual(resumed.ok, true, JSON.stringify(resumed));
    assert.strictEqual(resumed.batchRecordId, admission.batchRecordId, "the SAME id, no duplicate write");
    const records = indexStore(loadStore(repo.root).store).records;
    assert.strictEqual(records.has(admission.batchRecordId), true);
    assert.strictEqual([...records.values()].filter((r) => r.kind === "provenance-batch").length, 1,
      "exactly one batch record exists");
  }));

test("prepared with the named record PRESENT and matching is adopted without re-writing",
  () => withRepo(async (repo) => {
    const { admission, paths } = await readyToCommit(repo);
    const committed = await commitReviewedBatch({ repoRoot: repo.root, taskId: TASK });
    assert.strictEqual(committed.ok, true);
    const afterCommit = readLoopState(repo);
    const storeBytes = fs.readFileSync(`${repo.root}/${CANONICAL_STORE_PATH}`, "utf8");

    // Rewind the controller's own bookkeeping to `prepared` while the record really exists.
    publishState(paths, advance(afterCommit, {
      committed: null,
      epoch: {
        ...afterCommit.epoch,
        admitted: afterCommit.epoch.admitted.map((a) => ({ ...a, phase: "open" })),
      },
      pendingCommit: {
        admissionId: admission.admissionId, batchRecordId: admission.batchRecordId,
        expectedPreviousBatchRef: null,
        expectedInputProvenanceStoreDigest: afterCommit.committed.payloadRawDigest,
        inventoryDigest: afterCommit.committed.inventoryDigest,
        expectedBatchRecord: afterCommit.committed.expectedBatchRecord,
        payloadRawDigest: admission.payloadRawDigest,
        retainedPayloadPath: admission.retainedPayloadPath,
        phase: "prepared", attemptedAt: null, outcome: null,
      },
    }));

    const begun = await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
    assert.strictEqual(begun.reconciled, "adopted");
    const state = readLoopState(repo);
    assert.strictEqual(state.pendingCommit, null);
    assert.strictEqual(state.committed.admissionId, admission.admissionId);
    assert.strictEqual(state.epoch.admitted[0].phase, "committed");
    assert.strictEqual(fs.readFileSync(`${repo.root}/${CANONICAL_STORE_PATH}`, "utf8"), storeBytes,
      "adoption re-writes nothing");
  }));

// §D8.3:781 states what recovery PROVES: "the immutable named batch record, its taskId,
// inventoryDigest, previousBatchRef AND the head pointing at it", and the conflict row is "record
// present but head OR digest conflicts". A record that exists while the task's typed head points
// elsewhere is that row — the write may have landed without the head advancing — so adopting it would
// publish a `committed` naming a head this admission never installed.
// The store is NEVER hand-edited into an invalid shape here: pointing a head at a record that does
// not exist is E_DANGLING_REF and clearing a head that a batch chain needs is E_HEAD_STATE, both of
// which the store's own validation catches first — correctly, and before any recovery runs. So the
// conflict is reached the way it actually happens: a SECOND real commit advances the head, and the
// intent left behind still names the FIRST batch record, which is still present and still matching.
test("a matching named record whose head has since moved on is a COMMIT CONFLICT, prepared and attempted",
  () => withRepo(async (repo) => {
    for (const phase of ["prepared", "attempted"]) {
      // eslint-disable-next-line no-await-in-loop
      await withRepo(async (inner) => {
        const { world, admission, paths } = await readyToCommit(inner);
        assert.strictEqual((await commitReviewedBatch({ repoRoot: inner.root, taskId: TASK })).ok, true);
        const first = readLoopState(inner).committed;

        // A second real cycle: the writer mints a second batch record and advances the head to it.
        await recordVerification({ repoRoot: inner.root, taskId: TASK });
        bumpHead(inner, 42);
        await runProposalIteration({ repoRoot: inner.root, taskId: TASK });
        writeReview(inner, { base: world.base });
        writeGovernance(inner, emptyGovernance());
        await submitReviewedProposal({ repoRoot: inner.root, taskId: TASK });
        assert.strictEqual((await commitReviewedBatch({ repoRoot: inner.root, taskId: TASK })).ok, true);

        const now = readLoopState(inner);
        assert.notStrictEqual(now.committed.headRef.ref, first.headRef.ref, "the head really moved on");

        // The interruption: an unresolved intent still naming the FIRST record.
        publishState(paths, advance(now, {
          committed: null,
          epoch: {
            ...now.epoch,
            admitted: now.epoch.admitted.map((a) => (a.admissionId !== admission.admissionId ? a : { ...a, phase: "open" })),
          },
          pendingCommit: {
            admissionId: admission.admissionId, batchRecordId: first.headRef.ref,
            expectedPreviousBatchRef: null,
            expectedInputProvenanceStoreDigest: "0".repeat(64),
            inventoryDigest: first.inventoryDigest,
            expectedBatchRecord: first.expectedBatchRecord,
            payloadRawDigest: admission.payloadRawDigest,
            retainedPayloadPath: admission.retainedPayloadPath,
            phase, attemptedAt: phase === "attempted" ? Date.now() : null, outcome: null,
          },
        }));
        const before = readLoopState(inner);

        const error = await refused(beginTaskLoop({ repoRoot: inner.root, taskId: TASK }),
          `${phase} whose head has moved on`);
        assert.strictEqual(error.code, "E_LOOP_COMMIT_CONFLICT", `${phase}: ${error.message}`);
        assert.match(error.message, /committed head points at/, phase);

        const after = readLoopState(inner);
        assert.strictEqual(after.revision, before.revision, `${phase}: fails closed, publishing no repair`);
        assert.strictEqual(after.committed, null, `${phase}: nothing was adopted`);
        assert.strictEqual(after.pendingCommit.phase, phase, `${phase}: the intent is left exactly as found`);
      }, `ctide-loop-head-${phase}-`);
    }
  }));

test("attempted with the named record ABSENT is UNKNOWN and spent, never retriable",
  () => withRepo(async (repo) => {
    const { admission, paths } = await readyToCommit(repo);
    const state = readLoopState(repo);
    publishState(paths, advance(state, {
      committed: null,
      pendingCommit: {
        admissionId: admission.admissionId, batchRecordId: admission.batchRecordId,
        expectedPreviousBatchRef: null, expectedInputProvenanceStoreDigest: "0".repeat(64),
        inventoryDigest: admission.admittedClaims.inventoryDigest,
        expectedBatchRecord: { recordId: admission.batchRecordId, kind: "provenance-batch" },
        payloadRawDigest: admission.payloadRawDigest,
        retainedPayloadPath: admission.retainedPayloadPath,
        phase: "attempted", attemptedAt: Date.now(), outcome: null,
      },
    }));

    const begun = await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
    assert.strictEqual(begun.reconciled, "attempt-unknown");
    const after = readLoopState(repo);
    assert.strictEqual(after.epoch.admitted[0].phase, "refused");
    assert.deepStrictEqual(after.epoch.admitted[0].closeReason,
      { stage: "writer", kind: "unknown", class: null, code: null },
      "an UNKNOWN outcome, never a known non-attempt");
    assert.strictEqual(after.pendingCommit, null, "the intent is resolved as spent");
    // Not retriable: the admission is terminal, so commit refuses and a fresh cycle is required.
    assert.strictEqual((await refused(commitReviewedBatch({ repoRoot: repo.root, taskId: TASK }), "a retry")).code,
      "E_LOOP_NOT_COMMIT_READY");
    bumpHead(repo, 7);
    await runProposalIteration({ repoRoot: repo.root, taskId: TASK });
  }));

test("attempted with a CONFLICTING named record fails closed with no repair", () => withRepo(async (repo) => {
  const { admission, paths } = await readyToCommit(repo);
  await commitReviewedBatch({ repoRoot: repo.root, taskId: TASK });
  const afterCommit = readLoopState(repo);
  const storeBytes = fs.readFileSync(`${repo.root}/${CANONICAL_STORE_PATH}`, "utf8");

  publishState(paths, advance(afterCommit, {
    committed: null,
    pendingCommit: {
      admissionId: admission.admissionId, batchRecordId: admission.batchRecordId,
      expectedPreviousBatchRef: null, expectedInputProvenanceStoreDigest: "0".repeat(64),
      inventoryDigest: afterCommit.committed.inventoryDigest,
      // A retained expectation the persisted record does NOT match.
      expectedBatchRecord: { ...afterCommit.committed.expectedBatchRecord, batchDigest: "0".repeat(64) },
      payloadRawDigest: admission.payloadRawDigest,
      retainedPayloadPath: admission.retainedPayloadPath,
      phase: "attempted", attemptedAt: Date.now(), outcome: null,
    },
  }));

  const error = await refused(beginTaskLoop({ repoRoot: repo.root, taskId: TASK }), "a conflicting record");
  assert.strictEqual(error.code, "E_LOOP_COMMIT_CONFLICT");
  assert.strictEqual(fs.readFileSync(`${repo.root}/${CANONICAL_STORE_PATH}`, "utf8"), storeBytes, "no repair");
  assert.strictEqual(readLoopState(repo).pendingCommit.phase, "attempted", "and no state change");
}));

// --- 3. pending-slot recovery (§D4.1) ------------------------------------------------------------------------

test("a recovered pending VERIFICATION slot closes the admission it names", () => withRepo(async (repo) => {
  const { admission, paths } = await readyToCommit(repo);
  await commitReviewedBatch({ repoRoot: repo.root, taskId: TASK });
  const state = readLoopState(repo);
  assert.strictEqual(state.epoch.admitted[0].phase, "committed");

  // The durable evidence a crash during the consumer run would leave.
  publishState(paths, advance(state, {
    attempts: {
      ...state.attempts,
      verification: {
        attemptId: "a".repeat(32), at: Date.now(), epochOrdinal: 1, emissionId: null,
        admissionId: admission.admissionId, headRef: state.committed.headRef,
        phase: "pending", outcome: null,
      },
    },
  }));

  const begun = await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
  assert.deepStrictEqual(begun.resolvedPendingSlots, ["verification"]);
  const after = readLoopState(repo);
  assert.strictEqual(after.attempts.verification.phase, "completed");
  assert.strictEqual(after.attempts.verification.outcome.kind, "unknown");
  assert.strictEqual(after.counters.staleBatchRejections.uncertain, true, "an unknown is never counted as zero");
  assert.strictEqual(after.epoch.admitted[0].phase, "refused",
    "the admission it names is CLOSED, not left committed forever");
  assert.deepStrictEqual(after.epoch.admitted[0].closeReason,
    { stage: "verification", kind: "unknown", class: null, code: null });
  assert.strictEqual(after.committed !== null, true, "committed evidence is retained");
  // Terminal, so a new cycle is possible: this is not a dead end.
  bumpHead(repo, 5);
  await runProposalIteration({ repoRoot: repo.root, taskId: TASK });
}));

test("a read-only inspection reports a pending slot as it stands and reconciles nothing",
  () => withRepo(async (repo) => {
    const { admission, paths } = await readyToCommit(repo);
    await commitReviewedBatch({ repoRoot: repo.root, taskId: TASK });
    const state = readLoopState(repo);
    const published = publishState(paths, advance(state, {
      attempts: {
        ...state.attempts,
        verification: {
          attemptId: "a".repeat(32), at: Date.now(), epochOrdinal: 1, emissionId: null,
          admissionId: admission.admissionId, headRef: state.committed.headRef,
          phase: "pending", outcome: null,
        },
      },
    }));
    const inspected = await inspectLoopState({ repoRoot: repo.root, taskId: TASK });
    assert.deepStrictEqual(inspected.unresolvedSlots, ["verification"]);
    assert.strictEqual(inspected.currentAdmissionPhase, "committed", "reported as it stands");
    assert.strictEqual(readLoopState(repo).revision, published.revision, "nothing was published");
  }));

// --- 4. §D8.4 verification binding ----------------------------------------------------------------------------

test("a consumer pass for a head this admission did not commit is a MISBINDING, with no stale counter",
  () => withRepo(async (repo) => {
    const { paths } = await readyToCommit(repo);
    await commitReviewedBatch({ repoRoot: repo.root, taskId: TASK });
    const state = readLoopState(repo);
    // The controller's own committed evidence claims a different batch digest than the store's
    // record carries: the seven-field identity comparison must refuse before any phase change.
    publishState(paths, advance(state, {
      committed: { ...state.committed, batchDigest: "0".repeat(64) },
    }));

    const outcome = await recordVerification({ repoRoot: repo.root, taskId: TASK });
    assert.strictEqual(outcome.ok, false);
    assert.strictEqual(outcome.stage, "verification");
    assert.strictEqual(outcome.outcome.kind, "refused");
    assert.strictEqual(outcome.outcome.code, "E_LOOP_VERIFICATION_MISBOUND");
    assert.strictEqual(outcome.outcome.class, "LoopError");
    assert.strictEqual(outcome.phase, "refused");

    const after = readLoopState(repo);
    assert.strictEqual(after.counters.staleBatchRejections.observed, 0,
      "a misbinding is NOT a stale refusal and fabricates no counter");
    assert.strictEqual(after.counters.staleBatchRejections.uncertain, false);
    assert.strictEqual(after.counters.lastStaleSubject, null);
    assert.strictEqual(after.currentPassInvalidated, true, "the pass claim is withheld");
    assert.ok(after.committed !== null, "committed evidence is retained");
  }));

test("a head moved by another writer path during verification is caught by the validated after-read",
  () => withRepo(async (repo) => {
    const { paths } = await readyToCommit(repo);
    await commitReviewedBatch({ repoRoot: repo.root, taskId: TASK });
    const state = readLoopState(repo);
    // The controller's expected record no longer equals the named record in the store.
    publishState(paths, advance(state, {
      committed: {
        ...state.committed,
        expectedBatchRecord: { ...state.committed.expectedBatchRecord, taskId: "TASK-OTHER" },
      },
    }));
    const outcome = await recordVerification({ repoRoot: repo.root, taskId: TASK });
    assert.strictEqual(outcome.ok, false);
    assert.strictEqual(outcome.outcome.code, "E_LOOP_VERIFICATION_MISBOUND");
  }));

test("an unrelated valid store append does NOT fail verification or the gate", () => withRepo(async (repo) => {
  await readyToCommit(repo);
  await commitReviewedBatch({ repoRoot: repo.root, taskId: TASK });

  // A legitimate, unrelated append: the store text moves but the named record and head do not.
  const loaded = loadStore(repo.root);
  const appended = applyTransaction(loaded.store, "append-source", {
    source: {
      sourceId: "S-unrelated", contentKind: "requirement", driftMode: "snapshot-only",
      locator: "conversation#9", excerpt: "an unrelated later source",
    },
  }, OPTS);
  fs.writeFileSync(`${repo.root}/${CANONICAL_STORE_PATH}`, canonicalStoreBytes(appended), "utf8");
  assert.notStrictEqual(loadStore(repo.root).digest, loaded.digest, "the store text really moved");

  const verified = await recordVerification({ repoRoot: repo.root, taskId: TASK });
  assert.strictEqual(verified.ok, true, JSON.stringify(verified.outcome));
  const gate = await evaluateGate({ repoRoot: repo.root, taskId: TASK });
  assert.strictEqual(gate.combined, true,
    "whole-store byte equality is never required, so a legitimate append is accepted");
}));

test("a stale Step 6 refusal counts once and names its subject; a later unknown sets uncertainty",
  () => withRepo(async (repo) => {
    const { paths } = await readyToCommit(repo);
    await commitReviewedBatch({ repoRoot: repo.root, taskId: TASK });
    const state = readLoopState(repo);

    // Simulate the durable evidence of a completed stale refusal, then of a lost outcome, using only
    // the controller's own state file — the consumer itself is never faked.
    const stale = publishState(paths, advance(state, {
      epoch: {
        ...state.epoch,
        admitted: state.epoch.admitted.map((a) => ({
          ...a, phase: "refused",
          closeReason: { stage: "verification", kind: "refused", class: "CommittedBatchError", code: "E_STEP6_SOURCE_STALE" },
        })),
      },
      attempts: {
        ...state.attempts,
        verification: {
          attemptId: "b".repeat(32), at: Date.now(), epochOrdinal: 1, emissionId: null,
          admissionId: state.currentAdmissionId, headRef: state.committed.headRef,
          phase: "completed",
          outcome: { kind: "refused", class: "CommittedBatchError", code: "E_STEP6_SOURCE_STALE" },
        },
      },
      counters: {
        ...state.counters,
        staleBatchRejections: { observed: 1, uncertain: false },
        lastStaleSubject: state.committed.headRef.ref,
      },
    }));
    assert.strictEqual(stale.counters.lastStaleSubject, state.committed.headRef.ref,
      "the NAMED head ref string, never a typed object");

    // A historical re-ask returns the recorded slot, mints no attempt and counts nothing.
    const historical = await recordVerification({ repoRoot: repo.root, taskId: TASK });
    assert.strictEqual(historical.historical, true);
    assert.strictEqual(historical.ok, false, "ok is derived from the recorded outcome");
    assert.strictEqual(historical.outcome.code, "E_STEP6_SOURCE_STALE");
    assert.strictEqual(readLoopState(repo).revision, stale.revision, "nothing was published");
    assert.strictEqual(readLoopState(repo).counters.staleBatchRejections.observed, 1, "counted once");
  }));

test("the gate reports provenance independently of loop-state movement", () => withRepo(async (repo) => {
  const { paths } = await readyToCommit(repo);
  await commitReviewedBatch({ repoRoot: repo.root, taskId: TASK });
  await recordVerification({ repoRoot: repo.root, taskId: TASK });
  const passing = await evaluateGate({ repoRoot: repo.root, taskId: TASK });
  assert.strictEqual(passing.combined, true);

  // Move ONLY the control state: the loop half fails and the provenance half still passes on its own
  // independently proved evidence.
  const state = readLoopState(repo);
  publishState(paths, advance(state, { currentPassInvalidated: true }));
  const moved = await evaluateGate({ repoRoot: repo.root, taskId: TASK });
  assert.strictEqual(moved.loop.pass, false);
  assert.strictEqual(moved.loop.reason, "pass-invalidated");
  assert.strictEqual(moved.provenance.pass, true,
    "a control change never relabels a passed consumer as failed");
  assert.strictEqual(moved.combined, false);
}));

// --- 5. §D8.5 retained payload ownership -----------------------------------------------------------------------

test("a retained payload is created before the admission publication and survives a terminal admission",
  () => withRepo(async (repo) => {
    const { admission } = await readyToCommit(repo);
    assert.ok(fs.existsSync(admission.retainedPayloadPath));
    fs.writeFileSync(admission.retainedPayloadPath, `${fs.readFileSync(admission.retainedPayloadPath, "utf8")} `, "utf8");
    await commitReviewedBatch({ repoRoot: repo.root, taskId: TASK });
    assert.strictEqual(readLoopState(repo).epoch.admitted[0].phase, "closed");
    assert.ok(fs.existsSync(admission.retainedPayloadPath),
      "a resolved historical payload is RETAINED; there is no unconditional delete and no orphan sweep");

    // A new cycle does not delete it either.
    bumpHead(repo, 3);
    await runProposalIteration({ repoRoot: repo.root, taskId: TASK });
    assert.ok(fs.existsSync(admission.retainedPayloadPath));
  }));

test("an absent retained payload is a preflight refusal, not a crash", () => withRepo(async (repo) => {
  const { admission } = await readyToCommit(repo);
  fs.rmSync(admission.retainedPayloadPath);
  const outcome = await commitReviewedBatch({ repoRoot: repo.root, taskId: TASK });
  assert.strictEqual(outcome.ok, false);
  assert.strictEqual(outcome.code, "E_LOOP_PAYLOAD_MOVED");
  assert.strictEqual(outcome.writerInvoked, false);
}));
