// Parity oracle for eval/manifest.yaml — the single machine-readable index of the behavioral
// fixtures. Three-way parity: (1) every eval/fixtures/*.md file has a manifest entry, (2) every
// manifest entry's file exists on disk, and (3) the FIXTURES array literal inside
// eval/fixture-eval.workflow.js lists exactly the same paths. The workflow script runs inside the
// Workflow runtime, where it CANNOT read the filesystem to discover fixtures at run time — its
// FIXTURES list is hand-synced by design, which is exactly why this test enforces the sync.
// The manifest is deliberately flat YAML, hand-parsed line-based here to keep the repo
// dependency-free (no yaml package).
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { root } from "./helpers.mjs";

const MANIFEST = path.join(root, "eval", "manifest.yaml");
const FIXTURES_DIR = path.join(root, "eval", "fixtures");
const WORKFLOW = path.join(root, "eval", "fixture-eval.workflow.js");

// Line-based parse of the flat manifest: `- key: value` starts an entry, `key: value` continues it.
function parseManifest(text) {
  const entries = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const startM = line.match(/^-\s+([A-Za-z_]+):\s*(.+)$/);
    if (startM) { current = { [startM[1]]: startM[2].trim() }; entries.push(current); continue; }
    const kvM = line.match(/^([A-Za-z_]+):\s*(.+)$/);
    if (kvM && current) current[kvM[1]] = kvM[2].trim();
    // `fixtures:` (a bare list header, no value) intentionally matches neither branch.
  }
  return entries;
}

const entries = parseManifest(fs.readFileSync(MANIFEST, "utf8"));

test("eval manifest: every entry carries the full field set with a valid expected value", () => {
  assert.ok(entries.length > 0, "manifest must list at least one fixture");
  for (const e of entries) {
    for (const field of ["id", "file", "lang", "expected", "scorer"]) {
      assert.ok(e[field], `manifest entry ${e.id || JSON.stringify(e)} is missing "${field}"`);
    }
    assert.ok(["hit", "clean"].includes(e.expected), `manifest entry ${e.id}: expected must be hit|clean, got "${e.expected}"`);
  }
  assert.strictEqual(new Set(entries.map((e) => e.id)).size, entries.length, "manifest ids must be unique");
});

test("eval manifest: three-way parity between manifest, fixtures on disk, and the workflow FIXTURES array", () => {
  // (1) + (2): manifest files <-> eval/fixtures/*.md on disk (posix-relative paths, sorted).
  const diskFiles = fs.readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".md")).map((f) => `eval/fixtures/${f}`).sort();
  const manifestFiles = entries.map((e) => e.file).sort();
  assert.deepStrictEqual(manifestFiles, diskFiles,
    "eval/manifest.yaml entries must list exactly the eval/fixtures/*.md files on disk (add/remove the manifest entry with the fixture)");

  // (3): the hand-synced FIXTURES array literal inside the workflow script lists the same paths.
  const workflowText = fs.readFileSync(WORKFLOW, "utf8");
  const arrayM = workflowText.match(/const FIXTURES = \[([\s\S]*?)\]/);
  assert.ok(arrayM, "eval/fixture-eval.workflow.js must contain the FIXTURES array literal");
  const workflowFiles = [...arrayM[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepStrictEqual(workflowFiles, diskFiles,
    "the FIXTURES array in eval/fixture-eval.workflow.js must list exactly the eval/fixtures/*.md files (the Workflow runtime cannot discover them from disk — update the array with the fixture)");
});

test("eval manifest: id and expected agree with each fixture's own frontmatter (the manifest cannot lie about ground truth)", () => {
  for (const e of entries) {
    const text = fs.readFileSync(path.join(root, ...e.file.split("/")), "utf8");
    const fmId = (text.match(/^id:\s*(.+)$/m) || [])[1]?.trim();
    const fmExpected = (text.match(/^expected:\s*(.+)$/m) || [])[1]?.trim();
    assert.strictEqual(fmId, e.id, `${e.file}: manifest id "${e.id}" must equal the fixture frontmatter id "${fmId}"`);
    assert.strictEqual(fmExpected, e.expected, `${e.file}: manifest expected "${e.expected}" must equal the fixture frontmatter expected "${fmExpected}"`);
  }
});
