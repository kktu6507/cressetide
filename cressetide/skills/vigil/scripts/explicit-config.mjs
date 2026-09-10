// The explicit test-adapter config: one parser, and the two carrier rules §11b.4d splits apart.
//
// WHY IT IS SHARED. Approved v1.12 gives base and head DIFFERENT carrier-validity rules over the
// SAME document at the same path with the same schema. Two copies of the schema would be two places
// for it to drift, and the digest that covers this file would then describe whichever copy happened
// to run. So the schema lives here once and the two carrier rules sit beside it, visibly different.
//
// ERRORS TRAVEL BY CODE, NOT BY CLASS. Every throw carries the same `code` and the same message the
// calling component would have produced on its own, so a caller can re-wrap into its own error type
// without changing a single observable string. That is what keeps the accepted S3 component's
// behaviour byte-identical after the extraction.
import { TextDecoder } from "node:util";

import { JsonMemberScanError, assertUniqueJsonMembers } from "./json-unique-members.mjs";
import { canonicalJson, sha256Hex } from "./provenance-store.mjs";

export class ExplicitConfigError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = "ExplicitConfigError";
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

const fail = (code, message, detail) => new ExplicitConfigError(code, message, detail);

// §11b.4 and §11b.9c both name this path literally and unconditionally. The closed binding table in
// §11b.3 pins every adapter's discovery.explicitConfigPath to the same string, so there is no second
// spelling to reconcile.
export const EXPLICIT_CONFIG_PATH = ".ctide/test-adapters-config.json";

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
// contract uses. Checked lexically only -- this module resolves nothing against the filesystem.
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
export function parseExplicitConfig(text, registryRoot) {
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

function decodeConfig(bytes) {
  try { return UTF8.decode(bytes); } catch {
    throw fail("E_CONFIG_CARRIER", `${EXPLICIT_CONFIG_PATH} is not valid UTF-8`);
  }
}

/**
 * HEAD carrier rule -- approved v1.11, preserved word for word by §11b.4d.
 *
 * Absent from the snapshot means absent from the head view, which §11b.9c says is exactly `null` --
 * not `{}`, whose canonicalJson differs and would silently produce another digest.
 */
export function readHeadExplicitConfig(snapshot, registryRoot) {
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
  return parseExplicitConfig(decodeConfig(snapshot.read(EXPLICIT_CONFIG_PATH)), registryRoot);
}

/**
 * BASE carrier rule -- §11b.4d, and deliberately NOT the head rule.
 *
 * An exact tree has no index and no stage-0, so `tracked` has no meaning on this side. Membership of
 * the tree IS the committed carrier: everything in a tree is committed by construction. Reaching for
 * the head's index to decide a base question is exactly what §11b.4d forbids, and nothing here can
 * do it -- an AdapterContentView carries no `tracked` column to consult.
 */
export function readBaseExplicitConfig(view, registryRoot) {
  if (!view.has(EXPLICIT_CONFIG_PATH)) return null;
  const entry = view.entry(EXPLICIT_CONFIG_PATH);
  if (entry.type !== "blob") {
    throw fail("E_CONFIG_CARRIER",
      `${EXPLICIT_CONFIG_PATH} is a ${entry.type} in the base tree, not a blob; a config carrier that is not a `
      + "regular file is refused rather than followed",
      { path: EXPLICIT_CONFIG_PATH, side: "base", type: entry.type });
  }
  return parseExplicitConfig(decodeConfig(view.read(EXPLICIT_CONFIG_PATH)), registryRoot);
}

// §11b.9c's single formula, unchanged by v1.12: the registry half is the exact parsed
// test-adapters.json root, and the config half is the HEAD explicit config only. §11b.4d states it
// outright -- the base side is bound by baseTreeOid, so it never enters this preimage.
export function registryDigestOf(registryRoot, headExplicitConfig) {
  return sha256Hex(canonicalJson({ registry: registryRoot, explicitConfig: headExplicitConfig }));
}
