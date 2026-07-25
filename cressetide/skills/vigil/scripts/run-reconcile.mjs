#!/usr/bin/env node
// ctide run-reconcile: deterministic reconciliation over the run ledger (.ctide/ledger/runs.jsonl).
// Session-time helper (NOT a Claude Code hook, NOT CI-only): `scan` is a READ-ONLY candidate-rework
// detector run by navigator (high-risk) or the SKILL.md main-thread bullet (low/medium risk) on every
// non-trivial vigil run; `close`/`expire` are the only two append paths, and both are single-writer,
// APPEND-ONLY disposition events — this script never edits or removes an existing ledger line. `close`'s
// disposition reason always comes from the calling agent; this script never invents WHY a run is being
// closed, only shapes/appends the event once told. `expire` is the one exception that auto-closes WITHOUT
// a human-supplied reason, and only for the unambiguous past-window/no-overlap case (see below).
//
// Dependency-free (Node built-ins only). Fail-open throughout: a non-git cwd, missing ledger, or any git
// failure yields an explicit no-claim/no-candidates report, never a throw; the CLI always exits 0. Reuses
// run-ledger.mjs's shared primitives (ledgerDir / runsLedgerPath / readRunsLedger / buildCloseEvent /
// appendClose) rather than re-implementing them (the failure-consolidate.mjs / failure-retrieve.mjs
// sibling-reader convention). Exposes pure functions (parseCommitLog / overlapFiles / classifyRun) for the
// test suite; main() wraps the CLI under the import.meta.url guard.
import fs from "node:fs";
import path from "node:path";
import cp from "node:child_process";
import { fileURLToPath } from "node:url";
import { ledgerDir, runsLedgerPath, readRunsLedger, buildCloseEvent, appendClose } from "./run-ledger.mjs";

const DAY_MS = 86400000;
// A rework-flavored commit subject — word-boundary, case-insensitive. Deliberately narrow (the same 4
// literal stems the design settled on): a broader heuristic here would repeat the prose-marker-detection
// trap FAILURE_MEMORY documents (unbounded free-form text never converges on a machine matcher).
const REWORK_PATTERN = /\b(fix|revert|hotfix|regress)/i;
const VALID_AS = ["escaped", "survived", "superseded", "building-upon"];
// A SHA-shape guard for --ref: short-hex to full-length (7..64 hex chars -- SHA-1 objects are 40, SHA-256
// objects (a repo initialized with `git init --object-format=sha256`) are 64; mirrors parseCommitLog's own
// {7,64} bound below so both hash algorithms correlate). Originally the only guard against the shared flag
// parser swallowing the NEXT flag's name as --ref's value when the value itself was omitted (e.g. `close
// --ref --as escaped ...` reading ref="--as") -- writing a phantom close event keyed on a value that is not
// a real SHA. get()'s own KNOWN_FLAGS guard (below) now closes that swallow at the source for --ref too, so
// this stays on as harmless defense-in-depth: a non-hex, non-flag-shaped --ref (e.g. "escaped") is still
// correctly rejected here regardless.
const SHA_RE = /^[0-9a-f]{7,64}$/i;
// Every flag token this file's `get()` closure is ever queried with (main()'s own --cwd/--now reads plus
// this function's --ref/--as/--reason reads below -- the complete recognized-flag set of this CLI's
// parser). Exported so the test suite can drive the SAME list `get()` guards against (no hardcoded
// duplicate list to drift out of sync). `get()` itself (in main(), below) now checks this list before ever
// returning `rest[i + 1]` as a flag's value: when that next token is itself one of these names, the value
// is treated as omitted -- `get()` returns the flag's own default rather than swallowing the neighboring
// flag's name. This guards EVERY flag in this file uniformly, at the one shared mechanism, rather than
// per-call-site -- SHA_RE (--ref, above) and the --reason check inside runClose (below) predate this and
// now double as harmless defense-in-depth (the --reason check in particular still catches a
// whitespace-padded flag-shaped value, e.g. --reason "  --as  ", that get()'s own untrimmed comparison does
// not).
export const KNOWN_FLAGS = ["--ref", "--as", "--reason", "--cwd", "--now"];

// --- pure helpers (test-facing) --------------------------------------------------------------------------

// Only the `run`-typed, head-bearing records — a run with no head (e.g. appended from a non-git cwd) has
// no SHA to correlate against future commits or close events, so it is not reconciliation-trackable.
export function runRecords(records) {
  return (records || []).filter((r) => r && r.type === "run" && typeof r.head === "string" && r.head);
}

// Every head already named by SOME close event's `ref`, regardless of that close's `as` value.
export function closedHeadSet(records) {
  const set = new Set();
  for (const r of records || []) {
    if (r && r.type === "close" && typeof r.ref === "string" && r.ref) set.add(r.ref);
  }
  return set;
}

// Parse `git log --name-only --pretty=format:"%H%x01%s"` output into [{sha, subject, files}]. Each commit
// starts a line shaped `<sha>\x01<subject>`; every following non-blank line until the next such header is
// one of that commit's changed file paths (git's own --name-only shape: a blank line separates commits).
// Tolerant by construction: a stray line before any header is ignored; never throws.
export function parseCommitLog(text) {
  const commits = [];
  let current = null;
  for (const raw of String(text == null ? "" : text).split(/\r?\n/)) {
    const m = /^([0-9a-f]{7,64})\x01(.*)$/.exec(raw);
    if (m) {
      current = { sha: m[1], subject: m[2], files: [] };
      commits.push(current);
      continue;
    }
    const line = raw.trim();
    if (!line || !current) continue;
    current.files.push(line.replace(/\\/g, "/"));
  }
  return commits;
}

// File overlap between a run's recorded files and one commit's files, both normalized the same way
// filesTouched() normalizes (backslash -> forward slash) so a Windows-vs-POSIX path never spuriously misses.
export function overlapFiles(runFiles, commitFiles) {
  const set = new Set((commitFiles || []).map((f) => String(f).replace(/\\/g, "/")));
  return (runFiles || []).map((f) => String(f).replace(/\\/g, "/")).filter((f) => set.has(f));
}

// Classify one not-yet-closed run given ITS OWN since-filtered commit list (already fetched by the caller)
// and `now`. Overlap is checked FIRST regardless of window status (a past-window run with real overlap is
// never silently folded into "expired" — see run-reconcile's expire subcommand). Returns
// { status, overlap: {commit, files} | null } where status is one of:
//   "candidate-rework"   - overlap exists AND >=1 overlapping commit's subject matches REWORK_PATTERN
//   "needs-human-review" - overlap exists but no overlapping commit subject matches (ambiguity stays VISIBLE)
//   "expire-candidate"   - past its window AND no overlap detected at all
//   "open"               - still within its window, no overlap detected (nothing to report)
export function classifyRun(record, commits, now) {
  const windowDays = (record.window && Number.isFinite(record.window.days)) ? record.window.days : 14;
  const pastWindow = now > record.ts + windowDays * DAY_MS;
  let matched = null;
  let anyOverlap = null;
  for (const c of (commits || [])) {
    const files = overlapFiles(record.files, c.files);
    if (files.length === 0) continue;
    if (!anyOverlap) anyOverlap = { commit: c, files };
    if (!matched && REWORK_PATTERN.test(c.subject || "")) matched = { commit: c, files };
  }
  if (matched) return { status: "candidate-rework", overlap: matched };
  if (anyOverlap) return { status: "needs-human-review", overlap: anyOverlap };
  if (pastWindow) return { status: "expire-candidate", overlap: null };
  return { status: "open", overlap: null };
}

// --- I/O helpers -----------------------------------------------------------------------------------------

function readLedgerFile(cwd) {
  try { return fs.readFileSync(runsLedgerPath(cwd), "utf8"); } catch (e) { return ""; }
}

function gitAvailable(cwd) {
  try {
    // stdio pipes BOTH stdout and stderr (map.mjs's own git() helper convention) — execFileSync otherwise
    // inherits stderr to the CALLING process by default, so a non-git-dir failure's raw git error text
    // would leak straight onto this script's stderr instead of staying swallowed here.
    cp.execFileSync(
      "git", ["rev-parse", "--is-inside-work-tree"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10000 },
    );
    return true;
  } catch (e) { return false; }
}

function isShallowClone(cwd) {
  try { return fs.existsSync(path.join(cwd, ".git", "shallow")); } catch (e) { return false; }
}

// git log since a run's own timestamp; swallows ANY failure (non-git dir, no matching commits, git
// missing) to [] — a per-run failure must never abort the scan for the other runs.
function commitsSince(cwd, tsMillis) {
  try {
    const since = new Date(tsMillis).toISOString();
    const out = cp.execFileSync(
      "git", ["log", "--since=" + since, "--name-only", "--pretty=format:%H%x01%s"],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10000 },
    );
    return parseCommitLog(out);
  } catch (e) { return []; }
}

// --- subcommands -------------------------------------------------------------------------------------------

// READ-ONLY: no fs.writeFileSync / appendFileSync / mkdirSync call exists on any path this function (or
// anything it calls) reaches — readRunsLedger/readLedgerFile only read, gitAvailable/commitsSince only
// spawn `git` (never write), isShallowClone only fs.existsSync.
function runScan(cwd, now) {
  if (!gitAvailable(cwd)) {
    process.stdout.write("ctide-reconcile: no git history available — scan produced no candidates\n");
    return;
  }
  const records = readRunsLedger(readLedgerFile(cwd));
  const runs = runRecords(records);
  if (runs.length === 0) {
    process.stdout.write("ctide-reconcile scan: no run records found in " + ledgerDir(cwd) + " — nothing to reconcile.\n");
    return;
  }
  const closed = closedHeadSet(records);
  const pending = runs.filter((r) => !closed.has(r.head));
  if (pending.length === 0) {
    process.stdout.write("ctide-reconcile scan: " + runs.length + " run(s) recorded, all already closed.\n");
    return;
  }

  const rework = [];
  const review = [];
  const expireCandidates = [];
  for (const record of pending) {
    const commits = commitsSince(cwd, record.ts);
    const c = classifyRun(record, commits, now);
    if (c.status === "candidate-rework") rework.push({ record, overlap: c.overlap });
    else if (c.status === "needs-human-review") review.push({ record, overlap: c.overlap });
    else if (c.status === "expire-candidate") expireCandidates.push({ record });
    // "open" (clean, still within window, no overlap) is silent by design — nothing to report yet.
  }

  const lines = ["ctide-reconcile scan (read-only):"];
  if (isShallowClone(cwd)) lines.push("(history truncated — weak-signal only)");

  if (rework.length) {
    lines.push("candidate rework:");
    for (const { record, overlap } of rework) {
      lines.push("  - " + record.head + " — overlap: " + overlap.files.join(", ") +
        " — matching commit " + overlap.commit.sha + " \"" + overlap.commit.subject + "\"");
    }
  }
  if (review.length) {
    lines.push("needs human review:");
    for (const { record, overlap } of review) {
      lines.push("  - " + record.head + " — overlap: " + overlap.files.join(", ") +
        " — commit " + overlap.commit.sha + " \"" + overlap.commit.subject + "\" (no fix/revert marker; ambiguous, not resolved silently)");
    }
  }
  if (expireCandidates.length) {
    lines.push("expire candidates (past window, no overlap detected):");
    for (const { record } of expireCandidates) lines.push("  - " + record.head);
  }
  if (!rework.length && !review.length && !expireCandidates.length) {
    lines.push("no candidates — every open run is clean within its window.");
  }
  process.stdout.write(lines.join("\n") + "\n");
}

// APPEND-ONLY: writes exactly one close event, and only when --as is one of the 4 literal values AND a
// genuine (non-empty-after-trim, not-itself-a-known-flag-token) --reason is supplied. Never invents the
// reason itself — reason is whatever the calling agent passed (capped by buildCloseEvent) — this check
// only rejects an ABSENT, blank, or swallowed-flag-token one; it never substitutes a reason of its own.
function runClose(cwd, now, get) {
  // Git always emits lowercase hex SHAs; normalize an operator-typed --ref before the shape check and
  // storage so an uppercase-but-real SHA still correlates against a run record's (always-lowercase) head
  // instead of silently never matching anything real.
  const ref = get("--ref", "").toLowerCase();
  const as = get("--as", "");
  // Trim ONCE, here, before the value goes anywhere else -- in particular, before buildCloseEvent's own
  // 300-char cap ever sees it. The prior ordering (cap the RAW value inside buildCloseEvent; trim only a
  // throwaway copy for this function's own emptiness check) let a >=301-char run of leading whitespace
  // followed by real text PASS the check (the raw value's own .trim() was non-empty) but then get capped
  // down to 300 pure-whitespace characters before ever reaching storage -- silently discarding the real text
  // the check had just approved. Trimming first and passing the already-trimmed string into buildCloseEvent
  // closes that gap: the cap now applies to real content, never to raw leading padding. (An entirely
  // whitespace --reason was already rejected at any length by the pre-existing emptiness check regardless of
  // this ordering -- trim of an all-whitespace string is always "" no matter how long the string is -- so
  // this reordering does not change that case; it only fixes the leading-padding-plus-real-text corruption.)
  const rawReason = get("--reason", "");
  const reason = rawReason.trim();
  if (!ref || !SHA_RE.test(ref) || !VALID_AS.includes(as) || !reason || KNOWN_FLAGS.includes(reason)) {
    process.stderr.write(
      "ctide-reconcile: close requires --ref <head-sha>, --as one of " + VALID_AS.join("|") +
      ", and a non-empty --reason — nothing written\n",
    );
    return;
  }
  const event = buildCloseEvent({ ts: now, ref, as, reason });
  const ok = appendClose(cwd, event);
  if (ok) process.stdout.write("ctide-reconcile: closed " + ref + " as " + as + "\n");
  else process.stderr.write("ctide-reconcile: close failed (fs error) — no event written\n");
}

// APPEND-ONLY, and the ONE subcommand allowed to auto-close without a human-supplied reason — but ONLY for
// runs classified exactly "expire-candidate" (past-window AND no overlap detected at all). A run with any
// detected overlap — even a "needs human review" one — is never touched here.
function runExpire(cwd, now) {
  if (!gitAvailable(cwd)) {
    process.stdout.write("ctide-reconcile: no git history available — expire produced no closures\n");
    return;
  }
  const records = readRunsLedger(readLedgerFile(cwd));
  const runs = runRecords(records);
  const closed = closedHeadSet(records);
  const pending = runs.filter((r) => !closed.has(r.head));
  let count = 0;
  for (const record of pending) {
    const commits = commitsSince(cwd, record.ts);
    const c = classifyRun(record, commits, now);
    if (c.status !== "expire-candidate") continue;
    const event = buildCloseEvent({
      ts: now, ref: record.head, as: "survived", reason: "window expired with no detected overlap",
    });
    if (appendClose(cwd, event)) count++;
  }
  process.stdout.write("ctide-reconcile: expired " + count + " run(s) (survived — window closed, no overlap detected)\n");
}

// --- CLI -----------------------------------------------------------------------------------------------

const MODES = ["scan", "close", "expire"];

function main(argv) {
  const args = argv.slice(2);
  const mode = args[0];
  const rest = args.slice(1);
  // The one shared flag-value lookup EVERY flag in this file goes through. Guards the swallow at its
  // single root: if the token immediately following `flag` is itself one of KNOWN_FLAGS (this file's own
  // complete recognized-flag set, above), the value is treated as omitted -- `def` is returned instead of
  // the neighboring flag's own name. Fixes every flag uniformly, not per-call-site.
  const get = (flag, def) => {
    const i = rest.indexOf(flag);
    const v = i >= 0 ? rest[i + 1] : undefined;
    return v && !KNOWN_FLAGS.includes(v) ? v : def;
  };
  if (!MODES.includes(mode)) {
    process.stderr.write(
      "ctide-reconcile: usage: node ${CLAUDE_PLUGIN_ROOT}/skills/vigil/scripts/run-reconcile.mjs <scan|close|expire> [--cwd <dir>] [--now <epoch-ms>] (close also needs --ref <sha> --as <escaped|survived|superseded|building-upon> --reason <text>)\n",
    );
    process.exit(0);
  }
  try {
    const cwd = get("--cwd", process.env.CLAUDE_PROJECT_DIR || process.cwd());
    const nowRaw = parseInt(get("--now", ""), 10);
    const now = Number.isFinite(nowRaw) ? nowRaw : Date.now();
    if (mode === "scan") runScan(cwd, now);
    else if (mode === "close") runClose(cwd, now, get);
    else runExpire(cwd, now);
  } catch (e) {
    process.stderr.write("ctide-reconcile: unexpected error — " + (e && e.message ? e.message : e) + "\n");
  }
  process.exit(0);
}

// isInvokedDirectly() kept in sync with the other 13 CLI entry points (documented copy — see garden hash guard)
function isInvokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isInvokedDirectly()) main(process.argv);
