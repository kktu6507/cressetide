// Spawn smoke and wiring tests for the PreToolUse entry (cressetide/hooks/pre-tool-use.mjs): one deny, one
// ask, one contract ask, the deny-over-ask order, each per-project opt-out end to end, and a large deny
// flushed whole. The decision tables of the plan gate, the destructive check and the contract check —
// every row this file used to spawn the three old per-check PreToolUse hooks for —
// run in-process in test/guards.test.mjs (ReDoS timings included, measured around the classifier), the
// stdin outcomes in test/lib-hook-io.test.mjs and the settings precedence in test/lib-settings.test.mjs.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { HOOKS, contractMd, runHookEvent, tempDir, test, write } from "./helpers.mjs";

const ENTRY = "pre-tool-use.mjs";

// The entry spawned in `cwd` with CLAUDE_PROJECT_DIR = cwd, an empty home (the ~/.claude/plans exemption
// and nothing else) and the debug switch off. Returns the permission decision, or "none" for no output.
function decide(cwd, event) {
  const home = tempDir("ctide-pretool-home-");
  const result = runHookEvent(ENTRY, { hook_event_name: "PreToolUse", cwd, ...event }, {
    cwd, env: { HOME: home, USERPROFILE: home, CTIDE_HOOK_DEBUG: "" }, timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr);
  if (result.output === null) return { decision: "none", reason: "" };
  assert.equal(result.output.hookSpecificOutput.hookEventName, "PreToolUse");
  return { decision: result.output.hookSpecificOutput.permissionDecision, reason: result.output.hookSpecificOutput.permissionDecisionReason };
}
const project = () => tempDir("ctide-pretool-proj-");
const planWrite = (cwd) => ({ permission_mode: "plan", tool_name: "Write", tool_input: { file_path: path.join(cwd, "src", "app.ts"), content: "x" } });
const resetHard = { permission_mode: "default", tool_name: "Bash", tool_input: { command: "git reset --hard" } };
const contractFile = (cwd) => path.join(cwd, ".ctide", "output", "contract.md");
const weakeningWrite = (cwd) => {
  write(contractFile(cwd), contractMd());
  return { permission_mode: "default", tool_name: "Write", tool_input: { file_path: contractFile(cwd), content: contractMd({ mustNotChange: [] }) } };
};
const optOut = (cwd, key, file = "settings.json") => write(path.join(cwd, ".claude", file), JSON.stringify({ ctide: { [key]: false } }));

// --- decisions ---

test("PreToolUse entry: a plan-mode Write is denied with the plan gate's reason; the same Write outside plan mode is no output", () => {
  const cwd = project();
  const denied = decide(cwd, planWrite(cwd));
  assert.equal(denied.decision, "deny");
  assert.match(denied.reason, /^ctide plan gate: file modifications are blocked while in plan mode/);
  assert.equal(decide(cwd, { ...planWrite(cwd), permission_mode: "default" }).decision, "none");
});

test("PreToolUse entry: a plan-mode shell write (Bash and PowerShell) is denied by the tripwire", () => {
  for (const tool of ["Bash", "PowerShell"]) {
    const cwd = project();
    const denied = decide(cwd, { permission_mode: "plan", tool_name: tool, tool_input: { command: "echo x > out.txt" } });
    assert.equal(denied.decision, "deny", tool);
    assert.match(denied.reason, new RegExp(`this ${tool} command looks like a working-tree write`), tool);
  }
});

test("PreToolUse entry: git reset --hard asks with the destructive check's reason (Bash and PowerShell)", () => {
  for (const tool of ["Bash", "PowerShell"]) {
    const cwd = project();
    const asked = decide(cwd, { ...resetHard, tool_name: tool });
    assert.equal(asked.decision, "ask", tool);
    assert.match(asked.reason, new RegExp(`^ctide safety-net: this ${tool} command matches a high-confidence destructive pattern`), tool);
  }
});

test("PreToolUse entry: a Write that weakens an established contract asks with the contract check's reason", () => {
  const cwd = project();
  const asked = decide(cwd, weakeningWrite(cwd));
  assert.equal(asked.decision, "ask");
  assert.match(asked.reason, /^ctide contract guard: this Write to \.ctide\/output\/contract\.md would remove or weaken/);
  assert.match(asked.reason, /mustNotChange/);
});

test("PreToolUse entry: a plan-mode command that is both a write and destructive is denied, not asked (deny outranks ask)", () => {
  const cwd = project();
  assert.equal(decide(cwd, { permission_mode: "plan", tool_name: "Bash", tool_input: { command: "git reset --hard" } }).decision, "ask", "control: destructive only asks in plan mode");
  assert.equal(decide(cwd, { permission_mode: "plan", tool_name: "Bash", tool_input: { command: "git reset --hard > reset.log" } }).decision, "deny");
});

test("PreToolUse entry: the deny JSON is fully flushed even with a 2 MiB payload", () => {
  const cwd = project();
  const denied = decide(cwd, { ...planWrite(cwd), tool_input: { file_path: path.join(cwd, "app.ts"), content: "y".repeat(2 * 1024 * 1024) } });
  assert.equal(denied.decision, "deny", "the 2 MiB event is under the cap and its deny is parsed whole");
});

// --- per-project opt-outs, end to end ---

test("PreToolUse entry: ctide.planGate=false allows the plan-mode Write; settings.local.json overrides settings.json", () => {
  const cwd = project();
  optOut(cwd, "planGate");
  assert.equal(decide(cwd, planWrite(cwd)).decision, "none");
  write(path.join(cwd, ".claude", "settings.local.json"), JSON.stringify({ ctide: { planGate: true } }));
  assert.equal(decide(cwd, planWrite(cwd)).decision, "deny", "the local file's explicit true wins");
});

test("PreToolUse entry: ctide.destructiveGuard=false allows git reset --hard; a malformed settings file still asks", () => {
  const cwd = project();
  optOut(cwd, "destructiveGuard", "settings.local.json");
  assert.equal(decide(cwd, resetHard).decision, "none");
  fs.rmSync(path.join(cwd, ".claude", "settings.local.json"));
  write(path.join(cwd, ".claude", "settings.json"), "{");
  assert.equal(decide(cwd, resetHard).decision, "ask", "a broken settings file never drops the net");
});

test("PreToolUse entry: ctide.contractGuard=false allows the weakening Write", () => {
  const cwd = project();
  optOut(cwd, "contractGuard");
  assert.equal(decide(cwd, weakeningWrite(cwd)).decision, "none");
});

// --- wiring ---

test("hooks.json: the PreToolUse matcher covers every gated tool, and MultiEdit is no longer listed", () => {
  const hj = JSON.parse(fs.readFileSync(path.join(HOOKS, "hooks.json"), "utf8"));
  const entries = hj.hooks.PreToolUse;
  assert.equal(entries.length, 1, "one PreToolUse entry runs all three checks");
  assert.equal(entries[0].hooks.length, 1);
  assert.match(entries[0].hooks[0].command, /\/hooks\/pre-tool-use\.mjs"$/);
  const matches = (tool) => new RegExp(`^(?:${entries[0].matcher})$`).test(tool);
  for (const tool of ["Write", "Edit", "NotebookEdit", "Bash", "PowerShell"]) assert.ok(matches(tool), `${tool} must be in the matcher`);
  for (const tool of ["MultiEdit", "Read"]) assert.ok(!matches(tool), `${tool} must not be in the matcher`);
});
