// AdapterContentView: the one carrier an adapter is ever handed, and the two projections that build
// it. Approved test-provenance v1.12, section 11b.10.
//
// WHY IT IS ITS OWN MODULE. The view has to be the SAME branded object on both sides. If the
// node:test adapter branded one shape and the discovery preimage branded another, an object accepted
// by one would be refused by the other and "the adapter reads the captured view" would stop meaning
// anything. So the brand, the carrier and both projections live here, and node-test-adapter.mjs
// imports them rather than keeping a second WeakSet.
//
// WHAT THE CARRIER DELIBERATELY DOES NOT EXPOSE. entry() is exactly { mode, type }. `tracked` stays
// with HeadViewSnapshot, where 11b.4d needs it to decide config-carrier validity; `contentDigest`
// stays with headViewDigest. Neither is an adapter input, and putting either here would invite an
// adapter to compute freshness or carrier validity it has no authority over.
//
// LOOKUP IS TWO STEPS, NEVER ONE. First a purely lexical check on the argument's shape, then an
// exact Unicode code-point key lookup. They are separate because merging them is what the v1.12
// remediation had to unpick: a path whose case differs from a key in the view is perfectly canonical
// -- deciding otherwise would require folding the case first, which this contract forbids -- so it
// is simply absent, and absent is has() === false.
//
// WHAT THIS MODULE IS NOT. It builds no inventory, matches nothing between base and head, classifies
// no status, emits no artifact and writes nothing anywhere. A green run of this file satisfies
// AC118, AC136, AC137 and AC138 not at all and does not lift the unsupported-populated-inventory
// gate.
import cp from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { requireHeadViewSnapshot } from "./head-view-snapshot.mjs";
import { compareCodePoint } from "./provenance-store.mjs";

const execFile = promisify(cp.execFile);

export class AdapterContentViewError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = "AdapterContentViewError";
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

const fail = (code, message, detail) => new AdapterContentViewError(code, message, detail);

// 11b.10's closed mode -> type mapping. 160000 (a gitlink) and anything else is refused rather than
// guessed: a submodule is a second repository, and this model has no way to say that.
const MODE_TYPE = new Map([
  ["100644", "blob"],
  ["100755", "blob"],
  ["120000", "symlink"],
]);

const GIT_TIMEOUT_MS = 120_000;
const GIT_MAX_BUFFER = 256 * 1024 * 1024;

// --- canonical path grammar (step 1: lexical only) -------------------------------------------------

// Validity is a property of the STRING, never of the view. Nothing here consults membership, and
// nothing here normalises, case-folds or applies OS path repair -- a caller that hands in a path
// which "would have matched after repair" gets a refusal, not a match.
export function requireCanonicalViewPath(value, what) {
  if (typeof value !== "string" || value === "") {
    throw fail("E_PATH", `${what} must be a non-empty repo-relative path string`);
  }
  if (value.includes("\\")) throw fail("E_PATH", `${what} contains a backslash; the separator is "/": ${value}`);
  if (value.startsWith("/")) throw fail("E_PATH", `${what} is absolute; the path is repo-relative: ${value}`);
  if (/^[A-Za-z]:/.test(value)) throw fail("E_PATH", `${what} begins with a drive letter; the path is repo-relative: ${value}`);
  if (value.includes("\u0000")) throw fail("E_PATH", `${what} contains U+0000, which no Git tree path may carry`);
  for (const segment of value.split("/")) {
    if (segment === "") throw fail("E_PATH", `${what} has an empty path segment: ${value}`);
    if (segment === "." || segment === "..") throw fail("E_PATH", `${what} contains a ${JSON.stringify(segment)} segment: ${value}`);
  }
  return value;
}

// --- the carrier -----------------------------------------------------------------------------------

// Identity, not shape. Membership of this set is the only thing that makes an object a view, and a
// WeakSet cannot be copied, spread or hand-written, so a look-alike carrying the same five members
// is still not a view.
const VIEWS = new WeakSet();

function normaliseEntry(pathText, value, what) {
  // Two accepted spellings, one meaning. `bytes` alone is the long-standing adapter primitive and
  // means an ordinary blob; { mode, bytes } is what the projections below supply.
  let mode;
  let bytes;
  if (value instanceof Uint8Array) {
    mode = "100644";
    bytes = value;
  } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const keys = Object.keys(value).sort();
    if (keys.length !== 2 || keys[0] !== "bytes" || keys[1] !== "mode") {
      throw fail("E_VIEW_INPUT", `${what} ${pathText} must be bytes, or exactly { mode, bytes }; got ${JSON.stringify(keys)}`);
    }
    mode = value.mode;
    bytes = value.bytes;
  } else {
    throw fail("E_VIEW_INPUT", `${what} ${pathText} must carry Buffer/Uint8Array bytes, or exactly { mode, bytes }`);
  }
  if (typeof mode !== "string" || !MODE_TYPE.has(mode)) {
    throw fail("E_UNSUPPORTED_ENTRY",
      `${what} ${pathText} carries mode ${JSON.stringify(mode)}, which is outside the closed model `
      + "(100644 and 100755 are blobs, 120000 is a symlink; 160000 gitlinks and everything else are refused)",
      { path: pathText, mode });
  }
  if (!(bytes instanceof Uint8Array)) throw fail("E_VIEW_INPUT", `${what} ${pathText} must carry Buffer or Uint8Array bytes`);
  return { mode, type: MODE_TYPE.get(mode), bytes: Buffer.from(bytes) };
}

/**
 * Build a branded, immutable AdapterContentView.
 *
 * @param {Map|Array|object} entries path -> bytes, or path -> { mode, bytes }.
 * @returns {Readonly<object>} the view; the only object the adapters will accept.
 */
export function createAdapterContentView(entries) {
  if (arguments.length > 1) throw fail("E_API_ARGUMENTS", "createAdapterContentView takes exactly one argument");
  const source = entries instanceof Map ? entries.entries()
    : Array.isArray(entries) ? entries
      : entries !== null && typeof entries === "object" ? Object.entries(entries)
        : null;
  if (source === null) {
    throw fail("E_VIEW_INPUT", "createAdapterContentView expects a Map, an array of [path, value] pairs, or a plain object");
  }

  const files = new Map();
  for (const pair of source) {
    if (!Array.isArray(pair) || pair.length !== 2) throw fail("E_VIEW_INPUT", "each view entry must be a [path, value] pair");
    const [entryPath, value] = pair;
    requireCanonicalViewPath(entryPath, "view entry path");
    if (files.has(entryPath)) throw fail("E_VIEW_INPUT", `duplicate view entry: ${entryPath}`);
    files.set(entryPath, normaliseEntry(entryPath, value, "view entry"));
  }

  const paths = Object.freeze([...files.keys()].sort(compareCodePoint));
  const records = new Map();
  for (const [p, e] of files) records.set(p, Object.freeze({ mode: e.mode, type: e.type }));

  // Step 1 for every accessor: the argument's shape. A non-canonical argument is refused by all
  // three, so "has() said false" can never mean "the caller spelled it in a way we quietly fixed".
  const lookup = (candidate, what) => {
    requireCanonicalViewPath(candidate, what);
    return files.get(candidate);
  };

  const view = Object.freeze({
    size: files.size,
    paths: () => paths,
    // Step 2: exact Unicode code-point key matching. A canonical path with no exact key is absent,
    // full stop -- no search for a differently-cased near miss, no repair, no second guess.
    has: (candidate) => lookup(candidate, "has() path") !== undefined,
    entry: (candidate) => {
      const found = lookup(candidate, "entry() path");
      if (found === undefined) {
        throw fail("E_PATH_MISSING", `the captured view holds no entry at ${candidate}`, { path: candidate });
      }
      return records.get(candidate);
    },
    // A copy per read: whatever a caller does to the buffer it gets back, the next read is
    // unaffected. A symlink's bytes are its link target, and following it is never an option.
    read: (candidate) => {
      const found = lookup(candidate, "read() path");
      if (found === undefined) {
        throw fail("E_PATH_MISSING", `the captured view holds no entry at ${candidate}`, { path: candidate });
      }
      return Buffer.from(found.bytes);
    },
  });
  // Branded only once it is complete and frozen, so a half-built object is never a view.
  VIEWS.add(view);
  return view;
}

export function isAdapterContentView(value) {
  return value !== null && typeof value === "object" && VIEWS.has(value);
}

export function requireAdapterContentView(value, what) {
  if (!isAdapterContentView(value)) {
    throw fail("E_VIEW_INPUT",
      `${what} must be the exact object a projection returned; a copy, a spread, a clone or a look-alike is not a captured view`);
  }
  return value;
}

// --- Git isolation for the base projection ----------------------------------------------------------
//
// The base side reads the object database, and the object database is exactly what these variables
// can move. GIT_DIR, GIT_OBJECT_DIRECTORY and the alternates list decide which store answers, and a
// config include expanded through "~" can reach into a repository-local config the caller does not
// own. The scrub below mirrors the principles HeadViewSnapshot established for the head side.
//
// KNOWN DUPLICATION, deliberately not resolved here: head-view-snapshot.mjs holds a related scrub as
// module-private code. The two are no longer identical -- the base side additionally has to close
// object REPLACEMENT and lazy fetching, neither of which can reach a head view built from worktree
// bytes -- so unifying them now would mean merging two rule sets that have genuinely diverged.
// Recorded as a follow-up rather than hidden.
const GIT_REDIRECT_VARIABLES = new Set([
  "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_CEILING_DIRECTORIES",
]);
const HOME_VARIABLES = ["HOME", "USERPROFILE", "XDG_CONFIG_HOME", "HOMEDRIVE", "HOMEPATH"];

// Variables this module PINS rather than inherits. They are dropped case-insensitively during the
// copy below and then written back with the one value that is correct here, so an inherited "",
// "0", "false" or a lower/mixed-case spelling cannot survive to weaken the setting. Windows treats
// environment names case-blind, so dropping by name alone would leave a second key behind and let
// the child pick either one.
//
// GIT_NO_REPLACE_OBJECTS closes refs/replace. Without it, `baseTreeOid` names a tree and Git hands
//   back a DIFFERENT one: a replacement ref installed for that object silently redirects every
//   cat-file and ls-tree, so the "exact immutable Git tree" §11b.10 requires would be whatever the
//   repository's replace refs currently point at. Measured on git 2.55.0.windows.3: with tree A
//   replaced by tree B, capturing A returned B's paths and bytes end to end.
// GIT_NO_LAZY_FETCH closes partial-clone demand fetching. Without it, a missing promisor object
//   makes Git contact the remote, download it and WRITE it into .git/objects -- turning a read of
//   the object database into a network operation and a mutation of the repository. A base capture
//   that has to fetch has not observed the repository; it has changed it. Measured: two extra packs
//   appeared and a blob that was provably absent became present.
const PINNED_VARIABLES = ["GIT_OPTIONAL_LOCKS", "GIT_NO_REPLACE_OBJECTS", "GIT_NO_LAZY_FETCH"];
const EMPTY_GIT_CONFIG_FILE = "/dev/null";

// A fresh, valid, absolute path that does not exist and is never created, rooted at the filesystem
// root of the repository itself rather than anywhere the caller can steer through TEMP.
function newControlledHome(canonicalRepoRoot) {
  return path.join(path.parse(canonicalRepoRoot).root, `ctide-base-view-no-home-${crypto.randomUUID()}`);
}

function gitEnvironment(controlledHome) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    const upper = key.toUpperCase();
    if (GIT_REDIRECT_VARIABLES.has(upper)) continue;
    if (upper === "GIT_CONFIG" || upper.startsWith("GIT_CONFIG_")) continue;
    if (HOME_VARIABLES.includes(upper)) continue;
    if (PINNED_VARIABLES.includes(upper)) continue;
    env[key] = value;
  }
  env.GIT_OPTIONAL_LOCKS = "0";
  // Pinned to "1", never merely "set": Git reads both as booleans, and an inherited "0" or "false"
  // left in place would read as OFF.
  env.GIT_NO_REPLACE_OBJECTS = "1";
  env.GIT_NO_LAZY_FETCH = "1";
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = EMPTY_GIT_CONFIG_FILE;
  env.HOME = controlledHome;
  env.USERPROFILE = controlledHome;
  env.XDG_CONFIG_HOME = controlledHome;
  const drive = /^[A-Za-z]:/.test(controlledHome) ? controlledHome.slice(0, 2) : "";
  env.HOMEDRIVE = drive;
  env.HOMEPATH = drive === "" ? controlledHome : controlledHome.slice(2);
  return env;
}

async function git(cwd, args, environment) {
  let result;
  try {
    result = await execFile("git", args, {
      cwd,
      env: environment,
      encoding: "buffer",
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      shell: false,
      windowsHide: true,
    });
  } catch (error) {
    const stderr = error && error.stderr ? error.stderr.toString("utf8").trim() : "";
    throw fail("E_GIT_FAILED", `git ${args[0]} failed: ${stderr || (error && error.message) || "unknown error"}`,
      { args: args.slice(0, 2), stderr });
  }
  return result.stdout;
}

function canonicalRepoRoot(repoRoot) {
  if (typeof repoRoot !== "string" || repoRoot === "") throw fail("E_REPO_ROOT", "repoRoot must be a non-empty path string");
  let requested;
  try { requested = path.resolve(fs.realpathSync.native(repoRoot)); } catch {
    throw fail("E_REPO_ROOT", `repoRoot does not resolve to an existing directory: ${repoRoot}`);
  }
  let stat;
  try { stat = fs.lstatSync(requested); } catch {
    throw fail("E_REPO_ROOT", `repoRoot is not readable: ${repoRoot}`);
  }
  if (!stat.isDirectory()) throw fail("E_REPO_ROOT", `repoRoot is not a directory: ${repoRoot}`);
  return requested;
}

function splitNul(buffer, what) {
  const records = [];
  let start = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    if (buffer[i] !== 0) continue;
    records.push(buffer.subarray(start, i));
    start = i + 1;
  }
  if (start !== buffer.length) throw fail("E_GIT_OUTPUT", `${what} did not end at a NUL boundary`);
  return records;
}

const UTF8 = new TextDecoder("utf-8", { fatal: true });

function decodePath(bytes, what) {
  try { return UTF8.decode(bytes); } catch {
    throw fail("E_GIT_OUTPUT", `${what} is not valid UTF-8`);
  }
}

// --- base projection ---------------------------------------------------------------------------------

const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * The base AdapterContentView: every leaf of the EXACT tree the OID names.
 *
 * @param {{ repoRoot: string, baseTreeOid: string }} request exact key set.
 */
export async function captureBaseAdapterContentView(request) {
  if (arguments.length !== 1) {
    throw fail("E_API_ARGUMENTS", "captureBaseAdapterContentView takes exactly one argument; a git executable, an environment, a filesystem adapter or a prebuilt view cannot be supplied");
  }
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    throw fail("E_API_ARGUMENTS", "captureBaseAdapterContentView expects a request object");
  }
  const keys = Object.keys(request).sort();
  if (keys.length !== 2 || keys[0] !== "baseTreeOid" || keys[1] !== "repoRoot") {
    throw fail("E_API_ARGUMENTS", `captureBaseAdapterContentView expects exactly ["baseTreeOid","repoRoot"]; got ${JSON.stringify(keys)}`);
  }
  const { repoRoot, baseTreeOid } = request;

  // Shared v1.14, lexical half. A full, lowercase hex object ID and nothing else -- an abbreviation,
  // a ref, HEAD, a branch name or any revision expression is refused here rather than resolved,
  // because resolving one would let the caller name a different tree than the one they wrote down.
  if (typeof baseTreeOid !== "string" || !OID.test(baseTreeOid)) {
    throw fail("E_BASE_TREE_OID",
      `baseTreeOid must be 40 or 64 lowercase hex; got ${JSON.stringify(baseTreeOid)}. `
      + "An abbreviated OID, a ref name or a revision expression is refused rather than resolved",
      { baseTreeOid });
  }

  const root = canonicalRepoRoot(repoRoot);
  const environment = gitEnvironment(newControlledHome(root));

  // Shared v1.14, repository-semantic half, in order.
  const format = (await git(root, ["rev-parse", "--show-object-format"], environment)).toString("utf8").trim();
  const expected = format === "sha256" ? 64 : 40;
  if (baseTreeOid.length !== expected) {
    throw fail("E_BASE_TREE_OID",
      `baseTreeOid is ${baseTreeOid.length} hex characters but this repository's object format is ${format}, which uses ${expected}`,
      { baseTreeOid, format });
  }
  // The object's OWN type, never what it can be peeled to. A commit and a tag both peel to a tree
  // and both are refused: "the tree this commit points at" is a different witness than "this tree".
  let type;
  try {
    type = (await git(root, ["cat-file", "-t", baseTreeOid], environment)).toString("utf8").trim();
  } catch (error) {
    throw fail("E_BASE_TREE_OID", `baseTreeOid ${baseTreeOid} is not an object in this repository`, { baseTreeOid, cause: error && error.code });
  }
  if (type !== "tree") {
    throw fail("E_BASE_TREE_OID",
      `baseTreeOid ${baseTreeOid} is a ${type}, not a tree; an object that merely PEELS to a tree is not the tree`,
      { baseTreeOid, type });
  }

  // -r recurses into subtrees and, without -t, lists only leaves, so a directory never becomes a
  // path entry. --full-tree makes the listing independent of any working directory.
  const listing = await git(root, ["ls-tree", "-r", "-z", "--full-tree", baseTreeOid], environment);
  const entries = new Map();
  for (const record of splitNul(listing, "git ls-tree -r -z")) {
    if (record.length === 0) continue;
    const tab = record.indexOf(0x09);
    if (tab < 0) throw fail("E_GIT_OUTPUT", "an ls-tree record carries no tab separator");
    const head = record.subarray(0, tab).toString("utf8").split(" ");
    if (head.length !== 3) throw fail("E_GIT_OUTPUT", `an ls-tree header is malformed: ${JSON.stringify(head.join(" "))}`);
    const [mode, objectType, oid] = head;
    const entryPath = requireCanonicalViewPath(decodePath(record.subarray(tab + 1), "a tree path"), "a tree path");
    if (mode === "160000" || objectType === "commit") {
      throw fail("E_UNSUPPORTED_ENTRY", `${entryPath} is a gitlink (submodule); the closed model does not cover submodules`, { path: entryPath, mode });
    }
    if (!MODE_TYPE.has(mode)) {
      throw fail("E_UNSUPPORTED_ENTRY", `${entryPath} carries tree mode ${mode}, which is outside the closed model`, { path: entryPath, mode });
    }
    if (entries.has(entryPath)) throw fail("E_PATH_COLLISION", `${entryPath} appears twice in the tree listing`);
    entries.set(entryPath, { mode, oid });
  }

  // Bytes come from the object database by OID. Nothing is checked out and no file of the same name
  // in the working tree is ever opened, so a dirty worktree cannot change what the base view says.
  const built = new Map();
  for (const [entryPath, entry] of entries) {
    let bytes;
    try {
      bytes = await git(root, ["cat-file", "blob", entry.oid], environment);
    } catch (error) {
      // Structural, not string-matched: ls-tree has just named this OID as a leaf of this tree, and
      // replacement and lazy fetching are both closed above. A read that still fails therefore means
      // the local object database will not yield the object -- the ordinary case being a partial
      // clone whose promisor blob was never downloaded. That is reported as its own fact, because
      // "the repository does not have these bytes" and "we fetched them for you" must never be the
      // same outcome. The underlying git stderr is preserved rather than replaced.
      throw fail("E_OBJECT_UNAVAILABLE",
        `the local object database does not yield ${entry.oid} for ${entryPath}; the base capture will not fetch it, `
        + "so a partial clone missing this promisor object is refused rather than completed over the network",
        { path: entryPath, oid: entry.oid, stderr: error && error.detail ? error.detail.stderr : undefined });
    }
    built.set(entryPath, { mode: entry.mode, bytes });
  }
  return createAdapterContentView(built);
}

// --- head projection -----------------------------------------------------------------------------------

/**
 * The head AdapterContentView: a projection of the S1 snapshot the caller already captured.
 *
 * Nothing here enumerates, stats, probes Git or reads the filesystem a second time, and nothing
 * re-applies a filter: the head universe was decided when S1 was taken.
 *
 * @param {object} snapshot the S1 snapshot handed to withStableHeadView's evaluate callback.
 */
export function projectHeadAdapterContentView(snapshot) {
  if (arguments.length !== 1) throw fail("E_API_ARGUMENTS", "projectHeadAdapterContentView takes exactly one argument");
  // IDENTITY, NOT SHAPE. This function turns whatever it is handed into a branded
  // AdapterContentView, so accepting a look-alike here would be a laundering step: a caller could
  // write out size, headViewDigest, paths(), has(), entry() and read() by hand and have their own
  // bytes come back as captured repository content, which an adapter would then analyse as if it
  // had been read from the repository. The check is delegated to head-view-snapshot's own brand --
  // membership of a WeakSet this module cannot see, mint or extend -- so passing it requires having
  // really captured a snapshot.
  try {
    requireHeadViewSnapshot(snapshot, "the head-view snapshot");
  } catch {
    // The AdapterContentView boundary keeps its own error class and code; only the reason changes.
    throw fail("E_VIEW_INPUT",
      "projectHeadAdapterContentView expects the exact object captureHeadViewSnapshot returned; a caller-crafted "
      + "object with the same members, a spread copy or a clone is not a captured snapshot, however complete it looks");
  }
  const built = new Map();
  for (const entryPath of snapshot.paths()) {
    const entry = snapshot.entry(entryPath);
    // `tracked` is read here and deliberately dropped: it decides config-carrier validity in 11b.4d
    // and belongs to the snapshot, not to anything an adapter is allowed to see.
    built.set(entryPath, { mode: entry.mode, bytes: snapshot.read(entryPath) });
  }
  return createAdapterContentView(built);
}
