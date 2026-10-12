// assertProspectiveTransitionAuthority (TP v1.20): the pure prospective-authority operation.
//
// SCOPE. A green run here proves that a supplied prospective transition has structurally coherent
// staged objects, valid ruling/routing obligations, fresh newly consumed typed rulings and the
// existing matrix authority. It is NOT a completed transaction, an applicability judgment, a
// source-freshness verdict, a CAS, a mint-permission expansion or a Step 6 result. In particular,
// prospective authorization of an unminted DEC does not permit the batch writer to mint it.
//
// The controller-owned obligations this operation does not receive and does not claim: per-finding
// evidence coverage, witness novelty, task/fingerprint binding and the shared resolutionGroupDigest
// comparison. No unlock follows from a green run here.
//
// FIXTURES, described exactly. Every pre-state starts from `preStore()`, which chains the real
// `applyTransaction` calls IN MEMORY -- no filesystem transaction and no writer entry point is
// involved anywhere in this file. Three cases then go further and are honest about it:
//
//   * the existing-successor positive pushes a technical-decision ruling and the DEC clause onto the
//     transaction-built base's arrays;
//   * the stale-persisted-ruling and unused-historical-ruling cases push a ruling and change the
//     base's DP `scenario` in place.
//
// Those three are therefore transaction-built bases EXTENDED or ALTERED directly, not stores every
// step of which a transaction produced. What makes them usable is not how they were assembled but
// the REAL `validateAll` each one is put through before its index is taken: that call is the
// contract's stated precondition, and it is what proves the pre-state legal. The two
// persisted-precedence controls deliberately push objects that make `validateAll` REFUSE, which is
// the whole point of those cases.
//
// The rulings and packets are SYNTHETIC records built by this file. They prove mechanical behaviour
// only: no actual external reviewer ran, nothing here is an external review, and no controller
// unlock, epoch budget or Step 6 outcome follows from a green run.
import { test } from "node:test";
import assert from "node:assert";

import {
  emptyStore, storeDigest, canonicalJson, canonicalStoreBytes, digestOf, indexStore,
  applyTransaction, validateAll, assertProspectiveTransitionAuthority, CANONICAL_STORE_PATH,
} from "../cressetide/skills/vigil/scripts/provenance-store.mjs";

const OPTS = { now: Date.UTC(2026, 8, 6) };
const TASK = "TASK-1";
const CODE = { kind: "discipline", discipline: "code" };
const TEST_DISCIPLINE = { kind: "discipline", discipline: "test" };
const ARBITER = { kind: "arbiter" };
const ASSUM_A = "ASSUM-0000000000000000000000000A";
const DEC_B = "DEC-0000000000000000000000000B";
const ASSUM_C = "ASSUM-0000000000000000000000000C";
const REQ_R = "REQ-0000000000000000000000000R";
const REQ_S = "REQ-0000000000000000000000000S";
const BASE = {
  treeOid: "a".repeat(40), storePath: CANONICAL_STORE_PATH, storeDigest: storeDigest(emptyStore()),
};

// The DP exactly as the pre-state carries it, so a packet can be built to match — and mismatched
// deliberately for the stale case.
const DP = {
  id: "DP-1", dimension: "data", scenario: "null vs absent", alternatives: ["A", "B"],
  layer: "implementation", classificationBasis: "engineering standard", materialReasons: [],
  status: "open",
};

// --- the pre-state, through the real transactions -----------------------------------------------------

function preStore() {
  let s = applyTransaction(emptyStore(), "init-task", {
    taskId: TASK, baseProvenance: BASE, decisionPoints: [DP], currentTaskDpIds: ["DP-1"],
  }, OPTS);
  s = applyTransaction(s, "append-source", {
    source: {
      sourceId: "S-req", contentKind: "requirement", driftMode: "snapshot-only",
      locator: "conversation#1", excerpt: "the reviewed reading of the null case",
    },
  }, OPTS);
  return applyTransaction(s, "create-initial-outcome", {
    dpId: "DP-1",
    // R-rule1 is an UNTYPED review-ruling by CODE bound to DP-1: a legal persisted witness that
    // carries no packet, which is exactly the "not sent to a typed packet reader" case below.
    records: [{ recordId: "R-rule1", kind: "review-ruling", by: CODE, subjectRef: "DP-1", ruling: "ok" }],
    clause: {
      id: ASSUM_A, layer: "implementation", derivedFrom: "DP-1", text: "treat null as absent",
      alternative: "treat null as invalid", basis: "matches the option table", basisRefs: [],
      governedBy: CODE, routingOrigin: "safe-default",
    },
  }, OPTS);
}

function fixture() {
  const store = preStore();
  const { index } = validateAll(store, OPTS);      // the contract's precondition, really performed
  return { store, preIndex: index, bytes: canonicalStoreBytes(store) };
}

// --- synthetic drafted objects -------------------------------------------------------------------------

const reviewRuling = (recordId, by, subjectRef, extra = {}) =>
  ({ recordId, kind: "review-ruling", by, subjectRef, ruling: "ok", ...extra });

const packetFor = (dp, requestedPrincipal) => ({
  dpId: dp.id,
  scenario: dp.scenario,
  alternatives: dp.alternatives,
  layer: dp.layer,
  classificationBasis: dp.classificationBasis,
  materialReasons: dp.materialReasons ?? [],
  requestedPrincipal,
  basisRefs: [],
});

// A complete TYPED technical-decision ruling. `dp` is what its packet snapshots, so passing a
// deliberately different DP is how the stale case is built without touching the pre-state.
function techRuling(recordId, principal, dp = DP) {
  const snapshot = packetFor(dp, principal);
  return {
    ...reviewRuling(recordId, principal, "DP-1"),
    rulingKind: "technical-decision", basis: "stated basis", selectedAlternative: "A",
    inputPacketSnapshot: snapshot, inputPacketDigest: digestOf(snapshot),
  };
}

const decDraft = (approvedBy, rulingRef) => ({
  id: DEC_B, layer: "implementation", derivedFrom: "DP-1",
  decision: "A", alternatives: ["A", "B"], approvedBy,
  basisRefs: [{ kind: "review-ruling", ref: rulingRef }],
});

const assumDraft = (over = {}) => ({
  id: ASSUM_C, layer: "implementation", derivedFrom: "DP-1",
  text: "the revised reading", alternative: "the rejected reading", basis: "b", basisRefs: [],
  governedBy: CODE, routingOrigin: "safe-default", ...over,
});

const reqDraft = () => ({
  id: REQ_R, authority: "approved-requirement", kind: "specification",
  text: "the product ruling", sourceRef: "S-req", taskRef: TASK,
});

const planGate = (recordId, successor) => ({
  recordId, kind: "plan-gate", target: ASSUM_A, successor,
  impact: "no consumers", disposition: "no-affected-dependents", approvedBy: "user",
});

const transition = (over = {}) => ({
  id: "T-p", subject: ASSUM_A, action: "supersede", successor: DEC_B,
  authorityRef: CODE, ackRef: { kind: "review-ruling", ref: "R-rule1" },
  ...over,
});

const candidate = (over = {}) => ({
  transitionDraft: transition(),
  successorDraft: decDraft(CODE, "R-tech"),
  witness: { source: "persisted", recordId: "R-rule1", record: null },
  citedRecords: [techRuling("R-tech", CODE)],
  ...over,
});

const refused = (fn, what) => {
  let error = null;
  try { fn(); } catch (e) { error = e; }
  assert.ok(error && typeof error.code === "string", `${what}: expected a coded refusal, got ${error}`);
  return error;
};

// The purity check that the cases below CALL EXPLICITLY -- it is not implicit anywhere. It covers the
// store bytes and the pre-index maps only; it does not inspect the candidate. Five positives and six
// grouped negatives call it; the remaining cases (the existing-successor and revise positives, the
// three freshness cases and the two persisted-precedence controls) build their own stores and do not,
// so no whole-file "every path" purity claim is made. Candidate-object immutability is asserted in
// exactly two places: the governed positive, by deep-comparing the two drafts afterwards, and the
// final purity test, by canonicalJson over the whole candidate across one success and one refusal.
function assertUntouched(f, what) {
  assert.strictEqual(canonicalStoreBytes(f.store), f.bytes, `${what}: the store bytes are unchanged`);
  assert.strictEqual(f.preIndex.clauses.has(DEC_B), false, `${what}: no draft leaked into the pre-index`);
  assert.strictEqual(f.preIndex.transitions.has("T-p"), false, `${what}: no draft transition leaked`);
  assert.strictEqual(f.preIndex.records.has("R-tech"), false, `${what}: no drafted record leaked`);
  assert.strictEqual(f.store.clauses.length, 1, `${what}: the pre-state clause array is unchanged`);
  assert.strictEqual(f.store.transitions.length, 0, `${what}: the pre-state transition array is unchanged`);
}

// --- 1. the authorized paths ---------------------------------------------------------------------------

test("a GOVERNED ASSUM→unminted-DEC candidate with a persisted witness authorizes", () => {
  const f = fixture();
  const c = candidate();
  assert.strictEqual(f.preIndex.clauses.has(DEC_B), false, "the successor really is unminted");
  assert.strictEqual(f.preIndex.records.has("R-rule1"), true, "and the witness really is persisted");

  assertProspectiveTransitionAuthority(f.preIndex, c);
  assertUntouched(f, "the governed positive");
  // The candidate objects themselves are not rewritten.
  assert.deepStrictEqual(c.transitionDraft, transition(), "the transition draft is unchanged");
  assert.deepStrictEqual(c.successorDraft, decDraft(CODE, "R-tech"), "the successor draft is unchanged");
});

test("an ARBITER authority reaches the same row and authorizes", () => {
  const f = fixture();
  assertProspectiveTransitionAuthority(f.preIndex, candidate({
    transitionDraft: transition({ authorityRef: ARBITER, ackRef: { kind: "review-ruling", ref: "R-arb" } }),
    witness: { source: "draft", recordId: "R-arb", record: reviewRuling("R-arb", ARBITER, "DP-1") },
  }));
  assertUntouched(f, "the arbiter positive");
});

test("a REROUTED principal with an unminted DEC and a DRAFT witness authorizes", () => {
  // The row's rerouted branch dereferences index.clauses.get(t.successor).approvedBy. It is reachable
  // only because the matrix row is given the STAGED index; a bare kind string could not supply it.
  const f = fixture();
  assertProspectiveTransitionAuthority(f.preIndex, candidate({
    transitionDraft: transition({
      authorityRef: TEST_DISCIPLINE, ackRef: { kind: "review-ruling", ref: "R-re" },
    }),
    successorDraft: decDraft(TEST_DISCIPLINE, "R-tech"),
    witness: { source: "draft", recordId: "R-re", record: reviewRuling("R-re", TEST_DISCIPLINE, "DP-1") },
    citedRecords: [techRuling("R-tech", TEST_DISCIPLINE)],
  }));
  assertUntouched(f, "the rerouted positive");
});

test("a USER plan-gate to an unminted REQ authorizes, with no review-ruling packet invented for it", () => {
  const f = fixture();
  assertProspectiveTransitionAuthority(f.preIndex, candidate({
    transitionDraft: transition({
      successor: REQ_R, authorityRef: { kind: "user" }, ackRef: { kind: "plan-gate", ref: "R-gate" },
      compatibility: { impact: "no consumers", disposition: "no-affected-dependents" },
    }),
    successorDraft: reqDraft(),
    witness: { source: "draft", recordId: "R-gate", record: planGate("R-gate", REQ_R) },
    citedRecords: [],
  }));
  assertUntouched(f, "the user plan-gate positive");
});

test("a RETIRE candidate with no successor and no successor draft authorizes", () => {
  const f = fixture();
  assertProspectiveTransitionAuthority(f.preIndex, candidate({
    transitionDraft: { id: "T-p", subject: ASSUM_A, action: "retire", authorityRef: CODE, ackRef: { kind: "review-ruling", ref: "R-rule1" } },
    successorDraft: null,
    citedRecords: [],
  }));
  assertUntouched(f, "the retire positive");
});

test("an EXISTING successor is cited rather than drafted, and authorizes", () => {
  // A pre-state that already holds DEC_B. Its legality is not assumed: validateAll below is what
  // proves it, and the operation's precondition is satisfied by that call and not by construction.
  const store = preStore();
  store.records.push(techRuling("R-tech", CODE));
  store.clauses.push(decDraft(CODE, "R-tech"));
  const preIndex = validateAll(store, OPTS).index;
  assert.strictEqual(preIndex.clauses.has(DEC_B), true, "the successor really exists in the pre-state");

  assertProspectiveTransitionAuthority(preIndex, {
    transitionDraft: transition(),
    successorDraft: null,
    witness: { source: "persisted", recordId: "R-rule1", record: null },
    citedRecords: [],
  });
});

// --- 2. candidate relationships (E_API_ARGUMENTS) --------------------------------------------------------

test("the candidate relationships are charged before anything is interpreted as authority", () => {
  const f = fixture();
  const cases = [
    ["a retire naming a successor", { transitionDraft: transition({ action: "retire" }), successorDraft: null, citedRecords: [] }],
    ["a retire carrying a successor draft", {
      transitionDraft: { id: "T-p", subject: ASSUM_A, action: "retire", authorityRef: CODE, ackRef: { kind: "review-ruling", ref: "R-rule1" } },
    }],
    ["a supersede with no successor", { transitionDraft: transition({ successor: undefined }) }],
    ["a surplus draft for an existing successor", { transitionDraft: transition({ successor: ASSUM_A }) }],
    ["a missing draft for an absent successor", { successorDraft: null }],
    ["a differently named draft", { successorDraft: { ...decDraft(CODE, "R-tech"), id: "DEC-0000000000000000000000000C" } }],
    ["a persisted witness carrying a record", {
      witness: { source: "persisted", recordId: "R-rule1", record: reviewRuling("R-rule1", CODE, "DP-1") },
    }],
    ["a persisted witness that does not exist", { witness: { source: "persisted", recordId: "R-nope", record: null } }],
    ["a draft witness with no record", { witness: { source: "draft", recordId: "R-new", record: null } }],
    ["a draft witness whose record names another id", {
      witness: { source: "draft", recordId: "R-new", record: reviewRuling("R-other", CODE, "DP-1") },
    }],
    ["a draft witness that already exists", {
      witness: { source: "draft", recordId: "R-rule1", record: reviewRuling("R-rule1", CODE, "DP-1") },
    }],
    ["an ackRef naming a record the candidate does not declare", {
      transitionDraft: transition({ ackRef: { kind: "review-ruling", ref: "R-elsewhere" } }),
    }],
    ["an ackRef of the wrong kind for the declared witness", {
      transitionDraft: transition({ ackRef: { kind: "plan-gate", ref: "R-rule1" } }),
    }],
  ];
  for (const [what, over] of cases) {
    const error = refused(() => assertProspectiveTransitionAuthority(f.preIndex, candidate(over)), what);
    assert.strictEqual(error.code, "E_API_ARGUMENTS", `${what}: ${error.message}`);
  }
  assertUntouched(f, "relationship refusals");
});

test("the API surface is exactly two arguments and two closed own-key objects", () => {
  const f = fixture();
  const ok = candidate();
  const cases = [
    ["one argument", () => assertProspectiveTransitionAuthority(f.preIndex)],
    ["three arguments", () => assertProspectiveTransitionAuthority(f.preIndex, ok, {})],
    ["a bare object for preIndex", () => assertProspectiveTransitionAuthority({ clauses: {} }, ok)],
    ["an index with no store", () => assertProspectiveTransitionAuthority({ ...f.preIndex, store: null }, ok)],
    ["a null candidate", () => assertProspectiveTransitionAuthority(f.preIndex, null)],
    ["an array candidate", () => assertProspectiveTransitionAuthority(f.preIndex, [])],
    ["a missing candidate key", () => assertProspectiveTransitionAuthority(f.preIndex, { transitionDraft: transition() })],
    ["a clock on the candidate", () => assertProspectiveTransitionAuthority(f.preIndex, { ...ok, now: 1 })],
    ["an evidence list on the candidate", () => assertProspectiveTransitionAuthority(f.preIndex, { ...ok, semanticEvidenceRefs: [] })],
    ["a missing witness key", () => assertProspectiveTransitionAuthority(f.preIndex, candidate({ witness: { source: "persisted", recordId: "R-rule1" } }))],
    ["an extra witness key", () => assertProspectiveTransitionAuthority(f.preIndex, candidate({ witness: { source: "persisted", recordId: "R-rule1", record: null, packageDigest: "x" } }))],
    ["a bad witness source", () => assertProspectiveTransitionAuthority(f.preIndex, candidate({ witness: { source: "guessed", recordId: "R-rule1", record: null } }))],
    ["citedRecords not an array", () => assertProspectiveTransitionAuthority(f.preIndex, candidate({ citedRecords: {} }))],
    ["a non-object cited record", () => assertProspectiveTransitionAuthority(f.preIndex, candidate({ citedRecords: ["R-tech"] }))],
  ];
  for (const [what, run] of cases) {
    const error = refused(run, what);
    assert.strictEqual(error.code, "E_API_ARGUMENTS", `${what}: ${error.message}`);
  }

  // Own keys, both directions: a legal non-enumerable required key is accepted; a hidden or symbol
  // EXTRA is refused, with the symbol rendered by String().
  const hidden = {};
  for (const [key, value] of Object.entries(ok)) Object.defineProperty(hidden, key, { value, enumerable: false });
  assert.deepStrictEqual(Object.keys(hidden), [], "invisible to the enumerable view");
  assertProspectiveTransitionAuthority(f.preIndex, hidden);

  const hiddenExtra = candidate();
  Object.defineProperty(hiddenExtra, "now", { value: 1, enumerable: false, configurable: true });
  assert.strictEqual(refused(() => assertProspectiveTransitionAuthority(f.preIndex, hiddenExtra), "a hidden extra").code,
    "E_API_ARGUMENTS");

  const symbolled = candidate();
  symbolled[Symbol("now")] = 1;
  const symbolError = refused(() => assertProspectiveTransitionAuthority(f.preIndex, symbolled), "a symbol extra");
  assert.strictEqual(symbolError.code, "E_API_ARGUMENTS");
  assert.ok(!(symbolError instanceof TypeError), "a typed refusal, not an engine error");
  assert.match(symbolError.message, /Symbol\(now\)/);
  assertUntouched(f, "API refusals");
});

// --- 3. global id collisions, before any indexing ---------------------------------------------------------

test("a drafted id colliding with ANY pre-state section keeps the source-owned collision code", () => {
  const f = fixture();
  // Cross-section: a transition id equal to an existing SOURCE id, which a per-section check misses.
  const crossSection = refused(() => assertProspectiveTransitionAuthority(f.preIndex, candidate({
    transitionDraft: transition({ id: "S-req" }),
  })), "a transition id colliding with a source id");
  assert.strictEqual(crossSection.code, "E_ID_PAYLOAD_CONFLICT", crossSection.message);

  // A drafted record colliding with an existing record, with the SAME payload, is the duplicate case.
  const sameRecord = f.preIndex.records.get("R-rule1");
  const duplicate = refused(() => assertProspectiveTransitionAuthority(f.preIndex, candidate({
    citedRecords: [{ ...sameRecord }],
    successorDraft: decDraft(CODE, "R-rule1"),
  })), "a drafted record duplicating a persisted one");
  assert.strictEqual(duplicate.code, "E_DUPLICATE_ID", duplicate.message);

  // Two drafted records colliding with EACH OTHER, which a Map would silently absorb.
  const crossDraft = refused(() => assertProspectiveTransitionAuthority(f.preIndex, candidate({
    citedRecords: [techRuling("R-tech", CODE), reviewRuling("R-tech", CODE, "DP-1")],
  })), "two drafted records sharing an id");
  assert.strictEqual(crossDraft.code, "E_ID_PAYLOAD_CONFLICT", crossDraft.message);

  // The witness declared twice — separately AND inside citedRecords.
  const witnessTwice = refused(() => assertProspectiveTransitionAuthority(f.preIndex, candidate({
    transitionDraft: transition({ ackRef: { kind: "review-ruling", ref: "R-re" } }),
    witness: { source: "draft", recordId: "R-re", record: reviewRuling("R-re", CODE, "DP-1") },
    citedRecords: [techRuling("R-tech", CODE), reviewRuling("R-re", CODE, "DP-1")],
  })), "the witness also inside citedRecords");
  assert.strictEqual(witnessTwice.code, "E_DUPLICATE_ID", witnessTwice.message);

  assertUntouched(f, "collision refusals");
});

// --- 4. the source-owned object obligations, on the drafts ---------------------------------------------------

test("a malformed draft is charged by the same predicates persisted validation uses", () => {
  const f = fixture();
  const cases = [
    // The transition names the same bad id, so R2 passes and the GRAMMAR is what refuses.
    ["a clause id outside the ULID grammar", {
      transitionDraft: transition({ successor: "DEC-lowercase" }),
      successorDraft: { ...decDraft(CODE, "R-tech"), id: "DEC-lowercase" },
    }, "E_CLAUSE_ID_GRAMMAR"],
    ["an authored lifecycle field", { successorDraft: { ...decDraft(CODE, "R-tech"), status: "active" } }, "E_INV3_AUTHORED_LIFECYCLE"],
    ["a DEC with no approvedBy", { successorDraft: { ...decDraft(CODE, "R-tech"), approvedBy: undefined } }, "E_SHAPE"],
    ["a DEC on the wrong layer", { successorDraft: { ...decDraft(CODE, "R-tech"), layer: "intent" } }, "E_ENUM"],
    ["an unknown transition action", { transitionDraft: transition({ action: "rescind" }) }, "E_ENUM"],
    ["an unknown authorityRef kind", { transitionDraft: transition({ authorityRef: { kind: "committee" } }) }, "E_ENUM"],
    ["a transition with no ackRef", { transitionDraft: { ...transition(), ackRef: undefined } }, "E_SHAPE"],
    ["a cited record of an unknown kind", { citedRecords: [{ ...techRuling("R-tech", CODE), kind: "memo" }] }, "E_ENUM"],
    ["a cited record with an incomplete payload", { citedRecords: [{ recordId: "R-tech", kind: "review-ruling", subjectRef: "DP-1" }] }, "E_RECORD_PAYLOAD"],
  ];
  for (const [what, over, code] of cases) {
    const error = refused(() => assertProspectiveTransitionAuthority(f.preIndex, candidate(over)), what);
    assert.strictEqual(error.code, code, `${what}: ${error.message}`);
  }
  assertUntouched(f, "draft obligation refusals");
});

test("structural refs and basisRefs are charged against the STAGED index", () => {
  const f = fixture();
  // A dangling basisRef on an ASSUM successor: nothing in the pre-state or the drafts resolves it,
  // and validateGovernanceRulings deliberately skips an unresolvable ref, so the explicit
  // basisRefsResolvable call against the STAGED index is the only thing that can catch it.
  const dangling = refused(() => assertProspectiveTransitionAuthority(f.preIndex, candidate({
    transitionDraft: transition({ action: "revise", successor: ASSUM_C }),
    successorDraft: assumDraft({ basisRefs: [{ kind: "review-ruling", ref: "R-ghost" }] }),
    citedRecords: [],
  })), "a basisRef naming nothing");
  assert.strictEqual(dangling.code, "E_DANGLING_REF", dangling.message);

  // A REQ successor whose sourceRef does not resolve is validateRefs' own refusal.
  const badSource = refused(() => assertProspectiveTransitionAuthority(f.preIndex, candidate({
    transitionDraft: transition({
      successor: REQ_R, authorityRef: { kind: "user" }, ackRef: { kind: "plan-gate", ref: "R-gate" },
      compatibility: { impact: "no consumers", disposition: "no-affected-dependents" },
    }),
    successorDraft: { ...reqDraft(), sourceRef: "S-nope" },
    witness: { source: "draft", recordId: "R-gate", record: planGate("R-gate", REQ_R) },
    citedRecords: [],
  })), "a REQ sourceRef naming nothing");
  assert.strictEqual(badSource.code, "E_DANGLING_REF", badSource.message);

  // And a DRAFTED ruling really does resolve a drafted basisRef — the positive at the top of the
  // file already depends on it, asserted here as the explicit staged-index control.
  assertProspectiveTransitionAuthority(f.preIndex, candidate());
  assertUntouched(f, "ref refusals");
});

// --- 5. governance postconditions, anti-borrowing and routing --------------------------------------------------

test("clause ruling postconditions, anti-borrowing and routing are charged on the staged union", () => {
  const f = fixture();
  const cases = [
    ["a DEC citing no technical-decision ruling", {
      successorDraft: decDraft(CODE, "R-plain"),
      citedRecords: [reviewRuling("R-plain", CODE, "DP-1")],
    }, "E_DEC_RULING_REQUIRED"],
    ["a decision that is not the ruling's selectedAlternative", {
      successorDraft: { ...decDraft(CODE, "R-tech"), decision: "B" },
    }, "E_RULING_POSTCONDITION"],
    ["alternatives that disagree with the packet", {
      successorDraft: { ...decDraft(CODE, "R-tech"), alternatives: ["A", "B", "C"] },
    }, "E_RULING_POSTCONDITION"],
    ["an approvedBy that is not the ruling's by", {
      successorDraft: decDraft(TEST_DISCIPLINE, "R-tech"),
    }, "E_RULING_POSTCONDITION"],
    // The DEC's ruling requirement is satisfied by R-tech; the SECOND cited basis is an ordinary
    // untyped ruling bound to another DP, which is the anti-borrowing case.
    ["a cited ruling bound to neither the clause nor its DP", {
      successorDraft: {
        ...decDraft(CODE, "R-tech"),
        basisRefs: [{ kind: "review-ruling", ref: "R-tech" }, { kind: "review-ruling", ref: "R-borrowed" }],
      },
      citedRecords: [techRuling("R-tech", CODE), reviewRuling("R-borrowed", CODE, "DP-elsewhere")],
    }, "E_RULING_BORROWED"],
    ["a typed packet whose digest disagrees with its snapshot", {
      citedRecords: [{ ...techRuling("R-tech", CODE), inputPacketDigest: "deadbeef" }],
    }, "E_RULING_SNAPSHOT"],
    ["a typed packet missing a required field", {
      citedRecords: [(() => {
        const r = techRuling("R-tech", CODE);
        const snapshot = { ...r.inputPacketSnapshot };
        delete snapshot.basisRefs;
        return { ...r, inputPacketSnapshot: snapshot, inputPacketDigest: digestOf(snapshot) };
      })()],
    }, "E_RULING_PACKET_INCOMPLETE"],
  ];
  for (const [what, over, code] of cases) {
    const error = refused(() => assertProspectiveTransitionAuthority(f.preIndex, candidate(over)), what);
    assert.strictEqual(error.code, code, `${what}: ${error.message}`);
  }

  // Routing: an ASSUM successor draft with no routingOrigin is validateRoutingOrigins' own refusal,
  // and its positive control is the revise candidate below, which differs only in that field.
  assertProspectiveTransitionAuthority(f.preIndex, candidate({
    transitionDraft: transition({ action: "revise", successor: ASSUM_C }),
    successorDraft: assumDraft(),
    citedRecords: [],
  }));
  const routing = refused(() => assertProspectiveTransitionAuthority(f.preIndex, candidate({
    transitionDraft: transition({ action: "revise", successor: ASSUM_C }),
    successorDraft: { ...assumDraft(), routingOrigin: undefined },
    citedRecords: [],
  })), "an ASSUM draft with no routingOrigin");
  assert.ok(routing.code.startsWith("E_"), routing.message);
  assertUntouched(f, "governance refusals");
});

// --- 6. typed-ruling freshness against the PRE-state -------------------------------------------------------

test("a newly consumed TYPED ruling is checked for freshness against the pre-state, drafted or persisted", () => {
  const f = fixture();
  // A packet snapshotting a DP that is not the pre-state's DP-1 is stale, even though the ruling is
  // itself well formed and self-consistent.
  const staleDraft = refused(() => assertProspectiveTransitionAuthority(f.preIndex, candidate({
    citedRecords: [techRuling("R-tech", CODE, { ...DP, scenario: "an earlier question" })],
  })), "a drafted ruling answering an earlier DP state");
  assert.strictEqual(staleDraft.code, "E_RULING_PACKET_STALE", staleDraft.message);

  // The same rule for a PERSISTED ruling: mint it while the DP says one thing, move the DP, then
  // consume it. The store is legal at every step; only the moment of use has changed.
  const moved = preStore();
  moved.records.push(techRuling("R-tech", CODE));
  moved.decisionPoints[0].scenario = "a materially different question";
  const movedIndex = validateAll(moved, OPTS).index;      // the moved store is still legal
  assert.notStrictEqual(movedIndex.dps.get("DP-1").scenario, DP.scenario, "the DP really moved");

  const stalePersisted = refused(() => assertProspectiveTransitionAuthority(movedIndex, {
    transitionDraft: transition(),
    successorDraft: decDraft(CODE, "R-tech"),
    witness: { source: "persisted", recordId: "R-rule1", record: null },
    citedRecords: [],
  }), "a persisted ruling consumed after its DP moved");
  assert.strictEqual(stalePersisted.code, "E_RULING_PACKET_STALE", stalePersisted.message);
});

test("an UNTYPED witness ruling carries no packet and is never sent to the typed reader", () => {
  // R-rule1 is untyped and is the ackRef of the new transition, so newlyConsumedRulingRefs DOES
  // include it. A green run is the evidence that the filter kept it out of the packet reader.
  const f = fixture();
  assert.strictEqual(f.preIndex.records.get("R-rule1").rulingKind, undefined, "the witness really is untyped");
  assertProspectiveTransitionAuthority(f.preIndex, candidate());
});

test("an UNUSED historical typed ruling is not newly consumed and its staleness is irrelevant", () => {
  // A typed ruling sits in the pre-state answering a DP state that has since moved. Nothing in the
  // candidate cites it, so it is not in the consumed set and cannot refuse this candidate.
  const moved = preStore();
  moved.records.push(techRuling("R-old", CODE));
  moved.decisionPoints[0].scenario = "a materially different question";
  const movedIndex = validateAll(moved, OPTS).index;
  const freshPacket = packetFor(movedIndex.dps.get("DP-1"), CODE);

  // The candidate cites only a ruling whose packet matches the CURRENT DP; R-old is untouched.
  assertProspectiveTransitionAuthority(movedIndex, {
    transitionDraft: transition({ ackRef: { kind: "review-ruling", ref: "R-new" } }),
    successorDraft: decDraft(CODE, "R-new"),
    witness: {
      source: "draft",
      recordId: "R-new",
      record: {
        ...reviewRuling("R-new", CODE, "DP-1"),
        rulingKind: "technical-decision", basis: "stated basis", selectedAlternative: "A",
        inputPacketSnapshot: freshPacket, inputPacketDigest: digestOf(freshPacket),
      },
    },
    citedRecords: [],
  });
  assert.strictEqual(movedIndex.records.has("R-old"), true, "the stale historical ruling is still there");
});

// --- 7. the retained matrix, and persisted precedence -------------------------------------------------------

test("the matrix rows are retained: authority, witness kind, subject binding and forbidden rows all refuse", () => {
  const f = fixture();
  const cases = [
    ["a discipline that is neither governing nor arbiter", {
      transitionDraft: transition({ authorityRef: TEST_DISCIPLINE, ackRef: { kind: "review-ruling", ref: "R-x" } }),
      witness: { source: "draft", recordId: "R-x", record: reviewRuling("R-x", TEST_DISCIPLINE, "DP-1") },
      successorDraft: decDraft(CODE, "R-tech"),
    }, "E_MATRIX_AUTHORITY"],
    ["a witness bound to something else", {
      transitionDraft: transition({ ackRef: { kind: "review-ruling", ref: "R-x" } }),
      witness: { source: "draft", recordId: "R-x", record: reviewRuling("R-x", CODE, "DP-elsewhere") },
    }, "E_WITNESS_SUBJECT"],
    ["a review-ruling standing in for a user plan-gate", {
      transitionDraft: transition({
        successor: REQ_R, authorityRef: { kind: "user" }, ackRef: { kind: "review-ruling", ref: "R-x" },
        compatibility: { impact: "no consumers", disposition: "no-affected-dependents" },
      }),
      successorDraft: reqDraft(),
      witness: { source: "draft", recordId: "R-x", record: reviewRuling("R-x", CODE, "DP-1") },
      citedRecords: [],
    }, "E_WITNESS_KIND"],
    ["a plan gate naming another successor", {
      transitionDraft: transition({
        successor: REQ_R, authorityRef: { kind: "user" }, ackRef: { kind: "plan-gate", ref: "R-gate" },
        compatibility: { impact: "no consumers", disposition: "no-affected-dependents" },
      }),
      successorDraft: reqDraft(),
      witness: { source: "draft", recordId: "R-gate", record: planGate("R-gate", REQ_S) },
      citedRecords: [],
    }, "E_WITNESS_SUCCESSOR"],
    ["compatibility stated on a non-REQ successor", {
      transitionDraft: transition({ compatibility: { impact: "none", disposition: "no-affected-dependents" } }),
    }, "E_COMPAT_FORBIDDEN"],
  ];
  for (const [what, over, code] of cases) {
    const error = refused(() => assertProspectiveTransitionAuthority(f.preIndex, candidate(over)), what);
    assert.strictEqual(error.code, code, `${what}: ${error.message}`);
  }
  assertUntouched(f, "matrix refusals");
});

test("persisted validation keeps its own order: the matrix still refuses before the typed packet check", () => {
  // A store carrying BOTH a matrix fault and a typed-packet fault must report the matrix one, because
  // validateTransitionMatrix runs before validateGovernanceRulings. The extraction must not move it.
  const store = preStore();
  const snapshot = packetFor(DP, CODE);
  store.records.push({
    ...reviewRuling("R-bad", CODE, "DP-1"),
    rulingKind: "technical-decision", basis: "b", selectedAlternative: "A",
    inputPacketSnapshot: snapshot, inputPacketDigest: "deadbeef",       // packet fault
  });
  store.transitions.push({
    // A retire carried by a principal that is neither governing nor arbiter: an AUTHORITY fault.
    id: "T-bad", subject: ASSUM_A, action: "retire",
    authorityRef: TEST_DISCIPLINE, ackRef: { kind: "review-ruling", ref: "R-rule1" },
  });
  const error = refused(() => validateAll(store, OPTS), "a store with both faults");
  assert.strictEqual(error.code, "E_MATRIX_AUTHORITY",
    "the matrix is charged before the typed packet, exactly as before the extraction");
});

test("persisted validation keeps its id claims interleaved: a malformed earlier object beats a later duplicate", () => {
  // A malformed CLAUSE and, after it, a duplicate RECORD id. Claims are interleaved with each
  // object's checks, so the clause's own fault is reported. A hoisted pre-pass would report the
  // duplicate instead, which is exactly the reordering the extraction must not cause.
  const store = preStore();
  store.clauses.push({
    id: "ASSUM-0000000000000000000000000C", layer: "nowhere", derivedFrom: "DP-1",
    text: "t", alternative: "a", basis: "b", basisRefs: [], governedBy: CODE, routingOrigin: "safe-default",
  });
  store.records.push({ ...store.records[0] });
  const error = refused(() => validateAll(store, OPTS), "a malformed clause plus a later duplicate record");
  assert.strictEqual(error.code, "E_ENUM", "the earlier object's own fault, not the later duplicate");
  assert.match(error.message, /unknown layer/);
});

// One success and one refusal, over ONE candidate. This is the case that charges candidate-object
// immutability directly; it does not generalise to every other case in this file.
test("the operation is pure: no store text, pre-index or candidate object moves on success or refusal", () => {
  const f = fixture();
  const before = canonicalJson(f.store);
  const c = candidate();
  const candidateBefore = canonicalJson(c);

  assertProspectiveTransitionAuthority(f.preIndex, c);
  refused(() => assertProspectiveTransitionAuthority(f.preIndex, candidate({
    transitionDraft: transition({ authorityRef: TEST_DISCIPLINE }),
  })), "a refused candidate");

  assert.strictEqual(canonicalJson(f.store), before, "the store object is unchanged");
  assert.strictEqual(canonicalJson(c), candidateBefore, "the candidate object is unchanged");
  assert.deepStrictEqual(
    [...f.preIndex.clauses.keys()].sort(), [ASSUM_A], "the pre-index clause map is unchanged");
  assert.deepStrictEqual([...f.preIndex.transitions.keys()], [], "the pre-index transition map is unchanged");
  assert.deepStrictEqual(indexStore(f.store).records.size, f.preIndex.records.size,
    "and re-indexing the store yields the same record count");
});
