// `contract-check --provenance`: the PRODUCT entry point for Step 6, driven end to end.
//
// SCOPE. A green run here proves that the real CLI reaches the accepted committed-batch consumer, that
// its arguments are enforced before any verification runs, and that upstream typed causes survive the
// process boundary as machine JSON and a real exit code. It does not re-prove the consumer's semantics
// (test/committed-batch-consumer.test.mjs owns those), does not wire the seven-step loop, and does not
// make Phase 2 READY.
//
// Spec anchors (the current approved coupled set, read as one effective set):
//   SM = 2026-07-25-shared-decision-provenance-model.md (approved v1.15)
//   TP = 2026-07-25-test-provenance-spec.md (approved v1.17) §2, §11b.9c, AC60, AC117, AC127, AC128
//
// WHY THIS FILE WAS REWRITTEN RATHER THAN PATCHED. It used to drive a retired helper that read the §6
// v1 SCRATCH inventory at `.ctide/output/changed-test-inventory.json` and compared it against a legacy
// batch record. Two accepted decisions removed that lane entirely: `--provenance` now delegates to
// verifyCommittedBatch, whose authority is the version-2 inventorySnapshot INSIDE the committed batch
// (scratch is never opened), and TP §2:274-276 refuses every v1 envelope once v2 has rolled out. Cases
// that asserted the scratch lane no longer describe anything the product does. None is deleted
// silently; all 24 are accounted for here.
//
// COVERAGE MAPPING
//   PORTED — same fact, new authority:
//     AC60(vii) v1 base tree, raw digest    -> "a historical v1 base tree verifies read-only…"
//     AC60(viii) v2 base tree               -> "a historical v2 base tree verifies through the CLI…"
//     AC60(xi) no store -> canonical empty  -> "a base tree that holds no store…"
//     AC60(x) no migration / no write-back  -> "consuming a v1 base tree migrates nothing…"
//     AC60(ix) RAW, not normalised          -> "a base store that matches only after normalisation…"
//     no committed batch                    -> "a task with no committed batch…"
//     corrupted batchDigest                 -> "a batchDigest that does not cover its own snapshot…"
//     non-tip committed ref                 -> "a committed ref that is not the chain tip…"
//     dangling committed ref                -> "a committed ref that resolves to nothing…"
//     treeOid != inventory baseTreeOid      -> "a witness that disagrees with the committed inventory…"
//     batch witness != TaskState witness    -> "a batch stating a witness that is not the TASK's…"
//     unreadable tree                       -> "a witness naming an object that does not exist…"
//     missing blob (mktree --missing)       -> "a tree whose store blob was never written…"
//     commit OID standing in for a tree     -> "a commit OID standing in for the base tree…"
//     blob OID                              -> "a blob OID standing in for the base tree…"
//     nonexistent OID  (the SAME retired case carried both, and its title said "a blob or a TAG
//                       OID"; its body never built a tag. The two objects are separate cases here,
//                       and no tag coverage is invented to match the old title.)
//     default mode still exits 0            -> "the default contract report is untouched…"
//   REPLACED — the authority moved from scratch to the committed snapshot:
//     non-canonical scratch inventoryDigest -> "a committed inventorySnapshot whose digest is wrong…"
//     stale batch inventoryDigest           -> "a batch whose declared digest is not its snapshot's…"
//     absent scratch inventory is a failure -> "scratch is not read at all…" — an absent scratch file
//                                              is no longer a failure, because it is not an input
//   RETIRED — the behaviour they asserted was removed by an accepted decision:
//     non-empty inventory fails at the parser   the unsupported-populated gate is gone
//     an inventory outside the canonical §6 schema  that schema IS the retired v1 envelope
//     parser boundary: populated v1 refused     -> test/changed-test-inventory.test.mjs now asserts
//     parser boundary: empty v1 parsed             LEGACY_ENVELOPE_REGENERATE for BOTH shapes
//     AC158 populated v2 readable but refused  -> INVERTED: "a POPULATED committed inventory verifies…"
//     AC117 empty v2 refused as a bypass       -> INVERTED: "an EMPTY committed inventory passes only
//                                                 because the two source digests are recomputed…",
//                                                 which is the check AC117 said did not exist yet
//
// WHICH LAYER EACH NEGATIVE ACTUALLY REACHES. Worth stating, because the consumer has an E_STEP6_*
// judgment that PARALLELS several of these and none of those parallels is what the CLI reports. The
// mode calls loadStore -> validateStoreSchema -> validateAll before Step 6 reads anything, so for any
// fact the STORE itself charges, the store's code is the one that surfaces; the consumer's is
// unreachable through this entry point. Each negative below asserts the code it actually produces:
//
//   canonical inventory reader, rethrown unchanged   E_DIGEST
//   store, record shape                              E_RECORD_PAYLOAD, E_BATCH_DERIVED_DIGEST,
//                                                    E_BATCH_BASE_TREE_MISMATCH
//   store, cross-record                              E_DANGLING_REF, E_HEAD_STATE,
//                                                    E_BATCH_BASE_MISMATCH
//   exact-tree blob reader                           E_TREE_OID, E_GIT_FAILED
//   the Step 6 consumer's own                        E_STEP6_UNKNOWN_TASK,
//                                                    E_STEP6_NO_COMMITTED_BATCH,
//                                                    E_STEP6_BASE_STORE, E_STEP6_SOURCE_STALE
//   the CLI's own, before anything runs              E_API_ARGUMENTS
//
// Every fixture builds a real Git object database, a real store through the REAL transactions, and an
// inventory whose two source digests come from a REAL capture and a REAL fresh registry read.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cp from "node:child_process";
import crypto from "node:crypto";

import { root } from "./helpers.mjs";
import {
  emptyStore, canonicalStoreBytes, storeDigest, sha256Hex, applyTransaction, digestOf,
  CANONICAL_STORE_PATH,
} from "../cressetide/skills/vigil/scripts/provenance-store.mjs";
import {
  INVENTORY_PATH, computeInventoryV2Digest,
} from "../cressetide/skills/vigil/scripts/changed-test-inventory.mjs";
import { captureHeadViewSnapshot } from "../cressetide/skills/vigil/scripts/head-view-snapshot.mjs";
import { readTestAdapterRegistryRootFresh } from "../cressetide/skills/vigil/scripts/adapter-registry.mjs";
import { readHeadExplicitConfig, registryDigestOf } from "../cressetide/skills/vigil/scripts/explicit-config.mjs";

const SCRIPT = path.join(root, "cressetide", "skills", "vigil", "scripts", "contract-check.mjs");
const OPTS = { now: Date.UTC(2026, 8, 6) };
const TASK = "TASK-1";
const ADAPTER_ID = "node-test";
const TEST_PATH = "test/alpha.test.mjs";
const STRUCTURAL = 's:["alpha"]';
const ASSUM_A = "ASSUM-0000000000000000000000000A";
const CODE = { kind: "discipline", discipline: "code" };
const PREFIX = "ctide-prov-cli-";

// RAW sha256 over the bytes as they stand. Deliberately NOT sha256Hex(), which strips a BOM and
// normalises line endings: the base-store witness is a raw-byte comparison, and one case below turns
// on precisely that difference.
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
  const gitIn = (args, input) => cp.execFileSync("git", args, {
    cwd: dir, encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  git("init", "-q", "--initial-branch=main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  // The witness is a RAW byte digest, so no checkout filter may rewrite line endings between what the
  // fixture hashes and what Git stores.
  git("config", "core.autocrlf", "false");
  const write = (rel, body) => {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body, "utf8");
  };
  return { root: dir, prefix, git, gitIn, write };
}

async function withRepo(body, prefix = PREFIX) {
  const repo = makeRepo(prefix);
  try {
    return await body(repo);
  } finally {
    fs.rmSync(checkedTempRoot(repo.root, repo.prefix), { recursive: true, force: true });
  }
}

// The two SOURCE digests, computed exactly the way the consumer computes them. Any other construction
// would make every positive fail on freshness for a reason unrelated to what it tests.
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

const writeStore = (repo, store) => {
  const bytes = canonicalStoreBytes(store);
  repo.write(CANONICAL_STORE_PATH, bytes);
  return bytes;
};

const readStore = (repo) => JSON.parse(fs.readFileSync(path.join(repo.root, CANONICAL_STORE_PATH), "utf8"));

// --- histories --------------------------------------------------------------------------------------

// A store fit to be HISTORY: it carries the ASSUM the populated world's entry binds on its pre side,
// which shared §9 resolves in B rather than in the current store.
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

// A genuinely v1-shaped store: a real v2 store with the field the upgrade added stripped back out,
// rather than a hand-written document no writer ever produced.
function asLegacyV1(store) {
  const raw = JSON.parse(JSON.stringify(store));
  raw.provenanceVersion = 1;
  for (const d of raw.decisionPoints) delete d.reopenCauseRef;
  return raw;
}

const V2_HISTORY = (seedTree) => {
  const prior = priorStore(seedTree);
  return { bytes: canonicalStoreBytes(prior), prior };
};
const V1_HISTORY = (seedTree) => ({ bytes: canonicalStoreBytes(asLegacyV1(priorStore(seedTree))), prior: null });
const NO_HISTORY = () => ({ bytes: null, prior: null });

// --- worlds -----------------------------------------------------------------------------------------

// Seed the repository, commit the history as the base tree, and start TASK-1 against that exact raw
// witness. The head view is captured AFTER the last commit, so nothing written afterwards moves the
// two source digests.
//
// `witnessOid` and `witnessDigest` let a case point the witness at something OTHER than the tree it
// just built — a commit, a blob, an object that was never written — without disturbing anything else.
async function seedWorld(repo, { history = NO_HISTORY, witnessOid = null, witnessDigest = null } = {}) {
  repo.write(TEST_PATH, 'import { test } from "node:test";\ntest("alpha", () => {});\n');
  repo.write(".ctide/keep", "x\n");
  repo.git("add", "-A");
  repo.git("commit", "-qm", "seed");
  const seedTree = repo.git("rev-parse", "HEAD^{tree}");

  const { bytes, prior } = history(seedTree);
  let base;
  let baseBytes = null;
  if (bytes === null) {
    // AC60(xi): a base tree with no store at all. The witness must then name the ONE canonical empty
    // store; absence is absence, and it is not a silent pass.
    base = { treeOid: seedTree, storePath: CANONICAL_STORE_PATH, storeDigest: storeDigest(emptyStore()) };
  } else {
    repo.write(CANONICAL_STORE_PATH, bytes);
    repo.git("add", "-A");
    repo.git("commit", "-qm", "history");
    baseBytes = fs.readFileSync(path.join(repo.root, CANONICAL_STORE_PATH));
    base = {
      treeOid: repo.git("rev-parse", "HEAD^{tree}"),
      storePath: CANONICAL_STORE_PATH,
      storeDigest: rawDigest(baseBytes),
    };
  }
  if (witnessOid) base = { ...base, treeOid: witnessOid(repo, base.treeOid) };
  if (witnessDigest) base = { ...base, storeDigest: witnessDigest(repo, base) };

  const store = applyTransaction(prior ?? emptyStore(), "init-task", {
    taskId: TASK, baseProvenance: base, decisionPoints: [], currentTaskDpIds: [],
  }, OPTS);
  const digests = await currentSourceDigests(repo.root);
  return {
    base, prior, store, digests, seedTree,
    // The tree the history was ACTUALLY committed into, kept separate from base.treeOid because a
    // witness override deliberately makes those two different: the no-side-effect check still has to
    // read the real tree, not the fabricated OID under test.
    treeOid: bytes === null ? seedTree : repo.git("rev-parse", "HEAD^{tree}"),
    baseBytes: baseBytes === null ? null : baseBytes.toString("utf8"),
    identity: adapterIdentity(digests.registryRoot, ADAPTER_ID),
  };
}

function inventoryFor(digests, base, entries) {
  const body = {
    inventoryVersion: 2,
    baseTreeOid: base.treeOid,
    registryDigest: digests.registryDigest,
    headViewDigest: digests.headViewDigest,
    inputProvenanceStoreDigest: "3".repeat(64),
    entries,
  };
  return { ...body, inventoryDigest: computeInventoryV2Digest(body) };
}

// One legal ChangedTestInventoryV2 entry, and the result that exactly covers it. Written side by side
// by hand; neither is derived from the other.
const entryFor = (identity) => ({
  baseBodyDigest: "1".repeat(64),
  framework: "node-test",
  headBodyDigest: "2".repeat(64),
  implementationIdentity: identity,
  reason: "content-change",
  status: "modified",
  tagAfter: { clauseRef: ASSUM_A },
  tagBefore: { clauseRef: ASSUM_A },
  testRef: { adapterId: ADAPTER_ID, path: TEST_PATH, structuralId: STRUCTURAL },
});

const resultFor = () => ({
  testRef: { path: TEST_PATH, adapterId: ADAPTER_ID, structuralId: STRUCTURAL },
  tagBefore: { clauseRef: ASSUM_A },
  tagAfter: { clauseRef: ASSUM_A },
  observedBaseBodyDigest: "1".repeat(64),
  observedHeadBodyDigest: "2".repeat(64),
  findings: [],
});

// Commit the batch through the REAL writer, so the record under test is one the writer actually
// produced rather than a shape assembled to satisfy the reader.
function commitBatch(repo, world, entries, results) {
  const inventory = inventoryFor(world.digests, world.base, entries);
  const payload = {
    taskId: TASK,
    batchRecordId: "R-b1",
    expectedInputProvenanceStoreDigest: storeDigest(world.store),
    batchSnapshot: {
      taskId: TASK,
      baseProvenance: world.base,
      inventoryDigest: inventory.inventoryDigest,
      inventorySnapshot: { ...inventory, inputProvenanceStoreDigest: storeDigest(world.store) },
      results,
      resolutions: [],
    },
    resolutions: [],
  };
  // The persisted inventory binds the pre-state it was produced against, so its digest is recomputed
  // after that field is set to the real value.
  const snap = payload.batchSnapshot.inventorySnapshot;
  snap.inventoryDigest = computeInventoryV2Digest(snap);
  payload.batchSnapshot.inventoryDigest = snap.inventoryDigest;
  const store = applyTransaction(world.store, "commit-test-provenance-batch", payload, OPTS);
  writeStore(repo, store);
  return { ...world, inventory: snap, store };
}

// The EMPTY world. Every base-tree and store/batch case below uses it, because with no entries no
// binding rule is charged and the failure under test cannot be reached through an unrelated guard.
const emptyWorld = async (repo, options) => commitBatch(repo, await seedWorld(repo, options), [], []);

// The POPULATED world: one real entry bound to ASSUM_A on both sides, and the result covering it.
async function populatedWorld(repo) {
  const world = await seedWorld(repo, { history: V2_HISTORY });
  return commitBatch(repo, world, [entryFor(world.identity)], [resultFor()]);
}

// --- running the product entry point ------------------------------------------------------------------

function runChecker(cwd, extra = ["--task", TASK]) {
  const r = cp.spawnSync(process.execPath, [SCRIPT, "--provenance", "--cwd", cwd, ...extra], { encoding: "utf8" });
  let machine = null;
  try { machine = JSON.parse(r.stdout.trim().split("\n").pop()); } catch { /* left null on purpose */ }
  return { status: r.status, machine, stdout: r.stdout, stderr: r.stderr };
}

// Every failing case must leave both stores byte-identical and nothing behind.
function assertNoSideEffects(ctx, what) {
  const { repo, treeOid, currentBefore, baseBefore } = ctx;
  assert.strictEqual(fs.readFileSync(path.join(repo.root, CANONICAL_STORE_PATH), "utf8"), currentBefore,
    `${what}: current provenance store bytes unchanged`);
  if (baseBefore) {
    assert.strictEqual(repo.git("cat-file", "-p", `${treeOid}:${CANONICAL_STORE_PATH}`), baseBefore.trim(),
      `${what}: base-tree bytes unchanged`);
  }
  assert.ok(!fs.existsSync(path.join(repo.root, `${CANONICAL_STORE_PATH}.lock`)), `${what}: no lock left behind`);
  assert.deepStrictEqual(fs.readdirSync(path.join(repo.root, ".ctide")).filter((f) => f.endsWith(".tmp")), [],
    `${what}: no temp residue`);
}

/**
 * One failing invocation, charged EXACTLY.
 *
 * The earlier version of this helper accepted any non-zero exit and matched a prose alternation, and
 * one case went as far as `/cannot be read|E_/` — which matches every typed code the product can
 * emit, so that case would have passed on an unrelated failure. Both are fixed here:
 *
 *   - the exit is 1, not merely non-zero. A child that died before writing a machine result exits
 *     with something else, and that must not read as a refusal;
 *   - the violation is identified by its CODE PREFIX. Every violation the CLI emits is
 *     `${code}: ${message}`, so a `${code}: ` prefix test is exact and cannot be satisfied by the
 *     code name appearing in someone else's prose;
 *   - a single-fault case carries exactly ONE violation. Two would mean the run charged something
 *     the case did not intend.
 *
 * `prose` is optional and SUPPLEMENTARY: it is for the cases where the message carries a distinct
 * fact (which object type was found, which digest was compared), never as an alternative to the code.
 */
function assertFailure(res, ctx, what, code, prose) {
  assert.strictEqual(res.status, 1, `${what}: expected exit 1, got ${res.status} (${res.stdout}${res.stderr})`);
  assert.ok(res.machine, `${what}: a machine result must be emitted, got ${JSON.stringify(res.stdout)}`);
  const verdict = res.machine.provenance;
  assert.strictEqual(verdict.status, "fail", `${what}: machine status=fail`);
  assert.strictEqual(verdict.violations.length, 1,
    `${what}: expected exactly one violation, got ${JSON.stringify(verdict.violations)}`);
  assert.ok(verdict.violations[0].startsWith(`${code}: `),
    `${what}: expected the violation to be ${code}, got ${verdict.violations[0]}`);
  if (prose) assert.match(verdict.violations[0], prose, `${what}: the message states the fact it should`);
  if (ctx) assertNoSideEffects(ctx, what);
  return verdict;
}

// The context every failing case is measured against: the bytes as they stand right before the run.
const contextFor = (repo, world) => ({
  repo,
  treeOid: world.treeOid,
  currentBefore: fs.readFileSync(path.join(repo.root, CANONICAL_STORE_PATH), "utf8"),
  baseBefore: world.baseBytes,
});

// Rewrite the current store OUTSIDE the writer. Negatives need states no transaction would mint, and
// the point of each is that the product refuses them rather than that the writer prevents them.
function tamper(repo, world, mutate) {
  const raw = JSON.parse(JSON.stringify(world.store));
  mutate(raw, raw.records.find((r) => r.recordId === "R-b1"), raw.taskStates.find((t) => t.taskId === TASK));
  repo.write(CANONICAL_STORE_PATH, canonicalStoreBytes(raw));
  return { ...world, store: raw };
}

// --- 1. the CLI's own argument contract -----------------------------------------------------------

test("--provenance requires --task, and refuses before any verification runs", async () => {
  await withRepo(async (repo) => {
    const world = await emptyWorld(repo, { history: V2_HISTORY });
    const ctx = contextFor(repo, world);
    // Without a named task the retired helper inferred one whenever the store held exactly one
    // TaskState, so the same invocation meant different things as the store grew.
    const verdict = assertFailure(runChecker(repo.root, []), ctx, "no --task", "E_API_ARGUMENTS",
      /--provenance requires --task <id>/);
    assert.strictEqual(verdict.taskId, "", "the machine result still names the (absent) task field");
  });
});

test("--inventory is refused in this mode: scratch is not an authority for Step 6", async () => {
  await withRepo(async (repo) => {
    const world = await emptyWorld(repo, { history: V2_HISTORY });
    const ctx = contextFor(repo, world);
    assertFailure(
      runChecker(repo.root, ["--task", TASK, "--inventory", ".ctide/output/changed-test-inventory.json"]),
      ctx, "--inventory supplied", "E_API_ARGUMENTS", /--inventory is not accepted in --provenance mode/);
  });
});

test("both argument faults are reported together, and the consumer is never called", async () => {
  await withRepo(async (repo) => {
    const world = await emptyWorld(repo, { history: V2_HISTORY });
    // The ONE case that is deliberately not single-fault, so it does not go through assertFailure:
    // both violations are charged in the order the CLI charges them, before the consumer is called at
    // all. Exact count and exact order, because "at least one E_API_ARGUMENTS" would also pass if the
    // second fault were silently dropped.
    const res = runChecker(repo.root, ["--inventory", "x"]);
    assert.strictEqual(res.status, 1, `expected exit 1, got ${res.status} (${res.stdout}${res.stderr})`);
    const verdict = res.machine.provenance;
    assert.strictEqual(verdict.status, "fail");
    assert.strictEqual(verdict.violations.length, 2, "both are reported, not the first one only");
    assert.ok(verdict.violations[0].startsWith("E_API_ARGUMENTS: --provenance requires --task"),
      `first: ${verdict.violations[0]}`);
    assert.ok(verdict.violations[1].startsWith("E_API_ARGUMENTS: --inventory is not accepted"),
      `second: ${verdict.violations[1]}`);
    assertNoSideEffects(contextFor(repo, world), "both argument faults");
  });
});

test("an unknown task is a typed refusal, not a crash", async () => {
  await withRepo(async (repo) => {
    const world = await emptyWorld(repo, { history: V2_HISTORY });
    const ctx = contextFor(repo, world);
    assertFailure(runChecker(repo.root, ["--task", "TASK-9"]), ctx,
      "an unknown task", "E_STEP6_UNKNOWN_TASK", /no TaskState for taskId "TASK-9"/);
  });
});

// --- 2. positives, through the real CLI ------------------------------------------------------------

test("a historical v2 base tree verifies through the CLI, and the verdict is spread into the machine result",
  async () => {
    await withRepo(async (repo) => {
      const world = await emptyWorld(repo, { history: V2_HISTORY });
      const res = runChecker(repo.root);
      assert.strictEqual(res.status, 0, `expected a pass, got ${res.stdout}${res.stderr}`);
      const p = res.machine.provenance;
      assert.strictEqual(p.status, "pass");
      assert.deepStrictEqual(p.violations, [], "a pass carries an empty violation list, not an absent one");
      assert.strictEqual(p.converged, true);
      assert.strictEqual(p.taskId, TASK);
      assert.deepStrictEqual(p.committedBatchRef, { kind: "provenance-batch", ref: "R-b1" },
        "the TYPED head ref survives JSON, so a caller can bind to the exact record");
      assert.strictEqual(p.baseTreeOid, world.base.treeOid);
      assert.strictEqual(p.historicalVersion, 2);
      assert.strictEqual(p.priorStateExists, true);
      assert.strictEqual(p.entryCount, 0);
      assert.strictEqual(p.inventoryDigest, world.inventory.inventoryDigest);
      // The two source digests in the verdict are the ones the CHILD recomputed, so they are evidence
      // about the world at verification time rather than a copy of the committed claim.
      assert.strictEqual(p.headViewDigest, world.digests.headViewDigest);
      assert.strictEqual(p.registryDigest, world.digests.registryDigest);
    });
  });

test("a historical v1 base tree verifies read-only on its RAW digest", async () => {
  await withRepo(async (repo) => {
    const world = await emptyWorld(repo, { history: V1_HISTORY });
    const res = runChecker(repo.root);
    assert.strictEqual(res.status, 0, `expected a pass, got ${res.stdout}${res.stderr}`);
    assert.strictEqual(res.machine.provenance.historicalVersion, 1,
      "the historical version is reported as it stands, never upgraded");
    assert.strictEqual(res.machine.provenance.priorStateExists, true);
    assert.strictEqual(JSON.parse(world.baseBytes).provenanceVersion, 1, "…and the fixture really is v1");
  });
});

test("a base tree that holds no store falls back to the canonical empty store", async () => {
  await withRepo(async (repo) => {
    await emptyWorld(repo, { history: NO_HISTORY });
    const res = runChecker(repo.root);
    assert.strictEqual(res.status, 0, `expected a pass, got ${res.stdout}${res.stderr}`);
    assert.strictEqual(res.machine.provenance.priorStateExists, false, "prior-state existence is false");
    // A CHANGE from the retired suite, stated rather than quietly different: the old checker reported
    // historicalVersion 2 here because the canonical empty store declares version 2. The accepted
    // consumer reports NULL, because the field now describes a base store that was actually read, and
    // encoding "there was none" as a version number was the confusion.
    assert.strictEqual(res.machine.provenance.historicalVersion, null,
      "absent B reports null rather than the empty store's own version number");
  });
});

test("a POPULATED committed inventory verifies end to end and PASSES", async () => {
  await withRepo(async (repo) => {
    // The retired AC158 case asserted the opposite: that a fully canonical populated v2 inventory was
    // readable but that the product entry point must still fail closed. That gate is gone, and this is
    // the same fixture shape carried through to the verdict it now earns.
    const world = await populatedWorld(repo);
    const res = runChecker(repo.root);
    assert.strictEqual(res.status, 0, `expected a pass, got ${res.stdout}${res.stderr}`);
    const p = res.machine.provenance;
    assert.strictEqual(p.entryCount, 1, "the entry was consumed, not waved through");
    assert.strictEqual(p.resolvedFindingCount, 0, "a clean batch resolves no findings");
    assert.deepStrictEqual(p.sourceObservations, [], "and observes no ambiguous source");
    assert.strictEqual(p.inventoryDigest, world.inventory.inventoryDigest);
  });
});

test("consuming a v1 base tree migrates nothing and writes nothing back", async () => {
  await withRepo(async (repo) => {
    const world = await emptyWorld(repo, { history: V1_HISTORY });
    const currentBefore = fs.readFileSync(path.join(repo.root, CANONICAL_STORE_PATH), "utf8");
    const headBefore = repo.git("rev-parse", "HEAD");

    assert.strictEqual(runChecker(repo.root).status, 0);

    const after = repo.git("cat-file", "-p", `${world.base.treeOid}:${CANONICAL_STORE_PATH}`);
    assert.strictEqual(sha256Hex(`${after}\n`), sha256Hex(world.baseBytes), "base-tree bytes are byte-identical");
    const parsed = JSON.parse(after);
    assert.strictEqual(parsed.provenanceVersion, 1, "no migration");
    assert.ok(parsed.decisionPoints.every((d) => !("reopenCauseRef" in d)), "no reopenCauseRef backfill");
    assert.strictEqual(fs.readFileSync(path.join(repo.root, CANONICAL_STORE_PATH), "utf8"), currentBefore,
      "and the current store is untouched by a read-only verification");
    assert.strictEqual(repo.git("rev-parse", "HEAD"), headBefore, "no commit was created");
  });
});

// --- 3. the base tree the witness names ------------------------------------------------------------

test("a base store that matches only AFTER normalisation is refused — the comparison is RAW", async () => {
  await withRepo(async (repo) => {
    let clean = "";
    const world = await emptyWorld(repo, {
      // A BOM changes the bytes but not the parsed store, so a normalising comparison would call this
      // a match. The witness names the CLEAN digest. Built from a code point rather than a literal, so
      // this file itself stays free of stray BOM bytes.
      history: (seedTree) => {
        clean = canonicalStoreBytes(priorStore(seedTree));
        return { bytes: String.fromCharCode(0xfeff) + clean, prior: null };
      },
      witnessDigest: () => rawDigest(Buffer.from(clean, "utf8")),
    });
    // The context is captured BEFORE the run. Reading it afterwards would compare the post-run bytes
    // with themselves and assert nothing at all.
    const ctx = contextFor(repo, world);
    assertFailure(runChecker(repo.root), ctx, "a BOM-only difference", "E_STEP6_BASE_STORE",
      /raw-byte digest .* does not equal the witness/);

    // The premise, stated with a RAW hasher: sha256Hex() is the CANONICAL digest helper, which is
    // exactly why the witness comparison must not use it.
    assert.notStrictEqual(rawDigest(Buffer.from(world.baseBytes, "utf8")), rawDigest(Buffer.from(clean, "utf8")),
      "raw byte digests differ");
    assert.strictEqual(sha256Hex(world.baseBytes), sha256Hex(clean), "yet the canonical digest is identical");
  });
});

test("a witness naming an object that does not exist fails closed, not as a missing store", async () => {
  await withRepo(async (repo) => {
    const world = await emptyWorld(repo, { history: V2_HISTORY, witnessOid: () => `${"0".repeat(39)}1` });
    const ctx = contextFor(repo, world);
    const verdict = assertFailure(runChecker(repo.root), ctx, "an unresolvable witness", "E_TREE_OID",
      /is not an object in this repository/);
    assert.doesNotMatch(verdict.violations[0], /canonical empty store/,
      "a Git failure must never be reported as a base tree that simply held no store");
  });
});

test("a commit OID standing in for the base tree is refused — the witness must BE a tree", async () => {
  await withRepo(async (repo) => {
    const world = await emptyWorld(repo, {
      history: V2_HISTORY,
      witnessOid: (r) => r.git("rev-parse", "HEAD"),
    });
    // The premise, asserted rather than assumed: this really is a commit, and `rev-parse ^{tree}`
    // peels it, so peelability proves nothing about the object's own type.
    assert.strictEqual(repo.git("cat-file", "-t", world.base.treeOid), "commit", "the fixture OID is a commit");
    assert.strictEqual(repo.git("rev-parse", `${world.base.treeOid}^{tree}`), repo.git("rev-parse", "HEAD^{tree}"),
      "and it peels to the tree the witness should have named");

    const ctx = contextFor(repo, world);
    // The exact-tree reader's own code and its own sentence: the object's declared type is named, and
    // "peels to a tree" is refused explicitly rather than by silence.
    assertFailure(runChecker(repo.root), ctx, "a commit OID", "E_TREE_OID",
      /is a commit, not a tree; an object that merely PEELS to a tree is not the tree/);
    assert.strictEqual(
      readStore(repo).taskStates.find((t) => t.taskId === TASK).committedProvenanceBatchRef.ref, "R-b1",
      "the committed head is untouched");
  });
});

test("a blob OID standing in for the base tree is refused for the same reason", async () => {
  await withRepo(async (repo) => {
    const world = await emptyWorld(repo, {
      history: V2_HISTORY,
      witnessOid: (r, treeOid) => r.git("rev-parse", `${treeOid}:${CANONICAL_STORE_PATH}`),
    });
    assert.strictEqual(repo.git("cat-file", "-t", world.base.treeOid), "blob", "the fixture OID is a blob");
    const ctx = contextFor(repo, world);
    assertFailure(runChecker(repo.root), ctx, "a blob OID", "E_TREE_OID", /is a blob, not a tree/);
  });
});

test("a tree whose store blob was never written fails closed on the BLOB read", async () => {
  await withRepo(async (repo) => {
    let blobOid = "";
    const world = await emptyWorld(repo, {
      history: V2_HISTORY,
      // Built with plumbing rather than by deleting a loose object: `mktree --missing` writes a tree
      // REFERENCING a blob that was never added to the object database, so the ls-tree-succeeds /
      // cat-file-fails branch is exercised on every machine, packed objects or not.
      witnessOid: (r) => {
        blobOid = r.gitIn(["hash-object", "--stdin"], "never written\n");   // computed, NOT written
        const subtree = r.gitIn(["mktree", "--missing"], `100644 blob ${blobOid}\tprovenance.json\n`);
        return r.gitIn(["mktree", "--missing"], `040000 tree ${subtree}\t.ctide\n`);
      },
    });
    // the three conditions this case exists to hit, asserted rather than assumed
    assert.ok(repo.git("rev-parse", "--verify", `${world.base.treeOid}^{tree}`), "the tree itself reads");
    const listing = repo.git("ls-tree", "--full-tree", world.base.treeOid, "--", CANONICAL_STORE_PATH);
    assert.match(listing, /blob/, "the path is listed, and listed as a blob");
    assert.match(listing, new RegExp(blobOid), "the listing names the missing blob");
    assert.throws(() => repo.git("cat-file", "blob", blobOid), "the blob genuinely cannot be read");

    const ctx = contextFor(repo, world);
    // The tree resolves and the entry lists as a regular blob, so the refusal comes from the BLOB
    // read itself: the exact-tree reader's Git-failure code, not a tree-shape one.
    const verdict = assertFailure(runChecker(repo.root), ctx, "a missing blob", "E_GIT_FAILED");
    assert.doesNotMatch(verdict.violations[0], /canonical empty store/,
      "a destroyed blob must not be reported as a missing store");
  });
});

test("a witness that disagrees with the committed inventory's baseTreeOid is refused", async () => {
  await withRepo(async (repo) => {
    const world = await emptyWorld(repo, { history: V2_HISTORY });
    // BOTH witnesses move together, so they still agree with each OTHER; only the committed inventory
    // still names the tree that was actually verified. This is the record-shape comparison at
    // provenance-store.mjs:899-906.
    const moved = tamper(repo, world, (raw, batch, ts) => {
      const other = "b".repeat(40);
      ts.baseProvenance.treeOid = other;
      batch.batchSnapshot.baseProvenance.treeOid = other;
      batch.batchDigest = digestOf(batch.batchSnapshot);
    });
    const ctx = contextFor(repo, moved);
    assertFailure(runChecker(repo.root), ctx, "a witness the inventory does not share",
      "E_BATCH_BASE_TREE_MISMATCH", /inventorySnapshot was computed against/);
  });
});

test("a batch stating a witness that is not the TASK's is refused, at the other witness boundary", async () => {
  await withRepo(async (repo) => {
    const world = await emptyWorld(repo, { history: V2_HISTORY });
    // ISOLATION, and why it has to be this field. An earlier version of this case moved the batch's
    // own baseProvenance.treeOid, which made `batch.baseProvenance.treeOid !== snapshot.baseTreeOid`
    // and so tripped the record-shape check at provenance-store.mjs:901 -- E_BATCH_BASE_TREE_MISMATCH,
    // the SAME failure as the control above, never reaching the boundary this case is named after.
    //
    // Moving only storeDigest leaves the treeOid/inventory relationship intact, so :901 passes; the
    // whole-object canonicalJson comparison of batch witness against TaskState witness at
    // provenance-store.mjs:1545-1553 is then the first thing that can fail. The batch is rehashed so
    // the refusal is the witness comparison and not a stale batchDigest.
    const moved = tamper(repo, world, (raw, batch, ts) => {
      batch.batchSnapshot.baseProvenance.storeDigest = sha256Hex("a base store this task never witnessed");
      assert.strictEqual(batch.batchSnapshot.baseProvenance.treeOid,
        batch.batchSnapshot.inventorySnapshot.baseTreeOid,
        "the isolation premise: the tree relationship the earlier boundary charges is untouched");
      assert.notStrictEqual(batch.batchSnapshot.baseProvenance.storeDigest, ts.baseProvenance.storeDigest,
        "and the task's tracked witness really does differ now");
      batch.batchDigest = digestOf(batch.batchSnapshot);
    });
    const ctx = contextFor(repo, moved);
    assertFailure(runChecker(repo.root), ctx, "a batch witness of its own", "E_BATCH_BASE_MISMATCH",
      /does not equal task TASK-1's tracked baseProvenance/);
  });
});

// --- 4. the committed head and the batch itself ----------------------------------------------------

test("a task with no committed batch is a rerun-the-loop state, never a pass", async () => {
  await withRepo(async (repo) => {
    const world = await seedWorld(repo, { history: V2_HISTORY });
    writeStore(repo, world.store);                       // seeded, but nothing committed
    const ctx = contextFor(repo, world);
    // A null head is legal STATE — the store validates cleanly — so this is one of the few facts the
    // store does not charge and the consumer's own code is what surfaces.
    assertFailure(runChecker(repo.root), ctx, "a null committed head", "E_STEP6_NO_COMMITTED_BATCH",
      /Rerun the loop through Step 5/);
  });
});

test("a committed ref that resolves to nothing fails closed", async () => {
  await withRepo(async (repo) => {
    const world = await emptyWorld(repo, { history: V2_HISTORY });
    const ghost = tamper(repo, world, (raw, batch, ts) => {
      ts.committedProvenanceBatchRef = { kind: "provenance-batch", ref: "R-ghost" };
    });
    const ctx = contextFor(repo, ghost);
    assertFailure(runChecker(repo.root), ctx, "a dangling committed ref", "E_DANGLING_REF",
      /committed batch ref does not resolve/);
  });
});

test("a committed ref that is not the chain tip fails closed", async () => {
  await withRepo(async (repo) => {
    const world = await emptyWorld(repo, { history: V2_HISTORY });
    // A second batch advances the head; pointing the committed ref back at the first makes it a stale
    // non-head ref, which the store's own three-state head rule refuses.
    const stale = tamper(repo, world, (raw, batch, ts) => {
      const second = JSON.parse(JSON.stringify(batch));
      second.recordId = "R-b2";
      second.previousBatchRef = { kind: "provenance-batch", ref: "R-b1" };
      raw.records.push(second);
      ts.committedProvenanceBatchRef = { kind: "provenance-batch", ref: "R-b1" };
    });
    const ctx = contextFor(repo, stale);
    assertFailure(runChecker(repo.root), ctx, "a stale non-head committed ref", "E_HEAD_STATE",
      /does not equal the unique chain tip/);
  });
});

test("a batchDigest that does not cover its own snapshot fails closed", async () => {
  await withRepo(async (repo) => {
    const world = await emptyWorld(repo, { history: V2_HISTORY });
    const broken = tamper(repo, world, (raw, batch) => {
      batch.batchDigest = sha256Hex("not the snapshot");
    });
    const ctx = contextFor(repo, broken);
    assertFailure(runChecker(repo.root), ctx, "a corrupted batchDigest", "E_RECORD_PAYLOAD",
      /batchDigest does not match its snapshot/);
  });
});

test("a committed inventorySnapshot whose digest is wrong fails closed", async () => {
  await withRepo(async (repo) => {
    const world = await emptyWorld(repo, { history: V2_HISTORY });
    // One field of the PREIMAGE moves and its digest does not follow. This replaces the retired
    // scratch case: the preimage that must digest correctly is the committed one, not a file on disk.
    //
    // THE CODE IS THE CANONICAL READER'S, and naming it exactly is the point. assertInventorySnapshot
    // (provenance-store.mjs:854-859) runs parseCanonicalInventoryV2 over the snapshot and RETHROWS its
    // error unchanged, so E_DIGEST arrives here with the reader's own sentence. The consumer's own
    // E_STEP6_INVENTORY_DIGEST is not reachable for this fixture at all -- store validation charges
    // the fact first -- and an earlier draft of this assertion listed it as an alternative, which was
    // an invented label.
    const broken = tamper(repo, world, (raw, batch) => {
      batch.batchSnapshot.inventorySnapshot.inputProvenanceStoreDigest = sha256Hex("a different pre-state");
      batch.batchDigest = digestOf(batch.batchSnapshot);
    });
    const ctx = contextFor(repo, broken);
    assertFailure(runChecker(repo.root), ctx, "a mis-digested inventorySnapshot", "E_DIGEST",
      /does not equal the single formula/);
  });
});

test("a batch whose declared inventoryDigest is not its snapshot's fails closed", async () => {
  await withRepo(async (repo) => {
    const world = await emptyWorld(repo, { history: V2_HISTORY });
    const stale = tamper(repo, world, (raw, batch) => {
      batch.inventoryDigest = sha256Hex("an earlier inventory");
    });
    const ctx = contextFor(repo, stale);
    // Again the STORE's code, not the consumer's E_STEP6_DERIVED_DIGEST: record.inventoryDigest is
    // derived from the snapshot, and provenance-store.mjs:861-867 charges that before Step 6 runs.
    assertFailure(runChecker(repo.root), ctx, "a stale declared inventoryDigest", "E_BATCH_DERIVED_DIGEST",
      /DERIVED from the snapshot, never a second authority/);
  });
});

// --- 5. what the verdict actually rests on ---------------------------------------------------------

test("an EMPTY committed inventory passes only because the two source digests are RECOMPUTED", async () => {
  await withRepo(async (repo) => {
    // AC117 refused an empty v2 inventory outright, because its registryDigest and headViewDigest were
    // legal 64-hex carriers that nothing recomputed, so "entries: []" asserted a covered-and-unchanged
    // universe it could not back up. The consumer now recomputes both from a real capture and a real
    // fresh registry read. This case proves that is load-bearing rather than decorative: the same
    // world passes, and passes no longer the moment the world moves.
    await emptyWorld(repo, { history: V2_HISTORY });
    assert.strictEqual(runChecker(repo.root).status, 0, "the committed world verifies");

    repo.write(TEST_PATH, 'import { test } from "node:test";\ntest("alpha", () => { /* moved */ });\n');
    const res = runChecker(repo.root);
    assert.strictEqual(res.status, 1, `and the moved world does not: ${res.stdout}`);
    const verdict = res.machine.provenance;
    assert.strictEqual(verdict.violations.length, 1);
    assert.ok(verdict.violations[0].startsWith("E_STEP6_SOURCE_STALE: "),
      `the cause is source freshness, named as such: ${verdict.violations[0]}`);
    assert.match(verdict.violations[0], /describes a world that has moved/);
  });
});

test("scratch is not read at all: neither its absence nor its contents change the verdict", async () => {
  await withRepo(async (repo) => {
    await emptyWorld(repo, { history: V2_HISTORY });
    const scratch = path.join(repo.root, INVENTORY_PATH);
    assert.ok(!fs.existsSync(scratch), "the fixture writes no scratch artifact at all");
    assert.strictEqual(runChecker(repo.root).status, 0, "an ABSENT scratch file is not a failure any more");

    // `.ctide/output/**` is hard-excluded from the head view, so this cannot move the digests either.
    fs.mkdirSync(path.dirname(scratch), { recursive: true });
    fs.writeFileSync(scratch, "{ not even JSON\n", "utf8");
    const res = runChecker(repo.root);
    assert.strictEqual(res.status, 0, `a corrupt scratch artifact is still not an input: ${res.stdout}`);
    assert.strictEqual(fs.readFileSync(scratch, "utf8"), "{ not even JSON\n", "and it is not rewritten");
  });
});

// --- 6. the other mode is untouched ------------------------------------------------------------------

test("the default contract report is untouched: fail-open, and always exit 0", async () => {
  await withRepo(async (repo) => {
    await emptyWorld(repo, { history: V2_HISTORY });
    const r = cp.spawnSync(process.execPath, [SCRIPT], { cwd: repo.root, encoding: "utf8" });
    assert.strictEqual(r.status, 0, "the default mode still exits 0");
    assert.doesNotMatch(r.stdout, /"provenance"/, "and emits no provenance machine result");
  });
});
