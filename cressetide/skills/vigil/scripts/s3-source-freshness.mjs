// S3 source freshness: the FIRST step of the §11b.9c consumer protocol, and only that step.
//
// A consumer must not accept an inventory whose world has moved since it was produced. §11b.9d
// splits that question in two, and this component answers exactly one half:
//
//   source freshness  -- the head source/config/oracle universe plus the registry. Recomputed HERE
//                        from the current repository and required to equal the envelope's values.
//   store freshness   -- the provenance store at production time. NOT recomputed here and NOT
//                        compared here: Step 5 legitimately rewrites the store, so comparing the
//                        current store against inputProvenanceStoreDigest would mark every normal
//                        batch stale (§11b.9c step 3). This component never reads the store, and
//                        treats inputProvenanceStoreDigest purely as an envelope carrier whose
//                        preimage it does not interpret.
//
// WHAT THIS IS NOT. It is not Step 6. It does not read a committed batchSnapshot.inventorySnapshot,
// does not recompute a batchDigest, and does not check any record-level derived equality -- those
// are §11b.9c step 2 and are not implemented anywhere. It is not a producer, a base/head matcher or
// a governance reverse closure. It is not wired into parseInventory, loadInventory or contract-check:
// a v2 envelope, empty or populated, is still refused at the product entry point.
//
// The whole surface is one function taking a repository root and inventory bytes. There is no way to
// hand it a snapshot, a registry root or path, a config object or path, a filesystem, a Git
// executable, an environment or a hash function -- the request key set is exact, so every one of
// those is rejected by name.
import { readTestAdapterRegistryRootFresh } from "./adapter-registry.mjs";
import { captureHeadViewSnapshot } from "./head-view-snapshot.mjs";
import {
  EXPLICIT_CONFIG_PATH as SHARED_EXPLICIT_CONFIG_PATH, ExplicitConfigError,
  readHeadExplicitConfig, registryDigestOf,
} from "./explicit-config.mjs";
import { parseCanonicalInventoryV2 } from "./changed-test-inventory.mjs";

export class SourceFreshnessError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = "SourceFreshnessError";
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

const fail = (code, message, detail) => new SourceFreshnessError(code, message, detail);

// §11b.4 and §11b.9c both name this path literally and unconditionally. The closed binding table in
// §11b.3 pins every adapter's discovery.explicitConfigPath to the same string, so there is no second
// spelling to reconcile. It is re-exported from the shared config module rather than written out a
// second time: two literals are two things to drift.
export const EXPLICIT_CONFIG_PATH = SHARED_EXPLICIT_CONFIG_PATH;

const REQUEST_KEYS = ["repoRoot", "inventoryText"];

function exactKeys(value, expected, what, code) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw fail(code, `${what} must be a JSON object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((k, i) => k !== wanted[i])) {
    const missing = wanted.filter((k) => !actual.includes(k));
    const undeclared = actual.filter((k) => !wanted.includes(k));
    throw fail(code,
      `${what} must declare exactly ${JSON.stringify(wanted)}`
      + `${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`
      + `${undeclared.length ? ` (undeclared: ${undeclared.join(", ")})` : ""}`);
  }
  return value;
}

// The head-view config, read through the shared §11b.4d HEAD carrier rule. The rule itself is
// unchanged -- absent yields exactly `null`, an untracked carrier is refused rather than treated as
// absent, and a non-blob carrier is refused rather than followed -- it simply lives beside the BASE
// rule now, in one module, because v1.12 gives the two sides different carrier semantics over the
// same schema, and one shared schema is what stops them drifting apart.
//
// The shared module raises the same codes, the same messages and the same details this component
// raised before the extraction; they are re-wrapped into SourceFreshnessError here, so nothing a
// caller can observe about this component has changed. registryDigestOf moved with it and is
// imported rather than restated: §11b.9c's formula has exactly one definition.
function explicitConfigFrom(snapshot, registryRoot) {
  try {
    return readHeadExplicitConfig(snapshot, registryRoot);
  } catch (error) {
    if (error instanceof ExplicitConfigError) throw fail(error.code, error.message, error.detail);
    throw error;
  }
}

/**
 * Recompute the two SOURCE digests from the current repository and require the envelope to agree.
 *
 * @param {{ repoRoot: string, inventoryText: string }} request exact key set; nothing else is accepted.
 * @returns {Promise<Readonly<object>>} frozen evidence that the two source digests matched.
 */
export async function verifySourceFreshness(request) {
  if (arguments.length !== 1) {
    throw fail("E_API_ARGUMENTS",
      "verifySourceFreshness takes exactly one argument; a head-view snapshot, a registry root or path, an "
      + "explicit config or its path, a filesystem, a Git executable, an environment or a hash function cannot "
      + "be supplied");
  }
  exactKeys(request, REQUEST_KEYS, "the verifySourceFreshness request", "E_API_ARGUMENTS");
  if (typeof request.repoRoot !== "string" || request.repoRoot === "") {
    throw fail("E_API_ARGUMENTS", "repoRoot must be a non-empty string");
  }
  if (typeof request.inventoryText !== "string") {
    throw fail("E_API_ARGUMENTS", "inventoryText must be a string");
  }

  // The envelope first, so a malformed v2 document reports its OWN canonical error rather than
  // being reported as stale. An InventoryError propagates unchanged.
  const envelope = parseCanonicalInventoryV2(request.inventoryText);

  // S3: one snapshot of the current repository. §11b.9c calls for a third snapshot, and §11b.10's
  // S1/S2 stability protocol belongs to the producer -- capturing twice here would invent an S3/S4
  // protocol no approved text defines.
  const snapshot = await captureHeadViewSnapshot({ repoRoot: request.repoRoot });

  // §11b.9c v1.11: the CURRENT shipped registry, re-read once for this invocation. A cached root
  // would let a second verification report fresh against a registry that has already changed, so
  // the ordinary cached accessors -- which keep their own cache, untouched by this call -- are not
  // used here. Validation runs inside that same read, before any digest is taken from it.
  const registryRoot = readTestAdapterRegistryRootFresh();
  const explicitConfig = explicitConfigFrom(snapshot, registryRoot);

  const headViewDigest = snapshot.headViewDigest;
  const registryDigest = registryDigestOf(registryRoot, explicitConfig);

  // BOTH comparisons, then one refusal carrying both. Stopping at the first mismatch would hide the
  // second, and "the head view moved" plus "the registry moved" are two different facts about the
  // world -- a consumer that only ever hears about the first cannot tell them apart.
  const headMatches = envelope.headViewDigest === headViewDigest;
  const registryMatches = envelope.registryDigest === registryDigest;
  if (!headMatches || !registryMatches) {
    const detail = Object.freeze({
      headViewDigest: Object.freeze({ declared: envelope.headViewDigest, actual: headViewDigest, matches: headMatches }),
      registryDigest: Object.freeze({ declared: envelope.registryDigest, actual: registryDigest, matches: registryMatches }),
    });
    const stale = [
      headMatches ? null : "headViewDigest",
      registryMatches ? null : "registryDigest",
    ].filter(Boolean);
    throw fail("E_STALE",
      `source freshness failed: ${stale.join(" and ")} ${stale.length === 1 ? "does" : "do"} not match the current `
      + `repository. headViewDigest declared ${JSON.stringify(envelope.headViewDigest)} vs S3 `
      + `${JSON.stringify(headViewDigest)} (${headMatches ? "match" : "MISMATCH"}); registryDigest declared `
      + `${JSON.stringify(envelope.registryDigest)} vs current ${JSON.stringify(registryDigest)} `
      + `(${registryMatches ? "match" : "MISMATCH"}). The provenance store was neither read nor compared`,
      detail);
  }

  // Evidence about the two source digests and nothing more. The entries are deliberately NOT handed
  // back: this component decides freshness, not whether a populated inventory may be acted on, and
  // returning them would read like an acceptance it has no authority to grant.
  return Object.freeze({
    sourceFresh: true,
    headViewDigest,
    registryDigest,
    entryCount: envelope.entries.length,
    explicitConfigPresent: explicitConfig !== null,
  });
}
