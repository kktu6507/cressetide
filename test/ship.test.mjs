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
import assert from "node:assert";
import cp from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  parseVersionTag, pickLatestVersionTag,
  PENDING_COMMIT_CAP, PENDING_FILE_CAP, resolveMarker, versionConsistencyCheck, changelogTouchedCheck, tagReadinessCheck,
  migrationCompatibilityCheck, checksumVerifyCheck, buildShipReport,
  buildErrorFallbackReport,
} from "../cressetide/skills/ship/scripts/ship.mjs";
import { git, makeRepo, mkTranscript, orch, sshSigningSkipReason, tempDir, test } from "./helpers.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(root, "cressetide", "skills", "ship", "scripts", "ship.mjs");
// The verbatim disclaimer ship-contract.md and ship SKILL.md require — asserted as this literal, never
// via the module's own export, so a reworded disclaimer cannot pass by agreeing with itself.
const DISCLAIMER = "changes since the last release tag — not a readiness claim; nothing listed here has been reviewed or approved";

// A commit with a FULLY deterministic committer date, so marker resolution's commit-time comparisons
// never depend on real elapsed wall-clock time (flake-proof).
function datedEnv(isoDate) { return { GIT_AUTHOR_DATE: isoDate, GIT_COMMITTER_DATE: isoDate }; }
function commitAt(cwd, isoDate, message) {
  git(cwd, ["commit", "-q", "--allow-empty", "-m", message], { env: datedEnv(isoDate) });
}

function bareRepository() {
  return makeRepo({
    prefix: "ctide-ship-bare-", name: "Ship Test", email: "ship@example.invalid",
    files: { "a.txt": "a\n" }, message: "initial", date: "2026-01-01T00:00:00Z",
  });
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

// Recursive snapshot of every FILE under `dir`, excluding `.git` (git's own bookkeeping there is not
// part of the working tree; `.git/index`, the one file a read such as `git status` could rewrite, has its
// own test: "ship.mjs never writes .git/index either"). This covers the whole `.ctide/` tree and every
// other working-tree file.
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
  git(dir, ["tag", "v1.0.0"]);
  git(dir, ["tag", "v9.0.0"]);
  git(dir, ["tag", "v10.0.0"]); // created LAST but must still win by version, matching real tag-creation order irrelevance
  const marker = resolveMarker(dir);
  assert.strictEqual(marker.found, true);
  assert.strictEqual(marker.tag, "v10.0.0");
  assert.ok(marker.commit);
});

test("resolveMarker: a non-git cwd fails open (found:false), never throws", () => {
  const dir = tempDir("ctide-ship-nongit-");
  const marker = resolveMarker(dir);
  assert.strictEqual(marker.found, false);
});

test("resolveMarker on a non-git cwd never leaks git's raw error text onto the caller's stderr (piped-stdio regression)", () => {
  const dir = tempDir("ctide-ship-nongit-stderr-");
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
  const dir = tempDir("ctide-ship-vc-");
  const result = versionConsistencyCheck(dir);
  assert.strictEqual(result.status, "not-applicable");
});

test("versionConsistencyCheck: exactly one manifest -> not-applicable (nothing to be inconsistent with)", () => {
  const dir = tempDir("ctide-ship-vc-");
  writePkg(dir, "package.json", JSON.stringify({ version: "1.0.0" }));
  const result = versionConsistencyCheck(dir);
  assert.strictEqual(result.status, "not-applicable");
  assert.match(result.evidence, /1\.0\.0/);
});

test("versionConsistencyCheck: two or more manifests agreeing -> pass", () => {
  const dir = tempDir("ctide-ship-vc-");
  writePkg(dir, "package.json", JSON.stringify({ version: "1.0.0" }));
  writePkg(dir, "packages/a/package.json", JSON.stringify({ version: "1.0.0" }));
  const result = versionConsistencyCheck(dir);
  assert.strictEqual(result.status, "pass");
});

test("versionConsistencyCheck: two or more manifests disagreeing -> fail, names every file@version", () => {
  const dir = tempDir("ctide-ship-vc-");
  writePkg(dir, "package.json", JSON.stringify({ version: "1.0.0" }));
  writePkg(dir, "packages/a/package.json", JSON.stringify({ version: "2.0.0" }));
  const result = versionConsistencyCheck(dir);
  assert.strictEqual(result.status, "fail");
  assert.match(result.evidence, /package\.json@1\.0\.0/);
  assert.match(result.evidence, /packages\/a\/package\.json@2\.0\.0/);
});

test("versionConsistencyCheck: a malformed package.json -> unverified, names the parse error, never silently treated as consistent", () => {
  const dir = tempDir("ctide-ship-vc-");
  writePkg(dir, "package.json", JSON.stringify({ version: "1.0.0" }));
  writePkg(dir, "packages/a/package.json", "{ not valid json");
  const result = versionConsistencyCheck(dir);
  assert.strictEqual(result.status, "unverified");
  assert.match(result.evidence, /packages\/a\/package\.json/);
});

test("versionConsistencyCheck: node_modules/.git/.ctide package.json files are excluded from the scan", () => {
  const dir = tempDir("ctide-ship-vc-");
  writePkg(dir, "package.json", JSON.stringify({ version: "1.0.0" }));
  writePkg(dir, "node_modules/dep/package.json", JSON.stringify({ version: "9.9.9" }));
  const result = versionConsistencyCheck(dir);
  assert.strictEqual(result.status, "not-applicable", "only the root manifest should count");
});

test("versionConsistencyCheck: a manifest with no version field at all does not count toward the comparison", () => {
  const dir = tempDir("ctide-ship-vc-");
  writePkg(dir, "package.json", JSON.stringify({ version: "1.0.0" }));
  writePkg(dir, "packages/a/package.json", JSON.stringify({ name: "no-version-field" }));
  const result = versionConsistencyCheck(dir);
  assert.strictEqual(result.status, "not-applicable");
});

test("versionConsistencyCheck: a pathologically large version field is capped, never pushed uncapped into manifests/evidence (regression: a 5MB version string previously produced a multi-megabyte report)", () => {
  const dir = tempDir("ctide-ship-vc-cap-");
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
  git(dir, ["add", "."]);
  commitAt(dir, "2026-01-02T00:00:00Z", "add changelog");
  git(dir, ["tag", "v1.0.0"]);
  fs.appendFileSync(path.join(dir, "CHANGELOG.md"), "- new entry\n");
  git(dir, ["add", "."]);
  commitAt(dir, "2026-01-03T00:00:00Z", "touch changelog");
  const marker = resolveMarker(dir);
  const result = changelogTouchedCheck(dir, marker);
  assert.strictEqual(result.status, "pass");
});

test("changelogTouchedCheck: CHANGELOG.md NOT changed since the marker -> fail", () => {
  const dir = bareRepository();
  fs.writeFileSync(path.join(dir, "CHANGELOG.md"), "# Changelog\n", "utf8");
  git(dir, ["add", "."]);
  commitAt(dir, "2026-01-02T00:00:00Z", "add changelog");
  git(dir, ["tag", "v1.0.0"]);
  fs.writeFileSync(path.join(dir, "unrelated.txt"), "x\n", "utf8");
  git(dir, ["add", "."]);
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
  git(dir, ["tag", "v1.0.0"]);
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

// ship-contract.md, tagReady: "A dirty working tree → `fail`" — and under default config an untracked file
// makes the tree dirty (the test above). Round-1 re-check follow-up: a repository's
// status.showUntrackedFiles=no must not hide that untracked file.
test("tagReadinessCheck: status.showUntrackedFiles=no does not hide an untracked file — same result as under default config", () => {
  const dir = bareRepository();
  fs.writeFileSync(path.join(dir, "untracked.txt"), "new\n", "utf8");
  const target = { status: "not-applicable", manifests: [{ file: "package.json", version: "1.0.0" }] };
  const underDefault = tagReadinessCheck(dir, target);
  assert.strictEqual(underDefault.status, "fail", "default config: an untracked file is a dirty working tree");
  git(dir, ["config", "status.showUntrackedFiles", "no"]);
  assert.strictEqual(git(dir, ["status", "--porcelain"]), "", "fixture sanity: this config hides the untracked file from git status");
  assert.strictEqual(tagReadinessCheck(dir, target).status, underDefault.status);
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
  git(dir, ["tag", "v1.0.0"]);
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
  const head = git(dir, ["rev-parse", "HEAD"]);
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
  const head = git(dir, ["rev-parse", "HEAD"]);
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
  const head = git(dir, ["rev-parse", "HEAD"]);
  writeMapDoc(dir, { commit: head, rollbackLines: ["- Exact steps: run scripts/rollback.sh (no machine tag on this line)"] });
  const result = migrationCompatibilityCheck(dir);
  assert.strictEqual(result.status, "unverified");
  assert.match(result.evidence, /no CTIDE:TRUST tag/);
});

test("migrationCompatibilityCheck: a malformed trust tag -> unverified, names it, distinct from the missing-tag case", () => {
  const dir = bareRepository();
  const head = git(dir, ["rev-parse", "HEAD"]);
  writeMapDoc(dir, { commit: head, rollbackLines: ["- Exact steps: run scripts/rollback.sh <!-- CTIDE:TRUST:bogus-tier -->"] });
  const result = migrationCompatibilityCheck(dir);
  assert.strictEqual(result.status, "unverified");
  assert.match(result.evidence, /malformed/);
});

test("migrationCompatibilityCheck: SYSTEM_MAP.md exists but has no Rollback section -> unverified", () => {
  const dir = bareRepository();
  const target = path.join(dir, ".ctide", "map", "SYSTEM_MAP.md");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "# System Map\n\nVerified at commit: " + git(dir, ["rev-parse", "HEAD"]) + "\n\n## System overview\n\n- x\n", "utf8");
  const result = migrationCompatibilityCheck(dir);
  assert.strictEqual(result.status, "unverified");
  assert.match(result.evidence, /no Rollback section/);
});

// --- e2e: checksumVerifyCheck (async since checksumVerifyCheck streams the artifact hash) ---

function sha256Hex(buf) { return crypto.createHash("sha256").update(buf).digest("hex"); }

test("checksumVerifyCheck: neither --artifact nor --checksum -> not-applicable", async () => {
  const dir = tempDir("ctide-ship-cs-");
  const result = await checksumVerifyCheck(dir, "", "");
  assert.strictEqual(result.status, "not-applicable");
});

test("checksumVerifyCheck: only --artifact supplied -> unverified", async () => {
  const dir = tempDir("ctide-ship-cs-");
  const result = await checksumVerifyCheck(dir, "artifact.tar.gz", "");
  assert.strictEqual(result.status, "unverified");
});

test("checksumVerifyCheck: only --checksum supplied -> unverified", async () => {
  const dir = tempDir("ctide-ship-cs-");
  const result = await checksumVerifyCheck(dir, "", "artifact.tar.gz.sha256");
  assert.strictEqual(result.status, "unverified");
});

test("checksumVerifyCheck: artifact file missing -> unverified", async () => {
  const dir = tempDir("ctide-ship-cs-");
  fs.writeFileSync(path.join(dir, "artifact.tar.gz.sha256"), "a".repeat(64) + "  artifact.tar.gz\n", "utf8");
  const result = await checksumVerifyCheck(dir, "artifact.tar.gz", "artifact.tar.gz.sha256");
  assert.strictEqual(result.status, "unverified");
  assert.match(result.evidence, /artifact not found/);
});

test("checksumVerifyCheck: checksum file missing -> unverified", async () => {
  const dir = tempDir("ctide-ship-cs-");
  fs.writeFileSync(path.join(dir, "artifact.tar.gz"), "content\n", "utf8");
  const result = await checksumVerifyCheck(dir, "artifact.tar.gz", "artifact.tar.gz.sha256");
  assert.strictEqual(result.status, "unverified");
  assert.match(result.evidence, /checksum file not found/);
});

test("checksumVerifyCheck: checksum file is not the expected format -> unverified", async () => {
  const dir = tempDir("ctide-ship-cs-");
  fs.writeFileSync(path.join(dir, "artifact.tar.gz"), "content\n", "utf8");
  fs.writeFileSync(path.join(dir, "artifact.tar.gz.sha256"), "not a hash at all\n", "utf8");
  const result = await checksumVerifyCheck(dir, "artifact.tar.gz", "artifact.tar.gz.sha256");
  assert.strictEqual(result.status, "unverified");
});

test("checksumVerifyCheck: checksum file has more than one line -> unverified", async () => {
  const dir = tempDir("ctide-ship-cs-");
  const content = Buffer.from("content\n");
  fs.writeFileSync(path.join(dir, "artifact.tar.gz"), content);
  const hash = sha256Hex(content);
  fs.writeFileSync(path.join(dir, "artifact.tar.gz.sha256"), `${hash}  artifact.tar.gz\nextra line\n`, "utf8");
  const result = await checksumVerifyCheck(dir, "artifact.tar.gz", "artifact.tar.gz.sha256");
  assert.strictEqual(result.status, "unverified");
});

test("checksumVerifyCheck: matching digest ('<sha256>  <filename>' shape) -> pass", async () => {
  const dir = tempDir("ctide-ship-cs-");
  const content = Buffer.from("real plugin archive bytes\n");
  fs.writeFileSync(path.join(dir, "artifact.tar.gz"), content);
  const hash = sha256Hex(content);
  fs.writeFileSync(path.join(dir, "artifact.tar.gz.sha256"), `${hash}  artifact.tar.gz\n`, "utf8");
  const result = await checksumVerifyCheck(dir, "artifact.tar.gz", "artifact.tar.gz.sha256");
  assert.strictEqual(result.status, "pass");
});

test("checksumVerifyCheck: matching digest, bare digest-only line (no filename column) -> pass", async () => {
  const dir = tempDir("ctide-ship-cs-");
  const content = Buffer.from("bare digest content\n");
  fs.writeFileSync(path.join(dir, "artifact.tar.gz"), content);
  const hash = sha256Hex(content);
  fs.writeFileSync(path.join(dir, "artifact.tar.gz.sha256"), `${hash}\n`, "utf8");
  const result = await checksumVerifyCheck(dir, "artifact.tar.gz", "artifact.tar.gz.sha256");
  assert.strictEqual(result.status, "pass");
});

test("checksumVerifyCheck: mismatched digest -> fail, recommends re-running the build (not a code fix)", async () => {
  const dir = tempDir("ctide-ship-cs-");
  fs.writeFileSync(path.join(dir, "artifact.tar.gz"), "actual bytes\n", "utf8");
  const wrongHash = sha256Hex(Buffer.from("different bytes\n"));
  fs.writeFileSync(path.join(dir, "artifact.tar.gz.sha256"), `${wrongHash}  artifact.tar.gz\n`, "utf8");
  const result = await checksumVerifyCheck(dir, "artifact.tar.gz", "artifact.tar.gz.sha256");
  assert.strictEqual(result.status, "fail");
  assert.match(result.evidence, /mismatch/);
});

test("checksumVerifyCheck: checksum file names a DIFFERENT file than --artifact -> fail", async () => {
  const dir = tempDir("ctide-ship-cs-");
  const content = Buffer.from("content\n");
  fs.writeFileSync(path.join(dir, "artifact.tar.gz"), content);
  const hash = sha256Hex(content);
  fs.writeFileSync(path.join(dir, "artifact.tar.gz.sha256"), `${hash}  some-other-file.tar.gz\n`, "utf8");
  const result = await checksumVerifyCheck(dir, "artifact.tar.gz", "artifact.tar.gz.sha256");
  assert.strictEqual(result.status, "fail");
});

test("checksumVerifyCheck: a several-MB artifact still hashes correctly via the streaming read path (fs.createReadStream, chunk-accumulated into the digest -- never the whole file in memory at once) -> pass", async () => {
  const dir = tempDir("ctide-ship-cs-stream-");
  // Several MB -> several dozen chunks at the default 64KB highWaterMark, genuinely exercising the
  // multi-chunk streaming path rather than a single-read edge case.
  const content = crypto.randomBytes(3 * 1024 * 1024);
  fs.writeFileSync(path.join(dir, "artifact.tar.gz"), content);
  const hash = sha256Hex(content);
  fs.writeFileSync(path.join(dir, "artifact.tar.gz.sha256"), `${hash}  artifact.tar.gz\n`, "utf8");
  const result = await checksumVerifyCheck(dir, "artifact.tar.gz", "artifact.tar.gz.sha256");
  assert.strictEqual(result.status, "pass");
});

// --- e2e: the command line (cressetide/lib/cli.mjs parseCli: strict flags, `--flag=value`, last value wins) ---

// A repository tagged v1.0.0 with a matching artifact/checksum pair, and an untagged one: marker.tag says
// which repository a run read, checksumVerify which artifact flags it took.
function cliFixtures() {
  const tagged = bareRepository();
  git(tagged, ["tag", "v1.0.0"]);
  const content = Buffer.from("cli artifact bytes\n");
  fs.writeFileSync(path.join(tagged, "artifact.tar.gz"), content);
  fs.writeFileSync(path.join(tagged, "artifact.tar.gz.sha256"), `${sha256Hex(content)}  artifact.tar.gz\n`, "utf8");
  return { tagged, untagged: bareRepository() };
}

// Hermetic: no CLAUDE_PROJECT_DIR, so a run without --cwd reads the spawned process's own cwd.
function runShipCli(args, cwd) {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  const result = cp.spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8", env });
  assert.strictEqual(result.status, 0, `${args.join(" ")}: the CLI always exits 0: ${result.stderr}`);
  return result;
}

test("CLI flags: the `--flag=value` form is honored for --cwd, --artifact and --checksum, and a repeated --cwd keeps its last value", () => {
  const { tagged, untagged } = cliFixtures();
  const equals = runShipCli([`--cwd=${tagged}`, "--artifact=artifact.tar.gz", "--checksum=artifact.tar.gz.sha256", "--json"], untagged);
  assert.strictEqual(equals.stderr, "");
  const report = JSON.parse(equals.stdout);
  assert.strictEqual(report.marker.tag, "v1.0.0", "--cwd=<dir> reads <dir>, not the process cwd");
  assert.strictEqual(report.checks.checksumVerify.status, "pass", "--artifact=/--checksum= are both taken");
  const repeated = JSON.parse(runShipCli(["--cwd", untagged, "--cwd", tagged, "--json"], untagged).stdout);
  assert.strictEqual(repeated.marker.tag, "v1.0.0", "the last --cwd wins");
  const emptyValue = JSON.parse(runShipCli(["--cwd=", "--json"], tagged).stdout);
  assert.strictEqual(emptyValue.marker.tag, "v1.0.0", "an empty --cwd= means \"not given\": the process cwd is read");
});

test("CLI usage error: an unknown flag, a flag without its value, a flag whose value slot holds another flag, or a stray argument exits 0 with the usage on stderr and one no-run line on stdout — no report, no verdict word", () => {
  const { tagged } = cliFixtures();
  for (const args of [
    ["--bogus", "--cwd", tagged],
    ["-x", "--cwd", tagged],
    ["--cwd", tagged, "extra"],
    ["--cwd"],
    ["--cwd", tagged, "--artifact", "--checksum", "artifact.tar.gz.sha256"],
  ]) {
    const result = runShipCli(args, tagged);
    const label = args.join(" ");
    assert.match(result.stderr, /^ship: .+ \(usage: ship\.mjs .*\)\n$/, `${label}: one usage line on stderr`);
    const lines = result.stdout.split("\n").filter(Boolean);
    assert.strictEqual(lines.length, 1, `${label}: exactly one stdout line, no report: ${result.stdout}`);
    assert.match(lines[0], /usage error/, `${label}: the stdout line says it is a usage error`);
    assert.doesNotMatch(result.stdout, /v1\.0\.0|marker:|checks:/, `${label}: nothing was read`);
    assert.doesNotMatch(result.stdout + result.stderr, /\bREADY\b/, `${label}: no READY token anywhere`);
  }
});

test("CLI usage error with --json anywhere on the command line: a no-run JSON report — pending unverified with a usage-error note, the disclaimer, no checks", () => {
  const { tagged } = cliFixtures();
  for (const args of [
    ["--json", "--bogus", "--cwd", tagged],
    ["--cwd", tagged, "stray", "--json"],
    ["--json=1", "--cwd", tagged],
    ["--cwd", tagged, "--artifact", "--json"],
  ]) {
    const result = runShipCli(args, tagged);
    const label = args.join(" ");
    assert.match(result.stderr, /^ship: .+ \(usage: ship\.mjs .*\)\n$/, `${label}: one usage line on stderr`);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.pending.state, "unverified", `${label}: pending state`);
    assert.match(report.pending.note, /usage error/, `${label}: the note says why nothing is listed`);
    assert.strictEqual(report.pending.disclaimer, DISCLAIMER);
    assert.strictEqual(report.pending.commitCount, null);
    assert.deepStrictEqual(report.pending.commits, []);
    assert.strictEqual(report.marker.found, false, `${label}: no marker was read`);
    assert.deepStrictEqual(report.checks, {}, `${label}: no check ran`);
    assert.doesNotMatch(result.stdout + result.stderr, /\bREADY\b/, `${label}: no READY token anywhere`);
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
  git(cwd, ["add", "."]);
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
  git(dir, ["tag", "v1.0.0"]);
  fs.writeFileSync(path.join(dir, "between.txt"), "released in 1.1.0\n", "utf8");
  git(dir, ["add", "."]);
  commitAt(dir, "2026-01-02T00:00:00Z", "change released in v1.1.0");
  git(dir, ["tag", "-a", "v1.1.0", "-m", "release 1.1.0"]); // annotated: the base must dereference to its commit
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "feature.js"), "export const feature = 1;\n", "utf8");
  fs.appendFileSync(path.join(dir, "a.txt"), "edited\n");
  git(dir, ["add", "."]);
  commitAt(dir, "2026-01-03T00:00:00Z", "add feature by hand");
  const newCommit = git(dir, ["rev-parse", "--short", "HEAD"]);

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
  git(dir, ["tag", "nightly"]); // a non-release tag never counts as the boundary
  fs.writeFileSync(path.join(dir, "b.txt"), "b\n", "utf8");
  git(dir, ["add", "."]);
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
  git(origin, ["tag", "v1.0.0"]);
  for (const day of ["02", "03"]) {
    fs.writeFileSync(path.join(origin, `f${day}.txt`), day + "\n", "utf8");
    git(origin, ["add", "."]);
    commitAt(origin, `2026-01-${day}T00:00:00Z`, `work ${day}`);
  }
  const clone = path.join(tempDir("ctide-ship-shallow-"), "clone");
  git(path.dirname(clone), ["clone", "-q", "--depth", "1", pathToFileURL(origin).href, clone]);
  assert.strictEqual(git(clone, ["rev-parse", "--is-shallow-repository"]), "true", "fixture sanity: the clone is really shallow");

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
  git(origin, ["checkout", "-q", "-b", "side"]);
  for (const n of [1, 2, 3, 4]) commitFile(origin, `src/side${n}.txt`, `${n}\n`, `2026-01-0${n + 1}T00:00:00Z`, `side ${n}`);
  git(origin, ["checkout", "-q", "main"]);
  commitFile(origin, "src/tagged.txt", "t\n", "2026-01-06T00:00:00Z", "tagged");
  git(origin, ["tag", "v1.0.0"]);
  commitFile(origin, "src/main1.txt", "m\n", "2026-01-07T00:00:00Z", "main 1");
  git(origin, ["merge", "-q", "--no-ff", "-m", "merge side", "side"], { env: datedEnv("2026-01-08T00:00:00Z") });
  const clone = path.join(tempDir("ctide-ship-shallow-merge-"), "clone");
  git(path.dirname(clone), ["clone", "-q", "--depth", "3", pathToFileURL(origin).href, clone]);
  assert.strictEqual(git(clone, ["rev-parse", "--is-shallow-repository"]), "true", "fixture sanity: the clone is shallow");
  assert.ok(git(clone, ["tag", "--list"]).split(/\r?\n/).includes("v1.0.0"), "fixture sanity: the tagged commit was fetched with its tag");
  assert.strictEqual(git(origin, ["rev-list", "--count", "v1.0.0..HEAD"]), "6", "fixture sanity: 6 commits since the tag in full history");
  assert.strictEqual(git(clone, ["rev-list", "--count", "v1.0.0..HEAD"]), "4", "fixture sanity: the shallow clone sees only 4 of them");
  return clone;
}

test("pending view: a subdirectory --cwd or a linked-worktree --cwd of a shallow clone is still shallow-clone — never an ok list that undercounts the commits since the tag", async () => {
  const clone = shallowMergeClone();
  const worktree = path.join(tempDir("ctide-ship-shallow-wt-"), "wt");
  git(clone, ["worktree", "add", "-q", "--detach", worktree, "HEAD"]);
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

// ship-contract.md, Release-marker resolution: on a shallow clone — "which also holds from a subdirectory
// or a linked worktree" — marker.note and tagReady's unverified evidence disclose "history truncated —
// weak-signal only" (owner decision D-3). A real clone; the root-only tests above fake `.git/shallow`.
test("resolveMarker and tagReadinessCheck: from a subdirectory or a linked worktree of a real shallow clone whose release tag was not fetched, both disclose history truncation", () => {
  const origin = bareRepository();
  commitFile(origin, "src/one.txt", "1\n", "2026-01-02T00:00:00Z", "one");
  git(origin, ["tag", "v1.0.0"]);
  commitFile(origin, "src/two.txt", "2\n", "2026-01-03T00:00:00Z", "two");
  const clone = path.join(tempDir("ctide-ship-shallow-notag-"), "clone");
  git(path.dirname(clone), ["clone", "-q", "--depth", "1", pathToFileURL(origin).href, clone]);
  assert.strictEqual(git(clone, ["rev-parse", "--is-shallow-repository"]), "true", "fixture sanity: the clone is shallow");
  assert.strictEqual(git(clone, ["tag", "--list"]), "", "fixture sanity: the release tag was not fetched");
  const worktree = path.join(tempDir("ctide-ship-shallow-notag-wt-"), "wt");
  git(clone, ["worktree", "add", "-q", "--detach", worktree, "HEAD"]);
  for (const [where, cwd] of [["subdirectory", path.join(clone, "src")], ["worktree", worktree]]) {
    const marker = resolveMarker(cwd);
    assert.strictEqual(marker.found, false, `${where}: no tag is visible locally`);
    assert.match(marker.note, /history truncated — weak-signal only/, `${where}: marker.note`);
    const tagReady = tagReadinessCheck(cwd, { status: "not-applicable", manifests: [{ file: "package.json", version: "1.0.0" }] });
    assert.strictEqual(tagReady.status, "unverified", `${where}: tagReady`);
    assert.match(tagReady.evidence, /history truncated — weak-signal only/, `${where}: tagReady evidence`);
  }
});

// ship-contract.md, Release-marker resolution: on a shallow clone (`git rev-parse
// --is-shallow-repository` reports `true`) marker.note discloses "history truncated — weak-signal only".
// That probe answers `true` in a bare shallow clone and inside a shallow clone's `.git` directory too,
// neither of which is a work tree.
test("resolveMarker: a bare shallow clone and a shallow clone's .git directory, given as --cwd, disclose history truncation in the marker note", () => {
  const origin = bareRepository();
  git(origin, ["tag", "v1.0.0"]);
  commitFile(origin, "one.txt", "1\n", "2026-01-02T00:00:00Z", "one");
  commitFile(origin, "two.txt", "2\n", "2026-01-03T00:00:00Z", "two");
  const parent = tempDir("ctide-ship-shallow-bare-");
  const bare = path.join(parent, "bare.git");
  git(parent, ["clone", "-q", "--bare", "--depth", "2", "--no-tags", pathToFileURL(origin).href, bare]);
  const clone = path.join(parent, "clone");
  git(parent, ["clone", "-q", "--depth", "1", pathToFileURL(origin).href, clone]);
  const dotGit = path.join(clone, ".git");
  for (const [where, cwd] of [["bare shallow clone", bare], ["shallow clone's .git", dotGit]]) {
    assert.strictEqual(git(cwd, ["rev-parse", "--is-shallow-repository"]), "true", `fixture sanity: ${where} is shallow`);
    assert.strictEqual(git(cwd, ["rev-parse", "--is-inside-work-tree"]), "false", `fixture sanity: ${where} is not a work tree`);
    assert.strictEqual(git(cwd, ["tag", "--list"]), "", `fixture sanity: ${where} has no local tag`);
    const result = cp.spawnSync(process.execPath, [SCRIPT, "--cwd", cwd, "--json"], { encoding: "utf8" });
    assert.strictEqual(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.marker.found, false, `${where}: no tag is visible locally`);
    assert.match(report.marker.note, /history truncated — weak-signal only/, `${where}: marker.note`);
  }
});

// Serialized into a `node -r` preload (Function.prototype.toString), never called in this file. It
// rewrites the `git rev-parse --is-shallow-repository` probe's result — and, in mode "both-timeout", the
// `--is-inside-work-tree` check's too — and leaves every other git call real. ship.mjs imports spawnSync
// as a named ESM binding, so the preload re-syncs the builtin's ESM exports after patching.
function shallowProbePreload(mode) {
  const childProcess = require("node:child_process");
  const realSpawnSync = childProcess.spawnSync;
  const exited = (stdout, status) => ({ pid: 0, output: [null, stdout, ""], stdout, stderr: "", status, signal: null });
  const timedOut = () => {
    const error = Object.assign(new Error("spawnSync git ETIMEDOUT"), { code: "ETIMEDOUT", syscall: "spawnSync git" });
    return { pid: 0, output: null, stdout: "", stderr: "", status: null, signal: "SIGTERM", error };
  };
  childProcess.spawnSync = function patchedSpawnSync(command, args) {
    const asks = (flag) => command === "git" && Array.isArray(args) && args.includes(flag);
    if (asks("--is-shallow-repository")) {
      if (mode === "echo") return exited("--is-shallow-repository\n", 0); // git < 2.15 prints the unknown flag back
      if (mode === "nonzero") return exited("", 128);
      if (mode === "empty") return exited("", 0);
      return timedOut(); // "timeout" and "both-timeout"
    }
    if (mode === "both-timeout" && asks("--is-inside-work-tree")) return timedOut();
    return realSpawnSync.apply(this, arguments);
  };
  require("node:module").syncBuiltinESMExports();
}

function runShipWithProbe(dir, mode) {
  const preload = path.join(tempDir("ctide-ship-probe-preload-"), `${mode}.cjs`);
  fs.writeFileSync(preload, `(${shallowProbePreload})(${JSON.stringify(mode)});\n`, "utf8");
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  const result = cp.spawnSync(process.execPath, ["-r", preload, SCRIPT, "--cwd", dir, "--json"], { encoding: "utf8", env });
  assert.strictEqual(result.status, 0, `${mode}: the CLI exits 0: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

// Two full, non-shallow work trees: `tagged` (a tag, then a commit declaring version 1.0.0, which has no
// tag) and `untagged` (no tag at all, so marker.note is the not-found note).
function probeFixtures() {
  const tagged = bareRepository();
  git(tagged, ["tag", "v0.9.0"]);
  commitFile(tagged, "package.json", JSON.stringify({ version: "1.0.0" }), "2026-01-02T00:00:00Z", "prepare 1.0.0");
  const untagged = bareRepository();
  for (const dir of [tagged, untagged]) {
    assert.strictEqual(git(dir, ["rev-parse", "--is-shallow-repository"]), "false", "fixture sanity: a full, non-shallow repository");
  }
  return { tagged, untagged };
}

// ship-contract.md, Release-marker resolution (owner-approved, round-1 re-check): when the shallow probe
// answers neither `true` nor `false` inside a git work tree — an older git echoing the flag back, a
// timeout, or another read failure (a non-zero exit, empty output) — whether history is truncated is
// unknown: `marker.note` says history may be truncated and `tagReady` reports `unverified`; the
// `unverified` pending row includes "determining whether the history is shallow".
test("an unanswered shallow probe (echoed flag, timeout, non-zero exit, empty output) inside a work tree is unknown, never 'not shallow': pending and tagReady are unverified and the marker note says history may be truncated", () => {
  const { tagged, untagged } = probeFixtures();
  for (const mode of ["echo", "timeout", "nonzero", "empty"]) {
    const report = runShipWithProbe(tagged, mode);
    assert.strictEqual(report.pending.state, "unverified", `${mode}: pending`);
    assert.strictEqual(report.pending.commitCount, null, `${mode}: no count is claimed`);
    assert.strictEqual(report.checks.tagReady.status, "unverified", `${mode}: tagReady`);
    assertFiveChecksRan(report);
    const noTag = runShipWithProbe(untagged, mode);
    assert.strictEqual(noTag.marker.found, false, `${mode}: fixture sanity: no tag`);
    assert.match(noTag.marker.note, /history may be truncated/, `${mode}: marker.note`);
  }
});

// ship-contract.md, Release-marker resolution (owner-approved W1): "when whether this is a work tree
// cannot itself be determined (that check times out), it is treated as unknown".
test("when the shallow probe and the work-tree check both time out, it is unknown: the marker note says history may be truncated and tagReady is unverified", () => {
  const { tagged, untagged } = probeFixtures();
  const noTag = runShipWithProbe(untagged, "both-timeout");
  assert.strictEqual(noTag.marker.found, false, "fixture sanity: no tag");
  assert.match(noTag.marker.note, /may be truncated/, "marker.note");
  assert.strictEqual(runShipWithProbe(tagged, "both-timeout").checks.tagReady.status, "unverified", "tagReady");
});

test("pending view: a non-git directory is disclosed as not-a-git-repo, the CLI exits 0 in both modes, and the five checks still run", () => {
  const dir = tempDir("ctide-ship-pending-nongit-");
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
  const emptyBin = tempDir("ctide-ship-nogit-path-");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path"));
  env.PATH = emptyBin;
  const result = cp.spawnSync(process.execPath, [SCRIPT, "--cwd", dir, "--json"], { encoding: "utf8", env });
  assert.strictEqual(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.strictEqual(parsed.pending.state, "git-unavailable");
  assert.deepStrictEqual(parsed.pending.commits, []);
  assertFiveChecksRan(parsed);
});

// ship-contract.md, Release-marker resolution (owner-approved W1): "Outside a git work tree (a directory
// outside any repository, a bare repository, or a `.git` directory), or when git cannot be run, a probe
// that does not answer `true` adds no truncation clause" — to marker.note or tagReady's evidence.
function assertNoTruncationClause(report, where) {
  assert.notStrictEqual(report.checks.tagReady.status, "not-applicable",
    `${where}: fixture sanity: a target version was found, so tagReady reached its tag-not-found branch`);
  for (const [field, text] of [["marker.note", report.marker.note], ["tagReady evidence", report.checks.tagReady.evidence]]) {
    assert.doesNotMatch(text, /history truncated|may be truncated/, `${where}: ${field} has no truncation clause`);
  }
}

test("outside a git work tree, neither marker.note nor tagReady's evidence says history is or may be truncated", () => {
  const dir = tempDir("ctide-ship-nongit-trunc-");
  writePkg(dir, "package.json", JSON.stringify({ version: "1.0.0" }));
  const result = cp.spawnSync(process.execPath, [SCRIPT, "--cwd", dir, "--json"], { encoding: "utf8" });
  assert.strictEqual(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.strictEqual(report.pending.state, "not-a-git-repo", "fixture sanity: not inside a git work tree");
  assertNoTruncationClause(report, "non-git directory");
});

test("with git missing from PATH, neither marker.note nor tagReady's evidence says history is or may be truncated", () => {
  const dir = bareRepository();
  writePkg(dir, "package.json", JSON.stringify({ version: "1.0.0" }));
  const emptyBin = tempDir("ctide-ship-nogit-path-");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path"));
  env.PATH = emptyBin;
  const result = cp.spawnSync(process.execPath, [SCRIPT, "--cwd", dir, "--json"], { encoding: "utf8", env });
  assert.strictEqual(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.strictEqual(report.pending.state, "git-unavailable", "fixture sanity: git cannot be run");
  assertNoTruncationClause(report, "git unavailable");
});

// Same W1 sentence: in a bare repository — not a work tree — a probe that does not answer `true` (here an
// older git echoing the flag back) adds no truncation clause to marker.note.
test("in a non-shallow bare repository, a shallow probe echoed back by an older git adds no truncation clause to the marker note", () => {
  const parent = tempDir("ctide-ship-bare-echo-");
  const bare = path.join(parent, "bare.git");
  git(parent, ["clone", "-q", "--bare", pathToFileURL(bareRepository()).href, bare]);
  assert.strictEqual(git(bare, ["rev-parse", "--is-shallow-repository"]), "false", "fixture sanity: not shallow");
  assert.strictEqual(git(bare, ["rev-parse", "--is-bare-repository"]), "true", "fixture sanity: a bare repository");
  const report = runShipWithProbe(bare, "echo");
  assert.strictEqual(report.marker.found, false, "fixture sanity: no tag");
  assert.doesNotMatch(report.marker.note, /history truncated|may be truncated/, "marker.note has no truncation clause");
});

test("pending view: zero commits since the tag is state ok with 'no commits since <tag>' — and all five readiness checks still run", async () => {
  const dir = bareRepository();
  writePkg(dir, "package.json", JSON.stringify({ version: "1.0.0" }));
  git(dir, ["add", "."]);
  commitAt(dir, "2026-01-02T00:00:00Z", "release 1.0.0");
  git(dir, ["tag", "v1.0.0"]); // lightweight
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
  git(dir, ["tag", "v1.0.0"]);
  const many = path.join(dir, "many");
  fs.mkdirSync(many);
  for (let i = 1; i <= PENDING_FILE_CAP; i++) fs.writeFileSync(path.join(many, `f${i}.txt`), `${i}\n`, "utf8");
  git(dir, ["add", "."]);
  commitAt(dir, "2026-01-02T00:00:00Z", "add many files");
  // The remaining PENDING_COMMIT_CAP - 1 empty commits in ONE git process (fast-import), so the fixture stays fast.
  const stream = [];
  for (let i = 1; i < PENDING_COMMIT_CAP; i++) {
    stream.push("commit refs/heads/main", "committer Ship Test <ship@example.invalid> 1767312000 +0000", `data ${`c${i}`.length}`, `c${i}`);
    if (i === 1) stream.push("from refs/heads/main^0");
    stream.push("");
  }
  git(dir, ["fast-import", "--quiet", "--force"], { input: stream.join("\n") + "\n" }); // throws with git's stderr if it fails
  assert.strictEqual(git(dir, ["rev-list", "--count", "v1.0.0..HEAD"]), String(PENDING_COMMIT_CAP), "fixture sanity: commit count at the cap");

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
  assert.strictEqual(git(dir, ["rev-list", "--count", "v1.0.0..HEAD"]), String(total), "fixture sanity: commit count past the cap");

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
  git(dir, ["tag", "1.0.0"]);
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
  git(dir, ["tag", "v1.0.0"]);
  commitFile(dir, "a1.txt", "a\n", "2026-01-02T00:00:00Z", "a");
  git(dir, ["tag", "v1.1.0-rc.1"]);
  commitFile(dir, "b1.txt", "b\n", "2026-01-03T00:00:00Z", "b");
  const report = await buildShipReport(dir, {});
  assert.strictEqual(report.pending.state, "ok");
  assert.strictEqual(report.pending.tag, "v1.0.0");
  assert.strictEqual(report.pending.commitCount, 2);
  assert.deepStrictEqual(sortedSubjects(report.pending), ["a", "b"]);
});

test("pending view: a four-part tag (v1.2.3.4) is never the boundary", async () => {
  const dir = bareRepository();
  git(dir, ["tag", "v1.0.0"]);
  commitFile(dir, "a1.txt", "a\n", "2026-01-02T00:00:00Z", "a");
  git(dir, ["tag", "v1.2.3.4"]);
  commitFile(dir, "b1.txt", "b\n", "2026-01-03T00:00:00Z", "b");
  const report = await buildShipReport(dir, {});
  assert.strictEqual(report.pending.state, "ok");
  assert.strictEqual(report.pending.tag, "v1.0.0");
  assert.deepStrictEqual(sortedSubjects(report.pending), ["a", "b"]);
});

// ship-contract.md, Release-marker resolution and Pending view: the marker is the highest-version tag
// and the boundary the highest-version tag reachable from HEAD, and the pending view "does not depend on
// `column.*`, `tag.sort`, …" (round-1 re-check edge: the marker's tag list must not either).
test("pending view and marker: a repository's column.ui/column.tag=always and tag.sort=-refname do not hide the release tag", async () => {
  const dir = bareRepository();
  git(dir, ["tag", "v0.9.0"]);
  commitFile(dir, "rel.txt", "r\n", "2026-01-02T00:00:00Z", "release 1.0.0");
  git(dir, ["tag", "v1.0.0"]);
  commitFile(dir, "after.txt", "a\n", "2026-01-03T00:00:00Z", "after the release");
  for (const [key, value] of [["column.ui", "always"], ["column.tag", "always"], ["tag.sort", "-refname"]]) git(dir, ["config", key, value]);
  assert.ok(git(dir, ["tag", "--list"]).split(/\r?\n/).some((line) => line.includes("v0.9.0") && line.includes("v1.0.0")),
    "fixture sanity: this config prints several tags on one line");
  const report = await buildShipReport(dir, {});
  assert.strictEqual(report.marker.found, true);
  assert.strictEqual(report.marker.tag, "v1.0.0");
  assert.strictEqual(report.pending.state, "ok");
  assert.strictEqual(report.pending.tag, "v1.0.0");
  assert.deepStrictEqual(sortedSubjects(report.pending), ["after the release"]);
});

// Round-1 re-check edge: a same-version tie (v1.0.0 and 1.0.0) breaks the same way for the marker and
// the boundary, independent of tag.sort. Which of the two wins is not stated anywhere, so not pinned.
test("marker and pending boundary break a same-version tie (v1.0.0 vs 1.0.0) the same way, whatever tag.sort says", async () => {
  const dir = bareRepository();
  git(dir, ["tag", "1.0.0"]);
  git(dir, ["tag", "v1.0.0"]);
  commitFile(dir, "b.txt", "b\n", "2026-01-02T00:00:00Z", "after the release");
  const picked = {};
  for (const order of ["refname", "-refname"]) {
    git(dir, ["config", "tag.sort", order]);
    const report = await buildShipReport(dir, {});
    assert.strictEqual(report.pending.state, "ok");
    assert.strictEqual(report.pending.tag, report.marker.tag, `tag.sort=${order}: the marker and the boundary pick the same tag`);
    picked[order] = report.marker.tag;
  }
  assert.strictEqual(picked["-refname"], picked.refname, "the tie-break does not follow tag.sort");
});

// ship-contract.md, Release-marker resolution / Pending view: ordered by version, "never lexicographic
// string sort — v9.0.0 must not outrank v10.0.0".
test("pending view: the boundary is ordered by version — v9.0.0, a, v10.0.0, b lists only b since v10.0.0", async () => {
  const dir = bareRepository();
  git(dir, ["tag", "v9.0.0"]);
  commitFile(dir, "a1.txt", "a\n", "2026-01-02T00:00:00Z", "a");
  git(dir, ["tag", "v10.0.0"]);
  commitFile(dir, "b1.txt", "b\n", "2026-01-03T00:00:00Z", "b");
  const report = await buildShipReport(dir, {});
  assert.strictEqual(report.pending.state, "ok");
  assert.strictEqual(report.pending.tag, "v10.0.0");
  assert.deepStrictEqual(sortedSubjects(report.pending), ["b"]);
});

// command-reference.md / ship-contract.md: the boundary is "the highest-version vX.Y.Z tag reachable
// from HEAD" — not the most recently dated one.
test("pending view: a maintenance tag merged back after a higher release (v1.9.5 dated after v2.0.0) is not the boundary", async () => {
  const dir = bareRepository();
  git(dir, ["checkout", "-q", "-b", "maintenance"]);
  commitFile(dir, "fix.txt", "f\n", "2026-01-04T00:00:00Z", "maintenance fix");
  git(dir, ["tag", "v1.9.5"]);
  git(dir, ["checkout", "-q", "main"]);
  commitFile(dir, "two.txt", "2\n", "2026-01-02T00:00:00Z", "release 2.0.0");
  git(dir, ["tag", "v2.0.0"]);
  git(dir, ["merge", "-q", "--no-ff", "-m", "merge maintenance", "maintenance"], { env: datedEnv("2026-01-05T00:00:00Z") });
  const merged = git(dir, ["tag", "--no-column", "--merged", "HEAD"]).split(/\r?\n/);
  assert.ok(merged.includes("v1.9.5") && merged.includes("v2.0.0"), "fixture sanity: both tags are reachable from HEAD");
  const report = await buildShipReport(dir, {});
  assert.strictEqual(report.pending.state, "ok");
  assert.strictEqual(report.pending.tag, "v2.0.0");
});

// ship-contract.md, Pending view: the commits (short SHA and subject) with `commitCount` their uncapped
// total, and the pending view "does not depend on … `log.showSignature`"; changelogTouched diffs against
// "the marker commit" (round-1 re-check edge: log.showSignature must not corrupt it either).
// Makes `key` and signs a probe file with it the way git does (gpg.ssh.program = ssh-keygen). Returns the
// spawnSync result of the first ssh-keygen step that failed, or of the signing step.
function sshSignProbe(key) {
  const keygen = cp.spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "ship-test", "-f", key], { encoding: "utf8" });
  if (keygen.error || keygen.status !== 0) return keygen;
  const probe = path.join(path.dirname(key), "probe.txt");
  fs.writeFileSync(probe, "probe\n", "utf8");
  return cp.spawnSync("ssh-keygen", ["-Y", "sign", "-n", "git", "-f", key, probe], { encoding: "utf8" });
}

test("pending view and marker: log.showSignature=true with SSH-signed commits adds no row to the commit list and leaves the marker commit intact", async (t) => {
  const dir = bareRepository();
  const key = path.join(tempDir("ctide-ship-sshkey-"), "signing_key");
  const skipReason = sshSigningSkipReason({ gitVersionText: git(dir, ["--version"]), signProbe: sshSignProbe(key) });
  if (skipReason) {
    t.skip(`no SSH-signed commit can be made: ${skipReason}`);
    return;
  }
  git(dir, ["config", "gpg.format", "ssh"]);
  git(dir, ["config", "user.signingkey", key.replaceAll(path.sep, "/")]);
  git(dir, ["config", "gpg.ssh.program", "ssh-keygen"]);
  const signedCommit = (relPath, isoDate, message) => {
    writePkg(dir, relPath, `${message}\n`);
    git(dir, ["add", "."]);
    git(dir, ["commit", "-q", "-S", "-m", message], { env: datedEnv(isoDate) });
  };
  signedCommit("rel.txt", "2026-01-02T00:00:00Z", "signed release");
  git(dir, ["tag", "v1.0.0"]);
  signedCommit("pending.txt", "2026-01-03T00:00:00Z", "signed pending commit");
  git(dir, ["config", "log.showSignature", "true"]); // no gpg.ssh.allowedSignersFile on purpose
  const signatureRows = git(dir, ["log", "--format=%h%x09%s", "v1.0.0..HEAD"]).split(/\r?\n/)
    .filter((row) => row && !row.includes("\t"));
  assert.ok(signatureRows.length > 0, "fixture sanity: log.showSignature adds non-commit rows to `git log` output");

  const report = await buildShipReport(dir, {});
  assert.strictEqual(report.marker.commit, git(dir, ["rev-parse", "v1.0.0^{commit}"]), "the marker commit is the tag's commit");
  assert.strictEqual(report.pending.state, "ok");
  assert.strictEqual(report.pending.commits.length, report.pending.commitCount);
  assert.deepStrictEqual(sortedSubjects(report.pending), ["signed pending commit"]);
  const out = runShip(dir, ["--cwd", "."]);
  for (const row of signatureRows) assert.ok(!out.includes(`- ${row}`), `a signature row is not listed as a commit: ${row}`);
});

test("pending view: when the release marker is a tag not reachable from HEAD, the pending note names both tags", async () => {
  const dir = bareRepository();
  git(dir, ["tag", "v1.0.0"]);
  git(dir, ["checkout", "-q", "-b", "maintenance"]);
  commitFile(dir, "hotfix.txt", "h\n", "2026-01-02T00:00:00Z", "hotfix on another branch");
  git(dir, ["tag", "v2.0.0"]);
  git(dir, ["checkout", "-q", "main"]);
  commitFile(dir, "work.txt", "w\n", "2026-01-03T00:00:00Z", "work on main");
  const report = await buildShipReport(dir, {});
  assert.strictEqual(report.marker.tag, "v2.0.0", "fixture sanity: the marker is the highest-version tag overall");
  assert.strictEqual(report.pending.state, "ok");
  assert.strictEqual(report.pending.tag, "v1.0.0");
  assert.deepStrictEqual(sortedSubjects(report.pending), ["work on main"]);
  assert.ok(report.pending.note.includes("v1.0.0") && report.pending.note.includes("v2.0.0"), `note names both tags: ${report.pending.note}`);
});

// ship-contract.md, Pending view: "When the marker resolves to a commit but is not the pending boundary,
// pending.note names it … as 'the release marker <tag> is not reachable from HEAD' when it is
// no-release-tag."
test("pending view: a release tag only on an unmerged branch is no-release-tag, and the note names that release marker", async () => {
  const dir = bareRepository();
  git(dir, ["checkout", "-q", "-b", "release"]);
  commitFile(dir, "rel.txt", "r\n", "2026-01-02T00:00:00Z", "release on a side branch");
  git(dir, ["tag", "v1.4.2"]);
  git(dir, ["checkout", "-q", "main"]);
  commitFile(dir, "work.txt", "w\n", "2026-01-03T00:00:00Z", "work on main");
  const report = await buildShipReport(dir, {});
  assert.strictEqual(report.marker.found, true, "fixture sanity: the marker resolves to a commit");
  assert.strictEqual(report.marker.tag, "v1.4.2");
  assert.strictEqual(report.pending.state, "no-release-tag");
  assert.ok(report.pending.note.includes("v1.4.2"), `the note names the release marker: ${report.pending.note}`);
});

// ship-contract.md, Pending view: only a marker that "resolves to a commit" is named in pending.note.
test("pending view: a tag pointing at a tree object is never named in the pending note as the release marker", async () => {
  const dir = bareRepository();
  git(dir, ["tag", "v1.0.0"]);
  commitFile(dir, "b.txt", "b\n", "2026-01-02T00:00:00Z", "after the release");
  git(dir, ["tag", "v9.9.9", "HEAD^{tree}"]);
  const report = await buildShipReport(dir, {});
  assert.strictEqual(report.marker.tag, "v9.9.9", "fixture sanity: the tree tag is the highest-version tag");
  assert.strictEqual(report.marker.found, false, "fixture sanity: it resolves to no commit");
  assert.strictEqual(report.pending.state, "ok");
  assert.strictEqual(report.pending.tag, "v1.0.0");
  assert.ok(!report.pending.note.includes("v9.9.9"), `the note does not name an unresolved tag: ${report.pending.note}`);
});

test("pending view: a failed read of the tags reachable from HEAD is unverified, never no-release-tag", async () => {
  const dir = bareRepository();
  git(dir, ["tag", "v1.0.0"]);
  commitFile(dir, "b.txt", "b\n", "2026-01-02T00:00:00Z", "unreadable head commit");
  deleteLooseObject(dir, git(dir, ["rev-parse", "HEAD"]));
  assert.throws(() => git(dir, ["tag", "--merged", "HEAD"]), Error,
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
  git(dir, ["tag", "v1.0.0"]);
  commitFile(dir, "b.txt", "b\n", "2026-01-02T00:00:00Z", "after the tag");
  deleteLooseObject(dir, git(dir, ["rev-parse", "v1.0.0^{tree}"])); // the tag's root tree: the range diff cannot be read
  assert.ok(git(dir, ["tag", "--merged", "HEAD"]).split(/\r?\n/).includes("v1.0.0"), "fixture sanity: the tag is still found");
  assert.throws(() => git(dir, ["diff", "--name-only", "v1.0.0..HEAD"]), Error,
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
  // Pinned so a developer's global core.quotePath=false cannot hide a lost `-z`: with quoting on, a
  // non-ASCII path read without `-z` comes back C-quoted and fails this test.
  git(dir, ["config", "core.quotePath", "true"]);
  git(dir, ["tag", "v1.0.0"]);
  const name = "docs/résumé ü 文件 notes.txt";
  commitFile(dir, name, "x\n", "2026-01-02T00:00:00Z", "add a unicode file name");
  const report = await buildShipReport(dir, {});
  assert.strictEqual(report.pending.state, "ok");
  assert.deepStrictEqual(report.pending.files, [name]);
});

test("pending view: an empty repository (no commits yet) is no-release-tag, the five checks still run, and the CLI exits 0", () => {
  const dir = makeRepo({ prefix: "ctide-ship-empty-" });
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
  git(dir, ["tag", "v1.0.0"]);
  git(dir, ["mv", "db/old-migration.sql", "db/new-migration.sql"]);
  commitAt(dir, "2026-01-03T00:00:00Z", "rename migration");
  const report = await buildShipReport(dir, {});
  assert.strictEqual(report.pending.state, "ok");
  assert.deepStrictEqual([...report.pending.files].sort(), ["db/new-migration.sql", "db/old-migration.sql"]);
});

test("pending view: a repository's diff.relative=true does not relativize the paths for a subdirectory --cwd", async () => {
  const dir = bareRepository();
  git(dir, ["tag", "v1.0.0"]);
  writePkg(dir, "root.txt", "r\n");
  commitFile(dir, "sub/inner.txt", "i\n", "2026-01-02T00:00:00Z", "touch root and sub");
  git(dir, ["config", "diff.relative", "true"]);
  const report = await buildShipReport(path.join(dir, "sub"), {});
  assert.strictEqual(report.pending.state, "ok");
  assert.deepStrictEqual([...report.pending.files].sort(), ["root.txt", "sub/inner.txt"]);
});

// --- e2e: reads through cressetide/lib/git.mjs, and the routed failure paths (round-1 F-j, code-review
// leads 1-4, owner decisions Q2 and Q4) ---

// Serialized into a `node -r` preload like shallowProbePreload above, never called in this file. It rewrites
// the result of the one git read `fault.read` names and leaves every other git call real:
//   count       `rev-list --count <range>` exits 0 printing fault.stdout
//   tag-list    `git tag … --list` exits 128
//   tag-lookup  `rev-parse … refs/tags/<x>` times out (fault.timeout) or exits 128
//   merged      `git tag … --merged HEAD` exits 128
function gitReadFaultPreload(fault) {
  const childProcess = require("node:child_process");
  const realSpawnSync = childProcess.spawnSync;
  const exited = (stdout, status, stderr = "") => ({ pid: 0, output: [null, stdout, stderr], stdout, stderr, status, signal: null });
  const timedOut = () => {
    const error = Object.assign(new Error("spawnSync git ETIMEDOUT"), { code: "ETIMEDOUT", syscall: "spawnSync git" });
    return { pid: 0, output: null, stdout: "", stderr: "", status: null, signal: "SIGTERM", error };
  };
  childProcess.spawnSync = function patchedSpawnSync(command, args) {
    const list = command === "git" && Array.isArray(args) ? args.map(String) : [];
    const has = (...words) => words.every((word) => list.includes(word));
    if (fault.read === "count" && has("rev-list", "--count") && list.some((arg) => arg.includes(".."))) return exited(fault.stdout, 0);
    if (fault.read === "tag-list" && has("tag", "--list")) return exited("", 128, "fatal: injected tag-list failure\n");
    if (fault.read === "merged" && has("tag", "--merged")) return exited("", 128, "fatal: injected tag --merged failure\n");
    if (fault.read === "tag-lookup" && has("rev-parse") && list.some((arg) => arg.startsWith("refs/tags/"))) {
      return fault.timeout ? timedOut() : exited("", 128, "fatal: injected tag lookup failure\n");
    }
    return realSpawnSync.apply(this, arguments);
  };
  require("node:module").syncBuiltinESMExports();
}

function runShipWithFault(dir, fault) {
  const preload = path.join(tempDir("ctide-ship-fault-preload-"), "fault.cjs");
  fs.writeFileSync(preload, `(${gitReadFaultPreload})(${JSON.stringify(fault)});\n`, "utf8");
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  const result = cp.spawnSync(process.execPath, ["-r", preload, SCRIPT, "--cwd", dir, "--json"], { encoding: "utf8", env });
  assert.strictEqual(result.status, 0, `${JSON.stringify(fault)}: the CLI exits 0: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

// Round-1 F-j: `rev-list --count` is parsed strictly (/^\d+$/ after trimming). Empty output used to read as 0 —
// "no commits since <tag>" beside a listed commit.
test("pending view: a commit count that is not plain digits (empty, blank, hex, exponent) is unverified — never 'no commits since <tag>' beside a listed set", () => {
  const dir = bareRepository();
  git(dir, ["tag", "v1.0.0"]);
  commitFile(dir, "b.txt", "b\n", "2026-01-02T00:00:00Z", "after the tag");
  for (const stdout of ["", " \n", "0x10\n", "1e3\n"]) {
    const report = runShipWithFault(dir, { read: "count", stdout });
    const label = JSON.stringify(stdout);
    assert.strictEqual(report.pending.state, "unverified", `${label}: pending state`);
    assert.strictEqual(report.pending.commitCount, null, `${label}: no count is claimed`);
    assert.deepStrictEqual(report.pending.commits, [], `${label}: no list beside an unknown count`);
    assert.doesNotMatch(report.pending.note, /no commits since/, `${label}: pending note`);
    assertFiveChecksRan(report);
  }
  assert.strictEqual(runShipWithFault(dir, { read: "count", stdout: "1\n" }).pending.commitCount, 1, "control: a plain count is taken");
});

// Lead 1 / ship-contract.md, Release-marker resolution: a failure to list tags is stated in marker.note.
test("resolveMarker: a tag list that cannot be read inside a repository is stated as a read failure in marker.note, never 'no vX.Y.Z release tag found' — changelogTouched stays unverified", () => {
  const dir = bareRepository();
  commitFile(dir, "CHANGELOG.md", "# Changelog\n", "2026-01-02T00:00:00Z", "add changelog");
  git(dir, ["tag", "v1.0.0"]);
  commitFile(dir, "CHANGELOG.md", "# Changelog\n\n- entry\n", "2026-01-03T00:00:00Z", "touch changelog");
  const report = runShipWithFault(dir, { read: "tag-list" });
  assert.strictEqual(report.marker.found, false);
  assert.doesNotMatch(report.marker.note, /no vX\.Y\.Z release tag found/, "a read failure is not 'no tag'");
  assert.match(report.marker.note, /could not be read/, "the note states the read failure");
  assert.strictEqual(report.checks.changelogTouched.status, "unverified", "no marker, no diff boundary");
  // Control: outside any repository there is no tag list to read, and the note stays the not-found one.
  const plain = tempDir("ctide-ship-nongit-marker-");
  const outside = JSON.parse(runShipCli(["--cwd", plain, "--json"], plain).stdout);
  assert.strictEqual(outside.marker.note, "no vX.Y.Z release tag found");
});

// Lead 2 / ship-contract.md, tagReady: a failure to look up the tag itself is unverified.
test("tagReadinessCheck: a tag lookup that times out or fails (anything but git's quiet 'no such ref') is unverified, never read as 'no tag' and passed", () => {
  const dir = bareRepository();
  commitFile(dir, "package.json", JSON.stringify({ version: "1.0.0" }), "2026-01-02T00:00:00Z", "prepare 1.0.0");
  assert.strictEqual(runShipWithFault(dir, { read: "none" }).checks.tagReady.status, "pass", "control: clean tree, no tag for 1.0.0");
  for (const timeout of [true, false]) {
    const tagReady = runShipWithFault(dir, { read: "tag-lookup", timeout }).checks.tagReady;
    assert.strictEqual(tagReady.status, "unverified", `${timeout ? "timeout" : "exit 128"}: tagReady`);
    assert.match(tagReady.evidence, /cannot be confirmed absent/, `${timeout ? "timeout" : "exit 128"}: evidence`);
  }
});

// Lead 3 / owner decision Q2: with a subdirectory --cwd, <cwd>/CHANGELOG.md is the file checked and diffed.
test("changelogTouchedCheck: with a subdirectory --cwd, <cwd>/CHANGELOG.md is the file checked and diffed — committed, staged or unstaged — whatever diff.relative says", () => {
  const fixture = () => {
    const dir = makeRepo({
      prefix: "ctide-ship-subdir-changelog-",
      files: { "CHANGELOG.md": "# Top\n", "pkg/CHANGELOG.md": "# Pkg\n", "pkg/package.json": JSON.stringify({ version: "2.0.0" }) },
    });
    git(dir, ["tag", "v1.0.0"]);
    return dir;
  };
  const statusIn = (dir) => changelogTouchedCheck(path.join(dir, "pkg"), resolveMarker(path.join(dir, "pkg"))).status;
  for (const relative of ["false", "true"]) {
    const committed = fixture();
    git(committed, ["config", "diff.relative", relative]);
    commitFile(committed, "pkg/CHANGELOG.md", "# Pkg\n\n## 2.0.0\n", "2026-01-02T00:00:00Z", "pkg changelog");
    assert.strictEqual(statusIn(committed), "pass", `diff.relative=${relative}: pkg/CHANGELOG.md changed in a commit`);

    const topOnly = fixture();
    git(topOnly, ["config", "diff.relative", relative]);
    commitFile(topOnly, "CHANGELOG.md", "# Top\n\n## 2.0.0\n", "2026-01-02T00:00:00Z", "top changelog only");
    assert.strictEqual(statusIn(topOnly), "fail", `diff.relative=${relative}: only the top-level CHANGELOG.md changed`);

    const uncommitted = fixture();
    git(uncommitted, ["config", "diff.relative", relative]);
    fs.appendFileSync(path.join(uncommitted, "pkg", "CHANGELOG.md"), "- unreleased\n");
    assert.strictEqual(statusIn(uncommitted), "pass", `diff.relative=${relative}: an unstaged change`);
    git(uncommitted, ["add", "pkg/CHANGELOG.md"]);
    assert.strictEqual(statusIn(uncommitted), "pass", `diff.relative=${relative}: a staged change`);
  }
});

// Lead 4: HEAD that cannot be resolved in a repository with commits is not "no-release-tag".
test("pending view: a broken or dangling HEAD in a repository that has commits is unverified, never no-release-tag", async () => {
  const broken = bareRepository();
  git(broken, ["tag", "v1.0.0"]);
  commitFile(broken, "b.txt", "b\n", "2026-01-02T00:00:00Z", "after the tag");
  fs.writeFileSync(path.join(broken, ".git", "refs", "heads", "main"), "not a commit id\n", "utf8");
  const dangling = bareRepository();
  git(dangling, ["tag", "v1.0.0"]);
  fs.writeFileSync(path.join(dangling, ".git", "refs", "heads", "main"), `${"1".repeat(40)}\n`, "utf8");
  for (const [where, dir] of [["broken HEAD ref", broken], ["dangling HEAD", dangling]]) {
    const report = await buildShipReport(dir, {});
    assert.strictEqual(report.pending.state, "unverified", `${where}: pending state`);
    assert.strictEqual(report.pending.note, "HEAD cannot be resolved to a readable commit — commits since the last release tag are unknown",
      `${where}: the note names HEAD, not a later read that failed because of it`);
    assert.strictEqual(report.pending.commitCount, null, `${where}: no count is claimed`);
    assertFiveChecksRan(report);
  }
});

// An orphan branch (HEAD naming a branch with no commit yet) in a repository that has commits is not a
// repository with no commits: headState says "unknown", so the pending view is unverified. Only the state is
// pinned here; the note's wording for this case is owner decision O-2 (P8).
test("pending view: an orphan branch in a repository that has commits is unverified, never no-release-tag", async () => {
  const dir = bareRepository();
  git(dir, ["tag", "v1.0.0"]);
  git(dir, ["checkout", "-q", "--orphan", "x"]);
  const report = await buildShipReport(dir, {});
  assert.strictEqual(report.pending.state, "unverified");
  assertFiveChecksRan(report);
});

// The HEAD check above now comes first, so "a failed read of the tags reachable from HEAD" (earlier in this
// file) reaches it before `git tag --merged HEAD`; this keeps that read's own failure covered.
test("pending view: a failing `git tag --merged HEAD` read with a readable HEAD is unverified, never no-release-tag", () => {
  const dir = bareRepository();
  git(dir, ["tag", "v1.0.0"]);
  commitFile(dir, "b.txt", "b\n", "2026-01-02T00:00:00Z", "after the tag");
  const report = runShipWithFault(dir, { read: "merged" });
  assert.strictEqual(report.pending.state, "unverified");
  assert.strictEqual(report.pending.commitCount, null);
  assert.strictEqual(report.marker.tag, "v1.0.0", "fixture sanity: only the reachable-tags read failed");
});

// Owner decision Q4 #1 (and the P4a finding): ship writes nothing — .git/index included. With stale stat
// data, `git status` without GIT_OPTIONAL_LOCKS=0 and `git diff <commit>` (working tree against a commit)
// refresh and rewrite the index.
test("ship.mjs never writes .git/index either: on a working tree with stale stat data, a full run leaves the index's bytes and mtime unchanged", () => {
  const dir = bareRepository();
  writePkg(dir, "package.json", JSON.stringify({ version: "1.1.0" }));
  writePkg(dir, "CHANGELOG.md", "# Changelog\n");
  git(dir, ["add", "."]);
  commitAt(dir, "2026-01-02T00:00:00Z", "release 1.0.0");
  git(dir, ["tag", "v1.0.0"]);
  commitFile(dir, "CHANGELOG.md", "# Changelog\n\n## 1.1.0\n", "2026-01-03T00:00:00Z", "changelog for 1.1.0");
  writeMapDoc(dir, { commit: git(dir, ["rev-parse", "HEAD"]), rollbackLines: ["- Exact steps: x <!-- CTIDE:TRUST:verified:2026-01-01 -->"] });
  fs.writeFileSync(path.join(dir, "artifact.tar.gz"), "bytes\n", "utf8");
  fs.writeFileSync(path.join(dir, "artifact.tar.gz.sha256"), sha256Hex(Buffer.from("bytes\n")) + "  artifact.tar.gz\n", "utf8");
  const index = path.join(dir, ".git", "index");
  const old = new Date("2020-01-01T00:00:00Z");
  fs.utimesSync(index, old, old);
  for (const tracked of ["a.txt", "CHANGELOG.md"]) fs.utimesSync(path.join(dir, tracked), new Date("2021-06-01T00:00:00Z"), new Date("2021-06-01T00:00:00Z"));
  const before = fs.readFileSync(index);

  const report = JSON.parse(runShip(dir, ["--cwd", ".", "--json", "--artifact", "artifact.tar.gz", "--checksum", "artifact.tar.gz.sha256"]));
  runShip(dir, ["--cwd", "."]);
  assert.strictEqual(report.checks.changelogTouched.status, "pass", "fixture sanity: the CHANGELOG.md diff ran");
  assert.strictEqual(report.pending.state, "ok", "fixture sanity: the pending reads ran");
  assert.strictEqual(fs.statSync(index).mtimeMs, old.getTime(), ".git/index was not rewritten");
  assert.deepStrictEqual(fs.readFileSync(index), before, ".git/index is byte-identical");
  git(dir, ["status", "--porcelain"], { env: { GIT_OPTIONAL_LOCKS: "1" } });
  assert.notStrictEqual(fs.statSync(index).mtimeMs, old.getTime(), "fixture sanity: the stat data was stale enough to make a plain git status rewrite the index");
});

// P4 review T-1: the case where reading CHANGELOG.md's change with `git diff <commit> -- CHANGELOG.md`
// (working tree against the marker commit) rewrites the index — CHANGELOG.md unchanged since the tag, with
// stale stat data — so a return to that read is caught.
test("changelogTouched: CHANGELOG.md unchanged since the tag, with stale stat data, is `fail`, and a full run leaves .git/index's bytes and mtime unchanged", () => {
  const dir = bareRepository();
  commitFile(dir, "CHANGELOG.md", "# Changelog\n", "2026-01-02T00:00:00Z", "release 1.0.0");
  git(dir, ["tag", "v1.0.0"]);
  commitFile(dir, "b.txt", "b\n", "2026-01-03T00:00:00Z", "after the tag");
  const index = path.join(dir, ".git", "index");
  const old = new Date("2020-01-01T00:00:00Z");
  fs.utimesSync(index, old, old);
  fs.utimesSync(path.join(dir, "CHANGELOG.md"), new Date("2021-06-01T00:00:00Z"), new Date("2021-06-01T00:00:00Z"));
  const before = fs.readFileSync(index);

  const report = JSON.parse(runShip(dir, ["--cwd", ".", "--json"]));
  runShip(dir, ["--cwd", "."]);
  assert.strictEqual(report.checks.changelogTouched.status, "fail", report.checks.changelogTouched.evidence);
  assert.strictEqual(fs.statSync(index).mtimeMs, old.getTime(), ".git/index was not rewritten");
  assert.deepStrictEqual(fs.readFileSync(index), before, ".git/index is byte-identical");
  git(dir, ["diff", "--name-only", git(dir, ["rev-parse", "v1.0.0^{commit}"]), "--", "CHANGELOG.md"], { env: { GIT_OPTIONAL_LOCKS: "0" } });
  assert.notStrictEqual(fs.statSync(index).mtimeMs, old.getTime(),
    "fixture sanity: `git diff <commit> -- CHANGELOG.md` rewrites this index even with GIT_OPTIONAL_LOCKS=0");
});

// changelogTouched reads only CHANGELOG.md: both reads carry the `-- CHANGELOG.md` pathspec (P4 review T-3).
function changelogFixture() {
  const dir = makeRepo({ prefix: "ctide-ship-changelog-", files: { "CHANGELOG.md": "# Changelog\n", "a.txt": "a\n" } });
  git(dir, ["tag", "v1.0.0"]);
  return dir;
}
const changelogStatus = (dir) => changelogTouchedCheck(dir, resolveMarker(dir)).status;

test("changelogTouched: an unrelated dirty tracked file, with CHANGELOG.md unchanged since the tag, is `fail`", () => {
  const dir = changelogFixture();
  fs.writeFileSync(path.join(dir, "a.txt"), "changed\n", "utf8");
  assert.strictEqual(changelogStatus(dir), "fail");
  fs.appendFileSync(path.join(dir, "CHANGELOG.md"), "- entry\n");
  assert.strictEqual(changelogStatus(dir), "pass", "control: an unstaged CHANGELOG.md edit is a change");
});

test("changelogTouched: an unrelated staged change, or a commit after the tag that leaves CHANGELOG.md alone, is `fail`", () => {
  const staged = changelogFixture();
  fs.writeFileSync(path.join(staged, "a.txt"), "changed\n", "utf8");
  git(staged, ["add", "a.txt"]);
  assert.strictEqual(changelogStatus(staged), "fail", "an unrelated staged change");
  const committed = changelogFixture();
  commitFile(committed, "b.txt", "b\n", "2026-01-02T00:00:00Z", "after the tag");
  assert.strictEqual(changelogStatus(committed), "fail", "an unrelated commit after the tag");
});

// Disclosed deviation (4): CHANGELOG.md counts as changed when it differs between the marker commit and the
// index or the working tree — so a change staged and then reverted in the working tree is a change.
test("changelogTouched: a CHANGELOG.md change staged and then reverted in the working tree counts as changed — `pass`", () => {
  const dir = changelogFixture();
  fs.writeFileSync(path.join(dir, "CHANGELOG.md"), "# Changelog\n\n- staged\n", "utf8");
  git(dir, ["add", "CHANGELOG.md"]);
  fs.writeFileSync(path.join(dir, "CHANGELOG.md"), "# Changelog\n", "utf8");
  assert.strictEqual(git(dir, ["diff", "--name-only", "v1.0.0", "--", "CHANGELOG.md"]), "", "fixture sanity: the working tree matches the tag");
  assert.strictEqual(changelogStatus(dir), "pass");
});

// Round-1 code#5: Node's default spawnSync maxBuffer is 1 MiB; lib/git's is 64 MiB. The ~20,000 paths are
// added to the index only (`update-index --index-info`, one blob), so the fixture stays fast.
test("pending view: a changed-file list over 1 MiB (NUL-separated) is still listed — 'showing 500 of N', not unverified", async () => {
  const dir = bareRepository();
  git(dir, ["tag", "v1.0.0"]);
  const blob = git(dir, ["hash-object", "-w", "--stdin"], { input: "same bytes\n" });
  const total = 20000;
  const paths = Array.from({ length: total }, (_, i) => `many/a-deliberately-long-directory-name-for-padding/file-${String(i).padStart(5, "0")}-with-a-padded-name.txt`);
  assert.ok(paths.reduce((sum, p) => sum + Buffer.byteLength(p) + 1, 0) > 1024 * 1024, "fixture sanity: the NUL-separated list is over 1 MiB");
  git(dir, ["update-index", "--index-info"], { input: paths.map((p) => `100644 ${blob}\t${p}\n`).join("") });
  commitAt(dir, "2026-01-02T00:00:00Z", "add many index-only paths");

  const out = runShip(dir, ["--cwd", "."]);
  assert.match(out, new RegExp(`truncated: showing ${PENDING_FILE_CAP} of ${total} files`));
  const report = await buildShipReport(dir, {});
  assert.strictEqual(report.pending.state, "ok");
  assert.strictEqual(report.pending.fileCount, total);
  assert.strictEqual(report.pending.files.length, PENDING_FILE_CAP);
});

// Round-1 re-check 2: lib/git pins i18n.logOutputEncoding=UTF-8 (a repository or user setting would make
// `git log` re-encode the subject, which ship decodes as UTF-8).
test("pending view: a non-ASCII commit subject is listed verbatim under i18n.logOutputEncoding=ISO-8859-1", async () => {
  const dir = bareRepository();
  git(dir, ["tag", "v1.0.0"]);
  const subject = `add caf${String.fromCodePoint(0xe9)} notes`;
  commitFile(dir, "notes.txt", "n\n", "2026-01-02T00:00:00Z", subject);
  git(dir, ["config", "i18n.logOutputEncoding", "ISO-8859-1"]);
  assert.ok(git(dir, ["log", "-1", "--format=%s"], { encoding: "buffer" }).includes(Buffer.from([0x63, 0x61, 0x66, 0xe9])),
    "fixture sanity: git log re-encodes the subject to ISO-8859-1");
  const report = await buildShipReport(dir, {});
  assert.deepStrictEqual(sortedSubjects(report.pending), [subject]);
  assert.ok(runShip(dir, ["--cwd", "."]).includes(subject), "text mode lists it verbatim too");
});

// P3 review m-1: --cwd is the repository read, whatever GIT_DIR / GIT_INDEX_FILE the caller inherited.
// The package.json version makes tagReady run `git status`, which reads the index: under the inherited
// GIT_INDEX_FILE it would compare --cwd's tree with the other repository's index and find it dirty.
test("CLI: an inherited absolute GIT_DIR and GIT_INDEX_FILE naming another repository do not change the repository --cwd reads", () => {
  const mine = bareRepository();
  commitFile(mine, "package.json", JSON.stringify({ version: "1.1.0" }), "2026-01-01T12:00:00Z", "declare 1.1.0");
  git(mine, ["tag", "v1.0.0"]);
  commitFile(mine, "mine.txt", "m\n", "2026-01-02T00:00:00Z", "only in the --cwd repository");
  const other = bareRepository();
  git(other, ["tag", "v2.0.0"]);
  commitFile(other, "theirs.txt", "t\n", "2026-01-02T00:00:00Z", "only in the inherited GIT_DIR's repository");
  const env = { ...process.env, GIT_DIR: path.join(other, ".git"), GIT_INDEX_FILE: path.join(other, ".git", "index") };
  delete env.CLAUDE_PROJECT_DIR;
  const result = cp.spawnSync(process.execPath, [SCRIPT, "--cwd", mine, "--json"], { encoding: "utf8", env });
  assert.strictEqual(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.strictEqual(report.marker.tag, "v1.0.0");
  assert.strictEqual(report.pending.tag, "v1.0.0");
  assert.deepStrictEqual(sortedSubjects(report.pending), ["only in the --cwd repository"]);
  assert.deepStrictEqual(report.pending.files, ["mine.txt"]);
  assert.strictEqual(report.checks.tagReady.status, "pass", report.checks.tagReady.evidence);
});

// P4-R5: a revision ship hands git is followed by "--", and the Map's current commit is read with
// `rev-parse -q --verify HEAD^{commit}`, so working-tree files named like a revision change nothing — without
// "--", git fails `log -1 v1.0.0`, `rev-list --count v1.0.0..HEAD` and `diff v1.0.0..HEAD` as ambiguous, and
// a plain `rev-parse HEAD` with no commit to resolve prints the file name "HEAD" and exits 0. `git log
// <range>` never checks a range against the working tree, so its "--" is pinned on the argument list.
test("working-tree files named HEAD, v1.0.0 and v1.0.0..HEAD change nothing ship reports: marker, pending view and Map staleness are as without them", async () => {
  const tagged = bareRepository();
  git(tagged, ["tag", "v1.0.0"]);
  commitFile(tagged, "b.txt", "b\n", "2026-01-02T00:00:00Z", "after the tag");
  writeMapDoc(tagged, { commit: git(tagged, ["rev-parse", "HEAD"]), rollbackLines: ["- Exact steps: x <!-- CTIDE:TRUST:verified:2026-01-01 -->"] });
  const unborn = makeRepo({ prefix: "ctide-ship-unborn-" });
  writeMapDoc(unborn, { commit: "UNBORN", rollbackLines: ["- Exact steps: x <!-- CTIDE:TRUST:verified:2026-01-01 -->"] });
  const viewOf = (report) => ({ marker: report.marker, pending: report.pending, migrationCompat: report.checks.migrationCompat });

  const taggedBefore = viewOf(await buildShipReport(tagged, {}));
  assert.strictEqual(taggedBefore.marker.found, true, "fixture sanity: the marker resolves");
  assert.strictEqual(taggedBefore.pending.state, "ok", "fixture sanity: the pending view lists");
  assert.strictEqual(taggedBefore.migrationCompat.stale, false, "fixture sanity: the Map is fresh");
  const unbornBefore = viewOf(await buildShipReport(unborn, {}));
  assert.strictEqual(unbornBefore.migrationCompat.stale, null, "fixture sanity: no commit, staleness undetermined");

  for (const name of ["HEAD", "v1.0.0", "v1.0.0..HEAD"]) fs.writeFileSync(path.join(tagged, name), "named like a revision\n", "utf8");
  fs.writeFileSync(path.join(unborn, "HEAD"), "named like a revision\n", "utf8");
  const calls = [];
  const realSpawnSync = cp.spawnSync;
  cp.spawnSync = function recordingSpawnSync(command, args) {
    if (command === "git") calls.push(args.map(String));
    return realSpawnSync.apply(this, arguments);
  };
  let taggedAfter;
  try { taggedAfter = viewOf(await buildShipReport(tagged, {})); } finally { cp.spawnSync = realSpawnSync; }
  assert.deepStrictEqual(taggedAfter, taggedBefore);
  assert.deepStrictEqual(viewOf(await buildShipReport(unborn, {})), unbornBefore);
  const logged = calls.filter((argv) => argv.includes("log") && argv.some((arg) => arg.startsWith("--max-count=")));
  assert.strictEqual(logged.length, 1, "fixture sanity: the pending view's git log ran once");
  assert.deepStrictEqual(logged[0].slice(-2), ["v1.0.0..HEAD", "--"]);
});

// --- regression: the plugin's own Stop hook must not read a ship report as an asserted READY verdict ---

test("a realistic ship report, disclaimer quoted verbatim, ends a session without tripping the Stop hook's READY/panel advisory", () => {
  const dir = bareRepository();
  git(dir, ["tag", "v1.0.0"]);
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

// README × 3, ship section (owner-approved wording, round-1 re-check): the paragraph describing the
// pending view, quoted as a final message, is not an asserted READY verdict to the plugin's own Stop hook.
for (const readme of ["README.md", "README.zh-TW.md", "README.ja.md"]) {
  test(`${readme}: the ship section's paragraph, quoted as a final message, does not trip the Stop hook's READY/panel advisory`, () => {
    const lines = fs.readFileSync(path.join(root, readme), "utf8").split(/\r?\n/);
    const heading = lines.findIndex((line) => line.startsWith("## Release-readiness"));
    assert.ok(heading >= 0, `${readme} has a "## Release-readiness" section`);
    const paragraph = lines.slice(heading + 1).find((line) => line.trim());
    assert.ok(paragraph.includes("/ctide:ship"), "fixture sanity: the first paragraph under the heading describes ship");
    const transcript = mkTranscript([
      { role: "user", content: "/ctide:ship" },
      { role: "assistant", content: paragraph },
    ]);
    assert.strictEqual(orch({ transcript_path: transcript, last_assistant_message: paragraph }), null,
      "the README's ship paragraph is not a READY verdict: the Stop hook stays silent");
    const control = orch({ transcript_path: transcript, last_assistant_message: `${paragraph}\n\nFinal verdict: READY` });
    assert.ok(control && /core review panel/.test(control.systemMessage),
      "control: the same paragraph plus an asserted READY verdict does trip the advisory, so the silence above is meaningful");
  });
}

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
  git(dir, ["tag", "v1.0.0"]);
  writePkg(dir, "package.json", JSON.stringify({ version: "1.0.0" }));
  fs.writeFileSync(path.join(dir, "CHANGELOG.md"), "# Changelog\n", "utf8");
  writeMapDoc(dir, { commit: git(dir, ["rev-parse", "HEAD"]), rollbackLines: ["- Exact steps: x <!-- CTIDE:TRUST:verified:2026-01-01 -->"] });
  fs.writeFileSync(path.join(dir, "artifact.tar.gz"), "bytes\n", "utf8");
  fs.writeFileSync(path.join(dir, "artifact.tar.gz.sha256"), sha256Hex(Buffer.from("bytes\n")) + "  artifact.tar.gz\n", "utf8");

  const before = snapshotTree(dir);
  runShip(dir, ["--cwd", ".", "--json", "--artifact", "artifact.tar.gz", "--checksum", "artifact.tar.gz.sha256"]);
  const after = snapshotTree(dir);
  assertSameSnapshot(before, after);
});

// --- fail-open: a missing git repository / a malformed manifest still exit 0, valid JSON ---

test("fail-open: a missing git repository still exits 0 and prints valid, well-shaped JSON", () => {
  const dir = tempDir("ctide-ship-fo-nogit-");
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
