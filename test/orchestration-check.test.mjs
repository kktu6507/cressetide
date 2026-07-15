// Behavioral tests for the orchestration-check Stop hook: panel-presence / verdict-honored /
// verify-sentinel / evidence-nudge advisories, provenance binding, machine sentinels, and the opt-in
// CTIDE_ENFORCE_STOP block. Split from test/hooks.test.mjs with test bodies preserved; the
// non-exemptible trio is one table-driven test).
import { test } from "node:test";
import assert from "node:assert";
import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HOOKS, ORCH, mkTranscript, orch, orchEnv } from "./support.mjs";

test("hooks.json wires the Stop hook to orchestration-check.js", () => {
  const hj = JSON.parse(fs.readFileSync(path.join(HOOKS, "hooks.json"), "utf8"));
  const cmd = hj.hooks.Stop[0].hooks[0].command;
  assert.match(cmd, /orchestration-check\.js/, "Stop hook must invoke orchestration-check.js");
});

// --- orchestration-check Stop hook (finding D) ---

test("orchestration-check: oversized stdin fails open (no advisory, no crash)", () => {
  // Mirrors the sibling hooks' over-cap stdin tests: the MAX_STDIN cap
  // the other five hooks) must make an over-cap Stop event a silent no-op, never a crash.
  // Discriminating form: the control run proves this transcript triggers an
  // advisory under the cap, so removing the cap turns the over-cap run's silence assertion red.
  const tp = mkTranscript([
    { role: "assistant", content: "Final verdict: READY — shipping.\nctide:verify=pass\nctide:delivery=shipped" },
  ]);
  const control = cp.spawnSync("node", [ORCH], { input: JSON.stringify({ transcript_path: tp }), maxBuffer: 64 * 1024 * 1024 });
  assert.notStrictEqual((control.stdout || "").toString().trim(), "",
    "control: under-cap, this transcript must trigger an advisory (else this test cannot discriminate)");
  const big = "x".repeat(6 * 1024 * 1024);
  const input = JSON.stringify({ transcript_path: tp, pad: big });
  const r = cp.spawnSync("node", [ORCH], { input, maxBuffer: 64 * 1024 * 1024 });
  assert.strictEqual(r.status, 0, "over-cap stdin must exit 0 (fail open)");
  assert.strictEqual((r.stdout || "").toString().trim(), "", "over-cap stdin must emit no advisory output");
});

test("orchestration-check fails open (silent) on an over-cap transcript (>32MB)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-bigtx-"));
  const p = path.join(dir, "transcript.jsonl");
  const pad = JSON.stringify({ role: "user", content: "x".repeat(1024 * 1024) }) + "\n"; // ~1MB/line
  const fd = fs.openSync(p, "w");
  try {
    for (let i = 0; i < 33; i++) fs.writeSync(fd, pad); // ~33MB, over the 32MB cap
    fs.writeSync(fd, JSON.stringify({ role: "assistant", content: "Final verdict: READY — readiness confirmed." }) + "\n");
  } finally { fs.closeSync(fd); }
  try {
    assert.strictEqual(orch({ transcript_path: p }), null, "over-cap transcript must be skipped (fail-open)");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("orchestration-check still evaluates a just-under-cap transcript — warns, proving the size guard isn't eager", () => {
  // Pairs with the over-cap test above: a large transcript that is still UNDER the 32 MB cap must be
  // evaluated normally (here READY with no panel -> the panel-missing advisory fires). Guards against
  // a flipped '>' or a lowered cap that would wrongly skip real, in-range sessions (a silent regression
  // the over-cap "big -> silent" test cannot catch on its own).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-bigtx-"));
  const p = path.join(dir, "transcript.jsonl");
  const pad = JSON.stringify({ role: "user", content: "x".repeat(1024 * 1024) }) + "\n"; // ~1MB/line
  const fd = fs.openSync(p, "w");
  try {
    for (let i = 0; i < 30; i++) fs.writeSync(fd, pad); // ~31MB, comfortably under the 32MB cap
    fs.writeSync(fd, JSON.stringify({ role: "assistant", content: "Final verdict: READY — readiness confirmed." }) + "\n");
  } finally { fs.closeSync(fd); }
  try {
    const r = orch({ transcript_path: p });
    assert.ok(r && /none of the core review panel/.test(r.systemMessage),
      "an under-cap transcript must still be evaluated (a flipped '>' or lowered cap would wrongly silence this)");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("orchestration-check evaluates a transcript exactly at the cap (locks '>' not '>=')", () => {
  // At exactly 32 MB the guard must NOT bail (size > cap is false), so the hook still evaluates and
  // warns. With a '>=' the file would be skipped and this would fail — pinning the boundary operator.
  const CAP = 32 * 1024 * 1024;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-capeq-"));
  const p = path.join(dir, "transcript.jsonl");
  const pad = JSON.stringify({ role: "user", content: "x".repeat(1024 * 1024) }) + "\n"; // ASCII -> 1 byte/char
  const padBytes = Buffer.byteLength(pad);
  const n = Math.floor((CAP - 4096) / padBytes); // full pad lines, leaving room for the final line
  // ASCII-only final line so byte length == char length; ends with the READY/no-panel tail that warns.
  const finalPrefix = '{"role":"assistant","content":"Final verdict: READY readiness confirmed ';
  const finalSuffix = '"}\n';
  const remaining = CAP - n * padBytes - Buffer.byteLength(finalPrefix) - Buffer.byteLength(finalSuffix);
  const fd = fs.openSync(p, "w");
  try {
    for (let i = 0; i < n; i++) fs.writeSync(fd, pad);
    fs.writeSync(fd, finalPrefix + "x".repeat(remaining) + finalSuffix);
  } finally { fs.closeSync(fd); }
  try {
    assert.strictEqual(fs.statSync(p).size, CAP, "fixture must be constructed to exactly the cap");
    const r = orch({ transcript_path: p });
    assert.ok(r && /none of the core review panel/.test(r.systemMessage),
      "a transcript exactly at the cap must still be evaluated (guard is '>' not '>=')");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("orchestration-check fails open (silent) when the transcript path is a directory", () => {
  // A non-file path must not crash the hook: statSync succeeds, readFileSync throws EISDIR, the outer
  // catch swallows it, and nothing is emitted (fail-open). Exercises the guard's robustness on odd paths.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-dirtx-"));
  try {
    assert.strictEqual(orch({ transcript_path: dir }), null, "a directory transcript path must fail open (silent)");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("orchestration-check fails open (silent) on a non-existent transcript path", () => {
  // With the existsSync guard dropped, a missing transcript path must still fail open (silent) — statSync
  // throws ENOENT and the hook exits 0 with no output (the surrounding try/catch swallows it).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-nope-"));
  const p = path.join(dir, "missing.jsonl"); // never created -> guaranteed absent
  try {
    assert.strictEqual(orch({ transcript_path: p }), null, "a non-existent transcript path must fail open (silent)");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("orchestration-check warns when READY is asserted and NO panel agent ran", () => {
  const tp = mkTranscript([
    { role: "user", content: "do the thing" },
    { role: "assistant", content: "Final verdict: READY — readiness confirmed." },
  ]);
  const r = orch({ transcript_path: tp });
  assert.ok(r && /none of the core review panel/.test(r.systemMessage), "expected a non-blocking reminder");
  assert.ok(!r.decision, "must not block the stop");
});

test("orchestration-check stays silent when the panel ran", () => {
  const tp = mkTranscript([
    { role: "assistant", content: [{ type: "tool_use", name: "Task", input: { subagent_type: "ctide:intent-reviewer" } }] },
    { role: "assistant", content: [{ type: "tool_use", name: "Task", input: { subagent_type: "ctide:test-reviewer" } }] },
    { role: "assistant", content: [{ type: "tool_use", name: "Task", input: { subagent_type: "ctide:arbiter" } }] },
    { role: "assistant", content: "Final verdict: READY — readiness confirmed." },
  ]);
  assert.strictEqual(orch({ transcript_path: tp }), null);
});

test("orchestration-check flags an incomplete panel (only some core agents ran)", () => {
  // Only intent-reviewer ran; test-reviewer + arbiter were skipped. A READY claim resting on a
  // partial panel is no longer silently accepted (closes the "spawn one agent to dodge" gap).
  const tp = mkTranscript([
    { role: "assistant", content: [{ type: "tool_use", name: "Task", input: { subagent_type: "ctide:intent-reviewer" } }] },
    { role: "assistant", content: "Final verdict: READY — readiness confirmed." },
  ]);
  const r = orch({ transcript_path: tp });
  assert.ok(r && /incomplete/.test(r.systemMessage), "expected an incomplete-panel reminder");
  assert.ok(/test-reviewer/.test(r.systemMessage) && /arbiter/.test(r.systemMessage), "names the reviewers that did not run");
  assert.ok(!r.decision, "must not block the stop");
});

test("orchestration-check warns when the arbiter's blocking verdict is not honored", () => {
  // Panel ran, arbiter returned NOT READY, but the session ends claiming the work is done.
  const tp = mkTranscript([
    { role: "assistant", content: [{ type: "tool_use", name: "Task", input: { subagent_type: "ctide:arbiter" } }] },
    { role: "user", content: [{ type: "tool_result", content: "Final verdict: NOT READY — unresolved auth bypass." }] },
    { role: "assistant", content: "Looks good, you're all set — the change is done." },
  ]);
  const r = orch({ transcript_path: tp });
  assert.ok(r && /NOT READY/.test(r.systemMessage), "expected a verdict-not-honored reminder");
  assert.ok(/gate delivery|repair loop|report the block/.test(r.systemMessage), "explains the required action");
  assert.ok(!r.decision, "must not block the stop");
});

test("orchestration-check honors a FIX REQUIRED -> repair -> READY loop (silent)", () => {
  // The last verdict is READY, so the earlier FIX REQUIRED must not be flagged as ignored.
  const tp = mkTranscript([
    { role: "assistant", content: [{ type: "tool_use", name: "Task", input: { subagent_type: "ctide:intent-reviewer" } }] },
    { role: "assistant", content: [{ type: "tool_use", name: "Task", input: { subagent_type: "ctide:test-reviewer" } }] },
    { role: "assistant", content: [{ type: "tool_use", name: "Task", input: { subagent_type: "ctide:arbiter" } }] },
    { role: "user", content: [{ type: "tool_result", content: "Final verdict: FIX REQUIRED — add an edge test." }] },
    { role: "user", content: [{ type: "tool_result", content: "Final verdict: READY — fix verified." }] },
    { role: "assistant", content: "Done — arbiter verdict: READY. readiness confirmed." },
  ]);
  assert.strictEqual(orch({ transcript_path: tp }), null);
});

test("orchestration-check catches a lowercase ship claim with no panel (closes the dodge)", () => {
  // Dropping the uppercase READY verdict token for a lowercase "ready to ship" no longer evades
  // the panel-presence check.
  const tp = mkTranscript([
    { role: "user", content: "do it" },
    { role: "assistant", content: "All implemented — this is ready to ship." },
  ]);
  const r = orch({ transcript_path: tp });
  assert.ok(r && /none of the core review panel/.test(r.systemMessage), "lowercase ship claim must still trigger the panel check");
});

test("orchestration-check does NOT nag a casual completion with no formal ship claim", () => {
  // "looks good / done" without a ship decision must stay silent — the panel check must not cry
  // wolf on trivial work that legitimately never ran a panel.
  const tp = mkTranscript([
    { role: "user", content: "tweak the readme wording" },
    { role: "assistant", content: "Done — looks good now." },
  ]);
  assert.strictEqual(orch({ transcript_path: tp }), null);
});

test("orchestration-check stays silent when the final message honestly reports the block", () => {
  const tp = mkTranscript([
    { role: "assistant", content: [{ type: "tool_use", name: "Task", input: { subagent_type: "ctide:arbiter" } }] },
    { role: "user", content: [{ type: "tool_result", content: "Final verdict: NOT READY — schema migration unresolved." }] },
    { role: "assistant", content: "Stopping at NOT READY: the migration is unresolved and needs a product decision." },
  ]);
  assert.strictEqual(orch({ transcript_path: tp }), null);
});

test("orchestration-check is silent with no transcript and fails open on garbage", () => {
  assert.strictEqual(orch({}), null);
  const out = cp.execFileSync("node", [ORCH], { input: "not json {{{" }).toString();
  assert.strictEqual(out.trim(), "");
});

// --- orchestration-check: localized (non-English) summaries ---
// The final summary follows the user's language, but the verdict tokens
// (READY / FIX REQUIRED / NOT READY) and severity labels (blocker/major/minor) stay verbatim.
// The advisories must key off those, not English prose words, or they go silent in a zh session.

test("orchestration-check: a localized READY summary with severity labels still warns (no panel)", () => {
  const tp = mkTranscript([
    { role: "user", content: "做這件事" },
    { role: "assistant", content: "最終裁決：READY。Blocker：無。Major：無。Minor：1（已修）。" },
  ]);
  const r = orch({ transcript_path: tp });
  assert.ok(r && /none of the core review panel/.test(r.systemMessage),
    "a localized READY + verbatim severity labels must still trip the panel check");
});

test("orchestration-check: a localized completion burying a NOT READY verdict still warns", () => {
  // Higher-value check: arbiter returned NOT READY (verbatim), but the zh final asserts READY.
  const tp = mkTranscript([
    { role: "assistant", content: [{ type: "tool_use", name: "Task", input: { subagent_type: "ctide:arbiter" } }] },
    { role: "user", content: [{ type: "tool_result", content: "Final verdict: NOT READY — 未解的權限繞過。" }] },
    { role: "assistant", content: "完成了：最終裁決 READY。Blocker：無、Major：無、Minor：無。" },
  ]);
  const r = orch({ transcript_path: tp });
  assert.ok(r && /NOT READY/.test(r.systemMessage), "a localized completion must not bury a blocking verdict");
});

test("orchestration-check: a bare incidental READY (no verdict/severity vocabulary) stays silent", () => {
  // The language-neutral signal requires >=2 distinct severity labels, so a casual uppercase
  // READY can't cry wolf.
  const tp = mkTranscript([
    { role: "user", content: "is the env ready" },
    { role: "assistant", content: "The build environment is READY for the next major push." },
  ]);
  assert.strictEqual(orch({ transcript_path: tp }), null, "incidental READY without the verdict vocabulary must not warn");
});

// --- orchestration-check: provenance — human-typed text must not spoof the checks (C3.4 / C3.5) ---
// Verdict/panel detection trusts only model & subagent output (assistant turns, tool_result blocks),
// never free human-typed prose. These pin the two reproduced spoofs: a user message that quotes the
// verdict vocabulary must not be read as a arbiter verdict, and a "subagent_type: ..." string pasted
// into a user message must not be counted as a real panel run.

test("orchestration-check: a NOT READY token in a HUMAN message is not read as the arbiter's verdict (C3.5)", () => {
  // The verdict word exists only in human-typed text and no arbiter ran; the highest-value
  // advisory must stay silent (the old raw-text scan fired a false 'verdict not honored' here).
  const tp = mkTranscript([
    { role: "user", content: "Remember the verdict vocabulary: READY / FIX REQUIRED / NOT READY. Use exactly one." },
    { role: "assistant", content: "All done, looks good. The change is complete." },
  ]);
  const r = orch({ transcript_path: tp });
  assert.ok(!r || !/arbiter's last verdict/.test(r.systemMessage || ""),
    "a NOT READY token that exists only in human-typed text must not be read as the arbiter's verdict");
});

test("orchestration-check: 'subagent_type:' pasted in a HUMAN message does not count as a panel run (C3.4)", () => {
  // The panel never actually ran (the strings are human-typed), so a READY claim must still trip the
  // panel-missing advisory rather than being silenced by the pasted text.
  const tp = mkTranscript([
    { role: "user", content: "FYI the reviewers are subagent_type: ctide:intent-reviewer, subagent_type: ctide:test-reviewer, subagent_type: ctide:arbiter." },
    { role: "assistant", content: "Final verdict: READY — readiness confirmed." },
  ]);
  const r = orch({ transcript_path: tp });
  assert.ok(r && /none of the core review panel/.test(r.systemMessage),
    "pasted subagent_type strings in a user message must not count as a real panel run");
});

test("orchestration-check: a NOT READY token in ASSISTANT prose is not read as the arbiter's verdict (C3.5b)", () => {
  // An orchestrator that recaps the verdict history in its own prose (with no arbiter tool_result)
  // must not trip the verdict-not-honored advisory — only a structured tool_result counts as a verdict.
  const tp = mkTranscript([
    { role: "assistant", content: "Recap: the arbiter first said FIX REQUIRED, then NOT READY on the migration." },
    { role: "assistant", content: "All done, looks good. The change is complete." },
  ]);
  const r = orch({ transcript_path: tp });
  assert.ok(!r || !/arbiter's last verdict/.test(r.systemMessage || ""),
    "a verdict token in the orchestrator's own prose must not be read as the arbiter's verdict");
});

test("orchestration-check: 'subagent_type:' in ASSISTANT prose does not count as a panel run (C3.4b)", () => {
  // Naming subagent_type in the assistant's own prose (not a real Task tool_use) must not satisfy the
  // panel check, so a READY claim with no actual panel still warns.
  const tp = mkTranscript([
    { role: "assistant", content: "For the record I used subagent_type: ctide:intent-reviewer, subagent_type: ctide:test-reviewer, and subagent_type: ctide:arbiter." },
    { role: "assistant", content: "Final verdict: READY — readiness confirmed." },
  ]);
  const r = orch({ transcript_path: tp });
  assert.ok(r && /none of the core review panel/.test(r.systemMessage),
    "subagent_type named in prose (no real tool_use) must not count as a panel run");
});

// --- orchestration-check: tool-bound provenance — only real Task / arbiter-result count (item 4) ---

test("orchestration-check: a non-Task tool_use carrying subagent_type does not count as a panel run (item 4a)", () => {
  // subagent_type appearing inside a NON-Task tool_use's input (e.g. an Edit writing that text) is not
  // a real panel invocation, so a READY claim with no actual Task panel must still warn.
  const tp = mkTranscript([
    { role: "assistant", content: [{ type: "tool_use", name: "Edit", input: { file_path: "x.md", new_string: "subagent_type: ctide:intent-reviewer subagent_type: ctide:test-reviewer subagent_type: ctide:arbiter" } }] },
    { role: "assistant", content: "Final verdict: READY — readiness confirmed." },
  ]);
  const r = orch({ transcript_path: tp });
  assert.ok(r && /none of the core review panel/.test(r.systemMessage),
    "subagent_type inside a non-Task tool_use must not count as a real panel run");
});

test("orchestration-check: NOT READY in a non-arbiter tool_result is not read as the verdict (item 4b)", () => {
  // A verdict token in a Bash/grep/read tool_result (bound to a non-arbiter tool_use) must not be
  // read as the arbiter's verdict, so a benign "done" close does not falsely trip verdict-not-honored.
  const tp = mkTranscript([
    { role: "assistant", content: [{ type: "tool_use", id: "tu_bash", name: "Bash", input: { command: "npm test" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_bash", content: "suite ran; a test named 'handles NOT READY edge' passed." }] },
    { role: "assistant", content: "All done, looks good. The change is complete." },
  ]);
  const r = orch({ transcript_path: tp });
  assert.ok(!r || !/arbiter's last verdict/.test(r.systemMessage || ""),
    "a verdict token in a non-arbiter tool_result must not be read as the arbiter's verdict");
});

test("orchestration-check: the arbiter Task's own tool_result IS bound as the verdict (item 4)", () => {
  // The binding must still catch the REAL verdict: a arbiter Task whose tool_result (by tool_use_id)
  // says NOT READY, followed by a "done" close, must fire verdict-not-honored.
  const tp = mkTranscript([
    { role: "assistant", content: [{ type: "tool_use", id: "tu_spec", name: "Task", input: { subagent_type: "ctide:intent-reviewer" } }] },
    { role: "assistant", content: [{ type: "tool_use", id: "tu_test", name: "Task", input: { subagent_type: "ctide:test-reviewer" } }] },
    { role: "assistant", content: [{ type: "tool_use", id: "tu_gk", name: "Task", input: { subagent_type: "ctide:arbiter" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_gk", content: "Final verdict: NOT READY — unresolved auth bypass." }] },
    { role: "assistant", content: "Looks good, you're all set — the change is done." },
  ]);
  const r = orch({ transcript_path: tp });
  assert.ok(r && /arbiter's last verdict was 'NOT READY'/.test(r.systemMessage),
    "the arbiter Task's bound tool_result must still be read as the verdict");
});

// --- orchestration-check: provenance/binding spoofs inside REAL Task/result blocks (hardening) ---
// The prose/non-Task spoofs above are covered; these two pin the gaps an external review reproduced:
// (a) a REAL arbiter Task whose PROMPT quotes "subagent_type: spec/test-reviewer" must NOT count those
//     as a panel run (the type comes from the structured field, not a stringified sibling field), and
// (b) an id-LESS tool_result containing "READY" must NOT override an id-bound arbiter NOT READY when
//     binding is otherwise possible (the id-less fallback is transcript-level, not per-result).

test("orchestration-check: a arbiter Task whose PROMPT quotes 'subagent_type: intent-reviewer' does NOT count the panel (provenance, structured field)", () => {
  // Only the arbiter actually ran; the spec/test names appear ONLY inside the arbiter Task's prompt
  // text. Reading the structured subagent_type field (not the serialized input) means the prompt cannot
  // spoof panel presence, so a READY ship claim still trips the panel-missing advisory.
  const tp = mkTranscript([
    { role: "assistant", content: [{ type: "tool_use", id: "tu_gk", name: "Task", input: {
      subagent_type: "ctide:arbiter",
      prompt: "Aggregate the inputs labeled subagent_type: intent-reviewer and subagent_type: test-reviewer, then decide readiness." } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_gk", content: "Final verdict: READY — readiness confirmed." }] },
    { role: "assistant", content: "Final verdict: READY — the change is complete and ready to ship.\nctide:delivery=shipped" },
  ]);
  const r = orch({ transcript_path: tp });
  assert.ok(r && /incomplete/.test(r.systemMessage), "a prompt that quotes subagent_type must not count the named reviewers as run");
  assert.ok(/intent-reviewer/.test(r.systemMessage) && /test-reviewer/.test(r.systemMessage), "names the reviewers that did not actually run");
});

test("orchestration-check: an id-less tool_result containing 'READY' does NOT override an id-bound arbiter NOT READY (transcript-level fallback)", () => {
  // Real arbiter Task (id-bound) returns NOT READY; later an id-LESS result (e.g. a deploy log) contains
  // the word READY; the final ships. The id-less fallback must apply only when binding is impossible
  // transcript-wide — here binding IS possible (the arbiter result has an id), so the stray READY must
  // not pollute the verdict pool and the verdict-not-honored advisory must fire.
  const tp = mkTranscript([
    { role: "assistant", content: [
      { type: "tool_use", id: "tu_spec", name: "Task", input: { subagent_type: "ctide:intent-reviewer" } },
      { type: "tool_use", id: "tu_test", name: "Task", input: { subagent_type: "ctide:test-reviewer" } },
      { type: "tool_use", id: "tu_gk", name: "Task", input: { subagent_type: "ctide:arbiter" } } ] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_gk", content: "Final verdict: NOT READY — auth bypass unresolved." }] },
    { role: "user", content: [{ type: "tool_result", content: "deploy log: system READY for traffic" }] },
    { role: "assistant", content: "The change is complete and ready to ship.\nctide:delivery=shipped" },
  ]);
  const r = orch({ transcript_path: tp });
  assert.ok(r && /arbiter's last verdict was 'NOT READY'/.test(r.systemMessage),
    "an id-less stray READY must not override an id-bound arbiter NOT READY");
});

// --- orchestration-check: verdict not honored gates on an honest HOLD, not on quoting the token ---

const GK_NOT_READY = [
  { role: "assistant", content: [{ type: "tool_use", id: "g", name: "Task", input: { subagent_type: "ctide:arbiter" } }] },
  { role: "user", content: [{ type: "tool_result", tool_use_id: "g", content: "Final verdict: NOT READY — auth bypass unresolved." }] },
];

test("orchestration-check: a final that quotes NOT READY but still claims ship-ready WARNS (contradictory final)", () => {
  // Acknowledging the block ("...NOT READY, but...ready to ship") must NOT suppress the advisory just
  // because the final quotes the token — only an honest hold should silence it.
  const tp = mkTranscript([...GK_NOT_READY,
    { role: "assistant", content: "The arbiter returned NOT READY, but I'm confident it's ready to ship." }]);
  const r = orch({ transcript_path: tp });
  assert.ok(r && /arbiter's last verdict was 'NOT READY'/.test(r.systemMessage),
    "quoting the block while claiming ship-ready must still warn");
});

test("orchestration-check: an honest 'complete but NOT shipping' report stays silent (no false alarm)", () => {
  // The exact false-positive trap: an honest report that names the NOT READY block AND explicitly holds
  // delivery must not be nagged (a naive `|| finalShipReady` fix would have cried wolf here).
  const tp = mkTranscript([...GK_NOT_READY,
    { role: "assistant", content: "The migration is complete, but the arbiter returned NOT READY on auth, so I am not shipping." }]);
  assert.strictEqual(orch({ transcript_path: tp }), null,
    "an honest report that explicitly holds delivery must not be nagged");
});

test("orchestration-check: a problem word like 'unresolved' does not silence a ship-ready-despite-block claim", () => {
  // The hold gate keys on the ship DECISION, not on problem-description words; "unresolved...but ready
  // to ship anyway" is still an override and must warn.
  const tp = mkTranscript([...GK_NOT_READY,
    { role: "assistant", content: "The arbiter said NOT READY due to an unresolved auth issue, but it's ready to ship anyway." }]);
  const r = orch({ transcript_path: tp });
  assert.ok(r && /arbiter's last verdict was 'NOT READY'/.test(r.systemMessage),
    "a problem-description word must not be treated as a not-ship decision");
});

test("orchestration-check: a localized (non-English) honest hold with verbatim severity labels stays silent (base-predicate fix)", () => {
  // Regression pin: `holdsDelivery` is English-only and `assertsReadyVerdict` can match the READY
  // inside "NOT READY" + the verbatim Blocker/Major/Minor labels, so an honest zh "NOT READY, so not
  // shipping" was nagged. assertsReadyVerdict now requires an AFFIRMATIVE READY (not the one in NOT READY),
  // so claimsComplete is false for a pure block disclosure with no English completion phrase.
  const tp = mkTranscript([...GK_NOT_READY,
    { role: "assistant", content: "最終裁決 NOT READY；auth 未解，所以我不出貨，下一輪繼續修。Blocker：1、Major：0、Minor：0。" }]);
  assert.strictEqual(orch({ transcript_path: tp }), null,
    "a non-English honest hold must not be nagged (the READY inside NOT READY is not an affirmative ready)");
});

test("orchestration-check: delivery=held sentinel is authoritative — silent even with ship-ready prose", () => {
  // The architecture fix: an explicit, language-neutral delivery decision overrides prose inference for
  // BOTH advisories, so the verdict-not-honored false-positive class cannot reappear via prose parsing.
  const tp = mkTranscript([...GK_NOT_READY,
    { role: "assistant", content: "Everything's ready to ship and good to go. ctide:delivery=held" }]);
  assert.strictEqual(orch({ transcript_path: tp }), null,
    "ctide:delivery=held must silence both advisories regardless of ship-ready prose");
});

test("orchestration-check: delivery=shipped sentinel is authoritative — warns even with hold prose", () => {
  const tp = mkTranscript([...GK_NOT_READY,
    { role: "assistant", content: "Not shipping for now, just a note. ctide:delivery=shipped" }]);
  const r = orch({ transcript_path: tp });
  assert.ok(r && /arbiter's last verdict was 'NOT READY'/.test(r.systemMessage),
    "ctide:delivery=shipped must warn on a blocking verdict regardless of hold-sounding prose");
});

// --- Panel-missing advisory must NOT self-suppress on a mere block-token mention ---

test("orchestration-check F3: a mixed-history final (earlier NOT READY, now READY, shipping) with NO panel still warns", () => {
  // The gate used to be `!finalReportsBlock`, silenced by ANY NOT READY / FIX REQUIRED token in the
  // final. A contradictory close that quotes the old block but still asserts READY + ships, with no
  // panel, must warn (the panel safety-net must not be defeated by a prose mention).
  const tp = mkTranscript([
    { role: "user", content: "ship it" },
    { role: "assistant", content: "Earlier the arbiter said NOT READY on auth, but I've confirmed it now. Final verdict: READY — ready to ship." },
  ]);
  const r = orch({ transcript_path: tp });
  assert.ok(r && /none of the core review panel/.test(r.systemMessage), "a mixed-history block mention must not suppress the panel-missing advisory");
  assert.ok(!r.decision, "must not block the stop");
});

test("orchestration-check F3: a ship-ready final that ALSO honestly holds (no panel) stays silent — the !holdsDelivery term is load-bearing", () => {
  // This is the input where the F3 gate change is decisive: finalShipReady is TRUE (affirmative READY +
  // "verdict") AND holdsDelivery is TRUE ("not shipping"), with NO block token. Under the OLD gate
  // (!finalReportsBlock — false here, so the term was true) the panel advisory would FIRE; under the NEW
  // gate (!finalHoldsDelivery) it is suppressed. So this test fails if the F3 change is reverted — unlike a
  // no-ship-claim hold (silenced by finalShipReady=false regardless), it actually exercises the fix.
  const tp = mkTranscript([
    { role: "user", content: "do it" },
    { role: "assistant", content: "Final verdict: READY — readiness confirmed, but I'm holding off and not shipping yet until QA signs off." },
  ]);
  assert.strictEqual(orch({ transcript_path: tp }), null, "a ship-ready-but-honestly-holding final must stay silent (holdsDelivery suppresses)");
});

// --- Verification sentinel ctide:verify= + advisory 3 (exit status over reviewer prose) ---

test("orchestration-check: ctide:verify=fail while delivering WARNS (exit status is authority)", () => {
  const tp = mkTranscript([
    { role: "user", content: "done?" },
    { role: "assistant", content: "All implemented and reviewed.\n\nctide:verify=fail\nctide:delivery=shipped" },
  ]);
  const r = orch({ transcript_path: tp });
  assert.ok(r && /verification sentinel reports/.test(r.systemMessage), "verify=fail + delivering must warn");
  assert.ok(/exit status is authority/.test(r.systemMessage) && /required check/.test(r.systemMessage), "message names exit-status authority and the required check");
  assert.ok(!r.decision, "must not block the stop");
});

test("orchestration-check: ctide:verify=unrun while delivering WARNS (claimed but never run)", () => {
  const tp = mkTranscript([
    { role: "assistant", content: "Looks complete.\nctide:verify=unrun\nctide:delivery=shipped" },
  ]);
  const r = orch({ transcript_path: tp });
  assert.ok(r && /verification sentinel reports/.test(r.systemMessage) && /never actually run/.test(r.systemMessage),
    "verify=unrun + delivering must warn about a claimed-but-unrun check");
});

test("orchestration-check: verify happy/held paths stay silent (pass+shipped, na+shipped, fail+held, unrun+held)", () => {
  const silent = (c) => assert.strictEqual(orch({ transcript_path: mkTranscript([{ role: "assistant", content: c }]) }), null, "should be silent: " + c);
  silent("Shipping.\nctide:verify=pass\nctide:delivery=shipped");          // green checks, shipping
  silent("Docs only, shipping.\nctide:verify=na\nctide:delivery=shipped"); // no required checks
  silent("Build is red.\nctide:verify=fail\nctide:delivery=held");         // honest hold on a red check
  silent("A check could not run.\nctide:verify=unrun\nctide:delivery=held"); // honest hold on an unrun check
});

test("orchestration-check: the LAST ctide:verify line wins over an earlier in-prose mention (last-match)", () => {
  // Locks the last-match fix: an earlier ctide:verify=fail discussed in prose must not beat the
  // authoritative final rollup (pass). First-match .exec would wrongly read 'fail' and emit a spurious warning.
  const tp = mkTranscript([{ role: "assistant", content: "Earlier ctide:verify=fail, after the fix it is green.\nctide:verify=pass\nctide:delivery=shipped" }]);
  assert.strictEqual(orch({ transcript_path: tp }), null, "the final rollup (pass) must win, not the earlier prose 'fail'");
});

test("orchestration-check: ctide:verify=fail with no delivery token but an honest hold stays silent", () => {
  // sessionDelivers uses the prose fallback (no delivery sentinel): claimsComplete is TRUE ("is complete"),
  // so the OPERATIVE suppressor is holdsDelivery ("not shipping") -> sessionDelivers = complete && !hold = false.
  // This pins the prose-hold path (a regression weakening holdsDelivery's suppression would fire here).
  const tp = mkTranscript([{ role: "assistant", content: "The migration is complete, but the build is red so I'm not shipping. ctide:verify=fail" }]);
  assert.strictEqual(orch({ transcript_path: tp }), null, "verify=fail + completion claim + honest prose hold must stay silent");
});

test("orchestration-check: with NO ctide:verify token the new advisory is inert (regression guard)", () => {
  // Panel ran + shipping + no verify token -> nothing new fires; behavior is exactly as before the sentinel.
  const tp = mkTranscript([
    { role: "assistant", content: [{ type: "tool_use", name: "Task", input: { subagent_type: "ctide:intent-reviewer" } }] },
    { role: "assistant", content: [{ type: "tool_use", name: "Task", input: { subagent_type: "ctide:test-reviewer" } }] },
    { role: "assistant", content: [{ type: "tool_use", name: "Task", input: { subagent_type: "ctide:arbiter" } }] },
    { role: "assistant", content: "Final verdict: READY — readiness confirmed. ctide:delivery=shipped" },
  ]);
  assert.strictEqual(orch({ transcript_path: tp }), null, "no verify token -> the verify branch is dead, nothing fires");
});

test("orchestration-check: verdict-not-honored takes precedence over the verify advisory (single emit)", () => {
  const tp = mkTranscript([
    { role: "assistant", content: [{ type: "tool_use", id: "g", name: "Task", input: { subagent_type: "ctide:arbiter" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "g", content: "Final verdict: NOT READY — auth bypass unresolved." }] },
    { role: "assistant", content: "Done.\nctide:verify=fail\nctide:delivery=shipped" },
  ]);
  const r = orch({ transcript_path: tp });
  assert.ok(r && /arbiter's last verdict was 'NOT READY'/.test(r.systemMessage), "advisory 1 must win");
  assert.ok(!/verification sentinel/.test(r.systemMessage), "must not be the verify advisory (precedence + exactly one emit)");
});

test("orchestration-check: panel-missing (advisory 2) takes precedence over the verify advisory (single emit)", () => {
  // READY + no panel + verify=fail + shipped: advisory 2 early-returns before advisory 3, so only ONE
  // systemMessage is emitted. Pins the documented priority order so a future reorder is caught.
  const tp = mkTranscript([
    { role: "assistant", content: "Final verdict: READY — readiness confirmed.\nctide:verify=fail\nctide:delivery=shipped" },
  ]);
  const r = orch({ transcript_path: tp });
  assert.ok(r && /none of the core review panel/.test(r.systemMessage), "advisory 2 (panel-missing) must fire");
  assert.ok(!/verification sentinel/.test(r.systemMessage), "advisory 3 must not also fire (single emit, advisory 2 precedence)");
});

test("orchestration-check: the verify advisory fires on the array-of-typed-blocks final shape (real transcript shape)", () => {
  // The other verify tests use string content; real Claude Code transcripts use content as an array of
  // typed blocks. Pin the array path so a future finalText-extraction change cannot silently regress it.
  const tp = mkTranscript([
    { role: "assistant", content: [{ type: "text", text: "All implemented.\nctide:verify=fail\nctide:delivery=shipped" }] },
  ]);
  const r = orch({ transcript_path: tp });
  assert.ok(r && /verification sentinel reports/.test(r.systemMessage), "verify=fail must warn on the array-block final shape too");
});

test("orchestration-check: verify sentinel is case/space tolerant and ctide:-anchored", () => {
  const mk = (c) => mkTranscript([{ role: "assistant", content: c + "\nctide:delivery=shipped" }]);
  const warns = (c) => /verification sentinel/.test((orch({ transcript_path: mk(c) }) || {}).systemMessage || "");
  assert.ok(warns("ctide : verify = FAILED"), "spacey 'FAILED' folds to fail and warns");
  assert.ok(warns("ctide:verify=skipped"), "'skipped' folds to unrun and warns when delivering");
  assert.strictEqual(orch({ transcript_path: mk("ctide:verify=green") }), null, "'green' folds to pass -> silent");
  const r = orch({ transcript_path: mk("the verify=fail flag in our config") });
  assert.ok(!r || !/verification sentinel/.test(r.systemMessage || ""), "'verify=fail' without the ctide: prefix must not match");
});

test("orchestration-check: a localized (zh) summary with ctide:verify=fail + delivery=shipped still warns", () => {
  const tp = mkTranscript([{ role: "assistant", content: "完成了，準備出貨。\nctide:verify=fail\nctide:delivery=shipped" }]);
  const r = orch({ transcript_path: tp });
  assert.ok(r && /verification sentinel/.test(r.systemMessage), "the language-neutral sentinel still warns in a localized summary");
});

test("orchestration-check: a ctide:verify token only in a USER message stays silent (finalText-scoped)", () => {
  const tp = mkTranscript([
    { role: "user", content: "note from my old log: ctide:verify=fail and ctide:delivery=shipped" },
    { role: "assistant", content: [{ type: "tool_use", name: "Task", input: { subagent_type: "ctide:intent-reviewer" } }] },
    { role: "assistant", content: [{ type: "tool_use", name: "Task", input: { subagent_type: "ctide:test-reviewer" } }] },
    { role: "assistant", content: [{ type: "tool_use", name: "Task", input: { subagent_type: "ctide:arbiter" } }] },
    { role: "assistant", content: "All green and shipping. Final verdict: READY." },
  ]);
  assert.strictEqual(orch({ transcript_path: tp }), null, "a verify token only in a user message must not trip the advisory (reads finalText only)");
});

// --- Advisory 4: a real verified delivered run must log its `### Live run` evidence block ---

test("orchestration-check (advisory 4): a real verified delivered run with NO `### Live run` block nudges to log it", () => {
  const tp = mkTranscript([
    { role: "assistant", content: [{ type: "tool_use", name: "Task", input: { subagent_type: "ctide:intent-reviewer" } }] },
    { role: "assistant", content: [{ type: "tool_use", name: "Task", input: { subagent_type: "ctide:test-reviewer" } }] },
    { role: "assistant", content: [{ type: "tool_use", id: "g", name: "Task", input: { subagent_type: "ctide:arbiter" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "g", content: "Final verdict: READY — all good." }] },
    { role: "assistant", content: "Final verdict: READY — readiness confirmed.\nctide:verify=pass\nctide:delivery=shipped" },
  ]);
  const r = orch({ transcript_path: tp });
  assert.ok(r && /Live run/.test(r.systemMessage), "a real verified delivered run with no evidence block must be nudged to log it");
  assert.ok(!r.decision, "advisory 4 is a logging nudge — must never block the stop");
});

test("orchestration-check (advisory 4): silent when the `### Live run` block IS present", () => {
  const tp = mkTranscript([
    { role: "assistant", content: [{ type: "tool_use", name: "Task", input: { subagent_type: "ctide:intent-reviewer" } }] },
    { role: "assistant", content: [{ type: "tool_use", name: "Task", input: { subagent_type: "ctide:test-reviewer" } }] },
    { role: "assistant", content: [{ type: "tool_use", id: "g", name: "Task", input: { subagent_type: "ctide:arbiter" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "g", content: "Final verdict: READY." }] },
    { role: "assistant", content: "Final verdict: READY.\n### Live run — 2026-06-29 · acme/api (go) · verified live task\n- Task: add a guard\nctide:verify=pass\nctide:delivery=shipped" },
  ]);
  assert.strictEqual(orch({ transcript_path: tp }), null, "an emitted `### Live run` block must suppress the evidence nudge");
});

test("orchestration-check (advisory 4): inert on a trivial run (ctide:verify=na)", () => {
  const tp = mkTranscript([
    { role: "assistant", content: [{ type: "tool_use", name: "Task", input: { subagent_type: "ctide:intent-reviewer" } }] },
    { role: "assistant", content: [{ type: "tool_use", name: "Task", input: { subagent_type: "ctide:test-reviewer" } }] },
    { role: "assistant", content: [{ type: "tool_use", id: "g", name: "Task", input: { subagent_type: "ctide:arbiter" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "g", content: "Final verdict: READY." }] },
    { role: "assistant", content: "Docs only — done.\nctide:verify=na\nctide:delivery=shipped" },
  ]);
  assert.strictEqual(orch({ transcript_path: tp }), null, "verify=na is a trivial run — no `### Live run` evidence is expected");
});

test("orchestration-check (advisory 4): inert on an honest hold (not delivering)", () => {
  const tp = mkTranscript([
    { role: "assistant", content: [{ type: "tool_use", name: "Task", input: { subagent_type: "ctide:intent-reviewer" } }] },
    { role: "assistant", content: [{ type: "tool_use", name: "Task", input: { subagent_type: "ctide:test-reviewer" } }] },
    { role: "assistant", content: [{ type: "tool_use", id: "g", name: "Task", input: { subagent_type: "ctide:arbiter" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "g", content: "Final verdict: READY." }] },
    { role: "assistant", content: "Pausing here.\nctide:verify=pass\nctide:delivery=held" },
  ]);
  assert.strictEqual(orch({ transcript_path: tp }), null, "a held (mid-repair) run must not be nagged to log evidence");
});

test("orchestration-check (advisory 4): inert without a real arbiter verdict (bare verify=pass)", () => {
  // verify=pass + shipped but NO arbiter Task and no ship-ready prose -> not a real ctide run; advisory 4
  // requires the arbiter Task so a bare sentinel cannot trip the evidence nudge.
  const tp = mkTranscript([
    { role: "assistant", content: "Shipping.\nctide:verify=pass\nctide:delivery=shipped" },
  ]);
  assert.strictEqual(orch({ transcript_path: tp }), null, "a bare verify=pass without a arbiter Task must not trip advisory 4");
});

test("orchestration-check (advisory 4): panel-missing (advisory 2) takes precedence over the evidence nudge", () => {
  // Gatekeeper ran but spec/test did not -> advisory 2 fires and early-returns; advisory 4 (lower priority)
  // never runs, so exactly one systemMessage is emitted.
  const tp = mkTranscript([
    { role: "assistant", content: [{ type: "tool_use", id: "g", name: "Task", input: { subagent_type: "ctide:arbiter" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "g", content: "Final verdict: READY." }] },
    { role: "assistant", content: "Final verdict: READY — ready to ship.\nctide:verify=pass\nctide:delivery=shipped" },
  ]);
  const r = orch({ transcript_path: tp });
  assert.ok(r && /none of the core review panel|incomplete/.test(r.systemMessage), "advisory 2 (panel) must fire");
  assert.ok(!/Live run/.test(r.systemMessage), "advisory 4 must not also fire (single emit, advisory 2 precedence)");
});

// --- orchestration-check: opt-in hard enforcement CTIDE_ENFORCE_STOP (item 9) ---

// A blocking arbiter verdict + a final that ships with the explicit delivery sentinel.
const GK_SHIP = [...GK_NOT_READY,
  { role: "assistant", content: "The change is complete and ready to ship.\nctide:delivery=shipped" }];

test("enforce ON: blocking verdict + ctide:delivery=shipped => decision:block with a disengage reason", () => {
  const r = orchEnv({ transcript_path: mkTranscript(GK_SHIP) }, { CTIDE_ENFORCE_STOP: "1" });
  assert.ok(r && r.decision === "block", "must hard-block when enforce is on and the shipped sentinel + blocking verdict are present");
  assert.ok(/ctide:delivery=held|CTIDE_ENFORCE_STOP|READY/.test(r.reason || ""), "the block reason must say how to disengage");
});

test("enforce OFF (default): the SAME transcript stays advisory, never blocks (default is byte-identical)", () => {
  const r = orch({ transcript_path: mkTranscript(GK_SHIP) }); // no env -> default
  assert.ok(r && /arbiter's last verdict was 'NOT READY'/.test(r.systemMessage), "default still warns (advisory)");
  assert.ok(!r.decision, "the default path must NOT block — enforcement is strictly opt-in");
});

test("enforce ON + prose-only ship (NO delivery=shipped sentinel) => advisory, never blocks", () => {
  const tp = mkTranscript([...GK_NOT_READY,
    { role: "assistant", content: "The arbiter said NOT READY, but it's ready to ship anyway." }]);
  const r = orchEnv({ transcript_path: tp }, { CTIDE_ENFORCE_STOP: "1" });
  assert.ok(r && /arbiter's last verdict/.test(r.systemMessage), "prose ship still warns");
  assert.ok(!r.decision, "prose-only ship must NEVER block — only the explicit sentinel can");
});

test("enforce ON + ctide:delivery=held => silent, never blocks (the one-token escape)", () => {
  const tp = mkTranscript([...GK_NOT_READY,
    { role: "assistant", content: "Holding for now. ctide:delivery=held" }]);
  const r = orchEnv({ transcript_path: tp }, { CTIDE_ENFORCE_STOP: "1" });
  assert.strictEqual(r, null, "an honest held sentinel must silence even under enforcement");
});

test("enforce ON + stop_hook_active (re-entry) => advisory, never blocks again (loop-trap guard)", () => {
  const r = orchEnv({ transcript_path: mkTranscript(GK_SHIP), stop_hook_active: true }, { CTIDE_ENFORCE_STOP: "1" });
  assert.ok(r && /arbiter's last verdict/.test(r.systemMessage), "still warns");
  assert.ok(!r.decision, "must not block once already re-entered from a prior block");
});

test("enforce ON + READY/no-panel (no blocking verdict) => only the panel advisory, never blocks", () => {
  const tp = mkTranscript([
    { role: "assistant", content: "Final verdict: READY — readiness confirmed.\nctide:delivery=shipped" },
  ]);
  const r = orchEnv({ transcript_path: tp }, { CTIDE_ENFORCE_STOP: "1" });
  assert.ok(r && /none of the core review panel/.test(r.systemMessage), "the panel advisory still fires");
  assert.ok(!r.decision, "only the verdict-not-honored signal can ever block, never the panel check");
});

// --- orchestration-check: panel sentinel (ctide:panel=) — evidence-substituted review ---
// The fast lane (references/reviewer-selection.md, Evidence substitution) lets a run replace the
// test-reviewer with execution evidence, disclosed via a third machine sentinel in the final summary:
//   ctide:panel=full                                  → the full selected panel ran
//   ctide:panel=substituted:<comma-separated-names>   → the named reviewers were evidence-substituted
// The hook exempts a name from the panel-presence advisory ONLY when it is explicitly disclosed in the
// FINAL assistant message, whitelisted (EXEMPTIBLE = test-reviewer only), AND ctide:verify=pass (D1:
// `na` has no red→green positive evidence). Everything else must warn exactly as before (fail toward
// warning), and the panel path must never block.

const P_SPEC = { role: "assistant", content: [{ type: "tool_use", name: "Task", input: { subagent_type: "ctide:intent-reviewer" } }] };
const P_TEST = { role: "assistant", content: [{ type: "tool_use", name: "Task", input: { subagent_type: "ctide:test-reviewer" } }] };
const P_GK = { role: "assistant", content: [{ type: "tool_use", name: "Task", input: { subagent_type: "ctide:arbiter" } }] };

test("orchestration-check: panel sentinel — substituted:test-reviewer + verify=pass exempts the missing test-reviewer (advisory 2 silent)", () => {
  // The fast-lane happy path: spec + arbiter ran, test-reviewer was evidence-substituted and
  // DISCLOSED, verification is green, evidence is logged. Nothing may fire. The panel line sits
  // mid-footer, so its name list is terminated by a literal \n in the stringified final message —
  // this also pins the bounded charset (a greedy match would swallow the delivery line and break it).
  const tp = mkTranscript([P_SPEC, P_GK,
    { role: "assistant", content: "Final verdict: READY — readiness confirmed.\n### Live run\nctide:verify=pass\nctide:panel=substituted:test-reviewer\nctide:delivery=shipped" }]);
  assert.strictEqual(orch({ transcript_path: tp }), null,
    "a disclosed, whitelisted, verify=pass substitution must exempt test-reviewer from the panel advisory");
});

test("orchestration-check: panel sentinel — no sentinel: a missing test-reviewer still warns (baseline unchanged)", () => {
  const tp = mkTranscript([P_SPEC, P_GK,
    { role: "assistant", content: "Final verdict: READY — readiness confirmed.\nctide:verify=pass\nctide:delivery=shipped" }]);
  const r = orch({ transcript_path: tp });
  assert.ok(r && /incomplete/.test(r.systemMessage) && /test-reviewer did not run/.test(r.systemMessage),
    "without the panel sentinel the exemption must not exist");
});

test("orchestration-check: panel sentinel — verify=fail/unrun/na/absent all refuse the exemption", () => {
  // D1: only ctide:verify=pass qualifies. fail/unrun are red, `na` has no red→green positive
  // evidence (docs-only), and an absent verify sentinel proves nothing. Each must keep the advisory.
  for (const verifyLine of ["ctide:verify=fail", "ctide:verify=unrun", "ctide:verify=na", ""]) {
    const tp = mkTranscript([P_SPEC, P_GK,
      { role: "assistant", content: "Final verdict: READY — readiness confirmed.\n" + verifyLine + "\nctide:panel=substituted:test-reviewer" }]);
    const r = orch({ transcript_path: tp });
    assert.ok(r && /incomplete/.test(r.systemMessage) && /test-reviewer did not run/.test(r.systemMessage),
      "the exemption must be refused for: " + (verifyLine || "(no verify sentinel)"));
  }
});

test("orchestration-check: panel sentinel — non-exemptible names are never exempted (table: intent-reviewer / arbiter / mixed list)", async (t) => {
  // The safety floor: intent-reviewer (the only omission lens) and arbiter are never substitutable,
  // even with a green verify — the whitelist (EXEMPTIBLE), not the sentinel, decides. A mixed list
  // exempts ONLY the whitelisted test-reviewer. One table-driven test, three rows, preserving each
  // original row's distinct assertion messages.
  // rowNames carry the full pre-split test names verbatim (incl. the section prefix), so
  // name-keyed tooling (--test-name-pattern, CI history) keeps continuity across the split.
  for (const row of [
    { rowName: "orchestration-check: panel sentinel — substituted:intent-reviewer is NOT exemptible (advisory still names it)",
      ran: [P_TEST, P_GK], sentinel: "ctide:panel=substituted:intent-reviewer",
      stillNamed: /intent-reviewer did not run/, stillNamedMsg: "and must still name intent-reviewer" },
    { rowName: "orchestration-check: panel sentinel — substituted:arbiter is NOT exemptible (advisory still names it)",
      ran: [P_SPEC, P_TEST], sentinel: "ctide:panel=substituted:arbiter",
      stillNamed: /arbiter did not run/, stillNamedMsg: "arbiter can never be substituted away" },
    { rowName: "orchestration-check: panel sentinel — a mixed list exempts ONLY test-reviewer (intent-reviewer still named)",
      ran: [P_GK], sentinel: "ctide:panel=substituted:test-reviewer,intent-reviewer",
      stillNamed: /incomplete — intent-reviewer did not run/,
      stillNamedMsg: "the missing list must contain exactly intent-reviewer (test-reviewer exempted)",
      notNamed: /test-reviewer did not run|intent-reviewer, test-reviewer/,
      notNamedMsg: "test-reviewer must not appear in the missing list" },
  ]) {
    await t.test(row.rowName, () => {
      const tp = mkTranscript([...row.ran,
        { role: "assistant", content: "Final verdict: READY — readiness confirmed.\nctide:verify=pass\n" + row.sentinel }]);
      const r = orch({ transcript_path: tp });
      assert.ok(r && /incomplete/.test(r.systemMessage), "the advisory must still fire");
      assert.ok(row.stillNamed.test(r.systemMessage), row.stillNamedMsg);
      if (row.notNamed) assert.ok(!row.notNamed.test(r.systemMessage), row.notNamedMsg);
    });
  }
});

test("orchestration-check: panel sentinel — panel=full with a missing test-reviewer warns unchanged (full grants nothing)", () => {
  const tp = mkTranscript([P_SPEC, P_GK,
    { role: "assistant", content: "Final verdict: READY — readiness confirmed.\nctide:verify=pass\nctide:panel=full" }]);
  const r = orch({ transcript_path: tp });
  assert.ok(r && /incomplete/.test(r.systemMessage) && /test-reviewer did not run/.test(r.systemMessage),
    "panel=full is a disclosure, not an exemption — the advisory is unchanged");
});

test("orchestration-check: panel sentinel — a sentinel inside a Bash tool_result does NOT exempt (finalText only)", () => {
  // Provenance: the sentinel is the ORCHESTRATOR's closing disclosure. A tool_result (e.g. a Bash log
  // echoing the literal) must not be read as it — only the final assistant message counts.
  const tp = mkTranscript([P_SPEC, P_GK,
    { role: "assistant", content: [{ type: "tool_use", id: "tu_b", name: "Bash", input: { command: "cat notes.txt" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_b", content: "ctide:panel=substituted:test-reviewer\nctide:verify=pass" }] },
    { role: "assistant", content: "Final verdict: READY — readiness confirmed.\nctide:verify=pass" }]);
  const r = orch({ transcript_path: tp });
  assert.ok(r && /test-reviewer did not run/.test(r.systemMessage),
    "a sentinel in a tool_result must not grant the exemption");
});

test("orchestration-check: panel sentinel — a sentinel in an EARLIER assistant message does NOT exempt (final summary only)", () => {
  const tp = mkTranscript([P_SPEC, P_GK,
    { role: "assistant", content: "Interim note: ctide:panel=substituted:test-reviewer ctide:verify=pass" },
    { role: "assistant", content: "Final verdict: READY — readiness confirmed.\nctide:verify=pass" }]);
  const r = orch({ transcript_path: tp });
  assert.ok(r && /test-reviewer did not run/.test(r.systemMessage),
    "only the FINAL assistant message's sentinel counts");
});

test("orchestration-check: panel sentinel — multiple panel lines: the LAST one wins (both directions)", () => {
  // Mirrors lastVerdict / deliverySentinel / verifySentinel: the final rollup line is authoritative.
  const winsSub = mkTranscript([P_SPEC, P_GK,
    { role: "assistant", content: "Final verdict: READY — readiness confirmed.\n### Live run\nctide:verify=pass\nctide:delivery=shipped\nctide:panel=full\nctide:panel=substituted:test-reviewer" }]);
  assert.strictEqual(orch({ transcript_path: winsSub }), null,
    "full then substituted -> the last (substituted) wins and exempts");
  const winsFull = mkTranscript([P_SPEC, P_GK,
    { role: "assistant", content: "Final verdict: READY — readiness confirmed.\nctide:verify=pass\nctide:panel=substituted:test-reviewer\nctide:panel=full" }]);
  const r = orch({ transcript_path: winsFull });
  assert.ok(r && /test-reviewer did not run/.test(r.systemMessage),
    "substituted then full -> the last (full) wins and does not exempt");
});

test("orchestration-check: panel sentinel — an empty name list or an unknown value grants NO exemption", () => {
  // Fail toward warning: an unrecognized sentinel value must decode to null, never to an exemption.
  for (const line of ["ctide:panel=substituted:", "ctide:panel=maybe"]) {
    const tp = mkTranscript([P_SPEC, P_GK,
      { role: "assistant", content: "Final verdict: READY — readiness confirmed.\nctide:verify=pass\n" + line }]);
    const r = orch({ transcript_path: tp });
    assert.ok(r && /test-reviewer did not run/.test(r.systemMessage), "no exemption for: " + line);
  }
});

test("enforce ON + panel sentinel substitution => advisory only, never blocks (panel path cannot block)", () => {
  // Extends the enforce invariant to the new sentinel: even with a substitution disclosed (here a
  // non-exemptible name), the panel path must never emit decision:block — only advisory 1 can.
  const tp = mkTranscript([P_GK,
    { role: "assistant", content: "Final verdict: READY — readiness confirmed.\nctide:verify=pass\nctide:delivery=shipped\nctide:panel=substituted:intent-reviewer" }]);
  const r = orchEnv({ transcript_path: tp }, { CTIDE_ENFORCE_STOP: "1" });
  assert.ok(r && /incomplete/.test(r.systemMessage), "the panel advisory still fires");
  assert.ok(!r.decision, "the panel path must never block, sentinel or not");
});

test("orchestration-check: panel sentinel — delivery=held keeps advisory 2 suppressed alongside a substitution (regression)", () => {
  // An honest hold must stay silent exactly as before the panel sentinel existed — the exemption
  // logic must not perturb the held path (here verify=fail, so the exemption itself does not apply).
  const tp = mkTranscript([P_SPEC, P_GK,
    { role: "assistant", content: "Ready to ship otherwise, but holding.\nctide:verify=fail\nctide:delivery=held\nctide:panel=substituted:test-reviewer" }]);
  assert.strictEqual(orch({ transcript_path: tp }), null,
    "held + substitution must stay silent (advisory 2 suppressed by the hold, advisory 3 by not delivering)");
});

// Advisory-blast-radius pins: the exemption's ONLY effect is removing an exempted name from
// advisory 2's missing set — advisories 1/3/4 and the ENFORCE block must be byte-equivalent with or
// without a granted substitution. These are regression pins on already-correct code (no red→green
// possible); their power was demonstrated by mutation-kill instead: inserting
// `if (exempted.size > 0 && unmet.length === 0) return process.exit(0);` right after the `unmet`
// computation (the "granted exemption exits early" mutant) makes the first three fail.

test("orchestration-check: panel sentinel — a granted exemption never silences advisory 1 (verdict-not-honored still fires)", () => {
  // Valid substitution (whitelisted + verify=pass) AND an id-bound arbiter NOT READY AND shipping:
  // advisory 1 outranks the exemption — the fast lane must never launder a blocking verdict.
  const tp = mkTranscript([P_SPEC,
    { role: "assistant", content: [{ type: "tool_use", id: "gk1", name: "Task", input: { subagent_type: "ctide:arbiter" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "gk1", content: "Final verdict: NOT READY — auth bypass unresolved." }] },
    { role: "assistant", content: "Delivering now.\n### Live run\nctide:verify=pass\nctide:panel=substituted:test-reviewer\nctide:delivery=shipped" }]);
  const r = orch({ transcript_path: tp });
  assert.ok(r && /arbiter's last verdict was 'NOT READY'/.test(r.systemMessage),
    "advisory 1 must fire despite a valid substitution");
});

test("enforce ON + panel sentinel exemption granted => the ENFORCE block still fires (substitution cannot defeat it)", () => {
  // Same transcript under CTIDE_ENFORCE_STOP: the highest-confidence signal (id-bound blocking
  // verdict + explicit delivery=shipped) must still hard-block — the panel sentinel buys no escape.
  const tp = mkTranscript([P_SPEC,
    { role: "assistant", content: [{ type: "tool_use", id: "gk1", name: "Task", input: { subagent_type: "ctide:arbiter" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "gk1", content: "Final verdict: NOT READY — auth bypass unresolved." }] },
    { role: "assistant", content: "Delivering now.\n### Live run\nctide:verify=pass\nctide:panel=substituted:test-reviewer\nctide:delivery=shipped" }]);
  const r = orchEnv({ transcript_path: tp }, { CTIDE_ENFORCE_STOP: "1" });
  assert.ok(r && r.decision === "block", "the ENFORCE block must fire despite a valid substitution");
});

test("orchestration-check: panel sentinel — a granted exemption never silences advisory 4 (Live-run nudge still fires)", () => {
  // Exemption-granted happy path (arbiter ran, id-bound READY, verify=pass, shipped) but the
  // final report forgot its `### Live run` evidence block — the logging nudge must still fire.
  const tp = mkTranscript([P_SPEC,
    { role: "assistant", content: [{ type: "tool_use", id: "gk1", name: "Task", input: { subagent_type: "ctide:arbiter" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "gk1", content: "Final verdict: READY — readiness confirmed." }] },
    { role: "assistant", content: "Final verdict: READY — readiness confirmed.\nctide:verify=pass\nctide:panel=substituted:test-reviewer\nctide:delivery=shipped" }]);
  const r = orch({ transcript_path: tp });
  assert.ok(r && /Live run/.test(r.systemMessage), "advisory 4 must fire despite a granted exemption");
});

test("orchestration-check: panel sentinel — case/space/CRLF tolerant and ctide:-anchored (like the verify sentinel)", () => {
  // Tolerant decode: mixed case + spaces around the separators + CRLF line endings still grant the
  // exemption; a prefix-less "panel=" (no "ctide:") must NOT decode (fail toward warning).
  const granted = mkTranscript([P_SPEC, P_GK,
    { role: "assistant", content: "Final verdict: READY — readiness confirmed.\r\n### Live run\r\nctide:verify=pass\r\nCtide : Panel = Substituted: Test-Reviewer\r\nctide:delivery=shipped" }]);
  assert.strictEqual(orch({ transcript_path: granted }), null,
    "a spacey mixed-case sentinel between CRLF line endings still grants the exemption");
  const bare = mkTranscript([P_SPEC, P_GK,
    { role: "assistant", content: "Final verdict: READY — readiness confirmed.\nctide:verify=pass\npanel=substituted:test-reviewer" }]);
  const r = orch({ transcript_path: bare });
  assert.ok(r && /test-reviewer did not run/.test(r.systemMessage),
    "'panel=' without the ctide: prefix must not decode as the sentinel");
});

test("orchestration-check: panel sentinel — a substituted name that actually RAN is a harmless no-op (silent)", () => {
  // All three core reviewers ran; the final still discloses substituted:test-reviewer. Nothing is
  // missing, so the exemption has nothing to do — the disclosure must not create any new advisory.
  const tp = mkTranscript([P_SPEC, P_TEST, P_GK,
    { role: "assistant", content: "Final verdict: READY — readiness confirmed.\n### Live run\nctide:verify=pass\nctide:panel=substituted:test-reviewer\nctide:delivery=shipped" }]);
  assert.strictEqual(orch({ transcript_path: tp }), null,
    "a substitution disclosure for a reviewer that actually ran must stay silent");
});

test("orchestration-check: panel sentinel — the exemption works on the array-of-typed-blocks final shape (real transcript shape)", () => {
  // The other exemption tests use string content; real Claude Code transcripts use content as an
  // array of typed blocks. Pin the array path so a finalText-extraction change cannot regress it.
  const tp = mkTranscript([P_SPEC, P_GK,
    { role: "assistant", content: [{ type: "text", text: "Final verdict: READY — readiness confirmed.\n### Live run\nctide:verify=pass\nctide:panel=substituted:test-reviewer\nctide:delivery=shipped" }] }]);
  assert.strictEqual(orch({ transcript_path: tp }), null,
    "the exemption must be granted on the array-block final shape too");
});

test("enforce ON: FIX REQUIRED + delivery=shipped also blocks (the verdict set, not just NOT READY)", () => {
  const tp = mkTranscript([
    { role: "assistant", content: [{ type: "tool_use", id: "g2", name: "Task", input: { subagent_type: "ctide:arbiter" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "g2", content: "Final verdict: FIX REQUIRED — add an edge test." }] },
    { role: "assistant", content: "Shipping anyway.\nctide:delivery=shipped" },
  ]);
  const r = orchEnv({ transcript_path: tp }, { CTIDE_ENFORCE_STOP: "1" });
  assert.ok(r && r.decision === "block", "FIX REQUIRED + shipped must also hard-block under enforcement");
  assert.ok(/FIX REQUIRED/.test(r.reason || ""), "the block reason names the actual verdict");
});

test("enforce flag truthiness: CTIDE_ENFORCE_STOP=0 stays advisory (regex must not accept any non-empty value)", () => {
  const r = orchEnv({ transcript_path: mkTranscript(GK_SHIP) }, { CTIDE_ENFORCE_STOP: "0" });
  assert.ok(r && /arbiter's last verdict/.test(r.systemMessage), "0 stays advisory");
  assert.ok(!r.decision, "CTIDE_ENFORCE_STOP=0 must NOT enable blocking (regex is 1|true|yes|on only)");
});

test("enforce ON + stopHookActive (camelCase alias) => advisory, never blocks (loop-trap guard covers both keys)", () => {
  const r = orchEnv({ transcript_path: mkTranscript(GK_SHIP), stopHookActive: true }, { CTIDE_ENFORCE_STOP: "1" });
  assert.ok(r && /arbiter's last verdict/.test(r.systemMessage), "still warns");
  assert.ok(!r.decision, "the camelCase stopHookActive re-entry flag must also suppress the block");
});

// --- The Stop hook prefers the fresh last_assistant_message field over a stale transcript tail ---
// Claude Code's Stop event can carry the orchestrator's actual final message separately from the
// transcript file (a transcript-write race, or a summary produced after the last transcript entry was
// written). finalIdx (and the panel/verdict-provenance scans it bounds) stays transcript-derived and
// untouched — only finalText, the input to the sentinel/claim-detection regexes, should prefer the
// fresh field when it is present, a string, and non-empty after trimming.

test("orchestration-check: a fresh last_assistant_message overrides a stale/benign transcript tail", () => {
  // The transcript's own last assistant entry is benign (no verdict/panel claim), so pre-fix
  // (transcript-scan only) the hook must stay silent; last_assistant_message carries the REAL final
  // summary (READY + shipped, no panel ran) and the fix must follow it, tripping the panel-missing advisory.
  const tp = mkTranscript([
    { role: "user", content: "do the thing" },
    { role: "assistant", content: "Still investigating; will report back after further analysis." },
  ]);
  const r = orch({
    transcript_path: tp,
    last_assistant_message: "Final verdict: READY — the change is complete and ready to ship.\nctide:delivery=shipped",
  });
  assert.ok(r && /none of the core review panel/.test(r.systemMessage),
    "the hook must follow the fresh last_assistant_message field, not the stale transcript tail");
});

test("orchestration-check: no last_assistant_message field preserves transcript-only behavior", () => {
  const tp = mkTranscript([
    { role: "user", content: "do the thing" },
    { role: "assistant", content: "Final verdict: READY — readiness confirmed." },
  ]);
  const r = orch({ transcript_path: tp });
  assert.ok(r && /none of the core review panel/.test(r.systemMessage),
    "omitting last_assistant_message must behave identically to the transcript-only scan");
});

test("orchestration-check: empty or non-string last_assistant_message falls back to the transcript scan", () => {
  const tp = mkTranscript([
    { role: "user", content: "do the thing" },
    { role: "assistant", content: "Final verdict: READY — readiness confirmed." },
  ]);
  for (const bad of ["", "   ", null, 42, {}, []]) {
    const r = orch({ transcript_path: tp, last_assistant_message: bad });
    assert.ok(r && /none of the core review panel/.test(r.systemMessage),
      `last_assistant_message=${JSON.stringify(bad)} must fall back to the transcript-derived finalText`);
  }
});

test("orchestration-check: lastAssistantMessage camelCase alias is also honored", () => {
  const tp = mkTranscript([
    { role: "user", content: "do the thing" },
    { role: "assistant", content: "Still investigating; will report back after further analysis." },
  ]);
  const r = orch({
    transcript_path: tp,
    lastAssistantMessage: "Final verdict: READY — the change is complete and ready to ship.\nctide:delivery=shipped",
  });
  assert.ok(r && /none of the core review panel/.test(r.systemMessage),
    "the camelCase lastAssistantMessage alias must also be honored");
});

test("orchestration-check: finalIdx-bounded provenance is unaffected by a last_assistant_message override", () => {
  // The transcript-bound verdict scan (bounded by finalIdx) must still read the REAL arbiter NOT READY
  // verdict; only the claim-detection text (finalText) is swapped to the fresh last_assistant_message.
  const tp = mkTranscript([
    { role: "assistant", content: [{ type: "tool_use", id: "g", name: "Task", input: { subagent_type: "ctide:arbiter" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "g", content: "Final verdict: NOT READY — auth bypass unresolved." }] },
    { role: "assistant", content: "Wrapping up." },
  ]);
  const r = orch({
    transcript_path: tp,
    last_assistant_message: "The change is complete and ready to ship.\nctide:delivery=shipped",
  });
  assert.ok(r && /arbiter's last verdict was 'NOT READY'/.test(r.systemMessage),
    "the transcript-bound verdict must still be read correctly while claim-detection follows the fresh field");
});

test("orchestration-check: a fresh last_assistant_message can suppress a stale transcript advisory", () => {
  // In the companion case, the fresh field added a claim the stale/benign tail lacked, tripping a
  // new advisory. Here the transcript tail alone (no override) claims READY with no panel run — the
  // same shape as the transcript-only case, which on its own trips the panel-missing advisory — but the
  // FRESH last_assistant_message carries the real, honest final state (an explicit hold sentinel, no
  // ready/shipped claim), and the hook must follow it and stay silent. Locks the "suppress" direction
  // This locks the reverse direction: a fresh field can silence a false-alarm-prone transcript, not
  // just trigger new advisories.
  const tp = mkTranscript([
    { role: "user", content: "do the thing" },
    { role: "assistant", content: "Final verdict: READY — the change is complete and ready to ship." },
  ]);
  const r = orch({
    transcript_path: tp,
    last_assistant_message: "Still investigating an edge case; holding for now.\nctide:delivery=held",
  });
  assert.strictEqual(r, null,
    "an honest last_assistant_message hold must suppress the advisory the stale transcript tail would have tripped alone");
});
