// AdapterContentView: the carrier, and the base and head projections that build it.
//
// Spec anchors:
//   TP = docs/superpowers/specs/2026-07-25-test-provenance-spec.md (approved v1.12)
//        11b.10 AdapterContentView, the base projection, the head projection and the entry-type
//        consumption rule; 11b.4a's case-sensitive suffix gate is exercised by the sibling preimage
//        file, not here
//   SM = docs/superpowers/specs/2026-07-25-shared-decision-provenance-model.md (approved v1.14)
//        baseTreeOid lexical grammar and the repository-semantic checks behind it
//
// Everything below drives the real public API. There is no injected Git executable, no injected
// filesystem, no environment switch and no test-only seam: fixtures are real temporary repositories
// outside this repo, and every one of them is removed in a finally block.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cp from "node:child_process";

import {
  AdapterContentViewError, captureBaseAdapterContentView, createAdapterContentView,
  isAdapterContentView, projectHeadAdapterContentView, requireAdapterContentView, requireCanonicalViewPath,
} from "../cressetide/skills/vigil/scripts/adapter-content-view.mjs";
import { captureHeadViewSnapshot, withStableHeadView } from "../cressetide/skills/vigil/scripts/head-view-snapshot.mjs";
import { createContentView, nodeTestV1Component } from "../cressetide/skills/vigil/scripts/node-test-adapter.mjs";
import { compareCodePoint } from "../cressetide/skills/vigil/scripts/provenance-store.mjs";

const B = (text) => Buffer.from(text, "utf8");
const NUL = String.fromCharCode(0);

// --- fixtures ---------------------------------------------------------------------------------------

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-acv-"));
  const git = (...args) => cp.execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q", "--initial-branch=main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  // Pinned so an index-mode symlink carrier means the same thing on every platform.
  git("config", "core.symlinks", "false");
  const write = (rel, body) => {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body, "utf8");
  };
  // A blob in the object database with no path of its own -- the raw material for a cacheinfo entry.
  const blob = (text) => cp.execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: dir, input: text, encoding: "utf8" }).trim();
  return { root: dir, git, write, blob, commit: (message = "c") => { git("add", "-A"); git("commit", "-qm", message); return git("rev-parse", "HEAD^{tree}"); } };
}

async function withRepo(body) {
  const repo = makeRepo();
  try { return await body(repo); } finally { fs.rmSync(repo.root, { recursive: true, force: true }); }
}

const refused = async (promise, what, code) => {
  let error = null;
  try { await promise; } catch (e) { error = e; }
  assert.ok(error, `${what}: must be refused`);
  assert.strictEqual(error.code, code, `${what}: expected ${code}, got ${error.code} (${error.message})`);
  return error;
};

const refusedSync = (fn, what, code) => {
  let error = null;
  try { fn(); } catch (e) { error = e; }
  assert.ok(error, `${what}: must be refused`);
  assert.strictEqual(error.code, code, `${what}: expected ${code}, got ${error.code} (${error.message})`);
  return error;
};

// --- the carrier ------------------------------------------------------------------------------------

test("11b.10 the carrier exposes exactly size, paths, has, entry and read", () => {
  const view = createAdapterContentView([["a.mjs", B("a")]]);
  assert.deepStrictEqual(Object.keys(view).sort(), ["entry", "has", "paths", "read", "size"]);
  assert.strictEqual(view.size, 1);
  assert.ok(Object.isFrozen(view));
  // No tracked and no contentDigest: both belong to HeadViewSnapshot, neither is an adapter input.
  assert.deepStrictEqual(Object.keys(view.entry("a.mjs")).sort(), ["mode", "type"]);
});

test("11b.10 paths() is Unicode code-point order, not locale order", () => {
  const view = createAdapterContentView([["Z.mjs", B("")], ["a.mjs", B("")], ["B.mjs", B("")], ["_.mjs", B("")]]);
  assert.deepStrictEqual(view.paths(), ["B.mjs", "Z.mjs", "_.mjs", "a.mjs"]);
  assert.ok(Object.isFrozen(view.paths()));
});

test("11b.10 the mode -> type mapping is closed; a gitlink and an unknown mode are fail-closed", () => {
  const view = createAdapterContentView([
    ["plain.mjs", { mode: "100644", bytes: B("x") }],
    ["exec.mjs", { mode: "100755", bytes: B("x") }],
    ["link", { mode: "120000", bytes: B("plain.mjs") }],
  ]);
  assert.deepStrictEqual(view.entry("plain.mjs"), { mode: "100644", type: "blob" });
  assert.deepStrictEqual(view.entry("exec.mjs"), { mode: "100755", type: "blob" });
  assert.deepStrictEqual(view.entry("link"), { mode: "120000", type: "symlink" });
  for (const mode of ["160000", "040000", "100664", "", "100644 "]) {
    refusedSync(() => createAdapterContentView([["x", { mode, bytes: B("") }]]), `mode ${JSON.stringify(mode)}`, "E_UNSUPPORTED_ENTRY");
  }
});

test("11b.10 a symlink stays in the view, is recognisable, and read() yields its target unfollowed", () => {
  const view = createAdapterContentView([
    ["real.mjs", B("export const x = 1;\n")],
    ["link.mjs", { mode: "120000", bytes: B("real.mjs") }],
  ]);
  // Present, and present AS a symlink: omitting it would make "there but not a legal module" and
  // "not there at all" the same observation.
  assert.ok(view.has("link.mjs"));
  assert.strictEqual(view.entry("link.mjs").type, "symlink");
  assert.strictEqual(view.read("link.mjs").toString("utf8"), "real.mjs");
  assert.notStrictEqual(view.read("link.mjs").toString("utf8"), view.read("real.mjs").toString("utf8"));
});

test("11b.10 read() hands back a copy, so a caller cannot change what the next read returns", () => {
  const view = createAdapterContentView([["a.mjs", B("original")]]);
  const first = view.read("a.mjs");
  first.write("XXXXXXXX", 0);
  assert.strictEqual(view.read("a.mjs").toString("utf8"), "original");
  assert.notStrictEqual(view.read("a.mjs"), view.read("a.mjs"));
});

test("11b.10 the brand is identity: a spread, a clone and a duck-typed look-alike are not views", () => {
  const view = createAdapterContentView([["a.mjs", B("a")]]);
  assert.ok(isAdapterContentView(view));
  const impostors = [
    ["spread copy", { ...view }],
    ["shallow clone", Object.assign(Object.create(null), view)],
    ["duck type", { size: 1, paths: () => ["a.mjs"], has: () => true, entry: () => ({ mode: "100644", type: "blob" }), read: () => B("a") }],
    ["null", null],
    ["number", 7],
  ];
  for (const [label, impostor] of impostors) {
    assert.strictEqual(isAdapterContentView(impostor), false, label);
    refusedSync(() => requireAdapterContentView(impostor, "the view"), label, "E_VIEW_INPUT");
  }
});

test("11b.10 lookup is lexical validity FIRST, then exact code-point key matching", () => {
  const view = createAdapterContentView([["src/Helper.mjs", B("x")]]);
  // A canonical path whose case differs is canonical, and simply absent. Deciding otherwise would
  // require folding the case, which this contract forbids.
  assert.strictEqual(view.has("src/helper.mjs"), false);
  assert.strictEqual(view.has("SRC/Helper.mjs"), false);
  assert.strictEqual(view.has("src/Helper.mjs"), true);
  refusedSync(() => view.entry("src/helper.mjs"), "wrong case entry()", "E_PATH_MISSING");
  refusedSync(() => view.read("src/helper.mjs"), "wrong case read()", "E_PATH_MISSING");
  // A NON-canonical argument is a different answer: it is refused, never reported as absent, so
  // "has() said false" can never mean "we quietly repaired your spelling and still missed".
  for (const bad of ["src\\Helper.mjs", "/src/Helper.mjs", "C:/src/Helper.mjs", "src/./Helper.mjs", "src/../src/Helper.mjs", "src//Helper.mjs", `src/Hel${NUL}per.mjs`, ""]) {
    refusedSync(() => view.has(bad), `has(${JSON.stringify(bad)})`, "E_PATH");
    refusedSync(() => view.entry(bad), `entry(${JSON.stringify(bad)})`, "E_PATH");
    refusedSync(() => view.read(bad), `read(${JSON.stringify(bad)})`, "E_PATH");
    refusedSync(() => requireCanonicalViewPath(bad, "p"), `requireCanonicalViewPath(${JSON.stringify(bad)})`, "E_PATH");
  }
});

test("11b.10 the constructor refuses duplicates, non-bytes, and an inexact entry object", () => {
  refusedSync(() => createAdapterContentView("not entries"), "a string", "E_VIEW_INPUT");
  refusedSync(() => createAdapterContentView([["a.mjs", B("")], ["a.mjs", B("")]]), "duplicate path", "E_VIEW_INPUT");
  refusedSync(() => createAdapterContentView({ "a.mjs": "text not bytes" }), "a string body", "E_VIEW_INPUT");
  refusedSync(() => createAdapterContentView([["a.mjs", { mode: "100644" }]]), "no bytes", "E_VIEW_INPUT");
  refusedSync(() => createAdapterContentView([["a.mjs", { mode: "100644", bytes: B(""), type: "blob" }]]), "an undeclared type key", "E_VIEW_INPUT");
  refusedSync(() => createAdapterContentView([["a.mjs", B("")]], "second"), "two arguments", "E_API_ARGUMENTS");
});

// --- one brand, shared with the adapter ---------------------------------------------------------------

test("11b.10 the adapter and the projections share ONE brand, not two compatible ones", async () => {
  // Built through the adapter's own door, consumed by the shared guard...
  const throughAdapter = createContentView({ "a.mjs": B("export const x = 1;\n") });
  assert.ok(isAdapterContentView(throughAdapter), "a view from createContentView is an AdapterContentView");
  assert.doesNotThrow(() => requireAdapterContentView(throughAdapter, "view"));

  // ...and built through the shared constructor, consumed by the adapter. If these were two brands
  // this call would be refused as a look-alike.
  const shared = createAdapterContentView({
    "package.json": B('{"type":"module"}\n'),
    "a.test.mjs": B('import { test } from "node:test";\ntest("n", () => {});\n'),
  });
  const analysis = await nodeTestV1Component.analyzeView({ view: shared, modulePaths: ["a.test.mjs"] });
  assert.strictEqual(analysis.modules.length, 1);
  assert.strictEqual(analysis.modules[0].declarations[0].structuralId, 's:["n"]');
});

test("11b.10 a symlink is never parsed as a module, and a symlinked package.json is refused", async () => {
  const view = createAdapterContentView({
    "package.json": { mode: "100644", bytes: B('{"type":"module"}\n') },
    "linked.test.mjs": { mode: "120000", bytes: B("real.test.mjs") },
    "real.test.mjs": { mode: "100644", bytes: B('import { test } from "node:test";\ntest("n", () => {});\n') },
  });
  await refused(nodeTestV1Component.analyzeModule({ view, path: "linked.test.mjs" }), "a symlink module", "E_ENTRY_TYPE");

  const manifestLink = createAdapterContentView({
    "package.json": { mode: "120000", bytes: B("elsewhere/package.json") },
    "a.test.js": { mode: "100644", bytes: B('import { test } from "node:test";\ntest("n", () => {});\n') },
  });
  await refused(nodeTestV1Component.analyzeModule({ view: manifestLink, path: "a.test.js" }), "a symlinked manifest", "E_ENTRY_TYPE");
});

// --- base projection ------------------------------------------------------------------------------------

test("11b.10 base: the request key set is exact and nothing else can be supplied", async () => {
  await withRepo(async (repo) => {
    repo.write("a.mjs", "export const x = 1;\n");
    const tree = repo.commit();
    for (const [label, request] of [
      ["an extra key", { repoRoot: repo.root, baseTreeOid: tree, git: "git" }],
      ["a missing key", { repoRoot: repo.root }],
      ["a prebuilt view", { repoRoot: repo.root, baseTreeOid: tree, view: createAdapterContentView({}) }],
      ["an environment", { repoRoot: repo.root, baseTreeOid: tree, env: {} }],
      ["an array", []],
      ["null", null],
    ]) {
      await refused(captureBaseAdapterContentView(request), label, "E_API_ARGUMENTS");
    }
    await refused(captureBaseAdapterContentView({ repoRoot: repo.root, baseTreeOid: tree }, {}), "a second argument", "E_API_ARGUMENTS");
  });
});

test("SM v1.14 base: the OID is a full lowercase hex object name, never a revision expression", async () => {
  await withRepo(async (repo) => {
    repo.write("a.mjs", "export const x = 1;\n");
    const tree = repo.commit();
    for (const oid of ["HEAD", "HEAD^{tree}", "main", tree.slice(0, 12), tree.toUpperCase(), `${tree}0`, "", "  " + tree, 7, null]) {
      await refused(captureBaseAdapterContentView({ repoRoot: repo.root, baseTreeOid: oid }),
        `baseTreeOid ${JSON.stringify(oid)}`, "E_BASE_TREE_OID");
    }
    // A perfectly-shaped OID that names nothing is a repository-semantic failure, not a lexical one.
    await refused(captureBaseAdapterContentView({ repoRoot: repo.root, baseTreeOid: "0".repeat(40) }), "an absent object", "E_BASE_TREE_OID");
    // 64 hex is lexically legal but is the wrong width for this sha1 repository.
    await refused(captureBaseAdapterContentView({ repoRoot: repo.root, baseTreeOid: "a".repeat(64) }), "a sha256-width OID in a sha1 repo", "E_BASE_TREE_OID");
  });
});

test("SM v1.14 base: the object's OWN type must be tree; peeling does not count", async () => {
  await withRepo(async (repo) => {
    repo.write("a.mjs", "export const x = 1;\n");
    const tree = repo.commit();
    const commit = repo.git("rev-parse", "HEAD");
    repo.git("tag", "-a", "v1", "-m", "t");
    const tag = repo.git("rev-parse", "v1");
    const blobOid = repo.git("rev-parse", "HEAD:a.mjs");

    const fromCommit = await refused(captureBaseAdapterContentView({ repoRoot: repo.root, baseTreeOid: commit }), "a commit", "E_BASE_TREE_OID");
    assert.match(fromCommit.message, /is a commit, not a tree/);
    const fromTag = await refused(captureBaseAdapterContentView({ repoRoot: repo.root, baseTreeOid: tag }), "an annotated tag", "E_BASE_TREE_OID");
    assert.match(fromTag.message, /is a tag, not a tree/);
    await refused(captureBaseAdapterContentView({ repoRoot: repo.root, baseTreeOid: blobOid }), "a blob", "E_BASE_TREE_OID");
    // The tree itself is accepted, so the three refusals above are about the type and nothing else.
    assert.strictEqual((await captureBaseAdapterContentView({ repoRoot: repo.root, baseTreeOid: tree })).size, 1);
  });
});

test("11b.10 base: leaves recurse, directories are not entries, and modes survive", async () => {
  await withRepo(async (repo) => {
    repo.write("top.mjs", "export const a = 1;\n");
    repo.write("deep/nested/inner.mjs", "export const b = 2;\n");
    repo.write("script.sh", "#!/bin/sh\n");
    repo.git("add", "-A");
    repo.git("update-index", "--chmod=+x", "script.sh");
    const linkOid = repo.blob("deep/nested/inner.mjs");
    repo.git("update-index", "--add", "--cacheinfo", `120000,${linkOid},shortcut`);
    repo.git("commit", "-qm", "base");
    const tree = repo.git("rev-parse", "HEAD^{tree}");

    const view = await captureBaseAdapterContentView({ repoRoot: repo.root, baseTreeOid: tree });
    assert.deepStrictEqual(view.paths(), ["deep/nested/inner.mjs", "script.sh", "shortcut", "top.mjs"]);
    // "deep" and "deep/nested" are recursed into, never listed.
    assert.strictEqual(view.has("deep"), false);
    assert.strictEqual(view.has("deep/nested"), false);
    assert.deepStrictEqual(view.entry("script.sh"), { mode: "100755", type: "blob" });
    assert.deepStrictEqual(view.entry("shortcut"), { mode: "120000", type: "symlink" });
    assert.strictEqual(view.read("shortcut").toString("utf8"), "deep/nested/inner.mjs");
    assert.strictEqual(view.read("deep/nested/inner.mjs").toString("utf8"), "export const b = 2;\n");
  });
});

test("11b.10 base: a gitlink in the tree is fail-closed, not silently dropped", async () => {
  await withRepo(async (repo) => {
    repo.write("a.mjs", "export const x = 1;\n");
    repo.git("add", "-A");
    repo.git("commit", "-qm", "base");
    const commit = repo.git("rev-parse", "HEAD");
    repo.git("update-index", "--add", "--cacheinfo", `160000,${commit},submod`);
    repo.git("commit", "-qm", "with a gitlink");
    const tree = repo.git("rev-parse", "HEAD^{tree}");
    const error = await refused(captureBaseAdapterContentView({ repoRoot: repo.root, baseTreeOid: tree }), "a gitlink", "E_UNSUPPORTED_ENTRY");
    assert.match(error.message, /submod is a gitlink/);
  });
});

test("11b.10 base: head exclusions and .gitignore are NOT applied to a committed tree", async () => {
  await withRepo(async (repo) => {
    // Every one of these is excluded from the HEAD universe. On a committed tree they are content,
    // and dropping them would delete committed material out of the base.
    repo.write(".gitignore", "ignored/\n*.ignored\n");
    repo.write(".ctide/provenance.json", '{"provenanceVersion":2}\n');
    repo.write(".ctide/output/report.json", "{}\n");
    repo.write("ignored/still-committed.mjs", "export const x = 1;\n");
    repo.write("thing.ignored", "committed anyway\n");
    repo.write("a.mjs", "export const a = 1;\n");
    repo.git("add", "-A", "-f");
    repo.git("commit", "-qm", "base");
    const tree = repo.git("rev-parse", "HEAD^{tree}");

    const base = await captureBaseAdapterContentView({ repoRoot: repo.root, baseTreeOid: tree });
    for (const p of [".gitignore", ".ctide/provenance.json", ".ctide/output/report.json", "ignored/still-committed.mjs", "thing.ignored", "a.mjs"]) {
      assert.ok(base.has(p), `${p} must survive into the base view`);
    }
    // The head view, by contrast, applies the four-step precedence -- which is exactly why the two
    // sides need separate rules rather than one shared filter.
    const head = await captureHeadViewSnapshot({ repoRoot: repo.root });
    assert.strictEqual(head.has(".ctide/provenance.json"), false);
    assert.strictEqual(head.has(".ctide/output/report.json"), false);
  });
});

test("11b.10 base: bytes come from the object database, never from the live worktree", async () => {
  await withRepo(async (repo) => {
    repo.write("a.mjs", "committed bytes\n");
    const tree = repo.commit();

    // Dirty the worktree in every way that would matter if anything here read files by name.
    repo.write("a.mjs", "WORKTREE BYTES THAT MUST NOT BE READ\n");
    repo.write("untracked.mjs", "never committed\n");
    fs.rmSync(path.join(repo.root, "a.mjs"));
    repo.write("a.mjs", "and rewritten again\n");

    const view = await captureBaseAdapterContentView({ repoRoot: repo.root, baseTreeOid: tree });
    assert.strictEqual(view.read("a.mjs").toString("utf8"), "committed bytes\n");
    assert.strictEqual(view.has("untracked.mjs"), false);
    assert.strictEqual(view.size, 1);
  });
});

test("11b.10 base: deleting the worktree file entirely leaves the base view unchanged", async () => {
  await withRepo(async (repo) => {
    repo.write("gone.mjs", "still in the tree\n");
    const tree = repo.commit();
    fs.rmSync(path.join(repo.root, "gone.mjs"));
    const view = await captureBaseAdapterContentView({ repoRoot: repo.root, baseTreeOid: tree });
    assert.strictEqual(view.read("gone.mjs").toString("utf8"), "still in the tree\n");
  });
});

test("11b.10 base: capturing writes nothing and leaves no residue in the repository", async () => {
  await withRepo(async (repo) => {
    repo.write("a.mjs", "export const x = 1;\n");
    const tree = repo.commit();
    const before = repo.git("status", "--porcelain", "--untracked-files=all");
    await captureBaseAdapterContentView({ repoRoot: repo.root, baseTreeOid: tree });
    await captureBaseAdapterContentView({ repoRoot: repo.root, baseTreeOid: tree });
    assert.strictEqual(repo.git("status", "--porcelain", "--untracked-files=all"), before);
    assert.strictEqual(before, "");
  });
});

test("11b.10 base: an unusable repoRoot is refused before any Git call", async () => {
  await refused(captureBaseAdapterContentView({ repoRoot: "", baseTreeOid: "a".repeat(40) }), "an empty root", "E_REPO_ROOT");
  await refused(captureBaseAdapterContentView({ repoRoot: path.join(os.tmpdir(), "ctide-acv-absent-directory"), baseTreeOid: "a".repeat(40) }),
    "a missing root", "E_REPO_ROOT");
});

// --- head projection -------------------------------------------------------------------------------------

test("11b.10 head: the projection mirrors S1's paths, modes, types and bytes exactly", async () => {
  await withRepo(async (repo) => {
    repo.write("a.mjs", "export const a = 1;\n");
    repo.write("lib/b.mjs", "export const b = 2;\n");
    repo.git("add", "-A");
    const linkOid = repo.blob("a.mjs");
    repo.git("update-index", "--add", "--cacheinfo", `120000,${linkOid},pointer`);
    // Whatever the platform does with the working-tree side, the link body is the target string.
    repo.write("pointer", "a.mjs");
    repo.git("commit", "-qm", "base");

    const s1 = await captureHeadViewSnapshot({ repoRoot: repo.root });
    const view = projectHeadAdapterContentView(s1);
    assert.ok(isAdapterContentView(view));
    assert.deepStrictEqual(view.paths(), s1.paths());
    assert.strictEqual(view.size, s1.size);
    for (const p of s1.paths()) {
      const snapshotEntry = s1.entry(p);
      assert.deepStrictEqual(view.entry(p), { mode: snapshotEntry.mode, type: snapshotEntry.type }, p);
      assert.deepStrictEqual(view.read(p), s1.read(p), p);
    }
    assert.strictEqual(view.entry("pointer").type, "symlink");
  });
});

test("11b.10 head: the projection drops tracked and contentDigest", async () => {
  await withRepo(async (repo) => {
    repo.write("a.mjs", "export const a = 1;\n");
    repo.commit();
    repo.write("untracked.mjs", "not committed\n");

    const s1 = await captureHeadViewSnapshot({ repoRoot: repo.root });
    const view = projectHeadAdapterContentView(s1);
    // The snapshot knows both facts about the untracked file...
    assert.strictEqual(s1.entry("untracked.mjs").tracked, false);
    assert.match(s1.entry("untracked.mjs").contentDigest, /^[0-9a-f]{64}$/);
    // ...and the view carries neither, for either file.
    for (const p of ["a.mjs", "untracked.mjs"]) {
      assert.deepStrictEqual(Object.keys(view.entry(p)).sort(), ["mode", "type"], p);
    }
  });
});

test("11b.10 head: a projection built inside evaluate is the object the adapter accepts", async () => {
  await withRepo(async (repo) => {
    repo.write("package.json", '{"type":"module"}\n');
    repo.write("a.test.mjs", 'import { test } from "node:test";\ntest("inside evaluate", () => {});\n');
    repo.commit();

    const stable = await withStableHeadView({
      repoRoot: repo.root,
      evaluate: async (s1) => {
        const view = projectHeadAdapterContentView(s1);
        return nodeTestV1Component.analyzeView({ view, modulePaths: ["a.test.mjs"] });
      },
    });
    assert.strictEqual(stable.value.modules[0].declarations[0].structuralId, 's:["inside evaluate"]');
  });
});

test("11b.10 head: the projection refuses anything that is not a captured snapshot", () => {
  for (const [label, value] of [["null", null], ["a number", 3], ["an empty object", {}], ["a partial duck", { paths: () => [] }]]) {
    refusedSync(() => projectHeadAdapterContentView(value), label, "E_VIEW_INPUT");
  }
  refusedSync(() => projectHeadAdapterContentView({ paths: () => [], entry: () => ({}), read: () => Buffer.alloc(0) }, "second"),
    "a second argument", "E_API_ARGUMENTS");
});

// --- Git isolation the base projection depends on --------------------------------------------------------

test("11b.10 base: a replacement ref cannot redirect the exact tree the OID names", async () => {
  await withRepo(async (repo) => {
    repo.write("a.mjs", "the A side\n");
    const treeA = repo.commit("A");
    fs.rmSync(path.join(repo.root, "a.mjs"));
    repo.write("b.mjs", "the B side\n");
    const treeB = repo.commit("B");
    assert.notStrictEqual(treeA, treeB);

    // refs/replace is repository state, not caller input: anyone who can write a ref can install one,
    // and Git then serves the replacement everywhere without saying so. §11b.10 says baseTreeOid names
    // an EXACT immutable tree, so the capture has to see through it.
    repo.git("replace", treeA, treeB);
    assert.strictEqual(repo.git("replace", "-l"), treeA, "the fixture really installed a replacement ref");
    // Proof the replacement is live for ordinary Git in this repository.
    assert.match(repo.git("ls-tree", "-r", "--name-only", treeA), /b\.mjs/);

    const view = await captureBaseAdapterContentView({ repoRoot: repo.root, baseTreeOid: treeA });
    assert.deepStrictEqual(view.paths(), ["a.mjs"], "the capture read tree A, not its replacement");
    assert.strictEqual(view.read("a.mjs").toString("utf8"), "the A side\n");
    assert.strictEqual(view.has("b.mjs"), false);
    // And the ref is still there: the capture saw through it rather than deleting it.
    assert.strictEqual(repo.git("replace", "-l"), treeA);
  });
});

test("11b.10 base: a partial clone is fail-closed, never completed over the network", async () => {
  // Entirely local: a source repository, a bare file:// remote, and a blob-filtered clone. Nothing
  // here reaches the network, and the only URL used is the scratch file:// remote.
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-acv-src-"));
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-acv-bare-"));
  const partial = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-acv-partial-"));
  try {
    const git = (cwd, ...args) => cp.execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    git(source, "init", "-q", "--initial-branch=main");
    git(source, "config", "user.email", "t@example.com");
    git(source, "config", "user.name", "t");
    git(source, "config", "commit.gpgsign", "false");
    fs.writeFileSync(path.join(source, "a.mjs"), "bytes that were never downloaded\n", "utf8");
    git(source, "add", "-A");
    git(source, "commit", "-qm", "seed");
    const blobOid = git(source, "rev-parse", "HEAD:a.mjs");

    fs.rmSync(bare, { recursive: true, force: true });
    git(os.tmpdir(), "clone", "-q", "--bare", source, bare);
    git(bare, "config", "uploadpack.allowFilter", "true");
    git(bare, "config", "uploadpack.allowAnySHA1InWant", "true");

    fs.rmSync(partial, { recursive: true, force: true });
    git(os.tmpdir(), "clone", "-q", "--filter=blob:none", "--no-checkout", "file:///" + bare.replace(/\\/g, "/"), partial);
    const tree = git(partial, "rev-parse", "HEAD^{tree}");

    // The probe disables lazy fetching itself, so it reports what is LOCAL rather than what Git could
    // obtain -- otherwise the "before" reading would fetch the very object it is asking about.
    const localHas = () => cp.spawnSync("git", ["cat-file", "-e", blobOid], {
      cwd: partial, encoding: "utf8", env: { ...process.env, GIT_NO_LAZY_FETCH: "1" },
    }).status === 0;
    const packs = () => {
      const dir = path.join(partial, ".git", "objects", "pack");
      return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".pack")).length : 0;
    };
    const loose = () => {
      const dir = path.join(partial, ".git", "objects");
      let n = 0;
      for (const d of fs.readdirSync(dir)) if (/^[0-9a-f]{2}$/.test(d)) n += fs.readdirSync(path.join(dir, d)).length;
      return n;
    };

    const before = { local: localHas(), packs: packs(), loose: loose() };
    assert.strictEqual(before.local, false, "the fixture requires the blob to be genuinely absent before the call");

    const error = await refused(captureBaseAdapterContentView({ repoRoot: partial, baseTreeOid: tree }),
      "a promisor blob that is not local", "E_OBJECT_UNAVAILABLE");
    assert.strictEqual(error.detail.oid, blobOid);
    assert.match(error.message, /will not fetch it/);

    // The refusal is not a download that happened to fail: nothing arrived and nothing was written.
    assert.strictEqual(localHas(), false, "the blob is still not local");
    assert.strictEqual(packs(), before.packs, "no pack was added");
    assert.strictEqual(loose(), before.loose, "no loose object was added");
  } finally {
    for (const d of [source, bare, partial]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test("11b.10 base: the isolation closures are passed as command-line options, not only as variables", async () => {
  // WHY THIS EXISTS. An environment variable a Git build does not recognise is ignored in silence,
  // so a version that predates GIT_NO_LAZY_FETCH would happily demand-fetch while the variable sat
  // there doing nothing. The options cannot be ignored, so the capture has to really pass them --
  // and this asserts on the argv the component itself reports having run, through the public API.
  const notARepo = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-acv-norepo-"));
  try {
    const error = await refused(captureBaseAdapterContentView({ repoRoot: notARepo, baseTreeOid: "a".repeat(40) }),
      "a directory that is not a repository", "E_GIT_FAILED");
    assert.deepStrictEqual(error.detail.args.slice(0, 3), ["--no-replace-objects", "--no-lazy-fetch", "rev-parse"],
      "both closures are global options, and they come BEFORE the subcommand");
  } finally { fs.rmSync(notARepo, { recursive: true, force: true }); }
});

test("11b.10 base: a Git that does not know an isolation option fails closed, it does not fetch", async () => {
  // The cross-version half of the claim, evidenced without pretending to have run an old Git.
  //
  // Two facts are measured here on the Git actually in use. First, the options this component passes
  // ARE understood by it, so they are doing their job rather than being tolerated. Second -- and
  // this is the part that speaks about older builds -- an unrecognised global option makes Git exit
  // non-zero with "unknown option" BEFORE the subcommand runs, so a build that does not know
  // --no-lazy-fetch refuses rather than running with fetching quietly re-enabled. The second case
  // uses a deliberately unknown option as the stand-in: no Git older than the flag was installed to
  // produce it, and this file does not claim otherwise.
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-acv-flag-src-"));
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-acv-flag-bare-"));
  const partial = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-acv-flag-partial-"));
  try {
    const git = (cwd, ...args) => cp.execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    git(source, "init", "-q", "--initial-branch=main");
    git(source, "config", "user.email", "t@example.com");
    git(source, "config", "user.name", "t");
    git(source, "config", "commit.gpgsign", "false");
    fs.writeFileSync(path.join(source, "a.mjs"), "never downloaded\n", "utf8");
    git(source, "add", "-A");
    git(source, "commit", "-qm", "seed");
    const blobOid = git(source, "rev-parse", "HEAD:a.mjs");

    fs.rmSync(bare, { recursive: true, force: true });
    git(os.tmpdir(), "clone", "-q", "--bare", source, bare);
    git(bare, "config", "uploadpack.allowFilter", "true");
    fs.rmSync(partial, { recursive: true, force: true });
    git(os.tmpdir(), "clone", "-q", "--filter=blob:none", "--no-checkout", "file:///" + bare.replace(/\\/g, "/"), partial);

    const localHas = () => cp.spawnSync("git", ["cat-file", "-e", blobOid], {
      cwd: partial, encoding: "utf8", env: { ...process.env, GIT_NO_LAZY_FETCH: "1" },
    }).status === 0;
    const packs = () => {
      const dir = path.join(partial, ".git", "objects", "pack");
      return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".pack")).length : 0;
    };
    assert.strictEqual(localHas(), false, "the fixture needs the blob to start out absent");
    const packsBefore = packs();

    // 1. Both options are understood by the Git in use: no "unknown option", and the read of a
    //    missing promisor object is refused rather than completed.
    const supported = cp.spawnSync("git", ["--no-replace-objects", "--no-lazy-fetch", "cat-file", "blob", blobOid],
      { cwd: partial, encoding: "utf8" });
    assert.notStrictEqual(supported.status, 0, "the missing blob must not be produced");
    assert.doesNotMatch(supported.stderr, /unknown option/, "the options are recognised by this Git");

    // 2. An UNRECOGNISED global option -- what --no-lazy-fetch is on a Git that predates it -- makes
    //    Git refuse before doing any work, so the fallback is a refusal and never a lazy fetch.
    const unknown = cp.spawnSync("git", ["--no-such-isolation-option", "cat-file", "blob", blobOid],
      { cwd: partial, encoding: "utf8" });
    assert.notStrictEqual(unknown.status, 0);
    assert.match(unknown.stderr, /unknown option/);
    assert.strictEqual(localHas(), false, "the unknown-option run fetched nothing");
    assert.strictEqual(packs(), packsBefore, "the unknown-option run wrote nothing");
  } finally {
    for (const d of [source, bare, partial]) fs.rmSync(d, { recursive: true, force: true });
  }
});

// --- the head-view brand bridge ------------------------------------------------------------------------

test("11b.10 head: a COMPLETE caller-crafted snapshot cannot be laundered into a branded view", async () => {
  await withRepo(async (repo) => {
    repo.write("package.json", '{"type":"module"}\n');
    repo.write("real.test.mjs", 'import { test } from "node:test";\ntest("really captured", () => {});\n');
    repo.commit();

    // Nothing partial about this object: every member a real snapshot exposes is present, with
    // plausible values and working behaviour. Shape is not evidence of provenance.
    const forged = new Map([
      ["package.json", Buffer.from('{"type":"module"}\n', "utf8")],
      ["forged.test.mjs", Buffer.from('import { test } from "node:test";\ntest("written by the caller", () => {});\n', "utf8")],
    ]);
    const duck = {
      size: forged.size,
      headViewDigest: "f".repeat(64),
      paths: () => [...forged.keys()].sort(compareCodePoint),
      has: (p) => forged.has(p),
      entry: () => ({ mode: "100644", type: "blob", contentDigest: "0".repeat(64), tracked: true }),
      read: (p) => Buffer.from(forged.get(p)),
    };
    // Every member the real snapshot has, so this is not a partial-duck test.
    const genuine = await captureHeadViewSnapshot({ repoRoot: repo.root });
    for (const key of Object.keys(genuine)) {
      assert.ok(key in duck, `the forgery must carry ${key} for this test to mean anything`);
    }

    refusedSync(() => projectHeadAdapterContentView(duck), "a complete forgery", "E_VIEW_INPUT");
    // The laundering path specifically: no branded view may exist for those bytes.
    let laundered = null;
    try { laundered = projectHeadAdapterContentView(duck); } catch { /* expected */ }
    assert.strictEqual(laundered, null);
    assert.strictEqual(isAdapterContentView(laundered), false);

    // A spread of a REAL snapshot is refused too: the brand is identity, and a copy is a new object.
    refusedSync(() => projectHeadAdapterContentView({ ...genuine }), "a spread of a real snapshot", "E_VIEW_INPUT");
    refusedSync(() => projectHeadAdapterContentView(Object.assign(Object.create(null), genuine)), "a clone", "E_VIEW_INPUT");

    // ...while the genuine article still projects, so the guard costs nothing legitimate.
    const view = projectHeadAdapterContentView(genuine);
    assert.ok(isAdapterContentView(view));
    assert.ok(view.has("real.test.mjs"));
    assert.strictEqual(view.has("forged.test.mjs"), false);
  });
});

test("the error class is this module's own, with a code on every refusal", () => {
  const error = refusedSync(() => createAdapterContentView([["a\\b.mjs", B("")]]), "a backslash path", "E_PATH");
  assert.ok(error instanceof AdapterContentViewError);
  assert.strictEqual(error.name, "AdapterContentViewError");
});
