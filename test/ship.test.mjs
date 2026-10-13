// Tests for ship.mjs — the read-only release-readiness report. Pure unit tests for the fs/git-free
// logic (marker ordering), e2e tests spawning the real CLI against constructed temp git repos for
// everything that inherently needs file/git state (the pending view and the five checks). The
// load-bearing properties: marker resolution orders by VERSION not lexicographic string sort; the
// pending view lists the commits and changed files since the latest vX.Y.Z tag reachable from HEAD,
// always says it is not a readiness claim, and discloses every state in which it cannot list (no tag,
// shallow clone, not a git repo, git unavailable) instead of returning an empty list; every check
// distinguishes `not-applicable` (the concept doesn't apply) from `unverified` (it applies but could
// not be confirmed) and never silently treats an unreadable/malformed input as clean; tag-readiness
// refuses to guess a target version when version-consistency itself is not trustworthy; ship.mjs
// NEVER writes anything, proven by a byte-identical whole-tree snapshot, not just asserted in prose;
// and the CLI always exits 0, even fed a missing git repo, git missing from PATH, or corrupt JSON.
import { test } from "node:test";
import assert from "node:assert";
import cp from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  parseVersionTag, pickLatestVersionTag,
  PENDING_COMMIT_CAP, PENDING_FILE_CAP, resolveMarker, versionConsistencyCheck, changelogTouchedCheck, tagReadinessCheck,
  migrationCompatibilityCheck, checksumVerifyCheck, buildShipReport, KNOWN_FLAGS,
  buildErrorFallbackReport,
} from "../cressetide/skills/ship/scripts/ship.mjs";
import { hardenGitSigning } from "./helpers.mjs";
import { mkTranscript, orch } from "./support.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(root, "cressetide", "skills", "ship", "scripts", "ship.mjs");
// The verbatim disclaimer ship-contract.md and ship SKILL.md require — asserted as this literal, never
// via the module's own export, so a reworded disclaimer cannot pass by agreeing with itself.
const DISCLAIMER = "changes since the last release tag — not a readiness claim; nothing listed here has been reviewed or approved";

function temporary(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

function git(cwd, ...args) {
  return cp.execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

// A commit with a FULLY deterministic committer date, so marker resolution's commit-time comparisons
// never depend on real elapsed wall-clock time (flake-proof).
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
// whether ship.mjs itself wrote anything). This still covers the whole `.ctide/` tree and every other
// working-tree file — everything the zero-writes invariant needs to prove.
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

// --- e2e: resolveMarker ---

test("resolveMarker: no vX.Y.Z tag at all falls open with a disclosed note", () => {
  const dir = bareRepository();
  const marker = resolveMarker(dir);
  assert.strictEqual(marker.found, false);
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
// KNOWN_FLAGS -- the same shared-mechanism fix the sibling CLI scripts apply over their own flag sets. `--json` is a boolean flag read via `args.includes`, not `get()` -- it
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
      // occupied by the literal token G (mirrors the sibling CLI tests' identical loop-test ordering).
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
  const out = runShip(dir, ["--cwd", ".", "--json"]);
  const parsed = JSON.parse(out);
  assert.ok("marker" in parsed && "pending" in parsed && "checks" in parsed);
  assert.strictEqual(parsed.pending.disclaimer, DISCLAIMER);
  assert.ok(["versionConsistency", "changelogTouched", "tagReady", "migrationCompat", "checksumVerify"]
    .every((name) => name in parsed.checks));
});

// --- e2e: pending view (git-derived: commits and changed files since the latest vX.Y.Z tag reachable
// from HEAD; never a readiness claim; every no-list state disclosed) ---

const FIVE_CHECKS = ["versionConsistency", "changelogTouched", "tagReady", "migrationCompat", "checksumVerify"];

function assertFiveChecksRan(report) {
  assert.deepStrictEqual(Object.keys(report.checks), FIVE_CHECKS, "all five readiness checks run, in order");
  for (const check of Object.values(report.checks)) {
    assert.ok(["pass", "fail", "not-applicable", "unverified"].includes(check.status), `defined status: ${check.status}`);
  }
}

// The whole output, nothing stripped: the disclaimer is stated verbatim and no READY token appears
// anywhere — not even inside the disclaimer, since the Stop hook reads any READY in a final message
// as an asserted verdict.
function assertNoReadyClaim(text) {
  assert.ok(text.includes(DISCLAIMER), "the verbatim disclaimer is stated");
  assert.match(text, /not a readiness claim/);
  assert.doesNotMatch(text, /\bREADY\b/, "no READY token anywhere in the output");
}

// A non-ok pending state is stated with its note (ship SKILL.md, Report shape): the line that prints
// pending.note also names pending.state. The label's case and the line layout are not pinned.
function assertStateStatedWithNote(text, pending) {
  const line = text.split(/\r?\n/).find((l) => l.includes(pending.note));
  assert.ok(line, "pending.note is printed verbatim");
  assert.ok(line.toLowerCase().includes(pending.state.toLowerCase()), `the note's line names the state ${pending.state}`);
}

function commitFile(cwd, relPath, content, isoDate, message) {
  writePkg(cwd, relPath, content);
  git(cwd, "add", ".");
  commitAt(cwd, isoDate, message);
}

// Git writes loose objects read-only, and Windows refuses to unlink a read-only file — clear the bit first.
function deleteLooseObject(dir, sha) {
  const file = path.join(dir, ".git", "objects", sha.slice(0, 2), sha.slice(2));
  assert.ok(fs.existsSync(file), `fixture sanity: object ${sha} is a loose object`);
  fs.chmodSync(file, 0o666);
  fs.unlinkSync(file);
}

function sortedSubjects(pending) { return pending.commits.map((c) => c.subject).sort(); }

test("pending view: a tagged release followed by one new, ordinary (non-vigil) commit lists that commit and its changed files since the LATEST reachable tag, and states it is not a readiness claim", async () => {
  const dir = bareRepository();
  git(dir, "tag", "v1.0.0");
  fs.writeFileSync(path.join(dir, "between.txt"), "released in 1.1.0\n", "utf8");
  git(dir, "add", ".");
  commitAt(dir, "2026-01-02T00:00:00Z", "change released in v1.1.0");
  git(dir, "tag", "-a", "v1.1.0", "-m", "release 1.1.0"); // annotated: the base must dereference to its commit
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "feature.js"), "export const feature = 1;\n", "utf8");
  fs.appendFileSync(path.join(dir, "a.txt"), "edited\n");
  git(dir, "add", ".");
  commitAt(dir, "2026-01-03T00:00:00Z", "add feature by hand");
  const newCommit = git(dir, "rev-parse", "--short", "HEAD");

  const report = await buildShipReport(dir, {});
  assert.strictEqual(report.pending.state, "ok");
  assert.strictEqual(report.pending.disclaimer, DISCLAIMER);
  assert.strictEqual(report.pending.tag, "v1.1.0", "the base is the latest reachable vX.Y.Z tag, not the first one");
  assert.strictEqual(report.pending.commitCount, 1);
  assert.deepStrictEqual(report.pending.commits, [{ sha: newCommit, subject: "add feature by hand" }]);
  assert.strictEqual(report.pending.commitsTruncated, false);
  assert.deepStrictEqual([...report.pending.files].sort(), ["a.txt", "src/feature.js"]);
  assert.strictEqual(report.pending.fileCount, 2);
  assert.strictEqual(report.pending.filesTruncated, false);
  assert.ok(!report.pending.files.includes("between.txt"), "a change already inside v1.1.0 is not pending");
  assertFiveChecksRan(report);

  const out = runShip(dir, ["--cwd", "."]);
  const json = runShip(dir, ["--cwd", ".", "--json"]);
  assert.ok(out.includes(newCommit) && out.includes("add feature by hand"), "the commit is listed in text mode");
  assert.ok(out.includes("src/feature.js"), "the changed file is listed in text mode");
  assert.ok(out.includes(JSON.parse(json).pending.note), "the pending note is printed");
  assertNoReadyClaim(out);
  assertNoReadyClaim(json);
});

test("pending view: no vX.Y.Z tag reachable from HEAD is disclosed as no-release-tag, never an empty list read as 'nothing to ship'", async () => {
  const dir = bareRepository();
  git(dir, "tag", "nightly"); // a non-release tag never counts as the boundary
  fs.writeFileSync(path.join(dir, "b.txt"), "b\n", "utf8");
  git(dir, "add", ".");
  commitAt(dir, "2026-01-02T00:00:00Z", "unreleased work");

  const report = await buildShipReport(dir, {});
  assert.strictEqual(report.pending.state, "no-release-tag");
  assert.strictEqual(report.pending.commitCount, null, "no count is claimed without a boundary");
  assert.deepStrictEqual(report.pending.commits, []);
  assertFiveChecksRan(report);

  const out = runShip(dir, ["--cwd", "."]);
  assertStateStatedWithNote(out, report.pending);
  assert.doesNotMatch(out, /nothing pending/i);
  assertNoReadyClaim(out);
});

test("pending view: a real shallow clone (git clone --depth 1) is disclosed as shallow-clone — history cannot be bounded, so no list and no count are claimed", async () => {
  const origin = bareRepository();
  git(origin, "tag", "v1.0.0");
  for (const day of ["02", "03"]) {
    fs.writeFileSync(path.join(origin, `f${day}.txt`), day + "\n", "utf8");
    git(origin, "add", ".");
    commitAt(origin, `2026-01-${day}T00:00:00Z`, `work ${day}`);
  }
  const clone = path.join(temporary("ctide-ship-shallow-"), "clone");
  git(path.dirname(clone), "clone", "-q", "--depth", "1", pathToFileURL(origin).href, clone);
  assert.strictEqual(git(clone, "rev-parse", "--is-shallow-repository"), "true", "fixture sanity: the clone is really shallow");

  const report = await buildShipReport(clone, {});
  assert.strictEqual(report.pending.state, "shallow-clone");
  assert.strictEqual(report.pending.commitCount, null);
  assert.deepStrictEqual(report.pending.commits, []);
  assert.deepStrictEqual(report.pending.files, []);
  assertFiveChecksRan(report);

  const out = runShip(clone, ["--cwd", "."]);
  assertStateStatedWithNote(out, report.pending);
  assertNoReadyClaim(out);
});

// A depth-limited clone of a merge history in which the tagged commit IS fetched but part of a merged
// side branch is not: counting from the tag inside the clone silently undercounts (4 commits instead of
// 6), which is exactly what the shallow-clone state exists to prevent.
//   main: A ─ T(v1.0.0) ─ m1 ─ M(merge)      side (from A): s1 ─ s2 ─ s3 ─ s4 ─┘
function shallowMergeClone() {
  const origin = bareRepository(); // A
  git(origin, "checkout", "-q", "-b", "side");
  for (const n of [1, 2, 3, 4]) commitFile(origin, `src/side${n}.txt`, `${n}\n`, `2026-01-0${n + 1}T00:00:00Z`, `side ${n}`);
  git(origin, "checkout", "-q", "main");
  commitFile(origin, "src/tagged.txt", "t\n", "2026-01-06T00:00:00Z", "tagged");
  git(origin, "tag", "v1.0.0");
  commitFile(origin, "src/main1.txt", "m\n", "2026-01-07T00:00:00Z", "main 1");
  cp.execFileSync("git", ["merge", "-q", "--no-ff", "-m", "merge side", "side"], {
    cwd: origin, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_AUTHOR_DATE: "2026-01-08T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-08T00:00:00Z" },
  });
  const clone = path.join(temporary("ctide-ship-shallow-merge-"), "clone");
  git(path.dirname(clone), "clone", "-q", "--depth", "3", pathToFileURL(origin).href, clone);
  assert.strictEqual(git(clone, "rev-parse", "--is-shallow-repository"), "true", "fixture sanity: the clone is shallow");
  assert.ok(git(clone, "tag", "--list").split(/\r?\n/).includes("v1.0.0"), "fixture sanity: the tagged commit was fetched with its tag");
  assert.strictEqual(git(origin, "rev-list", "--count", "v1.0.0..HEAD"), "6", "fixture sanity: 6 commits since the tag in full history");
  assert.strictEqual(git(clone, "rev-list", "--count", "v1.0.0..HEAD"), "4", "fixture sanity: the shallow clone sees only 4 of them");
  return clone;
}

test("pending view: a subdirectory --cwd or a linked-worktree --cwd of a shallow clone is still shallow-clone — never an ok list that undercounts the commits since the tag", async () => {
  const clone = shallowMergeClone();
  const worktree = path.join(temporary("ctide-ship-shallow-wt-"), "wt");
  git(clone, "worktree", "add", "-q", "--detach", worktree, "HEAD");
  const seen = {};
  for (const [where, cwd] of [["root", clone], ["subdirectory", path.join(clone, "src")], ["worktree", worktree]]) {
    const report = await buildShipReport(cwd, {});
    const { state, commitCount, commits, files } = report.pending;
    seen[where] = { state, commitCount, commits: commits.length, files: files.length };
    assertFiveChecksRan(report);
  }
  const shallow = { state: "shallow-clone", commitCount: null, commits: 0, files: 0 };
  assert.deepStrictEqual(seen, { root: shallow, subdirectory: shallow, worktree: shallow },
    "every --cwd inside the shallow clone is shallow-clone, with no count and no list");
});

test("pending view: a non-git directory is disclosed as not-a-git-repo, the CLI exits 0 in both modes, and the five checks still run", () => {
  const dir = temporary("ctide-ship-pending-nongit-");
  const json = cp.spawnSync("node", [SCRIPT, "--cwd", dir, "--json"], { encoding: "utf8" });
  assert.strictEqual(json.status, 0);
  assert.strictEqual(json.stderr, "");
  const parsed = JSON.parse(json.stdout);
  assert.strictEqual(parsed.pending.state, "not-a-git-repo");
  assert.deepStrictEqual(parsed.pending.commits, []);
  assert.strictEqual(parsed.pending.commitCount, null);
  assertFiveChecksRan(parsed);

  const text = cp.spawnSync("node", [SCRIPT, "--cwd", dir], { encoding: "utf8" });
  assert.strictEqual(text.status, 0);
  assertStateStatedWithNote(text.stdout, parsed.pending);
  assertNoReadyClaim(text.stdout);
});

test("pending view: git missing from PATH is disclosed as git-unavailable and the CLI still exits 0", () => {
  const dir = bareRepository();
  const emptyBin = temporary("ctide-ship-nogit-path-");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path"));
  env.PATH = emptyBin;
  const result = cp.spawnSync(process.execPath, [SCRIPT, "--cwd", dir, "--json"], { encoding: "utf8", env });
  assert.strictEqual(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.strictEqual(parsed.pending.state, "git-unavailable");
  assert.deepStrictEqual(parsed.pending.commits, []);
  assertFiveChecksRan(parsed);
});

test("pending view: zero commits since the tag is state ok with 'no commits since <tag>' — and all five readiness checks still run", async () => {
  const dir = bareRepository();
  writePkg(dir, "package.json", JSON.stringify({ version: "1.0.0" }));
  git(dir, "add", ".");
  commitAt(dir, "2026-01-02T00:00:00Z", "release 1.0.0");
  git(dir, "tag", "v1.0.0"); // lightweight
  const report = await buildShipReport(dir, {});
  assert.strictEqual(report.pending.state, "ok");
  assert.strictEqual(report.pending.commitCount, 0);
  assert.deepStrictEqual(report.pending.commits, []);
  assert.strictEqual(report.pending.fileCount, 0);
  assert.strictEqual(report.pending.note, "no commits since v1.0.0");
  assertFiveChecksRan(report);
  assert.strictEqual(report.checks.tagReady.status, "fail", "a check still reaches its own verdict with nothing pending");

  const out = runShip(dir, ["--cwd", "."]);
  assert.match(out, /no commits since v1\.0\.0/);
  assertNoReadyClaim(out);
});

test("pending view: exactly at the caps nothing is truncated; one past each cap the lists are capped with an explicit truncation note and the uncapped totals — and the five checks run either way", async () => {
  // One repository for both boundaries: first exactly PENDING_FILE_CAP files and PENDING_COMMIT_CAP
  // commits since the tag, then one more file in one more commit.
  const dir = bareRepository();
  git(dir, "tag", "v1.0.0");
  const many = path.join(dir, "many");
  fs.mkdirSync(many);
  for (let i = 1; i <= PENDING_FILE_CAP; i++) fs.writeFileSync(path.join(many, `f${i}.txt`), `${i}\n`, "utf8");
  git(dir, "add", ".");
  commitAt(dir, "2026-01-02T00:00:00Z", "add many files");
  // The remaining PENDING_COMMIT_CAP - 1 empty commits in ONE git process (fast-import), so the fixture stays fast.
  const stream = [];
  for (let i = 1; i < PENDING_COMMIT_CAP; i++) {
    stream.push("commit refs/heads/main", "committer Ship Test <ship@example.invalid> 1767312000 +0000", `data ${`c${i}`.length}`, `c${i}`);
    if (i === 1) stream.push("from refs/heads/main^0");
    stream.push("");
  }
  const imported = cp.spawnSync("git", ["fast-import", "--quiet", "--force"], { cwd: dir, input: stream.join("\n") + "\n", encoding: "utf8" });
  assert.strictEqual(imported.status, 0, `fixture sanity: fast-import failed: ${imported.stderr}`);
  assert.strictEqual(git(dir, "rev-list", "--count", "v1.0.0..HEAD"), String(PENDING_COMMIT_CAP), "fixture sanity: commit count at the cap");

  const atCap = await buildShipReport(dir, {});
  assert.strictEqual(atCap.pending.state, "ok");
  assert.strictEqual(atCap.pending.commitCount, PENDING_COMMIT_CAP);
  assert.strictEqual(atCap.pending.commits.length, PENDING_COMMIT_CAP);
  assert.strictEqual(atCap.pending.commitsTruncated, false, "exactly at the commit cap is not truncated");
  assert.strictEqual(atCap.pending.fileCount, PENDING_FILE_CAP);
  assert.strictEqual(atCap.pending.files.length, PENDING_FILE_CAP);
  assert.strictEqual(atCap.pending.filesTruncated, false, "exactly at the file cap is not truncated");
  assertFiveChecksRan(atCap);

  // fast-import moved the branch without touching the index; the commits are empty, so HEAD's tree still matches it.
  commitFile(dir, "many/extra.txt", "extra\n", "2026-01-03T00:00:00Z", "one past both caps");
  const total = PENDING_COMMIT_CAP + 1;
  assert.strictEqual(git(dir, "rev-list", "--count", "v1.0.0..HEAD"), String(total), "fixture sanity: commit count past the cap");

  const report = await buildShipReport(dir, {});
  assert.strictEqual(report.pending.state, "ok");
  assert.strictEqual(report.pending.commitCount, total);
  assert.strictEqual(report.pending.commits.length, PENDING_COMMIT_CAP);
  assert.strictEqual(report.pending.commitsTruncated, true);
  assert.strictEqual(report.pending.fileCount, PENDING_FILE_CAP + 1);
  assert.strictEqual(report.pending.files.length, PENDING_FILE_CAP);
  assert.strictEqual(report.pending.filesTruncated, true);
  assertFiveChecksRan(report);

  const out = runShip(dir, ["--cwd", "."]);
  assert.match(out, new RegExp(`truncated: showing ${PENDING_COMMIT_CAP} of ${total}`));
  assert.match(out, new RegExp(`truncated: showing ${PENDING_FILE_CAP} of ${PENDING_FILE_CAP + 1}`));
});

// --- e2e: pending boundary grammar (one release-tag grammar shared with the marker: optional `v`,
// X.Y.Z, no pre-release or extra parts; only tags reachable from HEAD) ---

test("pending view: a bare X.Y.Z tag (no v prefix) is a release boundary, as it is for the release marker", async () => {
  const dir = bareRepository();
  git(dir, "tag", "1.0.0");
  commitFile(dir, "b.txt", "b\n", "2026-01-02T00:00:00Z", "after the bare tag");
  const report = await buildShipReport(dir, {});
  assert.strictEqual(report.marker.tag, "1.0.0");
  assert.strictEqual(report.pending.state, "ok");
  assert.strictEqual(report.pending.tag, "1.0.0");
  assert.deepStrictEqual(sortedSubjects(report.pending), ["after the bare tag"]);
  assert.deepStrictEqual(report.pending.files, ["b.txt"]);
});

test("pending view: a pre-release tag is never the boundary — v1.0.0, a, v1.1.0-rc.1, b lists both a and b since v1.0.0", async () => {
  const dir = bareRepository();
  git(dir, "tag", "v1.0.0");
  commitFile(dir, "a1.txt", "a\n", "2026-01-02T00:00:00Z", "a");
  git(dir, "tag", "v1.1.0-rc.1");
  commitFile(dir, "b1.txt", "b\n", "2026-01-03T00:00:00Z", "b");
  const report = await buildShipReport(dir, {});
  assert.strictEqual(report.pending.state, "ok");
  assert.strictEqual(report.pending.tag, "v1.0.0");
  assert.strictEqual(report.pending.commitCount, 2);
  assert.deepStrictEqual(sortedSubjects(report.pending), ["a", "b"]);
});

test("pending view: a four-part tag (v1.2.3.4) is never the boundary", async () => {
  const dir = bareRepository();
  git(dir, "tag", "v1.0.0");
  commitFile(dir, "a1.txt", "a\n", "2026-01-02T00:00:00Z", "a");
  git(dir, "tag", "v1.2.3.4");
  commitFile(dir, "b1.txt", "b\n", "2026-01-03T00:00:00Z", "b");
  const report = await buildShipReport(dir, {});
  assert.strictEqual(report.pending.state, "ok");
  assert.strictEqual(report.pending.tag, "v1.0.0");
  assert.deepStrictEqual(sortedSubjects(report.pending), ["a", "b"]);
});

test("pending view: when the release marker is a tag not reachable from HEAD, the pending note names both tags", async () => {
  const dir = bareRepository();
  git(dir, "tag", "v1.0.0");
  git(dir, "checkout", "-q", "-b", "maintenance");
  commitFile(dir, "hotfix.txt", "h\n", "2026-01-02T00:00:00Z", "hotfix on another branch");
  git(dir, "tag", "v2.0.0");
  git(dir, "checkout", "-q", "main");
  commitFile(dir, "work.txt", "w\n", "2026-01-03T00:00:00Z", "work on main");
  const report = await buildShipReport(dir, {});
  assert.strictEqual(report.marker.tag, "v2.0.0", "fixture sanity: the marker is the highest-version tag overall");
  assert.strictEqual(report.pending.state, "ok");
  assert.strictEqual(report.pending.tag, "v1.0.0");
  assert.deepStrictEqual(sortedSubjects(report.pending), ["work on main"]);
  assert.ok(report.pending.note.includes("v1.0.0") && report.pending.note.includes("v2.0.0"), `note names both tags: ${report.pending.note}`);
});

test("pending view: a failed read of the tags reachable from HEAD is unverified, never no-release-tag", async () => {
  const dir = bareRepository();
  git(dir, "tag", "v1.0.0");
  commitFile(dir, "b.txt", "b\n", "2026-01-02T00:00:00Z", "unreadable head commit");
  deleteLooseObject(dir, git(dir, "rev-parse", "HEAD"));
  assert.notStrictEqual(cp.spawnSync("git", ["tag", "--merged", "HEAD"], { cwd: dir, encoding: "utf8" }).status, 0,
    "fixture sanity: listing the tags reachable from HEAD fails");
  const report = await buildShipReport(dir, {});
  assert.strictEqual(report.pending.state, "unverified");
  assert.strictEqual(report.pending.commitCount, null);
  assert.deepStrictEqual(report.pending.commits, []);
  assertFiveChecksRan(report);
});

// --- e2e: pending view read failure inside the range, file names, empty repository ---

test("pending view: a failed read of the commits or files since a found tag is unverified — no count, the five checks still run, and the text output states it", async () => {
  const dir = bareRepository();
  git(dir, "tag", "v1.0.0");
  commitFile(dir, "b.txt", "b\n", "2026-01-02T00:00:00Z", "after the tag");
  deleteLooseObject(dir, git(dir, "rev-parse", "v1.0.0^{tree}")); // the tag's root tree: the range diff cannot be read
  assert.ok(git(dir, "tag", "--merged", "HEAD").split(/\r?\n/).includes("v1.0.0"), "fixture sanity: the tag is still found");
  assert.notStrictEqual(cp.spawnSync("git", ["diff", "--name-only", "v1.0.0..HEAD"], { cwd: dir, encoding: "utf8" }).status, 0,
    "fixture sanity: the range diff fails");

  const report = await buildShipReport(dir, {});
  assert.strictEqual(report.pending.state, "unverified");
  assert.strictEqual(report.pending.commitCount, null);
  assert.deepStrictEqual(report.pending.commits, []);
  assert.deepStrictEqual(report.pending.files, []);
  assertFiveChecksRan(report);

  const out = runShip(dir, ["--cwd", "."]);
  assertStateStatedWithNote(out, report.pending);
  assertNoReadyClaim(out);
});

test("pending view: a file name with spaces and non-ASCII characters is listed verbatim", async () => {
  const dir = bareRepository();
  git(dir, "tag", "v1.0.0");
  const name = "docs/résumé ü 文件 notes.txt";
  commitFile(dir, name, "x\n", "2026-01-02T00:00:00Z", "add a unicode file name");
  const report = await buildShipReport(dir, {});
  assert.strictEqual(report.pending.state, "ok");
  assert.deepStrictEqual(report.pending.files, [name]);
});

test("pending view: an empty repository (no commits yet) is no-release-tag, the five checks still run, and the CLI exits 0", () => {
  const dir = temporary("ctide-ship-empty-");
  git(dir, "init", "-q", "--initial-branch=main");
  const result = cp.spawnSync("node", [SCRIPT, "--cwd", dir, "--json"], { encoding: "utf8" });
  assert.strictEqual(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.strictEqual(parsed.pending.state, "no-release-tag");
  assert.strictEqual(parsed.pending.commitCount, null);
  assert.deepStrictEqual(parsed.pending.commits, []);
  assertFiveChecksRan(parsed);
});

test("pending view: a renamed file is listed under both its old and its new path", async () => {
  const dir = bareRepository();
  commitFile(dir, "db/old-migration.sql", "ALTER TABLE orders ADD COLUMN discount_pct INT;\n".repeat(5), "2026-01-02T00:00:00Z", "add migration");
  git(dir, "tag", "v1.0.0");
  git(dir, "mv", "db/old-migration.sql", "db/new-migration.sql");
  commitAt(dir, "2026-01-03T00:00:00Z", "rename migration");
  const report = await buildShipReport(dir, {});
  assert.strictEqual(report.pending.state, "ok");
  assert.deepStrictEqual([...report.pending.files].sort(), ["db/new-migration.sql", "db/old-migration.sql"]);
});

test("pending view: a repository's diff.relative=true does not relativize the paths for a subdirectory --cwd", async () => {
  const dir = bareRepository();
  git(dir, "tag", "v1.0.0");
  writePkg(dir, "root.txt", "r\n");
  commitFile(dir, "sub/inner.txt", "i\n", "2026-01-02T00:00:00Z", "touch root and sub");
  git(dir, "config", "diff.relative", "true");
  const report = await buildShipReport(path.join(dir, "sub"), {});
  assert.strictEqual(report.pending.state, "ok");
  assert.deepStrictEqual([...report.pending.files].sort(), ["root.txt", "sub/inner.txt"]);
});

// --- regression: the plugin's own Stop hook must not read a ship report as an asserted READY verdict ---

test("a realistic ship report, disclaimer quoted verbatim, ends a session without tripping the Stop hook's READY/panel advisory", () => {
  const dir = bareRepository();
  git(dir, "tag", "v1.0.0");
  commitFile(dir, "src/feature.js", "export const feature = 1;\n", "2026-01-02T00:00:00Z", "add feature");
  const json = JSON.parse(runShip(dir, ["--cwd", ".", "--json"]));
  const text = runShip(dir, ["--cwd", "."]);
  const shipReport = [
    "## Ship decision card",
    "",
    `Pending changes — ${json.pending.disclaimer}:`,
    ...json.pending.commits.map((c) => `- ${c.sha} ${c.subject}`),
    ...json.pending.files.map((f) => `- ${f}`),
    "",
    ...Object.entries(json.checks).map(([name, check]) => `- ${name}: ${check.status} — ${check.evidence}`),
    "",
    "Rollback relevance: there is no SYSTEM_MAP.md, so the changed files cannot be checked against a Rollback section.",
    "",
    "Helper output:",
    text,
  ].join("\n");
  assert.ok(text.includes(json.pending.disclaimer), "fixture sanity: the report quotes ship's own disclaimer verbatim");
  const transcript = mkTranscript([
    { role: "user", content: "/ctide:ship" },
    { role: "assistant", content: shipReport },
  ]);
  assert.strictEqual(orch({ transcript_path: transcript, last_assistant_message: shipReport }), null,
    "a ship report is not a READY verdict: the Stop hook stays silent");
  const control = orch({ transcript_path: transcript, last_assistant_message: `${shipReport}\n\nFinal verdict: READY` });
  assert.ok(control && /core review panel/.test(control.systemMessage),
    "control: the same report plus an asserted READY verdict does trip the advisory, so the silence above is meaningful");
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
  assert.strictEqual(fallback.pending.state, "unverified", "an internal error never reads as an empty pending list");
  assert.deepStrictEqual(fallback.pending.commits, []);
  assert.strictEqual(fallback.pending.disclaimer, DISCLAIMER);
  assert.match(fallback.pending.note, /ENOENT/);
  assert.ok(!fallback.pending.note.includes("secret-project"), "must never leak the raw error message or a local path");
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
  writeMapDoc(dir, { commit: git(dir, "rev-parse", "HEAD"), rollbackLines: ["- Exact steps: x <!-- CTIDE:TRUST:verified:2026-01-01 -->"] });
  fs.writeFileSync(path.join(dir, "artifact.tar.gz"), "bytes\n", "utf8");
  fs.writeFileSync(path.join(dir, "artifact.tar.gz.sha256"), sha256Hex(Buffer.from("bytes\n")) + "  artifact.tar.gz\n", "utf8");

  const before = snapshotTree(dir);
  runShip(dir, ["--cwd", ".", "--json", "--artifact", "artifact.tar.gz", "--checksum", "artifact.tar.gz.sha256"]);
  const after = snapshotTree(dir);
  assertSameSnapshot(before, after);
});

// --- fail-open: a missing git repository / a malformed manifest still exit 0, valid JSON ---

test("fail-open: a missing git repository still exits 0 and prints valid, well-shaped JSON", () => {
  const dir = temporary("ctide-ship-fo-nogit-");
  const result = cp.spawnSync("node", [SCRIPT, "--cwd", dir, "--json"], { encoding: "utf8" });
  assert.strictEqual(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.strictEqual(parsed.marker.found, false);
  assert.strictEqual(parsed.pending.state, "not-a-git-repo");
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
