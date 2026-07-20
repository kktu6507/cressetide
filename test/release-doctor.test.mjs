import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { inspect } from "node:util";
import test from "node:test";
import * as releasePublisher from "../.github/scripts/publish-release.mjs";
import { diagnose, probeFailureDetail } from "../cressetide/skills/doctor/scripts/doctor.mjs";
import { root, temporary } from "./helpers.mjs";

const {
  createArchive,
  downloadPublished,
  entriesFromTag,
  formatReleaseResult,
  inspectPublishedRelease,
  redactReleaseDiagnostic,
  releaseIdentityFromTag,
  runReleaseCommand,
  validatePublishedAssetInventory,
  validateReleaseIdentity,
  validateTaggedReleaseState,
  verifyDownloaded,
  verifyOrRepairPublished,
} = releasePublisher;

function taggedReleaseFixture(versions = {}, options = {}) {
  const repository = temporary("ctide-release-identity-");
  const git = (...args) => execFileSync("git", ["-C", repository, ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  git("init", "--initial-branch=main");
  git("config", "user.email", "release@example.invalid");
  git("config", "user.name", "Release Test");
  git("config", "commit.gpgsign", "false");
  git("config", "tag.gpgSign", "false");
  fs.mkdirSync(path.join(repository, "cressetide", ".claude-plugin"), { recursive: true });
  fs.writeFileSync(path.join(repository, "package.json"), JSON.stringify({
    name: "ctide", version: versions.packageVersion || "0.1.0",
  }), "utf8");
  fs.writeFileSync(path.join(repository, "cressetide", ".claude-plugin", "plugin.json"), JSON.stringify({
    name: "ctide", version: versions.pluginVersion || "0.1.0",
  }), "utf8");
  fs.writeFileSync(path.join(repository, "cressetide", "payload.txt"), "tagged payload\n", "utf8");
  git("add", ".");
  git("commit", "-m", "tagged fixture");
  if (options.createTag !== false) git("tag", "v0.1.0");
  return { repository, git };
}

function tarNames(gzip) {
  const tar = gunzipSync(gzip);
  const names = [];
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/, "");
    const size = Number.parseInt(header.subarray(124, 136).toString("ascii").replace(/\0.*$/, "").trim() || "0", 8);
    names.push(prefix ? `${prefix}/${name}` : name);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return names;
}

function tarContents(gzip) {
  const tar = gunzipSync(gzip);
  const entries = new Map();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/, "");
    const size = Number.parseInt(header.subarray(124, 136).toString("ascii").replace(/\0.*$/, "").trim() || "0", 8);
    const fullName = prefix ? `${prefix}/${name}` : name;
    entries.set(fullName, tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

test("release archive is deterministic, checksummed, and contains only the plugin tree", () => {
  const first = createArchive(temporary("ctide-release-a-"));
  const second = createArchive(temporary("ctide-release-b-"));
  const one = fs.readFileSync(first.assetPath);
  const two = fs.readFileSync(second.assetPath);
  assert.deepEqual(one, two);
  assert.equal(one[9], 0xff, "gzip OS byte (RFC 1952 offset 9) must not depend on the build platform");
  assert.equal(first.checksum, second.checksum);
  assert.match(first.assetName, /^ctide-v\d+\.\d+\.\d+-plugin\.tar\.gz$/);
  assert.equal(fs.readFileSync(first.checksumPath, "utf8"), `${first.checksum}  ${first.assetName}\n`);
  const names = tarNames(one);
  assert.ok(names.length > 20);
  assert.ok(names.every(name => name.startsWith("cressetide/")));
  assert.ok(names.includes("cressetide/.claude-plugin/plugin.json"));
  assert.ok(names.includes("cressetide/skills/map/scripts/map.mjs"));
});

test("release archive excludes ignored bytes that are not part of the tagged product", () => {
  const { repository, git } = taggedReleaseFixture();
  fs.writeFileSync(path.join(repository, ".gitignore"), "cressetide/archive-secret.tmp\n", "utf8");
  git("add", ".gitignore");
  git("commit", "-m", "ignore release scratch");
  const ignored = path.join(repository, "cressetide", "archive-secret.tmp");
  fs.writeFileSync(ignored, "must not ship\n", "utf8");
  const built = createArchive(temporary("ctide-release-ignored-"), { repositoryRoot: repository });
  assert.equal(tarNames(fs.readFileSync(built.assetPath)).includes("cressetide/archive-secret.tmp"), false);
});

test("tag-bound archive reads immutable Git blobs even when index flags hide working-tree drift", () => {
  const repository = temporary("ctide-release-tagged-");
  const git = (...args) => execFileSync("git", ["-C", repository, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "--initial-branch=main");
  git("config", "user.email", "release@example.invalid");
  git("config", "user.name", "Release Test");
  git("config", "commit.gpgsign", "false");
  git("config", "tag.gpgSign", "false");
  const file = path.join(repository, "cressetide", "file.txt");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "tagged bytes\n", "utf8");
  git("add", ".");
  git("commit", "-m", "tagged fixture");
  git("tag", "v0.1.0");
  git("update-index", "--skip-worktree", "cressetide/file.txt");
  fs.writeFileSync(file, "working tree drift\n", "utf8");
  assert.equal(git("status", "--porcelain", "--", "cressetide"), "");
  const built = createArchive(temporary("ctide-release-tagged-output-"), { entries: entriesFromTag(repository, "v0.1.0") });
  assert.equal(tarContents(fs.readFileSync(built.assetPath)).get("cressetide/file.txt").toString("utf8"), "tagged bytes\n");
});

test("tag release identity rejects manifest version mismatch", () => {
  const { repository } = taggedReleaseFixture({ pluginVersion: "0.2.0" });
  assert.throws(
    () => releaseIdentityFromTag(repository, "v0.1.0"),
    /tag v0\.1\.0.*version parity.*nested plugin.*0\.2\.0/i,
  );
});

test("release identity rejects a version-shaped branch when the tag is absent", () => {
  const { repository, git } = taggedReleaseFixture({}, { createTag: false });
  git("branch", "v0.1.0");
  assert.throws(() => releaseIdentityFromTag(repository, "v0.1.0"), /explicit tag|refs\/tags|unknown revision|invalid object/i);
  assert.throws(() => entriesFromTag(repository, "v0.1.0"), /refs\/tags|unknown revision|invalid object/i);
});

test("tag release identity and archive bytes come from tag blobs while relevant working drift is rejected", () => {
  const { repository } = taggedReleaseFixture();
  fs.writeFileSync(path.join(repository, "package.json"), JSON.stringify({ name: "ctide", version: "9.9.9" }), "utf8");
  fs.writeFileSync(path.join(repository, "cressetide", "payload.txt"), "working payload drift\n", "utf8");

  const identity = releaseIdentityFromTag(repository, "v0.1.0");
  assert.equal(identity.version, "0.1.0");
  assert.equal(identity.assetName, "ctide-v0.1.0-plugin.tar.gz");
  const built = createArchive(temporary("ctide-release-tag-identity-"), { repositoryRoot: repository, tag: "v0.1.0" });
  assert.equal(built.assetName, identity.assetName);
  assert.equal(tarContents(fs.readFileSync(built.assetPath)).get("cressetide/payload.txt").toString("utf8"), "tagged payload\n");
  let dirtyError;
  try { validateTaggedReleaseState(repository, identity); }
  catch (error) { dirtyError = error; }
  assert.match(dirtyError?.message || "", /tracked release inputs differ/is);
  assert.match(dirtyError?.message || "", /package\.json/);
  assert.match(dirtyError?.message || "", /cressetide\/payload\.txt/);
});

test("release identity rejects version, HEAD, and dirty-tree mismatches", () => {
  assert.equal(validateReleaseIdentity({ tag: "v0.1.0", requiredTag: "v0.1.0", head: "abc", tagged: "abc", dirty: "" }), true);
  assert.throws(() => validateReleaseIdentity({ tag: "v0.2.0", requiredTag: "v0.1.0", head: "abc", tagged: "abc", dirty: "" }), /package version/);
  assert.throws(() => validateReleaseIdentity({ tag: "v0.1.0", requiredTag: "v0.1.0", head: "abc", tagged: "def", dirty: "" }), /current HEAD/);
  assert.throws(() => validateReleaseIdentity({ tag: "v0.1.0", requiredTag: "v0.1.0", head: "abc", tagged: "abc", dirty: "?? cressetide\/extra" }), /untagged bytes/);
});

test("published archive verification detects byte and checksum drift", () => {
  const directory = temporary("ctide-release-verify-");
  const built = createArchive(directory);
  assert.equal(verifyDownloaded(directory, built), true);
  fs.appendFileSync(built.assetPath, "drift");
  assert.equal(verifyDownloaded(directory, built), false);
  const checksumOnly = createArchive(temporary("ctide-release-checksum-drift-"));
  fs.writeFileSync(checksumOnly.checksumPath, `${"0".repeat(64)}  ${checksumOnly.assetName}\n`, "utf8");
  assert.equal(verifyDownloaded(path.dirname(checksumOnly.assetPath), checksumOnly), false);
  const trailing = createArchive(temporary("ctide-release-checksum-trailing-"));
  fs.appendFileSync(trailing.checksumPath, "UNEXPECTED\n", "utf8");
  assert.equal(verifyDownloaded(path.dirname(trailing.assetPath), trailing), false);
});

test("published asset inventory rejects extra and duplicate assets", () => {
  const built = createArchive(temporary("ctide-release-inventory-"));
  assert.throws(() => validatePublishedAssetInventory([
    { name: built.assetName },
    { name: built.checksumName },
    { name: "unexpected.txt" },
  ], built), /extra=unexpected\.txt/);
  assert.throws(() => validatePublishedAssetInventory([
    { name: built.assetName },
    { name: built.assetName },
    { name: built.checksumName },
  ], built), new RegExp(`duplicate=.*${built.assetName.replace(/[.]/g, "\\.")}`));
});

test("release inventory query requests gh assets JSON exactly", () => {
  const calls = [];
  const result = inspectPublishedRelease("v0.1.0", {
    execute: args => {
      calls.push(args);
      return { status: 0, stdout: JSON.stringify({ assets: [{ name: "one" }] }), stderr: "" };
    },
  });
  assert.deepEqual(calls, [["release", "view", "v0.1.0", "--json", "assets"]]);
  assert.deepEqual(result, { outcome: "found", assets: [{ name: "one" }], stderr: "" });
});

test("release inventory helper redacts stderr on both success and failure results", () => {
  const diagnostic = `Authorization: "Bearer CTIDE_INSPECT_DIRECT_SECRET"; `
    + `github_pat_1234567890abcdefghijklmnop; ${path.join(os.tmpdir(), "inspect")}; ${path.join(os.homedir(), "home")}`;
  const success = inspectPublishedRelease("v0.1.0", {
    execute: () => ({ status: 0, stdout: JSON.stringify({ assets: [] }), stderr: diagnostic }),
  });
  const failure = inspectPublishedRelease("v0.1.0", {
    execute: () => ({ status: 1, stdout: "", stderr: diagnostic }),
  });

  for (const result of [success, failure]) {
    assert.doesNotMatch(result.stderr, /CTIDE_INSPECT_DIRECT_SECRET|github_pat_1234567890abcdefghijklmnop/);
    assert.ok(!result.stderr.toLowerCase().includes(os.tmpdir().toLowerCase()));
    assert.ok(!result.stderr.toLowerCase().includes(os.homedir().toLowerCase()));
    assert.match(result.stderr, /Authorization: \[redacted\].*\[redacted\].*<temp>.*~/s);
  }
});

test("release inventory helper never echoes malformed stdout and classifies raw failure context", () => {
  const malformed = inspectPublishedRelease("v0.1.0", {
    execute: () => ({ status: 0, stdout: "CTIDE_MALFORMED_RESPONSE_SECRET", stderr: "" }),
  });
  assert.deepEqual(malformed, {
    outcome: "transport-error",
    category: "response",
    stderr: "Invalid gh release view response",
  });

  const notFound = inspectPublishedRelease("v0.1.0", {
    execute: () => ({
      status: 1,
      stdout: "",
      stderr: "Authorization: Bearer CTIDE_NOT_FOUND_SECRET HTTP 404 release not found",
    }),
  });
  assert.equal(notFound.outcome, "not-found");
  assert.equal(notFound.category, "not-found");
  assert.doesNotMatch(notFound.stderr, /CTIDE_NOT_FOUND_SECRET/);
});

test("checksum-only published inventory is rejected without clobber repair", () => {
  const built = createArchive(temporary("ctide-release-checksum-only-"));
  const commands = [];
  assert.throws(() => verifyOrRepairPublished("v0.1.0", built, {
    inspect: () => ({ outcome: "found", assets: [{ name: built.checksumName }] }),
    download: () => { throw new Error("download must not run for an invalid inventory"); },
    runner: (command, args) => commands.push([command, ...args]),
    repairEnabled: true,
  }), new RegExp(`missing=.*${built.assetName.replace(/[.]/g, "\\.")}`));
  assert.deepEqual(commands, []);
});

test("transport failure preserves stderr and never enters clobber repair", () => {
  const built = createArchive(temporary("ctide-release-transport-"));
  const commands = [];
  let failure;
  assert.throws(() => {
    try {
      verifyOrRepairPublished("v0.1.0", built, {
        inspect: () => ({ outcome: "found", assets: [{ name: built.assetName }, { name: built.checksumName }] }),
        download: () => ({
          outcome: "transport-error",
          category: "network",
          attempts: 3,
          stderr: `dial tcp: connection timed out; token=CTIDE_TRANSPORT_SECRET; `
            + `ghp_1234567890abcdefghijklmnopqrstuv; ${path.join(os.tmpdir(), "download")}; ${path.join(os.homedir(), "home")}`,
        }),
        runner: (command, args) => commands.push([command, ...args]),
        repairEnabled: true,
      });
    } catch (error) { failure = error; throw error; }
  });
  assert.match(failure.message, /network.*connection timed out.*\[redacted\].*<temp>.*~/is);
  assert.doesNotMatch(failure.message, /CTIDE_TRANSPORT_SECRET|ghp_1234567890abcdefghijklmnopqrstuv/);
  assert.ok(!failure.message.toLowerCase().includes(os.tmpdir().toLowerCase()));
  assert.ok(!failure.message.toLowerCase().includes(os.homedir().toLowerCase()));
  assert.deepEqual(commands, []);
});

test("release inspection failure redacts the exported helper error", () => {
  const built = createArchive(temporary("ctide-release-inspect-redaction-"));
  let failure;
  assert.throws(() => {
    try {
      verifyOrRepairPublished("v0.1.0", built, {
        inspect: () => ({
          outcome: "transport-error",
          category: "network",
          stderr: 'Authorization: "Bearer CTIDE_INSPECT_SECRET"',
        }),
      });
    } catch (error) { failure = error; throw error; }
  });
  assert.match(failure.message, /Unable to inspect existing release v0\.1\.0: network; Authorization: \[redacted\]/);
  assert.doesNotMatch(failure.message, /CTIDE_INSPECT_SECRET/);
});

test("published download retries transient failures with a bound and retains every stderr", () => {
  let attempts = 0;
  const result = downloadPublished("v0.1.0", temporary("ctide-release-download-"), {
    execute: () => {
      attempts += 1;
      return { status: 1, stdout: "", stderr: `network timeout ${attempts}` };
    },
    sleep: () => undefined,
    maxAttempts: 3,
    assetName: "ctide-v0.1.0-plugin.tar.gz",
    checksumName: "ctide-v0.1.0-plugin.tar.gz.sha256",
  });
  assert.equal(attempts, 3);
  assert.equal(result.outcome, "transport-error");
  assert.equal(result.category, "network");
  assert.equal(result.attempts, 3);
  assert.match(result.stderr, /network timeout 1[\s\S]*network timeout 3/);
});

test("published download helper redacts stderr on both success and failure results", () => {
  const diagnostic = `{"token":"CTIDE_DOWNLOAD_DIRECT_SECRET"}; `
    + `ghp_1234567890abcdefghijklmnopqrstuv; ${path.join(os.tmpdir(), "download")}; ${path.join(os.homedir(), "home")}`;
  const invoke = status => downloadPublished("v0.1.0", temporary("ctide-release-direct-redaction-"), {
    execute: () => ({ status, stdout: "", stderr: diagnostic }),
    sleep: () => undefined,
    maxAttempts: 1,
    assetName: "ctide-v0.1.0-plugin.tar.gz",
    checksumName: "ctide-v0.1.0-plugin.tar.gz.sha256",
  });

  for (const result of [invoke(0), invoke(1)]) {
    assert.doesNotMatch(result.stderr, /CTIDE_DOWNLOAD_DIRECT_SECRET|ghp_1234567890abcdefghijklmnopqrstuv/);
    assert.ok(!result.stderr.toLowerCase().includes(os.tmpdir().toLowerCase()));
    assert.ok(!result.stderr.toLowerCase().includes(os.homedir().toLowerCase()));
    assert.match(result.stderr, /"token":\[redacted\].*\[redacted\].*<temp>.*~/s);
  }
});

test("published download retries with clobber so partial prior files cannot poison recovery", () => {
  const calls = [];
  const result = downloadPublished("v0.1.0", temporary("ctide-release-clobber-"), {
    execute: (command, args) => {
      calls.push([command, ...args]);
      return calls.length === 1
        ? { status: 1, stdout: "", stderr: "network timeout" }
        : { status: 0, stdout: "", stderr: "" };
    },
    sleep: () => undefined,
    maxAttempts: 2,
    assetName: "ctide-v0.1.0-plugin.tar.gz",
    checksumName: "ctide-v0.1.0-plugin.tar.gz.sha256",
  });
  assert.equal(result.outcome, "downloaded");
  assert.equal(result.attempts, 2);
  assert.match(result.stderr, /attempt 1: network timeout/);
  assert.ok(calls.every(call => call.includes("--clobber")));
});

test("authentication fails once and rate limits retry only to the configured bound", () => {
  const cases = [
    { stderr: "HTTP 401: Bad credentials", category: "authentication", expectedAttempts: 1 },
    { stderr: "HTTP 429: API rate limit exceeded", category: "rate-limit", expectedAttempts: 3 },
  ];
  for (const item of cases) {
    let attempts = 0;
    const result = downloadPublished("v0.1.0", temporary("ctide-release-transport-kind-"), {
      execute: () => { attempts += 1; return { status: 1, stdout: "", stderr: item.stderr }; },
      sleep: () => undefined,
      maxAttempts: 3,
      assetName: "ctide-v0.1.0-plugin.tar.gz",
      checksumName: "ctide-v0.1.0-plugin.tar.gz.sha256",
    });
    assert.equal(result.outcome, "transport-error");
    assert.equal(result.category, item.category);
    assert.equal(attempts, item.expectedAttempts);
    assert.match(result.stderr, new RegExp(item.stderr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("download classification uses raw context while returned diagnostics stay redacted", () => {
  let attempts = 0;
  const result = downloadPublished("v0.1.0", temporary("ctide-release-raw-classification-"), {
    execute: () => {
      attempts += 1;
      return {
        status: 1,
        stdout: "",
        stderr: "token=CTIDE_RATE_LIMIT_SECRET HTTP 429 API rate limit exceeded",
      };
    },
    sleep: () => undefined,
    maxAttempts: 3,
    assetName: "ctide-v0.1.0-plugin.tar.gz",
    checksumName: "ctide-v0.1.0-plugin.tar.gz.sha256",
  });
  assert.equal(attempts, 3);
  assert.equal(result.outcome, "transport-error");
  assert.equal(result.category, "rate-limit");
  assert.equal(result.attempts, 3);
  assert.doesNotMatch(result.stderr, /CTIDE_RATE_LIMIT_SECRET/);
});

test("release create and upload commands carry a bounded timeout with actionable context", () => {
  let observed;
  let failure;
  assert.throws(() => {
    try {
      runReleaseCommand("create", "v0.1.0", ["release", "create", "v0.1.0"], {
        timeoutMs: 25,
        runner: (command, args, options) => {
          observed = { command, args, options };
          const error = new Error('subprocess timed out Authorization: "Bearer CTIDE_MESSAGE_SECRET"');
          error.code = "ETIMEDOUT";
          error.stderr = 'network stalled Bearer "CTIDE_STDERR_SECRET"';
          throw error;
        },
      });
    } catch (error) { failure = error; throw error; }
  });
  assert.ok(failure);
  assert.match(failure.message, /Release create for v0\.1\.0 failed or timed out after 25ms:.*network stalled Bearer \[redacted\].*ETIMEDOUT.*Authorization: \[redacted\]/s);
  assert.doesNotMatch(failure.message, /CTIDE_(?:STDERR|MESSAGE)_SECRET/);
  assert.equal(failure.cause, undefined);
  assert.doesNotMatch(inspect(failure), /CTIDE_(?:STDERR|MESSAGE)_SECRET/);
  assert.deepEqual(observed, {
    command: "gh",
    args: ["release", "create", "v0.1.0"],
    options: { timeout: 25 },
  });
});

test("release diagnostic redaction hides GitHub tokens and shortens temp/home paths", () => {
  const diagnostic = redactReleaseDiagnostic(
    `${path.join(os.tmpdir(), "ctide-secret")}; GH_TOKEN=CTIDE_GH_SECRET; `
    + "github_pat_1234567890abcdefghijklmnop; Authorization: 'Bearer CTIDE_AUTH_SECRET'; "
    + '{"token":"CTIDE_JSON_TOKEN_SECRET","authorization":"Bearer CTIDE_JSON_AUTH_SECRET"}',
  );
  assert.match(diagnostic, /<temp>/);
  assert.match(diagnostic, /GH_TOKEN=\[redacted\]/i);
  assert.match(diagnostic, /\[redacted\]/);
  assert.doesNotMatch(diagnostic, /CTIDE_(?:GH|AUTH)_SECRET|CTIDE_JSON_(?:TOKEN|AUTH)_SECRET|github_pat_1234567890abcdefghijklmnop/);
  assert.ok(!diagnostic.toLowerCase().includes(os.tmpdir().toLowerCase()));
  assert.ok(!diagnostic.toLowerCase().includes(os.homedir().toLowerCase()));
});

test("release repair upload timeout retains the upload action and tag context", () => {
  const built = createArchive(temporary("ctide-release-upload-timeout-"));
  const inventory = () => ({ outcome: "found", assets: [{ name: built.assetName }, { name: built.checksumName }] });
  const download = (tag, directory) => {
    fs.copyFileSync(built.assetPath, path.join(directory, built.assetName));
    fs.copyFileSync(built.checksumPath, path.join(directory, built.checksumName));
    fs.appendFileSync(path.join(directory, built.assetName), "drift");
    return { outcome: "downloaded", attempts: 1 };
  };
  let failure;
  assert.throws(() => {
    try {
      verifyOrRepairPublished("v0.1.0", built, {
        inspect: inventory,
        download,
        repairEnabled: true,
        runner: (command, args, options) => {
          assert.equal(command, "gh");
          assert.deepEqual(args.slice(0, 3), ["release", "upload", "v0.1.0"]);
          assert.deepEqual(options, { timeout: 30000 });
          const error = new Error('upload timed out API key: "CTIDE_UPLOAD_MESSAGE_SECRET"');
          error.code = "ETIMEDOUT";
          error.stderr = "upload transport stalled private key: -----BEGIN PRIVATE KEY-----\nCTIDE_UPLOAD_STDERR_SECRET\n-----END PRIVATE KEY-----";
          throw error;
        },
      });
    } catch (error) { failure = error; throw error; }
  });
  assert.ok(failure);
  assert.match(failure.message, /Release asset repair upload for v0\.1\.0 failed or timed out after 30000ms:.*upload transport stalled private key: \[redacted\].*ETIMEDOUT.*upload timed out API key: \[redacted\]/s);
  assert.doesNotMatch(failure.message, /CTIDE_UPLOAD_(?:STDERR|MESSAGE)_SECRET/);
  assert.equal(failure.cause, undefined);
  assert.doesNotMatch(inspect(failure), /CTIDE_UPLOAD_(?:STDERR|MESSAGE)_SECRET/);
});

test("published asset policy verifies, refuses drift, repairs explicitly, and rechecks", () => {
  const built = createArchive(temporary("ctide-release-policy-source-"));
  const populate = (directory, valid) => {
    fs.copyFileSync(built.assetPath, path.join(directory, built.assetName));
    fs.copyFileSync(built.checksumPath, path.join(directory, built.checksumName));
    if (!valid) fs.appendFileSync(path.join(directory, built.assetName), "drift");
    return true;
  };
  const inventory = () => ({ outcome: "found", assets: [{ name: built.assetName }, { name: built.checksumName }] });
  const verified = verifyOrRepairPublished("v0.1.0", built, {
    inspect: inventory,
    download: (tag, directory) => ({
      outcome: populate(directory, true) ? "downloaded" : "transport-error",
      attempts: 3,
    }),
    repairEnabled: false,
  });
  assert.equal(verified.action, "verified-existing-release");
  assert.equal(verified.downloadAttempts, 3);
  assert.throws(() => verifyOrRepairPublished("v0.1.0", built, {
    inspect: inventory,
    download: (tag, directory) => ({ outcome: populate(directory, false) ? "downloaded" : "transport-error" }),
    repairEnabled: false,
  }), /differ/);

  let downloads = 0;
  const commands = [];
  const repaired = verifyOrRepairPublished("v0.1.0", built, {
    inspect: inventory,
    download: (tag, directory) => ({
      outcome: populate(directory, ++downloads > 1) ? "downloaded" : "transport-error",
      attempts: downloads + 1,
    }),
    runner: (command, args, options) => commands.push({ command, args, options }),
    repairEnabled: true,
  });
  assert.equal(repaired.action, "repaired-existing-release");
  assert.equal(repaired.downloadAttempts, 2);
  assert.equal(repaired.recheckDownloadAttempts, 3);
  const formatted = formatReleaseResult({
    ...repaired,
    stderr: "token=CTIDE_FORMAT_SECRET",
    unexpected: "Authorization: Bearer CTIDE_FORMAT_SECRET",
  });
  const publicResult = JSON.parse(formatted);
  assert.equal(publicResult.action, repaired.action);
  assert.equal(publicResult.downloadAttempts, 2);
  assert.equal(publicResult.recheckDownloadAttempts, 3);
  assert.equal(publicResult.checksum, repaired.checksum);
  assert.doesNotMatch(formatted, /assetPath|checksumPath|stderr|unexpected|CTIDE_FORMAT_SECRET/);
  assert.ok(!formatted.includes(path.dirname(repaired.assetPath)));
  assert.equal(commands.length, 1);
  assert.deepEqual([commands[0].command, ...commands[0].args.slice(0, 3)], ["gh", "release", "upload", "v0.1.0"]);
  assert.deepEqual(commands[0].options, { timeout: 30000 });
  assert.throws(() => verifyOrRepairPublished("v0.1.0", built, {
    inspect: inventory,
    download: (tag, directory) => ({ outcome: populate(directory, false) ? "downloaded" : "transport-error" }),
    runner: () => undefined,
    repairEnabled: true,
  }), /still differ after repair/);
});

test("Doctor runs the complete local fail-open boundary probe", () => {
  const report = diagnose(path.join(root, "cressetide"));
  assert.equal(report.status, "pass", JSON.stringify(report, null, 2));
  assert.equal(report.checks.filter(check => check.name.startsWith("hook:")).length, 6);
  assert.equal(report.checks.find(check => check.name === "telemetry").detail, "No network or telemetry probe performed");
});

test("Doctor rejects extra hook registrations instead of substring-matching the expected six", () => {
  const copy = path.join(temporary("ctide-doctor-extra-"), "cressetide");
  fs.cpSync(path.join(root, "cressetide"), copy, { recursive: true });
  const manifestPath = path.join(copy, "hooks", "hooks.json");
  const hooks = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  hooks.hooks.Stop[0].hooks.push({ type: "command", command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/hooks/plan-gate.js"] });
  fs.writeFileSync(manifestPath, JSON.stringify(hooks), "utf8");
  const report = diagnose(copy);
  assert.equal(report.status, "fail");
  assert.equal(report.checks.find(check => check.name === "hook-wiring").status, "fail");
});

test("Doctor probe failures expose only structured status metadata", () => {
  const detail = probeFailureDetail("syntax", {
    status: null,
    stderr: `SyntaxError: broken\nTOKEN=super-secret ${"x".repeat(400)}`,
    error: new Error("spawn timed out"),
  });
  assert.match(detail, /^syntax=null\(stderr=\d+ bytes error=present\)$/);
  assert.ok(detail.length <= 260);
  assert.doesNotMatch(detail, /SyntaxError|TOKEN|super-secret|spawn timed out/);
});

for (const diagnostic of [
  "Authorization: Bearer CTIDE_SENTINEL_SECRET",
  'Authorization: "Bearer CTIDE_SENTINEL_SECRET"',
  "authorization:   Basic CTIDE_SENTINEL_SECRET",
  "API_KEY=CTIDE_SENTINEL_SECRET",
  "API key: CTIDE_SENTINEL_SECRET",
  "private-key: CTIDE_SENTINEL_SECRET",
  "private key: CTIDE_SENTINEL_SECRET",
  "private key: -----BEGIN PRIVATE KEY-----\nCTIDE_SENTINEL_SECRET\n-----END PRIVATE KEY-----",
  "Bearer CTIDE_SENTINEL_SECRET",
  'Bearer "CTIDE_SENTINEL_SECRET"',
  '{"token":"CTIDE_SENTINEL_SECRET"}',
  '{"authorization":"Bearer CTIDE_SENTINEL_SECRET"}',
  "ghp_1234567890abcdefghijklmnopqrstuv",
  "github_pat_1234567890abcdefghijklmnopqrstuv",
]) {
  test(`Doctor omits credential-bearing probe payload: ${diagnostic.split(/[ :=]/)[0]}`, () => {
    const detail = probeFailureDetail("probe", { status: 1, stderr: diagnostic });
    assert.match(detail, /^probe=1\(stderr=\d+ bytes\)$/);
    assert.doesNotMatch(detail, /Authorization|Bearer|API|private|token|ghp_|github_pat_|CTIDE_SENTINEL_SECRET/i);
  });
}

for (const [label, diagnostic] of [
  ["temp", path.join(os.tmpdir(), "doctor-sensitive")],
  ["home", path.join(os.homedir(), "doctor-sensitive")],
]) {
  test(`Doctor omits ${label} paths from public probe diagnostics`, () => {
    const detail = probeFailureDetail("probe", { status: 1, stderr: diagnostic });
    assert.match(detail, /^probe=1\(stderr=\d+ bytes\)$/);
    assert.ok(!detail.toLowerCase().includes(diagnostic.toLowerCase()));
  });
}

test("release workflow is explicit-tag only and includes provenance", () => {
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "release.yml"), "utf8");
  assert.match(workflow, /tags:\s*\["v\*"\]/);
  assert.match(workflow, /attest-build-provenance@/);
  assert.match(workflow, /--tag "\$RELEASE_TAG"/);
  assert.equal((workflow.match(/format\('refs\/tags\/\{0\}'/g) || []).length, 2);
  assert.match(workflow, /git show-ref --verify --quiet "\$TAG_REF"/);
  assert.doesNotMatch(workflow, /branches:\s*\[main\]/);
  assert.match(workflow, /plugin validate --strict \.\/cressetide/);
  assert.match(workflow, /^  validate:\r?$/m);
  assert.match(workflow, /^  publish:\r?$/m);
  assert.match(workflow, /^  attest:\r?$/m);
  assert.match(workflow, /validate:[\s\S]*?permissions:\r?\n\s+contents: read/);
  assert.match(workflow, /publish:[\s\S]*?needs: validate[\s\S]*?permissions:\r?\n\s+contents: write/);
  assert.match(workflow, /attest:[\s\S]*?needs: publish[\s\S]*?permissions:\r?\n\s+contents: read\r?\n\s+id-token: write\r?\n\s+attestations: write/);
  assert.doesNotMatch(workflow, /^\s{4}env:\r?\n\s{6}GH_TOKEN:/m);
  assert.doesNotMatch(workflow, /subject-path:.*\*/);
  assert.match(workflow, /subject-path:\s*_attest\/ctide-\$\{\{ needs\.publish\.outputs\.tag \}\}-plugin\.tar\.gz/);
});

test("validation workflow checks the nested plugin", () => {
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "validate.yml"), "utf8");
  assert.match(workflow, /plugin validate --strict \.\/cressetide$/m);
});
