// TP v1.21 §D1/§D2/§D4/§D7: addressing, the twelve invariants, containment and lock ownership,
// publication, the emission's four boundaries, and the single admission publication.
//
// SCOPE. Mechanical state behaviour on shipped synthetic fixtures only. No reviewer ran, and nothing
// here claims convergence or readiness.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import {
  LOOP_PREFIX, MAX_EPOCH_ADMISSIONS, advance, describeState, initialState, loopPaths,
  publishState, readState, taskHash, withLock,
} from "../cressetide/skills/vigil/scripts/test-provenance-loop-state.mjs";
import {
  canonicalJson, sha256Hex, FINDING_KIND_ORDER,
} from "../cressetide/skills/vigil/scripts/provenance-store.mjs";
import { captureHeadViewSnapshot } from "../cressetide/skills/vigil/scripts/head-view-snapshot.mjs";
import {
  beginTaskLoop, runProposalIteration, submitReviewedProposal, commitReviewedBatch,
  recordVerification, openEpoch, inspectLoopState,
} from "../cressetide/skills/vigil/scripts/test-provenance-loop.mjs";
import {
  TASK, withRepo, seedWorld, writeReview, writeGovernance, emptyGovernance, generalFinding, readLoopState, bumpHead,
} from "./fixtures/test-provenance-loop-fixture.mjs";

const refused = async (promise, what) => {
  let error = null;
  try { await promise; } catch (e) { error = e; }
  assert.ok(error, `${what}: expected a refusal, got none`);
  return error;
};

const baseState = () => initialState({
  taskId: TASK,
  baseProvenance: { treeOid: "a".repeat(40), storePath: ".ctide/provenance.json", storeDigest: "b".repeat(64) },
  createdAgainstStoreDigest: "c".repeat(64),
  knownRecordIds: [], knownDraftIds: [],
});

// --- 1. the twelve invariants ---------------------------------------------------------------------------

test("a freshly initialized state satisfies every invariant", () => {
  assert.deepStrictEqual(describeState(baseState()), { ok: true });
});

// §D2.1 is a closed schema, so an invariant case has to be built from COMPLETE shapes: an incomplete
// nested object fails the shape check first and the case would then pass for the wrong reason.
const BASE_WITNESS = { treeOid: "a".repeat(40), storePath: ".ctide/provenance.json", storeDigest: "b".repeat(64) };
const RECORD = { recordId: "R-X", kind: "provenance-batch" };
const committedOf = (admissionId) => ({
  admissionId, headRef: { kind: "provenance-batch", ref: "R-X" }, batchDigest: "1".repeat(64),
  inventoryDigest: "9".repeat(64), baseProvenance: BASE_WITNESS, headViewDigest: "2".repeat(64),
  registryDigest: "3".repeat(64), payloadRawDigest: "0".repeat(64), fingerprint: "f".repeat(64),
  expectedBatchRecord: RECORD,
});
const IDENTITY = {
  testRef: { path: "test/a.test.mjs", adapterId: "node-test", structuralId: 's:["a"]' },
  kind: "assum-reading-change",
  binding: { clauseRef: "ASSUM-0000000000000000000000000A" },
};
const admissionWith = (findingIdentities) => ({
  admissionId: "1".repeat(32), at: 1, epochOrdinal: 1, emissionId: "2".repeat(32),
  reviewRawDigest: "d".repeat(64), governanceRawDigest: "e".repeat(64), fingerprint: "f".repeat(64),
  commitReady: false, batchRecordId: "R-X", retainedPayloadPath: "p", payloadRawDigest: "0".repeat(64),
  admittedClaims: { taskId: TASK, baseProvenance: BASE_WITNESS, inventoryDigest: "9".repeat(64) },
  findingIdentities, phase: "closed", closeReason: null,
});
const intentOf = (admissionId, over = {}) => ({
  admissionId, batchRecordId: "R-X", expectedPreviousBatchRef: null,
  expectedInputProvenanceStoreDigest: "c".repeat(64), inventoryDigest: "9".repeat(64),
  expectedBatchRecord: RECORD, payloadRawDigest: "0".repeat(64), retainedPayloadPath: "p",
  phase: "prepared", attemptedAt: null, outcome: null, ...over,
});

test("each invariant is charged, and a violating state is never publishable", () => {
  const admission = {
    admissionId: "1".repeat(32), at: 1, epochOrdinal: 1, emissionId: "2".repeat(32),
    reviewRawDigest: "d".repeat(64), governanceRawDigest: "e".repeat(64), fingerprint: "f".repeat(64),
    commitReady: true, batchRecordId: "R-X", retainedPayloadPath: "p", payloadRawDigest: "0".repeat(64),
    admittedClaims: { taskId: TASK, baseProvenance: BASE_WITNESS, inventoryDigest: "9".repeat(64) },
    findingIdentities: [], phase: "open", closeReason: null,
  };
  const withAdmission = (over = {}) => ({
    ...baseState(),
    epoch: { ordinal: 1, openedBy: null, admitted: [admission] },
    observedIterations: 1, currentAdmissionId: admission.admissionId, ...over,
  });

  const cases = [
    ["1: over the cap", {
      ...baseState(),
      epoch: { ordinal: 1, openedBy: null, admitted: Array.from({ length: 9 }, (_, n) => ({ ...admission, admissionId: String(n).repeat(32).slice(0, 32) })) },
      observedIterations: 9,
    }, /invariant 1/],
    ["2: the count does not add up", { ...withAdmission(), observedIterations: 5 }, /invariant 2/],
    ["5: a lock without a locked status", { ...withAdmission(), lock: { reason: "repeat", fingerprint: admission.fingerprint, at: 1, duplicateOf: null, lockedFindings: [] } }, /invariant 5/],
    ["6: committed with a pending intent", {
      ...withAdmission(),
      committed: committedOf(admission.admissionId),
      pendingCommit: intentOf(admission.admissionId),
    }, /invariant 6/],
    ["8: a currentAdmissionId naming nothing", { ...baseState(), currentAdmissionId: "9".repeat(32) }, /invariant 8/],
    ["9: two open admissions", {
      ...baseState(),
      epoch: { ordinal: 1, openedBy: null, admitted: [admission, { ...admission, admissionId: "3".repeat(32) }] },
      observedIterations: 2, currentAdmissionId: admission.admissionId,
    }, /invariant 9/],
    ["11: committed naming nothing", { ...baseState(), committed: committedOf("9".repeat(32)) }, /invariant 11/],
    ["12: a locked state with no locking admission", {
      ...baseState(), status: "locked",
      lock: { reason: "repeat", fingerprint: "f".repeat(64), at: 1, duplicateOf: null, lockedFindings: [] },
    }, /invariant 12/],
    ["12: a lock whose fingerprint is not the locking admission's", {
      ...withAdmission({ status: "locked" }),
      lock: { reason: "repeat", fingerprint: "a".repeat(64), at: 1, duplicateOf: null, lockedFindings: [] },
    }, /invariant 12/],
  ];
  for (const [what, state, pattern] of cases) {
    const described = describeState(state);
    assert.strictEqual(described.ok, false, `${what}: expected a violation`);
    assert.match(described.reason, pattern, what);
  }
});

test("a known refused closeReason always names its class; both-null belongs to unknown and to not-ready", () => {
  const admission = {
    admissionId: "1".repeat(32), at: 1, epochOrdinal: 1, emissionId: "2".repeat(32),
    reviewRawDigest: "d".repeat(64), governanceRawDigest: "e".repeat(64), fingerprint: "f".repeat(64),
    commitReady: false, batchRecordId: "R-X", retainedPayloadPath: "p", payloadRawDigest: "0".repeat(64),
    admittedClaims: { taskId: TASK, baseProvenance: BASE_WITNESS, inventoryDigest: "9".repeat(64) },
    findingIdentities: [], phase: "closed",
  };
  const withReason = (closeReason) => ({
    ...baseState(),
    epoch: { ordinal: 1, openedBy: null, admitted: [{ ...admission, closeReason }] },
    observedIterations: 1, currentAdmissionId: admission.admissionId,
  });
  assert.strictEqual(describeState(withReason({ stage: "not-ready", kind: "not-ready", class: null, code: null })).ok, true);
  assert.strictEqual(describeState(withReason({ stage: "not-ready", kind: "repeat", class: null, code: null })).ok, true);
  assert.strictEqual(describeState(withReason({ stage: "writer", kind: "unknown", class: null, code: null })).ok, true);
  assert.strictEqual(describeState(withReason({ stage: "writer", kind: "refused", class: "ProvenanceError", code: null })).ok, true,
    "a known refusal may carry a null CODE when the cause has none");
  const bad = describeState(withReason({ stage: "writer", kind: "refused", class: null, code: null }));
  assert.strictEqual(bad.ok, false, "but a known refusal always names its class");
  assert.match(bad.reason, /known refused closeReason always carries a class/);
});

test('status is persisted as only "open" or "locked"; corruption is a read projection', () => {
  const persisted = { ...baseState(), status: "corrupt" };
  const described = describeState(persisted);
  assert.strictEqual(described.ok, false);
  assert.match(described.reason, /status must be "open" or "locked"/);
});

// --- 2. publication ---------------------------------------------------------------------------------------

test("publishing validates before the write, so an invalid state never reaches the filesystem",
  () => withRepo(async (repo) => {
    await seedWorld(repo);
    await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
    const paths = loopPaths(repo.root, TASK);
    const before = fs.readFileSync(paths.state, "utf8");
    const dirBefore = fs.readdirSync(paths.dir).sort();

    const error = await refused(
      Promise.resolve().then(() => publishState(paths, advance(readLoopState(repo), { currentAdmissionId: "9".repeat(32) }))),
      "an invariant-violating publication");
    assert.strictEqual(error.code, "E_LOOP_STATE_CORRUPT");
    assert.strictEqual(fs.readFileSync(paths.state, "utf8"), before, "the previous state is byte-identical");
    assert.deepStrictEqual(fs.readdirSync(paths.dir).sort(), dirBefore, "no staging residue");
  }));

test("a successful publication increments revision exactly once and leaves no temp", () => withRepo(async (repo) => {
  await seedWorld(repo);
  await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
  const paths = loopPaths(repo.root, TASK);
  const state = readLoopState(repo);
  const published = publishState(paths, advance(state, { currentPassInvalidated: false }));
  assert.strictEqual(published.revision, state.revision + 1);
  assert.deepStrictEqual(fs.readdirSync(paths.dir).filter((n) => n.endsWith(".tmp")), []);
}));

// --- 3. containment and locks ---------------------------------------------------------------------------

test("a symlinked prefix component is refused before any lock or read", () => withRepo(async (repo) => {
  await seedWorld(repo);
  const outside = path.join(repo.root, "elsewhere");
  fs.mkdirSync(outside);
  const target = path.join(repo.root, ".ctide", "test-provenance-loop");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  let linked = true;
  try {
    fs.symlinkSync(outside, target, "junction");
  } catch { linked = false; }                       // an environment without junction support
  if (!linked) return;

  // §D2.4: "Path checks precede lock creation and every read and write", and §D14 states the outcome
  // as E_LOOP_IO "before any lock or read". EVERY mutating operation owes this, not just begin: a
  // lock acquired before the containment check would already have written through the link.
  for (const [what, call] of [
    ["begin", () => beginTaskLoop({ repoRoot: repo.root, taskId: TASK })],
    ["emit", () => runProposalIteration({ repoRoot: repo.root, taskId: TASK })],
    ["submit", () => submitReviewedProposal({ repoRoot: repo.root, taskId: TASK })],
    ["commit", () => commitReviewedBatch({ repoRoot: repo.root, taskId: TASK })],
    ["verify", () => recordVerification({ repoRoot: repo.root, taskId: TASK })],
    ["open-epoch", () => openEpoch({
      repoRoot: repo.root,
      taskId: TASK,
      witness: { branch: "semantic-reconsideration", source: "draft", recordId: "R-w" },
    })],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    const error = await refused(call(), `a symlinked prefix at ${what}`);
    assert.strictEqual(error.code, "E_LOOP_IO", `${what}: ${error.message}`);
    assert.deepStrictEqual(fs.readdirSync(outside), [],
      `${what}: nothing — no lock, no temp, no state — was created through the link`);
  }
}));

test("lock cleanup removes only a lock this acquisition owns", () => withRepo(async (repo) => {
  await seedWorld(repo);
  await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
  const paths = loopPaths(repo.root, TASK);

  // A FOREIGN holder's file, replaced under a live acquisition. Release must leave it: the token it
  // records is not ours, and deleting another holder's lock is strictly worse than leaving an orphan.
  const foreign = `${canonicalJson({ token: "999:deadbeefdeadbeef", pid: 999, hostname: "other", startedAt: 1 })}\n`;
  await withLock(paths.taskLock, async () => {
    fs.writeFileSync(paths.taskLock, foreign, "utf8");
  });
  assert.strictEqual(fs.readFileSync(paths.taskLock, "utf8"), foreign, "a foreign lock is left exactly as found");
  fs.rmSync(paths.taskLock);

  // MALFORMED content is not ours either: a file this acquisition wrote parses, so anything that does
  // not parse was written by something else.
  await withLock(paths.taskLock, async () => {
    fs.writeFileSync(paths.taskLock, "not json at all\n", "utf8");
  });
  assert.ok(fs.existsSync(paths.taskLock), "unparseable content is left to be diagnosed, never removed");
  fs.rmSync(paths.taskLock);

  // And the ordinary case still releases.
  await withLock(paths.taskLock, async () => {
    assert.ok(fs.existsSync(paths.taskLock));
    const held = JSON.parse(fs.readFileSync(paths.taskLock, "utf8"));
    assert.deepStrictEqual(Object.keys(held).sort(), ["hostname", "pid", "startedAt", "token"]);
    assert.strictEqual(held.hostname, os.hostname(), "the host comes from the OS, not from the environment");
    assert.strictEqual(held.pid, process.pid);
  });
  assert.ok(!fs.existsSync(paths.taskLock), "its own lock is released");
}));

// §D2.1 is closed at EVERY level, not only at the root: an undeclared member inside a nested shape is
// as much a contract violation as one beside it, and a declared member holding the wrong type is not
// "close enough". A state carrying either is refused before it can reach the filesystem.
test("every declared nested shape is closed, and a wrong type in one is refused", () => {
  const valid = {
    ...baseState(),
    epoch: {
      ordinal: 1,
      openedBy: { branch: "transition-governance", source: "draft", recordId: "R-w", packageDigest: "a".repeat(64) },
      admitted: [],
    },
    lock: null,
    pending: [{
      identity: {
        testRef: { path: "test/a.test.mjs", adapterId: "node-test", structuralId: 's:["a"]' },
        kind: "assum-reading-change",
        binding: { clauseRef: "ASSUM-0000000000000000000000000A" },
      },
      governance: { kind: "undecided" },
    }],
    attempts: {
      emit: {
        attemptId: "1".repeat(32), at: 1, epochOrdinal: 1, emissionId: "2".repeat(32),
        admissionId: null, headRef: null, phase: "completed", outcome: { kind: "ok" },
      },
      observe: null,
      verification: null,
    },
    committed: committedOf("3".repeat(32)),
    currentAdmissionId: null,
  };
  // `committed` names no admission, so this baseline violates invariant 11 by construction; every
  // case below must fail for its OWN reason and is compared against that baseline's message.
  const baseline = describeState(valid).reason;
  assert.match(baseline, /invariant 11/);

  const mutate = (change) => describeState(change({ ...valid })).reason;
  const cases = [
    ["an undeclared member on a WitnessRef", (s) => {
      s.epoch = { ...s.epoch, openedBy: { ...s.epoch.openedBy, note: "x" } }; return s;
    }, /openedBy carries undeclared member\(s\) note/],
    ["an undeclared member on a FindingIdentity's binding", (s) => {
      const p = JSON.parse(JSON.stringify(s.pending));
      p[0].identity.binding.severity = "high";
      s.pending = p; return s;
    }, /binding carries undeclared member\(s\) severity/],
    ["a testRef missing a declared member", (s) => {
      const p = JSON.parse(JSON.stringify(s.pending));
      delete p[0].identity.testRef.adapterId;
      s.pending = p; return s;
    }, /testRef is missing adapterId/],
    // §D2.1:130 names `kind` "a TP §6 finding kind", and §6:537 declares that as a CLOSED enum. A
    // non-empty-string check accepted a fifth value.
    ["a FindingIdentity kind outside the TP §6 enum", (s) => {
      const p = JSON.parse(JSON.stringify(s.pending));
      p[0].identity.kind = "arbitrary";
      s.pending = p; return s;
    }, /kind must be one of wrong-tag, missing-source, scope-violation, assum-reading-change/],
    // The SAME descriptor guards every place a finding is named, so it is pinned at the two sites a
    // hand-edited state actually reaches — a retained admission and a lock — not only at `pending`.
    ["an admission findingIdentities kind outside the enum", (s) => ({
      ...s,
      epoch: { ...s.epoch, admitted: [admissionWith([{ ...IDENTITY, kind: "arbitrary" }])] },
      observedIterations: 1,
    }), /findingIdentities\[0\].kind must be one of/],
    ["a lockedFindings kind outside the enum", (s) => ({
      ...s,
      epoch: { ...s.epoch, admitted: [admissionWith([])] },
      observedIterations: 1,
      currentAdmissionId: "1".repeat(32),
      status: "locked",
      lock: {
        reason: "repeat", fingerprint: "f".repeat(64), at: 1, duplicateOf: null,
        lockedFindings: [{ ...IDENTITY, kind: "arbitrary" }],
      },
    }), /lockedFindings\[0\].kind must be one of/],
    ["an unknown governance variant", (s) => {
      const p = JSON.parse(JSON.stringify(s.pending));
      p[0].governance = { kind: "maybe" };
      s.pending = p; return s;
    }, /has unknown kind "maybe"/],
    ["an attempt slot carrying an outcome while pending", (s) => {
      s.attempts = { ...s.attempts, emit: { ...s.attempts.emit, phase: "pending" } }; return s;
    }, /is pending, so it carries no outcome/],
    ["an unknown attempt outcome kind", (s) => {
      s.attempts = { ...s.attempts, emit: { ...s.attempts.emit, outcome: { kind: "maybe" } } }; return s;
    }, /outcome has unknown kind "maybe"/],
    ["a pass outcome whose verdict is short", (s) => {
      s.attempts = {
        ...s.attempts,
        emit: { ...s.attempts.emit, outcome: { kind: "pass", verdict: { taskId: TASK } } },
      };
      return s;
    }, /verdict is missing committedBatchRef/],
    ["a Committed missing a declared member", (s) => {
      const c = { ...s.committed }; delete c.registryDigest; s.committed = c; return s;
    }, /committed is missing registryDigest/],
    ["a Committed digest of the wrong width", (s) => {
      s.committed = { ...s.committed, batchDigest: "short" }; return s;
    }, /committed.batchDigest must be hex64/],
    ["an undeclared member at the root", (s) => ({ ...s, unexpectedControllerField: 1 }),
      /carries undeclared member\(s\) unexpectedControllerField/],
    ["consumedWitnesses out of order", (s) => ({
      ...s,
      consumedWitnesses: [
        { recordId: "R-b", packageDigest: null, branch: "transition-governance", atEpoch: 1 },
        { recordId: "R-a", packageDigest: null, branch: "transition-governance", atEpoch: 1 },
      ],
    }), /consumedWitnesses must be sorted/],
  ];
  for (const [what, change, pattern] of cases) {
    const reason = mutate(change);
    assert.match(reason, pattern, what);
    assert.notStrictEqual(reason, baseline, `${what}: must fail for its own reason, not the baseline's`);
  }
});

// The enum admits EXACTLY the four TP §6:537 kinds. Rejecting one string I happened to pick would
// not establish that, so all four legal values are driven through a state that is otherwise wholly
// valid — `describeState` must return ok, with no baseline failure standing in for acceptance.
test("a FindingIdentity kind is exactly the closed TP §6 set: all four are accepted, a fifth is not", () => {
  const stateWith = (kind) => ({
    ...baseState(),
    epoch: {
      ordinal: 1,
      openedBy: null,
      admitted: [admissionWith([{ ...IDENTITY, kind }])],
    },
    observedIterations: 1,
    currentAdmissionId: "1".repeat(32),
    pending: [{ identity: { ...IDENTITY, kind }, governance: { kind: "undecided" } }],
  });

  // The four kinds TP §6:537 declares, named here so a silent narrowing of the store's constant would
  // fail this test rather than pass it.
  for (const kind of ["wrong-tag", "missing-source", "scope-violation", "assum-reading-change"]) {
    assert.deepStrictEqual(describeState(stateWith(kind)), { ok: true },
      `${kind} is a declared TP §6 finding kind and must be accepted`);
  }
  assert.deepStrictEqual(FINDING_KIND_ORDER,
    ["wrong-tag", "missing-source", "scope-violation", "assum-reading-change"],
    "and the controller reads that set from the store rather than restating it");

  for (const kind of ["arbitrary", "", "ASSUM-READING-CHANGE", "assum_reading_change"]) {
    const described = describeState(stateWith(kind));
    assert.strictEqual(described.ok, false, `${JSON.stringify(kind)} is not a declared finding kind`);
    assert.match(described.reason, /kind must be one of wrong-tag, missing-source, scope-violation, assum-reading-change/);
  }
});

// §D2.2 invariant 10 / §D4.1, in its settled form. Publications B and D of §D4 ARE a pending slot
// becoming completed on the same attempt, so the rule is about WHICH attempt may write there — not a
// ban on completing one.
test("a pending slot completes only on its own attempt, and is never replaced or discarded", () => {
  const pending = {
    attemptId: "1".repeat(32), at: 1, epochOrdinal: 1, emissionId: "2".repeat(32),
    admissionId: null, headRef: null, phase: "pending", outcome: null,
  };
  const withPending = { ...baseState(), attempts: { emit: pending, observe: null, verification: null } };
  const slots = (emit) => ({ attempts: { ...withPending.attempts, emit } });
  const refusal = (change, what) => {
    let error = null;
    try { advance(withPending, change); } catch (e) { error = e; }
    assert.ok(error, `${what}: expected a refusal`);
    assert.strictEqual(error.code, "E_LOOP_STATE_CORRUPT", what);
    return error.message;
  };

  // LEGAL: the same attempt completes with an outcome, bindings preserved. This is publication B.
  const completed = advance(withPending, slots({ ...pending, phase: "completed", outcome: { kind: "ok" } }));
  assert.strictEqual(completed.attempts.emit.phase, "completed");
  assert.strictEqual(completed.revision, withPending.revision + 1);
  // LEGAL: leaving it untouched.
  assert.ok(advance(withPending, { currentPassInvalidated: false }));
  // LEGAL: reusing a slot whose occupant is already completed.
  assert.ok(advance(completed, slots({ ...pending, attemptId: "9".repeat(32), phase: "pending", outcome: null })));

  assert.match(refusal(slots({ ...pending, attemptId: "9".repeat(32) }), "a different attempt"),
    /a different attempt may not replace the pending attempts.emit/);
  assert.match(refusal(slots(null), "discarding pending evidence"),
    /pending evidence that may not be discarded/);
  assert.match(
    refusal(slots({ ...pending, phase: "completed", outcome: { kind: "ok" }, emissionId: "8".repeat(32) }),
      "a completion that rewrites a binding"),
    /completing attempts.emit preserves its emissionId/,
  );
});

// §D2.2 3, 4 and 7 are HISTORY: they compare a state with the one it replaced, so `advance` charges
// them and `describeState` — which is shown one state — cannot and does not.
test("the transition rules charge monotonicity, the epoch-reset discipline and append-only baselines", () => {
  const state = {
    ...baseState(),
    observedIterations: 2,
    closedEpochAdmissions: 2,
    knownRecordIds: ["R-a", "R-b"],
    consumedWitnesses: [{ recordId: "R-w", packageDigest: null, branch: "transition-governance", atEpoch: 1 }],
  };
  const refusal = (change, what) => {
    let error = null;
    try { advance(state, change); } catch (e) { error = e; }
    assert.ok(error, `${what}: expected a refusal`);
    assert.strictEqual(error.code, "E_LOOP_STATE_CORRUPT", what);
    return error.message;
  };
  assert.match(refusal({ observedIterations: 1 }, "a counter going backwards"),
    /observedIterations is monotonically non-decreasing/);
  assert.match(refusal({ closedEpochAdmissions: 3 }, "closedEpochAdmissions moving inside an epoch"),
    /moves only in the publication that opens the next epoch/);
  assert.match(refusal({ knownRecordIds: ["R-a"] }, "a dropped baseline id"),
    /knownRecordIds is append-only/);
  assert.match(refusal({ consumedWitnesses: [] }, "a dropped consumed witness"),
    /consumedWitnesses is append-only/);
  // An epoch that closes ONE admission must absorb exactly it.
  const closing = {
    ...state,
    epoch: {
      ordinal: 1,
      openedBy: null,
      admitted: [{
        admissionId: "1".repeat(32), at: 1, epochOrdinal: 1, emissionId: "2".repeat(32),
        reviewRawDigest: "d".repeat(64), governanceRawDigest: "e".repeat(64), fingerprint: "f".repeat(64),
        commitReady: false, batchRecordId: "R-X", retainedPayloadPath: "p", payloadRawDigest: "0".repeat(64),
        admittedClaims: { taskId: TASK, baseProvenance: BASE_WITNESS, inventoryDigest: "9".repeat(64) },
        findingIdentities: [], phase: "closed", closeReason: null,
      }],
    },
    observedIterations: 3,
  };
  let missed = null;
  try {
    advance(closing, { epoch: { ordinal: 2, openedBy: null, admitted: [] } });
  } catch (e) { missed = e; }
  assert.ok(missed, "an epoch opening without absorbing: expected a refusal");
  assert.match(missed.message, /closedEpochAdmissions absorbs exactly the closing epoch's admissions/);

  // The legitimate epoch transition absorbs them and is accepted.
  const opened = advance(closing, {
    epoch: { ordinal: 2, openedBy: null, admitted: [] },
    closedEpochAdmissions: 3,
  });
  assert.strictEqual(opened.epoch.ordinal, 2);
  assert.strictEqual(opened.closedEpochAdmissions, 3);
});

test("a held lock is diagnosed, never broken", () => withRepo(async (repo) => {
  await seedWorld(repo);
  await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
  const paths = loopPaths(repo.root, TASK);
  await withLock(paths.taskLock, async () => {
    const error = await refused(beginTaskLoop({ repoRoot: repo.root, taskId: TASK }), "a held lock");
    assert.strictEqual(error.code, "E_LOOP_LOCK_HELD");
    assert.ok(fs.existsSync(paths.taskLock), "the lock is still held by its owner");
  });
  assert.ok(!fs.existsSync(paths.taskLock), "and released by that owner alone");
}));

// --- 4. the emission's four boundaries -------------------------------------------------------------------

test("emission publishes A, B, C and D, each durable across its own boundary", () => withRepo(async (repo) => {
  await seedWorld(repo);
  const begun = await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
  const emitted = await runProposalIteration({ repoRoot: repo.root, taskId: TASK });
  const state = readLoopState(repo);
  // A, B, C, D are four publications on top of the creating one.
  assert.strictEqual(state.revision, begun.revision + 4, "four publications, one per boundary");
  assert.strictEqual(emitted.revision, state.revision);
  assert.strictEqual(state.attempts.emit.phase, "completed");
  assert.strictEqual(state.attempts.emit.outcome.kind, "ok");
  assert.strictEqual(state.attempts.observe.phase, "completed");
  assert.ok(state.lastEmission.artifactRawDigest.length === 64, "the artifact is bound before authority is sampled");
  assert.strictEqual(state.lastEmission.storeTextDigest, state.lastEmission.artifactHeader.inputProvenanceStoreDigest,
    "the sampled authority equals the artifact header's");
  assert.ok(state.knownRecordIds.length > 0, "publication C refreshed the baselines");
}));

test("a new emission is legal only on a TERMINAL current admission", () => withRepo(async (repo) => {
  const world = await seedWorld(repo);
  await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
  await runProposalIteration({ repoRoot: repo.root, taskId: TASK });
  writeReview(repo, { base: world.base });
  writeGovernance(repo, emptyGovernance());
  await submitReviewedProposal({ repoRoot: repo.root, taskId: TASK });   // open, commit-ready

  const error = await refused(runProposalIteration({ repoRoot: repo.root, taskId: TASK }), "an open admission");
  assert.strictEqual(error.code, "E_LOOP_ADMISSION_OPEN",
    "an open or committed admission still owns its chance; emitting would orphan it");
}));

// --- 5. the cap, before any external work ------------------------------------------------------------------

test("a ninth cycle request locks cap-exhausted BEFORE any emitter call and counts nothing",
  () => withRepo(async (repo) => {
    const world = await seedWorld(repo);
    await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
    // Eight unready admissions: each is appended already closed, so the next emit stays legal.
    for (let n = 0; n < MAX_EPOCH_ADMISSIONS; n += 1) {
      bumpHead(repo, n);
      // eslint-disable-next-line no-await-in-loop
      await runProposalIteration({ repoRoot: repo.root, taskId: TASK });
      writeReview(repo, { base: world.base, findings: [generalFinding()] });
      writeGovernance(repo, emptyGovernance());
      // eslint-disable-next-line no-await-in-loop
      const admitted = await submitReviewedProposal({ repoRoot: repo.root, taskId: TASK });
      assert.strictEqual(admitted.phase, "closed", `admission ${n} is appended already closed`);
    }
    const eighth = readLoopState(repo);
    assert.strictEqual(eighth.epoch.admitted.length, MAX_EPOCH_ADMISSIONS);
    assert.strictEqual(eighth.status, "locked", "the eighth unready admission locks cap-exhausted");
    assert.strictEqual(eighth.lock.reason, "cap-exhausted");
    assert.strictEqual(eighth.observedIterations, MAX_EPOCH_ADMISSIONS);

    const error = await refused(runProposalIteration({ repoRoot: repo.root, taskId: TASK }), "a ninth cycle");
    assert.strictEqual(error.code, "E_LOOP_LOCKED");
    const after = readLoopState(repo);
    assert.strictEqual(after.observedIterations, MAX_EPOCH_ADMISSIONS, "nothing was counted");
    assert.strictEqual(after.epoch.admitted.length, MAX_EPOCH_ADMISSIONS, "nothing was admitted");
  }));

test("a ninth submission is refused with no admission", () => withRepo(async (repo) => {
  const world = await seedWorld(repo);
  await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
  const paths = loopPaths(repo.root, TASK);
  // Drive the state to eight admissions, then hand-place an unlocked eighth so submit's own cap
  // branch is the one under test rather than the emit guard.
  for (let n = 0; n < MAX_EPOCH_ADMISSIONS; n += 1) {
    bumpHead(repo, n);
    // eslint-disable-next-line no-await-in-loop
    await runProposalIteration({ repoRoot: repo.root, taskId: TASK });
    writeReview(repo, { base: world.base, findings: [generalFinding()] });
    writeGovernance(repo, emptyGovernance());
    // eslint-disable-next-line no-await-in-loop
    await submitReviewedProposal({ repoRoot: repo.root, taskId: TASK });
  }
  const locked = readLoopState(repo);
  publishState(paths, advance(locked, { status: "open", lock: null }));
  const error = await refused(submitReviewedProposal({ repoRoot: repo.root, taskId: TASK }), "a ninth submission");
  assert.ok(["E_LOOP_CAP", "E_LOOP_EMISSION_SPENT"].includes(error.code), error.code);
}));

// --- 6. the head-view exclusion delta -----------------------------------------------------------------------

test("the control prefix is outside the head universe while adjacent user prefixes stay observable",
  () => withRepo(async (repo) => {
    repo.write("package.json", '{ "type": "module" }\n');
    repo.write("test/a.test.mjs", "// a test\n");
    repo.git("add", "-A");
    repo.git("commit", "-qm", "seed");
    const before = await captureHeadViewSnapshot({ repoRoot: repo.root });

    // Controller-owned content under the reserved prefix, tracked deliberately.
    repo.write(`${LOOP_PREFIX}/task-${taskHash(TASK)}.json`, '{"loopControlVersion":1}\n');
    repo.git("add", "-A");
    repo.git("commit", "-qm", "loop state");
    const after = await captureHeadViewSnapshot({ repoRoot: repo.root });
    assert.strictEqual(after.headViewDigest, before.headViewDigest,
      "step 1 excludes the prefix BEFORE trackedness, so even a committed file there is invisible");
    assert.strictEqual(after.has(`${LOOP_PREFIX}/task-${taskHash(TASK)}.json`), false);

    // An ADJACENT prefix is a different path and stays observable.
    repo.write(".ctide/test-provenance-loops/note.md", "adjacent\n");
    repo.write(".ctide/test-provenance-loop-notes.md", "adjacent\n");
    repo.git("add", "-A");
    repo.git("commit", "-qm", "adjacent");
    const adjacent = await captureHeadViewSnapshot({ repoRoot: repo.root });
    assert.strictEqual(adjacent.has(".ctide/test-provenance-loops/note.md"), true, "a longer sibling prefix is not this one");
    assert.strictEqual(adjacent.has(".ctide/test-provenance-loop-notes.md"), true, "a stem match is not a prefix match");
    assert.notStrictEqual(adjacent.headViewDigest, before.headViewDigest, "and they really do move the digest");
  }));

// --- 7. addressing --------------------------------------------------------------------------------------------

test("loopPaths derives every file from the canonicalJson address", () => {
  const paths = loopPaths("/repo", TASK);
  const h = sha256Hex(canonicalJson(TASK));
  assert.strictEqual(paths.hash, h);
  assert.ok(paths.state.endsWith(`task-${h}.json`));
  assert.ok(paths.review.endsWith(`task-${h}.review.json`));
  assert.ok(paths.governance.endsWith(`task-${h}.governance.json`));
  assert.ok(paths.payload("abc").endsWith(`task-${h}.abc.payload.json`));
  assert.ok(paths.taskLock.endsWith(`task-${h}.lock`));
  assert.ok(paths.emitLock.endsWith("emit.lock"));
});

test("two tasks run concurrently on distinct addresses", () => withRepo(async (repo) => {
  await seedWorld(repo);
  const other = "TASK-OTHER";
  const a = loopPaths(repo.root, TASK);
  const b = loopPaths(repo.root, other);
  assert.notStrictEqual(a.state, b.state);
  assert.notStrictEqual(a.taskLock, b.taskLock);
  await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
  assert.ok(fs.existsSync(a.state));
  assert.ok(!fs.existsSync(b.state), "one task's state is not another's");
  const inspected = await inspectLoopState({ repoRoot: repo.root, taskId: other });
  assert.strictEqual(inspected.present, false);
}));

test("a state belonging to another task or base witness is refused WITHOUT any reset", () => withRepo(async (repo) => {
  await seedWorld(repo);
  await beginTaskLoop({ repoRoot: repo.root, taskId: TASK });
  const paths = loopPaths(repo.root, TASK);
  const state = readLoopState(repo);
  // A base witness that no longer matches the tracked TaskState.
  publishState(paths, advance(state, {
    baseProvenance: { ...state.baseProvenance, storeDigest: "0".repeat(64) },
  }));
  const before = fs.readFileSync(paths.state, "utf8");
  const error = await refused(beginTaskLoop({ repoRoot: repo.root, taskId: TASK }), "a moved base witness");
  assert.strictEqual(error.code, "E_LOOP_CONTEXT");
  assert.strictEqual(fs.readFileSync(paths.state, "utf8"), before, "the state is left exactly as found");
}));
