// AC173 evidence: the populated-inventory producer end to end.
//
// SCOPE NOTE: a green run here does NOT lift the unsupported-populated-inventory gate, does not
// make the product entry point accept a populated inventory, does not satisfy AC118, AC136, AC137
// or AC138, and does not mean Phase 2 is ready. AC173 (j) is asserted in the sibling suite: the
// product path refuses the very documents this one produces.
//
// Spec anchors (the current approved coupled set, one effective set):
//   SM = 2026-07-25-shared-decision-provenance-model.md (approved v1.15) §2, §9
//   TP = 2026-07-25-test-provenance-spec.md (approved v1.15) §6, §11b.9c, §11b.10c, AC173
//
// FIXTURE POLICY: repositories are real -- git init, real commits, a real working tree -- and the
// provenance stores are built as objects and then asserted legal through the PRODUCTION
// validateAll(). The producer is a reader of both, and the shapes it must read (a base tree whose
// store differs from the current one by exactly one clause, an expiry that has passed) are not
// reachable through the transaction chain without a fixture apparatus larger than the tests.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cp from "node:child_process";

import {
  emptyStore, canonicalStoreBytes, sha256Hex, validateAll, canonicalJson, storeDigest,
  CANONICAL_STORE_PATH,
} from "../cressetide/skills/vigil/scripts/provenance-store.mjs";
import { V2_INVENTORY_KEYS, computeInventoryV2Digest } from "../cressetide/skills/vigil/scripts/changed-test-inventory.mjs";
import { produceChangedTestInventoryV2 } from "../cressetide/skills/vigil/scripts/changed-test-inventory-producer.mjs";
import { root } from "./helpers.mjs";

const NODE_TEST = 'import { test } from "node:test";\n';
const NOW = Date.UTC(2026, 6, 26);

// Canonical ULIDs (IS v1.10 §8): 26 upper-Crockford bytes, first byte 0-7.
const U = (tail) => "01J000000000000000000000" + tail;
const REQ = (tail) => "REQ-" + U(tail);
const CLAUSE_A = REQ("0A");   // in B and in C
const CLAUSE_X = REQ("0X");   // only in C -- semanticallyChanged
const CLAUSE_G = REQ("0G");   // in both; the governance-only cases move IT, not the tag

const TASK = "TASK-1";

// TP v1.16: the request names a task, and the CURRENT store must carry a matching TaskState whose
// baseProvenance witness equals the requested tree. The base-tree store cannot -- its oid depends on
// its own bytes -- and need not: TaskState is not an immutable section, so B may have none.
const withTask = (store, baseTreeOid, dpIds = []) => {
  const s = JSON.parse(JSON.stringify(store));
  s.taskStates = [{
    taskId: TASK,
    baseProvenance: { treeOid: baseTreeOid, storePath: CANONICAL_STORE_PATH, storeDigest: storeDigest(emptyStore()) },
    currentTaskDpIds: dpIds,
  }];
  return s;
};

// --- repository -----------------------------------------------------------------------------------

function makeRepo(prefix = "ctide-m-") {
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
  let committed = null;
  return {
    root: dir, git, write,
    remove: (rel) => fs.rmSync(path.join(dir, rel), { force: true }),
    commit: () => { git("add", "-A"); git("commit", "-qm", "c"); committed = git("rev-parse", "HEAD^{tree}"); return committed; },
    // The CURRENT store always carries the task, witnessing the tree just committed. Base-side
    // stores go through write() directly and stay task-free -- a base tree cannot name its own oid.
    putStore: (store, dpIds) => write(".ctide/provenance.json",
      canonicalStoreBytes(committed === null ? store : withTask(store, committed, dpIds))),
    bytes: (rel) => fs.readFileSync(path.join(dir, rel)),
  };
}

async function withRepo(body, prefix) {
  const repo = makeRepo(prefix);
  try { return await body(repo); } finally { fs.rmSync(repo.root, { recursive: true, force: true }); }
}

// --- provenance stores ------------------------------------------------------------------------------

const legal = (s) => { validateAll(s, { now: NOW }); return s; };

function storeWith({ clauses = [], drifted = false, expired = false, transitioned = false } = {}) {
  const s = emptyStore();
  s.records.push({ recordId: "R-owner", kind: "source-authority", authorityIdentity: "EU DPA" });
  // A snapshot-only Source: never drifts, so a clause hanging off it is inert unless something else
  // moves it. That is what makes the single-variable controls single-variable.
  s.sources.push({
    sourceId: "S-inert", contentKind: "requirement", driftMode: "snapshot-only",
    locator: "c#1", excerpt: "inert", digest: sha256Hex("inert"),
  });
  for (const id of clauses) {
    s.clauses.push({
      id, authority: "approved-requirement", kind: "specification",
      text: `clause ${id}`, sourceRef: "S-inert", taskRef: "TASK-1",
    });
  }
  if (drifted) {
    // A repo-file Source whose excerpt is absent from the head view -> Check B zero -> drift.
    s.sources.push({
      sourceId: "S-file", contentKind: "requirement", driftMode: "repo-file",
      locator: "docs/policy.md#1", excerpt: "the anchored sentence", digest: sha256Hex("the anchored sentence"),
    });
    s.clauses.find((c) => c.id === CLAUSE_G).sourceRef = "S-file";
  }
  if (expired) {
    s.sources.push({
      sourceId: "S-hc", contentKind: "policy", driftMode: "snapshot-only",
      locator: "p#1", excerpt: "PII stays in the EU", digest: sha256Hex("PII stays in the EU"),
    });
    s.clauses.push({
      id: REQ("0H"), authority: "hard-constraint", kind: "specification",
      text: "hc", sourceRef: "S-hc", ownerRef: { kind: "source-authority", ref: "R-owner" },
    });
    s.sources.push({
      sourceId: "S-exc", contentKind: "exception-grant", driftMode: "snapshot-only", locator: "g#1",
      excerpt: "grant", digest: sha256Hex("grant"), targetConstraintRef: REQ("0H"),
      grantAuthorityRef: { kind: "source-authority", ref: "R-owner" }, scope: "eu", expiry: "2020-01-01",
    });
    s.clauses.find((c) => c.id === CLAUSE_G).sourceRef = "S-exc";
  }
  if (transitioned) {
    s.records.push({
      recordId: "R-ack", kind: "plan-gate", target: CLAUSE_G, successor: null,
      impact: "no consumers", disposition: "no-affected-dependents", approvedBy: "user",
    });
    s.transitions.push({
      id: "T-1", subject: CLAUSE_G, action: "retire", authorityRef: { kind: "user" },
      effectiveAt: "2026-01-01T00:00:00.000Z", ackRef: { kind: "plan-gate", ref: "R-ack" },
    });
  }
  return s;
}

// --- module sources -----------------------------------------------------------------------------

const tagged = (clauseRef, name, body = "") => `${NODE_TEST}// @src ${clauseRef}\ntest("${name}", () => {${body}});\n`;
const untagged = (name, body = "") => `${NODE_TEST}test("${name}", () => {${body}});\n`;

const byPath = (entries) => Object.fromEntries(entries.map((e) => [e.testRef.path, e]));

async function refusedProduce(repo, oid, what) {
  let error = null;
  try { await produce(repo, oid); } catch (e) { error = e; }
  assert.ok(error && error.code, `${what}: expected a coded failure, got ${error}`);
  return error;
}

async function produce(repo, oid) {
  return produceChangedTestInventoryV2({ repoRoot: repo.root, baseTreeOid: oid, taskId: TASK });
}

// --- AC173 (a): a previously BLOCKED cell, now reachable -------------------------------------------
//
// Under v1.15 the @src line stayed inside the canonical declaration bytes, so a tag-only edit also
// moved bodyDigest and §6 row 4 (modified) always beat row 5 (retagged). This suite recorded that as
// a blocked cell rather than asserting something weaker. TP approved v1.16 removes legitimately
// attached @src lines by the same algorithm that already removed @tid, so the two body digests are
// now equal on a tag-only change and row 5 fires. The cell is asserted as AC173 (a) actually writes
// it, and the digest equality is asserted too -- if the exclusion ever regresses, this fails.

test("AC173 (a): a new Clause reached by a retag yields exactly one retagged, never governance-affected", () => withRepo(async (repo) => {
  // B has Clause A and the base test binds A; C adds Clause X; the SAME logical test rebinds to X
  // with the body untouched. X is in semanticallyChangedClauses so governanceHit is true -- and row
  // 5 still fires first, because governance never overrides a retag.
  repo.write("retag.test.mjs", tagged(CLAUSE_A, "alpha"));
  repo.write("control.test.mjs", tagged(CLAUSE_A, "control"));
  repo.putStore(legal(storeWith({ clauses: [CLAUSE_A] })));
  const oid = repo.commit();

  repo.write("retag.test.mjs", tagged(CLAUSE_X, "alpha"));       // the tag moves; the body does not
  repo.write("headonly.test.mjs", tagged(CLAUSE_X, "fresh"));    // head-only, binding the new clause
  repo.putStore(legal(storeWith({ clauses: [CLAUSE_A, CLAUSE_X] })));

  const out = await produce(repo, oid);
  const map = byPath(out.entries);

  const retag = map["retag.test.mjs"];
  assert.ok(retag, "the rebound test produces an entry");
  assert.strictEqual(retag.status, "retagged", "row 5 fires: the @src exclusion keeps the body digests equal");
  assert.strictEqual(retag.baseBodyDigest, retag.headBodyDigest, "both body digests are equal");
  assert.strictEqual(retag.reason, "content-change", "reason is content-change, never governance-affected");
  assert.deepStrictEqual(retag.tagBefore, { clauseRef: CLAUSE_A });
  assert.deepStrictEqual(retag.tagAfter, { clauseRef: CLAUSE_X });

  const added = map["headonly.test.mjs"];
  assert.strictEqual(added.status, "added", "a head-only test binding the new clause is added");
  assert.strictEqual(added.reason, "content-change");

  assert.ok(!("control.test.mjs" in map), "the control changed nothing and is omitted from entries");
  assert.strictEqual(out.entries.length, 2, `exactly two entries, got ${JSON.stringify(out.entries.map((e) => e.testRef.path))}`);
  assert.strictEqual(out.entries.filter((e) => e.status === "governance-affected").length, 0,
    "reverse closure adds no second entry for a test rows 1-5 already carried");
}));

// --- AC173 (b1)(b2)(b3): the three reachable governance-only cases --------------------------------

// A COLLISION v1.16 CREATES, recorded here rather than asserted away.
//
// AC173 (b1) and (b3) want a governance-affected entry for a test whose head binding points at a
// clause the seed caught because it was RETIRED by a new Transition, or because its exception grant
// EXPIRED. But §11b.10c v1.16 now charges the post-state binding shared §9's full postChangeBinding
// row -- active, mechanicallyApplicable, Check A/B and a valid exception chain -- so a live head
// binding to a retired or expired clause is fail-closed BEFORE any entry is emitted.
//
// The two requirements cannot both hold: a clause cannot be simultaneously a legal post-state
// binding and retired/expired. Measured, not inferred -- the two cases below fail on
// E_HEAD_BINDING_INACTIVE and E_HEAD_BINDING_NOT_APPLICABLE respectively. b2 (drift) is unaffected,
// because drifting a Source does not make its clause inactive, and it is asserted normally.
//
// Nothing is worked around: the spec is untouched, the producer is not taught an exception, and the
// two cells are asserted as they actually behave so the collision is visible to the next reviewer.

test("AC173 (b1): a head binding to a RETIRED clause is fail-closed, so its governance-only cell is unreachable", () => withRepo(async (repo) => {
  repo.write("hit.test.mjs", tagged(CLAUSE_G, "hit"));
  repo.write("docs/policy.md", "the anchored sentence\n");
  repo.write(".ctide/provenance.json", canonicalStoreBytes(legal(storeWith({ clauses: [CLAUSE_A, CLAUSE_G] }))));
  const oid = repo.commit();
  repo.putStore(legal(storeWith({ clauses: [CLAUSE_A, CLAUSE_G], transitioned: true })));

  const e = await refusedProduce(repo, oid, "a head binding to a retired clause");
  assert.strictEqual(e.code, "E_HEAD_BINDING_INACTIVE");
  assert.match(e.message, /is not active in the current store/);
}));

test("AC173 (b3): a head binding to an EXPIRED exception is fail-closed, so its cell is unreachable too", () => withRepo(async (repo) => {
  repo.write("hit.test.mjs", tagged(CLAUSE_G, "hit"));
  repo.write("docs/policy.md", "the anchored sentence\n");
  const shared = { clauses: [CLAUSE_A, CLAUSE_G], expired: true };
  repo.write(".ctide/provenance.json", canonicalStoreBytes(legal(storeWith(shared))));
  const oid = repo.commit();
  repo.putStore(legal(storeWith(shared)));

  const e = await refusedProduce(repo, oid, "a head binding to an expired exception");
  assert.strictEqual(e.code, "E_HEAD_BINDING_NOT_APPLICABLE");
  assert.match(e.message, /not mechanically applicable/);
}));

test("AC173 (b2 driftedClauses): same path, same body, same tag, seed hit -> exactly one governance-affected", () => withRepo(async (repo) => {
  // The one governance-only cell that survives v1.16: drift does not make a clause inactive.
  repo.write("hit.test.mjs", tagged(CLAUSE_G, "hit"));
  repo.write("miss.test.mjs", tagged(CLAUSE_A, "miss"));   // the single-variable control
  repo.write("docs/policy.md", "the anchored sentence\n");
  const shared = { clauses: [CLAUSE_A, CLAUSE_G], drifted: true };
  repo.write(".ctide/provenance.json", canonicalStoreBytes(legal(storeWith(shared))));
  const oid = repo.commit();

  repo.write("docs/policy.md", "gone\n"); // Check B -> zero occurrences
  repo.putStore(legal(storeWith(shared)));

  const out = await produce(repo, oid);
  const map = byPath(out.entries);
  const hit = map["hit.test.mjs"];
  assert.ok(hit, "the bound test must produce an entry");
  assert.strictEqual(hit.status, "governance-affected");
  assert.strictEqual(hit.reason, "governance-affected", "status and reason hold together");
  assert.strictEqual(hit.baseBodyDigest, hit.headBodyDigest, "both body digests are equal");
  assert.deepStrictEqual(hit.tagBefore, hit.tagAfter, "tagBefore and tagAfter are canonically equal");
  assert.deepStrictEqual(hit.tagAfter, { clauseRef: CLAUSE_G });
  assert.ok(!("miss.test.mjs" in map), "the seed-miss control is omitted from entries");
  assert.strictEqual(out.entries.length, 1, `exactly one entry, got ${out.entries.length}`);
}));

// --- AC173 (c): governance never overrides precedence ---------------------------------------------

test("AC173 (c): body change, tag change and a move all beat a governance hit", () => withRepo(async (repo) => {
  // Every one of these tests binds a clause that IS in the seed, so governanceHit is true for all
  // three. None of them may come out governance-affected.
  repo.write("body.test.mjs", tagged(CLAUSE_G, "b", " const x = 1; void x;"));
  repo.write("tag.test.mjs", tagged(CLAUSE_G, "t"));
  repo.write("from/moved.test.mjs", tagged(CLAUSE_G, "m"));
  repo.write("docs/policy.md", "the anchored sentence\n");
  // The drifting Source is immutable, so it exists in BOTH stores; only the head view moves.
  const shared = { clauses: [CLAUSE_A, CLAUSE_G], drifted: true };
  repo.putStore(legal(storeWith(shared)));
  const oid = repo.commit();

  repo.write("body.test.mjs", tagged(CLAUSE_G, "b", " const x = 2; void x;")); // body moved
  repo.write("tag.test.mjs", tagged(CLAUSE_X, "t"));                            // tag moved
  repo.remove("from/moved.test.mjs");
  repo.write("to/moved.test.mjs", tagged(CLAUSE_G, "m"));                       // path moved
  repo.write("docs/policy.md", "gone\n");                                       // and the clause drifts
  repo.putStore(legal(storeWith({ ...shared, clauses: [CLAUSE_A, CLAUSE_G, CLAUSE_X] })));

  const out = await produce(repo, oid);
  const map = byPath(out.entries);

  assert.strictEqual(map["body.test.mjs"].status, "modified", "body change wins over the hit");
  assert.strictEqual(map["body.test.mjs"].reason, "content-change");
  assert.notStrictEqual(map["body.test.mjs"].baseBodyDigest, map["body.test.mjs"].headBodyDigest);

  // Now reachable: the @src exclusion keeps the body digests equal, so a tag-only change is a
  // retag -- and a governance hit still does not override it.
  assert.strictEqual(map["tag.test.mjs"].status, "retagged", "tag-only change wins over the hit");
  assert.strictEqual(map["tag.test.mjs"].reason, "content-change");
  assert.strictEqual(map["tag.test.mjs"].baseBodyDigest, map["tag.test.mjs"].headBodyDigest,
    "and its body digests are equal, which is what makes row 5 legal");

  const moved = out.entries.find((e) => e.status === "moved");
  assert.ok(moved, "the moved pair is classified moved, not governance-affected");
  assert.strictEqual(moved.reason, "content-change");
  assert.strictEqual(moved.testRef.path, "to/moved.test.mjs", "a moved entry takes its testRef from head");

  assert.strictEqual(out.entries.filter((e) => e.status === "governance-affected").length, 0,
    "governance produced no entry of its own for any of the three");
  // (e) again, on a busier fixture: one entry per logical test, never two.
  const paths = out.entries.map((e) => e.testRef.path);
  assert.strictEqual(new Set(paths).size, paths.length, "no test appears twice");
}));

// --- AC173 (f): the six statuses' exact side projection --------------------------------------------

test("AC173 (f): added is all head, with baseBodyDigest ABSENT", () => withRepo(async (repo) => {
  // One run, residual on the head side only. Residual on BOTH sides is refused by the matcher as
  // unresolved identity drift, so added and deleted are necessarily two runs, not one.
  repo.write("keep.test.mjs", tagged(CLAUSE_A, "keep"));
  repo.putStore(legal(storeWith({ clauses: [CLAUSE_A] })));
  const oid = repo.commit();
  repo.write("fresh.test.mjs", tagged(CLAUSE_A, "fresh"));
  repo.putStore(legal(storeWith({ clauses: [CLAUSE_A] })));

  const added = byPath((await produce(repo, oid)).entries)["fresh.test.mjs"];
  assert.strictEqual(added.status, "added");
  assert.strictEqual(added.tagBefore, null, "added carries tagBefore null");
  assert.deepStrictEqual(added.tagAfter, { clauseRef: CLAUSE_A });
  assert.ok(!("baseBodyDigest" in added), "added must NOT carry baseBodyDigest -- absent, not null");
  assert.ok("headBodyDigest" in added);
  assert.deepStrictEqual(Object.keys(added).sort(),
    ["framework", "headBodyDigest", "implementationIdentity", "reason", "status", "tagAfter", "tagBefore", "testRef"]);
}));

test("AC173 (f): deleted is all base, with headBodyDigest ABSENT", () => withRepo(async (repo) => {
  repo.write("keep.test.mjs", tagged(CLAUSE_A, "keep"));
  repo.write("gone.test.mjs", tagged(CLAUSE_A, "gone"));
  repo.putStore(legal(storeWith({ clauses: [CLAUSE_A] })));
  const oid = repo.commit();
  repo.remove("gone.test.mjs");
  repo.putStore(legal(storeWith({ clauses: [CLAUSE_A] })));

  const deleted = byPath((await produce(repo, oid)).entries)["gone.test.mjs"];
  assert.strictEqual(deleted.status, "deleted");
  assert.strictEqual(deleted.tagAfter, null, "deleted carries tagAfter null");
  assert.deepStrictEqual(deleted.tagBefore, { clauseRef: CLAUSE_A });
  assert.ok(!("headBodyDigest" in deleted), "deleted must NOT carry headBodyDigest -- absent, not null");
  assert.ok("baseBodyDigest" in deleted);
  assert.strictEqual(deleted.testRef.path, "gone.test.mjs", "a deleted entry takes its testRef from base");
}));

test("AC173 (f): the four two-sided statuses take identity from head and the before-columns from base", () => withRepo(async (repo) => {
  repo.write("m.test.mjs", tagged(CLAUSE_A, "m", " const x = 1; void x;"));
  repo.putStore(legal(storeWith({ clauses: [CLAUSE_A] })));
  const oid = repo.commit();
  repo.write("m.test.mjs", tagged(CLAUSE_X, "m", " const x = 2; void x;"));
  repo.putStore(legal(storeWith({ clauses: [CLAUSE_A, CLAUSE_X] })));

  const out = await produce(repo, oid);
  const entry = byPath(out.entries)["m.test.mjs"];
  assert.strictEqual(entry.status, "modified");
  assert.deepStrictEqual(entry.tagBefore, { clauseRef: CLAUSE_A }, "tagBefore is the base tag");
  assert.deepStrictEqual(entry.tagAfter, { clauseRef: CLAUSE_X }, "tagAfter is the head tag");
  assert.notStrictEqual(entry.baseBodyDigest, entry.headBodyDigest);
  assert.deepStrictEqual(Object.keys(entry).sort(),
    ["baseBodyDigest", "framework", "headBodyDigest", "implementationIdentity", "reason", "status", "tagAfter", "tagBefore", "testRef"]);
  assert.deepStrictEqual(Object.keys(entry.testRef).sort(), ["adapterId", "path", "structuralId"]);
  assert.deepStrictEqual(Object.keys(entry.implementationIdentity).sort(),
    ["implementationId", "parserId", "parserVersion"]);
}));

// --- AC173 (d)(g)(h)(k): omission, ordering, envelope and no side effects ---------------------------

test("AC173 (d)(g)(h): unchanged is omitted, entries ascend strictly, the envelope is exactly seven keys", () => withRepo(async (repo) => {
  for (const p of ["b/one.test.mjs", "a/two.test.mjs", "a/one.test.mjs", "steady.test.mjs"]) {
    repo.write(p, tagged(CLAUSE_A, "n", " const x = 1; void x;"));
  }
  repo.putStore(legal(storeWith({ clauses: [CLAUSE_A] })));
  const oid = repo.commit();
  for (const p of ["b/one.test.mjs", "a/two.test.mjs", "a/one.test.mjs"]) {
    repo.write(p, tagged(CLAUSE_A, "n", " const x = 2; void x;"));
  }
  repo.putStore(legal(storeWith({ clauses: [CLAUSE_A] })));

  const out = await produce(repo, oid);
  const paths = out.entries.map((e) => e.testRef.path);
  assert.deepStrictEqual(paths, ["a/one.test.mjs", "a/two.test.mjs", "b/one.test.mjs"],
    "strictly ascending by the (path, adapterId, structuralId) tuple");
  assert.ok(!paths.includes("steady.test.mjs"), "the unchanged test is omitted, with no placeholder");
  for (const e of out.entries) assert.strictEqual(e.status, "modified");

  assert.deepStrictEqual(Object.keys(out).sort(), [...V2_INVENTORY_KEYS].sort(), "exactly seven keys");
  for (const forbidden of ["evaluationTime", "producedAt", "clockDigest", "T0", "now"]) {
    assert.ok(!(forbidden in out), `${forbidden} must not appear in the envelope`);
  }
  assert.strictEqual(out.inventoryVersion, 2);
  assert.strictEqual(out.inventoryDigest, computeInventoryV2Digest({
    inventoryVersion: out.inventoryVersion, baseTreeOid: out.baseTreeOid, registryDigest: out.registryDigest,
    headViewDigest: out.headViewDigest, inputProvenanceStoreDigest: out.inputProvenanceStoreDigest,
    entries: out.entries,
  }), "the digest recomputes to the same value under the one formula");
  // Nested objects are canonical: canonicalJson round-trips to itself.
  assert.strictEqual(canonicalJson(out), canonicalJson(JSON.parse(canonicalJson(out))));
}));

test("AC173 (k): the store, the real config, the shipped registry and .ctide/output are byte-identical afterwards", () => withRepo(async (repo) => {
  // The config path is .ctide/test-adapters-config.json -- explicit-config.mjs's EXPLICIT_CONFIG_PATH.
  // An earlier version of this test guarded ".ctide/adapters.json", which no component reads, so it
  // protected nothing.
  const CONFIG = ".ctide/test-adapters-config.json";
  const REGISTRY = path.join(root, "cressetide", "skills", "vigil", "scripts", "test-adapters.json");

  repo.write("a.test.mjs", tagged(CLAUSE_A, "a"));
  repo.write(".ctide/provenance.json", canonicalStoreBytes(legal(storeWith({ clauses: [CLAUSE_A] }))));
  const oid = repo.commit();
  repo.putStore(legal(storeWith({ clauses: [CLAUSE_A] })));
  repo.write("a.test.mjs", tagged(CLAUSE_A, "a", " const x = 2; void x;"));

  const before = {
    store: repo.bytes(".ctide/provenance.json"),
    config: fs.existsSync(path.join(repo.root, CONFIG)) ? repo.bytes(CONFIG) : null,
    registry: fs.readFileSync(REGISTRY),
    status: repo.git("status", "--porcelain", "--untracked-files=all"),
  };
  const out = await produce(repo, oid);
  assert.strictEqual(out.entries.length, 1, "the run really did work");

  assert.deepStrictEqual(repo.bytes(".ctide/provenance.json"), before.store,
    "the provenance store is byte-identical: not migrated, not written back");
  assert.strictEqual(fs.existsSync(path.join(repo.root, CONFIG)), before.config !== null,
    "the producer neither creates nor removes the explicit config");
  assert.deepStrictEqual(fs.readFileSync(REGISTRY), before.registry, "the shipped registry is byte-identical");
  assert.strictEqual(repo.git("status", "--porcelain", "--untracked-files=all"), before.status,
    "nothing appeared or changed anywhere in the repository");
  assert.ok(!fs.existsSync(path.join(repo.root, ".ctide", "output")), "no .ctide/output/** was created");
}));
