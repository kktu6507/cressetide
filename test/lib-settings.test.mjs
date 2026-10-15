// Unit tests for cressetide/lib/settings.mjs: the tri-state guard flags, the project root a hook event
// resolves to, the 1 MiB stat-before-read cap, and the settings.local.json-over-settings.json precedence
// with its fail-safe ("any problem means not disabled"). In-process.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tempDir, test, withEnv, write } from "./helpers.mjs";
import {
  GUARD_KEYS, SETTINGS_FILES, SETTINGS_MAX_BYTES, guardDisabled, guardFlags, projectRoot, readGuardFlag, readSettingsFile, triState,
} from "../cressetide/lib/settings.mjs";

const noProjectDir = (fn) => withEnv({ CLAUDE_PROJECT_DIR: undefined }, fn);

test("GUARD_KEYS and SETTINGS_FILES: the four switches, and local before project", () => {
  assert.deepStrictEqual([...GUARD_KEYS], ["planGate", "destructiveGuard", "contractGuard", "preserveOnCompact"]);
  assert.deepStrictEqual([...SETTINGS_FILES], ["settings.local.json", "settings.json"]);
  assert.strictEqual(SETTINGS_MAX_BYTES, 1024 * 1024);
});

test("triState: only the booleans true and false are claims", () => {
  assert.strictEqual(triState(true), true);
  assert.strictEqual(triState(false), false);
  for (const value of [undefined, null, 0, 1, "", "false", "true", {}, []]) assert.strictEqual(triState(value), undefined, JSON.stringify(value));
});

test("projectRoot: CLAUDE_PROJECT_DIR, else a non-empty string event cwd, else process.cwd() only when asked", () => {
  withEnv({ CLAUDE_PROJECT_DIR: "/env/root" }, () => {
    assert.strictEqual(projectRoot({ cwd: "/event/cwd" }), "/env/root");
  });
  noProjectDir(() => {
    assert.strictEqual(projectRoot({ cwd: "/event/cwd" }), "/event/cwd");
    assert.strictEqual(projectRoot({}), "");
    assert.strictEqual(projectRoot({ cwd: "" }), "");
    assert.strictEqual(projectRoot({ cwd: 5 }), "", "a non-string cwd is not a root");
    assert.strictEqual(projectRoot(undefined), "");
    assert.strictEqual(projectRoot({}, { processCwdFallback: true }), process.cwd());
    assert.strictEqual(projectRoot({ cwd: "/event/cwd" }, { processCwdFallback: true }), "/event/cwd");
  });
  withEnv({ CLAUDE_PROJECT_DIR: "" }, () => assert.strictEqual(projectRoot({ cwd: "/event/cwd" }), "/event/cwd", "an empty CLAUDE_PROJECT_DIR is no root"));
});

test("readSettingsFile: the text of a file up to 1 MiB; null for a missing file, a directory, or anything larger", () => {
  const dir = tempDir("ctide-settings-");
  const atCap = path.join(dir, "at-cap.json");
  fs.writeFileSync(atCap, "x".repeat(SETTINGS_MAX_BYTES));
  assert.strictEqual(readSettingsFile(atCap)?.length, SETTINGS_MAX_BYTES);
  const over = path.join(dir, "over.json");
  fs.writeFileSync(over, "x".repeat(SETTINGS_MAX_BYTES + 1));
  assert.strictEqual(readSettingsFile(over), null);
  assert.strictEqual(readSettingsFile(path.join(dir, "missing.json")), null);
  assert.strictEqual(readSettingsFile(dir), null);
});

test("guardFlags: per-key tri-state; a bare false ctide, a bare false document, an array or non-JSON are no claims", () => {
  assert.deepStrictEqual(guardFlags(JSON.stringify({ ctide: { planGate: false, contractGuard: true, destructiveGuard: "false" } })),
    { planGate: false, destructiveGuard: undefined, contractGuard: true, preserveOnCompact: undefined });
  const none = { planGate: undefined, destructiveGuard: undefined, contractGuard: undefined, preserveOnCompact: undefined };
  assert.deepStrictEqual(guardFlags(JSON.stringify({ ctide: false })), none);
  assert.deepStrictEqual(guardFlags("false"), none);
  assert.deepStrictEqual(guardFlags("[1,2,3]"), none);
  assert.deepStrictEqual(guardFlags("{ not json"), {});
  assert.deepStrictEqual(guardFlags(null), {});
});

test("readGuardFlag: the flag from one file; an oversized file is ignored even when it sets the flag", () => {
  const dir = tempDir("ctide-settings-");
  const file = path.join(dir, "settings.json");
  fs.writeFileSync(file, JSON.stringify({ ctide: { planGate: false } }));
  assert.strictEqual(readGuardFlag(file, "planGate"), false);
  assert.strictEqual(readGuardFlag(file, "destructiveGuard"), undefined);
  fs.writeFileSync(file, JSON.stringify({ ctide: { planGate: false }, pad: "x".repeat(SETTINGS_MAX_BYTES) }));
  assert.strictEqual(readGuardFlag(file, "planGate"), undefined, "a file over 1 MiB is never read");
  assert.strictEqual(readGuardFlag(path.join(dir, "missing.json"), "planGate"), undefined);
});

for (const [label, local, project, expected] of [
  ["project false, no local file: disabled", undefined, { ctide: { planGate: false } }, true],
  ["local false over project true: disabled", { ctide: { planGate: false } }, { ctide: { planGate: true } }, true],
  ["local true over project false: not disabled (a lower file cannot flip it back)", { ctide: { planGate: true } }, { ctide: { planGate: false } }, false],
  ["local without the key defers to project false: disabled", { ctide: { contractGuard: false } }, { ctide: { planGate: false } }, true],
  ["malformed project file: not disabled", undefined, "{ not: valid json ", false],
  ["malformed local file defers to project false: disabled", "{ nope", { ctide: { planGate: false } }, true],
  ["bare false ctide: not disabled", undefined, { ctide: false }, false],
  ["bare false document: not disabled", undefined, "false", false],
  ["oversized project file setting false: not disabled", undefined, JSON.stringify({ ctide: { planGate: false }, pad: "x".repeat(SETTINGS_MAX_BYTES) }), false],
  ["no settings files: not disabled", undefined, undefined, false],
]) {
  test(`guardDisabled: ${label}`, () => {
    const root = tempDir("ctide-settings-root-");
    if (local !== undefined) write(path.join(root, ".claude", "settings.local.json"), typeof local === "string" ? local : JSON.stringify(local));
    if (project !== undefined) write(path.join(root, ".claude", "settings.json"), typeof project === "string" ? project : JSON.stringify(project));
    assert.strictEqual(noProjectDir(() => guardDisabled({ cwd: root }, "planGate")), expected, "via the event cwd");
    assert.strictEqual(withEnv({ CLAUDE_PROJECT_DIR: root }, () => guardDisabled({ cwd: tempDir() }, "planGate")), expected, "via CLAUDE_PROJECT_DIR, which wins over the event cwd");
  });
}

test("guardDisabled: no root at all is not disabled; process.cwd() is consulted only with processCwdFallback", () => {
  const root = tempDir("ctide-settings-cwd-");
  write(path.join(root, ".claude", "settings.json"), JSON.stringify({ ctide: { preserveOnCompact: false } }));
  const previous = process.cwd();
  process.chdir(root);
  try {
    noProjectDir(() => {
      assert.strictEqual(guardDisabled({}, "preserveOnCompact"), false, "a PreToolUse-style check never falls back to process.cwd()");
      assert.strictEqual(guardDisabled({}, "preserveOnCompact", { processCwdFallback: true }), true, "a SessionStart-style check does");
    });
  } finally {
    process.chdir(previous);
  }
});

test("guardDisabled: an event whose fields throw on access is not disabled (never a throw)", () => {
  const hostile = new Proxy({}, { get() { throw new Error("boom"); } });
  assert.strictEqual(noProjectDir(() => guardDisabled(hostile, "planGate")), false);
});
