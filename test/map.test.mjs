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
    ["System overview", [
      "- The neutral-map-fixture repository is a Node.js fixture that exercises Map generation end-to-end.",
    ]],
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

  // Targeted per-field placeholder-line replacement (not a heading-to-next-heading slice): the last
  // Ops Profile field ("Approvals map") sits immediately before CTIDE:MANUAL-NOTES:START, so a
  // slice-based replace up to the next "## " would delete that boundary marker along with it.
  const opsProfileReplacements = new Map([
    // Replaces the placeholder table row together with the trailing marker note (not just the note)
    // so the enriched fixture no longer contains the all-UNVERIFIED row map.mjs's Access-inventory
    // check now also flags -- otherwise this "fully enriched" fixture would still read as unenriched.
    ["Access inventory", [
      "| UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED <!-- CTIDE:TRUST:unverified --> |\nUNVERIFIED: access inventory entries require Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER -->",
      "| App logs | fixture log path | agent-runnable | verified: 2026-07-01 <!-- CTIDE:TRUST:verified:2026-07-01 --> |\n| Error tracking | fixture tracker + fixture project | human-only | dry-run-verified: 2026-07-01 <!-- CTIDE:TRUST:dry-run-verified:2026-07-01 --> |",
    ]],
    ["Rollback", [
      "- UNVERIFIED: rollback steps, schema-migration history, and new-format data require Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER --> <!-- CTIDE:TRUST:unverified -->",
      "- Exact steps: run scripts/rollback.sh (verified: 2026-07-01) <!-- CTIDE:TRUST:verified:2026-07-01 -->",
    ]],
    ["Feature flags & kill switches", [
      "- UNVERIFIED: feature flags and kill switches require Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER --> <!-- CTIDE:TRUST:unverified -->",
      "- fixture-flag — disables the fixture worker — flip via scripts/toggle.sh (verified: 2026-07-01) <!-- CTIDE:TRUST:verified:2026-07-01 -->",
    ]],
    ["Backups", [
      "- UNVERIFIED: backup existence and restore-drill status require Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER -->",
      "- Exists: yes — Where: fixture backup bucket — Last restore drill: 2026-07-01",
    ]],
    ["Breach readiness", [
      "- UNVERIFIED: secure evidence store, out-of-band comms, legal/privacy owner, and notification threshold require Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER -->",
      "- Secure evidence store: fixture evidence bucket\n- Out-of-band comms: fixture phone bridge\n- Legal/privacy owner: fixture legal owner\n- Notification threshold: fixture disclosure threshold",
    ]],
    ["Observability inventory", [
      "- UNVERIFIED: observability inventory (logs, metrics, alerts) requires Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER -->",
      "- Fixture logs and metrics are queryable via the fixture dashboard.",
    ]],
    ["Run in isolation", [
      "- UNVERIFIED: how to run the system in isolation requires Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER -->",
      "- Run `npm start` locally with the fixture seed data.",
    ]],
    ["External dependencies", [
      "- UNVERIFIED: external dependencies and their health/status locations require Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER -->",
      "- fixture-client — https://status.example.invalid",
    ]],
    ["Approvals map", [
      "- UNVERIFIED: the approvals map (rollback, maintenance mode, data repair) requires Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER -->",
      "- Rollback: fixture on-call engineer\n- Maintenance mode / stop-writes: fixture on-call engineer\n- Data repair: fixture data owner",
    ]],
  ]);
  for (const [name, [placeholder, enriched]] of opsProfileReplacements) {
    assert.ok(text.includes(placeholder), `missing generated ops-profile placeholder for ${name}`);
    text = text.replace(placeholder, enriched);
  }

  fs.writeFileSync(target, text, "utf8");
}

test("Map create emits required sections and rejects its heuristic baseline until it is concretely enriched", () => {
  const root = repository();
  const target = writeMap(root);
  const text = fs.readFileSync(target, "utf8");
  for (const section of ["System overview", "Repository structure", "Architecture boundaries", "Execution flows", "Data flows", "External integrations", "Runtime and operations", "Risk and uncertainty"]) {
    assert.match(text, new RegExp(`## ${section}[\\s\\S]*?Verified at commit:[\\s\\S]*?Confidence:[\\s\\S]*?Sources:`));
  }
  assert.ok(
    text.indexOf("## System overview") < text.indexOf("## Repository structure"),
    "System overview must be emitted before Repository structure",
  );
  const systemOverviewBlock = text.slice(text.indexOf("## System overview"), text.indexOf("## Repository structure"));
  assert.match(
    systemOverviewBlock,
    /See Architecture boundaries for components and entry points\.[\s\S]*See External integrations for external dependencies\./,
    "System overview must point into Architecture boundaries and External integrations, not restate them",
  );
  assert.doesNotMatch(systemOverviewBlock, /^-\s*Components?:/m, "System overview must not restate components inline");
  assert.doesNotMatch(systemOverviewBlock, /^-\s*Entry points?:/m, "System overview must not restate entry points inline");
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

test("Map create emits a default Ops Profile skeleton positioned after the canonical sections and before manual notes", () => {
  const root = repository();
  const target = writeMap(root);
  const text = fs.readFileSync(target, "utf8");
  const opsProfileFields = [
    "Access inventory", "Rollback", "Feature flags & kill switches", "Backups",
    "Breach readiness", "Observability inventory", "Run in isolation",
    "External dependencies", "Approvals map",
  ];
  let previousIndex = text.indexOf("## Risk and uncertainty");
  assert.notEqual(previousIndex, -1, "Risk and uncertainty must precede the Ops Profile skeleton");
  for (const name of opsProfileFields) {
    const index = text.indexOf(`## ${name}`);
    assert.notEqual(index, -1, `missing ops-profile heading ${name}`);
    assert.ok(index > previousIndex, `${name} must be positioned after the previous canonical/ops-profile heading`);
    previousIndex = index;
  }
  assert.ok(
    previousIndex < text.indexOf("<!-- CTIDE:MANUAL-NOTES:START -->"),
    "the Ops Profile skeleton must end before the manual notes boundary",
  );
  // The 3 trust-marker fields must each emit a syntactically valid (if unenriched) machine tag
  // alongside the existing heuristic-placeholder comment, so a freshly generated map never itself
  // trips the malformed-trust-marker check.
  const trustTagCount = (text.match(/<!-- CTIDE:TRUST:unverified -->/g) || []).length;
  assert.equal(trustTagCount, 3, "Access inventory, Rollback, and Feature flags & kill switches must each emit exactly one fresh <!-- CTIDE:TRUST:unverified --> tag");
  const report = verifyMap(root);
  assert.equal(report.ok, false);
  assert.ok(!report.findings.some(finding => finding.startsWith("missing ops-profile field")), "a fresh baseline must not report any ops-profile field as missing");
  assert.ok(!report.findings.some(finding => finding.startsWith("malformed trust marker")), "a fresh, unenriched baseline's own <!-- CTIDE:TRUST:unverified --> tags must never themselves be reported malformed: " + report.findings.join("\n"));
});

test("Map verify reports an unenriched ops-profile field still at its heuristic placeholder", () => {
  const root = repository();
  writeMap(root);
  const report = verifyMap(root);
  assert.equal(report.ok, false);
  assert.ok(report.findings.some(finding => finding.includes("unenriched ops-profile field: Rollback")));
});

test("Map verify still detects an unenriched ops-profile field when only the marker comment is stripped", () => {
  const root = repository();
  const target = writeMap(root);
  let text = fs.readFileSync(target, "utf8");
  // Strip ONLY the trailing " <!-- CTIDE:HEURISTIC-PLACEHOLDER -->" marker comment from each field's
  // skeleton line, leaving the "- UNVERIFIED: ... requires Cartographer confirmation." sentence fully
  // intact -- this used to make verify report zero findings for 8 of the 9 ops-profile fields, since
  // "still unenriched" detection depended solely on the marker comment surviving untouched. Rollback,
  // Feature flags & kill switches, Backups, and Approvals map sample the first field, two interior
  // fields, and the last field (immediately adjacent to the Manual Notes boundary).
  const strippedSentences = [
    ["Rollback", "- UNVERIFIED: rollback steps, schema-migration history, and new-format data require Cartographer confirmation."],
    ["Feature flags & kill switches", "- UNVERIFIED: feature flags and kill switches require Cartographer confirmation."],
    ["Backups", "- UNVERIFIED: backup existence and restore-drill status require Cartographer confirmation."],
    ["Approvals map", "- UNVERIFIED: the approvals map (rollback, maintenance mode, data repair) requires Cartographer confirmation."],
  ];
  for (const [name, sentence] of strippedSentences) {
    const before = text;
    text = text.replace(sentence + " <!-- CTIDE:HEURISTIC-PLACEHOLDER -->", sentence);
    assert.notEqual(text, before, `expected to find and strip the marker comment for ${name}`);
  }
  fs.writeFileSync(target, text, "utf8");
  const report = verifyMap(root);
  for (const [name] of strippedSentences) {
    assert.ok(
      report.findings.some(finding => finding.includes("unenriched ops-profile field: " + name)),
      `a field still reading its full placeholder sentence (only the marker comment stripped) must still be reported as unenriched: ${name}: ` + report.findings.join("\n"),
    );
  }
});

test("Map verify reports a missing ops-profile field", () => {
  const root = repository();
  const target = writeMap(root);
  let text = fs.readFileSync(target, "utf8");
  text = text.replace("## Access inventory", "## XAccess inventory");
  fs.writeFileSync(target, text, "utf8");
  const report = verifyMap(root);
  assert.equal(report.ok, false);
  assert.ok(report.findings.some(finding => finding.includes("missing ops-profile field: Access inventory")));
});

test("Map verify reports a malformed ops-profile trust marker (read from the CTIDE:TRUST tag, not the prose)", () => {
  const root = repository();
  const target = writeMap(root);
  let text = fs.readFileSync(target, "utf8");
  // The human-readable prose itself ("verified: whenever it last ran") is no longer what verify reads;
  // only the appended <!-- CTIDE:TRUST:... --> tag is. A tag with a "verified" tier but no date at all
  // is malformed.
  text = text.replace(
    "- UNVERIFIED: rollback steps, schema-migration history, and new-format data require Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER --> <!-- CTIDE:TRUST:unverified -->",
    "- Exact steps: run scripts/rollback.sh (verified: whenever it last ran) <!-- CTIDE:TRUST:verified -->",
  );
  fs.writeFileSync(target, text, "utf8");
  const report = verifyMap(root);
  assert.equal(report.ok, false);
  assert.ok(report.findings.some(finding => finding.includes("malformed trust marker: Rollback")));
  assert.ok(!report.findings.some(finding => finding.includes("unenriched ops-profile field: Rollback")), "removing the placeholder marker must not also count as still-unenriched");
});

test("Map verify handles the ops-profile dry-run-verified trust-marker tag correctly", () => {
  const wellFormedRoot = repository();
  const wellFormedTarget = writeMap(wellFormedRoot);
  let wellFormedText = fs.readFileSync(wellFormedTarget, "utf8");
  wellFormedText = wellFormedText.replace(
    "- UNVERIFIED: feature flags and kill switches require Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER --> <!-- CTIDE:TRUST:unverified -->",
    "- fixture-flag — disables the fixture worker — flip via scripts/toggle.sh (dry-run-verified: 2026-07-01) <!-- CTIDE:TRUST:dry-run-verified:2026-07-01 -->",
  );
  fs.writeFileSync(wellFormedTarget, wellFormedText, "utf8");
  const wellFormedReport = verifyMap(wellFormedRoot);
  assert.ok(
    !wellFormedReport.findings.some(finding => finding.includes("malformed trust marker: Feature flags & kill switches")),
    "a well-formed dry-run-verified tag with an ISO date must not be flagged malformed: " + wellFormedReport.findings.join("\n"),
  );

  const malformedRoot = repository();
  const malformedTarget = writeMap(malformedRoot);
  let malformedText = fs.readFileSync(malformedTarget, "utf8");
  // The prose itself is left correctly dated ("2026-07-01") -- only the TAG's date is missing. Since
  // verify reads only the tag, this must still be malformed despite the honest-looking prose.
  malformedText = malformedText.replace(
    "- UNVERIFIED: feature flags and kill switches require Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER --> <!-- CTIDE:TRUST:unverified -->",
    "- fixture-flag — disables the fixture worker — flip via scripts/toggle.sh (dry-run-verified: 2026-07-01) <!-- CTIDE:TRUST:dry-run-verified -->",
  );
  fs.writeFileSync(malformedTarget, malformedText, "utf8");
  const malformedReport = verifyMap(malformedRoot);
  assert.equal(malformedReport.ok, false);
  assert.ok(
    malformedReport.findings.some(finding => finding.includes("malformed trust marker: Feature flags & kill switches")),
    "a dry-run-verified tag without a date must be flagged malformed even when the surrounding prose is dated: " + malformedReport.findings.join("\n"),
  );
});

test("Map verify flags a recognized-tier tag with an invalid (non-ISO) date, and an unrecognized tier word, both as malformed", () => {
  const invalidDateRoot = repository();
  const invalidDateTarget = writeMap(invalidDateRoot);
  let invalidDateText = fs.readFileSync(invalidDateTarget, "utf8");
  invalidDateText = invalidDateText.replace(
    "- UNVERIFIED: rollback steps, schema-migration history, and new-format data require Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER --> <!-- CTIDE:TRUST:unverified -->",
    "- Exact steps: run scripts/rollback.sh (verified: 2026-02-31) <!-- CTIDE:TRUST:verified:2026-02-31 -->",
  );
  fs.writeFileSync(invalidDateTarget, invalidDateText, "utf8");
  const invalidDateReport = verifyMap(invalidDateRoot);
  assert.ok(
    invalidDateReport.findings.some(finding => finding.includes("malformed trust marker: Rollback")),
    "a recognized 'verified' tier with an impossible calendar date must be malformed: " + invalidDateReport.findings.join("\n"),
  );

  const unrecognizedTierRoot = repository();
  const unrecognizedTierTarget = writeMap(unrecognizedTierRoot);
  let unrecognizedTierText = fs.readFileSync(unrecognizedTierTarget, "utf8");
  unrecognizedTierText = unrecognizedTierText.replace(
    "- UNVERIFIED: rollback steps, schema-migration history, and new-format data require Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER --> <!-- CTIDE:TRUST:unverified -->",
    "- Exact steps: run scripts/rollback.sh (verified: 2026-07-01) <!-- CTIDE:TRUST:confirmed:2026-07-01 -->",
  );
  fs.writeFileSync(unrecognizedTierTarget, unrecognizedTierText, "utf8");
  const unrecognizedTierReport = verifyMap(unrecognizedTierRoot);
  assert.ok(
    unrecognizedTierReport.findings.some(finding => finding.includes("malformed trust marker: Rollback")),
    "an unrecognized tier word ('confirmed') must be treated as malformed: " + unrecognizedTierReport.findings.join("\n"),
  );
});

test("Map verify accepts an unverified tag regardless of a trailing date-shaped suffix (disclosed design choice)", () => {
  // Design choice: unlike verified/dry-run-verified, "unverified" carries no date semantics, so
  // OPS_TRUST_TAG_WELLFORMED's optional ":<date>" group is never validated when the tier is
  // "unverified" -- a trailing suffix (even a non-date one) does not make the tag malformed. This is
  // the literal, most direct reading of the tag grammar's own optional-date group applying uniformly
  // across all 3 tiers; there is no false-confidence risk in accepting it, since "unverified" already
  // asserts the weakest trust state regardless of what (if anything) follows it.
  const root = repository();
  const target = writeMap(root);
  let text = fs.readFileSync(target, "utf8");
  text = text.replace(
    "- UNVERIFIED: rollback steps, schema-migration history, and new-format data require Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER --> <!-- CTIDE:TRUST:unverified -->",
    "- Exact steps: none recorded yet <!-- CTIDE:TRUST:unverified:2026-07-01 -->",
  );
  fs.writeFileSync(target, text, "utf8");
  const report = verifyMap(root);
  assert.ok(
    !report.findings.some(finding => finding.includes("malformed trust marker: Rollback")),
    "an 'unverified' tag with a trailing date-shaped suffix must not be treated as malformed: " + report.findings.join("\n"),
  );
});

test("Map verify does not flag a malformed trust marker on an ops-profile field with no documented trust-marker convention, as long as no tag is present", () => {
  const root = repository();
  const target = writeMap(root);
  let text = fs.readFileSync(target, "utf8");
  // "External dependencies" and "Backups" have no documented trust-marker convention at all --
  // operational-readiness.md's template only defines verified:/dry-run-verified:/UNVERIFIED for Access
  // inventory, Rollback, and Feature flags & kill switches. Under the tag-based mechanism this holds
  // trivially for ANY field, not just these two: a legitimately-enriched bullet that happens to contain
  // the prose word "verified:" (with no <!-- CTIDE:TRUST:... --> tag at all) is never scanned, because
  // there is no tag-shaped comment for the scan to find -- proving prose-scanning is genuinely gone, not
  // merely gated by an allowlist (see the next test for the field-scoping removal itself).
  text = text.replace(
    "- UNVERIFIED: external dependencies and their health/status locations require Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER -->",
    "- stripe-api — https://status.stripe.com — verified: works fine as of the last on-call check",
  );
  text = text.replace(
    "- UNVERIFIED: backup existence and restore-drill status require Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER -->",
    "- Exists: yes — Where: fixture backup bucket — verified: with the infra team during onboarding",
  );
  fs.writeFileSync(target, text, "utf8");
  const report = verifyMap(root);
  assert.ok(
    !report.findings.some(finding => finding.includes("malformed trust marker: External dependencies")),
    "a field with no documented trust-marker convention and no tag must never be scanned for a malformed marker: " + report.findings.join("\n"),
  );
  assert.ok(
    !report.findings.some(finding => finding.includes("malformed trust marker: Backups")),
    "a field with no documented trust-marker convention and no tag must never be scanned for a malformed marker: " + report.findings.join("\n"),
  );
});

test("Map verify flags a malformed CTIDE:TRUST tag even on a field with no documented trust-marker convention (the per-field allowlist is gone; detection is uniform)", () => {
  // The old mechanism gated its scan behind an OPS_TRUST_MARKER_FIELDS allowlist (Access inventory /
  // Rollback / Feature flags & kill switches only), because a bare "verified:" PROSE word is ordinary
  // English and would otherwise false-positive on the other 6 fields. The new tag is an unambiguous
  // machine sentinel no prose produces by accident, so there is nothing left for a field allowlist to
  // protect against -- the scan is now uniform across all 9 fields. This is a deliberate behavior change
  // from the old mechanism, verified explicitly here.
  const root = repository();
  const target = writeMap(root);
  let text = fs.readFileSync(target, "utf8");
  text = text.replace(
    "- UNVERIFIED: backup existence and restore-drill status require Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER -->",
    "- Exists: yes — Where: fixture backup bucket <!-- CTIDE:TRUST:verified -->",
  );
  fs.writeFileSync(target, text, "utf8");
  const report = verifyMap(root);
  assert.ok(
    report.findings.some(finding => finding.includes("malformed trust marker: Backups")),
    "a malformed CTIDE:TRUST tag must be flagged regardless of which field it appears in: " + report.findings.join("\n"),
  );
});

test("Map verify's malformed-tag detection is unaffected by prose reformatting (case, dash style, table style) -- reusing the exact fixture prose from the prior rounds' defeats", () => {
  // These 3 sub-cases reuse, verbatim, the exact prose shapes that defeated repair rounds 2-4's
  // heuristic anchors (a lowercase "- exact steps:" prefix defeated the case-sensitive designated-line
  // match; ASCII hyphens instead of em-dash defeated the Unicode-dash-count shape match; a pipe-omitted
  // GFM row defeated the pipe-bounded row regex). Under the tag mechanism none of that prose shape is
  // ever inspected for malformed-marker detection, so a malformed tag appended to each must still be
  // caught -- proving the prose shape is now irrelevant, not merely tolerated by a wider heuristic.
  const rollbackRoot = repository();
  const rollbackTarget = writeMap(rollbackRoot);
  let rollbackText = fs.readFileSync(rollbackTarget, "utf8");
  rollbackText = rollbackText.replace(
    "- UNVERIFIED: rollback steps, schema-migration history, and new-format data require Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER --> <!-- CTIDE:TRUST:unverified -->",
    "- exact steps: run scripts/rollback.sh (verified: whenever it last ran) <!-- CTIDE:TRUST:verified -->",
  );
  fs.writeFileSync(rollbackTarget, rollbackText, "utf8");
  const rollbackReport = verifyMap(rollbackRoot);
  assert.ok(
    rollbackReport.findings.some(finding => finding.includes("malformed trust marker: Rollback")),
    "a malformed tag on a lowercase 'exact steps:' line (case reformatting) must still be flagged: " + rollbackReport.findings.join("\n"),
  );

  const featureFlagsRoot = repository();
  const featureFlagsTarget = writeMap(featureFlagsRoot);
  let featureFlagsText = fs.readFileSync(featureFlagsTarget, "utf8");
  featureFlagsText = featureFlagsText.replace(
    "- UNVERIFIED: feature flags and kill switches require Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER --> <!-- CTIDE:TRUST:unverified -->",
    "- fixture-flag - disables the fixture worker - flip via scripts/toggle.sh (verified: whenever it last ran) <!-- CTIDE:TRUST:verified -->",
  );
  fs.writeFileSync(featureFlagsTarget, featureFlagsText, "utf8");
  const featureFlagsReport = verifyMap(featureFlagsRoot);
  assert.ok(
    featureFlagsReport.findings.some(finding => finding.includes("malformed trust marker: Feature flags & kill switches")),
    "a malformed tag on an ASCII-hyphen flag bullet (dash-style reformatting) must still be flagged: " + featureFlagsReport.findings.join("\n"),
  );

  const accessInventoryRoot = repository();
  const accessInventoryTarget = writeMap(accessInventoryRoot);
  let accessInventoryText = fs.readFileSync(accessInventoryTarget, "utf8");
  accessInventoryText = accessInventoryText.replace(
    "| UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED <!-- CTIDE:TRUST:unverified --> |\nUNVERIFIED: access inventory entries require Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER -->",
    "App logs | fixture log path | agent-runnable | verified: whenever it last ran <!-- CTIDE:TRUST:verified -->\nSee the deploy runbook for the full access list.",
  );
  fs.writeFileSync(accessInventoryTarget, accessInventoryText, "utf8");
  const accessInventoryReport = verifyMap(accessInventoryRoot);
  assert.ok(
    accessInventoryReport.findings.some(finding => finding.includes("malformed trust marker: Access inventory")),
    "a malformed tag on a pipe-omitted table row (table-style reformatting) must still be flagged: " + accessInventoryReport.findings.join("\n"),
  );
});

test("Map verify's well-formed-tag pass is unaffected by the same prose reformatting", () => {
  // Mirrors the previous test exactly, but with a WELL-FORMED tag on each reformatted line/row --
  // proving reformatted prose does not cause a false "malformed" finding either. Together with the
  // previous test, this demonstrates detection depends solely on the tag, in both directions.
  const rollbackRoot = repository();
  const rollbackTarget = writeMap(rollbackRoot);
  let rollbackText = fs.readFileSync(rollbackTarget, "utf8");
  rollbackText = rollbackText.replace(
    "- UNVERIFIED: rollback steps, schema-migration history, and new-format data require Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER --> <!-- CTIDE:TRUST:unverified -->",
    "- exact steps: run scripts/rollback.sh (verified: 2026-07-01) <!-- CTIDE:TRUST:verified:2026-07-01 -->",
  );
  fs.writeFileSync(rollbackTarget, rollbackText, "utf8");
  assert.ok(
    !verifyMap(rollbackRoot).findings.some(finding => finding.includes("Rollback")),
    "a well-formed tag on a lowercase 'exact steps:' line must produce zero Rollback findings: " + verifyMap(rollbackRoot).findings.join("\n"),
  );

  const featureFlagsRoot = repository();
  const featureFlagsTarget = writeMap(featureFlagsRoot);
  let featureFlagsText = fs.readFileSync(featureFlagsTarget, "utf8");
  featureFlagsText = featureFlagsText.replace(
    "- UNVERIFIED: feature flags and kill switches require Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER --> <!-- CTIDE:TRUST:unverified -->",
    "- fixture-flag - disables the fixture worker - flip via scripts/toggle.sh (verified: 2026-07-01) <!-- CTIDE:TRUST:verified:2026-07-01 -->",
  );
  fs.writeFileSync(featureFlagsTarget, featureFlagsText, "utf8");
  assert.ok(
    !verifyMap(featureFlagsRoot).findings.some(finding => finding.includes("Feature flags & kill switches")),
    "a well-formed tag on an ASCII-hyphen flag bullet must produce zero Feature-flags findings: " + verifyMap(featureFlagsRoot).findings.join("\n"),
  );

  const accessInventoryRoot = repository();
  const accessInventoryTarget = writeMap(accessInventoryRoot);
  let accessInventoryText = fs.readFileSync(accessInventoryTarget, "utf8");
  accessInventoryText = accessInventoryText.replace(
    "| UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED <!-- CTIDE:TRUST:unverified --> |\nUNVERIFIED: access inventory entries require Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER -->",
    "App logs | fixture log path | agent-runnable | verified: 2026-07-01 <!-- CTIDE:TRUST:verified:2026-07-01 -->\nSee the deploy runbook for the full access list.",
  );
  fs.writeFileSync(accessInventoryTarget, accessInventoryText, "utf8");
  assert.ok(
    !verifyMap(accessInventoryRoot).findings.some(finding => finding.includes("Access inventory")),
    "a well-formed tag on a pipe-omitted table row must produce zero Access-inventory findings: " + verifyMap(accessInventoryRoot).findings.join("\n"),
  );
});

test("Map verify evaluates multiple tags in one field independently -- one well-formed, one malformed bullet", () => {
  const root = repository();
  const target = writeMap(root);
  let text = fs.readFileSync(target, "utf8");
  text = text.replace(
    "- UNVERIFIED: feature flags and kill switches require Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER --> <!-- CTIDE:TRUST:unverified -->",
    "- flag-a — disables the A worker — flip via scripts/toggle-a.sh (verified: 2026-07-01) <!-- CTIDE:TRUST:verified:2026-07-01 -->\n"
      + "- flag-b — disables the B worker — flip via scripts/toggle-b.sh (verified: whenever it last ran) <!-- CTIDE:TRUST:verified -->",
  );
  fs.writeFileSync(target, text, "utf8");
  const report = verifyMap(root);
  assert.ok(
    report.findings.some(finding => finding.includes("malformed trust marker: Feature flags & kill switches")),
    "a malformed tag on one bullet must still be flagged even though a different bullet in the same field carries a well-formed tag: " + report.findings.join("\n"),
  );
});

test("Map verify evaluates two tags on the SAME line independently -- a well-formed tag must never mask a separately malformed tag (the tag-based analogue of round 4's dual-marker gap)", () => {
  // Round 4's isMalformed ran two whole-string .test() calls, so a well-formed marker anywhere in a
  // line/field cleared the whole scan even when a distinct, genuinely malformed marker also existed on
  // that same line. The new mechanism validates each MATCHED TAG independently (via .some() over every
  // tag found), so this must not recur: a line carrying both a well-formed tag and a malformed tag
  // (e.g. a stray leftover from a prior draft) must still surface the malformed one.
  const root = repository();
  const target = writeMap(root);
  let text = fs.readFileSync(target, "utf8");
  text = text.replace(
    "- UNVERIFIED: rollback steps, schema-migration history, and new-format data require Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER --> <!-- CTIDE:TRUST:unverified -->",
    "- Exact steps: run scripts/rollback.sh (verified: 2026-07-01) <!-- CTIDE:TRUST:verified:2026-07-01 --> <!-- CTIDE:TRUST:verified -->",
  );
  fs.writeFileSync(target, text, "utf8");
  const report = verifyMap(root);
  assert.ok(
    report.findings.some(finding => finding.includes("malformed trust marker: Rollback")),
    "a well-formed tag on the same line must never mask a separately malformed tag also present on that line: " + report.findings.join("\n"),
  );
});

test("Map verify judges a fully and correctly enriched Rollback field and Feature flags & kill switches field as neither placeholder nor malformed", () => {
  const root = repository();
  const target = writeMap(root);
  let text = fs.readFileSync(target, "utf8");
  // Rollback's "Exact steps:" line carries a fully well-formed marker AND its own CTIDE:TRUST tag, AND
  // an unrelated, template-legitimate bullet ("Schema migrations...") happens to contain the prose word
  // "verified:" with no tag at all. The field must be judged BOTH not-still-placeholder (the core
  // skeleton sentence is gone) AND not-malformed (the well-formed tag passes, and the unrelated bullet
  // is never scanned at all because it carries no CTIDE:TRUST-shaped comment) -- confirming the
  // placeholder-detection and tag-based malformed-marker checks compose without either false-flagging
  // what the other correctly clears.
  text = text.replace(
    "- UNVERIFIED: rollback steps, schema-migration history, and new-format data require Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER --> <!-- CTIDE:TRUST:unverified -->",
    "- Exact steps: run scripts/rollback.sh (verified: 2026-07-01) <!-- CTIDE:TRUST:verified:2026-07-01 -->\n"
      + "- Schema migrations in recent deploys: yes, verified: with the DBA team during the release review\n"
      + "- New-format data: none",
  );
  // Feature flags & kill switches gets one genuinely well-formed, tagged flag bullet -- confirming the
  // tag-based scan also composes correctly with the placeholder-detection fix.
  text = text.replace(
    "- UNVERIFIED: feature flags and kill switches require Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER --> <!-- CTIDE:TRUST:unverified -->",
    "- fixture-flag — disables the fixture worker — flip via scripts/toggle.sh (verified: 2026-07-01) <!-- CTIDE:TRUST:verified:2026-07-01 -->",
  );
  fs.writeFileSync(target, text, "utf8");
  const report = verifyMap(root);
  assert.ok(
    !report.findings.some(finding => finding.includes("Rollback")),
    "a fully and correctly enriched Rollback field (well-formed tag plus an unrelated bullet mentioning \"verified:\" prose with no tag) must produce zero findings: " + report.findings.join("\n"),
  );
  assert.ok(
    !report.findings.some(finding => finding.includes("Feature flags & kill switches")),
    "a fully and correctly enriched Feature flags & kill switches field (one well-formed, tagged flag bullet) must produce zero findings: " + report.findings.join("\n"),
  );
});

test("Map verify reports a missing trust tag when Rollback is enriched with real content but no CTIDE:TRUST tag is added at all", () => {
  const root = repository();
  const target = writeMap(root);
  let text = fs.readFileSync(target, "utf8");
  // The single most realistic partial edit (arbiter's exact repro): follow the rendered, documented
  // "verified: <date>" prose convention and never notice the separate, invisible tag also needs setting
  // -- nothing in the rendered file prompts for it. Before this fix, this produced NO finding at all for
  // Rollback: not missing, not unenriched, not malformed.
  text = text.replace(
    "- UNVERIFIED: rollback steps, schema-migration history, and new-format data require Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER --> <!-- CTIDE:TRUST:unverified -->",
    "- Exact steps: run scripts/rollback.sh (verified: 2026-07-01)",
  );
  fs.writeFileSync(target, text, "utf8");
  const report = verifyMap(root);
  assert.ok(
    report.findings.some(finding => finding.includes("missing trust tag: Rollback")),
    "an enriched Rollback field with no CTIDE:TRUST tag at all must be flagged, not pass silently: " + report.findings.join("\n"),
  );
  assert.ok(
    !report.findings.some(finding => finding.includes("unenriched ops-profile field: Rollback")),
    "a genuinely enriched field (the core placeholder sentence is gone) must not also be reported as still-placeholder: " + report.findings.join("\n"),
  );
});

test("Map verify reports a missing trust tag when Feature flags & kill switches is enriched with real content but no CTIDE:TRUST tag is added at all", () => {
  const root = repository();
  const target = writeMap(root);
  let text = fs.readFileSync(target, "utf8");
  text = text.replace(
    "- UNVERIFIED: feature flags and kill switches require Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER --> <!-- CTIDE:TRUST:unverified -->",
    "- fixture-flag — disables the fixture worker — flip via scripts/toggle.sh (verified: 2026-07-01)",
  );
  fs.writeFileSync(target, text, "utf8");
  const report = verifyMap(root);
  assert.ok(
    report.findings.some(finding => finding.includes("missing trust tag: Feature flags & kill switches")),
    "an enriched Feature flags & kill switches field with no CTIDE:TRUST tag at all must be flagged, not pass silently: " + report.findings.join("\n"),
  );
});

test("Map verify reports a missing trust tag when an Access inventory row is enriched with real content but no CTIDE:TRUST tag is added at all", () => {
  const root = repository();
  const target = writeMap(root);
  let text = fs.readFileSync(target, "utf8");
  text = text.replace(
    "| UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED <!-- CTIDE:TRUST:unverified --> |\nUNVERIFIED: access inventory entries require Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER -->",
    "| App logs | fixture log path | agent-runnable | verified: 2026-07-01 |",
  );
  fs.writeFileSync(target, text, "utf8");
  const report = verifyMap(root);
  assert.ok(
    report.findings.some(finding => finding.includes("missing trust tag: Access inventory")),
    "an enriched Access inventory row with no CTIDE:TRUST tag at all must be flagged, not pass silently: " + report.findings.join("\n"),
  );
});

test("Map verify treats a mis-cased CTIDE:TRUST tag the same as an entirely absent tag (case-sensitive match finds zero attempts)", () => {
  // OPS_TRUST_TAG_ATTEMPT has no /i flag and requires the literal-cased "CTIDE:TRUST:" prefix, so a
  // syntactically tag-shaped comment with the wrong case matches zero attempts -- confirmed empirically
  // against the regex before writing this test, not assumed -- and must therefore be treated the same as
  // omission, not silently pass.
  const root = repository();
  const target = writeMap(root);
  let text = fs.readFileSync(target, "utf8");
  text = text.replace(
    "- UNVERIFIED: rollback steps, schema-migration history, and new-format data require Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER --> <!-- CTIDE:TRUST:unverified -->",
    "- Exact steps: run scripts/rollback.sh (verified: 2026-07-01) <!-- ctide:trust:verified:2026-07-01 -->",
  );
  fs.writeFileSync(target, text, "utf8");
  const report = verifyMap(root);
  assert.ok(
    report.findings.some(finding => finding.includes("missing trust tag: Rollback")),
    "a mis-cased tag prefix must be treated as zero tags found, not silently pass: " + report.findings.join("\n"),
  );
});

test("Map verify accepts a CTIDE:TRUST tag with whitespace after the tier colon, mirroring the adjacent human prose convention", () => {
  // "verified: <date>" (space after the colon) is exactly how the adjacent human-readable prose on the
  // same line is conventionally written; a good-faith author may format the tag identically. Before this
  // fix, OPS_TRUST_TAG_WELLFORMED required the date to start immediately after the tier's colon with no
  // whitespace, so this plausible authoring habit was flagged malformed -- a false positive (fails safe,
  // but still wrong).
  const root = repository();
  const target = writeMap(root);
  let text = fs.readFileSync(target, "utf8");
  text = text.replace(
    "- UNVERIFIED: rollback steps, schema-migration history, and new-format data require Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER --> <!-- CTIDE:TRUST:unverified -->",
    "- Exact steps: run scripts/rollback.sh (verified: 2026-07-01) <!-- CTIDE:TRUST:verified: 2026-07-01 -->",
  );
  fs.writeFileSync(target, text, "utf8");
  const report = verifyMap(root);
  assert.ok(
    !report.findings.some(finding => finding.includes("malformed trust marker: Rollback")),
    "a tag with a space after the tier colon (mirroring the human prose convention) must not be flagged malformed: " + report.findings.join("\n"),
  );
  assert.ok(
    !report.findings.some(finding => finding.includes("missing trust tag: Rollback")),
    "the tag is present (just with extra whitespace), so it must not be treated as missing either: " + report.findings.join("\n"),
  );
});

test("Map verify still detects Access inventory's table placeholder row when only the trailing note is removed", () => {
  const root = repository();
  const target = writeMap(root);
  let text = fs.readFileSync(target, "utf8");
  // Remove ONLY the trailing heuristic-placeholder note line; leave the table's own
  // "| UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED |" row completely untouched -- this is the
  // exact defeat the arbiter reproduced (M2): the marker comment alone is not sufficient to detect an
  // unenriched Access inventory field.
  text = text.replace(
    "UNVERIFIED: access inventory entries require Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER -->",
    "See the deploy runbook for the full access list.",
  );
  fs.writeFileSync(target, text, "utf8");
  const report = verifyMap(root);
  assert.ok(
    report.findings.some(finding => finding.includes("unenriched ops-profile field: Access inventory")),
    "a table row that is still entirely UNVERIFIED must still be reported as unenriched even without the marker comment: " + report.findings.join("\n"),
  );
});

test("Map verify detects a backtick-wrapped Access inventory placeholder row", () => {
  const root = repository();
  const target = writeMap(root);
  let text = fs.readFileSync(target, "utf8");
  // Reformat the placeholder row with backtick-wrapped cells (a legitimate markdown styling choice
  // used elsewhere in this repo, e.g. examples/SYSTEM_MAP.md's other tables) while also removing the
  // trailing marker note -- the backtick-restyled variant of the bare-UNVERIFIED table-row defeat.
  text = text.replace(
    "| UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED <!-- CTIDE:TRUST:unverified --> |\nUNVERIFIED: access inventory entries require Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER -->",
    "| `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` <!-- CTIDE:TRUST:unverified --> |\nSee the deploy runbook for the full access list.",
  );
  fs.writeFileSync(target, text, "utf8");
  const report = verifyMap(root);
  assert.ok(
    report.findings.some(finding => finding.includes("unenriched ops-profile field: Access inventory")),
    "a backtick-wrapped table row that is still entirely UNVERIFIED must still be reported as unenriched: " + report.findings.join("\n"),
  );
});

test("Map verify detects an Access inventory row where only some non-Trust cells remain placeholder", () => {
  const root = repository();
  const target = writeMap(root);
  let text = fs.readFileSync(target, "utf8");
  // A row where What/Where are genuinely filled in but Runnable-by is still the literal placeholder
  // value (Trust honestly reads UNVERIFIED, and the trailing marker note is removed) used to be
  // invisible to the "every cell reads UNVERIFIED" check -- the row must still count as unenriched
  // because a non-Trust cell (the only columns where UNVERIFIED can never be a legitimate final value)
  // still reads UNVERIFIED.
  text = text.replace(
    "| UNVERIFIED | UNVERIFIED | UNVERIFIED | UNVERIFIED <!-- CTIDE:TRUST:unverified --> |\nUNVERIFIED: access inventory entries require Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER -->",
    "| App logs | fixture log path | UNVERIFIED | UNVERIFIED <!-- CTIDE:TRUST:unverified --> |\nSee the deploy runbook for the full access list.",
  );
  fs.writeFileSync(target, text, "utf8");
  const report = verifyMap(root);
  assert.ok(
    report.findings.some(finding => finding.includes("unenriched ops-profile field: Access inventory")),
    "a row with real What/Where content but a still-placeholder Runnable-by cell must still be reported as unenriched: " + report.findings.join("\n"),
  );
});

test("Map verify does not attribute swallowed Manual Notes prose to the Approvals map field", () => {
  const root = repository();
  const target = writeMap(root);
  let text = fs.readFileSync(target, "utf8");
  const defaultManualBody = [
    "## Human-verified operational knowledge",
    "",
    "> This bounded section is preserved verbatim by refresh. Humans may record verified operational facts with current Sources; Cartographer must surface conflicts rather than overwrite them.",
    "",
    "No human-verified operational notes recorded.",
  ].join("\n");
  assert.ok(text.includes(defaultManualBody), "fixture must contain the default Manual Notes body");
  // A human recording notes without a leading "## " heading -- exactly what the Manual Notes section
  // invites ("Humans may record verified operational facts") -- must not have that prose silently
  // swallowed into the last Ops Profile field's ("Approvals map") block (M1). The swallowed prose
  // deliberately carries a MALFORMED CTIDE:TRUST tag (not just the prose word "verified:") so this test
  // stays genuinely discriminating for the sliceSection boundary fix under the tag-based mechanism: bare
  // "verified:" prose would never be flagged regardless of correct bounding (no tag = nothing to find),
  // so it alone could no longer prove the boundary holds; a malformed TAG would be found and misattributed
  // if the boundary regressed and swallowed this text into Approvals map's scanned block.
  text = text.replace(defaultManualBody, "We rotated the on-call rotation last sprint <!-- CTIDE:TRUST:verified --> it works now. No further notes.");
  fs.writeFileSync(target, text, "utf8");
  const report = verifyMap(root);
  assert.ok(
    !report.findings.some(finding => finding.includes("malformed trust marker: Approvals map")),
    "a malformed tag swallowed from Manual Notes must not be attributed to Approvals map: " + report.findings.join("\n"),
  );
  assert.ok(
    report.findings.some(finding => finding.includes("unenriched ops-profile field: Approvals map")),
    "a genuinely still-placeholder Approvals map field must still be reported as unenriched: " + report.findings.join("\n"),
  );
});

test("Map refresh regenerates the Ops Profile block to its heuristic baseline like the canonical sections", () => {
  const root = repository();
  const target = writeMap(root);
  let text = fs.readFileSync(target, "utf8");
  text = text.replace(
    "- UNVERIFIED: rollback steps, schema-migration history, and new-format data require Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER --> <!-- CTIDE:TRUST:unverified -->",
    "- Exact steps: run scripts/rollback.sh (verified: 2026-07-01) <!-- CTIDE:TRUST:verified:2026-07-01 -->",
  );
  fs.writeFileSync(target, text, "utf8");
  const enriched = fs.readFileSync(target, "utf8");
  assert.match(enriched, /Exact steps: run scripts\/rollback\.sh \(verified: 2026-07-01\) <!-- CTIDE:TRUST:verified:2026-07-01 --\>/);

  writeMap(root, { overwrite: true });
  const refreshed = fs.readFileSync(target, "utf8");
  assert.doesNotMatch(
    refreshed,
    /Exact steps: run scripts\/rollback\.sh \(verified: 2026-07-01\) <!-- CTIDE:TRUST:verified:2026-07-01 --\>/,
    "refresh must not preserve Ops Profile enrichment (including its trust tag), matching the canonical sections' regenerate-then-reenrich contract",
  );
  assert.match(
    refreshed,
    /UNVERIFIED: rollback steps, schema-migration history, and new-format data require Cartographer confirmation\. <!-- CTIDE:HEURISTIC-PLACEHOLDER --> <!-- CTIDE:TRUST:unverified --\>/,
    "refresh must regenerate the Rollback field back to its heuristic baseline, including a fresh <!-- CTIDE:TRUST:unverified --> tag",
  );
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
