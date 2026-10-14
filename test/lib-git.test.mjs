// Unit tests for cressetide/lib/git.mjs: the raw-result git() wrapper, its neutralized configuration and
// environment, gitOrThrow, headState, parseCount and changedFiles. Fixtures are built with the hermetic
// fixture git from helpers.mjs; the code under test runs with this process's own environment, which a test
// changes (setEnv) only for its own duration.
import assert from "node:assert/strict";
import cp from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { git as fixtureGit, makeRepo, tempDir, test, write } from "./helpers.mjs";
import { NEUTRAL_CONFIG, NEUTRAL_CONFIG_ARGS, changedFiles, git, gitOrThrow, headState, parseCount } from "../cressetide/lib/git.mjs";

const LIB_GIT_URL = new URL("../cressetide/lib/git.mjs", import.meta.url).href;
const GIT = "git";

// Sets process.env entries (undefined deletes one) until the running test ends. On Windows process.env is
// case-insensitive, so PATH here is the same variable as Path.
function setEnv(t, vars) {
  const saved = Object.keys(vars).map((key) => [key, process.env[key]]);
  const assign = (entries) => {
    for (const [key, value] of entries) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  };
  t.after(() => assign(saved));
  assign(Object.entries(vars));
}

// Sets process.env entries for the duration of fn only.
function withEnv(vars, fn) {
  const saved = Object.keys(vars).map((key) => [key, process.env[key]]);
  for (const [key, value] of Object.entries(vars)) process.env[key] = value;
  try { return fn(); } finally {
    for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}

// A global git config file with the given "section.key" = value settings.
function globalConfig(settings) {
  const file = path.join(tempDir("ctide-lib-git-config-"), "gitconfig");
  const body = Object.entries(settings).map(([dotted, value]) => {
    const dot = dotted.indexOf(".");
    return `[${dotted.slice(0, dot)}]\n\t${dotted.slice(dot + 1)} = ${value}\n`;
  }).join("");
  fs.writeFileSync(file, body, "utf8");
  return file;
}

// git without the wrapper, with the process environment plus `env` — the control showing that a hostile
// setting really changes git's output, so a test of its neutralization is not vacuous.
function rawGit(cwd, args, env = {}) {
  return cp.spawnSync(GIT, ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } });
}

// The OS-specific empty PATH directory for "git missing" cases.
function emptyPath() { return tempDir("ctide-lib-git-nopath-"); }

// A commit object with a bogus gpgsig header (same tree as HEAD), made the branch tip, so that
// log.showSignature=true has a signature to (fail to) verify and print about.
function addBogusSignedCommit(repo) {
  const tree = fixtureGit(repo, ["rev-parse", "HEAD^{tree}"]);
  const parent = fixtureGit(repo, ["rev-parse", "HEAD"]);
  const body = [
    `tree ${tree}`, `parent ${parent}`,
    "author Ctide Test <test@example.invalid> 1767225600 +0000",
    "committer Ctide Test <test@example.invalid> 1767225600 +0000",
    "gpgsig -----BEGIN PGP SIGNATURE-----", " ", " iQEzBAABCAAdFiEE", " -----END PGP SIGNATURE-----",
    "", "signed subject", "",
  ].join("\n");
  const sha = fixtureGit(repo, ["hash-object", "-t", "commit", "-w", "--stdin"], { input: body });
  fixtureGit(repo, ["update-ref", "refs/heads/main", sha]);
  return sha;
}

function stageGitlink(repo, name, sha) {
  fixtureGit(repo, ["update-index", "--add", "--cacheinfo", `160000,${sha},${name}`]);
}

// --- git(): the raw result ---

test("git(): returns the raw spawnSync result for a success and a failure, never throwing", () => {
  const repo = makeRepo({ files: { "a.txt": "a\n" } });
  const head = fixtureGit(repo, ["rev-parse", "HEAD"]);
  const ok = git(repo, ["rev-parse", "HEAD"]);
  assert.equal(ok.status, 0);
  assert.equal(ok.signal, null);
  assert.equal(ok.error, undefined);
  assert.equal(ok.stdout, `${head}\n`);
  assert.equal(typeof ok.stderr, "string");
  const failed = git(repo, ["rev-parse", "--verify", "no-such-ref"]);
  assert.equal(failed.status, 128);
  assert.equal(failed.error, undefined);
  assert.match(failed.stderr, /fatal/);
});

test("git(): with git missing from PATH, error.code is ENOENT and nothing is thrown", (t) => {
  const repo = makeRepo({ files: { "a.txt": "a\n" } });
  setEnv(t, { PATH: emptyPath() });
  const result = git(repo, ["status"]);
  assert.equal(result.error?.code, "ENOENT");
  assert.equal(result.status, null);
});

test("git(): an argument spawnSync itself rejects (a NUL byte) is reported in error, not thrown", () => {
  const result = git(tempDir("ctide-lib-git-nul-"), ["status", "a\u0000b"]);
  assert.equal(result.error?.code, "ERR_INVALID_ARG_VALUE");
  assert.equal(result.status, null);
});

test("git(): input is piped to git's stdin; without input stdin is closed, not inherited", () => {
  const repo = makeRepo({ files: { "a.txt": "a\n" } });
  assert.equal(git(repo, ["hash-object", "--stdin"], { input: "hello\n" }).stdout.trim(), "ce013625030ba8dba906f756967f9e9ca394464a");
  assert.equal(git(repo, ["hash-object", "--stdin"]).stdout.trim(), "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391", "no input: the empty blob");
});

test("git(): encoding \"buffer\" returns stdout as the exact bytes", () => {
  const bytes = Buffer.from([0xff, 0x00, 0xfe, 0x0a, 0xc3]);
  const repo = makeRepo({ files: { "a.txt": "a\n" } });
  fs.writeFileSync(path.join(repo, "bin.dat"), bytes);
  fixtureGit(repo, ["add", "bin.dat"]);
  fixtureGit(repo, ["commit", "-q", "-m", "binary"]);
  const result = git(repo, ["cat-file", "blob", "HEAD:bin.dat"], { encoding: "buffer" });
  assert.ok(Buffer.isBuffer(result.stdout));
  assert.deepEqual(result.stdout, bytes);
});

// --- NEUTRAL_CONFIG: one row per key, each against a hostile global setting that does change raw git ---

test("NEUTRAL_CONFIG is exactly the six documented keys, passed as -c pairs", () => {
  assert.deepEqual({ ...NEUTRAL_CONFIG }, {
    "core.quotePath": "false",
    "i18n.logOutputEncoding": "UTF-8",
    "log.showSignature": "false",
    "column.ui": "never",
    "diff.relative": "false",
    "diff.ignoreSubmodules": "none",
  });
  assert.deepEqual([...NEUTRAL_CONFIG_ARGS], Object.entries(NEUTRAL_CONFIG).flatMap(([key, value]) => ["-c", `${key}=${value}`]));
  assert.ok(Object.isFrozen(NEUTRAL_CONFIG) && Object.isFrozen(NEUTRAL_CONFIG_ARGS));
});

test("NEUTRAL_CONFIG core.quotePath=false wins over a global core.quotePath=true", (t) => {
  const repo = makeRepo({ files: { "café.txt": "x\n" } });
  const hostile = globalConfig({ "core.quotePath": "true" });
  assert.equal(rawGit(repo, ["ls-files"], { GIT_CONFIG_GLOBAL: hostile }).stdout, '"caf\\303\\251.txt"\n', "fixture sanity: the hostile setting (also git's default) quotes the name");
  setEnv(t, { GIT_CONFIG_GLOBAL: hostile });
  assert.equal(git(repo, ["ls-files"]).stdout, "café.txt\n");
});

test("NEUTRAL_CONFIG i18n.logOutputEncoding=UTF-8 wins over a global ISO-8859-1", (t) => {
  const repo = makeRepo({ files: { "a.txt": "a\n" }, message: "café notes" });
  const hostile = globalConfig({ "i18n.logOutputEncoding": "ISO-8859-1" });
  assert.notEqual(rawGit(repo, ["log", "-1", "--format=%s"], { GIT_CONFIG_GLOBAL: hostile }).stdout.trim(), "café notes", "fixture sanity: the hostile setting re-encodes the subject");
  setEnv(t, { GIT_CONFIG_GLOBAL: hostile });
  assert.equal(git(repo, ["log", "-1", "--format=%s"]).stdout, "café notes\n");
});

test("NEUTRAL_CONFIG log.showSignature=false wins over a global log.showSignature=true", (t) => {
  const repo = makeRepo({ files: { "a.txt": "a\n" } });
  const signed = addBogusSignedCommit(repo);
  const hostile = globalConfig({ "log.showSignature": "true" });
  const raw = rawGit(repo, ["log", "-1", "--format=%H"], { GIT_CONFIG_GLOBAL: hostile });
  if (raw.stdout === `${signed}\n`) {
    t.skip(`the hostile setting prints nothing extra here (no usable gpg): ${raw.stderr.trim().split("\n")[0] || "no stderr"}`);
    return;
  }
  setEnv(t, { GIT_CONFIG_GLOBAL: hostile });
  assert.equal(git(repo, ["log", "-1", "--format=%H"]).stdout, `${signed}\n`);
});

test("NEUTRAL_CONFIG column.ui=never wins over a global column.ui=always", (t) => {
  const repo = makeRepo({ files: { "a.txt": "a\n" } });
  const tags = ["t-five", "t-four", "t-one", "t-three", "t-two"];
  for (const tag of tags) fixtureGit(repo, ["tag", tag]);
  const hostile = globalConfig({ "column.ui": "always" });
  assert.ok(rawGit(repo, ["tag"], { GIT_CONFIG_GLOBAL: hostile }).stdout.trim().split("\n").length < tags.length, "fixture sanity: the hostile setting packs tags into columns");
  setEnv(t, { GIT_CONFIG_GLOBAL: hostile });
  assert.equal(git(repo, ["tag"]).stdout, tags.join("\n") + "\n");
});

test("NEUTRAL_CONFIG diff.relative=false wins over a global diff.relative=true (root in a subdirectory)", (t) => {
  const repo = makeRepo({ files: { "top.txt": "1\n", "sub/inner.txt": "1\n" } });
  write(path.join(repo, "top.txt"), "2\n");
  write(path.join(repo, "sub", "inner.txt"), "2\n");
  const sub = path.join(repo, "sub");
  const hostile = globalConfig({ "diff.relative": "true" });
  assert.equal(rawGit(sub, ["diff", "--name-only", "HEAD"], { GIT_CONFIG_GLOBAL: hostile }).stdout, "inner.txt\n", "fixture sanity: the hostile setting drops files outside the subdirectory");
  setEnv(t, { GIT_CONFIG_GLOBAL: hostile });
  assert.equal(git(sub, ["diff", "--name-only", "HEAD"]).stdout, "sub/inner.txt\ntop.txt\n");
});

test("NEUTRAL_CONFIG diff.ignoreSubmodules=none wins over a global diff.ignoreSubmodules=all", (t) => {
  const repo = makeRepo({ files: { "a.txt": "a\n" } });
  stageGitlink(repo, "sub", "a".repeat(40));
  fixtureGit(repo, ["commit", "-q", "-m", "gitlink"]);
  stageGitlink(repo, "sub", "b".repeat(40));
  const hostile = globalConfig({ "diff.ignoreSubmodules": "all" });
  assert.equal(rawGit(repo, ["diff", "--cached", "--name-only", "HEAD"], { GIT_CONFIG_GLOBAL: hostile }).stdout, "", "fixture sanity: the hostile setting hides the moved gitlink");
  setEnv(t, { GIT_CONFIG_GLOBAL: hostile });
  assert.equal(git(repo, ["diff", "--cached", "--name-only", "HEAD"]).stdout, "sub\n");
});

// Owner decision Q1 (b): only the user's own diff.ignoreSubmodules is neutralized; the project's
// per-submodule `ignore` in .gitmodules still applies (an explicit --ignore-submodules=none would not keep it).
test("NEUTRAL_CONFIG diff.ignoreSubmodules=none still honors a project's .gitmodules ignore = all", () => {
  const repo = makeRepo({ files: { "a.txt": "a\n" } });
  stageGitlink(repo, "sub", "a".repeat(40));
  fixtureGit(repo, ["commit", "-q", "-m", "gitlink"]);
  stageGitlink(repo, "sub", "b".repeat(40));
  write(path.join(repo, ".gitmodules"), '[submodule "sub"]\n\tpath = sub\n\turl = ./sub\n\tignore = all\n');
  assert.equal(rawGit(repo, ["diff", "--cached", "--ignore-submodules=none", "--name-only", "HEAD"]).stdout, "sub\n", "fixture sanity: the gitlink did move");
  assert.equal(git(repo, ["diff", "--cached", "--name-only", "HEAD"]).stdout, "");
});

test("NEUTRAL_CONFIG also wins over inherited GIT_CONFIG_PARAMETERS and GIT_CONFIG_COUNT settings", (t) => {
  const repo = makeRepo({ files: { "a.txt": "a\n" } });
  const tags = ["t-five", "t-four", "t-one", "t-three", "t-two"];
  for (const tag of tags) fixtureGit(repo, ["tag", tag]);
  const parameters = { GIT_CONFIG_PARAMETERS: "'column.ui'='always'" };
  const counted = { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "column.ui", GIT_CONFIG_VALUE_0: "always" };
  for (const env of [parameters, counted]) {
    const lines = rawGit(repo, ["tag"], { ...env, GIT_CONFIG_GLOBAL: globalConfig({}) }).stdout.trim().split("\n");
    assert.ok(lines.length < tags.length, `fixture sanity: ${Object.keys(env)[0]} packs tags into columns`);
  }
  // `--sort=refname`: tag.sort is a caller's query flag, not one of NEUTRAL_CONFIG's keys (a developer's
  // global tag.sort=-refname would otherwise reverse the expected order).
  for (const env of [parameters, counted]) {
    withEnv(env, () => assert.equal(git(repo, ["tag", "--sort=refname"]).stdout, tags.join("\n") + "\n", Object.keys(env)[0]));
  }
});

// --- the environment ---

// Each variable points inherited git state at repository `other`; git() must read `repo` only.
for (const [name, value, check] of [
  ["GIT_DIR (absolute, with GIT_WORK_TREE)", (other) => ({ GIT_DIR: path.join(other, ".git"), GIT_WORK_TREE: other }),
    (repo, mine) => assert.equal(git(repo, ["rev-parse", "HEAD"]).stdout.trim(), mine)],
  ["GIT_WORK_TREE (absolute, alone)", (other) => ({ GIT_WORK_TREE: other }),
    (repo) => assert.equal(git(repo, ["status", "--porcelain", "--untracked-files=all"]).stdout, "", "repo's own work tree is clean")],
  ["GIT_INDEX_FILE (absolute)", (other) => ({ GIT_INDEX_FILE: path.join(other, ".git", "index") }),
    (repo) => assert.equal(git(repo, ["ls-files"]).stdout, "mine.txt\n")],
  // Without GIT_DIR, git still takes objects and config from an inherited GIT_COMMON_DIR (refs stay with the
  // discovered repository), so HEAD would name a commit the object store cannot find.
  ["GIT_COMMON_DIR", (other) => ({ GIT_COMMON_DIR: path.join(other, ".git") }),
    (repo) => assert.equal(git(repo, ["log", "-1", "--format=%s"]).stdout, "mine\n")],
  ["GIT_OBJECT_DIRECTORY", (other) => ({ GIT_OBJECT_DIRECTORY: path.join(other, ".git", "objects") }),
    (repo, mine) => assert.equal(git(repo, ["cat-file", "-t", mine]).stdout.trim(), "commit")],
  ["GIT_ALTERNATE_OBJECT_DIRECTORIES", (other) => ({ GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(other, ".git", "objects") }),
    (repo, mine, theirs) => assert.notEqual(git(repo, ["cat-file", "-e", theirs]).status, 0, "an object only `other` has stays invisible")],
]) {
  test(`git(): an inherited ${name} is ignored — git reads the given root`, (t) => {
    const repo = makeRepo({ files: { "mine.txt": "mine\n" }, message: "mine" });
    const other = makeRepo({ files: { "theirs.txt": "theirs\n" }, message: "theirs" });
    const mine = fixtureGit(repo, ["rev-parse", "HEAD"]);
    const theirs = fixtureGit(other, ["rev-parse", "HEAD"]);
    setEnv(t, value(other));
    check(repo, mine, theirs);
  });
}

test("git(): on Windows an inherited mixed-case Git_Dir is ignored too", { skip: process.platform !== "win32" && "environment names are case-sensitive here" }, (t) => {
  const repo = makeRepo({ files: { "mine.txt": "mine\n" } });
  const other = makeRepo({ files: { "theirs.txt": "theirs\n" } });
  const mine = fixtureGit(repo, ["rev-parse", "HEAD"]); // before: the fixture helper's own filter is case-sensitive
  setEnv(t, { Git_Dir: path.join(other, ".git") });
  assert.equal(git(repo, ["rev-parse", "HEAD"]).stdout.trim(), mine);
});

// Owner decision Q4 #1: a read such as `git status` must not rewrite .git/index. Stale stat data (a file
// whose mtime no longer matches the index) is what makes git refresh and write the index.
test("git(): GIT_OPTIONAL_LOCKS=0 — git status leaves a stale .git/index untouched, even with GIT_OPTIONAL_LOCKS=1 inherited", (t) => {
  const repo = makeRepo({ files: { "a.txt": "a\n" } });
  const index = path.join(repo, ".git", "index");
  const old = new Date("2020-01-01T00:00:00Z");
  fs.utimesSync(index, old, old);
  fs.utimesSync(path.join(repo, "a.txt"), new Date("2021-06-01T00:00:00Z"), new Date("2021-06-01T00:00:00Z"));
  const before = fs.readFileSync(index);
  setEnv(t, { GIT_OPTIONAL_LOCKS: "1" });
  const result = git(repo, ["status", "--porcelain"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "", "the content is unchanged, so the tree is clean");
  assert.equal(fs.statSync(index).mtimeMs, old.getTime(), ".git/index was not rewritten");
  assert.deepEqual(fs.readFileSync(index), before);
  rawGit(repo, ["status", "--porcelain"], { GIT_OPTIONAL_LOCKS: "1" });
  assert.notEqual(fs.statSync(index).mtimeMs, old.getTime(), "fixture sanity: without GIT_OPTIONAL_LOCKS=0 the same status rewrites the index");
});

// --- gitOrThrow ---

test("gitOrThrow(): stdout on success; on failure an Error with .stderr, .status and .code, without the root path", (t) => {
  const repo = makeRepo({ files: { "a.txt": "a\n" } });
  assert.equal(gitOrThrow(repo, ["rev-parse", "HEAD"]), `${fixtureGit(repo, ["rev-parse", "HEAD"])}\n`);
  assert.deepEqual(gitOrThrow(repo, ["cat-file", "blob", "HEAD:a.txt"], { encoding: "buffer" }), Buffer.from("a\n"));
  assert.throws(() => gitOrThrow(repo, ["rev-parse", "--verify", "no-such-ref"]), (error) => {
    assert.equal(error.status, 128);
    assert.equal(error.code, null);
    assert.equal(typeof error.stderr, "string");
    assert.match(error.stderr, /fatal/);
    assert.match(error.message, /^git rev-parse --verify no-such-ref failed \(exit 128\): fatal/);
    assert.ok(!error.message.includes(repo), "the message does not carry the root path");
    return true;
  });
  setEnv(t, { PATH: emptyPath() });
  assert.throws(() => gitOrThrow(repo, ["status"]), (error) => {
    assert.equal(error.code, "ENOENT");
    assert.equal(error.status, null);
    assert.equal(error.stderr, "");
    return true;
  });
});

// --- parseCount ---

test("parseCount(): an integer only for digits after trimming, else null", () => {
  for (const [input, expected] of [
    ["", null], [" 3\n", 3], ["3x", null], ["-1", null], ["0\n", 0], ["12", 12],
    [" ", null], ["1.5", null], ["99999999999999999999", null], [null, null], [undefined, null], [Buffer.from("7\n"), 7],
  ]) {
    assert.equal(parseCount(input), expected, JSON.stringify(String(input)));
  }
});

// --- headState ---

test("headState(): born, unborn, a dangling HEAD, and not a repository", (t) => {
  assert.equal(headState(makeRepo({ files: { "a.txt": "a\n" } })), "born");
  assert.equal(headState(makeRepo()), "unborn");
  const dangling = makeRepo({ files: { "a.txt": "a\n" } });
  fs.writeFileSync(path.join(dangling, ".git", "refs", "heads", "main"), "1".repeat(40) + "\n");
  assert.equal(fixtureGit(dangling, ["rev-parse", "--verify", "HEAD"]), "1".repeat(40), "fixture sanity: the ref itself still resolves");
  assert.equal(headState(dangling), "unknown");
  assert.equal(headState(tempDir("ctide-lib-git-nonrepo-")), "unknown");
  const repo = makeRepo({ files: { "a.txt": "a\n" } });
  setEnv(t, { PATH: emptyPath() });
  assert.equal(headState(repo), "unknown", "git missing");
});

// --- changedFiles ---

// Base commit with every kind of path, then: an unstaged edit, a staged edit, an edit staged and then
// reverted in the working tree, a deletion, non-ASCII and space names, an untracked file, an ignored one,
// a staged gitlink move, and an index-only entry whose name holds a newline.
function changedFixture() {
  const repo = makeRepo({
    files: {
      ".gitignore": "ignored.txt\n",
      "modified.txt": "1\n", "staged.txt": "1\n", "reverted.txt": "1\n", "deleted.txt": "1\n",
      "unchanged.txt": "1\n", "café.txt": "1\n", "with space.txt": "1\n", "sub/inner.txt": "1\n",
      "twice.txt": "1\n",
    },
  });
  stageGitlink(repo, "module", "a".repeat(40));
  fixtureGit(repo, ["commit", "-q", "-m", "gitlink"]);
  write(path.join(repo, "modified.txt"), "2\n");
  write(path.join(repo, "staged.txt"), "2\n");
  write(path.join(repo, "reverted.txt"), "2\n");
  write(path.join(repo, "twice.txt"), "2\n");
  fixtureGit(repo, ["add", "staged.txt", "reverted.txt", "twice.txt"]);
  write(path.join(repo, "reverted.txt"), "1\n");
  write(path.join(repo, "twice.txt"), "3\n");
  fs.rmSync(path.join(repo, "deleted.txt"));
  write(path.join(repo, "café.txt"), "2\n");
  write(path.join(repo, "with space.txt"), "2\n");
  write(path.join(repo, "new file.txt"), "new\n");
  write(path.join(repo, "ignored.txt"), "ignored\n");
  stageGitlink(repo, "module", "b".repeat(40));
  const blob = fixtureGit(repo, ["hash-object", "-w", "--stdin"], { input: "nl\n" });
  fixtureGit(repo, ["-c", "core.protectNTFS=false", "update-index", "--add", "--cacheinfo", `100644,${blob},line\nbreak.txt`]);
  return repo;
}
const CHANGED = [
  "café.txt", "deleted.txt", "line\nbreak.txt", "modified.txt", "module", "new file.txt",
  "reverted.txt", "staged.txt", "twice.txt", "with space.txt",
];

test("changedFiles(): the union of staged, unstaged and untracked paths — sorted, deduplicated, top-level-relative", () => {
  const repo = changedFixture();
  const head = fixtureGit(repo, ["rev-parse", "HEAD"]);
  assert.deepEqual(changedFiles(repo), { state: "ok", base: head, files: CHANGED });
  assert.deepEqual(changedFiles(path.join(repo, "sub")), { state: "ok", base: head, files: CHANGED }, "a subdirectory root reports the same top-level paths");
});

test("changedFiles(): a hostile global config (set H) does not change the result", (t) => {
  const repo = changedFixture();
  const expected = changedFiles(repo);
  setEnv(t, {
    GIT_CONFIG_GLOBAL: globalConfig({
      "column.ui": "always", "tag.sort": "-refname", "log.showSignature": "true", "core.abbrev": "12",
      "i18n.logOutputEncoding": "ISO-8859-1", "diff.relative": "true", "core.quotePath": "true",
      "status.showUntrackedFiles": "no", "diff.ignoreSubmodules": "all", "color.ui": "always",
      "log.decorate": "full", "format.pretty": "fuller", "status.branch": "true", "status.renames": "copies",
    }),
  });
  assert.deepEqual(changedFiles(repo), expected);
  assert.deepEqual(changedFiles(path.join(repo, "sub")), expected);
});

test("changedFiles(): an older base also lists what the commits since it changed", () => {
  const repo = makeRepo({ files: { "a.txt": "1\n", "b.txt": "1\n" } });
  const first = fixtureGit(repo, ["rev-parse", "HEAD"]);
  write(path.join(repo, "b.txt"), "2\n");
  fixtureGit(repo, ["commit", "-q", "-am", "b"]);
  write(path.join(repo, "a.txt"), "2\n");
  assert.deepEqual(changedFiles(repo, first), { state: "ok", base: first, files: ["a.txt", "b.txt"] });
  assert.deepEqual(changedFiles(repo, "HEAD~1"), { state: "ok", base: first, files: ["a.txt", "b.txt"] });
  assert.deepEqual(changedFiles(repo).files, ["a.txt"]);
});

test("changedFiles(): a clean tree is ok with no files", () => {
  const repo = makeRepo({ files: { "a.txt": "1\n" } });
  assert.deepEqual(changedFiles(repo), { state: "ok", base: fixtureGit(repo, ["rev-parse", "HEAD"]), files: [] });
});

test("changedFiles(): an invalid base is unverified and never reaches git as an option", () => {
  const repo = makeRepo({ files: { "a.txt": "1\n" } });
  const injected = path.join(repo, "injected.txt");
  for (const base of ["", `--output=${injected}`, "-p", "no-such-ref", fixtureGit(repo, ["rev-parse", "HEAD^{tree}"]), 42, null]) {
    assert.deepEqual(changedFiles(repo, base), { state: "unverified", reason: "invalid-base" }, JSON.stringify(base));
  }
  assert.equal(fs.existsSync(injected), false, "no file was written by an option-shaped base");
  for (const base of [`--output=${injected}`, "-p"]) {
    const { result, calls } = changedFilesWithFault(repo, "none", base);
    assert.deepEqual(result, { state: "unverified", reason: "invalid-base" });
    assert.deepEqual(calls, [], `${base}: refused before any git call`);
  }
});

test("changedFiles(): not a work tree — a bare repository, a .git directory, a plain directory", () => {
  const bare = tempDir("ctide-lib-git-bare-");
  fixtureGit(bare, ["init", "-q", "--bare"]);
  const repo = makeRepo({ files: { "a.txt": "1\n" } });
  for (const root of [bare, path.join(repo, ".git"), tempDir("ctide-lib-git-plain-")]) {
    assert.deepEqual(changedFiles(root), { state: "unverified", reason: "not-a-work-tree" }, root);
  }
});

test("changedFiles(): an unborn HEAD, an unreadable HEAD, and git missing", (t) => {
  assert.deepEqual(changedFiles(makeRepo()), { state: "unverified", reason: "unborn-head" });
  const dangling = makeRepo({ files: { "a.txt": "1\n" } });
  fs.writeFileSync(path.join(dangling, ".git", "refs", "heads", "main"), "1".repeat(40) + "\n");
  assert.deepEqual(changedFiles(dangling), { state: "unverified", reason: "unreadable-head" });
  const repo = makeRepo({ files: { "a.txt": "1\n" } });
  setEnv(t, { PATH: emptyPath() });
  assert.deepEqual(changedFiles(repo), { state: "unverified", reason: "git-unavailable" });
});

// "Never writes the index": with stale stat data, `git diff <base>` refreshes and rewrites .git/index even
// under GIT_OPTIONAL_LOCKS=0; changedFiles must not, and must add no intent-to-add entry either.
test("changedFiles(): leaves a stale .git/index byte-for-byte untouched and adds no entries", () => {
  const repo = makeRepo({ files: { "a.txt": "a\n", "b.txt": "b\n" } });
  write(path.join(repo, "b.txt"), "changed\n");
  write(path.join(repo, "untracked.txt"), "u\n");
  const index = path.join(repo, ".git", "index");
  const old = new Date("2020-01-01T00:00:00Z");
  fs.utimesSync(index, old, old);
  fs.utimesSync(path.join(repo, "a.txt"), new Date("2021-06-01T00:00:00Z"), new Date("2021-06-01T00:00:00Z"));
  const before = fs.readFileSync(index);
  const stage = fixtureGit(repo, ["ls-files", "--stage"]);
  assert.deepEqual(changedFiles(repo).files, ["b.txt", "untracked.txt"]);
  assert.equal(fs.statSync(index).mtimeMs, old.getTime(), ".git/index was not rewritten");
  assert.deepEqual(fs.readFileSync(index), before);
  assert.equal(fixtureGit(repo, ["ls-files", "--stage"]), stage, "no entry was added");
  rawGit(repo, ["status", "--porcelain"], { GIT_OPTIONAL_LOCKS: "1" });
  assert.notEqual(fs.statSync(index).mtimeMs, old.getTime(), "fixture sanity: the stat data was stale enough to make git rewrite the index");
});

// Fault injection in a child process, the way test/ship.test.mjs injects git faults: a `-r` preload
// patches child_process.spawnSync for command "git" (and re-syncs the builtin's ESM exports). This also
// proves lib/git stays interceptable that way. Serialized with Function.prototype.toString, never called here.
function gitFaultPreload(mode) {
  const childProcess = require("node:child_process");
  const realSpawnSync = childProcess.spawnSync;
  globalThis.__libGitIntercepted = 0;
  globalThis.__libGitCalls = [];
  const failed = (code) => {
    const error = Object.assign(new Error(`spawnSync git ${code}`), { code, syscall: "spawnSync git" });
    return { pid: 0, output: null, stdout: "", stderr: "", status: null, signal: code === "ETIMEDOUT" ? "SIGTERM" : null, error };
  };
  const exited = (status) => ({ pid: 0, output: [null, "", "fatal: injected\n"], stdout: "", stderr: "fatal: injected\n", status, signal: null });
  childProcess.spawnSync = function patchedSpawnSync(command, args) {
    const list = Array.isArray(args) ? args.map(String) : [];
    if (command === "git") globalThis.__libGitCalls.push(list);
    const asks = (...words) => command === "git" && words.every((word) => list.includes(word));
    const fault =
      mode === "toplevel-timeout" && asks("--show-toplevel") ? failed("ETIMEDOUT")
      : mode === "base-timeout" && asks("rev-parse", "--verify") && list.some((a) => a.startsWith("HEAD~0")) ? failed("ETIMEDOUT")
      : mode === "diff-cached-exit" && asks("diff", "--cached") ? exited(128)
      : mode === "status-timeout" && asks("status") ? failed("ETIMEDOUT")
      : mode === "ls-files-enobufs" && asks("ls-files") ? failed("ENOBUFS")
      : null;
    if (fault) { globalThis.__libGitIntercepted++; return fault; }
    return realSpawnSync.apply(this, arguments);
  };
  require("node:module").syncBuiltinESMExports();
}

function changedFilesWithFault(repo, mode, base = "HEAD") {
  const dir = tempDir("ctide-lib-git-fault-");
  const preload = path.join(dir, "preload.cjs");
  const child = path.join(dir, "child.mjs");
  fs.writeFileSync(preload, `(${gitFaultPreload})(${JSON.stringify(mode)});\n`, "utf8");
  fs.writeFileSync(child, [
    `import { changedFiles } from ${JSON.stringify(LIB_GIT_URL)};`,
    "const result = changedFiles(process.argv[2], process.argv[3]);",
    "process.stdout.write(JSON.stringify({ result, intercepted: globalThis.__libGitIntercepted, calls: globalThis.__libGitCalls }));",
    "",
  ].join("\n"), "utf8");
  const run = cp.spawnSync(process.execPath, ["-r", preload, child, repo, base], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

test("changedFiles(): a spawn failure, timeout or ENOBUFS in any read is read-failed (fault-injected through child_process.spawnSync)", () => {
  const repo = makeRepo({ files: { "a.txt": "1\n" } });
  write(path.join(repo, "a.txt"), "2\n");
  const control = changedFilesWithFault(repo, "none");
  assert.equal(control.intercepted, 0);
  assert.deepEqual(control.result.files, ["a.txt"], "control: no fault, a normal result");
  for (const [mode, base] of [
    ["toplevel-timeout"], ["base-timeout", "HEAD~0"], ["diff-cached-exit"], ["status-timeout"], ["ls-files-enobufs"],
  ]) {
    const { result, intercepted } = changedFilesWithFault(repo, mode, base);
    assert.ok(intercepted >= 1, `${mode}: the preload intercepted lib/git's spawnSync call`);
    assert.deepEqual(result, { state: "unverified", reason: "read-failed" }, mode);
  }
});
