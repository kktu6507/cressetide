// The v2 commit-test-provenance-batch WRITE contract: the captured-file CAS and its three-value
// binding, the raw payload-text ingestion boundary, proposal completeness, exact result/entry
// coverage, the TP §6 Resolution union with its this-round evidence equalities, and the
// acknowledgement/witness identity rule.
//
// Spec anchors (the current approved coupled set, read as ONE effective set):
//   SM = 2026-07-25-shared-decision-provenance-model.md (approved v1.15) §2 record shape and the
//        conditional resolutionGroupDigest, §9 canonical bytes
//   IS = 2026-07-25-intent-scan-spec.md (approved v1.10) §8 AC120/AC121/AC123/AC124
//   TP = 2026-07-25-test-provenance-spec.md (approved v1.17) §2 TestSemanticReviewBatch, §6
//        Resolution and the anti-borrowing equalities, AC126
//
// SCOPE, stated so no assertion here is read as more than it is. This file charges the WRITER. It
// does not prove outcome/post-binding correspondence, historical base-store membership of a cited
// Transition or its successor chain, source freshness, or any convergence verdict: those are Step 6's
// and are deliberately absent. Persisting a well-formed nonconverged finding is not convergence, and
// nothing here makes Phase 2 READY. (The "product gate stays closed" clause named the retired
// unsupported-populated-inventory gate and has been dropped; the writer's own scope is unchanged.)
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { temporary, root } from "./helpers.mjs";
import {
  canonicalJson, sha256Hex, digestOf, emptyStore, canonicalStoreBytes, storeDigest, storePath,
  loadStore, parseStore, indexStore, applyTransaction, runTransaction, runTransactionFromPayloadText,
  resolutionGroupDigest, validateAll, statusOf, BATCH_RECORD_VERSION, CANONICAL_STORE_PATH,
  carrierUpdateShapeFault,
} from "../cressetide/skills/vigil/scripts/provenance-store.mjs";
import { computeInventoryV2Digest } from "../cressetide/skills/vigil/scripts/changed-test-inventory.mjs";

const NOW = Date.UTC(2026, 6, 26);
const OPTS = { now: NOW };
const SCRIPT = path.join(root, "cressetide", "skills", "vigil", "scripts", "provenance-store.mjs");

const TREE = "a".repeat(40);
const BASE = { treeOid: TREE, storePath: CANONICAL_STORE_PATH, storeDigest: storeDigest(emptyStore()) };
const CODE = { kind: "discipline", discipline: "code" };
const TEST_DISCIPLINE = { kind: "discipline", discipline: "test" };
const ASSUM_A = "ASSUM-0000000000000000000000000A";
const ASSUM_B = "ASSUM-0000000000000000000000000B";
const BODY_BASE = "1".repeat(64);
const BODY_HEAD = "2".repeat(64);

// Errors cross a module boundary here: the canonical inventory reader raises its own InventoryError
// with the same `.code` contract, so the code is what is asserted rather than the class.
function refused(fn, code, what) {
  let error = null;
  try { fn(); } catch (e) { error = e; }
  assert.ok(error, `${what}: expected a refusal, got none`);
  assert.strictEqual(error.code, code, `${what}: expected ${code}, got ${error.code} (${error && error.message})`);
  return error;
}

// --- fixtures ---------------------------------------------------------------------------------------

// ONE fixed, legal ChangedTestInventoryV2 entry and the ONE result that covers it, written out side
// by side by hand. Neither is derived from the other and no override regenerates them: a builder that
// rebuilt the entry from whatever result a case supplied would make every coverage assertion
// tautological. Member names are in strictly ascending code-point order because TP AC126 (iii) makes
// an unsorted entry fail closed and forbids the writer sorting it in place.
const ENTRY = {
  baseBodyDigest: BODY_BASE,
  framework: "node-test",
  headBodyDigest: BODY_HEAD,
  implementationIdentity: { implementationId: "node-test-v2", parserId: "estree", parserVersion: "1" },
  reason: "content-change",
  status: "modified",
  tagAfter: { clauseRef: ASSUM_A },
  tagBefore: { clauseRef: ASSUM_A },
  testRef: { adapterId: "node-test-v2", path: "test/alpha.test.mjs", structuralId: 's:["alpha"]' },
};
const TEST_REF = { path: "test/alpha.test.mjs", adapterId: "node-test-v2", structuralId: 's:["alpha"]' };
const RESULT = {
  testRef: TEST_REF,
  tagBefore: { clauseRef: ASSUM_A },
  tagAfter: { clauseRef: ASSUM_A },
  observedBaseBodyDigest: BODY_BASE,
  observedHeadBodyDigest: BODY_HEAD,
  findings: [],
};

function inventory(inputProvenanceStoreDigest, over = {}) {
  const body = {
    inventoryVersion: 2,
    baseTreeOid: TREE,
    registryDigest: "b".repeat(64),
    headViewDigest: "c".repeat(64),
    inputProvenanceStoreDigest,
    entries: [ENTRY],
    ...over,
  };
  return { ...body, inventoryDigest: computeInventoryV2Digest(body) };
}

// `expected` is the pre-state digest this payload claims, and it feeds BOTH the CAS expectation and
// the inventory's own inputProvenanceStoreDigest — so a case probing one of the two bindings is never
// stopped by the other. `inventory` and `snapshot` override those layers explicitly.
function payload(expected, over = {}) {
  const { inventory: inv, snapshot, ...rest } = over;
  const used = inv === undefined ? inventory(expected) : inv;
  return {
    taskId: "TASK-1",
    batchRecordId: "R-b1",
    expectedInputProvenanceStoreDigest: expected,
    batchSnapshot: {
      taskId: "TASK-1",
      baseProvenance: BASE,
      inventoryDigest: used.inventoryDigest,
      inventorySnapshot: used,
      results: [RESULT],
      resolutions: [],
      ...snapshot,
    },
    resolutions: [],
    ...rest,
  };
}

const ruling = (recordId, by, subjectRef, extra = {}) => ({
  recordId, kind: "review-ruling", by, subjectRef, ruling: "ok", ...extra,
});

// TP §6:558-560's semantic evidence carrier: an ORDINARY untyped review-ruling whose payload also
// carries the downstream fields §6:786-791 names. shared §2's payloads are MINIMUM and shared line 4
// permits downstream fields, so there is no new record kind and no rulingKind here.
const evidenceRecord = (recordId, over = {}) => ruling(recordId, TEST_DISCIPLINE, ASSUM_A, {
  taskId: "TASK-1",
  testRef: TEST_REF,
  baseBodyDigest: BODY_BASE,
  headBodyDigest: BODY_HEAD,
  findingKind: "assum-reading-change",
  binding: { clauseRef: ASSUM_A },
  ...over,
});

// A task with no DPs: enough for every CAS, proposal, coverage and finding-shape case.
function plainTask() {
  return applyTransaction(emptyStore(), "init-task", {
    taskId: "TASK-1", baseProvenance: BASE, decisionPoints: [], currentTaskDpIds: [],
  }, OPTS);
}

// A task whose DP-1 is settled on ASSUM_A, so a real resolution group can retire or revise it.
function assumTask() {
  let s = applyTransaction(emptyStore(), "init-task", {
    taskId: "TASK-1",
    baseProvenance: BASE,
    decisionPoints: [{
      id: "DP-1", dimension: "data", scenario: "null vs absent", alternatives: ["A", "B"],
      layer: "implementation", classificationBasis: "engineering standard", materialReasons: [],
      status: "open",
    }],
    currentTaskDpIds: ["DP-1"],
  }, OPTS);
  // A requirement Source, because a REQ successor minted through a plan gate must cite one.
  s = applyTransaction(s, "append-source", {
    source: {
      sourceId: "S-req", contentKind: "requirement", driftMode: "snapshot-only",
      locator: "conversation#1", excerpt: "the reviewed reading of the null case",
    },
  }, OPTS);
  return applyTransaction(s, "create-initial-outcome", {
    dpId: "DP-1",
    records: [ruling("R-rule1", CODE, "DP-1")],
    clause: {
      id: ASSUM_A, layer: "implementation", derivedFrom: "DP-1", text: "treat null as absent",
      alternative: "treat null as invalid", basis: "matches the option table", basisRefs: [],
      governedBy: CODE, routingOrigin: "safe-default",
    },
  }, OPTS);
}

// A store on disk, written with the EXACT bytes asked for, plus everything a no-write assertion needs.
function onDisk(store, spell = (bytes) => bytes) {
  const cwd = temporary("prov-writer-");
  const file = storePath(cwd);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, spell(canonicalStoreBytes(store)), "utf8");
  return { cwd, file, before: fs.readFileSync(file, "utf8"), digest: loadStore(cwd).digest };
}

function assertNothingWritten(ctx, what) {
  assert.strictEqual(fs.readFileSync(ctx.file, "utf8"), ctx.before, `${what}: store bytes unchanged`);
  assert.ok(!fs.existsSync(`${ctx.file}.lock`), `${what}: lock released`);
  assert.deepStrictEqual(fs.readdirSync(path.dirname(ctx.file)).sort(), ["provenance.json"],
    `${what}: no temp residue`);
}

const cli = (cwd, args) => spawnSync(process.execPath, [SCRIPT, "commit-test-provenance-batch", "--cwd", cwd, ...args],
  { encoding: "utf8" });

function cliError(result, what) {
  assert.notStrictEqual(result.status, 0, `${what}: expected a non-zero exit, got ${result.status}`);
  let body = null;
  try { body = JSON.parse(result.stderr.trim().split("\n").pop()); } catch { /* reported below */ }
  assert.ok(body, `${what}: expected a machine-readable refusal, got ${JSON.stringify(result.stderr)}`);
  return body;
}

// --- 1. the captured-file CAS and its three-value binding (IS §8, AC120/AC121/AC123) ----------------

test("AC120: the CAS is over the TEXT the transaction really loaded — canonical, pretty and BOM/CRLF all commit", () => {
  const spellings = [
    ["canonical", (b) => b],
    ["pretty-printed", (b) => `${JSON.stringify(JSON.parse(b), null, 2)}\n`],
    ["BOM + CRLF", (b) => `﻿${b.replace(/\n/g, "\r\n")}`],
  ];
  for (const [what, spell] of spellings) {
    const ctx = onDisk(plainTask(), spell);
    const out = runTransaction(ctx.cwd, "commit-test-provenance-batch", payload(ctx.digest), OPTS);
    assert.strictEqual(out.changed, true, `${what}: the write lands`);
    const rec = indexStore(loadStore(ctx.cwd).store).records.get("R-b1");
    assert.strictEqual(rec.batchRecordVersion, BATCH_RECORD_VERSION, `${what}: version 2 persisted`);
  }
});

test("AC120: re-serialising the parsed store is a DIFFERENT digest, and it is not the one the CAS accepts", () => {
  // The discriminating case is a pretty-printed file: canonicalStoreBytes re-sorts and re-indents, so
  // storeDigest(the parsed object) is the hash of a byte sequence the file never held. A writer that
  // recomputed the pre-state that way would accept an expectation the upstream producer never saw.
  const ctx = onDisk(plainTask(), (b) => `${JSON.stringify(JSON.parse(b), null, 2)}\n`);
  const reserialised = storeDigest(loadStore(ctx.cwd).store);
  assert.notStrictEqual(reserialised, ctx.digest, "the two notations must actually differ, or this proves nothing");
  const e = refused(() => runTransaction(ctx.cwd, "commit-test-provenance-batch", payload(reserialised), OPTS),
    "E_CAS_MISMATCH", "the parsed object's canonical digest substituted for the file's");
  assert.match(e.message, /the store this transaction loaded hashes to/);
  assertNothingWritten(ctx, "object-digest substitution");
});

test("AC121: a stale caller expectation is a CAS mismatch — value 1 against value 2 — and writes nothing", () => {
  const ctx = onDisk(plainTask());
  const stale = sha256Hex("some earlier store");
  refused(() => runTransaction(ctx.cwd, "commit-test-provenance-batch", payload(stale), OPTS),
    "E_CAS_MISMATCH", "an expectation naming a pre-state this store never had");
  assertNothingWritten(ctx, "stale CAS expectation");
});

test("AC123: an inventory computed against ANOTHER pre-state is its own failure — value 2 against value 3", () => {
  // Kept strictly apart from AC121: here the caller's expectation DOES match the loaded store, and the
  // only thing wrong is that the inventory it submits was produced against something else. Merging the
  // two would let "I refreshed the CAS expectation and resubmitted the same inventory" pass as a
  // mismatch that was already reported.
  const ctx = onDisk(plainTask());
  const elsewhere = inventory(sha256Hex("a different pre-state"));
  const e = refused(() => runTransaction(ctx.cwd, "commit-test-provenance-batch",
    payload(ctx.digest, { inventory: elsewhere }), OPTS),
    "E_INVENTORY_BINDING", "a fresh CAS expectation carrying a stale inventory");
  assert.match(e.message, /is a DIFFERENT failure from a CAS mismatch/);
  assertNothingWritten(ctx, "inventory binding");
});

test("AC120: no option a caller can set overrides the captured digest — bogus capture options are ignored", () => {
  // The private transaction context is not reachable from `options`. A payload that is otherwise
  // valid must still commit while the caller lies about every capture field it can think of.
  const ctx = onDisk(plainTask());
  const out = runTransaction(ctx.cwd, "commit-test-provenance-batch", payload(ctx.digest), {
    ...OPTS,
    loadedDigest: sha256Hex("a digest the caller wishes were true"),
    payloadText: '{"batchSnapshot":{"inventorySnapshot":{}}}',
    source: { origin: "file", loadedDigest: sha256Hex("nor this one") },
  });
  assert.strictEqual(out.changed, true, "the valid write still lands");

  // …and the same options cannot rescue an invalid one.
  const ctx2 = onDisk(plainTask());
  refused(() => runTransaction(ctx2.cwd, "commit-test-provenance-batch", payload(sha256Hex("stale")), {
    ...OPTS, loadedDigest: sha256Hex("stale"), source: { origin: "file", loadedDigest: sha256Hex("stale") },
  }), "E_CAS_MISMATCH", "capture options offered as a substitute for the real digest");
  assertNothingWritten(ctx2, "bogus capture options");
});

test("AC120: the expectation is a required 64-hex field, and the in-memory path says what it compares", () => {
  const s = plainTask();
  refused(() => applyTransaction(s, "commit-test-provenance-batch",
    { ...payload(storeDigest(s)), expectedInputProvenanceStoreDigest: undefined }, OPTS),
    "E_PAYLOAD_MISSING", "no expectation at all");
  refused(() => applyTransaction(s, "commit-test-provenance-batch", payload("not-a-digest"), OPTS),
    "E_CAS_EXPECTATION", "an expectation outside the digest grammar");

  // The pure helper was handed an object and no file bytes; its message must not advertise the
  // file-backed CAS it cannot perform.
  const e = refused(() => applyTransaction(s, "commit-test-provenance-batch", payload(sha256Hex("x")), OPTS),
    "E_CAS_MISMATCH", "an in-memory pre-state mismatch");
  assert.match(e.message, /no file was read on this path/);
  assert.ok(applyTransaction(s, "commit-test-provenance-batch", payload(storeDigest(s)), OPTS),
    "and the honest in-memory expectation is accepted");
});

// --- 2. the raw payload-text ingestion boundary (SM §2:413-431, TP AC126) ---------------------------

// A duplicate member exists ONLY in the submitted bytes: JSON.parse is last-write-wins, so an object
// built from the same document cannot carry the negative. Each case is written as text and submitted
// through the text API and both CLI forms.
function payloadTextWith(ctx, mutate) {
  const text = JSON.stringify(payload(ctx.digest));
  const mutated = mutate(text);
  assert.notStrictEqual(mutated, text, "the fixture must actually have been mutated");
  return mutated;
}

test("SM v1.14 raw contract: a duplicate member inside the inventorySnapshot is refused at ingestion", () => {
  const ctx = onDisk(plainTask());
  const text = payloadTextWith(ctx, (t) => t.replace('"inventoryVersion":2', '"inventoryVersion":2,"inventoryVersion":2'));
  refused(() => runTransactionFromPayloadText(ctx.cwd, "commit-test-provenance-batch", text, OPTS),
    "E_DUPLICATE_MEMBER", "a plain duplicate inside the inventory subtree");
  assertNothingWritten(ctx, "raw duplicate");

  // The same document as an OBJECT cannot carry it — which is why the text API exists at all.
  assert.ok(runTransaction(ctx.cwd, "commit-test-provenance-batch", JSON.parse(text), OPTS).changed,
    "the parsed form has already lost the evidence and is a legal payload");
});

test("SM v1.14 raw contract: an ESCAPED duplicate spelling is the same member name", () => {
  const ctx = onDisk(plainTask());
  const text = payloadTextWith(ctx, (t) => t.replace('"entries":', '"\\u0065ntries":[],"entries":'));
  refused(() => runTransactionFromPayloadText(ctx.cwd, "commit-test-provenance-batch", text, OPTS),
    "E_DUPLICATE_MEMBER", "names compared after escape decoding");
  assertNothingWritten(ctx, "escaped duplicate");
});

test("SM v1.14 raw contract: a duplicate NESTED inside an entry is caught too", () => {
  const ctx = onDisk(plainTask());
  const text = payloadTextWith(ctx, (t) => t.replace('"framework":"node-test"', '"framework":"node-test","framework":"node-test"'));
  refused(() => runTransactionFromPayloadText(ctx.cwd, "commit-test-provenance-batch", text, OPTS),
    "E_DUPLICATE_MEMBER", "a duplicate one level down");
  assertNothingWritten(ctx, "nested duplicate");
});

test("TP AC126 (iii) raw contract: an entry whose members are not in ascending source order is refused", () => {
  const ctx = onDisk(plainTask());
  // One clean swap inside the entry — "status" moved ahead of "reason" — so the document is
  // well-formed, carries no duplicate, and differs from the accepted one ONLY in source order.
  const text = payloadTextWith(ctx, (t) => t.replace(
    '"reason":"content-change","status":"modified"', '"status":"modified","reason":"content-change"'));
  refused(() => runTransactionFromPayloadText(ctx.cwd, "commit-test-provenance-batch", text, OPTS),
    "E_ORDER", "an entry whose source member order is not ascending");
  assertNothingWritten(ctx, "entry member order");
});

test("TP AC126 (iii): entries[] out of (path, adapterId, structuralId) order is refused, not sorted", () => {
  const ctx = onDisk(plainTask());
  const second = {
    ...ENTRY,
    testRef: { adapterId: "node-test-v2", path: "test/beta.test.mjs", structuralId: 's:["beta"]' },
  };
  const unsorted = inventory(ctx.digest, { entries: [second, ENTRY] });   // beta before alpha
  refused(() => runTransaction(ctx.cwd, "commit-test-provenance-batch",
    payload(ctx.digest, { inventory: unsorted }), OPTS),
    "E_ORDER", "descending entries[]");
  assertNothingWritten(ctx, "entry ordering");
});

test("SM v1.14: reordering the inventory ROOT's members is legal — only the key SET is fixed there", () => {
  const ctx = onDisk(plainTask());
  const text = payloadTextWith(ctx, (t) => t.replace('"inventoryVersion":2,', '').replace('"entries":', '"inventoryVersion":2,"entries":'));
  assert.ok(runTransactionFromPayloadText(ctx.cwd, "commit-test-provenance-batch", text, OPTS).changed,
    "a root whose members are in another order still commits");
});

test("both CLI forms carry the submitted bytes: --payload-file and --payload refuse the same duplicate", () => {
  for (const form of ["payload-file", "payload"]) {
    const ctx = onDisk(plainTask());
    const text = payloadTextWith(ctx, (t) => t.replace('"inventoryVersion":2', '"inventoryVersion":2,"inventoryVersion":2'));
    const args = form === "payload-file"
      ? ["--payload-file", (() => {
        const f = path.join(ctx.cwd, "payload.json");
        fs.writeFileSync(f, text, "utf8");
        return f;
      })()]
      : ["--payload", text];
    const body = cliError(cli(ctx.cwd, args), `--${form}`);
    assert.strictEqual(body.code, "E_DUPLICATE_MEMBER", `--${form}: the duplicate survives the CLI boundary`);
    assertNothingWritten(ctx, `--${form}`);
  }
});

test("both CLI forms commit the same valid payload, and the object API refuses an unsorted OBJECT", () => {
  for (const form of ["payload-file", "payload"]) {
    const ctx = onDisk(plainTask());
    const text = JSON.stringify(payload(ctx.digest));
    const args = form === "payload-file"
      ? ["--payload-file", (() => {
        const f = path.join(ctx.cwd, "payload.json");
        fs.writeFileSync(f, text, "utf8");
        return f;
      })()]
      : ["--payload", text];
    const r = cli(ctx.cwd, args);
    assert.strictEqual(r.status, 0, `--${form}: expected exit 0, got ${r.status} (${r.stderr})`);
    assert.strictEqual(JSON.parse(r.stdout.trim()).ok, true, `--${form}: machine result`);
  }

  // HAND-BUILT, and labelled as such: this constructs an object whose enumerable key order is
  // unsorted. It does NOT invoke the accepted producer and is not evidence about what that producer
  // emits — it pins the object API's own refusal, which is the reason canonicalisation is the
  // caller's job. The real producer pipeline is covered by its own suites.
  const ctx = onDisk(plainTask());
  const unsorted = inventory(ctx.digest, {
    entries: [{                                        // "status" first: not ascending
      status: "modified",
      baseBodyDigest: BODY_BASE,
      framework: "node-test",
      headBodyDigest: BODY_HEAD,
      implementationIdentity: ENTRY.implementationIdentity,
      reason: "content-change",
      tagAfter: { clauseRef: ASSUM_A },
      tagBefore: { clauseRef: ASSUM_A },
      testRef: ENTRY.testRef,
    }],
  });
  refused(() => runTransaction(ctx.cwd, "commit-test-provenance-batch",
    payload(ctx.digest, { inventory: unsorted }), OPTS),
    "E_ORDER", "a hand-built object whose entry keys are unsorted");
  assertNothingWritten(ctx, "unsorted object entry");
});

// --- 3. proposal completeness and the derived record (TP §2, IS AC124) ------------------------------

test("AC124: record.inventoryDigest is DERIVED, and a caller-supplied top-level copy is refused outright", () => {
  const s = plainTask();
  refused(() => applyTransaction(s, "commit-test-provenance-batch",
    { ...payload(storeDigest(s)), inventoryDigest: "inv-1" }, OPTS),
    "E_PAYLOAD_FORBIDDEN", "a second authority for the same value");

  const out = applyTransaction(s, "commit-test-provenance-batch", payload(storeDigest(s)), OPTS);
  const rec = indexStore(out).records.get("R-b1");
  assert.strictEqual(rec.batchRecordVersion, BATCH_RECORD_VERSION);
  assert.strictEqual(rec.inventoryDigest, rec.batchSnapshot.inventorySnapshot.inventoryDigest,
    "the record's digest is the preimage's own");
  assert.strictEqual(rec.batchDigest, digestOf(rec.batchSnapshot));
  assert.ok(validateAll(parseStore(canonicalStoreBytes(out)), OPTS).ok, "and it survives a round trip");
});

test("TP §2: every unstarred proposal field is REQUIRED, compared, and never filled in by the writer", () => {
  const s = plainTask();
  const expected = storeDigest(s);
  const cases = [
    ["inventorySnapshot", { inventorySnapshot: undefined }, "E_BATCH_SNAPSHOT_MISSING"],
    ["inventoryDigest", { inventoryDigest: undefined }, "E_BATCH_SNAPSHOT_SHAPE"],
    ["taskId", { taskId: undefined }, "E_BATCH_SNAPSHOT_SHAPE"],
    ["results", { results: undefined }, "E_BATCH_SNAPSHOT_SHAPE"],
    ["baseProvenance", { baseProvenance: undefined }, "E_BATCH_SNAPSHOT_SHAPE"],
  ];
  for (const [what, snapshot, code] of cases) {
    refused(() => applyTransaction(s, "commit-test-provenance-batch", payload(expected, { snapshot }), OPTS),
      code, `a proposal missing ${what}`);
  }
  refused(() => applyTransaction(s, "commit-test-provenance-batch",
    payload(expected, { snapshot: { inventoryDigest: sha256Hex("another inventory") } }), OPTS),
    "E_BATCH_DERIVED_DIGEST", "a stated inventoryDigest disagreeing with the snapshot it encloses");
  refused(() => applyTransaction(s, "commit-test-provenance-batch",
    payload(expected, { snapshot: { taskId: "TASK-2" } }), OPTS),
    "E_BATCH_SNAPSHOT_SHAPE", "a proposal claiming another task");
  refused(() => applyTransaction(s, "commit-test-provenance-batch",
    payload(expected, { snapshot: { baseProvenance: { ...BASE, treeOid: "f".repeat(40) } } }), OPTS),
    "E_BASE_MISMATCH", "a stated base witness the TaskState does not agree with");
});

test("the legacy top-level baseProvenance check survives, and is supplemental rather than the witness", () => {
  const s = plainTask();
  const expected = storeDigest(s);
  // Still refused when it disagrees — removing this comparison would be a weakening.
  refused(() => applyTransaction(s, "commit-test-provenance-batch",
    { ...payload(expected), baseProvenance: { ...BASE, treeOid: "c".repeat(40) } }, OPTS),
    "E_BASE_MISMATCH", "the old top-level field disagreeing with the TaskState");
  // …and supplying it does NOT satisfy the required batchSnapshot witness.
  refused(() => applyTransaction(s, "commit-test-provenance-batch",
    { ...payload(expected, { snapshot: { baseProvenance: undefined } }), baseProvenance: BASE }, OPTS),
    "E_BATCH_SNAPSHOT_SHAPE", "a top-level witness standing in for the required one");
});

// --- 4. exact result/entry coverage and the stated observations (TP §2, §6) -------------------------

test("TP §2: results[] is one-to-one with entries[] — a skipped, extra or repeated test is refused", () => {
  const s = plainTask();
  const expected = storeDigest(s);
  const other = { ...RESULT, testRef: { ...TEST_REF, path: "test/other.test.mjs" } };

  refused(() => applyTransaction(s, "commit-test-provenance-batch",
    payload(expected, { snapshot: { results: [] } }), OPTS),
    "E_RESULT_COVERAGE", "an entry with no result — 'skipped four tests' must not read as clean");
  refused(() => applyTransaction(s, "commit-test-provenance-batch",
    payload(expected, { snapshot: { results: [RESULT, other] } }), OPTS),
    "E_RESULT_COVERAGE", "a result for a test this inventory does not list");
  refused(() => applyTransaction(s, "commit-test-provenance-batch",
    payload(expected, { snapshot: { results: [RESULT, { ...RESULT }] } }), OPTS),
    "E_RESULT_COVERAGE", "two results for one entry");
  refused(() => applyTransaction(s, "commit-test-provenance-batch",
    payload(expected, { snapshot: { results: [42] } }), OPTS),
    "E_RESULT_SHAPE", "a result that is not an object");
});

test("TP §6 proposal-time freshness: stated tags and observed bodies must be the ones the inventory carries", () => {
  const s = plainTask();
  const expected = storeDigest(s);
  const cases = [
    ["a tag the inventory does not state", { tagAfter: { clauseRef: ASSUM_B } }, "E_RESULT_BINDING"],
    ["a dropped tag", { tagBefore: undefined }, "E_RESULT_BINDING"],
    ["an unobserved base side", { observedBaseBodyDigest: undefined }, "E_RESULT_BINDING"],
    ["a base body the reviewer did not see", { observedBaseBodyDigest: sha256Hex("another body") }, "E_RESULT_BINDING"],
    ["a head body the reviewer did not see", { observedHeadBodyDigest: sha256Hex("another body") }, "E_RESULT_BINDING"],
    ["no findings array at all", { findings: undefined }, "E_RESULT_SHAPE"],
  ];
  for (const [what, over, code] of cases) {
    refused(() => applyTransaction(s, "commit-test-provenance-batch",
      payload(expected, { snapshot: { results: [{ ...RESULT, ...over }] } }), OPTS), code, what);
  }
});

test("TP §2: an observation for a side the entry does not have is refused as its own fault", () => {
  // An `added` entry has no base side at all, so a stated observedBaseBodyDigest describes a body
  // that was never under review.
  const s = plainTask();
  const expected = storeDigest(s);
  const added = {
    framework: "node-test",
    headBodyDigest: BODY_HEAD,
    implementationIdentity: ENTRY.implementationIdentity,
    reason: "content-change",
    status: "added",
    tagAfter: { clauseRef: ASSUM_A },
    tagBefore: null,
    testRef: ENTRY.testRef,
  };
  const inv = inventory(expected, { entries: [added] });
  const base = { testRef: TEST_REF, tagBefore: null, tagAfter: { clauseRef: ASSUM_A }, findings: [] };
  assert.ok(applyTransaction(s, "commit-test-provenance-batch", payload(expected, {
    inventory: inv, snapshot: { results: [{ ...base, observedHeadBodyDigest: BODY_HEAD }] },
  }), OPTS), "the positive control reaches success first");
  refused(() => applyTransaction(s, "commit-test-provenance-batch", payload(expected, {
    inventory: inv,
    snapshot: { results: [{ ...base, observedHeadBodyDigest: BODY_HEAD, observedBaseBodyDigest: BODY_BASE }] },
  }), OPTS), "E_RESULT_BINDING", "an observation for a side that does not exist");
});

test("TP §2: clauseRef/dpRef is a projection of ONE side taken whole, with no cross-side hybrid", () => {
  const s = plainTask();
  const expected = storeDigest(s);
  const REQ_X = "REQ-0000000000000000000000000X";
  const DP_REF = "DP-01J0000000000000000000000A";
  // A retagged entry: REQ@DP on one side, a plain ASSUM on the other. Only a pair drawn wholly from
  // one side describes a binding that ever existed.
  const retagged = {
    baseBodyDigest: BODY_BASE,
    framework: "node-test",
    headBodyDigest: BODY_BASE,
    implementationIdentity: ENTRY.implementationIdentity,
    reason: "content-change",
    status: "retagged",
    tagAfter: { clauseRef: ASSUM_A },
    tagBefore: { clauseRef: REQ_X, dpRef: DP_REF },
    testRef: ENTRY.testRef,
  };
  const inv = inventory(expected, { entries: [retagged] });
  const base = {
    testRef: TEST_REF, tagBefore: { clauseRef: REQ_X, dpRef: DP_REF }, tagAfter: { clauseRef: ASSUM_A },
    observedBaseBodyDigest: BODY_BASE, observedHeadBodyDigest: BODY_BASE, findings: [],
  };
  const commit = (over) => applyTransaction(s, "commit-test-provenance-batch",
    payload(expected, { inventory: inv, snapshot: { results: [{ ...base, ...over }] } }), OPTS);

  assert.ok(commit({}), "no projection at all is legal — TP §2 marks both fields optional");
  assert.ok(commit({ clauseRef: REQ_X, dpRef: DP_REF }), "the before side taken whole");
  assert.ok(commit({ clauseRef: ASSUM_A }), "the after side taken whole");
  refused(() => commit({ clauseRef: ASSUM_A, dpRef: DP_REF }), "E_RESULT_BINDING",
    "a clause from one side with the DP of the other");
  refused(() => commit({ dpRef: DP_REF }), "E_RESULT_BINDING", "a DP qualifier standing alone");
  refused(() => commit({ clauseRef: ASSUM_B }), "E_RESULT_BINDING", "a clause neither side binds");
});

test("TP §2: an EXPL entry binds no clause, so a result for it projects nothing", () => {
  const s = plainTask();
  const expected = storeDigest(s);
  const expl = {
    framework: "node-test",
    headBodyDigest: BODY_HEAD,
    implementationIdentity: ENTRY.implementationIdentity,
    reason: "content-change",
    status: "added",
    tagAfter: { expl: true },
    tagBefore: null,
    testRef: ENTRY.testRef,
  };
  const inv = inventory(expected, { entries: [expl] });
  const base = {
    testRef: TEST_REF, tagBefore: null, tagAfter: { expl: true },
    observedHeadBodyDigest: BODY_HEAD, findings: [],
  };
  assert.ok(applyTransaction(s, "commit-test-provenance-batch",
    payload(expected, { inventory: inv, snapshot: { results: [base] } }), OPTS), "the positive control");
  refused(() => applyTransaction(s, "commit-test-provenance-batch",
    payload(expected, { inventory: inv, snapshot: { results: [{ ...base, clauseRef: ASSUM_A }] } }), OPTS),
    "E_RESULT_BINDING", "an EXPL result projecting a clause");
});

test("TP §2: a Finding states a known kind and real evidence, and a well-formed nonconverged one persists", () => {
  const s = plainTask();
  const expected = storeDigest(s);
  const withFindings = (findings) => payload(expected, { snapshot: { results: [{ ...RESULT, findings }] } });

  refused(() => applyTransaction(s, "commit-test-provenance-batch",
    withFindings([{ kind: "not-a-kind", evidence: "e" }]), OPTS), "E_FINDING_KIND", "an unknown finding kind");
  refused(() => applyTransaction(s, "commit-test-provenance-batch",
    withFindings([{ kind: "wrong-tag" }]), OPTS), "E_FINDING_SHAPE", "a finding naming nothing specific");
  refused(() => applyTransaction(s, "commit-test-provenance-batch",
    withFindings([{ kind: "wrong-tag", evidence: "e", binding: { clauseRef: ASSUM_A, extra: 1 } }]), OPTS),
    "E_FINDING_SHAPE", "a binding with a field the contract does not declare");

  // Nonconverged, well formed, and PERSISTED: Step 4 routes it back and Step 6 owns the verdict.
  // Persistence here is not readiness and is not a convergence claim.
  const out = applyTransaction(s, "commit-test-provenance-batch",
    withFindings([{ kind: "assum-reading-change", evidence: "the reading moved", binding: { clauseRef: ASSUM_A } }]), OPTS);
  const persisted = indexStore(out).records.get("R-b1").batchSnapshot.results[0].findings;
  assert.strictEqual(persisted.length, 1, "the unresolved finding is kept, not dropped");
  assert.strictEqual(persisted[0].resolutionRef, undefined, "and it claims no resolution");
});

// --- 5. the TP §6 Resolution union and its this-round evidence equalities ---------------------------

// One resolution group over ASSUM_A, with the finding that claims it. `over` reaches the group and
// `finding` the claim, so each negative moves exactly one thing.
function resolvedBatch(store, {
  group = {}, finding = {}, records = [], resolutionRef,
  carrierUpdates = [{ dpId: "DP-1", action: "unchanged-null" }],
} = {}) {
  const expected = storeDigest(store);
  const evidence = [{ kind: "review-ruling", ref: "R-ev" }];
  const digest = resolutionGroupDigest({
    subjectRef: ASSUM_A, action: "revise", successor: ASSUM_B, semanticEvidenceRefs: evidence,
  });
  const claim = resolutionRef === undefined
    ? { mode: "this-round", transitionRef: "T-b", semanticEvidenceRef: { kind: "review-ruling", ref: "R-ev" } }
    : resolutionRef;
  return payload(expected, {
    recordsToCreate: [
      evidenceRecord("R-ev"),
      ruling("R-w", CODE, ASSUM_A, { resolutionGroupDigest: digest }),
      ...records,
    ],
    resolutions: [{
      subjectRef: ASSUM_A,
      semanticEvidenceRefs: evidence,
      governanceWitnessRef: { kind: "review-ruling", ref: "R-w" },
      transitionDraft: {
        id: "T-b", subject: ASSUM_A, action: "revise", successor: ASSUM_B,
        authorityRef: CODE, ackRef: { kind: "review-ruling", ref: "R-w" },
      },
      successorClauseDraft: {
        id: ASSUM_B, layer: "implementation", derivedFrom: "DP-1", text: "revised reading",
        alternative: "treat null as invalid", basis: "new evidence", basisRefs: [],
        governedBy: CODE, routingOrigin: "safe-default",
      },
      ...group,
    }],
    resolutionCarrierUpdates: carrierUpdates,
    snapshot: {
      results: [{
        ...RESULT,
        findings: [{
          kind: "assum-reading-change", evidence: "the ASSUM reading moved",
          binding: { clauseRef: ASSUM_A },
          ...(claim === null ? {} : { resolutionRef: claim }),
          ...finding,
        }],
      }],
    },
  });
}

test("IS AC57 + TP §6: a this-round resolution lands the successor, Transition, closure, record and head atomically", () => {
  const s = assumTask();
  const out = applyTransaction(s, "commit-test-provenance-batch", resolvedBatch(s), OPTS);
  const index = indexStore(out);
  assert.ok(index.clauses.get(ASSUM_B), "the successor clause was minted in this transaction");
  assert.strictEqual(statusOf(index, ASSUM_A), "revised");
  assert.strictEqual(out.transitions.length, 1, "one Transition");
  assert.strictEqual(index.dps.get("DP-1").assumedAs, ASSUM_B, "the DP moved onto the successor");
  assert.deepStrictEqual(index.taskStates.get("TASK-1").committedProvenanceBatchRef,
    { kind: "provenance-batch", ref: "R-b1" }, "and the head advanced in the same CAS");
  const persisted = index.records.get("R-b1").batchSnapshot;
  assert.strictEqual(persisted.resolutions[0].transitionRef, "T-b");
  assert.deepStrictEqual(persisted.results[0].findings[0].resolutionRef,
    { mode: "this-round", transitionRef: "T-b", semanticEvidenceRef: { kind: "review-ruling", ref: "R-ev" } },
    "the claim is persisted as submitted");
  assert.ok(validateAll(parseStore(canonicalStoreBytes(out)), OPTS).ok, "the store round-trips");
});

test("TP §6: the Resolution union has exactly two variants with exact key sets", () => {
  const s = assumTask();
  const cases = [
    ["no mode at all", { transitionRef: "T-b" }],
    ["an invented mode", { mode: "nearly-converged", transitionRef: "T-b" }],
    ["this-round missing its evidence", { mode: "this-round", transitionRef: "T-b" }],
    ["this-round carrying an undeclared key", {
      mode: "this-round", transitionRef: "T-b",
      semanticEvidenceRef: { kind: "review-ruling", ref: "R-ev" }, note: "extra",
    }],
    ["historical-convergence carrying evidence it does not declare", {
      mode: "historical-convergence", transitionRef: "T-b",
      semanticEvidenceRef: { kind: "review-ruling", ref: "R-ev" },
    }],
    ["a transitionRef that is not an id string", { mode: "historical-convergence", transitionRef: { id: "T-b" } }],
  ];
  for (const [what, resolutionRef] of cases) {
    refused(() => applyTransaction(s, "commit-test-provenance-batch", resolvedBatch(s, { resolutionRef }), OPTS),
      "E_FINDING_RESOLUTION", what);
  }
  refused(() => applyTransaction(s, "commit-test-provenance-batch", resolvedBatch(s, {
    finding: { kind: "wrong-tag" },
  }), OPTS), "E_FINDING_RESOLUTION", "a resolutionRef on a finding that is not an assum-reading-change");
  refused(() => applyTransaction(s, "commit-test-provenance-batch", resolvedBatch(s, {
    finding: { binding: undefined },
  }), OPTS), "E_FINDING_RESOLUTION", "a resolution claim with no binding to compare the subject against");
  refused(() => applyTransaction(s, "commit-test-provenance-batch", resolvedBatch(s, {
    finding: { binding: { clauseRef: ASSUM_B } },
  }), OPTS), "E_FINDING_RESOLUTION", "a Transition whose subject is not the bound clause");
  refused(() => applyTransaction(s, "commit-test-provenance-batch", resolvedBatch(s, {
    resolutionRef: { mode: "historical-convergence", transitionRef: "T-ghost" },
  }), OPTS), "E_FINDING_RESOLUTION", "a Transition in neither the pre-state nor this transaction");
});

test("TP §6:786-791: a this-round claim must match its evidence on task, test, kind, binding and both sides", () => {
  const s = assumTask();
  const borrowed = [
    ["another run's evidence", { taskId: "TASK-2" }, "E_EVIDENCE_BINDING"],
    ["a sibling test's evidence", { testRef: { ...TEST_REF, path: "test/beta.test.mjs" } }, "E_EVIDENCE_BINDING"],
    ["evidence about a different finding kind", { findingKind: "wrong-tag" }, "E_EVIDENCE_BINDING"],
    ["evidence recorded against another binding", { binding: { clauseRef: ASSUM_B } }, "E_EVIDENCE_BINDING"],
    ["evidence about another base body", { baseBodyDigest: sha256Hex("elsewhere") }, "E_EVIDENCE_BINDING"],
    ["evidence about another head body", { headBodyDigest: sha256Hex("elsewhere") }, "E_EVIDENCE_BINDING"],
    ["evidence that states no base side", { baseBodyDigest: undefined }, "E_EVIDENCE_BINDING"],
    ["evidence that names no task", { taskId: undefined }, "E_EVIDENCE_BINDING"],
  ];
  for (const [what, over, code] of borrowed) {
    const batch = resolvedBatch(s);
    batch.recordsToCreate[0] = evidenceRecord("R-ev", over);
    refused(() => applyTransaction(s, "commit-test-provenance-batch", batch, OPTS), code, what);
  }
  refused(() => applyTransaction(s, "commit-test-provenance-batch", resolvedBatch(s, {
    resolutionRef: { mode: "this-round", transitionRef: "T-b", semanticEvidenceRef: { kind: "review-ruling", ref: "R-ghost" } },
  }), OPTS), "E_REF_UNRESOLVABLE", "evidence in neither the pre-state nor recordsToCreate");
  refused(() => applyTransaction(s, "commit-test-provenance-batch", resolvedBatch(s, {
    resolutionRef: { mode: "this-round", transitionRef: "T-b", semanticEvidenceRef: "R-ev" },
  }), OPTS), "E_FINDING_RESOLUTION", "an untyped evidence ref");
});

test("W5: evidence claimed against a transition THIS transaction mints must be inside that group's verified set", () => {
  // R-other is a perfectly valid carrier — same task, test, kind, binding and bodies — but it is not
  // one of the refs the witness's resolutionGroupDigest covers, so the acknowledgement that was just
  // verified provably does not cover it.
  const s = assumTask();
  refused(() => applyTransaction(s, "commit-test-provenance-batch", resolvedBatch(s, {
    records: [evidenceRecord("R-other")],
    resolutionRef: { mode: "this-round", transitionRef: "T-b", semanticEvidenceRef: { kind: "review-ruling", ref: "R-other" } },
  }), OPTS), "E_FINDING_RESOLUTION", "evidence outside the minted group's covered set");
});

test("W5: a PRE-EXISTING Transition may be cited — pre-state references are not restricted to this batch", () => {
  // Codex withdrew the blanket same-transaction-only rule, and this is the case it would have broken:
  // T-b was minted by an EARLIER commit in the same task, and citing it now is legitimate. Whether
  // that Transition and its successor chain live in the base store is Step 6's question, not this
  // layer's, so nothing here claims it.
  const s = assumTask();
  const first = applyTransaction(s, "commit-test-provenance-batch", resolvedBatch(s), OPTS);
  const expected = storeDigest(first);
  const second = applyTransaction(first, "commit-test-provenance-batch", payload(expected, {
    batchRecordId: "R-b2",
    recordsToCreate: [evidenceRecord("R-ev2")],
    snapshot: {
      results: [{
        ...RESULT,
        findings: [{
          kind: "assum-reading-change", evidence: "still the same reading change",
          binding: { clauseRef: ASSUM_A },
          resolutionRef: {
            mode: "this-round", transitionRef: "T-b",
            semanticEvidenceRef: { kind: "review-ruling", ref: "R-ev2" },
          },
        }],
      }],
    },
  }), OPTS);
  const index = indexStore(second);
  assert.deepStrictEqual(index.records.get("R-b2").previousBatchRef, { kind: "provenance-batch", ref: "R-b1" });
  assert.deepStrictEqual(index.taskStates.get("TASK-1").committedProvenanceBatchRef,
    { kind: "provenance-batch", ref: "R-b2" }, "the chain and head advanced");
  assert.strictEqual(second.transitions.length, 1, "and no new Transition was fabricated");
});

test("TP §6: historical-convergence needs only its closed shape and a resolvable Transition here", () => {
  // The mode-specific base-store membership and successor-chain proof need the baseProvenance Git
  // read, which this transaction has no repository context for and must not invent. That is Step 6's,
  // and is NOT claimed by this passing case.
  const s = assumTask();
  const first = applyTransaction(s, "commit-test-provenance-batch", resolvedBatch(s), OPTS);
  const expected = storeDigest(first);
  const out = applyTransaction(first, "commit-test-provenance-batch", payload(expected, {
    batchRecordId: "R-b2",
    snapshot: {
      results: [{
        ...RESULT,
        findings: [{
          kind: "assum-reading-change", evidence: "converged in an earlier round",
          binding: { clauseRef: ASSUM_A },
          resolutionRef: { mode: "historical-convergence", transitionRef: "T-b" },
        }],
      }],
    },
  }), OPTS);
  assert.strictEqual(
    indexStore(out).records.get("R-b2").batchSnapshot.results[0].findings[0].resolutionRef.mode,
    "historical-convergence");
});

// --- 6. the acknowledgement / witness identity rule (TP §6:792, shared §2:290-295) ------------------

test("the Transition's ACTUAL ack carries the coverage, and the group may not advertise a different witness", () => {
  // The hole this closes: a group naming covering witness G while transitionDraft.ackRef named another
  // otherwise valid same-principal/same-subject witness G2 whose digest covers nothing. The Transition
  // that landed cited G2, and nothing had checked G2.
  const s = assumTask();
  const ctx = onDisk(s);
  const decoy = ruling("R-w2", CODE, ASSUM_A, { resolutionGroupDigest: sha256Hex("covers nothing") });

  const substituted = resolvedBatch(s, {
    records: [decoy],
    group: {
      transitionDraft: {
        id: "T-b", subject: ASSUM_A, action: "revise", successor: ASSUM_B,
        authorityRef: CODE, ackRef: { kind: "review-ruling", ref: "R-w2" },
      },
    },
  });
  substituted.expectedInputProvenanceStoreDigest = ctx.digest;
  substituted.batchSnapshot.inventorySnapshot = inventory(ctx.digest);
  substituted.batchSnapshot.inventoryDigest = substituted.batchSnapshot.inventorySnapshot.inventoryDigest;

  const headBefore = indexStore(parseStore(ctx.before)).taskStates.get("TASK-1").committedProvenanceBatchRef;
  refused(() => runTransaction(ctx.cwd, "commit-test-provenance-batch", substituted, OPTS),
    "E_WITNESS_COVERAGE", "the group advertising a witness its Transition does not cite");
  assertNothingWritten(ctx, "ack substitution");
  assert.deepStrictEqual(
    indexStore(parseStore(fs.readFileSync(ctx.file, "utf8"))).taskStates.get("TASK-1").committedProvenanceBatchRef,
    headBefore, "the committed head did not move");

  // And when BOTH refs name the decoy, the coverage digest itself refuses it.
  const both = resolvedBatch(s, {
    records: [decoy],
    group: {
      governanceWitnessRef: { kind: "review-ruling", ref: "R-w2" },
      transitionDraft: {
        id: "T-b", subject: ASSUM_A, action: "revise", successor: ASSUM_B,
        authorityRef: CODE, ackRef: { kind: "review-ruling", ref: "R-w2" },
      },
    },
  });
  refused(() => applyTransaction(s, "commit-test-provenance-batch", both, OPTS),
    "E_WITNESS_COVERAGE", "a consistently cited witness whose digest covers nothing");
});

test("the ack rule applies to a PLAN-GATE witness too — shared §2 lists its conditional digest with no exemption", () => {
  const s = assumTask();
  const evidence = [{ kind: "review-ruling", ref: "R-ev" }];
  const REQ_N = "REQ-0000000000000000000000000N";
  const digest = resolutionGroupDigest({
    subjectRef: ASSUM_A, action: "supersede", successor: REQ_N, semanticEvidenceRefs: evidence,
  });
  const gate = (recordId, resolutionGroupDigest_) => ({
    recordId, kind: "plan-gate", target: ASSUM_A, successor: REQ_N,
    impact: "no consumers", disposition: "no-affected-dependents", approvedBy: "user",
    resolutionGroupDigest: resolutionGroupDigest_,
  });
  const build = (ackRef, extraRecords = []) => payload(storeDigest(s), {
    recordsToCreate: [evidenceRecord("R-ev"), gate("R-pg", digest), ...extraRecords],
    resolutions: [{
      subjectRef: ASSUM_A,
      semanticEvidenceRefs: evidence,
      governanceWitnessRef: { kind: "plan-gate", ref: "R-pg" },
      transitionDraft: {
        id: "T-b", subject: ASSUM_A, action: "supersede", successor: REQ_N,
        authorityRef: { kind: "user" }, ackRef,
        compatibility: { impact: "no consumers", disposition: "no-affected-dependents" },
      },
      successorClauseDraft: {
        id: REQ_N, authority: "approved-requirement", kind: "specification",
        text: "the product ruling", sourceRef: "S-req", taskRef: "TASK-1",
      },
    }],
    resolutionCarrierUpdates: [{ dpId: "DP-1", action: "unchanged-null" }],
    snapshot: {
      results: [{
        ...RESULT,
        findings: [{
          kind: "assum-reading-change", evidence: "the reading moved",
          binding: { clauseRef: ASSUM_A },
          resolutionRef: {
            mode: "this-round", transitionRef: "T-b",
            semanticEvidenceRef: { kind: "review-ruling", ref: "R-ev" },
          },
        }],
      }],
    },
  });

  // The positive control reaches success BEFORE the negative is credited: one record is both the
  // declared witness and the Transition's ack, exactly as the existing REQ-mint fixtures do it.
  const out = applyTransaction(s, "commit-test-provenance-batch", build({ kind: "plan-gate", ref: "R-pg" }), OPTS);
  assert.strictEqual(indexStore(out).dps.get("DP-1").resolvedBy, REQ_N, "the REQ was minted and adopted");

  refused(() => applyTransaction(s, "commit-test-provenance-batch",
    build({ kind: "plan-gate", ref: "R-pg2" }, [gate("R-pg2", sha256Hex("covers nothing"))]), OPTS),
    "E_WITNESS_COVERAGE", "a plan-gate ack that is not the declared witness");
});

// --- 7. the D1-D5 review corrections ---------------------------------------------------------------
//
// Each block below pins ONE settled decision from
// docs/superpowers/reviews/2026-09-05-batch-writer-review-dialogue.md, with the positive control
// reaching success before any negative is credited. The shared theme is that a caller's object says
// three different things — key absent, key present holding undefined, key present holding a value —
// and TP §2:325 forbids folding any of them into another.

// An `added` entry (no base side, required `tagBefore: null`) and a `deleted` one (no head side,
// required `tagAfter: null`), written out beside the results that cover them. These are the only two
// shapes where a required tag's correct value IS null, which is exactly where `?? null` hid the gap.
const ADDED_ENTRY = {
  framework: "node-test",
  headBodyDigest: BODY_HEAD,
  implementationIdentity: ENTRY.implementationIdentity,
  reason: "content-change",
  status: "added",
  tagAfter: { clauseRef: ASSUM_A },
  tagBefore: null,
  testRef: ENTRY.testRef,
};
const DELETED_ENTRY = {
  baseBodyDigest: BODY_BASE,
  framework: "node-test",
  implementationIdentity: ENTRY.implementationIdentity,
  reason: "content-change",
  status: "deleted",
  tagAfter: null,
  tagBefore: { clauseRef: ASSUM_A },
  testRef: ENTRY.testRef,
};
const ADDED_RESULT = {
  testRef: TEST_REF, tagBefore: null, tagAfter: { clauseRef: ASSUM_A },
  observedHeadBodyDigest: BODY_HEAD, findings: [],
};
const DELETED_RESULT = {
  testRef: TEST_REF, tagBefore: { clauseRef: ASSUM_A }, tagAfter: null,
  observedBaseBodyDigest: BODY_BASE, findings: [],
};

// `over` is applied to the single result, so each case moves exactly one field off a passing control.
function sidePayload(store, entry, result, over = {}) {
  const expected = storeDigest(store);
  return payload(expected, {
    inventory: inventory(expected, { entries: [entry] }),
    snapshot: { results: [{ ...result, ...over }] },
  });
}

test("D1: a required null-side tag is stated AS null — omitting it is a different statement and refuses", () => {
  const s = plainTask();
  // Positives first: the explicit null on the side that actually has none.
  assert.ok(applyTransaction(s, "commit-test-provenance-batch", sidePayload(s, ADDED_ENTRY, ADDED_RESULT), OPTS),
    "an added entry reviewed with tagBefore stated as null");
  assert.ok(applyTransaction(s, "commit-test-provenance-batch", sidePayload(s, DELETED_ENTRY, DELETED_RESULT), OPTS),
    "a deleted entry reviewed with tagAfter stated as null");

  // TP §2:526 declares both without the `?` six of their neighbours carry, so absence is not the
  // null value. Both spellings of "says nothing" refuse, on the side whose value is legitimately null.
  const dropped = (result, field) => { const copy = { ...result }; delete copy[field]; return copy; };
  refused(() => applyTransaction(s, "commit-test-provenance-batch",
    sidePayload(s, ADDED_ENTRY, dropped(ADDED_RESULT, "tagBefore")), OPTS),
    "E_RESULT_BINDING", "an added review omitting the required tagBefore key");
  refused(() => applyTransaction(s, "commit-test-provenance-batch",
    sidePayload(s, DELETED_ENTRY, dropped(DELETED_RESULT, "tagAfter")), OPTS),
    "E_RESULT_BINDING", "a deleted review omitting the required tagAfter key");
  refused(() => applyTransaction(s, "commit-test-provenance-batch",
    sidePayload(s, ADDED_ENTRY, ADDED_RESULT, { tagBefore: undefined }), OPTS),
    "E_RESULT_BINDING", "an own tagBefore key holding undefined on the object API");
  refused(() => applyTransaction(s, "commit-test-provenance-batch",
    sidePayload(s, DELETED_ENTRY, DELETED_RESULT, { tagAfter: undefined }), OPTS),
    "E_RESULT_BINDING", "an own tagAfter key holding undefined on the object API");
});

test("D3: result.testRef is the entry's exact declared type, compared against the VALIDATED representation", () => {
  const ctx = onDisk(plainTask());

  // THE CASE THE UNFILTERED SPELLING WOULD HAVE BROKEN. The entry's own testRef carries a key holding
  // undefined. JSON.stringify — which is what the object path hands the canonical reader — drops it,
  // so the validator never saw it and the persisted bytes will not carry it either. A normal
  // three-key result must therefore still be accepted, and must not be forced to mirror the ghost.
  const ghostEntry = { ...ENTRY, testRef: { ...ENTRY.testRef, ghost: undefined } };
  assert.ok(Object.keys(ghostEntry.testRef).includes("ghost"), "the ghost is an own key on the live object");
  assert.strictEqual(JSON.parse(JSON.stringify(ghostEntry.testRef)).ghost, undefined,
    "…and is absent from the representation the reader validated");
  const withGhostEntry = runTransaction(ctx.cwd, "commit-test-provenance-batch", payload(ctx.digest, {
    inventory: inventory(ctx.digest, { entries: [ghostEntry] }),
  }), OPTS);
  assert.strictEqual(withGhostEntry.changed, true, "a normal result still reviews a ghost-carrying entry");

  // The mirrored negative, on the actual object API: the RESULT is the operand nothing else
  // validates, so its own undefined-valued extra is refused rather than silently dropped. It is NOT
  // canonicalised away before the call — that is the whole point of the case.
  const ctx2 = onDisk(plainTask());
  const ghostResult = { ...RESULT, testRef: { ...TEST_REF, ghost: undefined } };
  assert.strictEqual(canonicalJson(ghostResult.testRef), canonicalJson(TEST_REF),
    "canonicalJson alone cannot see this — which is why the own-key check exists");
  refused(() => runTransaction(ctx2.cwd, "commit-test-provenance-batch",
    payload(ctx2.digest, { snapshot: { results: [ghostResult] } }), OPTS),
    "E_RESULT_SHAPE", "a result testRef carrying an own undefined-valued extra");
  assertNothingWritten(ctx2, "result-ghost testRef");

  // And an ordinary undeclared annotation with a real value.
  const s = plainTask();
  refused(() => applyTransaction(s, "commit-test-provenance-batch", payload(storeDigest(s), {
    snapshot: { results: [{ ...RESULT, testRef: { ...TEST_REF, invented: true } }] },
  }), OPTS), "E_RESULT_SHAPE", "a result testRef carrying an undeclared annotation");

  // Diagnostic ordering is unchanged: a well-formed testRef the inventory does not list is still a
  // coverage fault, not a type fault.
  refused(() => applyTransaction(s, "commit-test-provenance-batch", payload(storeDigest(s), {
    snapshot: { results: [{ ...RESULT, testRef: { ...TEST_REF, path: "test/unlisted.test.mjs" } }] },
  }), OPTS), "E_RESULT_COVERAGE", "a proper but unlisted testRef");
});

test("D5: an optional DP qualifier is absent or a real value — `dpRef: null` is not `no qualifier`", () => {
  const s = plainTask();
  const expected = storeDigest(s);
  // The entry's ASSUM side carries no DP qualifier at all, so the only correct projection OMITS it.
  const project = (over) => applyTransaction(s, "commit-test-provenance-batch",
    payload(expected, { snapshot: { results: [{ ...RESULT, ...over }] } }), OPTS);

  assert.ok(project({ clauseRef: ASSUM_A }), "the base-clause projection with dpRef omitted");
  assert.ok(project({}), "and omitting the whole projection stays legal");

  // TP §2:331-332 gives the clause tag exactly two shapes, neither of which can hold a null
  // qualifier, so a projection stating one describes a binding no side has.
  refused(() => project({ clauseRef: ASSUM_A, dpRef: null }), "E_RESULT_BINDING",
    "an explicit null qualifier against a side that has none");
  refused(() => project({ clauseRef: ASSUM_A, dpRef: undefined }), "E_RESULT_BINDING",
    "an own dpRef key holding undefined");
  refused(() => project({ clauseRef: undefined }), "E_RESULT_BINDING",
    "an own clauseRef key holding undefined");
});

test("D5: a supplied finding.binding.dpRef is a non-empty string, and no DP grammar is imposed here", () => {
  const s = plainTask();
  const expected = storeDigest(s);
  const bound = (binding) => applyTransaction(s, "commit-test-provenance-batch", payload(expected, {
    snapshot: { results: [{ ...RESULT, findings: [{ kind: "wrong-tag", evidence: "e", binding }] }] },
  }), OPTS);

  assert.ok(bound({ clauseRef: ASSUM_A }), "a binding with no DP qualifier omits the key");
  // DELIBERATELY ACCEPTED: the writer checks the SHAPE only. It does not apply the inventory's
  // DP-ref grammar (this store's own DP ids are not canonical ULIDs), does not require the clause to
  // be a REQ, and does not decide exception-backing — all three were explicitly excluded from this
  // slice, and this positive is what proves they were not smuggled in.
  assert.ok(bound({ clauseRef: ASSUM_A, dpRef: "DP-1" }), "a supplied qualifier is accepted on its shape");

  refused(() => bound({ clauseRef: ASSUM_A, dpRef: null }), "E_FINDING_SHAPE", "a null qualifier");
  refused(() => bound({ clauseRef: ASSUM_A, dpRef: undefined }), "E_FINDING_SHAPE", "an own undefined qualifier");
  refused(() => bound({ clauseRef: ASSUM_A, dpRef: "" }), "E_FINDING_SHAPE", "an empty-string qualifier");
});

test("D2: the fixed carrier is charged on a PRE-EXISTING Transition too, where no current group covers it", () => {
  // The prior-reference path is the one the current-group checks never reach, and TP §6:808 makes it
  // the ONLY legal mode for a Transition absent from the base store — so leaving the carrier
  // unchecked there left it unchecked where it matters most.
  const s = assumTask();
  const first = applyTransaction(s, "commit-test-provenance-batch", resolvedBatch(s), OPTS);
  const expected = storeDigest(first);
  const claim = (record) => payload(expected, {
    batchRecordId: "R-b2",
    recordsToCreate: [record],
    snapshot: {
      results: [{
        ...RESULT,
        findings: [{
          kind: "assum-reading-change", evidence: "still the same reading change",
          binding: { clauseRef: ASSUM_A },
          resolutionRef: {
            mode: "this-round", transitionRef: "T-b",
            semanticEvidenceRef: { kind: "review-ruling", ref: "R-ev2" },
          },
        }],
      }],
    },
  });

  // The positive control must reach success first, and it is the same prior-reference positive the
  // settled W5 decision protects.
  assert.ok(applyTransaction(first, "commit-test-provenance-batch", claim(evidenceRecord("R-ev2")), OPTS),
    "a valid test-discipline review-ruling resolving a prior Transition");

  // One field moved each time, off that passing control.
  refused(() => applyTransaction(first, "commit-test-provenance-batch",
    claim(ruling("R-ev2", CODE, ASSUM_A, {
      taskId: "TASK-1", testRef: TEST_REF, baseBodyDigest: BODY_BASE, headBodyDigest: BODY_HEAD,
      findingKind: "assum-reading-change", binding: { clauseRef: ASSUM_A },
    })), OPTS),
    "E_EVIDENCE_BINDING", "a code-discipline ruling standing in for test semantic evidence");
  refused(() => applyTransaction(first, "commit-test-provenance-batch",
    claim(evidenceRecord("R-ev2", { subjectRef: ASSUM_B })), OPTS),
    "E_EVIDENCE_BINDING", "a ruling about the SUCCESSOR rather than the clause being resolved");
  refused(() => applyTransaction(first, "commit-test-provenance-batch",
    claim({ recordId: "R-ev2", kind: "source-authority", authorityIdentity: "EU DPA" }), OPTS),
    "E_REF_UNRESOLVABLE", "a source-authority record cited through a review-ruling typed ref");
  refused(() => applyTransaction(first, "commit-test-provenance-batch", payload(expected, {
    batchRecordId: "R-b2",
    recordsToCreate: [{ recordId: "R-ev2", kind: "source-authority", authorityIdentity: "EU DPA" }],
    snapshot: {
      results: [{
        ...RESULT,
        findings: [{
          kind: "assum-reading-change", evidence: "e", binding: { clauseRef: ASSUM_A },
          resolutionRef: {
            mode: "this-round", transitionRef: "T-b",
            semanticEvidenceRef: { kind: "source-authority", ref: "R-ev2" },
          },
        }],
      }],
    },
  }), OPTS), "E_EVIDENCE_BINDING", "a source-authority record cited as the carrier under its own kind");
});

const DEC_A = "DEC-0000000000000000000000000A";

// A task settled on a DEC, so a generic non-ASSUM resolution group can be exercised whole.
function decTask() {
  const s = applyTransaction(emptyStore(), "init-task", {
    taskId: "TASK-1",
    baseProvenance: BASE,
    decisionPoints: [{
      id: "DP-1", dimension: "data", scenario: "null vs absent", alternatives: ["A", "B"],
      layer: "implementation", classificationBasis: "engineering standard", materialReasons: [],
      status: "open",
    }],
    currentTaskDpIds: ["DP-1"],
  }, OPTS);
  const packet = {
    dpId: "DP-1", scenario: "null vs absent", alternatives: ["A", "B"], layer: "implementation",
    classificationBasis: "engineering standard", materialReasons: [], requestedPrincipal: CODE, basisRefs: [],
  };
  return applyTransaction(s, "create-initial-outcome", {
    dpId: "DP-1",
    records: [{
      ...ruling("R-td", CODE, "DP-1"), rulingKind: "technical-decision", basis: "stated basis",
      inputPacketSnapshot: packet, inputPacketDigest: digestOf(packet), selectedAlternative: "A",
    }],
    clause: {
      id: DEC_A, layer: "implementation", derivedFrom: "DP-1", decision: "A",
      alternatives: ["A", "B"], approvedBy: CODE, basisRefs: [{ kind: "review-ruling", ref: "R-td" }],
    },
  }, OPTS);
}

test("D2: a generic DEC retirement still commits, and an ASSUM evidence claim against that DEC refuses", () => {
  const s = decTask();
  const expected = storeDigest(s);
  const evidence = [{ kind: "review-ruling", ref: "R-ev" }];
  const digest = resolutionGroupDigest({
    subjectRef: DEC_A, action: "retire", successor: null, semanticEvidenceRefs: evidence,
  });
  const group = {
    subjectRef: DEC_A,
    semanticEvidenceRefs: evidence,
    governanceWitnessRef: { kind: "review-ruling", ref: "R-w" },
    transitionDraft: {
      id: "T-dec", subject: DEC_A, action: "retire", successor: null,
      authorityRef: CODE, ackRef: { kind: "review-ruling", ref: "R-w" },
    },
  };
  const records = [
    ruling("R-ev", TEST_DISCIPLINE, DEC_A),
    ruling("R-w", CODE, DEC_A, { resolutionGroupDigest: digest }),
  ];

  // POSITIVE CONTROL. A resolution group over a DEC carries no per-test semantic evidence claim, so
  // none of D2's carrier rules touch it. This is the case an over-broad ASSUM restriction would break.
  const out = applyTransaction(s, "commit-test-provenance-batch", payload(expected, {
    recordsToCreate: records,
    resolutions: [group],
    resolutionCarrierUpdates: [{ dpId: "DP-1", action: "unchanged-null" }],
  }), OPTS);
  assert.strictEqual(statusOf(indexStore(out), DEC_A), "retired", "the DEC retired through a generic group");
  assert.strictEqual(out.transitions.length, 1);

  // NEGATIVE. The same transaction, but a result now claims per-test semantic evidence bound to the
  // DEC. `finding.kind` is a caller-supplied label and does not establish the clause's tier, so the
  // canonical identity is what refuses it — everything else about the claim is internally consistent.
  refused(() => applyTransaction(s, "commit-test-provenance-batch", payload(expected, {
    recordsToCreate: [
      ruling("R-ev", TEST_DISCIPLINE, DEC_A, {
        taskId: "TASK-1", testRef: TEST_REF, baseBodyDigest: BODY_BASE, headBodyDigest: BODY_HEAD,
        findingKind: "assum-reading-change", binding: { clauseRef: DEC_A },
      }),
      records[1],
    ],
    resolutions: [group],
    resolutionCarrierUpdates: [{ dpId: "DP-1", action: "unchanged-null" }],
    snapshot: {
      results: [{
        ...RESULT,
        findings: [{
          kind: "assum-reading-change", evidence: "the reading moved", binding: { clauseRef: DEC_A },
          resolutionRef: {
            mode: "this-round", transitionRef: "T-dec",
            semanticEvidenceRef: { kind: "review-ruling", ref: "R-ev" },
          },
        }],
      }],
    },
  }), OPTS), "E_EVIDENCE_BINDING", "an assum-reading-change claim bound to a DEC");
});

test("D4: the CLI reports the ACTUAL error class's code — inventory refusals and store refusals alike", () => {
  // Both known classes cross the process boundary with their own code. Recognition is by class, so a
  // stray object carrying an E_-shaped `code` would still report E_UNEXPECTED; that negative needs an
  // injected fault and is NOT claimed by this test.
  const ctx = onDisk(plainTask());
  const unsorted = JSON.stringify(payload(ctx.digest))
    .replace('"reason":"content-change","status":"modified"', '"status":"modified","reason":"content-change"');
  const inventoryFault = cliError(cli(ctx.cwd, ["--payload", unsorted]), "an InventoryError at the CLI");
  assert.strictEqual(inventoryFault.code, "E_ORDER", "the canonical reader's own code survives");
  assertNothingWritten(ctx, "InventoryError at the CLI");

  const storeFault = cliError(
    cli(ctx.cwd, ["--payload", JSON.stringify(payload(sha256Hex("a pre-state this store never had")))]),
    "a ProvenanceError at the CLI");
  assert.strictEqual(storeFault.code, "E_CAS_MISMATCH", "and so does the store's");
  assert.notStrictEqual(storeFault.detail, null, "with its detail preserved rather than flattened");
  assertNothingWritten(ctx, "ProvenanceError at the CLI");
});

// --- the successorClauseDraft presence rule, SHARED with the loop controller's unlock adapter --------
//
// TP v1.21 §D9.1 requires the controller to charge the SAME rule the writer charges, so the rule was
// factored into one descriptor both boundaries call. These cases exist to prove the factoring changed
// nothing here: the writer's own codes, its message text, its order relative to the id check, and its
// discriminator for DIRECT OBJECT callers — absence, not nullishness — are all exactly as they were.

test("v1.21 factoring: the writer's successorClauseDraft rule keeps its codes, order and absence rule", () => {
  const s = assumTask();

  // ABSENT carries no obligation, so the ordinary revise-with-a-mint positive still commits.
  const ok = applyTransaction(s, "commit-test-provenance-batch", resolvedBatch(s), OPTS);
  assert.ok(indexStore(ok).clauses.get(ASSUM_B), "the absent-field positive is unchanged");

  // A STATED null is a statement, and on a retire it is forbidden. This is the case that distinguishes
  // the writer's actual discriminator from a nullish one.
  const evidence = [{ kind: "review-ruling", ref: "R-ev" }];
  const retireDigest = resolutionGroupDigest({
    subjectRef: ASSUM_A, action: "retire", successor: null, semanticEvidenceRefs: evidence,
  });
  const retire = payload(storeDigest(s), {
    recordsToCreate: [evidenceRecord("R-ev"), ruling("R-w", CODE, ASSUM_A, { resolutionGroupDigest: retireDigest })],
    resolutions: [{
      subjectRef: ASSUM_A,
      semanticEvidenceRefs: evidence,
      governanceWitnessRef: { kind: "review-ruling", ref: "R-w" },
      transitionDraft: {
        id: "T-b", subject: ASSUM_A, action: "retire",
        authorityRef: CODE, ackRef: { kind: "review-ruling", ref: "R-w" },
      },
      successorClauseDraft: null,
    }],
    resolutionCarrierUpdates: [{ dpId: "DP-1", action: "unchanged-null" }],
    snapshot: {
      results: [{
        ...RESULT,
        findings: [{
          kind: "assum-reading-change", evidence: "the ASSUM reading moved",
          binding: { clauseRef: ASSUM_A },
          resolutionRef: {
            mode: "this-round", transitionRef: "T-b",
            semanticEvidenceRef: { kind: "review-ruling", ref: "R-ev" },
          },
        }],
      }],
    },
  });
  const retireError = refused(() => applyTransaction(s, "commit-test-provenance-batch", retire, OPTS),
    "E_SUCCESSOR_DRAFT_FORBIDDEN", "a STATED null successorClauseDraft on a retire");
  assert.match(retireError.message, /retires, so it carries no successorClauseDraft/,
    "the writer's own message text is unchanged by the factoring");

  // A stated draft that is present but has no id still reaches the ID check, which runs AFTER the two
  // presence rows — so their relative order survives the extraction.
  const noId = resolvedBatch(s, {
    group: { successorClauseDraft: { layer: "implementation", derivedFrom: "DP-1", text: "t" } },
  });
  refused(() => applyTransaction(s, "commit-test-provenance-batch", noId, OPTS),
    "E_SUCCESSOR_DRAFT_ID", "a stated draft with no id");
});

// The second shared descriptor, on the same precedent: TP v1.21 §D5.1/§D5.4 make the loop controller
// charge this key set over its governance input at every read, so one table serves both and the two
// cannot drift. The writer keeps its own code, message and position; per-DP COVERAGE stays here,
// unfactored, because it is derived from what a transaction actually mutates.
test("v1.21 factoring: the writer's carrier-update key set keeps its code, message and order", () => {
  const s = assumTask();
  const attempt = (carrierUpdates) => applyTransaction(s, "commit-test-provenance-batch",
    resolvedBatch(s, { carrierUpdates }), OPTS);

  // The ordinary positive still commits, so the extraction changed no accepted behaviour.
  assert.ok(indexStore(attempt([{ dpId: "DP-1", action: "unchanged-null" }])).clauses.get(ASSUM_B));

  // UNDECLARED key for the action.
  const extra = refused(() => attempt([{ dpId: "DP-1", action: "unchanged-null", rulingRef: { kind: "review-ruling", ref: "R-x" } }]),
    "E_CARRIER_SHAPE", "an undeclared key for the action");
  assert.match(extra.message, /a "unchanged-null" carrier update's key set is not the canonical closed set \(undeclared: rulingRef\)/,
    "the writer's own message text is unchanged by the factoring");

  // MISSING key for the action.
  const missing = refused(() => attempt([{ dpId: "DP-1", action: "replace" }]),
    "E_CARRIER_SHAPE", "a missing key for the action");
  assert.match(missing.message, /a "replace" carrier update's key set is not the canonical closed set \(missing: rulingRef\)/);

  // ORDER survives: an unknown ACTION is still E_CARRIER_ACTION, charged before the key set, and a
  // missing dpId is still E_SHAPE, charged before both.
  refused(() => attempt([{ dpId: "DP-1", action: "invent" }]), "E_CARRIER_ACTION", "an unknown action");
  refused(() => attempt([{ action: "preserve" }]), "E_SHAPE", "an entry with no dpId");

  // And the descriptor itself reports data, never a code: it throws nothing, so each caller phrases
  // its own diagnosis.
  assert.strictEqual(carrierUpdateShapeFault({ dpId: "DP-1", action: "preserve" }), null);
  assert.deepStrictEqual(carrierUpdateShapeFault({ dpId: "DP-1", action: "replace" }),
    { kind: "keys", missing: ["rulingRef"], extra: [] });
  assert.deepStrictEqual(carrierUpdateShapeFault({ dpId: "DP-1", action: "nope" }),
    { kind: "unknown-action", action: "nope" });
  assert.deepStrictEqual(carrierUpdateShapeFault({ action: "preserve" }), { kind: "dp-id" });
  assert.deepStrictEqual(carrierUpdateShapeFault(null), { kind: "not-object" });
});
