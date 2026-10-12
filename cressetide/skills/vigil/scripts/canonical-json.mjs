// The canonical encoding, ordering and digest primitives, and the one typed error they raise.
//
// WHY THIS MODULE EXISTS. These five functions were defined in provenance-store.mjs, and
// changed-test-inventory.mjs imported them from there. The persisted-batch reader needs the store to
// validate a nested ChangedTestInventoryV2 through the canonical inventory authority, which would
// have made the graph store -> inventory -> store: an initialisation cycle whose evaluation order
// depends on which module an entry point happens to import first. Moving ONLY the dependency-free
// primitives here removes that edge; both modules now depend on this one, and neither depends on the
// other in reverse.
//
// Nothing here is new and nothing changed. provenance-store.mjs re-exports every name below, so its
// public API -- and every existing import of it -- is byte-for-byte unaffected. There is still
// exactly ONE definition of each function and ONE ProvenanceError class, so `instanceof` keeps
// working across both import paths.
//
// Node built-ins only, by design: anything with a project dependency belongs above this layer.
import crypto from "node:crypto";

// --- errors ------------------------------------------------------------------------------------
// Every rejection carries a machine-readable code so callers (and the tests) can assert on the
// reason rather than on prose. `detail` names the offending object wherever one exists.

export class ProvenanceError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = "ProvenanceError";
    this.code = code;
    this.detail = detail;
  }
}

export function reject(code, message, detail = null) {
  throw new ProvenanceError(code, message, detail);
}

// --- canonical encoding & digest ---------------------------------------------------------------
// shared model §9: UTF-8 (no BOM), LF, no trimming, no case folding — modifiers are load-bearing.
// §2 batchDigest: object keys sorted by Unicode code point, no insignificant whitespace. Arrays
// preserve the order they are given; callers pre-sort the arrays the spec assigns a total order to.

export function canonicalText(value) {
  if (typeof value !== "string") reject("E_CANON_TYPE", "canonicalText expects a string");
  return value.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

// TRUE code-point order. JavaScript's `<` on strings compares UTF-16 code UNITS, which orders any
// non-BMP character (a surrogate pair, lead unit 0xD800-0xDBFF) BEFORE U+E000-U+FFFF — the opposite
// of code-point order. The spec says "Unicode code point", so iterate by code point.
export function compareCodePoint(a, b) {
  const x = Array.from(String(a));
  const y = Array.from(String(b));
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const cx = x[i].codePointAt(0);
    const cy = y[i].codePointAt(0);
    if (cx !== cy) return cx < cy ? -1 : 1;
  }
  return x.length === y.length ? 0 : x.length < y.length ? -1 : 1;
}

export function canonicalJson(value) {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "boolean" || t === "number") {
    if (t === "number" && !Number.isFinite(value)) reject("E_CANON_NUMBER", "non-finite number is not canonicalisable");
    return JSON.stringify(value);
  }
  if (t === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (t === "object") {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort(compareCodePoint);
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  reject("E_CANON_TYPE", `value of type ${t} is not canonicalisable`);
  return "";
}

export function sha256Hex(text) {
  return crypto.createHash("sha256").update(canonicalText(text), "utf8").digest("hex");
}

export function digestOf(value) {
  return sha256Hex(canonicalJson(value));
}
