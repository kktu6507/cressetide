// TP AC60 (vii)-(xi): the historical base-provenance consumer, driven through the REAL product
// entry point (`contract-check --provenance`) rather than by calling a validator helper.
//
// Spec anchors:
//   SM  = docs/superpowers/specs/2026-07-25-shared-decision-provenance-model.md (approved v1.14)
//   TP  = docs/superpowers/specs/2026-07-25-test-provenance-spec.md (approved v1.10)
//
// Every fixture builds a real Git object database and a real on-disk store, so the base tree the
// checker reads is a genuine immutable tree rather than a stand-in.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import cp from "node:child_process";
import crypto from "node:crypto";
import { temporary, root } from "./helpers.mjs";
import {
  emptyStore, canonicalStoreBytes, storeDigest, sha256Hex, applyTransaction,
  canonicalJson, digestOf, CANONICAL_STORE_PATH,
} from "../cressetide/skills/vigil/scripts/provenance-store.mjs";
import {
  INVENTORY_PATH, computeInventoryDigest, parseInventory,
  computeInventoryV2Digest, parseCanonicalInventoryV2,
} from "../cressetide/skills/vigil/scripts/changed-test-inventory.mjs";

const NOW = Date.UTC(2026, 6, 26);
const OPTS = { now: NOW };
const SCRIPT = path.join(root, "cressetide", "skills", "vigil", "scripts", "contract-check.mjs");

function git(args, cwd, input) {
  return cp.execFileSync("git", args, {
    cwd, encoding: "utf8", input, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  }).trim();
}

// A real repository whose HEAD tree optionally carries a provenance store at the canonical path.
function repoWithBaseTree(baseBytes) {
  const cwd = temporary("prov-base-");
  git(["init", "-q", "--initial-branch=main"], cwd);
  git(["config", "user.email", "t@example.com"], cwd);
  git(["config", "user.name", "t"], cwd);
  fs.writeFileSync(path.join(cwd, "README.md"), "base\n", "utf8");
  if (baseBytes !== null) {
    fs.mkdirSync(path.join(cwd, ".ctide"), { recursive: true });
    fs.writeFileSync(path.join(cwd, CANONICAL_STORE_PATH), baseBytes, "utf8");
  }
  git(["add", "-A"], cwd);
  git(["commit", "-qm", "base"], cwd);
  const treeOid = git(["rev-parse", "HEAD^{tree}"], cwd);
  return { cwd, treeOid };
}

// The canonical §6 inventory. No root storePath — that lives on TaskState.baseProvenance — and the
// digest is the one formula, computed rather than invented.
function inventoryFor(treeOid, entries = []) {
  const body = { baseTreeOid: treeOid, entries };
  return { ...body, inventoryDigest: computeInventoryDigest(body) };
}

function writeInventory(cwd, inv) {
  const file = path.join(cwd, INVENTORY_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(inv)}\n`, "utf8");
  return file;
}

function writeStore(cwd, store) {
  fs.mkdirSync(path.dirname(path.join(cwd, CANONICAL_STORE_PATH)), { recursive: true });
  fs.writeFileSync(path.join(cwd, CANONICAL_STORE_PATH), canonicalStoreBytes(store), "utf8");
  return canonicalStoreBytes(store);
}

// A task whose baseProvenance witnesses the tree AND which has COMMITTED a clean provenance batch,
// because Step 6 consumes that batch. A null committed head is exercised as its own negative below.
function seedTask(cwd, treeOid, storeDigestValue, { commit = true, inventoryDigest, over = {} } = {}) {
  const base = { treeOid, storePath: CANONICAL_STORE_PATH, storeDigest: storeDigestValue, ...over };
  let store = applyTransaction(emptyStore(), "init-task", {
    taskId: "TASK-1", baseProvenance: base, decisionPoints: [], currentTaskDpIds: [],
  }, OPTS);
  if (commit) {
    store = applyTransaction(store, "commit-test-provenance-batch", {
      taskId: "TASK-1", batchRecordId: "R-b1",
      inventoryDigest: inventoryDigest === undefined ? computeInventoryDigest({ baseTreeOid: treeOid, entries: [] }) : inventoryDigest,
      batchSnapshot: { taskId: "TASK-1", results: [] }, resolutions: [],
    }, OPTS);
  }
  return { store, bytes: writeStore(cwd, store) };
}

// A syntactically complete §6 entry, so "non-empty inventory" is refused for its own reason rather
// than for a shape fault.
function sampleEntry() {
  return {
    testRef: { path: "test/a.test.mjs", adapterId: "node-test", structuralId: "a::case" },
    status: "modified", reason: "content-change",
    tagBefore: { clauseRef: "REQ-a" }, tagAfter: { clauseRef: "REQ-a" },
    baseBodyDigest: sha256Hex("base-body"), headBodyDigest: sha256Hex("head-body"),
    framework: "node:test",
  };
}

// The product entry point. Returns the parsed machine result plus the raw exit status.
function runChecker(cwd, extra = []) {
  const r = cp.spawnSync(process.execPath, [SCRIPT, "--provenance", "--cwd", cwd, ...extra], { encoding: "utf8" });
  let machine = null;
  try { machine = JSON.parse(r.stdout.trim().split("\n").pop()); } catch { /* left null on purpose */ }
  return { status: r.status, machine, stdout: r.stdout, stderr: r.stderr };
}

// Every failing case must leave both stores byte-identical and nothing behind.
function assertNoSideEffects({ cwd, treeOid, currentBefore, baseBefore }, what) {
  assert.strictEqual(
    fs.readFileSync(path.join(cwd, CANONICAL_STORE_PATH), "utf8"), currentBefore,
    `${what}: current provenance store bytes unchanged`);
  if (baseBefore !== null) {
    assert.strictEqual(
      git(["cat-file", "-p", `${treeOid}:${CANONICAL_STORE_PATH}`], cwd), baseBefore.trim(),
      `${what}: base-tree bytes unchanged`);
  }
  assert.ok(!fs.existsSync(path.join(cwd, `${CANONICAL_STORE_PATH}.lock`)), `${what}: no lock left behind`);
  const dir = fs.readdirSync(path.join(cwd, ".ctide"));
  assert.deepStrictEqual(dir.filter((f) => f.endsWith(".tmp")), [], `${what}: no temp residue`);
}

function assertFailure(res, ctx, what, pattern) {
  assert.notStrictEqual(res.status, 0, `${what}: exit code must be non-zero`);
  assert.ok(res.machine, `${what}: a machine result must be emitted, got ${JSON.stringify(res.stdout)}`);
  assert.strictEqual(res.machine.provenance.status, "fail", `${what}: machine status=fail`);
  assert.ok(res.machine.provenance.violations.length > 0, `${what}: at least one violation`);
  if (pattern) {
    assert.match(res.machine.provenance.violations.join(" | "), pattern, `${what}: violation names the right cause`);
  }
  assertNoSideEffects(ctx, what);
}

// --- a legacy v1 store, built the way the migration test does: a real v2 store with the field the
// --- upgrade added stripped back out, so it is genuinely v1-shaped rather than hand-written.
function legacyBytes() {
  const v2 = applyTransaction(emptyStore(), "append-source", {
    source: {
      sourceId: "S-req", contentKind: "requirement", driftMode: "snapshot-only",
      locator: "conversation#1", excerpt: "historical requirement",
    },
  }, OPTS);
  const raw = JSON.parse(JSON.stringify(v2));
  raw.provenanceVersion = 1;
  for (const d of raw.decisionPoints) delete d.reopenCauseRef;
  return canonicalStoreBytes(raw);
}

function v2Bytes() {
  return canonicalStoreBytes(applyTransaction(emptyStore(), "append-source", {
    source: {
      sourceId: "S-req", contentKind: "requirement", driftMode: "snapshot-only",
      locator: "conversation#1", excerpt: "historical requirement",
    },
  }, OPTS));
}

// --- positives: each of the three shapes, with a REAL committed provenance batch --------------

test("TP AC60(vii): a historical v1 base tree passes read-only on its RAW digest, with a committed batch", () => {
  const bytes = legacyBytes();
  const { cwd, treeOid } = repoWithBaseTree(bytes);
  seedTask(cwd, treeOid, sha256Hex(bytes));
  writeInventory(cwd, inventoryFor(treeOid));

  const res = runChecker(cwd);
  assert.strictEqual(res.status, 0, `expected a pass, got ${res.stdout}${res.stderr}`);
  assert.strictEqual(res.machine.provenance.status, "pass");
  assert.strictEqual(res.machine.provenance.historicalVersion, 1, "the historical version is preserved, not upgraded");
  assert.strictEqual(res.machine.provenance.priorStateExists, true);
  assert.strictEqual(res.machine.provenance.committedBatchRef, "R-b1", "the committed batch was consumed");
});

test("TP AC60(viii): a historical v2 base tree passes read-only on its RAW digest, with a committed batch", () => {
  const bytes = v2Bytes();
  const { cwd, treeOid } = repoWithBaseTree(bytes);
  seedTask(cwd, treeOid, sha256Hex(bytes));
  writeInventory(cwd, inventoryFor(treeOid));

  const res = runChecker(cwd);
  assert.strictEqual(res.status, 0, `expected a pass, got ${res.stdout}${res.stderr}`);
  assert.strictEqual(res.machine.provenance.historicalVersion, 2);
  assert.strictEqual(res.machine.provenance.committedBatchRef, "R-b1");
});

test("TP AC60(xi): a base tree with no store falls back to the canonical empty store v2", () => {
  const { cwd, treeOid } = repoWithBaseTree(null);
  seedTask(cwd, treeOid, storeDigest(emptyStore()));
  writeInventory(cwd, inventoryFor(treeOid));

  const res = runChecker(cwd);
  assert.strictEqual(res.status, 0, `expected a pass, got ${res.stdout}${res.stderr}`);
  assert.strictEqual(res.machine.provenance.priorStateExists, false, "prior-state existence is false");
  assert.strictEqual(res.machine.provenance.historicalVersion, 2, "the canonical empty store is version 2");
});

// --- (x) the v1 tree is neither migrated nor written back ----------------------------------------

test("TP AC60(x): consuming a historical v1 base tree migrates nothing and writes nothing back", () => {
  const bytes = legacyBytes();
  const { cwd, treeOid } = repoWithBaseTree(bytes);
  const { bytes: currentBefore } = seedTask(cwd, treeOid, sha256Hex(bytes));
  writeInventory(cwd, inventoryFor(treeOid));
  const headBefore = git(["rev-parse", "HEAD"], cwd);

  assert.strictEqual(runChecker(cwd).status, 0);

  const after = git(["cat-file", "-p", `${treeOid}:${CANONICAL_STORE_PATH}`], cwd);
  assert.strictEqual(sha256Hex(`${after}\n`), sha256Hex(bytes), "base-tree bytes are byte-identical");
  const parsed = JSON.parse(after);
  assert.strictEqual(parsed.provenanceVersion, 1, "no migration");
  assert.ok(parsed.decisionPoints.every((d) => !("reopenCauseRef" in d)), "no reopenCauseRef backfill");
  assert.strictEqual(fs.readFileSync(path.join(cwd, CANONICAL_STORE_PATH), "utf8"), currentBefore);
  assert.strictEqual(git(["rev-parse", "HEAD"], cwd), headBefore, "no commit was created");
});

// --- (ix) raw digest wins over any normalised form ------------------------------------------------

test("TP AC60(ix): a base store matching only AFTER normalisation is refused — the comparison is RAW", () => {
  const clean = v2Bytes();
  // A BOM changes the bytes but not the parsed store: parseStore() strips it, so a normalising
  // comparison would call this a match. The witness names the CLEAN digest. Built from a code point
  // rather than a literal, so this file itself stays free of stray BOM bytes.
  const bomBytes = String.fromCharCode(0xfeff) + clean;
  const { cwd, treeOid } = repoWithBaseTree(bomBytes);
  const { bytes: currentBefore } = seedTask(cwd, treeOid, sha256Hex(clean));
  writeInventory(cwd, inventoryFor(treeOid));

  assertFailure(runChecker(cwd), { cwd, treeOid, currentBefore, baseBefore: null }, "BOM-only difference", /RAW bytes/);

  // The premise, stated with a RAW hasher: sha256Hex() is the CANONICAL digest helper (it strips a
  // BOM and normalises line endings), which is precisely why the checker must not use it for the
  // witness comparison. Raw bytes differ; the canonical digest does not.
  const rawSha = (t) => crypto.createHash("sha256").update(Buffer.from(t, "utf8")).digest("hex");
  assert.notStrictEqual(rawSha(bomBytes), rawSha(clean), "raw byte digests differ");
  assert.strictEqual(sha256Hex(bomBytes), sha256Hex(clean), "yet the canonical digest is identical");
});

// --- (a) a null committed head is legitimate state, but NOT a pass -------------------------------

test("TP AC60: a task with no committed batch is a rerun-the-loop state, never a pass", () => {
  const bytes = v2Bytes();
  const { cwd, treeOid } = repoWithBaseTree(bytes);
  const { bytes: currentBefore } = seedTask(cwd, treeOid, sha256Hex(bytes), { commit: false });
  writeInventory(cwd, inventoryFor(treeOid));
  assertFailure(runChecker(cwd), { cwd, treeOid, currentBefore, baseBefore: bytes },
    "null committed head", /no committedProvenanceBatchRef/);
});

// --- (b)(c) inventory digest and batch staleness --------------------------------------------------

test("TP AC60: an inventoryDigest that is not the canonical formula is refused", () => {
  const bytes = v2Bytes();
  const { cwd, treeOid } = repoWithBaseTree(bytes);
  const { bytes: currentBefore } = seedTask(cwd, treeOid, sha256Hex(bytes));
  const ctx = { cwd, treeOid, currentBefore, baseBefore: bytes };

  writeInventory(cwd, { ...inventoryFor(treeOid), inventoryDigest: sha256Hex("arbitrary") });
  assertFailure(runChecker(cwd), ctx, "arbitrary inventoryDigest", /does not equal sha256\(canonicalJson/);

  // it is RECOMPUTED, so a digest that once matched a different entry set is refused too
  const other = inventoryFor(treeOid, [sampleEntry()]);
  writeInventory(cwd, { baseTreeOid: treeOid, entries: [], inventoryDigest: other.inventoryDigest });
  assertFailure(runChecker(cwd), ctx, "digest of a different entry set", /does not equal sha256\(canonicalJson/);
});

test("TP AC60: a batch committed against a different inventoryDigest is stale for this run", () => {
  const bytes = v2Bytes();
  const { cwd, treeOid } = repoWithBaseTree(bytes);
  const { bytes: currentBefore } = seedTask(cwd, treeOid, sha256Hex(bytes), { inventoryDigest: sha256Hex("an earlier inventory") });
  writeInventory(cwd, inventoryFor(treeOid));
  assertFailure(runChecker(cwd), { cwd, treeOid, currentBefore, baseBefore: bytes },
    "stale batch inventoryDigest", /stale for this inventory/);
});

// --- (d) a populated inventory has no consumer yet, so it fails closed ---------------------------

test("TP AC60: a non-empty inventory fails closed AT THE PARSER, before any consumer sees it", () => {
  const bytes = v2Bytes();
  const { cwd, treeOid } = repoWithBaseTree(bytes);
  const inv = inventoryFor(treeOid, [sampleEntry()]);
  const { bytes: currentBefore } = seedTask(cwd, treeOid, sha256Hex(bytes), { inventoryDigest: inv.inventoryDigest });
  // the batch is deliberately consistent with this inventory, so the refusal cannot be a digest mismatch
  writeInventory(cwd, inv);
  assertFailure(runChecker(cwd), { cwd, treeOid, currentBefore, baseBefore: bytes },
    "entries present", /unsupported-populated-inventory/);
  // the refusal is the parser boundary's, not the downstream slice guard's: the module never hands
  // back a populated inventory for someone else to reject.
});

// --- (e)(f) the current store's own validation runs BEFORE anything is consumed ------------------

test("TP AC60: a corrupted batchDigest in the current store fails closed", () => {
  const bytes = v2Bytes();
  const { cwd, treeOid } = repoWithBaseTree(bytes);
  const { store } = seedTask(cwd, treeOid, sha256Hex(bytes));
  const tampered = JSON.parse(JSON.stringify(store));
  tampered.records.find((r) => r.recordId === "R-b1").batchDigest = sha256Hex("not the snapshot");
  const currentBefore = writeStore(cwd, tampered);
  writeInventory(cwd, inventoryFor(treeOid));
  assertFailure(runChecker(cwd), { cwd, treeOid, currentBefore, baseBefore: bytes },
    "corrupted batchDigest", /batchDigest|E_BATCH/);
});

test("TP AC60: a committed ref that is not the unique chain tip fails closed", () => {
  const bytes = v2Bytes();
  const { cwd, treeOid } = repoWithBaseTree(bytes);
  let { store } = seedTask(cwd, treeOid, sha256Hex(bytes));
  // a second batch advances the head; pointing the committed ref back at the first makes it a
  // stale non-head ref, which the store's own head three-state rule refuses.
  store = applyTransaction(store, "commit-test-provenance-batch", {
    taskId: "TASK-1", batchRecordId: "R-b2",
    inventoryDigest: computeInventoryDigest({ baseTreeOid: treeOid, entries: [] }),
    batchSnapshot: { taskId: "TASK-1", results: [] }, resolutions: [],
    previousBatchRef: { kind: "provenance-batch", ref: "R-b1" },
  }, OPTS);
  const tampered = JSON.parse(JSON.stringify(store));
  tampered.taskStates[0].committedProvenanceBatchRef = { kind: "provenance-batch", ref: "R-b1" };
  const currentBefore = writeStore(cwd, tampered);
  writeInventory(cwd, inventoryFor(treeOid));
  assertFailure(runChecker(cwd), { cwd, treeOid, currentBefore, baseBefore: bytes },
    "stale non-head committed ref", /head|tip|E_HEAD/i);
});

test("TP AC60: a dangling committed ref fails closed", () => {
  const bytes = v2Bytes();
  const { cwd, treeOid } = repoWithBaseTree(bytes);
  const { store } = seedTask(cwd, treeOid, sha256Hex(bytes));
  const tampered = JSON.parse(JSON.stringify(store));
  tampered.taskStates[0].committedProvenanceBatchRef = { kind: "provenance-batch", ref: "R-ghost" };
  const currentBefore = writeStore(cwd, tampered);
  writeInventory(cwd, inventoryFor(treeOid));
  assertFailure(runChecker(cwd), { cwd, treeOid, currentBefore, baseBefore: bytes },
    "dangling committed ref", /R-ghost|DANGLING/i);
});

// --- witness coherence negatives ------------------------------------------------------------------

test("TP AC60: baseProvenance.treeOid must equal the inventory's baseTreeOid", () => {
  const bytes = v2Bytes();
  const { cwd, treeOid } = repoWithBaseTree(bytes);
  const other = "b".repeat(40);
  const inv = inventoryFor(other);
  const { bytes: currentBefore } = seedTask(cwd, treeOid, sha256Hex(bytes), { inventoryDigest: inv.inventoryDigest });
  writeInventory(cwd, inv);
  assertFailure(runChecker(cwd), { cwd, treeOid, currentBefore, baseBefore: bytes },
    "treeOid vs inventory baseTreeOid", /does not equal the inventory/);
});

test("TP AC60: a batch witness differing from TaskState.baseProvenance fails closed", () => {
  const bytes = v2Bytes();
  const { cwd, treeOid } = repoWithBaseTree(bytes);
  const { store } = seedTask(cwd, treeOid, sha256Hex(bytes));
  const tampered = JSON.parse(JSON.stringify(store));
  const batch = tampered.records.find((r) => r.recordId === "R-b1");
  batch.batchSnapshot.baseProvenance = { ...batch.batchSnapshot.baseProvenance, treeOid: "c".repeat(40) };
  // keep the batch self-consistent so the failure is the WITNESS comparison, not the digest
  batch.batchDigest = digestOf(batch.batchSnapshot);
  const currentBefore = writeStore(cwd, tampered);
  writeInventory(cwd, inventoryFor(treeOid));
  assertFailure(runChecker(cwd), { cwd, treeOid, currentBefore, baseBefore: bytes },
    "batch witness vs TaskState", /E_BATCH_BASE_MISMATCH|differs from TaskState/);
  // the current store's OWN validation catches this before the checker consumes the index, which is
  // exactly the ordering item 1 requires: loadStore() only parses.
});

// --- (g)(h) Git failures are never "no store" ----------------------------------------------------

test("TP AC60: an unreadable tree fails closed rather than reading as a missing store", () => {
  const bytes = v2Bytes();
  const { cwd, treeOid } = repoWithBaseTree(bytes);
  const ghost = `${"0".repeat(39)}1`;
  const inv = inventoryFor(ghost);
  const { bytes: currentBefore } = seedTask(cwd, ghost, sha256Hex(bytes), { inventoryDigest: inv.inventoryDigest });
  writeInventory(cwd, inv);

  const res = runChecker(cwd);
  assertFailure(res, { cwd, treeOid, currentBefore, baseBefore: bytes }, "unreadable tree", /does not resolve to any Git object/);
  assert.doesNotMatch(res.machine.provenance.violations.join(" | "), /canonical empty store/,
    "a Git failure must not be reported as a missing store");
});

test("TP AC60(g): a tree whose store blob does not exist fails closed on the BLOB read", () => {
  const bytes = v2Bytes();
  const { cwd } = repoWithBaseTree(null);
  // Built with plumbing rather than by deleting a loose object: `git mktree --missing` writes a tree
  // that REFERENCES a blob oid which was never added to the object database, so the ls-tree-succeeds
  // / cat-file-fails branch is exercised on every machine, packed objects or not. The previous
  // version skipped silently when the object happened to be packed.
  const blobOid = git(["hash-object", "--stdin"], cwd, bytes);          // computed, NOT written
  const subtree = git(["mktree", "--missing"], cwd, `100644 blob ${blobOid}\tprovenance.json\n`);
  const treeOid = git(["mktree", "--missing"], cwd, `040000 tree ${subtree}\t.ctide\n`);

  // the three conditions this case exists to hit, asserted rather than assumed
  assert.ok(git(["rev-parse", "--verify", `${treeOid}^{tree}`], cwd), "the tree itself reads");
  const listing = git(["ls-tree", "--full-tree", treeOid, "--", CANONICAL_STORE_PATH], cwd);
  assert.match(listing, /blob/, "the path is listed, and listed as a blob");
  assert.match(listing, new RegExp(blobOid), "listing names the missing blob");
  assert.throws(() => git(["cat-file", "blob", blobOid], cwd), "the blob genuinely cannot be read");

  const inv = inventoryFor(treeOid);
  const { bytes: currentBefore } = seedTask(cwd, treeOid, sha256Hex(bytes), { inventoryDigest: inv.inventoryDigest });
  const headBefore = JSON.parse(currentBefore).taskStates[0].committedProvenanceBatchRef;
  writeInventory(cwd, inv);

  const res = runChecker(cwd);
  assert.notStrictEqual(res.status, 0, "exit code must be non-zero");
  assert.strictEqual(res.machine.provenance.status, "fail");
  const joined = res.machine.provenance.violations.join(" | ");
  assert.match(joined, /cannot be read/, "the violation names the blob read");
  assert.doesNotMatch(joined, /canonical empty store/, "a destroyed blob must not be reported as a missing store");

  assert.strictEqual(fs.readFileSync(path.join(cwd, CANONICAL_STORE_PATH), "utf8"), currentBefore, "current store bytes unchanged");
  assert.deepStrictEqual(
    JSON.parse(fs.readFileSync(path.join(cwd, CANONICAL_STORE_PATH), "utf8")).taskStates[0].committedProvenanceBatchRef,
    headBefore, "committed head unchanged");
  assert.ok(!fs.existsSync(path.join(cwd, `${CANONICAL_STORE_PATH}.lock`)), "lock released");
  assert.deepStrictEqual(
    fs.readdirSync(path.join(cwd, ".ctide")).filter((f) => f.endsWith(".tmp")), [], "no temp residue");
});

// --- the fail-closed boundary on shapes this build does not implement ----------------------------

test("TP AC60: an inventory outside the canonical §6 schema fails closed", () => {
  const bytes = v2Bytes();
  const { cwd, treeOid } = repoWithBaseTree(bytes);
  const { bytes: currentBefore } = seedTask(cwd, treeOid, sha256Hex(bytes));
  const ctx = { cwd, treeOid, currentBefore, baseBefore: bytes };

  // a root storePath is no longer part of the carrier: the canonical path is TaskState's to state
  writeInventory(cwd, { ...inventoryFor(treeOid), storePath: CANONICAL_STORE_PATH });
  assertFailure(runChecker(cwd), ctx, "root storePath", /undeclared: storePath/);

  // ANY populated entries[] stops at the same boundary, whatever its shape: this build does not
  // implement §6 entry semantics, so it refuses rather than partially understanding them.
  const short = { baseTreeOid: treeOid, entries: [{ path: "a", structuralId: "b" }] };
  writeInventory(cwd, { ...short, inventoryDigest: computeInventoryDigest(short) });
  assertFailure(runChecker(cwd), ctx, "a reduced entry shape", /unsupported-populated-inventory/);

  const full = { baseTreeOid: treeOid, entries: [sampleEntry()] };
  writeInventory(cwd, { ...full, inventoryDigest: computeInventoryDigest(full) });
  assertFailure(runChecker(cwd), ctx, "a complete-looking entry", /unsupported-populated-inventory/);

  // an absent inventory is a failure, never an observe-only pass
  fs.rmSync(path.join(cwd, INVENTORY_PATH));
  assertFailure(runChecker(cwd), ctx, "absent inventory", /cannot read changed-test-inventory/);
});

// --- parser boundary: parseInventory refuses a populated inventory ITSELF -----------------------
// The downstream guard in contract-check is defence in depth. It cannot stand in for the parser's
// own contract: a module named changed-test-inventory must not hand back a populated inventory as a
// parsed canonical artifact and leave the refusal to whoever happens to consume it next.
//
// Two layers now exist, and the distinction matters:
//   parseCanonicalInventoryV2()  IS implemented, and reads a populated ChangedTestInventoryV2
//                                completely against shared v1.14 + test-provenance v1.10. Its own
//                                behaviour is covered by test/changed-test-inventory.test.mjs.
//   parseInventory()             is the PRODUCT entry point, and still refuses to hand a populated
//                                inventory to a consumer -- because reading one correctly says
//                                nothing about the producer that wrote it, the base/head matcher,
//                                the governance reverse closure or the S3 recomputation a consumer
//                                owes, none of which exists.
// The fixtures below are LEGACY v1 documents, which have no discriminator and no v2 entry contract;
// the v2 discriminator case is the separate test at the end of this section.

function inventoryText(baseTreeOid, entries) {
  const body = { baseTreeOid, entries };
  return JSON.stringify({ ...body, inventoryDigest: computeInventoryDigest(body) });
}

const TREE = "a".repeat(40);

function parserRefuses(entries, what) {
  let err = null;
  try { parseInventory(inventoryText(TREE, entries)); } catch (e) { err = e; }
  assert.ok(err, `${what}: parseInventory must refuse it at the parser boundary`);
  assert.strictEqual(err.name, "InventoryError", `${what}: refused as an InventoryError`);
  return err;
}

test("TP §6 parser boundary: a populated inventory is refused by parseInventory itself", () => {
  const e = parserRefuses([sampleEntry()], "one well-formed-looking entry");
  assert.match(e.message, /unsupported-populated-inventory/, "a named, stable error rather than a shape complaint");

  // every shape the old partial checks would have waved through — or would have rejected for the
  // WRONG reason — now stops at the same boundary, because none of them is supported yet
  const two = [
    { ...sampleEntry(), testRef: { path: "test/b.test.mjs", adapterId: "node-test", structuralId: "b::case" } },
    sampleEntry(),
  ];
  parserRefuses(two, "reverse-sorted entries");
  parserRefuses([sampleEntry(), sampleEntry()], "duplicate testRef identity");
  parserRefuses([{ ...sampleEntry(), testRef: { ...sampleEntry().testRef, path: "test\\a.test.mjs" } }], "a backslash in path");
  parserRefuses([{ ...sampleEntry(), testRef: { ...sampleEntry().testRef, path: "./test/a.test.mjs" } }], "a ./ dot-segment");
  parserRefuses([{ ...sampleEntry(), testRef: { ...sampleEntry().testRef, path: "../test/a.test.mjs" } }], "a ../ dot-segment");
  parserRefuses([{ ...sampleEntry(), tagAfter: { clauseRef: "DEC-a", dpRef: "DP-1" } }], "DEC@DP");
  parserRefuses([{ ...sampleEntry(), tagAfter: { clauseRef: "ASSUM-a", dpRef: "DP-1" } }], "ASSUM@DP");
  parserRefuses([{ ...sampleEntry(), tagAfter: { clauseRef: "whatever you like" } }], "an arbitrary clauseRef");
  parserRefuses([{ ...sampleEntry(), tagAfter: { clauseRef: "REQ-a", dpRef: "not a dp" } }], "an arbitrary dpRef");
});

test("TP §6 parser boundary: the empty envelope is still parsed and its digest still recomputed", () => {
  const ok = parseInventory(inventoryText(TREE, []));
  assert.strictEqual(ok.baseTreeOid, TREE);
  assert.deepStrictEqual(ok.entries, []);

  // the canonical formula is still enforced on the clean slice
  const body = { baseTreeOid: TREE, entries: [] };
  let err = null;
  try {
    parseInventory(JSON.stringify({ ...body, inventoryDigest: "not the formula" }));
  } catch (e) { err = e; }
  assert.ok(err && /does not equal sha256\(canonicalJson/.test(err.message), "the digest is recomputed, not accepted");

  // and the root envelope stays exact
  let err2 = null;
  try {
    parseInventory(JSON.stringify({ ...body, inventoryDigest: computeInventoryDigest(body), storePath: ".ctide/provenance.json" }));
  } catch (e) { err2 = e; }
  assert.ok(err2 && /undeclared: storePath/.test(err2.message), "no second authority for the canonical store path");
});

// --- the discriminator: readable is NOT the same as accepted ------------------------------------
// Every populated fixture above is a LEGACY v1 document, so "refused" could always be explained by
// "this build understands no v2 entry contract". That explanation is gone: the entry contract IS
// implemented. This case therefore uses a fully canonical v2 inventory whose every field, ordering
// rule and digest the isolated reader accepts, and shows the PRODUCT entry point still failing
// closed on the very same bytes. Nothing here is malformed; the refusal is a policy boundary.

function writeInventoryText(cwd, text) {
  const file = path.join(cwd, INVENTORY_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${text}\n`, "utf8");
  return file;
}

test("TP AC158: a fully canonical POPULATED v2 inventory is readable, and the product entry point still fails closed", () => {
  const bytes = v2Bytes();
  const { cwd, treeOid } = repoWithBaseTree(bytes);
  const { bytes: currentBefore } = seedTask(cwd, treeOid, sha256Hex(bytes));
  const ctx = { cwd, treeOid, currentBefore, baseBefore: bytes };

  const body = {
    inventoryVersion: 2,
    baseTreeOid: treeOid,
    registryDigest: sha256Hex("registry preimage"),
    headViewDigest: sha256Hex("S1 canonical map"),
    inputProvenanceStoreDigest: sha256Hex("current store"),
    entries: [{
      testRef: { path: "test/a.test.mjs", adapterId: "node-test", structuralId: "s:[\"a\"]" },
      status: "modified",
      reason: "content-change",
      tagBefore: { clauseRef: "REQ-00000000000000000000000000" },
      tagAfter: { clauseRef: "REQ-00000000000000000000000000" },
      baseBodyDigest: sha256Hex("base body"),
      headBodyDigest: sha256Hex("head body"),
      framework: "node:test",
      implementationIdentity: { implementationId: "node-test-v1", parserId: "acorn", parserVersion: "8.18.0" },
    }],
  };
  // canonicalJson emits every object with its members in code-point order, which is exactly what the
  // v1.10 entry source-key ordering gate requires.
  const text = canonicalJson({ ...body, inventoryDigest: computeInventoryV2Digest(body) });
  writeInventoryText(cwd, text);

  const read = parseCanonicalInventoryV2(text);
  assert.strictEqual(read.entries.length, 1, "the isolated canonical reader accepts the very bytes on disk");
  assert.strictEqual(read.inventoryDigest, computeInventoryV2Digest(body), "including its recomputed digest");

  assertFailure(runChecker(cwd), ctx, "a canonical populated v2 inventory", /unsupported-populated-inventory/);
});

// --- the witness names an EXACT tree, not something Git can peel into one ----------------------

test("TP AC60: a commit OID standing in for the base tree is refused — the witness must BE a tree", () => {
  const bytes = v2Bytes();
  const { cwd, treeOid } = repoWithBaseTree(bytes);
  const commitOid = git(["rev-parse", "HEAD"], cwd);

  // The premise, asserted rather than assumed: this really is a commit, and it really is a
  // different object from the tree it points at. `git rev-parse --verify <oid>^{tree}` succeeds on
  // both, and so does `git ls-tree`, so peelability proves nothing about the object's own type.
  assert.strictEqual(git(["cat-file", "-t", commitOid], cwd), "commit", "the fixture OID is a commit");
  assert.strictEqual(git(["rev-parse", `${commitOid}^{tree}`], cwd), treeOid, "it peels to the tree");
  assert.notStrictEqual(commitOid, treeOid, "and the two OIDs are not the same object");

  // Both witnesses carry the COMMIT oid, so they agree with each other; only the object's type is
  // wrong. Nothing else in the chain is disturbed.
  const inv = inventoryFor(commitOid);
  const { bytes: currentBefore } = seedTask(cwd, commitOid, sha256Hex(bytes), { inventoryDigest: inv.inventoryDigest });
  const headBefore = JSON.parse(currentBefore).taskStates[0].committedProvenanceBatchRef;
  writeInventory(cwd, inv);

  const res = runChecker(cwd);
  assert.notStrictEqual(res.status, 0, "exit code must be non-zero");
  assert.strictEqual(res.machine.provenance.status, "fail");
  const joined = res.machine.provenance.violations.join(" | ");
  assert.match(joined, /is a commit, not a tree|not a tree/, "the violation names the object's actual type");

  assert.strictEqual(fs.readFileSync(path.join(cwd, CANONICAL_STORE_PATH), "utf8"), currentBefore, "current store bytes unchanged");
  assert.deepStrictEqual(
    JSON.parse(fs.readFileSync(path.join(cwd, CANONICAL_STORE_PATH), "utf8")).taskStates[0].committedProvenanceBatchRef,
    headBefore, "committed head unchanged");
  assert.strictEqual(git(["cat-file", "-p", `${treeOid}:${CANONICAL_STORE_PATH}`], cwd), bytes.trim(), "base-tree bytes unchanged");
  assert.ok(!fs.existsSync(path.join(cwd, `${CANONICAL_STORE_PATH}.lock`)), "lock released");
  assert.deepStrictEqual(
    fs.readdirSync(path.join(cwd, ".ctide")).filter((f) => f.endsWith(".tmp")), [], "no temp residue");
});

test("TP AC60: a blob or a tag OID is refused for the same reason a commit is", () => {
  const bytes = v2Bytes();
  const { cwd, treeOid } = repoWithBaseTree(bytes);
  const blobOid = git(["rev-parse", `${treeOid}:${CANONICAL_STORE_PATH}`], cwd);
  assert.strictEqual(git(["cat-file", "-t", blobOid], cwd), "blob", "the fixture OID is a blob");

  for (const [oid, what] of [
    [blobOid, "a blob OID"],
    [`${"d".repeat(39)}0`, "an OID that resolves to no object at all"],
  ]) {
    const inv = inventoryFor(oid);
    const { bytes: currentBefore } = seedTask(cwd, oid, sha256Hex(bytes), { inventoryDigest: inv.inventoryDigest });
    writeInventory(cwd, inv);
    const res = runChecker(cwd);
    assert.notStrictEqual(res.status, 0, `${what}: exit code must be non-zero`);
    assert.strictEqual(res.machine.provenance.status, "fail", `${what}: machine status=fail`);
    assert.strictEqual(fs.readFileSync(path.join(cwd, CANONICAL_STORE_PATH), "utf8"), currentBefore, `${what}: no write`);
    assert.deepStrictEqual(
      fs.readdirSync(path.join(cwd, ".ctide")).filter((f) => f.endsWith(".tmp")), [], `${what}: no temp residue`);
  }
});

test("IS §8: the default contract-check mode keeps its fail-open, always-exit-0 contract", () => {
  const { cwd } = repoWithBaseTree(null);
  const r = cp.spawnSync(process.execPath, [SCRIPT], { cwd, encoding: "utf8" });
  assert.strictEqual(r.status, 0, "the default mode still exits 0");
  assert.doesNotMatch(r.stdout, /"provenance"/, "and emits no provenance machine result");
});
