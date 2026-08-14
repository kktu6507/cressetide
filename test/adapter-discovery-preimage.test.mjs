// DiscoveryAnalysisPreimage, driven only through its real public entry point.
//
// Spec anchors:
//   TP = docs/superpowers/specs/2026-07-25-test-provenance-spec.md (approved v1.12)
//        11b.4 discovery input/output and precedence, 11b.4a probe universe, 11b.4b probe vs
//        candidate, 11b.4c the three-valued output, 11b.4d the base/head config split,
//        11b.9c registryDigest, 11b.10 the two projections, 11b.10b the operation and its exact
//        shapes, AC28, AC88, AC89, AC90
//
// Every fixture is a real temporary repository outside this repo, removed in a finally block. There
// is no injected registry, parser, Git executable, environment, filesystem or prebuilt view anywhere
// in this file -- the component has no key that could carry one, and the tests below assert that
// rather than working around it.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cp from "node:child_process";

import {
  DiscoveryPreimageError, buildDiscoveryAnalysisPreimage,
} from "../cressetide/skills/vigil/scripts/adapter-discovery-preimage.mjs";
import { createAdapterContentView } from "../cressetide/skills/vigil/scripts/adapter-content-view.mjs";
import { captureHeadViewSnapshot } from "../cressetide/skills/vigil/scripts/head-view-snapshot.mjs";
import { loadTestAdapterRegistryRoot } from "../cressetide/skills/vigil/scripts/adapter-registry.mjs";
import { canonicalJson, sha256Hex } from "../cressetide/skills/vigil/scripts/provenance-store.mjs";

const CONFIG_PATH = ".ctide/test-adapters-config.json";
const ADAPTER_ID = "node-test";
const NODE_TEST = 'import { test } from "node:test";\n';

// --- fixtures ---------------------------------------------------------------------------------------

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-preimage-"));
  const git = (...args) => cp.execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q", "--initial-branch=main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  git("config", "core.symlinks", "false");
  const write = (rel, body) => {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body, "utf8");
  };
  write("package.json", '{"type":"module"}\n');
  return {
    root: dir,
    git,
    write,
    blob: (text) => cp.execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: dir, input: text, encoding: "utf8" }).trim(),
    commit(message = "c") { git("add", "-A"); git("commit", "-qm", message); return git("rev-parse", "HEAD^{tree}"); },
  };
}

async function withRepo(body) {
  const repo = makeRepo();
  try { return await body(repo); } finally { fs.rmSync(repo.root, { recursive: true, force: true }); }
}

// The commonest shape: one repository whose base tree and head worktree hold the same files.
async function preimageOf(files, extra = () => {}) {
  return withRepo(async (repo) => {
    for (const [rel, body] of Object.entries(files)) repo.write(rel, body);
    const baseTreeOid = repo.commit();
    await extra(repo);
    const preimage = await buildDiscoveryAnalysisPreimage({ repoRoot: repo.root, baseTreeOid });
    // No run may leave anything behind in the repository it read.
    assert.strictEqual(repo.git("status", "--porcelain", "--untracked-files=all"), "",
      "the build must write nothing into the repository");
    return preimage;
  });
}

const refused = async (promise, what, code) => {
  let error = null;
  try { await promise; } catch (e) { error = e; }
  assert.ok(error, `${what}: must be refused`);
  assert.strictEqual(error.code, code, `${what}: expected ${code}, got ${error.code} (${error.message})`);
  return error;
};

const pathsOf = (modules) => modules.map((m) => m.path);
const configText = (assignments) => canonicalJson({ configVersion: 1, assignments });

// --- the request surface (11b.10b) ---------------------------------------------------------------------

test("11b.10b the request key set is exactly { repoRoot, baseTreeOid }", async () => {
  await withRepo(async (repo) => {
    repo.write("a.test.mjs", `${NODE_TEST}test("n", () => {});\n`);
    const baseTreeOid = repo.commit();
    const base = { repoRoot: repo.root, baseTreeOid };

    // Every injection §11b.10b names, refused by name rather than ignored.
    for (const [label, extra] of [
      ["a registry object", { registry: loadTestAdapterRegistryRoot() }],
      ["a registry path", { registryPath: "./elsewhere/test-adapters.json" }],
      ["a registry root", { registryRoot: {} }],
      ["a parser", { parser: () => ({}) }],
      ["an ignore matcher", { ignoreMatcher: () => false }],
      ["a git executable", { git: "/usr/bin/git" }],
      ["an environment", { env: { GIT_DIR: "/elsewhere" } }],
      ["a filesystem adapter", { fs: {} }],
      ["a config object", { explicitConfig: { configVersion: 1, assignments: [] } }],
      ["a config path", { configPath: CONFIG_PATH }],
      ["modulePaths", { modulePaths: ["a.test.mjs"] }],
      ["a candidate list under another name", { candidates: ["a.test.mjs"] }],
      ["a component module path", { implementationModule: "./node-test-adapter.mjs" }],
      ["a capture hook", { onCapture: () => {} }],
      ["a prebuilt view", { view: createAdapterContentView({}) }],
      ["a prebuilt snapshot", { snapshot: await captureHeadViewSnapshot({ repoRoot: repo.root }) }],
    ]) {
      await refused(buildDiscoveryAnalysisPreimage({ ...base, ...extra }), label, "E_API_ARGUMENTS");
    }

    await refused(buildDiscoveryAnalysisPreimage({ repoRoot: repo.root }), "a missing baseTreeOid", "E_API_ARGUMENTS");
    await refused(buildDiscoveryAnalysisPreimage(base, {}), "a second argument", "E_API_ARGUMENTS");
    await refused(buildDiscoveryAnalysisPreimage(), "no argument", "E_API_ARGUMENTS");
    await refused(buildDiscoveryAnalysisPreimage(null), "null", "E_API_ARGUMENTS");
    await refused(buildDiscoveryAnalysisPreimage([repo.root, baseTreeOid]), "an array", "E_API_ARGUMENTS");
    await refused(buildDiscoveryAnalysisPreimage({ repoRoot: "", baseTreeOid }), "an empty repoRoot", "E_API_ARGUMENTS");
    // The base-tree grammar is the base projection's, and it still applies through this door.
    await refused(buildDiscoveryAnalysisPreimage({ repoRoot: repo.root, baseTreeOid: "HEAD^{tree}" }), "a revision expression", "E_BASE_TREE_OID");
  });
});

// --- the exact shapes (11b.10b) ---------------------------------------------------------------------------

test("11b.10b the return root, module and declaration shapes are exact and deeply frozen", async () => {
  const preimage = await preimageOf({
    "a.test.mjs": `${NODE_TEST}// @src REQ-01ARZ3NDEKTSV4RRFFQ69G5FAV\ntest("alpha", () => {});\n`,
  });
  assert.deepStrictEqual(Object.keys(preimage), ["baseTreeOid", "headViewDigest", "registryDigest", "baseModules", "headModules"]);

  const module = preimage.baseModules.find((m) => m.path === "a.test.mjs");
  assert.deepStrictEqual(Object.keys(module), ["path", "adapterId", "framework", "implementationIdentity", "declarations"]);
  assert.strictEqual(module.adapterId, ADAPTER_ID);
  assert.strictEqual(module.framework, "node:test");
  assert.deepStrictEqual(Object.keys(module.implementationIdentity).sort(), ["implementationId", "parserId", "parserVersion"]);

  const declaration = module.declarations[0];
  assert.deepStrictEqual(Object.keys(declaration), ["structuralId", "tag", "bodyDigest"]);
  assert.deepStrictEqual(declaration.tag, { clauseRef: "REQ-01ARZ3NDEKTSV4RRFFQ69G5FAV" });
  assert.match(declaration.bodyDigest, /^[0-9a-f]{64}$/);

  // Nothing §11b.10b forbids leaks out: no AST, no source or canonical bytes, no evidence level, no
  // component module path, no free-form metadata.
  for (const forbidden of ["ast", "sourceBytes", "canonicalDeclarationBytes", "evidenceLevel", "componentModule",
    "containers", "hooks", "effectiveOracleDeps", "declarationDigest", "implementationId", "identity"]) {
    assert.ok(!(forbidden in module), `module must not carry ${forbidden}`);
    assert.ok(!(forbidden in declaration), `declaration must not carry ${forbidden}`);
  }

  assert.ok(Object.isFrozen(preimage));
  assert.ok(Object.isFrozen(preimage.baseModules) && Object.isFrozen(preimage.headModules));
  assert.ok(Object.isFrozen(module) && Object.isFrozen(module.declarations));
  assert.ok(Object.isFrozen(module.implementationIdentity) && Object.isFrozen(declaration) && Object.isFrozen(declaration.tag));
});

test("11b.10b a null tag stays null rather than becoming an object", async () => {
  const preimage = await preimageOf({ "a.test.mjs": `${NODE_TEST}test("untagged", () => {});\n` });
  assert.strictEqual(preimage.baseModules[0].declarations[0].tag, null);
});

test("11b.10b a candidate with no declarations keeps its module record", async () => {
  // Evidence, and nothing to declare. "A candidate must have at least one declaration" is not a rule
  // of this spec, and emptiness is not discovery evidence either way.
  const preimage = await preimageOf({ "empty.mjs": NODE_TEST });
  const module = preimage.baseModules.find((m) => m.path === "empty.mjs");
  assert.ok(module, "the module record survives");
  assert.deepStrictEqual(module.declarations, []);
});

// --- the probe universe (11b.4a) ----------------------------------------------------------------------------

test("11b.4a the suffix gate is case-sensitive and decides probing only, never selection", async () => {
  const preimage = await preimageOf({
    "lower.mjs": `${NODE_TEST}test("a", () => {});\n`,
    "lower.js": `${NODE_TEST}test("b", () => {});\n`,
    "UPPER.MJS": `${NODE_TEST}test("c", () => {});\n`,
    "Mixed.Js": `${NODE_TEST}test("d", () => {});\n`,
    "no-suffix": `${NODE_TEST}test("e", () => {});\n`,
    "data.json": '{"import":"node:test"}\n',
  });
  // ".MJS" and ".Js" do not hit the gate, so those files are never probed and never become
  // candidates -- even though their contents would have matched.
  assert.deepStrictEqual(pathsOf(preimage.baseModules), ["lower.js", "lower.mjs"]);
});

test("11b.4a/AC89 .test.mjs has no special status; evidence alone decides", async () => {
  const preimage = await preimageOf({
    // A helper NAME with real evidence is chosen...
    "helper.mjs": `${NODE_TEST}test("from a helper", () => {});\n`,
    // ...and a .test.mjs name with no evidence is not.
    "named.test.mjs": "export const nothing = 1;\n",
    // Another framework's import is not this adapter's evidence.
    "other.test.mjs": 'import { describe } from "some-other-framework";\ndescribe("x", () => {});\n',
  });
  assert.deepStrictEqual(pathsOf(preimage.baseModules), ["helper.mjs"]);
});

test("11b.4c zero evidence is not-a-candidate: the path is omitted and the run still succeeds", async () => {
  const preimage = await preimageOf({
    "evidence.mjs": `${NODE_TEST}test("kept", () => {});\n`,
    "none.mjs": "export const x = 1;\n",
    "also-none.js": 'const y = "node:test";\nexport default y;\n',
  });
  assert.deepStrictEqual(pathsOf(preimage.baseModules), ["evidence.mjs"], "the two zero-evidence modules are omitted, not fatal");
  assert.deepStrictEqual(pathsOf(preimage.headModules), ["evidence.mjs"]);
});

test("11b.4a a symlink named .mjs is not a probe subject, and is not an error either", async () => {
  await withRepo(async (repo) => {
    repo.write("real.mjs", `${NODE_TEST}test("real", () => {});\n`);
    repo.git("add", "-A");
    const oid = repo.blob("real.mjs");
    repo.git("update-index", "--add", "--cacheinfo", `120000,${oid},link.mjs`);
    repo.write("link.mjs", "real.mjs");
    repo.git("commit", "-qm", "base");
    const baseTreeOid = repo.git("rev-parse", "HEAD^{tree}");

    const preimage = await buildDiscoveryAnalysisPreimage({ repoRoot: repo.root, baseTreeOid });
    // §11b.4a requires entry.type == "blob", so the symlink is outside the probe universe. It is
    // still IN the view and still identifiable there -- it just is not a discovery subject.
    assert.deepStrictEqual(pathsOf(preimage.baseModules), ["real.mjs"]);
  });
});

// --- import evidence (11b.4b) -----------------------------------------------------------------------------

test("11b.4b only top-level static ImportDeclarations are evidence", async () => {
  const preimage = await preimageOf({
    "commented.mjs": '// import { test } from "node:test";\nexport const x = 1;\n',
    "literal.mjs": 'export const specifier = "node:test";\n',
    "concatenated.mjs": 'const s = "node:" + "test";\nexport default s;\n',
    "shadowed.mjs": 'const load = (name) => name;\nexport default load("node:test");\n',
    "real.mjs": `${NODE_TEST}test("only this one", () => {});\n`,
  });
  assert.deepStrictEqual(pathsOf(preimage.baseModules), ["real.mjs"]);
});

test("11b.4b the specifier comparison is exact: no trim, no prefix, no path or URL reading", async () => {
  const preimage = await preimageOf({
    "spaced.mjs": 'import { test } from " node:test";\nexport const x = 1;\n',
    "sub.mjs": 'import x from "node:test/reporters";\nexport default x;\n',
    "prefixed.mjs": 'import x from "not-node:test";\nexport default x;\n',
    "cased.mjs": 'import x from "NODE:TEST";\nexport default x;\n',
    "exact.mjs": `${NODE_TEST}test("exact", () => {});\n`,
  });
  assert.deepStrictEqual(pathsOf(preimage.baseModules), ["exact.mjs"]);
});

test("11b.4b an escaped spelling of the same specifier is the same decoded evidence", async () => {
  const preimage = await preimageOf({
    "escaped.mjs": 'import { test } from "node\\u003atest";\ntest("escaped", () => {});\n',
  });
  assert.deepStrictEqual(pathsOf(preimage.baseModules), ["escaped.mjs"]);
});

test("11b.4b/AC90 a parser refusal is fail-closed, never read as \"no imports\"", async () => {
  for (const [label, body] of [
    ["a syntax error", "export const = ;\n"],
    // None of these three is import evidence -- and in this profile the parser refuses each
    // construct outright, which §11b.4b(3) says is fail-closed rather than "this file has no
    // imports". Both halves matter: none may become evidence, and none may be shrugged off.
    // §11b.11 names re-export as unsupported in the v1 profile in so many words.
    ["dynamic import()", 'const m = await import("node:test");\nexport default m;\n'],
    ["a named re-export", 'export { test } from "node:test";\n'],
    ["a star re-export", 'export * from "node:test";\n'],
    ["a CommonJS require", 'const t = require("node:test");\nexport default t;\n'],
  ]) {
    const error = await refused(preimageOf({ "broken.mjs": body }), label, "E_PARSER");
    assert.match(error.message, /A parser refusal is fail-closed/);
    assert.strictEqual(error.detail.side, "base");
  }
});

// --- explicit config: the forced half of the probe universe (11b.4a / 11b.4c) ---------------------------------

test("11b.4a a config assignment forces a subject that has no evidence of its own", async () => {
  // Zero import evidence: on its own this path is not-a-candidate and would be omitted. The
  // assignment makes it a forced subject, which is the whole point of the level.
  const preimage = await preimageOf({
    "fixtures/forced.mjs": "export const fixture = 1;\n",
    [CONFIG_PATH]: configText([{ path: "fixtures/forced.mjs", adapterId: ADAPTER_ID }]),
  });
  assert.deepStrictEqual(pathsOf(preimage.baseModules), ["fixtures/forced.mjs"]);
  assert.deepStrictEqual(pathsOf(preimage.headModules), ["fixtures/forced.mjs"]);
  assert.deepStrictEqual(preimage.baseModules[0].declarations, []);
});

test("11b.4c a forced subject the component cannot support is fail-closed on its own named reason", async () => {
  // §11b.4a is explicit that a forced subject may still fail later for an unsupported module format,
  // and §11b.4c lists that among the named fail-closed reasons. The refusal that arrives is the
  // component's own E_MODULE_FORMAT -- specific, and never softened to not-a-candidate.
  const error = await refused(preimageOf({
    "fixtures/no-suffix": `${NODE_TEST}test("forced", () => {});\n`,
    [CONFIG_PATH]: configText([{ path: "fixtures/no-suffix", adapterId: ADAPTER_ID }]),
  }), "a forced subject that is not an ESM module path", "E_MODULE_FORMAT");
  assert.match(error.message, /neither \.mjs nor \.js/);
});

test("11b.4a/11b.4c a forced subject that is missing or is not a blob is fail-closed, not omitted", async () => {
  const missing = await refused(preimageOf({ [CONFIG_PATH]: configText([{ path: "absent/module.mjs", adapterId: ADAPTER_ID }]) }),
    "an assigned path that is not in the view", "E_FORCED_SUBJECT");
  assert.strictEqual(missing.detail.reason, "missing");
  assert.match(missing.message, /fail-closed, not omitted/);

  await withRepo(async (repo) => {
    repo.write("real.mjs", `${NODE_TEST}test("real", () => {});\n`);
    repo.write(CONFIG_PATH, configText([{ path: "pointer", adapterId: ADAPTER_ID }]));
    repo.git("add", "-A");
    const oid = repo.blob("real.mjs");
    repo.git("update-index", "--add", "--cacheinfo", `120000,${oid},pointer`);
    repo.write("pointer", "real.mjs");
    repo.git("commit", "-qm", "base");
    const baseTreeOid = repo.git("rev-parse", "HEAD^{tree}");
    const error = await refused(buildDiscoveryAnalysisPreimage({ repoRoot: repo.root, baseTreeOid }), "an assigned symlink", "E_FORCED_SUBJECT");
    assert.strictEqual(error.detail.reason, "not-a-blob");
    assert.strictEqual(error.detail.type, "symlink");
  });
});

test("11b.4/11b.4c a malformed config is fail-closed with its own named reason", async () => {
  const cases = [
    ["not JSON at all", "{ nope", "E_CONFIG_SHAPE"],
    ["an undeclared key", canonicalJson({ configVersion: 1, assignments: [], extra: true }), "E_CONFIG_SHAPE"],
    ["configVersion 2", canonicalJson({ configVersion: 2, assignments: [] }), "E_CONFIG_FIELD"],
    ["an unknown adapterId", configText([{ path: "a.mjs", adapterId: "playwright-v9" }]), "E_CONFIG_FIELD"],
    ["a duplicate assignment path", configText([{ path: "a.mjs", adapterId: ADAPTER_ID }, { path: "a.mjs", adapterId: ADAPTER_ID }]), "E_CONFIG_FIELD"],
    ["a non-canonical assignment path", configText([{ path: "../escape.mjs", adapterId: ADAPTER_ID }]), "E_CONFIG_FIELD"],
    ["a duplicate member name", '{"configVersion":1,"assignments":[],"configVersion":1}', "E_CONFIG_DUPLICATE_MEMBER"],
  ];
  for (const [label, body, code] of cases) {
    await refused(preimageOf({ "a.mjs": `${NODE_TEST}test("a", () => {});\n`, [CONFIG_PATH]: body }), label, code);
  }
});

// --- the base/head config split (11b.4d) ------------------------------------------------------------------

test("11b.4d head: an untracked config carrier is fail-closed, base: tree membership is the carrier", async () => {
  await withRepo(async (repo) => {
    repo.write("a.test.mjs", `${NODE_TEST}test("a", () => {});\n`);
    const baseTreeOid = repo.commit();
    // Present in the head worktree, never staged. §11b.4d keeps the v1.11 head rule word for word:
    // refused, not treated as absent.
    repo.write(CONFIG_PATH, configText([{ path: "a.test.mjs", adapterId: ADAPTER_ID }]));
    const error = await refused(buildDiscoveryAnalysisPreimage({ repoRoot: repo.root, baseTreeOid }), "an untracked head config", "E_CONFIG_CARRIER");
    assert.strictEqual(error.detail.side, "head");
    assert.match(error.message, /is NOT tracked/);
  });
});

test("11b.4d base: a config in the tree needs no index, and a base symlink carrier is fail-closed", async () => {
  // The base config is legal purely by being in the tree -- there is no stage-0 on that side to
  // consult, and nothing here reaches into the head index to decide it.
  const preimage = await preimageOf({
    "fixtures/forced.mjs": "export const fixture = 1;\n",
    [CONFIG_PATH]: configText([{ path: "fixtures/forced.mjs", adapterId: ADAPTER_ID }]),
  });
  assert.deepStrictEqual(pathsOf(preimage.baseModules), ["fixtures/forced.mjs"]);

  // The BASE tree carries a symlink at the config path while the HEAD carries a perfectly legal
  // tracked blob there, so only the base rule can be what refuses this.
  await withRepo(async (repo) => {
    repo.write("a.test.mjs", `${NODE_TEST}test("a", () => {});\n`);
    repo.write("real-config.json", configText([]));
    repo.git("add", "-A");
    const oid = repo.blob("real-config.json");
    repo.git("update-index", "--add", "--cacheinfo", `120000,${oid},${CONFIG_PATH}`);
    repo.write(CONFIG_PATH, "real-config.json");
    repo.git("commit", "-qm", "base with a symlink config");
    const baseTreeOid = repo.git("rev-parse", "HEAD^{tree}");

    repo.git("rm", "-q", "--cached", CONFIG_PATH);
    repo.write(CONFIG_PATH, configText([]));
    repo.commit("head with a real config");
    assert.strictEqual(repo.git("ls-files", "-s", CONFIG_PATH).slice(0, 6), "100644", "the head carrier is a blob");

    const error = await refused(buildDiscoveryAnalysisPreimage({ repoRoot: repo.root, baseTreeOid }), "a symlink config in the base tree", "E_CONFIG_CARRIER");
    assert.match(error.message, /in the base tree, not a blob/);
    assert.strictEqual(error.detail.side, "base");
  });
});

test("11b.4d the two sides read their OWN config, and the head config never leaks into the base", async () => {
  await withRepo(async (repo) => {
    // The base tree has no config at all.
    repo.write("fixtures/forced.mjs", "export const fixture = 1;\n");
    repo.write("a.test.mjs", `${NODE_TEST}test("a", () => {});\n`);
    const baseTreeOid = repo.commit();

    // The head gains a tracked config that forces the evidence-free fixture.
    repo.write(CONFIG_PATH, configText([{ path: "fixtures/forced.mjs", adapterId: ADAPTER_ID }]));
    repo.commit("add a config");

    const preimage = await buildDiscoveryAnalysisPreimage({ repoRoot: repo.root, baseTreeOid });
    assert.deepStrictEqual(pathsOf(preimage.headModules), ["a.test.mjs", "fixtures/forced.mjs"], "the head config forces its own side");
    assert.deepStrictEqual(pathsOf(preimage.baseModules), ["a.test.mjs"], "the base side saw no config, so nothing was forced there");
  });
});

// --- the digests (11b.9c) ---------------------------------------------------------------------------------

test("11b.9c headViewDigest is S1's, and registryDigest is the registry root plus the HEAD config only", async () => {
  await withRepo(async (repo) => {
    repo.write("a.test.mjs", `${NODE_TEST}test("a", () => {});\n`);
    repo.write(CONFIG_PATH, configText([{ path: "a.test.mjs", adapterId: ADAPTER_ID }]));
    const baseTreeOid = repo.commit();

    const preimage = await buildDiscoveryAnalysisPreimage({ repoRoot: repo.root, baseTreeOid });
    assert.strictEqual(preimage.baseTreeOid, baseTreeOid);

    const snapshot = await captureHeadViewSnapshot({ repoRoot: repo.root });
    assert.strictEqual(preimage.headViewDigest, snapshot.headViewDigest);

    // The formula, asserted directly with the published helpers rather than restated inside the
    // component: registry root + head explicit config, and nothing from the base side.
    const expected = sha256Hex(canonicalJson({
      registry: loadTestAdapterRegistryRoot(),
      explicitConfig: JSON.parse(fs.readFileSync(path.join(repo.root, CONFIG_PATH), "utf8")),
    }));
    assert.strictEqual(preimage.registryDigest, expected);
  });
});

test("11b.9c an absent head config is exactly null in the registryDigest preimage, not {}", async () => {
  await withRepo(async (repo) => {
    repo.write("a.test.mjs", `${NODE_TEST}test("a", () => {});\n`);
    const baseTreeOid = repo.commit();
    const preimage = await buildDiscoveryAnalysisPreimage({ repoRoot: repo.root, baseTreeOid });
    assert.strictEqual(preimage.registryDigest,
      sha256Hex(canonicalJson({ registry: loadTestAdapterRegistryRoot(), explicitConfig: null })));
    assert.notStrictEqual(preimage.registryDigest,
      sha256Hex(canonicalJson({ registry: loadTestAdapterRegistryRoot(), explicitConfig: {} })));
  });
});

// --- ordering, determinism and the base/head split ------------------------------------------------------------

test("11b.10b modules ascend by (path, adapterId) and declarations by structuralId", async () => {
  const preimage = await preimageOf({
    "z/last.mjs": `${NODE_TEST}test("z", () => {});\n`,
    "a/first.mjs": `${NODE_TEST}test("a", () => {});\n`,
    "M/middle.mjs": `${NODE_TEST}test("m", () => {});\n`,
    "multi.mjs": `${NODE_TEST}test("zeta", () => {});\ntest("alpha", () => {});\ntest("Beta", () => {});\n`,
  });
  assert.deepStrictEqual(pathsOf(preimage.baseModules), ["M/middle.mjs", "a/first.mjs", "multi.mjs", "z/last.mjs"]);
  const ids = preimage.baseModules.find((m) => m.path === "multi.mjs").declarations.map((d) => d.structuralId);
  assert.deepStrictEqual(ids, [...ids].sort(), "declarations are in code-point order");
  assert.deepStrictEqual(ids, ['s:["Beta"]', 's:["alpha"]', 's:["zeta"]']);
});

test("11b.10b the base side reflects the base tree and the head side reflects the head worktree", async () => {
  await withRepo(async (repo) => {
    repo.write("kept.mjs", `${NODE_TEST}test("kept", () => {});\n`);
    repo.write("only-in-base.mjs", `${NODE_TEST}test("gone later", () => {});\n`);
    const baseTreeOid = repo.commit();

    fs.rmSync(path.join(repo.root, "only-in-base.mjs"));
    repo.write("only-in-head.mjs", `${NODE_TEST}test("new", () => {});\n`);
    repo.write("kept.mjs", `${NODE_TEST}test("kept", () => { /* body moved */ });\n`);
    repo.commit("head");

    const preimage = await buildDiscoveryAnalysisPreimage({ repoRoot: repo.root, baseTreeOid });
    assert.deepStrictEqual(pathsOf(preimage.baseModules), ["kept.mjs", "only-in-base.mjs"]);
    assert.deepStrictEqual(pathsOf(preimage.headModules), ["kept.mjs", "only-in-head.mjs"]);

    // The bodies differ, which is a FACT the preimage reports; classifying it is the matcher's job
    // and no part of this component decides added, deleted, moved or body-changed.
    const baseBody = preimage.baseModules.find((m) => m.path === "kept.mjs").declarations[0].bodyDigest;
    const headBody = preimage.headModules.find((m) => m.path === "kept.mjs").declarations[0].bodyDigest;
    assert.notStrictEqual(baseBody, headBody);
  });
});

test("11b.10b two runs over an unchanged repository agree exactly", async () => {
  await withRepo(async (repo) => {
    repo.write("a.test.mjs", `${NODE_TEST}// @src REQ-01ARZ3NDEKTSV4RRFFQ69G5FAV\ntest("a", () => {});\n`);
    repo.write("lib/helper.mjs", `${NODE_TEST}test("helper", () => {});\n`);
    const baseTreeOid = repo.commit();
    const first = await buildDiscoveryAnalysisPreimage({ repoRoot: repo.root, baseTreeOid });
    const second = await buildDiscoveryAnalysisPreimage({ repoRoot: repo.root, baseTreeOid });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(second)), JSON.parse(JSON.stringify(first)));
    assert.notStrictEqual(second, first, "a second run really re-read rather than returning a cached object");
  });
});

test("11b.10b a dirty worktree moves the head side and leaves the base side alone", async () => {
  await withRepo(async (repo) => {
    repo.write("a.test.mjs", `${NODE_TEST}test("a", () => {});\n`);
    const baseTreeOid = repo.commit();
    const before = await buildDiscoveryAnalysisPreimage({ repoRoot: repo.root, baseTreeOid });

    repo.write("a.test.mjs", `${NODE_TEST}test("a", () => { const changed = 1; });\n`);
    const after = await buildDiscoveryAnalysisPreimage({ repoRoot: repo.root, baseTreeOid });

    assert.deepStrictEqual(after.baseModules, before.baseModules, "an uncommitted edit cannot move the base side");
    assert.notStrictEqual(after.headModules[0].declarations[0].bodyDigest, before.headModules[0].declarations[0].bodyDigest);
    assert.notStrictEqual(after.headViewDigest, before.headViewDigest);
  });
});

// --- fail-closed leaves nothing behind -----------------------------------------------------------------------

test("11b.10b a failure returns no partial preimage and writes nothing", async () => {
  await withRepo(async (repo) => {
    repo.write("good.mjs", `${NODE_TEST}test("good", () => {});\n`);
    repo.write("bad.mjs", "export const = ;\n");
    const baseTreeOid = repo.commit();
    const before = repo.git("status", "--porcelain", "--untracked-files=all");

    const error = await refused(buildDiscoveryAnalysisPreimage({ repoRoot: repo.root, baseTreeOid }), "one unparseable probe subject", "E_PARSER");
    assert.ok(error instanceof DiscoveryPreimageError);
    // No half-answer: the good module is not handed back alongside the failure.
    assert.strictEqual(error.baseModules, undefined);
    assert.strictEqual(error.headModules, undefined);
    assert.strictEqual(repo.git("status", "--porcelain", "--untracked-files=all"), before);
  });
});

// --- the cross-view invariant (11b.10b, defensive/future) -------------------------------------------------------

test("11b.10b the cross-view adapter invariant is implemented but is NOT reachable in v1", async () => {
  // Honest statement of what is and is not covered here. §11b.3 admits exactly one
  // implementation/framework binding, and both sides resolve against the SAME fresh registry root
  // read once per invocation, so two sides can only ever produce the same adapterId. There is no
  // conforming public input that makes them differ.
  //
  // Triggering it would need a second adapter, a registry override, a caller injection or a
  // test-only public seam -- all four are forbidden, and none is added here. So this test asserts
  // the reachability claim itself: every adapter the shipped registry declares, on both sides, is
  // the same single binding.
  const registryRoot = loadTestAdapterRegistryRoot();
  assert.strictEqual(registryRoot.adapters.length, 1,
    "if the registry ever ships a second adapter, the cross-view invariant becomes reachable and needs a real end-to-end case");

  const preimage = await preimageOf({ "a.test.mjs": `${NODE_TEST}test("a", () => {});\n` });
  const sides = new Set([...preimage.baseModules, ...preimage.headModules].map((m) => m.adapterId));
  assert.deepStrictEqual([...sides], [ADAPTER_ID], "both sides resolve through the one binding");
  // The check has NOT been exercised end to end, and this file does not claim it has.
});
