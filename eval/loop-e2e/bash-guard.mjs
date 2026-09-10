// The harness-owned PreToolUse Bash boundary.
//
// WHY THIS EXISTS. Live probes established that in this environment `--allowed-tools` entries of the
// form `Bash(<exact command>)` are NOT an exclusive allowlist: with `--restricted`, `--tools` naming
// Bash, and either `dontAsk` or `manual`, an unlisted `git status` still executed and
// `permissionDenialCount` stayed 0. Restricted mode DID confine the file tools — an absolute Read of
// a sibling temp directory was denied — so the denial machinery works; it is specifically unlisted
// Bash commands that are not gated. This guard is therefore the actual Bash deny boundary, and the
// CLI allow-list is retained only as declared intent.
//
// STRICTLY SUBTRACTIVE. An allowed call produces NO permission decision, so native processing
// continues; the guard can only ever remove permission, never grant it. A bug here can over-deny
// (fail-closed) but cannot over-grant.
//
// STRUCTURALLY FAIL-CLOSED, and deliberately unlike the shipped product hooks. Those end
// `catch (e) { … } return process.exit(0)` — no output, i.e. ALLOW — which is the documented
// fail-open posture of a workflow aid (`docs/runtime-contract.md:60-63`). Copying that shape would
// silently open Bash on any internal error. Here every error path blocks instead: the decision starts
// at deny, an `uncaughtException` handler blocks, and an audit that cannot be written blocks with
// exit 2 even though the decision itself may have been `pass` — an unaudited pass would execute a
// command the invoke-time audit veto could never see.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * THE SOURCE OF TRUTH for what this reviewer may execute. Byte-exact strings; the harness's argv
 * rules, its own `git diff` invocation and the packet's regenerate/capability text are all derived
 * from this list so they cannot drift apart.
 *
 * `--no-ext-diff --no-textconv` are not cosmetic: without them `git diff` can invoke an external diff
 * driver or a textconv filter configured in a global gitconfig, which would run arbitrary code that
 * exact-command matching alone does not close.
 */
export const ALLOWED_COMMANDS = Object.freeze([
  "git diff --no-ext-diff --no-textconv -- test/alpha.test.mjs",
  "node --test test/alpha.test.mjs",
]);

export const AUDIT_KIND = "ctide-bash-guard-decision";
export const DECISION_PASS = "pass";
export const DECISION_DENY = "deny";
export const DECISION_IGNORE = "ignore";

const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const isPlainObject = v => v !== null && typeof v === "object" && !Array.isArray(v);
const isText = v => typeof v === "string" && v !== "";

/**
 * Resolved-root equality. Case-insensitive ONLY on Windows, where `%TEMP%` is routinely a junction or
 * an 8.3 short name and the two sides can differ in case for the same directory. On a case-sensitive
 * filesystem a case difference is a different path and must not be folded away.
 */
export function sameResolvedRoot(a, b) {
  if (!isText(a) || !isText(b)) return false;
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** null when the config is usable, otherwise the reason it is not. */
export function configFault(config) {
  if (!isPlainObject(config)) return "the guard config is not a JSON object";
  if (!isText(config.repoRootResolved)) return "the guard config states no repoRootResolved";
  if (!isText(config.auditDir)) return "the guard config states no auditDir";
  // The guard digest travels in the config so every audit record can carry it without the guard
  // re-hashing itself on each call. The harness verifies the config digest and the guard digest
  // separately at invoke time, so a record that copies this value ties the two together.
  if (!isText(config.guardDigest)) return "the guard config states no guardDigest";
  if (!Array.isArray(config.allowedCommands) || config.allowedCommands.length === 0) {
    return "the guard config states no allowedCommands";
  }
  if (config.allowedCommands.some(c => !isText(c))) return "an allowedCommands entry is not a non-empty string";
  return null;
}

const deny = reason => ({ decision: DECISION_DENY, reason });

/**
 * The pure decision. No trimming, splitting, normalising, case folding, prefixes, regexes or globs —
 * the entire command string must equal a listed value byte for byte, and the resolved cwd must be the
 * expected reviewer repository root.
 *
 * A non-Bash tool falls through and is NEVER denied: this guard is registered on a `Bash` matcher, and
 * denying anything else would break the reviewer's Read/Grep/Glob.
 */
export function decide({ input, config, resolvedCwd }) {
  // IDENTIFY THE TOOL FIRST, before the config is even looked at. A non-Bash tool must fall through
  // even when the config is missing or broken: the point of this rule is that a config regression
  // cannot take out the reviewer's Read/Grep/Glob, and validating config first did exactly that.
  if (!isPlainObject(input)) return deny("the hook input is not a JSON object");
  if (typeof input.tool_name !== "string") return deny("the hook input states no tool_name");
  if (input.tool_name !== "Bash") return { decision: DECISION_IGNORE, reason: null };

  const fault = configFault(config);
  if (fault !== null) return deny(fault);

  if (!isPlainObject(input.tool_input)) return deny("the Bash hook input states no tool_input object");
  const command = input.tool_input.command;
  if (typeof command !== "string") return deny("the Bash tool_input states no command string");
  if (!isText(input.cwd)) return deny("the hook input states no cwd");
  if (!isText(resolvedCwd)) return deny("the observed cwd could not be resolved to a real path");

  if (!config.allowedCommands.includes(command)) {
    return deny("the command is not one of this handoff's exact allowed commands");
  }
  if (!sameResolvedRoot(resolvedCwd, config.repoRootResolved)) {
    return deny("the resolved cwd is not the expected reviewer repository root");
  }
  return { decision: DECISION_PASS, reason: "an exact allowed command in the expected repository" };
}

/** The current structured PreToolUse deny shape, matching what this repository's own hooks emit. */
export const denyPayload = reason => ({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: `ctide bash-guard: ${reason}. This handoff allows exactly two commands; `
      + "everything else is blocked.",
  },
});

export function auditRecord({ input, config, configDigest, resolvedCwd, verdict }) {
  const toolInput = isPlainObject(input) && isPlainObject(input.tool_input) ? input.tool_input : {};
  return {
    kind: AUDIT_KIND,
    schemaVersion: 1,
    guardDigest: isPlainObject(config) && isText(config.guardDigest) ? config.guardDigest : null,
    sessionId: isPlainObject(input) && isText(input.session_id) ? input.session_id : null,
    toolUseId: isPlainObject(input) && isText(input.tool_use_id) ? input.tool_use_id : null,
    command: typeof toolInput.command === "string" ? toolInput.command : null,
    cwd: isPlainObject(input) && typeof input.cwd === "string" ? input.cwd : null,
    resolvedCwd: isText(resolvedCwd) ? resolvedCwd : null,
    expectedRoot: isPlainObject(config) && isText(config.repoRootResolved) ? config.repoRootResolved : null,
    decision: verdict.decision,
    reason: verdict.reason,
    at: new Date().toISOString(),
    pid: process.pid,
    configDigest,
  };
}

// ONE WRITE-ONCE FILE PER DECISION. No shared append file: concurrent Bash calls would race on it,
// and "an audit write failure blocks" would then turn that race into a spurious denial. A
// collision-resistant name plus `wx` removes the race entirely. No retry — a failure blocks.
export function writeAuditRecord(auditDir, record) {
  fs.mkdirSync(auditDir, { recursive: true });
  const name = `${Date.now()}-${process.pid}-${crypto.randomUUID()}.json`;
  const file = path.join(auditDir, name);
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return file;
}

const flagValue = (argv, name) => {
  const at = argv.indexOf(name);
  if (at === -1) return null;
  const value = argv[at + 1];
  return typeof value === "string" && !value.startsWith("--") ? value : null;
};

// Exit 2 blocks the tool even when nothing could be recorded. Used only when the guard cannot reach a
// recorded decision at all — an unreadable config, an unwritable audit directory, or an internal
// failure. Never silent.
function blockWithoutAudit(reason) {
  try { process.stderr.write(`ctide bash-guard: blocked — ${reason}\n`); } catch { /* nothing left to do */ }
  return 2;
}

const MAX_STDIN = 5 * 1024 * 1024;
export const DEFAULT_STDIN_TIMEOUT_MS = 10_000;

/**
 * Bounded read. Without a deadline a stdin that never closes hangs the guard, and what the CLI does
 * with a hung hook is not something this harness can observe — a timeout that is treated as a
 * non-blocking error would be a fail-open path invisible from outside. The stream is injectable so
 * the deadline can be exercised without a child process, though an in-process test cannot observe
 * the event-loop lifetime property below; the child-process regressions in the sentinel slice do.
 */
export function readStreamWithTimeout(stream, timeoutMs) {
  return new Promise(resolve => {
    const chunks = [];
    let total = 0;
    let settled = false;
    const finish = timedOut => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ bytes: Buffer.concat(chunks), timedOut });
    };
    // REFERENCED ON PURPOSE. This timer is the only thing that can settle the promise when the
    // stream never ends, so it must hold the event loop open until the deadline. It previously
    // called `unref()`, and with nothing else referenced — a bare stream holds no libuv handle —
    // the loop drained first and the promise never settled at all: the process exited 0 with no
    // result, which for a PreToolUse hook is the fail-open direction. `unref()` was also redundant,
    // because `finish` clears the timer on every settle path, so it can never delay a real exit.
    const timer = setTimeout(() => finish(true), timeoutMs);
    stream.on("data", chunk => {
      total += chunk.length;
      if (total > MAX_STDIN) { chunks.length = 0; finish(false); return; }
      chunks.push(chunk);
    });
    stream.on("end", () => finish(false));
    stream.on("error", () => finish(false));
  });
}

export async function main(argv, { stdin = process.stdin } = {}) {
  let config = null;
  let configDigest = null;
  try {
    // STDIN FIRST. A non-Bash tool is identified and released before the config is read, so a broken
    // config cannot block an unrelated tool.
    const override = Number.parseInt(flagValue(argv, "--stdin-timeout-ms") || "", 10);
    const { bytes, timedOut } = await readStreamWithTimeout(
      stdin, Number.isInteger(override) && override > 0 ? override : DEFAULT_STDIN_TIMEOUT_MS,
    );
    if (timedOut) return blockWithoutAudit("the hook input did not arrive within the guard's deadline");

    let input = null;
    try { input = JSON.parse(bytes.toString("utf8")); } catch { input = null; }
    if (isPlainObject(input) && typeof input.tool_name === "string" && input.tool_name !== "Bash") {
      return 0; // not this guard's business: no config, no audit, no output
    }

    // From here the call is Bash, or is unidentifiable under a Bash matcher and therefore treated as
    // Bash. Either way the config is required, and a broken one blocks with exit 2.
    const configPath = flagValue(argv, "--config");
    if (configPath === null) return blockWithoutAudit("no --config path was supplied");
    let configBytes;
    try {
      configBytes = fs.readFileSync(configPath);
    } catch (error) {
      return blockWithoutAudit(`the guard config could not be read (${error && error.code})`);
    }
    configDigest = sha256(configBytes);
    try {
      config = JSON.parse(configBytes.toString("utf8"));
    } catch {
      return blockWithoutAudit("the guard config is not valid JSON");
    }
    const fault = configFault(config);
    if (fault !== null) return blockWithoutAudit(fault);

    let resolvedCwd = null;
    if (isPlainObject(input) && isText(input.cwd)) {
      try { resolvedCwd = fs.realpathSync(input.cwd); } catch { resolvedCwd = null; }
    }

    const verdict = decide({ input, config, resolvedCwd });
    // A non-Bash tool is not this guard's business: no decision, no output, no audit record.
    if (verdict.decision === DECISION_IGNORE) return 0;

    // THE AUDIT COMES FIRST, on both branches. An unaudited pass would execute a command the
    // invoke-time veto could never see, so a failed write blocks even a legitimate command.
    try {
      writeAuditRecord(config.auditDir, auditRecord({ input, config, configDigest, resolvedCwd, verdict }));
    } catch (error) {
      return blockWithoutAudit(`the decision could not be audited (${error && (error.code || error.message)})`);
    }

    if (verdict.decision === DECISION_PASS) return 0; // no output: native processing continues
    process.stdout.write(JSON.stringify(denyPayload(verdict.reason)));
    return 0;
  } catch (error) {
    return blockWithoutAudit(`internal guard failure (${error && error.message ? error.message : error})`);
  }
}

function invokedDirectly() {
  if (!process.argv[1]) return false;
  try { return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
}

// Fail closed on anything that escapes `main`, while giving the diagnostic a chance to flush. Exit 2
// is guaranteed three ways — the write callback, a short unref'd fallback, and `process.exitCode` —
// so a lost message can never turn into a lost denial.
function exitBlocked(message) {
  process.exitCode = 2;
  try {
    process.stderr.write(`ctide bash-guard: blocked — ${message}\n`, () => process.exit(2));
    const fallback = setTimeout(() => process.exit(2), 200);
    if (typeof fallback.unref === "function") fallback.unref();
  } catch {
    process.exit(2);
  }
}

if (invokedDirectly()) {
  process.on("uncaughtException", error => {
    exitBlocked(`uncaught ${error && error.message ? error.message : error}`);
  });
  process.on("unhandledRejection", error => {
    exitBlocked(`unhandled rejection ${error && error.message ? error.message : error}`);
  });
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => {
    process.exitCode = blockWithoutAudit(`internal guard failure (${error && error.message ? error.message : error})`);
  });
}
