// The hardened, read-only Git access every component that reads the OBJECT DATABASE shares.
//
// Extracted from adapter-content-view.mjs, which held it module-private and recorded the
// duplication as a follow-up. It is shared rather than copied because a second copy of an isolation
// rule is a second rule, and the failure mode of the weaker copy is silent: it returns an answer,
// just not one about the repository you named.
import crypto from "node:crypto";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export const GIT_TIMEOUT_MS = 120_000;
export const GIT_MAX_BUFFER = 256 * 1024 * 1024;

// Anything that could point Git at a different repository, index, work tree or object store.
const GIT_REDIRECT_VARIABLES = new Set([
  "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_CEILING_DIRECTORIES",
]);
const HOME_VARIABLES = ["HOME", "USERPROFILE", "XDG_CONFIG_HOME", "HOMEDRIVE", "HOMEPATH"];

// Variables PINNED rather than inherited. They are dropped case-insensitively during the copy and
// written back with the one value that is correct here, so an inherited "", "0", "false" or a
// lower/mixed-case spelling cannot survive to weaken the setting. Windows treats environment names
// case-blind, so dropping by exact name alone would leave a second key behind.
//
// GIT_NO_REPLACE_OBJECTS closes refs/replace. Without it, naming a tree gets you a DIFFERENT one: a
//   replacement ref installed for that object silently redirects every cat-file and ls-tree, so the
//   "exact immutable Git tree" the model requires becomes whatever the repository's replace refs
//   currently point at.
// GIT_NO_LAZY_FETCH closes partial-clone demand fetching. Without it, a missing promisor object
//   makes Git contact the remote, download it and WRITE it into .git/objects -- turning a read of
//   the object database into a network operation and a mutation of the repository.
//
// Neither is trusted on its own: both are ALSO passed as command-line options below, because a Git
// build that does not recognise a variable ignores it in silence.
const PINNED_VARIABLES = ["GIT_OPTIONAL_LOCKS", "GIT_NO_REPLACE_OBJECTS", "GIT_NO_LAZY_FETCH"];
const EMPTY_GIT_CONFIG_FILE = "/dev/null";

// The same two closures as command-line options, in front of every subcommand. An unrecognised
// global option exits 129 with "unknown option: …" BEFORE the subcommand runs and before any object
// is read, so a Git too old to know them refuses to read at all rather than reading under weaker
// guarantees. That is the correct direction: an unavailable answer beats a wrong one.
export const GIT_GLOBAL_OPTIONS = ["--no-replace-objects", "--no-lazy-fetch"];

export class GitReadError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = "GitReadError";
    this.code = "E_GIT_FAILED";
    if (detail !== undefined) this.detail = detail;
  }
}

// A fresh, valid, absolute path that does not exist and is never created, rooted at the filesystem
// root of the repository itself rather than anywhere the caller can steer through TEMP.
export function newControlledHome(canonicalRepoRoot) {
  return path.join(path.parse(canonicalRepoRoot).root, `ctide-base-view-no-home-${crypto.randomUUID()}`);
}

export function gitEnvironment(controlledHome) {
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

// Runs one subcommand under the isolation above. The WHOLE argv is reported on failure, not a
// prefix: what was actually run is the only way a caller -- or a regression -- can establish that
// the isolation options were really passed rather than merely written down here.
export async function runGit(cwd, args, environment) {
  const argv = [...GIT_GLOBAL_OPTIONS, ...args];
  try {
    const result = await execFile("git", argv, {
      cwd,
      env: environment,
      encoding: "buffer",
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      shell: false,
      windowsHide: true,
    });
    return result.stdout;
  } catch (error) {
    const stderr = error && error.stderr ? error.stderr.toString("utf8").trim() : "";
    throw new GitReadError(`git ${args[0]} failed: ${stderr || (error && error.message) || "unknown error"}`,
      { args: argv, stderr });
  }
}
