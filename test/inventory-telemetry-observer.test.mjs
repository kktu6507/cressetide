// The E1 telemetry observer (TP v1.18 amendment §C.1/§C.2), through its real API and its real CLI.
//
// SCOPE. A green run here proves the OBSERVER. It does not wire the seven-step flow, does not
// establish loop evidence, and does not make Phase 2 READY. Sequencing this operation between
// emission and the committing write is D's, not this component's.
//
// HOW THE FIXTURES WORK. Every repository is a real Git repository with a real base tree, a real
// provenance store and an artifact produced by the REAL emitter, so the pre-state digest the observer
// checks is the one the producer actually recorded. The oracle scenarios move one variable each.
//
// FAULT INJECTION. Two boundaries cannot be reached from outside the process: a store mutated
// BETWEEN the observer's own captures, and a rich analysis that disagrees with discovery's
// projection (both run the same shipped code, so they cannot differ naturally). Those two cases run
// in an ISOLATED CHILD that imports the SHIPPED module and patches only its own process, and each
// says so in its title. Everything else is ordinary filesystem and store input.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cp from "node:child_process";
import crypto from "node:crypto";

import { root } from "./helpers.mjs";
import {
  emptyStore, canonicalStoreBytes, storeDigest, sha256Hex, canonicalJson, CANONICAL_STORE_PATH,
} from "../cressetide/skills/vigil/scripts/provenance-store.mjs";
import {
  INVENTORY_PATH, computeInventoryV2Digest, parseCanonicalInventoryV2,
} from "../cressetide/skills/vigil/scripts/changed-test-inventory.mjs";
import {
  emitChangedTestInventory,
} from "../cressetide/skills/vigil/scripts/changed-test-inventory-artifact.mjs";
import {
  observeInventoryTelemetry, readBoundObservation, parseObservationText, parseObserverArgs,
  OBSERVATION_PATH, OBSERVATION_KEYS, twoSidedEntryCount,
} from "../cressetide/skills/vigil/scripts/inventory-telemetry-observer.mjs";

const SCRIPT = path.join(root, "cressetide", "skills", "vigil", "scripts", "inventory-telemetry-observer.mjs");
const TASK = "TASK-1";
const PREFIX = "ctide-obs-";
const U = (tail) => `01J000000000000000000000${tail}`;
const CLAUSE_A = `REQ-${U("0A")}`;
const CLAUSE_B = `REQ-${U("0B")}`;
const NODE_TEST = 'import { test } from "node:test";\n';
const rawDigest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

function checkedTempRoot(dir, prefix) {
  const parent = fs.realpathSync(os.tmpdir());
  const resolved = path.resolve(dir);
  assert.strictEqual(path.dirname(resolved), parent, `refusing ${resolved}: not a direct temp child`);
  assert.ok(path.basename(resolved).startsWith(prefix), `refusing ${resolved}: wrong prefix`);
  return resolved;
}

// --- the repository -----------------------------------------------------------------------------------

function makeRepo(prefix = PREFIX) {
  const dir = checkedTempRoot(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix))), prefix);
  const git = (...a) => cp.execFileSync("git", a, {
    cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  git("init", "-q", "--initial-branch=main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  git("config", "core.symlinks", "false");
  git("config", "core.autocrlf", "false");
  const write = (rel, body) => {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body, "utf8");
  };
  const storeFile = path.join(dir, ...CANONICAL_STORE_PATH.split("/"));
  let committed = null;
  let committedStoreDigest = storeDigest(emptyStore());
  return {
    root: dir, git, write, prefix,
    remove: (rel) => fs.rmSync(path.join(dir, rel), { force: true }),
    move: (from, to) => {
      const body = fs.readFileSync(path.join(dir, from), "utf8");
      fs.rmSync(path.join(dir, from), { force: true });
      write(to, body);
    },
    commit: () => {
      git("add", "-A");
      git("commit", "-qm", "c");
      committed = git("rev-parse", "HEAD^{tree}");
      // The witness digest of the store THIS tree carries, over its ORIGINAL bytes -- the raw
      // notation, which the observer's mandatory base-witness check reads back through the
      // accepted exact-tree reader.
      committedStoreDigest = fs.existsSync(storeFile)
        ? rawDigest(fs.readFileSync(storeFile))
        : storeDigest(emptyStore());
      return committed;
    },
    baseTreeOid: () => committed,
    baseStoreDigest: () => committedStoreDigest,
    // The CURRENT store always carries the task witnessing the tree just committed. `text` lets a
    // case write a byte form of its own -- pretty-printed, for instance -- without changing content.
    putStore: (store, { text = null } = {}) => {
      // A BASE-side store is written before any commit exists and stays task-free: a base tree
      // cannot name its own oid, so it carries no TaskState witnessing itself.
      if (committed === null) {
        write(CANONICAL_STORE_PATH, text === null ? canonicalStoreBytes(store) : text(store));
        return store;
      }
      const withTask = JSON.parse(JSON.stringify(store));
      withTask.taskStates = [{
        taskId: TASK,
        baseProvenance: {
          treeOid: committed, storePath: CANONICAL_STORE_PATH, storeDigest: committedStoreDigest,
        },
        currentTaskDpIds: [],
      }];
      write(CANONICAL_STORE_PATH, text === null ? canonicalStoreBytes(withTask) : text(withTask));
      return withTask;
    },
  };
}

async function withRepo(body, prefix = PREFIX) {
  const repo = makeRepo(prefix);
  try {
    return await body(repo);
  } finally {
    fs.rmSync(checkedTempRoot(repo.root, repo.prefix), { recursive: true, force: true });
  }
}

// A store carrying inert snapshot-only sources, so a clause hanging off one never drifts and every
// single-variable control below really is single-variable.
function storeWith(clauses) {
  const s = emptyStore();
  s.sources.push({
    sourceId: "S-inert", contentKind: "requirement", driftMode: "snapshot-only",
    locator: "c#1", excerpt: "inert", digest: sha256Hex("inert"),
  });
  for (const id of clauses) {
    s.clauses.push({
      id, authority: "approved-requirement", kind: "specification",
      text: `clause ${id}`, sourceRef: "S-inert", taskRef: TASK,
    });
  }
  return s;
}

const tagged = (clauseRef, name, body = "") => `${NODE_TEST}// @src ${clauseRef}\ntest("${name}", () => {${body}});\n`;

// A test whose ORACLE closure covers a helper module. The helper must ASSERT: a callable that only
// computes is a resolution edge, not an oracle edge, which is exactly what makes the SUT-only
// control below a control.
const taggedWithHelper = (clauseRef, name, specifier, body = "") =>
  `${NODE_TEST}import { helper } from "${specifier}";\n// @src ${clauseRef}\n`
  + `test("${name}", () => { helper();${body} });\n`;
const oracleHelper = (n) => `import assert from "node:assert";\nexport function helper() { assert.ok(${n}); }\n`;
const plainSut = (n) => `export function compute() { return ${n}; }\n`;

const request = (repo, over = {}) => ({
  repoRoot: repo.root, baseTreeOid: repo.baseTreeOid(), taskId: TASK, ...over,
});
const artifactPath = (repo) => path.join(repo.root, ...INVENTORY_PATH.split("/"));
const sidecarPath = (repo) => path.join(repo.root, ...OBSERVATION_PATH.split("/"));
const readArtifact = (repo) => parseCanonicalInventoryV2(fs.readFileSync(artifactPath(repo), "utf8"));

async function refused(promise, what, code) {
  let error = null;
  try { await promise; } catch (e) { error = e; }
  assert.ok(error && error.code, `${what}: expected a coded failure, got ${error}`);
  if (code) assert.strictEqual(error.code, code, `${what}: expected ${code}, got ${error.code} (${error.message})`);
  return error;
}

const byPath = (entries) => Object.fromEntries(entries.map((e) => [e.testRef.path, e]));

// --- the isolated child, for the two boundaries the process cannot otherwise reach -------------------

const CHILD_PREFIX = "ctide-obs-child-";
const CHILD_SOURCE = `import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const config = JSON.parse(process.argv[2]);
let hits = 0;

// DECLARED INJECTION, patching THIS CHILD's own builtins only. The shipped observer is imported
// unmodified below.
if (config.fault === "mutate-between-captures") {
  // The store file is read once for authority and once for the pre-publication recheck. Rewriting it
  // just before the SECOND read is the only way to reach that recheck from outside the operation.
  const realRead = fs.readFileSync;
  fs.readFileSync = function (file, options) {
    if (String(file) === config.storeFile) {
      hits += 1;
      if (hits === 2) realRead.call(fs, config.storeFile, "utf8") && fs.appendFileSync(config.storeFile, " ");
    }
    return realRead.call(fs, file, options);
  };
}

const emitter = await import(pathToFileURL(config.observer).href);
let outcome;
try {
  const result = await emitter.observeInventoryTelemetry({
    repoRoot: config.repoRoot, baseTreeOid: config.baseTreeOid, taskId: config.taskId,
  });
  outcome = { ok: true, result };
} catch (error) {
  outcome = { ok: false, code: error && error.code, message: error && error.message };
}
process.stdout.write(JSON.stringify({ ...outcome, hits }) + "\\n");
`;

// A child that COUNTS reads of one exact path and nothing else. It exists to prove a negative that
// an outcome assertion cannot: that the refusal happened BEFORE the artifact was opened. An
// eventual E_OBS_TARGET from the publication guard would be satisfied even if the redirected bytes
// had already been taken, which is the whole defect.
const READ_COUNTER_CHILD = `import fs from "node:fs";
import { pathToFileURL } from "node:url";

const config = JSON.parse(process.argv[2]);
let reads = 0;
const realRead = fs.readFileSync;
fs.readFileSync = function (file, options) {
  if (String(file) === config.countedPath) reads += 1;
  return realRead.call(fs, file, options);
};

const observer = await import(pathToFileURL(config.observer).href);
let outcome;
try {
  const result = await observer.observeInventoryTelemetry({
    repoRoot: config.repoRoot, baseTreeOid: config.baseTreeOid, taskId: config.taskId,
  });
  outcome = { ok: true, result };
} catch (error) {
  outcome = { ok: false, code: error && error.code, message: error && error.message };
}
process.stdout.write(JSON.stringify({ ...outcome, reads }) + "\\n");
`;

// The projection guard cannot be reached by patching: the shipped adapter component is frozen, and
// the observer and discovery run the SAME code, so their projections cannot differ naturally. It is
// exercised by a SOURCE COPY instead -- the shipped file's text, with its relative imports rewritten
// to absolute URLs and ONE perturbation inserted at a named line. Stated precisely: this proves the
// GUARD's logic on a copy whose only difference is that perturbation. It does not re-prove the
// shipped file's bytes, and no shipped source is modified.
const PROJECTION_ANCHOR = "      projected.push(projectModule(adapter, module));";
const PROJECTION_PATCH = `      const perturbed = projectModule(adapter, module);
      if (side === "head" && perturbed.declarations.length > 0) {
        perturbed.declarations[0].bodyDigest = "f".repeat(64);   // INJECTED BY THE TEST COPY
      }
      projected.push(perturbed);`;

function copiedObserverWithPerturbedProjection(dir) {
  const source = fs.readFileSync(SCRIPT, "utf8");
  assert.ok(source.includes(PROJECTION_ANCHOR),
    "the copy anchor moved; re-point it rather than letting this case silently stop injecting");
  const scriptsDir = path.dirname(SCRIPT).split(path.sep).join("/");
  const rewritten = source
    .replace(/from "\.\//g, `from "file:///${scriptsDir}/`)
    .replace(PROJECTION_ANCHOR, PROJECTION_PATCH);
  const file = path.join(dir, "observer-copy.mjs");
  fs.writeFileSync(file, rewritten, "utf8");
  return file;
}

function runChild(repo, source, config, { perturbProjection = false } = {}) {
  const dir = checkedTempRoot(
    fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), CHILD_PREFIX))), CHILD_PREFIX);
  try {
    const file = path.join(dir, "observe-child.mjs");
    fs.writeFileSync(file, source, "utf8");
    const payload = {
      observer: perturbProjection ? copiedObserverWithPerturbedProjection(dir) : SCRIPT,
      registry: path.join(root, "cressetide", "skills", "vigil", "scripts", "adapter-registry.mjs"),
      repoRoot: repo.root,
      baseTreeOid: repo.baseTreeOid(),
      taskId: TASK,
      storeFile: path.join(repo.root, ...CANONICAL_STORE_PATH.split("/")),
      ...config,
    };
    const proc = cp.spawnSync(process.execPath, [file, JSON.stringify(payload)], { encoding: "utf8" });
    assert.strictEqual(proc.status, 0, `the child harness itself failed: ${proc.stderr}`);
    return JSON.parse(proc.stdout.trim().split("\n").pop());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// --- 1. the oracle metric, one variable per scenario --------------------------------------------------

test("the two-sided oracle count is non-exclusive: oracle-only, moved+oracle and overlap count; declaration-only, moved-only, SUT-only and added do not",
  () => withRepo(async (repo) => {
    // BASE. Six tests plus the helpers two of them depend on and one module nobody's oracle covers.
    repo.write("helper-a.mjs", oracleHelper(1));
    repo.write("helper-b.mjs", oracleHelper(1));
    repo.write("sut.mjs", plainSut(1));
    repo.write("oracle-only.test.mjs", taggedWithHelper(CLAUSE_A, "oracle only", "./helper-a.mjs"));
    repo.write("declaration-only.test.mjs", tagged(CLAUSE_A, "declaration only"));
    repo.write("moved-only.test.mjs", tagged(CLAUSE_A, "moved only"));
    repo.write("moved-oracle.test.mjs", taggedWithHelper(CLAUSE_A, "moved and oracle", "./helper-b.mjs"));
    repo.write("overlap.test.mjs", taggedWithHelper(CLAUSE_A, "overlap", "./helper-b.mjs"));
    repo.write("sut-only.test.mjs", tagged(CLAUSE_A, "sut only"));
    repo.putStore(storeWith([CLAUSE_A]));
    const oid = repo.commit();

    // HEAD, one variable per file.
    repo.write("helper-a.mjs", oracleHelper(2));            // oracle-only, and nothing else moves
    repo.write("helper-b.mjs", oracleHelper(3));            // moved-oracle + overlap
    repo.write("sut.mjs", plainSut(2));                     // asserts nothing: in nobody's oracle closure
    repo.write("declaration-only.test.mjs", tagged(CLAUSE_A, "declaration only", " /* edited */"));
    repo.move("moved-only.test.mjs", "moved/moved-only.test.mjs");
    // Renamed in place rather than moved into a subdirectory: a move that also broke the relative
    // helper specifier would refuse in the adapter and prove nothing about the metric.
    repo.move("moved-oracle.test.mjs", "moved-oracle-renamed.test.mjs");
    // declaration AND tag AND oracle move together; §6 row 4 still classifies it.
    repo.write("overlap.test.mjs", taggedWithHelper(CLAUSE_B, "overlap", "./helper-b.mjs", " /* edited */"));
    repo.write("added.test.mjs", tagged(CLAUSE_B, "added"));
    repo.putStore(storeWith([CLAUSE_A, CLAUSE_B]));

    await emitChangedTestInventory(request(repo, { baseTreeOid: oid }));
    const inventory = readArtifact(repo);
    const map = byPath(inventory.entries);

    // The classification premise, asserted so the metric is measured over a known world.
    assert.strictEqual(map["oracle-only.test.mjs"].status, "modified",
      "an oracle change moves bodyDigest, so §6 row 4 fires");
    assert.strictEqual(map["declaration-only.test.mjs"].status, "modified");
    assert.strictEqual(map["moved/moved-only.test.mjs"].status, "moved");
    assert.strictEqual(map["moved-oracle-renamed.test.mjs"].status, "moved");
    assert.strictEqual(map["added.test.mjs"].status, "added");
    assert.ok(!("sut-only.test.mjs" in map), "a module outside every oracle closure produces no entry at all");

    const observation = await observeInventoryTelemetry(request(repo, { baseTreeOid: oid }));
    assert.strictEqual(observation.oracleDepTriggered, 3,
      `oracle-only + moved+oracle + overlap; got ${observation.oracleDepTriggered} over `
      + `${JSON.stringify(inventory.entries.map((e) => [e.testRef.path, e.status]))}`);
    assert.ok(observation.oracleDepTriggered <= twoSidedEntryCount(inventory.entries),
      "and it never exceeds the two-sided comparison domain");

    // The sidecar is bound to the artifact it describes, on all four fields.
    assert.strictEqual(observation.inventoryDigest, inventory.inventoryDigest);
    assert.strictEqual(observation.baseTreeOid, inventory.baseTreeOid);
    assert.strictEqual(observation.headViewDigest, inventory.headViewDigest);
    assert.strictEqual(observation.registryDigest, inventory.registryDigest);
    assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(sidecarPath(repo), "utf8"))).sort(),
      OBSERVATION_KEYS, "exactly six keys on disk");
  }));

test("a deleted entry is outside the comparison domain and contributes 0, not unknown", () => withRepo(async (repo) => {
  repo.write("kept.test.mjs", tagged(CLAUSE_A, "kept"));
  repo.write("gone.test.mjs", tagged(CLAUSE_A, "gone"));
  repo.putStore(storeWith([CLAUSE_A]));
  const oid = repo.commit();

  repo.remove("gone.test.mjs");                       // deleted alone: no residual on the head side
  repo.putStore(storeWith([CLAUSE_A]));

  await emitChangedTestInventory(request(repo, { baseTreeOid: oid }));
  const inventory = readArtifact(repo);
  assert.strictEqual(byPath(inventory.entries)["gone.test.mjs"].status, "deleted");
  assert.strictEqual(twoSidedEntryCount(inventory.entries), 0, "the only entry has one side");

  const observation = await observeInventoryTelemetry(request(repo, { baseTreeOid: oid }));
  assert.strictEqual(observation.oracleDepTriggered, 0, "a measurement over an empty domain, not an unknown");
}));

test("an EMPTY inventory observes 0", () => withRepo(async (repo) => {
  repo.write("stable.test.mjs", tagged(CLAUSE_A, "stable"));
  repo.write("README.md", "base\n");
  repo.putStore(storeWith([CLAUSE_A]));
  const oid = repo.commit();

  repo.write("README.md", "the world moved, but no test did\n");
  repo.putStore(storeWith([CLAUSE_A]));

  await emitChangedTestInventory(request(repo, { baseTreeOid: oid }));
  assert.deepStrictEqual(readArtifact(repo).entries, []);
  assert.strictEqual((await observeInventoryTelemetry(request(repo, { baseTreeOid: oid }))).oracleDepTriggered, 0);
}));

// --- 2. the digest notation, which is the whole of E1-S1 ----------------------------------------------

test("the pre-state check reads the loaded current TEXT digest, so a pretty-printed store file is accepted",
  () => withRepo(async (repo) => {
    repo.write("alpha.test.mjs", tagged(CLAUSE_A, "alpha"));
    repo.putStore(storeWith([CLAUSE_A]));
    const oid = repo.commit();

    // A byte form that is NOT canonicalStoreBytes: same parsed store, different text. This is the
    // discriminator, because canonicalText only strips a BOM and folds line endings -- a BOM/CRLF
    // variant of the canonical bytes can hash the same under both notations, and would prove nothing.
    repo.write("alpha.test.mjs", tagged(CLAUSE_A, "alpha", " /* edited */"));
    const store = repo.putStore(storeWith([CLAUSE_A]), { text: (s) => `${JSON.stringify(s, null, 2)}\n` });

    const onDisk = fs.readFileSync(path.join(repo.root, ...CANONICAL_STORE_PATH.split("/")), "utf8");
    assert.notStrictEqual(sha256Hex(onDisk), storeDigest(store),
      "the premise: the current-text digest and the canonical-object digest really do differ here");

    await emitChangedTestInventory(request(repo, { baseTreeOid: oid }));
    assert.strictEqual(readArtifact(repo).inputProvenanceStoreDigest, sha256Hex(onDisk),
      "the producer records the loaded-text notation");
    const observation = await observeInventoryTelemetry(request(repo, { baseTreeOid: oid }));
    assert.ok(Number.isSafeInteger(observation.oracleDepTriggered),
      "an implementation comparing the canonical-object digest would have refused this legal file");
  }));

test("observing AFTER the pre-state has moved refuses instead of recording a post-state measurement",
  () => withRepo(async (repo) => {
    repo.write("alpha.test.mjs", tagged(CLAUSE_A, "alpha"));
    repo.putStore(storeWith([CLAUSE_A]));
    const oid = repo.commit();
    repo.write("alpha.test.mjs", tagged(CLAUSE_A, "alpha", " /* edited */"));
    repo.putStore(storeWith([CLAUSE_A]));
    await emitChangedTestInventory(request(repo, { baseTreeOid: oid }));

    // Any advance of the store stands in for the committing write, which moves this digest by design.
    repo.putStore(storeWith([CLAUSE_A, CLAUSE_B]));
    const error = await refused(observeInventoryTelemetry(request(repo, { baseTreeOid: oid })),
      "a post-commit observation", "E_OBS_PRESTATE");
    assert.match(error.message, /Observe BEFORE the committing write/);
    assert.ok(!fs.existsSync(sidecarPath(repo)), "and nothing was published");
  }));

test("DECLARED CHILD INJECTION: a store mutated between the observer's own captures refuses before publication",
  () => withRepo(async (repo) => {
    repo.write("alpha.test.mjs", tagged(CLAUSE_A, "alpha"));
    repo.putStore(storeWith([CLAUSE_A]));
    const oid = repo.commit();
    repo.write("alpha.test.mjs", tagged(CLAUSE_A, "alpha", " /* edited */"));
    repo.putStore(storeWith([CLAUSE_A]));
    await emitChangedTestInventory(request(repo, { baseTreeOid: oid }));

    const report = runChild(repo, CHILD_SOURCE, { fault: "mutate-between-captures", baseTreeOid: oid });
    assert.strictEqual(report.ok, false, `expected a refusal, got ${JSON.stringify(report)}`);
    assert.strictEqual(report.code, "E_OBS_MUTATED", report.message);
    assert.ok(report.hits >= 2, "the store file really was read twice");
    assert.ok(!fs.existsSync(sidecarPath(repo)), "nothing is published when the recheck fails");
  }));

// --- 3. authority, witness and binding ------------------------------------------------------------------

test("the request, the task witness and the artifact must name ONE base tree", () => withRepo(async (repo) => {
  repo.write("alpha.test.mjs", tagged(CLAUSE_A, "alpha"));
  repo.putStore(storeWith([CLAUSE_A]));
  const oid = repo.commit();
  repo.write("alpha.test.mjs", tagged(CLAUSE_A, "alpha", " /* edited */"));
  repo.putStore(storeWith([CLAUSE_A]));
  await emitChangedTestInventory(request(repo, { baseTreeOid: oid }));

  await refused(observeInventoryTelemetry(request(repo, { baseTreeOid: "b".repeat(40) })),
    "a request naming another tree", "E_OBS_WITNESS");
  await refused(observeInventoryTelemetry(request(repo, { baseTreeOid: oid, taskId: "TASK-9" })),
    "an unknown task", "E_OBS_AUTHORITY");
}));

test("the raw base-store witness is checked, not assumed from treeOid equality", () => withRepo(async (repo) => {
  repo.write("alpha.test.mjs", tagged(CLAUSE_A, "alpha"));
  repo.putStore(storeWith([CLAUSE_A]));
  const oid = repo.commit();
  repo.write("alpha.test.mjs", tagged(CLAUSE_A, "alpha", " /* edited */"));
  repo.putStore(storeWith([CLAUSE_A]));
  await emitChangedTestInventory(request(repo, { baseTreeOid: oid }));

  // Everything about the tree is right; only the witness DIGEST is wrong. A treeOid-only check
  // passes this and a raw base-store read does not. The witness is charged at step 3, before the
  // pre-state digest this rewrite also moves.
  const store = storeWith([CLAUSE_A]);
  const withBadWitness = JSON.parse(JSON.stringify(store));
  withBadWitness.taskStates = [{
    taskId: TASK,
    baseProvenance: { treeOid: oid, storePath: CANONICAL_STORE_PATH, storeDigest: sha256Hex("not the base bytes") },
    currentTaskDpIds: [],
  }];
  fs.writeFileSync(path.join(repo.root, ...CANONICAL_STORE_PATH.split("/")),
    canonicalStoreBytes(withBadWitness), "utf8");

  const error = await refused(observeInventoryTelemetry(request(repo, { baseTreeOid: oid })),
    "a wrong raw base-store witness", "E_OBS_WITNESS");
  assert.match(error.message, /raw-byte digest/);
}));

test("an absent current store is an unavailable authority, not an empty one", () => withRepo(async (repo) => {
  repo.write("alpha.test.mjs", tagged(CLAUSE_A, "alpha"));
  repo.putStore(storeWith([CLAUSE_A]));
  const oid = repo.commit();
  repo.write("alpha.test.mjs", tagged(CLAUSE_A, "alpha", " /* edited */"));
  repo.putStore(storeWith([CLAUSE_A]));
  await emitChangedTestInventory(request(repo, { baseTreeOid: oid }));
  fs.rmSync(path.join(repo.root, ...CANONICAL_STORE_PATH.split("/")));

  await refused(observeInventoryTelemetry(request(repo, { baseTreeOid: oid })),
    "no current store", "E_OBS_AUTHORITY");
}));

test("an inventory entry that resolves to no declaration pair is refused, even for a disclosure metric",
  () => withRepo(async (repo) => {
    repo.write("alpha.test.mjs", tagged(CLAUSE_A, "alpha"));
    repo.putStore(storeWith([CLAUSE_A]));
    const oid = repo.commit();
    repo.write("alpha.test.mjs", tagged(CLAUSE_A, "alpha", " /* edited */"));
    repo.putStore(storeWith([CLAUSE_A]));
    await emitChangedTestInventory(request(repo, { baseTreeOid: oid }));

    // A FABRICATED entry in an otherwise canonical envelope: the digest is recomputed so the reader
    // accepts the document, and every top-level binding still matches discovery. Only the per-entry
    // pairing can catch it.
    const inventory = readArtifact(repo);
    const real = inventory.entries[0];
    const body = {
      inventoryVersion: 2,
      baseTreeOid: inventory.baseTreeOid,
      registryDigest: inventory.registryDigest,
      headViewDigest: inventory.headViewDigest,
      inputProvenanceStoreDigest: inventory.inputProvenanceStoreDigest,
      entries: [{ ...real, testRef: { ...real.testRef, path: "ghost.test.mjs" } }],
    };
    fs.writeFileSync(artifactPath(repo),
      `${canonicalJson({ ...body, inventoryDigest: computeInventoryV2Digest(body) })}\n`, "utf8");

    const error = await refused(observeInventoryTelemetry(request(repo, { baseTreeOid: oid })),
      "a fabricated entry", "E_OBS_PAIRING");
    assert.match(error.message, /ghost\.test\.mjs/);
  }));

test("DECLARED SOURCE COPY: a rich analysis that disagrees with discovery's projection is refused",
  () => withRepo(async (repo) => {
    repo.write("alpha.test.mjs", tagged(CLAUSE_A, "alpha"));
    repo.putStore(storeWith([CLAUSE_A]));
    const oid = repo.commit();
    repo.write("alpha.test.mjs", tagged(CLAUSE_A, "alpha", " /* edited */"));
    repo.putStore(storeWith([CLAUSE_A]));
    await emitChangedTestInventory(request(repo, { baseTreeOid: oid }));

    const report = runChild(repo, CHILD_SOURCE, { baseTreeOid: oid }, { perturbProjection: true });
    assert.strictEqual(report.ok, false, `expected a refusal, got ${JSON.stringify(report)}`);
    assert.strictEqual(report.code, "E_OBS_PROJECTION", report.message);
    assert.match(report.message, /does not equal discovery's projection/);
  }));

// --- 4. the sidecar --------------------------------------------------------------------------------------

test("the sidecar shape is closed at six keys: a seventh, a wrong version and a bad count are refused", () => {
  const good = {
    observationVersion: 1,
    inventoryDigest: "a".repeat(64),
    baseTreeOid: "b".repeat(40),
    headViewDigest: "c".repeat(64),
    registryDigest: "d".repeat(64),
    oracleDepTriggered: 2,
  };
  assert.deepStrictEqual(Object.keys(parseObservationText(JSON.stringify(good))).sort(), OBSERVATION_KEYS);

  const cases = [
    ["a seventh key", { ...good, capturedAt: 1 }, /must declare exactly/],
    ["a missing key", { ...good, registryDigest: undefined }, /must declare exactly/],
    ["a wrong version", { ...good, observationVersion: 2 }, /observationVersion must be the integer 1/],
    ["a non-integer count", { ...good, oracleDepTriggered: 1.5 }, /non-negative safe integer/],
    ["a negative count", { ...good, oracleDepTriggered: -1 }, /non-negative safe integer/],
    ["a short digest", { ...good, headViewDigest: "abc" }, /64 lowercase hex/],
  ];
  for (const [what, value, message] of cases) {
    let error = null;
    try { parseObservationText(JSON.stringify(value)); } catch (e) { error = e; }
    assert.ok(error, `${what}: expected a refusal`);
    assert.strictEqual(error.code, "E_OBS_SIDECAR", `${what}: ${error.message}`);
    assert.match(error.message, message, what);
  }
});

test("a bound read refuses a contradictory field and a count above the two-sided domain", () => withRepo(async (repo) => {
  repo.write("alpha.test.mjs", tagged(CLAUSE_A, "alpha"));
  repo.putStore(storeWith([CLAUSE_A]));
  const oid = repo.commit();
  repo.write("alpha.test.mjs", tagged(CLAUSE_A, "alpha", " /* edited */"));
  repo.putStore(storeWith([CLAUSE_A]));
  await emitChangedTestInventory(request(repo, { baseTreeOid: oid }));
  await observeInventoryTelemetry(request(repo, { baseTreeOid: oid }));

  const inventory = readArtifact(repo);
  const sidecar = JSON.parse(fs.readFileSync(sidecarPath(repo), "utf8"));
  assert.deepStrictEqual(readBoundObservation(repo.root, inventory).oracleDepTriggered, sidecar.oracleDepTriggered);

  // ONE field contradicts while the other three still match: a reader that checked only the digest
  // it happened to look at first would accept this.
  fs.writeFileSync(sidecarPath(repo),
    `${canonicalJson({ ...sidecar, registryDigest: "e".repeat(64) })}\n`, "utf8");
  let error = null;
  try { readBoundObservation(repo.root, inventory); } catch (e) { error = e; }
  assert.strictEqual(error && error.code, "E_OBS_BINDING", error && error.message);

  fs.writeFileSync(sidecarPath(repo),
    `${canonicalJson({ ...sidecar, oracleDepTriggered: twoSidedEntryCount(inventory.entries) + 1 })}\n`, "utf8");
  let bound = null;
  try { readBoundObservation(repo.root, inventory); } catch (e) { bound = e; }
  assert.strictEqual(bound && bound.code, "E_OBS_BOUND", bound && bound.message);
}));

// --- 4a. parent containment on the READ paths (§C.2) ---------------------------------------------------
//
// Distinct from the leaf cases below: a leaf lstat refuses a symlinked FILE but says nothing about
// `.ctide/output` itself. A junction there resolves during the open, so a perfectly regular,
// correctly bound file outside the repository would otherwise be read and accepted.

// Move the whole output directory outside the repository and put a junction in its place, so every
// path under `.ctide/output` still resolves — to somewhere else entirely.
function redirectOutputDir(repo) {
  const outputDir = path.dirname(artifactPath(repo));
  const elsewhere = checkedTempRoot(
    fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ctide-obs-elsewhere-"))), "ctide-obs-elsewhere-");
  fs.cpSync(outputDir, elsewhere, { recursive: true });
  fs.rmSync(outputDir, { recursive: true, force: true });
  try {
    fs.symlinkSync(elsewhere, outputDir, "junction");
  } catch (error) {
    fs.rmSync(elsewhere, { recursive: true, force: true });
    return { linked: false, reason: String(error && error.message) };
  }
  return { linked: true, elsewhere, outputDir };
}

test("a junction at .ctide/output refuses the ARTIFACT read before it happens, not after the bytes are taken",
  async (t) => {
    await withRepo(async (repo) => {
      repo.write("alpha.test.mjs", tagged(CLAUSE_A, "alpha"));
      repo.putStore(storeWith([CLAUSE_A]));
      const oid = repo.commit();
      repo.write("alpha.test.mjs", tagged(CLAUSE_A, "alpha", " /* edited */"));
      repo.putStore(storeWith([CLAUSE_A]));
      await emitChangedTestInventory(request(repo, { baseTreeOid: oid }));
      await observeInventoryTelemetry(request(repo, { baseTreeOid: oid }));

      const redirected = redirectOutputDir(repo);
      if (!redirected.linked) {
        t.skip(`this platform does not permit creating a directory junction: ${redirected.reason}`);
        return;
      }
      try {
        const outsideArtifact = path.join(redirected.elsewhere, path.basename(artifactPath(repo)));
        const outsideSidecar = path.join(redirected.elsewhere, path.basename(sidecarPath(repo)));
        const artifactBefore = fs.readFileSync(outsideArtifact);
        const sidecarBefore = fs.readFileSync(outsideSidecar);
        assert.ok(fs.existsSync(artifactPath(repo)),
          "the premise: every path under the junction still resolves, to a regular valid file");

        const report = runChild(repo, READ_COUNTER_CHILD,
          { baseTreeOid: oid, countedPath: artifactPath(repo) });
        assert.strictEqual(report.ok, false, `expected a refusal, got ${JSON.stringify(report)}`);
        assert.strictEqual(report.code, "E_OBS_TARGET", report.message);
        assert.match(report.message, /symbolic link|not a directory/);
        assert.strictEqual(report.reads, 0,
          "the artifact was never opened: the refusal precedes the read rather than following it");

        assert.deepStrictEqual(fs.readFileSync(outsideArtifact), artifactBefore, "outside bytes untouched");
        assert.deepStrictEqual(fs.readFileSync(outsideSidecar), sidecarBefore, "and so is the previous sidecar");
      } finally {
        fs.unlinkSync(redirected.outputDir);
        fs.rmSync(redirected.elsewhere, { recursive: true, force: true });
      }
    });
  });

test("a junction at .ctide/output refuses the SIDECAR read, however valid and correctly bound the file is",
  async (t) => {
    await withRepo(async (repo) => {
      repo.write("alpha.test.mjs", tagged(CLAUSE_A, "alpha"));
      repo.putStore(storeWith([CLAUSE_A]));
      const oid = repo.commit();
      repo.write("alpha.test.mjs", tagged(CLAUSE_A, "alpha", " /* edited */"));
      repo.putStore(storeWith([CLAUSE_A]));
      await emitChangedTestInventory(request(repo, { baseTreeOid: oid }));
      const inventory = readArtifact(repo);
      await observeInventoryTelemetry(request(repo, { baseTreeOid: oid }));
      // The premise: through the real directory this sidecar reads and binds cleanly.
      assert.ok(Number.isSafeInteger(readBoundObservation(repo.root, inventory).oracleDepTriggered));

      const redirected = redirectOutputDir(repo);
      if (!redirected.linked) {
        t.skip(`this platform does not permit creating a directory junction: ${redirected.reason}`);
        return;
      }
      try {
        let error = null;
        try { readBoundObservation(repo.root, inventory); } catch (e) { error = e; }
        assert.ok(error, "a regular, correctly bound sidecar reached through a junction is still refused");
        assert.strictEqual(error.code, "E_OBS_TARGET", error.message);
      } finally {
        fs.unlinkSync(redirected.outputDir);
        fs.rmSync(redirected.elsewhere, { recursive: true, force: true });
      }
    });
  });

test("a redirected or non-regular sidecar is refused on the READ path too", () => withRepo(async (repo) => {
  repo.write("alpha.test.mjs", tagged(CLAUSE_A, "alpha"));
  repo.putStore(storeWith([CLAUSE_A]));
  const oid = repo.commit();
  repo.write("alpha.test.mjs", tagged(CLAUSE_A, "alpha", " /* edited */"));
  repo.putStore(storeWith([CLAUSE_A]));
  await emitChangedTestInventory(request(repo, { baseTreeOid: oid }));
  const inventory = readArtifact(repo);

  fs.mkdirSync(sidecarPath(repo), { recursive: true });          // a directory where a file must be
  let error = null;
  try { readBoundObservation(repo.root, inventory); } catch (e) { error = e; }
  assert.strictEqual(error && error.code, "E_OBS_TARGET", error && error.message);
}));

test("a failed observation leaves a previous sidecar byte-identical and no temp behind", () => withRepo(async (repo) => {
  repo.write("alpha.test.mjs", tagged(CLAUSE_A, "alpha"));
  repo.putStore(storeWith([CLAUSE_A]));
  const oid = repo.commit();
  repo.write("alpha.test.mjs", tagged(CLAUSE_A, "alpha", " /* edited */"));
  repo.putStore(storeWith([CLAUSE_A]));
  await emitChangedTestInventory(request(repo, { baseTreeOid: oid }));
  await observeInventoryTelemetry(request(repo, { baseTreeOid: oid }));
  const before = fs.readFileSync(sidecarPath(repo));

  // The store advances, so the pre-state check refuses before anything is staged.
  repo.putStore(storeWith([CLAUSE_A, CLAUSE_B]));
  await refused(observeInventoryTelemetry(request(repo, { baseTreeOid: oid })), "a refused observation");

  assert.deepStrictEqual(fs.readFileSync(sidecarPath(repo)), before, "the previous sidecar is untouched");
  const residue = fs.readdirSync(path.dirname(sidecarPath(repo))).filter((f) => f.endsWith(".tmp"));
  assert.deepStrictEqual(residue, [], "and no staging file is left behind");
}));

// --- 5. the request contract and the CLI -------------------------------------------------------------------

test("the request is exactly three keys and accepts no path, snapshot or hook", async () => {
  for (const [what, req] of [
    ["an artifact path", { repoRoot: "/x", baseTreeOid: "a".repeat(40), taskId: TASK, artifactPath: "/tmp/x" }],
    ["a missing task", { repoRoot: "/x", baseTreeOid: "a".repeat(40) }],
    ["a snapshot", { repoRoot: "/x", baseTreeOid: "a".repeat(40), taskId: TASK, snapshot: {} }],
    ["an empty task", { repoRoot: "/x", baseTreeOid: "a".repeat(40), taskId: "" }],
  ]) {
    await refused(observeInventoryTelemetry(req), what, "E_API_ARGUMENTS");
  }
  let twoArgs = null;
  try {
    await observeInventoryTelemetry({ repoRoot: "/x", baseTreeOid: "a".repeat(40), taskId: TASK }, {});
  } catch (e) { twoArgs = e; }
  assert.strictEqual(twoArgs && twoArgs.code, "E_API_ARGUMENTS", "a second argument is refused");
});

// Values are captured once after the own-key check, so nothing this operation names can change across
// its many awaits — and the key check itself must see own keys, not merely the enumerable string ones.

test("each owned request value is read exactly once", () => withRepo(async (repo) => {
  repo.write("stable.test.mjs", tagged(CLAUSE_A, "stable"));
  repo.write("README.md", "base\n");
  repo.putStore(storeWith([CLAUSE_A]));
  const oid = repo.commit();
  repo.write("README.md", "the world moved, but no test did\n");
  repo.putStore(storeWith([CLAUSE_A]));
  await emitChangedTestInventory(request(repo, { baseTreeOid: oid }));

  const counts = { repoRoot: 0, baseTreeOid: 0, taskId: 0 };
  const values = { repoRoot: repo.root, baseTreeOid: oid, taskId: TASK };
  const req = {};
  for (const name of Object.keys(values)) {
    Object.defineProperty(req, name, {
      enumerable: true,
      configurable: true,
      get() { counts[name] += 1; return values[name]; },
    });
  }
  const observation = await observeInventoryTelemetry(req);
  assert.deepStrictEqual(counts, { repoRoot: 1, baseTreeOid: 1, taskId: 1 });
  assert.strictEqual(observation.oracleDepTriggered, 0, "and the ordinary observation is unaffected");
}));

test("hidden and symbol own keys are refused before any capture", async () => {
  const base = () => ({ repoRoot: "/x", baseTreeOid: "a".repeat(40), taskId: TASK });

  const hidden = base();
  Object.defineProperty(hidden, "snapshot", { value: {}, enumerable: false, configurable: true });
  assert.deepStrictEqual(Object.keys(hidden).sort(), ["baseTreeOid", "repoRoot", "taskId"],
    "invisible to the enumerable view");
  const hiddenError = await refused(observeInventoryTelemetry(hidden), "a non-enumerable snapshot", "E_API_ARGUMENTS");
  assert.match(hiddenError.message, /"snapshot"/);

  const symbolled = base();
  symbolled[Symbol("snapshot")] = {};
  const symbolError = await refused(observeInventoryTelemetry(symbolled), "a symbol own key", "E_API_ARGUMENTS");
  assert.ok(!(symbolError instanceof TypeError), "a typed refusal, not an engine error");
  assert.match(symbolError.message, /Symbol\(snapshot\)/);
});

test("the CLI parser is strict and every fault is E_API_ARGUMENTS", () => {
  const valid = ["node", "s", "--cwd", "/x", "--base-tree", "a".repeat(40), "--task", TASK];
  assert.deepStrictEqual(parseObserverArgs(valid), { cwd: "/x", "base-tree": "a".repeat(40), task: TASK });
  const cases = [
    ["an unknown flag", [...valid, "--inventory", "x"], /unknown flag --inventory/],
    ["a bare positional", [...valid, "extra"], /unexpected argument "extra"/],
    ["a repeated flag", [...valid, "--task", "T2"], /--task was given more than once/],
    ["a value-less flag", ["node", "s", "--base-tree", "a".repeat(40), "--task"], /--task requires a value/],
    ["a flag swallowing a flag", ["node", "s", "--task", "--base-tree", "a".repeat(40)], /--task requires a value/],
    ["an empty value", ["node", "s", "--base-tree", "a".repeat(40), "--task", ""], /--task was given an empty value/],
    ["a missing --task", ["node", "s", "--base-tree", "a".repeat(40)], /--task is required/],
    ["a missing --base-tree", ["node", "s", "--task", TASK], /--base-tree is required/],
    ["no arguments", ["node", "s"], /--base-tree is required/],
  ];
  for (const [what, argv, message] of cases) {
    let error = null;
    try { parseObserverArgs(argv); } catch (e) { error = e; }
    assert.ok(error, `${what}: expected a refusal`);
    assert.strictEqual(error.code, "E_API_ARGUMENTS", `${what}: ${error.message}`);
    assert.match(error.message, message, what);
  }
});

test("the observer CLI emits JSON on stdout with exit 0, and JSON on stderr with exit 1", () => withRepo(async (repo) => {
  repo.write("alpha.test.mjs", tagged(CLAUSE_A, "alpha"));
  repo.putStore(storeWith([CLAUSE_A]));
  const oid = repo.commit();
  repo.write("alpha.test.mjs", tagged(CLAUSE_A, "alpha", " /* edited */"));
  repo.putStore(storeWith([CLAUSE_A]));
  await emitChangedTestInventory(request(repo, { baseTreeOid: oid }));

  const run = (args) => cp.spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
  const ok = run(["--cwd", repo.root, "--base-tree", oid, "--task", TASK]);
  assert.strictEqual(ok.status, 0, `expected exit 0, got ${ok.status} (${ok.stderr})`);
  const body = JSON.parse(ok.stdout.trim());
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.observationVersion, 1);
  assert.ok(Number.isSafeInteger(body.oracleDepTriggered));

  const bad = run(["--cwd", repo.root, "--base-tree", "0".repeat(40), "--task", TASK]);
  assert.strictEqual(bad.status, 1, "a refusal exits 1");
  assert.strictEqual(bad.stdout, "", "and says nothing on stdout");
  const err = JSON.parse(bad.stderr.trim().split("\n").pop());
  assert.strictEqual(err.ok, false);
  assert.strictEqual(err.code, "E_OBS_WITNESS", err.message);

  const args = run(["--cwd", repo.root, "--task", TASK]);
  assert.strictEqual(args.status, 1);
  assert.strictEqual(JSON.parse(args.stderr.trim()).code, "E_API_ARGUMENTS");
}));
