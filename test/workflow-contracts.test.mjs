import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { root } from "./helpers.mjs";
// This file is otherwise a documentation-contract suite over carrier text. These two PUBLIC exports
// are imported for one purpose: the established-empty TP path asserts that a `results: []` batch is
// actually ACCEPTED, and only the loop's own ingestion can establish that. Pinning it in prose alone
// would restate the claim rather than test it. No production file is modified to make this possible.
import { computeInventoryV2Digest } from "../cressetide/skills/vigil/scripts/changed-test-inventory.mjs";
import { ingestInputs } from "../cressetide/skills/vigil/scripts/test-provenance-loop-review.mjs";

const skill = name => fs.readFileSync(path.join(root, "cressetide", "skills", name, "SKILL.md"), "utf8");

const pinnedSetupNodeUse = /^[ \t]*(?:-[ \t]+)?uses:[ \t]*actions\/setup-node@[0-9a-f]{40}[ \t]*(?:#.*)?$/;

function assertReleaseSetupNodeCacheContract(workflow) {
  const lines = workflow.split(/\r?\n/);
  const setupNodeLineIndexes = lines.flatMap((line, index) => pinnedSetupNodeUse.test(line) ? [index] : []);

  assert.equal(
    setupNodeLineIndexes.length,
    2,
    "release workflow must contain exactly two pinned setup-node steps",
  );
  for (const lineIndex of setupNodeLineIndexes) {
    const usesLine = lines[lineIndex];
    const usesIndent = usesLine.match(/^[ \t]*/)[0].length;
    const stepIndent = usesLine.trimStart().startsWith("- ") ? usesIndent : Math.max(0, usesIndent - 2);
    let stepEnd = lines.length;
    for (let index = lineIndex + 1; index < lines.length; index += 1) {
      const content = lines[index].trimStart();
      const indent = lines[index].length - content.length;
      if (content && (indent < stepIndent || (indent === stepIndent && content.startsWith("- ")))) {
        stepEnd = index;
        break;
      }
    }

    const step = lines.slice(lineIndex, stepEnd);
    const withMappings = step.flatMap((line, index) => {
      const content = line.trimStart();
      return content === "with:" ? [{ index, indent: line.length - content.length }] : [];
    });
    assert.deepEqual(
      withMappings.map(({ indent }) => indent),
      [stepIndent + 2],
      `setup-node step at line ${lineIndex + 1} must contain exactly one correctly indented with mapping`,
    );

    const withIndent = stepIndent + 2;
    let withEnd = step.length;
    for (let index = withMappings[0].index + 1; index < step.length; index += 1) {
      const content = step[index].trimStart();
      const indent = step[index].length - content.length;
      if (content && indent <= withIndent) {
        withEnd = index;
        break;
      }
    }

    const cacheKeys = step.filter((line) => /^[ \t]*package-manager-cache:[ \t]*/.test(line));
    assert.equal(cacheKeys.length, 1, `setup-node step at line ${lineIndex + 1} must contain exactly one package-manager-cache input`);
    const cacheInputs = step
      .slice(withMappings[0].index + 1, withEnd)
      .filter((line) => line.length - line.trimStart().length === withIndent + 2)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("package-manager-cache:"));
    assert.deepEqual(
      cacheInputs,
      ["package-manager-cache: false"],
      `setup-node step at line ${lineIndex + 1} must contain exactly one package-manager-cache: false child under with`,
    );
  }
}

function assertReleaseAttestContract(workflow) {
  const lines = workflow.split(/\r?\n/);
  const attestStart = lines.findIndex((line) => line === "  attest:");
  assert.notEqual(attestStart, -1, "release workflow must contain the attest job");
  const nextJobOffset = lines
    .slice(attestStart + 1)
    .findIndex((line) => /^ {2}[A-Za-z_][A-Za-z0-9_-]*:[ \t]*(?:#.*)?$/.test(line));
  const attestEnd = nextJobOffset === -1 ? lines.length : attestStart + 1 + nextJobOffset;
  const attestLines = lines.slice(attestStart, attestEnd);
  const attestJob = attestLines.join("\n");

  const downloadStart = attestLines.findIndex((line) => line === "      - name: Download exact published archive for provenance");
  assert.notEqual(downloadStart, -1, "attest job must contain the exact-archive download step");
  const nextStepOffset = attestLines.slice(downloadStart + 1).findIndex((line) => /^ {6}-[ \t]+/.test(line));
  const downloadEnd = nextStepOffset === -1 ? attestLines.length : downloadStart + 1 + nextStepOffset;
  const downloadStep = attestLines.slice(downloadStart, downloadEnd);
  const runIndexes = downloadStep.flatMap((line, index) => line === "        run: |" ? [index] : []);
  assert.equal(runIndexes.length, 1, "attest download step must contain exactly one run block");
  const scriptLines = downloadStep.slice(runIndexes[0] + 1);
  assert.ok(
    scriptLines.every((line) => !line.trim() || line.length - line.trimStart().length >= 10),
    "attest download run block must contain only script content",
  );
  const activeCommands = scriptLines
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  assert.deepEqual(
    activeCommands,
    [
      'ASSET_NAME="ctide-${RELEASE_TAG}-plugin.tar.gz"',
      "mkdir -p _attest",
      'gh release download "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --pattern "$ASSET_NAME" --dir _attest',
    ],
    "attest download step must contain exactly one repository-explicit gh release download command in the exact active command allowlist",
  );
  const activeAttestText = attestLines
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .join("\n");
  assert.doesNotMatch(activeAttestText, /actions\/checkout@/i, "attest job must not use actions/checkout");
  assert.doesNotMatch(activeAttestText, /\*[A-Za-z_][A-Za-z0-9_-]*/, "attest job must not use YAML aliases");

  const permissionsIndexes = attestLines.flatMap((line, index) => line === "    permissions:" ? [index] : []);
  assert.equal(permissionsIndexes.length, 1, "attest job must contain exactly one permissions mapping");
  const permissionsStart = permissionsIndexes[0];
  let permissionsEnd = attestLines.length;
  for (let index = permissionsStart + 1; index < attestLines.length; index += 1) {
    const content = attestLines[index].trimStart();
    const indent = attestLines[index].length - content.length;
    if (content && indent <= 4) {
      permissionsEnd = index;
      break;
    }
  }

  const permissions = attestLines
    .slice(permissionsStart + 1, permissionsEnd)
    .filter((line) => {
      const content = line.trimStart();
      return content && !content.startsWith("#") && line.length - content.length === 6;
    })
    .map((line) => {
      const match = line.match(/^ {6}([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(\S+)[ \t]*$/);
      assert.ok(match, `invalid direct attest permission entry: ${line.trim()}`);
      return [match[1], match[2]];
    })
    .sort(([left], [right]) => left.localeCompare(right));
  assert.deepEqual(
    permissions,
    [["attestations", "write"], ["contents", "read"], ["id-token", "write"]],
    "attest job permissions must exactly match the least-privilege contract",
  );
}

test("Vigil grounds on Map without treating it as authority", () => {
  const text = skill("vigil");
  assert.match(text, /\.ctide\/map\/SYSTEM_MAP\.md/);
  assert.match(text, /not authority|not an authority/i);
  assert.match(text, /lean repository reconnaissance/);
  assert.match(text, /human approval/i);
  assert.match(text, /repair/i);
});

test("Salvage uses Map but continues with rapid recon when it is absent or stale", () => {
  const text = skill("salvage");
  assert.match(text, /\.ctide\/map\/SYSTEM_MAP\.md/);
  assert.match(text, /absent or stale/);
  assert.match(text, /rapid recon/);
  assert.match(text, /Route formal repairs through `\/ctide:vigil`/);
});

test("Map and Doctor are manual-only while Vigil and Salvage remain model-eligible", () => {
  for (const name of ["map", "doctor"]) assert.match(skill(name), /^disable-model-invocation:\s*true$/m);
  for (const name of ["vigil", "salvage"]) assert.doesNotMatch(skill(name), /^disable-model-invocation:/m);
});

test("Vigil reference graph covers contract, verification, review, and verdict", () => {
  const directory = path.join(root, "cressetide", "skills", "vigil", "references");
  for (const name of ["task-contract.md", "verification-gate.md", "reviewer-selection.md", "review-packet.md", "final-report.md"]) {
    assert.ok(fs.existsSync(path.join(directory, name)), name);
    assert.match(skill("vigil"), new RegExp(name.replace(".", "\\.")));
  }
});

test("Map operational readiness links to the actual Salvage closure contract", () => {
  const file = path.join(root, "cressetide", "skills", "map", "references", "operational-readiness.md");
  const text = fs.readFileSync(file, "utf8");
  const relative = (text.match(/`([^`]*salvage\/references\/reentry-and-closure\.md)`/) || [])[1];
  assert.equal(relative, "../../salvage/references/reentry-and-closure.md");
  assert.ok(fs.existsSync(path.resolve(path.dirname(file), relative)));
});

test("Map operational readiness template no longer duplicates System overview as its own Ops Profile heading", () => {
  const file = path.join(root, "cressetide", "skills", "map", "references", "operational-readiness.md");
  const text = fs.readFileSync(file, "utf8");
  assert.doesNotMatch(text, /^## System overview$/m, "the old Ops-Profile-only System overview heading must be removed");
  assert.doesNotMatch(text, /- Entry points: <public URLs \/ APIs \/ scheduled jobs>/, "the old System overview bullets must be removed");
  assert.doesNotMatch(text, /- Components: <service .* role, one line each>/, "the old System overview bullets must be removed");
  assert.match(text, /System overview/, "a pointer to the canonical System overview section must remain");
  assert.match(text, /SYSTEM_MAP\.md/i);
});

test("Salvage wartime and public READMEs resolve preparation to Map instead of the retired ops owner", () => {
  const wartimeFile = path.join(root, "cressetide", "skills", "salvage", "references", "wartime.md");
  const wartime = fs.readFileSync(wartimeFile, "utf8");
  const relative = (wartime.match(/`([^`]*map\/references\/operational-readiness\.md)`/) || [])[1];
  assert.equal(relative, "../../map/references/operational-readiness.md");
  assert.ok(fs.existsSync(path.resolve(path.dirname(wartimeFile), relative)));

  for (const name of ["README.md", "README.zh-TW.md", "README.ja.md"]) {
    const readme = fs.readFileSync(path.join(root, name), "utf8");
    assert.match(readme, /^  map\/\s+# SYSTEM_MAP\.md/m, name);
    assert.doesNotMatch(readme, /^  ops\//m, name);
    assert.match(readme, /cressetide\/skills\/map\/references\/operational-readiness\.md/, name);
  }
});

test("Salvage wartime cites the Map's canonical sections for blast radius, intrusion, and diagnose triage", () => {
  const wartimeFile = path.join(root, "cressetide", "skills", "salvage", "references", "wartime.md");
  const wartime = fs.readFileSync(wartimeFile, "utf8");

  const blastRadius = (wartime.match(/\*\*Blast radius\.\*\*.*/) || [])[0] || "";
  assert.match(blastRadius, /Architecture boundaries/, "Blast radius must cite Architecture boundaries");
  assert.match(blastRadius, /Execution flows/, "Blast radius must cite Execution flows");

  const securityBranch = (wartime.match(/\*\*The security branch\.\*\*.*/) || [])[0] || "";
  assert.match(securityBranch, /Data flows/, "the intrusion question must cite Data flows");
  assert.match(securityBranch, /Trust boundary/, "the intrusion question must cite the Trust boundary column");

  const diagnoseOpening = (wartime.match(/Root-cause work happens AFTER the system is stable.*/) || [])[0] || "";
  assert.match(diagnoseOpening, /Risk and uncertainty/, "the Stage 4 diagnose opening must cite Risk and uncertainty");
});

test("runtime contract distinguishes credential-safe summaries from opt-in raw hook debug", () => {
  const runtime = fs.readFileSync(path.join(root, "docs", "runtime-contract.md"), "utf8");
  assert.match(runtime, /Doctor and release diagnostic summaries must not expose/);
  assert.match(runtime, /any non-empty value; only an unset or empty value disables/);
  assert.match(runtime, /hook debug sink is separately opt-in and may include a bounded\s+raw command fragment/);
  assert.match(runtime, /do not enable or collect `CTIDE_HOOK_DEBUG` where commands\s+may contain credentials/);
});

test("branch-scoped validation workflows all run on the Cressetide main line", () => {
  for (const name of ["validate.yml", "typos.yml", "zizmor.yml"]) {
    const workflow = fs.readFileSync(path.join(root, ".github", "workflows", name), "utf8");
    assert.match(workflow, /push:\s*\r?\n\s+branches: \[main\]/, name);
    assert.doesNotMatch(workflow, /branches: \[master\]/, name);
  }
});

test("release setup-node steps disable automatic package-manager caching", () => {
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "release.yml"), "utf8");
  assertReleaseSetupNodeCacheContract(workflow);
});

test("release setup-node contract rejects a named third pinned setup-node step", () => {
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "release.yml"), "utf8");
  const marker = "      - name: Verify explicit tag identity";
  const mutant = workflow.replace(marker, [
    "      - name: Mutant setup-node",
    "        uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0",
    "        with:",
    "          node-version: 22",
    "          package-manager-cache: true",
    marker,
  ].join("\n"));

  assert.notEqual(mutant, workflow, "mutant insertion marker must exist");
  assert.throws(
    () => assertReleaseSetupNodeCacheContract(mutant),
    /release workflow must contain exactly two pinned setup-node steps/,
  );
});

test("release setup-node contract rejects a cache input misplaced at step level", () => {
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "release.yml"), "utf8");
  const mutant = workflow.replace(
    "          package-manager-cache: false",
    "        package-manager-cache: false",
  );
  const setupNodeCount = (text) => text.split(/\r?\n/).filter((line) => pinnedSetupNodeUse.test(line)).length;

  assert.notEqual(mutant, workflow, "cache-input indentation mutant must be applied");
  assert.equal(setupNodeCount(mutant), setupNodeCount(workflow), "mutant must preserve the pinned setup-node count");
  assert.equal(setupNodeCount(mutant), 2);
  assert.throws(
    () => assertReleaseSetupNodeCacheContract(mutant),
    /must contain exactly one package-manager-cache: false child under with/,
  );
});

test("release attest download is repository-explicit without checkout or broader permissions", () => {
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "release.yml"), "utf8");
  assertReleaseAttestContract(workflow);
});

test("release attest contract rejects an extra direct permission", () => {
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "release.yml"), "utf8");
  const marker = "      attestations: write";
  const mutant = workflow.replace(marker, `${marker}\n      packages: write`);

  assert.notEqual(mutant, workflow, "extra-permission mutant must be applied");
  assert.throws(
    () => assertReleaseAttestContract(mutant),
    /attest job permissions must exactly match the least-privilege contract/,
  );
});

test("release attest contract rejects a duplicate implicit-repository download command", () => {
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "release.yml"), "utf8");
  const fixedCommand = '          gh release download "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --pattern "$ASSET_NAME" --dir _attest';
  const oldCommand = '          gh release download "$RELEASE_TAG" --pattern "$ASSET_NAME" --dir _attest';
  const mutant = workflow.replace(fixedCommand, `${oldCommand}\n${fixedCommand}`);

  assert.notEqual(mutant, workflow, "duplicate-old-command mutant must be applied");
  assert.throws(
    () => assertReleaseAttestContract(mutant),
    /must contain exactly one repository-explicit gh release download command/,
  );
});

test("release attest contract rejects a comment-shadowed repository-explicit command", () => {
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "release.yml"), "utf8");
  const fixedCommand = '          gh release download "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --pattern "$ASSET_NAME" --dir _attest';
  const oldCommand = '          gh release download "$RELEASE_TAG" --pattern "$ASSET_NAME" --dir _attest';
  const mutant = workflow.replace(fixedCommand, `          # ${fixedCommand.trim()}\n${oldCommand}`);

  assert.notEqual(mutant, workflow, "comment-shadow mutant must be applied");
  assert.throws(
    () => assertReleaseAttestContract(mutant),
    /must contain exactly one repository-explicit gh release download command/,
  );
});

test("release attest contract rejects a deeper-indented implicit-repository download command", () => {
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "release.yml"), "utf8");
  const fixedCommand = '          gh release download "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --pattern "$ASSET_NAME" --dir _attest';
  const oldCommand = '            gh release download "$RELEASE_TAG" --pattern "$ASSET_NAME" --dir _attest';
  const mutant = workflow.replace(fixedCommand, `${oldCommand}\n${fixedCommand}`);

  assert.notEqual(mutant, workflow, "deeper-indented-old-command mutant must be applied");
  assert.throws(
    () => assertReleaseAttestContract(mutant),
    /must contain exactly one repository-explicit gh release download command/,
  );
});

test("release attest contract rejects a command-wrapped implicit-repository download", () => {
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "release.yml"), "utf8");
  const fixedCommand = '          gh release download "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --pattern "$ASSET_NAME" --dir _attest';
  const wrappedOldCommand = '          command gh release download "$RELEASE_TAG" --pattern "$ASSET_NAME" --dir _attest';
  const mutant = workflow.replace(fixedCommand, `${wrappedOldCommand}\n${fixedCommand}`);

  assert.notEqual(mutant, workflow, "command-wrapped-old mutant must be applied");
  assert.throws(
    () => assertReleaseAttestContract(mutant),
    /must contain exactly one repository-explicit gh release download command/,
  );
});

test("release attest contract rejects checkout with valid YAML spacing", () => {
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "release.yml"), "utf8");
  const marker = "    steps:\n      - name: Download exact published archive for provenance";
  const mutant = workflow.replace(marker, [
    "    steps:",
    "      - name: Mutant checkout",
    "        uses:  actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0",
    "      - name: Download exact published archive for provenance",
  ].join("\n"));

  assert.notEqual(mutant, workflow, "double-space-checkout mutant must be applied");
  assert.throws(
    () => assertReleaseAttestContract(mutant),
    /attest job must not use actions\/checkout/,
  );
});

test("release attest contract rejects shorthand checkout steps", () => {
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "release.yml"), "utf8");
  const marker = "    steps:\n      - name: Download exact published archive for provenance";
  const mutant = workflow.replace(marker, [
    "    steps:",
    "      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0",
    "      - name: Download exact published archive for provenance",
  ].join("\n"));

  assert.notEqual(mutant, workflow, "shorthand-checkout mutant must be applied");
  assert.throws(
    () => assertReleaseAttestContract(mutant),
    /attest job must not use actions\/checkout/,
  );
});

test("release attest contract rejects flow-mapping checkout steps", () => {
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "release.yml"), "utf8");
  const marker = "    steps:\n      - name: Download exact published archive for provenance";
  const mutant = workflow.replace(marker, [
    "    steps:",
    "      - { uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 }",
    "      - name: Download exact published archive for provenance",
  ].join("\n"));

  assert.notEqual(mutant, workflow, "flow-mapping-checkout mutant must be applied");
  assert.throws(
    () => assertReleaseAttestContract(mutant),
    /attest job must not use actions\/checkout/,
  );
});

test("release attest contract rejects cross-job anchored checkout aliases", () => {
  const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "release.yml"), "utf8");
  const checkoutStep = "      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0";
  const anchoredCheckoutStep = [
    "      - &checkout_step",
    "        uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0",
  ].join("\n");
  const downloadMarker = "    steps:\n      - name: Download exact published archive for provenance";
  const mutant = workflow
    .replace(checkoutStep, anchoredCheckoutStep)
    .replace(downloadMarker, "    steps:\n      - *checkout_step\n      - name: Download exact published archive for provenance");

  assert.notEqual(mutant, workflow, "cross-job-checkout-alias mutant must be applied");
  assert.match(mutant, /&checkout_step/);
  assert.throws(
    () => assertReleaseAttestContract(mutant),
    /attest job must not use YAML aliases/,
  );
});

// --- D11 Release 1: the mandatory test-reviewer boundary and the exact-batch transport -------------
//
// Structure carries these contracts, not wording: assertions are scoped to a `##` section or to the
// blank-line paragraph that actually grants a permission, so relocating a clause fails. Every checker
// is a pure function over in-memory carrier text, which is how the mutants below exercise it without
// touching a file on disk.

const reference = name =>
  fs.readFileSync(path.join(root, "cressetide", "skills", "vigil", "references", name), "utf8");
const agent = name => fs.readFileSync(path.join(root, "cressetide", "agents", name), "utf8");

function section(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex(line => line.trim() === `## ${heading}` || line.trim() === `### ${heading}`);
  assert.notEqual(start, -1, `missing section: ${heading}`);
  // A `###` section ends at the next heading of the same or higher level; a `##` one at the next `##`.
  const stop = lines[start].trim().startsWith("### ") ? /^#{2,3} / : /^## /;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (stop.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start, end).join("\n");
}

// A "statement unit" is a blank-line paragraph, except that a bullet list is split into its own
// bullets (with their continuation lines). These carriers write contiguous bullets with no blank line
// between them, so paragraph granularity alone would let a qualifier on one bullet satisfy a
// permission granted on a different one.
function statementUnits(markdown) {
  const units = [];
  for (const block of markdown.split(/\r?\n\s*\r?\n/)) {
    let current = null;
    for (const line of block.split(/\r?\n/)) {
      // A numbered list item starts its own unit too: these carriers write ordered sub-steps as
      // `1.` … `7.` inside a single bullet, and lumping them together would let one sub-step's
      // ownership wording satisfy an assertion about a different sub-step.
      if (/^\s*-\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
        if (current !== null) units.push(current);
        current = line;
      } else if (current !== null) {
        current += `\n${line}`;
      } else {
        current = line;
      }
    }
    if (current !== null) units.push(current);
  }
  return units;
}

const paragraphsWith = (markdown, re) => statementUnits(markdown).filter(unit => re.test(unit));

// Only the four files that GRANT or BOUND the fast lane. `review-packet.md` grants no permission and
// is covered by its own TP/persistence tests below.
const substitutionCarriers = () => ({
  "reviewer-selection.md": reference("reviewer-selection.md"),
  "test-reviewer.agent.md": agent("test-reviewer.agent.md"),
  "arbiter.agent.md": agent("arbiter.agent.md"),
  "vigil/SKILL.md": skill("vigil"),
});

// Statements that actually grant or bound the lane. The emphasis is optional on purpose: the carriers
// write this both bolded and plain, and the test must follow the documents rather than force them to
// be reshaped around a regex. Descriptive and escalation prose ("spawn the substituted reviewer",
// "the fast lane never applies here") is deliberately not matched.
const PERMISSION_MARKERS = [
  /may be \*{0,2}evidence-substituted/,
  /may arrive \*{0,2}evidence-substituted/,
  /may additionally substitute/,
  /expected to be \*{0,2}evidence-substituted/,
  /Substitution never applies/,
  /\*\*Exclusions:\*\*/,
];

// Emphasis and line wrapping must not be able to hide the exclusion, so a unit is normalized before
// matching: markdown emphasis / code marks dropped, whitespace collapsed, case folded.
const plain = unit => unit.replace(/[*`]/g, "").replace(/\s+/g, " ").toLowerCase();

// The qualification is now the TP-ACTIVE exclusion itself. A CLOSED LIST of canonical forms, not a
// proximity heuristic: these carriers mention TP-active runs for several unrelated reasons (packet
// build, sub-loop, gate), so a bare mention must not qualify a permission — and a regrant mutant then
// has exactly one phrase to remove. Every entry is a sentence one of the four carriers actually
// writes. The confirmed-non-empty rule is D11:1093's named SUBCASE and is checked separately below;
// it is deliberately NOT accepted here, because narrowing back to it is the phase15c defect.
const TP_EXCLUSION_FORMS = [
  "never on a tp-active run",
  "never substituted on a tp-active run",
  "never available on a tp-active run",
  "never eligible on a tp-active run",
  "mandatory on every tp-active run",
];

const statesTpExclusion = unit => TP_EXCLUSION_FORMS.some(form => plain(unit).includes(form));

function assertSubstitutionQualified(carriers) {
  const matchedPerCarrier = new Map(Object.keys(carriers).map(name => [name, 0]));
  for (const [name, text] of Object.entries(carriers)) {
    for (const marker of PERMISSION_MARKERS) {
      for (const paragraph of paragraphsWith(text, marker)) {
        matchedPerCarrier.set(name, matchedPerCarrier.get(name) + 1);
        assert.ok(
          statesTpExclusion(paragraph),
          `${name}: a permissive or bounding evidence-substitution statement must state the TP-active exclusion in its own statement unit — saw: ${plain(paragraph).slice(0, 180)}`,
        );
      }
    }
  }
  // Per-carrier, not a global floor: a carrier whose permission wording was deleted or rephrased out
  // of recognition would otherwise hide behind another carrier's matches.
  for (const [name, count] of matchedPerCarrier) {
    assert.ok(count >= 1, `${name}: expected at least one permission/bounding statement to be checked, saw ${count}`);
  }
}

test("D11 R2: every evidence-substitution permission carrier states the TP-active exclusion", () => {
  assertSubstitutionQualified(substitutionCarriers());
});

// Every canonical exclusion form, whatever emphasis the carrier wrapped it in.
const TP_EXCLUSION_RE = /never (?:on|substituted on|available on|eligible on) a TP-active run|mandatory on every TP-active run/gi;

// The two ways phase15c's defect could come back: a regrant of the established-empty fast lane, and a
// narrowing of the only exclusion back to D11's confirmed-non-empty subcase. Both leave the carrier
// with no TP-active exclusion, and both must fail in EVERY permission carrier.
const REGRESSIONS = {
  "regrant established-empty substitution": text =>
    text.replace(TP_EXCLUSION_RE, "available on an established-empty TP-active run"),
  "narrow the exclusion back to confirmed non-empty": text =>
    text.replace(TP_EXCLUSION_RE, "never when the current ChangedTestInventory is confirmed non-empty"),
};

for (const [what, mutate] of Object.entries(REGRESSIONS)) {
  test(`D11 R2: ${what} in ANY permission carrier fails the contract`, () => {
    for (const name of Object.keys(substitutionCarriers())) {
      const carriers = substitutionCarriers();
      const mutant = mutate(carriers[name]);
      assert.notEqual(mutant, carriers[name], `${name}: mutant must be applied`);
      carriers[name] = mutant;
      assert.throws(
        () => assertSubstitutionQualified(carriers),
        /must state the TP-active exclusion in its own statement unit/,
        `${name}: ${what} must fail`,
      );
    }
  });
}

test("D11: a carrier that loses ALL its permission wording is detected, not hidden by the others", () => {
  const carriers = substitutionCarriers();
  // Rephrase every marker out of recognition in one carrier; the others still match plenty.
  const mutant = carriers["test-reviewer.agent.md"].replace(/may be evidence-substituted/g, "is sometimes skipped");
  assert.notEqual(mutant, carriers["test-reviewer.agent.md"], "marker-removal mutant must be applied");
  carriers["test-reviewer.agent.md"] = mutant;
  assert.throws(
    () => assertSubstitutionQualified(carriers),
    /test-reviewer\.agent\.md: expected at least one permission\/bounding statement/,
    "a carrier contributing zero matches must fail rather than pass on the global count",
  );
});

function assertTpExclusionScoped(reviewerSelection) {
  const fastLane = section(reviewerSelection, "Evidence substitution (fast lane)");

  // The exclusion and its REASON live in ONE bullet. "TP-active is excluded" without the
  // reviewer-authorship ground is a rule with nothing under it, and the ground is exactly what
  // decides the established-empty case.
  const excluded = paragraphsWith(fastLane, /Every TP-active run is excluded/);
  assert.equal(excluded.length, 1, "exactly one bullet must own the TP-active exclusion and its reason");
  for (const required of [
    /D5\.2\/TP §8/, /reviewer-authored/, /`results: \[\]`/, /one-to-one coverage of an empty entry set/,
    /\*\*successfully produced, actually inspected, and empty\*\*/,
    /unestablished/, /red-required-check/, /never reaches the panel/,
  ]) {
    assert.match(excluded[0], required,
      "the TP-active exclusion must carry its authorship reason, the empty-batch consequence and the fail-closed path");
  }

  // D11:1093's named subcase survives as the traceability anchor, with governance-affected-only in
  // the SAME unit so a reader cannot conclude "no test files changed therefore empty".
  const subcase = paragraphsWith(fastLane, /confirmed non-empty/);
  assert.ok(subcase.length > 0, "the D11 confirmed-non-empty subcase must remain stated in this section");
  assert.ok(
    subcase.some(unit => /governance-affected/.test(unit)),
    "governance-affected-only must be named in the same statement unit as the confirmed-non-empty subcase",
  );

  // The general lane is preserved EXPLICITLY, and the exclusion is not widened onto it.
  const nonTp = paragraphsWith(fastLane, /non-TP run has no inventory precondition/);
  assert.equal(nonTp.length, 1, "a non-TP run must be stated to have no inventory precondition");
  assert.match(nonTp[0], /never withdraws the ordinary fast lane/, "the general fast lane must be preserved explicitly");
  assert.doesNotMatch(
    fastLane,
    /excluded on a non-TP run|non-TP runs? (?:is|are) (?:also |likewise )?excluded/,
    "the TP-active exclusion must not be widened onto non-TP work",
  );
}

test("D11 R2: the TP-active exclusion carries its reason and preserves the non-TP lane", () => {
  assertTpExclusionScoped(reference("reviewer-selection.md"));
});

test("D11 R2: dropping the reason, the D11 subcase, the carve-out, or widening onto non-TP fails", () => {
  const text = reference("reviewer-selection.md");
  // Each case names the assertion it must trip. A shared loose matcher would let a mutant pass this
  // test by throwing for some unrelated reason, which is the aggregate-scope weakness one level up.
  const cases = [
    ["authorship reason dropped",
      text.replace("D5.2/TP §8 require the batch bytes to be **reviewer-authored**", "the panel prefers a real reviewer"),
      /authorship reason, the empty-batch consequence and the fail-closed path/],
    ["empty-batch consequence dropped",
      text.replace("which returns a valid batch carrying `results: []`", "which reviews it"),
      /authorship reason, the empty-batch consequence and the fail-closed path/],
    ["D11 subcase dropped", text.replace(/confirmed non-empty/g, "sizeable"),
      /D11 confirmed-non-empty subcase must remain stated/],
    ["non-TP carve-out deleted",
      text.replace(/non-TP run has no inventory precondition/g, "non-TP run is covered on the same terms"),
      /must be stated to have no inventory precondition/],
    ["exclusion widened onto non-TP",
      text.replace("- **The floor:**", "- Evidence substitution is likewise excluded on a non-TP run.\n- **The floor:**"),
      /must not be widened onto non-TP work/],
  ];
  for (const [what, mutant, expected] of cases) {
    assert.notEqual(mutant, text, `${what}: mutant must be applied`);
    assert.throws(() => assertTpExclusionScoped(mutant), expected, what);
  }
});

// --- the exact-batch transport ---------------------------------------------------------------------

const SENTINEL_RE = /CTIDE_TEST_SEMANTIC_REVIEW_BATCH_(?:BEGIN|END)/g;
const SENTINELS = ["CTIDE_TEST_SEMANTIC_REVIEW_BATCH_BEGIN", "CTIDE_TEST_SEMANTIC_REVIEW_BATCH_END"];

test("D11: the batch sentinels are identical across the reviewer and the packet", () => {
  // Extracted from each carrier rather than restated, so a typo in either file fails.
  const fromReviewer = [...new Set(agent("test-reviewer.agent.md").match(SENTINEL_RE))].sort();
  const fromPacket = [...new Set(reference("review-packet.md").match(SENTINEL_RE))].sort();
  assert.deepEqual(fromReviewer, SENTINELS);
  assert.deepEqual(fromReviewer, fromPacket, "both carriers must name the same two sentinels");
});

test("D11: the reviewer's TP section pins one invocation, two ordered sections, and prose after END", () => {
  const tp = section(agent("test-reviewer.agent.md"), "TP semantic review (test-provenance mode)");
  assert.match(tp, /One invocation, one response, two disjoint sections/);
  const begin = tp.indexOf(SENTINELS[0]);
  const end = tp.indexOf(SENTINELS[1]);
  const prose = tp.indexOf("after the END line");
  assert.ok(begin > -1 && end > begin && prose > end, "BEGIN must precede END, and the prose section must follow END");
  for (const rule of [/Exactly \*\*one\*\*/, /BEGIN first/, /must be non-empty/, /No Markdown fence/, /read-only and persist/]) {
    assert.match(tp, rule, "the TP section must carry the full framing contract");
  }
});

test("D11: the ordinary QA lens survives and stays outside the batch section", () => {
  const text = agent("test-reviewer.agent.md");
  const tp = section(text, "TP semantic review (test-provenance mode)");
  const required = section(text, "Required output");
  for (const obligation of ["Missing required tests", "Regression risks", "Confidence assessment"]) {
    assert.ok(required.includes(obligation), `Required output must retain: ${obligation}`);
    assert.ok(!tp.includes(obligation), `${obligation} must not be folded into the batch section`);
  }
  assert.match(required, /every item above is still required/, "TP mode must not weaken the QA output");
});

function assertPersistenceContract(packet) {
  const persist = section(packet, "Persisting the returned batch (main thread)");
  for (const rule of [
    /exactly one of each, BEGIN before END/,
    /first byte after BEGIN's line terminator/,
    /immediately before the line terminator that precedes END/,
    /neither\s+retained nor re-added/,
    /never\*\* reach the file/,
    /no wrapper/,
    /\*\*unusable\*\*/,
    /panel-gap rule/,
    /workflow\s+discipline/,
  ]) {
    assert.match(persist, rule, "the persistence section must carry the full byte-exact contract");
  }
  for (const forbidden of ["parse or stringify", "pretty-print", "sort keys", "normalize whitespace", "BOM", "transcode"]) {
    assert.ok(persist.includes(forbidden), `the no-normalization list must name: ${forbidden}`);
  }
}

test("D11: the packet pins the exact byte slice, the no-normalization list and the unusable rule", () => {
  assertPersistenceContract(reference("review-packet.md"));
});

test("D11: weakening the persistence contract fails", () => {
  const packet = reference("review-packet.md");
  const mutant = packet.replace("pretty-print, sort keys", "sort keys");
  assert.notEqual(mutant, packet, "no-normalization mutant must be applied");
  assert.throws(() => assertPersistenceContract(mutant), /must name: pretty-print/);

  const sliced = packet.replace("first byte after BEGIN's line terminator", "start of the batch");
  assert.notEqual(sliced, packet, "byte-slice mutant must be applied");
  assert.throws(() => assertPersistenceContract(sliced), /full byte-exact contract/);
});

function assertPacketTpContract(packet) {
  const tpFields = section(packet, "Test-provenance fields (TP-active runs)");
  // F3: three orthogonal fields, and `produced` must NOT be one of the classification values.
  assert.match(tpFields, /`empty` \| `non-empty` \| `unestablished`/, "classification must be the three-state enum");
  assert.doesNotMatch(
    tpFields,
    /classification[^\n]*`produced`/,
    "`produced` is a production outcome and must not sit in the classification enum",
  );
  for (const rule of [
    /`entryCount`/, /`reason`/, /required \*\*only\*\* when `unestablished`/,
    /`empty` requires `entryCount` 0/, /`non-empty` requires `entryCount` > 0/, /\*\*malformed\*\*/,
    /governance-affected/, /red-required-check/,
  ]) {
    assert.match(tpFields, rule, "the packet must carry the full inventory-classification contract");
  }
  // F2: authoritative inputs, not a summary.
  for (const rule of [
    /exact \*\*`taskId`\*\*/, /exact full \*\*`baseProvenance`\*\*/,
    /pointer to the controller-emitted `ChangedTestInventoryV2` artifact/,
    /reads in full/, /exact \*\*`inventoryDigest`\*\*/,
    /does not invent, derive, recompute or\s+reformat/,
    /not an external proposal-path input to the controller/,
  ]) {
    assert.match(tpFields, rule, "the packet must supply the authoritative reviewer inputs");
  }
}

test("D11: the packet pins the three-state classification and the authoritative reviewer inputs", () => {
  assertPacketTpContract(reference("review-packet.md"));
});

test("D11: weakening the packet's classification or inputs fails", () => {
  const packet = reference("review-packet.md");

  const reintroduced = packet.replace(
    "- **`classification`** — exactly one of `empty` | `non-empty` | `unestablished`.",
    "- **`classification`** — exactly one of `produced` | `empty` | `non-empty` | `unestablished`.",
  );
  assert.notEqual(reintroduced, packet, "produced-in-enum mutant must be applied");
  assert.throws(() => assertPacketTpContract(reintroduced), /must not sit in the classification enum/);

  const noPointer = packet.replace(/pointer to the controller-emitted `ChangedTestInventoryV2` artifact/g,
    "description of the inventory");
  assert.notEqual(noPointer, packet, "artifact-pointer mutant must be applied");
  assert.throws(() => assertPacketTpContract(noPointer), /authoritative reviewer inputs/);
});

function assertBatchGrammar(reviewerAgent) {
  const tp = section(reviewerAgent, "TP semantic review (test-provenance mode)");
  for (const rule of [
    /exactly one-to-one/, /no entry omitted, none duplicated/,
    /complete\*\* emitted `ChangedTestInventoryV2` envelope/, /a summary is not enough/,
    /Do not recompute it/,
    /required `testRef`, `tagBefore`, `tagAfter`, `findings`/,
    /optional `clauseRef`, `dpRef`,\s+`observedBaseBodyDigest`, `observedHeadBodyDigest`; no other key/,
    /exactly `\{ path, adapterId, structuralId \}`/,
    /exactly for the sides the entry has/,
    /always an array; `\[\]` for a clean entry/,
    /required `kind`, `evidence`; optional `binding`, `resolutionRef`; no other key/,
    /canonical ASSUM/,
    /mode: "historical-convergence"/, /mode: "this-round"/,
    /reported \*\*without\*\* one/,
  ]) {
    assert.match(tp, rule, "the TP section must embed the exact batch grammar");
  }
}

test("D11: the reviewer contract embeds the exact nested batch grammar", () => {
  assertBatchGrammar(agent("test-reviewer.agent.md"));
});

test("D11: omitting one-to-one coverage or the nested schema fails", () => {
  const text = agent("test-reviewer.agent.md");

  const noCoverage = text.replace(/exactly one-to-one/g, "as appropriate");
  assert.notEqual(noCoverage, text, "one-to-one mutant must be applied");
  assert.throws(() => assertBatchGrammar(noCoverage), /exact batch grammar/);

  const noFindingSchema = text.replace(
    "*Finding — required `kind`, `evidence`; optional `binding`, `resolutionRef`; no other key:*",
    "*Finding:*",
  );
  assert.notEqual(noFindingSchema, text, "finding-schema mutant must be applied");
  assert.throws(() => assertBatchGrammar(noFindingSchema), /exact batch grammar/);
});

// --- the established-EMPTY TP path ------------------------------------------------------------------
//
// phase15d's F1: an established-empty inventory used to open the fast lane, while 4b unconditionally
// demanded a reviewer-authored batch and nothing was allowed to fabricate one. The path is now
// coherent — every established inventory, empty included, goes to the real reviewer — and these
// checks pin each carrier's half of it.

function assertTpEmptyPath({ packet, reviewer }) {
  // The packet routes BOTH established states into TP semantic review, with the authorship reason.
  const tpFields = section(packet, "Test-provenance fields (TP-active runs)");
  const consequences = paragraphsWith(tpFields, /^Consequences:/);
  assert.equal(consequences.length, 1, "the classification consequences must live in one statement unit");
  for (const required of [
    /an \*\*established\*\* inventory/, /`empty` with `entryCount` 0/, /`non-empty` with a\s+positive count/,
    /selects the TP semantic review branch/, /evidence substitution ineligible/,
    /Emptiness is not a fast lane here/, /D5\.2\/TP §8/, /reviewer-authored/, /`results: \[\]`/,
    /governance-affected/, /D11's explicit mandate/,
    /`unestablished` is a failed required/, /reaches no reviewer at all/,
  ]) {
    assert.match(consequences[0], required,
      "the consequences must route BOTH established states into TP review and keep unestablished fail-closed");
  }

  // The transport covers every established handoff; unestablished produces none.
  const persist = section(packet, "Persisting the returned batch (main thread)");
  assert.match(
    persist,
    /On \*\*every\*\* TP-active handoff with an \*\*established\*\* inventory — `empty` or `non-empty` alike/,
    "the transport must cover every established TP-active handoff, empty included",
  );
  assert.match(persist, /`unestablished` inventory produces no handoff/,
    "an unestablished inventory must be stated to produce no handoff");

  // Transport-byte emptiness is a DIFFERENT emptiness from inventory-entry emptiness. The empty-
  // inventory change must not be allowed to weaken the non-empty SLICE rule by association.
  assert.match(reviewer, /The slice must be non-empty/,
    "the non-empty byte-slice rule is about transport bytes, not inventory entries, and must survive");

  // The reviewer applies to every established inventory, and states the degenerate results case.
  const tp = section(reviewer, "TP semantic review (test-provenance mode)");
  const when = paragraphsWith(tp, /\*\*When this applies\.\*\*/);
  assert.equal(when.length, 1, "the applicability rule must live in one statement unit");
  for (const required of [
    /\*\*established\*\*/, /`empty` with `entryCount` 0/, /confirmed\s+non-empty/, /governance-affected/,
    /never evidence-substituted/, /reviewer-authored/, /`unestablished`\s+inventory never reaches you/,
  ]) {
    assert.match(when[0], required, "the applicability rule must cover every established inventory, empty included");
  }

  const resultsRule = statementUnits(tp).find(unit => /^- `results`/.test(unit));
  assert.ok(resultsRule, "the batch grammar must carry a `results` rule");
  for (const required of [/Zero entries means `results: \[\]`/, /complete one-to-one coverage/, /not a\s+skipped review/]) {
    assert.match(resultsRule, required,
      "zero entries must be stated to mean `results: []`, and that must be stated as coverage rather than a skipped review");
  }

  // The QA lens is not reduced by an empty inventory — it is the only place the observation can land.
  const required = section(reviewer, "Required output");
  assert.match(required, /established-empty inventory does not reduce this lens/,
    "an established-empty inventory must be stated not to reduce the ordinary QA output");
}

test("D11 R2: the established-empty TP path is coherent across the packet and the reviewer", () => {
  assertTpEmptyPath({ packet: reference("review-packet.md"), reviewer: agent("test-reviewer.agent.md") });
});

test("D11 R2: narrowing the TP path back to non-empty, or weakening the slice rule, fails", () => {
  const packet = reference("review-packet.md");
  const reviewer = agent("test-reviewer.agent.md");
  const cases = [
    ["packet transport narrowed to non-empty", {
      packet: packet.replace(
        "On **every** TP-active handoff with an **established** inventory — `empty` or `non-empty` alike",
        "On a TP-active handoff with a confirmed non-empty inventory",
      ),
      reviewer,
    }, /must cover every established TP-active handoff, empty included/],
    ["packet consequences regrant the empty fast lane", {
      packet: packet.replace("Emptiness is not a fast lane here", "Emptiness is the fast lane here"),
      reviewer,
    }, /route BOTH established states into TP review/],
    ["reviewer applicability narrowed to non-empty", {
      packet,
      reviewer: reviewer.replace(
        "as **established** — either `empty` with `entryCount` 0, or **confirmed",
        "as **confirmed",
      ),
    }, /must cover every established inventory, empty included/],
    ["the zero-entry results rule dropped", {
      packet,
      reviewer: reviewer.replace("**Zero entries means `results: []`**", "Every entry carries a result"),
    }, /zero entries must be stated to mean `results: \[\]`/],
    ["the byte-slice emptiness rule weakened", {
      packet,
      reviewer: reviewer.replace("The slice must be non-empty.", "The slice may be empty."),
    }, /transport bytes, not inventory entries/],
    ["the empty-inventory QA lens dropped", {
      packet,
      reviewer: reviewer.replace("established-empty inventory does not reduce this lens", "batch is the whole job"),
    }, /must be stated not to reduce the ordinary QA output/],
  ];
  for (const [what, carriers, expected] of cases) {
    assert.notEqual(
      carriers.packet + carriers.reviewer, packet + reviewer, `${what}: mutant must be applied`,
    );
    assert.throws(() => assertTpEmptyPath(carriers), expected, what);
  }
});

// An EXECUTABLE check, not a restatement. `ingestInputs` is §D5.6's exported entry point: it charges
// the review root key set, every claim, and one-to-one coverage. Driving it with a real zero-entry
// envelope is the only way to show that `results: []` is genuinely accepted rather than merely
// documented as accepted — and it needs no production change.
const HEX40 = "a".repeat(40);
const hex64 = char => char.repeat(64);

function zeroEntryInventoryV2() {
  const preimage = {
    inventoryVersion: 2,
    baseTreeOid: HEX40,
    registryDigest: hex64("b"),
    headViewDigest: hex64("c"),
    inputProvenanceStoreDigest: hex64("d"),
    entries: [],
  };
  return { ...preimage, inventoryDigest: computeInventoryV2Digest(preimage) };
}

function ingestZeroEntryReview(results) {
  const inventorySnapshot = zeroEntryInventoryV2();
  const taskId = "task-established-empty";
  const baseProvenance = { treeOid: HEX40, storePath: ".ctide/provenance.json", storeDigest: hex64("e") };
  const batch = {
    taskId,
    baseProvenance,
    inventorySnapshot,
    inventoryDigest: inventorySnapshot.inventoryDigest,
    results,
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-empty-batch-"));
  try {
    const review = path.join(dir, "task.review.json");
    fs.writeFileSync(review, JSON.stringify(batch, null, 2));
    return ingestInputs({
      paths: { review, governance: path.join(dir, "task.governance.json") },
      taskId,
      taskState: { baseProvenance },
      emission: { returned: { inventoryDigest: inventorySnapshot.inventoryDigest } },
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("D11 R2: a zero-entry inventory is accepted with `results: []` by the loop's own ingestion", () => {
  const ingested = ingestZeroEntryReview([]);
  assert.deepEqual(ingested.batch.results, [], "an empty results array must survive ingestion unchanged");
  assert.equal(ingested.inventorySnapshot.entries.length, 0, "the reviewed inventory must be the zero-entry one");
});

test("D11 R2: a spurious result on a zero-entry inventory is refused by the real coverage rule", () => {
  assert.throws(
    () => ingestZeroEntryReview([{
      testRef: { path: "test/ghost.test.mjs", adapterId: "node-test", structuralId: "ghost" },
      tagBefore: null,
      tagAfter: null,
      findings: [],
    }]),
    error => /names no entry in the emitted inventory/.test(String(error && error.message)),
    "results[] is one-to-one: a result naming a test the inventory does not list must be refused",
  );
});

// --- D11 Release 2: the TP-active sub-loop, the arbiter gate, and the runtime/ledger carriers -----
//
// Each checker is a pure function over in-memory text so the mutants below exercise it without
// touching a file on disk. Assertions are scoped to the owning section and use ordered token indexes
// rather than aggregate counts, so a required carrier cannot go missing behind another file's text.

const runtimeContract = () => fs.readFileSync(path.join(root, "docs", "runtime-contract.md"), "utf8");

// The lifecycle steps are numbered list items, not `##` headings, so 4b is sliced from its own
// leading token to the next top-level step.
function lifecycleStep(markdown, startToken, endToken) {
  const start = markdown.indexOf(startToken);
  assert.notEqual(start, -1, `missing lifecycle step: ${startToken}`);
  const end = markdown.indexOf(endToken, start + startToken.length);
  assert.notEqual(end, -1, `missing following step: ${endToken}`);
  return markdown.slice(start, end);
}

const orderedTokens = (haystack, tokens, what) => {
  let cursor = -1;
  for (const token of tokens) {
    const at = haystack.indexOf(token, cursor + 1);
    assert.notEqual(at, -1, `${what}: missing ordered token ${token}`);
    assert.ok(at > cursor, `${what}: ${token} is out of order`);
    cursor = at;
  }
};

function assertTpSubLoop(skillMd) {
  // 4b sits AFTER generic verification step 4 and BEFORE reviewer selection step 5.
  const contractCheck = skillMd.indexOf("contract-check.mjs --base");
  const tpStart = skillMd.indexOf("4b. Test-provenance loop");
  const panel = skillMd.indexOf("5. Review panel selection");
  assert.ok(contractCheck > -1 && tpStart > contractCheck,
    "TP-active step 4b must follow the generic contract-check of step 4");
  assert.ok(panel > tpStart, "TP-active step 4b must precede reviewer selection");

  const block = lifecycleStep(skillMd, "4b. Test-provenance loop", "5. Review panel selection");

  // The seven, in order, by CLI verb.
  orderedTokens(block, ["`emit`", "Review Packet", "`test-reviewer`", "`submit`", "`commit`", "`verify`", "`evaluate`"],
    "the seven TP-active sub-steps");
  // `begin` opens the loop before sub-step 1.
  assert.ok(block.indexOf("`begin`") < block.indexOf("`emit`"), "begin must open the loop before emit");

  // Ownership: the mutating operations are the main thread's; only the gate is the arbiter's.
  for (const verb of ["`emit`", "`submit`", "`commit`", "`verify`"]) {
    const unit = statementUnits(block).find(u => u.includes(verb));
    assert.ok(unit && /main thread/i.test(unit), `${verb} must be owned by the main thread`);
    assert.ok(unit && !/arbiter/i.test(unit), `${verb} must not be assigned to the arbiter`);
  }
  const gate = statementUnits(block).find(u => u.includes("`evaluate`"));
  assert.ok(gate && /arbiter/i.test(gate), "the gate must be the arbiter's");
  assert.ok(gate && !/main thread/i.test(gate), "the gate must not be a main-thread operation");

  // Outside the seven, and never promoted into them.
  const outside = statementUnits(block).find(u => u.includes("`inspect`") && u.includes("`open-epoch`"));
  assert.ok(outside, "inspect and open-epoch must be stated outside the seven");
  assert.match(outside, /diagnos/i, "inspect must be diagnostic-only");
  assert.match(outside, /recovery-only/, "open-epoch must be recovery-only");
  assert.ok(!/^\s*\d+\.\s.*`inspect`/m.test(block), "inspect must not appear as a numbered sub-step");
  assert.ok(!/^\s*\d+\.\s.*`open-epoch`/m.test(block), "open-epoch must not appear as a numbered sub-step");

  // No legacy consumer INVOCATION anywhere in the workflow. Narrow like garden 9e: the prohibition
  // itself names the flag, so only the invocation form may be forbidden.
  assert.ok(!/contract-check\.mjs[^\n]*--provenance/.test(skillMd),
    "the workflow must not invoke contract-check --provenance");

  // The two caps live in separate statement units, and neither claims to feed the other.
  // Match the LIMIT PHRASES, not bare digits: an incidental cross-reference like "generic step 8"
  // must not read as the controller's cap of eight.
  const capUnits = statementUnits(block).filter(u => /repair cap|controller cap/i.test(u));
  assert.equal(capUnits.length, 2, "the repair cap and the controller cap need their own statement units");
  for (const unit of capUnits) {
    const statesTwo = /two consecutive/i.test(unit);
    const statesEight = /eight admissions/i.test(unit);
    assert.ok(statesTwo !== statesEight, "a cap unit must state one limit, not merge both into a shared counter");
  }
  const repairUnit = capUnits.find(u => /two consecutive/i.test(u));
  const controllerUnit = capUnits.find(u => /eight admissions/i.test(u));
  assert.match(repairUnit, /never locks or unlocks the\s+controller/i, "the repair cap must disclaim controller effect");
  assert.match(repairUnit, /not satisfied by any controller\s+counter/i, "the repair cap must disclaim substitution");
  assert.match(controllerUnit, /never increments, replaces, resets or satisfies the ordinary repair\s+cap/i,
    "the controller cap must disclaim feeding the repair cap");

  // Every step reference inside 4b must be qualified as TP-active or generic — never a bare "step N".
  // Strip the qualified forms first, then flag whatever "step N" is left. A lookbehind would
  // false-positive on "TP-active sub-step 1", where the qualifier is not adjacent to "step".
  const bare = block
    .replace(/TP-active (sub-)?step \d\w*/g, "")
    .replace(/generic step \d/g, "")
    .match(/\bstep \d/g) || [];
  assert.deepEqual(bare, [], `step references must be qualified: found ${bare.join(", ")}`);
}

test("D11 R2: SKILL.md pins the ordered TP-active sub-loop, its ownership and its caps", () => {
  assertTpSubLoop(skill("vigil"));
});

test("D11 R2: reordering, re-owning or merging the TP-active sub-loop fails", () => {
  const md = skill("vigil");

  const swapped = md.replace("5. `commit` / `commitReviewedBatch`", "5. ZZcommitZZ")
    .replace("6. `verify` / `recordVerification`", "6. `commit` / `commitReviewedBatch`")
    .replace("5. ZZcommitZZ", "5. `verify` / `recordVerification`");
  assert.notEqual(swapped, md, "commit/verify swap mutant must be applied");
  assert.throws(() => assertTpSubLoop(swapped), /out of order|missing ordered token/);

  const legacy = md.replace("contract-check.mjs --base", "contract-check.mjs --base --provenance");
  assert.notEqual(legacy, md, "legacy-call mutant must be applied");
  assert.throws(() => assertTpSubLoop(legacy), /must not invoke contract-check --provenance/);

  const reowned = md.replace("1. `emit` / `runProposalIteration` — main thread.",
    "1. `emit` / `runProposalIteration` — the arbiter.");
  assert.notEqual(reowned, md, "emit-ownership mutant must be applied");
  assert.throws(() => assertTpSubLoop(reowned), /owned by the main thread/);

  const bareRef = md.replace("returns to **TP-active sub-step 1**", "returns to **step 1**");
  assert.notEqual(bareRef, md, "bare-reference mutant must be applied");
  assert.throws(() => assertTpSubLoop(bareRef), /must be qualified/);
});

// F5: the four sub-loop properties phase15c asserted statically but never exercised with an applied
// mutant. Each one moves real text, so the checker is proved to hold the property rather than merely
// to match a sentence that happens to be there.
test("D11 R2: relocating 4b, promoting the diagnostics, merging the caps or re-owning the gate fails", () => {
  const md = skill("vigil");
  const block = md.slice(md.indexOf("4b. Test-provenance loop"), md.indexOf("5. Review panel selection"));

  // 1. 4b lifted above the generic verification step whose contract-check it depends on.
  const movedEarly = md.replace(block, "").replace("4. Verification\n", `${block}4. Verification\n`);
  assert.notEqual(movedEarly, md, "4b-relocation mutant must be applied");
  assert.throws(() => assertTpSubLoop(movedEarly), /must follow the generic contract-check/);

  // 2. `inspect` promoted out of "outside the seven" into a numbered sub-step.
  const promoted = md.replace(
    "   - **Outside the seven:** `inspect` / `inspectLoopState` is read-only diagnosis only, never a gate",
    "     8. `inspect` / `inspectLoopState` is read-only diagnosis only, never a gate",
  );
  assert.notEqual(promoted, md, "inspect-promotion mutant must be applied");
  assert.throws(() => assertTpSubLoop(promoted), /must not appear as a numbered sub-step/);

  // 3. The two caps merged into one statement unit, which is how a shared counter gets smuggled in.
  const mergedCaps = md.replace(
    "   - **The controller cap counts proposal admissions.**",
    "     **The controller cap counts proposal admissions.**",
  );
  assert.notEqual(mergedCaps, md, "cap-merge mutant must be applied");
  assert.throws(() => assertTpSubLoop(mergedCaps), /need their own statement units|one limit/);

  // 4. The gate moved into the main thread's list of mutating operations.
  const gateReowned = md.replace(
    "7. After the selected reviewers finish, the `arbiter` runs `evaluate`",
    "7. After the selected reviewers finish, the main thread runs `evaluate`",
  );
  assert.notEqual(gateReowned, md, "gate-ownership mutant must be applied");
  assert.throws(() => assertTpSubLoop(gateReowned), /must not be a main-thread operation/);
});

// The one legal invocation, spelled out here so the check is EQUALITY rather than containment: a
// substring match accepts `… --task <task-id> --force`, which is exactly what "no other flag is
// legal" forbids. Not a template literal — `${CLAUDE_PLUGIN_ROOT}` must stay literal.
const ARBITER_GATE_COMMAND =
  "node ${CLAUDE_PLUGIN_ROOT}/skills/vigil/scripts/test-provenance-loop.mjs evaluate --cwd <repo-root> --task <task-id>";

function fencedLines(markdown, what) {
  const open = markdown.indexOf("```");
  assert.notEqual(open, -1, `${what}: a fenced block is required`);
  const bodyStart = markdown.indexOf("\n", open) + 1;
  const close = markdown.indexOf("```", bodyStart);
  assert.notEqual(close, -1, `${what}: the fenced block must be closed`);
  return markdown.slice(bodyStart, close).split(/\r?\n/).filter(line => line.trim() !== "");
}

// F2: the payload/exit pairs, each pinned in its own row. The arbiter cannot observe which stream a
// line arrived on in this surface, so the contract rests on (payload shape, exit status) — and the
// rows are checked individually so removing one cannot hide behind the others.
const COHERENCE_ROWS = [
  [/\*\*Gate response\*\* — `loop`, `provenance`, boolean `combined`\.\s*`combined: true` requires exit \*\*0\*\*;\s*`combined: false` requires exit \*\*1\*\*\./,
    "the gate-response row must bind combined:true to exit 0 and combined:false to exit 1"],
  [/\*\*Thrown refusal\*\* — `\{ok:false, code, message, detail\}` and \*\*no\*\* `combined`\.\s*Requires exit \*\*1\*\*,\s*and is \*\*not\*\* a gate result\./,
    "the thrown-refusal row must require exit 1 and deny that it is a gate result"],
  [/\*\*Incoherent\*\* — any other pairing \(`combined: true` with a non-zero exit, `combined: false` with\s*exit 0, a refusal with exit 0\), or two payloads\./,
    "the incoherent row must name the mismatched pairs and the two-payload case"],
  [/\*\*Absent\*\* — missing output, unparseable output, a payload without a boolean `combined`, or no\s*invocation at all\./,
    "the absent row must name missing, unparseable, no-boolean-combined and no-invocation"],
];

function assertArbiterGate(arbiterMd) {
  const gate = section(arbiterMd, "Test-provenance gate (TP-active runs only)");

  // F3: the exact command, once, with no extra flag.
  const command = fencedLines(gate, "the arbiter gate command");
  assert.equal(command.length, 1, `the gate fence must carry exactly one command line; saw ${command.length}`);
  assert.equal(command[0].trim(), ARBITER_GATE_COMMAND,
    "the fenced gate command must be EXACTLY the canonical invocation — no extra flag, no rewording");
  const invocations = (arbiterMd.match(/test-provenance-loop\.mjs evaluate/g) || []).length;
  assert.equal(invocations, 1,
    `exactly one evaluate invocation may appear in the agent prompt; saw ${invocations}`);

  for (const rule of [
    /exactly once per arbiter pass/,
    /No other flag is legal/,
    /cached result/, /the run\s*\n?ledger's `testProvenance` block/, /never accepted in place of a fresh gate/,
    /never call `verify` \/ `recordVerification`/,
    /writes and reconciles nothing/,
    // The PRODUCER contract is retained: the controller does specify stdout for success and stderr
    // for returned/thrown failures. What changed is the claim about what this agent can attribute.
    /prints on \*\*stderr\*\* and exits \*\*1\*\*/,
    /\*producer\* contract/,
    /withhold `READY`/,
    /must never be read as suppressing or\s*\n?erasing the independently computed `provenance` half/,
  ]) {
    assert.match(gate, rule, "the arbiter gate section must carry the full contract");
  }

  // F2: no claim of stream attribution this surface cannot make, and no exit-status indifference.
  assert.match(gate, /may merge stream presentation/,
    "the gate must disclose that this surface may merge stream presentation");
  assert.match(gate, /claim no independent\s+stdout\/stderr attribution/,
    "the gate must decline any independent stdout/stderr attribution");
  assert.doesNotMatch(gate, /[Cc]heck stdout, then stderr/,
    "the gate must not instruct a stream discrimination this surface cannot perform");
  assert.doesNotMatch(gate, /whatever the exit\s*\n?\s*status was/,
    "the gate must not accept a payload regardless of its exit status");

  for (const [row, why] of COHERENCE_ROWS) assert.match(gate, row, why);

  // The three reported groups, in reporting order.
  orderedTokens(gate, ["`loop.pass`", "`provenance.pass`", "`combined`"], "the separated gate reporting");
}

test("D11 R2: the arbiter carries the complete fresh-gate contract in its own prompt", () => {
  assertArbiterGate(agent("arbiter.agent.md"));
});

test("D11 R2: weakening the arbiter gate fails", () => {
  const md = agent("arbiter.agent.md");
  const exact = /must be EXACTLY the canonical invocation/;
  const cases = [
    ["--task removed", md.replace(" --task <task-id>", ""), exact],
    ["plugin root removed", md.replace("${CLAUDE_PLUGIN_ROOT}/skills", "skills"), exact],
    // F3: containment would accept both of these.
    ["extra flag appended", md.replace("--task <task-id>\n```", "--task <task-id> --force\n```"), exact],
    ["command duplicated", md.replace("**Report these separately",
      `\`\`\`\n${ARBITER_GATE_COMMAND}\n\`\`\`\n\n**Report these separately`),
      /exactly one evaluate invocation may appear in the agent prompt; saw 2/],
    ["producer contract removed", md.replace("prints on **stderr** and exits **1**", "fails"),
      /full contract/],
    ["corrupt-state clause removed", md.replace(/must never be read as suppressing or\s*\n?erasing the independently computed `provenance` half/, "is reported"),
      /full contract/],
    ["ledger authority allowed", md.replace("never accepted in place of a fresh gate", "acceptable when fresh evidence is costly"),
      /full contract/],
    ["arbiter verify allowed", md.replace("never call `verify` / `recordVerification`", "may call `verify`"),
      /full contract/],
    // F2: the three ways the old, unobservable contract could come back.
    ["exit-status indifference restored", md.replace(
      "`combined: false` requires exit **1**.", "Use it whatever the exit status was."),
      /must not accept a payload regardless of its exit status/],
    // Removing a row exercises the row assertions themselves, which the mutant above never reaches:
    // it trips the exit-indifference guard first.
    ["the gate-response row removed", md.replace(
      /- \*\*Gate response\*\* — `loop`[\s\S]*?requires exit \*\*1\*\*\.\n/, ""),
      /gate-response row must bind combined:true to exit 0/],
    ["the incoherent row removed", md.replace(
      /- \*\*Incoherent\*\* — any other pairing[\s\S]*?or two payloads\.\n/, ""),
      /incoherent row must name the mismatched pairs/],
    ["stream discrimination restored", md.replace(
      "**claim no independent\nstdout/stderr attribution**", "Check stdout, then stderr"),
      /must decline any independent stdout\/stderr attribution/],
  ];
  for (const [what, mutant, expected] of cases) {
    assert.notEqual(mutant, md, `${what}: mutant must be applied`);
    assert.throws(() => assertArbiterGate(mutant), expected, what);
  }
});

// F6: a filename alone proves nothing — the point of the tree is WHO owns each file. Six of the seven
// carry an explicit owner tag on their own line; `emit.lock` carries none, and its ownership rests on
// the prose below the fence ("everything else is controller-owned"), which is therefore pinned too.
const RUNTIME_FILE_OWNERS = [
  ["task-<h>.json", "controller"],
  ["task-<h>.lock", "controller"],
  ["task-<h>.<pid>.<rand>.tmp", "controller"],
  ["task-<h>.review.json", "main thread"],
  ["task-<h>.governance.json", "main thread"],
  ["task-<h>.<admissionId>.payload.json", "controller"],
];

function assertRuntimePrefix(contract) {
  // The .ctide tree fence specifically, not merely the first code block in the file.
  const anchor = contract.indexOf("runs.jsonl");
  assert.notEqual(anchor, -1, "the runtime contract must show the .ctide tree");
  const open = contract.lastIndexOf("```", anchor);
  const fence = contract.slice(open, contract.indexOf("```", open + 3));
  assert.ok(fence.includes("test-provenance-loop/"), "the reserved prefix must be a member of the .ctide tree");

  const fenceLines = fence.split(/\r?\n/);
  for (const [role, owner] of RUNTIME_FILE_OWNERS) {
    const owning = fenceLines.filter(line => line.includes(role));
    assert.equal(owning.length, 1, `the tree must name the file role ${role} exactly once; saw ${owning.length}`);
    assert.ok(
      owning[0].includes(`(${owner})`),
      `${role} must be bound to its owner (${owner}) on its own line; saw: ${owning[0].trim()}`,
    );
  }
  assert.ok(fenceLines.some(line => line.includes("emit.lock")), "the tree must name the file role: emit.lock");
  assert.match(
    contract,
    /Its two main-thread files are the reviewer's persisted bytes and the\s*\n?governance draft input; everything else is controller-owned\./,
    "the prose must name the two main-thread files and assign everything else to the controller",
  );
  assert.match(contract, /evaluated \*\*before\s*\n?trackedness\*\*/, "the exclusion must precede trackedness");
  assert.match(contract, /\*\*zero\*\* inventory or telemetry cost/, "the prefix must state zero cost");
  assert.match(contract, /base view is unchanged/, "the base view must be stated unchanged");
  assert.match(contract, /does \*\*not\*\*\s*\n?create its own nested `\.gitignore`/, "the no-self-gitignore fact must be stated");
  assert.ok(!/creates? its own `\.gitignore`|self-creates a `\.gitignore`/.test(contract),
    "the prefix must not be claimed to create a .gitignore");
  assert.match(contract, /Total\*\* loss of the prefix/, "total-loss semantics must be stated");
  assert.ok(!contract.includes("which is not released"), "the stale unreleased claim must be gone");
  assert.match(contract, /`runProposalIteration`, which performs/, "runProposalIteration must own the sequencing");
}

test("D11 R2: the runtime contract documents the controller prefix truthfully", () => {
  assertRuntimePrefix(runtimeContract());
});

test("D11 R2: losing a file role, its owner, the exclusion, or the hygiene truth fails", () => {
  const md = runtimeContract();
  const cases = [
    ["role dropped", md.replace(/^.*task-<h>\.governance\.json.*$/m, ""),
      /governance\.json exactly once; saw 0/],
    // F6: the owner swap a filename-only assertion could not see.
    ["owner swapped on the review file",
      md.replace(/(task-<h>\.review\.json.*)\(main thread\)/, "$1(controller)"),
      /task-<h>\.review\.json must be bound to its owner \(main thread\)/],
    ["owner swapped on the control state",
      md.replace(/(task-<h>\.json {2}.*)\(controller\)/, "$1(main thread)"),
      /task-<h>\.json must be bound to its owner \(controller\)/],
    ["the everything-else prose reversed",
      md.replace("everything else is controller-owned", "everything else is main-thread-owned"),
      /assign everything else to the controller/],
    ["exclusion weakened", md.replace(/evaluated \*\*before\s*\n?trackedness\*\*/, "evaluated"),
      /exclusion must precede trackedness/],
    ["invented gitignore", md.replace(/does \*\*not\*\*\s*\n?create its own nested `\.gitignore`/, "creates its own `.gitignore`"),
      /no-self-gitignore fact must be stated/],
    ["stale claim restored", md.replace("Full field semantics live in", "which is not released. Full field semantics live in"),
      /stale unreleased claim must be gone/],
  ];
  for (const [what, mutant, expected] of cases) {
    assert.notEqual(mutant, md, `${what}: mutant must be applied`);
    assert.throws(() => assertRuntimePrefix(mutant), expected, what);
  }
});

// F4: each counter's scope is charged against the statement unit that OWNS that counter. A
// section-wide sweep passes even when two mappings are swapped, because every word is still somewhere
// in the section — the same aggregate-scope weakness fixed for the substitution carriers in phase14f.
const LEDGER_COUNTER_SCOPES = [
  ["reviewLoopIterations", [/`observedIterations`/, /retained controller window/]],
  ["convergenceEpochs", [/`observedEpochs`/, /\*\*cumulative\*\*/]],
  ["adapterMisses", [
    /\*\*emit\*\* call and the \*\*observe\*\* call are two\s*\n?\s*separate invocations/,
    /E1 allowlist/,
  ]],
  ["staleBatchRejections", [
    /\*\*only\*\* main-thread `recordVerification` consumer refusals with\s*\n?\s*`E_STEP6_SOURCE_STALE`/,
    /misbinding is never counted here/,
  ]],
  ["lastStaleSubject", [/named head-ref string\*\*, or `null`\. Never a typed object/]],
];

function assertLedgerScopes(ledger) {
  assert.ok(!ledger.includes("Until the loop controller"), "the pre-release caveat must be gone");
  assert.match(ledger, /§11 as\s*\n?\s*amended by D10/, "counters must be attributed to §11 as amended by D10");
  const scopes = section(ledger, "The five loop-derived counters — exact scopes");

  const units = statementUnits(scopes);
  for (const [counter, rules] of LEDGER_COUNTER_SCOPES) {
    const owning = units.filter(unit => unit.includes(`**\`${counter}\`**`));
    assert.equal(owning.length, 1, `exactly one statement unit must own \`${counter}\`; saw ${owning.length}`);
    for (const rule of rules) {
      assert.match(owning[0], rule,
        `\`${counter}\`'s scope must be stated in its OWN statement unit, not merely somewhere in the section`);
    }
  }

  // Facts that genuinely belong to the section rather than to one counter.
  for (const rule of [
    /`\{observed, uncertain\}`/, /only\s*\n?place that projects `"unknown"`/,
    /`priorHistory` stays `"unknown"`/,
    /null head, a legacy head, or a failed\s*\n?emission/,
    /`evaluate` and `inspect` \*\*write no counter\*\*/,
    /taken from the \*\*loop half only\*\*/,
  ]) {
    assert.match(scopes, rule, "the counter-scope section must carry the exact D10 scopes");
  }
}

test("D11 R2: the ledger states the exact D10 counter scopes and drops the stale caveat", () => {
  assertLedgerScopes(reference("run-ledger.md"));
});

test("D11 R2: misattributing a counter or letting provenance drive movement fails", () => {
  const md = reference("run-ledger.md");
  const owned = counter => new RegExp(`\`${counter}\`'s scope must be stated in its OWN statement unit`);
  const cases = [
    ["misbinding counted", md.replace("misbinding is never counted here", "misbinding is counted here"),
      owned("staleBatchRejections")],
    ["movement from combined", md.replace(/taken from the \*\*loop half only\*\*/, "taken from the combined rollup"),
      /exact D10 scopes/],
    ["stale caveat restored", `Until the loop controller (D) is released, nothing works.\n\n${md}`,
      /caveat must be gone/],
    ["typed lastStaleSubject", md.replace("Never a typed object", "Or a typed object"),
      owned("lastStaleSubject")],
    // F4: the two mutants a section-wide sweep could not see. Every required word is still present
    // in the section afterwards — only its OWNING unit changed.
    ["observedIterations/observedEpochs swapped", md
      .replace("— `observedIterations`, scoped to", "— ZZSWAPZZ, scoped to")
      .replace("— `observedEpochs`, **cumulative**", "— `observedIterations`, **cumulative**")
      .replace("— ZZSWAPZZ, scoped to", "— `observedEpochs`, scoped to"),
      owned("reviewLoopIterations")],
    ["misbinding exclusion relocated to another counter", md
      .replace(" A §D8.4 misbinding is never counted here and fabricates no counter.", "")
      .replace("Never a typed object.",
        "Never a typed object. A §D8.4 misbinding is never counted here and fabricates no counter."),
      owned("staleBatchRejections")],
  ];
  for (const [what, mutant, expected] of cases) {
    assert.notEqual(mutant, md, `${what}: mutant must be applied`);
    assert.throws(() => assertLedgerScopes(mutant), expected, what);
  }
});
