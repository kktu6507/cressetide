// AC172 evidence for cressetide/skills/vigil/scripts/changed-test-inventory-producer.mjs.
//
// SCOPE NOTE: this covers produceChangedTestInventoryV2()'s request contract and AC172's
// cross-binding. AC173's end-to-end classification matrix is the sibling suite. A green run here
// does NOT lift the unsupported-populated-inventory gate, does not make the product entry point
// accept a populated inventory, does not satisfy AC118, AC136, AC137 or AC138, and does not mean
// Phase 2 is ready.
//
// Spec anchors (the current approved coupled set, one effective set):
//   SM  = 2026-07-25-shared-decision-provenance-model.md (approved v1.15) §2, §9
//   TP  = 2026-07-25-test-provenance-spec.md (approved v1.15) §11b.10c, §11b.9c, AC172
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cp from "node:child_process";

import { root } from "./helpers.mjs";
import { canonicalJson } from "../cressetide/skills/vigil/scripts/provenance-store.mjs";
import {
  computeInventoryV2Digest, V2_INVENTORY_KEYS, parseCanonicalInventoryV2, parseInventory,
  UNSUPPORTED_POPULATED,
} from "../cressetide/skills/vigil/scripts/changed-test-inventory.mjs";
import {
  produceChangedTestInventoryV2, InventoryProducerError,
} from "../cressetide/skills/vigil/scripts/changed-test-inventory-producer.mjs";

const SCRIPTS = path.join(root, "cressetide", "skills", "vigil", "scripts");
const NODE_TEST = 'import { test } from "node:test";\n';
const REQ_A = "REQ-01ARZ3NDEKTSV4RRFFQ69G5FAV";

// --- fixtures -----------------------------------------------------------------------------------

function makeRepo(prefix = "ctide-prod-") {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  const git = (...a) => cp.execFileSync("git", a, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q", "--initial-branch=main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  git("config", "core.symlinks", "false");
  const write = (rel, body) => {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body, "utf8");
  };
  return {
    root: dir, git, write,
    commit: () => { git("add", "-A"); git("commit", "-qm", "c"); return git("rev-parse", "HEAD^{tree}"); },
  };
}

async function withRepo(body, prefix) {
  const repo = makeRepo(prefix);
  try { return await body(repo); } finally { fs.rmSync(repo.root, { recursive: true, force: true }); }
}

async function refused(promise, what, code) {
  let error = null;
  try { await promise; } catch (e) { error = e; }
  assert.ok(error && error.code, `${what}: expected a coded failure, got ${error}`);
  if (code) assert.strictEqual(error.code, code, `${what}: expected ${code}, got ${error.code} (${error.message})`);
  return error;
}

// A disposable copy of the whole scripts directory. Shape B from §11b.10c: the single-point edit
// happens in the COPY, in a child process, and the working tree is never written to.
function scratchScripts(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  const vigil = path.join(dir, "cressetide", "skills", "vigil");
  fs.mkdirSync(vigil, { recursive: true });
  fs.cpSync(SCRIPTS, path.join(vigil, "scripts"), { recursive: true });
  fs.cpSync(path.join(root, "cressetide", "skills", "vigil", "vendor"), path.join(vigil, "vendor"), { recursive: true });
  return dir;
}

function patch(file, from, to) {
  const text = fs.readFileSync(file, "utf8");
  assert.strictEqual(text.split(from).length - 1, 1, `the single-point edit target must be unique: ${from}`);
  fs.writeFileSync(file, text.split(from).join(to), "utf8");
}

function runProducerIn(scratch, repoRoot, baseTreeOid) {
  const script = path.join(scratch, "run.mjs");
  fs.writeFileSync(script, [
    'const m = await import("./cressetide/skills/vigil/scripts/changed-test-inventory-producer.mjs");',
    "try {",
    `  const out = await m.produceChangedTestInventoryV2({ repoRoot: ${JSON.stringify(repoRoot)}, baseTreeOid: ${JSON.stringify(baseTreeOid)} });`,
    "  console.log(JSON.stringify({ ok: true, keys: Object.keys(out).sort(), entries: out.entries.length, registryDigest: out.registryDigest }));",
    "} catch (e) { console.log(JSON.stringify({ ok: false, code: e.code, message: String(e.message) })); }",
  ].join("\n"), "utf8");
  const r = cp.spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.strictEqual(r.status, 0, `the probe run must complete: ${r.stderr}`);
  return JSON.parse(r.stdout.trim());
}

const PRODUCER = path.join("cressetide", "skills", "vigil", "scripts", "changed-test-inventory-producer.mjs");

// --- AC172 (1)(2): the positives ----------------------------------------------------------------

test("AC172 (1)(2): both preimages agree on baseTreeOid and headViewDigest, and the run continues", () => withRepo(async (repo) => {
  repo.write("a.test.mjs", `${NODE_TEST}// @src ${REQ_A}\ntest("alpha", () => {});\n`);
  const oid = repo.commit();

  const out = await produceChangedTestInventoryV2({ repoRoot: repo.root, baseTreeOid: oid });
  assert.deepStrictEqual(Object.keys(out).sort(), [...V2_INVENTORY_KEYS].sort(), "exactly seven keys");
  assert.strictEqual(out.inventoryVersion, 2);
  assert.strictEqual(out.baseTreeOid, oid, "the envelope carries the requested tree, not a substitute");
  assert.match(out.headViewDigest, /^[0-9a-f]{64}$/);
  assert.match(out.registryDigest, /^[0-9a-f]{64}$/);
  assert.match(out.inputProvenanceStoreDigest, /^[0-9a-f]{64}$/);
  assert.strictEqual(out.inventoryDigest, computeInventoryV2Digest({
    inventoryVersion: out.inventoryVersion, baseTreeOid: out.baseTreeOid, registryDigest: out.registryDigest,
    headViewDigest: out.headViewDigest, inputProvenanceStoreDigest: out.inputProvenanceStoreDigest,
    entries: out.entries,
  }), "the digest is the one formula over the six preimage fields, recomputed");
  assert.ok(Object.isFrozen(out) && Object.isFrozen(out.entries), "deeply frozen");
}));

// --- AC172 (5): the request stays closed ---------------------------------------------------------

test("AC172 (5): the producer request is exactly { repoRoot, baseTreeOid } and refuses every injection", () => withRepo(async (repo) => {
  repo.write("a.test.mjs", `${NODE_TEST}// @src ${REQ_A}\ntest("alpha", () => {});\n`);
  const oid = repo.commit();
  await produceChangedTestInventoryV2({ repoRoot: repo.root, baseTreeOid: oid }); // the legal call works

  const e2 = await refused(
    produceChangedTestInventoryV2({ repoRoot: repo.root, baseTreeOid: oid }, { preimage: {} }),
    "a second argument", "E_API_ARGUMENTS");
  assert.match(e2.message, /exactly one argument/);

  // Every alias AC172 (5) names, plus the rest of the §11b.10c list the two operations share.
  for (const key of [
    "preimage", "discoveryAnalysisPreimage", "governanceSeedPreimage", "seed", "entries", "inventory",
    "envelope", "inventoryDigest", "registryDigest", "registry", "registryPath", "headViewDigest",
    "storeDigest", "inputProvenanceStoreDigest", "lifecycleAffectedClauses", "governanceHit", "hitSet",
    "reverseClosure", "matcherResult", "pairs", "parser", "ignoreMatcher", "gitExecutable", "env", "fs",
    "config", "modulePaths", "view", "snapshot", "clock", "now", "T0", "captureHook", "outputPath",
  ]) {
    const e = await refused(
      produceChangedTestInventoryV2({ repoRoot: repo.root, baseTreeOid: oid, [key]: "anything" }),
      `injected ${key}`, "E_API_ARGUMENTS");
    assert.match(e.message, new RegExp(key), `${key}: the refusal names the key`);
  }
  await refused(produceChangedTestInventoryV2({ repoRoot: repo.root, baseTreeOid: oid, extra: 1 }), "an unknown key", "E_API_ARGUMENTS");
  await refused(produceChangedTestInventoryV2({ repoRoot: repo.root }), "a missing baseTreeOid", "E_API_ARGUMENTS");
  for (const bad of ["HEAD", "main", oid.slice(0, 8), oid.toUpperCase(), ""]) {
    await refused(produceChangedTestInventoryV2({ repoRoot: repo.root, baseTreeOid: bad }),
      `baseTreeOid ${JSON.stringify(bad)}`, "E_BASE_TREE_OID");
  }
}));

// --- AC172 (3)(4)(6): the defensive branches, through shape B -------------------------------------

test("AC172 (3): one side built against a DIFFERENT legal tree is fail-closed", () => withRepo(async (repo) => {
  // Both preimages are built by the producer from one request, so no legal input can make them
  // disagree. §11b.10c shape B is the only authorised way to see the guard fire: a scratch source
  // copy, one edit, a child process. No production seam, no race.
  repo.write("a.test.mjs", `${NODE_TEST}// @src ${REQ_A}\ntest("alpha", () => {});\n`);
  const treeA = repo.commit();
  repo.write("b.test.mjs", `${NODE_TEST}test("beta", () => {});\n`);
  const treeB = repo.commit();
  assert.notStrictEqual(treeA, treeB);

  const scratch = scratchScripts("ctide-prod-xbind-oid-");
  try {
    patch(path.join(scratch, PRODUCER),
      "const discovery = await buildDiscoveryAnalysisPreimage({ repoRoot, baseTreeOid });",
      `const discovery = await buildDiscoveryAnalysisPreimage({ repoRoot, baseTreeOid: ${JSON.stringify(treeB)} });`);
    const out = runProducerIn(scratch, repo.root, treeA);
    assert.strictEqual(out.ok, false, "a disagreeing baseTreeOid must not produce an envelope");
    assert.strictEqual(out.code, "E_CROSS_BINDING");
    assert.match(out.message, /neither side is preferred/, "and it does not silently pick one");
    assert.match(out.message, new RegExp(treeB), "the failure names the value that disagreed");
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}));

test("AC172 (4): one side carrying a DIFFERENT legal headViewDigest is fail-closed", () => withRepo(async (repo) => {
  repo.write("a.test.mjs", `${NODE_TEST}// @src ${REQ_A}\ntest("alpha", () => {});\n`);
  const oid = repo.commit();
  const other = "f".repeat(64); // legal digest shape, different value

  const scratch = scratchScripts("ctide-prod-xbind-hv-");
  try {
    patch(path.join(scratch, PRODUCER),
      "const governance = await buildGovernanceSeedPreimage({ repoRoot, baseTreeOid });",
      "const governance = { ...(await buildGovernanceSeedPreimage({ repoRoot, baseTreeOid })), "
      + `headViewDigest: ${JSON.stringify(other)} };`);
    const out = runProducerIn(scratch, repo.root, oid);
    assert.strictEqual(out.ok, false, "two head views must not produce an envelope");
    assert.strictEqual(out.code, "E_CROSS_BINDING");
    assert.match(out.message, /different head views/);
    assert.match(out.message, /freshness carrier from one instant and classify against another/,
      "the message says why it matters, not just that it happened");
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}));

test("AC172 (6): registryDigest comes from the analysed preimage and nowhere else", () => withRepo(async (repo) => {
  repo.write("a.test.mjs", `${NODE_TEST}// @src ${REQ_A}\ntest("alpha", () => {});\n`);
  const oid = repo.commit();

  const honest = await produceChangedTestInventoryV2({ repoRoot: repo.root, baseTreeOid: oid });

  // Shape B again: a second registry read, mixed in after the fact. The point of the case is that
  // there is no legal way to do this -- so the evidence has to come from a scratch source copy --
  // and that the value in the envelope is the one bound to the discovery preimage.
  const scratch = scratchScripts("ctide-prod-registry-");
  try {
    patch(path.join(scratch, PRODUCER),
      "const registryDigest = discovery.registryDigest;",
      `const registryDigest = ${JSON.stringify("a".repeat(64))}; // RED: a second registry, mixed in`);
    const out = runProducerIn(scratch, repo.root, oid);
    assert.strictEqual(out.ok, true, "the mutated copy still runs, which is what makes the difference visible");
    assert.notStrictEqual(out.registryDigest, honest.registryDigest,
      "the mutated copy really does emit a different registryDigest");
    assert.strictEqual(honest.registryDigest, "" + honest.registryDigest,
      "and the production module takes it from the discovery preimage it analysed");
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }

  // The binding itself, asserted on the production module: the envelope's registryDigest is the
  // discovery preimage's, not a value read separately.
  const { buildDiscoveryAnalysisPreimage } = await import("../cressetide/skills/vigil/scripts/adapter-discovery-preimage.mjs");
  const discovery = await buildDiscoveryAnalysisPreimage({ repoRoot: repo.root, baseTreeOid: oid });
  assert.strictEqual(honest.registryDigest, discovery.registryDigest);
}));

// --- AC172: no partial result, and no side effects ------------------------------------------------

test("AC172: a cross-binding failure returns nothing at all and writes nothing", () => withRepo(async (repo) => {
  repo.write("a.test.mjs", `${NODE_TEST}// @src ${REQ_A}\ntest("alpha", () => {});\n`);
  const treeA = repo.commit();
  repo.write("b.test.mjs", `${NODE_TEST}test("beta", () => {});\n`);
  const treeB = repo.commit();

  const before = repo.git("status", "--porcelain", "--untracked-files=all");
  const scratch = scratchScripts("ctide-prod-partial-");
  try {
    patch(path.join(scratch, PRODUCER),
      "const discovery = await buildDiscoveryAnalysisPreimage({ repoRoot, baseTreeOid });",
      `const discovery = await buildDiscoveryAnalysisPreimage({ repoRoot, baseTreeOid: ${JSON.stringify(treeB)} });`);
    const out = runProducerIn(scratch, repo.root, treeA);
    assert.strictEqual(out.ok, false);
    assert.strictEqual(out.entries, undefined, "no entries, partial or otherwise");
    assert.strictEqual(out.keys, undefined, "no envelope");
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  assert.strictEqual(repo.git("status", "--porcelain", "--untracked-files=all"), before,
    "the repository is untouched: no output, no config, no registry, no store write");
  assert.ok(!fs.existsSync(path.join(repo.root, ".ctide", "output")), "no .ctide/output/** was created");
}));

// --- AC173 (i)(j): the two facts that must hold together -------------------------------------------

test("AC173 (i)(j): the output passes the canonical reader AND the product entry point still refuses it", () => withRepo(async (repo) => {
  repo.write("a.test.mjs", `${NODE_TEST}// @src ${REQ_A}\ntest("alpha", () => {});\n`);
  const oid = repo.commit();
  const out = await produceChangedTestInventoryV2({ repoRoot: repo.root, baseTreeOid: oid });
  const text = canonicalJson(out);

  // (i) the isolated canonical reader accepts what the producer wrote.
  const read = parseCanonicalInventoryV2(text);
  assert.strictEqual(read.inventoryDigest, out.inventoryDigest);

  // (j) and the PRODUCT entry point refuses the very same bytes, under the stable marker. Neither
  // fact is evidence on its own -- "the reader accepted it" is not permission to consume it, and
  // this is the assertion that keeps the two apart.
  let refusedByProduct = null;
  try { parseInventory(text); } catch (e) { refusedByProduct = e; }
  assert.ok(refusedByProduct, "the product path must still refuse a populated v2 envelope");
  assert.match(refusedByProduct.message, new RegExp(UNSUPPORTED_POPULATED),
    "and it refuses under the stable marker, not as a malformed document");
}));
