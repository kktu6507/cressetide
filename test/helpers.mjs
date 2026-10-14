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
// GIT_AUTHOR_DATE / GIT_COMMITTER_DATE still win.
export function gitEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (INHERITED_GIT_ENV.includes(key) || /^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/.test(key)) delete env[key];
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
export function hardenGitSigning(cwd) {
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

// Runs a hook by file name with an event on stdin; parses its JSON output. Makes a temp cwd when none is given.
export function runHook(name, event, options = {}) {
  const cwd = options.cwd || tempDir();
  const result = run(process.execPath, [path.join(root, "cressetide", "hooks", name)], {
    cwd,
    input: typeof event === "string" ? event : JSON.stringify(event),
    env: { CLAUDE_PROJECT_DIR: cwd, ...(options.env || {}) },
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
export const MEM = path.join(HOOKS, "load-failure-memory.js");
export const GATE = path.join(HOOKS, "plan-gate.js");
// Lazy on purpose (a function, not a computed-at-import-time constant): a module-top-level statement runs
// at import time, before any importing test file's own before() hook can possibly run (ES module
// evaluation order), so an eager `existsSync` here would touch the real ~/.claude/ path once per run for
// every test file that imports anything from this module -- including files that isolate HOME for their
// own tests via a before() hook, since that hook runs later than this module's own top level. Deferring the
// check into a function means it only runs when its sole caller (session-memory-hooks.test.mjs) actually
// invokes it, inside a test body, after any such isolation is already in effect.
export function hasGlobalMemory() { return fs.existsSync(path.join(os.homedir(), ".claude", "FAILURE_MEMORY.md")); }

// Runs a hook by absolute path with `input` as JSON on stdin; returns its raw stdout.
export function execHook(hookPath, input, env) {
  return cp.execFileSync("node", [hookPath], { input: JSON.stringify(input), env: env || process.env }).toString();
}
export function digestOf(input, env) {
  // Hermetic by default: strip CLAUDE_PROJECT_DIR so the hook's project-root resolution falls back
  // to the event cwd (the temp project under test), not the developer's ambient project dir. Tests
  // that exercise the CLAUDE_PROJECT_DIR precedence pass an explicit env.
  let e = env;
  if (!e) { e = { ...process.env }; delete e.CLAUDE_PROJECT_DIR; }
  const out = execHook(MEM, input, e);
  return out.trim() ? JSON.parse(out).hookSpecificOutput.additionalContext : "";
}
export function mkProject(memFile) {
  const dir = tempDir("ctide-test-");
  if (memFile != null) {
    fs.mkdirSync(path.join(dir, "ai"));
    fs.writeFileSync(path.join(dir, "ai", "FAILURE_MEMORY.md"), memFile, "utf8");
  }
  return dir;
}
export function gate(input, env) {
  // Hermetic by default: strip CLAUDE_PROJECT_DIR so the project opt-out can't be toggled
  // by the developer's ambient environment. Tests that exercise the opt-out pass an explicit env.
  let e = env;
  if (!e) { e = { ...process.env }; delete e.CLAUDE_PROJECT_DIR; }
  const out = execHook(GATE, input, e);
  return out.includes('"deny"') ? "DENY" : "ALLOW";
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
export function gateInProject(input, dir) {
  return gate(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
}

export const ORCH = path.join(HOOKS, "orchestration-check.js");
export function mkTranscript(linesArr) {
  const dir = tempDir("ctide-tx-");
  const p = path.join(dir, "transcript.jsonl");
  fs.writeFileSync(p, linesArr.map((o) => JSON.stringify(o)).join("\n"), "utf8");
  return p;
}
export function orch(input) {
  const out = cp.execFileSync("node", [ORCH], { input: JSON.stringify(input) }).toString();
  return out.trim() ? JSON.parse(out) : null;
}
export function orchEnv(input, env) {
  const out = cp.execFileSync("node", [ORCH], { input: JSON.stringify(input), env: { ...process.env, ...env } }).toString();
  return out.trim() ? JSON.parse(out) : null;
}

export const DGUARD = path.join(HOOKS, "destructive-guard.js");
export function dguard(input, env) {
  let e = env;
  if (!e) { e = { ...process.env }; delete e.CLAUDE_PROJECT_DIR; } // hermetic: ignore ambient project opt-out
  const out = execHook(DGUARD, input, e);
  if (!out.trim()) return "ALLOW";
  const j = JSON.parse(out);
  return (j.hookSpecificOutput && j.hookSpecificOutput.permissionDecision) === "ask" ? "ASK" : "ALLOW";
}

export const COMPACTFIDELITY = path.join(HOOKS, "compact-fidelity.js");
export function compactFidelity(input, env) {
  let e = env;
  if (!e) { e = { ...process.env }; delete e.CLAUDE_PROJECT_DIR; } // hermetic: ignore ambient project opt-out
  const out = execHook(COMPACTFIDELITY, input, e);
  return out.trim() ? JSON.parse(out) : null;
}

export const CGUARD = path.join(HOOKS, "contract-guard.js");
export function cguard(input, env) {
  let e = env;
  if (!e) { e = { ...process.env }; delete e.CLAUDE_PROJECT_DIR; } // hermetic: ignore ambient project opt-out
  const out = execHook(CGUARD, input, e);
  if (!out.trim()) return { decision: "ALLOW" };
  const j = JSON.parse(out);
  const hso = j.hookSpecificOutput || {};
  return { decision: hso.permissionDecision === "ask" ? "ASK" : "ALLOW", reason: hso.permissionDecisionReason || "" };
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

export function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

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

export function makeReleaseRoot() {
  const dir = tempDir("ctide-release-root-");
  fs.mkdirSync(path.join(dir, "cressetide", ".claude-plugin"), { recursive: true });
  fs.writeFileSync(path.join(dir, "cressetide", ".claude-plugin", "plugin.json"), JSON.stringify({ version: "1.2.3" }), "utf8");
  fs.writeFileSync(path.join(dir, "CHANGELOG.md"), "## [1.2.3]\n\nRelease notes.\n\n## [1.2.2]\n\nOld.\n", "utf8");
  return dir;
}

export function makeReleaseRunner({
  state,
  tagExists = true,
  tagCommit = "head",
  fatalReleaseView = false,
  remoteAssetContent = "deterministic test asset",
  remoteChecksumName,
  remoteChecksumText,
  downloadFailures = [],
  downloadFailureStderr = {},
  signedTagSucceeds = false,
  signedTagFails = false,
  requireIdentityForAnnotatedTag = false,
} = {}) {
  const calls = [];
  let currentTagExists = tagExists;
  let gitNameSet = false;
  let gitEmailSet = false;
  const runner = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === "gh" && args[0] === "release" && args[1] === "view") {
      if (fatalReleaseView) {
        const err = new Error("rate limited");
        err.stderr = "HTTP 403: rate limit";
        throw err;
      }
      if (state == null) {
        const err = new Error("not found");
        err.stderr = "HTTP 404: Not Found";
        throw err;
      }
      return state;
    }
    if (cmd === "gh" && args[0] === "release" && args[1] === "download") {
      const pattern = args[args.indexOf("--pattern") + 1];
      if (downloadFailures.includes(pattern)) {
        const err = new Error(`download failed: ${pattern}`);
        err.stderr = downloadFailureStderr[pattern] || `HTTP 404: Not Found (${pattern})`;
        throw err;
      }
      const dir = args[args.indexOf("--dir") + 1];
      fs.mkdirSync(dir, { recursive: true });
      if (pattern.endsWith(".sha256")) {
        const assetName = remoteChecksumName || pattern.replace(/\.sha256$/, "");
        const hash = crypto.createHash("sha256").update(remoteAssetContent).digest("hex");
        const content = typeof remoteChecksumText === "function"
          ? remoteChecksumText(hash, assetName, pattern)
          : remoteChecksumText || `${hash}  ${assetName}\n`;
        fs.writeFileSync(path.join(dir, pattern), content, "utf8");
      } else {
        fs.writeFileSync(path.join(dir, pattern), remoteAssetContent, "utf8");
      }
      return "";
    }
    if (cmd === "git" && args[0] === "config") {
      if (args[1] === "user.name") gitNameSet = true;
      if (args[1] === "user.email") gitEmailSet = true;
      return "";
    }
    if (cmd === "git" && args[0] === "rev-parse" && args[1] === "HEAD") return "head";
    if (cmd === "git" && args[0] === "rev-parse" && args[1] === "-q") {
      if (!currentTagExists) {
        const err = new Error("missing tag");
        err.stderr = "missing tag";
        throw err;
      }
      return "tagref";
    }
    if (cmd === "git" && args[0] === "rev-parse" && args[1] === "v1.2.3^{commit}") return tagCommit;
    if (cmd === "git" && args[0] === "tag" && args[1] === "-s") {
      if (signedTagSucceeds) {
        currentTagExists = true;
        return "";
      }
      if (signedTagFails) {
        const err = new Error("signing failed");
        err.stderr = "signing failed";
        throw err;
      }
    }
    if (cmd === "git" && args[0] === "tag" && args[1] === "-a") {
      if (requireIdentityForAnnotatedTag && (!gitNameSet || !gitEmailSet)) {
        throw new Error("missing tagger identity");
      }
      currentTagExists = true;
      return "";
    }
    if (cmd === "git" && args[0] === "push") return "";
    if (cmd === "gh" && args[0] === "release" && ["upload", "edit", "create"].includes(args[1])) return "";
    throw new Error(`unexpected command: ${cmd} ${args.join(" ")}`);
  };
  return { runner, calls };
}

export function fakeArchiveWriter({ assetPath }) {
  fs.writeFileSync(assetPath, "deterministic test asset", "utf8");
}
