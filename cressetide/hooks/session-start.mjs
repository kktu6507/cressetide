#!/usr/bin/env node
// The SessionStart hook entry (startup|resume|clear|compact): one additionalContext holding the
// failure-memory digest (lib/failure-memory.mjs), then — after a compaction, or for an event that names no
// source — the compaction-fidelity reminder (lib/guards/compact.mjs), joined by a blank line. Each part is
// built on its own, so one that fails does not drop the other. Fail-open: when the library cannot be
// loaded, the event is malformed, not a JSON object, or over the 5 MiB cap, or anything throws, the process
// exits 0 with nothing on stdout. Nothing is imported statically: the library is loaded with import()
// inside context(), whose rejection is caught at the bottom, so a plugin copy without lib/ still exits 0.
// Opt-in diagnostics: CTIDE_HOOK_DEBUG.

async function context() {
  const { readHookEvent } = await import("../lib/hook-io.mjs");
  const { createDebug } = await import("../lib/debug.mjs");
  const { failureMemoryContext } = await import("../lib/failure-memory.mjs");
  const { preserveContext } = await import("../lib/guards/compact.mjs");
  const debug = createDebug("session-start");
  const event = await readHookEvent();
  if (!event.ok) {
    debug("stdin", `${event.reason}; nothing injected`);
    return null;
  }
  const parts = [];
  for (const [check, build] of [["failure-memory", failureMemoryContext], ["compact-fidelity", preserveContext]]) {
    try {
      const text = build(event.value, { debug });
      if (text) parts.push(text);
    } catch (error) {
      debug(check, "error: " + (error?.message ?? error));
    }
  }
  if (parts.length === 0) return null;
  return { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: parts.join("\n\n") } };
}

// Write, then exit from the write callback, so the context is flushed whole before the process ends.
function finish(output) {
  if (!output) process.exit(0);
  process.stdout.on("error", () => process.exit(0));
  process.stdout.write(JSON.stringify(output), () => process.exit(0));
}

context().then(finish, () => finish(null));
