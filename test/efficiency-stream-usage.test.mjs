// Adverse-shape oracle for eval/efficiency/stream-usage.mjs — the offline transcript parser the
// L1b driver depends on for call accounting. The parser is pure, so every case here is a literal
// transcript string; nothing spawns a process and no model is simulated. Every literal is
// embedded in this file, so the suite runs in a clean verification checkout.
//
// Three invariants carry most of the weight: (1) the record is METADATA ONLY, so assistant text,
// tool inputs and the final result string must never appear in it; (2) `usage` (main loop) and
// `modelUsage` (whole query, including children) have DIFFERENT SCOPES, so a generic parse must
// not fault when they diverge; and (3) `subagent_stats` is a set of OVERLAPPING NAMED COUNTERS —
// `spawned` alone is the child count, and unknown is never zero.
import { test } from "node:test";
import assert from "node:assert";
import {
  parseStream,
  strictZeroChildFaults,
  initFaults,
  splitJsonLines,
  readSubagentStats,
} from "../eval/efficiency/stream-usage.mjs";

const SESSION = "11111111-2222-3333-4444-555555555555";
const MODEL = "claude-opus-5";
const SECRET_TEXT = "SECRET-ANALYSIS-PROSE";
const SECRET_INPUT = "/secret/path/answer.txt";
const FINAL_TEXT = "FINAL-REVIEW-TEXT";

// The real CLI 2.1.263 zero-child aggregate, copied verbatim from the metadata-only field
// observation. It has TEN top-level keys, which is exactly why counting `Object.keys` read a
// genuine zero-child run as ten children.
const OBSERVED_ZERO_SUBAGENT_STATS = Object.freeze({
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

function transcript(events) {
  return events.map((event) => JSON.stringify(event)).join("\n") + "\n";
}

function init(overrides = {}) {
  return {
    type: "system", subtype: "init", session_id: SESSION, model: MODEL,
    tools: ["Read", "Grep", "Glob"], mcp_servers: [], slash_commands: [], plugins: [], agents: [],
    permissionMode: "default", cwd: "/tmp/ctide-eff-work-x", ...overrides,
  };
}

function assistant(overrides = {}) {
  return {
    type: "assistant", session_id: SESSION, parent_tool_use_id: null,
    message: { id: "msg_1", content: [{ type: "text", text: SECRET_TEXT }], usage: { output_tokens: 10 } },
    ...overrides,
  };
}

function result(overrides = {}) {
  return {
    type: "result", subtype: "success", is_error: false, session_id: SESSION,
    duration_ms: 1000, duration_api_ms: 900, num_turns: 1, total_cost_usd: 0.125,
    result: FINAL_TEXT, permission_denials: [],
    subagent_stats: OBSERVED_ZERO_SUBAGENT_STATS,
    usage: {
      input_tokens: 5, cache_creation_input_tokens: 100,
      cache_read_input_tokens: 200, output_tokens: 300,
    },
    modelUsage: {
      [MODEL]: {
        inputTokens: 5, cacheCreationInputTokens: 100, cacheReadInputTokens: 200,
        outputTokens: 300, costUSD: 0.125, costBasis: "list", provider: "firstParty",
      },
    },
    ...overrides,
  };
}

const HAPPY = transcript([init(), assistant(), result()]);
const STRICT = { expectedModel: MODEL };
const EXPECT_REVIEWER = { model: MODEL, tools: ["Read", "Grep", "Glob"] };

test("parser: a well-formed single-session transcript is ok and keeps the two usage surfaces apart", () => {
  const record = parseStream(HAPPY);
  assert.deepStrictEqual(record.faults, []);
  assert.strictEqual(record.ok, true);
  assert.strictEqual(record.sessionId, SESSION);
  assert.strictEqual(record.result.totalCostUsd, 0.125);
  assert.strictEqual(record.result.costBasis, "cli-bundled-price-table-estimate");
  assert.strictEqual(record.result.usage.cacheReadInputTokens, 200);
  assert.strictEqual(record.result.modelUsage[MODEL].cacheReadInputTokens, 200);
  assert.strictEqual(record.result.modelUsage[MODEL].provider, "firstParty");
  assert.strictEqual(record.childActivity, false);
  assert.strictEqual(record.childAttribution, "unsupported");
});

// ------------------------------------------------------------------------ subagent counters

test("subagent: the real all-zero aggregate is zero children, not ten", () => {
  assert.strictEqual(Object.keys(OBSERVED_ZERO_SUBAGENT_STATS).length, 10,
    "the observed shape has ten top-level keys — key counting is not a child count");
  const record = parseStream(HAPPY);
  assert.strictEqual(record.result.subagent.evidence, "counters");
  assert.strictEqual(record.result.subagent.spawned, 0);
  assert.strictEqual(record.result.subagent.activity, false);
  assert.strictEqual(record.childActivity, false);
  assert.deepStrictEqual(strictZeroChildFaults(record, STRICT), []);
});

test("subagent: `spawned` alone is the child count and counters are never summed", () => {
  const stats = { ...OBSERVED_ZERO_SUBAGENT_STATS, spawned: 2, completed: 3, failed: 4 };
  const record = parseStream(transcript([init(), result({ subagent_stats: stats })]));
  assert.strictEqual(record.result.subagent.spawned, 2, "9 would mean overlapping counters were summed");
  const strict = strictZeroChildFaults(record, STRICT);
  assert.ok(strict.includes("strict-subagent-spawned:2"));
  assert.ok(strict.includes("strict-child-activity"));
});

test("subagent: a nonzero refused/killed counter is activity but never a spawned child", () => {
  const stats = {
    ...OBSERVED_ZERO_SUBAGENT_STATS,
    refused: { depth_limit: 0, concurrency_limit: 0, budget: 2 },
    killed: { parent: 1, user: 0, system: 0 },
  };
  const record = parseStream(transcript([init(), result({ subagent_stats: stats })]));
  assert.strictEqual(record.result.subagent.spawned, 0);
  assert.strictEqual(record.result.subagent.activity, true);
  const strict = strictZeroChildFaults(record, STRICT);
  assert.ok(strict.includes("strict-child-activity"));
  assert.ok(!strict.some((fault) => fault.startsWith("strict-subagent-spawned:")),
    "a refused or killed request must not be reported as a spawned child");
});

test("subagent: a non-empty by_type is child activity", () => {
  const stats = { ...OBSERVED_ZERO_SUBAGENT_STATS, by_type: { "code-reviewer": 1 } };
  const record = parseStream(transcript([init(), result({ subagent_stats: stats })]));
  assert.deepStrictEqual(record.result.subagent.byTypeKeys, ["code-reviewer"]);
  assert.strictEqual(record.childActivity, true);
});

test("subagent: absent is unknown-but-tolerated; an unrecognized shape is an explicit fault", () => {
  const absent = parseStream(transcript([init(), result({ subagent_stats: undefined })]));
  assert.strictEqual(absent.result.subagent.evidence, "absent");
  assert.strictEqual(absent.result.subagent.spawned, null, "absent must never read as zero");
  assert.strictEqual(absent.childActivity, false);
  assert.deepStrictEqual(strictZeroChildFaults(absent, STRICT), []);

  for (const shape of [5, "none", { totally: "different" }]) {
    const record = parseStream(transcript([init(), result({ subagent_stats: shape })]));
    assert.strictEqual(record.result.subagent.evidence, "unrecognized", JSON.stringify(shape));
    assert.ok(strictZeroChildFaults(record, STRICT).includes("strict-subagent-stats-unrecognized"));
  }
});

test("subagent: a present-but-unreadable `spawned` is unknown, not zero", () => {
  const stats = { ...OBSERVED_ZERO_SUBAGENT_STATS, spawned: -1 };
  const record = parseStream(transcript([init(), result({ subagent_stats: stats })]));
  assert.strictEqual(record.result.subagent.spawned, null);
  assert.ok(record.faults.includes("negative:subagent_stats.spawned"));
  assert.ok(strictZeroChildFaults(record, STRICT).includes("strict-subagent-spawned-unknown"));
});

test("readSubagentStats is directly usable and reports its own faults", () => {
  const faults = [];
  const parsed = readSubagentStats(OBSERVED_ZERO_SUBAGENT_STATS, faults);
  assert.deepStrictEqual(faults, []);
  assert.strictEqual(parsed.counters["requested.background"], 0);
  assert.strictEqual(parsed.counters["refused.budget"], 0);
  assert.deepStrictEqual(parsed.byTypeKeys, []);
});

// -------------------------------------------------------------------------------- metadata only

test("parser: the record carries no transcript text, no result text and no tool input", () => {
  const withTool = transcript([
    init(),
    assistant({
      message: {
        id: "msg_1",
        content: [
          { type: "text", text: SECRET_TEXT },
          { type: "tool_use", name: "Read", input: { file_path: SECRET_INPUT } },
        ],
        usage: { output_tokens: 10 },
      },
    }),
    result(),
  ]);
  const record = parseStream(withTool);
  const serialized = JSON.stringify(record);
  assert.ok(!serialized.includes(SECRET_TEXT), "assistant prose leaked into the record");
  assert.ok(!serialized.includes(SECRET_INPUT), "tool input leaked into the record");
  assert.ok(!serialized.includes(FINAL_TEXT), "final result text leaked into the record");
  assert.deepStrictEqual(record.observedTools, ["Read"]);
});

// ------------------------------------------------------------------------------ terminal shapes

test("parser: duplicate terminal blocks success but keeps the cost that is known", () => {
  const record = parseStream(transcript([init(), assistant(), result(), result()]));
  assert.strictEqual(record.ok, false);
  assert.ok(record.faults.includes("duplicate-result"));
  assert.ok(record.faults.includes("events-after-result"));
  assert.strictEqual(record.result.totalCostUsd, 0.125);
});

test("parser: duplicate init, missing init and missing result each block success", () => {
  assert.ok(parseStream(transcript([init(), init(), result()])).faults.includes("duplicate-init"));
  assert.ok(parseStream(transcript([assistant(), result()])).faults.includes("missing-init"));
  const noResult = parseStream(transcript([init(), assistant()]));
  assert.ok(noResult.faults.includes("missing-result"));
  assert.strictEqual(noResult.ok, false);
  assert.strictEqual(noResult.result, null);
});

test("parser: a second session id in the stream is a fault", () => {
  const record = parseStream(transcript([init(), assistant({ session_id: "other" }), result()]));
  assert.ok(record.faults.includes("session-id-inconsistent"));
  assert.strictEqual(record.sessionId, null);
});

test("parser: an error terminal blocks success and preserves the recorded cost", () => {
  const record = parseStream(transcript([
    init(),
    result({ subtype: "error_during_execution", is_error: true, total_cost_usd: 0.4 }),
  ]));
  assert.strictEqual(record.ok, false);
  assert.ok(record.faults.includes("result-is-error"));
  assert.ok(record.faults.includes("result-subtype-not-success"));
  assert.strictEqual(record.result.totalCostUsd, 0.4);
});

test("parser: a malformed line is reported, not silently dropped", () => {
  const record = parseStream(`${JSON.stringify(init())}\nnot-json\n[1,2,3]\n${JSON.stringify(result())}\n`);
  assert.ok(record.faults.includes("malformed-json-line"));
  assert.strictEqual(record.malformedLines, 2);
});

// ----------------------------------------------------------------------------------- numerics

test("parser: a missing numeric is null and never zero; a negative one is null plus a fault", () => {
  const missing = parseStream(transcript([init(), result({ usage: { input_tokens: 5 } })]));
  assert.strictEqual(missing.result.usage.inputTokens, 5);
  assert.strictEqual(missing.result.usage.outputTokens, null);
  assert.strictEqual(missing.result.usage.cacheReadInputTokens, null);

  const negative = parseStream(transcript([
    init(),
    result({ usage: { input_tokens: -1, cache_creation_input_tokens: 0, cache_read_input_tokens: 2.5, output_tokens: 3 } }),
  ]));
  assert.strictEqual(negative.result.usage.inputTokens, null);
  assert.strictEqual(negative.result.usage.cacheCreationInputTokens, 0, "a real measured zero survives");
  assert.strictEqual(negative.result.usage.cacheReadInputTokens, null);
  // Fault labels use the record's canonical camelCase key, not the wire alias.
  assert.ok(negative.faults.includes("negative:result.usage.inputTokens"));
  assert.ok(negative.faults.includes("non-integer:result.usage.cacheReadInputTokens"));
});

test("parser: a missing total cost is null, so an unknown cost can never read as free", () => {
  const record = parseStream(transcript([init(), result({ total_cost_usd: undefined })]));
  assert.strictEqual(record.result.totalCostUsd, null);
});

test("parser: repeated assistant message ids are grouped, never summed", () => {
  const record = parseStream(transcript([
    init(),
    assistant({ message: { id: "msg_1", content: [], usage: { output_tokens: 10 } } }),
    assistant({ message: { id: "msg_1", content: [], usage: { output_tokens: 25 } } }),
    assistant({ message: { id: "msg_2", content: [], usage: { output_tokens: 7 } } }),
    result(),
  ]));
  assert.strictEqual(record.assistantMessages.length, 2);
  const first = record.assistantMessages.find((entry) => entry.id === "msg_1");
  assert.strictEqual(first.samples, 2);
  assert.strictEqual(first.lastOutputTokens, 25, "35 would mean the placeholder chunks were summed");
  assert.strictEqual(record.result.usage.outputTokens, 300, "the final result stays authoritative");
});

test("parser: an invalid per-message placeholder never faults the record", () => {
  const record = parseStream(transcript([
    init(),
    assistant({ message: { id: "msg_1", content: [], usage: { output_tokens: -5 } } }),
    result(),
  ]));
  assert.deepStrictEqual(record.faults, []);
  assert.strictEqual(record.assistantMessages[0].lastOutputTokens, null);
});

// ------------------------------------------------------------------------------- strict profile

test("parser: child activity is detected from a parent id or a Task call", () => {
  assert.strictEqual(parseStream(transcript([init(), assistant({ parent_tool_use_id: "toolu_1" }), result()])).childActivity, true);
  const byTask = parseStream(transcript([
    init(),
    assistant({ message: { id: "m", content: [{ type: "tool_use", name: "Task", input: {} }], usage: {} } }),
    result(),
  ]));
  assert.strictEqual(byTask.childActivity, true);
});

test("scope: a usage/modelUsage divergence is NOT a generic fault, but IS a strict-profile fault", () => {
  // The phase18b shape: main-loop `usage` and whole-query `modelUsage` disagree. Per the
  // cost-tracking docs these measure different scopes, so the generic record stays ok.
  const record = parseStream(transcript([init(), result({
    usage: { input_tokens: 2, cache_creation_input_tokens: 23652, cache_read_input_tokens: 2800, output_tokens: 6286 },
    modelUsage: {
      [MODEL]: {
        inputTokens: 3566, cacheCreationInputTokens: 24938, cacheReadInputTokens: 966506,
        outputTokens: 16880, costUSD: 1.1676405,
      },
    },
  })]));
  assert.deepStrictEqual(record.faults, [], "scope divergence must not fault a generic parse");
  assert.strictEqual(record.ok, true);

  const strict = strictZeroChildFaults(record, STRICT);
  assert.ok(strict.includes("strict-scope-mismatch:cacheReadInputTokens"));
  assert.ok(strict.includes("strict-scope-mismatch:outputTokens"));
});

test("strict profile: an unexpected or extra model key is rejected", () => {
  const record = parseStream(transcript([init(), result({
    modelUsage: {
      [MODEL]: { inputTokens: 5, cacheCreationInputTokens: 100, cacheReadInputTokens: 200, outputTokens: 300 },
      "claude-haiku-4-5-20251001": { inputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, outputTokens: 1 },
    },
  })]));
  const strict = strictZeroChildFaults(record, STRICT);
  assert.ok(strict.includes("strict-multiple-models"));
  assert.ok(strict.includes("strict-unexpected-model:claude-haiku-4-5-20251001"));
});

test("strict profile: an unmeasurable field is incomparable, not equal", () => {
  const strict = strictZeroChildFaults(parseStream(transcript([init(), result({ usage: { input_tokens: 5 } })])), STRICT);
  assert.ok(strict.includes("strict-incomparable:outputTokens"));
  assert.ok(!strict.includes("strict-scope-mismatch:outputTokens"), "null must not be compared as a value");
});

test("strict profile: a record with no result yields a single explicit fault", () => {
  assert.deepStrictEqual(strictZeroChildFaults(parseStream(""), {}), ["strict-no-result"]);
  assert.deepStrictEqual(strictZeroChildFaults(null, {}), ["strict-no-result"]);
});

// ---------------------------------------------------------------------------------- init check

test("init check: a clean init satisfies the frozen expectation", () => {
  assert.deepStrictEqual(initFaults(parseStream(HAPPY), EXPECT_REVIEWER), []);
});

test("init check: every required field must be PRESENT — absence never passes silently", () => {
  for (const [field, expectedFault] of [
    ["model", "init-model-missing"],
    ["tools", "init-tools-missing"],
    ["mcp_servers", "init-mcp-missing"],
    ["slash_commands", "init-slash-commands-missing"],
    ["plugins", "init-plugins-missing"],
  ]) {
    const stripped = init();
    delete stripped[field];
    const record = parseStream(transcript([stripped, result()]));
    assert.ok(initFaults(record, EXPECT_REVIEWER).includes(expectedFault), field);
  }
  const bare = parseStream(transcript([{ type: "system", subtype: "init", session_id: SESSION }, result()]));
  const faults = initFaults(bare, EXPECT_REVIEWER);
  assert.strictEqual(faults.length, 5, "a bare init must fault on every required field");
});

test("init check: an unexpected tool, model, plugin, MCP server or slash command is caught", () => {
  const withBash = parseStream(transcript([init({ tools: ["Read", "Grep", "Glob", "Bash"] }), result()]));
  assert.ok(initFaults(withBash, EXPECT_REVIEWER).includes("init-unexpected-tool:Bash"));

  const wrongModel = parseStream(transcript([init({ model: "claude-sonnet-5" }), result()]));
  assert.ok(initFaults(wrongModel, EXPECT_REVIEWER).includes("init-model:claude-sonnet-5"));

  const loaded = parseStream(transcript([
    init({ mcp_servers: [{ name: "github", status: "connected" }], slash_commands: ["review"], plugins: ["cressetide"] }),
    result(),
  ]));
  const faults = initFaults(loaded, EXPECT_REVIEWER);
  assert.ok(faults.includes("init-mcp-not-empty"));
  assert.ok(faults.includes("init-slash-commands-not-empty"));
  assert.ok(faults.includes("init-plugins-not-empty"));
});

test("init check: a tool actually used but absent from the declared surface is caught", () => {
  const record = parseStream(transcript([
    init(),
    assistant({ message: { id: "m", content: [{ type: "tool_use", name: "Bash", input: { command: "rm -rf /" } }], usage: {} } }),
    result(),
  ]));
  assert.ok(initFaults(record, EXPECT_REVIEWER).includes("observed-unexpected-tool:Bash"));
  assert.ok(!JSON.stringify(record).includes("rm -rf"), "command content must never reach the record");
});

test("init check: the judge surface tolerates only the StructuredOutput carrier", () => {
  const judge = parseStream(transcript([init({ tools: ["StructuredOutput"] }), result()]));
  assert.deepStrictEqual(initFaults(judge, { model: MODEL, tools: ["StructuredOutput"] }), []);
  const empty = parseStream(transcript([init({ tools: [] }), result()]));
  assert.deepStrictEqual(initFaults(empty, { model: MODEL, tools: ["StructuredOutput"] }), []);
  const leaky = parseStream(transcript([init({ tools: ["StructuredOutput", "Read"] }), result()]));
  assert.ok(initFaults(leaky, { model: MODEL, tools: ["StructuredOutput"] }).includes("init-unexpected-tool:Read"));
});

test("init check: the observed canonical permission mode is checked only when pinned", () => {
  // `manual` is the requested CLI alias; `default` is the canonical mode the runtime reports.
  const pinned = { ...EXPECT_REVIEWER, permissionMode: "default" };
  assert.deepStrictEqual(initFaults(parseStream(HAPPY), pinned), []);

  const aliasEcho = parseStream(transcript([init({ permissionMode: "manual" }), result()]));
  assert.ok(initFaults(aliasEcho, pinned).includes("init-permission-mode:manual"));
  assert.ok(initFaults(aliasEcho, EXPECT_REVIEWER).length === 0, "unpinned callers are unaffected");

  const stripped = init();
  delete stripped.permissionMode;
  const missing = parseStream(transcript([stripped, result()]));
  assert.ok(initFaults(missing, pinned).includes("init-permission-mode-missing"));
  assert.deepStrictEqual(initFaults(missing, EXPECT_REVIEWER), []);
});

test("init check: a malformed required list is unrecognized, never an apparently empty surface", () => {
  const record = parseStream(transcript([
    init({ tools: [{}], plugins: [null], mcp_servers: [1], slash_commands: [{}] }),
    result(),
  ]));
  assert.strictEqual(record.init.tools, "unrecognized", "a list with an unreadable element is not []");
  const faults = initFaults(record, EXPECT_REVIEWER);
  assert.ok(faults.includes("init-tools-unrecognized"));
  assert.ok(faults.includes("init-plugins-unrecognized"));
  assert.ok(faults.includes("init-mcp-unrecognized"));
  assert.ok(faults.includes("init-slash-commands-unrecognized"));
  assert.ok(!faults.some((fault) => fault.endsWith("-not-empty")), "unknown must not read as deliberately empty");
});

test("session binding: init and the terminal must each carry their own matching id", () => {
  const noInitId = init();
  delete noInitId.session_id;
  const initless = parseStream(transcript([noInitId, result()]));
  assert.ok(initless.faults.includes("init-session-id-missing"));
  assert.strictEqual(initless.sessionId, null, "the terminal's id must not be lent to init");
  assert.strictEqual(initless.ok, false);

  const noResultId = result();
  delete noResultId.session_id;
  const terminalless = parseStream(transcript([init(), noResultId]));
  assert.ok(terminalless.faults.includes("result-session-id-missing"));
  assert.strictEqual(terminalless.sessionId, null, "the terminal must not be attributed from init");
  assert.strictEqual(terminalless.ok, false);

  // An auxiliary event without an id is fine; the two required events still bind the session.
  const auxiliary = parseStream(transcript([init(), { type: "stats", note: "no session id" }, result()]));
  assert.deepStrictEqual(auxiliary.faults, []);
  assert.strictEqual(auxiliary.sessionId, SESSION);
});

test("init check: a transcript without an init event says so rather than passing vacuously", () => {
  assert.deepStrictEqual(initFaults(parseStream(transcript([result()])), EXPECT_REVIEWER), ["init-missing"]);
});

test("splitJsonLines tolerates CRLF and blank lines", () => {
  const { events, malformed } = splitJsonLines(`${JSON.stringify(init())}\r\n\r\n${JSON.stringify(result())}\r\n`);
  assert.strictEqual(events.length, 2);
  assert.strictEqual(malformed, 0);
});
