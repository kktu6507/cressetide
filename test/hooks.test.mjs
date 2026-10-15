// Spawn smoke and wiring tests for the hook entry points (cressetide/hooks/pre-tool-use.mjs,
// session-start.mjs) and hooks.json. The checks' decision tables live in-process in test/guards.test.mjs,
// test/lib-failure-memory.test.mjs, test/lib-hook-io.test.mjs, test/lib-debug.test.mjs and
// test/lib-settings.test.mjs; here each entry is spawned the way Claude Code runs it, to pin what only a
// process shows: the exit status, the stdout shape, fail-open when the library is missing or stdin is
// malformed or over the 5 MiB cap, and that an entry never answers "allow". The PreToolUse decisions and
// opt-outs end to end are in test/plan-gate-guards.test.mjs, the SessionStart ones in
// test/session-memory-hooks.test.mjs.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { HOOKS, root, runHookEvent, tempDir, test, write } from "./helpers.mjs";

const PLUGIN = path.join(root, "cressetide");
const ENTRIES = ["pre-tool-use.mjs", "session-start.mjs"];
const hooksJson = () => JSON.parse(fs.readFileSync(path.join(HOOKS, "hooks.json"), "utf8"));

// An event each entry answers with output when everything works — the control that makes every
// fail-open row below discriminating (a plan-mode Write is denied; a compaction gets the reminder).
const ANSWERED = {
  "pre-tool-use.mjs": (cwd) => ({ hook_event_name: "PreToolUse", cwd, permission_mode: "plan", tool_name: "Write", tool_input: { file_path: path.join(cwd, "app.ts"), content: "x" } }),
  "session-start.mjs": (cwd) => ({ hook_event_name: "SessionStart", cwd, source: "compact" }),
};
// No ambient project, debug switch or memory file: an empty home and the event's own cwd only.
function isolated(cwd) {
  const home = tempDir("ctide-hooks-home-");
  return { cwd, env: { CLAUDE_PROJECT_DIR: cwd, HOME: home, USERPROFILE: home, CTIDE_HOOK_DEBUG: "" } };
}

// --- AC-5: fail-open ---

test("AC-5: an entry exits 0 with no output when cressetide/lib/ is missing (a plugin copy without lib)", () => {
  const parent = tempDir("ctide-hooks-nolib-");
  const full = path.join(parent, "plugin full");
  const nolib = path.join(parent, "plugin nolib");
  const lib = path.join(PLUGIN, "lib");
  fs.cpSync(PLUGIN, full, { recursive: true });
  fs.cpSync(PLUGIN, nolib, { recursive: true, filter: (src) => src !== lib && !src.startsWith(lib + path.sep) });
  assert.ok(!fs.existsSync(path.join(nolib, "lib")), "fixture sanity: the copy has no lib/");
  for (const entry of ENTRIES) {
    const cwd = tempDir("ctide-hooks-proj-");
    const options = isolated(cwd);
    const control = runHookEvent(path.join(full, "hooks", entry), ANSWERED[entry](cwd), options);
    assert.equal(control.status, 0, `${entry}: control exit`);
    assert.ok(control.output?.hookSpecificOutput, `${entry}: control — with lib/ present the same event is answered`);
    const result = runHookEvent(path.join(nolib, "hooks", entry), ANSWERED[entry](cwd), options);
    assert.equal(result.status, 0, `${entry}: a missing lib must exit 0 (${result.stderr})`);
    assert.equal(result.stdout, "", `${entry}: a missing lib must print nothing`);
  }
});

test("AC-5: an entry exits 0 with no output on stdin '{' (malformed JSON)", () => {
  for (const entry of ENTRIES) {
    const cwd = tempDir("ctide-hooks-proj-");
    const result = runHookEvent(entry, "{", isolated(cwd));
    assert.equal(result.status, 0, entry);
    assert.equal(result.stdout, "", entry);
  }
});

test("AC-5: an entry exits 0 with no output on a 6 MiB event (over the 5 MiB stdin cap)", () => {
  for (const entry of ENTRIES) {
    const cwd = tempDir("ctide-hooks-proj-");
    const control = runHookEvent(entry, ANSWERED[entry](cwd), isolated(cwd));
    assert.ok(control.output?.hookSpecificOutput, `${entry}: control — the same event under the cap is answered`);
    const oversized = JSON.stringify({ ...ANSWERED[entry](cwd), filler: "x".repeat(6 * 1024 * 1024) });
    const result = runHookEvent(entry, oversized, { ...isolated(cwd), timeout: 30000 });
    assert.equal(result.status, 0, `${entry}: ${result.error?.code ?? ""}`);
    assert.equal(result.stdout, "", entry);
  }
});

test("an entry exits 0 with no output on stdin that is JSON but not an object (null, [], a string)", () => {
  for (const entry of ENTRIES) {
    for (const stdin of ["null", "[]", '"s"']) {
      const cwd = tempDir("ctide-hooks-proj-");
      const result = runHookEvent(entry, stdin, isolated(cwd));
      assert.equal(result.status, 0, `${entry} ${stdin}`);
      assert.equal(result.stdout, "", `${entry} ${stdin}`);
    }
  }
});

// --- never "allow" ---

// The entry with its library replaced by a stub whose preToolUse() returns whatever STUB_DECISION says,
// so the entry's own mapping is what is tested: only deny and ask are passed on.
function stubbedPreToolUse() {
  const dir = path.join(tempDir("ctide-hooks-stub-"), "plugin root");
  fs.mkdirSync(path.join(dir, "hooks"), { recursive: true });
  fs.copyFileSync(path.join(HOOKS, "pre-tool-use.mjs"), path.join(dir, "hooks", "pre-tool-use.mjs"));
  for (const name of ["hook-io.mjs", "debug.mjs", "redact.mjs"]) {
    write(path.join(dir, "lib", name), fs.readFileSync(path.join(PLUGIN, "lib", name), "utf8"));
  }
  write(path.join(dir, "lib", "guards", "index.mjs"),
    'export function preToolUse() { return { decision: process.env.STUB_DECISION, reason: "stub reason", check: "stub" }; }\n');
  return path.join(dir, "hooks", "pre-tool-use.mjs");
}

test("PreToolUse never answers allow: a check result other than deny or ask is no output", () => {
  const entry = stubbedPreToolUse();
  const cwd = tempDir("ctide-hooks-proj-");
  const event = { hook_event_name: "PreToolUse", cwd, tool_name: "Bash", tool_input: { command: "ls" } };
  for (const decision of ["deny", "ask"]) {
    const result = runHookEvent(entry, event, { cwd, env: { STUB_DECISION: decision } });
    assert.equal(result.status, 0, decision);
    assert.deepEqual(result.output, { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: "stub reason" } },
      `control: the stub is wired — ${decision} is passed on`);
  }
  for (const decision of ["allow", "ALLOW", "defer", "bogus", ""]) {
    const result = runHookEvent(entry, event, { cwd, env: { STUB_DECISION: decision } });
    assert.equal(result.status, 0, decision);
    assert.equal(result.stdout, "", `a check result "${decision}" must not reach Claude Code`);
  }
});

test("PreToolUse never answers allow on the real tree: no-decision events print nothing", () => {
  for (const event of [
    { tool_name: "Write", permission_mode: "default", tool_input: { file_path: "app.ts", content: "x" } },
    { tool_name: "Bash", permission_mode: "default", tool_input: { command: "git status" } },
    { tool_name: "Read", permission_mode: "plan", tool_input: { file_path: "app.ts" } },
  ]) {
    const cwd = tempDir("ctide-hooks-proj-");
    const result = runHookEvent("pre-tool-use.mjs", { ...event, cwd }, isolated(cwd));
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "", JSON.stringify(event));
  }
});

// --- the entries' imports ---

test("the entries import nothing statically and never load lib/git.mjs or node:child_process", () => {
  for (const entry of ENTRIES) {
    const source = fs.readFileSync(path.join(HOOKS, entry), "utf8");
    assert.doesNotMatch(source, /^\s*import\s+[^(]/m, `${entry}: no static import (the library loads through import() so a missing lib fails open)`);
    assert.doesNotMatch(source, /\brequire\s*\(/, `${entry}: no require()`);
    assert.doesNotMatch(source, /child_process|lib\/git\.mjs/, `${entry}: no subprocess and no git`);
  }
});

// --- hooks.json wiring ---

test("hooks.json wires exactly three entries: pre-tool-use.mjs, session-start.mjs, orchestration-check.js", () => {
  const wired = [];
  for (const [event, entries] of Object.entries(hooksJson().hooks)) {
    for (const entry of entries) for (const handler of entry.hooks) wired.push([event, entry.matcher ?? "", handler.command]);
  }
  assert.deepEqual(wired, [
    ["PreToolUse", "Edit|Write|NotebookEdit|Bash|PowerShell", 'node "${CLAUDE_PLUGIN_ROOT}/hooks/pre-tool-use.mjs"'],
    ["SessionStart", "startup|resume|clear|compact", 'node "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.mjs"'],
    ["Stop", "", 'node "${CLAUDE_PLUGIN_ROOT}/hooks/orchestration-check.js"'],
  ]);
  const scripts = fs.readdirSync(HOOKS).filter((name) => /\.m?js$/.test(name)).sort();
  assert.deepEqual(scripts, ["orchestration-check.js", "pre-tool-use.mjs", "session-start.mjs"], "no hook script outside the three entries");
});

test("hooks.json no longer wires a PreCompact hook (CC rejects hookSpecificOutput on PreCompact)", () => {
  // Regression lock for the shipped defect: a PreCompact hook emitting hookSpecificOutput was rejected by
  // Claude Code's hook-output schema ("Invalid input"); the compaction reminder lives in the SessionStart
  // entry (source "compact") and PreCompact stays unwired.
  assert.ok(!hooksJson().hooks.PreCompact, "PreCompact must not be wired");
});

// --- the Stop hook (orchestration-check.js, untouched until P6) ---

test("orchestration check advises when shipped delivery reports a failed verification", () => {
  const cwd = tempDir();
  const transcript = path.join(cwd, "transcript.jsonl");
  const taskBlocks = ["intent-reviewer", "test-reviewer", "arbiter"].map((agent, index) => ({ type: "tool_use", name: "Task", id: `task-${index}`, input: { subagent_type: agent } }));
  const lines = [
    JSON.stringify({ role: "assistant", content: taskBlocks }),
    JSON.stringify({ role: "user", content: [{ type: "tool_result", tool_use_id: "task-2", content: "READY" }] }),
    JSON.stringify({ role: "assistant", content: [{ type: "text", text: "final" }] }),
  ];
  fs.writeFileSync(transcript, lines.join("\n"), "utf8");
  const result = runHookEvent("orchestration-check.js", { transcript_path: transcript, last_assistant_message: "READY\nctide:verify=fail\nctide:delivery=shipped\nctide:panel=full" }, { cwd });
  assert.equal(result.status, 0);
  assert.match(result.output.systemMessage, /verification sentinel reports .*exited non-zero/);
});

test("the Stop hook fails open on malformed and oversized stdin", () => {
  for (const stdin of ["{", "x".repeat(6 * 1024 * 1024)]) {
    const result = runHookEvent("orchestration-check.js", stdin, { timeout: 30000 });
    assert.equal(result.status, 0);
    assert.equal(result.output, null);
  }
});
