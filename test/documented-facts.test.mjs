// Guards the `ctide-facts` block in docs/runtime-contract.md against the shipped runtime, and the
// owning prose against the block. Runtime behaviour is observed ONCE, in before(), over fixed input
// universes that are test INPUTS only — they carry no expected outcome. Every comparison afterwards is
// a pure function of (doc text, observations), so the mutation tests re-run it on in-memory text
// without spawning anything again. Completeness comes from the universes being fixed here and
// independent of the doc: dropping a value the runtime accepts, or listing one it rejects, both fail.
//
// Not protected, and still human-reviewed: runtime acceptance of inputs outside a universe (e.g.
// `y`); directory-name case variants (they cannot coexist in one tree on a case-insensitive
// filesystem); prose that ADDS a value where only omissions are checked (the table rows and Ship
// check 1); every README sentence in every language; hook decision logic and Doctor check
// semantics, which their own test files own.
//
// Hooks are never imported: they attach stdin listeners at module top level and export nothing, so
// every hook observation is a spawn that must exit 0 with the expected output shape. A spawn error, a
// non-zero exit, empty or non-JSON output, or an unexpected shape throws — it is never read as "the
// hook rejected this value". doctor.mjs and ship.mjs are import-safe (isInvokedDirectly guard) and are
// called only through functions they already export.
import assert from "node:assert/strict";
import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { before, after } from "node:test";
import { diagnose } from "../cressetide/skills/doctor/scripts/doctor.mjs";
import { versionConsistencyCheck } from "../cressetide/skills/ship/scripts/ship.mjs";
import { root, temporary, write } from "./helpers.mjs";
import { HOOKS, isolatedHome, mkTranscript } from "./support.mjs";

const DOCS = {
  runtime: path.join(root, "docs", "runtime-contract.md"),
  commands: path.join(root, "docs", "command-reference.md"),
  doctor: path.join(root, "cressetide", "skills", "doctor", "references", "diagnostic-contract.md"),
};

// --- fixed input universes (inputs only) -------------------------------------------------------------

const STOP_UNIVERSE = ["1", "true", "yes", "on", "0", "false", "off", "2", " 1", "", "enabled"];
const DEBUG_UNIVERSE = [undefined, "", "0", "false", "off", "1", " ", "x"]; // undefined = unset
const SHIP_UNIVERSE = [".git", ".ctide", "node_modules", "dist", "build", "coverage", "vendor", "docs", "src", "packages"];

// Upper-case and capitalized forms of each alphabetic STOP input, classified separately.
function caseVariants(value) {
  if (!/[a-z]/.test(value)) return [];
  return [...new Set([value.toUpperCase(), value[0].toUpperCase() + value.slice(1)])].filter((v) => v !== value);
}

// A blocking arbiter verdict followed by an explicit shipped sentinel: advisory by default, a Stop
// block only under enforcement — the shape test/orchestration-check.test.mjs already relies on.
const STOP_TRANSCRIPT = [
  { role: "assistant", content: [{ type: "tool_use", id: "g", name: "Task", input: { subagent_type: "ctide:arbiter" } }] },
  { role: "user", content: [{ type: "tool_result", tool_use_id: "g", content: "Final verdict: NOT READY — auth bypass unresolved." }] },
  { role: "assistant", content: "The change is complete and ready to ship.\nctide:delivery=shipped" },
];

const show = (value) => (value === undefined ? "<unset>" : JSON.stringify(value));

// --- runtime observation (spawned hooks, exported helpers) -------------------------------------------

function spawnHook(name, event, env, cwd, label) {
  const r = cp.spawnSync(process.execPath, [path.join(HOOKS, name)], {
    input: JSON.stringify(event), encoding: "utf8", timeout: 10000, env, cwd,
  });
  assert.equal(r.error, undefined, `${label}: spawning ${name} failed (${r.error && r.error.message})`);
  assert.equal(r.status, 0, `${label}: ${name} must exit 0; saw ${r.status} ${r.stderr}`);
  return r;
}

// Every temp path the child can see points into `dir`; CTIDE_HOOK_DEBUG is never inherited.
function isolatedEnv(dir) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: dir, TEMP: dir, TMP: dir, TMPDIR: dir };
  delete env.CTIDE_HOOK_DEBUG;
  return env;
}

function classifyStop(value, transcript, dir) {
  const label = `CTIDE_ENFORCE_STOP=${show(value)}`;
  const r = spawnHook("orchestration-check.js", { transcript_path: transcript }, { ...isolatedEnv(dir), CTIDE_ENFORCE_STOP: value }, dir, label);
  let out;
  try { out = JSON.parse(r.stdout); } catch { assert.fail(`${label}: stdout is not JSON: ${show(r.stdout)}`); }
  if (out && out.decision === "block" && typeof out.reason === "string" && out.reason) return true;
  if (out && !("decision" in out) && /arbiter's last verdict was 'NOT READY'/.test(String(out.systemMessage))) return false;
  assert.fail(`${label}: unexpected Stop-hook output ${show(r.stdout)}`);
}

function classifyDebug(value, parent) {
  const label = `CTIDE_HOOK_DEBUG=${show(value)}`;
  const dir = fs.mkdtempSync(path.join(parent, "debug-"));
  const env = isolatedEnv(dir);
  if (value !== undefined) env.CTIDE_HOOK_DEBUG = value;
  // A default-mode Write with no target path: plan-gate allows it silently and never touches the
  // filesystem, so the only side effect left to classify is the debug trace itself.
  const event = { hook_event_name: "PreToolUse", permission_mode: "default", tool_name: "Write", tool_input: {}, cwd: dir };
  const r = spawnHook("plan-gate.js", event, env, dir, label);
  assert.equal(r.stdout.trim(), "", `${label}: plan-gate must allow this event silently; saw ${show(r.stdout)}`);
  const onStderr = r.stderr.includes("[ctide plan-gate]");
  const log = path.join(dir, "ctide-hook.log");
  const inLog = fs.existsSync(log) && fs.readFileSync(log, "utf8").includes("[plan-gate]");
  assert.equal(onStderr, inLog, `${label}: the stderr trace and the isolated ctide-hook.log disagree`);
  return onStderr;
}

// An empty, untrusted plugin root: manifest, wiring and canonical-root checks fail, so the helper
// never executes a hook; the only difference --project can make is the names it adds.
async function observeDoctor(parent) {
  const pluginRoot = path.join(parent, "empty-plugin-root");
  const project = path.join(parent, "empty-project");
  fs.mkdirSync(pluginRoot);
  fs.mkdirSync(project);
  const plain = await diagnose(pluginRoot);
  const withProject = await diagnose(pluginRoot, { project: true, cwd: project });
  const probes = plain.checks.find((check) => check.name === "runtime-probes");
  assert.equal(probes && probes.status, "unverified", "an untrusted empty root must leave runtime-probes unverified, so no hook runs here");
  const plainNames = new Set(plain.checks.map((check) => check.name));
  const projectNames = withProject.checks.map((check) => check.name);
  for (const name of plainNames) assert.ok(projectNames.includes(name), `--project must be additive; it dropped ${name}`);
  return projectNames.filter((name) => !plainNames.has(name));
}

// One tree, one manifest per universe name at the root and one level down. The walk decides per
// directory entry, so every name is classified independently from the discovered-manifest list.
function observeShip(parent) {
  const tree = path.join(parent, "ship-tree");
  const manifest = (name) => JSON.stringify({ name, version: "1.0.0" });
  write(path.join(tree, "package.json"), manifest("fixture-root"));
  for (const dir of SHIP_UNIVERSE) {
    write(path.join(tree, dir, "package.json"), manifest(`fixture-${dir}`));
    write(path.join(tree, "workspace", dir, "package.json"), manifest(`fixture-nested-${dir}`));
  }
  const result = versionConsistencyCheck(tree);
  assert.equal(result.status, "pass", `every fixture manifest must parse and agree; saw ${result.status}: ${result.evidence}`);
  const found = new Set(result.manifests.map((entry) => entry.file));
  assert.ok(found.has("package.json"), "the root manifest must be discovered, or the walk did not run");
  const excluded = new Set();
  const boundary = [];
  for (const dir of SHIP_UNIVERSE) {
    const atRoot = found.has(`${dir}/package.json`);
    const nested = found.has(`workspace/${dir}/package.json`);
    if (atRoot !== nested) boundary.push(dir);
    else if (!atRoot) excluded.add(dir);
  }
  return { excluded, boundary };
}

// --- the fact block ----------------------------------------------------------------------------------

const FENCE = /^```ctide-facts[ \t]*\n([\s\S]*?)^```[ \t]*$/gm;

function readFacts(runtimeText) {
  const blocks = [...runtimeText.matchAll(FENCE)];
  if (blocks.length !== 1) return { errors: [`expected exactly one ctide-facts block; found ${blocks.length}`] };
  const facts = new Map();
  const errors = [];
  for (const raw of blocks[0][1].split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const at = line.indexOf("=");
    if (at < 0) { errors.push(`malformed line (no "="): ${line}`); continue; }
    const key = line.slice(0, at).trim();
    const values = line.slice(at + 1).split(",").map((value) => value.trim());
    if (!key) errors.push(`malformed line (empty key): ${line}`);
    else if (values.some((value) => !value)) errors.push(`${key}: empty value`);
    else if (new Set(values).size !== values.length) errors.push(`${key}: duplicate value`);
    else if (facts.has(key)) errors.push(`${key}: duplicate key`);
    else facts.set(key, values);
  }
  return { facts, errors };
}

function compareSet(label, documented, observed, { universe, verb }) {
  const errors = [];
  const doc = new Set(documented);
  if (universe) {
    for (const value of doc) if (!universe.includes(value)) errors.push(`${label}: documented value "${value}" is outside the test's input universe — add it there so it is actually observed`);
  }
  for (const value of observed) if (!doc.has(value)) errors.push(`${label}: the runtime ${verb}s "${value}" but the doc omits it`);
  for (const value of doc) {
    if ((!universe || universe.includes(value)) && !observed.has(value)) errors.push(`${label}: the doc lists "${value}" but the runtime does not ${verb} it`);
  }
  return errors;
}

// Every key must have a comparator here; a key without one fails as unknown.
const COMPARATORS = {
  "env.CTIDE_ENFORCE_STOP.accepts": (values, obs) =>
    compareSet("CTIDE_ENFORCE_STOP", values, obs.stopAccepted, { universe: STOP_UNIVERSE, verb: "accept" }),
  "env.CTIDE_ENFORCE_STOP.case": ([rule, ...rest], obs) => {
    if (rest.length || !["insensitive", "sensitive"].includes(rule)) return ['CTIDE_ENFORCE_STOP case: must be exactly "insensitive" or "sensitive"'];
    const errors = [];
    for (const [variant, { base, accepted }] of obs.stopVariants) {
      const expected = rule === "insensitive" && obs.stopAccepted.has(base);
      if (accepted !== expected) errors.push(`CTIDE_ENFORCE_STOP case: ${show(variant)} is ${accepted ? "accepted" : "rejected"}, which contradicts case = ${rule}`);
    }
    return errors;
  },
  "env.CTIDE_HOOK_DEBUG.enables": ([rule, ...rest], obs) => {
    if (rest.length || rule !== "non-empty") return ['CTIDE_HOOK_DEBUG enables: must be exactly "non-empty"'];
    return obs.debugEnabled
      .filter(([value, enabled]) => enabled !== (value !== undefined && value !== ""))
      .map(([value, enabled]) => `CTIDE_HOOK_DEBUG: ${show(value)} ${enabled ? "enables" : "does not enable"} the debug trace, which contradicts "non-empty"`);
  },
  "doctor.project.checks": (values, obs) => {
    const errors = compareSet("doctor --project", values, new Set(obs.doctorAdded), { verb: "add" });
    if (new Set(obs.doctorAdded).size !== obs.doctorAdded.length) errors.push(`doctor --project: a check name is reported more than once: ${obs.doctorAdded.join(", ")}`);
    return errors;
  },
  "ship.manifest.excludes": (values, obs) => [
    ...obs.shipBoundary.map((dir) => `ship manifest scan: "${dir}" is excluded at one depth but not the other`),
    ...compareSet("ship manifest scan", values, obs.shipExcluded, { universe: SHIP_UNIVERSE, verb: "exclude" }),
  ],
};

// --- owning prose: one table row, section or list item each, so unrelated text cannot mask an omission

const codeSpans = (text) => new Set([...text.matchAll(/`([^`\n]+)`/g)].map((match) => match[1]));

function tableRow(text, name) {
  const rows = text.split("\n").filter((line) => line.startsWith(`| \`${name}\` |`));
  return rows.length === 1 ? rows[0] : null;
}

function section(text, heading) {
  const lines = text.split("\n");
  const start = lines.indexOf(heading);
  if (start < 0) return null;
  const next = lines.findIndex((line, i) => i > start && line.startsWith("## "));
  return lines.slice(start + 1, next < 0 ? lines.length : next);
}

function listItem(lines, number) {
  const start = lines.findIndex((line) => line.startsWith(`${number}. `));
  if (start < 0) return null;
  const next = lines.findIndex((line, i) => i > start && /^\d+\. /.test(line));
  return lines.slice(start, next < 0 ? lines.length : next).join("\n");
}

function proseErrors(facts, docs) {
  const errors = [];
  const enforceRow = tableRow(docs.runtime, "CTIDE_ENFORCE_STOP");
  if (!enforceRow) errors.push("runtime-contract: expected exactly one CTIDE_ENFORCE_STOP table row");
  else {
    const spans = codeSpans(enforceRow);
    for (const value of facts.get("env.CTIDE_ENFORCE_STOP.accepts") || []) {
      if (!spans.has(value)) errors.push(`runtime-contract CTIDE_ENFORCE_STOP row does not name \`${value}\``);
    }
    const [rule] = facts.get("env.CTIDE_ENFORCE_STOP.case") || [];
    if (rule && !new RegExp(`case-${rule}`, "i").test(enforceRow)) errors.push(`runtime-contract CTIDE_ENFORCE_STOP row does not state case-${rule} matching`);
  }

  const debugRow = tableRow(docs.runtime, "CTIDE_HOOK_DEBUG");
  const [debugRule] = facts.get("env.CTIDE_HOOK_DEBUG.enables") || [];
  if (!debugRow) errors.push("runtime-contract: expected exactly one CTIDE_HOOK_DEBUG table row");
  else if (debugRule && !debugRow.includes(debugRule)) errors.push(`runtime-contract CTIDE_HOOK_DEBUG row does not state "${debugRule}"`);

  // Bullet LEADS, compared exactly both ways: a name that survives only inside another bullet's
  // text must not count as that check still being documented.
  const checks = facts.get("doctor.project.checks") || [];
  for (const [owner, lines, lead] of [
    ["command-reference /ctide:doctor section", section(docs.commands, "## `/ctide:doctor`"), /^- `([^`]+)`/],
    ["diagnostic-contract Project health section", section(docs.doctor, "## Project health (`--project`)"), /^- \*\*`([^`]+)`\.\*\*/],
  ]) {
    if (!lines) { errors.push(`${owner}: section not found`); continue; }
    const leads = lines.map((line) => line.match(lead)).filter(Boolean).map((match) => match[1]);
    for (const name of checks) if (!leads.includes(name)) errors.push(`${owner} has no bullet for \`${name}\``);
    for (const name of leads) if (!checks.includes(name)) errors.push(`${owner} has a bullet for \`${name}\`, which the facts block does not list`);
  }

  const ship = section(docs.commands, "## `/ctide:ship`");
  const checkOne = ship && listItem(ship, 1);
  if (!checkOne) errors.push("command-reference /ctide:ship check 1 not found");
  else {
    const spans = codeSpans(checkOne);
    for (const dir of facts.get("ship.manifest.excludes") || []) {
      if (!spans.has(dir)) errors.push(`command-reference /ctide:ship check 1 does not name \`${dir}\``);
    }
  }
  return errors;
}

function checkFacts(docs, obs) {
  const { facts, errors } = readFacts(docs.runtime);
  if (!facts) return errors;
  for (const key of facts.keys()) if (!Object.hasOwn(COMPARATORS, key)) errors.push(`unknown key ${key} (no comparator registered)`);
  for (const [key, compare] of Object.entries(COMPARATORS)) {
    if (!facts.has(key)) errors.push(`missing required key ${key}`);
    else errors.push(...compare(facts.get(key), obs));
  }
  return [...errors, ...proseErrors(facts, docs)];
}

// --- observation, once -------------------------------------------------------------------------------

const REAL_HOME = os.homedir(); // captured at load time, before before() isolates it
let homeDir;
let previousHome;
let previousUserProfile;
let scratch;
let transcriptDir;
let observations;
let docs;

before(async () => {
  // doctor.mjs reaches vigil modules that resolve home-relative paths at call time; isolate HOME the
  // same way test/doctor-project.test.mjs does, before any observation runs.
  ({ home: homeDir } = isolatedHome());
  previousHome = process.env.HOME;
  previousUserProfile = process.env.USERPROFILE;
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  assert.notStrictEqual(os.homedir(), REAL_HOME, "HOME isolation must be in effect before any observation runs");

  scratch = temporary("ctide-facts-");
  const transcript = mkTranscript(STOP_TRANSCRIPT);
  transcriptDir = path.dirname(transcript);

  const stopAccepted = new Set(STOP_UNIVERSE.filter((value) => classifyStop(value, transcript, scratch)));
  const stopVariants = new Map();
  for (const value of STOP_UNIVERSE) {
    for (const variant of caseVariants(value)) stopVariants.set(variant, { base: value, accepted: classifyStop(variant, transcript, scratch) });
  }
  const debugEnabled = DEBUG_UNIVERSE.map((value) => [value, classifyDebug(value, scratch)]);
  const doctorAdded = await observeDoctor(scratch);
  const { excluded: shipExcluded, boundary: shipBoundary } = observeShip(scratch);
  observations = { stopAccepted, stopVariants, debugEnabled, doctorAdded, shipExcluded, shipBoundary };
  docs = Object.fromEntries(Object.entries(DOCS).map(([key, file]) => [key, fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n")]));
});

after(() => {
  if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
  if (previousUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = previousUserProfile;
  for (const dir of [scratch, transcriptDir, homeDir]) {
    try { if (dir) fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  }
});

// --- tests -------------------------------------------------------------------------------------------

test("the ctide-facts block matches the shipped runtime, and its owning prose names every value", () => {
  assert.deepEqual(checkFacts(docs, observations), []);
});

const inBlock = (edit) => (d) => ({
  ...d, runtime: d.runtime.replace(/(```ctide-facts\n)([\s\S]*?)(```)/, (_, open, body, close) => open + edit(body) + close),
});
const inRow = (name, from, to) => (d) => ({
  ...d, runtime: d.runtime.split("\n").map((line) => (line.startsWith(`| \`${name}\` |`) ? line.replace(from, to) : line)).join("\n"),
});
const inDoc = (key, from, to) => (d) => ({ ...d, [key]: d[key].replace(from, to) });

const MUST_FAIL = [
  // block vs runtime: omissions and additions
  ["drop an accepted STOP value", inBlock((b) => b.replace("1, true, yes, on", "1, true, yes")), /the runtime accepts "on" but the doc omits it/],
  ["list a rejected STOP value", inBlock((b) => b.replace("1, true, yes, on", "1, true, yes, on, enabled")), /the doc lists "enabled" but the runtime does not accept it/],
  ["list a value outside the universe", inBlock((b) => b.replace("1, true, yes, on", "1, true, yes, on, maybe")), /"maybe" is outside the test's input universe/],
  ["claim case-sensitive matching", inBlock((b) => b.replace("= insensitive", "= sensitive")), /contradicts case = sensitive/],
  ["claim debug is enabled only by 1", inBlock((b) => b.replace("= non-empty", "= 1")), /must be exactly "non-empty"/],
  ["rename a Doctor check", inBlock((b) => b.replace("ledger-health", "ledger-status")), /the runtime adds "ledger-health" but the doc omits it/],
  ["drop a Doctor check", inBlock((b) => b.replace("incident-journals, ", "")), /the runtime adds "incident-journals" but the doc omits it/],
  ["list the project-health safety net as a check", inBlock((b) => b.replace("ledger-health", "ledger-health, project-health")), /the doc lists "project-health" but the runtime does not add it/],
  ["drop an excluded directory", inBlock((b) => b.replace(", vendor", "")), /the runtime excludes "vendor" but the doc omits it/],
  ["list a scanned directory as excluded", inBlock((b) => b.replace(", vendor", ", vendor, docs")), /the doc lists "docs" but the runtime does not exclude it/],
  // block structure
  ["no block", (d) => ({ ...d, runtime: d.runtime.replace("```ctide-facts", "```text") }), /exactly one ctide-facts block; found 0/],
  ["two blocks", (d) => ({ ...d, runtime: `${d.runtime}\n\`\`\`ctide-facts\ndoctor.project.checks = ledger-health\n\`\`\`\n` }), /exactly one ctide-facts block; found 2/],
  ["duplicate key", inBlock((b) => `${b}doctor.project.checks = ledger-health\n`), /doctor\.project\.checks: duplicate key/],
  ["missing key", inBlock((b) => b.replace(/^ship\.manifest\.excludes.*\n/m, "")), /missing required key ship\.manifest\.excludes/],
  ["unknown key", inBlock((b) => `${b}ship.manifest.includes = src\n`), /unknown key ship\.manifest\.includes/],
  // Names every plain object inherits: two methods, and the __proto__ accessor (a different lookup path).
  ["inherited name constructor as a key", inBlock((b) => `${b}constructor = x\n`), /unknown key constructor \(no comparator registered\)/],
  ["inherited name toString as a key", inBlock((b) => `${b}toString = x\n`), /unknown key toString \(no comparator registered\)/],
  ["inherited name __proto__ as a key", inBlock((b) => `${b}__proto__ = x\n`), /unknown key __proto__ \(no comparator registered\)/],
  ["line without =", inBlock((b) => `${b}orphan line\n`), /malformed line \(no "="\)/],
  ["empty value", inBlock((b) => b.replace("1, true, yes, on", "1, true, , on")), /env\.CTIDE_ENFORCE_STOP\.accepts: empty value/],
  ["duplicate value", inBlock((b) => b.replace("1, true, yes, on", "1, true, yes, on, on")), /env\.CTIDE_ENFORCE_STOP\.accepts: duplicate value/],
  // owning prose vs block
  ["ENFORCE row drops `on`", inRow("CTIDE_ENFORCE_STOP", "`yes` and `on`", "`yes`"), /CTIDE_ENFORCE_STOP row does not name `on`/],
  ["ENFORCE row drops its case rule", inRow("CTIDE_ENFORCE_STOP", "matched case-insensitively", "matched as written"), /does not state case-insensitive matching/],
  ["DEBUG row drops non-empty", inRow("CTIDE_HOOK_DEBUG", "any non-empty value", "any value"), /CTIDE_HOOK_DEBUG row does not state "non-empty"/],
  ["Ship check 1 drops `vendor`", inDoc("commands", " and `vendor`", ""), /check 1 does not name `vendor`/],
  ["command-reference drops the ledger-health bullet", inDoc("commands", /^- `ledger-health`.*\n.*\n/m, ""), /\/ctide:doctor section has no bullet for `ledger-health`/],
  // The masking case: the name still appears inside the ledger-health bullet, but no bullet leads with it.
  ["diagnostic-contract drops the failure-memory-health bullet", inDoc("doctor", "- **`failure-memory-health`.**", "- **Memory health.**"), /Project health section has no bullet for `failure-memory-health`/],
];

test("each omission, addition, malformed block or prose regression fails with a message naming it", () => {
  for (const [what, mutate, expected] of MUST_FAIL) {
    const mutant = mutate(docs);
    assert.notDeepEqual(mutant, docs, `${what}: the mutation must actually change the text`);
    const errors = checkFacts(mutant, observations);
    assert.ok(errors.some((error) => expected.test(error)), `${what}: expected an error matching ${expected}; saw ${JSON.stringify(errors)}`);
  }
});

const MUST_PASS = [
  ["reword the ENFORCE row, keeping its values", inRow("CTIDE_ENFORCE_STOP", "Upgrade the `orchestration-check.js` Stop hook from advisory to a hard block", "Turn the `orchestration-check.js` Stop hook's advisory into a hard block")],
  ["reorder values within a line", inBlock((b) => b.replace("1, true, yes, on", "on, yes, true, 1"))],
  ["add a comment and realign the block", inBlock((b) => `# restated from the prose above\n${b.replace(/ {2,}=/g, " =")}`)],
  ["edit unrelated prose", inDoc("runtime", "The plugin wires exactly six fail-open hooks:", "The plugin wires six fail-open hooks:")],
  ["reword a Doctor bullet, keeping its lead", inDoc("commands", "flags any `.ctide/incidents/*.md` not confirmed `closed`", "lists every incident journal not confirmed `closed`")],
];

test("harmless edits to the block and the owning prose stay green", () => {
  for (const [what, mutate] of MUST_PASS) {
    const edited = mutate(docs);
    assert.notDeepEqual(edited, docs, `${what}: the edit must actually change the text`);
    assert.deepEqual(checkFacts(edited, observations), [], what);
  }
});

const RUNTIME_DRIFT = [
  ["the Stop hook starts accepting enabled", (o) => ({ ...o, stopAccepted: new Set([...o.stopAccepted, "enabled"]) }), /the runtime accepts "enabled" but the doc omits it/],
  ["the Stop hook becomes case-sensitive", (o) => ({ ...o, stopVariants: new Map([...o.stopVariants].map(([k, v]) => [k, { ...v, accepted: false }])) }), /contradicts case = insensitive/],
  ["debug starts requiring 1", (o) => ({ ...o, debugEnabled: o.debugEnabled.map(([value]) => [value, value === "1"]) }), /contradicts "non-empty"/],
  ["Doctor stops adding ledger-health", (o) => ({ ...o, doctorAdded: o.doctorAdded.filter((name) => name !== "ledger-health") }), /the doc lists "ledger-health" but the runtime does not add it/],
  ["the Ship scan stops skipping vendor", (o) => ({ ...o, shipExcluded: new Set([...o.shipExcluded].filter((dir) => dir !== "vendor")) }), /the doc lists "vendor" but the runtime does not exclude it/],
  ["the Ship scan skips vendor at one depth only", (o) => ({ ...o, shipBoundary: [...o.shipBoundary, "vendor"] }), /"vendor" is excluded at one depth but not the other/],
];

test("drift on the runtime side is caught against the unchanged docs", () => {
  for (const [what, drift, expected] of RUNTIME_DRIFT) {
    const errors = checkFacts(docs, drift(observations));
    assert.ok(errors.some((error) => expected.test(error)), `${what}: expected an error matching ${expected}; saw ${JSON.stringify(errors)}`);
  }
});
