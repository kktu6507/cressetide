// TP v1.21 §D9: the two unlock branches, the retained-payload body comparands, the per-finding
// evidence equalities before the group digest, and the epoch transition's reset/preserve list.
//
// SCOPE. Every witness, package and evidence record below is a SYNTHETIC document this suite writes.
// They prove mechanical authorization behaviour only: no external reviewer ran, nothing here resolves
// an ASSUM or a Step 6 obligation, and a green run grants no readiness claim.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";

import {
  beginTaskLoop, runProposalIteration, submitReviewedProposal, commitReviewedBatch, openEpoch,
  inspectLoopState,
} from "../cressetide/skills/vigil/scripts/test-provenance-loop.mjs";
import { loopPaths, advance, publishState } from "../cressetide/skills/vigil/scripts/test-provenance-loop-state.mjs";
import {
  canonicalJson, resolutionGroupDigest, sortTypedRefs,
} from "../cressetide/skills/vigil/scripts/provenance-store.mjs";
import {
  TASK, ASSUM_A, TEST_DISCIPLINE, withRepo, seedWorld, writeReview, writeGovernance, emptyGovernance,
  generalFinding, assumFinding, readLoopState, bumpHead,
} from "./fixtures/test-provenance-loop-fixture.mjs";

const refused = async (promise, what) => {
  let error = null;
  try { await promise; } catch (e) { error = e; }
  assert.ok(error, `${what}: expected a refusal, got none`);
  return error;
};

// Drive one epoch to a REPEAT lock carrying the findings a case needs, WITHOUT writing to the store —
// so the second emission sees the same world and therefore produces the same fingerprint.
//
// An unready review is appended already `closed` and is terminal at once. A CLEAN review is appended
// `open` and commit-ready, so it is made terminal by tampering its retained payload: the commit then
// refuses at the hash gate, before any preview or writer call, leaving the store untouched.
async function lockedWith(repo, world, findings) {
  await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
  await runProposalIteration({ repoRoot: repo.root, taskId: TASK });
  writeReview(repo, { base: world.base, findings });
  writeGovernance(repo, emptyGovernance());
  const first = await submitReviewedProposal({ repoRoot: repo.root, taskId: TASK });
  if (first.phase === "open") {
    const retained = readLoopState(repo).epoch.admitted[0].retainedPayloadPath;
    fs.writeFileSync(retained, `${fs.readFileSync(retained, "utf8")} `, "utf8");
    const moved = await commitReviewedBatch({ repoRoot: repo.root, taskId: TASK });
    assert.strictEqual(moved.ok, false);
    assert.strictEqual(moved.code, "E_LOOP_PAYLOAD_MOVED");
    assert.strictEqual(moved.writerInvoked, false, "nothing was written, so the world is unchanged");
  } else {
    assert.strictEqual(first.phase, "closed", "an unready review is appended already closed");
  }

  // The same world, the same review: a new emission whose fingerprint is wasSeen.
  await runProposalIteration({ repoRoot: repo.root, taskId: TASK });
  writeReview(repo, { base: world.base, findings });
  const repeat = await submitReviewedProposal({ repoRoot: repo.root, taskId: TASK });
  assert.strictEqual(repeat.wasSeen, true);
  assert.strictEqual(repeat.status, "locked");
  return readLoopState(repo);
}

const reconsideration = (recordId, lockedFingerprint, findings, by = TEST_DISCIPLINE) => ({
  recordId, kind: "review-ruling", by, subjectRef: TASK, ruling: "ok",
  loopReconsideration: { taskId: TASK, lockedFingerprint, findings, decision: "re-review" },
});

// --- 1. semantic-reconsideration -----------------------------------------------------------------------

test("a general locked subset unlocks on a matching loopReconsideration, and the epoch resets correctly",
  () => withRepo(async (repo) => {
    const world = await seedWorld(repo);
    const locked = await lockedWith(repo, world, [generalFinding()]);
    const general = locked.lock.lockedFindings.filter((i) => i.kind === "wrong-tag");
    assert.strictEqual(general.length, 1, "the lock retained the general identity");

    writeGovernance(repo, emptyGovernance({
      packages: [{
        recordId: "R-recon", branch: "semantic-reconsideration",
        findingKeys: general, transitionDraft: null, successorClauseDraft: null,
        witnessDraft: reconsideration("R-recon", locked.lock.fingerprint, general),
        semanticEvidenceRefs: [],
      }],
    }));
    const opened = await openEpoch({
      repoRoot: repo.root, taskId: TASK,
      witness: { branch: "semantic-reconsideration", source: "draft", recordId: "R-recon" },
    });
    assert.strictEqual(opened.epochOrdinal, 2);
    assert.strictEqual(opened.closedEpochAdmissions, 2);
    assert.strictEqual(opened.observedEpochs, 2);

    const after = readLoopState(repo);
    // RESET
    assert.deepStrictEqual(after.epoch.admitted, []);
    assert.strictEqual(after.status, "open");
    assert.strictEqual(after.lock, null);
    assert.strictEqual(after.currentAdmissionId, null);
    assert.strictEqual(after.committed, null);
    assert.strictEqual(after.lastEmission, null);
    assert.deepStrictEqual(after.pending, []);
    assert.strictEqual(after.currentPassInvalidated, true);
    // PRESERVED
    assert.strictEqual(after.observedIterations, locked.observedIterations, "cumulative, never reset");
    assert.deepStrictEqual(after.counters, locked.counters, "both counters AND lastStaleSubject survive");
    assert.deepStrictEqual(after.lastTwo, locked.lastTwo);
    assert.strictEqual(after.consumedWitnesses.length, 1);
    assert.strictEqual(after.consumedWitnesses[0].recordId, "R-recon");
    // Invariant 2 holds across the transition.
    assert.strictEqual(after.observedIterations, after.closedEpochAdmissions + after.epoch.admitted.length);
  }));

test("a genuinely EMPTY whole locked set unlocks on findings:[]", () => withRepo(async (repo) => {
  const world = await seedWorld(repo);
  const locked = await lockedWith(repo, world, []);          // a clean review, repeated
  assert.deepStrictEqual(locked.lock.lockedFindings, [], "the entire locked set is empty");

  writeGovernance(repo, emptyGovernance({
    packages: [{
      recordId: "R-recon", branch: "semantic-reconsideration", findingKeys: [],
      transitionDraft: null, successorClauseDraft: null,
      witnessDraft: reconsideration("R-recon", locked.lock.fingerprint, []),
      semanticEvidenceRefs: [],
    }],
  }));
  const opened = await openEpoch({
    repoRoot: repo.root, taskId: TASK,
    witness: { branch: "semantic-reconsideration", source: "draft", recordId: "R-recon" },
  });
  assert.strictEqual(opened.epochOrdinal, 2);
}));

test("an empty findings set against a PURELY ASSUM locked set is refused", () => withRepo(async (repo) => {
  const world = await seedWorld(repo);
  await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
  await runProposalIteration({ repoRoot: repo.root, taskId: TASK });
  const first = writeReview(repo, { base: world.base, findings: [assumFinding()] });
  const identity = {
    testRef: { ...first.batch.results[0].testRef },
    kind: "assum-reading-change",
    binding: { clauseRef: ASSUM_A },
  };
  writeGovernance(repo, emptyGovernance({ pendingDeclarations: [{ identity, governance: { kind: "undecided" } }] }));
  await submitReviewedProposal({ repoRoot: repo.root, taskId: TASK });
  await runProposalIteration({ repoRoot: repo.root, taskId: TASK });
  writeReview(repo, { base: world.base, findings: [assumFinding()] });
  const repeat = await submitReviewedProposal({ repoRoot: repo.root, taskId: TASK });
  assert.strictEqual(repeat.status, "locked");
  const locked = readLoopState(repo);
  assert.strictEqual(locked.lock.lockedFindings.length, 1, "the locked set is non-empty");
  assert.strictEqual(locked.lock.lockedFindings[0].kind, "assum-reading-change");

  writeGovernance(repo, emptyGovernance({
    pendingDeclarations: [{ identity, governance: { kind: "undecided" } }],
    packages: [{
      recordId: "R-recon", branch: "semantic-reconsideration", findingKeys: [],
      transitionDraft: null, successorClauseDraft: null,
      witnessDraft: reconsideration("R-recon", locked.lock.fingerprint, []),
      semanticEvidenceRefs: [],
    }],
  }));
  const error = await refused(openEpoch({
    repoRoot: repo.root, taskId: TASK,
    witness: { branch: "semantic-reconsideration", source: "draft", recordId: "R-recon" },
  }), "an empty general subset over a purely-ASSUM lock");
  assert.strictEqual(error.code, "E_LOOP_WITNESS_UNAUTHORIZED");
  assert.match(error.message, /entire locked set is empty/);
}));

test("the reconsideration carrier's principal, task and fingerprint are all charged",
  () => withRepo(async (repo) => {
    const world = await seedWorld(repo);
    const locked = await lockedWith(repo, world, [generalFinding()]);
    const general = locked.lock.lockedFindings.filter((i) => i.kind === "wrong-tag");
    const withCarrier = (carrier, findingKeys = general) => writeGovernance(repo, emptyGovernance({
      packages: [{
        recordId: "R-recon", branch: "semantic-reconsideration", findingKeys,
        transitionDraft: null, successorClauseDraft: null, witnessDraft: carrier, semanticEvidenceRefs: [],
      }],
    }));
    const open = () => openEpoch({
      repoRoot: repo.root, taskId: TASK,
      witness: { branch: "semantic-reconsideration", source: "draft", recordId: "R-recon" },
    });

    withCarrier({ ...reconsideration("R-recon", locked.lock.fingerprint, general), by: { kind: "discipline", discipline: "code" } });
    assert.strictEqual((await refused(open(), "a non-test principal")).code, "E_LOOP_WITNESS_UNAUTHORIZED");

    withCarrier(reconsideration("R-recon", "0".repeat(64), general));
    assert.match((await refused(open(), "a wrong lockedFingerprint")).message, /lockedFingerprint/);

    const wrongSet = reconsideration("R-recon", locked.lock.fingerprint, []);
    withCarrier(wrongSet, []);
    assert.match((await refused(open(), "an unequal findings set")).message, /general subset|entire locked set/);

    // An arbiter is legal, and the positive control proves the negatives above are single-variable.
    withCarrier(reconsideration("R-recon", locked.lock.fingerprint, general, { kind: "arbiter" }));
    assert.strictEqual((await open()).epochOrdinal, 2);
  }));

test("a witness that is not new against the OLD baselines is refused", () => withRepo(async (repo) => {
  const world = await seedWorld(repo);
  const locked = await lockedWith(repo, world, [generalFinding()]);
  const general = locked.lock.lockedFindings.filter((i) => i.kind === "wrong-tag");
  const pkg = {
    recordId: "R-recon", branch: "semantic-reconsideration", findingKeys: general,
    transitionDraft: null, successorClauseDraft: null,
    witnessDraft: reconsideration("R-recon", locked.lock.fingerprint, general), semanticEvidenceRefs: [],
  };
  writeGovernance(repo, emptyGovernance({ packages: [pkg] }));
  await openEpoch({
    repoRoot: repo.root, taskId: TASK,
    witness: { branch: "semantic-reconsideration", source: "draft", recordId: "R-recon" },
  });
  // The same record is now consumed AND in the draft baseline.
  const after = readLoopState(repo);
  assert.ok(after.knownDraftIds.includes("R-recon"));
  const state = readLoopState(repo);
  const paths = loopPaths(repo.root, TASK);
  // Re-lock the epoch so the SAME witness is offered a second time. `closedEpochAdmissions` stays
  // where the epoch open left it — it moves only in an epoch-opening publication (§D2.2 invariant 3)
  // and never decreases (invariant 4) — so `observedIterations` absorbs the restored admissions.
  publishState(paths, advance(state, {
    status: "locked",
    currentAdmissionId: state.lastTwo[0].admissionId,
    epoch: { ...state.epoch, admitted: locked.epoch.admitted },
    observedIterations: state.closedEpochAdmissions + locked.epoch.admitted.length,
    lock: locked.lock,
  }));
  const error = await refused(openEpoch({
    repoRoot: repo.root, taskId: TASK,
    witness: { branch: "semantic-reconsideration", source: "draft", recordId: "R-recon" },
  }), "a consumed witness");
  assert.strictEqual(error.code, "E_LOOP_WITNESS_NOT_NEW");
}));

// --- 2. openEpoch preconditions ---------------------------------------------------------------------------

test("openEpoch refusals THROW; an unlocked epoch and a malformed witness are both preconditions",
  () => withRepo(async (repo) => {
    await seedWorld(repo);
    await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
    const notLocked = await refused(openEpoch({
      repoRoot: repo.root, taskId: TASK,
      witness: { branch: "semantic-reconsideration", source: "draft", recordId: "R-x" },
    }), "an unlocked epoch");
    assert.strictEqual(notLocked.code, "E_LOOP_NOT_LOCKED");
    assert.strictEqual(notLocked.name, "LoopError", "a thrown precondition, not a returned outcome");

    for (const [what, witness] of [
      ["an unknown branch", { branch: "guessed", source: "draft", recordId: "R" }],
      ["an unknown source", { branch: "semantic-reconsideration", source: "guessed", recordId: "R" }],
      ["an empty recordId", { branch: "semantic-reconsideration", source: "draft", recordId: "" }],
      ["a caller digest", { branch: "semantic-reconsideration", source: "draft", recordId: "R", packageDigest: "a".repeat(64) }],
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const error = await refused(openEpoch({ repoRoot: repo.root, taskId: TASK, witness }), what);
      assert.strictEqual(error.code, "E_API_ARGUMENTS", `${what}: ${error.message}`);
    }
  }));

// --- 3. transition-governance -------------------------------------------------------------------------------

// One ASSUM-locked epoch plus the drafted package that would authorize a retire of that ASSUM.
async function assumLocked(repo, world) {
  await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
  await runProposalIteration({ repoRoot: repo.root, taskId: TASK });
  const first = writeReview(repo, { base: world.base, findings: [assumFinding()] });
  const identity = {
    testRef: { ...first.batch.results[0].testRef },
    kind: "assum-reading-change",
    binding: { clauseRef: ASSUM_A },
  };
  const declarations = [{ identity, governance: { kind: "undecided" } }];
  writeGovernance(repo, emptyGovernance({ pendingDeclarations: declarations }));
  await submitReviewedProposal({ repoRoot: repo.root, taskId: TASK });
  await runProposalIteration({ repoRoot: repo.root, taskId: TASK });
  writeReview(repo, { base: world.base, findings: [assumFinding()] });
  await submitReviewedProposal({ repoRoot: repo.root, taskId: TASK });
  const locked = readLoopState(repo);
  assert.strictEqual(locked.status, "locked");
  return { locked, identity, declarations, entry: first.inventory.entries[0] };
}

const evidenceFor = (recordId, entry, over = {}) => ({
  recordId, kind: "review-ruling", by: TEST_DISCIPLINE, subjectRef: ASSUM_A, ruling: "ok",
  taskId: TASK, testRef: { ...entry.testRef },
  baseBodyDigest: entry.baseBodyDigest, headBodyDigest: entry.headBodyDigest,
  findingKind: "assum-reading-change", binding: { clauseRef: ASSUM_A },
  ...over,
});

test("the per-finding evidence equalities are charged BEFORE the group digest", () => withRepo(async (repo) => {
  const world = await seedWorld(repo);
  const { locked, identity, declarations, entry } = await assumLocked(repo, world);

  // Evidence that names ANOTHER task: the coverage check must refuse before any digest comparison.
  writeGovernance(repo, emptyGovernance({
    pendingDeclarations: declarations,
    recordsToCreate: [evidenceFor("R-ev", entry, { taskId: "TASK-OTHER" })],
    packages: [{
      recordId: "R-w", branch: "transition-governance", findingKeys: [identity],
      transitionDraft: {
        id: "T-r", subject: ASSUM_A, action: "retire",
        authorityRef: { kind: "discipline", discipline: "code" },
        ackRef: { kind: "review-ruling", ref: "R-w" },
      },
      successorClauseDraft: null,
      witnessDraft: {
        recordId: "R-w", kind: "review-ruling", by: { kind: "discipline", discipline: "code" },
        subjectRef: ASSUM_A, ruling: "ok", resolutionGroupDigest: "0".repeat(64),
      },
      semanticEvidenceRefs: [{ kind: "review-ruling", ref: "R-ev" }],
    }],
  }));
  const error = await refused(openEpoch({
    repoRoot: repo.root, taskId: TASK,
    witness: { branch: "transition-governance", source: "draft", recordId: "R-w" },
  }), "evidence naming another task");
  assert.strictEqual(error.code, "E_LOOP_WITNESS_UNAUTHORIZED");
  assert.match(error.message, /no declared semanticEvidenceRef covers/,
    "the per-finding coverage refuses first; the digest is never reached");
  assert.strictEqual(readLoopState(repo).epoch.ordinal, locked.epoch.ordinal, "no epoch was opened");
}));

test("the body comparands come from the LOCKING admission's retained payload, hash-checked first",
  () => withRepo(async (repo) => {
    const world = await seedWorld(repo);
    const { locked, identity, declarations, entry } = await assumLocked(repo, world);
    const admission = locked.epoch.admitted[locked.epoch.admitted.length - 1];
    assert.strictEqual(locked.currentAdmissionId, admission.admissionId, "invariant 12: the locking admission");

    writeGovernance(repo, emptyGovernance({
      pendingDeclarations: declarations,
      recordsToCreate: [evidenceFor("R-ev", entry)],
      packages: [{
        recordId: "R-w", branch: "transition-governance", findingKeys: [identity],
        transitionDraft: {
          id: "T-r", subject: ASSUM_A, action: "retire",
          authorityRef: { kind: "discipline", discipline: "code" },
          ackRef: { kind: "review-ruling", ref: "R-w" },
        },
        successorClauseDraft: null,
        witnessDraft: {
          recordId: "R-w", kind: "review-ruling", by: { kind: "discipline", discipline: "code" },
          subjectRef: ASSUM_A, ruling: "ok", resolutionGroupDigest: "0".repeat(64),
        },
        semanticEvidenceRefs: [{ kind: "review-ruling", ref: "R-ev" }],
      }],
    }));

    // Tamper the retained payload: the hash gate refuses BEFORE anything is parsed or compared.
    fs.writeFileSync(admission.retainedPayloadPath, `${fs.readFileSync(admission.retainedPayloadPath, "utf8")} `, "utf8");
    const moved = await refused(openEpoch({
      repoRoot: repo.root, taskId: TASK,
      witness: { branch: "transition-governance", source: "draft", recordId: "R-w" },
    }), "a moved retained payload");
    assert.strictEqual(moved.code, "E_LOOP_PAYLOAD_MOVED");
    assert.match(moved.message, /retained payload has changed/);
  }));

// §D9.1c draws the line between the two refusals itself: an UNCOVERED identity is the controller's
// own E_LOOP_WITNESS_UNAUTHORIZED, and "only then" is the group digest compared — "the same
// E_WITNESS_COVERAGE rule the writer charges", which is a source-owned typed cause.
test("the two unlock refusals keep their separate identities: unauthorized coverage, then witness coverage",
  () => withRepo(async (repo) => {
    const world = await seedWorld(repo);
    const { locked, identity, declarations, entry } = await assumLocked(repo, world);
    const transitionDraft = {
      id: "T-r", subject: ASSUM_A, action: "retire",
      authorityRef: { kind: "discipline", discipline: "code" },
      ackRef: { kind: "review-ruling", ref: "R-w" },
    };
    const pkg = (resolutionGroupDigest) => ({
      recordId: "R-w", branch: "transition-governance", findingKeys: [identity],
      transitionDraft, successorClauseDraft: null,
      witnessDraft: {
        recordId: "R-w", kind: "review-ruling", by: { kind: "discipline", discipline: "code" },
        subjectRef: ASSUM_A, ruling: "ok", resolutionGroupDigest,
      },
      semanticEvidenceRefs: [{ kind: "review-ruling", ref: "R-ev" }],
    });
    const open = () => openEpoch({
      repoRoot: repo.root, taskId: TASK,
      witness: { branch: "transition-governance", source: "draft", recordId: "R-w" },
    });

    // COVERING evidence, so the per-finding scan passes and the digest is actually reached.
    writeGovernance(repo, emptyGovernance({
      pendingDeclarations: declarations,
      recordsToCreate: [evidenceFor("R-ev", entry)],
      packages: [pkg("0".repeat(64))],
    }));
    const coverage = await refused(open(), "a witness that does not cover its group");
    assert.strictEqual(coverage.code, "E_WITNESS_COVERAGE",
      "the source-owned typed cause keeps its identity and is not remapped to a controller code");
    assert.strictEqual(coverage.name, "ProvenanceError");
    assert.match(coverage.message, /resolutionGroupDigest mismatch/);
    assert.strictEqual(readLoopState(repo).epoch.ordinal, locked.epoch.ordinal, "no epoch was opened");

    // The SAME package with evidence that covers nothing refuses earlier, under the other code.
    writeGovernance(repo, emptyGovernance({
      pendingDeclarations: declarations,
      recordsToCreate: [evidenceFor("R-ev", entry, { findingKind: "wrong-tag" })],
      packages: [pkg("0".repeat(64))],
    }));
    const uncovered = await refused(open(), "an identity no declared evidence covers");
    assert.strictEqual(uncovered.code, "E_LOOP_WITNESS_UNAUTHORIZED");
    assert.match(uncovered.message, /no declared semanticEvidenceRef covers/);

    // And the correct digest authorizes, which is what makes the mismatch above meaningful.
    writeGovernance(repo, emptyGovernance({
      pendingDeclarations: declarations,
      recordsToCreate: [evidenceFor("R-ev", entry)],
      packages: [pkg(resolutionGroupDigest({
        subjectRef: ASSUM_A,
        action: "retire",
        successor: null,
        semanticEvidenceRefs: sortTypedRefs([{ kind: "review-ruling", ref: "R-ev" }]),
      }))],
    }));
    const opened = await open();
    assert.strictEqual(opened.epochOrdinal, locked.epoch.ordinal + 1);
    assert.strictEqual(opened.openedBy.source, "draft");
    assert.strictEqual(opened.openedBy.packageDigest.length, 64, "the digest is derived internally");
  }));

// §D5.1:477 requires the SAME full structural, raw and schema validation of the governance file at
// EVERY read. Two of the three reads used to take a bare JSON.parse.
test("the governance file gets the same complete validation at begin, at submit and at openEpoch",
  () => withRepo(async (repo) => {
    const world = await seedWorld(repo);
    const paths = loopPaths(repo.root, TASK);
    fs.mkdirSync(paths.dir, { recursive: true });

    // A raw DUPLICATE member: refused before parsing, so the last-wins collapse never happens.
    const duplicated = '{"governanceVersion":1,"taskId":"TASK-1","inventoryDigest":"'
      + `${"0".repeat(64)}","pendingDeclarations":[],"packages":[],"packages":[],`
      + '"recordsToCreate":[],"resolutions":[],"resolutionCarrierUpdates":[]}\n';
    fs.writeFileSync(paths.governance, duplicated, "utf8");
    const atBegin = await refused(beginTaskLoop({ repoRoot: repo.root, taskId: TASK }), "a duplicate at begin");
    assert.match(atBegin.message, /duplicate/i);
    assert.ok(!fs.existsSync(paths.state), "begin refused before creating any state");

    // A structurally incomplete drafted record: charged through the store's own recordPayloadComplete.
    writeGovernance(repo, emptyGovernance({ recordsToCreate: [{ recordId: "R-bad", kind: "review-ruling" }] }));
    const incomplete = await refused(beginTaskLoop({ repoRoot: repo.root, taskId: TASK }), "an incomplete record");
    assert.strictEqual(incomplete.code, "E_LOOP_REVIEW_INVALID");
    assert.match(incomplete.message, /recordsToCreate: record R-bad missing/);

    // A carrier update whose key set is not the per-action closed set, through the writer's own rule.
    writeGovernance(repo, emptyGovernance({
      resolutionCarrierUpdates: [{ action: "preserve", dpId: "DP-1", rulingRef: { kind: "review-ruling", ref: "R-x" } }],
    }));
    const carrier = await refused(beginTaskLoop({ repoRoot: repo.root, taskId: TASK }), "a bad carrier update");
    assert.strictEqual(carrier.code, "E_LOOP_REVIEW_INVALID");
    assert.match(carrier.message, /"preserve" carrier update's key set is not the canonical closed set \(undeclared: rulingRef\)/);

    // Now a clean begin, and the same duplicate is refused at SUBMIT too.
    writeGovernance(repo, emptyGovernance());
    await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
    await runProposalIteration({ repoRoot: repo.root, taskId: TASK });
    writeReview(repo, { base: world.base });
    fs.writeFileSync(paths.governance, duplicated, "utf8");
    const atSubmit = await refused(submitReviewedProposal({ repoRoot: repo.root, taskId: TASK }), "a duplicate at submit");
    assert.match(atSubmit.message, /duplicate/i);
    assert.strictEqual(readLoopState(repo).epoch.admitted.length, 0, "nothing was admitted");

    // And at openEpoch, on a locked state.
    writeGovernance(repo, emptyGovernance());
    const locked = await lockedWith(repo, world, [generalFinding()]);
    assert.strictEqual(locked.status, "locked");
    fs.writeFileSync(paths.governance, duplicated, "utf8");
    const atOpen = await refused(openEpoch({
      repoRoot: repo.root, taskId: TASK,
      witness: { branch: "semantic-reconsideration", source: "draft", recordId: "R-recon" },
    }), "a duplicate at openEpoch");
    assert.match(atOpen.message, /duplicate/i);
  }));

test("a draft witness already in the pre-state, and a package naming an unlocked identity, are refused",
  () => withRepo(async (repo) => {
    const world = await seedWorld(repo);
    const { identity, declarations, entry } = await assumLocked(repo, world);
    const pkg = (over) => ({
      recordId: "R-w", branch: "transition-governance", findingKeys: [identity],
      transitionDraft: {
        id: "T-r", subject: ASSUM_A, action: "retire",
        authorityRef: { kind: "discipline", discipline: "code" },
        ackRef: { kind: "review-ruling", ref: "R-w" },
      },
      successorClauseDraft: null,
      witnessDraft: {
        recordId: "R-w", kind: "review-ruling", by: { kind: "discipline", discipline: "code" },
        subjectRef: ASSUM_A, ruling: "ok", resolutionGroupDigest: "0".repeat(64),
      },
      semanticEvidenceRefs: [{ kind: "review-ruling", ref: "R-ev" }],
      ...over,
    });
    // A findingKeys entry the lock never held.
    writeGovernance(repo, emptyGovernance({
      pendingDeclarations: declarations,
      recordsToCreate: [evidenceFor("R-ev", entry)],
      packages: [pkg({ findingKeys: [{ ...identity, binding: { clauseRef: "ASSUM-0000000000000000000000000Z" } }] })],
    }));
    const unlocked = await refused(openEpoch({
      repoRoot: repo.root, taskId: TASK,
      witness: { branch: "transition-governance", source: "draft", recordId: "R-w" },
    }), "an unlocked identity");
    assert.strictEqual(unlocked.code, "E_LOOP_WITNESS_UNAUTHORIZED");
    assert.match(unlocked.message, /not a locked assum-reading-change identity/);

    // An ackRef that does not name the package's own witnessDraft.
    writeGovernance(repo, emptyGovernance({
      pendingDeclarations: declarations,
      recordsToCreate: [evidenceFor("R-ev", entry)],
      packages: [pkg({
        transitionDraft: {
          id: "T-r", subject: ASSUM_A, action: "retire",
          authorityRef: { kind: "discipline", discipline: "code" },
          ackRef: { kind: "plan-gate", ref: "R-w" },
        },
      })],
    }));
    const ack = await refused(openEpoch({
      repoRoot: repo.root, taskId: TASK,
      witness: { branch: "transition-governance", source: "draft", recordId: "R-w" },
    }), "an ackRef of the wrong kind");
    assert.match(ack.message, /does not name its own witnessDraft/);
  }));

test("no GovernancePackage for a draft witness is unauthorized, and a package without a witnessDraft is invalid",
  () => withRepo(async (repo) => {
    const world = await seedWorld(repo);
    await assumLocked(repo, world);
    writeGovernance(repo, emptyGovernance());
    const missing = await refused(openEpoch({
      repoRoot: repo.root, taskId: TASK,
      witness: { branch: "transition-governance", source: "draft", recordId: "R-w" },
    }), "no package");
    assert.strictEqual(missing.code, "E_LOOP_WITNESS_UNAUTHORIZED");

    writeGovernance(repo, emptyGovernance({
      packages: [{
        recordId: "R-w", branch: "transition-governance", findingKeys: [],
        transitionDraft: { id: "T", subject: ASSUM_A, action: "retire" },
        successorClauseDraft: null, witnessDraft: null, semanticEvidenceRefs: [],
      }],
    }));
    const noWitness = await refused(openEpoch({
      repoRoot: repo.root, taskId: TASK,
      witness: { branch: "transition-governance", source: "draft", recordId: "R-w" },
    }), "a package with no witnessDraft");
    assert.strictEqual(noWitness.code, "E_LOOP_REVIEW_INVALID");
    assert.match(noWitness.message, /packages exist only for a draft witness/);
  }));

test("an inspection after an unlock reports the new epoch and preserves cumulative telemetry",
  () => withRepo(async (repo) => {
    const world = await seedWorld(repo);
    const locked = await lockedWith(repo, world, [generalFinding()]);
    const general = locked.lock.lockedFindings.filter((i) => i.kind === "wrong-tag");
    writeGovernance(repo, emptyGovernance({
      packages: [{
        recordId: "R-recon", branch: "semantic-reconsideration", findingKeys: general,
        transitionDraft: null, successorClauseDraft: null,
        witnessDraft: reconsideration("R-recon", locked.lock.fingerprint, general), semanticEvidenceRefs: [],
      }],
    }));
    await openEpoch({
      repoRoot: repo.root, taskId: TASK,
      witness: { branch: "semantic-reconsideration", source: "draft", recordId: "R-recon" },
    });
    const inspected = await inspectLoopState({ repoRoot: repo.root, taskId: TASK });
    assert.strictEqual(inspected.epochOrdinal, 2);
    assert.strictEqual(inspected.status, "open");
    assert.strictEqual(inspected.currentAdmissionId, null);
    assert.strictEqual(inspected.observedIterations, 2, "cumulative across the epoch boundary");
    assert.strictEqual(inspected.observedEpochs, 2);
    assert.deepStrictEqual(inspected.counters.staleBatchRejections, { observed: 0, uncertain: false });
    // A new cycle really is possible again.
    bumpHead(repo, 99);
    await runProposalIteration({ repoRoot: repo.root, taskId: TASK });
    assert.strictEqual(readLoopState(repo).epoch.ordinal, 2);
  }));
