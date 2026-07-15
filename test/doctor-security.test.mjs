import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { diagnose, runtimeProbePassed } from "../cressetide/skills/doctor/scripts/doctor.mjs";
import { root, run, temporary, write } from "./helpers.mjs";

const pluginRoot = path.join(root, "cressetide");
const doctorScript = path.join(pluginRoot, "skills", "doctor", "scripts", "doctor.mjs");

function copyPlugin(prefix) {
  const copy = path.join(temporary(prefix), "cressetide");
  fs.cpSync(pluginRoot, copy, { recursive: true });
  return copy;
}

function rewriteManifest(copy, mutate) {
  const file = path.join(copy, ".claude-plugin", "plugin.json");
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  mutate(manifest);
  fs.writeFileSync(file, JSON.stringify(manifest), "utf8");
}

function agentStatus(copy) {
  return diagnose(copy).checks.find(check => check.name === "agents")?.status;
}

test("Doctor requires exact manifest agent paths to match the exact filesystem inventory", () => {
  const duplicate = copyPlugin("ctide-doctor-agent-duplicate-");
  rewriteManifest(duplicate, manifest => { manifest.agents[1] = manifest.agents[0]; });
  assert.equal(agentStatus(duplicate), "fail", "duplicate manifest path");

  const swappedPath = copyPlugin("ctide-doctor-agent-swapped-");
  rewriteManifest(swappedPath, manifest => { manifest.agents[0] = manifest.agents[0].replace("./agents/", "agents/"); });
  assert.equal(agentStatus(swappedPath), "fail", "non-exact replacement path");

  const extraManifest = copyPlugin("ctide-doctor-agent-extra-manifest-");
  rewriteManifest(extraManifest, manifest => { manifest.agents.push("./agents/ghost.agent.md"); });
  assert.equal(agentStatus(extraManifest), "fail", "extra manifest path");

  const missingManifest = copyPlugin("ctide-doctor-agent-missing-manifest-");
  rewriteManifest(missingManifest, manifest => { manifest.agents.pop(); });
  assert.equal(agentStatus(missingManifest), "fail", "missing manifest path");

  const extraFile = copyPlugin("ctide-doctor-agent-extra-file-");
  write(path.join(extraFile, "agents", "ghost.agent.md"), "---\nname: ghost\n---\n");
  assert.equal(agentStatus(extraFile), "fail", "extra filesystem entry");

  const missingFile = copyPlugin("ctide-doctor-agent-missing-file-");
  fs.rmSync(path.join(missingFile, "agents", "navigator.agent.md"));
  assert.equal(agentStatus(missingFile), "fail", "missing filesystem entry");
});

test("Doctor statically inspects an arbitrary --plugin-root without executing its hook code", () => {
  const copy = copyPlugin("ctide-doctor-untrusted-");
  const marker = path.join(temporary("ctide-doctor-marker-"), "executed.txt");
  fs.writeFileSync(
    path.join(copy, "hooks", "plan-gate.js"),
    'require("fs").appendFileSync(process.env.DOCTOR_TEST_MARKER, "executed\\n");\n',
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

test("Doctor reports an exact copied plugin root as unverified when runtime probes are not trusted", () => {
  const copy = copyPlugin("ctide-doctor-exact-copy-");
  const report = diagnose(copy);
  assert.equal(report.status, "unverified");
  assert.equal(report.checks.find(check => check.name === "runtime-probes")?.status, "unverified");
});

test("Doctor sanitizes its public plugin root and filesystem failure details", () => {
  const sensitiveRoot = path.join(os.homedir(), "ctide-doctor-sensitive-root");
  const report = diagnose(sensitiveRoot);
  const serialized = JSON.stringify(report);
  assert.equal(report.pluginRoot, "<plugin-root>");
  assert.ok(!serialized.toLowerCase().includes(os.homedir().toLowerCase()));
  assert.match(report.checks.find(check => check.name === "manifest")?.detail || "", /manifest check failed \(ENOENT\)/);
});

test("Doctor never echoes malformed JSON or hook syntax source payloads", () => {
  const malformedManifest = copyPlugin("ctide-doctor-malformed-manifest-");
  fs.writeFileSync(path.join(malformedManifest, ".claude-plugin", "plugin.json"), "CTIDE_MANIFEST_PAYLOAD_SECRET", "utf8");
  const manifestReport = diagnose(malformedManifest);
  assert.match(manifestReport.checks.find(check => check.name === "manifest")?.detail || "", /INVALID_JSON/);
  assert.doesNotMatch(JSON.stringify(manifestReport), /CTIDE_MANIFEST_PAYLOAD_SECRET/);

  const malformedHooks = copyPlugin("ctide-doctor-malformed-hooks-");
  fs.writeFileSync(path.join(malformedHooks, "hooks", "hooks.json"), "CTIDE_HOOKS_PAYLOAD_SECRET", "utf8");
  const hooksReport = diagnose(malformedHooks);
  assert.match(hooksReport.checks.find(check => check.name === "hook-wiring")?.detail || "", /INVALID_JSON/);
  assert.doesNotMatch(JSON.stringify(hooksReport), /CTIDE_HOOKS_PAYLOAD_SECRET/);

  const syntaxSource = copyPlugin("ctide-doctor-syntax-payload-");
  fs.writeFileSync(path.join(syntaxSource, "hooks", "plan-gate.js"), "CTIDE_SYNTAX_PAYLOAD_SECRET @", "utf8");
  const syntaxReport = diagnose(syntaxSource);
  const syntaxDetail = syntaxReport.checks.find(check => check.name === "hook:plan-gate.js")?.detail || "";
  assert.match(syntaxDetail, /syntax=1\(stderr=\d+ bytes\)/);
  assert.doesNotMatch(JSON.stringify(syntaxReport), /CTIDE_SYNTAX_PAYLOAD_SECRET/);
});

test("Doctor probes harmless valid events as well as malformed fail-open events", () => {
  const report = diagnose(pluginRoot);
  assert.equal(report.status, "pass", JSON.stringify(report, null, 2));
  for (const check of report.checks.filter(item => item.name.startsWith("hook:"))) {
    assert.match(check.detail, /syntax=0 valid=0 processed=1 malformed=0/, check.name);
  }
});

test("Doctor runtime probes override a hostile ambient project root", () => {
  const hostileRoot = temporary("ctide-doctor-hostile-project-");
  fs.mkdirSync(path.join(hostileRoot, ".ctide", "memory"), { recursive: true });
  fs.writeFileSync(path.join(hostileRoot, ".ctide", "memory", "FAILURE_MEMORY.md"), "CTIDE_HOSTILE_AMBIENT_SENTINEL\n", "utf8");
  const previous = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = hostileRoot;
  try {
    const report = diagnose(pluginRoot);
    assert.equal(report.status, "pass", JSON.stringify(report, null, 2));
    assert.doesNotMatch(JSON.stringify(report), /CTIDE_HOSTILE_AMBIENT_SENTINEL/);
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = previous;
  }
});

test("Doctor rejects silent exit-zero hook probes as no-op", () => {
  const silent = { status: 0, stdout: "", stderr: "" };
  for (const name of [
    "plan-gate.js", "destructive-guard.js", "contract-guard.js",
    "load-failure-memory.js", "compact-fidelity.js", "orchestration-check.js",
  ]) {
    assert.equal(runtimeProbePassed(name, { syntax: silent, valid: silent, malformed: silent }), false, name);
  }
  const loadWithPrefixOnly = { status: 0, stdout: "{}", stderr: "[ctide load-failure-memory] injected" };
  assert.equal(runtimeProbePassed("load-failure-memory.js", { syntax: silent, valid: loadWithPrefixOnly, malformed: silent }), false);
  const wrongEvent = {
    status: 0,
    stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "Stop", additionalContext: "wrong event" } }),
    stderr: "[ctide compact-fidelity] emitted",
  };
  assert.equal(runtimeProbePassed("compact-fidelity.js", { syntax: silent, valid: wrongEvent, malformed: silent }), false);
});
