// S3 source freshness, driven through the real public API against real temporary Git repositories.
//
// Spec anchors:
//   TP = docs/superpowers/specs/2026-07-25-test-provenance-spec.md (approved v1.11)
//        11b.3 registry exact schema and its raw duplicate-member rule, 11b.4 explicit config exact
//        schema, the tracked carrier requirement and its duplicate-member rule, 11b.9c registryDigest
//        with a fresh registry observation per S3, the consumer protocol's step 1, 11b.9d source vs
//        store freshness, 11b.10 head view universe and the exact config-path observability
//        exception, AC92, AC118, AC119, AC127, AC131, AC135, AC138, AC159-AC162
//   SM = docs/superpowers/specs/2026-07-25-shared-decision-provenance-model.md (approved v1.14)
//
// The current digests are never recomputed by this file from a copy of the production algorithm.
// They are read back out of the component's own failure detail, which is the only place it publishes
// them -- so every "fresh" fixture below is sealed with values the component itself produced. The one
// exception is the registryDigest FORMULA, which AC119 requires to be asserted directly; that is done
// with the published public helpers (loadTestAdapterRegistryRoot, canonicalJson, sha256Hex) and is
// labelled where it happens.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import cp from "node:child_process";
import { pathToFileURL } from "node:url";
import { temporary, root } from "./helpers.mjs";
import { canonicalJson, sha256Hex } from "../cressetide/skills/vigil/scripts/provenance-store.mjs";
import {
  loadTestAdapterRegistry, loadTestAdapterRegistryRoot,
} from "../cressetide/skills/vigil/scripts/adapter-registry.mjs";
import { captureHeadViewSnapshot } from "../cressetide/skills/vigil/scripts/head-view-snapshot.mjs";
import {
  computeInventoryV2Digest, computeInventoryDigest, parseInventory, loadInventory, UNSUPPORTED_POPULATED,
} from "../cressetide/skills/vigil/scripts/changed-test-inventory.mjs";
import {
  verifySourceFreshness, SourceFreshnessError, EXPLICIT_CONFIG_PATH,
} from "../cressetide/skills/vigil/scripts/s3-source-freshness.mjs";

const SCRIPTS_REL = path.join("cressetide", "skills", "vigil", "scripts");
const VENDOR_REL = path.join("cressetide", "skills", "vigil", "vendor");
const OID = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const STORE_DIGEST = sha256Hex("an input provenance store digest this component never interprets");

function git(args, cwd) {
  return cp.execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

// A real repository with a committed test file, so the head view has something to cover.
function repoWith(files = {}) {
  const cwd = temporary("ctide-s3-");
  git(["init", "-q", "--initial-branch=main"], cwd);
  git(["config", "user.email", "t@example.com"], cwd);
  git(["config", "user.name", "t"], cwd);
  writeFile(cwd, "test/a.test.mjs", "import { test } from \"node:test\";\ntest(\"a\", () => {});\n");
  for (const [rel, body] of Object.entries(files)) writeFile(cwd, rel, body);
  git(["add", "-A"], cwd);
  git(["commit", "-qm", "base"], cwd);
  return cwd;
}

function writeFile(cwd, rel, body) {
  const file = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, "utf8");
  return file;
}

const CONFIG = canonicalJson({
  configVersion: 1,
  assignments: [{ path: "test/a.test.mjs", adapterId: "node-test" }],
});

// One canonical entry, byte-identical in every case below, so "entries did not change" is a fact
// about the fixtures rather than a claim.
const ENTRY = {
  testRef: { path: "test/a.test.mjs", adapterId: "node-test", structuralId: "s:[\"a\"]" },
  status: "modified",
  reason: "content-change",
  tagBefore: { clauseRef: "REQ-00000000000000000000000000" },
  tagAfter: { clauseRef: "REQ-00000000000000000000000000" },
  baseBodyDigest: sha256Hex("base body"),
  headBodyDigest: sha256Hex("head body"),
  framework: "node:test",
  implementationIdentity: { implementationId: "node-test-v1", parserId: "acorn", parserVersion: "8.18.0" },
};

function envelopeText({ headViewDigest, registryDigest }) {
  const body = {
    inventoryVersion: 2,
    baseTreeOid: OID,
    registryDigest,
    headViewDigest,
    inputProvenanceStoreDigest: STORE_DIGEST,
    entries: [ENTRY],
  };
  return canonicalJson({ ...body, inventoryDigest: computeInventoryV2Digest(body) });
}

const PLACEHOLDER = { headViewDigest: sha256Hex("not the head view"), registryDigest: sha256Hex("not the registry") };

// The component publishes the current values only in its failure detail, so a deliberately wrong
// envelope is how a fixture learns what "fresh" is.
async function currentDigests(cwd, verify = verifySourceFreshness) {
  try {
    await verify({ repoRoot: cwd, inventoryText: envelopeText(PLACEHOLDER) });
  } catch (e) {
    assert.strictEqual(e.code, "E_STALE", `expected a stale refusal to read the current digests from, got ${e.code}: ${e.message}`);
    assert.strictEqual(e.detail.headViewDigest.matches, false);
    assert.strictEqual(e.detail.registryDigest.matches, false);
    return { headViewDigest: e.detail.headViewDigest.actual, registryDigest: e.detail.registryDigest.actual };
  }
  assert.fail("a placeholder envelope must not be fresh");
  return null;
}

async function freshText(cwd, verify) {
  return envelopeText(await currentDigests(cwd, verify));
}

async function refused(promise, what, code = null) {
  let err = null;
  try { await promise; } catch (e) { err = e; }
  assert.ok(err, `${what}: must be refused`);
  if (code !== null) assert.strictEqual(err.code, code, `${what}: expected code ${code}, got ${err.code} (${err.message})`);
  return err;
}

// A repo-external copy of the shipped layout, so a case can mutate test-adapters.json without
// touching the shipped one. The loader and the wrapper both resolve from their own location, so the
// copy is a fully independent registry and capability.
function scratchScripts(mutateRegistry) {
  const dir = temporary("ctide-s3-scratch-");
  const vigil = path.join(dir, "cressetide", "skills", "vigil");
  fs.mkdirSync(path.join(vigil, "scripts"), { recursive: true });
  fs.cpSync(path.join(root, VENDOR_REL), path.join(vigil, "vendor"), { recursive: true });
  for (const file of ["s3-source-freshness.mjs", "adapter-registry.mjs", "test-adapters.json",
    "head-view-snapshot.mjs", "changed-test-inventory.mjs", "parser-ignore-wrapper.mjs",
    "parser-ignore-worker.mjs", "parser-ignore-worker-runner.mjs", "node-test-adapter.mjs",
    // the shared raw duplicate-member scanner is part of both the registry loader's and S3's graph
    "provenance-store.mjs", "json-unique-members.mjs"]) {
    fs.cpSync(path.join(root, SCRIPTS_REL, file), path.join(vigil, "scripts", file));
  }
  const registryFile = path.join(vigil, "scripts", "test-adapters.json");
  const registry = JSON.parse(fs.readFileSync(registryFile, "utf8"));
  const written = mutateRegistry(registry);
  fs.writeFileSync(registryFile, written === undefined ? JSON.stringify(registry, null, 2) : written);
  return { dir, url: pathToFileURL(path.join(vigil, "scripts", "s3-source-freshness.mjs")).href };
}

// =================================================================================================
// The registryDigest formula and its carriers (AC119)
// =================================================================================================

test("AC119: with no explicit config the preimage carries null, and {} would give another digest", async () => {
  const cwd = repoWith();
  try {
    const { registryDigest } = await currentDigests(cwd);
    const registry = loadTestAdapterRegistryRoot();

    // AC119's formula, asserted directly against what the component produced.
    assert.strictEqual(registryDigest, sha256Hex(canonicalJson({ registry, explicitConfig: null })),
      "the component's registryDigest is sha256(canonicalJson({ registry: <exact root>, explicitConfig: null }))");
    assert.notStrictEqual(registryDigest, sha256Hex(canonicalJson({ registry, explicitConfig: {} })),
      "AC119 (ii): substituting {} for null must produce a different digest");

    assert.strictEqual(fs.existsSync(path.join(cwd, EXPLICIT_CONFIG_PATH)), false,
      "and no config file was created to make the absent case work");
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});

test("AC119 (i): the preimage is the whole registry root, not adapters alone and not the loader descriptor", async () => {
  const cwd = repoWith();
  try {
    const { registryDigest } = await currentDigests(cwd);
    const registry = loadTestAdapterRegistryRoot();

    assert.deepStrictEqual(Object.keys(registry).sort(), ["adapters", "registryVersion"],
      "the root exposed for the preimage is exactly the file root");

    for (const [alternative, label] of [
      [{ adapters: registry.adapters }, "adapters alone, with registryVersion dropped"],
      [{ ...registry, registryVersion: 2 }, "the same adapters with a different registryVersion"],
      [{ ...registry, registryPath: "/somewhere/test-adapters.json" }, "the root with a loader-only registryPath added"],
      [loadTestAdapterRegistry(), "the loader descriptor, which carries registryPath"],
    ]) {
      assert.notStrictEqual(registryDigest, sha256Hex(canonicalJson({ registry: alternative, explicitConfig: null })),
        `${label} must NOT produce the component's digest`);
    }
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});

test("AC119: a valid explicit config enters the digest as the parsed exact object from the snapshot", async () => {
  const bare = repoWith();
  const configured = repoWith({ [EXPLICIT_CONFIG_PATH]: `${CONFIG}\n` });
  try {
    const withoutConfig = (await currentDigests(bare)).registryDigest;
    const withConfig = (await currentDigests(configured)).registryDigest;
    assert.notStrictEqual(withConfig, withoutConfig, "a present config changes the registryDigest");

    const registry = loadTestAdapterRegistryRoot();
    assert.strictEqual(withConfig, sha256Hex(canonicalJson({ registry, explicitConfig: JSON.parse(CONFIG) })),
      "and the object in the preimage is the parsed config exactly as the head view carries it");

    // the bytes on disk were neither rewritten nor reordered by being read
    assert.strictEqual(fs.readFileSync(path.join(configured, EXPLICIT_CONFIG_PATH), "utf8"), `${CONFIG}\n`);
  } finally {
    fs.rmSync(bare, { recursive: true, force: true });
    fs.rmSync(configured, { recursive: true, force: true });
  }
});

test("11b.4: a malformed explicit config is fail-closed and is never repaired", async () => {
  for (const [body, label, code] of [
    ["{ not json", "malformed JSON", "E_CONFIG_SHAPE"],
    [canonicalJson({ configVersion: 2, assignments: [] }), "configVersion 2", "E_CONFIG_FIELD"],
    [canonicalJson({ configVersion: "1", assignments: [] }), "a string configVersion", "E_CONFIG_FIELD"],
    [canonicalJson({ configVersion: 1, assignments: [], extra: 1 }), "an undeclared root key", "E_CONFIG_SHAPE"],
    [canonicalJson({ configVersion: 1 }), "a missing assignments key", "E_CONFIG_SHAPE"],
    [canonicalJson({ configVersion: 1, assignments: {} }), "assignments as an object", "E_CONFIG_SHAPE"],
    [canonicalJson({ configVersion: 1, assignments: [{ path: "test/a.test.mjs", adapterId: "node-test", extra: 1 }] }),
      "an assignment with an extra key", "E_CONFIG_SHAPE"],
    [canonicalJson({ configVersion: 1, assignments: [{ path: "test/a.test.mjs" }] }),
      "an assignment missing adapterId", "E_CONFIG_SHAPE"],
    [canonicalJson({ configVersion: 1, assignments: [
      { path: "test/a.test.mjs", adapterId: "node-test" }, { path: "test/a.test.mjs", adapterId: "node-test" }] }),
      "a duplicate assignment path", "E_CONFIG_FIELD"],
    [canonicalJson({ configVersion: 1, assignments: [{ path: "test/a.test.mjs", adapterId: "no-such-adapter" }] }),
      "an unknown adapterId", "E_CONFIG_FIELD"],
    [canonicalJson({ configVersion: 1, assignments: [{ path: "test\\a.test.mjs", adapterId: "node-test" }] }),
      "a backslash in an assignment path", "E_CONFIG_FIELD"],
    [canonicalJson({ configVersion: 1, assignments: [{ path: "../a.test.mjs", adapterId: "node-test" }] }),
      "a dot-segment in an assignment path", "E_CONFIG_FIELD"],
  ]) {
    const cwd = repoWith({ [EXPLICIT_CONFIG_PATH]: body });
    try {
      const before = fs.readFileSync(path.join(cwd, EXPLICIT_CONFIG_PATH), "utf8");
      const err = await refused(
        verifySourceFreshness({ repoRoot: cwd, inventoryText: envelopeText(PLACEHOLDER) }), label, code);
      assert.strictEqual(err.name, "SourceFreshnessError", `${label}: typed error`);
      assert.strictEqual(fs.readFileSync(path.join(cwd, EXPLICIT_CONFIG_PATH), "utf8"), before,
        `${label}: the config was not repaired, reordered or rewritten`);
    } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
  }
});

// =================================================================================================
// AC118 -- the source-freshness matrix, entries byte-identical throughout
// =================================================================================================

test("AC118 positive: an unchanged repo, head, registry and config is fresh", async () => {
  const cwd = repoWith({ [EXPLICIT_CONFIG_PATH]: `${CONFIG}\n` });
  try {
    const text = await freshText(cwd);
    const result = await verifySourceFreshness({ repoRoot: cwd, inventoryText: text });
    assert.strictEqual(result.sourceFresh, true);
    assert.strictEqual(result.entryCount, 1, "a count, not the entries themselves");
    assert.strictEqual(result.explicitConfigPresent, true);
    assert.strictEqual("entries" in result, false, "the entries are NOT handed back as an acceptance");
    assert.ok(Object.isFrozen(result), "the result is immutable");

    // re-verifying the same bytes against the same world is still fresh
    await verifySourceFreshness({ repoRoot: cwd, inventoryText: text });
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});

test("AC118 (a): a test file added after the fact makes headViewDigest stale, entries unchanged", async () => {
  const cwd = repoWith();
  try {
    const text = await freshText(cwd);
    await verifySourceFreshness({ repoRoot: cwd, inventoryText: text });

    writeFile(cwd, "test/b.test.mjs", "import { test } from \"node:test\";\ntest(\"b\", () => {});\n");
    const err = await refused(verifySourceFreshness({ repoRoot: cwd, inventoryText: text }), "a new test file", "E_STALE");
    assert.strictEqual(err.detail.headViewDigest.matches, false, "headViewDigest moved");
    assert.strictEqual(err.detail.registryDigest.matches, true, "the registry did not");

    // AC118's closing assertion: a freshness check built on per-entry identity or on the v1
    // { baseTreeOid, entries } formula would have said nothing at all here.
    const parsed = JSON.parse(text);
    assert.deepStrictEqual(parsed.entries, [ENTRY], "entries are byte-identical across the change");
    assert.strictEqual(
      computeInventoryDigest({ baseTreeOid: parsed.baseTreeOid, entries: parsed.entries }),
      computeInventoryDigest({ baseTreeOid: OID, entries: [ENTRY] }),
      "the v1 formula is blind to this change, which is why S3 exists");
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});

test("AC118 (b): editing the head explicit config makes registryDigest stale, and it is not hidden", async () => {
  const cwd = repoWith({ [EXPLICIT_CONFIG_PATH]: `${CONFIG}\n` });
  try {
    const text = await freshText(cwd);
    await verifySourceFreshness({ repoRoot: cwd, inventoryText: text });

    writeFile(cwd, EXPLICIT_CONFIG_PATH, `${canonicalJson({
      configVersion: 1,
      assignments: [{ path: "test/other.test.mjs", adapterId: "node-test" }],
    })}\n`);

    const err = await refused(verifySourceFreshness({ repoRoot: cwd, inventoryText: text }), "an edited config", "E_STALE");
    // The config is inside the head view, so BOTH digests move. The registry mismatch must still be
    // reported rather than being swallowed by a first-error return.
    assert.strictEqual(err.detail.registryDigest.matches, false, "the registry mismatch is observable");
    assert.strictEqual(err.detail.headViewDigest.matches, false, "even though the head view moved too");
    assert.match(err.message, /registryDigest/, "and both appear in the message");
    assert.match(err.message, /headViewDigest/);
    assert.deepStrictEqual(JSON.parse(text).entries, [ENTRY], "entries unchanged");
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});

test("AC118 (c): mutating test-adapters.json in a scratch shipped layout is fail-closed at the audited layer", async () => {
  // Audited failure layer: the loader validates unconditionally and the digest is taken from the
  // very same validated read, so a SCHEMA-VALID mutation surfaces as a registryDigest mismatch and a
  // SCHEMA-INVALID one surfaces as a §11b.3 registry error. Both are fail-closed; neither is a
  // digest taken over a registry that is not a registry.
  // THE FAILURE FACE THIS CASE EXISTS FOR: the registry is mutated AFTER a successful S3, and the
  // second verification runs on the SAME module instance -- no re-import, no new process, no query
  // string. A cached root would still be sitting there, and the second call would report fresh
  // against a registry that has already changed. Re-importing after the mutation would give every
  // instance a cold cache and would never touch this.
  const cwd = repoWith();
  const scratch = scratchScripts(() => {});
  const invalid = scratchScripts((registry) => { registry.registryVersion = 2; });
  const registryFile = path.join(scratch.dir, "cressetide", "skills", "vigil", "scripts", "test-adapters.json");
  try {
    const module = await import(scratch.url);
    const verify = module.verifySourceFreshness;

    // 1. first S3 succeeds against the pristine scratch registry
    const pristine = await currentDigests(cwd, verify);
    const fresh = envelopeText(pristine);
    await verify({ repoRoot: cwd, inventoryText: fresh });

    // 2. schema-VALID mutation of that same layout
    const mutated = JSON.parse(fs.readFileSync(registryFile, "utf8"));
    mutated.adapters[0].adapterId = "node-test-renamed";
    fs.writeFileSync(registryFile, JSON.stringify(mutated, null, 2));

    // 3. second call on the SAME exported function must see the new root
    const err = await refused(verify({ repoRoot: cwd, inventoryText: fresh }),
      "a schema-valid registry edit seen by the same module instance", "E_STALE");
    assert.strictEqual(err.detail.registryDigest.matches, false, "the registry moved and S3 noticed");
    assert.strictEqual(err.detail.headViewDigest.matches, true, "only the registry moved");

    const moved = await currentDigests(cwd, verify);
    assert.strictEqual(moved.headViewDigest, pristine.headViewDigest, "the head view did not move");
    assert.notStrictEqual(moved.registryDigest, pristine.registryDigest,
      "and the current registryDigest really is a different value now");

    // schema-INVALID mutation fails at validation, before any digest comparison
    const scratchInvalid = await import(invalid.url);
    const registryError = await refused(
      scratchInvalid.verifySourceFreshness({ repoRoot: cwd, inventoryText: envelopeText(pristine) }),
      "a schema-invalid registry", "E_REGISTRY_UNSUPPORTED");
    assert.strictEqual(registryError.name, "TestAdapterRegistryError",
      "validation comes first: no digest is taken over a registry the §11b.3 schema rejects");
    assert.strictEqual(registryError.detail, undefined, "and it never reached the stale comparison");
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(scratch.dir, { recursive: true, force: true });
    fs.rmSync(invalid.dir, { recursive: true, force: true });
  }
});

test("AC118 + 11b.9d: changing only the provenance store or .ctide/output leaves S3 fresh", async () => {
  const cwd = repoWith();
  try {
    const text = await freshText(cwd);
    await verifySourceFreshness({ repoRoot: cwd, inventoryText: text });

    // 11b.10's closed exclusions. The store is excluded precisely so Step 5's own legal write cannot
    // make Step 6 stale (11b.9d), and .ctide/output is excluded so the digest cannot self-reference.
    writeFile(cwd, ".ctide/provenance.json", `${canonicalJson({ provenanceVersion: 2, changed: "after the fact" })}\n`);
    const afterStore = await verifySourceFreshness({ repoRoot: cwd, inventoryText: text });
    assert.strictEqual(afterStore.sourceFresh, true, "a store change does not make the source stale");

    writeFile(cwd, ".ctide/output/changed-test-inventory.json", text);
    writeFile(cwd, ".ctide/output/scratch.json", "{}\n");
    const afterOutput = await verifySourceFreshness({ repoRoot: cwd, inventoryText: text });
    assert.strictEqual(afterOutput.sourceFresh, true, "nor does per-run scratch under .ctide/output");

    // and the store was never read: it stays byte-identical, and the module names no store API
    const source = fs.readFileSync(path.join(root, SCRIPTS_REL, "s3-source-freshness.mjs"), "utf8");
    for (const forbidden of ["loadStore", "CANONICAL_STORE_PATH", "storeDigest", "applyTransaction", "provenance.json"]) {
      assert.ok(!source.includes(forbidden), `the component must not mention ${forbidden}`);
    }
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});

test("AC118: a declared digest that is well-formed but wrong is stale, one carrier at a time", async () => {
  const cwd = repoWith();
  try {
    const fresh = await currentDigests(cwd);

    const headWrong = await refused(
      verifySourceFreshness({ repoRoot: cwd, inventoryText: envelopeText({ ...fresh, headViewDigest: sha256Hex("wrong head") }) }),
      "a wrong headViewDigest", "E_STALE");
    assert.strictEqual(headWrong.detail.headViewDigest.matches, false);
    assert.strictEqual(headWrong.detail.registryDigest.matches, true);

    const registryWrong = await refused(
      verifySourceFreshness({ repoRoot: cwd, inventoryText: envelopeText({ ...fresh, registryDigest: sha256Hex("wrong registry") }) }),
      "a wrong registryDigest", "E_STALE");
    assert.strictEqual(registryWrong.detail.registryDigest.matches, false);
    assert.strictEqual(registryWrong.detail.headViewDigest.matches, true);

    const both = await refused(
      verifySourceFreshness({ repoRoot: cwd, inventoryText: envelopeText(PLACEHOLDER) }), "both wrong", "E_STALE");
    assert.strictEqual(both.detail.headViewDigest.matches, false, "both mismatches survive in the detail");
    assert.strictEqual(both.detail.registryDigest.matches, false);
    assert.ok(Object.isFrozen(both.detail), "the detail is immutable");
    assert.strictEqual(both.detail.headViewDigest.actual, fresh.headViewDigest);
    assert.strictEqual(both.detail.registryDigest.actual, fresh.registryDigest);
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});

test("a malformed canonical v2 document reports its OWN canonical error, not a stale one", async () => {
  const cwd = repoWith();
  try {
    for (const [text, label, code] of [
      ["{ not json", "malformed JSON", "E_JSON"],
      [canonicalJson({ inventoryVersion: 2 }), "a truncated root", "E_ROOT_SHAPE"],
      [canonicalJson({ ...JSON.parse(envelopeText(PLACEHOLDER)), inventoryDigest: sha256Hex("nope") }),
        "a wrong inventoryDigest", "E_DIGEST"],
      [canonicalJson((() => {
        const parsed = JSON.parse(envelopeText(PLACEHOLDER));
        parsed.entries = [{ ...ENTRY, status: "renamed" }];
        return parsed;
      })()), "an unknown entry status", "E_ENTRY_FIELD"],
    ]) {
      const err = await refused(verifySourceFreshness({ repoRoot: cwd, inventoryText: text }), label, code);
      assert.strictEqual(err.name, "InventoryError", `${label}: the canonical reader's own error type`);
      assert.notStrictEqual(err.code, "E_STALE", `${label}: never masked as staleness`);
    }
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});

// =================================================================================================
// Isolation, API surface and side effects
// =================================================================================================

test("the component has no override surface", async () => {
  const cwd = repoWith();
  try {
    const inventoryText = envelopeText(PLACEHOLDER);
    await refused(verifySourceFreshness(), "no argument", "E_API_ARGUMENTS");
    await refused(verifySourceFreshness({ repoRoot: cwd, inventoryText }, {}), "two arguments", "E_API_ARGUMENTS");

    for (const extra of [
      { snapshot: await captureHeadViewSnapshot({ repoRoot: cwd }) },
      { headViewSnapshot: "anything" },
      { registry: loadTestAdapterRegistryRoot() },
      { registryRoot: loadTestAdapterRegistryRoot() },
      { registryPath: path.join(root, SCRIPTS_REL, "test-adapters.json") },
      { explicitConfig: JSON.parse(CONFIG) },
      { explicitConfigPath: EXPLICIT_CONFIG_PATH },
      { configPath: EXPLICIT_CONFIG_PATH },
      { fs },
      { git: "git" },
      { gitExecutable: "git" },
      { env: { PATH: "" } },
      { environment: {} },
      { hash: sha256Hex },
      { sha256Hex },
      { headViewDigest: PLACEHOLDER.headViewDigest },
    ]) {
      await refused(verifySourceFreshness({ repoRoot: cwd, inventoryText, ...extra }),
        `override ${Object.keys(extra)[0]}`, "E_API_ARGUMENTS");
    }

    await refused(verifySourceFreshness({ repoRoot: cwd }), "a missing inventoryText", "E_API_ARGUMENTS");
    await refused(verifySourceFreshness({ inventoryText }), "a missing repoRoot", "E_API_ARGUMENTS");
    await refused(verifySourceFreshness({ repoRoot: "", inventoryText }), "an empty repoRoot", "E_API_ARGUMENTS");
    await refused(verifySourceFreshness({ repoRoot: cwd, inventoryText: 42 }), "a non-string inventoryText", "E_API_ARGUMENTS");
    assert.ok(new SourceFreshnessError("E_TEST", "m") instanceof Error, "the error type is exported");
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});

test("a refusal leaves the repository, the inventory, the store and the scratch directory untouched", async () => {
  const cwd = repoWith({ [EXPLICIT_CONFIG_PATH]: `${CONFIG}\n` });
  try {
    writeFile(cwd, ".ctide/provenance.json", "{\"provenanceVersion\":2}\n");
    const inventoryText = envelopeText(PLACEHOLDER);
    writeFile(cwd, ".ctide/output/changed-test-inventory.json", inventoryText);

    const listing = () => git(["status", "--porcelain", "--untracked-files=all"], cwd);
    const before = {
      listing: listing(),
      config: fs.readFileSync(path.join(cwd, EXPLICIT_CONFIG_PATH), "utf8"),
      store: fs.readFileSync(path.join(cwd, ".ctide/provenance.json"), "utf8"),
      inventory: fs.readFileSync(path.join(cwd, ".ctide/output/changed-test-inventory.json"), "utf8"),
      ctide: fs.readdirSync(path.join(cwd, ".ctide")).sort(),
      output: fs.readdirSync(path.join(cwd, ".ctide", "output")).sort(),
    };

    await refused(verifySourceFreshness({ repoRoot: cwd, inventoryText }), "a stale envelope", "E_STALE");

    assert.strictEqual(listing(), before.listing, "no file appeared or disappeared");
    assert.strictEqual(fs.readFileSync(path.join(cwd, EXPLICIT_CONFIG_PATH), "utf8"), before.config);
    assert.strictEqual(fs.readFileSync(path.join(cwd, ".ctide/provenance.json"), "utf8"), before.store);
    assert.strictEqual(fs.readFileSync(path.join(cwd, ".ctide/output/changed-test-inventory.json"), "utf8"), before.inventory);
    assert.deepStrictEqual(fs.readdirSync(path.join(cwd, ".ctide")).sort(), before.ctide, "no lock or temp residue");
    assert.deepStrictEqual(fs.readdirSync(path.join(cwd, ".ctide", "output")).sort(), before.output);
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});

test("verifying freshness does not make a v2 inventory acceptable to the product entry point", async () => {
  const cwd = repoWith();
  try {
    const populated = await freshText(cwd);
    await verifySourceFreshness({ repoRoot: cwd, inventoryText: populated });

    const parsed = JSON.parse(populated);
    const emptyBody = { ...parsed, entries: [] };
    delete emptyBody.inventoryDigest;
    const empty = canonicalJson({ ...emptyBody, inventoryDigest: computeInventoryV2Digest(emptyBody) });

    for (const [text, label] of [[populated, "a FRESH populated v2"], [empty, "an empty v2"]]) {
      let err = null;
      try { parseInventory(text); } catch (e) { err = e; }
      assert.ok(err && new RegExp(UNSUPPORTED_POPULATED).test(err.message),
        `${label}: the product entry point still refuses it`);
    }

    const file = writeFile(cwd, ".ctide/output/changed-test-inventory.json", populated);
    let loadErr = null;
    try { loadInventory(file); } catch (e) { loadErr = e; }
    assert.ok(loadErr && new RegExp(UNSUPPORTED_POPULATED).test(loadErr.message),
      "and so does loadInventory, freshness or no freshness");
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});

// =================================================================================================
// v1.11 §11b.4: only a TRACKED carrier is a legal explicit config, and the exact config path is
// observable even when the project ignores the whole of .ctide/.
// =================================================================================================

// A repository that ignores .ctide/ wholesale -- the normal shape of a consuming project, and the
// one that makes the distinction below testable at all.
function repoIgnoringCtide(configBody = null, stage = "none") {
  const cwd = temporary("ctide-s3-carrier-");
  git(["init", "-q", "--initial-branch=main"], cwd);
  git(["config", "user.email", "t@example.com"], cwd);
  git(["config", "user.name", "t"], cwd);
  writeFile(cwd, ".gitignore", "/.ctide/\n");
  writeFile(cwd, "test/a.test.mjs", "import { test } from \"node:test\";\ntest(\"a\", () => {});\n");
  git(["add", "-A"], cwd);
  git(["commit", "-qm", "base"], cwd);
  if (configBody !== null) {
    writeFile(cwd, EXPLICIT_CONFIG_PATH, configBody);
    if (stage === "tracked") git(["add", "-f", EXPLICIT_CONFIG_PATH], cwd);
  }
  return cwd;
}

test("v1.11 §11b.4: a tracked config is accepted even though the project ignores .ctide/", async () => {
  const cwd = repoIgnoringCtide(`${CONFIG}\n`, "tracked");
  try {
    // The fixture really is the awkward one: Git ignores that path.
    assert.notStrictEqual(git(["check-ignore", "-v", "--no-index", EXPLICIT_CONFIG_PATH], cwd), "",
      "the tracked .gitignore really covers the config path");

    const text = await freshText(cwd);
    const result = await verifySourceFreshness({ repoRoot: cwd, inventoryText: text });
    assert.strictEqual(result.explicitConfigPresent, true, "the tracked carrier is used");

    // and its parsed object is what entered the preimage
    const registry = loadTestAdapterRegistryRoot();
    assert.strictEqual((await currentDigests(cwd)).registryDigest,
      sha256Hex(canonicalJson({ registry, explicitConfig: JSON.parse(CONFIG) })));
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});

test("v1.11 §11b.4: an UNTRACKED config with identical bytes is an invalid carrier, not absence", async () => {
  const tracked = repoIgnoringCtide(`${CONFIG}\n`, "tracked");
  const untracked = repoIgnoringCtide(`${CONFIG}\n`, "none");
  try {
    // Same bytes on both sides; the ONLY difference is the index.
    assert.strictEqual(
      fs.readFileSync(path.join(tracked, EXPLICIT_CONFIG_PATH), "utf8"),
      fs.readFileSync(path.join(untracked, EXPLICIT_CONFIG_PATH), "utf8"), "byte-identical carriers");

    const before = {
      bytes: fs.readFileSync(path.join(untracked, EXPLICIT_CONFIG_PATH), "utf8"),
      status: git(["status", "--porcelain", "--untracked-files=all"], untracked),
    };

    const err = await refused(
      verifySourceFreshness({ repoRoot: untracked, inventoryText: envelopeText(PLACEHOLDER) }),
      "an untracked config carrier", "E_CONFIG_CARRIER");
    assert.strictEqual(err.name, "SourceFreshnessError");
    assert.match(err.message, /NOT tracked/, "the refusal names the reason");
    assert.strictEqual(err.detail.tracked, false);

    // It is NOT read as absence: an absent config would have produced a registryDigest, and this
    // produced no digest at all.
    assert.notStrictEqual(err.code, "E_STALE", "it never reached the freshness comparison");

    assert.strictEqual(fs.readFileSync(path.join(untracked, EXPLICIT_CONFIG_PATH), "utf8"), before.bytes,
      "the config bytes are untouched");
    assert.strictEqual(git(["status", "--porcelain", "--untracked-files=all"], untracked), before.status,
      "and nothing was staged, created or removed");
  } finally {
    fs.rmSync(tracked, { recursive: true, force: true });
    fs.rmSync(untracked, { recursive: true, force: true });
  }
});

test("v1.11 §11b.4: only a genuinely absent path yields explicitConfig null", async () => {
  const cwd = repoIgnoringCtide(null);
  try {
    assert.strictEqual(fs.existsSync(path.join(cwd, EXPLICIT_CONFIG_PATH)), false);
    const text = await freshText(cwd);
    const result = await verifySourceFreshness({ repoRoot: cwd, inventoryText: text });
    assert.strictEqual(result.explicitConfigPresent, false, "absent means absent");

    const registry = loadTestAdapterRegistryRoot();
    assert.strictEqual((await currentDigests(cwd)).registryDigest,
      sha256Hex(canonicalJson({ registry, explicitConfig: null })), "and the preimage carries null");
    assert.strictEqual(fs.existsSync(path.join(cwd, EXPLICIT_CONFIG_PATH)), false, "no config was created");
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});

test("v1.11 §11b.10: an unsupported slot at the exact config path is never read as absence", async () => {
  const cwd = repoIgnoringCtide(null);
  try {
    fs.mkdirSync(path.join(cwd, EXPLICIT_CONFIG_PATH), { recursive: true });
    fs.writeFileSync(path.join(cwd, EXPLICIT_CONFIG_PATH, "inner.json"), `${CONFIG}\n`);

    const err = await refused(
      verifySourceFreshness({ repoRoot: cwd, inventoryText: envelopeText(PLACEHOLDER) }),
      "a directory occupying the config path", "E_UNSUPPORTED_ENTRY");
    assert.strictEqual(err.name, "HeadViewSnapshotError", "capture itself refuses it");
    assert.notStrictEqual(err.code, "E_STALE", "it is not quietly treated as 'no config'");
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
});

test("v1.11 §11b.4: raw duplicate members in the explicit config are fail-closed", async () => {
  const assignment = "{\"path\":\"test/a.test.mjs\",\"adapterId\":\"node-test\"}";
  for (const [label, body] of [
    // legal value LAST, so a reader that checks after JSON.parse sees configVersion 1 and passes
    ["root configVersion, illegal first and legal last",
      `{"configVersion":0,"configVersion":1,"assignments":[]}`],
    ["an assignment repeating path",
      `{"configVersion":1,"assignments":[${assignment.replace(/^\{/, "{\"path\":\"test/other.test.mjs\",")}]}`],
    ["an escaped-name alias for configVersion",
      `{"\\u0063onfigVersion":0,"configVersion":1,"assignments":[]}`],
    ["an escaped-name alias inside an assignment",
      `{"configVersion":1,"assignments":[${assignment.replace(/^\{/, "{\"\\u0070ath\":\"test/other.test.mjs\",")}]}`],
  ]) {
    // JSON.parse alone is perfectly happy with every one of these.
    assert.ok(JSON.parse(body), `${label}: JSON.parse accepts it`);
    // eslint-disable-next-line no-await-in-loop
    const cwd = repoIgnoringCtide(body, "tracked");
    try {
      const before = fs.readFileSync(path.join(cwd, EXPLICIT_CONFIG_PATH), "utf8");
      // eslint-disable-next-line no-await-in-loop
      await refused(verifySourceFreshness({ repoRoot: cwd, inventoryText: envelopeText(PLACEHOLDER) }),
        label, "E_CONFIG_DUPLICATE_MEMBER");
      assert.strictEqual(fs.readFileSync(path.join(cwd, EXPLICIT_CONFIG_PATH), "utf8"), before,
        `${label}: the carrier bytes are untouched`);
    } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
  }
});

test("v1.11 §11b.4: malformed config JSON still uses the shape error family", async () => {
  for (const [label, body] of [
    ["not JSON at all", "{ not json"],
    ["trailing content", "{\"configVersion\":1,\"assignments\":[]}extra"],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    const cwd = repoIgnoringCtide(body, "tracked");
    try {
      // eslint-disable-next-line no-await-in-loop
      await refused(verifySourceFreshness({ repoRoot: cwd, inventoryText: envelopeText(PLACEHOLDER) }),
        label, "E_CONFIG_SHAPE");
    } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
  }
});
