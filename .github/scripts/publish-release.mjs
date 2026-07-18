#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { normalizeGzipOsByte } from "./publish-release-core.mjs";

// Preserve the complete release API alongside Cressetide's stricter immutable-tag publisher.
export {
  createDeterministicPluginArchive,
  defaultBytesRunner,
  defaultRunner,
  normalizeGzipOsByte,
  runRelease,
} from "./publish-release-core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const defaultPluginPrefix = "cressetide";
const versionTagPattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const RELEASE_COMMAND_TIMEOUT_MS = 30000;

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

function ignoredPaths(repositoryRoot, files) {
  const relative = files.map(file => path.relative(repositoryRoot, file.absolute).replaceAll("\\", "/"));
  const checked = spawnSync("git", ["-C", repositoryRoot, "check-ignore", "--stdin", "-z"], {
    input: relative.join("\0") + "\0", encoding: "utf8", timeout: 10000,
  });
  if (checked.status !== 0 && checked.status !== 1) {
    throw new Error(`Unable to evaluate ignored archive paths: ${checked.stderr || checked.error?.message || "git check-ignore failed"}`);
  }
  return new Set(checked.stdout.split("\0").filter(Boolean).map(item => item.replaceAll("\\", "/")));
}

function git(repositoryRoot, args, options = {}) {
  return execFileSync("git", ["-C", repositoryRoot, ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024, ...options,
  }).trim();
}

function readJsonFile(file, label) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { throw new Error(`Unable to read ${label}: ${error.message}`); }
}

function readTaggedJson(repositoryRoot, tag, relative, label) {
  let object;
  try {
    object = git(repositoryRoot, ["rev-parse", "--verify", `${tagReference(tag)}:${relative}`]);
    if (git(repositoryRoot, ["cat-file", "-t", object]) !== "blob") throw new Error("tag object is not a blob");
    const content = execFileSync("git", ["-C", repositoryRoot, "cat-file", "blob", object], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 4 * 1024 * 1024,
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
  const listing = git(repositoryRoot, ["ls-tree", "-r", "-z", "--full-tree", tagReference(tag), "--", prefix]);
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
    const content = execFileSync("git", ["-C", repositoryRoot, "cat-file", "blob", object], {
      encoding: null, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024,
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

function replacePath(text, sensitivePath, replacement) {
  if (!sensitivePath) return text;
  const escaped = sensitivePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(escaped, process.platform === "win32" ? "gi" : "g"), replacement);
}

export function redactReleaseDiagnostic(value) {
  let text = String(value ?? "")
    .replace(/-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/gi, "[redacted private key]")
    .replace(/[\r\n\t]+/g, " ").trim()
    .replace(/(["']?\bauthorization\b["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^,;|]+)/gi, "$1[redacted]")
    .replace(/(["']?\b(?:api(?:[_-]|\s+)?key|private(?:[_-]|\s+)?key|gh(?:[_-]|\s+)?token|token|secret|password)\b["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^,;|]+)/gi, "$1[redacted]")
    .replace(/\bbearer\s+["']?[A-Za-z0-9._~+/=-]+["']?/gi, "Bearer [redacted]")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "[redacted]");
  text = replacePath(text, os.tmpdir(), "<temp>");
  text = replacePath(text, os.homedir(), "~");
  return text.slice(0, 2000);
}

export function runReleaseCommand(action, tag, args, options = {}) {
  const runner = options.runner || run;
  const timeoutMs = options.timeoutMs || RELEASE_COMMAND_TIMEOUT_MS;
  try {
    return runner("gh", args, { timeout: timeoutMs });
  } catch (error) {
    const detail = redactReleaseDiagnostic([error?.stderr, error?.code, error?.message].filter(Boolean).join("; "))
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
  const head = git(repositoryRoot, ["rev-parse", "HEAD"]);
  const tagged = git(repositoryRoot, ["rev-parse", "--verify", `${tagReference(identity.tag)}^{commit}`]);
  const dirty = git(repositoryRoot, [
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
  return redactReleaseDiagnostic(rawFailureText(result));
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
      const stderr = redactReleaseDiagnostic([errors.join("\n"), result.stderr?.trim()].filter(Boolean).join("\n"));
      return { outcome: "downloaded", attempts: attempt, stderr };
    }
    const rawMessage = rawFailureText(result);
    const message = redactReleaseDiagnostic(rawMessage);
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
      return { outcome: "found", assets: parsed.assets, stderr: redactReleaseDiagnostic(result.stderr?.trim() || "") };
    } catch {
      return { outcome: "transport-error", category: "response", stderr: "Invalid gh release view response" };
    }
  }
  const rawStderr = rawFailureText(result);
  const stderr = redactReleaseDiagnostic(rawStderr);
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
    + `${redactReleaseDiagnostic(result?.stderr || "no stderr captured")}`,
  );
}

function inspectExisting(tag, inspect, built) {
  const inspection = inspect(tag);
  if (inspection?.outcome !== "found") {
    throw new Error(
      `Unable to inspect existing release ${tag}: ${inspection?.category || inspection?.outcome}; `
      + redactReleaseDiagnostic(inspection?.stderr || "no stderr captured"),
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

function publish(tag) {
  if (!tag) throw new Error("Publishing requires --tag vX.Y.Z");
  const identity = releaseIdentityFromTag(root, tag);
  validateTaggedReleaseState(root, identity);
  const built = createArchive(path.join(root, "_release"), { tag, identity });
  const inspection = inspectPublishedRelease(tag);
  if (inspection.outcome === "found") return verifyOrRepairPublished(tag, built);
  if (inspection.outcome !== "not-found") {
    throw new Error(`Unable to inspect release ${tag}: ${inspection.category}; ${inspection.stderr || "no stderr captured"}`);
  }
  runReleaseCommand("create", tag,
    ["release", "create", tag, built.assetPath, built.checksumPath, "--verify-tag", "--title", tag, "--generate-notes"]);
  return verifyOrRepairPublished(tag, built);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const mode = process.argv[2] || "--archive";
    const tagIndex = process.argv.indexOf("--tag");
    const tag = tagIndex >= 0 ? process.argv[tagIndex + 1] : undefined;
    const result = mode === "--archive"
      ? createArchive(path.join(root, "_release"), tag ? { tag } : {})
      : mode === "--publish"
        ? publish(tag)
        : (() => { throw new Error(`Unknown mode: ${mode}`); })();
    console.log(formatReleaseResult(result));
  } catch (error) {
    console.error(`Cressetide release failed: ${redactReleaseDiagnostic(error.message)}`);
    process.exit(1);
  }
}
