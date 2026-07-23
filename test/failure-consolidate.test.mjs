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
import { readLedger, consolidationReport, formatReport, tagRecurrenceCandidates, KNOWN_FLAGS } from "../cressetide/skills/vigil/scripts/failure-consolidate.mjs";

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

// --- tagRecurrenceCandidates: a structural/cumulative signal, independent of the ledger -- do two live
// entries' Tags fields overlap by >= 2 tokens? No time window (unlike expireCandidates' staleness
// claim), no transitive clustering (qualifying pairs are reported individually, never fused into a
// bigger cluster), no separate occurrence-count gate (the >=2-tag threshold already does that
// noise-reduction job). The six cases below are the design spec's own Testing section, verbatim. ---

test("tagRecurrenceCandidates: two entries sharing 2 tags report the pair with both shared tags", () => {
  const mem = `# FM

### 2026-05-01 — alpha lesson
- **Prevention rule**: r.
- **Tags**: node / ci / testing.

### 2026-05-02 — beta lesson
- **Prevention rule**: r.
- **Tags**: node / ci / docs.
`;
  const out = tagRecurrenceCandidates(parseEntries(mem));
  assert.strictEqual(out.length, 1, "exactly one qualifying pair");
  assert.match(out[0].titleA, /alpha lesson/);
  assert.match(out[0].titleB, /beta lesson/);
  assert.deepStrictEqual(out[0].sharedTags, ["node", "ci"]);
});

test("tagRecurrenceCandidates: two entries sharing only 1 tag do NOT report (noise-filter proof)", () => {
  // The load-bearing negative case: a single shared tag (e.g. both entries merely tagged `node`) is
  // expected noise, not signal -- asserted here as clearly as the positive cases above/below.
  const mem = `# FM

### 2026-05-01 — gamma solo
- **Prevention rule**: r.
- **Tags**: node.

### 2026-05-02 — delta solo
- **Prevention rule**: r.
- **Tags**: node / docs.
`;
  const out = tagRecurrenceCandidates(parseEntries(mem));
  assert.deepStrictEqual(out, [], "a single shared tag must NOT qualify as a candidate pair");
});

test("tagRecurrenceCandidates: a shared hyphenated multi-word tag reads as ONE tag via entry.tags, never shattered into words via entry.tagTokens (field-choice discrimination)", () => {
  // tagSet() MUST parse entry.tags (the raw, curated `Tags:` string, split on `/`) -- never
  // entry.tagTokens (failure-retrieve.mjs's generic word-tokenizer field, built by splitting on every
  // non-alphanumeric run, hyphens included). The two entries below share exactly ONE tag,
  // "point-patch-non-convergence", plus one different simple tag each. Under the correct `tags`
  // reading that is a 1-tag overlap -- below the >=2 threshold, so no candidate. If tagSet() were ever
  // regressed to read entry.tagTokens instead, the hyphenated tag would shatter into 4 identical tokens
  // ("point","patch","non","convergence") on both sides -- a false 4-token intersection that WOULD
  // cross the threshold and wrongly report a pair. Every existing fixture in this file uses single-word
  // tags, where the two fields happen to agree; only a multi-word tag exposes the bug.
  const mem = `# FM

### 2026-05-01 — xi lesson
- **Prevention rule**: r.
- **Tags**: point-patch-non-convergence / docs.

### 2026-05-02 — omicron lesson
- **Prevention rule**: r.
- **Tags**: point-patch-non-convergence / release.
`;
  const out = tagRecurrenceCandidates(parseEntries(mem));
  assert.deepStrictEqual(out, [],
    "a single shared multi-word tag (1 tag under the correct `tags` field) must not qualify -- a non-empty result here means tagSet() regressed to reading entry.tagTokens");
});

test("tagRecurrenceCandidates: two entries sharing 3 tags report the pair with all 3 shared tags", () => {
  const mem = `# FM

### 2026-05-01 — epsilon lesson
- **Prevention rule**: r.
- **Tags**: node / ci / docs.

### 2026-05-02 — zeta lesson
- **Prevention rule**: r.
- **Tags**: node / ci / docs.
`;
  const out = tagRecurrenceCandidates(parseEntries(mem));
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(out[0].sharedTags, ["node", "ci", "docs"], "all 3 shared tags listed, not just 2");
});

test("tagRecurrenceCandidates: a retired entry in an otherwise-qualifying pair does not count", () => {
  const mem = `# FM

### 2026-05-01 — eta lesson
- **Prevention rule**: r.
- **Tags**: node / ci.

### 2026-05-02 — theta lesson (superseded by 2026-06-01)
- **Prevention rule**: r.
- **Tags**: node / ci.
`;
  const ents = parseEntries(mem);
  assert.ok(ents[1].retired, "fixture sanity: the second entry must actually parse as retired");
  const out = tagRecurrenceCandidates(ents);
  assert.deepStrictEqual(out, [], "a retired entry must never form a candidate pair, even with a full tag overlap");
});

test("tagRecurrenceCandidates: the same tag across 3 entries forming 2 separate qualifying pairs reports both independently (no clustering)", () => {
  // iota<->kappa share {x,y}; kappa<->lambda share {x,z}; iota<->lambda share only {x} (1 tag, below
  // threshold). Both qualifying pairs must surface separately -- never fused into one iota-kappa-lambda
  // cluster.
  const mem = `# FM

### 2026-05-01 — iota lesson
- **Prevention rule**: r.
- **Tags**: x / y.

### 2026-05-02 — kappa lesson
- **Prevention rule**: r.
- **Tags**: x / y / z.

### 2026-05-03 — lambda lesson
- **Prevention rule**: r.
- **Tags**: x / z.
`;
  const out = tagRecurrenceCandidates(parseEntries(mem));
  assert.strictEqual(out.length, 2, "exactly two independent pairs, never fused into one 3-entry cluster");
  assert.ok(out.some((c) => /iota lesson/.test(c.titleA) && /kappa lesson/.test(c.titleB) && c.sharedTags.join(",") === "x,y"),
    "iota<->kappa shares x,y");
  assert.ok(out.some((c) => /kappa lesson/.test(c.titleA) && /lambda lesson/.test(c.titleB) && c.sharedTags.join(",") === "x,z"),
    "kappa<->lambda shares x,z");
  assert.ok(!out.some((c) => /iota lesson/.test(c.titleA) && /lambda lesson/.test(c.titleB)),
    "iota<->lambda shares only x (1 tag) -- must not qualify, and must not be implied by the other two pairs");
});

test("tagRecurrenceCandidates: tag comparison is case-insensitive -- 'Node / CI' and 'node / ci' correctly pair", () => {
  // tagSet() lowercases after trim so curator casing drift (one entry's Tags line written "Node / CI",
  // another's "node / ci") does not silently hide a real overlap. Pure hardening: every tag in the
  // current global FAILURE_MEMORY.md is already lowercase, so this fixes no observed miss today.
  const mem = `# FM

### 2026-05-01 — sigma lesson
- **Prevention rule**: r.
- **Tags**: Node / CI.

### 2026-05-02 — tau lesson
- **Prevention rule**: r.
- **Tags**: node / ci.
`;
  const out = tagRecurrenceCandidates(parseEntries(mem));
  assert.strictEqual(out.length, 1, "differently-cased but otherwise-identical tags must still pair");
  assert.deepStrictEqual(out[0].sharedTags, ["node", "ci"], "shared tags are reported in lowercase form");
});

test("tagRecurrenceCandidates: no entries share 2+ tags anywhere reports none", () => {
  // Reuses the top-of-file MEM fixture (node/ci, python/functions, go/maps -- zero pairwise overlap).
  const out = tagRecurrenceCandidates(entries);
  assert.deepStrictEqual(out, [], "MEM's three entries share no 2+ tag overlap anywhere");
  const rendered = formatReport(consolidationReport(entries, [], { now: NOW, staleDays: 60 }), out);
  assert.match(rendered, /tag recurrence candidates: none/);
});

test("formatReport includes the tag-recurrence block: 'none' when empty, one full line per pair when found", () => {
  const base = consolidationReport(entries, [], { now: NOW, staleDays: 60 });
  assert.match(formatReport(base, []), /tag recurrence candidates: none/);
  // A missing (not just empty-array) tagCandidates argument must default safely -- never render "undefined".
  assert.doesNotMatch(formatReport(base), /undefined/);

  const pairMem = `# FM

### 2026-05-01 — mu lesson
- **Tags**: node / ci / testing.

### 2026-05-02 — nu lesson
- **Tags**: node / ci / docs.
`;
  const pairEntries = parseEntries(pairMem);
  const out = formatReport(consolidationReport(pairEntries, [], { now: NOW, staleDays: 60 }), tagRecurrenceCandidates(pairEntries));
  assert.match(out, /tag recurrence candidates \(2\+ entries sharing 2\+ tags\):/);
  assert.ok(out.includes(`"${pairEntries[0].title}" <-> "${pairEntries[1].title}" — shared: node, ci`),
    "the exact pair line, with both shared tags, is present");
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

// --- e2e: failure-consolidate's own CLI wiring for tag recurrence (main() must actually call
// tagRecurrenceCandidates() and print its output through a REAL spawned process -- exporting the pure
// function is not enough on its own to prove main() uses it) ---

test("CLI e2e: a spawned failure-consolidate process actually prints the tag-recurrence header and pair line for a fixture with a real 2+-tag overlap", () => {
  // The two CLI-spawn tests above both use the top-of-file MEM fixture, which has ZERO pairwise 2+-tag
  // overlap -- so they pass byte-identical stdout even if tagRecurrenceCandidates() were removed from
  // main() entirely (a full revert of the wiring). This fixture's two entries DO share 2 tags, so an
  // unmodified, actually-spawned CLI process must print both the tag-recurrence header and the specific
  // pair line -- if main()'s wiring is ever dropped or broken, this goes red.
  const pairMem = `# FM

### 2026-05-01 — pi lesson
- **Prevention rule**: r.
- **Tags**: node / ci / testing.

### 2026-05-02 — rho lesson
- **Prevention rule**: r.
- **Tags**: node / ci / docs.
`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-fc-tagcli-"));
  try {
    const memFile = path.join(dir, "FAILURE_MEMORY.md");
    fs.writeFileSync(memFile, pairMem, "utf8");
    const out = cp.execFileSync("node", [CONSOLIDATE, "--file", memFile]).toString();
    assert.ok(out.includes("tag recurrence candidates (2+ entries sharing 2+ tags):"),
      "the tag-recurrence header must appear in real CLI stdout");
    const pairEntries = parseEntries(pairMem);
    assert.ok(out.includes(`"${pairEntries[0].title}" <-> "${pairEntries[1].title}" — shared: node, ci`),
      "the specific pair line, with both entries' titles and shared tags, must appear in real CLI stdout");
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
