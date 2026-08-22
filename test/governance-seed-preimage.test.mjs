// AC171 evidence for cressetide/skills/vigil/scripts/governance-seed-preimage.mjs.
//
// SCOPE NOTE: this covers buildGovernanceSeedPreimage() and AC171, and nothing else.
// produceChangedTestInventoryV2(), AC172, AC173, the governance reverse closure, entry projection,
// the v2 envelope and all product wiring are NOT implemented and are NOT exercised here. A green run
// does not satisfy AC118, AC136, AC137 or AC138, does not lift the unsupported-populated-inventory
// gate, does not make a populated inventory acceptable, and does not mean Phase 2 is ready.
//
// Spec anchors (the current approved coupled set, one effective set):
//   SM  = docs/superpowers/specs/2026-07-25-shared-decision-provenance-model.md (approved v1.15) §2, §9
//   TP  = docs/superpowers/specs/2026-07-25-test-provenance-spec.md (approved v1.15) §11b.10c, AC171
//
// FIXTURE POLICY, stated because it departs from the store suite's. Stores here are built as
// objects and then asserted legal by running the PRODUCTION validateAll() over them, rather than
// chained through domain transactions. This suite tests a READER of stores, and the shapes it must
// read -- a historical v1 base tree, a store whose only difference is one expiry string, a store
// planted at a specific digest -- are ones the transaction chain cannot produce or cannot produce
// without a large fixture apparatus that would itself need testing. Every fixture goes through
// validateAll(), so none of them is a shape production would refuse.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cp from "node:child_process";

import { root } from "./helpers.mjs";
import {
  emptyStore, canonicalStoreBytes, storeDigest, sha256Hex, validateAll, compareCodePoint,
  isCanonicalClauseRef, digestOf, validateStoreSchema,
} from "../cressetide/skills/vigil/scripts/provenance-store.mjs";
import {
  buildGovernanceSeedPreimage, GovernanceSeedPreimageError,
} from "../cressetide/skills/vigil/scripts/governance-seed-preimage.mjs";

const SCRIPTS = path.join(root, "cressetide", "skills", "vigil", "scripts");
const CARRIER_KEYS = ["baseTreeOid", "headViewDigest", "inputProvenanceStoreDigest", "lifecycleAffectedClauses"];

// --- fixtures -----------------------------------------------------------------------------------

const U = (tail) => "01J000000000000000000000" + tail;
const REQ = (tail) => "REQ-" + U(tail);
const DEC = (tail) => "DEC-" + U(tail);

function makeRepo(prefix = "ctide-gsp-") {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  const git = (...a) => cp.execFileSync("git", a, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q", "--initial-branch=main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  git("config", "core.symlinks", "false");
  const write = (rel, body) => {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body, "utf8");
  };
  return {
    root: dir, git, write,
    commit: () => { git("add", "-A"); git("commit", "-qm", "c"); return git("rev-parse", "HEAD^{tree}"); },
    putStore: (store) => write(".ctide/provenance.json", canonicalStoreBytes(store)),
    dropStore: () => fs.rmSync(path.join(dir, ".ctide", "provenance.json"), { force: true }),
    readStore: () => fs.readFileSync(path.join(dir, ".ctide", "provenance.json"), "utf8"),
  };
}

async function withRepo(body, prefix) {
  const repo = makeRepo(prefix);
  try { return await body(repo); } finally { fs.rmSync(repo.root, { recursive: true, force: true }); }
}

// A legal v2 store: an owner record, a policy Source, a hard-constraint REQ that owns it.
function baseStore() {
  const s = emptyStore();
  s.records.push({ recordId: "R-owner", kind: "source-authority", authorityIdentity: "EU DPA" });
  s.sources.push({
    sourceId: "S-hc", contentKind: "policy", driftMode: "snapshot-only",
    locator: "policy#1", excerpt: "PII must not leave the EU", digest: sha256Hex("PII must not leave the EU"),
  });
  s.clauses.push({
    id: REQ("0A"), authority: "hard-constraint", kind: "specification",
    text: "PII stays in the EU", sourceRef: "S-hc", ownerRef: { kind: "source-authority", ref: "R-owner" },
  });
  return s;
}

function withGrant(s, { expiry, clauseId = REQ("0B"), sourceId = "S-exc" }) {
  s.sources.push({
    sourceId, contentKind: "exception-grant", driftMode: "snapshot-only", locator: "g#1",
    excerpt: "grant", digest: sha256Hex("grant"), targetConstraintRef: REQ("0A"),
    grantAuthorityRef: { kind: "source-authority", ref: "R-owner" }, scope: "eu", expiry,
  });
  s.clauses.push({
    id: clauseId, authority: "approved-requirement", kind: "specification",
    text: "eu carve-out", sourceRef: sourceId, taskRef: "TASK-1",
  });
  return s;
}

// A repo-file Source whose excerpt Check B must find (or not find) in the head view.
function withRepoFileClause(s, { clauseId = REQ("0C"), sourceId = "S-file", excerpt }) {
  s.sources.push({
    sourceId, contentKind: "requirement", driftMode: "repo-file",
    locator: "docs/policy.md#1", excerpt, digest: sha256Hex(excerpt),
  });
  s.clauses.push({
    id: clauseId, authority: "approved-requirement", kind: "specification",
    text: "anchored", sourceRef: sourceId, taskRef: "TASK-1",
  });
  return s;
}

const NOW = Date.UTC(2026, 6, 26);
const legal = (s) => { validateAll(s, { now: NOW }); return s; };
const CODE = { kind: "discipline", discipline: "code" };

// A DecisionPoint the DEC and ASSUM fixtures below hang off.
function withDp(s) {
  s.decisionPoints.push({
    id: "DP-1", dimension: "data", scenario: "s", alternatives: ["A", "B"], layer: "implementation",
    classificationBasis: "engineering standard", materialReasons: [], status: "open", reopenCauseRef: null,
  });
  return s;
}

function withSource(s, { sourceId, excerpt, driftMode = "repo-file", contentKind = "requirement" }) {
  s.sources.push({ sourceId, contentKind, driftMode, locator: "d#1", excerpt, digest: sha256Hex(excerpt) });
  return s;
}

// A legal ASSUM whose basisRefs carry a PLAIN "S-…" string -- the shape IS §4 actually defines.
function withAssum(s, { clauseId, basisRefs }) {
  s.clauses.push({
    id: clauseId, authority: "approved-requirement", kind: "specification", text: "a",
    derivedFrom: "DP-1", governedBy: CODE, basisRefs, layer: "implementation",
    routingOrigin: "safe-default", alternative: "B", assumedAs: "A",
  });
  return s;
}

// A legal DEC needs a complete typed technical-decision ruling whose selectedAlternative matches
// the clause. Built in full rather than skipped, so the DEC path is really exercised.
function withDec(s, { clauseId, basisRefs, recordId = "R-dec" }) {
  const packet = {
    dpId: "DP-1", scenario: "s", alternatives: ["A", "B"], layer: "implementation",
    classificationBasis: "engineering standard", materialReasons: [], requestedPrincipal: CODE, basisRefs: [],
  };
  s.records.push({
    recordId, kind: "review-ruling", by: CODE, subjectRef: "DP-1", ruling: "ok",
    rulingKind: "technical-decision", basis: "stated basis",
    inputPacketSnapshot: packet, inputPacketDigest: digestOf(packet),
    decision: "chose A", approvedBy: CODE, selectedAlternative: "A", rejectedAlternatives: ["B"],
  });
  s.clauses.push({
    id: clauseId, authority: "approved-requirement", kind: "specification", text: "d",
    derivedFrom: "DP-1", approvedBy: CODE, layer: "implementation", decision: "A", alternatives: ["A", "B"],
    basisRefs: [...basisRefs, { kind: "review-ruling", ref: recordId }],
  });
  return s;
}

// A legal, effective retire Transition: user authority plus a plan-gate ack that resolves.
function withTransition(s, { id, subject, ackId = "R-ack" }) {
  s.records.push({
    recordId: ackId, kind: "plan-gate", target: subject, successor: null,
    impact: "no consumers", disposition: "no-affected-dependents", approvedBy: "user",
  });
  s.transitions.push({
    id, subject, action: "retire", authorityRef: { kind: "user" },
    effectiveAt: "2026-01-01T00:00:00.000Z", ackRef: { kind: "plan-gate", ref: ackId },
  });
  return s;
}

async function refused(promise, what, code) {
  let error = null;
  try { await promise; } catch (e) { error = e; }
  assert.ok(error instanceof GovernanceSeedPreimageError || (error && error.code),
    `${what}: expected a coded failure, got ${error}`);
  if (code) assert.strictEqual(error.code, code, `${what}: expected ${code}, got ${error.code} (${error.message})`);
  assert.ok(String(error.message).length > 10, `${what}: the failure must be diagnosable`);
  return error;
}

const build = (repo, baseTreeOid, extra) =>
  buildGovernanceSeedPreimage(extra ? { repoRoot: repo.root, baseTreeOid, ...extra } : { repoRoot: repo.root, baseTreeOid });

// --- (A) carrier shape, ordering, dedupe, deep-freeze -----------------------------------------

test("AC171 (A): the carrier is exactly four keys, deeply frozen, with a canonical clause array", () => withRepo(async (repo) => {
  repo.write("README.md", "hello\n");
  const oid = repo.commit();

  const out = await build(repo, oid);
  assert.deepStrictEqual(Object.keys(out).sort(), CARRIER_KEYS, "exact key set, no free-form metadata");
  assert.strictEqual(out.baseTreeOid, oid);
  assert.match(out.headViewDigest, /^[0-9a-f]{64}$/);
  assert.match(out.inputProvenanceStoreDigest, /^[0-9a-f]{64}$/);
  assert.ok(Array.isArray(out.lifecycleAffectedClauses));

  // (vi) deep-freeze: a write throws or has no effect, and the carrier is unchanged afterwards.
  // This is NOT evidence of reaching a rejection branch -- a frozen object cannot be corrupted, so
  // "hand the runtime a broken result" has no entry point at all.
  const beforeKeys = Object.keys(out).sort();
  const beforeList = [...out.lifecycleAffectedClauses];
  assert.ok(Object.isFrozen(out) && Object.isFrozen(out.lifecycleAffectedClauses), "root and nested frozen");
  assert.throws(() => { "use strict"; out.baseTreeOid = "x"; }, TypeError);
  assert.throws(() => { "use strict"; out.extra = 1; }, TypeError);
  assert.throws(() => { "use strict"; out.lifecycleAffectedClauses.push("REQ-x"); }, TypeError);
  assert.deepStrictEqual(Object.keys(out).sort(), beforeKeys, "still canonical after the attempts");
  assert.deepStrictEqual([...out.lifecycleAffectedClauses], beforeList, "field for field unchanged");
}));

test("AC171 (A)(iii)-(v): the emitted clause array is grammar-conformant, strictly ordered and duplicate-free", () => withRepo(async (repo) => {
  // Output assertions on a LEGAL fixture. Four new clauses land in the union from three different
  // sets, so ordering and dedupe are exercised by real membership rather than by a doctored result.
  repo.write("README.md", "hello\n");
  const oid = repo.commit();
  const current = legal(withRepoFileClause(
    withGrant(withGrant(baseStore(), { expiry: "2020-01-01", clauseId: REQ("0B"), sourceId: "S-exc" }),
      { expiry: "2020-01-01", clauseId: REQ("0E"), sourceId: "S-exc2" }),
    { clauseId: REQ("0C"), sourceId: "S-file", excerpt: "never present anywhere" }));
  repo.putStore(current);

  const out = await build(repo, oid);
  const list = out.lifecycleAffectedClauses;
  for (const id of list) assert.ok(isCanonicalClauseRef(id), `${id} is a canonical ClauseRef`);
  const sorted = [...list].sort(compareCodePoint);
  assert.deepStrictEqual(list, sorted, "strictly increasing by Unicode code point");
  assert.strictEqual(new Set(list).size, list.length, "no duplicates");
  assert.ok(list.length >= 3, `three sets contribute members, got ${JSON.stringify(list)}`);
  // REQ-...0B is both semantically new AND expired; it appears exactly once.
  assert.strictEqual(list.filter((x) => x === REQ("0B")).length, 1, "an overlapping member appears once");
}));

// --- (E) anti-injection ------------------------------------------------------------------------

test("AC171 (E): the request is exactly { repoRoot, baseTreeOid } and every injection alias is refused", () => withRepo(async (repo) => {
  repo.write("README.md", "hello\n");
  const oid = repo.commit();
  await build(repo, oid); // the legal call works, so the refusals below are about the extra key alone

  const e2 = await refused(buildGovernanceSeedPreimage({ repoRoot: repo.root, baseTreeOid: oid }, { now: 1 }),
    "a second argument", "E_API_ARGUMENTS");
  assert.match(e2.message, /exactly one argument/);

  const aliases = [
    "preimage", "discoveryAnalysisPreimage", "governanceSeedPreimage", "seed", "registry", "registryPath",
    "registryDigest", "parser", "ignoreMatcher", "gitExecutable", "env", "fs", "config", "configPath",
    "modulePaths", "view", "snapshot", "headViewSnapshot", "headViewDigest", "storeBytes", "store",
    "parsedStore", "storeDigest", "inputProvenanceStoreDigest", "storePath", "lifecycleAffectedClauses",
    "governanceHit", "hitSet", "reverseClosure", "matcherResult", "pairs", "entries", "inventoryDigest",
    "clock", "now", "timestamp", "date", "dateProvider", "clockProvider", "T0", "captureHook",
    "componentModulePath", "outputPath",
  ];
  for (const key of aliases) {
    const e = await refused(build(repo, oid, { [key]: "anything" }), `injected ${key}`, "E_API_ARGUMENTS");
    assert.match(e.message, new RegExp(key.replace(/[$()*+.?[\\\]^{|}]/g, "\\$&")), `${key}: the refusal names the key`);
  }
  await refused(build(repo, oid, { unexpected: 1 }), "an unknown extra key", "E_API_ARGUMENTS");
  await refused(buildGovernanceSeedPreimage({ repoRoot: repo.root }), "a missing key", "E_API_ARGUMENTS");
  await refused(buildGovernanceSeedPreimage({ baseTreeOid: oid }), "a missing repoRoot", "E_API_ARGUMENTS");
  await refused(buildGovernanceSeedPreimage("not an object"), "a non-object request", "E_API_ARGUMENTS");

  for (const bad of ["HEAD", "main", oid.slice(0, 8), oid.toUpperCase(), "", 42]) {
    await refused(buildGovernanceSeedPreimage({ repoRoot: repo.root, baseTreeOid: bad }),
      `baseTreeOid ${JSON.stringify(bad)}`, "E_BASE_TREE_OID");
  }
}));

// --- (B) store capture, version matrix, G1/G2 --------------------------------------------------

test("AC171 (B)(viii)-(ix): the current-store version matrix, with absence as canonical empty v2", () => withRepo(async (repo) => {
  repo.write("README.md", "hello\n");
  const oid = repo.commit();

  // absent -> the canonical empty v2 digest, not null and not the empty string
  const absent = await build(repo, oid);
  assert.strictEqual(absent.inputProvenanceStoreDigest, storeDigest(emptyStore()));

  // an explicit canonical empty v2 store hashes to the SAME value: presence is not a signal
  repo.putStore(emptyStore());
  const explicitEmpty = await build(repo, oid);
  assert.strictEqual(explicitEmpty.inputProvenanceStoreDigest, absent.inputProvenanceStoreDigest,
    "missing and explicitly-empty are the same digest");

  // a normal v2 store is analysed
  repo.putStore(legal(baseStore()));
  const normal = await build(repo, oid);
  assert.notStrictEqual(normal.inputProvenanceStoreDigest, absent.inputProvenanceStoreDigest);

  // current v1 -> fail-closed, and the producer neither migrates nor writes back
  const before = (() => { const v1 = JSON.parse(JSON.stringify(baseStore())); v1.provenanceVersion = 1; return JSON.stringify(v1); })();
  fs.writeFileSync(path.join(repo.root, ".ctide", "provenance.json"), before, "utf8");
  const v1e = await refused(build(repo, oid), "current v1", "E_CURRENT_STORE_VERSION");
  assert.match(v1e.message, /migration transaction/);
  assert.strictEqual(repo.readStore(), before, "the store is untouched: no migration, no write-back");

  // an unsupported version and malformed bytes are version/schema failures on their own layer
  const v9 = JSON.parse(JSON.stringify(baseStore())); v9.provenanceVersion = 9;
  fs.writeFileSync(path.join(repo.root, ".ctide", "provenance.json"), JSON.stringify(v9), "utf8");
  await refused(build(repo, oid), "an unsupported version", "E_CURRENT_STORE_SCHEMA");
  fs.writeFileSync(path.join(repo.root, ".ctide", "provenance.json"), "{ not json", "utf8");
  await refused(build(repo, oid), "malformed bytes", "E_CURRENT_STORE_SCHEMA");
}));

test("AC171 (B)(x)+(xiv): the base store comes from the exact tree, never from the live current store", () => withRepo(async (repo) => {
  // The base tree carries a store with one clause. The working tree carries a DIFFERENT store with
  // an extra clause. If the base were read from the live store the two would be identical and the
  // seed would be permanently empty -- so a non-empty seed is the evidence they are separate.
  const inBase = legal(baseStore());
  repo.write(".ctide/provenance.json", canonicalStoreBytes(inBase));
  repo.write("README.md", "hello\n");
  const oid = repo.commit();

  const current = legal(withGrant(baseStore(), { expiry: "2099-01-01" }));
  repo.putStore(current);
  const out = await build(repo, oid);
  assert.deepStrictEqual(out.lifecycleAffectedClauses, [REQ("0B")],
    "the new clause is seen because base came from the tree, not from the live store");

  // A historical v1 base tree is analysable read-only; the current-v1 restriction is not pushed onto it.
  const v1 = JSON.parse(JSON.stringify(inBase)); v1.provenanceVersion = 1;
  const repo2 = makeRepo("ctide-gsp-v1base-");
  try {
    repo2.write(".ctide/provenance.json", JSON.stringify(v1));
    repo2.write("README.md", "hello\n");
    const oid2 = repo2.commit();
    repo2.putStore(legal(withGrant(baseStore(), { expiry: "2099-01-01" })));
    const out2 = await buildGovernanceSeedPreimage({ repoRoot: repo2.root, baseTreeOid: oid2 });
    assert.deepStrictEqual(out2.lifecycleAffectedClauses, [REQ("0B")], "a v1 base tree is read-only analysable");
  } finally { fs.rmSync(repo2.root, { recursive: true, force: true }); }

  // A base tree with an unsupported version fails closed.
  const repo3 = makeRepo("ctide-gsp-v9base-");
  try {
    const v9 = JSON.parse(JSON.stringify(inBase)); v9.provenanceVersion = 9;
    repo3.write(".ctide/provenance.json", JSON.stringify(v9));
    const oid3 = repo3.commit();
    await refused(buildGovernanceSeedPreimage({ repoRoot: repo3.root, baseTreeOid: oid3 }),
      "a base tree at an unsupported version", "E_BASE_STORE_SCHEMA");
  } finally { fs.rmSync(repo3.root, { recursive: true, force: true }); }

  // An object that is not a tree, and one that merely peels to a tree, are both refused.
  const commitOid = repo.git("rev-parse", "HEAD");
  await refused(buildGovernanceSeedPreimage({ repoRoot: repo.root, baseTreeOid: commitOid }),
    "a commit that peels to a tree", "E_BASE_TREE_OID");
}));

test("AC171 (B)(xi): G1/G2 equality compares canonical digests only; presence is not a signal", () => withRepo(async (repo) => {
  repo.write("README.md", "hello\n");
  const oid = repo.commit();

  // positive 1+3: both sides absent, and absent -> explicitly-empty, hash the same, so they pass.
  const bothAbsent = await build(repo, oid);
  assert.deepStrictEqual(bothAbsent.lifecycleAffectedClauses, []);

  // The negative is a REAL mid-derivation change, produced deterministically by the shape-B probe
  // below rather than by racing this process against itself. Here we assert the digest rule the
  // probe exercises: a non-empty v2 store does NOT hash to the canonical empty digest, so an
  // absent -> non-empty transition is caught by digest inequality, not by a presence flag.
  assert.notStrictEqual(storeDigest(legal(baseStore())), storeDigest(emptyStore()));
}));

// --- (C) T0 and expiry ---------------------------------------------------------------------------

test("AC171 (C)(xvi)-(xvii): expiry membership at the T0 boundary, and the exact grammar", () => withRepo(async (repo) => {
  repo.write("README.md", "hello\n");
  const oid = repo.commit();

  // Far future: not expired, so the grant clause is in the seed only as a NEW clause. Far past:
  // expired as well. Both land the same id once, so membership is asserted through a store whose
  // clause already exists in the base tree.
  const inBase = legal(withGrant(baseStore(), { expiry: "2020-01-01" }));
  const repoB = makeRepo("ctide-gsp-exp-");
  try {
    repoB.write(".ctide/provenance.json", canonicalStoreBytes(inBase));
    repoB.write("README.md", "hello\n");
    const oidB = repoB.commit();
    repoB.putStore(inBase); // identical to base: the ONLY possible member is the expired clause
    const out = await buildGovernanceSeedPreimage({ repoRoot: repoB.root, baseTreeOid: oidB });
    assert.deepStrictEqual(out.lifecycleAffectedClauses, [REQ("0B")], "a past expiry is expired at T0");
  } finally { fs.rmSync(repoB.root, { recursive: true, force: true }); }

  const repoC = makeRepo("ctide-gsp-live-");
  try {
    const live = legal(withGrant(baseStore(), { expiry: "2099-01-01" }));
    repoC.write(".ctide/provenance.json", canonicalStoreBytes(live));
    repoC.write("README.md", "hello\n");
    const oidC = repoC.commit();
    repoC.putStore(live);
    const out = await buildGovernanceSeedPreimage({ repoRoot: repoC.root, baseTreeOid: oidC });
    assert.deepStrictEqual(out.lifecycleAffectedClauses, [], "a future expiry is not expired");
  } finally { fs.rmSync(repoC.root, { recursive: true, force: true }); }

  // Grammar: a non-canonical expiry is a validation failure, never a membership answer. These are
  // planted, because the store writer now refuses them at the Source layer.
  for (const bad of ["2099-01-01T12:00:00Z", " 2026-01-01", "1900-02-29", "2026-2-01", "0000-01-01"]) {
    const planted = withGrant(baseStore(), { expiry: "2099-01-01" });
    planted.sources.find((s) => s.sourceId === "S-exc").expiry = bad;
    repo.putStore(planted);
    // The refusal is now at G1's CLOCK-FREE schema validation -- before T0 exists -- which is the
    // layer that owns "is this store legal at all", not a membership answer.
    await refused(build(repo, oid), `planted expiry ${JSON.stringify(bad)}`, "E_CURRENT_STORE_SCHEMA");
  }
}));

test("AC171 (C)(xviii): a DEC and an ASSUM never expire through an exception-grant basis", () => withRepo(async (repo) => {
  // Both clause kinds are built for real and asserted on. The earlier version of this test skipped
  // when its fixture would not validate and then asserted a tautology, which is no evidence at all.
  const inBase = legal(withDec(withAssum(withDp(withGrant(baseStore(), { expiry: "2020-01-01" })),
    { clauseId: "ASSUM-" + U("0F"), basisRefs: ["S-exc"] }), { clauseId: DEC("0D"), basisRefs: ["S-exc"] }));
  repo.write(".ctide/provenance.json", canonicalStoreBytes(inBase));
  repo.write("README.md", "hello\n");
  const oid = repo.commit();
  repo.putStore(inBase);

  const out = await build(repo, oid);
  // The grant is long expired, and the REQ that cites it IS a member -- so the set is live.
  assert.ok(out.lifecycleAffectedClauses.includes(REQ("0B")), "the REQ on the expired grant is expired");
  // The DEC and the ASSUM cite the SAME expired grant in basisRefs and must not be members.
  assert.ok(!out.lifecycleAffectedClauses.includes(DEC("0D")), "a DEC does not expire through basisRefs");
  assert.ok(!out.lifecycleAffectedClauses.includes("ASSUM-" + U("0F")), "nor does an ASSUM");
}));

test("AC171 (D)(xxiii): a DEC and an ASSUM drift through their DIRECT Source set", () => withRepo(async (repo) => {
  // basisRefs carry a plain "S-…" string. The component used to look for { kind: "source", ref },
  // which never matches anything in this model, so DEC/ASSUM drift was dead code that no test
  // noticed. These two cases are what makes it live.
  const excerpt = "the basis sentence";
  const build2 = (s) => legal(withDec(withAssum(withDp(withSource(s, { sourceId: "S-basis", excerpt })),
    { clauseId: "ASSUM-" + U("0F"), basisRefs: ["S-basis"] }), { clauseId: DEC("0D"), basisRefs: ["S-basis"] }));
  const inBase = build2(baseStore());
  repo.write(".ctide/provenance.json", canonicalStoreBytes(inBase));
  repo.write("docs/policy.md", `intro\n${excerpt}\n`);
  const oid = repo.commit();
  repo.putStore(inBase);

  assert.deepStrictEqual((await build(repo, oid)).lifecycleAffectedClauses, [], "present: neither drifts");

  repo.write("docs/policy.md", "gone\n");
  const drifted = (await build(repo, oid)).lifecycleAffectedClauses;
  assert.ok(drifted.includes(DEC("0D")), "the DEC drifts through its direct Source");
  assert.ok(drifted.includes("ASSUM-" + U("0F")), "and so does the ASSUM");

  // A RecordRef in the same basisRefs is NOT followed: the DEC cites its ruling record too, and
  // that must never turn into a Source lookup.
  assert.strictEqual(drifted.filter((x) => x.startsWith("R-")).length, 0, "no record ever becomes a member");
}));

test("AC171 (D)(xxiii): one drifted Source referenced by two clauses puts BOTH in the set", () => withRepo(async (repo) => {
  const excerpt = "the shared sentence";
  // withRepoFileClause already mints the Source; adding it twice is a duplicate id, not a fixture.
  const make = (s) => legal(withAssum(withDp(withRepoFileClause(s,
    { clauseId: REQ("0C"), sourceId: "S-shared", excerpt })), { clauseId: "ASSUM-" + U("0F"), basisRefs: ["S-shared"] }));
  const inBase = make(baseStore());
  repo.write(".ctide/provenance.json", canonicalStoreBytes(inBase));
  repo.write("docs/policy.md", "nothing matching\n");
  const oid = repo.commit();
  repo.putStore(inBase);
  const out = (await build(repo, oid)).lifecycleAffectedClauses;
  assert.ok(out.includes(REQ("0C")) && out.includes("ASSUM-" + U("0F")),
    `both direct referrers of one drifted Source are members, got ${JSON.stringify(out)}`);
}));

// --- (D) the four sets and the union ------------------------------------------------------------

test("AC171 (D)(xix)-(xxi): identical stores yield an empty seed; a new clause is semantic; divergence is integrity", () => withRepo(async (repo) => {
  const inBase = legal(baseStore());
  repo.write(".ctide/provenance.json", canonicalStoreBytes(inBase));
  repo.write("README.md", "hello\n");
  const oid = repo.commit();

  repo.putStore(inBase);
  assert.deepStrictEqual((await build(repo, oid)).lifecycleAffectedClauses, [], "no change, no drift, no expiry -> empty");

  repo.putStore(legal(withGrant(baseStore(), { expiry: "2099-01-01" })));
  assert.deepStrictEqual((await build(repo, oid)).lifecycleAffectedClauses, [REQ("0B")], "a new clause is semantic");

  // same id, different payload -> integrity failure, NOT a seed
  const diverged = legal((() => { const s = baseStore(); s.clauses[0].text = "changed in place"; return s; })());
  repo.putStore(diverged);
  const e = await refused(build(repo, oid), "same id, different payload", "E_IMMUTABLE_DIVERGED");
  assert.match(e.message, /integrity failure, not a lifecycle seed/);

  // a base immutable object that vanished from the current store -> integrity failure
  const shrunk = emptyStore();
  repo.putStore(shrunk);
  await refused(build(repo, oid), "a base object missing from current", "E_BASE_OBJECT_MISSING");
}));

test("AC171 (D)(xxiii): Check B counts occurrences against the head view; snapshot-only never drifts", () => withRepo(async (repo) => {
  const excerpt = "the anchored sentence";
  const inBase = legal(withRepoFileClause(baseStore(), { excerpt }));
  repo.write(".ctide/provenance.json", canonicalStoreBytes(inBase));
  repo.write("docs/policy.md", `intro\n${excerpt}\ntail\n`);
  const oid = repo.commit();
  repo.putStore(inBase);

  // one occurrence -> not drift
  assert.deepStrictEqual((await build(repo, oid)).lifecycleAffectedClauses, [], "one occurrence is not drift");

  // two occurrences -> anchor ambiguity, still not drift
  repo.write("docs/policy.md", `intro\n${excerpt}\nmiddle\n${excerpt}\n`);
  assert.deepStrictEqual((await build(repo, oid)).lifecycleAffectedClauses, [], "two occurrences is an observation, not drift");

  // one occurrence somewhere else entirely -> the locator is a hint, not a constraint
  repo.write("docs/policy.md", "intro\n");
  repo.write("docs/elsewhere.md", `${excerpt}\n`);
  assert.deepStrictEqual((await build(repo, oid)).lifecycleAffectedClauses, [], "the locator does not restrict the search");

  // zero occurrences -> drift
  repo.write("docs/elsewhere.md", "gone\n");
  assert.deepStrictEqual((await build(repo, oid)).lifecycleAffectedClauses, [REQ("0C")], "zero occurrences is drift");

  // the same clause as snapshot-only never drifts, even with zero occurrences
  const snapshotOnly = legal((() => {
    const s = withRepoFileClause(baseStore(), { excerpt });
    s.sources.find((x) => x.sourceId === "S-file").driftMode = "snapshot-only";
    return s;
  })());
  const repo2 = makeRepo("ctide-gsp-snaponly-");
  try {
    repo2.write(".ctide/provenance.json", canonicalStoreBytes(snapshotOnly));
    repo2.write("README.md", "nothing matching\n");
    const oid2 = repo2.commit();
    repo2.putStore(snapshotOnly);
    assert.deepStrictEqual((await buildGovernanceSeedPreimage({ repoRoot: repo2.root, baseTreeOid: oid2 })).lifecycleAffectedClauses,
      [], "snapshot-only never drifts");
  } finally { fs.rmSync(repo2.root, { recursive: true, force: true }); }
}));

test("AC171 (D)(xxii): a new effective transition puts its SUBJECT in the seed; a duplicate fails closed", () => withRepo(async (repo) => {
  // Built as a legal, effective retire -- user authority plus a resolving plan-gate ack -- so the
  // positive really runs instead of being skipped when the fixture happens not to validate.
  const inBase = legal(withGrant(baseStore(), { expiry: "2099-01-01" }));
  repo.write(".ctide/provenance.json", canonicalStoreBytes(inBase));
  repo.write("README.md", "hello\n");
  const oid = repo.commit();

  const moved = legal(withTransition(JSON.parse(JSON.stringify(inBase)), { id: "T-1", subject: REQ("0B") }));
  repo.putStore(moved);
  const out = (await build(repo, oid)).lifecycleAffectedClauses;
  assert.deepStrictEqual(out, [REQ("0B")], "the subject is a member, and only the subject");
  assert.ok(!out.includes("T-1"), "the transition id itself is never a member");

  // Two newly effective transitions on the same clause: an integrity failure, not two members.
  const twice = JSON.parse(JSON.stringify(moved));
  twice.records.push({
    recordId: "R-ack2", kind: "plan-gate", target: REQ("0B"), successor: null,
    impact: "no consumers", disposition: "no-affected-dependents", approvedBy: "user",
  });
  twice.transitions.push({
    id: "T-2", subject: REQ("0B"), action: "retire", authorityRef: { kind: "user" },
    effectiveAt: "2026-01-02T00:00:00.000Z", ackRef: { kind: "plan-gate", ref: "R-ack2" },
  });
  repo.write(".ctide/provenance.json", JSON.stringify(twice));
  const dup = await refused(build(repo, oid), "two effective transitions on one clause", undefined);
  // The store layer gets there first with E_MULTIPLE_TRANSITIONS, which is the same fail-closed at
  // an earlier layer; the component keeps its own check for a store that somehow reaches it.
  assert.ok(["E_TRANSITION_DUPLICATE", "E_CURRENT_STORE_SCHEMA", "E_MULTIPLE_TRANSITIONS"].includes(dup.code),
    `a duplicate effective transition must fail closed, got ${dup.code}`);

  // A transition naming a subject that is not a clause fails closed too.
  const dangling = JSON.parse(JSON.stringify(inBase));
  dangling.transitions.push({ id: "T-x", subject: REQ("9Z"), action: "retire", authorityRef: { kind: "user" }, effectiveAt: "2026-01-01T00:00:00.000Z" });
  repo.write(".ctide/provenance.json", JSON.stringify(dangling));
  await refused(build(repo, oid), "a dangling transition subject", undefined);
}));

// --- shape-B probes: the two things no legal input can reach -------------------------------------

// A disposable copy of the whole scripts directory, so relative imports still resolve and the repo
// working tree is never written to. Every probe below runs in its own child process.
function scratchScripts(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  fs.cpSync(SCRIPTS, path.join(dir, "scripts"), { recursive: true });
  return dir;
}

function patch(file, from, to) {
  const text = fs.readFileSync(file, "utf8");
  assert.strictEqual(text.split(from).length - 1, 1, `the single-point edit target must be unique: ${from}`);
  fs.writeFileSync(file, text.split(from).join(to), "utf8");
}

const runChild = (script) => {
  const r = cp.spawnSync(process.execPath, [script], { encoding: "utf8" });
  return { code: r.status, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
};

test("AC171 (B)(vii): exactly two current-store loads, G1 then G2, with nothing in between", () => withRepo(async (repo) => {
  repo.write("README.md", "hello\n");
  const oid = repo.commit();
  repo.putStore(legal(baseStore()));

  const scratch = scratchScripts("ctide-gsp-trace-");
  try {
    // The ONE edit: the fixed internal store-loader import now points at a counting proxy that
    // records an ordered load trace. Nothing else in the copy changes, and the production module in
    // this process is never touched.
    const proxy = path.join(scratch, "scripts", "counting-proxy.mjs");
    fs.writeFileSync(proxy, [
      'import { readCurrentStoreFile as real } from "./current-store-load.mjs";',
      'export function readCurrentStoreFile(repoRoot) {',
      '  globalThis.__trace = globalThis.__trace || [];',
      '  globalThis.__trace.push("current-store-load");',
      '  return real(repoRoot);',
      '}',
    ].join("\n"), "utf8");
    patch(path.join(scratch, "scripts", "governance-seed-preimage.mjs"),
      'from "./current-store-load.mjs"', 'from "./counting-proxy.mjs"');

    const script = path.join(scratch, "run.mjs");
    fs.writeFileSync(script, [
      'const m = await import("./scripts/governance-seed-preimage.mjs");',
      `const out = await m.buildGovernanceSeedPreimage({ repoRoot: ${JSON.stringify(repo.root)}, baseTreeOid: ${JSON.stringify(oid)} });`,
      'console.log(JSON.stringify({ trace: globalThis.__trace, keys: Object.keys(out).sort() }));',
    ].join("\n"), "utf8");

    const r = runChild(script);
    assert.strictEqual(r.code, 0, `the probe run must succeed: ${r.err}`);
    const { trace, keys } = JSON.parse(r.out);
    // Exactly two: G1 before the closure, G2 after. Zero between validation, digest and derivation.
    assert.strictEqual(trace.length, 2, `a successful invocation loads the current store exactly twice, got ${trace.length}`);
    assert.deepStrictEqual(trace, ["current-store-load", "current-store-load"]);
    assert.deepStrictEqual(keys, CARRIER_KEYS, "and it still produced the four-key carrier");
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}));

test("AC171 (B)(xi) negative 2: a store that changes between G1 and G2 fails closed, deterministically", () => withRepo(async (repo) => {
  repo.write("README.md", "hello\n");
  const oid = repo.commit();
  repo.putStore(legal(baseStore()));

  const scratch = scratchScripts("ctide-gsp-g2-");
  try {
    // Single-point edit: the loader proxy rewrites the store synchronously between the first and
    // second read. No race, no concurrent writer, no sleeping -- the change lands at a fixed point.
    const grown = canonicalStoreBytes(legal(withGrant(baseStore(), { expiry: "2099-01-01" })));
    const proxy = path.join(scratch, "scripts", "counting-proxy.mjs");
    fs.writeFileSync(proxy, [
      'import fs from "node:fs";',
      'import path from "node:path";',
      'import { readCurrentStoreFile as real } from "./current-store-load.mjs";',
      'let calls = 0;',
      'export function readCurrentStoreFile(repoRoot) {',
      '  calls += 1;',
      '  const text = real(repoRoot);',
      '  if (calls === 1) {',
      `    fs.writeFileSync(path.join(repoRoot, ".ctide", "provenance.json"), ${JSON.stringify(grown)}, "utf8");`,
      '  }',
      '  return text;',
      '}',
    ].join("\n"), "utf8");
    patch(path.join(scratch, "scripts", "governance-seed-preimage.mjs"),
      'from "./current-store-load.mjs"', 'from "./counting-proxy.mjs"');

    const script = path.join(scratch, "run.mjs");
    fs.writeFileSync(script, [
      'const m = await import("./scripts/governance-seed-preimage.mjs");',
      'try {',
      `  const out = await m.buildGovernanceSeedPreimage({ repoRoot: ${JSON.stringify(repo.root)}, baseTreeOid: ${JSON.stringify(oid)} });`,
      '  console.log(JSON.stringify({ ok: true, out }));',
      '} catch (e) { console.log(JSON.stringify({ ok: false, code: e.code, message: String(e.message) })); }',
    ].join("\n"), "utf8");

    const r = runChild(script);
    assert.strictEqual(r.code, 0, r.err);
    const result = JSON.parse(r.out);
    assert.strictEqual(result.ok, false, "a moving store must not produce a carrier");
    assert.strictEqual(result.code, "E_STORE_MOVED");
    assert.match(result.message, /no carrier is produced/);
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}));

test("AC171 (B)(xiii): a head view that moves between S1 and S2 stops the run, with no carrier", () => withRepo(async (repo) => {
  repo.write("README.md", "hello\n");
  repo.write("docs/policy.md", "stable\n");
  const oid = repo.commit();
  repo.putStore(legal(baseStore()));

  const scratch = scratchScripts("ctide-gsp-head-");
  try {
    // Single-point edit again, this time on the loader the producer calls INSIDE the evaluate
    // callback -- i.e. after S1 has been captured and before S2 is taken. The head file it rewrites
    // is a normal, non-excluded tracked file. Synchronous, so there is no race to lose.
    const proxy = path.join(scratch, "scripts", "counting-proxy.mjs");
    fs.writeFileSync(proxy, [
      'import fs from "node:fs";',
      'import path from "node:path";',
      'import { readCurrentStoreFile as real } from "./current-store-load.mjs";',
      'let calls = 0;',
      'export function readCurrentStoreFile(repoRoot) {',
      '  calls += 1;',
      '  if (calls === 1) fs.writeFileSync(path.join(repoRoot, "docs", "policy.md"), "moved between S1 and S2\\n", "utf8");',
      '  return real(repoRoot);',
      '}',
    ].join("\n"), "utf8");
    patch(path.join(scratch, "scripts", "governance-seed-preimage.mjs"),
      'from "./current-store-load.mjs"', 'from "./counting-proxy.mjs"');

    const script = path.join(scratch, "run.mjs");
    fs.writeFileSync(script, [
      'const m = await import("./scripts/governance-seed-preimage.mjs");',
      'try {',
      `  const out = await m.buildGovernanceSeedPreimage({ repoRoot: ${JSON.stringify(repo.root)}, baseTreeOid: ${JSON.stringify(oid)} });`,
      '  console.log(JSON.stringify({ ok: true, keys: Object.keys(out) }));',
      '} catch (e) { console.log(JSON.stringify({ ok: false, code: e.code, message: String(e.message) })); }',
    ].join("\n"), "utf8");

    const r = runChild(script);
    assert.strictEqual(r.code, 0, r.err);
    const result = JSON.parse(r.out);
    assert.strictEqual(result.ok, false, "an unstable head view must not produce a carrier");
    assert.strictEqual(result.code, "E_HEAD_VIEW_UNSTABLE");
    assert.match(result.message, /head-view-unstable/);
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}));

test("AC171 (C)(xv): T0 is sampled exactly once, after import, and reused for every expiry decision", () => withRepo(async (repo) => {
  repo.write("README.md", "hello\n");
  const oid = repo.commit();
  // The grant expires BETWEEN T0 and T1. One armed read -> not expired -> empty seed. A second read
  // would return T1, cross the boundary, and put the clause in the seed, so membership itself is the
  // witness that the clock was read once.
  const live = legal(withGrant(baseStore(), { expiry: "2030-06-15" }));
  repo.write(".ctide/provenance.json", canonicalStoreBytes(live));
  const oid2 = repo.commit();
  repo.putStore(live);

  const scratch = scratchScripts("ctide-gsp-clock-");
  try {
    const script = path.join(scratch, "run.mjs");
    // Two-stage probe. The wrapper is installed BEFORE the dynamic import but disarmed, so
    // import-time reads return a fixed prelude value and do not count. The counter is reset and
    // armed after the import; the first armed read returns T0, every later one returns T1.
    fs.writeFileSync(script, [
      'const T0 = Date.UTC(2030, 5, 14);',
      'const T1 = Date.UTC(2030, 5, 16);',
      'const PRELUDE = Date.UTC(2000, 0, 1);',
      'let armed = false;',
      'let count = 0;',
      'Date.now = () => {',
      '  if (!armed) return PRELUDE;',
      '  count += 1;',
      '  return count === 1 ? T0 : T1;',
      '};',
      'const m = await import("./scripts/governance-seed-preimage.mjs");',
      'count = 0;',
      'armed = true;',
      'let result;',
      'try {',
      `  const out = await m.buildGovernanceSeedPreimage({ repoRoot: ${JSON.stringify(repo.root)}, baseTreeOid: ${JSON.stringify(oid2)} });`,
      '  result = { ok: true, seed: out.lifecycleAffectedClauses };',
      '} catch (e) { result = { ok: false, code: e.code, message: String(e.message) }; }',
      'console.log(JSON.stringify({ ...result, armedReads: count }));',
    ].join("\n"), "utf8");

    const r = runChild(script);
    assert.strictEqual(r.code, 0, r.err);
    const out = JSON.parse(r.out);
    assert.strictEqual(out.ok, true, `the probe run must produce a carrier: ${out.code} ${out.message}`);
    // 0 would mean the clock was sampled at import time and reused; above 1 would mean it was
    // re-read inside the invocation. Both must fail this assertion.
    assert.strictEqual(out.armedReads, 1, `exactly one armed clock read, got ${out.armedReads}`);
    assert.deepStrictEqual(out.seed, [], "decided by T0: the grant has not expired");
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  void oid;
}));

// --- no side effects ------------------------------------------------------------------------------

test("AC171: a failing invocation returns nothing and writes nothing", () => withRepo(async (repo) => {
  const store = legal(baseStore());
  repo.write(".ctide/provenance.json", canonicalStoreBytes(store));
  repo.write("README.md", "hello\n");
  const oid = repo.commit();
  const before = repo.readStore();
  const listing = () => fs.readdirSync(path.join(repo.root, ".ctide")).sort();
  const beforeListing = listing();

  // A base object that vanished: a guaranteed failure part-way through the derivation.
  repo.putStore(emptyStore());
  const changed = repo.readStore();
  await refused(build(repo, oid), "a mid-derivation failure", undefined);
  assert.strictEqual(repo.readStore(), changed, "the store is exactly as the test left it: nothing was written back");
  assert.deepStrictEqual(listing(), beforeListing, "no output, lock or temp file appeared under .ctide");
  assert.ok(!fs.existsSync(path.join(repo.root, ".ctide", "output")), "no .ctide/output/** was created");
  void before;
}));

// --- remaining AC171 cases -------------------------------------------------------------------------

test("AC171 (B)(xi): missing <-> explicitly-empty passes in BOTH directions, deterministically", () => withRepo(async (repo) => {
  repo.write("README.md", "hello\n");
  const oid = repo.commit();
  const emptyBytes = canonicalStoreBytes(emptyStore());
  const storeFile = path.join(repo.root, ".ctide", "provenance.json");

  // Both directions are mid-invocation transitions, so both are produced with the shape-B loader
  // proxy rather than by racing. Presence changes; the canonical digest does not; both must pass.
  for (const [label, first, second] of [
    ["G1 absent -> G2 explicit empty", null, emptyBytes],
    ["G1 explicit empty -> G2 absent", emptyBytes, null],
  ]) {
    const scratch = scratchScripts("ctide-gsp-presence-");
    try {
      if (first === null) fs.rmSync(storeFile, { force: true });
      else { fs.mkdirSync(path.dirname(storeFile), { recursive: true }); fs.writeFileSync(storeFile, first, "utf8"); }
      const proxy = path.join(scratch, "scripts", "counting-proxy.mjs");
      fs.writeFileSync(proxy, [
        'import fs from "node:fs";',
        'import path from "node:path";',
        'import { readCurrentStoreFile as real } from "./current-store-load.mjs";',
        "let calls = 0;",
        "export function readCurrentStoreFile(repoRoot) {",
        "  calls += 1;",
        "  const text = real(repoRoot);",
        "  if (calls === 1) {",
        '    const f = path.join(repoRoot, ".ctide", "provenance.json");',
        `    ${second === null ? 'fs.rmSync(f, { force: true });' : 'fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ' + JSON.stringify(second) + ', "utf8");'}`,
        "  }",
        "  return text;",
        "}",
      ].join("\n"), "utf8");
      patch(path.join(scratch, "scripts", "governance-seed-preimage.mjs"),
        'from "./current-store-load.mjs"', 'from "./counting-proxy.mjs"');
      const script = path.join(scratch, "run.mjs");
      fs.writeFileSync(script, [
        'const m = await import("./scripts/governance-seed-preimage.mjs");',
        "try {",
        `  const out = await m.buildGovernanceSeedPreimage({ repoRoot: ${JSON.stringify(repo.root)}, baseTreeOid: ${JSON.stringify(oid)} });`,
        "  console.log(JSON.stringify({ ok: true, digest: out.inputProvenanceStoreDigest }));",
        "} catch (e) { console.log(JSON.stringify({ ok: false, code: e.code, message: String(e.message) })); }",
      ].join("\n"), "utf8");
      const r = runChild(script);
      assert.strictEqual(r.code, 0, r.err);
      const result = JSON.parse(r.out);
      assert.strictEqual(result.ok, true, `${label} must pass: ${result.code} ${result.message}`);
      assert.strictEqual(result.digest, storeDigest(emptyStore()), `${label}: the canonical empty digest`);
    } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  }
}));

test("AC171 (B)(xi)+(xii): a JSON-valid but SCHEMA-invalid G2 is a schema failure, never E_STORE_MOVED", () => withRepo(async (repo) => {
  repo.write("README.md", "hello\n");
  const oid = repo.commit();
  repo.putStore(legal(baseStore()));

  // The two layers must not impersonate each other. A G2 that parses but is not a legal store has
  // to be reported as version/schema, because "the store moved" is a different and more
  // misleading fact -- and because a digest comparison against an illegal store means nothing.
  const bad = JSON.parse(JSON.stringify(baseStore()));
  bad.clauses.push({ id: REQ("0B"), authority: "approved-requirement", kind: "specification", text: "t", sourceRef: "S-does-not-exist", taskRef: "TASK-1" });
  const scratch = scratchScripts("ctide-gsp-badg2-");
  try {
    const proxy = path.join(scratch, "scripts", "counting-proxy.mjs");
    fs.writeFileSync(proxy, [
      'import fs from "node:fs";',
      'import path from "node:path";',
      'import { readCurrentStoreFile as real } from "./current-store-load.mjs";',
      "let calls = 0;",
      "export function readCurrentStoreFile(repoRoot) {",
      "  calls += 1;",
      "  const text = real(repoRoot);",
      "  if (calls === 1) {",
      `    fs.writeFileSync(path.join(repoRoot, ".ctide", "provenance.json"), ${JSON.stringify(JSON.stringify(bad))}, "utf8");`,
      "  }",
      "  return text;",
      "}",
    ].join("\n"), "utf8");
    patch(path.join(scratch, "scripts", "governance-seed-preimage.mjs"),
      'from "./current-store-load.mjs"', 'from "./counting-proxy.mjs"');
    const script = path.join(scratch, "run.mjs");
    fs.writeFileSync(script, [
      'const m = await import("./scripts/governance-seed-preimage.mjs");',
      "try {",
      `  await m.buildGovernanceSeedPreimage({ repoRoot: ${JSON.stringify(repo.root)}, baseTreeOid: ${JSON.stringify(oid)} });`,
      '  console.log(JSON.stringify({ ok: true }));',
      "} catch (e) { console.log(JSON.stringify({ ok: false, code: e.code, message: String(e.message) })); }",
    ].join("\n"), "utf8");
    const r = runChild(script);
    assert.strictEqual(r.code, 0, r.err);
    const result = JSON.parse(r.out);
    assert.strictEqual(result.ok, false, "an illegal G2 must not produce a carrier");
    assert.strictEqual(result.code, "E_CURRENT_STORE_SCHEMA", `expected a schema failure, got ${result.code}`);
    assert.notStrictEqual(result.code, "E_STORE_MOVED", "and it must NOT be reported as a moved store");
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}));

test("AC171 (C)(xv): an invalid G1 schema fails with the clock never read", () => withRepo(async (repo) => {
  repo.write("README.md", "hello\n");
  const oid = repo.commit();
  // JSON-valid, store-illegal: a clause pointing at a Source that is not there.
  const bad = JSON.parse(JSON.stringify(baseStore()));
  bad.clauses.push({ id: REQ("0B"), authority: "approved-requirement", kind: "specification", text: "t", sourceRef: "S-does-not-exist", taskRef: "TASK-1" });
  repo.write(".ctide/provenance.json", JSON.stringify(bad));

  const scratch = scratchScripts("ctide-gsp-clock0-");
  try {
    const script = path.join(scratch, "run.mjs");
    // Same two-stage probe as the positive: disarmed through the import, armed after. T0 is only
    // sampled once G1 parse AND schema validation have succeeded, so an illegal G1 must fail with
    // the armed count still at ZERO. A non-zero count would mean the clock was read first.
    fs.writeFileSync(script, [
      "let armed = false;",
      "let count = 0;",
      "const PRELUDE = Date.UTC(2000, 0, 1);",
      "Date.now = () => { if (!armed) return PRELUDE; count += 1; return Date.UTC(2030, 5, 14); };",
      'const m = await import("./scripts/governance-seed-preimage.mjs");',
      "count = 0;",
      "armed = true;",
      "let result;",
      "try {",
      `  await m.buildGovernanceSeedPreimage({ repoRoot: ${JSON.stringify(repo.root)}, baseTreeOid: ${JSON.stringify(oid)} });`,
      "  result = { ok: true };",
      "} catch (e) { result = { ok: false, code: e.code }; }",
      "console.log(JSON.stringify({ ...result, armedReads: count }));",
    ].join("\n"), "utf8");
    const r = runChild(script);
    assert.strictEqual(r.code, 0, r.err);
    const out = JSON.parse(r.out);
    assert.strictEqual(out.ok, false, "an illegal G1 must not produce a carrier");
    assert.strictEqual(out.code, "E_CURRENT_STORE_SCHEMA");
    assert.strictEqual(out.armedReads, 0, `the clock must not have been read at all, got ${out.armedReads}`);
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}));

test("AC171 (C)(xvi): expiryInstant exactly equal to T0 counts as EXPIRED", () => withRepo(async (repo) => {
  repo.write("README.md", "hello\n");
  const oid = repo.commit();
  const at = Date.UTC(2030, 5, 15); // 2030-06-15T00:00:00.000Z
  const store = legal(withGrant(baseStore(), { expiry: "2030-06-15" }));
  repo.write(".ctide/provenance.json", canonicalStoreBytes(store));
  const oid2 = repo.commit();
  repo.putStore(store);

  const scratch = scratchScripts("ctide-gsp-eq-");
  try {
    const script = path.join(scratch, "run.mjs");
    // The clock is pinned to the expiry instant itself. Equality is the whole case: <= T0 is
    // expired, so the clause must be a member even though not one millisecond has passed.
    fs.writeFileSync(script, [
      "let armed = false;",
      `const AT = ${at};`,
      "Date.now = () => (armed ? AT : Date.UTC(2000, 0, 1));",
      'const m = await import("./scripts/governance-seed-preimage.mjs");',
      "armed = true;",
      `const out = await m.buildGovernanceSeedPreimage({ repoRoot: ${JSON.stringify(repo.root)}, baseTreeOid: ${JSON.stringify(oid2)} });`,
      "console.log(JSON.stringify(out.lifecycleAffectedClauses));",
    ].join("\n"), "utf8");
    const r = runChild(script);
    assert.strictEqual(r.code, 0, r.err);
    assert.deepStrictEqual(JSON.parse(r.out), [REQ("0B")], "expiryInstant == T0 is expired, not live");

    // One millisecond earlier it is still live, which is what makes the equality case meaningful.
    fs.writeFileSync(script, fs.readFileSync(script, "utf8").replace(`const AT = ${at};`, `const AT = ${at - 1};`));
    const r2 = runChild(script);
    assert.strictEqual(r2.code, 0, r2.err);
    assert.deepStrictEqual(JSON.parse(r2.out), [], "one ms before T0 the grant is live");
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  void oid;
}));

test("AC171 (B)(x): a replacement ref must not redirect the base tree read", () => withRepo(async (repo) => {
  // Without --no-replace-objects (and the matching environment variable) Git answers "read tree A"
  // with tree B whenever refs/replace has an entry for A. The component would then derive its seed
  // against a base it was never asked about, and report the OID it was asked for -- a wrong answer
  // presented as a right one. This is the regression that catches it.
  const inBase = legal(baseStore());
  repo.write(".ctide/provenance.json", canonicalStoreBytes(inBase));
  repo.write("README.md", "hello\n");
  const treeA = repo.commit();

  // Tree B holds a DIFFERENT store: one extra clause. If the replacement takes effect, reading A
  // gets B, base and current match, and the seed comes back empty.
  const other = legal(withGrant(baseStore(), { expiry: "2099-01-01" }));
  repo.write(".ctide/provenance.json", canonicalStoreBytes(other));
  const treeB = repo.commit();
  repo.putStore(other);

  const sanity = await build(repo, treeA);
  assert.deepStrictEqual(sanity.lifecycleAffectedClauses, [REQ("0B")], "before any replacement, A is A");

  repo.git("replace", "-f", treeA, treeB);
  assert.ok(repo.git("replace", "-l").includes(treeA.slice(0, 8)), "the replacement ref really exists");
  // Proof the replacement is live for an unprotected reader: plain git resolves A to B's content.
  const redirected = cp.execFileSync("git", ["cat-file", "-p", `${treeA}:.ctide/provenance.json`],
    { cwd: repo.root, encoding: "utf8" });
  assert.strictEqual(redirected, canonicalStoreBytes(other), "an unprotected read of A returns B");

  const guarded = await build(repo, treeA);
  assert.deepStrictEqual(guarded.lifecycleAffectedClauses, [REQ("0B")],
    "the hardened reader still sees the real tree A, so the new clause is still a member");
  assert.strictEqual(guarded.baseTreeOid, treeA);
}));

test("AC171 (A)(iii): a non-canonical clause id never reaches the carrier -- refused at schema", () => withRepo(async (repo) => {
  repo.write("README.md", "hello\n");
  const oid = repo.commit();
  // Planted, because the writer refuses these now. Each is refused by G1 schema validation, which
  // is the layer AC171 (iii) names -- not by the carrier guard, which is only defence in depth.
  for (const [id, why] of [
    ["REQ-8ZZZZZZZZZZZZZZZZZZZZZZZZZ", "overflow: 26x5=130 bits, lead byte must be 0-7"],
    ["REQ-01arz3ndektsv4rrffq69g5fav", "lowercase"],
    ["REQ-01ARZ3NDEKTSV4RRFFQ69G5FAO", "the O alias"],
    ["REQ-01ARZ3NDEKTSV4RRFFQ69G5FA", "25 bytes"],
    ["REQ-01ARZ3NDEKTSV4RRFFQ69G5FAV-2", "a suffix"],
    ["REQ-a", "not a ULID at all"],
  ]) {
    const planted = JSON.parse(JSON.stringify(baseStore()));
    planted.clauses.push({ id, authority: "approved-requirement", kind: "specification", text: "t", sourceRef: "S-hc", taskRef: "TASK-1" });
    repo.write(".ctide/provenance.json", JSON.stringify(planted));
    const e = await refused(build(repo, oid), `${JSON.stringify(id)} (${why})`, "E_CURRENT_STORE_SCHEMA");
    assert.match(e.message, /E_CLAUSE_ID_GRAMMAR|not <PREFIX>-<ULID>/, "refused by the id grammar, at the schema layer");
  }
}));

// --- the G1/T0 phase boundary, and the clock-dependent half of G2 -------------------------------

// A store whose only terminal is exception-backed and whose DP carries the scope ruling that makes
// it applicable. Clock-free-valid either way; whether it is VALID depends entirely on the expiry
// against T0, which is exactly the seam the G2 test below needs.
const INTENT = { kind: "discipline", discipline: "intent" };
const SCOPE_DP = {
  id: "DP-1", dimension: "data", scenario: "s", alternatives: ["A", "B"], layer: "implementation",
  classificationBasis: "engineering standard", materialReasons: [],
};
function exceptionBackedStore(expiry) {
  const packet = {
    dpId: SCOPE_DP.id, scenario: SCOPE_DP.scenario, alternatives: SCOPE_DP.alternatives,
    layer: SCOPE_DP.layer, classificationBasis: SCOPE_DP.classificationBasis,
    materialReasons: [], requestedPrincipal: INTENT, basisRefs: [],
  };
  const s = withGrant(baseStore(), { expiry });
  s.records.push({
    recordId: "R-scope", kind: "review-ruling", by: INTENT, subjectRef: SCOPE_DP.id, ruling: "ok",
    rulingKind: "scope-coverage", basis: "stated basis",
    inputPacketSnapshot: packet, inputPacketDigest: digestOf(packet), scopeCovers: true,
  });
  s.decisionPoints.push({
    ...SCOPE_DP, status: "resolved", resolvedBy: REQ("0B"), reopenCauseRef: null,
    scopeRulingRef: { kind: "review-ruling", ref: "R-scope" },
  });
  return s;
}

// The two-stage armed-clock probe, factored out: install the wrapper BEFORE the dynamic import but
// disarmed, reset and arm it after, and report how many armed reads the invocation made.
function clockProbe(scratch, repoRoot, baseTreeOid, t0) {
  const script = path.join(scratch, "run.mjs");
  fs.writeFileSync(script, [
    "let armed = false;",
    "let count = 0;",
    `const T0 = ${t0};`,
    "Date.now = () => { if (!armed) return Date.UTC(2000, 0, 1); count += 1; return T0; };",
    'const m = await import("./scripts/governance-seed-preimage.mjs");',
    "count = 0;",
    "armed = true;",
    "let result;",
    "try {",
    `  const out = await m.buildGovernanceSeedPreimage({ repoRoot: ${JSON.stringify(repoRoot)}, baseTreeOid: ${JSON.stringify(baseTreeOid)} });`,
    "  result = { ok: true, keys: Object.keys(out).sort() };",
    "} catch (e) { result = { ok: false, code: e.code, message: String(e.message) }; }",
    "console.log(JSON.stringify({ ...result, armedReads: count }));",
  ].join("\n"), "utf8");
  const r = runChild(script);
  assert.strictEqual(r.code, 0, r.err);
  return JSON.parse(r.out);
}

test("AC171 (C)(xv): a dangling reopenCauseRef in G1 fails BEFORE the clock is read", () => withRepo(async (repo) => {
  // The reference counterexample. reopenCauseRef shape and resolution are coherence checks with no
  // clock in them, so a store that fails on one must fail with the clock still untouched. Splitting
  // validation by "does the function take now" left this whole validator on the far side of T0.
  repo.write("README.md", "hello\n");
  const oid = repo.commit();
  const planted = JSON.parse(JSON.stringify(baseStore()));
  planted.decisionPoints.push({
    id: "DP-1", dimension: "data", scenario: "s", alternatives: ["A", "B"], layer: "implementation",
    classificationBasis: "engineering standard", materialReasons: [], status: "open",
    reopenCauseRef: { kind: "transition", ref: "T-missing" },
  });
  repo.write(".ctide/provenance.json", JSON.stringify(planted));

  const scratch = scratchScripts("ctide-gsp-cause-");
  try {
    const out = clockProbe(scratch, repo.root, oid, Date.UTC(2030, 5, 15));
    assert.strictEqual(out.ok, false, "a dangling cause witness must not produce a carrier");
    assert.strictEqual(out.code, "E_CURRENT_STORE_SCHEMA");
    assert.match(out.message, /E_CAUSE_REF_SHAPE|not a valid TransitionRef/, "refused on the cause ref itself");
    assert.strictEqual(out.armedReads, 0, `the clock must not have been read, got ${out.armedReads}`);
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}));

test("AC171 (C)(xv): a DP whose terminal disagrees with its status fails BEFORE the clock is read", () => withRepo(async (repo) => {
  // The other half. INV-4 terminal exclusivity, the terminal field-to-kind mapping and the
  // status agreement are all clock-free; only the applicable() call at the end of that validator
  // is not. A store that fails on the clock-free part must fail with zero armed reads.
  repo.write("README.md", "hello\n");
  const oid = repo.commit();
  const planted = JSON.parse(JSON.stringify(baseStore()));
  planted.clauses.push({
    id: REQ("0B"), authority: "approved-requirement", kind: "specification",
    text: "b", sourceRef: "S-hc", taskRef: "TASK-1",
  });
  // A REQ parked in decidedBy: wrong field for the kind, and the status agrees with neither.
  planted.decisionPoints.push({
    id: "DP-1", dimension: "data", scenario: "s", alternatives: ["A", "B"], layer: "implementation",
    classificationBasis: "engineering standard", materialReasons: [], status: "decided",
    decidedBy: REQ("0B"), reopenCauseRef: null,
  });
  repo.write(".ctide/provenance.json", JSON.stringify(planted));

  const scratch = scratchScripts("ctide-gsp-inv4-");
  try {
    const out = clockProbe(scratch, repo.root, oid, Date.UTC(2030, 5, 15));
    assert.strictEqual(out.ok, false, "an incoherent DP terminal must not produce a carrier");
    assert.strictEqual(out.code, "E_CURRENT_STORE_SCHEMA");
    assert.match(out.message, /E_INV4_TYPE|type mismatch/, "refused on the terminal type mapping");
    assert.strictEqual(out.armedReads, 0, `the clock must not have been read, got ${out.armedReads}`);
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}));

test("AC171 (B)(xii): a G2 that fails only TIME-dependent validation is not reported as a moved store", () => withRepo(async (repo) => {
  // G1 is legal and its exception-backed terminal is applicable at T0. G2 is swapped in
  // synchronously by the loader proxy: same version, still clock-free-valid, but its canonical
  // expiry has already passed at that SAME T0. So it can only fail inside applicable()/INV-4 --
  // the clock-dependent half -- and it must fail there rather than reaching the digest comparison.
  const T0 = Date.UTC(2030, 5, 15);
  const live = legal(exceptionBackedStore("2030-12-31"));
  const expired = exceptionBackedStore("2030-01-01");
  validateStoreSchema(expired); // the swapped-in store really does pass the clock-free half

  repo.write(".ctide/provenance.json", canonicalStoreBytes(live));
  repo.write("README.md", "hello\n");
  const oid = repo.commit();
  repo.putStore(live);

  const scratch = scratchScripts("ctide-gsp-g2time-");
  try {
    const proxy = path.join(scratch, "scripts", "counting-proxy.mjs");
    fs.writeFileSync(proxy, [
      'import fs from "node:fs";',
      'import path from "node:path";',
      'import { readCurrentStoreFile as real } from "./current-store-load.mjs";',
      "let calls = 0;",
      "export function readCurrentStoreFile(repoRoot) {",
      "  calls += 1;",
      "  const text = real(repoRoot);",
      `  if (calls === 1) fs.writeFileSync(path.join(repoRoot, ".ctide", "provenance.json"), ${JSON.stringify(canonicalStoreBytes(expired))}, "utf8");`,
      "  return text;",
      "}",
    ].join("\n"), "utf8");
    patch(path.join(scratch, "scripts", "governance-seed-preimage.mjs"),
      'from "./current-store-load.mjs"', 'from "./counting-proxy.mjs"');

    const out = clockProbe(scratch, repo.root, oid, T0);
    assert.strictEqual(out.ok, false, "an illegal G2 must not produce a carrier");
    assert.notStrictEqual(out.code, "E_STORE_MOVED", "and must NOT be reported as a moved store");
    assert.match(out.message, /E_INV4_NOT_APPLICABLE|not active\+applicable|exception-expired/,
      `the failure must name the time-dependent invariant, got ${out.code}: ${out.message}`);
    // Still exactly one clock read: G2 is validated under G1's T0, never a fresh sample.
    assert.strictEqual(out.armedReads, 1, `the clock is read once for the whole invocation, got ${out.armedReads}`);

    // No result, no partial carrier, no write beyond the proxy's own swap.
    assert.strictEqual(repo.readStore(), canonicalStoreBytes(expired),
      "the only content change is the one the probe made; the component wrote nothing");
    assert.deepStrictEqual(fs.readdirSync(path.join(repo.root, ".ctide")).sort(), ["provenance.json"],
      "no output, lock or temp file appeared");
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}));
