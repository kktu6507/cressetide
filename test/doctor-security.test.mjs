import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decisionProbePassed, diagnose, probeEnv, runtimeProbePassed } from "../cressetide/skills/doctor/scripts/doctor.mjs";
import { root, run, tempDir, test, write } from "./helpers.mjs";

const pluginRoot = path.join(root, "cressetide");
const doctorScript = path.join(pluginRoot, "skills", "doctor", "scripts", "doctor.mjs");

function copyPlugin(prefix) {
  const copy = path.join(tempDir(prefix), "cressetide");
  fs.cpSync(pluginRoot, copy, { recursive: true });
  return copy;
}

function rewriteManifest(copy, mutate) {
  const file = path.join(copy, ".claude-plugin", "plugin.json");
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  mutate(manifest);
  fs.writeFileSync(file, JSON.stringify(manifest), "utf8");
}

async function agentStatus(copy) {
  return (await diagnose(copy)).checks.find(check => check.name === "agents")?.status;
}

test("Doctor agents row reads the filesystem only: exactly the expected agent files, each named by its own stem", async () => {
  const exact = copyPlugin("ctide-doctor-agent-exact-");
  assert.equal(await agentStatus(exact), "pass", "control: an exact copy passes (the manifest lists no agents)");

  const extraFile = copyPlugin("ctide-doctor-agent-extra-file-");
  write(path.join(extraFile, "agents", "ghost.agent.md"), "---\nname: ghost\n---\n");
  assert.equal(await agentStatus(extraFile), "fail", "extra filesystem entry");

  const missingFile = copyPlugin("ctide-doctor-agent-missing-file-");
  fs.rmSync(path.join(missingFile, "agents", "navigator.agent.md"));
  assert.equal(await agentStatus(missingFile), "fail", "missing filesystem entry");

  const notAnAgent = copyPlugin("ctide-doctor-agent-not-an-agent-");
  write(path.join(notAnAgent, "agents", "notes.md"), "---\nname: notes\n---\n");
  assert.equal(await agentStatus(notAnAgent), "fail", "an entry that is not an .agent.md file");

  const renamed = copyPlugin("ctide-doctor-agent-renamed-");
  const file = path.join(renamed, "agents", "arbiter.agent.md");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/^name: arbiter$/m, "name: judge"), "utf8");
  assert.equal(await agentStatus(renamed), "fail", "a frontmatter name that is not the file stem");

  const unnamed = copyPlugin("ctide-doctor-agent-unnamed-");
  const other = path.join(unnamed, "agents", "cartographer.agent.md");
  fs.writeFileSync(other, fs.readFileSync(other, "utf8").replace(/^name: cartographer\r?\n/m, ""), "utf8");
  assert.equal(await agentStatus(unnamed), "fail", "no frontmatter name");
});

test("Doctor statically inspects an arbitrary --plugin-root without executing its hook code", () => {
  const copy = copyPlugin("ctide-doctor-untrusted-");
  const marker = path.join(tempDir("ctide-doctor-marker-"), "executed.txt");
  fs.writeFileSync(
    path.join(copy, "hooks", "pre-tool-use.mjs"),
    'import fs from "node:fs";\nfs.appendFileSync(process.env.DOCTOR_TEST_MARKER, "executed\\n");\n',
    "utf8",
  );

  const result = run(process.execPath, [doctorScript, "--plugin-root", copy, "--json"], {
    env: { DOCTOR_TEST_MARKER: marker },
  });

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "unverified");
  assert.equal(report.checks.find(check => check.name === "runtime-probes")?.status, "unverified");
  assert.equal(fs.existsSync(marker), false, "untrusted hook code must not execute");
});

test("Doctor reports an exact copied plugin root as unverified when runtime probes are not trusted", async () => {
  const copy = copyPlugin("ctide-doctor-exact-copy-");
  const report = await diagnose(copy);
  assert.equal(report.status, "unverified");
  assert.equal(report.checks.find(check => check.name === "runtime-probes")?.status, "unverified");
});

test("Doctor node row (diagnose): process.versions.node 22.11.0 fails and 22.12.0 passes — the row applies the full >=22.12 floor, not a major-only check", async (t) => {
  const copy = copyPlugin("ctide-doctor-node-row-"); // an untrusted copy: the runtime probes are skipped
  const descriptor = Object.getOwnPropertyDescriptor(process.versions, "node");
  t.after(() => Object.defineProperty(process.versions, "node", descriptor));
  const nodeRow = async (version) => {
    Object.defineProperty(process.versions, "node", { ...descriptor, value: version });
    return (await diagnose(copy)).checks.find(check => check.name === "node");
  };
  assert.equal((await nodeRow("22.11.0")).status, "fail", "22.11.0 is below the 22.12 floor");
  assert.equal((await nodeRow("22.12.0")).status, "pass", "22.12.0 meets the floor");
  assert.equal((await nodeRow("20.19.5")).status, "fail", "an older major fails too");
});

test("Doctor redacts a secret carried in plugin.json's name before it reaches the manifest row (cressetide/lib/redact.mjs)", async () => {
  const copy = copyPlugin("ctide-doctor-secret-name-");
  rewriteManifest(copy, manifest => { manifest.name = "api_key=CTIDE_NAME_SENTINEL_SECRET"; });
  const report = await diagnose(copy);
  const manifestRow = report.checks.find(check => check.name === "manifest");
  assert.equal(manifestRow?.status, "fail");
  assert.match(manifestRow.detail, /^expected ctide@<semver>, got api_key=\[redacted\]$/);
  assert.doesNotMatch(JSON.stringify(report), /CTIDE_NAME_SENTINEL_SECRET/);
});

test("Doctor sanitizes its public plugin root and filesystem failure details", async () => {
  const sensitiveRoot = path.join(os.homedir(), "ctide-doctor-sensitive-root");
  const report = await diagnose(sensitiveRoot);
  const serialized = JSON.stringify(report);
  assert.equal(report.pluginRoot, "<plugin-root>");
  assert.ok(!serialized.toLowerCase().includes(os.homedir().toLowerCase()));
  assert.match(report.checks.find(check => check.name === "manifest")?.detail || "", /manifest check failed \(ENOENT\)/);
});

test("Doctor never echoes malformed JSON or hook syntax source payloads", async () => {
  const malformedManifest = copyPlugin("ctide-doctor-malformed-manifest-");
  fs.writeFileSync(path.join(malformedManifest, ".claude-plugin", "plugin.json"), "CTIDE_MANIFEST_PAYLOAD_SECRET", "utf8");
  const manifestReport = await diagnose(malformedManifest);
  assert.match(manifestReport.checks.find(check => check.name === "manifest")?.detail || "", /INVALID_JSON/);
  assert.doesNotMatch(JSON.stringify(manifestReport), /CTIDE_MANIFEST_PAYLOAD_SECRET/);

  const malformedHooks = copyPlugin("ctide-doctor-malformed-hooks-");
  fs.writeFileSync(path.join(malformedHooks, "hooks", "hooks.json"), "CTIDE_HOOKS_PAYLOAD_SECRET", "utf8");
  const hooksReport = await diagnose(malformedHooks);
  assert.match(hooksReport.checks.find(check => check.name === "hook-wiring")?.detail || "", /INVALID_JSON/);
  assert.doesNotMatch(JSON.stringify(hooksReport), /CTIDE_HOOKS_PAYLOAD_SECRET/);

  const syntaxSource = copyPlugin("ctide-doctor-syntax-payload-");
  fs.writeFileSync(path.join(syntaxSource, "hooks", "pre-tool-use.mjs"), "CTIDE_SYNTAX_PAYLOAD_SECRET @", "utf8");
  const syntaxReport = await diagnose(syntaxSource);
  const syntaxDetail = syntaxReport.checks.find(check => check.name === "hook:pre-tool-use.mjs")?.detail || "";
  assert.match(syntaxDetail, /syntax=1\(stderr=\d+ bytes\)/);
  assert.doesNotMatch(JSON.stringify(syntaxReport), /CTIDE_SYNTAX_PAYLOAD_SECRET/);
});

test("Doctor probes harmless valid events as well as malformed fail-open events", async () => {
  const report = await diagnose(pluginRoot);
  assert.equal(report.status, "pass", JSON.stringify(report, null, 2));
  for (const check of report.checks.filter(item => item.name.startsWith("hook:"))) {
    assert.match(check.detail, /syntax=0 valid=0 processed=1 malformed=0/, check.name);
  }
});

test("Doctor decision rows: the bundled root's PreToolUse entry denies a plan-mode Write and asks before git reset --hard", async () => {
  const report = await diagnose(pluginRoot);
  assert.deepEqual(
    report.checks.filter(check => check.name.startsWith("decision:")).map(check => [check.name, check.status, check.detail]),
    [["decision:plan-gate", "pass", "deny, as expected"], ["decision:destructive", "pass", "ask, as expected"]],
  );
});

test("Doctor decision rows are unverified, and never run, on an untrusted copy of the plugin", async () => {
  const copy = copyPlugin("ctide-doctor-decision-untrusted-");
  const report = await diagnose(copy);
  for (const name of ["decision:plan-gate", "decision:destructive"]) {
    const row = report.checks.find(check => check.name === name);
    assert.equal(row?.status, "unverified", name);
    assert.match(row.detail, /runtime probes not trusted \(requires trusted canonical root\)/, name);
  }
  assert.equal(report.status, "unverified");
});

// Every probe spawn runs with probeEnv(probeRoot): an ambient project whose settings turn every guard off,
// an ambient CTIDE_HOOK_DEBUG=1, and TEMP/TMP/TMPDIR pointed at a sentinel directory must change no row,
// and the sentinel directory must be empty afterwards (the probe root made in it is removed; no hook wrote
// a debug log there).
test("Doctor runtime probes override a hostile ambient environment: project opt-outs, CTIDE_HOOK_DEBUG=1 and TEMP all ignored, nothing left behind", async (t) => {
  const hostileRoot = tempDir("ctide-doctor-hostile-project-");
  fs.mkdirSync(path.join(hostileRoot, ".ctide", "memory"), { recursive: true });
  fs.writeFileSync(path.join(hostileRoot, ".ctide", "memory", "FAILURE_MEMORY.md"), "CTIDE_HOSTILE_AMBIENT_SENTINEL\n", "utf8");
  write(path.join(hostileRoot, ".claude", "settings.json"), JSON.stringify({ ctide: { planGate: false, destructiveGuard: false, contractGuard: false, preserveOnCompact: false } }));
  const sentinel = tempDir("ctide-doctor-hostile-temp-");
  const ambient = { CLAUDE_PROJECT_DIR: hostileRoot, CTIDE_HOOK_DEBUG: "1", CLAUDE_PLUGIN_DATA: hostileRoot, TEMP: sentinel, TMP: sentinel, TMPDIR: sentinel };
  const saved = Object.keys(ambient).map(key => [key, process.env[key]]);
  t.after(() => { for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  Object.assign(process.env, ambient);
  assert.equal(os.tmpdir(), sentinel, "fixture sanity: the doctor's temp directory is the sentinel");
  const report = await diagnose(pluginRoot);
  for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  assert.equal(report.status, "pass", JSON.stringify(report, null, 2));
  assert.doesNotMatch(JSON.stringify(report), /CTIDE_HOSTILE_AMBIENT_SENTINEL/);
  assert.deepEqual(fs.readdirSync(sentinel), [], "no probe left anything in the ambient temp directory");
});

test("probeEnv: no CTIDE_* switch and no CLAUDE_PLUGIN_DATA (any case on Windows); project and temp dirs are the probe root; debug only on request", (t) => {
  const ambient = { CTIDE_HOOK_DEBUG: "1", CTIDE_ENFORCE_STOP: "1", CLAUDE_PLUGIN_DATA: "x", CLAUDE_PROJECT_DIR: "elsewhere", TEMP: "elsewhere", TMP: "elsewhere", TMPDIR: "elsewhere", CTIDE_PROBE_KEEP_TEST: undefined };
  const saved = Object.keys(ambient).map(key => [key, process.env[key]]);
  t.after(() => { for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  for (const [key, value] of Object.entries(ambient)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  if (process.platform === "win32") process.env.Ctide_Mixed_Case = "1";
  t.after(() => { delete process.env.Ctide_Mixed_Case; });
  const quiet = probeEnv("PROBE");
  const names = Object.keys(quiet).map(key => (process.platform === "win32" ? key.toUpperCase() : key));
  assert.ok(!names.some(name => name.startsWith("CTIDE_")), `no CTIDE_* switch: ${names.filter(name => name.startsWith("CTIDE_"))}`);
  assert.ok(!names.includes("CLAUDE_PLUGIN_DATA"));
  for (const key of ["CLAUDE_PROJECT_DIR", "TEMP", "TMP", "TMPDIR"]) {
    assert.deepEqual(Object.entries(quiet).filter(([name]) => name.toUpperCase() === key), [[key, "PROBE"]], key);
  }
  assert.equal(quiet.PATH ?? quiet.Path, process.env.PATH, "everything else is inherited");
  assert.equal(probeEnv("PROBE", { debug: true }).CTIDE_HOOK_DEBUG, "1");
});

test("Doctor rejects silent exit-zero hook probes as no-op", () => {
  const silent = { status: 0, stdout: "", stderr: "" };
  for (const name of ["pre-tool-use.mjs", "session-start.mjs", "orchestration-check.js"]) {
    assert.equal(runtimeProbePassed(name, { syntax: silent, valid: silent, malformed: silent }), false, name);
  }
  const sessionWithPrefixOnly = { status: 0, stdout: "{}", stderr: "[ctide session-start] failure-memory: injected" };
  assert.equal(runtimeProbePassed("session-start.mjs", { syntax: silent, valid: sessionWithPrefixOnly, malformed: silent }), false);
  const wrongEvent = {
    status: 0,
    stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "Stop", additionalContext: "wrong event" } }),
    stderr: "[ctide session-start] compact-fidelity: emitted the preservation block",
  };
  assert.equal(runtimeProbePassed("session-start.mjs", { syntax: silent, valid: wrongEvent, malformed: silent }), false);
  const traced = { status: 0, stdout: "", stderr: "[ctide pre-tool-use] destructive-guard: no destructive match; allowing" };
  assert.equal(runtimeProbePassed("pre-tool-use.mjs", { syntax: silent, valid: traced, malformed: silent }), true, "control: a traced, silent PreToolUse probe passes");
});

test("decisionProbePassed: only exit 0 with the expected PreToolUse decision passes", () => {
  const decision = (permissionDecision, hookEventName = "PreToolUse") => JSON.stringify({ hookSpecificOutput: { hookEventName, permissionDecision, permissionDecisionReason: "r" } });
  assert.equal(decisionProbePassed("plan-gate", { status: 0, stdout: decision("deny") }), true, "control: deny");
  assert.equal(decisionProbePassed("destructive", { status: 0, stdout: decision("ask") }), true, "control: ask");
  for (const [label, kind, probe] of [
    ["allow", "plan-gate", { status: 0, stdout: decision("allow") }],
    ["allow", "destructive", { status: 0, stdout: decision("allow") }],
    ["wrong decision (ask for the plan gate)", "plan-gate", { status: 0, stdout: decision("ask") }],
    ["wrong decision (deny for the destructive check)", "destructive", { status: 0, stdout: decision("deny") }],
    ["no output", "plan-gate", { status: 0, stdout: "" }],
    ["non-JSON", "plan-gate", { status: 0, stdout: "deny" }],
    ["truncated JSON", "destructive", { status: 0, stdout: decision("ask").slice(0, 40) }],
    ["another event", "plan-gate", { status: 0, stdout: decision("deny", "SessionStart") }],
    ["exit 1", "plan-gate", { status: 1, stdout: decision("deny") }],
    ["killed (status null)", "destructive", { status: null, stdout: decision("ask") }],
    ["spawn error", "plan-gate", { status: 0, stdout: decision("deny"), error: new Error("spawn") }],
    ["unknown kind", "contract", { status: 0, stdout: decision("ask") }],
  ]) {
    assert.equal(decisionProbePassed(kind, probe), false, `${kind}: ${label}`);
  }
});
