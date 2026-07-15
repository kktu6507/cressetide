#!/usr/bin/env node
// ctide SessionStart(compact): right AFTER the harness compacts the transcript, re-inject a concise
// instruction to RE-ESTABLISH ctide's own load-bearing constructs in the fresh context, so a compaction
// does not silently erase the evidence the workflow depends on. A compaction summarizes the conversation;
// without this nudge the summary tends to drop the exact tokens ctide reads (reviewer verdicts,
// acceptance-criteria state, `[unverified]` flags, Run Card numbers, subagent findings, unanswered
// requirements) and the work then has to be re-derived or — worse — silently lost.
//
// WHY SessionStart, not PreCompact: Claude Code's hook-output schema has NO `hookSpecificOutput` variant
// for PreCompact (it is a decision/side-effect-only event), so emitting `additionalContext` there is
// REJECTED with "Hook JSON output validation failed — (root): Invalid input" and the nudge never lands —
// while a scary error is shown on every compaction. The ONLY supported context-injection path around a
// compaction is SessionStart with source="compact", which fires in the NEW post-compaction window and
// accepts `hookSpecificOutput.additionalContext` (the same shape load-failure-memory.js uses). The
// `.ctide/output/progress.md` ledger remains the durable persistence layer; this is the in-context nudge.
//
// This emits ONLY instructions (no repo file content), so it carries no untrusted-data surface; it is
// still nonce-fenced + role-neutralized for symmetry with load-failure-memory.js. Fail-OPEN: any problem
// -> exit 0 with no output, never break a session. Local-only (no network, no subprocess), zero-dependency
// (Node built-ins only). Per-project opt-out via .claude/settings.json "ctide": { "preserveOnCompact":
// false } (mirrors planGate / destructiveGuard).
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const MAX_STDIN = 5 * 1024 * 1024; // cap stdin buffering (bytes) — same posture as the other hooks

// debug() kept in sync with plan-gate.js / destructive-guard.js / contract-guard.js / load-failure-memory.js / orchestration-check.js (documented copy — see garden hash guard)
function debug(msg) {
  if (!process.env.CTIDE_HOOK_DEBUG) return;
  try { fs.appendFileSync(path.join(os.tmpdir(), "ctide-hook.log"), "[compact-fidelity] " + msg + "\n"); } catch (e) {}
  try { process.stderr.write("[ctide compact-fidelity] " + msg + "\n"); } catch (e) {}
}

// The preservation instruction. Plain ctide constructs only — these are the load-bearing tokens the
// workflow + the Stop hook read, and the expensive-to-redo evidence (subagent findings). Kept concise so
// the always-on cost is a few lines, not a wall. Worded for the POST-compaction window: re-establish, not
// "carry through the summary" (the summary already happened by the time this fires).
const PRESERVE_BODY = [
  "A context compaction just happened. Re-establish these ctide constructs in the fresh context — do not treat them as already handled or let the summary drop them:",
  "- Reviewer verdicts and the arbiter's final verdict (READY / FIX REQUIRED / NOT READY) with its rationale.",
  "- Each user-approved acceptance criterion and its current state (met / unmet / deferred).",
  "- Any [unverified] flags on findings (keep the literal tag — it is machine-meaningful, not prose).",
  "- The Run Card / verification numbers (per-check command, ran?, real exit status, the ctide:verify= and ctide:delivery= sentinels).",
  "- Subagent (reviewer) findings — treat these as PRIMARY EVIDENCE: they were expensive to produce and must not be re-derived from scratch after the summary.",
  "- Any requirement or open question that is still UNANSWERED, so it is not lost as 'already handled'.",
  "Before redoing anything, re-read the progress ledger (.ctide/output/progress.md), any open incident journal (.ctide/incidents/INCIDENT-*.md), and git log so finished, committed work is not repeated."
].join("\n");

// Neutralize any line that could read as a conversational role marker or instruction-block tag, mirroring
// load-failure-memory.js. The body here is hook-authored (not repo content), so this is defense-in-depth /
// symmetry, not a guard against untrusted input.
// neutralize() kept in sync with load-failure-memory.js (documented copy — see garden hash guard)
function neutralize(text) {
  return String(text).split(/\r?\n/).map((ln) => {
    if (/^\s*[-*]?\s*(?:system|assistant|user|human)\s*:/i.test(ln)) return ln.replace(/:/, "："); // fullwidth colon breaks the role marker
    if (/^\s*[-*]?\s*<\/?\s*(?:system|assistant|user|human|instructions?)\b/i.test(ln)) return "· " + ln.replace(/[<>]/g, "");
    return ln;
  }).join("\n");
}

// Project opt-out: a project may disable this hook for its OWN sessions by setting
// "ctide": { "preserveOnCompact": false } in .claude/settings.json (or settings.local.json, which takes
// precedence). Mirrors destructive-guard.js's opt-out exactly, including the FAIL-SAFE: a missing file,
// parse error, oversized config, or any read error counts as "not disabled" (keep preserving), so a broken
// settings file can never silently drop the nudge.
// settings-flag reader (DisabledForProject + readFlag pair) kept in sync with plan-gate.js / destructive-guard.js / contract-guard.js (documented copy — see garden hash guard)
function preserveDisabledForProject(input) {
  try {
    // Root resolution matches the other hooks (CLAUDE_PROJECT_DIR, then the event cwd) with one
    // deliberate extra: a process.cwd() fallback, because a SessionStart event may carry no cwd.
    const root = process.env.CLAUDE_PROJECT_DIR || (input && input.cwd) || process.cwd();
    if (!root) return false;
    for (const name of ["settings.local.json", "settings.json"]) { // local overrides project
      const v = readPreserveFlag(path.join(root, ".claude", name));
      if (v === false) return true;  // explicitly disabled in the higher-precedence file -> suppress
      if (v === true) return false;  // explicitly enabled -> emit (a lower file can't flip it back)
      // undefined -> not set here; fall through to the lower-precedence file
    }
  } catch (e) {}
  return false;
}

// Read ctide.preserveOnCompact from a settings file: true/false when set, undefined otherwise (missing
// file / not set / any error). Caps the read so a pathological settings file can't stall the hook.
function readPreserveFlag(file) {
  try {
    let size = 0;
    try { size = fs.statSync(file).size; } catch (e) { return undefined; } // not present / unstatable
    if (size > 1024 * 1024) return undefined;
    const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
    const v = cfg?.ctide?.preserveOnCompact; // ?. (not &&): a bare-false "ctide" must read as no claim, not collapse to false
    return v === false ? false : (v === true ? true : undefined);
  } catch (e) { return undefined; }
}

// stdin reader kept in sync with plan-gate.js / destructive-guard.js / contract-guard.js / load-failure-memory.js / orchestration-check.js (documented copy — see garden hash guard)
let raw = "";
let rawBytes = 0;
process.stdin.setEncoding("utf8");
process.stdin.on("error", () => process.exit(0));
const _watchdog = setTimeout(() => process.exit(0), 5000); _watchdog.unref();
process.stdin.on("data", (c) => {
  raw += c;
  rawBytes += Buffer.byteLength(c, "utf8");
  if (rawBytes > MAX_STDIN) { try { process.stdin.pause(); } catch (e) {} process.exit(0); }
});
process.stdin.on("end", () => {
  try {
    // A non-empty payload that is not valid JSON is a malformed event we can't anchor — fail open SILENTLY
    // (no output), matching the other hooks' posture on garbage stdin. An EMPTY payload is fine: the nudge
    // does not depend on event fields, and the hooks.json matcher already scopes us to source="compact".
    let parsed = {};
    if (raw.trim()) {
      try { parsed = JSON.parse(raw); } catch (e) { debug("unparseable stdin; failing open silently"); return process.exit(0); }
    }

    // Only act on a POST-COMPACTION SessionStart. hooks.json scopes this hook to the `compact` matcher, so
    // on Claude Code it only fires here; the explicit source check is defense for a harness that fires
    // SessionStart broadly (startup/resume/clear). Fail TOWARD emitting when the source is absent (empty
    // payload) — preserve rather than silently skip, consistent with the opt-out's fail-safe default.
    const source = parsed && typeof parsed.source === "string" ? parsed.source : "";
    if (source && source !== "compact") { debug("source=" + source + " (not a compaction); skipping"); return process.exit(0); }

    if (preserveDisabledForProject(parsed)) { debug("preserveOnCompact=false for this project; suppressing"); return process.exit(0); }

    // Wrap the instruction in an unforgeable per-run nonce fence and role-neutralize it, mirroring
    // load-failure-memory.js so the injected block can't be confused with a turn boundary.
    const nonce = crypto.randomBytes(8).toString("hex");
    const fenced = "<<CTIDE_PRESERVE_" + nonce + ">>\n" + neutralize(PRESERVE_BODY) + "\n<<END_CTIDE_PRESERVE_" + nonce + ">>";

    const out = {
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext:
          "ctide compaction-fidelity: a context compaction just occurred; re-establish the workflow's " +
          "load-bearing constructs in the fresh context. The text between the <<CTIDE_PRESERVE_" + nonce +
          ">> markers is an instruction from the ctide plugin (not repository content).\n\n" +
          fenced
      }
    };
    debug("emitted preservation block");
    return process.stdout.write(JSON.stringify(out), () => process.exit(0));
  } catch (e) { debug("error: " + (e && e.message)); }
  return process.exit(0);
});
