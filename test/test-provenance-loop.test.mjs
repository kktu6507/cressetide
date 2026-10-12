// TP v1.21: the eight public operations, their request capture, their CLI and one whole clean cycle.
//
// SCOPE. A green run here proves the CONTROLLER's mechanical behaviour on shipped synthetic fixtures.
// It does not establish that a reviewer ran (§D5.2), does not prove Step 6 convergence beyond the
// fresh consumer runs these cases actually perform, and makes no readiness claim.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  beginTaskLoop, runProposalIteration, submitReviewedProposal, commitReviewedBatch,
  recordVerification, inspectLoopState, evaluateGate, parseArgs,
} from "../cressetide/skills/vigil/scripts/test-provenance-loop.mjs";
import { loopPaths } from "../cressetide/skills/vigil/scripts/test-provenance-loop-state.mjs";
import {
  canonicalJson, sha256Hex, applyTransaction, canonicalStoreBytes,
} from "../cressetide/skills/vigil/scripts/provenance-store.mjs";
import { parseCanonicalInventoryV2 } from "../cressetide/skills/vigil/scripts/changed-test-inventory.mjs";
import { captureHeadViewSnapshot } from "../cressetide/skills/vigil/scripts/head-view-snapshot.mjs";
import { readTestAdapterRegistryRootFresh } from "../cressetide/skills/vigil/scripts/adapter-registry.mjs";
import { readHeadExplicitConfig, registryDigestOf } from "../cressetide/skills/vigil/scripts/explicit-config.mjs";
import {
  TASK, OPTS, withRepo, seedWorld, writeReview, writeGovernance, emptyGovernance, evidenceRecord,
  assumFinding, generalFinding, readLoopState,
} from "./fixtures/test-provenance-loop-fixture.mjs";

const refused = async (promise, what) => {
  let error = null;
  try { await promise; } catch (e) { error = e; }
  assert.ok(error, `${what}: expected a refusal, got none`);
  return error;
};

// --- 1. the clean cycle, end to end ---------------------------------------------------------------------

test("a clean first cycle: begin, emit, submit, commit, verify, and a passing gate", () => withRepo(async (repo) => {
  const world = await seedWorld(repo);

  const begun = await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
  assert.strictEqual(begun.reconciled, "created");
  assert.strictEqual(begun.revision, 1, "the creating publication is the first");
  assert.strictEqual(begun.status, "open");
  assert.strictEqual(begun.observedIterations, 0);

  const emitted = await runProposalIteration({ repoRoot: repo.root, taskId: TASK });
  assert.strictEqual(emitted.emitOutcome.kind, "ok");
  assert.ok(typeof emitted.inventoryDigest === "string");
  const afterEmit = readLoopState(repo);
  assert.strictEqual(afterEmit.currentPassInvalidated, true, "the pass is invalidated before any external work");
  assert.ok(afterEmit.lastEmission !== null, "the complete emission is durable");
  assert.strictEqual(afterEmit.attempts.emit.phase, "completed");
  assert.strictEqual(afterEmit.attempts.observe.phase, "completed");

  writeReview(repo, { base: world.base });
  writeGovernance(repo, emptyGovernance());
  const admitted = await submitReviewedProposal({ repoRoot: repo.root, taskId: TASK });
  assert.strictEqual(admitted.commitReady, true, "a clean review with no findings is commit-ready");
  assert.strictEqual(admitted.wasSeen, false);
  assert.strictEqual(admitted.phase, "open");
  assert.strictEqual(admitted.admittedCount, 1);

  const state = readLoopState(repo);
  const admission = state.epoch.admitted[0];
  assert.strictEqual(state.observedIterations, 1);
  assert.ok(admission.batchRecordId.startsWith("R-"), "the record id is allocated BEFORE the payload");
  assert.ok(fs.existsSync(admission.retainedPayloadPath), "the payload is retained at admission");
  assert.strictEqual(admission.payloadRawDigest.length, 64);
  assert.strictEqual(admission.admittedClaims.taskId, TASK);
  assert.strictEqual(state.currentAdmissionId, admission.admissionId);

  const committed = await commitReviewedBatch({ repoRoot: repo.root, taskId: TASK });
  assert.strictEqual(committed.ok, true, JSON.stringify(committed));
  assert.strictEqual(committed.phase, "committed");
  assert.strictEqual(committed.batchRecordId, admission.batchRecordId);
  const afterCommit = readLoopState(repo);
  assert.strictEqual(afterCommit.pendingCommit, null, "invariant 6: committed implies no pendingCommit");
  assert.strictEqual(afterCommit.committed.admissionId, admission.admissionId);

  const verified = await recordVerification({ repoRoot: repo.root, taskId: TASK });
  assert.strictEqual(verified.ok, true, JSON.stringify(verified.outcome));
  assert.strictEqual(verified.stage, "verification", "the outer stage field is always present");
  assert.strictEqual(verified.outcome.kind, "pass");
  assert.deepStrictEqual(Object.keys(verified.outcome.verdict).sort(),
    ["baseTreeOid", "batchDigest", "committedBatchRef", "headViewDigest", "inventoryDigest", "registryDigest", "taskId"],
    "exactly the seven identity fields are projected; converged is not stored");
  assert.strictEqual(readLoopState(repo).currentPassInvalidated, false);

  const gate = await evaluateGate({ repoRoot: repo.root, taskId: TASK });
  assert.strictEqual(gate.loop.pass, true, JSON.stringify(gate.loop));
  assert.strictEqual(gate.provenance.pass, true, JSON.stringify(gate.provenance.diagnostic));
  assert.strictEqual(gate.combined, true);
}));

test("a second verification returns the recorded slot with no new attempt and no consumer run",
  () => withRepo(async (repo) => {
    const world = await seedWorld(repo);
    await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
    await runProposalIteration({ repoRoot: repo.root, taskId: TASK });
    writeReview(repo, { base: world.base });
    writeGovernance(repo, emptyGovernance());
    await submitReviewedProposal({ repoRoot: repo.root, taskId: TASK });
    await commitReviewedBatch({ repoRoot: repo.root, taskId: TASK });
    const first = await recordVerification({ repoRoot: repo.root, taskId: TASK });
    const revisionAfterFirst = readLoopState(repo).revision;

    const second = await recordVerification({ repoRoot: repo.root, taskId: TASK });
    assert.strictEqual(second.historical, true);
    assert.strictEqual(second.attemptId, first.attemptId, "the EXISTING slot id; no id is minted");
    assert.strictEqual(second.ok, true, "ok is derived from the recorded outcome");
    assert.strictEqual(readLoopState(repo).revision, revisionAfterFirst, "nothing was published");
  }));

// --- 2. admission dispositions -----------------------------------------------------------------------------

test("an unready admission is appended ALREADY closed, and a new emit may proceed", () => withRepo(async (repo) => {
  const world = await seedWorld(repo);
  await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
  await runProposalIteration({ repoRoot: repo.root, taskId: TASK });
  writeReview(repo, { base: world.base, findings: [generalFinding()] });
  writeGovernance(repo, emptyGovernance());

  const admitted = await submitReviewedProposal({ repoRoot: repo.root, taskId: TASK });
  assert.strictEqual(admitted.commitReady, false);
  assert.strictEqual(admitted.phase, "closed", "no temporary open state is ever durable");
  assert.strictEqual(admitted.status, "open");
  assert.strictEqual(admitted.lock, null);

  const admission = readLoopState(repo).epoch.admitted[0];
  assert.deepStrictEqual(admission.closeReason,
    { stage: "not-ready", kind: "not-ready", class: null, code: null });
  // Terminal, so a new cycle is legal: the unready proposal is not a dead end.
  await runProposalIteration({ repoRoot: repo.root, taskId: TASK });
  assert.strictEqual(readLoopState(repo).currentAdmissionId, null);
}));

test("a repeated fingerprint is appended closed and locked, with its computed commitReady preserved",
  () => withRepo(async (repo) => {
    const world = await seedWorld(repo);
    await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
    await runProposalIteration({ repoRoot: repo.root, taskId: TASK });
    writeReview(repo, { base: world.base });
    writeGovernance(repo, emptyGovernance());
    const first = await submitReviewedProposal({ repoRoot: repo.root, taskId: TASK });
    assert.strictEqual(first.commitReady, true);

    // Make the first admission TERMINAL without writing anything, so the store — and therefore the
    // next emission's inventory digest and fingerprint — are unchanged: tamper its retained payload
    // so the commit refuses at the hash gate, closing it before any preview or writer call.
    const retained = readLoopState(repo).epoch.admitted[0].retainedPayloadPath;
    fs.writeFileSync(retained, `${fs.readFileSync(retained, "utf8")} `, "utf8");
    const moved = await commitReviewedBatch({ repoRoot: repo.root, taskId: TASK });
    assert.strictEqual(moved.ok, false);
    assert.strictEqual(moved.code, "E_LOOP_PAYLOAD_MOVED");
    assert.strictEqual(moved.writerInvoked, false);

    // A NEW emission with identical bytes: a new cycle whose fingerprint is wasSeen.
    await runProposalIteration({ repoRoot: repo.root, taskId: TASK });
    writeReview(repo, { base: world.base });
    const repeat = await submitReviewedProposal({ repoRoot: repo.root, taskId: TASK });

    assert.strictEqual(repeat.wasSeen, true);
    assert.strictEqual(repeat.phase, "closed", "a repeat never reaches a durable open state");
    assert.strictEqual(repeat.status, "locked");
    assert.strictEqual(repeat.lock.reason, "repeat");
    assert.strictEqual(repeat.commitReady, true,
      "the COMPUTED commitReady is recorded as-is; phase and lock are what forbid the writer");

    const state = readLoopState(repo);
    const admission = state.epoch.admitted[state.epoch.admitted.length - 1];
    assert.deepStrictEqual(admission.closeReason, { stage: "not-ready", kind: "repeat", class: null, code: null });
    assert.strictEqual(state.lock.fingerprint, admission.fingerprint, "invariant 12 holds in this state");
    assert.strictEqual(state.currentAdmissionId, admission.admissionId);
    assert.ok(admission.findingIdentities !== undefined);

    // The repeat gets no writer chance, and no further emission until the epoch opens.
    assert.strictEqual((await refused(commitReviewedBatch({ repoRoot: repo.root, taskId: TASK }), "commit after repeat")).code,
      "E_LOOP_NOT_COMMIT_READY");
    assert.strictEqual((await refused(runProposalIteration({ repoRoot: repo.root, taskId: TASK }), "emit while locked")).code,
      "E_LOOP_LOCKED");
  }));

test("an exact retry is idempotent and consumes nothing", () => withRepo(async (repo) => {
  const world = await seedWorld(repo);
  await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
  await runProposalIteration({ repoRoot: repo.root, taskId: TASK });
  writeReview(repo, { base: world.base });
  writeGovernance(repo, emptyGovernance());
  const first = await submitReviewedProposal({ repoRoot: repo.root, taskId: TASK });
  const revision = readLoopState(repo).revision;

  const again = await submitReviewedProposal({ repoRoot: repo.root, taskId: TASK });
  assert.strictEqual(again.retry, true);
  assert.strictEqual(again.admissionId, first.admissionId);
  assert.strictEqual(readLoopState(repo).observedIterations, 1, "no second count");
  assert.strictEqual(readLoopState(repo).revision, revision, "nothing was published");
}));

test("changed bytes under an admitted emission are refused as spent", () => withRepo(async (repo) => {
  const world = await seedWorld(repo);
  await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
  await runProposalIteration({ repoRoot: repo.root, taskId: TASK });
  writeReview(repo, { base: world.base });
  writeGovernance(repo, emptyGovernance());
  await submitReviewedProposal({ repoRoot: repo.root, taskId: TASK });

  writeReview(repo, { base: world.base, findings: [generalFinding()] });
  const error = await refused(submitReviewedProposal({ repoRoot: repo.root, taskId: TASK }), "changed bytes");
  assert.strictEqual(error.code, "E_LOOP_EMISSION_SPENT");
}));

// --- 3. §D5.8b: the exhaustive scan ---------------------------------------------------------------------

test("an early unresolved finding does not hide a later false resolution claim", () => withRepo(async (repo) => {
  const world = await seedWorld(repo);
  await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
  await runProposalIteration({ repoRoot: repo.root, taskId: TASK });

  // Finding 1: a valid UNRESOLVED assum-reading-change, which alone would only set commitReady false.
  // Finding 2: a this-round claim whose evidence names another task — evaluable and FALSE.
  const artifact = JSON.parse(fs.readFileSync(path.join(repo.root, ".ctide", "output", "changed-test-inventory.json"), "utf8"));
  const entry = artifact.entries[0];
  writeReview(repo, {
    base: world.base,
    findings: [
      assumFinding(),
      assumFinding({
        resolutionRef: { mode: "this-round", transitionRef: "T-x", semanticEvidenceRef: { kind: "review-ruling", ref: "R-ev" } },
      }),
    ],
  });
  // The group mints T-x, so the transitionRef really resolves and the scan reaches the EQUALITY that
  // is false — the evidence names another task.
  writeGovernance(repo, emptyGovernance({
    recordsToCreate: [evidenceRecord("R-ev", entry, { taskId: "TASK-OTHER" })],
    resolutions: [{
      subjectRef: "ASSUM-0000000000000000000000000A",
      semanticEvidenceRefs: [{ kind: "review-ruling", ref: "R-ev" }],
      governanceWitnessRef: { kind: "review-ruling", ref: "R-ev" },
      transitionDraft: {
        id: "T-x", subject: "ASSUM-0000000000000000000000000A", action: "retire",
        authorityRef: { kind: "discipline", discipline: "code" },
        ackRef: { kind: "review-ruling", ref: "R-ev" },
      },
    }],
  }));

  const error = await refused(submitReviewedProposal({ repoRoot: repo.root, taskId: TASK }), "a hidden false claim");
  assert.strictEqual(error.code, "E_LOOP_REVIEW_INVALID");
  assert.match(error.message, /names task/, "the later false claim is reported, not skipped");
  const state = readLoopState(repo);
  assert.strictEqual(state.observedIterations, 0, "nothing was counted");
  assert.strictEqual(state.epoch.admitted.length, 0, "nothing was admitted");
  assert.deepStrictEqual(fs.readdirSync(path.dirname(loopPaths(repo.root, TASK).state))
    .filter((n) => n.includes(".payload.json")), [], "no payload was retained");
}));

test("a valid unresolved finding is ADMITTED not-ready when its pending declaration is present",
  () => withRepo(async (repo) => {
    const world = await seedWorld(repo);
    await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
    await runProposalIteration({ repoRoot: repo.root, taskId: TASK });
    const { batch } = writeReview(repo, { base: world.base, findings: [assumFinding()] });
    const identity = {
      testRef: { ...batch.results[0].testRef },
      kind: "assum-reading-change",
      binding: { clauseRef: batch.results[0].findings[0].binding.clauseRef },
    };
    writeGovernance(repo, emptyGovernance({
      pendingDeclarations: [{ identity, governance: { kind: "undecided" } }],
    }));

    const admitted = await submitReviewedProposal({ repoRoot: repo.root, taskId: TASK });
    assert.strictEqual(admitted.commitReady, false);
    assert.strictEqual(admitted.phase, "closed");
    assert.strictEqual(readLoopState(repo).pending.length, 1, "the declaration is durable");
  }));

test("a missing pending declaration for an unresolved finding is a claim mismatch", () => withRepo(async (repo) => {
  const world = await seedWorld(repo);
  await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
  await runProposalIteration({ repoRoot: repo.root, taskId: TASK });
  writeReview(repo, { base: world.base, findings: [assumFinding()] });
  writeGovernance(repo, emptyGovernance());
  const error = await refused(submitReviewedProposal({ repoRoot: repo.root, taskId: TASK }), "missing coverage");
  assert.strictEqual(error.code, "E_LOOP_CLAIM_MISMATCH");
}));

// --- 4. request capture and the read-only contract ----------------------------------------------------------

test("every operation reads OWN keys and captures each declared value exactly once", () => withRepo(async (repo) => {
  await seedWorld(repo);
  const counts = { repoRoot: 0, taskId: 0 };
  const values = { repoRoot: repo.root, taskId: TASK };
  const counting = {};
  for (const name of Object.keys(values)) {
    Object.defineProperty(counting, name, {
      enumerable: true, configurable: true, get() { counts[name] += 1; return values[name]; },
    });
  }
  await beginTaskLoop(counting);
  assert.deepStrictEqual(counts, { repoRoot: 1, taskId: 1 });

  // A required key that is own but NOT enumerable is legal.
  const hidden = {};
  Object.defineProperty(hidden, "repoRoot", { value: repo.root, enumerable: false });
  Object.defineProperty(hidden, "taskId", { value: TASK, enumerable: false });
  assert.deepStrictEqual(Object.keys(hidden), []);
  assert.strictEqual((await inspectLoopState(hidden)).present, true);

  // A hidden or symbol EXTRA is not.
  const hiddenExtra = { repoRoot: repo.root, taskId: TASK };
  Object.defineProperty(hiddenExtra, "now", { value: 1, enumerable: false });
  assert.strictEqual((await refused(beginTaskLoop(hiddenExtra), "a hidden extra")).code, "E_API_ARGUMENTS");
  const symbolled = { repoRoot: repo.root, taskId: TASK };
  symbolled[Symbol("store")] = {};
  const symbolError = await refused(beginTaskLoop(symbolled), "a symbol extra");
  assert.strictEqual(symbolError.code, "E_API_ARGUMENTS");
  assert.match(symbolError.message, /Symbol\(store\)/);
  assert.strictEqual((await refused(beginTaskLoop({ repoRoot: repo.root, taskId: TASK }, {}), "two arguments")).code,
    "E_API_ARGUMENTS");
}));

test("the read-only operations create nothing and contain every upstream fault", async () => {
  await withRepo(async (repo) => {
    // No control prefix exists yet: inspect reports absence and creates nothing.
    const before = fs.readdirSync(repo.root).sort();
    const inspected = await inspectLoopState({ repoRoot: repo.root, taskId: TASK });
    assert.strictEqual(inspected.present, false);
    assert.strictEqual(inspected.counters, null, "unavailable, never a fabricated zero");
    assert.deepStrictEqual(fs.readdirSync(repo.root).sort(), before, "nothing was created");
    assert.ok(!fs.existsSync(path.join(repo.root, ".ctide", "test-provenance-loop")));

    // An unknown task is CONTAINED in the diagnostic, not thrown.
    await seedWorld(repo);
    await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
    const unknown = await inspectLoopState({ repoRoot: repo.root, taskId: "TASK-NOPE" });
    assert.strictEqual(unknown.present, false);
    assert.ok(unknown.diagnostic !== null);
    assert.strictEqual(unknown.diagnostic.code, "E_LOOP_UNKNOWN_TASK");
    assert.strictEqual(unknown.diagnostic.loopCode, "E_LOOP_UNKNOWN_TASK");
    assert.strictEqual(typeof unknown.diagnostic.class, "string");
    assert.strictEqual(typeof unknown.diagnostic.message, "string");

    // Only API misuse escapes.
    const escaped = await refused(inspectLoopState({ repoRoot: repo.root }), "a malformed request");
    assert.strictEqual(escaped.code, "E_API_ARGUMENTS");

    // evaluateGate likewise contains its causes.
    const gate = await evaluateGate({ repoRoot: repo.root, taskId: TASK });
    assert.strictEqual(gate.combined, false);
    assert.strictEqual(gate.loop.pass, false);
    assert.ok(gate.provenance.diagnostic !== null, "the cause is reported, not thrown");
  });
});

test("inspect carries the identity the ledger collector needs", () => withRepo(async (repo) => {
  const world = await seedWorld(repo);
  await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
  await runProposalIteration({ repoRoot: repo.root, taskId: TASK });
  writeReview(repo, { base: world.base });
  writeGovernance(repo, emptyGovernance());
  await submitReviewedProposal({ repoRoot: repo.root, taskId: TASK });
  await commitReviewedBatch({ repoRoot: repo.root, taskId: TASK });

  const inspected = await inspectLoopState({ repoRoot: repo.root, taskId: TASK });
  assert.strictEqual(inspected.taskId, TASK);
  assert.deepStrictEqual(inspected.baseProvenance, world.base);
  assert.strictEqual(inspected.committed.admissionId, inspected.currentAdmissionId);
  assert.ok(inspected.committed.expectedBatchRecord, "the complete expected record is projected");
  assert.strictEqual(inspected.committed.expectedBatchRecord.kind, "provenance-batch");
  assert.deepStrictEqual(inspected.counters.adapterMisses, { observed: 0, uncertain: false });
}));

// --- 4b. §D4 step 7: the authority sample is INDEPENDENT, and all three equalities bind ------------------

const cycleTo = async (repo, world) => {
  await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
  await runProposalIteration({ repoRoot: repo.root, taskId: TASK });
  writeReview(repo, { base: world.base });
  writeGovernance(repo, emptyGovernance());
};

test("the emission's captured HEAD-view and registry digests are samples of the world, not copies of the header",
  () => withRepo(async (repo) => {
    await seedWorld(repo);
    await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
    await runProposalIteration({ repoRoot: repo.root, taskId: TASK });

    const emission = readLoopState(repo).lastEmission;
    // The expected values are computed FROM THE REPOSITORY by the same source-owned readers the
    // consumer uses — never read out of the artifact. A controller that copied the header's own
    // values into these fields would satisfy the header comparison below and fail this one.
    const snapshot = await captureHeadViewSnapshot({ repoRoot: repo.root });
    const registryRoot = readTestAdapterRegistryRootFresh();
    const registryDigest = registryDigestOf(registryRoot, readHeadExplicitConfig(snapshot, registryRoot));
    assert.strictEqual(emission.capturedHeadViewDigest, snapshot.headViewDigest);
    assert.strictEqual(emission.capturedRegistryDigest, registryDigest);
    assert.strictEqual(emission.storeTextDigest, emission.artifactHeader.inputProvenanceStoreDigest);
    assert.strictEqual(emission.capturedHeadViewDigest, emission.artifactHeader.headViewDigest,
      "and the sample equals the header, which is what actually binds the artifact");
    assert.strictEqual(emission.capturedRegistryDigest, emission.artifactHeader.registryDigest);

    // The header the controller recorded is the one the CANONICAL v2 reader yields for those bytes.
    const parsed = parseCanonicalInventoryV2(fs.readFileSync(emission.returned.path, "utf8"));
    assert.strictEqual(emission.artifactHeader.inventoryDigest, parsed.inventoryDigest);
    assert.strictEqual(emission.artifactHeader.baseTreeOid, parsed.baseTreeOid);
    assert.strictEqual(emission.artifactHeader.headViewDigest, parsed.headViewDigest);
  }));

test("a tracked source move after C refuses the submission before anything is admitted",
  () => withRepo(async (repo) => {
    const world = await seedWorld(repo);
    await cycleTo(repo, world);

    // A real edit to a tracked file. It moves the HEAD view but leaves the store text untouched, so
    // a store-only comparison could not see it.
    repo.write("notes.md", "the world moved after the review was written\n");
    repo.git("add", "-A");
    const before = readLoopState(repo);
    const error = await refused(submitReviewedProposal({ repoRoot: repo.root, taskId: TASK }), "a moved source");
    assert.strictEqual(error.code, "E_LOOP_PRESTATE_MOVED");
    assert.match(error.message, /HEAD view/, "the diagnosis names which of the three samples moved");

    const after = readLoopState(repo);
    assert.strictEqual(after.revision, before.revision, "nothing was published");
    assert.strictEqual(after.epoch.admitted.length, 0, "nothing was admitted");
    assert.strictEqual(after.observedIterations, before.observedIterations, "nothing was counted");
  }));

test("an explicit adapter config appearing after C refuses the submission", () => withRepo(async (repo) => {
  const world = await seedWorld(repo);
  await cycleTo(repo, world);

  repo.write(".ctide/test-adapters-config.json",
    `${JSON.stringify({ configVersion: 1, assignments: [] })}\n`);
  repo.git("add", "-A");
  const error = await refused(submitReviewedProposal({ repoRoot: repo.root, taskId: TASK }), "a moved config");
  assert.strictEqual(error.code, "E_LOOP_PRESTATE_MOVED");
  assert.strictEqual(readLoopState(repo).epoch.admitted.length, 0);
}));

// --- 4c. §D5.3 / §D5.8b: what may never consume an admission ---------------------------------------------

// Every case here must refuse with NOTHING spent: no id allocated, no payload retained, no count
// moved. A shape the controller merely dropped on the way to the writer would consume an admission
// and could never be refused by the writer that would have caught it.
const refusedBeforeAdmission = async (repo, what) => {
  const before = readLoopState(repo);
  const error = await refused(submitReviewedProposal({ repoRoot: repo.root, taskId: TASK }), what);
  const after = readLoopState(repo);
  assert.strictEqual(after.epoch.admitted.length, before.epoch.admitted.length, `${what}: nothing admitted`);
  assert.strictEqual(after.observedIterations, before.observedIterations, `${what}: nothing counted`);
  assert.strictEqual(after.revision, before.revision, `${what}: nothing published`);
  const retained = fs.readdirSync(loopPaths(repo.root, TASK).dir).filter((f) => f.endsWith(".payload.json"));
  assert.deepStrictEqual(retained, [], `${what}: no payload retained`);
  return error;
};

test("an undeclared review root member is refused as undeclared, not silently dropped",
  () => withRepo(async (repo) => {
    const world = await seedWorld(repo);
    await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
    await runProposalIteration({ repoRoot: repo.root, taskId: TASK });
    writeGovernance(repo, emptyGovernance());

    writeReview(repo, { base: world.base, over: { proposalVersion: 1 } });
    let error = await refusedBeforeAdmission(repo, "a wrapper member");
    assert.strictEqual(error.code, "E_LOOP_REVIEW_INVALID");
    assert.match(error.message, /undeclared member\(s\) proposalVersion/);

    // §D5.3: group drafts belong to governance; batchSnapshot.resolutions is DERIVED by the writer.
    writeReview(repo, { base: world.base, over: { resolutions: [] } });
    error = await refusedBeforeAdmission(repo, "a batch-level resolutions");
    assert.strictEqual(error.code, "E_LOOP_REVIEW_INVALID");
    assert.match(error.message, /undeclared member\(s\) resolutions/);
  }));

test("a general finding may not carry a resolutionRef", () => withRepo(async (repo) => {
  const world = await seedWorld(repo);
  await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
  await runProposalIteration({ repoRoot: repo.root, taskId: TASK });
  writeGovernance(repo, emptyGovernance());
  writeReview(repo, {
    base: world.base,
    findings: [{
      ...generalFinding(),
      resolutionRef: { mode: "historical-convergence", transitionRef: "T-anything" },
    }],
  });
  const error = await refusedBeforeAdmission(repo, "a general finding with a resolutionRef");
  assert.strictEqual(error.code, "E_LOOP_REVIEW_INVALID");
  assert.match(error.message, /only an assum-reading-change finding carries a resolutionRef/);
}));

test("a finding without evidence, a result without findings[] and an invented body side are each refused",
  () => withRepo(async (repo) => {
    const world = await seedWorld(repo);
    await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
    await runProposalIteration({ repoRoot: repo.root, taskId: TASK });
    writeGovernance(repo, emptyGovernance());

    const { batch } = writeReview(repo, { base: world.base, findings: [generalFinding()] });
    const rewrite = (mutate) => {
      const next = JSON.parse(JSON.stringify(batch));
      mutate(next);
      fs.writeFileSync(loopPaths(repo.root, TASK).review, `${canonicalJson(next)}\n`, "utf8");
    };

    rewrite((b) => { delete b.results[0].findings[0].evidence; });
    let error = await refusedBeforeAdmission(repo, "a finding with no evidence");
    assert.strictEqual(error.code, "E_LOOP_REVIEW_INVALID");
    assert.match(error.message, /is missing evidence/, "an absent key is a missing declared field");

    // Present but empty is a different statement, and it is refused too: `evidence` is excluded from
    // the fingerprint as PROSE, which is a reason to leave it out of an identity, not to let it be
    // empty.
    rewrite((b) => { b.results[0].findings[0].evidence = ""; });
    error = await refusedBeforeAdmission(repo, "an empty evidence string");
    assert.strictEqual(error.code, "E_LOOP_REVIEW_INVALID");
    assert.match(error.message, /states no evidence; it is required and non-empty/);

    rewrite((b) => { delete b.results[0].findings; });
    error = await refusedBeforeAdmission(repo, "a result with no findings array");
    assert.strictEqual(error.code, "E_LOOP_REVIEW_INVALID");
    assert.match(error.message, /is missing findings/);

    // The entry is `modified`, so it HAS both sides; dropping one is a side the review cannot answer
    // for, and the writer charges presence in both directions.
    rewrite((b) => { delete b.results[0].observedBaseBodyDigest; });
    error = await refusedBeforeAdmission(repo, "an omitted body side the entry carries");
    assert.strictEqual(error.code, "E_LOOP_REVIEW_INVALID");
    assert.match(error.message, /omits observedBaseBodyDigest/);
  }));

test("two pendingDeclarations for one finding are refused rather than merged", () => withRepo(async (repo) => {
  const world = await seedWorld(repo);
  await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
  await runProposalIteration({ repoRoot: repo.root, taskId: TASK });
  writeReview(repo, { base: world.base, findings: [assumFinding()] });

  const identity = {
    testRef: readLoopState(repo).lastEmission === null ? null : undefined,
  };
  void identity;
  const inventory = JSON.parse(fs.readFileSync(
    path.join(repo.root, ".ctide", "output", "changed-test-inventory.json"), "utf8"));
  const declaration = (governance) => ({
    identity: {
      testRef: { ...inventory.entries[0].testRef },
      kind: "assum-reading-change",
      binding: { clauseRef: "ASSUM-0000000000000000000000000A" },
    },
    governance,
  });
  writeGovernance(repo, emptyGovernance({
    pendingDeclarations: [declaration({ kind: "undecided" }), declaration({ kind: "undecided" })],
  }));
  const error = await refusedBeforeAdmission(repo, "two declarations for one finding");
  assert.strictEqual(error.code, "E_LOOP_CLAIM_MISMATCH");
  assert.match(error.message, /coverage is one-to-one and they are not merged/);
}));

// --- 4c-bis. §D5.8: the writer's per-finding obligations, charged BEFORE admission ------------------------

const emittedEntry = (repo) => JSON.parse(fs.readFileSync(
  path.join(repo.root, ".ctide", "output", "changed-test-inventory.json"), "utf8")).entries[0];

const groupFor = (subjectRef, over = {}) => ({
  subjectRef,
  semanticEvidenceRefs: [{ kind: "review-ruling", ref: "R-ev" }],
  governanceWitnessRef: { kind: "review-ruling", ref: "R-w" },
  transitionDraft: {
    id: "T-x", subject: subjectRef, action: "retire",
    authorityRef: { kind: "discipline", discipline: "code" },
    ackRef: { kind: "review-ruling", ref: "R-w" },
  },
  ...over,
});

// §D5.8:611 states this for BOTH modes, and the writer charges it before its historical-convergence
// return: "a resolution names the binding it resolves, and the contract compares that binding's
// clauseRef against the Transition's subject".
test("a resolution through a transition whose subject is not the finding's binding is refused, in both modes",
  () => withRepo(async (repo) => {
    const world = await seedWorld(repo);
    await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
    await runProposalIteration({ repoRoot: repo.root, taskId: TASK });
    const entry = emittedEntry(repo);
    const OTHER = "ASSUM-0000000000000000000000000Z";

    for (const resolutionRef of [
      { mode: "historical-convergence", transitionRef: "T-x" },
      { mode: "this-round", transitionRef: "T-x", semanticEvidenceRef: { kind: "review-ruling", ref: "R-ev" } },
    ]) {
      // The group is internally consistent — its transitionDraft.subject IS its subjectRef — but that
      // subject is not the ASSUM the finding binds.
      writeGovernance(repo, emptyGovernance({
        recordsToCreate: [evidenceRecord("R-ev", entry)],
        resolutions: [groupFor(OTHER)],
      }));
      writeReview(repo, { base: world.base, findings: [assumFinding({ resolutionRef })] });
      // eslint-disable-next-line no-await-in-loop
      const error = await refusedBeforeAdmission(repo, `a wrong-subject transition in ${resolutionRef.mode}`);
      assert.strictEqual(error.code, "E_LOOP_REVIEW_INVALID");
      assert.match(error.message, /through transition T-x, whose subject is "ASSUM-0000000000000000000000000Z"/);
    }
  }));

// §D5.8:617 — charged ONLY when this transaction mints the transition, because only then is the
// group's verified evidence set known. A reference to a PRIOR transition needs no new group.
test("a transition minted by this transaction may cite only its own group's declared evidence",
  () => withRepo(async (repo) => {
    const world = await seedWorld(repo);
    await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
    await runProposalIteration({ repoRoot: repo.root, taskId: TASK });
    const entry = emittedEntry(repo);
    const ASSUM_A = "ASSUM-0000000000000000000000000A";

    // Both records satisfy every per-finding equality; only ONE is declared by the group.
    writeGovernance(repo, emptyGovernance({
      recordsToCreate: [evidenceRecord("R-ev", entry), evidenceRecord("R-outside", entry)],
      resolutions: [groupFor(ASSUM_A)],
    }));
    writeReview(repo, {
      base: world.base,
      findings: [assumFinding({
        resolutionRef: {
          mode: "this-round", transitionRef: "T-x",
          semanticEvidenceRef: { kind: "review-ruling", ref: "R-outside" },
        },
      })],
    });
    const error = await refusedBeforeAdmission(repo, "evidence outside the minted group");
    assert.strictEqual(error.code, "E_LOOP_REVIEW_INVALID");
    assert.match(error.message, /resolution group's verified witness coverage does not include it/);

    // The declared one is accepted and the review is admitted commit-ready, which is what makes the
    // refusal above a statement about group membership rather than about the record itself.
    writeReview(repo, {
      base: world.base,
      findings: [assumFinding({
        resolutionRef: {
          mode: "this-round", transitionRef: "T-x",
          semanticEvidenceRef: { kind: "review-ruling", ref: "R-ev" },
        },
      })],
    });
    const admitted = await submitReviewedProposal({ repoRoot: repo.root, taskId: TASK });
    assert.strictEqual(admitted.commitReady, true, "a covered this-round claim resolves the finding");
    assert.strictEqual(admitted.phase, "open");
  }));

// --- 4d. §D10 / telemetry §B.4: the (class, code) allow-list ----------------------------------------------

test("a real NodeTestAdapterError/E_TAG_CARDINALITY from the emitter counts as one adapter miss",
  () => withRepo(async (repo) => {
    await seedWorld(repo);
    await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
    assert.deepStrictEqual(readLoopState(repo).counters.adapterMisses, { observed: 0, uncertain: false });

    // A second @src on one declaration. §11b.5: exactly one is allowed, and a byte-identical repeat
    // is still a second tag — so the ACTUAL adapter refuses this source.
    const A = "ASSUM-0000000000000000000000000A";
    repo.write("test/alpha.test.mjs",
      'import { test } from "node:test";\nimport assert from "node:assert";\n'
      + `// @src ${A}\n// @src ${A}\ntest("alpha", () => { assert.ok(1); });\n`);

    const error = await refused(runProposalIteration({ repoRoot: repo.root, taskId: TASK }), "a doubly tagged test");
    assert.strictEqual(error.code, "E_TAG_CARDINALITY", "the upstream cause propagates unchanged");
    assert.strictEqual(error.name, "NodeTestAdapterError");

    const state = readLoopState(repo);
    assert.strictEqual(state.attempts.emit.phase, "completed", "B is published before the cause is re-thrown");
    assert.deepStrictEqual(state.attempts.emit.outcome,
      { kind: "refused", class: "NodeTestAdapterError", code: "E_TAG_CARDINALITY" });
    assert.deepStrictEqual(state.counters.adapterMisses, { observed: 1, uncertain: false },
      "the pair is on the approved E1 allow-list, so this observed invocation counts");
    assert.strictEqual(state.lastEmission, null, "a failed emitter leaves no emission");
  }));

test("a caller-misuse refusal and a store fault are excluded from the adapter-miss count",
  () => withRepo(async (repo) => {
    await seedWorld(repo);
    await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
    // §B.4 excludes E_API_ARGUMENTS in every class, and excludes store faults entirely.
    await refused(runProposalIteration({ repoRoot: repo.root }), "a malformed request");
    assert.deepStrictEqual(readLoopState(repo).counters.adapterMisses, { observed: 0, uncertain: false });
  }));

// --- 4e. §D2.3 / §D12: the read-only projections ----------------------------------------------------------

test("an existing corrupt state is present AND corrupt; true absence is neither", () => withRepo(async (repo) => {
  await seedWorld(repo);
  const absent = await inspectLoopState({ repoRoot: repo.root, taskId: TASK });
  assert.strictEqual(absent.present, false, "no state file at all");
  assert.strictEqual(absent.corrupt, false);

  await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
  const paths = loopPaths(repo.root, TASK);
  const valid = JSON.parse(fs.readFileSync(paths.state, "utf8"));
  fs.writeFileSync(paths.state, `${canonicalJson({ ...valid, unexpectedControllerField: 1 })}\n`, "utf8");

  const corrupt = await inspectLoopState({ repoRoot: repo.root, taskId: TASK });
  assert.strictEqual(corrupt.present, true, "the file exists; absence is a different situation");
  assert.strictEqual(corrupt.corrupt, true);
  assert.strictEqual(corrupt.diagnostic.loopCode, "E_LOOP_STATE_CORRUPT");
  assert.match(corrupt.diagnostic.message, /undeclared member\(s\) unexpectedControllerField/);
  assert.strictEqual(corrupt.revision, null, "no field of a corrupt state is projected");
  assert.strictEqual(corrupt.counters, null, "counters are UNAVAILABLE, never a fabricated zero");

  // A mutating operation refuses rather than repairing or replacing it.
  const error = await refused(runProposalIteration({ repoRoot: repo.root, taskId: TASK }), "a corrupt state");
  assert.strictEqual(error.code, "E_LOOP_STATE_CORRUPT");
  assert.match(fs.readFileSync(paths.state, "utf8"), /unexpectedControllerField/, "left exactly as found");
}));

// The same §D2.3 disposition on a value-domain violation rather than a key-set one, driven through an
// ACTUAL persisted admission: the review is really admitted, so `findingIdentities[0]` is a real
// retained identity, and only its `kind` is then edited to a value TP §6:537 does not declare. An
// admission can never carry one through the front door — the §D5.8b scan refuses an unknown kind
// before anything is counted — which is exactly why the persisted schema has to charge it on read.
test("a persisted finding identity whose kind is outside the TP §6 enum is corrupt on read",
  () => withRepo(async (repo) => {
    const world = await seedWorld(repo);
    await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
    await runProposalIteration({ repoRoot: repo.root, taskId: TASK });
    writeReview(repo, { base: world.base, findings: [generalFinding()] });
    writeGovernance(repo, emptyGovernance());
    const admitted = await submitReviewedProposal({ repoRoot: repo.root, taskId: TASK });
    assert.strictEqual(admitted.admittedCount, 1);

    const paths = loopPaths(repo.root, TASK);
    const before = JSON.parse(fs.readFileSync(paths.state, "utf8"));
    assert.strictEqual(before.epoch.admitted[0].findingIdentities[0].kind, "wrong-tag",
      "a real reviewer finding kind was retained by the admission");

    const tampered = JSON.parse(JSON.stringify(before));
    tampered.epoch.admitted[0].findingIdentities[0].kind = "arbitrary";
    const bytes = `${canonicalJson(tampered)}\n`;
    fs.writeFileSync(paths.state, bytes, "utf8");

    const inspected = await inspectLoopState({ repoRoot: repo.root, taskId: TASK });
    assert.strictEqual(inspected.present, true, "the state file is there");
    assert.strictEqual(inspected.corrupt, true, "and it no longer satisfies its declared schema");
    assert.strictEqual(inspected.diagnostic.loopCode, "E_LOOP_STATE_CORRUPT");
    assert.match(inspected.diagnostic.message,
      /findingIdentities\[0\].kind must be one of wrong-tag, missing-source, scope-violation, assum-reading-change/);
    assert.strictEqual(inspected.counters, null);

    // Every mutating operation refuses, and none of them repairs, replaces or rewrites the file.
    for (const [what, call] of [
      ["emit", () => runProposalIteration({ repoRoot: repo.root, taskId: TASK })],
      ["submit", () => submitReviewedProposal({ repoRoot: repo.root, taskId: TASK })],
      ["commit", () => commitReviewedBatch({ repoRoot: repo.root, taskId: TASK })],
      ["verify", () => recordVerification({ repoRoot: repo.root, taskId: TASK })],
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const refusal = await refused(call(), `${what} on a corrupt state`);
      assert.strictEqual(refusal.code, "E_LOOP_STATE_CORRUPT", `${what}: ${refusal.message}`);
      assert.strictEqual(fs.readFileSync(paths.state, "utf8"), bytes,
        `${what}: the bytes are unchanged — never repaired, never replaced by a clean zero state`);
    }
  }));

test("the gate's after-read compares the full TaskState identity, and an unrelated append still passes",
  () => withRepo(async (repo) => {
    const world = await seedWorld(repo);
    await cycleTo(repo, world);
    await submitReviewedProposal({ repoRoot: repo.root, taskId: TASK });
    await commitReviewedBatch({ repoRoot: repo.root, taskId: TASK });
    await recordVerification({ repoRoot: repo.root, taskId: TASK });

    const clean = await evaluateGate({ repoRoot: repo.root, taskId: TASK });
    assert.strictEqual(clean.combined, true, JSON.stringify(clean.provenance.diagnostic));

    // An unrelated VALID append moves the store text but not this task's identity or head.
    const storePath = path.join(repo.root, ".ctide", "provenance.json");
    const store = JSON.parse(fs.readFileSync(storePath, "utf8"));
    const appended = applyTransaction(store, "append-source", {
      source: {
        sourceId: "S-unrelated", contentKind: "requirement", driftMode: "snapshot-only",
        locator: "conversation#9", excerpt: "an unrelated later decision",
      },
    }, OPTS);
    fs.writeFileSync(storePath, canonicalStoreBytes(appended), "utf8");

    const stillPassing = await evaluateGate({ repoRoot: repo.root, taskId: TASK });
    assert.strictEqual(stillPassing.provenance.pass, true,
      "whole-store byte equality is deliberately NOT required");
    assert.strictEqual(stillPassing.combined, true);
  }));

// --- 5. the CLI ------------------------------------------------------------------------------------------

test("the CLI parser is strict and its witness flags are required only for open-epoch", () => {
  assert.deepStrictEqual(parseArgs(["inspect", "--task", "T", "--cwd", "/x"]),
    { operation: "inspect", request: { repoRoot: "/x", taskId: "T" } });
  const opened = parseArgs(["open-epoch", "--task", "T", "--cwd", "/x",
    "--witness-branch", "transition-governance", "--witness-source", "draft", "--witness-record", "R-w"]);
  assert.deepStrictEqual(opened.request.witness,
    { branch: "transition-governance", source: "draft", recordId: "R-w" });

  for (const [what, argv] of [
    ["an unknown operation", ["nope", "--task", "T"]],
    ["a missing task", ["inspect", "--cwd", "/x"]],
    ["a repeated flag", ["inspect", "--task", "T", "--task", "U"]],
    ["a bare positional", ["inspect", "T"]],
    ["an unknown flag", ["inspect", "--task", "T", "--force", "1"]],
    ["a witness flag outside open-epoch", ["inspect", "--task", "T", "--witness-record", "R"]],
    ["a missing witness flag", ["open-epoch", "--task", "T", "--witness-branch", "transition-governance"]],
    ["an inferred branch", ["open-epoch", "--task", "T", "--witness-branch", "guessed",
      "--witness-source", "draft", "--witness-record", "R"]],
    ["a flag with no value", ["inspect", "--task"]],
    ["an empty value", ["inspect", "--task", ""]],
  ]) {
    let error = null;
    try { parseArgs(argv); } catch (e) { error = e; }
    assert.ok(error, `${what}: expected a refusal`);
    assert.strictEqual(error.code, "E_API_ARGUMENTS", `${what}: ${error.message}`);
  }
  // There is no packageDigest flag: the controller derives it and accepts no caller digest.
  let digestFlag = null;
  try {
    parseArgs(["open-epoch", "--task", "T", "--witness-branch", "transition-governance",
      "--witness-source", "draft", "--witness-record", "R", "--package-digest", "a".repeat(64)]);
  } catch (e) { digestFlag = e; }
  assert.strictEqual(digestFlag && digestFlag.code, "E_API_ARGUMENTS");
});

// --- 5b. §D3.3 at the PROCESS level, and the entry-point guard --------------------------------------------

// These cases run the ACTUAL production file as a real process. None of them asserts the guard's
// branch expression; each states an outcome a user or the runner would observe.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const CONTROLLER = path.join(REPO_ROOT, "cressetide", "skills", "vigil", "scripts", "test-provenance-loop.mjs");
const CLI_TIMEOUT = 60000;

// A temp root is proved to be a direct child of the real temp directory carrying the expected prefix
// before anything removes it — the same discipline the loop fixture uses.
function tempRoot(prefix) {
  const made = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  assert.strictEqual(path.dirname(made), fs.realpathSync(os.tmpdir()), `refusing ${made}: not a direct temp child`);
  assert.ok(path.basename(made).startsWith(prefix), `refusing ${made}: wrong prefix`);
  return made;
}

function dropTemp(dir, prefix) {
  assert.ok(path.basename(dir).startsWith(prefix), `refusing to remove ${dir}: wrong prefix`);
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

// Every child copies the parent environment so PATH and SystemRoot survive. Only the direct
// no-argument case deletes the runner marker, to model a real operator shell.
function spawnNode(args, { scrubRunnerMarker = false } = {}) {
  const env = { ...process.env };
  if (scrubRunnerMarker) delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, args, {
    encoding: "utf8", timeout: CLI_TIMEOUT, env, cwd: REPO_ROOT,
  });
}

// R4/R5 reach the production file through an ALIASED ancestor — a real directory junction on Windows
// or a directory symlink elsewhere, pointing at the real repository root. The file executed is
// production bytes reached through that alias, never a copy. The alias is removed on its own, before
// the scratch tree, so no recursive delete can ever descend into the repository through it.
function withAliasedRepo(t, prefix, aliasDir, body) {
  const scratch = tempRoot(prefix);
  const link = path.join(scratch, aliasDir, "repo");
  try {
    fs.mkdirSync(path.dirname(link), { recursive: true });
    try {
      fs.symlinkSync(REPO_ROOT, link, "junction");
    } catch (error) {
      t.skip(`this platform refuses ancestor link creation: ${error && error.code}: ${error && error.message}`);
      return;
    }
    body(link);
  } finally {
    try { fs.rmdirSync(link); } catch { try { fs.unlinkSync(link); } catch { /* already gone */ } }
    assert.ok(fs.existsSync(path.join(REPO_ROOT, "package.json")),
      "the alias must be removed as a link; the repository it pointed at is still here");
    dropTemp(scratch, prefix);
  }
}

const controllerUnder = (repoDir) =>
  path.join(repoDir, "cressetide", "skills", "vigil", "scripts", "test-provenance-loop.mjs");

// `inspect` on a directory holding no control state is the cheapest operation that still exercises a
// real code path end to end, and its closed response is specific enough to prove the CLI actually ran.
function assertRanInspect(run, what) {
  assert.strictEqual(run.error, undefined, `${what}: the child did not start: ${run.error && run.error.message}`);
  assert.strictEqual(run.status, 0, `${what}: expected exit 0\nstdout: ${run.stdout}\nstderr: ${run.stderr}`);
  assert.notStrictEqual(run.stdout.trim(), "",
    `${what}: the CLI produced NO output, which is what a silently disabled entry point looks like`);
  const response = JSON.parse(run.stdout);
  assert.strictEqual(response.present, false, `${what}: an absent control state is reported as absent`);
  assert.strictEqual(response.corrupt, false, what);
  assert.strictEqual(response.counters, null, `${what}: counters are unavailable, never a fabricated zero`);
  return response;
}

// R1. The file name matches Node's default `test-*` discovery pattern, so the raw runner really does
// execute this production file. It must behave as an ordinary module with no tests — not enter the
// CLI, which would refuse with no operation and fail the whole-suite acceptance command.
//
// The marker is scrubbed for the RUNNER, and that is what makes this case real rather than a
// tautology. Inheriting it makes Node refuse outright — "node:test run() is being called recursively
// within a test file. skipping running files." — so no file is executed and nothing is proved. A
// scrubbed child is also the more faithful model: the acceptance command runs from an operator shell
// that has no marker. The marker under test is then the one THIS runner sets for the file it spawns,
// which is exactly the mechanism the guard reads.
test("R1: the raw test runner executes this production file and no CLI runs", () => {
  const run = spawnNode(["--test", "--test-reporter=tap", CONTROLLER], { scrubRunnerMarker: true });
  const out = `${run.stdout}${run.stderr}`;
  assert.strictEqual(run.error, undefined, `the runner did not start: ${run.error && run.error.message}`);
  assert.strictEqual(run.status, 0, `discovery must not fail the suite:\n${out}`);
  assert.match(run.stdout, /^ok 1 /m, `the target file must report a passing result:\n${out}`);
  assert.ok(out.includes("test-provenance-loop.mjs"), `the result must name the target file:\n${out}`);
  assert.doesNotMatch(run.stdout, /^not ok /m, `no failing result:\n${out}`);
  assert.match(run.stdout, /^# fail 0$/m, `no failures in the summary:\n${out}`);
  assert.doesNotMatch(out, /E_API_ARGUMENTS/, `the CLI must not have run:\n${out}`);
  assert.doesNotMatch(out, /unknown operation/, `the CLI must not have run:\n${out}`);
});

// R2. §D3.3: every argument fault is E_API_ARGUMENTS raised before anything runs, and exit is 1 iff
// the operation threw. A missing operation is that case, and the guard must not soften it.
test("R2: a direct no-argument invocation still refuses E_API_ARGUMENTS and exits 1", () => {
  const run = spawnNode([CONTROLLER], { scrubRunnerMarker: true });
  assert.strictEqual(run.error, undefined, `the child did not start: ${run.error && run.error.message}`);
  assert.strictEqual(run.status, 1, `expected exit 1\nstdout: ${run.stdout}\nstderr: ${run.stderr}`);
  assert.strictEqual(run.stdout, "", "a thrown refusal prints nothing on stdout");
  const reported = JSON.parse(run.stderr);
  assert.strictEqual(reported.ok, false);
  assert.strictEqual(reported.code, "E_API_ARGUMENTS");
  assert.match(reported.message, /unknown operation undefined/);
  assert.match(reported.message, /expected one of begin, emit, submit/);
});

// R3. The narrowing conjunct: suppression is for the discovery collision only. A real operation
// spawned from inside this worker inherits NODE_TEST_CONTEXT and must still run, unscrubbed.
test("R3: an argument-bearing CLI child runs under an INHERITED runner marker", () => {
  assert.notStrictEqual(process.env.NODE_TEST_CONTEXT, undefined,
    "this case is only meaningful inside a node:test worker, where the runner sets its marker");
  const scratch = tempRoot("ctide-cli-r3-");
  try {
    const run = spawnNode([CONTROLLER, "inspect", "--task", "TASK-X", "--cwd", scratch]);
    assertRanInspect(run, "an inherited runner marker with an operation");
  } finally {
    dropTemp(scratch, "ctide-cli-r3-");
  }
});

// R4. A PHYSICALLY real ancestor directory whose name contains a space, so the module the loader
// resolves genuinely lives under that name. `import.meta.url` then percent-encodes the space, and a
// comparison that never decodes the URL sees two different paths and silently disables the CLI.
//
// WHY A COPY, AND WHAT IT COSTS. An alias cannot prove this: Node realpaths the ESM entry, so a
// junction inside a spaces directory resolves back to the real repository path, which has no space —
// `import.meta.url` never carries `%20` and the case degenerates into R5's link defect. The space has
// to be in the REAL path, and the repository root does not contain one. So the shipped Vigil skill
// tree is copied verbatim under a physical spaces directory and executed from there.
//
// The copy is the PATH ENVIRONMENT, never the implementation: no source is rewritten, and the
// executed controller's bytes are asserted equal to the production file's below. The whole skill tree
// is the deliberate boundary rather than a hand-maintained import list — `parser-ignore-wrapper.mjs`
// computes `path.resolve(HERE, "..", "vendor")` at module load and is reachable from this controller
// through `head-view-snapshot.mjs`, so a `scripts/`-only copy would leave a real computed path
// dangling and would drift as imports change.
//
// BOUNDED LIMITATION, stated plainly: inside the copy, `parser-ignore-wrapper.mjs`'s derived
// `REPO_ROOT` resolves above the temp root and is NOT production-equivalent. That is acceptable only
// because `inspect` on an absent control state loads the module graph but performs no head-view or
// vendor I/O. The case is self-validating either way — a resolution or I/O failure would exit
// non-zero or print nothing, and the assertions below would fail loudly rather than pass quietly.
test("R4: the CLI runs through a PHYSICAL ancestor path containing a space", () => {
  const scratch = tempRoot("ctide-cli-r4-");
  try {
    const holder = path.join(scratch, "alias with space");
    fs.mkdirSync(holder, { recursive: true });
    fs.cpSync(path.join(REPO_ROOT, "cressetide", "skills", "vigil"), path.join(holder, "vigil"),
      { recursive: true });

    const controller = path.join(holder, "vigil", "scripts", "test-provenance-loop.mjs");
    assert.strictEqual(
      Buffer.compare(fs.readFileSync(controller), fs.readFileSync(CONTROLLER)), 0,
      "the executed controller must be the production file byte for byte, never a rewritten copy",
    );
    assert.ok(controller.includes(" "), "the invoked path really carries a space");
    // The decisive assertion, and the one that makes this independent of R5: the space survives
    // real-path resolution, so no link resolves it away and `import.meta.url` must percent-encode it.
    assert.strictEqual(fs.realpathSync(controller), controller,
      "the spaces ancestor is physically real; nothing here is a junction or symlink");

    const run = spawnNode([controller, "inspect", "--task", "TASK-X", "--cwd", scratch]);
    assertRanInspect(run, "a physical ancestor path containing a space");
  } finally {
    dropTemp(scratch, "ctide-cli-r4-");
  }
});

// R5. A junctioned/symlinked ancestor, with no space involved, so the real-path dimension is proved
// on its own: Node resolves the entry to its real path, and a comparison that never resolves the
// invoked path sees two different paths and silently disables the CLI.
test("R5: the CLI runs through a junctioned or symlinked ancestor", (t) => {
  withAliasedRepo(t, "ctide-cli-r5-", "alias", (link) => {
    const controller = controllerUnder(link);
    assert.notStrictEqual(fs.realpathSync(controller), controller, "the invoked path really is an alias");
    const run = spawnNode([controller, "inspect", "--task", "TASK-X", "--cwd", path.dirname(link)]);
    assertRanInspect(run, "a junctioned or symlinked ancestor");
  });
});

// --- 6. addressing --------------------------------------------------------------------------------------

test("the task address hashes canonicalJson(taskId), so CR/LF, BOM and lone surrogates stay distinct", () => {
  const address = (taskId) => loopPaths("/repo", taskId).hash;
  for (const [a, b, why] of [
    ["a\r\nb", "a\nb", "canonicalText would fold CRLF to LF"],
    ["﻿x", "x", "canonicalText would strip a LEADING BOM"],
    ["\ud800", "\ud801", "the encoder would map both lone surrogates to U+FFFD"],
  ]) {
    assert.notStrictEqual(address(a), address(b), why);
    assert.strictEqual(address(a), sha256Hex(canonicalJson(a)), "the address is exactly sha256Hex(canonicalJson(taskId))");
  }
  assert.notStrictEqual(address("unknown"), address("TASK-1"),
    '"unknown" is a legal opaque task name, never a sentinel');
});
