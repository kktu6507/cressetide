// The ledger collector: TP v1.18 §A/§C.3 as amended by TP v1.21 §D10 and §D11.1 — the eighteen-key
// `testProvenance` block.
//
// SCOPE. A green run here proves the COLLECTOR and nothing else. It is not §D11 integration beyond
// §D11.1, it is not an actual external reviewer run, and it makes nothing READY. `converged: true` is
// asserted only where a real controller cycle really did verify AND the observed window did not move;
// everywhere it is asserted false, one of the two independent gates was not established.
//
// WHAT EACH CASE IS FOR. The amendment's precedence and its R1-R6 situations are the spine, extended
// by §D11.1's five ordered observations: every row is reached through real authority — a real Git
// repository, a real store written by the real transactions, a real committed batch, the real
// committed-batch consumer and the real controller operations — and each asserts the exact literal
// the situation licenses. `null` and `"unknown"` are never interchangeable here, and the five loop
// metrics are three-valued: a known count (including 0), `"unknown"` when unavailable or uncertain,
// and for `lastStaleSubject` a `null` that means "no stale refusal was recorded".
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cp from "node:child_process";
import crypto from "node:crypto";

import { pathToFileURL } from "node:url";

import { root } from "./helpers.mjs";
import {
  emptyStore, canonicalStoreBytes, storeDigest, sha256Hex, applyTransaction, digestOf,
  resolutionGroupDigest, loadStore, validateAll, indexStore, CANONICAL_STORE_PATH,
} from "../cressetide/skills/vigil/scripts/provenance-store.mjs";
import { verifyCommittedBatch } from "../cressetide/skills/vigil/scripts/committed-batch-consumer.mjs";
import { computeInventoryV2Digest } from "../cressetide/skills/vigil/scripts/changed-test-inventory.mjs";
import { captureHeadViewSnapshot } from "../cressetide/skills/vigil/scripts/head-view-snapshot.mjs";
import { readTestAdapterRegistryRootFresh } from "../cressetide/skills/vigil/scripts/adapter-registry.mjs";
import { readHeadExplicitConfig, registryDigestOf } from "../cressetide/skills/vigil/scripts/explicit-config.mjs";
import { defaultTestProvenance } from "../cressetide/skills/vigil/scripts/run-ledger.mjs";
import { OBSERVATION_PATH } from "../cressetide/skills/vigil/scripts/inventory-telemetry-observer.mjs";
import {
  buildTestProvenanceBlock, TEST_PROVENANCE_KEYS,
} from "../cressetide/skills/vigil/scripts/test-provenance-block.mjs";
// §D11.1's loop evidence is built by driving the REAL public controller operations over the shared
// loop fixture's existing exports. Nothing in the fixture is modified, and no control state is
// hand-written except where a row says so and explains why.
import {
  beginTaskLoop, runProposalIteration, submitReviewedProposal, commitReviewedBatch, recordVerification,
} from "../cressetide/skills/vigil/scripts/test-provenance-loop.mjs";
import {
  TASK as LOOP_TASK, withRepo as loopWithRepo, seedWorld as loopSeedWorld,
  writeReview as loopWriteReview, writeGovernance as loopWriteGovernance,
  emptyGovernance as loopEmptyGovernance, bumpHead as loopBumpHead, loopFilesOf, readLoopState,
} from "./fixtures/test-provenance-loop-fixture.mjs";

const OPTS = { now: Date.UTC(2026, 8, 6) };
const TASK = "TASK-1";
const ADAPTER_ID = "node-test";
const TEST_PATH = "test/alpha.test.mjs";
const STRUCTURAL = 's:["alpha"]';
const TEST_PATH_2 = "test/beta.test.mjs";
const STRUCTURAL_2 = 's:["beta"]';
const ASSUM_A = "ASSUM-0000000000000000000000000A";
const ASSUM_B = "ASSUM-0000000000000000000000000B";
const ASSUM_C = "ASSUM-0000000000000000000000000C";
const CODE = { kind: "discipline", discipline: "code" };
const TEST_DISCIPLINE = { kind: "discipline", discipline: "test" };
const BLOCK_SCRIPT = path.join(root, "cressetide", "skills", "vigil", "scripts", "test-provenance-block.mjs");
const SCRIPTS_DIR = path.dirname(BLOCK_SCRIPT).split(path.sep).join("/");
const PREFIX = "ctide-tpb-";
const rawDigest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

// The eighteen §11 keys, in approved order, so a shape assertion names them rather than counting.
const KEYS = [
  "taggedTests", "inventory", "findingKinds", "entriesWithoutFindings", "oracleDepTriggered",
  "governanceAffectedEntries", "reviewLoopIterations", "convergenceEpochs", "converged", "taskId",
  "inventoryDigest", "batchDigest", "provenanceBatchRef", "lastStaleSubject", "assumTransitions",
  "adapterMisses", "staleBatchRejections", "droppedForNoSource",
];

function checkedTempRoot(dir, prefix) {
  const parent = fs.realpathSync(os.tmpdir());
  const resolved = path.resolve(dir);
  assert.strictEqual(path.dirname(resolved), parent, `refusing ${resolved}: not a direct temp child`);
  assert.ok(path.basename(resolved).startsWith(prefix), `refusing ${resolved}: wrong prefix`);
  return resolved;
}

function makeRepo(prefix = PREFIX) {
  const dir = checkedTempRoot(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix))), prefix);
  const git = (...a) => cp.execFileSync("git", a, {
    cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  git("init", "-q", "--initial-branch=main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  git("config", "core.autocrlf", "false");
  const write = (rel, body) => {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body, "utf8");
  };
  return { root: dir, prefix, git, write };
}

async function withRepo(body, prefix = PREFIX) {
  const repo = makeRepo(prefix);
  try {
    return await body(repo);
  } finally {
    fs.rmSync(checkedTempRoot(repo.root, repo.prefix), { recursive: true, force: true });
  }
}

async function currentSourceDigests(repoRoot) {
  const snapshot = await captureHeadViewSnapshot({ repoRoot });
  const registryRoot = readTestAdapterRegistryRootFresh();
  return {
    headViewDigest: snapshot.headViewDigest,
    registryDigest: registryDigestOf(registryRoot, readHeadExplicitConfig(snapshot, registryRoot)),
    registryRoot,
  };
}

const adapterIdentity = (registryRoot, adapterId) => registryRoot.adapters
  .find((a) => a.adapterId === adapterId).implementationIdentity;

const writeStore = (repo, store) => {
  const bytes = canonicalStoreBytes(store);
  repo.write(CANONICAL_STORE_PATH, bytes);
  return bytes;
};

// The store that goes INTO the base tree: it carries the ASSUM the entry binds on its pre side,
// which shared §9 resolves in B rather than in the current store.
function priorStore(seedTree) {
  let s = applyTransaction(emptyStore(), "init-task", {
    taskId: "TASK-0",
    baseProvenance: { treeOid: seedTree, storePath: CANONICAL_STORE_PATH, storeDigest: storeDigest(emptyStore()) },
    decisionPoints: [{
      id: "DP-1", dimension: "data", scenario: "null vs absent", alternatives: ["A", "B"],
      layer: "implementation", classificationBasis: "engineering standard", materialReasons: [],
      status: "open",
    }],
    currentTaskDpIds: ["DP-1"],
  }, OPTS);
  s = applyTransaction(s, "append-source", {
    source: {
      sourceId: "S-req", contentKind: "requirement", driftMode: "snapshot-only",
      locator: "conversation#1", excerpt: "the reviewed reading of the null case",
    },
  }, OPTS);
  return applyTransaction(s, "create-initial-outcome", {
    dpId: "DP-1",
    records: [{ recordId: "R-rule1", kind: "review-ruling", by: CODE, subjectRef: "DP-1", ruling: "ok" }],
    clause: {
      id: ASSUM_A, layer: "implementation", derivedFrom: "DP-1", text: "treat null as absent",
      alternative: "treat null as invalid", basis: "matches the option table", basisRefs: [],
      governedBy: CODE, routingOrigin: "safe-default",
    },
  }, OPTS);
}

function asLegacyV1(store) {
  const raw = JSON.parse(JSON.stringify(store));
  raw.provenanceVersion = 1;
  for (const d of raw.decisionPoints) delete d.reopenCauseRef;
  return raw;
}

// Seed, commit history as the base tree, and start TASK-1 against that exact raw witness.
async function seedWorld(repo, { history = () => ({ bytes: null, prior: null }) } = {}) {
  repo.write(TEST_PATH, 'import { test } from "node:test";\ntest("alpha", () => {});\n');
  repo.write(".ctide/keep", "x\n");
  repo.git("add", "-A");
  repo.git("commit", "-qm", "seed");
  const seedTree = repo.git("rev-parse", "HEAD^{tree}");

  const { bytes, prior } = history(seedTree);
  let base;
  if (bytes === null) {
    base = { treeOid: seedTree, storePath: CANONICAL_STORE_PATH, storeDigest: storeDigest(emptyStore()) };
  } else {
    repo.write(CANONICAL_STORE_PATH, bytes);
    repo.git("add", "-A");
    repo.git("commit", "-qm", "history");
    base = {
      treeOid: repo.git("rev-parse", "HEAD^{tree}"),
      storePath: CANONICAL_STORE_PATH,
      storeDigest: rawDigest(fs.readFileSync(path.join(repo.root, ...CANONICAL_STORE_PATH.split("/")))),
    };
  }
  const store = applyTransaction(prior ?? emptyStore(), "init-task", {
    taskId: TASK, baseProvenance: base, decisionPoints: [], currentTaskDpIds: [],
  }, OPTS);
  const digests = await currentSourceDigests(repo.root);
  return { base, prior, store, digests, identity: adapterIdentity(digests.registryRoot, ADAPTER_ID) };
}

const V2_HISTORY = (seedTree) => {
  const prior = priorStore(seedTree);
  return { bytes: canonicalStoreBytes(prior), prior };
};
const V1_HISTORY = (seedTree) => ({ bytes: canonicalStoreBytes(asLegacyV1(priorStore(seedTree))), prior: null });

const entryFor = (identity, over = {}) => ({
  baseBodyDigest: "1".repeat(64),
  framework: "node-test",
  headBodyDigest: "2".repeat(64),
  implementationIdentity: identity,
  reason: "content-change",
  status: "modified",
  tagAfter: { clauseRef: ASSUM_A },
  tagBefore: { clauseRef: ASSUM_A },
  testRef: { adapterId: ADAPTER_ID, path: TEST_PATH, structuralId: STRUCTURAL },
  ...over,
});

const resultFor = (over = {}) => ({
  testRef: { path: TEST_PATH, adapterId: ADAPTER_ID, structuralId: STRUCTURAL },
  tagBefore: { clauseRef: ASSUM_A },
  tagAfter: { clauseRef: ASSUM_A },
  observedBaseBodyDigest: "1".repeat(64),
  observedHeadBodyDigest: "2".repeat(64),
  findings: [],
  ...over,
});

function inventoryFor(digests, base, entries) {
  const body = {
    inventoryVersion: 2,
    baseTreeOid: base.treeOid,
    registryDigest: digests.registryDigest,
    headViewDigest: digests.headViewDigest,
    inputProvenanceStoreDigest: "3".repeat(64),
    entries,
  };
  return { ...body, inventoryDigest: computeInventoryV2Digest(body) };
}

// The batch goes through the PRODUCTION DOMAIN TRANSACTION (applyTransaction) and is then PERSISTED
// AS A FIXTURE. Two things it deliberately is not: the file-backed writer path -- no load, lock, CAS
// or atomic publish -- and a producer-derived inventory, since the envelope, body digests and
// testRefs are constructed here. What it supplies is a real committed-batch record that the ACTUAL
// consumer then judges, which is the evidence these counter and resolution cases need. Real producer
// and file-backed writer evidence comes from the independent E1 workflow and ASSUM collector
// controls, not from this helper.
function commitBatch(repo, world, entries, results, over = {}) {
  const inventory = inventoryFor(world.digests, world.base, entries);
  const payload = {
    taskId: TASK,
    batchRecordId: "R-b1",
    expectedInputProvenanceStoreDigest: storeDigest(world.store),
    batchSnapshot: {
      taskId: TASK,
      baseProvenance: world.base,
      inventoryDigest: inventory.inventoryDigest,
      inventorySnapshot: { ...inventory, inputProvenanceStoreDigest: storeDigest(world.store) },
      results,
      resolutions: [],
    },
    resolutions: [],
    ...over,
  };
  const snap = payload.batchSnapshot.inventorySnapshot;
  snap.inventoryDigest = computeInventoryV2Digest(snap);
  payload.batchSnapshot.inventoryDigest = snap.inventoryDigest;
  const store = applyTransaction(world.store, "commit-test-provenance-batch", payload, OPTS);
  writeStore(repo, store);
  return { ...world, inventory: snap, store };
}

const emptyWorld = async (repo, options) => commitBatch(repo, await seedWorld(repo, options), [], []);

async function populatedWorld(repo) {
  const world = await seedWorld(repo, { history: V2_HISTORY });
  return commitBatch(repo, world, [entryFor(world.identity)], [resultFor()]);
}

// --- a converging world whose batch RESOLVES two assum-reading-change findings ------------------------
//
// Two entries, two results, ONE cited transition. The writer mints the successor clause, the revise
// Transition, the DP repoint and the batch record in one transaction; the resolution group's witness
// covers both pieces of evidence. This is the only shape that reaches the collector's semantic
// counters at all, because a passing consumer verdict is their sole proof.

const evidenceRecord = (recordId, testRef) => ({
  recordId, kind: "review-ruling", by: TEST_DISCIPLINE, subjectRef: ASSUM_A, ruling: "ok",
  taskId: TASK,
  testRef,
  baseBodyDigest: "1".repeat(64),
  headBodyDigest: "2".repeat(64),
  findingKind: "assum-reading-change",
  binding: { clauseRef: ASSUM_A },
});

const assumFinding = (evidenceRef, over = {}) => ({
  kind: "assum-reading-change",
  evidence: "the ASSUM reading moved",
  binding: { clauseRef: ASSUM_A },
  resolutionRef: {
    mode: "this-round", transitionRef: "T-b",
    semanticEvidenceRef: { kind: "review-ruling", ref: evidenceRef },
  },
  ...over,
});

async function resolvedWorld(repo, { findingOver = {}, extraFindings = [] } = {}) {
  const world = await seedWorld(repo, { history: V2_HISTORY });
  // Members in code-point order: a v2 entry's testRef is refused, not sorted, if they are not.
  const refA = { adapterId: ADAPTER_ID, path: TEST_PATH, structuralId: STRUCTURAL };
  const refB = { adapterId: ADAPTER_ID, path: TEST_PATH_2, structuralId: STRUCTURAL_2 };
  // Already in code-point order, which is also the order sortTypedRefs produces, so the digest below
  // is computed over exactly the set the consumer will normalise.
  const refs = [{ kind: "review-ruling", ref: "R-ev1" }, { kind: "review-ruling", ref: "R-ev2" }];
  const groupDigest = resolutionGroupDigest({
    subjectRef: ASSUM_A, action: "revise", successor: ASSUM_B, semanticEvidenceRefs: refs,
  });
  const entries = [
    entryFor(world.identity, { tagAfter: { clauseRef: ASSUM_B } }),
    entryFor(world.identity, { testRef: refB, tagAfter: { clauseRef: ASSUM_B } }),
  ];
  const results = [
    resultFor({ tagAfter: { clauseRef: ASSUM_B }, findings: [assumFinding("R-ev1", findingOver)] }),
    resultFor({
      testRef: refB, tagAfter: { clauseRef: ASSUM_B },
      findings: [assumFinding("R-ev2"), ...extraFindings],
    }),
  ];
  return commitBatch(repo, world, entries, results, {
    recordsToCreate: [
      evidenceRecord("R-ev1", refA),
      evidenceRecord("R-ev2", refB),
      { recordId: "R-w", kind: "review-ruling", by: CODE, subjectRef: ASSUM_A, ruling: "ok", resolutionGroupDigest: groupDigest },
    ],
    resolutions: [{
      subjectRef: ASSUM_A,
      semanticEvidenceRefs: refs,
      governanceWitnessRef: { kind: "review-ruling", ref: "R-w" },
      transitionDraft: {
        id: "T-b", subject: ASSUM_A, action: "revise", successor: ASSUM_B,
        authorityRef: CODE, ackRef: { kind: "review-ruling", ref: "R-w" },
      },
      successorClauseDraft: {
        id: ASSUM_B, layer: "implementation", derivedFrom: "DP-1", text: "revised reading",
        alternative: "treat null as invalid", basis: "new evidence", basisRefs: [],
        governedBy: CODE, routingOrigin: "safe-default",
      },
    }],
    resolutionCarrierUpdates: [{ dpId: "DP-1", action: "unchanged-null" }],
  });
}

const block = (repo, provenanceTaskId = TASK) =>
  buildTestProvenanceBlock({ repoRoot: repo.root, provenanceTaskId });

const refused = async (promise, what) => {
  let error = null;
  try { await promise; } catch (e) { error = e; }
  assert.ok(error && error.code, `${what}: expected a coded refusal, got ${error}`);
  return error;
};

// --- LABELLED SOURCE-COPY IMPORT PROXIES ------------------------------------------------------------
//
// Boundaries that cannot be reached from outside the collector: a verdict that disagrees with the
// metadata (both come from the same real consumer, so they cannot differ naturally), a store mutated
// BETWEEN the collector's own two loads, and — under §D11.1 — the ORDER and CALL COUNT of the five
// observations, which no return value can expose. Each is exercised by copying the shipped module
// text, rewriting its relative imports to absolute URLs and redirecting one or more of them to a
// wrapper. Stated precisely: this proves the collector's logic on a copy whose only difference is
// that redirection. No shipped source is modified and the product carries no injection seam.
//
// Every wrapper below re-exports and CALLS the real implementation. None reimplements a controller or
// collector predicate; they observe and pass through.

function copyWithRedirects(dir, name, redirects) {
  const source = fs.readFileSync(BLOCK_SCRIPT, "utf8");
  let rewritten = source.replace(/from "\.\//g, `from "file:///${SCRIPTS_DIR}/`);
  for (const [specifier, wrapperFile] of redirects) {
    assert.ok(source.includes(`from "${specifier}"`), `the copy anchor ${specifier} moved; re-point it`);
    const absolute = `from "file:///${SCRIPTS_DIR}/${specifier.slice(2)}"`;
    assert.ok(rewritten.includes(absolute), `${specifier} did not rewrite to an absolute URL`);
    rewritten = rewritten.replace(absolute, `from "${pathToFileURL(wrapperFile).href}"`);
  }
  const file = path.join(dir, name);
  fs.writeFileSync(file, rewritten, "utf8");
  return file;
}

const copyWithRedirect = (dir, name, specifier, wrapperFile) =>
  copyWithRedirects(dir, name, [[specifier, wrapperFile]]);

// A consumer wrapper that returns the REAL verdict with exactly one field perturbed.
async function blockWithPerturbedVerdict(dir, field, value) {
  fs.mkdirSync(dir, { recursive: true });
  const wrapper = path.join(dir, "consumer-wrapper.mjs");
  fs.writeFileSync(wrapper, `export * from "file:///${SCRIPTS_DIR}/committed-batch-consumer.mjs";
import { verifyCommittedBatch as real } from "file:///${SCRIPTS_DIR}/committed-batch-consumer.mjs";
export async function verifyCommittedBatch(request) {
  const verdict = await real(request);
  return Object.freeze({ ...verdict, ${field}: ${JSON.stringify(value)} });
}
`, "utf8");
  const copy = copyWithRedirect(dir, "block-verdict-copy.mjs", "./committed-batch-consumer.mjs", wrapper);
  return import(pathToFileURL(copy).href);
}

// A store wrapper that counts the COLLECTOR's own loads and mutates the persisted store immediately
// before the second one — the re-read. The consumer's own loads go through the real module and are
// not counted, because only the block copy's import is redirected.
async function blockWithMutationBeforeSecondLoad(dir, mutation) {
  const wrapper = path.join(dir, "store-wrapper.mjs");
  fs.writeFileSync(wrapper, `export * from "file:///${SCRIPTS_DIR}/provenance-store.mjs";
import fs from "node:fs";
import path from "node:path";
import * as store from "file:///${SCRIPTS_DIR}/provenance-store.mjs";

export const loads = { count: 0 };
const MUTATION = ${JSON.stringify(mutation)};
const TASK = ${JSON.stringify(TASK)};

function mutate(cwd) {
  if (MUTATION === "valid-append") {
    // The ACTUAL FILE-BACKED WRITER: runTransaction takes the store lock, loads the file itself,
    // applies and publishes atomically. No parse and no manual persistence here -- the point of this
    // branch is that a real append lands, through the real path, exactly between the collector's own
    // two loads. The head, its witness and its preimage are untouched and the store still validates.
    store.runTransaction(cwd, "append-source", {
      source: {
        sourceId: "S-appended", contentKind: "requirement", driftMode: "snapshot-only",
        locator: "conversation#2", excerpt: "an unrelated later source",
      },
    }, { now: Date.now() });
    return;
  }
  // The two DELIBERATE CORRUPTIONS below are hand-made on purpose: a state the writer would refuse
  // is exactly what they need to reach, so they parse, edit and persist directly.
  const file = path.join(cwd, ...store.CANONICAL_STORE_PATH.split("/"));
  const current = store.parseStore(fs.readFileSync(file, "utf8"));
  if (MUTATION === "head-kind") {
    // Same ref string, same batch digest, DIFFERENT typed kind: a ref-only re-read cannot see this.
    current.taskStates.find((t) => t.taskId === TASK).committedProvenanceBatchRef.kind = "review-ruling";
  } else if (MUTATION === "record-related-refs") {
    // A record member OUTSIDE batchDigest's coverage: batchDigest digests batchSnapshot alone, so
    // taskId, kind and the derived preimage digest all still match. Only a COMPLETE record comparison
    // can see this, which is exactly what §D11.1's after-read requires.
    const head = current.taskStates.find((t) => t.taskId === TASK).committedProvenanceBatchRef;
    const record = current.records.find((r) => r.recordId === head.ref);
    record.relatedRefs = [...(record.relatedRefs || []), { kind: "review-ruling", ref: "R-rule1" }];
  } else if (MUTATION === "invalid-store") {
    // The head is untouched; the store as a whole stops validating.
    current.taskStates.find((t) => t.taskId === TASK).currentTaskDpIds = ["DP-does-not-exist"];
  }
  fs.writeFileSync(file, store.canonicalStoreBytes(current), "utf8");
}

export function loadStore(cwd) {
  loads.count += 1;
  if (loads.count === 2) mutate(cwd);
  return store.loadStore(cwd);
}
`, "utf8");
  const copy = copyWithRedirect(dir, "block-store-copy.mjs", "./provenance-store.mjs", wrapper);
  return { module: await import(pathToFileURL(copy).href), wrapper: await import(pathToFileURL(wrapper).href) };
}

function withProxyDir(body) {
  const dir = checkedTempRoot(
    fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ctide-tpb-proxy-"))), "ctide-tpb-proxy-");
  return Promise.resolve(body(dir)).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
}

// Every block, in every situation, carries the same eighteen keys in the same order. This is the
// COMMON contract only: the five loop metrics are case-specific under §D11.1 and are asserted by the
// row that licenses them, never here.
function assertShape(b, what) {
  assert.deepStrictEqual(Object.keys(b), KEYS, `${what}: the eighteen §11 keys, in approved order`);
  assert.strictEqual(typeof b.converged, "boolean", `${what}: converged is a required boolean`);
  assert.strictEqual(b.droppedForNoSource, "unreported", `${what}: §11's own unchanged absence literal`);
}

const LOOP_METRIC_KEYS = ["reviewLoopIterations", "convergenceEpochs", "lastStaleSubject",
  "adapterMisses", "staleBatchRejections"];

// Every row inherited from the E1 suite runs against a repository carrying NO loop control state, so
// each is also a loop-unavailable row. The two contracts stay visibly separate rather than being
// folded back into the common shape assertion.
function assertE1Shape(b, what) {
  assertShape(b, what);
  assertLoopUnavailable(b, what);
}

// The five §D10 metrics are unavailable exactly when no trustworthy inspection supplied them — no
// control state, a corrupt one, or a context-mismatched one. `"unknown"` here is the absence of a
// measurement and is never a stand-in for a known zero.
function assertLoopUnavailable(b, what) {
  for (const key of LOOP_METRIC_KEYS) {
    assert.strictEqual(b[key], "unknown", `${what}: ${key} had no trustworthy inspection to come from`);
  }
  assert.strictEqual(b.converged, false, `${what}: the loop gate was not established`);
}

// --- 1. the shared shape and the default block ----------------------------------------------------------

test("defaultTestProvenance is the eighteen keys in approved order, all unavailable, converged false", () => {
  const b = defaultTestProvenance();
  assertE1Shape(b, "the default block");
  assert.deepStrictEqual(TEST_PROVENANCE_KEYS, KEYS, "the collector and the ledger share one key list");
  assert.strictEqual(b.taskId, null, "no task was requested: an established absence, not an unknown");
  assert.strictEqual(b.converged, false);
  for (const key of ["taggedTests", "inventory", "findingKinds", "entriesWithoutFindings",
    "oracleDepTriggered", "governanceAffectedEntries", "inventoryDigest", "batchDigest",
    "provenanceBatchRef", "assumTransitions"]) {
    assert.strictEqual(b[key], "unknown", `${key} is unavailable in a pure builder`);
  }
});

// --- 2. R1: no identity, and a validated store that proves no such task ----------------------------------

test("R1: a null identity reads no store at all and reports taskId null", async () => {
  const b = await buildTestProvenanceBlock({ repoRoot: "/definitely/not/a/repository", provenanceTaskId: null });
  assertE1Shape(b, "R1 (no identity)");
  assert.strictEqual(b.taskId, null, "no task was requested — an established absence");
  assert.deepStrictEqual(b, defaultTestProvenance(), "and nothing else was derived");
});

test("R1: a VALIDATED store with no such task proves the absence, so taskId is null and not unknown",
  () => withRepo(async (repo) => {
    await emptyWorld(repo, { history: V2_HISTORY });
    const b = await block(repo, "TASK-9");
    assertE1Shape(b, "R1 (unknown task)");
    assert.strictEqual(b.taskId, null, "validated authority says there is no such task");
    assert.strictEqual(b.provenanceBatchRef, "unknown", "and nothing about a head was reached");
  }));

test("R1: a validated but EMPTY store also proves no task", () => withRepo(async (repo) => {
  repo.write("README.md", "x\n");
  repo.git("add", "-A");
  repo.git("commit", "-qm", "seed");
  writeStore(repo, emptyStore());
  const b = await block(repo);
  assert.strictEqual(b.taskId, null, "present and validated: an established absence");
}));

// --- 3. R2: current authority unavailable ------------------------------------------------------------------

test("R2: an absent, malformed, or non-v2 store yields taskId unknown — never the caller's argument",
  () => withRepo(async (repo) => {
    repo.write("README.md", "x\n");
    repo.git("add", "-A");
    repo.git("commit", "-qm", "seed");

    const absent = await block(repo);
    assertE1Shape(absent, "R2 (absent)");
    assert.strictEqual(absent.taskId, "unknown", "an absent file is unavailable, not an empty store");

    repo.write(CANONICAL_STORE_PATH, "{ not json\n");
    assert.strictEqual((await block(repo)).taskId, "unknown", "unparseable");

    const v1 = asLegacyV1(priorStore("0".repeat(40)));
    repo.write(CANONICAL_STORE_PATH, canonicalStoreBytes(v1));
    assert.strictEqual((await block(repo)).taskId, "unknown",
      "an unmigrated CURRENT v1 store is not silently accepted");
  }));

test("R2: a store whose persisted v2 snapshot is malformed never returns validated metadata",
  () => withRepo(async (repo) => {
    const world = await emptyWorld(repo, { history: V2_HISTORY });
    // Remove one required member of the committed inventorySnapshot. loadStore parses every persisted
    // snapshot through the canonical reader, so this refuses at load: there is no reachable state in
    // which the store validates and its preimage is malformed.
    const raw = JSON.parse(JSON.stringify(world.store));
    delete raw.records.find((r) => r.recordId === "R-b1").batchSnapshot.inventorySnapshot.headViewDigest;
    repo.write(CANONICAL_STORE_PATH, canonicalStoreBytes(raw));

    const b = await block(repo);
    assert.strictEqual(b.taskId, "unknown", "R2, not a validated row");
    assert.strictEqual(b.inventoryDigest, "unknown");
  }));

// --- 4. R3/R4: a validated task with no head, and with a legacy head ----------------------------------------

test("R3: a validated task with no committed head reports NULL refs — established absence", () => withRepo(async (repo) => {
  const world = await seedWorld(repo, { history: V2_HISTORY });
  writeStore(repo, world.store);                      // seeded, nothing committed
  const b = await block(repo);
  assertE1Shape(b, "R3");
  assert.strictEqual(b.taskId, TASK);
  assert.strictEqual(b.provenanceBatchRef, null, "no head is an absence, not an unavailable observation");
  assert.strictEqual(b.batchDigest, null);
  assert.strictEqual(b.inventoryDigest, null);
  assert.strictEqual(b.taggedTests, "unknown", "and there is no entry set to count");
  assert.strictEqual(b.converged, false);
}));

test("R4: a legacy batch record exposes its ref and batchDigest but no v2 inventory claim (AC128)",
  () => withRepo(async (repo) => {
    const world = await emptyWorld(repo, { history: V2_HISTORY });
    // A v1.12 legacy record at the head: readable history with no inventorySnapshot. Its
    // record-level inventoryDigest exists and must NOT be reported.
    const raw = JSON.parse(JSON.stringify(world.store));
    const batch = raw.records.find((r) => r.recordId === "R-b1");
    delete batch.batchRecordVersion;
    delete batch.batchSnapshot.inventorySnapshot;
    delete batch.batchSnapshot.inventoryDigest;
    batch.inventoryDigest = sha256Hex("a legacy digest that proves nothing");
    batch.batchDigest = digestOf(batch.batchSnapshot);
    repo.write(CANONICAL_STORE_PATH, canonicalStoreBytes(raw));

    const b = await block(repo);
    assertE1Shape(b, "R4");
    assert.strictEqual(b.taskId, TASK);
    assert.deepStrictEqual(b.provenanceBatchRef, { kind: "provenance-batch", ref: "R-b1" },
      "the TYPED ref, read from the validated TaskState — never a tuple search");
    assert.strictEqual(b.batchDigest, batch.batchDigest, "readable history");
    assert.strictEqual(b.inventoryDigest, "unknown",
      "the record-level field carries no preimage authority and is never reported");
    assert.strictEqual(b.taggedTests, "unknown");
  }));

// --- 5. R5/R6: a v2 head, refused and accepted -----------------------------------------------------------------

test("R5: a valid stale head keeps its canonical facts and loses only the verdict-dependent counts",
  () => withRepo(async (repo) => {
    const world = await populatedWorld(repo);
    // The world moves after the batch was committed, so the consumer refuses on source freshness
    // while the STORE stays validated and its stored facts stay true of that stored head.
    repo.write(TEST_PATH, 'import { test } from "node:test";\ntest("alpha", () => { /* moved */ });\n');

    const b = await block(repo);
    assertE1Shape(b, "R5");
    assert.strictEqual(b.taskId, TASK);
    assert.deepStrictEqual(b.provenanceBatchRef, { kind: "provenance-batch", ref: "R-b1" });
    assert.strictEqual(b.inventoryDigest, world.inventory.inventoryDigest, "a fact of the stored head");
    assert.deepStrictEqual(b.taggedTests, { REQ: 0, DEC: 0, ASSUM: 1, EXPL: 0 },
      "counted from the stored entry set, with no claim of current freshness");
    assert.deepStrictEqual(b.inventory, { added: 0, modified: 1, deleted: 0, retagged: 0, moved: 0 });
    assert.strictEqual(b.governanceAffectedEntries, 0);
    assert.strictEqual(b.findingKinds, "unknown", "no validated result binding, so no finding counts");
    assert.strictEqual(b.entriesWithoutFindings, "unknown");
    assert.strictEqual(b.assumTransitions, "unknown");
    assert.strictEqual(b.converged, false);
  }));

// The PROVENANCE half alone. This repository carries a committed head but no loop control state, so
// every verdict-dependent count is established while `converged` stays false — the two halves are
// independent and the loop gate simply was not established.
test("R6: a converging head yields the validated counts, and converged is false with no loop evidence",
  () => withRepo(async (repo) => {
    const world = await populatedWorld(repo);
    const b = await block(repo);
    assertE1Shape(b, "R6");
    assert.strictEqual(b.taskId, TASK);
    assert.strictEqual(b.inventoryDigest, world.inventory.inventoryDigest);
    assert.deepStrictEqual(b.taggedTests, { REQ: 0, DEC: 0, ASSUM: 1, EXPL: 0 });
    assert.deepStrictEqual(b.inventory, { added: 0, modified: 1, deleted: 0, retagged: 0, moved: 0 });
    assert.deepStrictEqual(b.findingKinds,
      { "wrong-tag": 0, "missing-source": 0, "scope-violation": 0, "assum-reading-change": 0 },
      "the consumer validated the results, so these are countable");
    assert.strictEqual(b.entriesWithoutFindings, 1, "one entry, one clean result");
    assert.strictEqual(b.assumTransitions, 0, "no assum-reading-change finding cites a transition");
    assert.strictEqual(b.converged, false,
      "no loop control state exists, so the loop gate is unestablished and the combined gate is false");
  }));

test("an EMPTY committed inventory counts zeroes, which are measurements and not unknowns",
  () => withRepo(async (repo) => {
    await emptyWorld(repo, { history: V2_HISTORY });
    const b = await block(repo);
    assert.deepStrictEqual(b.taggedTests, { REQ: 0, DEC: 0, ASSUM: 0, EXPL: 0 });
    assert.deepStrictEqual(b.inventory, { added: 0, modified: 0, deleted: 0, retagged: 0, moved: 0 });
    assert.strictEqual(b.governanceAffectedEntries, 0);
    assert.strictEqual(b.entriesWithoutFindings, 0);
  }));

// --- 5a. assumTransitions: a real non-zero count, deduplicated ---------------------------------------------------

test("R6: two valid ASSUM findings citing the SAME transition count as two findings and ONE transition",
  () => withRepo(async (repo) => {
    const world = await resolvedWorld(repo);
    // The premise, from the real consumer: this batch actually converges, so the counters below rest
    // on a validated result binding rather than on a stored array taken on trust.
    const verdict = await verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK });
    assert.strictEqual(verdict.converged, true);
    assert.strictEqual(verdict.resolvedFindingCount, 2);

    const b = await block(repo);
    assertE1Shape(b, "R6 resolved");
    assert.strictEqual(b.findingKinds["assum-reading-change"], 2, "two findings");
    assert.strictEqual(b.assumTransitions, 1,
      "ONE distinct cited transition: a missing deduplication would read 2");
    assert.strictEqual(b.entriesWithoutFindings, 0);
    assert.deepStrictEqual(b.inventory, { added: 0, modified: 2, deleted: 0, retagged: 0, moved: 0 });
    assert.strictEqual(b.inventoryDigest, world.inventory.inventoryDigest);
    assert.strictEqual(b.converged, false, "the loop gate still has no evidence source in E1");
  }));

test("a general finding makes the consumer refuse, so every semantic count is unknown", () => withRepo(async (repo) => {
  const world = await resolvedWorld(repo, {
    extraFindings: [{ kind: "wrong-tag", evidence: "the tag names the wrong clause" }],
  });
  // The exact cause, asserted rather than inferred: a general finding is rejected before any
  // resolution is examined, so it can never reach an honest counter.
  const error = await refused(verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }), "a general finding");
  assert.strictEqual(error.code, "E_STEP6_UNRESOLVED_FINDING", error.message);

  const b = await block(repo);
  assert.strictEqual(b.findingKinds, "unknown");
  assert.strictEqual(b.entriesWithoutFindings, "unknown");
  assert.strictEqual(b.assumTransitions, "unknown");
  assert.strictEqual(b.inventoryDigest, world.inventory.inventoryDigest, "stored facts are retained");
  assert.deepStrictEqual(b.inventory, { added: 0, modified: 2, deleted: 0, retagged: 0, moved: 0 });
  assert.strictEqual(b.converged, false);
}));

test("a finding bound to a clause that is not the entry's pre-side tag refuses, and the counts go unknown",
  () => withRepo(async (repo) => {
    const world = await resolvedWorld(repo);
    // The WRITER refuses this shape outright (E_FINDING_RESOLUTION at transaction time), so the world
    // is built valid and then tampered: one finding's binding is moved to an unrelated ASSUM and the
    // batchDigest is resealed over the edited snapshot. Result-level resolution is a transaction-time
    // obligation, not a load-time one, so the store still loads and validates — which is exactly the
    // state this case is about: validated authority whose CONSUMER refuses.
    const raw = JSON.parse(fs.readFileSync(path.join(repo.root, ...CANONICAL_STORE_PATH.split("/")), "utf8"));
    const batch = raw.records.find((r) => r.recordId === "R-b1");
    batch.batchSnapshot.results[0].findings[0].binding = { clauseRef: ASSUM_C };
    batch.batchDigest = digestOf(batch.batchSnapshot);
    writeStore(repo, raw);

    const reloaded = loadStore(repo.root);
    validateAll(reloaded.store, { now: Date.now() });          // throws if the premise is wrong

    const error = await refused(verifyCommittedBatch({ repoRoot: repo.root, taskId: TASK }), "a borrowed binding");
    assert.strictEqual(error.code, "E_STEP6_FINDING_ASSOCIATION", error.message);

    const b = await block(repo);
    assert.strictEqual(b.assumTransitions, "unknown");
    assert.strictEqual(b.findingKinds, "unknown");
    assert.strictEqual(b.entriesWithoutFindings, "unknown");
    assert.strictEqual(b.inventoryDigest, world.inventory.inventoryDigest, "stored facts are retained");
    assert.strictEqual(b.converged, false);
  }));

// --- 5b. the seven returned-verdict comparisons ------------------------------------------------------------------

test("LABELLED SOURCE-COPY PROXY: each of the seven verdict fields, perturbed alone, degrades the counts",
  () => withRepo(async (repo) => {
    const world = await resolvedWorld(repo);
    await withProxyDir(async (dir) => {
      const cases = [
        ["taskId", "TASK-OTHER"],
        ["committedBatchRef", { kind: "provenance-batch", ref: "R-other" }],
        ["batchDigest", "a".repeat(64)],
        ["inventoryDigest", "b".repeat(64)],
        ["baseTreeOid", "c".repeat(40)],
        ["headViewDigest", "d".repeat(64)],
        ["registryDigest", "e".repeat(64)],
      ];
      for (const [field, value] of cases) {
        const proxy = await blockWithPerturbedVerdict(path.join(dir, field), field, value);
        const b = await proxy.buildTestProvenanceBlock({ repoRoot: repo.root, provenanceTaskId: TASK });
        assert.strictEqual(b.findingKinds, "unknown", `${field}: the counts must not survive a mismatch`);
        assert.strictEqual(b.entriesWithoutFindings, "unknown", field);
        assert.strictEqual(b.assumTransitions, "unknown", field);
        assert.strictEqual(b.converged, false, field);
        assert.strictEqual(b.inventoryDigest, world.inventory.inventoryDigest,
          `${field}: the stored-head facts are retained`);
      }
    });
  }));

// --- 5c. the current-authority recheck, perturbed between the collector's own loads ------------------------------

test("LABELLED SOURCE-COPY PROXY: a head whose typed KIND changed between the loads degrades the counts",
  () => withRepo(async (repo) => {
    const world = await resolvedWorld(repo);
    await withProxyDir(async (dir) => {
      const { module, wrapper } = await blockWithMutationBeforeSecondLoad(dir, "head-kind");
      const b = await module.buildTestProvenanceBlock({ repoRoot: repo.root, provenanceTaskId: TASK });
      assert.strictEqual(wrapper.loads.count, 2, "exactly the collector's own two loads");

      const after = loadStore(repo.root);
      assert.strictEqual(after.store.taskStates.find((t) => t.taskId === TASK)
        .committedProvenanceBatchRef.ref, "R-b1", "the ref STRING is unchanged");
      assert.strictEqual(after.store.taskStates.find((t) => t.taskId === TASK)
        .committedProvenanceBatchRef.kind, "review-ruling", "only the typed kind moved");
      assert.throws(() => validateAll(after.store, { now: Date.now() }),
        "and the current store no longer validates");

      assert.strictEqual(b.assumTransitions, "unknown",
        "a ref-and-digest re-read would have accepted this; the full typed head does not");
      assert.strictEqual(b.findingKinds, "unknown");
      assert.strictEqual(b.entriesWithoutFindings, "unknown");
      assert.strictEqual(b.inventoryDigest, world.inventory.inventoryDigest, "stored facts are retained");
      assert.strictEqual(b.converged, false);
    });
  }));

test("LABELLED SOURCE-COPY PROXY: a store that stops validating between the loads degrades the counts",
  () => withRepo(async (repo) => {
    const world = await resolvedWorld(repo);
    await withProxyDir(async (dir) => {
      const { module } = await blockWithMutationBeforeSecondLoad(dir, "invalid-store");
      const b = await module.buildTestProvenanceBlock({ repoRoot: repo.root, provenanceTaskId: TASK });

      const after = loadStore(repo.root);
      assert.deepStrictEqual(after.store.taskStates.find((t) => t.taskId === TASK)
        .committedProvenanceBatchRef, { kind: "provenance-batch", ref: "R-b1" }, "the head is untouched");
      assert.throws(() => validateAll(after.store, { now: Date.now() }), "but the store is invalid");

      assert.strictEqual(b.assumTransitions, "unknown", "an invalid current store is not validated authority");
      assert.strictEqual(b.findingKinds, "unknown");
      assert.strictEqual(b.inventoryDigest, world.inventory.inventoryDigest, "stored facts are retained");
    });
  }));

test("LABELLED SOURCE-COPY PROXY: an unrelated VALID append between the loads keeps the counts numeric",
  () => withRepo(async (repo) => {
    // The positive twin of the two negatives above, through the identical mechanism. It is what
    // separates §C.3's "same named head and the same digests" from a whole-store-text comparison: an
    // append BEFORE the call would leave both collector reads seeing the same text and would pass
    // under either implementation, so the perturbation has to land between them.
    const world = await resolvedWorld(repo);
    const storeFile = path.join(repo.root, ...CANONICAL_STORE_PATH.split("/"));
    const textBefore = fs.readFileSync(storeFile, "utf8");

    await withProxyDir(async (dir) => {
      const { module, wrapper } = await blockWithMutationBeforeSecondLoad(dir, "valid-append");
      const b = await module.buildTestProvenanceBlock({ repoRoot: repo.root, provenanceTaskId: TASK });
      assert.strictEqual(wrapper.loads.count, 2);

      const textAfter = fs.readFileSync(storeFile, "utf8");
      assert.notStrictEqual(sha256Hex(textAfter), sha256Hex(textBefore), "the current store text really changed");
      const after = loadStore(repo.root);
      validateAll(after.store, { now: Date.now() });                      // throws if it stopped validating
      const afterTask = indexStore(after.store).taskStates.get(TASK);
      assert.deepStrictEqual(afterTask.committedProvenanceBatchRef,
        { kind: "provenance-batch", ref: "R-b1" }, "the full typed head is unchanged");
      assert.deepStrictEqual(afterTask.baseProvenance, world.base, "and so is the base witness");
      assert.ok(after.store.sources.some((s) => s.sourceId === "S-appended"), "the append really happened");

      assert.strictEqual(b.findingKinds["assum-reading-change"], 2,
        "an unrelated valid append must not invalidate counts about an unchanged head");
      assert.strictEqual(b.assumTransitions, 1);
      assert.strictEqual(b.entriesWithoutFindings, 0);
    });
  }));

// --- 6. the sidecar affects ONE field ---------------------------------------------------------------------------

test("a missing, malformed or unbound sidecar leaves oracleDepTriggered unknown and nothing else",
  () => withRepo(async (repo) => {
    const world = await populatedWorld(repo);
    const sidecar = path.join(repo.root, ...OBSERVATION_PATH.split("/"));

    const none = await block(repo);
    assert.strictEqual(none.oracleDepTriggered, "unknown", "no sidecar at all");
    assert.deepStrictEqual(none.inventory, { added: 0, modified: 1, deleted: 0, retagged: 0, moved: 0 },
      "and every other field is intact");

    const bound = {
      observationVersion: 1,
      inventoryDigest: world.inventory.inventoryDigest,
      baseTreeOid: world.inventory.baseTreeOid,
      headViewDigest: world.inventory.headViewDigest,
      registryDigest: world.inventory.registryDigest,
      oracleDepTriggered: 1,
    };
    fs.mkdirSync(path.dirname(sidecar), { recursive: true });
    fs.writeFileSync(sidecar, `${JSON.stringify(bound)}\n`, "utf8");
    assert.strictEqual((await block(repo)).oracleDepTriggered, 1, "a correctly bound observation is consumed");

    fs.writeFileSync(sidecar, `${JSON.stringify({ ...bound, registryDigest: "e".repeat(64) })}\n`, "utf8");
    const unbound = await block(repo);
    assert.strictEqual(unbound.oracleDepTriggered, "unknown", "an observation of another proposal is not this head's");
    assert.strictEqual(unbound.entriesWithoutFindings, 1, "and the rest of the block is unaffected");

    fs.writeFileSync(sidecar, "{ not json\n", "utf8");
    assert.strictEqual((await block(repo)).oracleDepTriggered, "unknown");

    fs.writeFileSync(sidecar, `${JSON.stringify({ ...bound, oracleDepTriggered: 99 })}\n`, "utf8");
    assert.strictEqual((await block(repo)).oracleDepTriggered, "unknown",
      "a count above the two-sided domain is refused rather than reported");
  }));

// --- 7. programmer misuse -----------------------------------------------------------------------------------------

test("the request is exactly two own keys, and a bad identity is misuse rather than 'no identity'", async () => {
  const cases = [
    ["an absent key", { repoRoot: "/x" }],
    ["an extra key", { repoRoot: "/x", provenanceTaskId: null, store: {} }],
    ["a non-string identity", { repoRoot: "/x", provenanceTaskId: 7 }],
    ["an empty identity", { repoRoot: "/x", provenanceTaskId: "" }],
    ["an empty repoRoot", { repoRoot: "", provenanceTaskId: null }],
  ];
  for (const [what, req] of cases) {
    let error = null;
    try { await buildTestProvenanceBlock(req); } catch (e) { error = e; }
    assert.ok(error, `${what}: expected a refusal`);
    assert.strictEqual(error.code, "E_API_ARGUMENTS", `${what}: ${error.message}`);
  }
  let twoArgs = null;
  try { await buildTestProvenanceBlock({ repoRoot: "/x", provenanceTaskId: null }, {}); } catch (e) { twoArgs = e; }
  assert.strictEqual(twoArgs && twoArgs.code, "E_API_ARGUMENTS", "a second argument is refused");
});

// Values are captured once after the own-key check. The collector reads its repoRoot for the store
// load, the bound observation, the consumer call and its own after-read, all of which must name one
// repository; and the key check sees own keys, not merely the enumerable string ones.

test("each owned request value is read exactly once, and the block is unaffected",
  () => withRepo(async (repo) => {
    const counts = { repoRoot: 0, provenanceTaskId: 0 };
    const values = { repoRoot: repo.root, provenanceTaskId: TASK };
    const req = {};
    for (const name of Object.keys(values)) {
      Object.defineProperty(req, name, {
        enumerable: true,
        configurable: true,
        get() { counts[name] += 1; return values[name]; },
      });
    }
    const block = await buildTestProvenanceBlock(req);
    assert.deepStrictEqual(counts, { repoRoot: 1, provenanceTaskId: 1 });
    assert.deepStrictEqual(block, await buildTestProvenanceBlock({ ...values }),
      "a constant accessor is treated exactly like the equivalent plain-data request");
  }));

test("hidden and symbol own keys are refused before any store read", async () => {
  const base = () => ({ repoRoot: "/x", provenanceTaskId: null });

  const hidden = base();
  Object.defineProperty(hidden, "store", { value: {}, enumerable: false, configurable: true });
  assert.deepStrictEqual(Object.keys(hidden).sort(), ["provenanceTaskId", "repoRoot"],
    "invisible to the enumerable view");
  let hiddenError = null;
  try { await buildTestProvenanceBlock(hidden); } catch (e) { hiddenError = e; }
  assert.strictEqual(hiddenError && hiddenError.code, "E_API_ARGUMENTS");
  assert.match(hiddenError.message, /"store"/);

  const symbolled = base();
  symbolled[Symbol("store")] = {};
  let symbolError = null;
  try { await buildTestProvenanceBlock(symbolled); } catch (e) { symbolError = e; }
  assert.strictEqual(symbolError && symbolError.code, "E_API_ARGUMENTS");
  assert.ok(!(symbolError instanceof TypeError), "a typed refusal, not an engine error");
  assert.match(symbolError.message, /Symbol\(store\)/);
});

test("no identity length or character rule is invented: the store's opaque key is used as given",
  () => withRepo(async (repo) => {
    // 600 characters — well past the ledger's human-prose cap, which belongs to `--task` alone.
    const long = "T".repeat(600);
    const b = await block(repo, long);
    assert.strictEqual(b.taskId, "unknown", "refused by authority, never by an invented length rule");
    assert.ok(!(b.taskId === null), "and not silently downgraded to 'no identity'");
  }));

// --- 8. TP v1.21 §D10/§D11.1: the loop half, the metric window and the five ordered observations ---
//
// Loop control state is built by driving the REAL public controller operations, never by writing a
// control file by hand: a hand-written state would restate §D2.1's schema instead of proving the
// collector reads what the controller actually produces. The one exception is the corrupt-state row,
// which the controller cannot produce by construction, and which follows the recovery suite's
// documented direct-tamper discipline.

// A full clean cycle, composed HERE from the loop fixture's existing exports and the controller's
// public operations. The shared fixture is not modified.
async function drivenLoopWorld(repo, { throughVerify = true } = {}) {
  const world = await loopSeedWorld(repo);
  await beginTaskLoop({ repoRoot: repo.root, taskId: LOOP_TASK });
  await runProposalIteration({ repoRoot: repo.root, taskId: LOOP_TASK });
  loopWriteReview(repo, { base: world.base });
  loopWriteGovernance(repo, loopEmptyGovernance());
  await submitReviewedProposal({ repoRoot: repo.root, taskId: LOOP_TASK });
  await commitReviewedBatch({ repoRoot: repo.root, taskId: LOOP_TASK });
  if (throughVerify) await recordVerification({ repoRoot: repo.root, taskId: LOOP_TASK });
  return world;
}

const loopBlock = (repo) => buildTestProvenanceBlock({ repoRoot: repo.root, provenanceTaskId: LOOP_TASK });

test("D11.1: a real begin -> emit -> submit -> commit -> verify cycle converges", () => loopWithRepo(async (repo) => {
  await drivenLoopWorld(repo);
  const b = await loopBlock(repo);
  assertShape(b, "a verified cycle");
  assert.strictEqual(b.converged, true,
    "both halves were proved by this collector from authority it read itself");
  assert.strictEqual(b.taskId, LOOP_TASK);
  // The metric window, from inspect1. One admission, one epoch, nothing uncertain.
  assert.strictEqual(b.reviewLoopIterations, 1);
  assert.strictEqual(b.convergenceEpochs, 1);
  assert.strictEqual(b.adapterMisses, 0, "a known zero is a measurement, not an unknown");
  assert.strictEqual(b.staleBatchRejections, 0);
  assert.strictEqual(b.lastStaleSubject, null, "no stale refusal was recorded: an established absence");
  // And the provenance half's own verdict-dependent counts.
  assert.notStrictEqual(b.findingKinds, "unknown");
  assert.strictEqual(typeof b.entriesWithoutFindings, "number");
}, "ctide-tpb-loop-"));

test("D11.1: a validated NULL head still reports the loop metric window", () => loopWithRepo(async (repo) => {
  await loopSeedWorld(repo);
  await beginTaskLoop({ repoRoot: repo.root, taskId: LOOP_TASK });
  const b = await loopBlock(repo);
  assertShape(b, "a null head with loop state");
  // §D10: loop metrics do not depend on a v2 head.
  assert.strictEqual(b.reviewLoopIterations, 0, "no admission yet, and zero is a measurement");
  assert.strictEqual(b.convergenceEpochs, 1);
  assert.strictEqual(b.adapterMisses, 0);
  assert.strictEqual(b.staleBatchRejections, 0);
  assert.strictEqual(b.lastStaleSubject, null);
  // The head facts remain the established absence R3 licenses, and no consumer could pass.
  assert.strictEqual(b.provenanceBatchRef, null);
  assert.strictEqual(b.batchDigest, null);
  assert.strictEqual(b.inventoryDigest, null);
  assert.strictEqual(b.converged, false, "there is no consumer pass to combine with");
}, "ctide-tpb-null-"));

test("D11.1: a FAILED emission still reports the window, including a real adapter miss",
  () => loopWithRepo(async (repo) => {
    await loopSeedWorld(repo);
    await beginTaskLoop({ repoRoot: repo.root, taskId: LOOP_TASK });
    // A second @src on one declaration: the ACTUAL adapter refuses this source with
    // NodeTestAdapterError/E_TAG_CARDINALITY, which is on the approved E1 allowlist.
    const A = "ASSUM-0000000000000000000000000A";
    repo.write("test/alpha.test.mjs",
      'import { test } from "node:test";\nimport assert from "node:assert";\n'
      + `// @src ${A}\n// @src ${A}\ntest("alpha", () => { assert.ok(1); });\n`);
    await assert.rejects(runProposalIteration({ repoRoot: repo.root, taskId: LOOP_TASK }));

    const b = await loopBlock(repo);
    assertShape(b, "a failed emission");
    assert.strictEqual(b.adapterMisses, 1, "one observed pipeline invocation contributed its refusal");
    assert.strictEqual(b.reviewLoopIterations, 0);
    assert.strictEqual(b.convergenceEpochs, 1);
    assert.strictEqual(b.converged, false);
  }, "ctide-tpb-emit-"));

test("D11.1: loop state absent leaves the metrics unavailable while provenance counts still stand",
  () => withRepo(async (repo) => {
    // The E1 populated world: a real committed head, and no controller has ever run here.
    const world = await populatedWorld(repo);
    const b = await block(repo);
    assertLoopUnavailable(b, "a committed head with no loop control state");
    assert.strictEqual(b.inventoryDigest, world.inventory.inventoryDigest);
    assert.strictEqual(b.entriesWithoutFindings, 1,
      "the provenance half was proved independently and is not withheld by an absent loop half");
  }));

test("D11.1: a CORRUPT control state leaves the metrics unavailable and the provenance half intact",
  () => loopWithRepo(async (repo) => {
    await drivenLoopWorld(repo);
    // The controller cannot produce a corrupt state, so it is written directly — the recovery suite's
    // documented discipline. An undeclared root member violates §D2.1's closed schema.
    const statePath = loopFilesOf(repo, LOOP_TASK).state;
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    fs.writeFileSync(statePath, `${JSON.stringify({ ...state, unexpectedControllerField: 1 })}\n`, "utf8");

    const b = await loopBlock(repo);
    assertLoopUnavailable(b, "a corrupt control state");
    assert.strictEqual(typeof b.entriesWithoutFindings, "number",
      "a corrupt loop half never withholds a provenance result the collector proved itself");
  }, "ctide-tpb-corrupt-"));

test("D11.1: a stale Step 6 refusal gives a known count and a NAMED head ref string",
  () => loopWithRepo(async (repo) => {
    await drivenLoopWorld(repo, { throughVerify: false });
    // A real tracked-source edit after the commit makes the consumer refuse E_STEP6_SOURCE_STALE,
    // which is the only refusal §D10 lets `staleBatchRejections` count.
    // The controller's OWN recorded committed evidence, written by the real commit. Comparing the
    // collector's independent read against it is a cross-check between two separately derived
    // observations rather than an invented constant.
    const committed = readLoopState(repo, LOOP_TASK).committed;
    loopBumpHead(repo, 77);
    const outcome = await recordVerification({ repoRoot: repo.root, taskId: LOOP_TASK });
    assert.strictEqual(outcome.ok, false, "the consumer refused");

    const b = await loopBlock(repo);
    assertShape(b, "a stale refusal");
    // R5: the collector's own consumer refuses for the same stale source, so the stored-head facts
    // stand and only the verdict-dependent counts are withheld.
    assert.deepStrictEqual(b.provenanceBatchRef, committed.headRef, "the FULL typed ref is retained");
    assert.strictEqual(b.batchDigest, committed.batchDigest);
    // AC124 makes the record's derived top-level digest equal the preimage the collector reads, so
    // this is also a live cross-check of that equality.
    assert.strictEqual(b.inventoryDigest, committed.inventoryDigest);
    for (const key of ["findingKinds", "entriesWithoutFindings", "assumTransitions"]) {
      assert.strictEqual(b[key], "unknown", `${key}: no verdict authorized a count`);
    }
    // And the loop metrics remain available, because inspect1 was valid throughout.
    assert.strictEqual(b.staleBatchRejections, 1, "one main-thread consumer refusal, counted once");
    assert.strictEqual(typeof b.lastStaleSubject, "string",
      "§D10: the NAMED head ref string, never a typed object");
    assert.strictEqual(b.reviewLoopIterations, 1, "the window is still readable");
    assert.strictEqual(b.adapterMisses, 0);
    assert.strictEqual(b.converged, false);
  }, "ctide-tpb-stale-"));

test("D11.1: an UNCERTAIN counter projects unknown while its known sibling still reports",
  () => loopWithRepo(async (repo) => {
    await loopSeedWorld(repo);
    await beginTaskLoop({ repoRoot: repo.root, taskId: LOOP_TASK });
    await runProposalIteration({ repoRoot: repo.root, taskId: LOOP_TASK });
    // A pending emit slot is what an interrupted attempt leaves behind; §D4.1 resolves it to an
    // unknown outcome and sets the adapterMisses uncertainty flag. Written directly for the same
    // reason the corrupt row is: no completed operation can leave this state.
    const statePath = loopFilesOf(repo, LOOP_TASK).state;
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    state.attempts.emit = { ...state.attempts.emit, phase: "pending", outcome: null };
    fs.writeFileSync(statePath, `${JSON.stringify(state)}\n`, "utf8");
    await beginTaskLoop({ repoRoot: repo.root, taskId: LOOP_TASK });   // resolves it to unknown

    const b = await loopBlock(repo);
    assertShape(b, "an uncertain counter");
    assert.strictEqual(b.adapterMisses, "unknown", "uncertainty is not a measurement");
    assert.strictEqual(b.staleBatchRejections, 0, "its sibling is still a known zero");
    assert.strictEqual(b.reviewLoopIterations, 0, "and the window itself is still readable");
  }, "ctide-tpb-uncertain-"));

// --- 9. the five observations: order, count, and independence -------------------------------------
//
// No return value can expose ORDER or CALL COUNT, so these use the labelled multi-redirect copy. All
// three wrappers re-export and CALL the real implementations and share one log module; nothing is
// reimplemented. `betweenInspections` runs a real mutation immediately before the second inspection,
// which is the only way to reach the step-4-to-step-5 interleaving from outside the collector.
async function observedBlock(dir, { betweenInspections = "" } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "log.mjs"), "export const log = [];\n", "utf8");
  const logUrl = pathToFileURL(path.join(dir, "log.mjs")).href;

  const loopWrapper = path.join(dir, "loop-wrapper.mjs");
  fs.writeFileSync(loopWrapper, `export * from "file:///${SCRIPTS_DIR}/test-provenance-loop.mjs";
import * as real from "file:///${SCRIPTS_DIR}/test-provenance-loop.mjs";
import fs from "node:fs";
import { log } from "${logUrl}";
// The between-inspections hook runs BEFORE the log push, so if the real operation it performs ever
// throws, the second "inspect" is never logged and the fixed-order assertion fails loudly rather than
// the case degrading quietly into "inspect2 was unavailable". The fs import is in scope for the one
// hook that must reach a state no public operation can produce; the movement hook uses a real
// controller operation instead.
export async function inspectLoopState(request) {
  if (log.filter((e) => e === "inspect").length === 1) { ${betweenInspections} }
  log.push("inspect");
  return real.inspectLoopState(request);
}
`, "utf8");

  const storeWrapper = path.join(dir, "store-log-wrapper.mjs");
  fs.writeFileSync(storeWrapper, `export * from "file:///${SCRIPTS_DIR}/provenance-store.mjs";
import * as real from "file:///${SCRIPTS_DIR}/provenance-store.mjs";
import { log } from "${logUrl}";
export function loadStore(cwd) { log.push("load"); return real.loadStore(cwd); }
`, "utf8");

  const consumerWrapper = path.join(dir, "consumer-log-wrapper.mjs");
  fs.writeFileSync(consumerWrapper, `export * from "file:///${SCRIPTS_DIR}/committed-batch-consumer.mjs";
import * as real from "file:///${SCRIPTS_DIR}/committed-batch-consumer.mjs";
import { log } from "${logUrl}";
export async function verifyCommittedBatch(request) {
  log.push("consumer");
  return real.verifyCommittedBatch(request);
}
`, "utf8");

  const copy = copyWithRedirects(dir, "block-observed-copy.mjs", [
    ["./test-provenance-loop.mjs", loopWrapper],
    ["./provenance-store.mjs", storeWrapper],
    ["./committed-batch-consumer.mjs", consumerWrapper],
  ]);
  const mod = await import(pathToFileURL(copy).href);
  const { log } = await import(logUrl);
  return { build: mod.buildTestProvenanceBlock, log };
}

const ORDER = ["inspect", "load", "consumer", "load", "inspect"];

// Four situations that all used to return early before the consumer, plus a legacy head. Each must
// still perform all five observations, in the fixed order, with exactly one consumer and two
// collector-owned loads. Each row gets its OWN repository: a re-seed inside a live control state
// would be a context mismatch rather than the situation under test.
// Each row also declares the `converged` its situation licenses. The last is a real verified cycle
// observed through pass-through wrappers with nothing moving, so it is a SECOND explicit positive
// proof rather than an unasserted incidental true.
const ORDER_ROWS = [
  ["an absent store", async () => {}, "no-such-task", false],
  ["an unknown task on a validated store", async (repo) => { await loopSeedWorld(repo); }, "no-such-task", false],
  ["a validated null head", async (repo) => {
    await loopSeedWorld(repo);
    await beginTaskLoop({ repoRoot: repo.root, taskId: LOOP_TASK });
  }, LOOP_TASK, false],
  ["a verified v2 head", async (repo) => { await drivenLoopWorld(repo); }, LOOP_TASK, true],
];

for (const [what, setup, taskId, converged] of ORDER_ROWS) {
  test(`D11.1: five observations, in order, with exactly one consumer — ${what}`,
    () => loopWithRepo(async (repo) => {
      await setup(repo);
      await withProxyDir(async (dir) => {
        const { build, log } = await observedBlock(dir);
        const b = await build({ repoRoot: repo.root, provenanceTaskId: taskId });
        assert.deepStrictEqual(log, ORDER, `${what}: the five observations, in §D11.1's order`);
        assert.strictEqual(log.filter((e) => e === "consumer").length, 1, `${what}: EXACTLY one consumer`);
        assert.strictEqual(log.filter((e) => e === "inspect").length, 2, `${what}: two inspections`);
        assert.strictEqual(log.filter((e) => e === "load").length, 2,
          `${what}: two COLLECTOR-owned loads; the consumer's own loads go through the real module`);
        assertShape(b, what);
        assert.strictEqual(b.converged, converged,
          `${what}: both gates hold only where a real cycle verified and nothing moved`);
      });
    }, "ctide-tpb-order-"));
}

test("D11.1: a LEGACY head also performs all five observations", () => withRepo(async (repo) => {
  // The same v1.12 legacy record R4 builds: readable history with no inventorySnapshot, so the
  // reader refuses with its own E_NO_INVENTORY_PREIMAGE rather than the collector returning early.
  const world = await emptyWorld(repo, { history: V2_HISTORY });
  const raw = JSON.parse(JSON.stringify(world.store));
  const batch = raw.records.find((r) => r.recordId === "R-b1");
  delete batch.batchRecordVersion;
  delete batch.batchSnapshot.inventorySnapshot;
  delete batch.batchSnapshot.inventoryDigest;
  batch.inventoryDigest = sha256Hex("a legacy digest that proves nothing");
  batch.batchDigest = digestOf(batch.batchSnapshot);
  repo.write(CANONICAL_STORE_PATH, canonicalStoreBytes(raw));

  await withProxyDir(async (dir) => {
    const { build, log } = await observedBlock(dir);
    const b = await build({ repoRoot: repo.root, provenanceTaskId: TASK });
    assert.deepStrictEqual(log, ORDER, "a legacy head no longer returns before the consumer");
    assert.strictEqual(b.inventoryDigest, "unknown", "AC128: a legacy record carries no preimage authority");
    assert.notStrictEqual(b.provenanceBatchRef, "unknown", "its ref and digest are still readable history");
  });
}));

// The discriminator for §D11.1's COMPLETE-record after-read. `batchDigest` digests `batchSnapshot`
// alone, so a change to `relatedRefs` leaves kind, taskId, batchDigest and the derived preimage digest
// all matching: the narrower four-member check accepts it and only whole-record equality refuses.
test("D11.1: a record member outside batchDigest coverage still fails the after-read",
  () => withRepo(async (repo) => {
    await populatedWorld(repo);
    // The record as it stands BEFORE the proxy mutation, read from real authority.
    const before = loadStore(repo.root);
    const head = before.store.taskStates.find((t) => t.taskId === TASK).committedProvenanceBatchRef;
    const beforeRecord = before.store.records.find((r) => r.recordId === head.ref);

    await withProxyDir(async (dir) => {
      const { module, wrapper } = await blockWithMutationBeforeSecondLoad(dir, "record-related-refs");
      const b = await module.buildTestProvenanceBlock({ repoRoot: repo.root, provenanceTaskId: TASK });
      assert.strictEqual(wrapper.loads.count, 2, "exactly the collector's own two loads");

      // THE PREMISE, asserted rather than assumed. Unlike the head-kind row, this mutation must leave
      // the store VALID: if a future validator refused it, this case would silently become a duplicate
      // of the invalid-store row and would stop discriminating whole-record equality at all.
      const after = loadStore(repo.root);
      assert.doesNotThrow(() => validateAll(after.store, { now: Date.now() }),
        "the mutated store still validates, so only a COMPLETE record comparison can refuse it");
      const afterRecord = after.store.records.find((r) => r.recordId === head.ref);
      assert.strictEqual(afterRecord.batchDigest, beforeRecord.batchDigest,
        "batchDigest digests batchSnapshot alone, so it is unmoved by this member");
      assert.strictEqual(afterRecord.kind, beforeRecord.kind);
      assert.strictEqual(afterRecord.taskId, beforeRecord.taskId);
      assert.ok(afterRecord.relatedRefs.some((r) => r.ref === "R-rule1"),
        "and the added relatedRefs member is the only difference");

      assert.strictEqual(b.findingKinds, "unknown",
        "the named record is not the one the counts were taken from");
      assert.strictEqual(b.entriesWithoutFindings, "unknown");
      assert.strictEqual(b.assumTransitions, "unknown");
      assert.strictEqual(b.converged, false);
      // The stored-head facts survive: this is an after-read refusal, not a metadata failure.
      assert.notStrictEqual(b.inventoryDigest, "unknown");
    });
  }));

test("D11.1: a null identity performs NO observation at all", () => withRepo(async (repo) => {
  await withProxyDir(async (dir) => {
    const { build, log } = await observedBlock(dir);
    const b = await build({ repoRoot: repo.root, provenanceTaskId: null });
    assert.deepStrictEqual(log, [], "the expressly accepted zero-read fast path");
    assertE1Shape(b, "a null identity");
    assert.strictEqual(b.taskId, null);
  });
}));

test("D11.1: control movement between the inspections invalidates the LOOP half only",
  () => loopWithRepo(async (repo) => {
    // The starting state is a real verified cycle: open, one verified current admission, under the
    // cap, no unresolved attempt slot — so §D3.1 row 2 permits a new emission.
    await drivenLoopWorld(repo);
    // A REAL public controller operation lands between inspect1 and inspect2. `runProposalIteration`
    // publishes §D4's publication A, which moves four of §D11.1's seven movement comparands —
    // `revision`, `currentAdmissionId` (to null), `currentAdmissionPhase` (to null) and
    // `currentPassInvalidated` (to true). Nothing here writes the store, so the committed head the
    // provenance half was proved against is untouched.
    const moved = "await real.runProposalIteration(request);";
    await withProxyDir(async (dir) => {
      const { build, log } = await observedBlock(dir, { betweenInspections: moved });
      const b = await build({ repoRoot: repo.root, provenanceTaskId: LOOP_TASK });

      assert.deepStrictEqual(log, ORDER,
        "all five observations still happened, and the real emission between them did not throw");
      assert.strictEqual(b.converged, false, "the movement gate failed");
      assert.strictEqual(typeof b.entriesWithoutFindings, "number",
        "the provenance half was proved before the movement and is never withheld by it");
      assert.strictEqual(b.reviewLoopIterations, 1,
        "the metric window comes from inspect1 and later movement does not erase it");
      assert.strictEqual(b.adapterMisses, 0);

      // The emission really did land: the control state now shows publication A's effects.
      const after = readLoopState(repo, LOOP_TASK);
      assert.strictEqual(after.currentAdmissionId, null, "publication A cleared the current admission");
      assert.strictEqual(after.currentPassInvalidated, true, "and invalidated the pass");
    });
  }, "ctide-tpb-move-"));

test("D11.1: an inspect2-only CONTEXT diagnostic invalidates the loop half and nothing else",
  () => loopWithRepo(async (repo) => {
    await drivenLoopWorld(repo);
    // The step-4-to-step-5 interleaving: the control state's base witness stops matching the
    // TaskState's, so inspect2 diagnoses E_LOOP_CONTEXT. `revision` and every other movement
    // comparand are untouched, so the seven-field equality still passes — only the second reading's
    // own trustworthiness fails.
    const statePath = loopFilesOf(repo, LOOP_TASK).state;
    const drifted = `const p = ${JSON.stringify(statePath)};
    const s = JSON.parse(fs.readFileSync(p, "utf8"));
    s.baseProvenance = { ...s.baseProvenance, treeOid: "0".repeat(40) };
    fs.writeFileSync(p, JSON.stringify(s) + "\\n", "utf8");`;
    await withProxyDir(async (dir) => {
      const { build, log } = await observedBlock(dir, { betweenInspections: drifted });
      const b = await build({ repoRoot: repo.root, provenanceTaskId: LOOP_TASK });

      assert.deepStrictEqual(log, ORDER);
      assert.strictEqual(b.converged, false,
        "a final inspection that diagnoses a context mismatch does not HOLD, so the loop gate is not established");
      assert.strictEqual(typeof b.entriesWithoutFindings, "number",
        "the provenance half the collector proved itself survives");
      assert.strictEqual(b.reviewLoopIterations, 1, "and inspect1's window survives");
    });
  }, "ctide-tpb-ctx-"));
