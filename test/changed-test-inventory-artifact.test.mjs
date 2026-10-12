// The artifact-emission operation: canonical output, the two independent protections it owes, and
// exactly what each failure leaves on disk.
//
// SCOPE. A green run here proves the EMITTER. It does not wire Step 6, does not make Phase 2 READY,
// and asserts nothing about convergence.
//
// Spec anchors:
//   TP §11b.10c:3366-3373 — the producer writes nothing under .ctide/output/** and yields no partial
//     envelope, which is why emission is a separate operation
//   TP §11b.10:2177, 2212 — .ctide/output/** is hard-excluded from the head view, so emission cannot
//     perturb the digests the envelope declares
//   references/verification-gate.md, Artifact Hygiene — the first write under .ctide/output/ creates a
//     top-level .gitignore of `*` then `!.gitignore`
//
// FAULT INJECTION, and exactly how honest each case is about it. Three mechanisms, in order of
// preference:
//
//   1. the FILESYSTEM itself -- a directory where a file must go, a symlinked parent, a pre-existing
//      guard. No interception at all; these are the strongest cases and most of the suite uses them.
//   2. an ISOLATED CHILD PROCESS that imports the SHIPPED emitter unmodified and patches only its own
//      process's `node:fs`, scoped by path to this invocation's own staging file. No shipped source
//      is modified or copied, and the product carries no test hook. This is the only way to reach a
//      write/fsync/re-read/rename failure at all, and every such case asserts that the intended fault
//      point was hit EXACTLY ONCE -- a case that silently stops reaching its fault would otherwise
//      keep passing forever.
//   3. DECLARED NAME INJECTION, in the same child: `crypto.randomBytes` is pinned so the child knows
//      the staging name in advance. It has to be, because a randomised name cannot be collided with
//      from outside -- that is the point of it. The emitter's REAL exclusive open still runs, and the
//      colliding entries are real files, hard links and symlinks; only the name is predictable.
//
// What this suite does NOT claim: that two emissions were observed staging simultaneously. Everything
// after the producer's await is synchronous, so within one process the staging block cannot interleave
// with itself. The concurrency case at the end is a regression control on unique naming, nothing more.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cp from "node:child_process";

import { root } from "./helpers.mjs";
import {
  emptyStore, canonicalStoreBytes, storeDigest, CANONICAL_STORE_PATH,
} from "../cressetide/skills/vigil/scripts/provenance-store.mjs";
import { canonicalJson } from "../cressetide/skills/vigil/scripts/canonical-json.mjs";
import {
  INVENTORY_PATH, parseCanonicalInventoryV2,
} from "../cressetide/skills/vigil/scripts/changed-test-inventory.mjs";
import {
  emitChangedTestInventory, InventoryArtifactError,
} from "../cressetide/skills/vigil/scripts/changed-test-inventory-artifact.mjs";

const SCRIPT = path.join(root, "cressetide", "skills", "vigil", "scripts", "changed-test-inventory-artifact.mjs");
const TASK = "TASK-1";

function checkedTempRoot(dir, prefix) {
  const parent = fs.realpathSync(os.tmpdir());
  const resolved = path.resolve(dir);
  assert.strictEqual(path.dirname(resolved), parent, `refusing ${resolved}: not a direct temp child`);
  assert.ok(path.basename(resolved).startsWith(prefix), `refusing ${resolved}: wrong prefix`);
  return resolved;
}

// A real repository with a real base tree and a current store whose TaskState witnesses it, which is
// the minimum the producer requires before it will return an envelope at all.
function makeRepo(prefix = "ctide-emit-", extraTaskIds = []) {
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
  write("test/alpha.test.mjs", 'import { test } from "node:test";\ntest("alpha", () => {});\n');
  write("README.md", "base\n");
  git("add", "-A");
  git("commit", "-qm", "base");
  const baseTreeOid = git("rev-parse", "HEAD^{tree}");
  const store = { ...emptyStore() };
  const baseProvenance = {
    treeOid: baseTreeOid, storePath: CANONICAL_STORE_PATH, storeDigest: storeDigest(emptyStore()),
  };
  store.taskStates = [TASK, ...extraTaskIds].sort()
    .map((taskId) => ({ taskId, baseProvenance, currentTaskDpIds: [] }));
  write(CANONICAL_STORE_PATH, canonicalStoreBytes(store));
  return { root: dir, prefix, git, write, baseTreeOid };
}

async function withRepo(body, prefix = "ctide-emit-", extraTaskIds = []) {
  const repo = makeRepo(prefix, extraTaskIds);
  try {
    return await body(repo);
  } finally {
    fs.rmSync(checkedTempRoot(repo.root, repo.prefix), { recursive: true, force: true });
  }
}

const request = (repo, over = {}) => ({
  repoRoot: repo.root, baseTreeOid: repo.baseTreeOid, taskId: TASK, ...over,
});
const artifactPath = (repo) => path.join(repo.root, INVENTORY_PATH);
const ignorePath = (repo) => path.join(repo.root, path.dirname(INVENTORY_PATH), ".gitignore");

async function refused(promise, what, code) {
  let error = null;
  try { await promise; } catch (e) { error = e; }
  assert.ok(error && error.code, `${what}: expected a coded failure, got ${error}`);
  if (code) assert.strictEqual(error.code, code, `${what}: expected ${code}, got ${error.code} (${error.message})`);
  return error;
}

// --- the isolated child harness ---------------------------------------------------------------------
//
// Written to its own checked temp directory, never into the repository under test and never into the
// shipped tree. It imports the real emitter by absolute URL AFTER patching its own `node:fs`, so the
// module it exercises is the shipped one, byte for byte.
//
// Two things the patches must get right or the case proves nothing:
//   * `writeFileSync`/`fsyncSync` are handed a DESCRIPTOR, not a name, so the child remembers what
//     each descriptor was opened as. Without that, faulting "a write" would also fault the hygiene
//     guard and everything the producer reads, and the case would pass for the wrong reason.
//   * every predicate is scoped to THIS invocation's staging path, which is knowable only because the
//     name is pinned. That pinning is the declared interception, and it is the whole of it.
const CHILD_PREFIX = "ctide-emit-child-";
const CHILD_SOURCE = `import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const config = JSON.parse(process.argv[2]);
let hits = 0;

// DECLARED NAME INJECTION. The emitter randomises its staging suffix per attempt; this returns a
// scripted sequence instead, so the child can plant a collision at a name it knows. Anything the
// emitter or the producer asks for beyond the script gets real randomness.
const scripted = [...(config.nameHexes || [])];
const realRandomBytes = crypto.randomBytes;
crypto.randomBytes = function (size, callback) {
  if (callback === undefined && size === 8 && scripted.length > 0) return Buffer.from(scripted.shift(), "hex");
  return realRandomBytes.call(crypto, size, callback);
};
const tempFor = (hex) => path.join(config.outputDir, ".changed-test-inventory." + process.pid + "." + hex + ".tmp");
const temporary = (config.nameHexes || []).length > 0 ? tempFor(config.nameHexes[0]) : null;
const IGNORE = path.join(config.outputDir, ".gitignore");
const isTemp = (p) => temporary !== null && path.resolve(String(p)) === temporary;

const boom = (syscall, code) => {
  const error = new Error(code + ": injected " + syscall + " failure");
  error.code = code;
  error.syscall = syscall;
  return error;
};

const opened = new Map();
const realOpenSync = fs.openSync;
fs.openSync = function (file, ...rest) {
  const resolved = path.resolve(String(file));
  if (config.fault === "open" && isTemp(resolved)) { hits += 1; throw boom("open", "EACCES"); }
  if (resolved === IGNORE
      && (config.fault === "ignore-eexist-always" || (config.fault === "ignore-eexist-once" && hits === 0))) {
    hits += 1;
    throw boom("open", "EEXIST");
  }
  const fd = realOpenSync.call(fs, file, ...rest);
  opened.set(fd, resolved);
  return fd;
};
const isTempFd = (fd) => typeof fd === "number" && isTemp(opened.get(fd) || "");

if (config.fault === "write") {
  const real = fs.writeFileSync;
  fs.writeFileSync = function (file, data, options) {
    if (isTempFd(file)) { hits += 1; throw boom("write", "EIO"); }
    return real.call(fs, file, data, options);
  };
}
if (config.fault === "fsync") {
  const real = fs.fsyncSync;
  fs.fsyncSync = function (fd) {
    if (isTempFd(fd)) { hits += 1; throw boom("fsync", "EIO"); }
    return real.call(fs, fd);
  };
}
if (config.fault === "read" || config.fault === "malformed" || config.fault === "digest") {
  const real = fs.readFileSync;
  fs.readFileSync = function (file, options) {
    if (isTemp(file)) {
      hits += 1;
      if (config.fault === "read") throw boom("read", "EIO");
      if (config.fault === "malformed") return "{ this is not a document";
      return config.substituteText;
    }
    return real.call(fs, file, options);
  };
}
if (config.fault === "rename") {
  const real = fs.renameSync;
  fs.renameSync = function (from, to) {
    if (isTemp(from)) { hits += 1; throw boom("rename", "EXDEV"); }
    return real.call(fs, from, to);
  };
}

// REAL collision entries at the pinned name. The emitter's own exclusive open is what has to refuse
// them; nothing here stubs the open itself.
if (config.collide) {
  try {
    fs.mkdirSync(config.outputDir, { recursive: true });
    if (config.collide === "file") fs.writeFileSync(temporary, config.collideBody, "utf8");
    if (config.collide === "hardlink") fs.linkSync(config.peer, temporary);
    if (config.collide === "symlink") fs.symlinkSync(config.peer, temporary, "file");
    if (config.collide === "dir") fs.mkdirSync(temporary);
  } catch (error) {
    process.stdout.write(JSON.stringify({ setupFailed: String(error && error.message) }) + "\\n");
    process.exit(0);
  }
}

const { emitChangedTestInventory } = await import(pathToFileURL(config.emitter).href);
let outcome;
try {
  const result = await emitChangedTestInventory({
    repoRoot: config.repoRoot, baseTreeOid: config.baseTreeOid, taskId: config.taskId,
  });
  outcome = { ok: true, result };
} catch (error) {
  outcome = { ok: false, code: error && error.code, message: error && error.message };
}
process.stdout.write(JSON.stringify({ ...outcome, hits, temporary }) + "\\n");
`;

// Runs one child case and returns its report. A non-zero child exit is a harness failure, not a
// result: the emitter's refusals are reported IN the JSON, so the child itself always exits 0.
function runChild(repo, config) {
  const dir = checkedTempRoot(
    fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), CHILD_PREFIX))), CHILD_PREFIX);
  try {
    const file = path.join(dir, "emit-child.mjs");
    fs.writeFileSync(file, CHILD_SOURCE, "utf8");
    const payload = {
      emitter: SCRIPT,
      repoRoot: repo.root,
      baseTreeOid: repo.baseTreeOid,
      taskId: TASK,
      outputDir: path.dirname(artifactPath(repo)),
      ...config,
    };
    const proc = cp.spawnSync(process.execPath, [file, JSON.stringify(payload)], { encoding: "utf8" });
    assert.strictEqual(proc.status, 0, `the child harness itself failed: ${proc.stderr}`);
    return JSON.parse(proc.stdout.trim().split("\n").pop());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const tempResidue = (repo) => fs.readdirSync(path.dirname(artifactPath(repo))).filter((f) => f.endsWith(".tmp"));

// The same name for all three attempts, so a collision cannot simply be retried past. Scripting fewer
// names than that would let the emitter fall back to real randomness and succeed on a fresh name --
// which is the correct behaviour, and is exactly what the retry case below asserts instead.
const pinned = (hex) => [hex, hex, hex];

// --- 1. the happy path ------------------------------------------------------------------------------

test("canonical output: the bytes on disk re-read through the canonical authority as the returned digest", async () => {
  await withRepo(async (repo) => {
    const result = await emitChangedTestInventory(request(repo));
    assert.deepStrictEqual(Object.keys(result).sort(), ["inventoryDigest", "path"], "minimal return");
    assert.ok(Object.isFrozen(result), "and it is frozen");
    assert.strictEqual(result.path, artifactPath(repo));

    const text = fs.readFileSync(result.path, "utf8");
    const reparsed = parseCanonicalInventoryV2(text);
    assert.strictEqual(reparsed.inventoryDigest, result.inventoryDigest,
      "the returned digest is the digest of the bytes that were actually written");
    assert.strictEqual(text, `${canonicalJson(reparsed)}\n`,
      "and those bytes are the canonical serialization, not an incidental JSON.stringify");

    // The hygiene guard exists after the FIRST write under .ctide/output/.
    assert.strictEqual(fs.readFileSync(ignorePath(repo), "utf8"), "*\n!.gitignore\n",
      "verification-gate.md's footgun guard is created by the first writer");
    assert.ok(fs.lstatSync(ignorePath(repo)).isFile());

    // No temp residue.
    const left = fs.readdirSync(path.dirname(result.path)).sort();
    assert.deepStrictEqual(left, [".gitignore", "changed-test-inventory.json"], "no temp file survives");
  });
});

test("overwrite: a second emission replaces the artifact and leaves an existing ignore file untouched", async () => {
  await withRepo(async (repo) => {
    const first = await emitChangedTestInventory(request(repo));
    // A pre-existing ignore file with extra operator content must survive byte-identically.
    const custom = "*\n!.gitignore\n# kept by the operator\n";
    fs.writeFileSync(ignorePath(repo), custom, "utf8");

    // Move the WORLD without adding a test: an untagged new test file would be refused by the
    // producer's own post-binding rule, which is a different fact from the one under test here.
    // A non-test file still changes headViewDigest, so the envelope's digest moves.
    repo.write("README.md", "base, moved\n");
    const second = await emitChangedTestInventory(request(repo));
    assert.notStrictEqual(second.inventoryDigest, first.inventoryDigest, "the world moved, so the digest moved");
    assert.strictEqual(parseCanonicalInventoryV2(fs.readFileSync(second.path, "utf8")).inventoryDigest,
      second.inventoryDigest, "the newer document is the one on disk");
    assert.strictEqual(fs.readFileSync(ignorePath(repo), "utf8"), custom,
      "an existing regular ignore file is never rewritten or appended to");
  });
});

// --- 2. producer failure writes nothing -------------------------------------------------------------

test("a failed derivation writes NOTHING — not the artifact, not the directory, not the guard", async () => {
  await withRepo(async (repo) => {
    const outputDir = path.dirname(artifactPath(repo));
    assert.ok(!fs.existsSync(outputDir), "the output tree does not exist yet");

    // A base tree oid that is not an object in this repository: the producer refuses before emission
    // has done anything at all.
    await refused(emitChangedTestInventory(request(repo, { baseTreeOid: "0".repeat(40) })),
      "an unresolvable base tree", "E_BASE_TREE_OID");
    assert.ok(!fs.existsSync(outputDir),
      "producer-first ordering: a failed derivation cannot even create the output directory");
  });
});

test("a failed derivation leaves a PREVIOUS artifact byte-identical", async () => {
  await withRepo(async (repo) => {
    const good = await emitChangedTestInventory(request(repo));
    const before = fs.readFileSync(good.path);
    const ignoreBefore = fs.readFileSync(ignorePath(repo));

    await refused(emitChangedTestInventory(request(repo, { baseTreeOid: "0".repeat(40) })),
      "a later failed derivation", "E_BASE_TREE_OID");
    assert.deepStrictEqual(fs.readFileSync(good.path), before, "the previous artifact is byte-identical");
    assert.deepStrictEqual(fs.readFileSync(ignorePath(repo)), ignoreBefore, "and so is the guard");
    assert.deepStrictEqual(fs.readdirSync(path.dirname(good.path)).sort(),
      [".gitignore", "changed-test-inventory.json"], "no temp residue from the failed attempt");
  });
});

// --- 3. the EARLY target guard ----------------------------------------------------------------------
//
// This case is about the target-type check at the top of step 4, which refuses BEFORE anything is
// staged. It is deliberately not evidence about publication: no artifact is deleted and restored here,
// and nothing about late I/O is claimed. The genuine late failures are in section 4, in children.

test("a target that is not a regular file is refused BEFORE anything is staged", async () => {
  await withRepo(async (repo) => {
    // Filesystem-only injection: a DIRECTORY standing where the artifact must be. Nothing is
    // intercepted, and no earlier artifact exists to be confused with preservation.
    const target = artifactPath(repo);
    fs.mkdirSync(target, { recursive: true });
    const inside = path.join(target, "not-ours.txt");
    fs.writeFileSync(inside, "a directory the emitter must not touch\n", "utf8");

    const error = await refused(emitChangedTestInventory(request(repo)),
      "a target that is not a regular file", "E_ARTIFACT_TARGET");
    assert.match(error.message, /not a regular file/);

    assert.ok(fs.lstatSync(target).isDirectory(), "the entry that was in the way is left exactly as it was");
    assert.strictEqual(fs.readFileSync(inside, "utf8"), "a directory the emitter must not touch\n");
    // The guard is created in step 3, before this refusal, and is deliberately left behind: by then it
    // may already be covering other run residue, so removing it would be the worse outcome.
    assert.strictEqual(fs.readFileSync(ignorePath(repo), "utf8"), "*\n!.gitignore\n",
      "the protective guard survives the refusal");
    assert.deepStrictEqual(tempResidue(repo), [], "and staging never began, so there is no temp file");
  });
});

// --- 4. genuinely reached late failures, in isolated children -----------------------------------------
//
// Each case below reaches a fault point the filesystem cannot be talked into on its own. Every one
// asserts the point was hit EXACTLY ONCE, that the refusal carries the intended typed cause, that the
// artifact already on disk is BYTE-IDENTICAL afterwards, and that the operation's own temp is gone.

const LATE_FAULTS = [
  ["a write failure", "write", "E_ARTIFACT_IO", /staging the artifact failed/],
  ["an fsync failure", "fsync", "E_ARTIFACT_IO", /staging the artifact failed/],
  ["a re-read failure", "read", "E_ARTIFACT_IO", /cannot re-read the staged artifact/],
  // The duplicate-member scanner reads the raw document before JSON.parse ever sees it, so this is
  // its message, not V8's -- which is the point: the canonical reader's own refusal survives.
  ["a re-read that is not a document", "malformed", "E_JSON", /expected a string at offset 2/],
  ["a publish failure", "rename", "E_ARTIFACT_IO", /cannot publish the artifact/],
];

for (const [what, fault, code, message] of LATE_FAULTS) {
  test(`${what} keeps the old artifact byte-identical, removes its own temp, and keeps the guard`, async () => {
    await withRepo(async (repo) => {
      const good = await emitChangedTestInventory(request(repo));
      const before = fs.readFileSync(good.path);
      const ignoreBefore = fs.readFileSync(ignorePath(repo));

      // Move the world so the child's envelope really would differ from what is on disk: if the old
      // bytes survive, they survive because nothing overwrote them, not because they were identical.
      repo.write("README.md", `base, moved for ${fault}\n`);
      const report = runChild(repo, { fault, nameHexes: ["a1a1a1a1a1a1a1a1"] });

      assert.strictEqual(report.ok, false, `${what}: expected a refusal, got ${JSON.stringify(report)}`);
      assert.strictEqual(report.hits, 1, `${what}: the fault point must be reached exactly once`);
      assert.strictEqual(report.code, code, `${what}: ${report.message}`);
      assert.match(report.message, message);

      assert.deepStrictEqual(fs.readFileSync(good.path), before, "the previous artifact is byte-identical");
      assert.deepStrictEqual(fs.readFileSync(ignorePath(repo)), ignoreBefore, "and so is the guard");
      assert.deepStrictEqual(tempResidue(repo), [], "the operation removed the temp it created");
      assert.ok(!fs.existsSync(report.temporary), "including under its exact staging name");
    });
  });
}

test("a re-read that is a VALID v2 document with a different digest is refused as a re-read mismatch", async () => {
  await withRepo(async (repo) => {
    // The substituted bytes are a real artifact from an earlier world, so the canonical parser accepts
    // them completely and only the digest comparison can catch the substitution.
    const first = await emitChangedTestInventory(request(repo));
    const substituteText = fs.readFileSync(first.path, "utf8");

    repo.write("README.md", "base, moved for the digest case\n");
    const report = runChild(repo, { fault: "digest", substituteText, nameHexes: ["b2b2b2b2b2b2b2b2"] });

    assert.strictEqual(report.ok, false);
    assert.strictEqual(report.hits, 1, "the re-read happened exactly once");
    assert.strictEqual(report.code, "E_ARTIFACT_REREAD", report.message);
    assert.match(report.message, new RegExp(`re-reads as inventoryDigest ${first.inventoryDigest}`));
    assert.strictEqual(fs.readFileSync(first.path, "utf8"), substituteText,
      "the artifact on disk is untouched: a document that re-read as something else is never published");
    assert.deepStrictEqual(tempResidue(repo), [], "and the temp is gone");
  });
});

// --- 5. collisions at the staging name, with the name declared to the child ---------------------------
//
// A1 in its original form: the name was `${pid}.tmp`, the open was `w`, and cleanup deleted whatever
// stood at that path. A hard link there had its peer OUTSIDE the output directory truncated, the peer
// was then published as this run's artifact, and the call returned success.

test("a pre-existing HARD LINK at the staging name is refused, and its peer outside the output keeps its bytes",
  async () => {
    await withRepo(async (repo) => {
      const peer = path.join(repo.root, "peer-outside-output.txt");
      const peerBody = "a neighbour's file, nothing to do with this run\n";
      fs.writeFileSync(peer, peerBody, "utf8");

      const report = runChild(repo, { collide: "hardlink", peer, nameHexes: pinned("c3c3c3c3c3c3c3c3") });
      assert.ok(!report.setupFailed, `hard link setup failed: ${report.setupFailed}`);

      assert.strictEqual(report.ok, false, "exclusive creation refuses a name that is already taken");
      assert.strictEqual(report.code, "E_ARTIFACT_IO", report.message);
      assert.match(report.message, /no unused staging name was available/);
      assert.strictEqual(fs.readFileSync(peer, "utf8"), peerBody,
        "the peer is neither truncated nor written through: `wx` never opened it");
      assert.ok(fs.existsSync(report.temporary), "and the link itself is left alone -- it was never ours to remove");
      assert.ok(!fs.existsSync(artifactPath(repo)), "nothing was published");
    });
  });

test("a pre-existing REGULAR FILE at the staging name is refused and left untouched", async () => {
  await withRepo(async (repo) => {
    const body = "someone else's staging file\n";
    const report = runChild(repo, { collide: "file", collideBody: body, nameHexes: pinned("d4d4d4d4d4d4d4d4") });

    assert.strictEqual(report.ok, false);
    assert.strictEqual(report.code, "E_ARTIFACT_IO", report.message);
    assert.match(report.message, /in 3 attempts/, "the bound is three attempts, then it fails closed");
    assert.strictEqual(fs.readFileSync(report.temporary, "utf8"), body,
      "not truncated on the way in, and not deleted on the way out");
    assert.ok(!fs.existsSync(artifactPath(repo)), "nothing was published");
  });
});

test("a pre-existing SYMLINK at the staging name is refused and its destination is never written", async (t) => {
  await withRepo(async (repo) => {
    const peer = path.join(repo.root, "symlink-peer.txt");
    const peerBody = "the destination of a link the emitter must not follow\n";
    fs.writeFileSync(peer, peerBody, "utf8");

    const report = runChild(repo, { collide: "symlink", peer, nameHexes: pinned("e5e5e5e5e5e5e5e5") });
    if (report.setupFailed) {
      t.skip(`this platform does not permit creating a file symlink: ${report.setupFailed}`);
      return;
    }
    assert.strictEqual(report.ok, false);
    assert.strictEqual(report.code, "E_ARTIFACT_IO", report.message);
    assert.strictEqual(fs.readFileSync(peer, "utf8"), peerBody, "the link destination keeps its bytes");
    assert.ok(fs.lstatSync(report.temporary).isSymbolicLink(), "and the link is still there");
  });
});

test("a taken staging name costs an attempt, not the run: the next name succeeds and the intruder survives",
  async () => {
    await withRepo(async (repo) => {
      const body = "the first name was already taken\n";
      // Two scripted names: the first is occupied, the second is free. This is the bounded retry
      // actually working, and the counterpart to the exhaustion cases above.
      const report = runChild(repo, {
        collide: "file", collideBody: body, nameHexes: ["f6f6f6f6f6f6f6f6", "0707070707070707"],
      });

      assert.strictEqual(report.ok, true, `expected success on the second name: ${report.message}`);
      assert.strictEqual(report.result.path, artifactPath(repo));
      assert.strictEqual(parseCanonicalInventoryV2(fs.readFileSync(report.result.path, "utf8")).inventoryDigest,
        report.result.inventoryDigest, "and the published document is the one it says it is");
      assert.strictEqual(fs.readFileSync(report.temporary, "utf8"), body,
        "the intruder is still there: cleanup removes only what this operation created");
    });
  });

test("an open that FAILS owns nothing: the entry already at that name is not removed", async () => {
  await withRepo(async (repo) => {
    // The old cleanup was `if (existsSync(temporary)) rm(temporary)`, so an open that never succeeded
    // still deleted whatever stood there. EACCES is injected because a non-EEXIST open failure is the
    // one shape that reaches the cleanup with nothing owned.
    const body = "not this operation's file\n";
    const report = runChild(repo, {
      fault: "open", collide: "file", collideBody: body, nameHexes: ["1818181818181818"],
    });

    assert.strictEqual(report.ok, false);
    assert.strictEqual(report.hits, 1, "the open was attempted once and refused");
    assert.strictEqual(report.code, "E_ARTIFACT_IO", report.message);
    assert.match(report.message, /cannot stage the artifact/);
    assert.strictEqual(fs.readFileSync(report.temporary, "utf8"), body,
      "a failed create authorises no cleanup at all");
  });
});

// --- 6. the hygiene guard's own exclusive creation ----------------------------------------------------

test("the guard reappearing under a losing creator is retried, not skipped", async () => {
  await withRepo(async (repo) => {
    // One injected EEXIST while nothing is actually there: the re-inspection finds no guard, which is
    // the outcome that must NOT fall through. A second attempt creates it for real.
    const report = runChild(repo, { fault: "ignore-eexist-once" });
    assert.strictEqual(report.ok, true, `expected the retry to succeed: ${report.message}`);
    assert.strictEqual(report.hits, 1, "exactly one attempt was made to fail");
    assert.strictEqual(fs.readFileSync(ignorePath(repo), "utf8"), "*\n!.gitignore\n",
      "the guard exists, so the artifact is not sitting in an unignored directory");
  });
});

test("a guard that can be neither created nor observed refuses instead of publishing", async () => {
  await withRepo(async (repo) => {
    const good = await emitChangedTestInventory(request(repo));
    const before = fs.readFileSync(good.path);
    fs.rmSync(ignorePath(repo));

    repo.write("README.md", "base, moved for the guard case\n");
    const report = runChild(repo, { fault: "ignore-eexist-always" });

    assert.strictEqual(report.ok, false, "publishing without the footgun guard is not an option");
    assert.strictEqual(report.hits, 3, "bounded at three attempts");
    assert.strictEqual(report.code, "E_ARTIFACT_IO", report.message);
    assert.match(report.message, /neither created nor observed/);
    assert.deepStrictEqual(fs.readFileSync(good.path), before, "and the previous artifact is byte-identical");
  });
});

test("an existing guard is preserved even when it is the operator's own, and is never re-created", async () => {
  await withRepo(async (repo) => {
    const outputDir = path.dirname(artifactPath(repo));
    fs.mkdirSync(outputDir, { recursive: true });
    const custom = "*\n!.gitignore\n# an operator wrote this before any run\n";
    fs.writeFileSync(ignorePath(repo), custom, "utf8");           // no interception: it is simply there

    const result = await emitChangedTestInventory(request(repo));
    assert.strictEqual(fs.readFileSync(ignorePath(repo), "utf8"), custom,
      "exclusive creation fails with EEXIST, the file is re-inspected, and its bytes are kept");
    assert.ok(fs.existsSync(result.path), "and the emission still succeeds");
  });
});

// --- 7. redirection ---------------------------------------------------------------------------------

test("filesystem redirection is refused: a symlinked parent, and a symlinked ignore file", async (t) => {
  await withRepo(async (repo) => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-emit-elsewhere-"));
    try {
      // `.ctide/output` is the component this emitter walks and creates. A symlink there would move
      // the whole run-scratch tree outside the repository while every path string still looked
      // contained. `.ctide` itself is NOT used for this case: a symlink there is already refused
      // earlier by the producer's config-carrier rule, which is a different guard.
      const outputDir = path.join(repo.root, ".ctide", "output");
      let linked = true;
      try {
        fs.symlinkSync(elsewhere, outputDir, "junction");
      } catch {
        linked = false;                    // unprivileged Windows without developer mode
      }
      if (!linked) {
        t.skip("this platform does not permit creating a directory symlink");
        return;
      }
      try {
        const error = await refused(emitChangedTestInventory(request(repo)),
          "a symlinked .ctide/output", "E_ARTIFACT_TARGET");
        assert.ok(error instanceof InventoryArtifactError);
        assert.match(error.message, /symbolic link/);
        assert.ok(!fs.existsSync(path.join(elsewhere, "changed-test-inventory.json")),
          "and nothing was written through the link");
      } finally {
        fs.unlinkSync(outputDir);
      }
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});

test("a non-regular ignore file is refused rather than followed", async () => {
  await withRepo(async (repo) => {
    const outputDir = path.dirname(artifactPath(repo));
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(ignorePath(repo));                       // a DIRECTORY where the guard must be a file
    await refused(emitChangedTestInventory(request(repo)),
      "an ignore path that is not a regular file", "E_ARTIFACT_TARGET");
    assert.ok(!fs.existsSync(artifactPath(repo)), "and no artifact was published");
  });
});

// --- 8. request contract and CLI --------------------------------------------------------------------

test("the request is exactly three keys and accepts no output path or context", async () => {
  await withRepo(async (repo) => {
    for (const [what, req] of [
      ["an extra output path", { ...request(repo), outputPath: "/tmp/x.json" }],
      ["a missing task", { repoRoot: repo.root, baseTreeOid: repo.baseTreeOid }],
      ["a snapshot", { ...request(repo), snapshot: {} }],
    ]) {
      await refused(emitChangedTestInventory(req), what, "E_API_ARGUMENTS");
    }
    let twoArgs = null;
    try { await emitChangedTestInventory(request(repo), {}); } catch (e) { twoArgs = e; }
    assert.strictEqual(twoArgs && twoArgs.code, "E_API_ARGUMENTS", "a second argument is refused");
  });
});

test("the CLI emits JSON and the real exit codes", async () => {
  await withRepo(async (repo) => {
    const run = (args) => cp.spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });

    const ok = run(["--cwd", repo.root, "--base-tree", repo.baseTreeOid, "--task", TASK]);
    assert.strictEqual(ok.status, 0, `expected exit 0, got ${ok.status} (${ok.stderr})`);
    const body = JSON.parse(ok.stdout.trim());
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.path, artifactPath(repo));
    assert.strictEqual(parseCanonicalInventoryV2(fs.readFileSync(body.path, "utf8")).inventoryDigest,
      body.inventoryDigest);

    const bad = run(["--cwd", repo.root, "--base-tree", "0".repeat(40), "--task", TASK]);
    assert.strictEqual(bad.status, 1, "a failed derivation exits 1");
    const err = JSON.parse(bad.stderr.trim().split("\n").pop());
    assert.strictEqual(err.ok, false);
    assert.strictEqual(err.code, "E_BASE_TREE_OID", "the producer's own typed cause survives the CLI boundary");
  });
});

test("the CLI refuses every malformed invocation before producing anything", async () => {
  await withRepo(async (repo) => {
    const run = (args) => cp.spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
    const valid = ["--cwd", repo.root, "--base-tree", repo.baseTreeOid, "--task", TASK];

    const cases = [
      // The two defects this parser exists for. An unknown flag alongside otherwise valid arguments
      // used to be dropped silently and the emission SUCCEEDED, writing an artifact the operator had
      // not asked for in the way they thought.
      ["an unknown flag", [...valid, "--inventory", "x"], /unknown flag --inventory/],
      ["a misspelled flag", ["--cwd", repo.root, "--base-tre", repo.baseTreeOid, "--task", TASK], /unknown flag/],
      // A missing value used to become the literal string "true".
      ["a flag with no value at all", ["--cwd", repo.root, "--base-tree", repo.baseTreeOid, "--task"],
        /--task requires a value/],
      ["a flag swallowing the next flag", ["--cwd", repo.root, "--task", "--base-tree", repo.baseTreeOid],
        /--task requires a value/],
      ["an empty value", [...valid.slice(0, 4), "--task", ""], /--task was given an empty value/],
      ["a repeated flag", [...valid, "--task", "TASK-2"], /--task was given more than once/],
      ["a bare positional", [...valid, "extra"], /unexpected argument "extra"/],
      ["a missing --task", ["--cwd", repo.root, "--base-tree", repo.baseTreeOid], /--task is required/],
      ["a missing --base-tree", ["--cwd", repo.root, "--task", TASK], /--base-tree is required/],
      ["no arguments at all", [], /--base-tree is required/],
    ];

    for (const [what, args, message] of cases) {
      const proc = run(args);
      assert.strictEqual(proc.status, 1, `${what}: expected exit 1, got ${proc.status} (${proc.stdout})`);
      const body = JSON.parse(proc.stderr.trim().split("\n").pop());
      assert.strictEqual(body.ok, false, what);
      assert.strictEqual(body.code, "E_API_ARGUMENTS", `${what}: ${body.message}`);
      assert.match(body.message, message, what);
      assert.strictEqual(proc.stdout, "", `${what}: a refusal says nothing on stdout`);
      assert.ok(!fs.existsSync(artifactPath(repo)),
        `${what}: argument failures are decided before production, so nothing is written`);
    }
  });
});

test("a missing --task is refused even when a task really is named `true`", async () => {
  // The old parser turned a missing value into the literal string "true". That was survivable only by
  // luck: a store containing a task with that name would have been silently attested instead.
  await withRepo(async (repo) => {
    const proc = cp.spawnSync(process.execPath,
      [SCRIPT, "--cwd", repo.root, "--task", "--base-tree", repo.baseTreeOid], { encoding: "utf8" });
    assert.strictEqual(proc.status, 1);
    assert.strictEqual(JSON.parse(proc.stderr.trim().split("\n").pop()).code, "E_API_ARGUMENTS");
    assert.ok(!fs.existsSync(artifactPath(repo)), "the task named `true` was NOT attested");

    // and naming it deliberately still works, so the refusal is about the omission, not the name.
    const named = cp.spawnSync(process.execPath,
      [SCRIPT, "--cwd", repo.root, "--base-tree", repo.baseTreeOid, "--task", "true"], { encoding: "utf8" });
    assert.strictEqual(named.status, 0, named.stderr);
    assert.strictEqual(JSON.parse(named.stdout.trim()).ok, true);
  }, "ctide-emit-", ["true"]);
});

test("--cwd is optional and defaults to the actual working directory", async () => {
  await withRepo(async (repo) => {
    const proc = cp.spawnSync(process.execPath, [SCRIPT, "--base-tree", repo.baseTreeOid, "--task", TASK],
      { encoding: "utf8", cwd: repo.root });
    assert.strictEqual(proc.status, 0, proc.stderr);
    const body = JSON.parse(proc.stdout.trim());
    assert.strictEqual(body.path, artifactPath(repo), "the default is process.cwd(), not a guess");
  });
});

// --- 9. regression control (NOT a concurrency claim) --------------------------------------------------

test("two emissions awaited together both succeed — a control on unique naming, not on interleaving", async () => {
  // Everything after the producer's await is synchronous, so these two do not stage at the same time
  // and this asserts nothing about simultaneity. What it does catch is a naming or ownership change
  // that made two emissions in one process interfere at all.
  await withRepo(async (first) => {
    await withRepo(async (second) => {
      second.write("README.md", "a different world\n");
      const [a, b] = await Promise.all([
        emitChangedTestInventory(request(first)), emitChangedTestInventory(request(second)),
      ]);
      assert.strictEqual(a.path, artifactPath(first));
      assert.strictEqual(b.path, artifactPath(second));
      assert.notStrictEqual(a.inventoryDigest, b.inventoryDigest, "two different worlds, two digests");
      for (const [repo, result] of [[first, a], [second, b]]) {
        assert.strictEqual(parseCanonicalInventoryV2(fs.readFileSync(result.path, "utf8")).inventoryDigest,
          result.inventoryDigest);
        assert.deepStrictEqual(tempResidue(repo), [], "and neither left staging residue");
      }
    }, "ctide-emit-second-");
  });
});

// --- request capture: one read per owned value, and a destination that cannot move -------------------
//
// The emitter derives from the request and then publishes to a path built from it. Reading repoRoot
// again after the producer's await let those two disagree, so an artifact derived from one repository
// was written into another. The values are now captured once, before the await.

async function withTwoRepos(body) {
  const a = makeRepo("ctide-emit-src-");
  const b = makeRepo("ctide-emit-dst-");
  try {
    return await body(a, b);
  } finally {
    for (const repo of [a, b]) {
      fs.rmSync(checkedTempRoot(repo.root, repo.prefix), { recursive: true, force: true });
    }
  }
}

const untouched = (repo) => !fs.existsSync(path.join(repo.root, ".ctide", "output"));

test("an ORDINARY mutable request cannot redirect publication away from the repository it derived from",
  () => withTwoRepos(async (a, b) => {
    // No accessor anywhere: a plain object mutated between the call and its resolution. The emitter's
    // synchronous prologue has run by the time control returns here, and the producer has not yet
    // resolved, so this assignment lands exactly in the window the old boundary re-read in.
    const req = { repoRoot: a.root, baseTreeOid: a.baseTreeOid, taskId: TASK };
    const pending = emitChangedTestInventory(req);
    req.repoRoot = b.root;
    const out = await pending;

    assert.strictEqual(out.path, artifactPath(a), "published into the repository it derived from");
    assert.ok(fs.existsSync(artifactPath(a)), "A holds the artifact");
    assert.ok(untouched(b), "B was never created, written or observed");
    assert.strictEqual(parseCanonicalInventoryV2(fs.readFileSync(artifactPath(a), "utf8")).baseTreeOid,
      a.baseTreeOid, "and the published header describes A");
  }));

test("an enumerable accessor cannot redirect it either; each owned value is read exactly once",
  () => withTwoRepos(async (a, b) => {
    const counts = { repoRoot: 0, baseTreeOid: 0, taskId: 0 };
    const req = {};
    const define = (name, value) => Object.defineProperty(req, name, {
      enumerable: true,
      configurable: true,
      get() { counts[name] += 1; return value(counts[name]); },
    });
    define("repoRoot", (n) => (n === 1 ? a.root : b.root));
    define("baseTreeOid", () => a.baseTreeOid);
    define("taskId", () => TASK);

    const out = await emitChangedTestInventory(req);
    assert.deepStrictEqual(counts, { repoRoot: 1, baseTreeOid: 1, taskId: 1 },
      "one read per owned value, so no later read exists to disagree with the first");
    assert.strictEqual(out.path, artifactPath(a));
    assert.ok(untouched(b), "B was never created, written or observed");
  }));

test("hidden and symbol own keys are refused BEFORE anything is observed or written",
  () => withRepo(async (repo) => {
    const hidden = request(repo);
    Object.defineProperty(hidden, "outputPath", {
      value: "/tmp/elsewhere", enumerable: false, configurable: true,
    });
    assert.deepStrictEqual(Object.keys(hidden).sort(), ["baseTreeOid", "repoRoot", "taskId"],
      "invisible to the enumerable view, which is why the check must not use it");
    const hiddenError = await refused(emitChangedTestInventory(hidden),
      "a non-enumerable outputPath", "E_API_ARGUMENTS");
    assert.match(hiddenError.message, /"outputPath"/, "the diagnostic names the offending key");

    const symbolled = request(repo);
    symbolled[Symbol("outputPath")] = "/tmp/elsewhere";
    const symbolError = await refused(emitChangedTestInventory(symbolled),
      "a symbol own key", "E_API_ARGUMENTS");
    assert.ok(!(symbolError instanceof TypeError),
      "a typed refusal, not an engine error from interpolating a symbol");
    assert.match(symbolError.message, /Symbol\(outputPath\)/,
      "rendered by String(), not flattened to null by JSON.stringify");

    assert.ok(untouched(repo), "neither refusal produced, observed or created any output");
  }));
