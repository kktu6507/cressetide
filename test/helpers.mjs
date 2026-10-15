// Shared test infrastructure. `npm test` runs only the quoted glob "test/**/*.test.mjs" (Node 22.12+
// floor), so this ".test."-less module is imported by test files and never executed as a test file of its
// own.
//
// Two rules every test file follows through this module:
//  - Temp directories come from tempDir(), which removes each one when the test that made it ends, or,
//    for one made outside a test body (a file-level before(), module scope), when the test file ends.
//  - Git commands that BUILD a fixture run through git() / makeRepo(), whose environment (gitEnv) ignores
//    the developer's global git config and inherited GIT_* overrides. Production code under test keeps the
//    plain process environment; makeRepo's repo-local hardenGitSigning covers what it runs in a fixture.
import { AsyncLocalStorage } from "node:async_hooks";
import cp from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import nodeTest, { after } from "node:test";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// --- test context and temp directories ---

const currentTest = new AsyncLocalStorage();

// node:test's test(), with the running test's context available to tempDir() inside the body. node:test
// treats a body that declares exactly two parameters as callback style (t, done), so the wrapper declares
// two exactly then, and carries the body's name (a nameless test is named after its body); the
// (name, options, fn) overloads pass through unchanged.
export function test(...args) {
  return nodeTest(...args.map((arg) => (typeof arg === "function" ? withTestContext(arg) : arg)));
}
function withTestContext(fn) {
  const wrapper = fn.length === 2
    ? function (t, done) { return currentTest.run(t, () => fn.call(this, t, done)); }
    : function (t) { return currentTest.run(t, () => fn.call(this, t)); };
  Object.defineProperty(wrapper, "name", { value: fn.name });
  return wrapper;
}

// Directories made outside any test body. This after() is registered when a test file imports this
// module, so it runs once that file's tests are done, before the file's own top-level after() hooks.
const fileScopeDirs = [];
after((t) => {
  for (const dir of fileScopeDirs.splice(0)) removeTempDir(dir, t);
});

function removeTempDir(dir, t) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    t.diagnostic(`tempDir: could not remove ${dir}: ${error.code || error.message}`);
  }
}

export function tempDir(prefix = "ctide-test-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const t = currentTest.getStore();
  if (t) t.after(() => removeTempDir(dir, t));
  else fileScopeDirs.push(dir);
  return dir;
}

// TEMP/TMP/TMPDIR for a child process whose own code makes temp files, pointed at a fresh tempDir().
export function tempEnv(prefix = "ctide-test-") {
  const dir = tempDir(prefix);
  return { TEMP: dir, TMP: dir, TMPDIR: dir };
}

// Runs the synchronous `fn` with the given process.env entries set — a value of undefined removes the
// entry — and restores every one of them afterwards. For in-process tests of code that reads the
// environment on each call (os.tmpdir(), os.homedir(), CLAUDE_PROJECT_DIR, CTIDE_HOOK_DEBUG).
export function withEnv(vars, fn) {
  const saved = Object.keys(vars).map((key) => [key, Object.hasOwn(process.env, key), process.env[key]]);
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, had, value] of saved) {
      if (had) process.env[key] = value;
      else delete process.env[key];
    }
  }
}

// --- fixture git ---

// Never created: git reads a missing global config file as empty, and cannot create this one (its
// directory is missing too), so a stray `git config --global` in a fixture fails instead of writing.
const NO_GLOBAL_GITCONFIG = path.join(os.tmpdir(), `ctide-no-gitconfig-${process.pid}-${crypto.randomUUID()}`, "config");
// Never created either: fixture git runs no hooks, whichever config level (system included) names a hooks
// directory.
const NO_GIT_HOOKS = path.join(os.tmpdir(), `ctide-no-githooks-${process.pid}-${crypto.randomUUID()}`).replaceAll(path.sep, "/");
// Inherited from a caller that is itself running inside git (a hook, `git rebase --exec`), these would
// point fixture commands at another repository, index, config file or namespace, or stamp fixture commits
// with the caller's identity and dates.
const INHERITED_GIT_ENV = [
  "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_COMMON_DIR", "GIT_CONFIG_PARAMETERS", "GIT_CONFIG", "GIT_NAMESPACE",
  "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_AUTHOR_DATE",
  "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL", "GIT_COMMITTER_DATE",
];
// Command-line scope: beats the system and repo-local config; an explicit `-S` on the command still wins.
const PINNED_GIT_CONFIG = [
  ["commit.gpgSign", "false"],
  ["tag.gpgSign", "false"],
  ["tag.forceSignAnnotated", "false"],
  ["merge.verifySignatures", "false"],
  ["gc.auto", "0"],
  ["maintenance.auto", "false"],
  ["core.hooksPath", NO_GIT_HOOKS],
];

// For fixture git only. The system config stays (Git for Windows keeps core.autocrlf, core.symlinks and
// init.defaultBranch there), so this is not GIT_CONFIG_NOSYSTEM. `extra` is applied last, so a caller's own
// GIT_AUTHOR_DATE / GIT_COMMITTER_DATE still win. Windows environment names are case-insensitive (a
// `Git_Dir` reaches git as GIT_DIR), so there the names are matched case-insensitively. Exported for
// helpers.test only (it pins this environment directly); test files build fixtures through git()/makeRepo().
export function gitEnv(extra = {}) {
  const env = { ...process.env };
  const caseInsensitive = process.platform === "win32";
  for (const key of Object.keys(env)) {
    const name = caseInsensitive ? key.toUpperCase() : key;
    if (INHERITED_GIT_ENV.includes(name) || /^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/.test(name)) delete env[key];
  }
  env.GIT_CONFIG_GLOBAL = NO_GLOBAL_GITCONFIG;
  env.GIT_CONFIG_COUNT = String(PINNED_GIT_CONFIG.length);
  PINNED_GIT_CONFIG.forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${index}`] = key;
    env[`GIT_CONFIG_VALUE_${index}`] = value;
  });
  return { ...env, ...extra };
}

// Runs a fixture git command in `cwd`; returns its trimmed stdout (raw bytes with encoding "buffer") and
// throws with git's stderr when it fails.
export function git(cwd, args, { env, input, encoding = "utf8" } = {}) {
  // An explicit "ignore" for stdin would drop `input`, so stdin is piped only when there is input.
  const stdin = input === undefined ? "ignore" : "pipe";
  const out = cp.execFileSync("git", args, { cwd, env: gitEnv(env), input, encoding, stdio: [stdin, "pipe", "pipe"] });
  return encoding === "buffer" ? out : out.trim();
}

// Repo-local, so production code that runs git in a fixture repository with the plain process environment
// is not pushed into signing, or into verifying merge signatures, by a developer's global config either.
// Internal to makeRepo().
function hardenGitSigning(cwd) {
  for (const [key, value] of [["commit.gpgsign", "false"], ["tag.gpgSign", "false"], ["merge.verifySignatures", "false"]]) {
    git(cwd, ["config", key, value]);
  }
}

// A fresh repository in a tempDir(): `branch` checked out, a repo-local identity, signing hardened, and,
// when `files` ({ "rel/path": content }) is given, one initial commit of them dated `date`.
export function makeRepo({
  prefix = "ctide-repo-", branch = "main", name = "Ctide Test", email = "test@example.invalid",
  files, message = "fixture", date = "2026-01-01T00:00:00Z",
} = {}) {
  const dir = tempDir(prefix);
  git(dir, ["init", "-q", `--initial-branch=${branch}`]);
  git(dir, ["config", "user.name", name]);
  git(dir, ["config", "user.email", email]);
  // Production code runs git inside the fixture with the developer's environment, where a global core.abbrev
  // would lengthen its %h past the fixture's --short; 7 is git's own minimum for a small repository.
  git(dir, ["config", "core.abbrev", "7"]);
  hardenGitSigning(dir);
  if (files) {
    for (const [rel, content] of Object.entries(files)) write(path.join(dir, rel), content);
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-q", "--allow-empty", "-m", message], { env: { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  }
  return dir;
}

// Why an SSH-signed-commit test cannot run here, or null when it can. SSH commit signing needs git 2.34+
// and an ssh-keygen that implements `-Y sign` (OpenSSH 8.1+). `signProbe` is the spawnSync result of the
// ssh-keygen step that failed, or of `ssh-keygen -Y sign`. An unparsable git version is not a reason to skip.
export function sshSigningSkipReason({ gitVersionText, signProbe }) {
  const version = /git version (\d+)\.(\d+)/.exec(String(gitVersionText));
  if (version && (Number(version[1]) < 2 || (Number(version[1]) === 2 && Number(version[2]) < 34))) {
    return `git ${version[1]}.${version[2]} predates SSH commit signing (needs git 2.34+)`;
  }
  if (signProbe.error) return `ssh-keygen cannot be run (${signProbe.error.code || signProbe.error.message})`;
  if (signProbe.status !== 0) {
    return `ssh-keygen cannot make an SSH signature here (exit ${signProbe.status}): ${String(signProbe.stderr || "").trim()}`;
  }
  return null;
}

// --- processes and files ---

export function run(command, args, options = {}) {
  return cp.spawnSync(command, args, {
    cwd: options.cwd || root,
    encoding: "utf8",
    timeout: options.timeout || 10000,
    input: options.input,
    env: { ...process.env, ...(options.env || {}) },
  });
}

// Spawns a hook (a file name under cressetide/hooks/, or an absolute path) with `event` on stdin — a string
// is sent as is, anything else as JSON — in `options.cwd` (a fresh temp dir when not given), with
// CLAUDE_PROJECT_DIR set to that cwd unless options.env says otherwise. Returns the spawnSync result plus
// `output` (the parsed stdout, or null when stdout is blank; non-JSON stdout throws) and `cwd`.
export function runHookEvent(name, event, options = {}) {
  const cwd = options.cwd || tempDir();
  const file = path.isAbsolute(name) ? name : path.join(HOOKS, name);
  const result = run(process.execPath, [file], {
    cwd,
    input: typeof event === "string" ? event : JSON.stringify(event),
    env: { CLAUDE_PROJECT_DIR: cwd, ...(options.env || {}) },
    timeout: options.timeout,
  });
  let output = null;
  if (result.stdout.trim()) output = JSON.parse(result.stdout);
  return { ...result, output, cwd };
}

export function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

// --- hooks ---

export const HOOKS = path.join(root, "cressetide", "hooks");

// Spawns a hook by absolute path with `input` as JSON on stdin and returns its raw stdout. The node that
// runs the tests runs the hook too (process.execPath), whatever PATH says.
export function hookStdout(hookPath, input, env) {
  return cp.execFileSync(process.execPath, [hookPath], { input: JSON.stringify(input), env: env || process.env }).toString();
}
export function mkProject(memFile) {
  const dir = tempDir("ctide-test-");
  if (memFile != null) {
    fs.mkdirSync(path.join(dir, "ai"));
    fs.writeFileSync(path.join(dir, "ai", "FAILURE_MEMORY.md"), memFile, "utf8");
  }
  return dir;
}
// Isolate the home dir for tests that exercise the ~/.claude/plans exemption, so they
// don't touch the developer's real home tree.
export function isolatedHome() {
  const home = tempDir("ctide-home-");
  // os.homedir() reads HOME on POSIX but USERPROFILE on Windows — set both so the
  // isolation actually takes effect cross-platform.
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.CLAUDE_PROJECT_DIR; // hermetic: don't let an ambient project opt-out leak in
  return { home, env };
}

export const TWO_ENTRIES_PLUS_PLACEHOLDER = `# FAILURE_MEMORY

## Entry Template

### <YYYY-MM-DD> — <short title>
- **Prevention rule**: the reusable rule.
- **Tags**: lang / area / type.

### 2026-06-18 — jsdom missing in CI
- **Prevention rule**: declare test-only deps as devDependencies.
- **Tags**: node / dependencies / ci.

### 2026-06-12 — hardcoded path separator
- **Prevention rule**: join paths via the platform API.
- **Tags**: cross-language / build / path.
`;

export function mkProjectWithSettings(settings, opts = {}) {
  const dir = tempDir("ctide-proj-");
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  const name = opts.local ? "settings.local.json" : "settings.json";
  fs.writeFileSync(path.join(dir, ".claude", name),
    typeof settings === "string" ? settings : JSON.stringify(settings), "utf8");
  return dir;
}

export const ORCH = path.join(HOOKS, "orchestration-check.js");
export function mkTranscript(linesArr) {
  const dir = tempDir("ctide-tx-");
  const p = path.join(dir, "transcript.jsonl");
  fs.writeFileSync(p, linesArr.map((o) => JSON.stringify(o)).join("\n"), "utf8");
  return p;
}
export function orch(input) {
  const out = cp.execFileSync(process.execPath, [ORCH], { input: JSON.stringify(input) }).toString();
  return out.trim() ? JSON.parse(out) : null;
}
export function orchEnv(input, env) {
  const out = cp.execFileSync(process.execPath, [ORCH], { input: JSON.stringify(input), env: { ...process.env, ...env } }).toString();
  return out.trim() ? JSON.parse(out) : null;
}

// A fresh temp project dir, used both as CLAUDE_PROJECT_DIR and as the file's containing tree, so the
// hook's root-anchored .ctide/legacy-output/contract.md resolution has somewhere real to resolve against.
export function mkCGuardProject() {
  return tempDir("ctide-cguard-");
}
export function contractPath(dir) { return path.join(dir, ".ctide", "legacy-output", "contract.md"); }
export function writeContract(dir, markdown) {
  fs.mkdirSync(path.join(dir, ".ctide", "legacy-output"), { recursive: true });
  fs.writeFileSync(contractPath(dir), markdown, "utf8");
}
export function contractJson(overrides) {
  return JSON.stringify({
    ctideContract: 1,
    risk: "high",
    acceptanceCriteria: [{ id: "AC-1", text: "expired token refreshed once", behaviorChanging: true, verification: "test/auth.test.mjs::refreshes once" }],
    allowedPaths: ["src/auth/**"],
    forbiddenPaths: ["src/billing/**"],
    mustNotChange: ["public signature of AuthService.request"],
    ...overrides,
  }, null, 2);
}
export function contractMd(jsonOverrides) {
  return "# Task contract\n\n```json\n" + contractJson(jsonOverrides) + "\n```\n\n## Requirement\n\nSome body text.\n";
}

// --- release fixtures ---

export function parseTar(buffer) {
  const entries = new Map();
  for (let offset = 0; offset < buffer.length;) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const rawName = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const rawPrefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/, "");
    const name = rawPrefix ? `${rawPrefix}/${rawName}` : rawName;
    const mode = Number.parseInt(header.subarray(100, 108).toString("utf8").replace(/\0.*$/, "").trim(), 8);
    const size = Number.parseInt(header.subarray(124, 136).toString("utf8").replace(/\0.*$/, "").trim(), 8) || 0;
    const type = header.subarray(156, 157).toString("utf8") || "0";
    const bodyStart = offset + 512;
    const body = buffer.subarray(bodyStart, bodyStart + size);
    entries.set(name, { mode, size, type, body: Buffer.from(body) });
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}
