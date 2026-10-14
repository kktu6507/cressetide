import assert from "node:assert";
import { git, makeRepo, tempDir, test } from "./helpers.mjs";
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
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveContractPath } from "../cressetide/skills/vigil/scripts/contract-check.mjs";

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..",
  "cressetide", "skills", "vigil", "scripts", "contract-check.mjs");

// A minimal contract whose uncovered AC id proves WHICH file the checker read.
function contractWithUncoveredAc(id) {
  return "# C\n\n```json\n" + JSON.stringify({ ctideContract: 1, acceptanceCriteria: [{ id, behaviorChanging: true, verification: "" }] }) + "\n```\n";
}
function mkContractTree({ newMd, legacyMd } = {}) {
  const dir = tempDir("ctide-cc-");
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

test("contract-check: a git failure (non-git cwd) stays fail-open with a clean caller stderr -- the child's raw stderr text must never leak through execFileSync's default-inherited stdio", () => {
  const dir = tempDir("ctide-cc-nongit-");
  const result = cp.spawnSync("node", [SCRIPT, "--base", "HEAD"], { cwd: dir, encoding: "utf8" });
  assert.strictEqual(result.status, 0, "must still exit 0 (fail-open) outside a git repo");
  assert.strictEqual(result.stderr, "", "caller's own stderr must be clean -- git's raw 'fatal: not a git repository' text must not leak through");
  assert.match(result.stdout, /scope/, "must still print a report (changedPathsFromGit swallowed the git failure to [])");
});

// --- the command line goes through cressetide/lib/cli.mjs parseCli, git through cressetide/lib/git.mjs ---

// A repo with one committed file plus a real UNCOMMITTED modification to it (so `git diff --name-only HEAD`
// shows something non-trivial), and a contract at the DEFAULT .ctide/output/contract.md discovery path
// (untracked, so never itself a changed path) whose allowedPaths excludes that file, so a correct diff
// reports it as out-of-scope. `contract` overrides the contract's fields; `files` the committed files.
function repoWithOutOfScopeChange({ contract = {}, files = { "tracked.ts": "original\n" }, change = "tracked.ts" } = {}) {
  const dir = makeRepo({ prefix: "ctide-cc-repo-", name: "Contract Check Test", email: "cc@example.invalid", files, message: "initial" });
  fs.writeFileSync(path.join(dir, change), "changed\n", "utf8");
  fs.mkdirSync(path.join(dir, ".ctide", "output"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".ctide", "output", "contract.md"),
    "# C\n\n```json\n" + JSON.stringify({ allowedPaths: ["nonexistent/**"], ...contract }) + "\n```\n",
    "utf8",
  );
  return dir;
}
const runCheck = (cwd, args, env) => cp.spawnSync("node", [SCRIPT, ...args], { cwd, encoding: "utf8", env });
const CC_NO_CLAIM = "ctide contract-check: no claim — the command line could not be parsed (usage: contract-check.mjs [--contract <path>] [--base <ref>]) — NO deterministic scope/AC claim; arbiter uses prose judgment.\n";
const CC_USAGE_LINE = /^contract-check: .*\(usage: contract-check\.mjs \[--contract <path>\] \[--base <ref>\]\)\n$/;

test("--base injection (owner Q3): `--base --output=<file>` and `--base=--output=<file>` write no file, make no scope claim, and are usage errors naming --base", () => {
  const dir = repoWithOutOfScopeChange();
  const pwned = path.join(tempDir("ctide-cc-pwned-"), "pwned.txt");
  for (const args of [["--base", `--output=${pwned}`], [`--base=--output=${pwned}`]]) {
    const r = runCheck(dir, args);
    assert.strictEqual(r.status, 0, `${args.join(" ")}: must always exit 0`);
    assert.strictEqual(fs.existsSync(pwned), false, `${args.join(" ")}: git must never receive the value as an option (no file written)`);
    assert.strictEqual(r.stdout, CC_NO_CLAIM, `${args.join(" ")}: no scope claim at all, least of all "scope: clean"`);
    assert.match(r.stderr, CC_USAGE_LINE, `${args.join(" ")}: one usage line on stderr`);
    assert.match(r.stderr, /'--base'/, `${args.join(" ")}: the usage line names --base`);
  }
});

test("an unresolvable --base reports scope as unverified — never \"scope: clean\", no forbidden-path claim either — and keeps the AC-coverage line, exit 0", () => {
  const dir = repoWithOutOfScopeChange({ contract: { forbiddenPaths: ["tracked.ts"] } });
  const r = runCheck(dir, ["--base", "no-such-ref"]);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stderr, "");
  assert.strictEqual(r.stdout, [
    "ctide contract-check (deterministic):",
    '  scope: unverified (--base "no-such-ref" does not resolve to a commit) — NO scope or forbidden-path claim',
    "  AC coverage: every behavior-changing criterion maps to a verification entry",
    "",
  ].join("\n"));
});

test("a valid --base (HEAD~1, its `=` form, an annotated tag) is resolved to its commit and diffed as before; no --base diffs against HEAD", () => {
  const dir = repoWithOutOfScopeChange();
  git(dir, ["tag", "-a", "v1", "-m", "v1"]);
  fs.writeFileSync(path.join(dir, "other.ts"), "added in the second commit\n", "utf8");
  git(dir, ["add", "other.ts"]);
  git(dir, ["commit", "-q", "-m", "second"]);
  for (const args of [["--base", "HEAD~1"], ["--base=HEAD~1"], ["--base", "v1"]]) {
    const r = runCheck(dir, args);
    assert.strictEqual(r.stderr, "", args.join(" "));
    assert.ok(r.stdout.includes("  out-of-scope changed files: other.ts, tracked.ts\n"), `${args.join(" ")}: ${r.stdout}`);
  }
  assert.ok(runCheck(dir, []).stdout.includes("  out-of-scope changed files: tracked.ts\n"), "no --base: against HEAD");
});

test("removed flags (--provenance, --inventory, --task) are usage errors: exit 0, a stderr usage line naming the flag, the stdout no-claim line, no provenance JSON", () => {
  const dir = repoWithOutOfScopeChange();
  for (const args of [["--provenance"], ["--inventory"], ["--task", "T-1"]]) {
    const r = runCheck(dir, args);
    assert.strictEqual(r.status, 0, args.join(" "));
    assert.match(r.stderr, CC_USAGE_LINE, `${args.join(" ")}: one usage line on stderr`);
    assert.ok(r.stderr.includes(`'${args[0]}'`), `${args.join(" ")}: the usage line names the flag`);
    assert.strictEqual(r.stdout, CC_NO_CLAIM, `${args.join(" ")}: the no-claim line only`);
    assert.ok(!r.stdout.includes("{"), `${args.join(" ")}: no JSON of any kind`);
  }
});

test("CLI (parseCli): an unknown flag, a value flag without its value, and a positional are usage errors; a repeated --base keeps its last value", () => {
  const dir = repoWithOutOfScopeChange();
  for (const args of [["--bogus"], ["--base"], ["--contract"], ["v1"]]) {
    const r = runCheck(dir, args);
    assert.strictEqual(r.status, 0, args.join(" "));
    assert.strictEqual(r.stdout, CC_NO_CLAIM, args.join(" "));
    assert.match(r.stderr, CC_USAGE_LINE, args.join(" "));
  }
  const repeated = runCheck(dir, ["--base", "no-such-ref", "--base", "HEAD"]);
  assert.strictEqual(repeated.stderr, "");
  assert.ok(repeated.stdout.includes("  out-of-scope changed files: tracked.ts\n"), "the last --base (HEAD) wins over the unresolvable first one");
});

test("lib/git binding: an inherited absolute GIT_DIR naming another repository does not redirect the diff", () => {
  const dir = repoWithOutOfScopeChange();
  const other = makeRepo({ prefix: "ctide-cc-other-", files: { "b-only.txt": "another repository\n" } });
  const env = { ...process.env, GIT_DIR: path.join(other, ".git") };
  for (const args of [[], ["--base", "HEAD"]]) {
    const r = runCheck(dir, args, env);
    assert.strictEqual(r.stderr, "", args.join(" "));
    assert.ok(r.stdout.includes("  out-of-scope changed files: tracked.ts\n"), `${args.join(" ") || "(no args)"}: the diff is the working directory's own repository: ${r.stdout}`);
    assert.ok(!r.stdout.includes("b-only.txt"), `${args.join(" ") || "(no args)"}: nothing from the inherited GIT_DIR's repository`);
  }
});

test("lib/git binding: a non-ASCII changed path is matched by its glob (core.quotePath=false wins over a repo-local core.quotePath=true)", () => {
  const name = "caf" + String.fromCodePoint(0xe9) + ".txt";
  const dir = repoWithOutOfScopeChange({ files: { [name]: "original\n" }, change: name, contract: { allowedPaths: ["src/**"], forbiddenPaths: [name] } });
  git(dir, ["config", "core.quotePath", "true"]);
  const r = runCheck(dir, []);
  assert.strictEqual(r.stderr, "");
  assert.ok(r.stdout.includes(`  forbidden-path hits: ${name}\n`), `the forbidden non-ASCII path is reported unquoted: ${r.stdout}`);
  assert.ok(r.stdout.includes(`  out-of-scope changed files: ${name}\n`), r.stdout);
});

// --- P4 review S-M1 / F6: the revision reaches `git diff` followed by "--"; with an explicit --base (the
// empty string included), a diff that fails is unverified ---

// Serialized into a `node -r` preload (Function.prototype.toString), never called in this file — the way
// test/ship.test.mjs injects git faults. It appends every git argument list to `options.record` (one JSON
// line each) and, with `options.fail` "diff-enobufs", fails `git diff` the way output over maxBuffer does.
function gitSpyPreload(options) {
  const childProcess = require("node:child_process");
  const fileSystem = require("node:fs");
  const realSpawnSync = childProcess.spawnSync;
  childProcess.spawnSync = function patchedSpawnSync(command, args) {
    const list = command === "git" && Array.isArray(args) ? args.map(String) : null;
    if (list && options.record) fileSystem.appendFileSync(options.record, JSON.stringify(list) + "\n");
    if (list && options.fail === "diff-enobufs" && list.includes("diff")) {
      const error = Object.assign(new Error("spawnSync git ENOBUFS"), { code: "ENOBUFS", syscall: "spawnSync git" });
      return { pid: 0, output: null, stdout: "", stderr: "", status: null, signal: "SIGTERM", error };
    }
    return realSpawnSync.apply(this, arguments);
  };
  require("node:module").syncBuiltinESMExports();
}

function runCheckWithSpy(cwd, args, options) {
  const preload = path.join(tempDir("ctide-cc-spy-"), "spy.cjs");
  fs.writeFileSync(preload, `(${gitSpyPreload})(${JSON.stringify(options)});\n`, "utf8");
  return cp.spawnSync(process.execPath, ["-r", preload, SCRIPT, ...args], { cwd, encoding: "utf8" });
}

const CC_DIFF_FAILED = [
  "ctide contract-check (deterministic):",
  "  scope: unverified (git diff against the resolved --base failed) — NO scope or forbidden-path claim",
  "  AC coverage: every behavior-changing criterion maps to a verification entry",
  "",
].join("\n");

test("--base: a working-tree file named the resolved commit id does not hide a modified forbidden file", () => {
  const dir = repoWithOutOfScopeChange({ contract: { forbiddenPaths: ["tracked.ts"] } });
  git(dir, ["commit", "-q", "--allow-empty", "-m", "second"]);
  fs.writeFileSync(path.join(dir, git(dir, ["rev-parse", "HEAD~1"])), "a file named like the base commit\n", "utf8");
  const r = runCheck(dir, ["--base", "HEAD~1"]);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stderr, "");
  assert.ok(r.stdout.includes("  forbidden-path hits: tracked.ts\n"), r.stdout);
});

test("no --base: a working-tree file named HEAD does not hide a modified forbidden file", () => {
  const dir = repoWithOutOfScopeChange({ contract: { forbiddenPaths: ["tracked.ts"] } });
  fs.writeFileSync(path.join(dir, "HEAD"), "a file named HEAD\n", "utf8");
  const r = runCheck(dir, []);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stderr, "");
  assert.ok(r.stdout.includes("  forbidden-path hits: tracked.ts\n"), r.stdout);
});

test("--base: a git diff against the resolved base that fails (ENOBUFS, a corrupt index) is unverified, never \"scope: clean\"; without --base the same failure still fails open", () => {
  const dir = repoWithOutOfScopeChange({ contract: { forbiddenPaths: ["tracked.ts"] } });
  const enobufs = runCheckWithSpy(dir, ["--base", "HEAD"], { fail: "diff-enobufs" });
  assert.strictEqual(enobufs.status, 0, enobufs.stderr);
  assert.strictEqual(enobufs.stdout, CC_DIFF_FAILED, "ENOBUFS");
  fs.writeFileSync(path.join(dir, ".git", "index"), "not an index\n", "utf8");
  const corrupt = runCheck(dir, ["--base", "HEAD"]);
  assert.strictEqual(corrupt.status, 0);
  assert.strictEqual(corrupt.stderr, "");
  assert.strictEqual(corrupt.stdout, CC_DIFF_FAILED, "corrupt index: --base HEAD still resolves, the diff fails");
  // Must not change in this phase (P7 owns AC-10): without --base a failed diff is still an empty list.
  const noBase = runCheck(dir, []);
  assert.strictEqual(noBase.status, 0);
  assert.ok(noBase.stdout.includes("  scope: clean (all changed files within allowedPaths)\n"), noBase.stdout);
});

test("--base: only the resolved commit id reaches git diff, immediately followed by \"--\" as the last argument", () => {
  const dir = repoWithOutOfScopeChange();
  git(dir, ["commit", "-q", "--allow-empty", "-m", "second"]);
  const record = path.join(tempDir("ctide-cc-argv-"), "argv.jsonl");
  const r = runCheckWithSpy(dir, ["--base", "HEAD~1"], { record });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes("  out-of-scope changed files: tracked.ts\n"), r.stdout);
  const diffs = fs.readFileSync(record, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line))
    .filter((argv) => argv.includes("diff"));
  assert.strictEqual(diffs.length, 1, JSON.stringify(diffs));
  const tail = diffs[0].slice(diffs[0].indexOf("diff"));
  assert.match(tail[2] ?? "", /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/, `a full commit id, not the raw --base value: ${JSON.stringify(tail)}`);
  assert.deepStrictEqual(tail, ["diff", "--name-only", git(dir, ["rev-parse", "HEAD~1"]), "--"]);
});

test("an empty --base (`--base=`, `--base \"\"` — e.g. an unset $BASE) is unverified, never a silent fall-back to HEAD", () => {
  const dir = repoWithOutOfScopeChange({ contract: { forbiddenPaths: ["tracked.ts"] } });
  for (const args of [["--base="], ["--base", ""]]) {
    const r = runCheck(dir, args);
    assert.strictEqual(r.status, 0, JSON.stringify(args));
    assert.strictEqual(r.stderr, "", JSON.stringify(args));
    assert.strictEqual(r.stdout, [
      "ctide contract-check (deterministic):",
      '  scope: unverified (--base "" does not resolve to a commit) — NO scope or forbidden-path claim',
      "  AC coverage: every behavior-changing criterion maps to a verification entry",
      "",
    ].join("\n"), JSON.stringify(args));
  }
});
