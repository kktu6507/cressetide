#!/usr/bin/env node
// The PreToolUse hook entry (Edit|Write|NotebookEdit|Bash|PowerShell): one process runs the plan gate, the
// destructive-command check and the contract check from cressetide/lib/guards/, in that order, and hands
// the first deny or ask to Claude Code. It never answers allow: no decision is no output, and Claude Code
// merges deny > ask across hooks itself. Fail-open: when the library cannot be loaded, the event is
// malformed or over the 5 MiB cap, or anything throws, the process exits 0 with nothing on stdout.
// Nothing is imported statically: the library is loaded with import() inside decide(), whose rejection is
// caught at the bottom, so a plugin copy without lib/ still exits 0. Opt-in diagnostics: CTIDE_HOOK_DEBUG.

// The only decisions passed on. Anything else a check returned is no decision.
const PASSED_ON = new Set(["deny", "ask"]);

async function decide() {
  const { readHookEvent } = await import("../lib/hook-io.mjs");
  const { createDebug } = await import("../lib/debug.mjs");
  const { preToolUse } = await import("../lib/guards/index.mjs");
  const debug = createDebug("pre-tool-use");
  const event = await readHookEvent();
  if (!event.ok) {
    debug("stdin", `${event.reason}; no decision`);
    return null;
  }
  const result = preToolUse(event.value, { debug });
  if (!result || !PASSED_ON.has(result.decision)) return null;
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: result.decision,
      permissionDecisionReason: String(result.reason ?? ""),
    },
  };
}

// Write, then exit from the write callback, so a large reason is flushed whole before the process ends.
function finish(output) {
  if (!output) process.exit(0);
  process.stdout.on("error", () => process.exit(0));
  process.stdout.write(JSON.stringify(output), () => process.exit(0));
}

decide().then(finish, () => finish(null));
