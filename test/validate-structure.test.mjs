// Negative-path tests for the CI structure validator (.github/scripts/validate-structure-core.mjs): each
// guard must FAIL on an injected defect, plus clean controls. Defects are injected IN MEMORY: validate()
// reads every file through `read`, and its scratch-file / text-integrity / tracked-.ctide scans read the
// `files` lists, so an overlay of both over the real checkout is exactly the tree the validator would see
// on disk — no repository copies.
import assert from "node:assert";
import cp from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { diskReader, gitFiles, validate } from "../.github/scripts/validate-structure-core.mjs";
import { git, makeRepo, root, tempDir, test } from "./helpers.mjs";

const CLI = path.join(root, ".github", "scripts", "validate-structure.mjs");

// --- Overlay harness ---
// The real checkout, read once per process and shared by every overlay.
const disk = diskReader(root);
const fileMemo = new Map();
const listMemo = new Map();
const base = {
  file(rel) {
    if (!fileMemo.has(rel)) fileMemo.set(rel, disk.file(rel));
    return fileMemo.get(rel);
  },
  list(rel) {
    if (!listMemo.has(rel)) listMemo.set(rel, disk.list(rel));
    return listMemo.get(rel);
  },
};
let baseFilesMemo;
function baseFiles() {
  if (baseFilesMemo === undefined) {
    baseFilesMemo = gitFiles(root);
    if (baseFilesMemo === null) {
      // Not a git work tree (e.g. an unpacked archive): treat every file the validator's own fallback walk
      // would see as tracked, so overlays still have a `files` view to edit.
      const walk = (dir) => (base.list(dir) || []).flatMap((e) => {
        if ([".git", "node_modules", ".ctide", "_release"].includes(e.name)) return [];
        const rel = dir ? `${dir}/${e.name}` : e.name;
        return e.dir ? walk(rel) : [rel];
      });
      const all = walk("");
      baseFilesMemo = { scan: all, tracked: all };
    }
  }
  return baseFilesMemo;
}

// overlay(edits, { tracked, ignored }) -> { read, files } over the real checkout.
//   edits:   { "posix/rel/path": string | Buffer | null (delete) | (originalText) => string }
//   tracked: extra paths to report as tracked by git (the index)
//   ignored: added paths git would ignore (kept out of files.scan)
function overlay(edits = {}, { tracked = [], ignored = [] } = {}) {
  const content = new Map();
  for (const [rel, edit] of Object.entries(edits)) {
    let next = edit;
    if (typeof edit === "function") {
      const original = base.file(rel);
      assert.ok(original !== null, `overlay: cannot transform ${rel}, it does not exist in the checkout`);
      next = edit(original.toString("utf8"));
    }
    content.set(rel, next === null ? null : Buffer.isBuffer(next) ? next : Buffer.from(next, "utf8"));
  }
  const added = [...content].filter(([rel, value]) => value !== null && base.file(rel) === null).map(([rel]) => rel);
  const removed = [...content].filter(([, value]) => value === null).map(([rel]) => rel);
  const read = {
    file: (rel) => (content.has(rel) ? content.get(rel) : base.file(rel)),
    list(rel) {
      const prefix = rel === "" ? "" : `${rel}/`;
      const baseEntries = base.list(rel);
      const entries = new Map((baseEntries || []).map((e) => [e.name, e]));
      for (const r of removed) {
        if (r.startsWith(prefix) && !r.slice(prefix.length).includes("/")) entries.delete(r.slice(prefix.length));
      }
      let implied = false;
      for (const a of added) {
        if (!a.startsWith(prefix)) continue;
        const [name, ...rest] = a.slice(prefix.length).split("/");
        implied = true;
        if (!entries.has(name)) entries.set(name, { name, dir: rest.length > 0 });
      }
      return baseEntries === null && !implied ? null : [...entries.values()];
    },
  };
  const { scan, tracked: baseTracked } = baseFiles();
  const hidden = new Set([...removed, ...ignored]);
  return {
    read,
    files: {
      scan: [...new Set([...scan, ...added])].filter((rel) => !hidden.has(rel)),
      tracked: [...baseTracked, ...tracked],
    },
  };
}
const check = (edits, opts) => validate({ root, ...overlay(edits, opts) });
// Same shape the CLI-based tests used, so every ported assertion stays verbatim.
function runOverlay(edits, opts) {
  const errors = check(edits, opts);
  return { code: errors.length ? 1 : 0, out: errors.join("\n") };
}
const editJSON = (mutate) => (text) => {
  const obj = JSON.parse(text);
  mutate(obj);
  return JSON.stringify(obj, null, 2) + "\n";
};

// --- validate-structure CI guards: negative-path coverage ---
// The text-integrity (U+FFFD) and multilingual-README-parity checks are fail-only guards; lock in that they
// actually FAIL on a violation (not merely pass on the clean tree) by running the real validator against an
// overlay of the repo with one injected defect. A future edit that silently disables a guard breaks these.

test("validate-structure: passes on a clean copy of the repo (control)", () => {
  assert.deepStrictEqual(check({}), [], "the validator must pass on the unmodified tree");
});

test("structure validator passes the complete repository", () => {
  // In-process, straight from disk and git (no overlay, no timer): the default reader and file lists.
  assert.deepStrictEqual(validate({ root }), []);
});

test("validate-structure: the CLI passes from a foreign cwd (root resolves from the script, not the cwd)", () => {
  const cwd = tempDir("ctide-validate-cwd-");
  const r = cp.spawnSync(process.execPath, [CLI], { cwd, encoding: "utf8" });
  assert.strictEqual(r.status, 0, `the CLI must validate its own repository from any cwd: ${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /Plugin structure validation passed\./);
});

test("validate-structure: validate() requires an explicit root (never the process cwd)", () => {
  assert.throws(() => validate({}), TypeError);
  assert.throws(() => validate(), TypeError);
});

test("validate-structure: gitFiles lists tracked + untracked-not-ignored files and is null outside a work-tree top", () => {
  const dir = tempDir("ctide-gitfiles-");
  const repo = makeRepo({ prefix: "ctide-gitfiles-repo-" });
  const plain = path.join(dir, "plain");
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), text, "utf8");
  };
  fs.mkdirSync(plain);
  // Hermetic ignore rules: a contributor's global excludes file must not decide what counts as ignored.
  fs.writeFileSync(path.join(dir, "empty-excludes"), "", "utf8");
  git(repo, ["config", "core.excludesFile", path.join(dir, "empty-excludes")]);
  write(".gitignore", "ignored.md\n*.log\n/.ctide/\n.claude/settings.local.json\n");
  write("keep.md", "tracked\n");
  write("sub/nested.md", "tracked in a subdirectory\n");
  write("ignored.md", "ignored, so out of scope\n");
  write("_x.md", "untracked and not ignored, so scanned\n");
  write("x.log", "ignored by *.log but force-added, so tracked\n");
  // The two run-scratch locations the old repo copy had to filter out by hand: git's ignore rules now
  // keep them out of the scan.
  write(".ctide/output/run.md", "run scratch\n");
  write(".claude/settings.local.json", "{}\n");
  git(repo, ["add", ".gitignore", "keep.md", "sub/nested.md"]);
  git(repo, ["add", "-f", "x.log"]);

  const files = gitFiles(repo);
  assert.ok(files, "the top of a git work tree must yield file lists");
  assert.deepStrictEqual([...files.scan].sort(), [".gitignore", "_x.md", "keep.md", "sub/nested.md", "x.log"]);
  assert.deepStrictEqual([...files.tracked].sort(), [".gitignore", "keep.md", "sub/nested.md", "x.log"]);
  assert.ok(!files.scan.some((p) => p.startsWith(".ctide/")), "ignored run-scratch .ctide/ must not be scanned");
  assert.ok(!files.scan.some((p) => p.startsWith(".claude/")), "machine-private .claude/ must not be scanned");
  assert.strictEqual(gitFiles(path.join(repo, "sub")), null, "a subdirectory of a work tree is not a validation root");
  assert.strictEqual(gitFiles(plain), null, "a plain directory has no git file lists");
});

test("validate-structure: text-integrity check FAILS on a planted U+FFFD", () => {
  const { code, out } = runOverlay({ "README.md": (s) => s + "\nmojibake " + String.fromCharCode(0xFFFD) + " here\n" });
  assert.notStrictEqual(code, 0, "a tracked text file with U+FFFD must fail the build");
  assert.match(out, /text integrity/, "the failure must name the text-integrity check");
});

test("validate-structure: text-integrity check FAILS on known mojibake markers", () => {
  const { code, out } = runOverlay({ "README.md": (s) => s + "\nmojibake " + String.fromCodePoint(0x7AB6) + " marker\n" });
  assert.notStrictEqual(code, 0, "a known mojibake marker must fail the build");
  assert.match(out, /suspicious mojibake marker/, "the failure must name the mojibake marker guard");
});

test("validate-structure: README parity FAILS on a top-level section-count mismatch", () => {
  const { code, out } = runOverlay({ "README.md": (s) => s + "\n## An English-only extra section\n\nbody\n" });
  assert.notStrictEqual(code, 0, "an asymmetric ## section count must fail the build");
  assert.match(out, /README parity/, "the failure must name README parity");
});

test("validate-structure: README parity FAILS when the zh README omits a wired hook name", () => {
  const { code, out } = runOverlay({ "README.zh-TW.md": (s) => s.split("plan-gate").join("PLANGATE_removed") });
  assert.notStrictEqual(code, 0, "zh omitting a wired hook name must fail the build");
  assert.match(out, /plan-gate/, "the failure must name the missing hook");
});

test("validate-structure: README parity FAILS when either README drops a required entry link", () => {
  const { code, out } = runOverlay({ "README.zh-TW.md": (s) => s.replace("template=verified-run.yml", "template=removed.yml") });
  assert.notStrictEqual(code, 0, "README entry links must stay present in both languages");
  assert.match(out, /missing required entry link/, "the failure must name the missing README link");
});

test("validate-structure: README parity FAILS when the ja README omits a wired hook name", () => {
  const { code, out } = runOverlay({ "README.ja.md": (s) => s.split("plan-gate").join("PLANGATE_removed") });
  assert.notStrictEqual(code, 0, "ja omitting a wired hook name must fail the build");
  assert.match(out, /plan-gate/, "the failure must name the missing hook");
});

test("validate-structure: README parity FAILS when the ja README drops a required entry link", () => {
  const { code, out } = runOverlay({ "README.ja.md": (s) => s.replace("template=verified-run.yml", "template=removed.yml") });
  assert.notStrictEqual(code, 0, "README entry links must stay present in every language");
  assert.match(out, /missing required entry link/, "the failure must name the missing README link");
});

test("validate-structure: README parity FAILS when a translated README is deleted", () => {
  const { code, out } = runOverlay({ "README.ja.md": null });
  assert.notStrictEqual(code, 0, "deleting a translated README must fail the build");
  assert.match(out, /README\.ja\.md is missing/, "the failure must name the missing translated README");
});

test("validate-structure: a version mismatch across manifests FAILS", () => {
  const { code, out } = runOverlay({
    "cressetide/.claude-plugin/plugin.json": editJSON((obj) => { obj.version = "9.9.9"; }), // disagree with package.json / CHANGELOG
  });
  assert.notStrictEqual(code, 0, "a version that disagrees across manifests must fail the build");
  assert.match(out, /version mismatch/, "the failure must name the version mismatch");
});

test("validate-structure: §5j FAILS CLOSED when task-contract.md drops a guarded machine field", () => {
  // Strip every occurrence of a field contract-check.mjs reads; the §5j guard must bite so a prose
  // edit can't silently gut the deterministic inputs while CI stays green (mirrors the 5d/5e guards).
  const { code, out } = runOverlay({
    "cressetide/skills/vigil/references/task-contract.md": (s) => s.split("forbiddenPaths").join("XXX"),
  });
  assert.notStrictEqual(code, 0, "dropping a guarded contract field must fail the build");
  assert.match(out, /no longer documents the machine field "forbiddenPaths"/, "the failure must name the dropped field");
});

test("validate-structure: §5j FAILS CLOSED when review-packet.md drops a required template field", () => {
  const { code, out } = runOverlay({
    "cressetide/skills/vigil/references/review-packet.md": (s) => s.split("Verification evidence").join("XXX"),
  });
  assert.notStrictEqual(code, 0, "dropping a packet template field must fail the build");
  assert.match(out, /review-packet\.md template is missing the required field/, "the failure must name the missing packet field");
});

test("validate-structure: §5j FAILS CLOSED when review-packet.md drops the Migration status field", () => {
  const { code, out } = runOverlay({
    "cressetide/skills/vigil/references/review-packet.md": (s) => s.split("Migration status").join("XXX"),
  });
  assert.notStrictEqual(code, 0, "dropping the Migration status packet field must fail the build");
  assert.match(out, /review-packet\.md template is missing the required field/, "the failure must name the missing packet field");
});

test("validate-structure: a missing SKILL-linked reference FAILS", () => {
  // SKILL.md links references/review-packet.md; deleting it must be caught by the broken-ref check.
  const { code, out } = runOverlay({ "cressetide/skills/vigil/references/review-packet.md": null });
  assert.notStrictEqual(code, 0, "a reference linked from SKILL.md but missing on disk must fail the build");
  assert.match(out, /missing reference/, "the failure must name the missing reference");
});

test("validate-structure: §5b FAILS on a dangling reference planted in a non-vigil skill's SKILL.md (widened coverage)", () => {
  // §5b's reference-existence check was vigil-only before this generalization; a dangling
  // `references/X.md` mention planted in doctor/SKILL.md — a name that exists nowhere in the plugin —
  // must now be caught too, proving the widened per-skill-with-fallback-search model actually reaches
  // doctor/, not just vigil/.
  const { code, out } = runOverlay({
    "cressetide/skills/doctor/SKILL.md": (s) => s + "\nSee also `references/zz-doctor-dangling.md` (does not exist anywhere in the plugin).\n",
  });
  assert.notStrictEqual(code, 0, "a dangling reference in a non-vigil skill's SKILL.md must fail the build");
  assert.match(out, /doctor\/SKILL\.md links a missing reference: references\/zz-doctor-dangling\.md/, "the failure must name the offending SKILL.md and the missing reference");
});

test("validate-structure: §5b does NOT flag the three known cross-skill references as missing (real repo tree)", () => {
  // The false-positive risk verified directly during planning: vigil/SKILL.md mentions
  // map/references/vigil-map-overlay.md (the prior hardcoded exception), and salvage/SKILL.md mentions
  // map/references/operational-readiness.md and vigil/references/external-capabilities.md — none of the
  // three live in the mentioning skill's own references/ directory. A naive "resolve to the mentioning
  // skill's own directory only" generalization would newly false-fail CI on all three the moment §5b
  // starts running per-skill; this is the test that would have caught that false-positive risk (mirrors
  // why the analogous garden 9a cross-skill test mattered).
  const { code, out } = runOverlay({});
  assert.strictEqual(code, 0, `the generalized §5b must not false-flag real cross-skill references: ${out}`);
  assert.doesNotMatch(out, /links a missing reference: references\/vigil-map-overlay\.md/, "vigil -> map/vigil-map-overlay.md must not be flagged");
  assert.doesNotMatch(out, /links a missing reference: references\/operational-readiness\.md/, "salvage -> map/operational-readiness.md must not be flagged");
  assert.doesNotMatch(out, /links a missing reference: references\/external-capabilities\.md/, "salvage -> vigil/external-capabilities.md must not be flagged");
});

test("validate-structure: dropping a sentinel from the compact final-report template FAILS (5d guard)", () => {
  // The realistic single-edit regression: remove the verify sentinel from the compact (Default)
  // template fence. The 5d guard must bite — and must NOT be masked by the intro-prose copy of the
  // same literals. .replace() hits the FIRST occurrence, which is the compact fence (before the
  // --report full fence), so this deletes it from the default rendering specifically.
  const { code, out } = runOverlay({
    "cressetide/skills/vigil/references/final-report.md": (s) => s.replace("ctide:verify=<pass|fail|unrun|na>", "verify status omitted"),
  });
  assert.notStrictEqual(code, 0, "dropping a sentinel from the compact template fence must fail the build");
  assert.match(out, /compact template is missing the machine-contract literal/, "the failure must name the 5d sentinel guard");
});

test("validate-structure: a mangled compact final-report fence fails CLOSED (5d guard)", () => {
  // Mangle the compact fence opener (first ~~~markdown = the compact fence). The region is bounded to
  // the compact section, so the guard must fail CLOSED — not fall through to the --report full fence
  // (which also holds the literals) and pass green.
  const { code, out } = runOverlay({
    "cressetide/skills/vigil/references/final-report.md": (s) => s.replace("~~~markdown", "```markdown"),
  });
  assert.notStrictEqual(code, 0, "a mangled compact fence must fail closed, not fall through to the full fence");
  assert.match(out, /cannot locate the compact \(Default\)/, "the failure must name the fail-closed fence guard");
});

test("validate-structure: reverting the --report full cost table to a single Tokens column FAILS (5e guard)", () => {
  // Revert the billable-component header (Input/Output/Cache-write/Cache-read) back to the old
  // single-`Tokens` column in the --report full cost table; the 5e guard must bite (AC2 contract).
  const { code, out } = runOverlay({
    "cressetide/skills/vigil/references/final-report.md": (s) => s.replace(
      "| Agent / phase | Input | Output | Cache-write | Cache-read | New | Share | Source | ~Cost |",
      "| Agent / phase | Tokens | Share | Source | ~Cost |"),
  });
  assert.notStrictEqual(code, 0, "dropping the billable-component columns must fail the build");
  assert.match(out, /billable-component column/, "the failure must name the 5e cost-column guard");
});

test("validate-structure: A6 dropping a guarded Fix-Class phrase from arbiter.agent.md FAILS (5f guard)", () => {
  // A6: the arbiter's Fix-Class safety rule (Extended-Safe / Residual; a Residual fix is "never
  // auto-applied") is a load-bearing contract. Removing the "never auto-applied" phrase must trip the
  // §5f contract-invariant guard so a prose edit can't silently gut the never-auto-ship rule.
  const { code, out } = runOverlay({
    "cressetide/agents/arbiter.agent.md": (s) => s.split("never auto-applied").join("XXX"),
  });
  assert.notStrictEqual(code, 0, "dropping a guarded Fix-Class phrase must fail the build");
  assert.match(out, /never auto-applied/, "the failure must name the dropped Fix-Class literal");
});

test("validate-structure: missing validation workflow FAILS (release asset guard)", () => {
  const { code, out } = runOverlay({ ".github/workflows/validate.yml": null });
  assert.notStrictEqual(code, 0, "missing validation workflow must fail closed");
  assert.match(out, /missing validation workflow/, "the failure must name the validation workflow guard");
});

test("validate-structure: missing release workflow FAILS (release asset guard)", () => {
  const { code, out } = runOverlay({ ".github/workflows/release.yml": null });
  assert.notStrictEqual(code, 0, "missing release workflow must fail closed");
  assert.match(out, /missing release workflow/, "the failure must name the release workflow guard");
});

test("validate-structure: missing release publisher script FAILS (release asset guard)", () => {
  const { code, out } = runOverlay({ ".github/scripts/publish-release.mjs": null });
  assert.notStrictEqual(code, 0, "missing release publisher script must fail closed");
  assert.match(out, /missing release publisher script/, "the failure must name the publisher script guard");
});

test("validate-structure: validation workflow must syntax-check the publisher script", () => {
  const { code, out } = runOverlay({
    ".github/workflows/validate.yml": (s) => s.replace(
      "run: node --check .github/scripts/publish-release.mjs",
      "run: echo skipped-publisher-syntax-check"),
  });
  assert.notStrictEqual(code, 0, "removing the publisher syntax check must fail closed");
  assert.match(out, /syntax-check/, "the failure must name the missing syntax-check contract");
});

test("validate-structure: a disabled decoy cannot satisfy the named syntax-check step", () => {
  const { code, out } = runOverlay({
    ".github/workflows/validate.yml": (s) => s.replace(
      "run: node --check .github/scripts/publish-release.mjs",
      "run: echo skipped-publisher-syntax-check") + [
      "",
      "  disabled-decoy:",
      "    if: false # intentionally disabled",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - name: Syntax-check release publisher",
      "        run: node --check .github/scripts/publish-release.mjs",
      "",
    ].join("\n"),
  });
  assert.notStrictEqual(code, 0, "a disabled decoy job must not satisfy the validation workflow guard");
  assert.match(out, /validation job must syntax-check/, "the failure must name the scoped syntax-check contract");
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
    const { code, out } = runOverlay({ ".github/workflows/validate.yml": mutate });
    assert.notStrictEqual(code, 0, "the named publisher syntax check must execute unconditionally in the default shell");
    assert.match(out, /validation job must syntax-check/, "the failure must name the fail-closed syntax-check contract");
  }
});

test("validate-structure: release workflow must delegate to the package publisher with an explicit tag", () => {
  const { code, out } = runOverlay({
    ".github/workflows/release.yml": (s) => s.replace(
      "run: npm run release:publish -- --tag \"$RELEASE_TAG\"",
      "run: echo skipped-publisher"),
  });
  assert.notStrictEqual(code, 0, "commented-out publisher command must fail closed");
  assert.match(out, /publish job must call/, "the failure must name the release delegation contract");
});

test("validate-structure: package release script must delegate to the publisher in publish mode", () => {
  const { code, out } = runOverlay({
    "package.json": editJSON((pkg) => { pkg.scripts["release:publish"] = "node .github/scripts/publish-release.mjs --archive"; }),
  });
  assert.notStrictEqual(code, 0, "package release delegation drift must fail closed");
  assert.match(out, /package\.json: release:publish/, "the failure must name the package release delegation contract");
});

test("validate-structure: a disabled duplicate cannot replace the named publish step", () => {
  const { code, out } = runOverlay({
    ".github/workflows/release.yml": (s) => s.replace(
      "run: npm run release:publish -- --tag \"$RELEASE_TAG\"",
      "run: echo skipped-publisher").replace("\n  attest:\n", [
      "",
      "      - name: Disabled duplicate publisher command",
      "        if: false",
      "        run: npm run release:publish -- --tag \"$RELEASE_TAG\"",
      "",
      "  attest:",
      "",
    ].join("\n")),
  });
  assert.notStrictEqual(code, 0, "a disabled duplicate must not satisfy the named publish-step guard");
  assert.match(out, /publish job must call/, "the failure must name the scoped release delegation contract");
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
    const { code, out } = runOverlay({ ".github/workflows/release.yml": mutate });
    assert.notStrictEqual(code, 0, "a conditional publish job or named publisher step must fail closed");
    assert.match(out, /publish job must call/, "the failure must name the unconditional release contract");
  }
});

test("validate-structure: NOT READY example must stay marked non-evidence", () => {
  const { code, out } = runOverlay({
    "examples/not-ready-run.md": (s) => s.replace("not counted as evidence", "evidence claim removed"),
  });
  assert.notStrictEqual(code, 0, "illustrative NOT READY example must not lose its non-evidence marker");
  assert.match(out, /required provenance marker/, "the failure must name the provenance guard");
});

test("validate-structure: illustrative packet/report examples must keep their disclaimers", () => {
  for (const [rel, marker] of [
    ["examples/review-packet.md", "not a historical run"],
    ["examples/final-report-compact.md", "Values in angle brackets must be replaced"],
    ["examples/final-report-full.md", "not a historical run or evidence record"],
  ]) {
    const { code, out } = runOverlay({ [rel]: (s) => s.replace(marker, "claim removed") });
    assert.notStrictEqual(code, 0, `${rel} must not lose its illustrative/provenance marker`);
    assert.match(out, /required provenance marker/, "the failure must name the provenance guard");
  }
});

test("validate-structure: a shipped forbidden artifact FAILS (distribution hygiene)", () => {
  // A package.json inside the shipped plugin subdir is a dev artifact that must never ship.
  const { code, out } = runOverlay({ "cressetide/package.json": '{"name":"leak"}' });
  assert.notStrictEqual(code, 0, "a runtime/dev artifact in the shipped tree must fail the build");
  assert.match(out, /distribution hygiene/, "the failure must name the distribution-hygiene check");
});

test("validate-structure: a missing CHANGELOG entry for the current version FAILS", () => {
  const ver = JSON.parse(base.file("cressetide/.claude-plugin/plugin.json").toString("utf8")).version;
  // Mangle the heading for the current version so the "## [<version>]" check can't find it.
  const { code, out } = runOverlay({ "CHANGELOG.md": (s) => s.replace(`## [${ver}]`, "## [_removed_for_test_]") });
  assert.notStrictEqual(code, 0, "a missing CHANGELOG entry for the manifest version must fail the build");
  assert.match(out, /CHANGELOG\.md has no/, "the failure must name the missing CHANGELOG entry");
});

test("validate-structure: a hook dropped from its event FAILS (wiring gate)", () => {
  const { code, out } = runOverlay({
    "cressetide/hooks/hooks.json": editJSON((hj) => { delete hj.hooks.Stop; }), // orchestration-check.js no longer wired to any event
  });
  assert.notStrictEqual(code, 0, "dropping a hook from its event must fail the build");
  assert.match(out, /Stop does not wire orchestration-check\.js/, "the failure must name the unwired hook");
});

test("validate-structure: a PreToolUse matcher that stops covering a gated tool FAILS (wiring gate)", () => {
  const { code, out } = runOverlay({
    "cressetide/hooks/hooks.json": editJSON((hj) => { hj.hooks.PreToolUse[0].matcher = "Write|Edit"; }), // drops MultiEdit / NotebookEdit / Bash
  });
  assert.notStrictEqual(code, 0, "narrowing the matcher below the gated tools must fail the build");
  assert.match(out, /PreToolUse matcher does not cover "Bash"/, "the failure must name the uncovered tool");
});

// --- The PowerShell wiring token is CI-locked (a regression to Bash-only must fail the build) ---

test("validate-structure: a plan-gate.js matcher that drops PowerShell coverage FAILS", () => {
  const { code, out } = runOverlay({
    "cressetide/hooks/hooks.json": editJSON((hj) => { hj.hooks.PreToolUse[0].matcher = "Write|Edit|MultiEdit|NotebookEdit|Bash"; }), // plan-gate entry: PowerShell dropped
  });
  assert.notStrictEqual(code, 0, "narrowing the plan-gate matcher to drop PowerShell must fail the build");
  assert.match(out, /PreToolUse matcher does not cover "PowerShell"/, "the failure must name the uncovered PowerShell token");
});

test("validate-structure: a destructive-guard.js matcher that drops PowerShell coverage FAILS", () => {
  const { code, out } = runOverlay({
    "cressetide/hooks/hooks.json": editJSON((hj) => { hj.hooks.PreToolUse[1].matcher = "Bash"; }), // destructive-guard entry: PowerShell dropped
  });
  assert.notStrictEqual(code, 0, "narrowing the destructive-guard matcher to drop PowerShell must fail the build");
  assert.match(out, /PreToolUse matcher does not cover "PowerShell"/, "the failure must name the uncovered PowerShell token");
});

// --- Matcher coverage is bound to the hook's own entry (cross-entry merge gap) ---

test("validate-structure: a second event entry can no longer cover another hook's matcher gap (scoped wiring gate)", () => {
  // Narrow plan-gate's OWN entry to drop MultiEdit, and add a SECOND PreToolUse entry that wires an
  // existing, README-named hook and whose matcher DOES cover MultiEdit. Under the old merged `.some()`
  // logic the gate passed (some entry covered MultiEdit); the scoped check must now fail because
  // plan-gate's own entry does not cover it.
  const { code, out } = runOverlay({
    "cressetide/hooks/hooks.json": editJSON((hj) => {
      const pre = hj.hooks.PreToolUse;
      pre[0].matcher = "Write|Edit|NotebookEdit|Bash"; // plan-gate entry: MultiEdit dropped
      pre.push({ matcher: "MultiEdit", hooks: [{ type: "command", command: pre[0].hooks[0].command.replace("plan-gate.js", "load-failure-memory.js") }] });
    }),
  });
  assert.notStrictEqual(code, 0, "a different entry's matcher must not satisfy plan-gate's own coverage");
  assert.match(out, /matcher does not cover "MultiEdit"/, "the failure must name the token plan-gate's own entry omits");
});

// --- Section 9 "garden" guards: one injected-defect negative test per check (a–e) ---

test("validate-structure: garden 9a FAILS on an orphan reference file not mentioned in any SKILL.md or agent doc", () => {
  // A reference file nothing links: no SKILL.md's Reference Loading list and no agent doc names it.
  const { code, out } = runOverlay({
    "cressetide/skills/vigil/references/zz-orphan.md": "# Orphan reference\n\nDead weight the workflow can never load.\n",
  });
  assert.notStrictEqual(code, 0, "an orphan reference must fail the build");
  assert.match(out, /garden 9a: .*zz-orphan\.md is not mentioned by filename in any skills\/\*\/SKILL\.md or agents\/\*\.agent\.md/, "the failure must name the orphan reference");
});

test("validate-structure: garden 9a does NOT flag vigil-map-overlay.md or navigator-map-overlay.md as orphans (global reachability, real repo tree)", () => {
  // The false-positive risk verified directly during planning: both files are legitimate, reachable
  // references, but neither is mentioned in map/SKILL.md itself — vigil-map-overlay.md is loaded only
  // by vigil/SKILL.md, navigator-map-overlay.md only by agents/navigator.agent.md. A naive
  // per-skill-directory 9a would false-fail CI on this real, unmodified tree; this test is the guard
  // against that regression (the test that would have caught the risk this planning pass found).
  const { code, out } = runOverlay({});
  assert.strictEqual(code, 0, `the widened garden 9a must not false-flag legitimate cross-skill/agent-referenced files: ${out}`);
  assert.doesNotMatch(out, /garden 9a: .*vigil-map-overlay\.md/, "vigil-map-overlay.md is reachable via vigil/SKILL.md, not map/SKILL.md — must not be flagged");
  assert.doesNotMatch(out, /garden 9a: .*navigator-map-overlay\.md/, "navigator-map-overlay.md is reachable via agents/navigator.agent.md, not map/SKILL.md — must not be flagged");
});

test("validate-structure: garden 9a FAILS on a genuine orphan in a non-vigil skill (proves coverage now extends beyond vigil/)", () => {
  // doctor/ was never scanned by the old vigil-only 9a; a nothing-links orphan planted here must now
  // fail too, proving the widened scan actually reaches doctor/map/salvage/ship, not just vigil/.
  const { code, out } = runOverlay({
    "cressetide/skills/doctor/references/zz-doctor-orphan.md": "# Orphan reference\n\nDead weight the workflow can never load.\n",
  });
  assert.notStrictEqual(code, 0, "an orphan reference in a non-vigil skill must fail the build");
  assert.match(out, /garden 9a: .*zz-doctor-orphan\.md is not mentioned by filename in any skills\/\*\/SKILL\.md or agents\/\*\.agent\.md/, "the failure must name the orphan reference and prove doctor/ is now covered");
});

test("validate-structure: garden 9b FAILS in both agent-parity directions (unlisted on disk / ghost in manifest)", () => {
  // Direction 1: an agent file on disk that plugin.json agents[] does not list (it would never load).
  {
    const { code, out } = runOverlay({
      "cressetide/agents/zz-unlisted.agent.md": "---\nname: zz-unlisted\ndescription: parity-test agent not wired in the manifest\n---\n\nBody.\n",
    });
    assert.notStrictEqual(code, 0, "an on-disk agent missing from plugin.json agents[] must fail the build");
    assert.match(out, /garden 9b: .*zz-unlisted\.agent\.md exists on disk but is not listed in plugin\.json/, "the failure must name the unlisted agent");
  }
  // Direction 2: a plugin.json agents[] entry whose file does not exist on disk.
  {
    const { code, out } = runOverlay({
      "cressetide/.claude-plugin/plugin.json": editJSON((obj) => { obj.agents.push("./agents/ghost.agent.md"); }),
    });
    assert.notStrictEqual(code, 0, "a manifest agent entry with no file on disk must fail the build");
    assert.match(out, /garden 9b: plugin\.json agents\[\] lists ".\/agents\/ghost\.agent\.md" but .* does not exist on disk/, "the failure must name the ghost manifest entry");
  }
});

test("validate-structure: garden 9c FAILS when SKILL.md grows past the agreed size cap", () => {
  // Size-independent overshoot: 64 KB of growth exceeds the cap from ANY
  // plausible base size or future cap raise, so a later SKILL.md compression pass can't
  // silently defuse this negative.
  const { code, out } = runOverlay({ "cressetide/skills/vigil/SKILL.md": (s) => s + "\n" + "x".repeat(65536) + "\n" });
  assert.notStrictEqual(code, 0, "SKILL.md growing past the cap must fail the build");
  assert.match(out, /garden 9c: .*SKILL\.md is \d+ bytes and grew past the agreed cap \(30000\)/, "the failure must name the cap and the actual size");
  assert.match(out, /consciously raise the cap/, "the failure must state the conscious-override path");
});

test("validate-structure: garden 9d FAILS on drift in each guarded copy cluster (dd regex / debug body / packet anchor)", () => {
  for (const [edits, expected] of [
    // d1: one character of destructive-guard's dd-of= regex changes -> the documented
    // character-identical pair with plan-gate.js is broken.
    [{ "cressetide/hooks/destructive-guard.js": (s) => s.replace("NUL\\b))/i,", "NULL\\b))/i,") },
      /garden 9d: the dd-of= regex drifted between plan-gate\.js and destructive-guard\.js/],
    // d2: one hook's debug() body drifts from the other five documented copies.
    [{ "cressetide/hooks/compact-fidelity.js": (s) => s.replace("ctide-hook.log", "ctide-hook2.log") },
      /garden 9d: debug\(\) drifted between .*compact-fidelity\.js/],
    // d3 (§5k extension): a packet-block rule drops out of review-packet.md while
    // reviewer-common.md still has it — a one-sided drift.
    [{ "cressetide/skills/vigil/references/review-packet.md": (s) => s.split("materially underspecified").join("XXX") },
      /rigor-contract guard: .*review-packet\.md no longer contains the anchor "materially underspecified"/],
    // d4 (§5k extension): the scratch/temp-copy anchor drops out of review-packet.md while
    // reviewer-common.md still has it — a one-sided drift.
    [{ "cressetide/skills/vigil/references/review-packet.md": (s) => s.split("scratch/temp copy").join("XXX") },
      /rigor-contract guard: .*review-packet\.md no longer contains the anchor "scratch\/temp copy"/],
    // d2 (stdin cluster): a hook loses its stdin-reader sync stamp
    // (stamps must not point at a guard that would let them silently rot).
    [{ "cressetide/hooks/orchestration-check.js": (s) => s.replace("stdin reader kept in sync with", "stdin reader formerly synced with") },
      /garden 9d: .*orchestration-check\.js lost the stdin-reader sync marker/],
  ]) {
    const { code, out } = runOverlay(edits);
    assert.notStrictEqual(code, 0, `a drifted documented copy must fail the build (${expected})`);
    assert.match(out, expected, "the failure must name the drifted pair/anchor");
  }
});

test("validate-structure: garden 9d FAILS on drift in the map.mjs/ship.mjs mirrored skill constructs", () => {
  for (const [edits, expected] of [
    // git(): a single-token change inside the function body (well within the extracted
    // `function git(` .. column-0 `}` range) breaks the documented byte-identical copy.
    [{ "cressetide/skills/ship/scripts/ship.mjs": (s) => s.replace("timeout: 10000,", "timeout: 10001,") },
      /garden 9d: git drifted between cressetide\/skills\/map\/scripts\/map\.mjs and cressetide\/skills\/ship\/scripts\/ship\.mjs/],
    // OPS_TRUST_TAG_ATTEMPT: a single-character change inside the const's own regex-literal line.
    [{ "cressetide/skills/map/scripts/map.mjs": (s) => s.replace("[^>]*-->/g", "[^>]+-->/g") },
      /garden 9d: OPS_TRUST_TAG_ATTEMPT drifted between cressetide\/skills\/map\/scripts\/map\.mjs and cressetide\/skills\/ship\/scripts\/ship\.mjs/],
    // OPS_TRUST_TAG_WELLFORMED: a single-character change inside the const's own regex-literal line.
    [{ "cressetide/skills/ship/scripts/ship.mjs": (s) => s.replace("(\\S+)", "(\\S*)") },
      /garden 9d: OPS_TRUST_TAG_WELLFORMED drifted between cressetide\/skills\/map\/scripts\/map\.mjs and cressetide\/skills\/ship\/scripts\/ship\.mjs/],
    // opsTrustTagIsWellFormed(): a single-token change inside the function body.
    [{ "cressetide/skills/map/scripts/map.mjs": (s) => s.replace('tier === "unverified"', 'tier === "UNVERIFIED"') },
      /garden 9d: opsTrustTagIsWellFormed drifted between cressetide\/skills\/map\/scripts\/map\.mjs and cressetide\/skills\/ship\/scripts\/ship\.mjs/],
    // isValidIsoDate(): a single-token change inside the function body.
    [{ "cressetide/skills/ship/scripts/ship.mjs": (s) => s.replace('hourText || "00"', 'hourText || "01"') },
      /garden 9d: isValidIsoDate drifted between cressetide\/skills\/map\/scripts\/map\.mjs and cressetide\/skills\/ship\/scripts\/ship\.mjs/],
    // Extraction-failure path: renaming git()'s signature in ONE file makes it unlocatable there,
    // exercising the "cannot extract" branch rather than the drift branch.
    [{ "cressetide/skills/map/scripts/map.mjs": (s) => s.replace("function git(", "function gitHelper(") },
      /garden 9d: cannot extract git from cressetide\/skills\/map\/scripts\/map\.mjs — the construct moved or lost its expected shape/],
  ]) {
    const { code, out } = runOverlay(edits);
    assert.notStrictEqual(code, 0, `a drifted/unextractable map.mjs↔ship.mjs mirrored construct must fail the build (${expected})`);
    assert.match(out, expected, "the failure must name the drifted or unextractable construct");
  }
});

test("validate-structure: garden 9d FAILS on drift/extraction/marker-loss in the isInvokedDirectly() entry-point cluster (11 CLI scripts)", () => {
  for (const [edits, expected] of [
    // Single-site body drift: one forward-direction file's isInvokedDirectly() body diverges from
    // the rest of the 10-file forward cluster. doctor.mjs is first in the file list and stays
    // unmutated, so it is the reference body every other site is compared against.
    [{ "cressetide/skills/vigil/scripts/contract-check.mjs": (s) => s.replace("!process.argv[1]", "!process.argv[2]") },
      /garden 9d: isInvokedDirectly\(\) drifted between cressetide\/skills\/doctor\/scripts\/doctor\.mjs and cressetide\/skills\/vigil\/scripts\/contract-check\.mjs/],
    // Unextractable: renaming the function's declaration in ONE file makes it unlocatable there,
    // exercising the "cannot extract" branch rather than the drift branch.
    [{ "cressetide/skills/vigil/scripts/pack-review-diff.mjs": (s) => s.replace("function isInvokedDirectly(", "function isInvokedDirectlyRenamed(") },
      /garden 9d: cannot extract isInvokedDirectly\(\) from cressetide\/skills\/vigil\/scripts\/pack-review-diff\.mjs — the function moved or lost its column-0 shape/],
    // Missing stamp: the sync-comment line is deleted but the function body is left byte-identical,
    // so only the marker-presence check (not the byte-identity check) must fire.
    [{ "eval/check-model-provenance.mjs": (s) => s.replace(
      "// isInvokedDirectly() kept in sync with the other 10 CLI entry points (documented copy — see garden hash guard)\n", "") },
      /garden 9d: eval\/check-model-provenance\.mjs lost the isInvokedDirectly\(\) sync marker/],
    // The one forward site outside cressetide/ (the release CLI): drifting its body must be caught
    // exactly like any plugin-script site, proving the list's non-plugin member is registered too.
    [{ ".github/scripts/publish-release.mjs": (s) => s.replace("!process.argv[1]", "!process.argv[2]") },
      /garden 9d: isInvokedDirectly\(\) drifted between cressetide\/skills\/doctor\/scripts\/doctor\.mjs and \.github\/scripts\/publish-release\.mjs/],
  ]) {
    const { code, out } = runOverlay(edits);
    assert.notStrictEqual(code, 0, `a drifted/unextractable/unmarked isInvokedDirectly() copy must fail the build (${expected})`);
    assert.match(out, expected, "the failure must name the drifted, unextractable, or unmarked entry-point site");
  }
});

test("validate-structure: garden 9e FAILS on a bare plugin-script invocation missing ${CLAUDE_PLUGIN_ROOT}", () => {
  // Strip the plugin-root prefix from a shipped invocation.
  const { code, out } = runOverlay({
    "cressetide/skills/vigil/references/verification-gate.md": (s) => s.replace(
      "node ${CLAUDE_PLUGIN_ROOT}/skills/vigil/scripts/failure-retrieve.mjs",
      "node skills/vigil/scripts/failure-retrieve.mjs"),
  });
  assert.notStrictEqual(code, 0, "a bare plugin-script invocation in a shipped .md must fail the build");
  assert.match(out, /garden 9e: .*verification-gate\.md:\d+ invokes a plugin script without the plugin root/, "the failure must name the file:line and the fix");
});

test("validate-structure: garden 9e FAILS on a bare plugin-script invocation in a non-vigil skill's reference doc", () => {
  // Prove the widened §9e coverage: the defect lands in doctor's own reference doc, not vigil's.
  const { code, out } = runOverlay({
    "cressetide/skills/doctor/references/diagnostic-contract.md": (s) => s + "\nSee also: node skills/doctor/scripts/doctor.mjs --json\n",
  });
  assert.notStrictEqual(code, 0, "a bare plugin-script invocation in a non-vigil reference doc must fail the build");
  assert.match(out, /garden 9e: .*diagnostic-contract\.md:\d+ invokes a plugin script without the plugin root/, "the failure must name the file:line and the fix, proving doctor/ is now covered");
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
    const rel = file.join("/");
    const before = base.file(rel).toString("utf8");
    const after = before.replace(find, repl);
    assert.notStrictEqual(after, before, `fixture drift: find-string no longer matches in ${file.join("/")} (${expected})`);
    const { code, out } = runOverlay({ [rel]: after });
    assert.notStrictEqual(code, 0, `dropping a trust-marker tier must fail the build (${expected})`);
    assert.match(out, expected, "the failure must name the site and the missing tier");
  }
});

// --- §6b .ctide hygiene: the /.ctide/ gitignore line + the tracked-content git guard ---

test("validate-structure: 6b FAILS when .gitignore loses the /.ctide/ line", () => {
  // Discriminating: without the 6b check the validator passes this tree (nothing else reads .gitignore).
  const { code, out } = runOverlay({
    ".gitignore": (s) => s.split(/\r?\n/).filter((l) => l.trim() !== "/.ctide/").join("\n"),
  });
  assert.notStrictEqual(code, 0, "dropping the /.ctide/ gitignore line must fail the build");
  assert.match(out, /.ctide hygiene: \.gitignore has no "\/.ctide\/" line/, "the failure must name the missing gitignore line");
});

test("validate-structure: 6b FAILS when the .gitignore FILE itself is missing", () => {
  // Sibling branch to the line-drop negative above: a tree with no .gitignore at all must hit 6b's
  // file-missing arm (not silently pass), since without the file the /.ctide/ line cannot exist either.
  const { code, out } = runOverlay({ ".gitignore": null });
  assert.notStrictEqual(code, 0, "a tree with no .gitignore must fail the build");
  assert.match(out, /.ctide hygiene: \.gitignore is missing/, "the failure must name the missing .gitignore file");
});

test("validate-structure: 6b FAILS on tracked content under .ctide/ (git-index guard), naming the path", () => {
  // A planted runtime file that git reports as tracked (the index view): the guard must bite.
  const { code, out } = runOverlay(
    { ".ctide/memory/FAILURE_MEMORY.md": "# leaked runtime output\n" },
    { tracked: [".ctide/memory/FAILURE_MEMORY.md"] },
  );
  assert.notStrictEqual(code, 0, "a tracked .ctide/ path must fail the build");
  assert.match(out, /.ctide hygiene: tracked path\(s\) under .ctide\//, "the failure must name the tracked-content guard");
  assert.match(out, /.ctide\/memory\/FAILURE_MEMORY\.md/, "the failure must name the offending path");
});

test("validate-structure: 6b control — an UNTRACKED .ctide/ tree in a git work tree still passes", () => {
  // The guard forbids TRACKED content only; a normal dogfood run's untracked .ctide/ output (plus the
  // /.ctide/ gitignore line) is the sanctioned state and must stay green.
  assert.deepStrictEqual(
    check({ ".ctide/output/contract.md": "# run scratch\n" }, { ignored: [".ctide/output/contract.md"] }),
    [],
    "untracked .ctide/ content must not fail the build",
  );
});

test("validate-structure: 6b FAILS CLOSED on a present .ctide/ when the tree is not a git work tree (files: null)", () => {
  // Without git's file lists the tracked state of .ctide/ cannot be verified, so its mere presence fails.
  const { read } = overlay({ ".ctide/output/contract.md": "# run scratch\n" });
  const out = validate({ root, read, files: null }).join("\n");
  assert.match(out, /\.ctide hygiene: runtime \.ctide state is present outside a verifiable Git checkout/, "the failure must name the unverifiable tracked-state guard");
});

test("validate-structure: without git file lists the scans walk the reader (fallback still catches a planted U+FFFD)", () => {
  const { read } = overlay({ "docs/zz-fallback.md": "mojibake " + String.fromCharCode(0xFFFD) + " here\n" });
  const out = validate({ root, read, files: null }).join("\n");
  assert.match(out, /text integrity: docs\/zz-fallback\.md contains suspicious mojibake marker U\+FFFD/, "the fallback walk must still reach every file");
});

test("validate-structure: scratch-file and text-integrity scans cover tracked + untracked-not-ignored files only", () => {
  // Untracked but not ignored: `git add -A` would commit it, so it is in scope.
  const { code, out } = runOverlay({ "docs/_scratch-notes.md": "notes\n" });
  assert.notStrictEqual(code, 0, "an untracked, not-ignored scratch file must fail the build");
  assert.match(out, /scratch\/process file should not be committed: docs\/_scratch-notes\.md/, "the failure must name the scratch-file check and the file");
  // Ignored local output (run logs, scratch, a mojibake capture) is out of scope for both scans.
  const ignored = ["docs/_ignored-notes.md", "zz-run.log", "docs/zz-ignored-capture.md"];
  assert.deepStrictEqual(check({
    "docs/_ignored-notes.md": "notes\n",
    "zz-run.log": "log\n",
    "docs/zz-ignored-capture.md": "mojibake " + String.fromCharCode(0xFFFD) + " here\n",
  }, { ignored }), [], "git-ignored files must not be scanned");
});

test("validate-structure: an unparsable or missing manifest FAILS naming the file (merged JSON guard)", () => {
  for (const [edits, expected] of [
    [{ "cressetide/.claude-plugin/plugin.json": "{ not json" }, /invalid JSON in cressetide\/\.claude-plugin\/plugin\.json/],
    [{ "cressetide/hooks/hooks.json": "{ not json" }, /invalid JSON in cressetide\/hooks\/hooks\.json/],
    [{ "package.json": null }, /missing file: package\.json/],
    // A deleted hooks.json leaves nothing registered, so the exact registration inventory fails closed.
    [{ "cressetide/hooks/hooks.json": null }, /hook registration inventory or event mapping mismatch/],
  ]) {
    const { code, out } = runOverlay(edits);
    assert.notStrictEqual(code, 0, `a broken manifest must fail the build (${expected})`);
    assert.match(out, expected, "the failure must name the manifest");
  }
});

test("validate-structure: a missing file that a check reads FAILS with a message instead of crashing the validator", () => {
  // Each of these reads used to be unguarded (core §5i read an absent example right after reporting it;
  // the extension validator read README/SKILL/CHANGELOG files unconditionally) and threw instead.
  for (const [edits, expected] of [
    [{ "examples/ready-run.md": null }, /examples\/ready-run\.md: missing example file/],
    [{ "README.ja.md": null }, /README\.ja\.md: not found, so its Cressetide public tokens cannot be checked/],
    [{ "cressetide/skills/vigil/SKILL.md": null }, /missing skill vigil[\s\S]*Vigil subagent roster mismatch/],
    [{ "CHANGELOG.md": null }, /missing CHANGELOG\.md[\s\S]*CHANGELOG must remain Unreleased/],
  ]) {
    const { code, out } = runOverlay(edits);
    assert.notStrictEqual(code, 0, `a missing file must fail the build (${expected})`);
    assert.match(out, expected, "the failure must name the missing file's check");
  }
});

// --- Cressetide identity and inventory guards (formerly the separate extension validator, whose checks
// never had a working negative case: the old CLI test harness ran them against the real repo, not the copy) ---

test("validate-structure: Cressetide identity check FAILS when plugin.json displayName drifts", () => {
  const { code, out } = runOverlay({
    "cressetide/.claude-plugin/plugin.json": editJSON((obj) => { obj.displayName = "Not Cressetide"; }),
  });
  assert.notStrictEqual(code, 0, "an identity drift must fail the build");
  assert.match(out, /Cressetide package\/plugin identity mismatch/, "the failure must name the identity check");
});

test("validate-structure: Cressetide agent inventory FAILS on an extra agent file and on a drifted manifest agents[]", () => {
  {
    const { code, out } = runOverlay({
      "cressetide/agents/zz-extra.agent.md": "---\nname: zz-extra\ndescription: inventory-test agent\n---\n\nBody.\n",
      "cressetide/.claude-plugin/plugin.json": editJSON((obj) => { obj.agents.push("./agents/zz-extra.agent.md"); }),
    });
    assert.notStrictEqual(code, 0, "an agent outside the exact inventory must fail the build");
    assert.match(out, /Cressetide agent file inventory mismatch/, "the failure must name the agent file inventory check");
  }
  {
    // A duplicated manifest entry: every file still exists and is listed (9b stays green), only the
    // exact agents[] inventory can catch it.
    const { code, out } = runOverlay({
      "cressetide/.claude-plugin/plugin.json": editJSON((obj) => { obj.agents.push("./agents/navigator.agent.md"); }),
    });
    assert.notStrictEqual(code, 0, "a manifest agents[] that drifts from the inventory must fail the build");
    assert.match(out, /Cressetide plugin agents\[\] mismatch/, "the failure must name the manifest agents[] check");
  }
});

test("validate-structure: Cressetide agents/ inventory FAILS on an entry that is not an .agent.md file", () => {
  const { code, out } = runOverlay({
    "cressetide/agents/notes.md": "---\nname: notes\ndescription: not an agent definition\n---\n\nBody.\n",
  });
  assert.notStrictEqual(code, 0, "a non-.agent.md entry in agents/ must fail the build");
  assert.match(out, /Cressetide agents\/ entry is not an \.agent\.md file: cressetide\/agents\/notes\.md/, "the failure must name the offending entry");
});

test("validate-structure: Cressetide skill inventory FAILS on an extra skill, a missing SKILL.md, and a frontmatter name drift", () => {
  for (const [edits, expected] of [
    [{ "cressetide/skills/zz-extra/SKILL.md": "---\nname: zz-extra\ndescription: inventory-test skill\n---\n\nBody.\n" },
      /public skill inventory mismatch/],
    [{ "cressetide/skills/salvage/SKILL.md": null },
      /missing skill salvage/],
    [{ "cressetide/skills/doctor/SKILL.md": (s) => s.replace("name: doctor\n", "name: doctor-renamed\n") },
      /doctor frontmatter mismatch/],
  ]) {
    const { code, out } = runOverlay(edits);
    assert.notStrictEqual(code, 0, `a public skill inventory drift must fail the build (${expected})`);
    assert.match(out, expected, "the failure must name the skill inventory check");
  }
});

test("validate-structure: Cressetide manual-only skills FAIL when they lose disable-model-invocation or user-invocable", () => {
  for (const [edits, expected] of [
    [{ "cressetide/skills/doctor/SKILL.md": (s) => s.replace("disable-model-invocation: true", "disable-model-invocation: false") },
      /doctor must remain manual-only/],
    [{ "cressetide/skills/ship/SKILL.md": (s) => s.replace("user-invocable: true", "user-invocable: false") },
      /ship must remain user-invocable/],
  ]) {
    const { code, out } = runOverlay(edits);
    assert.notStrictEqual(code, 0, `a manual-only skill flag drift must fail the build (${expected})`);
    assert.match(out, expected, "the failure must name the manual-only flag check");
  }
});

test("validate-structure: Vigil subagent roster FAILS when the roster sentence drops an agent", () => {
  const { code, out } = runOverlay({
    "cressetide/skills/vigil/SKILL.md": (s) => s.replace(", `arbiter`, `cartographer`)", ", `arbiter`)"),
  });
  assert.notStrictEqual(code, 0, "a roster that drops an agent must fail the build");
  assert.match(out, /Vigil subagent roster mismatch/, "the failure must name the roster check");
});

test("validate-structure: hook registration inventory FAILS when a matcher drifts, even to a broader one the wiring gate accepts", () => {
  const { code, out } = runOverlay({
    "cressetide/hooks/hooks.json": editJSON((hj) => { hj.hooks.SessionStart[1].matcher = "compact|clear"; }), // compact-fidelity entry
  });
  assert.notStrictEqual(code, 0, "a hook registration outside the exact inventory must fail the build");
  assert.match(out, /hook registration inventory or event mapping mismatch/, "the failure must name the hook registration inventory");
});

test("validate-structure: hook script inventory FAILS on an unregistered hook script", () => {
  const { code, out } = runOverlay({ "cressetide/hooks/zz-extra.js": "\"use strict\";\n" });
  assert.notStrictEqual(code, 0, "a hook script outside the exact inventory must fail the build");
  assert.match(out, /hook script inventory mismatch/, "the failure must name the hook script inventory");
});

test("validate-structure: hook syntax check FAILS on an overlaid hook with a syntax error", () => {
  // The overlaid content (not the file on disk) is what gets syntax-checked.
  const { code, out } = runOverlay({ "cressetide/hooks/compact-fidelity.js": (s) => s + "\nconst = ;\n" });
  assert.notStrictEqual(code, 0, "a hook that does not parse must fail the build");
  assert.match(out, /hook syntax check failed: compact-fidelity\.js/, "the failure must name the hook syntax check and the hook");
});

test("validate-structure: text-integrity check FAILS on invalid UTF-8, a NUL byte, and a marker in an extension-only file type", () => {
  for (const [edits, expected] of [
    [{ "docs/zz-invalid.md": Buffer.from([0x23, 0x20, 0xC3, 0x28, 0x0A]) },
      /text integrity: docs\/zz-invalid\.md is not valid UTF-8/],
    [{ "typos.toml": (s) => s + "\n# nul \u0000 byte\n" },
      /text integrity: typos\.toml contains a NUL byte/],
    [{ ".gitignore": (s) => s + "\n# marker " + String.fromCodePoint(0x5689) + "\n" },
      /text integrity: \.gitignore contains suspicious mojibake marker U\+5689/],
  ]) {
    const { code, out } = runOverlay(edits);
    assert.notStrictEqual(code, 0, `a text-integrity violation must fail the build (${expected})`);
    assert.match(out, expected, "the failure must name the text-integrity check and the file");
  }
});

test("validate-structure: Cressetide environment-variable inventory FAILS on an undeclared CTIDE_ variable", () => {
  const { code, out } = runOverlay({
    "cressetide/skills/vigil/scripts/zz-env.mjs": "export const value = process.env.CTIDE_ZZ_UNDECLARED;\n",
  });
  assert.notStrictEqual(code, 0, "an undeclared CTIDE_ variable must fail the build");
  assert.match(out, /supported Cressetide environment-variable inventory mismatch/, "the failure must name the env-var inventory check");
});

test("validate-structure: public command inventory FAILS on an undeclared /ctide: command and on a missing command reference", () => {
  for (const [edits, expected] of [
    [{ "docs/command-reference.md": (s) => s + "\n## `/ctide:zz-extra`\n" },
      /public command inventory mismatch/],
    [{ "docs/command-reference.md": null },
      /public command inventory: docs\/command-reference\.md not found/],
  ]) {
    const { code, out } = runOverlay(edits);
    assert.notStrictEqual(code, 0, `a public command inventory drift must fail the build (${expected})`);
    assert.match(out, expected, "the failure must name the public command inventory check");
  }
});

test("validate-structure: README public tokens FAIL when a README drops ctide@kktu or .ctide/", () => {
  for (const [edits, expected] of [
    [{ "README.zh-TW.md": (s) => s.split("ctide@kktu").join("ctide@elsewhere") },
      /README\.zh-TW\.md: missing Cressetide public token ctide@kktu/],
    [{ "README.ja.md": (s) => s.split(".ctide/").join(".runtime/") },
      /README\.ja\.md: missing Cressetide public token \.ctide\//],
  ]) {
    const { code, out } = runOverlay(edits);
    assert.notStrictEqual(code, 0, `a README that drops a public token must fail the build (${expected})`);
    assert.match(out, expected, "the failure must name the README token check, the README, and the token");
  }
});

test("validate-structure: CHANGELOG FAILS when it loses its ## [Unreleased] section", () => {
  const { code, out } = runOverlay({ "CHANGELOG.md": (s) => s.replace("## [Unreleased]", "## [Pending]") });
  assert.notStrictEqual(code, 0, "a CHANGELOG without ## [Unreleased] must fail the build");
  assert.match(out, /CHANGELOG must remain Unreleased/, "the failure must name the Unreleased check");
});
