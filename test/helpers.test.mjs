// Tests for the shared test infrastructure in test/helpers.mjs: tempDir() cleanup (the no-leftover rule
// every test file relies on), fixture-git isolation from a developer's git environment, and the
// SSH-signing capability gate.
import assert from "node:assert";
import cp from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { git, makeRepo, sshSigningSkipReason, tempDir, tempEnv, test, write } from "./helpers.mjs";

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
  const saved = Object.fromEntries(Object.keys(hostile.env).map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  Object.assign(process.env, hostile.env);

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
