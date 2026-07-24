// Coverage for the ACTUALLY-INVOKED release-publishing logic in .github/scripts/publish-release.mjs
// -- its own createArchive()/publish() path and the `if (isInvokedDirectly())` CLI entry point,
// which is what package.json's release:archive/release:publish scripts and the release workflow
// really call. This is a deliberately stricter, tag-must-already-exist-and-match-HEAD implementation
// (see this file's own header comment), separate from publish-release-core.mjs's runRelease() -- an
// intentionally-kept, separately reusable library that nothing in this repo currently calls, already
// covered end-to-end by test/release-publisher.test.mjs. Kept in its own file, with its own
// "release CLI:" test-name prefix, so the two differently-behaved implementations are never confused.
//
// SAFETY: publish-release.mjs's --publish mode (and the publish()/runReleaseCommand()/
// inspectPublishedRelease()/downloadPublished() functions it calls) can reach the real `gh` CLI and
// create or modify a REAL GitHub release. No test below ever spawns publish-release.mjs --publish as
// a child process, and every in-process call to a gh-touching function is given a fully injected fake
// in place of gh -- traced per test in comments where the seam is non-obvious.
import assert from "node:assert";
import cp from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import zlib from "node:zlib";
import {
  downloadPublished,
  entriesFromTag,
  inspectPublishedRelease,
  publish,
  releaseIdentityFromTag,
  runReleaseCommand,
  validatePublishedAssetInventory,
  validateTaggedReleaseState,
  verifyDownloaded,
  verifyOrRepairPublished,
} from "../.github/scripts/publish-release.mjs";
import { parseTar, root } from "./support.mjs";
import { hardenGitSigning, temporary } from "./helpers.mjs";

const TEST_VERSION = "9.9.9";
const TEST_TAG = `v${TEST_VERSION}`;
const ASSET_NAME = `ctide-${TEST_TAG}-plugin.tar.gz`;
const CHECKSUM_NAME = `${ASSET_NAME}.sha256`;

// --- shared scratch-root fixture --------------------------------------------------------------------
//
// Builds a self-contained scratch copy that can locate itself: cressetide/ (the real plugin tree, so
// tar-content assertions can compare against real shipped files) plus .github/scripts/publish-
// release.mjs and its publish-release-core.mjs import dependency at the SAME relative path as the
// real repo, so a spawned or dynamically-imported copy's own root-self-location logic (two
// directories up from its own file) resolves to the scratch root, not the real repo. package.json and
// the nested plugin.json are pinned to a FIXED test version/name (not the real repo's current
// version), so this suite does not rot when the real version changes. `dir`, when given, places the
// scratch root at a caller-chosen path (used by the symlink test so the real copy and its link share
// one parent temp dir, matching test/doctor-project.test.mjs's established single-cleanup pattern).
function releaseCliScratchRoot({ tag = false, dir } = {}) {
  const scratchRoot = dir || temporary("ctide-release-cli-");
  fs.mkdirSync(scratchRoot, { recursive: true });
  fs.cpSync(path.join(root, "cressetide"), path.join(scratchRoot, "cressetide"), { recursive: true });
  fs.writeFileSync(path.join(scratchRoot, "package.json"),
    JSON.stringify({ name: "ctide", private: true, version: TEST_VERSION }, null, 2), "utf8");
  const pluginJsonPath = path.join(scratchRoot, "cressetide", ".claude-plugin", "plugin.json");
  const pluginJson = JSON.parse(fs.readFileSync(pluginJsonPath, "utf8"));
  pluginJson.name = "ctide";
  pluginJson.version = TEST_VERSION;
  fs.writeFileSync(pluginJsonPath, JSON.stringify(pluginJson, null, 2), "utf8");
  fs.mkdirSync(path.join(scratchRoot, ".github", "scripts"), { recursive: true });
  fs.cpSync(path.join(root, ".github", "scripts", "publish-release.mjs"), path.join(scratchRoot, ".github", "scripts", "publish-release.mjs"));
  fs.cpSync(path.join(root, ".github", "scripts", "publish-release-core.mjs"), path.join(scratchRoot, ".github", "scripts", "publish-release-core.mjs"));
  cp.execFileSync("git", ["init"], { cwd: scratchRoot, stdio: "ignore" });
  cp.execFileSync("git", ["config", "user.name", "Test"], { cwd: scratchRoot });
  cp.execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: scratchRoot });
  hardenGitSigning(scratchRoot);
  cp.execFileSync("git", ["add", "-A"], { cwd: scratchRoot });
  cp.execFileSync("git", ["commit", "-m", "fixture"], { cwd: scratchRoot, stdio: "ignore" });
  if (tag) cp.execFileSync("git", ["tag", "-a", TEST_TAG, "-m", TEST_TAG], { cwd: scratchRoot });
  return scratchRoot;
}

function scratchScriptPath(scratchRoot) {
  return path.join(scratchRoot, ".github", "scripts", "publish-release.mjs");
}

// Dynamically imports the SCRATCH COPY of publish-release.mjs so its module-level `root` constant
// (computed from its own file location) resolves to the scratch root, not the real repo checkout --
// the same self-locating-root technique the CLI-spawn tests below rely on, used here in-process via
// import() instead of a spawned subprocess, so publish()'s hardcoded (non-parameterized) `root` can
// be exercised against an isolated fixture. This module instance is import()-cache-keyed by its
// unique scratch path, so it can never collide with another test's scratch copy or the real module.
async function importScratchModule(scratchRoot) {
  return import(pathToFileURL(scratchScriptPath(scratchRoot)).href);
}

function fakeBuilt(overrides = {}) {
  const checksum = crypto.createHash("sha256").update("fake asset bytes").digest("hex");
  return {
    version: TEST_VERSION, tag: TEST_TAG, assetName: ASSET_NAME, checksumName: CHECKSUM_NAME,
    checksum, assetPath: "/fake/asset/path.tar.gz", checksumPath: "/fake/checksum/path.sha256",
    ...overrides,
  };
}
function writeMatchingDownload(directory, built) {
  fs.writeFileSync(path.join(directory, built.assetName), "fake asset bytes", "utf8");
  fs.writeFileSync(path.join(directory, built.checksumName), `${built.checksum}  ${built.assetName}\n`, "utf8");
}
function writeMismatchedDownload(directory, built) {
  fs.writeFileSync(path.join(directory, built.assetName), "WRONG bytes", "utf8");
  fs.writeFileSync(path.join(directory, built.checksumName), `${built.checksum}  ${built.assetName}\n`, "utf8");
}

// === Part 1: createArchive() (the --archive CLI mode) -- real CLI-spawn, fully local/safe ===========
//
// --archive never touches gh -- it reads package.json + plugin.json, optionally a git tag, tars+
// gzips, and writes under <root>/_release/. Spawning it for real is safe by construction.

test("release CLI: `publish-release.mjs --archive` spawned as a real subprocess writes a tag-bound archive and checksum with expected tar contents", () => {
  const scratchRoot = releaseCliScratchRoot();
  try {
    const result = cp.spawnSync(process.execPath, [scratchScriptPath(scratchRoot), "--archive"], { cwd: scratchRoot, encoding: "utf8" });
    assert.strictEqual(result.status, 0, `spawned --archive must exit 0: ${result.stderr}`);
    assert.strictEqual(result.stderr, "", "a clean --archive run must print nothing to stderr");
    const parsed = JSON.parse(result.stdout);
    assert.strictEqual(parsed.version, TEST_VERSION);
    assert.strictEqual(parsed.tag, TEST_TAG);
    assert.strictEqual(parsed.assetName, ASSET_NAME);

    const assetPath = path.join(scratchRoot, "_release", ASSET_NAME);
    const checksumPath = path.join(scratchRoot, "_release", CHECKSUM_NAME);
    assert.ok(fs.existsSync(assetPath), "spawned --archive must write the release asset");
    assert.ok(fs.existsSync(checksumPath), "spawned --archive must write the release checksum");

    const checksumText = fs.readFileSync(checksumPath, "utf8");
    const actualHash = crypto.createHash("sha256").update(fs.readFileSync(assetPath)).digest("hex");
    assert.strictEqual(checksumText, `${actualHash}  ${ASSET_NAME}\n`, "checksum file must name the real asset and match its real bytes");

    const entries = parseTar(zlib.gunzipSync(fs.readFileSync(assetPath)));
    // Unlike publish-release-core.mjs's createDeterministicPluginArchive (which prefixes archive
    // paths with `ctide-${tag}/`), THIS file's listFiles()/createArchive() prefix every path with
    // the literal plugin directory name ("cressetide/"), not a tag-versioned root -- confirmed by
    // reading listFiles() directly, not assumed from the sibling implementation's layout.
    const hookEntry = entries.get("cressetide/hooks/plan-gate.js");
    assert.ok(hookEntry, "archive must contain the real hooks/plan-gate.js under the cressetide/ prefix");
    assert.strictEqual(hookEntry.type, "0");
    // This file's own tar writer (unlike publish-release-core.mjs's) hardcodes every file entry to
    // 0o644 and writes no directory entries at all -- confirmed by reading tarHeader()/createArchive()
    // directly, not assumed from the sibling implementation's shape.
    assert.strictEqual(hookEntry.mode, 0o644);
    assert.deepStrictEqual(hookEntry.body, fs.readFileSync(path.join(root, "cressetide", "hooks", "plan-gate.js")),
      "archived file bytes must match the real source file");
  } finally {
    fs.rmSync(scratchRoot, { recursive: true, force: true });
  }
});

test("release CLI: `publish-release.mjs --archive` invoked via a real symlinked/junctioned ancestor directory is still recognized as directly-invoked, running its full CLI body (isInvokedDirectly()'s fs.realpathSync check)", (t) => {
  const parentDir = temporary("ctide-release-cli-symlink-entrypoint-");
  try {
    const scratchRoot = releaseCliScratchRoot({ dir: path.join(parentDir, "scratch-root") });
    const linkedRoot = path.join(parentDir, "scratch-root-link");
    try {
      fs.symlinkSync(scratchRoot, linkedRoot, process.platform === "win32" ? "junction" : "dir");
    } catch (e) {
      return t.skip("cannot create a symlink/junction here: " + (e && e.code));
    }
    const scriptViaLink = path.join(linkedRoot, ".github", "scripts", "publish-release.mjs");
    const result = cp.spawnSync(process.execPath, [scriptViaLink, "--archive"], { encoding: "utf8" });
    assert.strictEqual(result.status, 0, `must recognize itself as directly-invoked through the symlink/junction and run its full CLI body, not silently no-op: ${result.stderr}`);
    assert.ok(result.stdout && result.stdout.trim().length > 0, "must produce real JSON output, not empty stdout (the false-negative symptom the isInvokedDirectly() fix closes)");
    const parsed = JSON.parse(result.stdout);
    assert.strictEqual(parsed.assetName, ASSET_NAME);
    assert.ok(fs.existsSync(path.join(scratchRoot, "_release", ASSET_NAME)),
      "spawning through the symlink must still write the release asset under the real (resolved) scratch root");
  } finally {
    fs.rmSync(parentDir, { recursive: true, force: true });
  }
});

// === Part 2a: pure functions -- no DI seam needed, none of these ever shell out =====================
//
// validateReleaseIdentity's own 4 branches (pass; tag/version mismatch; HEAD mismatch; dirty tree) are
// deliberately NOT re-tested here: test/release-doctor.test.mjs's "release identity rejects version,
// HEAD, and dirty-tree mismatches" already exercises all 4 with an equivalent throw-pattern assertion
// per branch (confirmed by direct comparison, not assumed) -- a genuine duplicate, trimmed.

test("release CLI: validatePublishedAssetInventory accepts an exact, non-duplicated asset+checksum pair", () => {
  const expected = { assetName: ASSET_NAME, checksumName: CHECKSUM_NAME };
  assert.strictEqual(validatePublishedAssetInventory([{ name: ASSET_NAME }, { name: CHECKSUM_NAME }], expected), true);
});
test("release CLI: validatePublishedAssetInventory rejects a missing asset", () => {
  const expected = { assetName: ASSET_NAME, checksumName: CHECKSUM_NAME };
  assert.throws(() => validatePublishedAssetInventory([{ name: CHECKSUM_NAME }], expected),
    new RegExp(`missing=${ASSET_NAME.replace(/[.]/g, "\\.")}`));
});
test("release CLI: validatePublishedAssetInventory rejects an extra/unexpected asset", () => {
  const expected = { assetName: ASSET_NAME, checksumName: CHECKSUM_NAME };
  assert.throws(() => validatePublishedAssetInventory([{ name: ASSET_NAME }, { name: CHECKSUM_NAME }, { name: "stray.txt" }], expected),
    /extra=stray\.txt/);
});
test("release CLI: validatePublishedAssetInventory rejects a duplicated asset name", () => {
  const expected = { assetName: ASSET_NAME, checksumName: CHECKSUM_NAME };
  assert.throws(() => validatePublishedAssetInventory([{ name: ASSET_NAME }, { name: ASSET_NAME }, { name: CHECKSUM_NAME }], expected),
    new RegExp(`duplicate=${ASSET_NAME.replace(/[.]/g, "\\.")}`));
});

test("release CLI: verifyDownloaded returns false when either downloaded file is missing", () => {
  const dir = temporary("ctide-release-cli-verifydl-");
  try {
    assert.strictEqual(verifyDownloaded(dir, fakeBuilt()), false);
    fs.writeFileSync(path.join(dir, ASSET_NAME), "x", "utf8");
    assert.strictEqual(verifyDownloaded(dir, fakeBuilt()), false, "asset alone without the checksum file must still be false");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("release CLI: verifyDownloaded returns true only when both sha256 bytes and the exact checksum line match", () => {
  const dir = temporary("ctide-release-cli-verifydl-");
  try {
    const built = fakeBuilt();
    writeMatchingDownload(dir, built);
    assert.strictEqual(verifyDownloaded(dir, built), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("release CLI: verifyDownloaded returns false when the checksum file names the wrong asset even though the sha256 matches", () => {
  const dir = temporary("ctide-release-cli-verifydl-");
  try {
    const built = fakeBuilt();
    fs.writeFileSync(path.join(dir, built.assetName), "fake asset bytes", "utf8");
    fs.writeFileSync(path.join(dir, built.checksumName), `${built.checksum}  WRONG-NAME.tar.gz\n`, "utf8");
    assert.strictEqual(verifyDownloaded(dir, built), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// === Part 2b: DI-capable functions -- unit tests with fresh fakes matching THIS file's own exact ====
// === function signatures (confirmed by reading each call site directly, not assumed) ================

test("release CLI: runReleaseCommand invokes the injected runner with gh, the given args, and the timeout (default and overridden)", () => {
  const calls = [];
  const runner = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return "ok"; };
  const result = runReleaseCommand("create", TEST_TAG, ["release", "create", TEST_TAG], { runner });
  assert.strictEqual(result, "ok");
  assert.strictEqual(calls[0].cmd, "gh");
  assert.deepStrictEqual(calls[0].args, ["release", "create", TEST_TAG]);
  // The literal default (publish-release.mjs's own RELEASE_COMMAND_TIMEOUT_MS, :23) -- not just
  // typeof "number" -- so a regression that silently changes the default is actually caught. This
  // default-timeout branch (no timeoutMs given) is never exercised by release-doctor.test.mjs, whose
  // sole runReleaseCommand test always supplies an explicit timeoutMs; confirmed by reading its one
  // call site directly, not assumed.
  assert.strictEqual(calls[0].opts.timeout, 30000);

  runReleaseCommand("view", TEST_TAG, ["release", "view", TEST_TAG], { runner, timeoutMs: 1234 });
  assert.strictEqual(calls[1].opts.timeout, 1234, "an injected timeoutMs must override the default");
});
// runReleaseCommand's thrown-error wrap+redact contract (action/tag context, stderr redaction) is
// deliberately NOT re-tested here beyond the case above: test/release-doctor.test.mjs's "release
// create and upload commands carry a bounded timeout with actionable context" already exercises the
// identical single catch-and-wrap branch with a strictly broader scenario (a secret embedded in BOTH
// the thrown error's own .message AND its .stderr, plus .code, plus a cause/util.inspect leak check) --
// confirmed by direct comparison, not assumed. A genuine duplicate, trimmed.

// inspectPublishedRelease's found/not-found/invalid-JSON branches are deliberately NOT re-tested here:
// test/release-doctor.test.mjs's "release inventory query requests gh assets JSON exactly" (found +
// exact args shape), and "release inventory helper never echoes malformed stdout and classifies raw
// failure context" (invalid-JSON -> transport-error/response; and a 404 -> not-found), already exercise
// those exact branches with an equivalent-or-stricter assertion -- confirmed by direct comparison, not
// assumed. Genuine duplicates, trimmed. The "other gh failures" branch below is KEPT: nowhere in
// release-doctor.test.mjs does any inspectPublishedRelease call assert `outcome === "transport-error"`
// for a real, non-404 gh-style failure (its one incidentally-similar scenario, the stderr-redaction
// test, never inspects `.outcome`/`.category` at all) -- confirmed by reading every inspectPublishedRelease
// call site in that file directly, not assumed.
test("release CLI: inspectPublishedRelease classifies other gh failures as transport-error", () => {
  const execute = () => ({ status: 1, stdout: "", stderr: "HTTP 500: Internal Server Error", error: undefined });
  assert.strictEqual(inspectPublishedRelease(TEST_TAG, { execute }).outcome, "transport-error");
});

// downloadPublished's `execute` is called as execute(command, argsArray, spawnOptions) -- a 3-argument
// shape, confirmed directly from its call site (`execute("gh", [...], {...})`), NOT the single-array
// shape inspectPublishedRelease uses -- the two DI seams in this file are not interchangeable.
test("release CLI: downloadPublished succeeds on the first attempt (3-argument execute shape)", () => {
  const calls = [];
  const execute = (cmd, args) => { calls.push([cmd, ...args]); return { status: 0, stdout: "", stderr: "", error: undefined }; };
  const result = downloadPublished(TEST_TAG, "/fake/dir", { execute, assetName: ASSET_NAME, checksumName: CHECKSUM_NAME, sleep: () => {} });
  assert.strictEqual(result.outcome, "downloaded");
  assert.strictEqual(result.attempts, 1);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0][0], "gh");
  assert.ok(calls[0].includes("release") && calls[0].includes("download"));
});
test("release CLI: downloadPublished retries a transient failure then succeeds, using the injected sleep instead of a real delay", () => {
  let call = 0;
  const sleepCalls = [];
  const execute = () => {
    call += 1;
    if (call < 2) return { status: 1, stdout: "", stderr: "HTTP 500: Internal Server Error", error: undefined };
    return { status: 0, stdout: "", stderr: "", error: undefined };
  };
  const result = downloadPublished(TEST_TAG, "/fake/dir", {
    execute, assetName: ASSET_NAME, checksumName: CHECKSUM_NAME, sleep: (ms) => sleepCalls.push(ms),
  });
  assert.strictEqual(result.outcome, "downloaded");
  assert.strictEqual(result.attempts, 2);
  assert.deepStrictEqual(sleepCalls, [250], "must sleep between attempts using the injected sleep, not a real Atomics.wait delay");
});
test("release CLI: downloadPublished fails closed as missing-assets on a non-transient not-found failure without exhausting retries", () => {
  let call = 0;
  const execute = () => { call += 1; return { status: 1, stdout: "", stderr: "HTTP 404: Not Found", error: undefined }; };
  const result = downloadPublished(TEST_TAG, "/fake/dir", { execute, assetName: ASSET_NAME, checksumName: CHECKSUM_NAME, sleep: () => {} });
  assert.strictEqual(result.outcome, "missing-assets");
  assert.strictEqual(call, 1, "a non-transient failure must not be retried");
});
// downloadPublished's "exhausts retries -> transport-error" branch is deliberately NOT re-tested here:
// test/release-doctor.test.mjs's "published download retries transient failures with a bound and
// retains every stderr" already exercises the identical persistent-transient-failure/exhausted-retries
// branch (outcome transport-error, attempts === maxAttempts), with a strictly broader assertion (also
// pins the accumulated per-attempt stderr) -- confirmed by direct comparison, not assumed. A genuine
// duplicate, trimmed. The other 4 downloadPublished tests below are KEPT: none of their specific
// asserted properties -- the exact gh/release/download args shape and single-attempt success (test 1),
// the literal sleep(250) backoff value passed to the injected sleep on a retry (test 2), the distinct
// "missing-assets" outcome string a non-transient not-found failure produces without retrying (test 3),
// and the missing-name input guard (test 5, already independently called out by the review panel) --
// are asserted anywhere in release-doctor.test.mjs for ANY input, for any downloadPublished scenario;
// confirmed by reading every downloadPublished call site in that file directly, not assumed.
test("release CLI: downloadPublished requires exact asset and checksum names", () => {
  assert.throws(() => downloadPublished(TEST_TAG, "/fake/dir", { execute: () => ({}) }), /requires exact asset and checksum names/);
});

// verifyOrRepairPublished coverage below was independently re-verified against release-doctor.test.mjs,
// test by test, NOT trimmed wholesale on the review panel's claim -- 3 of its 7 originally-claimed
// duplicates are kept:
// - KEPT below: this not-found-inspection test uses explicit "must not be reached" throw-fakes for
//   BOTH download and runner. Its closest release-doctor.test.mjs counterpart ("release inspection
//   failure redacts the exported helper error") supplies neither -- it relies solely on inspectExisting's
//   early throw to make them unreachable. If that guarantee ever regressed, THIS test fails cleanly via
//   its throw-fake's own message; the doctor test would instead fall through to the REAL default
//   download/runner (a genuine gh subprocess call), whose failure is environment-dependent, not
//   guaranteed. A real, non-pedantic difference in regression-detection reliability, not just duplicate
//   assertion syntax -- confirmed by reading the doctor test's options object directly, not assumed.
test("release CLI: verifyOrRepairPublished fails closed when the injected inspect reports the release itself is not found", () => {
  const built = fakeBuilt();
  assert.throws(() => verifyOrRepairPublished(TEST_TAG, built, {
    inspect: () => ({ outcome: "not-found" }),
    download: () => { throw new Error("must not be reached: inspection never succeeded"); },
    runner: () => { throw new Error("must not be reached: inspection never succeeded"); },
  }), /Unable to inspect existing release/);
});
// REMOVED (confirmed duplicate): the asset-inventory-mismatch test that sat here. Unlike the not-found
// test above, release-doctor.test.mjs's "checksum-only published inventory is rejected without clobber
// repair" already supplies an EQUALLY explicit throw-fake for download and an equally explicit
// counting-fake + empty-array assertion for runner, on the same inspectExisting-throws-first branch --
// a genuine duplicate, not just a different triggering scenario (checksum-only vs wrong-name asset;
// verifyOrRepairPublished doesn't care why validatePublishedAssetInventory threw, only that it did).
//
// The next two tests (matching-assets/no-repair, and mismatch-without-repair-flag) are KEPT for the
// same reliability reason as the not-found test above: their release-doctor.test.mjs counterparts
// (parts of "published asset policy verifies, refuses drift, repairs explicitly, and rechecks") supply
// NO runner option at all for these two scenarios -- not even a bare no-op -- so a regression that
// accidentally invoked the runner here would fall through to the REAL default runner in doctor's
// version, but is caught deterministically here via an explicit counting fake and an exact
// runnerCalls.length assertion. Confirmed by reading that test's exact options objects directly, not
// assumed.
test("release CLI: verifyOrRepairPublished verifies matching assets without any repair-upload call", () => {
  const built = fakeBuilt();
  const runnerCalls = [];
  const result = verifyOrRepairPublished(TEST_TAG, built, {
    inspect: () => ({ outcome: "found", assets: [{ name: built.assetName }, { name: built.checksumName }] }),
    download: (tag, directory) => { writeMatchingDownload(directory, built); return { outcome: "downloaded", attempts: 1 }; },
    runner: (cmd, args) => { runnerCalls.push([cmd, ...args]); return ""; },
  });
  assert.strictEqual(result.action, "verified-existing-release");
  assert.strictEqual(runnerCalls.length, 0, "matching assets must never call the runner (no repair-upload)");
});
test("release CLI: verifyOrRepairPublished fails closed on a byte mismatch without an explicit repair flag", () => {
  const built = fakeBuilt();
  const runnerCalls = [];
  assert.throws(() => verifyOrRepairPublished(TEST_TAG, built, {
    inspect: () => ({ outcome: "found", assets: [{ name: built.assetName }, { name: built.checksumName }] }),
    download: (tag, directory) => { writeMismatchedDownload(directory, built); return { outcome: "downloaded", attempts: 1 }; },
    runner: (cmd, args) => { runnerCalls.push([cmd, ...args]); return ""; },
    repairEnabled: false,
  }), /explicit repair authorization is required/);
  assert.strictEqual(runnerCalls.length, 0, "a byte mismatch without the repair flag must never call the runner");
});
// KEPT: the review panel's "duplicate" claim was imprecise for this one test specifically -- its
// release-doctor.test.mjs counterpart (part of "published asset policy verifies, refuses drift, repairs
// explicitly, and rechecks") asserts the repair-upload command's first 3 args (gh/release/upload/tag)
// but never asserts "--clobber" is present anywhere in the full args array; confirmed by reading that
// assertion directly, not assumed. This test's own uploadCall.includes("--clobber") check is therefore
// genuinely unique. Gap-closing fix applied (test-reviewer finding): `inspect` was a bare, non-counting
// closure that never proved the real re-verification step (publish-release.mjs:431,
// `inspectExisting(tag, inspect, built)`, called right after the repair-upload) actually re-inspects
// rather than trusting stale pre-repair data -- now a call-counting fake, asserted called exactly twice.
test("release CLI: verifyOrRepairPublished repairs a byte mismatch only with an explicit repair flag, re-verifying after upload", () => {
  const built = fakeBuilt();
  const runnerCalls = [];
  const inspectCalls = [];
  let downloadCall = 0;
  const result = verifyOrRepairPublished(TEST_TAG, built, {
    inspect: (t) => {
      inspectCalls.push(t);
      return { outcome: "found", assets: [{ name: built.assetName }, { name: built.checksumName }] };
    },
    download: (tag, directory) => {
      downloadCall += 1;
      if (downloadCall === 1) writeMismatchedDownload(directory, built);
      else writeMatchingDownload(directory, built);
      return { outcome: "downloaded", attempts: 1 };
    },
    runner: (cmd, args) => { runnerCalls.push([cmd, ...args]); return ""; },
    repairEnabled: true,
  });
  assert.strictEqual(result.action, "repaired-existing-release");
  assert.strictEqual(downloadCall, 2, "must re-download after repair to confirm the fix");
  assert.strictEqual(inspectCalls.length, 2,
    "must re-inspect (inspectExisting) a SECOND time right after the repair-upload, not trust stale pre-repair inventory data");
  const uploadCall = runnerCalls.find((c) => c[0] === "gh" && c.includes("upload"));
  assert.ok(uploadCall, `mismatch repair must call the runner with a gh release upload: ${JSON.stringify(runnerCalls)}`);
  assert.ok(uploadCall.includes("--clobber"));
});
// REMOVED (confirmed duplicates): "throws if assets still differ after an attempted repair" and "fails
// closed on a download failure regardless of the repair flag" both sat here. Both are single
// assert.throws() calls with no assertion release-doctor.test.mjs's equivalents lack: the former is
// identical in structure and pattern to "published asset policy verifies..."'s 4th part (same
// always-mismatched-download + bare no-op runner + /still differ after repair/ throw, no unique
// assertion in either); the latter's release-doctor.test.mjs counterpart ("transport failure preserves
// stderr and never enters clobber repair") already uses an equally explicit runner counting-fake +
// empty-array assertion (unlike the not-found/matching-assets tests above, whose doctor counterparts
// lack any runner fake at all) -- the differing literal outcome/category strings fed via the `download`
// fake ("missing-assets"/"not-found" vs "transport-error"/"network") don't reach a different branch of
// verifyOrRepairPublished itself (assertDownloadSucceeded only checks `outcome === "downloaded"`, an
// unconditional gate); that specific outcome-string distinction is independently, separately covered
// where it actually matters -- downloadPublished's OWN direct tests, kept above. Confirmed by reading
// both doctor counterparts' exact options objects directly, not assumed.

// === Part 2c: functions with no DI seam -- git-dependent, exercised against a real local scratch =====
// === git repo (safe, no network; reuses the Part 1 scratch-root helper) =============================

test("release CLI: releaseIdentityFromTag reads package/plugin identity from the tagged tree, not the dirtied working tree", () => {
  const scratchRoot = releaseCliScratchRoot({ tag: true });
  try {
    fs.writeFileSync(path.join(scratchRoot, "package.json"), JSON.stringify({ name: "ctide", version: "0.0.1" }), "utf8");
    const identity = releaseIdentityFromTag(scratchRoot, TEST_TAG);
    assert.strictEqual(identity.version, TEST_VERSION, "must read the tagged version, not the dirtied working-tree version");
    assert.strictEqual(identity.assetName, ASSET_NAME);
    assert.strictEqual(identity.checksumName, CHECKSUM_NAME);
  } finally {
    fs.rmSync(scratchRoot, { recursive: true, force: true });
  }
});
test("release CLI: releaseIdentityFromTag rejects a tag whose tagged version parity fails", () => {
  // A minimal, dedicated fixture (not releaseCliScratchRoot(), which always keeps the two versions in
  // parity): the tag itself must genuinely exist (an absent tag fails earlier, at git rev-parse, with
  // an unrelated "Needed a single revision" error -- not the parity check this test targets), but its
  // tagged root package.json and nested plugin.json carry deliberately MISMATCHED versions.
  const scratchRoot = temporary("ctide-release-cli-parity-");
  try {
    fs.mkdirSync(path.join(scratchRoot, "cressetide", ".claude-plugin"), { recursive: true });
    fs.writeFileSync(path.join(scratchRoot, "package.json"), JSON.stringify({ name: "ctide", version: TEST_VERSION }), "utf8");
    fs.writeFileSync(path.join(scratchRoot, "cressetide", ".claude-plugin", "plugin.json"), JSON.stringify({ name: "ctide", version: "1.0.0" }), "utf8");
    cp.execFileSync("git", ["init"], { cwd: scratchRoot, stdio: "ignore" });
    cp.execFileSync("git", ["config", "user.name", "Test"], { cwd: scratchRoot });
    cp.execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: scratchRoot });
    hardenGitSigning(scratchRoot);
    cp.execFileSync("git", ["add", "-A"], { cwd: scratchRoot });
    cp.execFileSync("git", ["commit", "-m", "mismatched versions"], { cwd: scratchRoot, stdio: "ignore" });
    cp.execFileSync("git", ["tag", "-a", TEST_TAG, "-m", TEST_TAG], { cwd: scratchRoot });
    assert.throws(() => releaseIdentityFromTag(scratchRoot, TEST_TAG), /version parity failed/);
  } finally {
    fs.rmSync(scratchRoot, { recursive: true, force: true });
  }
});

test("release CLI: entriesFromTag reads file contents from the tagged tree, not the working tree", () => {
  const scratchRoot = releaseCliScratchRoot({ tag: true });
  try {
    fs.writeFileSync(path.join(scratchRoot, "cressetide", "hooks", "plan-gate.js"), "// dirtied after tagging\n", "utf8");
    const entries = entriesFromTag(scratchRoot, TEST_TAG);
    const hookEntry = entries.find((e) => e.archivePath === "cressetide/hooks/plan-gate.js");
    assert.ok(hookEntry, "entriesFromTag must include the real hooks/plan-gate.js");
    const realBytes = fs.readFileSync(path.join(root, "cressetide", "hooks", "plan-gate.js"));
    assert.deepStrictEqual(hookEntry.content, realBytes, "must read the tagged blob, not the post-tag working-tree edit");
  } finally {
    fs.rmSync(scratchRoot, { recursive: true, force: true });
  }
});
test("release CLI: entriesFromTag rejects a tag with no plugin files under the prefix", () => {
  const scratchRoot = temporary("ctide-release-cli-no-plugin-");
  try {
    fs.writeFileSync(path.join(scratchRoot, "README.md"), "placeholder\n", "utf8");
    cp.execFileSync("git", ["init"], { cwd: scratchRoot, stdio: "ignore" });
    cp.execFileSync("git", ["config", "user.name", "Test"], { cwd: scratchRoot });
    cp.execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: scratchRoot });
    hardenGitSigning(scratchRoot);
    cp.execFileSync("git", ["add", "-A"], { cwd: scratchRoot });
    cp.execFileSync("git", ["commit", "-m", "no plugin"], { cwd: scratchRoot, stdio: "ignore" });
    cp.execFileSync("git", ["tag", "-a", TEST_TAG, "-m", TEST_TAG], { cwd: scratchRoot });
    assert.throws(() => entriesFromTag(scratchRoot, TEST_TAG), /contains no plugin files under cressetide/);
  } finally {
    fs.rmSync(scratchRoot, { recursive: true, force: true });
  }
});

test("release CLI: validateTaggedReleaseState passes at a clean tagged HEAD and fails once tracked release inputs are dirtied", () => {
  const scratchRoot = releaseCliScratchRoot({ tag: true });
  try {
    const identity = releaseIdentityFromTag(scratchRoot, TEST_TAG);
    assert.strictEqual(validateTaggedReleaseState(scratchRoot, identity), true);
    fs.writeFileSync(path.join(scratchRoot, "cressetide", ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "ctide", version: TEST_VERSION, dirty: true }), "utf8");
    assert.throws(() => validateTaggedReleaseState(scratchRoot, identity), /Tracked release inputs differ/);
  } finally {
    fs.rmSync(scratchRoot, { recursive: true, force: true });
  }
});
test("release CLI: validateTaggedReleaseState rejects a tag that does not point at current HEAD", () => {
  const scratchRoot = releaseCliScratchRoot({ tag: true });
  try {
    const identity = releaseIdentityFromTag(scratchRoot, TEST_TAG);
    fs.writeFileSync(path.join(scratchRoot, "README.md"), "advance HEAD past the tag\n", "utf8");
    cp.execFileSync("git", ["add", "-A"], { cwd: scratchRoot });
    cp.execFileSync("git", ["commit", "-m", "advance"], { cwd: scratchRoot, stdio: "ignore" });
    assert.throws(() => validateTaggedReleaseState(scratchRoot, identity), /must already exist at current HEAD/);
  } finally {
    fs.rmSync(scratchRoot, { recursive: true, force: true });
  }
});

// === Part 3: publish()'s guard clause and all three top-level outcomes, end-to-end, with fully-faked ==
// === options ==========================================================================================
//
// publish() is not parameterized by repositoryRoot -- it always operates against its OWN module's
// `root` constant. The scratch-importing tests below dynamically import a scratch copy of
// publish-release.mjs (via importScratchModule(), which reuses releaseCliScratchRoot()'s script-pair
// copy) so `root` resolves to the isolated scratch repo, never the real checkout's git tags or
// _release/ directory.

// Gap-closing addition (test-reviewer finding): publish()'s first guard
// (`if (!tag) throw new Error("Publishing requires --tag vX.Y.Z");`, publish-release.mjs:450) had zero
// test coverage despite publish being newly exported specifically for testability. No scratch root or
// fakes needed: the guard is the function's very first statement, throwing before `root` (the real
// repo checkout) or any gh-touching code is ever reached -- confirmed by reading publish()'s body
// directly, so calling the already-imported, non-scratch `publish` is provably safe here.
test("release CLI: publish() rejects a missing tag before touching root-dependent state or any gh-touching code", () => {
  assert.throws(() => publish(undefined, {}), /Publishing requires --tag/);
});

// Gap-closing addition (test-reviewer finding): publish()'s third top-level branch
// (publish-release.mjs:456-458), reached when the initial gh existence check returns neither "found"
// nor "not-found" (a transport-error), had no test at the publish() level. Uses the scratch-import
// pattern (needs `root`-dependent state: releaseIdentityFromTag/validateTaggedReleaseState/createArchive
// all run before this branch is reached). runner/download are given "must not be reached" throw-fakes
// as defense-in-depth, matching this file's own established convention -- confirmed by reading publish()
// directly that neither runReleaseCommand nor verifyOrRepairPublished (which alone would use them) is
// ever called on this branch.
test("release CLI: publish() throws when gh's initial inspection returns neither found nor not-found, never reaching the runner/download fakes", async () => {
  const scratchRoot = releaseCliScratchRoot({ tag: true });
  try {
    const mod = await importScratchModule(scratchRoot);
    const executeCalls = [];
    const options = {
      execute: (args) => {
        executeCalls.push(args);
        return { status: 1, stdout: "", stderr: "HTTP 500: Internal Server Error", error: undefined };
      },
      runner: () => { throw new Error("must not be reached: initial inspection returned a transport-error, not found/not-found"); },
      download: () => { throw new Error("must not be reached: initial inspection returned a transport-error, not found/not-found"); },
    };
    assert.throws(() => mod.publish(TEST_TAG, options), /Unable to inspect release/);
    assert.strictEqual(executeCalls.length, 1, "publish() must check for an existing release exactly once via the injected execute fake before throwing");
  } finally {
    fs.rmSync(scratchRoot, { recursive: true, force: true });
  }
});

test("release CLI: publish() creates a release when gh reports not-found, using fully-faked options -- zero real gh calls", async () => {
  const scratchRoot = releaseCliScratchRoot({ tag: true });
  try {
    const mod = await importScratchModule(scratchRoot);
    const executeCalls = [];
    const runnerCalls = [];
    const inspectCalls = [];
    const downloadCalls = [];
    const options = {
      // Used directly by inspectPublishedRelease(tag, options) -- publish()'s FIRST existence check.
      execute: (args) => {
        executeCalls.push(args);
        return { status: 1, stdout: "", stderr: "HTTP 404: Not Found", error: undefined };
      },
      // Used by runReleaseCommand's "create" call AND by verifyOrRepairPublished's own runner
      // fallback (only reached if a repair-upload is needed, which this happy path never needs).
      runner: (cmd, args) => {
        runnerCalls.push([cmd, ...args]);
        return "";
      },
      // Used by verifyOrRepairPublished's inspectExisting -- a DIFFERENT seam than `execute` above.
      // verifyOrRepairPublished never calls inspectPublishedRelease itself unless options.inspect is
      // omitted, in which case it falls back to the bare inspectPublishedRelease reference called with
      // NO options -- which would reach the real executeGh. Confirmed by reading verifyOrRepairPublished
      // directly; this seam must be supplied explicitly, never assumed to inherit from `execute`.
      inspect: (t) => {
        inspectCalls.push(t);
        return { outcome: "found", assets: [{ name: ASSET_NAME }, { name: CHECKSUM_NAME }] };
      },
      // Used by verifyOrRepairPublished's download step. Copies the REAL just-built archive bytes
      // (built.assetPath/checksumPath, produced by the real, local, non-gh-related createArchive())
      // into the requested directory -- simulating a successful "gh release download" of exactly what
      // was just (fake-)created, with zero real subprocess calls.
      download: (t, directory, built) => {
        downloadCalls.push(t);
        fs.copyFileSync(built.assetPath, path.join(directory, built.assetName));
        fs.copyFileSync(built.checksumPath, path.join(directory, built.checksumName));
        return { outcome: "downloaded", attempts: 1 };
      },
    };
    const result = mod.publish(TEST_TAG, options);
    assert.strictEqual(result.action, "verified-existing-release");
    assert.strictEqual(executeCalls.length, 1, "publish() must check for an existing release exactly once via the injected execute fake");
    assert.deepStrictEqual(executeCalls[0], ["release", "view", TEST_TAG, "--json", "assets"]);
    assert.strictEqual(inspectCalls.length, 1, "verifyOrRepairPublished must re-inspect via the injected inspect fake");
    assert.strictEqual(downloadCalls.length, 1);
    const createCall = runnerCalls.find((c) => c[0] === "gh" && c[1] === "release" && c[2] === "create");
    assert.ok(createCall, `not-found must create a release via the injected runner fake: ${JSON.stringify(runnerCalls)}`);
    assert.ok(createCall.includes("--verify-tag"));
    assert.ok(!runnerCalls.some((c) => c.includes("upload")), "a fresh create + matching verify must never attempt an asset-repair upload");
  } finally {
    fs.rmSync(scratchRoot, { recursive: true, force: true });
  }
});

test("release CLI: publish() verifies an existing matching release without uploading, using fully-faked options -- zero real gh calls", async () => {
  const scratchRoot = releaseCliScratchRoot({ tag: true });
  try {
    const mod = await importScratchModule(scratchRoot);
    const executeCalls = [];
    const runnerCalls = [];
    const options = {
      execute: (args) => {
        executeCalls.push(args);
        return { status: 0, stdout: JSON.stringify({ assets: [{ name: ASSET_NAME }, { name: CHECKSUM_NAME }] }), stderr: "", error: undefined };
      },
      runner: (cmd, args) => {
        runnerCalls.push([cmd, ...args]);
        return "";
      },
      inspect: () => ({ outcome: "found", assets: [{ name: ASSET_NAME }, { name: CHECKSUM_NAME }] }),
      download: (t, directory, built) => {
        fs.copyFileSync(built.assetPath, path.join(directory, built.assetName));
        fs.copyFileSync(built.checksumPath, path.join(directory, built.checksumName));
        return { outcome: "downloaded", attempts: 1 };
      },
    };
    const result = mod.publish(TEST_TAG, options);
    assert.strictEqual(result.action, "verified-existing-release");
    assert.strictEqual(executeCalls.length, 1);
    assert.strictEqual(runnerCalls.length, 0, "found+matching must never call the runner fake -- no create, no upload");
  } finally {
    fs.rmSync(scratchRoot, { recursive: true, force: true });
  }
});
