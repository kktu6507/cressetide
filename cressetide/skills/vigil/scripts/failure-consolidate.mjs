#!/usr/bin/env node
// ctide failure-consolidate: deterministic, data-driven consolidation advisory for a FAILURE_MEMORY.md.
// Closes the feedback loop — `failure-retrieve.mjs --log` records which entries a real task signature
// matched (a sibling append-only ledger), and this helper aggregates that usage into a prune report:
// which entries are RETIRED (delete on the next write) and which are stale EXPIRE CANDIDATES (dated, old
// enough, and never matched within the window). It also surfaces TAG RECURRENCE CANDIDATES: pairs of
// live entries whose Tags field overlaps by >= 2 tokens -- a structural/cumulative signal (no ledger, no
// time window, unlike the staleness claim above) that two entries may share the same underlying
// lesson-shape. It is ADVISORY only — like contract-check.mjs, it hands evidence to the arbiter, which
// decides the edits; the main thread (the single writer) applies them after the verdict. It never
// modifies the memory file or the ledger. Dependency-free, fail-open: no ledger / no usage data => no
// staleness claim, exit 0.
import { isMain, parseCli } from "../../../lib/cli.mjs";
import { readCapped } from "../../../lib/read-capped.mjs";
import { parseEntries, resolveMemoryFile, defaultLedgerPath, ledgerKey } from "./failure-retrieve.mjs";

const DAY_MS = 86400000;
const DEFAULT_STALE_DAYS = 60;
// Cap the memory-file and ledger reads; a runaway log must not blow up the helper. The read keeps the
// TAIL of an oversized file (the newest events) — that is what the window cares about. Any read error
// reads as "" (fail-open).
const MAX_READ = 4 * 1024 * 1024;

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
// doctor.mjs's --project check also imports this (dynamically; see that file's own header comment).
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

// Parse a raw `Tags` field into a trimmed, lowercased token Set, split on the template's `/` delimiter.
// Lowercasing keeps a curator's casing drift (e.g. "Node / CI" on one entry, "node / ci" on another) from
// silently hiding a real overlap -- cheap hardening; every tag in the current global FAILURE_MEMORY.md is
// already lowercase, so this changes no live comparison today. Deliberately NOT entry.tagTokens (that's
// tokenize()'s generic word-split, used for failure-retrieve.mjs's relevance scoring, which would shatter
// a multi-word tag like "point-patch-non-convergence" into separate dash-split words) -- tag recurrence
// needs exact-token comparison over the curated, already-structured Tags line, never a guess about
// markdown formatting variants.
function tagSet(tagsField) {
  const out = new Set();
  for (const raw of String(tagsField || "").split("/")) {
    const t = raw.trim().toLowerCase();
    if (t) out.add(t);
  }
  return out;
}

// Do two entries share a lesson-shape, not just an incidental single tag? For every DISTINCT pair of
// live, non-retired entries, a pair qualifies when its tag-set intersection has >= 2 tokens -- a single
// shared tag (e.g. both entries merely tagged `node`) is expected noise; the motivating real examples
// shared 3 tags at once. Reports EVERY qualifying pair independently, the first time it qualifies: no
// transitive clustering (A-B and B-C qualifying independently never fuse into an A-B-C group), no time
// window (a structural/cumulative fact, unlike consolidationReport's ledger-based staleness claim above,
// which needs a recency window to be honest), and no separate occurrence-count gate on top of the
// >=2-tag threshold (that threshold already does the noise-reduction job a count gate would otherwise
// exist for). An entry with an empty/malformed Tags field naturally falls out of pairing on its own (its
// tag Set is empty, so no intersection can ever reach size 2) -- no special-case skip needed. Pure
// function, no side effects.
export function tagRecurrenceCandidates(entries) {
  const live = entries.filter((e) => !e.placeholder); // mirrors consolidationReport's own live[] pool
  const pool = live.filter((e) => !e.retired); // a retired entry never pairs, same exclusion consolidationReport's active/expireCandidates loop applies
  const tagged = pool.map((e) => ({ title: e.title, tags: tagSet(e.tags) }));
  const candidates = [];
  for (let i = 0; i < tagged.length; i++) {
    for (let j = i + 1; j < tagged.length; j++) {
      const shared = [...tagged[i].tags].filter((t) => tagged[j].tags.has(t));
      if (shared.length >= 2) candidates.push({ titleA: tagged[i].title, titleB: tagged[j].title, sharedTags: shared });
    }
  }
  return candidates;
}

// One compact, LLM-readable advisory for the arbiter. States plainly that the arbiter decides and
// the main thread makes the edits (single writer), and that this report changes nothing on disk.
export function formatReport(report, tagCandidates = []) {
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
  if (tagCandidates.length) {
    lines.push("  tag recurrence candidates (2+ entries sharing 2+ tags):");
    for (const c of tagCandidates) {
      lines.push("    \"" + c.titleA + "\" <-> \"" + c.titleB + "\" — shared: " + c.sharedTags.join(", "));
    }
  } else {
    lines.push("  tag recurrence candidates: none");
  }
  lines.push("  note: advisory only — the main thread makes the actual edits from the arbiter's decision (single writer); this report modifies nothing.");
  return lines.join("\n");
}

const USAGE = "failure-consolidate.mjs [--cwd DIR] [--file PATH] [--ledger PATH] [--stale DAYS]";
const CLI_OPTIONS = { cwd: { type: "string" }, file: { type: "string" }, ledger: { type: "string" }, stale: { type: "string" } };
const readTail = (file) => readCapped(file, { cap: MAX_READ, from: "tail", onError: "empty" });

function main(args) {
  const parsed = parseCli(args, { options: CLI_OPTIONS });
  if (parsed.error) {
    // A usage error reads nothing: one line on stderr, an explicit no-claim on stdout.
    process.stderr.write(`failure-consolidate: ${parsed.error.replace(/\s+/g, " ")} (usage: ${USAGE})\n`);
    process.stdout.write("ctide failure-consolidate: no claim — the command line could not be parsed, so nothing was read; this report modifies nothing.\n");
    process.exit(0);
  }
  const { values } = parsed;
  const cwd = values.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const file = values.file || resolveMemoryFile(cwd);
  if (!file) {
    process.stdout.write("ctide failure-consolidate: no FAILURE_MEMORY.md found — nothing to consolidate.\n");
    process.exit(0);
  }
  const ledgerPath = values.ledger || defaultLedgerPath(file);
  const entries = parseEntries(readTail(file));
  const records = readLedger(readTail(ledgerPath));
  const staleDays = parseInt(values.stale || String(DEFAULT_STALE_DAYS), 10);
  const report = consolidationReport(entries, records, { now: Date.now(), staleDays });
  const tagCandidates = tagRecurrenceCandidates(entries);
  process.stdout.write(formatReport(report, tagCandidates) + "\n");
  process.exit(0);
}

if (isMain(import.meta.url)) main(process.argv.slice(2));
