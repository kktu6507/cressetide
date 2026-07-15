#!/usr/bin/env node
// ctide Stop hook (best-effort, non-blocking). Four advisories, all fail-open:
//   1. Verdict not honored: the arbiter's last verdict in the transcript was a BLOCKING
//      one (FIX REQUIRED / NOT READY), but the final message claims the work is done/ready
//      without surfacing that block. This is the highest-value check — it guards the product's
//      core promise (a ship/no-ship verdict that actually gates delivery).
//   2. Panel missing/incomplete: a READY verdict is asserted but the core review panel
//      (intent-reviewer, test-reviewer, arbiter) did not all run as independent subagents. One
//      disclosed escape: a reviewer named in the final message's ctide:panel=substituted:<names>
//      sentinel is exempt IF it is on the EXEMPTIBLE whitelist (test-reviewer only) AND
//      ctide:verify=pass — the evidence-substituted fast lane (references/reviewer-selection.md).
//      intent-reviewer and arbiter are never exemptible.
//   3. Verification not honored: the verification sentinel (ctide:verify=) reports a REQUIRED
//      check failed or never ran, yet the session is delivering. The command exit status is
//      authority over reviewer prose — a red/unrun required check must gate delivery. Fires ONLY
//      on the explicit sentinel (no prose inference), mirroring advisory 1's delivery-sentinel path.
//   4. Evidence not logged: a real, verified, DELIVERED run (a arbiter Task ran AND
//      ctide:verify=pass AND the session is delivering) carries NO `### Live run` evidence block.
//      ctide ships no telemetry, so a run that isn't written down does not count — this nudges the
//      run to emit its paste-ready evidence block (references/final-report.md, Evidence Record). A pure
//      logging reminder, never a block; excludes trivial (verify=na / no sentinel) and held/mid-repair
//      runs (gated on delivering), so it only fires on a completed real run that forgot to log itself.
// A Stop hook is ADVISORY by default (systemMessage, never blocks) — the pragmatism default, so a
// false positive can never trap the user. An explicit opt-in (CTIDE_ENFORCE_STOP) upgrades ONLY the
// highest-confidence, fully sentinel-based signal (a real id-bound arbiter blocking verdict AND an
// explicit ctide:delivery=shipped) to a Stop block; every other path stays advisory. Always exit 0,
// never crash. If the transcript can't be parsed (format differs), it does nothing — absence equals
// prior behavior.
// Provenance is structured AND tool-bound: panel presence is read only from real `Task` invocations,
// and the arbiter verdict only from a arbiter Task's own tool_result — never from free prose, a
// non-Task tool_use that merely contains "subagent_type:", or an unrelated tool_result that merely
// contains the verdict vocabulary. So none of those can spoof either advisory.
const fs = require("fs");
const os = require("os");
const path = require("path");

const REQUIRED = ["intent-reviewer", "test-reviewer", "arbiter"];
// The only REQUIRED name the evidence-substituted fast lane may exempt from the panel advisory
// (references/reviewer-selection.md, Evidence substitution). A whitelist, not a config knob:
// intent-reviewer (the only omission lens) and arbiter (the verdict itself) are never exemptible,
// so a sentinel naming them changes nothing — the floor holds even against a persuasive final summary.
const EXEMPTIBLE = new Set(["test-reviewer"]);
const MAX_TRANSCRIPT = 32 * 1024 * 1024; // cap the synchronous transcript read; fail-open (skip) above it
const MAX_STDIN = 5 * 1024 * 1024; // cap stdin buffering (bytes) — the Stop event JSON, not the transcript (capped separately above)

// Opt-in HARD enforcement (default OFF). When CTIDE_ENFORCE_STOP is truthy, the single highest-
// confidence, fully sentinel-based signal — a real id-bound arbiter blocking verdict AND an explicit
// ctide:delivery=shipped — is upgraded from advisory to a Stop BLOCK. Everything else stays advisory.
// Never blocks on prose, ambiguity, the verify sentinel, the panel check, or an absent transcript. The
// model always controls a one-token escape (emit ctide:delivery=held). Trap-risk + disengage: README.
const ENFORCE = /^(1|true|yes|on)$/i.test(String(process.env.CTIDE_ENFORCE_STOP || ""));

// debug() kept in sync with plan-gate.js / destructive-guard.js / contract-guard.js / load-failure-memory.js / compact-fidelity.js (documented copy — see garden hash guard)
function debug(msg) {
  if (!process.env.CTIDE_HOOK_DEBUG) return;
  try { fs.appendFileSync(path.join(os.tmpdir(), "ctide-hook.log"), "[orchestration-check] " + msg + "\n"); } catch (e) {}
  try { process.stderr.write("[ctide orchestration-check] " + msg + "\n"); } catch (e) {}
}

// The last verdict token in a body of transcript text. Verdicts are machine-checked literals
// (SKILL.md forbids translating them), so a literal scan is reliable. Order the alternation so
// "NOT READY" / "FIX REQUIRED" are matched whole before the bare "READY" inside "NOT READY".
function lastVerdict(text) {
  const re = /\b(NOT READY|FIX REQUIRED|READY)\b/g;
  let m, last = "";
  while ((m = re.exec(text)) !== null) last = m[1];
  return last;
}

// Language-neutral "the final message asserts a READY verdict". READY / FIX REQUIRED / NOT READY
// and the severity labels blocker/major/minor are machine-checked literals kept verbatim in every
// language (SKILL.md, Language And Text Integrity), so this still fires on a localized summary
// whose surrounding prose — including the English words "verdict" / "arbiter" / "readiness" —
// is translated. Requires >=2 distinct severity labels (the formal Findings section always lists
// blocker/major/minor) so a bare incidental "READY" can't trip it. Without this, a non-English
// summary ("最終裁決：READY") matched neither branch and both advisories below went silent.
function assertsReadyVerdict(text) {
  // Require an AFFIRMATIVE "READY" — the bare token NOT immediately preceded by "NOT". Matching the
  // "READY" inside "NOT READY" was the single leaky base predicate behind multiple bugs: it made
  // claimsComplete/claimsShipReady true for HONEST disclosures of a NOT READY block (so an honest
  // "NOT READY, so I'm not shipping" — especially a localized one carrying the verbatim severity
  // labels — was misread as a ship claim and wrongly nagged). Fixing it here de-leaks every dependent.
  if (!/(?<!NOT\s)\bREADY\b/.test(text)) return false;
  if (/verdict|arbiter|readiness/i.test(text)) return true;
  const sev = new Set((text.match(/\b(?:blocker|major|minor)s?\b/ig) || [])
    .map((s) => s.toLowerCase().replace(/s$/, "")));
  return sev.size >= 2;
}

// Does the final message claim the work is finished/shippable? Broader than a formal verdict so
// it catches an orchestrator that drops the verdict token and just says "looks good, you're set"
// — the exact way a blocking verdict gets quietly ignored. Safe to be generous here: the
// verdict-not-honored warning also requires a real blocking verdict token to exist first.
function claimsComplete(text) {
  if (assertsReadyVerdict(text)) return true;
  return /\b(ready to (?:ship|merge|release|go)|good to go|all set|you'?re all set|ship it|shipped|is complete|is done|done!|all done|no (?:remaining |outstanding )?issues|safe to (?:ship|merge|release)|looks good)\b/i.test(text);
}

// A DELIBERATE ship/readiness decision — used to gate the panel-presence check, which (unlike
// verdict-honoring) has no blocking-token precondition, so it must stay clear of casual "looks
// good / done" to avoid crying wolf. Catches the formal verdict (in any language) AND the
// lowercase / no-keyword ship phrasings, closing the "drop the verdict word to dodge the check"
// gap without nagging trivial completions.
function claimsShipReady(text) {
  if (assertsReadyVerdict(text)) return true;
  return /\b(ready to (?:ship|merge|release)|cleared to (?:ship|merge|release)|safe to (?:ship|merge|release)|good to go|ship it|ready for (?:release|production|merge))\b/i.test(text);
}

// Does the final message HONESTLY hold delivery — an explicit not-ship / stop / hold DECISION? Used
// to gate the verdict-not-honored check so that "the arbiter said NOT READY, but it's ready to
// ship" still warns (no hold cue), while "complete, but NOT READY, so I'm not shipping" stays silent.
// Keyed on the ship DECISION only — NOT on problem-description words like "unresolved" / "blocked"
// (those describe the issue, not the choice to stop), so a block acknowledged-then-overridden is not
// mistaken for an honest hold. It is still needed even with the assertsReadyVerdict fix above, because
// claimsComplete can be true via an English completion phrase (e.g. "is complete") — this cue is what
// keeps an honest English "complete, but NOT READY, so I'm not shipping" silent. NOTE: this is an
// ENGLISH-only heuristic and only a FALLBACK; the language-neutral, authoritative path is the
// delivery sentinel below.
function holdsDelivery(text) {
  return /\b(?:not|won'?t|will not|do(?:es)? not|cannot|can'?t|are not|is not|isn'?t|aren'?t|not going to|not gonna)\s+(?:ship|shipp?ing|merg(?:e|ing)|releas(?:e|ing)|deliver(?:ing)?)\b/i.test(text)
    || /\bnot\s+ready\s+to\s+(?:ship|merge|release|go)\b/i.test(text)
    || /\b(?:stopping|halting|holding(?:\s+(?:off|back))?|on hold|withholding|paus(?:e|ing))\b/i.test(text);
}

// THE ARCHITECTURE FIX (signal at the source, language-neutral, deterministic): the orchestrator MAY
// end its final summary with a machine-readable delivery sentinel stating its decision unambiguously,
// so the verdict-not-honored check does NOT have to infer "is this shipping or honestly holding?" from
// translated prose (the fragile part that kept producing false positives). Format (case/space tolerant):
//   ctide:delivery=held      → not delivering (honoring a block / stopping) → silent
//   ctide:delivery=shipped   → delivering → a blocking verdict here is unhonored → warn
// When present it is AUTHORITATIVE; when absent the prose heuristic (claimsComplete && !holdsDelivery)
// is the fallback. SKILL.md instructs the orchestrator to emit it; this hook never depends on it.
function deliverySentinel(text) {
  // Last-match (like lastVerdict): the orchestrator's final rollup line wins even if an earlier
  // delivery decision is discussed in prose above it.
  const re = /ctide\s*:\s*delivery\s*=\s*(held|hold|holding|stop|stopped|blocked|shipped|ship|shipping|delivered|deliver|delivering|merged|released)/ig;
  let m, last = null;
  while ((m = re.exec(text)) !== null) last = m[1];
  if (last === null) return null;
  return /^(?:held|hold|holding|stop|stopped|blocked)$/i.test(last) ? "held" : "shipped";
}

// THE VERIFICATION SENTINEL (the structural fix for advisory 3, language-neutral, deterministic): the
// orchestrator MAY end its final summary with a machine-readable rollup of whether the REQUIRED checks
// actually passed, so the hook does NOT have to infer "is the build green?" from prose or from Bash
// exit codes scattered in the transcript (the fragile part). Format (case/space tolerant), distinct
// stem from `delivery` so the two regexes never cross-match:
//   ctide:verify=pass   → every required check ran and exited zero
//   ctide:verify=fail   → a required check ran and exited non-zero
//   ctide:verify=unrun  → a required check was claimed/expected but never actually ran
//   ctide:verify=na     → no command checks were required (docs-only / trivial)
// When present it is AUTHORITATIVE; when absent advisory 3 is a dead branch (no prose fallback — the
// near-zero-false-positive posture the delivery sentinel established). Last-match scan (like lastVerdict /
// deliverySentinel) so the final rollup line wins over an earlier in-prose mention. TOLERANT DECODER: the
// CONTRACT surface is exactly the four literals pass|fail|unrun|na (what the arbiter emits and the docs
// publish); the extra synonyms (passed/green/ok, failed/red/broken, skipped/blocked/not-run) are defensive
// folds for human/LLM variance, mirroring deliverySentinel — they fail safe (each folds to its nearest
// favorable meaning; an unrecognized value yields null).
function verifySentinel(text) {
  const re = /ctide\s*:\s*verify\s*=\s*(pass|passed|green|ok|fail|failed|red|broken|unrun|not-?run|notrun|skipped|blocked|na|n\/?a)/ig;
  let m, last = null;
  while ((m = re.exec(text)) !== null) last = m[1];
  if (last === null) return null;
  const v = last.toLowerCase();
  if (/^(?:pass|passed|green|ok)$/.test(v)) return "pass";
  if (/^(?:fail|failed|red|broken)$/.test(v)) return "fail";
  if (/^(?:na|n\/?a)$/.test(v)) return "na";
  return "unrun";
}

// THE PANEL SENTINEL (the disclosure line for evidence-substituted review): the orchestrator states
// which review panel actually ran, so the exemption below is never inferred from prose. Format
// (case/space tolerant), distinct stem from `delivery`/`verify` so the three regexes never cross-match:
//   ctide:panel=full                                  → the full selected panel ran (pure disclosure)
//   ctide:panel=substituted:<comma-separated-names>   → the named reviewers were evidence-substituted
// The name list uses a BOUNDED charset ([a-z0-9,-]): a newline in the final message is either a
// JSON-escaped literal "\n" (when finalText is stringified JSON) or a raw newline byte (when finalText
// is the raw last_assistant_message string) — either way a greedy match would swallow the next
// sentinel line; the bound excludes both the backslash and the raw newline byte, terminating the
// list. NO synonym folds here, unlike the two decoders above: the value
// gates an exemption (a weaker warning), so only the exact contract grammar may decode — an
// unrecognized value or an empty name list yields null, failing toward warning, never toward a
// silent exemption. The charset includes "," so a value like "substituted:," matches the regex yet
// decodes to zero names — that decoded-but-empty list is normalized to null too, keeping the
// null-means-no-sentinel contract exact. Last-match scan (like the two sentinels above) so the
// final rollup line wins.
function panelSentinel(text) {
  const re = /ctide\s*:\s*panel\s*=\s*(full|substituted\s*:\s*[a-z0-9,\-]+)/ig;
  let m, last = null;
  while ((m = re.exec(text)) !== null) last = m[1];
  if (last === null) return null;
  const v = last.toLowerCase().replace(/\s+/g, "");
  if (v === "full") return { mode: "full", names: [] };
  const names = v.slice("substituted:".length).split(",").filter(Boolean);
  return names.length ? { mode: "substituted", names } : null;
}

// stdin reader kept in sync with plan-gate.js / destructive-guard.js / contract-guard.js / load-failure-memory.js / compact-fidelity.js (documented copy — see garden hash guard)
let raw = "";
let rawBytes = 0;
process.stdin.setEncoding("utf8");
process.stdin.on("error", () => process.exit(0));
const _wd = setTimeout(() => process.exit(0), 5000); _wd.unref();
process.stdin.on("data", (c) => {
  raw += c;
  rawBytes += Buffer.byteLength(c, "utf8");
  if (rawBytes > MAX_STDIN) { debug("stdin over cap; skipping"); try { process.stdin.pause(); } catch (e) {} process.exit(0); }
});
process.stdin.on("end", () => {
  try {
    const input = JSON.parse(raw || "{}");
    const tpath = input.transcript_path || input.transcriptPath || "";
    if (!tpath) return process.exit(0);

    // statSync also fails open on a missing path (ENOENT -> catch). The size is sampled here and the
    // read below is unbounded, so a file that grows past the cap in this window is an accepted
    // best-effort gap (on Stop the session has ended; the transcript is not actively appended).
    let tsize = 0;
    try { tsize = fs.statSync(tpath).size; } catch (e) { return process.exit(0); }
    if (tsize > MAX_TRANSCRIPT) { debug("transcript over cap (" + tsize + " bytes); skipping"); return process.exit(0); }
    const text = fs.readFileSync(tpath, "utf8");
    const lines = text.split(/\r?\n/).filter(Boolean);
    const parsed = lines.map((ln) => { try { return JSON.parse(ln); } catch (e) { return null; } });

    // Provenance is STRUCTURED and TOOL-BOUND. Panel presence is read only from real `Task`
    // invocations (a tool_use whose name is "Task"); the arbiter verdict only from the
    // tool_result of a arbiter Task. Free prose — human OR assistant — is never trusted, and
    // neither is a non-Task tool_use whose input merely contains "subagent_type: ..." (e.g. an Edit
    // writing that string) nor an unrelated tool_result that merely contains the verdict vocabulary
    // (e.g. a Bash log printing "NOT READY"). Shapes handled: {role,content} and {message:{content}};
    // content may be a string or an array of typed blocks.
    const blocksOf = (obj) => {
      const c = obj ? ((obj.message && obj.message.content !== undefined) ? obj.message.content : obj.content) : null;
      return Array.isArray(c) ? c : [];
    };
    const isTaskUse = (b) => b && (b.type === "tool_use" || b.type === "tool-use") && b.name === "Task";
    const isToolResult = (b) => b && (b.type === "tool_result" || b.type === "tool-result");
    const resultTextOf = (b) => {
      const rc = b.content;
      if (typeof rc === "string") return rc;
      if (Array.isArray(rc)) return rc.map((x) => (x && typeof x.text === "string") ? x.text : "").join("\n");
      return rc != null ? JSON.stringify(rc) : "";
    };
    const allBlocks = parsed.flatMap(blocksOf);

    // The agent identity of a `Task` block comes ONLY from its explicit input field
    // (subagent_type / agentType / agent_type) — never from stringifying the whole input. The old
    // approach scanned the serialized input, so free text in a SIBLING field — e.g. a real arbiter
    // Task whose PROMPT quotes "subagent_type: intent-reviewer" — spoofed panel presence and silenced the
    // advisories. Reading the structured field closes that: the prompt is not the agent type. A string
    // input is JSON-parsed first; anything unreadable yields "" (fail-safe — the agent reads as "did not
    // run", i.e. toward warning, never toward a silent false pass).
    const subagentTypeOf = (b) => {
      let inp = b && b.input;
      if (typeof inp === "string") { try { inp = JSON.parse(inp); } catch (e) { return ""; } }
      if (!inp || typeof inp !== "object") return "";
      const v = (inp.subagent_type != null) ? inp.subagent_type
              : (inp.agentType != null) ? inp.agentType
              : (inp.agent_type != null) ? inp.agent_type : "";
      return typeof v === "string" ? v.toLowerCase() : "";
    };

    // Did the panel actually run? Only real `Task` invocations count, and only via the structured
    // subagent_type field (REQUIRED names are lowercase, matched as a substring of e.g. "ctide:intent-reviewer").
    const taskTypes = allBlocks.filter(isTaskUse).map(subagentTypeOf);
    const ran = new Set();
    for (const name of REQUIRED) {
      if (taskTypes.some((t) => t.includes(name))) ran.add(name);
    }
    const missing = REQUIRED.filter((n) => !ran.has(n));

    // Ids of arbiter `Task` invocations, so the verdict binds to that Task's own result rather than
    // any tool_result that happens to mention the vocabulary — again from the structured field only.
    const arbiterIds = new Set();
    for (const b of allBlocks) {
      if (isTaskUse(b) && b.id != null && subagentTypeOf(b).includes("arbiter")) arbiterIds.add(b.id);
    }

    // Locate the final assistant message (the orchestrator's closing summary).
    let finalText = "", finalIdx = lines.length;
    for (let i = lines.length - 1; i >= 0; i--) {
      const obj = parsed[i];
      if (!obj) continue;
      const role = obj.role || (obj.message && obj.message.role) || obj.type;
      if (role === "assistant") { finalText = JSON.stringify(obj); finalIdx = i; break; }
    }

    // The Stop event itself can carry the orchestrator's actual final message separately from
    // the transcript file (transcript_path/transcriptPath dual-key convention above; subagentTypeOf's
    // subagent_type/agentType/agent_type fallback below) — prefer it for finalText when present, a
    // string, and non-empty after trimming (a transcript-write race or a summary produced after the
    // last transcript entry can leave the transcript-derived value stale). finalIdx is DELIBERATELY
    // left untouched: it has no equivalent in last_assistant_message and still bounds the separate
    // panel/verdict-provenance scans below (anyResultId / verdictParts), which read only the transcript.
    const rawLastAssistantMessage = (input.last_assistant_message !== undefined)
      ? input.last_assistant_message
      : input.lastAssistantMessage;
    if (typeof rawLastAssistantMessage === "string" && rawLastAssistantMessage.trim() !== "") {
      finalText = rawLastAssistantMessage;
    }

    // The arbiter's verdict comes ONLY from a arbiter Task's tool_result, before the final
    // summary. Bind by tool_use_id. The id-less fallback is TRANSCRIPT-LEVEL, not per-result: it applies
    // only when NO pre-final tool_result carries an id at all (an older / id-free format where binding is
    // impossible). When binding IS possible (any result has an id), an id-less result must NOT enter the
    // verdict pool — otherwise a stray id-less result containing "READY" (e.g. a Bash log line) would be
    // appended after the arbiter's real NOT READY and, as the LAST verdict, silence the advisory.
    // Reading the LAST verdict means a FIX REQUIRED → repair → READY loop reads as READY, not a stale block.
    let anyResultId = false;
    for (let i = 0; i < finalIdx && !anyResultId; i++) {
      for (const b of blocksOf(parsed[i])) {
        if (!isToolResult(b)) continue;
        if ((b.tool_use_id != null ? b.tool_use_id : b.toolUseId) != null) { anyResultId = true; break; }
      }
    }
    const verdictParts = [];
    for (let i = 0; i < finalIdx; i++) {
      for (const b of blocksOf(parsed[i])) {
        if (!isToolResult(b)) continue;
        const id = b.tool_use_id != null ? b.tool_use_id : b.toolUseId;
        if (id != null) { if (arbiterIds.has(id)) verdictParts.push(resultTextOf(b)); }
        else if (!anyResultId) verdictParts.push(resultTextOf(b)); // id-less only when binding is impossible transcript-wide
      }
    }
    const verdict = lastVerdict(verdictParts.join("\n"));
    const finalClaimsComplete = claimsComplete(finalText);
    const finalShipReady = claimsShipReady(finalText);
    const finalHoldsDelivery = holdsDelivery(finalText);
    const finalDelivery = deliverySentinel(finalText); // "held" | "shipped" | null
    const finalVerify = verifySentinel(finalText);     // "pass" | "fail" | "unrun" | "na" | null
    const finalPanel = panelSentinel(finalText);       // {mode:"full"|"substituted",names:[…]} | null
    // Is the session delivering without honoring the block? The delivery sentinel is authoritative
    // when present (deterministic, language-neutral); otherwise fall back to the English prose
    // heuristic. This is the structural fix for the false-positive class that prose-parsing produced.
    const sessionDelivers = finalDelivery !== null
      ? finalDelivery === "shipped"
      : (finalClaimsComplete && !finalHoldsDelivery);
    // Evidence-substitution exemption for advisory 2 (references/reviewer-selection.md, Evidence
    // substitution): a missing REQUIRED reviewer stops counting as missing ONLY when the final message
    // explicitly discloses the substitution (ctide:panel=substituted:<names>), the name is on the
    // EXEMPTIBLE whitelist by EXACT lowercase match against the REQUIRED literal (never a substring —
    // ran-detection above may substring-match "ctide:test-reviewer", but an exemption must not be
    // buyable with "test-reviewer-lite"), AND the verification sentinel is green (ctide:verify=pass).
    // `na` does not qualify: no required checks means no red→green positive evidence, so nothing
    // actually answered the substituted reviewer's question. Anything less — no sentinel, panel=full,
    // a fail/unrun/na/absent verify, an unlisted or non-exemptible name — leaves the advisory exactly
    // as before (fail toward warning).
    const exempted = new Set(
      (finalPanel && finalPanel.mode === "substituted" && finalVerify === "pass")
        ? finalPanel.names.filter((n) => EXEMPTIBLE.has(n))
        : []
    );
    const unmet = missing.filter((n) => !exempted.has(n));
    debug("verdict=" + verdict + " claimsComplete=" + finalClaimsComplete + " reportsBlock=" + /\b(NOT READY|FIX REQUIRED)\b/.test(finalText) +
      " shipReady=" + finalShipReady + " holds=" + finalHoldsDelivery + " sentinel=" + finalDelivery +
      " verify=" + finalVerify + " panel=" + (finalPanel ? finalPanel.mode + (finalPanel.names.length ? ":" + finalPanel.names.join(",") : "") : null) +
      " delivers=" + sessionDelivers + " ran=[" + [...ran].join(",") + "] unmet=[" + unmet.join(",") + "]");

    // (1) Verdict not honored — highest value. A real blocking verdict was reached, yet the session
    // is DELIVERING (per the sentinel, or per the prose heuristic when no sentinel). An honest hold —
    // "ctide:delivery=held", or "complete, but NOT READY, so not shipping" — is not nagged; a final
    // that quotes the block but still ships ("NOT READY, but it's ready to ship") is caught.
    if ((verdict === "NOT READY" || verdict === "FIX REQUIRED") && sessionDelivers) {
      const msg = "ctide: the arbiter's last verdict was '" + verdict + "', but the session is " +
        "ending as if the work were complete/ready. A " + verdict + " verdict must gate delivery — " +
        "either continue the repair loop until the arbiter returns READY, or report the block " +
        "(what remains unresolved and why) instead of claiming done. Do not override the verdict silently.";
      // HARD enforce ONLY when: opted in, NOT re-entered from a prior block (loop-trap guard), and the
      // delivery decision is the EXPLICIT sentinel ctide:delivery=shipped (never the prose fallback).
      // This is strictly narrower than sessionDelivers: a prose-only "ship" can warn but NEVER blocks,
      // and an honest ctide:delivery=held (finalDelivery !== "shipped") is the model's one-token escape.
      const stopActive = input.stop_hook_active === true || input.stopHookActive === true;
      if (ENFORCE && !stopActive && finalDelivery === "shipped") {
        return process.stdout.write(JSON.stringify({
          decision: "block",
          reason: msg + " (ctide hard-enforce: CTIDE_ENFORCE_STOP is set. To proceed, get the " +
            "arbiter to READY, or emit ctide:delivery=held to hold honestly, or unset " +
            "CTIDE_ENFORCE_STOP.)"
        }), () => process.exit(0));
      }
      return process.stdout.write(JSON.stringify({ systemMessage: msg }), () => process.exit(0));
    }

    // (2) READY asserted but the core panel did not fully run. Graded: distinguish "never ran"
    // (panel clearly skipped) from "incomplete" (some core reviewers missing — e.g. only the
    // arbiter ran, skipping the spec/test reviewers that do the actual review work). Suppression
    // is gated on an HONEST HOLD (the delivery=held sentinel, or `holdsDelivery`), NOT on mere
    // presence of a block token: a mixed-history close that *mentions* an earlier NOT READY yet still
    // claims READY + ships ("was NOT READY, but it's ready now") must still warn. Gating on the bare
    // `NOT READY`/`FIX REQUIRED` token wrongly silenced that case (the panel safety-net defeated by a
    // prose mention); `holdsDelivery` keys on the ship DECISION, and `delivery=held` is authoritative.
    // A second, narrower escape is the evidence-substitution exemption computed above: `unmet` is
    // `missing` minus any disclosed + whitelisted + verify=pass substitution — only that name is
    // removed; everything else about this advisory (gating, grading, never blocking) is unchanged.
    if (finalShipReady && !finalHoldsDelivery && unmet.length > 0 && finalDelivery !== "held") {
      const msg = ran.size === 0
        ? "ctide: a READY verdict was asserted but none of the core review panel (intent-reviewer, " +
          "test-reviewer, arbiter) appears to have run as a subagent this session. A self-review is " +
          "not a formal multi-agent review — run the panel, or downgrade to FIX REQUIRED and disclose " +
          "it as local self-review."
        : "ctide: a READY verdict was asserted, but the core review panel is incomplete — " +
          unmet.join(", ") + " did not run as a subagent this session. intent-reviewer and " +
          "test-reviewer do the actual review work; a verdict resting on a partial panel is not a " +
          "formal multi-agent review. Run the missing reviewer(s), disclose an eligible evidence " +
          "substitution (ctide:panel=substituted:test-reviewer, valid only with ctide:verify=pass — " +
          "references/reviewer-selection.md), or downgrade to FIX REQUIRED and disclose the gap.";
      return process.stdout.write(JSON.stringify({ systemMessage: msg }), () => process.exit(0));
    }

    // (3) Verification not honored. The verification sentinel reports a REQUIRED check failed or was
    // never run, yet the session is delivering. Placed LAST (lowest priority): the two advisories above
    // early-return, so at most one systemMessage is ever emitted and this branch never perturbs them.
    // Fires ONLY on the explicit literal ctide:verify=fail|unrun — never inferred from prose, a Bash
    // exit code, or the word "failed"; absent the sentinel this branch is dead and behavior is exactly
    // as before. Gated on sessionDelivers (delivery sentinel authoritative; prose fallback) so an honest
    // hold — ctide:verify=fail + ctide:delivery=held — stays silent (holding on a red check is correct).
    if ((finalVerify === "fail" || finalVerify === "unrun") && sessionDelivers) {
      const what = finalVerify === "fail"
        ? "a required check (build/test/typecheck on behavior-changing code) exited non-zero"
        : "a required check was claimed but never actually run";
      const msg = "ctide: the verification sentinel reports " + what + " (ctide:verify=" + finalVerify +
        "), but the session is ending as if the work were complete/ready. A red or unrun required check " +
        "must gate delivery — the command's exit status is authority, reviewer findings cannot override " +
        "a red build. Fix and rerun the check until it is green (ctide:verify=pass), or hold delivery " +
        "(ctide:delivery=held) and report what failed or was not run.";
      return process.stdout.write(JSON.stringify({ systemMessage: msg }), () => process.exit(0));
    }

    // (4) Evidence not logged. A REAL, verified, DELIVERED run — a arbiter Task actually ran, the
    // verification sentinel is green (ctide:verify=pass), and the session is delivering — yet the final
    // report carries no `### Live run` evidence block. Placed LAST (lowest priority): the three integrity
    // advisories above early-return, so reaching here means the run is otherwise clean, which is exactly
    // when a real run is contracted to log itself (references/final-report.md, Evidence Record). This is a
    // pure logging NUDGE, never a block. It is conservative by construction — it requires the arbiter
    // Task (a real ctide verdict, not a bare sentinel), verify=pass (so trivial verify=na / no-sentinel
    // and red/unrun runs never trip it), and sessionDelivers (so a held / mid-repair run is not nagged) —
    // honoring the pragmatism axiom that a false positive is worse than a documented miss. Detection of the
    // block is GENEROUS (loose /Live run/ match) so an existing block reliably suppresses the nudge; the
    // `### Live run` header is a guarded literal (validate-structure 5f) so a prose rename can't silently
    // make this inert. Like every advisory it is finalText-scoped and emits at most one systemMessage.
    const hasLiveRun = /\bLive run\b/i.test(finalText);
    if (finalVerify === "pass" && sessionDelivers && ran.has("arbiter") && !hasLiveRun) {
      const msg = "ctide: this was a real, verified run (a arbiter verdict ran and ctide:verify=pass), " +
        "but the final report has no `### Live run` evidence block. ctide ships no telemetry, so a run " +
        "that isn't written down does not count — emit the `### Live run` block (see references/final-report.md, " +
        "Evidence Record) so the run can be pasted into EVIDENCE.md or the Verified-run issue form. Omit it " +
        "only for trivial edits, pure Q&A, or benchmark/demo runs.";
      return process.stdout.write(JSON.stringify({ systemMessage: msg }), () => process.exit(0));
    }
  } catch (e) { debug("error: " + (e && e.message)); }
  return process.exit(0);
});
