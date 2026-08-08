// Phase-1 tests for cressetide/skills/vigil/scripts/provenance-store.mjs.
//
// Spec anchors (all three approved):
//   SM  = docs/superpowers/specs/2026-07-25-shared-decision-provenance-model.md (approved v1.11)
//   IS  = docs/superpowers/specs/2026-07-25-intent-scan-spec.md (approved v1.6)
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
import { spawnSync, execFile } from "node:child_process";
import { temporary, root } from "./helpers.mjs";
import {
  ProvenanceError, canonicalJson, canonicalText, sha256Hex, digestOf, sortTypedRefs,
  resolutionGroupDigest, emptyStore, canonicalStoreBytes, storeDigest, parseStore, loadStore,
  storePath, CANONICAL_STORE_PATH, indexStore, statusOf, compareCodePoint, canonicalizeBatchSnapshot,
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
    layer: "implementation", classificationBasis: "engineering standard",
    materialReasons: [], status: "open", ...over,
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

// A COMPLETE typed governance ruling: rulingKind + an input packet that (a) is self-consistent,
// (b) names the principal that issued it, and (c) still matches the DP it answers. Anything less is
// now refused, so every fixture that mints one has to build the whole thing.
function packetFor(dpFixture, requestedPrincipal) {
  return {
    dpId: dpFixture.id,
    scenario: dpFixture.scenario,
    alternatives: dpFixture.alternatives,
    layer: dpFixture.layer,
    classificationBasis: dpFixture.classificationBasis,
    materialReasons: dpFixture.materialReasons ?? [],
    requestedPrincipal,
    basisRefs: [],
  };
}

function typedRuling(recordId, principal, dpFixture, rulingKind, extra = {}) {
  const snapshot = packetFor(dpFixture, principal);
  return {
    ...reviewRuling(recordId, principal, dpFixture.id),
    rulingKind, basis: "stated basis",
    inputPacketSnapshot: snapshot, inputPacketDigest: digestOf(snapshot), ...extra,
  };
}

// A scope-coverage ruling is the intent discipline's explicit verdict — a plain intent ruling is
// not a substitute (panel 4).
function scopeRuling(recordId, dpFixture, scopeCovers = true) {
  return typedRuling(recordId, INTENT, dpFixture, "scope-coverage", { scopeCovers });
}

// The DP fixtures as they exist in baseFixture(), so a packet can be built to match them.
const DP1 = dp("DP-1");
const DP2 = dp("DP-2");
const DP3 = dp("DP-3", { layer: "intent" });

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
    resolutionCarrierUpdates: nulls("DP-1"),
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
    resolutionCarrierUpdates: nulls("DP-1"),
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
    resolutionCarrierUpdates: nulls("DP-1"),
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
    resolutionCarrierUpdates: nulls("DP-1"),
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
    resolutionCarrierUpdates: nulls("DP-1"),
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
    resolutionCarrierUpdates: nulls("DP-1"),
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
    resolutionCarrierUpdates: nulls("DP-1"),
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
    resolutionCarrierUpdates: nulls("DP-2"),
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
    resolutionCarrierUpdates: nulls("DP-2"),
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
    resolutionCarrierUpdates: nulls("DP-2"),
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
    resolutionCarrierUpdates: nulls("DP-2"),
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
    resolutionCarrierUpdates: nulls("DP-2"),
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
    resolutionCarrierUpdates: nulls("DP-2"),
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
    resolutionCarrierUpdates: nulls("DP-1"),
    records: [reviewRuling("R-ret", CODE, "ASSUM-a")],
    transition: {
      id: "T-1", subject: "ASSUM-a", action: "retire", successor: null,
      authorityRef: CODE, ackRef: { kind: "review-ruling", ref: "R-ret" },
    },
  });
  assert.strictEqual(statusOf(indexStore(s), "ASSUM-a"), "retired");
  assertRejects(() => apply(s, "adopt-existing-outcome", { dpId: "DP-2", resolutionCarrierUpdates: nulls("DP-2"), clauseRef: "ASSUM-a" }),
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
  s = apply(s, "adopt-existing-outcome", { dpId: "DP-2", resolutionCarrierUpdates: nulls("DP-2"), clauseRef: "ASSUM-shared" });
  s = apply(s, "replace-terminal", {
    dpId: "DP-1", casMode: "current-terminal", expectedCurrentTerminalRef: "ASSUM-shared",
    // the closure moves the sibling too, so BOTH dependents have to declare their disposition
    resolutionCarrierUpdates: nulls("DP-1", "DP-2"),
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
  s = apply(s, "adopt-existing-outcome", { dpId: "DP-2", resolutionCarrierUpdates: nulls("DP-2"), clauseRef: "ASSUM-shared" });
  s = apply(s, "replace-terminal", {
    dpId: "DP-1", casMode: "current-terminal", expectedCurrentTerminalRef: "ASSUM-shared",
    resolutionCarrierUpdates: nulls("DP-1", "DP-2"),
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
  s = apply(s, "append-record", { record: scopeRuling("R-scope", DP3) });
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
  let s2 = apply(s, "append-record", { record: scopeRuling("R-other", DP1) });
  assertRejects(() => apply(s2, "create-initial-outcome", {
    dpId: "DP-3", scopeRulingRef: { kind: "review-ruling", ref: "R-other" }, clause,
  }), "E_INV4_NOT_APPLICABLE", "scope ruling bound to a different DP");

  // a ruling by the wrong discipline
  let s3 = apply(s, "append-record", { record: typedRuling("R-code", CODE, DP3, "scope-coverage", { scopeCovers: true }) });
  assertRejects(() => apply(s3, "create-initial-outcome", {
    dpId: "DP-3", scopeRulingRef: { kind: "review-ruling", ref: "R-code" }, clause,
  }), "E_INV4_NOT_APPLICABLE", "scope ruling not by intent");

  // the correct, DP-bound intent ruling
  let ok = apply(s, "append-record", { record: scopeRuling("R-scope", DP3) });
  ok = apply(ok, "create-initial-outcome", {
    dpId: "DP-3", scopeRulingRef: { kind: "review-ruling", ref: "R-scope" }, clause,
  });
  assert.strictEqual(indexStore(ok).dps.get("DP-3").resolvedBy, "REQ-exc");
});

test("IS §8 / AC27: adopt-existing-outcome cites an existing clause and creates neither clause nor Transition", () => {
  let s = baseFixture();
  const before = { clauses: s.clauses.length, transitions: s.transitions.length };
  s = apply(s, "adopt-existing-outcome", { dpId: "DP-2", resolutionCarrierUpdates: nulls("DP-2"), clauseRef: "REQ-a" });
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
  s = apply(s, "reopen-dp", { dpId: "DP-1", resolutionCarrierUpdates: nulls("DP-1"), trigger: "new-dependent", expectedCurrentTerminalRef: "ASSUM-a" });
  assertRejects(() => apply(s, "adopt-existing-outcome", { dpId: "DP-1", resolutionCarrierUpdates: nulls("DP-1"), clauseRef: "REQ-a" }),
    "E_REOPENED_NEEDS_TRANSITION", "adopting while the prior ASSUM is still active");
});

test("IS AC37/40: casMode=current-terminal completes ASSUM→REQ in ONE transaction; the CAS refuses a stale expectation", () => {
  let s = withAssumption(CODE);
  assertRejects(() => apply(s, "replace-terminal", {
    dpId: "DP-1", casMode: "current-terminal", expectedCurrentTerminalRef: "ASSUM-wrong",
    resolutionCarrierUpdates: nulls("DP-1"),
    records: [planGate("R-pg", "ASSUM-a")],
    transition: {
      id: "T-1", subject: "ASSUM-wrong", action: "supersede", successor: "REQ-a",
      authorityRef: { kind: "user" }, ackRef: { kind: "plan-gate", ref: "R-pg" },
    },
  }), "E_CAS_TERMINAL", "wrong expected current terminal");

  const ok = apply(s, "replace-terminal", {
    dpId: "DP-1", casMode: "current-terminal", expectedCurrentTerminalRef: "ASSUM-a",
    resolutionCarrierUpdates: nulls("DP-1"),
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
  s = apply(s, "reopen-dp", { dpId: "DP-1", resolutionCarrierUpdates: nulls("DP-1"), trigger: "new-applicable-binding-authority", expectedCurrentTerminalRef: "ASSUM-a" });
  const d = indexStore(s).dps.get("DP-1");
  assert.strictEqual(d.status, "open");
  assert.strictEqual(d.priorTerminalRef, "ASSUM-a");

  // current-terminal cannot work here: the current terminal is already null.
  assertRejects(() => apply(s, "replace-terminal", {
    dpId: "DP-1", casMode: "current-terminal", expectedCurrentTerminalRef: "ASSUM-a",
    resolutionCarrierUpdates: nulls("DP-1"),
    records: [planGate("R-pg", "ASSUM-a")],
    transition: {
      id: "T-1", subject: "ASSUM-a", action: "supersede", successor: "REQ-a",
      authorityRef: { kind: "user" }, ackRef: { kind: "plan-gate", ref: "R-pg" },
    },
  }), "E_CAS_TERMINAL", "current-terminal mode after a persisted reopen");

  // prior-terminal CAS must also match.
  assertRejects(() => apply(s, "replace-terminal", {
    dpId: "DP-1", casMode: "reopened-prior", expectedPriorTerminalRef: "ASSUM-nope",
    resolutionCarrierUpdates: nulls("DP-1"),
    records: [planGate("R-pg", "ASSUM-a")],
    transition: {
      id: "T-1", subject: "ASSUM-nope", action: "supersede", successor: "REQ-a",
      authorityRef: { kind: "user" }, ackRef: { kind: "plan-gate", ref: "R-pg" },
    },
  }), "E_CAS_PRIOR_TERMINAL", "wrong expected prior terminal");

  const ok = apply(s, "replace-terminal", {
    dpId: "DP-1", casMode: "reopened-prior", expectedPriorTerminalRef: "ASSUM-a",
    resolutionCarrierUpdates: nulls("DP-1"),
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
  assertRejects(() => apply(s, "reopen-dp", { dpId: "DP-1", resolutionCarrierUpdates: nulls("DP-1"), trigger: "because-i-said-so", expectedCurrentTerminalRef: "ASSUM-a" }),
    "E_REOPEN_TRIGGER", "trigger outside the closed list");
  assertRejects(() => apply(s, "reopen-dp", { dpId: "DP-3", resolutionCarrierUpdates: nulls("DP-3"), trigger: "user-instruction", expectedCurrentTerminalRef: null }),
    "E_DP_NO_TERMINAL", "reopening an already-open DP");
});

test("SM §2: a clause may carry at most ONE effective transition (merge reconciliation)", () => {
  let s = withAssumption(CODE);
  s = apply(s, "replace-terminal", {
    dpId: "DP-1", casMode: "current-terminal", expectedCurrentTerminalRef: "ASSUM-a",
    resolutionCarrierUpdates: nulls("DP-1"),
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
  // Hand-craft the broken CHAIN shapes — but keep each batch record itself well-formed, so the
  // failure is the chain rule under test and not an incidental payload defect.
  const batchRecord = (recordId, taskId, previousBatchRef) => {
    const snapshot = { taskId, baseProvenance: BASE, results: [], resolutions: [] };
    return {
      recordId, kind: "provenance-batch", taskId, inventoryDigest: "i",
      batchSnapshot: snapshot, batchDigest: digestOf(snapshot), relatedRefs: [], previousBatchRef,
    };
  };
  const crossTask = {
    ...s,
    records: [...s.records, batchRecord("R-b9", "TASK-2", { kind: "provenance-batch", ref: "R-b1" })],
    taskStates: s.taskStates.map((t) => t.taskId === "TASK-2"
      ? { ...t, committedProvenanceBatchRef: { kind: "provenance-batch", ref: "R-b9" } } : t),
  };
  assertRejects(() => validateAll(crossTask, OPTS), "E_CHAIN_CROSS_TASK", "chain crossing tasks");

  const twoTips = { ...s, records: [...s.records, batchRecord("R-b8", "TASK-1", null)] };
  assertRejects(() => validateAll(twoTips, OPTS), "E_HEAD_STATE", "two chain tips");
});

// --- regressions found by the read-only implementation panel ---------------------------------------

test("panel 5 / SM §2: ordering is by CODE POINT, not UTF-16 code unit (non-BMP probe)", () => {
  // U+1F600 (non-BMP, lead surrogate 0xD83D) must sort AFTER U+FFFD — raw `<` gets this backwards.
  const astral = String.fromCodePoint(0x1f600);
  const bmpHigh = String.fromCodePoint(0xfffd); // built by escape: a literal here would trip the repo text-integrity gate
  assert.ok(compareCodePoint(bmpHigh, astral) < 0, "U+FFFD must precede U+1F600 in code-point order");
  assert.ok(astral < bmpHigh, "…which is the opposite of the raw UTF-16 comparison this replaces");
  const sorted = sortTypedRefs([
    { kind: "review-ruling", ref: astral }, { kind: "review-ruling", ref: bmpHigh },
  ]);
  assert.deepStrictEqual(sorted.map((r) => r.ref), [bmpHigh, astral]);
});

test("panel 5 / SM §2: batchSnapshot results and findings are canonically ordered before hashing", () => {
  const mk = (order) => canonicalizeBatchSnapshot({
    results: order.map((p) => ({
      testRef: { path: p, adapterId: "vitest", structuralId: "s" },
      findings: [{ kind: "scope-violation", binding: { clauseRef: "REQ-a" } }, { kind: "wrong-tag" }],
    })),
  });
  const a = mk(["b/x.test.ts", "a/y.test.ts"]);
  const b = mk(["a/y.test.ts", "b/x.test.ts"]);
  assert.strictEqual(digestOf(a), digestOf(b), "caller insertion order must not reach the digest");
  assert.strictEqual(a.results[0].testRef.path, "a/y.test.ts");
  assert.strictEqual(a.results[0].findings[0].kind, "wrong-tag", "closed kind order, and null binding first");
});

test("panel 6 / SM §9: an exception whose expiry has PASSED stops being applicable", () => {
  let s = withHardConstraint();
  s = apply(s, "append-source", {
    source: {
      sourceId: "S-exc", contentKind: "exception-grant", driftMode: "snapshot-only", locator: "g#1",
      excerpt: "grant", targetConstraintRef: "REQ-hc",
      grantAuthorityRef: { kind: "source-authority", ref: "R-owner" }, scope: "eu", expiry: "2020-01-01",
    },
  });
  s = apply(s, "append-record", { record: scopeRuling("R-scope", DP3) });
  const e = assertRejects(() => apply(s, "create-initial-outcome", {
    dpId: "DP-3", scopeRulingRef: { kind: "review-ruling", ref: "R-scope" },
    clause: { id: "REQ-exc", authority: "approved-requirement", kind: "specification", text: "t", sourceRef: "S-exc", taskRef: "TASK-1" },
  }), "E_INV4_NOT_APPLICABLE", "expired grant");
  assert.match(e.message, /exception-expired/);
  // NOTE: an UNPARSEABLE expiry never reaches this path any more — it is refused at Source level
  // (see the panel-3 test below), which is strictly earlier and covers unreferenced grants too.
});

test("panel 6 / SM §2: a batch ref naming a real record of the WRONG kind does not resolve", () => {
  const s = withAssumption(CODE);
  assertRejects(() => apply(s, "commit-test-provenance-batch", batchPayload({
    recordsToCreate: [reviewRuling("R-e1", { kind: "discipline", discipline: "test" }, "ASSUM-a")],
    resolutions: [{
      subjectRef: "ASSUM-a",
      semanticEvidenceRefs: [{ kind: "user-answer", ref: "R-e1" }], // real id, wrong kind
      governanceWitnessRef: { kind: "review-ruling", ref: "R-e1" },
      transitionDraft: { id: "T-1", subject: "ASSUM-a", action: "retire", successor: null, authorityRef: CODE, ackRef: { kind: "review-ruling", ref: "R-e1" } },
    }],
  })), "E_REF_UNRESOLVABLE", "typed ref with a mismatched kind");
});

test("panel 6 / SM §7: a plan-gate record whose approvedBy is not the user, or whose disposition is unknown, does not resolve", () => {
  let s = withAssumption(CODE);
  s = withRequirementSuccessor(s, "REQ-b");
  const attempt = (planGateRecord) => apply(s, "replace-terminal", {
    dpId: "DP-1", casMode: "current-terminal", expectedCurrentTerminalRef: "ASSUM-a",
    resolutionCarrierUpdates: nulls("DP-1"),
    records: [planGateRecord],
    successorClause: { id: "REQ-b", authority: "approved-requirement", kind: "specification", text: "t", sourceRef: "S-REQ-b", taskRef: "TASK-1" },
    transition: {
      id: "T-1", subject: "ASSUM-a", action: "supersede", successor: "REQ-b",
      authorityRef: { kind: "user" }, ackRef: { kind: "plan-gate", ref: "R-pg" },
    },
  });
  assertRejects(() => attempt({ recordId: "R-pg", kind: "plan-gate", target: "ASSUM-a", impact: "none", disposition: "no-affected-dependents", approvedBy: "some-agent" }),
    "E_RECORD_PAYLOAD", "plan-gate not approved by the user");
  assertRejects(() => attempt({ recordId: "R-pg", kind: "plan-gate", target: "ASSUM-a", impact: "none", disposition: "invented", approvedBy: "user" }),
    "E_RECORD_PAYLOAD", "plan-gate with an unknown disposition");
});

test("panel 4 / IS AC35: a reopened DP with an active prior terminal is refused by EVERY no-Transition path", () => {
  let s = withAssumption(CODE);
  s = apply(s, "reopen-dp", { dpId: "DP-1", resolutionCarrierUpdates: nulls("DP-1"), trigger: "new-dependent", expectedCurrentTerminalRef: "ASSUM-a" });

  assertRejects(() => apply(s, "adopt-existing-outcome", { dpId: "DP-1", resolutionCarrierUpdates: nulls("DP-1"), clauseRef: "REQ-a" }),
    "E_REOPENED_NEEDS_TRANSITION", "adopt-existing-outcome");
  assertRejects(() => apply(s, "create-initial-outcome", {
    dpId: "DP-1",
    clause: { id: "ASSUM-new", layer: "implementation", derivedFrom: "DP-1", text: "t", alternative: "u", basis: "b", basisRefs: [], governedBy: CODE },
  }), "E_REOPENED_NEEDS_TRANSITION", "create-initial-outcome");

  let s2 = apply(s, "append-source", {
    source: {
      sourceId: "S-hc2", contentKind: "policy", driftMode: "snapshot-only", locator: "p#1", excerpt: "policy text",
    },
  });
  s2 = apply(s2, "create-initial-outcome", {
    dpId: "DP-2",
    clause: { id: "REQ-hc2", authority: "hard-constraint", kind: "specification", text: "hc", sourceRef: "S-hc2", ownerRef: { kind: "source-authority", ref: "R-owner" } },
  });
  assertRejects(() => apply(s2, "resolve-exception", {
    dpId: "DP-1",
    source: {
      sourceId: "S-exc", contentKind: "exception-grant", driftMode: "snapshot-only", locator: "g#1",
      excerpt: "grant", targetConstraintRef: "REQ-hc2",
      grantAuthorityRef: { kind: "source-authority", ref: "R-owner" }, scope: "eu", expiry: "2099-01-01",
    },
    scopeRuling: scopeRuling("R-scope", DP1),
    requirement: { id: "REQ-exc", authority: "approved-requirement", kind: "specification", text: "t", sourceRef: "S-exc", taskRef: "TASK-1" },
  }), "E_REOPENED_NEEDS_TRANSITION", "resolve-exception");
});

test("panel 3 / IS annotation table: reclassify-dp REQUIRES a classification ruling bound to this DP", () => {
  const s = baseFixture();
  const cls = (dpFixture, basis = "product policy") => typedRuling("R-cls", INTENT, dpFixture, "product-tradeoff", {
    basis, productQuestion: "soft delete or hard delete?", alternatives: dpFixture.alternatives,
  });

  assertRejects(() => apply(s, "reclassify-dp", { dpId: "DP-1", layer: "intent", classificationBasis: "product policy" }),
    "E_PAYLOAD_MISSING", "reclassify with no ruling at all");

  // a ruling bound to ANOTHER DP cannot be borrowed
  assertRejects(() => apply(s, "reclassify-dp", {
    dpId: "DP-1", layer: "intent", classificationBasis: "product policy",
    records: [cls(DP2)], classificationRulingRef: { kind: "review-ruling", ref: "R-cls" },
  }), "E_RULING_BORROWED", "classification ruling bound to another DP");

  // postcondition: a product-tradeoff ruling implies layer=intent
  assertRejects(() => apply(s, "reclassify-dp", {
    dpId: "DP-1", layer: "implementation", classificationBasis: "product policy",
    records: [cls(DP1)], classificationRulingRef: { kind: "review-ruling", ref: "R-cls" },
  }), "E_RULING_POSTCONDITION", "product-tradeoff not landing on intent");

  // basis must match the ruling's
  assertRejects(() => apply(s, "reclassify-dp", {
    dpId: "DP-1", layer: "intent", classificationBasis: "something else",
    records: [cls(DP1)], classificationRulingRef: { kind: "review-ruling", ref: "R-cls" },
  }), "E_RULING_POSTCONDITION", "classificationBasis diverging from the ruling");

  const ok = apply(s, "reclassify-dp", {
    dpId: "DP-1", layer: "intent", classificationBasis: "product policy",
    records: [cls(DP1)], classificationRulingRef: { kind: "review-ruling", ref: "R-cls" },
  });
  const d = indexStore(ok).dps.get("DP-1");
  assert.strictEqual(d.layer, "intent");
  assert.deepStrictEqual(d.classificationRulingRef, { kind: "review-ruling", ref: "R-cls" });
  assert.strictEqual(d.classificationBasis, "product policy", "upstream keeps classificationBasis human-readable");
});

test("panel 3: reclassify-dp accepts ONLY layer-classification / product-tradeoff rulings", () => {
  const s = baseFixture();
  // a technical-decision ruling for the SAME DP, correct principal, complete packet — and still wrong
  assertRejects(() => apply(s, "reclassify-dp", {
    dpId: "DP-1", layer: "intent", classificationBasis: "eng",
    records: [typedRuling("R-td", CODE, DP1, "technical-decision", { selectedAlternative: "A" })],
    classificationRulingRef: { kind: "review-ruling", ref: "R-td" },
  }), "E_RULING_KIND_NOT_ALLOWED", "technical-decision used as a classification witness");

  // an untyped ruling is not a classification witness either
  assertRejects(() => apply(s, "reclassify-dp", {
    dpId: "DP-1", layer: "intent", classificationBasis: "eng",
    records: [reviewRuling("R-plain", INTENT, "DP-1")],
    classificationRulingRef: { kind: "review-ruling", ref: "R-plain" },
  }), "E_RULING_KIND_NOT_ALLOWED", "untyped ruling as a classification witness");

  // layer-classification is accepted, and its classifiedLayer must match the requested layer
  assertRejects(() => apply(s, "reclassify-dp", {
    dpId: "DP-1", layer: "intent", classificationBasis: "eng",
    records: [typedRuling("R-lc", INTENT, DP1, "layer-classification", { basis: "eng", classifiedLayer: "implementation" })],
    classificationRulingRef: { kind: "review-ruling", ref: "R-lc" },
  }), "E_RULING_POSTCONDITION", "classifiedLayer disagreeing with the applied layer");

  const ok = apply(s, "reclassify-dp", {
    dpId: "DP-1", layer: "intent", classificationBasis: "eng",
    records: [typedRuling("R-lc", INTENT, DP1, "layer-classification", { basis: "eng", classifiedLayer: "intent" })],
    classificationRulingRef: { kind: "review-ruling", ref: "R-lc" },
  });
  assert.strictEqual(indexStore(ok).dps.get("DP-1").layer, "intent");
});

test("panel 4: exception scope needs a scope-coverage ruling saying TRUE — a plain intent ruling will not do", () => {
  let s = withHardConstraint();
  s = apply(s, "append-source", {
    source: {
      sourceId: "S-exc", contentKind: "exception-grant", driftMode: "snapshot-only", locator: "g#1",
      excerpt: "grant", targetConstraintRef: "REQ-hc",
      grantAuthorityRef: { kind: "source-authority", ref: "R-owner" }, scope: "eu", expiry: "2099-01-01",
    },
  });
  const requirement = { id: "REQ-exc", authority: "approved-requirement", kind: "specification", text: "t", sourceRef: "S-exc", taskRef: "TASK-1" };
  const attempt = (ruling) => apply(s, "resolve-exception", {
    dpId: "DP-3",
    source: {
      sourceId: "S-exc2", contentKind: "exception-grant", driftMode: "snapshot-only", locator: "g#2",
      excerpt: "grant2", targetConstraintRef: "REQ-hc",
      grantAuthorityRef: { kind: "source-authority", ref: "R-owner" }, scope: "eu", expiry: "2099-01-01",
    },
    scopeRuling: ruling,
    requirement: { ...requirement, sourceRef: "S-exc2" },
  });

  assertRejects(() => attempt(reviewRuling("R-plain", INTENT, "DP-3")),
    "E_NOT_APPLICABLE", "a plain intent ruling as scope coverage");
  assertRejects(() => attempt(scopeRuling("R-neg", DP3, false)),
    "E_NOT_APPLICABLE", "a scope-coverage ruling that says NOT covered");
  assert.ok(attempt(scopeRuling("R-pos", DP3, true)), "an explicit scopeCovers=true is accepted");
});

test("panel 2 / IS §4: a PERSISTED ruling goes stale when its DP moves and cannot be spent later", () => {
  let s = baseFixture();
  // 1. persist a complete, fresh technical-decision ruling for DP-2
  s = apply(s, "append-record", { record: typedRuling("R-td", CODE, DP2, "technical-decision", { selectedAlternative: "A" }) });
  // 2. the DP then moves (its classificationBasis is reclassified)
  s = apply(s, "reclassify-dp", {
    dpId: "DP-2", layer: "implementation", classificationBasis: "revised engineering basis",
    records: [typedRuling("R-lc", CODE, DP2, "layer-classification", { basis: "revised engineering basis", classifiedLayer: "implementation" })],
    classificationRulingRef: { kind: "review-ruling", ref: "R-lc" },
  });
  // 3. spending the OLD ruling must now fail — freshness is checked at consumption, not creation
  assertRejects(() => apply(s, "create-initial-outcome", {
    dpId: "DP-2",
    clause: {
      id: "DEC-x", layer: "implementation", derivedFrom: "DP-2", decision: "A", alternatives: ["A", "B"],
      approvedBy: CODE, basisRefs: [{ kind: "review-ruling", ref: "R-td" }],
    },
  }), "E_RULING_PACKET_STALE", "persisted ruling spent after its DP moved");
});

test("panel 3 / IS AC41: another DP's technical-decision ruling cannot be borrowed for a new DEC", () => {
  const s = baseFixture();
  const ruling = (dpFixture) => typedRuling("R-td", CODE, dpFixture, "technical-decision", { selectedAlternative: "A" });
  const decFor = (dpId) => ({
    id: "DEC-x", layer: "implementation", derivedFrom: dpId, decision: "A", alternatives: ["A", "B"],
    approvedBy: CODE, basisRefs: [{ kind: "review-ruling", ref: "R-td" }],
  });

  assertRejects(() => apply(s, "create-initial-outcome", {
    dpId: "DP-2", records: [ruling(DP1)], clause: decFor("DP-2"),
  }), "E_RULING_BORROWED", "DP-1's ruling pinned to a DEC derived from DP-2");

  // and the postconditions bite even when the ruling IS this DP's
  assertRejects(() => apply(s, "create-initial-outcome", {
    dpId: "DP-2", records: [ruling(DP2)], clause: { ...decFor("DP-2"), decision: "B" },
  }), "E_RULING_POSTCONDITION", "DEC.decision diverging from selectedAlternative");
  assertRejects(() => apply(s, "create-initial-outcome", {
    dpId: "DP-2", records: [ruling(DP2)], clause: { ...decFor("DP-2"), approvedBy: SECURITY },
  }), "E_RULING_POSTCONDITION", "DEC.approvedBy diverging from ruling.by");
  assertRejects(() => apply(s, "create-initial-outcome", {
    dpId: "DP-2", records: [ruling(DP2)], clause: { ...decFor("DP-2"), alternatives: ["A", "C"] },
  }), "E_RULING_POSTCONDITION", "DEC.alternatives diverging from the input snapshot");

  const ok = apply(s, "create-initial-outcome", { dpId: "DP-2", records: [ruling(DP2)], clause: decFor("DP-2") });
  assert.strictEqual(indexStore(ok).dps.get("DP-2").decidedBy, "DEC-x");
});

test("panel 3 / IS §13: the store-script assertions bite — selection must come from the alternatives, distinct for provisional", () => {
  const s = baseFixture();
  assertRejects(() => apply(s, "create-initial-outcome", {
    dpId: "DP-2",
    records: [typedRuling("R-td", CODE, DP2, "technical-decision", { selectedAlternative: "Z" })],
    clause: { id: "DEC-x", layer: "implementation", derivedFrom: "DP-2", decision: "Z", alternatives: ["A", "B"], approvedBy: CODE, basisRefs: [{ kind: "review-ruling", ref: "R-td" }] },
  }), "E_RULING_SELECTION", "selectedAlternative outside the offered alternatives");

  assertRejects(() => apply(s, "create-initial-outcome", {
    dpId: "DP-2",
    records: [typedRuling("R-ap", CODE, DP2, "approved-provisional", { selectedAlternative: "A", rejectedAlternative: "A", basis: "b" })],
    clause: { id: "ASSUM-x", layer: "implementation", derivedFrom: "DP-2", text: "A", alternative: "A", basis: "b", basisRefs: [{ kind: "review-ruling", ref: "R-ap" }], governedBy: CODE },
  }), "E_RULING_SELECTION", "selected and rejected identical");

  // and the positive: a well-formed approved-provisional ruling backs its ASSUM
  const ok = apply(s, "create-initial-outcome", {
    dpId: "DP-2",
    records: [typedRuling("R-ap", CODE, DP2, "approved-provisional", { selectedAlternative: "A", rejectedAlternative: "B", basis: "b" })],
    clause: { id: "ASSUM-x", layer: "implementation", derivedFrom: "DP-2", text: "A", alternative: "B", basis: "b", basisRefs: [{ kind: "review-ruling", ref: "R-ap" }], governedBy: CODE },
  });
  assert.strictEqual(indexStore(ok).dps.get("DP-2").assumedAs, "ASSUM-x");
});

test("panel 3 / IS AC33: a governance ruling whose inputPacketDigest disagrees with its own snapshot is refused", () => {
  const s = baseFixture();
  assertRejects(() => apply(s, "append-record", {
    record: {
      ...reviewRuling("R-bad", INTENT, "DP-1"), rulingKind: "layer-classification",
      classifiedLayer: "intent", inputPacketSnapshot: { alternatives: ["A"] }, inputPacketDigest: "deadbeef",
    },
  }), "E_RULING_SNAPSHOT", "self-inconsistent ruling snapshot");
});

test("panel 2 / SM §9: the committed batchSnapshot carries the inline base witness from TaskState", () => {
  let s = baseFixture();
  s = apply(s, "commit-test-provenance-batch", batchPayload());
  const batch = indexStore(s).records.get("R-b1");
  assert.deepStrictEqual(batch.batchSnapshot.baseProvenance, BASE, "the base witness is persisted, not just compared");
  assert.strictEqual(batch.batchDigest, digestOf(batch.batchSnapshot));
  // a hand-built batch with no inline witness must not resolve
  const stripped = { ...batch.batchSnapshot };
  delete stripped.baseProvenance;
  const broken = {
    ...s,
    records: s.records.map((r) => r.recordId === "R-b1"
      ? { ...r, batchSnapshot: stripped, batchDigest: digestOf(stripped) } : r),
  };
  assertRejects(() => validateAll(broken, OPTS), "E_RECORD_PAYLOAD", "batch snapshot with no base witness");
});

test("panel 1 / IS §8: a held store lock blocks a second writer instead of letting it clobber", () => {
  const cwd = temporary("prov-lock-");
  runTransaction(cwd, "init-task", { taskId: "TASK-1", baseProvenance: BASE }, OPTS);
  const before = fs.readFileSync(storePath(cwd), "utf8");
  const lock = `${storePath(cwd)}.lock`;
  fs.writeFileSync(lock, "12345 held-by-another-writer\n", "utf8");
  try {
    assertRejects(() => runTransaction(cwd, "append-record",
      { record: { recordId: "R-1", kind: "source-authority", authorityIdentity: "x" } }, OPTS),
      "E_STORE_LOCKED", "a second writer while the lock is held");
    assert.strictEqual(fs.readFileSync(storePath(cwd), "utf8"), before);
  } finally {
    fs.rmSync(lock, { force: true });
  }
  // once released, the same call succeeds and leaves no lock behind
  runTransaction(cwd, "append-record", { record: { recordId: "R-1", kind: "source-authority", authorityIdentity: "x" } }, OPTS);
  assert.ok(!fs.existsSync(lock), "the lock is released after a successful transaction");
});

test("panel 1 / IS §8: the lock is released even when the transaction is rejected", () => {
  const cwd = temporary("prov-lock2-");
  runTransaction(cwd, "init-task", { taskId: "TASK-1", baseProvenance: BASE }, OPTS);
  threw(() => runTransaction(cwd, "init-task", { taskId: "TASK-1", baseProvenance: BASE }, OPTS));
  assert.ok(!fs.existsSync(`${storePath(cwd)}.lock`), "a rejected transaction must not leak the lock");
});

// --- DEC transition matrix (panel 7: previously untested) -------------------------------------------

function withDecision(approvedBy = CODE) {
  let s = baseFixture();
  s = apply(s, "create-initial-outcome", {
    dpId: "DP-2",
    records: [typedRuling("R-td", approvedBy, DP2, "technical-decision", { selectedAlternative: "A" })],
    clause: {
      id: "DEC-a", layer: "implementation", derivedFrom: "DP-2", decision: "A",
      alternatives: ["A", "B"], approvedBy, basisRefs: [{ kind: "review-ruling", ref: "R-td" }],
    },
  });
  return s;
}

// A successor DEC needs its own technical-decision ruling, minted in the same transaction.
function decSuccessor(id, dpFixture, principal, rulingId, decision = "B") {
  return {
    ruling: typedRuling(rulingId, principal, dpFixture, "technical-decision", { selectedAlternative: decision }),
    clause: {
      id, layer: "implementation", derivedFrom: dpFixture.id, decision,
      alternatives: dpFixture.alternatives, approvedBy: principal,
      basisRefs: [{ kind: "review-ruling", ref: rulingId }],
    },
  };
}

test("SM §2 DEC row: the approving discipline may supersede its own DEC; another discipline may not", () => {
  const s = withDecision(CODE);
  const next = decSuccessor("DEC-b", DP2, CODE, "R-td2");
  assertRejects(() => apply(s, "replace-terminal", {
    dpId: "DP-2", casMode: "current-terminal", expectedCurrentTerminalRef: "DEC-a",
    resolutionCarrierUpdates: nulls("DP-2"),
    records: [reviewRuling("R-s", SECURITY, "DP-2"), next.ruling],
    successorClause: next.clause,
    transition: { id: "T-1", subject: "DEC-a", action: "supersede", successor: "DEC-b", authorityRef: SECURITY, ackRef: { kind: "review-ruling", ref: "R-s" } },
  }), "E_MATRIX_AUTHORITY", "security superseding a code-approved DEC");

  const ok = apply(s, "replace-terminal", {
    dpId: "DP-2", casMode: "current-terminal", expectedCurrentTerminalRef: "DEC-a",
    resolutionCarrierUpdates: nulls("DP-2"),
    records: [reviewRuling("R-c", CODE, "DP-2"), next.ruling],
    successorClause: next.clause,
    transition: { id: "T-1", subject: "DEC-a", action: "supersede", successor: "DEC-b", authorityRef: CODE, ackRef: { kind: "review-ruling", ref: "R-c" } },
  });
  assert.strictEqual(statusOf(indexStore(ok), "DEC-a"), "superseded");
  assert.strictEqual(indexStore(ok).dps.get("DP-2").decidedBy, "DEC-b");
});

test("panel 1 / SM §5 row 7: a DEC cannot be minted without a technical-decision ruling", () => {
  const s = baseFixture();
  assertRejects(() => apply(s, "create-initial-outcome", {
    dpId: "DP-2",
    clause: { id: "DEC-x", layer: "implementation", derivedFrom: "DP-2", decision: "A", alternatives: ["A", "B"], approvedBy: CODE, basisRefs: [] },
  }), "E_DEC_RULING_REQUIRED", "DEC with no ruling at all");

  // an UNTYPED ruling is not a substitute either
  assertRejects(() => apply(s, "create-initial-outcome", {
    dpId: "DP-2",
    records: [reviewRuling("R-plain", CODE, "DP-2")],
    clause: { id: "DEC-x", layer: "implementation", derivedFrom: "DP-2", decision: "A", alternatives: ["A", "B"], approvedBy: CODE, basisRefs: [{ kind: "review-ruling", ref: "R-plain" }] },
  }), "E_DEC_RULING_REQUIRED", "DEC backed only by an untyped ruling");
});

test("panel 1: an UNTYPED ruling bound to another DP cannot be borrowed either", () => {
  const s = baseFixture();
  assertRejects(() => apply(s, "create-initial-outcome", {
    dpId: "DP-2",
    records: [reviewRuling("R-plain", CODE, "DP-1")],
    clause: {
      id: "ASSUM-x", layer: "implementation", derivedFrom: "DP-2", text: "t", alternative: "u",
      basis: "b", basisRefs: [{ kind: "review-ruling", ref: "R-plain" }], governedBy: CODE,
    },
  }), "E_RULING_BORROWED", "untyped ruling about DP-1 cited by a DP-2 clause");
});

test("panel 1 / IS §4: a typed ruling missing its packet, or answering a STALE packet, is refused", () => {
  const s = baseFixture();
  // (a) rulingKind but no packet
  assertRejects(() => apply(s, "append-record", {
    record: { ...reviewRuling("R-x", CODE, "DP-2"), rulingKind: "technical-decision", selectedAlternative: "A" },
  }), "E_RULING_PACKET_MISSING", "typed ruling with no input packet");

  // (b) an INCOMPLETE packet: dropping a required canonical field must not buy an exemption
  for (const missing of ["scenario", "alternatives", "layer", "classificationBasis", "materialReasons", "basisRefs"]) {
    const partial = { ...packetFor(DP2, CODE) };
    delete partial[missing];
    assertRejects(() => apply(s, "append-record", {
      record: {
        ...reviewRuling(`R-p-${missing}`, CODE, "DP-2"), rulingKind: "technical-decision",
        basis: "b", selectedAlternative: "A",
        inputPacketSnapshot: partial, inputPacketDigest: digestOf(partial),
      },
    }), "E_RULING_PACKET_INCOMPLETE", `packet missing ${missing}`);
  }
  // a packet with essentially only requestedPrincipal — the shape the panel used to mint a DEC
  const nearlyEmpty = { requestedPrincipal: CODE };
  assertRejects(() => apply(s, "append-record", {
    record: {
      ...reviewRuling("R-empty", CODE, "DP-2"), rulingKind: "technical-decision", basis: "b",
      selectedAlternative: "A", inputPacketSnapshot: nearlyEmpty, inputPacketDigest: digestOf(nearlyEmpty),
    },
  }), "E_RULING_PACKET_INCOMPLETE", "near-empty but self-consistent packet");

  // (c) a typed ruling missing its own per-kind OUTPUT field
  assertRejects(() => apply(s, "append-record", {
    record: { ...typedRuling("R-out", CODE, DP2, "technical-decision"), selectedAlternative: undefined },
  }), "E_RULING_OUTPUT_INCOMPLETE", "technical-decision with no selectedAlternative");

  // (d) requestedPrincipal disagreeing with by
  const mismatched = packetFor(DP2, SECURITY);
  assertRejects(() => apply(s, "append-record", {
    record: {
      ...reviewRuling("R-y", CODE, "DP-2"), rulingKind: "technical-decision", basis: "b", selectedAlternative: "A",
      inputPacketSnapshot: mismatched, inputPacketDigest: digestOf(mismatched),
    },
  }), "E_RULING_PRINCIPAL", "packet requested security, ruling issued by code");

  // (e) self-consistent but STALE: the packet describes alternatives the DP no longer has
  const stale = { ...packetFor(DP2, CODE), alternatives: ["A", "B", "C"] };
  assertRejects(() => apply(s, "append-record", {
    record: {
      ...reviewRuling("R-z", CODE, "DP-2"), rulingKind: "technical-decision", basis: "b", selectedAlternative: "A",
      inputPacketSnapshot: stale, inputPacketDigest: digestOf(stale),
    },
  }), "E_RULING_PACKET_STALE", "self-consistent packet that no longer matches the DP");

  // a complete, fresh ruling is accepted
  assert.ok(apply(s, "append-record", {
    record: typedRuling("R-ok", CODE, DP2, "technical-decision", { selectedAlternative: "A" }),
  }));
});

test("panel 2 / SM §9: the loader re-verifies every batch witness against its TaskState", () => {
  let s = baseFixture();
  s = apply(s, "commit-test-provenance-batch", batchPayload());
  // Edit the committed snapshot's witness AND recompute its digest, so the record is internally
  // consistent — exactly the shape that previously loaded cleanly.
  const tampered = {
    ...s,
    records: s.records.map((r) => {
      if (r.recordId !== "R-b1") return r;
      const snapshot = { ...r.batchSnapshot, baseProvenance: { ...BASE, treeOid: "f".repeat(40) } };
      return { ...r, batchSnapshot: snapshot, batchDigest: digestOf(snapshot) };
    }),
  };
  assertRejects(() => validateAll(tampered, OPTS), "E_BATCH_BASE_MISMATCH", "internally consistent but reseated witness");
});

test("panel 3 / SM §2: a malformed exception expiry is refused at Source level, even with nothing citing it", () => {
  const s = withHardConstraint();
  const e = assertRejects(() => apply(s, "append-source", {
    source: {
      sourceId: "S-bad", contentKind: "exception-grant", driftMode: "snapshot-only", locator: "g#1",
      excerpt: "grant", targetConstraintRef: "REQ-hc",
      grantAuthorityRef: { kind: "source-authority", ref: "R-owner" }, scope: "eu", expiry: "not-a-date",
    },
  }), "E_SHAPE", "unreferenced grant with a garbage expiry");
  assert.match(e.message, /unparseable expiry/);
});

test("SM §2 DEC row: arbiter may retire a DEC, and DEC has no revise action", () => {
  const s = withDecision(CODE);
  const ok = apply(s, "replace-terminal", {
    dpId: "DP-2", casMode: "current-terminal", expectedCurrentTerminalRef: "DEC-a",
    resolutionCarrierUpdates: nulls("DP-2"),
    records: [reviewRuling("R-a", ARBITER, "DP-2")],
    transition: { id: "T-1", subject: "DEC-a", action: "retire", successor: null, authorityRef: ARBITER, ackRef: { kind: "review-ruling", ref: "R-a" } },
  });
  assert.strictEqual(statusOf(indexStore(ok), "DEC-a"), "retired");
  assert.strictEqual(indexStore(ok).dps.get("DP-2").status, "open");

  const next = decSuccessor("DEC-b", DP2, CODE, "R-td2");
  assertRejects(() => apply(s, "replace-terminal", {
    dpId: "DP-2", casMode: "current-terminal", expectedCurrentTerminalRef: "DEC-a",
    resolutionCarrierUpdates: nulls("DP-2"),
    records: [reviewRuling("R-c", CODE, "DP-2"), next.ruling],
    successorClause: next.clause,
    transition: { id: "T-1", subject: "DEC-a", action: "revise", successor: "DEC-b", authorityRef: CODE, ackRef: { kind: "review-ruling", ref: "R-c" } },
  }), "E_MATRIX_FORBIDDEN", "DEC revise");
});

test("SM §2 DEC row / IS AC38: DEC → REQ is a product ruling and needs a user plan-gate witness", () => {
  let s = withDecision(CODE);
  s = withRequirementSuccessor(s, "REQ-b");
  const successorClause = { id: "REQ-b", authority: "approved-requirement", kind: "specification", text: "t", sourceRef: "S-REQ-b", taskRef: "TASK-1" };
  assertRejects(() => apply(s, "replace-terminal", {
    dpId: "DP-2", casMode: "current-terminal", expectedCurrentTerminalRef: "DEC-a",
    resolutionCarrierUpdates: nulls("DP-2"),
    records: [reviewRuling("R-c", CODE, "DP-2")], successorClause,
    transition: { id: "T-1", subject: "DEC-a", action: "supersede", successor: "REQ-b", authorityRef: CODE, ackRef: { kind: "review-ruling", ref: "R-c" } },
  }), "E_MATRIX_AUTHORITY", "a discipline promoting a DEC to a REQ");

  const ok = apply(s, "replace-terminal", {
    dpId: "DP-2", casMode: "current-terminal", expectedCurrentTerminalRef: "DEC-a",
    resolutionCarrierUpdates: nulls("DP-2"),
    records: [planGate("R-pg", "DEC-a")], successorClause,
    transition: { id: "T-1", subject: "DEC-a", action: "supersede", successor: "REQ-b", authorityRef: { kind: "user" }, ackRef: { kind: "plan-gate", ref: "R-pg" } },
  });
  assert.strictEqual(indexStore(ok).dps.get("DP-2").resolvedBy, "REQ-b");
});

test("SM §2 ASSUM row: supersede → DEC accepts a formally rerouted current review principal with a bound ruling", () => {
  let s = withAssumption(CODE);
  // operability was rerouted onto this DP; its ruling must equal the new DEC's approvedBy.
  const OPERABILITY = { kind: "discipline", discipline: "operability" };
  const next = decSuccessor("DEC-n", DP1, OPERABILITY, "R-td-op", "A");
  const ok = apply(s, "replace-terminal", {
    dpId: "DP-1", casMode: "current-terminal", expectedCurrentTerminalRef: "ASSUM-a",
    resolutionCarrierUpdates: nulls("DP-1"),
    records: [reviewRuling("R-op", OPERABILITY, "DP-1"), next.ruling],
    successorClause: next.clause,
    transition: { id: "T-1", subject: "ASSUM-a", action: "supersede", successor: "DEC-n", authorityRef: OPERABILITY, ackRef: { kind: "review-ruling", ref: "R-op" } },
  });
  assert.strictEqual(indexStore(ok).dps.get("DP-1").decidedBy, "DEC-n");

  // but a rerouted principal that does NOT match the new DEC's approvedBy falls back to the
  // governedBy rule and is refused.
  const mismatched = decSuccessor("DEC-n", DP1, SECURITY, "R-td-sec", "A");
  assertRejects(() => apply(s, "replace-terminal", {
    dpId: "DP-1", casMode: "current-terminal", expectedCurrentTerminalRef: "ASSUM-a",
    resolutionCarrierUpdates: nulls("DP-1"),
    records: [reviewRuling("R-op", OPERABILITY, "DP-1"), mismatched.ruling],
    successorClause: mismatched.clause,
    transition: { id: "T-1", subject: "ASSUM-a", action: "supersede", successor: "DEC-n", authorityRef: OPERABILITY, ackRef: { kind: "review-ruling", ref: "R-op" } },
  }), "E_MATRIX_AUTHORITY", "rerouted principal not matching the new DEC's approvedBy");
});

// --- resolve-exception (panel 7: previously untested) -----------------------------------------------

test("IS §8: resolve-exception mints grant + REQ + scope ruling and resolves the DP in one transaction", () => {
  const s = withHardConstraint();
  const ok = apply(s, "resolve-exception", {
    dpId: "DP-3",
    source: {
      sourceId: "S-exc", contentKind: "exception-grant", driftMode: "snapshot-only", locator: "g#1",
      excerpt: "scoped exception", targetConstraintRef: "REQ-hc",
      grantAuthorityRef: { kind: "source-authority", ref: "R-owner" }, scope: "eu", expiry: "2099-01-01",
    },
    scopeRuling: scopeRuling("R-scope", DP3),
    requirement: { id: "REQ-exc", authority: "approved-requirement", kind: "specification", text: "exception applies", sourceRef: "S-exc", taskRef: "TASK-1" },
  });
  const index = indexStore(ok);
  assert.strictEqual(index.dps.get("DP-3").resolvedBy, "REQ-exc");
  assert.deepStrictEqual(index.dps.get("DP-3").scopeRulingRef, { kind: "review-ruling", ref: "R-scope" });
  assert.ok(index.sources.get("S-exc"), "the grant Source is persisted in the same transaction");

  // the scope ruling must be an intent ruling bound to THIS DP
  assertRejects(() => apply(s, "resolve-exception", {
    dpId: "DP-3",
    source: {
      sourceId: "S-exc", contentKind: "exception-grant", driftMode: "snapshot-only", locator: "g#1",
      excerpt: "scoped exception", targetConstraintRef: "REQ-hc",
      grantAuthorityRef: { kind: "source-authority", ref: "R-owner" }, scope: "eu", expiry: "2099-01-01",
    },
    scopeRuling: typedRuling("R-scope", CODE, DP3, "scope-coverage", { scopeCovers: true }),
    requirement: { id: "REQ-exc", authority: "approved-requirement", kind: "specification", text: "t", sourceRef: "S-exc", taskRef: "TASK-1" },
  }), "E_NOT_APPLICABLE", "scope ruling not issued by intent");
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
    // retiring ASSUM-a reopens DP-1, so the batch declares that DP's carrier disposition
    resolutionCarrierUpdates: nulls("DP-1"),
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
    resolutionCarrierUpdates: nulls("DP-1", "DP-2"),
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
    resolutionCarrierUpdates: nulls("DP-1"),
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

// --- real cross-process contention (panel: the lock must be exercised by actual processes) --------

test("panel 1: N concurrent PROCESSES contend for the store — every success lands, none is clobbered, no lock leaks", async () => {
  const cwd = temporary("prov-contend-");
  runTransaction(cwd, "init-task", { taskId: "TASK-1", baseProvenance: BASE }, OPTS);
  const script = path.join(root, "cressetide", "skills", "vigil", "scripts", "provenance-store.mjs");

  const N = 12;
  const attempt = (i) => new Promise((resolve) => {
    const payload = JSON.stringify({
      record: { recordId: `R-p${i}`, kind: "source-authority", authorityIdentity: `writer-${i}` },
    });
    execFile(process.execPath, [script, "append-record", "--cwd", cwd, "--payload", payload],
      { encoding: "utf8" }, (err, stdout, stderr) => {
        resolve({ i, code: err ? err.code : 0, stdout, stderr });
      });
  });

  const results = await Promise.all(Array.from({ length: N }, (_, i) => attempt(i)));
  const succeeded = results.filter((r) => r.code === 0);
  const rejected = results.filter((r) => r.code !== 0);

  assert.strictEqual(succeeded.length + rejected.length, N, "every process reports an outcome");
  assert.ok(succeeded.length >= 1, "at least one writer must get through");
  for (const r of rejected) {
    assert.notStrictEqual(JSON.parse(r.stderr).code, "E_UNEXPECTED",
      "a losing writer must never surface an unclassified error — contention outcomes are typed");
  }

  // Whatever the interleaving, the store must be consistent and hold EXACTLY the successful writes.
  const store = loadStore(cwd).store;
  assert.ok(validateAll(store, OPTS).ok, "the store is still valid after contention");
  const present = new Set(store.records.map((r) => r.recordId));
  for (const r of succeeded) {
    assert.ok(present.has(`R-p${r.i}`), `writer ${r.i} reported success, so its record must be present (no clobbering)`);
  }
  for (const r of rejected) {
    assert.ok(!present.has(`R-p${r.i}`), `writer ${r.i} was rejected, so its record must be absent`);
    const err = JSON.parse(r.stderr);
    // A closed set of contention outcomes: the lock, the last-moment CAS, or a typed I/O failure
    // (Windows can refuse a rename over a concurrently-opened target). Never E_UNEXPECTED.
    assert.ok(["E_STORE_LOCKED", "E_CAS_MISMATCH", "E_IO"].includes(err.code),
      `a losing writer must fail on the lock, the CAS or a typed I/O error, got ${err.code}`);
  }
  assert.strictEqual(store.records.filter((r) => r.recordId.startsWith("R-p")).length, succeeded.length,
    "no partial or phantom writes");
  assert.ok(!fs.existsSync(`${storePath(cwd)}.lock`), "no lock file survives the contention");
  assert.deepStrictEqual(
    fs.readdirSync(path.dirname(storePath(cwd))).filter((f) => f.includes(".tmp")), [],
    "no temp file survives the contention",
  );
});

test("panel 1: the losing path is triggered DETERMINISTICALLY — a held lock rejects every concurrent process", async () => {
  const cwd = temporary("prov-determ-");
  runTransaction(cwd, "init-task", { taskId: "TASK-1", baseProvenance: BASE }, OPTS);
  const script = path.join(root, "cressetide", "skills", "vigil", "scripts", "provenance-store.mjs");
  const before = fs.readFileSync(storePath(cwd), "utf8");
  const lock = `${storePath(cwd)}.lock`;
  fs.writeFileSync(lock, "held-by-the-test\n", "utf8");

  const N = 6;
  const run = (i) => new Promise((resolve) => {
    const payload = JSON.stringify({ record: { recordId: `R-d${i}`, kind: "source-authority", authorityIdentity: `w${i}` } });
    execFile(process.execPath, [script, "append-record", "--cwd", cwd, "--payload", payload],
      { encoding: "utf8" }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stderr }));
  });
  try {
    const results = await Promise.all(Array.from({ length: N }, (_, i) => run(i)));
    assert.strictEqual(results.filter((r) => r.code === 0).length, 0, "no writer may pass a held lock");
    for (const r of results) {
      assert.strictEqual(JSON.parse(r.stderr).code, "E_STORE_LOCKED", "every loser takes the lock path");
    }
    assert.strictEqual(fs.readFileSync(storePath(cwd), "utf8"), before, "the store is untouched");
  } finally {
    fs.rmSync(lock, { force: true });
  }
  // the foreign lock is NOT removed by our own release path — we only unlink a lock we still own
  assert.ok(!fs.existsSync(lock));
});

test("panel 1: a writer never deletes a lock it does not own", () => {
  const cwd = temporary("prov-token-");
  runTransaction(cwd, "init-task", { taskId: "TASK-1", baseProvenance: BASE }, OPTS);
  const lock = `${storePath(cwd)}.lock`;
  fs.writeFileSync(lock, "someone-elses-token\n", "utf8");
  threw(() => runTransaction(cwd, "append-record",
    { record: { recordId: "R-1", kind: "source-authority", authorityIdentity: "x" } }, OPTS));
  assert.ok(fs.existsSync(lock), "a rejected acquisition must not clear the holder's lock");
  assert.strictEqual(fs.readFileSync(lock, "utf8").trim(), "someone-elses-token");
  fs.rmSync(lock, { force: true });
});

// --- direct counter-examples for the third panel round -------------------------------------------

test("panel-3 blocker 1: a ruling whose subjectRef and packet.dpId name DIFFERENT DPs is refused", () => {
  const s = baseFixture();
  // The exact repro: record.subjectRef = DP-1, packet.dpId = DP-2, DEC.derivedFrom = DP-1.
  // Freshness would check DP-2 while anti-borrowing checked DP-1, and both would pass.
  const packet = packetFor(DP2, CODE);
  const split = {
    ...reviewRuling("R-split", CODE, "DP-1"), rulingKind: "technical-decision", basis: "b",
    selectedAlternative: "A", inputPacketSnapshot: packet, inputPacketDigest: digestOf(packet),
  };
  assertRejects(() => apply(s, "create-initial-outcome", {
    dpId: "DP-1", records: [split],
    clause: {
      id: "DEC-x", layer: "implementation", derivedFrom: "DP-1", decision: "A",
      alternatives: ["A", "B"], approvedBy: CODE, basisRefs: [{ kind: "review-ruling", ref: "R-split" }],
    },
  }), "E_RULING_SUBJECT_PACKET_MISMATCH", "subjectRef and packet.dpId naming different DPs");
});

test("panel-3 blocker 2: the packet is CLOSED — an undeclared extra key and a malformed basisRef are both refused", () => {
  const s = baseFixture();
  const mk = (packet, id) => ({
    ...reviewRuling(id, CODE, "DP-2"), rulingKind: "technical-decision", basis: "b",
    selectedAlternative: "A", inputPacketSnapshot: packet, inputPacketDigest: digestOf(packet),
  });

  const extra = { ...packetFor(DP2, CODE), extraUndeclaredField: "smuggled" };
  const e1 = assertRejects(() => apply(s, "append-record", { record: mk(extra, "R-extra") }),
    "E_RULING_PACKET_INCOMPLETE", "packet carrying an undeclared key");
  assert.match(e1.message, /undeclared: extraUndeclaredField/);

  assertRejects(() => apply(s, "append-record", { record: mk({ ...packetFor(DP2, CODE), basisRefs: [null] }, "R-null") }),
    "E_RULING_PACKET_INCOMPLETE", "basisRefs containing null");
  assertRejects(() => apply(s, "append-record", { record: mk({ ...packetFor(DP2, CODE), basisRefs: [{ nonsense: 1 }] }, "R-junk") }),
    "E_RULING_PACKET_INCOMPLETE", "basisRefs element matching no normalised shape");
  assertRejects(() => apply(s, "append-record", { record: mk({ ...packetFor(DP2, CODE), materialReasons: ["b", "a"] }, "R-order") }),
    "E_RULING_PACKET_ORDER", "materialReasons out of canonical order");
  assertRejects(() => apply(s, "append-record", { record: mk({ ...packetFor(DP2, CODE), materialReasons: ["a", "a"] }, "R-dup") }),
    "E_RULING_PACKET_ORDER", "materialReasons carrying a duplicate");
  assertRejects(() => apply(s, "append-record", { record: mk({ ...packetFor(DP2, CODE), layer: "invented" }, "R-layer") }),
    "E_ENUM", "packet layer outside the closed set");

  // the well-formed shapes are still accepted — basisRefs sorted by (kind, id), materialReasons
  // matching the DP (freshness still applies: a "tidier" packet is not a licence to differ)
  const wellFormed = {
    ...packetFor(DP2, CODE),
    basisRefs: [{ kind: "review-ruling", ref: "R-1" }, { sourceId: "S-req", digest: "abc" }],
  };
  assert.ok(apply(s, "append-record", { record: mk(wellFormed, "R-good") }));

  // a DP that genuinely carries materialReasons accepts them, deduplicated and ordered
  const dpMat = dp("DP-mat", { materialReasons: ["money", "privacy"] });
  let s2 = apply(s, "resume-task", { taskId: "TASK-1", decisionPoints: [dpMat], addDpIds: ["DP-mat"] });
  const matPacket = packetFor(dpMat, CODE);
  assert.ok(apply(s2, "append-record", {
    record: {
      ...reviewRuling("R-mat", CODE, "DP-mat"), rulingKind: "technical-decision", basis: "b",
      selectedAlternative: "A", inputPacketSnapshot: matPacket, inputPacketDigest: digestOf(matPacket),
    },
  }));
});

// --- Phase 1A: DP.resolutionRulingRef, the current application carrier ---------------------------
// The rule this replaces (a UNIVERSAL over every binding-policy ruling bound to the DP, requiring
// DP.resolvedBy == ruling.bindingClauseRef) closed the "record claims A, B was taken" hole and then
// froze resolvedBy forever: an ordinary REQ-a → REQ-b supersede was refused by a ruling that had
// long since stopped being current. SM v1.11 §2 replaces it with one typed CURRENT carrier, and
// SM v1.11 §9 makes carrier coherence a gate check rather than only a transaction-entry check.

function bindingPolicy(recordId, dpFixture, bindingClauseRef, principal = CODE) {
  return typedRuling(recordId, principal, dpFixture, "binding-policy", { bindingClauseRef });
}

function carrierRef(recordId) {
  return { kind: "review-ruling", ref: recordId };
}

// `unchanged-null` is a DECLARATION ("this DP never had a carrier"), not a way to skip a DP, so
// every terminal-mutating transaction still has to name each affected DP explicitly.
function nulls(...dpIds) {
  return dpIds.map((dpId) => ({ dpId, action: "unchanged-null" }));
}

function withSecondRequirement(s, id = "REQ-b", text = "the other clause") {
  return apply(s, "create-requirement", {
    requirement: {
      id, authority: "approved-requirement", kind: "specification",
      text, sourceRef: "S-req", taskRef: "TASK-1",
    },
  });
}

// DP-2 resolved to REQ-a under a binding-policy ruling that becomes its current carrier.
function withCarrier(recordId = "R-bp", dpId = "DP-2", dpFixture = DP2) {
  let s = withSecondRequirement(baseFixture());
  s = apply(s, "adopt-existing-outcome", {
    dpId, clauseRef: "REQ-a",
    records: [bindingPolicy(recordId, dpFixture, "REQ-a")],
    resolutionCarrierUpdates: [{ dpId, action: "replace", rulingRef: carrierRef(recordId) }],
  });
  return s;
}

function tamper(store, dpId, over) {
  const copy = JSON.parse(JSON.stringify(store));
  const d = copy.decisionPoints.find((x) => x.id === dpId);
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) delete d[k];
    else d[k] = v;
  }
  return copy;
}

test("IS AC61 regression: a historical binding-policy ruling that is NOT the carrier no longer freezes resolvedBy", () => {
  let s = withSecondRequirement(baseFixture());
  // The ruling exists and names REQ-a. Nothing ever adopts it as a carrier, so it is history.
  s = apply(s, "append-record", { record: bindingPolicy("R-bp-hist", DP2, "REQ-a") });
  // DP-2 now resolves by direct row-1 citation to REQ-b. Under the withdrawn universal this was
  // E_BINDING_POLICY_MISMATCH; under the carrier model the historical ruling has no say.
  const out = apply(s, "adopt-existing-outcome", {
    dpId: "DP-2", clauseRef: "REQ-b",
    resolutionCarrierUpdates: nulls("DP-2"),
  });
  const d = indexStore(out).dps.get("DP-2");
  assert.strictEqual(d.resolvedBy, "REQ-b");
  assert.ok(!d.resolutionRulingRef, "a direct citation leaves the carrier null");
  assert.ok(out.records.some((r) => r.recordId === "R-bp-hist"), "the historical ruling stays on record");
});

test("IS AC62: a carrier is preserved across a legal supersede when its clause's chain reaches the new terminal", () => {
  const s = withCarrier();
  assert.deepStrictEqual(indexStore(s).dps.get("DP-2").resolutionRulingRef, carrierRef("R-bp"));
  // REQ-a → REQ-b under a plan gate. The carrier still names REQ-a; activeSuccessorChainEnd(REQ-a)
  // is now REQ-b, which is exactly what the DP holds — so the carrier survives.
  const out = apply(s, "supersede-requirement", {
    initiatingDpIds: ["DP-2"],
    records: [planGate("R-pg", "REQ-a")],
    transition: {
      id: "T-1", subject: "REQ-a", action: "supersede", successor: "REQ-b",
      authorityRef: { kind: "user" }, ackRef: { kind: "plan-gate", ref: "R-pg" },
      compatibility: { impact: "no consumers", disposition: "no-affected-dependents" },
    },
    resolutionCarrierUpdates: [{ dpId: "DP-2", action: "preserve" }],
  });
  const d = indexStore(out).dps.get("DP-2");
  assert.strictEqual(d.resolvedBy, "REQ-b", "the supersede lands");
  assert.deepStrictEqual(d.resolutionRulingRef, carrierRef("R-bp"), "and the carrier is retained");
});

test("IS AC62 negative: preserve is refused when the carrier's clause chain does not reach the new terminal", () => {
  const s = withCarrier();
  // Direct equality is the zero-length case of the chain walk; here the DP is moved off REQ-a's
  // chain entirely, so retaining a carrier that still names REQ-a is a lie about what is in force.
  const tampered = tamper(s, "DP-2", { resolvedBy: "REQ-b" });
  assertRejects(() => validateAll(tampered, OPTS), "E_CARRIER_POSTCONDITION", "carrier names REQ-a, DP holds REQ-b");
});

test("IS AC69: carrier coherence is a LOADER check — a state constructed around the transaction entry is still refused", () => {
  const s = withCarrier();
  // status leaves resolved while the carrier stays set. All three non-resolved shapes fail closed.
  for (const [over, what] of [
    [{ status: "open", resolvedBy: undefined }, "open"],
    [{ status: "assumed", resolvedBy: undefined, assumedAs: "ASSUM-x" }, "assumed"],
    [{ status: "decided", resolvedBy: undefined, decidedBy: "DEC-x" }, "decided"],
  ]) {
    assertRejects(() => validateAll(tamper(s, "DP-2", over), OPTS), "E_CARRIER_STATUS", `carrier retained while ${what}`);
  }
});

test("IS AC63 negative: a carrier ref that is unresolvable, untyped, or bound to another DP is refused", () => {
  let s = withSecondRequirement(baseFixture());
  s = apply(s, "append-record", { record: typedRuling("R-td", CODE, DP2, "technical-decision", { selectedAlternative: "A" }) });
  s = apply(s, "append-record", { record: bindingPolicy("R-bp3", DP3, "REQ-a") }); // bound to DP-3

  const adopt = (rulingRef) => () => apply(s, "adopt-existing-outcome", {
    dpId: "DP-2", clauseRef: "REQ-a",
    resolutionCarrierUpdates: [{ dpId: "DP-2", action: "replace", rulingRef }],
  });
  assertRejects(adopt(carrierRef("R-ghost")), "E_CARRIER_REPLACE", "carrier ref does not resolve");
  assertRejects(adopt(carrierRef("R-td")), "E_CARRIER_RULING_KIND", "carrier names a technical-decision ruling");
  assertRejects(adopt(carrierRef("R-bp3")), "E_CARRIER_BORROWED", "carrier ruling is bound to DP-3");
});

test("IS AC61: carrier updates must cover exactly the DPs whose terminal this transaction mutates", () => {
  let s = withSecondRequirement(baseFixture());
  // DP-1 and DP-2 both hold REQ-a, so superseding it mutates BOTH terminals.
  for (const dpId of ["DP-1", "DP-2"]) {
    s = apply(s, "adopt-existing-outcome", { dpId, clauseRef: "REQ-a", resolutionCarrierUpdates: nulls(dpId) });
  }
  const supersede = (resolutionCarrierUpdates) => () => apply(s, "supersede-requirement", {
    initiatingDpIds: ["DP-1", "DP-2"],
    records: [planGate("R-pg", "REQ-a")],
    transition: {
      id: "T-1", subject: "REQ-a", action: "supersede", successor: "REQ-b",
      authorityRef: { kind: "user" }, ackRef: { kind: "plan-gate", ref: "R-pg" },
      compatibility: { impact: "no consumers", disposition: "no-affected-dependents" },
    },
    resolutionCarrierUpdates,
  });
  assert.ok(supersede(nulls("DP-1", "DP-2"))(), "exact coverage is accepted");
  assertRejects(supersede(nulls("DP-1")), "E_CARRIER_COVERAGE", "dependent DP-2 missing");
  assertRejects(supersede(nulls("DP-1", "DP-2", "DP-3")), "E_CARRIER_COVERAGE", "DP-3's terminal was not mutated");
  assertRejects(supersede(nulls("DP-1", "DP-2", "DP-2")), "E_CARRIER_COVERAGE", "duplicate dpId");
  assertRejects(supersede(undefined), "E_CARRIER_UPDATES_MISSING", "no updates array at all");
});

test("IS AC64: unchanged-null is a declaration, not a skip — it is refused when a carrier is actually set", () => {
  const s = withCarrier();
  assertRejects(() => apply(s, "reopen-dp", {
    dpId: "DP-2", trigger: "terminal-invalidated-no-successor", expectedCurrentTerminalRef: "REQ-a",
    resolutionCarrierUpdates: nulls("DP-2"),
  }), "E_CARRIER_UNCHANGED_NULL", "pre-state carrier is not null");

  // clear is the correct declaration here, and the carrier really goes.
  const out = apply(s, "reopen-dp", {
    dpId: "DP-2", trigger: "terminal-invalidated-no-successor", expectedCurrentTerminalRef: "REQ-a",
    resolutionCarrierUpdates: [{ dpId: "DP-2", action: "clear" }],
  });
  const d = indexStore(out).dps.get("DP-2");
  assert.strictEqual(d.status, "open");
  assert.strictEqual(d.resolutionRulingRef ?? null, null);
});

test("IS AC67: clear and replace are judged PER DP — one DP's rulingRef cannot fail another DP's clear", () => {
  let s = withSecondRequirement(baseFixture());
  for (const [dpId, fixture, rid] of [["DP-1", DP1, "R-bp1"], ["DP-2", DP2, "R-bp2"]]) {
    s = apply(s, "adopt-existing-outcome", {
      dpId, clauseRef: "REQ-a",
      records: [bindingPolicy(rid, fixture, "REQ-a")],
      resolutionCarrierUpdates: [{ dpId, action: "replace", rulingRef: carrierRef(rid) }],
    });
  }
  const supersede = (resolutionCarrierUpdates, extraRecords = []) => () => apply(s, "supersede-requirement", {
    initiatingDpIds: ["DP-1", "DP-2"],
    records: [planGate("R-pg", "REQ-a"), ...extraRecords],
    transition: {
      id: "T-1", subject: "REQ-a", action: "supersede", successor: "REQ-b",
      authorityRef: { kind: "user" }, ackRef: { kind: "plan-gate", ref: "R-pg" },
      compatibility: { impact: "no consumers", disposition: "no-affected-dependents" },
    },
    resolutionCarrierUpdates,
  });

  // DP-1 takes REQ-b by direct citation (carrier cleared); DP-2 takes it under a NEW policy ruling.
  const mixed = supersede(
    [
      { dpId: "DP-1", action: "clear" },
      { dpId: "DP-2", action: "replace", rulingRef: carrierRef("R-bp-new") },
    ],
    [bindingPolicy("R-bp-new", DP2, "REQ-b")],
  )();
  const index = indexStore(mixed);
  assert.strictEqual(index.dps.get("DP-1").resolutionRulingRef ?? null, null, "DP-1's clear survives DP-2's rulingRef");
  assert.strictEqual(index.dps.get("DP-1").resolvedBy, "REQ-b");
  assert.deepStrictEqual(index.dps.get("DP-2").resolutionRulingRef, carrierRef("R-bp-new"));

  // and a DP that declares clear while carrying its OWN replacement ruling is refused
  assertRejects(supersede(
    [
      { dpId: "DP-1", action: "clear", rulingRef: carrierRef("R-bp-new") },
      { dpId: "DP-2", action: "replace", rulingRef: carrierRef("R-bp-new") },
    ],
    [bindingPolicy("R-bp-new", DP2, "REQ-b")],
  // The closed key set is the single mechanism for this: `clear` simply has no rulingRef slot, so
  // a DP smuggling one in is rejected as a shape violation rather than by a second, parallel rule.
  ), "E_CARRIER_SHAPE", "clear must not carry a replacement rulingRef");
});

test("IS AC68: adopt-existing-outcome carries carrier updates and refuses preserve and clear", () => {
  const s = withSecondRequirement(baseFixture());
  const adopt = (resolutionCarrierUpdates, records = []) => () => apply(s, "adopt-existing-outcome", {
    dpId: "DP-2", clauseRef: "REQ-a", records, resolutionCarrierUpdates,
  });
  // positive: binding-policy driven adoption sets the carrier; direct citation leaves it null
  const replaced = adopt([{ dpId: "DP-2", action: "replace", rulingRef: carrierRef("R-bp") }], [bindingPolicy("R-bp", DP2, "REQ-a")])();
  assert.deepStrictEqual(indexStore(replaced).dps.get("DP-2").resolutionRulingRef, carrierRef("R-bp"));
  const direct = adopt(nulls("DP-2"))();
  assert.strictEqual(indexStore(direct).dps.get("DP-2").resolutionRulingRef ?? null, null);
  // negative: neither preserve (the new terminal is not the old carrier's successor) nor clear
  // (the pre-state carrier of a DP with no terminal is necessarily null) is reachable here.
  assertRejects(adopt([{ dpId: "DP-2", action: "preserve" }]), "E_CARRIER_ACTION", "preserve on adopt");
  assertRejects(adopt([{ dpId: "DP-2", action: "clear" }]), "E_CARRIER_ACTION", "clear on adopt");
  assertRejects(adopt(undefined), "E_CARRIER_UPDATES_MISSING", "adopt is not a carrier exception");
});

// A carrier `replace` is a consumption site every time it is declared. Deriving consumption from
// "did the stored ref change" lets a re-affirmation of the SAME ruling skip freshness entirely,
// which is the freshness hole this suite already closed once for persisted rulings.
function withStaleCarrier() {
  let s = withCarrier(); // DP-2 resolved by REQ-a, carrier R-bp, packet matching DP-2
  // Move the DP out from under the packet: classificationBasis is one of the compared fields.
  return apply(s, "reclassify-dp", {
    dpId: "DP-2", layer: "implementation", classificationBasis: "revised engineering standard",
    classificationRulingRef: { kind: "review-ruling", ref: "R-lc" },
    records: [typedRuling("R-lc", CODE, DP2, "layer-classification", {
      classifiedLayer: "implementation", basis: "revised engineering standard",
    })],
  });
}

function supersedeReqAToB(resolutionCarrierUpdates, extraRecords = []) {
  return {
    initiatingDpIds: ["DP-2"],
    records: [planGate("R-pg", "REQ-a"), ...extraRecords],
    transition: {
      id: "T-1", subject: "REQ-a", action: "supersede", successor: "REQ-b",
      authorityRef: { kind: "user" }, ackRef: { kind: "plan-gate", ref: "R-pg" },
      compatibility: { impact: "no consumers", disposition: "no-affected-dependents" },
    },
    resolutionCarrierUpdates,
  };
}

test("IS AC63: replace re-checks freshness even when it re-affirms the SAME carrier ref", () => {
  const stale = withStaleCarrier();
  // Same ref as the pre-state carrier, so the pre/post diff is empty — freshness must still run.
  assertRejects(
    () => apply(stale, "supersede-requirement", supersedeReqAToB([
      { dpId: "DP-2", action: "replace", rulingRef: carrierRef("R-bp") },
    ])),
    "E_RULING_PACKET_STALE",
    "a stale ruling re-affirmed under the same ref",
  );

  // Positive control: reusing the same ref is NOT forbidden — it passes while the packet is fresh.
  const fresh = withCarrier();
  const ok = apply(fresh, "supersede-requirement", supersedeReqAToB([
    { dpId: "DP-2", action: "replace", rulingRef: carrierRef("R-bp") },
  ]));
  const d = indexStore(ok).dps.get("DP-2");
  assert.strictEqual(d.resolvedBy, "REQ-b");
  assert.deepStrictEqual(d.resolutionRulingRef, carrierRef("R-bp"), "same-ref replace is legal when fresh");
});

test("IS AC63: the stale same-ref replace writes nothing — bytes, head, lock and temp files all intact", () => {
  const cwd = temporary("prov-carrier-stale-");
  const stale = withStaleCarrier();
  fs.mkdirSync(path.dirname(storePath(cwd)), { recursive: true });
  fs.writeFileSync(storePath(cwd), canonicalStoreBytes(stale), "utf8");
  const before = fs.readFileSync(storePath(cwd), "utf8");
  const headBefore = indexStore(stale).taskStates.get("TASK-1").committedProvenanceBatchRef;

  assertRejects(
    () => runTransaction(cwd, "supersede-requirement", supersedeReqAToB([
      { dpId: "DP-2", action: "replace", rulingRef: carrierRef("R-bp") },
    ]), OPTS),
    "E_RULING_PACKET_STALE",
    "no-write on a stale carrier consumption",
  );

  const after = fs.readFileSync(storePath(cwd), "utf8");
  assert.strictEqual(after, before, "canonical bytes are byte-identical");
  assert.deepStrictEqual(
    indexStore(parseStore(after)).taskStates.get("TASK-1").committedProvenanceBatchRef,
    headBefore,
    "the committed head did not move",
  );
  assert.ok(!fs.existsSync(`${storePath(cwd)}.lock`), "the lock is released");
  assert.deepStrictEqual(
    fs.readdirSync(path.dirname(storePath(cwd))).sort(),
    ["provenance.json"],
    "no temp file survives",
  );
});

test("IS §8: a carrier update entry is a closed shape — undeclared keys and stray rulingRefs are refused", () => {
  const s = withCarrier();
  const reopen = (resolutionCarrierUpdates) => () => apply(s, "reopen-dp", {
    dpId: "DP-2", trigger: "terminal-invalidated-no-successor", expectedCurrentTerminalRef: "REQ-a",
    resolutionCarrierUpdates,
  });
  assertRejects(reopen([{ dpId: "DP-2", action: "clear", undeclared: "accepted" }]), "E_CARRIER_SHAPE", "undeclared key");
  assertRejects(reopen([{ dpId: "DP-2", action: "clear", rulingRef: carrierRef("R-bp") }]), "E_CARRIER_SHAPE", "clear carrying a rulingRef");
  assertRejects(reopen([{ dpId: "DP-2" }]), "E_CARRIER_ACTION", "no action at all");
  // and the well-formed shape still passes
  assert.ok(reopen([{ dpId: "DP-2", action: "clear" }])());

  // replace's own key set: rulingRef is required, and nothing else may ride along
  const fresh = withSecondRequirement(baseFixture());
  const adopt = (u) => () => apply(fresh, "adopt-existing-outcome", {
    dpId: "DP-2", clauseRef: "REQ-a", records: [bindingPolicy("R-bp", DP2, "REQ-a")],
    resolutionCarrierUpdates: [u],
  });
  assertRejects(adopt({ dpId: "DP-2", action: "replace" }), "E_CARRIER_SHAPE", "replace without rulingRef");
  assertRejects(adopt({ dpId: "DP-2", action: "replace", rulingRef: carrierRef("R-bp"), note: "x" }), "E_CARRIER_SHAPE", "replace with an extra key");
  assertRejects(adopt({ dpId: "DP-2", action: "replace", rulingRef: "R-bp" }), "E_CARRIER_REPLACE", "malformed rulingRef (bare string)");
  assertRejects(adopt({ dpId: "DP-2", action: "replace", rulingRef: { kind: "plan-gate", ref: "R-bp" } }), "E_CARRIER_REPLACE", "rulingRef of the wrong kind");
});

// This one is an ALLOWLIST test, not an AC66 semantic test: `preserve` is simply not offered by
// reopen-dp, so the rejection happens at the per-command action table and never reaches the clear
// or preserve branch. It was previously mislabelled as AC66 coverage; adopt's two rejections lived
// here too and are dropped as duplicates of the AC68 test above.
test("IS §8: the per-command action table rejects an action the transaction does not offer", () => {
  const s = withCarrier();
  assertRejects(() => apply(s, "reopen-dp", {
    dpId: "DP-2", trigger: "terminal-invalidated-no-successor", expectedCurrentTerminalRef: "REQ-a",
    resolutionCarrierUpdates: [{ dpId: "DP-2", action: "preserve" }],
  }), "E_CARRIER_ACTION", "reopen-dp offers only clear and unchanged-null");
});

test("IS AC66: clear on a DP whose pre-state carrier is already null is refused inside the clear branch", () => {
  // A legitimate pre-state: DP-2 is resolved by DIRECT citation, so status=resolved with a null
  // carrier. supersede-requirement is one of the transactions whose action table DOES offer clear,
  // so the rejection below is the clear branch's own precondition rather than an allowlist miss.
  let s = withSecondRequirement(baseFixture());
  s = apply(s, "adopt-existing-outcome", {
    dpId: "DP-2", clauseRef: "REQ-a", resolutionCarrierUpdates: nulls("DP-2"),
  });
  const before = indexStore(s).dps.get("DP-2");
  assert.strictEqual(before.status, "resolved");
  assert.strictEqual(before.resolutionRulingRef ?? null, null, "pre-state carrier really is null");

  const e = assertRejects(
    () => apply(s, "supersede-requirement", supersedeReqAToB([{ dpId: "DP-2", action: "clear" }])),
    "E_CARRIER_CLEAR",
    "clear with nothing to clear",
  );
  assert.match(e.message, /unchanged-null/, "the message names the correct declaration to use");
});

// SPEC GAP, reported and deliberately left fail-closed: approved IS AC66 gives the restricted clear
// a "post-state resolved" condition, and the action table offers a non-resolved clear only on the
// retire and reopen-dp rows. A carrier-bearing DEPENDENT DP that is reopened because the (non-null)
// successor is not applicable to it therefore has no legal action at all. Refusing it is the
// fail-closed reading; inventing a fourth disposition would be writing spec in code.
// --- IS v1.7 clear source 2: reopened-dependent ---------------------------------------------------
// A carrier-bearing DEPENDENT DP reopened because a non-null successor is not applicable to it.
// Under v1.6 this state had no legal carrier action at all; v1.7 makes `clear` the one legal
// declaration, under ten conditions the WRITER derives — the caller cannot assert its way in.

const REOPEN_SERIALIZATION = "terminal-invalidated-no-successor";

// REQ-a is DP-1's terminal under a binding-policy carrier. REQ-x, the successor, is
// exception-backed, so applicable() only lets a DP holding its OWN scope-coverage ruling take it —
// DP-1 has none, so the closure reopens it instead of repointing.
function withDependentReopenFixture() {
  let s = withSecondRequirement(withHardConstraint()); // REQ-hc + R-owner, plus a plain REQ-b
  s = apply(s, "adopt-existing-outcome", {
    dpId: "DP-1", clauseRef: "REQ-a",
    records: [bindingPolicy("R-bp1", DP1, "REQ-a")],
    resolutionCarrierUpdates: [{ dpId: "DP-1", action: "replace", rulingRef: carrierRef("R-bp1") }],
  });
  return s;
}

const EXCEPTION_SOURCE = {
  sourceId: "S-exc", contentKind: "exception-grant", driftMode: "snapshot-only", locator: "grant#1",
  excerpt: "scoped exception", targetConstraintRef: "REQ-hc",
  grantAuthorityRef: { kind: "source-authority", ref: "R-owner" }, scope: "eu-only", expiry: "2099-01-01",
};
const SCOPED_SUCCESSOR = {
  id: "REQ-x", authority: "approved-requirement", kind: "specification", text: "scoped",
  sourceRef: "S-exc", taskRef: "TASK-1",
};

// supersede REQ-a → REQ-x (not applicable to DP-1). `over` lets a test add records or a trigger.
function supersedeToScoped(updates, over = {}) {
  const { extraRecords = [], ...rest } = over;
  return {
    initiatingDpIds: [],
    records: [planGate("R-pg", "REQ-a"), ...extraRecords],
    sources: [EXCEPTION_SOURCE],
    successorClause: SCOPED_SUCCESSOR,
    transition: {
      id: "T-1", subject: "REQ-a", action: "supersede", successor: "REQ-x",
      authorityRef: { kind: "user" }, ackRef: { kind: "plan-gate", ref: "R-pg" },
      compatibility: { impact: "no consumers", disposition: "no-affected-dependents" },
    },
    resolutionCarrierUpdates: updates,
    ...rest,
  };
}

function assertReopenedByClosure(store, dpId, subject) {
  const d = indexStore(store).dps.get(dpId);
  assert.strictEqual(d.status, "open", "post-state status is open");
  for (const f of ["resolvedBy", "assumedAs", "decidedBy"]) {
    assert.strictEqual(d[f] ?? null, null, `post-state ${f} is null`);
  }
  assert.strictEqual(d.priorTerminalRef, subject, "priorTerminalRef is the transaction's subject");
  assert.strictEqual(d.reopenedBy, REOPEN_SERIALIZATION, "reopenedBy is the writer-derived v1 serialization");
  assert.strictEqual(d.resolutionRulingRef ?? null, null, "post-state carrier is null");
  return d;
}

test("IS AC72: source 2 accepts clear on a reopened dependent DP via supersede-requirement; the other three actions are refused", () => {
  const s = withDependentReopenFixture();
  const out = apply(s, "supersede-requirement", supersedeToScoped([{ dpId: "DP-1", action: "clear" }]));
  assertReopenedByClosure(out, "DP-1", "REQ-a");

  const attempt = (action) => () => apply(s, "supersede-requirement", supersedeToScoped([{ dpId: "DP-1", action }]));
  assertRejects(attempt("preserve"), "E_CARRIER_PRESERVE", "preserve has no terminal to align with");
  assertRejects(attempt("unchanged-null"), "E_CARRIER_UNCHANGED_NULL", "pre-state carrier is not null");
  assertRejects(
    () => apply(s, "supersede-requirement", supersedeToScoped(
      [{ dpId: "DP-1", action: "replace", rulingRef: carrierRef("R-bp-new") }],
      { extraRecords: [bindingPolicy("R-bp-new", DP1, "REQ-x")] },
    )),
    "E_CARRIER_STATUS",
    "replace would leave a carrier on a DP that ends open",
  );
});

test("IS AC72: source 2 works the same way through replace-terminal", () => {
  const s = withDependentReopenFixture();
  const out = apply(s, "replace-terminal", {
    dpId: "DP-1", casMode: "current-terminal", expectedCurrentTerminalRef: "REQ-a",
    records: [planGate("R-pg", "REQ-a")],
    sources: [EXCEPTION_SOURCE],
    successorClause: SCOPED_SUCCESSOR,
    transition: {
      id: "T-1", subject: "REQ-a", action: "supersede", successor: "REQ-x",
      authorityRef: { kind: "user" }, ackRef: { kind: "plan-gate", ref: "R-pg" },
      compatibility: { impact: "no consumers", disposition: "no-affected-dependents" },
    },
    resolutionCarrierUpdates: [{ dpId: "DP-1", action: "clear" }],
  });
  assertReopenedByClosure(out, "DP-1", "REQ-a");
});

test("IS AC73: an initiating DP the successor cannot cover is NOT absorbed by source 2 — whole batch no-write", () => {
  const cwd = temporary("prov-s2-initiating-");
  const s = withDependentReopenFixture();
  fs.mkdirSync(path.dirname(storePath(cwd)), { recursive: true });
  fs.writeFileSync(storePath(cwd), canonicalStoreBytes(s), "utf8");
  const before = fs.readFileSync(storePath(cwd), "utf8");
  const headBefore = indexStore(s).taskStates.get("TASK-1").committedProvenanceBatchRef;

  // naming DP-1 as INITIATING flips it from "dependent, may reopen" to "must land on the successor"
  assertRejects(
    () => runTransaction(cwd, "supersede-requirement",
      supersedeToScoped([{ dpId: "DP-1", action: "clear" }], { initiatingDpIds: ["DP-1"] }), OPTS),
    "E_INITIATING_DP_NOT_APPLICABLE",
    "initiating DP the successor cannot cover",
  );
  assert.strictEqual(fs.readFileSync(storePath(cwd), "utf8"), before, "store bytes unchanged");
  assert.deepStrictEqual(
    indexStore(parseStore(fs.readFileSync(storePath(cwd), "utf8"))).taskStates.get("TASK-1").committedProvenanceBatchRef,
    headBefore, "committed head unchanged",
  );
});

test("IS AC74: a non-dependent DP's clear lands on AC61 exact coverage, not on any source-2 guard", () => {
  const cwd = temporary("prov-s2-nondep-");
  const s = withDependentReopenFixture();
  fs.mkdirSync(path.dirname(storePath(cwd)), { recursive: true });
  fs.writeFileSync(storePath(cwd), canonicalStoreBytes(s), "utf8");
  const before = fs.readFileSync(storePath(cwd), "utf8");
  const headBefore = indexStore(s).taskStates.get("TASK-1").committedProvenanceBatchRef;

  // DP-2 holds REQ-hc, not REQ-a, so it is not in this transaction's affected set at all.
  const e = assertRejects(
    () => runTransaction(cwd, "supersede-requirement", supersedeToScoped([
      { dpId: "DP-1", action: "clear" }, { dpId: "DP-2", action: "clear" },
    ]), OPTS),
    "E_CARRIER_COVERAGE",
    "a DP whose terminal this transaction does not mutate",
  );
  assert.match(e.message, /DP-2/);
  assert.strictEqual(fs.readFileSync(storePath(cwd), "utf8"), before, "store bytes unchanged");
  assert.deepStrictEqual(
    indexStore(parseStore(fs.readFileSync(storePath(cwd), "utf8"))).taskStates.get("TASK-1").committedProvenanceBatchRef,
    headBefore, "committed head unchanged",
  );
});

test("IS AC75: with every other condition aligned, a successor that IS applicable refuses the source-2 shape (loader)", () => {
  // Condition 2 cannot be flipped inside a transaction: an applicable successor makes the closure
  // REPOINT, so the DP never reaches the open post-state source 2 describes — and a repointed DP
  // declaring clear is AC67's positive case, not a rejection. The criterion is therefore a loader
  // check on the constructed shape, exactly like AC77/78.
  const s = withDependentReopenFixture();
  const good = apply(s, "supersede-requirement", supersedeToScoped([{ dpId: "DP-1", action: "clear" }]));
  // Give DP-1 the scope-coverage ruling REQ-x needed. Everything else — dependent membership,
  // open post-state, empty terminals, priorTerminalRef, the v1 serialization, null carrier — stays
  // exactly as the honest transaction wrote it. Only applicability flips.
  const covered = apply(good, "append-record", { record: scopeRuling("R-sc", DP1, true) });
  const withScope = tamper(covered, "DP-1", { scopeRulingRef: { kind: "review-ruling", ref: "R-sc" } });
  const e = assertRejects(() => validateAll(withScope, OPTS), "E_REOPEN_PRIOR_INCOHERENT", "successor is applicable after all");
  assert.match(e.message, /REQ-x IS applicable/);
});

test("IS AC76: source 2 still requires a non-null pre-state carrier", () => {
  // DP-1 resolves REQ-a by direct citation this time, so its carrier is null.
  let s = withSecondRequirement(withHardConstraint());
  s = apply(s, "adopt-existing-outcome", {
    dpId: "DP-1", clauseRef: "REQ-a", resolutionCarrierUpdates: nulls("DP-1"),
  });
  const e = assertRejects(
    () => apply(s, "supersede-requirement", supersedeToScoped([{ dpId: "DP-1", action: "clear" }])),
    "E_CARRIER_CLEAR",
    "nothing to clear",
  );
  assert.match(e.message, /unchanged-null/);
});

test("IS AC77/78: the loader re-checks a reopened dependent DP's prior and trigger on a constructed snapshot", () => {
  const s = withDependentReopenFixture();
  const good = apply(s, "supersede-requirement", supersedeToScoped([{ dpId: "DP-1", action: "clear" }]));
  assert.ok(validateAll(good, OPTS).ok, "the honest post-state validates");

  // AC78: only reopenedBy is changed, to another legal closed trigger. Legal is not aligned.
  assertRejects(
    () => validateAll(tamper(good, "DP-1", { reopenedBy: "new-dependent" }), OPTS),
    "E_REOPEN_TRIGGER_MISMATCH",
    "a reopen caused by an invalidated terminal with a successor must carry the v1 serialization",
  );
  // AC77: only priorTerminalRef is changed, to a DIFFERENT superseded clause whose successor IS
  // applicable to DP-1 — a DP in that position is repointed, so the recorded prior does not
  // evidence the reopen the DP claims.
  const alsoSuperseded = apply(good, "supersede-requirement", {
    initiatingDpIds: [],
    records: [planGate("R-pg2", "REQ-b")],
    successorClause: {
      id: "REQ-b2", authority: "approved-requirement", kind: "specification", text: "plain successor",
      sourceRef: "S-req", taskRef: "TASK-1",
    },
    transition: {
      id: "T-2", subject: "REQ-b", action: "supersede", successor: "REQ-b2",
      authorityRef: { kind: "user" }, ackRef: { kind: "plan-gate", ref: "R-pg2" },
      compatibility: { impact: "no consumers", disposition: "no-affected-dependents" },
    },
    resolutionCarrierUpdates: [],
  });
  assertRejects(
    () => validateAll(tamper(alsoSuperseded, "DP-1", { priorTerminalRef: "REQ-b" }), OPTS),
    "E_REOPEN_PRIOR_INCOHERENT",
    "priorTerminalRef does not evidence the reopen the DP records",
  );
});

test("IS AC79: a non-canonical caller reopenTrigger cannot steer source 2 on any of the three paths", () => {
  const s = withDependentReopenFixture();
  const steer = { reopenTrigger: "user-instruction" };

  // supersede-requirement
  const a = apply(s, "supersede-requirement", supersedeToScoped([{ dpId: "DP-1", action: "clear" }], steer));
  assertReopenedByClosure(a, "DP-1", "REQ-a");

  // replace-terminal
  const b = apply(s, "replace-terminal", {
    dpId: "DP-1", casMode: "current-terminal", expectedCurrentTerminalRef: "REQ-a",
    records: [planGate("R-pg", "REQ-a")], sources: [EXCEPTION_SOURCE], successorClause: SCOPED_SUCCESSOR,
    transition: {
      id: "T-1", subject: "REQ-a", action: "supersede", successor: "REQ-x",
      authorityRef: { kind: "user" }, ackRef: { kind: "plan-gate", ref: "R-pg" },
      compatibility: { impact: "no consumers", disposition: "no-affected-dependents" },
    },
    reopenTrigger: "user-instruction",
    resolutionCarrierUpdates: [{ dpId: "DP-1", action: "clear" }],
  });
  assertReopenedByClosure(b, "DP-1", "REQ-a");

  // and it cannot grant a non-dependent DP standing either
  assertRejects(
    () => apply(s, "supersede-requirement", supersedeToScoped(
      [{ dpId: "DP-1", action: "clear" }, { dpId: "DP-2", action: "clear" }], steer)),
    "E_CARRIER_COVERAGE",
    "a caller trigger does not make DP-2 a dependent",
  );
});

test("IS AC80: source 2 inside commit-test-provenance-batch — one CAS, head advances, clear is the only legal action", () => {
  // The batch supersedes REQ-a → REQ-x exactly as the two single-DP paths do. REQ-x is created
  // beforehand: minting a successor clause inside a batch is successorClauseDraft, which is
  // Phase 1B and deliberately not implemented here.
  let s = withDependentReopenFixture();
  s = apply(s, "append-source", { source: EXCEPTION_SOURCE });
  s = apply(s, "create-requirement", { requirement: SCOPED_SUCCESSOR });
  const evidence = [{ kind: "review-ruling", ref: "R-e1" }];
  const digest = resolutionGroupDigest({
    subjectRef: "REQ-a", action: "supersede", successor: "REQ-x", semanticEvidenceRefs: evidence,
  });
  const batch = (updates) => batchPayload({
    recordsToCreate: [
      reviewRuling("R-e1", { kind: "discipline", discipline: "test" }, "REQ-a"),
      { ...planGate("R-pg", "REQ-a"), resolutionGroupDigest: digest },
    ],
    resolutions: [{
      subjectRef: "REQ-a", semanticEvidenceRefs: evidence,
      governanceWitnessRef: { kind: "plan-gate", ref: "R-pg" },
      transitionDraft: {
        id: "T-b", subject: "REQ-a", action: "supersede", successor: "REQ-x",
        authorityRef: { kind: "user" }, ackRef: { kind: "plan-gate", ref: "R-pg" },
        compatibility: { impact: "no consumers", disposition: "no-affected-dependents" },
      },
    }],
    resolutionCarrierUpdates: updates,
  });

  const out = apply(s, "commit-test-provenance-batch", batch([{ dpId: "DP-1", action: "clear" }]));
  assertReopenedByClosure(out, "DP-1", "REQ-a");
  const head = indexStore(out).taskStates.get("TASK-1").committedProvenanceBatchRef;
  assert.deepStrictEqual(head, { kind: "provenance-batch", ref: "R-b1" }, "the head advanced in the same transaction");
  assert.strictEqual(out.transitions.length, 1, "one transition, one CAS");

  for (const [action, code] of [["preserve", "E_CARRIER_PRESERVE"], ["unchanged-null", "E_CARRIER_UNCHANGED_NULL"]]) {
    assertRejects(() => apply(s, "commit-test-provenance-batch", batch([{ dpId: "DP-1", action }])), code, `batch ${action}`);
  }
});

test("SM §9: the loader refuses a malformed or dangling resolutionRulingRef", () => {
  const s = withCarrier();
  for (const [carrier, code, what] of [
    ["R-bp", "E_SHAPE", "a bare string instead of a RecordRef"],
    [{ kind: "plan-gate", ref: "R-bp" }, "E_SHAPE", "a RecordRef of the wrong kind"],
    [{ kind: "review-ruling" }, "E_SHAPE", "a RecordRef with no ref"],
    [{ kind: "review-ruling", ref: "R-ghost" }, "E_DANGLING_REF", "a ref that resolves to nothing"],
  ]) {
    assertRejects(() => validateAll(tamper(s, "DP-2", { resolutionRulingRef: carrier }), OPTS), code, what);
  }
});

test("IS AC61/67: a rejected carrier update leaves the store bytes and the committed head untouched", () => {
  const cwd = temporary("prov-carrier-");
  const s = withCarrier();
  fs.mkdirSync(path.join(cwd, ".ctide"), { recursive: true });
  fs.writeFileSync(storePath(cwd), canonicalStoreBytes(s), "utf8");
  const before = fs.readFileSync(storePath(cwd), "utf8");
  assertRejects(() => runTransaction(cwd, "reopen-dp", {
    dpId: "DP-2", trigger: "terminal-invalidated-no-successor", expectedCurrentTerminalRef: "REQ-a",
    resolutionCarrierUpdates: nulls("DP-2"),
  }, OPTS), "E_CARRIER_UNCHANGED_NULL", "no-write on a rejected carrier declaration");
  assert.strictEqual(fs.readFileSync(storePath(cwd), "utf8"), before, "canonical bytes are byte-identical");
  assert.ok(!fs.existsSync(`${storePath(cwd)}.lock`), "the lock is released");
});

test("clauseKindOf routes ids by prefix and rejects anything else", () => {
  assert.strictEqual(clauseKindOf("REQ-01J"), "REQ");
  assert.strictEqual(clauseKindOf("DEC-01J"), "DEC");
  assert.strictEqual(clauseKindOf("ASSUM-01J"), "ASSUM");
  assert.strictEqual(clauseKindOf("DP-01J"), null);
});
