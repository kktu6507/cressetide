// Immutable head-view snapshots (S1/S2) and headViewDigest.
//
// SCOPE: this captures the head universe once, into memory, and fingerprints it. It does not build
// a ChangedTestInventory, parse a v2 envelope, match base against head declarations, compute a
// governance reverse closure, run the S3 consumer freshness recomputation, emit any artifact, write
// under .ctide/output/**, touch the provenance store, or lift the unsupported-populated-inventory
// gate. A green run of this file does not satisfy AC118, AC136, AC137 or AC138 and does not mean
// Phase 2 is ready.
//
// AUTHORITY: approved test-provenance v1.9 section 11b.10 and AC130-AC135. Gitignore matching is
// delegated whole to matchGitignoreSnapshot() in the vendored-dependency wrapper: no glob, no
// regex and no `git check-ignore` stands in for it here.
//
// WHAT "IMMUTABLE" MEANS HERE: every path is enumerated once, every entry's mode, type and bytes
// are read once, and after that nothing in this module stats or reads the live filesystem again.
// A caller that mutates the worktree between S1 and S2 changes the S2 digest, which is the whole
// point of the protocol -- it never changes what S1 reports.
//
// WHAT evaluate() IS FOR: in-memory computation over S1 and nothing else. A future producer must
// NOT write an artifact inside evaluate: the stability verdict is only known after S2, and an
// unstable head view must leave no artifact behind at all.
import cp from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { matchGitignoreSnapshot } from "./parser-ignore-wrapper.mjs";
import { canonicalJson, compareCodePoint, sha256Hex } from "./provenance-store.mjs";

const execFile = promisify(cp.execFile);

export class HeadViewSnapshotError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = "HeadViewSnapshotError";
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

const fail = (code, message, detail) => new HeadViewSnapshotError(code, message, detail);

// Git is run directly, never through a shell, with a fixed wall clock and a bounded output buffer.
const GIT_TIMEOUT_MS = 30_000;
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

// The closed exclusion set from 11b.10. Nothing else may be added here: a third scratch class has
// to be written into the spec first, not decided by an implementation.
const EXCLUDED_EXACT = new Set([".ctide/provenance.json"]);
const EXCLUDED_PREFIXES = [".git/", ".ctide/output/"];
const EXCLUDED_ROOTS = new Set([".git"]);

// §11b.10 step 2, approved v1.11: ONE exact path, never a prefix and never a glob. A consuming
// project that ignores the whole of .ctide/ -- which is the normal case -- would otherwise keep this
// file out of the snapshot entirely, and then "present but untracked" would be indistinguishable
// from "absent", which is the distinction §11b.4 rests on.
const EXPLICIT_CONFIG_PATH = ".ctide/test-adapters-config.json";

const SUPPORTED_MODES = new Set(["100644", "100755", "120000"]);
const GITIGNORE = ".gitignore";

// --- argument shape ---------------------------------------------------------------------------

function requireRequest(request, name, keys) {
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    throw fail("E_API_ARGUMENTS", `${name} expects one options object`);
  }
  const actual = Object.keys(request).sort();
  const wanted = [...keys].sort();
  if (actual.length !== wanted.length || actual.some((k, i) => k !== wanted[i])) {
    throw fail("E_API_ARGUMENTS", `${name} expects exactly ${JSON.stringify(wanted)}; got ${JSON.stringify(actual)}`);
  }
  return request;
}

// --- git ----------------------------------------------------------------------------------------

// Variables that would point Git at a different repository or object store.
const GIT_REDIRECT_VARIABLES = new Set([
  "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_CEILING_DIRECTORIES",
]);

// The empty configuration FILE for the global slot. Git for Windows and POSIX Git both accept
// "/dev/null" here and read it as a file with no settings in it. os.devNull is NOT usable: on
// Windows it expands to \\.\nul and Git rejects that path with "Invalid argument", exit 128.
const EMPTY_GIT_CONFIG_FILE = "/dev/null";

// A home DIRECTORY is a different job, and "/dev/null" cannot do it. A config file only has to be
// readable, but a home has to be a path Git can canonicalise: measured on git 2.55.0.windows.3, a
// repository whose config carries `[includeIf "gitdir:~/…"]` fails with
// `fatal: Invalid path '/dev': No such file or directory` when HOME is /dev/null -- and it fails
// under a perfectly ordinary environment too, because expanding the pattern is what breaks, not
// anything the caller did.
//
// So the controlled home is a fresh, valid, absolute path that does NOT exist and is never
// created. Git canonicalises it happily, "~" expands under it, and nothing can be found there. The
// name carries a UUID minted per capture, so nothing inside it is a location a caller could fill
// in beforehand, and because nothing is created there is nothing to clean up on any path.
//
// WHERE it sits is the part that has to be argued rather than assumed. Two constraints pull
// against each other:
//
//   the BASE must exist   -- Git canonicalises the home's parent, and a path whose whole chain is
//                            missing fails with the same `Invalid path` error, so the home has to
//                            be a direct child of a directory that is really there
//   the base must not be  -- an unpredictable leaf only protects what is INSIDE it. A config
//   caller-controlled        saying `[include] path = ~/../poison.gitconfig` climbs straight out
//                            of the leaf into its parent, so if that parent were os.tmpdir() the
//                            caller would choose it through TEMP, TMP or TMPDIR and could put the
//                            file there. Measured on ed5b109: switching only those three variables
//                            between two temp bases flipped the entry from symlink to blob.
//
// The base is therefore the filesystem root of the CANONICAL repository path the caller asked for
// -- derived from the repository, not from the process. It cannot be moved by TEMP, TMP, TMPDIR,
// HOME, USERPROFILE, XDG_CONFIG_HOME or the working directory, and it cannot be missing.
//
// What `..` can still reach is exactly that filesystem root, and nothing above it. Reaching a file
// there is not an environment question any more: it needs write access to the root of the volume
// the repository lives on, the same standing the system config we already switch off would have.
function newControlledHome(canonicalRepoRoot) {
  return path.join(path.parse(canonicalRepoRoot).root, `ctide-head-view-no-home-${crypto.randomUUID()}`);
}

// The variables Git can take a home directory from. All of them are pinned rather than deleted,
// because deleting one only moves the question to the next: measured on git 2.55.0.windows.3, with
// HOME deleted and the rest hostile, HOMEDRIVE + HOMEPATH still supplied the home.
const HOME_VARIABLES = ["HOME", "USERPROFILE", "XDG_CONFIG_HOME", "HOMEDRIVE", "HOMEPATH"];

// Every Git child runs in a controlled environment. 11b.10 says the process environment must not
// influence the output, and the head view's canonical map is made of things Git configuration can
// move: core.filemode decides whether an untracked file is 100644 or 100755, and core.symlinks
// decides whether a 120000 index entry is reported as a type change. The caller's configuration
// surfaces are therefore not filtered by name-and-index, they are removed wholesale and replaced:
//
//   inherited GIT_CONFIG and GIT_CONFIG_*  -> dropped, matched case-insensitively so a lowercase
//                                             or mixed-case spelling cannot slip through on a
//                                             platform where environment names are case-blind, and
//                                             so a stale KEY_n left behind by a smaller COUNT is
//                                             dropped too
//   SYSTEM configuration                   -> switched off with GIT_CONFIG_NOSYSTEM
//   GLOBAL configuration DISCOVERY         -> closed by pinning GIT_CONFIG_GLOBAL to an empty file,
//                                             so the per-user config is neither read from its usual
//                                             place nor from anywhere a variable points at
//   the HOME a "~" expands to              -> pinned, see below
//
// The global pin alone is not enough, and the distinction matters. Closing global DISCOVERY does
// not stop Git from READING the repository's own config -- which is the point -- but a repository's
// own config may contain `[include] path = ~/…` or `[includeIf "gitdir:~/…"]`, and that "~" is
// resolved through the caller's environment at read time. So an environment can still reach inside
// a local config it does not control. Pointing every home variable at the controlled home closes
// that: "~" expands under a directory that does not exist, so an include finds nothing and an
// includeIf pattern matches nothing. Measured: HOME alone was enough on this Git because HOME
// outranks the rest, but all five are set so the closure does not rest on that ordering.
//
// What deliberately stays open is repository-LOCAL config itself. `.git/config` is repository-local
// interpretation state -- untracked, not part of the snapshot, and not committed bytes -- and
// 11b.10 keeps it as the authority for things like core.symlinks and core.filemode. What is closed
// is process, system, global, and the environment-dependent home expansion a local config can
// reach through. A value written directly into `.git/config` is still observed.
//
// The environment is built once per capture and handed to every Git call, so `rev-parse`,
// `ls-files`, `diff-files` and `config` all read the same home. A home minted per call would let an
// includeIf resolve one way while the index is listed and another way while the diff is taken.
function gitEnvironment(controlledHome) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    const upper = key.toUpperCase();
    if (GIT_REDIRECT_VARIABLES.has(upper)) continue;
    if (upper === "GIT_CONFIG" || upper.startsWith("GIT_CONFIG_")) continue;
    if (HOME_VARIABLES.includes(upper)) continue;
    env[key] = value;
  }
  env.GIT_OPTIONAL_LOCKS = "0";
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = EMPTY_GIT_CONFIG_FILE;
  env.HOME = controlledHome;
  env.USERPROFILE = controlledHome;
  env.XDG_CONFIG_HOME = controlledHome;
  // Windows Git joins HOMEDRIVE and HOMEPATH, so they are split rather than both set to the whole
  // path: if that fallback is ever consulted it lands on the same controlled home.
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
    const stderr = error && error.stderr ? error.stderr.toString("utf8").trim().split("\n")[0] : "";
    throw fail("E_GIT_FAILED", `git ${args[0]} failed in ${cwd}: ${stderr || (error && error.message) || "unknown failure"}`,
      { args, status: error && error.code, killed: Boolean(error && error.killed) });
  }
  return result.stdout;
}

// -z output is a run of NUL-terminated records with no trailing newline. Splitting on NUL is the
// only safe framing: a path may contain spaces, a tab or a newline, and only NUL cannot appear in
// one. A trailing empty piece after the final NUL is the terminator, not a record.
function splitNul(buffer, what) {
  const records = [];
  let start = 0;
  for (let i = 0; i < buffer.length; i += 1) {
    if (buffer[i] !== 0) continue;
    records.push(buffer.subarray(start, i));
    start = i + 1;
  }
  if (start !== buffer.length) {
    throw fail("E_GIT_OUTPUT", `${what} did not end at a NUL boundary; the output is truncated or malformed`);
  }
  return records;
}

const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function decodePath(bytes, what) {
  let text;
  try { text = UTF8.decode(bytes); } catch {
    throw fail("E_PATH_ENCODING", `${what} is not valid UTF-8; a replacement decode would invent a path that is not the one on disk`);
  }
  return text;
}

// Canonical: repo-relative, "/" separated, no drive prefix, no empty or dot segment. Case is taken
// exactly as Git or the directory entry spelled it -- no Unicode normalization, no case folding.
function requireCanonicalPath(value, what) {
  if (typeof value !== "string" || value === "") throw fail("E_PATH", `${what} must be a non-empty string`);
  if (value.includes("\\")) throw fail("E_PATH", `${what} must use POSIX separators: ${value}`);
  if (/^[A-Za-z]:/.test(value)) throw fail("E_PATH", `${what} must not carry a drive prefix: ${value}`);
  if (value.startsWith("/")) throw fail("E_PATH", `${what} must be repository-relative: ${value}`);
  if (value.endsWith("/")) throw fail("E_PATH", `${what} must not end with a separator: ${value}`);
  for (const segment of value.split("/")) {
    if (segment === "") throw fail("E_PATH", `${what} contains an empty segment: ${value}`);
    if (segment === "." || segment === "..") throw fail("E_PATH", `${what} contains a ${segment} segment: ${value}`);
  }
  return value;
}

// §11b.10 (approved v1.11) judges a path in four ordered steps, first match wins:
//   1. hard exclusion -- unconditional, and NOTHING below may override it
//   2. exact config-path observability exception -- ONE exact path, which beats step 3
//   3. tracked .gitignore exclusion -- for every remaining path
//   4. closed inclusion -- whatever survives
// Step 1 lives here. Step 2 is EXPLICIT_CONFIG_PATH, which is deliberately not one of the hard
// exclusions -- it is neither .ctide/provenance.json nor under .ctide/output/ -- so the exception can
// never reach past step 1. Step 3 is applied in the ignore-verdict loop, where the exception is
// honoured; step 4 is the remainder.
function isHardExcluded(candidate) {
  if (EXCLUDED_EXACT.has(candidate) || EXCLUDED_ROOTS.has(candidate)) return true;
  return EXCLUDED_PREFIXES.some((prefix) => candidate.startsWith(prefix));
}

// --- repository root ------------------------------------------------------------------------------

// The filesystem half, which needs no Git and therefore no environment: what absolute path did the
// caller actually name? A relative path is resolved against the working directory here, once, and
// only this canonical result is used afterwards -- including for the controlled home, so the home
// follows the repository rather than the ambient cwd. An alias, a junction or a drive-relative
// spelling all collapse to the same canonical path, so they all pick the same home root.
function canonicalRequestedRoot(repoRoot) {
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

// The Git half, unchanged in what it demands: the caller must name the working tree's own top
// level. A subdirectory is rejected rather than silently widened to the enclosing repository, and a
// bare repository has no worktree to snapshot.
async function resolveRepoRoot(requested, repoRoot, environment) {
  const bare = (await git(requested, ["rev-parse", "--is-bare-repository"], environment)).toString("utf8").trim();
  if (bare !== "false") throw fail("E_REPO_ROOT", `${repoRoot} is a bare repository; there is no working tree to snapshot`);
  const reported = (await git(requested, ["rev-parse", "--show-toplevel"], environment)).toString("utf8").trim();
  if (reported === "") throw fail("E_REPO_ROOT", `git reported no working tree top level for ${repoRoot}`);
  let toplevel;
  try { toplevel = path.resolve(fs.realpathSync.native(reported)); } catch {
    throw fail("E_REPO_ROOT", `the reported top level does not resolve: ${reported}`);
  }
  if (toplevel !== requested) {
    throw fail("E_REPO_ROOT", `repoRoot must be the working tree top level; ${repoRoot} sits inside ${reported}`);
  }
  return requested;
}

// --- git enumeration ------------------------------------------------------------------------------

// `<mode> <oid> <stage>\t<path>` per record. The path starts after the FIRST tab, so a tab inside a
// path -- legal on POSIX -- cannot shift the fields.
function parseIndexEntries(buffer) {
  const entries = new Map();
  for (const record of splitNul(buffer, "git ls-files --stage -z")) {
    if (record.length === 0) continue;
    const tab = record.indexOf(0x09);
    if (tab < 0) throw fail("E_GIT_OUTPUT", "an index record carries no tab separator");
    const head = record.subarray(0, tab).toString("utf8").split(" ");
    if (head.length !== 3) throw fail("E_GIT_OUTPUT", `an index record header is malformed: ${JSON.stringify(head.join(" "))}`);
    const [mode, oid, stage] = head;
    const entryPath = requireCanonicalPath(decodePath(record.subarray(tab + 1), "an index path"), "an index path");
    if (stage !== "0") {
      throw fail("E_INDEX_UNMERGED", `${entryPath} is at merge stage ${stage}; a conflicted index has no single head view`, { path: entryPath, stage });
    }
    if (mode === "160000") {
      throw fail("E_UNSUPPORTED_ENTRY", `${entryPath} is a gitlink (submodule); the closed head-view model does not cover submodules`, { path: entryPath, mode });
    }
    if (!SUPPORTED_MODES.has(mode)) {
      throw fail("E_UNSUPPORTED_ENTRY", `${entryPath} carries index mode ${mode}, which is outside the closed model`, { path: entryPath, mode });
    }
    if (entries.has(entryPath)) throw fail("E_PATH_COLLISION", `${entryPath} appears twice in the index`);
    entries.set(entryPath, { mode, oid });
  }
  return entries;
}

// `<tag> <path>` per record. Only "H" -- a plain cached entry -- can be represented. Skip-worktree
// ("S") and assume-unchanged (a lowercase tag) both mean the index deliberately disagrees with the
// worktree, which the closed model has no way to record.
function parseIndexTags(buffer) {
  for (const record of splitNul(buffer, "git ls-files -v -z")) {
    if (record.length === 0) continue;
    if (record.length < 2 || record[1] !== 0x20) throw fail("E_GIT_OUTPUT", "an ls-files -v record is malformed");
    const tag = String.fromCharCode(record[0]);
    const tagged = decodePath(record.subarray(2), "an index path");
    if (tag === "H") continue;
    if (tag === "M") {
      throw fail("E_INDEX_UNMERGED", `${tagged} is unmerged; a conflicted index has no single head view`, { path: tagged, tag });
    }
    throw fail("E_UNSUPPORTED_STATE", `${tagged} is flagged "${tag}" in the index (skip-worktree or assume-unchanged); the closed head-view model cannot represent it`, { path: tagged, tag });
  }
}

// `:<srcmode> <dstmode> <srcoid> <dstoid> <status>` NUL `<path>` NUL. dstmode is the mode Git can
// actually observe in the worktree, which is the only unstaged mode change this model recognises.
function parseUnstaged(buffer) {
  const records = splitNul(buffer, "git diff-files --raw -z");
  const unstaged = new Map();
  for (let i = 0; i < records.length;) {
    const meta = records[i];
    if (meta.length === 0) { i += 1; continue; }
    if (meta[0] !== 0x3a) throw fail("E_GIT_OUTPUT", "a diff-files record does not start with ':'");
    const fields = meta.subarray(1).toString("utf8").split(" ");
    if (fields.length !== 5) throw fail("E_GIT_OUTPUT", `a diff-files header is malformed: ${JSON.stringify(fields.join(" "))}`);
    const dstMode = fields[1];
    const status = fields[4];
    if (i + 1 >= records.length) throw fail("E_GIT_OUTPUT", "a diff-files record has no path field");
    const changed = requireCanonicalPath(decodePath(records[i + 1], "a diff-files path"), "a diff-files path");
    if (status.startsWith("R") || status.startsWith("C")) {
      throw fail("E_GIT_OUTPUT", `diff-files reported a rename or copy status (${status}) for ${changed}, which this reader does not enable`);
    }
    unstaged.set(changed, { dstMode, status });
    i += 2;
  }
  return unstaged;
}

function parseUntracked(buffer) {
  const untracked = [];
  for (const record of splitNul(buffer, "git ls-files --others -z")) {
    if (record.length === 0) continue;
    untracked.push(requireCanonicalPath(decodePath(record, "an untracked path"), "an untracked path"));
  }
  return untracked;
}

// --- worktree reads ---------------------------------------------------------------------------------

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

// Walks a leaf's ancestors and answers one question: can this leaf exist here at all? lstat and
// readFile resolve the WHOLE path, so a junction or a directory symlink anywhere above the leaf
// would be walked through by the OS before either call ever looks at the leaf -- and the bytes
// that came back would be from wherever that link points, possibly outside the repository. Each
// component is therefore checked from the root DOWNWARDS and the walk stops at the first one that
// is not a plain directory, before the leaf is touched.
//
// Two outcomes, and only one of them is an error:
//   an ancestor is a symlink or junction  -> throw, because following it leaves the repository
//   an ancestor is missing, or is a file  -> false, because the leaf simply is not there
// The second case is an ordinary Git state, not a broken one. Replacing a directory with a file
// leaves the old children reported as deleted and the new file reported as untracked, and both of
// those the head view already knows how to say.
//
// This is a real lstat per component, not a string comparison against the root: a prefix test
// proves nothing about what the filesystem will do with the path. Nothing is remembered between
// leaves either -- the tree can change underneath a capture, and that is what S1/S2 is for.
function leafCanExistUnderAncestors(root, relative) {
  const segments = relative.split("/");
  let absolute = root;
  for (let i = 0; i < segments.length - 1; i += 1) {
    absolute = path.join(absolute, segments[i]);
    const ancestor = segments.slice(0, i + 1).join("/");
    let stat;
    try { stat = fs.lstatSync(absolute); } catch (error) {
      if (error && error.code === "ENOENT" || error && error.code === "ENOTDIR") return false;
      throw fail("E_READ_FAILED", `an ancestor of ${relative} could not be examined: ${error && error.code}`, { path: relative, ancestor });
    }
    if (stat.isSymbolicLink()) {
      throw fail("E_UNSUPPORTED_ENTRY", `${relative} sits under ${ancestor}, which is a symlink or junction; following it could read bytes from outside this repository`, { path: relative, ancestor, reason: "ancestor-symlink" });
    }
    // Not a directory and not a link: the path this leaf needs does not lead anywhere. The
    // ancestor itself is judged on its own terms when it turns up as a leaf of its own.
    if (!stat.isDirectory()) return false;
  }
  return true;
}

// Is this exact spelling really a directory entry, segment by segment? readdir returns what the
// filesystem stores, so a spelling it does not return is not a separate file however happily
// lstat resolves it. This is the only thing that separates "two files whose names differ by case"
// from "one file reached through two spellings", and it answers it per directory rather than per
// platform. Called only when a fold collision has already been seen, so it costs nothing
// otherwise.
function isSpelledVerbatim(root, relative) {
  const segments = relative.split("/");
  let absolute = root;
  for (const segment of segments) {
    let listing;
    try { listing = fs.readdirSync(absolute); } catch { return false; }
    if (!listing.includes(segment)) return false;
    absolute = path.join(absolute, segment);
  }
  return true;
}

// Reads one entry, once. A symlink is never followed: its bytes ARE its target string. On a
// platform where Git cannot materialise symlinks, a tracked 120000 entry lands as a regular file
// whose CONTENT is that same target string, so the index mode carries the symlink meaning and the
// bytes come out identical either way -- but only while Git has nothing newer to say. When
// diff-files reports an observed mode, that is what the worktree holds NOW, so a 120000 -> 100644
// type change is a blob and not a link.
function readEntry(root, absolute, relative, indexMode, observedMode) {
  if (!leafCanExistUnderAncestors(root, relative)) return null;
  let stat;
  try { stat = fs.lstatSync(absolute); } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw fail("E_READ_FAILED", `${relative} could not be examined: ${error && error.code}`);
  }

  if (stat.isSymbolicLink()) {
    let target;
    try { target = fs.readlinkSync(absolute, { encoding: "buffer" }); } catch (error) {
      throw fail("E_READ_FAILED", `${relative} is a symlink whose target could not be read: ${error && error.code}`);
    }
    return { mode: "120000", type: "symlink", bytes: Buffer.from(target) };
  }
  if (!stat.isFile()) {
    throw fail("E_UNSUPPORTED_ENTRY", `${relative} is neither a regular file nor a symlink; the closed model covers only blobs and symlinks`, { path: relative });
  }

  let bytes;
  try { bytes = fs.readFileSync(absolute); } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw fail("E_READ_FAILED", `${relative} could not be read: ${error && error.code}`);
  }
  // Observed first, index second. The index carrier only speaks for a path Git has not reported a
  // newer mode for.
  const mode = observedMode !== null && observedMode !== undefined ? observedMode : indexMode;
  if (!SUPPORTED_MODES.has(mode)) {
    throw fail("E_UNSUPPORTED_ENTRY", `${relative} resolves to mode ${mode}, which is outside the closed model`, { path: relative, mode });
  }
  if (mode === "120000") return { mode: "120000", type: "symlink", bytes };
  return { mode, type: "blob", bytes };
}

// Untracked regular files have no index mode. The executable bit is only meaningful where Git
// itself honours it, so core.filemode decides -- the same way Git would stage the file.
function untrackedMode(stat, fileMode) {
  if (!fileMode) return "100644";
  return (stat.mode & 0o111) !== 0 ? "100755" : "100644";
}

function readUntracked(root, absolute, relative, fileMode) {
  if (!leafCanExistUnderAncestors(root, relative)) return null;
  let stat;
  try { stat = fs.lstatSync(absolute); } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw fail("E_READ_FAILED", `${relative} could not be examined: ${error && error.code}`);
  }
  if (stat.isSymbolicLink()) {
    let target;
    try { target = fs.readlinkSync(absolute, { encoding: "buffer" }); } catch (error) {
      throw fail("E_READ_FAILED", `${relative} is a symlink whose target could not be read: ${error && error.code}`);
    }
    return { mode: "120000", type: "symlink", bytes: Buffer.from(target) };
  }
  if (!stat.isFile()) {
    throw fail("E_UNSUPPORTED_ENTRY", `${relative} is neither a regular file nor a symlink; the closed model covers only blobs and symlinks`, { path: relative });
  }
  let bytes;
  try { bytes = fs.readFileSync(absolute); } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw fail("E_READ_FAILED", `${relative} could not be read: ${error && error.code}`);
  }
  return { mode: untrackedMode(stat, fileMode), type: "blob", bytes };
}

// --- snapshot -----------------------------------------------------------------------------------

// Module-private identity brand. Membership is not a property, so a spread, a clone or a
// hand-written look-alike is not a snapshot however closely it copies the shape.
const SNAPSHOTS = new WeakSet();

function buildSnapshot(entries) {
  const paths = [...entries.keys()].sort(compareCodePoint);
  // A null-prototype object, because "__proto__" is a perfectly legal Git path. On a plain {} the
  // assignment below would invoke the prototype setter instead of creating an own property, and
  // the file would sit in the snapshot while staying outside the digest that is supposed to cover
  // it. With no prototype there is no setter, so every legal path becomes an own data property and
  // canonicalJson serialises it like any other key.
  const map = Object.create(null);
  const metadata = new Map();
  const bytes = new Map();
  for (const p of paths) {
    const entry = entries.get(p);
    // The public entry carries `tracked`; the canonical map does NOT. §11b.10 fixes the map value at
    // exactly three columns, and AC160 turns that into an observable requirement: staging a file
    // whose bytes, mode and type are unchanged must leave headViewDigest identical. `tracked` is
    // carrier-validity metadata, not source content, so it is read from the entry and never hashed.
    const record = Object.freeze({
      mode: entry.mode, type: entry.type, contentDigest: sha256(entry.bytes), tracked: entry.tracked === true,
    });
    map[p] = { mode: record.mode, type: record.type, contentDigest: record.contentDigest };
    metadata.set(p, record);
    bytes.set(p, entry.bytes);
  }

  // The map digest goes through sha256Hex because canonicalJson output carries no BOM and no
  // literal CR, so its canonicalText step is a no-op there. The per-entry contentDigest cannot:
  // sha256Hex rejects a Buffer outright, and on a string it folds CRLF and strips a BOM -- exactly
  // the two changes AC135 requires the digest to notice. Raw bytes are hashed as raw bytes.
  const headViewDigest = sha256Hex(canonicalJson(map));
  const frozenPaths = Object.freeze(paths);

  const snapshot = Object.freeze({
    headViewDigest,
    size: paths.length,
    paths: () => frozenPaths,
    has: (p) => metadata.has(p),
    entry: (p) => {
      const found = metadata.get(p);
      if (found === undefined) throw fail("E_PATH_MISSING", `the snapshot holds no entry at ${p}`);
      return found;
    },
    // A copy per read: whatever a caller does to the buffer it gets, the next read is unaffected.
    read: (p) => {
      const found = bytes.get(p);
      if (found === undefined) throw fail("E_PATH_MISSING", `the snapshot holds no blob at ${p}`);
      return Buffer.from(found);
    },
  });
  SNAPSHOTS.add(snapshot);
  return snapshot;
}

const isSnapshot = (value) => value !== null && typeof value === "object" && SNAPSHOTS.has(value);

// --- capture ---------------------------------------------------------------------------------------

export async function captureHeadViewSnapshot(request) {
  if (arguments.length !== 1) {
    throw fail("E_API_ARGUMENTS", "captureHeadViewSnapshot takes exactly one argument; a git executable, an environment, an ignore matcher, a filesystem adapter or a capture hook cannot be supplied");
  }
  requireRequest(request, "captureHeadViewSnapshot", ["repoRoot"]);
  // Canonicalise with the filesystem first, because the controlled home is derived from the
  // repository's own filesystem root and must be settled before any Git call is made. One
  // environment for the whole capture, so every Git call below resolves "~" the same way.
  const requested = canonicalRequestedRoot(request.repoRoot);
  const environment = gitEnvironment(newControlledHome(requested));
  const root = await resolveRepoRoot(requested, request.repoRoot, environment);

  // allSettled, not all: if one Git call fails the others must still be waited on rather than left
  // running against a directory the caller may be about to clean up.
  const settled = await Promise.allSettled([
    git(root, ["ls-files", "--stage", "-z"], environment),
    git(root, ["ls-files", "-v", "-z"], environment),
    git(root, ["diff-files", "--raw", "-z"], environment),
    // Deliberately WITHOUT --exclude-standard: this must be the full untracked universe, and the
    // only ignore authority is the tracked .gitignore bytes fed to the vendored engine below.
    git(root, ["ls-files", "--others", "-z"], environment),
  ]);
  const rejected = settled.find((r) => r.status === "rejected");
  if (rejected !== undefined) throw rejected.reason;
  const [indexOut, tagsOut, unstagedOut, othersOut] = settled.map((r) => r.value);

  // The index shape is read before the flag tags: a conflicted path shows up in both, and "your
  // index is mid-merge" is the more useful of the two answers.
  const index = parseIndexEntries(indexOut);
  parseIndexTags(tagsOut);
  const unstaged = parseUnstaged(unstagedOut);
  const untrackedPaths = parseUntracked(othersOut);

  let fileMode = process.platform !== "win32";
  try {
    fileMode = (await git(root, ["config", "--bool", "core.filemode"], environment)).toString("utf8").trim() === "true";
  } catch { /* unset: keep the platform default Git itself would use */ }

  // One enumeration pass, one read per entry. Nothing below this point touches the filesystem.
  // `tracked` is metadata, decided HERE by index membership: every path in this loop came from
  // `ls-files --stage`, whose records this reader already refuses unless they are stage 0.
  const tracked = new Map();
  for (const [relative, entry] of index) {
    if (isHardExcluded(relative)) continue;
    const change = unstaged.get(relative);
    const observed = change !== undefined && change.dstMode !== "000000" ? change.dstMode : null;
    const read = readEntry(root, path.join(root, relative), relative, entry.mode, observed);
    if (read === null) continue; // deleted in the working tree: the path does not exist in the head view
    tracked.set(relative, { ...read, tracked: true });
  }

  const untracked = new Map();
  for (const relative of untrackedPaths) {
    if (isHardExcluded(relative)) continue;
    if (tracked.has(relative) || index.has(relative)) {
      throw fail("E_PATH_COLLISION", `${relative} is reported as both tracked and untracked`);
    }
    const read = readUntracked(root, path.join(root, relative), relative, fileMode);
    if (read === null) continue;
    untracked.set(relative, { ...read, tracked: false });
  }

  // Ignore authority: the tracked .gitignore bytes ALREADY IN S1, and nothing else. No
  // .git/info/exclude, no core.excludesFile, no environment, no `git check-ignore`, no home-made
  // glob. A .gitignore that is untracked is just another candidate, and one that is a symlink is
  // not an authority either -- Git does not read those.
  const ignoreFiles = [];
  for (const [relative, entry] of tracked) {
    if (entry.type !== "blob") continue;
    if (relative !== GITIGNORE && !relative.endsWith(`/${GITIGNORE}`)) continue;
    ignoreFiles.push({ path: relative, bytes: entry.bytes });
  }
  const candidatePaths = [...untracked.keys()].sort(compareCodePoint);
  let verdicts = [];
  if (candidatePaths.length > 0) {
    try {
      const matched = await matchGitignoreSnapshot({ ignoreFiles, candidatePaths });
      verdicts = matched.results;
    } catch (error) {
      throw fail("E_IGNORE_FAILED", `the ignore engine refused the head-view candidates: ${(error && error.message) || error}`,
        { code: error && error.code, candidates: candidatePaths.length, ignoreFiles: ignoreFiles.length });
    }
    if (verdicts.length !== candidatePaths.length) {
      throw fail("E_IGNORE_FAILED", "the ignore engine returned a different number of verdicts than candidates");
    }
  }

  // Step 3 applied, with step 2 taking precedence over it for the one exact config path: an ignored
  // config is still enumerated, still read, and still lands in the snapshot -- carrying
  // tracked:false, which is what makes "present but untracked" sayable at all.
  const entries = new Map(tracked);
  verdicts.forEach((verdict, i) => {
    if (verdict.path !== candidatePaths[i]) throw fail("E_IGNORE_FAILED", `ignore verdict ${i} is out of order`);
    if (verdict.ignored && verdict.path !== EXPLICIT_CONFIG_PATH) return;
    entries.set(verdict.path, untracked.get(verdict.path));
  });

  // Two paths that differ only by case are two files on a case-sensitive filesystem and one file
  // seen twice on a case-insensitive one. Only the second is ambiguous, and which one applies is a
  // question for the filesystem rather than for process.platform -- Windows can be case-sensitive
  // per directory, and a case-sensitive tree is entitled to hold Case.txt beside case.txt.
  //
  // The question is asked by listing: a directory entry is only really there under a given
  // spelling if readdir returns that spelling. If both spellings are listed verbatim, both files
  // exist and there is nothing ambiguous; if one is not, the two index paths are naming one entry
  // and the head view cannot say which spelling the tree holds.
  const folded = new Map();
  for (const relative of entries.keys()) {
    const key = relative.toLowerCase();
    const group = folded.get(key);
    if (group === undefined) { folded.set(key, [relative]); continue; }
    if (group.includes(relative)) continue;
    for (const other of [...group, relative]) {
      if (isSpelledVerbatim(root, other)) continue;
      throw fail("E_PATH_COLLISION", `${group[0]} and ${relative} differ only by case and the filesystem does not list ${other} verbatim; the head view cannot tell which spelling the tree holds`,
        { paths: [...group, relative], missing: other });
    }
    group.push(relative);
  }

  assertConfigSlotObservable(root, entries);
  return buildSnapshot(entries);
}

// The exact config path carries a decision, so its ABSENCE from the snapshot carries one too:
// §11b.4 reads "not in the snapshot" as "there is no config" and continues with null. A slot the
// closed model cannot represent -- a directory, a junction, a socket -- must therefore not be
// allowed to look like absence. Ancestors are walked first, so a junction above the leaf is refused
// before any lstat could read through it into another tree.
function assertConfigSlotObservable(root, entries) {
  if (entries.has(EXPLICIT_CONFIG_PATH)) return;
  if (!leafCanExistUnderAncestors(root, EXPLICIT_CONFIG_PATH)) return;
  let stat;
  try {
    stat = fs.lstatSync(path.join(root, EXPLICIT_CONFIG_PATH));
  } catch (error) {
    if (error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return; // genuinely absent
    throw fail("E_READ_FAILED", `${EXPLICIT_CONFIG_PATH} could not be examined: ${error && error.code}`,
      { path: EXPLICIT_CONFIG_PATH, reason: error && error.code });
  }
  const kind = stat.isDirectory() ? "a directory"
    : stat.isSymbolicLink() ? "a symlink"
      : stat.isFile() ? "a regular file"
        : "an entry of a kind this model does not cover";
  throw fail("E_UNSUPPORTED_ENTRY",
    `${EXPLICIT_CONFIG_PATH} is occupied by ${kind} in the working tree but did not reach the head view; `
    + "the exact config path must be observable, and reporting it as absent would let an unreadable slot "
    + "read as \"there is no config\"",
    { path: EXPLICIT_CONFIG_PATH, kind });
}

// --- stability -----------------------------------------------------------------------------------

// S1, then the caller's in-memory computation over S1 alone, then S2. An unstable head view throws
// and the evaluate result is dropped on the floor: it was computed over bytes that no longer
// describe the tree, so returning it would be worse than failing.
//
// evaluate MUST NOT write anything. The verdict is not known until after S2, so an artifact
// written inside evaluate would survive an unstable head view -- exactly what 11b.10 step 4
// forbids. Nothing in this module writes, and nothing here can undo a write a caller performs.
export async function withStableHeadView(request) {
  if (arguments.length !== 1) throw fail("E_API_ARGUMENTS", "withStableHeadView takes exactly one argument");
  requireRequest(request, "withStableHeadView", ["repoRoot", "evaluate"]);
  if (typeof request.evaluate !== "function") throw fail("E_API_ARGUMENTS", "withStableHeadView expects evaluate to be a function");

  const first = await captureHeadViewSnapshot({ repoRoot: request.repoRoot });
  // An error from evaluate propagates unchanged: it is the caller's failure, not a stability one.
  const value = await request.evaluate(first);
  const second = await captureHeadViewSnapshot({ repoRoot: request.repoRoot });
  // The brand is what says these two digests came from this module's builder. There is no public
  // API that consumes a snapshot yet, so this is the one place it is load-bearing today: a future
  // refactor that returned anything else from capture would fail here rather than silently compare
  // two numbers of unknown provenance.
  if (!isSnapshot(first) || !isSnapshot(second)) {
    throw fail("E_SNAPSHOT_BRAND", "a head view snapshot did not come from captureHeadViewSnapshot; its digest cannot be trusted");
  }
  // TWO comparisons, because one is not enough. The fingerprint IS headViewDigest and `tracked` is
  // deliberately outside it, so flipping the config between tracked and untracked with a pure index
  // operation -- bytes, mode and type untouched -- leaves the digests identical while the config's
  // carrier validity goes from legal to fail-closed. That change has to stop the run too.
  const firstState = configCarrierState(first);
  const secondState = configCarrierState(second);
  const digestMoved = first.headViewDigest !== second.headViewDigest;
  const carrierMoved = firstState !== secondState;
  if (digestMoved || carrierMoved) {
    const moved = [digestMoved ? "headViewDigest" : null, carrierMoved ? "configCarrierState" : null].filter(Boolean);
    throw fail("E_HEAD_VIEW_UNSTABLE",
      `head-view-unstable: ${moved.join(" and ")} changed while the head view was being read `
      + `(headViewDigest S1 ${first.headViewDigest}, S2 ${second.headViewDigest}; `
      + `configCarrierState S1 ${firstState}, S2 ${secondState}); no artifact may be produced from this run`,
      {
        s1: first.headViewDigest,
        s2: second.headViewDigest,
        configCarrierState: { s1: firstState, s2: secondState },
      });
  }
  return Object.freeze({ snapshot: first, value });
}

// Internal only, and deliberately so: §11b.10 makes this a SECOND stability comparison, not a
// persisted contract. It is not exported, never written to an artifact, never added to
// headViewDigest, and needs no probe of its own -- it reads metadata the capture already took.
// The comparison is closed to the one config path: every other path's tracked state is
// semantically irrelevant here, and widening it would turn unrelated index work into instability.
function configCarrierState(snapshot) {
  if (!snapshot.has(EXPLICIT_CONFIG_PATH)) return "absent";
  return snapshot.entry(EXPLICIT_CONFIG_PATH).tracked === true ? "tracked" : "untracked";
}
