#!/usr/bin/env node
// ctide failure-consolidate: deterministic, data-driven consolidation advisory for a FAILURE_MEMORY.md.
// Closes the feedback loop — `failure-retrieve.mjs --log` records which entries a real task signature
// matched (a sibling append-only ledger), and this helper aggregates that usage into a prune report:
// which entries are RETIRED (delete on the next write) and which are stale EXPIRE CANDIDATES (dated, old
// enough, and never matched within the window). It is ADVISORY only — like contract-check.mjs, it hands
// evidence to the arbiter, which decides the edits; the main thread (the single writer) applies them
// after the verdict. It never modifies the memory file or the ledger. Dependency-free, fail-open: no
// ledger / no usage data => no staleness claim, exit 0.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEntries, resolveMemoryFile, defaultLedgerPath, ledgerKey } from "./failure-retrieve.mjs";

const DAY_MS = 86400000;
const DEFAULT_STALE_DAYS = 60;
const MAX_READ = 4 * 1024 * 1024; // cap ledger reads; a runaway log must not blow up the helper

// Parse the JSONL usage ledger into {ts, key} records; silently skip blank / unparseable / keyless lines
// (a corrupt line must not sink the aggregate). Returns [] for empty / null input (fail-open).
export function readLedger(text) {
  const out = [];
  for (const line of String(text == null ? "" : text).split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    try {
      const r = JSON.parse(s);
      if (r && typeof r.key === "string" && Number.isFinite(r.ts)) out.push({ ts: r.ts, key: r.key });
    } catch (e) {}
  }
  return out;
}

const dayKeyOf = (ts) => new Date(ts).toISOString().slice(0, 10);

// Age of a dated entry in days (now - entry date). null for an undated entry (date ordinal 0), so the
// caller can refuse to make a staleness claim it cannot justify.
function entryAgeDays(dateOrdinal, now) {
  if (!dateOrdinal) return null;
  const y = Math.floor(dateOrdinal / 10000), m = Math.floor((dateOrdinal % 10000) / 100), d = dateOrdinal % 100;
  const ms = Date.UTC(y, m - 1, d);
  return (now - ms) / DAY_MS;
}

// Build the consolidation advisory. Staleness is claimed ONLY when it is honest to do so:
//   - there is usage data at all (an empty ledger never means "expire everything"), AND
//   - the ledger spans >= staleDays (enough history for "0 hits in the window" to be meaningful), AND
//   - the entry is dated and itself older than staleDays (a 10-day-old entry cannot be unhit for 60 days).
// An entry clearing all of that with zero distinct hit-days in the window is an expire candidate. Retired
// (expired/superseded) entries are always delete candidates regardless of usage.
export function consolidationReport(entries, records, opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : 0;
  const staleDays = Number.isFinite(opts.staleDays) && opts.staleDays > 0 ? opts.staleDays : DEFAULT_STALE_DAYS;
  const live = entries.filter((e) => !e.placeholder);
  const retired = live.filter((e) => e.retired).map((e) => e.title);

  const windowStart = now - staleDays * DAY_MS;
  const hitDaysByKey = new Map();
  let minTs = Infinity;
  for (const r of records) {
    if (r.ts < minTs) minTs = r.ts;
    if (r.ts < windowStart) continue;
    let set = hitDaysByKey.get(r.key);
    if (!set) { set = new Set(); hitDaysByKey.set(r.key, set); }
    set.add(dayKeyOf(r.ts));
  }
  const hitDays = (key) => (hitDaysByKey.get(key) ? hitDaysByKey.get(key).size : 0);

  const hasUsageData = records.length > 0;
  const ledgerSpanDays = hasUsageData ? (now - minTs) / DAY_MS : 0;
  const sufficientHistory = hasUsageData && ledgerSpanDays >= staleDays;

  const active = [];
  const expireCandidates = [];
  for (const e of live) {
    if (e.retired) continue;
    const hd = hitDays(ledgerKey(e.title));
    if (hd > 0) { active.push({ key: e.title, hitDays: hd }); continue; }
    const age = entryAgeDays(e.date, now);
    if (sufficientHistory && age != null && age >= staleDays) {
      expireCandidates.push({ key: e.title, ageDays: Math.floor(age) });
    }
  }

  let claim = "ok";
  if (!hasUsageData) claim = "no usage data recorded yet (run failure-retrieve.mjs --log during planning) — no staleness claim";
  else if (!sufficientHistory) claim = "ledger history (" + Math.floor(ledgerSpanDays) + "d) shorter than the " + staleDays + "d window — no staleness claim yet";

  return {
    total: live.length,
    retired,
    active,
    expireCandidates,
    staleDays,
    staleClaim: claim,
  };
}

// One compact, LLM-readable advisory for the arbiter. States plainly that the arbiter decides and
// the main thread makes the edits (single writer), and that this report changes nothing on disk.
export function formatReport(report) {
  const lines = ["ctide failure-consolidate (deterministic advisory):"];
  lines.push("  entries: " + report.total + " (" + report.active.length + " matched in window, " + report.retired.length + " retired)");
  lines.push(report.retired.length
    ? "  retired — delete on next write: " + report.retired.join("; ")
    : "  retired: none");
  if (report.staleClaim !== "ok") {
    lines.push("  expire candidates: " + report.staleClaim);
  } else {
    lines.push(report.expireCandidates.length
      ? "  expire candidates (dated, >=" + report.staleDays + "d old, 0 retrieval hits in window): " +
        report.expireCandidates.map((c) => c.key + " (" + c.ageDays + "d)").join("; ")
      : "  expire candidates: none (every aged entry was matched within the window)");
  }
  lines.push("  note: advisory only — the main thread makes the actual edits from the arbiter's decision (single writer); this report modifies nothing.");
  return lines.join("\n");
}

function readCapped(file) {
  try {
    const size = fs.statSync(file).size;
    if (size <= MAX_READ) return fs.readFileSync(file, "utf8");
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(MAX_READ);
      // Read the TAIL of an oversized ledger (newest events) — that is what the window cares about.
      const n = fs.readSync(fd, buf, 0, MAX_READ, Math.max(0, size - MAX_READ));
      return buf.toString("utf8", 0, n);
    } finally { try { fs.closeSync(fd); } catch (e) {} }
  } catch (e) { return ""; }
}

function main(argv) {
  const args = argv.slice(2);
  const get = (flag, def) => { const i = args.indexOf(flag); return (i >= 0 && args[i + 1]) ? args[i + 1] : def; };
  const cwd = get("--cwd", process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const file = get("--file", "") || resolveMemoryFile(cwd);
  if (!file) {
    process.stdout.write("ctide failure-consolidate: no FAILURE_MEMORY.md found — nothing to consolidate.\n");
    process.exit(0);
  }
  const ledgerPath = get("--ledger", "") || defaultLedgerPath(file);
  const entries = parseEntries(readCapped(file));
  const records = readLedger(readCapped(ledgerPath));
  const staleDays = parseInt(get("--stale", String(DEFAULT_STALE_DAYS)), 10);
  const report = consolidationReport(entries, records, { now: Date.now(), staleDays });
  process.stdout.write(formatReport(report) + "\n");
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv);
