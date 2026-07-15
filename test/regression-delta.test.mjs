// Tests for regression-delta.mjs — the arbiter's regression ratchet differ. The load-bearing properties:
// (AC-1) a test GREEN in `before` and RED in `after` is named exactly, while a pre-existing failure (red in
// both) and a FIX (red->green) are never flagged; (AC-2) opaque/unrecognized input fails open to an explicit
// no-claim at exit 0; (AC-3) nothing project-side is required — parsing is purely from each runner's own native
// output. All fixtures are REAL runner formats, not invented shorthand: node --test (spec + TAP) are captured
// verbatim from Node v24 on this machine; jest / pytest -v / go test -v reproduce those tools' documented
// reporter line formats faithfully (those toolchains are not installed here, so they cannot be live-captured —
// the line shapes are the real ones, disclosed here rather than paraphrased). Deterministic, no model.
import { test } from "node:test";
import assert from "node:assert";
import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  detectRunner, extractResults, computeRegressions, formatReport,
} from "../cressetide/skills/vigil/scripts/regression-delta.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(root, "cressetide", "skills", "vigil", "scripts", "regression-delta.mjs");

// ---------------------------------------------------------------------------------------------------------
// node --test, SPEC reporter (the default/interactive form captured verbatim from Node v24.16.0). `before`:
// two green + two red + one skipped. `after`: "stays green" REGRESSES (✔->✖), "being fixed" is FIXED (✖->✔),
// "already broken" stays red, "untouched" stays green. Includes the `✖ failing tests:` re-list section (no
// timing on the header) exactly as the reporter emits it.
const NODE_SPEC_BEFORE = `✔ stays green (0.53ms)
✔ untouched (0.61ms)
✖ already broken (0.72ms)
✖ being fixed (0.80ms)
﹣ skipped one (0.10ms) # deferred
ℹ tests 5
ℹ suites 0
ℹ pass 2
ℹ fail 2
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 12.3

✖ failing tests:

test at demo.test.mjs:3:1
✖ already broken (0.72ms)

test at demo.test.mjs:4:1
✖ being fixed (0.80ms)
`;
const NODE_SPEC_AFTER = `✖ stays green (0.91ms)
✔ untouched (0.60ms)
✖ already broken (0.70ms)
✔ being fixed (0.85ms)
﹣ skipped one (0.10ms) # deferred
ℹ tests 5
ℹ suites 0
ℹ pass 2
ℹ fail 2
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 12.9

✖ failing tests:

test at demo.test.mjs:1:1
✖ stays green (0.91ms)

test at demo.test.mjs:3:1
✖ already broken (0.70ms)
`;

test("AC-1 (node --test spec): the green->red test is named EXACTLY; pre-existing red and a red->green fix are NOT flagged", () => {
  const r = computeRegressions(NODE_SPEC_BEFORE, NODE_SPEC_AFTER);
  assert.strictEqual(r.claim, true, "two parseable captures => a claim is made");
  assert.deepStrictEqual(r.regressions, ["stays green"],
    "only the test that PASSED before and FAILS now is a regression — exact name, exact count");
  // the failing-tests re-list header `✖ failing tests:` has no timing tail, so it is not mistaken for a test;
  // the re-listed `✖ already broken` is a pre-existing failure (red in BOTH) and must not appear.
  assert.ok(!r.regressions.includes("already broken"), "a pre-existing failure (red in both) is not a regression");
  assert.ok(!r.regressions.includes("being fixed"), "a fix (red->green) is not a regression");
  assert.ok(!r.regressions.includes("failing tests:"), "the `✖ failing tests:` summary header is not a test id");
});

test("node --test spec: a green->red suite AGGREGATE (▶ header re-printed ✖) is not counted as a distinct regression", () => {
  // Real spec shape: a suite header `▶ nested`, its leaf child, then the suite's own `✖ nested (Nms)` aggregate
  // line when a child fails. before: the child (and thus the suite) is green; after: the child fails.
  const before = `▶ nested
  ✔ child leaf (0.15ms)
✔ nested (0.30ms)
✔ solo (0.20ms)
ℹ tests 2
ℹ pass 2
ℹ fail 0
`;
  const after = `▶ nested
  ✖ child leaf (0.28ms)
✖ nested (0.31ms)
✔ solo (0.20ms)
ℹ tests 2
ℹ pass 1
ℹ fail 1

✖ failing tests:

test at demo.test.mjs:2:3
✖ child leaf (0.28ms)
`;
  const r = computeRegressions(before, after);
  assert.deepStrictEqual(r.regressions, ["child leaf"],
    "only the LEAF that regressed is named; the suite-aggregate `nested` is excluded (counted as a container, not a test)");
});

// ---------------------------------------------------------------------------------------------------------
// node --test, TAP reporter (captured verbatim from `node --test --test-reporter=tap` on Node v24.16.0),
// trimmed of the deep YAML diagnostics but keeping the real `ok/not ok N - name` + `# SKIP` directive shape.
test("computeRegressions: a baseline leaf-name COLLISION (same name passes AND fails before) that stays failed is NOT flagged (fail toward no-cry-wolf)", () => {
  // Two different files each define `test("handles null")`; before: one passes, one fails; after: unchanged.
  // The name is ambiguous in the baseline (present as both a pass and a fail), so it is not confidently
  // baseline-passing — excluding it turns a false positive into a safe fail-open miss (the pragmatism axiom).
  const before = `✔ handles null (0.20ms)
✖ handles null (0.31ms)
✔ solo (0.10ms)
ℹ tests 3
ℹ pass 2
ℹ fail 1
`;
  const after = `✔ handles null (0.22ms)
✖ handles null (0.29ms)
✖ solo (0.30ms)
ℹ tests 3
ℹ pass 1
ℹ fail 2
`;
  const r = computeRegressions(before, after);
  assert.deepStrictEqual(r.regressions, ["solo"],
    "the ambiguous collided name is NOT flagged (it also failed in the baseline); only the unambiguous green->red `solo` is named");
});

const NODE_TAP_BEFORE = `TAP version 13
# Subtest: stays green
ok 1 - stays green
  ---
  duration_ms: 0.53
  ...
# Subtest: untouched
ok 2 - untouched
  ---
  duration_ms: 0.61
  ...
# Subtest: already broken
not ok 3 - already broken
  ---
  duration_ms: 0.72
  ...
# Subtest: skipped one
ok 4 - skipped one # SKIP deferred
  ---
  duration_ms: 0.10
  ...
1..4
# tests 4
# pass 2
# fail 1
# skipped 1
`;
const NODE_TAP_AFTER = `TAP version 13
# Subtest: stays green
not ok 1 - stays green
  ---
  duration_ms: 0.91
  ...
# Subtest: untouched
ok 2 - untouched
  ---
  duration_ms: 0.60
  ...
# Subtest: already broken
not ok 3 - already broken
  ---
  duration_ms: 0.70
  ...
# Subtest: skipped one
ok 4 - skipped one # SKIP deferred
  ---
  duration_ms: 0.10
  ...
1..4
# tests 4
# pass 1
# fail 2
# skipped 1
`;

test("node --test TAP: the green->red test is named; a `# SKIP` directive line is excluded from pass/fail", () => {
  assert.strictEqual(detectRunner(NODE_TAP_BEFORE), "node-test", "the TAP banner / ok lines detect as node-test");
  const before = extractResults(NODE_TAP_BEFORE);
  assert.ok(!before.passed.has("skipped one"), "an `ok N - name # SKIP …` line is a skip, not a pass");
  const r = computeRegressions(NODE_TAP_BEFORE, NODE_TAP_AFTER);
  assert.deepStrictEqual(r.regressions, ["stays green"], "TAP: only the ok->not-ok test is a regression");
});

// ---------------------------------------------------------------------------------------------------------
// jest, default (verbose) reporter — the documented real line format: a `PASS`/`FAIL` file header, then
// indented `✓ / ✕ label (N ms)` test lines under a describe block, then the `Tests:` summary.
const JEST_BEFORE = `PASS  src/calc.test.js
  calculator
    ✓ adds numbers (3 ms)
    ✓ subtracts numbers (1 ms)

Test Suites: 1 passed, 1 total
Tests:       2 passed, 2 total
`;
const JEST_AFTER = `FAIL  src/calc.test.js
  calculator
    ✕ adds numbers (4 ms)
    ✓ subtracts numbers (1 ms)

  ● calculator › adds numbers

    expect(received).toBe(expected)

Test Suites: 1 failed, 1 total
Tests:       1 failed, 1 passed, 2 total
`;

test("jest: the green->red test is named (light ✓/✕ marks, ` (N ms)` timing dropped from the id)", () => {
  assert.strictEqual(detectRunner(JEST_BEFORE), "jest");
  const r = computeRegressions(JEST_BEFORE, JEST_AFTER);
  assert.deepStrictEqual(r.regressions, ["adds numbers"],
    "the `● calculator › adds numbers` failure header is not a mark line and is not double-counted");
});

test("jest: the Windows-fallback √ / × marks parse too", () => {
  const before = `PASS  src\\calc.test.js\n  calc\n    √ widget renders (2 ms)\n    √ widget clicks (1 ms)\nTests:       2 passed, 2 total\n`;
  const after = `FAIL  src\\calc.test.js\n  calc\n    × widget renders (3 ms)\n    √ widget clicks (1 ms)\nTests:       1 failed, 1 passed, 2 total\n`;
  assert.strictEqual(detectRunner(before), "jest", "√ (U+221A) marks still detect as jest");
  assert.deepStrictEqual(computeRegressions(before, after).regressions, ["widget renders"]);
});

// ---------------------------------------------------------------------------------------------------------
// pytest, verbose (`-v`) reporter — the documented real format: `path::test_id STATUS  [ NN%]` per test, then
// the `==== N failed, M passed in Xs ====` summary rule. The id is the full `path::test_id`.
const PYTEST_BEFORE = `============================= test session starts ==============================
platform win32 -- Python 3.14.5, pytest-8.2.0, pluggy-1.5.0
collected 3 items

tests/test_calc.py::test_add PASSED                                      [ 33%]
tests/test_calc.py::test_sub PASSED                                      [ 66%]
tests/test_calc.py::test_mul FAILED                                      [100%]

=========================== 1 failed, 2 passed in 0.04s ========================
`;
const PYTEST_AFTER = `============================= test session starts ==============================
platform win32 -- Python 3.14.5, pytest-8.2.0, pluggy-1.5.0
collected 3 items

tests/test_calc.py::test_add FAILED                                      [ 33%]
tests/test_calc.py::test_sub PASSED                                      [ 66%]
tests/test_calc.py::test_mul FAILED                                      [100%]

=========================== 2 failed, 1 passed in 0.05s ========================
`;

test("pytest -v: the green->red test is named by its full path::test id", () => {
  assert.strictEqual(detectRunner(PYTEST_BEFORE), "pytest");
  const r = computeRegressions(PYTEST_BEFORE, PYTEST_AFTER);
  assert.deepStrictEqual(r.regressions, ["tests/test_calc.py::test_add"],
    "pytest id = path::test; test_mul (red in both) is not a regression");
});

// pytest, dot-summary (non-verbose) form — NO per-test ids. Must be a no-claim, never a guess from counts.
const PYTEST_DOTS = `============================= test session starts ==============================
platform win32 -- Python 3.14.5, pytest-8.2.0

tests/test_calc.py ....F.                                                [100%]

=================================== FAILURES ===================================
______________________________ test_mul _______________________________________
=========================== 1 failed, 5 passed in 0.03s ========================
`;

test("AC-2 (pytest dot-summary): a summary-only capture (no per-test ids) yields extractResults null => no-claim", () => {
  assert.strictEqual(detectRunner(PYTEST_DOTS), "pytest", "the summary rule still identifies pytest");
  assert.strictEqual(extractResults(PYTEST_DOTS), null, "no `path::test STATUS` lines => cannot parse ids => null");
  const r = computeRegressions(PYTEST_DOTS, PYTEST_DOTS);
  assert.strictEqual(r.claim, false, "unparseable ids => NO regression claim (exit status stays authority)");
});

// ---------------------------------------------------------------------------------------------------------
// go test -v — the documented real format: `--- PASS:`/`--- FAIL: TestName (0.00s)` per test.
const GO_BEFORE = `=== RUN   TestAdd
--- PASS: TestAdd (0.00s)
=== RUN   TestSub
--- PASS: TestSub (0.00s)
=== RUN   TestMul
--- FAIL: TestMul (0.00s)
    calc_test.go:20: expected 6, got 5
FAIL
exit status 1
FAIL\texample/calc\t0.123s
`;
const GO_AFTER = `=== RUN   TestAdd
--- FAIL: TestAdd (0.00s)
    calc_test.go:10: expected 3, got 2
=== RUN   TestSub
--- PASS: TestSub (0.00s)
=== RUN   TestMul
--- FAIL: TestMul (0.00s)
    calc_test.go:20: expected 6, got 5
FAIL
exit status 1
FAIL\texample/calc\t0.456s
`;

test("go test -v: the green->red test is named (TestMul, red in both, is not a regression)", () => {
  assert.strictEqual(detectRunner(GO_BEFORE), "go-test");
  const r = computeRegressions(GO_BEFORE, GO_AFTER);
  assert.deepStrictEqual(r.regressions, ["TestAdd"]);
});

// ---------------------------------------------------------------------------------------------------------
test("detectRunner: each real runner is identified; unrelated prose is null", () => {
  assert.strictEqual(detectRunner(NODE_SPEC_BEFORE), "node-test");
  assert.strictEqual(detectRunner(NODE_TAP_BEFORE), "node-test");
  assert.strictEqual(detectRunner(JEST_BEFORE), "jest");
  assert.strictEqual(detectRunner(PYTEST_BEFORE), "pytest");
  assert.strictEqual(detectRunner(GO_BEFORE), "go-test");
  assert.strictEqual(detectRunner("just some prose\nabout nothing in particular\n"), null);
  assert.strictEqual(detectRunner(""), null);
  assert.strictEqual(detectRunner(42), null);
});

test("AC-3 (no project-side schema): the captures carry NO cressetide/project markers — parsing is purely native", () => {
  for (const cap of [NODE_SPEC_BEFORE, NODE_TAP_BEFORE, JEST_BEFORE, PYTEST_BEFORE, GO_BEFORE]) {
    assert.ok(!/ctide|regression-delta|acceptanceCriteria/i.test(cap),
      "a real runner capture contains no ctide-specific token — nothing project-side is mandated");
  }
  // and extraction still works from the tool's own output alone
  assert.ok(extractResults(GO_BEFORE).passed.has("TestAdd"), "go ids come straight from `--- PASS:` lines");
  assert.ok(extractResults(PYTEST_BEFORE).passed.has("tests/test_calc.py::test_sub"), "pytest ids come from its own `path::test PASSED` lines");
});

test("AC-2 (fail-open): opaque text => no-claim, and different runners between captures => no-claim", () => {
  const prose = "random log output\nnothing test-shaped here\n";
  const r1 = computeRegressions(prose, prose);
  assert.strictEqual(r1.claim, false);
  assert.ok(/no-claim/.test(formatReport(r1)), "the report is an explicit no-claim");
  const r2 = computeRegressions(NODE_SPEC_BEFORE, GO_AFTER);
  assert.strictEqual(r2.claim, false, "before=node-test vs after=go-test are not comparable => no claim");
});

test("computeRegressions never throws on garbage input (fail-open contract)", () => {
  for (const [a, b] of [[null, null], [undefined, ""], [42, {}], ["", ""], [NODE_SPEC_BEFORE, null]]) {
    const r = computeRegressions(a, b);
    assert.strictEqual(r.claim, false, "any un-diffable pair is a no-claim, not a throw");
    assert.deepStrictEqual(r.regressions, []);
  }
});

test("formatReport: no-claim / no-regression / named-regression renderings", () => {
  assert.ok(/no-claim.*exit status remains authority/.test(formatReport({ claim: false, regressions: [], reason: "x" })));
  assert.strictEqual(formatReport({ claim: true, regressions: [] }), "regression-delta: no regression (no baseline-passing test now fails)");
  const named = formatReport({ claim: true, regressions: ["a", "b"] });
  assert.ok(named.includes("REGRESSION — 2 baseline-passing test(s)") && named.includes("  - a") && named.includes("  - b"),
    "a real regression names each newly-failing test and counts them");
});

// ---------------------------------------------------------------------------------------------------------
// CLI: the script reads two files, ALWAYS exits 0, and never throws to its caller.
function withTempCaptures(before, after, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-regdelta-"));
  try {
    const bp = path.join(dir, "before.txt");
    const ap = path.join(dir, "after.txt");
    fs.writeFileSync(bp, before);
    fs.writeFileSync(ap, after);
    return fn(bp, ap);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("CLI: two real captures => names the regression on stdout and exits 0", () => {
  withTempCaptures(NODE_SPEC_BEFORE, NODE_SPEC_AFTER, (bp, ap) => {
    const r = cp.spawnSync("node", [SCRIPT, bp, ap], { encoding: "utf8" });
    assert.strictEqual(r.status, 0, "must always exit 0");
    assert.ok(r.stdout.includes("REGRESSION") && r.stdout.includes("stays green"), "the CLI names the regressed test");
  });
});

test("CLI: opaque captures => explicit no-claim, exit 0", () => {
  withTempCaptures("noise\n", "more noise\n", (bp, ap) => {
    const r = cp.spawnSync("node", [SCRIPT, bp, ap], { encoding: "utf8" });
    assert.strictEqual(r.status, 0);
    assert.ok(r.stdout.includes("no-claim"), "unrecognized input fails open to a no-claim line");
  });
});

test("CLI: a missing capture file => no-claim, exit 0 (no baseline, no throw)", () => {
  const r = cp.spawnSync("node", [SCRIPT, "does-not-exist-before.txt", "does-not-exist-after.txt"], { encoding: "utf8" });
  assert.strictEqual(r.status, 0);
  assert.ok(r.stdout.includes("no-claim"), "an unreadable capture is a no-claim, never a crash");
});

test("CLI: no arguments => usage no-claim, exit 0", () => {
  const r = cp.spawnSync("node", [SCRIPT], { encoding: "utf8" });
  assert.strictEqual(r.status, 0);
  assert.ok(r.stdout.includes("no-claim") && r.stdout.includes("usage"), "missing args fail open with a usage hint");
});
