// ctide changed-test-inventory: TWO layers, deliberately not one.
//
//   parseCanonicalInventoryV2(text)  -- the ISOLATED canonical reader for ChangedTestInventoryV2,
//                                       shared approved v1.14 + test-provenance approved v1.14.
//                                       It validates a POPULATED entries[] completely and hands the
//                                       validated value back.
//   parseInventory(text)             -- the PRODUCT entry point. It dispatches on the envelope
//                                       version, keeps the legacy v1 clean slice working, and
//                                       refuses EVERY v2 envelope -- empty or populated -- because
//                                       reading one correctly is not the same as being allowed to
//                                       act on one.
//
// The second layer is the point. A canonical reader proves a document says what it says; it proves
// nothing about the producer that wrote it, the matcher that paired base against head, the
// governance reverse closure, or the S3 recomputation a consumer owes.
//
// Two of those now exist as accepted components and still change nothing here: the base/head
// one-to-one matcher and the S3 source-freshness recomputation are implemented and accepted, but
// NEITHER is product-wired, and neither is a producer. The populated inventory producer and the
// governance reverse closure remain unimplemented, so no v2 document on this path has an author whose
// work can be checked -- and the product path goes on refusing v2 under the same stable marker it
// always used. An empty v2 envelope gets no exemption: it still asserts a registryDigest, a
// headViewDigest and an inputProvenanceStoreDigest that only a wired S3 consumer could check, so
// letting one through would let "the universe was empty" pass unproven -- which is exactly the bypass
// TP AC117 names.
//
// WHAT THE ISOLATED READER DELIBERATELY DOES NOT DO (SM v1.14 "isolated canonical reader", TP AC156):
//   - it does not look up a Git object, so passing the baseTreeOid grammar proves neither that the
//     object exists nor that its own type is a tree;
//   - it does not read the registry, so implementationIdentity is checked for shape only, never for
//     field-by-field agreement with the adapter that declared it -- and `framework` is likewise only
//     the string the adapter reported (TP section 6: "framework: adapter 回報"), not a value bound to
//     a registry enum this component cannot see;
//   - it does not recompute registryDigest, headViewDigest or inputProvenanceStoreDigest, so it
//     proves nothing about any preimage or about freshness;
//   - it does not hold a provenance-store pre-state, so `REQ-x@DP-y` is accepted LEXICALLY only --
//     whether that REQ is genuinely exception-backed stays with the pipeline (TP section 2, AC35);
//   - it reads no file, spawns no process, consults no environment variable and opens no socket.
//
// Library only, by design: no CLI entry point, so this file is not another copy of the
// isInvokedDirectly() cluster the structure validator byte-compares.
import fs from "node:fs";
import { canonicalJson, compareCodePoint, sha256Hex } from "./provenance-store.mjs";

// Per-run derived scratch (docs/runtime-contract.md): rebuildable from Git base/head, never a
// semantic truth source, read-only for the checker, not committed.
export const INVENTORY_PATH = ".ctide/output/changed-test-inventory.json";

// The legacy v1 root envelope, exact. `storePath` is deliberately ABSENT: the canonical store path
// is a property of TaskState.baseProvenance, and a copy here would be a second authority for it.
export const INVENTORY_KEYS = ["baseTreeOid", "entries", "inventoryDigest"];

// SM v1.14: the v2 root, exactly seven fields. Listed in the order the shared model lists them; the
// order of the members in the FILE is not a rejection reason, only the key set is.
export const V2_INVENTORY_KEYS = [
  "inventoryVersion", "baseTreeOid", "registryDigest", "headViewDigest",
  "inputProvenanceStoreDigest", "entries", "inventoryDigest",
];

// The stable marker callers and tests can match on, so "this build does not support that yet" is
// never confused with "that inventory is malformed".
export const UNSUPPORTED_POPULATED = "unsupported-populated-inventory";

export class InventoryError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "InventoryError";
    if (code !== undefined) this.code = code;
  }
}

function refuse(message) {
  throw new InventoryError(message);
}

// Every canonical-reader refusal carries a stable code, so a caller can tell an unreadable document
// from a readable one this build will not act on without matching on prose.
function reject(code, message) {
  throw new InventoryError(`changed-test-inventory v2: ${message}`, code);
}

function sameKeys(o, expected) {
  return canonicalJson(Object.keys(o).sort()) === canonicalJson([...expected].sort());
}

// A 40-hex Git object name. Abbreviated oids are refused: the witness is compared for equality, so
// two spellings of one tree would make that comparison depend on how it was written down.
function isFullOid(v) {
  return typeof v === "string" && /^[0-9a-f]{40}$/.test(v);
}

// §2's single formula for the LEGACY v1 envelope. Recomputed, never trusted: the digest is the
// artifact that proves two readers saw the same inventory, so accepting whatever string the file
// carries would prove nothing. v2 has its own formula and its own function; this one is untouched.
export function computeInventoryDigest({ baseTreeOid, entries }) {
  return sha256Hex(canonicalJson({ baseTreeOid, entries }));
}

// SM v1.14's single v2 formula, over the six preimage fields. `inventoryDigest` is NOT one of them:
// it is the output.
export function computeInventoryV2Digest({
  inventoryVersion, baseTreeOid, registryDigest, headViewDigest, inputProvenanceStoreDigest, entries,
}) {
  return sha256Hex(canonicalJson({
    inventoryVersion, baseTreeOid, registryDigest, headViewDigest, inputProvenanceStoreDigest, entries,
  }));
}

// --- canonical grammars ---------------------------------------------------------------------------
// Each one is quoted from the approved spec it belongs to, and none of them is loosened here.

const V2_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;          // SM v1.14 carrier lexical grammar
const V2_DIGEST = /^[0-9a-f]{64}$/;                        // SM v1.14, all four digest carriers
const ID_TOKEN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;          // TP 11b.3, shared by every ID
const TID_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;        // TP 11b.7 stable-ID grammar
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;              // intent-scan approved v1.10 section 8
const CLAUSE_REF = /^(REQ|DEC|ASSUM)-([\s\S]*)$/;          // TP section 2 canonical tag grammar
const DP_REF = /^DP-([\s\S]*)$/;

const STATUSES = ["added", "modified", "deleted", "retagged", "moved", "governance-affected"];
const REASONS = ["content-change", "governance-affected"];
const COMMON_SEVEN = ["testRef", "status", "reason", "tagBefore", "tagAfter", "framework", "implementationIdentity"];
const BOTH_DIGESTS = ["modified", "retagged", "moved", "governance-affected"];
const TEST_REF_KEYS = ["path", "adapterId", "structuralId"];
const IDENTITY_KEYS = ["implementationId", "parserId", "parserVersion"];

// --- the duplicate-member pre-parser --------------------------------------------------------------
// SM v1.14 requires the duplicate check to happen while EVERY member occurrence is still
// observable. JSON.parse is last-write-wins, so by the time it returns, the evidence is gone. This
// is a complete JSON reader that keeps the structure and the DECODED member names and throws them
// away only after the check; the values themselves still come from JSON.parse below.
//
// It decodes escapes before comparing, so "path" and "\u0070ath" are the same name, and it applies
// the rule to every object in the document -- including objects that will be refused a moment later
// for an undeclared shape, because "it was going to fail anyway" is not the same as "it was checked".

const SCALAR = { kind: "scalar" };
const WHITESPACE = new Set([0x20, 0x09, 0x0a, 0x0d]);

function scanDocument(text) {
  let i = 0;

  const bad = (what, at = i) => reject("E_JSON", `${what} at offset ${at}`);

  const skipWhitespace = () => {
    while (i < text.length && WHITESPACE.has(text.charCodeAt(i))) i += 1;
  };

  const word = (literal) => {
    if (text.slice(i, i + literal.length) !== literal) bad(`expected ${literal}`);
    i += literal.length;
  };

  const digit = () => text[i] >= "0" && text[i] <= "9";

  function scanString() {
    if (text[i] !== "\"") bad("expected a string");
    const opened = i;
    i += 1;
    let out = "";
    for (;;) {
      if (i >= text.length) bad("unterminated string", opened);
      const c = text[i];
      if (c === "\"") { i += 1; return out; }
      if (c === "\\") {
        i += 1;
        const e = text[i];
        if (e === "\"" || e === "\\" || e === "/") { out += e; i += 1; continue; }
        if (e === "b") { out += "\b"; i += 1; continue; }
        if (e === "f") { out += "\f"; i += 1; continue; }
        if (e === "n") { out += "\n"; i += 1; continue; }
        if (e === "r") { out += "\r"; i += 1; continue; }
        if (e === "t") { out += "\t"; i += 1; continue; }
        if (e === "u") {
          const hex = text.slice(i + 1, i + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) bad("a \\u escape needs four hex digits");
          out += String.fromCharCode(parseInt(hex, 16));
          i += 5;
          continue;
        }
        bad(e === undefined ? "unterminated escape" : `unknown escape \\${e}`);
      }
      if (text.charCodeAt(i) < 0x20) bad("an unescaped control character in a string");
      out += c;
      i += 1;
    }
  }

  function scanNumber() {
    if (text[i] === "-") i += 1;
    if (text[i] === "0") i += 1;
    else if (digit()) { while (digit()) i += 1; }
    else bad("a number needs at least one digit");
    if (text[i] === ".") {
      i += 1;
      if (!digit()) bad("a fraction needs at least one digit");
      while (digit()) i += 1;
    }
    if (text[i] === "e" || text[i] === "E") {
      i += 1;
      if (text[i] === "+" || text[i] === "-") i += 1;
      if (!digit()) bad("an exponent needs at least one digit");
      while (digit()) i += 1;
    }
  }

  function scanObject() {
    i += 1;
    const names = [];
    const children = new Map();
    skipWhitespace();
    if (text[i] === "}") { i += 1; return { kind: "object", names, children }; }
    for (;;) {
      skipWhitespace();
      const nameAt = i;
      const name = scanString();
      if (children.has(name)) {
        reject("E_DUPLICATE_MEMBER",
          `the member name ${JSON.stringify(name)} appears twice in one object (offset ${nameAt}). `
          + "Duplicate member names are refused here, while every occurrence is still observable -- "
          + "JSON.parse would silently keep the last one. Names are compared by their DECODED value, "
          + "so \"a\" and \"\\u0061\" are the same name");
      }
      skipWhitespace();
      if (text[i] !== ":") bad("expected \":\" after a member name");
      i += 1;
      const child = scanValue();
      names.push(name);
      children.set(name, child);
      skipWhitespace();
      if (text[i] === ",") { i += 1; continue; }
      if (text[i] === "}") { i += 1; return { kind: "object", names, children }; }
      bad("expected \",\" or \"}\" in an object");
    }
  }

  function scanArray() {
    i += 1;
    const items = [];
    skipWhitespace();
    if (text[i] === "]") { i += 1; return { kind: "array", items }; }
    for (;;) {
      items.push(scanValue());
      skipWhitespace();
      if (text[i] === ",") { i += 1; continue; }
      if (text[i] === "]") { i += 1; return { kind: "array", items }; }
      bad("expected \",\" or \"]\" in an array");
    }
  }

  function scanValue() {
    skipWhitespace();
    const c = text[i];
    if (c === "{") return scanObject();
    if (c === "[") return scanArray();
    if (c === "\"") { scanString(); return SCALAR; }
    if (c === "t") { word("true"); return SCALAR; }
    if (c === "f") { word("false"); return SCALAR; }
    if (c === "n") { word("null"); return SCALAR; }
    if (c === "-" || (c >= "0" && c <= "9")) { scanNumber(); return SCALAR; }
    bad(c === undefined ? "unexpected end of document" : `unexpected character ${JSON.stringify(c)}`);
    return SCALAR;
  }

  if (typeof text !== "string") reject("E_JSON", "the document must be a string");
  const root = scanValue();
  skipWhitespace();
  if (i !== text.length) bad("trailing content after the document");
  return root;
}

// --- shape helpers ----------------------------------------------------------------------------------

function exactKeys(value, expected, where, code = "E_ENTRY_SHAPE") {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    reject(code, `${where} must be a JSON object`);
  }
  if (!sameKeys(value, expected)) {
    const actual = Object.keys(value).sort();
    const missing = [...expected].filter((k) => !actual.includes(k));
    const undeclared = actual.filter((k) => ![...expected].includes(k));
    reject(code,
      `${where} must declare exactly ${JSON.stringify([...expected].sort())}`
      + `${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`
      + `${undeclared.length ? ` (undeclared: ${undeclared.join(", ")})` : ""}`);
  }
  return value;
}

function nonEmptyString(value, where, code = "E_ENTRY_FIELD") {
  if (typeof value !== "string" || value === "") reject(code, `${where} must be a non-empty string`);
  return value;
}

// TP v1.10: within one entry, member names are compared AFTER escape decoding and must be strictly
// ascending by Unicode code point. Sorting the input and accepting it would accept a document that
// says something other than what it will be read as.
function assertMemberOrder(shape, where) {
  const { names } = shape;
  for (let n = 1; n < names.length; n += 1) {
    if (compareCodePoint(names[n - 1], names[n]) >= 0) {
      reject("E_ORDER",
        `${where} declares ${JSON.stringify(names[n])} after ${JSON.stringify(names[n - 1])}, which is not `
        + "strictly ascending Unicode code-point order; the reader refuses it rather than sorting it");
    }
  }
}

function objectShape(shape, where) {
  if (shape === undefined || shape.kind !== "object") {
    reject("E_ENTRY_SHAPE", `${where} must be a JSON object`);
  }
  return shape;
}

// --- field grammars ---------------------------------------------------------------------------------

// TP section 2 + section 6: a repo-relative Git tree path, "/" separated, no dot-segment. Case and
// symlink identity are properties of a tree this component cannot see, so they stay contextual.
function checkPath(value, where) {
  nonEmptyString(value, where);
  if (value.includes("\\")) reject("E_ENTRY_FIELD", `${where} contains a backslash; the separator is "/"`);
  if (value.startsWith("/")) reject("E_ENTRY_FIELD", `${where} is absolute; the path is repo-relative`);
  // "C:/x" has no backslash and no leading slash, but it is still an absolute Windows path and a Git
  // tree records nothing of the sort. Refusing it here keeps one platform's absolute spelling from
  // reading as a legal relative path on another.
  if (/^[A-Za-z]:/.test(value)) {
    reject("E_ENTRY_FIELD", `${where} begins with a drive letter; the path is repo-relative, not platform-absolute`);
  }
  // A Git tree entry name cannot contain U+0000. It survives a JSON document as \u0000, so it has to
  // be refused explicitly rather than assumed impossible.
  if (value.includes("\u0000")) reject("E_ENTRY_FIELD", `${where} contains U+0000, which no Git tree path may carry`);
  for (const segment of value.split("/")) {
    if (segment === "") reject("E_ENTRY_FIELD", `${where} has an empty path segment`);
    if (segment === "." || segment === "..") {
      reject("E_ENTRY_FIELD", `${where} contains a ${JSON.stringify(segment)} dot-segment`);
    }
  }
  return value;
}

// TP 11b.8: either "tid:" plus an 11b.7 stable ID, or "s:" plus the canonicalJson encoding of the
// container chain and declaration name. The "s:" payload must ALREADY be canonical -- re-encoding it
// and comparing is how that is checked, without re-deriving any identity from source.
function checkStructuralId(value, where) {
  nonEmptyString(value, where);
  if (value.startsWith("tid:")) {
    const id = value.slice(4);
    if (!TID_ID.test(id)) reject("E_ENTRY_FIELD", `${where} carries ${JSON.stringify(id)}, which is not an 11b.7 stable ID`);
    return value;
  }
  if (value.startsWith("s:")) {
    const payload = value.slice(2);
    let names;
    try { names = JSON.parse(payload); } catch {
      reject("E_ENTRY_FIELD", `${where} has an "s:" payload that is not JSON`);
    }
    if (!Array.isArray(names) || names.length === 0 || !names.every((x) => typeof x === "string")) {
      reject("E_ENTRY_FIELD", `${where} must encode a non-empty array of names after "s:"`);
    }
    if (canonicalJson(names) !== payload) {
      reject("E_ENTRY_FIELD", `${where} has an "s:" payload that is not in canonicalJson form`);
    }
    return value;
  }
  reject("E_ENTRY_FIELD", `${where} must begin with "tid:" or "s:"`);
  return value;
}

// TP section 2 canonical tag grammar. The ULID grammar is intent-scan's and is only referenced.
function checkClauseRef(value, where) {
  nonEmptyString(value, where);
  const m = CLAUSE_REF.exec(value);
  if (m === null) reject("E_ENTRY_FIELD", `${where} must be REQ-, DEC- or ASSUM- followed by a canonical ULID`);
  if (!ULID.test(m[2])) {
    reject("E_ENTRY_FIELD",
      `${where} carries ${JSON.stringify(m[2])}, which is not a canonical ULID (26 bytes, Crockford `
      + "uppercase without I/L/O/U, first byte 0-7)");
  }
  return m[1];
}

function checkDpRef(value, where) {
  nonEmptyString(value, where);
  const m = DP_REF.exec(value);
  if (m === null) reject("E_ENTRY_FIELD", `${where} must be "DP-" followed by a canonical ULID`);
  if (!ULID.test(m[1])) {
    reject("E_ENTRY_FIELD", `${where} carries ${JSON.stringify(m[1])}, which is not a canonical ULID`);
  }
  return value;
}

// { clauseRef } | { clauseRef, dpRef } | { expl: true } | null. A DP qualifier is legal only on a
// REQ; DEC@DP and ASSUM@DP are structural violations refused right here (TP section 2, AC35). Whether
// a REQ@DP is genuinely exception-backed needs a captured store pre-state and is NOT decided here.
function checkTag(value, shape, where) {
  if (value === null) return;
  if (value === undefined || typeof value !== "object" || Array.isArray(value)) {
    reject("E_ENTRY_SHAPE", `${where} must be a clause binding, an EXPL marker or null`);
  }
  const keys = Object.keys(value).sort();
  const tagShape = objectShape(shape, where);
  assertMemberOrder(tagShape, where);
  if (keys.length === 1 && keys[0] === "expl") {
    if (value.expl !== true) reject("E_ENTRY_FIELD", `${where}.expl must be exactly true`);
    return;
  }
  if (keys.length === 1 && keys[0] === "clauseRef") {
    checkClauseRef(value.clauseRef, `${where}.clauseRef`);
    return;
  }
  if (keys.length === 2 && keys[0] === "clauseRef" && keys[1] === "dpRef") {
    const kind = checkClauseRef(value.clauseRef, `${where}.clauseRef`);
    checkDpRef(value.dpRef, `${where}.dpRef`);
    if (kind !== "REQ") {
      reject("E_ENTRY_FIELD",
        `${where} qualifies a ${kind} clause with a DP; only an exception-backed REQ may carry "@DP-" `
        + "(this reader accepts the REQ form LEXICALLY and does not decide whether it is exception-backed)");
    }
    return;
  }
  reject("E_ENTRY_SHAPE",
    `${where} must be exactly { clauseRef }, { clauseRef, dpRef } or { expl: true }; got `
    + `${JSON.stringify(keys)}`);
}

// --- entry validation --------------------------------------------------------------------------------

function checkEntry(entry, shape, index) {
  const where = `entries[${index}]`;
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    reject("E_ENTRY_SHAPE", `${where} must be a JSON object`);
  }
  const entryShape = objectShape(shape, where);

  const status = entry.status;
  if (typeof status !== "string" || !STATUSES.includes(status)) {
    reject("E_ENTRY_FIELD", `${where}.status must be one of ${JSON.stringify(STATUSES)}; got ${JSON.stringify(status)}`);
  }

  // The exact key set is dispatched on status, and "must be absent" means the KEY is gone. A null is
  // a present key carrying null, which is a different document and a different inventoryDigest.
  let expected;
  if (status === "added") expected = [...COMMON_SEVEN, "headBodyDigest"];
  else if (status === "deleted") expected = [...COMMON_SEVEN, "baseBodyDigest"];
  else expected = [...COMMON_SEVEN, "baseBodyDigest", "headBodyDigest"];
  exactKeys(entry, expected, `${where} (status=${status})`);
  assertMemberOrder(entryShape, where);

  const testRef = exactKeys(entry.testRef, TEST_REF_KEYS, `${where}.testRef`);
  assertMemberOrder(objectShape(entryShape.children.get("testRef"), `${where}.testRef`), `${where}.testRef`);
  checkPath(testRef.path, `${where}.testRef.path`);
  nonEmptyString(testRef.adapterId, `${where}.testRef.adapterId`);
  if (!ID_TOKEN.test(testRef.adapterId)) {
    reject("E_ENTRY_FIELD", `${where}.testRef.adapterId is ${JSON.stringify(testRef.adapterId)}, which is not a legal ID token`);
  }
  checkStructuralId(testRef.structuralId, `${where}.testRef.structuralId`);

  const reason = entry.reason;
  if (typeof reason !== "string" || !REASONS.includes(reason)) {
    reject("E_ENTRY_FIELD", `${where}.reason must be one of ${JSON.stringify(REASONS)}; got ${JSON.stringify(reason)}`);
  }

  checkTag(entry.tagBefore, entryShape.children.get("tagBefore"), `${where}.tagBefore`);
  checkTag(entry.tagAfter, entryShape.children.get("tagAfter"), `${where}.tagAfter`);

  // "adapter 回報" is the whole of the entry-side authority for this field. Binding it to a registry
  // enum would be a registry check, and this component has no registry.
  nonEmptyString(entry.framework, `${where}.framework`);

  // 11b.9b's entry-side obligation is exactly this: the exact key set and three non-empty strings.
  // Field-by-field agreement with the registry is the OTHER half, and it is not performed here.
  const identity = exactKeys(entry.implementationIdentity, IDENTITY_KEYS, `${where}.implementationIdentity`);
  assertMemberOrder(
    objectShape(entryShape.children.get("implementationIdentity"), `${where}.implementationIdentity`),
    `${where}.implementationIdentity`);
  for (const key of IDENTITY_KEYS) nonEmptyString(identity[key], `${where}.implementationIdentity.${key}`);

  for (const key of ["baseBodyDigest", "headBodyDigest"]) {
    if (!Object.prototype.hasOwnProperty.call(entry, key)) continue;
    if (typeof entry[key] !== "string" || !V2_DIGEST.test(entry[key])) {
      reject("E_ENTRY_FIELD",
        `${where}.${key} must be 64 lowercase hex; got ${JSON.stringify(entry[key])}`);
    }
  }

  // --- schema invariants (TP section 6) ---
  if ((status === "deleted") !== (entry.tagAfter === null)) {
    reject("E_ENTRY_INVARIANT",
      `${where}: status == deleted and tagAfter == null must hold together; status is ${JSON.stringify(status)} `
      + `and tagAfter is ${entry.tagAfter === null ? "null" : "not null"}`);
  }
  if (status === "added" && entry.tagBefore !== null) {
    reject("E_ENTRY_INVARIANT", `${where}: status == added requires tagBefore == null`);
  }
  if ((status === "governance-affected") !== (reason === "governance-affected")) {
    reject("E_ENTRY_INVARIANT",
      `${where}: status == governance-affected and reason == governance-affected must hold together; `
      + `got status ${JSON.stringify(status)} with reason ${JSON.stringify(reason)}`);
  }
  if (reason === "governance-affected") {
    if (canonicalJson(entry.tagBefore) !== canonicalJson(entry.tagAfter)) {
      reject("E_ENTRY_INVARIANT", `${where}: a governance-affected entry must have tagBefore == tagAfter`);
    }
    if (entry.baseBodyDigest !== entry.headBodyDigest) {
      reject("E_ENTRY_INVARIANT", `${where}: a governance-affected entry must have baseBodyDigest == headBodyDigest`);
    }
  }

  // TP approved v1.14 section 6: the two invariants a reader can check from ONE entry. They run last,
  // after the exact key set, the tag shape and the body digests' lexical form, so a document that
  // fails an earlier rule still reports that rule rather than this one.
  //
  // These do NOT let the reader re-derive the producer's classification. §6's ordered table needs the
  // matcher relation, the governance closure and the whole preimage, none of which survive into a
  // persisted entry -- a reader cannot tell from one entry whether a moved pair's paths really differ,
  // whether an unchanged pair was correctly omitted, or which precedence row fired. What it CAN do is
  // refuse a document that contradicts itself, and that is all these two do.
  if (status === "modified" && entry.baseBodyDigest === entry.headBodyDigest) {
    reject("E_ENTRY_INVARIANT",
      `${where}: status == modified requires baseBodyDigest != headBodyDigest; both are `
      + `${JSON.stringify(entry.baseBodyDigest)}. A same-path pair whose body did not move is a retag or is `
      + "omitted, never a modification");
  }
  if (status === "retagged") {
    // Body equality first, then the tag inequality -- a retagged entry has to be BOTH, and reporting
    // the body first keeps the two failures distinguishable.
    if (entry.baseBodyDigest !== entry.headBodyDigest) {
      reject("E_ENTRY_INVARIANT",
        `${where}: status == retagged requires baseBodyDigest == headBodyDigest; got `
        + `${JSON.stringify(entry.baseBodyDigest)} and ${JSON.stringify(entry.headBodyDigest)}. A body that moved `
        + "makes the entry modified, not retagged");
    }
    // canonicalJson, not reference equality and not JSON.stringify: two tags that differ only in
    // source key order are the same typed logical value, and must not read as a retag.
    if (canonicalJson(entry.tagBefore) === canonicalJson(entry.tagAfter)) {
      reject("E_ENTRY_INVARIANT",
        `${where}: status == retagged requires canonicalJson(tagBefore) != canonicalJson(tagAfter); both are `
        + `${canonicalJson(entry.tagAfter)}. A retag with no tag change is not a change at all`);
    }
  }
  return [testRef.path, testRef.adapterId, testRef.structuralId];
}

// --- the isolated canonical reader --------------------------------------------------------------------

export function parseCanonicalInventoryV2(text) {
  // Duplicate members first, on the raw document, before JSON.parse can drop an occurrence.
  const shape = scanDocument(text);

  let raw;
  try { raw = JSON.parse(text); } catch (e) {
    reject("E_JSON", `the document is not valid JSON: ${e.message}`);
  }
  if (shape.kind !== "object") reject("E_ROOT_SHAPE", "the root must be a JSON object");
  exactKeys(raw, V2_INVENTORY_KEYS, "the v2 root", "E_ROOT_SHAPE");

  if (typeof raw.inventoryVersion !== "number" || !Number.isInteger(raw.inventoryVersion) || raw.inventoryVersion !== 2) {
    reject("E_ROOT_FIELD", `inventoryVersion must be the integer 2; got ${JSON.stringify(raw.inventoryVersion)}`);
  }
  if (typeof raw.baseTreeOid !== "string" || !V2_OID.test(raw.baseTreeOid)) {
    reject("E_ROOT_FIELD",
      `baseTreeOid must be 40 or 64 lowercase hex; got ${JSON.stringify(raw.baseTreeOid)}. `
      + "Passing this grammar proves the SPELLING only -- it does not prove the object exists, and it "
      + "does not prove the object's own type is a tree");
  }
  for (const key of ["registryDigest", "headViewDigest", "inputProvenanceStoreDigest", "inventoryDigest"]) {
    if (typeof raw[key] !== "string" || !V2_DIGEST.test(raw[key])) {
      reject("E_ROOT_FIELD", `${key} must be 64 lowercase hex; got ${JSON.stringify(raw[key])}`);
    }
  }
  if (!Array.isArray(raw.entries)) reject("E_ROOT_FIELD", "entries must be an array");

  const entriesShape = shape.children.get("entries");
  const tuples = raw.entries.map((entry, index) => checkEntry(entry, entriesShape.items[index], index));

  // entries[] is ordered by (path, adapterId, structuralId), strictly ascending. Equal tuples are a
  // duplicate identity, and neither de-duplicating nor re-sorting is allowed.
  for (let n = 1; n < tuples.length; n += 1) {
    let order = 0;
    for (let f = 0; f < 3 && order === 0; f += 1) order = compareCodePoint(tuples[n - 1][f], tuples[n][f]);
    if (order === 0) {
      reject("E_ORDER", `entries[${n}] repeats the identity ${canonicalJson(tuples[n])}; entries must be strictly ascending`);
    }
    if (order > 0) {
      reject("E_ORDER",
        `entries[${n}] sorts before entries[${n - 1}] by (path, adapterId, structuralId); the reader refuses `
        + "an unsorted inventory rather than sorting it");
    }
  }

  // The digest last, over everything above, recomputed from the one formula.
  const expected = computeInventoryV2Digest(raw);
  if (raw.inventoryDigest !== expected) {
    reject("E_DIGEST",
      `inventoryDigest ${JSON.stringify(raw.inventoryDigest)} does not equal the single formula `
      + `sha256(canonicalJson({ inventoryVersion, baseTreeOid, registryDigest, headViewDigest, `
      + `inputProvenanceStoreDigest, entries })) = ${expected}`);
  }
  return raw;
}

// --- the product entry point ----------------------------------------------------------------------

export function parseInventory(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    refuse(`changed-test-inventory is not valid JSON: ${e.message}`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    refuse("changed-test-inventory must be a JSON object");
  }

  // Explicit version dispatch. v2 announces itself with a discriminator; v1 never had one and is
  // recognised only by its exact absence shape, so anything in between is fail-closed rather than
  // being read as whichever version it most resembles.
  if (sameKeys(raw, V2_INVENTORY_KEYS)) {
    // Canonical validation runs FIRST and in full, so a malformed v2 document fails for its own
    // defect and reports it, rather than disappearing behind the rollout marker.
    const envelope = parseCanonicalInventoryV2(text);
    // And then it is refused ANYWAY, empty or populated alike. An empty v2 envelope is not a
    // harmless subset of a populated one: it still asserts a registryDigest, a headViewDigest and an
    // inputProvenanceStoreDigest that only an S3 consumer can check, and handing one to a consumer
    // that cannot check them would let "the universe was empty" pass unproven. The rollout order is
    // reader before writer, and this build has the reader only.
    const count = envelope.entries.length;
    refuse(
      `${UNSUPPORTED_POPULATED}: the canonical v2 envelope validated completely -- root, entries, ordering `
      + `and digest -- but this build does not CONSUME a v2 inventory at all; it carries ${count} `
      + `${count === 1 ? "entry" : "entries"}, and an EMPTY one is refused for the same reason a populated `
      + "one is. Consuming either needs the §6 producer, the base/head one-to-one matcher, the governance "
      + "reverse closure and S3 consumer freshness (which is what would recompute registryDigest and "
      + "headViewDigest), none of which is implemented. parseCanonicalInventoryV2() reads the same bytes as "
      + "an isolated component, which is not the same as this build acting on them",
    );
  }

  if (Object.prototype.hasOwnProperty.call(raw, "inventoryVersion")) {
    const ks = Object.keys(raw).sort();
    const extra = ks.filter((k) => !V2_INVENTORY_KEYS.includes(k));
    const missing = V2_INVENTORY_KEYS.filter((k) => !ks.includes(k));
    refuse(
      "changed-test-inventory carries an inventoryVersion discriminator but its root key set is not the exact "
      + "v2 envelope"
      + `${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`
      + `${extra.length ? ` (undeclared: ${extra.join(", ")})` : ""}`,
    );
  }

  if (!sameKeys(raw, INVENTORY_KEYS)) {
    const ks = Object.keys(raw).sort();
    const extra = ks.filter((k) => !INVENTORY_KEYS.includes(k));
    const missing = INVENTORY_KEYS.filter((k) => !ks.includes(k));
    refuse(
      "changed-test-inventory key set is not the canonical envelope"
      + `${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`
      + `${extra.length ? ` (undeclared: ${extra.join(", ")})` : ""}`,
    );
  }

  if (!isFullOid(raw.baseTreeOid)) {
    refuse(`changed-test-inventory baseTreeOid must be a full 40-hex Git object name, got ${JSON.stringify(raw.baseTreeOid)}`);
  }
  if (!Array.isArray(raw.entries)) refuse("changed-test-inventory entries must be an array");

  // The legacy clean-slice boundary, unchanged. A v1 document has no registryDigest and no
  // headViewDigest, so it cannot prove what universe it covered; a populated one is refused here,
  // before any entry is inspected, because this build understands none of that entry contract in v1.
  if (raw.entries.length !== 0) {
    refuse(
      `${UNSUPPORTED_POPULATED}: this build reads the canonical envelope for the AC60 historical-consumer `
      + `clean slice only, so entries[] must be empty; got ${raw.entries.length}. Populated entries need the `
      + `§6 producer and the per-result body/tag consumers, which are not implemented — the inventory is `
      + "refused rather than partially parsed",
    );
  }

  const expected = computeInventoryDigest(raw);
  if (raw.inventoryDigest !== expected) {
    refuse(
      `changed-test-inventory inventoryDigest ${JSON.stringify(raw.inventoryDigest)} does not equal `
      + `sha256(canonicalJson({ baseTreeOid, entries })) = ${expected}`,
    );
  }
  return raw;
}

export function loadInventory(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    refuse(`cannot read changed-test-inventory at ${file} (${e && e.code})`);
  }
  return parseInventory(text);
}
