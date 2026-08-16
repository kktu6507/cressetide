// The base/head one-to-one declaration matcher, driven only through its real public entry point.
//
// Spec anchors:
//   TP = docs/superpowers/specs/2026-07-25-test-provenance-spec.md (approved v1.12)
//        §2 testRef and entries ordering, §6 closed matching rules, §11b.7 stable-ID uniqueness
//        scope, §11b.8 structuralId and one-to-one matching, §11b.9b implementationIdentity,
//        §11b.10b DiscoveryAnalysisPreimage, AC26, AC27, AC36, AC101, AC103, AC104, AC114
//
// The input is a DiscoveryAnalysisPreimage. These fixtures build synthetic ones -- deeply frozen and
// canonically ordered, exactly as §11b.10b requires -- because that is this component's real and
// only input: it is a pure function over an in-memory value and touches no repository at all. No
// production seam was added to make any of this reachable, and one case below drives the real
// producer end to end so the synthetic shape is checked against the genuine article.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cp from "node:child_process";

import {
  BaseHeadMatcherError, matchBaseHeadDeclarations,
} from "../cressetide/skills/vigil/scripts/base-head-declaration-matcher.mjs";
import { buildDiscoveryAnalysisPreimage } from "../cressetide/skills/vigil/scripts/adapter-discovery-preimage.mjs";
import {
  computeInventoryV2Digest, parseInventory, UNSUPPORTED_POPULATED,
} from "../cressetide/skills/vigil/scripts/changed-test-inventory.mjs";
import { canonicalJson } from "../cressetide/skills/vigil/scripts/provenance-store.mjs";

const OID = "a".repeat(40);
const HEAD_VIEW_DIGEST = "b".repeat(64);
const REGISTRY_DIGEST = "c".repeat(64);
const IDENTITY = Object.freeze({ implementationId: "node-test-v1", parserId: "acorn", parserVersion: "8.18.0" });
const digest = (seed) => seed.padStart(64, "0").slice(-64).replace(/[^0-9a-f]/g, "0");

// --- synthetic preimage construction ----------------------------------------------------------------

// Builds the exact §11b.10b shape: canonically ordered and deeply frozen, so a fixture can never
// accidentally pass by handing the matcher something the producer would never emit.
function preimageOf(baseSpec, headSpec, overrides = {}) {
  const side = (spec) => {
    const byModule = new Map();
    for (const d of spec) {
      const key = JSON.stringify([d.path, d.adapterId || "node-test"]);
      if (!byModule.has(key)) {
        byModule.set(key, {
          path: d.path,
          adapterId: d.adapterId || "node-test",
          framework: d.framework || "node:test",
          implementationIdentity: Object.freeze({ ...(d.implementationIdentity || IDENTITY) }),
          declarations: [],
        });
      }
      byModule.get(key).declarations.push(Object.freeze({
        structuralId: d.structuralId,
        tag: d.tag === undefined ? null : (d.tag === null ? null : Object.freeze({ ...d.tag })),
        bodyDigest: d.bodyDigest || digest("1"),
      }));
    }
    const modules = [...byModule.values()];
    for (const m of modules) {
      m.declarations.sort((a, b) => (a.structuralId < b.structuralId ? -1 : a.structuralId > b.structuralId ? 1 : 0));
      m.declarations = Object.freeze(m.declarations);
      Object.freeze(m);
    }
    modules.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : (a.adapterId < b.adapterId ? -1 : a.adapterId > b.adapterId ? 1 : 0)));
    return Object.freeze(modules);
  };
  return Object.freeze({
    baseTreeOid: OID,
    headViewDigest: HEAD_VIEW_DIGEST,
    registryDigest: REGISTRY_DIGEST,
    baseModules: side(baseSpec),
    headModules: side(headSpec),
    ...overrides,
  });
}

const refused = (fn, what, code) => {
  let error = null;
  try { fn(); } catch (e) { error = e; }
  assert.ok(error, `${what}: must be refused`);
  assert.ok(error instanceof BaseHeadMatcherError, `${what}: expected a BaseHeadMatcherError, got ${error && error.name}: ${error && error.message}`);
  assert.strictEqual(error.code, code, `${what}: expected ${code}, got ${error.code} (${error.message})`);
  return error;
};

const shapeOf = (result) => result.map((r) => [r.relation, r.base && r.base.path, r.head && r.head.path, (r.base || r.head).structuralId]);

// --- 1-5: same-path pairs survive every combination of body and tag change ---------------------------

test("§6 empty base and empty head produce an empty frozen result", () => {
  const result = matchBaseHeadDeclarations(preimageOf([], []));
  assert.deepStrictEqual([...result], []);
  assert.ok(Object.isFrozen(result));
});

test("§6 rule 1 an unchanged declaration is still a pair, and is kept", () => {
  // Kept on purpose: §6's governance-affected status exists for tests that did not change but whose
  // clause did, and a reverse closure cannot reach a sibling it was never handed.
  const d = { path: "a.test.mjs", structuralId: 's:["n"]', bodyDigest: digest("1"), tag: { clauseRef: "REQ-1" } };
  const result = matchBaseHeadDeclarations(preimageOf([d], [d]));
  assert.deepStrictEqual(shapeOf(result), [["same-path", "a.test.mjs", "a.test.mjs", 's:["n"]']]);
  assert.strictEqual(result[0].base.bodyDigest, result[0].head.bodyDigest);
});

test("§6 rule 1 a body-only change, a tag-only change and BOTH stay one same-path pair", () => {
  const at = (bodyDigest, tag) => ({ path: "a.test.mjs", structuralId: 's:["n"]', bodyDigest, tag });
  const base = at(digest("1"), { clauseRef: "REQ-1" });
  for (const [label, head] of [
    ["body only", at(digest("2"), { clauseRef: "REQ-1" })],
    ["tag only", at(digest("1"), { clauseRef: "REQ-2" })],
    ["body and tag together", at(digest("2"), { clauseRef: "REQ-2" })],
  ]) {
    const result = matchBaseHeadDeclarations(preimageOf([base], [head]));
    assert.strictEqual(result.length, 1, label);
    // The matcher pairs and stops. §6 rule 1 reads "modified／retagged" -- a disjunction the approved
    // text does not resolve -- so choosing between them here would be inventing authority.
    assert.strictEqual(result[0].relation, "same-path", label);
    assert.ok(!("status" in result[0]), `${label}: no status field`);
    assert.ok(!("reason" in result[0]), `${label}: no reason field`);
    assert.deepStrictEqual(Object.keys(result[0]), ["relation", "base", "head"], label);
    // Both carriers survive, so a producer that later gains the authority can still classify.
    assert.strictEqual(result[0].base.bodyDigest, base.bodyDigest, label);
    assert.strictEqual(result[0].head.bodyDigest, head.bodyDigest, label);
  }
});

// --- 6-8: moved -------------------------------------------------------------------------------------

test("§6 rule 2 / AC103 a pure move keeps identity and produces one moved pair", () => {
  const result = matchBaseHeadDeclarations(preimageOf(
    [{ path: "old/a.test.mjs", structuralId: 's:["n"]', bodyDigest: digest("1") }],
    [{ path: "new/a.test.mjs", structuralId: 's:["n"]', bodyDigest: digest("1") }],
  ));
  assert.deepStrictEqual(shapeOf(result), [["moved", "old/a.test.mjs", "new/a.test.mjs", 's:["n"]']]);
});

test("§6 rule 2 / AC27 move+retag and move+body-change are each ONE moved pair, never added+deleted", () => {
  for (const [label, head] of [
    ["move + retag", { path: "new/a.test.mjs", structuralId: 's:["n"]', bodyDigest: digest("1"), tag: { clauseRef: "REQ-2" } }],
    ["move + body change", { path: "new/a.test.mjs", structuralId: 's:["n"]', bodyDigest: digest("2"), tag: { clauseRef: "REQ-1" } }],
    ["move + both", { path: "new/a.test.mjs", structuralId: 's:["n"]', bodyDigest: digest("2"), tag: { clauseRef: "REQ-2" } }],
  ]) {
    const result = matchBaseHeadDeclarations(preimageOf(
      [{ path: "old/a.test.mjs", structuralId: 's:["n"]', bodyDigest: digest("1"), tag: { clauseRef: "REQ-1" } }],
      [head],
    ));
    assert.strictEqual(result.length, 1, `${label}: exactly one record`);
    assert.strictEqual(result[0].relation, "moved", label);
    assert.ok(result[0].base !== null && result[0].head !== null, label);
  }
});

// --- 9-11: added, deleted, and exact-before-moved ------------------------------------------------------

test("§6 rule 3 head-only is added and base-only is deleted -- in SEPARATE runs", () => {
  // v1.13: rule 3 fires only when the residual is one-sided. Putting a deleted and an added in one
  // invocation is no longer a legal success case -- it is exactly the two-sided residual §6 refuses
  // -- so the two halves are asserted as two runs. AC167 (6) covers the refusal that replaced the
  // old combined expectation, so nothing is lost by splitting this.
  const deletedOnly = matchBaseHeadDeclarations(preimageOf(
    [{ path: "gone.test.mjs", structuralId: 's:["g"]' }],
    [],
  ));
  assert.deepStrictEqual(shapeOf(deletedOnly), [["deleted", "gone.test.mjs", null, 's:["g"]']]);
  assert.strictEqual(deletedOnly[0].head, null);

  const addedOnly = matchBaseHeadDeclarations(preimageOf(
    [],
    [{ path: "new.test.mjs", structuralId: 's:["n"]' }],
  ));
  assert.deepStrictEqual(shapeOf(addedOnly), [["added", null, "new.test.mjs", 's:["n"]']]);
  assert.strictEqual(addedOnly[0].base, null);
});

test("§6 the exact phase runs first: an exact pair is consumed before any move is considered", () => {
  // One structuralId, two base declarations and two head declarations. `keep.test.mjs` matches
  // exactly on both sides; the two survivors are then a unique remaining pair, so they move. If the
  // moved phase had run first, this would have been an ambiguous three-way and failed closed.
  const result = matchBaseHeadDeclarations(preimageOf(
    [{ path: "keep.test.mjs", structuralId: 's:["n"]' }, { path: "old/x.test.mjs", structuralId: 's:["n"]' }],
    [{ path: "keep.test.mjs", structuralId: 's:["n"]' }, { path: "new/x.test.mjs", structuralId: 's:["n"]' }],
  ));
  assert.deepStrictEqual(shapeOf(result), [
    ["same-path", "keep.test.mjs", "keep.test.mjs", 's:["n"]'],
    ["moved", "old/x.test.mjs", "new/x.test.mjs", 's:["n"]'],
  ]);
});

// --- 12-14: ambiguity is fail-closed, never degraded ---------------------------------------------------

test("§11b.8 / AC26 / AC104 one-to-many, many-to-one and many-to-many are fail-closed", () => {
  // No path is shared between the two sides in any of these: an exact pair would be consumed by
  // Phase 1 and would leave a smaller, possibly unambiguous remainder, which would test nothing.
  const one = [{ path: "a/x.test.mjs", structuralId: 's:["n"]' }];
  const two = [{ path: "b/x.test.mjs", structuralId: 's:["n"]' }, { path: "c/x.test.mjs", structuralId: 's:["n"]' }];
  const otherTwo = [{ path: "d/x.test.mjs", structuralId: 's:["n"]' }, { path: "e/x.test.mjs", structuralId: 's:["n"]' }];
  for (const [label, baseSpec, headSpec] of [
    ["one-to-many", one, two],
    ["many-to-one", two, one],
    ["many-to-many", two, otherTwo],
  ]) {
    const error = refused(() => matchBaseHeadDeclarations(preimageOf(baseSpec, headSpec)), label, "E_AMBIGUOUS_MATCH");
    assert.match(error.message, /one-to-one/);
    // AC104: never quietly degraded into added + deleted.
    assert.match(error.message, /never split into added \+ deleted/);
    assert.strictEqual(error.detail.structuralId, 's:["n"]');
  }
});

// --- 15-17: stable-ID uniqueness scope (§11b.7 / AC101) -------------------------------------------------

test("§11b.7 / AC101 a duplicate tid: within ONE view is fail-closed before matching, on either side", () => {
  const duplicate = [
    { path: "a.test.mjs", structuralId: "tid:alpha" },
    { path: "b.test.mjs", structuralId: "tid:alpha" },
  ];
  const single = [{ path: "a.test.mjs", structuralId: "tid:alpha" }];
  for (const [label, baseSpec, headSpec, side] of [
    ["duplicated in head", single, duplicate, "head"],
    ["duplicated in base", duplicate, single, "base"],
  ]) {
    const error = refused(() => matchBaseHeadDeclarations(preimageOf(baseSpec, headSpec)), label, "E_STABLE_ID_DUPLICATE");
    assert.strictEqual(error.detail.side, side, label);
    assert.deepStrictEqual(error.detail.paths, ["a.test.mjs", "b.test.mjs"], label);
    assert.match(error.message, /before any matching runs/);
  }
});

test("§11b.7 / AC101 the same tid: once in base and once in head is a legal pair, not a duplicate", () => {
  const unchanged = matchBaseHeadDeclarations(preimageOf(
    [{ path: "a.test.mjs", structuralId: "tid:alpha" }],
    [{ path: "a.test.mjs", structuralId: "tid:alpha" }],
  ));
  assert.deepStrictEqual(shapeOf(unchanged), [["same-path", "a.test.mjs", "a.test.mjs", "tid:alpha"]]);

  const moved = matchBaseHeadDeclarations(preimageOf(
    [{ path: "a.test.mjs", structuralId: "tid:alpha" }],
    [{ path: "b.test.mjs", structuralId: "tid:alpha" }],
  ));
  assert.deepStrictEqual(shapeOf(moved), [["moved", "a.test.mjs", "b.test.mjs", "tid:alpha"]]);
});

test("§11b.8 a derived s: key repeated across modules is NOT a stable-ID duplicate", () => {
  // The other view has none of them, so there is no pairing candidate and therefore no ambiguity.
  // Treating these as stable-ID duplicates would fail a run that has nothing ambiguous in it.
  const many = [
    { path: "a.test.mjs", structuralId: 's:["shared"]' },
    { path: "b.test.mjs", structuralId: 's:["shared"]' },
    { path: "c.test.mjs", structuralId: 's:["shared"]' },
  ];
  assert.deepStrictEqual(shapeOf(matchBaseHeadDeclarations(preimageOf(many, []))), [
    ["deleted", "a.test.mjs", null, 's:["shared"]'],
    ["deleted", "b.test.mjs", null, 's:["shared"]'],
    ["deleted", "c.test.mjs", null, 's:["shared"]'],
  ]);
  assert.deepStrictEqual(shapeOf(matchBaseHeadDeclarations(preimageOf([], many))), [
    ["added", null, "a.test.mjs", 's:["shared"]'],
    ["added", null, "b.test.mjs", 's:["shared"]'],
    ["added", null, "c.test.mjs", 's:["shared"]'],
  ]);
});

// --- 18: cross-view adapter / identity disagreement ------------------------------------------------------

test("§11b.9b / AC114 a potential pair disagreeing on adapter, framework or identity is fail-closed", () => {
  const base = { path: "a.test.mjs", structuralId: 's:["n"]' };
  for (const [label, head] of [
    ["adapterId", { ...base, adapterId: "other-adapter" }],
    ["framework", { ...base, framework: "some-other-framework" }],
    ["parserVersion", { ...base, implementationIdentity: { ...IDENTITY, parserVersion: "9.0.0" } }],
    ["parserId", { ...base, implementationIdentity: { ...IDENTITY, parserId: "other-parser" } }],
    ["implementationId", { ...base, implementationIdentity: { ...IDENTITY, implementationId: "other-v1" } }],
  ]) {
    const error = refused(() => matchBaseHeadDeclarations(preimageOf([base], [head])), `same-path, ${label}`, "E_PAIR_IDENTITY");
    assert.match(error.message, /fail-closed/);
  }
  // The same refusal on the moved path, so a migration cannot slip through by also moving.
  refused(() => matchBaseHeadDeclarations(preimageOf(
    [{ ...base, path: "old.test.mjs" }],
    [{ ...base, path: "new.test.mjs", framework: "some-other-framework" }],
  )), "moved with a different framework", "E_PAIR_IDENTITY");
  // Stated plainly: under the v1 closed registry this is unreachable through the real producer --
  // one implementation/framework binding, one fresh registry root for both sides. It is driven here
  // with a synthetic preimage, which is this component's real input; no second adapter, registry
  // override or public seam was added, and none is claimed.
});

// --- 19-21: ordering, immutability, purity ----------------------------------------------------------------

test("§2 output order is the code-point testRef tuple, not a locale collation", () => {
  const spec = [
    { path: "b.test.mjs", structuralId: 's:["x"]' },
    { path: "B.test.mjs", structuralId: 's:["x"]' },
    { path: "a.test.mjs", structuralId: 's:["z"]' },
    { path: "a.test.mjs", structuralId: 's:["A"]' },
    { path: "_.test.mjs", structuralId: 's:["x"]' },
  ];
  const result = matchBaseHeadDeclarations(preimageOf(spec, spec));
  const keys = result.map((r) => [r.head.path, r.head.adapterId, r.head.structuralId]);
  // Code-point order puts every uppercase letter before every lowercase one, and "_" (U+005F)
  // between them. A locale collation would interleave B with b and sort "_" elsewhere.
  assert.deepStrictEqual(keys.map((k) => `${k[0]} ${k[2]}`), [
    'B.test.mjs s:["x"]',
    '_.test.mjs s:["x"]',
    'a.test.mjs s:["A"]',
    'a.test.mjs s:["z"]',
    'b.test.mjs s:["x"]',
  ]);
  const collated = [...keys].sort((x, y) => x[0].localeCompare(y[0]) || x[2].localeCompare(y[2]));
  assert.notDeepStrictEqual(keys, collated, "the fixture must actually distinguish the two orders");
  // Strictly ascending, so no two records share a testRef tuple.
  for (let i = 1; i < keys.length; i += 1) {
    assert.ok(JSON.stringify(keys[i - 1]) < JSON.stringify(keys[i]), "strictly ascending");
  }
});

test("§2 a deleted record is ordered by its BASE locator, the others by head", () => {
  // One-sided residual (deleted only) plus a moved pair, so this is a legal success case under
  // v1.13 -- and it discriminates BOTH halves of the ordering rule rather than fewer than before.
  //
  //   moved   : base a/old.test.mjs -> head z/new.test.mjs   (must be keyed on HEAD)
  //   deleted : base k/gone.test.mjs                          (must be keyed on BASE)
  //   deleted : base zz/gone2.test.mjs                        (sorts AFTER the moved head path)
  //
  // Keyed correctly the order is k/gone, z/new, zz/gone2. Keying the moved record on its base path
  // instead would put a/old first; keying a deleted record on head would dereference null.
  const result = matchBaseHeadDeclarations(preimageOf(
    [
      { path: "a/old.test.mjs", structuralId: 's:["m"]' },
      { path: "k/gone.test.mjs", structuralId: 's:["g"]' },
      { path: "zz/gone2.test.mjs", structuralId: 's:["g2"]' },
    ],
    [{ path: "z/new.test.mjs", structuralId: 's:["m"]' }],
  ));
  assert.deepStrictEqual(shapeOf(result), [
    ["deleted", "k/gone.test.mjs", null, 's:["g"]'],
    ["moved", "a/old.test.mjs", "z/new.test.mjs", 's:["m"]'],
    ["deleted", "zz/gone2.test.mjs", null, 's:["g2"]'],
  ]);
});

test("the result and every nested value are deeply frozen", () => {
  const result = matchBaseHeadDeclarations(preimageOf(
    [{ path: "a.test.mjs", structuralId: 's:["n"]', tag: { clauseRef: "REQ-1", dpRef: "DP-1" } }],
    [{ path: "a.test.mjs", structuralId: 's:["n"]', tag: { expl: true } }],
  ));
  assert.ok(Object.isFrozen(result));
  for (const record of result) {
    assert.ok(Object.isFrozen(record));
    for (const side of [record.base, record.head]) {
      if (side === null) continue;
      assert.ok(Object.isFrozen(side));
      assert.ok(Object.isFrozen(side.implementationIdentity));
      if (side.tag !== null) assert.ok(Object.isFrozen(side.tag));
    }
  }
  assert.throws(() => { result[0].relation = "moved"; }, TypeError);
  assert.throws(() => { result[0].head.tag.expl = false; }, TypeError);
});

test("the input is not modified, on success or on failure, and the result is deterministic", () => {
  const preimage = preimageOf(
    [{ path: "a.test.mjs", structuralId: 's:["n"]' }, { path: "b.test.mjs", structuralId: 's:["m"]' }],
    [{ path: "a.test.mjs", structuralId: 's:["n"]' }],
  );
  const before = JSON.stringify(preimage);
  const first = matchBaseHeadDeclarations(preimage);
  const second = matchBaseHeadDeclarations(preimage);
  assert.strictEqual(JSON.stringify(preimage), before, "unchanged after success");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(second)), JSON.parse(JSON.stringify(first)), "deterministic");
  assert.notStrictEqual(second, first, "a fresh result each call, not a cached object");

  const ambiguous = preimageOf(
    [{ path: "a.test.mjs", structuralId: 's:["n"]' }],
    [{ path: "b.test.mjs", structuralId: 's:["n"]' }, { path: "c.test.mjs", structuralId: 's:["n"]' }],
  );
  const ambiguousBefore = JSON.stringify(ambiguous);
  refused(() => matchBaseHeadDeclarations(ambiguous), "ambiguous", "E_AMBIGUOUS_MATCH");
  assert.strictEqual(JSON.stringify(ambiguous), ambiguousBefore, "unchanged after failure");
});

// --- 22-23: the API surface and malformed input ------------------------------------------------------------

test("§11b.10b a preimage that is not already conforming is refused, never repaired", () => {
  const good = preimageOf([{ path: "a.test.mjs", structuralId: 's:["n"]' }], []);
  const clone = (mutate) => { const c = JSON.parse(JSON.stringify(good)); mutate(c); return c; };
  const deepFreeze = (v) => {
    if (v === null || typeof v !== "object") return v;
    for (const k of Object.keys(v)) deepFreeze(v[k]);
    return Object.freeze(v);
  };

  // Not frozen: a mutable preimage cannot be shown to be what the producer built.
  refused(() => matchBaseHeadDeclarations(clone(() => {})), "an unfrozen preimage", "E_PREIMAGE_FROZEN");
  refused(() => matchBaseHeadDeclarations(Object.freeze({ ...good, baseModules: [...good.baseModules] })),
    "a frozen root over an unfrozen array", "E_PREIMAGE_FROZEN");

  // An undeclared ROOT key is an argument error, not a shape error: the root object is the one
  // argument a caller controls, so an extra key there is the only injection vector this API has.
  refused(() => matchBaseHeadDeclarations(deepFreeze(clone((c) => { c.extra = 1; }))), "an undeclared root key", "E_API_ARGUMENTS");

  // Shape.
  for (const [label, mutate] of [
    ["a missing root key", (c) => { delete c.registryDigest; }],
    ["a non-hex baseTreeOid", (c) => { c.baseTreeOid = "not-an-oid"; }],
    ["an uppercase headViewDigest", (c) => { c.headViewDigest = "B".repeat(64); }],
    ["an undeclared module key", (c) => { c.baseModules[0].note = "x"; }],
    ["a missing module key", (c) => { delete c.baseModules[0].framework; }],
    ["an undeclared declaration key", (c) => { c.baseModules[0].declarations[0].sourceBytes = "x"; }],
    ["a missing declaration key", (c) => { delete c.baseModules[0].declarations[0].bodyDigest; }],
    ["a null bodyDigest", (c) => { c.baseModules[0].declarations[0].bodyDigest = null; }],
    ["an undeclared identity key", (c) => { c.baseModules[0].implementationIdentity.vendor = "x"; }],
    ["an empty identity field", (c) => { c.baseModules[0].implementationIdentity.parserId = ""; }],
    ["a malformed tag", (c) => { c.baseModules[0].declarations[0].tag = { clause: "REQ-1" }; }],
    ["expl that is not exactly true", (c) => { c.baseModules[0].declarations[0].tag = { expl: "true" }; }],
    ["a non-array baseModules", (c) => { c.baseModules = {}; }],
  ]) {
    refused(() => matchBaseHeadDeclarations(deepFreeze(clone(mutate))), label, "E_PREIMAGE_SHAPE");
  }

  // Ordering and duplicates: refused as handed over, not sorted or de-duplicated first.
  const twoModules = preimageOf(
    [{ path: "a.test.mjs", structuralId: 's:["n"]' }, { path: "z.test.mjs", structuralId: 's:["m"]' }], [],
  );
  for (const [label, mutate] of [
    ["modules in reverse order", (c) => { c.baseModules.reverse(); }],
    ["a duplicate module", (c) => { c.baseModules[1] = JSON.parse(JSON.stringify(c.baseModules[0])); }],
    ["declarations in reverse order", (c) => { c.baseModules[0].declarations = [{ structuralId: 's:["z"]', tag: null, bodyDigest: digest("1") }, { structuralId: 's:["a"]', tag: null, bodyDigest: digest("1") }]; }],
    ["a duplicate structuralId in one module", (c) => { c.baseModules[0].declarations = [{ structuralId: 's:["n"]', tag: null, bodyDigest: digest("1") }, { structuralId: 's:["n"]', tag: null, bodyDigest: digest("2") }]; }],
  ]) {
    const c = JSON.parse(JSON.stringify(twoModules));
    mutate(c);
    refused(() => matchBaseHeadDeclarations(deepFreeze(c)), label, "E_PREIMAGE_ORDER");
  }
});

test("the API takes exactly one preimage and refuses every injection by name", () => {
  const good = preimageOf([], []);
  refused(() => matchBaseHeadDeclarations(), "no argument", "E_API_ARGUMENTS");
  refused(() => matchBaseHeadDeclarations(good, {}), "a second argument", "E_API_ARGUMENTS");
  refused(() => matchBaseHeadDeclarations(good, undefined), "a second undefined argument", "E_API_ARGUMENTS");

  // Nothing may ride in as an extra key on the one argument it does take. The exact root key set is
  // what refuses each of these, by name.
  for (const [label, extra] of [
    ["repoRoot", { repoRoot: "D:/elsewhere" }],
    ["a second baseTreeOid source", { baseTree: "b".repeat(40) }],
    ["a registry", { registry: { registryVersion: 1, adapters: [] } }],
    ["a registry path", { registryPath: "./test-adapters.json" }],
    ["a parser", { parser: () => ({}) }],
    ["a git executable", { git: "/usr/bin/git" }],
    ["an environment", { env: { GIT_DIR: "/elsewhere" } }],
    ["a filesystem adapter", { fs: {} }],
    ["a config", { explicitConfig: { configVersion: 1, assignments: [] } }],
    ["modulePaths", { modulePaths: ["a.test.mjs"] }],
    ["a content view", { view: {} }],
    ["a snapshot", { snapshot: {} }],
    ["a hook", { onPair: () => {} }],
  ]) {
    const error = refused(() => matchBaseHeadDeclarations(Object.freeze({ ...good, ...extra })), label, "E_API_ARGUMENTS");
    assert.deepStrictEqual(error.detail.undeclared, Object.keys(extra), label);
  }

  for (const [label, value] of [["null", null], ["a number", 7], ["a string", "preimage"], ["an array", Object.freeze([])]]) {
    let error = null;
    try { matchBaseHeadDeclarations(value); } catch (e) { error = e; }
    assert.ok(error instanceof BaseHeadMatcherError, label);
    assert.ok(["E_PREIMAGE_SHAPE", "E_PREIMAGE_FROZEN"].includes(error.code), `${label}: ${error.code}`);
  }
});

// --- the synthetic shape is the genuine one, and the gate is still shut ----------------------------------

test("the matcher consumes a preimage the real producer built, unmodified", async () => {
  // The synthetic fixtures above are only trustworthy if the real §11b.10b output is accepted by the
  // same code path. This builds one for real and matches base against head.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctide-matcher-"));
  try {
    const git = (...args) => cp.execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    const write = (rel, body) => {
      const file = path.join(dir, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, body, "utf8");
    };
    git("init", "-q", "--initial-branch=main");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "t");
    git("config", "commit.gpgsign", "false");
    write("package.json", '{"type":"module"}\n');
    write("old/moved.test.mjs", 'import { test } from "node:test";\ntest("travels", () => {});\n');
    write("kept.test.mjs", 'import { test } from "node:test";\ntest("stays", () => {});\n');
    write("gone.test.mjs", 'import { test } from "node:test";\ntest("removed", () => {});\n');
    git("add", "-A");
    git("commit", "-qm", "base");
    const baseTreeOid = git("rev-parse", "HEAD^{tree}");

    // The head deletes and moves but adds nothing, so the residual is one-sided (base only) and
    // this stays a legal success case under v1.13's rule 3. Adding a file here as well would make
    // it a two-sided residual, which AC167 (8) covers as a refusal instead.
    fs.rmSync(path.join(dir, "old/moved.test.mjs"));
    fs.rmSync(path.join(dir, "gone.test.mjs"));
    write("new/moved.test.mjs", 'import { test } from "node:test";\ntest("travels", () => {});\n');
    git("add", "-A");
    git("commit", "-qm", "head");

    const preimage = await buildDiscoveryAnalysisPreimage({ repoRoot: dir, baseTreeOid });
    const before = JSON.stringify(preimage);
    const result = matchBaseHeadDeclarations(preimage);
    assert.strictEqual(JSON.stringify(preimage), before, "the producer's output is not modified");

    assert.deepStrictEqual(result.map((r) => [r.relation, r.base && r.base.path, r.head && r.head.path]), [
      ["deleted", "gone.test.mjs", null],
      ["same-path", "kept.test.mjs", "kept.test.mjs"],
      ["moved", "old/moved.test.mjs", "new/moved.test.mjs"],
    ]);
    // The moved pair carries both bodies, and they are equal because only the path changed.
    const moved = result.find((r) => r.relation === "moved");
    assert.strictEqual(moved.base.bodyDigest, moved.head.bodyDigest);
    assert.strictEqual(moved.base.structuralId, moved.head.structuralId);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the product gate is untouched: a v2 envelope is still refused at the product entry point", () => {
  // This component is not wired into the product entry point, and nothing here lifts the rollout
  // gate. Asserted rather than asserted-about.
  //
  // The envelope below is CANONICALLY VALID -- its digest is computed with the reader's own exported
  // helper -- because parseInventory validates the document fully before it reaches the gate. A
  // hand-made malformed envelope would stop on its own shape error and would prove nothing about the
  // gate at all.
  const body = {
    inventoryVersion: 2,
    baseTreeOid: OID,
    registryDigest: REGISTRY_DIGEST,
    headViewDigest: HEAD_VIEW_DIGEST,
    inputProvenanceStoreDigest: digest("9"),
    entries: [],
  };
  const envelope = canonicalJson({ ...body, inventoryDigest: computeInventoryV2Digest(body) });
  let error = null;
  try { parseInventory(envelope); } catch (e) { error = e; }
  assert.ok(error, "a v2 envelope must still be refused at the product entry point");
  // The reader carries this refusal in its message rather than a code; that is its existing accepted
  // behaviour and nothing in this round changes it.
  assert.ok(error.message.startsWith(UNSUPPORTED_POPULATED), error.message);
  assert.match(error.message, /the base\/head one-to-one matcher/,
    "the gate still names the matcher among what is missing, because a pairing component is not a producer");
});

// ---------------------------------------------------------------------------------------------
// AC167: the residual-side exclusivity matrix, one executable case per numbered row.
// ---------------------------------------------------------------------------------------------
//
// Every row below is its own test so it is identifiable in TAP. Rows 3-8 are the ones the matcher
// as committed at 898f81c got wrong: it returned added + deleted where §6 rule 3 now refuses.

const T = { clauseRef: "REQ-01ARZ3NDEKTSV4RRFFQ69G5FAV" };

// Shared assertions for every two-sided-residual refusal.
function refusedAsDrift(baseSpec, headSpec, what, counts) {
  let error = null;
  let value = "NOT-ASSIGNED";
  try { value = matchBaseHeadDeclarations(preimageOf(baseSpec, headSpec)); } catch (e) { error = e; }
  assert.strictEqual(value, "NOT-ASSIGNED", what + ": nothing may be returned");
  assert.ok(error instanceof BaseHeadMatcherError, what + ": " + (error && error.name));
  assert.strictEqual(error.code, "E_UNRESOLVED_IDENTITY_DRIFT", what + ": " + error.code + " -- " + error.message);
  assert.ok(error.message.includes("unresolved-identity-drift"), what + ": the literal token is in the message");
  // Not an ordinary ambiguity: that has its own code and its own meaning.
  assert.notStrictEqual(error.code, "E_AMBIGUOUS_MATCH", what);
  // The detail is diagnostics only. No pairing, no partial result, no invented alias.
  assert.deepStrictEqual(Object.keys(error.detail).sort(),
    ["baseResidual", "baseResidualCount", "headResidual", "headResidualCount"], what + ": detail keys");
  assert.strictEqual(error.detail.baseResidualCount, counts[0], what);
  assert.strictEqual(error.detail.headResidualCount, counts[1], what);
  const asText = JSON.stringify(error.detail);
  for (const forbidden of ["relation", "same-path", "moved", "added", "deleted", "status", "reason", "alias"]) {
    assert.ok(!asText.includes(forbidden), what + ": detail must not carry " + forbidden);
  }
  for (const side of [...error.detail.baseResidual, ...error.detail.headResidual]) {
    assert.deepStrictEqual(Object.keys(side).sort(), ["adapterId", "path", "structuralId"], what + ": residual entry shape");
  }
  return error;
}

test("AC167 (1) residual only on the head side -- every one is added", () => {
  const result = matchBaseHeadDeclarations(preimageOf(
    [{ path: "kept.test.mjs", structuralId: 's:["k"]' }],
    [
      { path: "kept.test.mjs", structuralId: 's:["k"]' },
      { path: "a/new.test.mjs", structuralId: 's:["n1"]' },
      { path: "b/new.test.mjs", structuralId: 's:["n2"]' },
    ],
  ));
  assert.deepStrictEqual(shapeOf(result), [
    ["added", null, "a/new.test.mjs", 's:["n1"]'],
    ["added", null, "b/new.test.mjs", 's:["n2"]'],
    ["same-path", "kept.test.mjs", "kept.test.mjs", 's:["k"]'],
  ]);
});

test("AC167 (2) residual only on the base side -- every one is deleted", () => {
  const result = matchBaseHeadDeclarations(preimageOf(
    [
      { path: "kept.test.mjs", structuralId: 's:["k"]' },
      { path: "a/gone.test.mjs", structuralId: 's:["g1"]' },
      { path: "b/gone.test.mjs", structuralId: 's:["g2"]' },
    ],
    [{ path: "kept.test.mjs", structuralId: 's:["k"]' }],
  ));
  assert.deepStrictEqual(shapeOf(result), [
    ["deleted", "a/gone.test.mjs", null, 's:["g1"]'],
    ["deleted", "b/gone.test.mjs", null, 's:["g2"]'],
    ["same-path", "kept.test.mjs", "kept.test.mjs", 's:["k"]'],
  ]);
});

test("AC167 (3) same path, identical tag and bodyDigest, different s: structuralId -- fail-closed", () => {
  // The container rename that started all of this: the same test, and the model must not call it a
  // delete plus an add.
  refusedAsDrift(
    [{ path: "a.test.mjs", structuralId: 's:["old-container","same-test"]', bodyDigest: digest("1"), tag: T }],
    [{ path: "a.test.mjs", structuralId: 's:["new-container","same-test"]', bodyDigest: digest("1"), tag: T }],
    "AC167 (3)", [1, 1]);
});

test("AC167 (4) different path, identical tag and bodyDigest, different structuralId -- fail-closed", () => {
  refusedAsDrift(
    [{ path: "old/a.test.mjs", structuralId: 's:["old-container","n"]', bodyDigest: digest("1"), tag: T }],
    [{ path: "new/a.test.mjs", structuralId: 's:["new-container","n"]', bodyDigest: digest("1"), tag: T }],
    "AC167 (4)", [1, 1]);
});

test("AC167 (5) same path, tag AND bodyDigest also changed, different structuralId -- still fail-closed", () => {
  // Compound payload-irrelevance stress against (3): both tag and bodyDigest change.
  // Neither payload signal may be used to guess identity.
  refusedAsDrift(
    [{ path: "a.test.mjs", structuralId: 's:["old-container","n"]', bodyDigest: digest("1"), tag: { clauseRef: "REQ-1" } }],
    [{ path: "a.test.mjs", structuralId: 's:["new-container","n"]', bodyDigest: digest("2"), tag: { clauseRef: "REQ-2" } }],
    "AC167 (5)", [1, 1]);
});

test("AC167 (6) exactly one base residual and one head residual that look like a genuine delete + add -- fail-closed", () => {
  // Nothing about these two suggests they are related, and that is the point: 1:1 is not evidence.
  refusedAsDrift(
    [{ path: "gone.test.mjs", structuralId: 's:["totally-unrelated-old"]', bodyDigest: digest("1") }],
    [{ path: "fresh.test.mjs", structuralId: 's:["totally-unrelated-new"]', bodyDigest: digest("2") }],
    "AC167 (6)", [1, 1]);
});

test("AC167 (7) several residuals on each side -- fail-closed", () => {
  refusedAsDrift(
    [
      { path: "a/gone.test.mjs", structuralId: 's:["g1"]' },
      { path: "b/gone.test.mjs", structuralId: 's:["g2"]' },
      { path: "c/gone.test.mjs", structuralId: 's:["g3"]' },
    ],
    [
      { path: "x/new.test.mjs", structuralId: 's:["n1"]' },
      { path: "y/new.test.mjs", structuralId: 's:["n2"]' },
    ],
    "AC167 (7)", [3, 2]);
});

test("AC167 (8) successful exact and moved pairs alongside two-sided residual -- the WHOLE run fails, no partial result", () => {
  // This is the case that most tempts a partial answer: two pairs are already established and only
  // the leftovers are unresolvable. §6 says the whole operation refuses; the pairs must not escape.
  const error = refusedAsDrift(
    [
      { path: "kept.test.mjs", structuralId: 's:["k"]' },
      { path: "old/m.test.mjs", structuralId: 's:["m"]' },
      { path: "a.test.mjs", structuralId: 's:["old-container","n"]' },
    ],
    [
      { path: "kept.test.mjs", structuralId: 's:["k"]' },
      { path: "new/m.test.mjs", structuralId: 's:["m"]' },
      { path: "a.test.mjs", structuralId: 's:["new-container","n"]' },
    ],
    "AC167 (8)", [1, 1]);
  // The established pairs appear nowhere in what came back.
  const asText = JSON.stringify(error.detail);
  assert.ok(!asText.includes("kept.test.mjs"), "the exact pair is not leaked into the detail");
  assert.ok(!asText.includes("old/m.test.mjs") && !asText.includes("new/m.test.mjs"), "the moved pair is not leaked either");
  assert.deepStrictEqual(error.detail.baseResidual.map((l) => l.path), ["a.test.mjs"]);
  assert.deepStrictEqual(error.detail.headResidual.map((l) => l.path), ["a.test.mjs"]);
});

test("AC167 (9) the same tid: once per side at the same path -- a legal exact pair", () => {
  const result = matchBaseHeadDeclarations(preimageOf(
    [{ path: "a.test.mjs", structuralId: "tid:alpha", bodyDigest: digest("1") }],
    [{ path: "a.test.mjs", structuralId: "tid:alpha", bodyDigest: digest("2") }],
  ));
  assert.deepStrictEqual(shapeOf(result), [["same-path", "a.test.mjs", "a.test.mjs", "tid:alpha"]]);
});

test("AC167 (10) the same tid: once per side at different paths -- a legal moved pair", () => {
  const result = matchBaseHeadDeclarations(preimageOf(
    [{ path: "old/a.test.mjs", structuralId: "tid:alpha" }],
    [{ path: "new/a.test.mjs", structuralId: "tid:alpha" }],
  ));
  assert.deepStrictEqual(shapeOf(result), [["moved", "old/a.test.mjs", "new/a.test.mjs", "tid:alpha"]]);
});

test("AC167 (11) base is s:, head adds tid: for the first time -- fail-closed, never adopted", () => {
  // Everything a bridge could have been built from is identical here -- path, tag, bodyDigest -- and
  // none of it may build one. §11b.8b keeps @tid out of bodyDigest and the preimage carries no
  // alias, so a head-only tid: cannot show which base declaration it is.
  const error = refusedAsDrift(
    [{ path: "a.test.mjs", structuralId: 's:["c","n"]', bodyDigest: digest("1"), tag: T }],
    [{ path: "a.test.mjs", structuralId: "tid:alpha", bodyDigest: digest("1"), tag: T }],
    "AC167 (11)", [1, 1]);
  assert.deepStrictEqual(error.detail.baseResidual[0].structuralId, 's:["c","n"]');
  assert.deepStrictEqual(error.detail.headResidual[0].structuralId, "tid:alpha");
});

test("AC167 (12) tid: already on BOTH sides survives a container rename underneath it", () => {
  // The rescue §2 promises, with its exact precondition met: the identity was already established in
  // base. The container name is not part of a tid: key, so the rename does not move it.
  const result = matchBaseHeadDeclarations(preimageOf(
    [{ path: "a.test.mjs", structuralId: "tid:alpha", bodyDigest: digest("1"), tag: T }],
    [{ path: "a.test.mjs", structuralId: "tid:alpha", bodyDigest: digest("2"), tag: T }],
  ));
  assert.deepStrictEqual(shapeOf(result), [["same-path", "a.test.mjs", "a.test.mjs", "tid:alpha"]]);
  assert.notStrictEqual(result[0].base.bodyDigest, result[0].head.bodyDigest);
});

test("AC167 (13) a genuine delete + add is reachable by splitting it into two runs", () => {
  // Illegal in one run...
  const b0 = [
    { path: "kept.test.mjs", structuralId: 's:["k"]' },
    { path: "gone.test.mjs", structuralId: 's:["g"]' },
  ];
  const h2 = [
    { path: "kept.test.mjs", structuralId: 's:["k"]' },
    { path: "fresh.test.mjs", structuralId: 's:["f"]' },
  ];
  refusedAsDrift(b0, h2, "AC167 (13) both at once", [1, 1]);

  // ...and reachable as two runs bounded by different bases. Run 1 removes, run 2 adds, and the
  // intermediate state is the new base.
  const intermediate = [{ path: "kept.test.mjs", structuralId: 's:["k"]' }];
  const run1 = matchBaseHeadDeclarations(preimageOf(b0, intermediate));
  assert.deepStrictEqual(shapeOf(run1), [
    ["deleted", "gone.test.mjs", null, 's:["g"]'],
    ["same-path", "kept.test.mjs", "kept.test.mjs", 's:["k"]'],
  ]);
  const run2 = matchBaseHeadDeclarations(preimageOf(intermediate, h2));
  assert.deepStrictEqual(shapeOf(run2), [
    ["added", null, "fresh.test.mjs", 's:["f"]'],
    ["same-path", "kept.test.mjs", "kept.test.mjs", 's:["k"]'],
  ]);
});

test("AC167 (14) no fail-closed path emits a partial matching result, whatever the reason", () => {
  // Every refusal this component can raise, checked for the same property: the call produces no
  // value, and nothing that came back looks like a pairing record.
  const cases = [
    ["two-sided residual", () => matchBaseHeadDeclarations(preimageOf(
      [{ path: "a.test.mjs", structuralId: 's:["x"]' }, { path: "keep.test.mjs", structuralId: 's:["k"]' }],
      [{ path: "b.test.mjs", structuralId: 's:["y"]' }, { path: "keep.test.mjs", structuralId: 's:["k"]' }]))],
    ["ambiguous move", () => matchBaseHeadDeclarations(preimageOf(
      [{ path: "a/x.test.mjs", structuralId: 's:["n"]' }],
      [{ path: "b/x.test.mjs", structuralId: 's:["n"]' }, { path: "c/x.test.mjs", structuralId: 's:["n"]' }]))],
    ["duplicate stable ID", () => matchBaseHeadDeclarations(preimageOf(
      [{ path: "a.test.mjs", structuralId: "tid:dup" }, { path: "b.test.mjs", structuralId: "tid:dup" }],
      [{ path: "a.test.mjs", structuralId: "tid:dup" }]))],
    ["pair identity disagreement", () => matchBaseHeadDeclarations(preimageOf(
      [{ path: "a.test.mjs", structuralId: 's:["n"]' }],
      [{ path: "a.test.mjs", structuralId: 's:["n"]', framework: "some-other-framework" }]))],
  ];
  for (const [label, run] of cases) {
    let error = null;
    let value = "NOT-ASSIGNED";
    try { value = run(); } catch (e) { error = e; }
    assert.strictEqual(value, "NOT-ASSIGNED", label + ": no value may be returned");
    assert.ok(error instanceof BaseHeadMatcherError, label);
    assert.ok(!Array.isArray(error), label);
    // The error itself must carry no partial-result carrier.
    for (const key of ["relation", "base", "head", "pairs", "result", "entries"]) {
      assert.strictEqual(error[key], undefined, label + ": the error must not carry " + key);
    }
    // What AC167 forbids is a partial MATCHING or inventory result, not the word "relation" in a
    // diagnostic. E_PAIR_IDENTITY has always named the pairing it was attempting, alongside the two
    // disagreeing VALUES -- that is context about what failed, not a pair that escaped -- so no
    // generic ban on the word is asserted here. The detail simply may not be a result list, and the
    // exact shape of that error's carrier is pinned by its own regression test below.
    if (error.detail !== undefined) {
      assert.strictEqual(Array.isArray(error.detail), false, label + ": the detail is not a result list");
    }
    // The drift refusal keeps the stricter contract: its detail is exactly the residual diagnostics.
    if (error.code === "E_UNRESOLVED_IDENTITY_DRIFT") {
      assert.deepStrictEqual(Object.keys(error.detail).sort(),
        ["baseResidual", "baseResidualCount", "headResidual", "headResidualCount"], label);
      const asText = JSON.stringify(error.detail);
      for (const forbidden of ["relation", "same-path", "moved", "added", "deleted", "status", "reason", "alias"]) {
        assert.ok(!asText.includes(forbidden), label + ": drift detail must not carry " + forbidden);
      }
    }
  }
});

test("E_PAIR_IDENTITY keeps the exact carrier it has always had (regression against 5d169b1)", () => {
  // a3ad6dd renamed this error's detail key from `relation` to `phase` and split base/head into
  // baseValue/headValue. That was out of scope: the identity-disagreement carrier is not what §6
  // rule 3 changed, and consumers read these fields. Both spellings are pinned here so the shape
  // cannot drift again as a side effect of some later change.
  const same = refused(() => matchBaseHeadDeclarations(preimageOf(
    [{ path: "a.test.mjs", structuralId: 's:["n"]' }],
    [{ path: "a.test.mjs", structuralId: 's:["n"]', framework: "some-other-framework" }],
  )), "same-path adapter/framework disagreement", "E_PAIR_IDENTITY");
  assert.deepStrictEqual(same.detail, {
    relation: "same-path",
    field: "framework",
    structuralId: 's:["n"]',
    base: "node:test",
    head: "some-other-framework",
  });
  assert.match(same.message, /^a potential same-path pair for /);

  const moved = refused(() => matchBaseHeadDeclarations(preimageOf(
    [{ path: "old/a.test.mjs", structuralId: 's:["n"]' }],
    [{ path: "new/a.test.mjs", structuralId: 's:["n"]', adapterId: "other-adapter" }],
  )), "moved adapterId disagreement", "E_PAIR_IDENTITY");
  assert.deepStrictEqual(moved.detail, {
    relation: "moved",
    field: "adapterId",
    structuralId: 's:["n"]',
    base: "node-test",
    head: "other-adapter",
  });
  assert.match(moved.message, /^a potential moved pair for /);

  // The implementationIdentity branch carries three keys and no values, also unchanged.
  const identity = refused(() => matchBaseHeadDeclarations(preimageOf(
    [{ path: "a.test.mjs", structuralId: 's:["n"]' }],
    [{ path: "a.test.mjs", structuralId: 's:["n"]', implementationIdentity: { ...IDENTITY, parserVersion: "9.0.0" } }],
  )), "implementationIdentity disagreement", "E_PAIR_IDENTITY");
  assert.deepStrictEqual(identity.detail, {
    relation: "same-path",
    field: "implementationIdentity.parserVersion",
    structuralId: 's:["n"]',
  });
});
