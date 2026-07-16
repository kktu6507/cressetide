import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { root } from "./helpers.mjs";

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
