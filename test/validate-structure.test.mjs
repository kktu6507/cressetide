// Negative-path tests for the CI structure validator (.github/scripts/validate-structure.mjs): each
// guard must FAIL on an injected defect in a temp copy of the repo, plus a clean-copy control.
// Structural-validator tests split from the hook behavior suite.
import { test } from "node:test";
import assert from "node:assert";
import cp from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { copyRepoTree, runValidator } from "./support.mjs";

function runExtensionValidator(tree) {
  const result = cp.spawnSync("node", [path.join(tree, ".github", "scripts", "validate-cressetide-extensions.mjs")], {
    cwd: tree,
    encoding: "utf8",
  });
  return { code: result.status, out: (result.stdout || "") + (result.stderr || "") };
}

// --- validate-structure CI guards: negative-path coverage ---
// The text-integrity (U+FFFD) and multilingual-README-parity checks are fail-only guards; lock in that they
// actually FAIL on a violation (not merely pass on the clean tree) by running the real validator against a
// temp copy of the repo with one injected defect. A future edit that silently disables a guard breaks these.

test("validate-structure: passes on a clean copy of the repo (control)", () => {
  const tree = copyRepoTree();
  try {
    assert.ok(!fs.existsSync(path.join(tree, "output")), "copyRepoTree must not drag run-scratch output/ into the temp tree");
    assert.ok(!fs.existsSync(path.join(tree, ".claude")), "copyRepoTree must not drag machine-private .claude/ into the temp tree");
    assert.strictEqual(runValidator(tree).code, 0, "the validator must pass on an unmodified copy");
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
});

test("validate-structure: copied extension validator passes on a clean tree", () => {
  const tree = copyRepoTree();
  try {
    const { code, out } = runExtensionValidator(tree);
    assert.strictEqual(code, 0, `the copied extension validator must have a clean baseline: ${out}`);
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
});

test("validate-structure: text-integrity check FAILS on a planted U+FFFD", () => {
  const tree = copyRepoTree();
  try {
    fs.appendFileSync(path.join(tree, "README.md"), "\nmojibake " + String.fromCharCode(0xFFFD) + " here\n");
    const { code, out } = runValidator(tree);
    assert.notStrictEqual(code, 0, "a tracked text file with U+FFFD must fail the build");
    assert.match(out, /text integrity/, "the failure must name the text-integrity check");
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
});

test("validate-structure: text-integrity check FAILS on known mojibake markers", () => {
  const tree = copyRepoTree();
  try {
    fs.appendFileSync(path.join(tree, "README.md"), "\nmojibake " + String.fromCodePoint(0x7AB6) + " marker\n", "utf8");
    const { code, out } = runValidator(tree);
    assert.notStrictEqual(code, 0, "a known mojibake marker must fail the build");
    assert.match(out, /suspicious mojibake marker/, "the failure must name the mojibake marker guard");
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
});

test("validate-structure: README parity FAILS on a top-level section-count mismatch", () => {
  const tree = copyRepoTree();
  try {
    fs.appendFileSync(path.join(tree, "README.md"), "\n## An English-only extra section\n\nbody\n");
    const { code, out } = runValidator(tree);
    assert.notStrictEqual(code, 0, "an asymmetric ## section count must fail the build");
    assert.match(out, /README parity/, "the failure must name README parity");
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
});

test("validate-structure: README parity FAILS when the zh README omits a wired hook name", () => {
  const tree = copyRepoTree();
  try {
    const zhPath = path.join(tree, "README.zh-TW.md");
    fs.writeFileSync(zhPath, fs.readFileSync(zhPath, "utf8").split("plan-gate").join("PLANGATE_removed"), "utf8");
    const { code, out } = runValidator(tree);
    assert.notStrictEqual(code, 0, "zh omitting a wired hook name must fail the build");
    assert.match(out, /plan-gate/, "the failure must name the missing hook");
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
});

test("validate-structure: README parity FAILS when either README drops a required entry link", () => {
  const tree = copyRepoTree();
  try {
    const zhPath = path.join(tree, "README.zh-TW.md");
    fs.writeFileSync(zhPath, fs.readFileSync(zhPath, "utf8").replace("template=verified-run.yml", "template=removed.yml"), "utf8");
    const { code, out } = runValidator(tree);
    assert.notStrictEqual(code, 0, "README entry links must stay present in both languages");
    assert.match(out, /missing required entry link/, "the failure must name the missing README link");
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
});

test("validate-structure: README parity FAILS when the ja README omits a wired hook name", () => {
  const tree = copyRepoTree();
  try {
    const jaPath = path.join(tree, "README.ja.md");
    fs.writeFileSync(jaPath, fs.readFileSync(jaPath, "utf8").split("plan-gate").join("PLANGATE_removed"), "utf8");
    const { code, out } = runValidator(tree);
    assert.notStrictEqual(code, 0, "ja omitting a wired hook name must fail the build");
    assert.match(out, /plan-gate/, "the failure must name the missing hook");
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
});

test("validate-structure: README parity FAILS when the ja README drops a required entry link", () => {
  const tree = copyRepoTree();
  try {
    const jaPath = path.join(tree, "README.ja.md");
    fs.writeFileSync(jaPath, fs.readFileSync(jaPath, "utf8").replace("template=verified-run.yml", "template=removed.yml"), "utf8");
    const { code, out } = runValidator(tree);
    assert.notStrictEqual(code, 0, "README entry links must stay present in every language");
    assert.match(out, /missing required entry link/, "the failure must name the missing README link");
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
});

test("validate-structure: README parity FAILS when a translated README is deleted", () => {
  const tree = copyRepoTree();
  try {
    fs.rmSync(path.join(tree, "README.ja.md"));
    const { code, out } = runValidator(tree);
    assert.notStrictEqual(code, 0, "deleting a translated README must fail the build");
    assert.match(out, /README\.ja\.md is missing/, "the failure must name the missing translated README");
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
});

test("validate-structure: a version mismatch across manifests FAILS", () => {
  const tree = copyRepoTree();
  try {
    const pj = path.join(tree, "cressetide", ".claude-plugin", "plugin.json");
    const obj = JSON.parse(fs.readFileSync(pj, "utf8"));
    obj.version = "9.9.9"; // disagree with marketplace.json / package.json / CHANGELOG
    fs.writeFileSync(pj, JSON.stringify(obj, null, 2), "utf8");
    const { code, out } = runValidator(tree);
    assert.notStrictEqual(code, 0, "a version that disagrees across manifests must fail the build");
    assert.match(out, /version mismatch/, "the failure must name the version mismatch");
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
});

test("validate-structure: §5j FAILS CLOSED when task-contract.md drops a guarded machine field", () => {
  const tree = copyRepoTree();
  try {
    const tc = path.join(tree, "cressetide", "skills", "vigil", "references", "task-contract.md");
    // Strip every occurrence of a field contract-check.mjs reads; the §5j guard must bite so a prose
    // edit can't silently gut the deterministic inputs while CI stays green (mirrors the 5d/5e guards).
    fs.writeFileSync(tc, fs.readFileSync(tc, "utf8").split("forbiddenPaths").join("XXX"), "utf8");
    const { code, out } = runValidator(tree);
    assert.notStrictEqual(code, 0, "dropping a guarded contract field must fail the build");
    assert.match(out, /no longer documents the machine field "forbiddenPaths"/, "the failure must name the dropped field");
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
});

test("validate-structure: §5j FAILS CLOSED when review-packet.md drops a required template field", () => {
  const tree = copyRepoTree();
  try {
    const pk = path.join(tree, "cressetide", "skills", "vigil", "references", "review-packet.md");
    fs.writeFileSync(pk, fs.readFileSync(pk, "utf8").split("Verification evidence").join("XXX"), "utf8");
    const { code, out } = runValidator(tree);
    assert.notStrictEqual(code, 0, "dropping a packet template field must fail the build");
    assert.match(out, /review-packet\.md template is missing the required field/, "the failure must name the missing packet field");
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
});

test("validate-structure: §5j FAILS CLOSED when review-packet.md drops the Migration status field", () => {
  const tree = copyRepoTree();
  try {
    const pk = path.join(tree, "cressetide", "skills", "vigil", "references", "review-packet.md");
    fs.writeFileSync(pk, fs.readFileSync(pk, "utf8").split("Migration status").join("XXX"), "utf8");
    const { code, out } = runValidator(tree);
    assert.notStrictEqual(code, 0, "dropping the Migration status packet field must fail the build");
    assert.match(out, /review-packet\.md template is missing the required field/, "the failure must name the missing packet field");
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
});

test("validate-structure: a missing SKILL-linked reference FAILS", () => {
  const tree = copyRepoTree();
  try {
    // SKILL.md links references/review-packet.md; deleting it must be caught by the broken-ref check.
    fs.rmSync(path.join(tree, "cressetide", "skills", "vigil", "references", "review-packet.md"));
    const { code, out } = runValidator(tree);
    assert.notStrictEqual(code, 0, "a reference linked from SKILL.md but missing on disk must fail the build");
    assert.match(out, /missing reference/, "the failure must name the missing reference");
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
});

test("validate-structure: dropping a sentinel from the compact final-report template FAILS (5d guard)", () => {
  const tree = copyRepoTree();
  try {
    // The realistic single-edit regression: remove the verify sentinel from the compact (Default)
    // template fence. The 5d guard must bite — and must NOT be masked by the intro-prose copy of the
    // same literals. .replace() hits the FIRST occurrence, which is the compact fence (before the
    // --report full fence), so this deletes it from the default rendering specifically.
    const fr = path.join(tree, "cressetide", "skills", "vigil", "references", "final-report.md");
    fs.writeFileSync(fr, fs.readFileSync(fr, "utf8").replace("ctide:verify=<pass|fail|unrun|na>", "verify status omitted"), "utf8");
    const { code, out } = runValidator(tree);
    assert.notStrictEqual(code, 0, "dropping a sentinel from the compact template fence must fail the build");
    assert.match(out, /compact template is missing the machine-contract literal/, "the failure must name the 5d sentinel guard");
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
});

test("validate-structure: a mangled compact final-report fence fails CLOSED (5d guard)", () => {
  const tree = copyRepoTree();
  try {
    // Mangle the compact fence opener (first ~~~markdown = the compact fence). The region is bounded to
    // the compact section, so the guard must fail CLOSED — not fall through to the --report full fence
    // (which also holds the literals) and pass green.
    const fr = path.join(tree, "cressetide", "skills", "vigil", "references", "final-report.md");
    fs.writeFileSync(fr, fs.readFileSync(fr, "utf8").replace("~~~markdown", "```markdown"), "utf8");
    const { code, out } = runValidator(tree);
    assert.notStrictEqual(code, 0, "a mangled compact fence must fail closed, not fall through to the full fence");
    assert.match(out, /cannot locate the compact \(Default\)/, "the failure must name the fail-closed fence guard");
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
});

test("validate-structure: reverting the --report full cost table to a single Tokens column FAILS (5e guard)", () => {
  const tree = copyRepoTree();
  try {
    // Revert the billable-component header (Input/Output/Cache-write/Cache-read) back to the old
    // single-`Tokens` column in the --report full cost table; the 5e guard must bite (AC2 contract).
    const fr = path.join(tree, "cressetide", "skills", "vigil", "references", "final-report.md");
    fs.writeFileSync(fr, fs.readFileSync(fr, "utf8").replace(
      "| Agent / phase | Input | Output | Cache-write | Cache-read | New | Share | Source | ~Cost |",
      "| Agent / phase | Tokens | Share | Source | ~Cost |"), "utf8");
    const { code, out } = runValidator(tree);
    assert.notStrictEqual(code, 0, "dropping the billable-component columns must fail the build");
    assert.match(out, /billable-component column/, "the failure must name the 5e cost-column guard");
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
});

test("validate-structure: A6 dropping a guarded Fix-Class phrase from arbiter.agent.md FAILS (5f guard)", () => {
  const tree = copyRepoTree();
  try {
    // A6: the arbiter's Fix-Class safety rule (Extended-Safe / Residual; a Residual fix is "never
    // auto-applied") is a load-bearing contract. Removing the "never auto-applied" phrase must trip the
    // §5f contract-invariant guard so a prose edit can't silently gut the never-auto-ship rule.
    const gk = path.join(tree, "cressetide", "agents", "arbiter.agent.md");
    fs.writeFileSync(gk, fs.readFileSync(gk, "utf8").split("never auto-applied").join("XXX"), "utf8");
    const { code, out } = runValidator(tree);
    assert.notStrictEqual(code, 0, "dropping a guarded Fix-Class phrase must fail the build");
    assert.match(out, /never auto-applied/, "the failure must name the dropped Fix-Class literal");
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
});

test("validate-structure: missing validation workflow FAILS (release asset guard)", () => {
  const tree = copyRepoTree();
  try {
    fs.rmSync(path.join(tree, ".github", "workflows", "validate.yml"));
    const { code, out } = runValidator(tree);
    assert.notStrictEqual(code, 0, "missing validation workflow must fail closed");
    assert.match(out, /missing validation workflow/, "the failure must name the validation workflow guard");
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
});

test("validate-structure: missing release workflow FAILS (release asset guard)", () => {
  const tree = copyRepoTree();
  try {
    fs.rmSync(path.join(tree, ".github", "workflows", "release.yml"));
    const { code, out } = runValidator(tree);
    assert.notStrictEqual(code, 0, "missing release workflow must fail closed");
    assert.match(out, /missing release workflow/, "the failure must name the release workflow guard");
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
});

test("validate-structure: missing release publisher script FAILS (release asset guard)", () => {
  const tree = copyRepoTree();
  try {
    fs.rmSync(path.join(tree, ".github", "scripts", "publish-release.mjs"));
    const { code, out } = runValidator(tree);
    assert.notStrictEqual(code, 0, "missing release publisher script must fail closed");
    assert.match(out, /missing release publisher script/, "the failure must name the publisher script guard");
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
});

test("validate-structure: validation workflow must syntax-check the publisher script", () => {
  const tree = copyRepoTree();
  try {
    const p = path.join(tree, ".github", "workflows", "validate.yml");
    fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(
      "run: node --check .github/scripts/publish-release.mjs",
      "run: echo skipped-publisher-syntax-check"), "utf8");
    const { code, out } = runValidator(tree);
    assert.notStrictEqual(code, 0, "removing the publisher syntax check must fail closed");
    assert.match(out, /syntax-check/, "the failure must name the missing syntax-check contract");
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
});

test("validate-structure: a disabled decoy cannot satisfy the named syntax-check step", () => {
  const tree = copyRepoTree();
  try {
    const p = path.join(tree, ".github", "workflows", "validate.yml");
    let workflow = fs.readFileSync(p, "utf8").replace(
      "run: node --check .github/scripts/publish-release.mjs",
      "run: echo skipped-publisher-syntax-check");
    workflow += [
      "",
      "  disabled-decoy:",
      "    if: false # intentionally disabled",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - name: Syntax-check release publisher",
      "        run: node --check .github/scripts/publish-release.mjs",
      "",
    ].join("\n");
    fs.writeFileSync(p, workflow, "utf8");
    const { code, out } = runValidator(tree);
    assert.notStrictEqual(code, 0, "a disabled decoy job must not satisfy the validation workflow guard");
    assert.match(out, /validation job must syntax-check/, "the failure must name the scoped syntax-check contract");
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
});

test("validate-structure: the named publisher syntax check cannot be conditional or alter its shell semantics", () => {
  for (const mutate of [
    (workflow) => workflow.replace("  validate:\n", "  validate:\n    \"if\": false\n"),
    (workflow) => workflow.replace(
      "      - name: Syntax-check release publisher\n",
      "      - name: Syntax-check release publisher\n        'if': false\n"),
    (workflow) => workflow.replace(
      "      - name: Syntax-check release publisher\n",
      "      - name: Syntax-check release publisher\n        continue-on-error: true\n"),
    (workflow) => workflow.replace(
      "      - name: Syntax-check release publisher\n",
      "      - name: Syntax-check release publisher\n        shell: echo {0}\n"),
    (workflow) => workflow.replace(
      "  validate:\n",
      "  validate:\n    defaults:\n      run:\n        shell: echo {0}\n"),
    (workflow) => workflow.replace(
      "      - name: Syntax-check release publisher\n",
      "      - name: Syntax-check release publisher\n        working-directory: tools/release-noop\n"),
    (workflow) => workflow.replace(
      "  validate:\n",
      "  validate:\n    defaults:\n      run:\n        working-directory: tools/release-noop\n"),
  ]) {
    const tree = copyRepoTree();
    try {
      const p = path.join(tree, ".github", "workflows", "validate.yml");
      fs.writeFileSync(p, mutate(fs.readFileSync(p, "utf8")), "utf8");
      const { code, out } = runValidator(tree);
      assert.notStrictEqual(code, 0, "the named publisher syntax check must execute unconditionally in the default shell");
      assert.match(out, /validation job must syntax-check/, "the failure must name the fail-closed syntax-check contract");
    } finally { fs.rmSync(tree, { recursive: true, force: true }); }
  }
});

test("validate-structure: release workflow must delegate to the package publisher with an explicit tag", () => {
  const tree = copyRepoTree();
  try {
    const p = path.join(tree, ".github", "workflows", "release.yml");
    fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(
      "run: npm run release:publish -- --tag \"$RELEASE_TAG\"",
      "run: echo skipped-publisher"), "utf8");
    const { code, out } = runValidator(tree);
    assert.notStrictEqual(code, 0, "commented-out publisher command must fail closed");
    assert.match(out, /publish job must call/, "the failure must name the release delegation contract");
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
});

test("validate-structure: package release script must delegate to the publisher in publish mode", () => {
  const tree = copyRepoTree();
  try {
    const p = path.join(tree, "package.json");
    const pkg = JSON.parse(fs.readFileSync(p, "utf8"));
    pkg.scripts["release:publish"] = "node .github/scripts/publish-release.mjs --archive";
    fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + "\n", "utf8");
    const { code, out } = runValidator(tree);
    assert.notStrictEqual(code, 0, "package release delegation drift must fail closed");
    assert.match(out, /package\.json: release:publish/, "the failure must name the package release delegation contract");
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
});

test("validate-structure: a disabled duplicate cannot replace the named publish step", () => {
  const tree = copyRepoTree();
  try {
    const p = path.join(tree, ".github", "workflows", "release.yml");
    let workflow = fs.readFileSync(p, "utf8").replace(
      "run: npm run release:publish -- --tag \"$RELEASE_TAG\"",
      "run: echo skipped-publisher");
    workflow = workflow.replace("\n  attest:\n", [
      "",
      "      - name: Disabled duplicate publisher command",
      "        if: false",
      "        run: npm run release:publish -- --tag \"$RELEASE_TAG\"",
      "",
      "  attest:",
      "",
    ].join("\n"));
    fs.writeFileSync(p, workflow, "utf8");
    const { code, out } = runValidator(tree);
    assert.notStrictEqual(code, 0, "a disabled duplicate must not satisfy the named publish-step guard");
    assert.match(out, /publish job must call/, "the failure must name the scoped release delegation contract");
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
});

test("validate-structure: the publish job and named publisher step must be unconditional", () => {
  for (const mutate of [
    (workflow) => workflow.replace("  publish:\n", "  publish:\n    if: false # intentionally disabled\n"),
    (workflow) => workflow.replace(
      "      - name: Publish or verify immutable release assets\n",
      "      - name: Publish or verify immutable release assets\n        if: ${{ failure() }}\n"),
    (workflow) => workflow.replace(
      "      - name: Publish or verify immutable release assets\n",
      "      - name: Publish or verify immutable release assets\n        continue-on-error: true\n"),
    (workflow) => workflow.replace("  publish:\n", "  publish:\n    \"if\": false\n"),
    (workflow) => workflow.replace(
      "      - name: Publish or verify immutable release assets\n",
      "      - name: Publish or verify immutable release assets\n        'if': false\n"),
    (workflow) => workflow.replace(
      "      - name: Publish or verify immutable release assets\n",
      "      - name: Publish or verify immutable release assets\n        shell: echo {0}\n"),
    (workflow) => workflow.replace(
      "  publish:\n",
      "  publish:\n    defaults:\n      run:\n        shell: echo {0}\n"),
    (workflow) => workflow.replace(
      "      - name: Publish or verify immutable release assets\n",
      "      - name: Publish or verify immutable release assets\n        working-directory: tools/release-noop\n"),
    (workflow) => workflow.replace(
      "  publish:\n",
      "  publish:\n    defaults:\n      run:\n        working-directory: tools/release-noop\n"),
  ]) {
    const tree = copyRepoTree();
    try {
      const p = path.join(tree, ".github", "workflows", "release.yml");
      fs.writeFileSync(p, mutate(fs.readFileSync(p, "utf8")), "utf8");
      const { code, out } = runValidator(tree);
      assert.notStrictEqual(code, 0, "a conditional publish job or named publisher step must fail closed");
      assert.match(out, /publish job must call/, "the failure must name the unconditional release contract");
    } finally { fs.rmSync(tree, { recursive: true, force: true }); }
  }
});

test("validate-structure: NOT READY example must stay marked non-evidence", () => {
  const tree = copyRepoTree();
  try {
    const p = path.join(tree, "examples", "not-ready-run.md");
    fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace("not counted as evidence", "evidence claim removed"), "utf8");
    const { code, out } = runValidator(tree);
    assert.notStrictEqual(code, 0, "illustrative NOT READY example must not lose its non-evidence marker");
    assert.match(out, /required provenance marker/, "the failure must name the provenance guard");
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
});

test("validate-structure: illustrative packet/report examples must keep their disclaimers", () => {
  for (const [rel, marker] of [
    ["examples/review-packet.md", "not a historical run"],
    ["examples/final-report-compact.md", "Values in angle brackets must be replaced"],
    ["examples/final-report-full.md", "not a historical run or evidence record"],
  ]) {
    const tree = copyRepoTree();
    try {
      const p = path.join(tree, rel);
      fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(marker, "claim removed"), "utf8");
      const { code, out } = runValidator(tree);
      assert.notStrictEqual(code, 0, `${rel} must not lose its illustrative/provenance marker`);
      assert.match(out, /required provenance marker/, "the failure must name the provenance guard");
    } finally { fs.rmSync(tree, { recursive: true, force: true }); }
  }
});

test("validate-structure: a shipped forbidden artifact FAILS (distribution hygiene)", () => {
  const tree = copyRepoTree();
  try {
    // A package.json inside the shipped plugin subdir is a dev artifact that must never ship.
    fs.writeFileSync(path.join(tree, "cressetide", "package.json"), '{"name":"leak"}', "utf8");
    const { code, out } = runValidator(tree);
    assert.notStrictEqual(code, 0, "a runtime/dev artifact in the shipped tree must fail the build");
    assert.match(out, /distribution hygiene/, "the failure must name the distribution-hygiene check");
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
});

test("validate-structure: a missing CHANGELOG entry for the current version FAILS", () => {
  const tree = copyRepoTree();
  try {
    const ver = JSON.parse(fs.readFileSync(path.join(tree, "cressetide", ".claude-plugin", "plugin.json"), "utf8")).version;
    const cl = path.join(tree, "CHANGELOG.md");
    // Mangle the heading for the current version so the "## [<version>]" check can't find it.
    fs.writeFileSync(cl, fs.readFileSync(cl, "utf8").replace(`## [${ver}]`, "## [_removed_for_test_]"), "utf8");
    const { code, out } = runValidator(tree);
    assert.notStrictEqual(code, 0, "a missing CHANGELOG entry for the manifest version must fail the build");
    assert.match(out, /CHANGELOG\.md has no/, "the failure must name the missing CHANGELOG entry");
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
});

test("validate-structure: a hook dropped from its event FAILS (wiring gate)", () => {
  const tree = copyRepoTree();
  try {
    const hjPath = path.join(tree, "cressetide", "hooks", "hooks.json");
    const hj = JSON.parse(fs.readFileSync(hjPath, "utf8"));
    delete hj.hooks.Stop; // orchestration-check.js no longer wired to any event
    fs.writeFileSync(hjPath, JSON.stringify(hj, null, 2), "utf8");
    const { code, out } = runValidator(tree);
    assert.notStrictEqual(code, 0, "dropping a hook from its event must fail the build");
    assert.match(out, /Stop does not wire orchestration-check\.js/, "the failure must name the unwired hook");
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
});

test("validate-structure: a PreToolUse matcher that stops covering a gated tool FAILS (wiring gate)", () => {
  const tree = copyRepoTree();
  try {
    const hjPath = path.join(tree, "cressetide", "hooks", "hooks.json");
    const hj = JSON.parse(fs.readFileSync(hjPath, "utf8"));
    hj.hooks.PreToolUse[0].matcher = "Write|Edit"; // drops MultiEdit / NotebookEdit / Bash
    fs.writeFileSync(hjPath, JSON.stringify(hj, null, 2), "utf8");
    const { code, out } = runValidator(tree);
    assert.notStrictEqual(code, 0, "narrowing the matcher below the gated tools must fail the build");
    assert.match(out, /PreToolUse matcher does not cover "Bash"/, "the failure must name the uncovered tool");
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
});

// --- The PowerShell wiring token is CI-locked (a regression to Bash-only must fail the build) ---

test("validate-structure: a plan-gate.js matcher that drops PowerShell coverage FAILS", () => {
  const tree = copyRepoTree();
  try {
    const hjPath = path.join(tree, "cressetide", "hooks", "hooks.json");
    const hj = JSON.parse(fs.readFileSync(hjPath, "utf8"));
    hj.hooks.PreToolUse[0].matcher = "Write|Edit|MultiEdit|NotebookEdit|Bash"; // plan-gate entry: PowerShell dropped
    fs.writeFileSync(hjPath, JSON.stringify(hj, null, 2), "utf8");
    const { code, out } = runValidator(tree);
    assert.notStrictEqual(code, 0, "narrowing the plan-gate matcher to drop PowerShell must fail the build");
    assert.match(out, /PreToolUse matcher does not cover "PowerShell"/, "the failure must name the uncovered PowerShell token");
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
});

test("validate-structure: a destructive-guard.js matcher that drops PowerShell coverage FAILS", () => {
  const tree = copyRepoTree();
  try {
    const hjPath = path.join(tree, "cressetide", "hooks", "hooks.json");
    const hj = JSON.parse(fs.readFileSync(hjPath, "utf8"));
    hj.hooks.PreToolUse[1].matcher = "Bash"; // destructive-guard entry: PowerShell dropped
    fs.writeFileSync(hjPath, JSON.stringify(hj, null, 2), "utf8");
    const { code, out } = runValidator(tree);
    assert.notStrictEqual(code, 0, "narrowing the destructive-guard matcher to drop PowerShell must fail the build");
    assert.match(out, /PreToolUse matcher does not cover "PowerShell"/, "the failure must name the uncovered PowerShell token");
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
});

// --- Matcher coverage is bound to the hook's own entry (cross-entry merge gap) ---

test("validate-structure: a second event entry can no longer cover another hook's matcher gap (scoped wiring gate)", () => {
  // Narrow plan-gate's OWN entry to drop MultiEdit, and add a SECOND PreToolUse entry that wires an
  // existing, README-named hook and whose matcher DOES cover MultiEdit. Under the old merged `.some()`
  // logic the gate passed (some entry covered MultiEdit); the scoped check must now fail because
  // plan-gate's own entry does not cover it.
  const tree = copyRepoTree();
  try {
    const hjPath = path.join(tree, "cressetide", "hooks", "hooks.json");
    const hj = JSON.parse(fs.readFileSync(hjPath, "utf8"));
    const pre = hj.hooks.PreToolUse;
    pre[0].matcher = "Write|Edit|NotebookEdit|Bash"; // plan-gate entry: MultiEdit dropped
    pre.push({ matcher: "MultiEdit", hooks: [{ type: "command", command: pre[0].hooks[0].command.replace("plan-gate.js", "load-failure-memory.js") }] });
    fs.writeFileSync(hjPath, JSON.stringify(hj, null, 2), "utf8");
    const { code, out } = runValidator(tree);
    assert.notStrictEqual(code, 0, "a different entry's matcher must not satisfy plan-gate's own coverage");
    assert.match(out, /matcher does not cover "MultiEdit"/, "the failure must name the token plan-gate's own entry omits");
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
});

// --- Section 9 "garden" guards: one injected-defect negative test per check (a–e) ---

test("validate-structure: garden 9a FAILS on an orphan reference file not mentioned in SKILL.md", () => {
  const tree = copyRepoTree();
  try {
    // A reference file nothing links: SKILL.md's Reference Loading list never names it.
    fs.writeFileSync(path.join(tree, "cressetide", "skills", "vigil", "references", "zz-orphan.md"),
      "# Orphan reference\n\nDead weight the workflow can never load.\n", "utf8");
    const { code, out } = runValidator(tree);
    assert.notStrictEqual(code, 0, "an orphan reference must fail the build");
    assert.match(out, /garden 9a: .*zz-orphan\.md is not mentioned by filename in SKILL\.md/, "the failure must name the orphan reference");
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
});

test("validate-structure: garden 9b FAILS in both agent-parity directions (unlisted on disk / ghost in manifest)", () => {
  // Direction 1: an agent file on disk that plugin.json agents[] does not list (it would never load).
  let tree = copyRepoTree();
  try {
    fs.writeFileSync(path.join(tree, "cressetide", "agents", "zz-unlisted.agent.md"),
      "---\nname: zz-unlisted\ndescription: parity-test agent not wired in the manifest\n---\n\nBody.\n", "utf8");
    const { code, out } = runValidator(tree);
    assert.notStrictEqual(code, 0, "an on-disk agent missing from plugin.json agents[] must fail the build");
    assert.match(out, /garden 9b: .*zz-unlisted\.agent\.md exists on disk but is not listed in plugin\.json/, "the failure must name the unlisted agent");
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
  // Direction 2: a plugin.json agents[] entry whose file does not exist on disk.
  tree = copyRepoTree();
  try {
    const pj = path.join(tree, "cressetide", ".claude-plugin", "plugin.json");
    const obj = JSON.parse(fs.readFileSync(pj, "utf8"));
    obj.agents.push("./agents/ghost.agent.md");
    fs.writeFileSync(pj, JSON.stringify(obj, null, 2), "utf8");
    const { code, out } = runValidator(tree);
    assert.notStrictEqual(code, 0, "a manifest agent entry with no file on disk must fail the build");
    assert.match(out, /garden 9b: plugin\.json agents\[\] lists ".\/agents\/ghost\.agent\.md" but .* does not exist on disk/, "the failure must name the ghost manifest entry");
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
});

test("validate-structure: garden 9c FAILS when SKILL.md grows past the agreed size cap", () => {
  const tree = copyRepoTree();
  try {
    // Size-independent overshoot: 64 KB of growth exceeds the cap from ANY
    // plausible base size or future cap raise, so a later SKILL.md compression pass can't
    // silently defuse this negative.
    const skill = path.join(tree, "cressetide", "skills", "vigil", "SKILL.md");
    fs.appendFileSync(skill, "\n" + "x".repeat(65536) + "\n", "utf8");
    const { code, out } = runValidator(tree);
    assert.notStrictEqual(code, 0, "SKILL.md growing past the cap must fail the build");
    assert.match(out, /garden 9c: .*SKILL\.md is \d+ bytes and grew past the agreed cap \(30000\)/, "the failure must name the cap and the actual size");
    assert.match(out, /consciously raise the cap/, "the failure must state the conscious-override path");
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
});

test("validate-structure: garden 9d FAILS on drift in each guarded copy cluster (dd regex / debug body / packet anchor)", () => {
  for (const [mutate, expected] of [
    // d1: one character of destructive-guard's dd-of= regex changes -> the documented
    // character-identical pair with plan-gate.js is broken.
    [(tree) => {
      const p = path.join(tree, "cressetide", "hooks", "destructive-guard.js");
      fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace("NUL\\b))/i,", "NULL\\b))/i,"), "utf8");
    }, /garden 9d: the dd-of= regex drifted between plan-gate\.js and destructive-guard\.js/],
    // d2: one hook's debug() body drifts from the other five documented copies.
    [(tree) => {
      const p = path.join(tree, "cressetide", "hooks", "compact-fidelity.js");
      fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace("ctide-hook.log", "ctide-hook2.log"), "utf8");
    }, /garden 9d: debug\(\) drifted between .*compact-fidelity\.js/],
    // d3 (§5k extension): a packet-block rule drops out of review-packet.md while
    // reviewer-common.md still has it — a one-sided drift.
    [(tree) => {
      const p = path.join(tree, "cressetide", "skills", "vigil", "references", "review-packet.md");
      fs.writeFileSync(p, fs.readFileSync(p, "utf8").split("materially underspecified").join("XXX"), "utf8");
    }, /rigor-contract guard: .*review-packet\.md no longer contains the anchor "materially underspecified"/],
    // d2 (stdin cluster): a hook loses its stdin-reader sync stamp
    // (stamps must not point at a guard that would let them silently rot).
    [(tree) => {
      const p = path.join(tree, "cressetide", "hooks", "orchestration-check.js");
      fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace("stdin reader kept in sync with", "stdin reader formerly synced with"), "utf8");
    }, /garden 9d: .*orchestration-check\.js lost the stdin-reader sync marker/],
  ]) {
    const tree = copyRepoTree();
    try {
      mutate(tree);
      const { code, out } = runValidator(tree);
      assert.notStrictEqual(code, 0, `a drifted documented copy must fail the build (${expected})`);
      assert.match(out, expected, "the failure must name the drifted pair/anchor");
    } finally { fs.rmSync(tree, { recursive: true, force: true }); }
  }
});

test("validate-structure: garden 9e FAILS on a bare plugin-script invocation missing ${CLAUDE_PLUGIN_ROOT}", () => {
  const tree = copyRepoTree();
  try {
    // Strip the plugin-root prefix from a shipped invocation.
    const vg = path.join(tree, "cressetide", "skills", "vigil", "references", "verification-gate.md");
    fs.writeFileSync(vg, fs.readFileSync(vg, "utf8").replace(
      "node ${CLAUDE_PLUGIN_ROOT}/skills/vigil/scripts/failure-retrieve.mjs",
      "node skills/vigil/scripts/failure-retrieve.mjs"), "utf8");
    const { code, out } = runValidator(tree);
    assert.notStrictEqual(code, 0, "a bare plugin-script invocation in a shipped .md must fail the build");
    assert.match(out, /garden 9e: .*verification-gate\.md:\d+ invokes a plugin script without the plugin root/, "the failure must name the file:line and the fix");
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
});

test("validate-structure: garden 9f FAILS when any operational-readiness trust-marker enumeration site drops a tier", () => {
  // The 3-tier trust marker (verified: <date> / dry-run-verified: <date> / UNVERIFIED)
  // must stay enumerated in full at all 6 current-facing sites. Prove §9f goes RED when a tier is
  // dropped at EACH site (middle-tier ×6), the top-tier lookbehind, the UNVERIFIED tier, and §9f's own
  // anchor-drift fail-closed branch (case 9). Each find-string is copied verbatim from the live file;
  // the notStrictEqual assert fails loudly if an edit makes one stop matching (the always-green
  // fixture-drift trap, hit twice here).
  const OPS = ["cressetide", "skills", "map", "references", "operational-readiness.md"];
  const cases = [
    // --- middle tier (dry-run-verified) dropped, one row per current-facing enumeration site ---
    // ops-profile.md intro prose (the token appears 4x in this file, so anchor with prose context)
    { file: OPS,
      find: "(a human actually ran it on that date), `dry-run-verified: <date>` (the agent",
      repl: "(a human actually ran it on that date), (the agent",
      expected: /operational-readiness\.md.*\("carries a trust marker"\).*missing tier\(s\): dry-run-verified: <date>/ },
    // ops-profile.md Rollback "Exact steps" line (full parenthetical, unique via "in order>")
    { file: OPS,
      find: "in order>  (verified: <date> | dry-run-verified: <date> | UNVERIFIED)",
      repl: "in order>  (verified: <date> | UNVERIFIED)",
      expected: /operational-readiness\.md.*\("Exact steps: <commands, in order>"\).*missing tier\(s\): dry-run-verified: <date>/ },
    // ops-profile.md feature-flags line (full parenthetical, unique via "how to flip it>")
    { file: OPS,
      find: "how to flip it>  (verified: <date> | dry-run-verified: <date> | UNVERIFIED)",
      repl: "how to flip it>  (verified: <date> | UNVERIFIED)",
      expected: /operational-readiness\.md.*\("how to flip it"\).*missing tier\(s\): dry-run-verified: <date>/ },
    // README.md (English)
    { file: ["README.md"],
      find: "`verified: <date>`, `dry-run-verified: <date>`, or `UNVERIFIED`",
      repl: "`verified: <date>`, or `UNVERIFIED`",
      expected: /garden 9f: README\.md.*missing tier\(s\): dry-run-verified: <date>/ },
    // README.zh-TW.md
    { file: ["README.zh-TW.md"],
      find: "`verified: <date>`、`dry-run-verified: <date>` 或 `UNVERIFIED`",
      repl: "`verified: <date>` 或 `UNVERIFIED`",
      expected: /garden 9f: README\.zh-TW\.md.*missing tier\(s\): dry-run-verified: <date>/ },
    // README.ja.md
    { file: ["README.ja.md"],
      find: "`verified: <date>`、`dry-run-verified: <date>` または `UNVERIFIED`",
      repl: "`verified: <date>` または `UNVERIFIED`",
      expected: /garden 9f: README\.ja\.md.*missing tier\(s\): dry-run-verified: <date>/ },
    // --- top tier (verified) dropped: leaves the dry-run-verified token, so this only goes RED if the
    //     (?<!dry-run-) lookbehind correctly ignores the "verified: <date>" substring inside it ---
    { file: OPS,
      find: "`verified: <date>` (a human actually ran it on that date), ",
      repl: "",
      expected: /operational-readiness\.md.*\("carries a trust marker"\).*missing tier\(s\): verified: <date>/ },
    // --- UNVERIFIED tier dropped (first full parenthetical = the Rollback "Exact steps" line) ---
    { file: OPS,
      find: "(verified: <date> | dry-run-verified: <date> | UNVERIFIED)",
      repl: "(verified: <date> | dry-run-verified: <date>)",
      expected: /operational-readiness\.md.*\("Exact steps: <commands, in order>"\).*missing tier\(s\): UNVERIFIED/ },
    // --- anchor-drift branch: rename an anchor (tiers left INTACT) so the site's line no longer
    //     matches → the matched.length!==1 fail-closed path fires. This branch is §9f's OWN
    //     always-green protection, so it must be exercised too (the exact rot class guarded here). ---
    { file: OPS,
      find: "how to flip it>  (verified: <date> | dry-run-verified: <date> | UNVERIFIED)",
      repl: "how to toggle it>  (verified: <date> | dry-run-verified: <date> | UNVERIFIED)",
      expected: /garden 9f: .*operational-readiness\.md.*anchor "how to flip it" matched 0 line\(s\), expected 1/ },
  ];
  for (const { file, find, repl, expected } of cases) {
    const tree = copyRepoTree();
    try {
      const p = path.join(tree, ...file);
      const before = fs.readFileSync(p, "utf8");
      const after = before.replace(find, repl);
      assert.notStrictEqual(after, before, `fixture drift: find-string no longer matches in ${file.join("/")} (${expected})`);
      fs.writeFileSync(p, after, "utf8");
      const { code, out } = runValidator(tree);
      assert.notStrictEqual(code, 0, `dropping a trust-marker tier must fail the build (${expected})`);
      assert.match(out, expected, "the failure must name the site and the missing tier");
    } finally { fs.rmSync(tree, { recursive: true, force: true }); }
  }
});

// --- §6b .ctide hygiene: the /.ctide/ gitignore line + the tracked-content git guard ---

test("validate-structure: 6b FAILS when .gitignore loses the /.ctide/ line", () => {
  // Discriminating: without the 6b check the validator passes this tree (nothing else reads .gitignore).
  const tree = copyRepoTree();
  try {
    const gi = path.join(tree, ".gitignore");
    fs.writeFileSync(gi, fs.readFileSync(gi, "utf8").split(/\r?\n/).filter((l) => l.trim() !== "/.ctide/").join("\n"), "utf8");
    const { code, out } = runValidator(tree);
    assert.notStrictEqual(code, 0, "dropping the /.ctide/ gitignore line must fail the build");
    assert.match(out, /.ctide hygiene: \.gitignore has no "\/.ctide\/" line/, "the failure must name the missing gitignore line");
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
});

test("validate-structure: 6b FAILS when the .gitignore FILE itself is missing", () => {
  // Sibling branch to the line-drop negative above: a tree with no .gitignore at all must hit 6b's
  // file-missing arm (not silently pass), since without the file the /.ctide/ line cannot exist either.
  const tree = copyRepoTree();
  try {
    fs.rmSync(path.join(tree, ".gitignore"), { force: true });
    const { code, out } = runValidator(tree);
    assert.notStrictEqual(code, 0, "a tree with no .gitignore must fail the build");
    assert.match(out, /.ctide hygiene: \.gitignore is missing/, "the failure must name the missing .gitignore file");
  } finally { fs.rmSync(tree, { recursive: true, force: true }); }
});

test("validate-structure: 6b FAILS on tracked content under .ctide/ (git-index guard), naming the path", (t) => {
  // The temp copy is not a git work tree (the guard skips silently there — that is the fail-open half),
  // so make it one: git init + stage a planted runtime file, then the ls-files guard must bite.
  const tree = copyRepoTree();
  try {
    const init = cp.spawnSync("git", ["init", "-q"], { cwd: tree, encoding: "utf8" });
    if (init.error || init.status !== 0) return t.skip("git unavailable here: cannot exercise the ls-files guard");
    fs.mkdirSync(path.join(tree, ".ctide", "memory"), { recursive: true });
    fs.writeFileSync(path.join(tree, ".ctide", "memory", "FAILURE_MEMORY.md"), "# leaked runtime output\n", "utf8");
    const add = cp.spawnSync("git", ["add", "-f", ".ctide/memory/FAILURE_MEMORY.md"], { cwd: tree, encoding: "utf8" });
    if (add.error || add.status !== 0) return t.skip("git add failed here: cannot stage the planted leak");
    const { code, out } = runValidator(tree);
    assert.notStrictEqual(code, 0, "a tracked .ctide/ path must fail the build");
    assert.match(out, /.ctide hygiene: tracked path\(s\) under .ctide\//, "the failure must name the tracked-content guard");
    assert.match(out, /.ctide\/memory\/FAILURE_MEMORY\.md/, "the failure must name the offending path");
  } finally {
    // .git object files are read-only on Windows; never let cleanup failure mask the verdict.
    try { fs.rmSync(tree, { recursive: true, force: true, maxRetries: 3 }); } catch (e) {}
  }
});

test("validate-structure: 6b control — an UNTRACKED .ctide/ tree in a git work tree still passes", (t) => {
  // The guard forbids TRACKED content only; a normal dogfood run's untracked .ctide/ output (plus the
  // /.ctide/ gitignore line) is the sanctioned state and must stay green.
  const tree = copyRepoTree();
  try {
    const init = cp.spawnSync("git", ["init", "-q"], { cwd: tree, encoding: "utf8" });
    if (init.error || init.status !== 0) return t.skip("git unavailable here: cannot exercise the ls-files guard");
    fs.mkdirSync(path.join(tree, ".ctide", "output"), { recursive: true });
    fs.writeFileSync(path.join(tree, ".ctide", "output", "contract.md"), "# run scratch\n", "utf8");
    const { code, out } = runValidator(tree);
    assert.strictEqual(code, 0, "untracked .ctide/ content must not fail the build: " + out);
  } finally {
    try { fs.rmSync(tree, { recursive: true, force: true, maxRetries: 3 }); } catch (e) {}
  }
});
