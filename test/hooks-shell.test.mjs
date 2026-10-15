// Cross-shell smoke of the wired PreToolUse command. hooks.json uses the shell form
// `node "${CLAUDE_PLUGIN_ROOT}/hooks/pre-tool-use.mjs"` (probe P0-1): Claude Code substitutes
// ${CLAUDE_PLUGIN_ROOT} textually — on Windows a backslash path that may contain spaces — and also exports
// it, then hands the command to a shell: Git Bash by default, PowerShell for an entry that asks for it. This
// runs the exact wired command that way, with the plugin copied to a directory whose name has a space,
// under bash and under PowerShell (pwsh when present, else Windows PowerShell; run with Set-StrictMode, where
// an unexpanded ${...} in a command is a terminating error before node starts): a plan-mode Write must be
// denied, and the same Write outside plan mode must print nothing. A shell that is missing, or a bash that
// runs another platform's node (WSL's bash.exe on Windows), is skipped with the reason.
import assert from "node:assert/strict";
import cp from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { HOOKS, root, tempDir, test } from "./helpers.mjs";

const COMMAND = JSON.parse(fs.readFileSync(path.join(HOOKS, "hooks.json"), "utf8")).hooks.PreToolUse[0].hooks[0].command;
const PROBE = 'node -e "process.stdout.write(process.platform)"';

// { shell, args before the command, prefix put before the command }, or { skip: reason } when the shell cannot
// run this smoke here.
function bashShell() {
  const candidates = process.platform === "win32"
    ? [process.env.CLAUDE_CODE_GIT_BASH_PATH, path.join(process.env.ProgramFiles || "C:\\Program Files", "Git", "bin", "bash.exe"), "bash"]
    : ["bash"];
  const reasons = [];
  for (const shell of candidates.filter(Boolean)) {
    const probe = cp.spawnSync(shell, ["-c", PROBE], { encoding: "utf8", timeout: 20000 });
    if (!probe.error && probe.status === 0 && probe.stdout === process.platform) return { shell, args: ["-c"] };
    reasons.push(`${shell}: ${probe.error?.code ?? `exit ${probe.status}, node reports ${JSON.stringify(probe.stdout)}`}`);
  }
  return { skip: `no bash that runs this platform's node (${reasons.join("; ")})` };
}
function powerShell() {
  const reasons = [];
  for (const shell of ["pwsh", "powershell"]) {
    const probe = cp.spawnSync(shell, ["-NoProfile", "-NonInteractive", "-Command", PROBE], { encoding: "utf8", timeout: 20000 });
    if (!probe.error && probe.status === 0 && probe.stdout === process.platform) return { shell, args: ["-NoProfile", "-NonInteractive", "-Command"], prefix: "Set-StrictMode -Version Latest; " };
    reasons.push(`${shell}: ${probe.error?.code ?? `exit ${probe.status}`}`);
  }
  return { skip: `neither pwsh nor powershell runs here (${reasons.join("; ")})` };
}

// The plugin copied under a directory named "plugin root" (a space); a fresh copy per test (a tempDir()
// is removed when the test that made it ends).
function copyPlugin() {
  const pluginRoot = path.join(tempDir("ctide-shell-"), "plugin root");
  fs.cpSync(path.join(root, "cressetide"), pluginRoot, { recursive: true });
  return pluginRoot;
}

function runWired({ shell, args, prefix = "" }, pluginRoot, event) {
  const cwd = tempDir("ctide-shell-proj-");
  const home = tempDir("ctide-shell-home-");
  const command = COMMAND.split("${CLAUDE_PLUGIN_ROOT}").join(pluginRoot);
  const result = cp.spawnSync(shell, [...args, prefix + command], {
    cwd, encoding: "utf8", timeout: 30000,
    input: JSON.stringify({ hook_event_name: "PreToolUse", cwd, tool_name: "Write", tool_input: { file_path: path.join(cwd, "app.ts"), content: "x" }, ...event }),
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot, CLAUDE_PROJECT_DIR: cwd, HOME: home, USERPROFILE: home, CTIDE_HOOK_DEBUG: "" },
  });
  assert.equal(result.error, undefined, `${shell}: ${result.error?.message}`);
  assert.equal(result.status, 0, `${shell}: exit ${result.status}: ${result.stderr}`);
  return result.stdout;
}

for (const [label, resolve] of [["bash", bashShell], ["PowerShell", powerShell]]) {
  const resolved = resolve();
  test(`[${label}] the wired PreToolUse command, plugin root with a space: a plan-mode Write is denied, a default-mode Write prints nothing`,
    resolved.skip ? { skip: resolved.skip } : {}, () => {
      assert.match(COMMAND, /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/pre-tool-use\.mjs"$/, "fixture sanity: the shell form is what is wired");
      const pluginRoot = copyPlugin();
      assert.ok(pluginRoot.includes(" "), "fixture sanity: the plugin root has a space");
      const denied = JSON.parse(runWired(resolved, pluginRoot, { permission_mode: "plan" }));
      assert.equal(denied.hookSpecificOutput.permissionDecision, "deny", `${resolved.shell}: plan-mode Write`);
      assert.equal(runWired(resolved, pluginRoot, { permission_mode: "default" }), "", `${resolved.shell}: default-mode Write`);
    });
}
