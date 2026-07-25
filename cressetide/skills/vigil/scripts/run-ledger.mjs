#!/usr/bin/env node
// ctide run-ledger: append-only local event ledger for vigil runs (.ctide/ledger/runs.jsonl).
// Session-time helper (NOT a Claude Code hook, NOT CI-only): the orchestrator appends one `run` record
// after a run's verdict is locked (facts derived from artifacts — git base/head/files, and the run's own
// machine sentinels for verdict/verify/panel — never a freehand agent claim). run-reconcile.mjs later
// appends `close` events to the SAME file as runs are disposed (escaped/survived/superseded/building-upon);
// run-consolidate.mjs reads both to compute on-demand counts. Nothing here stores a rate, score, or
// percentage — only event facts (see references/run-ledger.md for the schema and lifecycle).
//
// Dependency-free (Node built-ins only). Fail-open: every write path swallows fs/git errors and reports a
// boolean/[] rather than throwing; the CLI always exits 0 and never throws to its caller. Exposes pure
// functions (buildRunRecord / buildCloseEvent / readRunsLedger) and thin I/O helpers (ledgerDir /
// runsLedgerPath / ensureLedgerDir / filesTouched / appendRun / appendClose) for run-reconcile.mjs,
// run-consolidate.mjs, and the test suite — one shared definition, not per-file copies (the
// failure-retrieve.mjs / failure-consolidate.mjs sibling-reader convention). main() wraps the CLI under the
// import.meta.url guard.
import fs from "node:fs";
import path from "node:path";
import cp from "node:child_process";
import { fileURLToPath } from "node:url";

// --- paths -------------------------------------------------------------------------------------------

export function ledgerDir(cwd) { return path.join(cwd, ".ctide", "ledger"); }
export function runsLedgerPath(cwd) { return path.join(ledgerDir(cwd), "runs.jsonl"); }

// Create the ledger directory (idempotent) and, if absent, its own nested .gitignore — the SAME
// footgun-guard trick `.ctide/output/.gitignore` uses: ignore the whole directory except the gitignore
// file itself, so this untracked-but-persistent state class is never accidentally committed even in a
// consuming project that has not (or not yet) gitignored `.ctide/` at the root. Not fail-open on its own
// (callers wrap it) — a caller that needs the directory to exist should see a real error if it cannot.
export function ensureLedgerDir(cwd) {
  const dir = ledgerDir(cwd);
  fs.mkdirSync(dir, { recursive: true });
  const gi = path.join(dir, ".gitignore");
  if (!fs.existsSync(gi)) fs.writeFileSync(gi, "*\n!.gitignore\n", "utf8");
}

// --- tolerant JSONL read -------------------------------------------------------------------------------

// Parse each non-blank line as JSON; a JSON.parse throw OR a parsed value with no `type` key is silently
// skipped (mirrors failure-consolidate.mjs's readLedger tolerance exactly — one corrupt line must never
// sink the whole ledger). Returns the mix of `type:"run"` and `type:"close"` records found, in file order.
export function readRunsLedger(text) {
  const out = [];
  for (const line of String(text == null ? "" : text).split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    try {
      const r = JSON.parse(s);
      if (r && typeof r === "object" && r.type !== undefined) out.push(r);
    } catch (e) {}
  }
  return out;
}

// --- git-derived facts ---------------------------------------------------------------------------------

// Changed paths from `git diff --name-only <base>` (or HEAD when base is absent/empty) — a FACT derived
// from the artifact, never agent-typed. Windows path normalization mirrors contract-check.mjs's own
// normalization: split on newline, trim, backslash -> forward slash, drop empties. Any error (non-git dir,
// git not found, unborn HEAD, etc.) swallows to [] — this must never throw to its caller.
export function filesTouched(cwd, base) {
  try {
    const args = base ? ["diff", "--name-only", base] : ["diff", "--name-only", "HEAD"];
    // stdio pipes BOTH stdout and stderr (map.mjs's own git() helper convention) — execFileSync otherwise
    // inherits stderr to the CALLING process by default, so a git failure's raw usage/error text would
    // leak straight onto this script's stderr instead of staying swallowed here.
    const out = cp.execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10000 });
    return out.split(/\r?\n/).map((l) => l.trim().replace(/\\/g, "/")).filter(Boolean);
  } catch (e) { return []; }
}

// --- pure record builders (no I/O, no Date.now() — the caller always supplies `ts`) ----------------------

// One `type:"run"` ledger record. Absent/undefined optional inputs become `null` (base, plannedRisk — both
// nullable-typed in the schema) or an empty array/string (everything else) — never guessed. Bounded caps:
// task <= 300 chars, each finding <= 150 chars, findings <= 20 entries, driftMap <= 300 chars,
// planned.paths <= 50 entries each <= 200 chars — so a pathological input can never bloat the ledger.
export function buildRunRecord(opts) {
  const o = opts || {};
  const ts = Number.isFinite(o.ts) ? o.ts : 0;
  const task = String(o.task == null ? "" : o.task).slice(0, 300);
  const base = (o.base == null || o.base === "") ? null : String(o.base);
  const head = o.head == null ? "" : String(o.head);
  const files = Array.isArray(o.files) ? o.files.map(String) : [];
  const verdict = o.verdict == null ? "" : String(o.verdict);
  const verify = o.verify == null ? "" : String(o.verify);
  const panel = o.panel == null ? "" : String(o.panel);
  const repairs = Number.isFinite(o.repairs) ? Math.max(0, Math.floor(o.repairs)) : 0;
  const findingsIn = Array.isArray(o.findings) ? o.findings : [];
  const findings = findingsIn.slice(0, 20).map((f) => String(f == null ? "" : f).slice(0, 150));
  const plannedPathsIn = Array.isArray(o.plannedPaths) ? o.plannedPaths : [];
  const plannedPaths = plannedPathsIn.slice(0, 50).map((p) => String(p == null ? "" : p).slice(0, 200));
  const plannedRisk = (o.plannedRisk == null || o.plannedRisk === "") ? null : String(o.plannedRisk);
  const driftOutOfScope = Number.isFinite(o.driftOutOfScope) ? Math.max(0, Math.floor(o.driftOutOfScope)) : 0;
  const driftMap = String(o.driftMap == null ? "" : o.driftMap).slice(0, 300);
  const windowDays = Number.isFinite(o.windowDays) && o.windowDays > 0 ? Math.floor(o.windowDays) : 14;
  return {
    v: 1,
    type: "run",
    ts,
    task,
    base,
    head,
    files,
    verdict,
    verify,
    panel,
    repairs,
    findings,
    planned: { paths: plannedPaths, risk: plannedRisk },
    drift: { outOfScope: driftOutOfScope, mapCorrections: driftMap },
    window: { days: windowDays, status: "open" },
  };
}

// One `type:"close"` ledger record — the disposition event run-reconcile.mjs appends when a prior run's
// `head` is later reconciled. Same capping discipline as buildRunRecord (reason <= 300 chars). Pure: the
// caller supplies `ref`/`as`/`reason`/`ts`; this never decides WHY a run is being closed, only shapes it.
export function buildCloseEvent(opts) {
  const o = opts || {};
  const ts = Number.isFinite(o.ts) ? o.ts : 0;
  const ref = o.ref == null ? "" : String(o.ref);
  const as = o.as == null ? "" : String(o.as);
  const reason = String(o.reason == null ? "" : o.reason).slice(0, 300);
  return { v: 1, type: "close", ts, ref, as, reason };
}

// --- append (fail-open) ---------------------------------------------------------------------------------

// Shared append mechanics for both record types: ensure the directory (+ its self-gitignore) exists; if
// the ledger file already exists and its last byte is not a newline, self-heal the truncated line first
// (a prior process could have been killed mid-write); then append the new JSON line. Swallows any fs
// error (fail-open) and reports success as a boolean the CLI can relay. Concurrent-append safety assumes
// each written line stays short enough to land under the OS's atomic-append boundary for one write() call
// (the same short-write assumption failure-retrieve.mjs's usage ledger already documents) -- true for
// every capped field (task/findings/driftMap/planned.paths) but not size-enforced on `files`, which
// tracks the real diff and can grow past it on an unusually large change.
function appendJsonLine(cwd, obj) {
  try {
    ensureLedgerDir(cwd);
    const file = runsLedgerPath(cwd);
    if (fs.existsSync(file)) {
      const existing = fs.readFileSync(file, "utf8");
      if (existing.length && !existing.endsWith("\n")) fs.appendFileSync(file, "\n");
    }
    fs.appendFileSync(file, JSON.stringify(obj) + "\n");
    return true;
  } catch (e) { return false; }
}

export function appendRun(cwd, record) { return appendJsonLine(cwd, record); }
export function appendClose(cwd, event) { return appendJsonLine(cwd, event); }

// --- CLI -------------------------------------------------------------------------------------------------

// `head` is always git-derived (rev-parse HEAD), never a caller-supplied flag; failure swallows to null.
function gitRevParseHead(cwd) {
  try {
    const out = cp.execFileSync(
      "git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10000 },
    ).trim();
    return out || null;
  } catch (e) { return null; }
}

function splitList(raw, sep) {
  return raw ? raw.split(sep).map((s) => s.trim()).filter(Boolean) : [];
}

// Enum/shape guards for the 3 machine-sentinel flags `append` copies verbatim from the run's own final
// report footer (references/final-report.md) -- mirrors run-reconcile.mjs's strict `close --as` rejection
// (never a free-form string silently coerced through, unlike every other flag here): an out-of-enum value
// is rejected without writing, not coerced or guessed.
const VALID_VERDICT = ["READY", "FIX REQUIRED", "NOT READY"];
const VALID_VERIFY = ["pass", "fail", "unrun", "na"];
const VALID_PANEL_RE = /^(full|substituted:.+)$/;

// Every flag token this file's `get()` closure is ever queried with (every `get("--...", ...)` call site in
// main() below -- the complete recognized-flag set of this CLI's parser). Exported so the test suite can
// drive the SAME list `get()` guards against (no hardcoded duplicate list to drift out of sync). `get()`
// itself (below) checks this list before ever returning `args[i + 1]` as a flag's value: when that next
// token is itself one of these names, the value is treated as omitted -- `get()` returns the flag's own
// default rather than swallowing the neighboring flag's name. Mirrors run-reconcile.mjs's identical
// KNOWN_FLAGS guard over its own (smaller) flag set -- each file guards its OWN complete list, not a list
// shared across files, because the two CLIs recognize different flags.
export const KNOWN_FLAGS = [
  "--task", "--base", "--verdict", "--verify", "--panel", "--repairs", "--findings", "--planned-paths",
  "--planned-risk", "--drift-outofscope", "--drift-map", "--window-days", "--cwd", "--now",
];

function main(argv) {
  const args = argv.slice(2);
  const sub = args[0];
  // The one shared flag-value lookup EVERY flag in this file goes through. Guards the swallow at its
  // single root: if the token immediately following `flag` is itself one of KNOWN_FLAGS (this file's own
  // complete recognized-flag set, above), the value is treated as omitted -- `def` is returned instead of
  // the neighboring flag's own name. Fixes every flag uniformly, not per-call-site (run-reconcile.mjs's
  // --ref/--reason point patches were the pattern this generalizes away from).
  const get = (flag, def) => {
    const i = args.indexOf(flag);
    const v = i >= 0 ? args[i + 1] : undefined;
    return v && !KNOWN_FLAGS.includes(v) ? v : def;
  };
  if (sub !== "append") {
    process.stderr.write(
      "ctide-ledger: usage: node ${CLAUDE_PLUGIN_ROOT}/skills/vigil/scripts/run-ledger.mjs append --task <text> [--base <sha>] --verdict <text> --verify <text> --panel <text> [--repairs <n>] [--findings \"a|||b\"] [--planned-paths \"g1,g2\"] [--planned-risk <high|medium|low>] [--drift-outofscope <n>] [--drift-map <text>] [--window-days <n>] [--cwd <dir>] [--now <epoch-ms>]\n",
    );
    process.exit(0);
  }
  try {
    const cwd = get("--cwd", process.env.CLAUDE_PROJECT_DIR || process.cwd());
    const nowRaw = parseInt(get("--now", ""), 10);
    const ts = Number.isFinite(nowRaw) ? nowRaw : Date.now();
    const base = get("--base", "") || null;
    const verdict = get("--verdict", "");
    const verify = get("--verify", "");
    const panel = get("--panel", "");
    if (!VALID_VERDICT.includes(verdict) || !VALID_VERIFY.includes(verify) || !VALID_PANEL_RE.test(panel)) {
      process.stderr.write(
        "ctide-ledger: append requires --verdict one of " + VALID_VERDICT.join("|") + ", --verify one of " +
        VALID_VERIFY.join("|") + ", and --panel matching full|substituted:<name> — nothing written\n",
      );
      process.exit(0);
    }
    const head = gitRevParseHead(cwd);
    const files = filesTouched(cwd, base);
    const record = buildRunRecord({
      ts,
      task: get("--task", ""),
      base,
      head,
      files,
      verdict,
      verify,
      panel,
      repairs: parseInt(get("--repairs", "0"), 10),
      findings: splitList(get("--findings", ""), "|||"),
      plannedPaths: splitList(get("--planned-paths", ""), ","),
      plannedRisk: get("--planned-risk", "") || null,
      driftOutOfScope: parseInt(get("--drift-outofscope", "0"), 10),
      driftMap: get("--drift-map", ""),
      windowDays: parseInt(get("--window-days", "14"), 10),
    });
    const ok = appendRun(cwd, record);
    if (ok) {
      process.stdout.write("ctide-ledger: appended " + (head || "(no head)") + " (" + files.length + " files)\n");
    } else {
      process.stderr.write("ctide-ledger: append failed (fs error) — no record written\n");
    }
  } catch (e) {
    process.stderr.write("ctide-ledger: unexpected error — " + (e && e.message ? e.message : e) + "\n");
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
