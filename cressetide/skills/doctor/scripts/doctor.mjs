#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const expectedHooks = [
  "plan-gate.js", "destructive-guard.js", "contract-guard.js",
  "load-failure-memory.js", "compact-fidelity.js", "orchestration-check.js",
];
const expectedSkills = ["doctor", "map", "salvage", "vigil"];
const expectedAgents = [
  "navigator", "implementer", "intent-reviewer", "test-reviewer", "code-reviewer",
  "security-reviewer", "architecture-reviewer", "operability-reviewer",
  "ui-ux-reviewer", "arbiter", "cartographer",
];
const bundledPluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function resolvePluginRoot() {
  return path.resolve(
    argument("--plugin-root") ||
    process.env.CLAUDE_PLUGIN_ROOT ||
    bundledPluginRoot,
  );
}

function replaceSensitivePath(text, sensitivePath, replacement) {
  if (!sensitivePath) return text;
  const escaped = sensitivePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(escaped, process.platform === "win32" ? "gi" : "g"), replacement);
}
function sanitizeDiagnostic(value, limit = 2000) {
  let text = String(value ?? "")
    .replace(/-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/gi, "[redacted private key]")
    .replace(/[\r\n\t]+/g, " ").trim()
    .replace(/(["']?\bauthorization\b["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^,;|]+)/gi, "$1[redacted]")
    .replace(/(["']?\b(?:api(?:[_-]|\s+)?key|private(?:[_-]|\s+)?key|gh(?:[_-]|\s+)?token|token|secret|password)\b["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^,;|]+)/gi, "$1[redacted]")
    .replace(/\bbearer\s+["']?[A-Za-z0-9._~+/=-]+["']?/gi, "Bearer [redacted]")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "[redacted]");
  text = replaceSensitivePath(text, os.tmpdir(), "<temp>");
  text = replaceSensitivePath(text, os.homedir(), "~");
  return text.slice(0, limit);
}
function result(name, status, detail) { return { name, status, detail: sanitizeDiagnostic(detail) }; }
export function probeFailureDetail(label, probe) {
  const metadata = [];
  const stderrBytes = Buffer.byteLength(String(probe?.stderr ?? ""), "utf8");
  if (stderrBytes) metadata.push(`stderr=${Math.min(stderrBytes, 999999)} bytes`);
  const errorCode = String(probe?.error?.code || "").trim();
  if (/^[A-Za-z0-9_.-]{1,40}$/.test(errorCode)) metadata.push(`error=${errorCode}`);
  else if (probe?.error) metadata.push("error=present");
  return `${label}=${probe?.status}${metadata.length ? `(${metadata.join(" ")})` : ""}`;
}
function safeErrorCode(error) {
  const code = String(error?.code || "UNKNOWN");
  return /^[A-Z0-9_.-]{1,40}$/.test(code) ? code : "UNKNOWN";
}
function safeJson(file) {
  let source;
  try { source = fs.readFileSync(file, "utf8"); }
  catch (error) {
    const failure = new Error("JSON read failed");
    failure.code = safeErrorCode(error);
    throw failure;
  }
  try { return JSON.parse(source); }
  catch {
    const failure = new Error("Invalid JSON");
    failure.code = "INVALID_JSON";
    throw failure;
  }
}
function canonical(file) {
  try { return fs.realpathSync.native(file); } catch { return null; }
}
function sameCanonicalPath(left, right) {
  if (!left || !right) return false;
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function harmlessEvent(name, probeRoot) {
  const common = { cwd: probeRoot };
  if (name === "plan-gate.js") return { ...common, hook_event_name: "PreToolUse", permission_mode: "default", tool_name: "Write", tool_input: { file_path: path.join(probeRoot, "doctor-note.txt"), content: "doctor" } };
  if (name === "destructive-guard.js") return { ...common, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "echo ctide-doctor" } };
  if (name === "contract-guard.js") return { ...common, hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: path.join(probeRoot, ".ctide", "output", "contract.md"), content: "doctor" } };
  if (name === "load-failure-memory.js") return { ...common, hook_event_name: "SessionStart", source: "startup" };
  if (name === "compact-fidelity.js") return { ...common, hook_event_name: "SessionStart", source: "compact" };
  return { ...common, hook_event_name: "Stop", transcript_path: path.join(probeRoot, "doctor-transcript.jsonl") };
}

function observedHookSignal(name, probe) {
  const stem = name.replace(/\.js$/, "");
  if (!String(probe?.stderr || "").includes(`[ctide ${stem}]`)) return false;
  if (!["load-failure-memory.js", "compact-fidelity.js"].includes(name)) return true;
  try {
    const output = JSON.parse(probe.stdout || "{}");
    return output?.hookSpecificOutput?.hookEventName === "SessionStart" &&
      typeof output?.hookSpecificOutput?.additionalContext === "string" &&
      output.hookSpecificOutput.additionalContext.length > 0;
  } catch { return false; }
}

export function runtimeProbePassed(name, { syntax, valid, malformed }) {
  return syntax?.status === 0 && valid?.status === 0 && malformed?.status === 0 && observedHookSignal(name, valid);
}

function registrations(configuration) {
  const values = [];
  for (const [event, groups] of Object.entries(configuration?.hooks || {})) {
    for (const group of Array.isArray(groups) ? groups : []) {
      for (const hook of Array.isArray(group?.hooks) ? group.hooks : []) {
        const command = String(hook?.command || "");
        const name = command.match(/hooks\/([a-z0-9-]+\.js)/i)?.[1] ||
          (Array.isArray(hook?.args) ? String(hook.args.find(value => /hooks[\\/][a-z0-9-]+\.js/i.test(value)) || "").match(/hooks[\\/]([a-z0-9-]+\.js)/i)?.[1] : "");
        values.push([event, group.matcher || "", hook?.type || "", name || ""].join("|"));
      }
    }
  }
  return values.sort();
}

const expectedRegistrations = [
  ["PreToolUse", "Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell", "command", "plan-gate.js"],
  ["PreToolUse", "Bash|PowerShell", "command", "destructive-guard.js"],
  ["PreToolUse", "Write|Edit|MultiEdit", "command", "contract-guard.js"],
  ["SessionStart", "startup|resume|clear|compact", "command", "load-failure-memory.js"],
  ["SessionStart", "compact", "command", "compact-fidelity.js"],
  ["Stop", "", "command", "orchestration-check.js"],
].map(parts => parts.join("|")).sort();

export function diagnose(pluginRoot = resolvePluginRoot()) {
  const checks = [];
  let manifest;
  let manifestIdentityValid = false;
  try {
    manifest = safeJson(path.join(pluginRoot, ".claude-plugin", "plugin.json"));
    manifestIdentityValid = manifest.name === "ctide" && manifest.version === "0.1.0";
    checks.push(result("manifest", manifestIdentityValid ? "pass" : "fail", manifestIdentityValid ? "ctide@0.1.0" : "expected ctide@0.1.0"));
  } catch (error) { checks.push(result("manifest", "fail", `manifest check failed (${safeErrorCode(error)})`)); }

  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
  checks.push(result("node", nodeMajor >= 20 ? "pass" : "fail", `${process.execPath} ${process.version}`));

  let hookConfiguration;
  let hookWiringExact = false;
  try {
    hookConfiguration = safeJson(path.join(pluginRoot, "hooks", "hooks.json"));
    const actualScripts = fs.readdirSync(path.join(pluginRoot, "hooks")).filter(name => name.endsWith(".js")).sort();
    hookWiringExact = JSON.stringify(registrations(hookConfiguration)) === JSON.stringify(expectedRegistrations) &&
      JSON.stringify(actualScripts) === JSON.stringify([...expectedHooks].sort());
    checks.push(result("hook-wiring", hookWiringExact ? "pass" : "fail", `${expectedHooks.length} expected hooks`));
  } catch (error) { checks.push(result("hook-wiring", "fail", `hook wiring check failed (${safeErrorCode(error)})`)); }

  const staticHookChecks = expectedHooks.map(name => {
    const hook = path.join(pluginRoot, "hooks", name);
    const syntax = spawnSync(process.execPath, ["--check", hook], { encoding: "utf8", timeout: 5000 });
    return { hook, name, syntax };
  });
  const trustedCanonicalRoot = sameCanonicalPath(canonical(pluginRoot), canonical(bundledPluginRoot));
  const runtimeEligible = manifestIdentityValid && hookWiringExact && trustedCanonicalRoot;
  if (runtimeEligible) {
    const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-doctor-"));
    try {
      fs.writeFileSync(path.join(probeRoot, "doctor-transcript.jsonl"), "", "utf8");
      fs.mkdirSync(path.join(probeRoot, ".ctide", "memory"), { recursive: true });
      fs.writeFileSync(path.join(probeRoot, ".ctide", "memory", "FAILURE_MEMORY.md"), "Doctor runtime probe memory\n", "utf8");
      const probeEnv = {
        ...process.env,
        CLAUDE_PROJECT_DIR: probeRoot,
        CTIDE_HOOK_DEBUG: "1",
        TEMP: probeRoot,
        TMP: probeRoot,
        TMPDIR: probeRoot,
      };
      let runtimePassed = true;
      for (const { hook, name, syntax } of staticHookChecks) {
        const valid = spawnSync(process.execPath, [hook], { input: JSON.stringify(harmlessEvent(name, probeRoot)), encoding: "utf8", timeout: 5000, cwd: probeRoot, env: probeEnv });
        const malformed = spawnSync(process.execPath, [hook], { input: "{", encoding: "utf8", timeout: 5000, cwd: probeRoot });
        const processed = observedHookSignal(name, valid);
        const passed = runtimeProbePassed(name, { syntax, valid, malformed });
        runtimePassed &&= passed;
        const summary = `syntax=${syntax.status} valid=${valid.status} processed=${processed ? 1 : 0} malformed=${malformed.status}`;
        const detail = passed ? summary : `${summary} ${[probeFailureDetail("syntax", syntax), probeFailureDetail("valid", valid), probeFailureDetail("malformed", malformed)].join(" ")}`;
        checks.push(result(`hook:${name}`, passed ? "pass" : "fail", detail));
      }

      const debug = spawnSync(process.execPath, [path.join(pluginRoot, "hooks", "plan-gate.js")], {
        input: "{", encoding: "utf8", timeout: 5000, cwd: probeRoot,
        env: { ...process.env, CLAUDE_PROJECT_DIR: probeRoot, CTIDE_HOOK_DEBUG: "1", TEMP: probeRoot, TMP: probeRoot, TMPDIR: probeRoot },
      });
      const debugLog = path.join(probeRoot, "ctide-hook.log");
      const debugLogText = fs.existsSync(debugLog) ? fs.readFileSync(debugLog, "utf8") : "";
      const debugSafe = debug.status === 0 && debug.stderr.includes("[ctide plan-gate]") && debugLogText.includes("[plan-gate]") && !debugLogText.includes("CTIDE_HOOK_DEBUG=1");
      runtimePassed &&= debugSafe;
      checks.push(result("hook-debug", debugSafe ? "pass" : "fail", debugSafe ? "isolated prefix and log probe" : probeFailureDetail("debug", debug)));
      checks.push(result("runtime-probes", runtimePassed ? "pass" : "fail", "trusted canonical plugin root"));
    } finally { fs.rmSync(probeRoot, { recursive: true, force: true }); }
  } else {
    for (const { name, syntax } of staticHookChecks) {
      checks.push(result(`hook:${name}`, syntax.status === 0 ? "pass" : "fail", syntax.status === 0 ? `syntax=${syntax.status} runtime=skipped` : `${probeFailureDetail("syntax", syntax)} runtime=skipped`));
    }
    const reasons = [
      !manifestIdentityValid && "manifest identity",
      !hookWiringExact && "exact hook wiring",
      !trustedCanonicalRoot && "trusted canonical root",
    ].filter(Boolean).join(", ");
    checks.push(result("runtime-probes", "unverified", `requires ${reasons}`));
  }

  const skillsPresent = expectedSkills.every(name => fs.existsSync(path.join(pluginRoot, "skills", name, "SKILL.md")));
  checks.push(result("skills", skillsPresent ? "pass" : "fail", `${expectedSkills.length} public skills`));
  try {
    const expectedAgentPaths = expectedAgents.map(name => `./agents/${name}.agent.md`).sort();
    const manifestAgentPaths = Array.isArray(manifest?.agents) ? [...manifest.agents].sort() : [];
    const filesystemAgentPaths = fs.readdirSync(path.join(pluginRoot, "agents")).map(name => `./agents/${name}`).sort();
    const agentsExact = JSON.stringify(manifestAgentPaths) === JSON.stringify(expectedAgentPaths) &&
      JSON.stringify(filesystemAgentPaths) === JSON.stringify(expectedAgentPaths);
    checks.push(result("agents", agentsExact ? "pass" : "fail", `${manifestAgentPaths.length} manifest paths; ${filesystemAgentPaths.length} filesystem entries`));
  } catch (error) { checks.push(result("agents", "fail", `agent inventory check failed (${safeErrorCode(error)})`)); }
  checks.push(result("telemetry", "pass", "No network or telemetry probe performed"));

  return {
    pluginRoot: trustedCanonicalRoot ? "<bundled-plugin-root>" : "<plugin-root>",
    status: checks.some(check => check.status === "fail")
      ? "fail"
      : checks.some(check => check.status === "unverified")
        ? "unverified"
        : "pass",
    checks,
    guidance: ["claude plugin marketplace add kktu6507/cressetide", "claude plugin install ctide@kktu", "Restart Claude Code after enablement changes"],
  };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const report = diagnose();
  if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Cressetide doctor: ${report.status}`);
    for (const check of report.checks) console.log(`${check.status.toUpperCase()} ${check.name}: ${check.detail}`);
    console.log(report.guidance.join("\n"));
  }
  if (report.status !== "pass") process.exitCode = 1;
}
