// The durable scenario world for the actual-reviewer E2E.
//
// TWO CHECKED TEMP CHILDREN, and the split is the point. The REVIEWER REPO (`ctide-e2e-*`) holds only
// genuine product artefacts plus neutrally named captured suite output; it is the only path the
// reviewer ever receives as cwd or `--add-dir`. The HARNESS ROOT (`ctide-e2eh-*`) holds state,
// packets, raw reviewer stdout/stderr, slices and receipts. Nothing in the reviewer repo names a
// scenario, a phase, an expected finding, or any harness bookkeeping, so a reviewer that greps or
// globs the tree it was pointed at cannot discover which arm of which scenario it is in.
//
// WHAT IS REAL HERE. A real Git repository, a real base tree, a real provenance store built by
// chaining the ACTUAL product transactions, and real `node --test` runs whose exit status and summary
// lines are captured as they happened. What is NOT here, and must never be added: any review batch.
// `test/fixtures/test-provenance-loop-fixture.mjs` exports `writeReview` for the controller's own
// unit suites; this file deliberately does not import it. The only bytes that may ever reach
// `task-<h>.review.json` come from a separate real `test-reviewer` process — see `run-scenario.mjs`.
//
// Reuse boundary. `makeRepo` is reused from the shipped fixture because it already carries the two
// things this harness must not re-derive: the checked direct-temp-child guard, and the Git hygiene
// that keeps digests stable on Windows — `core.autocrlf=false`, `commit.gpgsign=false`, a fixed
// identity and `--initial-branch=main`. `seedWorld` is NOT reused: its `tagged()` helper hardcodes a
// single-assertion body that cannot express a two-concern test, and it writes no `.gitignore`.
// `withRepo` is not reused because it deletes the world in `finally`.
import assert from "node:assert";
import cp from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  CANONICAL_STORE_PATH, applyTransaction, canonicalStoreBytes, emptyStore, storeDigest,
} from "../../cressetide/skills/vigil/scripts/provenance-store.mjs";
import { ASSUM_A, CODE, OPTS, TASK, TEST_PATH, makeRepo } from "../../test/fixtures/test-provenance-loop-fixture.mjs";

export const REPO_PREFIX = "ctide-e2e-";
export const HARNESS_PREFIX = "ctide-e2eh-";
// Neutral on purpose. The reviewer may read this directory — the packet points at it — so its name
// and its file names must say nothing about phases, scenarios or expectations.
export const CAPTURE_DIR = ".verification";
export const SCENARIOS = Object.freeze(["positive", "fixed-point"]);
export { ASSUM_A, TASK, TEST_PATH };

const rawDigest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const abs = (repo, rel) => path.join(repo.root, ...rel.split("/"));

// The same containment rule the shipped fixture applies to its own temp roots, restated here because
// `checkedTempRoot` is module-local there and cannot be imported.
export function checkedTempChild(dir, prefix) {
  const resolved = fs.realpathSync(path.resolve(dir));
  const parent = fs.realpathSync(os.tmpdir());
  assert.strictEqual(path.dirname(resolved), parent, `refusing ${resolved}: not a direct child of ${parent}`);
  assert.ok(path.basename(resolved).startsWith(prefix), `refusing ${resolved}: expected the ${prefix} prefix`);
  return resolved;
}

export function makeHarnessRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), HARNESS_PREFIX));
  const root = checkedTempChild(dir, HARNESS_PREFIX);
  for (const sub of ["packets", "raw", "slices"]) fs.mkdirSync(path.join(root, sub), { recursive: true });
  return root;
}

// --- the test under review --------------------------------------------------------------------------
//
// One tagged declaration, tag unchanged across every phase, so each phase's entry is `modified` with
// a head-side binding rather than a retag. `read` is defined INSIDE the body so the `@src` directive
// stays immediately adjacent to the `test(...)` call, matching the shape the shipped fixture already
// proves the adapter accepts.

const HEADER = 'import { test } from "node:test";\nimport assert from "node:assert";\n';
// STATIC member access and a BLOCK body only. The node-test adapter fail-closes on a computed member
// (`m[k]`) with `E_UNSUPPORTED_SYNTAX`/`computed-member`, and on a concise arrow body with
// `E_ORACLE_BINDING`. Both were found by running the real emitter, not assumed.
const OPEN = `// @src ${ASSUM_A}\ntest("alpha", () => {\n`
  + "  const read = (m) => { return m.a === undefined ? null : m.a; };\n";

// Governed by ASSUM-A: a present-but-null key and an absent key both read as absent.
const PRESENT_NULL = "  assert.equal(read({ a: null }), null);\n";
const ABSENT_KEY = "  assert.equal(read({}), null);\n";
// Governed by no clause in the store, and RED on every platform — `read.attempts` is `undefined`, and
// `undefined == 0` is false — so the run really fails rather than merely reading oddly.
const OUT_OF_SCOPE_ATTEMPTS = "  assert.equal(read.attempts, 0);\n";
// A further in-scope assertion, used only by the supplemental read-only drift probe.
const DRIFT_ASSERTION = "  assert.equal(read({ a: 1 }), 1);\n";

const body = lines => `${HEADER}${OPEN}${lines.join("")}});\n`;

export const BODIES = Object.freeze({
  base: body([PRESENT_NULL]),
  negative: body([PRESENT_NULL, ABSENT_KEY, OUT_OF_SCOPE_ATTEMPTS]),
  repaired: body([PRESENT_NULL, ABSENT_KEY]),
});
// The positive scenario's head is the repaired shape: one in-scope addition, green.
export const POSITIVE_BODY = BODIES.repaired;

// `.ctide/provenance.json` stays TRACKED — it is the consuming project's committed canonical state
// (`docs/runtime-contract.md:78-84`). The controller prefix ships no self-guard (:154-157), so the
// consuming repo must supply one; that dependency is exactly what this file honours.
const GITIGNORE = [
  "/.ctide/output/",
  "/.ctide/ledger/",
  "/.ctide/test-provenance-loop/",
  `/${CAPTURE_DIR}/`,
  "",
].join("\n");

// --- the store ---------------------------------------------------------------------------------------

function priorStore(seedTree) {
  let store = applyTransaction(emptyStore(), "init-task", {
    taskId: "TASK-0",
    baseProvenance: {
      treeOid: seedTree, storePath: CANONICAL_STORE_PATH, storeDigest: storeDigest(emptyStore()),
    },
    decisionPoints: [{
      id: "DP-1", dimension: "data", scenario: "null vs absent", alternatives: ["A", "B"],
      layer: "implementation", classificationBasis: "engineering standard", materialReasons: [],
      status: "open",
    }],
    currentTaskDpIds: ["DP-1"],
  }, OPTS);
  store = applyTransaction(store, "append-source", {
    source: {
      sourceId: "S-req", contentKind: "requirement", driftMode: "snapshot-only",
      locator: "conversation#1", excerpt: "the reviewed reading of the null case",
    },
  }, OPTS);
  return applyTransaction(store, "create-initial-outcome", {
    dpId: "DP-1",
    records: [{ recordId: "R-rule1", kind: "review-ruling", by: CODE, subjectRef: "DP-1", ruling: "ok" }],
    clause: {
      id: ASSUM_A, layer: "implementation", derivedFrom: "DP-1", text: "treat null as absent",
      alternative: "treat null as invalid", basis: "matches the option table", basisRefs: [],
      governedBy: CODE, routingOrigin: "safe-default",
    },
  }, OPTS);
}

/**
 * Build the durable world: one reviewer repo and one harness root, both checked direct temp children.
 * The caller owns both and must delete them itself; nothing here removes anything, because the
 * reviewer process and every later stage need them to survive.
 */
export function createScenarioWorld() {
  const repo = makeRepo(REPO_PREFIX);
  checkedTempChild(repo.root, REPO_PREFIX);

  repo.write(".gitignore", GITIGNORE);
  repo.write(TEST_PATH, BODIES.base);
  repo.git("add", "-A");
  // Neutral messages: `git log` is readable by the reviewer, so a commit subject must not echo the
  // packet's scope vocabulary back at it.
  repo.git("commit", "-qm", "add the tagged declaration");
  const seedTree = repo.git("rev-parse", "HEAD^{tree}");

  repo.write(CANONICAL_STORE_PATH, canonicalStoreBytes(priorStore(seedTree)));
  repo.git("add", "-A");
  repo.git("commit", "-qm", "record the provenance store");
  const treeOid = repo.git("rev-parse", "HEAD^{tree}");

  const baseProvenance = Object.freeze({
    treeOid,
    storePath: CANONICAL_STORE_PATH,
    storeDigest: rawDigest(fs.readFileSync(abs(repo, CANONICAL_STORE_PATH))),
  });

  // The task the loop will run, written into the working store exactly as the shipped fixture does.
  repo.write(CANONICAL_STORE_PATH, canonicalStoreBytes(applyTransaction(priorStore(seedTree), "init-task", {
    taskId: TASK, baseProvenance, decisionPoints: [], currentTaskDpIds: [],
  }, OPTS)));

  fs.mkdirSync(abs(repo, CAPTURE_DIR), { recursive: true });
  return { repo, harnessRoot: makeHarnessRoot(), taskId: TASK, baseProvenance, seedTree };
}

// --- head phases ---------------------------------------------------------------------------------------

// Re-attach to a world a previous stage built. Every stage runs in its own process, so the minimal
// handle is rebuilt from the (containment-checked) root rather than smuggled through the state file.
export function attachRepo(root) {
  const checked = checkedTempChild(root, REPO_PREFIX);
  return {
    root: checked,
    write: (rel, text) => {
      const file = path.join(checked, ...rel.split("/"));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text, "utf8");
    },
  };
}

export function applyHead(repo, phase) {
  const chosen = phase === "positive" ? POSITIVE_BODY : BODIES[phase];
  if (typeof chosen !== "string") {
    throw new Error(`unknown head phase ${JSON.stringify(phase)}; expected base, negative, repaired or positive`);
  }
  repo.write(TEST_PATH, chosen);
  return chosen;
}

export const readTestBytes = repo => fs.readFileSync(abs(repo, TEST_PATH));
export const writeTestBytes = (repo, bytes) => fs.writeFileSync(abs(repo, TEST_PATH), bytes);

// The supplemental read-only gate probe: move the head under a committed batch, then restore it
// BYTE-EXACTLY. Restoration is by construction — the caller keeps the original Buffer — rather than
// by re-deriving the text, so "reverted" means the same bytes and not merely the same source.
export function driftInScope(repo) {
  const before = readTestBytes(repo);
  writeTestBytes(repo, Buffer.from(BODIES.repaired.replace("});\n", `${DRIFT_ASSERTION}});\n`), "utf8"));
  return before;
}
export const revertDrift = (repo, saved) => writeTestBytes(repo, saved);

// --- captured evidence ------------------------------------------------------------------------------
//
// An ACTUAL run, recorded as it happened, and identified by ORDINAL rather than by phase so neither
// the record nor the file it is written to names which arm of which scenario produced it. Frozen on
// return so no later stage can retouch a summary into something more convenient. There is
// deliberately no way to construct a capture for a run that has not happened: a green that does not
// exist yet has no representation here.
export function captureSuiteRun(repo, ordinal) {
  const run = cp.spawnSync(process.execPath, ["--test", TEST_PATH], {
    cwd: repo.root, shell: false, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
  });
  const stdout = run.stdout || "";
  // Node's default reporter is chosen by TTY-ness: the `tap` form prefixes counts with `# `, the
  // `spec` form with `ℹ `. A piped capture gets the latter here, so both are matched rather than
  // assumed — an empty summary would leave the packet's verification evidence hollow.
  const summary = stdout.split(/\r?\n/)
    .filter(line => /^\s*[#ℹ]\s*(tests|pass|fail|cancelled|skipped|suites)\b/.test(line))
    .map(line => line.trim());
  return Object.freeze({
    ordinal,
    command: `node --test ${TEST_PATH}`,
    ranAt: new Date().toISOString(),
    exitStatus: run.status,
    signal: run.signal || null,
    green: run.status === 0,
    summaryLines: Object.freeze(summary),
    stdout,
    stderr: run.stderr || "",
  });
}

export const captureRelPath = ordinal => `${CAPTURE_DIR}/run-${ordinal}.txt`;

// Exclusive creation: a pre-planted file or symlink at this name raises EEXIST rather than being
// written through.
export function writeCaptureFile(repo, capture) {
  const file = abs(repo, captureRelPath(capture.ordinal));
  fs.writeFileSync(file, capture.stdout + capture.stderr, { encoding: "utf8", flag: "wx" });
  return file;
}
