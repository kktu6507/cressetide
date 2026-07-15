// Shared infrastructure for the per-subject hook/CI test files. Note: bare `node --test`
// discovers EVERY .mjs under test/, so this file runs as one contentless always-passing entry in
// the suite totals (it defines no test()); the ".test."-less name is for human clarity, not runner
// semantics. Accepted: excluding it would need quoted globs (Node ≥21 only; CI floor is 20).
import cp from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOKS = path.join(root, "cressetide", "hooks");
const MEM = path.join(HOOKS, "load-failure-memory.js");
const GATE = path.join(HOOKS, "plan-gate.js");
const globalMemExists = fs.existsSync(path.join(os.homedir(), ".claude", "FAILURE_MEMORY.md"));

function runHook(hookPath, input, env) {
  return cp.execFileSync("node", [hookPath], { input: JSON.stringify(input), env: env || process.env }).toString();
}
function digestOf(input, env) {
  // Hermetic by default: strip CLAUDE_PROJECT_DIR so the hook's project-root resolution falls back
  // to the event cwd (the temp project under test), not the developer's ambient project dir. Tests
  // that exercise the CLAUDE_PROJECT_DIR precedence pass an explicit env.
  let e = env;
  if (!e) { e = { ...process.env }; delete e.CLAUDE_PROJECT_DIR; }
  const out = runHook(MEM, input, e);
  return out.trim() ? JSON.parse(out).hookSpecificOutput.additionalContext : "";
}
function mkProject(memFile) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-test-"));
  if (memFile != null) {
    fs.mkdirSync(path.join(dir, "ai"));
    fs.writeFileSync(path.join(dir, "ai", "FAILURE_MEMORY.md"), memFile, "utf8");
  }
  return dir;
}
function gate(input, env) {
  // Hermetic by default: strip CLAUDE_PROJECT_DIR so the project opt-out can't be toggled
  // by the developer's ambient environment. Tests that exercise the opt-out pass an explicit env.
  let e = env;
  if (!e) { e = { ...process.env }; delete e.CLAUDE_PROJECT_DIR; }
  const out = runHook(GATE, input, e);
  return out.includes('"deny"') ? "DENY" : "ALLOW";
}
// Isolate the home dir for tests that exercise the ~/.claude/plans exemption, so they
// don't touch the developer's real home tree.
function isolatedHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-home-"));
  // os.homedir() reads HOME on POSIX but USERPROFILE on Windows — set both so the
  // isolation actually takes effect cross-platform.
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.CLAUDE_PROJECT_DIR; // hermetic: don't let an ambient project opt-out leak in
  return { home, env };
}

const TWO_ENTRIES_PLUS_PLACEHOLDER = `# FAILURE_MEMORY

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

function mkProjectWithSettings(settings, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-proj-"));
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  const name = opts.local ? "settings.local.json" : "settings.json";
  fs.writeFileSync(path.join(dir, ".claude", name),
    typeof settings === "string" ? settings : JSON.stringify(settings), "utf8");
  return dir;
}
function gateInProject(input, dir) {
  return gate(input, { ...process.env, CLAUDE_PROJECT_DIR: dir });
}

const ORCH = path.join(HOOKS, "orchestration-check.js");
function mkTranscript(linesArr) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-tx-"));
  const p = path.join(dir, "transcript.jsonl");
  fs.writeFileSync(p, linesArr.map((o) => JSON.stringify(o)).join("\n"), "utf8");
  return p;
}
function orch(input) {
  const out = cp.execFileSync("node", [ORCH], { input: JSON.stringify(input) }).toString();
  return out.trim() ? JSON.parse(out) : null;
}

const VALIDATOR = path.join(root, ".github", "scripts", "validate-structure.mjs");
function copyRepoTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-vtree-"));
  fs.cpSync(root, dir, { recursive: true, filter: (src) => {
    const b = path.basename(src);
    // Skip vcs/deps, run-scratch (.ctide/ captures, .claude/ session state) and the same scratch
    // globs validate-structure forbids, so a dirty local working tree can't false-fail the CONTROL
    // copy (cpSync snapshots the tree, not the git index) and 29 temp trees don't each drag ~215KB
    // of untracked run captures along.
    return b !== ".git" && b !== "node_modules" && b !== ".ctide" && b !== ".claude" && !/^_|\.(tmp|bak|log)$|~$/.test(b);
  }});
  return dir;
}
function runValidator(treeDir) {
  const r = cp.spawnSync("node", [VALIDATOR], { cwd: treeDir, encoding: "utf8" });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function parseTar(buffer) {
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

function makeReleaseRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-release-root-"));
  fs.mkdirSync(path.join(dir, "cressetide", ".claude-plugin"), { recursive: true });
  fs.writeFileSync(path.join(dir, "cressetide", ".claude-plugin", "plugin.json"), JSON.stringify({ version: "1.2.3" }), "utf8");
  fs.writeFileSync(path.join(dir, "CHANGELOG.md"), "## [1.2.3]\n\nRelease notes.\n\n## [1.2.2]\n\nOld.\n", "utf8");
  return dir;
}

function makeReleaseRunner({
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

function fakeArchiveWriter({ assetPath }) {
  fs.writeFileSync(assetPath, "deterministic test asset", "utf8");
}

const DGUARD = path.join(HOOKS, "destructive-guard.js");
function dguard(input, env) {
  let e = env;
  if (!e) { e = { ...process.env }; delete e.CLAUDE_PROJECT_DIR; } // hermetic: ignore ambient project opt-out
  const out = runHook(DGUARD, input, e);
  if (!out.trim()) return "ALLOW";
  const j = JSON.parse(out);
  return (j.hookSpecificOutput && j.hookSpecificOutput.permissionDecision) === "ask" ? "ASK" : "ALLOW";
}

function orchEnv(input, env) {
  const out = cp.execFileSync("node", [ORCH], { input: JSON.stringify(input), env: { ...process.env, ...env } }).toString();
  return out.trim() ? JSON.parse(out) : null;
}

const COMPACTFIDELITY = path.join(HOOKS, "compact-fidelity.js");
function compactFidelity(input, env) {
  let e = env;
  if (!e) { e = { ...process.env }; delete e.CLAUDE_PROJECT_DIR; } // hermetic: ignore ambient project opt-out
  const out = runHook(COMPACTFIDELITY, input, e);
  return out.trim() ? JSON.parse(out) : null;
}

const CGUARD = path.join(HOOKS, "contract-guard.js");
function cguard(input, env) {
  let e = env;
  if (!e) { e = { ...process.env }; delete e.CLAUDE_PROJECT_DIR; } // hermetic: ignore ambient project opt-out
  const out = runHook(CGUARD, input, e);
  if (!out.trim()) return { decision: "ALLOW" };
  const j = JSON.parse(out);
  const hso = j.hookSpecificOutput || {};
  return { decision: hso.permissionDecision === "ask" ? "ASK" : "ALLOW", reason: hso.permissionDecisionReason || "" };
}
// A fresh temp project dir, used both as CLAUDE_PROJECT_DIR and as the file's containing tree, so the
// hook's root-anchored .ctide/legacy-output/contract.md resolution has somewhere real to resolve against.
function mkCGuardProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ctide-cguard-"));
}
function contractPath(dir) { return path.join(dir, ".ctide", "legacy-output", "contract.md"); }
function writeContract(dir, markdown) {
  fs.mkdirSync(path.join(dir, ".ctide", "legacy-output"), { recursive: true });
  fs.writeFileSync(contractPath(dir), markdown, "utf8");
}
function contractJson(overrides) {
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
function contractMd(jsonOverrides) {
  return "# Task contract\n\n```json\n" + contractJson(jsonOverrides) + "\n```\n\n## Requirement\n\nSome body text.\n";
}

// Single export block so every moved helper body above stays byte-identical to the monolith.
export {
  root, HOOKS, MEM, GATE, globalMemExists,
  runHook, digestOf, mkProject, gate, isolatedHome, TWO_ENTRIES_PLUS_PLACEHOLDER,
  mkProjectWithSettings, gateInProject,
  ORCH, mkTranscript, orch, orchEnv,
  VALIDATOR, copyRepoTree, runValidator,
  sha256File, parseTar, makeReleaseRoot, makeReleaseRunner, fakeArchiveWriter,
  DGUARD, dguard,
  COMPACTFIDELITY, compactFidelity,
  CGUARD, cguard, mkCGuardProject, contractPath, writeContract, contractJson, contractMd,
};
