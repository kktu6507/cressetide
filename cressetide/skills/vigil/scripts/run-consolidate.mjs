#!/usr/bin/env node
// ctide run-consolidate: on-demand counts + the 14-day/>=3-escape tripwire digest over the run ledger
// (.ctide/ledger/runs.jsonl). Session-time helper (NOT a Claude Code hook, NOT CI-only): the orchestrator
// runs this AFTER the arbiter's verdict is already locked and relays its output to the USER as a plain
// one-line fact — it must never be reasoned over by the orchestrator to adjust this run's own scope, risk
// tier, or panel (the post-verdict boundary; see references/run-ledger.md). It computes counts on demand
// and stores nothing new anywhere; an empty/short ledger yields an explicit no-claim digest, never a
// fabricated rate — nothing here stores a rate, score, or percentage, ever.
//
// Dependency-free (Node built-ins only). Fail-open: a missing/unreadable ledger or any internal error
// degrades to the same no-claim digest, never a throw; the CLI always exits 0. Reuses run-ledger.mjs's
// shared primitives (runsLedgerPath / readRunsLedger) rather than re-implementing them. Exposes pure
// functions (consolidateState / formatDigest) and the tail-capped reader (readLedgerTailCapped) for the
// test suite; main() wraps the CLI under the import.meta.url guard.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { runsLedgerPath, readRunsLedger } from "./run-ledger.mjs";

const DAY_MS = 86400000;
const DEFAULT_WINDOW_DAYS = 14;
const DEFAULT_THRESHOLD = 3;
// Cap ledger reads to the TAIL 4MB (mirrors failure-consolidate.mjs's own read-cap pattern) — newest
// events matter most for a window computation, so on an oversized ledger we read the newest bytes, not
// the oldest.
const MAX_READ = 4 * 1024 * 1024;

// Read at most MAX_READ bytes from the END of `file` (the newest events); "" on any error (fail-open).
export function readLedgerTailCapped(file) {
  try {
    const size = fs.statSync(file).size;
    if (size <= MAX_READ) return fs.readFileSync(file, "utf8");
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(MAX_READ);
      const n = fs.readSync(fd, buf, 0, MAX_READ, Math.max(0, size - MAX_READ));
      return buf.toString("utf8", 0, n);
    } finally { try { fs.closeSync(fd); } catch (e) {} }
  } catch (e) { return ""; }
}

// Only the `run`-typed, head-bearing records (a headless run has nothing a close event could ever match).
function runRecordsOf(records) {
  return (records || []).filter((r) => r && r.type === "run" && typeof r.head === "string" && r.head);
}

// Every `close`-typed record with a string `ref` (well-formed close events only).
function closeRecordsOf(records) {
  return (records || []).filter((r) => r && r.type === "close" && typeof r.ref === "string" && r.ref);
}

// A run can be closed more than once (e.g. auto-`survived` via `expire`, later hand-corrected to
// `escaped` once a human notices it actually escaped) -- only its LATEST close event (by `ts`, ties
// broken by ledger order -- the line written later wins) is that run's true final disposition. Reduce
// the raw close-event list to exactly one (the final) entry per `ref`.
function latestCloseByRef(closes) {
  const latest = new Map();
  closes.forEach((c, i) => {
    // A non-finite `ts` (only reachable via external ledger corruption -- these scripts themselves never
    // emit one) must never win the tie-break over a genuinely-timestamped close for the same ref; treat it
    // as the oldest possible instant, mirroring escapedInWindow's own Number.isFinite(c.ts) guard below.
    const ts = Number.isFinite(c.ts) ? c.ts : -Infinity;
    const prev = latest.get(c.ref);
    if (!prev || ts > prev.ts || (ts === prev.ts && i > prev.i)) latest.set(c.ref, { c, i, ts });
  });
  return Array.from(latest.values(), (v) => v.c);
}

// Reconstruct on-demand state from the parsed ledger records. Stores nothing; every field is recomputed
// fresh each call. `open` counts RUN RECORDS (not deduplicated heads) with no matching close event, since
// a close event's `ref` matches by head, not by a specific run-record instance. `closedByType` and
// `escapedInWindow` count each ref's LATEST close event only (see latestCloseByRef above) -- a run closed
// more than once counts ONCE, as its final disposition, never tallied in both buckets. `insufficientHistory`
// is the same "no data => no claim" honesty guard failure-consolidate.mjs already uses: below 3 closed
// events EVER recorded (not just in-window, and deliberately NOT deduplicated -- every historical
// correction still counts toward "has this ever been reconciled at all"), a count-derived claim is not yet
// honest to make.
export function consolidateState(records, opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : 0;
  const windowDays = Number.isFinite(opts.windowDays) && opts.windowDays > 0 ? opts.windowDays : DEFAULT_WINDOW_DAYS;
  const threshold = Number.isFinite(opts.threshold) && opts.threshold >= 0 ? opts.threshold : DEFAULT_THRESHOLD;

  const runs = runRecordsOf(records);
  const closes = closeRecordsOf(records);
  const closedHeads = new Set(closes.map((c) => c.ref));
  const open = runs.filter((r) => !closedHeads.has(r.head)).length;

  const finalCloses = latestCloseByRef(closes);

  const closedByType = { escaped: 0, survived: 0, superseded: 0, "building-upon": 0 };
  for (const c of finalCloses) {
    if (Object.prototype.hasOwnProperty.call(closedByType, c.as)) closedByType[c.as]++;
  }

  const windowStart = now - windowDays * DAY_MS;
  const escapedInWindow = finalCloses.filter((c) =>
    c.as === "escaped" && Number.isFinite(c.ts) && c.ts >= windowStart && c.ts <= now).length;

  const insufficientHistory = closes.length < 3;
  const alarm = !insufficientHistory && escapedInWindow >= threshold;

  return { open, closedByType, escapedInWindow, windowDays, threshold, alarm, insufficientHistory };
}

// Short human-readable digest: open count, closed-by-type breakdown, escaped-in-window count, and exactly
// one of the three terminal lines — insufficient history, alarm, or below-threshold. Never alarm/threshold
// language when insufficientHistory is true (the honesty guard stays visible in the prose too).
export function formatDigest(state) {
  const lines = ["ctide-consolidate (deterministic, stores nothing):"];
  lines.push("  open: " + state.open);
  lines.push(
    "  closed by type: escaped=" + state.closedByType.escaped +
    " survived=" + state.closedByType.survived +
    " superseded=" + state.closedByType.superseded +
    " building-upon=" + state.closedByType["building-upon"],
  );
  lines.push("  escaped in window: " + state.escapedInWindow + " (last " + state.windowDays + "d)");
  if (state.insufficientHistory) {
    lines.push("  insufficient history — no claim");
  } else if (state.alarm) {
    lines.push("  ALARM: retro suggested — " + state.escapedInWindow + " escaped closures within " + state.windowDays + " days");
  } else {
    lines.push("  (no alarm — below threshold)");
  }
  return lines.join("\n");
}

const EMPTY_STATE = {
  open: 0,
  closedByType: { escaped: 0, survived: 0, superseded: 0, "building-upon": 0 },
  escapedInWindow: 0,
  windowDays: DEFAULT_WINDOW_DAYS,
  threshold: DEFAULT_THRESHOLD,
  alarm: false,
  insufficientHistory: true,
};

// Every flag token this file's `get()` closure is ever queried with, PLUS the boolean `--json` flag (read
// via `args.includes`, not `get()` -- it carries no value of its own, but is still a recognized flag NAME
// that must never be swallowed as some OTHER flag's value, e.g. `--cwd --json --now 1` silently reading
// cwd="--json") -- this file's own complete recognized-flag set. Exported so the test suite can drive the
// SAME list `get()` guards against (no hardcoded duplicate list to drift out of sync). `get()` itself
// (below) checks this list before ever returning `args[i + 1]` as a flag's value: when that next token is
// itself one of these names, the value is treated as omitted -- `get()` returns the flag's own default
// rather than swallowing the neighboring flag's name. Mirrors run-reconcile.mjs's / run-ledger.mjs's
// identical KNOWN_FLAGS guard, each over its own file's complete flag set.
export const KNOWN_FLAGS = ["--cwd", "--now", "--window-days", "--threshold", "--json"];

function main(argv) {
  const args = argv.slice(2);
  // The one shared flag-value lookup EVERY flag in this file goes through. Guards the swallow at its single
  // root: if the token immediately following `flag` is itself one of KNOWN_FLAGS (this file's own complete
  // recognized-flag set, above), the value is treated as omitted -- `def` is returned instead of the
  // neighboring flag's own name. Fixes every flag uniformly, not per-call-site.
  const get = (flag, def) => {
    const i = args.indexOf(flag);
    const v = i >= 0 ? args[i + 1] : undefined;
    return v && !KNOWN_FLAGS.includes(v) ? v : def;
  };
  const asJson = args.includes("--json");
  try {
    const cwd = get("--cwd", process.env.CLAUDE_PROJECT_DIR || process.cwd());
    const nowRaw = parseInt(get("--now", ""), 10);
    const now = Number.isFinite(nowRaw) ? nowRaw : Date.now();
    const windowDays = parseInt(get("--window-days", String(DEFAULT_WINDOW_DAYS)), 10);
    const threshold = parseInt(get("--threshold", String(DEFAULT_THRESHOLD)), 10);
    const records = readRunsLedger(readLedgerTailCapped(runsLedgerPath(cwd)));
    const state = consolidateState(records, { now, windowDays, threshold });
    // --json: exactly one line of parseable JSON, no other stdout output (the orchestrator parses this at
    // final delivery to build a one-line report bullet).
    process.stdout.write((asJson ? JSON.stringify(state) : formatDigest(state)) + "\n");
  } catch (e) {
    // Fail-open: on any internal error, degrade to the same safe no-claim state rather than throwing.
    process.stdout.write((asJson ? JSON.stringify(EMPTY_STATE) : formatDigest(EMPTY_STATE)) + "\n");
  }
  process.exit(0);
}

function isInvokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isInvokedDirectly()) main(process.argv);
