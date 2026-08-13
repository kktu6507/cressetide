// Coverage for the formal test adapter registry and its loader:
// cressetide/skills/vigil/scripts/test-adapters.json and adapter-registry.mjs.
//
// SCOPE NOTE: this covers the registry CARRIER and its VALIDATION only. The three executable
// capabilities an implementationId maps to -- structuralId, tag attachment and effectiveOracleDeps
// -- are asserted in test/node-test-adapter.test.mjs, not here; this file only checks that the
// mapping itself is closed. Nothing here runs discovery: checking that a discovery declaration
// holds exact data is not the discovery algorithm, so AC88-93 remain uncovered. A green run does
// not mean a producer, a populated inventory, AC136, AC138 or Phase 2 is ready.
//
// What it does cover:
//   AC84  registry exact shape, unknown implementationId, and no dynamic module lookup
//   AC85  adapterId and (implementationId, framework) uniqueness
//   AC86  the closed binding row, now with a real registry file, since the dependency identity is
//         authorized -- every column compared as "exactly"
//   AC87  the closed pattern TOKENS and the canonical-array carrier ONLY. The AST predicates those
//         tokens stand for are not implemented and are not asserted anywhere below.
//
// The loader takes no arguments, so nothing is injected through it. Tampering happens in a
// repo-external scratch copy of the shipped layout: each case loads its own module instance with
// its own cache, so the production registry and vendor capability are never reachable from a test.
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  TestAdapterRegistryError, loadTestAdapterRegistry, loadTestAdapterRegistryRoot,
} from "../cressetide/skills/vigil/scripts/adapter-registry.mjs";
import { loadVendorCapability } from "../cressetide/skills/vigil/scripts/parser-ignore-wrapper.mjs";
import { root } from "./support.mjs";
import { temporary } from "./helpers.mjs";

const SCRIPTS_REL = "cressetide/skills/vigil/scripts";
const VENDOR_REL = "cressetide/skills/vigil/vendor";
const REGISTRY_PATH = path.join(root, SCRIPTS_REL, "test-adapters.json");
const SHIPPED = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
const MANIFEST = JSON.parse(fs.readFileSync(path.join(root, VENDOR_REL, "vendor-manifest.json"), "utf8"));

// Identity by name, not by class: the scratch cases load a SECOND instance of the loader module,
// which has its own TestAdapterRegistryError constructor, so instanceof across the two would fail
// on an error that is exactly the right type.
const codeOf = async (fn) => {
  try { await fn(); } catch (e) {
    assert.strictEqual(e && e.name, "TestAdapterRegistryError", `expected a TestAdapterRegistryError, got ${e && e.name}: ${e && e.message}`);
    return e.code;
  }
  return null;
};

// A repo-external copy of the shipped layout. Both the loader and the wrapper resolve their files
// from their own location, so a scratch copy is a fully independent registry and capability.
// `mutateManifest` lets a single case move the vendor manifest and the registry together, which is
// what it takes to isolate a registry-side rule: if only the registry moved, the wrapper's identity
// comparison would fire first and hide whatever the registry was supposed to catch on its own.
function scratchLayout(mutate, mutateManifest) {
  const dir = temporary("ctide-scratch-registry-");
  const vigil = path.join(dir, "cressetide", "skills", "vigil");
  fs.mkdirSync(path.join(vigil, "scripts"), { recursive: true });
  fs.cpSync(path.join(root, VENDOR_REL), path.join(vigil, "vendor"), { recursive: true });
  // The loader's whole static import graph has to come along, or the scratch copy fails to load for
  // a reason that has nothing to do with the registry rule under test.
  for (const file of ["adapter-registry.mjs", "test-adapters.json", "parser-ignore-wrapper.mjs", "parser-ignore-worker.mjs",
    "parser-ignore-worker-runner.mjs", "node-test-adapter.mjs", "provenance-store.mjs"]) {
    fs.cpSync(path.join(root, SCRIPTS_REL, file), path.join(vigil, "scripts", file));
  }
  if (mutateManifest) {
    const manifestFile = path.join(vigil, "vendor", "vendor-manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    mutateManifest(manifest);
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  }
  const registryFile = path.join(vigil, "scripts", "test-adapters.json");
  const registry = JSON.parse(fs.readFileSync(registryFile, "utf8"));
  const written = mutate(registry);
  fs.writeFileSync(registryFile, written === undefined ? JSON.stringify(registry, null, 2) : written);
  return { dir, url: pathToFileURL(path.join(vigil, "scripts", "adapter-registry.mjs")).href };
}

async function expectScratch(expected, mutate, label, mutateManifest) {
  const { dir, url } = scratchLayout(mutate, mutateManifest);
  try {
    const scratch = await import(url);
    assert.strictEqual(await codeOf(() => scratch.loadTestAdapterRegistry()), expected, label);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// --- positives ---------------------------------------------------------------------------------------

test("registry: the shipped registry loads and matches the file on disk", () => {
  const registry = loadTestAdapterRegistry();
  assert.strictEqual(registry.registryVersion, SHIPPED.registryVersion);
  assert.strictEqual(registry.registryPath, REGISTRY_PATH);
  assert.strictEqual(registry.adapters.length, SHIPPED.adapters.length);
  const [adapter] = registry.adapters;
  const [shipped] = SHIPPED.adapters;
  assert.strictEqual(adapter.adapterId, shipped.adapterId);
  assert.strictEqual(adapter.language, shipped.language);
  assert.strictEqual(adapter.framework, shipped.framework);
  assert.strictEqual(adapter.implementationId, shipped.implementationId);
  assert.deepStrictEqual([...adapter.testDeclarationPatternIds], shipped.testDeclarationPatternIds);
  assert.deepStrictEqual([...adapter.containerPatternIds], shipped.containerPatternIds);
  assert.strictEqual(adapter.attachmentRule, shipped.attachmentRule);
  assert.strictEqual(adapter.stableIdRule, shipped.stableIdRule);
  assert.strictEqual(adapter.discovery.explicitConfigPath, shipped.discovery.explicitConfigPath);
  assert.deepStrictEqual([...adapter.discovery.manifestDependencies], shipped.discovery.manifestDependencies);
  assert.deepStrictEqual([...adapter.discovery.importSpecifiers], shipped.discovery.importSpecifiers);
});

test("registry: the declared identity is the one the vendor manifest authorizes, field for field", () => {
  const declared = loadTestAdapterRegistry().adapters[0].implementationIdentity;
  const fromManifest = loadVendorCapability().identities.parser;
  assert.deepStrictEqual({ ...declared }, { ...fromManifest });
  // And the manifest itself is what that came from, not a value restated in either module.
  assert.deepStrictEqual({ ...declared }, MANIFEST.implementationIdentity);
});

test("registry: the descriptor and every nested value are frozen", () => {
  const registry = loadTestAdapterRegistry();
  const [adapter] = registry.adapters;
  for (const [label, value] of [
    ["registry", registry], ["adapters", registry.adapters], ["adapter", adapter],
    ["implementationIdentity", adapter.implementationIdentity],
    ["testDeclarationPatternIds", adapter.testDeclarationPatternIds],
    ["containerPatternIds", adapter.containerPatternIds],
    ["discovery", adapter.discovery],
    ["discovery.manifestDependencies", adapter.discovery.manifestDependencies],
    ["discovery.importSpecifiers", adapter.discovery.importSpecifiers],
  ]) {
    assert.ok(Object.isFrozen(value), `${label} must be frozen`);
  }
});

test("registry: caller mutation attempts change nothing on the next read", () => {
  const registry = loadTestAdapterRegistry();
  const [adapter] = registry.adapters;
  // Silent no-ops in sloppy mode, throws in strict mode; either is fine. What matters is the read
  // that follows.
  const attempts = [
    () => { adapter.implementationIdentity.parserVersion = "0.0.0"; },
    () => { adapter.testDeclarationPatternIds.length = 0; },
    () => { adapter.testDeclarationPatternIds.push("smuggled"); },
    () => { adapter.discovery.importSpecifiers[0] = "test"; },
    () => { adapter.discovery.explicitConfigPath = "/etc/passwd"; },
    () => { adapter.attachmentRule = "decorator"; },
    () => { registry.adapters.push({ adapterId: "smuggled" }); },
    () => { registry.registryVersion = 999; },
  ];
  for (const attempt of attempts) { try { attempt(); } catch { /* frozen: rejection is the point */ } }

  const again = loadTestAdapterRegistry();
  assert.strictEqual(again.registryVersion, 1);
  assert.strictEqual(again.adapters.length, 1);
  assert.deepStrictEqual({ ...again.adapters[0].implementationIdentity }, MANIFEST.implementationIdentity);
  assert.deepStrictEqual([...again.adapters[0].testDeclarationPatternIds], ["node-test-call"]);
  assert.deepStrictEqual([...again.adapters[0].discovery.importSpecifiers], ["node:test"]);
  assert.strictEqual(again.adapters[0].discovery.explicitConfigPath, ".ctide/test-adapters-config.json");
  assert.strictEqual(again.adapters[0].attachmentRule, "leading-line-comments");
});

// The exact parsed root exists for §11b.9c's registryDigest preimage, which is the whole file root.
// The descriptor cannot stand in for it: it carries a loader-only registryPath and its adapters are
// rebuilt objects. Both come from ONE read, so the digest covers the bytes the loader validated
// rather than whatever a second read might find.
test("registry: the exact parsed root is the file root, from the same validated read", async () => {
  const rootObject = loadTestAdapterRegistryRoot();
  assert.deepStrictEqual(Object.keys(rootObject).sort(), ["adapters", "registryVersion"],
    "exactly the file root -- no registryPath, nothing added");
  assert.deepStrictEqual(rootObject, SHIPPED, "and it equals the shipped file as parsed");
  assert.notStrictEqual(rootObject, loadTestAdapterRegistry(), "it is not the descriptor");
  assert.strictEqual("registryPath" in rootObject, false);
  assert.strictEqual(loadTestAdapterRegistry().registryPath, REGISTRY_PATH, "which still has one");

  assert.ok(Object.isFrozen(rootObject) && Object.isFrozen(rootObject.adapters)
    && Object.isFrozen(rootObject.adapters[0]) && Object.isFrozen(rootObject.adapters[0].implementationIdentity),
  "frozen all the way down");
  try { rootObject.adapters[0].adapterId = "smuggled"; } catch { /* frozen: rejection is the point */ }
  assert.strictEqual(loadTestAdapterRegistryRoot().adapters[0].adapterId, SHIPPED.adapters[0].adapterId,
    "a caller's mutation attempt changes nothing on the next read");
  assert.strictEqual(loadTestAdapterRegistryRoot(), rootObject, "one cached read serves both accessors");

  assert.strictEqual(loadTestAdapterRegistryRoot.length, 0, "it declares no parameter");
  for (const override of [{ registryPath: REGISTRY_PATH }, { registry: SHIPPED }, { modulePath: "./elsewhere.mjs" }]) {
    assert.strictEqual(await codeOf(() => loadTestAdapterRegistryRoot(override)), "E_API_ARGUMENTS", JSON.stringify(Object.keys(override)));
  }
});

// Validation is unconditional and comes first, so there is no path that hands back a root the
// §11b.3 schema rejected -- a digest is never taken over a registry that is not a registry.
test("registry: an invalid registry yields no root at all, rather than an unvalidated one", async () => {
  const { dir, url } = scratchLayout((registry) => { registry.registryVersion = 2; });
  try {
    const scratch = await import(url);
    assert.strictEqual(await codeOf(() => scratch.loadTestAdapterRegistryRoot()), "E_REGISTRY_UNSUPPORTED");
    assert.strictEqual(await codeOf(() => scratch.loadTestAdapterRegistry()), "E_REGISTRY_UNSUPPORTED",
      "both accessors fail the same way, because both come from the same validated build");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("registry: the loader has no override surface", async () => {
  assert.strictEqual(loadTestAdapterRegistry.length, 0, "the loader must declare no parameter");
  const overrides = [
    { registryPath: REGISTRY_PATH },
    { registry: SHIPPED },
    { manifestPath: path.join(root, VENDOR_REL, "vendor-manifest.json") },
    { vendor: loadVendorCapability() },
    { modulePath: "./somewhere-else.mjs" },
  ];
  for (const override of overrides) {
    assert.strictEqual(await codeOf(() => loadTestAdapterRegistry(override)), "E_API_ARGUMENTS", JSON.stringify(Object.keys(override)));
  }
  assert.strictEqual(await codeOf(() => loadTestAdapterRegistry(undefined)), "E_API_ARGUMENTS",
    "even an undefined argument is an argument, and must not be silently ignored");
});

test("registry: an untouched scratch copy of the shipped layout still loads", async () => {
  const { dir, url } = scratchLayout(() => {});
  try {
    const scratch = await import(url);
    const registry = scratch.loadTestAdapterRegistry();
    assert.deepStrictEqual({ ...registry.adapters[0].implementationIdentity }, MANIFEST.implementationIdentity,
      "the scratch harness must be able to succeed, or its failures prove nothing");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- single-variable negatives -------------------------------------------------------------------------

test("registry: root shape, version and adapters array", async () => {
  await expectScratch("E_REGISTRY_SHAPE", (r) => { delete r.adapters; }, "root missing a key");
  await expectScratch("E_REGISTRY_SHAPE", (r) => { r.extra = 1; }, "root with an undeclared key");
  await expectScratch("E_REGISTRY_UNSUPPORTED", (r) => { r.registryVersion = 2; }, "registryVersion 2");
  await expectScratch("E_REGISTRY_UNSUPPORTED", (r) => { r.registryVersion = "1"; }, "registryVersion as a string");
  await expectScratch("E_REGISTRY_SHAPE", (r) => { r.adapters = {}; }, "adapters not an array");
  await expectScratch("E_REGISTRY_SHAPE", (r) => { r.adapters = []; }, "adapters empty");
});

test("registry: unreadable file and invalid JSON", async () => {
  // A read failure needs the file to be gone, not empty: an empty file is a parse failure.
  const { dir, url } = scratchLayout(() => {});
  try {
    fs.rmSync(path.join(dir, "cressetide", "skills", "vigil", "scripts", "test-adapters.json"));
    const scratch = await import(url);
    assert.strictEqual(await codeOf(() => scratch.loadTestAdapterRegistry()), "E_REGISTRY_UNREADABLE");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }

  await expectScratch("E_REGISTRY_SHAPE", () => "{ not json", "invalid JSON");
  await expectScratch("E_REGISTRY_SHAPE", () => "[]", "root is an array");
  await expectScratch("E_REGISTRY_SHAPE", () => "null", "root is null");
});

test("registry: adapter shape and required strings", async () => {
  await expectScratch("E_REGISTRY_SHAPE", (r) => { delete r.adapters[0].stableIdRule; }, "adapter missing a key");
  await expectScratch("E_REGISTRY_SHAPE", (r) => { r.adapters[0].extra = true; }, "adapter with an undeclared key");
  await expectScratch("E_REGISTRY_SHAPE", (r) => { r.adapters[0].adapterId = ""; }, "empty adapterId");
  await expectScratch("E_REGISTRY_SHAPE", (r) => { r.adapters[0].language = ""; }, "empty language");
  await expectScratch("E_REGISTRY_SHAPE", (r) => { r.adapters[0].framework = ""; }, "empty framework");
  await expectScratch("E_REGISTRY_SHAPE", (r) => { r.adapters[0].adapterId = "Node-Test"; }, "adapterId is not a legal ID token");
  await expectScratch("E_REGISTRY_SHAPE", (r) => { r.adapters[0].adapterId = "node--test"; }, "adapterId has an empty segment");
  await expectScratch("E_REGISTRY_SHAPE", (r) => { r.adapters[0].adapterId = "1node"; }, "adapterId starts with a digit");
});

test("registry: implementationIdentity shape and agreement", async () => {
  await expectScratch("E_REGISTRY_SHAPE", (r) => { delete r.adapters[0].implementationIdentity.parserId; }, "identity missing a key");
  await expectScratch("E_REGISTRY_SHAPE", (r) => { r.adapters[0].implementationIdentity.extra = "x"; }, "identity with an undeclared key");
  await expectScratch("E_REGISTRY_SHAPE", (r) => { r.adapters[0].implementationIdentity.parserVersion = ""; }, "identity field empty");
  await expectScratch("E_REGISTRY_SHAPE", (r) => { r.adapters[0].implementationIdentity.implementationId = "node-test-v2"; },
    "identity implementationId disagrees with the adapter's");
  await expectScratch("E_REGISTRY_IDENTITY", (r) => { r.adapters[0].implementationIdentity.parserId = "espree"; },
    "parserId disagrees with the shipped manifest");
  await expectScratch("E_REGISTRY_IDENTITY", (r) => { r.adapters[0].implementationIdentity.parserVersion = "8.18.1"; },
    "parserVersion disagrees with the shipped manifest");
});

test("registry: an identity field must obey the ID-token grammar even when the manifest agrees", async () => {
  // The registry and the manifest are moved together, so the equality check passes and the only
  // thing left to object is the grammar itself. The package is renamed alongside the identity so
  // the wrapper can still resolve its own authority packet -- otherwise E_IDENTITY_UNRESOLVED would
  // fire first and this case would prove nothing about the registry.
  await expectScratch(
    "E_REGISTRY_SHAPE",
    (r) => { r.adapters[0].implementationIdentity.parserId = "Acorn"; },
    "capitalised parserId, agreed on both sides, is still not a legal ID token",
    (m) => {
      m.implementationIdentity.parserId = "Acorn";
      for (const pkg of m.packages) if (pkg.name === "acorn") pkg.name = "Acorn";
    },
  );
  // The same shape with a legal token is accepted, which is what makes the rejection above about
  // the grammar rather than about the harness.
  const { dir, url } = scratchLayout(
    (r) => { r.adapters[0].implementationIdentity.parserId = "acorn-fork"; },
    (m) => {
      m.implementationIdentity.parserId = "acorn-fork";
      for (const pkg of m.packages) if (pkg.name === "acorn") pkg.name = "acorn-fork";
    },
  );
  try {
    const scratch = await import(url);
    assert.strictEqual(scratch.loadTestAdapterRegistry().adapters[0].implementationIdentity.parserId, "acorn-fork");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("registry: unknown implementationId fails closed without any module lookup", async () => {
  await expectScratch("E_REGISTRY_UNSUPPORTED", (r) => {
    r.adapters[0].implementationId = "node-test-v2";
    r.adapters[0].implementationIdentity.implementationId = "node-test-v2";
  }, "unknown implementationId");
  // A name that looks like a path must not become one: still just an unknown token.
  await expectScratch("E_REGISTRY_SHAPE", (r) => {
    r.adapters[0].implementationId = "../../evil.mjs";
    r.adapters[0].implementationIdentity.implementationId = "../../evil.mjs";
  }, "implementationId shaped like a module path");
});

test("registry: the node-test-v1 binding row is exact in every column", async () => {
  await expectScratch("E_REGISTRY_UNSUPPORTED", (r) => { r.adapters[0].language = "typescript"; }, "wrong language");
  await expectScratch("E_REGISTRY_UNSUPPORTED", (r) => { r.adapters[0].framework = "vitest"; }, "wrong framework");
  await expectScratch("E_REGISTRY_UNSUPPORTED", (r) => { r.adapters[0].attachmentRule = "decorator"; }, "wrong attachmentRule");
  await expectScratch("E_REGISTRY_UNSUPPORTED", (r) => { r.adapters[0].stableIdRule = "annotation-v1"; }, "wrong stableIdRule");
});

test("registry: pattern arrays are closed tokens in canonical form, never repaired", async () => {
  // Closed TOKENS and the canonical-array carrier only. The AST predicates these tokens name are
  // not implemented, and nothing here asserts their behaviour.
  const wrongToken = { testDeclarationPatternIds: "node-test-describe", containerPatternIds: "node-test-call" };
  for (const key of ["testDeclarationPatternIds", "containerPatternIds"]) {
    await expectScratch("E_REGISTRY_UNSUPPORTED", (r) => { r.adapters[0][key] = [wrongToken[key]]; }, `${key} holds the other column's token`);
    await expectScratch("E_REGISTRY_SHAPE", (r) => { r.adapters[0][key] = []; }, `${key} empty`);
    await expectScratch("E_REGISTRY_SHAPE", (r) => { r.adapters[0][key] = "node-test-call"; }, `${key} not an array`);
    await expectScratch("E_REGISTRY_SHAPE", (r) => { r.adapters[0][key] = [r.adapters[0][key][0], r.adapters[0][key][0]]; }, `${key} duplicated`);
    await expectScratch("E_REGISTRY_SHAPE", (r) => { r.adapters[0][key] = ["Node-Test-Call"]; }, `${key} illegal token`);
  }
  // Non-canonical order is rejected as written rather than sorted into shape.
  await expectScratch("E_REGISTRY_SHAPE", (r) => { r.adapters[0].testDeclarationPatternIds = ["node-test-call", "aaa"]; },
    "testDeclarationPatternIds out of code-point order");
  await expectScratch("E_REGISTRY_SHAPE", (r) => { r.adapters[0].containerPatternIds = ["node-test-describe", "aaa"]; },
    "containerPatternIds out of code-point order");
});

test("registry: discovery declaration shape and exact data", async () => {
  await expectScratch("E_REGISTRY_SHAPE", (r) => { delete r.adapters[0].discovery.importSpecifiers; }, "discovery missing a key");
  await expectScratch("E_REGISTRY_SHAPE", (r) => { r.adapters[0].discovery.filePatternIds = []; }, "discovery with an undeclared key");
  await expectScratch("E_REGISTRY_UNSUPPORTED", (r) => { r.adapters[0].discovery.explicitConfigPath = ".ctide/other.json"; }, "wrong explicitConfigPath");
  await expectScratch("E_REGISTRY_UNSUPPORTED", (r) => { r.adapters[0].discovery.explicitConfigPath = null; }, "null explicitConfigPath");
  await expectScratch("E_REGISTRY_UNSUPPORTED", (r) => { r.adapters[0].discovery.manifestDependencies = ["node"]; }, "non-empty manifestDependencies");
  await expectScratch("E_REGISTRY_UNSUPPORTED", (r) => { r.adapters[0].discovery.importSpecifiers = ["test"]; }, "importSpecifiers impostor");
  await expectScratch("E_REGISTRY_UNSUPPORTED", (r) => { r.adapters[0].discovery.importSpecifiers = []; }, "importSpecifiers empty");
  await expectScratch("E_REGISTRY_SHAPE", (r) => { r.adapters[0].discovery.importSpecifiers = ["node:test", "node:test"]; },
    "importSpecifiers duplicated breaks canonical form before the exact-value check");
  await expectScratch("E_REGISTRY_SHAPE", (r) => { r.adapters[0].discovery.importSpecifiers = "node:test"; }, "importSpecifiers not an array");
});

test("registry: uniqueness across adapters", async () => {
  await expectScratch("E_REGISTRY_SHAPE", (r) => { r.adapters.push(JSON.parse(JSON.stringify(r.adapters[0]))); },
    "duplicate adapterId");
  await expectScratch("E_REGISTRY_SHAPE", (r) => {
    const clone = JSON.parse(JSON.stringify(r.adapters[0]));
    clone.adapterId = "node-test-alt";
    r.adapters.push(clone);
  }, "duplicate (implementationId, framework) under a different adapterId");
});

test("registry: no scratch failure ever reached the production registry or capability", () => {
  const registry = loadTestAdapterRegistry();
  assert.strictEqual(registry.registryPath, REGISTRY_PATH);
  assert.strictEqual(registry.registryVersion, 1);
  assert.strictEqual(registry.adapters.length, 1);
  assert.strictEqual(registry.adapters[0].adapterId, SHIPPED.adapters[0].adapterId);
  assert.deepStrictEqual({ ...registry.adapters[0].implementationIdentity }, MANIFEST.implementationIdentity);
  assert.deepStrictEqual({ ...loadVendorCapability().identities.parser }, MANIFEST.implementationIdentity);
});
