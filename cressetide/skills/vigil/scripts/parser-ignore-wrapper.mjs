// Least-authority wrapper around the vendored Acorn parser and ignore engine.
//
// SCOPE: this is the dependency-wrapper layer and nothing else. It does not discover test
// declarations, classify node:test or node:assert bindings, analyse scope, read attachment tags,
// compute stableId/structuralId/oracle closures, select adapters, enumerate a worktree, or produce
// any inventory. Those remain unimplemented, and nothing here should be read as claiming the
// parser component, a populated inventory, or Phase 2 is ready.
//
// AUTHORITY: cressetide/skills/vigil/vendor/vendor-manifest.json is the single machine-readable
// source for identities, member targets, hashes, wrapper settings and resource limits. This file
// reads every one of those from the manifest and restates none of them; the ADR and the approved
// specs are human governance records and are never parsed here.
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
const MANIFEST_PATH = path.join(VENDOR_DIR, "vendor-manifest.json");

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

// A member target must resolve inside the shipped vendor directory. Absolute paths, backslashes,
// drive prefixes and any traversal are rejected before the path is used, not after.
function resolveMemberTarget(target) {
  if (typeof target !== "string" || target === "") throw fail("E_MEMBER_PATH", "member target must be a non-empty string");
  if (target.includes("\\")) throw fail("E_MEMBER_PATH", `member target must use POSIX separators: ${target}`);
  if (path.posix.isAbsolute(target) || /^[A-Za-z]:/.test(target)) throw fail("E_MEMBER_PATH", `member target must be repository-relative: ${target}`);
  if (path.posix.normalize(target) !== target) throw fail("E_MEMBER_PATH", `member target must already be canonical: ${target}`);
  const absolute = path.resolve(VENDOR_DIR, path.posix.basename(target) === target ? target : target.split("/").slice(-999).join(path.sep));
  // Resolve through the repository root so the declared path -- not just its basename -- is checked.
  const repoRoot = path.resolve(VENDOR_DIR, "..", "..", "..", "..");
  const viaRepo = path.resolve(repoRoot, target);
  const relative = path.relative(VENDOR_DIR, viaRepo);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw fail("E_MEMBER_PATH", `member target escapes the vendor directory: ${target}`);
  }
  void absolute;
  return viaRepo;
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
  return { ...member, absolute, bytes };
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

let cachedVendor = null;

export function loadVendorCapability({ manifestPath = MANIFEST_PATH, cache = true } = {}) {
  if (cache && cachedVendor !== null) return cachedVendor;

  let raw;
  try { raw = fs.readFileSync(manifestPath, "utf8"); } catch {
    throw fail("E_MANIFEST_UNREADABLE", `the shipped vendor manifest is unreadable: ${manifestPath}`);
  }
  let manifest;
  try { manifest = JSON.parse(raw); } catch (e) {
    throw fail("E_MANIFEST_SHAPE", `the shipped vendor manifest is not valid JSON: ${e.message}`);
  }
  requireObject(manifest, "E_MANIFEST_SHAPE", "manifest root");
  const authorization = requireObject(manifest.authorization, "E_MANIFEST_SHAPE", "manifest.authorization");
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
  requireString(parserIdentity.implementationId, "E_MANIFEST_SHAPE", "implementationId");

  const policy = requireObject(manifest.resourcePolicy, "E_MANIFEST_SHAPE", "manifest.resourcePolicy");
  const preDispatch = requireObject(policy.preDispatch, "E_MANIFEST_SHAPE", "resourcePolicy.preDispatch");
  const postParse = requireObject(policy.postParse, "E_MANIFEST_SHAPE", "resourcePolicy.postParse");
  const worker = requireObject(policy.worker, "E_MANIFEST_SHAPE", "resourcePolicy.worker");
  const contract = requireObject(manifest.wrapperContract, "E_MANIFEST_SHAPE", "manifest.wrapperContract");
  const acornContract = requireObject(contract.acorn, "E_MANIFEST_SHAPE", "wrapperContract.acorn");
  const ignoreContract = requireObject(contract.ignore, "E_MANIFEST_SHAPE", "wrapperContract.ignore");

  for (const key of ["maxNormalizedSourceBytes", "maxGitignoreFileBytes", "maxGitignoreTotalBytes", "maxGitignoreFiles", "maxGitignorePatterns", "maxGitignorePatternBytes", "maxIgnoreLayerDepth", "maxSnapshotEntries"]) {
    requireInteger(preDispatch[key], "E_MANIFEST_SHAPE", `resourcePolicy.preDispatch.${key}`);
  }
  requireInteger(postParse.maxAstNodes, "E_MANIFEST_SHAPE", "resourcePolicy.postParse.maxAstNodes");
  for (const key of ["maxOldGenerationSizeMb", "maxYoungGenerationSizeMb", "stackSizeMb", "parserWallTimeoutMsPerSource", "ignoreWallTimeoutMsPerSnapshot"]) {
    requireInteger(worker[key], "E_MANIFEST_SHAPE", `resourcePolicy.worker.${key}`);
  }
  if (worker.concurrency !== 1) throw fail("E_MANIFEST_SHAPE", "resourcePolicy.worker.concurrency must be 1");
  if (worker.directFilesystemAccess !== false || worker.networkAccess !== false) {
    throw fail("E_MANIFEST_SHAPE", "the manifest must forbid worker filesystem and network access");
  }
  if (acornContract.sourceType !== "module") {
    throw fail("E_MANIFEST_UNSUPPORTED", `wrapperContract.acorn.sourceType is ${JSON.stringify(acornContract.sourceType)}; this build only implements "module"`);
  }
  if (!Array.isArray(acornContract.unsupported) || acornContract.unsupported.length === 0) {
    throw fail("E_MANIFEST_SHAPE", "wrapperContract.acorn.unsupported must be a non-empty array");
  }
  if (typeof ignoreContract.ignorecase !== "boolean" || typeof ignoreContract.allowRelativePaths !== "boolean") {
    throw fail("E_MANIFEST_SHAPE", "wrapperContract.ignore must declare boolean ignorecase and allowRelativePaths");
  }

  // Every declared member is verified, not just the two that get executed: a tampered LICENSE is
  // still a tampered authorization packet, and loading half a capability is not a state this
  // wrapper is allowed to be in.
  const verifiedByPackage = new Map();
  for (const pkg of manifest.packages) {
    requireString(pkg.name, "E_MANIFEST_SHAPE", "package name");
    requireString(pkg.version, "E_MANIFEST_SHAPE", "package version");
    if (!Array.isArray(pkg.members) || pkg.members.length === 0) throw fail("E_MANIFEST_SHAPE", `package ${pkg.name} declares no members`);
    verifiedByPackage.set(pkg, pkg.members.map(verifyMember));
  }

  const parserPkg = findPackage(manifest, parserIdentity.parserId, parserIdentity.parserVersion, "E_IDENTITY_UNRESOLVED");
  const ignorePkg = findPackage(manifest, ignoreIdentity.engineId, ignoreIdentity.engineVersion, "E_IDENTITY_UNRESOLVED");
  const parserMember = selectRuntimeMember(parserPkg, verifiedByPackage.get(parserPkg));
  const ignoreMember = selectRuntimeMember(ignorePkg, verifiedByPackage.get(ignorePkg));

  const capability = {
    manifestPath,
    identities: { parser: parserIdentity, ignore: ignoreIdentity },
    limits: {
      preDispatch: { ...preDispatch },
      maxAstNodes: postParse.maxAstNodes,
    },
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
  };
  if (cache) cachedVendor = capability;
  return capability;
}

export function resetVendorCache() { cachedVendor = null; }

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
  if (candidatePaths.length === 0) throw fail("E_IGNORE_INPUT", "candidatePaths must not be empty");

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

// --- public API ------------------------------------------------------------------------------------

// Mirrors the worker's traversal, seen-set included: a node object the parser reused in two
// positions is one node and gets one identity, assigned on first visit in pre-order.
function annotate(ast, map) {
  let ordinal = 0;
  const seen = new Set();
  const visit = (node) => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const item of node) visit(item); return; }
    if (typeof node.type !== "string") return;
    if (seen.has(node)) return;
    seen.add(node);
    node.nodeId = ordinal;
    ordinal += 1;
    node.byteStart = byteOffsetAt(map, node.start);
    node.byteEnd = byteOffsetAt(map, node.end);
    for (const key of Object.keys(node)) {
      if (key === "type" || key === "start" || key === "end" || key === "range" || key === "loc" || key === "nodeId" || key === "byteStart" || key === "byteEnd") continue;
      visit(node[key]);
    }
  };
  visit(ast);
  return ordinal;
}

function rethrow(error) {
  if (error instanceof ParserIgnoreWrapperError) throw error;
  if (error instanceof WorkerRunnerError) throw fail(error.code, error.message, error.detail);
  throw fail("E_WRAPPER_INTERNAL", (error && error.message) || String(error));
}

export async function parseModuleSource(sourceBytes, options = {}) {
  const vendor = options.vendor ?? loadVendorCapability();
  const { text, normalized } = normalizeSource(sourceBytes, vendor.limits.preDispatch);
  const map = buildByteOffsetMap(text);
  try {
    const result = await runWorkerJob({
      workerData: {
        kind: "parse",
        acornSource: vendor.acorn.source,
        source: text,
        settings: { sourceType: vendor.acorn.sourceType, unsupported: vendor.acorn.unsupported },
        limits: { maxAstNodes: vendor.limits.maxAstNodes },
      },
      resourceLimits: vendor.worker.resourceLimits,
      timeoutMs: options.timeoutMs ?? vendor.worker.parserTimeoutMs,
      execArgv: options.execArgv ?? resolveExecArgv(),
      workerSource: options.workerSource,
    });
    if (result.kind !== "parse" || result.ast === null || typeof result.ast !== "object") {
      throw fail("E_WORKER_RESULT", "the parser worker returned an unexpected result shape");
    }
    const annotated = annotate(result.ast, map);
    return {
      ast: result.ast,
      nodeCount: result.nodeCount,
      annotatedNodes: annotated,
      normalizedBytes: normalized.length,
      sourceType: vendor.acorn.sourceType,
      identity: { ...vendor.identities.parser },
    };
  } catch (error) { return rethrow(error); }
}

export async function matchGitignoreSnapshot(input, options = {}) {
  const vendor = options.vendor ?? loadVendorCapability();
  if (input === null || typeof input !== "object") throw fail("E_IGNORE_INPUT", "matchGitignoreSnapshot expects { ignoreFiles, candidatePaths }");
  const prepared = prepareIgnoreSnapshot(input, vendor.limits.preDispatch);
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
      timeoutMs: options.timeoutMs ?? vendor.worker.ignoreTimeoutMs,
      execArgv: options.execArgv ?? resolveExecArgv(),
      workerSource: options.workerSource,
    });
    if (result.kind !== "ignore" || !Array.isArray(result.results)) {
      throw fail("E_WORKER_RESULT", "the ignore worker returned an unexpected result shape");
    }
    if (result.results.length !== prepared.candidates.length) {
      throw fail("E_WORKER_RESULT", "the ignore worker returned a different number of results than candidates");
    }
    result.results.forEach((entry, index) => {
      if (entry.path !== prepared.candidates[index] || typeof entry.ignored !== "boolean") {
        throw fail("E_WORKER_RESULT", `the ignore worker returned result ${index} out of order or malformed`);
      }
    });
    return {
      results: result.results,
      activePatterns: prepared.activePatterns,
      layerCount: prepared.layers.length,
      identity: { ...vendor.identities.ignore },
    };
  } catch (error) { return rethrow(error); }
}
