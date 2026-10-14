#!/usr/bin/env node
// ctide contract-check: deterministic scope-diff + AC-coverage over the run's task contract
// (.ctide/output/contract.md, falling back to the compatibility path .ctide/legacy-output/contract.md).
// Session-time helper (NOT a Claude Code hook, NOT CI-only): the orchestrator runs it at the verify /
// arbiter step and feeds its report to the arbiter as evidence. Dependency-free (Node built-ins
// only). Fail-open: an absent/unparseable contract yields a no-claim report; the CLI always exits 0 and
// never throws to its caller. Exposes pure functions (extract / glob / scopeDiff / acCoverage /
// formatReport / resolveContractPath) for the test suite; main() wraps them over git when the script is
// run directly (isMain).
import fs from "node:fs";
import path from "node:path";
import { isMain, parseCli } from "../../../lib/cli.mjs";
import { git } from "../../../lib/git.mjs";

// Extract the FIRST ```json fenced block and JSON.parse it. The machine contract is JSON (not YAML) so
// it needs no dependency. Returns null on absence/parse error (the caller treats null as "no claim").
export function extractContractJson(markdown) {
  if (typeof markdown !== "string") return null;
  const m = markdown.match(/```json\s*\n([\s\S]*?)\n```/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch (e) { return null; }
}

// Minimal dependency-free glob: `*` matches within a path segment, `**` matches across segments. Paths
// normalize to forward slashes first so the matcher is identical on Windows and POSIX (CI runs both). A
// run of consecutive `*` collapses to ONE quantifier (`**` or more => `.*`, a lone `*` => `[^/]*`), so a
// glob like `****` can never emit stacked `.*` groups — that stacking is the catastrophic-backtracking
// (ReDoS) shape, and an operator-authored contract glob must never stall the checker (fail-open intent).
export function matchesGlob(p, glob) {
  const norm = String(p).replace(/\\/g, "/");
  const g = String(glob).replace(/\\/g, "/");
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*") {
      let stars = 0;
      while (g[i] === "*") { stars++; i++; }  // consume the whole *-run...
      i--;                                    // ...the for-loop's i++ steps past the last star
      re += stars >= 2 ? ".*" : "[^/]*";      // ** (or more) crosses segments; a lone * is segment-local
    } else if (".+?^${}()|[]\\".includes(c)) {
      re += "\\" + c;                         // escape regex specials
    } else { re += c; }
  }
  return new RegExp("^" + re + "$").test(norm);
}

// Which changed paths fall outside allowedPaths, and which hit forbiddenPaths. Empty/absent
// allowedPaths => no allow-list claim (outOfScope stays empty); forbiddenPaths is always checked.
export function scopeDiff(contract, changedPaths) {
  const allowed = (contract && Array.isArray(contract.allowedPaths)) ? contract.allowedPaths : [];
  const forbidden = (contract && Array.isArray(contract.forbiddenPaths)) ? contract.forbiddenPaths : [];
  const changed = Array.isArray(changedPaths) ? changedPaths.filter(Boolean) : [];
  return {
    outOfScope: allowed.length ? changed.filter((p) => !allowed.some((g) => matchesGlob(p, g))) : [],
    forbiddenHits: forbidden.length ? changed.filter((p) => forbidden.some((g) => matchesGlob(p, g))) : [],
    allowListed: allowed.length > 0,
  };
}

// AC-coverage: behavior-changing criteria carrying no verification mapping. Presence-only — the QUALITY
// of the mapping stays the arbiter's judgment (the deterministic layer is narrow + high-confidence).
export function acCoverage(contract) {
  const acs = (contract && Array.isArray(contract.acceptanceCriteria)) ? contract.acceptanceCriteria : [];
  return {
    total: acs.length,
    uncovered: acs
      .filter((a) => a && a.behaviorChanging === true && !(typeof a.verification === "string" && a.verification.trim()))
      .map((a) => (a && a.id) || "(unnamed)"),
  };
}

// One compact, LLM-readable evidence block for the arbiter. No new `ctide:` machine sentinel is
// emitted (the guarded-literal surface stays as-is, by design) — this is plain evidence text. When the
// changed-file list could not be established (`scopeUnverified` names why), the report makes no scope or
// forbidden-path claim at all; the AC-coverage line does not depend on git and stays.
export function formatReport({ contractFound, scope, coverage, scopeUnverified }) {
  if (!contractFound) {
    return "ctide contract-check: no machine-readable contract found (.ctide/output/contract.md — and the " +
      "legacy .ctide/legacy-output/contract.md — absent or no ```json block) — NO deterministic scope/AC claim; arbiter uses prose judgment.";
  }
  const lines = ["ctide contract-check (deterministic):"];
  if (scopeUnverified) {
    lines.push("  scope: unverified (" + scopeUnverified + ") — NO scope or forbidden-path claim");
  } else {
    if (scope.forbiddenHits && scope.forbiddenHits.length) lines.push("  forbidden-path hits: " + scope.forbiddenHits.join(", "));
    if (scope.allowListed) {
      lines.push(scope.outOfScope && scope.outOfScope.length
        ? "  out-of-scope changed files: " + scope.outOfScope.join(", ")
        : "  scope: clean (all changed files within allowedPaths)");
    } else {
      lines.push("  scope: no allowedPaths declared — no allow-list claim");
    }
  }
  lines.push(coverage.uncovered && coverage.uncovered.length
    ? "  AC missing verification mapping: " + coverage.uncovered.join(", ")
    : "  AC coverage: every behavior-changing criterion maps to a verification entry");
  return lines.join("\n");
}

const COMMIT_ID = /^[a-f0-9]{40,64}$/i;

// Changed paths come from `git diff --name-only <commit> --` run in the process's working directory, against
// --base or else HEAD; called directly by main() with --base's value, or undefined when the flag was not
// given. Returns { paths } or { unverified: reason }. The trailing "--" makes git take the revision as a
// revision only, so a working-tree file named like it (HEAD, or the commit id) cannot make the diff fail.
//   - An explicit --base (any value given, the empty string included) is first resolved with
//     `rev-parse -q --verify <base>^{commit}`, and only the resulting commit id reaches `git diff`, so the
//     value is never read as a git option (main() already refuses one that starts with "-"). A base that does
//     not resolve, or a diff against it that fails (a spawn error, a timeout, output over the buffer, a
//     non-zero exit), gives { unverified } — never an empty list that would read as "scope: clean".
//   - Without --base, a git failure (not a repository, git missing) is swallowed to { paths: [] } as before,
//     so the checker stays fail-open and never throws to its caller.
function changedPathsFromGit(base) {
  const cwd = process.cwd();
  const explicitBase = base !== undefined;
  let revision = "HEAD";
  if (explicitBase) {
    const resolved = git(cwd, ["rev-parse", "-q", "--verify", `${base}^{commit}`]);
    const commit = String(resolved.stdout ?? "").trim();
    if (resolved.error || resolved.status !== 0 || !COMMIT_ID.test(commit)) {
      return { unverified: `--base ${JSON.stringify(base)} does not resolve to a commit` };
    }
    revision = commit;
  }
  const diff = git(cwd, ["diff", "--name-only", revision, "--"]);
  if (diff.error || diff.status !== 0) {
    return explicitBase ? { unverified: "git diff against the resolved --base failed" } : { paths: [] };
  }
  return { paths: String(diff.stdout ?? "").split(/\r?\n/).filter(Boolean) };
}

// Default contract discovery (READ priority only — this helper never writes):
// .ctide/output/contract.md when it exists, else the compatibility .ctide/legacy-output/contract.md, else the current
// path (so the no-claim report names where the contract SHOULD live). An explicit --contract CLI arg
// keeps precedence over this discovery (main() only calls it when the flag is absent).
export function resolveContractPath(cwd) {
  const candidates = [
    path.join(cwd, ".ctide", "output", "contract.md"),
    path.join(cwd, ".ctide", "legacy-output", "contract.md"),
  ];
  for (const f of candidates) {
    try { if (fs.statSync(f).isFile()) return f; } catch (e) {}
  }
  return candidates[0];
}

const USAGE = "contract-check.mjs [--contract <path>] [--base <ref>]";
const CLI_OPTIONS = { contract: { type: "string" }, base: { type: "string" } };

function main(args) {
  // --base is handed to git, so a value starting with "-" (`--base=--output=x`) is a usage error too.
  const parsed = parseCli(args, { options: CLI_OPTIONS, rejectDashValues: ["base"] });
  if (parsed.error) {
    // A usage error (an unknown or removed flag, a flag without its value, a stray argument) runs no git
    // and reads no contract: one line on stderr, an explicit no-claim on stdout.
    process.stderr.write(`contract-check: ${parsed.error.replace(/\s+/g, " ")} (usage: ${USAGE})\n`);
    process.stdout.write(`ctide contract-check: no claim — the command line could not be parsed (usage: ${USAGE}) — NO deterministic scope/AC claim; arbiter uses prose judgment.\n`);
    process.exit(0);
  }
  const { values } = parsed;
  const contractPath = values.contract || resolveContractPath(process.cwd());
  let markdown = "";
  try { markdown = fs.readFileSync(contractPath, "utf8"); } catch (e) { markdown = ""; }
  const contract = extractContractJson(markdown);
  const changed = changedPathsFromGit(values.base);
  process.stdout.write(formatReport({
    contractFound: contract != null,
    scope: scopeDiff(contract, changed.paths || []),
    coverage: acCoverage(contract),
    scopeUnverified: changed.unverified,
  }) + "\n");
  process.exit(0);
}

if (isMain(import.meta.url)) main(process.argv.slice(2));
