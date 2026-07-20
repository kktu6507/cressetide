#!/usr/bin/env node
// ctide contract-check: deterministic scope-diff + AC-coverage over the run's task contract
// (.ctide/output/contract.md, falling back to the compatibility path .ctide/legacy-output/contract.md).
// Session-time helper (NOT a Claude Code hook, NOT CI-only): the orchestrator runs it at the verify /
// arbiter step and feeds its report to the arbiter as evidence. Dependency-free (Node built-ins
// only). Fail-open: an absent/unparseable contract yields a no-claim report; the CLI always exits 0 and
// never throws to its caller. Exposes pure functions (extract / glob / scopeDiff / acCoverage /
// formatReport / resolveContractPath) for the test suite; main() wraps them over git under the
// import.meta.url guard.
import fs from "node:fs";
import path from "node:path";
import cp from "node:child_process";
import { fileURLToPath } from "node:url";

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
// emitted (the guarded-literal surface stays as-is, by design) — this is plain evidence text.
export function formatReport({ contractFound, scope, coverage }) {
  if (!contractFound) {
    return "ctide contract-check: no machine-readable contract found (.ctide/output/contract.md — and the " +
      "legacy .ctide/legacy-output/contract.md — absent or no ```json block) — NO deterministic scope/AC claim; arbiter uses prose judgment.";
  }
  const lines = ["ctide contract-check (deterministic):"];
  if (scope.forbiddenHits && scope.forbiddenHits.length) lines.push("  forbidden-path hits: " + scope.forbiddenHits.join(", "));
  if (scope.allowListed) {
    lines.push(scope.outOfScope && scope.outOfScope.length
      ? "  out-of-scope changed files: " + scope.outOfScope.join(", ")
      : "  scope: clean (all changed files within allowedPaths)");
  } else {
    lines.push("  scope: no allowedPaths declared — no allow-list claim");
  }
  lines.push(coverage.uncovered && coverage.uncovered.length
    ? "  AC missing verification mapping: " + coverage.uncovered.join(", ")
    : "  AC coverage: every behavior-changing criterion maps to a verification entry");
  return lines.join("\n");
}

// Changed paths come from `git diff --name-only` (vs --base, else HEAD); called directly by main().
// A git failure is swallowed to [] so the checker stays fail-open and never throws to its caller.
function changedPathsFromGit(base) {
  try {
    const args = base ? ["diff", "--name-only", base] : ["diff", "--name-only", "HEAD"];
    return cp.execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10000 }).split(/\r?\n/).filter(Boolean);
  } catch (e) { return []; }
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

// Every flag token this file's `get()` closure is ever queried with (main()'s own --contract/--base reads
// below -- the complete recognized-flag set of this CLI's parser). Exported so the test suite can drive the
// SAME list `get()` guards against (no hardcoded duplicate list to drift out of sync). `get()` itself
// (below) checks this list before ever returning `args[i + 1]` as a flag's value: when that next token is
// itself one of these names, the value is treated as omitted -- `get()` returns the flag's own default
// rather than swallowing the neighboring flag's name. Mirrors run-reconcile.mjs's / run-ledger.mjs's
// identical KNOWN_FLAGS guard, each over its own file's complete flag set.
export const KNOWN_FLAGS = ["--contract", "--base"];

function main(argv) {
  const args = argv.slice(2);
  // The one shared flag-value lookup EVERY flag in this file goes through. Guards the swallow at its single
  // root: if the token immediately following `flag` is itself one of KNOWN_FLAGS (this file's own complete
  // recognized-flag set, above), the value is treated as omitted -- `def` is returned instead of the
  // neighboring flag's own name. Fixes every flag uniformly, not per-call-site.
  const get = (flag, def) => {
    const i = args.indexOf(flag);
    const v = i >= 0 ? args[i + 1] : undefined;
    return v && !KNOWN_FLAGS.includes(v) ? v : def;
  };
  const contractPath = get("--contract", "") || resolveContractPath(process.cwd());
  const base = get("--base", "");
  let markdown = "";
  try { markdown = fs.readFileSync(contractPath, "utf8"); } catch (e) { markdown = ""; }
  const contract = extractContractJson(markdown);
  process.stdout.write(formatReport({
    contractFound: contract != null,
    scope: scopeDiff(contract, changedPathsFromGit(base)),
    coverage: acCoverage(contract),
  }) + "\n");
  process.exit(0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv);
