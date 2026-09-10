// TP §11b.9c Step 6: the committed-batch consumer.
//
// SCOPE. A green run here proves the COMPONENT, not the product. `--provenance` now delegates to this
// component, and test/provenance-base-consumer.test.mjs is what covers that CLI boundary — argument
// enforcement, machine JSON and real exit codes — so a green run of THIS file still says nothing
// about it. It emits no artifact, and it does not establish AC118/AC136/AC137/AC138 or make Phase 2
// READY. (The retired unsupported-populated-inventory gate is no longer named here: it does not
// exist.)
//
// Spec anchors (the current approved coupled set, read as one effective set):
//   SM = 2026-07-25-shared-decision-provenance-model.md (approved v1.15) §2, §9 layer table
//   TP = 2026-07-25-test-provenance-spec.md (approved v1.17) §2, §6, §11b.9c, AC127
//
// HOW THE FIXTURES WORK, and why they discriminate. Every store is built by chaining the REAL
// transactions, including the accepted v2 writer, so a batch under test is one the writer actually
// produced. The base tree is a REAL Git tree written with real plumbing. The inventory's two source
// digests are taken from a REAL capture and a REAL fresh registry read, computed exactly the way the
// component computes them — that is the expected value, not a seam. Each negative moves ONE field off
// a passing positive, so a deep semantic guard is never credited to an unrelated shape error.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cp from "node:child_process";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

import { root } from "./helpers.mjs";
import {
  emptyStore, canonicalStoreBytes, storeDigest, applyTransaction, indexStore, digestOf, parseStore,
  resolutionGroupDigest, canonicalJson, CANONICAL_STORE_PATH,
} from "../cressetide/skills/vigil/scripts/provenance-store.mjs";
import { computeInventoryV2Digest } from "../cressetide/skills/vigil/scripts/changed-test-inventory.mjs";
import { captureHeadViewSnapshot } from "../cressetide/skills/vigil/scripts/head-view-snapshot.mjs";
import { readTestAdapterRegistryRootFresh } from "../cressetide/skills/vigil/scripts/adapter-registry.mjs";
import {
  readHeadExplicitConfig, registryDigestOf,
} from "../cressetide/skills/vigil/scripts/explicit-config.mjs";
import {
  verifyCommittedBatch, CommittedBatchError,
} from "../cressetide/skills/vigil/scripts/committed-batch-consumer.mjs";
import { readExactTreeBlob, ExactTreeBlobError } from "../cressetide/skills/vigil/scripts/exact-tree-blob.mjs";
import {
  countOccurrences, buildSearchView, checkSourceOccurrence, canonicalSearchBytes,
} from "../cressetide/skills/vigil/scripts/source-occurrence.mjs";

const OPTS = { now: Date.UTC(2026, 8, 6) };
const TASK = "TASK-1";
const ASSUM_A = "ASSUM-0000000000000000000000000A";
const ASSUM_B = "ASSUM-0000000000000000000000000B";
const ASSUM_C = "ASSUM-0000000000000000000000000C";
const CODE = { kind: "discipline", discipline: "code" };
const TEST_DISCIPLINE = { kind: "discipline", discipline: "test" };
const ADAPTER_ID = "node-test";
const TEST_PATH = "test/alpha.test.mjs";
const STRUCTURAL = 's:["alpha"]';
const rawDigest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

async function refused(promise, what, code) {
  let error = null;
  try { await promise; } catch (e) { error = e; }
  assert.ok(error && error.code, `${what}: expected a coded failure, got ${error}`);
  if (code) assert.strictEqual(error.code, code, `${what}: expected ${code}, got ${error.code} (${error.message})`);
  return error;
}

// --- a real repository ------------------------------------------------------------------------------

// EVERY disposable root goes through this before it is written to and again before it is removed.
// mkdtemp is resolved with realpathSync so the copied modules import through a stable path, and that
// resolution can legitimately move the path -- a symlinked TMPDIR is ordinary on macOS. A resolved
// root is only usable here if it is still a direct child of the resolved temp parent AND still
// carries this suite's prefix; anything else must never reach a recursive delete.
function checkedTempRoot(dir, prefix) {
  const parent = fs.realpathSync(os.tmpdir());
  const resolved = path.resolve(dir);
  assert.strictEqual(path.dirname(resolved), parent,
    `refusing to use ${resolved}: it is not a direct child of the temporary parent ${parent}`);
  assert.ok(path.basename(resolved).startsWith(prefix),
    `refusing to use ${resolved}: it does not carry the expected prefix ${prefix}`);
  return resolved;
}

function makeRepo(prefix = "ctide-step6-") {
  const dir = checkedTempRoot(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix))), prefix);
  const git = (...a) => cp.execFileSync("git", a, {
    cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  git("init", "-q", "--initial-branch=main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  const write = (rel, body) => {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body, "utf8");
  };
  return { root: dir, git, write, prefix };
}

async function withRepo(body, prefix = "ctide-step6-") {
  const repo = makeRepo(prefix);
  try {
    return await body(repo);
  } finally {
    fs.rmSync(checkedTempRoot(repo.root, repo.prefix), { recursive: true, force: true });
  }
}

// The two SOURCE digests, computed the way the component computes them, from a real capture and a
// real fresh registry read. Building the inventory any other way would make every positive fail on
// freshness for reasons unrelated to what it tests.
async function currentSourceDigests(repoRoot) {
  const snapshot = await captureHeadViewSnapshot({ repoRoot });
  const registryRoot = readTestAdapterRegistryRootFresh();
  return {
    headViewDigest: snapshot.headViewDigest,
    registryDigest: registryDigestOf(registryRoot, readHeadExplicitConfig(snapshot, registryRoot)),
    registryRoot,
  };
}

const adapterIdentity = (registryRoot, adapterId) => registryRoot.adapters
  .find((a) => a.adapterId === adapterId).implementationIdentity;

// --- fixtures ---------------------------------------------------------------------------------------

// THE PRIOR STORE — the one that goes INTO the base tree. A pre-side tag is a statement about the
// pre-state, so shared §9 resolves it in B; a fixture whose pre tag exists only in the current store
// is not a legitimate world and must not be used to keep a positive green.
//
// `extra` lets a case seed additional history (a live-source REQ, an exception grant) into B.
function priorStore(seedTree, extra = (s) => s) {
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
  s = applyTransaction(s, "create-initial-outcome", {
    dpId: "DP-1",
    records: [{ recordId: "R-rule1", kind: "review-ruling", by: CODE, subjectRef: "DP-1", ruling: "ok" }],
    clause: {
      id: ASSUM_A, layer: "implementation", derivedFrom: "DP-1", text: "treat null as absent",
      alternative: "treat null as invalid", basis: "matches the option table", basisRefs: [],
      governedBy: CODE, routingOrigin: "safe-default",
    },
  }, OPTS);
  return extra(s);
}

// Commit the prior store into a real tree, then start this task against that exact raw witness. The
// head view is captured AFTER the last commit, so nothing written to the working tree afterwards
// moves the two source digests.
async function withHistory(repo, { files = {}, extra, mutatePrior, taskDps = ["DP-1"] } = {}) {
  repo.write(TEST_PATH, 'import { test } from "node:test";\ntest("alpha", () => {});\n');
  repo.write(".ctide/keep", "x\n");
  for (const [rel, body] of Object.entries(files)) repo.write(rel, body);
  repo.git("add", "-A");
  repo.git("commit", "-qm", "seed");
  const seedTree = repo.git("rev-parse", "HEAD^{tree}");

  const prior = priorStore(seedTree, extra);
  // HISTORY may contain facts no current transaction would mint today -- an exception grant that has
  // since expired is the point of the clock-free rule, and resolve-exception refuses to create one.
  if (mutatePrior) mutatePrior(prior);
  repo.write(CANONICAL_STORE_PATH, canonicalStoreBytes(prior));
  repo.git("add", "-A");
  repo.git("commit", "-qm", "history");
  const treeOid = repo.git("rev-parse", "HEAD^{tree}");
  const committed = fs.readFileSync(path.join(repo.root, CANONICAL_STORE_PATH));
  const base = { treeOid, storePath: CANONICAL_STORE_PATH, storeDigest: rawDigest(committed) };

  const store = applyTransaction(prior, "init-task", {
    taskId: TASK, baseProvenance: base, decisionPoints: [], currentTaskDpIds: taskDps,
  }, OPTS);
  const digests = await currentSourceDigests(repo.root);
  return {
    base, treeOid, prior, store, digests,
    identity: adapterIdentity(digests.registryRoot, ADAPTER_ID),
  };
}

// One legal ChangedTestInventoryV2 entry, and the result that exactly covers it. Written side by side
// by hand; neither is derived from the other.
function entryFor(identity, over = {}) {
  return {
    baseBodyDigest: "1".repeat(64),
    framework: "node-test",
    headBodyDigest: "2".repeat(64),
    implementationIdentity: identity,
    reason: "content-change",
    status: "modified",
    tagAfter: { clauseRef: ASSUM_A },
    tagBefore: { clauseRef: ASSUM_A },
    testRef: { adapterId: ADAPTER_ID, path: TEST_PATH, structuralId: STRUCTURAL },
    ...over,
  };
}

const resultFor = (over = {}) => ({
  testRef: { path: TEST_PATH, adapterId: ADAPTER_ID, structuralId: STRUCTURAL },
  tagBefore: { clauseRef: ASSUM_A },
  tagAfter: { clauseRef: ASSUM_A },
  observedBaseBodyDigest: "1".repeat(64),
  observedHeadBodyDigest: "2".repeat(64),
  findings: [],
  ...over,
});

function inventoryFor(digests, base, entries) {
  const body = {
    inventoryVersion: 2,
    baseTreeOid: base.treeOid,
    registryDigest: digests.registryDigest,
    headViewDigest: digests.headViewDigest,
    inputProvenanceStoreDigest: "3".repeat(64),
    entries,
    ...(entries.over || {}),
  };
  return { ...body, inventoryDigest: computeInventoryV2Digest(body) };
}

// Build the current store, commit a batch through the REAL writer, and write it to the repository.
function commitBatch(repo, store, base, inventory, results, over = {}) {
  const payload = {
    taskId: TASK,
    batchRecordId: "R-b1",
    expectedInputProvenanceStoreDigest: storeDigest(store),
    batchSnapshot: {
      taskId: TASK,
      baseProvenance: base,
      inventoryDigest: inventory.inventoryDigest,
      inventorySnapshot: { ...inventory, inputProvenanceStoreDigest: storeDigest(store) },
      results,
      resolutions: [],
    },
    resolutions: [],
    ...over,
  };
  // The inventory the writer persists must bind the pre-state it was produced against, so its digest
  // is recomputed after that field is set to the real value.
  const snap = payload.batchSnapshot.inventorySnapshot;
  snap.inventoryDigest = computeInventoryV2Digest(snap);
  payload.batchSnapshot.inventoryDigest = snap.inventoryDigest;
  const next = applyTransaction(store, "commit-test-provenance-batch", payload, OPTS);
  repo.write(CANONICAL_STORE_PATH, canonicalStoreBytes(next));
  return next;
}

// One complete converging world: a real base tree, a real store, a real committed batch, and an
// inventory whose source digests really are the current ones.
async function cleanWorld(repo, entryOver = {}, resultOver = {}) {
  const world = await withHistory(repo);
  const inventory = inventoryFor(world.digests, world.base, [entryFor(world.identity, entryOver)]);
  const next = commitBatch(repo, world.store, world.base, inventory, [resultFor(resultOver)]);
  return { ...world, store: next };
}

// --- 1. the exported raw reader (Q1) ------------------------------------------------------------------

test("Q1: the shared reader returns {present,rawBytes,rawDigest}, in the RAW notation", async () => {
  await withRepo(async (repo) => {
    // A BOM + CRLF blob: the notation discriminator. sha256 over the bytes as they stand is NOT the
    // store's canonicalising sha256Hex, and confusing the two makes such a base permanently mismatch.
    const body = "\ufeffline one\r\nline two\r\n";
    repo.write("data.txt", body);
    repo.git("add", "-A");
    repo.git("commit", "-qm", "c");
    const treeOid = repo.git("rev-parse", "HEAD^{tree}");

    const read = await readExactTreeBlob({ repoRoot: repo.root, treeOid, path: "data.txt" });
    assert.deepStrictEqual(Object.keys(read).sort(), ["present", "rawBytes", "rawDigest"],
      "the success shape carries no unused mode/oid");
    assert.strictEqual(read.present, true);
    assert.strictEqual(read.rawDigest, rawDigest(read.rawBytes), "raw sha256 over the captured bytes");
    assert.notStrictEqual(read.rawDigest, crypto.createHash("sha256")
      .update(Buffer.from(body.replace(/^\ufeff/, "").replace(/\r\n/g, "\n"), "utf8")).digest("hex"),
      "…and it is not the canonicalised notation");

    const absent = await readExactTreeBlob({ repoRoot: repo.root, treeOid, path: "nowhere.txt" });
    assert.deepStrictEqual(absent, { present: false, rawBytes: null, rawDigest: null },
      "absence is absence, with no store meaning attached");
  }, "ctide-step6-read-");
});

test("Q1: the input domain is a full hex object name and a canonical relative path", async () => {
  await withRepo(async (repo) => {
    repo.write("a.txt", "x\n");
    repo.git("add", "-A");
    repo.git("commit", "-qm", "c");
    const treeOid = repo.git("rev-parse", "HEAD^{tree}");
    const commitOid = repo.git("rev-parse", "HEAD");
    const call = (over) => readExactTreeBlob({ repoRoot: repo.root, treeOid, path: "a.txt", ...over });

    assert.ok((await call({})).present, "the positive control reaches success first");

    // Grammar refuses every expression spelling and every abbreviation BEFORE Git runs.
    for (const [what, oid] of [
      ["a peeling expression", "HEAD^{tree}"], ["a ref", "main"],
      ["an abbreviation", treeOid.slice(0, 7)], ["uppercase hex", treeOid.toUpperCase()],
    ]) {
      await refused(call({ treeOid: oid }), what, "E_TREE_OID_GRAMMAR");
    }
    // A well-formed name that is not a tree still needs the own-object type check.
    const typed = await refused(call({ treeOid: commitOid }), "a commit oid", "E_TREE_OID");
    assert.strictEqual(typed.detail.type, "commit");

    // BOTH magic spellings fail the INPUT rule, so neither reaches Git or the returned-path check.
    for (const magic of [":(glob)a.txt", ":(glob)nowhere.txt", ":!a.txt"]) {
      await refused(call({ path: magic }), `pathspec magic ${magic}`, "E_PATH_GRAMMAR");
    }
    for (const [what, p] of [
      ["an absolute path", "/a.txt"], ["a backslash path", "dir\\a.txt"],
      ["a drive prefix", "C:/a.txt"], ["a dot segment", "./a.txt"], ["a dotdot segment", "d/../a.txt"],
    ]) {
      await refused(call({ path: p }), what, "E_PATH_GRAMMAR");
    }
    // Ordinary legal punctuation is permitted, and `--` protects a leading dash.
    repo.write("-lead.txt", "y\n");
    repo.write("od d,d+d.txt", "z\n");
    repo.git("add", "-A");
    repo.git("commit", "-qm", "c2");
    const t2 = repo.git("rev-parse", "HEAD^{tree}");
    for (const p of ["-lead.txt", "od d,d+d.txt"]) {
      const ok = await readExactTreeBlob({ repoRoot: repo.root, treeOid: t2, path: p });
      assert.strictEqual(ok.present, true, `${p} is an ordinary readable path`);
    }
  }, "ctide-step6-grammar-");
});

test("Q1: a symlink at the path is refused — type alone would admit it", async (t) => {
  await withRepo(async (repo) => {
    // Written with plumbing so the case does not depend on the platform's symlink support.
    repo.write("real.txt", "real\n");
    repo.git("add", "-A");
    repo.git("commit", "-qm", "c");
    const blob = cp.execFileSync("git", ["hash-object", "-w", "--stdin"], {
      cwd: repo.root, input: "real.txt", encoding: "utf8",
    }).trim();
    const treeOid = cp.execFileSync("git", ["mktree"], {
      cwd: repo.root, input: `120000 blob ${blob}\tlink.txt\n`, encoding: "utf8",
    }).trim();
    const e = await refused(
      readExactTreeBlob({ repoRoot: repo.root, treeOid, path: "link.txt" }),
      "a symlink entry", "E_TREE_ENTRY_KIND");
    assert.strictEqual(e.detail.mode, "120000");
    assert.ok(e instanceof ExactTreeBlobError);
  }, "ctide-step6-symlink-");
});

// --- 2. the exported occurrence helper (Q2) ------------------------------------------------------------

test("Q2: countOccurrences enforces what it advertises, and an empty needle TERMINATES", () => {
  const view = new Map([["a.txt", Buffer.from("aaaa", "utf8")]]);
  // Valid cases first, including the overlapping count and a legitimately empty view.
  assert.strictEqual(countOccurrences(view, Buffer.from("aa", "utf8")), 3, "overlapping matches each count");
  assert.strictEqual(countOccurrences(view, Buffer.from("zz", "utf8")), 0, "a real needle may legitimately be absent");
  assert.strictEqual(countOccurrences(new Map(), Buffer.from("aa", "utf8")), 0, "an empty view yields 0");

  // The empty needle used to hang: Buffer.indexOf returns the clamped offset, so `from` never escapes.
  // This assertion is a REGRESSION for that hang — it only completes because the guard throws.
  assert.throws(() => countOccurrences(view, Buffer.alloc(0)), RangeError, "an empty needle never returns 0");
  assert.throws(() => countOccurrences(view, "aa"), TypeError, "a string needle is not a Buffer");
  assert.throws(() => countOccurrences({ a: 1 }, Buffer.from("a")), TypeError, "the view must be a Map");
  assert.throws(() => countOccurrences(new Map([["a", "aa"]]), Buffer.from("a")), TypeError,
    "every search-view value must be a Buffer");
});

test("Q2: checkSourceOccurrence keeps its data verdict, and the byte rule is unchanged", () => {
  const needle = "the reviewed reading";
  const view = new Map([
    ["crlf.txt", canonicalSearchBytes(Buffer.from(`\ufeff${needle}\r\n`, "utf8"))],
    ["binary.bin", canonicalSearchBytes(Buffer.from([0x00, 0xff, 0xfe, 0x01]))],
  ]);
  const source = (over) => ({ sourceId: "S-1", driftMode: "repo-file", excerpt: needle, ...over });
  assert.deepStrictEqual(checkSourceOccurrence(source(), view),
    { analysable: true, applicable: true, count: 1, drifts: false, ambiguous: false },
    "BOM + CRLF canonicalise to the same bytes as the excerpt, so this is NOT drift");
  assert.strictEqual(checkSourceOccurrence(source({ driftMode: "snapshot-only" }), view).applicable, false,
    "snapshot-only never drifts");
  assert.deepStrictEqual(checkSourceOccurrence(source({ excerpt: "" }), view),
    { analysable: false, reason: "empty-canonical-excerpt" }, "the data verdict is unchanged and does not throw");
  assert.deepStrictEqual(checkSourceOccurrence(source({ excerpt: 42 }), view),
    { analysable: false, reason: "no-string-excerpt" });
});

// --- 3. authority (TP §11b.9c step 2, AC127) --------------------------------------------------------

test("AC127: a completely normal commit passes — post-commit must not import proposal-time freshness", async () => {
  await withRepo(async (repo) => {
    const world = await cleanWorld(repo);
    const verdict = await verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK });
    assert.strictEqual(verdict.converged, true);
    assert.deepStrictEqual(verdict.committedBatchRef, { kind: "provenance-batch", ref: "R-b1" },
      "the typed head ref, so a later integration can bind this verdict to the exact record");
    assert.ok(Object.isFrozen(verdict.committedBatchRef), "and it is frozen with the verdict");
    assert.strictEqual(verdict.priorStateExists, true, "B is read on EVERY success, not only for historical mode");
    assert.strictEqual(verdict.historicalVersion, 2, "and its actual declared version is reported");
    assert.strictEqual(verdict.entryCount, 1);
    assert.strictEqual(verdict.resolvedFindingCount, 0);
    assert.strictEqual(verdict.baseTreeOid, world.treeOid);
    assert.strictEqual(verdict.headViewDigest, world.digests.headViewDigest);
    assert.deepStrictEqual(verdict.sourceObservations, []);
    // The store moved from D0 to D1 in Step 5, so the current digest is NOT the inventory's input
    // digest. A build that compared them would fail every normal batch; this asserts it does not.
    assert.notStrictEqual(storeDigest(world.store),
      indexStore(world.store).records.get("R-b1").batchSnapshot.inventorySnapshot.inputProvenanceStoreDigest);
    // Recursively frozen, including the nested ref-bearing fields.
    assert.ok(Object.isFrozen(verdict) && Object.isFrozen(verdict.sourceObservations));
    assert.throws(() => { verdict.converged = false; }, TypeError);
  }, "ctide-step6-ac127-");
});

test("the request is exact, the task is required, and an unsubmitted task is not a pass", async () => {
  await withRepo(async (repo) => {
    await cleanWorld(repo);
    await refused(verifyCommittedBatch({ repoRoot: repo.root }), "a missing taskId", "E_API_ARGUMENTS");
    await refused(verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK, now: 1 }),
      "an injected clock", "E_API_ARGUMENTS");
    await refused(verifyCommittedBatch({ repoRoot: repo.root, taskId: "TASK-nope" }),
      "an unknown task", "E_STEP6_UNKNOWN_TASK");
  }, "ctide-step6-request-");
});

// Values are captured once after the own-key check, so nothing this verdict rests on can change across
// the awaited stages; and the key check sees own keys, not merely the enumerable string ones.

test("each owned request value is read exactly once, and the verdict is unaffected", async () => {
  await withRepo(async (repo) => {
    await cleanWorld(repo);
    const counts = { repoRoot: 0, taskId: 0 };
    const values = { repoRoot: repo.root, taskId: TASK };
    const req = {};
    for (const name of Object.keys(values)) {
      Object.defineProperty(req, name, {
        enumerable: true,
        configurable: true,
        get() { counts[name] += 1; return values[name]; },
      });
    }
    const verdict = await verifyCommittedBatch(req);
    assert.deepStrictEqual(counts, { repoRoot: 1, taskId: 1 });
    assert.strictEqual(verdict.converged, true, "a constant accessor is ordinary data and still converges");
  }, "ctide-step6-capture-");
});

test("hidden and symbol own keys are refused before any authority is read", async () => {
  const base = () => ({ repoRoot: "/x", taskId: TASK });

  const hidden = base();
  Object.defineProperty(hidden, "now", { value: 1, enumerable: false, configurable: true });
  assert.deepStrictEqual(Object.keys(hidden).sort(), ["repoRoot", "taskId"], "invisible to the enumerable view");
  const hiddenError = await refused(verifyCommittedBatch(hidden), "a non-enumerable clock", "E_API_ARGUMENTS");
  assert.match(hiddenError.message, /"now"/);

  const symbolled = base();
  symbolled[Symbol("now")] = 1;
  const symbolError = await refused(verifyCommittedBatch(symbolled), "a symbol own key", "E_API_ARGUMENTS");
  assert.ok(!(symbolError instanceof TypeError), "a typed refusal, not an engine error");
  assert.match(symbolError.message, /Symbol\(now\)/);
});

test("a task with no committed head is a rerun-the-loop state, never a pass", async () => {
  await withRepo(async (repo) => {
    const world = await withHistory(repo);
    repo.write(CANONICAL_STORE_PATH, canonicalStoreBytes(world.store));
    await refused(verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }),
      "a null committed head", "E_STEP6_NO_COMMITTED_BATCH");
  }, "ctide-step6-head-");
});

test("a legacy committed head refuses for LACK OF PREIMAGE, through the accepted reader's own code", async () => {
  await withRepo(async (repo) => {
    const world = await cleanWorld(repo);
    // A real v1.12 legacy record, the exact absence shape, replacing the committed head.
    const snapshot = {
      taskId: TASK, baseProvenance: world.base, inventoryDigest: "inv-legacy", results: [], resolutions: [],
    };
    const legacy = {
      recordId: "R-legacy", kind: "provenance-batch", taskId: TASK, inventoryDigest: "inv-legacy",
      batchSnapshot: snapshot, batchDigest: digestOf(snapshot), relatedRefs: [], previousBatchRef: null,
    };
    const store = JSON.parse(JSON.stringify(world.store));
    store.records = store.records.filter((r) => r.recordId !== "R-b1").concat([legacy]);
    store.taskStates.find((s) => s.taskId === TASK).committedProvenanceBatchRef = { kind: "provenance-batch", ref: "R-legacy" };
    repo.write(CANONICAL_STORE_PATH, canonicalStoreBytes(store));
    await refused(verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }),
      "a legacy head", "E_NO_INVENTORY_PREIMAGE");
  }, "ctide-step6-legacy-");
});

// --- 4. source freshness and Check B ------------------------------------------------------------------

test("S3 freshness refuses a moved world with the consumer's OWN code, leaving the facade's alone", async () => {
  await withRepo(async (repo) => {
    const world = await cleanWorld(repo);
    // Move the head view after the batch was committed.
    repo.write("new-file.txt", "moved\n");
    const e = await refused(verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }),
      "a moved head view", "E_STEP6_SOURCE_STALE");
    assert.strictEqual(e.detail.headViewDigest.declared, world.digests.headViewDigest);
    assert.strictEqual(e.detail.headViewDigest.matches, false);
    assert.strictEqual(e.detail.registryDigest.matches, true, "both comparisons are reported, not just the first");
  }, "ctide-step6-stale-");
});

test("Source Check B: zero occurrences refuse, one passes, and multiple record an observation", async () => {
  for (const [what, occurrences, expectation] of [
    ["zero", 0, "refuse"], ["one moved", 1, "pass"], ["multiple", 3, "observe"],
  ]) {
    await withRepo(async (repo) => {
      const excerpt = "the live source sentence under review";
      // The live REQ and its repo-file Source are seeded into HISTORY, so the pre-side tag resolves in
      // the verified base store. The occurrences live in an ordinary repo file and the locator
      // deliberately points elsewhere, which is why one moved occurrence must still not be drift.
      const world = await withHistory(repo, {
        files: occurrences > 0 ? { "docs/notes.md": `${`${excerpt}\n`.repeat(occurrences)}` } : {},
        extra: (s) => {
          let next = applyTransaction(s, "append-source", {
            source: {
              sourceId: "S-live", contentKind: "requirement", driftMode: "repo-file",
              locator: "somewhere/else.md#1", excerpt,
            },
          }, OPTS);
          return applyTransaction(next, "create-requirement", {
            requirement: {
              id: "REQ-0000000000000000000000000A", authority: "approved-requirement", kind: "specification",
              text: "the live rule", sourceRef: "S-live", taskRef: "TASK-0",
            },
          }, OPTS);
        },
      });
      const { base, digests, identity } = world;
      const tag = { clauseRef: "REQ-0000000000000000000000000A" };
      const entry = entryFor(identity, { tagBefore: tag, tagAfter: tag });
      const inventory = inventoryFor(digests, base, [entry]);
      commitBatch(repo, world.store, base, inventory, [resultFor({ tagBefore: tag, tagAfter: tag })]);

      if (expectation === "refuse") {
        await refused(verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }),
          "zero live occurrences", "E_STEP6_SOURCE_DRIFT");
      } else {
        const verdict = await verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK });
        assert.strictEqual(verdict.converged, true, `${what} is not drift`);
        assert.deepStrictEqual(verdict.sourceObservations,
          expectation === "observe"
            ? [{ sourceId: "S-live", kind: "ambiguous-source-occurrence", occurrenceCount: occurrences }]
            : [],
          `${what}: the ambiguity observation is deterministic and deduplicated`);
      }
    }, `ctide-step6-checkb-${occurrences}-`);
  }
});

// --- 5. coverage, binding and identity ------------------------------------------------------------------

test("coverage is exact, and the entry states the CURRENT registry's identity", async () => {
  await withRepo(async (repo) => {
    const world = await cleanWorld(repo);
    assert.ok(await verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }), "positive control first");

    const mutate = (fn) => {
      const store = JSON.parse(JSON.stringify(world.store));
      const batch = store.records.find((r) => r.recordId === "R-b1");
      fn(batch.batchSnapshot);
      batch.batchDigest = digestOf(batch.batchSnapshot);
      repo.write(CANONICAL_STORE_PATH, canonicalStoreBytes(store));
    };
    mutate((snap) => { snap.results = []; });
    await refused(verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }),
      "an entry with no result", "E_STEP6_COVERAGE");
    mutate((snap) => { snap.results = [resultFor(), resultFor()]; });
    await refused(verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }),
      "two results for one entry", "E_STEP6_COVERAGE");
    mutate((snap) => { snap.results = [resultFor({ observedHeadBodyDigest: "9".repeat(64) })]; });
    await refused(verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }),
      "an observation the inventory does not carry", "E_STEP6_RESULT_BINDING");
    mutate((snap) => {
      snap.inventorySnapshot.entries[0].implementationIdentity = { ...world.identity, parserVersion: "999" };
      snap.inventorySnapshot.inventoryDigest = computeInventoryV2Digest(snap.inventorySnapshot);
      snap.inventoryDigest = snap.inventorySnapshot.inventoryDigest;
    });
    const store = JSON.parse(JSON.stringify(world.store));
    const batch = store.records.find((r) => r.recordId === "R-b1");
    batch.batchSnapshot.inventorySnapshot.entries[0].implementationIdentity = {
      ...world.identity, parserVersion: "999",
    };
    batch.batchSnapshot.inventorySnapshot.inventoryDigest =
      computeInventoryV2Digest(batch.batchSnapshot.inventorySnapshot);
    batch.batchSnapshot.inventoryDigest = batch.batchSnapshot.inventorySnapshot.inventoryDigest;
    batch.inventoryDigest = batch.batchSnapshot.inventoryDigest;
    batch.batchDigest = digestOf(batch.batchSnapshot);
    repo.write(CANONICAL_STORE_PATH, canonicalStoreBytes(store));
    await refused(verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }),
      "a per-entry identity the registry does not bind", "E_STEP6_ENTRY_IDENTITY");
  }, "ctide-step6-coverage-");
});

test("an unresolved general finding fails convergence rather than persisting as clean", async () => {
  await withRepo(async (repo) => {
    const world = await cleanWorld(repo, {}, {
      findings: [{ kind: "wrong-tag", evidence: "the tag is wrong", binding: { clauseRef: ASSUM_A } }],
    });
    assert.ok(world.store, "the writer legitimately PERSISTS a nonconverged finding");
    await refused(verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }),
      "an unresolved wrong-tag finding", "E_STEP6_UNRESOLVED_FINDING");
  }, "ctide-step6-finding-");
});

// --- 6. scratch independence and no mutation on refusal --------------------------------------------------

test("the verdict is identical with scratch present, misleading or deleted, and refusals write nothing", async () => {
  await withRepo(async (repo) => {
    await cleanWorld(repo);
    const storeFile = path.join(repo.root, CANONICAL_STORE_PATH);
    const before = fs.readFileSync(storeFile, "utf8");
    const scratch = path.join(repo.root, ".ctide", "output", "changed-test-inventory.json");

    const base = await verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK });
    fs.mkdirSync(path.dirname(scratch), { recursive: true });
    fs.writeFileSync(scratch, JSON.stringify({ inventoryVersion: 2, entries: [{ nonsense: true }] }), "utf8");
    const misleading = await verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK });
    fs.rmSync(path.dirname(scratch), { recursive: true, force: true });
    const deleted = await verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK });
    assert.deepStrictEqual(canonicalJson(misleading), canonicalJson(base), "misleading scratch changes nothing");
    assert.deepStrictEqual(canonicalJson(deleted), canonicalJson(base), "deleted scratch changes nothing");

    // Every refusal leaves the store byte-identical and drops no lock or temp file.
    repo.write("moved.txt", "x\n");
    await refused(verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }), "a stale world", "E_STEP6_SOURCE_STALE");
    assert.strictEqual(fs.readFileSync(storeFile, "utf8"), before, "store bytes unchanged");
    assert.ok(!fs.existsSync(`${storeFile}.lock`), "no lock left behind");
    assert.deepStrictEqual(
      fs.readdirSync(path.join(repo.root, ".ctide")).filter((f) => f.endsWith(".tmp")), [],
      "no temp residue");
  }, "ctide-step6-scratch-");
});

// --- 7. resolution mode, acknowledgement coverage and outcome ---------------------------------------

const evidenceRecord = (recordId, over = {}) => ({
  recordId, kind: "review-ruling", by: TEST_DISCIPLINE, subjectRef: ASSUM_A, ruling: "ok",
  taskId: TASK,
  testRef: { path: TEST_PATH, adapterId: ADAPTER_ID, structuralId: STRUCTURAL },
  baseBodyDigest: "1".repeat(64),
  headBodyDigest: "2".repeat(64),
  findingKind: "assum-reading-change",
  binding: { clauseRef: ASSUM_A },
  ...over,
});

const successorDraft = {
  id: ASSUM_B, layer: "implementation", derivedFrom: "DP-1", text: "revised reading",
  alternative: "treat null as invalid", basis: "new evidence", basisRefs: [],
  governedBy: CODE, routingOrigin: "safe-default",
};

// A world whose batch resolves an assum-reading-change: the writer mints the successor, the revise
// Transition, the DP repoint and the batch record in ONE transaction, and the group's witness covers
// the evidence the finding claims.
async function resolvedWorld(repo, { evidence = [evidenceRecord("R-ev")], claimed = "R-ev", groupRefs } = {}) {
  const world = await withHistory(repo);
  const { base, digests, identity, store, treeOid } = world;

  const refs = groupRefs || evidence.map((e) => ({ kind: "review-ruling", ref: e.recordId }));
  const groupDigest = resolutionGroupDigest({
    subjectRef: ASSUM_A, action: "revise", successor: ASSUM_B, semanticEvidenceRefs: refs,
  });
  const entry = entryFor(identity, { tagAfter: { clauseRef: ASSUM_B } });
  const inventory = inventoryFor(digests, base, [entry]);
  const result = resultFor({
    tagAfter: { clauseRef: ASSUM_B },
    findings: [{
      kind: "assum-reading-change", evidence: "the ASSUM reading moved", binding: { clauseRef: ASSUM_A },
      resolutionRef: {
        mode: "this-round", transitionRef: "T-b",
        semanticEvidenceRef: { kind: "review-ruling", ref: claimed },
      },
    }],
  });
  const next = commitBatch(repo, store, base, inventory, [result], {
    recordsToCreate: [
      ...evidence,
      { recordId: "R-w", kind: "review-ruling", by: CODE, subjectRef: ASSUM_A, ruling: "ok", resolutionGroupDigest: groupDigest },
    ],
    resolutions: [{
      subjectRef: ASSUM_A,
      semanticEvidenceRefs: refs,
      governanceWitnessRef: { kind: "review-ruling", ref: "R-w" },
      transitionDraft: {
        id: "T-b", subject: ASSUM_A, action: "revise", successor: ASSUM_B,
        authorityRef: CODE, ackRef: { kind: "review-ruling", ref: "R-w" },
      },
      successorClauseDraft: successorDraft,
    }],
    resolutionCarrierUpdates: [{ dpId: "DP-1", action: "unchanged-null" }],
  });
  return { base, digests, identity, store: next, treeOid };
}

// Re-seal a mutated store so the case under test is reached rather than a digest fault.
function reseal(repo, store, mutate) {
  const next = JSON.parse(JSON.stringify(store));
  const batch = next.records.find((r) => r.recordId === "R-b1");
  mutate(next, batch);
  batch.batchDigest = digestOf(batch.batchSnapshot);
  repo.write(CANONICAL_STORE_PATH, canonicalStoreBytes(next));
  return next;
}

test("a real ASSUM successor lands atomically and its this-round claim is proved end to end", async () => {
  await withRepo(async (repo) => {
    const world = await resolvedWorld(repo);
    const index = indexStore(world.store);
    assert.ok(index.clauses.get(ASSUM_B), "the successor was minted in the same transaction");
    assert.strictEqual(index.dps.get("DP-1").assumedAs, ASSUM_B, "and the DP was repointed");
    const verdict = await verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK });
    assert.strictEqual(verdict.converged, true);
    assert.strictEqual(verdict.resolvedFindingCount, 1);
    assert.strictEqual(verdict.priorStateExists, true, "the base witness is verified even for a this-round proof");
  }, "ctide-step6-resolve-");
});

test("this-round evidence may not be borrowed on task, test, body, binding, kind or discipline", async () => {
  await withRepo(async (repo) => {
    const world = await resolvedWorld(repo);
    assert.ok(await verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }), "positive control first");

    // One field moved per case, off that passing control. Each stays a legal store, so the refusal is
    // the anti-borrowing rule and not an incidental shape fault.
    for (const [what, over] of [
      ["another task", { taskId: "TASK-other" }],
      ["another test", { testRef: { path: "test/beta.test.mjs", adapterId: ADAPTER_ID, structuralId: STRUCTURAL } }],
      ["another base body", { baseBodyDigest: "9".repeat(64) }],
      ["another head body", { headBodyDigest: "9".repeat(64) }],
      ["another binding", { binding: { clauseRef: ASSUM_B } }],
      ["another finding kind", { findingKind: "wrong-tag" }],
      ["the code discipline", { by: CODE }],
      ["the successor as its subject", { subjectRef: ASSUM_B }],
    ]) {
      reseal(repo, world.store, (next) => {
        const i = next.records.findIndex((r) => r.recordId === "R-ev");
        next.records[i] = evidenceRecord("R-ev", over);
      });
      await refused(verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }),
        `evidence from ${what}`, "E_STEP6_EVIDENCE_BINDING");
    }
    // A carrier of the wrong record kind is not semantic evidence at all.
    reseal(repo, world.store, (next) => {
      const i = next.records.findIndex((r) => r.recordId === "R-ev");
      next.records[i] = { recordId: "R-ev", kind: "source-authority", authorityIdentity: "EU DPA" };
    });
    await refused(verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }),
      "a source-authority carrier", "E_STEP6_EVIDENCE_UNRESOLVABLE");
  }, "ctide-step6-borrow-");
});

test("the finding binding is anchored to the ACTUAL pre-side tag, qualifier included", async () => {
  await withRepo(async (repo) => {
    const world = await resolvedWorld(repo);
    for (const [what, binding, code] of [
      ["an unrelated ASSUM", { clauseRef: ASSUM_B }, "E_STEP6_FINDING_ASSOCIATION"],
      ["an invented DP qualifier", { clauseRef: ASSUM_A, dpRef: "DP-1" }, "E_STEP6_FINDING_ASSOCIATION"],
    ]) {
      reseal(repo, world.store, (next, batch) => {
        batch.batchSnapshot.results[0].findings[0].binding = binding;
      });
      await refused(verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }), what, code);
    }
  }, "ctide-step6-anchor-");
});

test("acknowledgement coverage: equivalent and permuted groups agree, a conflicting one fails closed", async () => {
  await withRepo(async (repo) => {
    const world = await resolvedWorld(repo, {
      evidence: [evidenceRecord("R-ev"), evidenceRecord("R-ev2")],
    });
    assert.ok(await verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }), "a two-member group passes");

    const groupOf = (batch) => batch.batchSnapshot.resolutions[0];
    // A canonical-equivalent duplicate reference carries ONE meaning.
    reseal(repo, world.store, (next, batch) => {
      batch.batchSnapshot.resolutions.push(JSON.parse(JSON.stringify(groupOf(batch))));
    });
    assert.ok(await verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }),
      "an identical duplicate group is not a conflict");
    // A permutation of the evidence array normalises through the formula's own sorted representation.
    reseal(repo, world.store, (next, batch) => {
      const copy = JSON.parse(JSON.stringify(groupOf(batch)));
      copy.semanticEvidenceRefs = [...copy.semanticEvidenceRefs].reverse();
      batch.batchSnapshot.resolutions.push(copy);
    });
    assert.ok(await verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }),
      "a permuted duplicate group is not a conflict either");
    // A conflicting subject is refused, and may not fall back to the singleton proof.
    reseal(repo, world.store, (next, batch) => {
      const copy = JSON.parse(JSON.stringify(groupOf(batch)));
      copy.subjectRef = ASSUM_B;
      batch.batchSnapshot.resolutions.push(copy);
    });
    await refused(verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }),
      "two groups naming one transition that disagree", "E_STEP6_GROUP_CONFLICT");
    // A repeated member is malformed group input, refused BEFORE normalisation would delete it.
    reseal(repo, world.store, (next, batch) => {
      groupOf(batch).semanticEvidenceRefs.push({ kind: "review-ruling", ref: "R-ev" });
    });
    await refused(verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }),
      "a repeated evidence ref", "E_STEP6_GROUP_MALFORMED");
  }, "ctide-step6-groups-");
});

test("a new evidence record cannot borrow an acknowledgement that never covered it", async () => {
  await withRepo(async (repo) => {
    // The writer refuses this at mint time -- W5 requires a claim against a transition IT mints to lie
    // inside that group's verified coverage -- so the store is built valid and then edited. That is
    // the premise of the whole component: Step 6 may not assume a writer produced what it reads.
    const world = await resolvedWorld(repo);
    assert.ok(await verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }), "positive control first");

    // R-ev2 is a perfectly valid carrier -- same task, test, bodies, kind and binding -- but the
    // witness's digest was taken over {R-ev}. Fresh correctness does not make an old ack cover it.
    reseal(repo, world.store, (next, batch) => {
      next.records.push(evidenceRecord("R-ev2"));
      batch.batchSnapshot.results[0].findings[0].resolutionRef.semanticEvidenceRef = {
        kind: "review-ruling", ref: "R-ev2",
      };
    });
    await refused(verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }),
      "a claim outside the acknowledged set", "E_STEP6_ACK_COVERAGE");
  }, "ctide-step6-newE-");
});

test("with zero candidate groups in the task chain, a singleton preimage is named and checked", async () => {
  await withRepo(async (repo) => {
    const world = await resolvedWorld(repo);
    // Remove the persisted group, leaving the transition and its actual ack in place. The chain then
    // holds ZERO candidates naming T-b -- which is not "no group anywhere" -- so the claim must be
    // proved against a recomputed single-member preimage.
    const singleton = reseal(repo, world.store, (next, batch) => {
      batch.batchSnapshot.resolutions = [];
    });
    assert.ok(await verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }),
      "the ack really does cover exactly the claimed evidence, so the singleton proof succeeds");

    // An acknowledgement taken over a LARGER set cannot be satisfied by guessing: the formula hashes
    // the whole sorted set, so a one-member preimage cannot reproduce a two-member digest.
    const larger = resolutionGroupDigest({
      subjectRef: ASSUM_A,
      action: "revise",
      successor: ASSUM_B,
      semanticEvidenceRefs: [
        { kind: "review-ruling", ref: "R-ev" }, { kind: "review-ruling", ref: "R-unknown" },
      ],
    });
    reseal(repo, singleton, (next) => {
      next.records.find((r) => r.recordId === "R-w").resolutionGroupDigest = larger;
    });
    await refused(verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }),
      "an ack over an unknown larger set", "E_STEP6_ACK_COVERAGE");
  }, "ctide-step6-singleton-");
});

test("historical-convergence needs T and every USED chain link in the verified base store", async () => {
  await withRepo(async (repo) => {
    // Round one, in its own task, mints T-b and ASSUM_B and is committed to Git. That tree becomes a
    // SECOND task's immutable base, so T-b is genuinely historical for it.
    const first = await resolvedWorld(repo);
    repo.git("add", "-A");
    repo.git("commit", "-qm", "round one");
    const baseTreeOid = repo.git("rev-parse", "HEAD^{tree}");
    const committed = fs.readFileSync(path.join(repo.root, CANONICAL_STORE_PATH));
    const base2 = {
      treeOid: baseTreeOid, storePath: CANONICAL_STORE_PATH, storeDigest: rawDigest(committed),
    };

    // The second task starts from that tree and reviews the same test, now bound to ASSUM_B.
    const store2 = applyTransaction(first.store, "init-task", {
      taskId: "TASK-2", baseProvenance: base2, decisionPoints: [], currentTaskDpIds: [],
    }, OPTS);
    const digests = await currentSourceDigests(repo.root);
    const identity = adapterIdentity(digests.registryRoot, ADAPTER_ID);
    const entry = entryFor(identity, { tagAfter: { clauseRef: ASSUM_B } });
    const inventory = inventoryFor(digests, base2, [entry]);
    const result = resultFor({
      tagAfter: { clauseRef: ASSUM_B },
      findings: [{
        kind: "assum-reading-change", evidence: "converged in an earlier round",
        binding: { clauseRef: ASSUM_A },
        resolutionRef: { mode: "historical-convergence", transitionRef: "T-b" },
      }],
    });
    const payload = {
      taskId: "TASK-2", batchRecordId: "R-b2",
      expectedInputProvenanceStoreDigest: storeDigest(store2),
      batchSnapshot: {
        taskId: "TASK-2", baseProvenance: base2,
        inventoryDigest: inventory.inventoryDigest,
        inventorySnapshot: { ...inventory, inputProvenanceStoreDigest: storeDigest(store2) },
        results: [result], resolutions: [],
      },
      resolutions: [],
    };
    const snap = payload.batchSnapshot.inventorySnapshot;
    snap.inventoryDigest = computeInventoryV2Digest(snap);
    payload.batchSnapshot.inventoryDigest = snap.inventoryDigest;
    const store3 = applyTransaction(store2, "commit-test-provenance-batch", payload, OPTS);
    repo.write(CANONICAL_STORE_PATH, canonicalStoreBytes(store3));

    const verdict = await verifyCommittedBatch({ repoRoot: repo.root, taskId: "TASK-2" });
    assert.strictEqual(verdict.converged, true, "a whole chain in B converges");
    assert.strictEqual(verdict.priorStateExists, true, "the base store was really read");
    assert.strictEqual(verdict.historicalVersion, 2);

    // PARTIAL: the same claim against a base tree captured BEFORE the successor existed. T-b is not in
    // that store, so the historical proof has nothing to stand on.
    const earlyTree = first.base.treeOid;
    const earlyBase = {
      treeOid: earlyTree, storePath: CANONICAL_STORE_PATH, storeDigest: first.base.storeDigest,
    };
    const partial = JSON.parse(JSON.stringify(store3));
    partial.taskStates.find((t) => t.taskId === "TASK-2").baseProvenance = earlyBase;
    const b2 = partial.records.find((r) => r.recordId === "R-b2");
    b2.batchSnapshot.baseProvenance = earlyBase;
    b2.batchSnapshot.inventorySnapshot.baseTreeOid = earlyTree;
    b2.batchSnapshot.inventorySnapshot.inventoryDigest =
      computeInventoryV2Digest(b2.batchSnapshot.inventorySnapshot);
    b2.batchSnapshot.inventoryDigest = b2.batchSnapshot.inventorySnapshot.inventoryDigest;
    b2.inventoryDigest = b2.batchSnapshot.inventoryDigest;
    b2.batchDigest = digestOf(b2.batchSnapshot);
    repo.write(CANONICAL_STORE_PATH, canonicalStoreBytes(partial));
    await refused(verifyCommittedBatch({ repoRoot: repo.root, taskId: "TASK-2" }),
      "a transition absent from the verified base", "E_STEP6_HISTORICAL_CHAIN");
  }, "ctide-step6-historical-");
});

// --- 8. base boundaries, §7 scope, ObservationalRefs, group shape and historical clocks ---------------

test("the base witness is verified on EVERY success, and each bad witness refuses on its own", async () => {
  await withRepo(async (repo) => {
    const world = await cleanWorld(repo);
    assert.ok(await verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }), "positive control first");

    // Each case moves ONE thing about the witness. None of them involves a resolution claim, so all of
    // them would have passed while B was read only for historical-convergence.
    const witness = (over) => {
      const next = JSON.parse(JSON.stringify(world.store));
      const ts = next.taskStates.find((t) => t.taskId === TASK);
      ts.baseProvenance = { ...ts.baseProvenance, ...over };
      const batch = next.records.find((r) => r.recordId === "R-b1");
      batch.batchSnapshot.baseProvenance = ts.baseProvenance;
      if (over.treeOid) {
        batch.batchSnapshot.inventorySnapshot.baseTreeOid = over.treeOid;
        batch.batchSnapshot.inventorySnapshot.inventoryDigest =
          computeInventoryV2Digest(batch.batchSnapshot.inventorySnapshot);
        batch.batchSnapshot.inventoryDigest = batch.batchSnapshot.inventorySnapshot.inventoryDigest;
        batch.inventoryDigest = batch.batchSnapshot.inventoryDigest;
      }
      batch.batchDigest = digestOf(batch.batchSnapshot);
      repo.write(CANONICAL_STORE_PATH, canonicalStoreBytes(next));
    };

    witness({ storeDigest: storeDigest(emptyStore()) });
    await refused(verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }),
      "a present B claimed to be the canonical empty store", "E_STEP6_BASE_STORE");

    // The CANONICALISING notation standing in for the raw one. shared §9 verifies a historical witness
    // against the file's ORIGINAL bytes, so this must refuse rather than quietly agree.
    const committed = fs.readFileSync(path.join(repo.root, CANONICAL_STORE_PATH));
    witness({ storeDigest: storeDigest(JSON.parse(committed.toString("utf8"))) });
    await refused(verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }),
      "a canonicalised digest standing in for the raw one", "E_STEP6_BASE_STORE");

    witness({ treeOid: "0".repeat(40) });
    await refused(verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }), "a nonexistent tree", "E_TREE_OID");
    witness({ treeOid: repo.git("rev-parse", "HEAD") });
    const typed = await refused(verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }),
      "a commit oid as the witness", "E_TREE_OID");
    assert.strictEqual(typed.detail.type, "commit", "the object's OWN type is what is checked");
  }, "ctide-step6-witness-");
});

test("an absent base store is the canonical empty store, and its metadata says so", async () => {
  await withRepo(async (repo) => {
    // No history at all: the base tree holds no store. Absence is legal and is exactly one digest.
    repo.write(TEST_PATH, 'import { test } from "node:test";\ntest("alpha", () => {});\n');
    repo.write(".ctide/keep", "x\n");
    repo.git("add", "-A");
    repo.git("commit", "-qm", "no store");
    const treeOid = repo.git("rev-parse", "HEAD^{tree}");
    const base = { treeOid, storePath: CANONICAL_STORE_PATH, storeDigest: storeDigest(emptyStore()) };
    const digests = await currentSourceDigests(repo.root);
    const identity = adapterIdentity(digests.registryRoot, ADAPTER_ID);
    const store = applyTransaction(emptyStore(), "init-task", {
      taskId: TASK, baseProvenance: base, decisionPoints: [], currentTaskDpIds: [],
    }, OPTS);
    // `added`: no pre-side binding at all, so nothing has to resolve in an empty B.
    const added = {
      framework: "node-test", headBodyDigest: "2".repeat(64), implementationIdentity: identity,
      reason: "content-change", status: "added", tagAfter: { expl: true }, tagBefore: null,
      testRef: { adapterId: ADAPTER_ID, path: TEST_PATH, structuralId: STRUCTURAL },
    };
    const inventory = inventoryFor(digests, base, [added]);
    commitBatch(repo, store, base, inventory, [{
      testRef: { path: TEST_PATH, adapterId: ADAPTER_ID, structuralId: STRUCTURAL },
      tagBefore: null, tagAfter: { expl: true }, observedHeadBodyDigest: "2".repeat(64), findings: [],
    }]);
    const verdict = await verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK });
    assert.strictEqual(verdict.priorStateExists, false, "absence is reported as absence");
    assert.strictEqual(verdict.historicalVersion, null, "and no version is synthesized for it");

    // The one legal absence digest. Any other value means the witness describes a different store.
    const next = JSON.parse(JSON.stringify(verdictStore(repo)));
    const ts = next.taskStates.find((t) => t.taskId === TASK);
    ts.baseProvenance = { ...ts.baseProvenance, storeDigest: "7".repeat(64) };
    const batch = next.records.find((r) => r.recordId === "R-b1");
    batch.batchSnapshot.baseProvenance = ts.baseProvenance;
    batch.batchDigest = digestOf(batch.batchSnapshot);
    repo.write(CANONICAL_STORE_PATH, canonicalStoreBytes(next));
    await refused(verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }),
      "absent B with a witness that is not the canonical empty digest", "E_STEP6_BASE_STORE");
  }, "ctide-step6-absent-");
});

const verdictStore = (repo) => JSON.parse(fs.readFileSync(path.join(repo.root, CANONICAL_STORE_PATH), "utf8"));

test("a v1 base store is read through the single clock-free dispatcher and reports version 1", async () => {
  await withRepo(async (repo) => {
    repo.write(TEST_PATH, 'import { test } from "node:test";\ntest("alpha", () => {});\n');
    // A genuine v1 store in the base tree. validateHistoricalStore dispatches it to
    // validateHistoricalLegacyV1 itself; the consumer keeps no second version branch.
    const legacy = {
      provenanceVersion: 1, sources: [], clauses: [], transitions: [], records: [],
      decisionPoints: [], taskStates: [],
    };
    repo.write(CANONICAL_STORE_PATH, `${JSON.stringify(legacy, null, 2)}\n`);
    repo.git("add", "-A");
    repo.git("commit", "-qm", "v1 history");
    const treeOid = repo.git("rev-parse", "HEAD^{tree}");
    const committed = fs.readFileSync(path.join(repo.root, CANONICAL_STORE_PATH));
    const base = { treeOid, storePath: CANONICAL_STORE_PATH, storeDigest: rawDigest(committed) };
    const digests = await currentSourceDigests(repo.root);
    const identity = adapterIdentity(digests.registryRoot, ADAPTER_ID);
    const store = applyTransaction(emptyStore(), "init-task", {
      taskId: TASK, baseProvenance: base, decisionPoints: [], currentTaskDpIds: [],
    }, OPTS);
    const added = {
      framework: "node-test", headBodyDigest: "2".repeat(64), implementationIdentity: identity,
      reason: "content-change", status: "added", tagAfter: { expl: true }, tagBefore: null,
      testRef: { adapterId: ADAPTER_ID, path: TEST_PATH, structuralId: STRUCTURAL },
    };
    const inventory = inventoryFor(digests, base, [added]);
    commitBatch(repo, store, base, inventory, [{
      testRef: { path: TEST_PATH, adapterId: ADAPTER_ID, structuralId: STRUCTURAL },
      tagBefore: null, tagAfter: { expl: true }, observedHeadBodyDigest: "2".repeat(64), findings: [],
    }]);
    const verdict = await verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK });
    assert.strictEqual(verdict.historicalVersion, 1, "B's own declared version, not the current one");
    assert.strictEqual(verdict.priorStateExists, true);
  }, "ctide-step6-v1-");
});

// An exception-backed REQ in history, so §7's five conditions are reachable with real transactions.
const packetFor = (dpId) => ({
  dpId, scenario: "null vs absent", alternatives: ["A", "B"], layer: "implementation",
  classificationBasis: "engineering standard", materialReasons: [],
  requestedPrincipal: { kind: "discipline", discipline: "intent" }, basisRefs: [],
});
const DP_HC = "DP-01J0000000000000000000000B";
// The inventory requires DP- plus a CANONICAL ULID for a qualifier, which is stricter than the store's
// own DP id space; a REQ@DP tag is only expressible when the DP carries a canonical id.
const DP_EXC = "DP-01J0000000000000000000000A";
const REQ_HC = "REQ-000000000000000000000000HC";
const REQ_EXC = "REQ-00000000000000000000000EXC";

function withException(s, { expiry = "2099-01-01" } = {}) {
  let next = applyTransaction(s, "append-record", {
    record: { recordId: "R-owner", kind: "source-authority", authorityIdentity: "EU DPA" },
  }, OPTS);
  next = applyTransaction(next, "append-source", {
    source: {
      sourceId: "S-hc", contentKind: "policy", driftMode: "snapshot-only", locator: "policy#1",
      excerpt: "PII must not leave the EU",
    },
  }, OPTS);
  // A hard-constraint REQ is minted as a DP TERMINAL; create-requirement mints approved-requirement
  // only. Two fresh DPs: one carries the constraint, the other the exception that scopes it.
  const dp = (id) => ({
    id, dimension: "data", scenario: "null vs absent", alternatives: ["A", "B"],
    layer: "implementation", classificationBasis: "engineering standard", materialReasons: [],
    status: "open",
  });
  next = applyTransaction(next, "resume-task", {
    taskId: "TASK-0", decisionPoints: [dp(DP_HC), dp(DP_EXC)], addDpIds: [DP_HC, DP_EXC],
  }, OPTS);
  next = applyTransaction(next, "create-initial-outcome", {
    dpId: DP_HC,
    clause: {
      id: REQ_HC, authority: "hard-constraint", kind: "specification", text: "PII stays in the EU",
      sourceRef: "S-hc", ownerRef: { kind: "source-authority", ref: "R-owner" },
    },
  }, OPTS);
  const packet = packetFor(DP_EXC);
  return applyTransaction(next, "resolve-exception", {
    dpId: DP_EXC,
    source: {
      sourceId: "S-exc", contentKind: "exception-grant", driftMode: "snapshot-only", locator: "g#1",
      excerpt: "grant", targetConstraintRef: REQ_HC,
      grantAuthorityRef: { kind: "source-authority", ref: "R-owner" }, scope: "eu", expiry,
    },
    scopeRuling: {
      recordId: "R-scope", kind: "review-ruling", by: { kind: "discipline", discipline: "intent" },
      subjectRef: DP_EXC, ruling: "ok", rulingKind: "scope-coverage", scopeCovers: true,
      basis: "stated basis", inputPacketSnapshot: packet, inputPacketDigest: digestOf(packet),
    },
    requirement: {
      id: REQ_EXC, authority: "approved-requirement", kind: "specification", text: "scoped",
      sourceRef: "S-exc", taskRef: "TASK-0",
    },
  }, OPTS);
}

test("§7: the qualified form uses the STATED DP, and the bare form needs exactly one", async () => {
  await withRepo(async (repo) => {
    const world = await withHistory(repo, { extra: withException, taskDps: ["DP-1", DP_EXC] });
    const { base, digests, identity } = world;
    const commit = (tag) => {
      const entry = entryFor(identity, { tagBefore: tag, tagAfter: tag });
      const inventory = inventoryFor(digests, base, [entry]);
      commitBatch(repo, world.store, base, inventory, [resultFor({ tagBefore: tag, tagAfter: tag })]);
    };

    // Positives: the qualified form naming its own DP, and the bare form with exactly one match.
    commit({ clauseRef: REQ_EXC, dpRef: DP_EXC });
    assert.ok(await verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }), "the qualified form");
    commit({ clauseRef: REQ_EXC });
    assert.ok(await verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }), "the bare form, one match");

    // A DP outside this task's membership cannot supply the scope, even though it exists and resolves.
    const outside = JSON.parse(JSON.stringify(verdictStore(repo)));
    outside.taskStates.find((t) => t.taskId === TASK).currentTaskDpIds = ["DP-1"];
    repo.write(CANONICAL_STORE_PATH, canonicalStoreBytes(outside));
    await refused(verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }),
      "a bare form with zero in-membership matches", "E_STEP6_DP_SCOPE");

    // A canonical DP that exists and is resolved -- but by a DIFFERENT clause.
    commit({ clauseRef: REQ_EXC, dpRef: DP_HC });
    await refused(verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }),
      "a qualifier naming a DP that did not resolve this clause", "E_STEP6_DP_SCOPE");

    // A qualifier on a plain, non-exception-backed REQ asserts a scope promise that does not exist.
    // It has to be a REQ: the canonical reader already refuses ASSUM@DP and DEC@DP lexically, and
    // accepts REQ@DP without deciding whether that REQ is exception-backed -- which is the gap this
    // consumer check closes. REQ_HC is a hard-constraint REQ whose Source is a policy, not a grant.
    commit({ clauseRef: REQ_HC, dpRef: DP_EXC });
    await refused(verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }),
      "a qualifier on a clause that is not exception-backed", "E_STEP6_DP_QUALIFIER");
  }, "ctide-step6-dp-");
});

test("historical validation is clock-free: an EXPIRED terminal grant in B still reads, non-temporal faults do not", async () => {
  await withRepo(async (repo) => {
    // B holds a DP whose TERMINAL is an exception-backed REQ whose grant has since expired. It must
    // still read: validateHistoricalStore is clock-free, so INV-4's active∧applicable test is not
    // evaluated against today's instant. Note that such a store could NOT be the current one -- the
    // current validator would refuse it -- which is exactly why the base tree is a separate world.
    const build = (mutate) => {
      repo.write(TEST_PATH, 'import { test } from "node:test";\ntest("alpha", () => {});\n');
      repo.write(".ctide/keep", "x\n");
      repo.git("add", "-A");
      repo.git("commit", "-qm", "seed");
      const seedTree = repo.git("rev-parse", "HEAD^{tree}");
      // Minted VALID -- resolve-exception refuses an already-expired grant -- then given the past
      // expiry the historical record really carries by the time this task runs.
      const hist = withException(priorStore(seedTree));
      hist.sources.find((s) => s.sourceId === "S-exc").expiry = "2020-01-01";
      mutate(hist);
      repo.write(CANONICAL_STORE_PATH, canonicalStoreBytes(hist));
      repo.git("add", "-A");
      repo.git("commit", "-qm", "history");
      const treeOid = repo.git("rev-parse", "HEAD^{tree}");
      const committed = fs.readFileSync(path.join(repo.root, CANONICAL_STORE_PATH));
      return { treeOid, storePath: CANONICAL_STORE_PATH, storeDigest: rawDigest(committed) };
    };
    const run = async (base) => {
      const digests = await currentSourceDigests(repo.root);
      const identity = adapterIdentity(digests.registryRoot, ADAPTER_ID);
      const store = applyTransaction(emptyStore(), "init-task", {
        taskId: TASK, baseProvenance: base, decisionPoints: [], currentTaskDpIds: [],
      }, OPTS);
      // The PRE side is the expired-grant REQ, qualified by its DP. Pre-side charges resolvability
      // and Check A only; the post side is an EXPL cleanup, so no current activity is asserted for it.
      const tag = { clauseRef: REQ_EXC, dpRef: DP_EXC };
      const entry = entryFor(identity, { tagBefore: tag, tagAfter: { expl: true } });
      const inventory = inventoryFor(digests, base, [entry]);
      commitBatch(repo, store, base, inventory, [resultFor({ tagBefore: tag, tagAfter: { expl: true } })]);
      return verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK });
    };

    const verdict = await run(build(() => {}));
    assert.strictEqual(verdict.priorStateExists, true,
      "an expired grant does not retroactively invalidate history");
    assert.strictEqual(verdict.historicalVersion, 2);

    // NON-TEMPORAL failures are retained. Corrupting the historical Source's stored excerpt breaks
    // Check A, which is not a clock question, so the same world must now refuse. The refusal may come
    // from the historical validator or from pre-side Check A; both are non-temporal rules holding.
    await refused(
      run(build((hist) => { hist.sources.find((s) => s.sourceId === "S-exc").excerpt = "tampered"; })),
      "a non-temporal fault in the historical store");
  }, "ctide-step6-clock-");
});

test("a plain textual ObservationalRef beside a real Source is not resolved as a Source", async () => {
  await withRepo(async (repo) => {
    // IS §4: a Source basis is a PLAIN "S-…" string. A free-form string is an ObservationalRef and is
    // disclosure-only. Following every basis string refused this legitimate clause.
    const world = await withHistory(repo, {
      extra: (s) => applyTransaction(applyTransaction(s, "resume-task", {
        taskId: "TASK-0",
        decisionPoints: [{
          id: "DP-3", dimension: "data", scenario: "observed constraint", alternatives: ["A", "B"],
          layer: "implementation", classificationBasis: "engineering standard", materialReasons: [],
          status: "open",
        }],
        addDpIds: ["DP-3"],
      }, OPTS), "create-initial-outcome", {
        dpId: "DP-3",
        clause: {
          id: ASSUM_B, layer: "implementation", derivedFrom: "DP-3", text: "observed",
          alternative: "u", basis: "b", basisRefs: ["S-req", "An observed implementation constraint."],
          governedBy: CODE, routingOrigin: "safe-default",
        },
      }, OPTS),
    });
    const tag = { clauseRef: ASSUM_B };
    const entry = entryFor(world.identity, { tagBefore: tag, tagAfter: tag });
    const inventory = inventoryFor(world.digests, world.base, [entry]);
    commitBatch(repo, world.store, world.base, inventory, [resultFor({ tagBefore: tag, tagAfter: tag })]);
    assert.ok(await verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }),
      "the ObservationalRef is not followed, and the real Source still is");
  }, "ctide-step6-observational-");
});

test("group and typed-ref shapes are exact BEFORE normalisation, at every declared location", async () => {
  await withRepo(async (repo) => {
    const world = await resolvedWorld(repo);
    assert.ok(await verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }), "positive control first");

    // Each of these would have normalised into a valid shape and been accepted, because the group's
    // equivalence key is an explicitly CONSTRUCTED four-field object and sortTypedRefs / refKey
    // rebuild each ref as { kind, ref }. Those projections discard the extra member; canonicalJson
    // itself retains ordinary defined keys, so the shape has to be charged before they run.
    reseal(repo, world.store, (next, batch) => { batch.batchSnapshot.resolutions[0].note = "extra"; });
    await refused(verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }),
      "an undeclared field on a candidate group", "E_STEP6_GROUP_MALFORMED");
    reseal(repo, world.store, (next, batch) => {
      batch.batchSnapshot.resolutions[0].semanticEvidenceRefs[0].note = "extra";
    });
    await refused(verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }),
      "an undeclared field on a group evidence ref", "E_STEP6_GROUP_MALFORMED");
    reseal(repo, world.store, (next, batch) => {
      batch.batchSnapshot.resolutions[0].governanceWitnessRef.note = "extra";
    });
    await refused(verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }),
      "an undeclared field on the witness ref", "E_STEP6_GROUP_MALFORMED");
    // The SAME declared two-field type, nested inside the finding's resolution claim.
    reseal(repo, world.store, (next, batch) => {
      batch.batchSnapshot.results[0].findings[0].resolutionRef.semanticEvidenceRef.note = "extra";
    });
    await refused(verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }),
      "an undeclared field on the nested claim ref", "E_STEP6_RESOLUTION_SHAPE");

    // The CONTAINER is a separate question from its contents.
    reseal(repo, world.store, (next, batch) => { batch.batchSnapshot.resolutions = { not: "an array" }; });
    await refused(verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }),
      "a present non-array resolutions container", "E_STEP6_GROUP_CONTAINER");
    // …while an ABSENT container in readable prior history contributes no candidates and is legal.
    reseal(repo, world.store, (next, batch) => { delete batch.batchSnapshot.resolutions; });
    assert.ok(await verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }),
      "an ABSENT container is legal in readable prior history: it contributes no candidates and reaches "
      + "the zero-candidate singleton branch, which the actual witness still has to satisfy");
  }, "ctide-step6-shapes-");
});

test("EXPL cleanup returns after the historical T proof, even with a later current-only transition", async () => {
  await withRepo(async (repo) => {
    // Round one mints T-b (ASSUM_A -> ASSUM_B) and is committed, so T-b is historical for TASK-2.
    const first = await resolvedWorld(repo);
    repo.git("add", "-A");
    repo.git("commit", "-qm", "round one");
    const treeOid = repo.git("rev-parse", "HEAD^{tree}");
    const committed = fs.readFileSync(path.join(repo.root, CANONICAL_STORE_PATH));
    const base2 = { treeOid, storePath: CANONICAL_STORE_PATH, storeDigest: rawDigest(committed) };

    let store2 = applyTransaction(first.store, "init-task", {
      taskId: "TASK-2", baseProvenance: base2, decisionPoints: [], currentTaskDpIds: [],
    }, OPTS);

    // A REAL later transition, minted AFTER B was captured. T-c revises ASSUM_B to ASSUM_C through an
    // ordinary domain transaction with its own governance witness and ack, so the current store's
    // chain now runs A -> B -> C while the base store still stops at B. That B/C difference is what
    // makes the two assertions below distinguishable: without it, "ignored because unused" and
    // "never reached" look identical.
    const groupDigest = resolutionGroupDigest({
      subjectRef: ASSUM_B, action: "revise", successor: ASSUM_C,
      semanticEvidenceRefs: [{ kind: "review-ruling", ref: "R-ev-c" }],
    });
    store2 = applyTransaction(store2, "replace-terminal", {
      dpId: "DP-1", casMode: "current-terminal", expectedCurrentTerminalRef: ASSUM_B,
      resolutionCarrierUpdates: [{ dpId: "DP-1", action: "unchanged-null" }],
      records: [
        { recordId: "R-ev-c", kind: "review-ruling", by: TEST_DISCIPLINE, subjectRef: ASSUM_B, ruling: "ok" },
        {
          recordId: "R-w-c", kind: "review-ruling", by: CODE, subjectRef: ASSUM_B, ruling: "ok",
          resolutionGroupDigest: groupDigest,
        },
      ],
      successorClause: {
        id: ASSUM_C, layer: "implementation", derivedFrom: "DP-1", text: "revised again",
        alternative: "treat null as invalid", basis: "later evidence", basisRefs: [],
        governedBy: CODE, routingOrigin: "safe-default",
      },
      transition: {
        id: "T-c", subject: ASSUM_B, action: "revise", successor: ASSUM_C,
        authorityRef: CODE, ackRef: { kind: "review-ruling", ref: "R-w-c" },
      },
    }, OPTS);
    const liveIndex = indexStore(store2);
    assert.ok(liveIndex.transitions.get("T-c"), "T-c exists in the CURRENT store");
    assert.ok(!parseStore(committed.toString("utf8")).transitions.some((t) => t.id === "T-c"),
      "…and is absent from the verified base store");

    const digests = await currentSourceDigests(repo.root);
    const identity = adapterIdentity(digests.registryRoot, ADAPTER_ID);
    const commitFor = (tagAfter, over = {}) => {
      const entry = entryFor(identity, { tagAfter, ...(over.entry || {}) });
      const inventory = inventoryFor(digests, base2, [entry]);
      const result = resultFor({
        tagAfter,
        findings: [{
          kind: "assum-reading-change", evidence: "cleaned up after an earlier convergence",
          binding: { clauseRef: ASSUM_A },
          resolutionRef: { mode: "historical-convergence", transitionRef: "T-b" },
        }],
        ...(over.result || {}),
      });
      const payload = {
        taskId: "TASK-2", batchRecordId: "R-b2",
        expectedInputProvenanceStoreDigest: storeDigest(store2),
        batchSnapshot: {
          taskId: "TASK-2", baseProvenance: base2, inventoryDigest: inventory.inventoryDigest,
          inventorySnapshot: { ...inventory, inputProvenanceStoreDigest: storeDigest(store2) },
          results: [result], resolutions: [],
        },
        resolutions: [],
      };
      const snap = payload.batchSnapshot.inventorySnapshot;
      snap.inventoryDigest = computeInventoryV2Digest(snap);
      payload.batchSnapshot.inventoryDigest = snap.inventoryDigest;
      repo.write(CANONICAL_STORE_PATH,
        canonicalStoreBytes(applyTransaction(store2, "commit-test-provenance-batch", payload, OPTS)));
    };

    // POSITIVE: the A test is retagged to EXPL. A cleanup terminus aligns no post binding, so no
    // onward chain is used and T-c -- which exists only in C -- is correctly never inspected.
    commitFor({ expl: true });
    const verdict = await verifyCommittedBatch({ repoRoot: repo.root, taskId: "TASK-2" });
    assert.strictEqual(verdict.converged, true,
      "a cleanup proves T and the pre subject, and inspects no onward transition");
    assert.strictEqual(verdict.resolvedFindingCount, 1);

    // PAIRED NEGATIVE: the same world, but the post binding is now the CLAUSE ASSUM_C. Reaching it
    // uses T-c, which is not in B, so the historical proof has a link it cannot make.
    commitFor({ clauseRef: ASSUM_C });
    await refused(verifyCommittedBatch({ repoRoot: repo.root, taskId: "TASK-2" }),
      "a clause outcome whose used transition was minted after B", "E_STEP6_HISTORICAL_CHAIN");
  }, "ctide-step6-cleanup-");
});

// A disposable copy of the whole scripts directory and its vendor tree, OUTSIDE the checkout. The
// registry accessors take no arguments by design -- "the shipped registry beside this module is the
// only thing this function will ever read" -- so the only way to give the component a different
// registry is to run a copied module whose registry sits beside it. Mutating the real
// cressetide/skills/vigil/scripts/test-adapters.json instead would be read concurrently by every
// other suite under a full run, and an interrupted process would leave the shipped file altered.
function scratchScripts(prefix = "ctide-step6-registry-") {
  // Guarded BEFORE anything is copied into it, and again before it is removed below.
  const dir = checkedTempRoot(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix))), prefix);
  const vigil = path.join(dir, "cressetide", "skills", "vigil");
  fs.mkdirSync(vigil, { recursive: true });
  const from = path.join(root, "cressetide", "skills", "vigil");
  fs.cpSync(path.join(from, "scripts"), path.join(vigil, "scripts"), { recursive: true });
  fs.cpSync(path.join(from, "vendor"), path.join(vigil, "vendor"), { recursive: true });
  const scripts = path.join(vigil, "scripts");
  return {
    dir,
    prefix,
    registryFile: path.join(scripts, "test-adapters.json"),
    url: (file) => pathToFileURL(path.join(scripts, file)).href,
  };
}

test("a same-instance CACHED registry root does not stand in for the current one", async () => {
  await withRepo(async (repo) => {
    await cleanWorld(repo);
    const scratch = scratchScripts();
    try {
      // The copied modules ARE the instance under test: one module graph, one module-level cache.
      const registry = await import(scratch.url("adapter-registry.mjs"));
      const consumer = await import(scratch.url("committed-batch-consumer.mjs"));

      // WARM THE CACHE EXPLICITLY. readTestAdapterRegistryRootFresh neither reads nor writes that
      // cache -- its own contract says so -- so the consumer's own calls never populate it. Only
      // loadTestAdapterRegistryRoot does, and without this line there would be no cached root for the
      // rest of the case to discriminate against.
      const warmed = registry.loadTestAdapterRegistryRoot();
      assert.ok(warmed && Array.isArray(warmed.adapters), "the cached loader really returned a root");
      assert.ok(await consumer.verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }),
        "positive control against the copied module, before any mutation");

      // A SCHEMA-VALID change: a different adapterId keeps the registry loadable, so the only thing
      // that moves is its digest. The head view is untouched.
      const original = fs.readFileSync(scratch.registryFile, "utf8");
      const mutated = JSON.parse(original);
      mutated.adapters[0].adapterId = "node-test-renamed";
      fs.writeFileSync(scratch.registryFile, `${JSON.stringify(mutated, null, 2)}\n`, "utf8");

      // THE DISCRIMINATOR. The cached accessor still hands back the SAME OBJECT, so a stale root is
      // genuinely available inside this instance at this instant -- identity, not deep equality,
      // because the fresh accessor's contract is that two reads deep-equal but are never the same
      // object. The consumer must nevertheless report the registry as moved.
      assert.strictEqual(registry.loadTestAdapterRegistryRoot(), warmed,
        "the cached loader still serves the pre-mutation root");
      const stale = await refused(consumer.verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }),
        "a registry changed under a warm cache", "E_STEP6_SOURCE_STALE");
      assert.strictEqual(stale.detail.headViewDigest.matches, true, "the head view did not move");
      assert.strictEqual(stale.detail.registryDigest.matches, false, "…only the registry did");

      // Restoring the copied file makes the same instance succeed again, which shows the refusal came
      // from the current file rather than from any latched state.
      fs.writeFileSync(scratch.registryFile, original, "utf8");
      assert.ok(await consumer.verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }),
        "and it passes again once the copied registry is restored");

      // Separately, in the same isolated copy: a mutation that breaks the registry's OWN vendor
      // identity rule surfaces that upstream typed error unchanged rather than as a consumer code.
      const badIdentity = JSON.parse(original);
      badIdentity.adapters[0].implementationIdentity.parserVersion = "8.18.1";
      fs.writeFileSync(scratch.registryFile, `${JSON.stringify(badIdentity, null, 2)}\n`, "utf8");
      const upstream = await refused(consumer.verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }),
        "a registry whose vendor identity no longer matches", "E_REGISTRY_IDENTITY");
      assert.ok(!String(upstream.code).startsWith("E_STEP6"), "the upstream cause is not re-labelled as ours");
    } finally {
      fs.rmSync(checkedTempRoot(scratch.dir, scratch.prefix), { recursive: true, force: true });
    }
    // The real shipped registry was never written; the live module still works.
    assert.ok(await verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }),
      "the shared checkout was untouched throughout");
  }, "ctide-step6-registry-");
});
