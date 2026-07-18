// Behavioral tests for the release publisher (.github/scripts/publish-release.mjs): deterministic
// tag-bound archive bytes and the publish / verify / repair / draft / create release paths.
// Release-publisher tests split from the hook behavior suite.
import { test } from "node:test";
import assert from "node:assert";
import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import {
  createDeterministicPluginArchive,
  defaultBytesRunner,
  defaultRunner,
  normalizeGzipOsByte,
  runRelease,
} from "../.github/scripts/publish-release.mjs";
import { fakeArchiveWriter, makeReleaseRoot, makeReleaseRunner, parseTar, root, sha256File } from "./support.mjs";
function makeCommittedArchiveRoot() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-release-root-"));
  fs.cpSync(path.join(root, "cressetide"), path.join(repo, "cressetide"), { recursive: true });
  cp.execFileSync("git", ["init"], { cwd: repo, stdio: "ignore" });
  cp.execFileSync("git", ["config", "user.name", "Test"], { cwd: repo });
  cp.execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: repo });
  cp.execFileSync("git", ["add", "cressetide"], { cwd: repo });
  cp.execFileSync("git", ["commit", "-m", "fixture"], { cwd: repo, stdio: "ignore" });
  return repo;
}

test("release publisher: deterministic archive bytes are stable for the same tag tree", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-release-archive-"));
  const repo = makeCommittedArchiveRoot();
  try {
    const a = path.join(dir, "a.tar.gz");
    const b = path.join(dir, "b.tar.gz");
    createDeterministicPluginArchive({ tag: "HEAD", cwd: repo, assetPath: a });
    createDeterministicPluginArchive({ tag: "HEAD", cwd: repo, assetPath: b });
    assert.strictEqual(sha256File(a), sha256File(b), "same tag tree must produce identical gzip bytes");
    assert.deepStrictEqual(zlib.gunzipSync(fs.readFileSync(a)), zlib.gunzipSync(fs.readFileSync(b)),
      "same tag tree must produce identical decompressed tar bytes");
    assert.strictEqual(fs.readFileSync(a)[9], 0xff, "gzip OS byte (RFC 1952 offset 9) must not depend on the build platform");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(repo, { recursive: true, force: true }); }
});

test("release publisher: normalizeGzipOsByte patches a plain gzip header's OS byte in place", () => {
  const real = zlib.gzipSync(Buffer.from("ctide"), { level: 9, mtime: 0 });
  const patched = normalizeGzipOsByte(real);
  assert.strictEqual(patched, real, "must patch the given buffer in place, not return a detached copy");
  assert.strictEqual(patched[9], 0xff, "must set RFC 1952 offset 9 to the unknown-OS sentinel");
  assert.deepStrictEqual(zlib.gunzipSync(patched), Buffer.from("ctide"), "patching the OS byte must not disturb the compressed payload");
});

test("release publisher: normalizeGzipOsByte refuses to patch a non-plain gzip header instead of silently skipping it", () => {
  assert.throws(() => normalizeGzipOsByte(Buffer.alloc(0)), /Unsupported gzip header shape/, "empty buffer must be rejected, not treated as a no-op");
  assert.throws(() => normalizeGzipOsByte(Buffer.from([0x1f, 0x8b, 0x08])), /Unsupported gzip header shape/, "a header shorter than 10 bytes must be rejected");
  assert.throws(
    () => normalizeGzipOsByte(Buffer.from([0x1f, 0x8b, 0x08, 0x08, 0, 0, 0, 0, 0, 0])),
    /Unsupported gzip header shape/,
    "a set FLG byte (e.g. FNAME) is outside gzipSync()'s own canonical output shape and must be rejected, not silently mis-patched",
  );
  assert.throws(
    () => normalizeGzipOsByte(Buffer.from([0x00, 0x00, 0x08, 0x00, 0, 0, 0, 0, 0, 0])),
    /Unsupported gzip header shape/,
    "a wrong gzip magic must be rejected",
  );
});

test("release publisher: deterministic archive contains expected paths, modes, and bytes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-release-archive-"));
  const repo = makeCommittedArchiveRoot();
  try {
    const archive = path.join(dir, "semantic.tar.gz");
    createDeterministicPluginArchive({ tag: "HEAD", cwd: repo, assetPath: archive });
    const entries = parseTar(zlib.gunzipSync(fs.readFileSync(archive)));
    assert.strictEqual(entries.get("ctide-HEAD/").type, "5", "archive must include the root directory");
    assert.strictEqual(entries.get("ctide-HEAD/hooks/").mode, 0o755, "hook directory mode must be stable");
    const hook = entries.get("ctide-HEAD/hooks/plan-gate.js");
    assert.ok(hook, "archive must include hook files under the shipped plugin root");
    assert.strictEqual(hook.type, "0");
    assert.strictEqual(hook.mode, 0o644);
    const expected = cp.execFileSync("git", ["cat-file", "blob", "HEAD:cressetide/hooks/plan-gate.js"], { cwd: repo });
    assert.deepStrictEqual(hook.body, expected, "archive file bytes must come from the tag-bound ctide tree");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(repo, { recursive: true, force: true }); }
});

test("release publisher: archive reads the tag tree even when the working tree is dirty", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-release-git-"));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-release-archive-"));
  try {
    fs.mkdirSync(path.join(repo, "cressetide", ".claude-plugin"), { recursive: true });
    fs.writeFileSync(path.join(repo, "cressetide", ".claude-plugin", "plugin.json"), '{"version":"tagged"}\n', "utf8");
    cp.execFileSync("git", ["init"], { cwd: repo, stdio: "ignore" });
    cp.execFileSync("git", ["config", "user.name", "Test"], { cwd: repo });
    cp.execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: repo });
    cp.execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: repo });
    cp.execFileSync("git", ["config", "tag.gpgSign", "false"], { cwd: repo });
    cp.execFileSync("git", ["add", "cressetide/.claude-plugin/plugin.json"], { cwd: repo });
    cp.execFileSync("git", ["commit", "-m", "tagged"], { cwd: repo, stdio: "ignore" });
    cp.execFileSync("git", ["tag", "-a", "v1.2.3", "-m", "v1.2.3"], { cwd: repo });
    fs.writeFileSync(path.join(repo, "cressetide", ".claude-plugin", "plugin.json"), '{"version":"dirty"}\n', "utf8");
    const archive = path.join(out, "dirty.tar.gz");
    createDeterministicPluginArchive({ tag: "v1.2.3", cwd: repo, assetPath: archive });
    const entries = parseTar(zlib.gunzipSync(fs.readFileSync(archive)));
    assert.strictEqual(entries.get("ctide-v1.2.3/.claude-plugin/plugin.json").body.toString("utf8"), '{"version":"tagged"}\n',
      "archive must read the tagged tree, not the dirty working tree");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test("release publisher: default runners include subprocess stderr in thrown errors", () => {
  assert.throws(
    () => defaultRunner(process.execPath, ["-e", "console.error('stderr detail'); process.exit(7)"]),
    /stderr detail/,
    "text runner errors must retain stderr for release diagnosis");
  assert.throws(
    () => defaultBytesRunner(process.execPath, ["-e", "process.stderr.write('binary stderr'); process.exit(8)"]),
    /binary stderr/,
    "byte runner errors must retain stderr for release diagnosis");
  assert.throws(
    () => defaultRunner("definitely-not-a-real-command-ctide", []),
    /ENOENT|not found|cannot find/i,
    "runner spawn failures must retain the launch error");
});

test("release publisher: published release verifies matching assets without clobber", () => {
  const tree = makeReleaseRoot();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-release-tmp-"));
  try {
    const { runner, calls } = makeReleaseRunner({ state: "false" });
    const result = runRelease({ root: tree, tmpDir: tmp, runner, archiveWriter: fakeArchiveWriter, log: () => {} });
    assert.strictEqual(result.action, "verified-published-assets");
    assert.ok(calls.some((c) => c.join(" ").includes("gh release download v1.2.3")), "published release path must verify remote assets");
    assert.ok(!calls.some((c) => c.join(" ").includes("gh release upload v1.2.3")), "published release path must not clobber matching assets");
    assert.ok(!calls.some((c) => c.join(" ").includes("gh release create")), "published repair must not create a release");
  } finally {
    fs.rmSync(tree, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("release publisher: published release rejects checksum files naming the wrong asset", () => {
  const tree = makeReleaseRoot();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-release-tmp-"));
  try {
    const { runner, calls } = makeReleaseRunner({ state: "false", remoteChecksumName: "WRONG-NAME.tar.gz" });
    assert.throws(() => runRelease({ root: tree, tmpDir: tmp, runner, archiveWriter: fakeArchiveWriter, log: () => {} }),
      /checksum names 'WRONG-NAME\.tar\.gz'/);
    assert.ok(!calls.some((c) => c.join(" ").includes("gh release upload")), "wrong checksum filename must not upload without repair flag");
  } finally {
    fs.rmSync(tree, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("release publisher: published release repairs checksum files naming the wrong asset only with repair flag", () => {
  const tree = makeReleaseRoot();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-release-tmp-"));
  try {
    const { runner, calls } = makeReleaseRunner({ state: "false", remoteChecksumName: "WRONG-NAME.tar.gz" });
    const result = runRelease({
      root: tree,
      tmpDir: tmp,
      runner,
      archiveWriter: fakeArchiveWriter,
      env: { CTIDE_REPAIR_PUBLISHED_RELEASE_ASSETS: "true" },
      log: () => {},
    });
    assert.strictEqual(result.action, "repaired-published-assets");
    assert.ok(calls.some((c) => c.join(" ").includes("gh release upload v1.2.3") && c.includes("--clobber")),
      "explicit repair must upload corrected archive and checksum");
  } finally {
    fs.rmSync(tree, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("release publisher: published release rejects malformed multiline checksum files", () => {
  const tree = makeReleaseRoot();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-release-tmp-"));
  try {
    const { runner, calls } = makeReleaseRunner({
      state: "false",
      remoteChecksumText: (hash, assetName) => `${hash}  ${assetName}\n${hash}  ${assetName}\n`,
    });
    assert.throws(() => runRelease({ root: tree, tmpDir: tmp, runner, archiveWriter: fakeArchiveWriter, log: () => {} }),
      /expected exactly one SHA-256 checksum line/);
    assert.ok(!calls.some((c) => c.join(" ").includes("gh release upload")), "malformed checksum must not upload without repair flag");
  } finally {
    fs.rmSync(tree, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("release publisher: published release repairs malformed checksum files only with repair flag", () => {
  const tree = makeReleaseRoot();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-release-tmp-"));
  try {
    const { runner, calls } = makeReleaseRunner({
      state: "false",
      remoteChecksumText: (hash, assetName) => `${hash}  ${assetName}\n${hash}  ${assetName}\n`,
    });
    const result = runRelease({
      root: tree,
      tmpDir: tmp,
      runner,
      archiveWriter: fakeArchiveWriter,
      env: { CTIDE_REPAIR_PUBLISHED_RELEASE_ASSETS: "true" },
      log: () => {},
    });
    assert.strictEqual(result.action, "repaired-published-assets");
    assert.ok(calls.some((c) => c.join(" ").includes("gh release upload v1.2.3") && c.includes("--clobber")),
      "explicit repair must upload corrected archive and checksum");
  } finally {
    fs.rmSync(tree, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("release publisher: published release mismatch fails closed without repair flag", () => {
  const tree = makeReleaseRoot();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-release-tmp-"));
  try {
    const { runner, calls } = makeReleaseRunner({ state: "false", remoteAssetContent: "old asset" });
    assert.throws(() => runRelease({ root: tree, tmpDir: tmp, runner, archiveWriter: fakeArchiveWriter, log: () => {} }),
      /Refusing to clobber published assets/);
    assert.ok(!calls.some((c) => c.join(" ").includes("gh release upload")), "published mismatch must not upload without repair flag");
  } finally {
    fs.rmSync(tree, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("release publisher: published release missing assets fail closed without repair flag", () => {
  const tree = makeReleaseRoot();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-release-tmp-"));
  try {
    const { runner, calls } = makeReleaseRunner({ state: "false", downloadFailures: ["ctide-v1.2.3-plugin.tar.gz"] });
    assert.throws(() => runRelease({ root: tree, tmpDir: tmp, runner, archiveWriter: fakeArchiveWriter, log: () => {} }),
      /missing ctide-v1\.2\.3-plugin\.tar\.gz or ctide-v1\.2\.3-plugin\.tar\.gz\.sha256/);
    assert.ok(!calls.some((c) => c.join(" ").includes("gh release upload")), "missing published assets must not upload without repair flag");
  } finally {
    fs.rmSync(tree, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("release publisher: published release missing assets repair only with explicit flag", () => {
  const tree = makeReleaseRoot();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-release-tmp-"));
  try {
    const { runner, calls } = makeReleaseRunner({ state: "false", downloadFailures: ["ctide-v1.2.3-plugin.tar.gz"] });
    const result = runRelease({
      root: tree,
      tmpDir: tmp,
      runner,
      archiveWriter: fakeArchiveWriter,
      env: { CTIDE_REPAIR_PUBLISHED_RELEASE_ASSETS: "true" },
      log: () => {},
    });
    assert.strictEqual(result.action, "repaired-published-assets");
    assert.ok(calls.some((c) => c.join(" ").includes("gh release upload v1.2.3") && c.includes("--clobber")),
      "explicit repair must upload archive and checksum when published assets cannot be verified");
  } finally {
    fs.rmSync(tree, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("release publisher: published release download infrastructure failures fail closed even with repair flag", () => {
  const tree = makeReleaseRoot();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-release-tmp-"));
  const asset = "ctide-v1.2.3-plugin.tar.gz";
  try {
    const { runner, calls } = makeReleaseRunner({
      state: "false",
      downloadFailures: [asset],
      downloadFailureStderr: { [asset]: "HTTP 403: rate limit" },
    });
    assert.throws(() => runRelease({
      root: tree,
      tmpDir: tmp,
      runner,
      archiveWriter: fakeArchiveWriter,
      env: { CTIDE_REPAIR_PUBLISHED_RELEASE_ASSETS: "true" },
      log: () => {},
    }), /Unable to download published release assets.*HTTP 403: rate limit/s);
    assert.ok(!calls.some((c) => c.join(" ").includes("gh release upload")),
      "fatal download failures must not repair/upload because auth or transport state is unknown");
  } finally {
    fs.rmSync(tree, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("release publisher: published release mismatch repairs only with explicit flag", () => {
  const tree = makeReleaseRoot();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-release-tmp-"));
  try {
    const { runner, calls } = makeReleaseRunner({ state: "false", remoteAssetContent: "old asset" });
    const result = runRelease({ root: tree, tmpDir: tmp, runner, archiveWriter: fakeArchiveWriter, env: { CTIDE_REPAIR_PUBLISHED_RELEASE_ASSETS: "true" }, log: () => {} });
    assert.strictEqual(result.action, "repaired-published-assets");
    assert.ok(calls.some((c) => c.join(" ").includes("gh release upload v1.2.3") && c.includes("--clobber")),
      "explicit repair must upload archive and checksum with --clobber");
  } finally {
    fs.rmSync(tree, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("release publisher: draft release uploads assets then promotes", () => {
  const tree = makeReleaseRoot();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-release-tmp-"));
  try {
    const { runner, calls } = makeReleaseRunner({ state: "true" });
    const result = runRelease({ root: tree, tmpDir: tmp, runner, archiveWriter: fakeArchiveWriter, log: () => {} });
    assert.strictEqual(result.action, "promoted-draft");
    assert.ok(calls.some((c) => c.join(" ").includes("gh release upload v1.2.3") && c.includes("--clobber")),
      "draft path must upload archive and checksum");
    assert.ok(calls.some((c) => c.join(" ").includes("gh release edit v1.2.3") && c.includes("--draft=false")),
      "draft path must promote to published");
  } finally {
    fs.rmSync(tree, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("release publisher: missing release creates tag and release", () => {
  const tree = makeReleaseRoot();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-release-tmp-"));
  try {
    const { runner, calls } = makeReleaseRunner({ state: null, tagExists: false });
    const result = runRelease({ root: tree, tmpDir: tmp, runner, archiveWriter: fakeArchiveWriter, log: () => {} });
    assert.strictEqual(result.action, "created-release");
    assert.ok(calls.some((c) => c.join(" ") === "git tag -a v1.2.3 -m ctide v1.2.3"), "fresh path must create an annotated tag");
    assert.ok(calls.some((c) => c.join(" ").includes("gh release create v1.2.3") && c.includes("--verify-tag")),
      "fresh path must create a release with --verify-tag");
  } finally {
    fs.rmSync(tree, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("release publisher: signed tag success does not fall back to unsigned tag", () => {
  const tree = makeReleaseRoot();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-release-tmp-"));
  try {
    const { runner, calls } = makeReleaseRunner({ state: null, tagExists: false, signedTagSucceeds: true });
    const result = runRelease({ root: tree, tmpDir: tmp, runner, archiveWriter: fakeArchiveWriter, env: { HAS_GPG: "true" }, log: () => {} });
    assert.strictEqual(result.action, "created-release");
    assert.ok(calls.some((c) => c.join(" ") === "git tag -s v1.2.3 -m ctide v1.2.3"), "signed path must try signed tag");
    assert.ok(!calls.some((c) => c.join(" ") === "git tag -a v1.2.3 -m ctide v1.2.3"), "signed success must not create unsigned tag");
  } finally {
    fs.rmSync(tree, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("release publisher: signing failure falls back to unsigned tag with bot identity", () => {
  const tree = makeReleaseRoot();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-release-tmp-"));
  try {
    const { runner, calls } = makeReleaseRunner({ state: null, tagExists: false, signedTagFails: true, requireIdentityForAnnotatedTag: true });
    const result = runRelease({ root: tree, tmpDir: tmp, runner, archiveWriter: fakeArchiveWriter, env: { HAS_GPG: "true" }, log: () => {} });
    assert.strictEqual(result.action, "created-release");
    const configNameIndex = calls.findIndex((c) => c.join(" ") === "git config user.name github-actions[bot]");
    const unsignedIndex = calls.findIndex((c) => c.join(" ") === "git tag -a v1.2.3 -m ctide v1.2.3");
    assert.ok(configNameIndex >= 0 && unsignedIndex > configNameIndex, "fallback must configure bot identity before unsigned tag");
  } finally {
    fs.rmSync(tree, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("release publisher: tag mismatch fails before draft/new publication", () => {
  const tree = makeReleaseRoot();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-release-tmp-"));
  try {
    const { runner, calls } = makeReleaseRunner({ state: "true", tagCommit: "old" });
    assert.throws(() => runRelease({ root: tree, tmpDir: tmp, runner, archiveWriter: fakeArchiveWriter, log: () => {} }),
      /Refusing to publish or promote release assets/);
    assert.ok(!calls.some((c) => c.join(" ").includes("gh release upload")), "tag mismatch must stop before upload");
  } finally {
    fs.rmSync(tree, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("release publisher: release discovery errors fail closed unless they are not-found", () => {
  const tree = makeReleaseRoot();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-release-tmp-"));
  try {
    const { runner, calls } = makeReleaseRunner({ fatalReleaseView: true });
    assert.throws(() => runRelease({ root: tree, tmpDir: tmp, runner, archiveWriter: fakeArchiveWriter, log: () => {} }),
      /Unable to inspect GitHub release/);
    assert.ok(!calls.some((c) => c.join(" ").includes("gh release create") || c.join(" ").includes("gh release upload")),
      "fatal discovery errors must not fall through to create/upload");
  } finally {
    fs.rmSync(tree, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// --- releaseNotes() must tolerate the dated heading form (`## [x.y.z] - YYYY-MM-DD`).
// An exact `## [x.y.z]` match would miss a dated heading and silently publish the fallback.
// fallback instead of the real section body. ---

// A release root whose CHANGELOG uses the dated keep-a-changelog heading form (the real repo's form).
function makeDatedReleaseRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-release-root-"));
  fs.mkdirSync(path.join(dir, "cressetide", ".claude-plugin"), { recursive: true });
  fs.writeFileSync(path.join(dir, "cressetide", ".claude-plugin", "plugin.json"), JSON.stringify({ version: "1.2.3" }), "utf8");
  fs.writeFileSync(path.join(dir, "CHANGELOG.md"),
    "# Changelog\n\n## [1.2.3] - 2026-07-10\n\nDated release notes body.\n\n## [1.2.2] - 2026-07-01\n\nOld notes.\n", "utf8");
  return dir;
}

test("release publisher: dated CHANGELOG headings yield the real section body as release notes", () => {
  const tree = makeDatedReleaseRoot();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-release-tmp-"));
  try {
    const { runner } = makeReleaseRunner({ state: null, tagExists: false });
    const result = runRelease({ root: tree, tmpDir: tmp, runner, archiveWriter: fakeArchiveWriter, log: () => {} });
    assert.strictEqual(result.action, "created-release");
    // runRelease writes the notes it hands to `gh release create --notes-file` to <tmpDir>/relnotes.md.
    const notes = fs.readFileSync(path.join(tmp, "relnotes.md"), "utf8");
    assert.match(notes, /Dated release notes body\./,
      "a `## [x.y.z] - YYYY-MM-DD` heading must yield the section body, not the see-CHANGELOG fallback");
    assert.ok(!notes.includes("See CHANGELOG.md"), "dated headings must not trigger the fallback note");
    assert.ok(!notes.includes("Old notes."), "collection must stop at the next `## [` heading");
  } finally {
    fs.rmSync(tree, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("release publisher: a genuinely missing CHANGELOG heading still falls back to the see-CHANGELOG note", () => {
  const tree = makeDatedReleaseRoot();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-release-tmp-"));
  try {
    // No heading for 1.2.3 at all (dated or undated) -> the fallback must remain intact.
    fs.writeFileSync(path.join(tree, "CHANGELOG.md"),
      "# Changelog\n\n## [1.2.2] - 2026-07-01\n\nOld notes.\n", "utf8");
    const { runner } = makeReleaseRunner({ state: null, tagExists: false });
    const result = runRelease({ root: tree, tmpDir: tmp, runner, archiveWriter: fakeArchiveWriter, log: () => {} });
    assert.strictEqual(result.action, "created-release");
    const notes = fs.readFileSync(path.join(tmp, "relnotes.md"), "utf8");
    assert.match(notes, /See CHANGELOG\.md for v1\.2\.3\./, "a missing version heading must keep the fallback note");
  } finally {
    fs.rmSync(tree, { recursive: true, force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
