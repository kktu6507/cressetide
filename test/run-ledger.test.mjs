// Tests for run-ledger.mjs — the append-only local event ledger for vigil runs (.ctide/ledger/runs.jsonl).
// Two layers: (1) unit tests over the pure record builders + the tolerant JSONL reader; (2) e2e tests that
// spawn the CLI against a real git repo, proving the load-bearing facts-from-artifacts guarantees: `head`/
// `files` are ALWAYS git-derived (never honored from a caller-supplied flag), a truncated ledger self-heals
// before the next append (no silent line concatenation), a non-git cwd still fails open, and CJK/oversized
// task text is capped/round-tripped correctly. All deterministic, no model.
import { test } from "node:test";
import assert from "node:assert";
import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(cp.execFile);
import {
  ledgerDir, runsLedgerPath, ensureLedgerDir, readRunsLedger, filesTouched,
  buildRunRecord, buildCloseEvent, appendRun, appendClose, KNOWN_FLAGS,
  defaultTestProvenance, readProvenanceTaskFlag,
} from "../cressetide/skills/vigil/scripts/run-ledger.mjs";
import { hardenGitSigning } from "./helpers.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(root, "cressetide", "skills", "vigil", "scripts", "run-ledger.mjs");

function temporary(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

function git(cwd, ...args) {
  return cp.execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

// A fresh git repo with one committed file, so HEAD/diffs are always well-defined.
function repository() {
  const dir = temporary("ctide-rl-");
  git(dir, "init", "-q", "--initial-branch=main");
  git(dir, "config", "user.email", "rl@example.invalid");
  git(dir, "config", "user.name", "Run Ledger Test");
  hardenGitSigning(dir);
  fs.writeFileSync(path.join(dir, "a.txt"), "a\n", "utf8");
  fs.writeFileSync(path.join(dir, "b.txt"), "b\n", "utf8");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "initial");
  return dir;
}

function runCli(cwd, args) {
  return cp.execFileSync("node", [SCRIPT, ...args], { cwd, encoding: "utf8" });
}

function lastRecord(dir) {
  const lines = fs.readFileSync(runsLedgerPath(dir), "utf8").trim().split(/\r?\n/);
  return JSON.parse(lines[lines.length - 1]);
}

// --- unit: paths ---

test("ledgerDir / runsLedgerPath compose under .ctide/ledger", () => {
  assert.strictEqual(ledgerDir("/proj"), path.join("/proj", ".ctide", "ledger"));
  assert.strictEqual(runsLedgerPath("/proj"), path.join("/proj", ".ctide", "ledger", "runs.jsonl"));
});

// --- unit: buildRunRecord ---

test("buildRunRecord: absent optional inputs become null (base, plannedRisk) or empty array/string — never guessed", () => {
  const r = buildRunRecord({ ts: 1000, head: "abc123" });
  assert.strictEqual(r.v, 1);
  assert.strictEqual(r.type, "run");
  assert.strictEqual(r.ts, 1000);
  assert.strictEqual(r.task, "");
  assert.strictEqual(r.base, null, "absent base -> null, not guessed");
  assert.strictEqual(r.head, "abc123");
  assert.deepStrictEqual(r.files, []);
  assert.strictEqual(r.verdict, "");
  assert.strictEqual(r.verify, "");
  assert.strictEqual(r.panel, "");
  assert.strictEqual(r.repairs, 0);
  assert.deepStrictEqual(r.findings, []);
  assert.deepStrictEqual(r.planned, { paths: [], risk: null });
  assert.deepStrictEqual(r.drift, { outOfScope: 0, mapCorrections: "" });
  assert.deepStrictEqual(r.window, { days: 14, status: "open" });
});

test("buildRunRecord: explicit base/plannedRisk are kept verbatim (not overwritten by the null default)", () => {
  const r = buildRunRecord({ ts: 1, base: "deadbeef", plannedRisk: "high" });
  assert.strictEqual(r.base, "deadbeef");
  assert.strictEqual(r.planned.risk, "high");
});

test("buildRunRecord: task is capped to 300 chars", () => {
  const r = buildRunRecord({ ts: 1, task: "x".repeat(2000) });
  assert.strictEqual(r.task.length, 300);
});

test("buildRunRecord: driftMap is capped to 300 chars", () => {
  const r = buildRunRecord({ ts: 1, driftMap: "y".repeat(500) });
  assert.strictEqual(r.drift.mapCorrections.length, 300);
});

test("buildRunRecord: findings are capped to the first 20 entries, each truncated to 150 chars", () => {
  const findings = Array.from({ length: 30 }, (_, i) => "finding-" + i + "-" + "z".repeat(200));
  const r = buildRunRecord({ ts: 1, findings });
  assert.strictEqual(r.findings.length, 20, "only the first 20 entries kept");
  assert.strictEqual(r.findings[0], findings[0].slice(0, 150));
  for (const f of r.findings) assert.ok(f.length <= 150);
});

test("buildRunRecord: planned.paths is capped to the first 50 entries, each truncated to 200 chars", () => {
  const plannedPaths = Array.from({ length: 80 }, (_, i) => "path-" + i + "-" + "z".repeat(300));
  const r = buildRunRecord({ ts: 1, plannedPaths });
  assert.strictEqual(r.planned.paths.length, 50, "only the first 50 entries kept");
  assert.strictEqual(r.planned.paths[0], plannedPaths[0].slice(0, 200));
  for (const p of r.planned.paths) assert.ok(p.length <= 200);
});

test("buildRunRecord: windowDays defaults to 14 when absent or non-positive", () => {
  assert.strictEqual(buildRunRecord({ ts: 1 }).window.days, 14);
  assert.strictEqual(buildRunRecord({ ts: 1, windowDays: 0 }).window.days, 14);
  assert.strictEqual(buildRunRecord({ ts: 1, windowDays: -5 }).window.days, 14);
  assert.strictEqual(buildRunRecord({ ts: 1, windowDays: 30 }).window.days, 30);
});

test("buildRunRecord: a fresh run record always starts window.status 'open'", () => {
  assert.strictEqual(buildRunRecord({ ts: 1 }).window.status, "open");
});

test("buildRunRecord: repairs and drift.outOfScope are floored at 0 and never negative", () => {
  assert.strictEqual(buildRunRecord({ ts: 1, repairs: -3 }).repairs, 0);
  assert.strictEqual(buildRunRecord({ ts: 1, driftOutOfScope: -1 }).drift.outOfScope, 0);
  assert.strictEqual(buildRunRecord({ ts: 1, repairs: 2.9 }).repairs, 2, "floored, not rounded");
});

test("buildRunRecord: is pure — no I/O, and never invents `ts` from Date.now() when absent (falls back to 0, not the wall clock)", () => {
  const r = buildRunRecord({});
  assert.strictEqual(r.ts, 0);
});

// --- unit: the v1.18 testProvenance block ---

const TP_KEYS = [
  "taggedTests", "inventory", "findingKinds", "entriesWithoutFindings", "oracleDepTriggered",
  "governanceAffectedEntries", "reviewLoopIterations", "convergenceEpochs", "converged", "taskId",
  "inventoryDigest", "batchDigest", "provenanceBatchRef", "lastStaleSubject", "assumTransitions",
  "adapterMisses", "staleBatchRejections", "droppedForNoSource",
];

test("buildRunRecord carries testProvenance unconditionally, and a PURE builder can only report it unavailable", () => {
  const r = buildRunRecord({ ts: 1 });
  assert.deepStrictEqual(Object.keys(r.testProvenance), TP_KEYS, "the eighteen §11 keys, in approved order");
  assert.deepStrictEqual(r.testProvenance, defaultTestProvenance());
  // The two literals are not interchangeable: `null` is an established absence (no task was
  // requested), `"unknown"` is an unavailable observation, and `converged` is a required boolean
  // whose closed default is false.
  assert.strictEqual(r.testProvenance.taskId, null);
  assert.strictEqual(r.testProvenance.converged, false);
  assert.strictEqual(r.testProvenance.droppedForNoSource, "unreported", "§11's own unchanged literal");
  assert.strictEqual(r.testProvenance.oracleDepTriggered, "unknown");
});

test("buildRunRecord stays pure and synchronous: it accepts no telemetry parameter and returns no promise", () => {
  const r = buildRunRecord({ ts: 1, testProvenance: { converged: true }, oracleDepTriggered: 9 });
  assert.strictEqual(typeof r.then, "undefined", "synchronous");
  assert.strictEqual(r.testProvenance.converged, false, "a caller-supplied block is ignored, never trusted");
  assert.deepStrictEqual(r.testProvenance, defaultTestProvenance());
});

test("defaultTestProvenance returns a fresh object each time, so one record cannot alias another's block", () => {
  const a = buildRunRecord({ ts: 1 });
  const b = buildRunRecord({ ts: 2 });
  a.testProvenance.converged = true;
  assert.strictEqual(b.testProvenance.converged, false, "no shared mutable default");
});

// --- unit: the provenance identity flag, whose three non-absent faults are diagnostics ---

test("readProvenanceTaskFlag separates absent, value-less, repeated and empty from a real identity", () => {
  assert.deepStrictEqual(readProvenanceTaskFlag(["append", "--task", "prose"]),
    { taskId: null, diagnostic: null }, "absent is not a fault");
  assert.deepStrictEqual(readProvenanceTaskFlag(["append", "--provenance-task", "TASK-1"]),
    { taskId: "TASK-1", diagnostic: null });

  const valueLess = readProvenanceTaskFlag(["append", "--provenance-task", "--task", "prose"]);
  assert.strictEqual(valueLess.taskId, null, "the neighbouring flag is never swallowed as a value");
  assert.match(valueLess.diagnostic, /requires a value/);

  const trailing = readProvenanceTaskFlag(["append", "--provenance-task"]);
  assert.strictEqual(trailing.taskId, null);
  assert.match(trailing.diagnostic, /requires a value/);

  const repeated = readProvenanceTaskFlag(["--provenance-task", "A", "--provenance-task", "B"]);
  assert.strictEqual(repeated.taskId, null, "a repeat is refused rather than resolved last-wins");
  assert.match(repeated.diagnostic, /more than once/);

  const empty = readProvenanceTaskFlag(["--provenance-task", ""]);
  assert.strictEqual(empty.taskId, null);
  assert.match(empty.diagnostic, /empty value/);

  // No length rule: the store treats a task id as an opaque key, so a long one passes through.
  assert.strictEqual(readProvenanceTaskFlag(["--provenance-task", "T".repeat(600)]).taskId, "T".repeat(600));
});

test("--provenance-task is a KNOWN flag, so it can never be swallowed as another flag's value", () => {
  assert.ok(KNOWN_FLAGS.includes("--provenance-task"));
  assert.ok(KNOWN_FLAGS.includes("--task"), "and the human prose flag is unchanged");
});

// --- unit: buildCloseEvent ---

test("buildCloseEvent: shape + reason capped to 300 chars", () => {
  const r = buildCloseEvent({ ts: 5, ref: "abc", as: "escaped", reason: "w".repeat(500) });
  assert.deepStrictEqual(
    { v: r.v, type: r.type, ts: r.ts, ref: r.ref, as: r.as },
    { v: 1, type: "close", ts: 5, ref: "abc", as: "escaped" },
  );
  assert.strictEqual(r.reason.length, 300);
});

test("buildCloseEvent: absent fields default to empty string, never guessed", () => {
  const r = buildCloseEvent({});
  assert.strictEqual(r.ref, "");
  assert.strictEqual(r.as, "");
  assert.strictEqual(r.reason, "");
  assert.strictEqual(r.ts, 0);
});

// --- unit: readRunsLedger tolerance ---

test("readRunsLedger keeps valid run/close records and silently skips blank / unparseable / keyless lines", () => {
  const text = [
    JSON.stringify({ type: "run", head: "h1" }),
    "",
    "not json {{{",
    JSON.stringify({ ref: "h1", as: "escaped" }), // no `type` key -> skip
    JSON.stringify({ type: "close", ref: "h1", as: "escaped" }),
    "   ", // whitespace-only -> skip
  ].join("\n");
  const recs = readRunsLedger(text);
  assert.deepStrictEqual(recs.map((r) => r.type), ["run", "close"]);
});

test("readRunsLedger is null/empty tolerant", () => {
  assert.deepStrictEqual(readRunsLedger(""), []);
  assert.deepStrictEqual(readRunsLedger(null), []);
  assert.deepStrictEqual(readRunsLedger(undefined), []);
});

// --- unit: filesTouched fail-open ---

test("filesTouched swallows a non-git cwd to [] rather than throwing", () => {
  const dir = temporary("ctide-rl-nongit-");
  assert.deepStrictEqual(filesTouched(dir, null), []);
});

test("filesTouched normalizes backslashes and drops empty entries", () => {
  const dir = repository();
  fs.appendFileSync(path.join(dir, "a.txt"), "more\n");
  const files = filesTouched(dir, null);
  assert.deepStrictEqual(files, ["a.txt"]);
});

// --- unit: ensureLedgerDir ---

test("ensureLedgerDir creates the directory and a self-gitignore ('*' then '!.gitignore') when absent", () => {
  const dir = temporary("ctide-rl-eld-");
  ensureLedgerDir(dir);
  assert.ok(fs.statSync(ledgerDir(dir)).isDirectory());
  const gi = fs.readFileSync(path.join(ledgerDir(dir), ".gitignore"), "utf8");
  assert.strictEqual(gi, "*\n!.gitignore\n");
});

test("ensureLedgerDir does not clobber an existing .gitignore", () => {
  const dir = temporary("ctide-rl-eld2-");
  fs.mkdirSync(ledgerDir(dir), { recursive: true });
  fs.writeFileSync(path.join(ledgerDir(dir), ".gitignore"), "custom\n", "utf8");
  ensureLedgerDir(dir);
  assert.strictEqual(fs.readFileSync(path.join(ledgerDir(dir), ".gitignore"), "utf8"), "custom\n");
});

// --- unit: appendRun / appendClose share the same ledger file ---

test("appendRun and appendClose both append to the SAME runs.jsonl (mixed run/close records, one per line)", () => {
  const dir = temporary("ctide-rl-mix-");
  assert.strictEqual(appendRun(dir, buildRunRecord({ ts: 1, head: "h1" })), true);
  assert.strictEqual(appendClose(dir, buildCloseEvent({ ts: 2, ref: "h1", as: "escaped", reason: "r" })), true);
  const recs = readRunsLedger(fs.readFileSync(runsLedgerPath(dir), "utf8"));
  assert.deepStrictEqual(recs.map((r) => r.type), ["run", "close"]);
});

// --- e2e: CLI ---

test("append on a fresh git repo creates runs.jsonl + a self-gitignoring .gitignore", () => {
  const dir = repository();
  fs.appendFileSync(path.join(dir, "a.txt"), "changed\n");
  const out = runCli(dir, ["append", "--task", "smoke", "--verdict", "READY", "--verify", "pass", "--panel", "full", "--now", "1000"]);
  assert.match(out, /^ctide-ledger: appended [0-9a-f]{40} \(1 files\)/);
  assert.ok(fs.existsSync(runsLedgerPath(dir)));
  const gi = fs.readFileSync(path.join(ledgerDir(dir), ".gitignore"), "utf8");
  assert.strictEqual(gi, "*\n!.gitignore\n");
});

test("the record's `files` field matches real `git diff --name-only` output, never a caller-typed --head/--files flag", () => {
  const dir = repository();
  fs.appendFileSync(path.join(dir, "a.txt"), "changed-again\n");
  const realHead = git(dir, "rev-parse", "HEAD");
  const realFiles = git(dir, "diff", "--name-only", "HEAD").split(/\r?\n/).filter(Boolean);
  // Deliberately pass bogus --head/--files — the CLI must never read them (facts stay git-derived).
  runCli(dir, [
    "append", "--task", "t", "--verdict", "READY", "--verify", "pass", "--panel", "full", "--now", "2000",
    "--head", "BOGUS-HEAD-VALUE", "--files", "bogus.txt",
  ]);
  const rec = lastRecord(dir);
  assert.strictEqual(rec.head, realHead, "head must be the REAL git rev-parse HEAD, not the --head flag");
  assert.deepStrictEqual(rec.files, realFiles, "files must be the REAL git diff output, not the --files flag");
  assert.ok(!rec.files.includes("bogus.txt"));
});

test("a corrupted (no trailing newline) existing ledger self-heals before the next append — exactly one record per line, no concatenation", () => {
  const dir = repository();
  ensureLedgerDir(dir);
  const rec1 = JSON.stringify(buildRunRecord({ ts: 1, head: "first" }));
  fs.writeFileSync(runsLedgerPath(dir), rec1, "utf8"); // no trailing newline — a truncated write
  assert.ok(!fs.readFileSync(runsLedgerPath(dir), "utf8").endsWith("\n"));
  fs.appendFileSync(path.join(dir, "a.txt"), "more\n");
  runCli(dir, ["append", "--task", "second", "--verdict", "READY", "--verify", "pass", "--panel", "full", "--now", "3000"]);
  const raw = fs.readFileSync(runsLedgerPath(dir), "utf8");
  const lines = raw.split("\n").filter((l) => l.length > 0);
  assert.strictEqual(lines.length, 2, "exactly 2 lines, not one concatenated blob");
  for (const l of lines) assert.doesNotThrow(() => JSON.parse(l), "each line parses independently");
  assert.strictEqual(JSON.parse(lines[0]).head, "first");
  assert.strictEqual(JSON.parse(lines[1]).task, "second");
});

test("a non-git --cwd still exits 0 and records files: [] (fail-open)", () => {
  const dir = temporary("ctide-rl-nongit2-");
  const out = runCli(dir, ["append", "--task", "no git", "--verdict", "READY", "--verify", "pass", "--panel", "full", "--now", "4000"]);
  assert.match(out, /^ctide-ledger: appended/);
  const rec = lastRecord(dir);
  assert.deepStrictEqual(rec.files, []);
});

test("CJK/non-ASCII --task text round-trips correctly through JSON.stringify/JSON.parse", () => {
  const dir = repository();
  const task = "登入逾時修復 — CJK任務 🎯";
  runCli(dir, ["append", "--task", task, "--verdict", "READY", "--verify", "pass", "--panel", "full", "--now", "5000"]);
  assert.strictEqual(lastRecord(dir).task, task);
});

test("a 2000-character --task is truncated to 300 chars in the stored record", () => {
  const dir = repository();
  const task = "x".repeat(2000);
  runCli(dir, ["append", "--task", task, "--verdict", "READY", "--verify", "pass", "--panel", "full", "--now", "6000"]);
  assert.strictEqual(lastRecord(dir).task.length, 300);
});

// --- e2e: the v1.18 telemetry block, derived by the CLI and never supplied to it ---

const appendWith = (dir, extra = []) => cp.spawnSync("node", [
  SCRIPT, "append", "--task", "human prose", "--verdict", "READY", "--verify", "pass", "--panel", "full",
  ...extra,
], { cwd: dir, encoding: "utf8" });

test("the append CLI writes one record carrying the eighteen-key block, and still exits 0", () => {
  const dir = repository();
  const result = appendWith(dir);
  assert.strictEqual(result.status, 0, `fail-open: ${result.stderr}`);
  const record = lastRecord(dir);
  assert.deepStrictEqual(Object.keys(record.testProvenance), TP_KEYS);
  assert.strictEqual(record.task, "human prose", "the human prose flag is untouched");
});

test("with no --provenance-task the block is the NO-IDENTITY one: taskId null, nothing derived", () => {
  const dir = repository();
  assert.strictEqual(appendWith(dir).status, 0);
  const block = lastRecord(dir).testProvenance;
  assert.strictEqual(block.taskId, null, "no task was requested — an established absence");
  assert.deepStrictEqual(block, defaultTestProvenance());
});

test("with --provenance-task in a repository with no store, the identity is UNAVAILABLE, not absent", () => {
  const dir = repository();
  const result = appendWith(dir, ["--provenance-task", "TASK-1"]);
  assert.strictEqual(result.status, 0, `still fail-open: ${result.stderr}`);
  const block = lastRecord(dir).testProvenance;
  assert.strictEqual(block.taskId, "unknown",
    "the store could not be read, so no trusted identity — never the caller's argument, and never null");
  assert.strictEqual(block.converged, false);
});

test("a malformed --provenance-task is a diagnostic: one record is still appended and the exit stays 0", () => {
  for (const [what, extra] of [
    ["value-less", ["--provenance-task"]],
    ["swallowing the next flag", ["--provenance-task", "--base", "HEAD"]],
    ["repeated", ["--provenance-task", "A", "--provenance-task", "B"]],
  ]) {
    const dir = repository();
    const result = appendWith(dir, extra);
    assert.strictEqual(result.status, 0, `${what}: the ledger never becomes a gate`);
    assert.match(result.stderr, /ctide-ledger: --provenance-task/, what);
    const lines = fs.readFileSync(runsLedgerPath(dir), "utf8").trim().split(/\r?\n/);
    assert.strictEqual(lines.length, 1, `${what}: exactly one record`);
    assert.strictEqual(JSON.parse(lines[0]).testProvenance.taskId, null, `${what}: the no-identity block`);
  }
});

test("an ACTUALLY unavailable collector keeps a requested identity UNKNOWN, still appends once and exits 0", () => {
  // The CLI alone in a directory of its own, so its dynamic `./test-provenance-block.mjs` import
  // raises a real ERR_MODULE_NOT_FOUND. Not a synthetic error property: the failure is the module
  // resolution the shipped code actually performs.
  const isolated = temporary("ctide-rl-isolated-");
  const copy = path.join(isolated, "run-ledger.mjs");
  fs.copyFileSync(SCRIPT, copy);

  const run = (dir, extra) => cp.spawnSync("node", [
    copy, "append", "--task", "human prose", "--verdict", "READY", "--verify", "pass", "--panel", "full",
    ...extra,
  ], { cwd: dir, encoding: "utf8" });

  const requestedDir = repository();
  const requested = run(requestedDir, ["--provenance-task", "TASK-1"]);
  assert.strictEqual(requested.status, 0, `fail-open is preserved: ${requested.stderr}`);
  assert.match(requested.stderr, /test provenance unavailable/);
  assert.match(requested.stderr, /Cannot find module|ERR_MODULE_NOT_FOUND/,
    "the failure is a real module resolution failure");
  const requestedLines = fs.readFileSync(runsLedgerPath(requestedDir), "utf8").trim().split(/\r?\n/);
  assert.strictEqual(requestedLines.length, 1, "exactly one record");
  const requestedBlock = JSON.parse(requestedLines[0]).testProvenance;
  assert.strictEqual(requestedBlock.taskId, "unknown",
    "an identity WAS requested and only the collection failed: an unavailable observation, not an absence");
  assert.notStrictEqual(requestedBlock.taskId, "TASK-1",
    "and the unvalidated argument is never echoed back as a known task");
  assert.deepStrictEqual({ ...requestedBlock, taskId: null }, defaultTestProvenance(),
    "exactly one field moves; everything else keeps its unavailable default");

  const absentDir = repository();
  const absent = run(absentDir, []);
  assert.strictEqual(absent.status, 0);
  const absentBlock = JSON.parse(
    fs.readFileSync(runsLedgerPath(absentDir), "utf8").trim().split(/\r?\n/)[0]).testProvenance;
  assert.strictEqual(absentBlock.taskId, null,
    "no identity was requested, so the absence is established by the request and stays null");

  const malformedDir = repository();
  assert.strictEqual(run(malformedDir, ["--provenance-task"]).status, 0);
  assert.strictEqual(JSON.parse(
    fs.readFileSync(runsLedgerPath(malformedDir), "utf8").trim().split(/\r?\n/)[0]).testProvenance.taskId, null,
  "a malformed supplied flag supplies no identity at all, so it stays null too");
});

test("the CLI derives telemetry itself: no flag exists through which a block or a metric can be supplied", () => {
  const dir = repository();
  // Unknown flags to this CLI: `get()` never queries them and none can reach the record, so a caller
  // cannot hand the ledger a verdict it did not derive.
  const result = appendWith(dir, ["--test-provenance", "{}", "--converged", "true"]);
  assert.strictEqual(result.status, 0);
  assert.strictEqual(lastRecord(dir).testProvenance.converged, false);
});

test("--findings splits on ||| and --planned-paths splits on , (trimmed)", () => {
  const dir = repository();
  runCli(dir, [
    "append", "--task", "t", "--verdict", "READY", "--verify", "pass", "--panel", "full", "--now", "7000",
    "--findings", "finding one ||| finding two", "--planned-paths", "src/**, test/**",
  ]);
  const rec = lastRecord(dir);
  assert.deepStrictEqual(rec.findings, ["finding one", "finding two"]);
  assert.deepStrictEqual(rec.planned.paths, ["src/**", "test/**"]);
});

// --- e2e: --verdict/--verify/--panel enum validation (mirrors close --as's strict rejection) ---

test("append rejects an invalid --verdict (not READY|FIX REQUIRED|NOT READY) without writing", () => {
  const dir = repository();
  const result = cp.spawnSync(
    "node", [SCRIPT, "append", "--task", "t", "--verdict", "BOGUS", "--verify", "pass", "--panel", "full"],
    { cwd: dir, encoding: "utf8" },
  );
  assert.strictEqual(result.status, 0);
  assert.ok(!fs.existsSync(runsLedgerPath(dir)), "an invalid --verdict must never write a record");
});

test("append rejects an invalid --verify (not pass|fail|unrun|na) without writing", () => {
  const dir = repository();
  const result = cp.spawnSync(
    "node", [SCRIPT, "append", "--task", "t", "--verdict", "READY", "--verify", "maybe", "--panel", "full"],
    { cwd: dir, encoding: "utf8" },
  );
  assert.strictEqual(result.status, 0);
  assert.ok(!fs.existsSync(runsLedgerPath(dir)), "an invalid --verify must never write a record");
});

test("append rejects a malformed --panel (not 'full' or 'substituted:<names>') without writing", () => {
  const dir = repository();
  const result = cp.spawnSync(
    "node", [SCRIPT, "append", "--task", "t", "--verdict", "READY", "--verify", "pass", "--panel", "bogus"],
    { cwd: dir, encoding: "utf8" },
  );
  assert.strictEqual(result.status, 0);
  assert.ok(!fs.existsSync(runsLedgerPath(dir)), "a malformed --panel must never write a record");
});

test("append accepts a well-formed 'substituted:<names>' --panel value verbatim", () => {
  const dir = repository();
  runCli(dir, ["append", "--task", "t", "--verdict", "READY", "--verify", "pass", "--panel", "substituted:test-reviewer", "--now", "8000"]);
  assert.strictEqual(lastRecord(dir).panel, "substituted:test-reviewer");
});

// --- e2e: append whole-class flag-swallow guard (get() itself now guards EVERY flag in this file's own
// KNOWN_FLAGS -- the same shared-mechanism fix run-reconcile.mjs applies over its own smaller flag set.
// Proven here across every (flag, swallower) pair in run-ledger.mjs's own complete flag set) ---

test("append: for EVERY flag in KNOWN_FLAGS, a value slot occupied by any OTHER known flag's own name is treated as omitted, never as a literal value -- --verdict/--verify/--panel (the only flags with no safe fallback) reject cleanly without writing when swallowed; every other flag falls back to its own sensible default and append still succeeds; --cwd's fallback never creates a stray directory named after a flag token", () => {
  const REQUIRED_NO_DEFAULT = ["--verdict", "--verify", "--panel"];
  const values = {
    "--task": "swallow guard task", "--base": "deadbeef", "--verdict": "READY", "--verify": "pass",
    "--panel": "full", "--repairs": "2", "--findings": "finding one", "--planned-paths": "src/**",
    "--planned-risk": "high", "--drift-outofscope": "1", "--drift-map": "map note", "--window-days": "21",
    "--now": "123456",
  };
  for (const F of KNOWN_FLAGS) {
    for (const G of KNOWN_FLAGS) {
      if (G === F) continue;
      const dir = temporary("ctide-rl-swallow-");
      // Order: G's own legitimate occurrence FIRST, then every other flag, then F LAST with its value slot
      // occupied by the literal token G. This keeps every flag's `indexOf` lookup unambiguous -- G's real
      // pair is always the FIRST occurrence of that token, so a later reuse of the same string as F's fake
      // value can never shadow it.
      const order = [G, ...KNOWN_FLAGS.filter((x) => x !== F && x !== G), F];
      const argv = ["append"];
      for (const flagName of order) {
        if (flagName === F) argv.push(F, G); // F's own value slot swallowed by G's literal name
        else if (flagName === "--cwd") argv.push("--cwd", dir);
        else argv.push(flagName, values[flagName]);
      }
      // Hermetic: strip CLAUDE_PROJECT_DIR so --cwd's fallback resolves to the spawned process's own cwd
      // (this temp dir), never a developer's ambient project dir (test/helpers.mjs's own convention).
      const env = { ...process.env };
      delete env.CLAUDE_PROJECT_DIR;
      const result = cp.spawnSync("node", [SCRIPT, ...argv], { cwd: dir, encoding: "utf8", env });
      assert.strictEqual(result.status, 0, `append ${F} swallowed by ${G} must still exit 0 (fail-open): ${result.stderr}`);
      if (REQUIRED_NO_DEFAULT.includes(F)) {
        assert.ok(!fs.existsSync(runsLedgerPath(dir)), `${F} swallowed by ${G} (required, no safe default) must be rejected without writing`);
      } else {
        assert.ok(fs.existsSync(runsLedgerPath(dir)), `${F} swallowed by ${G} has a sensible default -- append must still succeed and write`);
        const rec = lastRecord(dir);
        assert.strictEqual(rec.verdict, "READY", `${F} swallowed by ${G}: verdict must be unaffected`);
        assert.strictEqual(rec.verify, "pass", `${F} swallowed by ${G}: verify must be unaffected`);
        assert.strictEqual(rec.panel, "full", `${F} swallowed by ${G}: panel must be unaffected`);
        if (F === "--cwd") {
          assert.ok(
            !fs.existsSync(path.join(dir, G)),
            `${F} swallowed by ${G} must never create a stray '${G}' directory`,
          );
        }
      }
    }
  }
});

// --- e2e: execFileSync stdio regression (git's raw stderr must never leak onto this CLI's own stderr) ---

test("append on a non-git --cwd never leaks git's raw error text onto the CLI's own stderr (regression: execFileSync's internal git calls must stay piped, not inherited)", () => {
  const dir = temporary("ctide-rl-stdio-nongit-");
  const result = cp.spawnSync(
    "node", [SCRIPT, "append", "--task", "t", "--verdict", "READY", "--verify", "pass", "--panel", "full", "--now", "1"],
    { cwd: dir, encoding: "utf8" },
  );
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stderr, "", "the CLI's own stderr must stay empty on a non-git cwd");
});

// --- e2e: concurrent append (the atomic-append-boundary assumption, exercised for real) ---

test("two concurrent `append` invocations against the same fresh ledger both land as well-formed, non-interleaved JSONL lines", async () => {
  const dir = repository();
  fs.appendFileSync(path.join(dir, "a.txt"), "concurrent\n");
  const run = (task, now) => execFileAsync("node", [
    SCRIPT, "append", "--task", task, "--verdict", "READY", "--verify", "pass", "--panel", "full", "--now", String(now),
  ], { cwd: dir, encoding: "utf8" });
  await Promise.all([run("concurrent task A", 10001), run("concurrent task B", 10002)]);
  const raw = fs.readFileSync(runsLedgerPath(dir), "utf8");
  const lines = raw.split("\n").filter((l) => l.length > 0);
  assert.strictEqual(lines.length, 2, "exactly 2 lines -- neither append's write interleaved with the other's");
  const parsed = lines.map((l) => JSON.parse(l)); // throws (failing the test) on any interleaved/corrupted line
  assert.deepStrictEqual(parsed.map((r) => r.task).sort(), ["concurrent task A", "concurrent task B"]);
});

test("an unrecognized subcommand prints usage and exits 0 without writing anything", () => {
  const dir = temporary("ctide-rl-badcmd-");
  const result = cp.spawnSync("node", [SCRIPT, "bogus"], { cwd: dir, encoding: "utf8" });
  assert.strictEqual(result.status, 0);
  assert.ok(!fs.existsSync(runsLedgerPath(dir)));
});

test("usage/error text never prints a bare 'skills/vigil/scripts/...' invocation example", () => {
  const dir = temporary("ctide-rl-usage-");
  const result = cp.spawnSync("node", [SCRIPT, "bogus"], { cwd: dir, encoding: "utf8" });
  assert.ok(!/node\s+(?:\.\/)?skills\/vigil\/scripts\//.test(result.stderr + result.stdout));
});
