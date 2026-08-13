// Coverage for the immutable head-view snapshot: cressetide/skills/vigil/scripts/
// head-view-snapshot.mjs.
//
// SCOPE NOTE: this covers S1/S2 capture and headViewDigest and nothing else. No ChangedTestInventory
// producer, no v2 canonical parser, no base/head matching, no governance reverse closure, no S3
// consumer freshness recomputation and no artifact emission exists, here or anywhere. A green run
// does not satisfy AC118, AC136, AC137 or AC138, does not lift the
// unsupported-populated-inventory gate, and does not mean Phase 2 is ready.
//
// FIXTURES: every repository below is created with mkdtemp in the OS temporary directory and
// removed in a finally block. Nothing writes into this repository and no Git configuration outside
// the scratch repo is touched -- user.name, user.email and core.autocrlf are set per scratch repo
// so the bytes on disk are exactly the bytes written.
import assert from "node:assert";
import cp from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  HeadViewSnapshotError,
  captureHeadViewSnapshot,
  withStableHeadView,
} from "../cressetide/skills/vigil/scripts/head-view-snapshot.mjs";
import { canonicalJson, compareCodePoint, sha256Hex } from "../cressetide/skills/vigil/scripts/provenance-store.mjs";

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

// --- scratch repositories -----------------------------------------------------------------------

function makeRepo() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "ctide-hvs-")));
  const run = (...args) => cp.execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  run("init", "-q", "-b", "main");
  run("config", "user.email", "scratch@example.invalid");
  run("config", "user.name", "scratch");
  run("config", "commit.gpgsign", "false");
  run("config", "core.autocrlf", "false");
  // Pinned so the index-mode symlink carrier means the same thing on every platform. Windows has
  // it false already; pinning it makes the POSIX runs exercise the same carrier rather than a
  // different one, and the symlink-to-blob test below flips it back on deliberately.
  run("config", "core.symlinks", "false");
  return {
    root,
    git: run,
    write(rel, contents) {
      const file = path.join(root, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, typeof contents === "string" ? Buffer.from(contents, "utf8") : contents);
    },
    remove(rel) { fs.rmSync(path.join(root, rel), { force: true }); },
    commit(message = "c") { run("add", "-A"); run("commit", "-qm", message); },
    capture() { return captureHeadViewSnapshot({ repoRoot: root }); },
  };
}

// Every scratch repository is removed in a finally block, retried because Windows can hold a brief
// lock on freshly written .git/objects files.
async function inRepo(body) {
  const repo = makeRepo();
  try { return await body(repo); } finally {
    fs.rmSync(repo.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

const errorOf = async (fn) => {
  try { await fn(); } catch (e) {
    assert.strictEqual(e && e.name, "HeadViewSnapshotError", `expected a HeadViewSnapshotError, got ${e && e.name}: ${e && e.message}`);
    return e;
  }
  return null;
};
const failureOf = async (fn) => {
  const e = await errorOf(fn);
  return e === null ? null : e.code;
};

// A baseline repository every single-variable case starts from.
function seed(repo) {
  repo.write("package.json", '{ "type": "module" }\n');
  repo.write("nested/package.json", '{ "type": "commonjs" }\n');
  repo.write(".gitignore", "ignored.txt\nbuild/\n");
  repo.write(".ctide/test-adapters-config.json", '{ "configVersion": 1, "assignments": [] }\n');
  repo.write(".ctide/provenance.json", '{ "version": 1 }\n');
  repo.write(".ctide/output/inventory.json", '{ "entries": [] }\n');
  repo.write("test/a.test.mjs", "// a test\n");
  repo.write("lib/helper.mjs", "export const helper = 1;\n");
  repo.write("fixtures/golden.txt", "golden\n");
  repo.write("docs/notes.md", "notes\n");
  repo.commit("seed");
}

// The platform facts these tests have to bend around, measured rather than assumed.
const CASE_INSENSITIVE = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-hvs-case-"));
  try {
    fs.writeFileSync(path.join(dir, "probe.txt"), "x");
    return fs.existsSync(path.join(dir, "PROBE.TXT"));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})();
const REAL_SYMLINKS = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-hvs-link-"));
  try {
    fs.writeFileSync(path.join(dir, "target.txt"), "x");
    fs.symlinkSync("target.txt", path.join(dir, "link"));
    return fs.lstatSync(path.join(dir, "link")).isSymbolicLink();
  } catch { return false; } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})();

// ---------------------------------------------------------------------------------------------
// AC130: head view composition and ignore authority
// ---------------------------------------------------------------------------------------------

test("AC130 composition: committed, staged, unstaged, untracked and deleted", async () => {
  await inRepo(async (repo) => {
    seed(repo);
    repo.write("staged-mod.txt", "original\n");
    repo.write("to-delete.txt", "doomed\n");
    repo.commit("more");

    repo.write("staged-mod.txt", "staged bytes\n");
    repo.git("add", "staged-mod.txt");
    repo.write("staged-add.txt", "staged addition\n");
    repo.git("add", "staged-add.txt");
    repo.write("untracked.txt", "untracked\n");
    repo.remove("to-delete.txt");

    const s1 = await repo.capture();
    assert.strictEqual(s1.read("test/a.test.mjs").toString("utf8"), "// a test\n", "committed tracked file");
    assert.strictEqual(s1.read("staged-mod.txt").toString("utf8"), "staged bytes\n", "staged modification");
    assert.strictEqual(s1.read("staged-add.txt").toString("utf8"), "staged addition\n", "staged addition");
    assert.strictEqual(s1.read("untracked.txt").toString("utf8"), "untracked\n", "untracked non-ignored");
    assert.strictEqual(s1.has("to-delete.txt"), false, "a path deleted in the working tree does not exist");
  });
});

test("AC130 a path staged and then overwritten reports the working tree, not the index", async () => {
  await inRepo(async (repo) => {
    seed(repo);
    repo.write("both.txt", "committed\n");
    repo.commit("both");
    repo.write("both.txt", "STAGED\n");
    repo.git("add", "both.txt");
    repo.write("both.txt", "WORKING TREE, newest\n");

    assert.strictEqual(repo.git("show", ":both.txt"), "STAGED\n", "the index really does hold the older bytes");
    const s1 = await repo.capture();
    assert.strictEqual(s1.read("both.txt").toString("utf8"), "WORKING TREE, newest\n");
    assert.strictEqual(s1.entry("both.txt").contentDigest, sha256(Buffer.from("WORKING TREE, newest\n", "utf8")));
  });
});

test("AC130 path spelling: Git literal for tracked, directory-entry literal for untracked", async () => {
  await inRepo(async (repo) => {
    seed(repo);
    repo.write("MixedCase/TrackedFile.MJS", "tracked\n");
    repo.commit("mixed");
    repo.write("OtherCase/UntrackedFile.TXT", "untracked\n");

    const s1 = await repo.capture();
    assert.ok(s1.paths().includes("MixedCase/TrackedFile.MJS"), `tracked spelling lost: ${JSON.stringify(s1.paths())}`);
    assert.ok(s1.paths().includes("OtherCase/UntrackedFile.TXT"), `untracked spelling lost: ${JSON.stringify(s1.paths())}`);
    assert.strictEqual(s1.has("mixedcase/trackedfile.mjs"), false, "no case folding on lookup");
    assert.strictEqual(s1.has("othercase/untrackedfile.txt"), false);
  });
});

test("AC130 negative: .git/info/exclude is not an ignore authority", async () => {
  await inRepo(async (repo) => {
    seed(repo);
    repo.write("excluded-by-info.txt", "still in the universe\n");
    const before = await repo.capture();

    fs.writeFileSync(path.join(repo.root, ".git", "info", "exclude"), "excluded-by-info.txt\n");
    const after = await repo.capture();

    assert.strictEqual(after.headViewDigest, before.headViewDigest, "info/exclude must not move the digest");
    assert.deepStrictEqual(after.paths(), before.paths());
    assert.strictEqual(after.has("excluded-by-info.txt"), true);
  });
});

test("AC130 negative: core.excludesFile is not an ignore authority", async () => {
  await inRepo(async (repo) => {
    seed(repo);
    repo.write("excluded-by-global.txt", "still in the universe\n");
    const before = await repo.capture();

    const externalRules = path.join(repo.root, "..", `ctide-hvs-global-${path.basename(repo.root)}.txt`);
    fs.writeFileSync(externalRules, "excluded-by-global.txt\n");
    try {
      repo.git("config", "core.excludesFile", externalRules);
      const after = await repo.capture();
      assert.strictEqual(after.headViewDigest, before.headViewDigest, "core.excludesFile must not move the digest");
      assert.deepStrictEqual(after.paths(), before.paths());
      assert.strictEqual(after.has("excluded-by-global.txt"), true);
    } finally { fs.rmSync(externalRules, { force: true }); }
  });
});

test("AC130 the tracked .gitignore is the authority, is itself included, and never removes a tracked file", async () => {
  await inRepo(async (repo) => {
    seed(repo);
    // A file tracked BEFORE the rule exists. `git add -A` would refuse to add it afterwards, which
    // is precisely why the rule cannot untrack it either.
    repo.write("keep.log", "tracked even though *.log is ignored\n");
    repo.commit("track the log file first");
    repo.write(".gitignore", "ignored.txt\nbuild/\n*.log\n");
    repo.commit("ignore rules");
    assert.ok(repo.git("ls-files", "keep.log").includes("keep.log"), "keep.log really is tracked");
    repo.write("ignored.txt", "untracked and ignored\n");
    repo.write("build/out.js", "untracked and ignored\n");
    repo.write("scratch.log", "untracked and ignored\n");
    repo.write("kept.txt", "untracked and not ignored\n");

    const s1 = await repo.capture();
    assert.strictEqual(s1.has(".gitignore"), true, "the authority file is inside its own fingerprint");
    assert.strictEqual(s1.has("keep.log"), true, "a TRACKED file is never removed by a pattern it matches");
    assert.strictEqual(s1.has("ignored.txt"), false);
    assert.strictEqual(s1.has("build/out.js"), false);
    assert.strictEqual(s1.has("scratch.log"), false);
    assert.strictEqual(s1.has("kept.txt"), true);
  });
});

test("AC130 an untracked .gitignore is a candidate, never an authority", async () => {
  await inRepo(async (repo) => {
    seed(repo);
    repo.write("sub/.gitignore", "secret.txt\n");   // never committed
    repo.write("sub/secret.txt", "not actually ignored\n");

    const s1 = await repo.capture();
    assert.strictEqual(s1.has("sub/secret.txt"), true, "an untracked .gitignore has no authority");
    assert.strictEqual(s1.has("sub/.gitignore"), true, "it is just another untracked candidate");

    // Single variable: commit that same .gitignore and it becomes the authority.
    repo.commit("track the nested ignore file");
    const s2 = await repo.capture();
    assert.strictEqual(s2.has("sub/secret.txt"), false, "committing it makes it authoritative");
    assert.strictEqual(s2.has("sub/.gitignore"), true);
  });
});

// ---------------------------------------------------------------------------------------------
// AC131: the closed universe
// ---------------------------------------------------------------------------------------------

test("AC131 exclusions: .git/**, .ctide/provenance.json and .ctide/output/** never move the digest", async () => {
  await inRepo(async (repo) => {
    seed(repo);
    const before = await repo.capture();
    assert.strictEqual(before.has(".ctide/provenance.json"), false);
    assert.strictEqual(before.has(".ctide/output/inventory.json"), false);
    assert.ok(!before.paths().some((p) => p === ".git" || p.startsWith(".git/")));

    const variables = [
      [".git/**", () => fs.writeFileSync(path.join(repo.root, ".git", "CTIDE_SCRATCH"), "churn\n")],
      [".ctide/provenance.json", () => repo.write(".ctide/provenance.json", '{ "version": 2 }\n')],
      [".ctide/output/**", () => repo.write(".ctide/output/inventory.json", '{ "entries": [1] }\n')],
      [".ctide/output/** (new file)", () => repo.write(".ctide/output/run/ledger.json", "{}\n")],
    ];
    for (const [label, mutate] of variables) {
      mutate();
      const after = await repo.capture();
      assert.strictEqual(after.headViewDigest, before.headViewDigest, `${label} must not change headViewDigest`);
      assert.deepStrictEqual(after.paths(), before.paths(), label);
    }
  });
});

test("AC131 inclusions: each of the six named kinds moves the digest on its own", async () => {
  await inRepo(async (repo) => {
    seed(repo);
    const variables = [
      ["a test file", "test/a.test.mjs", "// a test, edited\n"],
      ["a helper module", "lib/helper.mjs", "export const helper = 2;\n"],
      ["a golden / expected-data file", "fixtures/golden.txt", "golden, edited\n"],
      [".ctide/test-adapters-config.json", ".ctide/test-adapters-config.json", '{ "configVersion": 1, "assignments": [], "x": 1 }\n'],
      ["the root package.json", "package.json", '{ "type": "module", "name": "x" }\n'],
      ["a nested package.json", "nested/package.json", '{ "type": "commonjs", "name": "y" }\n'],
      ["the tracked .gitignore", ".gitignore", "ignored.txt\nbuild/\nmore.txt\n"],
      ["an arbitrary other path", "docs/notes.md", "notes, edited\n"],
    ];
    for (const [label, file, contents] of variables) {
      const before = await repo.capture();
      repo.write(file, contents);
      const after = await repo.capture();
      assert.notStrictEqual(after.headViewDigest, before.headViewDigest, `${label} must change headViewDigest`);
      assert.strictEqual(after.has(file), true, label);
    }
    // A heuristic that only collected *.test.mjs would have missed most of the list above; assert
    // the universe really is wider than test files.
    const s = await repo.capture();
    for (const p of ["lib/helper.mjs", "fixtures/golden.txt", ".ctide/test-adapters-config.json",
      "package.json", "nested/package.json", ".gitignore", "docs/notes.md"]) {
      assert.strictEqual(s.has(p), true, `${p} must be in the closed universe`);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// AC132: gitignore semantics, through the production engine
// ---------------------------------------------------------------------------------------------

test("AC132 every gitignore semantic, evaluated from S1 bytes over the whole untracked universe", async () => {
  await inRepo(async (repo) => {
    seed(repo);
    repo.write(".gitignore", [
      "/root-only.txt",
      "build/",
      "*.log",
      "temp?.txt",
      "deep/**/generated.js",
      "[abc]-class.txt",
      "keep/*.tmp",
      "!keep/important.tmp",
      "",
    ].join("\n"));
    repo.write("nested-rules/.gitignore", "local.txt\n");
    repo.commit("ignore semantics");

    const untracked = {
      "root-only.txt": true, "sub/root-only.txt": false,
      "build/out.js": true, "build/deeper/out.js": true,
      "app.log": true, "sub/app.log": true,
      "temp1.txt": true, "temp12.txt": false,
      "deep/a/b/generated.js": true, "deep/generated.js": true, "deepXa/generated.js": false,
      "a-class.txt": true, "d-class.txt": false,
      "keep/scratch.tmp": true, "keep/important.tmp": false,
      "nested-rules/local.txt": true, "nested-rules/deeper/local.txt": true, "local.txt": false,
      "Build/CaseOut.js": false,
    };
    for (const name of Object.keys(untracked)) repo.write(name, `${name}\n`);

    const s1 = await repo.capture();
    for (const [name, ignored] of Object.entries(untracked)) {
      // A case-insensitive filesystem cannot keep Build/ and build/ apart, so that one probe is
      // only meaningful where the platform can actually hold both.
      if (name === "Build/CaseOut.js" && CASE_INSENSITIVE) continue;
      assert.strictEqual(s1.has(name), !ignored, `${name} should be ${ignored ? "ignored" : "included"}`);
    }
  });
});

test("AC132 a descendant rule cannot re-include a path under an excluded directory", async () => {
  await inRepo(async (repo) => {
    seed(repo);
    repo.write(".gitignore", "vendorish/\n");
    repo.write("vendorish/.gitignore", "!rescued.txt\n");
    repo.commit("nested negation");
    repo.write("vendorish/rescued.txt", "cannot come back\n");

    const s1 = await repo.capture();
    assert.strictEqual(s1.has("vendorish/rescued.txt"), false, "Git cannot re-include under an excluded directory");
  });
});

test("AC132 the rules that apply are the ones in S1, and every untracked path is offered to them", async () => {
  await inRepo(async (repo) => {
    seed(repo);
    repo.write(".gitignore", "*.skip\n");
    repo.commit("rules");
    for (let i = 0; i < 40; i += 1) {
      repo.write(`bulk/d${i % 7}/file-${i}.txt`, `${i}\n`);
      repo.write(`bulk/d${i % 7}/file-${i}.skip`, `${i}\n`);
    }
    const s1 = await repo.capture();
    assert.strictEqual(s1.paths().filter((p) => p.endsWith(".skip")).length, 0, "every .skip in the universe was offered and refused");
    assert.strictEqual(s1.paths().filter((p) => p.startsWith("bulk/") && p.endsWith(".txt")).length, 40, "and every sibling was offered and kept");
  });
});

// ---------------------------------------------------------------------------------------------
// AC133: symlinks
// ---------------------------------------------------------------------------------------------

test("AC133 a tracked mode 120000 entry is a symlink whose bytes are its target", async () => {
  await inRepo(async (repo) => {
    seed(repo);
    const target = "lib/helper.mjs";
    const oid = cp.execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: repo.root, input: Buffer.from(target, "utf8"), encoding: "utf8" }).trim();
    repo.git("update-index", "--add", "--cacheinfo", `120000,${oid},link-to-helper`);
    // Whatever the platform does with the working-tree side, the link body is the target string.
    repo.write("link-to-helper", target);

    const s1 = await repo.capture();
    assert.deepStrictEqual(s1.entry("link-to-helper"), { mode: "120000", type: "symlink", contentDigest: sha256(Buffer.from(target, "utf8")) });
    assert.strictEqual(s1.read("link-to-helper").toString("utf8"), target, "the bytes are the target string, not the target's content");
    assert.notStrictEqual(s1.entry("link-to-helper").contentDigest, s1.entry(target).contentDigest, "the target's content was not read through the link");
  });
});

test("AC133 a link whose target does not exist still captures", async () => {
  await inRepo(async (repo) => {
    seed(repo);
    const target = "does/not/exist.txt";
    const oid = cp.execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: repo.root, input: Buffer.from(target, "utf8"), encoding: "utf8" }).trim();
    repo.git("update-index", "--add", "--cacheinfo", `120000,${oid},dangling`);
    repo.write("dangling", target);

    const s1 = await repo.capture();
    assert.deepStrictEqual(s1.entry("dangling"), { mode: "120000", type: "symlink", contentDigest: sha256(Buffer.from(target, "utf8")) });
    assert.strictEqual(s1.has(target), false);
  });
});

// A real symlink in the working tree is a different code path from the index-mode carrier above.
// It is only reachable where the platform lets an unprivileged process create one.
test("AC133 an actual working-tree symlink is read with readlink and never followed", { skip: !REAL_SYMLINKS }, async () => {
  await inRepo(async (repo) => {
    seed(repo);
    fs.symlinkSync("lib/helper.mjs", path.join(repo.root, "real-link"));
    const s1 = await repo.capture();
    assert.deepStrictEqual(s1.entry("real-link"), { mode: "120000", type: "symlink", contentDigest: sha256(Buffer.from("lib/helper.mjs", "utf8")) });
    assert.strictEqual(s1.read("real-link").toString("utf8"), "lib/helper.mjs");
  });
});

// ---------------------------------------------------------------------------------------------
// AC134: S1 / S2 atomicity
// ---------------------------------------------------------------------------------------------

test("AC134 S1 keeps its bytes while the worktree moves under it, and S2 notices", async () => {
  await inRepo(async (repo) => {
    seed(repo);
    const s1 = await repo.capture();
    const before = s1.read("lib/helper.mjs").toString("utf8");

    repo.write("lib/helper.mjs", "export const helper = 999;\n");
    assert.strictEqual(s1.read("lib/helper.mjs").toString("utf8"), before, "S1 does not re-read the filesystem");

    const s2 = await repo.capture();
    assert.notStrictEqual(s2.headViewDigest, s1.headViewDigest);
    assert.strictEqual(s2.read("lib/helper.mjs").toString("utf8"), "export const helper = 999;\n");
  });
});

test("AC134 an unstable head view throws head-view-unstable and drops the evaluate result", async () => {
  await inRepo(async (repo) => {
    seed(repo);
    let seen = null;
    let code = null;
    let message = "";
    try {
      await withStableHeadView({
        repoRoot: repo.root,
        evaluate: (s1) => {
          seen = s1.read("lib/helper.mjs").toString("utf8");
          repo.write("lib/helper.mjs", "export const helper = 3;\n");
          // Reading again inside evaluate still gives the captured bytes.
          assert.strictEqual(s1.read("lib/helper.mjs").toString("utf8"), seen, "the in-memory result is not polluted by the live edit");
          return "THIS VALUE MUST NOT BE RETURNED";
        },
      });
    } catch (e) {
      assert.strictEqual(e.name, "HeadViewSnapshotError");
      code = e.code;
      message = e.message;
    }
    assert.strictEqual(code, "E_HEAD_VIEW_UNSTABLE");
    assert.ok(message.includes("head-view-unstable"), `the stable token is missing from: ${message}`);
    assert.strictEqual(seen, "export const helper = 1;\n");
    // Nothing was written anywhere by the component.
    assert.deepStrictEqual(fs.readdirSync(path.join(repo.root, ".ctide", "output")), ["inventory.json"]);
    assert.strictEqual(fs.readFileSync(path.join(repo.root, ".ctide", "output", "inventory.json"), "utf8"), '{ "entries": [] }\n');
  });
});

test("AC134 churn confined to excluded paths leaves the head view stable", async () => {
  await inRepo(async (repo) => {
    seed(repo);
    const result = await withStableHeadView({
      repoRoot: repo.root,
      evaluate: (s1) => {
        repo.write(".ctide/provenance.json", '{ "version": 99 }\n');
        repo.write(".ctide/output/inventory.json", '{ "entries": ["churn"] }\n');
        fs.writeFileSync(path.join(repo.root, ".git", "CTIDE_SCRATCH"), "churn\n");
        return s1.size;
      },
    });
    assert.strictEqual(typeof result.value, "number");
    assert.ok(Object.isFrozen(result), "the stable result is frozen");
    assert.deepStrictEqual(Object.keys(result).sort(), ["snapshot", "value"]);
    assert.strictEqual(result.snapshot.size, result.value);
  });
});

test("AC134 an error thrown by evaluate propagates unchanged", async () => {
  await inRepo(async (repo) => {
    seed(repo);
    const boom = new Error("caller failure");
    let caught = null;
    try {
      await withStableHeadView({ repoRoot: repo.root, evaluate: () => { throw boom; } });
    } catch (e) { caught = e; }
    assert.strictEqual(caught, boom, "the caller's own error is not repackaged as a stability verdict");
  });
});

test("AC134 the snapshot, its paths and its entries are frozen, and reads are copies", async () => {
  await inRepo(async (repo) => {
    seed(repo);
    const s1 = await repo.capture();
    assert.ok(Object.isFrozen(s1));
    assert.ok(Object.isFrozen(s1.paths()));
    assert.ok(Object.isFrozen(s1.entry("package.json")));
    assert.throws(() => { s1.paths().push("injected"); }, TypeError);

    const first = s1.read("package.json");
    first.fill(0x20);
    assert.notDeepStrictEqual(s1.read("package.json"), first, "a mutated read must not pollute the snapshot");
    assert.strictEqual(s1.read("package.json").toString("utf8"), '{ "type": "module" }\n');
    assert.strictEqual(s1.headViewDigest, (await repo.capture()).headViewDigest, "and the digest is unchanged by any of it");

    // A spread copy is a different, unfrozen object; mutating it changes nothing about the real one.
    const impostor = { ...s1 };
    impostor.headViewDigest = "0".repeat(64);
    assert.notStrictEqual(impostor.headViewDigest, s1.headViewDigest);
    assert.strictEqual(Object.isFrozen(impostor), false);
    assert.notStrictEqual(impostor, s1);
  });
});

// ---------------------------------------------------------------------------------------------
// AC135: digest completeness
// ---------------------------------------------------------------------------------------------

test("AC135 every single-variable change to the universe changes headViewDigest", async () => {
  await inRepo(async (repo) => {
    seed(repo);
    repo.write("subject.txt", "content\n");
    repo.commit("subject");

    const variables = [
      ["add a path", () => repo.write("added.txt", "new\n")],
      ["delete a path", () => repo.remove("added.txt")],
      ["rename with the same bytes", () => repo.git("mv", "docs/notes.md", "docs/renamed.md")],
      ["mode 100644 -> 100755", () => repo.git("update-index", "--chmod=+x", "subject.txt")],
      ["raw content change", () => repo.write("subject.txt", "content changed\n")],
      ["LF -> CRLF only", () => repo.write("subject.txt", "content changed\r\n")],
      ["add a BOM only", () => repo.write("subject.txt", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("content changed\r\n", "utf8")]))],
    ];
    for (const [label, mutate] of variables) {
      const before = await repo.capture();
      mutate();
      const after = await repo.capture();
      assert.notStrictEqual(after.headViewDigest, before.headViewDigest, `${label} must change headViewDigest`);
    }
  });
});

test("AC135 a blob becoming a symlink with identical bytes still changes the digest", async () => {
  await inRepo(async (repo) => {
    seed(repo);
    const body = "lib/helper.mjs";
    repo.write("switcher", body);
    repo.commit("as a blob");
    const asBlob = await repo.capture();
    assert.deepStrictEqual(asBlob.entry("switcher").type, "blob");

    const oid = cp.execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: repo.root, input: Buffer.from(body, "utf8"), encoding: "utf8" }).trim();
    repo.git("update-index", "--cacheinfo", `120000,${oid},switcher`);
    const asLink = await repo.capture();

    assert.strictEqual(asLink.entry("switcher").type, "symlink");
    assert.strictEqual(asLink.entry("switcher").contentDigest, asBlob.entry("switcher").contentDigest, "the bytes really are identical");
    assert.notStrictEqual(asLink.headViewDigest, asBlob.headViewDigest, "so only mode and type can be carrying the change");
  });
});

test("AC135 the digest is independent of discovery order and reproducible", async () => {
  const files = [
    ["z/last.txt", "z\n"], ["a/first.txt", "a\n"], ["m/middle.txt", "m\n"],
    ["package.json", '{ "type": "module" }\n'], ["unicode-é中.txt", "unicode\n"],
  ];
  const digestFor = (order) => inRepo(async (repo) => {
    for (const i of order) repo.write(files[i][0], files[i][1]);
    repo.commit("ordered");
    const s = await repo.capture();
    return { digest: s.headViewDigest, paths: s.paths() };
  });
  const forward = await digestFor([0, 1, 2, 3, 4]);
  const backward = await digestFor([4, 3, 2, 1, 0]);
  const shuffled = await digestFor([2, 0, 4, 1, 3]);
  assert.strictEqual(backward.digest, forward.digest, "creation order must not matter");
  assert.strictEqual(shuffled.digest, forward.digest);
  assert.deepStrictEqual(backward.paths, forward.paths);
  assert.deepStrictEqual(forward.paths, [...forward.paths].sort(compareCodePoint), "paths come back in code-point order");
});

test("AC135 the digest recomputes from the spec formula and from the snapshot alone", async () => {
  await inRepo(async (repo) => {
    seed(repo);
    repo.write("untracked-too.txt", "u\n");
    const s1 = await repo.capture();

    // headViewDigest = sha256Hex(canonicalJson(path -> { mode, type, contentDigest })), rebuilt here
    // from what the snapshot reports rather than from anything the module kept.
    const map = {};
    for (const p of s1.paths()) {
      const e = s1.entry(p);
      map[p] = { mode: e.mode, type: e.type, contentDigest: e.contentDigest };
      assert.strictEqual(e.contentDigest, sha256(s1.read(p)), `${p}: contentDigest is sha256 of the raw bytes`);
    }
    assert.strictEqual(sha256Hex(canonicalJson(map)), s1.headViewDigest);
    assert.strictEqual(s1.size, s1.paths().length);

    const again = await repo.capture();
    assert.strictEqual(again.headViewDigest, s1.headViewDigest, "capturing twice with no change is deterministic");
    assert.deepStrictEqual(again.paths(), s1.paths());
  });
});

// ---------------------------------------------------------------------------------------------
// Fail-closed and API shape
// ---------------------------------------------------------------------------------------------

test("the public API takes exactly one options object with an exact key set", async () => {
  await inRepo(async (repo) => {
    seed(repo);
    assert.strictEqual(await failureOf(() => captureHeadViewSnapshot()), "E_API_ARGUMENTS");
    assert.strictEqual(await failureOf(() => captureHeadViewSnapshot({ repoRoot: repo.root }, {})), "E_API_ARGUMENTS");
    assert.strictEqual(await failureOf(() => captureHeadViewSnapshot({})), "E_API_ARGUMENTS");
    for (const extra of ["gitPath", "env", "ignoreMatcher", "fs", "onCapture", "exclude"]) {
      assert.strictEqual(await failureOf(() => captureHeadViewSnapshot({ repoRoot: repo.root, [extra]: 1 })), "E_API_ARGUMENTS", extra);
    }
    assert.strictEqual(await failureOf(() => withStableHeadView({ repoRoot: repo.root })), "E_API_ARGUMENTS");
    assert.strictEqual(await failureOf(() => withStableHeadView({ repoRoot: repo.root, evaluate: () => 1 }, {})), "E_API_ARGUMENTS");
    assert.strictEqual(await failureOf(() => withStableHeadView({ repoRoot: repo.root, evaluate: "not a function" })), "E_API_ARGUMENTS");
    assert.strictEqual(await failureOf(() => captureHeadViewSnapshot({ repoRoot: 42 })), "E_REPO_ROOT");
    assert.strictEqual(await failureOf(() => captureHeadViewSnapshot({ repoRoot: "" })), "E_REPO_ROOT");
    assert.ok(HeadViewSnapshotError.prototype instanceof Error);
  });
});

test("repoRoot must be the working tree top level", async () => {
  await inRepo(async (repo) => {
    seed(repo);
    assert.strictEqual(await failureOf(() => captureHeadViewSnapshot({ repoRoot: path.join(repo.root, "lib") })), "E_REPO_ROOT", "a subdirectory is not the root");
    assert.strictEqual(await failureOf(() => captureHeadViewSnapshot({ repoRoot: path.join(repo.root, "lib", "helper.mjs") })), "E_REPO_ROOT", "a file is not a root");
    assert.strictEqual(await failureOf(() => captureHeadViewSnapshot({ repoRoot: path.join(repo.root, "absent") })), "E_REPO_ROOT", "a missing path is not a root");
  });
});

test("a non-Git directory and a bare repository are both fail-closed", async () => {
  const plain = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "ctide-hvs-plain-")));
  const bare = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "ctide-hvs-bare-")));
  try {
    cp.execFileSync("git", ["init", "-q", "--bare"], { cwd: bare, stdio: ["ignore", "pipe", "pipe"] });
    assert.strictEqual(await failureOf(() => captureHeadViewSnapshot({ repoRoot: plain })), "E_GIT_FAILED");
    assert.strictEqual(await failureOf(() => captureHeadViewSnapshot({ repoRoot: bare })), "E_REPO_ROOT");
  } finally {
    for (const dir of [plain, bare]) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("a broken index makes the Git call fail rather than produce a partial view", async () => {
  await inRepo(async (repo) => {
    seed(repo);
    fs.writeFileSync(path.join(repo.root, ".git", "index"), Buffer.from("this is not an index"));
    assert.strictEqual(await failureOf(() => repo.capture()), "E_GIT_FAILED");
  });
});

test("a conflicted index is fail-closed", async () => {
  await inRepo(async (repo) => {
    seed(repo);
    const oid = cp.execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: repo.root, input: Buffer.from("stage\n"), encoding: "utf8" }).trim();
    cp.execFileSync("git", ["update-index", "--index-info"], {
      cwd: repo.root,
      input: [1, 2, 3].map((s) => `100644 ${oid} ${s}\tconflict.txt`).join("\n") + "\n",
      stdio: ["pipe", "pipe", "pipe"],
    });
    assert.strictEqual(await failureOf(() => repo.capture()), "E_INDEX_UNMERGED");
  });
});

test("a gitlink, an unsupported working-tree type and skip-worktree are each fail-closed", async () => {
  await inRepo(async (repo) => {
    seed(repo);
    const other = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "ctide-hvs-sub-")));
    try {
      cp.execFileSync("git", ["init", "-q", "-b", "main"], { cwd: other, stdio: ["ignore", "pipe", "pipe"] });
      cp.execFileSync("git", ["config", "user.email", "s@example.invalid"], { cwd: other });
      cp.execFileSync("git", ["config", "user.name", "s"], { cwd: other });
      fs.writeFileSync(path.join(other, "a.txt"), "a\n");
      cp.execFileSync("git", ["add", "-A"], { cwd: other, stdio: ["ignore", "pipe", "pipe"] });
      cp.execFileSync("git", ["commit", "-qm", "x"], { cwd: other, stdio: ["ignore", "pipe", "pipe"] });
      const head = cp.execFileSync("git", ["rev-parse", "HEAD"], { cwd: other, encoding: "utf8" }).trim();
      repo.git("update-index", "--add", "--cacheinfo", `160000,${head},submod`);
      assert.strictEqual(await failureOf(() => repo.capture()), "E_UNSUPPORTED_ENTRY", "gitlink");
      repo.git("update-index", "--force-remove", "submod");
    } finally { fs.rmSync(other, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }

    // A tracked path whose working tree slot now holds a directory is neither blob nor symlink.
    repo.remove("docs/notes.md");
    fs.mkdirSync(path.join(repo.root, "docs", "notes.md"));
    assert.strictEqual(await failureOf(() => repo.capture()), "E_UNSUPPORTED_ENTRY", "directory in a tracked file's place");
    fs.rmdirSync(path.join(repo.root, "docs", "notes.md"));
    repo.write("docs/notes.md", "notes\n");
    assert.ok((await repo.capture()).has("docs/notes.md"), "and it recovers once the file is back");

    repo.git("update-index", "--skip-worktree", "lib/helper.mjs");
    assert.strictEqual(await failureOf(() => repo.capture()), "E_UNSUPPORTED_STATE", "skip-worktree");
    repo.git("update-index", "--no-skip-worktree", "lib/helper.mjs");
    repo.git("update-index", "--assume-unchanged", "lib/helper.mjs");
    assert.strictEqual(await failureOf(() => repo.capture()), "E_UNSUPPORTED_STATE", "assume-unchanged");
    repo.git("update-index", "--no-assume-unchanged", "lib/helper.mjs");
    assert.ok((await repo.capture()).has("lib/helper.mjs"), "and it recovers once the flag is cleared");
  });
});

// On a case-SENSITIVE tree the two spellings are two files, and both belong in the universe. This
// only runs where the filesystem measurably holds both, because pretending otherwise would prove
// nothing about Linux from a Windows run.
test("two paths differing only by case are two entries where the filesystem holds both", { skip: CASE_INSENSITIVE }, async () => {
  await inRepo(async (repo) => {
    repo.write("Case.txt", "upper\n");
    repo.write("case.txt", "lower\n");
    assert.strictEqual(fs.readdirSync(repo.root).filter((n) => n.toLowerCase() === "case.txt").length, 2,
      "the filesystem really does hold both spellings");
    repo.commit("both spellings");
    assert.deepStrictEqual(repo.git("ls-files").trim().split("\n").sort(), ["Case.txt", "case.txt"]);

    const s1 = await repo.capture();
    assert.strictEqual(s1.has("Case.txt"), true);
    assert.strictEqual(s1.has("case.txt"), true);
    assert.strictEqual(s1.size, 2);
    assert.strictEqual(s1.read("Case.txt").toString("utf8"), "upper\n");
    assert.strictEqual(s1.read("case.txt").toString("utf8"), "lower\n");
    assert.notStrictEqual(s1.entry("Case.txt").contentDigest, s1.entry("case.txt").contentDigest);

    const map = Object.create(null);
    for (const p of s1.paths()) {
      const e = s1.entry(p);
      map[p] = { mode: e.mode, type: e.type, contentDigest: e.contentDigest };
    }
    assert.strictEqual(sha256Hex(canonicalJson(map)), s1.headViewDigest, "both spellings are inside the digest");
  });
});

// Two index entries whose paths differ only by case name one file on a case-insensitive
// filesystem, so the universe cannot say which spelling the tree holds.
test("a case-only path collision is fail-closed", { skip: !CASE_INSENSITIVE }, async () => {
  await inRepo(async (repo) => {
    seed(repo);
    repo.write("Collide.txt", "one file, two spellings\n");
    const oid = cp.execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: repo.root, input: Buffer.from("one file, two spellings\n"), encoding: "utf8" }).trim();
    cp.execFileSync("git", ["update-index", "--index-info"], {
      cwd: repo.root,
      input: `100644 ${oid} 0\tCollide.txt\n100644 ${oid} 0\tcollide.txt\n`,
      stdio: ["pipe", "pipe", "pipe"],
    });
    assert.strictEqual(await failureOf(() => repo.capture()), "E_PATH_COLLISION");
  });
});

test("an empty repository and an index-only repository both capture cleanly", async () => {
  await inRepo(async (repo) => {
    const empty = await repo.capture();
    assert.strictEqual(empty.size, 0);
    assert.deepStrictEqual(empty.paths(), []);
    assert.strictEqual(empty.headViewDigest, sha256Hex(canonicalJson({})));
    assert.strictEqual(await failureOf(() => empty.read("nothing.txt")), "E_PATH_MISSING");
    assert.strictEqual(await failureOf(() => empty.entry("nothing.txt")), "E_PATH_MISSING");

    repo.write("staged-only.txt", "never committed\n");
    repo.git("add", "staged-only.txt");
    const staged = await repo.capture();
    assert.strictEqual(staged.has("staged-only.txt"), true);
    assert.notStrictEqual(staged.headViewDigest, empty.headViewDigest);
  });
});

// ---------------------------------------------------------------------------------------------
// Integrity: paths that can subvert the map, ancestors that can leave the repository, and a type
// change Git reports but the index still spells the old way
// ---------------------------------------------------------------------------------------------

test("a path named __proto__ is an own key of the digest map, not a prototype write", async () => {
  await inRepo(async (repo) => {
    repo.write("__proto__", "prototype trap\n");
    repo.write("ordinary.txt", "ordinary\n");
    repo.commit("proto");

    const s1 = await repo.capture();
    assert.strictEqual(s1.size, 2);
    assert.ok(s1.paths().includes("__proto__"));
    assert.strictEqual(s1.read("__proto__").toString("utf8"), "prototype trap\n");

    // Rebuild the map from what the snapshot reports, exactly as 11b.10 states the formula, and on
    // a null-prototype object so the rebuild itself cannot lose the key it is checking for.
    const rebuild = (snapshot) => {
      const map = Object.create(null);
      for (const p of snapshot.paths()) {
        const e = snapshot.entry(p);
        map[p] = { mode: e.mode, type: e.type, contentDigest: e.contentDigest };
      }
      assert.ok(Object.keys(map).includes("__proto__"), "the rebuilt map must hold __proto__ as an own key");
      assert.strictEqual(Object.getPrototypeOf(map), null);
      return sha256Hex(canonicalJson(map));
    };
    assert.strictEqual(s1.headViewDigest, rebuild(s1), "the digest must match the spec formula");
    assert.notStrictEqual(s1.headViewDigest, sha256Hex(canonicalJson({})), "and must not be the empty-map digest");
    // The isolated root cause, both ways round: on a plain object the assignment runs the
    // prototype setter and leaves no own key; on a null-prototype object it is an ordinary write,
    // and canonicalJson serialises it like any other key.
    const plain = {};
    plain.__proto__ = { mode: "100644" };
    assert.deepStrictEqual(Object.keys(plain), [], "a plain object silently swallows the key");
    const safe = Object.create(null);
    safe.__proto__ = { mode: "100644" };
    assert.deepStrictEqual(Object.keys(safe), ["__proto__"]);
    assert.ok(canonicalJson(safe).includes("__proto__"), "canonicalJson serialises the key rather than dropping it");

    // The file is inside the fingerprint, so both of its single-variable changes move it.
    const before = s1.headViewDigest;
    repo.write("__proto__", "prototype trap, edited\n");
    const edited = await repo.capture();
    assert.notStrictEqual(edited.headViewDigest, before, "changing its bytes must change the digest");
    assert.strictEqual(edited.headViewDigest, rebuild(edited));

    repo.remove("__proto__");
    const deleted = await repo.capture();
    assert.strictEqual(deleted.has("__proto__"), false);
    assert.notStrictEqual(deleted.headViewDigest, edited.headViewDigest, "deleting it must change the digest");
    assert.strictEqual(deleted.size, 1);
  });
});

// An ancestor that is a junction or a directory symlink is walked through by the OS before lstat or
// readFile ever reaches the leaf, so the bytes would come from wherever it points.
test("a tracked child under an ancestor junction is fail-closed and never reads outside the repo", async () => {
  const SENTINEL = "OUTSIDE SECRET, MUST NEVER BE READ\n";
  const outside = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "ctide-hvs-outside-")));
  fs.writeFileSync(path.join(outside, "f.txt"), SENTINEL);
  let linkKind = null;
  try {
    await inRepo(async (repo) => {
      seed(repo);
      repo.write("dir/f.txt", "inside the repository\n");
      repo.commit("dir");
      const clean = await repo.capture();
      assert.strictEqual(clean.read("dir/f.txt").toString("utf8"), "inside the repository\n", "the control reads the real file");

      fs.rmSync(path.join(repo.root, "dir"), { recursive: true, force: true });
      const link = path.join(repo.root, "dir");
      for (const kind of ["junction", "dir"]) {
        try { fs.symlinkSync(outside, link, kind); linkKind = kind; break; } catch { /* try the next form */ }
      }
      if (linkKind === null) return;

      try {
        assert.strictEqual(fs.lstatSync(path.join(link, "f.txt")).isFile(), true,
          "the OS really does resolve the leaf through the link, which is the hazard being closed");
        const error = await errorOf(() => repo.capture());
        assert.strictEqual(error && error.code, "E_UNSUPPORTED_ENTRY");
        assert.strictEqual(error.detail.path, "dir/f.txt");
        assert.strictEqual(error.detail.ancestor, "dir");
        assert.strictEqual(error.detail.reason, "ancestor-symlink");
        assert.ok(!error.message.includes("SECRET"), "the sentinel never reached the failure path either");
      } finally {
        // Detach the link, never its target, before the scratch repo is removed.
        try { fs.unlinkSync(link); } catch { fs.rmdirSync(link); }
      }

      // An untracked child under the same kind of ancestor is refused too.
      const otherLink = path.join(repo.root, "untracked-dir");
      fs.symlinkSync(outside, otherLink, linkKind);
      try {
        assert.strictEqual(await failureOf(() => repo.capture()), "E_UNSUPPORTED_ENTRY", "untracked side");
      } finally { try { fs.unlinkSync(otherLink); } catch { fs.rmdirSync(otherLink); } }
    });
    // Cleanup walked the repo, and the external directory came through untouched.
    assert.strictEqual(fs.readFileSync(path.join(outside, "f.txt"), "utf8"), SENTINEL, "the external target was neither read nor deleted");
    assert.deepStrictEqual(fs.readdirSync(outside), ["f.txt"]);
  } finally {
    fs.rmSync(outside, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
  assert.ok(linkKind !== null, `this platform created no junction or directory symlink, so the case did not run`);
});

// Replacing a tracked directory with an ordinary file is a legal Git state, not a broken one: the
// old children become deleted and the new file becomes untracked, and the head view already has
// words for both. It must not be confused with the junction case above, where the danger is that
// the OS would walk out of the repository.
test("a tracked directory replaced by an ordinary file: children absent, the file included", async () => {
  await inRepo(async (repo) => {
    seed(repo);
    repo.write("box/child.txt", "inside the directory\n");
    repo.commit("box");
    const before = await repo.capture();
    assert.strictEqual(before.has("box/child.txt"), true);
    assert.strictEqual(before.has("box"), false);

    fs.rmSync(path.join(repo.root, "box"), { recursive: true, force: true });
    fs.writeFileSync(path.join(repo.root, "box"), "REPLACEMENT BLOB\n");

    // What Git itself says, before asserting what the snapshot should say.
    const rawDiff = repo.git("diff-files", "--raw").trim();
    assert.match(rawDiff, /^:100644 000000 \S+ \S+ D\tbox\/child\.txt$/, `expected a deletion, got ${JSON.stringify(rawDiff)}`);
    assert.deepStrictEqual(repo.git("ls-files", "--others").trim().split("\n"), ["box"]);

    const after = await repo.capture();
    assert.strictEqual(after.has("box/child.txt"), false, "the old child is deleted, so it does not exist");
    assert.strictEqual(after.has("box"), true, "and the replacement is an ordinary untracked blob");
    assert.strictEqual(after.read("box").toString("utf8"), "REPLACEMENT BLOB\n");
    assert.deepStrictEqual(after.entry("box"), { mode: "100644", type: "blob", contentDigest: sha256(Buffer.from("REPLACEMENT BLOB\n", "utf8")) });
    assert.notStrictEqual(after.headViewDigest, before.headViewDigest);
    assert.strictEqual(after.has("lib/helper.mjs"), true, "the rest of the universe is unaffected");
  });
});

test("a missing ancestor means the leaf does not exist, not that capture fails", async () => {
  await inRepo(async (repo) => {
    seed(repo);
    repo.write("gone/f.txt", "inside\n");
    repo.commit("gone");
    fs.rmSync(path.join(repo.root, "gone"), { recursive: true, force: true });

    const s1 = await repo.capture();
    assert.strictEqual(s1.has("gone/f.txt"), false, "a deleted subtree is simply absent");
    assert.strictEqual(s1.has("lib/helper.mjs"), true, "and the rest of the universe is unaffected");
  });
});

test("an observed symlink-to-blob change is a blob, and the index carrier only speaks when Git is silent", async () => {
  await inRepo(async (repo) => {
    seed(repo);
    const body = "lib/helper.mjs";
    repo.write("switcher", body);
    const oid = cp.execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: repo.root, input: Buffer.from(body, "utf8"), encoding: "utf8" }).trim();
    repo.git("update-index", "--add", "--cacheinfo", `120000,${oid},switcher`);

    // --cacheinfo leaves zeroed stat data behind, so diff-files reports a stale entry until the
    // index is refreshed. Refresh first, or "Git is silent" would not actually be the premise
    // being tested. It exits non-zero when it does find work to do, which is not a failure here.
    try { repo.git("update-index", "--refresh"); } catch { /* reported paths needing update */ }

    // core.symlinks=false: Git has nothing to report, so the index carrier stands. This is the
    // Windows pseudo-symlink positive and it must keep working.
    assert.strictEqual(repo.git("diff-files", "--raw").trim(), "", "Git reports no change while symlinks are off");
    const asLink = await repo.capture();
    assert.deepStrictEqual(asLink.entry("switcher"), { mode: "120000", type: "symlink", contentDigest: sha256(Buffer.from(body, "utf8")) });

    // Single variable: turn symlinks on. Now Git can see that the worktree holds a regular file.
    repo.git("config", "core.symlinks", "true");
    const raw = repo.git("diff-files", "--raw").trim();
    assert.match(raw, /^:120000 100644 \S+ \S+ T\tswitcher$/, `expected a 120000 -> 100644 type change, got ${JSON.stringify(raw)}`);

    const asBlob = await repo.capture();
    assert.deepStrictEqual(asBlob.entry("switcher"), { mode: "100644", type: "blob", contentDigest: sha256(Buffer.from(body, "utf8")) });
    assert.strictEqual(asBlob.read("switcher").toString("utf8"), body, "the raw bytes are unchanged");
    assert.strictEqual(asBlob.entry("switcher").contentDigest, asLink.entry("switcher").contentDigest, "same bytes, same contentDigest");
    assert.notStrictEqual(asBlob.headViewDigest, asLink.headViewDigest, "so only mode and type can be carrying the change");
  });
});

test("an observed mode change on an ordinary blob is respected over the index mode", async () => {
  await inRepo(async (repo) => {
    seed(repo);
    repo.write("plain.txt", "plain\n");
    repo.commit("plain");
    const before = await repo.capture();
    assert.strictEqual(before.entry("plain.txt").mode, "100644");

    // Stage an executable bit; with no observed change the index mode is what stands.
    repo.git("update-index", "--chmod=+x", "plain.txt");
    const staged = await repo.capture();
    assert.strictEqual(staged.entry("plain.txt").mode, "100755");
    assert.notStrictEqual(staged.headViewDigest, before.headViewDigest);
  });
});

// ---------------------------------------------------------------------------------------------
// The process environment is not an authority (11b.10). Git configuration reachable from the
// environment can move things the canonical map is made of -- core.symlinks decides whether a
// 120000 index entry is reported as a type change, core.filemode decides an untracked file's mode
// -- so capture has to be closed to it while repo-local .git/config keeps working.
// ---------------------------------------------------------------------------------------------

// Every variable these tests touch, including the ones the production code now pins. HOMEDRIVE and
// HOMEPATH are in the list because they are a measured home fallback on Git for Windows.
const RELEVANT_ENVIRONMENT_KEYS = [
  "GIT_CONFIG", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM", "GIT_CONFIG_NOSYSTEM",
  "GIT_CONFIG_PARAMETERS", "GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0",
  "GIT_CONFIG_KEY_1", "GIT_CONFIG_VALUE_1",
  "HOME", "USERPROFILE", "XDG_CONFIG_HOME", "HOMEDRIVE", "HOMEPATH",
];

// Presence AND value, so restoration can be checked against what the runner actually started with
// rather than against an assumption that these variables were unset.
const captureEnvironment = (keys) => {
  const snapshot = new Map();
  for (const key of keys) {
    snapshot.set(key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined);
  }
  return snapshot;
};

function assertEnvironmentRestored(before, keys) {
  for (const key of keys) {
    const had = before.get(key) !== undefined;
    const present = Object.prototype.hasOwnProperty.call(process.env, key);
    assert.strictEqual(present, had, had ? `${key} was present before and must still be` : `${key} was absent before and must still be`);
    if (had) assert.strictEqual(process.env[key], before.get(key), `${key} must hold its original value`);
  }
}

// Sets variables for exactly one call and restores each key to what it was. A key that did not
// exist is deleted again rather than left holding the string "undefined".
async function withEnvironment(overrides, body) {
  const saved = new Map();
  for (const key of Object.keys(overrides)) {
    saved.set(key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined);
  }
  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    return await body();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

// A repo whose 120000 index entry is carried by an ordinary working-tree file, so core.symlinks is
// exactly the switch that decides symlink-vs-blob. makeRepo pins it to false locally.
function symlinkCarrierRepo(repo) {
  const body = "target.txt";
  repo.write("target.txt", "the target\n");
  repo.write("switcher", body);
  const oid = cp.execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: repo.root, input: Buffer.from(body, "utf8"), encoding: "utf8" }).trim();
  repo.git("add", "target.txt");
  repo.git("update-index", "--add", "--cacheinfo", `120000,${oid},switcher`);
  repo.git("commit", "-qm", "carrier");
  try { repo.git("update-index", "--refresh"); } catch { /* reported paths needing update */ }
  return body;
}

const sameSnapshot = (actual, expected, label) => {
  assert.deepStrictEqual(actual.paths(), expected.paths(), `${label}: paths`);
  for (const p of expected.paths()) {
    assert.deepStrictEqual(actual.entry(p), expected.entry(p), `${label}: entry ${p}`);
  }
  assert.strictEqual(actual.size, expected.size, `${label}: size`);
  assert.strictEqual(actual.headViewDigest, expected.headViewDigest, `${label}: headViewDigest`);
};

test("inline Git config injected through the environment cannot move an entry or the digest", async () => {
  await inRepo(async (repo) => {
    const body = symlinkCarrierRepo(repo);
    assert.strictEqual(repo.git("config", "--local", "core.symlinks").trim(), "false", "the repo-local value is what should win");

    const baseline = await repo.capture();
    assert.deepStrictEqual(baseline.entry("switcher"),
      { mode: "120000", type: "symlink", contentDigest: sha256(Buffer.from(body, "utf8")) },
      "the index carrier decides while nothing overrides it");

    // Only the production call runs poisoned. Setup, the git helper and cleanup all run outside.
    const poisoned = await withEnvironment({
      GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.symlinks", GIT_CONFIG_VALUE_0: "true",
    }, () => repo.capture());
    sameSnapshot(poisoned, baseline, "GIT_CONFIG_COUNT inline injection");
    assert.strictEqual(poisoned.entry("switcher").type, "symlink", "the entry is still the index carrier, not a blob");
    assert.strictEqual(poisoned.entry("switcher").mode, "120000");

    // The other inline surface, and a spelling that only matters where names are case-blind.
    const viaParameters = await withEnvironment({ GIT_CONFIG_PARAMETERS: "'core.symlinks=true'" }, () => repo.capture());
    sameSnapshot(viaParameters, baseline, "GIT_CONFIG_PARAMETERS");
    const viaLowercase = await withEnvironment({
      git_config_count: "1", git_config_key_0: "core.symlinks", git_config_value_0: "true",
    }, () => repo.capture());
    sameSnapshot(viaLowercase, baseline, "lowercase git_config_count");

    // A stale KEY_n left behind by a smaller COUNT must not survive either.
    const stale = await withEnvironment({
      GIT_CONFIG_COUNT: "0", GIT_CONFIG_KEY_0: "core.symlinks", GIT_CONFIG_VALUE_0: "true",
      GIT_CONFIG_KEY_1: "core.symlinks", GIT_CONFIG_VALUE_1: "true",
    }, () => repo.capture());
    sameSnapshot(stale, baseline, "stale KEY_n beyond COUNT");
  });
});

test("repository-local config is still the authority it always was", async () => {
  await inRepo(async (repo) => {
    const body = symlinkCarrierRepo(repo);
    const asCarrier = await repo.capture();
    assert.strictEqual(asCarrier.entry("switcher").type, "symlink");

    // Flipping the repo's OWN config must still be observed: closing the process, system and
    // global surfaces must not have closed .git/config with them.
    repo.git("config", "core.symlinks", "true");
    const raw = repo.git("diff-files", "--raw").trim();
    assert.match(raw, /^:120000 100644 \S+ \S+ T\tswitcher$/, `expected Git to report a type change, got ${JSON.stringify(raw)}`);
    const asBlob = await repo.capture();
    assert.deepStrictEqual(asBlob.entry("switcher"),
      { mode: "100644", type: "blob", contentDigest: sha256(Buffer.from(body, "utf8")) });
    assert.notStrictEqual(asBlob.headViewDigest, asCarrier.headViewDigest);
  });
});

test("external Git config discovery and redirection cannot reach the capture", async () => {
  const before = captureEnvironment(RELEVANT_ENVIRONMENT_KEYS);
  const side = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "ctide-hvs-config-")));
  try {
    // Two kinds of hostile carrier: one that would change a value, one that would make Git refuse
    // to start at all. The second is what proves the file was never read.
    //
    // Measured against the pre-fix module on git 2.55.0.windows.3, eight of the eleven cases in
    // this file really do fail without the fix. THREE DO NOT, and are kept for other Git versions
    // and platforms rather than because they were shown to bite here:
    //   - a stale GIT_CONFIG_KEY_n beyond GIT_CONFIG_COUNT: this Git ignores indices past the count
    //   - GIT_CONFIG_GLOBAL pointing at a VALID hostile config: `git init` writes core.symlinks
    //     into .git/config on Windows, and repo-local always outranks global
    //   - exact GIT_CONFIG: modern Git honours it for `git config` only, not for plumbing
    // The malformed carriers are what make the global, system, HOME and XDG cases bite, because a
    // file Git refuses to parse cannot be mistaken for a file Git never opened.
    const hostile = path.join(side, "hostile.gitconfig");
    fs.writeFileSync(hostile, "[core]\n\tsymlinks = true\n");
    const malformed = path.join(side, "malformed.gitconfig");
    fs.writeFileSync(malformed, "this is not a config file\n[[[\n");
    const fakeHome = path.join(side, "home");
    fs.mkdirSync(fakeHome, { recursive: true });
    fs.writeFileSync(path.join(fakeHome, ".gitconfig"), "this is not a config file\n[[[\n");
    const fakeXdg = path.join(side, "xdg");
    fs.mkdirSync(path.join(fakeXdg, "git"), { recursive: true });
    fs.writeFileSync(path.join(fakeXdg, "git", "config"), "this is not a config file\n[[[\n");

    await inRepo(async (repo) => {
      symlinkCarrierRepo(repo);
      const baseline = await repo.capture();

      const cases = [
        ["GIT_CONFIG_GLOBAL -> a hostile config", { GIT_CONFIG_GLOBAL: hostile }],
        ["GIT_CONFIG_GLOBAL -> a malformed config", { GIT_CONFIG_GLOBAL: malformed }],
        ["GIT_CONFIG_SYSTEM with GIT_CONFIG_NOSYSTEM=0", { GIT_CONFIG_SYSTEM: malformed, GIT_CONFIG_NOSYSTEM: "0" }],
        ["HOME and USERPROFILE -> a home holding a malformed config", { HOME: fakeHome, USERPROFILE: fakeHome }],
        ["XDG_CONFIG_HOME -> an xdg tree holding a malformed config", { XDG_CONFIG_HOME: fakeXdg, HOME: path.join(side, "absent"), USERPROFILE: path.join(side, "absent") }],
        ["exact GIT_CONFIG -> a malformed config", { GIT_CONFIG: malformed }],
        ["every surface at once", {
          GIT_CONFIG: malformed, GIT_CONFIG_GLOBAL: malformed, GIT_CONFIG_SYSTEM: malformed,
          GIT_CONFIG_NOSYSTEM: "0", GIT_CONFIG_PARAMETERS: "'core.symlinks=true'",
          GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.symlinks", GIT_CONFIG_VALUE_0: "true",
          HOME: fakeHome, USERPROFILE: fakeHome, XDG_CONFIG_HOME: fakeXdg,
        }],
      ];
      for (const [label, overrides] of cases) {
        const poisoned = await withEnvironment(overrides, () => repo.capture());
        sameSnapshot(poisoned, baseline, label);
      }
    });

    // The environment is back to what it WAS, which is not the same as "empty": a runner may well
    // start with HOME or USERPROFILE set, and asserting absence would fail for the wrong reason.
    // The snapshot taken before the cases ran is the thing to compare against.
    assertEnvironmentRestored(before, RELEVANT_ENVIRONMENT_KEYS);
  } finally {
    fs.rmSync(side, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

// Closing global-config DISCOVERY is not the same as closing the home a "~" expands to. A
// repository's own config may say `[include] path = ~/…`, and that tilde is resolved through the
// caller's environment when the local config is read -- so an environment can reach inside a local
// config it does not control unless every home variable is pinned.
test("a repo-local include.path with ~ cannot be redirected by the caller's home", async () => {
  const before = captureEnvironment(RELEVANT_ENVIRONMENT_KEYS);
  const fakeHome = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "ctide-hvs-home-")));
  try {
    await inRepo(async (repo) => {
      const body = symlinkCarrierRepo(repo);
      // The include lives in .git/config -- repository-local bytes -- and names its target with ~.
      fs.appendFileSync(path.join(repo.root, ".git", "config"), "[include]\n\tpath = ~/ctide-unique-poison.gitconfig\n");
      assert.ok(fs.readFileSync(path.join(repo.root, ".git", "config"), "utf8").includes("~/ctide-unique-poison.gitconfig"),
        "the include really is written into the repository's own config");

      const baseline = await repo.capture();
      assert.deepStrictEqual(baseline.entry("switcher"),
        { mode: "120000", type: "symlink", contentDigest: sha256(Buffer.from(body, "utf8")) },
        "with nothing at the include target the index carrier decides");

      fs.writeFileSync(path.join(fakeHome, "ctide-unique-poison.gitconfig"), "[core]\n\tsymlinks = true\n");
      const drive = fakeHome.slice(0, 2);
      const rest = fakeHome.slice(2);

      // Every variable Git can take a home from, hostile at once. Deleting one is not enough:
      // measured on git 2.55.0.windows.3, HOMEDRIVE + HOMEPATH supplies the home when HOME is gone.
      const cases = [
        ["HOME and USERPROFILE", { HOME: fakeHome, USERPROFILE: fakeHome }],
        ["HOME, USERPROFILE and XDG_CONFIG_HOME", { HOME: fakeHome, USERPROFILE: fakeHome, XDG_CONFIG_HOME: fakeHome }],
        ["HOMEDRIVE and HOMEPATH with HOME removed", { HOME: undefined, USERPROFILE: undefined, HOMEDRIVE: drive, HOMEPATH: rest }],
        ["every home variable at once", { HOME: fakeHome, USERPROFILE: fakeHome, XDG_CONFIG_HOME: fakeHome, HOMEDRIVE: drive, HOMEPATH: rest }],
      ];
      for (const [label, overrides] of cases) {
        const poisoned = await withEnvironment(overrides, () => repo.capture());
        sameSnapshot(poisoned, baseline, `include.path via ${label}`);
        assert.strictEqual(poisoned.entry("switcher").type, "symlink", `${label}: the entry is still the index carrier`);
        assert.strictEqual(poisoned.entry("switcher").mode, "120000", label);
      }

      // And the repository's own config is still read: a value written directly into .git/config,
      // with no tilde in sight, must still be observed.
      repo.git("config", "core.symlinks", "true");
      const asBlob = await repo.capture();
      assert.deepStrictEqual(asBlob.entry("switcher"),
        { mode: "100644", type: "blob", contentDigest: sha256(Buffer.from(body, "utf8")) },
        "closing the home expansion must not have closed .git/config itself");
      assert.notStrictEqual(asBlob.headViewDigest, baseline.headViewDigest);
    });
    assertEnvironmentRestored(before, RELEVANT_ENVIRONMENT_KEYS);
  } finally {
    fs.rmSync(fakeHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

// includeIf is the harder half of the same problem. `[include] path = ~/…` only needs the home to
// find a file; `[includeIf "gitdir:~/…"]` needs Git to canonicalise the home to decide whether the
// condition matches at all -- so a home that is not a real directory-like path makes Git refuse to
// run, on an ordinary environment as much as a hostile one.
test("a repo-local includeIf on gitdir:~ is neither honoured nor able to break the capture", async () => {
  const before = captureEnvironment(RELEVANT_ENVIRONMENT_KEYS);
  // The repository has to live UNDER the fake home for `gitdir:~/project/.git` to match it.
  const fakeHome = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "ctide-hvs-ifhome-")));
  const repoRoot = path.join(fakeHome, "project");
  try {
    fs.mkdirSync(repoRoot, { recursive: true });
    const git = (...args) => cp.execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    git("init", "-q", "-b", "main");
    git("config", "user.email", "scratch@example.invalid");
    git("config", "user.name", "scratch");
    git("config", "commit.gpgsign", "false");
    git("config", "core.autocrlf", "false");
    git("config", "core.symlinks", "false");

    const body = "target.txt";
    fs.writeFileSync(path.join(repoRoot, "target.txt"), "the target\n");
    fs.writeFileSync(path.join(repoRoot, "switcher"), Buffer.from(body, "utf8"));
    const oid = cp.execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: repoRoot, input: Buffer.from(body, "utf8"), encoding: "utf8" }).trim();
    git("add", "target.txt");
    git("update-index", "--add", "--cacheinfo", `120000,${oid},switcher`);
    git("commit", "-qm", "carrier");
    try { git("update-index", "--refresh"); } catch { /* reported paths needing update */ }

    const poison = path.join(fakeHome, "poison.gitconfig");
    fs.writeFileSync(poison, "[core]\n\tsymlinks = true\n");
    fs.appendFileSync(path.join(repoRoot, ".git", "config"),
      `[includeIf "gitdir:~/project/.git"]\n\tpath = ${poison.replaceAll("\\", "/")}\n`);

    // Prove the fixture with Git itself before asserting anything about the snapshot: this is a
    // legal config that Git honours under a hostile home and ignores under an ordinary one.
    const askGit = (env) => cp.execFileSync("git", ["config", "--bool", "core.symlinks"], {
      cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env },
    }).trim();
    assert.strictEqual(askGit({}), "false", "under an ordinary home the includeIf does not match");
    assert.strictEqual(askGit({ HOME: fakeHome, USERPROFILE: fakeHome }), "true", "under the fake home it does");

    const baseline = await captureHeadViewSnapshot({ repoRoot });
    assert.deepStrictEqual(baseline.entry("switcher"),
      { mode: "120000", type: "symlink", contentDigest: sha256(Buffer.from(body, "utf8")) },
      "the capture must succeed on a repository whose config carries a gitdir:~ condition");

    const drive = fakeHome.slice(0, 2);
    const rest = fakeHome.slice(2);
    const cases = [
      ["HOME and USERPROFILE", { HOME: fakeHome, USERPROFILE: fakeHome }],
      ["every home variable at once", { HOME: fakeHome, USERPROFILE: fakeHome, XDG_CONFIG_HOME: fakeHome, HOMEDRIVE: drive, HOMEPATH: rest }],
      ["HOMEDRIVE and HOMEPATH with HOME removed", { HOME: undefined, USERPROFILE: undefined, HOMEDRIVE: drive, HOMEPATH: rest }],
    ];
    for (const [label, overrides] of cases) {
      const poisoned = await withEnvironment(overrides, () => captureHeadViewSnapshot({ repoRoot }));
      sameSnapshot(poisoned, baseline, `includeIf via ${label}`);
      assert.strictEqual(poisoned.entry("switcher").type, "symlink", `${label}: the index carrier still decides`);
      assert.strictEqual(poisoned.entry("switcher").mode, "120000", label);
    }

    // And a value written directly into .git/config, with no condition and no tilde, still wins.
    git("config", "core.symlinks", "true");
    const asBlob = await captureHeadViewSnapshot({ repoRoot });
    assert.deepStrictEqual(asBlob.entry("switcher"),
      { mode: "100644", type: "blob", contentDigest: sha256(Buffer.from(body, "utf8")) });
    assert.notStrictEqual(asBlob.headViewDigest, baseline.headViewDigest);

    assertEnvironmentRestored(before, RELEVANT_ENVIRONMENT_KEYS);
  } finally {
    fs.rmSync(fakeHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test("paths with spaces and non-ASCII survive the NUL-delimited plumbing", async () => {
  await inRepo(async (repo) => {
    seed(repo);
    repo.write("with space/tracked file.txt", "spaced\n");
    repo.write("unicode-é中/測試.txt", "unicode\n");
    repo.commit("odd names");
    repo.write("with space/untracked file.txt", "spaced untracked\n");

    const s1 = await repo.capture();
    for (const p of ["with space/tracked file.txt", "unicode-é中/測試.txt", "with space/untracked file.txt"]) {
      assert.strictEqual(s1.has(p), true, `${p} survived -z parsing`);
    }
    assert.deepStrictEqual(s1.paths(), [...s1.paths()].sort(compareCodePoint));
  });
});
