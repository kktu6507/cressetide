// Tests for ship.mjs — the read-only release-readiness report. Granularity mirrors
// run-ledger.test.mjs/run-reconcile.test.mjs: pure unit tests for the fs/git-free logic (marker
// ordering, the pending-ledger filter), e2e tests spawning the real CLI against constructed temp
// git repos for everything that inherently needs file/git state (the five checks). The load-bearing
// properties: marker resolution orders by VERSION not lexicographic string sort; the pending filter
// counts only READY runs strictly after the marker and tolerates malformed ledger lines; every check
// distinguishes `not-applicable` (the concept doesn't apply) from `unverified` (it applies but could
// not be confirmed) and never silently treats an unreadable/malformed input as clean; tag-readiness
// refuses to guess a target version when version-consistency itself is not trustworthy; ship.mjs
// NEVER writes anything, proven by a byte-identical whole-tree snapshot, not just asserted in prose;
// and the CLI always exits 0, even fed a missing git repo, a missing ledger, or corrupt JSON.
import { test } from "node:test";
import assert from "node:assert";
import cp from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseVersionTag, pickLatestVersionTag, readLedgerTolerant, filterPendingReady,
  resolveMarker, versionConsistencyCheck, changelogTouchedCheck, tagReadinessCheck,
  migrationCompatibilityCheck, checksumVerifyCheck, buildShipReport, KNOWN_FLAGS,
  buildErrorFallbackReport,
} from "../cressetide/skills/ship/scripts/ship.mjs";
import { hardenGitSigning } from "./helpers.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(root, "cressetide", "skills", "ship", "scripts", "ship.mjs");

function temporary(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

function git(cwd, ...args) {
  return cp.execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

// A commit with a FULLY deterministic committer date, so marker resolution's commit-time comparisons
// never depend on real elapsed wall-clock time (flake-proof, matches run-reconcile.test.mjs's own
// commitAt convention).
function commitAt(cwd, isoDate, message) {
  cp.execFileSync("git", ["commit", "-q", "--allow-empty", "-m", message], {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_AUTHOR_DATE: isoDate, GIT_COMMITTER_DATE: isoDate },
  });
}

function bareRepository() {
  const dir = temporary("ctide-ship-bare-");
  git(dir, "init", "-q", "--initial-branch=main");
  git(dir, "config", "user.email", "ship@example.invalid");
  git(dir, "config", "user.name", "Ship Test");
  hardenGitSigning(dir);
  fs.writeFileSync(path.join(dir, "a.txt"), "a\n", "utf8");
  git(dir, "add", ".");
  commitAt(dir, "2026-01-01T00:00:00Z", "initial");
  return dir;
}

function ledgerPath(dir) { return path.join(dir, ".ctide", "ledger", "runs.jsonl"); }
function writeLedger(dir, records) {
  fs.mkdirSync(path.dirname(ledgerPath(dir)), { recursive: true });
  fs.writeFileSync(ledgerPath(dir), records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
}
function runRecord(overrides) {
  return { v: 1, type: "run", ts: 1000, task: "t", head: "deadbeef", verdict: "READY", ...overrides };
}

function writePkg(dir, relPath, content) {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

function writeMapDoc(dir, { commit = "0000000000000000000000000000000000000000", rollbackLines = [] } = {}) {
  const text = [
    "# System Map", "",
    "Verified at commit: " + commit,
    "Last updated: 2026-01-01T00:00:00.000Z", "",
    "## System overview", "", "- placeholder", "",
    "## Rollback", "",
    ...rollbackLines, "",
    "## Feature flags & kill switches", "",
    "- placeholder", "",
  ].join("\n");
  const target = path.join(dir, ".ctide", "map", "SYSTEM_MAP.md");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text, "utf8");
  return target;
}

function runShip(cwd, args) {
  return cp.execFileSync("node", [SCRIPT, ...args], { cwd, encoding: "utf8" });
}

// Recursive snapshot of every FILE under `dir`, excluding `.git` (git's own read commands can
// legitimately rewrite internal bookkeeping like the index stat-cache even on a pure read such as
// `git status`, which would make a snapshot INCLUDING `.git/` internals flaky for reasons unrelated to
// whether ship.mjs itself wrote anything). This still covers the ledger, the whole `.ctide/` tree, and
// every other working-tree file — everything the zero-writes invariant needs to prove.
function snapshotTree(dir) {
  const out = new Map();
  function walk(absolute, relative) {
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const childAbsolute = path.join(absolute, entry.name);
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(childAbsolute, childRelative);
      else if (entry.isFile()) out.set(childRelative, fs.readFileSync(childAbsolute));
    }
  }
  walk(dir, "");
  return out;
}
function assertSameSnapshot(before, after) {
  assert.deepStrictEqual([...after.keys()].sort(), [...before.keys()].sort(), "no file was added or removed");
  for (const [file, contentBefore] of before) {
    assert.ok(contentBefore.equals(after.get(file)), `${file} must be byte-identical after running ship.mjs`);
  }
}

// --- unit: parseVersionTag / pickLatestVersionTag (pure, no fs/git) ---

test("parseVersionTag accepts vX.Y.Z and bare X.Y.Z, rejects anything else", () => {
  assert.deepStrictEqual(parseVersionTag("v1.2.3"), { tag: "v1.2.3", major: 1, minor: 2, patch: 3 });
  assert.deepStrictEqual(parseVersionTag("1.2.3"), { tag: "1.2.3", major: 1, minor: 2, patch: 3 });
  assert.strictEqual(parseVersionTag("v1.2.3-beta"), null);
  assert.strictEqual(parseVersionTag("nightly"), null);
  assert.strictEqual(parseVersionTag(""), null);
});

test("pickLatestVersionTag orders by VERSION, not lexicographic string sort — v9.0.0 must not sort after v10.0.0", () => {
  assert.strictEqual(pickLatestVersionTag(["v1.0.0", "v9.0.0", "v10.0.0", "v2.0.0"]), "v10.0.0");
});

test("pickLatestVersionTag compares minor and patch numerically too", () => {
  assert.strictEqual(pickLatestVersionTag(["v1.9.0", "v1.10.0"]), "v1.10.0");
  assert.strictEqual(pickLatestVersionTag(["v1.2.9", "v1.2.10"]), "v1.2.10");
});

test("pickLatestVersionTag ignores non-matching tag names and returns null when nothing matches", () => {
  assert.strictEqual(pickLatestVersionTag(["nightly", "release-2026", "not-a-version"]), null);
  assert.strictEqual(pickLatestVersionTag([]), null);
});

// --- unit: readLedgerTolerant / filterPendingReady (pure, no fs/git) ---

test("readLedgerTolerant keeps typed records and silently skips blank / unparseable / keyless lines", () => {
  const text = [
    JSON.stringify({ type: "run", verdict: "READY" }),
    "",
    "not json {{{",
    JSON.stringify({ verdict: "READY" }), // no `type` -> skip
    "   ",
  ].join("\n");
  const records = readLedgerTolerant(text);
  assert.strictEqual(records.length, 1);
});

test("readLedgerTolerant is null/empty tolerant", () => {
  assert.deepStrictEqual(readLedgerTolerant(""), []);
  assert.deepStrictEqual(readLedgerTolerant(null), []);
  assert.deepStrictEqual(readLedgerTolerant(undefined), []);
});

test("filterPendingReady keeps only type:run records with verdict READY — FIX REQUIRED/NOT READY excluded", () => {
  const records = [
    { type: "run", verdict: "READY", ts: 1 },
    { type: "run", verdict: "FIX REQUIRED", ts: 2 },
    { type: "run", verdict: "NOT READY", ts: 3 },
    { type: "close", ref: "x" },
  ];
  assert.deepStrictEqual(filterPendingReady(records, null).map((r) => r.ts), [1]);
});

test("filterPendingReady with a threshold keeps only records strictly AFTER it", () => {
  const records = [
    { type: "run", verdict: "READY", ts: 100 },
    { type: "run", verdict: "READY", ts: 200 },
    { type: "run", verdict: "READY", ts: 300 },
  ];
  assert.deepStrictEqual(filterPendingReady(records, 200).map((r) => r.ts), [300]);
});

test("filterPendingReady with thresholdMs null (no marker found) fail-opens to the full READY history", () => {
  const records = [{ type: "run", verdict: "READY", ts: 1 }, { type: "run", verdict: "READY", ts: 999999 }];
  assert.strictEqual(filterPendingReady(records, null).length, 2);
});

// --- e2e: resolveMarker ---

test("resolveMarker: no vX.Y.Z tag at all falls open with a disclosed note", () => {
  const dir = bareRepository();
  const marker = resolveMarker(dir);
  assert.strictEqual(marker.found, false);
  assert.strictEqual(marker.commitTimeMs, null);
  assert.match(marker.note, /no vX\.Y\.Z release tag found/);
});

test("resolveMarker: picks the highest-VERSION tag among several created out of numeric order", () => {
  const dir = bareRepository();
  commitAt(dir, "2026-01-02T00:00:00Z", "second");
  git(dir, "tag", "v1.0.0");
  git(dir, "tag", "v9.0.0");
  git(dir, "tag", "v10.0.0"); // created LAST but must still win by version, matching real tag-creation order irrelevance
  const marker = resolveMarker(dir);
  assert.strictEqual(marker.found, true);
  assert.strictEqual(marker.tag, "v10.0.0");
  assert.ok(marker.commit);
  assert.strictEqual(typeof marker.commitTimeMs, "number");
});

test("resolveMarker: a non-git cwd fails open (found:false), never throws", () => {
  const dir = temporary("ctide-ship-nongit-");
  const marker = resolveMarker(dir);
  assert.strictEqual(marker.found, false);
});

test("resolveMarker on a non-git cwd never leaks git's raw error text onto the caller's stderr (piped-stdio regression)", () => {
  const dir = temporary("ctide-ship-nongit-stderr-");
  const result = cp.spawnSync("node", [SCRIPT, "--cwd", dir, "--json"], { encoding: "utf8" });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stderr, "");
});

test("resolveMarker: a shallow clone with no locally-visible tag discloses history-truncation in the note, not a bare 'no tag found' (a real tag can exist upstream without having been fetched)", () => {
  const dir = bareRepository();
  fs.writeFileSync(path.join(dir, ".git", "shallow"), "", "utf8");
  const marker = resolveMarker(dir);
  assert.strictEqual(marker.found, false);
  assert.match(marker.note, /history truncated — weak-signal only/);
});

// --- e2e: versionConsistencyCheck ---

test("versionConsistencyCheck: zero manifests with a version field -> not-applicable", () => {
  const dir = temporary("ctide-ship-vc-");
  const result = versionConsistencyCheck(dir);
  assert.strictEqual(result.status, "not-applicable");
});

test("versionConsistencyCheck: exactly one manifest -> not-applicable (nothing to be inconsistent with)", () => {
  const dir = temporary("ctide-ship-vc-");
  writePkg(dir, "package.json", JSON.stringify({ version: "1.0.0" }));
  const result = versionConsistencyCheck(dir);
  assert.strictEqual(result.status, "not-applicable");
  assert.match(result.evidence, /1\.0\.0/);
});

test("versionConsistencyCheck: two or more manifests agreeing -> pass", () => {
  const dir = temporary("ctide-ship-vc-");
  writePkg(dir, "package.json", JSON.stringify({ version: "1.0.0" }));
  writePkg(dir, "packages/a/package.json", JSON.stringify({ version: "1.0.0" }));
  const result = versionConsistencyCheck(dir);
  assert.strictEqual(result.status, "pass");
});

test("versionConsistencyCheck: two or more manifests disagreeing -> fail, names every file@version", () => {
  const dir = temporary("ctide-ship-vc-");
  writePkg(dir, "package.json", JSON.stringify({ version: "1.0.0" }));
  writePkg(dir, "packages/a/package.json", JSON.stringify({ version: "2.0.0" }));
  const result = versionConsistencyCheck(dir);
  assert.strictEqual(result.status, "fail");
  assert.match(result.evidence, /package\.json@1\.0\.0/);
  assert.match(result.evidence, /packages\/a\/package\.json@2\.0\.0/);
});

test("versionConsistencyCheck: a malformed package.json -> unverified, names the parse error, never silently treated as consistent", () => {
  const dir = temporary("ctide-ship-vc-");
  writePkg(dir, "package.json", JSON.stringify({ version: "1.0.0" }));
  writePkg(dir, "packages/a/package.json", "{ not valid json");
  const result = versionConsistencyCheck(dir);
  assert.strictEqual(result.status, "unverified");
  assert.match(result.evidence, /packages\/a\/package\.json/);
});

test("versionConsistencyCheck: node_modules/.git/.ctide package.json files are excluded from the scan", () => {
  const dir = temporary("ctide-ship-vc-");
  writePkg(dir, "package.json", JSON.stringify({ version: "1.0.0" }));
  writePkg(dir, "node_modules/dep/package.json", JSON.stringify({ version: "9.9.9" }));
  const result = versionConsistencyCheck(dir);
  assert.strictEqual(result.status, "not-applicable", "only the root manifest should count");
});

test("versionConsistencyCheck: a manifest with no version field at all does not count toward the comparison", () => {
  const dir = temporary("ctide-ship-vc-");
  writePkg(dir, "package.json", JSON.stringify({ version: "1.0.0" }));
  writePkg(dir, "packages/a/package.json", JSON.stringify({ name: "no-version-field" }));
  const result = versionConsistencyCheck(dir);
  assert.strictEqual(result.status, "not-applicable");
});

test("versionConsistencyCheck: a pathologically large version field is capped, never pushed uncapped into manifests/evidence (regression: a 5MB version string previously produced a multi-megabyte report)", () => {
  const dir = temporary("ctide-ship-vc-cap-");
  const hugeVersion = "9".repeat(5_000_000);
  writePkg(dir, "package.json", JSON.stringify({ version: hugeVersion }));
  const result = versionConsistencyCheck(dir);
  assert.strictEqual(result.status, "not-applicable");
  assert.ok(result.manifests[0].version.length <= 81, `manifest version must be capped, got length ${result.manifests[0].version.length}`);
  assert.ok(result.evidence.length <= 200, `evidence must stay bounded even for a pathological version field, got length ${result.evidence.length}`);
});

// --- e2e: changelogTouchedCheck ---

test("changelogTouchedCheck: no CHANGELOG.md in the repository at all -> not-applicable", () => {
  const dir = bareRepository();
  const marker = resolveMarker(dir);
  const result = changelogTouchedCheck(dir, marker);
  assert.strictEqual(result.status, "not-applicable");
});

test("changelogTouchedCheck: no release marker resolved -> unverified (no diff boundary)", () => {
  const dir = bareRepository();
  fs.writeFileSync(path.join(dir, "CHANGELOG.md"), "# Changelog\n", "utf8");
  const marker = resolveMarker(dir); // no tags -> found:false
  const result = changelogTouchedCheck(dir, marker);
  assert.strictEqual(result.status, "unverified");
});

test("changelogTouchedCheck: CHANGELOG.md changed since the marker -> pass", () => {
  const dir = bareRepository();
  fs.writeFileSync(path.join(dir, "CHANGELOG.md"), "# Changelog\n", "utf8");
  git(dir, "add", ".");
  commitAt(dir, "2026-01-02T00:00:00Z", "add changelog");
  git(dir, "tag", "v1.0.0");
  fs.appendFileSync(path.join(dir, "CHANGELOG.md"), "- new entry\n");
  git(dir, "add", ".");
  commitAt(dir, "2026-01-03T00:00:00Z", "touch changelog");
  const marker = resolveMarker(dir);
  const result = changelogTouchedCheck(dir, marker);
  assert.strictEqual(result.status, "pass");
});

test("changelogTouchedCheck: CHANGELOG.md NOT changed since the marker -> fail", () => {
  const dir = bareRepository();
  fs.writeFileSync(path.join(dir, "CHANGELOG.md"), "# Changelog\n", "utf8");
  git(dir, "add", ".");
  commitAt(dir, "2026-01-02T00:00:00Z", "add changelog");
  git(dir, "tag", "v1.0.0");
  fs.writeFileSync(path.join(dir, "unrelated.txt"), "x\n", "utf8");
  git(dir, "add", ".");
  commitAt(dir, "2026-01-03T00:00:00Z", "unrelated change only");
  const marker = resolveMarker(dir);
  const result = changelogTouchedCheck(dir, marker);
  assert.strictEqual(result.status, "fail");
});

// --- e2e: tagReadinessCheck ---

test("tagReadinessCheck: clean tree, target version not yet tagged -> pass", () => {
  const dir = bareRepository();
  const result = tagReadinessCheck(dir, { status: "not-applicable", manifests: [{ file: "package.json", version: "1.0.0" }] });
  assert.strictEqual(result.status, "pass");
});

test("tagReadinessCheck: target version already tagged -> fail (catches a real duplicate-tag mistake)", () => {
  const dir = bareRepository();
  git(dir, "tag", "v1.0.0");
  const result = tagReadinessCheck(dir, { status: "not-applicable", manifests: [{ file: "package.json", version: "1.0.0" }] });
  assert.strictEqual(result.status, "fail");
  assert.match(result.evidence, /v1\.0\.0/);
});

test("tagReadinessCheck: dirty working tree -> fail", () => {
  const dir = bareRepository();
  fs.writeFileSync(path.join(dir, "dirty.txt"), "uncommitted\n", "utf8");
  const result = tagReadinessCheck(dir, { status: "not-applicable", manifests: [{ file: "package.json", version: "1.0.0" }] });
  assert.strictEqual(result.status, "fail");
  assert.match(result.evidence, /dirty/);
});

test("tagReadinessCheck: upstream version-consistency FAIL -> unverified, never guesses a target version", () => {
  const dir = bareRepository();
  const result = tagReadinessCheck(dir, { status: "fail", manifests: [{ file: "a", version: "1.0.0" }, { file: "b", version: "2.0.0" }] });
  assert.strictEqual(result.status, "unverified");
  assert.match(result.evidence, /version-consistency/);
});

test("tagReadinessCheck: upstream version-consistency UNVERIFIED -> unverified", () => {
  const dir = bareRepository();
  const result = tagReadinessCheck(dir, { status: "unverified", manifests: [] });
  assert.strictEqual(result.status, "unverified");
});

test("tagReadinessCheck: version-consistency not-applicable with NO manifest at all -> not-applicable (no version concept in this project)", () => {
  const dir = bareRepository();
  const result = tagReadinessCheck(dir, { status: "not-applicable", manifests: [] });
  assert.strictEqual(result.status, "not-applicable");
});

test("tagReadinessCheck: shallow clone with no locally-visible tag -> unverified, not a false pass (the tag may exist upstream without having been fetched -- exactly the duplicate-tag mistake this check exists to catch)", () => {
  const dir = bareRepository();
  fs.writeFileSync(path.join(dir, ".git", "shallow"), "", "utf8");
  const result = tagReadinessCheck(dir, { status: "not-applicable", manifests: [{ file: "package.json", version: "1.0.0" }] });
  assert.strictEqual(result.status, "unverified");
  assert.match(result.evidence, /history truncated — weak-signal only/);
});

test("tagReadinessCheck: shallow clone with a DIRTY working tree still reports unverified (not a fail), since the tag-existence question is unresolved regardless of tree cleanliness", () => {
  const dir = bareRepository();
  fs.writeFileSync(path.join(dir, ".git", "shallow"), "", "utf8");
  fs.writeFileSync(path.join(dir, "dirty.txt"), "uncommitted\n", "utf8");
  const result = tagReadinessCheck(dir, { status: "not-applicable", manifests: [{ file: "package.json", version: "1.0.0" }] });
  assert.strictEqual(result.status, "unverified");
});

test("tagReadinessCheck: shallow clone does NOT suppress a genuine existing-tag fail when the tag IS visible locally (a positive local match stays trustworthy)", () => {
  const dir = bareRepository();
  git(dir, "tag", "v1.0.0");
  fs.writeFileSync(path.join(dir, ".git", "shallow"), "", "utf8");
  const result = tagReadinessCheck(dir, { status: "not-applicable", manifests: [{ file: "package.json", version: "1.0.0" }] });
  assert.strictEqual(result.status, "fail");
  assert.match(result.evidence, /v1\.0\.0/);
});

// --- e2e: migrationCompatibilityCheck ---

test("migrationCompatibilityCheck: no SYSTEM_MAP.md at all -> unverified, recommends /ctide:map", () => {
  const dir = bareRepository();
  const result = migrationCompatibilityCheck(dir);
  assert.strictEqual(result.status, "unverified");
  assert.match(result.recommendation, /\/ctide:map/);
});

test("migrationCompatibilityCheck: fresh Map, well-formed non-unverified trust tag -> pass, surfaces the raw Rollback prose for the coordinating thread's own relevance read", () => {
  const dir = bareRepository();
  const head = git(dir, "rev-parse", "HEAD");
  writeMapDoc(dir, {
    commit: head,
    rollbackLines: ["- Exact steps: run scripts/rollback.sh  (verified: 2026-01-01) <!-- CTIDE:TRUST:verified:2026-01-01 -->"],
  });
  const result = migrationCompatibilityCheck(dir);
  assert.strictEqual(result.status, "pass");
  assert.strictEqual(result.stale, false);
  assert.match(result.rollbackText, /scripts\/rollback\.sh/);
});

test("migrationCompatibilityCheck: stale Map (recorded commit != current HEAD) -> unverified, discloses staleness", () => {
  const dir = bareRepository();
  writeMapDoc(dir, {
    commit: "0000000000000000000000000000000000000000",
    rollbackLines: ["- Exact steps: run scripts/rollback.sh  (verified: 2026-01-01) <!-- CTIDE:TRUST:verified:2026-01-01 -->"],
  });
  const result = migrationCompatibilityCheck(dir);
  assert.strictEqual(result.status, "unverified");
  assert.strictEqual(result.stale, true);
  assert.match(result.evidence, /stale/);
});

test("migrationCompatibilityCheck: a stale Map that ALSO has no CTIDE:TRUST tag discloses staleness in the evidence TEXT too, not only in the structured `stale` field -- regardless of which condition (missing tag here) is matched first", () => {
  const dir = bareRepository();
  writeMapDoc(dir, {
    commit: "0000000000000000000000000000000000000000",
    rollbackLines: ["- Exact steps: run scripts/rollback.sh (no machine tag on this line)"],
  });
  const result = migrationCompatibilityCheck(dir);
  assert.strictEqual(result.status, "unverified");
  assert.strictEqual(result.stale, true);
  assert.match(result.evidence, /no CTIDE:TRUST tag/);
  assert.match(result.evidence, /stale/i);
});

test("migrationCompatibilityCheck: a stale Map whose trust tag(s) are ALL unverified discloses staleness in the evidence TEXT too, not only in the structured `stale` field", () => {
  const dir = bareRepository();
  writeMapDoc(dir, {
    commit: "0000000000000000000000000000000000000000",
    rollbackLines: ["- UNVERIFIED: rollback steps require Cartographer confirmation. <!-- CTIDE:TRUST:unverified -->"],
  });
  const result = migrationCompatibilityCheck(dir);
  assert.strictEqual(result.status, "unverified");
  assert.strictEqual(result.stale, true);
  assert.match(result.evidence, /unverified/);
  assert.match(result.evidence, /stale/i);
});

test("migrationCompatibilityCheck: Rollback content itself marked UNVERIFIED (trust tag tier unverified) -> unverified", () => {
  const dir = bareRepository();
  const head = git(dir, "rev-parse", "HEAD");
  writeMapDoc(dir, {
    commit: head,
    rollbackLines: ["- UNVERIFIED: rollback steps require Cartographer confirmation. <!-- CTIDE:TRUST:unverified -->"],
  });
  const result = migrationCompatibilityCheck(dir);
  assert.strictEqual(result.status, "unverified");
  assert.match(result.evidence, /unverified/);
});

test("migrationCompatibilityCheck: Rollback section present but carries no CTIDE:TRUST tag at all -> unverified", () => {
  const dir = bareRepository();
  const head = git(dir, "rev-parse", "HEAD");
  writeMapDoc(dir, { commit: head, rollbackLines: ["- Exact steps: run scripts/rollback.sh (no machine tag on this line)"] });
  const result = migrationCompatibilityCheck(dir);
  assert.strictEqual(result.status, "unverified");
  assert.match(result.evidence, /no CTIDE:TRUST tag/);
});

test("migrationCompatibilityCheck: a malformed trust tag -> unverified, names it, distinct from the missing-tag case", () => {
  const dir = bareRepository();
  const head = git(dir, "rev-parse", "HEAD");
  writeMapDoc(dir, { commit: head, rollbackLines: ["- Exact steps: run scripts/rollback.sh <!-- CTIDE:TRUST:bogus-tier -->"] });
  const result = migrationCompatibilityCheck(dir);
  assert.strictEqual(result.status, "unverified");
  assert.match(result.evidence, /malformed/);
});

test("migrationCompatibilityCheck: SYSTEM_MAP.md exists but has no Rollback section -> unverified", () => {
  const dir = bareRepository();
  const target = path.join(dir, ".ctide", "map", "SYSTEM_MAP.md");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "# System Map\n\nVerified at commit: " + git(dir, "rev-parse", "HEAD") + "\n\n## System overview\n\n- x\n", "utf8");
  const result = migrationCompatibilityCheck(dir);
  assert.strictEqual(result.status, "unverified");
  assert.match(result.evidence, /no Rollback section/);
});

// --- e2e: checksumVerifyCheck (async since checksumVerifyCheck streams the artifact hash) ---

function sha256Hex(buf) { return crypto.createHash("sha256").update(buf).digest("hex"); }

test("checksumVerifyCheck: neither --artifact nor --checksum -> not-applicable", async () => {
  const dir = temporary("ctide-ship-cs-");
  const result = await checksumVerifyCheck(dir, "", "");
  assert.strictEqual(result.status, "not-applicable");
});

test("checksumVerifyCheck: only --artifact supplied -> unverified", async () => {
  const dir = temporary("ctide-ship-cs-");
  const result = await checksumVerifyCheck(dir, "artifact.tar.gz", "");
  assert.strictEqual(result.status, "unverified");
});

test("checksumVerifyCheck: only --checksum supplied -> unverified", async () => {
  const dir = temporary("ctide-ship-cs-");
  const result = await checksumVerifyCheck(dir, "", "artifact.tar.gz.sha256");
  assert.strictEqual(result.status, "unverified");
});

test("checksumVerifyCheck: artifact file missing -> unverified", async () => {
  const dir = temporary("ctide-ship-cs-");
  fs.writeFileSync(path.join(dir, "artifact.tar.gz.sha256"), "a".repeat(64) + "  artifact.tar.gz\n", "utf8");
  const result = await checksumVerifyCheck(dir, "artifact.tar.gz", "artifact.tar.gz.sha256");
  assert.strictEqual(result.status, "unverified");
  assert.match(result.evidence, /artifact not found/);
});

test("checksumVerifyCheck: checksum file missing -> unverified", async () => {
  const dir = temporary("ctide-ship-cs-");
  fs.writeFileSync(path.join(dir, "artifact.tar.gz"), "content\n", "utf8");
  const result = await checksumVerifyCheck(dir, "artifact.tar.gz", "artifact.tar.gz.sha256");
  assert.strictEqual(result.status, "unverified");
  assert.match(result.evidence, /checksum file not found/);
});

test("checksumVerifyCheck: checksum file is not the expected format -> unverified", async () => {
  const dir = temporary("ctide-ship-cs-");
  fs.writeFileSync(path.join(dir, "artifact.tar.gz"), "content\n", "utf8");
  fs.writeFileSync(path.join(dir, "artifact.tar.gz.sha256"), "not a hash at all\n", "utf8");
  const result = await checksumVerifyCheck(dir, "artifact.tar.gz", "artifact.tar.gz.sha256");
  assert.strictEqual(result.status, "unverified");
});

test("checksumVerifyCheck: checksum file has more than one line -> unverified", async () => {
  const dir = temporary("ctide-ship-cs-");
  const content = Buffer.from("content\n");
  fs.writeFileSync(path.join(dir, "artifact.tar.gz"), content);
  const hash = sha256Hex(content);
  fs.writeFileSync(path.join(dir, "artifact.tar.gz.sha256"), `${hash}  artifact.tar.gz\nextra line\n`, "utf8");
  const result = await checksumVerifyCheck(dir, "artifact.tar.gz", "artifact.tar.gz.sha256");
  assert.strictEqual(result.status, "unverified");
});

test("checksumVerifyCheck: matching digest ('<sha256>  <filename>' shape) -> pass", async () => {
  const dir = temporary("ctide-ship-cs-");
  const content = Buffer.from("real plugin archive bytes\n");
  fs.writeFileSync(path.join(dir, "artifact.tar.gz"), content);
  const hash = sha256Hex(content);
  fs.writeFileSync(path.join(dir, "artifact.tar.gz.sha256"), `${hash}  artifact.tar.gz\n`, "utf8");
  const result = await checksumVerifyCheck(dir, "artifact.tar.gz", "artifact.tar.gz.sha256");
  assert.strictEqual(result.status, "pass");
});

test("checksumVerifyCheck: matching digest, bare digest-only line (no filename column) -> pass", async () => {
  const dir = temporary("ctide-ship-cs-");
  const content = Buffer.from("bare digest content\n");
  fs.writeFileSync(path.join(dir, "artifact.tar.gz"), content);
  const hash = sha256Hex(content);
  fs.writeFileSync(path.join(dir, "artifact.tar.gz.sha256"), `${hash}\n`, "utf8");
  const result = await checksumVerifyCheck(dir, "artifact.tar.gz", "artifact.tar.gz.sha256");
  assert.strictEqual(result.status, "pass");
});

test("checksumVerifyCheck: mismatched digest -> fail, recommends re-running the build (not a code fix)", async () => {
  const dir = temporary("ctide-ship-cs-");
  fs.writeFileSync(path.join(dir, "artifact.tar.gz"), "actual bytes\n", "utf8");
  const wrongHash = sha256Hex(Buffer.from("different bytes\n"));
  fs.writeFileSync(path.join(dir, "artifact.tar.gz.sha256"), `${wrongHash}  artifact.tar.gz\n`, "utf8");
  const result = await checksumVerifyCheck(dir, "artifact.tar.gz", "artifact.tar.gz.sha256");
  assert.strictEqual(result.status, "fail");
  assert.match(result.evidence, /mismatch/);
});

test("checksumVerifyCheck: checksum file names a DIFFERENT file than --artifact -> fail", async () => {
  const dir = temporary("ctide-ship-cs-");
  const content = Buffer.from("content\n");
  fs.writeFileSync(path.join(dir, "artifact.tar.gz"), content);
  const hash = sha256Hex(content);
  fs.writeFileSync(path.join(dir, "artifact.tar.gz.sha256"), `${hash}  some-other-file.tar.gz\n`, "utf8");
  const result = await checksumVerifyCheck(dir, "artifact.tar.gz", "artifact.tar.gz.sha256");
  assert.strictEqual(result.status, "fail");
});

test("checksumVerifyCheck: a several-MB artifact still hashes correctly via the streaming read path (fs.createReadStream, chunk-accumulated into the digest -- never the whole file in memory at once) -> pass", async () => {
  const dir = temporary("ctide-ship-cs-stream-");
  // Several MB -> several dozen chunks at the default 64KB highWaterMark, genuinely exercising the
  // multi-chunk streaming path rather than a single-read edge case.
  const content = crypto.randomBytes(3 * 1024 * 1024);
  fs.writeFileSync(path.join(dir, "artifact.tar.gz"), content);
  const hash = sha256Hex(content);
  fs.writeFileSync(path.join(dir, "artifact.tar.gz.sha256"), `${hash}  artifact.tar.gz\n`, "utf8");
  const result = await checksumVerifyCheck(dir, "artifact.tar.gz", "artifact.tar.gz.sha256");
  assert.strictEqual(result.status, "pass");
});

// --- e2e: CLI integration / KNOWN_FLAGS ---

test("KNOWN_FLAGS covers every flag the CLI's get() closure is queried with", () => {
  assert.deepStrictEqual([...KNOWN_FLAGS].sort(), ["--artifact", "--checksum", "--cwd", "--json"].sort());
});

// --- e2e: ship whole-class flag-swallow guard (get() itself guards EVERY flag in this file's own
// KNOWN_FLAGS -- the same shared-mechanism fix run-consolidate.mjs / run-reconcile.mjs / run-ledger.mjs
// apply over their own flag sets. `--json` is a boolean flag read via `args.includes`, not `get()` -- it
// has no value position of its own to attack, so it is excluded from the OUTER (attacked) loop below, but
// it stays a full member of KNOWN_FLAGS and appears in the INNER (swallower) loop. A fixture repo tagged
// v1.0.0 with a matching artifact/checksum pair makes marker.found/marker.tag (the --cwd discriminator)
// and checksumVerify's evidence (the --artifact/--checksum discriminator) both independent of which
// flag's value got swallowed.) ---

test("ship: for EVERY value-bearing flag in KNOWN_FLAGS, a value slot occupied by any OTHER known flag's own name (including the boolean --json) is treated as omitted, never as a literal value -- --cwd's swallow never misdirects the read to a bogus, nonexistent '<flag-name>' subdirectory, and --artifact/--checksum's swallow never treats the neighboring flag's own name as a literal path", async () => {
  const VALUE_FLAGS = KNOWN_FLAGS.filter((f) => f !== "--json");
  const legitValues = { "--artifact": "artifact.tar.gz", "--checksum": "artifact.tar.gz.sha256" };
  for (const F of VALUE_FLAGS) {
    for (const G of KNOWN_FLAGS) {
      if (G === F) continue;
      const dir = bareRepository();
      git(dir, "tag", "v1.0.0");
      const content = Buffer.from("swallow-guard artifact bytes\n");
      fs.writeFileSync(path.join(dir, "artifact.tar.gz"), content);
      fs.writeFileSync(path.join(dir, "artifact.tar.gz.sha256"), `${sha256Hex(content)}  artifact.tar.gz\n`, "utf8");

      // Order: G's own legitimate occurrence FIRST, then every other flag, then F LAST with its value slot
      // occupied by the literal token G (mirrors run-consolidate.test.mjs's identical loop-test ordering).
      const order = [G, ...KNOWN_FLAGS.filter((x) => x !== F && x !== G), F];
      const argv = [];
      for (const flagName of order) {
        if (flagName === F) argv.push(F, G); // F's own value slot swallowed by G's literal name
        else if (flagName === "--cwd") argv.push("--cwd", dir);
        else if (flagName === "--json") argv.push("--json"); // bare boolean, no value slot
        else argv.push(flagName, legitValues[flagName]);
      }
      // Hermetic: strip CLAUDE_PROJECT_DIR so --cwd's fallback resolves to the spawned process's own cwd
      // (this fixture repo), never a developer's ambient project dir.
      const env = { ...process.env };
      delete env.CLAUDE_PROJECT_DIR;
      const result = cp.spawnSync("node", [SCRIPT, ...argv], { cwd: dir, encoding: "utf8", env });
      assert.strictEqual(result.status, 0, `${F} swallowed by ${G} must still exit 0 (fail-open): ${result.stderr}`);
      const report = JSON.parse(result.stdout.trim());

      assert.strictEqual(report.marker.found, true, `${F} swallowed by ${G}: --cwd must still resolve to the real tagged repo`);
      assert.strictEqual(report.marker.tag, "v1.0.0", `${F} swallowed by ${G}: --cwd must not be misdirected to a bogus '${G}' subdirectory`);

      if (F === "--artifact" || F === "--checksum") {
        assert.strictEqual(report.checks.checksumVerify.status, "unverified", `${F} swallowed by ${G}: checksumVerify status`);
        assert.match(report.checks.checksumVerify.evidence, /required together/,
          `${F} swallowed by ${G}: evidence must be the "required together" gap, not a bogus "not found: ${G}" (which would mean the swallowed value fell through to G's literal name instead of ${F}'s own default)`);
      }
    }
  }
});

test("CLI --json emits one parseable JSON object with marker/pending/checks", () => {
  const dir = bareRepository();
  writeLedger(dir, [runRecord({ ts: 1 })]);
  const out = runShip(dir, ["--cwd", ".", "--json"]);
  const parsed = JSON.parse(out);
  assert.ok("marker" in parsed && "pending" in parsed && "checks" in parsed);
  assert.ok(["versionConsistency", "changelogTouched", "tagReady", "migrationCompat", "checksumVerify"]
    .every((name) => name in parsed.checks));
});

test("CLI text mode (no --json) prints 'nothing pending to ship' when the ledger has no READY runs since the marker", () => {
  const dir = bareRepository();
  const out = runShip(dir, ["--cwd", "."]);
  assert.match(out, /nothing pending to ship/);
});

test("buildShipReport: end-to-end pending count matches the READY runs strictly after the resolved marker", async () => {
  const dir = bareRepository();
  const headBeforeTag = git(dir, "rev-parse", "HEAD");
  const beforeTagCommitCt = Number(git(dir, "log", "-1", "--format=%ct", headBeforeTag));
  git(dir, "tag", "v1.0.0");
  writeLedger(dir, [
    runRecord({ ts: (beforeTagCommitCt - 100) * 1000, head: "old" }),  // before the marker -> excluded
    runRecord({ ts: (beforeTagCommitCt + 100) * 1000, head: "new1" }), // after the marker -> included
    runRecord({ ts: (beforeTagCommitCt + 200) * 1000, head: "new2", verdict: "FIX REQUIRED" }), // non-READY -> excluded
  ]);
  const report = await buildShipReport(dir, {});
  assert.strictEqual(report.marker.tag, "v1.0.0");
  assert.deepStrictEqual(report.pending.map((p) => p.head), ["new1"]);
});

// --- unit: buildErrorFallbackReport (main()'s otherwise-unreachable outer catch-all -- every check above
// already swallows its own fs/git/parse failures, so this path can only be exercised directly, not by
// forcing a real crash through the CLI; a deep-recursion/OOM trigger is real but too filesystem/OS-
// dependent to fixture reliably in a fast, portable unit test) ---

test("buildErrorFallbackReport: the JSON-mode fallback now carries the error detail too, not just text mode -- and stays path-hygienic (safeErrorCode, never a raw .message that could embed a local absolute path)", () => {
  const error = new Error("ENOENT: no such file or directory, open 'C:\\Users\\someone\\secret-project\\file.txt'");
  error.code = "ENOENT";
  const fallback = buildErrorFallbackReport(error);
  assert.strictEqual(fallback.marker.found, false);
  assert.deepStrictEqual(fallback.pending, []);
  assert.deepStrictEqual(fallback.checks, {});
  assert.match(fallback.marker.note, /ENOENT/);
  assert.ok(!fallback.marker.note.includes("secret-project"), "must never leak the raw error message or a local path");
});

test("buildErrorFallbackReport: an error with no usable .code degrades to the fixed 'read error' string, never a raw message", () => {
  const error = new TypeError("Cannot read properties of undefined (reading 'foo') at C:\\Users\\someone\\project\\file.js:42");
  const fallback = buildErrorFallbackReport(error);
  assert.match(fallback.marker.note, /read error/);
  assert.ok(!fallback.marker.note.includes("Users"), "must never leak the raw error message or a local path");
});

// --- zero-writes invariant: byte-identical whole-tree snapshot before/after (discriminating, not a
// structural mirror — see FAILURE_MEMORY 2026-07-11 on always-green mirror tests) ---

test("ship.mjs NEVER writes anything — whole working-tree (incl. .ctide/) byte-identical snapshot before and after a real run", () => {
  const dir = bareRepository();
  commitAt(dir, "2026-01-02T00:00:00Z", "second");
  git(dir, "tag", "v1.0.0");
  writePkg(dir, "package.json", JSON.stringify({ version: "1.0.0" }));
  fs.writeFileSync(path.join(dir, "CHANGELOG.md"), "# Changelog\n", "utf8");
  writeLedger(dir, [runRecord({ ts: Date.now() })]);
  writeMapDoc(dir, { commit: git(dir, "rev-parse", "HEAD"), rollbackLines: ["- Exact steps: x <!-- CTIDE:TRUST:verified:2026-01-01 -->"] });
  fs.writeFileSync(path.join(dir, "artifact.tar.gz"), "bytes\n", "utf8");
  fs.writeFileSync(path.join(dir, "artifact.tar.gz.sha256"), sha256Hex(Buffer.from("bytes\n")) + "  artifact.tar.gz\n", "utf8");

  const before = snapshotTree(dir);
  runShip(dir, ["--cwd", ".", "--json", "--artifact", "artifact.tar.gz", "--checksum", "artifact.tar.gz.sha256"]);
  const after = snapshotTree(dir);
  assertSameSnapshot(before, after);
});

// --- fail-open: missing git / missing ledger / corrupt ledger JSON all still exit 0, valid JSON ---

test("fail-open: a missing git repository still exits 0 and prints valid, well-shaped JSON", () => {
  const dir = temporary("ctide-ship-fo-nogit-");
  const result = cp.spawnSync("node", [SCRIPT, "--cwd", dir, "--json"], { encoding: "utf8" });
  assert.strictEqual(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.strictEqual(parsed.marker.found, false);
  assert.deepStrictEqual(parsed.pending, []);
});

test("fail-open: a missing ledger file still exits 0 with an empty pending list", () => {
  const dir = bareRepository();
  const result = cp.spawnSync("node", [SCRIPT, "--cwd", dir, "--json"], { encoding: "utf8" });
  assert.strictEqual(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.deepStrictEqual(parsed.pending, []);
});

test("fail-open: a ledger file that is entirely corrupt JSON still exits 0 with an empty pending list, no uncaught exception", () => {
  const dir = bareRepository();
  fs.mkdirSync(path.dirname(ledgerPath(dir)), { recursive: true });
  fs.writeFileSync(ledgerPath(dir), "not json at all\n{{{ broken\n", "utf8");
  const result = cp.spawnSync("node", [SCRIPT, "--cwd", dir, "--json"], { encoding: "utf8" });
  assert.strictEqual(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.deepStrictEqual(parsed.pending, []);
  assert.strictEqual(result.stderr, "");
});

test("fail-open: a malformed package.json alongside a missing Map and no tags still exits 0 with every check reporting a defined status", () => {
  const dir = bareRepository();
  writePkg(dir, "package.json", "{ this is not valid json");
  const result = cp.spawnSync("node", [SCRIPT, "--cwd", dir, "--json"], { encoding: "utf8" });
  assert.strictEqual(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  for (const check of Object.values(parsed.checks)) {
    assert.ok(["pass", "fail", "not-applicable", "unverified"].includes(check.status));
  }
});
