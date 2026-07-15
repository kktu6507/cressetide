// Claude Code roster-preservation oracle for explicit agent manifest wiring.
// The agent files were renamed `<name>.md` -> `<name>.agent.md` and explicitly wired via the
// plugin.json `agents` array (so the panel loads under Copilot CLI as well as Claude Code). The
// HARD constraint is that Claude Code's roster is functionally identical: identity is the
// frontmatter `name:`, and exactly the expected roster must load. These tests lock that in:
//   (i)   the manifest `agents[]` set == the *.agent.md files on disk (no extras, none missing),
//   (ii)  every *.agent.md has valid YAML frontmatter with a `name:`,
//   (iii) the set of frontmatter names is EXACTLY the expected roster (order-independent) — a guard
//         that the roster Claude Code sees did not change under the rename.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN = path.join(root, "cressetide");
const AGENTS_DIR = path.join(PLUGIN, "agents");

const plugin = JSON.parse(fs.readFileSync(path.join(PLUGIN, ".claude-plugin", "plugin.json"), "utf8"));

const EXPECTED_NAMES = [
  "navigator",
  "implementer",
  "intent-reviewer",
  "test-reviewer",
  "code-reviewer",
  "security-reviewer",
  "architecture-reviewer",
  "operability-reviewer",
  "ui-ux-reviewer",
  "arbiter",
  "cartographer",
];

// Parse the YAML frontmatter `name:` from an agent file (same shape the validator/Claude expect).
function frontmatterName(text) {
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return null;
  const fm = text.slice(3, end);
  const m = fm.match(/^\s*name\s*:\s*(.+?)\s*$/m);
  return m ? m[1].replace(/^["']|["']$/g, "") : null;
}

const diskAgentFiles = fs.readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".agent.md"));

test("(i) plugin.json agents[] basenames == the *.agent.md files on disk", () => {
  assert.ok(Array.isArray(plugin.agents), "plugin.json must declare an agents[] array");
  const manifestSet = new Set(plugin.agents.map((p) => path.basename(p)));
  const diskSet = new Set(diskAgentFiles);
  assert.deepStrictEqual(
    [...manifestSet].sort(),
    [...diskSet].sort(),
    "the manifest agents[] set must equal the *.agent.md files on disk (no extras, none missing)"
  );
});

test("(ii) every *.agent.md has valid frontmatter with a name:", () => {
  assert.ok(diskAgentFiles.length > 0, "expected at least one *.agent.md file");
  for (const f of diskAgentFiles) {
    const name = frontmatterName(fs.readFileSync(path.join(AGENTS_DIR, f), "utf8"));
    assert.ok(name, `${f}: frontmatter must contain a name:`);
  }
});

test("(iii) the frontmatter name set is EXACTLY the expected roster (roster unchanged)", () => {
  const names = diskAgentFiles.map((f) => frontmatterName(fs.readFileSync(path.join(AGENTS_DIR, f), "utf8")));
  assert.deepStrictEqual(
    [...new Set(names)].sort(),
    [...EXPECTED_NAMES].sort(),
    "the set of agent frontmatter names must exactly equal the expected roster"
  );
});

// (iv) No two agents may share a frontmatter `name:`. Claude Code loads agents BY name, so a
// duplicate would silently shadow one of them (last-wins) and change the observable roster — the
// exact invariant the rename must preserve. The set-equality in (iii) alone does not catch this
// once a surplus (10th) agent exists, so guard it directly.
test("(iv) no two agents share a frontmatter name (no silent shadowing)", () => {
  const names = diskAgentFiles.map((f) => frontmatterName(fs.readFileSync(path.join(AGENTS_DIR, f), "utf8")));
  assert.strictEqual(names.length, new Set(names).size, "duplicate agent frontmatter name(s) found: " + names.sort().join(", "));
});

// (v) Every plugin.json agents[] path must resolve to an existing file — a wrong directory with a
// correct basename would pass (i) (basename set still equal) yet fail to load.
test("(v) every plugin.json agents[] path resolves to a file on disk", () => {
  assert.ok(Array.isArray(plugin.agents), "plugin.json must declare an agents[] array");
  for (const p of plugin.agents) {
    assert.ok(fs.existsSync(path.join(PLUGIN, p)), `plugin.json agents[] path does not resolve: ${p}`);
  }
});

// (vi) plugin.json must declare NO `hooks` field. `hooks` is additive-to-default in Claude Code, so
// an explicit `hooks` path would DOUBLE-LOAD the hooks (plan-gate firing twice) — a change to Claude
// Code's observable behavior. Split from the `skills` guard so each is independently falsifiable.
test("(vi) plugin.json declares no hooks field (would double-load the hooks in Claude Code)", () => {
  assert.ok(!("hooks" in plugin), "plugin.json must not declare a `hooks` field (would double-load the hooks in Claude Code)");
});

// (vi-b) plugin.json must declare NO `skills` field — skills load via the default skills/<name>/SKILL.md
// layout (which Copilot also discovers); an explicit `skills` path is additive-to-default and unneeded.
test("(vi-b) plugin.json declares no skills field (default skills/<name>/SKILL.md layout is used)", () => {
  assert.ok(!("skills" in plugin), "plugin.json must not declare a `skills` field (skills load via the default skills/<name>/SKILL.md layout)");
});

// (vii) The SKILL.md prose roster — the `subagents (...)` sentence the orchestrator reads to know
// which reviewers exist — must list exactly the expected nine. Closes the one drift direction the
// validator does not (a name dropped from the prose still loads, but the orchestrator's own panel
// description would be wrong).
test("(vii) the SKILL.md prose subagents roster matches the expected roster", () => {
  const skill = fs.readFileSync(path.join(PLUGIN, "skills", "vigil", "SKILL.md"), "utf8");
  const roster = (skill.match(/subagents \(([^)]+)\)/) || [])[1] || "";
  const names = [...roster.matchAll(/`([a-z0-9-]+)`/gi)].map((m) => m[1]);
  assert.deepStrictEqual(
    [...new Set(names)].sort(),
    [...EXPECTED_NAMES].sort(),
    "the SKILL.md subagents roster must name exactly the expected agents"
  );
});
