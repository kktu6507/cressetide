// Manual staged driver for the actual-reviewer E2E.
//
// NOT A TEST. Importing this module performs no work and launches no process; only a direct CLI
// invocation runs a stage. The one stage that spawns a real Claude process is `invoke`, and it is
// reachable only by typing it with an explicit absolute `--claude` path. `node --test` and
// `eval/run-eval.mjs` therefore cannot invoke a model through this file, by construction rather than
// by convention.
//
// TWO ROOTS. `--root` is always the HARNESS root (`ctide-e2eh-*`), which holds state, packets, raw
// reviewer output, slices and the receipt. The REVIEWER REPO (`ctide-e2e-*`) is recorded inside that
// state and is the only path the reviewer ever receives. Nothing the reviewer can read names a
// scenario, a phase or an expected finding.
//
// TERMINAL FAILURE IS THE CENTRAL RULE. A non-zero reviewer process, an unusable capture, a
// controller refusal, a missing required finding or an unexpected consumer result is recorded ONCE as
// a durable event and then permanently stops the scenario: `assertContinuable` gates every stage that
// could otherwise spend another reviewer call or move product state. There is no retry, no packet
// tuning, and no walking past a dead phase into the next one.
//
// An UNMATCHED START MARKER is terminal too, and derived rather than recorded. An `invoke-start` with
// no matching `invoke` completion, or a `gate-start` with no successful `gate`, means the harness
// never learned what happened — so the whole scenario stops, not just that phase. Blocking only the
// marker's own phase was a real hole: after a crash in the negative phase, `repair` would move to
// `repaired` and a SECOND paid reviewer call would run.
//
// STREAM ATTRIBUTION. This harness spawns with `shell:false` and reads `stdout`/`stderr` as separate
// Buffers, so it CAN attribute them, and it requires exactly one parseable payload across the two.
// The `arbiter` agent explicitly cannot and does not claim to
// (`cressetide/agents/arbiter.agent.md`, *Test-provenance gate*). These are different observers; the
// harness's ability here is never evidence about the agent's.
import assert from "node:assert";
import cp from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loopPaths } from "../../cressetide/skills/vigil/scripts/test-provenance-loop-state.mjs";
import { buildTestProvenanceBlock } from "../../cressetide/skills/vigil/scripts/test-provenance-block.mjs";
import { ALLOWED_COMMANDS, AUDIT_KIND, sameResolvedRoot } from "./bash-guard.mjs";
import { FAULT_KINDS, sliceReviewBatch } from "./sentinel-slice.mjs";
import {
  ASSUM_A, CAPTURE_DIR, HARNESS_PREFIX, REPO_PREFIX, SCENARIOS, TEST_PATH, applyHead, attachRepo,
  captureRelPath, captureSuiteRun, checkedTempChild, createScenarioWorld, driftInScope, readTestBytes,
  revertDrift, writeCaptureFile,
} from "./scenario-repo.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const PLUGIN_DIR = path.join(REPO, "cressetide");
const CONTROLLER = path.join(PLUGIN_DIR, "skills", "vigil", "scripts", "test-provenance-loop.mjs");
const LEDGER_CLI = path.join(PLUGIN_DIR, "skills", "vigil", "scripts", "run-ledger.mjs");
const REVIEW_PACKET = path.join(PLUGIN_DIR, "skills", "vigil", "references", "review-packet.md");
const ARTIFACT_REL = ".ctide/output/changed-test-inventory.json";
const LEDGER_REL = ".ctide/ledger/runs.jsonl";

const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const readBytes = file => fs.readFileSync(file);

// --- classified faults --------------------------------------------------------------------------------

export const INGEST_FAULT_CLASSES = Object.freeze([
  "source-missing", "not-regular-file", "outside-root", "source-unreadable", "binding-mismatch",
  "slice-duplicated", "slice-missing", "slice-misordered", "slice-empty", "persist-failed", "unexpected",
]);

const fault = (faultClass, message, detail = null) =>
  Object.assign(new Error(message), { faultClass, faultDetail: detail });

/** A stable class for any error reaching an ingest catch, so the recorded event is machine-readable. */
export function classifyIngestFault(error) {
  const named = error && typeof error.faultClass === "string" ? error.faultClass : "unexpected";
  return INGEST_FAULT_CLASSES.includes(named) ? named : "unexpected";
}

// --- path safety --------------------------------------------------------------------------------------

const lexicallyInside = (root, target) => {
  const rel = path.relative(root, path.resolve(target));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

// For paths that must ALREADY exist. Lexical containment alone is not enough: a symlink or junction
// inside the root can resolve outside it, so the real path is what is checked, and the entry must be
// a regular file rather than a link, directory or device. Every refusal carries a fault class so an
// ingest catch can record precisely why the source was rejected.
function containedExistingFile(root, target) {
  const resolved = path.resolve(target);
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch (error) {
    throw fault("source-missing", `${resolved} cannot be inspected (${error.code})`, { path: resolved, code: error.code });
  }
  if (!stat.isFile()) throw fault("not-regular-file", `refusing ${resolved}: not a regular file`, { path: resolved });
  let real;
  try {
    real = fs.realpathSync(resolved);
  } catch (error) {
    throw fault("source-unreadable", `${resolved} cannot be resolved (${error.code})`, { path: resolved, code: error.code });
  }
  if (!lexicallyInside(root, real)) throw fault("outside-root", `refusing ${real}: outside ${root}`, { path: real, root });
  return real;
}

// For paths this harness is about to CREATE. Realpath cannot be taken before the file exists, so the
// protection is exclusive creation instead: a pre-planted file or symlink raises EEXIST rather than
// being overwritten or followed.
function createNew(root, target, bytes) {
  const resolved = path.resolve(target);
  assert.ok(lexicallyInside(root, resolved), `refusing ${resolved}: outside ${root}`);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, bytes, { flag: "wx" });
  return resolved;
}

const assertHarnessRoot = root => checkedTempChild(root, HARNESS_PREFIX);
const assertRepoRoot = repo => checkedTempChild(repo, REPO_PREFIX);

// --- state ------------------------------------------------------------------------------------------

const statePath = root => path.join(root, "state.json");
const loadState = root => JSON.parse(fs.readFileSync(statePath(root), "utf8"));
// The state file is the one deliberately rewritable artefact; every evidence file is write-once.
function saveState(root, state) {
  fs.writeFileSync(statePath(root), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return state;
}
function record(state, event) {
  const stamped = { at: new Date().toISOString(), ordinal: state.events.length + 1, ...event };
  state.events.push(stamped);
  return stamped;
}

// --- the central terminal rule (pure) ------------------------------------------------------------------
//
// One definition of "this scenario has stopped", consulted by every stage that could spend another
// reviewer call or move product state. `repair` is included deliberately: without it, a dead negative
// phase could be walked past into a second paid invoke, and only `gate` would notice — after the
// money was spent.

export const TERMINAL_OUTCOMES = Object.freeze(["unusable", "product-failure"]);

// A DERIVED terminal condition with no event of its own: a start marker that was written but whose
// completion never arrived. Named so the receipt can distinguish "the reviewer failed" from "we never
// learned whether the reviewer ran".
export const INCOMPLETE_OUTCOME = "incomplete-attempt";

const positionOf = (event, index) => event.ordinal ?? index + 1;

/**
 * Start markers with no matching completion.
 *
 * PAIRING RULE. `invoke-start(P, S)` is paired only by a LATER `invoke` with the same phase AND the
 * same sessionId — whatever that completion's outcome. A completed-but-failed invoke is already
 * terminal through its own `product-failure` outcome, and calling it "incomplete" would misreport a
 * reviewer failure as a crash. A phase or session mismatch does not pair, because that is exactly the
 * mis-recorded-attempt case the rule exists to catch. `gate-start` is paired only by a LATER `gate`
 * whose `outcome === "ok"`; `gate` records no failure event of its own, so an orphan covers both a
 * crash and a post-marker assertion failure, and both must stop the scenario.
 */
export function incompleteAttempts(events) {
  const found = [];
  events.forEach((event, index) => {
    const at = positionOf(event, index);
    if (event.stage === "invoke-start") {
      const paired = events.some((later, laterIndex) => laterIndex > index
        && later.stage === "invoke" && later.phase === event.phase && later.sessionId === event.sessionId);
      if (!paired) {
        found.push({
          at, stage: "invoke-start", kind: "invoke", outcome: INCOMPLETE_OUTCOME,
          phase: event.phase ?? null, sessionId: event.sessionId ?? null,
          ordinal: event.ordinal ?? null, fault: null,
          message: `the reviewer attempt started at event ${at} (phase ${event.phase}, session `
            + `${event.sessionId}) has no matching invoke completion`,
        });
      }
    }
    if (event.stage === "gate-start") {
      const paired = events.some((later, laterIndex) => laterIndex > index
        && later.stage === "gate" && later.outcome === "ok");
      if (!paired) {
        found.push({
          at, stage: "gate-start", kind: "gate", outcome: INCOMPLETE_OUTCOME,
          phase: event.phase ?? null, sessionId: null, ordinal: event.ordinal ?? null, fault: null,
          message: `the gate started at event ${at} has no matching successful gate completion`,
        });
      }
    }
  });
  return found;
}

/**
 * The EARLIEST terminal condition — a recorded terminal outcome or a derived incomplete attempt —
 * ordered by real event position so "stopped at event N" is truthful when both kinds coexist.
 */
export function terminalFailure(events) {
  const candidates = [];
  events.forEach((event, index) => {
    if (TERMINAL_OUTCOMES.includes(event.outcome)) {
      candidates.push({
        at: positionOf(event, index),
        stage: event.stage, kind: event.stage, phase: event.phase ?? null, outcome: event.outcome,
        sessionId: event.sessionId ?? null, ordinal: event.ordinal ?? null,
        fault: event.fault ?? null, message: event.message ?? null,
      });
    }
  });
  candidates.push(...incompleteAttempts(events));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.at - b.at);
  return candidates[0];
}

export function continuableFault(events) {
  const terminal = terminalFailure(events);
  if (terminal === null) return null;
  const detail = terminal.outcome === INCOMPLETE_OUTCOME
    ? `${terminal.stage}${terminal.sessionId ? ` session ${terminal.sessionId}` : ""}, outcome ${INCOMPLETE_OUTCOME}`
    : `${terminal.stage}, outcome ${terminal.outcome}${terminal.fault ? `, fault ${terminal.fault}` : ""}`;
  return `this scenario stopped at event ${terminal.at} (${detail}); no stage may proceed, and no phase `
    + "may be started to work around it";
}

function assertContinuable(events) {
  const reason = continuableFault(events);
  assert.strictEqual(reason, null, reason || "");
}

/**
 * One attempt per slot. An omitted `phase` means a STAGE-GLOBAL slot — one per scenario — matched on
 * the stage alone. That is what makes `repair` and `stale-submit` one-shot regardless of whether their
 * records happen to carry a phase field; relying on `undefined === undefined` matched only by accident
 * and broke the moment a record gained a phase.
 */
export function attemptBlockedReason(events, stage, phase) {
  const stageGlobal = phase === undefined;
  const prior = stageGlobal
    ? events.filter(e => e.stage === stage)
    : events.filter(e => e.stage === stage && e.phase === phase);
  if (prior.length === 0) return null;
  return stageGlobal
    ? `${stage} already has an event (outcome ${prior[0].outcome}); it holds one stage-global slot per scenario`
    : `phase ${phase} already has a ${stage} event (outcome ${prior[0].outcome}); one attempt per phase`;
}

export function invokeBlockedReason(events, phase) {
  const terminal = continuableFault(events);
  if (terminal !== null) return terminal;
  const prior = events.filter(e => (e.stage === "invoke-start" || e.stage === "invoke") && e.phase === phase);
  if (prior.length === 0) return null;
  return `phase ${phase} already has ${[...new Set(prior.map(e => e.stage))].join(" and ")}; `
    + "one reviewer attempt per phase, no retries";
}

export function gateBlockedReason(events) {
  const terminal = continuableFault(events);
  if (terminal !== null) return terminal;
  const prior = events.filter(e => e.stage === "gate-start" || e.stage === "gate");
  if (prior.length === 0) return null;
  return `gate has already been attempted (${prior.map(e => e.stage).join(", ")}); `
    + "one scenario gets one collection and one ledger append";
}

// --- the shipped Shared reviewer contract block -------------------------------------------------------

export function extractSharedContract() {
  const whole = readBytes(REVIEW_PACKET);
  const lines = whole.toString("utf8").split(/\r?\n/);
  const start = lines.findIndex(line => line.trim() === "Shared reviewer contract:");
  assert.ok(start !== -1, "review-packet.md no longer carries a 'Shared reviewer contract:' label");
  let fence = -1;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "```") { fence = i; break; }
  }
  assert.ok(fence !== -1, "the Shared reviewer contract block is not closed by a fence");
  const block = lines.slice(start, fence).join("\n");
  assert.ok(block.split("\n").filter(l => l.startsWith("- ")).length >= 10,
    "the extracted block lost its bullets; the boundary moved");
  return {
    block,
    firstLine: start + 1,
    lastLine: fence,
    blockDigest: sha256(Buffer.from(block, "utf8")),
    reviewPacketDigest: sha256(whole),
  };
}

// --- the real controller, over its real CLI ------------------------------------------------------------

function parseOne(buffer) {
  if (!buffer || buffer.length === 0) return { present: false, value: null };
  try { return { present: true, value: JSON.parse(buffer.toString("utf8")) }; } catch { return { present: false, value: null }; }
}

function controller(root, op, taskId) {
  const argv = [CONTROLLER, op, "--cwd", root, "--task", taskId];
  const run = cp.spawnSync(process.execPath, argv, { cwd: root, shell: false, maxBuffer: 64 * 1024 * 1024 });
  const stdout = run.stdout || Buffer.alloc(0);
  const stderr = run.stderr || Buffer.alloc(0);
  const onStdout = parseOne(stdout);
  const onStderr = parseOne(stderr);
  // D3.3's rule is one response on one stream. Two parseable payloads is INCOHERENT — the arbiter
  // contract names that case explicitly — so it is refused rather than resolved by preferring stdout,
  // which would hide exactly the fault this harness exists to be able to see.
  return {
    op,
    argv: argv.slice(1),
    exitStatus: run.status,
    payloadCount: [onStdout.present, onStderr.present].filter(Boolean).length,
    stdoutDigest: sha256(stdout),
    stderrDigest: sha256(stderr),
    stdoutBytes: stdout.length,
    stderrBytes: stderr.length,
    stream: onStdout.present ? "stdout" : (onStderr.present ? "stderr" : "none"),
    payload: onStdout.present ? onStdout.value : onStderr.value,
    stderrText: stderr.toString("utf8"),
  };
}

// The controller facts worth keeping on a product-failure event, whatever went wrong.
const controllerTrace = result => ({
  controllerOp: result.op,
  controllerCode: result.payload && typeof result.payload.code === "string" ? result.payload.code : null,
  exitStatus: result.exitStatus,
  stream: result.stream,
  payloadCount: result.payloadCount,
  stderrDigest: result.stderrDigest,
  stdoutDigest: result.stdoutDigest,
});

function assertSinglePayload(result) {
  assert.strictEqual(result.payloadCount, 1,
    `${result.op} produced ${result.payloadCount} parseable JSON payloads across stdout and stderr; exactly one is coherent`);
}

function expectOk(result) {
  assertSinglePayload(result);
  assert.strictEqual(result.exitStatus, 0, `${result.op} expected exit 0, got ${result.exitStatus}: ${result.stderrText}`);
  assert.strictEqual(result.stream, "stdout", `${result.op} must answer on stdout when it succeeds`);
  return result.payload;
}

function expectRefusal(result, code) {
  assertSinglePayload(result);
  assert.strictEqual(result.exitStatus, 1, `${result.op} expected exit 1, got ${result.exitStatus}`);
  assert.strictEqual(result.stream, "stderr", `${result.op} must answer on stderr when it refuses`);
  assert.strictEqual(result.payload && result.payload.ok, false, `${result.op} did not produce a refusal payload`);
  assert.strictEqual(result.payload.code, code, `${result.op} refused with ${result.payload.code}, expected ${code}`);
  return result.payload;
}

const inventoryOf = repoRoot => JSON.parse(fs.readFileSync(path.join(repoRoot, ...ARTIFACT_REL.split("/")), "utf8"));
const classify = inventory => ({
  classification: inventory.entries.length === 0 ? "empty" : "non-empty",
  entryCount: inventory.entries.length,
});

// --- the reviewer invocation, as pure data ------------------------------------------------------------

export const REVIEWER_MODEL = "claude-opus-5";
export const REVIEWER_EFFORT = "xhigh";
export const REVIEWER_MCP_CONFIG = '{"mcpServers":{}}';

// EXACT commands, no wildcard, sourced from `bash-guard.mjs` so the argv rules, the harness's own
// `git diff` and the packet's regenerate/capability text cannot drift apart.
//
// THE ALLOW-LIST IS DECLARED INTENT, NOT THE BOUNDARY. Live probes established that in this
// environment `Bash(<exact command>)` entries are NOT exclusive: with `--restricted`, `--tools`
// naming Bash and either `dontAsk` or `manual`, an unlisted `git status` still executed and
// `permissionDenialCount` stayed 0. What each layer actually does here:
//
//   * `--restricted`      — confines the file tools to the working directories. PROVEN live: an
//                           absolute Read of a sibling temp directory was denied. This is what keeps
//                           the reviewer out of the sibling harness root holding packets, slices and
//                           any prior phase's raw reviewer output.
//   * `--allowed-tools`   — declares the intended Bash rules. Retained as intent; not a boundary here.
//   * the PreToolUse hook — the ACTUAL Bash deny boundary (`bash-guard.mjs`), reaching the session
//                           through an explicit `--settings` file, which `--restricted` still honours.
//
// The two commands still exercise the shipped contract's POSSESSION of Bash, which is the point. They
// do not give free Bash use. NOTHING here may be described as enforced until a live hook probe says
// so; that probe has not been run from this repository.
export const REVIEWER_BASH_RULES = Object.freeze(ALLOWED_COMMANDS.map(command => `Bash(${command})`));
export const REVIEWER_TOOLS = Object.freeze(["Read", "Grep", "Glob", ...REVIEWER_BASH_RULES]);
// Which built-in tools may EXIST in the session, as one non-variadic token.
export const REVIEWER_AVAILABLE_TOOLS = "Read,Grep,Glob,Bash";

export function reviewerArgv({ pluginDir, sessionId, cwd, settingsPath }) {
  assert.ok(typeof settingsPath === "string" && settingsPath !== "",
    "reviewerArgv needs the absolute settings path that carries the Bash guard");
  return [
    "--print",
    "--plugin-dir", pluginDir,
    "--agent", "test-reviewer",
    "--model", REVIEWER_MODEL,
    "--effort", REVIEWER_EFFORT,
    "--output-format", "text",
    "--session-id", sessionId,
    // Removes the command/code tools unless `--tools` names them, ignores user/project/local settings,
    // and confines the file tools to the working directories.
    "--restricted",
    // Explicit and empty, rather than relying on the semantics of an omitted argument: the receipt
    // then carries a positive artefact for the no-MCP boundary.
    "--strict-mcp-config",
    "--mcp-config", REVIEWER_MCP_CONFIG,
    "--no-chrome",
    "--permission-mode", "manual",
    // Nobody answers prompts: anything that would prompt is denied rather than delegated to a host
    // that a `--print` run does not have.
    "--permission-prompts", "none",
    // `--restricted` ignores user/project/local settings but still honours an explicit one, which is
    // how the PreToolUse Bash guard reaches this session.
    "--settings", settingsPath,
    "--add-dir", cwd,
    // ONE token, so the CLI never needs to split it, and placed before the variadic flag below.
    "--tools", REVIEWER_AVAILABLE_TOOLS,
    // LAST, and one argv token per entry. `--allowed-tools` is variadic, so placing it last removes
    // any chance of swallowing a following flag, and pre-splitting removes any dependence on how the
    // CLI splits a single comma/space-separated string — these rules contain spaces.
    "--allowed-tools", ...REVIEWER_TOOLS,
  ];
}

// --- the per-scenario hook boundary ---------------------------------------------------------------------

const GUARD_SOURCE = path.join(HERE, "bash-guard.mjs");
const canonicalCommands = list => JSON.stringify(Array.isArray(list) ? [...list].sort() : list);

// Only controlled absolute paths are interpolated into the hook command, and a quote, newline or NUL
// in one is REFUSED rather than escaped — the harness owns these paths, so anything exotic means
// something is wrong rather than something needs quoting.
export function hookCommandFault(value) {
  if (typeof value !== "string" || value === "") return "the path is empty";
  if (/["'\r\n\0]/.test(value)) return `the path contains a quote, newline or NUL: ${JSON.stringify(value)}`;
  if (!path.isAbsolute(value)) return `the path is not absolute: ${value}`;
  return null;
}

export function buildHookSettings({ nodePath, guardPath, configPath }) {
  for (const [what, value] of [["node", nodePath], ["guard", guardPath], ["config", configPath]]) {
    const fault = hookCommandFault(value);
    assert.strictEqual(fault, null, fault === null ? "" : `${what}: ${fault}`);
  }
  return {
    hooks: {
      PreToolUse: [{
        matcher: "Bash",
        hooks: [{ type: "command", command: `"${nodePath}" "${guardPath}" --config "${configPath}"` }],
      }],
    },
  };
}

function createHookBoundary(harnessRoot, repoRootResolved) {
  const dir = path.join(harnessRoot, "hook");
  const auditDir = path.join(harnessRoot, "hook-audit");
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(auditDir, { recursive: true });

  // The guard digest travels IN the config so every audit record can copy it without the guard
  // re-hashing itself per call; the harness verifies both digests independently at invoke time.
  const guardDigest = sha256(readBytes(GUARD_SOURCE));
  const configBytes = Buffer.from(`${JSON.stringify(
    { repoRootResolved, auditDir, guardDigest, allowedCommands: [...ALLOWED_COMMANDS] }, null, 2,
  )}\n`, "utf8");
  const configPath = createNew(harnessRoot, path.join(dir, "guard-config.json"), configBytes);

  const settingsBytes = Buffer.from(`${JSON.stringify(
    buildHookSettings({ nodePath: process.execPath, guardPath: GUARD_SOURCE, configPath }), null, 2,
  )}\n`, "utf8");
  const settingsPath = createNew(harnessRoot, path.join(dir, "settings.json"), settingsBytes);

  return {
    configPath, configDigest: sha256(configBytes),
    settingsPath, settingsDigest: sha256(settingsBytes),
    guardPath: GUARD_SOURCE, guardDigest,
    auditDir, repoRootResolved, allowedCommands: [...ALLOWED_COMMANDS],
  };
}

/**
 * Re-verified from disk before the start marker and before the paid call, using the harness's own
 * realpath/regular-file containment discipline rather than a bare `existsSync`.
 *
 * The GUARD is the one exception to containment: it lives in the repository, not the temp root, so it
 * is bound by being exactly `GUARD_SOURCE`, a regular file, and digest-equal.
 */
function boundaryBindingFault(harnessRoot, boundary) {
  if (!boundary) return "the scenario recorded no hook boundary";
  try {
    for (const [what, file, digest] of [
      ["settings", boundary.settingsPath, boundary.settingsDigest],
      ["config", boundary.configPath, boundary.configDigest],
    ]) {
      const real = containedExistingFile(harnessRoot, file);
      if (sha256(readBytes(real)) !== digest) return `the ${what} file no longer matches its recorded digest`;
    }
    if (boundary.guardPath !== GUARD_SOURCE) {
      return `the bound guard is ${boundary.guardPath}, not this build's ${GUARD_SOURCE}`;
    }
    if (!fs.lstatSync(boundary.guardPath).isFile()) return "the guard source is not a regular file";
    if (sha256(readBytes(boundary.guardPath)) !== boundary.guardDigest) {
      return "the guard source no longer matches its recorded digest";
    }
    const auditReal = fs.realpathSync(boundary.auditDir);
    if (!fs.lstatSync(auditReal).isDirectory()) return `the audit path is not a directory: ${auditReal}`;
    if (!lexicallyInside(harnessRoot, auditReal)) return `the audit directory is outside ${harnessRoot}`;
  } catch (error) {
    return `a boundary path could not be verified: ${error && error.message ? error.message : error}`;
  }
  const config = JSON.parse(readBytes(boundary.configPath).toString("utf8"));
  if (!sameResolvedRoot(config.repoRootResolved, boundary.repoRootResolved)) {
    return "the guard config's expected repository root moved";
  }
  if (config.guardDigest !== boundary.guardDigest) {
    return "the guard config's guardDigest is not the bound guard's";
  }
  if (canonicalCommands(config.allowedCommands) !== canonicalCommands(ALLOWED_COMMANDS)) {
    return "the guard config's allowed commands are not this build's";
  }
  return null;
}

// --- the per-invoke audit veto -------------------------------------------------------------------------

export const auditSnapshot = auditDir => (fs.existsSync(auditDir) ? fs.readdirSync(auditDir).sort() : []);

/** A record filename must be a plain basename inside the audit directory — never a path. */
export function unsafeAuditName(name) {
  if (typeof name !== "string" || name === "") return "the record name is empty";
  if (name !== path.basename(name)) return `the record name is not a plain basename: ${JSON.stringify(name)}`;
  if (name === "." || name === ".." || name.includes("\0")) return `the record name is unsafe: ${JSON.stringify(name)}`;
  return null;
}

/** The directory listing must not move while it is being read. */
export function auditInstabilityFault(namesBefore, namesAfter) {
  const a = [...namesBefore].sort();
  const b = [...namesAfter].sort();
  if (a.length === b.length && a.every((n, i) => n === b[i])) return null;
  const added = b.filter(n => !a.includes(n));
  const removed = a.filter(n => !b.includes(n));
  return "the audit directory changed while it was being read"
    + `${added.length ? `; appeared: ${added.join(", ")}` : ""}`
    + `${removed.length ? `; disappeared: ${removed.join(", ")}` : ""}`;
}

/**
 * Only files that appeared since the snapshot, and only regular, safely named, contained ones. Each
 * record keeps its exact bytes count and digest so the evidence is content-identified, not
 * name-identified. Re-lists afterwards: a hook subprocess outliving the CLI could write after the
 * read, and a missed DENY would silently weaken the "no unexpected calls" claim. Never throws.
 */
export function readNewAuditRecords(auditDir, before) {
  const seen = new Set(before);
  const records = [];
  const malformed = [];
  const namesBefore = auditSnapshot(auditDir);
  for (const name of namesBefore) {
    if (seen.has(name)) continue;
    const unsafe = unsafeAuditName(name);
    if (unsafe !== null) { malformed.push(`${name}: ${unsafe}`); continue; }
    const file = path.join(auditDir, name);
    try {
      if (!lexicallyInside(auditDir, file)) { malformed.push(`${name}: outside the audit directory`); continue; }
      if (!fs.lstatSync(file).isFile()) { malformed.push(`${name}: not a regular file`); continue; }
      const bytes = readBytes(file);
      records.push({ name, bytes: bytes.length, digest: sha256(bytes), record: JSON.parse(bytes.toString("utf8")) });
    } catch (error) {
      malformed.push(`${name}: ${error && error.message ? error.message : error}`);
    }
  }
  return { records, malformed, unstable: auditInstabilityFault(namesBefore, auditSnapshot(auditDir)) };
}

/** The deterministic, name-sorted manifest and its aggregate digest. */
export function auditManifestOf(records) {
  const manifest = records
    .map(({ name, bytes, digest }) => ({ name, bytes, digest }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { manifest, manifestDigest: sha256(Buffer.from(JSON.stringify(manifest), "utf8")) };
}

const isText = v => typeof v === "string" && v !== "";
const textOrNull = v => v === null || typeof v === "string";

/**
 * THE VETO (pure). Hook-absent and hook-allowed are indistinguishable from the transcript alone — in
 * both cases the command simply runs — so these records are the ONLY artefact proving the guard
 * mediated this invocation. A run with no positive records is invalid however clean it looks.
 * Deny records are expected and retained; they are evidence, not failures.
 */
export function validateInvokeAudit({
  records, malformed, unstable, sessionId, expectedRoot, configDigest, guardDigest, allowedCommands,
}) {
  const problems = [...(malformed || []).map(m => `unreadable audit record ${m}`)];
  if (unstable) problems.push(unstable);
  const passes = new Map(allowedCommands.map(c => [c, 0]));
  let denyCount = 0;
  for (const { name, record } of records) {
    if (record === null || typeof record !== "object" || Array.isArray(record)) {
      problems.push(`${name}: not a JSON object`); continue;
    }
    const bad = reason => problems.push(`${name}: ${reason}`);
    if (record.kind !== AUDIT_KIND) { bad(`kind is ${JSON.stringify(record.kind)}`); continue; }
    if (record.schemaVersion !== 1) bad(`schemaVersion is ${JSON.stringify(record.schemaVersion)}`);
    // EXACT session identity. Time of appearance narrows creation time; it does not prove which
    // session produced a record, and the harness mints the session id itself, so the strong binding
    // is free. Null or missing is a fault, not a tolerance.
    if (record.sessionId !== sessionId) {
      bad(`session ${JSON.stringify(record.sessionId)} is not this invocation's ${sessionId}`);
    }
    if (!sameResolvedRoot(record.expectedRoot, expectedRoot)) {
      bad(`expectedRoot ${JSON.stringify(record.expectedRoot)} is not ${expectedRoot}`);
    }
    if (record.configDigest !== configDigest) bad("configDigest is not this scenario's");
    if (record.guardDigest !== guardDigest) bad("guardDigest is not the bound guard's");
    // Shape only — these carry no semantics the veto can independently check, and `toolUseId`'s
    // availability in the hook payload is not established, so it may legitimately be null.
    if (!textOrNull(record.command)) bad("command is neither a string nor null");
    if (!textOrNull(record.cwd)) bad("cwd is neither a string nor null");
    if (!textOrNull(record.resolvedCwd)) bad("resolvedCwd is neither a string nor null");
    if (!textOrNull(record.toolUseId)) bad("toolUseId is neither a string nor null");
    if (!isText(record.at) || Number.isNaN(Date.parse(record.at))) bad(`at is not a parseable timestamp: ${JSON.stringify(record.at)}`);
    if (!Number.isInteger(record.pid) || record.pid <= 0) bad(`pid is not a positive integer: ${JSON.stringify(record.pid)}`);

    if (record.decision === "pass") {
      if (!passes.has(record.command)) {
        bad(`a pass for a command outside the allowed list: ${JSON.stringify(record.command)}`);
      } else {
        passes.set(record.command, passes.get(record.command) + 1);
      }
      // Independent corroboration of the fact the guard claims it checked. Only for a PASS: a deny
      // may legitimately carry a different or null resolvedCwd, since that can be the denial reason.
      if (!sameResolvedRoot(record.resolvedCwd, expectedRoot)) {
        bad(`a pass whose resolvedCwd ${JSON.stringify(record.resolvedCwd)} is not ${expectedRoot}`);
      }
    } else if (record.decision === "deny") {
      denyCount += 1;
    } else {
      bad(`unknown decision ${JSON.stringify(record.decision)}`);
    }
  }
  for (const [command, count] of passes) {
    if (count === 0) problems.push(`no pass record for the required command ${JSON.stringify(command)}`);
    else if (count > 1) problems.push(`${count} pass records for ${JSON.stringify(command)}; exactly one is required`);
  }
  const { manifest, manifestDigest } = auditManifestOf(records);
  return {
    ok: problems.length === 0, problems, manifest, manifestDigest,
    passCounts: Object.fromEntries(passes), denyCount, recordCount: records.length,
  };
}

/**
 * Re-verify a recorded manifest against the files on disk, WITHOUT rerunning the reviewer or the
 * hook. `wx` stops a creation collision; it does not make a file immutable afterwards, so the only
 * way to know the validated bytes survived is to recompute them.
 */
export function verifyAuditManifest(auditDir, manifest, manifestDigest) {
  const problems = [];
  const entries = [];
  if (!Array.isArray(manifest) || manifest.length === 0) {
    return { ok: false, problems: ["the recorded manifest is empty or not an array"], entries };
  }
  const recomputed = auditManifestOf(manifest.map(e => ({ name: e.name, bytes: e.bytes, digest: e.digest })));
  if (recomputed.manifestDigest !== manifestDigest) {
    problems.push("the recorded manifest does not match its own aggregate digest");
  }
  const seen = new Set();
  for (const entry of manifest) {
    const unsafe = unsafeAuditName(entry && entry.name);
    if (unsafe !== null) { problems.push(unsafe); continue; }
    if (seen.has(entry.name)) { problems.push(`${entry.name}: listed twice in one manifest`); continue; }
    seen.add(entry.name);
    const file = path.join(auditDir, entry.name);
    const result = { name: entry.name, expectedBytes: entry.bytes, expectedDigest: entry.digest };
    try {
      if (!lexicallyInside(auditDir, file)) throw new Error("outside the audit directory");
      if (!fs.lstatSync(file).isFile()) throw new Error("not a regular file");
      const bytes = readBytes(file);
      result.observedBytes = bytes.length;
      result.observedDigest = sha256(bytes);
      result.ok = result.observedBytes === entry.bytes && result.observedDigest === entry.digest;
      if (!result.ok) problems.push(`${entry.name}: content changed since it was validated`);
    } catch (error) {
      result.ok = false;
      result.error = error && error.message ? error.message : String(error);
      problems.push(`${entry.name}: ${result.error}`);
    }
    entries.push(result);
  }
  return { ok: problems.length === 0, problems, entries };
}

// --- receipt-time closure over the bound audit directory ------------------------------------------------
//
// Verifying each claimed manifest proves "everything I claimed is still here and unchanged". It does
// NOT prove "there is nothing here I did not claim", and it does not notice a successful invocation
// that carries no audit block at all. Both halves fail OPEN on absence, which is the same shape as
// hook-absent looking like hook-allowed — so both are closed here, at receipt time.

/**
 * How many reviewer invocations a scenario requires, derived from the ONE required-history table by
 * counting `invoke:` step ids. A parallel `{positive: 1, "fixed-point": 2}` literal would be exactly
 * the drift surface the prefix guard removed. `null` for an unknown scenario.
 */
export function requiredInvokeCount(scenario) {
  const required = REQUIRED_HISTORY[scenario];
  if (required === undefined) return null;
  return required.filter(step => step.id.startsWith("invoke:")).length;
}

/**
 * The observed contents of the bound audit directory: regular, safely named basenames only. An
 * unlistable directory, a subdirectory, a symlink, a non-regular entry or an unsafe name is a
 * problem rather than something quietly skipped.
 */
export function listAuditDirectory(auditDir) {
  const names = [];
  const problems = [];
  if (!isText(auditDir)) return { names, problems: ["no bound audit directory was recorded"] };
  let entries;
  try {
    entries = fs.readdirSync(auditDir);
  } catch (error) {
    return { names, problems: [`the audit directory could not be listed (${error && (error.code || error.message)})`] };
  }
  for (const name of [...entries].sort()) {
    // Defence in depth: `readdir` yields plain basenames, so this branch is not reachable through it.
    const unsafe = unsafeAuditName(name);
    if (unsafe !== null) { problems.push(unsafe); continue; }
    const file = path.join(auditDir, name);
    try {
      if (!lexicallyInside(auditDir, file)) { problems.push(`${name}: outside the audit directory`); continue; }
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) { problems.push(`${name}: is a symbolic link, not an audit record`); continue; }
      if (stat.isDirectory()) { problems.push(`${name}: is a directory, not an audit record`); continue; }
      if (!stat.isFile()) { problems.push(`${name}: not a regular file`); continue; }
    } catch (error) {
      problems.push(`${name}: ${error && error.message ? error.message : error}`);
      continue;
    }
    names.push(name);
  }
  return { names, problems };
}

/**
 * PURE. Every successful invocation must carry a usable audit block bound to the ONE audit directory,
 * the count must match what the scenario requires, the claimed names must be disjoint across
 * sessions, and the directory must contain exactly the union — no unclaimed extras, no claimed
 * absentees.
 */
export function auditClosureProblems({ scenario, invokes, boundAuditDir, observedNames }) {
  const expectedInvocations = requiredInvokeCount(scenario);
  if (expectedInvocations === null) {
    return {
      problems: [`unknown scenario ${JSON.stringify(scenario)}`],
      expectedInvocations: null, claimedNames: [], observedNames: [...(observedNames || [])].sort(),
    };
  }
  const problems = [];
  const list = [...(invokes || [])];
  if (list.length !== expectedInvocations) {
    problems.push(`expected ${expectedInvocations} successful reviewer invocation(s), saw ${list.length}`);
  }

  const claimed = new Map();
  for (const event of list) {
    const label = `session ${event && event.sessionId ? event.sessionId : "(none)"}`;
    const audit = event && event.audit;
    // ABSENCE IS A PROBLEM, never a filter. A successful invoke with no audit block is precisely the
    // state that used to be dropped from the collection and then reported as verified.
    if (audit === null || typeof audit !== "object" || Array.isArray(audit)) {
      problems.push(`${label}: the successful invoke carries no audit block`); continue;
    }
    if (audit.ok !== true) problems.push(`${label}: the recorded audit block is not ok`);
    if (!sameResolvedRoot(audit.auditDir, boundAuditDir)) {
      problems.push(`${label}: audit directory ${JSON.stringify(audit.auditDir)} is not the bound ${boundAuditDir}`);
    }
    if (!isText(audit.manifestDigest)) problems.push(`${label}: the audit block states no manifestDigest`);
    if (!Array.isArray(audit.manifest) || audit.manifest.length === 0) {
      problems.push(`${label}: the audit manifest is empty or not an array`); continue;
    }
    for (const entry of audit.manifest) {
      const unsafe = unsafeAuditName(entry && entry.name);
      if (unsafe !== null) { problems.push(`${label}: ${unsafe}`); continue; }
      const owner = claimed.get(entry.name);
      if (owner !== undefined && owner !== event.sessionId) {
        problems.push(`audit record ${entry.name} is claimed by both session ${owner} and session ${event.sessionId}`);
      } else if (owner !== undefined) {
        problems.push(`audit record ${entry.name} is claimed twice by session ${event.sessionId}`);
      }
      claimed.set(entry.name, event.sessionId);
    }
  }

  const claimedNames = [...claimed.keys()].sort();
  const observed = [...(observedNames || [])].sort();
  for (const name of observed) {
    if (!claimed.has(name)) problems.push(`audit record ${name} is present but claimed by no invocation`);
  }
  for (const name of claimedNames) {
    if (!observed.includes(name)) problems.push(`audit record ${name} is claimed but absent from ${boundAuditDir}`);
  }
  return { problems, expectedInvocations, claimedNames, observedNames: observed };
}

// --- ingestion source binding (pure) --------------------------------------------------------------------

export function selectInvokeForIngest(events, phase) {
  const terminal = continuableFault(events);
  if (terminal !== null) return { ok: false, reason: terminal };
  const invokes = events.filter(e => e.stage === "invoke" && e.phase === phase);
  if (invokes.length === 0) return { ok: false, reason: `no invoke event exists for phase ${phase}` };
  if (invokes.length > 1) {
    return { ok: false, reason: `${invokes.length} invoke events exist for phase ${phase}; exactly one attempt is allowed` };
  }
  const [event] = invokes;
  if (event.exitStatus !== 0) {
    return {
      ok: false,
      reason: `the reviewer process for phase ${phase} exited ${event.exitStatus}; that is a recorded product failure and the scenario stops`,
    };
  }
  if (events.some(e => e.stage === "ingest" && e.phase === phase)) {
    return { ok: false, reason: `phase ${phase} already has an ingest event; ingestion runs once` };
  }
  return { ok: true, event };
}

export function captureBindingFault(event, observed) {
  if (observed.path !== event.stdoutFile) {
    return `captured path ${observed.path} is not the invoke event's ${event.stdoutFile}`;
  }
  if (observed.bytes !== event.stdoutBytes) {
    return `captured ${observed.bytes} bytes; the invoke recorded ${event.stdoutBytes}`;
  }
  if (observed.digest !== event.stdoutDigest) {
    return `captured sha256 ${observed.digest} is not the invoke's ${event.stdoutDigest}`;
  }
  return null;
}

// --- the ledger's single-record invariant (pure) ---------------------------------------------------------
//
// SCENARIO-SPECIFIC, deliberately. These worlds are fresh and only `gate` ever spawns the ledger CLI,
// so the true invariant is that no ledger exists beforehand and exactly one record exists afterwards.
// That is a much smaller honest check than snapshotting and re-parsing arbitrary prior JSONL. If this
// harness is ever pointed at a repository with existing ledger history, this must be replaced with
// real complete-JSONL snapshot parsing rather than relaxed.

export function singleLedgerRecordFault(bytes) {
  if (!Buffer.isBuffer(bytes)) return "the ledger snapshot must be a Buffer";
  if (bytes.length === 0) return "the ledger file is empty";
  if (bytes[bytes.length - 1] !== 0x0a) return "the ledger file is not newline-terminated";
  const parts = bytes.toString("utf8").split("\n");
  if (parts.length !== 2 || parts[1] !== "") {
    return `expected exactly one newline-terminated line, saw ${parts.length - 1}`;
  }
  if (parts[0].trim() === "") return "the single ledger line is empty";
  let parsed;
  try { parsed = JSON.parse(parts[0]); } catch (error) { return `the single ledger line is not JSON: ${error.message}`; }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return "the single ledger line is not a JSON object";
  }
  return null;
}

export function parseSingleLedgerRecord(bytes) {
  const problem = singleLedgerRecordFault(bytes);
  assert.strictEqual(problem, null, problem || "");
  return JSON.parse(bytes.toString("utf8").split("\n")[0]);
}

// --- the required history (pure) --------------------------------------------------------------------
//
// An EXACT sequence over the significant stages, so a missing, duplicated, out-of-order, wrong-phase,
// wrong-code or contradictory event is rejected rather than tolerated. Extra significant events are
// rejected too. Every success step also requires `outcome === "ok"`, so a durable product-failure
// event can never satisfy a required step. `invoke-start` and `gate-start` are intentionally NOT
// significant: they are crash markers, and the history still requires the completion event.

const SIGNIFICANT = new Set(["invoke", "ingest", "submit", "commit", "verify", "evaluate", "repair", "stale-submit"]);

// Each entry carries a stable machine-readable `id` alongside its human `label` and its matcher. The
// id is what the stage guards compare against, so a reworded label cannot silently move a guard.
const step = (id, label, fault) => Object.freeze({ id, label, fault });
const wrongStage = (e, want) => (e.stage === want ? null : `expected ${want}, saw ${e.stage}`);
const wrongPhase = (e, want) => (e.phase === want ? null : `expected phase ${want}, saw ${e.phase}`);
const notOk = e => (e.outcome === "ok" ? null : `outcome was ${e.outcome}`);

const stepInvoke = phase => step(`invoke:${phase}`, `invoke(${phase})`, e =>
  wrongStage(e, "invoke") || wrongPhase(e, phase) || notOk(e)
  || (e.exitStatus === 0 ? null : `the reviewer process exited ${e.exitStatus}`));

const stepIngest = phase => step(`ingest:${phase}`, `ingest(${phase})`, e =>
  wrongStage(e, "ingest") || wrongPhase(e, phase) || notOk(e));

const stepSubmitNotReady = phase => step(`submit:${phase}`, `submit not-ready(${phase})`, e =>
  wrongStage(e, "submit") || wrongPhase(e, phase) || notOk(e)
  || (e.expect === "not-ready" ? null : `expected not-ready, saw ${e.expect}`)
  || (e.commitReady === false ? null : "commitReady was not false")
  || (e.hasScopeViolation === true ? null
    : "the reviewer did not identify a scope-violation on the changed declaration"));

const stepSubmitReady = phase => step(`submit:${phase}`, `submit ready(${phase})`, e =>
  wrongStage(e, "submit") || wrongPhase(e, phase) || notOk(e)
  || (e.expect === "ready" ? null : `expected ready, saw ${e.expect}`)
  || (e.commitReady === true ? null : "commitReady was not true")
  || (e.semanticFindingCount === 0 ? null : `${e.semanticFindingCount} semantic finding identities remain`));

const stepCommitRefused = phase => step(`commit:${phase}`, `commit refused(${phase})`, e =>
  wrongStage(e, "commit") || wrongPhase(e, phase) || notOk(e)
  || (e.code === "E_LOOP_NOT_COMMIT_READY" ? null : `refusal code was ${e.code}`));

const stepCommitOk = phase => step(`commit:${phase}`, `commit(${phase})`, e =>
  wrongStage(e, "commit") || wrongPhase(e, phase) || notOk(e)
  || (e.committed === true ? null : "the commit did not succeed"));

const stepVerify = phase => step(`verify:${phase}`, `verify(${phase})`, e =>
  wrongStage(e, "verify") || wrongPhase(e, phase) || notOk(e)
  || (e.passed === true ? null : "the Step 6 consumer did not pass")
  || (e.historical === false ? null : "the verification was a replay, not a fresh attempt"));

const stepEvaluate = (phase, combined) => step(`evaluate:${phase}`, `evaluate combined:${combined}(${phase})`, e =>
  wrongStage(e, "evaluate") || wrongPhase(e, phase) || notOk(e)
  || (e.combined === combined ? null : `combined was ${e.combined}`)
  || (e.combined === (e.loopPass && e.provenancePass) ? null : "combined is not the conjunction of the halves"));

const stepRepair = () => step("repair", "repair", e =>
  wrongStage(e, "repair") || notOk(e)
  || (e.from === "negative" && e.to === "repaired" ? null : `repair moved ${e.from} -> ${e.to}`)
  || (e.before !== e.after ? null : "the repair did not move the inventory digest"));

const stepStaleSubmit = () => step("stale-submit", "stale submit refused", e =>
  wrongStage(e, "stale-submit") || notOk(e)
  || (e.code === "E_LOOP_CLAIM_MISMATCH" ? null : `refusal code was ${e.code}`)
  || (e.admittedBefore === e.admittedAfter ? null : "the stale submission consumed an admission")
  || (e.observedIterationsBefore === e.observedIterationsAfter ? null : "the stale submission moved observedIterations"));

export const REQUIRED_HISTORY = Object.freeze({
  positive: Object.freeze([
    stepInvoke("positive"), stepIngest("positive"), stepSubmitReady("positive"),
    stepCommitOk("positive"), stepVerify("positive"), stepEvaluate("positive", true),
  ]),
  "fixed-point": Object.freeze([
    stepInvoke("negative"), stepIngest("negative"), stepSubmitNotReady("negative"),
    stepCommitRefused("negative"), stepEvaluate("negative", false),
    stepRepair(), stepStaleSubmit(),
    stepInvoke("repaired"), stepIngest("repaired"), stepSubmitReady("repaired"),
    stepCommitOk("repaired"), stepVerify("repaired"), stepEvaluate("repaired", true),
  ]),
});

/**
 * The significant events so far, validated as an EXACT PREFIX of the scenario's required sequence.
 *
 * Same table, same matcher functions as `validateHistory` — the guard and the final gate literally
 * call `REQUIRED_HISTORY[scenario][i].fault`, so they cannot semantically drift. Returns the id of
 * the step that must come next, or `done`, or a precise mismatch.
 */
export function nextRequiredStep(events, scenario) {
  const required = REQUIRED_HISTORY[scenario];
  if (required === undefined) return { ok: false, reason: `unknown scenario ${JSON.stringify(scenario)}` };
  const seen = events.filter(e => SIGNIFICANT.has(e.stage));
  for (let i = 0; i < seen.length; i += 1) {
    if (required[i] === undefined) {
      return { ok: false, reason: `unexpected extra required-stage event at position ${i + 1}: ${seen[i].stage}` };
    }
    const problem = required[i].fault(seen[i]);
    if (problem !== null) return { ok: false, reason: `step ${i + 1} (${required[i].label}): ${problem}` };
  }
  if (seen.length === required.length) {
    return { ok: true, done: true, index: null, id: null, label: null };
  }
  return {
    ok: true, done: false, index: seen.length,
    id: required[seen.length].id, label: required[seen.length].label,
  };
}

/**
 * The stage guard. A stage may run only when the completed sequence is a valid prefix AND the step it
 * is about to produce is genuinely the next one. This is what stops an operator from spending a paid
 * reviewer call out of order — `validateHistory` alone catches it only at `gate`, after the money.
 */
export function prefixGuardFault(events, scenario, expectedId) {
  const next = nextRequiredStep(events, scenario);
  if (!next.ok) return `the completed step sequence is not a valid prefix: ${next.reason}`;
  if (next.done) return `the ${scenario} sequence is already complete; ${expectedId} would be an extra step`;
  if (next.id !== expectedId) {
    return `out of order: the next required step is ${next.id} (${next.label}), not ${expectedId}`;
  }
  return null;
}

export function validateHistory(events, scenario) {
  const required = REQUIRED_HISTORY[scenario];
  if (required === undefined) return { ok: false, problems: [`unknown scenario ${JSON.stringify(scenario)}`] };
  const seen = events.filter(e => SIGNIFICANT.has(e.stage));
  const problems = [];
  const shared = Math.min(seen.length, required.length);
  for (let i = 0; i < shared; i += 1) {
    const problem = required[i].fault(seen[i]);
    if (problem !== null) problems.push(`step ${i + 1} (${required[i].label}): ${problem}`);
  }
  for (let i = shared; i < required.length; i += 1) problems.push(`step ${i + 1} (${required[i].label}): missing`);
  for (let i = shared; i < seen.length; i += 1) {
    problems.push(`unexpected extra required-stage event at position ${i + 1}: ${seen[i].stage}`);
  }
  return { ok: problems.length === 0, problems };
}

// --- the Review Packet ---------------------------------------------------------------------------------

function evidenceTable(captures) {
  const rows = captures.map(c => `| \`${c.command}\` | test | yes | yes | ${c.exitStatus} | — |`);
  const summary = captures.map(c =>
    `run ${c.ordinal}: exit ${c.exitStatus} — ${c.summaryLines.join(" ") || "(no summary line captured)"}`).join("; ");
  return [
    "| command | type | required? | ran? | real exit status | blocked-reason |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
    `One-line summary: ${summary}`,
  ].join("\n");
}

function knownRisks(captures) {
  const last = captures[captures.length - 1];
  if (!last.green) return "the suite is currently red; the failing assertion is in the captured output above.";
  if (captures.length > 1) return "an earlier red run and the current green run are both captured above.";
  return "no fail-first (red) run exists for this change — only the green above was captured, and none is claimed.";
}

export function buildPacket({ repoRoot, state, captures, shared, inventory, emission, diff }) {
  const { classification, entryCount } = classify(inventory);
  return `## Review Packet

Task: review the changed test declaration under its declared provenance clause. The provenance loop is TP-active for task \`${state.taskId}\`.

Acceptance criteria (user-approved, numbered; arbiter checks each):
1. An absent key and a present-but-null key both read as absent.

In scope: the null-vs-absent reading of key lookup in \`${TEST_PATH}\`, governed by \`${ASSUM_A}\` — "treat null as absent".

Out of scope: attempt/retry accounting. No clause in the provenance store governs it; \`${ASSUM_A}\` governs only the null-vs-absent reading.

Must-not-change (invariants): the \`@src\` tag on the declaration; the declaration's name and container.

Edge checklist: absent key; present key whose value is \`null\`; present key whose value is falsy but not null.

Assumptions: the store's only implementation-layer clause for this behaviour is \`${ASSUM_A}\`.

Implementation summary: the declaration was edited on the head side. Judge the change against the clause that governs it.

Changed files:
- \`${TEST_PATH}\` — the tagged declaration under review.

Changed diff (filtered):
\`\`\`diff
${diff}
\`\`\`
— Trimmed: nothing; the change is one file and the diff is inline in full.
— Regenerate (same scope): \`${ALLOWED_COMMANDS[0]}\`

Verification evidence (per-check table: command / type / required? / ran? / exit status / blocked-reason, + one-line summary):

${evidenceTable(captures)}

Full captured output for each run above: ${captures.map(c => `\`${captureRelPath(c.ordinal)}\``).join(", ")}, relative to this repository root.

Known risks: ${knownRisks(captures)}

Reviewer scope: does the changed declaration stay within the reading its \`@src\` clause governs, and is the acceptance criterion demonstrably met?

Context exclusions: none.

External-capability notes: no MCP servers are configured for this handoff. Exactly two shell commands are runnable here, byte for byte as written, and every other shell command is blocked:
- \`${ALLOWED_COMMANDS[0]}\`
- \`${ALLOWED_COMMANDS[1]}\`
Run each of them exactly once during this review. Reproduce them character for character; a variation in spacing, options or path is blocked rather than corrected.

Design contract (design.md path, or "none"): none

Migration status (migrated / NOT migrated / n/a): n/a

${shared.block}

## Test-provenance fields (TP-active)

- TP-active: yes. Reviewer output branch: TP semantic review.
- \`taskId\`: \`${state.taskId}\`
- \`baseProvenance\`: \`${JSON.stringify(state.baseProvenance)}\`
- Emitted artifact (read it in full): \`${ARTIFACT_REL}\` relative to this repository root, \`${repoRoot}\`
- Artifact raw SHA-256: \`${emission.artifactRawDigest}\`
- \`inventoryDigest\`: \`${emission.inventoryDigest}\`
- Inventory classification: \`${classification}\`, \`entryCount\` ${entryCount}
- Tag / clause context: the declaration carries \`@src ${ASSUM_A}\`. That clause is implementation-layer, derived from decision point \`DP-1\` ("null vs absent"), text "treat null as absent", alternative "treat null as invalid". No other clause in the store governs this declaration, and there is no pending governance draft for this task.
`;
}

const NEUTRAL_INSTRUCTION = "Perform the Review Packet below under your active agent contract.";

// --- stages --------------------------------------------------------------------------------------------

const flag = (args, name, fallback = null) => {
  const at = args.indexOf(name);
  if (at === -1) return fallback;
  const value = args[at + 1];
  assert.ok(value !== undefined && !value.startsWith("--"), `${name} needs a value`);
  return value;
};

const say = line => process.stdout.write(`${line}\n`);

// Open a world for a stage that may move product state or spend a reviewer call.
const openWorld = args => {
  const root = assertHarnessRoot(flag(args, "--root"));
  const state = loadState(root);
  assertContinuable(state.events);
  return { root, state, repoRoot: assertRepoRoot(state.repoRoot) };
};

const latestEmission = state => state.emissions[state.emissions.length - 1];

// One durable product-failure record, then stop. Never throws: the record is the deliverable, and a
// thrown stack after a saved event would only obscure it.
function stopWithFailure(root, state, event, message) {
  record(state, { ...event, outcome: "product-failure", message });
  saveState(root, state);
  say(`PRODUCT FAILURE (${event.stage}${event.phase ? `, phase ${event.phase}` : ""}): ${message}`);
  say("Recorded durably. This scenario stops: no retry, no packet tuning, no moving to another phase.");
  return 1;
}

// THE ONE review-file cleanup, shared by `ingest` and `stale-submit`.
//
// ONE removal attempt, then an OBSERVATION. Never throws, never retries, and never claims more than
// it saw: on Windows a file held open elsewhere cannot be deleted, and the honest artefact in that
// case is `removed:false` with the error code, not a loop. Both call sites previously had their own
// version and only one of them observed the result — the other recorded "was written" under a field
// named "removed", which is exactly the kind of false evidence this harness exists to avoid.
export function removeReviewFile(review, wasWritten) {
  if (!wasWritten) return { attempted: false, removed: null, error: null };
  let error = null;
  try {
    fs.rmSync(review, { force: true });
  } catch (caught) {
    error = caught && caught.code ? caught.code : String(caught && caught.message ? caught.message : caught);
  }
  return { attempted: true, removed: !fs.existsSync(review), error };
}

/**
 * Pure: does an observed cleanup result make the caller a product failure?
 *
 * `stale-submit` uses this to fail closed — a correct controller refusal is not enough if the stale
 * bytes are still sitting in the review slot. `ingest` does NOT consult it: its failure path is
 * already terminal (`outcome:"unusable"`), so there is no successful outcome left to flip; it records
 * the same observation purely as evidence.
 */
export function reviewCleanupFault(cleanup) {
  if (!cleanup || cleanup.attempted !== true) return null;
  if (cleanup.removed === true) return null;
  return `the review file was not removed (${cleanup.error || "still present after the removal attempt"})`;
}

function semanticSummary(admission) {
  const identities = admission.findingIdentities || [];
  return {
    semanticFindingCount: identities.length,
    findingIdentities: identities,
    findingKinds: [...new Set(identities.map(i => i.kind))].sort(),
    hasScopeViolation: identities.some(i => i.kind === "scope-violation" && i.testRef && i.testRef.path === TEST_PATH),
  };
}

const STAGES = {
  help() {
    say(`ctide loop-e2e — manual staged driver (never run by node --test)

  preflight
  prepare      --scenario <positive|fixed-point>          prints the HARNESS root
  packet       --root <harness>
  invoke       --root <harness> --claude <absolute path>  [MANUAL, spawns a model, ONCE per phase]
  ingest       --root <harness>                           [binds to that phase's single invoke]
  submit       --root <harness> --expect <ready|not-ready>
  commit       --root <harness> --expect <ok|not-ready>
  verify       --root <harness>
  evaluate     --root <harness> --expect <combined-true|combined-false>
  repair       --root <harness>
  stale-submit --root <harness>
  gate         --root <harness>                           [once; one ledger append]
  receipt      --root <harness>                           [requires a successful gate]
  supplemental --root <harness>                           [optional, read-only]

--root is always the harness root; the reviewer repo is recorded inside its state and is never
passed on a command line. Only 'invoke' launches an external process other than node/git.

FAIL-CLOSED, BY DESIGN. 'invoke' writes an immutable start marker BEFORE spawning the model. A crash
between that marker and its completion leaves the marker unmatched, which stops the WHOLE scenario —
not merely that phase — so 'repair' cannot move on and spend a second call. The scenario must then be
rebuilt from 'prepare'. Rebuilding is the cheaper mistake; a second undetected paid reviewer call
would destroy the one-attempt property this harness exists to establish. 'gate' writes the same kind
of marker, and an unmatched one is terminal on the same terms.

Any recorded terminal failure (non-zero reviewer exit, unusable capture, or any product-failure
outcome) likewise stops every later stage, including 'repair'. 'repair' and 'stale-submit' each hold
one stage-global slot per scenario; the other stages hold one slot per phase. There is no retry and
no packet tuning. Only 'help' and 'preflight' remain runnable after a scenario has stopped.`);
    return 0;
  },

  preflight() {
    const checks = [];
    const check = (name, fn) => {
      try { fn(); checks.push(`PASS  ${name}`); } catch (error) { checks.push(`FAIL  ${name} — ${error.message}`); }
    };
    check("controller CLI present", () => assert.ok(fs.existsSync(CONTROLLER)));
    check("ledger CLI present", () => assert.ok(fs.existsSync(LEDGER_CLI)));
    check("plugin manifest present", () => assert.ok(fs.existsSync(path.join(PLUGIN_DIR, ".claude-plugin", "plugin.json"))));
    check("shared reviewer contract extractable", () => {
      const shared = extractSharedContract();
      assert.ok(shared.block.startsWith("Shared reviewer contract:"));
      say(`      block review-packet.md:${shared.firstLine}-${shared.lastLine} sha256=${shared.blockDigest}`);
      say(`      review-packet.md whole      sha256=${shared.reviewPacketDigest}`);
    });
    check("sentinel slicer round-trips", () => {
      const body = Buffer.from('{"ok":1}', "utf8");
      const captured = Buffer.concat([
        Buffer.from("CTIDE_TEST_SEMANTIC_REVIEW_BATCH_BEGIN\n"), body,
        Buffer.from("\nCTIDE_TEST_SEMANTIC_REVIEW_BATCH_END\n"),
      ]);
      const result = sliceReviewBatch(captured);
      assert.ok(result.ok && result.slice.equals(body));
      assert.deepEqual([...FAULT_KINDS], ["duplicated", "missing", "misordered", "empty"]);
    });
    check("required histories are well formed", () => {
      for (const scenario of SCENARIOS) assert.ok(REQUIRED_HISTORY[scenario].length > 0);
      assert.strictEqual(validateHistory([], "positive").ok, false);
    });
    check("terminal-failure rule stops progression", () => {
      assert.strictEqual(continuableFault([{ stage: "ingest", outcome: "ok" }]), null);
      assert.ok(continuableFault([{ stage: "ingest", ordinal: 3, outcome: "unusable", fault: "slice-missing" }]));
    });
    check("reviewer argv: restricted, manual, no prompts, explicit settings and empty MCP", () => {
      const argv = reviewerArgv({
        pluginDir: PLUGIN_DIR, sessionId: "00000000-0000-4000-8000-000000000000", cwd: REPO,
        settingsPath: path.join(REPO, "settings.json"),
      });
      for (const flagName of ["--restricted", "--permission-prompts", "--settings", "--tools", "--strict-mcp-config"]) {
        assert.ok(argv.includes(flagName), `${flagName} must be present`);
      }
      assert.strictEqual(argv[argv.indexOf("--permission-mode") + 1], "manual");
      assert.strictEqual(argv[argv.indexOf("--permission-prompts") + 1], "none");
      assert.strictEqual(argv[argv.indexOf("--tools") + 1], REVIEWER_AVAILABLE_TOOLS);
      assert.ok(argv.includes(REVIEWER_MCP_CONFIG));
      for (const rule of REVIEWER_BASH_RULES) assert.ok(!rule.includes("*"), `${rule} carries a wildcard`);
      say(`      available: ${REVIEWER_AVAILABLE_TOOLS}`);
      for (const command of ALLOWED_COMMANDS) say(`      allowed:   ${command}`);
    });
    check("bash guard source present and hook command safely quotable", () => {
      assert.ok(fs.existsSync(GUARD_SOURCE), `no guard at ${GUARD_SOURCE}`);
      const settings = buildHookSettings({
        nodePath: process.execPath, guardPath: GUARD_SOURCE, configPath: path.join(REPO, "c.json"),
      });
      assert.strictEqual(settings.hooks.PreToolUse[0].matcher, "Bash");
      assert.match(settings.hooks.PreToolUse[0].hooks[0].command, /--config/);
    });
    checks.forEach(say);
    say("");
    say("NOT CHECKED HERE, deliberately: the claude executable is not probed and no model is called.");
    say("Only the 'invoke' stage spawns a reviewer, and only with an explicit --claude path.");
    say("The two Bash rules are written as intended; whether the CLI ENFORCES them as written is");
    say("unproven here and awaits a dedicated live permission probe. Claim nothing about them yet.");
    return checks.some(line => line.startsWith("FAIL")) ? 1 : 0;
  },

  prepare(args) {
    const scenario = flag(args, "--scenario");
    assert.ok(SCENARIOS.includes(scenario), `--scenario must be one of ${SCENARIOS.join(", ")}`);
    const world = createScenarioWorld();
    const root = assertHarnessRoot(world.harnessRoot);
    const repoRoot = assertRepoRoot(world.repo.root);
    const phase = scenario === "positive" ? "positive" : "negative";
    applyHead(world.repo, phase);

    const state = {
      scenario, phase, taskId: world.taskId, baseProvenance: world.baseProvenance,
      harnessRoot: root, repoRoot,
      createdAt: new Date().toISOString(),
      shared: (({ block, ...rest }) => rest)(extractSharedContract()),
      // The Bash deny boundary, created once per scenario and bound by digest from here on.
      boundary: createHookBoundary(root, repoRoot),
      captures: [], slices: [], emissions: [], packets: [], events: [],
    };

    const begun = expectOk(controller(repoRoot, "begin", world.taskId));
    record(state, { stage: "begin", outcome: "ok", revision: begun.revision });

    const capture = captureSuiteRun(world.repo, 1);
    writeCaptureFile(world.repo, capture);
    state.captures.push(capture);
    if (phase === "negative") assert.notStrictEqual(capture.exitStatus, 0, "the first run must actually be RED");
    else assert.strictEqual(capture.exitStatus, 0, "the first run must actually be GREEN");

    const emitted = expectOk(controller(repoRoot, "emit", world.taskId));
    state.emissions.push({ phase, ...emitted });
    record(state, { stage: "emit", outcome: "ok", phase, emissionId: emitted.emissionId, inventoryDigest: emitted.inventoryDigest });

    saveState(root, state);
    say(root);
    say(`prepared scenario=${scenario} inventoryDigest=${emitted.inventoryDigest}`);
    say(`reviewer repo: ${repoRoot}`);
    say(`next: node eval/loop-e2e/run-scenario.mjs packet --root ${root}`);
    return 0;
  },

  packet(args) {
    const { root, state, repoRoot } = openWorld(args);
    // No packet tuning after the reviewer has been engaged for this phase.
    const engaged = state.events.filter(e => (e.stage === "invoke-start" || e.stage === "invoke") && e.phase === state.phase);
    assert.strictEqual(engaged.length, 0,
      `phase ${state.phase} has already engaged the reviewer; the packet may not be rebuilt for it`);
    // A packet exists only to be handed to a reviewer, so it may only be built when this phase's
    // invoke is genuinely the next required step. Without this an early `repair` lets a packet be
    // built for a phase whose invoke could never be certified — and then spent.
    const ordering = prefixGuardFault(state.events, state.scenario, `invoke:${state.phase}`);
    assert.strictEqual(ordering, null, ordering || "");

    const shared = extractSharedContract();
    const emission = latestEmission(state);
    // The SAME invocation the packet tells the reviewer to regenerate with, so what it sees inline and
    // what it can reproduce are the same bytes.
    const diff = cp.spawnSync("git", ALLOWED_COMMANDS[0].split(" ").slice(1),
      { cwd: repoRoot, shell: false, encoding: "utf8" }).stdout || "(no diff)";
    const text = buildPacket({
      repoRoot, state, captures: state.captures, shared, inventory: inventoryOf(repoRoot), emission, diff,
    });
    const ordinal = state.packets.length + 1;
    const file = createNew(root, path.join(root, "packets", `packet-${ordinal}-${state.phase}.md`), Buffer.from(text, "utf8"));
    state.packets.push({
      ordinal, phase: state.phase, file, writtenAt: new Date().toISOString(),
      digest: sha256(Buffer.from(text, "utf8")), sharedBlockDigest: shared.blockDigest,
      emissionId: emission.emissionId, inventoryDigest: emission.inventoryDigest,
      artifactRawDigest: emission.artifactRawDigest,
    });
    saveState(root, state);

    say(`packet written: ${file}`);
    say(`shared block: review-packet.md:${shared.firstLine}-${shared.lastLine} sha256=${shared.blockDigest}`);
    say("");
    say("MANUAL next step — run this yourself; nothing here launches it:");
    say(`  node eval/loop-e2e/run-scenario.mjs invoke --root ${root} --claude <ABSOLUTE PATH TO claude>`);
    return 0;
  },

  invoke(args) {
    const { root, state, repoRoot } = openWorld(args);
    const claudePath = flag(args, "--claude");
    assert.ok(claudePath && path.isAbsolute(claudePath), "--claude must be an explicit absolute path");
    assert.ok(fs.existsSync(claudePath), `no executable at ${claudePath}`);

    const blocked = invokeBlockedReason(state.events, state.phase);
    assert.strictEqual(blocked, null, blocked || "");
    // THE ORDERING GUARD THAT PROTECTS THE PAID CALL. Refused before `spawnSync`, before the start
    // marker, and before anything is billed, so a misordered scenario costs nothing.
    const ordering = prefixGuardFault(state.events, state.scenario, `invoke:${state.phase}`);
    assert.strictEqual(ordering, null, ordering || "");

    const packet = state.packets[state.packets.length - 1];
    assert.ok(packet, "no packet has been built");
    assert.strictEqual(packet.phase, state.phase, `the latest packet is for phase ${packet.phase}, not ${state.phase}`);
    const emission = latestEmission(state);
    assert.strictEqual(packet.emissionId, emission.emissionId,
      "the latest packet was not built from the current emission; rebuild it before invoking");
    assert.strictEqual(packet.inventoryDigest, emission.inventoryDigest, "packet/emission inventoryDigest disagree");

    const packetFile = containedExistingFile(root, packet.file);
    const packetBytes = readBytes(packetFile);
    assert.strictEqual(sha256(packetBytes), packet.digest, "the packet file no longer matches its recorded digest");

    // EVERY BOUNDARY BINDING, re-read from disk BEFORE the start marker and before the paid call. A
    // mismatch is a pre-call refusal, not a product failure: nothing has been spent yet.
    const boundary = state.boundary;
    const bindingFault = boundaryBindingFault(root, boundary);
    assert.strictEqual(bindingFault, null, bindingFault || "");

    const prompt = Buffer.from(`${NEUTRAL_INSTRUCTION}\n\n${packetBytes.toString("utf8")}`, "utf8");
    const sessionId = crypto.randomUUID();
    const argv = reviewerArgv({ pluginDir: PLUGIN_DIR, sessionId, cwd: repoRoot, settingsPath: boundary.settingsPath });
    const intendedStdoutFile = path.join(root, "raw", `${sessionId}.stdout`);
    const intendedStderrFile = path.join(root, "raw", `${sessionId}.stderr`);
    // The fixed-point scenario runs two sessions against one audit directory, so each invocation is
    // validated only against the records that appear during it. Earlier records are kept, never reused.
    const auditBefore = auditSnapshot(boundary.auditDir);

    // THE START MARKER, persisted BEFORE the paid call. If anything after this point fails — an
    // exclusive-create collision, a full disk, a crash — this phase stays blocked forever and the
    // scenario must be rebuilt from `prepare`. That is the deliberate fail-closed direction: redoing
    // a scenario is cheap, while a second undetected reviewer call would destroy the one-attempt
    // property that is this harness's entire evidentiary basis.
    record(state, {
      stage: "invoke-start", phase: state.phase, sessionId,
      model: REVIEWER_MODEL, effort: REVIEWER_EFFORT, allowedTools: [...REVIEWER_TOOLS],
      mcpConfig: REVIEWER_MCP_CONFIG, executable: claudePath, argv,
      packetOrdinal: packet.ordinal, packetDigest: packet.digest,
      emissionId: packet.emissionId, inventoryDigest: packet.inventoryDigest,
      promptDigest: sha256(prompt), promptBytes: prompt.length,
      intendedStdoutFile, intendedStderrFile,
      boundary: {
        settingsPath: boundary.settingsPath, settingsDigest: boundary.settingsDigest,
        configPath: boundary.configPath, configDigest: boundary.configDigest,
        guardPath: boundary.guardPath, guardDigest: boundary.guardDigest,
        auditDir: boundary.auditDir, repoRootResolved: boundary.repoRootResolved,
        allowedCommands: [...boundary.allowedCommands], auditBefore: auditBefore.length,
      },
      toolRuleEnforcement: "the --allowed-tools rules are declared intent only: live probes showed "
        + "they are NOT an exclusive Bash allowlist in this environment. --restricted confines the "
        + "file tools; the PreToolUse hook in the bound settings file is the actual Bash deny "
        + "boundary. Whether that hook enforces as designed is established by this run's audit "
        + "records and by nothing else",
    });
    saveState(root, state);

    const run = cp.spawnSync(claudePath, argv, {
      cwd: repoRoot, shell: false, input: prompt, maxBuffer: 256 * 1024 * 1024,
    });
    const stdout = run.stdout || Buffer.alloc(0);
    const stderr = run.stderr || Buffer.alloc(0);
    // Raw output lands in the HARNESS root, never in the reviewer repo, and exclusively.
    const stdoutFile = createNew(root, intendedStdoutFile, stdout);
    const stderrFile = createNew(root, intendedStderrFile, stderr);

    // THE AUDIT VETO. Only records that appeared during THIS invocation count; earlier ones are kept
    // untouched. Hook-absent and hook-allowed look identical from the transcript, so missing positive
    // records mean the guard never mediated and this invocation is unusable — no retry.
    const { records, malformed, unstable } = readNewAuditRecords(boundary.auditDir, auditBefore);
    const audit = validateInvokeAudit({
      records, malformed, unstable, sessionId,
      expectedRoot: boundary.repoRootResolved, configDigest: boundary.configDigest,
      guardDigest: boundary.guardDigest, allowedCommands: boundary.allowedCommands,
    });

    const failed = run.status !== 0 || !audit.ok;
    const why = run.status !== 0
      ? `the reviewer process exited ${run.status}`
      : (audit.ok ? null : `the Bash guard audit did not validate: ${audit.problems.join("; ")}`);
    record(state, {
      stage: "invoke", outcome: failed ? "product-failure" : "ok", phase: state.phase, sessionId,
      model: REVIEWER_MODEL, effort: REVIEWER_EFFORT, executable: claudePath, argv,
      allowedTools: [...REVIEWER_TOOLS], mcpConfig: REVIEWER_MCP_CONFIG,
      packetOrdinal: packet.ordinal, packetDigest: packet.digest, emissionId: packet.emissionId,
      promptDigest: sha256(prompt), promptBytes: prompt.length,
      exitStatus: run.status, signal: run.signal || null,
      stdoutFile, stdoutBytes: stdout.length, stdoutDigest: sha256(stdout),
      stderrFile, stderrBytes: stderr.length, stderrDigest: sha256(stderr),
      audit: {
        ok: audit.ok, problems: audit.problems, passCounts: audit.passCounts,
        denyCount: audit.denyCount, recordCount: audit.recordCount,
        // CONTENT-BOUND, not name-bound: `wx` prevents a creation collision but leaves the file
        // writable, so only bytes+digest identify the version that was actually validated.
        manifest: audit.manifest, manifestDigest: audit.manifestDigest,
        malformed, unstable: unstable || null,
        auditDir: boundary.auditDir, configDigest: boundary.configDigest, guardDigest: boundary.guardDigest,
      },
      message: why,
      toolBoundary: "the --allowed-tools rules are declared intent only and were shown live NOT to be "
        + "an exclusive Bash allowlist here. --restricted confines the file tools; the PreToolUse "
        + "guard is the actual Bash deny boundary, and this run's audit records are the only evidence "
        + "that it mediated at all",
    });
    saveState(root, state);
    say(`session ${sessionId} exit ${run.status} stdout ${stdout.length}B sha256=${sha256(stdout)}`);
    say(`raw: ${stdoutFile}`);
    say(`bash audit: ${audit.recordCount} record(s), ${audit.denyCount} deny, passes ${JSON.stringify(audit.passCounts)}`);
    if (failed) {
      say(`PRODUCT FAILURE: ${why}`);
      say("Recorded durably. This scenario stops: no retry, no packet tuning.");
      return 1;
    }
    say(`next: node eval/loop-e2e/run-scenario.mjs ingest --root ${root}`);
    return 0;
  },

  ingest(args) {
    const { root, state, repoRoot } = openWorld(args);
    const selected = selectInvokeForIngest(state.events, state.phase);
    if (!selected.ok) {
      say(`REFUSED: ${selected.reason}`);
      return 1;
    }

    // FROM HERE THE ATTEMPT IS TERMINAL. A real invoke completion exists for this phase, so whatever
    // goes wrong below is recorded once as `outcome:"unusable"` and the scenario stops; the selector
    // above then refuses any second attempt.
    const review = loopPaths(repoRoot, state.taskId).review;
    let reviewWritten = false;
    try {
      assert.ok(lexicallyInside(repoRoot, review), `refusing ${review}: outside the reviewer repo`);
      const capturedFile = containedExistingFile(root, selected.event.stdoutFile);
      const captured = readBytes(capturedFile);
      const binding = captureBindingFault(selected.event, {
        path: capturedFile, bytes: captured.length, digest: sha256(captured),
      });
      if (binding !== null) throw fault("binding-mismatch", binding, { capturedFile });

      const sliced = sliceReviewBatch(captured);
      if (!sliced.ok) throw fault(`slice-${sliced.kind}`, sliced.message, sliced.detail);

      // Exactly the slice, written verbatim. Nothing parses it here: the controller's submit is the
      // first parser, which is the boundary review-packet.md:165-166 actually describes.
      let sliceFile;
      try {
        fs.mkdirSync(path.dirname(review), { recursive: true });
        fs.writeFileSync(review, sliced.slice);
        reviewWritten = true;
        sliceFile = createNew(root, path.join(root, "slices", `${selected.event.sessionId}.json`), sliced.slice);
        const persistedDigest = sha256(readBytes(review));
        assert.strictEqual(persistedDigest, sha256(sliced.slice), "the persisted file is not the slice");
      } catch (error) {
        throw fault("persist-failed", error.message, { review });
      }

      const entry = {
        phase: state.phase, sessionId: selected.event.sessionId, sliceFile, capturedFile,
        capturedDigest: sha256(captured), capturedBytes: captured.length,
        sliceDigest: sha256(sliced.slice), sliceBytes: sliced.slice.length,
        from: sliced.from, to: sliced.to, beginLine: sliced.beginLine, endLine: sliced.endLine,
      };
      state.slices.push(entry);
      record(state, { stage: "ingest", outcome: "ok", ...entry });
      saveState(root, state);
      say(`persisted ${sliced.slice.length}B sha256=${entry.sliceDigest} -> ${review}`);
      return 0;
    } catch (error) {
      // Clean ONLY a partially written controller review file, so the loop does not begin the next
      // operation on half-persisted reviewer bytes. Nothing else is touched. The attempt is OBSERVED
      // here, before anything is recorded or printed, so the event states what happened rather than
      // restating that a write had occurred.
      const partialReview = removeReviewFile(review, reviewWritten);
      const faultClass = classifyIngestFault(error);
      record(state, {
        stage: "ingest", outcome: "unusable", phase: state.phase, sessionId: selected.event.sessionId,
        fault: faultClass, message: error.message, detail: error.faultDetail ?? null,
        partialReview,
      });
      saveState(root, state);
      say(`REVIEWER OUTPUT UNUSABLE (${faultClass}): ${error.message}`);
      if (partialReview.attempted) {
        say(`partial review removed: ${partialReview.removed}${partialReview.error ? ` (${partialReview.error})` : ""}`);
      }
      say("Recorded durably. This scenario stops: no retry, no packet tuning, no moving to another phase.");
      return 1;
    }
  },

  submit(args) {
    const { root, state, repoRoot } = openWorld(args);
    const expect = flag(args, "--expect");
    assert.ok(["ready", "not-ready"].includes(expect), "--expect must be ready or not-ready");
    const blocked = attemptBlockedReason(state.events, "submit", state.phase);
    assert.strictEqual(blocked, null, blocked || "");

    const result = controller(repoRoot, "submit", state.taskId);
    let semantic = null;
    let payload = null;
    try {
      payload = expectOk(result);
      assert.strictEqual(payload.commitReady, expect === "ready", `commitReady was ${payload.commitReady}`);
      assert.strictEqual(payload.wasSeen, false, "no fingerprint repeat is expected in this scenario");

      const slice = state.slices[state.slices.length - 1];
      assert.ok(slice && slice.phase === state.phase, "the last ingested slice is not this phase's");
      // The submit RESPONSE carries no `reviewRawDigest` or finding identities — asserting on them
      // there would be vacuous. Both live on the admission record in control state
      // (`test-provenance-loop.mjs:701,709`), so read the persisted admission itself.
      const control = JSON.parse(fs.readFileSync(loopPaths(repoRoot, state.taskId).state, "utf8"));
      const admission = control.epoch.admitted.find(a => a.admissionId === payload.admissionId);
      assert.ok(admission, `admission ${payload.admissionId} is not in epoch.admitted`);
      assert.strictEqual(admission.reviewRawDigest, slice.sliceDigest,
        "the admission's reviewRawDigest must equal the digest of the persisted reviewer slice");
      assert.strictEqual(admission.fingerprint, payload.fingerprint, "the admission fingerprint must match the response");

      semantic = semanticSummary(admission);
      if (expect === "not-ready" && state.phase === "negative") {
        assert.ok(semantic.hasScopeViolation,
          `the reviewer did not identify a scope-violation on ${TEST_PATH}; kinds seen: `
          + `${semantic.findingKinds.join(", ") || "(none)"}`);
      }
      if (expect === "ready") {
        assert.strictEqual(semantic.semanticFindingCount, 0,
          `a ready submission must carry no semantic finding identities; saw ${semantic.findingKinds.join(", ")}`);
      }

      record(state, {
        stage: "submit", outcome: "ok", phase: state.phase, expect, admissionId: payload.admissionId,
        fingerprint: payload.fingerprint, commitReady: payload.commitReady, wasSeen: payload.wasSeen,
        admittedCount: payload.admittedCount, phaseOfAdmission: payload.phase,
        reviewRawDigest: admission.reviewRawDigest, sliceDigest: slice.sliceDigest,
        ...semantic, ...controllerTrace(result),
      });
      saveState(root, state);
      say(`submit: admission=${payload.admissionId} commitReady=${payload.commitReady} kinds=[${semantic.findingKinds.join(",")}]`);
      return 0;
    } catch (error) {
      return stopWithFailure(root, state, {
        stage: "submit", phase: state.phase, expect,
        admissionId: payload ? payload.admissionId : null,
        ...(semantic || {}), ...controllerTrace(result),
      }, error.message);
    }
  },

  commit(args) {
    const { root, state, repoRoot } = openWorld(args);
    const expect = flag(args, "--expect");
    assert.ok(["ok", "not-ready"].includes(expect), "--expect must be ok or not-ready");
    const blocked = attemptBlockedReason(state.events, "commit", state.phase);
    assert.strictEqual(blocked, null, blocked || "");

    const result = controller(repoRoot, "commit", state.taskId);
    try {
      if (expect === "not-ready") {
        // An EXPECTED refusal is a successful harness outcome: this is the AC41 not-ready path.
        const refusal = expectRefusal(result, "E_LOOP_NOT_COMMIT_READY");
        record(state, {
          stage: "commit", outcome: "ok", phase: state.phase, expect, committed: false,
          code: refusal.code, ...controllerTrace(result),
        });
        saveState(root, state);
        say(`commit refused as expected: ${refusal.code}`);
        return 0;
      }
      const payload = expectOk(result);
      record(state, {
        stage: "commit", outcome: "ok", phase: state.phase, expect, committed: true, code: null,
        payload, ...controllerTrace(result),
      });
      saveState(root, state);
      say(`commit: ${JSON.stringify(payload)}`);
      return 0;
    } catch (error) {
      return stopWithFailure(root, state, {
        stage: "commit", phase: state.phase, expect, committed: false, code: null, ...controllerTrace(result),
      }, error.message);
    }
  },

  verify(args) {
    const { root, state, repoRoot } = openWorld(args);
    const blocked = attemptBlockedReason(state.events, "verify", state.phase);
    assert.strictEqual(blocked, null, blocked || "");

    const result = controller(repoRoot, "verify", state.taskId);
    try {
      const payload = expectOk(result);
      assert.strictEqual(payload.ok, true, "the Step 6 consumer did not pass");
      assert.strictEqual(payload.historical, false, "the verification was a replay, not a fresh attempt");
      record(state, {
        stage: "verify", outcome: "ok", phase: state.phase, passed: true, historical: false,
        admissionId: payload.admissionId, attemptId: payload.attemptId, outcomeDetail: payload.outcome,
        ...controllerTrace(result),
      });
      saveState(root, state);
      say(`verify: ok=${payload.ok} historical=${payload.historical}`);
      return 0;
    } catch (error) {
      const payload = result.payload;
      return stopWithFailure(root, state, {
        stage: "verify", phase: state.phase,
        passed: payload && payload.ok === true, historical: payload ? payload.historical : null,
        outcomeDetail: payload ? payload.outcome : null, ...controllerTrace(result),
      }, error.message);
    }
  },

  evaluate(args) {
    const { root, state, repoRoot } = openWorld(args);
    const expect = flag(args, "--expect");
    assert.ok(["combined-true", "combined-false"].includes(expect), "--expect must be combined-true or combined-false");
    const blocked = attemptBlockedReason(state.events, "evaluate", state.phase);
    assert.strictEqual(blocked, null, blocked || "");

    const result = controller(repoRoot, "evaluate", state.taskId);
    const wantTrue = expect === "combined-true";
    try {
      assertSinglePayload(result);
      assert.strictEqual(result.exitStatus, wantTrue ? 0 : 1, `evaluate exit was ${result.exitStatus}`);
      assert.strictEqual(result.stream, wantTrue ? "stdout" : "stderr", "evaluate used the wrong stream for its verdict");
      const payload = result.payload;
      assert.ok(payload && typeof payload.combined === "boolean", "evaluate produced no boolean combined");
      assert.strictEqual(payload.combined, payload.loop.pass && payload.provenance.pass,
        "combined must be the conjunction of the two independently reported halves");
      assert.strictEqual(payload.combined, wantTrue, `combined was ${payload.combined}`);
      // An EXPECTED combined:false is a successful harness outcome: it is the negative arm's gate.
      record(state, {
        stage: "evaluate", outcome: "ok", phase: state.phase, expect,
        loopPass: payload.loop.pass, provenancePass: payload.provenance.pass, combined: payload.combined,
        loop: payload.loop, provenance: payload.provenance, ...controllerTrace(result),
      });
      saveState(root, state);
      say(`evaluate: loop=${payload.loop.pass} provenance=${payload.provenance.pass} combined=${payload.combined}`);
      return 0;
    } catch (error) {
      const payload = result.payload;
      return stopWithFailure(root, state, {
        stage: "evaluate", phase: state.phase, expect,
        loopPass: payload && payload.loop ? payload.loop.pass : null,
        provenancePass: payload && payload.provenance ? payload.provenance.pass : null,
        combined: payload ? payload.combined : null, ...controllerTrace(result),
      }, error.message);
    }
  },

  repair(args) {
    // `openWorld` already refuses when a terminal failure was recorded, so a dead negative phase can
    // never be walked past into a second paid reviewer call.
    const { root, state, repoRoot } = openWorld(args);
    // Explicit, not implied by the phase name.
    assert.strictEqual(state.scenario, "fixed-point", "repair belongs to the fixed-point scenario only");
    assert.strictEqual(state.phase, "negative", "repair applies to the negative phase only");
    const blocked = attemptBlockedReason(state.events, "repair", undefined);
    assert.strictEqual(blocked, null, blocked || "");
    // BEFORE any source mutation or emission: the whole five-step negative arm must be complete.
    // Otherwise an early repair moves the head, spends an emission, and leaves a scenario whose
    // repaired invoke could never be certified — discovered only at `gate`, after that paid call.
    const ordering = prefixGuardFault(state.events, state.scenario, "repair");
    assert.strictEqual(ordering, null, ordering || "");

    const repo = attachRepo(repoRoot);
    applyHead(repo, "repaired");
    state.phase = "repaired";

    const capture = captureSuiteRun(repo, state.captures.length + 1);
    assert.strictEqual(capture.exitStatus, 0, "the repaired run must actually be GREEN");
    writeCaptureFile(repo, capture);
    state.captures.push(capture);

    const before = latestEmission(state).inventoryDigest;
    const emitted = expectOk(controller(repoRoot, "emit", state.taskId));
    assert.notStrictEqual(emitted.inventoryDigest, before, "the repair must move the inventory digest");
    state.emissions.push({ phase: "repaired", ...emitted });
    record(state, { stage: "repair", outcome: "ok", from: "negative", to: "repaired", before, after: emitted.inventoryDigest });
    saveState(root, state);
    say(`repaired: I1=${before} I2=${emitted.inventoryDigest}`);
    return 0;
  },

  "stale-submit"(args) {
    const { root, state, repoRoot } = openWorld(args);
    const blocked = attemptBlockedReason(state.events, "stale-submit", undefined);
    assert.strictEqual(blocked, null, blocked || "");
    // BEFORE the stale bytes are written into the controller's review slot.
    const ordering = prefixGuardFault(state.events, state.scenario, "stale-submit");
    assert.strictEqual(ordering, null, ordering || "");

    const stale = state.slices.find(s => s.phase === "negative");
    assert.ok(stale, "no negative-phase slice is retained to replay");
    const staleFile = containedExistingFile(root, stale.sliceFile);
    const review = loopPaths(repoRoot, state.taskId).review;
    assert.ok(lexicallyInside(repoRoot, review), `refusing ${review}: outside the reviewer repo`);

    let wroteStale = false;
    let result = null;
    let probe = null;
    let failure = null;
    try {
      // `inspect` on BOTH sides, so "consumed no admission" is a measured before/after equality.
      const before = expectOk(controller(repoRoot, "inspect", state.taskId));
      fs.writeFileSync(review, readBytes(staleFile));
      wroteStale = true;
      result = controller(repoRoot, "submit", state.taskId);
      const refusal = expectRefusal(result, "E_LOOP_CLAIM_MISMATCH");
      const after = expectOk(controller(repoRoot, "inspect", state.taskId));
      assert.strictEqual(after.admittedCount, before.admittedCount,
        `the stale submission must consume no admission (before ${before.admittedCount}, after ${after.admittedCount})`);
      assert.strictEqual(after.observedIterations, before.observedIterations,
        "the stale submission must not move observedIterations");
      assert.strictEqual(after.status, before.status, "the stale submission must not lock the epoch");
      probe = {
        code: refusal.code, message: refusal.message,
        admittedBefore: before.admittedCount, admittedAfter: after.admittedCount,
        observedIterationsBefore: before.observedIterations, observedIterationsAfter: after.observedIterations,
      };
    } catch (error) {
      failure = error.message;
    }

    // UNCONDITIONAL, and OBSERVED BEFORE ANYTHING IS RECORDED OR PRINTED. Once the old slice was
    // written the review slot is cleared whatever happened, so no later operation begins on stale
    // reviewer bytes — and the event carries what was actually observed rather than an assumption.
    // Only this exact controller-derived path is touched; this is not a general cleanup.
    const staleReview = removeReviewFile(review, wroteStale);
    const cleanupFault = reviewCleanupFault(staleReview);

    if (failure === null && cleanupFault === null) {
      record(state, {
        stage: "stale-submit", outcome: "ok", phase: state.phase, ...probe, staleReview,
        ...controllerTrace(result),
      });
      saveState(root, state);
      say(`stale submit refused: ${probe.code} — no admission consumed; stale review removed: ${staleReview.removed}`);
      return 0;
    }
    // A correct controller refusal is NOT enough: if the stale bytes are still sitting in the review
    // slot, the scenario cannot honestly continue, so this is a product failure either way.
    return stopWithFailure(root, state, {
      stage: "stale-submit", phase: state.phase, ...(probe || {}), staleReview,
      code: result && result.payload ? result.payload.code : null,
      ...(result ? controllerTrace(result) : {}),
    }, failure || cleanupFault);
  },

  async gate(args) {
    const { root, state, repoRoot } = openWorld(args);

    // 1. the exact required history for this scenario, before anything else is believed.
    const history = validateHistory(state.events, state.scenario);
    assert.ok(history.ok, `the required ${state.scenario} history is not satisfied:\n  ${history.problems.join("\n  ")}`);

    // 2. one gate per scenario, checked BEFORE any collection or append.
    const blocked = gateBlockedReason(state.events);
    assert.strictEqual(blocked, null, blocked || "");

    // 3. the scenario-specific first-ledger invariant: nothing has appended before this gate.
    const ledgerFile = path.join(repoRoot, ...LEDGER_REL.split("/"));
    assert.ok(!fs.existsSync(ledgerFile),
      `${ledgerFile} already exists; this scenario requires gate to be the first and only ledger writer`);

    // 4. the start marker, persisted before any side effect, so a partial gate cannot append twice.
    record(state, {
      stage: "gate-start", scenario: state.scenario, ledgerAbsentBefore: true,
      ledgerInvariant: "SCENARIO-SPECIFIC: these worlds are fresh and only gate spawns the ledger CLI, "
        + "so the checked invariant is absence before and exactly one record after. A repository with "
        + "prior ledger history would need real complete-JSONL snapshot parsing instead.",
    });
    saveState(root, state);

    // 5. the declared control-state shape.
    const expectedAdmissions = state.scenario === "fixed-point" ? 2 : 1;
    const inspected = expectOk(controller(repoRoot, "inspect", state.taskId));
    assert.strictEqual(inspected.admittedCount, expectedAdmissions, `expected ${expectedAdmissions} admissions, saw ${inspected.admittedCount}`);
    assert.strictEqual(inspected.observedIterations, expectedAdmissions, `expected observedIterations ${expectedAdmissions}, saw ${inspected.observedIterations}`);
    assert.strictEqual(inspected.observedEpochs, 1, `expected one epoch, saw ${inspected.observedEpochs}`);
    assert.strictEqual(inspected.status, "open", "the epoch must not be locked at the fixed point");

    // 6. two READ-ONLY collections over a stable state. Equality is REPEATABILITY, not a claim that
    //    the two collections and the arbiter's evaluate observed the same instant — they did not.
    const first = await buildTestProvenanceBlock({ repoRoot, provenanceTaskId: state.taskId });
    const second = await buildTestProvenanceBlock({ repoRoot, provenanceTaskId: state.taskId });
    assert.deepStrictEqual(second, first, "two collections over a stable state must agree");
    assert.strictEqual(second.converged, true, `the collector reports converged=${second.converged}`);

    // 7. `--verify` is DERIVED: the final captured run really was green and the required history
    //    really ended in a passing verify and a combined-true evaluate. `--verdict` is NOT derived
    //    from any reviewer: this isolated harness has no arbiter authorised to issue READY or FIX
    //    REQUIRED, so it records the fail-closed token.
    const finalCapture = state.captures[state.captures.length - 1];
    const verifyToken = finalCapture.green && history.ok ? "pass" : "fail";
    const ledger = cp.spawnSync(process.execPath, [
      LEDGER_CLI, "append", "--cwd", repoRoot, "--task", "loop-e2e", "--verdict", "NOT READY",
      "--verify", verifyToken, "--panel", "full", "--provenance-task", state.taskId,
    ], { cwd: repoRoot, shell: false, maxBuffer: 32 * 1024 * 1024 });

    // 8. the whole file must now be exactly one newline-terminated JSON object. The CLI is fail-open
    //    and exits 0 even when collection fails, so its exit status is corroboration only.
    const afterBytes = readBytes(ledgerFile);
    const appended = parseSingleLedgerRecord(afterBytes);
    assert.deepStrictEqual(appended.testProvenance, second,
      "the CLI derives its own block; it must equal the collection taken immediately before");
    assert.notStrictEqual(appended.testProvenance.taskId, "unknown", "a taskId of 'unknown' means collection failed");

    record(state, {
      stage: "gate", outcome: "ok", ok: true, collectorEqual: true, converged: second.converged,
      admittedCount: inspected.admittedCount, observedIterations: inspected.observedIterations,
      observedEpochs: inspected.observedEpochs, counters: inspected.counters, block: second,
      ledger: {
        exitStatus: ledger.status,
        stdout: (ledger.stdout || Buffer.alloc(0)).toString("utf8"),
        stderr: (ledger.stderr || Buffer.alloc(0)).toString("utf8"),
        absentBefore: true, bytesAfter: afterBytes.length, recordsAfter: 1,
        verdict: "NOT READY",
        verdictReason: "this isolated harness has no arbiter authorised to issue READY or FIX REQUIRED; "
          + "the token is the fail-closed default and is NOT derived from any reviewer",
        verify: verifyToken,
        verifyReason: "derived from the final captured run's real exit status and the completed required history",
      },
      note: "collector equality is repeatability over a stable state, not a same-instant observation",
    });
    saveState(root, state);
    say(`gate: converged=${second.converged} admissions=${inspected.admittedCount} ledger=1 record`);
    return 0;
  },

  receipt(args) {
    const root = assertHarnessRoot(flag(args, "--root"));
    const state = loadState(root);
    const repoRoot = assertRepoRoot(state.repoRoot);
    const gated = state.events.filter(e => e.stage === "gate" && e.ok === true);
    assert.strictEqual(gated.length, 1, "receipt requires exactly one successful gate event; run `gate` first");

    // RE-VERIFY EVERY AUDIT MANIFEST, from disk, before writing anything. The reviewer and the hook
    // are NOT rerun; only the recorded bytes are recomputed. A fixed-point world has two invocation
    // manifests sharing one directory, so each is verified independently and no record may be
    // attributed to two sessions.
    // The boundary is re-derived, not inherited: a damaged `state.boundary.auditDir` would otherwise
    // send the listing below at the wrong directory before anything noticed.
    const bindingFault = boundaryBindingFault(root, state.boundary);
    assert.strictEqual(bindingFault, null, bindingFault || "");
    const boundAuditDir = state.boundary.auditDir;

    // NO `&& e.audit`. A successful invoke whose audit block is missing must become a problem, not
    // vanish from the collection and leave `ok` vacuously true.
    const invokes = state.events.filter(e => e.stage === "invoke" && e.outcome === "ok");
    const listing = listAuditDirectory(boundAuditDir);
    const closure = auditClosureProblems({
      scenario: state.scenario, invokes, boundAuditDir, observedNames: listing.names,
    });

    const auditReverification = {
      verifiedAt: new Date().toISOString(),
      boundAuditDir,
      expectedInvocations: closure.expectedInvocations,
      observedNames: closure.observedNames,
      claimedNames: closure.claimedNames,
      invocations: [],
      problems: [...listing.problems, ...closure.problems],
    };
    for (const event of invokes) {
      const audit = event.audit;
      if (audit === null || typeof audit !== "object" || Array.isArray(audit)) continue; // already a problem
      // Always against the BOUND directory, never an event-selected alternative.
      const result = verifyAuditManifest(boundAuditDir, audit.manifest, audit.manifestDigest);
      auditReverification.invocations.push({
        sessionId: event.sessionId, phase: event.phase, ordinal: event.ordinal,
        manifestDigest: audit.manifestDigest, ok: result.ok, problems: result.problems, entries: result.entries,
      });
      auditReverification.problems.push(...result.problems.map(p => `session ${event.sessionId}: ${p}`));
    }
    // Explicitly three-part, so a future re-introduced filter cannot make an empty set look verified.
    auditReverification.ok = auditReverification.problems.length === 0
      && auditReverification.invocations.length === closure.expectedInvocations
      && auditReverification.invocations.every(i => i.ok === true);
    assert.ok(auditReverification.ok,
      `the recorded Bash guard audits do not close over ${boundAuditDir}:\n  `
      + `${auditReverification.problems.join("\n  ") || "the invocation count or a per-invocation result did not hold"}`);
    const file = createNew(root, path.join(root, "receipt.json"), Buffer.from(`${JSON.stringify({
      kind: "ctide-loop-e2e-receipt",
      writtenAt: new Date().toISOString(),
      scenario: state.scenario,
      harnessRoot: root,
      reviewerRepo: repoRoot,
      harnessIsSecondImplementation:
        "the sentinel slice here reproduces review-packet.md's main-thread PROSE; it does not show a "
        + "model executing that prose slices identically",
      toolRuleEnforcement:
        "the --allowed-tools rules are recorded exactly as written into the argv, but live probes "
        + "showed they are NOT an exclusive Bash allowlist in this environment. --restricted confines "
        + "the file tools (proven live). The PreToolUse guard bound below is the actual Bash deny "
        + "boundary; the only evidence it mediated any call is this run's audit records, and that "
        + "evidence is specific to this machine, this CLI version and this run — managed settings "
        + "elsewhere could differ. No claim of free or verified Bash use is made.",
      allowedTools: [...REVIEWER_TOOLS],
      availableTools: REVIEWER_AVAILABLE_TOOLS,
      allowedCommands: [...ALLOWED_COMMANDS],
      boundary: state.boundary,
      auditReverification,
      mcpConfig: REVIEWER_MCP_CONFIG,
      sharedContract: state.shared,
      taskId: state.taskId,
      baseProvenance: state.baseProvenance,
      captures: state.captures.map(c => ({ ordinal: c.ordinal, command: c.command, exitStatus: c.exitStatus, summaryLines: c.summaryLines })),
      emissions: state.emissions,
      packets: state.packets,
      slices: state.slices,
      events: state.events,
    }, null, 2)}\n`, "utf8"));
    say(file);
    return 0;
  },

  supplemental(args) {
    const { root, state, repoRoot } = openWorld(args);
    assert.ok(state.events.some(e => e.stage === "gate" && e.ok === true),
      "run `gate` first: this probe is supplemental to the required facts");
    const repo = attachRepo(repoRoot);
    const saved = driftInScope(repo);
    const drifted = controller(repoRoot, "evaluate", state.taskId);
    revertDrift(repo, saved);
    assert.deepStrictEqual(readTestBytes(repo), saved, "the revert must be byte-exact");
    const restored = controller(repoRoot, "evaluate", state.taskId);
    record(state, {
      stage: "supplemental", outcome: "ok",
      note: "SUPPLEMENTAL ONLY — freshness sensitivity of the gate. Not AC41's recomputation half, "
        + "which the stale-submit and repaired-submit steps carry. Zero admissions, zero reviewers.",
      driftedCombined: drifted.payload ? drifted.payload.combined : null, driftedExit: drifted.exitStatus,
      restoredCombined: restored.payload ? restored.payload.combined : null, restoredExit: restored.exitStatus,
    });
    saveState(root, state);
    say(`supplemental: drifted combined=${drifted.payload && drifted.payload.combined}, restored combined=${restored.payload && restored.payload.combined}`);
    return 0;
  },
};

export async function main(argv) {
  const [stage, ...rest] = argv;
  const run = STAGES[stage || "help"];
  if (!run) {
    process.stderr.write(`unknown stage ${JSON.stringify(stage)}; try 'help'\n`);
    return 1;
  }
  return await run(rest);
}

// Direct-CLI only. Deliberately NOT the garden 9d `isInvokedDirectly()` cluster form: this file is
// outside `cressetide/**`, is not one of the 15 documented entry points, and must not be mistaken for
// a copy of that byte-identical set.
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try { return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
}

if (invokedDirectly()) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => {
    process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
    process.exitCode = 1;
  });
}
