// previewTestProvenanceBatch (TP v1.19): the read-only file-backed preview.
//
// SCOPE. A green run here proves the HELPER: that it derives what the real file-text writer derives,
// from the same loaded-text authority, without writing, locking or claiming anything it has not
// established. It does not release the D controller, does not prove Step 6 convergence, and makes no
// readiness claim.
//
// HOW THESE FIXTURES ARE BUILT, and why it matters. Every positive compares the preview against the
// ACTUAL file-backed text writer (`runTransactionFromPayloadText`) operating on a REAL store file,
// and compares the WHOLE record rather than a digest of it. `applyTransaction` on a parsed object is
// deliberately never used as the comparand: that path is exactly what the amendment removed, because
// its memory branch checks the payload's expectedInputProvenanceStoreDigest against
// storeDigest(<object>) and so refuses legally pretty-printed files the real writer accepts.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cp from "node:child_process";
import crypto from "node:crypto";

import {
  emptyStore, canonicalStoreBytes, storeDigest, sha256Hex, applyTransaction, resolutionGroupDigest,
  loadStore, runTransactionFromPayloadText, previewTestProvenanceBatch, CANONICAL_STORE_PATH,
} from "../cressetide/skills/vigil/scripts/provenance-store.mjs";
import { computeInventoryV2Digest } from "../cressetide/skills/vigil/scripts/changed-test-inventory.mjs";
import { captureHeadViewSnapshot } from "../cressetide/skills/vigil/scripts/head-view-snapshot.mjs";
import { readTestAdapterRegistryRootFresh } from "../cressetide/skills/vigil/scripts/adapter-registry.mjs";
import { readHeadExplicitConfig, registryDigestOf } from "../cressetide/skills/vigil/scripts/explicit-config.mjs";
import { verifyCommittedBatch } from "../cressetide/skills/vigil/scripts/committed-batch-consumer.mjs";

const OPTS = { now: Date.UTC(2026, 8, 6) };
const TASK = "TASK-1";
const ADAPTER_ID = "node-test";
const TEST_PATH = "test/alpha.test.mjs";
const STRUCTURAL = 's:["alpha"]';
const ASSUM_A = "ASSUM-0000000000000000000000000A";
const ASSUM_B = "ASSUM-0000000000000000000000000B";
const CODE = { kind: "discipline", discipline: "code" };
const TEST_DISCIPLINE = { kind: "discipline", discipline: "test" };
const BODY_BASE = "1".repeat(64);
const BODY_HEAD = "2".repeat(64);
const PREFIX = "ctide-preview-";
const rawDigest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

function checkedTempRoot(dir, prefix) {
  const parent = fs.realpathSync(os.tmpdir());
  const resolved = path.resolve(dir);
  assert.strictEqual(path.dirname(resolved), parent, `refusing ${resolved}: not a direct temp child`);
  assert.ok(path.basename(resolved).startsWith(prefix), `refusing ${resolved}: wrong prefix`);
  return resolved;
}

function makeRepo(prefix = PREFIX) {
  const dir = checkedTempRoot(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix))), prefix);
  const git = (...a) => cp.execFileSync("git", a, {
    cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  git("init", "-q", "--initial-branch=main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  git("config", "core.autocrlf", "false");
  const write = (rel, body) => {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body, "utf8");
  };
  return { root: dir, prefix, git, write };
}

async function withRepo(body, prefix = PREFIX) {
  const repo = makeRepo(prefix);
  try {
    return await body(repo);
  } finally {
    fs.rmSync(checkedTempRoot(repo.root, repo.prefix), { recursive: true, force: true });
  }
}

// The store that goes INTO the base tree: it carries the ASSUM the entry binds, which shared §9
// resolves in B rather than in the current store.
function priorStore(seedTree) {
  let s = applyTransaction(emptyStore(), "init-task", {
    taskId: "TASK-0",
    baseProvenance: { treeOid: seedTree, storePath: CANONICAL_STORE_PATH, storeDigest: storeDigest(emptyStore()) },
    decisionPoints: [{
      id: "DP-1", dimension: "data", scenario: "null vs absent", alternatives: ["A", "B"],
      layer: "implementation", classificationBasis: "engineering standard", materialReasons: [],
      status: "open",
    }],
    currentTaskDpIds: ["DP-1"],
  }, OPTS);
  s = applyTransaction(s, "append-source", {
    source: {
      sourceId: "S-req", contentKind: "requirement", driftMode: "snapshot-only",
      locator: "conversation#1", excerpt: "the reviewed reading of the null case",
    },
  }, OPTS);
  return applyTransaction(s, "create-initial-outcome", {
    dpId: "DP-1",
    records: [{ recordId: "R-rule1", kind: "review-ruling", by: CODE, subjectRef: "DP-1", ruling: "ok" }],
    clause: {
      id: ASSUM_A, layer: "implementation", derivedFrom: "DP-1", text: "treat null as absent",
      alternative: "treat null as invalid", basis: "matches the option table", basisRefs: [],
      governedBy: CODE, routingOrigin: "safe-default",
    },
  }, OPTS);
}

// A real repository with a real base tree, a real current store and REAL head-view/registry digests,
// so the committed consumer can be run against the result of one of these previews.
async function world(repo) {
  repo.write(TEST_PATH, 'import { test } from "node:test";\ntest("alpha", () => {});\n');
  repo.write(".ctide/keep", "x\n");
  repo.git("add", "-A");
  repo.git("commit", "-qm", "seed");
  const seedTree = repo.git("rev-parse", "HEAD^{tree}");

  const prior = priorStore(seedTree);
  repo.write(CANONICAL_STORE_PATH, canonicalStoreBytes(prior));
  repo.git("add", "-A");
  repo.git("commit", "-qm", "history");
  const base = {
    treeOid: repo.git("rev-parse", "HEAD^{tree}"),
    storePath: CANONICAL_STORE_PATH,
    storeDigest: rawDigest(fs.readFileSync(path.join(repo.root, ...CANONICAL_STORE_PATH.split("/")))),
  };
  const store = applyTransaction(prior, "init-task", {
    taskId: TASK, baseProvenance: base, decisionPoints: [], currentTaskDpIds: [],
  }, OPTS);

  const snapshot = await captureHeadViewSnapshot({ repoRoot: repo.root });
  const registryRoot = readTestAdapterRegistryRootFresh();
  return {
    base, store,
    headViewDigest: snapshot.headViewDigest,
    registryDigest: registryDigestOf(registryRoot, readHeadExplicitConfig(snapshot, registryRoot)),
    identity: registryRoot.adapters.find((a) => a.adapterId === ADAPTER_ID).implementationIdentity,
  };
}

// --- the three legal byte forms of one and the same store -------------------------------------------

const storeFile = (repo) => path.join(repo.root, ...CANONICAL_STORE_PATH.split("/"));

const BYTE_FORMS = {
  // The writer's own serialisation.
  canonical: (store) => canonicalStoreBytes(store),
  // A DIFFERENT serialisation of the same store. This is the form that separates the loaded-text
  // digest from storeDigest(<object>) -- pretty printing, not the line endings.
  "pretty LF": (store) => `${JSON.stringify(store, null, 2)}\n`,
  // Pretty printing PLUS a BOM and CRLF endings. canonicalText normalises the BOM and the endings,
  // so those two alone change nothing; the pretty printing is still what makes the two notations
  // differ, and this case exists to show the combination is accepted too.
  "pretty BOM/CRLF": (store) => `﻿${JSON.stringify(store, null, 2).replace(/\n/g, "\r\n")}\r\n`,
};

// --- payload construction ----------------------------------------------------------------------------
//
// Written by hand rather than derived from the preview, so the comparison below is between two
// independent computations over one submitted text.

const entryFor = (w, over = {}) => ({
  baseBodyDigest: "1".repeat(64),
  framework: "node-test",
  headBodyDigest: "2".repeat(64),
  implementationIdentity: w.identity,
  reason: "content-change",
  status: "modified",
  tagAfter: { clauseRef: ASSUM_A },
  tagBefore: { clauseRef: ASSUM_A },
  testRef: { adapterId: ADAPTER_ID, path: TEST_PATH, structuralId: STRUCTURAL },
  ...over,
});

const resultFor = (over = {}) => ({
  testRef: { adapterId: ADAPTER_ID, path: TEST_PATH, structuralId: STRUCTURAL },
  tagBefore: { clauseRef: ASSUM_A },
  tagAfter: { clauseRef: ASSUM_A },
  observedBaseBodyDigest: "1".repeat(64),
  observedHeadBodyDigest: "2".repeat(64),
  findings: [],
  ...over,
});

function inventoryFor(w, preStateDigest, entries) {
  const body = {
    inventoryVersion: 2,
    baseTreeOid: w.base.treeOid,
    registryDigest: w.registryDigest,
    headViewDigest: w.headViewDigest,
    inputProvenanceStoreDigest: preStateDigest,
    entries,
  };
  return { ...body, inventoryDigest: computeInventoryV2Digest(body) };
}

function payloadFor(w, preStateDigest, { entries, results, over = {}, snapshotOver = {} } = {}) {
  const inventory = inventoryFor(w, preStateDigest, entries ?? [entryFor(w)]);
  return {
    taskId: TASK,
    batchRecordId: "R-b1",
    expectedInputProvenanceStoreDigest: preStateDigest,
    batchSnapshot: {
      taskId: TASK,
      baseProvenance: w.base,
      inventoryDigest: inventory.inventoryDigest,
      inventorySnapshot: inventory,
      results: results ?? [resultFor()],
      resolutions: [],
      ...snapshotOver,
    },
    resolutions: [],
    ...over,
  };
}

// Write one byte form, then hand the SAME text to the preview and to the real writer.
async function prepared(repo, form) {
  const w = await world(repo);
  fs.writeFileSync(storeFile(repo), BYTE_FORMS[form](w.store), "utf8");
  const loaded = loadStore(repo.root);
  return { ...w, preStateDigest: loaded.digest, loaded };
}

const refused = (fn, what) => {
  let error = null;
  try { fn(); } catch (e) { error = e; }
  assert.ok(error && typeof error.code === "string", `${what}: expected a coded refusal, got ${error}`);
  return error;
};

// --- 1. the three byte forms, whole-record equality against the REAL text writer -----------------------

for (const form of Object.keys(BYTE_FORMS)) {
  test(`a ${form} store: the preview record equals the record the actual file-text writer produces`,
    () => withRepo(async (repo) => {
      const w = await prepared(repo, form);
      const text = JSON.stringify(payloadFor(w, w.preStateDigest));

      // The premise that makes this case load-bearing for the pretty forms.
      if (form === "canonical") {
        assert.strictEqual(w.preStateDigest, storeDigest(w.store), "the two notations coincide here");
      } else {
        assert.notStrictEqual(w.preStateDigest, storeDigest(w.store),
          "the loaded-TEXT digest and the canonical-OBJECT digest differ, which is what an object preview trips on");
      }

      const before = fs.readFileSync(storeFile(repo));
      const preview = previewTestProvenanceBatch({ repoRoot: repo.root, payloadText: text });
      assert.strictEqual(preview.inputProvenanceStoreDigest, w.preStateDigest,
        "the helper returns its OWN captured loadStore().digest");
      assert.deepStrictEqual(fs.readFileSync(storeFile(repo)), before, "the preview wrote nothing");

      // The actual file-backed text writer, on the same text.
      runTransactionFromPayloadText(repo.root, "commit-test-provenance-batch", text, OPTS);
      const committed = loadStore(repo.root).store.records.find((r) => r.recordId === "R-b1");

      // WHOLE record, not a digest of it.
      assert.deepStrictEqual(preview.expectedBatchRecord, committed,
        `${form}: the preview must derive exactly what the writer derived`);
      for (const key of ["recordId", "kind", "batchRecordVersion", "taskId", "inventoryDigest",
        "batchSnapshot", "batchDigest", "relatedRefs", "previousBatchRef"]) {
        assert.ok(key in preview.expectedBatchRecord, `${key} is part of the complete record`);
      }
      assert.strictEqual(preview.expectedBatchRecord.kind, "provenance-batch");
      assert.ok(preview.expectedBatchRecord.batchSnapshot.inventorySnapshot,
        "the snapshot carries the validated inventory");
      assert.ok(Array.isArray(preview.expectedBatchRecord.batchSnapshot.resolutions),
        "and the derived resolution groups");

      // …and a FRESH Step 6 consumer, reading the store the writer just published, reaches the same
      // record. The preview predicted a batch that really verifies, from a file spelled this way.
      const verdict = await verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK });
      assert.strictEqual(verdict.converged, true, `${form}: the previewed batch really does verify`);
      assert.strictEqual(verdict.batchDigest, preview.expectedBatchRecord.batchDigest,
        `${form}: the consumer's head digest is the one the preview predicted`);
    }));
}

test("the preview creates no lock, no temp and no directory entry of its own", () => withRepo(async (repo) => {
  const w = await prepared(repo, "pretty LF");
  const dir = path.dirname(storeFile(repo));
  const before = fs.readdirSync(dir).sort();
  const beforeBytes = fs.readFileSync(storeFile(repo));

  previewTestProvenanceBatch({
    repoRoot: repo.root, payloadText: JSON.stringify(payloadFor(w, w.preStateDigest)),
  });

  assert.deepStrictEqual(fs.readdirSync(dir).sort(), before, "no lock and no temp appeared");
  assert.deepStrictEqual(fs.readFileSync(storeFile(repo)), beforeBytes, "and the store bytes are untouched");
  assert.ok(!fs.existsSync(`${storeFile(repo)}.lock`), "specifically: no store lock");
}));

// --- 2. inventory ordering: root is free, entry and nested are not ------------------------------------

test("a legally PERMUTED inventory root member order is accepted; the digest is order-independent",
  () => withRepo(async (repo) => {
    const w = await prepared(repo, "canonical");
    const payload = payloadFor(w, w.preStateDigest);
    const inv = payload.batchSnapshot.inventorySnapshot;
    // The same seven members, emitted in a different order. The canonical parser owns entry and
    // nested ordering; the ROOT order of the envelope is explicitly not a rejection reason.
    payload.batchSnapshot.inventorySnapshot = {
      inventoryDigest: inv.inventoryDigest,
      entries: inv.entries,
      inputProvenanceStoreDigest: inv.inputProvenanceStoreDigest,
      headViewDigest: inv.headViewDigest,
      registryDigest: inv.registryDigest,
      baseTreeOid: inv.baseTreeOid,
      inventoryVersion: inv.inventoryVersion,
    };
    const preview = previewTestProvenanceBatch({
      repoRoot: repo.root, payloadText: JSON.stringify(payload),
    });
    assert.strictEqual(preview.expectedBatchRecord.inventoryDigest, inv.inventoryDigest,
      "a permuted root order changes neither acceptance nor the derived digest");
  }));

test("a non-canonical ENTRY member order is refused by the canonical parser", () => withRepo(async (repo) => {
  const w = await prepared(repo, "canonical");
  const payload = payloadFor(w, w.preStateDigest);
  const entry = payload.batchSnapshot.inventorySnapshot.entries[0];
  // testRef first: entry members must ascend by code point, and the reader refuses rather than sorts.
  payload.batchSnapshot.inventorySnapshot.entries[0] = { testRef: entry.testRef, ...entry };

  const error = refused(() => previewTestProvenanceBatch({
    repoRoot: repo.root, payloadText: JSON.stringify(payload),
  }), "a non-canonical entry order");
  assert.strictEqual(error.code, "E_ORDER", error.message);
  assert.match(error.message, /strictly ascending/);
}));

test("a duplicate member inside the inventory subtree is refused on the RAW text", () => withRepo(async (repo) => {
  const w = await prepared(repo, "canonical");
  const text = JSON.stringify(payloadFor(w, w.preStateDigest))
    .replace('"inventoryVersion":2', '"inventoryVersion":2,"inventoryVersion":2');

  const error = refused(() => previewTestProvenanceBatch({ repoRoot: repo.root, payloadText: text }),
    "a duplicate inventory member");
  assert.strictEqual(error.code, "E_DUPLICATE_MEMBER", error.message);
  assert.match(error.message, /appears twice in one object/, error.message);
}));

test("a non-canonical NESTED member order inside an entry is refused too", () => withRepo(async (repo) => {
  const w = await prepared(repo, "canonical");
  const payload = payloadFor(w, w.preStateDigest);
  const ref = payload.batchSnapshot.inventorySnapshot.entries[0].testRef;
  // `path` before `adapterId`, one level below the entry: the ordering rule is not root-only.
  payload.batchSnapshot.inventorySnapshot.entries[0].testRef = {
    path: ref.path, adapterId: ref.adapterId, structuralId: ref.structuralId,
  };

  const error = refused(() => previewTestProvenanceBatch({
    repoRoot: repo.root, payloadText: JSON.stringify(payload),
  }), "a non-canonical nested order");
  assert.strictEqual(error.code, "E_ORDER", error.message);
  assert.match(error.message, /testRef/, error.message);
}));

// --- 3. the writer's own typed refusals, reached through the preview ------------------------------------

test("submitted-JSON and domain faults keep their own typed causes, unwrapped", () => withRepo(async (repo) => {
  const w = await prepared(repo, "canonical");
  const good = payloadFor(w, w.preStateDigest);
  const preview = (payload) => previewTestProvenanceBatch({
    repoRoot: repo.root, payloadText: typeof payload === "string" ? payload : JSON.stringify(payload),
  });

  // malformed JSON, including the empty string, reaches the ordinary invalid-JSON check
  for (const [what, text] of [["malformed JSON", "{ not json"], ["empty text", ""]]) {
    const error = refused(() => preview(text), what);
    assert.strictEqual(error.code, "E_PAYLOAD_JSON", `${what}: ${error.message}`);
  }

  // a stale expected pre-state digest
  const stale = refused(() => preview({ ...good, expectedInputProvenanceStoreDigest: "9".repeat(64) }),
    "a stale expected digest");
  assert.strictEqual(stale.code, "E_CAS_MISMATCH", stale.message);

  // a wrong task claim inside the snapshot, and a top-level task that has no TaskState
  const task = refused(() => preview({
    ...good, batchSnapshot: { ...good.batchSnapshot, taskId: "TASK-OTHER" },
  }), "a wrong batchSnapshot.taskId");
  assert.strictEqual(task.code, "E_BATCH_SNAPSHOT_SHAPE", task.message);
  const unknownTask = refused(() => preview({
    ...good, taskId: "TASK-NOPE", batchSnapshot: { ...good.batchSnapshot, taskId: "TASK-NOPE" },
  }), "an unknown top-level taskId");
  assert.strictEqual(unknownTask.code, "E_UNKNOWN_TASK", unknownTask.message);

  // a wrong base-provenance claim: the stated witness is compared, never overwritten
  const base = refused(() => preview({
    ...good,
    batchSnapshot: {
      ...good.batchSnapshot,
      baseProvenance: { ...w.base, storeDigest: sha256Hex("not the base bytes") },
    },
  }), "a wrong baseProvenance claim");
  assert.strictEqual(base.code, "E_BASE_MISMATCH", base.message);

  // a missing preimage
  const snapshotWithout = { ...good.batchSnapshot };
  delete snapshotWithout.inventorySnapshot;
  const missing = refused(() => preview({ ...good, batchSnapshot: snapshotWithout }), "a missing preimage");
  assert.strictEqual(missing.code, "E_BATCH_SNAPSHOT_MISSING", missing.message);

  // an inventoryDigest that disagrees with the snapshot it encloses
  const disagree = refused(() => preview({
    ...good, batchSnapshot: { ...good.batchSnapshot, inventoryDigest: sha256Hex("another digest") },
  }), "an inventoryDigest disagreement");
  assert.strictEqual(disagree.code, "E_BATCH_DERIVED_DIGEST", disagree.message);

  // a forbidden top-level digest: a second authority for a derived value
  const forbidden = refused(() => preview({ ...good, inventoryDigest: good.batchSnapshot.inventoryDigest }),
    "a caller-supplied top-level inventoryDigest");
  assert.strictEqual(forbidden.code, "E_PAYLOAD_FORBIDDEN", forbidden.message);

  // results that do not cover the entries one-to-one
  const twoEntries = payloadFor(w, w.preStateDigest, {
    entries: [entryFor(w), entryFor(w, {
      testRef: { adapterId: ADAPTER_ID, path: "test/beta.test.mjs", structuralId: 's:["beta"]' },
    })],
  });
  const coverage = refused(() => preview(twoEntries), "incomplete coverage");
  assert.strictEqual(coverage.code, "E_RESULT_COVERAGE", coverage.message);

  // a caller-supplied derived value the writer owns
  const derived = refused(() => preview({ ...good, relatedRefs: [{ kind: "review-ruling", ref: "R-nope" }] }),
    "a caller-supplied relatedRefs");
  assert.strictEqual(derived.code, "E_RELATED_REFS", derived.message);
}));

// --- 4. the API surface --------------------------------------------------------------------------------

test("the request is exactly two own keys and admits no injection", () => {
  const ok = { repoRoot: "/nowhere", payloadText: "{}" };
  const cases = [
    ["a second argument", () => previewTestProvenanceBatch(ok, { now: 1 })],
    ["no argument", () => previewTestProvenanceBatch()],
    ["a non-object request", () => previewTestProvenanceBatch("x")],
    ["an array request", () => previewTestProvenanceBatch([])],
    ["null", () => previewTestProvenanceBatch(null)],
    ["a missing key", () => previewTestProvenanceBatch({ repoRoot: "/nowhere" })],
    ["an options key", () => previewTestProvenanceBatch({ ...ok, options: {} })],
    ["a command key", () => previewTestProvenanceBatch({ ...ok, command: "validate" })],
    ["a clock key", () => previewTestProvenanceBatch({ ...ok, now: 1 })],
    ["a store key", () => previewTestProvenanceBatch({ ...ok, store: {} })],
    ["a digest key", () => previewTestProvenanceBatch({ ...ok, expectedStoreDigest: "a".repeat(64) })],
    ["a callback key", () => previewTestProvenanceBatch({ ...ok, onDerived: () => {} })],
    ["an empty repoRoot", () => previewTestProvenanceBatch({ repoRoot: "", payloadText: "{}" })],
    ["a non-string repoRoot", () => previewTestProvenanceBatch({ repoRoot: 7, payloadText: "{}" })],
    ["a non-string payloadText", () => previewTestProvenanceBatch({ repoRoot: "/nowhere", payloadText: {} })],
  ];
  for (const [what, run] of cases) {
    const error = refused(run, what);
    assert.strictEqual(error.code, "E_API_ARGUMENTS", `${what}: ${error.message}`);
  }
});

test("the returned object is exactly two keys, frozen, and detached from the derived store", () => withRepo(async (repo) => {
  const w = await prepared(repo, "canonical");
  const preview = previewTestProvenanceBatch({
    repoRoot: repo.root, payloadText: JSON.stringify(payloadFor(w, w.preStateDigest)),
  });
  assert.deepStrictEqual(Object.keys(preview).sort(), ["expectedBatchRecord", "inputProvenanceStoreDigest"]);
  assert.ok(Object.isFrozen(preview));
  // A caller mutating the returned record cannot reach anything the store will later derive.
  preview.expectedBatchRecord.batchSnapshot.results.push({ injected: true });
  const second = previewTestProvenanceBatch({
    repoRoot: repo.root, payloadText: JSON.stringify(payloadFor(w, w.preStateDigest)),
  });
  assert.strictEqual(second.expectedBatchRecord.batchSnapshot.results.length, 1,
    "the second derivation is unaffected by the first caller's mutation");
}));

// --- 5. the writer keeps its own authority -------------------------------------------------------------

test("a preview does not authorise a later stale write: the writer re-checks CAS itself", () => withRepo(async (repo) => {
  const w = await prepared(repo, "pretty LF");
  const text = JSON.stringify(payloadFor(w, w.preStateDigest));
  previewTestProvenanceBatch({ repoRoot: repo.root, payloadText: text });   // succeeds

  // The store moves after the preview, exactly as another writer would move it.
  const moved = applyTransaction(w.store, "append-source", {
    source: {
      sourceId: "S-later", contentKind: "requirement", driftMode: "snapshot-only",
      locator: "conversation#2", excerpt: "an unrelated later source",
    },
  }, OPTS);
  fs.writeFileSync(storeFile(repo), canonicalStoreBytes(moved), "utf8");

  const error = refused(
    () => runTransactionFromPayloadText(repo.root, "commit-test-provenance-batch", text, OPTS),
    "a write after the pre-state moved");
  assert.strictEqual(error.code, "E_CAS_MISMATCH",
    "the preview's earlier success carries no authority over the writer's own check");
}));

test("the existing writer entry points and their diagnostics are unchanged by the factoring",
  () => withRepo(async (repo) => {
    const w = await prepared(repo, "canonical");

    // `validate` still short-circuits with changed:false and the loaded digest.
    const validated = runTransactionFromPayloadText(repo.root, "validate", "{}", OPTS);
    assert.deepStrictEqual(
      { command: validated.command, changed: validated.changed, storeDigest: validated.storeDigest },
      { command: "validate", changed: false, storeDigest: w.preStateDigest },
      "the validate early return keeps its exact shape");

    // expectedStoreDigest still takes precedence over everything downstream.
    const cas = refused(
      () => runTransactionFromPayloadText(repo.root, "commit-test-provenance-batch", "{ not json even",
        { ...OPTS, expectedStoreDigest: "0".repeat(64) }),
      "a stale expectedStoreDigest with unparseable text");
    assert.strictEqual(cas.code, "E_PAYLOAD_JSON",
      "the text entry point parses before it locks, which is its existing precedence");

    const casDigest = refused(
      () => runTransactionFromPayloadText(repo.root, "commit-test-provenance-batch",
        JSON.stringify(payloadFor(w, w.preStateDigest)), { ...OPTS, expectedStoreDigest: "0".repeat(64) }),
      "a stale expectedStoreDigest");
    assert.strictEqual(casDigest.code, "E_CAS_MISMATCH", casDigest.message);

    // and an unknown command is still refused by name.
    const unknown = refused(
      () => runTransactionFromPayloadText(repo.root, "no-such-command", "{}", OPTS), "an unknown command");
    assert.strictEqual(unknown.code, "E_UNKNOWN_COMMAND", unknown.message);
  }));

// --- 6. the two accepted resolution forms, previewed on pretty files -----------------------------------
//
// The point is PROTECTION, not extension: a this-round claim and a later historical-convergence
// reference to the Transition that round minted must preview exactly as they write, with no new
// constraint invented by the preview path. Both rounds run against a pretty-printed file, so both are
// cases where the loaded-text digest and the canonical-object digest differ.

const evidenceRecord = (recordId) => ({
  recordId, kind: "review-ruling", by: TEST_DISCIPLINE, subjectRef: ASSUM_A, ruling: "ok",
  taskId: TASK,
  testRef: { adapterId: ADAPTER_ID, path: TEST_PATH, structuralId: STRUCTURAL },
  baseBodyDigest: BODY_BASE,
  headBodyDigest: BODY_HEAD,
  findingKind: "assum-reading-change",
  binding: { clauseRef: ASSUM_A },
});

function thisRoundPayload(w, preStateDigest) {
  const semanticEvidenceRefs = [{ kind: "review-ruling", ref: "R-ev" }];
  const digest = resolutionGroupDigest({
    subjectRef: ASSUM_A, action: "revise", successor: ASSUM_B, semanticEvidenceRefs,
  });
  return payloadFor(w, preStateDigest, {
    results: [resultFor({
      findings: [{
        kind: "assum-reading-change", evidence: "the ASSUM reading moved",
        binding: { clauseRef: ASSUM_A },
        resolutionRef: {
          mode: "this-round", transitionRef: "T-b",
          semanticEvidenceRef: { kind: "review-ruling", ref: "R-ev" },
        },
      }],
    })],
    over: {
      recordsToCreate: [
        evidenceRecord("R-ev"),
        {
          recordId: "R-w", kind: "review-ruling", by: CODE, subjectRef: ASSUM_A, ruling: "ok",
          resolutionGroupDigest: digest,
        },
      ],
      resolutions: [{
        subjectRef: ASSUM_A,
        semanticEvidenceRefs,
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
      }],
      resolutionCarrierUpdates: [{ dpId: "DP-1", action: "unchanged-null" }],
    },
  });
}

const historicalPayload = (w, preStateDigest) => payloadFor(w, preStateDigest, {
  results: [resultFor({
    findings: [{
      kind: "assum-reading-change", evidence: "converged in an earlier round",
      binding: { clauseRef: ASSUM_A },
      resolutionRef: { mode: "historical-convergence", transitionRef: "T-b" },
    }],
  })],
  over: { batchRecordId: "R-b2" },
});

test("a this-round resolution, then a historical-convergence reference to the Transition it minted",
  () => withRepo(async (repo) => {
    const w = await prepared(repo, "pretty LF");

    // Round 1: the this-round form, with its carrier, witness and successor draft.
    const first = JSON.stringify(thisRoundPayload(w, w.preStateDigest));
    const p1 = previewTestProvenanceBatch({ repoRoot: repo.root, payloadText: first });
    assert.deepStrictEqual(
      p1.expectedBatchRecord.batchSnapshot.results[0].findings[0].resolutionRef,
      {
        mode: "this-round", transitionRef: "T-b",
        semanticEvidenceRef: { kind: "review-ruling", ref: "R-ev" },
      },
      "the submitted claim is previewed as submitted, not normalised");
    assert.ok(p1.expectedBatchRecord.batchSnapshot.resolutions.length === 1,
      "and the derived resolution group is present in the previewed snapshot");

    runTransactionFromPayloadText(repo.root, "commit-test-provenance-batch", first, OPTS);
    const after = loadStore(repo.root).store;
    assert.deepStrictEqual(p1.expectedBatchRecord, after.records.find((r) => r.recordId === "R-b1"),
      "whole-record equality with what the writer actually persisted");
    assert.ok(after.clauses.some((c) => c.id === ASSUM_B), "the successor really was minted");
    assert.ok(after.transitions.some((t) => t.id === "T-b"), "and the Transition really landed");

    // Round 2, on a freshly pretty-printed spelling of the store round 1 wrote: the same
    // text/object digest split, now over a store that already carries T-b.
    fs.writeFileSync(storeFile(repo), `${JSON.stringify(after, null, 2)}\n`, "utf8");
    const pre2 = loadStore(repo.root).digest;
    assert.notStrictEqual(pre2, storeDigest(after), "round 2 is a discriminating pretty file too");

    const second = JSON.stringify(historicalPayload(w, pre2));
    const p2 = previewTestProvenanceBatch({ repoRoot: repo.root, payloadText: second });
    assert.deepStrictEqual(p2.expectedBatchRecord.previousBatchRef,
      { kind: "provenance-batch", ref: "R-b1" },
      "the preview reports the REAL chain it read, not an assumed empty one");
    assert.deepStrictEqual(
      p2.expectedBatchRecord.batchSnapshot.results[0].findings[0].resolutionRef,
      { mode: "historical-convergence", transitionRef: "T-b" },
      "a historical-convergence reference keeps its exact two-key form");

    runTransactionFromPayloadText(repo.root, "commit-test-provenance-batch", second, OPTS);
    assert.deepStrictEqual(p2.expectedBatchRecord,
      loadStore(repo.root).store.records.find((r) => r.recordId === "R-b2"),
      "and it previews exactly what it writes");
  }));

// --- 7. input authority: one capture per value, and COMPLETE own-key validation ------------------------
//
// WHAT THIS SECTION IS AND IS NOT. The request is an ordinary JavaScript object, so its properties can
// be accessors. Nothing below is a JSON or CLI weakness — submitted JSON text carries no accessors —
// and the real writer is unaffected either way, because its payloadText is a parameter binding rather
// than a property. What these charge is the helper's OWN contract: it must parse and raw-check the
// same submitted text, and its key check must mean "own keys" rather than "enumerable string keys".

// A request whose two values are enumerable accessors, each counting its own invocations. `values`
// receives the 1-based read number, so a case can make the document change between reads.
function countingRequest(values) {
  const counts = { repoRoot: 0, payloadText: 0 };
  const request = {};
  for (const name of ["repoRoot", "payloadText"]) {
    Object.defineProperty(request, name, {
      enumerable: true,
      configurable: true,
      get() {
        counts[name] += 1;
        return values[name](counts[name]);
      },
    });
  }
  return { request, counts };
}

// A second same-named member inside the inventory subtree. JSON.parse keeps the LAST of the two, so
// the difference is invisible once parsed and only the raw boundary can see it.
const withDuplicateInventoryMember = (text) =>
  text.replace('"inventoryVersion":2', '"inventoryVersion":2,"inventoryVersion":2');

const dirState = (repo) => ({
  bytes: fs.readFileSync(storeFile(repo)),
  entries: fs.readdirSync(path.dirname(storeFile(repo))).sort(),
});

function assertUntouched(repo, before, what) {
  const now = dirState(repo);
  assert.deepStrictEqual(now.bytes, before.bytes, `${what}: the store bytes are unchanged`);
  assert.deepStrictEqual(now.entries, before.entries, `${what}: no lock and no temp appeared`);
}

test("each request value is read EXACTLY once, and the locals carry it from there", () => withRepo(async (repo) => {
  const w = await prepared(repo, "canonical");
  const text = JSON.stringify(payloadFor(w, w.preStateDigest));
  // Constant getters: this case charges the COUNT and nothing else.
  const { request, counts } = countingRequest({
    repoRoot: () => repo.root,
    payloadText: () => text,
  });

  const preview = previewTestProvenanceBatch(request);
  assert.deepStrictEqual(counts, { repoRoot: 1, payloadText: 1 },
    "one capture per value: the type guard, the parse and the derivation all read the local");
  // repoRoot in particular: its guard mentions the value twice and the derivation once, so an
  // uncaptured implementation reaches three reads here, not two.
  assert.deepStrictEqual(preview, previewTestProvenanceBatch({ repoRoot: repo.root, payloadText: text }),
    "and an accessor that behaves like data is treated exactly like data");
}));

test("dirty-first getter: the preview refuses exactly what the actual writer refuses",
  () => withRepo(async (repo) => {
    const w = await prepared(repo, "canonical");
    const clean = JSON.stringify(payloadFor(w, w.preStateDigest));
    const dirty = withDuplicateInventoryMember(clean);
    assert.notStrictEqual(dirty, clean, "the two documents really are different bytes");
    assert.deepStrictEqual(JSON.parse(dirty), JSON.parse(clean),
      "…and identical after parsing, so only a raw check can tell them apart");

    // The reference behaviour, established by the ACTUAL file-text writer on that same document.
    const before = dirState(repo);
    const writerError = refused(
      () => runTransactionFromPayloadText(repo.root, "commit-test-provenance-batch", dirty, OPTS),
      "the actual writer on the dirty document");
    assert.strictEqual(writerError.code, "E_DUPLICATE_MEMBER", writerError.message);
    assertUntouched(repo, before, "the refused write");

    // The preview must reach the same verdict, and must not be talked out of it by a document that
    // only appears from the third read onward.
    const { request, counts } = countingRequest({
      repoRoot: () => repo.root,
      payloadText: (n) => (n <= 2 ? dirty : clean),
    });
    const previewError = refused(() => previewTestProvenanceBatch(request), "the preview on the same document");
    assert.strictEqual(previewError.code, "E_DUPLICATE_MEMBER", previewError.message);
    assert.strictEqual(counts.payloadText, 1, "the substituted document was never consulted");
    assertUntouched(repo, before, "the dirty-first getter");
  }));

test("clean-first getter: the preview accepts exactly the document it parsed",
  () => withRepo(async (repo) => {
    // The mirror direction. It matters because the defect was not "too permissive" but "sameness
    // unenforced": reading again could equally refuse a document the helper never parsed.
    const w = await prepared(repo, "canonical");
    const clean = JSON.stringify(payloadFor(w, w.preStateDigest));
    const dirty = withDuplicateInventoryMember(clean);

    const before = dirState(repo);
    const { request, counts } = countingRequest({
      repoRoot: () => repo.root,
      payloadText: (n) => (n <= 2 ? clean : dirty),
    });
    const preview = previewTestProvenanceBatch(request);
    assert.strictEqual(counts.payloadText, 1, "one read, so the later document is never consulted");
    assertUntouched(repo, before, "the clean-first getter");

    // …and what it derived is what the actual writer derives from the document that WAS read.
    runTransactionFromPayloadText(repo.root, "commit-test-provenance-batch", clean, OPTS);
    assert.deepStrictEqual(preview.expectedBatchRecord,
      loadStore(repo.root).store.records.find((r) => r.recordId === "R-b1"),
      "whole-record equality with the writer on the same document");
  }));

test("hidden and symbol OWN keys are refused, and refused BEFORE the payload is parsed", () => {
  // Empty payloadText is the discriminator. A request that gets past the key check reaches the parse
  // and fails there, so asserting E_API_ARGUMENTS below asserts the PRECEDENCE as well as the rule.
  const base = () => ({ repoRoot: "/nowhere", payloadText: "" });

  const control = refused(() => previewTestProvenanceBatch(base()), "the empty-payload control");
  assert.strictEqual(control.code, "E_PAYLOAD_JSON",
    "the control really does reach the parse, which is what makes the cases below discriminate");

  for (const name of ["options", "command", "now", "store", "expectedStoreDigest", "onDerived"]) {
    const request = base();
    Object.defineProperty(request, name, { value: {}, enumerable: false, configurable: true });
    assert.deepStrictEqual(Object.keys(request).sort(), ["payloadText", "repoRoot"],
      `${name}: invisible to the enumerable view, which is exactly why the check must not use it`);
    const error = refused(() => previewTestProvenanceBatch(request), `a non-enumerable ${name}`);
    assert.strictEqual(error.code, "E_API_ARGUMENTS", `${name}: ${error.message}`);
    assert.match(error.message, new RegExp(`"${name}"`), `${name}: the diagnostic names the offending key`);
  }

  for (const [what, key] of [["a described symbol", Symbol("options")], ["a well-known symbol", Symbol.iterator]]) {
    const request = base();
    request[key] = () => {};
    const error = refused(() => previewTestProvenanceBatch(request), what);
    assert.strictEqual(error.code, "E_API_ARGUMENTS", `${what}: ${error.message}`);
    assert.ok(!(error instanceof TypeError),
      `${what}: a typed refusal, not an engine error from interpolating a symbol`);
    assert.match(error.message, /Symbol\(/,
      `${what}: the symbol is rendered by String(), not flattened to null by JSON.stringify`);
  }

  // The narrowing is a narrowing: a plain two-key request still behaves exactly as before.
  const plain = refused(() => previewTestProvenanceBatch(base()), "plain data");
  assert.strictEqual(plain.code, "E_PAYLOAD_JSON", "a plain two-key request still reaches the parse");
});
