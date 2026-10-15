// The one way the plugin's scripts (and .github/scripts/publish-release.mjs) run git. Node built-ins only.
//
// Every call runs `git -C <root> <NEUTRAL_CONFIG as -c pairs> <args>`:
//   - Command-line `-c` outranks every config file (system, global, repo-local), GIT_CONFIG_COUNT/KEY/VALUE
//     and an inherited GIT_CONFIG_PARAMETERS, so the developer's own settings cannot reshape output a
//     script parses. Only the keys below are neutralized, one mechanism per key; the rest of the user's
//     configuration stays (safe.directory among them — isolating GIT_CONFIG_GLOBAL/NOSYSTEM would lose it).
//     Per-command query flags (--sort=refname, --no-renames, -z, --format, --untracked-files=<mode>) stay
//     with the callers. core.abbrev is deliberately not neutralized.
//   - The environment is the process's own minus the variables that would point git at another
//     repository, index or object store than `root` (GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE,
//     GIT_COMMON_DIR, GIT_OBJECT_DIRECTORY, GIT_ALTERNATE_OBJECT_DIRECTORIES), every GIT_TRACE* variable
//     and every GIT_REDIRECT_* variable — all matched case-insensitively on Windows — plus
//     GIT_OPTIONAL_LOCKS=0 so that a read such as `git status` does not rewrite .git/index as a side
//     effect. A caller may read non-empty stderr as a failed read, so stderr must carry git's own
//     messages and nothing else: tracing writes to stderr on a healthy read, and Git for Windows'
//     GIT_REDIRECT_STDERR=2>&1 would move a warning into stdout. A trace2 target set in a config file
//     (trace2.normalTarget / perfTarget / eventTarget, e.g. `1` for stderr) is not overridden by `-c`, only
//     by its own variable, so GIT_TRACE2, GIT_TRACE2_PERF and GIT_TRACE2_EVENT are each set to 0.
//   - stdin is a pipe only when `input` is given, else ignored (an ignored stdin would drop the input).
//   - It calls spawnSync on the child_process module object at call time, so a test preload that patches
//     child_process.spawnSync for command "git" still intercepts it.
import cp from "node:child_process";

// diff.ignoreSubmodules=none overrides the user's setting and git's own default as well: `git diff`
// normally hides untracked files inside a submodule; here such a submodule counts as changed (`git status`
// reports it either way). A project's per-submodule `ignore` in .gitmodules (or submodule.<name>.ignore)
// still applies, unlike --ignore-submodules=none. core.fsmonitor=false keeps a repository's own
// core.fsmonitor (a command, or `true` for the built-in daemon) from being run by a status or diff here.
export const NEUTRAL_CONFIG = Object.freeze({
  "core.quotePath": "false",
  "i18n.logOutputEncoding": "UTF-8",
  "log.showSignature": "false",
  "column.ui": "never",
  "diff.relative": "false",
  "diff.ignoreSubmodules": "none",
  "core.fsmonitor": "false",
});
export const NEUTRAL_CONFIG_ARGS = Object.freeze(
  Object.entries(NEUTRAL_CONFIG).flatMap(([key, value]) => ["-c", `${key}=${value}`]),
);

const REDIRECTING_ENV = new Set([
  "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_OPTIONAL_LOCKS",
]);

function gitEnvironment() {
  const caseInsensitive = process.platform === "win32";
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    const name = caseInsensitive ? key.toUpperCase() : key;
    if (REDIRECTING_ENV.has(name) || name.startsWith("GIT_TRACE") || name.startsWith("GIT_REDIRECT_")) continue;
    env[key] = value;
  }
  env.GIT_OPTIONAL_LOCKS = "0";
  env.GIT_TRACE2 = "0";
  env.GIT_TRACE2_PERF = "0";
  env.GIT_TRACE2_EVENT = "0";
  return env;
}

// The raw spawnSync result — { status, signal, stdout, stderr, error, … } — and never a throw for anything
// git or the spawn does: a spawn failure (git missing: error.code "ENOENT"; timeout: "ETIMEDOUT"; output
// over maxBuffer: "ENOBUFS") is in `error`, a git failure in `status`. Check `error` first: when git did not
// start, stdout/stderr may be undefined (ENOENT) or null (an argument spawnSync rejects); otherwise strings
// (encoding "utf8", the default) or Buffers (encoding "buffer"). Any other encoding — Node's `null` idiom
// for raw bytes included — is a programming error and throws a TypeError before git runs.
export function git(root, args, { input, encoding = "utf8", maxBuffer = 64 * 1024 * 1024, timeout = 10_000 } = {}) {
  if (encoding !== "utf8" && encoding !== "buffer") {
    throw new TypeError(`git: encoding must be "utf8" or "buffer", not ${typeof encoding === "string" ? JSON.stringify(encoding) : String(encoding)}`);
  }
  try {
    return cp.spawnSync("git", ["-C", root, ...NEUTRAL_CONFIG_ARGS, ...args], {
      input,
      encoding,
      maxBuffer,
      timeout,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      env: gitEnvironment(),
    });
  } catch (error) { // an argument spawnSync rejects outright (e.g. one containing a NUL byte) — reported, not thrown
    return { pid: 0, output: null, stdout: null, stderr: null, status: null, signal: null, error };
  }
}

// git()'s stdout (string, or Buffer with encoding "buffer") when git ran and exited 0; an invalid encoding
// is git()'s TypeError; otherwise throws an Error whose message names the git arguments (never `root`) and
// the reason, carrying:
//   .stderr  git's stderr as a string ("" when there was none)
//   .status  the exit status (null when git did not run to completion)
//   .code    the spawn error code ("ENOENT", "ETIMEDOUT", "ENOBUFS", …), or null when git ran and failed
export function gitOrThrow(root, args, options) {
  const result = git(root, args, options);
  if (!result.error && result.status === 0) return result.stdout;
  const stderr = result.stderr == null ? "" : String(result.stderr);
  const reason = result.error
    ? (result.error.code || result.error.message)
    : result.signal ? `signal ${result.signal}` : `exit ${result.status}`;
  const error = new Error(`git ${args.join(" ")} failed (${reason})${stderr.trim() ? `: ${stderr.trim()}` : ""}`);
  error.stderr = stderr;
  error.status = result.status ?? null;
  error.code = result.error?.code ?? null;
  if (result.error) error.cause = result.error;
  throw error;
}

const OBJECT_ID = /^[a-f0-9]{40,64}$/i;

// An integer for output that is only decimal digits once trimmed (`rev-list --count`), else null — never
// the 0 that Number("") or Number(" ") would give.
export function parseCount(stdout) {
  const text = String(stdout ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  const count = Number(text);
  return Number.isSafeInteger(count) ? count : null;
}

// "born" when HEAD resolves to a commit that exists; "unborn" when it does not and the repository has no
// commits at all (`rev-list --all --count` is exactly 0); "unknown" otherwise — a HEAD naming a missing
// object, a corrupt repository, git missing or failing, or not a repository.
export function headState(root) {
  const head = git(root, ["rev-parse", "-q", "--verify", "HEAD^{commit}"]);
  if (!head.error && head.status === 0 && OBJECT_ID.test(String(head.stdout ?? "").trim())) return "born";
  const count = git(root, ["rev-list", "--all", "--count"]);
  if (!count.error && count.status === 0 && parseCount(count.stdout) === 0) return "unborn";
  return "unknown";
}

const unverified = (reason) => ({ state: "unverified", reason });
const nulSeparated = (stdout) => String(stdout ?? "").split("\0").filter(Boolean);

// The worktree-side paths of `git status --porcelain=v1 -z` ("XY PATH" entries; Y is the index-to-worktree
// status): every entry whose Y is not a space — modified, deleted, type-changed, intent-to-add, unmerged.
// A rename or copy entry ("R"/"C") is followed by its source path, which is skipped.
function worktreeChangedPaths(stdout) {
  const fields = String(stdout ?? "").split("\0");
  const paths = [];
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i];
    if (entry.length < 4 || entry[2] !== " ") continue;
    if ("RC".includes(entry[0]) || "RC".includes(entry[1])) i++;
    if (entry[1] !== " ") paths.push(entry.slice(3));
  }
  return paths;
}

// Every path that differs between `base` and the working tree, as seen by the index too: the union of
//   base vs index            git diff --cached --name-only -z --no-renames <base> --
//   index vs working tree    git status --porcelain=v1 -z --no-renames --untracked-files=no
//   untracked, not ignored   git ls-files -z --others --exclude-standard
// run at the top level. (base vs index) ∪ (index vs worktree) is exactly (base vs index) ∪ (base vs
// worktree), so a change staged and then reverted in the working tree is still listed. The worktree side
// comes from `git status` rather than `git diff <base>`: with stale stat data, `git diff <base>` rewrites
// .git/index even under GIT_OPTIONAL_LOCKS=0 (git 2.55), `git status` does not. Nothing here writes the
// index or adds intent-to-add entries.
//
// Returns { state: "ok", base: <commit id>, files: [top-level-relative paths, sorted, deduplicated] } or
// { state: "unverified", reason }:
//   invalid-base     base is not a non-empty string, starts with "-", or does not resolve to a commit
//   git-unavailable  git could not be started (ENOENT)
//   not-a-work-tree  git ran but `rev-parse --show-toplevel` failed (no repository, a bare repository, a
//                    .git directory)
//   unborn-head      HEAD has no commit yet
//   unreadable-head  HEAD's state could not be established (headState "unknown")
//   read-failed      any other spawn failure (timeout, ENOBUFS, …) or a failing read
export function changedFiles(root, base = "HEAD") {
  if (typeof base !== "string" || base === "" || base.startsWith("-")) return unverified("invalid-base");
  const top = git(root, ["rev-parse", "--show-toplevel"]);
  if (top.error) return unverified(top.error.code === "ENOENT" ? "git-unavailable" : "read-failed");
  const topLevel = String(top.stdout ?? "").trim();
  if (top.status !== 0 || !topLevel) return unverified("not-a-work-tree");
  const head = headState(topLevel);
  if (head !== "born") return unverified(head === "unborn" ? "unborn-head" : "unreadable-head");
  const resolved = git(topLevel, ["rev-parse", "-q", "--verify", `${base}^{commit}`]);
  if (resolved.error) return unverified("read-failed");
  const commit = String(resolved.stdout ?? "").trim();
  if (resolved.status !== 0 || !OBJECT_ID.test(commit)) return unverified("invalid-base");
  const reads = [
    git(topLevel, ["diff", "--cached", "--name-only", "-z", "--no-renames", commit, "--"]),
    git(topLevel, ["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=no"]),
    git(topLevel, ["ls-files", "-z", "--others", "--exclude-standard"]),
  ];
  if (reads.some((read) => read.error || read.status !== 0)) return unverified("read-failed");
  const [staged, worktree, untracked] = reads;
  const files = new Set([
    ...nulSeparated(staged.stdout),
    ...worktreeChangedPaths(worktree.stdout),
    ...nulSeparated(untracked.stdout),
  ]);
  return { state: "ok", base: commit, files: [...files].sort() };
}
