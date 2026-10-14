#!/usr/bin/env node
// Cressetide's release publisher: `--archive` writes the deterministic plugin archive and its checksum
// under _release/; `--publish --tag vX.Y.Z` publishes them for an explicit tag that already exists at HEAD.
// Exit 1 on any failure, usage errors included. Command-line parsing, git and diagnostic redaction come
// from the plugin's own cressetide/lib/, which ships inside the archive this script builds.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { isMain, parseCli } from "../../cressetide/lib/cli.mjs";
import { git, gitOrThrow } from "../../cressetide/lib/git.mjs";
import { redactDiagnostic } from "../../cressetide/lib/redact.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const defaultPluginPrefix = "cressetide";
const versionTagPattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const RELEASE_COMMAND_TIMEOUT_MS = 30000;
// Every git call is bounded too (owner decision Q4 #5).
const GIT_TIMEOUT_MS = 30000;

// The release diagnostics' redaction is cressetide/lib/redact.mjs's, exported under its old name.
export { redactDiagnostic as redactReleaseDiagnostic };

// RFC 1952 gzip header: byte offset 9 is the OS field. Node's zlib.gzipSync() sets it to a
// platform-dependent value (observed: 0x0a on Windows, 0x03 on Linux) with no documented option
// to override it, so identical source input produces byte-different archives across build
// platforms. Patch it post-hoc to the RFC's "unknown" sentinel (0xFF) so the published bytes stop
// depending on which OS built them. The OS byte is always at offset 9 per RFC 1952 (optional
// fields such as FNAME/FCOMMENT/FEXTRA/FHCRC append after it, never before); the FLG === 0 check
// below is not about locating the byte, it restricts patching to gzipSync()'s own canonical
// plain-header output shape and refuses anything else, so an unrecognized input is never
// silently mis-patched.
export function normalizeGzipOsByte(buffer) {
  const hasPlainHeader = buffer.length >= 10 && buffer[0] === 0x1f && buffer[1] === 0x8b && buffer[3] === 0x00;
  if (!hasPlainHeader) {
    const observed = [...buffer.subarray(0, Math.min(10, buffer.length))]
      .map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
    throw new Error(`Unsupported gzip header shape for deterministic OS-byte normalization: ${observed || "<empty>"}`);
  }
  buffer[9] = 0xff;
  return buffer;
}

function tagReference(tag) {
  if (!versionTagPattern.test(tag)) throw new Error(`Release tag ${tag} must match vX.Y.Z`);
  return `refs/tags/${tag}`;
}

function octal(value, length) {
  return `${value.toString(8).padStart(length - 1, "0")}\0`;
}

function writeString(buffer, value, offset, length) {
  const encoded = Buffer.from(value, "utf8");
  if (encoded.length > length) throw new Error(`Tar field is too long: ${value}`);
  encoded.copy(buffer, offset);
}

function splitTarPath(name) {
  if (Buffer.byteLength(name) <= 100) return { name, prefix: "" };
  for (let index = name.lastIndexOf("/"); index > 0; index = name.lastIndexOf("/", index - 1)) {
    const prefix = name.slice(0, index);
    const base = name.slice(index + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(base) <= 100) return { name: base, prefix };
  }
  throw new Error(`Archive path exceeds ustar limits: ${name}`);
}

function tarHeader(name, size) {
  const header = Buffer.alloc(512, 0);
  const parts = splitTarPath(name);
  writeString(header, parts.name, 0, 100);
  writeString(header, octal(0o644, 8), 100, 8);
  writeString(header, octal(0, 8), 108, 8);
  writeString(header, octal(0, 8), 116, 8);
  writeString(header, octal(size, 12), 124, 12);
  writeString(header, octal(0, 12), 136, 12);
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeString(header, "ustar\0", 257, 6);
  writeString(header, "00", 263, 2);
  writeString(header, "root", 265, 32);
  writeString(header, "root", 297, 32);
  if (parts.prefix) writeString(header, parts.prefix, 345, 155);
  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeString(header, `${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8);
  return header;
}

function listFiles(directory, prefix = defaultPluginPrefix) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    if ([".ctide", "node_modules"].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    const archivePath = `${prefix}/${entry.name}`.replaceAll("\\", "/");
    if (entry.isDirectory()) result.push(...listFiles(absolute, archivePath));
    else if (entry.isFile()) result.push({ absolute, archivePath });
    else throw new Error(`Unsupported archive entry: ${absolute}`);
  }
  return result.sort((a, b) => a.archivePath.localeCompare(b.archivePath, "en"));
}

// `git check-ignore` exits 1 when no path is ignored: that is an answer, not a failure.
function ignoredPaths(repositoryRoot, files) {
  const relative = files.map(file => path.relative(repositoryRoot, file.absolute).replaceAll("\\", "/"));
  const checked = git(repositoryRoot, ["check-ignore", "--stdin", "-z"], {
    input: relative.join("\0") + "\0", timeout: GIT_TIMEOUT_MS,
  });
  if (checked.status !== 0 && checked.status !== 1) {
    throw new Error(`Unable to evaluate ignored archive paths: ${checked.stderr || checked.error?.message || "git check-ignore failed"}`);
  }
  return new Set(checked.stdout.split("\0").filter(Boolean).map(item => item.replaceAll("\\", "/")));
}

// Trimmed stdout of a git read that must succeed; gitOrThrow's Error (with .stderr) otherwise.
function gitText(repositoryRoot, args) {
  return gitOrThrow(repositoryRoot, args, { timeout: GIT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }).trim();
}

function readJsonFile(file, label) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { throw new Error(`Unable to read ${label}: ${error.message}`); }
}

function readTaggedJson(repositoryRoot, tag, relative, label) {
  let object;
  try {
    object = gitText(repositoryRoot, ["rev-parse", "--verify", `${tagReference(tag)}:${relative}`]);
    if (gitText(repositoryRoot, ["cat-file", "-t", object]) !== "blob") throw new Error("tag object is not a blob");
    const content = gitOrThrow(repositoryRoot, ["cat-file", "blob", object], {
      timeout: GIT_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024,
    });
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Unable to read ${label} from explicit tag ${tag}: ${error.stderr?.trim() || error.message}`);
  }
}

function releaseIdentity(tag, packageJson, plugin) {
  if (!versionTagPattern.test(tag)) throw new Error(`Release tag ${tag} must match vX.Y.Z`);
  const version = tag.slice(1);
  const versions = [
    ["root package", packageJson?.version],
    ["nested plugin", plugin?.version],
  ];
  const mismatches = versions.filter(([, value]) => value !== version);
  if (mismatches.length) {
    const observed = versions.map(([label, value]) => `${label}=${value ?? "missing"}`).join(", ");
    throw new Error(`Release tag ${tag} version parity failed: expected ${version}; ${observed}`);
  }
  if (packageJson?.name !== "ctide" || plugin?.name !== "ctide") {
    throw new Error(`Release tag ${tag} product identity mismatch across root package and nested plugin`);
  }
  const assetName = `ctide-${tag}-plugin.tar.gz`;
  return { version, tag, assetName, checksumName: `${assetName}.sha256` };
}

function workingReleaseIdentity(repositoryRoot) {
  return releaseIdentity(
    `v${readJsonFile(path.join(repositoryRoot, "package.json"), "root package.json").version}`,
    readJsonFile(path.join(repositoryRoot, "package.json"), "root package.json"),
    readJsonFile(path.join(repositoryRoot, defaultPluginPrefix, ".claude-plugin", "plugin.json"), "nested plugin.json"),
  );
}

export function releaseIdentityFromTag(repositoryRoot, tag) {
  if (!versionTagPattern.test(tag)) throw new Error(`Release tag ${tag} must match vX.Y.Z`);
  return releaseIdentity(
    tag,
    readTaggedJson(repositoryRoot, tag, "package.json", "root package.json"),
    readTaggedJson(repositoryRoot, tag, "cressetide/.claude-plugin/plugin.json", "nested plugin.json"),
  );
}

export function entriesFromTag(repositoryRoot, tag, prefix = defaultPluginPrefix) {
  const listing = gitText(repositoryRoot, ["ls-tree", "-r", "-z", "--full-tree", tagReference(tag), "--", prefix]);
  const records = listing.split("\0").filter(Boolean);
  if (!records.length) throw new Error(`Explicit tag ${tag} contains no plugin files under ${prefix}`);
  return records.map(record => {
    const tab = record.indexOf("\t");
    const header = tab >= 0 ? record.slice(0, tab) : "";
    const archivePath = tab >= 0 ? record.slice(tab + 1).replaceAll("\\", "/") : "";
    const [mode, type, object] = header.split(/\s+/);
    if (type !== "blob" || mode === "120000" || !/^[a-f0-9]{40,64}$/i.test(object || "")) {
      throw new Error(`Unsupported tagged archive entry: ${record}`);
    }
    if (!(archivePath === prefix || archivePath.startsWith(prefix + "/"))) {
      throw new Error(`Tagged archive path escapes plugin root: ${archivePath}`);
    }
    const content = gitOrThrow(repositoryRoot, ["cat-file", "blob", object], {
      encoding: "buffer", timeout: GIT_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024,
    });
    return { archivePath, content };
  }).sort((a, b) => a.archivePath.localeCompare(b.archivePath, "en"));
}

export function createArchive(outputDirectory = path.join(root, "_release"), options = {}) {
  const repositoryRoot = options.repositoryRoot || root;
  const pluginPrefix = options.pluginPrefix || defaultPluginPrefix;
  const pluginRoot = path.join(repositoryRoot, pluginPrefix);
  const identity = options.identity || (options.tag
    ? releaseIdentityFromTag(repositoryRoot, options.tag)
    : workingReleaseIdentity(repositoryRoot));
  if (!fs.existsSync(pluginRoot)) throw new Error(`Plugin root not found: ${pluginRoot}`);
  let files = options.entries || (options.tag
    ? entriesFromTag(repositoryRoot, options.tag, pluginPrefix)
    : listFiles(pluginRoot, pluginPrefix));
  if (!options.entries && !options.tag) {
    const ignored = ignoredPaths(repositoryRoot, files);
    files = files.filter(file => !ignored.has(path.relative(repositoryRoot, file.absolute).replaceAll("\\", "/")));
  }
  const chunks = [];
  for (const file of files) {
    const content = file.content || fs.readFileSync(file.absolute);
    chunks.push(tarHeader(file.archivePath, content.length), content);
    const padding = (512 - (content.length % 512)) % 512;
    if (padding) chunks.push(Buffer.alloc(padding, 0));
  }
  chunks.push(Buffer.alloc(1024, 0));
  const archive = normalizeGzipOsByte(gzipSync(Buffer.concat(chunks), { level: 9, mtime: 0 }));
  fs.mkdirSync(outputDirectory, { recursive: true });
  const assetPath = path.join(outputDirectory, identity.assetName);
  const checksumPath = path.join(outputDirectory, identity.checksumName);
  const checksum = createHash("sha256").update(archive).digest("hex");
  fs.writeFileSync(assetPath, archive);
  fs.writeFileSync(checksumPath, `${checksum}  ${identity.assetName}\n`, "utf8");
  return { assetPath, checksumPath, checksum, ...identity };
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: RELEASE_COMMAND_TIMEOUT_MS, ...options,
  }).trim();
}

export function runReleaseCommand(action, tag, args, options = {}) {
  const runner = options.runner || run;
  const timeoutMs = options.timeoutMs || RELEASE_COMMAND_TIMEOUT_MS;
  try {
    return runner("gh", args, { timeout: timeoutMs });
  } catch (error) {
    const detail = redactDiagnostic([error?.stderr, error?.code, error?.message].filter(Boolean).join("; "))
      || "no subprocess detail captured";
    throw new Error(`Release ${action} for ${tag} failed or timed out after ${timeoutMs}ms: ${detail}`);
  }
}

export function formatReleaseResult(result) {
  const output = {};
  for (const key of [
    "action", "tag", "version", "pluginPrefix", "assetName", "checksumName", "checksum",
    "downloadAttempts", "recheckDownloadAttempts",
  ]) {
    if (["string", "number", "boolean"].includes(typeof result?.[key])) output[key] = result[key];
  }
  return JSON.stringify(output);
}

export function validateReleaseIdentity({ tag, requiredTag, head, tagged, dirty }) {
  if (tag !== requiredTag) throw new Error(`Release tag ${tag} does not match package version ${requiredTag}`);
  if (!head || head !== tagged) throw new Error(`Explicit tag ${tag} must already exist at current HEAD`);
  if (dirty) throw new Error(`Tracked release inputs differ from the explicit tag; refusing to publish untagged bytes: ${dirty}`);
  return true;
}

export function validateTaggedReleaseState(repositoryRoot, identity) {
  const head = gitText(repositoryRoot, ["rev-parse", "HEAD"]);
  const tagged = gitText(repositoryRoot, ["rev-parse", "--verify", `${tagReference(identity.tag)}^{commit}`]);
  const dirty = gitText(repositoryRoot, [
    "status", "--porcelain=v1", "--untracked-files=no", "--",
    "package.json", defaultPluginPrefix,
  ]);
  return validateReleaseIdentity({ tag: identity.tag, requiredTag: `v${identity.version}`, head, tagged, dirty });
}

function classifyGhFailure(stderr) {
  if (/rate.?limit|http\s*429|secondary rate limit/i.test(stderr)) return { category: "rate-limit", transient: true };
  if (/econn|etimedout|enotfound|network|timed?\s*out|could not resolve|connection|tls|http\s*5\d\d/i.test(stderr)) {
    return { category: "network", transient: true };
  }
  if (/no assets match|release not found|not found|http\s*404/i.test(stderr)) return { category: "not-found", transient: false };
  if (/bad credentials|not logged|authentication|auth token|http\s*401|http\s*403|resource not accessible/i.test(stderr)) {
    return { category: "authentication", transient: false };
  }
  return { category: "command", transient: false };
}

function executeGh(args, options = {}) {
  return spawnSync("gh", args, {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000, ...options,
  });
}

function rawFailureText(result) {
  return [result.stderr, result.error?.message].filter(Boolean).join("\n").trim()
    || `gh exited with status ${result.status}`;
}

function failureText(result) {
  return redactDiagnostic(rawFailureText(result));
}

function wait(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

export function downloadPublished(tag, directory, options = {}) {
  const execute = options.execute || ((command, args, executionOptions) => spawnSync(command, args, executionOptions));
  const sleep = options.sleep || wait;
  const maxAttempts = options.maxAttempts || 3;
  const assetName = options.assetName;
  const checksumName = options.checksumName;
  if (!assetName || !checksumName) throw new Error("downloadPublished requires exact asset and checksum names");
  const errors = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = execute("gh", [
      "release", "download", tag,
      "--pattern", assetName,
      "--pattern", checksumName,
      "--dir", directory,
      "--clobber",
    ], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 });
    if (result.status === 0 && !result.error) {
      const stderr = redactDiagnostic([errors.join("\n"), result.stderr?.trim()].filter(Boolean).join("\n"));
      return { outcome: "downloaded", attempts: attempt, stderr };
    }
    const rawMessage = rawFailureText(result);
    const message = redactDiagnostic(rawMessage);
    errors.push(`attempt ${attempt}: ${message}`);
    const classified = classifyGhFailure(rawMessage);
    if (!classified.transient || attempt === maxAttempts) {
      return {
        outcome: classified.category === "not-found" ? "missing-assets" : "transport-error",
        category: classified.category,
        attempts: attempt,
        stderr: errors.join("\n"),
      };
    }
    sleep(250 * attempt);
  }
  throw new Error("Unreachable download retry state");
}

export function inspectPublishedRelease(tag, options = {}) {
  const execute = options.execute || executeGh;
  const result = execute(["release", "view", tag, "--json", "assets"]);
  if (result.status === 0 && !result.error) {
    try {
      const parsed = JSON.parse(result.stdout);
      if (!Array.isArray(parsed.assets)) throw new Error("assets is not an array");
      return { outcome: "found", assets: parsed.assets, stderr: redactDiagnostic(result.stderr?.trim() || "") };
    } catch {
      return { outcome: "transport-error", category: "response", stderr: "Invalid gh release view response" };
    }
  }
  const rawStderr = rawFailureText(result);
  const stderr = redactDiagnostic(rawStderr);
  const classified = classifyGhFailure(rawStderr);
  return {
    outcome: classified.category === "not-found" ? "not-found" : "transport-error",
    category: classified.category,
    stderr,
  };
}

export function validatePublishedAssetInventory(assets, expected) {
  const names = assets.map(asset => asset?.name).filter(name => typeof name === "string");
  const required = [expected.assetName, expected.checksumName];
  const counts = new Map();
  for (const name of names) counts.set(name, (counts.get(name) || 0) + 1);
  const missing = required.filter(name => !counts.has(name));
  const duplicate = [...counts].filter(([, count]) => count > 1).map(([name]) => name);
  const extra = names.filter(name => !required.includes(name));
  if (missing.length || duplicate.length || extra.length || names.length !== assets.length) {
    throw new Error(
      `Published asset inventory mismatch: missing=${missing.join(",") || "none"}; `
      + `duplicate=${duplicate.join(",") || "none"}; extra=${extra.join(",") || "none"}`,
    );
  }
  return true;
}

export function verifyDownloaded(directory, expected) {
  const publishedAsset = path.join(directory, expected.assetName);
  const publishedChecksum = path.join(directory, expected.checksumName);
  if (!fs.existsSync(publishedAsset) || !fs.existsSync(publishedChecksum)) return false;
  const actual = createHash("sha256").update(fs.readFileSync(publishedAsset)).digest("hex");
  const checksumText = fs.readFileSync(publishedChecksum, "utf8");
  const expectedChecksumText = `${expected.checksum}  ${expected.assetName}\n`;
  return actual === expected.checksum && checksumText === expectedChecksumText;
}

function assertDownloadSucceeded(tag, result) {
  if (result?.outcome === "downloaded") return;
  throw new Error(
    `Unable to download published assets for ${tag}: ${result?.category || result?.outcome || "unknown"}; `
    + `${redactDiagnostic(result?.stderr || "no stderr captured")}`,
  );
}

function inspectExisting(tag, inspect, built) {
  const inspection = inspect(tag);
  if (inspection?.outcome !== "found") {
    throw new Error(
      `Unable to inspect existing release ${tag}: ${inspection?.category || inspection?.outcome}; `
      + redactDiagnostic(inspection?.stderr || "no stderr captured"),
    );
  }
  validatePublishedAssetInventory(inspection.assets, built);
}

export function verifyOrRepairPublished(tag, built, options = {}) {
  const inspect = options.inspect || inspectPublishedRelease;
  const download = options.download || ((releaseTag, directory) => downloadPublished(releaseTag, directory, built));
  const runner = options.runner || run;
  const repairEnabled = options.repairEnabled ?? (process.env.CTIDE_REPAIR_PUBLISHED_RELEASE_ASSETS === "true");
  inspectExisting(tag, inspect, built);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-release-verify-"));
  try {
    const downloaded = download(tag, directory, built);
    assertDownloadSucceeded(tag, downloaded);
    if (verifyDownloaded(directory, built)) {
      return { action: "verified-existing-release", downloadAttempts: downloaded.attempts || 1, ...built };
    }
    if (!repairEnabled) {
      throw new Error(`Published archive bytes for ${tag} differ from the deterministic tag archive; explicit repair authorization is required`);
    }
    runReleaseCommand("asset repair upload", tag,
      ["release", "upload", tag, built.assetPath, built.checksumPath, "--clobber"], { runner });
    inspectExisting(tag, inspect, built);
    const repaired = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-release-recheck-"));
    let recheckDownloadAttempts = 1;
    try {
      const reDownloaded = download(tag, repaired, built);
      assertDownloadSucceeded(tag, reDownloaded);
      recheckDownloadAttempts = reDownloaded.attempts || 1;
      if (!verifyDownloaded(repaired, built)) throw new Error(`Published assets for ${tag} still differ after repair`);
    } finally { fs.rmSync(repaired, { recursive: true, force: true }); }
    return {
      action: "repaired-existing-release",
      downloadAttempts: downloaded.attempts || 1,
      recheckDownloadAttempts,
      ...built,
    };
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

export function publish(tag, options = {}) {
  if (!tag) throw new Error("Publishing requires --tag vX.Y.Z");
  const identity = releaseIdentityFromTag(root, tag);
  validateTaggedReleaseState(root, identity);
  const built = createArchive(path.join(root, "_release"), { tag, identity });
  const inspection = inspectPublishedRelease(tag, options);
  if (inspection.outcome === "found") return verifyOrRepairPublished(tag, built, options);
  if (inspection.outcome !== "not-found") {
    throw new Error(`Unable to inspect release ${tag}: ${inspection.category}; ${inspection.stderr || "no stderr captured"}`);
  }
  runReleaseCommand("create", tag,
    ["release", "create", tag, built.assetPath, built.checksumPath, "--verify-tag", "--title", tag, "--generate-notes"], options);
  return verifyOrRepairPublished(tag, built, options);
}

const USAGE = "publish-release.mjs [--archive | --publish] [--tag vX.Y.Z]";
const CLI_OPTIONS = { archive: { type: "boolean" }, publish: { type: "boolean" }, tag: { type: "string" } };

// The mode and tag from the command line, in any order: `--archive` (the default when neither mode is
// given) or `--publish`, never both. A usage error (an unknown flag, --tag without its value, a stray
// argument, both modes) throws like every other failure here: exit 1, nothing built or published.
function parseReleaseArgs(args) {
  const parsed = parseCli(args, { options: CLI_OPTIONS });
  if (parsed.error) throw new Error(`${parsed.error} (usage: ${USAGE})`);
  const { archive = false, publish: publishMode = false, tag } = parsed.values;
  if (archive && publishMode) throw new Error(`--archive and --publish cannot be combined (usage: ${USAGE})`);
  return { mode: publishMode ? "publish" : "archive", tag: tag || undefined };
}

if (isMain(import.meta.url)) {
  try {
    const { mode, tag } = parseReleaseArgs(process.argv.slice(2));
    const result = mode === "archive"
      ? createArchive(path.join(root, "_release"), tag ? { tag } : {})
      : publish(tag);
    console.log(formatReleaseResult(result));
  } catch (error) {
    console.error(`Cressetide release failed: ${redactDiagnostic(error.message)}`);
    process.exit(1);
  }
}
