// Phase-1 tests for cressetide/skills/vigil/scripts/provenance-store.mjs.
//
// Spec anchors (all three approved):
//   SM  = docs/superpowers/specs/2026-07-25-shared-decision-provenance-model.md (approved v1.7)
//   IS  = docs/superpowers/specs/2026-07-25-intent-scan-spec.md (approved v1.1)
// Each test names the section / acceptance-criterion it lands. This suite covers the STORE-LAYER
// subset of the 72 acceptance criteria only — the orchestrator, inventory, adapter, reviewer,
// contract-derivation and ledger criteria belong to later phases and are NOT claimed here.
//
// Fixtures are built by chaining the REAL domain transactions, never by injecting a hand-built
// store: every fixture therefore passes the same validateAll() as production input.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { temporary, root } from "./helpers.mjs";
import {
  ProvenanceError, canonicalJson, canonicalText, sha256Hex, digestOf, sortTypedRefs,
  resolutionGroupDigest, emptyStore, canonicalStoreBytes, storeDigest, parseStore, loadStore,
  storePath, CANONICAL_STORE_PATH, indexStore, statusOf,
  validateAll, applyTransaction, runTransaction, clauseKindOf, ulid, encodeUlidTime,
} from "../cressetide/skills/vigil/scripts/provenance-store.mjs";

const NOW = Date.UTC(2026, 6, 26);
const OPTS = { now: NOW };

function threw(fn) {
  try { fn(); } catch (e) { return e; }
  return null;
}

function assertRejects(fn, code, what) {
  const e = threw(fn);
  assert.ok(e instanceof ProvenanceError, `${what}: expected a ProvenanceError, got ${e}`);
  assert.strictEqual(e.code, code, `${what}: expected code ${code}, got ${e.code} (${e.message})`);
  assert.ok(e.message.length > 10, `${what}: error message must be diagnosable`);
  return e;
}

// --- fixture builders (all via real transactions) -------------------------------------------------

const BASE = { treeOid: "a".repeat(40), storePath: CANONICAL_STORE_PATH, storeDigest: storeDigest(emptyStore()) };

function dp(id, over = {}) {
  return {
    id, dimension: "data", scenario: `scenario for ${id}`, alternatives: ["A", "B"],
    layer: "implementation", classificationBasis: "engineering standard", status: "open", ...over,
  };
}

function apply(store, command, payload) {
  return applyTransaction(store, command, payload, OPTS);
}

// A task with three open DPs, an owner record, a requirement Source, and one active
// approved-requirement REQ minted through create-requirement (IS §8).
function baseFixture() {
  let s = emptyStore();
  s = apply(s, "init-task", {
    taskId: "TASK-1",
    baseProvenance: BASE,
    decisionPoints: [dp("DP-1"), dp("DP-2"), dp("DP-3", { layer: "intent" })],
    currentTaskDpIds: ["DP-1", "DP-2", "DP-3"],
  });
  s = apply(s, "append-record", {
    record: { recordId: "R-owner", kind: "source-authority", authorityIdentity: "EU DPA" },
  });
  s = apply(s, "append-source", {
    source: {
      sourceId: "S-req", contentKind: "requirement", driftMode: "snapshot-only",
      locator: "conversation#1", excerpt: "plain-object response headers are scanned in Object.entries() order",
    },
  });
  s = apply(s, "create-requirement", {
    requirement: {
      id: "REQ-a", authority: "approved-requirement", kind: "acceptance",
      text: "retry only on the six frozen statuses", sourceRef: "S-req", taskRef: "TASK-1",
      acceptance: { behaviorChanging: true, verification: "test/retry.test.mjs::status allowlist" },
    },
  });
  return s;
}

function reviewRuling(recordId, principal, subjectRef, extra = {}) {
  return { recordId, kind: "review-ruling", by: principal, subjectRef, ruling: "ok", ...extra };
}

function planGate(recordId, target, impact = "no consumers", disposition = "no-affected-dependents") {
  return { recordId, kind: "plan-gate", target, impact, disposition, approvedBy: "user" };
}

const CODE = { kind: "discipline", discipline: "code" };
const SECURITY = { kind: "discipline", discipline: "security" };
const INTENT = { kind: "discipline", discipline: "intent" };
const ARBITER = { kind: "arbiter" };

// A store where DP-1 is assumed via ASSUM-a (governedBy code).
function withAssumption(governedBy = CODE) {
  let s = baseFixture();
  s = apply(s, "create-initial-outcome", {
    dpId: "DP-1",
    records: [reviewRuling("R-rule1", governedBy, "DP-1")],
    clause: {
      id: "ASSUM-a", layer: "implementation", derivedFrom: "DP-1",
      text: "treat null as absent", alternative: "treat null as invalid",
      basis: "matches the option table", basisRefs: ["S-req"], governedBy,
    },
  });
  return s;
}

// --- 1. store & canonical encoding (SM §2 batchDigest, §9 canonical bytes) -------------------------

test("SM §9: canonical empty store carries every section including taskStates, and its digest is stable", () => {
  const e = emptyStore();
  assert.deepStrictEqual(Object.keys(e).sort(), [
    "clauses", "decisionPoints", "provenanceVersion", "records", "sources", "taskStates", "transitions",
  ]);
  assert.deepStrictEqual(e.taskStates, []);
  assert.strictEqual(storeDigest(e), storeDigest(emptyStore()));
});

test("SM §2: canonicalJson sorts object keys by code point and emits no insignificant whitespace", () => {
  assert.strictEqual(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.strictEqual(canonicalJson({ "Z": 1, "a": 2 }), '{"Z":1,"a":2}'); // code point, not locale
  assert.strictEqual(canonicalJson([3, 1, 2]), "[3,1,2]");               // arrays keep caller order
  assert.strictEqual(canonicalJson(null), "null");
});

test("SM §9: canonicalText normalises CRLF/CR to LF and strips a BOM, but never trims", () => {
  assert.strictEqual(canonicalText("a\r\nb\rc"), "a\nb\nc");
  assert.strictEqual(canonicalText("﻿x"), "x");
  assert.strictEqual(canonicalText("  padded  "), "  padded  ");
});

test("SM §9: a digest is identical for CRLF and LF inputs (line-ending canonicalisation)", () => {
  assert.strictEqual(sha256Hex("line1\r\nline2"), sha256Hex("line1\nline2"));
});

test("SM §2: relatedRefs / evidence refs sort by (kind, ref) and deduplicate — two insertion orders agree", () => {
  const a = sortTypedRefs([
    { kind: "review-ruling", ref: "R-2" }, { kind: "user-answer", ref: "R-1" }, { kind: "review-ruling", ref: "R-1" },
  ]);
  const b = sortTypedRefs([
    { kind: "review-ruling", ref: "R-1" }, { kind: "review-ruling", ref: "R-2" },
    { kind: "user-answer", ref: "R-1" }, { kind: "user-answer", ref: "R-1" },
  ]);
  assert.deepStrictEqual(a, b);
  assert.strictEqual(a.length, 3);
});

test("SM §2 / IS AC ②⑥: resolutionGroupDigest is permutation- and duplicate-invariant", () => {
  const one = resolutionGroupDigest({
    subjectRef: "ASSUM-a", action: "supersede", successor: "REQ-b",
    semanticEvidenceRefs: [{ kind: "review-ruling", ref: "R-2" }, { kind: "review-ruling", ref: "R-1" }],
  });
  const two = resolutionGroupDigest({
    subjectRef: "ASSUM-a", action: "supersede", successor: "REQ-b",
    semanticEvidenceRefs: [
      { kind: "review-ruling", ref: "R-1" }, { kind: "review-ruling", ref: "R-2" },
      { kind: "review-ruling", ref: "R-1" },
    ],
  });
  assert.strictEqual(one, two);
});

test("SM §2: resolutionGroupDigest changes when a sibling evidence ref is dropped, or the action/successor differs", () => {
  const full = resolutionGroupDigest({
    subjectRef: "ASSUM-a", action: "supersede", successor: "REQ-b",
    semanticEvidenceRefs: [{ kind: "review-ruling", ref: "R-1" }, { kind: "review-ruling", ref: "R-2" }],
  });
  const missing = resolutionGroupDigest({
    subjectRef: "ASSUM-a", action: "supersede", successor: "REQ-b",
    semanticEvidenceRefs: [{ kind: "review-ruling", ref: "R-1" }],
  });
  const retire = resolutionGroupDigest({
    subjectRef: "ASSUM-a", action: "retire", successor: null,
    semanticEvidenceRefs: [{ kind: "review-ruling", ref: "R-1" }, { kind: "review-ruling", ref: "R-2" }],
  });
  assert.notStrictEqual(full, missing);
  assert.notStrictEqual(full, retire);
});

test("SM §9 determinism: store bytes are insertion-order independent (two build orders, one digest)", () => {
  const a = apply(apply(emptyStore(), "append-record",
    { record: { recordId: "R-1", kind: "source-authority", authorityIdentity: "x" } }), "append-record",
    { record: { recordId: "R-2", kind: "source-authority", authorityIdentity: "y" } });
  const b = apply(apply(emptyStore(), "append-record",
    { record: { recordId: "R-2", kind: "source-authority", authorityIdentity: "y" } }), "append-record",
    { record: { recordId: "R-1", kind: "source-authority", authorityIdentity: "x" } });
  assert.strictEqual(storeDigest(a), storeDigest(b));
});

test("SM §9: store paths use the fixed canonical location — a base witness may not point elsewhere", () => {
  assert.strictEqual(CANONICAL_STORE_PATH, ".ctide/provenance.json");
  assert.strictEqual(storePath("/repo"), path.join("/repo", ".ctide", "provenance.json"));
  const bad = { ...BASE, storePath: "somewhere/else.json" };
  assertRejects(() => apply(emptyStore(), "init-task", { taskId: "T", baseProvenance: bad }),
    "E_BASE_STORE_PATH", "caller-chosen store path");
});

test("SM §9: a malformed or wrong-version store fails closed rather than degrading to empty", () => {
  assertRejects(() => parseStore("{not json"), "E_STORE_MALFORMED", "invalid JSON");
  assertRejects(() => parseStore("[]"), "E_STORE_MALFORMED", "array root");
  assertRejects(() => parseStore('{"provenanceVersion":99}'), "E_STORE_VERSION", "unknown version");
  assertRejects(() => parseStore('{"provenanceVersion":1,"sources":[]}'), "E_STORE_MALFORMED", "missing section");
});

test("SM §2: unknown ENUM values fail closed, while unknown extra FIELDS (downstream annotations) are tolerated", () => {
  const s = baseFixture();
  assertRejects(() => apply(s, "append-source", {
    source: { sourceId: "S-x", contentKind: "made-up", driftMode: "repo-file", excerpt: "x" },
  }), "E_ENUM", "unknown contentKind");
  // taskRef / acceptance / an arbitrary annotation all survive: the model explicitly lets downstream
  // specs attach fields.
  const ok = apply(s, "append-record", {
    record: { recordId: "R-ann", kind: "source-authority", authorityIdentity: "x", taskRef: "TASK-1", futureField: 1 },
  });
  assert.ok(indexStore(ok).records.get("R-ann").futureField === 1);
});

test("SM §2: a dangling ref fails closed (REQ→Source, DEC→DP, transition→subject)", () => {
  const s = baseFixture();
  assertRejects(() => apply(s, "create-requirement", {
    requirement: { id: "REQ-x", authority: "approved-requirement", kind: "specification", text: "t", sourceRef: "S-nope", taskRef: "TASK-1" },
  }), "E_DANGLING_REF", "REQ with unresolvable sourceRef");
  assertRejects(() => apply(s, "create-initial-outcome", {
    dpId: "DP-2",
    clause: { id: "DEC-x", layer: "implementation", derivedFrom: "DP-nope", decision: "a", alternatives: ["a", "b"], approvedBy: CODE },
  }), "E_DANGLING_REF", "DEC with unresolvable derivedFrom");
});

test("SM §2: duplicate ids fail closed — identical payload and divergent payload get distinct codes", () => {
  const s = baseFixture();
  assertRejects(() => apply(s, "append-record", {
    record: { recordId: "R-owner", kind: "source-authority", authorityIdentity: "EU DPA" },
  }), "E_DUPLICATE_ID", "same id, identical payload");
  assertRejects(() => apply(s, "append-record", {
    record: { recordId: "R-owner", kind: "source-authority", authorityIdentity: "different" },
  }), "E_ID_PAYLOAD_CONFLICT", "same id, divergent payload");
});

test("SM §2 / IS AC ②⑦: duplicate taskId fails closed", () => {
  const s = baseFixture();
  assertRejects(() => apply(s, "init-task", { taskId: "TASK-1", baseProvenance: BASE }),
    "E_TASK_EXISTS", "re-initialising an existing task");
});

test("SM §2: a wrong ref KIND fails closed even when the id exists", () => {
  const s = baseFixture();
  // R-owner exists but is a source-authority record; a plan-gate-typed ref to it must not resolve,
  // which makes the clause non-applicable and so blocks the whole transaction (INV-4).
  const e = assertRejects(() => apply(s, "create-initial-outcome", {
    dpId: "DP-2",
    clause: {
      id: "ASSUM-w", layer: "implementation", derivedFrom: "DP-2", text: "t", alternative: "u",
      basis: "b", basisRefs: [{ kind: "plan-gate", ref: "R-owner" }], governedBy: CODE,
    },
  }), "E_INV4_NOT_APPLICABLE", "clause whose basisRef names the right id under the wrong kind");
  assert.match(e.message, /basisRef unresolvable/);
});

test("SM §2 INV-3: a clause may not author status/revisedBy/supersededBy — they are derived", () => {
  const s = baseFixture();
  assertRejects(() => apply(s, "create-requirement", {
    requirement: {
      id: "REQ-z", authority: "approved-requirement", kind: "specification", text: "t",
      sourceRef: "S-req", taskRef: "TASK-1", status: "active",
    },
  }), "E_INV3_AUTHORED_LIFECYCLE", "clause authoring a lifecycle field");
});

// --- 2. immutability & CAS (IS §8 transaction protocol) --------------------------------------------

test("IS §8: a rejected transaction leaves the canonical store byte-identical on disk", () => {
  const cwd = temporary("prov-cas-");
  runTransaction(cwd, "init-task", { taskId: "TASK-1", baseProvenance: BASE }, OPTS);
  const before = fs.readFileSync(storePath(cwd), "utf8");
  const e = threw(() => runTransaction(cwd, "init-task", { taskId: "TASK-1", baseProvenance: BASE }, OPTS));
  assert.ok(e instanceof ProvenanceError);
  assert.strictEqual(fs.readFileSync(storePath(cwd), "utf8"), before, "store bytes must be untouched");
});

test("IS §8: CAS digest mismatch is refused before anything is written", () => {
  const cwd = temporary("prov-cas2-");
  runTransaction(cwd, "init-task", { taskId: "TASK-1", baseProvenance: BASE }, OPTS);
  const before = fs.readFileSync(storePath(cwd), "utf8");
  assertRejects(
    () => runTransaction(cwd, "append-record",
      { record: { recordId: "R-1", kind: "source-authority", authorityIdentity: "x" } },
      { ...OPTS, expectedStoreDigest: "deadbeef" }),
    "E_CAS_MISMATCH", "stale expected digest",
  );
  assert.strictEqual(fs.readFileSync(storePath(cwd), "utf8"), before);
});

test("IS §8: a concurrent writer between load and swap is detected at the last moment (no clobber)", () => {
  const cwd = temporary("prov-cas3-");
  runTransaction(cwd, "init-task", { taskId: "TASK-1", baseProvenance: BASE }, OPTS);
  const file = storePath(cwd);
  const original = fs.readFileSync(file, "utf8");
  // Simulate the race by mutating the file after loadStore would have run: easiest deterministic
  // proxy is to pass an expectedStoreDigest matching the ORIGINAL and then change the file.
  const parsed = parseStore(original);
  const mutated = applyTransaction(parsed, "append-record",
    { record: { recordId: "R-other", kind: "source-authority", authorityIdentity: "concurrent" } }, OPTS);
  fs.writeFileSync(file, canonicalStoreBytes(mutated), "utf8");
  assertRejects(
    () => runTransaction(cwd, "append-record",
      { record: { recordId: "R-mine", kind: "source-authority", authorityIdentity: "mine" } },
      { ...OPTS, expectedStoreDigest: sha256Hex(original) }),
    "E_CAS_MISMATCH", "store changed underneath",
  );
  assert.ok(fs.readFileSync(file, "utf8").includes("R-other"), "the concurrent write survives");
  assert.ok(!fs.readFileSync(file, "utf8").includes("R-mine"), "our write must not land");
});

test("IS §8: a successful transaction leaves no temp file behind and the loader sees only the final snapshot", () => {
  const cwd = temporary("prov-atomic-");
  runTransaction(cwd, "init-task", { taskId: "TASK-1", baseProvenance: BASE }, OPTS);
  const dir = path.dirname(storePath(cwd));
  const leftovers = fs.readdirSync(dir).filter((f) => f.includes(".tmp"));
  assert.deepStrictEqual(leftovers, [], "no temp file may survive");
  const loaded = loadStore(cwd);
  assert.strictEqual(loaded.store.taskStates.length, 1);
  assert.strictEqual(loaded.digest, sha256Hex(fs.readFileSync(storePath(cwd), "utf8")));
});

test("IS §8: a failing transaction leaves no temp file behind either", () => {
  const cwd = temporary("prov-atomic2-");
  runTransaction(cwd, "init-task", { taskId: "TASK-1", baseProvenance: BASE }, OPTS);
  threw(() => runTransaction(cwd, "append-record", { record: { recordId: "R-1", kind: "nope" } }, OPTS));
  const dir = path.dirname(storePath(cwd));
  assert.deepStrictEqual(fs.readdirSync(dir).filter((f) => f.includes(".tmp")), []);
});

test("IS §8: an absent store loads as the canonical empty store rather than erroring", () => {
  const cwd = temporary("prov-absent-");
  const loaded = loadStore(cwd);
  assert.strictEqual(loaded.exists, false);
  assert.deepStrictEqual(loaded.store, emptyStore());
  assert.strictEqual(loaded.digest, storeDigest(emptyStore()));
});

// --- 3. Transition matrix & witness binding (SM §2 validity table) ---------------------------------

function withRequirementSuccessor(s, id = "REQ-b") {
  return apply(s, "append-source", {
    source: { sourceId: `S-${id}`, contentKind: "requirement", driftMode: "snapshot-only", locator: "c#2", excerpt: `text for ${id}` },
  });
}

test("SM §2: ASSUM revise by its governing principal is accepted (positive row)", () => {
  let s = withAssumption(CODE);
  s = withRequirementSuccessor(s, "ASSUM-b");
  s = apply(s, "replace-terminal", {
    dpId: "DP-1", casMode: "current-terminal", expectedCurrentTerminalRef: "ASSUM-a",
    records: [reviewRuling("R-rev", CODE, "ASSUM-a")],
    successorClause: {
      id: "ASSUM-b", layer: "implementation", derivedFrom: "DP-1", text: "revised reading",
      alternative: "treat null as invalid", basis: "new evidence", basisRefs: [], governedBy: CODE,
    },
    transition: {
      id: "T-1", subject: "ASSUM-a", action: "revise", successor: "ASSUM-b",
      authorityRef: CODE, ackRef: { kind: "review-ruling", ref: "R-rev" },
    },
  });
  const index = indexStore(s);
  assert.strictEqual(statusOf(index, "ASSUM-a"), "revised");
  assert.strictEqual(index.dps.get("DP-1").assumedAs, "ASSUM-b");
});

test("SM §2: another discipline may NOT revise a security-governed ASSUM (authority boundary)", () => {
  const s = withAssumption(SECURITY);
  assertRejects(() => apply(s, "replace-terminal", {
    dpId: "DP-1", casMode: "current-terminal", expectedCurrentTerminalRef: "ASSUM-a",
    records: [reviewRuling("R-rev", CODE, "ASSUM-a")],
    successorClause: {
      id: "ASSUM-b", layer: "implementation", derivedFrom: "DP-1", text: "t", alternative: "u",
      basis: "b", basisRefs: [], governedBy: SECURITY,
    },
    transition: {
      id: "T-1", subject: "ASSUM-a", action: "revise", successor: "ASSUM-b",
      authorityRef: CODE, ackRef: { kind: "review-ruling", ref: "R-rev" },
    },
  }), "E_MATRIX_AUTHORITY", "code revising a security-governed ASSUM");
});

test("SM §2: arbiter may revise any ASSUM (cross-discipline final authority)", () => {
  let s = withAssumption(SECURITY);
  s = apply(s, "replace-terminal", {
    dpId: "DP-1", casMode: "current-terminal", expectedCurrentTerminalRef: "ASSUM-a",
    records: [reviewRuling("R-arb", ARBITER, "ASSUM-a")],
    successorClause: {
      id: "ASSUM-b", layer: "implementation", derivedFrom: "DP-1", text: "t", alternative: "u",
      basis: "b", basisRefs: [], governedBy: SECURITY,
    },
    transition: {
      id: "T-1", subject: "ASSUM-a", action: "revise", successor: "ASSUM-b",
      authorityRef: ARBITER, ackRef: { kind: "review-ruling", ref: "R-arb" },
    },
  });
  assert.strictEqual(statusOf(indexStore(s), "ASSUM-a"), "revised");
});

test("SM §2 / IS AC54: ASSUM → REQ with a bare user-answer is refused; a plan-gate witness is required", () => {
  let s = withAssumption(CODE);
  s = withRequirementSuccessor(s, "REQ-b");
  const successorClause = {
    id: "REQ-b", authority: "approved-requirement", kind: "specification",
    text: "the product ruling", sourceRef: "S-REQ-b", taskRef: "TASK-1",
  };
  const common = {
    dpId: "DP-1", casMode: "current-terminal", expectedCurrentTerminalRef: "ASSUM-a", successorClause,
  };
  assertRejects(() => apply(s, "replace-terminal", {
    ...common,
    records: [{ recordId: "R-ua", kind: "user-answer", subjectRef: "DP-1", answer: "do it" }],
    transition: {
      id: "T-1", subject: "ASSUM-a", action: "supersede", successor: "REQ-b",
      authorityRef: { kind: "user" }, ackRef: { kind: "user-answer", ref: "R-ua" },
    },
  }), "E_WITNESS_KIND", "user-answer standing in for a plan gate");

  const ok = apply(s, "replace-terminal", {
    ...common,
    records: [planGate("R-pg", "ASSUM-a")],
    transition: {
      id: "T-1", subject: "ASSUM-a", action: "supersede", successor: "REQ-b",
      authorityRef: { kind: "user" }, ackRef: { kind: "plan-gate", ref: "R-pg" },
    },
  });
  assert.strictEqual(statusOf(indexStore(ok), "ASSUM-a"), "superseded");
  assert.strictEqual(indexStore(ok).dps.get("DP-1").resolvedBy, "REQ-b");
});

test("SM §2: a plan-gate witness naming a DIFFERENT target is refused (no borrowing)", () => {
  let s = withAssumption(CODE);
  s = withRequirementSuccessor(s, "REQ-b");
  assertRejects(() => apply(s, "replace-terminal", {
    dpId: "DP-1", casMode: "current-terminal", expectedCurrentTerminalRef: "ASSUM-a",
    records: [planGate("R-pg", "REQ-a")], // legitimate record, wrong subject
    successorClause: {
      id: "REQ-b", authority: "approved-requirement", kind: "specification", text: "t",
      sourceRef: "S-REQ-b", taskRef: "TASK-1",
    },
    transition: {
      id: "T-1", subject: "ASSUM-a", action: "supersede", successor: "REQ-b",
      authorityRef: { kind: "user" }, ackRef: { kind: "plan-gate", ref: "R-pg" },
    },
  }), "E_WITNESS_TARGET", "plan-gate for another clause");
});

test("SM §2: a review-ruling bound to an unrelated subject cannot authorise the transition", () => {
  const s = withAssumption(CODE);
  assertRejects(() => apply(s, "replace-terminal", {
    dpId: "DP-1", casMode: "current-terminal", expectedCurrentTerminalRef: "ASSUM-a",
    records: [reviewRuling("R-else", CODE, "DP-2")], // valid ruling, wrong DP
    transition: {
      id: "T-1", subject: "ASSUM-a", action: "retire", successor: null,
      authorityRef: CODE, ackRef: { kind: "review-ruling", ref: "R-else" },
    },
  }), "E_WITNESS_SUBJECT", "ruling about another DP");
});

test("SM §2: review-ruling.by must equal the declared authority principal", () => {
  const s = withAssumption(CODE);
  assertRejects(() => apply(s, "replace-terminal", {
    dpId: "DP-1", casMode: "current-terminal", expectedCurrentTerminalRef: "ASSUM-a",
    records: [reviewRuling("R-x", ARBITER, "DP-1")],
    transition: {
      id: "T-1", subject: "ASSUM-a", action: "retire", successor: null,
      authorityRef: CODE, ackRef: { kind: "review-ruling", ref: "R-x" },
    },
  }), "E_WITNESS_PRINCIPAL", "ruling by arbiter, authority claims code");
});

// hard-constraint REQs are minted through create-initial-outcome (create-requirement is pinned to
// approved-requirement, IS §8) — see the Spec-feasibility note in the delivery report.
function withHardConstraint() {
  let s = baseFixture();
  s = apply(s, "append-source", {
    source: { sourceId: "S-hc", contentKind: "policy", driftMode: "snapshot-only", locator: "policy#1", excerpt: "PII must not leave the EU" },
  });
  s = apply(s, "create-initial-outcome", {
    dpId: "DP-2",
    clause: {
      id: "REQ-hc", authority: "hard-constraint", kind: "specification", text: "PII stays in the EU",
      sourceRef: "S-hc", ownerRef: { kind: "source-authority", ref: "R-owner" },
    },
  });
  return s;
}

test("SM §2: a hard-constraint REQ can never be superseded", () => {
  let s = withHardConstraint();
  s = withRequirementSuccessor(s, "REQ-new");
  assertRejects(() => apply(s, "replace-terminal", {
    dpId: "DP-2", casMode: "current-terminal", expectedCurrentTerminalRef: "REQ-hc",
    records: [planGate("R-pg", "REQ-hc")],
    successorClause: {
      id: "REQ-new", authority: "approved-requirement", kind: "specification", text: "t",
      sourceRef: "S-REQ-new", taskRef: "TASK-1",
    },
    transition: {
      id: "T-1", subject: "REQ-hc", action: "supersede", successor: "REQ-new",
      authorityRef: { kind: "user" }, ackRef: { kind: "plan-gate", ref: "R-pg" },
      compatibility: { impact: "none", disposition: "no-affected-dependents" },
    },
  }), "E_MATRIX_FORBIDDEN", "superseding a hard constraint");
});

test("SM §2: retiring a hard-constraint needs source-authority matching ownerRef plus a constraint-revocation", () => {
  const s = withHardConstraint();
  // user cannot do it
  assertRejects(() => apply(s, "replace-terminal", {
    dpId: "DP-2", casMode: "current-terminal", expectedCurrentTerminalRef: "REQ-hc",
    records: [planGate("R-pg", "REQ-hc")],
    transition: {
      id: "T-1", subject: "REQ-hc", action: "retire", successor: null,
      authorityRef: { kind: "user" }, ackRef: { kind: "plan-gate", ref: "R-pg" },
    },
  }), "E_MATRIX_AUTHORITY", "user retiring a hard constraint");

  // a source-authority that is NOT the owner cannot do it
  let s2 = apply(s, "append-record", { record: { recordId: "R-other-owner", kind: "source-authority", authorityIdentity: "someone else" } });
  assertRejects(() => apply(s2, "replace-terminal", {
    dpId: "DP-2", casMode: "current-terminal", expectedCurrentTerminalRef: "REQ-hc",
    records: [{ recordId: "R-rev", kind: "constraint-revocation", targetConstraintRef: "REQ-hc", authorityRef: { kind: "source-authority", ref: "R-other-owner" }, effectiveAt: "2026-07-26" }],
    transition: {
      id: "T-1", subject: "REQ-hc", action: "retire", successor: null,
      authorityRef: { kind: "source-authority", ref: "R-other-owner" },
      ackRef: { kind: "constraint-revocation", ref: "R-rev" },
    },
  }), "E_OWNER_MISMATCH", "non-owner source-authority");

  // the real owner can
  const ok = apply(s, "replace-terminal", {
    dpId: "DP-2", casMode: "current-terminal", expectedCurrentTerminalRef: "REQ-hc",
    records: [{ recordId: "R-rev", kind: "constraint-revocation", targetConstraintRef: "REQ-hc", authorityRef: { kind: "source-authority", ref: "R-owner" }, effectiveAt: "2026-07-26" }],
    transition: {
      id: "T-1", subject: "REQ-hc", action: "retire", successor: null,
      authorityRef: { kind: "source-authority", ref: "R-owner" },
      ackRef: { kind: "constraint-revocation", ref: "R-rev" },
    },
  });
  assert.strictEqual(statusOf(indexStore(ok), "REQ-hc"), "retired");
  assert.strictEqual(indexStore(ok).dps.get("DP-2").status, "open", "the dependent DP reopens");
});

test("SM §2: REQ has no revise action at all", () => {
  let s = baseFixture();
  s = withRequirementSuccessor(s, "REQ-b");
  s = apply(s, "create-initial-outcome", {
    dpId: "DP-2",
    clause: { id: "REQ-c", authority: "approved-requirement", kind: "specification", text: "t", sourceRef: "S-req", taskRef: "TASK-1" },
  });
  assertRejects(() => apply(s, "replace-terminal", {
    dpId: "DP-2", casMode: "current-terminal", expectedCurrentTerminalRef: "REQ-c",
    records: [planGate("R-pg", "REQ-c")],
    successorClause: { id: "REQ-b", authority: "approved-requirement", kind: "specification", text: "t", sourceRef: "S-REQ-b", taskRef: "TASK-1" },
    transition: {
      id: "T-1", subject: "REQ-c", action: "revise", successor: "REQ-b",
      authorityRef: { kind: "user" }, ackRef: { kind: "plan-gate", ref: "R-pg" },
    },
  }), "E_MATRIX_FORBIDDEN", "REQ revise");
});

test("SM §7: a REQ supersede whose compatibility block disagrees with the plan-gate proposal is refused", () => {
  let s = baseFixture();
  s = withRequirementSuccessor(s, "REQ-b");
  s = apply(s, "create-initial-outcome", {
    dpId: "DP-2",
    clause: { id: "REQ-c", authority: "approved-requirement", kind: "specification", text: "t", sourceRef: "S-req", taskRef: "TASK-1" },
  });
  const successorClause = { id: "REQ-b", authority: "approved-requirement", kind: "specification", text: "t2", sourceRef: "S-REQ-b", taskRef: "TASK-1" };
  assertRejects(() => apply(s, "supersede-requirement", {
    initiatingDpIds: ["DP-2"],
    records: [planGate("R-pg", "REQ-c", "breaks two callers", "migration")],
    successorClause,
    transition: {
      id: "T-1", subject: "REQ-c", action: "supersede", successor: "REQ-b",
      authorityRef: { kind: "user" }, ackRef: { kind: "plan-gate", ref: "R-pg" },
      compatibility: { impact: "no consumers", disposition: "no-affected-dependents" },
    },
  }), "E_PROPOSAL_MISMATCH", "compatibility block not matching the proposal");
});

// --- 4. INV-1..4 & DP closure ----------------------------------------------------------------------

test("SM §6 INV-1/2: a DP claiming assumed/decided/resolved without its terminal ref fails closed", () => {
  const s = baseFixture();
  for (const [status, code] of [["assumed", "E_INV1"], ["decided", "E_INV2"], ["resolved", "E_INV2"]]) {
    assertRejects(() => apply(s, "init-task", {
      taskId: `T-${status}`, baseProvenance: BASE, decisionPoints: [dp(`DP-${status}`, { status })],
    }), code, `${status} with no terminal ref`);
  }
});

test("SM §6 INV-4: terminal refs are mutually exclusive and must type-match their status", () => {
  // Both terminal refs name clauses that really exist, so the failure is the invariant itself and
  // not an incidental dangling ref.
  const s = withAssumption(CODE);
  assertRejects(() => apply(s, "init-task", {
    taskId: "T-x", baseProvenance: BASE,
    decisionPoints: [dp("DP-x", { status: "resolved", resolvedBy: "REQ-a", assumedAs: "ASSUM-a" })],
  }), "E_INV4_EXCLUSIVE", "two terminal refs at once");
  assertRejects(() => apply(s, "init-task", {
    taskId: "T-y", baseProvenance: BASE,
    decisionPoints: [dp("DP-y", { status: "assumed", assumedAs: "REQ-a" })],
  }), "E_INV4_TYPE", "REQ parked in assumedAs");
  assertRejects(() => apply(s, "init-task", {
    taskId: "T-z", baseProvenance: BASE,
    decisionPoints: [dp("DP-z", { status: "resolved" })],
  }), "E_INV2", "resolved with no terminal ref at all");
});

test("SM §6 INV-4: a terminal ref pointing at a non-active clause fails closed", () => {
  let s = withAssumption(CODE);
  // Retire ASSUM-a via a transaction, then try to re-point a fresh DP at the retired clause.
  s = apply(s, "replace-terminal", {
    dpId: "DP-1", casMode: "current-terminal", expectedCurrentTerminalRef: "ASSUM-a",
    records: [reviewRuling("R-ret", CODE, "ASSUM-a")],
    transition: {
      id: "T-1", subject: "ASSUM-a", action: "retire", successor: null,
      authorityRef: CODE, ackRef: { kind: "review-ruling", ref: "R-ret" },
    },
  });
  assert.strictEqual(statusOf(indexStore(s), "ASSUM-a"), "retired");
  assertRejects(() => apply(s, "adopt-existing-outcome", { dpId: "DP-2", clauseRef: "ASSUM-a" }),
    "E_NOT_APPLICABLE", "adopting a retired clause");
});

test("SM §8: replace-terminal repoints EVERY dependent DP in one transaction (no partial closure)", () => {
  let s = baseFixture();
  s = apply(s, "create-initial-outcome", {
    dpId: "DP-1",
    clause: {
      id: "ASSUM-shared", layer: "implementation", derivedFrom: "DP-1", text: "t", alternative: "u",
      basis: "b", basisRefs: [], governedBy: CODE,
    },
  });
  // A second DP adopts the same clause, so the closure has two dependents to move.
  s = apply(s, "adopt-existing-outcome", { dpId: "DP-2", clauseRef: "ASSUM-shared" });
  s = apply(s, "replace-terminal", {
    dpId: "DP-1", casMode: "current-terminal", expectedCurrentTerminalRef: "ASSUM-shared",
    records: [reviewRuling("R-r", CODE, "ASSUM-shared")],
    successorClause: {
      id: "ASSUM-next", layer: "implementation", derivedFrom: "DP-1", text: "t2", alternative: "u",
      basis: "b", basisRefs: [], governedBy: CODE,
    },
    transition: {
      id: "T-1", subject: "ASSUM-shared", action: "revise", successor: "ASSUM-next",
      authorityRef: CODE, ackRef: { kind: "review-ruling", ref: "R-r" },
    },
  });
  const index = indexStore(s);
  assert.strictEqual(index.dps.get("DP-1").assumedAs, "ASSUM-next");
  assert.strictEqual(index.dps.get("DP-2").assumedAs, "ASSUM-next", "the sibling DP moved too");
});

test("SM §8 / IS AC43: retire (successor=null) reopens every dependent DP atomically", () => {
  let s = baseFixture();
  s = apply(s, "create-initial-outcome", {
    dpId: "DP-1",
    clause: {
      id: "ASSUM-shared", layer: "implementation", derivedFrom: "DP-1", text: "t", alternative: "u",
      basis: "b", basisRefs: [], governedBy: CODE,
    },
  });
  s = apply(s, "adopt-existing-outcome", { dpId: "DP-2", clauseRef: "ASSUM-shared" });
  s = apply(s, "replace-terminal", {
    dpId: "DP-1", casMode: "current-terminal", expectedCurrentTerminalRef: "ASSUM-shared",
    records: [reviewRuling("R-r", CODE, "ASSUM-shared")],
    reopenTrigger: "review-evidence-overturns-basis",
    transition: {
      id: "T-1", subject: "ASSUM-shared", action: "retire", successor: null,
      authorityRef: CODE, ackRef: { kind: "review-ruling", ref: "R-r" },
    },
  });
  const index = indexStore(s);
  for (const id of ["DP-1", "DP-2"]) {
    const d = index.dps.get(id);
    assert.strictEqual(d.status, "open", `${id} reopens`);
    assert.strictEqual(d.priorTerminalRef, "ASSUM-shared");
    assert.strictEqual(d.reopenedBy, "review-evidence-overturns-basis");
  }
  assert.strictEqual(indexStore(s).transitions.get("T-1").action, "retire");
});

test("IS AC32: an initiating DP the successor cannot cover rejects the WHOLE supersede — no-write", () => {
  const cwd = temporary("prov-inits-");
  let s = baseFixture();
  s = apply(s, "create-initial-outcome", {
    dpId: "DP-2",
    clause: { id: "REQ-c", authority: "approved-requirement", kind: "specification", text: "t", sourceRef: "S-req", taskRef: "TASK-1" },
  });
  fs.mkdirSync(path.dirname(storePath(cwd)), { recursive: true });
  fs.writeFileSync(storePath(cwd), canonicalStoreBytes(s), "utf8");
  const before = fs.readFileSync(storePath(cwd), "utf8");
  // DP-3 is named as an initiating DP, but the successor is an exception-backed REQ and DP-3 has no
  // DP-bound scope ruling — so the successor cannot cover it. The whole transaction must be
  // rejected rather than superseding REQ-c and reopening DP-3 afterwards.
  const e = assertRejects(() => runTransaction(cwd, "supersede-requirement", {
    initiatingDpIds: ["DP-3"],
    records: [planGate("R-pg", "REQ-c")],
    sources: [{
      sourceId: "S-exc", contentKind: "exception-grant", driftMode: "snapshot-only", locator: "grant#1",
      excerpt: "scoped exception", targetConstraintRef: "REQ-hc-absent",
      grantAuthorityRef: { kind: "source-authority", ref: "R-owner" }, scope: "eu-only", expiry: "2099-01-01",
    }],
    successorClause: { id: "REQ-b", authority: "approved-requirement", kind: "specification", text: "t", sourceRef: "S-exc", taskRef: "TASK-1" },
    transition: {
      id: "T-1", subject: "REQ-c", action: "supersede", successor: "REQ-b",
      authorityRef: { kind: "user" }, ackRef: { kind: "plan-gate", ref: "R-pg" },
      compatibility: { impact: "no consumers", disposition: "no-affected-dependents" },
    },
  }, OPTS), "E_INITIATING_DP_NOT_APPLICABLE", "successor cannot cover the initiating DP");
  assert.match(e.message, /DP-3/);
  assert.strictEqual(fs.readFileSync(storePath(cwd), "utf8"), before, "no-write assertion: store bytes unchanged");
});

test("SM §2: an exception-grant Source must target a hard-constraint REQ and match its ownerRef", () => {
  const s = withHardConstraint();
  const grant = (over) => ({
    sourceId: "S-exc", contentKind: "exception-grant", driftMode: "snapshot-only", locator: "grant#1",
    excerpt: "scoped exception", targetConstraintRef: "REQ-hc",
    grantAuthorityRef: { kind: "source-authority", ref: "R-owner" }, scope: "eu", expiry: "2099-01-01", ...over,
  });
  assertRejects(() => apply(s, "append-source", { source: grant({ targetConstraintRef: "REQ-a" }) }),
    "E_EXCEPTION_TARGET", "exception targeting an approved-requirement");
  const s2 = apply(s, "append-record", { record: { recordId: "R-imposter", kind: "source-authority", authorityIdentity: "not the owner" } });
  assertRejects(() => apply(s2, "append-source", { source: grant({ grantAuthorityRef: { kind: "source-authority", ref: "R-imposter" } }) }),
    "E_EXCEPTION_OWNER", "exception granted by someone other than the constraint owner");
  assert.ok(apply(s, "append-source", { source: grant({}) }), "a well-formed grant is accepted");
});

test("SM §2/§9: an EXPIRED exception-backed REQ stops being applicable", () => {
  let s = withHardConstraint();
  s = apply(s, "append-source", {
    source: {
      sourceId: "S-exc", contentKind: "exception-grant", driftMode: "snapshot-only", locator: "grant#1",
      excerpt: "scoped exception", targetConstraintRef: "REQ-hc",
      grantAuthorityRef: { kind: "source-authority", ref: "R-owner" }, scope: "eu", expiry: "2020-01-01",
    },
  });
  s = apply(s, "append-record", { record: reviewRuling("R-scope", INTENT, "DP-3") });
  assertRejects(() => apply(s, "create-initial-outcome", {
    dpId: "DP-3",
    scopeRulingRef: { kind: "review-ruling", ref: "R-scope" },
    clause: { id: "REQ-exc", authority: "approved-requirement", kind: "specification", text: "t", sourceRef: "S-exc", taskRef: "TASK-1" },
  }), "E_INV4_NOT_APPLICABLE", "expired exception-backed REQ");
});

test("SM §2: an exception-backed REQ needs a DP-bound intent scope ruling — another DP's ruling cannot be borrowed", () => {
  let s = withHardConstraint();
  s = apply(s, "append-source", {
    source: {
      sourceId: "S-exc", contentKind: "exception-grant", driftMode: "snapshot-only", locator: "grant#1",
      excerpt: "scoped exception", targetConstraintRef: "REQ-hc",
      grantAuthorityRef: { kind: "source-authority", ref: "R-owner" }, scope: "eu", expiry: "2099-01-01",
    },
  });
  const clause = { id: "REQ-exc", authority: "approved-requirement", kind: "specification", text: "t", sourceRef: "S-exc", taskRef: "TASK-1" };

  // no ruling at all
  assertRejects(() => apply(s, "create-initial-outcome", { dpId: "DP-3", clause }),
    "E_INV4_NOT_APPLICABLE", "exception-backed REQ with no scope ruling");

  // a ruling bound to ANOTHER DP
  let s2 = apply(s, "append-record", { record: reviewRuling("R-other", INTENT, "DP-1") });
  assertRejects(() => apply(s2, "create-initial-outcome", {
    dpId: "DP-3", scopeRulingRef: { kind: "review-ruling", ref: "R-other" }, clause,
  }), "E_INV4_NOT_APPLICABLE", "scope ruling bound to a different DP");

  // a ruling by the wrong discipline
  let s3 = apply(s, "append-record", { record: reviewRuling("R-code", CODE, "DP-3") });
  assertRejects(() => apply(s3, "create-initial-outcome", {
    dpId: "DP-3", scopeRulingRef: { kind: "review-ruling", ref: "R-code" }, clause,
  }), "E_INV4_NOT_APPLICABLE", "scope ruling not by intent");

  // the correct, DP-bound intent ruling
  let ok = apply(s, "append-record", { record: reviewRuling("R-scope", INTENT, "DP-3") });
  ok = apply(ok, "create-initial-outcome", {
    dpId: "DP-3", scopeRulingRef: { kind: "review-ruling", ref: "R-scope" }, clause,
  });
  assert.strictEqual(indexStore(ok).dps.get("DP-3").resolvedBy, "REQ-exc");
});

test("IS §8 / AC27: adopt-existing-outcome cites an existing clause and creates neither clause nor Transition", () => {
  let s = baseFixture();
  const before = { clauses: s.clauses.length, transitions: s.transitions.length };
  s = apply(s, "adopt-existing-outcome", { dpId: "DP-2", clauseRef: "REQ-a" });
  assert.strictEqual(s.clauses.length, before.clauses, "no new clause");
  assert.strictEqual(s.transitions.length, before.transitions, "no transition");
  assert.strictEqual(indexStore(s).dps.get("DP-2").resolvedBy, "REQ-a");
});

test("IS §8 / AC31: create-requirement may only mint approved-requirement", () => {
  const s = baseFixture();
  for (const authority of ["hard-constraint", "compatibility"]) {
    assertRejects(() => apply(s, "create-requirement", {
      requirement: { id: "REQ-x", authority, kind: "specification", text: "t", sourceRef: "S-req", taskRef: "TASK-1" },
    }), "E_CREATE_REQ_AUTHORITY", `create-requirement minting ${authority}`);
  }
  assertRejects(() => apply(s, "create-requirement", {
    requirement: { id: "REQ-x", authority: "approved-requirement", kind: "acceptance", text: "t", sourceRef: "S-req", taskRef: "TASK-1" },
  }), "E_PAYLOAD_MISSING", "acceptance REQ without the REQ.acceptance annotation");
});

// --- 5. initial / replace / reopen ----------------------------------------------------------------

test("IS AC10: an initial outcome creates NO Transition", () => {
  const s = withAssumption(CODE);
  assert.strictEqual(s.transitions.length, 0, "no transition for a first outcome");
  assert.strictEqual(indexStore(s).dps.get("DP-1").assumedAs, "ASSUM-a");
});

test("IS AC35: a reopened DP whose prior terminal is still active may NOT use adopt-existing-outcome", () => {
  let s = withAssumption(CODE);
  s = apply(s, "reopen-dp", { dpId: "DP-1", trigger: "new-dependent", expectedCurrentTerminalRef: "ASSUM-a" });
  assertRejects(() => apply(s, "adopt-existing-outcome", { dpId: "DP-1", clauseRef: "REQ-a" }),
    "E_REOPENED_NEEDS_TRANSITION", "adopting while the prior ASSUM is still active");
});

test("IS AC37/40: casMode=current-terminal completes ASSUM→REQ in ONE transaction; the CAS refuses a stale expectation", () => {
  let s = withAssumption(CODE);
  assertRejects(() => apply(s, "replace-terminal", {
    dpId: "DP-1", casMode: "current-terminal", expectedCurrentTerminalRef: "ASSUM-wrong",
    records: [planGate("R-pg", "ASSUM-a")],
    transition: {
      id: "T-1", subject: "ASSUM-wrong", action: "supersede", successor: "REQ-a",
      authorityRef: { kind: "user" }, ackRef: { kind: "plan-gate", ref: "R-pg" },
    },
  }), "E_CAS_TERMINAL", "wrong expected current terminal");

  const ok = apply(s, "replace-terminal", {
    dpId: "DP-1", casMode: "current-terminal", expectedCurrentTerminalRef: "ASSUM-a",
    records: [planGate("R-pg", "ASSUM-a")],
    transition: {
      id: "T-1", subject: "ASSUM-a", action: "supersede", successor: "REQ-a",
      authorityRef: { kind: "user" }, ackRef: { kind: "plan-gate", ref: "R-pg" },
    },
  });
  assert.strictEqual(indexStore(ok).dps.get("DP-1").resolvedBy, "REQ-a");
  assert.strictEqual(ok.transitions.length, 1);
});

test("IS AC40: a persisted reopen converges via casMode=reopened-prior; current-terminal is refused there", () => {
  let s = withAssumption(CODE);
  s = apply(s, "reopen-dp", { dpId: "DP-1", trigger: "new-applicable-binding-authority", expectedCurrentTerminalRef: "ASSUM-a" });
  const d = indexStore(s).dps.get("DP-1");
  assert.strictEqual(d.status, "open");
  assert.strictEqual(d.priorTerminalRef, "ASSUM-a");

  // current-terminal cannot work here: the current terminal is already null.
  assertRejects(() => apply(s, "replace-terminal", {
    dpId: "DP-1", casMode: "current-terminal", expectedCurrentTerminalRef: "ASSUM-a",
    records: [planGate("R-pg", "ASSUM-a")],
    transition: {
      id: "T-1", subject: "ASSUM-a", action: "supersede", successor: "REQ-a",
      authorityRef: { kind: "user" }, ackRef: { kind: "plan-gate", ref: "R-pg" },
    },
  }), "E_CAS_TERMINAL", "current-terminal mode after a persisted reopen");

  // prior-terminal CAS must also match.
  assertRejects(() => apply(s, "replace-terminal", {
    dpId: "DP-1", casMode: "reopened-prior", expectedPriorTerminalRef: "ASSUM-nope",
    records: [planGate("R-pg", "ASSUM-a")],
    transition: {
      id: "T-1", subject: "ASSUM-nope", action: "supersede", successor: "REQ-a",
      authorityRef: { kind: "user" }, ackRef: { kind: "plan-gate", ref: "R-pg" },
    },
  }), "E_CAS_PRIOR_TERMINAL", "wrong expected prior terminal");

  const ok = apply(s, "replace-terminal", {
    dpId: "DP-1", casMode: "reopened-prior", expectedPriorTerminalRef: "ASSUM-a",
    records: [planGate("R-pg", "ASSUM-a")],
    transition: {
      id: "T-1", subject: "ASSUM-a", action: "supersede", successor: "REQ-a",
      authorityRef: { kind: "user" }, ackRef: { kind: "plan-gate", ref: "R-pg" },
    },
  });
  const index = indexStore(ok);
  assert.strictEqual(statusOf(index, "ASSUM-a"), "superseded", "the old ASSUM leaves active state");
  assert.strictEqual(index.dps.get("DP-1").resolvedBy, "REQ-a");
});

test("IS §8: reopen-dp refuses a trigger outside the closed list, and refuses a DP with no terminal", () => {
  const s = withAssumption(CODE);
  assertRejects(() => apply(s, "reopen-dp", { dpId: "DP-1", trigger: "because-i-said-so", expectedCurrentTerminalRef: "ASSUM-a" }),
    "E_REOPEN_TRIGGER", "trigger outside the closed list");
  assertRejects(() => apply(s, "reopen-dp", { dpId: "DP-3", trigger: "user-instruction", expectedCurrentTerminalRef: null }),
    "E_DP_NO_TERMINAL", "reopening an already-open DP");
});

test("SM §2: a clause may carry at most ONE effective transition (merge reconciliation)", () => {
  let s = withAssumption(CODE);
  s = apply(s, "replace-terminal", {
    dpId: "DP-1", casMode: "current-terminal", expectedCurrentTerminalRef: "ASSUM-a",
    records: [reviewRuling("R-1", CODE, "ASSUM-a")],
    transition: {
      id: "T-1", subject: "ASSUM-a", action: "retire", successor: null,
      authorityRef: CODE, ackRef: { kind: "review-ruling", ref: "R-1" },
    },
  });
  const doubled = { ...s, transitions: [...s.transitions, { ...s.transitions[0], id: "T-2" }] };
  assertRejects(() => validateAll(doubled, OPTS), "E_MULTIPLE_TRANSITIONS", "two transitions on one subject");
});

// --- 6. TaskState & base provenance ---------------------------------------------------------------

test("IS AC51/56: init-task writes a tracked TaskState readable from a fresh load (no scratch involved)", () => {
  const cwd = temporary("prov-task-");
  runTransaction(cwd, "init-task", {
    taskId: "TASK-1", baseProvenance: BASE,
    decisionPoints: [dp("DP-1")], currentTaskDpIds: ["DP-1"],
  }, OPTS);
  const reloaded = loadStore(cwd).store;
  const ts = reloaded.taskStates[0];
  assert.strictEqual(ts.taskId, "TASK-1");
  assert.deepStrictEqual(ts.currentTaskDpIds, ["DP-1"]);
  assert.deepStrictEqual(ts.baseProvenance, BASE);
  assert.strictEqual(ts.committedProvenanceBatchRef, null);
});

test("IS AC51 / SM ㉑: resume-task may add membership but may never reseat baseProvenance or drop members", () => {
  let s = baseFixture();
  s = apply(s, "resume-task", { taskId: "TASK-1", decisionPoints: [dp("DP-4")], addDpIds: ["DP-4"] });
  assert.deepStrictEqual(indexStore(s).taskStates.get("TASK-1").currentTaskDpIds, ["DP-1", "DP-2", "DP-3", "DP-4"]);

  assertRejects(() => apply(s, "resume-task", { taskId: "TASK-1", baseProvenance: { ...BASE, treeOid: "b".repeat(40) } }),
    "E_BASE_IMMUTABLE", "reseating the base");
  assertRejects(() => apply(s, "resume-task", { taskId: "TASK-1", currentTaskDpIds: ["DP-1"] }),
    "E_MEMBERSHIP_SHRINK", "dropping members");
  assertRejects(() => apply(s, "resume-task", { taskId: "TASK-nope" }), "E_UNKNOWN_TASK", "unknown task");
});

test("SM §9: baseProvenance must carry treeOid/storePath/storeDigest, and the empty-store digest is reproducible", () => {
  assertRejects(() => apply(emptyStore(), "init-task", { taskId: "T", baseProvenance: { treeOid: "x" } }),
    "E_SHAPE", "incomplete base witness");
  // The canonical empty store's digest is what a treeOid with no store file yields.
  assert.strictEqual(BASE.storeDigest, storeDigest(emptyStore()));
  assert.strictEqual(storeDigest(emptyStore()), sha256Hex(canonicalStoreBytes(emptyStore())));
});

// --- 7. batch chain & head three-state -------------------------------------------------------------

function batchPayload(over = {}) {
  return {
    taskId: "TASK-1", batchRecordId: "R-b1", inventoryDigest: "inv-1",
    batchSnapshot: { taskId: "TASK-1", results: [] }, resolutions: [], ...over,
  };
}

test("SM §2 head three-state: zero batches with a null committed ref is legitimate, not a failure", () => {
  const s = baseFixture();
  assert.strictEqual(indexStore(s).taskStates.get("TASK-1").committedProvenanceBatchRef, null);
  assert.ok(validateAll(s, OPTS).ok, "an un-submitted task validates");
});

test("SM §2 head three-state: a committed ref with no batches fails closed", () => {
  const s = baseFixture();
  const broken = {
    ...s,
    taskStates: [{ ...s.taskStates[0], committedProvenanceBatchRef: { kind: "provenance-batch", ref: "R-ghost" } }],
  };
  assertRejects(() => validateAll(broken, OPTS), "E_DANGLING_REF", "committed ref with no batch");
});

test("IS AC46(i): a clean batch commits with resolutions=[] and invents NO Transition", () => {
  let s = baseFixture();
  s = apply(s, "commit-test-provenance-batch", batchPayload());
  const index = indexStore(s);
  assert.strictEqual(s.transitions.length, 0, "clean batch must not fabricate a transition");
  const batch = index.records.get("R-b1");
  assert.strictEqual(batch.previousBatchRef, null, "first batch chains to null");
  assert.deepStrictEqual(index.taskStates.get("TASK-1").committedProvenanceBatchRef, { kind: "provenance-batch", ref: "R-b1" });
  assert.strictEqual(batch.batchDigest, digestOf(batch.batchSnapshot));
});

test("SM §2 / IS AC49: a second batch chains to the pre-state head and the head advances atomically", () => {
  let s = baseFixture();
  s = apply(s, "commit-test-provenance-batch", batchPayload());
  s = apply(s, "commit-test-provenance-batch", batchPayload({ batchRecordId: "R-b2", inventoryDigest: "inv-2" }));
  const index = indexStore(s);
  assert.deepStrictEqual(index.records.get("R-b2").previousBatchRef, { kind: "provenance-batch", ref: "R-b1" });
  assert.deepStrictEqual(index.taskStates.get("TASK-1").committedProvenanceBatchRef, { kind: "provenance-batch", ref: "R-b2" });
});

test("IS AC49: an explicitly wrong previousBatchRef (stale non-head) is refused", () => {
  let s = baseFixture();
  s = apply(s, "commit-test-provenance-batch", batchPayload());
  s = apply(s, "commit-test-provenance-batch", batchPayload({ batchRecordId: "R-b2", inventoryDigest: "inv-2" }));
  assertRejects(() => apply(s, "commit-test-provenance-batch", batchPayload({
    batchRecordId: "R-b3", inventoryDigest: "inv-3",
    previousBatchRef: { kind: "provenance-batch", ref: "R-b1" }, // the historical non-head
  })), "E_CHAIN_LINK", "chaining to a stale non-head");
});

test("SM §2: a cross-task previousBatchRef and a multi-tip chain both fail closed at load", () => {
  let s = baseFixture();
  s = apply(s, "init-task", { taskId: "TASK-2", baseProvenance: BASE });
  s = apply(s, "commit-test-provenance-batch", batchPayload());
  // Hand-craft the broken shapes and run them through the SAME validateAll a load would use.
  const crossTask = {
    ...s,
    records: [...s.records, {
      recordId: "R-b9", kind: "provenance-batch", taskId: "TASK-2", inventoryDigest: "i",
      batchSnapshot: {}, batchDigest: digestOf({}), relatedRefs: [],
      previousBatchRef: { kind: "provenance-batch", ref: "R-b1" },
    }],
    taskStates: s.taskStates.map((t) => t.taskId === "TASK-2"
      ? { ...t, committedProvenanceBatchRef: { kind: "provenance-batch", ref: "R-b9" } } : t),
  };
  assertRejects(() => validateAll(crossTask, OPTS), "E_CHAIN_CROSS_TASK", "chain crossing tasks");

  const twoTips = {
    ...s,
    records: [...s.records, {
      recordId: "R-b8", kind: "provenance-batch", taskId: "TASK-1", inventoryDigest: "i",
      batchSnapshot: {}, batchDigest: digestOf({}), relatedRefs: [], previousBatchRef: null,
    }],
  };
  assertRejects(() => validateAll(twoTips, OPTS), "E_HEAD_STATE", "two chain tips");
});

test("IS AC45: after deleting all scratch, the batch content is fully rebuildable from the tracked chain", () => {
  const cwd = temporary("prov-rebuild-");
  runTransaction(cwd, "init-task", { taskId: "TASK-1", baseProvenance: BASE }, OPTS);
  runTransaction(cwd, "commit-test-provenance-batch",
    batchPayload({ batchSnapshot: { taskId: "TASK-1", results: [{ testRef: { path: "a", adapterId: "b", structuralId: "c" }, findings: [] }] } }), OPTS);
  fs.rmSync(path.join(cwd, ".ctide", "output"), { recursive: true, force: true }); // scratch is gone
  const store = loadStore(cwd).store;
  const index = indexStore(store);
  const head = index.taskStates.get("TASK-1").committedProvenanceBatchRef;
  const batch = index.records.get(head.ref);
  assert.deepStrictEqual(batch.batchSnapshot.results[0].testRef, { path: "a", adapterId: "b", structuralId: "c" });
  assert.strictEqual(batch.batchDigest, digestOf(batch.batchSnapshot), "the snapshot, not just a digest, survives");
});

// --- 8. commit-test-provenance-batch ---------------------------------------------------------------

// One subject with N sibling evidence refs sharing ONE transition.
function siblingBatch(evidenceIds, witnessId = "R-w") {
  const evidence = evidenceIds.map((id) => ({ kind: "review-ruling", ref: id }));
  const digest = resolutionGroupDigest({
    subjectRef: "ASSUM-a", action: "retire", successor: null, semanticEvidenceRefs: evidence,
  });
  return {
    recordsToCreate: [
      ...evidenceIds.map((id) => reviewRuling(id, { kind: "discipline", discipline: "test" }, "ASSUM-a")),
      reviewRuling(witnessId, CODE, "ASSUM-a", { resolutionGroupDigest: digest }),
    ],
    resolutions: evidenceIds.map((id) => ({
      subjectRef: "ASSUM-a",
      semanticEvidenceRefs: [{ kind: "review-ruling", ref: id }],
      governanceWitnessRef: { kind: "review-ruling", ref: witnessId },
      transitionDraft: {
        id: "T-b", subject: "ASSUM-a", action: "retire", successor: null,
        authorityRef: CODE, ackRef: { kind: "review-ruling", ref: witnessId },
      },
    })),
  };
}

test("IS AC46(iii)/55: three sibling findings on one subject share ONE transition; the snapshot holds transitionRef", () => {
  let s = withAssumption(CODE);
  s = apply(s, "commit-test-provenance-batch", batchPayload(siblingBatch(["R-e1", "R-e2", "R-e3"])));
  const index = indexStore(s);
  assert.strictEqual(s.transitions.length, 1, "one transition for the subject");
  const groups = index.records.get("R-b1").batchSnapshot.resolutions;
  assert.strictEqual(groups.length, 1, "siblings collapse into one persisted group");
  assert.strictEqual(groups[0].transitionRef, "T-b", "persisted shape uses transitionRef, not transitionDraft");
  assert.strictEqual(groups[0].semanticEvidenceRefs.length, 3, "all three evidence refs are kept");
  assert.strictEqual(indexStore(s).dps.get("DP-1").status, "open", "the dependent DP reopened on retire");
});

test("IS AC46(ii): two different subjects produce two groups and two transitions", () => {
  let s = withAssumption(CODE);
  s = apply(s, "create-initial-outcome", {
    dpId: "DP-2",
    clause: {
      id: "ASSUM-c", layer: "implementation", derivedFrom: "DP-2", text: "t", alternative: "u",
      basis: "b", basisRefs: [], governedBy: CODE,
    },
  });
  const mk = (subject, evId, wId, tId) => {
    const evidence = [{ kind: "review-ruling", ref: evId }];
    const digest = resolutionGroupDigest({ subjectRef: subject, action: "retire", successor: null, semanticEvidenceRefs: evidence });
    return {
      records: [
        reviewRuling(evId, { kind: "discipline", discipline: "test" }, subject),
        reviewRuling(wId, CODE, subject, { resolutionGroupDigest: digest }),
      ],
      group: {
        subjectRef: subject, semanticEvidenceRefs: evidence,
        governanceWitnessRef: { kind: "review-ruling", ref: wId },
        transitionDraft: { id: tId, subject, action: "retire", successor: null, authorityRef: CODE, ackRef: { kind: "review-ruling", ref: wId } },
      },
    };
  };
  const a = mk("ASSUM-a", "R-e1", "R-w1", "T-a");
  const c = mk("ASSUM-c", "R-e2", "R-w2", "T-c");
  s = apply(s, "commit-test-provenance-batch", batchPayload({
    recordsToCreate: [...a.records, ...c.records], resolutions: [a.group, c.group],
  }));
  assert.strictEqual(s.transitions.length, 2);
  assert.strictEqual(indexStore(s).records.get("R-b1").batchSnapshot.resolutions.length, 2);
});

test("IS AC47: two groups demanding different actions for one subject reject the whole batch (no write)", () => {
  const cwd = temporary("prov-conflict-");
  let s = withAssumption(CODE);
  fs.mkdirSync(path.dirname(storePath(cwd)), { recursive: true });
  fs.writeFileSync(storePath(cwd), canonicalStoreBytes(s), "utf8");
  const before = fs.readFileSync(storePath(cwd), "utf8");
  const ev = (id) => ({ kind: "review-ruling", ref: id });
  assertRejects(() => runTransaction(cwd, "commit-test-provenance-batch", batchPayload({
    recordsToCreate: [
      reviewRuling("R-e1", { kind: "discipline", discipline: "test" }, "ASSUM-a"),
      reviewRuling("R-w", CODE, "ASSUM-a", { resolutionGroupDigest: "x" }),
    ],
    resolutions: [
      { subjectRef: "ASSUM-a", semanticEvidenceRefs: [ev("R-e1")], governanceWitnessRef: ev("R-w"), transitionDraft: { id: "T-1", subject: "ASSUM-a", action: "retire", successor: null, authorityRef: CODE, ackRef: ev("R-w") } },
      { subjectRef: "ASSUM-a", semanticEvidenceRefs: [ev("R-e1")], governanceWitnessRef: ev("R-w"), transitionDraft: { id: "T-2", subject: "ASSUM-a", action: "revise", successor: "ASSUM-x", authorityRef: CODE, ackRef: ev("R-w") } },
    ],
  }), OPTS), "E_SUBJECT_CONFLICT", "conflicting demands on one subject");
  assert.strictEqual(fs.readFileSync(storePath(cwd), "utf8"), before, "no-write assertion");
});

test("IS AC50: a resolution ref that is in neither pre-state nor recordsToCreate fails closed", () => {
  const s = withAssumption(CODE);
  assertRejects(() => apply(s, "commit-test-provenance-batch", batchPayload({
    recordsToCreate: [],
    resolutions: [{
      subjectRef: "ASSUM-a",
      semanticEvidenceRefs: [{ kind: "review-ruling", ref: "R-ghost" }],
      governanceWitnessRef: { kind: "review-ruling", ref: "R-ghost2" },
      transitionDraft: { id: "T-1", subject: "ASSUM-a", action: "retire", successor: null, authorityRef: CODE, ackRef: { kind: "review-ruling", ref: "R-ghost2" } },
    }],
  })), "E_REF_UNRESOLVABLE", "refs with no draft payload");
});

test("IS AC48/52: a witness whose resolutionGroupDigest omits a sibling is refused", () => {
  let s = withAssumption(CODE);
  const evidence = [{ kind: "review-ruling", ref: "R-e1" }, { kind: "review-ruling", ref: "R-e2" }];
  const shortDigest = resolutionGroupDigest({
    subjectRef: "ASSUM-a", action: "retire", successor: null,
    semanticEvidenceRefs: [evidence[0]], // one sibling missing
  });
  assertRejects(() => apply(s, "commit-test-provenance-batch", batchPayload({
    recordsToCreate: [
      reviewRuling("R-e1", { kind: "discipline", discipline: "test" }, "ASSUM-a"),
      reviewRuling("R-e2", { kind: "discipline", discipline: "test" }, "ASSUM-a"),
      reviewRuling("R-w", CODE, "ASSUM-a", { resolutionGroupDigest: shortDigest }),
    ],
    resolutions: evidence.map((e) => ({
      subjectRef: "ASSUM-a", semanticEvidenceRefs: [e],
      governanceWitnessRef: { kind: "review-ruling", ref: "R-w" },
      transitionDraft: { id: "T-b", subject: "ASSUM-a", action: "retire", successor: null, authorityRef: CODE, ackRef: { kind: "review-ruling", ref: "R-w" } },
    })),
  })), "E_WITNESS_COVERAGE", "witness missing a sibling");
});

test("IS AC53: relatedRefs must equal the derived set (recordsToCreate ∪ resolution refs ∪ transitions)", () => {
  let s = withAssumption(CODE);
  const good = siblingBatch(["R-e1"]);
  // The transaction derives relatedRefs itself; supplying a different set is refused.
  assertRejects(() => apply(s, "commit-test-provenance-batch", batchPayload({
    ...good, relatedRefs: [{ kind: "review-ruling", ref: "R-e1" }],
  })), "E_RELATED_REFS", "hand-supplied relatedRefs that do not match");

  const ok = apply(s, "commit-test-provenance-batch", batchPayload(good));
  const derived = indexStore(ok).records.get("R-b1").relatedRefs;
  assert.deepStrictEqual(derived, sortTypedRefs(derived), "relatedRefs are sorted and deduplicated");
  assert.ok(derived.some((r) => r.kind === "transition" && r.ref === "T-b"), "the transition ref is included");
  assert.ok(derived.some((r) => r.ref === "R-e1"), "evidence refs are included");
  assert.ok(derived.some((r) => r.ref === "R-w"), "the witness ref is included");
});

test("SM §9: a batch whose baseProvenance disagrees with the tracked TaskState witness is refused", () => {
  const s = baseFixture();
  assertRejects(() => apply(s, "commit-test-provenance-batch", batchPayload({
    baseProvenance: { ...BASE, treeOid: "c".repeat(40) },
  })), "E_BASE_MISMATCH", "batch witness disagreeing with TaskState");
});

test("IS AC44: the whole batch lands in ONE transaction — a late validation failure writes nothing", () => {
  const cwd = temporary("prov-batch-atomic-");
  let s = withAssumption(CODE);
  fs.mkdirSync(path.dirname(storePath(cwd)), { recursive: true });
  fs.writeFileSync(storePath(cwd), canonicalStoreBytes(s), "utf8");
  const before = fs.readFileSync(storePath(cwd), "utf8");
  // The witness principal is wrong, which only surfaces in the final-snapshot matrix check —
  // after evidence, witness, transition and DP closure have all been applied in memory.
  const evidence = [{ kind: "review-ruling", ref: "R-e1" }];
  const digest = resolutionGroupDigest({ subjectRef: "ASSUM-a", action: "retire", successor: null, semanticEvidenceRefs: evidence });
  assertRejects(() => runTransaction(cwd, "commit-test-provenance-batch", batchPayload({
    recordsToCreate: [
      reviewRuling("R-e1", { kind: "discipline", discipline: "test" }, "ASSUM-a"),
      reviewRuling("R-w", SECURITY, "ASSUM-a", { resolutionGroupDigest: digest }),
    ],
    resolutions: [{
      subjectRef: "ASSUM-a", semanticEvidenceRefs: evidence,
      governanceWitnessRef: { kind: "review-ruling", ref: "R-w" },
      transitionDraft: { id: "T-b", subject: "ASSUM-a", action: "retire", successor: null, authorityRef: SECURITY, ackRef: { kind: "review-ruling", ref: "R-w" } },
    }],
  }), OPTS), "E_MATRIX_AUTHORITY", "security retiring a code-governed ASSUM");
  assert.strictEqual(fs.readFileSync(storePath(cwd), "utf8"), before, "nothing written");
});

// --- CLI boundary ------------------------------------------------------------------------------

test("IS §8: the CLI exits non-zero with a typed code on rejection and zero on success (fail-closed)", () => {
  const cwd = temporary("prov-cli-");
  const script = path.join(root, "cressetide", "skills", "vigil", "scripts", "provenance-store.mjs");
  const call = (payload, command = "init-task") => spawnSync(process.execPath,
    [script, command, "--cwd", cwd, "--payload", JSON.stringify(payload)], { encoding: "utf8" });

  const ok = call({ taskId: "TASK-1", baseProvenance: BASE });
  assert.strictEqual(ok.status, 0, ok.stderr);
  assert.strictEqual(JSON.parse(ok.stdout).ok, true);

  const dup = call({ taskId: "TASK-1", baseProvenance: BASE });
  assert.strictEqual(dup.status, 1, "a rejected transaction exits non-zero");
  const err = JSON.parse(dup.stderr);
  assert.strictEqual(err.ok, false);
  assert.strictEqual(err.code, "E_TASK_EXISTS");

  const unknown = call({}, "no-such-command");
  assert.strictEqual(unknown.status, 1);
  assert.strictEqual(JSON.parse(unknown.stderr).code, "E_UNKNOWN_COMMAND");
});

test("IS §8: `validate` is read-only — it reports on a healthy store and never rewrites it", () => {
  const cwd = temporary("prov-validate-");
  runTransaction(cwd, "init-task", { taskId: "TASK-1", baseProvenance: BASE }, OPTS);
  const before = fs.readFileSync(storePath(cwd), "utf8");
  const result = runTransaction(cwd, "validate", {}, OPTS);
  assert.strictEqual(result.changed, false);
  assert.strictEqual(fs.readFileSync(storePath(cwd), "utf8"), before);
});

// --- ULID ---------------------------------------------------------------------------------------

test("IS §8: minted ids are 26-char Crockford ULIDs whose time prefix is monotonic", () => {
  const early = encodeUlidTime(1000);
  const late = encodeUlidTime(2000);
  assert.strictEqual(early.length, 10);
  assert.ok(late > early, "the time prefix sorts chronologically");
  const id = ulid(NOW);
  assert.strictEqual(id.length, 26);
  assert.match(id, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.notStrictEqual(ulid(NOW), ulid(NOW), "randomness distinguishes ids minted in the same ms");
});

test("clauseKindOf routes ids by prefix and rejects anything else", () => {
  assert.strictEqual(clauseKindOf("REQ-01J"), "REQ");
  assert.strictEqual(clauseKindOf("DEC-01J"), "DEC");
  assert.strictEqual(clauseKindOf("ASSUM-01J"), "ASSUM");
  assert.strictEqual(clauseKindOf("DP-01J"), null);
});
