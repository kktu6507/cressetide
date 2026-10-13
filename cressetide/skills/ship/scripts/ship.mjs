#!/usr/bin/env node
// ctide ship: a manually-triggered, read-only release-readiness report. Reads the git history since
// the last release tag (commits and changed files — a pending view, never a readiness claim), the
// project's package.json manifest(s), CHANGELOG.md's git history, git tags/tree state, and
// SYSTEM_MAP.md's Rollback section, and reports a decision-card-shaped result. It never executes a
// build/test/deploy pipeline, and it never writes anything, anywhere: no working-tree mutation, no
// `.ctide/` write, no state-changing git command. Every fs/git/parse failure swallows to a disclosed
// gap (`unverified`, never silently treated as clean); the CLI always exits 0 — this repo's universal
// fail-open contract (matches map.mjs / doctor.mjs / contract-check.mjs).
//
// Self-contained by design (no imports across skill directories — the same boundary map.mjs and
// doctor.mjs each keep for their own scripts): the flag parser mirrors failure-consolidate.mjs's
// KNOWN_FLAGS/get() shape, the git() helper mirrors map.mjs's spawnSync-with-piped-stdio
// shape, and the migration-compatibility reader mirrors map.mjs's OPS_TRUST_TAG_ATTEMPT /
// opsTrustTagIsWellFormed sentinel-only parsing — each reused as a PATTERN, not an import, per the
// reject-cross-skill-import placement decision.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// --- small shared helpers --------------------------------------------------------------------------

// Bounds an evidence/detail string so a pathological or adversarial input (a huge malformed
// package.json, a giant Rollback section) can never make the report unbounded.
function cap(value, limit) {
  const text = String(value ?? "");
  return text.length > limit ? text.slice(0, limit) + "…" : text;
}

// A fs error's `.code` (e.g. "ENOENT", "EACCES") is a stable, path-free classifier; `.message` on a
// read failure typically embeds the full attempted path, so evidence text prefers `.code` to avoid
// leaking a local absolute path into a report a user might paste elsewhere.
function safeErrorCode(error) {
  const code = String(error?.code || "");
  return /^[A-Z0-9_]{1,40}$/.test(code) ? code : "read error";
}

// --- git shelling (mirrors map.mjs's git() helper: spawnSync, explicit piped stdio, a timeout — the
// FAILURE_MEMORY 2026-07-19 fix for execFileSync/execSync's stderr-inheritance leak) ------------------

// git() kept in sync with map.mjs (documented copy — see garden hash guard)
function git(root, args) {
  return spawnSync("git", ["-C", root, ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10000,
  });
}

// A shallow clone (`git clone --depth N`) can be missing tags that exist upstream but were never
// fetched locally — `git tag --list` and `git rev-parse --verify refs/tags/<x>` both simply do not see
// such a tag, indistinguishable locally from the tag genuinely not existing anywhere. Every shallow-clone
// disclosure below (marker note, tagReady evidence, pending view) uses the same weak-signal wording,
// "history truncated — weak-signal only". Asked of git itself, so the answer holds from a subdirectory
// or a linked worktree too (neither has a `.git/shallow` of its own). A failed probe reads as "not
// shallow", as before.
function isShallowClone(root) {
  const probe = git(root, ["rev-parse", "--is-shallow-repository"]);
  return probe.status === 0 && String(probe.stdout || "").trim() === "true";
}

// One trimmed, non-empty entry per output line (e.g. one tag name per line from `git tag`).
function outputLines(stdout) {
  return String(stdout || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

// --- release-marker resolution ------------------------------------------------------------------------

// `vX.Y.Z`, optionally without the `v` prefix — the same tag shape RELEASING.md already defines for
// this repository's own releases.
const TAG_VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)$/;

export function parseVersionTag(tag) {
  const match = TAG_VERSION_RE.exec(String(tag ?? "").trim());
  if (!match) return null;
  return { tag: tag.trim(), major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

// Ordered by VERSION (major, then minor, then patch), never lexicographic string sort — `v9.0.0` must
// not sort after `v10.0.0`. Returns the winning tag STRING, or null when no candidate matches. Pure:
// takes a plain list of tag name strings, no git/fs access, so marker-ordering is unit-testable
// without a real repository.
export function pickLatestVersionTag(tagNames) {
  const candidates = (tagNames || []).map(parseVersionTag).filter(Boolean);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.major - b.major || a.minor - b.minor || a.patch - b.patch);
  return candidates[candidates.length - 1].tag;
}

// No tag found -> fail-open: { found: false }, with the gap disclosed via `note` (changelogTouched then
// reports `unverified` — no diff boundary). Swallows any git failure (non-git cwd, git missing) the same way.
export function resolveMarker(root) {
  const listed = git(root, ["tag", "--list"]);
  const winner = pickLatestVersionTag(listed.status === 0 ? outputLines(listed.stdout) : []);
  if (!winner) {
    const shallowNote = isShallowClone(root)
      ? " (history truncated — weak-signal only: this is a shallow clone, so a matching tag may exist upstream without having been fetched locally)"
      : "";
    return {
      found: false, tag: null, commit: null,
      note: "no vX.Y.Z release tag found" + shallowNote,
    };
  }
  // `git log` transparently dereferences an annotated tag to its underlying commit, so this resolves
  // correctly whether `winner` is a lightweight or an annotated/signed tag.
  const info = git(root, ["log", "-1", "--format=%H", winner]);
  const commitRaw = info.status === 0 ? String(info.stdout || "").trim() : "";
  if (!commitRaw) {
    return {
      found: false, tag: winner, commit: null,
      note: `tag ${winner} was found but its commit could not be resolved`,
    };
  }
  return { found: true, tag: winner, commit: commitRaw, note: null };
}

// --- pending-changes view (git-derived: commits and changed files since the last release tag) -----------

// Stated verbatim in both output modes. The pending view is a plain git fact — what changed since the
// last release tag — and carries no review outcome: a commit appearing here was never checked by
// anything, and an empty list is never "safe to ship". The wording carries no verdict token: a ship
// report quotes it verbatim, and the Stop hook reads READY anywhere in a final message as an asserted
// verdict.
export const PENDING_DISCLAIMER = "changes since the last release tag — not a readiness claim; nothing listed here has been reviewed or approved";
export const PENDING_COMMIT_CAP = 200;
export const PENDING_FILE_CAP = 500;

function pendingView(state, note, extra = {}) {
  return {
    state, disclaimer: PENDING_DISCLAIMER, note,
    tag: null, tagCommit: null,
    commitCount: null, commits: [], commitsTruncated: false,
    fileCount: null, files: [], filesTruncated: false,
    ...extra,
  };
}

// Every non-`ok` state is its own disclosed reason why no list could be produced — never an empty list
// standing in for "nothing to ship". States: `git-unavailable` (git could not be spawned),
// `not-a-git-repo`, `shallow-clone` (history cannot be bounded), `no-release-tag` (no vX.Y.Z tag
// reachable from HEAD, including a repository with no commits yet), `unverified` (git started but a
// read failed or timed out), `ok` (0..N commits and files, each list capped with an explicit
// truncation flag and the uncapped total).
//
// The boundary uses the release marker's own tag grammar and version ordering (parseVersionTag /
// pickLatestVersionTag), applied only to the tags reachable from HEAD — so a pre-release or four-part
// tag is never a boundary, and a bare X.Y.Z tag is one. `markerTag` (the release marker's tag) is only
// used to name both tags when they differ.
export function pendingChanges(root, markerTag = null) {
  const inside = git(root, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.error) {
    return inside.error.code === "ENOENT"
      ? pendingView("git-unavailable", "git could not be run — commits since the last release tag are unknown")
      : pendingView("unverified", `git could not be run (${safeErrorCode(inside.error)}) — commits since the last release tag are unknown`);
  }
  if (inside.status !== 0 || String(inside.stdout || "").trim() !== "true") {
    return pendingView("not-a-git-repo", "not inside a git working tree — commits since the last release tag are unknown");
  }
  if (isShallowClone(root)) {
    return pendingView("shallow-clone",
      "history truncated — weak-signal only: this is a shallow clone, so commits since the last release tag cannot be bounded (fetch full history and tags to see them)");
  }
  const noReleaseTag = () => pendingView("no-release-tag",
    "no vX.Y.Z release tag is reachable from HEAD — there is no boundary to list changes from; this is not \"nothing to ship\"");
  const head = git(root, ["rev-parse", "-q", "--verify", "HEAD"]);
  if (head.error) {
    return pendingView("unverified", "reading HEAD failed — commits since the last release tag are unknown");
  }
  if (head.status !== 0) return noReleaseTag(); // no commits yet
  const merged = git(root, ["tag", "--merged", "HEAD"]);
  if (merged.error || merged.status !== 0) {
    return pendingView("unverified", "listing the tags reachable from HEAD failed — commits since the last release tag are unknown");
  }
  const tag = pickLatestVersionTag(outputLines(merged.stdout));
  if (!tag) return noReleaseTag();
  const markerNote = markerTag && markerTag !== tag
    ? ` (the release marker is ${markerTag}; this list counts from ${tag}, the highest-version release tag reachable from HEAD)`
    : "";
  const range = `${tag}..HEAD`;
  const tagInfo = git(root, ["rev-parse", "--short", `${tag}^{commit}`]);
  const counted = git(root, ["rev-list", "--count", range]);
  const logged = git(root, ["log", `--max-count=${PENDING_COMMIT_CAP}`, "--format=%h%x09%s", range]);
  // `--no-renames`: a renamed file is listed under both its old and its new path, so a reader matching
  // paths (e.g. Rollback relevance) still sees the old one. `-c diff.relative=false`: a user's
  // `diff.relative=true` would otherwise make the paths relative to a subdirectory `--cwd` and drop
  // every file outside it.
  const diffed = git(root, ["-c", "diff.relative=false", "diff", "--name-only", "--no-renames", "-z", range]);
  const commitCount = Number(String(counted.stdout || "").trim());
  if (tagInfo.status !== 0 || counted.status !== 0 || logged.status !== 0 || diffed.status !== 0
      || !Number.isInteger(commitCount)) {
    return pendingView("unverified", `found ${tag}, but reading the commits or changed files since it failed${markerNote}`, { tag });
  }
  const commits = String(logged.stdout || "").split(/\r?\n/).filter(Boolean).map((line) => {
    const tab = line.indexOf("\t");
    return tab < 0
      ? { sha: line.slice(0, 40), subject: "" }
      : { sha: line.slice(0, tab).slice(0, 40), subject: cap(line.slice(tab + 1), 200) };
  });
  const allFiles = String(diffed.stdout || "").split("\0").filter(Boolean);
  const tagCommit = String(tagInfo.stdout || "").trim();
  return pendingView("ok",
    (commitCount === 0 ? `no commits since ${tag}` : `${commitCount} commit(s) and ${allFiles.length} changed file(s) since ${tag}`) + markerNote,
    {
      tag, tagCommit,
      commitCount, commits, commitsTruncated: commitCount > commits.length,
      fileCount: allFiles.length, files: allFiles.slice(0, PENDING_FILE_CAP).map((f) => cap(f, 300)),
      filesTruncated: allFiles.length > PENDING_FILE_CAP,
    });
}

// --- version-consistency reader (own, small, package.json-only per the resolved scope decision) -------

const MANIFEST_EXCLUDE_DIRS = new Set([".git", ".ctide", "node_modules", "dist", "build", "coverage", "vendor"]);

// Every `package.json` under `root` (excluding vcs/dependency/build noise), relative-posix-path sorted.
// A bounded, deterministic scan for one exact filename — not the heuristic directory guessing the
// checksum check is explicitly forbidden from doing (that prohibition is about GUESSING which file is
// a build artifact; finding files literally named "package.json" is unambiguous).
function findPackageManifests(root) {
  const found = [];
  function walk(absoluteDir, relativeDir) {
    let entries;
    try { entries = fs.readdirSync(absoluteDir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (MANIFEST_EXCLUDE_DIRS.has(entry.name)) continue;
      const absolute = path.join(absoluteDir, entry.name);
      const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      let stat;
      try { stat = fs.lstatSync(absolute); } catch { continue; }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) walk(absolute, relative);
      else if (stat.isFile() && entry.name === "package.json") found.push(relative);
    }
  }
  walk(root, "");
  return found.sort();
}

// 0 or 1 manifest with a version field -> not-applicable (nothing to be inconsistent with — no card
// noise for the common single-package project). >=2 agreeing -> pass. >=2 disagreeing -> fail. ANY
// manifest that fails to parse -> unverified with the parse error named, never silently dropped from
// the comparison (so a broken manifest can never be mistaken for a consistent one).
export function versionConsistencyCheck(root) {
  const files = findPackageManifests(root);
  const versions = [];
  const malformed = [];
  for (const file of files) {
    let raw;
    try { raw = fs.readFileSync(path.join(root, file), "utf8"); }
    catch (error) { malformed.push(`${file} (${safeErrorCode(error)})`); continue; }
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (error) { malformed.push(`${file} (${cap(error.message, 120)})`); continue; }
    if (parsed && typeof parsed.version === "string" && parsed.version.trim()) {
      // Capped at the source (not just in the evidence strings below) so the `manifests` array itself —
      // returned verbatim in every branch, including inside the full JSON report — can never carry an
      // unbounded value; a pathological/malicious local package.json must never blow up the report size.
      versions.push({ file, version: cap(parsed.version.trim(), 80) });
    }
  }
  if (malformed.length) {
    return { status: "unverified", evidence: cap(`could not parse: ${malformed.join("; ")}`, 1000), manifests: versions };
  }
  if (versions.length <= 1) {
    const evidence = versions.length === 0
      ? "no package.json with a version field found"
      : `only one manifest declares a version: ${versions[0].file}@${versions[0].version}`;
    return { status: "not-applicable", evidence, manifests: versions };
  }
  const distinct = new Set(versions.map((v) => v.version));
  if (distinct.size === 1) {
    return { status: "pass", evidence: `${versions.length} manifests agree on version ${versions[0].version}`, manifests: versions };
  }
  const listed = versions.slice(0, 20).map((v) => `${v.file}@${v.version}`).join(", ");
  return { status: "fail", evidence: cap(`version mismatch across manifests: ${listed}`, 1000), manifests: versions };
}

// --- changelog-touched checker (git-diff-based) ---------------------------------------------------------

export function changelogTouchedCheck(root, marker) {
  if (!fs.existsSync(path.join(root, "CHANGELOG.md"))) {
    return { status: "not-applicable", evidence: "no CHANGELOG.md in this repository" };
  }
  if (!marker.found || !marker.commit) {
    return { status: "unverified", evidence: "no release marker resolved — cannot determine a diff boundary for CHANGELOG.md" };
  }
  const diff = git(root, ["diff", "--name-only", marker.commit]);
  if (diff.status !== 0) {
    return { status: "unverified", evidence: `git diff against ${marker.tag} (${marker.commit.slice(0, 7)}) failed` };
  }
  const touched = String(diff.stdout || "").split(/\r?\n/)
    .map((s) => s.trim().replaceAll("\\", "/")).filter(Boolean).includes("CHANGELOG.md");
  return touched
    ? { status: "pass", evidence: `CHANGELOG.md changed since ${marker.tag} (${marker.commit.slice(0, 7)})` }
    : { status: "fail", evidence: `CHANGELOG.md has not changed since ${marker.tag} (${marker.commit.slice(0, 7)})` };
}

// --- tag-readiness checker -----------------------------------------------------------------------------

// "Target version" is whatever version-consistency already resolved — ship never picks or bumps one
// itself. Depends on version-consistency passing first: a "fail" (manifests disagree) or "unverified"
// (a manifest failed to parse) leaves no single trustworthy target, so this reports `unverified`
// ("blocked by …") rather than guessing which manifest to trust.
export function tagReadinessCheck(root, versionConsistency) {
  if (versionConsistency.status === "fail") {
    return { status: "unverified", evidence: "blocked by version-consistency failure — manifests disagree on version, no single target to check" };
  }
  if (versionConsistency.status === "unverified") {
    return { status: "unverified", evidence: "blocked by version-consistency being unverified — a manifest failed to parse, no trustworthy target" };
  }
  const target = versionConsistency.manifests.find((m) => m.version)?.version;
  if (!target) {
    return { status: "not-applicable", evidence: "no declared version found in this project's package.json" };
  }
  const candidateTags = [...new Set([`v${target}`, target])];
  const existingTag = candidateTags.find((tag) => git(root, ["rev-parse", "-q", "--verify", `refs/tags/${tag}`]).status === 0);
  if (existingTag) {
    return { status: "fail", evidence: `tag ${existingTag} already exists for version ${target} — bump the version before tagging again` };
  }
  // A shallow clone can be missing a tag that exists upstream without ever having been fetched locally —
  // "no matching ref found here" is then indistinguishable from "no such tag exists anywhere", so neither
  // a confident `pass` nor a dirty-tree `fail` can be trusted; downgrade the whole not-found branch to
  // `unverified` rather than risk exactly the duplicate-tag mistake this check exists to catch.
  if (isShallowClone(root)) {
    return {
      status: "unverified",
      evidence: `history truncated — weak-signal only: this is a shallow clone, so a tag for v${target} cannot be confirmed absent — it may already exist upstream without having been fetched locally`,
    };
  }
  const statusResult = git(root, ["status", "--porcelain"]);
  if (statusResult.status !== 0) {
    return { status: "unverified", evidence: "could not determine working-tree cleanliness (git status failed)" };
  }
  const dirty = String(statusResult.stdout || "").trim().length > 0;
  if (dirty) {
    return { status: "fail", evidence: `working tree is dirty — commit or stash changes before tagging v${target}` };
  }
  return { status: "pass", evidence: `no existing tag for v${target}; working tree is clean` };
}

// --- migration-compatibility reader (reads only the CTIDE:TRUST sentinel, never Rollback prose) --------
// Mirrors map.mjs's OPS_TRUST_TAG_ATTEMPT / opsTrustTagIsWellFormed exactly (map.mjs:79,84,91-96):
// the ONLY thing this reader parses out of the Rollback section is the machine-sentinel HTML comment;
// the surrounding free-form prose is surfaced verbatim as `rollbackText` for the coordinating thread's
// own relevance judgment, never pattern-matched here (FAILURE_MEMORY 2026-07-16: prose-heuristic
// matching over free-form human-edited text never converged before this repo settled on
// machine-sentinel-only parsing).
// OPS_TRUST_TAG_ATTEMPT kept in sync with map.mjs (documented copy — see garden hash guard)
const OPS_TRUST_TAG_ATTEMPT = /<!--\s*CTIDE:TRUST:[^>]*-->/g;
// OPS_TRUST_TAG_WELLFORMED kept in sync with map.mjs (documented copy — see garden hash guard)
const OPS_TRUST_TAG_WELLFORMED = /^<!--\s*CTIDE:TRUST:(verified|dry-run-verified|unverified)(?:\s*:\s*(\S+))?\s*-->$/;

// isValidIsoDate() kept in sync with map.mjs (documented copy — see garden hash guard)
function isValidIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z)?$/.exec(value || "");
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, millisecondText] = match;
  const expected = [yearText, monthText, dayText, hourText || "00", minuteText || "00", secondText || "00", millisecondText || "000"].map(Number);
  const parsed = new Date(0);
  parsed.setUTCFullYear(expected[0], expected[1] - 1, expected[2]);
  parsed.setUTCHours(expected[3], expected[4], expected[5], expected[6]);
  return Number.isFinite(parsed.getTime()) && [
    parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate(),
    parsed.getUTCHours(), parsed.getUTCMinutes(), parsed.getUTCSeconds(), parsed.getUTCMilliseconds(),
  ].every((part, index) => part === expected[index]);
}

// opsTrustTagIsWellFormed() kept in sync with map.mjs (documented copy — see garden hash guard)
function opsTrustTagIsWellFormed(tag) {
  const match = OPS_TRUST_TAG_WELLFORMED.exec(tag);
  if (!match) return false;
  const [, tier, date] = match;
  return tier === "unverified" || isValidIsoDate(date);
}

// Slices the "## Rollback" section's body out of a SYSTEM_MAP.md-shaped document, bounded by the next
// "\n## " heading or end-of-file — mirrors map.mjs's sliceSection for the one section ship reads.
function sliceRollbackSection(text) {
  const marker = "## Rollback";
  const start = text.indexOf(marker);
  if (start < 0) return null;
  const contentStart = start + marker.length;
  const end = text.indexOf("\n## ", contentStart);
  return text.slice(contentStart, end < 0 ? text.length : end);
}

// Presence and well-formedness are checked as two independent operations, matching map.mjs's own split
// (a block can have zero tags, or one-or-more tags where some are malformed — these are different
// findings, never conflated).
function analyzeRollbackBlock(block) {
  const tags = block.match(OPS_TRUST_TAG_ATTEMPT) || [];
  const malformed = tags.filter((tag) => !opsTrustTagIsWellFormed(tag));
  const tiers = tags
    .filter((tag) => !malformed.includes(tag))
    .map((tag) => OPS_TRUST_TAG_WELLFORMED.exec(tag)[1]);
  return { tagCount: tags.length, malformed, tiers };
}

export function migrationCompatibilityCheck(root) {
  const mapPath = path.join(root, ".ctide", "map", "SYSTEM_MAP.md");
  if (!fs.existsSync(mapPath)) {
    return {
      status: "unverified", evidence: "no .ctide/map/SYSTEM_MAP.md found",
      stale: null, rollbackText: "", recommendation: "run /ctide:map to establish a Rollback baseline",
    };
  }
  let text;
  try { text = fs.readFileSync(mapPath, "utf8"); }
  catch (error) {
    return {
      status: "unverified", evidence: `could not read SYSTEM_MAP.md (${safeErrorCode(error)})`,
      stale: null, rollbackText: "",
    };
  }

  const firstSection = text.indexOf("\n## ");
  const header = firstSection < 0 ? text : text.slice(0, firstSection);
  const recordedCommit = header.match(/^Verified at commit:\s*(.+)$/m)?.[1]?.trim() || null;
  const head = git(root, ["rev-parse", "HEAD"]);
  const currentCommit = head.status === 0 ? String(head.stdout || "").trim() || null : null;
  // null when staleness cannot be determined (missing recorded commit, or no resolvable git HEAD) —
  // kept distinct from a definite `false`, and disclosed rather than silently treated as fresh.
  const stale = (!recordedCommit || !currentCommit) ? null : recordedCommit !== currentCommit;
  // Covers both disclosure cases, not just "could not determine" — when stale is definitely true, every
  // branch below that appends `staleNote` must say so too, regardless of which OTHER condition (missing
  // tag, malformed tag, all-unverified tiers) happens to match first; only the dedicated `stale === true`
  // branch further down builds its own fuller, commit-SHA-bearing message and does not use `staleNote`.
  const staleNote = stale === null ? " (staleness could not be determined)"
    : stale === true ? " (Map is also stale — treat Rollback content as suspect)"
    : "";

  const block = sliceRollbackSection(text);
  if (block === null) {
    return {
      status: "unverified", evidence: "SYSTEM_MAP.md has no Rollback section" + staleNote,
      stale, rollbackText: "", recommendation: "run /ctide:map refresh",
    };
  }
  const rollbackText = cap(block.trim(), 4000);
  const { tagCount, malformed, tiers } = analyzeRollbackBlock(block);

  if (tagCount === 0) {
    return { status: "unverified", evidence: "Rollback section has no CTIDE:TRUST tag" + staleNote, stale, rollbackText };
  }
  if (malformed.length) {
    return {
      status: "unverified",
      evidence: cap(`Rollback section has a malformed trust tag: ${malformed.join(", ")}`, 500) + staleNote,
      stale, rollbackText,
    };
  }
  if (tiers.every((tier) => tier === "unverified")) {
    return { status: "unverified", evidence: "Rollback section's trust tag(s) are all unverified" + staleNote, stale, rollbackText };
  }
  if (stale === true) {
    return {
      status: "unverified",
      evidence: `SYSTEM_MAP.md is stale (recorded commit ${recordedCommit.slice(0, 7)}, current ${currentCommit.slice(0, 7)}) — treat Rollback content as suspect`,
      stale, rollbackText,
    };
  }
  return { status: "pass", evidence: "Rollback section has a fresh, well-formed, non-unverified trust tag" + staleNote, stale, rollbackText };
}

// --- checksum verifier (conditional, CLI-flag-only — no heuristic directory scanning) -------------------
// Mirrors the `<sha256>  <filename>` shape this repo's own release tooling produces
// (.github/scripts/publish-release-core.mjs / publish-release.mjs), tolerating a bare digest-only line
// too (no filename cross-check in that case).
const CHECKSUM_LINE_RE = /^([a-fA-F0-9]{64})(?:[ \t]+[*]?(\S.*))?$/;

// Hashes a file by streaming fixed-size chunks through an incremental crypto.Hash, so a real release
// artifact (hundreds of MB to GB) is never held in memory whole, unlike a single fs.readFileSync would.
async function hashFileStreaming(filePath) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

export async function checksumVerifyCheck(root, artifactFlag, checksumFlag) {
  if (!artifactFlag && !checksumFlag) {
    return { status: "not-applicable", evidence: "no --artifact/--checksum flags supplied" };
  }
  if (!artifactFlag || !checksumFlag) {
    return { status: "unverified", evidence: "both --artifact and --checksum are required together; only one was supplied" };
  }
  const artifactPath = path.resolve(root, artifactFlag);
  const checksumPath = path.resolve(root, checksumFlag);
  if (!fs.existsSync(artifactPath)) return { status: "unverified", evidence: `artifact not found: ${artifactFlag}` };
  if (!fs.existsSync(checksumPath)) return { status: "unverified", evidence: `checksum file not found: ${checksumFlag}` };

  let checksumRaw;
  try { checksumRaw = fs.readFileSync(checksumPath, "utf8"); }
  catch (error) { return { status: "unverified", evidence: `could not read checksum file (${safeErrorCode(error)})` }; }
  const lines = checksumRaw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (lines.length !== 1) {
    return { status: "unverified", evidence: `checksum file must contain exactly one line, found ${lines.length}` };
  }
  const match = CHECKSUM_LINE_RE.exec(lines[0]);
  if (!match) {
    return { status: "unverified", evidence: "checksum file is not in the expected '<sha256>  <filename>' format" };
  }
  const recordedHash = match[1].toLowerCase();
  const recordedName = match[2]?.trim();
  const artifactName = path.basename(artifactPath);
  if (recordedName && recordedName !== artifactName) {
    return { status: "fail", evidence: cap(`checksum file names "${recordedName}" but --artifact is "${artifactName}"`, 500) };
  }

  let actualHash;
  try { actualHash = await hashFileStreaming(artifactPath); }
  catch (error) { return { status: "unverified", evidence: `could not hash artifact (${safeErrorCode(error)})` }; }
  if (actualHash !== recordedHash) {
    return { status: "fail", evidence: `checksum mismatch for ${artifactName}: recorded ${recordedHash}, actual ${actualHash}` };
  }
  return { status: "pass", evidence: `checksum verified for ${artifactName}` };
}

// --- orchestration ---------------------------------------------------------------------------------------

// A single read-only pass: resolve the marker, read the pending view, run every check, return one
// structured result. The five checks always run, whatever the pending view's state or size. Never
// throws — every check above already swallows its own fs/git/parse failures to a disclosed
// `unverified`/`not-applicable`, so this function has nothing left to catch. Async only because
// checksumVerifyCheck streams the artifact hash (see hashFileStreaming above); every other check stays
// synchronous.
export async function buildShipReport(cwdInput, options = {}) {
  const root = path.resolve(cwdInput || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const marker = resolveMarker(root);
  const pending = pendingChanges(root, marker.tag);
  const versionConsistency = versionConsistencyCheck(root);
  const changelogTouched = changelogTouchedCheck(root, marker);
  const tagReady = tagReadinessCheck(root, versionConsistency);
  const migrationCompat = migrationCompatibilityCheck(root);
  const checksumVerify = await checksumVerifyCheck(root, options.artifact, options.checksum);
  return {
    marker,
    pending,
    checks: { versionConsistency, changelogTouched, tagReady, migrationCompat, checksumVerify },
  };
}

function formatText(report) {
  const lines = ["ctide-ship (read-only, writes nothing):"];
  lines.push(report.marker.found
    ? `marker: ${report.marker.tag} @ ${report.marker.commit.slice(0, 7)}`
    : `marker: none found — ${report.marker.note}`);
  const pending = report.pending;
  lines.push(`pending (${pending.disclaimer}):`);
  if (pending.state !== "ok") {
    lines.push(`  ${pending.state.toUpperCase()}: ${pending.note}`);
  } else {
    lines.push(`  ${pending.note} (tag commit ${pending.tagCommit})`);
    if (pending.commits.length) {
      lines.push("  commits:");
      for (const commit of pending.commits) lines.push(`    - ${commit.sha} ${commit.subject}`);
      if (pending.commitsTruncated) {
        lines.push(`    … truncated: showing ${pending.commits.length} of ${pending.commitCount} commits`);
      }
    }
    if (pending.files.length) {
      lines.push("  changed files:");
      for (const file of pending.files) lines.push(`    - ${file}`);
      if (pending.filesTruncated) {
        lines.push(`    … truncated: showing ${pending.files.length} of ${pending.fileCount} files`);
      }
    }
  }
  lines.push("checks:");
  for (const [name, check] of Object.entries(report.checks)) {
    lines.push(`  ${check.status.toUpperCase()} ${name}: ${check.evidence}`);
  }
  return lines.join("\n");
}

// Every flag token this file's `get()` closure is ever queried with, plus the boolean `--json` flag —
// this file's own complete recognized-flag set. Mirrors failure-consolidate.mjs's KNOWN_FLAGS guard: `get()`
// treats the value slot as omitted when the next token is itself one of these names, so a swallowed
// neighboring flag (e.g. `--artifact --checksum x`) never silently becomes another flag's value.
export const KNOWN_FLAGS = ["--cwd", "--artifact", "--checksum", "--json"];

// Builds the report shown when an unexpected internal error escapes every check's own swallowing (should
// be unreachable — every check above already swallows its own fs/git/parse failures — but if ever
// reached, must still degrade to a disclosed gap, not a crash, and stay path-hygienic like every other
// failure path in this file: safeErrorCode, never a raw .message that could embed a local absolute path.
// Exported so this last-resort path stays independently testable without needing to force a real crash
// through the CLI.
export function buildErrorFallbackReport(error) {
  const note = `ship encountered an unexpected internal error (${safeErrorCode(error)})`;
  return {
    marker: { found: false, tag: null, commit: null, note },
    pending: pendingView("unverified", `${note} — commits since the last release tag are unknown`),
    checks: {},
  };
}

async function main(argv) {
  const args = argv.slice(2);
  const get = (flag, def) => {
    const i = args.indexOf(flag);
    const v = i >= 0 ? args[i + 1] : undefined;
    return v && !KNOWN_FLAGS.includes(v) ? v : def;
  };
  const asJson = args.includes("--json");
  try {
    const cwd = get("--cwd", process.env.CLAUDE_PROJECT_DIR || process.cwd());
    const report = await buildShipReport(cwd, { artifact: get("--artifact", ""), checksum: get("--checksum", "") });
    process.stdout.write((asJson ? JSON.stringify(report, null, 2) : formatText(report)) + "\n");
  } catch (error) {
    // Fail-open: this should be unreachable (every check above already swallows its own failures), but
    // an unexpected internal error must still degrade to a disclosed gap rather than a crash — in BOTH
    // modes now, not only text mode.
    const fallback = buildErrorFallbackReport(error);
    process.stdout.write((asJson ? JSON.stringify(fallback, null, 2) : `ctide-ship: unexpected error — ${safeErrorCode(error)}`) + "\n");
  }
  process.exit(0);
}

// isInvokedDirectly() kept in sync with the other 10 CLI entry points (documented copy — see garden hash guard)
function isInvokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isInvokedDirectly()) {
  main(process.argv).catch(() => process.exit(0));
}
