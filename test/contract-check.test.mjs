import { test } from "node:test";
import assert from "node:assert";
import {
  extractContractJson, matchesGlob, scopeDiff,
} from "../cressetide/skills/vigil/scripts/contract-check.mjs";

test("extractContractJson parses the first ```json fence", () => {
  const md = "# C\n\n```json\n{\"risk\":\"high\"}\n```\n\nbody";
  assert.deepStrictEqual(extractContractJson(md), { risk: "high" });
});

test("extractContractJson returns null when absent or invalid (fail-open)", () => {
  assert.strictEqual(extractContractJson("no json"), null);
  assert.strictEqual(extractContractJson("```json\n{bad}\n```"), null);
  assert.strictEqual(extractContractJson(42), null);
});

test("matchesGlob: * is segment-local, ** crosses segments, separators normalize", () => {
  assert.ok(matchesGlob("src/auth/login.ts", "src/auth/*"));
  assert.ok(!matchesGlob("src/auth/sub/login.ts", "src/auth/*"));
  assert.ok(matchesGlob("src/auth/sub/login.ts", "src/auth/**"));
  assert.ok(matchesGlob("src\\auth\\login.ts", "src/auth/*"));
});

test("scopeDiff flags out-of-scope and forbidden hits", () => {
  const c = { allowedPaths: ["src/auth/**", "test/**"], forbiddenPaths: ["src/billing/**"] };
  const r = scopeDiff(c, ["src/auth/x.ts", "src/billing/pay.ts", "src/ui/z.ts", "test/a.test.ts"]);
  assert.deepStrictEqual(r.outOfScope, ["src/billing/pay.ts", "src/ui/z.ts"]);
  assert.deepStrictEqual(r.forbiddenHits, ["src/billing/pay.ts"]);
  assert.strictEqual(r.allowListed, true);
});

test("scopeDiff makes no allow-list claim when allowedPaths empty", () => {
  const r = scopeDiff({ forbiddenPaths: ["secret/**"] }, ["src/x.ts", "secret/k"]);
  assert.deepStrictEqual(r.outOfScope, []);
  assert.deepStrictEqual(r.forbiddenHits, ["secret/k"]);
  assert.strictEqual(r.allowListed, false);
});

test("scopeDiff tolerates null contract (fail-open)", () => {
  const r = scopeDiff(null, ["a.ts"]);
  assert.deepStrictEqual(r, { outOfScope: [], forbiddenHits: [], allowListed: false });
});

import { acCoverage, formatReport } from "../cressetide/skills/vigil/scripts/contract-check.mjs";

test("acCoverage flags behavior-changing criteria with no verification", () => {
  const c = { acceptanceCriteria: [
    { id: "AC-1", behaviorChanging: true, verification: "test/a.test.mjs::x" },
    { id: "AC-2", behaviorChanging: true, verification: "  " },
    { id: "AC-3", behaviorChanging: false },
  ]};
  assert.deepStrictEqual(acCoverage(c).uncovered, ["AC-2"]);
  assert.strictEqual(acCoverage(c).total, 3);
});

test("acCoverage tolerates null contract", () => {
  assert.deepStrictEqual(acCoverage(null), { total: 0, uncovered: [] });
});

test("formatReport: no contract => explicit no-claim", () => {
  const r = formatReport({ contractFound: false, scope: {}, coverage: {} });
  assert.match(r, /no machine-readable contract/);
  assert.match(r, /NO deterministic/);
});

test("formatReport: clean scope + full coverage", () => {
  const r = formatReport({
    contractFound: true,
    scope: { outOfScope: [], forbiddenHits: [], allowListed: true },
    coverage: { uncovered: [], total: 2 },
  });
  assert.match(r, /scope: clean/);
  assert.match(r, /every behavior-changing criterion/);
});

test("formatReport: surfaces out-of-scope, forbidden, and uncovered", () => {
  const r = formatReport({
    contractFound: true,
    scope: { outOfScope: ["src/ui/z.ts"], forbiddenHits: ["src/billing/p.ts"], allowListed: true },
    coverage: { uncovered: ["AC-2"], total: 3 },
  });
  assert.match(r, /out-of-scope changed files: src\/ui\/z\.ts/);
  assert.match(r, /forbidden-path hits: src\/billing\/p\.ts/);
  assert.match(r, /AC missing verification mapping: AC-2/);
});

test("matchesGlob collapses long * runs without catastrophic backtracking (ReDoS guard)", () => {
  // A stacked-quantifier regression (adjacent ** => `.*.*.*`) backtracks exponentially on a non-matching
  // input and would hang the test runner; the collapsed matcher returns instantly. This pins the fix.
  assert.ok(matchesGlob("a/b/c/d/e/f/g", "********************"));                  // 20 stars => single .* => matches
  assert.ok(!matchesGlob("a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p", "********************Z")); // long non-match returns fast
});

test("matchesGlob normalizes backslashes in the CHANGED path too (not only the glob)", () => {
  assert.ok(matchesGlob("src\\billing\\pay.ts", "src/billing/**"));
});

test("formatReport: no allowedPaths declared => explicit no-allow-list-claim line", () => {
  const r = formatReport({
    contractFound: true,
    scope: { outOfScope: [], forbiddenHits: [], allowListed: false },
    coverage: { uncovered: [], total: 0 },
  });
  assert.match(r, /no allowedPaths declared — no allow-list claim/);
});

test("acCoverage names an uncovered, id-less criterion '(unnamed)'", () => {
  const c = { acceptanceCriteria: [{ behaviorChanging: true, verification: "" }] };
  assert.deepStrictEqual(acCoverage(c).uncovered, ["(unnamed)"]);
  assert.strictEqual(acCoverage(c).total, 1);
});

// --- .ctide discovery: default contract path (current → compatibility; explicit --contract wins) ---
import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveContractPath, KNOWN_FLAGS } from "../cressetide/skills/vigil/scripts/contract-check.mjs";

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..",
  "cressetide", "skills", "vigil", "scripts", "contract-check.mjs");

// A minimal contract whose uncovered AC id proves WHICH file the checker read.
function contractWithUncoveredAc(id) {
  return "# C\n\n```json\n" + JSON.stringify({ ctideContract: 1, acceptanceCriteria: [{ id, behaviorChanging: true, verification: "" }] }) + "\n```\n";
}
function mkContractTree({ newMd, legacyMd } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-cc-"));
  if (newMd != null) {
    fs.mkdirSync(path.join(dir, ".ctide", "output"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".ctide", "output", "contract.md"), newMd, "utf8");
  }
  if (legacyMd != null) {
    fs.mkdirSync(path.join(dir, ".ctide", "legacy-output"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".ctide", "legacy-output", "contract.md"), legacyMd, "utf8");
  }
  return dir;
}
function runCli(cwd, args = []) {
  return cp.execFileSync("node", [SCRIPT, ...args], { cwd, encoding: "utf8" });
}

test("resolveContractPath: both present -> new wins; legacy-only -> legacy; neither -> the new default", () => {
  const both = mkContractTree({ newMd: "n", legacyMd: "l" });
  assert.strictEqual(resolveContractPath(both), path.join(both, ".ctide", "output", "contract.md"));
  const legacyOnly = mkContractTree({ legacyMd: "l" });
  assert.strictEqual(resolveContractPath(legacyOnly), path.join(legacyOnly, ".ctide", "legacy-output", "contract.md"));
  const neither = mkContractTree({});
  assert.strictEqual(resolveContractPath(neither), path.join(neither, ".ctide", "output", "contract.md"),
    "absent everywhere -> default to the new path so the no-claim report names where it should live");
});

test("contract-check CLI: with BOTH contract files, the report reads the NEW path", () => {
  // Discriminating: a compatibility-path default would name AC-LEGACY here.
  const dir = mkContractTree({ newMd: contractWithUncoveredAc("AC-NEW"), legacyMd: contractWithUncoveredAc("AC-LEGACY") });
  const out = runCli(dir);
  assert.match(out, /AC missing verification mapping: AC-NEW/, "the uncovered AC id proves the NEW file was read");
  assert.ok(!out.includes("AC-LEGACY"), "the legacy contract must not be the one reported when the new path exists");
});

test("contract-check CLI: a legacy-only tree still resolves (fallback tier control)", () => {
  const dir = mkContractTree({ legacyMd: contractWithUncoveredAc("AC-LEGACY") });
  assert.match(runCli(dir), /AC missing verification mapping: AC-LEGACY/, "pre-migration runs must keep working off the legacy path");
});

test("contract-check CLI: an explicit --contract arg keeps precedence over the .ctide discovery", () => {
  const dir = mkContractTree({ newMd: contractWithUncoveredAc("AC-NEW"), legacyMd: contractWithUncoveredAc("AC-LEGACY") });
  const out = runCli(dir, ["--contract", path.join(".ctide", "legacy-output", "contract.md")]);
  assert.match(out, /AC missing verification mapping: AC-LEGACY/, "an explicit path must win over discovery");
});

// --- e2e: contract-check whole-class flag-swallow guard (get() itself now guards EVERY flag in this
// file's own KNOWN_FLAGS -- the same shared-mechanism fix run-reconcile.mjs / run-ledger.mjs apply over
// their own flag sets) ---

function git(cwd, ...args) {
  return cp.execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

// A repo with one committed file plus a real UNCOMMITTED modification to it (so `git diff --name-only HEAD`
// -- the correct --base fallback -- shows something non-trivial), and a contract at the DEFAULT
// .ctide/output/contract.md discovery path (so a correctly-falling-back --contract finds it) whose
// allowedPaths excludes that file (so a correctly-resolved --base reports it as out-of-scope).
test("contract-check: a git failure (non-git cwd) stays fail-open with a clean caller stderr -- the child's raw stderr text must never leak through execFileSync's default-inherited stdio", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-cc-nongit-"));
  const result = cp.spawnSync("node", [SCRIPT, "--base", "HEAD"], { cwd: dir, encoding: "utf8" });
  assert.strictEqual(result.status, 0, "must still exit 0 (fail-open) outside a git repo");
  assert.strictEqual(result.stderr, "", "caller's own stderr must be clean -- git's raw 'fatal: not a git repository' text must not leak through");
  assert.match(result.stdout, /scope/, "must still print a report (changedPathsFromGit swallowed the git failure to [])");
});

function repoForSwallowTest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-cc-swallow-"));
  git(dir, "init", "-q", "--initial-branch=main");
  git(dir, "config", "user.email", "cc@example.invalid");
  git(dir, "config", "user.name", "Contract Check Swallow Test");
  fs.writeFileSync(path.join(dir, "tracked.ts"), "original\n", "utf8");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "initial");
  fs.writeFileSync(path.join(dir, "tracked.ts"), "changed\n", "utf8"); // uncommitted -> shows in `git diff HEAD`
  fs.mkdirSync(path.join(dir, ".ctide", "output"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".ctide", "output", "contract.md"),
    "# C\n\n```json\n" + JSON.stringify({ allowedPaths: ["nonexistent/**"] }) + "\n```\n",
    "utf8",
  );
  return dir;
}

test("contract-check: for EVERY flag in KNOWN_FLAGS, a value slot occupied by the OTHER known flag's own name is treated as omitted, never as a literal value -- --contract falls back to the .ctide default-discovery path (finds the seeded contract, not a bogus nonexistent '<flag-name>'-shaped file) and --base falls back to diffing against HEAD (reports the real uncommitted change as out-of-scope, rather than failing open on a bogus non-ref '<flag-name>'-shaped --base)", () => {
  // Only 2 flags in this file -> order is simply [G, F] (no "everyone else" middle section).
  for (const F of KNOWN_FLAGS) {
    for (const G of KNOWN_FLAGS) {
      if (G === F) continue;
      const dir = repoForSwallowTest();
      const contractPath = path.join(dir, ".ctide", "output", "contract.md");
      // G's own legitimate occurrence: --contract -> the real seeded contract path; --base -> "HEAD" (an
      // explicit ref equivalent to the default, so the expected report is identical either way).
      const legitValueOf = (flagName) => (flagName === "--contract" ? contractPath : "HEAD");
      const order = [G, F];
      const argv = [];
      for (const flagName of order) {
        if (flagName === F) argv.push(F, G); // F's own value slot swallowed by G's literal name
        else argv.push(flagName, legitValueOf(flagName));
      }
      const out = cp.execFileSync("node", [SCRIPT, ...argv], { cwd: dir, encoding: "utf8" });
      assert.match(out, /out-of-scope changed files: tracked\.ts/,
        `${F} swallowed by ${G} must still resolve to the real contract + diff against HEAD, not a bogus '${G}'-shaped path/ref`);
    }
  }
});
