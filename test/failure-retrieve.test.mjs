// Deterministic retrieval oracle for the failure-memory targeted-retrieval seam (scripts/failure-retrieve.mjs).
// Two layers: (1) unit tests pinning tokenize / parse / score / retrieve behavior and the fail-open
// contract; (2) the committed eval (eval/failure-memory/) — for each seeded lesson a task signature must
// rank it #1 and unrelated/retired lessons must not surface. This is the evidence that the mechanism
// actually surfaces the right lesson, runnable in CI (`npm test`) with no model. See eval/failure-memory/README.md.
import { test } from "node:test";
import assert from "node:assert";
import cp from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  tokenize, parseEntries, scoreEntry, retrieve, formatRetrieval, buildLedgerLines, ledgerKey, KNOWN_FLAGS,
} from "../cressetide/skills/vigil/scripts/failure-retrieve.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EVAL = path.join(root, "eval", "failure-memory");
const SCRIPT = path.join(root, "cressetide", "skills", "vigil", "scripts", "failure-retrieve.mjs");

// --- unit: tokenize ---

test("tokenize lowercases, splits on non-alphanumerics, drops stopwords and length-1 noise", () => {
  const t = tokenize("Build broke on Windows: dist/ + name.ts");
  assert.ok(t.has("build") && t.has("windows") && t.has("dist") && t.has("name") && t.has("ts"));
  assert.ok(!t.has("on"), "stopword dropped");
  assert.ok(!t.has("+"), "punctuation produces no token");
});

test("tokenize is null/garbage tolerant (returns an empty set)", () => {
  assert.strictEqual(tokenize(null).size, 0);
  assert.strictEqual(tokenize(undefined).size, 0);
  assert.strictEqual(tokenize("").size, 0);
});

// --- unit: parseEntries ---

const MEM = `# FM

### 2026-06-18 — jsdom missing in CI
- **Prevention rule**: declare test-only deps as devDependencies.
- **Tags**: node / dependencies / ci.
- **Recurrence**: seen again 2026-06-21.

### 2026-06-12 — hardcoded path separator
- **Prevention rule**: join paths via the platform API.
- **Tags**: cross-language / build / path.

### <YYYY-MM-DD> — <short title>
- **Tags**: x.

### 2026-05-30 — old async rule (superseded by 2026-06-24)
- **Prevention rule**: use for...of.
- **Tags**: javascript / async.
`;

test("parseEntries extracts title, tags, date, recurrence and flags placeholder/retired", () => {
  const e = parseEntries(MEM);
  assert.strictEqual(e.length, 4);
  const jsdom = e[0];
  assert.match(jsdom.title, /jsdom missing in CI/);
  assert.strictEqual(jsdom.date, 20260618);
  assert.strictEqual(jsdom.recurrence, 1, "one 'seen again' counted");
  assert.ok(jsdom.tagTokens.has("node") && jsdom.tagTokens.has("dependencies"));
  assert.ok(e.find((x) => x.placeholder), "template placeholder flagged");
  assert.ok(e.find((x) => x.retired && /async/.test(x.title)), "superseded entry flagged retired");
});

test("parseEntries on an unstructured/empty file yields no entries (fail-open)", () => {
  assert.strictEqual(parseEntries("just prose, no headings").length, 0);
  assert.strictEqual(parseEntries("").length, 0);
  assert.strictEqual(parseEntries(null).length, 0);
});

// --- unit: scoreEntry weighting ---

test("scoreEntry weights a tag match above a title match above a body-only match", () => {
  const [entry] = parseEntries(`### 2026-06-18 — jsdom missing in CI
- **Prevention rule**: declare deps explicitly so a clean install resolves them.
- **Tags**: node / dependencies / ci.
`);
  assert.ok(scoreEntry(entry, tokenize("node")) > scoreEntry(entry, tokenize("jsdom")),
    "a tag hit (node) outscores a title-only hit (jsdom)");
  assert.ok(scoreEntry(entry, tokenize("jsdom")) > scoreEntry(entry, tokenize("resolves")),
    "a title hit outscores a body-only hit");
  assert.strictEqual(scoreEntry(entry, tokenize("kubernetes")), 0, "no overlap scores 0");
});

// --- unit: retrieve ---

test("retrieve ranks the relevant lesson first and returns its full prevention prose", () => {
  const got = retrieve(MEM, "npm test jsdom node ci devDependencies", { top: 5 });
  assert.ok(got.length >= 1);
  assert.match(got[0].entry.title, /jsdom missing in CI/, "best match ranks #1");
  assert.match(got[0].entry.raw, /declare test-only deps as devDependencies/, "full entry prose returned");
});

test("retrieve excludes retired and placeholder entries", () => {
  // A signature that would match the retired async entry must return nothing from it.
  const got = retrieve(MEM, "javascript async for of foreach await", { top: 5 });
  assert.ok(!got.some((m) => /async rule/.test(m.entry.title)), "superseded entry must not surface");
  assert.ok(!got.some((m) => m.entry.placeholder), "placeholder must not surface");
});

test("retrieve returns [] for an empty query, no match, and an absent/unstructured file (fail-open)", () => {
  assert.deepStrictEqual(retrieve(MEM, "", { top: 5 }), []);
  assert.deepStrictEqual(retrieve(MEM, "kubernetes ingress tls", { top: 5 }), []);
  assert.deepStrictEqual(retrieve("", "anything", { top: 5 }), []);
  assert.deepStrictEqual(retrieve(null, "anything", { top: 5 }), []);
});

test("retrieve breaks a score tie by recency then recurrence", () => {
  // Two entries, identical single-token tag overlap on 'shared'; the newer date must rank first.
  const mem = `# FM

### 2026-06-20 — newer shared lesson
- **Tags**: shared.

### 2026-06-01 — older shared lesson
- **Tags**: shared.
`;
  const got = retrieve(mem, "shared", { top: 5 });
  assert.match(got[0].entry.title, /newer shared lesson/, "newer entry wins the tie");
});

// --- CJK retrieval round-trip (A1) ---

test("retrieve surfaces a Chinese entry for a related CJK query and not for an unrelated one", () => {
  // Before A1 the ASCII-only split dropped CJK entirely, so a Chinese title/tags/query tokenized to
  // nothing and the lesson was unreachable. Character-bigram tokenization makes it retrievable while
  // staying symmetric (query and entry both pass through the same tokenize()).
  const mem = `# FM

### 2026-07-01 — 登入逾時問題
- **Prevention rule**: 增加重試機制。
- **Tags**: 登入, 逾時.
`;
  const got = retrieve(mem, "登入逾時", { top: 5 });
  assert.ok(got.length >= 1, "a related CJK query must surface the CJK entry");
  assert.match(got[0].entry.title, /登入逾時問題/, "the CJK entry ranks #1 for its own signature");
  // Precision: an unrelated CJK query shares no bigram with the entry, so it must not surface it.
  assert.ok(!retrieve(mem, "資料庫連線", { top: 5 }).some((m) => /登入逾時問題/.test(m.entry.title)),
    "an unrelated CJK query must NOT surface the entry (no false recall)");
});

test("retrieve surfaces a MIXED Chinese+ASCII entry for a mixed query (A1: CJK pass composes with the ASCII pass)", () => {
  // Real lessons often mix an ASCII framework name with Chinese prose. tokenize() runs the ASCII word split
  // and the CJK bigram pass over the SAME string, so a mixed query must retrieve a mixed entry — proving the
  // two passes compose (neither shadows the other) rather than one dropping the other's tokens.
  const mem = `# FM

### 2026-07-05 — React 元件 render 錯誤問題
- **Prevention rule**: 檢查 props 後再 render。
- **Tags**: react, 元件.
`;
  const got = retrieve(mem, "React 元件 render", { top: 5 });
  assert.ok(got.length >= 1, "a mixed CJK+ASCII query must surface the mixed entry");
  assert.match(got[0].entry.title, /React 元件 render 錯誤問題/, "the mixed entry ranks #1 for its own signature");
});

// --- unit: formatRetrieval ---

test("formatRetrieval labels matches as untrusted reference data and embeds the full entries", () => {
  const got = retrieve(MEM, "jsdom node ci", { top: 5 });
  const out = formatRetrieval(got, { file: "ai/FAILURE_MEMORY.md" });
  assert.match(out, /NOT instructions to follow/i, "untrusted-data label present");
  assert.match(out, /jsdom missing in CI/, "matched entry embedded");
});

test("formatRetrieval emits a single no-claim line when nothing matched", () => {
  const out = formatRetrieval([], { file: "ai/FAILURE_MEMORY.md" });
  assert.match(out, /no matching failure-memory entries/i);
  assert.ok(!/###/.test(out), "no entry bodies in a no-match report");
});

// --- recording side: ledger key truncation (A5) ---

test("buildLedgerLines records a >300-char title under a key truncated to exactly 300 chars (A5 writer side)", () => {
  // The reader (failure-consolidate.mjs) looks up hits by ledgerKey(title) = title.slice(0, 300). Pin the
  // WRITER side of that shared contract: a pathological long title is recorded under the same 300-char key,
  // so a long-titled entry's hits still match on read (else it is wrongly flagged an expire candidate).
  const longTitle = "2026-07-09 — " + "x".repeat(400); // > 300 chars
  const mem = `# FM\n\n### ${longTitle}\n- **Tags**: node.\n`;
  const matches = retrieve(mem, "node", { top: 1 });
  assert.ok(matches.length >= 1, "the long-titled entry must be retrievable to record a hit");
  const key = JSON.parse(buildLedgerLines(matches, { query: "node", now: 1000 })[0]).key;
  assert.strictEqual(key.length, 300, "the recorded ledger key is truncated to exactly 300 chars");
  assert.strictEqual(key, ledgerKey(matches[0].entry.title), "and equals ledgerKey(title) — one shared source of truth");
});

// --- the committed eval (eval/failure-memory) ---

test("eval/failure-memory: every seeded case surfaces the expected lesson (recall + precision)", () => {
  const seed = fs.readFileSync(path.join(EVAL, "seed.md"), "utf8");
  const { cases } = JSON.parse(fs.readFileSync(path.join(EVAL, "cases.json"), "utf8"));
  assert.ok(Array.isArray(cases) && cases.length > 0, "cases.json must define cases");
  for (const c of cases) {
    const got = retrieve(seed, c.query, { top: 5 });
    const titles = got.map((m) => m.entry.title);
    if (c.expectTop) {
      assert.ok(got.length >= 1, `[${c.name}] expected a match for: ${c.query}`);
      assert.ok(titles[0].includes(c.expectTop),
        `[${c.name}] expected "${c.expectTop}" to rank #1, got "${titles[0]}"`);
    }
    for (const bad of (c.mustNotMatch || [])) {
      assert.ok(!titles.some((t) => t.includes(bad)),
        `[${c.name}] "${bad}" must not surface, got ${JSON.stringify(titles)}`);
    }
  }
});

// --- .ctide discovery: resolveMemoryFile (current → compatibility → global) + ledger siblinghood ---
import os from "node:os";
import { resolveMemoryFile, defaultLedgerPath } from "../cressetide/skills/vigil/scripts/failure-retrieve.mjs";

function mkMemTree({ newMem, legacyMem } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-fr-"));
  if (newMem != null) {
    fs.mkdirSync(path.join(dir, ".ctide", "memory"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".ctide", "memory", "FAILURE_MEMORY.md"), newMem, "utf8");
  }
  if (legacyMem != null) {
    fs.mkdirSync(path.join(dir, "ai"), { recursive: true });
    fs.writeFileSync(path.join(dir, "ai", "FAILURE_MEMORY.md"), legacyMem, "utf8");
  }
  return dir;
}

test("resolveMemoryFile: both project tiers present -> .ctide/memory wins", () => {
  // Discriminating: a compatibility-first resolver would choose ai/FAILURE_MEMORY.md, which this
  // exact tree would return — reverting the candidate order turns this red.
  const dir = mkMemTree({ newMem: "# FM", legacyMem: "# FM" });
  assert.strictEqual(resolveMemoryFile(dir), path.join(dir, ".ctide", "memory", "FAILURE_MEMORY.md"));
});

test("resolveMemoryFile: legacy-only -> ai/ fallback, and the usage ledger stays a sibling of the SELECTED file", () => {
  const dir = mkMemTree({ legacyMem: "# FM" });
  const chosen = resolveMemoryFile(dir);
  assert.strictEqual(chosen, path.join(dir, "ai", "FAILURE_MEMORY.md"), "a not-yet-migrated project keeps resolving to the legacy tier");
  assert.strictEqual(defaultLedgerPath(chosen), path.join(dir, "ai", ".failure-memory-usage.jsonl"), "ledger sits next to the legacy file while it is the selected one");
  const newDir = mkMemTree({ newMem: "# FM" });
  assert.strictEqual(defaultLedgerPath(resolveMemoryFile(newDir)), path.join(newDir, ".ctide", "memory", ".failure-memory-usage.jsonl"), "after migration the ledger follows the selected file into the new layout");
});

// --- e2e: failure-retrieve whole-class flag-swallow guard (get() itself now guards EVERY flag in this
// file's own KNOWN_FLAGS -- the same shared-mechanism fix run-reconcile.mjs / run-ledger.mjs apply over
// their own flag sets. `--log` is a boolean flag read via `args.includes`, not `get()` -- it has no value
// position of its own to attack, so it is excluded from the OUTER (attacked) loop below, but it stays a
// full member of KNOWN_FLAGS and appears in the INNER (swallower) loop) ---

// A deliberately distinctive, single-token, dictionary-free marker (never a substring of any OTHER value
// used in this test's own invocation -- the temp-dir prefix, --session's value, --log-file's name, etc.)
// so a coincidental token overlap can never produce a false "match" via the SEPARATE, out-of-scope
// positional-argument fallback scan below (that scan has its own pre-existing misalignment quirk with a
// bare boolean flag like --log -- it can pick up an unrelated leftover token, such as --cwd's own path
// value, as a stray "positional" -- harmless here specifically BECAUSE this marker cannot collide with it).
const CANARY_MEM = `# FM

### 2026-07-01 — qzxcanary8471 lesson
- **Prevention rule**: r.
- **Tags**: qzxcanary8471.
`;

test("failure-retrieve: for EVERY value-bearing flag in KNOWN_FLAGS, a value slot occupied by any OTHER known flag's own name (including the boolean --log) is treated as omitted, never as a literal value -- --file falls back to resolveMemoryFile(--cwd) (finds the seeded canary lesson, not a bogus nonexistent '<flag-name>'-shaped file); --query falls back to empty/unrelated content (never the literal '<flag-name>' token itself as real search text), so the canary is correctly NOT surfaced", () => {
  const VALUE_FLAGS = KNOWN_FLAGS.filter((f) => f !== "--log");
  const BOOL_FLAGS = ["--log"];
  const values = { "--query": "qzxcanary8471", "--top": "5", "--session": "logtoken1" };
  for (const F of VALUE_FLAGS) {
    for (const G of KNOWN_FLAGS) {
      if (G === F) continue;
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-frtest-"));
      try {
        fs.mkdirSync(path.join(dir, ".ctide", "memory"), { recursive: true });
        const memFile = path.join(dir, ".ctide", "memory", "FAILURE_MEMORY.md");
        fs.writeFileSync(memFile, CANARY_MEM, "utf8");
        values["--file"] = memFile;
        values["--log-file"] = path.join(dir, "usage-ledger.jsonl");

        // Order: G's own legitimate occurrence FIRST, then every other flag, then F LAST with its value
        // slot occupied by the literal token G (mirrors run-reconcile.test.mjs's / run-ledger.test.mjs's
        // identical loop-test ordering discipline -- keeps every flag's `indexOf` lookup unambiguous).
        const order = [G, ...KNOWN_FLAGS.filter((x) => x !== F && x !== G), F];
        const argv = [];
        for (const flagName of order) {
          if (flagName === F) argv.push(F, G); // F's own value slot swallowed by G's literal name
          else if (flagName === "--cwd") argv.push("--cwd", dir);
          else if (BOOL_FLAGS.includes(flagName)) argv.push(flagName); // bare boolean, no value slot
          else argv.push(flagName, values[flagName]);
        }
        // Hermetic: strip CLAUDE_PROJECT_DIR so --cwd's fallback resolves to the spawned process's own cwd
        // (this temp dir), never a developer's ambient project dir.
        const env = { ...process.env };
        delete env.CLAUDE_PROJECT_DIR;
        const r = cp.spawnSync("node", [SCRIPT, ...argv], { cwd: dir, encoding: "utf8", env });
        assert.strictEqual(r.status, 0, `${F} swallowed by ${G} must still exit 0 (fail-open): ${r.stderr}`);
        if (F === "--query") {
          assert.match(r.stdout, /no matching failure-memory entries/i,
            `${F} swallowed by ${G}: an omitted query must fall back to EMPTY (no match), never treat '${G}' as real search text`);
        } else {
          assert.match(r.stdout, /qzxcanary8471 lesson/,
            `${F} swallowed by ${G}: the seeded canary lesson must still be found (never a bogus '${G}'-shaped path/value)`);
        }
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  }
});
