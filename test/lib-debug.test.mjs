// Unit tests for cressetide/lib/debug.mjs: the CTIDE_HOOK_DEBUG switch (exactly 1/true/yes/on, any case),
// the "[ctide <entry>] <check>: <line>" format, redaction on both sinks (log and stderr), the 1 MiB
// clear-and-rewrite of the log, and that a missing or unusable temp directory never throws. In-process,
// with TEMP/TMP/TMPDIR pointed at a fresh directory per test.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tempDir, test, withEnv } from "./helpers.mjs";
import { LOG_MAX_BYTES, LOG_NAME, SWITCH_ON, createDebug, debugEnabled } from "../cressetide/lib/debug.mjs";
import { destructive } from "../cressetide/lib/guards/destructive.mjs";

// Runs fn with CTIDE_HOOK_DEBUG = `value` (undefined: unset) and the OS temp directory at `temp`;
// returns { stderr, log } — everything written to stderr, and the log's text (null when there is none).
function capture(value, fn, temp = tempDir("ctide-debug-")) {
  const written = [];
  const realWrite = process.stderr.write;
  process.stderr.write = (chunk, ...rest) => {
    written.push(String(chunk));
    const callback = rest.find((arg) => typeof arg === "function");
    if (callback) callback();
    return true;
  };
  try {
    withEnv({ CTIDE_HOOK_DEBUG: value, TEMP: temp, TMP: temp, TMPDIR: temp, CLAUDE_PROJECT_DIR: undefined }, fn);
  } finally {
    process.stderr.write = realWrite;
  }
  const logFile = path.join(temp, LOG_NAME);
  let log = null;
  try { if (fs.lstatSync(logFile).isFile()) log = fs.readFileSync(logFile, "utf8"); } catch { /* no log */ }
  return { stderr: written.join(""), log, logFile, temp };
}

test("debug switch: 1, true, TRUE, Yes and on turn it on (log line and stderr line)", () => {
  for (const value of ["1", "true", "TRUE", "Yes", "on"]) {
    const { stderr, log } = capture(value, () => {
      assert.strictEqual(debugEnabled(), true, value);
      createDebug("pre-tool-use")("plan-gate", "hello");
    });
    assert.strictEqual(log, "[ctide pre-tool-use] plan-gate: hello\n", `log for ${value}`);
    assert.strictEqual(stderr, "[ctide pre-tool-use] plan-gate: hello\n", `stderr for ${value}`);
  }
});

test("debug switch: unset, empty, a space, 0, false, off and x leave it off (no log file is created, nothing on stderr)", () => {
  for (const value of [undefined, "", " ", "0", "false", "off", "x"]) {
    const { stderr, log } = capture(value, () => {
      assert.strictEqual(debugEnabled(), false, JSON.stringify(value));
      createDebug("pre-tool-use")("plan-gate", "hello");
    });
    assert.strictEqual(log, null, `no log file for ${JSON.stringify(value)}`);
    assert.strictEqual(stderr, "", `no stderr for ${JSON.stringify(value)}`);
  }
});

test("debug switch: SWITCH_ON is the shared rule (whole-value match, case-insensitive)", () => {
  assert.deepStrictEqual(["1", "on", "ON", "yes", "True"].map((v) => SWITCH_ON.test(v)), [true, true, true, true, true]);
  assert.deepStrictEqual(["10", " on", "on ", "yes!", "enable", "2"].map((v) => SWITCH_ON.test(v)), [false, false, false, false, false, false]);
});

test("debug prefix: [ctide <entry>] <check>: <message>, one line per call, appended in order", () => {
  const { log } = capture("1", () => {
    const debug = createDebug("session-start");
    debug("failure-memory", "first");
    debug("compact-fidelity", "second\nline");
  });
  assert.strictEqual(log, "[ctide session-start] failure-memory: first\n[ctide session-start] compact-fidelity: second line\n");
});

test("debug redaction: Bearer, Authorization: and ghp_ tokens reach neither the log nor stderr", () => {
  const ghp = "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2";
  const { stderr, log } = capture("1", () => {
    createDebug("pre-tool-use")("destructive-guard", `ASK: curl -H "Authorization: Bearer sekrit-bearer-value" https://x ${ghp}`);
    createDebug("pre-tool-use")("destructive-guard", "Authorization: Basic sekrit-basic-value");
  });
  for (const [sink, text] of [["log", log], ["stderr", stderr]]) {
    assert.ok(text && text.length > 0, `${sink} was written`);
    for (const secret of ["sekrit-bearer-value", "sekrit-basic-value", ghp]) {
      assert.ok(!text.includes(secret), `${sink} must not carry ${secret}`);
    }
    assert.match(text, /\[redacted\]/, `${sink} shows the redaction`);
  }
});

test("destructive guard debug treats every non-empty value as enabled and preserves the raw-command diagnostic format — CHANGED (in-process): CTIDE_HOOK_DEBUG=0 is off, and with it on the Bearer token is redacted in both sinks", () => {
  // The old row ran the old destructive-command hook with CTIDE_HOOK_DEBUG=0 and pinned that the log and stderr carried
  // the raw command, Bearer token included. Plan "設計重點 / Debug" and P5 "Debug": only 1/true/yes/on is on,
  // and log lines are redacted first.
  const secret = "ctide-secret-token";
  const command = `git push origin main --force Authorization: Bearer ${secret}`;
  const input = { tool_name: "Bash", tool_input: { command } };
  const off = capture("0", () => assert.strictEqual(destructive(input, { debug: createDebug("pre-tool-use") })?.decision, "ask"));
  assert.strictEqual(off.log, null, "CTIDE_HOOK_DEBUG=0 writes no log");
  assert.strictEqual(off.stderr, "", "CTIDE_HOOK_DEBUG=0 writes nothing to stderr");
  const on = capture("1", () => assert.strictEqual(destructive(input, { debug: createDebug("pre-tool-use") })?.decision, "ask"));
  const both = `${on.stderr}\n${on.log}`;
  assert.match(on.stderr, /^\[ctide pre-tool-use\] destructive-guard: ASK: git push origin main --force/m);
  assert.match(on.log, /^\[ctide pre-tool-use\] destructive-guard: ASK: git push origin main --force/m);
  assert.ok(!both.includes(secret), "the Bearer token reaches neither sink");
});

test("debug line: the message is cut to 1000 characters after redaction", () => {
  const { log } = capture("1", () => createDebug("pre-tool-use")("contract-guard", "y".repeat(5000)));
  assert.strictEqual(log, `[ctide pre-tool-use] contract-guard: ${"y".repeat(1000)}\n`);
});

test("debug log: at 1 MiB the log is cleared and rewritten with the new line; below it, the line is appended", () => {
  assert.strictEqual(LOG_MAX_BYTES, 1024 * 1024);
  const full = tempDir("ctide-debug-full-");
  fs.writeFileSync(path.join(full, LOG_NAME), "z".repeat(LOG_MAX_BYTES));
  const cleared = capture("1", () => createDebug("pre-tool-use")("plan-gate", "after the clear"), full);
  const expected = "[ctide pre-tool-use] plan-gate: after the clear\n";
  assert.ok(cleared.log === expected, `the log holds only the new line (it is ${cleared.log?.length} characters)`);

  const almost = tempDir("ctide-debug-almost-");
  fs.writeFileSync(path.join(almost, LOG_NAME), "z".repeat(LOG_MAX_BYTES - 1));
  const appended = capture("1", () => createDebug("pre-tool-use")("plan-gate", "appended"), almost);
  assert.strictEqual(fs.statSync(appended.logFile).size, LOG_MAX_BYTES - 1 + "[ctide pre-tool-use] plan-gate: appended\n".length);
  assert.ok(appended.log.endsWith("z[ctide pre-tool-use] plan-gate: appended\n"), "appended after the existing text");
});

test("debug log: a nonexistent temp directory, or a temp path that is a file, never throws; stderr still gets the line", () => {
  const base = tempDir("ctide-debug-bad-");
  const missing = path.join(base, "no", "such", "dir");
  const aFile = path.join(base, "plain-file");
  fs.writeFileSync(aFile, "not a directory");
  for (const temp of [missing, aFile]) {
    const { stderr } = capture("1", () => {
      assert.doesNotThrow(() => createDebug("pre-tool-use")("plan-gate", "still fine"));
    }, temp);
    assert.strictEqual(stderr, "[ctide pre-tool-use] plan-gate: still fine\n");
  }
  assert.strictEqual(fs.existsSync(missing), false, "the missing directory is not created");
});

test("debug log: a directory sitting at the log's path is left alone (only a regular file is ever written)", () => {
  const temp = tempDir("ctide-debug-dir-");
  fs.mkdirSync(path.join(temp, LOG_NAME));
  const { stderr } = capture("1", () => createDebug("pre-tool-use")("plan-gate", "x"), temp);
  assert.strictEqual(fs.statSync(path.join(temp, LOG_NAME)).isDirectory(), true);
  assert.strictEqual(stderr, "[ctide pre-tool-use] plan-gate: x\n");
});

test("debug log: a symlink at the log's path is not followed — its 1 MiB target is neither cleared nor appended to", (t) => {
  const temp = tempDir("ctide-debug-link-");
  const victim = path.join(tempDir("ctide-debug-victim-"), "victim.txt");
  fs.writeFileSync(victim, "v".repeat(LOG_MAX_BYTES));
  try {
    fs.symlinkSync(victim, path.join(temp, LOG_NAME), "file");
  } catch (error) {
    return t.skip("cannot create a file symlink here: " + (error && error.code));
  }
  capture("1", () => createDebug("pre-tool-use")("plan-gate", "x"), temp);
  assert.strictEqual(fs.statSync(victim).size, LOG_MAX_BYTES, "the symlink target is untouched");
});

test("debug: a message that is not a string is converted, and a stderr that throws does not escape", () => {
  const { log } = capture("1", () => createDebug("pre-tool-use")("plan-gate", { toString: () => "an object" }));
  assert.strictEqual(log, "[ctide pre-tool-use] plan-gate: an object\n");
  const realWrite = process.stderr.write;
  process.stderr.write = () => { throw new Error("stderr closed"); };
  const temp = tempDir("ctide-debug-stderr-");
  try {
    withEnv({ CTIDE_HOOK_DEBUG: "1", TEMP: temp, TMP: temp, TMPDIR: temp }, () => {
      assert.doesNotThrow(() => createDebug("pre-tool-use")("plan-gate", "x"));
    });
  } finally {
    process.stderr.write = realWrite;
  }
});
