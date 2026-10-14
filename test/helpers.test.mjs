// Tests for the shared test infrastructure in test/helpers.mjs: the test() wrapper, tempDir() cleanup (the
// no-leftover rule every test file relies on), fixture-git isolation from a developer's git environment, and
// the SSH-signing capability gate.
import assert from "node:assert";
import cp from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { git, gitEnv, makeRepo, sshSigningSkipReason, tempDir, tempEnv, test, write } from "./helpers.mjs";

// Sets process.env entries (undefined deletes one) until the running test ends.
function setProcessEnv(t, vars) {
  const assign = (entries) => {
    for (const [key, value] of entries) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  };
  const saved = Object.keys(vars).map((key) => [key, process.env[key]]);
  t.after(() => assign(saved));
  assign(Object.entries(vars));
}

// --- test() wrapper ---

test(function namedBody(t) {
  assert.strictEqual(t.name, "namedBody", "a nameless test is named after its body, as with node:test");
});

test("test(): a body with three parameters is not callback style (node:test: exactly two)", { timeout: 2000 }, (t, second, third) => {
  assert.strictEqual(second, undefined, "no done callback is passed, so the test ends when the body returns");
  assert.strictEqual(third, undefined);
});

// --- tempDir ---

let madeByEarlierTest;
test("tempDir: a directory made in a test body exists while that test runs", () => {
  madeByEarlierTest = tempDir("ctide-helpers-");
  assert.ok(fs.statSync(madeByEarlierTest).isDirectory());
});

test("tempDir: the directory is removed once the test that made it ends", () => {
  assert.ok(madeByEarlierTest, "fixture sanity: the previous test ran first");
  assert.strictEqual(fs.existsSync(madeByEarlierTest), false);
});

// A whole test file in a child process, with its own temp root: whatever made the directories (a test
// body, a callback-style body, a file-level before(), node:test's own test()), nothing is left behind.
test("tempDir: a test file leaves no ctide-* directory in its temp root, however the directories were made", () => {
  const childTemp = tempEnv("ctide-helpers-child-");
  const fixture = path.join(tempDir("ctide-helpers-fixture-"), "fixture.test.mjs");
  write(fixture, [
    'import assert from "node:assert";',
    'import fs from "node:fs";',
    'import { before, test as nodeTest } from "node:test";',
    `import { tempDir, test } from ${JSON.stringify(new URL("./helpers.mjs", import.meta.url).href)};`,
    "let beforeDir, bodyDir, callbackDir;",
    'before(() => { beforeDir = tempDir("ctide-fixture-before-"); });',
    'test("body", () => { bodyDir = tempDir("ctide-fixture-body-"); assert.ok(fs.existsSync(bodyDir)); });',
    'test("callback style", (t, done) => { callbackDir = tempDir("ctide-fixture-callback-"); setImmediate(done); });',
    'nodeTest("node:test test()", () => { tempDir("ctide-fixture-plain-"); });',
    'test("per-test and file-scope lifetimes", () => {',
    "  assert.strictEqual(fs.existsSync(bodyDir), false, \"the body's directory went with its test\");",
    "  assert.strictEqual(fs.existsSync(callbackDir), false, \"the callback body's directory went with its test\");",
    '  assert.ok(fs.existsSync(beforeDir), "the before() directory lives until the file ends");',
    "});",
    "",
  ].join("\n"));
  const env = { ...process.env, ...childTemp };
  delete env.NODE_TEST_CONTEXT; // run the fixture as a top-level test file, not as this runner's child
  const result = cp.spawnSync(process.execPath, [fixture], { encoding: "utf8", env });
  assert.strictEqual(result.status, 0, `the fixture's own tests pass:\n${result.stdout}${result.stderr}`);
  assert.match(result.stdout, /\bpass 4\b/, "all four fixture tests ran");
  assert.deepStrictEqual(fs.readdirSync(childTemp.TEMP).filter((name) => name.startsWith("ctide-")), []);
});

// --- fixture git ---

// The settings a developer's global config can carry that break fixture commits, tags and merges, plus
// the GIT_* variables a caller running inside git (a hook, `git rebase --exec`) passes down.
function hostileGitEnvironment() {
  const hostile = tempDir("ctide-helpers-hostile-");
  const hooks = path.join(hostile, "hooks");
  for (const hook of ["pre-commit", "commit-msg"]) {
    write(path.join(hooks, hook), "#!/bin/sh\necho hostile hook >&2\nexit 1\n");
    fs.chmodSync(path.join(hooks, hook), 0o755);
  }
  const missingGpg = path.join(hostile, "no-such-gpg").replaceAll(path.sep, "/");
  const config = path.join(hostile, "gitconfig");
  write(config, [
    "[commit]", "\tgpgSign = true",
    "[tag]", "\tgpgSign = true", "\tforceSignAnnotated = true",
    "[merge]", "\tverifySignatures = true",
    "[gpg]", `\tprogram = ${missingGpg}`,
    "[core]", `\thooksPath = ${hooks.replaceAll(path.sep, "/")}`, "\tsafecrlf = true",
    "[init]", "\tdefaultBranch = trunk",
    "",
  ].join("\n"));
  return {
    missingGpg,
    elsewhere: path.join(hostile, "elsewhere.git"),
    env: {
      GIT_CONFIG_GLOBAL: config,
      GIT_DIR: path.join(hostile, "elsewhere.git"),
      GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "commit.gpgSign", GIT_CONFIG_VALUE_0: "true",
      GIT_CONFIG_PARAMETERS: `'core.hookspath'='${hooks.replaceAll(path.sep, "/")}'`,
    },
  };
}

test("fixture git: makeRepo and git() commit, tag and merge under a hostile global config and inherited GIT_* overrides", (t) => {
  const hostile = hostileGitEnvironment();
  setProcessEnv(t, hostile.env);

  const dir = makeRepo({ prefix: "ctide-helpers-repo-", files: { "a.txt": "a\n" } });
  assert.strictEqual(git(dir, ["symbolic-ref", "--short", "HEAD"]), "main");
  git(dir, ["tag", "-a", "v1.0.0", "-m", "v1.0.0"]);
  git(dir, ["checkout", "-q", "-b", "side"]);
  write(path.join(dir, "b.txt"), "b\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "side"]);
  git(dir, ["checkout", "-q", "main"]);
  git(dir, ["merge", "-q", "--no-ff", "-m", "merge side", "side"]);
  assert.strictEqual(git(dir, ["rev-list", "--count", "HEAD"]), "3", "initial, side and the merge commit");
  assert.strictEqual(fs.existsSync(hostile.elsewhere), false, "an inherited GIT_DIR did not redirect the fixture");
  for (const key of ["commit.gpgsign", "tag.gpgsign", "merge.verifysignatures"]) {
    assert.strictEqual(git(dir, ["config", "--local", "--get", key]), "false", `repo-local ${key} covers production git too`);
  }

  // The pins switch off signing by default only: an explicit -S still asks the signing program.
  git(dir, ["config", "gpg.program", hostile.missingGpg]);
  assert.throws(() => git(dir, ["commit", "-q", "-S", "--allow-empty", "-m", "explicitly signed"]), /sign|gpg/i);
});

// Literal tables on purpose: importing gitEnv's own lists would let an entry removed there delete its row here.
const STRIPPED_GIT_ENV = [
  "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR", "GIT_CONFIG_PARAMETERS", "GIT_CONFIG", "GIT_NAMESPACE",
  "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_AUTHOR_DATE",
  "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL", "GIT_COMMITTER_DATE",
  "GIT_CONFIG_KEY_99", "GIT_CONFIG_VALUE_99",
];
const PINNED_GIT_CONFIG = [
  ["commit.gpgSign", "false"],
  ["tag.gpgSign", "false"],
  ["tag.forceSignAnnotated", "false"],
  ["merge.verifySignatures", "false"],
  ["gc.auto", "0"],
  ["maintenance.auto", "false"],
  ["core.hooksPath", null], // null: an absolute path to a directory that does not exist
];

test("gitEnv: every inherited GIT_* variable in the table is stripped", (t) => {
  setProcessEnv(t, Object.fromEntries(STRIPPED_GIT_ENV.map((key) => [key, `inherited-${key}`])));
  const env = gitEnv();
  for (const key of STRIPPED_GIT_ENV) assert.strictEqual(env[key], undefined, `${key} must not reach fixture git`);
});

test("gitEnv: every pinned config key in the table reads back its pinned value", () => {
  const cwd = tempDir("ctide-helpers-pins-");
  for (const [key, expected] of PINNED_GIT_CONFIG) {
    let actual;
    try {
      actual = git(cwd, ["config", "--get", key]);
    } catch (error) {
      assert.fail(`${key} is not pinned: ${error.message}`);
    }
    if (expected === null) assert.ok(path.isAbsolute(actual) && !fs.existsSync(actual), `${key} must name a missing directory, got ${actual}`);
    else assert.strictEqual(actual, expected, key);
  }
});

test("gitEnv: an inherited GIT_CONFIG file is never written, and makeRepo still commits", (t) => {
  const legacyConfig = path.join(tempDir("ctide-helpers-legacy-"), "gitconfig");
  setProcessEnv(t, { GIT_CONFIG: legacyConfig });
  const dir = makeRepo({ prefix: "ctide-helpers-repo-", files: { "a.txt": "a\n" } });
  assert.strictEqual(git(dir, ["rev-list", "--count", "HEAD"]), "1", "the fixture commit exists");
  assert.strictEqual(fs.existsSync(legacyConfig), false, "makeRepo's git config writes did not go to GIT_CONFIG");
});

test("makeRepo: production's %h equals the fixture's short SHA under a developer's global core.abbrev", () => {
  const dir = makeRepo({ prefix: "ctide-helpers-repo-", files: { "a.txt": "a\n" } });
  const globalConfig = path.join(tempDir("ctide-helpers-abbrev-"), "gitconfig");
  write(globalConfig, "[core]\n\tabbrev = 12\n");
  // Production code runs git with the plain process environment, so the global config applies to it.
  const env = { ...process.env, GIT_CONFIG_GLOBAL: globalConfig };
  const plainGit = (args) => cp.execFileSync("git", args, { cwd: dir, env, encoding: "utf8" }).trim();
  assert.strictEqual(plainGit(["config", "--global", "--get", "core.abbrev"]), "12", "fixture sanity: the global core.abbrev is live");
  assert.strictEqual(plainGit(["log", "-1", "--format=%h"]), git(dir, ["rev-parse", "--short", "HEAD"]));
});

// --- SSH signing capability gate ---

test("sshSigningSkipReason: git older than 2.34 is a reason to skip, naming the version", () => {
  const reason = sshSigningSkipReason({ gitVersionText: "git version 2.33.1", signProbe: { status: 0, stderr: "" } });
  assert.match(reason, /git 2\.33 predates SSH commit signing \(needs git 2\.34\+\)/);
});

test("sshSigningSkipReason: an ssh-keygen without -Y sign is a reason to skip, with its exit status and stderr", () => {
  const reason = sshSigningSkipReason({
    gitVersionText: "git version 2.55.0.windows.5",
    signProbe: { status: 255, stderr: "unknown option -- Y\nusage: ssh-keygen [-q] [-a rounds]\n" },
  });
  assert.match(reason, /cannot make an SSH signature here \(exit 255\): unknown option -- Y/);
});

test("sshSigningSkipReason: an ssh-keygen that cannot be spawned is a reason to skip, naming the spawn error", () => {
  const error = Object.assign(new Error("spawnSync ssh-keygen ENOENT"), { code: "ENOENT" });
  const reason = sshSigningSkipReason({ gitVersionText: "git version 2.43.0", signProbe: { error, status: null } });
  assert.match(reason, /ssh-keygen cannot be run \(ENOENT\)/);
});

test("sshSigningSkipReason: git 2.34+ with a working ssh-keygen -Y sign runs, and an unparsable git version is no reason to skip", () => {
  const signed = { status: 0, stderr: "Signing file probe.txt\nWrite signature to probe.txt.sig\n" };
  assert.strictEqual(sshSigningSkipReason({ gitVersionText: "git version 2.34.0", signProbe: signed }), null);
  assert.strictEqual(sshSigningSkipReason({ gitVersionText: "not a version string", signProbe: signed }), null);
});
