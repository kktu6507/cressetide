// Cross-harness portability of the wired hook commands. Hook launch
// must NOT depend on POSIX ${VAR} shell expansion: the GitHub Copilot CLI runs hooks
// via PowerShell on Windows, where ${CLAUDE_PLUGIN_ROOT} is an empty PowerShell variable
// (env vars are $env:), not the path — so node got an unresolved path, the hook
// "errored", and Copilot fail-closed denied every Bash/edit, bricking the session.
// These tests lock in (1) the command SHAPE (node -e bootstrap reading process.env, no
// bare ${...}-as-path) and (2) its BEHAVIOR under each shell available on this machine
// (allow non-plan, deny plan-write, launch the other hooks, and fail OPEN when the root
// is unresolvable). We run the exact wired command via `<shell> -c`, the way a harness does.
import { test } from "node:test";
import assert from "node:assert";
import cp from "node:child_process";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN = path.join(root, "cressetide");
const HOOKS = JSON.parse(fs.readFileSync(path.join(PLUGIN, "hooks", "hooks.json"), "utf8")).hooks;

const WIRED = [
  { event: "PreToolUse", file: "plan-gate.js" },
  { event: "PreToolUse", file: "destructive-guard.js" },
  { event: "PreToolUse", file: "contract-guard.js" },
  { event: "SessionStart", file: "load-failure-memory.js" },
  { event: "Stop", file: "orchestration-check.js" },
  { event: "SessionStart", file: "compact-fidelity.js" }, // relocated from PreCompact (CC rejects its hookSpecificOutput)
];
// PreToolUse now wires two hooks (plan-gate + destructive-guard) in separate entries; resolve by file
// when given, else fall back to the first entry (the plan-gate, which the shell behavior suite drives).
const cmdFor = (event, file) => {
  const entries = HOOKS[event];
  const e = file
    ? entries.find((en) => (en.hooks || []).some((h) => h && typeof h.command === "string" && h.command.includes("hooks/" + file)))
    : entries[0];
  return e.hooks[0].command;
};

const NONPLAN = JSON.stringify({ tool_name: "Bash", tool_input: { command: "echo hi" } });
const PLANWRITE = JSON.stringify({ tool_name: "Write", permission_mode: "plan", tool_input: { file_path: "/tmp/x.txt" } });

// Which `<shell> -c` shells exist here? Availability is probed rather than assumed:
// bash is common on Unix-like hosts, while pwsh/powershell are common on Windows.
function shellOK(sh) {
  const r = cp.spawnSync(sh, ["-c", "exit 0"], { stdio: "ignore" });
  return r.error == null && r.status === 0;
}
const BASH = shellOK("bash") ? "bash" : null;
const PWSH = ["pwsh", "powershell"].find(shellOK) || null;

function runVia(shell, command, input, extraEnv, cwd) {
  const r = cp.spawnSync(shell, ["-c", command], { input, encoding: "utf8", cwd, env: { ...process.env, ...extraEnv } });
  return { status: r.status, stdout: r.stdout || "" };
}

// (1) Static shape — the regression guard for the exact bug.
for (const { event, file } of WIRED) {
  test(`${event} command is a portable, fail-open node -e bootstrap (${file})`, () => {
    const c = cmdFor(event, file);
    assert.match(c, /^node -e /, "must launch via `node -e` so node — not the shell — resolves the path");
    assert.ok(c.includes("process.env.CLAUDE_PLUGIN_ROOT"), "must resolve the plugin root from process.env at runtime");
    assert.ok(c.includes("catch") && c.includes("process.exit(0)"), "must fail open (try/catch -> exit 0)");
    assert.ok(c.includes("hooks/" + file), `must require hooks/${file}`);
    // The command must contain ZERO shell-template tokens. The original bricking form used
    // `${CLAUDE_PLUGIN_ROOT}` as the path (PowerShell doesn't expand it); an intermediate form still kept
    // a trailing `"${CLAUDE_PLUGIN_ROOT}"` arg, which throws under PowerShell StrictMode (unset-variable
    // reference) before node starts. Any `${` reintroduces that whole class, so forbid it outright.
    assert.ok(!c.includes("${"), "must contain no shell-template token (${...}) — node resolves the root from process.env");
  });
}

// (2) Behavior under each available shell — both harnesses export CLAUDE_PLUGIN_ROOT as an env var.
function shellSuite(label, shell) {
  const env = { CLAUDE_PLUGIN_ROOT: PLUGIN };

  test(`[${label}] plan-gate ALLOWS a non-plan Bash (exit 0, no deny)`, () => {
    const r = runVia(shell, cmdFor("PreToolUse"), NONPLAN, env);
    assert.strictEqual(r.status, 0, "must launch and exit 0");
    assert.ok(!r.stdout.includes('"deny"'), "a non-plan command must be allowed");
  });

  test(`[${label}] plan-gate DENIES a plan-mode Write (logic intact)`, () => {
    const r = runVia(shell, cmdFor("PreToolUse"), PLANWRITE, env);
    assert.strictEqual(r.status, 0);
    assert.ok(r.stdout.includes('"deny"'), "a plan-mode write must be denied");
  });

  test(`[${label}] SessionStart and Stop hooks launch without error`, () => {
    assert.strictEqual(runVia(shell, cmdFor("SessionStart"), JSON.stringify({ hook_event_name: "SessionStart" }), env).status, 0);
    assert.strictEqual(runVia(shell, cmdFor("Stop"), JSON.stringify({ hook_event_name: "Stop" }), env).status, 0);
  });

  test(`[${label}] resolves the Copilot fallbacks (COPILOT_PLUGIN_ROOT / PLUGIN_ROOT)`, () => {
    // These two are the literal reason this is a "Copilot" fix; assert each resolves the hook on its own.
    for (const v of ["COPILOT_PLUGIN_ROOT", "PLUGIN_ROOT"]) {
      const e = { ...process.env };
      delete e.CLAUDE_PLUGIN_ROOT; delete e.COPILOT_PLUGIN_ROOT; delete e.PLUGIN_ROOT;
      e[v] = PLUGIN;
      const r = cp.spawnSync(shell, ["-c", cmdFor("PreToolUse")], { input: PLANWRITE, encoding: "utf8", cwd: os.tmpdir(), env: e });
      assert.strictEqual(r.status, 0, `${v}: must launch`);
      assert.ok((r.stdout || "").includes('"deny"'), `${v}: the fallback must resolve the hook (plan-write denied)`);
    }
  });

  test(`[${label}] fail-open: unresolvable plugin root -> exit 0 (never bricks the session)`, () => {
    // No plugin-root env vars + run from a dir with no ./hooks, so require() fails -> catch -> exit 0.
    const e = { ...process.env };
    delete e.CLAUDE_PLUGIN_ROOT; delete e.COPILOT_PLUGIN_ROOT; delete e.PLUGIN_ROOT;
    const r = cp.spawnSync(shell, ["-c", cmdFor("PreToolUse")], { input: NONPLAN, encoding: "utf8", cwd: os.tmpdir(), env: e });
    assert.strictEqual(r.status, 0, "an unresolvable root must fail open, not error");
  });
}

if (BASH) shellSuite("bash", BASH);
else test("bash unavailable on this platform -> shell suite skipped", { skip: true }, () => {});

if (PWSH) shellSuite("powershell", PWSH);
else test("powershell unavailable on this platform -> shell suite skipped", { skip: true }, () => {});

// (2b) destructive-guard cross-shell behavior (item 11). Its bootstrap SHAPE is covered by the WIRED
// static-shape loop above (resolved by file); this pins the cross-shell launch + ask + fail-open behavior,
// the same coverage every other wired hook gets in shellSuite.
function dguardSuite(label, shell) {
  const env = { CLAUDE_PLUGIN_ROOT: PLUGIN };
  const cmd = cmdFor("PreToolUse", "destructive-guard.js");
  const MATCH = JSON.stringify({ tool_name: "Bash", tool_input: { command: "git reset --hard HEAD~3" } });

  test(`[${label}] destructive-guard ASKS on a real destructive match`, () => {
    const r = runVia(shell, cmd, MATCH, env);
    assert.strictEqual(r.status, 0, "must launch and exit 0");
    assert.ok(r.stdout.includes('"ask"'), "a destructive command must be surfaced for confirmation");
  });

  test(`[${label}] destructive-guard fail-open: unresolvable plugin root -> exit 0, no ask`, () => {
    const e = { ...process.env };
    delete e.CLAUDE_PLUGIN_ROOT; delete e.COPILOT_PLUGIN_ROOT; delete e.PLUGIN_ROOT;
    const r = cp.spawnSync(shell, ["-c", cmd], { input: MATCH, encoding: "utf8", cwd: os.tmpdir(), env: e });
    assert.strictEqual(r.status, 0, "an unresolvable root must fail open, not error");
    assert.ok(!(r.stdout || "").includes('"ask"'), "fail-open must not emit an ask");
  });
}
if (BASH) dguardSuite("bash", BASH);
else test("bash unavailable on this platform -> destructive-guard shell suite skipped", { skip: true }, () => {});

if (PWSH) dguardSuite("powershell", PWSH);
else test("powershell unavailable on this platform -> destructive-guard shell suite skipped", { skip: true }, () => {});

// (3) PowerShell StrictMode regression. A ${...} template token in the command is an
// UNSET PowerShell variable; under Set-StrictMode it throws a TERMINATING error BEFORE node starts,
// bricking the session despite the in-script fail-open. The pure-process.env command (no ${}) must
// survive StrictMode. Windows-mostly; skip where pwsh/powershell is unavailable.
if (PWSH) {
  test(`[${PWSH} + StrictMode] plan-gate launches and denies a plan-write (no terminating error)`, () => {
    const r = cp.spawnSync(PWSH, ["-NoProfile", "-Command", "Set-StrictMode -Version Latest; " + cmdFor("PreToolUse")], {
      input: PLANWRITE, encoding: "utf8", env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN },
    });
    assert.strictEqual(r.status, 0, "StrictMode must not throw before node (the command has no ${} unset-var reference)");
    assert.ok((r.stdout || "").includes('"deny"'), "plan-write must be denied under StrictMode");
  });
} else {
  test("powershell unavailable -> StrictMode regression skipped", { skip: true }, () => {});
}
