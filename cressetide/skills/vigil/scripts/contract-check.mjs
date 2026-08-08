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
// SECOND MODE, deliberately fail-CLOSED: `--provenance` verifies the historical base-provenance
// witness chain (TP AC60). The default contract mode keeps its fail-open, always-exit-0 contract
// untouched; --provenance emits a machine result and exits non-zero on any violation, including any
// input shape this build does not fully implement. The two modes never share an exit path.
import fs from "node:fs";
import path from "node:path";
import cp from "node:child_process";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  loadStore, parseStore, storeDigest, emptyStore, indexStore, canonicalJson, digestOf,
  validateAll, validateLegacyV1, CANONICAL_STORE_PATH, PROVENANCE_VERSION, LEGACY_PROVENANCE_VERSION,
} from "./provenance-store.mjs";
import { loadInventory, InventoryError, INVENTORY_PATH } from "./changed-test-inventory.mjs";

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
// --- historical base-provenance consumer (TP AC60) ---------------------------------------------
// Read-only over an IMMUTABLE Git base tree. It never migrates, never writes back, and never
// normalises bytes before the witness comparison.

class ProvenanceViolation extends Error {
  constructor(message) {
    super(message);
    this.name = "ProvenanceViolation";
  }
}

function violate(message) {
  throw new ProvenanceViolation(message);
}

function git(args, cwd) {
  // Parameterised argv, never a composed shell string: a treeOid or path is DATA here.
  return cp.execFileSync("git", args, {
    cwd, encoding: "buffer", stdio: ["ignore", "pipe", "pipe"], timeout: 15000, maxBuffer: 32 * 1024 * 1024,
  });
}

// Three outcomes that must stay apart, because collapsing any two of them turns a broken repository
// into "this base simply had no prior state":
//   • the tree, the path lookup, or the blob read FAILS            → fail closed
//   • the tree reads and holds nothing at that path                → the one legal missing-store
//   • the path exists but is not a blob, or the blob will not read  → fail closed
// "any cat-file exception means absent" cannot tell these apart, so the path is looked up with
// ls-tree first and only an EMPTY listing counts as absent.
export function readBaseTreeStoreBytes(cwd, treeOid, storePath) {
  // The witness must BE a tree, not merely something Git can peel into one. `rev-parse --verify
  // <oid>^{tree}` succeeds on a commit and quietly hands back a DIFFERENT oid, and `ls-tree` accepts
  // a commit too — so peelability proves nothing about the declared object's own type, and a
  // TaskState naming a commit would have been read against the tree that commit points at. Ask for
  // the type of exactly the oid we were given, and never substitute the peeled one for it.
  let type;
  try {
    type = git(["cat-file", "-t", treeOid], cwd).toString("utf8").trim();
  } catch (e) {
    violate(`base tree ${treeOid} does not resolve to any Git object — a Git or object failure is never treated as "no store in the tree"`);
  }
  if (type !== "tree") {
    violate(`baseProvenance.treeOid ${treeOid} is a ${type}, not a tree — the witness names an exact tree object, and a peelable commit or tag is not equivalent to the tree it points at`);
  }
  let listing;
  try {
    listing = git(["ls-tree", "-z", "--full-tree", treeOid, "--", storePath], cwd).toString("utf8");
  } catch (e) {
    violate(`cannot list ${storePath} in base tree ${treeOid} (git ls-tree failed) — a Git failure is never treated as "no store in the tree"`);
  }
  const records = listing.split("\0").filter((r) => r.length > 0);
  if (records.length === 0) return { present: false, bytes: null };
  if (records.length > 1) {
    violate(`base tree ${treeOid} lists ${records.length} entries for ${storePath} — ambiguous, refusing rather than choosing one`);
  }
  // "<mode> SP <type> SP <oid> TAB <path>"
  const meta = records[0].split("\t")[0].split(/\s+/);
  const [, entryType, oid] = meta;
  if (entryType !== "blob") {
    violate(`${storePath} in base tree ${treeOid} is a ${entryType}, not a blob`);
  }
  try {
    return { present: true, bytes: git(["cat-file", "blob", oid], cwd) };
  } catch (e) {
    violate(`blob ${oid} for ${storePath} in base tree ${treeOid} cannot be read (${e && e.code}) — a corrupt or unreadable object is never treated as "no store in the tree"`);
  }
  return { present: false, bytes: null }; // unreachable; violate() throws
}

export function checkHistoricalBaseProvenance({ cwd, inventoryPath, taskId }) {
  const violations = [];

  // 1. the CURRENT store. loadStore() only PARSES — it is not authoritative validation, so nothing
  //    below may consume the index until validateAll() has passed over the whole snapshot. A
  //    corrupted batchDigest, a broken or multi-tip chain, or a committed ref that is not the unique
  //    tip all live in that validation, and reading TaskState first would step straight past them.
  let current;
  try {
    current = loadStore(cwd).store;
  } catch (e) {
    return { status: "fail", violations: [`current provenance store is unreadable: ${e && e.message}`] };
  }
  if (current.provenanceVersion !== PROVENANCE_VERSION) {
    return {
      status: "fail",
      violations: [
        `current provenance store is provenanceVersion ${current.provenanceVersion}; this checker is read-only and will not migrate it`,
      ],
    };
  }

  try {
    validateAll(current);

    // 2. the inventory carrier, in its canonical §6 shape with the digest recomputed.
    const inventory = loadInventory(inventoryPath);

    const index = indexStore(current);
    const states = [...index.taskStates.values()];
    const ts = taskId ? states.find((t) => t.taskId === taskId) : (states.length === 1 ? states[0] : null);
    if (!ts) {
      violate(taskId
        ? `no TaskState for taskId ${taskId}`
        : `the store holds ${states.length} TaskStates; name one with --task`);
    }
    const base = ts.baseProvenance;

    // 3. witness coherence, settled before a single byte of history is read. The canonical store path
    //    comes from the TaskState witness — the inventory does not carry a second copy of it.
    if (base.storePath !== CANONICAL_STORE_PATH) {
      violate(`TaskState ${ts.taskId} baseProvenance.storePath is ${base.storePath}, not the canonical ${CANONICAL_STORE_PATH}`);
    }
    if (base.treeOid !== inventory.baseTreeOid) {
      violate(`baseProvenance.treeOid ${base.treeOid} does not equal the inventory's baseTreeOid ${inventory.baseTreeOid}`);
    }

    // 4. Step 6 CONSUMES the committed batch. A null head is a legitimate "not submitted yet, rerun
    //    the loop" state — and it is not something this checker may pass, because there is no
    //    committed provenance to check against.
    const head = ts.committedProvenanceBatchRef;
    if (!head) {
      violate(`TaskState ${ts.taskId} has no committedProvenanceBatchRef — nothing has been submitted yet, so there is no committed provenance to verify; rerun the loop through Step 5`);
    }
    const batch = index.records.get(head.ref);
    if (!batch || batch.kind !== "provenance-batch") {
      violate(`committedProvenanceBatchRef ${head.ref} does not resolve to a provenance-batch record`);
    }
    if (batch.taskId !== ts.taskId) {
      violate(`batch ${batch.recordId} belongs to task ${batch.taskId}, not ${ts.taskId}`);
    }
    const snapshot = batch.batchSnapshot;
    if (digestOf(snapshot) !== batch.batchDigest) {
      violate(`batch ${batch.recordId} batchDigest does not match its own batchSnapshot`);
    }
    if (canonicalJson(snapshot && snapshot.baseProvenance) !== canonicalJson(base)) {
      violate(`batch ${batch.recordId} carries a baseProvenance witness that differs from TaskState ${ts.taskId}`);
    }
    if (batch.inventoryDigest !== inventory.inventoryDigest) {
      violate(`batch ${batch.recordId} was committed against inventoryDigest ${batch.inventoryDigest}, but this run's inventory digests to ${inventory.inventoryDigest} — the batch is stale for this inventory`);
    }

    // 5. the authorised vertical slice. A non-empty inventory needs the results / body / tag
    //    freshness consumers, which are not implemented: reading the entries and passing anyway is
    //    precisely the partial gate this mode exists to refuse.
    const results = (snapshot && Array.isArray(snapshot.results)) ? snapshot.results : null;
    if (results === null) {
      violate(`batch ${batch.recordId} batchSnapshot carries no results array`);
    }
    if (inventory.entries.length !== 0 || results.length !== 0) {
      violate(
        `this build verifies the clean vertical slice only (entries=[] with results=[]); got `
        + `${inventory.entries.length} inventory entries and ${results.length} batch results. The per-result `
        + `body/tag freshness consumers are not implemented, so a populated inventory fails closed rather than passing unread`,
      );
    }

    // 6. RAW bytes → digest → parse → version dispatch, in that order. Normalising first would let a
    //    store whose bytes differ from the witness pass by being cleaned up on the way in.
    const read = readBaseTreeStoreBytes(cwd, base.treeOid, base.storePath);
    let historical;
    let priorStateExists;
    if (!read.present) {
      // A base tree with no store IS the canonical empty store — shared model §2's single
      // definition, imported from the writer module rather than restated here.
      const empty = emptyStore();
      if (base.storeDigest !== storeDigest(empty)) {
        violate(`base tree ${base.treeOid} has no ${base.storePath}, so the witness digest must be the canonical empty store's; got ${base.storeDigest}`);
      }
      historical = empty;
      priorStateExists = false;
    } else {
      const rawDigest = crypto.createHash("sha256").update(read.bytes).digest("hex");
      if (rawDigest !== base.storeDigest) {
        violate(`base tree store raw-byte digest ${rawDigest} does not equal the witness ${base.storeDigest} — the comparison is against RAW bytes, never a normalised form`);
      }
      historical = parseStore(read.bytes.toString("utf8"));
      priorStateExists = true;
    }

    // 7. read-only validation, dispatched on the HISTORICAL store's own version. A v1 base tree is
    //    validated by the legacy rules and left exactly as it is: no migration, no write-back, no
    //    reopenCauseRef backfill, and the normalised form never stands in for the raw bytes.
    if (historical.provenanceVersion === LEGACY_PROVENANCE_VERSION) {
      validateLegacyV1(historical);
    } else if (historical.provenanceVersion === PROVENANCE_VERSION) {
      validateAll(historical);
    } else {
      violate(`base tree store has unsupported provenanceVersion ${JSON.stringify(historical.provenanceVersion)}`);
    }

    return {
      status: "pass",
      taskId: ts.taskId,
      baseTreeOid: base.treeOid,
      committedBatchRef: batch.recordId,
      historicalVersion: historical.provenanceVersion,
      priorStateExists,
      violations: [],
    };
  } catch (e) {
    if (e instanceof ProvenanceViolation || e instanceof InventoryError) violations.push(e.message);
    else if (e && typeof e.code === "string") violations.push(`${e.code}: ${e.message}`);
    else violations.push(String(e && e.message ? e.message : e));
    return { status: "fail", violations };
  }
}

export const KNOWN_FLAGS = ["--contract", "--base", "--provenance", "--inventory", "--cwd", "--task"];

// `--provenance` selects a mode and takes no value, so it can never occupy another flag's value
// slot. It still belongs in KNOWN_FLAGS — that list is what `get()` guards against swallowing — but
// the value-slot matrix is over the flags that actually take one. DERIVED from KNOWN_FLAGS rather
// than written out again, so the two cannot drift apart.
export const VALUELESS_FLAGS = ["--provenance"];
export const VALUE_FLAGS = KNOWN_FLAGS.filter((f) => !VALUELESS_FLAGS.includes(f));

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
  // The two modes never share an exit path: --provenance is fail-closed and returns before the
  // fail-open contract report is even assembled.
  if (args.includes("--provenance")) {
    const cwd = get("--cwd", "") || process.cwd();
    const result = checkHistoricalBaseProvenance({
      cwd,
      inventoryPath: get("--inventory", "") || path.join(cwd, INVENTORY_PATH),
      taskId: get("--task", ""),
    });
    process.stdout.write(`${JSON.stringify({ provenance: result })}\n`);
    process.exit(result.status === "pass" ? 0 : 1);
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

// isInvokedDirectly() kept in sync with the other 13 CLI entry points (documented copy — see garden hash guard)
function isInvokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isInvokedDirectly()) main(process.argv);
