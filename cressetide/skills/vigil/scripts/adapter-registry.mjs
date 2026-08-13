// Loader and validator for the formal test adapter registry.
//
// FILE NAME: this module is deliberately NOT called test-adapter-registry.mjs. Node's test runner
// auto-discovers `test-*.mjs` anywhere in the tree, so that name made a production module run as a
// test file on every `npm test`. The registry it reads keeps its spec-mandated name; only the
// loader is renamed.
//
// SCOPE: this reads DATA and ALGORITHM IDs, and resolves an implementationId to a component through
// a CLOSED table of shipped objects. The set of components is closed at build time: an
// implementationId that is not a key of that table is a fail-closed condition, never a module path
// to load, and no caller can nominate one. This file still performs no declaration discovery, no
// AST work and no adapter selection -- validating a discovery declaration's exact data is not the
// discovery algorithm, and choosing which files an adapter covers is not implemented anywhere.
// Nothing here should be read as claiming a producer, a populated inventory, AC136, AC137, AC138 or
// Phase 2 is ready.
//
// AUTHORITY: two files, each authoritative for its own half.
//   test-adapters.json beside this module  -> the semantic algorithm tokens and the registry data
//   the shipped vendor manifest            -> the exact dependency identity
// The registry declares an implementationIdentity, but it does not get to assert one: every field
// is compared against the identity the vendor wrapper derives from the shipped, hash-verified
// manifest. The ADR and the approved specs are human governance records and are never parsed here,
// and no parser version, package version, hash, member target or resource limit is restated below.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { nodeTestV1Component } from "./node-test-adapter.mjs";
import { loadVendorCapability } from "./parser-ignore-wrapper.mjs";

export class TestAdapterRegistryError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = "TestAdapterRegistryError";
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

const fail = (code, message, detail) => new TestAdapterRegistryError(code, message, detail);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = path.join(HERE, "test-adapters.json");

// Approved v1.6 §11b.3: one ID token grammar shared by every ID in the registry.
const ID_TOKEN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

// Closed enums and the single legal binding row. These are semantic algorithm tokens the approved
// model fixes, not values borrowed from the manifest: the manifest owns dependency identity, and
// nothing from it is duplicated here.
const IMPLEMENTATIONS = {
  "node-test-v1": {
    language: "javascript",
    framework: "node:test",
    testDeclarationPatternIds: ["node-test-call"],
    containerPatternIds: ["node-test-describe"],
    attachmentRule: "leading-line-comments",
    stableIdRule: "line-comment-tid-v1",
    discovery: {
      explicitConfigPath: ".ctide/test-adapters-config.json",
      manifestDependencies: [],
      importSpecifiers: ["node:test"],
    },
  },
};

// 11b.2: the registry carries data, the capability lives in shipped code. This is that mapping, and
// it is a table of already-imported objects -- there is no name-to-path step anywhere in it, so an
// unknown implementationId cannot become a module load however it is spelled.
const COMPONENTS = {
  "node-test-v1": nodeTestV1Component,
};

// The two closed tables describe the same closed set from two sides, so they must not drift: a
// declared implementation with no component, or a component with no declaration, is a build error
// rather than something to discover at call time.
{
  const declared = Object.keys(IMPLEMENTATIONS).sort();
  const shipped = Object.keys(COMPONENTS).sort();
  if (declared.length !== shipped.length || declared.some((k, i) => k !== shipped[i])) {
    throw fail("E_REGISTRY_UNSUPPORTED", `the implementation table ${JSON.stringify(declared)} and the component table ${JSON.stringify(shipped)} disagree`);
  }
  for (const [id, component] of Object.entries(COMPONENTS)) {
    if (component === null || typeof component !== "object" || component.implementationId !== id) {
      throw fail("E_REGISTRY_UNSUPPORTED", `the component registered for ${JSON.stringify(id)} does not declare that implementationId`);
    }
  }
}

const ROOT_KEYS = ["registryVersion", "adapters"];
const ADAPTER_KEYS = ["adapterId", "language", "framework", "implementationId", "implementationIdentity",
  "testDeclarationPatternIds", "containerPatternIds", "attachmentRule", "stableIdRule", "discovery"];
const IDENTITY_KEYS = ["implementationId", "parserId", "parserVersion"];
const DISCOVERY_KEYS = ["explicitConfigPath", "manifestDependencies", "importSpecifiers"];

const REGISTRY_VERSION = 1;

// --- shape helpers ----------------------------------------------------------------------------------

function exactKeys(value, expected, what) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw fail("E_REGISTRY_SHAPE", `${what} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((k, i) => k !== wanted[i])) {
    throw fail("E_REGISTRY_SHAPE", `${what} must declare exactly ${JSON.stringify(wanted)}; got ${JSON.stringify(actual)}`);
  }
  return value;
}

function requireString(value, what) {
  if (typeof value !== "string" || value === "") throw fail("E_REGISTRY_SHAPE", `${what} must be a non-empty string`);
  return value;
}

function requireIdToken(value, what) {
  requireString(value, what);
  if (!ID_TOKEN.test(value)) throw fail("E_REGISTRY_SHAPE", `${what} is ${JSON.stringify(value)}, which is not a legal ID token`);
  return value;
}

// Canonical form is de-duplicated and sorted by Unicode code point. A registry that is not already
// in that form is rejected as written: sorting or de-duplicating here would accept a file that says
// something other than what it will be read as.
function requireCanonicalArray(value, what) {
  if (!Array.isArray(value)) throw fail("E_REGISTRY_SHAPE", `${what} must be an array`);
  for (let i = 1; i < value.length; i += 1) {
    const previous = value[i - 1];
    const current = value[i];
    if (previous === current) throw fail("E_REGISTRY_SHAPE", `${what} repeats ${JSON.stringify(current)}; canonical form is de-duplicated`);
    if (!(previous < current)) throw fail("E_REGISTRY_SHAPE", `${what} is not in ascending code-point order at index ${i}`);
  }
  return value;
}

function requireExactArray(actual, expected, code, what) {
  const same = Array.isArray(actual) && actual.length === expected.length && actual.every((v, i) => v === expected[i]);
  if (!same) throw fail(code, `${what} is ${JSON.stringify(actual)}; this implementation requires exactly ${JSON.stringify(expected)}`);
}

function requireExactly(actual, expected, code, what) {
  if (actual !== expected) throw fail(code, `${what} is ${JSON.stringify(actual)}; this implementation requires ${JSON.stringify(expected)}`);
}

// Every value the caller can reach is copied out of the parsed file and frozen all the way down, so
// a caller that rewrites a token changes nothing about the next read.
function deepFreeze(value) {
  if (value === null || typeof value !== "object") return value;
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

// --- validation -------------------------------------------------------------------------------------

function validateAdapter(raw, index, vendorParserIdentity) {
  const where = `adapters[${index}]`;
  exactKeys(raw, ADAPTER_KEYS, where);

  const adapterId = requireIdToken(raw.adapterId, `${where}.adapterId`);
  requireString(raw.language, `${where}.language`);
  requireString(raw.framework, `${where}.framework`);
  const implementationId = requireIdToken(raw.implementationId, `${where}.implementationId`);

  // Closed set, resolved by lookup. An unknown implementationId is a fail-closed condition, never
  // an opportunity to load a module by name.
  const binding = Object.prototype.hasOwnProperty.call(IMPLEMENTATIONS, implementationId) ? IMPLEMENTATIONS[implementationId] : null;
  if (binding === null) {
    throw fail("E_REGISTRY_UNSUPPORTED", `${where}.implementationId ${JSON.stringify(implementationId)} is not an implementation this build knows; no module is looked up by that name`);
  }

  // The single legal binding row: each column is "exactly", not "a subset of".
  requireExactly(raw.language, binding.language, "E_REGISTRY_UNSUPPORTED", `${where}.language for ${implementationId}`);
  requireExactly(raw.framework, binding.framework, "E_REGISTRY_UNSUPPORTED", `${where}.framework for ${implementationId}`);
  requireExactly(raw.attachmentRule, binding.attachmentRule, "E_REGISTRY_UNSUPPORTED", `${where}.attachmentRule for ${implementationId}`);
  requireExactly(raw.stableIdRule, binding.stableIdRule, "E_REGISTRY_UNSUPPORTED", `${where}.stableIdRule for ${implementationId}`);

  for (const [key, expected] of [["testDeclarationPatternIds", binding.testDeclarationPatternIds], ["containerPatternIds", binding.containerPatternIds]]) {
    const value = raw[key];
    if (!Array.isArray(value) || value.length === 0) throw fail("E_REGISTRY_SHAPE", `${where}.${key} must be a non-empty array`);
    value.forEach((token, i) => requireIdToken(token, `${where}.${key}[${i}]`));
    requireCanonicalArray(value, `${where}.${key}`);
    requireExactArray(value, expected, "E_REGISTRY_UNSUPPORTED", `${where}.${key} for ${implementationId}`);
  }

  // The registry declares an identity; the shipped manifest is what makes it true.
  const identity = exactKeys(raw.implementationIdentity, IDENTITY_KEYS, `${where}.implementationIdentity`);
  // §11b.3 gives every ID in the registry one grammar, and two of these three fields are IDs. The
  // version is not: it carries a package version string, which that grammar would reject.
  requireIdToken(identity.implementationId, `${where}.implementationIdentity.implementationId`);
  requireIdToken(identity.parserId, `${where}.implementationIdentity.parserId`);
  requireString(identity.parserVersion, `${where}.implementationIdentity.parserVersion`);
  if (identity.implementationId !== implementationId) {
    throw fail("E_REGISTRY_SHAPE", `${where}.implementationIdentity.implementationId is ${JSON.stringify(identity.implementationId)} but the adapter declares ${JSON.stringify(implementationId)}`);
  }
  for (const key of IDENTITY_KEYS) {
    if (identity[key] !== vendorParserIdentity[key]) {
      throw fail("E_REGISTRY_IDENTITY", `${where}.implementationIdentity.${key} is ${JSON.stringify(identity[key])}; the shipped vendor manifest authorizes ${JSON.stringify(vendorParserIdentity[key])}`);
    }
  }

  const discovery = exactKeys(raw.discovery, DISCOVERY_KEYS, `${where}.discovery`);
  requireExactly(discovery.explicitConfigPath, binding.discovery.explicitConfigPath, "E_REGISTRY_UNSUPPORTED", `${where}.discovery.explicitConfigPath for ${implementationId}`);
  for (const key of ["manifestDependencies", "importSpecifiers"]) {
    const value = discovery[key];
    if (!Array.isArray(value)) throw fail("E_REGISTRY_SHAPE", `${where}.discovery.${key} must be an array`);
    value.forEach((entry, i) => requireString(entry, `${where}.discovery.${key}[${i}]`));
    requireCanonicalArray(value, `${where}.discovery.${key}`);
    requireExactArray(value, binding.discovery[key], "E_REGISTRY_UNSUPPORTED", `${where}.discovery.${key} for ${implementationId}`);
  }

  return {
    adapterId,
    language: raw.language,
    framework: raw.framework,
    implementationId,
    implementationIdentity: { implementationId: identity.implementationId, parserId: identity.parserId, parserVersion: identity.parserVersion },
    testDeclarationPatternIds: [...raw.testDeclarationPatternIds],
    containerPatternIds: [...raw.containerPatternIds],
    attachmentRule: raw.attachmentRule,
    stableIdRule: raw.stableIdRule,
    discovery: {
      explicitConfigPath: discovery.explicitConfigPath,
      manifestDependencies: [...discovery.manifestDependencies],
      importSpecifiers: [...discovery.importSpecifiers],
    },
  };
}

function buildRegistry() {
  let raw;
  try { raw = fs.readFileSync(REGISTRY_PATH, "utf8"); } catch {
    throw fail("E_REGISTRY_UNREADABLE", `the shipped adapter registry is unreadable: ${REGISTRY_PATH}`);
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) {
    throw fail("E_REGISTRY_SHAPE", `the shipped adapter registry is not valid JSON: ${e.message}`);
  }
  exactKeys(parsed, ROOT_KEYS, "registry root");
  requireExactly(parsed.registryVersion, REGISTRY_VERSION, "E_REGISTRY_UNSUPPORTED", "registryVersion");
  if (!Array.isArray(parsed.adapters) || parsed.adapters.length === 0) {
    throw fail("E_REGISTRY_SHAPE", "adapters must be a non-empty array");
  }

  // The vendor wrapper has already verified the shipped manifest and its members before it will
  // hand over an identity, so a broken dependency packet stops the registry too.
  const vendorParserIdentity = loadVendorCapability().identities.parser;

  const adapters = parsed.adapters.map((adapter, index) => validateAdapter(adapter, index, vendorParserIdentity));

  const byAdapterId = new Set();
  const byImplementationAndFramework = new Set();
  for (const adapter of adapters) {
    if (byAdapterId.has(adapter.adapterId)) throw fail("E_REGISTRY_SHAPE", `duplicate adapterId ${JSON.stringify(adapter.adapterId)}`);
    byAdapterId.add(adapter.adapterId);
    // Encoded as a JSON tuple rather than joined with a delimiter: with no separator there is no
    // separator to smuggle, so two different pairs can never collide into one key.
    const pair = JSON.stringify([adapter.implementationId, adapter.framework]);
    if (byImplementationAndFramework.has(pair)) {
      throw fail("E_REGISTRY_SHAPE", `duplicate (implementationId, framework) pair (${adapter.implementationId}, ${adapter.framework})`);
    }
    byImplementationAndFramework.add(pair);
  }

  // Two views of ONE read. The descriptor is the validated, reconstructed shape callers have always
  // had. `root` is the exact parsed test-adapters.json root -- exactly {registryVersion, adapters},
  // nothing added -- because §11b.9c's registryDigest preimage is the whole file root and the
  // descriptor is not it: it carries a loader-only registryPath and its adapters are rebuilt objects
  // that are only incidentally equal to the file. Both come from the single readFileSync above, so a
  // digest taken from `root` covers precisely the bytes this function validated. Re-reading the file
  // somewhere else to hash it would open exactly the TOCTOU window that separation invites.
  return {
    descriptor: deepFreeze({ registryPath: REGISTRY_PATH, registryVersion: parsed.registryVersion, adapters }),
    root: deepFreeze(parsed),
  };
}

let cached = null;

// No parameter, and no second one either: a caller cannot name another registry file, hand in a
// registry object, point at a different manifest, supply a vendor capability or nominate a module
// to load. The shipped registry beside this module is the only thing this function will ever read.
export function loadTestAdapterRegistry() {
  if (arguments.length > 0) {
    throw fail("E_API_ARGUMENTS", "loadTestAdapterRegistry takes no arguments; supplying a registry path, a registry object, a manifest, a vendor capability or a module path is not supported");
  }
  // The cache is only written once every check has passed, so a rejected registry leaves the next
  // call to try again from the file rather than inheriting a half-validated result.
  if (cached === null) cached = buildRegistry();
  return cached.descriptor;
}

// The exact parsed registry root -- {registryVersion, adapters} and nothing else -- from the SAME
// validated read the descriptor came from. It exists for §11b.9c's registryDigest preimage, which is
// the whole file root; the descriptor cannot stand in for it. Validation is unconditional and comes
// first: there is no path here that hands back a root the §11b.3 schema rejected, so a digest is
// never taken over a registry that is not a registry. Same no-argument surface as the loader.
export function loadTestAdapterRegistryRoot() {
  if (arguments.length > 0) {
    throw fail("E_API_ARGUMENTS", "loadTestAdapterRegistryRoot takes no arguments; supplying a registry path, a registry object, a manifest, a vendor capability or a module path is not supported");
  }
  if (cached === null) cached = buildRegistry();
  return cached.root;
}

// Resolution by lookup in a closed table, never by turning a name into a path. The argument is an
// implementationId and nothing else: a module specifier, a URL, a file path or a component object
// supplied by a caller is rejected the same way an unknown ID is.
export function resolveAdapterComponent(implementationId) {
  if (arguments.length !== 1) {
    throw fail("E_API_ARGUMENTS", "resolveAdapterComponent takes exactly one argument; a module path, a component object or a parser cannot be supplied");
  }
  if (typeof implementationId !== "string" || implementationId === "") {
    throw fail("E_REGISTRY_UNSUPPORTED", "resolveAdapterComponent expects an implementationId string");
  }
  if (!Object.prototype.hasOwnProperty.call(COMPONENTS, implementationId)) {
    throw fail("E_REGISTRY_UNSUPPORTED", `${JSON.stringify(implementationId)} is not an implementation this build ships; no module is looked up by that name`);
  }
  return COMPONENTS[implementationId];
}
