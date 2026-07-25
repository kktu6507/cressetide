#!/usr/bin/env node
import cp from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import zlib from "node:zlib";

function commandText(cmd, args) {
  return [cmd, ...args].join(" ");
}

function commandFailureMessage(status, cmd, args, stdout, stderr, spawnError, signal) {
  const details = [
    stderr,
    stdout,
    spawnError?.message,
    signal ? `signal: ${signal}` : "",
  ].map((value) => (value || "").trim()).filter(Boolean).join("\n");
  const suffix = details ? `\n${details}` : "";
  return `Command failed (${status ?? "spawn-error"}): ${commandText(cmd, args)}${suffix}`;
}

export function defaultRunner(cmd, args, options = {}) {
  const result = cp.spawnSync(cmd, args, {
    cwd: options.cwd,
    encoding: "utf8",
    input: options.input,
  });
  if (result.status !== 0) {
    const err = new Error(commandFailureMessage(result.status, cmd, args, result.stdout, result.stderr, result.error, result.signal));
    err.status = result.status;
    err.stdout = result.stdout || "";
    err.stderr = result.stderr || "";
    err.spawnError = result.error;
    err.signal = result.signal;
    err.cmd = cmd;
    err.args = args;
    throw err;
  }
  return (result.stdout || "").trimEnd();
}

export function defaultBytesRunner(cmd, args, options = {}) {
  const result = cp.spawnSync(cmd, args, {
    cwd: options.cwd,
    input: options.input,
  });
  if (result.status !== 0) {
    const stdout = result.stdout?.toString("utf8") || "";
    const stderr = result.stderr?.toString("utf8") || "";
    const err = new Error(commandFailureMessage(result.status, cmd, args, stdout, stderr, result.error, result.signal));
    err.status = result.status;
    err.stdout = stdout;
    err.stderr = stderr;
    err.spawnError = result.error;
    err.signal = result.signal;
    err.cmd = cmd;
    err.args = args;
    throw err;
  }
  return result.stdout || Buffer.alloc(0);
}

function tryRun(runner, cmd, args, options) {
  try {
    return { ok: true, stdout: runner(cmd, args, options) };
  } catch (error) {
    return { ok: false, error };
  }
}

function classifyReleaseViewFailure(error) {
  const text = errorDetails(error);
  if (/not found|could not resolve to a Release|HTTP 404/i.test(text)) return "not-found";
  return "fatal";
}

function errorDetails(error) {
  return [error?.stderr, error?.stdout, error?.message].map((value) => (value || "").trim()).filter(Boolean).join("\n") || String(error);
}

function releaseState(runner, cwd, tag) {
  const result = tryRun(runner, "gh", ["release", "view", tag, "--json", "isDraft", "-q", ".isDraft"], { cwd });
  if (result.ok) return result.stdout.trim();
  if (classifyReleaseViewFailure(result.error) === "not-found") return "";
  throw new Error(`Unable to inspect GitHub release ${tag}: ${result.error.stderr || result.error.message}`);
}

function releaseNotes(root, version) {
  const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8").split(/\r?\n/);
  // Accept both heading forms: bare `## [x.y.z]` and the dated keep-a-changelog form
  // `## [x.y.z] - YYYY-MM-DD`. An exact heading comparison would miss dated headings and
  // silently publish the "See CHANGELOG.md" fallback.
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headingRe = new RegExp(`^## \\[${escaped}\\](?: - .*)?\\s*$`);
  const start = changelog.findIndex((line) => headingRe.test(line));
  if (start === -1) return "";
  const out = [];
  for (let i = start + 1; i < changelog.length; i += 1) {
    if (/^## \[/.test(changelog[i])) break;
    out.push(changelog[i]);
  }
  return out.join("\n").trim();
}

function writeChecksum(assetPath, checksumPath, assetName) {
  const hash = crypto.createHash("sha256").update(fs.readFileSync(assetPath)).digest("hex");
  fs.writeFileSync(checksumPath, `${hash}  ${assetName}\n`, "utf8");
}

function configureBotIdentity(runner, cwd) {
  runner("git", ["config", "user.name", "github-actions[bot]"], { cwd });
  runner("git", ["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"], { cwd });
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function parseChecksumFile(checksumPath, expectedAssetName) {
  const lines = fs.readFileSync(checksumPath, "utf8").split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length !== 1) {
    throw new Error(`${checksumPath}: expected exactly one SHA-256 checksum line.`);
  }
  const match = /^([a-fA-F0-9]{64})[ \t]+[* ]?(.+)$/.exec(lines[0]);
  if (!match) {
    throw new Error(`${checksumPath}: expected '<sha256>  ${expectedAssetName}'.`);
  }
  const fileName = match[2].trim();
  if (fileName !== expectedAssetName) {
    throw new Error(`${checksumPath}: checksum names '${fileName}', expected '${expectedAssetName}'.`);
  }
  return { hash: match[1].toLowerCase(), fileName };
}

function octal(value, length) {
  const text = value.toString(8);
  return text.padStart(length - 1, "0").slice(-(length - 1)) + "\0";
}

function splitTarName(name) {
  const bytes = Buffer.byteLength(name);
  if (bytes <= 100) return { name, prefix: "" };
  const parts = name.split("/");
  for (let i = 1; i < parts.length; i += 1) {
    const prefix = parts.slice(0, i).join("/");
    const rest = parts.slice(i).join("/");
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(rest) <= 100) {
      return { name: rest, prefix };
    }
  }
  throw new Error(`Path too long for deterministic ustar archive: ${name}`);
}

function writeString(header, offset, length, value) {
  const source = Buffer.from(value, "utf8");
  if (source.length > length) throw new Error(`tar header field too long: ${value}`);
  source.copy(header, offset, 0, source.length);
}

function tarHeader({ pathName, mode, size = 0, type = "0", linkName = "" }) {
  const header = Buffer.alloc(512, 0);
  const names = splitTarName(pathName);
  writeString(header, 0, 100, names.name);
  writeString(header, 100, 8, octal(mode, 8));
  writeString(header, 108, 8, octal(0, 8));
  writeString(header, 116, 8, octal(0, 8));
  writeString(header, 124, 12, octal(size, 12));
  writeString(header, 136, 12, octal(0, 12));
  header.fill(0x20, 148, 156);
  writeString(header, 156, 1, type);
  writeString(header, 157, 100, linkName);
  writeString(header, 257, 6, "ustar");
  writeString(header, 263, 2, "00");
  writeString(header, 345, 155, names.prefix);
  let sum = 0;
  for (const byte of header) sum += byte;
  writeString(header, 148, 8, sum.toString(8).padStart(6, "0") + "\0 ");
  return header;
}

function tarEntry(pathName, body, options = {}) {
  const content = Buffer.isBuffer(body) ? body : Buffer.from(body || "");
  const type = options.type || "0";
  const size = type === "0" ? content.length : 0;
  const chunks = [tarHeader({ pathName, mode: options.mode || 0o644, size, type, linkName: options.linkName || "" })];
  if (type === "0") {
    chunks.push(content);
    const remainder = content.length % 512;
    if (remainder) chunks.push(Buffer.alloc(512 - remainder, 0));
  }
  return Buffer.concat(chunks);
}

function parseLsTree(buffer) {
  return buffer.toString("utf8").split("\0").filter(Boolean).map((entry) => {
    const tab = entry.indexOf("\t");
    const meta = entry.slice(0, tab).split(" ");
    return { mode: meta[0], type: meta[1], oid: meta[2], name: entry.slice(tab + 1).replace(/\\/g, "/") };
  }).sort((a, b) => Buffer.compare(Buffer.from(a.name, "utf8"), Buffer.from(b.name, "utf8")));
}

function directoryEntriesFor(files, rootDir) {
  const dirs = new Set([rootDir]);
  for (const file of files) {
    const parts = file.name.split("/");
    let current = rootDir;
    for (let i = 0; i < parts.length - 1; i += 1) {
      current += `${parts[i]}/`;
      dirs.add(current);
    }
  }
  return [...dirs].sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
}

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

export function createDeterministicPluginArchive({ tag, cwd, assetPath, bytesRunner = defaultBytesRunner }) {
  const tree = bytesRunner("git", ["ls-tree", "-r", "-z", `${tag}:cressetide`], { cwd });
  const files = parseLsTree(tree);
  const rootDir = `ctide-${tag}/`;
  const chunks = [];
  for (const dir of directoryEntriesFor(files, rootDir)) {
    chunks.push(tarEntry(dir, Buffer.alloc(0), { type: "5", mode: 0o755 }));
  }
  for (const file of files) {
    const archivePath = `${rootDir}${file.name}`;
    if (file.type !== "blob") throw new Error(`Unsupported git object in release archive: ${file.type} ${file.name}`);
    const blob = bytesRunner("git", ["cat-file", "blob", file.oid], { cwd });
    if (file.mode === "120000") {
      chunks.push(tarEntry(archivePath, Buffer.alloc(0), { type: "2", mode: 0o777, linkName: blob.toString("utf8") }));
    } else {
      chunks.push(tarEntry(archivePath, blob, { type: "0", mode: file.mode === "100755" ? 0o755 : 0o644 }));
    }
  }
  chunks.push(Buffer.alloc(1024, 0));
  const tar = Buffer.concat(chunks);
  fs.writeFileSync(assetPath, normalizeGzipOsByte(zlib.gzipSync(tar, { level: 9, mtime: 0 })));
}

function ensureTagAtHead(runner, cwd, tag, hasGpg, log) {
  const headCommit = runner("git", ["rev-parse", "HEAD"], { cwd }).trim();
  const tagCheck = tryRun(runner, "git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}`], { cwd });
  if (tagCheck.ok) {
    const tagCommit = runner("git", ["rev-parse", `${tag}^{commit}`], { cwd }).trim();
    if (tagCommit !== headCommit) {
      throw new Error(`Existing tag ${tag} points to ${tagCommit}, expected current HEAD ${headCommit}. Refusing to publish or promote release assets whose checksum would not match the release tag.`);
    }
    log(`Existing tag ${tag} is bound to current HEAD ${headCommit}.`);
    return;
  }

  if (hasGpg) {
    const signed = tryRun(runner, "git", ["tag", "-s", tag, "-m", `ctide ${tag}`], { cwd });
    if (signed.ok) {
      log(`Created SIGNED tag ${tag}.`);
      runner("git", ["push", "origin", tag], { cwd });
      return;
    }
    log("WARNING: tag signing unavailable (key/passphrase issue) - using an unsigned annotated tag.");
    configureBotIdentity(runner, cwd);
  }

  runner("git", ["tag", "-a", tag, "-m", `ctide ${tag}`], { cwd });
  runner("git", ["push", "origin", tag], { cwd });
}

function createArchiveFromTag(runner, bytesRunner, cwd, tmpDir, tag, asset, checksum, log, archiveWriter) {
  const tagCheck = tryRun(runner, "git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}`], { cwd });
  if (!tagCheck.ok) {
    throw new Error(`Release tag ${tag} does not exist; cannot create checksum-bound assets.`);
  }
  const assetPath = path.join(tmpDir, asset);
  const checksumPath = path.join(tmpDir, checksum);
  archiveWriter({ tag, cwd, assetPath, bytesRunner });
  writeChecksum(assetPath, checksumPath, asset);
  log(`Created deterministic release asset ${assetPath} and checksum ${checksumPath} from ${tag}:cressetide.`);
  return { assetPath, checksumPath };
}

function uploadAssets(runner, cwd, tag, assetPath, checksumPath) {
  runner("gh", ["release", "upload", tag, assetPath, checksumPath, "--clobber"], { cwd });
}

function verifyPublishedAssets({ runner, cwd, tmpDir, tag, asset, checksum, assetPath, checksumPath, repairPublishedAssets, log }) {
  const downloadDir = path.join(tmpDir, "published-assets");
  fs.mkdirSync(downloadDir, { recursive: true });
  const remoteAsset = path.join(downloadDir, asset);
  const remoteChecksum = path.join(downloadDir, checksum);

  const downloadAsset = tryRun(runner, "gh", ["release", "download", tag, "--pattern", asset, "--dir", downloadDir, "--clobber"], { cwd });
  const downloadChecksum = tryRun(runner, "gh", ["release", "download", tag, "--pattern", checksum, "--dir", downloadDir, "--clobber"], { cwd });
  const fatalDownload = [downloadAsset, downloadChecksum]
    .find((result) => !result.ok && classifyReleaseViewFailure(result.error) !== "not-found");
  if (fatalDownload) {
    throw new Error(`Unable to download published release assets for ${tag}: ${errorDetails(fatalDownload.error)}`);
  }
  const canVerifyRemote = downloadAsset.ok && downloadChecksum.ok && fs.existsSync(remoteAsset) && fs.existsSync(remoteChecksum);

  if (canVerifyRemote) {
    const localExpected = parseChecksumFile(checksumPath, asset);
    let reason = "";
    let remoteExpected = null;
    try {
      remoteExpected = parseChecksumFile(remoteChecksum, asset);
    } catch (error) {
      reason = `Published release checksum for ${tag} is not usable: ${error.message}`;
    }
    const remoteActual = sha256File(remoteAsset);
    if (!reason && remoteExpected.hash === remoteActual && remoteExpected.hash === localExpected.hash) {
      log(`Release ${tag} already published with matching deterministic archive and checksum.`);
      return { tag, action: "verified-published-assets" };
    }
    if (!reason) reason = `Published release assets for ${tag} do not match the deterministic tag-bound archive.`;
    if (!repairPublishedAssets) {
      throw new Error(`${reason} Refusing to clobber published assets without CTIDE_REPAIR_PUBLISHED_RELEASE_ASSETS=true.`);
    }
    log(`${reason} Repair flag set; refreshing published assets.`);
    uploadAssets(runner, cwd, tag, assetPath, checksumPath);
    return { tag, action: "repaired-published-assets" };
  }

  const reason = `Published release ${tag} is missing ${asset} or ${checksum}, or the assets could not be downloaded for verification.`;
  if (!repairPublishedAssets) {
    throw new Error(`${reason} Refusing to create/replace published assets without CTIDE_REPAIR_PUBLISHED_RELEASE_ASSETS=true.`);
  }
  log(`${reason} Repair flag set; uploading deterministic assets.`);
  uploadAssets(runner, cwd, tag, assetPath, checksumPath);
  return { tag, action: "repaired-published-assets" };
}

export function runRelease({
  root = process.cwd(),
  env = process.env,
  runner = defaultRunner,
  bytesRunner = defaultBytesRunner,
  tmpDir = os.tmpdir(),
  log = console.log,
  archiveWriter = createDeterministicPluginArchive,
} = {}) {
  const pluginJson = JSON.parse(fs.readFileSync(path.join(root, "cressetide", ".claude-plugin", "plugin.json"), "utf8"));
  const version = pluginJson.version;
  const tag = `v${version}`;
  const asset = `ctide-${tag}-plugin.tar.gz`;
  const checksum = `${asset}.sha256`;
  fs.mkdirSync(tmpDir, { recursive: true });

  const notes = releaseNotes(root, version) || `See CHANGELOG.md for ${tag}.`;
  const notesPath = path.join(tmpDir, "relnotes.md");
  fs.writeFileSync(notesPath, `${notes}\n`, "utf8");

  const state = releaseState(runner, root, tag);
  log(`Release state for ${tag}: isDraft=${state || "<none>"}`);

  if (env.HAS_GPG !== "true") {
    configureBotIdentity(runner, root);
  }

  if (state === "false") {
    const { assetPath, checksumPath } = createArchiveFromTag(runner, bytesRunner, root, tmpDir, tag, asset, checksum, log, archiveWriter);
    return verifyPublishedAssets({
      runner,
      cwd: root,
      tmpDir,
      tag,
      asset,
      checksum,
      assetPath,
      checksumPath,
      repairPublishedAssets: env.CTIDE_REPAIR_PUBLISHED_RELEASE_ASSETS === "true",
      log,
    });
  }

  if (state !== "" && state !== "true") {
    throw new Error(`Unexpected release draft state for ${tag}: ${state}`);
  }

  log(`Publishing ${tag} from manifest version ${version}.`);
  ensureTagAtHead(runner, root, tag, env.HAS_GPG === "true", log);
  const { assetPath, checksumPath } = createArchiveFromTag(runner, bytesRunner, root, tmpDir, tag, asset, checksum, log, archiveWriter);

  if (state === "true") {
    log("Existing draft found - uploading assets and promoting to published.");
    uploadAssets(runner, root, tag, assetPath, checksumPath);
    runner("gh", ["release", "edit", tag, "--draft=false", "--notes-file", notesPath], { cwd: root });
    log(`Published ${tag} (promoted from draft).`);
    return { tag, action: "promoted-draft" };
  }

  runner("gh", ["release", "create", tag, assetPath, checksumPath, "--title", tag, "--notes-file", notesPath, "--verify-tag"], { cwd: root });
  log(`Published ${tag}.`);
  return { tag, action: "created-release" };
}

// isInvokedDirectly() kept in sync with the other 13 CLI entry points (documented copy — see garden
// hash guard); this copy is the reverse-direction pathToFileURL() form since this file imports
// pathToFileURL, not fileURLToPath — semantically identical, not a body match
function isInvokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isInvokedDirectly()) {
  try {
    runRelease();
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}
