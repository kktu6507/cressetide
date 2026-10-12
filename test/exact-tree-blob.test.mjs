// The exact-tree blob reader's DIRECT request boundary.
//
// SCOPE. The reader's domain behaviour is already charged where its consumer uses it; this focused
// file exists because the direct export has no suite of its own, and the boundary corrections below
// belong to the export rather than to any one caller. A green run here proves the boundary — the own
// key set, one read per owned value, the refusal order and the raw-byte notation — and nothing about
// Step 6, convergence or readiness.
//
// The divergent reads this corrects were SYNCHRONOUS, so only an accessor could reach them; an
// ordinary object mutated during an await could not. That is deliberately weaker than the
// cross-repository failures corrected elsewhere and is not presented as equivalent.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cp from "node:child_process";
import crypto from "node:crypto";

import { readExactTreeBlob, ExactTreeBlobError } from "../cressetide/skills/vigil/scripts/exact-tree-blob.mjs";

const PREFIX = "ctide-tree-blob-";
const rawDigest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

function checkedTempRoot(dir, prefix) {
  const parent = fs.realpathSync(os.tmpdir());
  const resolved = path.resolve(dir);
  assert.strictEqual(path.dirname(resolved), parent, `refusing ${resolved}: not a direct temp child`);
  assert.ok(path.basename(resolved).startsWith(prefix), `refusing ${resolved}: wrong prefix`);
  return resolved;
}

// A real repository with a real committed tree; no injected Git and no capture hook.
function makeRepo() {
  const dir = checkedTempRoot(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), PREFIX))), PREFIX);
  const git = (...a) => cp.execFileSync("git", a, {
    cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  git("init", "-q", "--initial-branch=main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  git("config", "core.autocrlf", "false");
  return {
    root: dir,
    git,
    write(rel, body) {
      const file = path.join(dir, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, body);
    },
    commit(message = "c") { git("add", "-A"); git("commit", "-qm", message); return git("rev-parse", "HEAD^{tree}"); },
  };
}

async function withRepo(body) {
  const repo = makeRepo();
  try { return await body(repo); } finally {
    fs.rmSync(checkedTempRoot(repo.root, PREFIX), { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

const refused = async (promise, what, code) => {
  let error = null;
  try { await promise; } catch (e) { error = e; }
  assert.ok(error, `${what}: must be refused`);
  assert.strictEqual(error.code, code, `${what}: expected ${code}, got ${error.code} (${error.message})`);
  return error;
};

// --- the positive, over a real blob ------------------------------------------------------------------

test("a real committed blob is returned in its RAW notation", () => withRepo(async (repo) => {
  // BOM + CRLF: the notation discriminator. sha256 over the bytes as they stand is not a
  // canonicalising hash, and conflating the two makes such a witness permanently mismatch.
  const body = Buffer.from("﻿line one\r\nline two\r\n", "utf8");
  repo.write("data.txt", body);
  const treeOid = repo.commit();

  const read = await readExactTreeBlob({ repoRoot: repo.root, treeOid, path: "data.txt" });
  assert.deepStrictEqual(Object.keys(read).sort(), ["present", "rawBytes", "rawDigest"]);
  assert.strictEqual(read.present, true);
  assert.ok(read.rawBytes.equals(body), "the bytes are the bytes that were committed");
  assert.strictEqual(read.rawDigest, rawDigest(body), "raw sha256 over those bytes");
  assert.notStrictEqual(read.rawDigest,
    rawDigest(Buffer.from("line one\nline two\n", "utf8")), "…and not a canonicalised notation");

  const absent = await readExactTreeBlob({ repoRoot: repo.root, treeOid, path: "nowhere.txt" });
  assert.deepStrictEqual(absent, { present: false, rawBytes: null, rawDigest: null },
    "absence is absence, with no store meaning attached");
}));

// --- the request boundary ---------------------------------------------------------------------------

test("the request is exactly three OWN keys: hidden and symbol extras are refused, hidden required ones accepted",
  () => withRepo(async (repo) => {
    repo.write("a.txt", Buffer.from("x\n"));
    const treeOid = repo.commit();
    const base = () => ({ repoRoot: repo.root, treeOid, path: "a.txt" });

    // A required key that is own but not enumerable is a legal request under an own-key contract.
    const hiddenRequired = {};
    for (const [key, value] of Object.entries(base())) {
      Object.defineProperty(hiddenRequired, key, { value, enumerable: false });
    }
    assert.deepStrictEqual(Object.keys(hiddenRequired), [], "invisible to the enumerable view");
    assert.strictEqual((await readExactTreeBlob(hiddenRequired)).present, true, "and it is accepted");

    const hiddenExtra = base();
    Object.defineProperty(hiddenExtra, "git", { value: "git", enumerable: false });
    await refused(readExactTreeBlob(hiddenExtra), "a non-enumerable extra", "E_API_ARGUMENTS");

    const symbolled = base();
    symbolled[Symbol("git")] = "git";
    const error = await refused(readExactTreeBlob(symbolled), "a symbol extra", "E_API_ARGUMENTS");
    assert.ok(error instanceof ExactTreeBlobError, "the module's own typed error");
    assert.ok(!(error instanceof TypeError), "not an engine error from interpolating a symbol");
    assert.match(error.message, /Symbol\(git\)/, "rendered by String(), not flattened to null");

    await refused(readExactTreeBlob(base(), {}), "a second argument", "E_API_ARGUMENTS");
    await refused(readExactTreeBlob({ repoRoot: repo.root, treeOid }), "a missing key", "E_API_ARGUMENTS");
    await refused(readExactTreeBlob(null), "null", "E_API_ARGUMENTS");
    await refused(readExactTreeBlob([repo.root, treeOid, "a.txt"]), "an array", "E_API_ARGUMENTS");
  }));

test("each owned value is read exactly once", () => withRepo(async (repo) => {
  repo.write("a.txt", Buffer.from("x\n"));
  const treeOid = repo.commit();
  const counts = { repoRoot: 0, treeOid: 0, path: 0 };
  const values = { repoRoot: repo.root, treeOid, path: "a.txt" };
  const request = {};
  for (const name of Object.keys(values)) {
    Object.defineProperty(request, name, {
      enumerable: true, configurable: true, get() { counts[name] += 1; return values[name]; },
    });
  }
  const read = await readExactTreeBlob(request);
  assert.deepStrictEqual(counts, { repoRoot: 1, treeOid: 1, path: 1 });
  assert.strictEqual(read.present, true, "and the ordinary read is unchanged");
}));

test("the refusal order is API arguments, then the OID grammar, then the path grammar",
  () => withRepo(async (repo) => {
    repo.write("a.txt", Buffer.from("x\n"));
    const treeOid = repo.commit();

    // Everything wrong at once: the key set is charged first, before either grammar.
    const everything = { repoRoot: repo.root, treeOid: "HEAD^{tree}", path: "/absolute", git: "git" };
    await refused(readExactTreeBlob(everything), "a bad key set and both grammars", "E_API_ARGUMENTS");

    // Key set right, both grammars wrong: the OID is charged before the path.
    await refused(readExactTreeBlob({ repoRoot: repo.root, treeOid: "HEAD^{tree}", path: "/absolute" }),
      "both grammars wrong", "E_TREE_OID_GRAMMAR");

    // A legal OID with a bad path reaches the path grammar.
    await refused(readExactTreeBlob({ repoRoot: repo.root, treeOid, path: "/absolute" }),
      "an absolute path", "E_PATH_GRAMMAR");
    await refused(readExactTreeBlob({ repoRoot: repo.root, treeOid, path: ":(glob)a.txt" }),
      "pathspec magic", "E_PATH_GRAMMAR");

    // A non-string value is an argument fault, ahead of every grammar.
    await refused(readExactTreeBlob({ repoRoot: repo.root, treeOid: 7, path: "a.txt" }),
      "a non-string treeOid", "E_API_ARGUMENTS");
    await refused(readExactTreeBlob({ repoRoot: repo.root, treeOid, path: "" }),
      "an empty path", "E_API_ARGUMENTS");
  }));
