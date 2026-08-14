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
import { TextDecoder } from "node:util";

import { readTestAdapterRegistryRootFresh } from "./adapter-registry.mjs";
import { captureHeadViewSnapshot } from "./head-view-snapshot.mjs";
import { JsonMemberScanError, assertUniqueJsonMembers } from "./json-unique-members.mjs";
import { parseCanonicalInventoryV2 } from "./changed-test-inventory.mjs";
import { canonicalJson, sha256Hex } from "./provenance-store.mjs";

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
// spelling to reconcile.
export const EXPLICIT_CONFIG_PATH = ".ctide/test-adapters-config.json";

const REQUEST_KEYS = ["repoRoot", "inventoryText"];
const CONFIG_KEYS = ["configVersion", "assignments"];
const ASSIGNMENT_KEYS = ["path", "adapterId"];
const UTF8 = new TextDecoder("utf-8", { fatal: true });

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

// §11b.4 / §2: the assignment path is the same canonical repo-relative Git tree path the rest of the
// contract uses. Checked lexically only -- this component resolves nothing against the filesystem.
function requireCanonicalPath(value, what) {
  if (typeof value !== "string" || value === "") throw fail("E_CONFIG_FIELD", `${what} must be a non-empty string`);
  if (value.includes("\\")) throw fail("E_CONFIG_FIELD", `${what} contains a backslash; the separator is "/"`);
  if (value.startsWith("/")) throw fail("E_CONFIG_FIELD", `${what} is absolute; the path is repo-relative`);
  if (/^[A-Za-z]:/.test(value)) throw fail("E_CONFIG_FIELD", `${what} begins with a drive letter; the path is repo-relative`);
  if (value.includes("\u0000")) throw fail("E_CONFIG_FIELD", `${what} contains U+0000, which no Git tree path may carry`);
  for (const segment of value.split("/")) {
    if (segment === "") throw fail("E_CONFIG_FIELD", `${what} has an empty path segment`);
    if (segment === "." || segment === "..") throw fail("E_CONFIG_FIELD", `${what} contains a ${JSON.stringify(segment)} dot-segment`);
  }
  return value;
}

// §11b.4's exact shape. Nothing here repairs, reorders or de-duplicates: a config that is not already
// legal is refused as written, because a config the reader silently fixed is a config whose digest no
// longer describes the file the project committed.
function parseExplicitConfig(text, registryRoot) {
  // §11b.4 v1.11: duplicate member names go first, on the raw bytes, before JSON.parse can drop an
  // occurrence and before any shape, value or digest work. A config whose root says configVersion 0
  // and then configVersion 1 is refused, not read as 1.
  try {
    assertUniqueJsonMembers(text, EXPLICIT_CONFIG_PATH);
  } catch (e) {
    if (e instanceof JsonMemberScanError && e.kind === "duplicate") {
      throw fail("E_CONFIG_DUPLICATE_MEMBER", e.message, e.detail);
    }
    if (e instanceof JsonMemberScanError) throw fail("E_CONFIG_SHAPE", e.message, e.detail);
    throw e;
  }

  let raw;
  try { raw = JSON.parse(text); } catch (e) {
    throw fail("E_CONFIG_SHAPE", `${EXPLICIT_CONFIG_PATH} is not valid JSON: ${e.message}`);
  }
  exactKeys(raw, CONFIG_KEYS, EXPLICIT_CONFIG_PATH, "E_CONFIG_SHAPE");

  if (typeof raw.configVersion !== "number" || !Number.isInteger(raw.configVersion) || raw.configVersion !== 1) {
    throw fail("E_CONFIG_FIELD", `${EXPLICIT_CONFIG_PATH} configVersion must be the integer 1; got ${JSON.stringify(raw.configVersion)}`);
  }
  if (!Array.isArray(raw.assignments)) {
    throw fail("E_CONFIG_SHAPE", `${EXPLICIT_CONFIG_PATH} assignments must be an array`);
  }

  const known = new Set(registryRoot.adapters.map((a) => a.adapterId));
  const seen = new Set();
  raw.assignments.forEach((assignment, index) => {
    const where = `${EXPLICIT_CONFIG_PATH} assignments[${index}]`;
    exactKeys(assignment, ASSIGNMENT_KEYS, where, "E_CONFIG_SHAPE");
    requireCanonicalPath(assignment.path, `${where}.path`);
    if (seen.has(assignment.path)) {
      throw fail("E_CONFIG_FIELD", `${where}.path repeats ${JSON.stringify(assignment.path)}; assignment paths are unique`);
    }
    seen.add(assignment.path);
    if (typeof assignment.adapterId !== "string" || !known.has(assignment.adapterId)) {
      throw fail("E_CONFIG_FIELD",
        `${where}.adapterId is ${JSON.stringify(assignment.adapterId)}, which no adapter in the shipped registry declares`);
    }
  });
  return raw;
}

// The head-view config object, read from S3 and from nowhere else. Absent from the snapshot means
// absent from the head view, which §11b.9c says is exactly `null` -- not `{}`, whose canonicalJson
// differs and would silently produce another digest.
function explicitConfigFrom(snapshot, registryRoot) {
  // Absent from the snapshot is the ONLY case that yields null. Because §11b.10 step 2 puts the
  // exact config path into the snapshot whenever it exists in the worktree -- even when a tracked
  // .gitignore covers it -- "not in the snapshot" now means "not there", nothing else.
  if (!snapshot.has(EXPLICIT_CONFIG_PATH)) return null;
  const entry = snapshot.entry(EXPLICIT_CONFIG_PATH);
  // §11b.4: only a TRACKED carrier is a legal explicit config. An untracked file at the same path
  // with byte-identical contents is refused -- not accepted, not read as absent, not continued with
  // null -- and nothing here stages, creates, deletes or repairs it. The decision comes from the
  // snapshot's own metadata; there is no second Git or filesystem lookup after the capture.
  if (entry.tracked !== true) {
    throw fail("E_CONFIG_CARRIER",
      `${EXPLICIT_CONFIG_PATH} is present in the head view but is NOT tracked; only a tracked committed `
      + "config is a legal explicit-config carrier. It is refused rather than treated as absent, and this "
      + "component neither stages nor modifies it",
      { path: EXPLICIT_CONFIG_PATH, tracked: false });
  }
  if (entry.type !== "blob") {
    throw fail("E_CONFIG_CARRIER",
      `${EXPLICIT_CONFIG_PATH} is a ${entry.type} in the head view, not a blob; a config carrier that is not a `
      + "regular file is refused rather than followed");
  }
  let text;
  try { text = UTF8.decode(snapshot.read(EXPLICIT_CONFIG_PATH)); } catch {
    throw fail("E_CONFIG_CARRIER", `${EXPLICIT_CONFIG_PATH} is not valid UTF-8`);
  }
  return parseExplicitConfig(text, registryRoot);
}

// §11b.9c's single formula. The registry half is the exact parsed test-adapters.json root, including
// registryVersion, taken from the same read the loader validated.
function registryDigestOf(registryRoot, explicitConfig) {
  return sha256Hex(canonicalJson({ registry: registryRoot, explicitConfig }));
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
