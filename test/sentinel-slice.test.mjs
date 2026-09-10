// Hermetic tests for the E2E harness's byte-exact sentinel slicer.
//
// NO MODEL, NO NETWORK. Covers pure helpers and local Node child processes with no reviewer or
// provider invocation. Each child runs a bare `process.execPath` with `shell: false`. The harness
// stage that actually spawns a real `test-reviewer` process lives in
// `eval/loop-e2e/run-scenario.mjs` and is never reachable from here.
//
// The slicer assertions below are on BYTES. Parsing the slice as JSON would test a different
// property than the transport contract, which is about a byte range surviving unchanged — so the
// negatives are framed as boundary shifts (one byte more, one byte fewer, wrong terminator
// retained), and one case deliberately carries a slice that is neither JSON nor valid UTF-8 to prove
// nothing ever decodes.
import assert from "node:assert/strict";
import cp from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  FAULT_KINDS, FAULT_PRECEDENCE, SENTINEL_BEGIN, SENTINEL_END, scanLines, sliceReviewBatch,
} from "../eval/loop-e2e/sentinel-slice.mjs";
// Pure exports only. Importing this module runs nothing — its `main` sits behind a direct-invocation
// guard — so no stage, process or model is reachable from here.
import {
  INCOMPLETE_OUTCOME, INGEST_FAULT_CLASSES, REQUIRED_HISTORY, REVIEWER_AVAILABLE_TOOLS,
  REVIEWER_BASH_RULES, REVIEWER_MCP_CONFIG, REVIEWER_TOOLS, TERMINAL_OUTCOMES, attemptBlockedReason,
  auditClosureProblems, auditInstabilityFault, auditManifestOf, auditSnapshot, buildHookSettings, buildPacket,
  listAuditDirectory, requiredInvokeCount,
  captureBindingFault, classifyIngestFault, continuableFault, gateBlockedReason, hookCommandFault,
  incompleteAttempts, invokeBlockedReason, nextRequiredStep, parseSingleLedgerRecord, prefixGuardFault,
  readNewAuditRecords, removeReviewFile, reviewCleanupFault, reviewerArgv, selectInvokeForIngest,
  singleLedgerRecordFault, terminalFailure, unsafeAuditName, validateHistory, validateInvokeAudit,
  verifyAuditManifest,
} from "../eval/loop-e2e/run-scenario.mjs";
import {
  ALLOWED_COMMANDS, AUDIT_KIND, DECISION_DENY, DECISION_IGNORE, DECISION_PASS, configFault, decide,
  denyPayload, readStreamWithTimeout, sameResolvedRoot,
} from "../eval/loop-e2e/bash-guard.mjs";
import { PassThrough } from "node:stream";

const B = SENTINEL_BEGIN;
const E = SENTINEL_END;
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const buf = (...parts) => Buffer.concat(parts.map(p => (Buffer.isBuffer(p) ? p : Buffer.from(p, "utf8"))));
const ok = captured => {
  const result = sliceReviewBatch(captured);
  assert.equal(result.ok, true, `expected a slice, got ${result.ok === false ? result.kind : "?"}`);
  return result;
};
const bad = (captured, kind) => {
  const result = sliceReviewBatch(captured);
  assert.equal(result.ok, false, "expected a fault");
  assert.equal(result.kind, kind);
  return result;
};

test("sentinel-slice: the fault vocabulary is the closed contract set, in a declared precedence", () => {
  assert.deepEqual([...FAULT_KINDS], ["duplicated", "missing", "misordered", "empty"]);
  assert.deepEqual([...FAULT_PRECEDENCE], [...FAULT_KINDS]);
  // No BOM kind: review-packet.md:174's list has four members and a BOM is not one of them.
  assert.ok(!FAULT_KINDS.includes("bom"));
});

test("sentinel-slice: refuses a decoded response outright", () => {
  assert.throws(() => sliceReviewBatch(`${B}\n{}\n${E}\n`), /undecoded|takes a Buffer/);
});

// --- positives -------------------------------------------------------------------------------------

test("sentinel-slice: LF response yields exactly the interior bytes", () => {
  const body = '{"taskId":"T"}';
  const result = ok(buf("prose before\n", B, "\n", body, "\n", E, "\nprose after\n"));
  assert.deepEqual(result.slice, Buffer.from(body, "utf8"));
  // Boundaries, not content: the QA prose on both sides is excluded byte-exactly.
  assert.equal(result.slice.length, body.length);
});

test("sentinel-slice: CRLF response does not retain the terminator preceding END", () => {
  const body = '{"taskId":"T"}';
  const result = ok(buf(B, "\r\n", body, "\r\n", E, "\r\n"));
  assert.deepEqual(result.slice, Buffer.from(body, "utf8"));
  assert.notEqual(result.slice[result.slice.length - 1], 0x0d);
  assert.notEqual(result.slice[result.slice.length - 1], 0x0a);
});

test("sentinel-slice: interior newline forms and whitespace are preserved verbatim", () => {
  // Deliberately mixed: CRLF inside, a bare LF inside, tabs, double spaces, a trailing space.
  const body = Buffer.from('  {\r\n\t"a" :  1 ,\n  "b":2}  ', "utf8");
  const result = ok(buf(B, "\n", body, "\n", E, "\n"));
  assert.deepEqual(result.slice, body);
});

test("sentinel-slice: a BOM inside the slice is preserved byte-identically", () => {
  const body = buf(BOM, '{"a":1}');
  const result = ok(buf(B, "\n", body, "\n", E, "\n"));
  assert.deepEqual(result.slice, body);
  assert.deepEqual(result.slice.subarray(0, 3), BOM, "the BOM must survive: removing it is forbidden");
});

test("sentinel-slice: the slice is never parsed or decoded — arbitrary bytes survive", () => {
  // Not JSON, and deliberately not valid UTF-8 either: a lone 0x80 continuation byte, 0xFF, a NUL and
  // a dangling 0xC3 lead byte. Any decode on the way through would replace these, so a byte-identical
  // round trip is positive proof that nothing decodes.
  const body = Buffer.concat([
    Buffer.from("this is not JSON at all { [ ", "utf8"),
    Buffer.from([0x80, 0xff, 0x00, 0xc3]),
  ]);
  const result = ok(buf(B, "\n", body, "\n", E, "\n"));
  assert.deepEqual(result.slice, body);
  assert.equal(result.slice[result.slice.length - 1], 0xc3);
});

test("sentinel-slice: an END with no trailing terminator still closes the slice", () => {
  const body = '{"a":1}';
  const result = ok(buf(B, "\n", body, "\n", E));
  assert.deepEqual(result.slice, Buffer.from(body, "utf8"));
});

test("sentinel-slice: the returned slice is a copy, not a view over the capture", () => {
  const captured = buf(B, "\n", '{"a":1}', "\n", E, "\n");
  const result = ok(captured);
  const before = Buffer.from(result.slice);
  captured[result.from] = 0x58; // mutate the capture under the slice's former window
  assert.deepEqual(result.slice, before, "a view would have changed with the capture");
});

// --- byte-boundary mutants (the point of the suite) -------------------------------------------------

test("sentinel-slice: adding one interior byte moves the boundary by exactly one", () => {
  const base = ok(buf(B, "\n", '{"a":1}', "\n", E, "\n"));
  const wider = ok(buf(B, "\n", '{"a":11}', "\n", E, "\n"));
  assert.equal(wider.slice.length, base.slice.length + 1);
  assert.equal(wider.to - wider.from, wider.slice.length);
});

test("sentinel-slice: an interior blank line is content, not a terminator to absorb", () => {
  const body = Buffer.from('{"a":1}\n\n{"b":2}', "utf8");
  const result = ok(buf(B, "\n", body, "\n", E, "\n"));
  assert.deepEqual(result.slice, body);
  // Off-by-one guard: only the ONE terminator immediately preceding END is dropped.
  assert.equal(result.slice[result.slice.length - 1], 0x7d);
});

test("sentinel-slice: a line that merely CONTAINS a token is not a sentinel", () => {
  bad(buf("x", B, "\n", '{"a":1}', "\n", E, "\n"), "missing");
  bad(buf(B, " \n", '{"a":1}', "\n", E, "\n"), "missing");   // trailing space after the token
  bad(buf(" ", B, "\n", '{"a":1}', "\n", E, "\n"), "missing"); // leading space before the token
});

test("sentinel-slice: a BOM before BEGIN makes the line non-exact, so BEGIN is missing", () => {
  const result = bad(buf(BOM, B, "\n", '{"a":1}', "\n", E, "\n"), "missing");
  assert.equal(result.detail.counts.begin, 0);
  assert.equal(result.detail.counts.end, 1);
});

// --- the four contract faults ----------------------------------------------------------------------

test("sentinel-slice: a missing BEGIN or a missing END is `missing`", () => {
  assert.equal(bad(buf('{"a":1}', "\n", E, "\n"), "missing").detail.counts.begin, 0);
  assert.equal(bad(buf(B, "\n", '{"a":1}', "\n"), "missing").detail.counts.end, 0);
  bad(Buffer.alloc(0), "missing");
});

test("sentinel-slice: a duplicated BEGIN or END is `duplicated`", () => {
  const dupBegin = bad(buf(B, "\n", B, "\n", '{"a":1}', "\n", E, "\n"), "duplicated");
  assert.deepEqual(dupBegin.detail.counts, { begin: 2, end: 1 });
  const dupEnd = bad(buf(B, "\n", '{"a":1}', "\n", E, "\n", E, "\n"), "duplicated");
  assert.deepEqual(dupEnd.detail.counts, { begin: 1, end: 2 });
});

test("sentinel-slice: END before BEGIN is `misordered`", () => {
  const result = bad(buf(E, "\n", '{"a":1}', "\n", B, "\n"), "misordered");
  assert.ok(result.detail.endLines[0] < result.detail.beginLines[0]);
});

test("sentinel-slice: adjacent sentinels and a lone blank interior line are both `empty`", () => {
  bad(buf(B, "\n", E, "\n"), "empty");
  bad(buf(B, "\r\n", E, "\r\n"), "empty");
  bad(buf(B, "\n", "\n", E, "\n"), "empty");
});

test("sentinel-slice: precedence is declared and carries both counts when faults overlap", () => {
  // Duplicated BEGIN and a wholly absent END: both descriptions are true. `duplicated` wins, and the
  // detail still reports end:0 so nothing is hidden by the choice.
  const result = bad(buf(B, "\n", B, "\n", '{"a":1}', "\n"), "duplicated");
  assert.deepEqual(result.detail.counts, { begin: 2, end: 0 });
});

// --- the line scanner itself ------------------------------------------------------------------------

test("sentinel-slice: scanLines reports terminator widths without decoding", () => {
  const lines = scanLines(buf("a\r\n", "b\n", "c"));
  assert.deepEqual(lines.map(l => l.termLen), [2, 1, 0]);
  assert.deepEqual(lines.map(l => l.contentEnd - l.start), [1, 1, 1]);
  assert.deepEqual(scanLines(Buffer.alloc(0)), []);
});

// ======================================================================================================
// The harness driver's PURE invariants.
//
// Importing `run-scenario.mjs` runs nothing (its `main` is behind a direct-invocation guard), and
// every function exercised below is a pure function over plain data. No model, no network, no shell,
// no filesystem: this file stays safe under `node --test`.
// ======================================================================================================

const HARNESS_ARGV = reviewerArgv({
  pluginDir: "/plugin/cressetide", sessionId: "11111111-2222-4333-8444-555555555555", cwd: "/tmp/ctide-e2e-x",
  settingsPath: "/tmp/ctide-e2eh-x/settings.json",
});

test("harness argv: MCP is explicitly empty rather than merely omitted", () => {
  assert.ok(HARNESS_ARGV.includes("--strict-mcp-config"));
  const at = HARNESS_ARGV.indexOf("--mcp-config");
  assert.notEqual(at, -1, "the empty MCP configuration must be passed explicitly");
  assert.equal(HARNESS_ARGV[at + 1], REVIEWER_MCP_CONFIG);
  assert.deepEqual(JSON.parse(REVIEWER_MCP_CONFIG), { mcpServers: {} });
});

test("harness argv: exactly two no-wildcard Bash rules, both confined to the scenario test file", () => {
  assert.ok(!REVIEWER_TOOLS.includes("Bash"), "blanket Bash must never be granted");
  assert.deepEqual([...REVIEWER_TOOLS], [
    "Read", "Grep", "Glob",
    "Bash(git diff --no-ext-diff --no-textconv -- test/alpha.test.mjs)",
    "Bash(node --test test/alpha.test.mjs)",
  ]);
  assert.deepEqual([...REVIEWER_BASH_RULES], ALLOWED_COMMANDS.map(c => `Bash(${c})`));
  // `--no-ext-diff --no-textconv` are load-bearing: without them `git diff` can invoke an external
  // diff driver or textconv filter from a global gitconfig, running code exact matching cannot see.
  assert.match(ALLOWED_COMMANDS[0], /^git diff --no-ext-diff --no-textconv -- /);
  // No editor tool may appear anywhere in the argv, under any spelling.
  for (const forbidden of ["Edit", "Write", "NotebookEdit", "MultiEdit"]) {
    assert.ok(!HARNESS_ARGV.some(a => a.includes(forbidden)), `${forbidden} must not be reachable`);
  }
  // NO WILDCARD ANYWHERE. A prefix rule such as `Bash(rg:*)` or `Bash(git diff:*)` would accept
  // absolute paths outside the scenario repo — including the sibling harness root that holds prior
  // raw reviewer output — so a single `*` here is a containment regression, not a convenience.
  for (const rule of REVIEWER_BASH_RULES) {
    assert.ok(!rule.includes("*"), `${rule} carries a wildcard`);
    assert.ok(rule.includes("test/alpha.test.mjs"), `${rule} is not confined to the scenario test file`);
    assert.match(rule, /^Bash\([^*]+\)$/);
  }
  // The retired wildcard grants must not creep back under any spelling.
  for (const retired of ["Bash(rg:*)", "Bash(git log:*)", "Bash(git show:*)", "Bash(git diff:*)", "Bash(node --test:*)"]) {
    assert.ok(!REVIEWER_TOOLS.includes(retired), `${retired} was retired and must not return`);
  }
});

test("harness argv: the fixed safety flags are present and --allowed-tools comes last", () => {
  for (const expected of ["--print", "--no-chrome", "--output-format", "--permission-mode", "--strict-mcp-config"]) {
    assert.ok(HARNESS_ARGV.includes(expected), `${expected} must be present`);
  }
  assert.equal(HARNESS_ARGV[HARNESS_ARGV.indexOf("--permission-mode") + 1], "manual");
  assert.equal(HARNESS_ARGV[HARNESS_ARGV.indexOf("--output-format") + 1], "text");
  assert.equal(HARNESS_ARGV[HARNESS_ARGV.indexOf("--agent") + 1], "test-reviewer");
  // Variadic flag placed last so it cannot swallow a following flag.
  const allowedAt = HARNESS_ARGV.indexOf("--allowed-tools");
  assert.notEqual(allowedAt, -1);
  assert.deepEqual(HARNESS_ARGV.slice(allowedAt + 1), [...REVIEWER_TOOLS]);
  // Exactly one directory is exposed, and it is the isolated repo.
  assert.deepEqual(HARNESS_ARGV.filter(a => a === "--add-dir").length, 1);
  assert.equal(HARNESS_ARGV[HARNESS_ARGV.indexOf("--add-dir") + 1], "/tmp/ctide-e2e-x");
});

test("harness argv: restricted mode, no prompt delegation, and the explicit settings that carry the guard", () => {
  // Live probes showed --allowed-tools is not an exclusive Bash allowlist here, so the boundary now
  // rests on --restricted (file tools) plus a PreToolUse hook reached through --settings.
  assert.ok(HARNESS_ARGV.includes("--restricted"));
  assert.equal(HARNESS_ARGV[HARNESS_ARGV.indexOf("--permission-prompts") + 1], "none");
  assert.equal(HARNESS_ARGV[HARNESS_ARGV.indexOf("--settings") + 1], "/tmp/ctide-e2eh-x/settings.json");
  // `--tools` is ONE token and precedes the variadic `--allowed-tools`, so neither can absorb the other.
  const toolsAt = HARNESS_ARGV.indexOf("--tools");
  assert.equal(HARNESS_ARGV[toolsAt + 1], REVIEWER_AVAILABLE_TOOLS);
  assert.equal(REVIEWER_AVAILABLE_TOOLS, "Read,Grep,Glob,Bash");
  assert.ok(toolsAt < HARNESS_ARGV.indexOf("--allowed-tools"));
  assert.ok(HARNESS_ARGV[toolsAt + 2].startsWith("--"), "--tools must consume exactly one token");
  // Model/effort/agent/MCP boundaries are unchanged by the new flags.
  assert.equal(HARNESS_ARGV[HARNESS_ARGV.indexOf("--model") + 1], "claude-opus-5");
  assert.equal(HARNESS_ARGV[HARNESS_ARGV.indexOf("--effort") + 1], "xhigh");
  assert.ok(!HARNESS_ARGV.includes("--resume") && !HARNESS_ARGV.includes("--continue"));
  assert.throws(() => reviewerArgv({ pluginDir: "/p", sessionId: "s", cwd: "/c" }), /needs the absolute settings path/);
});

test("harness settings: one Bash-matched PreToolUse hook, with hostile paths refused not escaped", () => {
  const settings = buildHookSettings({ nodePath: "/usr/bin/node", guardPath: "/h/bash-guard.mjs", configPath: "/h/c.json" });
  assert.deepEqual(Object.keys(settings.hooks), ["PreToolUse"]);
  assert.equal(settings.hooks.PreToolUse.length, 1);
  assert.equal(settings.hooks.PreToolUse[0].matcher, "Bash", "a broader matcher would route Read/Grep/Glob here");
  assert.equal(settings.hooks.PreToolUse[0].hooks.length, 1);
  assert.equal(settings.hooks.PreToolUse[0].hooks[0].type, "command");
  assert.equal(settings.hooks.PreToolUse[0].hooks[0].command,
    '"/usr/bin/node" "/h/bash-guard.mjs" --config "/h/c.json"');
  // Controlled paths only: anything exotic means something is wrong, so it is refused.
  assert.equal(hookCommandFault("/h/guard.mjs"), null);
  assert.match(hookCommandFault(""), /empty/);
  assert.match(hookCommandFault("relative/path.mjs"), /not absolute/);
  for (const hostile of ['/h/a"b.mjs', "/h/a'b.mjs", "/h/a\nb.mjs", "/h/a\rb.mjs", "/h/a\u0000b.mjs"]) {
    assert.match(hookCommandFault(hostile), /quote, newline or NUL/, JSON.stringify(hostile));
  }
  // A SPACE must be accepted, not refused: `process.execPath` on Windows is routinely
  // `C:\Program Files\nodejs\node.exe`, and the surrounding double quotes are what handle it.
  // The path must be HOST-absolute — the validator uses host `path.isAbsolute` by contract, and
  // the harness only ever hands it host-controlled paths.
  const spacedAbsolute = process.platform === "win32"
    ? "C:\\Program Files\\nodejs\\node.exe"
    : "/opt/Program Files/nodejs/node";
  assert.equal(hookCommandFault(spacedAbsolute), null, "a space in a host-absolute path is quoted, not refused");
  // The complement, asserted one way only: a Windows drive path is correctly not absolute on POSIX,
  // and broadening the validator to accept foreign-platform absolutes would weaken a real guard.
  // The mirror does not hold — `path.win32.isAbsolute("/abs")` is true — so it is not asserted.
  if (process.platform !== "win32") {
    assert.match(hookCommandFault("C:\\Program Files\\nodejs\\node.exe"), /not absolute/, "a foreign Windows path is refused on POSIX");
  }
  assert.equal(hookCommandFault(process.execPath), null, "this machine's node path must be usable");
  assert.throws(() => buildHookSettings({ nodePath: "/usr/bin/node", guardPath: '/h/g"x.mjs', configPath: "/h/c.json" }),
    /guard: the path contains/);
});

// --- the ingestion source binding --------------------------------------------------------------------

const invokeEvent = (over = {}) => ({
  stage: "invoke", phase: "negative", sessionId: "s1", exitStatus: 0,
  stdoutFile: "/h/raw/s1.stdout", stdoutBytes: 12, stdoutDigest: "d".repeat(64), ...over,
});

test("ingest binding: exactly one successful unconsumed invoke is selectable", () => {
  const chosen = selectInvokeForIngest([invokeEvent()], "negative");
  assert.equal(chosen.ok, true);
  assert.equal(chosen.event.sessionId, "s1");
});

test("ingest binding: no invoke, a failed invoke, a second attempt, or a consumed phase all refuse", () => {
  assert.match(selectInvokeForIngest([], "negative").reason, /no invoke event exists/);
  assert.match(selectInvokeForIngest([invokeEvent({ exitStatus: 1 })], "negative").reason, /exited 1/);
  assert.match(
    selectInvokeForIngest([invokeEvent(), invokeEvent({ sessionId: "s2" })], "negative").reason,
    /2 invoke events exist .*exactly one attempt/,
  );
  assert.match(
    selectInvokeForIngest([invokeEvent(), { stage: "ingest", phase: "negative", outcome: "ok" }], "negative").reason,
    /already has an ingest event/,
  );
  // A different phase's invoke is not a source for this one.
  assert.match(selectInvokeForIngest([invokeEvent({ phase: "repaired" })], "negative").reason, /no invoke event exists/);
});

test("ingest binding: an arbitrary or mismatched capture is rejected on path, bytes or digest", () => {
  const event = invokeEvent();
  assert.equal(captureBindingFault(event, { path: event.stdoutFile, bytes: 12, digest: "d".repeat(64) }), null);
  assert.match(captureBindingFault(event, { path: "/h/raw/forged.stdout", bytes: 12, digest: "d".repeat(64) }), /is not the invoke event's/);
  assert.match(captureBindingFault(event, { path: event.stdoutFile, bytes: 13, digest: "d".repeat(64) }), /captured 13 bytes/);
  assert.match(captureBindingFault(event, { path: event.stdoutFile, bytes: 12, digest: "e".repeat(64) }), /sha256 .* is not the invoke's/);
});

// --- the required history ------------------------------------------------------------------------------

// Every significant event the real stages record now carries an explicit `outcome`, and the history
// predicates require `"ok"` — so these builders carry it too, and the failure tests below flip it.
const ev = {
  invoke: phase => ({ stage: "invoke", phase, outcome: "ok", exitStatus: 0 }),
  ingest: phase => ({ stage: "ingest", phase, outcome: "ok" }),
  submitNotReady: phase => ({ stage: "submit", phase, outcome: "ok", expect: "not-ready", commitReady: false, hasScopeViolation: true, semanticFindingCount: 1 }),
  submitReady: phase => ({ stage: "submit", phase, outcome: "ok", expect: "ready", commitReady: true, hasScopeViolation: false, semanticFindingCount: 0 }),
  commitRefused: phase => ({ stage: "commit", phase, outcome: "ok", expect: "not-ready", committed: false, code: "E_LOOP_NOT_COMMIT_READY" }),
  commitOk: phase => ({ stage: "commit", phase, outcome: "ok", expect: "ok", committed: true, code: null }),
  verify: phase => ({ stage: "verify", phase, outcome: "ok", passed: true, historical: false }),
  evaluate: (phase, combined) => ({ stage: "evaluate", phase, outcome: "ok", combined, loopPass: combined, provenancePass: combined }),
  repair: () => ({ stage: "repair", outcome: "ok", from: "negative", to: "repaired", before: "i1", after: "i2" }),
  stale: () => ({
    stage: "stale-submit", outcome: "ok", code: "E_LOOP_CLAIM_MISMATCH",
    admittedBefore: 1, admittedAfter: 1, observedIterationsBefore: 1, observedIterationsAfter: 1,
  }),
};

const POSITIVE = () => [
  ev.invoke("positive"), ev.ingest("positive"), ev.submitReady("positive"),
  ev.commitOk("positive"), ev.verify("positive"), ev.evaluate("positive", true),
];
const FIXED = () => [
  ev.invoke("negative"), ev.ingest("negative"), ev.submitNotReady("negative"),
  ev.commitRefused("negative"), ev.evaluate("negative", false),
  ev.repair(), ev.stale(),
  ev.invoke("repaired"), ev.ingest("repaired"), ev.submitReady("repaired"),
  ev.commitOk("repaired"), ev.verify("repaired"), ev.evaluate("repaired", true),
];

const rejects = (events, scenario, pattern) => {
  const result = validateHistory(events, scenario);
  assert.equal(result.ok, false, "expected the history to be rejected");
  assert.ok(result.problems.some(p => pattern.test(p)), `no problem matched ${pattern}; saw: ${result.problems.join(" | ")}`);
};

test("history: the two exact legal sequences are accepted", () => {
  assert.deepEqual(validateHistory(POSITIVE(), "positive"), { ok: true, problems: [] });
  assert.deepEqual(validateHistory(FIXED(), "fixed-point"), { ok: true, problems: [] });
  // Non-significant events interleave freely and change nothing.
  const noisy = [{ stage: "begin" }, ...POSITIVE().slice(0, 3), { stage: "emit" }, ...POSITIVE().slice(3)];
  assert.equal(validateHistory(noisy, "positive").ok, true);
});

test("history: a missing required step is rejected", () => {
  const missing = FIXED().filter(e => e.stage !== "stale-submit");
  rejects(missing, "fixed-point", /missing|stale/);
  rejects(POSITIVE().slice(0, 4), "positive", /step 5 \(verify\(positive\)\): missing/);
});

test("history: a duplicated or extra required-stage event is rejected", () => {
  const dup = POSITIVE();
  dup.splice(2, 0, ev.submitReady("positive"));
  rejects(dup, "positive", /unexpected extra|expected commit/);
});

test("history: an out-of-order sequence is rejected", () => {
  const swapped = POSITIVE();
  [swapped[3], swapped[4]] = [swapped[4], swapped[3]]; // verify before commit
  rejects(swapped, "positive", /step 4 \(commit\(positive\)\): expected commit, saw verify/);
});

test("history: a wrong-phase event is rejected", () => {
  const wrong = FIXED();
  wrong[7] = ev.invoke("negative"); // the second invoke must be the repaired one
  rejects(wrong, "fixed-point", /expected phase repaired, saw negative/);
});

test("history: a wrong refusal code is rejected in both refusal steps", () => {
  const badCommit = FIXED();
  badCommit[3] = { ...ev.commitRefused("negative"), code: "E_LOOP_LOCKED" };
  rejects(badCommit, "fixed-point", /refusal code was E_LOOP_LOCKED/);

  const badStale = FIXED();
  badStale[6] = { ...ev.stale(), code: "E_LOOP_EMISSION_SPENT" };
  rejects(badStale, "fixed-point", /refusal code was E_LOOP_EMISSION_SPENT/);
});

test("history: a negative submit without the scope-violation identity is rejected", () => {
  const noFinding = FIXED();
  noFinding[2] = { ...ev.submitNotReady("negative"), hasScopeViolation: false };
  rejects(noFinding, "fixed-point", /did not identify a scope-violation/);
});

test("history: a ready submit that still carries semantic findings is rejected", () => {
  const dirty = POSITIVE();
  dirty[2] = { ...ev.submitReady("positive"), semanticFindingCount: 2 };
  rejects(dirty, "positive", /2 semantic finding identities remain/);
});

test("history: contradictory evaluate, verify replay, and no-op repair are rejected", () => {
  const notConjunction = POSITIVE();
  // `outcome:"ok"` on purpose: the conjunction predicate, not the outcome gate, must be what fails.
  notConjunction[5] = { stage: "evaluate", phase: "positive", outcome: "ok", combined: true, loopPass: true, provenancePass: false };
  rejects(notConjunction, "positive", /combined is not the conjunction/);

  const replayed = POSITIVE();
  replayed[4] = { ...ev.verify("positive"), historical: true };
  rejects(replayed, "positive", /replay, not a fresh attempt/);

  const noProgress = FIXED();
  noProgress[5] = { ...ev.repair(), after: "i1" };
  rejects(noProgress, "fixed-point", /did not move the inventory digest/);
});

test("history: a stale submission that consumed an admission is rejected", () => {
  const consumed = FIXED();
  consumed[6] = { ...ev.stale(), admittedAfter: 2 };
  rejects(consumed, "fixed-point", /consumed an admission/);

  const moved = FIXED();
  moved[6] = { ...ev.stale(), observedIterationsAfter: 2 };
  rejects(moved, "fixed-point", /moved observedIterations/);
});

test("history: an unusable ingest and an unknown scenario are rejected", () => {
  const unusable = POSITIVE();
  unusable[1] = { stage: "ingest", phase: "positive", outcome: "unusable" };
  rejects(unusable, "positive", /ingest\(positive\)\): outcome was unusable/);
  rejects(POSITIVE(), "no-such-scenario", /unknown scenario/);
});

test("history: the positive sequence is not accepted as the fixed-point one, or vice versa", () => {
  rejects(POSITIVE(), "fixed-point", /./);
  rejects(FIXED(), "positive", /./);
});

// --- the required-history PREFIX guard -----------------------------------------------------------------
//
// The property that stops a paid reviewer call being spent out of order. It must never disagree with
// the final `validateHistory`, because both read the same `REQUIRED_HISTORY` matchers.

test("prefix: every prefix of a valid history is accepted and names the next step by id", () => {
  for (const [seq, scenario] of [[POSITIVE(), "positive"], [FIXED(), "fixed-point"]]) {
    assert.equal(validateHistory(seq, scenario).ok, true, `${scenario} baseline must be valid`);
    for (let n = 0; n < seq.length; n += 1) {
      const next = nextRequiredStep(seq.slice(0, n), scenario);
      assert.equal(next.ok, true, `prefix length ${n} must be accepted`);
      assert.equal(next.done, false);
      assert.equal(next.index, n);
      assert.equal(next.id, REQUIRED_HISTORY[scenario][n].id, `prefix length ${n} names the wrong next id`);
      // NO DRIFT: the very matcher `validateHistory` will apply to this event accepts it here too.
      assert.equal(REQUIRED_HISTORY[scenario][n].fault(seq[n]), null);
      // …and the guard admits exactly that id and refuses every other one.
      assert.equal(prefixGuardFault(seq.slice(0, n), scenario, next.id), null);
      assert.match(prefixGuardFault(seq.slice(0, n), scenario, "some-other-step"), /out of order/);
    }
    // A complete history is done, and any further step would be an extra.
    const done = nextRequiredStep(seq, scenario);
    assert.equal(done.done, true);
    assert.equal(done.id, null);
    assert.match(prefixGuardFault(seq, scenario, "repair"), /already complete/);
  }
});

test("prefix: the fixed-point ids are exactly the settled thirteen, in order", () => {
  assert.deepEqual(REQUIRED_HISTORY["fixed-point"].map(s => s.id), [
    "invoke:negative", "ingest:negative", "submit:negative", "commit:negative", "evaluate:negative",
    "repair", "stale-submit",
    "invoke:repaired", "ingest:repaired", "submit:repaired", "commit:repaired", "verify:repaired",
    "evaluate:repaired",
  ]);
  assert.deepEqual(REQUIRED_HISTORY.positive.map(s => s.id), [
    "invoke:positive", "ingest:positive", "submit:positive", "commit:positive", "verify:positive",
    "evaluate:positive",
  ]);
  // Ids are stable handles, distinct from the human labels the gate prints.
  for (const scenario of ["positive", "fixed-point"]) {
    for (const s of REQUIRED_HISTORY[scenario]) {
      assert.ok(typeof s.id === "string" && s.id.length > 0);
      assert.ok(typeof s.label === "string" && s.label.length > 0);
      assert.equal(typeof s.fault, "function");
    }
  }
});

test("prefix: an immediate repair straight after prepare is refused", () => {
  // The cheapest way to burn a paid call: repair with nothing done, then packet+invoke the repaired
  // phase. The guard refuses BEFORE any source mutation or emission.
  assert.match(prefixGuardFault([], "fixed-point", "repair"), /next required step is invoke:negative/);
  assert.equal(nextRequiredStep([], "fixed-point").id, "invoke:negative");
});

test("prefix: repair before the complete five-step negative arm is refused", () => {
  const arm = FIXED().slice(0, 5);
  for (let n = 0; n < 5; n += 1) {
    assert.match(prefixGuardFault(arm.slice(0, n), "fixed-point", "repair"), /out of order/,
      `repair must be refused after only ${n} negative steps`);
  }
  // …and allowed at exactly five.
  assert.equal(prefixGuardFault(arm, "fixed-point", "repair"), null);
});

test("prefix: the repaired packet/invoke is refused until stale-submit has run", () => {
  const throughRepair = FIXED().slice(0, 6);
  assert.match(prefixGuardFault(throughRepair, "fixed-point", "invoke:repaired"),
    /next required step is stale-submit/);
  assert.equal(prefixGuardFault(throughRepair, "fixed-point", "stale-submit"), null);
  // After stale-submit the repaired invoke is next, and only then.
  const throughStale = FIXED().slice(0, 7);
  assert.equal(prefixGuardFault(throughStale, "fixed-point", "invoke:repaired"), null);
  assert.match(prefixGuardFault(throughStale, "fixed-point", "stale-submit"), /out of order/);
});

test("prefix: the initial packet/invoke is allowed in both scenarios", () => {
  assert.equal(prefixGuardFault([], "fixed-point", "invoke:negative"), null);
  assert.equal(prefixGuardFault([], "positive", "invoke:positive"), null);
  // …but not the other scenario's first step, nor a repaired invoke.
  assert.match(prefixGuardFault([], "positive", "invoke:negative"), /out of order/);
  assert.match(prefixGuardFault([], "fixed-point", "invoke:repaired"), /out of order/);
});

test("prefix: an extra, duplicated or mismatched significant event invalidates the whole prefix", () => {
  const dup = [...FIXED().slice(0, 2), FIXED()[1]];
  assert.match(prefixGuardFault(dup, "fixed-point", "submit:negative"), /not a valid prefix/);

  const overrun = [...POSITIVE(), ev.evaluate("positive", true)];
  assert.match(prefixGuardFault(overrun, "positive", "evaluate:positive"), /unexpected extra required-stage event/);

  const mismatched = FIXED().slice(0, 5);
  mismatched[2] = { ...mismatched[2], hasScopeViolation: false };
  const fault = prefixGuardFault(mismatched, "fixed-point", "repair");
  assert.match(fault, /not a valid prefix/);
  assert.match(fault, /did not identify a scope-violation/);

  // A terminal outcome anywhere in the prefix also invalidates it, so a dead scenario cannot advance
  // even if the central terminal rule were somehow bypassed.
  const dead = FIXED().slice(0, 5);
  dead[1] = { ...dead[1], outcome: "unusable" };
  assert.match(prefixGuardFault(dead, "fixed-point", "repair"), /outcome was unusable/);

  assert.match(prefixGuardFault([], "no-such-scenario", "repair"), /unknown scenario/);
});

test("prefix: non-significant events never advance or invalidate the prefix", () => {
  const noisy = [{ stage: "begin", outcome: "ok" }, { stage: "emit", outcome: "ok" },
    { stage: "invoke-start", phase: "negative", sessionId: "s1" }];
  assert.equal(nextRequiredStep(noisy, "fixed-point").id, "invoke:negative",
    "markers and bookkeeping are not required steps");
  assert.equal(prefixGuardFault(noisy, "fixed-point", "invoke:negative"), null);
});

test("history: a durable product-failure event can never satisfy a required step", () => {
  for (const [seq, scenario, index] of [[POSITIVE(), "positive", 2], [FIXED(), "fixed-point", 2]]) {
    const failed = seq;
    failed[index] = { ...failed[index], outcome: "product-failure" };
    rejects(failed, scenario, /outcome was product-failure/);
  }
  // …and neither can an unusable ingest, a failed commit, verify or evaluate.
  for (const [index, label] of [[1, "ingest"], [3, "commit"], [4, "verify"], [5, "evaluate"]]) {
    const seq = POSITIVE();
    seq[index] = { ...seq[index], outcome: index === 1 ? "unusable" : "product-failure" };
    rejects(seq, "positive", /outcome was (product-failure|unusable)/, label);
  }
});

// --- the central terminal rule -------------------------------------------------------------------------

test("terminal rule: only unusable and product-failure are terminal", () => {
  assert.deepEqual([...TERMINAL_OUTCOMES], ["unusable", "product-failure"]);
  assert.equal(terminalFailure([]), null);
  assert.equal(terminalFailure([{ stage: "submit", outcome: "ok" }]), null);
  assert.equal(continuableFault(POSITIVE()), null, "a wholly successful history is continuable");
});

test("terminal rule: the FIRST terminal event stops everything and is reported precisely", () => {
  const events = [
    { stage: "invoke", phase: "negative", outcome: "ok", ordinal: 1 },
    { stage: "ingest", phase: "negative", outcome: "unusable", fault: "slice-missing", ordinal: 2 },
    { stage: "submit", phase: "negative", outcome: "product-failure", ordinal: 3 },
  ];
  const found = terminalFailure(events);
  assert.equal(found.ordinal, 2, "the earliest terminal event is the one reported");
  assert.equal(found.fault, "slice-missing");
  assert.match(continuableFault(events), /stopped at event 2 \(ingest, outcome unusable, fault slice-missing\)/);
  assert.match(continuableFault(events), /no phase may be started to work around it/);
});

test("terminal rule: a dead phase cannot be walked past into another reviewer call", () => {
  // The exact regression this closes: an unusable negative ingest, then an attempt to repair and
  // invoke the repaired phase — which would spend a second paid call before `gate` noticed.
  const dead = [
    { stage: "invoke", phase: "negative", outcome: "ok", ordinal: 1, exitStatus: 0 },
    { stage: "ingest", phase: "negative", outcome: "unusable", fault: "binding-mismatch", ordinal: 2 },
  ];
  assert.ok(invokeBlockedReason(dead, "repaired"), "a repaired invoke must be blocked");
  assert.ok(gateBlockedReason(dead), "gate must be blocked");
  assert.equal(selectInvokeForIngest(dead, "repaired").ok, false);
  assert.match(selectInvokeForIngest(dead, "repaired").reason, /scenario stopped at event 2/);
});

test("terminal rule: a non-zero reviewer exit is itself terminal", () => {
  const failed = [{ stage: "invoke", phase: "negative", outcome: "product-failure", ordinal: 1, exitStatus: 2 }];
  assert.ok(continuableFault(failed));
  assert.ok(invokeBlockedReason(failed, "repaired"));
  rejects([...failed], "fixed-point", /outcome was product-failure/);
});

// --- one-attempt guards --------------------------------------------------------------------------------

test("invoke guard: a completed pair still holds that phase's single slot", () => {
  const completed = [
    { stage: "invoke-start", phase: "negative", sessionId: "s1", ordinal: 1 },
    { stage: "invoke", phase: "negative", sessionId: "s1", outcome: "ok", exitStatus: 0, ordinal: 2 },
  ];
  assert.match(invokeBlockedReason(completed, "negative"), /invoke-start and invoke/);
  // The pair is complete, so the OTHER phase is still open for its own single attempt.
  assert.equal(invokeBlockedReason(completed, "repaired"), null);
});

// --- start-marker pairing: the phase16h hole ------------------------------------------------------------

const startMarker = (phase, sessionId, ordinal) => ({ stage: "invoke-start", phase, sessionId, ordinal });
const completion = (phase, sessionId, ordinal, outcome = "ok") =>
  ({ stage: "invoke", phase, sessionId, outcome, exitStatus: outcome === "ok" ? 0 : 2, ordinal });

test("pairing: an orphan invoke-start stops the WHOLE scenario, not just its phase", () => {
  // The exact regression: crash after the negative start marker, then `repair` walks to the repaired
  // phase and spends a SECOND paid reviewer call. Every one of these must now refuse.
  const orphan = [startMarker("negative", "s1", 1)];
  const terminal = terminalFailure(orphan);
  assert.equal(terminal.outcome, INCOMPLETE_OUTCOME);
  assert.equal(terminal.stage, "invoke-start");
  assert.equal(terminal.sessionId, "s1");
  assert.match(continuableFault(orphan), /stopped at event 1 \(invoke-start session s1, outcome incomplete-attempt\)/);
  assert.ok(invokeBlockedReason(orphan, "repaired"), "the repaired phase must be blocked by a negative orphan");
  assert.ok(invokeBlockedReason(orphan, "negative"));
  assert.ok(gateBlockedReason(orphan));
  assert.equal(selectInvokeForIngest(orphan, "repaired").ok, false);
  assert.match(selectInvokeForIngest(orphan, "negative").reason, /incomplete-attempt/);
});

test("pairing: a normal pair, and two paired phases, stay continuable", () => {
  assert.equal(continuableFault([startMarker("negative", "s1", 1), completion("negative", "s1", 2)]), null);
  const both = [
    startMarker("negative", "s1", 1), completion("negative", "s1", 2),
    startMarker("repaired", "s2", 3), completion("repaired", "s2", 4),
  ];
  assert.equal(continuableFault(both), null);
  assert.equal(terminalFailure(both), null);
  assert.deepEqual(incompleteAttempts(both), []);
});

test("pairing: a completed but failed invoke reports its OUTCOME, never `incomplete-attempt`", () => {
  const failed = [startMarker("negative", "s1", 1), completion("negative", "s1", 2, "product-failure")];
  assert.deepEqual(incompleteAttempts(failed), [], "the attempt completed; it merely failed");
  const terminal = terminalFailure(failed);
  assert.equal(terminal.outcome, "product-failure");
  assert.equal(terminal.stage, "invoke");
  assert.doesNotMatch(continuableFault(failed), /incomplete-attempt/);
});

test("pairing: a session or phase mismatch does not pair", () => {
  const wrongSession = [startMarker("negative", "s1", 1), completion("negative", "s2", 2)];
  assert.equal(incompleteAttempts(wrongSession).length, 1);
  assert.equal(incompleteAttempts(wrongSession)[0].sessionId, "s1");
  const wrongPhase = [startMarker("negative", "s1", 1), completion("repaired", "s1", 2)];
  assert.equal(incompleteAttempts(wrongPhase).length, 1);
  assert.equal(incompleteAttempts(wrongPhase)[0].phase, "negative");
  // A completion that PRECEDES its marker does not pair either.
  assert.equal(incompleteAttempts([completion("negative", "s1", 1), startMarker("negative", "s1", 2)]).length, 1);
});

test("pairing: an orphan gate-start is terminal; a successful gate pairs it; a non-ok gate does not", () => {
  const orphanGate = [{ stage: "gate-start", ordinal: 1 }];
  assert.equal(terminalFailure(orphanGate).outcome, INCOMPLETE_OUTCOME);
  assert.equal(terminalFailure(orphanGate).kind, "gate");
  assert.match(continuableFault(orphanGate), /gate-start, outcome incomplete-attempt/);

  const paired = [{ stage: "gate-start", ordinal: 1 }, { stage: "gate", outcome: "ok", ordinal: 2 }];
  assert.equal(continuableFault(paired), null);

  const notOk = [{ stage: "gate-start", ordinal: 1 }, { stage: "gate", outcome: "product-failure", ordinal: 2 }];
  assert.equal(incompleteAttempts(notOk).length, 1, "only a successful gate pairs a gate-start");
});

test("pairing: the EARLIEST terminal condition wins when both kinds coexist", () => {
  // Recorded outcome first…
  const outcomeFirst = [
    { stage: "ingest", phase: "negative", outcome: "unusable", fault: "slice-empty", ordinal: 1 },
    startMarker("repaired", "s2", 2),
  ];
  assert.equal(terminalFailure(outcomeFirst).at, 1);
  assert.equal(terminalFailure(outcomeFirst).outcome, "unusable");
  // …and marker first.
  const markerFirst = [
    startMarker("negative", "s1", 1),
    { stage: "submit", phase: "negative", outcome: "product-failure", ordinal: 2 },
  ];
  assert.equal(terminalFailure(markerFirst).at, 1);
  assert.equal(terminalFailure(markerFirst).outcome, INCOMPLETE_OUTCOME);
  // Ordinals are optional: array position is the fallback, so synthetic histories still order.
  assert.equal(terminalFailure([startMarker("negative", "s1", undefined)]).at, 1);
});

test("pairing: marker-free synthetic histories remain continuable and valid", () => {
  // The existing suites build event lists with no start markers at all; the new rule must not turn
  // those into false positives.
  assert.equal(continuableFault(POSITIVE()), null);
  assert.equal(continuableFault(FIXED()), null);
  assert.deepEqual(incompleteAttempts(POSITIVE()), []);
  assert.equal(validateHistory(POSITIVE(), "positive").ok, true);
  assert.equal(validateHistory(FIXED(), "fixed-point").ok, true);
});

test("attempt guard: one submit, commit, verify and evaluate per phase, success or failure", () => {
  for (const [stage, outcome] of [["submit", "ok"], ["submit", "product-failure"], ["commit", "ok"],
    ["verify", "product-failure"], ["evaluate", "ok"]]) {
    const events = [{ stage, phase: "negative", outcome, ordinal: 1 }];
    assert.match(attemptBlockedReason(events, stage, "negative"), new RegExp(`already has a ${stage} event`));
    assert.equal(attemptBlockedReason(events, stage, "repaired"), null, "a different phase has its own slot");
  }
  assert.equal(attemptBlockedReason([], "submit", "negative"), null);
});

test("attempt guard: an omitted phase is a STAGE-GLOBAL slot, whatever the record carries", () => {
  // `stale-submit` records a phase and `repair` does not. Both call the guard without one, and both
  // must be one-shot — the old rule matched `undefined === undefined` and so silently let a second
  // stale replay through the moment the record gained a phase.
  const staleWithPhase = [{ stage: "stale-submit", phase: "repaired", outcome: "ok", ordinal: 1 }];
  assert.match(attemptBlockedReason(staleWithPhase, "stale-submit", undefined), /stage-global slot per scenario/);
  const repairWithoutPhase = [{ stage: "repair", outcome: "ok", ordinal: 1 }];
  assert.match(attemptBlockedReason(repairWithoutPhase, "repair", undefined), /stage-global slot per scenario/);
  // A failed prior attempt holds the slot just as firmly as a successful one.
  assert.ok(attemptBlockedReason([{ stage: "stale-submit", phase: "repaired", outcome: "product-failure" }],
    "stale-submit", undefined));
  // The global slot is per stage, not shared between stages, and an empty history is open.
  assert.equal(attemptBlockedReason(staleWithPhase, "repair", undefined), null);
  assert.equal(attemptBlockedReason([], "stale-submit", undefined), null);
  // Supplying a phase keeps the phase-specific behaviour intact.
  assert.match(attemptBlockedReason(staleWithPhase, "stale-submit", "repaired"), /one attempt per phase/);
  assert.equal(attemptBlockedReason(staleWithPhase, "stale-submit", "negative"), null);
});

test("review cleanup: only an OBSERVED removal clears the caller", () => {
  assert.equal(reviewCleanupFault({ attempted: true, removed: true, error: null }), null);
  assert.equal(reviewCleanupFault({ attempted: false, removed: null, error: null }), null,
    "nothing was written, so there is nothing to remove");
  assert.match(reviewCleanupFault({ attempted: true, removed: false, error: "EBUSY" }), /was not removed \(EBUSY\)/);
  assert.match(reviewCleanupFault({ attempted: true, removed: false, error: null }),
    /still present after the removal attempt/);
  assert.equal(reviewCleanupFault(null), null);
});

// The removal itself, against the real filesystem. The observation is the point of the helper, so it
// is NOT mocked: a controlled temp tree is created and torn down inside the test. No model, no
// network, no external process — only local fs.
test("review cleanup: the shared helper observes what actually happened", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-cleanup-"));
  try {
    // 1. nothing was written: no attempt, and the fields say so rather than guessing.
    const untouched = path.join(dir, "never-written.json");
    assert.deepEqual(removeReviewFile(untouched, false), { attempted: false, removed: null, error: null });
    assert.equal(reviewCleanupFault(removeReviewFile(untouched, false)), null);

    // 2. a real file is removed, and the removal is OBSERVED rather than assumed.
    const file = path.join(dir, "review.json");
    fs.writeFileSync(file, '{"a":1}');
    assert.ok(fs.existsSync(file));
    const removed = removeReviewFile(file, true);
    assert.deepEqual(removed, { attempted: true, removed: true, error: null });
    assert.ok(!fs.existsSync(file), "the file really is gone");
    assert.equal(reviewCleanupFault(removed), null);

    // 3. a removal that CANNOT succeed. `rmSync` without `recursive` refuses a non-empty directory,
    //    which is a deterministic local way to reach the branch that used to be reported as `true`.
    const blocked = path.join(dir, "blocked");
    fs.mkdirSync(blocked);
    fs.writeFileSync(path.join(blocked, "child.txt"), "x");
    const failed = removeReviewFile(blocked, true);
    assert.equal(failed.attempted, true);
    assert.equal(failed.removed, false, "the path still exists, so `removed` must be false");
    assert.ok(typeof failed.error === "string" && failed.error.length > 0,
      `a failed removal must carry its error; saw ${JSON.stringify(failed.error)}`);
    assert.ok(fs.existsSync(blocked), "the observation matches reality");
    // …and that observation is what makes a caller fail closed.
    assert.match(reviewCleanupFault(failed), /was not removed/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("gate guard: a start marker alone prevents a second collection or append", () => {
  assert.equal(gateBlockedReason(POSITIVE()), null);
  // An ORPHAN gate-start is now caught by the stronger, scenario-wide terminal rule rather than by
  // the gate-specific slot check — a partial gate stops everything, not only a second gate.
  assert.match(gateBlockedReason([{ stage: "gate-start", ordinal: 1 }]), /incomplete-attempt/);
  // A completed gate with no marker (synthetic) still holds the gate slot.
  assert.match(gateBlockedReason([{ stage: "gate", outcome: "ok", ordinal: 1 }]), /already been attempted \(gate\)/);
  // A properly paired gate is continuable, so the slot check is what refuses the second attempt.
  assert.match(
    gateBlockedReason([{ stage: "gate-start", ordinal: 1 }, { stage: "gate", outcome: "ok", ordinal: 2 }]),
    /one scenario gets one collection and one ledger append/,
  );
});

// --- ingest fault classification -------------------------------------------------------------------------

test("ingest faults: every failure path maps to a stable declared class", () => {
  for (const cls of ["source-missing", "not-regular-file", "outside-root", "source-unreadable",
    "binding-mismatch", "slice-duplicated", "slice-missing", "slice-misordered", "slice-empty",
    "persist-failed", "unexpected"]) {
    assert.ok(INGEST_FAULT_CLASSES.includes(cls), `${cls} must be a declared class`);
    assert.equal(classifyIngestFault(Object.assign(new Error("x"), { faultClass: cls })), cls);
  }
  // Every sentinel fault kind has a matching declared ingest class, so no slicer outcome is unnamed.
  for (const kind of FAULT_KINDS) assert.ok(INGEST_FAULT_CLASSES.includes(`slice-${kind}`), kind);
  // Anything unclassified or spoofed collapses to `unexpected` rather than leaking a made-up class.
  assert.equal(classifyIngestFault(new Error("boom")), "unexpected");
  assert.equal(classifyIngestFault(Object.assign(new Error("x"), { faultClass: "not-a-real-class" })), "unexpected");
  assert.equal(classifyIngestFault(null), "unexpected");
});

// --- the single-record ledger invariant ---------------------------------------------------------------

const line = obj => Buffer.from(`${JSON.stringify(obj)}\n`, "utf8");

test("ledger: exactly one newline-terminated JSON object is accepted", () => {
  const bytes = line({ type: "run", testProvenance: { converged: true } });
  assert.equal(singleLedgerRecordFault(bytes), null);
  assert.deepEqual(parseSingleLedgerRecord(bytes), { type: "run", testProvenance: { converged: true } });
});

test("ledger: absent, empty, unterminated, multi-record and non-object files are all rejected", () => {
  assert.match(singleLedgerRecordFault(Buffer.alloc(0)), /empty/);
  assert.match(singleLedgerRecordFault(Buffer.from('{"a":1}', "utf8")), /not newline-terminated/);
  assert.match(singleLedgerRecordFault(Buffer.concat([line({ a: 1 }), line({ b: 2 })])), /saw 2/);
  assert.match(singleLedgerRecordFault(Buffer.from("\n", "utf8")), /empty/);
  assert.match(singleLedgerRecordFault(Buffer.from("not json\n", "utf8")), /not JSON/);
  assert.match(singleLedgerRecordFault(Buffer.from("[1,2]\n", "utf8")), /not a JSON object/);
  assert.match(singleLedgerRecordFault("a string"), /must be a Buffer/);
  assert.throws(() => parseSingleLedgerRecord(Buffer.alloc(0)), /empty/);
});

test("ledger: an append that completes a previously truncated line is rejected", () => {
  // The concrete hole the scenario-absence invariant closes: `appendJsonLine` adds a leading newline
  // when the existing file lacks one, so a naive tail check would see one clean record while this
  // append had silently terminated someone else's partial line.
  const completedByAppend = Buffer.concat([Buffer.from('{"partial":', "utf8"), line({ b: 2 })]);
  assert.match(singleLedgerRecordFault(completedByAppend), /saw 2|not JSON/);
});

// ======================================================================================================
// The PreToolUse Bash guard.
//
// Live probes established that `--allowed-tools` is NOT an exclusive Bash allowlist in this
// environment, so this guard is the actual deny boundary. Nothing below claims it is enforced — these
// tests establish only that the decision logic and the wire protocol behave as designed. Enforcement
// is a live-probe question.
// ======================================================================================================

const GUARD = path.resolve("eval/loop-e2e/bash-guard.mjs");
const require$sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const REPO_ROOT = "/tmp/ctide-e2e-guard";
const GUARD_DIGEST = "g".repeat(64);
const GUARD_CONFIG = {
  repoRootResolved: REPO_ROOT, auditDir: "/tmp/ctide-e2eh-guard/audit",
  guardDigest: GUARD_DIGEST, allowedCommands: [...ALLOWED_COMMANDS],
};
const bashInput = (command, over = {}) => ({
  tool_name: "Bash", tool_input: { command }, cwd: REPO_ROOT,
  session_id: "sess-1", tool_use_id: "tu-1", ...over,
});
const verdict = (command, over = {}, resolvedCwd = REPO_ROOT) =>
  decide({ input: bashInput(command, over), config: GUARD_CONFIG, resolvedCwd });

test("guard: the two exact commands pass at a matching resolved root", () => {
  for (const command of ALLOWED_COMMANDS) {
    assert.equal(verdict(command).decision, DECISION_PASS, command);
  }
});

test("guard: every near-miss on the command string denies", () => {
  const denied = [
    "git status",
    "git log --oneline",
    `${ALLOWED_COMMANDS[0]}; git status`,
    `${ALLOWED_COMMANDS[0]} && git status`,
    `${ALLOWED_COMMANDS[0]} | cat`,
    `${ALLOWED_COMMANDS[0]}\ngit status`,
    `${ALLOWED_COMMANDS[0]} --stat`,
    `${ALLOWED_COMMANDS[0]}\n`,
    ` ${ALLOWED_COMMANDS[0]}`,
    "git diff --no-ext-diff --no-textconv -- /tmp/ctide-e2e-guard/test/alpha.test.mjs",
    "git  diff --no-ext-diff --no-textconv -- test/alpha.test.mjs",
    "GIT DIFF --no-ext-diff --no-textconv -- test/alpha.test.mjs",
    "git diff -- test/alpha.test.mjs",
    "node --test test/other.test.mjs",
    "node --test",
  ];
  for (const command of denied) {
    assert.equal(verdict(command).decision, DECISION_DENY, `must deny: ${JSON.stringify(command)}`);
  }
});

test("guard: an allowed command from the wrong resolved root denies", () => {
  for (const command of ALLOWED_COMMANDS) {
    assert.equal(verdict(command, {}, "/tmp/somewhere-else").decision, DECISION_DENY, command);
    assert.match(verdict(command, {}, "/tmp/somewhere-else").reason, /not the expected reviewer repository root/);
  }
  // An unresolvable cwd denies rather than being treated as a match.
  assert.equal(verdict(ALLOWED_COMMANDS[0], {}, null).decision, DECISION_DENY);
});

test("guard: resolved-root comparison folds case only where the filesystem does", () => {
  const upper = REPO_ROOT.toUpperCase();
  if (process.platform === "win32") {
    assert.equal(sameResolvedRoot(REPO_ROOT, upper), true, "Windows paths are case-insensitive");
    assert.equal(verdict(ALLOWED_COMMANDS[0], {}, upper).decision, DECISION_PASS);
  } else {
    assert.equal(sameResolvedRoot(REPO_ROOT, upper), false, "a case difference is a different path here");
    assert.equal(verdict(ALLOWED_COMMANDS[0], {}, upper).decision, DECISION_DENY);
  }
  assert.equal(sameResolvedRoot(REPO_ROOT, REPO_ROOT), true);
  assert.equal(sameResolvedRoot(REPO_ROOT, ""), false);
  assert.equal(sameResolvedRoot(null, REPO_ROOT), false);
});

test("guard: non-Bash tools fall through and are NEVER denied, whatever the config", () => {
  // The config is deliberately varied, INCLUDING broken ones. Identifying the tool must happen
  // before config validation: a config regression must not be able to take out Read/Grep/Glob.
  const configs = [GUARD_CONFIG, null, undefined, {}, "not an object",
    { ...GUARD_CONFIG, repoRootResolved: "" }, { ...GUARD_CONFIG, guardDigest: undefined },
    { ...GUARD_CONFIG, allowedCommands: [] }];
  for (const tool of ["Read", "Grep", "Glob", "WebFetch"]) {
    for (const [i, config] of configs.entries()) {
      const out = decide({ input: { tool_name: tool, cwd: REPO_ROOT }, config, resolvedCwd: REPO_ROOT });
      assert.equal(out.decision, DECISION_IGNORE, `${tool} with config #${i} must fall through`);
    }
  }
  // A Bash call with the same broken configs still denies — fall-through is scoped to the tool.
  for (const config of configs.slice(1)) {
    assert.equal(decide({ input: bashInput(ALLOWED_COMMANDS[0]), config, resolvedCwd: REPO_ROOT }).decision,
      DECISION_DENY);
  }
});

test("guard: the config must carry the guard digest that records will copy", () => {
  assert.equal(configFault(GUARD_CONFIG), null);
  assert.match(configFault({ ...GUARD_CONFIG, guardDigest: undefined }), /no guardDigest/);
  assert.match(configFault({ ...GUARD_CONFIG, guardDigest: "" }), /no guardDigest/);
});

test("guard: the stdin watchdog blocks rather than hanging", async () => {
  // A stream that never ends. Injectable so the deadline is exercised without a child process and
  // with no dependence on the production default. This covers the API contract; the event-loop
  // lifetime of the deadline timer is covered by the child-process regressions below. An in-process
  // test cannot settle that question either way, because the surrounding suite MAY incidentally keep
  // the loop referenced — which is exactly why this same test cancelled under Node 22 and passed
  // under Node 24 while the defect was present in both.
  const stalled = new PassThrough();
  const result = await readStreamWithTimeout(stalled, 20);
  assert.equal(result.timedOut, true, "a stdin that never closes must time out, not hang");
  assert.equal(result.bytes.length, 0);
  // A stream that ends normally is not reported as timed out, and its bytes survive.
  const fine = new PassThrough();
  const done = readStreamWithTimeout(fine, 5000);
  fine.end("hello");
  const ok = await done;
  assert.equal(ok.timedOut, false);
  assert.equal(ok.bytes.toString("utf8"), "hello");
});

// The guard's deadline timer must hold the event loop open, because when the stream never ends it is
// the ONLY thing that can settle the promise. A bare stream holds no libuv handle, so an unreferenced
// timer let the loop drain first: the promise never settled and the process exited 0 having printed
// nothing — the fail-open direction for a PreToolUse hook. Only a child with nothing else on its loop
// can observe that reliably, and the assertion is on OUTPUT rather than exit status, because the
// defective build exits 0 too.
const GUARD_URL = new URL("../eval/loop-e2e/bash-guard.mjs", import.meta.url).href;
const WATCHDOG_CHILD_TIMEOUT_MS = 5_000;

function runWatchdogChild(source, label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-watchdog-"));
  try {
    const script = path.join(dir, "probe.mjs");
    fs.writeFileSync(script, source, "utf8");
    const run = cp.spawnSync(process.execPath, [script], {
      encoding: "utf8", shell: false, timeout: WATCHDOG_CHILD_TIMEOUT_MS, stdio: ["ignore", "pipe", "pipe"],
    });
    assert.equal(run.error, undefined, `${label}: the child did not run to completion: ${run.error && run.error.code}`);
    assert.equal(run.status, 0, `${label}: unexpected exit status ${run.status}; stderr: ${run.stderr}`);
    assert.notEqual(run.stdout.trim(), "",
      `${label}: the child printed nothing, so its promise never settled — the loop drained before the deadline`);
    return JSON.parse(run.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

test("guard: the stdin watchdog settles in a child with nothing else on the event loop", () => {
  // `.then` rather than top-level await, so the module body finishes and the loop is free to drain
  // if anything is unreferenced — which is exactly the condition being tested.
  const observed = runWatchdogChild([
    'import { PassThrough } from "node:stream";',
    `import { readStreamWithTimeout } from ${JSON.stringify(GUARD_URL)};`,
    "readStreamWithTimeout(new PassThrough(), 20).then((r) => {",
    '  process.stdout.write(JSON.stringify({ timedOut: r.timedOut, bytes: r.bytes.length }));',
    "});",
    "",
  ].join("\n"), "stalled stream");
  assert.equal(observed.timedOut, true, "a stream that never ends must resolve as timed out");
  assert.equal(observed.bytes, 0, "and with no bytes, not a partial read reported as a timeout");
});

test("guard: a settled watchdog clears its timer instead of holding the child for the full deadline", () => {
  // A 60s deadline against a 5s child timeout: if `finish` did not clear the timer, a referenced
  // timer would keep the child alive far past the spawn timeout and this fails rather than hangs.
  const observed = runWatchdogChild([
    'import { PassThrough } from "node:stream";',
    `import { readStreamWithTimeout } from ${JSON.stringify(GUARD_URL)};`,
    "const fine = new PassThrough();",
    "readStreamWithTimeout(fine, 60000).then((r) => {",
    '  process.stdout.write(JSON.stringify({ timedOut: r.timedOut, bytes: r.bytes.length }));',
    "});",
    'fine.end("hello");',
    "",
  ].join("\n"), "ended stream");
  assert.equal(observed.timedOut, false, "a stream that ends is not a timeout");
  assert.equal(observed.bytes, 5, "and its bytes survive");
});

test("guard: malformed input or config denies, never falls through", () => {
  const bad = [
    { input: null, config: GUARD_CONFIG },
    { input: "not an object", config: GUARD_CONFIG },
    { input: { cwd: REPO_ROOT }, config: GUARD_CONFIG },                       // no tool_name
    { input: { tool_name: "Bash", cwd: REPO_ROOT }, config: GUARD_CONFIG },    // no tool_input
    { input: { tool_name: "Bash", tool_input: {}, cwd: REPO_ROOT }, config: GUARD_CONFIG },
    { input: { tool_name: "Bash", tool_input: { command: 7 }, cwd: REPO_ROOT }, config: GUARD_CONFIG },
    { input: bashInput(ALLOWED_COMMANDS[0], { cwd: "" }), config: GUARD_CONFIG },
    { input: bashInput(ALLOWED_COMMANDS[0]), config: null },
    { input: bashInput(ALLOWED_COMMANDS[0]), config: { ...GUARD_CONFIG, allowedCommands: [] } },
    { input: bashInput(ALLOWED_COMMANDS[0]), config: { ...GUARD_CONFIG, repoRootResolved: "" } },
    { input: bashInput(ALLOWED_COMMANDS[0]), config: { ...GUARD_CONFIG, auditDir: "" } },
  ];
  for (const [i, args] of bad.entries()) {
    assert.equal(decide({ resolvedCwd: REPO_ROOT, ...args }).decision, DECISION_DENY, `case ${i}`);
  }
  assert.equal(configFault(GUARD_CONFIG), null);
  assert.match(configFault({ ...GUARD_CONFIG, allowedCommands: ["ok", 3] }), /not a non-empty string/);
});

test("guard: the deny payload is the current structured PreToolUse shape", () => {
  const out = denyPayload("because");
  assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /^ctide bash-guard: because\./);
});

// --- the guard as a real process: stdin, stdout, exit code, filesystem ---------------------------------
//
// No mock stands in for the child process, the pipes or the audit write. `node <local file>` only —
// no model, no network, no shell.

function runGuard(stdinText, { configPath, extraArgs = [] } = {}) {
  const args = [GUARD, ...(configPath ? ["--config", configPath] : []), ...extraArgs];
  const run = cp.spawnSync(process.execPath, args, { input: stdinText, encoding: "utf8", shell: false });
  return { status: run.status, stdout: run.stdout || "", stderr: run.stderr || "" };
}

function withGuardWorld(body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-guardtest-"));
  try {
    const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ctide-guardrepo-")));
    const auditDir = path.join(root, "audit");
    const configPath = path.join(root, "guard-config.json");
    const guardDigest = require$sha256(fs.readFileSync(GUARD));
    fs.writeFileSync(configPath, JSON.stringify({
      repoRootResolved: repo, auditDir, guardDigest, allowedCommands: [...ALLOWED_COMMANDS],
    }));
    try {
      body({ root, repo, auditDir, configPath, guardDigest });
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const auditFilesIn = dir => (fs.existsSync(dir) ? fs.readdirSync(dir) : []);
const readAudit = dir => auditFilesIn(dir).map(n => JSON.parse(fs.readFileSync(path.join(dir, n), "utf8")));

test("guard process: an allowed call emits NO decision and writes exactly one pass record", () => {
  withGuardWorld(({ repo, auditDir, configPath }) => {
    const run = runGuard(JSON.stringify({
      tool_name: "Bash", tool_input: { command: ALLOWED_COMMANDS[0] }, cwd: repo,
      session_id: "sess-A", tool_use_id: "tu-A",
    }), { configPath });
    assert.equal(run.status, 0);
    assert.equal(run.stdout, "", "a pass must be silent so native processing continues");
    const records = readAudit(auditDir);
    assert.equal(records.length, 1);
    assert.equal(records[0].kind, AUDIT_KIND);
    assert.equal(records[0].decision, "pass");
    assert.equal(records[0].command, ALLOWED_COMMANDS[0]);
    assert.equal(records[0].sessionId, "sess-A");
    assert.equal(records[0].toolUseId, "tu-A");
    assert.equal(records[0].resolvedCwd, repo);
    assert.equal(records[0].expectedRoot, repo);
    assert.equal(typeof records[0].configDigest, "string");
    assert.equal(records[0].pid, records[0].pid | 0);
  });
});

test("guard process: an unlisted command emits the structured deny and one deny record", () => {
  withGuardWorld(({ repo, auditDir, configPath }) => {
    const run = runGuard(JSON.stringify({
      tool_name: "Bash", tool_input: { command: "git status" }, cwd: repo, session_id: "sess-B",
    }), { configPath });
    assert.equal(run.status, 0);
    const payload = JSON.parse(run.stdout);
    assert.equal(payload.hookSpecificOutput.permissionDecision, "deny");
    assert.equal(payload.hookSpecificOutput.hookEventName, "PreToolUse");
    const records = readAudit(auditDir);
    assert.equal(records.length, 1);
    assert.equal(records[0].decision, "deny");
    assert.equal(records[0].command, "git status");
  });
});

test("guard process: a non-Bash tool writes nothing and says nothing", () => {
  withGuardWorld(({ repo, auditDir, configPath }) => {
    const run = runGuard(JSON.stringify({ tool_name: "Read", tool_input: { file_path: "x" }, cwd: repo }), { configPath });
    assert.equal(run.status, 0);
    assert.equal(run.stdout, "");
    assert.deepEqual(auditFilesIn(auditDir), []);
  });
});

test("guard process: a non-Bash tool is released even with a missing or corrupt config", () => {
  withGuardWorld(({ root, repo, auditDir }) => {
    const brokenPath = path.join(root, "corrupt.json");
    fs.writeFileSync(brokenPath, "{not json at all");
    const emptyPath = path.join(root, "empty-config.json");
    fs.writeFileSync(emptyPath, "{}");
    for (const [what, opts] of [
      ["no --config at all", {}],
      ["a corrupt config", { configPath: brokenPath }],
      ["a config missing every field", { configPath: emptyPath }],
      ["a config path that does not exist", { configPath: path.join(root, "absent.json") }],
    ]) {
      for (const tool of ["Read", "Grep", "Glob"]) {
        const run = runGuard(JSON.stringify({ tool_name: tool, tool_input: {}, cwd: repo }), opts);
        assert.equal(run.status, 0, `${tool} with ${what} must be released`);
        assert.equal(run.stdout, "", `${tool} with ${what} must emit no decision`);
        assert.equal(run.stderr, "", `${tool} with ${what} must stay silent`);
      }
    }
    assert.deepEqual(auditFilesIn(auditDir), [], "a released tool writes no audit record");
  });
});

test("guard process: an audit record carries the guard digest the config supplied", () => {
  withGuardWorld(({ repo, auditDir, configPath, guardDigest }) => {
    runGuard(JSON.stringify({
      tool_name: "Bash", tool_input: { command: ALLOWED_COMMANDS[0] }, cwd: repo, session_id: "sess-G",
    }), { configPath });
    const [record] = readAudit(auditDir);
    assert.equal(record.guardDigest, guardDigest);
    assert.equal(record.schemaVersion, 1);
  });
});

test("guard process: malformed stdin, a missing/broken config, and an unwritable audit all BLOCK", () => {
  withGuardWorld(({ repo, root, auditDir, configPath }) => {
    // Malformed hook JSON still reaches a recorded deny, because the config was readable.
    const malformed = runGuard("{not json", { configPath });
    assert.equal(malformed.status, 0);
    assert.equal(JSON.parse(malformed.stdout).hookSpecificOutput.permissionDecision, "deny");
    assert.equal(readAudit(auditDir).filter(r => r.decision === "deny").length, 1);

    // No --config at all: nothing can be recorded, so exit 2 blocks with a stderr reason.
    const noConfig = runGuard(JSON.stringify(bashInput(ALLOWED_COMMANDS[0], { cwd: repo })));
    assert.equal(noConfig.status, 2);
    assert.match(noConfig.stderr, /blocked/);

    // A config that is not JSON blocks the same way.
    const brokenPath = path.join(root, "broken.json");
    fs.writeFileSync(brokenPath, "{oops");
    const broken = runGuard(JSON.stringify(bashInput(ALLOWED_COMMANDS[0], { cwd: repo })), { configPath: brokenPath });
    assert.equal(broken.status, 2);

    // An audit directory that cannot be created blocks EVEN AN ALLOWED COMMAND: an unaudited pass
    // would execute something the invoke-time veto could never see.
    const wedge = path.join(root, "wedge");
    fs.writeFileSync(wedge, "not a directory");
    const wedgedConfig = path.join(root, "wedged.json");
    fs.writeFileSync(wedgedConfig, JSON.stringify({
      repoRootResolved: repo, auditDir: path.join(wedge, "audit"), allowedCommands: [...ALLOWED_COMMANDS],
    }));
    const wedged = runGuard(JSON.stringify({
      tool_name: "Bash", tool_input: { command: ALLOWED_COMMANDS[0] }, cwd: repo,
    }), { configPath: wedgedConfig });
    assert.equal(wedged.status, 2, "an unauditable allowed command must still block");
    assert.match(wedged.stderr, /could not be audited|blocked/);
  });
});

test("guard process: audit files are write-once, uniquely named and individually parseable", () => {
  withGuardWorld(({ repo, auditDir, configPath }) => {
    for (const command of [...ALLOWED_COMMANDS, "git status"]) {
      runGuard(JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd: repo, session_id: "sess-C" }), { configPath });
    }
    const names = auditFilesIn(auditDir);
    assert.equal(names.length, 3);
    assert.equal(new Set(names).size, 3, "names must be collision-resistant");
    for (const name of names) {
      const file = path.join(auditDir, name);
      assert.ok(fs.lstatSync(file).isFile());
      assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).kind, AUDIT_KIND);
      // Write-once: the guard uses `wx`, so re-creating the same name fails rather than overwriting.
      assert.throws(() => fs.writeFileSync(file, "x", { flag: "wx" }), /EEXIST/);
    }
  });
});

// --- the per-invoke audit veto --------------------------------------------------------------------------

const auditFor = (over = {}) => ({
  name: over.name || "r.json",
  bytes: over.bytes ?? 10,
  digest: over.digest ?? "d".repeat(64),
  record: {
    kind: AUDIT_KIND, schemaVersion: 1, guardDigest: "grd", sessionId: "sess-1", toolUseId: "tu",
    command: ALLOWED_COMMANDS[0], cwd: "/repo", resolvedCwd: "/repo", expectedRoot: "/repo",
    decision: "pass", reason: "ok", at: "2026-09-07T00:00:00.000Z", pid: 1, configDigest: "cfg",
    ...over.record,
  },
});
const bothPasses = () => [
  auditFor({ name: "a.json" }),
  auditFor({ name: "b.json", record: { command: ALLOWED_COMMANDS[1] } }),
];
const veto = (records, over = {}) => validateInvokeAudit({
  records, malformed: [], unstable: null, sessionId: "sess-1", expectedRoot: "/repo",
  configDigest: "cfg", guardDigest: "grd", allowedCommands: [...ALLOWED_COMMANDS], ...over,
});

test("audit veto: exactly one pass per required command, with denies permitted", () => {
  const ok = veto(bothPasses());
  assert.equal(ok.ok, true, ok.problems.join("; "));
  assert.equal(ok.denyCount, 0);
  const withDeny = veto([...bothPasses(), auditFor({ name: "c.json", record: { decision: "deny", command: "git status" } })]);
  assert.equal(withDeny.ok, true, "deny records are evidence, not failures");
  assert.equal(withDeny.denyCount, 1);
});

test("audit veto: missing, duplicate, wrong-session, wrong-root, wrong-config and stray passes all fail", () => {
  // Missing — the hook-absent case, which looks identical to hook-allowed from the transcript.
  assert.match(veto([]).problems.join(" "), /no pass record for the required command/);
  assert.match(veto([auditFor({ name: "a.json" })]).problems.join(" "), /no pass record/);
  // Duplicate.
  assert.match(veto([...bothPasses(), auditFor({ name: "d.json" })]).problems.join(" "), /2 pass records/);
  // Wrong session, root, config digest.
  assert.match(veto(bothPasses(), { sessionId: "other" }).problems.join(" "), /is not this invocation's other/);
  assert.match(veto(bothPasses(), { expectedRoot: "/elsewhere" }).problems.join(" "), /expectedRoot/);
  assert.match(veto(bothPasses(), { configDigest: "different" }).problems.join(" "), /configDigest/);
  // A pass for something outside the allowed list.
  assert.match(
    veto([...bothPasses(), auditFor({ name: "e.json", record: { command: "git status" } })]).problems.join(" "),
    /a pass for a command outside the allowed list/,
  );
  // Malformed and unknown-shape records.
  assert.match(veto(bothPasses(), { malformed: ["x.json: bad"] }).problems.join(" "), /unreadable audit record/);
  assert.match(veto([...bothPasses(), { name: "f.json", record: null }]).problems.join(" "), /not a JSON object/);
  assert.match(
    veto([...bothPasses(), auditFor({ name: "g.json", record: { kind: "something-else" } })]).problems.join(" "),
    /kind is/,
  );
  assert.match(
    veto([...bothPasses(), auditFor({ name: "h.json", record: { decision: "maybe" } })]).problems.join(" "),
    /unknown decision/,
  );
  // A MISSING session id is now a fault, not a tolerance. Time of appearance narrows creation time;
  // it does not prove which session produced a record, and the harness mints the id itself.
  for (const absent of [null, undefined]) {
    const out = veto([auditFor({ name: "a.json", record: { sessionId: absent } }),
      auditFor({ name: "b.json", record: { command: ALLOWED_COMMANDS[1] } })]);
    assert.equal(out.ok, false, `sessionId ${String(absent)} must fail`);
    assert.match(out.problems.join(" "), /is not this invocation's sess-1/);
  }
});

test("audit veto: the trustworthy schema is enforced, and denies keep their resolvedCwd freedom", () => {
  // Semantic blockers.
  assert.match(veto([...bothPasses(), auditFor({ name: "s.json", record: { schemaVersion: 2 } })]).problems.join(" "),
    /schemaVersion is 2/);
  assert.match(veto(bothPasses(), { guardDigest: "other" }).problems.join(" "), /guardDigest is not the bound guard's/);
  // A PASS must independently corroborate the cwd the guard says it checked.
  const strayCwd = [auditFor({ name: "a.json", record: { resolvedCwd: "/elsewhere" } }),
    auditFor({ name: "b.json", record: { command: ALLOWED_COMMANDS[1] } })];
  assert.match(veto(strayCwd).problems.join(" "), /a pass whose resolvedCwd .* is not \/repo/);
  // A DENY may legitimately carry a different or null resolvedCwd — that can be the denial reason.
  assert.equal(veto([...bothPasses(),
    auditFor({ name: "c.json", record: { decision: "deny", command: "git status", resolvedCwd: "/elsewhere" } }),
    auditFor({ name: "d.json", record: { decision: "deny", command: null, resolvedCwd: null } })]).ok, true);
  // Shape-only checks.
  for (const [field, value, pattern] of [
    ["command", 7, /command is neither a string nor null/],
    ["cwd", 7, /cwd is neither a string nor null/],
    ["resolvedCwd", 7, /resolvedCwd is neither a string nor null/],
    ["toolUseId", 7, /toolUseId is neither a string nor null/],
    ["at", "not a date", /at is not a parseable timestamp/],
    ["at", "", /at is not a parseable timestamp/],
    ["pid", 0, /pid is not a positive integer/],
    ["pid", -3, /pid is not a positive integer/],
    ["pid", 1.5, /pid is not a positive integer/],
  ]) {
    const out = veto([auditFor({ name: "a.json", record: { [field]: value } }),
      auditFor({ name: "b.json", record: { command: ALLOWED_COMMANDS[1] } })]);
    assert.match(out.problems.join(" "), pattern, `${field}=${JSON.stringify(value)}`);
  }
  // …but a null toolUseId is fine: its availability in the hook payload is not established.
  assert.equal(veto([auditFor({ name: "a.json", record: { toolUseId: null } }),
    auditFor({ name: "b.json", record: { command: ALLOWED_COMMANDS[1] } })]).ok, true);
});

test("audit veto: a directory that moved while it was read vetoes the invocation", () => {
  assert.equal(auditInstabilityFault(["a"], ["a"]), null);
  assert.match(auditInstabilityFault(["a"], ["a", "b"]), /appeared: b/);
  assert.match(auditInstabilityFault(["a", "b"], ["a"]), /disappeared: b/);
  assert.match(veto(bothPasses(), { unstable: "the audit directory changed while it was being read" })
    .problems.join(" "), /changed while it was being read/);
});

// --- content-bound manifests and receipt re-verification ------------------------------------------------

test("audit manifest: deterministic, name-sorted, and sensitive to any byte", () => {
  const a = auditManifestOf([
    { name: "b.json", bytes: 2, digest: "22" }, { name: "a.json", bytes: 1, digest: "11" },
  ]);
  assert.deepEqual(a.manifest.map(e => e.name), ["a.json", "b.json"], "name-sorted");
  // Same content in a different input order gives the same aggregate.
  const b = auditManifestOf([
    { name: "a.json", bytes: 1, digest: "11" }, { name: "b.json", bytes: 2, digest: "22" },
  ]);
  assert.equal(b.manifestDigest, a.manifestDigest);
  // One byte of difference changes it.
  const c = auditManifestOf([
    { name: "a.json", bytes: 1, digest: "11" }, { name: "b.json", bytes: 3, digest: "22" },
  ]);
  assert.notEqual(c.manifestDigest, a.manifestDigest);
  assert.equal(veto(bothPasses()).manifestDigest, auditManifestOf(bothPasses()).manifestDigest);
});

test("audit names: only plain basenames inside the directory are accepted", () => {
  assert.equal(unsafeAuditName("1-2-abc.json"), null);
  // Both separator conventions, on every host: a backslash name is its own basename under POSIX
  // rules but traverses under Windows rules, so it must be refused either way. Drive-qualified and
  // UNC forms are covered for the same reason, and the dot / NUL guards are unchanged.
  for (const bad of [
    "", ".", "..", "a/b.json", "..\\b.json", "/abs.json",
    "dir\\a.json", "..\\..\\a.json", "C:\\abs.json", "C:x.json", "\\\\server\\share\\a.json",
    "a\0b.json",
  ]) {
    assert.ok(unsafeAuditName(bad), JSON.stringify(bad));
  }
  assert.ok(unsafeAuditName(7));
});

function withAuditDir(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-manifest-"));
  try {
    const write = (name, obj) => {
      const bytes = Buffer.from(`${JSON.stringify(obj, null, 2)}\n`, "utf8");
      fs.writeFileSync(path.join(dir, name), bytes);
      return { name, bytes: bytes.length, digest: require$sha256(bytes) };
    };
    body({ dir, write });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("receipt re-verification: unmodified manifests pass, and any later change is caught", () => {
  withAuditDir(({ dir, write }) => {
    const e1 = write("a.json", auditFor().record);
    const e2 = write("b.json", auditFor({ record: { command: ALLOWED_COMMANDS[1] } }).record);
    const { manifest, manifestDigest } = auditManifestOf([e1, e2]);
    assert.equal(verifyAuditManifest(dir, manifest, manifestDigest).ok, true, "untouched files must verify");

    // MUTATED after validation. `wx` stops a creation collision; it does not make a file immutable.
    fs.writeFileSync(path.join(dir, "a.json"), "tampered");
    const mutated = verifyAuditManifest(dir, manifest, manifestDigest);
    assert.equal(mutated.ok, false);
    assert.match(mutated.problems.join(" "), /a\.json: content changed since it was validated/);
    assert.equal(mutated.entries.find(e => e.name === "a.json").observedDigest !== e1.digest, true);
  });
});

test("receipt re-verification: deleted, replaced-by-directory, and tampered aggregates all refuse", () => {
  withAuditDir(({ dir, write }) => {
    const e1 = write("a.json", auditFor().record);
    const e2 = write("b.json", auditFor({ record: { command: ALLOWED_COMMANDS[1] } }).record);
    const { manifest, manifestDigest } = auditManifestOf([e1, e2]);

    fs.rmSync(path.join(dir, "b.json"));
    assert.match(verifyAuditManifest(dir, manifest, manifestDigest).problems.join(" "), /b\.json/);

    fs.mkdirSync(path.join(dir, "b.json"));
    assert.match(verifyAuditManifest(dir, manifest, manifestDigest).problems.join(" "), /not a regular file/);

    // A manifest that does not match its own recorded aggregate is refused before any file is read.
    assert.match(verifyAuditManifest(dir, manifest, "0".repeat(64)).problems.join(" "),
      /does not match its own aggregate digest/);
    // An empty manifest cannot stand in for "nothing happened".
    assert.equal(verifyAuditManifest(dir, [], manifestDigest).ok, false);
    // A duplicated entry inside one manifest is refused.
    const dup = [manifest[0], manifest[0]];
    assert.match(verifyAuditManifest(dir, dup, auditManifestOf(dup).manifestDigest).problems.join(" "),
      /listed twice in one manifest/);
  });
});

test("receipt re-verification: two invocations share one directory with disjoint manifests", () => {
  withAuditDir(({ dir, write }) => {
    const first = [write("s1-a.json", auditFor().record), write("s1-b.json", auditFor().record)];
    const second = [write("s2-a.json", auditFor({ record: { sessionId: "sess-2" } }).record)];
    const m1 = auditManifestOf(first);
    const m2 = auditManifestOf(second);
    // Each manifest verifies independently against the shared, union-containing directory.
    assert.equal(verifyAuditManifest(dir, m1.manifest, m1.manifestDigest).ok, true);
    assert.equal(verifyAuditManifest(dir, m2.manifest, m2.manifestDigest).ok, true);
    // …and they claim disjoint records, which is what stops one file counting for two sessions.
    const names1 = new Set(m1.manifest.map(e => e.name));
    assert.ok(m2.manifest.every(e => !names1.has(e.name)), "no record may belong to both sessions");
    // Touching only the second invocation's file leaves the first verifying and fails the second.
    fs.writeFileSync(path.join(dir, "s2-a.json"), "tampered");
    assert.equal(verifyAuditManifest(dir, m1.manifest, m1.manifestDigest).ok, true);
    assert.equal(verifyAuditManifest(dir, m2.manifest, m2.manifestDigest).ok, false);
  });
});

// --- receipt-time closure over the bound audit directory ------------------------------------------------
//
// Verifying claimed manifests proves only "everything I claimed is still here". These cover the two
// halves that used to fail OPEN: a successful invoke whose audit block is absent, and a directory
// entry no manifest claims.

const BOUND_DIR = "/tmp/ctide-e2eh-x/hook-audit";
const invokeEventFor = (sessionId, names, over = {}) => ({
  stage: "invoke", outcome: "ok", phase: "negative", ordinal: 1, sessionId,
  audit: {
    ok: true, auditDir: BOUND_DIR, manifestDigest: "md-" + sessionId,
    manifest: names.map(name => ({ name, bytes: 10, digest: "d".repeat(64) })),
    ...over,
  },
});
const closure = (invokes, observedNames, scenario = "fixed-point") =>
  auditClosureProblems({ scenario, invokes, boundAuditDir: BOUND_DIR, observedNames });

test("receipt closure: the expected invoke count comes from the one history table", () => {
  assert.equal(requiredInvokeCount("positive"), 1);
  assert.equal(requiredInvokeCount("fixed-point"), 2);
  assert.equal(requiredInvokeCount("no-such-scenario"), null);
  // Derived, not restated: the count must equal the `invoke:` ids in REQUIRED_HISTORY itself, so a
  // future table edit cannot leave a parallel literal behind.
  for (const scenario of ["positive", "fixed-point"]) {
    assert.equal(
      requiredInvokeCount(scenario),
      REQUIRED_HISTORY[scenario].filter(s => s.id.startsWith("invoke:")).length,
    );
  }
  assert.match(closure([], [], "no-such-scenario").problems.join(" "), /unknown scenario/);
});

test("receipt closure: an empty invocation set can never be clean", () => {
  // The exact degenerate case that previously produced `ok: true` with nothing verified.
  for (const scenario of ["positive", "fixed-point"]) {
    const out = auditClosureProblems({ scenario, invokes: [], boundAuditDir: BOUND_DIR, observedNames: [] });
    assert.ok(out.problems.length > 0, `${scenario}: an empty set must be a problem`);
    assert.match(out.problems.join(" "), /expected \d successful reviewer invocation\(s\), saw 0/);
  }
});

test("receipt closure: a successful invoke with no usable audit block is a problem, not a filter", () => {
  const good = invokeEventFor("s1", ["a.json"]);
  const observed = ["a.json"];
  for (const [what, broken] of [
    ["absent", { ...good, audit: undefined }],
    ["null", { ...good, audit: null }],
    ["an array", { ...good, audit: [] }],
    ["a string", { ...good, audit: "nope" }],
  ]) {
    const out = closure([good, broken], observed, "fixed-point");
    assert.match(out.problems.join(" "), /carries no audit block/, `audit ${what}`);
  }
  // One invoke of the two missing its block must not be silently dropped to a passing single.
  const only = closure([{ ...good, audit: undefined }], observed, "positive");
  assert.match(only.problems.join(" "), /carries no audit block/);
});

test("receipt closure: count too small or too large refuses", () => {
  const a = invokeEventFor("s1", ["a.json"]);
  const b = invokeEventFor("s2", ["b.json"]);
  const c = invokeEventFor("s3", ["c.json"]);
  assert.match(closure([a], ["a.json"]).problems.join(" "), /expected 2 successful reviewer invocation\(s\), saw 1/);
  assert.match(closure([a, b, c], ["a.json", "b.json", "c.json"]).problems.join(" "), /saw 3/);
  assert.match(
    auditClosureProblems({ scenario: "positive", invokes: [a, b], boundAuditDir: BOUND_DIR, observedNames: ["a.json", "b.json"] })
      .problems.join(" "),
    /expected 1 successful reviewer invocation\(s\), saw 2/,
  );
});

test("receipt closure: a malformed audit block's own fields are each refused", () => {
  const good = invokeEventFor("s1", ["a.json"]);
  const cases = [
    ["not ok", invokeEventFor("s2", ["b.json"], { ok: false }), /the recorded audit block is not ok/],
    ["wrong dir", invokeEventFor("s2", ["b.json"], { auditDir: "/tmp/somewhere-else" }), /is not the bound/],
    ["no digest", invokeEventFor("s2", ["b.json"], { manifestDigest: "" }), /states no manifestDigest/],
    ["empty manifest", invokeEventFor("s2", [], {}), /manifest is empty or not an array/],
    ["non-array manifest", invokeEventFor("s2", ["b.json"], { manifest: "nope" }), /manifest is empty or not an array/],
    ["unsafe name", invokeEventFor("s2", ["../escape.json"]), /not a plain basename/],
  ];
  for (const [what, broken, pattern] of cases) {
    assert.match(closure([good, broken], ["a.json", "b.json"]).problems.join(" "), pattern, what);
  }
});

test("receipt closure: valid one-session and two-session unions pass", () => {
  const one = auditClosureProblems({
    scenario: "positive", invokes: [invokeEventFor("s1", ["a.json", "b.json"])],
    boundAuditDir: BOUND_DIR, observedNames: ["b.json", "a.json"],
  });
  assert.deepEqual(one.problems, []);
  assert.deepEqual(one.claimedNames, ["a.json", "b.json"], "claimed names are sorted");
  assert.equal(one.expectedInvocations, 1);

  const two = closure(
    [invokeEventFor("s1", ["s1-a.json", "s1-b.json"]), invokeEventFor("s2", ["s2-a.json"])],
    ["s2-a.json", "s1-a.json", "s1-b.json"],
  );
  assert.deepEqual(two.problems, []);
  assert.deepEqual(two.claimedNames, ["s1-a.json", "s1-b.json", "s2-a.json"]);
});

test("receipt closure: unclaimed extras, claimed absentees and duplicate claims all refuse", () => {
  const a = invokeEventFor("s1", ["a.json"]);
  const b = invokeEventFor("s2", ["b.json"]);
  // An extra file nobody claims — the very-late straggler the immediate re-list cannot catch.
  assert.match(closure([a, b], ["a.json", "b.json", "stray.json"]).problems.join(" "),
    /audit record stray\.json is present but claimed by no invocation/);
  // A claimed record that is no longer there.
  assert.match(closure([a, b], ["a.json"]).problems.join(" "),
    /audit record b\.json is claimed but absent from/);
  // The same record claimed by two sessions, and by one session twice.
  assert.match(closure([a, invokeEventFor("s2", ["a.json"])], ["a.json"]).problems.join(" "),
    /claimed by both session s1 and session s2/);
  assert.match(closure([invokeEventFor("s1", ["a.json", "a.json"]), b], ["a.json", "b.json"]).problems.join(" "),
    /claimed twice by session s1/);
});

test("receipt closure: the directory listing rejects anything that is not a plain audit record", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-listing-"));
  try {
    fs.writeFileSync(path.join(dir, "a.json"), "{}");
    const clean = listAuditDirectory(dir);
    assert.deepEqual(clean.names, ["a.json"]);
    assert.deepEqual(clean.problems, []);

    fs.mkdirSync(path.join(dir, "sub"));
    const withDir = listAuditDirectory(dir);
    assert.deepEqual(withDir.names, ["a.json"], "a directory is not an observed record");
    assert.match(withDir.problems.join(" "), /sub: is a directory, not an audit record/);

    // Symlinks need privilege on Windows, so this branch is asserted only where it can be created.
    let linked = false;
    try { fs.symlinkSync(path.join(dir, "a.json"), path.join(dir, "link.json")); linked = true; } catch { /* unprivileged */ }
    if (linked) {
      assert.match(listAuditDirectory(dir).problems.join(" "), /link\.json: is a symbolic link/);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // An unlistable or unrecorded directory is a problem, never an empty pass.
  assert.match(listAuditDirectory(path.join(os.tmpdir(), "ctide-does-not-exist-xyz")).problems.join(" "),
    /could not be listed/);
  assert.match(listAuditDirectory("").problems.join(" "), /no bound audit directory was recorded/);
  assert.match(listAuditDirectory(null).problems.join(" "), /no bound audit directory was recorded/);
});

test("receipt closure: end to end on a real directory — a valid union passes until an extra appears", () => {
  withAuditDir(({ dir, write }) => {
    const e1 = write("s1-a.json", auditFor().record);
    const e2 = write("s2-a.json", auditFor({ record: { sessionId: "sess-2" } }).record);
    const m1 = auditManifestOf([e1]);
    const m2 = auditManifestOf([e2]);
    const invokes = [
      { stage: "invoke", outcome: "ok", sessionId: "sess-1", audit: { ok: true, auditDir: dir, manifest: m1.manifest, manifestDigest: m1.manifestDigest } },
      { stage: "invoke", outcome: "ok", sessionId: "sess-2", audit: { ok: true, auditDir: dir, manifest: m2.manifest, manifestDigest: m2.manifestDigest } },
    ];
    const listed = listAuditDirectory(dir);
    assert.deepEqual(listed.problems, []);
    const ok = auditClosureProblems({ scenario: "fixed-point", invokes, boundAuditDir: dir, observedNames: listed.names });
    assert.deepEqual(ok.problems, [], "the real union must close");
    // …and each manifest still verifies byte-for-byte against the bound directory.
    for (const m of [m1, m2]) assert.equal(verifyAuditManifest(dir, m.manifest, m.manifestDigest).ok, true);

    // Now a decision record appears that no invocation accounts for.
    write("straggler.json", auditFor({ record: { decision: "deny", command: "git status" } }).record);
    const after = listAuditDirectory(dir);
    const refused = auditClosureProblems({ scenario: "fixed-point", invokes, boundAuditDir: dir, observedNames: after.names });
    assert.match(refused.problems.join(" "), /straggler\.json is present but claimed by no invocation/);
    // The individual manifests still verify — which is exactly why closure is a separate obligation.
    for (const m of [m1, m2]) assert.equal(verifyAuditManifest(dir, m.manifest, m.manifestDigest).ok, true);
  });
});

test("audit collection: records carry their exact bytes and digest", () => {
  withAuditDir(({ dir, write }) => {
    const before = auditSnapshot(dir);
    const entry = write("new.json", auditFor().record);
    const { records, malformed, unstable } = readNewAuditRecords(dir, before);
    assert.equal(unstable, null);
    assert.deepEqual(malformed, []);
    assert.equal(records.length, 1);
    assert.equal(records[0].bytes, entry.bytes);
    assert.equal(records[0].digest, entry.digest);
    assert.equal(records[0].record.kind, AUDIT_KIND);
  });
});

test("audit veto: only records created during this invocation are read", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-auditscope-"));
  try {
    fs.writeFileSync(path.join(dir, "old.json"), JSON.stringify(auditFor().record));
    const before = auditSnapshot(dir);
    assert.deepEqual(before, ["old.json"]);
    fs.writeFileSync(path.join(dir, "new.json"), JSON.stringify(auditFor().record));
    fs.writeFileSync(path.join(dir, "bad.json"), "{not json");
    fs.mkdirSync(path.join(dir, "adir"));
    const { records, malformed } = readNewAuditRecords(dir, before);
    assert.deepEqual(records.map(r => r.name), ["new.json"], "prior records are kept but not reused");
    assert.equal(malformed.length, 2, "a broken file and a directory are both reported, not silently skipped");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- packet capability disclosure ------------------------------------------------------------------------

test("packet: discloses exactly the two runnable commands and leaks no phase or scenario", () => {
  const text = buildPacket({
    repoRoot: "/tmp/ctide-e2e-x",
    state: { taskId: "TASK-1", baseProvenance: { treeOid: "a".repeat(40) } },
    captures: [{ ordinal: 1, command: "node --test test/alpha.test.mjs", exitStatus: 1, summaryLines: ["# fail 1"], green: false }],
    shared: { block: "Shared reviewer contract:\n- be rigorous" },
    inventory: { entries: [{}] },
    emission: { artifactRawDigest: "b".repeat(64), inventoryDigest: "c".repeat(64) },
    diff: "@@ -1 +1 @@",
  });
  assert.ok(text.includes("no MCP servers are configured"));
  for (const command of ALLOWED_COMMANDS) {
    assert.ok(text.includes(`\`${command}\``), `the packet must disclose ${command}`);
  }
  assert.match(text, /Run each of them exactly once during this review/);
  assert.ok(text.includes(`— Regenerate (same scope): \`${ALLOWED_COMMANDS[0]}\``),
    "the regenerate command must be the guarded one, byte for byte");
  // Capability disclosure only: nothing about which arm of which scenario this is, or what to find.
  for (const leak of ["scenario", "fixed-point", "negative", "repaired", "scope-violation", "harness", "expected finding"]) {
    assert.ok(!text.toLowerCase().includes(leak.toLowerCase()), `packet leaks ${leak}`);
  }
  assert.ok(!text.includes("post-repair"), "no future-green leakage");
});
