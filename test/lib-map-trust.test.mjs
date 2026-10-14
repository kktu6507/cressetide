// Unit tests for cressetide/lib/map-trust.mjs: the CTIDE:TRUST tag grammar map.mjs and ship.mjs each
// carried a copy of — the trust tags their own tests use, the date rule, and that the shared /g regex's
// lastIndex cannot carry one call's position into the next.
import assert from "node:assert/strict";
import { test } from "./helpers.mjs";
import { OPS_TRUST_TAG_ATTEMPT, OPS_TRUST_TAG_WELLFORMED, isValidIsoDate, opsTrustTagIsWellFormed, trustTagAttempts } from "../cressetide/lib/map-trust.mjs";

// From test/map.test.mjs and test/ship.test.mjs.
const WELL_FORMED = [
  "<!-- CTIDE:TRUST:unverified -->",
  "<!-- CTIDE:TRUST:verified:2026-07-01 -->",
  "<!-- CTIDE:TRUST:dry-run-verified:2026-07-01 -->",
  "<!-- CTIDE:TRUST:verified:2026-01-01 -->",
  "<!-- CTIDE:TRUST:verified: 2026-07-01 -->",
  "<!-- CTIDE:TRUST:unverified:2026-07-01 -->",
  "<!--CTIDE:TRUST:verified:2026-07-01T10:20:30Z-->",
  "<!--   CTIDE:TRUST:dry-run-verified : 2026-07-01T10:20:30.123Z   -->",
];
const MALFORMED = [
  "<!-- CTIDE:TRUST:verified -->",
  "<!-- CTIDE:TRUST:dry-run-verified -->",
  "<!-- CTIDE:TRUST:verified:2026-02-31 -->",
  "<!-- CTIDE:TRUST:confirmed:2026-07-01 -->",
  "<!-- CTIDE:TRUST:bogus-tier -->",
  "<!-- CTIDE:TRUST:verified:whenever -->",
  "<!-- CTIDE:TRUST:verified:2026-07-01 extra -->",
];
const ROLLBACK_BLOCK = [
  "",
  "- UNVERIFIED: rollback steps require Cartographer confirmation. <!-- CTIDE:HEURISTIC-PLACEHOLDER --> <!-- CTIDE:TRUST:unverified -->",
  "- Exact steps: run scripts/rollback.sh (verified: 2026-07-01) <!-- CTIDE:TRUST:verified:2026-07-01 --> <!-- CTIDE:TRUST:verified -->",
  "- prose that only says verified: 2026-07-01, with no tag",
  "- a mis-cased comment <!-- ctide:trust:verified:2026-07-01 --> is not a tag",
  "",
].join("\n");
const ROLLBACK_TAGS = ["<!-- CTIDE:TRUST:unverified -->", "<!-- CTIDE:TRUST:verified:2026-07-01 -->", "<!-- CTIDE:TRUST:verified -->"];

test("opsTrustTagIsWellFormed(): the well-formed tags of the map/ship fixtures", () => {
  for (const tag of WELL_FORMED) assert.equal(opsTrustTagIsWellFormed(tag), true, tag);
});

test("opsTrustTagIsWellFormed(): the malformed tags of the map/ship fixtures", () => {
  for (const tag of MALFORMED) assert.equal(opsTrustTagIsWellFormed(tag), false, tag);
});

test("OPS_TRUST_TAG_WELLFORMED: captures the tier and the date", () => {
  assert.deepEqual([...OPS_TRUST_TAG_WELLFORMED.exec("<!-- CTIDE:TRUST:dry-run-verified : 2026-07-01 -->")].slice(1), ["dry-run-verified", "2026-07-01"]);
  assert.deepEqual([...OPS_TRUST_TAG_WELLFORMED.exec("<!-- CTIDE:TRUST:unverified -->")].slice(1), ["unverified", undefined]);
});

test("trustTagAttempts() / OPS_TRUST_TAG_ATTEMPT: every tag-shaped comment, malformed ones included, mis-cased ones not", () => {
  assert.deepEqual(trustTagAttempts(ROLLBACK_BLOCK), ROLLBACK_TAGS);
  assert.deepEqual(ROLLBACK_BLOCK.match(OPS_TRUST_TAG_ATTEMPT), ROLLBACK_TAGS);
  assert.deepEqual(trustTagAttempts("no tags here"), []);
  assert.deepEqual(trustTagAttempts(""), []);
  assert.deepEqual(trustTagAttempts(undefined), []);
  for (const tag of [...WELL_FORMED, ...MALFORMED]) assert.deepEqual(trustTagAttempts(`x ${tag} y`), [tag], tag);
  assert.equal(
    "- UNVERIFIED: x. <!-- CTIDE:TRUST:unverified -->".replace(OPS_TRUST_TAG_ATTEMPT, "").trim(),
    "- UNVERIFIED: x.",
    "map strips the tag out of a skeleton line with replace()",
  );
});

test("isValidIsoDate(): real dates and UTC timestamps only", () => {
  for (const value of ["2026-07-01", "2024-02-29", "2026-07-01T23:59:59Z", "2026-07-01T00:00:00.000Z", "0001-01-01"]) {
    assert.equal(isValidIsoDate(value), true, value);
  }
  for (const value of ["2026-02-31", "2025-02-29", "2026-13-01", "2026-00-10", "2026-07-01T24:00:00Z", "2026-07-01T10:60:00Z",
    "2026-07-01T10:20:30+01:00", "2026-07-01T10:20:30", "2026-7-1", "", null, undefined, " 2026-07-01"]) {
    assert.equal(isValidIsoDate(value), false, String(value));
  }
});

// The /g regex object is shared by every importer. A stray .test()/.exec() elsewhere leaves its lastIndex
// past 0; the match/replace paths every consumer uses must not start from there.
test("repeated calls give the same answers, even after a stray .test() left OPS_TRUST_TAG_ATTEMPT.lastIndex mid-string", () => {
  const first = trustTagAttempts(ROLLBACK_BLOCK);
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(trustTagAttempts(ROLLBACK_BLOCK), first, `call ${i + 2}`);
    for (const tag of WELL_FORMED) assert.equal(opsTrustTagIsWellFormed(tag), true, tag);
    for (const tag of MALFORMED) assert.equal(opsTrustTagIsWellFormed(tag), false, tag);
  }
  try {
    assert.equal(OPS_TRUST_TAG_ATTEMPT.test(ROLLBACK_BLOCK), true);
    assert.ok(OPS_TRUST_TAG_ATTEMPT.lastIndex > 0, "fixture sanity: the stray call left state behind");
    assert.deepEqual(trustTagAttempts(ROLLBACK_BLOCK), ROLLBACK_TAGS, "trustTagAttempts starts from the beginning");
    assert.equal(OPS_TRUST_TAG_ATTEMPT.lastIndex, 0, "and leaves no position behind");
    OPS_TRUST_TAG_ATTEMPT.test(ROLLBACK_BLOCK);
    assert.equal(ROLLBACK_BLOCK.replace(OPS_TRUST_TAG_ATTEMPT, "").includes("CTIDE:TRUST:"), false, "replace() strips every tag");
  } finally {
    OPS_TRUST_TAG_ATTEMPT.lastIndex = 0;
  }
});
