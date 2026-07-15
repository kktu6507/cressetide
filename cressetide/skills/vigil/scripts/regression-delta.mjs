#!/usr/bin/env node
// ctide regression-delta: a PURE DIFFER over two captured test-runner outputs -> the newly-failing tests.
// Session-time helper (NOT a Claude Code hook, NOT CI-only): on `--deep` / high-risk runs the orchestrator
// captures the pre-change test output before implementation and the post-change output at verify, then runs
// `node regression-delta.mjs <before-file> <after-file>` and carries the report into the Review Packet for the
// `arbiter`'s regression ratchet. Dependency-free (Node built-ins only). The ORCHESTRATOR runs the tests;
// this script never spawns a runner (no `child_process`) — it only reads the two saved captures and diffs them.
//
// FAIL-OPEN: on any unparseable/opaque input, unrecognized runner, missing file, or internal error it emits an
// explicit `no-claim` line and ALWAYS exits 0 — it never throws to its caller and never fabricates a regression.
// The command exit status remains the release authority; this layer is strictly additive (it can only NAME a
// real regression, never invent one).
//
// BOUNDARY (the anti-rejected-contract guard — state it explicitly): the differ reads each runner's EXISTING
// NATIVE output (node --test spec/TAP, jest, pytest -v, go test -v) and mandates NO project-side test-id schema.
// ctide deliberately did NOT adopt a universal parseable-test-id contract; this script must never reintroduce
// one. If a runner's own output does not carry per-test ids we can parse faithfully, we make NO claim rather
// than imposing any id format on the project.
//
// Exposes pure functions (detectRunner / extractResults / computeRegressions / formatReport) for the test peer;
// main() wraps them over the two files under the import.meta.url guard. All scanning is line-by-line with
// anchored, non-backtracking regexes (ReDoS-safe) — faithful-or-null: an ambiguous/partial format returns null
// (no-claim), never a half-parse.
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// Strip a leading run of ASCII whitespace (nested subtests are indented by the spec/go reporters). Cheap and
// linear — not a regex, so there is nothing to backtrack.
function lstrip(s) {
  let i = 0;
  while (i < s.length && (s[i] === " " || s[i] === "\t")) i++;
  return i ? s.slice(i) : s;
}

// --- runner detection -------------------------------------------------------------------------------------
// Return one of "node-test" | "jest" | "pytest" | "go-test" | null. Keyed on each runner's most distinctive
// native fingerprint, tried in a fixed priority so the strong, unambiguous signals win. null => no-claim.
export function detectRunner(text) {
  if (typeof text !== "string" || text === "") return null;
  const lines = text.split(/\r?\n/);
  const some = (pred) => lines.some(pred);

  // go test -v: `--- PASS:` / `--- FAIL:` / `--- SKIP:` result lines, or the `=== RUN` marker. Unique tokens.
  if (some((l) => { const t = lstrip(l); return /^--- (PASS|FAIL|SKIP): /.test(t) || /^=== RUN\b/.test(t); })) return "go-test";

  // pytest: the verbose `path::test STATUS` line (path-anchored so a node/jest mark line can't spoof it), or
  // the `==== N passed/failed ... in Xs ====` summary rule (covers the dot-summary form, which yields no ids).
  const pytestVerbose = (l) => /^[\w./\\-]+::.+ (PASSED|FAILED|ERROR|SKIPPED|XFAIL|XPASS)\b/.test(lstrip(l));
  const pytestSummary = (l) => { const t = lstrip(l); return /^=/.test(t) && / in \d/.test(t) && /\b\d+ (passed|failed|error|errors|skipped|xfailed|xpassed)\b/.test(t); };
  if (some(pytestVerbose) || some(pytestSummary)) return "pytest";

  // node --test, TAP reporter: `ok N -` / `not ok N -` result lines, or the `TAP version` banner.
  if (some((l) => /^(?:ok|not ok) \d+ - /.test(l)) || some((l) => /^TAP version \d/.test(l))) return "node-test";

  // node --test, spec reporter (the interactive/default form): the `ℹ tests N` summary, or the HEAVY check /
  // cross marks ✔ (U+2714) / ✖ (U+2716) — distinct code points from jest's light ✓ / ✕, so the two never collide.
  if (some((l) => /^ℹ tests \d+/.test(lstrip(l))) || some((l) => { const t = lstrip(l); return t.startsWith("✔ ") || t.startsWith("✖ "); })) return "node-test";

  // jest: light ✓ (U+2713) / ✕ (U+2715) marks, or Windows-fallback √ / ×, or the `Tests:` / `Test Suites:` summary.
  if (some((l) => /^[✓✕√×] /.test(lstrip(l))) || some((l) => /^(Tests|Test Suites):\s/.test(lstrip(l)))) return "jest";

  return null;
}

// --- per-runner extractors (FAITHFUL-OR-NULL) -------------------------------------------------------------
// Each returns { passed:Set<string>, failed:Set<string> } or null when it cannot confidently parse per-test
// ids from the runner's own output (=> the caller makes no claim). A test id that is neither pass nor fail
// (skipped/todo) is excluded from both sets by design.

// node --test, TAP reporter. Anchored top-level `ok N - name` / `not ok N - name`; a ` # SKIP` / ` # TODO`
// directive marks the line as skipped (excluded). Nested subtests are indented and intentionally not counted
// here (the top-level aggregate line carries the parent's result), matching the documented TAP shape.
function extractNodeTestTap(lines) {
  const passed = new Set();
  const failed = new Set();
  for (const line of lines) {
    const m = /^(ok|not ok) \d+ - (.+)$/.exec(line);
    if (!m) continue;
    const dir = / # (SKIP|TODO)\b/i.exec(m[2]);
    if (dir) continue;                         // SKIP/TODO directive -> neither pass nor fail
    const name = m[2].trim();
    if (!name) continue;
    (m[1] === "ok" ? passed : failed).add(name);
  }
  return (passed.size || failed.size) ? { passed, failed } : null;
}

// node --test, spec reporter. Result lines are `<mark> <name> (<n>ms)` with mark ✔ (pass) / ✖ (fail); the
// trailing ` (Nms)` timing is REQUIRED, which excludes the `✖ failing tests:` summary header and any other
// ✖-prefixed prose. Skips (`﹣ … # reason`) carry no `(Nms)` tail and a different mark, so they never match.
// Suite headers (`▶ name`) are collected first so a suite's AGGREGATE result line (which re-uses the suite
// name and flips ✖ when a child fails) is EXCLUDED — we count leaf tests only, so a green->red suite container
// is never mistaken for a distinct regressed test.
function extractNodeTestSpec(lines) {
  const passed = new Set();
  const failed = new Set();
  const suites = new Set();
  for (const raw of lines) { const t = lstrip(raw); if (t.startsWith("▶ ")) suites.add(t.slice(2).trim()); }
  for (const raw of lines) {
    const t = lstrip(raw);
    let mark;
    if (t.startsWith("✔ ")) mark = "pass";
    else if (t.startsWith("✖ ")) mark = "fail";
    else continue;
    const tm = /^(.*) \((?:\d[\d.]*)ms\)$/.exec(t.slice(2));  // require the timing tail -> real result line only
    if (!tm) continue;
    const name = tm[1].trim();
    if (!name || suites.has(name)) continue;                 // drop suite aggregates -> leaf tests only
    (mark === "pass" ? passed : failed).add(name);
  }
  return (passed.size || failed.size) ? { passed, failed } : null;
}

// node --test dispatcher: prefer TAP when its result lines are present, else the spec reporter, else null.
function extractNodeTest(text) {
  const lines = text.split(/\r?\n/);
  if (lines.some((l) => /^(?:ok|not ok) \d+ - /.test(l))) return extractNodeTestTap(lines);
  if (lines.some((l) => { const t = lstrip(l); return t.startsWith("✔ ") || t.startsWith("✖ "); })) return extractNodeTestSpec(lines);
  return null;
}

// jest, default (verbose) reporter. Test lines are indented `<mark> <label> (<n> ms)` under a describe/file
// header; mark ✓ / √ = pass, ✕ / × = fail. The trailing ` (NNN ms)` timing is dropped from the id. The
// uppercase `PASS`/`FAIL` file headers carry no mark and are ignored.
function extractJest(text) {
  const lines = text.split(/\r?\n/);
  const passed = new Set();
  const failed = new Set();
  for (const raw of lines) {
    const t = lstrip(raw);
    let mark;
    if (t[0] === "✓" || t[0] === "√") mark = "pass";
    else if (t[0] === "✕" || t[0] === "×") mark = "fail";
    else continue;
    if (t[1] !== " ") continue;                              // must be "<mark> <label>"
    const label = t.slice(2);
    const tm = /^(.*) \(\d+ ms\)$/.exec(label);              // drop the ` (NNN ms)` timing for the id
    const name = (tm ? tm[1] : label).trim();
    if (!name) continue;
    (mark === "pass" ? passed : failed).add(name);
  }
  return (passed.size || failed.size) ? { passed, failed } : null;
}

// pytest, verbose (`-v`) reporter. Per-test lines are `path::test_id STATUS [ NN%]`; the id is `path::test_id`.
// PASSED -> pass, FAILED/ERROR -> fail, SKIPPED/XFAIL/XPASS -> neither. The dot-summary (non-verbose) form
// carries NO per-test ids — so this returns null (no-claim) rather than guessing from the pass/fail counts.
function extractPytest(text) {
  const lines = text.split(/\r?\n/);
  const passed = new Set();
  const failed = new Set();
  let sawResult = false;
  for (const raw of lines) {
    const line = lstrip(raw).replace(/\s+\[\s*\d+%\]\s*$/, "").replace(/\s+$/, "");  // drop trailing ` [ NN%]`
    const m = /^([\w./\\-]+::.+) (PASSED|FAILED|ERROR|SKIPPED|XFAIL|XPASS)$/.exec(line);
    if (!m) continue;
    sawResult = true;
    if (m[2] === "PASSED") passed.add(m[1].trim());
    else if (m[2] === "FAILED" || m[2] === "ERROR") failed.add(m[1].trim());
    // SKIPPED / XFAIL / XPASS -> neither
  }
  return sawResult ? { passed, failed } : null;              // no per-test ids (dot-summary) -> no-claim
}

// go test -v. Result lines are `--- PASS: TestName (0.00s)` / `--- FAIL: TestName (0.00s)` (subtests indented
// and named `TestName/sub`). PASS -> pass, FAIL -> fail, SKIP -> neither. Subtest and parent ids are distinct,
// so both are kept naturally.
function extractGoTest(text) {
  const lines = text.split(/\r?\n/);
  const passed = new Set();
  const failed = new Set();
  for (const raw of lines) {
    const m = /^--- (PASS|FAIL|SKIP): (.+) \(\d[\d.]*s\)$/.exec(lstrip(raw));
    if (!m) continue;
    const name = m[2].trim();
    if (!name) continue;
    if (m[1] === "PASS") passed.add(name);
    else if (m[1] === "FAIL") failed.add(name);
    // SKIP -> neither
  }
  return (passed.size || failed.size) ? { passed, failed } : null;
}

// Parse one capture into { passed, failed } or null. Auto-detects the runner when not given.
export function extractResults(text, runner) {
  if (typeof text !== "string" || text === "") return null;
  const r = runner || detectRunner(text);
  switch (r) {
    case "node-test": return extractNodeTest(text);
    case "jest": return extractJest(text);
    case "pytest": return extractPytest(text);
    case "go-test": return extractGoTest(text);
    default: return null;
  }
}

// The regression set = baseline_passing ∩ now_failing: test ids that PASSED in `before` AND FAIL in `after`.
// A test failing in BOTH captures is naturally excluded (it is not in before.passed); a test fixed (red in
// before, green in after) is likewise excluded. A leaf name that is AMBIGUOUS in the baseline — present as
// both a pass AND a fail (a same-name collision across files) — is not confidently baseline-passing, so it is
// excluded too: failing toward a missed name is safer than a false alarm (the pragmatism axiom — a false
// positive is worse than a documented miss). If EITHER capture is unparseable/opaque, or the two captures
// come from different runners (their ids are not comparable), we make NO claim — never guess from counts.
export function computeRegressions(beforeText, afterText) {
  try {
    const rb = detectRunner(beforeText);
    const ra = detectRunner(afterText);
    if (!rb || !ra) return { claim: false, regressions: [], reason: "unrecognized runner output" };
    if (rb !== ra) return { claim: false, regressions: [], reason: `runner mismatch between captures (${rb} vs ${ra})` };
    const before = extractResults(beforeText, rb);
    const after = extractResults(afterText, ra);
    if (!before || !after) return { claim: false, regressions: [], reason: `${rb} output not confidently parseable (no per-test ids)` };
    const regressions = [...before.passed]
      .filter((id) => !before.failed.has(id)) // drop baseline-ambiguous names (passed AND failed before)
      .filter((id) => after.failed.has(id))
      .sort();
    return { claim: true, regressions };
  } catch (e) {
    return { claim: false, regressions: [], reason: "internal parse error" };
  }
}

// Render the differ's result to a single stdout report. On no-claim it is explicit that the exit status stays
// authority; on a claim it NAMES the newly-failing tests and reminds the arbiter to classify each green->red
// against the acceptance criteria + mustNotChange (intended change vs regression) — the script names, it does
// not adjudicate.
export function formatReport(result) {
  const claim = !!(result && result.claim);
  const regressions = (result && Array.isArray(result.regressions)) ? result.regressions : [];
  const reason = (result && result.reason) || "unrecognized runner output";
  if (!claim) return `regression-delta: no-claim (${reason}; exit status remains authority)`;
  if (regressions.length === 0) return "regression-delta: no regression (no baseline-passing test now fails)";
  return "regression-delta: REGRESSION — " + regressions.length + " baseline-passing test(s) now failing " +
    "(arbiter: classify each green->red vs the acceptance criteria + mustNotChange):\n" +
    regressions.map((id) => "  - " + id).join("\n");
}

function readFileSafe(p) { try { return fs.readFileSync(p, "utf8"); } catch (e) { return null; } }

function main(argv) {
  const positional = argv.slice(2).filter((a) => !a.startsWith("-"));
  const [beforePath, afterPath] = positional;
  let report;
  try {
    if (!beforePath || !afterPath) {
      report = "regression-delta: no-claim (usage: regression-delta.mjs <before-file> <after-file>; exit status remains authority)";
    } else {
      const before = readFileSafe(beforePath);
      const after = readFileSafe(afterPath);
      if (before == null || after == null) {
        report = "regression-delta: no-claim (a capture file could not be read — no baseline; exit status remains authority)";
      } else {
        report = formatReport(computeRegressions(before, after));
      }
    }
  } catch (e) {
    report = "regression-delta: no-claim (internal error; exit status remains authority)";
  }
  try { process.stdout.write(report + "\n"); } catch (e) {}
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv);
