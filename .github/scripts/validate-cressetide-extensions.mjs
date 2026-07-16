#!/usr/bin/env node
// Cressetide-specific validation layered after the core structural validator.
// These checks preserve the identity, Map, release, inventory, runtime-state, and text-integrity gates.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const pluginRoot = path.join(root, "cressetide");
const failures = [];
const fail = (message) => failures.push(message);
const slash = (value) => value.replaceAll("\\", "/");
const readJson = (relative) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8")); }
  catch (error) { fail(`${relative}: ${error.message}`); return null; }
};

function walk(directory, result = []) {
  if (!fs.existsSync(directory)) return result;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if ([".git", ".ctide", "node_modules", "_release"].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, result);
    else if (entry.isFile()) result.push(absolute);
  }
  return result;
}

function relative(file) { return slash(path.relative(root, file)); }

const market = readJson(".claude-plugin/marketplace.json");
const plugin = readJson("cressetide/.claude-plugin/plugin.json");
const pkg = readJson("package.json");
const entry = market?.plugins?.find((item) => item.name === "ctide");
if (market?.name !== "kktu") fail("marketplace name must be kktu");
if (entry?.source !== "./cressetide") fail("marketplace source must be ./cressetide");
if (pkg?.name !== "ctide" || plugin?.name !== "ctide" || plugin?.displayName !== "Cressetide") {
  fail("Cressetide package/plugin identity mismatch");
}

const expectedAgents = [
  "navigator", "implementer", "intent-reviewer", "test-reviewer", "code-reviewer",
  "security-reviewer", "architecture-reviewer", "operability-reviewer",
  "ui-ux-reviewer", "arbiter", "cartographer",
];
const agentFiles = fs.existsSync(path.join(pluginRoot, "agents"))
  ? fs.readdirSync(path.join(pluginRoot, "agents")).filter((name) => name.endsWith(".agent.md")).sort()
  : [];
if (JSON.stringify(agentFiles) !== JSON.stringify(expectedAgents.map((name) => `${name}.agent.md`).sort())) {
  fail("Cressetide agent file inventory mismatch");
}
const manifestAgents = (plugin?.agents || []).map((item) => item.replace("./agents/", "").replace(".agent.md", "")).sort();
if (JSON.stringify(manifestAgents) !== JSON.stringify([...expectedAgents].sort())) fail("Cressetide plugin agents[] mismatch");

const skillRoot = path.join(pluginRoot, "skills");
const expectedSkills = ["doctor", "map", "salvage", "vigil"];
const skillDirs = fs.existsSync(skillRoot)
  ? fs.readdirSync(skillRoot, { withFileTypes: true }).filter((item) => item.isDirectory()).map((item) => item.name).sort()
  : [];
if (JSON.stringify(skillDirs) !== JSON.stringify(expectedSkills)) fail("public skill inventory mismatch");
for (const name of expectedSkills) {
  const file = path.join(skillRoot, name, "SKILL.md");
  if (!fs.existsSync(file)) { fail(`missing skill ${name}`); continue; }
  const text = fs.readFileSync(file, "utf8");
  if (!text.startsWith("---") || !new RegExp(`^name:\\s*${name}\\s*$`, "m").test(text)) fail(`${name} frontmatter mismatch`);
  if (["doctor", "map"].includes(name)) {
    if (!/^disable-model-invocation:\s*true\s*$/m.test(text)) fail(`${name} must remain manual-only`);
    if (!/^user-invocable:\s*true\s*$/m.test(text)) fail(`${name} must remain user-invocable`);
  }
}
const vigil = fs.readFileSync(path.join(skillRoot, "vigil", "SKILL.md"), "utf8");
const roster = ((vigil.match(/subagents \(([^)]+)\)/) || [])[1] || "").match(/`([a-z0-9-]+)`/g)?.map((value) => value.slice(1, -1)).sort() || [];
if (JSON.stringify(roster) !== JSON.stringify([...expectedAgents].sort())) fail("Vigil subagent roster mismatch");

const expectedHooks = [
  ["PreToolUse", "Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell", "plan-gate.js"],
  ["PreToolUse", "Bash|PowerShell", "destructive-guard.js"],
  ["PreToolUse", "Write|Edit|MultiEdit", "contract-guard.js"],
  ["SessionStart", "startup|resume|clear|compact", "load-failure-memory.js"],
  ["SessionStart", "compact", "compact-fidelity.js"],
  ["Stop", "", "orchestration-check.js"],
];
const hooksJson = readJson("cressetide/hooks/hooks.json");
const actualHooks = [];
for (const [event, groups] of Object.entries(hooksJson?.hooks || {})) {
  for (const group of Array.isArray(groups) ? groups : []) {
    for (const hook of Array.isArray(group?.hooks) ? group.hooks : []) {
      const command = String(hook?.command || "");
      const name = command.match(/hooks\/([a-z0-9-]+\.js)/i)?.[1] || "";
      actualHooks.push([event, group.matcher || "", name]);
    }
  }
}
if (JSON.stringify(actualHooks.sort()) !== JSON.stringify(expectedHooks.sort())) fail("hook registration inventory or event mapping mismatch");
const hookScripts = fs.readdirSync(path.join(pluginRoot, "hooks")).filter((name) => name.endsWith(".js")).sort();
if (JSON.stringify(hookScripts) !== JSON.stringify(expectedHooks.map((item) => item[2]).sort())) fail("hook script inventory mismatch");
for (const name of hookScripts) {
  try { execFileSync(process.execPath, ["--check", path.join(pluginRoot, "hooks", name)], { stdio: "pipe" }); }
  catch { fail(`hook syntax check failed: ${name}`); }
}

const textExtensions = new Set([".md", ".json", ".js", ".mjs", ".cjs", ".yml", ".yaml", ".toml", ".txt"]);
const textFiles = walk(root).filter((file) => textExtensions.has(path.extname(file).toLowerCase()) ||
  ["LICENSE", ".gitignore", ".gitattributes", ".lycheeignore"].includes(path.basename(file)));
const decoder = new TextDecoder("utf-8", { fatal: true });
for (const file of textFiles) {
  const rel = relative(file);
  let text;
  try { text = decoder.decode(fs.readFileSync(file)); }
  catch { fail(`${rel}: invalid UTF-8`); continue; }
  if (text.includes("\uFFFD") || text.includes(String.fromCodePoint(0x5689)) || text.includes("\u0000")) {
    fail(`${rel}: text-integrity marker`);
    continue;
  }
}

const envNames = new Set();
for (const file of walk(pluginRoot).concat([
  path.join(root, ".github", "scripts", "publish-release.mjs"),
  path.join(root, ".github", "scripts", "publish-release-core.mjs"),
])) {
  if (!fs.existsSync(file) || !/\.[cm]?js$/.test(file)) continue;
  const text = fs.readFileSync(file, "utf8");
  for (const match of text.matchAll(/process\.env\.(CTIDE_[A-Z0-9_]+)/g)) envNames.add(match[1]);
}
const expectedEnvNames = ["CTIDE_ENFORCE_STOP", "CTIDE_HOOK_DEBUG", "CTIDE_REPAIR_PUBLISHED_RELEASE_ASSETS"];
if (JSON.stringify([...envNames].sort()) !== JSON.stringify(expectedEnvNames)) fail("supported Cressetide environment-variable inventory mismatch");

const publicCommands = new Set();
const publicCommandFiles = ["README.md", "README.zh-TW.md", "README.ja.md", "docs/command-reference.md"]
  .map((file) => path.join(root, file));
for (const file of publicCommandFiles) {
  const text = fs.readFileSync(file, "utf8");
  for (const match of text.matchAll(/\/ctide:([a-z][a-z0-9-]*)/g)) publicCommands.add(match[1]);
}
if (JSON.stringify([...publicCommands].sort()) !== JSON.stringify(expectedSkills)) fail("public command inventory mismatch");

for (const name of ["README.md", "README.zh-TW.md", "README.ja.md"]) {
  const text = fs.readFileSync(path.join(root, name), "utf8");
  for (const token of ["/ctide:vigil", "/ctide:salvage", "/ctide:map", "/ctide:doctor", ".ctide/"]) {
    if (!text.includes(token)) fail(`${name}: missing Cressetide public token ${token}`);
  }
}
const runtimeRoot = path.join(root, ".ctide");
if (fs.existsSync(runtimeRoot)) {
  try {
    const trackedRuntime = execFileSync("git", ["ls-files", "--", ".ctide"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    if (trackedRuntime) fail(`runtime .ctide state must not ship in the product repository: ${trackedRuntime.replace(/\r?\n/g, ", ")}`);
  } catch (error) {
    fail("runtime .ctide state is present outside a verifiable Git checkout");
  }
}
const gitignore = fs.existsSync(path.join(root, ".gitignore")) ? fs.readFileSync(path.join(root, ".gitignore"), "utf8") : "";
if (!gitignore.split(/\r?\n/).some((line) => line.trim() === "/.ctide/")) fail(".gitignore must contain /.ctide/");
if (!fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8").includes("## [Unreleased]")) fail("CHANGELOG must remain Unreleased");

if (failures.length) {
  for (const message of failures) console.error("FAIL " + message);
  process.exit(1);
}
console.log("Cressetide extension validation passed");
