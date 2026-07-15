import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { temporary, write } from "./helpers.mjs";
import { verifyMap, writeMap } from "../cressetide/skills/map/scripts/map.mjs";

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function repository() {
  const root = temporary("ctide-map-");
  git(root, "init", "--initial-branch=main");
  git(root, "config", "user.email", "map@example.invalid");
  git(root, "config", "user.name", "Map Test");
  write(path.join(root, "package.json"), JSON.stringify({ name: "neutral-map-fixture", scripts: { test: "node --test", start: "node src/index.js" }, dependencies: { "fixture-client": "1.0.0" } }));
  write(path.join(root, "src", "index.js"), "export function start() { return 'ok'; }\n");
  write(path.join(root, "src", "api-client.js"), "export const endpoint = 'https://example.invalid';\n");
  write(path.join(root, "src", "schema.sql"), "create table fixture(id integer);\n");
  write(path.join(root, "test", "index.test.js"), "// neutral fixture\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "fixture");
  return root;
}

function enrichGeneratedBaseline(target) {
  let text = fs.readFileSync(target, "utf8");
  const replacements = new Map([
    ["Architecture boundaries", [
      "- The src/index.js module is the fixture entry boundary and exports start().",
    ]],
    ["Execution flows", [
      "- The start script invokes src/index.js; the test script invokes the Node test runner.",
    ]],
    ["Data flows", [
      "- src/schema.sql owns the fixture table definition; no runtime persistence adapter is present.",
    ]],
    ["External integrations", [
      "- src/api-client.js declares the fixture's external endpoint boundary.",
    ]],
    ["Runtime and operations", [
      "- The package scripts are the only evidenced build, run, and test operations; deploy and recovery paths are absent.",
    ]],
    ["Risk and uncertainty", [
      "- The external endpoint in src/api-client.js is the fixture's evidenced trust-boundary risk.",
      "- No authentication, destructive operation, migration runner, observability, or rollback implementation is present.",
    ]],
  ]);
  for (const [section, body] of replacements) {
    const marker = `## ${section}`;
    const start = text.indexOf(marker);
    const end = text.indexOf("\n## ", start + marker.length);
    assert.notEqual(start, -1, `missing generated section ${section}`);
    const blockEnd = end < 0 ? text.length : end;
    const block = text.slice(start, blockEnd)
      .replace("Confidence: unverified", "Confidence: derived")
      .replace(/^- UNVERIFIED:.*$/m, body.join("\n"));
    text = text.slice(0, start) + block + text.slice(blockEnd);
  }
  fs.writeFileSync(target, text, "utf8");
}

test("Map create emits required sections and rejects its heuristic baseline until it is concretely enriched", () => {
  const root = repository();
  const target = writeMap(root);
  const text = fs.readFileSync(target, "utf8");
  for (const section of ["Repository structure", "Architecture boundaries", "Execution flows", "Data flows", "External integrations", "Runtime and operations", "Risk and uncertainty"]) {
    assert.match(text, new RegExp(`## ${section}[\\s\\S]*?Verified at commit:[\\s\\S]*?Confidence:[\\s\\S]*?Sources:`));
  }
  assert.match(text, /Package scripts: start, test/);
  assert.match(text, /Candidate entry points: src\/index\.js/);
  assert.match(text, /Data-related evidence candidates: src\/schema\.sql/);
  assert.match(text, /Dependency candidates: fixture-client/);
  assert.match(text, /Integration code candidates: src\/api-client\.js/);
  assert.match(text, /Operations evidence candidates: none detected/);
  assert.match(text, /Confidence: unverified[\s\S]*?UNVERIFIED:/);
  const baseline = verifyMap(root);
  assert.equal(baseline.ok, false);
  assert.ok(baseline.findings.some(finding => finding.includes("unverified section")));

  enrichGeneratedBaseline(target);
  assert.equal(verifyMap(root).ok, true, verifyMap(root).findings.join("\n"));
  assert.throws(() => writeMap(root), /already exists/);
});

test("Map verify detects dirty working-tree source drift without a new commit", () => {
  const root = repository();
  const target = writeMap(root);
  enrichGeneratedBaseline(target);
  assert.equal(verifyMap(root).ok, true, verifyMap(root).findings.join("\n"));
  write(path.join(root, "src", "index.js"), "export function start() { return 'changed'; }\n");
  const report = verifyMap(root);
  assert.equal(report.ok, false);
  assert.ok(report.findings.some(finding => /fingerprint|source drift/i.test(finding)));
});

test("Map verify detects source drift in an unborn repository", () => {
  const root = temporary("ctide-map-unborn-drift-");
  git(root, "init", "--initial-branch=main");
  write(path.join(root, "package.json"), JSON.stringify({ name: "unborn-map-fixture" }));
  const target = writeMap(root);
  write(path.join(root, "package.json"), JSON.stringify({ name: "changed-unborn-map-fixture" }));
  const report = verifyMap(root);
  assert.equal(report.ok, false);
  assert.ok(report.findings.some(finding => /fingerprint|source drift/i.test(finding)));
  assert.match(fs.readFileSync(target, "utf8"), /Verified at commit: UNBORN/);
});

test("Map verify rejects source line ranges outside the cited file", () => {
  const root = repository();
  const target = writeMap(root);
  let text = fs.readFileSync(target, "utf8");
  text = text.replace("- package.json:1", "- package.json:999-1000");
  fs.writeFileSync(target, text, "utf8");
  const report = verifyMap(root);
  assert.equal(report.ok, false);
  assert.ok(report.findings.some(finding => /invalid source line range/i.test(finding)));
});

test("Map verify rejects a heuristic placeholder even when its confidence is promoted", () => {
  const root = repository();
  const target = writeMap(root);
  let text = fs.readFileSync(target, "utf8");
  text = text.replace("Confidence: unverified", "Confidence: derived");
  text = text.replace("- UNVERIFIED: Component responsibilities", "- Component responsibilities");
  fs.writeFileSync(target, text, "utf8");
  const report = verifyMap(root);
  assert.equal(report.ok, false);
  assert.ok(report.findings.some(finding => finding.includes("heuristic placeholder: Architecture boundaries")));
  assert.ok(report.findings.some(finding => finding.includes("conflicting section: Architecture boundaries")));
});

test("Map verify accepts ordinary evidence-backed requirement language", () => {
  const root = repository();
  const target = writeMap(root);
  enrichGeneratedBaseline(target);
  let text = fs.readFileSync(target, "utf8");
  text = text.replace(
    "- The src/index.js module is the fixture entry boundary and exports start().",
    "- The src/index.js entry boundary requires callers to use the exported start() function.",
  );
  fs.writeFileSync(target, text, "utf8");
  const report = verifyMap(root);
  assert.equal(report.ok, true, report.findings.join("\n"));
});

test("Map verify requires valid root and section Last updated provenance", () => {
  const root = repository();
  const target = writeMap(root);
  enrichGeneratedBaseline(target);
  let text = fs.readFileSync(target, "utf8");
  text = text.replace(/^Last updated:.*\r?\n/m, "");
  text = text.replace(/^Last updated:.*$/m, "Last updated: not-a-date");
  fs.writeFileSync(target, text, "utf8");
  const report = verifyMap(root);
  assert.equal(report.ok, false);
  assert.ok(report.findings.some(finding => finding.includes("missing map last updated")));
  assert.ok(report.findings.some(finding => finding.includes("invalid section last updated")));
});

test("Map verify rejects impossible calendar dates at root and section scope", () => {
  const rootInvalid = repository();
  const rootTarget = writeMap(rootInvalid);
  enrichGeneratedBaseline(rootTarget);
  let rootText = fs.readFileSync(rootTarget, "utf8");
  rootText = rootText.replace(/^Last updated:.*$/m, "Last updated: 2026-02-31");
  fs.writeFileSync(rootTarget, rootText, "utf8");
  assert.ok(verifyMap(rootInvalid).findings.some(finding => finding.includes("invalid map last updated")));

  const sectionInvalid = repository();
  const sectionTarget = writeMap(sectionInvalid);
  enrichGeneratedBaseline(sectionTarget);
  let sectionText = fs.readFileSync(sectionTarget, "utf8");
  const sectionStart = sectionText.indexOf("## Repository structure");
  const sectionEnd = sectionText.indexOf("\n## ", sectionStart + 3);
  const sectionBlock = sectionText.slice(sectionStart, sectionEnd)
    .replace(/^Last updated:.*$/m, "Last updated: 2026-02-29");
  sectionText = sectionText.slice(0, sectionStart) + sectionBlock + sectionText.slice(sectionEnd);
  fs.writeFileSync(sectionTarget, sectionText, "utf8");
  assert.ok(verifyMap(sectionInvalid).findings.some(finding => finding.includes("invalid section last updated")));
});

test("Map verify reports commit staleness", () => {
  const root = repository();
  writeMap(root);
  write(path.join(root, "src", "new.js"), "export const value = 1;\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "change");
  const report = verifyMap(root);
  assert.equal(report.ok, false);
  assert.ok(report.findings.some(finding => finding.includes("stale")));
});

test("Map refresh replaces stale deleted paths and verifies the current commit", () => {
  const root = repository();
  const target = writeMap(root);
  const before = fs.readFileSync(target, "utf8");
  assert.match(before, /package\.json:1/);
  const beforeFingerprint = before.match(/^Working tree fingerprint:\s*(.+)$/m)?.[1];
  fs.rmSync(path.join(root, "package.json"));
  write(path.join(root, "pyproject.toml"), "[project]\nname='neutral-map-fixture'\n");
  git(root, "add", "-A");
  git(root, "commit", "-m", "replace package metadata");
  writeMap(root, { overwrite: true });
  const refreshed = fs.readFileSync(target, "utf8");
  assert.doesNotMatch(refreshed, /package\.json:1/);
  assert.match(refreshed, /pyproject\.toml:1/);
  const refreshedFingerprint = refreshed.match(/^Working tree fingerprint:\s*(.+)$/m)?.[1];
  assert.notEqual(refreshedFingerprint, beforeFingerprint);
  assert.ok(verifyMap(root).findings.some(finding => finding.includes("unverified section")));
  enrichGeneratedBaseline(target);
  assert.equal(verifyMap(root).ok, true, verifyMap(root).findings.join("\n"));
});

test("Map verify reports missing and conflicting evidence", () => {
  const root = repository();
  const target = writeMap(root);
  let text = fs.readFileSync(target, "utf8");
  text = text.replace("- package.json:1", "- missing.json:1");
  text = text.replace("Confidence: unverified", "Confidence: verified").replace("- src/index.js:1", "- UNVERIFIED");
  fs.writeFileSync(target, text, "utf8");
  const report = verifyMap(root);
  assert.equal(report.ok, false);
  assert.ok(report.findings.some(finding => finding.includes("missing source")));
  assert.ok(report.findings.some(finding => finding.includes("conflicting section")));
});

test("Map refuses a junction that would redirect output outside the repository", () => {
  const root = repository();
  const outside = temporary("ctide-map-outside-");
  fs.mkdirSync(path.join(root, ".ctide"), { recursive: true });
  fs.symlinkSync(outside, path.join(root, ".ctide", "map"), "junction");
  assert.throws(() => writeMap(root), /outside|symbolic|reparse|junction/i);
  assert.equal(fs.existsSync(path.join(outside, "SYSTEM_MAP.md")), false);
});

test("Map verify rejects provenance paths outside the repository", () => {
  const root = repository();
  const target = writeMap(root);
  const outside = path.join(path.dirname(root), "outside.txt");
  fs.writeFileSync(outside, "outside\n", "utf8");
  try {
    const text = fs.readFileSync(target, "utf8").replace("- package.json:1", "- ../outside.txt:1");
    fs.writeFileSync(target, text, "utf8");
    const report = verifyMap(root);
    assert.equal(report.ok, false);
    assert.ok(report.findings.some(finding => finding.includes("outside repository")));
  } finally { fs.rmSync(outside, { force: true }); }
});

test("Map refresh preserves the explicit human-verified operational boundary", () => {
  const root = repository();
  const target = writeMap(root);
  let text = fs.readFileSync(target, "utf8");
  text = text.replace("No human-verified operational notes recorded.", "- Rollback uses the documented stop command.\nSources:\n- package.json:1");
  fs.writeFileSync(target, text, "utf8");
  writeMap(root, { overwrite: true });
  const refreshed = fs.readFileSync(target, "utf8");
  assert.match(refreshed, /Rollback uses the documented stop command/);
  enrichGeneratedBaseline(target);
  assert.equal(verifyMap(root).ok, true, verifyMap(root).findings.join("\n"));
});

test("Map verify reports sections whose repository facts remain unverified", () => {
  const root = temporary("ctide-map-incomplete-");
  git(root, "init", "--initial-branch=main");
  git(root, "config", "user.email", "map@example.invalid");
  git(root, "config", "user.name", "Map Test");
  write(path.join(root, "README.md"), "# Empty fixture\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "incomplete fixture");
  writeMap(root);
  const report = verifyMap(root);
  assert.equal(report.ok, false);
  assert.ok(report.findings.some(finding => finding.includes("unverified section")));
});

test("Map verify rejects an unresolved body marker under derived confidence", () => {
  const root = repository();
  const target = writeMap(root);
  const text = fs.readFileSync(target, "utf8").replace("Candidate entry points: src/index.js", "Candidate entry points: UNVERIFIED");
  fs.writeFileSync(target, text, "utf8");
  const report = verifyMap(root);
  assert.equal(report.ok, false);
  assert.ok(report.findings.some(finding => finding.includes("unresolved evidence marker")));
});

test("Map distinguishes an unborn repository from unreadable Git state", () => {
  const nonGit = temporary("ctide-map-no-git-");
  assert.throws(() => writeMap(nonGit), /requires a readable Git repository/);

  const unborn = temporary("ctide-map-unborn-");
  git(unborn, "init", "--initial-branch=main");
  const target = writeMap(unborn);
  assert.match(fs.readFileSync(target, "utf8"), /Verified at commit: UNBORN/);
});
