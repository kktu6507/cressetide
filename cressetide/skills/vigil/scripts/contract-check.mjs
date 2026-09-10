#!/usr/bin/env node
// ctide contract-check: deterministic scope-diff + AC-coverage over the run's task contract
// (.ctide/output/contract.md, falling back to the compatibility path .ctide/legacy-output/contract.md).
// Session-time helper (NOT a Claude Code hook, NOT CI-only): the orchestrator runs it at the verify /
// arbiter step and feeds its report to the arbiter as evidence. Dependency-free (Node built-ins
// only). Fail-open: an absent/unparseable contract yields a no-claim report; the CLI always exits 0 and
// never throws to its caller. Exposes pure functions (extract / glob / scopeDiff / acCoverage /
// formatReport / resolveContractPath) for the test suite; main() wraps them over git under the
// import.meta.url guard.
//
// SECOND MODE, deliberately fail-CLOSED: `--provenance` verifies the batch a task has ALREADY
// COMMITTED (TP §11b.9c Step 6), by delegating to the accepted committed-batch consumer. It is no
// longer a historical base-provenance check standing on its own: the authority is the version-2
// inventorySnapshot inside the committed head, the base tree is read and witness-checked as part of
// that, and the two source digests are recomputed against the current repository. Its argument
// contract changed with it -- `--task <id>` is REQUIRED and `--inventory` is REFUSED, both announced
// at the call site below. The default contract mode keeps its fail-open, always-exit-0 contract
// untouched; --provenance emits a machine result and exits non-zero on any violation. The two modes
// never share an exit path.
import fs from "node:fs";
import path from "node:path";
import cp from "node:child_process";
import { fileURLToPath } from "node:url";
// The accepted Step 6 committed-batch consumer. It owns the whole provenance verdict, so this file
// imports no store, inventory or Git primitive for that mode any more -- the retirement note below
// records what went with them.
import { verifyCommittedBatch } from "./committed-batch-consumer.mjs";

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
// --- RETIRED: the legacy historical base-provenance consumer -----------------------------------
//
// `checkHistoricalBaseProvenance()` and `readBaseTreeStoreBytes()` used to live here and are now
// RETIRED exports. Nothing imported either one: their only caller was this file's own --provenance
// route, which now delegates to the accepted committed-batch consumer.
//
// WHY RETIRED rather than migrated. The old helper read the v1 scratch envelope through
// loadInventory(), and TP §2:274-276 requires every v1 envelope -- populated or empty -- to be
// refused and regenerated once v2 rolls out, because it carries neither registryDigest nor
// headViewDigest and so 根本無法證明自己涵蓋了什麼. Keeping it would have preserved a second,
// scratch-based pass path whose input the rollout forbids as an authority. Its raw Git reader also
// carried three defects the shared hardened reader does not: an inherited Git environment with no
// --no-replace-objects/--no-lazy-fetch, a type-only leaf check that admitted a mode-120000 symlink,
// and validateAll(historical) sampling the CURRENT clock for a historical store. It did correctly
// distinguish object/list/blob I/O failures from an empty listing; that behaviour survives in the
// shared reader.
//
// REPLACEMENTS, all already accepted:
//   committed-batch verification  -> verifyCommittedBatch({ repoRoot, taskId }) in
//                                    committed-batch-consumer.mjs (this file's --provenance mode)
//   exact-tree raw blob read      -> readExactTreeBlob() in exact-tree-blob.mjs
//   historical store validation   -> validateHistoricalStore() in provenance-store.mjs, which is
//                                    clock-free and dispatches v1 to validateHistoricalLegacyV1
// Historical v1 base trees, the raw-byte witness comparison and legacy RECORD history all remain
// supported through those components; only this duplicate lane is gone.

export const KNOWN_FLAGS = ["--contract", "--base", "--provenance", "--inventory", "--cwd", "--task"];

// `--provenance` selects a mode and takes no value, so it can never occupy another flag's value
// slot. It still belongs in KNOWN_FLAGS — that list is what `get()` guards against swallowing — but
// the value-slot matrix is over the flags that actually take one. DERIVED from KNOWN_FLAGS rather
// than written out again, so the two cannot drift apart.
export const VALUELESS_FLAGS = ["--provenance"];
export const VALUE_FLAGS = KNOWN_FLAGS.filter((f) => !VALUELESS_FLAGS.includes(f));

async function main(argv) {
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
  // The two modes never share an exit path: --provenance is fail-closed and returns before the
  // fail-open contract report is even assembled.
  //
  // STEP 6 AUTHORITY. This mode now delegates to the accepted committed-batch consumer, which reads
  // the validated current store, the NAMED task's unique committed head and the version-2 inventory
  // preimage inside it. Three consequences, each announced rather than silent:
  //
  //   --task is REQUIRED. The retired helper inferred a task when the store held exactly one
  //     TaskState, which made the same invocation mean different things as the store grew.
  //   --inventory is REFUSED here. Scratch is not an authority for Step 6 -- the consumer never opens
  //     it -- so a caller passing it is told, rather than quietly getting a scratch-free verdict.
  //   A legacy (v1.12) committed head does not fall back to a pass. It refuses with the reader's own
  //     E_NO_INVENTORY_PREIMAGE, which means rerun the loop.
  //
  // ONE call, and no pre-branching: the store is not loaded here to inspect the head first, because
  // that would duplicate the authority capture the component already performs.
  if (args.includes("--provenance")) {
    const cwd = get("--cwd", "") || process.cwd();
    const taskId = get("--task", "");
    const violations = [];
    if (!taskId) {
      violations.push("E_API_ARGUMENTS: --provenance requires --task <id>; this mode verifies one named task's "
        + "committed head and does not infer a task from the store");
    }
    if (args.includes("--inventory")) {
      violations.push("E_API_ARGUMENTS: --inventory is not accepted in --provenance mode; the committed "
        + "inventorySnapshot is the authority and scratch is never read");
    }
    if (violations.length === 0) {
      try {
        const verdict = await verifyCommittedBatch({ repoRoot: cwd, taskId });
        process.stdout.write(`${JSON.stringify({ provenance: { status: "pass", ...verdict, violations: [] } })}\n`);
        process.exit(0);
      } catch (error) {
        // Upstream typed causes survive: the code is the component's or its dependency's, never
        // re-labelled. No ref or digest is invented for a run that did not produce a verdict.
        const code = error && typeof error.code === "string" ? error.code : "E_UNEXPECTED";
        violations.push(`${code}: ${error && error.message}`);
      }
    }
    process.stdout.write(`${JSON.stringify({ provenance: { status: "fail", taskId, violations } })}\n`);
    process.exit(1);
  }

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

// isInvokedDirectly() kept in sync with the other 14 CLI entry points (documented copy — see garden hash guard)
function isInvokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

// The guard itself is unchanged. main() became async when --provenance started awaiting the committed
// consumer, so its rejection is caught here rather than surfacing as an unhandled rejection: the
// fail-open default report must still exit 0, and the fail-closed mode must exit non-zero with a
// machine-readable cause rather than a stack trace.
if (isInvokedDirectly()) {
  main(process.argv).catch((error) => {
    const code = error && typeof error.code === "string" ? error.code : "E_UNEXPECTED";
    process.stderr.write(`${JSON.stringify({ ok: false, code, message: error && error.message })}\n`);
    process.exit(1);
  });
}
