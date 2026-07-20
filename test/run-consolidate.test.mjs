// Tests for run-consolidate.mjs — on-demand counts + the 14-day/>=3-escape tripwire digest. The
// load-bearing properties: the "no data => no claim" honesty guard (insufficientHistory blocks alarm even
// when the raw in-window count alone would cross the threshold); the threshold logic itself is proven with
// a genuine red->green pair (3 escaped closes -> alarm:true, removing the 3rd -> alarm:false); and an
// oversized ledger is read from its TAIL (newest events), not its head, so a >4MB ledger still returns a
// correct result instead of crashing or silently dropping the signal that matters. Nothing here stores
// anything — every test asserts the CLI/functions are pure computation over the ledger's existing content.
import { test } from "node:test";
import assert from "node:assert";
import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { consolidateState, formatDigest, readLedgerTailCapped, KNOWN_FLAGS } from "../cressetide/skills/vigil/scripts/run-consolidate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(root, "cressetide", "skills", "vigil", "scripts", "run-consolidate.mjs");
const DAY = 86400000;

function temporary(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function runConsolidate(cwd, args) { return cp.execFileSync("node", [SCRIPT, ...args], { cwd, encoding: "utf8" }); }
function ledgerFileIn(dir) {
  fs.mkdirSync(path.join(dir, ".ctide", "ledger"), { recursive: true });
  return path.join(dir, ".ctide", "ledger", "runs.jsonl");
}

// --- unit: readLedgerTailCapped ---

test("readLedgerTailCapped reads the WHOLE file when at/under the cap", () => {
  const dir = temporary("ctide-cons-cap1-");
  const file = path.join(dir, "small.jsonl");
  const content = "hello world\n".repeat(10);
  fs.writeFileSync(file, content, "utf8");
  assert.strictEqual(readLedgerTailCapped(file), content);
});

test("readLedgerTailCapped reads only the TAIL of an oversized file — the newest bytes, not the oldest", () => {
  const dir = temporary("ctide-cons-cap2-");
  const file = path.join(dir, "big.jsonl");
  const headMarker = "HEAD_MARKER_SHOULD_BE_CUT\n";
  const filler = "x".repeat(200) + "\n";
  const need = 5 * 1024 * 1024; // comfortably over the 4MB cap
  const tailMarker = "TAIL_MARKER_MUST_SURVIVE\n";
  fs.writeFileSync(file, headMarker + filler.repeat(Math.ceil(need / filler.length)) + tailMarker, "utf8");
  const got = readLedgerTailCapped(file);
  assert.ok(got.includes("TAIL_MARKER_MUST_SURVIVE"), "the tail marker must be present");
  assert.ok(!got.includes("HEAD_MARKER_SHOULD_BE_CUT"), "the head marker must have been cut off by the cap");
});

test("readLedgerTailCapped returns '' on a missing file (fail-open)", () => {
  assert.strictEqual(readLedgerTailCapped(path.join(os.tmpdir(), "ctide-does-not-exist-" + Date.now() + ".jsonl")), "");
});

// --- unit: consolidateState ---

test("consolidateState: empty records -> all zero, insufficientHistory true, alarm false", () => {
  const s = consolidateState([], { now: 1000 });
  assert.deepStrictEqual(s, {
    open: 0,
    closedByType: { escaped: 0, survived: 0, superseded: 0, "building-upon": 0 },
    escapedInWindow: 0,
    windowDays: 14,
    threshold: 3,
    alarm: false,
    insufficientHistory: true,
  });
});

test("consolidateState: open counts RUN RECORDS with no matching close event (matched by head)", () => {
  const records = [
    { type: "run", head: "h1" },
    { type: "run", head: "h2" },
    { type: "close", ref: "h1", as: "escaped", ts: 1 },
  ];
  const s = consolidateState(records, { now: 1000 });
  assert.strictEqual(s.open, 1, "h2 has no close event; h1 does");
});

test("consolidateState: closedByType tallies each of the 4 dispositions", () => {
  const mk = (ref, as, ts) => ({ type: "close", ref, as, ts });
  const records = [
    mk("h1", "escaped", 1), mk("h2", "escaped", 2), mk("h3", "survived", 3),
    mk("h4", "superseded", 4), mk("h5", "building-upon", 5),
  ];
  const s = consolidateState(records, { now: 1000 });
  assert.deepStrictEqual(s.closedByType, { escaped: 2, survived: 1, superseded: 1, "building-upon": 1 });
});

test("consolidateState: escapedInWindow counts only 'escaped' closes within the last windowDays of `now`", () => {
  const now = 100 * DAY;
  // Distinct `ref` per record (one close per run) -- each is a DIFFERENT run's disposition, not the
  // same run closed 4 times, so the latest-close-per-ref dedup does not collapse them together.
  const mk = (ref, ts, as) => ({ type: "close", ref, as, ts });
  const records = [
    mk("r1", now - 1 * DAY, "escaped"),
    mk("r2", now - 13 * DAY, "escaped"),
    mk("r3", now - 20 * DAY, "escaped"), // outside a 14d window
    mk("r4", now - 1 * DAY, "survived"), // wrong `as`
  ];
  const s = consolidateState(records, { now, windowDays: 14 });
  assert.strictEqual(s.escapedInWindow, 2);
});

test("consolidateState: insufficientHistory is true below 3 TOTAL closed events ever recorded (not just in-window)", () => {
  const now = 100 * DAY;
  const mk = (ts) => ({ type: "close", ref: "r", as: "escaped", ts });
  const two = consolidateState([mk(now - 1 * DAY), mk(now - 2 * DAY)], { now });
  assert.strictEqual(two.insufficientHistory, true);
  const three = consolidateState([mk(now - 1 * DAY), mk(now - 2 * DAY), mk(now - 200 * DAY)], { now });
  assert.strictEqual(three.insufficientHistory, false, "the 3rd close is outside the window but still counts toward the history floor");
});

test("consolidateState: alarm requires BOTH sufficient history AND escapedInWindow >= threshold — genuine red->green on the 3rd escape", () => {
  const now = 100 * DAY;
  const mk = (ts) => ({ type: "close", ref: "r" + ts, as: "escaped", ts });
  const two = [mk(now - 1 * DAY), mk(now - 2 * DAY)];
  assert.strictEqual(consolidateState(two, { now, threshold: 3 }).alarm, false, "RED: only 2 escapes, below threshold");
  const three = [...two, mk(now - 3 * DAY)];
  assert.strictEqual(consolidateState(three, { now, threshold: 3 }).alarm, true, "GREEN: the 3rd escape crosses the threshold");
});

test("consolidateState never claims alarm when insufficientHistory is true, even if the raw window count alone would cross the threshold", () => {
  // Exactly 2 total closes (below the 3-event history floor), both escaped and inside the window, with a
  // threshold of 1 -- the raw window count (2) already clears threshold 1, isolating the honesty guard.
  const now = 100 * DAY;
  const mk = (ts) => ({ type: "close", ref: "r" + ts, as: "escaped", ts });
  const s = consolidateState([mk(now - 1 * DAY), mk(now - 2 * DAY)], { now, threshold: 1 });
  assert.strictEqual(s.insufficientHistory, true);
  assert.ok(s.escapedInWindow >= 1, "the window count alone would already cross the threshold");
  assert.strictEqual(s.alarm, false, "the honesty guard blocks alarm regardless of the raw window count");
});

// --- unit: consolidateState close-event dedup (a run closed more than once counts ONCE, as its LATEST disposition) ---

test("consolidateState: a run closed twice (auto-'survived' then hand-corrected to 'escaped') counts ONCE, as its LATEST disposition -- never tallied in both closedByType buckets", () => {
  const records = [
    { type: "close", ref: "dupe", as: "survived", ts: 1 },  // earlier: e.g. auto-`expire`d as survived
    { type: "close", ref: "dupe", as: "escaped", ts: 2 },   // later: hand-corrected once a human noticed it escaped
    { type: "close", ref: "other", as: "survived", ts: 3 }, // unrelated, just clears the 3-event history floor
  ];
  const s = consolidateState(records, { now: 1000 });
  assert.deepStrictEqual(s.closedByType, { escaped: 1, survived: 1, superseded: 0, "building-upon": 0 },
    "dupe counts once, as 'escaped' (its later disposition); the stale earlier 'survived' close must not also tally");
});

test("consolidateState: dedup ties on an identical ts break by LEDGER ORDER -- the line written later wins", () => {
  const records = [
    { type: "close", ref: "dupe", as: "survived", ts: 5 },
    { type: "close", ref: "dupe", as: "escaped", ts: 5 },       // same ts, appears LATER in ledger order
    { type: "close", ref: "other", as: "building-upon", ts: 5 },
  ];
  const s = consolidateState(records, { now: 1000 });
  assert.strictEqual(s.closedByType.escaped, 1);
  assert.strictEqual(s.closedByType.survived, 0, "the earlier-in-ledger-order 'survived' line must be superseded by the later 'escaped' line");
});

test("consolidateState: escapedInWindow reflects only the LATEST disposition per ref -- a stale escaped close superseded by a later non-escaped one must not inflate the count", () => {
  const now = 100 * DAY;
  const records = [
    { type: "close", ref: "dupe", as: "escaped", ts: now - 1 * DAY },       // stale: was (wrongly) marked escaped
    { type: "close", ref: "dupe", as: "survived", ts: now - 1 * DAY + 1 },  // corrected later: actually survived
    { type: "close", ref: "other", as: "escaped", ts: now - 1 * DAY },
  ];
  const s = consolidateState(records, { now });
  assert.strictEqual(s.escapedInWindow, 1, "dupe's stale escaped close must not count once superseded by a later, non-escaped correction");
});

test("consolidateState: a close event with a non-finite `ts` (external ledger corruption only -- these scripts never emit one) never wins the latest-by-ref tie-break over a genuinely-timestamped close for the same ref", () => {
  const records = [
    { type: "close", ref: "corrupt", as: "escaped", ts: NaN },  // corrupted entry, written first
    { type: "close", ref: "corrupt", as: "survived", ts: 5 },   // later, real disposition for the same ref
    { type: "close", ref: "other", as: "survived", ts: 3 },     // unrelated, just clears the 3-event history floor
  ];
  const s = consolidateState(records, { now: 1000 });
  assert.deepStrictEqual(s.closedByType, { escaped: 0, survived: 2, superseded: 0, "building-upon": 0 },
    "the corrupted NaN-ts close must not out-rank the real, later disposition for the same ref");
});

// --- unit: formatDigest ---

test("formatDigest: insufficientHistory prints 'insufficient history — no claim' and NEVER alarm/threshold language", () => {
  const out = formatDigest(consolidateState([], { now: 1 }));
  assert.match(out, /insufficient history — no claim/);
  assert.ok(!/ALARM/.test(out));
  assert.ok(!/below threshold/.test(out));
});

test("formatDigest: alarm prints the ALARM line with the count and window", () => {
  const now = 100 * DAY;
  const mk = (ts) => ({ type: "close", ref: "r" + ts, as: "escaped", ts });
  const s = consolidateState([mk(now - 1 * DAY), mk(now - 2 * DAY), mk(now - 3 * DAY)], { now, threshold: 3 });
  assert.match(formatDigest(s), /ALARM: retro suggested — 3 escaped closures within 14 days/);
});

test("formatDigest: below-threshold prints the explicit no-alarm line", () => {
  const now = 100 * DAY;
  const mk = (ts) => ({ type: "close", ref: "r" + ts, as: "escaped", ts });
  const s = consolidateState([mk(now - 1 * DAY), mk(now - 2 * DAY), mk(now - 200 * DAY)], { now, threshold: 3 });
  assert.match(formatDigest(s), /\(no alarm — below threshold\)/);
});

// --- e2e: CLI ---

test("--json on an empty/missing ledger yields insufficientHistory:true, alarm:false, all counts 0, exactly one JSON line", () => {
  const dir = temporary("ctide-cons-empty-");
  const out = runConsolidate(dir, ["--json", "--now", "1000"]);
  assert.strictEqual(out.trim().split("\n").length, 1, "exactly one line, no other stdout output");
  const state = JSON.parse(out.trim());
  assert.strictEqual(state.insufficientHistory, true);
  assert.strictEqual(state.alarm, false);
  assert.strictEqual(state.open, 0);
  assert.deepStrictEqual(state.closedByType, { escaped: 0, survived: 0, superseded: 0, "building-upon": 0 });
});

test("--json: a seeded ledger with 3 escaped closes inside the last 14 days sets alarm:true; removing the 3rd (down to 2) sets it back to false", () => {
  const dir = temporary("ctide-cons-seed-");
  const now = Date.now();
  const ledgerPath = ledgerFileIn(dir);
  const mkClose = (ref, daysAgo) =>
    JSON.stringify({ v: 1, type: "close", ts: now - daysAgo * DAY, ref, as: "escaped", reason: "r" });
  fs.writeFileSync(ledgerPath, [mkClose("h1", 1), mkClose("h2", 2), mkClose("h3", 3)].join("\n") + "\n", "utf8");

  const withThree = JSON.parse(runConsolidate(dir, ["--json", "--now", String(now)]).trim());
  assert.strictEqual(withThree.alarm, true, "RED->GREEN: 3 escapes in window crosses the threshold");
  assert.strictEqual(withThree.escapedInWindow, 3);

  fs.writeFileSync(ledgerPath, [mkClose("h1", 1), mkClose("h2", 2)].join("\n") + "\n", "utf8");
  const withTwo = JSON.parse(runConsolidate(dir, ["--json", "--now", String(now)]).trim());
  assert.strictEqual(withTwo.alarm, false, "down to 2 escapes, alarm flips back off");
  assert.strictEqual(withTwo.escapedInWindow, 2);
});

test("a ledger larger than the read cap still returns a valid result rather than crashing (tail-cap behavior)", () => {
  const dir = temporary("ctide-cons-big-");
  const now = Date.now();
  const ledgerPath = ledgerFileIn(dir);
  const filler = JSON.stringify({
    v: 1, type: "run", ts: 1, task: "filler", base: null, head: "deadbeef", files: [],
    verdict: "", verify: "", panel: "", repairs: 0, findings: [],
    planned: { paths: [], risk: null }, drift: { outOfScope: 0, mapCorrections: "" }, window: { days: 14, status: "open" },
  }) + "\n";
  const need = 5 * 1024 * 1024; // comfortably over the 4MB cap
  const head = filler.repeat(Math.ceil(need / filler.length));
  const mkClose = (ref, daysAgo) =>
    JSON.stringify({ v: 1, type: "close", ts: now - daysAgo * DAY, ref, as: "escaped", reason: "tail-signal" }) + "\n";
  const tail = mkClose("t1", 1) + mkClose("t2", 2) + mkClose("t3", 3); // near the very end -> must survive the cap
  fs.writeFileSync(ledgerPath, head + tail, "utf8");

  const state = JSON.parse(runConsolidate(dir, ["--json", "--now", String(now)]).trim());
  assert.strictEqual(state.escapedInWindow, 3, "the 3 tail escapes must survive a TAIL cap (would read as 0 under a head cap)");
  assert.strictEqual(state.alarm, true);
});

test("human-readable default output (no --json) shows open/closed-by-type/escaped-in-window and the terminal no-claim line", () => {
  const out = runConsolidate(temporary("ctide-cons-human-"), ["--now", "1000"]);
  assert.match(out, /open: 0/);
  assert.match(out, /closed by type:/);
  assert.match(out, /escaped in window:/);
  assert.match(out, /insufficient history — no claim/);
});

test("--window-days and --threshold flags are honored by the CLI", () => {
  const dir = temporary("ctide-cons-flags-");
  const now = Date.now();
  const ledgerPath = ledgerFileIn(dir);
  const mkClose = (ref, as, daysAgo) =>
    JSON.stringify({ v: 1, type: "close", ts: now - daysAgo * DAY, ref, as, reason: "r" });
  // 2 escaped closes inside a 7-day window + a 3rd (non-escaped) close to clear the 3-event history floor,
  // so this test isolates the --threshold=2 flag rather than the (separately pinned) honesty guard.
  fs.writeFileSync(
    ledgerPath,
    [mkClose("h1", "escaped", 1), mkClose("h2", "escaped", 2), mkClose("h3", "survived", 100)].join("\n") + "\n",
    "utf8",
  );
  const state = JSON.parse(
    runConsolidate(dir, ["--json", "--now", String(now), "--window-days", "7", "--threshold", "2"]).trim(),
  );
  assert.strictEqual(state.windowDays, 7);
  assert.strictEqual(state.threshold, 2);
  assert.strictEqual(state.insufficientHistory, false, "3 total closes ever recorded clears the history floor");
  assert.strictEqual(state.escapedInWindow, 2);
  assert.strictEqual(state.alarm, true, "2 escapes >= threshold 2");
});

test("--json: a run closed twice for the same ref counts exactly ONE disposition, matching the LATER close event", () => {
  const dir = temporary("ctide-cons-dedup-");
  const now = Date.now();
  const ledgerPath = ledgerFileIn(dir);
  const first = JSON.stringify({ v: 1, type: "close", ts: now - 5 * DAY, ref: "dupe", as: "survived", reason: "window expired with no detected overlap" });
  const second = JSON.stringify({ v: 1, type: "close", ts: now - 1 * DAY, ref: "dupe", as: "escaped", reason: "hand-corrected: actually escaped in prod" });
  const filler = JSON.stringify({ v: 1, type: "close", ts: now - 4 * DAY, ref: "other", as: "survived", reason: "r" });
  fs.writeFileSync(ledgerPath, [first, second, filler].join("\n") + "\n", "utf8");

  const state = JSON.parse(runConsolidate(dir, ["--json", "--now", String(now)]).trim());
  assert.strictEqual(state.closedByType.escaped, 1, "the later 'escaped' correction wins for dupe");
  assert.strictEqual(state.closedByType.survived, 1, "only 'other's survived close counts; dupe's stale survived must not also tally");
  assert.strictEqual(state.escapedInWindow, 1, "dupe counts once as escaped in-window, not zero and not twice");
});

test("run-consolidate.mjs never writes to the ledger it reads (stores nothing)", () => {
  const dir = temporary("ctide-cons-nowrite-");
  const ledgerPath = ledgerFileIn(dir);
  fs.writeFileSync(ledgerPath, JSON.stringify({ v: 1, type: "run", head: "h1" }) + "\n", "utf8");
  const before = fs.readFileSync(ledgerPath);
  runConsolidate(dir, ["--now", "1000"]);
  runConsolidate(dir, ["--json", "--now", "1000"]);
  const after = fs.readFileSync(ledgerPath);
  assert.ok(before.equals(after));
});

// --- e2e: run-consolidate whole-class flag-swallow guard (get() itself now guards EVERY flag in this
// file's own KNOWN_FLAGS -- the same shared-mechanism fix run-reconcile.mjs / run-ledger.mjs apply over
// their own flag sets. `--json` is a boolean flag read via `args.includes`, not `get()` -- it has no value
// position of its own to attack, so it is excluded from the OUTER (attacked) loop below, but it stays a full
// member of KNOWN_FLAGS and appears in the INNER (swallower) loop -- a bare `--json` occupying another
// flag's value slot is exactly the "boolean-style flag" swallow this file's own KNOWN_FLAGS comment calls
// out) ---

test("run-consolidate: for EVERY value-bearing flag in KNOWN_FLAGS, a value slot occupied by any OTHER known flag's own name (including the boolean --json) is treated as omitted, never as a literal value -- a seeded ledger with exactly one OPEN run and ZERO close events makes open:1/insufficientHistory:true/alarm:false/escapedInWindow:0/closedByType-all-zero independent of --now/--window-days/--threshold's own value, so this is a stable, deterministic proof that --cwd's swallow never silently misdirects the read to a bogus, nonexistent '<flag-name>' subdirectory (which would read as an EMPTY ledger -- open:0 -- instead of the real one-open-run ledger)", () => {
  const VALUE_FLAGS = KNOWN_FLAGS.filter((f) => f !== "--json");
  const BOOL_FLAGS = ["--json"];
  const values = { "--now": "123456", "--window-days": "10", "--threshold": "2" };
  for (const F of VALUE_FLAGS) {
    for (const G of KNOWN_FLAGS) {
      if (G === F) continue;
      const dir = temporary("ctide-cons-swallow-");
      const ledgerPath = ledgerFileIn(dir);
      fs.writeFileSync(ledgerPath, JSON.stringify({
        v: 1, type: "run", ts: 1, task: "t", base: null, head: "swallowcanary", files: [],
        verdict: "", verify: "", panel: "", repairs: 0, findings: [],
        planned: { paths: [], risk: null }, drift: { outOfScope: 0, mapCorrections: "" },
        window: { days: 14, status: "open" },
      }) + "\n", "utf8");

      // Order: G's own legitimate occurrence FIRST, then every other flag, then F LAST with its value slot
      // occupied by the literal token G -- keeps every flag's `indexOf` lookup unambiguous (mirrors
      // run-reconcile.test.mjs / run-ledger.test.mjs's identical loop-test ordering discipline).
      const order = [G, ...KNOWN_FLAGS.filter((x) => x !== F && x !== G), F];
      const argv = [];
      for (const flagName of order) {
        if (flagName === F) argv.push(F, G); // F's own value slot swallowed by G's literal name
        else if (flagName === "--cwd") argv.push("--cwd", dir);
        else if (BOOL_FLAGS.includes(flagName)) argv.push(flagName); // bare boolean, no value slot
        else argv.push(flagName, values[flagName]);
      }
      // Hermetic: strip CLAUDE_PROJECT_DIR so --cwd's fallback resolves to the spawned process's own cwd
      // (this temp dir), never a developer's ambient project dir (test/helpers.mjs's own convention).
      const env = { ...process.env };
      delete env.CLAUDE_PROJECT_DIR;
      const result = cp.spawnSync("node", [SCRIPT, ...argv], { cwd: dir, encoding: "utf8", env });
      assert.strictEqual(result.status, 0, `${F} swallowed by ${G} must still exit 0 (fail-open): ${result.stderr}`);
      const state = JSON.parse(result.stdout.trim());
      assert.strictEqual(state.open, 1,
        `${F} swallowed by ${G}: the real ledger's one open run must still be read (0 would mean --cwd was misdirected to a bogus '${G}' path)`);
      assert.strictEqual(state.insufficientHistory, true, `${F} swallowed by ${G}: insufficientHistory unaffected (zero close events)`);
      assert.strictEqual(state.alarm, false, `${F} swallowed by ${G}: alarm unaffected (gated by insufficientHistory)`);
      assert.strictEqual(state.escapedInWindow, 0, `${F} swallowed by ${G}: escapedInWindow unaffected (zero close events)`);
      assert.deepStrictEqual(state.closedByType, { escaped: 0, survived: 0, superseded: 0, "building-upon": 0 },
        `${F} swallowed by ${G}: closedByType unaffected (zero close events)`);
    }
  }
});
