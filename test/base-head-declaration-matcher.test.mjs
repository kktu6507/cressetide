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

test("§6 rule 3 head-only is added and base-only is deleted", () => {
  const result = matchBaseHeadDeclarations(preimageOf(
    [{ path: "gone.test.mjs", structuralId: 's:["g"]' }],
    [{ path: "new.test.mjs", structuralId: 's:["n"]' }],
  ));
  assert.deepStrictEqual(shapeOf(result), [
    ["deleted", "gone.test.mjs", null, 's:["g"]'],
    ["added", null, "new.test.mjs", 's:["n"]'],
  ]);
  assert.strictEqual(result[0].head, null);
  assert.strictEqual(result[1].base, null);
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
  const result = matchBaseHeadDeclarations(preimageOf(
    [{ path: "a/gone.test.mjs", structuralId: 's:["g"]' }],
    [{ path: "z/new.test.mjs", structuralId: 's:["n"]' }],
  ));
  // "a/gone" sorts before "z/new" only if the deleted record was keyed on its base path.
  assert.deepStrictEqual(result.map((r) => r.relation), ["deleted", "added"]);
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

    fs.rmSync(path.join(dir, "old/moved.test.mjs"));
    fs.rmSync(path.join(dir, "gone.test.mjs"));
    write("new/moved.test.mjs", 'import { test } from "node:test";\ntest("travels", () => {});\n');
    write("fresh.test.mjs", 'import { test } from "node:test";\ntest("brand new", () => {});\n');
    git("add", "-A");
    git("commit", "-qm", "head");

    const preimage = await buildDiscoveryAnalysisPreimage({ repoRoot: dir, baseTreeOid });
    const before = JSON.stringify(preimage);
    const result = matchBaseHeadDeclarations(preimage);
    assert.strictEqual(JSON.stringify(preimage), before, "the producer's output is not modified");

    assert.deepStrictEqual(result.map((r) => [r.relation, r.base && r.base.path, r.head && r.head.path]), [
      ["added", null, "fresh.test.mjs"],
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
