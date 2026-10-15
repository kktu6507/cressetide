// The compaction-fidelity nudge (SessionStart, source "compact"): right after Claude Code compacts the
// transcript, re-inject a short instruction to re-establish ctide's load-bearing constructs in the fresh
// context, so the summary does not silently drop the evidence the workflow reads. SessionStart, not
// PreCompact: Claude Code's hook-output schema accepts hookSpecificOutput.additionalContext on SessionStart
// but not on PreCompact. Only hook-authored instructions are injected (no repository content); the block
// is still nonce-fenced and role-neutralized. Per-project opt-out: "ctide": { "preserveOnCompact": false }.
// Node built-ins only; no subprocess.
import { fence } from "../hook-io.mjs";
import { guardDisabled } from "../settings.mjs";

const CHECK = "compact-fidelity";
const noDebug = () => {};

export const PRESERVE_BODY = [
  "A context compaction just happened. Re-establish these ctide constructs in the fresh context — do not treat them as already handled or let the summary drop them:",
  "- Reviewer verdicts and the arbiter's final verdict (READY / FIX REQUIRED / NOT READY) with its rationale.",
  "- Each user-approved acceptance criterion and its current state (met / unmet / deferred).",
  "- Any [unverified] flags on findings (keep the literal tag — it is machine-meaningful, not prose).",
  "- The Run Card / verification numbers (per-check command, ran?, real exit status, the ctide:verify= and ctide:delivery= sentinels).",
  "- Subagent (reviewer) findings — treat these as PRIMARY EVIDENCE: they were expensive to produce and must not be re-derived from scratch after the summary.",
  "- Any requirement or open question that is still UNANSWERED, so it is not lost as 'already handled'.",
  "Before redoing anything, re-read the progress ledger (.ctide/output/progress.md), any open incident journal (.ctide/incidents/INCIDENT-*.md), and git log so finished, committed work is not repeated.",
].join("\n");

// The additionalContext text for a post-compaction SessionStart, or null when the event's source is
// something else (startup / resume / clear) or the project opted out. An event with no source emits
// (fail toward preserving: the hooks.json matcher already scopes the real path to "compact"). The opt-out
// root falls back to process.cwd(), since a SessionStart event may carry no cwd.
export function preserveContext(input, { debug = noDebug } = {}) {
  const source = typeof input?.source === "string" ? input.source : "";
  if (source && source !== "compact") {
    debug(CHECK, `source=${source} (not a compaction); skipping`);
    return null;
  }
  if (guardDisabled(input, "preserveOnCompact", { processCwdFallback: true })) {
    debug(CHECK, "disabled for this project (ctide.preserveOnCompact=false); skipping");
    return null;
  }
  const { open, text } = fence("PRESERVE", PRESERVE_BODY);
  debug(CHECK, "emitted the preservation block");
  return "ctide compaction-fidelity: a context compaction just occurred; re-establish the workflow's " +
    "load-bearing constructs in the fresh context. The text between the " + open +
    " markers is an instruction from the ctide plugin (not repository content).\n\n" +
    text;
}
