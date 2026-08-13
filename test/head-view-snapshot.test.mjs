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

const failureOf = async (fn) => {
  try { await fn(); } catch (e) {
    assert.strictEqual(e && e.name, "HeadViewSnapshotError", `expected a HeadViewSnapshotError, got ${e && e.name}: ${e && e.message}`);
    return e.code;
  }
  return null;
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
