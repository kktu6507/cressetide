// AC172 evidence for cressetide/skills/vigil/scripts/changed-test-inventory-producer.mjs.
//
// SCOPE NOTE: this covers produceChangedTestInventoryV2()'s request contract and AC172's
// cross-binding. AC173's end-to-end classification matrix is the sibling suite. A green run here
// does not establish AC118, AC136, AC137 or AC138, and does not mean Phase 2 is ready. (The clause
// about the unsupported-populated-inventory gate is gone because the gate is: see the retired-(j)
// note further down, where the two paths now agree instead of disagreeing by design.)
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
import crypto from "node:crypto";

import { root } from "./helpers.mjs";
import {
  canonicalJson, emptyStore, canonicalStoreBytes, storeDigest, sha256Hex, CANONICAL_STORE_PATH,
} from "../cressetide/skills/vigil/scripts/provenance-store.mjs";
import {
  computeInventoryV2Digest, V2_INVENTORY_KEYS, parseCanonicalInventoryV2, parseInventory,
} from "../cressetide/skills/vigil/scripts/changed-test-inventory.mjs";
import {
  produceChangedTestInventoryV2, InventoryProducerError,
} from "../cressetide/skills/vigil/scripts/changed-test-inventory-producer.mjs";

const SCRIPTS = path.join(root, "cressetide", "skills", "vigil", "scripts");
const NODE_TEST = 'import { test } from "node:test";\n';
// AC172 is about the request contract and the cross-preimage binding, NOT about clause semantics.
// Its fixtures therefore bind `EXPL`, which does no clause resolution on either side: a fixture
// pointing at a REQ that no store contains was only ever green because unchanged pairs skipped
// binding validation, and that bypass is the defect v1.17 closes. REQ_A is still used by the one
// case that IS about a populated envelope, and that case puts it in the base tree.
const REQ_A = "REQ-01ARZ3NDEKTSV4RRFFQ69G5FAV";
const TASK = "TASK-1";

// TP v1.16: the request names a task, and the CURRENT store must carry a matching TaskState whose
// baseProvenance witness equals the requested tree. The base-tree store cannot -- its oid depends on
// its own bytes -- and need not: TaskState is not an immutable section, so B may have none.
// TP v1.17: the witness's storeDigest is compared against the base store the producer actually
// captured, over that file's ORIGINAL bytes. Where the base tree carries no store, the one canonical
// empty-store digest is the defined value; where it carries one, the fixture derives the real digest
// rather than hardcoding the empty one.
const rawDigest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

const withTask = (store, baseTreeOid, dpIds = [], baseStoreDigest = storeDigest(emptyStore())) => {
  const s = JSON.parse(JSON.stringify(store));
  s.taskStates = [{
    taskId: TASK,
    baseProvenance: { treeOid: baseTreeOid, storePath: CANONICAL_STORE_PATH, storeDigest: baseStoreDigest },
    currentTaskDpIds: dpIds,
  }];
  return s;
};

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
  const storeFile = path.join(dir, ".ctide", "provenance.json");
  return {
    root: dir, git, write,
    commit: (base = emptyStore()) => {
      git("add", "-A"); git("commit", "-qm", "c");
      const oid = git("rev-parse", "HEAD^{tree}");
      const committedDigest = fs.existsSync(storeFile)
        ? rawDigest(fs.readFileSync(storeFile))
        : storeDigest(emptyStore());
      // The current store carries the task. When the base tree already carries a store, the witness
      // names ITS bytes; otherwise the canonical empty-store digest is the defined value.
      write(".ctide/provenance.json", canonicalStoreBytes(withTask(base, oid, [], committedDigest)));
      return oid;
    },
    // Point the current task at a specific tree. Needed whenever a case commits twice and then
    // requests the EARLIER tree: otherwise the task's baseProvenance witness names the later one and
    // the run stops on E_TASK_BASE_MISMATCH before reaching the case under test.
    useTask: (oid) => write(".ctide/provenance.json", canonicalStoreBytes(withTask(emptyStore(), oid))),
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
    `  const out = await m.produceChangedTestInventoryV2({ repoRoot: ${JSON.stringify(repoRoot)}, baseTreeOid: ${JSON.stringify(baseTreeOid)}, taskId: "TASK-1" });`,
    "  console.log(JSON.stringify({ ok: true, keys: Object.keys(out).sort(), entries: out.entries.length, registryDigest: out.registryDigest }));",
    "} catch (e) { console.log(JSON.stringify({ ok: false, code: e.code, message: String(e.message) })); }",
  ].join("\n"), "utf8");
  const r = cp.spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.strictEqual(r.status, 0, `the probe run must complete: ${r.stderr}`);
  return JSON.parse(r.stdout.trim());
}

// TP v1.17: changed-test-inventory-producer.mjs is now a public facade that re-exports the
// operation. The implementation -- and therefore every single-point edit target below -- lives in
// the common module the two §11b.10c operations share. The facade path is unchanged and still
// works, which is what the shape-B runner imports.
const PRODUCER = path.join("cressetide", "skills", "vigil", "scripts", "governance-producer-core.mjs");

// --- AC172 (1)(2): the positives ----------------------------------------------------------------

test("AC172 (1)(2): both preimages agree on baseTreeOid and headViewDigest, and the run continues", () => withRepo(async (repo) => {
  repo.write("a.test.mjs", `${NODE_TEST}// @src EXPL\ntest("alpha", () => {});\n`);
  const oid = repo.commit();

  const out = await produceChangedTestInventoryV2({ repoRoot: repo.root, baseTreeOid: oid, taskId: TASK });
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

test("AC172 (5): the producer request is exactly { repoRoot, baseTreeOid, taskId } and refuses every injection", () => withRepo(async (repo) => {
  repo.write("a.test.mjs", `${NODE_TEST}// @src EXPL\ntest("alpha", () => {});\n`);
  const oid = repo.commit();
  await produceChangedTestInventoryV2({ repoRoot: repo.root, baseTreeOid: oid, taskId: TASK }); // the legal call works

  // EVERY NEGATIVE STARTS FROM THE VALID THREE-FIELD REQUEST. Starting from a two-key object would
  // confound the injection with a missing taskId: the refusal would be right for the wrong reason,
  // and the "one extra key" case in particular would prove nothing.
  const valid = () => ({ repoRoot: repo.root, baseTreeOid: oid, taskId: TASK });

  const e2 = await refused(
    produceChangedTestInventoryV2(valid(), { preimage: {} }),
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
      produceChangedTestInventoryV2({ ...valid(), [key]: "anything" }),
      `injected ${key}`, "E_API_ARGUMENTS");
    assert.match(e.message, new RegExp(key), `${key}: the refusal names the key`);
  }
  await refused(produceChangedTestInventoryV2({ ...valid(), extra: 1 }), "one extra key on a valid request", "E_API_ARGUMENTS");
  await refused(produceChangedTestInventoryV2({ repoRoot: repo.root, taskId: TASK }), "a missing baseTreeOid", "E_API_ARGUMENTS");
  await refused(produceChangedTestInventoryV2({ repoRoot: repo.root, baseTreeOid: oid }), "a missing taskId", "E_API_ARGUMENTS");
  for (const bad of ["HEAD", "main", oid.slice(0, 8), oid.toUpperCase(), ""]) {
    await refused(produceChangedTestInventoryV2({ repoRoot: repo.root, baseTreeOid: bad, taskId: TASK }),
      `baseTreeOid ${JSON.stringify(bad)}`, "E_BASE_TREE_OID");
  }
}));

// --- AC172 (3)(4)(6): the defensive branches, through shape B -------------------------------------

test("AC172 (3): one side built against a DIFFERENT legal tree is fail-closed", () => withRepo(async (repo) => {
  // Both preimages are built by the producer from one request, so no legal input can make them
  // disagree. §11b.10c shape B is the only authorised way to see the guard fire: a scratch source
  // copy, one edit, a child process. No production seam, no race.
  repo.write("a.test.mjs", `${NODE_TEST}// @src EXPL\ntest("alpha", () => {});\n`);
  const treeA = repo.commit();
  repo.write("b.test.mjs", `${NODE_TEST}test("beta", () => {});\n`);
  const treeB = repo.commit();
  assert.notStrictEqual(treeA, treeB);
  repo.useTask(treeA);

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
  repo.write("a.test.mjs", `${NODE_TEST}// @src EXPL\ntest("alpha", () => {});\n`);
  const oid = repo.commit();
  const other = "f".repeat(64); // legal digest shape, different value

  const scratch = scratchScripts("ctide-prod-xbind-hv-");
  try {
    patch(path.join(scratch, PRODUCER),
      "const discovery = await buildDiscoveryAnalysisPreimage({ repoRoot, baseTreeOid });",
      "const discovery = { ...(await buildDiscoveryAnalysisPreimage({ repoRoot, baseTreeOid })), "
      + `headViewDigest: ${JSON.stringify(other)} };`);
    const out = runProducerIn(scratch, repo.root, oid);
    assert.strictEqual(out.ok, false, "two head views must not produce an envelope");
    assert.strictEqual(out.code, "E_CROSS_BINDING");
    assert.match(out.message, /different head views/);
    assert.match(out.message, /freshness carrier from one instant and classify against another/,
      "the message says why it matters, not just that it happened");
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}));

test("AC172 (6): a second registry mixed into the envelope is fail-closed", () => withRepo(async (repo) => {
  repo.write("a.test.mjs", `${NODE_TEST}// @src EXPL\ntest("alpha", () => {});\n`);
  const oid = repo.commit();

  const honest = await produceChangedTestInventoryV2({ repoRoot: repo.root, baseTreeOid: oid, taskId: TASK });

  // The binding itself, on the production module: the envelope carries the digest the analysed
  // discovery preimage is bound to.
  const { buildDiscoveryAnalysisPreimage } = await import("../cressetide/skills/vigil/scripts/adapter-discovery-preimage.mjs");
  const discovery = await buildDiscoveryAnalysisPreimage({ repoRoot: repo.root, baseTreeOid: oid });
  assert.strictEqual(honest.registryDigest, discovery.registryDigest);

  // And the defensive branch. There is no legal way for a second registry to reach the envelope, so
  // §11b.10c shape B is the only authorised way to see the guard fire: one edit, in a scratch source
  // copy, in a child process. The earlier version of this test asserted the OPPOSITE -- that the
  // mutated copy still returned -- which is exactly what the spec forbids.
  const scratch = scratchScripts("ctide-prod-registry-");
  try {
    patch(path.join(scratch, PRODUCER),
      "    registryDigest: discovery.registryDigest,",
      `    registryDigest: ${JSON.stringify("a".repeat(64))}, // RED: a second registry, mixed in`);
    const out = runProducerIn(scratch, repo.root, oid);
    assert.strictEqual(out.ok, false, "a mixed second registry must be refused, not returned");
    assert.strictEqual(out.code, "E_REGISTRY_BINDING");
    assert.match(out.message, /a second registry may not be mixed in/);
    assert.strictEqual(out.keys, undefined, "no envelope escapes");
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}));

// --- AC172: no partial result, and no side effects ------------------------------------------------

test("AC172: a cross-binding failure returns nothing at all and writes nothing", () => withRepo(async (repo) => {
  repo.write("a.test.mjs", `${NODE_TEST}// @src EXPL\ntest("alpha", () => {});\n`);
  const treeA = repo.commit();
  repo.write("b.test.mjs", `${NODE_TEST}test("beta", () => {});\n`);
  const treeB = repo.commit();
  repo.useTask(treeA);

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
  // The base tree carries a store holding REQ_A, so the modified test's BASE-side binding resolves
  // in B -- shared §9's pre-binding row requires that, and an empty base tree cannot satisfy it.
  const store = emptyStore();
  store.sources.push({
    sourceId: "S-1", contentKind: "requirement", driftMode: "snapshot-only",
    locator: "c#1", excerpt: "inert", digest: sha256Hex("inert"),
  });
  store.clauses.push({
    id: REQ_A, authority: "approved-requirement", kind: "specification",
    text: "clause", sourceRef: "S-1", taskRef: TASK,
  });
  repo.write("a.test.mjs", `${NODE_TEST}// @src ${REQ_A}\ntest("alpha", () => {});\n`);
  repo.write(".ctide/provenance.json", canonicalStoreBytes(store));
  const oid = repo.commit(store);
  // The head must actually DIFFER from the base tree. The earlier version of this case produced an
  // envelope with entries == [], and parseInventory() refuses an empty v2 document for a different
  // reason than a populated one -- so it proved nothing about (j). The assertion below comes first
  // for exactly that reason.
  repo.write("a.test.mjs", `${NODE_TEST}// @src ${REQ_A}\ntest("alpha", () => { const x = 1; void x; });\n`);
  repo.write("b.test.mjs", `${NODE_TEST}// @src ${REQ_A}\ntest("beta", () => {});\n`);
  const out = await produceChangedTestInventoryV2({ repoRoot: repo.root, baseTreeOid: oid, taskId: TASK });
  assert.ok(out.entries.length > 0, "this case is about a POPULATED envelope; an empty one proves nothing");
  assert.deepStrictEqual(out.entries.map((e) => e.status).sort(), ["added", "modified"]);
  const text = canonicalJson(out);

  // (i) the isolated canonical reader accepts what the producer wrote.
  const read = parseCanonicalInventoryV2(text);
  assert.strictEqual(read.inventoryDigest, out.inventoryDigest);

  // (j) RETIRED ASSERTION: the product entry point used to refuse these very bytes under
  // `unsupported-populated-inventory`, and AC173 (j) required both facts at once. That gate is lifted
  // — §11b.12's six preconditions and the committed consumer are accepted — so the two paths now
  // AGREE, which is the fact that replaces it. The producer's own no-write boundary, asserted
  // elsewhere in this suite, is what still keeps producing separate from emitting.
  assert.deepStrictEqual(parseInventory(text), parseCanonicalInventoryV2(text),
    "the product path returns exactly what the canonical authority returns");
}));
