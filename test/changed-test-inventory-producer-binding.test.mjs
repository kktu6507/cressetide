// AC176 evidence: binding semantic validation, the ten post-binding obligations, the witness
// carve-out, §7, task resolution and the historical/raw-witness boundary -- end to end through the
// real produceChangedTestInventoryV2().
//
// SCOPE NOTE: a green run here does not establish AC118, AC136, AC137 or AC138, and does not mean
// Phase 2 is ready. It is not producer acceptance either: that is an independent review's call, on
// the whole diff. (This note used to add that the run does not lift the
// unsupported-populated-inventory gate; that gate is retired, so there is nothing left to lift.)
//
// EVIDENCE MAP -- one row per AC176 sub-cell, naming WHERE it is proved and WHAT KIND of evidence
// that is. B = behavioural (a real invocation whose public result differs from what a wrong
// implementation returns), S = structural (source/control-flow inspection, because no public
// discriminator exists), O = ordering (§11b.10c shape B: a single-point edit in a disposable
// scratch source copy, run in a child process), N = expressly not constructible under a legal G1,
// recorded with its derivation rather than faked. "matrix" = changed-test-inventory-producer-matrix,
// "iface" = changed-test-inventory-producer, "hist" = provenance-historical-validator.
//
//   (1)      B  this file, "(1)(2) ... ob-1, not at task resolution" + its single-variable control
//   (2)      B  same test: legal populated C, one matching TaskState, clause absent -> ob-1
//   (3)      B  this file, "(3) ... NOT in transitionedClauses"; the UNCHANGED-pair half is
//               "(3)(11d-1) an UNCHANGED pair is still charged"; the witness-1 positive is
//               matrix "(b1) + AC176 (11c)"
//   (4)      B  this file, "(4)(12) ... five §7 conditions" (terminal-mismatch limb + control)
//   (5)      B  this file, "(5)(10) ... not charged current effectivity"; (5-req) is the same test's
//               deleted + legal-retag head sides
//   (6)      B  this file, "(6)(10) ... named as base side" (dangling base binding)
//   (7)      B  this file, "(7) EXPL and an absent base tag are not newly refused"
//   (8)      O  this file, "(8) ... exactly twice, G1 then G2" (counting proxy, ordered trace)
//   (8b)     O  this file, "(8b) ... AFTER binding validation and BEFORE G2", anchored to the END of
//               the binding work; the same test runs a second scratch core with G2 moved before the
//               continuation and asserts that variant SUCCEEDS -- i.e. the case really discriminates
//   (9)      B  this file, "(9)(9b) ... key sets, carrier, envelope"
//   (9b)     S  same test: export lists of BOTH facades AND the common implementation module
//   (10)     B  this file, "(6)(10)" (pre-binding Check A negative) and "(5)(10)" (positives)
//   (10b)    B  this file, "(10b) historical B ..." positive + non-temporal negative + four
//               invalid-historical controls; the version-grammar half is hist's v1 terminal cases
//   (10c)    B  this file, "(10c) ... RAW base witness", including a BOM+CRLF pretty-printed Git
//               blob where the raw, canonicalText and canonical-serialisation digests all differ
//   (11a)    B  the ten obligations are exercised across (1)(3)(11a-set-A)(11b)(11d-3)(11d-4)
//   (11a-set-A) B this file, "(11a-set-A) ... NON-FIRST direct Source failing Check A"
//   (11a-set-B) S covered by (11a-ob5): Check B's per-member evaluation has no public discriminator
//   (11a-ob5) S  this file, "(11a-ob5) ... STRUCTURAL evidence" -- and N for the red/green half
//   (11b)    B  layer 2: this file, "(11b-layer 2) ... dangling RecordRef"; ob-4 via (11a-set-A);
//               ob-1 via (1). layers 1 and 1b: "(11b-layer 1 and 1b) ..." with the authoritative
//               codes and details preserved
//   (11c)    B  matrix "(b1) + AC176 (11c)" (ob-3/witness-1) and matrix "(b2 driftedClauses)"
//               (ob-5/witness-2); the REQ-side witness-3 positive is N, matrix "(b3) withdrawn"
//   (11d-1)  B  this file, "(3)(11d-1) an UNCHANGED pair ..." and matrix "(b0-neg)(i)(ii)"
//   (11d-2)  B  matrix "(b0-neg)(i)(ii)" second half: witness-2 must not excuse ob-3
//   (11d-3)  B  this file, "(11d-3) ob-4 stays fail-closed even when the clause IS in driftedClauses"
//   (11d-4)  B  this file, "(11d-4) a DEC/ASSUM whose basisRefs hold an EXPIRED grant"
//   (11e)    B  this file, "(11e)(18) an exemption is not a pass"
//   (11f)    B  four tests here, by sub-cell:
//               (i)-(v)  the five newline/BOM spellings, on ONE fixture whose clause, Source and
//                        bound test are identical in B and C with no second lifecycle cause: each
//                        variant asserts an empty seed AND empty producer entries, so ob-5's
//                        post-binding Check B is charged too
//               (vi)     true drift, on the same fixture
//               (vii)    per variant, through the PUBLIC captureHeadViewSnapshot: H's read bytes,
//                        the entry contentDigest against an independent raw sha256, and the head
//                        digest tied to both the carrier and the envelope; plus per-variant
//                        repository-byte and store/excerpt immutability, and the five raw digests
//                        being pairwise distinct
//               (viii)   an unrelated non-UTF-8 blob is accepted and changes nothing
//               (ix)     the U+FFFD replacement discriminator, which also runs a scratch core with
//                        a LOSSY transform and asserts that mutant answers differently
//               (x)      a REAL capture-layer read failure (EISDIR on an identified fixture blob,
//                        induced in a disposable source copy) -> production's own E_READ_FAILED,
//                        no entries, no envelope; plus the empty/BOM-only excerpt failures at the
//                        seed layer and the non-string excerpt at the store layer
//   (12)     B  this file, "(4)(12)": three constructible single-variable negatives; the
//               applicable() and scopeRulingRef limbs are N, with executable proof that any store
//               exercising them is itself invalid
//   (13)(14) B  this file, "(13)(14) ... 0/1/many", including the historical-DP zero case
//   (15)(16) B  this file, "(15)(16) ..."; the duplicate-taskId limb is recorded at the store layer
//   (17)     B  this file, "(17) taskId reaches neither ..." with a two-TaskState discriminator
//   (18)     B  this file, "(11e)(18)"; iface "a cross-binding failure ... writes nothing" adds the
//               cross-binding variant
//   AC173 (i)(j) B iface, "the output passes the canonical reader AND the product entry point still
//               refuses it" -- on a genuinely populated envelope (added + modified)
//
// The CAS contract (§11b.9c current-store digest) is proved here by "(8)+(11b) the current-store CAS
// digest is over the CAPTURED TEXT", which also carries the formatting-only G1/G2 mutation.
//
// Spec anchors (the current approved coupled set, one effective set):
//   SM = 2026-07-25-shared-decision-provenance-model.md (approved v1.15) §2, §9
//   TP = 2026-07-25-test-provenance-spec.md (approved v1.17) §7, §11b.10c, AC176
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cp from "node:child_process";
import crypto from "node:crypto";

import { root } from "./helpers.mjs";
import {
  emptyStore, canonicalStoreBytes, storeDigest, sha256Hex, digestOf, validateAll, validateStoreSchema,
  CANONICAL_STORE_PATH,
} from "../cressetide/skills/vigil/scripts/provenance-store.mjs";
import { V2_INVENTORY_KEYS } from "../cressetide/skills/vigil/scripts/changed-test-inventory.mjs";
import {
  produceChangedTestInventoryV2, InventoryProducerError,
} from "../cressetide/skills/vigil/scripts/changed-test-inventory-producer.mjs";
import { buildGovernanceSeedPreimage } from "../cressetide/skills/vigil/scripts/governance-seed-preimage.mjs";
// The PUBLIC capture API, used to observe the head view independently of the producer. The
// producer's own H stays private inside its invocation; this captures a second one from the same
// fixture and compares the digests, which is what makes it evidence rather than a peek.
import { captureHeadViewSnapshot } from "../cressetide/skills/vigil/scripts/head-view-snapshot.mjs";

const SCRIPTS = path.join(root, "cressetide", "skills", "vigil", "scripts");
const CORE = path.join("cressetide", "skills", "vigil", "scripts", "governance-producer-core.mjs");
// shared §9 Check B byte rule / search face / occurrence count, extracted so the Step 6 consumer
// charges the SAME rule. The property these cases prove is unchanged; only its file moved.
const OCCURRENCE = path.join("cressetide", "skills", "vigil", "scripts", "source-occurrence.mjs");
const NODE_TEST = 'import { test } from "node:test";\n';
const NOW = Date.UTC(2026, 6, 26);
const TASK = "TASK-1";
const CODE = { kind: "discipline", discipline: "code" };
const INTENT = { kind: "discipline", discipline: "intent" };

const U = (tail) => "01J000000000000000000000" + tail;
const REQ = (t) => `REQ-${U(t)}`;
const DEC = (t) => `DEC-${U(t)}`;
const ASSUM = (t) => `ASSUM-${U(t)}`;
const ABSENT = REQ("0Z");            // a legal ULID that is in no store
// A tag's dpRef must be DP- plus a canonical ULID, so the §7 fixtures below use canonical DP ids.
const DP7 = `DP-${U("07")}`;
const DP8 = `DP-${U("08")}`;

const rawDigest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const legal = (s) => { validateAll(s, { now: NOW }); return s; };
const tagged = (ref, name, body = "") => `${NODE_TEST}// @src ${ref}\ntest("${name}", () => {${body}});\n`;
const byPath = (entries) => Object.fromEntries(entries.map((e) => [e.testRef.path, e]));

// --- repository ---------------------------------------------------------------------------------

function makeRepo(prefix = "ctide-ac176-") {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  const git = (...a) => cp.execFileSync("git", a, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q", "--initial-branch=main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  git("config", "core.symlinks", "false");
  // Deterministic bytes in and out of the object database: no end-of-line conversion, so a fixture
  // that deliberately commits CRLF or a BOM really does store those bytes.
  git("config", "core.autocrlf", "false");
  git("config", "core.eol", "lf");
  const gitBytes = (...a) => cp.execFileSync("git", a, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  const storeFile = path.join(dir, ".ctide", "provenance.json");
  const write = (rel, body) => {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  };
  let committed = null;
  let committedStoreDigest = storeDigest(emptyStore());
  let committedStoreBytes = null;
  return {
    root: dir, git, gitBytes, write,
    remove: (rel) => fs.rmSync(path.join(dir, rel), { force: true }),
    bytes: (rel) => fs.readFileSync(path.join(dir, rel)),
    // The base store goes into the TREE; the witness digest is taken over its ORIGINAL bytes, which
    // is what shared §9 says the witness attests to.
    putBaseStore: (store) => write(".ctide/provenance.json", canonicalStoreBytes(store)),
    commit: () => {
      git("add", "-A"); git("commit", "-qm", "c"); committed = git("rev-parse", "HEAD^{tree}");
      // Derived from the ACTUAL Git blob, not from the working-tree file: that is the object the
      // producer reads, and it is the only thing that controls for any end-of-line conversion.
      committedStoreDigest = storeDigest(emptyStore());
      committedStoreBytes = null;
      if (fs.existsSync(storeFile)) {
        const oid = git("rev-parse", `${committed}:${CANONICAL_STORE_PATH}`);
        committedStoreBytes = gitBytes("cat-file", "blob", oid);
        committedStoreDigest = rawDigest(committedStoreBytes);
      }
      return committed;
    },
    baseDigest: () => committedStoreDigest,
    baseBytes: () => committedStoreBytes,
    // The CURRENT store, carrying the task whose witness names the tree just committed.
    putStore: (store, { dpIds = [], taskId = TASK, treeOid, storeDigest: digest, tasks } = {}) => {
      const s = JSON.parse(JSON.stringify(store));
      s.taskStates = tasks || [{
        taskId,
        baseProvenance: {
          treeOid: treeOid === undefined ? committed : treeOid,
          storePath: CANONICAL_STORE_PATH,
          storeDigest: digest === undefined ? committedStoreDigest : digest,
        },
        currentTaskDpIds: dpIds,
      }];
      write(".ctide/provenance.json", canonicalStoreBytes(s));
      return s;
    },
  };
}

async function withRepo(body, prefix) {
  const repo = makeRepo(prefix);
  try { return await body(repo); } finally { fs.rmSync(repo.root, { recursive: true, force: true }); }
}

const produce = (repo, oid, taskId = TASK) =>
  produceChangedTestInventoryV2({ repoRoot: repo.root, baseTreeOid: oid, taskId });

// `own` asks whether the failure must wear the PRODUCER's error type. Layer-1 refusals must not:
// §11b.10c preserves the store's authoritative code and cause as they stand, so those surface as
// the store's own ProvenanceError rather than being re-labelled by this component.
async function refused(repo, oid, what, code, { taskId = TASK, own = true } = {}) {
  let error = null;
  try { await produce(repo, oid, taskId); } catch (e) { error = e; }
  assert.ok(error && error.code, `${what}: expected a coded failure, got ${error}`);
  if (own) assert.ok(error instanceof InventoryProducerError, `${what}: the producer's own error type`);
  if (code) assert.strictEqual(error.code, code, `${what}: expected ${code}, got ${error.code} (${error.message})`);
  return error;
}

// --- provenance fixtures --------------------------------------------------------------------------

// One owner record, one snapshot-only Source and one hard-constraint REQ: the spine every exception
// chain below hangs off.
function baseStore() {
  const s = emptyStore();
  s.records.push({ recordId: "R-owner", kind: "source-authority", authorityIdentity: "EU DPA" });
  s.sources.push({
    sourceId: "S-inert", contentKind: "requirement", driftMode: "snapshot-only",
    locator: "c#1", excerpt: "inert", digest: sha256Hex("inert"),
  });
  s.sources.push({
    sourceId: "S-hc", contentKind: "policy", driftMode: "snapshot-only",
    locator: "p#1", excerpt: "PII stays in the EU", digest: sha256Hex("PII stays in the EU"),
  });
  s.clauses.push({
    id: REQ("0A"), authority: "hard-constraint", kind: "specification",
    text: "PII stays in the EU", sourceRef: "S-hc", ownerRef: { kind: "source-authority", ref: "R-owner" },
  });
  return s;
}

const plainReq = (s, id, sourceRef = "S-inert") => {
  s.clauses.push({
    id, authority: "approved-requirement", kind: "specification",
    text: `clause ${id}`, sourceRef, taskRef: TASK,
  });
  return s;
};

const withSource = (s, { sourceId, excerpt, driftMode = "repo-file", contentKind = "requirement", digest }) => {
  s.sources.push({
    sourceId, contentKind, driftMode, locator: "d#1", excerpt,
    digest: digest === undefined ? sha256Hex(excerpt) : digest,
  });
  return s;
};

const withGrant = (s, { sourceId = "S-exc", expiry, target = REQ("0A"), owner = { kind: "source-authority", ref: "R-owner" } }) => {
  s.sources.push({
    sourceId, contentKind: "exception-grant", driftMode: "snapshot-only", locator: "g#1",
    excerpt: `grant ${sourceId}`, digest: sha256Hex(`grant ${sourceId}`), targetConstraintRef: target,
    grantAuthorityRef: owner, scope: "eu", expiry,
  });
  return s;
};

// A DecisionPoint the DEC/ASSUM fixtures hang off. `open` by default, so those clauses are NOT any
// DP's current terminal -- which is what keeps INV-4 out of the fixtures that must reach binding
// validation.
const withDp = (s, { id = "DP-1" } = {}) => {
  s.decisionPoints.push({
    id, dimension: "data", scenario: "s", alternatives: ["A", "B"], layer: "implementation",
    classificationBasis: "engineering standard", materialReasons: [], status: "open", reopenCauseRef: null,
  });
  return s;
};

const withAssum = (s, { clauseId, basisRefs, dp = "DP-1" }) => {
  s.clauses.push({
    id: clauseId, authority: "approved-requirement", kind: "specification", text: "a",
    derivedFrom: dp, governedBy: CODE, basisRefs, layer: "implementation",
    routingOrigin: "safe-default", alternative: "B", assumedAs: "A",
  });
  return s;
};

const withDec = (s, { clauseId, basisRefs = [], recordId = "R-dec", dp = "DP-1", extra = [] }) => {
  const packet = {
    dpId: dp, scenario: "s", alternatives: ["A", "B"], layer: "implementation",
    classificationBasis: "engineering standard", materialReasons: [], requestedPrincipal: CODE, basisRefs: [],
  };
  s.records.push({
    recordId, kind: "review-ruling", by: CODE, subjectRef: dp, ruling: "ok",
    rulingKind: "technical-decision", basis: "stated basis",
    inputPacketSnapshot: packet, inputPacketDigest: digestOf(packet),
    decision: "chose A", approvedBy: CODE, selectedAlternative: "A", rejectedAlternatives: ["B"],
  });
  s.clauses.push({
    id: clauseId, authority: "approved-requirement", kind: "specification", text: "d",
    derivedFrom: dp, approvedBy: CODE, layer: "implementation", decision: "A", alternatives: ["A", "B"],
    basisRefs: [...basisRefs, { kind: "review-ruling", ref: recordId }, ...extra],
  });
  return s;
};

const withTransition = (s, { id, subject, ackId = "R-ack" }) => {
  s.records.push({
    recordId: ackId, kind: "plan-gate", target: subject, successor: null,
    impact: "no consumers", disposition: "no-affected-dependents", approvedBy: "user",
  });
  s.transitions.push({
    id, subject, action: "retire", authorityRef: { kind: "user" },
    effectiveAt: "2026-01-01T00:00:00.000Z", ackRef: { kind: "plan-gate", ref: ackId },
  });
  return s;
};

// A resolved DP whose terminal is an exception-backed REQ, with the scope ruling §7 requires.
function withResolvedDp(s, { dpId = DP7, req, ruling = "R-scope" }) {
  const packet = {
    dpId, scenario: "s", alternatives: ["A", "B"], layer: "intent",
    classificationBasis: "policy", materialReasons: [], requestedPrincipal: INTENT, basisRefs: [],
  };
  s.records.push({
    recordId: ruling, kind: "review-ruling", by: INTENT, subjectRef: dpId, ruling: "covered",
    rulingKind: "scope-coverage", basis: "stated basis", scopeCovers: true,
    inputPacketSnapshot: packet, inputPacketDigest: digestOf(packet),
  });
  s.decisionPoints.push({
    id: dpId, dimension: "data", scenario: "s", alternatives: ["A", "B"], layer: "intent",
    classificationBasis: "policy", materialReasons: [], status: "resolved", resolvedBy: req,
    scopeRulingRef: { kind: "review-ruling", ref: ruling }, reopenCauseRef: null,
  });
  return s;
}

// --- shape B: a disposable scratch copy of the scripts, edited at ONE point ------------------------

function scratchScripts(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  const vigil = path.join(dir, "cressetide", "skills", "vigil");
  fs.mkdirSync(vigil, { recursive: true });
  fs.cpSync(SCRIPTS, path.join(vigil, "scripts"), { recursive: true });
  fs.cpSync(path.join(root, "cressetide", "skills", "vigil", "vendor"), path.join(vigil, "vendor"), { recursive: true });
  return dir;
}

function patch(file, from, to) {
  const text = fs.readFileSync(file, "utf8");
  assert.strictEqual(text.split(from).length - 1, 1, `the single-point edit target must be unique: ${from}`);
  fs.writeFileSync(file, text.split(from).join(to), "utf8");
}

// The seed operation, run against a scratch copy of the scripts in a child process. Used to show
// that a deliberately WRONG Check B transform would answer differently -- i.e. that the evidence
// above is a discriminator and not a tautology.
function runSeedIn(scratch, repoRoot, baseTreeOid) {
  const script = path.join(scratch, "seed.mjs");
  fs.writeFileSync(script, [
    'const m = await import("./cressetide/skills/vigil/scripts/governance-seed-preimage.mjs");',
    "try {",
    `  const out = await m.buildGovernanceSeedPreimage({ repoRoot: ${JSON.stringify(repoRoot)}, baseTreeOid: ${JSON.stringify(baseTreeOid)} });`,
    "  console.log(JSON.stringify({ ok: true, seed: out.lifecycleAffectedClauses }));",
    "} catch (e) { console.log(JSON.stringify({ ok: false, code: e.code, message: String(e.message) })); }",
  ].join("\n"), "utf8");
  const r = cp.spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.strictEqual(r.status, 0, `the probe run must complete: ${r.stderr}`);
  return JSON.parse(r.stdout.trim());
}

function runProducerIn(scratch, repoRoot, baseTreeOid, prelude = "") {
  const script = path.join(scratch, "run.mjs");
  fs.writeFileSync(script, [
    prelude,
    'const m = await import("./cressetide/skills/vigil/scripts/changed-test-inventory-producer.mjs");',
    "try {",
    `  const out = await m.produceChangedTestInventoryV2({ repoRoot: ${JSON.stringify(repoRoot)}, baseTreeOid: ${JSON.stringify(baseTreeOid)}, taskId: ${JSON.stringify(TASK)} });`,
    "  console.log(JSON.stringify({ ok: true, keys: Object.keys(out).sort(), entries: out.entries.length, trace: globalThis.__trace }));",
    "} catch (e) { console.log(JSON.stringify({ ok: false, code: e.code, message: String(e.message), trace: globalThis.__trace })); }",
  ].join("\n"), "utf8");
  const r = cp.spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.strictEqual(r.status, 0, `the probe run must complete: ${r.stderr}`);
  return JSON.parse(r.stdout.trim());
}

// --- (1)(2) ob-1: a head binding that does not resolve --------------------------------------------

test("AC176 (1)(2): a head binding to a clause absent from C is fail-closed at ob-1, not at task resolution", () => withRepo(async (repo) => {
  // The v1.16 fixture -- "no provenance store at all" -- cannot reach binding validation under a
  // three-key request: an empty store carries no TaskState and the run stops at unknown task. So C
  // is a LEGAL, POPULATED v2 store with exactly one matching TaskState whose baseProvenance witness
  // names this tree; it simply does not contain the clause the head tag names.
  repo.write("keep.test.mjs", tagged(REQ("0B"), "keep"));
  repo.putBaseStore(legal(plainReq(baseStore(), REQ("0B"))));
  const oid = repo.commit();
  repo.write("ghost.test.mjs", tagged(ABSENT, "ghost"));          // head-only, binding a ghost
  repo.putStore(legal(plainReq(baseStore(), REQ("0B"))));

  const e = await refused(repo, oid, "a head binding to an absent clause", "E_HEAD_BINDING_UNRESOLVED");
  assert.strictEqual(e.detail.obligation, "ob-1", "the rejection is ob-1 -- binding validation, NOT task resolution");
  assert.strictEqual(e.detail.side, "head");
  assert.strictEqual(e.detail.testRef.path, "ghost.test.mjs");
  assert.deepStrictEqual(e.detail.binding, { clauseRef: ABSENT });
  assert.match(e.message, /does not resolve in the current store/);

  // Single-variable control: the same head-only test, rebound to a clause that satisfies all ten
  // obligations. This is the SAME success threshold (11) uses -- there is not a second, laxer one.
  repo.write("ghost.test.mjs", tagged(REQ("0B"), "ghost"));
  const out = await produce(repo, oid);
  assert.strictEqual(byPath(out.entries)["ghost.test.mjs"].status, "added", "the control produces normally");
}));

// --- (3) ob-3 and its witness --------------------------------------------------------------------

test("AC176 (3): a head binding to a non-active clause NOT in transitionedClauses is fail-closed", () => withRepo(async (repo) => {
  // Retired in B already, so C carries no NEW effective transition and witness-1 is absent.
  const store = () => legal(withTransition(plainReq(baseStore(), REQ("0B")), { id: "T-1", subject: REQ("0B") }));
  repo.write("t.test.mjs", tagged(REQ("0B"), "t"));
  repo.putBaseStore(store());
  const oid = repo.commit();
  repo.write("t.test.mjs", tagged(REQ("0B"), "t", " const x = 1; void x;"));   // in gate scope
  repo.putStore(store());

  const e = await refused(repo, oid, "an inactive clause with no witness-1", "E_HEAD_BINDING_INACTIVE");
  assert.strictEqual(e.detail.obligation, "ob-3");
  assert.match(e.message, /not in transitionedClauses/);
}));

test("AC176 (3)(11d-1): an UNCHANGED pair is still charged its binding -- omission is not a waiver", () => withRepo(async (repo) => {
  // THE BYPASS THIS CLOSES. `if (status === "unchanged") continue` used to run BEFORE both binding
  // assertions, so a test still bound to a clause retired in an EARLIER run -- identical body, tag
  // and path, no new Transition, no drift, no expiry, therefore no witness-1 -- produced entries: []
  // and a clean exit. §11b.10c's ordering step 6 says ALL pre/post-binding validation, and AC176
  // (3)/(11d-1) require refusal here. The test file is deliberately NOT modified: a body change
  // would reach the old code path and hide exactly this defect.
  const retired = () => legal(withTransition(plainReq(baseStore(), REQ("0B")), { id: "T-1", subject: REQ("0B") }));
  repo.write("still.test.mjs", tagged(REQ("0B"), "still"));
  repo.write("fine.test.mjs", tagged(REQ("0C"), "fine"));
  repo.putBaseStore(legal(plainReq(retired(), REQ("0C"))));
  const oid = repo.commit();
  repo.putStore(legal(plainReq(retired(), REQ("0C"))));          // byte-identical head side

  const e = await refused(repo, oid, "an unchanged test bound to an already-retired clause", "E_HEAD_BINDING_INACTIVE");
  assert.strictEqual(e.detail.obligation, "ob-3", "ob-3, with no witness-1 to excuse it");
  assert.strictEqual(e.detail.testRef.path, "still.test.mjs");
  assert.match(e.message, /not in transitionedClauses/);

  // The control: the same shape with an ACTIVE clause is still omitted from entries -- validating an
  // unchanged pair must not start emitting one.
  repo.remove("still.test.mjs");
  const out = await produce(repo, oid);
  assert.deepStrictEqual(out.entries.map((x) => x.testRef.path), ["still.test.mjs"],
    "removing the offending test leaves a deleted entry, and the untouched fine.test.mjs stays omitted");
  assert.strictEqual(out.entries[0].status, "deleted");
}));

// --- (4)(12)(13)(14) §7, in full -------------------------------------------------------------------

// The §7 spine: an exception-backed REQ, a resolved DP whose terminal IS that REQ, and the intent
// scope ruling. Everything below varies exactly one of the five conditions.
function reqAtDpStore({ expiry = "2099-01-01", dpStatus = "resolved", resolvedBy = REQ("0B"), subject = DP7 } = {}) {
  const s = withGrant(baseStore(), { expiry });
  plainReq(s, REQ("0B"), "S-exc");
  withResolvedDp(s, { req: REQ("0B") });
  const dp = s.decisionPoints.find((d) => d.id === DP7);
  dp.status = dpStatus;
  if (dpStatus !== "resolved") delete dp.resolvedBy; else dp.resolvedBy = resolvedBy;
  if (subject !== DP7) s.records.find((r) => r.recordId === "R-scope").subjectRef = subject;
  return s;
}

test("AC176 (4)(12): the qualified form charges all five §7 conditions, and the control produces normally", () => withRepo(async (repo) => {
  repo.putBaseStore(legal(reqAtDpStore()));
  const oid = repo.commit();
  repo.write("dp.test.mjs", tagged(`${REQ("0B")}@${DP7}`, "dp"));
  repo.putStore(legal(reqAtDpStore()), { dpIds: [DP7] });

  // Control first: all five §7 conditions and all ten obligations hold.
  const out = await produce(repo, oid);
  assert.strictEqual(byPath(out.entries)["dp.test.mjs"].status, "added", "the fully legal REQ@DP binding produces");
  assert.deepStrictEqual(out.entries[0].tagAfter, { clauseRef: REQ("0B"), dpRef: DP7 });

  // (12) negative 1: the DP is not in this task's currentTaskDpIds.
  repo.putStore(legal(reqAtDpStore()), { dpIds: [] });
  let e = await refused(repo, oid, "a DP outside currentTaskDpIds", "E_REQ_AT_DP");
  assert.match(e.message, /currentTaskDpIds/);

  // (12) negative 2: the DP status is not resolved. (An open DP has no terminal, so INV-4 is happy.)
  repo.putStore(legal(reqAtDpStore({ dpStatus: "open" })), { dpIds: [DP7] });
  e = await refused(repo, oid, "an unresolved DP", "E_REQ_AT_DP");
  assert.match(e.message, /not "resolved"/);

  // (12) negative 3 + (4): resolvedBy names a different REQ -- i.e. the DP's current terminal is not
  // this REQ. Both readings are the same fixture, and it must not degrade to EXPL or be omitted.
  const other = withGrant(reqAtDpStore({ resolvedBy: REQ("0C") }), { sourceId: "S-exc2", expiry: "2099-01-01" });
  plainReq(other, REQ("0C"), "S-exc2");
  repo.putStore(legal(other), { dpIds: [DP7] });
  e = await refused(repo, oid, "a DP resolved by another REQ", "E_REQ_AT_DP");
  assert.match(e.message, /resolves to/);

  // (12) negative 4 -- applicable(REQ, DP) -- is NOT independently constructible under a legal G1,
  // and is recorded as such rather than faked. INV-4 requires a DP's current terminal to be
  // active AND applicable, and §7 negative 3 already covers "the terminal is a different REQ". So a
  // store in which the bound REQ is this DP's terminal AND is inapplicable is not a legal store at
  // all. Executable evidence of the unconstructibility, rather than a claim:
  const inapplicable = reqAtDpStore({ expiry: "2020-01-01" });
  assert.throws(() => validateAll(inapplicable, { now: NOW }), /E_INV4_NOT_APPLICABLE|not active\+applicable/,
    "an expired terminal makes the CURRENT store itself invalid, so the fixture cannot reach §7");
  // The reachable half of that ground is ob-8, which IS charged and has no witness on this path,
  // because §7 is not inside the carve-out. It is asserted in (11d-4) on the DEC/ASSUM side.

  // (12) negative 5 -- scopeRulingRef.subjectRef == DP -- is likewise not independently constructible
  // under a legal G1: a typed ruling's subjectRef IS its packet's dpId, and scopeCovers (which INV-4
  // charges on the terminal) already requires the ruling to name this DP. Executable evidence:
  const wrongSubject = reqAtDpStore({ subject: "DP-1" });
  assert.throws(() => validateAll(wrongSubject, { now: NOW }), /different DPs|not active\+applicable/,
    "a scope ruling naming another DP makes the store itself invalid, before §7 can see it");
  // Both limbs stay charged in the producer as fail-closed defence in depth; what is recorded here
  // is that no LEGAL store can exercise them in isolation.
}));

test("AC176 (13)(14): the DP qualifier is refused on a plain REQ, and the bare form is 0/1/many", () => withRepo(async (repo) => {
  repo.putBaseStore(legal(reqAtDpStore()));
  const oid = repo.commit();

  // (13) a NON exception-backed REQ carrying a @DP qualifier.
  repo.write("q.test.mjs", tagged(`${REQ("0D")}@${DP7}`, "q"));
  repo.putStore(legal(plainReq(reqAtDpStore(), REQ("0D"))), { dpIds: [DP7] });
  let e = await refused(repo, oid, "a qualifier on a plain REQ", "E_DP_QUALIFIER_UNSUPPORTED");
  assert.match(e.message, /not exception-backed/);

  // (14) exactly one candidate -> the bare form binds automatically and still charges the five.
  repo.remove("q.test.mjs");
  repo.write("bare.test.mjs", tagged(REQ("0B"), "bare"));
  repo.putStore(legal(reqAtDpStore()), { dpIds: [DP7] });
  const out = await produce(repo, oid);
  assert.strictEqual(byPath(out.entries)["bare.test.mjs"].status, "added", "exactly one candidate binds");

  // (14) zero candidates: the resolving DP is HISTORICAL -- not in currentTaskDpIds -- so it is not
  // a candidate at all, and the run stops rather than reaching outside the task.
  repo.putStore(legal(reqAtDpStore()), { dpIds: [] });
  e = await refused(repo, oid, "a historical DP as the only candidate", "E_DP_INFERENCE");
  assert.match(e.message, /matched 0 DPs/);
  assert.match(e.message, /use the qualified form/);

  // (14) many candidates: two DPs in the current task resolve to the same REQ.
  const many = reqAtDpStore();
  withResolvedDp(many, { dpId: DP8, req: REQ("0B"), ruling: "R-scope-2" });
  repo.putStore(legal(many), { dpIds: [DP7, DP8] });
  e = await refused(repo, oid, "two candidate DPs", "E_DP_INFERENCE");
  assert.match(e.message, /matched 2 DPs/);
}));

// --- (5)(6)(10) the base side ---------------------------------------------------------------------

test("AC176 (5)(10): a historical base binding is not charged current effectivity, and its head side still is", () => withRepo(async (repo) => {
  // B binds a clause that C has RETIRED. The base side must not be charged active/applicable, and
  // the two legal head-side outcomes -- deleted, or a legal retag to a fully valid clause -- must
  // both produce. Every independent requirement of the head side still holds.
  repo.write("gone.test.mjs", tagged(REQ("0B"), "gone"));
  repo.write("retag.test.mjs", tagged(REQ("0B"), "retag"));
  repo.putBaseStore(legal(plainReq(plainReq(baseStore(), REQ("0B")), REQ("0C"))));
  const oid = repo.commit();

  repo.remove("gone.test.mjs");                                   // deleted: no post validation
  repo.write("retag.test.mjs", tagged(REQ("0C"), "retag"));       // legally retagged to a valid clause
  const now = plainReq(plainReq(baseStore(), REQ("0B")), REQ("0C"));
  withTransition(now, { id: "T-1", subject: REQ("0B") });          // B's clause is retired in C
  repo.putStore(legal(now));

  const map = byPath((await produce(repo, oid)).entries);
  assert.strictEqual(map["gone.test.mjs"].status, "deleted", "a deleted test has no post-state to charge");
  assert.deepStrictEqual(map["gone.test.mjs"].tagBefore, { clauseRef: REQ("0B") });
  assert.strictEqual(map["retag.test.mjs"].status, "retagged", "and the legal retag produces normally");
  assert.deepStrictEqual(map["retag.test.mjs"].tagAfter, { clauseRef: REQ("0C") });
}));

test("AC176 (6)(10): a dangling base binding and a base Check A failure are fail-closed, named as base side", () => withRepo(async (repo) => {
  // (6): the base tag names a clause B does not contain.
  repo.write("d.test.mjs", tagged(REQ("0B"), "d"));
  repo.putBaseStore(legal(baseStore()));                          // no REQ 0B in B
  const oid = repo.commit();
  repo.write("d.test.mjs", tagged(REQ("0B"), "d", " const x = 1; void x;"));
  repo.putStore(legal(plainReq(baseStore(), REQ("0B"))));

  const e = await refused(repo, oid, "a dangling base binding", "E_BASE_BINDING_UNRESOLVED");
  assert.strictEqual(e.detail.side, "base", "the failure says WHICH side");
  assert.strictEqual(e.detail.testRef.path, "d.test.mjs");

  // (10) negative: pre-binding Check A. The base store's Source has a digest that does not match its
  // excerpt. The SAME immutable Source is in C (cross-snapshot immutability requires it), the head
  // side is deleted so no post-state is charged, and the failure is therefore unambiguously the
  // pre-binding Check A the base row does charge.
  const repo2 = makeRepo("ctide-ac176-checka-base-");
  try {
    const withBad = (s) => {
      withSource(s, { sourceId: "S-bad", excerpt: "anchored text", driftMode: "snapshot-only", digest: sha256Hex("other") });
      return plainReq(s, REQ("0E"), "S-bad");
    };
    repo2.write("a.test.mjs", tagged(REQ("0E"), "a"));
    repo2.write(".ctide/provenance.json", canonicalStoreBytes(withBad(baseStore())));
    const oid2 = repo2.commit();
    // The head side is retagged to a clause that satisfies all ten obligations, so the ONLY thing
    // that can fail is the base row's Check A.
    repo2.write("a.test.mjs", tagged(REQ("0B"), "a"));
    repo2.putStore(legal(plainReq(withBad(baseStore()), REQ("0B"))));

    let error = null;
    try { await produce(repo2, oid2); } catch (e2) { error = e2; }
    assert.ok(error, "a base binding whose Source fails Check A must be refused");
    assert.strictEqual(error.code, "E_BASE_BINDING_INTEGRITY");
    assert.strictEqual(error.detail.side, "base", "named as the base side");
    assert.strictEqual(error.detail.obligation, "pre-binding Check A");
    assert.strictEqual(error.detail.sourceRef, "S-bad");
  } finally { fs.rmSync(repo2.root, { recursive: true, force: true }); }
}));

// --- (10b) the historical validation boundary --------------------------------------------------------

test("AC176 (10b): historical B is not charged the current instant, and every non-temporal rule still is", () => withRepo(async (repo) => {
  // POSITIVE. B's DP is resolved by an exception-backed REQ whose grant has since expired. C repairs
  // the DP to point at the active hard constraint and is fully valid now. Charging B the current T0
  // -- which is what validateAll(B, { now: T0 }) does -- fails this with E_INV4_NOT_APPLICABLE and
  // blocks exactly the repair the model exists to encourage.
  const historical = withGrant(baseStore(), { expiry: "2020-01-01" });
  plainReq(historical, REQ("0B"), "S-exc");
  withResolvedDp(historical, { req: REQ("0B") });
  repo.write("h.test.mjs", tagged(REQ("0B"), "h"));
  repo.write(".ctide/provenance.json", canonicalStoreBytes(historical));
  const oid = repo.commit();

  // C: the same immutable objects (cross-snapshot immutability), the DP repointed to the active
  // hard constraint, and the test retagged to it.
  const repaired = JSON.parse(JSON.stringify(historical));
  const dp = repaired.decisionPoints.find((d) => d.id === DP7);
  dp.resolvedBy = REQ("0A");
  delete dp.scopeRulingRef;                       // a plain hard constraint needs no scope ruling
  repo.write("h.test.mjs", tagged(REQ("0A"), "h"));
  legal(repaired);                                 // C really is valid NOW
  repo.putStore(repaired, { dpIds: [DP7] });

  const out = await produce(repo, oid);
  assert.strictEqual(byPath(out.entries)["h.test.mjs"].status, "retagged",
    "a legitimate repair away from an expired historical exception must not be blocked by B");

  // NEGATIVE, and the one that proves this is not a schema-only shortcut: the historical store's DP
  // terminal is an exception-backed REQ whose grant expires in 2099 -- so no clock decides anything
  // -- but the DP carries NO scopeRulingRef. validateStoreSchema() passes it; the historical
  // validator must not, because scopeCovers is entirely non-temporal.
  const repo2 = makeRepo("ctide-ac176-hist-neg-");
  try {
    const future = withGrant(baseStore(), { expiry: "2099-01-01" });
    plainReq(future, REQ("0B"), "S-exc");
    withResolvedDp(future, { req: REQ("0B") });
    const bad = JSON.parse(JSON.stringify(future));
    delete bad.decisionPoints.find((d) => d.id === DP7).scopeRulingRef;
    validateStoreSchema(bad);                      // the shortcut a schema-only historical pass takes
    repo2.write("h.test.mjs", tagged(REQ("0B"), "h"));
    repo2.write(".ctide/provenance.json", canonicalStoreBytes(bad));
    const oid2 = repo2.commit();
    repo2.write("h.test.mjs", tagged(REQ("0B"), "h", " const x = 1; void x;"));
    repo2.putStore(legal(future), { dpIds: [DP7] });

    let error = null;
    try { await produce(repo2, oid2); } catch (e2) { error = e2; }
    assert.ok(error, "a historical store that was invalid for non-temporal reasons must stay refused");
    assert.strictEqual(error.code, "E_BASE_STORE_INVALID");
    assert.match(error.message, /non-temporal rules/);
    assert.match(error.detail.cause, /E_INV4_NOT_APPLICABLE/);
  } finally { fs.rmSync(repo2.root, { recursive: true, force: true }); }

  // The remaining invalid-historical controls: an unsupported version, a dangling ref, a duplicate
  // typed id, and cross-snapshot divergence -- each refused on its own layer.
  const repo3 = makeRepo("ctide-ac176-hist-controls-");
  try {
    repo3.write("a.test.mjs", tagged(REQ("0B"), "a"));
    const good = legal(plainReq(baseStore(), REQ("0B")));
    const v9 = JSON.parse(JSON.stringify(good)); v9.provenanceVersion = 9;
    repo3.write(".ctide/provenance.json", `${JSON.stringify(v9)}\n`);
    const oidV9 = repo3.commit();
    repo3.putStore(good);
    let e9 = null;
    try { await produce(repo3, oidV9); } catch (e2) { e9 = e2; }
    assert.strictEqual(e9 && e9.code, "E_BASE_STORE_SCHEMA", "an unsupported base version is refused");

    const dangling = JSON.parse(JSON.stringify(good));
    dangling.clauses.find((c) => c.id === REQ("0B")).sourceRef = "S-nowhere";
    repo3.write(".ctide/provenance.json", `${JSON.stringify(dangling)}\n`);
    const oidD = repo3.commit();
    repo3.putStore(good);
    let ed = null;
    try { await produce(repo3, oidD); } catch (e2) { ed = e2; }
    assert.strictEqual(ed && ed.code, "E_BASE_STORE_INVALID", "a dangling ref in B is refused");

    const dup = JSON.parse(JSON.stringify(good));
    dup.clauses.push(JSON.parse(JSON.stringify(dup.clauses[0])));
    repo3.write(".ctide/provenance.json", `${JSON.stringify(dup)}\n`);
    const oidDup = repo3.commit();
    repo3.putStore(good);
    let edu = null;
    try { await produce(repo3, oidDup); } catch (e2) { edu = e2; }
    assert.strictEqual(edu && edu.code, "E_BASE_STORE_INVALID", "a duplicate typed id in B is refused");

    repo3.write(".ctide/provenance.json", canonicalStoreBytes(good));
    const oidOk = repo3.commit();
    const diverged = JSON.parse(JSON.stringify(good));
    diverged.clauses.find((c) => c.id === REQ("0B")).text = "changed in place";
    repo3.putStore(diverged);
    let ei = null;
    try { await produce(repo3, oidOk); } catch (e2) { ei = e2; }
    assert.strictEqual(ei && ei.code, "E_IMMUTABLE_DIVERGED", "same id, different payload is an integrity failure");
  } finally { fs.rmSync(repo3.root, { recursive: true, force: true }); }
}));

// --- (7) EXPL and null ------------------------------------------------------------------------------

test("AC176 (7): EXPL and an absent base tag are not newly refused", () => withRepo(async (repo) => {
  repo.write("expl.test.mjs", `${NODE_TEST}// @src EXPL\ntest("e", () => {});\n`);
  repo.write("legacy.test.mjs", `${NODE_TEST}test("l", () => {});\n`);        // untagged legacy
  repo.putBaseStore(legal(plainReq(baseStore(), REQ("0B"))));
  const oid = repo.commit();

  repo.write("expl.test.mjs", `${NODE_TEST}// @src EXPL\ntest("e", () => { const x = 1; void x; });\n`);
  repo.write("legacy.test.mjs", `${NODE_TEST}// @src ${REQ("0B")}\ntest("l", () => {});\n`);  // ratchet: gets a binding
  repo.putStore(legal(plainReq(baseStore(), REQ("0B"))));

  const map = byPath((await produce(repo, oid)).entries);
  assert.strictEqual(map["expl.test.mjs"].status, "modified", "EXPL does no clause resolution and is not refused");
  assert.deepStrictEqual(map["expl.test.mjs"].tagAfter, { expl: true });
  assert.strictEqual(map["legacy.test.mjs"].status, "retagged", "an untagged legacy pre-state resolves nothing");
  assert.strictEqual(map["legacy.test.mjs"].tagBefore, null);
}));

// --- (8)(8b) the ordering evidence -------------------------------------------------------------------

test("AC176 (8): a successful producer invocation loads the current store exactly twice, G1 then G2", () => withRepo(async (repo) => {
  repo.write("a.test.mjs", tagged(REQ("0B"), "a"));
  repo.putBaseStore(legal(plainReq(baseStore(), REQ("0B"))));
  const oid = repo.commit();
  repo.write("a.test.mjs", tagged(REQ("0B"), "a", " const x = 1; void x;"));
  repo.putStore(legal(plainReq(baseStore(), REQ("0B"))));

  const scratch = scratchScripts("ctide-ac176-trace-");
  try {
    const proxy = path.join(scratch, "cressetide", "skills", "vigil", "scripts", "counting-proxy.mjs");
    fs.writeFileSync(proxy, [
      'import { readCurrentStoreFile as real } from "./current-store-load.mjs";',
      "export function readCurrentStoreFile(repoRoot) {",
      '  globalThis.__trace = globalThis.__trace || [];',
      '  globalThis.__trace.push("current-store-load");',
      "  return real(repoRoot);",
      "}",
    ].join("\n"), "utf8");
    patch(path.join(scratch, CORE), 'from "./current-store-load.mjs"', 'from "./counting-proxy.mjs"');
    const out = runProducerIn(scratch, repo.root, oid);
    assert.strictEqual(out.ok, true, `the probe invocation must succeed: ${out.message}`);
    assert.deepStrictEqual(out.trace, ["current-store-load", "current-store-load"],
      "exactly two current-store reads: G1 and G2, with no third observation between them");
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}));

test("AC176 (8b): a store mutated AFTER binding validation and BEFORE G2 is caught by G2, deterministically", () => withRepo(async (repo) => {
  // The counting proxy proves the TOTAL is two; it cannot prove the ORDER. This does: a single-point
  // edit writes the scratch repo's .ctide/provenance.json synchronously between the last binding
  // decision and the G2 fresh-load. If an implementation took G2 first, the write would land after
  // it, G2 would not see it, and the invocation would SUCCEED -- so this test would fail.
  repo.write("a.test.mjs", tagged(REQ("0B"), "a"));
  repo.putBaseStore(legal(plainReq(baseStore(), REQ("0B"))));
  const oid = repo.commit();
  repo.write("a.test.mjs", tagged(REQ("0B"), "a", " const x = 1; void x;"));
  repo.putStore(legal(plainReq(baseStore(), REQ("0B"))));

  // THE ANCHOR MATTERS. An earlier version of this case anchored the mutation to the comment
  // immediately above G2, which is worthless as ordering evidence: in an implementation that moved
  // G2 above the binding continuation, the anchor -- and therefore the mutation -- would move with
  // it, and the test would still pass. The anchor is now the END OF THE BINDING WORK
  // (assertStrictlyAscending(out), the last statement of the continuation), which does not move when
  // G2 does. The second scratch below proves that difference rather than asserting it.
  const MUTATE = [
    "        { // SHAPE-B EDIT: mutate the scratch repo's store synchronously, after binding work.",
    '          const fsx = await import("node:fs");',
    '          const px = await import("node:path");',
    '          const file = px.join(repoRoot, ".ctide", "provenance.json");',
    '          const moved = JSON.parse(fsx.readFileSync(file, "utf8"));',
    '          moved.taskStates.push({ taskId: "TASK-MOVED",',
    "            baseProvenance: moved.taskStates[0].baseProvenance, currentTaskDpIds: [] });",
    '          fsx.writeFileSync(file, JSON.stringify(moved) + "\\n", "utf8");',
    "        }",
  ].join("\n");
  const ANCHOR = "      assertStrictlyAscending(out);";

  const scratch = scratchScripts("ctide-ac176-order-");
  try {
    patch(path.join(scratch, CORE), ANCHOR, `${ANCHOR}\n${MUTATE}`);
    const out = runProducerIn(scratch, repo.root, oid);
    assert.strictEqual(out.ok, false, "a store that moved during the invocation must not produce an envelope");
    assert.strictEqual(out.code, "E_STORE_MOVED");
    assert.match(out.message, /changed while the governance seed was being derived/);
    assert.strictEqual(out.entries, undefined, "no entries");
    assert.strictEqual(out.keys, undefined, "no envelope, partial or otherwise");
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }

  // THE DISCRIMINATOR, in a second disposable copy: the same mutation at the same anchor, against a
  // deliberately WRONG core whose G2 fresh-load happens before the binding continuation. That
  // implementation cannot see a change made after binding, so it RETURNS AN ENVELOPE -- which is
  // exactly what the assertions above would have caught. Scratch only; no production seam, no hook,
  // and the parent process imports nothing but the real module.
  const wrong = scratchScripts("ctide-ac176-order-wrong-");
  try {
    patch(path.join(wrong, CORE), ANCHOR, `${ANCHOR}\n${MUTATE}`);
    patch(path.join(wrong, CORE),
      "      const value = continuation === undefined ? undefined : await continuation({",
      "      const g2early = captureCurrentStore(repoRoot, \"G2\", operation); // WRONG: G2 before binding\n"
      + "      const value = continuation === undefined ? undefined : await continuation({");
    patch(path.join(wrong, CORE),
      "      const g2 = captureCurrentStore(repoRoot, \"G2\", operation);",
      "      const g2 = g2early;");
    const out = runProducerIn(wrong, repo.root, oid);
    assert.strictEqual(out.ok, true,
      "the wrong-order core must SUCCEED here -- if it also failed, this case would not be evidence "
      + `of ordering at all (got ${out.code}: ${out.message})`);
  } finally { fs.rmSync(wrong, { recursive: true, force: true }); }
}));

test("AC176 (8)+(11b): the current-store CAS digest is over the CAPTURED TEXT, and a formatting-only move is caught", () => withRepo(async (repo) => {
  // §11b.9c fixes the current-store digest as sha256(canonicalText(file text)). Hashing a
  // re-serialisation of the parsed object instead (canonicalStoreBytes) re-sorts keys and re-indents,
  // so a pretty-printed store reported the digest of a DIFFERENT byte sequence: Step 5's CAS could
  // not match it, and a formatting-only change between G1 and G2 became invisible.
  repo.write("a.test.mjs", tagged(REQ("0B"), "a"));
  repo.putBaseStore(legal(plainReq(baseStore(), REQ("0B"))));
  const oid = repo.commit();
  repo.write("a.test.mjs", tagged(REQ("0B"), "a", " const x = 1; void x;"));

  // A legal store, written PRETTY. Its canonical-serialisation digest and its text digest differ.
  const current = repo.putStore(legal(plainReq(baseStore(), REQ("0B"))));
  const pretty = `${JSON.stringify(current, null, 2)}\n`;
  fs.writeFileSync(path.join(repo.root, ".ctide", "provenance.json"), pretty, "utf8");
  const textDigest = sha256Hex(pretty);
  assert.notStrictEqual(textDigest, storeDigest(current),
    "the fixture is only meaningful if the two notations actually disagree on these bytes");

  const seed = await buildGovernanceSeedPreimage({ repoRoot: repo.root, baseTreeOid: oid });
  assert.strictEqual(seed.inputProvenanceStoreDigest, textDigest,
    "the CARRIER reports sha256(canonicalText(text)) of the file it read");
  const out = await produce(repo, oid);
  assert.strictEqual(out.inputProvenanceStoreDigest, textDigest,
    "and so does the ENVELOPE: the two operations cannot disagree about the same file");

  // canonicalText strips a leading BOM and folds CRLF/CR to LF, and nothing else -- so those three
  // spellings of the same document are the SAME CAS value.
  const bomCrlf = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(pretty.replace(/\n/g, "\r\n"), "utf8"),
  ]);
  fs.writeFileSync(path.join(repo.root, ".ctide", "provenance.json"), bomCrlf);
  const again = await buildGovernanceSeedPreimage({ repoRoot: repo.root, baseTreeOid: oid });
  assert.strictEqual(again.inputProvenanceStoreDigest, textDigest,
    "BOM + CRLF of the same document is canonically the same text, and hashes the same");

  // And the behavioural consequence: a FORMATTING-ONLY change between G1 and G2 is a moved store.
  // Under the old object-hashing digest both sides serialised identically and this passed silently.
  fs.writeFileSync(path.join(repo.root, ".ctide", "provenance.json"), pretty, "utf8");
  const scratch = scratchScripts("ctide-ac176-cas-");
  try {
    patch(path.join(scratch, CORE), "      assertStrictlyAscending(out);", [
      "      assertStrictlyAscending(out);",
      "      { // SHAPE-B EDIT: rewrite the SAME JSON with different whitespace only.",
      '        const fsx = await import("node:fs");',
      '        const px = await import("node:path");',
      '        const file = px.join(repoRoot, ".ctide", "provenance.json");',
      '        const same = JSON.parse(fsx.readFileSync(file, "utf8"));',
      '        fsx.writeFileSync(file, JSON.stringify(same) + "\\n", "utf8");',
      "      }",
    ].join("\n"));
    const moved = runProducerIn(scratch, repo.root, oid);
    assert.strictEqual(moved.ok, false, "a formatting-only rewrite is still a different file");
    assert.strictEqual(moved.code, "E_STORE_MOVED");
    assert.strictEqual(moved.keys, undefined, "and no envelope escapes");
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}));

// --- (9)(9b) the shapes and the export boundary ------------------------------------------------------

test("AC176 (9)(9b): the two request key sets, the carrier, the envelope, and the export lists", async () => {
  // (9b) STRUCTURAL evidence, labelled as such: no invocation can show a missing export. The three
  // modules the two operations live in -- both facades AND the common implementation -- must export
  // only their operation and their error class. A context, a callback or a capture entry point on
  // ANY of them is the v1.16 defect returning.
  const core = await import("../cressetide/skills/vigil/scripts/governance-producer-core.mjs");
  const seedFacade = await import("../cressetide/skills/vigil/scripts/governance-seed-preimage.mjs");
  const producerFacade = await import("../cressetide/skills/vigil/scripts/changed-test-inventory-producer.mjs");
  assert.deepStrictEqual(Object.keys(core).sort(),
    ["GovernanceSeedPreimageError", "InventoryProducerError", "buildGovernanceSeedPreimage", "produceChangedTestInventoryV2"],
    "the common implementation exports the two operations and the two error classes -- nothing else");
  assert.deepStrictEqual(Object.keys(seedFacade).sort(), ["GovernanceSeedPreimageError", "buildGovernanceSeedPreimage"]);
  assert.deepStrictEqual(Object.keys(producerFacade).sort(), ["InventoryProducerError", "produceChangedTestInventoryV2"]);
  for (const [name, mod] of [["core", core], ["seed facade", seedFacade], ["producer facade", producerFacade]]) {
    for (const key of Object.keys(mod)) {
      assert.ok(!/context|callback|capture|withGovernance|hook|clock|snapshot|preimageOf/i.test(key),
        `${name} exports ${key}, which looks like a context/callback/capture seam`);
    }
  }
  // And the known v1.16 counterexample by name.
  assert.strictEqual(core.runWithGovernanceContext, undefined,
    "runWithGovernanceContext(request, …, work) handed B/G1/TaskState/T0/seed to a caller callback and must not exist");
  assert.strictEqual(seedFacade.runWithGovernanceContext, undefined);

  // (9) the two exact request key sets, verified separately.
  await withRepo(async (repo) => {
    repo.write("a.test.mjs", tagged(REQ("0B"), "a"));
    repo.putBaseStore(legal(plainReq(baseStore(), REQ("0B"))));
    const oid = repo.commit();
    repo.putStore(legal(plainReq(baseStore(), REQ("0B"))));

    const seed = await buildGovernanceSeedPreimage({ repoRoot: repo.root, baseTreeOid: oid });
    assert.deepStrictEqual(Object.keys(seed).sort(),
      ["baseTreeOid", "headViewDigest", "inputProvenanceStoreDigest", "lifecycleAffectedClauses"],
      "the carrier is exactly four keys");
    let taskOnSeed = null;
    try { await buildGovernanceSeedPreimage({ repoRoot: repo.root, baseTreeOid: oid, taskId: TASK }); } catch (e) { taskOnSeed = e; }
    assert.ok(taskOnSeed && taskOnSeed.code === "E_API_ARGUMENTS", "the seed's request is exactly two keys");

    const out = await produce(repo, oid);
    assert.deepStrictEqual(Object.keys(out).sort(), [...V2_INVENTORY_KEYS].sort(), "the envelope is exactly seven keys");
    let missingTask = null;
    try { await produceChangedTestInventoryV2({ repoRoot: repo.root, baseTreeOid: oid }); } catch (e) { missingTask = e; }
    assert.ok(missingTask && missingTask.code === "E_API_ARGUMENTS", "the producer's request is exactly three keys");
  }, "ctide-ac176-shape-");
});

// --- the shared guard's own-key coverage, and its diagnostic precedence -------------------------------
//
// "Exactly these keys" means own keys. Object.keys reported neither a non-enumerable key nor a symbol,
// so a request carrying one was admitted. Symbols are refused AFTER the two specific string
// diagnostics, so a caller who supplies a forbidden alias still learns which alias it was.

const refusal = async (call, what) => {
  let error = null;
  try { await call(); } catch (e) { error = e; }
  assert.ok(error && error.code, `${what}: expected a coded refusal, got ${error}`);
  return error;
};

test("the shared request guard sees hidden and symbol own keys, and keeps its specific diagnostics first",
  async () => {
    const producer = () => ({ repoRoot: "/x", baseTreeOid: "a".repeat(40), taskId: TASK });
    const seed = () => ({ repoRoot: "/x", baseTreeOid: "a".repeat(40) });

    // A non-enumerable forbidden alias is now seen, and the SPECIFIC injected-key diagnostic fires.
    const hidden = producer();
    Object.defineProperty(hidden, "registry", { value: {}, enumerable: false, configurable: true });
    assert.deepStrictEqual(Object.keys(hidden).sort(), ["baseTreeOid", "repoRoot", "taskId"],
      "invisible to the enumerable view, which is why the guard must not use it");
    const hiddenError = await refusal(() => produceChangedTestInventoryV2(hidden), "a hidden registry");
    assert.strictEqual(hiddenError.code, "E_API_ARGUMENTS");
    assert.match(hiddenError.message, /refuses the injected key "registry"/,
      "the specific forbidden-alias diagnostic, not a generic key-set message");

    // taskId on the seed keeps its own specific diagnostic when hidden, too.
    const hiddenTask = seed();
    Object.defineProperty(hiddenTask, "taskId", { value: TASK, enumerable: false, configurable: true });
    const hiddenTaskError = await refusal(() => buildGovernanceSeedPreimage(hiddenTask), "a hidden taskId on the seed");
    assert.match(hiddenTaskError.message, /refuses the key "taskId"/,
      "the seed's own reason, unchanged");

    // A symbol alone is refused, rendered by String().
    const symbolled = producer();
    symbolled[Symbol("registry")] = {};
    const symbolError = await refusal(() => produceChangedTestInventoryV2(symbolled), "a symbol own key");
    assert.strictEqual(symbolError.code, "E_API_ARGUMENTS");
    assert.ok(!(symbolError instanceof TypeError), "a typed refusal, not an engine error");
    assert.match(symbolError.message, /Symbol\(registry\)/);

    // PRECEDENCE: with BOTH a forbidden string key and a symbol, the string diagnostic still wins.
    const both = producer();
    both.registry = {};
    both[Symbol("registry")] = {};
    const bothError = await refusal(() => produceChangedTestInventoryV2(both), "both a forbidden key and a symbol");
    assert.match(bothError.message, /refuses the injected key "registry"/,
      "the pre-existing specific diagnostic is not displaced by the new symbol rule");
  });

// --- (17) taskId is a request key and nothing else ---------------------------------------------------

test("AC176 (17): taskId reaches neither the carrier, the envelope nor any digest preimage", () => withRepo(async (repo) => {
  repo.write("a.test.mjs", tagged(REQ("0B"), "a"));
  repo.putBaseStore(legal(plainReq(baseStore(), REQ("0B"))));
  const oid = repo.commit();
  repo.write("a.test.mjs", tagged(REQ("0B"), "a", " const x = 1; void x;"));
  repo.putStore(legal(plainReq(baseStore(), REQ("0B"))));

  const out = await produce(repo, oid);
  const text = JSON.stringify(out);
  assert.ok(!text.includes(TASK), "no envelope field carries the taskId");
  assert.ok(!Object.keys(out).includes("taskId"));

  // And the discriminator: the SAME store carries two TaskStates, so two invocations differing ONLY
  // in which taskId they name see byte-identical inputs. Every digest must agree -- if taskId
  // reached any preimage, these would differ.
  const witness = (taskId) => ({
    taskId,
    baseProvenance: { treeOid: oid, storePath: CANONICAL_STORE_PATH, storeDigest: repo.baseDigest() },
    currentTaskDpIds: [],
  });
  repo.putStore(legal(plainReq(baseStore(), REQ("0B"))), { tasks: [witness(TASK), witness("TASK-2")] });
  const first = await produce(repo, oid, TASK);
  const second = await produce(repo, oid, "TASK-2");
  assert.strictEqual(second.inventoryDigest, first.inventoryDigest,
    "the taskId is not in any digest preimage: the same store digests identically under either task");
  assert.strictEqual(second.inputProvenanceStoreDigest, first.inputProvenanceStoreDigest);
  assert.deepStrictEqual(second.entries, first.entries);
}));

// --- (15)(16) task resolution -------------------------------------------------------------------------

test("AC176 (15)(16): unknown, ambiguous, base-mismatched and multi-TaskState resolution", () => withRepo(async (repo) => {
  repo.write("a.test.mjs", tagged(REQ("0B"), "a"));
  repo.putBaseStore(legal(plainReq(baseStore(), REQ("0B"))));
  const oid = repo.commit();
  repo.write("a.test.mjs", tagged(REQ("0B"), "a", " const x = 1; void x;"));

  const store = () => legal(plainReq(baseStore(), REQ("0B")));
  const witness = (taskId, treeOid = oid, digest = repo.baseDigest()) => ({
    taskId, baseProvenance: { treeOid, storePath: CANONICAL_STORE_PATH, storeDigest: digest }, currentTaskDpIds: [],
  });

  repo.putStore(store(), { tasks: [witness("TASK-OTHER")] });
  await refused(repo, oid, "an unknown task", "E_UNKNOWN_TASK");

  // Two TaskStates with the SAME id: refused one layer earlier than task resolution, by G1's own
  // schema validation. The producer's ambiguity branch is therefore defence in depth, and the
  // evidence is recorded at the layer that actually rejects rather than at the one that would have.
  repo.putStore(store(), { tasks: [witness(TASK), witness(TASK)] });
  const dup = await refused(repo, oid, "two TaskStates with the same id", "E_DUPLICATE_ID", { own: false });
  assert.match(dup.message, /duplicate id TASK-1/);

  const other = "0".repeat(40);
  repo.putStore(store(), { tasks: [witness(TASK, other, storeDigest(emptyStore()))] });
  const mismatch = await refused(repo, oid, "a task whose base witness names another tree", "E_TASK_BASE_MISMATCH");
  assert.match(mismatch.message, /neither side is preferred/);

  // (16) two DIFFERENT tasks: the current one is named, never inferred -- and the control produces.
  repo.putStore(store(), { tasks: [witness(TASK), witness("TASK-2")] });
  const out = await produce(repo, oid);
  assert.strictEqual(out.entries.length, 1, "a correct, unique taskId produces normally");
  await refused(repo, oid, "a taskId that names neither", "E_UNKNOWN_TASK", { taskId: "TASK-3" });
}));

// --- (10c) the raw base witness ------------------------------------------------------------------------

test("AC176 (10c): the producer compares the selected task's RAW base witness; the two-field seed has none", () => withRepo(async (repo) => {
  repo.write("a.test.mjs", tagged(REQ("0B"), "a"));
  repo.putBaseStore(legal(plainReq(baseStore(), REQ("0B"))));
  const oid = repo.commit();
  repo.write("a.test.mjs", tagged(REQ("0B"), "a", " const x = 1; void x;"));

  // The witness is the sha256 of the base store's ORIGINAL bytes -- not the canonicalText CAS digest
  // the CURRENT store uses, and not the empty-store digest.
  const real = repo.baseDigest();
  assert.strictEqual(real, rawDigest(repo.bytes(".ctide/provenance.json")),
    "the fixture's witness is derived from the real committed bytes, not hardcoded");
  repo.putStore(legal(plainReq(baseStore(), REQ("0B"))));
  assert.strictEqual((await produce(repo, oid)).entries.length, 1, "a correct witness produces normally");

  // (i) producer-only: a witness digest that does not match the captured B is fail-closed, BEFORE B
  // decides anything.
  repo.putStore(legal(plainReq(baseStore(), REQ("0B"))), { storeDigest: storeDigest(emptyStore()) });
  const e = await refused(repo, oid, "a witness digest that does not match B", "E_BASE_WITNESS");
  assert.match(e.message, /ORIGINAL bytes/);
  assert.strictEqual(e.detail.captured, real);

  // A witness naming another file never reaches the producer's comparison: G1's own schema
  // validation already requires the canonical store path. Recorded at the layer that rejects it.
  repo.putStore(legal(plainReq(baseStore(), REQ("0B"))));
  const wrongPath = JSON.parse(fs.readFileSync(path.join(repo.root, ".ctide", "provenance.json"), "utf8"));
  wrongPath.taskStates[0].baseProvenance.storePath = ".ctide/elsewhere.json";
  fs.writeFileSync(path.join(repo.root, ".ctide", "provenance.json"), `${JSON.stringify(wrongPath)}\n`, "utf8");
  const p = await refused(repo, oid, "a witness naming another store path", "E_BASE_STORE_PATH", { own: false });
  assert.match(p.message, /canonical \.ctide\/provenance\.json/);

  // (iii) THE NOTATIONS REALLY ARE DIFFERENT, on bytes that tell them apart. An all-LF canonical
  // base store hashes the same under all three readings, so it cannot discriminate. This base tree
  // carries a BOM and CRLF, where the raw digest, the canonicalText digest and the
  // canonical-serialisation digest are three different values -- and only the raw one is the witness.
  const bom = makeRepo("ctide-ac176-rawbytes-");
  try {
    const baseStoreValue = legal(plainReq(baseStore(), REQ("0B")));
    // PRETTY, with a BOM and CRLF: pretty-printing separates the canonicalText digest from the
    // canonical-serialisation one, and the BOM/CRLF separate the raw digest from both.
    const pretty = `${JSON.stringify(baseStoreValue, null, 2)}\n`;
    bom.write(".ctide/provenance.json", Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(pretty.replace(/\n/g, "\r\n"), "utf8"),
    ]));
    bom.write("a.test.mjs", tagged(REQ("0B"), "a"));
    const oidBom = bom.commit();
    const blob = bom.baseBytes();
    assert.deepStrictEqual([...blob.subarray(0, 3)], [0xef, 0xbb, 0xbf], "the Git blob really keeps the BOM");
    assert.ok(blob.includes(0x0d), "and really keeps CRLF -- no end-of-line conversion happened");

    const rawOfBlob = rawDigest(blob);
    const canonicalTextOfBlob = sha256Hex(blob.toString("utf8"));
    const objectDigest = storeDigest(baseStoreValue);
    assert.strictEqual(new Set([rawOfBlob, canonicalTextOfBlob, objectDigest]).size, 3,
      "the three notations disagree on these bytes, which is what makes this a discriminator");
    assert.strictEqual(bom.baseDigest(), rawOfBlob, "the fixture derives its witness from the Git blob itself");

    bom.write("a.test.mjs", tagged(REQ("0B"), "a", " const x = 1; void x;"));
    bom.putStore(legal(plainReq(baseStore(), REQ("0B"))));
    assert.strictEqual((await produce(bom, oidBom)).entries.length, 1,
      "the true RAW witness is accepted, BOM, CRLF and all");

    for (const [why, substitute] of [
      ["the canonicalText digest", canonicalTextOfBlob],
      ["the canonical-serialisation digest", objectDigest],
    ]) {
      bom.putStore(legal(plainReq(baseStore(), REQ("0B"))), { storeDigest: substitute });
      let error = null;
      try { await produce(bom, oidBom); } catch (e2) { error = e2; }
      assert.ok(error && error.code === "E_BASE_WITNESS",
        `${why} is not the base witness and must be refused (got ${error && error.code})`);
    }
  } finally { fs.rmSync(bom.root, { recursive: true, force: true }); }

  // (ii) the standalone two-field seed has no taskId and no witness to compare: it takes B from the
  // content-addressed tree and succeeds, including with an absent current store.
  repo.putStore(legal(plainReq(baseStore(), REQ("0B"))), { storeDigest: storeDigest(emptyStore()) });
  const seed = await buildGovernanceSeedPreimage({ repoRoot: repo.root, baseTreeOid: oid });
  assert.deepStrictEqual(seed.lifecycleAffectedClauses, [],
    "the seed operation succeeds on a store whose witness digest the PRODUCER would reject: it has "
    + "no taskId and no task-specific witness, so there is nothing for it to compare");
  // The absent/canonically-empty current store positives belong to the seed's own contract and are
  // asserted in the AC171 suite, where the base tree is empty too -- a populated B with an absent C
  // is a cross-snapshot integrity failure, not a version-matrix case.
}));

// --- (11a-set-A)(11d-3) the direct Source set is QUANTIFIED --------------------------------------------

// A DEC on an OPEN DP -- so it is nobody's current terminal and INV-4 is not in play -- whose
// basisRefs carry two direct Sources. `bad` names which one fails Check A.
function multiSourceStore({ bad = null, drift = false } = {}) {
  const s = withDp(baseStore());
  withSource(s, { sourceId: "S-1", excerpt: "first anchor", driftMode: "snapshot-only" });
  withSource(s, {
    sourceId: "S-2", excerpt: "second anchor",
    driftMode: drift ? "repo-file" : "snapshot-only",
    digest: bad === "S-2" ? sha256Hex("not the excerpt") : undefined,
  });
  if (bad === "S-1") s.sources.find((x) => x.sourceId === "S-1").digest = sha256Hex("not the excerpt");
  withDec(s, { clauseId: DEC("0D"), basisRefs: ["S-1", "S-2"] });
  return s;
}

test("AC176 (11a-set-A): a NON-FIRST direct Source failing Check A is fail-closed -- the behavioural half", () => withRepo(async (repo) => {
  // Head-only (`added`), so there is no base side at all: a pre-binding rejection cannot masquerade
  // as post-binding coverage here. The clause is a DEC on an open DP, so ob-3/INV-4 are not in play,
  // and only the SECOND member of its direct Source set fails Check A.
  // The DEC and its two Sources are NEW in C, so cross-snapshot immutability has nothing to compare
  // and the only thing separating the negative from the control is S-2's digest.
  repo.putBaseStore(legal(baseStore()));
  const oid = repo.commit();
  repo.write("multi.test.mjs", tagged(DEC("0D"), "multi"));
  repo.putStore(multiSourceStore({ bad: "S-2" }));      // C is legal; Check A is a binding-layer rule

  const e = await refused(repo, oid, "a non-first Source failing Check A", "E_HEAD_BINDING_CHECK_A");
  assert.strictEqual(e.detail.obligation, "ob-4", "ob-4, per member, never exemptible");
  assert.strictEqual(e.detail.sourceRef, "S-2", "and it names the member that failed -- the SECOND one");
  assert.strictEqual(e.detail.side, "head");
  assert.strictEqual(e.detail.testRef.path, "multi.test.mjs");

  // The discriminator: an implementation that stopped at the first member sees S-1 pass and emits an
  // `added` entry. The control proves the fixture is otherwise perfectly producible.
  repo.putStore(multiSourceStore());
  const out = await produce(repo, oid);
  assert.strictEqual(byPath(out.entries)["multi.test.mjs"].status, "added",
    "with both members intact the same fixture produces normally, so the negative isolates ob-4 alone");
}));

test("AC176 (11d-3): ob-4 stays fail-closed even when the clause IS in driftedClauses", () => withRepo(async (repo) => {
  // A deliberate TWO-variable case, not a single-variable negative: the Source both fails Check A
  // and drifts. witness-2 exists, and it must not rescue ob-4 -- no lifecycle set corresponds to
  // snapshot integrity.
  const store = () => {
    const s = withDp(baseStore());
    withSource(s, { sourceId: "S-1", excerpt: "gone from the head view", driftMode: "repo-file", digest: sha256Hex("mismatch") });
    withDec(s, { clauseId: DEC("0D"), basisRefs: ["S-1"] });
    return s;
  };
  repo.putBaseStore(store());
  const oid = repo.commit();
  repo.write("d.test.mjs", tagged(DEC("0D"), "d"));
  repo.putStore(store());

  const e = await refused(repo, oid, "Check A failing on a drifted clause", "E_HEAD_BINDING_CHECK_A");
  assert.strictEqual(e.detail.obligation, "ob-4");
  // And the witness really is present: the seed puts the clause in driftedClauses.
  const seed = await buildGovernanceSeedPreimage({ repoRoot: repo.root, baseTreeOid: oid });
  assert.deepStrictEqual(seed.lifecycleAffectedClauses, [DEC("0D")], "witness-2 exists and still does not excuse ob-4");
}));

// --- (11a-ob5)(11a-set-B) ob-5: mandatory, and honestly labelled ---------------------------------------

test("AC176 (11a-ob5): ob-5 is evaluated against H per repo-file member -- STRUCTURAL evidence", () => {
  // NOT constructible as a public red/green: ob-5's failure condition and witness-2's membership
  // condition are the SAME predicate over the same direct Source set and the same H, so a correct
  // implementation and an ob-5-blind one return byte-identical envelopes for every legal input.
  // (11a-set-B) therefore carries no behavioural claim, and the behavioural half of (11a-set) is
  // Check A, above. What CAN be shown is that the evaluation exists, is per-member, is against H,
  // and is not delegated to a predicate that never sees H.
  const source = fs.readFileSync(path.join(SCRIPTS, "governance-producer-core.mjs"), "utf8");
  const post = source.slice(source.indexOf("function assertPostBinding"), source.indexOf("const isExceptionBackedHere"));
  assert.ok(post.length > 0, "the post-binding decomposition is where ob-5 must live");

  assert.match(post, /\/\/ ob-5[\s\S]*for \(const source of sources\)[\s\S]*sourceDrifts\(source, ctx\.view/,
    "ob-5 loops over EVERY member of the direct Source set and evaluates Check B against the captured view");
  assert.match(post, /witness\[2\]/, "and its only escape is witness-2");
  assert.ok(!/mechanicallyApplicable\(/.test(post),
    "the ten obligations are charged from primitives: a wholesale mechanicallyApplicable() call would "
    + "re-charge an exempted status and would omit DEC/ASSUM Source checks entirely");

  // The same private routine serves the lifecycle seed and ob-5, so the two cannot disagree about
  // the same Source against the same H.
  assert.strictEqual(source.split("function sourceDrifts").length - 1, 1, "one Check B routine, defined once");
  assert.match(source, /function driftedClauses[\s\S]*sourceDrifts\(source, view, operation\)/,
    "driftedClauses uses it");

  // The needle construction and the haystack transform were EXTRACTED into source-occurrence.mjs so
  // the Step 6 consumer charges the same Check B over its own captured S3. The property is unchanged
  // and is asserted against the module that now owns it; `sourceDrifts` above still routes through
  // that one definition, so the producer and the consumer cannot answer differently.
  const occurrence = fs.readFileSync(path.join(SCRIPTS, "source-occurrence.mjs"), "utf8");
  assert.match(occurrence, /const needle = Buffer\.from\(canonicalText\(source\.excerpt\), "utf8"\)/,
    "the needle is the canonical excerpt bytes");
  assert.match(occurrence,
    /function canonicalSearchBytes[\s\S]*0xef && raw\[1\] === 0xbb && raw\[2\] === 0xbf[\s\S]*0x0d/,
    "and the haystack transform is byte-preserving: leading BOM removed, CR/CRLF folded to LF");
  assert.strictEqual(
    source.split("function canonicalSearchBytes").length - 1
    + occurrence.split("function canonicalSearchBytes").length - 1,
    1, "the byte transform is still defined exactly once across both modules");
});

// --- (11b) the never-exemptible obligations, by ACTUAL rejection layer -----------------------------------

test("AC176 (11b-layer 2): ob-9 through a dangling RecordRef on a NONTERMINAL DEC", () => withRepo(async (repo) => {
  // The only independently isolable ob-9 discriminator that reaches binding validation: a RecordRef
  // is not in the direct Source set (the seed never follows it) and clause basisRefs are not charged
  // by store ref validation -- while a dangling "S-…" would be refused two layers earlier.
  const store = () => {
    const s = withDp(baseStore());
    withSource(s, { sourceId: "S-1", excerpt: "anchor", driftMode: "snapshot-only" });
    return withDec(s, { clauseId: DEC("0D"), basisRefs: ["S-1"], extra: [{ kind: "review-ruling", ref: "R-nowhere" }] });
  };
  repo.putBaseStore(store());
  const oid = repo.commit();
  repo.write("r.test.mjs", tagged(DEC("0D"), "r"));
  repo.putStore(store());

  const e = await refused(repo, oid, "a dangling RecordRef in basisRefs", "E_HEAD_BINDING_NOT_APPLICABLE");
  assert.strictEqual(e.detail.obligation, "ob-9");
  assert.match(e.detail.reason, /basisRef unresolvable/);
  assert.strictEqual(e.detail.side, "head");
}));

test("AC176 (11b-layer 1 and 1b): ob-2, ob-6, ob-6b and ob-7 are refused BEFORE binding validation", () => withRepo(async (repo) => {
  repo.write("a.test.mjs", tagged(REQ("0B"), "a"));
  repo.putBaseStore(legal(plainReq(baseStore(), REQ("0B"))));
  const oid = repo.commit();
  repo.write("a.test.mjs", tagged(REQ("0B"), "a", " const x = 1; void x;"));

  // LAYER 1 -- G1's own clock-free schema validation. The AUTHORITATIVE code and cause are preserved
  // exactly: the producer does not re-label them as its own, does not demote the real code into a
  // `cause` string, and invents no testRef/side/obligation -- there is no matcher, no pair and no
  // testRef at this point.
  const layer1 = async (mutate, code, what) => {
    const s = plainReq(baseStore(), REQ("0B"));
    mutate(s);
    repo.putStore(s);
    const e = await refused(repo, oid, what, code, { own: false });
    assert.ok(!(e instanceof InventoryProducerError),
      `${what}: an authoritative store refusal is not re-wrapped as the producer's own error`);
    assert.strictEqual(e.name, "ProvenanceError", `${what}: it is the store's own error type`);
    assert.ok(e.detail === undefined || typeof e.detail === "string" || e.detail === null,
      `${what}: the upstream detail (the offending id) survives; it is not replaced by a cause object`);
    assert.ok(!/testRef/.test(JSON.stringify(e.detail ?? null)), `${what}: no testRef is invented before one exists`);
    return e;
  };
  // ob-2, REQ limb: a dangling sourceRef.
  const dangling = await layer1((s) => { s.clauses.find((c) => c.id === REQ("0B")).sourceRef = "S-nowhere"; },
    "E_DANGLING_REF", "a REQ whose sourceRef does not resolve");
  assert.strictEqual(dangling.detail, REQ("0B"),
    "the authoritative detail is the offending clause id, exactly as validateStoreSchema reports it");
  assert.match(dangling.message, /sourceRef S-nowhere does not resolve/, "and the message is the upstream one");
  // ob-6: a dangling targetConstraintRef.
  await layer1((s) => withGrant(s, { expiry: "2099-01-01", target: ABSENT }),
    "E_DANGLING_REF", "an exception-grant whose target does not resolve");
  // ob-6b: the target is not an authority=hard-constraint REQ.
  await layer1((s) => { plainReq(s, REQ("0C")); withGrant(s, { expiry: "2099-01-01", target: REQ("0C") }); },
    "E_EXCEPTION_TARGET", "an exception-grant targeting a non-hard-constraint REQ");
  // ob-7: grantAuthorityRef is not the target's ownerRef.
  await layer1((s) => withGrant(s, { expiry: "2099-01-01", owner: { kind: "user" } }),
    "E_EXCEPTION_OWNER", "an exception-grant whose grantAuthorityRef is not the owner");

  // LAYER 1b -- the MANDATORY lifecycle seed derivation, which runs before the matcher and before
  // any binding. A nonterminal DEC/ASSUM whose direct Source does not resolve dies here, with the
  // seed layer's own code -- not the store's, and not a binding error.
  const seedLayer = withDp(baseStore());
  withSource(seedLayer, { sourceId: "S-1", excerpt: "anchor", driftMode: "snapshot-only" });
  withAssum(seedLayer, { clauseId: ASSUM("0S"), basisRefs: ["S-1", "S-missing"] });
  plainReq(seedLayer, REQ("0B"));
  repo.putStore(seedLayer);
  const e = await refused(repo, oid, "a nonterminal ASSUM with a dangling direct Source", "E_SOURCE_DANGLING");
  assert.match(e.message, /is not in the current store/);
  assert.strictEqual(e.detail.testRef, undefined, "still no testRef: the seed runs before the matcher");
  assert.strictEqual(e.detail.clause, ASSUM("0S"));
}));

// --- (11d-4) ob-8 on the DEC/ASSUM side: separable, and with no witness ------------------------------------

test("AC176 (11d-4): a DEC/ASSUM whose basisRefs hold an EXPIRED grant has no witness and is fail-closed", () => withRepo(async (repo) => {
  // expiredClauses admits only "a REQ whose sourceRef points at an exception-grant". A DEC or ASSUM
  // does NOT enter it through basisRefs -- so ob-8 fails here with no witness at all. This is the
  // separable half of the ob-8 / witness-3 pair; the REQ half has neither a positive nor a negative.
  const store = () => {
    const s = withDp(baseStore());
    withGrant(s, { expiry: "2020-01-01" });
    withSource(s, { sourceId: "S-1", excerpt: "anchor", driftMode: "snapshot-only" });
    return withAssum(s, { clauseId: ASSUM("0S"), basisRefs: ["S-1", "S-exc"] });
  };
  repo.putBaseStore(legal(store()));
  const oid = repo.commit();
  repo.write("x.test.mjs", tagged(ASSUM("0S"), "x"));
  repo.putStore(legal(store()));

  const e = await refused(repo, oid, "an ASSUM basis grant that expired", "E_HEAD_BINDING_EXPIRED");
  assert.strictEqual(e.detail.obligation, "ob-8");
  assert.strictEqual(e.detail.sourceRef, "S-exc");
  assert.match(e.message, /never enters expiredClauses/);

  const seed = await buildGovernanceSeedPreimage({ repoRoot: repo.root, baseTreeOid: oid });
  assert.ok(!seed.lifecycleAffectedClauses.includes(ASSUM("0S")),
    "and the ASSUM really is absent from the seed -- there is no witness to excuse ob-8 with");
}));

// --- (11f) Check B search bytes -------------------------------------------------------------------------

test("AC176 (11f): LF, CRLF, CR, BOM and an unrelated binary blob -- the isolated drift controls", () => withRepo(async (repo) => {
  // The SAME clause and Source exist in B and C, there is no transition, no expiry and no new
  // clause: the only variable is how the live file stores its line endings. Any membership in
  // lifecycleAffectedClauses is therefore false drift, and nothing else can explain it.
  const store = () => {
    const s = baseStore();
    withSource(s, { sourceId: "S-file", excerpt: "line one\nline two", driftMode: "repo-file" });
    return legal(plainReq(s, REQ("0B"), "S-file"));
  };
  const variants = {
    LF: Buffer.from("line one\nline two\n", "utf8"),
    CRLF: Buffer.from("line one\r\nline two\r\n", "utf8"),
    CR: Buffer.from("line one\rline two\r", "utf8"),
    "BOM+LF": Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("line one\nline two\n", "utf8")]),
    "BOM+CRLF": Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("line one\r\nline two\r\n", "utf8")]),
  };

  // A REAL bound test, identical in B and in the head, so the producer actually charges the
  // post-binding obligations for this clause under every variant. Without it the newline cases would
  // only exercise the seed; with it, ob-5's per-Source Check B runs too -- and a raw-byte search
  // would drift, land the clause in driftedClauses, exempt ob-5 by witness-2 and EMIT a
  // governance-affected entry. Empty entries is therefore a producer-level discriminator, not a
  // restatement of the seed assertion.
  repo.write("bound.test.mjs", tagged(REQ("0B"), "bound"));
  repo.write("docs/policy.md", variants.LF);
  repo.putBaseStore(store());
  const oid = repo.commit();
  repo.putStore(store());

  const storeBytesBefore = repo.bytes(".ctide/provenance.json");
  const excerptBefore = JSON.parse(storeBytesBefore.toString("utf8"))
    .sources.find((x) => x.sourceId === "S-file").excerpt;

  for (const [name, bytes] of Object.entries(variants)) {
    repo.write("docs/policy.md", bytes);
    const seed = await buildGovernanceSeedPreimage({ repoRoot: repo.root, baseTreeOid: oid });
    assert.deepStrictEqual(seed.lifecycleAffectedClauses, [],
      `${name}: the canonical form of the file equals the canonical excerpt, so this is not drift`);

    const out = await produce(repo, oid);
    assert.deepStrictEqual(out.entries, [],
      `${name}: the bound test is unchanged and its clause did not drift, so nothing is emitted -- a `
      + "raw-byte search would have exempted ob-5 by witness-2 and emitted a governance-affected entry");

    // (11f)(7), per variant: the raw layer is untouched by Check B's canonicalisation. The head-view
    // snapshot is captured independently here through the PUBLIC capture API -- the producer's own H
    // stays private -- and its bytes, per-entry contentDigest and headViewDigest are all raw.
    const snap = await captureHeadViewSnapshot({ repoRoot: repo.root });
    assert.deepStrictEqual(snap.read("docs/policy.md"), bytes, `${name}: H holds the RAW bytes`);
    assert.strictEqual(snap.entry("docs/policy.md").contentDigest, rawDigest(bytes),
      `${name}: contentDigest is sha256 over those raw bytes, with no BOM or newline folding`);
    assert.strictEqual(snap.headViewDigest, seed.headViewDigest,
      `${name}: the independently captured head view is the one the CARRIER names`);
    assert.strictEqual(out.headViewDigest, seed.headViewDigest,
      `${name}: and the one the ENVELOPE names`);
    assert.deepStrictEqual(repo.bytes("docs/policy.md"), bytes,
      `${name}: the repository file is byte-identical afterwards -- nothing was normalised on disk`);
    assert.deepStrictEqual(repo.bytes(".ctide/provenance.json"), storeBytesBefore,
      `${name}: and the store, including the stored excerpt, is untouched`);
  }

  // The five variants are five DIFFERENT raw documents, so their head-view digests must differ even
  // though every one of them is the same document for drift. Both layers, at once.
  const digests = new Map();
  for (const [name, bytes] of Object.entries(variants)) {
    repo.write("docs/policy.md", bytes);
    digests.set(name, (await captureHeadViewSnapshot({ repoRoot: repo.root })).headViewDigest);
  }
  assert.strictEqual(new Set(digests.values()).size, 5,
    `the raw head-view digest distinguishes all five spellings: ${JSON.stringify([...digests])}`);
  assert.strictEqual(
    JSON.parse(repo.bytes(".ctide/provenance.json").toString("utf8"))
      .sources.find((x) => x.sourceId === "S-file").excerpt,
    excerptBefore, "and the stored excerpt never changed at any point");

  // True drift is still drift: the excerpt genuinely is not there in any form.
  repo.write("docs/policy.md", Buffer.from("something else entirely\n", "utf8"));
  const drifted = await buildGovernanceSeedPreimage({ repoRoot: repo.root, baseTreeOid: oid });
  assert.deepStrictEqual(drifted.lifecycleAffectedClauses, [REQ("0B")], "zero occurrences is still drift");

  // An unrelated binary / invalid-UTF-8 blob must not exclude a path, fail the run, or be called an
  // unanalysable source: the search universe is every captured regular blob, and the search is over
  // bytes.
  repo.write("docs/policy.md", variants.CRLF);
  repo.write("assets/blob.bin", Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x81, 0x00, 0xc3, 0x28]));
  const withBinary = await buildGovernanceSeedPreimage({ repoRoot: repo.root, baseTreeOid: oid });
  assert.deepStrictEqual(withBinary.lifecycleAffectedClauses, [],
    "an unrelated non-UTF-8 blob changes nothing and is not a failure");

  // The pair statement of the same fact, on one fixture: identical drift answer, different raw
  // head-view digest.
  repo.write("assets/blob.bin", Buffer.from([0x00, 0xff]));   // keep the tree stable across the pair
  repo.write("docs/policy.md", variants.LF);
  const lf = await buildGovernanceSeedPreimage({ repoRoot: repo.root, baseTreeOid: oid });
  repo.write("docs/policy.md", variants.CRLF);
  const crlf = await buildGovernanceSeedPreimage({ repoRoot: repo.root, baseTreeOid: oid });
  assert.deepStrictEqual(crlf.lifecycleAffectedClauses, lf.lifecycleAffectedClauses,
    "the same document either way: canonical search bytes decide drift");
  assert.notStrictEqual(crlf.headViewDigest, lf.headViewDigest,
    "and the head-view digest is over RAW bytes, so it must differ -- if it did not, the raw layer "
    + "would have been canonicalised too");
  assert.deepStrictEqual(repo.bytes("docs/policy.md"), Buffer.from(variants.CRLF),
    "and nothing on disk was normalised");
}));

test("AC176 (11f)(x): a real capture-layer read failure fails closed, with the upstream error", () => withRepo(async (repo) => {
  // NOT a synthetic source error, and not an unrelated binary blob. This is the actual filesystem
  // read the head-view capture performs, made to fail for real: in a DISPOSABLE copy of the scripts,
  // one edit points the read of an identified fixture blob at its own containing directory, so the
  // operating system returns EISDIR and PRODUCTION's own error handling turns that into
  // E_READ_FAILED. Deleting the file instead would prove nothing -- readEntry treats ENOENT as
  // legitimate absence, by design.
  const store = () => {
    const s = baseStore();
    withSource(s, { sourceId: "S-file", excerpt: "line one", driftMode: "repo-file" });
    return legal(plainReq(s, REQ("0B"), "S-file"));
  };
  repo.write("docs/policy.md", "line one\n");
  repo.write("bound.test.mjs", tagged(REQ("0B"), "bound"));
  repo.putBaseStore(store());
  const oid = repo.commit();
  repo.putStore(store());
  assert.strictEqual((await produce(repo, oid)).entries.length, 0, "the fixture itself is clean");
  const before = repo.git("status", "--porcelain", "--untracked-files=all");

  const scratch = scratchScripts("ctide-ac176-ioerr-");
  try {
    const HEAD_VIEW = path.join("cressetide", "skills", "vigil", "scripts", "head-view-snapshot.mjs");
    patch(path.join(scratch, HEAD_VIEW), [
      "  try { bytes = fs.readFileSync(absolute); } catch (error) {",
      '    if (error && error.code === "ENOENT") return null;',
      '    throw fail("E_READ_FAILED", `${relative} could not be read: ${error && error.code}`);',
      "  }",
      "  // Observed first, index second.",
    ].join("\n"), [
      // SHAPE-B EDIT: a REAL read of a REAL directory. The catch, the code and the message are
      // production's own and are not touched.
      '  const target = relative === "docs/policy.md" ? path.dirname(absolute) : absolute;',
      "  try { bytes = fs.readFileSync(target); } catch (error) {",
      '    if (error && error.code === "ENOENT") return null;',
      '    throw fail("E_READ_FAILED", `${relative} could not be read: ${error && error.code}`);',
      "  }",
      "  // Observed first, index second.",
    ].join("\n"));

    const out = runProducerIn(scratch, repo.root, oid);
    assert.strictEqual(out.ok, false, "a capture that cannot read a blob must not produce an envelope");
    assert.strictEqual(out.code, "E_READ_FAILED", `the upstream capture error, verbatim (got ${out.message})`);
    assert.match(out.message, /docs\/policy\.md could not be read: EISDIR/,
      "and it names the path and the real errno rather than a fabricated binding failure");
    assert.ok(!/testRef/.test(out.message), "no binding testRef is invented for a capture failure");
    assert.strictEqual(out.entries, undefined, "no entries");
    assert.strictEqual(out.keys, undefined, "no envelope, partial or otherwise");
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }

  assert.strictEqual(repo.git("status", "--porcelain", "--untracked-files=all"), before,
    "and the fixture repository is unchanged: the mutation lived entirely in the disposable copy");
}));

test("AC176 (11f): a lossy UTF-8 decode must not manufacture a match -- the replacement discriminator", () => withRepo(async (repo) => {
  // THE DISCRIMINATOR THE EARLIER DECOY WAS NOT. An ASCII needle can never be produced by
  // replacement decoding, so a wrong lossy implementation answered the same as a correct one. This
  // excerpt CONTAINS U+FFFD (bytes EF BF BD), so the two implementations must disagree:
  //   positive haystack -- the real EF BF BD bytes      -> both find it        -> not drift
  //   negative haystack -- invalid byte 0x80 in its place -> byte search finds NOTHING -> drift,
  //                                                        but a lossy decode turns 0x80 into U+FFFD
  //                                                        and would report "not drift".
  // Built with fromCharCode on purpose: a LITERAL U+FFFD in a source file is exactly what this
  // repository's structure validator flags as mojibake, and this test needs the character
  // deliberately rather than accidentally.
  const REPLACEMENT = String.fromCharCode(0xfffd);
  const excerpt = `alpha${REPLACEMENT}omega`;
  const store = () => {
    const s = baseStore();
    withSource(s, { sourceId: "S-file", excerpt, driftMode: "repo-file" });
    return legal(plainReq(s, REQ("0B"), "S-file"));
  };
  const real = Buffer.from(excerpt, "utf8");                       // 61 6c 70 68 61 EF BF BD 6f ...
  assert.deepStrictEqual([...real.subarray(5, 8)], [0xef, 0xbf, 0xbd], "the excerpt really carries U+FFFD");
  const lossy = Buffer.concat([
    Buffer.from("alpha", "utf8"), Buffer.from([0x80]), Buffer.from("omega", "utf8"),
  ]);

  repo.write("docs/policy.md", real);
  repo.putBaseStore(store());
  const oid = repo.commit();
  repo.putStore(store());

  const positive = await buildGovernanceSeedPreimage({ repoRoot: repo.root, baseTreeOid: oid });
  assert.deepStrictEqual(positive.lifecycleAffectedClauses, [],
    "valid EF BF BD bytes ARE the excerpt: a byte-preserving search finds them");

  repo.write("docs/policy.md", lossy);
  const negative = await buildGovernanceSeedPreimage({ repoRoot: repo.root, baseTreeOid: oid });
  assert.deepStrictEqual(negative.lifecycleAffectedClauses, [REQ("0B")],
    "the excerpt is NOT in these bytes, so this is drift -- an implementation that decoded the "
    + "haystack lossily would see U+FFFD, call it a match, and wrongly report no drift");

  // AND THE PROOF THAT THIS DISCRIMINATES, in a disposable scratch copy: the same fixture against a
  // core whose search bytes come from a LOSSY decode. That mutant answers "no drift" on the very
  // input the assertion above requires to drift, so it fails this case -- which an ASCII-only
  // needle could never have shown, because replacement decoding cannot invent ASCII.
  const wrong = scratchScripts("ctide-ac176-lossy-");
  try {
    patch(path.join(wrong, OCCURRENCE),
      "    view.set(p, canonicalSearchBytes(snapshot.read(p)));",
      '    view.set(p, Buffer.from(canonicalText(snapshot.read(p).toString("utf8")), "utf8")); // WRONG: lossy');
    const mutant = runSeedIn(wrong, repo.root, oid);
    assert.strictEqual(mutant.ok, true, `the mutant must run, not crash: ${mutant.message}`);
    assert.deepStrictEqual(mutant.seed, [],
      "the lossy mutant decodes 0x80 into U+FFFD, matches the excerpt and reports NO drift -- so it "
      + "fails the assertion above, which is what makes that assertion evidence");
  } finally { fs.rmSync(wrong, { recursive: true, force: true }); }
}));

test("AC176 (11f): a Source that genuinely cannot be analysed fails closed, on its own layer", async () => {
  // Not the same thing as "the repository contains a binary file". These are the real analysis
  // failures, and each is asserted at the layer that actually owns it.
  const withExcerpt = (excerpt) => {
    const s = baseStore();
    s.sources.push({
      sourceId: "S-file", contentKind: "requirement", driftMode: "repo-file",
      locator: "d#1", excerpt, digest: sha256Hex(excerpt),
    });
    return plainReq(s, REQ("0B"), "S-file");
  };
  // An excerpt whose CANONICAL form is empty: an occurrence count over it is meaningless, so Check B
  // fails closed rather than answering "not drift". The store layer accepts it, so this really is
  // the seed layer's call. B and C carry the SAME Source -- immutable objects are shared, and a
  // fixture that differed there would be measuring cross-snapshot integrity instead.
  const BOM = String.fromCharCode(0xfeff);
  for (const [why, excerpt] of [["an empty excerpt", ""], ["a BOM-only excerpt", BOM]]) {
    const s = withExcerpt(excerpt);
    assert.doesNotThrow(() => validateStoreSchema(s), `${why}: the store layer accepts it`);
    const one = makeRepo("ctide-ac176-unanalysable-");
    try {
      one.write("docs/policy.md", "anything\n");
      one.putBaseStore(s);
      const oidOne = one.commit();
      one.putStore(s);
      let error = null;
      try { await buildGovernanceSeedPreimage({ repoRoot: one.root, baseTreeOid: oidOne }); } catch (e) { error = e; }
      assert.ok(error, `${why}: must fail closed`);
      assert.strictEqual(error.code, "E_SOURCE_UNANALYSABLE", `${why}: ${error.message}`);
      assert.match(error.message, /fails closed/);
    } finally { fs.rmSync(one.root, { recursive: true, force: true }); }
  }

  // A non-string excerpt never reaches Check B: the store's own shape rule refuses it first, and the
  // evidence is recorded at THAT layer rather than restated as a Check B failure.
  const bad = withExcerpt("x");
  bad.sources.find((x) => x.sourceId === "S-file").excerpt = 42;
  let shape = null;
  try { validateStoreSchema(bad); } catch (e) { shape = e; }
  assert.ok(shape && shape.code === "E_SHAPE", "a non-string excerpt is a store-layer refusal");
  assert.match(shape.message, /needs a string excerpt/);
});

// --- (11e)(18) the effect boundary --------------------------------------------------------------------

test("AC176 (11e)(18): an exemption is not a pass, and a failure writes nothing", () => withRepo(async (repo) => {
  const store = () => {
    const s = baseStore();
    withSource(s, { sourceId: "S-file", excerpt: "the anchored sentence", driftMode: "repo-file" });
    return legal(plainReq(s, REQ("0B"), "S-file"));
  };
  repo.write("docs/policy.md", "the anchored sentence\n");
  repo.write("hit.test.mjs", tagged(REQ("0B"), "hit"));
  repo.putBaseStore(store());
  const oid = repo.commit();
  repo.write("docs/policy.md", "gone\n");                       // drift -> witness-2 -> ob-5 excused
  repo.putStore(store());

  const out = await produce(repo, oid);
  const hit = byPath(out.entries)["hit.test.mjs"];
  assert.strictEqual(hit.status, "governance-affected", "the exemption produces an entry");
  // (11e): and it carries NO flag saying so. The key sets are exact on both levels.
  assert.deepStrictEqual(Object.keys(out).sort(), [...V2_INVENTORY_KEYS].sort());
  assert.deepStrictEqual(Object.keys(hit).sort(),
    ["baseBodyDigest", "framework", "headBodyDigest", "implementationIdentity", "reason", "status",
      "tagAfter", "tagBefore", "testRef"].sort(),
    "no 'exempted' field is added to the entry");
  assert.ok(!JSON.stringify(out).includes("exempt"), "and nothing anywhere says exempt");
  assert.ok(!fs.existsSync(path.join(repo.root, ".ctide", "output")), "no .ctide/output/** is written");

  // (18): after a fail-closed run, every byte the producer could have touched is unchanged.
  const before = repo.git("status", "--porcelain", "--untracked-files=all");
  const storeBytes = repo.bytes(".ctide/provenance.json");
  repo.write("ghost.test.mjs", tagged(ABSENT, "ghost"));
  await refused(repo, oid, "a dangling head binding", "E_HEAD_BINDING_UNRESOLVED");
  repo.remove("ghost.test.mjs");
  assert.deepStrictEqual(repo.bytes(".ctide/provenance.json"), storeBytes, "the store is byte-identical");
  assert.strictEqual(repo.git("status", "--porcelain", "--untracked-files=all"), before,
    "no output, no config, no registry, no store write");
}));
