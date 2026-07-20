// Tests for the data-driven consolidation feedback loop: failure-retrieve.mjs --log records retrieval
// hits to a sibling append-only ledger, and failure-consolidate.mjs aggregates that usage into a prune
// advisory (retired = delete; dated + old + never-matched = expire candidate). The honesty guards — no
// usage data => no staleness claim, insufficient history => no claim, undated/too-new never flagged — are
// the load-bearing behavior, so they are pinned hardest. All deterministic, no model.
import { test } from "node:test";
import assert from "node:assert";
import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLedgerLines, retrieve, defaultLedgerPath, ledgerKey } from "../cressetide/skills/vigil/scripts/failure-retrieve.mjs";
import { readLedger, consolidationReport, formatReport, KNOWN_FLAGS } from "../cressetide/skills/vigil/scripts/failure-consolidate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RETRIEVE = path.join(root, "cressetide", "skills", "vigil", "scripts", "failure-retrieve.mjs");
const CONSOLIDATE = path.join(root, "cressetide", "skills", "vigil", "scripts", "failure-consolidate.mjs");
const DAY = 86400000;

// A small memory file: one dated+live entry, one OLD live entry, one retired entry.
const MEM = `# FM

### 2026-06-25 — fresh node ci lesson
- **Prevention rule**: r.
- **Tags**: node / ci.

### 2026-01-01 — old python lesson
- **Prevention rule**: r.
- **Tags**: python / functions.

### 2025-12-01 — retired go lesson (superseded by 2026-06-01)
- **Prevention rule**: r.
- **Tags**: go / maps.
`;
const { parseEntries } = await import("../cressetide/skills/vigil/scripts/failure-retrieve.mjs");

// --- buildLedgerLines (the recording side) ---

test("buildLedgerLines emits one parseable record per surfaced entry with key, ts, truncated query", () => {
  const matches = retrieve(MEM, "node ci", { top: 5 });
  const lines = buildLedgerLines(matches, { query: "node ci jsdom", now: 1000, session: "s1" });
  assert.strictEqual(lines.length, matches.length);
  const rec = JSON.parse(lines[0]);
  assert.match(rec.key, /fresh node ci lesson/);
  assert.strictEqual(rec.ts, 1000);
  assert.strictEqual(rec.sid, "s1");
});

test("buildLedgerLines omits the session field when none is given", () => {
  const [line] = buildLedgerLines(retrieve(MEM, "node ci", { top: 1 }), { query: "q", now: 1 });
  assert.strictEqual(JSON.parse(line).sid, undefined);
});

// --- readLedger (the reading side) ---

test("readLedger keeps valid records and skips blank / unparseable / keyless lines", () => {
  const text = [
    JSON.stringify({ ts: 5, key: "a" }),
    "",
    "not json {{{",
    JSON.stringify({ ts: 9 }),            // no key -> skip
    JSON.stringify({ key: "b" }),         // no ts -> skip
    JSON.stringify({ ts: 7, key: "c" }),
  ].join("\n");
  const r = readLedger(text);
  assert.deepStrictEqual(r.map((x) => x.key), ["a", "c"]);
});

test("readLedger is null/empty tolerant", () => {
  assert.deepStrictEqual(readLedger(""), []);
  assert.deepStrictEqual(readLedger(null), []);
});

// --- consolidationReport honesty guards ---

const NOW = Date.UTC(2026, 5, 30); // 2026-06-30
const entries = parseEntries(MEM);

test("report flags a retired entry as a delete candidate regardless of usage", () => {
  const rep = consolidationReport(entries, [], { now: NOW, staleDays: 60 });
  assert.ok(rep.retired.some((k) => /retired go lesson/.test(k)), "retired entry listed");
});

test("EMPTY ledger makes NO staleness claim (never expire-everything)", () => {
  const rep = consolidationReport(entries, [], { now: NOW, staleDays: 60 });
  assert.deepStrictEqual(rep.expireCandidates, [], "no expire candidates without usage data");
  assert.match(rep.staleClaim, /no usage data/i);
});

test("insufficient ledger history makes NO staleness claim", () => {
  // Only 3 days of history, but a 60-day window — cannot honestly say a 6-month-old entry was unhit for 60d.
  const records = [{ ts: NOW - 1 * DAY, key: "x" }, { ts: NOW - 3 * DAY, key: "y" }];
  const rep = consolidationReport(entries, records, { now: NOW, staleDays: 60 });
  assert.deepStrictEqual(rep.expireCandidates, []);
  assert.match(rep.staleClaim, /shorter than the 60d window/);
});

test("with sufficient history, an old never-matched dated entry becomes an expire candidate; a recently-matched one does not", () => {
  // 90 days of history (>= the 60d window). The fresh node entry is matched in-window; the old python
  // entry never is. Only the old, dated, unhit entry is flagged.
  const records = [
    { ts: NOW - 90 * DAY, key: "seed-old-history" },            // establishes >=60d ledger span
    { ts: NOW - 2 * DAY, key: "2026-06-25 — fresh node ci lesson" }, // fresh entry matched recently
  ];
  const rep = consolidationReport(entries, records, { now: NOW, staleDays: 60 });
  assert.strictEqual(rep.staleClaim, "ok");
  const expired = rep.expireCandidates.map((c) => c.key);
  assert.ok(expired.some((k) => /old python lesson/.test(k)), "old unhit entry flagged");
  assert.ok(!expired.some((k) => /fresh node ci lesson/.test(k)), "recently-matched entry NOT flagged");
  assert.ok(!expired.some((k) => /retired go lesson/.test(k)), "retired entry is in retired[], not expireCandidates");
});

test("a too-new entry is never an expire candidate even with long history and no hits", () => {
  // Memory with only a brand-new entry; long ledger history but no hit for it. Age < staleDays => skip.
  const fresh = `# FM\n\n### 2026-06-29 — brand new\n- **Tags**: x.\n`;
  const records = [{ ts: NOW - 90 * DAY, key: "old-history" }];
  const rep = consolidationReport(parseEntries(fresh), records, { now: NOW, staleDays: 60 });
  assert.deepStrictEqual(rep.expireCandidates, [], "an entry younger than the window must not be flagged");
});

test("A5: an old long-titled entry with a recent hit logged under the truncated key stays active (not expired)", () => {
  // The ledger key is ledgerKey(title) = title.slice(0,300) (a shared single source of truth). If
  // consolidate looked up hits by the FULL title, a >300-char title's hits would never match and the
  // old entry would be wrongly flagged for expiry. Build a dated, old entry with a >300-char title, log
  // a recent hit under the truncated key, and assert it is active (hitDays > 0) and NOT an expire candidate.
  const longTitleText = "stale lesson " + "padding ".repeat(45); // > 300 chars total
  const mem = `# FM\n\n### 2026-01-01 — ${longTitleText}\n- **Prevention rule**: r.\n- **Tags**: node.\n`;
  const ents = parseEntries(mem);
  assert.ok(ents[0].title.length > 300, "the title must exceed the 300-char key bound for this test to bite");
  const records = [
    { ts: NOW - 90 * DAY, key: "seed-old-history" },   // establishes >=60d ledger span (sufficient history)
    { ts: NOW - 2 * DAY, key: ledgerKey(ents[0].title) }, // a recent hit, logged under the TRUNCATED key
  ];
  const rep = consolidationReport(ents, records, { now: NOW, staleDays: 60 });
  assert.strictEqual(rep.staleClaim, "ok");
  assert.ok(rep.active.some((a) => a.key === ents[0].title && a.hitDays > 0), "the long-titled entry is active");
  assert.ok(!rep.expireCandidates.some((c) => c.key === ents[0].title),
    "a hit under the truncated key must keep the entry OUT of expireCandidates");
});

test("formatReport states it is advisory-only and never modifies the file", () => {
  const out = formatReport(consolidationReport(entries, [], { now: NOW, staleDays: 60 }));
  assert.match(out, /advisory only/i);
  assert.match(out, /single writer/i);
  assert.match(out, /modifies nothing/i);
});

// --- end-to-end: retrieve --log writes the ledger, consolidate reads it ---

test("round-trip: retrieve --log appends the sibling ledger; the memory file is never modified", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-fc-"));
  try {
    const memDir = path.join(dir, "ai");
    fs.mkdirSync(memDir);
    const memFile = path.join(memDir, "FAILURE_MEMORY.md");
    fs.writeFileSync(memFile, MEM, "utf8");
    const before = fs.readFileSync(memFile, "utf8");

    cp.execFileSync("node", [RETRIEVE, "--file", memFile, "--query", "node ci jsdom", "--log"]);

    const ledger = defaultLedgerPath(memFile);
    assert.ok(fs.existsSync(ledger), "ledger created next to the memory file");
    const recs = readLedger(fs.readFileSync(ledger, "utf8"));
    assert.ok(recs.some((r) => /fresh node ci lesson/.test(r.key)), "the matched entry was logged");
    assert.strictEqual(fs.readFileSync(memFile, "utf8"), before, "the memory file must be untouched");

    const out = cp.execFileSync("node", [CONSOLIDATE, "--file", memFile]).toString();
    assert.match(out, /failure-consolidate/);
    assert.match(out, /retired — delete on next write: .*retired go lesson/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a bare retrieve (no --log) writes NO ledger (pure read by default)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-fc2-"));
  try {
    const memFile = path.join(dir, "FAILURE_MEMORY.md");
    fs.writeFileSync(memFile, MEM, "utf8");
    cp.execFileSync("node", [RETRIEVE, "--file", memFile, "--query", "node ci"]);
    assert.ok(!fs.existsSync(defaultLedgerPath(memFile)), "no ledger without --log");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- e2e: failure-consolidate whole-class flag-swallow guard (get() itself now guards EVERY flag in this
// file's own KNOWN_FLAGS -- the same shared-mechanism fix run-reconcile.mjs / run-ledger.mjs apply over
// their own flag sets) ---

test("failure-consolidate: for EVERY flag in KNOWN_FLAGS, a value slot occupied by any OTHER known flag's own name is treated as omitted, never as a literal value -- --file falls back to resolveMemoryFile(--cwd) (finds the seeded memory file's retired entry, not a bogus nonexistent '<flag-name>'-shaped file), and --cwd/--ledger/--stale's swallow never breaks the retired-entry report either", () => {
  const RETIRED_TITLE_RE = /retired go lesson/;
  const values = { "--ledger": "irrelevant-nonexistent-ledger.jsonl", "--stale": "60" };
  for (const F of KNOWN_FLAGS) {
    for (const G of KNOWN_FLAGS) {
      if (G === F) continue;
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-fc-swallow-"));
      try {
        fs.mkdirSync(path.join(dir, ".ctide", "memory"), { recursive: true });
        const memFile = path.join(dir, ".ctide", "memory", "FAILURE_MEMORY.md");
        fs.writeFileSync(memFile, MEM, "utf8"); // MEM's 3rd entry is retired ("retired go lesson")
        values["--file"] = memFile;

        // Order: G's own legitimate occurrence FIRST, then every other flag, then F LAST with its value
        // slot occupied by the literal token G (mirrors run-reconcile.test.mjs's / run-ledger.test.mjs's
        // identical loop-test ordering discipline -- keeps every flag's `indexOf` lookup unambiguous).
        const order = [G, ...KNOWN_FLAGS.filter((x) => x !== F && x !== G), F];
        const argv = [];
        for (const flagName of order) {
          if (flagName === F) argv.push(F, G); // F's own value slot swallowed by G's literal name
          else if (flagName === "--cwd") argv.push("--cwd", dir);
          else argv.push(flagName, values[flagName]);
        }
        // Hermetic: strip CLAUDE_PROJECT_DIR so --cwd's fallback resolves to the spawned process's own cwd
        // (this temp dir), never a developer's ambient project dir.
        const env = { ...process.env };
        delete env.CLAUDE_PROJECT_DIR;
        const r = cp.spawnSync("node", [CONSOLIDATE, ...argv], { cwd: dir, encoding: "utf8", env });
        assert.strictEqual(r.status, 0, `${F} swallowed by ${G} must still exit 0 (fail-open): ${r.stderr}`);
        assert.match(r.stdout, /retired — delete on next write:/,
          `${F} swallowed by ${G}: the memory file must still resolve (never a bogus '${G}'-shaped path/value)`);
        assert.match(r.stdout, RETIRED_TITLE_RE,
          `${F} swallowed by ${G}: the seeded retired entry must still be named`);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  }
});
