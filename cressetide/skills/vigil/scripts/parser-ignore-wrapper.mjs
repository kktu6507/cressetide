// Least-authority wrapper around the vendored Acorn parser and ignore engine.
//
// SCOPE: this is the dependency-wrapper layer and nothing else. It does not discover test
// declarations, classify node:test or node:assert bindings, analyse scope, read attachment tags,
// compute stableId/structuralId/oracle closures, select adapters, enumerate a worktree, or produce
// any inventory. Those remain unimplemented, and nothing here should be read as claiming the
// parser component, AC136, a populated inventory, or Phase 2 is ready.
//
// AUTHORITY: the vendor manifest beside this file is the single machine-readable source for
// identities, member targets, hashes, wrapper settings and resource limits. This file reads every
// one of those from the manifest and restates none of them; the ADR and the approved specs are
// human governance records and are never parsed here.
//
// The public API takes no overrides. There is no way for a caller to substitute a manifest, a
// worker entry, an execArgv set, a timeout or a capability object: the shipped manifest and the
// production worker are the only things these functions will ever run.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { WorkerRunnerError, resolveExecArgv, runWorkerJob } from "./parser-ignore-worker-runner.mjs";

export class ParserIgnoreWrapperError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = "ParserIgnoreWrapperError";
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

const fail = (code, message, detail) => new ParserIgnoreWrapperError(code, message, detail);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VENDOR_DIR = path.resolve(HERE, "..", "vendor");
const REPO_ROOT = path.resolve(VENDOR_DIR, "..", "..", "..", "..");
const MANIFEST_PATH = path.join(VENDOR_DIR, "vendor-manifest.json");

// Values this build knows how to honour. A manifest that asks for anything else is a manifest this
// implementation cannot serve, which is a fail-closed condition rather than a setting to ignore.
// These are capability names, not resource numbers: every limit still comes from the manifest.
const SUPPORTED = {
  schemaVersion: 1,
  carrierRole: "dependency-authorization-packet-only-not-registry",
  inseparableCapabilities: ["ast-parser", "gitignore-matching"],
  sourceType: "module",
  rangeAuthority: "normalized UTF-8 bytes via explicit code-unit-to-byte mapping",
  workerModule: "node:worker_threads",
  failureMode: "fail-closed-no-partial-artifact",
  ignorecase: false,
  allowRelativePaths: false,
  ignoreAuthority: "S1 tracked .gitignore bytes and canonical repo-relative POSIX candidate paths only",
  runtimeDependencies: 0,
};

// --- manifest loading ------------------------------------------------------------------------------

function requireObject(value, code, what) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw fail(code, `${what} must be an object`);
  return value;
}
function requireString(value, code, what) {
  if (typeof value !== "string" || value === "") throw fail(code, `${what} must be a non-empty string`);
  return value;
}
function requireInteger(value, code, what) {
  if (!Number.isSafeInteger(value) || value <= 0) throw fail(code, `${what} must be a positive integer`);
  return value;
}
function requireExactly(actual, expected, code, what) {
  if (actual !== expected) throw fail(code, `${what} is ${JSON.stringify(actual)}; this build only implements ${JSON.stringify(expected)}`);
}

// Order and multiplicity are part of the declaration, so this compares the array as written. It
// deliberately does not sort or de-duplicate first: silently repairing a capability list would
// accept a packet that says something other than what this build implements.
function requireExactArray(actual, expected, code, what) {
  const same = Array.isArray(actual) && actual.length === expected.length && actual.every((v, i) => v === expected[i]);
  if (!same) throw fail(code, `${what} is ${JSON.stringify(actual)}; this build only implements exactly ${JSON.stringify(expected)}`);
}

// A member target must resolve inside the shipped vendor directory. Absolute paths, backslashes,
// drive prefixes and any traversal are rejected before the path is used, not after.
function resolveMemberTarget(target) {
  if (typeof target !== "string" || target === "") throw fail("E_MEMBER_PATH", "member target must be a non-empty string");
  if (target.includes("\\")) throw fail("E_MEMBER_PATH", `member target must use POSIX separators: ${target}`);
  if (path.posix.isAbsolute(target) || /^[A-Za-z]:/.test(target)) throw fail("E_MEMBER_PATH", `member target must be repository-relative: ${target}`);
  if (path.posix.normalize(target) !== target) throw fail("E_MEMBER_PATH", `member target must already be canonical: ${target}`);
  const absolute = path.resolve(REPO_ROOT, target);
  const relative = path.relative(VENDOR_DIR, absolute);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw fail("E_MEMBER_PATH", `member target escapes the vendor directory: ${target}`);
  }
  return absolute;
}

function verifyMember(member) {
  requireObject(member, "E_MANIFEST_SHAPE", "manifest member");
  if (member.state !== "vendored") {
    throw fail("E_MANIFEST_NOT_VENDORED", `member ${member.target} is in state ${JSON.stringify(member.state)}; the wrapper only loads vendored artifacts`);
  }
  requireString(member.source, "E_MANIFEST_SHAPE", "member source");
  requireString(member.sha256, "E_MANIFEST_SHAPE", "member sha256");
  requireInteger(member.bytes, "E_MANIFEST_SHAPE", "member bytes");
  const absolute = resolveMemberTarget(member.target);

  let stat;
  try { stat = fs.lstatSync(absolute); } catch {
    throw fail("E_MEMBER_MISSING", `vendored member is missing: ${member.target}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw fail("E_MEMBER_MISSING", `vendored member is not a regular file: ${member.target}`);

  const bytes = fs.readFileSync(absolute);
  if (bytes.length !== member.bytes) {
    throw fail("E_MEMBER_BYTES", `vendored member ${member.target} is ${bytes.length} bytes; the manifest authorizes ${member.bytes}`);
  }
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  if (digest !== member.sha256) {
    throw fail("E_MEMBER_DIGEST", `vendored member ${member.target} hashes to ${digest}; the manifest authorizes ${member.sha256}`);
  }
  return { target: member.target, bytes };
}

// The runtime member is chosen by extension, not by array position: taking members[0] would make
// ordering an implicit authority the manifest never granted. Exactly one match, or fail closed.
function selectRuntimeMember(pkg, verified) {
  const runtime = verified.filter((m) => /\.(mjs|cjs|js)$/.test(m.target));
  if (runtime.length !== 1) {
    throw fail("E_MEMBER_AMBIGUOUS", `package ${pkg.name} declares ${runtime.length} JavaScript runtime members; exactly one is required`, runtime.map((m) => m.target));
  }
  return runtime[0];
}

function findPackage(manifest, name, version, code) {
  const matches = manifest.packages.filter((p) => p.name === name && p.version === version);
  if (matches.length !== 1) {
    throw fail(code, `the manifest does not resolve ${name}@${version} to exactly one package (found ${matches.length})`);
  }
  return matches[0];
}

// Everything the caller can reach is frozen all the way down, and every value is copied out of the
// parsed manifest rather than aliased into it. A caller that empties `unsupported` or rewrites a
// limit changes nothing, because there is no shared mutable object to change.
function deepFreeze(value) {
  if (value === null || typeof value !== "object") return value;
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

let cachedCapability = null;

function buildCapability() {
  let raw;
  try { raw = fs.readFileSync(MANIFEST_PATH, "utf8"); } catch {
    throw fail("E_MANIFEST_UNREADABLE", `the shipped vendor manifest is unreadable: ${MANIFEST_PATH}`);
  }
  let manifest;
  try { manifest = JSON.parse(raw); } catch (e) {
    throw fail("E_MANIFEST_SHAPE", `the shipped vendor manifest is not valid JSON: ${e.message}`);
  }
  requireObject(manifest, "E_MANIFEST_SHAPE", "manifest root");
  requireExactly(manifest.schemaVersion, SUPPORTED.schemaVersion, "E_MANIFEST_UNSUPPORTED", "manifest.schemaVersion");
  const authorization = requireObject(manifest.authorization, "E_MANIFEST_SHAPE", "manifest.authorization");
  // What the packet says it is, and what it says it authorizes. A manifest that reclassifies itself
  // as an adapter registry, or that narrows the inseparable capability set, is describing a
  // different artifact than the one this build knows how to load.
  requireExactly(authorization.carrierRole, SUPPORTED.carrierRole, "E_MANIFEST_UNSUPPORTED", "authorization.carrierRole");
  requireExactArray(authorization.inseparableCapabilities, SUPPORTED.inseparableCapabilities, "E_MANIFEST_UNSUPPORTED", "authorization.inseparableCapabilities");
  if (authorization.status !== "selection-authorized-artifacts-vendored") {
    throw fail("E_MANIFEST_NOT_VENDORED", `manifest authorization status is ${JSON.stringify(authorization.status)}; the wrapper requires vendored artifacts`);
  }
  if (authorization.canonicalAuthority !== "this-file") {
    throw fail("E_MANIFEST_SHAPE", "the manifest must declare itself as the canonical authority");
  }
  if (authorization.runtimeInstall !== false || authorization.runtimeNetwork !== false) {
    throw fail("E_MANIFEST_SHAPE", "the manifest must forbid runtime installation and runtime network access");
  }
  if (!Array.isArray(manifest.packages) || manifest.packages.length === 0) {
    throw fail("E_MANIFEST_SHAPE", "manifest.packages must be a non-empty array");
  }

  const parserIdentity = requireObject(manifest.implementationIdentity, "E_MANIFEST_SHAPE", "manifest.implementationIdentity");
  const ignoreIdentity = requireObject(manifest.ignoreEngineIdentity, "E_MANIFEST_SHAPE", "manifest.ignoreEngineIdentity");
  for (const key of ["implementationId", "parserId", "parserVersion"]) requireString(parserIdentity[key], "E_MANIFEST_SHAPE", `implementationIdentity.${key}`);
  for (const key of ["engineId", "engineVersion"]) requireString(ignoreIdentity[key], "E_MANIFEST_SHAPE", `ignoreEngineIdentity.${key}`);

  const policy = requireObject(manifest.resourcePolicy, "E_MANIFEST_SHAPE", "manifest.resourcePolicy");
  const preDispatch = requireObject(policy.preDispatch, "E_MANIFEST_SHAPE", "resourcePolicy.preDispatch");
  const postParse = requireObject(policy.postParse, "E_MANIFEST_SHAPE", "resourcePolicy.postParse");
  const worker = requireObject(policy.worker, "E_MANIFEST_SHAPE", "resourcePolicy.worker");
  const contract = requireObject(manifest.wrapperContract, "E_MANIFEST_SHAPE", "manifest.wrapperContract");
  const acornContract = requireObject(contract.acorn, "E_MANIFEST_SHAPE", "wrapperContract.acorn");
  const ignoreContract = requireObject(contract.ignore, "E_MANIFEST_SHAPE", "wrapperContract.ignore");

  const PRE_DISPATCH_KEYS = ["maxNormalizedSourceBytes", "maxGitignoreFileBytes", "maxGitignoreTotalBytes", "maxGitignoreFiles", "maxGitignorePatterns", "maxGitignorePatternBytes", "maxIgnoreLayerDepth", "maxSnapshotEntries"];
  for (const key of PRE_DISPATCH_KEYS) requireInteger(preDispatch[key], "E_MANIFEST_SHAPE", `resourcePolicy.preDispatch.${key}`);
  requireInteger(postParse.maxAstNodes, "E_MANIFEST_SHAPE", "resourcePolicy.postParse.maxAstNodes");
  for (const key of ["maxOldGenerationSizeMb", "maxYoungGenerationSizeMb", "stackSizeMb", "parserWallTimeoutMsPerSource", "ignoreWallTimeoutMsPerSnapshot"]) {
    requireInteger(worker[key], "E_MANIFEST_SHAPE", `resourcePolicy.worker.${key}`);
  }
  if (worker.concurrency !== 1) throw fail("E_MANIFEST_SHAPE", "resourcePolicy.worker.concurrency must be 1");
  if (worker.directFilesystemAccess !== false || worker.networkAccess !== false) {
    throw fail("E_MANIFEST_SHAPE", "the manifest must forbid worker filesystem and network access");
  }

  // Implementation-support checks: this build serves exactly one shape of each of these.
  requireExactly(worker.module, SUPPORTED.workerModule, "E_MANIFEST_UNSUPPORTED", "resourcePolicy.worker.module");
  requireExactly(policy.failureMode, SUPPORTED.failureMode, "E_MANIFEST_UNSUPPORTED", "resourcePolicy.failureMode");
  requireExactly(acornContract.sourceType, SUPPORTED.sourceType, "E_MANIFEST_UNSUPPORTED", "wrapperContract.acorn.sourceType");
  requireExactly(acornContract.rangeAuthority, SUPPORTED.rangeAuthority, "E_MANIFEST_UNSUPPORTED", "wrapperContract.acorn.rangeAuthority");
  requireExactly(ignoreContract.ignorecase, SUPPORTED.ignorecase, "E_MANIFEST_UNSUPPORTED", "wrapperContract.ignore.ignorecase");
  requireExactly(ignoreContract.allowRelativePaths, SUPPORTED.allowRelativePaths, "E_MANIFEST_UNSUPPORTED", "wrapperContract.ignore.allowRelativePaths");
  requireExactly(ignoreContract.authority, SUPPORTED.ignoreAuthority, "E_MANIFEST_UNSUPPORTED", "wrapperContract.ignore.authority");

  if (!Array.isArray(acornContract.unsupported) || acornContract.unsupported.length === 0) {
    throw fail("E_MANIFEST_SHAPE", "wrapperContract.acorn.unsupported must be a non-empty array");
  }
  for (const kind of acornContract.unsupported) requireString(kind, "E_MANIFEST_SHAPE", "wrapperContract.acorn.unsupported[]");

  // Every declared member is verified, not just the two that get executed: a tampered LICENSE is
  // still a tampered authorization packet, and loading half a capability is not a state this
  // wrapper is allowed to be in.
  const verifiedByPackage = new Map();
  for (const pkg of manifest.packages) {
    requireString(pkg.name, "E_MANIFEST_SHAPE", "package name");
    requireString(pkg.version, "E_MANIFEST_SHAPE", "package version");
    requireExactly(pkg.runtimeDependencies, SUPPORTED.runtimeDependencies, "E_MANIFEST_UNSUPPORTED", `package ${pkg.name} runtimeDependencies`);
    if (!Array.isArray(pkg.members) || pkg.members.length === 0) throw fail("E_MANIFEST_SHAPE", `package ${pkg.name} declares no members`);
    verifiedByPackage.set(pkg, pkg.members.map(verifyMember));
  }

  const parserPkg = findPackage(manifest, parserIdentity.parserId, parserIdentity.parserVersion, "E_IDENTITY_UNRESOLVED");
  const ignorePkg = findPackage(manifest, ignoreIdentity.engineId, ignoreIdentity.engineVersion, "E_IDENTITY_UNRESOLVED");
  const parserMember = selectRuntimeMember(parserPkg, verifiedByPackage.get(parserPkg));
  const ignoreMember = selectRuntimeMember(ignorePkg, verifiedByPackage.get(ignorePkg));

  const preDispatchCopy = {};
  for (const key of PRE_DISPATCH_KEYS) preDispatchCopy[key] = preDispatch[key];

  return deepFreeze({
    manifestPath: MANIFEST_PATH,
    identities: {
      parser: { implementationId: parserIdentity.implementationId, parserId: parserIdentity.parserId, parserVersion: parserIdentity.parserVersion },
      ignore: { engineId: ignoreIdentity.engineId, engineVersion: ignoreIdentity.engineVersion },
    },
    limits: { preDispatch: preDispatchCopy, maxAstNodes: postParse.maxAstNodes },
    worker: {
      resourceLimits: {
        maxOldGenerationSizeMb: worker.maxOldGenerationSizeMb,
        maxYoungGenerationSizeMb: worker.maxYoungGenerationSizeMb,
        stackSizeMb: worker.stackSizeMb,
      },
      parserTimeoutMs: worker.parserWallTimeoutMsPerSource,
      ignoreTimeoutMs: worker.ignoreWallTimeoutMsPerSnapshot,
    },
    acorn: { sourceType: acornContract.sourceType, unsupported: [...acornContract.unsupported], source: parserMember.bytes.toString("utf8") },
    ignore: { ignorecase: ignoreContract.ignorecase, allowRelativePaths: ignoreContract.allowRelativePaths, source: ignoreMember.bytes.toString("utf8") },
  });
}

// The one and only capability, built from the shipped manifest. There is no parameter here: an
// alternate manifest cannot be requested, so it can never reach this cache.
export function loadVendorCapability() {
  if (cachedCapability === null) cachedCapability = buildCapability();
  return cachedCapability;
}

// --- source normalization ---------------------------------------------------------------------------

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

// Normalizes to the canonical form the approved model hashes: UTF-8 without BOM, LF only. The
// order matters -- decode first, strip the BOM, then fold line endings -- so a CRLF file and its LF
// twin become byte-identical before any range is cut.
export function normalizeSource(sourceBytes, limits) {
  if (!(sourceBytes instanceof Uint8Array)) {
    throw fail("E_SOURCE_TYPE", "parseModuleSource accepts already-captured bytes (Buffer or Uint8Array); it never reads a path");
  }
  // Normalization only ever shrinks: BOM removal drops 3 bytes and CRLF folding halves each pair,
  // so nothing above twice the ceiling plus a BOM can possibly normalize down into range. This
  // bound rejects only inputs that could not have been legal anyway.
  const rawCeiling = limits.maxNormalizedSourceBytes * 2 + 3;
  if (sourceBytes.length > rawCeiling) {
    throw fail("E_SOURCE_TOO_LARGE", `raw source is ${sourceBytes.length} bytes, which cannot normalize under the authorized ceiling of ${limits.maxNormalizedSourceBytes}`, { rawBytes: sourceBytes.length, limit: limits.maxNormalizedSourceBytes });
  }

  let text;
  try { text = UTF8_DECODER.decode(sourceBytes); } catch {
    throw fail("E_UTF8", "source is not valid UTF-8");
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const normalized = Buffer.from(text, "utf8");
  if (normalized.length > limits.maxNormalizedSourceBytes) {
    throw fail("E_SOURCE_TOO_LARGE", `normalized source is ${normalized.length} bytes, over the authorized ceiling of ${limits.maxNormalizedSourceBytes}`, { normalizedBytes: normalized.length, limit: limits.maxNormalizedSourceBytes });
  }
  return { text, normalized };
}

const NOT_A_BOUNDARY = 0xffffffff;

// Acorn reports UTF-16 code-unit offsets. The approved model's spans are normalized UTF-8 byte
// offsets. This builds the explicit map between them, and marks the inside of a surrogate pair as
// no boundary at all so an astral character can never be cut in half.
export function buildByteOffsetMap(text) {
  const map = new Uint32Array(text.length + 1);
  let unit = 0;
  let byte = 0;
  for (const character of text) {
    map[unit] = byte;
    if (character.length === 2) map[unit + 1] = NOT_A_BOUNDARY;
    byte += Buffer.byteLength(character, "utf8");
    unit += character.length;
  }
  map[unit] = byte;
  return map;
}

export function byteOffsetAt(map, unitOffset) {
  if (!Number.isInteger(unitOffset) || unitOffset < 0 || unitOffset >= map.length) {
    throw fail("E_RANGE_BOUNDARY", `code-unit offset ${unitOffset} is outside the normalized source`);
  }
  const byte = map[unitOffset];
  if (byte === NOT_A_BOUNDARY) {
    throw fail("E_RANGE_BOUNDARY", `code-unit offset ${unitOffset} falls inside a surrogate pair and is not a byte boundary`);
  }
  return byte;
}

// --- gitignore input validation ------------------------------------------------------------------

const GITIGNORE_NAME = ".gitignore";

function assertCanonicalRelativePath(value, code, what) {
  if (typeof value !== "string" || value === "") throw fail(code, `${what} must be a non-empty string`);
  if (value.includes("\\")) throw fail(code, `${what} must use POSIX separators: ${value}`);
  if (/^[A-Za-z]:/.test(value)) throw fail(code, `${what} must not carry a drive prefix: ${value}`);
  if (value.startsWith("/")) throw fail(code, `${what} must be repository-relative: ${value}`);
  if (value.endsWith("/")) throw fail(code, `${what} must not end with a separator: ${value}`);
  const segments = value.split("/");
  for (const segment of segments) {
    if (segment === "") throw fail(code, `${what} contains an empty segment: ${value}`);
    if (segment === "." || segment === "..") throw fail(code, `${what} contains a ${segment} segment: ${value}`);
  }
  return segments;
}

// Counts what Git would treat as a rule. A blank or whitespace-only line is not one; an unescaped
// leading # is a comment; \# is an escaped hash and IS a rule; ! is a negation and IS a rule. A
// line ending in an odd run of backslashes has a dangling escape, which is never silently dropped.
export function parseGitignorePatterns(text, filePath, limits) {
  const patterns = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index];
    if (line.endsWith("\r")) line = line.slice(0, -1);
    const where = `${filePath}:${index + 1}`;

    let trailing = 0;
    for (let i = line.length - 1; i >= 0 && line[i] === "\\"; i -= 1) trailing += 1;
    if (trailing % 2 === 1) {
      throw fail("E_IGNORE_PATTERN", `${where} ends with a dangling backslash escape`, { path: filePath, line: index + 1 });
    }
    if (line.trim() === "") continue;
    if (line.startsWith("#")) continue;

    const bytes = Buffer.byteLength(line, "utf8");
    if (bytes > limits.maxGitignorePatternBytes) {
      throw fail("E_IGNORE_LIMIT", `${where} is ${bytes} bytes, over the authorized per-pattern ceiling of ${limits.maxGitignorePatternBytes}`, { path: filePath, line: index + 1, bytes, limit: limits.maxGitignorePatternBytes });
    }
    patterns.push(line);
  }
  return patterns;
}

export function prepareIgnoreSnapshot({ ignoreFiles, candidatePaths }, limits) {
  if (!Array.isArray(ignoreFiles)) throw fail("E_IGNORE_INPUT", "ignoreFiles must be an array");
  if (!Array.isArray(candidatePaths)) throw fail("E_IGNORE_INPUT", "candidatePaths must be an array");

  if (ignoreFiles.length > limits.maxGitignoreFiles) {
    throw fail("E_IGNORE_LIMIT", `${ignoreFiles.length} .gitignore files, over the authorized ceiling of ${limits.maxGitignoreFiles}`, { count: ignoreFiles.length, limit: limits.maxGitignoreFiles });
  }
  if (candidatePaths.length > limits.maxSnapshotEntries) {
    throw fail("E_IGNORE_LIMIT", `${candidatePaths.length} snapshot entries, over the authorized ceiling of ${limits.maxSnapshotEntries}`, { count: candidatePaths.length, limit: limits.maxSnapshotEntries });
  }

  const seenFiles = new Set();
  let totalBytes = 0;
  let totalPatterns = 0;
  const layers = [];
  for (const entry of ignoreFiles) {
    if (entry === null || typeof entry !== "object") throw fail("E_IGNORE_INPUT", "each ignoreFiles entry must be an object");
    const segments = assertCanonicalRelativePath(entry.path, "E_IGNORE_INPUT", "ignoreFiles[].path");
    if (segments[segments.length - 1] !== GITIGNORE_NAME) {
      throw fail("E_IGNORE_INPUT", `ignoreFiles[].path must name a ${GITIGNORE_NAME}: ${entry.path}`);
    }
    if (seenFiles.has(entry.path)) throw fail("E_IGNORE_INPUT", `duplicate ignoreFiles[].path: ${entry.path}`);
    seenFiles.add(entry.path);

    const depth = segments.length - 1;
    if (depth > limits.maxIgnoreLayerDepth) {
      throw fail("E_IGNORE_LIMIT", `${entry.path} sits ${depth} directories deep, over the authorized ceiling of ${limits.maxIgnoreLayerDepth}`, { path: entry.path, depth, limit: limits.maxIgnoreLayerDepth });
    }
    if (!(entry.bytes instanceof Uint8Array)) throw fail("E_IGNORE_INPUT", `ignoreFiles[].bytes must be Buffer or Uint8Array: ${entry.path}`);
    if (entry.bytes.length > limits.maxGitignoreFileBytes) {
      throw fail("E_IGNORE_LIMIT", `${entry.path} is ${entry.bytes.length} bytes, over the authorized per-file ceiling of ${limits.maxGitignoreFileBytes}`, { path: entry.path, bytes: entry.bytes.length, limit: limits.maxGitignoreFileBytes });
    }
    totalBytes += entry.bytes.length;
    if (totalBytes > limits.maxGitignoreTotalBytes) {
      throw fail("E_IGNORE_LIMIT", `.gitignore bytes total ${totalBytes}, over the authorized ceiling of ${limits.maxGitignoreTotalBytes}`, { totalBytes, limit: limits.maxGitignoreTotalBytes });
    }

    let text;
    try { text = UTF8_DECODER.decode(entry.bytes); } catch {
      throw fail("E_UTF8", `${entry.path} is not valid UTF-8`);
    }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const patterns = parseGitignorePatterns(text, entry.path, limits);
    totalPatterns += patterns.length;
    if (totalPatterns > limits.maxGitignorePatterns) {
      throw fail("E_IGNORE_LIMIT", `${totalPatterns} active patterns, over the authorized ceiling of ${limits.maxGitignorePatterns}`, { totalPatterns, limit: limits.maxGitignorePatterns });
    }
    layers.push({ dir: segments.slice(0, -1).join("/"), depth, path: entry.path, patterns });
  }

  const seenCandidates = new Set();
  for (const candidate of candidatePaths) {
    assertCanonicalRelativePath(candidate, "E_IGNORE_INPUT", "candidatePaths[]");
    if (seenCandidates.has(candidate)) throw fail("E_IGNORE_INPUT", `duplicate candidatePaths[] entry: ${candidate}`);
    seenCandidates.add(candidate);
  }

  // Root-to-leaf, with the declared path as a deterministic tie-break at equal depth.
  layers.sort((a, b) => (a.depth - b.depth) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { layers: layers.map(({ dir, patterns }) => ({ dir, patterns })), candidates: [...candidatePaths], activePatterns: totalPatterns, totalBytes };
}

// --- result validation ------------------------------------------------------------------------------

function exactKeys(value, expected, code, what) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw fail(code, `${what} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((k, i) => k !== wanted[i])) {
    throw fail(code, `${what} must declare exactly ${JSON.stringify(wanted)}; got ${JSON.stringify(actual)}`);
  }
}

// Assigns identity and byte spans, and re-derives the node count from the tree the coordinator can
// actually see. A worker claiming a count the AST does not support is a disagreement, not a hint.
function annotate(ast, map) {
  let ordinal = 0;
  const seen = new Set();
  const visit = (node) => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const item of node) visit(item); return; }
    if (typeof node.type !== "string") return;
    if (seen.has(node)) return;
    seen.add(node);

    if (!Number.isInteger(node.start) || !Number.isInteger(node.end) || node.end < node.start) {
      throw fail("E_WORKER_RESULT", `node ${node.type} carries an incoherent code-unit span`);
    }
    if (!Array.isArray(node.range) || node.range.length !== 2 || node.range[0] !== node.start || node.range[1] !== node.end) {
      throw fail("E_WORKER_RESULT", `node ${node.type} carries a range that disagrees with its start/end`);
    }
    node.nodeId = ordinal;
    ordinal += 1;
    node.byteStart = byteOffsetAt(map, node.start);
    node.byteEnd = byteOffsetAt(map, node.end);
    if (node.byteEnd < node.byteStart) throw fail("E_WORKER_RESULT", `node ${node.type} maps to a reversed byte span`);

    for (const key of Object.keys(node)) {
      if (key === "type" || key === "start" || key === "end" || key === "range" || key === "loc" || key === "nodeId" || key === "byteStart" || key === "byteEnd") continue;
      visit(node[key]);
    }
  };
  visit(ast);
  return ordinal;
}

// Pure validators over a worker's reply. They hold no authority -- every threshold is passed in --
// so exporting them for direct testing opens no override path into the public API.
export function validateParserResult({ result, map, maxAstNodes }) {
  exactKeys(result, ["kind", "ast", "nodeCount"], "E_WORKER_RESULT", "the parser worker result");
  if (result.kind !== "parse") throw fail("E_WORKER_RESULT", `the parser worker returned kind ${JSON.stringify(result.kind)}`);
  if (result.ast === null || typeof result.ast !== "object" || result.ast.type !== "Program") {
    throw fail("E_WORKER_RESULT", "the parser worker did not return a Program root");
  }
  if (!Number.isSafeInteger(result.nodeCount) || result.nodeCount <= 0) {
    throw fail("E_WORKER_RESULT", `the parser worker reported a nodeCount of ${JSON.stringify(result.nodeCount)}`);
  }
  if (result.nodeCount > maxAstNodes) {
    throw fail("E_AST_TOO_LARGE", `the parser worker returned ${result.nodeCount} nodes, over the authorized ceiling of ${maxAstNodes}`, { nodeCount: result.nodeCount, limit: maxAstNodes });
  }
  const annotated = annotate(result.ast, map);
  if (annotated !== result.nodeCount) {
    throw fail("E_WORKER_RESULT", `the parser worker reported ${result.nodeCount} nodes but the returned AST holds ${annotated}`, { reported: result.nodeCount, actual: annotated });
  }
  return annotated;
}

export function validateIgnoreResult({ result, candidates }) {
  exactKeys(result, ["kind", "results"], "E_WORKER_RESULT", "the ignore worker result");
  if (result.kind !== "ignore") throw fail("E_WORKER_RESULT", `the ignore worker returned kind ${JSON.stringify(result.kind)}`);
  if (!Array.isArray(result.results) || result.results.length !== candidates.length) {
    throw fail("E_WORKER_RESULT", "the ignore worker returned a different number of results than candidates");
  }
  result.results.forEach((entry, index) => {
    exactKeys(entry, ["path", "ignored"], "E_WORKER_RESULT", `ignore result ${index}`);
    if (entry.path !== candidates[index]) throw fail("E_WORKER_RESULT", `ignore result ${index} is out of order`);
    if (typeof entry.ignored !== "boolean") throw fail("E_WORKER_RESULT", `ignore result ${index} did not report a boolean`);
  });
  return result.results;
}

function rethrow(error) {
  if (error instanceof ParserIgnoreWrapperError) throw error;
  if (error instanceof WorkerRunnerError) throw fail(error.code, error.message, error.detail);
  throw fail("E_WRAPPER_INTERNAL", (error && error.message) || String(error));
}

// --- public API ------------------------------------------------------------------------------------

function refuseExtraArguments(count, name) {
  if (count > 1) throw fail("E_API_ARGUMENTS", `${name} takes exactly one argument; overriding the manifest, the worker entry, the execArgv set or the timeout is not supported`);
}

export async function parseModuleSource(sourceBytes) {
  refuseExtraArguments(arguments.length, "parseModuleSource");
  const vendor = loadVendorCapability();
  const { text, normalized } = normalizeSource(sourceBytes, vendor.limits.preDispatch);
  const map = buildByteOffsetMap(text);
  try {
    const result = await runWorkerJob({
      workerData: {
        kind: "parse",
        acornSource: vendor.acorn.source,
        source: text,
        settings: { sourceType: vendor.acorn.sourceType, unsupported: [...vendor.acorn.unsupported] },
        limits: { maxAstNodes: vendor.limits.maxAstNodes },
      },
      resourceLimits: vendor.worker.resourceLimits,
      timeoutMs: vendor.worker.parserTimeoutMs,
      execArgv: resolveExecArgv(),
    });

    validateParserResult({ result, map, maxAstNodes: vendor.limits.maxAstNodes });
    return {
      ast: result.ast,
      nodeCount: result.nodeCount,
      normalizedSourceBytes: normalized,
      normalizedByteLength: normalized.length,
      sourceType: vendor.acorn.sourceType,
      identity: { ...vendor.identities.parser },
    };
  } catch (error) { return rethrow(error); }
}

export async function matchGitignoreSnapshot(input) {
  refuseExtraArguments(arguments.length, "matchGitignoreSnapshot");
  const vendor = loadVendorCapability();
  if (input === null || typeof input !== "object") throw fail("E_IGNORE_INPUT", "matchGitignoreSnapshot expects { ignoreFiles, candidatePaths }");
  const prepared = prepareIgnoreSnapshot(input, vendor.limits.preDispatch);

  // An empty snapshot is a legitimate answer to a legitimate question, not malformed input. The
  // capability has already been verified above, so the integrity guarantee still holds.
  if (prepared.candidates.length === 0) {
    return { results: [], activePatterns: prepared.activePatterns, layerCount: prepared.layers.length, identity: { ...vendor.identities.ignore } };
  }

  try {
    const result = await runWorkerJob({
      workerData: {
        kind: "ignore",
        ignoreSource: vendor.ignore.source,
        layers: prepared.layers,
        candidates: prepared.candidates,
        settings: { ignorecase: vendor.ignore.ignorecase, allowRelativePaths: vendor.ignore.allowRelativePaths },
      },
      resourceLimits: vendor.worker.resourceLimits,
      timeoutMs: vendor.worker.ignoreTimeoutMs,
      execArgv: resolveExecArgv(),
    });

    validateIgnoreResult({ result, candidates: prepared.candidates });
    return {
      results: result.results,
      activePatterns: prepared.activePatterns,
      layerCount: prepared.layers.length,
      identity: { ...vendor.identities.ignore },
    };
  } catch (error) { return rethrow(error); }
}
