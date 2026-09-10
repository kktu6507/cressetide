// The ONE implementation of shared §9's Check B search: how a Source excerpt is looked for in the
// current repository's captured bytes, and what an occurrence count means.
//
// WHY SHARED. The producer charges Check B for its drift seed and for post-binding ob-5; the Step 6
// consumer charges it again over its own captured S3. Two implementations of this rule have already
// been shown to disagree: TP §11b 8b records a real counterexample where a raw-haystack search made
// LF and BOM+LF report an empty seed while CRLF, CR and BOM+CRLF wrongly reported drift, for five
// inputs whose canonical values were identical. One definition, two callers.
//
// WHAT CROSSES THE BOUNDARY. Buffers, a Map of buffers, and a small data verdict. No capture, no
// governance context, no callback. Each caller owns its own error identity: an unanalysable Source
// is reported here as DATA and raised by the caller in its own namespace, so neither component
// borrows the other's codes.
import { canonicalText } from "./canonical-json.mjs";
import { requireHeadViewSnapshot } from "./head-view-snapshot.mjs";

// shared §9 searches the repository file's CANONICAL bytes; TP v1.15's derivation fixes WHICH bytes
// (H's captured regular blobs, never a re-read) without waiving that canonicalisation. The transform
// is therefore applied at the BYTE level and preserves every byte it does not remove: a leading
// UTF-8 BOM goes, CRLF and lone CR become LF, and nothing else changes. No decoding, so an unrelated
// binary or invalid-UTF-8 blob is neither excluded from the search universe nor able to manufacture
// a U+FFFD match, and no rule is invented saying every asset must be UTF-8.
export function canonicalSearchBytes(raw) {
  let start = 0;
  if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) start = 3;
  const out = Buffer.allocUnsafe(raw.length - start);
  let n = 0;
  for (let i = start; i < raw.length; i += 1) {
    const byte = raw[i];
    if (byte === 0x0d) {                                   // CR: CRLF and lone CR both become LF
      out[n] = 0x0a;
      n += 1;
      if (i + 1 < raw.length && raw[i + 1] === 0x0a) i += 1;
      continue;
    }
    out[n] = byte;
    n += 1;
  }
  return out.subarray(0, n);
}

// The search face of a captured head view, computed once per invocation. Only regular blobs: a
// symlink's bytes are a target string rather than content, and junctions and submodules are not
// followed. The snapshot must be the exact object captureHeadViewSnapshot returned -- branding
// excludes a hand-built look-alike. It does NOT establish freshness: a genuinely captured snapshot
// stays branded after the repository moves, so recency comes only from the caller having captured
// this value itself, inside this invocation.
export function buildSearchView(snapshot) {
  requireHeadViewSnapshot(snapshot, "the head view snapshot handed to buildSearchView");
  const view = new Map();
  for (const p of snapshot.paths()) {
    const entry = snapshot.entry(p);
    if (entry.type !== "blob") continue;
    view.set(p, canonicalSearchBytes(snapshot.read(p)));
  }
  return view;
}

// PRECONDITIONS, ENFORCED because this is an exported boundary. Inside the producer this function was
// module-private and structurally unreachable with an empty needle, because its only caller guarded
// first; exporting it moved that precondition from "guaranteed by the one caller" to "part of a
// public contract", and the guard has to move with it.
//
// The empty needle is not a style point. Buffer.prototype.indexOf returns the (clamped) byteOffset
// when the search value is empty, so `at` pins at `view` length, `from = at + 1` never escapes, the
// loop never breaks and the call HANGS -- reproduced independently as a timeout, not as an ordinary
// failure. Returning 0 instead would be worse than the hang: zero occurrences MEANS drift to this
// module's callers, so unanalysable input would silently become a governance verdict.
//
// TypeError/RangeError rather than a typed E_* code on purpose: these are programming-error
// preconditions at a pure utility, and a domain-style code would land them in the same family a
// caller may be catching for governance refusals.
export function countOccurrences(view, needle) {
  if (!(view instanceof Map)) {
    throw new TypeError("countOccurrences expects a Map of path -> Buffer, as buildSearchView returns");
  }
  for (const hay of view.values()) {
    if (!Buffer.isBuffer(hay)) {
      throw new TypeError("countOccurrences expects every search-view value to be a Buffer");
    }
  }
  if (!Buffer.isBuffer(needle)) {
    throw new TypeError(`countOccurrences expects a Buffer needle; got ${typeof needle}`);
  }
  if (needle.length === 0) {
    throw new RangeError(
      "countOccurrences requires a nonempty needle: an empty search value matches at every offset and "
      + "cannot be counted, and reporting 0 would disguise unanalysable input as no occurrences");
  }
  let total = 0;
  for (const hay of view.values()) {
    let from = 0;
    for (;;) {
      const at = hay.indexOf(needle, from);
      if (at < 0) break;
      total += 1;
      from = at + 1;            // every (path, byteStart) counts, so overlapping matches each count
    }
  }
  return total;
}

// The ONE per-Source Check B verdict, returned as DATA so each caller raises in its own namespace.
//
// The three-way reading is shared §9's, unchanged: ZERO occurrences is drift; ONE is not drift even
// when the locator points somewhere else, because a locator is a stale-tolerant hint and membership
// looks only at the count; TWO OR MORE is an anchor-ambiguity observation and explicitly NOT drift.
// `snapshot-only` never drifts at all.
//
// `analysable: false` is not "not drift". A Source whose excerpt is not a string, or is empty once
// canonicalised, makes the count meaningless, and the caller must fail closed on it rather than
// default to clean.
export function checkSourceOccurrence(source, view) {
  if (!source || typeof source !== "object") {
    return { analysable: false, reason: "no-source" };
  }
  if (source.driftMode !== "repo-file") {
    return { analysable: true, applicable: false, count: 0, drifts: false, ambiguous: false };
  }
  if (typeof source.excerpt !== "string") {
    return { analysable: false, reason: "no-string-excerpt" };
  }
  const needle = Buffer.from(canonicalText(source.excerpt), "utf8");
  if (needle.length === 0) {
    return { analysable: false, reason: "empty-canonical-excerpt" };
  }
  const count = countOccurrences(view, needle);
  return { analysable: true, applicable: true, count, drifts: count === 0, ambiguous: count >= 2 };
}
