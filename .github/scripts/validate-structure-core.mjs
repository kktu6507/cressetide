#!/usr/bin/env node
// Structural validation for the ctide plugin. Auth-free, deterministic.
// Exits non-zero with a clear message on the first failure.
import cp from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const errors = [];
const fail = (m) => errors.push(m);

function readJSON(rel) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) return fail(`missing file: ${rel}`), null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    return fail(`invalid JSON in ${rel}: ${e.message}`), null;
  }
}

// The plugin itself lives in ./cressetide (only that subdir ships); the marketplace
// manifest stays at the repo root.
const PLUGIN = "cressetide";

// 1. plugin.json
const plugin = readJSON(`${PLUGIN}/.claude-plugin/plugin.json`);
if (plugin) {
  for (const k of ["name", "version", "description"]) {
    if (!plugin[k]) fail(`plugin.json missing "${k}"`);
  }
}

// 2. marketplace.json
const market = readJSON(".claude-plugin/marketplace.json");
let marketPluginVersion = null;
if (market) {
  if (!market.name) fail(`marketplace.json missing "name"`);
  if (!Array.isArray(market.plugins) || market.plugins.length === 0) {
    fail(`marketplace.json must list at least one plugin`);
  } else {
    const entry = market.plugins.find((p) => p.name === (plugin && plugin.name));
    if (!entry) fail(`marketplace.json has no plugin entry matching plugin.json name "${plugin && plugin.name}"`);
    else if (entry.version == null) fail(`marketplace entry "${entry.name}" missing "version"`);
    else marketPluginVersion = entry.version;
  }
}

// 3. version agreement between plugin.json and marketplace entry
if (plugin && marketPluginVersion && plugin.version !== marketPluginVersion) {
  fail(`version mismatch: plugin.json ${plugin.version} vs marketplace ${marketPluginVersion}`);
}

// 3b. metadata.version present + semver, and agrees with the plugin version
const SEMVER = /^\d+\.\d+\.\d+(?:[-+].+)?$/;
if (market) {
  const mv = market.metadata && market.metadata.version;
  if (mv == null) fail(`marketplace.json missing "metadata.version"`);
  else if (!SEMVER.test(mv)) fail(`marketplace.json metadata.version "${mv}" is not semver`);
  else if (plugin && plugin.version !== mv) fail(`version mismatch: plugin.json ${plugin.version} vs metadata.version ${mv}`);
}
if (plugin && plugin.version && !SEMVER.test(plugin.version)) fail(`plugin.json version "${plugin.version}" is not semver`);

// 3c. CHANGELOG has an entry for the current plugin version
if (plugin && plugin.version) {
  const clPath = path.join(root, "CHANGELOG.md");
  if (!fs.existsSync(clPath)) fail(`missing CHANGELOG.md`);
  else if (!new RegExp(`^##\\s*\\[?${plugin.version.replace(/\./g, "\\.")}\\]?`, "m").test(fs.readFileSync(clPath, "utf8"))) {
    fail(`CHANGELOG.md has no "## [${plugin.version}]" entry`);
  }
}

// 3d. root package.json version agrees with the plugin version, so a bump can't
// update the manifests but forget package.json (or vice-versa).
const pkg = readJSON("package.json");
if (pkg && plugin && pkg.version !== plugin.version) {
  fail(`version mismatch: package.json ${pkg.version} vs plugin.json ${plugin.version}`);
}

// 4. hooks.json parses (if present)
if (fs.existsSync(path.join(root, `${PLUGIN}/hooks/hooks.json`))) readJSON(`${PLUGIN}/hooks/hooks.json`);

// 5. every agent and SKILL has YAML frontmatter with name + description
function checkFrontmatter(rel) {
  const text = fs.readFileSync(path.join(root, rel), "utf8");
  if (!text.startsWith("---")) return fail(`${rel}: missing frontmatter`);
  const end = text.indexOf("\n---", 3);
  if (end === -1) return fail(`${rel}: unterminated frontmatter`);
  const fm = text.slice(3, end);
  if (!/\bname\s*:/.test(fm)) fail(`${rel}: frontmatter missing "name"`);
  if (!/\bdescription\s*:/.test(fm)) fail(`${rel}: frontmatter missing "description"`);
}

function walk(dir, fn) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) walk(rel, fn);
    else fn(rel);
  }
}

walk(`${PLUGIN}/agents`, (rel) => { if (rel.endsWith(".md")) checkFrontmatter(rel); });
walk(`${PLUGIN}/skills`, (rel) => { if (path.basename(rel) === "SKILL.md") checkFrontmatter(rel); });

// 5b. every reference / agent / hook that SKILL.md or hooks.json points to must exist
// (catches a renamed/deleted reference or agent that prose alone would not surface).
const skillRel = `${PLUGIN}/skills/vigil/SKILL.md`;
if (fs.existsSync(path.join(root, skillRel))) {
  const skill = fs.readFileSync(path.join(root, skillRel), "utf8");
  for (const m of new Set([...skill.matchAll(/references\/([a-z0-9-]+\.md)/gi)].map((x) => x[1]))) {
    if (!fs.existsSync(path.join(root, `${PLUGIN}/skills/${m === "vigil-map-overlay.md" ? "map" : "vigil"}/references/${m}`)))
      fail(`SKILL.md links a missing reference: references/${m}`);
  }
  const roster = (skill.match(/subagents \(([^)]+)\)/) || [])[1] || "";
  // The manifest-coverage check below only bites when `plugin.agents` is an array. Guard the
  // prerequisite explicitly: if SKILL.md declares a roster but the manifest has no agents[] array,
  // Claude Code would fall back to the default scan (losing the explicit `.agent.md` wiring Copilot
  // needs) and the coverage check would silently no-op — so fail loudly instead.
  if (roster && !(plugin && Array.isArray(plugin.agents)))
    fail(`SKILL.md declares a subagents roster but plugin.json has no agents[] array (explicit wiring missing)`);
  for (const m of roster.matchAll(/`([a-z0-9-]+)`/gi)) {
    const name = m[1];
    if (!fs.existsSync(path.join(root, `${PLUGIN}/agents/${name}.agent.md`)))
      fail(`SKILL.md names agent "${name}" but ${PLUGIN}/agents/${name}.agent.md is missing`);
    // Manifest coverage: Claude Code now loads agents via the plugin.json `agents` array, so an
    // agent that exists on disk but is not wired in the manifest would silently fail to load.
    if (plugin && Array.isArray(plugin.agents) && !plugin.agents.some((p) => p.endsWith(`/${name}.agent.md`)))
      fail(`SKILL.md names agent "${name}" but plugin.json agents[] does not wire agents/${name}.agent.md`);
  }
}
// 5d. the compact (default) final-report rendering must keep the machine contract — the sentinel
// tokens and the verdict literals — inside its EMITTABLE template fence, not merely somewhere in the
// file (the intro paragraph also names them in prose). `references/final-report.md` is their sole owner,
// and the compact block is what most runs emit by default; guard against a future edit
// silently dropping them from the compact template (which would make the Stop hook go inert with every
// other gate still green). Scope the check to the compact `~~~markdown` fence so a prose copy cannot mask
// a real deletion, and fail CLOSED if the report structure moved (so the guard can't silently degrade).
const finalReportRel = `${PLUGIN}/skills/vigil/references/final-report.md`;
if (fs.existsSync(path.join(root, finalReportRel))) {
  const fr = fs.readFileSync(path.join(root, finalReportRel), "utf8");
  const afterCompactHeading = fr.split(/^##\s+Default \(compact\)/m)[1];
  // Bound to the compact section BEFORE matching the fence, so a deleted/mangled compact fence cannot
  // fall through to the `--report full` fence (which also holds the literals) and silently pass green.
  const compactSection = afterCompactHeading && afterCompactHeading.split(/^##\s+`--report full`/m)[0];
  const fence = compactSection && compactSection.match(/~~~markdown\n([\s\S]*?)\n~~~/);
  if (!fence) {
    fail(`final-report.md: cannot locate the compact (Default) ~~~markdown template fence — the report structure changed; re-point the 5d sentinel guard`);
  } else {
    const compactFence = fence[1];
    for (const tok of ["ctide:verify=", "ctide:delivery=", "ctide:panel=", "READY", "FIX REQUIRED", "NOT READY"]) {
      if (!compactFence.includes(tok))
        fail(`final-report.md compact template is missing the machine-contract literal "${tok}" (the default report must keep the sentinel footer + verdict literals)`);
    }
  }
}

// 5e. the `--report full` cost table must keep its billable-component columns (Input / Output /
// Cache-write / Cache-read) — AC2's contract. Mirrors 5d's fail-CLOSED pattern: bound to the
// `--report full` section so a compact-section table cannot mask a real deletion, and fail closed
// if the section structure moved. No machine consumer reads this table, but a silent revert to the
// old single-`Tokens` column is exactly the drift class 5d (compact fence) and the README-parity
// guard already protect against.
if (fs.existsSync(path.join(root, finalReportRel))) {
  const frFull = fs.readFileSync(path.join(root, finalReportRel), "utf8");
  const afterFull = frFull.split(/^##\s+`--report full`/m)[1];
  if (afterFull === undefined) {
    fail(`final-report.md: cannot locate the \`--report full\` section — the report structure changed; re-point the 5e cost-column guard`);
  } else {
    const header = afterFull.match(/\|\s*Agent \/ phase\s*\|([^\n]*)\|/);
    if (!header) {
      fail(`final-report.md: cannot locate the \`--report full\` Cost table header — re-point the 5e cost-column guard`);
    } else {
      for (const col of ["Input", "Output", "Cache-write", "Cache-read"]) {
        if (!header[1].includes(col))
          fail(`final-report.md \`--report full\` Cost table is missing the billable-component column "${col}" (the cost breakdown must itemize input/output/cache)`);
      }
    }
  }
}

// 5f. Contract-invariant guard — the machine-checked literals that SKILL.md's Language-And-Text-Integrity
// rule marks as verbatim / never-translate (the verdict, the severities, the sentinel tokens) must survive
// in the files that OWN them, so a prose edit can't silently gut the contract while every other gate stays
// green. Deliberately NARROW + high-confidence: only literals that are contractually immutable are
// asserted, so a legitimate reword can never false-trip this (pragmatism axiom — a false CI failure is
// worse than a documented miss). Complements 5d (which guards only the final-report compact fence) by
// covering the other contract-bearing files. Substring match is sufficient: these tokens are immutable, so
// presence anywhere in the owning file is the invariant.
const CONTRACT_INVARIANTS = {
  [`${PLUGIN}/agents/arbiter.agent.md`]: ["READY", "FIX REQUIRED", "NOT READY", "Extended-Safe", "Residual", "never auto-applied"],
  [`${PLUGIN}/skills/vigil/references/reviewer-common.md`]: ["blocker", "major", "minor"],
  [`${PLUGIN}/skills/vigil/references/reviewer-selection.md`]: ["intent-reviewer", "test-reviewer"],
  // The `### Live run` evidence-block header is tooling-read: orchestration-check.js (advisory 4) detects
  // a real verified run that omitted the block by matching this literal, so a prose rename would silently
  // make the "real run -> always log evidence" nudge go inert. Guard it like the other machine literals.
  [`${PLUGIN}/skills/vigil/references/final-report.md`]: ["### Live run"],
  [`${PLUGIN}/skills/vigil/SKILL.md`]: [
    "ctide:verify=", "ctide:delivery=", "ctide:panel=",
    "READY", "FIX REQUIRED", "NOT READY",
    "blocker", "major", "minor",
  ],
};
for (const [rel, phrases] of Object.entries(CONTRACT_INVARIANTS)) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) { fail(`contract-invariant guard: ${rel} is missing (cannot verify its machine-checked literals)`); continue; }
  const text = fs.readFileSync(abs, "utf8");
  for (const p of phrases) {
    if (!text.includes(p))
      fail(`contract-invariant guard: ${rel} no longer contains the machine-checked literal "${p}" — a prose edit dropped a load-bearing contract token (see SKILL.md Language-And-Text-Integrity)`);
  }
}

const hooksRel = `${PLUGIN}/hooks/hooks.json`;
if (fs.existsSync(path.join(root, hooksRel))) {
  const hooksText = fs.readFileSync(path.join(root, hooksRel), "utf8");
  const wiredHooks = new Set((hooksText.match(/hooks\/[a-z0-9-]+\.js/gi) || []));
  for (const m of wiredHooks) {
    if (!fs.existsSync(path.join(root, `${PLUGIN}/${m}`)))
      fail(`hooks.json references a missing hook: ${m}`);
  }
  // Prevention (a real lesson: a hook shipped without updating the docs): every wired
  // hook must be named in README.md so the docs can't silently fall out of sync.
  const readmePath = path.join(root, "README.md");
  if (fs.existsSync(readmePath)) {
    const readme = fs.readFileSync(readmePath, "utf8");
    for (const m of wiredHooks) {
      const base = m.replace(/^hooks\//, "").replace(/\.js$/, "");
      if (!readme.includes(base)) fail(`README.md does not mention the hook "${base}" (docs out of sync with hooks.json)`);
    }
  }

  // 5c. Hook WIRING — the auth-free stand-in for a live install->enable->reload activation smoke.
  // A regression that drops a hook from its event, or narrows a matcher so the hook no longer fires
  // for a tool/lifecycle it must cover, is still valid JSON (so the parse + node --check + behavioral
  // tests can all stay green) — assert the wiring structurally so such a regression fails the build.
  let hj = null;
  try { hj = JSON.parse(hooksText); } catch (e) { hj = null; } // a parse error is already reported by section 4
  if (hj) {
    const h = hj.hooks || {};
    const entriesFor = (event) => (Array.isArray(h[event]) ? h[event] : []);
    const cmdsFor = (event) => entriesFor(event).flatMap((e) => (Array.isArray(e.hooks) ? e.hooks : []).map((x) => (x && x.command) || ""));
    const wiresUnder = (event, hookFile) => cmdsFor(event).some((c) => c.includes("hooks/" + hookFile));
    // Matcher coverage must be bound to the entry that ACTUALLY wires the target hook, not satisfied by
    // some OTHER entry's matcher. Without this scoping, once a second entry (a different hook) with a
    // broad matcher exists, it could falsely "cover" a token the target hook's own entry omits — so a
    // real plan-gate matcher regression ("Write|Edit", dropping MultiEdit/NotebookEdit/Bash) could pass
    // green. Filtering to entries whose command wires `hookFile` is strictly more restrictive.
    const eventMatchesForHook = (event, token, hookFile) => entriesFor(event).some((e) => {
      const wiresIt = (Array.isArray(e.hooks) ? e.hooks : []).some((x) => x && typeof x.command === "string" && x.command.includes("hooks/" + hookFile));
      if (!wiresIt) return false;
      try { return new RegExp("^(?:" + (e.matcher || "") + ")$").test(token); } catch (err) { return false; }
    });
    const WIRING = [
      { event: "PreToolUse", hook: "plan-gate.js", tokens: ["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "PowerShell"] },
      { event: "PreToolUse", hook: "destructive-guard.js", tokens: ["Bash", "PowerShell"] }, // all-modes destructive-command safety net
      { event: "PreToolUse", hook: "contract-guard.js", tokens: ["Write", "Edit", "MultiEdit"] }, // content-based contract/design.md weakening tripwire
      { event: "SessionStart", hook: "load-failure-memory.js", tokens: ["startup", "resume", "clear", "compact"] },
      { event: "Stop", hook: "orchestration-check.js", tokens: [] }, // Stop has no matcher
      { event: "SessionStart", hook: "compact-fidelity.js", tokens: ["compact"] }, // post-compaction fidelity nudge (relocated from PreCompact: CC rejects hookSpecificOutput there)
    ];
    for (const w of WIRING) {
      if (!wiresUnder(w.event, w.hook)) fail(`hooks.json: ${w.event} does not wire ${w.hook} (hook would never fire)`);
      for (const t of w.tokens) {
        if (!eventMatchesForHook(w.event, t, w.hook)) fail(`hooks.json: the ${w.event} matcher does not cover "${t}" (the hook would never fire for it)`);
      }
    }

    // 5g. Claude Code OUTPUT-CONTRACT conformance — the external boundary that broke once. CC's hook-output
    // validator only accepts `hookSpecificOutput` on a fixed set of events; emitting it on any other event is
    // SILENTLY REJECTED. Therefore any hook whose SOURCE emits
    // `hookSpecificOutput` must be wired ONLY to events in CC's accept-set. Unlike 5c (which checks ctide's
    // OWN wiring) this checks conformance to CC's external, evolving contract. If CC's documented hook-output
    // contract changes, update HSO_ACCEPT_EVENTS and re-smoke per RELEASING.md.
    const HSO_ACCEPT_EVENTS = new Set(["PreToolUse", "UserPromptSubmit", "PostToolUse", "PostToolBatch", "SessionStart", "Stop", "SubagentStop"]);
    for (const event of Object.keys(h)) {
      for (const cmd of cmdsFor(event)) {
        const m = cmd.match(/hooks\/([a-z0-9-]+\.js)/i);
        if (!m) continue;
        const src = path.join(root, `${PLUGIN}/hooks/${m[1]}`);
        if (!fs.existsSync(src)) continue; // a missing hook is already reported above
        if (fs.readFileSync(src, "utf8").includes("hookSpecificOutput") && !HSO_ACCEPT_EVENTS.has(event)) {
          fail(`hooks.json: ${m[1]} emits \`hookSpecificOutput\` but is wired to "${event}", which Claude Code's hook-output schema does NOT accept it on — it would be silently rejected (the compact-fidelity/PreCompact bug class). CC accepts hookSpecificOutput only on: ${[...HSO_ACCEPT_EVENTS].join(", ")}.`);
        }
      }
    }
  }
}

// 5h. Release asset contract: release archives/checksums must be tag-bound and repairable.
// This is a lightweight static guard for the release workflow because the actual GitHub Release
// asset behavior can only be exercised during a real release.
const validationWorkflowRel = ".github/workflows/validate.yml";
const validationWorkflowPath = path.join(root, validationWorkflowRel);
if (!fs.existsSync(validationWorkflowPath)) fail(`${validationWorkflowRel}: missing validation workflow`);
const releaseWorkflowRel = ".github/workflows/release.yml";
const releaseWorkflowPath = path.join(root, releaseWorkflowRel);
if (!fs.existsSync(releaseWorkflowPath)) fail(`${releaseWorkflowRel}: missing release workflow`);
const releaseScriptRel = ".github/scripts/publish-release.mjs";
const releaseScriptPath = path.join(root, releaseScriptRel);
if (!fs.existsSync(releaseScriptPath)) fail(`${releaseScriptRel}: missing release publisher script`);
if (pkg && pkg.scripts?.["release:publish"] !== `node ${releaseScriptRel} --publish`) {
  fail(`package.json: release:publish must delegate to ${releaseScriptRel} --publish`);
}
const workflowKeyPattern = (indent, key) => {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^ {${indent}}(?:${escaped}|"${escaped}"|'${escaped}')\\s*:`);
};
const workflowMappingLines = (block, indent, key) => {
  const starts = block
    .map((line, index) => workflowKeyPattern(indent, key).test(line) ? index : -1)
    .filter((index) => index !== -1);
  if (starts.length !== 1) return [];
  const start = starts[0];
  const end = block.findIndex((line, index) => {
    if (index <= start || /^\s*(?:#.*)?$/.test(line)) return false;
    return (line.match(/^ */)?.[0].length || 0) <= indent;
  });
  return block.slice(start, end === -1 ? block.length : end);
};
const workflowJobLines = (workflow, jobName) => {
  const lines = workflow.replace(/\r\n/g, "\n").split("\n");
  const jobsLines = workflowMappingLines(lines, 0, "jobs");
  return workflowMappingLines(jobsLines, 2, jobName);
};
const workflowNamedStepLines = (jobLines, stepName) => {
  const starts = jobLines
    .map((line, index) => line === `      - name: ${stepName}` ? index : -1)
    .filter((index) => index !== -1);
  if (starts.length !== 1) return [];
  const start = starts[0];
  const end = jobLines.findIndex((line, index) => index > start && /^      - /.test(line));
  return jobLines.slice(start, end === -1 ? jobLines.length : end);
};
const hasWorkflowBypass = (block, indent) => block.some((line) =>
  workflowKeyPattern(indent, "if").test(line)
  || workflowKeyPattern(indent, "continue-on-error").test(line));
const hasWorkflowRunContextOverride = (workflow, jobLines, stepLines) => {
  const workflowLines = workflow.replace(/\r\n/g, "\n").split("\n");
  const workflowDefaults = workflowMappingLines(workflowLines, 0, "defaults");
  const workflowRunDefaults = workflowMappingLines(workflowDefaults, 2, "run");
  const jobDefaults = workflowMappingLines(jobLines, 4, "defaults");
  const jobRunDefaults = workflowMappingLines(jobDefaults, 6, "run");
  const hasOverride = (block, indent) => block.some((line) =>
    workflowKeyPattern(indent, "shell").test(line)
    || workflowKeyPattern(indent, "working-directory").test(line));
  return hasOverride(workflowRunDefaults, 4)
    || hasOverride(jobRunDefaults, 8)
    || hasOverride(stepLines, 8);
};
const hasExactWorkflowRun = (stepLines, exactRun) => {
  const runLines = stepLines.filter((line) => workflowKeyPattern(8, "run").test(line));
  return runLines.length === 1 && runLines[0] === exactRun;
};
if (fs.existsSync(validationWorkflowPath) && fs.existsSync(releaseScriptPath)) {
  const workflow = fs.readFileSync(validationWorkflowPath, "utf8");
  const validationJob = workflowJobLines(workflow, "validate");
  const syntaxStep = workflowNamedStepLines(validationJob, "Syntax-check release publisher");
  const exactRun = `        run: node --check ${releaseScriptRel}`;
  if (validationJob.length === 0 || syntaxStep.length === 0
      || hasWorkflowBypass(validationJob, 4) || hasWorkflowBypass(syntaxStep, 8)
      || hasWorkflowRunContextOverride(workflow, validationJob, syntaxStep)
      || !hasExactWorkflowRun(syntaxStep, exactRun)) {
    fail(`${validationWorkflowRel}: validation job must syntax-check ${releaseScriptRel}`);
  }
}
if (fs.existsSync(releaseWorkflowPath) && fs.existsSync(releaseScriptPath)) {
  const workflow = fs.readFileSync(releaseWorkflowPath, "utf8");
  const publishLines = workflowJobLines(workflow, "publish");
  const stepLines = workflowNamedStepLines(publishLines, "Publish or verify immutable release assets");
  const exactRun = '        run: npm run release:publish -- --tag "$RELEASE_TAG"';
  if (publishLines.length === 0 || stepLines.length === 0 || hasWorkflowBypass(publishLines, 4)
      || hasWorkflowBypass(stepLines, 8) || hasWorkflowRunContextOverride(workflow, publishLines, stepLines)
      || !hasExactWorkflowRun(stepLines, exactRun)) {
    fail(`${releaseWorkflowRel}: publish job must call package.json release:publish with the explicit release tag`);
  }
}

// 5i. Example provenance contract: clean-room examples are illustrative only and must never look like
// historical or Type-B evidence.
const exampleProvenance = [
  ["examples/ready-run.md", ["Source: illustrative Cressetide workflow example.", "not counted as evidence"]],
  ["examples/fix-required-run.md", ["Source: illustrative Cressetide repair-loop example.", "not counted as evidence"]],
  ["examples/not-ready-run.md", ["Source: illustrative Cressetide example.", "not counted as evidence"]],
  ["examples/review-packet.md", ["Source: illustrative Cressetide contract-field example.", "not a historical run", "not evidence"]],
  ["examples/final-report-compact.md", ["Source: illustrative Cressetide report shape.", "Values in angle brackets must be replaced"]],
  ["examples/final-report-full.md", ["Source: illustrative Cressetide report shape.", "not a historical run or evidence record"]],
];
for (const [rel, snippets] of exampleProvenance) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) fail(`${rel}: missing example file`);
  const text = fs.readFileSync(full, "utf8");
  for (const snippet of snippets) {
    if (!text.includes(snippet)) fail(`${rel}: missing required provenance marker "${snippet}"`);
  }
}

// 5j. Contract / packet template field guard — the contract.md schema (references/task-contract.md)
// and the Review Packet handoff template (references/review-packet.md) must keep the fields the
// runtime contract-check.mjs and the reviewers depend on, so a prose edit can't silently gut the
// deterministic inputs while CI stays green. Narrow, high-confidence, fail-CLOSED (mirrors 5d/5e/5f).
const taskContractRel = `${PLUGIN}/skills/vigil/references/task-contract.md`;
if (!fs.existsSync(path.join(root, taskContractRel))) {
  fail(`missing reference: ${PLUGIN}/skills/vigil/references/task-contract.md (contract schema doc)`);
} else {
  const tc = fs.readFileSync(path.join(root, taskContractRel), "utf8");
  for (const field of ["acceptanceCriteria", "allowedPaths", "forbiddenPaths", "behaviorChanging", "verification"]) {
    if (!tc.includes(field))
      fail(`task-contract.md no longer documents the machine field "${field}" (contract-check.mjs reads it)`);
  }
}
const packetRel = `${PLUGIN}/skills/vigil/references/review-packet.md`;
if (fs.existsSync(path.join(root, packetRel))) {
  const pk = fs.readFileSync(path.join(root, packetRel), "utf8");
  for (const field of ["Acceptance criteria", "Out of scope", "Verification evidence", "Must-not-change", "Migration status"]) {
    if (!pk.includes(field))
      fail(`review-packet.md template is missing the required field "${field}"`);
  }
}

// 5k. Rigor-contract dual-write guard — the claims-evidence discipline (admission rule, evidence
// grading, self-refutation, severity-rubric anchoring, two-channel output) lives in BOTH
// references/reviewer-common.md (the source of truth) and the review-packet.md "Shared reviewer
// contract" verbatim block (the ONLY copy a spawned reviewer ever receives — review-packet.md's sync
// mandate). A drift that drops one side silently guts the contract for every reviewer while CI stays
// green. Narrow literal-presence anchors only, no wording constraints — same philosophy as 5f/5j.
// ("as the fixed reference" pins the severity-rubric rule (C3), added after it drifted into one file.)
// The last four anchors protect packet-block synchronization after a prior one-sided drift: the
// Non-mutating rule, the underspecified clause, and the blocker/minor severity definitions each
// silently dropped out of ONE side once). Curated substrings, not a full hash — the two files are
// different formats by design (canonical prose vs the verbatim handoff block).
const RIGOR_ANCHORS = [
  "Admission to the findings index", "Evidence grading", "refute your strongest finding", "as the fixed reference", /[Tt]wo channels/,
  "Non-mutating: inspect, don't change",
  "materially underspecified",
  "clearly incorrect, materially unsafe", // the `blocker` definition
  "should be fixed before the work is considered ready", // the `major` definition
  "worthwhile cleanup or polish",         // the `minor` definition
];
for (const rel of [
  `${PLUGIN}/skills/vigil/references/reviewer-common.md`,
  `${PLUGIN}/skills/vigil/references/review-packet.md`,
]) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) { fail(`rigor-contract guard: ${rel} is missing (cannot verify the claims-evidence anchors)`); continue; }
  const text = fs.readFileSync(abs, "utf8");
  for (const anchor of RIGOR_ANCHORS) {
    const ok = anchor instanceof RegExp ? anchor.test(text) : text.includes(anchor);
    if (!ok)
      fail(`rigor-contract guard: ${rel} no longer contains the anchor ${anchor instanceof RegExp ? String(anchor) : `"${anchor}"`} — the reviewer-common ↔ review-packet dual write drifted (the verbatim block is the only copy reviewers receive)`);
  }
}

// 6. distribution hygiene: runtime/process artifacts must never ship in the
// plugin subdir, and scratch/temp files must not be committed anywhere.
const forbidden = [
  "ai/FAILURE_MEMORY.md",        // workflow runtime output — belongs in the consuming project, not here
  `${PLUGIN}/ai`,
  `${PLUGIN}/test`,
  `${PLUGIN}/.github`,
  `${PLUGIN}/node_modules`,
  `${PLUGIN}/package.json`,
];
for (const rel of forbidden) {
  if (fs.existsSync(path.join(root, rel))) fail(`distribution hygiene: "${rel}" must not exist (runtime/dev artifact in the shipped tree)`);
}

// 6b. .ctide/ hygiene — the consuming-project runtime root (memory/design/map/incidents/output).
// For THIS tool repo it is dogfood-run residue, exactly like the root ai/FAILURE_MEMORY.md stance above:
// (a) the repo .gitignore must carry a literal `/.ctide/` line so run output can never be committed by
// accident; (b) when git is available, no path under .ctide/ may already be tracked. A git spawn
// failure (git absent, or the tree under validation is not a git work tree — e.g. the test suite's temp
// copies) skips (b) silently; the .gitignore-line check still applies everywhere.
{
  const gitignorePath = path.join(root, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    fail(`.ctide hygiene: .gitignore is missing — it must contain a "/.ctide/" line so the consuming-project runtime root is never committed into this repo`);
  } else if (!fs.readFileSync(gitignorePath, "utf8").split(/\r?\n/).some((l) => l.trim() === "/.ctide/")) {
    fail(`.ctide hygiene: .gitignore has no "/.ctide/" line — add it so ctide's own run output (.ctide/) is never committed into this repo`);
  }
  try {
    const r = cp.spawnSync("git", ["ls-files", "--", ".ctide"], { cwd: root, encoding: "utf8" });
    if (r && r.status === 0 && typeof r.stdout === "string") {
      const tracked = r.stdout.split(/\r?\n/).filter(Boolean);
      if (tracked.length) fail(`.ctide hygiene: tracked path(s) under .ctide/ must not be committed (git rm --cached them): ${tracked.join(", ")}`);
    }
  } catch (e) {} // other throw paths only — git ABSENCE does not throw (spawnSync returns {error, status:null}, which the status guard above already skips)
}
function scanScratch(dir) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "node_modules") continue;
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) scanScratch(rel);
    else if (/^_|\.(tmp|bak|log)$|~$/.test(e.name)) fail(`scratch/process file should not be committed: ${rel}`);
  }
}
scanScratch(".");

// 7. text integrity: no replacement characters or known mojibake markers in tracked text.
const TEXT_EXT = /\.(md|json|mjs|js|ya?ml)$/i;
const MOJIBAKE_MARKERS = [
  0xFFFD, // replacement character
  0x7AB6,
  0x7ACA,
  0x5689,
  0x90E2,
  0x90B5,
  0x8B41,
  0xFF82, // halfwidth katakana often produced by UTF-8/CP932 mojibake
  0xFF77,
  0xFF9E,
  0xFF80,
];
function scanTextIntegrity(dir) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "node_modules") continue;
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) scanTextIntegrity(rel);
    else if (TEXT_EXT.test(e.name)) {
      const text = fs.readFileSync(path.join(root, rel), "utf8");
      for (const codePoint of MOJIBAKE_MARKERS) {
        const marker = String.fromCodePoint(codePoint);
        if (text.includes(marker)) {
          fail(`text integrity: ${rel} contains suspicious mojibake marker U+${codePoint.toString(16).toUpperCase()}`);
          break;
        }
      }
    }
  }
}
scanTextIntegrity(".");

// 8. multilingual README parity: every translated README must name every wired hook (like README.md)
// and have the same number of top-level (## ) sections — a structural-drift guard that does not
// compare translated prose. Covers every translation in TRANSLATED_READMES, not just one language,
// so adding a new translation can't silently skip the guard the original bilingual pair had.
const enReadme = path.join(root, "README.md");
const TRANSLATED_READMES = ["README.zh-TW.md", "README.ja.md"];
if (fs.existsSync(enReadme)) {
  const en = fs.readFileSync(enReadme, "utf8");
  // Count top-level (## ) sections, ignoring any inside fenced code blocks so the structural guard is
  // not tripped by a Markdown/shell sample that happens to contain a "## " line.
  const sectionCount = (s) => (s.replace(/```[\s\S]*?```/g, "").match(/^##\s+/gm) || []).length;
  const enSections = sectionCount(en);
  const requiredReadmeLinks = [
    "docs/tutorial-first-run.md",
    "docs/task-writing-guide.md",
    "docs/how-to-read-verdicts.md",
    "docs/compatibility.md",
    "examples/ready-run.md",
    "examples/fix-required-run.md",
    "examples/not-ready-run.md",
    "examples/review-packet.md",
    "examples/final-report-compact.md",
    "examples/final-report-full.md",
    "EVIDENCE.md",
    "SECURITY.md",
    "RELEASING.md",
    "template=verified-run.yml",
  ];
  for (const link of requiredReadmeLinks) {
    if (!en.includes(link)) fail(`README parity: README.md missing required entry link "${link}"`);
  }
  const hjPath = path.join(root, `${PLUGIN}/hooks/hooks.json`);
  const wiredHookBases = fs.existsSync(hjPath)
    ? [...new Set((fs.readFileSync(hjPath, "utf8").match(/hooks\/[a-z0-9-]+\.js/gi) || []))].map((m) => m.replace(/^hooks\//, "").replace(/\.js$/, ""))
    : [];
  for (const rel of TRANSLATED_READMES) {
    const full = path.join(root, rel);
    if (!fs.existsSync(full)) {
      fail(`README parity: README.md exists but ${rel} is missing (a translated README must not drift by deletion)`);
      continue;
    }
    const translated = fs.readFileSync(full, "utf8");
    if (sectionCount(translated) !== enSections) {
      fail(`README parity: README.md has ${enSections} top-level (##) sections but ${rel} has ${sectionCount(translated)}`);
    }
    for (const link of requiredReadmeLinks) {
      if (!translated.includes(link)) fail(`README parity: ${rel} missing required entry link "${link}"`);
    }
    for (const base of wiredHookBases) {
      if (!translated.includes(base)) fail(`README parity: ${rel} does not mention the hook "${base}" (docs out of sync)`);
    }
  }
}

// 9. "Garden" guards — dead weight + copy-sync (shape borrowed from wshobson/agents `make garden`).
// Deterministic only, no fuzzy matching. Every failure names the fix, and every cap/anchor has an
// obvious conscious-override path: edit the constant/list HERE with a justifying comment. The hooks
// deliberately keep per-hook COPIES of shared infra for per-hook failure isolation, each stamped
// "kept in sync … (documented copy — see garden hash guard)";
// 9d is that promised guard. The packet-block half of the copy-sync mandate (d3) lives in §5k's
// RIGOR_ANCHORS above (same two files, same mechanism — extended rather than duplicated).

// 9a. Reference reachability: every shipped references/*.md must be named in SKILL.md (the Reference
// Loading list) — an orphan reference is dead weight the workflow can never load.
{
  const refDirRel = `${PLUGIN}/skills/vigil/references`;
  const refDirAbs = path.join(root, refDirRel);
  const skillAbs = path.join(root, skillRel);
  if (fs.existsSync(refDirAbs) && fs.existsSync(skillAbs)) {
    const skillText = fs.readFileSync(skillAbs, "utf8");
    for (const name of fs.readdirSync(refDirAbs)) {
      if (!name.endsWith(".md")) continue;
      if (!skillText.includes(name))
        fail(`garden 9a: ${refDirRel}/${name} is not mentioned by filename in SKILL.md — an orphan reference the workflow can never load; add it to SKILL.md's Reference Loading list or delete the file`);
    }
  }
}

// 9b. Agent parity, both directions: every plugin.json agents[] entry exists on disk, and every
// agents/*.agent.md on disk is listed in plugin.json (Claude Code loads agents via the manifest
// array, so an unlisted agent silently never loads). §5b covers only the SKILL.md prose roster;
// this holds regardless of the roster sentence.
if (plugin && Array.isArray(plugin.agents)) {
  for (const entry of plugin.agents) {
    const relPath = String(entry).replace(/^\.\//, "");
    if (!fs.existsSync(path.join(root, PLUGIN, relPath)))
      fail(`garden 9b: plugin.json agents[] lists "${entry}" but ${PLUGIN}/${relPath} does not exist on disk — restore the file or remove the manifest entry`);
  }
  const agentsDirAbs = path.join(root, `${PLUGIN}/agents`);
  if (fs.existsSync(agentsDirAbs)) {
    for (const name of fs.readdirSync(agentsDirAbs)) {
      if (!name.endsWith(".agent.md")) continue;
      if (!plugin.agents.some((p) => String(p).replace(/^\.\//, "") === `agents/${name}`))
        fail(`garden 9b: ${PLUGIN}/agents/${name} exists on disk but is not listed in plugin.json agents[] — it would silently never load; add "./agents/${name}" to the manifest or delete the file`);
    }
  }
}

// 9c. Size caps with headroom. These two files dominate always-loaded prompt cost;
// the caps leave headroom so ordinary edits do not trip. Raising a cap is allowed —
// but must be a CONSCIOUS decision made here with a justifying comment, not accretion.
{
  const SIZE_CAPS = [
    [`${PLUGIN}/skills/vigil/SKILL.md`, 30000],
    [`${PLUGIN}/agents/arbiter.agent.md`, 27000],
  ];
  for (const [rel, cap] of SIZE_CAPS) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue; // a missing file is reported by earlier sections
    const size = fs.statSync(abs).size;
    if (size > cap)
      fail(`garden 9c: ${rel} is ${size} bytes and grew past the agreed cap (${cap}); either shrink it or consciously raise the cap in validate-structure with a justifying comment`);
  }
}

// 9d. Copy-sync guards for the documented per-hook infra copies (deterministic string/regex
// extraction only). Each check fails CLOSED when it cannot locate what it guards, so a refactor
// cannot silently disarm it — the message then says to re-point the guard.
{
  const hookRel = (name) => `${PLUGIN}/hooks/${name}`;
  const readHook = (rel) => fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");

  // d1. dd-of= regex identity: plan-gate.js and destructive-guard.js each carry
  // the dd write-detection pattern with a "kept character-identical / reused verbatim" comment — make
  // that an enforced invariant. Extract the regex literal from the line containing `dd\s(?=` and
  // require strict equality (surrounding whitespace/comment are excluded by the extraction).
  const extractDdRegex = (rel) => {
    const line = readHook(rel).split("\n").find((l) => l.includes("dd\\s(?="));
    if (!line) return null;
    const m = line.match(/\/\(\?:.*?\/i(?=[\s,)\]]|$)/); // the literal: first `/(?:` through its `/i` flags
    return m ? m[0] : null;
  };
  const ddPair = [hookRel("plan-gate.js"), hookRel("destructive-guard.js")];
  if (ddPair.every((rel) => fs.existsSync(path.join(root, rel)))) {
    const [ddGate, ddGuard] = ddPair.map(extractDdRegex);
    if (!ddGate || !ddGuard) {
      fail(`garden 9d: cannot locate the dd-of= regex literal (the line containing "dd\\s(?=") in ${ddPair.join(" / ")} — the pattern moved; re-point the 9d dd-identity guard`);
    } else if (ddGate !== ddGuard) {
      fail(`garden 9d: the dd-of= regex drifted between plan-gate.js and destructive-guard.js (plan-gate: ${ddGate} vs destructive-guard: ${ddGuard}) — the two are documented character-identical copies; change BOTH together`);
    }
  }

  // d2. Byte-identical function copies: debug() (all six hooks) and neutralize() (two hooks).
  // Extraction: the `function <name>(` line through the closing `}` at column 0; line endings
  // normalized; the hook's OWN basename inside its log labels is normalized to "<hook>" (each
  // debug() copy legitimately embeds its own name — the only sanctioned difference).
  const extractFn = (rel, fnName) => {
    const lines = readHook(rel).split("\n");
    const start = lines.findIndex((l) => l.startsWith(`function ${fnName}(`));
    if (start === -1) return null;
    for (let i = start + 1; i < lines.length; i++) {
      if (lines[i] === "}") return lines.slice(start, i + 1).join("\n").split(path.basename(rel, ".js")).join("<hook>");
    }
    return null;
  };
  const FN_CLUSTERS = [
    ["debug", ["plan-gate.js", "destructive-guard.js", "contract-guard.js", "load-failure-memory.js", "compact-fidelity.js", "orchestration-check.js"]],
    ["neutralize", ["load-failure-memory.js", "compact-fidelity.js"]],
  ];
  for (const [fnName, files] of FN_CLUSTERS) {
    const present = files.map((f) => hookRel(f)).filter((rel) => fs.existsSync(path.join(root, rel)));
    const bodies = present.map((rel) => [rel, extractFn(rel, fnName)]);
    for (const [rel, body] of bodies) {
      if (body === null) fail(`garden 9d: cannot extract function ${fnName}() from ${rel} — the function moved or lost its column-0 shape; re-point the 9d copy guard`);
    }
    const found = bodies.filter(([, b]) => b !== null);
    for (let i = 1; i < found.length; i++) {
      if (found[i][1] !== found[0][1])
        fail(`garden 9d: ${fnName}() drifted between ${found[0][0]} and ${found[i][0]} — these are documented byte-identical copies (modulo each hook's own log label); change ALL copies together`);
    }
  }

  // d2 (cont.) Quote-stripper regex line pair: plan-gate.js / destructive-guard.js each strip quoted
  // spans with the same one-line regex before pattern matching ("kept in sync" documented copy).
  const quotePair = [hookRel("plan-gate.js"), hookRel("destructive-guard.js")];
  if (quotePair.every((rel) => fs.existsSync(path.join(root, rel)))) {
    const quoteLines = quotePair.map((rel) => {
      const line = readHook(rel).split("\n").find((l) => l.includes("const unquoted ="));
      return line ? line.trim() : null;
    });
    if (quoteLines.some((l) => l === null)) {
      fail(`garden 9d: cannot locate the quote-stripper line ("const unquoted =") in ${quotePair.join(" / ")} — it moved; re-point the 9d quote-stripper guard`);
    } else if (quoteLines[0] !== quoteLines[1]) {
      fail(`garden 9d: the quote-stripper line drifted between plan-gate.js and destructive-guard.js ("${quoteLines[0]}" vs "${quoteLines[1]}") — a documented identical copy; change BOTH together`);
    }
  }

  // d2 (cont.) Settings-flag readers: the four opt-out readers legitimately DIFFER by settings key
  // (planGate / destructiveGuard / contractGuard / preserveOnCompact), so no body comparison — assert
  // each still carries the shared precedence marker comment, which pins the documented
  // local-over-project / explicit-true-wins precedence contract to its siblings.
  const SETTINGS_MARKER = "settings-flag reader (DisabledForProject + readFlag pair) kept in sync with";
  for (const f of ["plan-gate.js", "destructive-guard.js", "contract-guard.js", "compact-fidelity.js"]) {
    const rel = hookRel(f);
    if (!fs.existsSync(path.join(root, rel))) continue; // missing hooks are reported by §5c wiring
    if (!readHook(rel).includes(SETTINGS_MARKER))
      fail(`garden 9d: ${rel} lost the settings-flag reader sync marker ("${SETTINGS_MARKER} …") — keep the precedence comment naming the sibling copies (or update this guard if the cluster was consciously dissolved)`);
  }

  // d2 (cont.) Stdin readers ×6: the read-loop bodies legitimately diverge (per-hook payload
  // handling), so like the settings-flag cluster this is a marker-presence guard, not a body
  // hash — each hook must keep its stdin-reader sync stamp (incl. the MAX_STDIN cap discipline
  // the stamp documents). The marker-presence guard keeps those stamps enforceable.
  const STDIN_MARKER = "stdin reader kept in sync with";
  for (const f of ["plan-gate.js", "destructive-guard.js", "contract-guard.js", "load-failure-memory.js", "compact-fidelity.js", "orchestration-check.js"]) {
    const rel = hookRel(f);
    if (!fs.existsSync(path.join(root, rel))) continue; // missing hooks are reported by §5c wiring
    if (!readHook(rel).includes(STDIN_MARKER))
      fail(`garden 9d: ${rel} lost the stdin-reader sync marker ("${STDIN_MARKER} …") — keep the stamp naming the sibling copies and the MAX_STDIN cap (or update this guard if the cluster was consciously dissolved)`);
  }
}

// 9e. ${CLAUDE_PLUGIN_ROOT} lint: an installed plugin's scripts do NOT live under the consuming
// project's cwd, so a shipped doc instructing `node skills/vigil/scripts/…` (bare,
// without the ${CLAUDE_PLUGIN_ROOT}/ prefix) breaks at runtime in every consuming repo. Narrow by
// design: only the `node <path>` invocation form is flagged, so prose
// mentions of script paths never false-trip.
{
  const badInvocation = /node\s+(?:\.\/)?skills\/vigil\/scripts\//;
  walk(PLUGIN, (rel) => {
    if (!rel.endsWith(".md")) return;
    const lines = fs.readFileSync(path.join(root, rel), "utf8").split(/\r?\n/);
    lines.forEach((ln, i) => {
      if (badInvocation.test(ln))
        fail(`garden 9e: ${rel}:${i + 1} invokes a plugin script without the plugin root — write "node \${CLAUDE_PLUGIN_ROOT}/skills/vigil/scripts/…" so the command resolves in a consuming repo`);
    });
  });
}

// 9f. Trust-marker enumeration parity — the Map operational-readiness trust marker is a 3-tier
//     set (verified / dry-run-verified / UNVERIFIED). Every current-facing FULL
//     enumeration must list all three, else a future edit silently drops a tier (enumerated-member
//     drift — the risk §9d/FAILURE_MEMORY name). It is explicitly site-anchored rather than a blanket
//     regex so intentionally partial examples cannot false-trip the guard.
const TRUST_TOP = /(?<!dry-run-)verified: <date>/; // standalone top tier, not the dry-run-verified substring
const TRUST_MARKER_SITES = [
  { rel: `${PLUGIN}/skills/map/references/operational-readiness.md`, anchor: "carries a trust marker" },
  { rel: `${PLUGIN}/skills/map/references/operational-readiness.md`, anchor: "Exact steps: <commands, in order>" },
  { rel: `${PLUGIN}/skills/map/references/operational-readiness.md`, anchor: "how to flip it" },
  { rel: "README.md", anchor: "carries a trust marker" },
  { rel: "README.zh-TW.md", anchor: "帶信任標記" },
  { rel: "README.ja.md", anchor: "信頼マーカー" },
];
for (const { rel, anchor } of TRUST_MARKER_SITES) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) { fail(`garden 9f: ${rel} missing — trust-marker enumeration site (update TRUST_MARKER_SITES if it moved)`); continue; }
  const matched = fs.readFileSync(abs, "utf8").replace(/\r\n/g, "\n").split("\n").filter((l) => l.includes(anchor));
  if (matched.length !== 1) { fail(`garden 9f: ${rel} — trust-marker anchor "${anchor}" matched ${matched.length} line(s), expected 1; the enumeration moved or the anchor drifted — update TRUST_MARKER_SITES`); continue; }
  const line = matched[0];
  const missing = [];
  if (!TRUST_TOP.test(line)) missing.push("verified: <date>");
  if (!line.includes("dry-run-verified: <date>")) missing.push("dry-run-verified: <date>");
  if (!line.includes("UNVERIFIED")) missing.push("UNVERIFIED");
  if (missing.length) fail(`garden 9f: ${rel} trust-marker enumeration ("${anchor}") is missing tier(s): ${missing.join(", ")} — the 3-tier set (verified: <date> / dry-run-verified: <date> / UNVERIFIED) must stay in sync across all ${TRUST_MARKER_SITES.length} sites (or update TRUST_MARKER_SITES if the enumeration was consciously changed)`);
}

if (errors.length) {
  console.error("Plugin structure validation FAILED:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log("Plugin structure validation passed.");
