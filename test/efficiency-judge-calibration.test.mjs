// Offline oracle for the judge negative-response probe (eval/efficiency/judge-calibration.mjs).
// Four fixed cases, no model call, no network: the CLI is a stand-in file and the child process is
// an injected fake whose transcripts are accounting fixtures for the refusal and integrity logic,
// never semantic evidence. The read-only Codex-authored cases file is checked, never modified.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { root as repoRoot } from "./support.mjs";
import * as protocol from "../eval/efficiency/protocol.mjs";
import * as cal from "../eval/efficiency/judge-calibration.mjs";

const ZERO_SUBAGENT_STATS = Object.freeze({
  spawned: 0,
  requested: { background: 0, foreground: 0, unset: 0 },
  started_in_background: 0,
  max_depth: 0,
  spawned_by_subagents: 0,
  completed: 0,
  failed: 0,
  killed: { parent: 0, user: 0, system: 0 },
  refused: { depth_limit: 0, concurrency_limit: 0, budget: 0 },
  by_type: {},
});

const CASES = JSON.parse(fs.readFileSync(path.join(repoRoot, cal.CASES_RELATIVE_PATH), "utf8"));

// ------------------------------------------------------------------------ frozen case data

test("cases: the read-only Codex-authored file matches its frozen digest and the canonical table", () => {
  const loaded = cal.loadCases(repoRoot);
  assert.deepStrictEqual(loaded.faults, [], JSON.stringify(loaded.faults));
  assert.strictEqual(loaded.cases.length, cal.TOTAL_CASES);
  assert.deepStrictEqual(
    loaded.cases.map((entry) => [entry.id, entry.fixtureId, entry.expectedGrade.result, entry.expectedGrade.pass]),
    cal.CANONICAL_CASES.map((entry) => [entry.id, entry.fixtureId, entry.result, entry.pass]),
  );
});

test("cases: exactly two positive controls are captured output and two negatives are handcrafted", () => {
  const origins = CASES.cases.map((entry) => entry.origin);
  assert.strictEqual(origins.filter((origin) => origin.startsWith("actual captured")).length, 2);
  assert.strictEqual(origins.filter((origin) => origin.includes("not an actual model review")).length, 2);
  // The two negatives are the ones whose expected grade is a negative disposition.
  for (const entry of CASES.cases) {
    const negative = entry.expectedGrade.pass === false;
    assert.strictEqual(entry.origin.includes("not an actual model review"), negative, entry.id);
  }
});

test("cases: a reordered, relabelled or regraded case list is refused", () => {
  const swap = { ...CASES, cases: [CASES.cases[1], CASES.cases[0], CASES.cases[2], CASES.cases[3]] };
  assert.ok(cal.casesFaults(swap).some((fault) => fault.startsWith("cases-id:0")));
  const regraded = {
    ...CASES,
    cases: CASES.cases.map((entry, index) =>
      index === 1 ? { ...entry, expectedGrade: { result: "hit", pass: true } } : entry),
  };
  assert.ok(cal.casesFaults(regraded).includes("cases-expected-grade:case-02"));
  const short = { ...CASES, cases: CASES.cases.slice(0, 3) };
  assert.ok(cal.casesFaults(short).some((fault) => fault.startsWith("cases-count")));
  assert.deepStrictEqual(cal.casesFaults({ cases: "no" }), ["cases-shape"]);
});

test("cases: a digest change is refused without reading the mutated content as authoritative", () => {
  const scratch = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "ctide-efftest-cases-"));
  fs.mkdirSync(path.join(scratch, "eval", "efficiency"), { recursive: true });
  fs.writeFileSync(path.join(scratch, cal.CASES_RELATIVE_PATH), JSON.stringify(CASES), "utf8");
  const loaded = cal.loadCases(scratch);
  assert.strictEqual(loaded.ok, false);
  assert.ok(loaded.faults[0].startsWith("cases-digest:"));
  assert.strictEqual(loaded.cases, null);
});

// ------------------------------------------------------------------------------ prompt build

test("prompt: carries the review and fixture ground truth, never the grader-only fields", () => {
  const steps = cal.buildSteps(repoRoot, cal.loadCases(repoRoot).cases);
  assert.strictEqual(steps.length, 4);
  for (const step of steps) {
    assert.deepStrictEqual(cal.promptLeakFaults(step.prompt, step), [], step.caseId);
    assert.ok(!step.prompt.includes(step.caseId), "case id must not reach the judge");
    assert.ok(!step.prompt.includes(step.origin), "origin annotation must not reach the judge");
    assert.ok(!step.prompt.includes("expectedGrade"));
    assert.ok(step.prompt.includes(protocol.REVIEW_OPEN_DELIMITER));
    assert.ok(step.prompt.includes(`expected = "${step.expected}"`), "fixture disposition is protocol-visible");
    assert.strictEqual(protocol.sha256Hex(step.prompt), step.promptSha256);
  }
  // The two 01 cases share ground truth but differ only in the review text under judgement.
  assert.notStrictEqual(steps[0].promptSha256, steps[1].promptSha256);
  assert.strictEqual(steps[0].expected, "hit");
  assert.strictEqual(steps[2].expected, "clean");
});

test("prompt: the grade vocabulary in the rubric is not treated as leakage", () => {
  const steps = cal.buildSteps(repoRoot, cal.loadCases(repoRoot).cases);
  // `false-positive` and `clean-ok` are the judge's own rubric words and appear by design.
  assert.ok(steps[3].prompt.includes("false-positive"));
  assert.deepStrictEqual(cal.promptLeakFaults(steps[3].prompt, steps[3]), []);
});

// -------------------------------------------------------------------------------- cost rules

test("cost: the tighter 0.25 per-call rule is enforced by the wrapper, not by the L1b constant", () => {
  assert.deepStrictEqual(cal.wrapperCostFaults(0.25), [], "at the cap is not over it");
  assert.deepStrictEqual(cal.wrapperCostFaults(0.2501), ["cal-per-call-overshoot:0.2501"]);
  assert.deepStrictEqual(cal.wrapperCostFaults(null), [], "an unknown cost is handled by the stream rules");
  assert.strictEqual(cal.CAL_PER_CALL_USD, 0.25);
  assert.strictEqual(cal.CAL_TOTAL_USD, 1);
});

// ----------------------------------------------------------------------------- driver harness

function makeCli() {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "ctide-efftest-calcli-"));
  const command = path.join(dir, "claude.js");
  fs.writeFileSync(command, "// stand-in for the pinned CLI executable\n", "utf8");
  return { dir, command };
}

function makeFake() {
  const state = {
    grade: null,
    cost: 0.05,
    exitCode: 0,
    version: protocol.CLI_VERSION,
    versionStatus: 0,
    mutate: null,
    spawns: 0,
  };
  const spawnFn = (command, argv, options) => {
    state.spawns += 1;
    const child = new EventEmitter();
    child.stdin = { end() {}, on() {} };
    child.kill = () => {};
    const sessionId = argv[argv.indexOf("--session-id") + 1];
    const usage = { input_tokens: 3, cache_creation_input_tokens: 900, cache_read_input_tokens: 120, output_tokens: 300 };
    let events = [
      {
        type: "system", subtype: "init", session_id: sessionId, model: protocol.MODEL,
        tools: ["StructuredOutput"], mcp_servers: [], slash_commands: [], plugins: [], agents: [],
        permissionMode: protocol.OBSERVED_PERMISSION_MODE, cwd: options.cwd,
      },
      {
        type: "result", subtype: "success", is_error: false, session_id: sessionId,
        duration_ms: 900, duration_api_ms: 850, num_turns: 1, total_cost_usd: state.cost,
        result: "graded", permission_denials: [], subagent_stats: ZERO_SUBAGENT_STATS, usage,
        modelUsage: {
          [protocol.MODEL]: {
            inputTokens: 3, cacheCreationInputTokens: 900, cacheReadInputTokens: 120,
            outputTokens: 300, costUSD: state.cost, costBasis: "list", provider: "firstParty",
          },
        },
        structured_output: state.grade,
      },
    ];
    if (state.mutate) events = state.mutate(events);
    fs.writeSync(options.stdio[1], events.map((event) => JSON.stringify(event)).join("\n") + "\n");
    setImmediate(() => child.emit("close", state.exitCode, null));
    return child;
  };
  const spawnSyncFn = () => ({ status: state.versionStatus, stdout: `${state.version} (Claude Code)\n`, stderr: "" });
  return { state, spawnFn, spawnSyncFn };
}

function makeDeps(fake, overrides = {}) {
  return {
    spawn: fake.spawnFn,
    spawnSync: fake.spawnSyncFn,
    uuid: randomUUID,
    now: () => new Date().toISOString(),
    tmpdir: () => os.tmpdir(),
    workspaceRoot: repoRoot,
    log: () => {},
    ...overrides,
  };
}

function prepareRoot(fake, overrides = {}) {
  const cli = makeCli();
  const deps = makeDeps(fake, overrides);
  const { root } = cal.prepare({ repoRoot, cliCommand: cli.command }, deps);
  return { root, cli, deps, manifest: JSON.parse(fs.readFileSync(cal.manifestPath(root), "utf8")) };
}

function reseal(root, manifest) {
  fs.writeFileSync(cal.manifestPath(root), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(cal.manifestSealPath(root), `${protocol.sealOf(manifest)}\n`);
}

const EXPECTED_GRADES = [
  { result: "hit", pass: true, rationale: "matches the ground-truth defect" },
  { result: "miss", pass: false, rationale: "never flags the missing return" },
  { result: "clean-ok", pass: true, rationale: "no confident blocker on a correct control" },
  { result: "false-positive", pass: false, rationale: "confident blocker on correct code" },
];

async function runAll(root, fake, deps, grades = EXPECTED_GRADES) {
  for (let index = 0; index < cal.TOTAL_CASES; index += 1) {
    fake.state.grade = grades[index];
    const outcome = await cal.runOneNext(root, deps);
    assert.strictEqual(outcome.ok, true, `case ${index}: ${JSON.stringify(outcome.faults)}`);
  }
}

// ------------------------------------------------------------------------------------ prepare

test("prepare: freezes four sealed steps in a ctide-eff-cal root outside the workspace", () => {
  const fake = makeFake();
  const { root, manifest } = prepareRoot(fake);
  assert.ok(path.basename(root).startsWith(cal.CAL_ROOT_PREFIX));
  assert.strictEqual(path.dirname(fs.realpathSync(root)), fs.realpathSync(os.tmpdir()));
  assert.strictEqual(manifest.steps.length, 4);
  assert.strictEqual(manifest.casesSha256, cal.CASES_SHA256);
  assert.strictEqual(manifest.perCallUsd, 0.25);
  assert.strictEqual(manifest.totalUsd, 1);
  assert.strictEqual(manifest.cli.observedVersion, protocol.CLI_VERSION);
  assert.strictEqual(fs.readFileSync(cal.manifestSealPath(root), "utf8").trim(), protocol.sealOf(manifest));
  assert.strictEqual(fs.readFileSync(cal.systemPromptPath(root), "utf8"), protocol.JUDGE_SYSTEM_PROMPT);
  for (let index = 0; index < 4; index += 1) {
    const prompt = fs.readFileSync(cal.promptPath(root, index), "utf8");
    assert.ok(!prompt.includes(manifest.steps[index].caseId));
    assert.ok(!prompt.includes("expectedGrade"));
  }
  assert.deepStrictEqual(Object.keys(manifest.sources).sort(), [...cal.SOURCE_PATHS].sort());
});

test("prepare: refuses a wrong or unprobeable CLI version", () => {
  const wrong = makeFake();
  wrong.state.version = "2.2.0";
  assert.throws(() => prepareRoot(wrong), /cli-version-mismatch:2\.2\.0/);
  const failing = makeFake();
  failing.state.versionStatus = 1;
  assert.throws(() => prepareRoot(failing), /cli-version-probe-failed/);
});

// ----------------------------------------------------------------------------------- dispatch

test("dispatch: the two planned negative grades are accepted as coherent calibration targets", async () => {
  const fake = makeFake();
  const { root, deps } = prepareRoot(fake);
  await runAll(root, fake, deps);

  for (const index of [1, 3]) {
    const final = JSON.parse(fs.readFileSync(cal.attemptPath(root, index, "final"), "utf8"));
    assert.strictEqual(final.grade.pass, false, "a negative disposition is the target here");
    assert.deepStrictEqual(final.faults, [], "a planned negative grade is not a transport failure");
    assert.strictEqual(final.ok, true);
    assert.strictEqual(final.gradeMatch, true);
  }
  const summary = cal.summarize(root, deps);
  assert.strictEqual(summary.ok, true, JSON.stringify(summary.faults));
  assert.strictEqual(summary.matched, "4/4");
  assert.ok(summary.claim.some((line) => line.includes("no statistical calibration") || line.includes("statistical calibration")));
  assert.ok(summary.claim.some((line) => line.includes("not model output")));
  assert.ok(Math.abs(summary.aggregate.estimatedTotalUsd - 0.2) < 1e-9);
});

test("dispatch: a semantic mismatch is retained, blocks acceptance, and is not a transport fault", async () => {
  const fake = makeFake();
  const { root, deps } = prepareRoot(fake);
  const grades = [...EXPECTED_GRADES];
  // The judge says "hit" where the case expects "miss": wrong semantics, valid transport.
  grades[1] = { result: "hit", pass: true, rationale: "claims the review found the defect" };
  await runAll(root, fake, deps, grades);

  const final = JSON.parse(fs.readFileSync(cal.attemptPath(root, 1, "final"), "utf8"));
  assert.strictEqual(final.ok, true, "a mismatch must not be recorded as an infrastructure failure");
  assert.deepStrictEqual(final.faults, []);
  assert.strictEqual(final.gradeMatch, false);
  assert.deepStrictEqual(final.expectedGrade, { result: "miss", pass: false });
  assert.strictEqual(final.grade.result, "hit", "the actual grade is retained verbatim");

  const summary = cal.summarize(root, deps);
  assert.strictEqual(summary.ok, false, "acceptance requires all four pairs to match");
  assert.ok(summary.faults.includes("semantic-mismatch:case-02"));
  assert.strictEqual(summary.matched, "3/4");
  assert.strictEqual(summary.rows[1].actualGrade.result, "hit");
});

test("dispatch: an incoherent grade IS a record fault and halts the batch", async () => {
  const fake = makeFake();
  const { root, deps } = prepareRoot(fake);
  // Fixture 01 is `hit`, so `clean-ok` is not a legal grade shape for it at all.
  fake.state.grade = { result: "clean-ok", pass: true, rationale: "wrong shape" };
  const outcome = await cal.runOneNext(root, deps);
  assert.strictEqual(outcome.ok, false);
  assert.ok(outcome.faults.some((fault) => fault.startsWith("grade-result-for-hit")));
  assert.deepStrictEqual((await cal.runOneNext(root, deps)).faults, ["halted-at:0"]);
});

test("dispatch: an unknown or overshooting cost stops the batch", async () => {
  const unknown = makeFake();
  const unknownRoot = prepareRoot(unknown);
  unknown.state.grade = EXPECTED_GRADES[0];
  unknown.state.mutate = (events) => events.map((event) => {
    if (event.type !== "result") return event;
    const copy = { ...event };
    delete copy.total_cost_usd;
    return copy;
  });
  const missing = await cal.runOneNext(unknownRoot.root, unknownRoot.deps);
  assert.ok(missing.faults.includes("cost-unknown"));
  assert.deepStrictEqual((await cal.runOneNext(unknownRoot.root, unknownRoot.deps)).faults, ["halted-at:0"]);

  const perCall = makeFake();
  const perCallRoot = prepareRoot(perCall);
  perCall.state.grade = EXPECTED_GRADES[0];
  perCall.state.cost = 0.3;
  const over = await cal.runOneNext(perCallRoot.root, perCallRoot.deps);
  assert.ok(over.faults.includes("cal-per-call-overshoot:0.3"), JSON.stringify(over.faults));
  assert.strictEqual(over.record.totalCostUsd, 0.3, "the actual cost is preserved on a failed record");

});

test("cost: the 1 USD aggregate rule fires on the crossing call, and four capped calls cannot reach it", () => {
  const step = cal.buildSteps(repoRoot, cal.loadCases(repoRoot).cases)[0];
  const session = "11111111-2222-3333-4444-555555555555";
  const transcript = (cost) => [
    {
      type: "system", subtype: "init", session_id: session, model: protocol.MODEL,
      tools: ["StructuredOutput"], mcp_servers: [], slash_commands: [], plugins: [], agents: [],
      permissionMode: protocol.OBSERVED_PERMISSION_MODE, cwd: "/tmp/ctide-eff-cal-work-x",
    },
    {
      type: "result", subtype: "success", is_error: false, session_id: session,
      duration_ms: 1, duration_api_ms: 1, num_turns: 1, total_cost_usd: cost,
      result: "graded", permission_denials: [], subagent_stats: ZERO_SUBAGENT_STATS,
      usage: { input_tokens: 1, cache_creation_input_tokens: 1, cache_read_input_tokens: 1, output_tokens: 1 },
      modelUsage: {
        [protocol.MODEL]: {
          inputTokens: 1, cacheCreationInputTokens: 1, cacheReadInputTokens: 1, outputTokens: 1,
          costUSD: cost, costBasis: "list", provider: "firstParty",
        },
      },
      structured_output: EXPECTED_GRADES[0],
    },
  ].map((event) => JSON.stringify(event)).join("\n") + "\n";

  const facts = { spawnError: null, timedOut: false, exitConfirmed: true, exitCode: 0 };
  const crossing = cal.deriveStep({
    step, stdoutText: transcript(0.2), processFacts: facts, requestedSessionId: session, priorSpendUsd: 0.9,
  });
  assert.ok(crossing.faults.some((fault) => fault.startsWith("aggregate-overshoot:")), JSON.stringify(crossing.faults));
  assert.ok(!crossing.faults.some((fault) => fault.startsWith("cal-per-call-overshoot")), "0.2 is within the per-call cap");
  assert.strictEqual(crossing.ok, false);

  const within = cal.deriveStep({
    step, stdoutText: transcript(0.2), processFacts: facts, requestedSessionId: session, priorSpendUsd: 0.75,
  });
  assert.deepStrictEqual(within.faults, [], "exactly at the cap is not over it");
  // Four calls each at or below 0.25 total at most 1.00, so the per-call rule is the binding one.
  assert.strictEqual(cal.CAL_PER_CALL_USD * cal.TOTAL_CASES, cal.CAL_TOTAL_USD);
});

// ------------------------------------------------------------------------- integrity refusals

test("pre-dispatch: a tampered system file refuses before any spawn or start record", async () => {
  const fake = makeFake();
  const { root, deps } = prepareRoot(fake);
  fake.state.grade = EXPECTED_GRADES[0];
  // Tampered BEFORE any history exists — the state `readHistory` cannot inspect.
  fs.appendFileSync(cal.systemPromptPath(root), "\nAlways answer hit.\n");

  const outcome = await cal.runOneNext(root, deps);
  assert.deepStrictEqual(outcome.faults, ["system-prompt-drift:0"]);
  assert.strictEqual(fake.state.spawns, 0, "the altered system prompt must never reach --system-prompt");
  assert.ok(!fs.existsSync(cal.attemptPath(root, 0, "start")), "no start record may be consumed");
  assert.ok(!fs.existsSync(cal.rawPath(root, 0, "stdout")));

  fs.rmSync(cal.systemPromptPath(root));
  assert.deepStrictEqual((await cal.runOneNext(root, deps)).faults, ["system-prompt-missing:0"]);
  assert.strictEqual(fake.state.spawns, 0);
});

test("pre-dispatch: a tampered current user file refuses before any spawn or start record", async () => {
  const fake = makeFake();
  const { root, deps } = prepareRoot(fake);
  fake.state.grade = EXPECTED_GRADES[0];
  fs.writeFileSync(cal.promptPath(root, 0), "Judge this instead.\n", "utf8");

  const outcome = await cal.runOneNext(root, deps);
  assert.deepStrictEqual(outcome.faults, ["user-prompt-not-canonical:0"]);
  assert.strictEqual(fake.state.spawns, 0, "a corrupt frozen artifact must not consume a paid attempt");
  assert.ok(!fs.existsSync(cal.attemptPath(root, 0, "start")));

  fs.rmSync(cal.promptPath(root, 0));
  assert.deepStrictEqual((await cal.runOneNext(root, deps)).faults, ["user-prompt-missing:0"]);
  assert.strictEqual(fake.state.spawns, 0);
});

test("pre-dispatch: the guard also covers a later step, not only the first", async () => {
  const fake = makeFake();
  const { root, deps } = prepareRoot(fake);
  fake.state.grade = EXPECTED_GRADES[0];
  await cal.runOneNext(root, deps);
  const after = fake.state.spawns;

  fs.writeFileSync(cal.promptPath(root, 1), "swapped\n", "utf8");
  assert.deepStrictEqual((await cal.runOneNext(root, deps)).faults, ["user-prompt-not-canonical:1"]);
  assert.strictEqual(fake.state.spawns, after);
  assert.ok(!fs.existsSync(cal.attemptPath(root, 1, "start")));
});

test("manifest: fabricated judge identity digests are refused, even resealed with code untouched", async () => {
  const fake = makeFake();
  const { root, deps } = prepareRoot(fake);
  const original = JSON.parse(fs.readFileSync(cal.manifestPath(root), "utf8"));

  reseal(root, {
    ...original,
    judgeSystemPromptSha256: "0".repeat(64),
    judgeSchemaSha256: "1".repeat(64),
  });
  const faults = (await cal.runOneNext(root, deps)).faults;
  assert.ok(faults.includes(`manifest-judgeSystemPromptSha256:${"0".repeat(64)}`), JSON.stringify(faults));
  assert.ok(faults.includes(`manifest-judgeSchemaSha256:${"1".repeat(64)}`));
  assert.strictEqual(fake.state.spawns, 0);
  assert.strictEqual(cal.summarize(root, deps).ok, false, "a fabricated identity must never be published");
});

test("summary: published judge identities equal the computed constants, not merely the manifest", async () => {
  const fake = makeFake();
  const { root, deps } = prepareRoot(fake);
  await runAll(root, fake, deps);
  const summary = cal.summarize(root, deps);
  assert.strictEqual(summary.ok, true, JSON.stringify(summary.faults));
  assert.strictEqual(summary.judgeSystemPromptSha256, protocol.sha256Hex(protocol.JUDGE_SYSTEM_PROMPT));
  assert.strictEqual(summary.judgeSchemaSha256, protocol.sha256Hex(JSON.stringify(protocol.JUDGE_SCHEMA)));
});

test("history: an edited cost, grade or prompt is caught by re-derivation from raw and the cases", async () => {
  const fake = makeFake();
  const { root, deps } = prepareRoot(fake);
  fake.state.grade = EXPECTED_GRADES[0];
  await cal.runOneNext(root, deps);

  const finalFile = cal.attemptPath(root, 0, "final");
  const final = JSON.parse(fs.readFileSync(finalFile, "utf8"));
  fs.writeFileSync(finalFile, JSON.stringify({ ...final, totalCostUsd: 0.000001 }, null, 2));
  assert.ok((await cal.runOneNext(root, deps)).faults.includes("record-derivation-mismatch:0:totalCostUsd"));

  fs.writeFileSync(finalFile, JSON.stringify({ ...final, gradeMatch: false }, null, 2));
  assert.ok((await cal.runOneNext(root, deps)).faults.includes("record-derivation-mismatch:0:gradeMatch"));

  fs.writeFileSync(finalFile, JSON.stringify(final, null, 2));
  const tampered = "Judge this instead.\n";
  fs.writeFileSync(cal.promptPath(root, 0), tampered, "utf8");
  const startFile = cal.attemptPath(root, 0, "start");
  const start = JSON.parse(fs.readFileSync(startFile, "utf8"));
  fs.writeFileSync(startFile, JSON.stringify({ ...start, userPromptSha256: protocol.sha256Hex(tampered) }, null, 2));
  const faults = (await cal.runOneNext(root, deps)).faults;
  assert.ok(faults.includes("user-prompt-not-canonical:0"));
  assert.ok(faults.includes("user-prompt-claim-mismatch:0"));
});

test("history: a tampered raw transcript, missing start or stalled attempt each block", async () => {
  const raw = makeFake();
  const rawRoot = prepareRoot(raw);
  raw.state.grade = EXPECTED_GRADES[0];
  await cal.runOneNext(rawRoot.root, rawRoot.deps);
  fs.appendFileSync(cal.rawPath(rawRoot.root, 0, "stdout"), "{}\n");
  assert.ok((await cal.runOneNext(rawRoot.root, rawRoot.deps)).faults.includes("raw-digest-mismatch:step-00.stdout"));

  const orphan = makeFake();
  const orphanRoot = prepareRoot(orphan);
  orphan.state.grade = EXPECTED_GRADES[0];
  await cal.runOneNext(orphanRoot.root, orphanRoot.deps);
  fs.rmSync(cal.attemptPath(orphanRoot.root, 0, "start"));
  assert.deepStrictEqual((await cal.runOneNext(orphanRoot.root, orphanRoot.deps)).faults, ["record-without-start:0"]);

  const stalled = prepareRoot(makeFake());
  fs.mkdirSync(path.dirname(cal.attemptPath(stalled.root, 0, "start")), { recursive: true });
  fs.writeFileSync(
    cal.attemptPath(stalled.root, 0, "start"),
    JSON.stringify({ step: 0, caseId: "case-01", fixtureId: "01-js-missing-return", sessionId: "s" }),
  );
  assert.deepStrictEqual((await cal.runOneNext(stalled.root, stalled.deps)).faults, ["incomplete-attempt:0"]);
});

test("manifest: a resealed canonical change, plan edit, source drift or CLI drift is refused", async () => {
  const fake = makeFake();
  const { root, cli, deps } = prepareRoot(fake);
  const original = JSON.parse(fs.readFileSync(cal.manifestPath(root), "utf8"));

  fs.writeFileSync(cal.manifestPath(root), JSON.stringify({ ...original, perCallUsd: 2 }, null, 2));
  const unsealed = (await cal.runOneNext(root, deps)).faults;
  assert.ok(unsealed.includes("manifest-seal-mismatch"));
  assert.ok(unsealed.includes("manifest-perCallUsd:2"));

  reseal(root, { ...original, totalUsd: 25 });
  assert.ok((await cal.runOneNext(root, deps)).faults.includes("manifest-totalUsd:25"));

  reseal(root, {
    ...original,
    steps: original.steps.map((step, index) =>
      index === 1 ? { ...step, expectedGrade: { result: "hit", pass: true } } : step),
  });
  assert.ok((await cal.runOneNext(root, deps)).faults.includes("manifest-plan-not-canonical"));

  reseal(root, { ...original, childEnvOverrides: { CLAUDE_CODE_DISABLE_TERMINAL_TITLE: "0" } });
  assert.ok((await cal.runOneNext(root, deps)).faults.includes("manifest-child-env-overrides"));

  reseal(root, { ...original, sources: { ...original.sources, [cal.CASES_RELATIVE_PATH]: "0".repeat(64) } });
  assert.deepStrictEqual((await cal.runOneNext(root, deps)).faults, [`source-drift:${cal.CASES_RELATIVE_PATH}`]);

  reseal(root, original);
  fs.writeFileSync(cli.command, "// upgraded\n", "utf8");
  assert.ok((await cal.runOneNext(root, deps)).faults.includes("cli-command-drift"));
});

test("summarize: refuses an incomplete batch and reports identities, fees and the limited claim", async () => {
  const fake = makeFake();
  const { root, deps, manifest } = prepareRoot(fake);
  assert.ok(cal.summarize(root, deps).faults.some((fault) => fault.startsWith("incomplete:0/4")));

  await runAll(root, fake, deps);
  const summary = cal.summarize(root, deps);
  assert.strictEqual(summary.ok, true, JSON.stringify(summary.faults));
  assert.strictEqual(summary.casesSha256, cal.CASES_SHA256);
  assert.strictEqual(summary.judgeSystemPromptSha256, manifest.judgeSystemPromptSha256);
  assert.deepStrictEqual(summary.permissionMode, { requested: "manual", observed: "default" });
  assert.strictEqual(summary.rows.length, 4);
  assert.strictEqual(new Set(summary.rows.map((row) => row.sessionId)).size, 4, "single-use sessions");
  for (const row of summary.rows) {
    assert.ok(row.rationale && row.rationale.length > 0);
    assert.strictEqual(row.stdoutSha256.length, 64);
  }
  assert.strictEqual(summary.sourcePaths.cases, cal.CASES_RELATIVE_PATH);
  assert.ok(!JSON.stringify(summary).includes("CLAUDE_CODE_DISABLE_TERMINAL_TITLE\":\"0\""));
});

// ------------------------------------------------------------------------------------ hygiene

test("cli: only the three fixed commands and their own options are accepted", () => {
  assert.deepStrictEqual(Object.keys(cal.COMMAND_OPTIONS).sort(), ["prepare", "run-one-next", "summarize"]);
  assert.strictEqual(cal.parseArgs(["summarize", "--root", "/tmp/x"]).options.root, "/tmp/x");
  assert.throws(() => cal.parseArgs(["prepare", "--model", "other"]), /unknown option --model for prepare/);
  assert.throws(() => cal.parseArgs(["prepare", "--per-call-usd", "5"]), /unknown option --per-call-usd/);
  assert.throws(() => cal.parseArgs(["run-one-next", "--root", "/a", "--root", "/b"]), /duplicate option --root/);
  assert.throws(() => cal.parseArgs(["summarize", "bare"]), /unexpected argument/);
});

test("module: importing performs no I/O and creates no experiment root", async () => {
  const tmp = fs.realpathSync(os.tmpdir());
  const before = fs.readdirSync(tmp).filter((name) => name.startsWith(cal.CAL_ROOT_PREFIX)).length;
  const fresh = await import("../eval/efficiency/judge-calibration.mjs?purity=1");
  const after = fs.readdirSync(tmp).filter((name) => name.startsWith(cal.CAL_ROOT_PREFIX)).length;
  assert.strictEqual(after, before);
  assert.strictEqual(typeof fresh.main, "function");
  assert.strictEqual(typeof fresh.prepare, "function");
});
