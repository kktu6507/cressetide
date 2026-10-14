// The Map's CTIDE:TRUST trust-tag grammar, shared by map.mjs (verify) and ship.mjs (migration
// compatibility) — one copy where there were two documented ones. Node built-ins only.
//
// A trust-marked Ops Profile entry carries a machine-readable HTML comment after its human prose, e.g.
// "<!-- CTIDE:TRUST:verified:2026-07-01 -->" or "<!-- CTIDE:TRUST:unverified -->". Only that comment is
// ever parsed; the surrounding free-form prose never is.

// Finds every CTIDE:TRUST-shaped comment — deliberately loose (a garbled tier word or a missing date still
// matches), so a malformed tag is never invisible to the scan; each match is then checked on its own by
// opsTrustTagIsWellFormed. Case-sensitive: a mis-cased "ctide:trust" comment is not a tag at all.
//
// This is a /g regex object shared by every importer, so its lastIndex is shared state. Use it only
// through String.prototype.match and String.prototype.replace (both reset lastIndex to 0 before they
// start and leave it at 0), or through trustTagAttempts below. Never call .test() or .exec() on it
// directly, and never pass it to matchAll (which copies the current lastIndex): each of those would let
// one call's position leak into the next.
export const OPS_TRUST_TAG_ATTEMPT = /<!--\s*CTIDE:TRUST:[^>]*-->/g;

// A well-formed tag: one of the three tier words, then — optionally, with optional whitespace around the
// colon, mirroring the "verified: <date>" prose convention — a date. Not global, so exec() keeps no state.
export const OPS_TRUST_TAG_WELLFORMED = /^<!--\s*CTIDE:TRUST:(verified|dry-run-verified|unverified)(?:\s*:\s*(\S+))?\s*-->$/;

// Every CTIDE:TRUST-shaped comment in `text`, in order ([] when there is none). Unaffected by whatever
// lastIndex a caller may have left on OPS_TRUST_TAG_ATTEMPT.
export function trustTagAttempts(text) {
  return String(text ?? "").match(OPS_TRUST_TAG_ATTEMPT) || [];
}

// True for a well-formed tag whose tier is "unverified" (no date semantics: a trailing suffix is not
// validated), or whose dated tier carries a date isValidIsoDate accepts.
export function opsTrustTagIsWellFormed(tag) {
  const match = OPS_TRUST_TAG_WELLFORMED.exec(tag);
  if (!match) return false;
  const [, tier, date] = match;
  return tier === "unverified" || isValidIsoDate(date);
}

// True for YYYY-MM-DD, or YYYY-MM-DDTHH:MM:SS[.mmm]Z, naming a real calendar date and time (no 2026-02-31,
// no hour 24).
export function isValidIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z)?$/.exec(value || "");
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, millisecondText] = match;
  const expected = [yearText, monthText, dayText, hourText || "00", minuteText || "00", secondText || "00", millisecondText || "000"].map(Number);
  const parsed = new Date(0);
  parsed.setUTCFullYear(expected[0], expected[1] - 1, expected[2]);
  parsed.setUTCHours(expected[3], expected[4], expected[5], expected[6]);
  return Number.isFinite(parsed.getTime()) && [
    parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate(),
    parsed.getUTCHours(), parsed.getUTCMinutes(), parsed.getUTCSeconds(), parsed.getUTCMilliseconds(),
  ].every((part, index) => part === expected[index]);
}
