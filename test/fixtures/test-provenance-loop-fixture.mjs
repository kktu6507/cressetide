// Shipped fixtures for the TP v1.21 loop controller suites.
//
// WHAT IS REAL HERE, and what is not. Every world below is a REAL Git repository with a REAL base
// tree, a REAL provenance store built by chaining the actual transactions, and a REAL emitted
// artifact produced by the actual emitter. The review batch and any governance records are SYNTHETIC
// documents this file writes: they prove mechanical controller behaviour only. **No external reviewer
// ran**, nothing here is an external review, and no green run implies convergence or readiness.
import assert from "node:assert";
import cp from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  emptyStore, canonicalStoreBytes, storeDigest, canonicalJson, digestOf, applyTransaction,
  CANONICAL_STORE_PATH,
} from "../../cressetide/skills/vigil/scripts/provenance-store.mjs";
import { loopPaths } from "../../cressetide/skills/vigil/scripts/test-provenance-loop-state.mjs";

export const OPTS = { now: Date.UTC(2026, 8, 6) };
export const TASK = "TASK-1";
export const ADAPTER_ID = "node-test";
export const TEST_PATH = "test/alpha.test.mjs";
export const STRUCTURAL = 's:["alpha"]';
export const ASSUM_A = "ASSUM-0000000000000000000000000A";
export const DEC_B = "DEC-0000000000000000000000000B";
export const CODE = { kind: "discipline", discipline: "code" };
export const TEST_DISCIPLINE = { kind: "discipline", discipline: "test" };
const PREFIX = "ctide-loop-";

function checkedTempRoot(dir, prefix) {
  const parent = fs.realpathSync(os.tmpdir());
  const resolved = path.resolve(dir);
  assert.strictEqual(path.dirname(resolved), parent, `refusing ${resolved}: not a direct temp child`);
  assert.ok(path.basename(resolved).startsWith(prefix), `refusing ${resolved}: wrong prefix`);
  return resolved;
}

export function makeRepo(prefix = PREFIX) {
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

export async function withRepo(body, prefix = PREFIX) {
  const repo = makeRepo(prefix);
  try {
    return await body(repo);
  } finally {
    fs.rmSync(checkedTempRoot(repo.root, repo.prefix), { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

// The store that goes INTO the base tree: it carries the ASSUM the review's tags bind, which shared
// §9 resolves in B rather than in the current store.
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

const rawDigest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

// A repository whose store carries TASK-1 against a real committed base tree.
// A tagged test declaration on BOTH sides: a modified entry must carry a head-side binding, so the
// real producer refuses an untagged one. The tag names the ASSUM the base store already carries.
const tagged = (body) => 'import { test } from "node:test";\nimport assert from "node:assert";\n'
  + `// @src ${ASSUM_A}\ntest("alpha", () => { assert.ok(1);${body} });\n`;

export async function seedWorld(repo, { changed = true } = {}) {
  repo.write(TEST_PATH, tagged(""));
  repo.write(".ctide/keep", "x\n");
  repo.git("add", "-A");
  repo.git("commit", "-qm", "seed");
  const seedTree = repo.git("rev-parse", "HEAD^{tree}");

  const prior = priorStore(seedTree);
  repo.write(CANONICAL_STORE_PATH, canonicalStoreBytes(prior));
  repo.git("add", "-A");
  repo.git("commit", "-qm", "history");
  const treeOid = repo.git("rev-parse", "HEAD^{tree}");
  const base = {
    treeOid,
    storePath: CANONICAL_STORE_PATH,
    storeDigest: rawDigest(fs.readFileSync(path.join(repo.root, ...CANONICAL_STORE_PATH.split("/")))),
  };
  const store = applyTransaction(prior, "init-task", {
    taskId: TASK, baseProvenance: base, decisionPoints: [], currentTaskDpIds: [],
  }, OPTS);
  repo.write(CANONICAL_STORE_PATH, canonicalStoreBytes(store));

  // A real head-side edit, so the emitted inventory is non-empty when the caller wants one. The tag
  // is unchanged, so the entry is `modified` with a head-side binding rather than retagged.
  if (changed) repo.write(TEST_PATH, tagged(" const x = 1; void x;"));
  return { base, store };
}

// The reviewer's returned batch, written by the MAIN THREAD exactly as §D5.2 describes. Built from
// the ACTUAL emitted artifact so every claim it states is one the emission really produced.
export function writeReview(repo, { taskId = TASK, base, findings = [], over = {} } = {}) {
  const artifactPath = path.join(repo.root, ".ctide", "output", "changed-test-inventory.json");
  const inventory = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const results = inventory.entries.map((entry) => ({
    testRef: { ...entry.testRef },
    tagBefore: entry.tagBefore,
    tagAfter: entry.tagAfter,
    observedBaseBodyDigest: entry.baseBodyDigest,
    observedHeadBodyDigest: entry.headBodyDigest,
    findings: findings.map((f) => (typeof f === "function" ? f(entry) : f)),
  }));
  const batch = {
    taskId,
    baseProvenance: base,
    inventorySnapshot: inventory,
    inventoryDigest: inventory.inventoryDigest,
    results,
    ...over,
  };
  const paths = loopPaths(repo.root, taskId);
  fs.writeFileSync(paths.review, `${canonicalJson(batch)}\n`, "utf8");
  return { batch, inventory, paths };
}

// A REAL head-side edit that moves the entry's head body digest, and therefore the inventory digest
// and the review's fingerprint. This is how a loop legitimately makes progress: two identical reviews
// share a fingerprint by design, so a multi-iteration case must actually change the world.
export function bumpHead(repo, n) {
  repo.write(TEST_PATH, tagged(` const x = ${n}; void x;`));
}

// §D5.4's declared `inventoryDigest`, taken from the ACTUAL emitted envelope. It is bound to the
// emission under review at submit, so a fixture may not leave a placeholder there; before any
// emission exists the value is only shape-checked, and a well-formed constant is enough.
export function currentInventoryDigest(repo) {
  const artifactPath = path.join(repo.root, ".ctide", "output", "changed-test-inventory.json");
  if (!fs.existsSync(artifactPath)) return "0".repeat(64);
  return JSON.parse(fs.readFileSync(artifactPath, "utf8")).inventoryDigest;
}

export function writeGovernance(repo, doc, taskId = TASK) {
  const paths = loopPaths(repo.root, taskId);
  const body = { governanceVersion: 1, taskId, ...doc };
  if (body.inventoryDigest === undefined) body.inventoryDigest = currentInventoryDigest(repo);
  fs.writeFileSync(paths.governance, `${canonicalJson(body)}\n`, "utf8");
  return paths;
}

export const emptyGovernance = (over = {}) => ({
  pendingDeclarations: [],
  packages: [],
  recordsToCreate: [],
  resolutions: [],
  resolutionCarrierUpdates: [],
  ...over,
});

// A synthetic test-discipline evidence carrier that satisfies the writer's this-round equalities.
export const evidenceRecord = (recordId, entry, over = {}) => ({
  recordId, kind: "review-ruling", by: TEST_DISCIPLINE, subjectRef: ASSUM_A, ruling: "ok",
  taskId: TASK,
  testRef: { ...entry.testRef },
  baseBodyDigest: entry.baseBodyDigest,
  headBodyDigest: entry.headBodyDigest,
  findingKind: "assum-reading-change",
  binding: { clauseRef: ASSUM_A },
  ...over,
});

export const assumFinding = (over = {}) => ({
  kind: "assum-reading-change",
  evidence: "the ASSUM reading moved",
  binding: { clauseRef: ASSUM_A },
  ...over,
});

export const generalFinding = (kind = "wrong-tag") => ({ kind, evidence: "the tag is wrong" });

export const readLoopState = (repo, taskId = TASK) =>
  JSON.parse(fs.readFileSync(loopPaths(repo.root, taskId).state, "utf8"));

export const loopFilesOf = (repo, taskId = TASK) => loopPaths(repo.root, taskId);

export { digestOf, canonicalJson };
