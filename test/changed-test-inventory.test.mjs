// The canonical ChangedTestInventoryV2 reader, driven through the REAL exports rather than through a
// copy of the validator. Every fixture is built here from the approved grammars; none of it is
// derived by asking the implementation what it accepts.
//
// Spec anchors:
//   SM = docs/superpowers/specs/2026-07-25-shared-decision-provenance-model.md (approved v1.14)
//        -- the seven-field root, the single inventoryDigest formula, the OID and digest carrier
//           grammars, the repository-semantic boundary, the raw JSON duplicate-member contract
//   TP = docs/superpowers/specs/2026-07-25-test-provenance-spec.md (approved v1.10)
//        -- section 2 entry source-key ordering and the canonical tag grammar, section 6 entry exact
//           schema and invariants, 11b identity/path/structuralId authority, AC116, AC126, AC155-158
//   IS = docs/superpowers/specs/2026-07-25-intent-scan-spec.md (approved v1.10) section 8 -- ULID
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { root } from "./helpers.mjs";
import { canonicalJson, compareCodePoint, sha256Hex } from "../cressetide/skills/vigil/scripts/provenance-store.mjs";
import {
  V2_INVENTORY_KEYS, computeInventoryV2Digest, parseCanonicalInventoryV2,
  computeInventoryDigest, parseInventory, UNSUPPORTED_POPULATED,
} from "../cressetide/skills/vigil/scripts/changed-test-inventory.mjs";

const MODULE = path.join(root, "cressetide", "skills", "vigil", "scripts", "changed-test-inventory.mjs");

// --- canonical material -------------------------------------------------------------------------
// The two legal OID widths, four distinct digests so a swapped field is visible, and the two extreme
// canonical ULIDs from IS section 8 (lowest value, and the largest that still fits 128 bits).

const OID40 = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const OID64 = `${OID40}${"9f8e7d6c5b4a39281706f5e4d3c2b1a0".repeat(1).slice(0, 24)}`;
const DIG_REGISTRY = sha256Hex("registry");
const DIG_HEAD = sha256Hex("head-view");
const DIG_STORE = sha256Hex("input-store");
const BODY_BASE = sha256Hex("base-body");
const BODY_HEAD = sha256Hex("head-body");
const ULID_LOW = "00000000000000000000000000";
const ULID_HIGH = "7ZZZZZZZZZZZZZZZZZZZZZZZZZ";
const REQ = `REQ-${ULID_LOW}`;
const DEC = `DEC-${ULID_HIGH}`;
const DP = `DP-${ULID_HIGH}`;
const IDENTITY = { implementationId: "node-test-v1", parserId: "acorn", parserVersion: "8.18.0" };

assert.strictEqual(OID64.length, 64, "the 64-hex fixture really is 64 characters");

// --- fixture builders ---------------------------------------------------------------------------
// Documents are emitted by hand rather than by JSON.stringify, because member ORDER and raw member
// SPELLING are part of what is under test. Values still round-trip through the real formula.

const sorted = (keys) => keys.slice().sort(compareCodePoint);

function objectText(obj, order = null) {
  const keys = order ?? sorted(Object.keys(obj));
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

function entryText(entry, { order = null, nested = {} } = {}) {
  const keys = order ?? sorted(Object.keys(entry));
  const members = keys.map((k) => {
    const value = entry[k];
    const text = nested[k] !== undefined ? objectText(value, nested[k]) : canonicalJson(value);
    return `${JSON.stringify(k)}:${text}`;
  });
  return `{${members.join(",")}}`;
}

// A sealed envelope: the six preimage fields plus the digest the single formula produces for them.
function seal(over = {}) {
  const body = {
    inventoryVersion: 2,
    baseTreeOid: OID40,
    registryDigest: DIG_REGISTRY,
    headViewDigest: DIG_HEAD,
    inputProvenanceStoreDigest: DIG_STORE,
    entries: [],
    ...over,
  };
  return { ...body, inventoryDigest: computeInventoryV2Digest(body) };
}

// The document text. `entryTexts` replaces the entries array verbatim so an entry can be written
// with a chosen member order or raw spelling while the digest still matches the parsed VALUE.
function docText(env, { entryTexts = null, rootOrder = null, gap = "", extraRoot = null } = {}) {
  const member = {
    inventoryVersion: canonicalJson(env.inventoryVersion),
    baseTreeOid: JSON.stringify(env.baseTreeOid),
    registryDigest: JSON.stringify(env.registryDigest),
    headViewDigest: JSON.stringify(env.headViewDigest),
    inputProvenanceStoreDigest: JSON.stringify(env.inputProvenanceStoreDigest),
    entries: entryTexts !== null ? `[${entryTexts.join(`,${gap}`)}]` : canonicalJson(env.entries),
    inventoryDigest: JSON.stringify(env.inventoryDigest),
  };
  const order = rootOrder ?? sorted(V2_INVENTORY_KEYS);
  const members = order.map((k) => `${JSON.stringify(k)}:${gap}${member[k]}`);
  if (extraRoot !== null) members.push(extraRoot);
  return `{${gap}${members.join(`,${gap}`)}${gap}}`;
}

// A syntactically complete section 6 entry for the given status, so every negative below fails for
// the ONE variable it changes rather than for a shape fault it dragged along.
function entry(over = {}) {
  const status = over.status ?? "modified";
  const built = {
    testRef: { path: "test/a.test.mjs", adapterId: "node-test", structuralId: "s:[\"a\"]" },
    status,
    reason: status === "governance-affected" ? "governance-affected" : "content-change",
    tagBefore: status === "added" ? null : { clauseRef: REQ },
    tagAfter: status === "deleted" ? null : { clauseRef: REQ },
    framework: "node:test",
    implementationIdentity: { ...IDENTITY },
  };
  if (status !== "added") built.baseBodyDigest = status === "governance-affected" ? BODY_BASE : BODY_BASE;
  if (status !== "deleted") built.headBodyDigest = status === "governance-affected" ? BODY_BASE : BODY_HEAD;
  return { ...built, ...over };
}

function withEntries(entries, options = {}) {
  return docText(seal({ entries }), options);
}

function drop(obj, key) {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}

// --- assertions ----------------------------------------------------------------------------------

function accepted(text, what) {
  let value;
  try {
    value = parseCanonicalInventoryV2(text);
  } catch (e) {
    assert.fail(`${what}: expected acceptance, got ${e && e.code} ${e && e.message}`);
  }
  assert.ok(value !== null && typeof value === "object", `${what}: a parsed value comes back`);
  return value;
}

function refused(text, what, code = null) {
  let err = null;
  try { parseCanonicalInventoryV2(text); } catch (e) { err = e; }
  assert.ok(err, `${what}: must be refused`);
  assert.strictEqual(err.name, "InventoryError", `${what}: refused as an InventoryError`);
  if (code !== null) assert.strictEqual(err.code, code, `${what}: refused with code ${code}, got ${err.code} (${err.message})`);
  return err;
}

// =================================================================================================
// POSITIVES
// =================================================================================================

test("SM v1.14: an empty v2 envelope is accepted at both legal OID widths", () => {
  for (const [oid, label] of [[OID40, "40-hex SHA-1 object format"], [OID64, "64-hex SHA-256 object format"]]) {
    const env = seal({ baseTreeOid: oid });
    const value = accepted(docText(env), `empty v2 with a ${label} baseTreeOid`);
    assert.strictEqual(value.baseTreeOid, oid);
    assert.deepStrictEqual(value.entries, []);
    assert.strictEqual(value.inventoryDigest, computeInventoryV2Digest(env));
  }
});

test("TP AC155 positives: every status carries exactly the body digests its status allows", () => {
  const added = entry({ status: "added" });
  assert.ok(!Object.prototype.hasOwnProperty.call(added, "baseBodyDigest"), "added carries no baseBodyDigest KEY");
  const a = accepted(withEntries([added]), "status=added");
  assert.strictEqual(a.entries[0].tagBefore, null, "added has tagBefore == null");
  assert.strictEqual("baseBodyDigest" in a.entries[0], false, "and the absent key is still absent after parsing");

  const deleted = entry({ status: "deleted" });
  assert.ok(!Object.prototype.hasOwnProperty.call(deleted, "headBodyDigest"), "deleted carries no headBodyDigest KEY");
  const d = accepted(withEntries([deleted]), "status=deleted");
  assert.strictEqual(d.entries[0].tagAfter, null, "deleted has tagAfter == null");

  for (const status of ["modified", "retagged", "moved"]) {
    const value = accepted(withEntries([entry({ status })]), `status=${status}`);
    assert.strictEqual(value.entries[0].baseBodyDigest, BODY_BASE, `${status} keeps baseBodyDigest`);
    assert.strictEqual(value.entries[0].headBodyDigest, BODY_HEAD, `${status} keeps headBodyDigest`);
  }

  const governed = accepted(withEntries([entry({ status: "governance-affected" })]), "status=governance-affected");
  const g = governed.entries[0];
  assert.strictEqual(g.reason, "governance-affected");
  assert.deepStrictEqual(g.tagBefore, g.tagAfter, "body and binding are unchanged, which is the whole point");
  assert.strictEqual(g.baseBodyDigest, g.headBodyDigest);
});

test("TP section 2: a bare clause tag, an exception-backed REQ@DP and EXPL are each accepted", () => {
  const bare = accepted(withEntries([entry({ tagBefore: { clauseRef: REQ }, tagAfter: { clauseRef: DEC } })]), "clauseRef without DP");
  assert.strictEqual(bare.entries[0].tagAfter.clauseRef, DEC, "DEC without a qualifier is a legal binding");

  const qualified = accepted(withEntries([entry({ tagAfter: { clauseRef: REQ, dpRef: DP } })]), "REQ@DP");
  assert.strictEqual(qualified.entries[0].tagAfter.dpRef, DP,
    "accepted LEXICALLY -- whether that REQ is genuinely exception-backed needs a captured store pre-state");

  const expl = accepted(withEntries([entry({ tagAfter: { expl: true } })]), "EXPL");
  assert.strictEqual(expl.entries[0].tagAfter.expl, true);
});

test("TP v1.10: a canonical entry subtree and several entries in ascending tuple order are accepted", () => {
  const one = entry({ testRef: { path: "test/a.test.mjs", adapterId: "node-test", structuralId: "s:[\"a\"]" } });
  const two = entry({ testRef: { path: "test/a.test.mjs", adapterId: "node-test", structuralId: "tid:case-2" } });
  const three = entry({ testRef: { path: "test/b.test.mjs", adapterId: "node-test", structuralId: "s:[\"outer\",\"b\"]" } });
  // (path, adapterId, structuralId): "test/a…"+"s:[\"a\"]" < "test/a…"+"tid:case-2" < "test/b…"
  const value = accepted(withEntries([one, two, three]), "three entries in canonical tuple order");
  assert.strictEqual(value.entries.length, 3);
  assert.strictEqual(value.entries[1].testRef.structuralId, "tid:case-2", "the 11b.7 tid: form is a legal structuralId");
});

test("SM v1.14: root member order and JSON whitespace are not rejection reasons on their own", () => {
  const env = seal({ entries: [entry()] });
  const reversed = sorted(V2_INVENTORY_KEYS).slice().reverse();
  const a = accepted(docText(env, { rootOrder: reversed }), "root members in reverse declaration order");
  const b = accepted(docText(env, { gap: "\n  " }), "the same document with whitespace between every token");
  assert.deepStrictEqual(a, b, "both read to the same value");
  assert.strictEqual(a.inventoryDigest, env.inventoryDigest, "and to the same digest, which is computed over the value");
});

test("TP v1.10: an escaped member-name spelling is accepted when it is neither a duplicate nor out of order", () => {
  const e = entry();
  // testRef's members are adapterId, path, structuralId. Writing "path" as "\u0070ath" changes the
  // raw bytes, not the DECODED name, so the order is still strictly ascending and nothing collides.
  const escaped = `{"adapterId":${JSON.stringify(e.testRef.adapterId)},"\\u0070ath":${JSON.stringify(e.testRef.path)},`
    + `"structuralId":${JSON.stringify(e.testRef.structuralId)}}`;
  const keys = sorted(Object.keys(e));
  const text = `{${keys.map((k) => `${JSON.stringify(k)}:${k === "testRef" ? escaped : canonicalJson(e[k])}`).join(",")}}`;
  const value = accepted(withEntries([e], { entryTexts: [text] }), "\\u0070ath in place of path");
  assert.strictEqual(value.entries[0].testRef.path, e.testRef.path, "and it decodes to the same member");
});

test("SM v1.14: the inventoryDigest is genuinely recomputed, not read back", () => {
  const env = seal({ entries: [entry()] });
  const value = accepted(docText(env), "a sealed populated envelope");
  assert.strictEqual(value.inventoryDigest, computeInventoryV2Digest(env), "the declared digest equals the formula");

  // every preimage field really participates: change one, keep the old digest, and it must be caught
  for (const field of ["inventoryVersion", "baseTreeOid", "registryDigest", "headViewDigest", "inputProvenanceStoreDigest", "entries"]) {
    if (field === "inventoryVersion") continue; // its own value check fires first, covered below
    const changed = { ...env };
    changed[field] = field === "entries"
      ? [entry({ testRef: { ...entry().testRef, path: "test/z.test.mjs" } })]
      : `${"c".repeat(63)}d`;
    if (field === "baseTreeOid") changed[field] = `${"c".repeat(39)}d`;
    refused(docText(changed), `a changed ${field} with the old inventoryDigest`, "E_DIGEST");
  }

  // and the v1 formula is a DIFFERENT function that still answers for the v1 envelope
  assert.notStrictEqual(
    computeInventoryV2Digest(env), computeInventoryDigest({ baseTreeOid: env.baseTreeOid, entries: [] }),
    "the two formulas are not interchangeable");
});

test("SM v1.14: the isolated reader touches no file, and the module names no process, env or network API", () => {
  const source = fs.readFileSync(MODULE, "utf8");
  for (const forbidden of ["child_process", "node:http", "node:https", "node:net", "node:dns", "node:os",
    "process.env", "fetch(", "execFileSync", "spawnSync", "adapter-registry", "head-view-snapshot"]) {
    assert.ok(!source.includes(forbidden), `the module must not mention ${forbidden}`);
  }

  const text = withEntries([entry()]);
  const patched = ["readFileSync", "readFile", "existsSync", "openSync", "statSync", "readdirSync", "writeFileSync"];
  const saved = {};
  for (const name of patched) {
    saved[name] = fs[name];
    fs[name] = () => { throw new Error(`the isolated reader called fs.${name}`); };
  }
  try {
    const value = parseCanonicalInventoryV2(text);
    assert.strictEqual(value.entries.length, 1, "a populated document parses with every fs entry point booby-trapped");
  } finally {
    for (const name of patched) fs[name] = saved[name];
  }
  assert.strictEqual(fs.readFileSync, saved.readFileSync, "fs is restored");
});

// =================================================================================================
// AC155 -- entry exact shape and conditional body-digest presence, one variable per case
// =================================================================================================

test("TP AC155 (i)-(vi): body-digest presence is exact, and absent is not null", () => {
  const added = entry({ status: "added" });
  const deleted = entry({ status: "deleted" });
  const both = entry();

  refused(withEntries([{ ...added, baseBodyDigest: BODY_BASE }]), "(i) added carrying baseBodyDigest", "E_ENTRY_SHAPE");
  refused(withEntries([{ ...added, baseBodyDigest: null }]), "(ii) added carrying baseBodyDigest = null", "E_ENTRY_SHAPE");
  refused(withEntries([{ ...deleted, headBodyDigest: BODY_HEAD }]), "(iii) deleted carrying headBodyDigest", "E_ENTRY_SHAPE");
  refused(withEntries([{ ...deleted, headBodyDigest: null }]), "(iv) deleted carrying headBodyDigest = null", "E_ENTRY_SHAPE");
  refused(withEntries([drop(both, "baseBodyDigest")]), "(v) a required baseBodyDigest missing", "E_ENTRY_SHAPE");
  refused(withEntries([drop(both, "headBodyDigest")]), "(v) a required headBodyDigest missing", "E_ENTRY_SHAPE");
  refused(withEntries([{ ...both, baseBodyDigest: null }]), "(vi) a required baseBodyDigest = null", "E_ENTRY_FIELD");
  refused(withEntries([{ ...both, headBodyDigest: null }]), "(vi) a required headBodyDigest = null", "E_ENTRY_FIELD");
  refused(withEntries([{ ...both, baseBodyDigest: "" }]), "an empty-string body digest", "E_ENTRY_FIELD");
  refused(withEntries([{ ...both, headBodyDigest: BODY_HEAD.toUpperCase() }]), "an uppercase body digest", "E_ENTRY_FIELD");
});

test("TP AC155 (vii)-(xvi): entry and every nested object have an exact key set", () => {
  const e = entry();
  refused(withEntries([{ ...e, note: "extra" }]), "(vii) an undeclared entry key", "E_ENTRY_SHAPE");
  for (const key of ["testRef", "reason", "tagBefore", "tagAfter", "framework", "implementationIdentity"]) {
    refused(withEntries([drop(e, key)]), `(viii) a missing common key ${key}`, "E_ENTRY_SHAPE");
  }
  // status is read before the key set, because the key set is DISPATCHED on it. It is still
  // fail-closed, just named for the field that is missing rather than for the shape it would imply.
  refused(withEntries([drop(e, "status")]), "(viii) a missing status", "E_ENTRY_FIELD");

  refused(withEntries([{ ...e, testRef: { ...e.testRef, extra: 1 } }]), "(ix) testRef with an extra key", "E_ENTRY_SHAPE");
  refused(withEntries([{ ...e, testRef: drop(e.testRef, "adapterId") }]), "(x) testRef missing adapterId", "E_ENTRY_SHAPE");
  refused(withEntries([{ ...e, tagAfter: { clauseRef: REQ, dpRef: DP, extra: 1 } }]), "(xi) a clause tag with an extra key", "E_ENTRY_SHAPE");
  refused(withEntries([{ ...e, tagAfter: { dpRef: DP } }]), "(xii) a tag missing clauseRef", "E_ENTRY_SHAPE");
  refused(withEntries([{ ...e, tagAfter: { expl: true, extra: 1 } }]), "(xiii) EXPL with an extra key", "E_ENTRY_SHAPE");
  refused(withEntries([{ ...e, tagAfter: { expl: false } }]), "(xiv) expl = false", "E_ENTRY_FIELD");
  refused(withEntries([{ ...e, tagAfter: { expl: "true" } }]), "(xiv) expl = \"true\"", "E_ENTRY_FIELD");
  refused(withEntries([{ ...e, implementationIdentity: { ...IDENTITY, extra: "x" } }]), "(xv) identity with an extra key", "E_ENTRY_SHAPE");
  refused(withEntries([{ ...e, implementationIdentity: drop(IDENTITY, "parserVersion") }]), "(xvi) identity missing parserVersion", "E_ENTRY_SHAPE");
  for (const key of ["implementationId", "parserId", "parserVersion"]) {
    refused(withEntries([{ ...e, implementationIdentity: { ...IDENTITY, [key]: "" } }]), `an empty identity ${key}`, "E_ENTRY_FIELD");
  }
});

test("TP AC155 (xvii)-(xxi): the status, tag and reason invariants hold in both directions", () => {
  const added = entry({ status: "added" });
  const deleted = entry({ status: "deleted" });
  const both = entry();

  refused(withEntries([{ ...added, tagBefore: { clauseRef: REQ } }]), "(xvii) added with a non-null tagBefore", "E_ENTRY_INVARIANT");
  refused(withEntries([{ ...deleted, tagAfter: { clauseRef: REQ } }]), "(xviii) deleted with a non-null tagAfter", "E_ENTRY_INVARIANT");
  refused(withEntries([{ ...both, tagAfter: null }]), "(xix) a non-deleted entry with tagAfter = null", "E_ENTRY_INVARIANT");
  refused(withEntries([{ ...entry({ status: "governance-affected" }), reason: "content-change" }]),
    "(xx) governance-affected status with content-change reason", "E_ENTRY_INVARIANT");
  refused(withEntries([{ ...both, reason: "governance-affected" }]),
    "(xxi) modified status with governance-affected reason", "E_ENTRY_INVARIANT");

  const governed = entry({ status: "governance-affected" });
  refused(withEntries([{ ...governed, tagAfter: { clauseRef: DEC } }]),
    "governance-affected whose binding actually changed", "E_ENTRY_INVARIANT");
  refused(withEntries([{ ...governed, headBodyDigest: BODY_HEAD }]),
    "governance-affected whose body actually changed", "E_ENTRY_INVARIANT");
});

// =================================================================================================
// AC156 -- OID and digest canonical spelling
// =================================================================================================

test("TP AC156: baseTreeOid accepts exactly two widths of lowercase hex and nothing else", () => {
  for (const [bad, label] of [
    [OID40.toUpperCase(), "uppercase"],
    [OID40.slice(0, 12), "abbreviated"],
    [`${OID40.slice(0, 39)}g`, "a non-hex character"],
    [OID40.slice(0, 39), "39 characters"],
    [`${OID40}a`, "41 characters"],
    [OID64.slice(0, 63), "63 characters"],
    [`${OID64}a`, "65 characters"],
    [` ${OID40}`, "a leading space"],
    [`sha1:${OID40}`, "a prefix"],
    [42, "a number"],
  ]) {
    refused(docText(seal({ baseTreeOid: bad })), `baseTreeOid ${label}`, "E_ROOT_FIELD");
  }

  // AC156 (b): a lexical pass is a claim about SPELLING only.
  const e = refused(docText(seal({ baseTreeOid: OID40.toUpperCase() })), "the refusal explains the boundary", "E_ROOT_FIELD");
  assert.match(e.message, /does not prove the object exists/, "the message states what the grammar does NOT prove");
  const ok = accepted(docText(seal({ baseTreeOid: OID64 })), "a 64-hex OID");
  assert.strictEqual(ok.baseTreeOid, OID64,
    "accepting it is a lexical result only: this component looked up no Git object and checked no object type");
});

test("TP AC156: each digest carrier is exactly 64 lowercase hex", () => {
  for (const field of ["registryDigest", "headViewDigest", "inputProvenanceStoreDigest"]) {
    for (const [bad, label] of [
      [DIG_HEAD.toUpperCase(), "uppercase"],
      [`sha256:${DIG_HEAD}`, "a sha256: prefix"],
      [` ${DIG_HEAD}`, "a leading space"],
      [`${DIG_HEAD.slice(0, 32)} ${DIG_HEAD.slice(33)}`, "an embedded space"],
      [DIG_HEAD.slice(0, 63), "63 characters"],
      [`${DIG_HEAD}a`, "65 characters"],
      [null, "null"],
    ]) {
      refused(docText(seal({ [field]: bad })), `${field} ${label}`, "E_ROOT_FIELD");
    }
  }

  // inventoryDigest is checked for spelling too, and separately against the formula
  const env = seal({});
  refused(docText({ ...env, inventoryDigest: env.inventoryDigest.toUpperCase() }), "an uppercase inventoryDigest", "E_ROOT_FIELD");
  refused(docText({ ...env, inventoryDigest: `sha256:${env.inventoryDigest}` }), "a prefixed inventoryDigest", "E_ROOT_FIELD");
  refused(docText({ ...env, inventoryDigest: sha256Hex("some other preimage entirely") }),
    "a lexically valid inventoryDigest that is not the formula", "E_DIGEST");
});

// =================================================================================================
// AC157 -- raw duplicate members and recursive entry-key ordering
// =================================================================================================

test("TP AC157: a duplicate member name is refused wherever it appears, decoded before comparison", () => {
  const env = seal({ entries: [entry()] });

  // root
  const doubled = docText(env).replace(/^\{/, `{"entries":[],`);
  refused(doubled, "a duplicate member at the root", "E_DUPLICATE_MEMBER");

  // entry root
  const e = entry();
  const dupEntry = `${entryText(e).slice(0, -1)},"status":"added"}`;
  refused(withEntries([e], { entryTexts: [dupEntry] }), "a duplicate member in an entry", "E_DUPLICATE_MEMBER");

  // each nested object
  for (const [key, extra] of [
    ["testRef", "\"path\":\"test/other.test.mjs\""],
    ["tagAfter", "\"clauseRef\":\"REQ-0000000000000000000000000Z\""],
    ["implementationIdentity", "\"parserId\":\"other\""],
  ]) {
    const nestedText = `${objectText(e[key]).slice(0, -1)},${extra}}`;
    const keys = sorted(Object.keys(e));
    const text = `{${keys.map((k) => `${JSON.stringify(k)}:${k === key ? nestedText : canonicalJson(e[k])}`).join(",")}}`;
    refused(withEntries([e], { entryTexts: [text] }), `a duplicate member inside ${key}`, "E_DUPLICATE_MEMBER");
  }

  // raw spelling differs, decoded name is the same -- still a duplicate
  const escapedDup = `${objectText(e.testRef).slice(0, -1)},"\\u0070ath":"test/other.test.mjs"}`;
  const keys = sorted(Object.keys(e));
  const text = `{${keys.map((k) => `${JSON.stringify(k)}:${k === "testRef" ? escapedDup : canonicalJson(e[k])}`).join(",")}}`;
  const err = refused(withEntries([e], { entryTexts: [text] }), "\"path\" and \"\\u0070ath\" in one object", "E_DUPLICATE_MEMBER");
  assert.match(err.message, /DECODED/, "the refusal says the comparison is on the decoded name");

  // and the wrong reader is named: JSON.parse alone would have kept only the LAST occurrence
  assert.strictEqual(JSON.parse(`{"path":"a","\\u0070ath":"b"}`).path, "b",
    "JSON.parse is last-write-wins, which is exactly why the check cannot live after it");
});

test("TP AC157: entry and nested member order must be strictly ascending, and is never sorted for you", () => {
  const e = entry();

  const entryKeys = sorted(Object.keys(e));
  const swapped = entryKeys.slice();
  [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
  refused(withEntries([e], { entryTexts: [entryText(e, { order: swapped })] }), "entry root members out of order", "E_ORDER");
  refused(withEntries([e], { entryTexts: [entryText(e, { order: entryKeys.slice().reverse() })] }),
    "entry root members fully reversed", "E_ORDER");

  for (const key of ["testRef", "tagBefore", "tagAfter", "implementationIdentity"]) {
    const nestedOrder = sorted(Object.keys(e[key])).reverse();
    if (nestedOrder.length < 2) continue;
    refused(withEntries([e], { entryTexts: [entryText(e, { nested: { [key]: nestedOrder } })] }),
      `${key} members out of order`, "E_ORDER");
  }
  // tagBefore/tagAfter with two members, so the ordering gate has something to see there too
  const qualified = entry({ tagAfter: { clauseRef: REQ, dpRef: DP } });
  refused(withEntries([qualified], { entryTexts: [entryText(qualified, { nested: { tagAfter: ["dpRef", "clauseRef"] } })] }),
    "tagAfter members out of order", "E_ORDER");

  // the sorted-then-accept reader is what these catch: the same members in canonical order pass
  accepted(withEntries([qualified]), "the same members, canonically ordered");
});

test("TP AC157: entries[] is strictly ascending by (path, adapterId, structuralId)", () => {
  const first = entry({ testRef: { path: "test/a.test.mjs", adapterId: "node-test", structuralId: "s:[\"a\"]" } });
  const second = entry({ testRef: { path: "test/b.test.mjs", adapterId: "node-test", structuralId: "s:[\"b\"]" } });
  accepted(withEntries([first, second]), "ascending");
  refused(withEntries([second, first]), "reverse-sorted entries", "E_ORDER");
  refused(withEntries([first, first]), "a repeated (path, adapterId, structuralId) identity", "E_ORDER");

  // the tuple is compared field by field, not by a joined string
  const sameFile = entry({ testRef: { path: "test/a.test.mjs", adapterId: "node-test", structuralId: "tid:zzz" } });
  accepted(withEntries([first, sameFile]), "same path, ascending structuralId");
  refused(withEntries([sameFile, first]), "same path, descending structuralId", "E_ORDER");
});

// =================================================================================================
// Remaining boundaries: JSON, root shape, version, field grammars
// =================================================================================================

test("SM v1.14: malformed JSON and a non-object root are refused before anything else", () => {
  for (const [text, label] of [
    ["", "an empty document"],
    ["{", "an unterminated object"],
    ["{\"a\":1,}", "a trailing comma"],
    ["{'a':1}", "single-quoted names"],
    ["{\"a\":01}", "a leading zero"],
    ["{\"a\":.5}", "a bare fraction"],
    ["{\"a\":\"\\x41\"}", "an unknown escape"],
    ["{\"a\":\"\\u00zz\"}", "a bad \\u escape"],
    ["{\"a\":1} trailing", "trailing content"],
    ["[]", "an array root"],
    ["\"text\"", "a string root"],
    ["null", "a null root"],
    ["42", "a number root"],
  ]) {
    const err = refused(text, label);
    assert.ok(err.code === "E_JSON" || err.code === "E_ROOT_SHAPE", `${label}: refused as JSON or root shape, got ${err.code}`);
  }
});

test("TP AC116: the v2 root is exactly seven fields with an integer discriminator of 2", () => {
  const env = seal({});
  refused(docText(env, { extraRoot: "\"storePath\":\".ctide/provenance.json\"" }),
    "an undeclared root key", "E_ROOT_SHAPE");

  for (const key of V2_INVENTORY_KEYS) {
    const order = sorted(V2_INVENTORY_KEYS).filter((k) => k !== key);
    refused(docText(env, { rootOrder: order }), `a missing root key ${key}`, "E_ROOT_SHAPE");
  }

  for (const [version, label] of [[1, "1"], [3, "3"], ["2", "the string \"2\""], [2.5, "2.5"], [null, "null"], [true, "true"]]) {
    const bad = seal({ inventoryVersion: version });
    refused(docText(bad), `inventoryVersion ${label}`, "E_ROOT_FIELD");
  }

  // entries must be an array, not merely present
  refused(docText(seal({ entries: {} })), "entries as an object", "E_ROOT_FIELD");
  refused(docText(seal({ entries: null })), "entries as null", "E_ROOT_FIELD");
});

test("TP AC65 + 11b: path, adapterId and structuralId are held to their canonical grammars", () => {
  const e = entry();
  const withPath = (p) => withEntries([{ ...e, testRef: { ...e.testRef, path: p } }]);
  for (const [p, label] of [
    ["test\\a.test.mjs", "a backslash"],
    ["/test/a.test.mjs", "an absolute path"],
    ["./test/a.test.mjs", "a ./ dot-segment"],
    ["../test/a.test.mjs", "a ../ dot-segment"],
    ["test/./a.test.mjs", "an interior . segment"],
    ["test/../a.test.mjs", "an interior .. segment"],
    ["test//a.test.mjs", "an empty segment"],
    ["test/a.test.mjs/", "a trailing separator"],
    ["", "an empty path"],
  ]) refused(withPath(p), `path with ${label}`, "E_ENTRY_FIELD");

  for (const [id, label] of [["Node-Test", "uppercase"], ["node_test", "an underscore"], ["-node", "a leading dash"], ["", "empty"]]) {
    refused(withEntries([{ ...e, testRef: { ...e.testRef, adapterId: id } }]), `adapterId ${label}`, "E_ENTRY_FIELD");
  }

  for (const [sid, label] of [
    ["a::case", "no tid:/s: prefix"],
    ["tid:", "an empty tid"],
    ["tid:-leading-dash", "a tid starting with a dash"],
    [`tid:${"x".repeat(65)}`, "a tid over 64 characters"],
    ["s:not-json", "an s: payload that is not JSON"],
    ["s:[]", "an s: payload with no names"],
    ["s:[1]", "an s: payload of non-strings"],
    ["s:[\"a\" ]", "an s: payload that is not canonicalJson"],
  ]) refused(withEntries([{ ...e, testRef: { ...e.testRef, structuralId: sid } }]), `structuralId with ${label}`, "E_ENTRY_FIELD");

  refused(withEntries([{ ...e, framework: "" }]), "an empty framework", "E_ENTRY_FIELD");
  refused(withEntries([{ ...e, status: "renamed" }]), "an unknown status", "E_ENTRY_FIELD");
  refused(withEntries([{ ...e, reason: "refactor" }]), "an unknown reason", "E_ENTRY_FIELD");
  refused(withEntries([{ ...e, testRef: [1, 2, 3] }]), "a testRef that is an array", "E_ENTRY_SHAPE");
  refused(withEntries(["not an object"]), "an entry that is a string", "E_ENTRY_SHAPE");
});

test("TP section 2 + IS section 8: the tag grammar and the canonical ULID are enforced exactly", () => {
  const e = entry();
  const withTag = (tag) => withEntries([{ ...e, tagAfter: tag }]);

  refused(withTag({ clauseRef: DEC, dpRef: DP }), "DEC@DP", "E_ENTRY_FIELD");
  refused(withTag({ clauseRef: `ASSUM-${ULID_LOW}`, dpRef: DP }), "ASSUM@DP", "E_ENTRY_FIELD");
  accepted(withEntries([{ ...e, tagAfter: { clauseRef: REQ, dpRef: DP } }]), "REQ@DP is lexically legal");

  refused(withTag({ clauseRef: "whatever you like" }), "an arbitrary clauseRef", "E_ENTRY_FIELD");
  refused(withTag({ clauseRef: `REQ-${ULID_LOW}`, dpRef: "not a dp" }), "an arbitrary dpRef", "E_ENTRY_FIELD");
  refused(withTag({ clauseRef: "REQ-abc" }), "a prefix-only clauseRef", "E_ENTRY_FIELD");

  for (const [ulid, label] of [
    [`8${ULID_LOW.slice(1)}`, "a first byte of 8 (over 128 bits)"],
    [ULID_LOW.slice(1), "25 bytes"],
    [`${ULID_LOW}0`, "27 bytes"],
    [ULID_HIGH.toLowerCase(), "lowercase"],
    [`I${ULID_LOW.slice(1)}`, "the I alias"],
    [`0L${ULID_LOW.slice(2)}`, "the L alias"],
    [`0O${ULID_LOW.slice(2)}`, "the O alias"],
    [`0U${ULID_LOW.slice(2)}`, "the U alias"],
    [`0 ${ULID_LOW.slice(2)}`, "whitespace"],
    [`0Ω${ULID_LOW.slice(2)}`, "a non-ASCII character"],
  ]) {
    refused(withTag({ clauseRef: `REQ-${ulid}` }), `a clause ULID with ${label}`, "E_ENTRY_FIELD");
    refused(withTag({ clauseRef: REQ, dpRef: `DP-${ulid}` }), `a DP ULID with ${label}`, "E_ENTRY_FIELD");
  }
  refused(withTag({ clauseRef: `${REQ} ` }), "a trailing space after the token", "E_ENTRY_FIELD");
  refused(withTag("REQ-ok"), "a tag that is a string", "E_ENTRY_SHAPE");
  refused(withTag([{ clauseRef: REQ }]), "a tag that is an array", "E_ENTRY_SHAPE");
});

// =================================================================================================
// The two layers: the isolated reader reads it, the product entry point still refuses to act on it
// =================================================================================================

test("the isolated reader parses a populated v2 inventory that the product entry point still refuses", () => {
  const text = withEntries([entry()]);

  const read = parseCanonicalInventoryV2(text);
  assert.strictEqual(read.entries.length, 1, "the isolated component reads it completely");

  let err = null;
  try { parseInventory(text); } catch (e) { err = e; }
  assert.ok(err, "the product entry point refuses the SAME bytes");
  assert.strictEqual(err.name, "InventoryError");
  assert.match(err.message, new RegExp(UNSUPPORTED_POPULATED), "under the same stable marker as before");
  assert.match(err.message, /validated completely/, "and it says the refusal is a policy boundary, not a parse failure");
});

test("parseInventory dispatches on the envelope version and fails closed in between", () => {
  // v2, empty: accepted through the product path
  const empty = parseInventory(docText(seal({})));
  assert.strictEqual(empty.inventoryVersion, 2);
  assert.deepStrictEqual(empty.entries, []);

  // a malformed populated v2 fails for its OWN defect, not under the unsupported marker
  const broken = withEntries([{ ...entry(), status: "renamed" }]);
  let e1 = null;
  try { parseInventory(broken); } catch (e) { e1 = e; }
  assert.ok(e1 && !new RegExp(UNSUPPORTED_POPULATED).test(e1.message),
    `a malformed populated v2 must fail for the malformation, got: ${e1 && e1.message}`);
  assert.strictEqual(e1.code, "E_ENTRY_FIELD");

  // legacy v1 clean slice: still parsed, still digest-checked
  const v1Body = { baseTreeOid: OID40, entries: [] };
  const v1 = parseInventory(JSON.stringify({ ...v1Body, inventoryDigest: computeInventoryDigest(v1Body) }));
  assert.strictEqual(v1.baseTreeOid, OID40);

  // legacy v1 populated: still refused at the same boundary
  const v1Full = { baseTreeOid: OID40, entries: [entry()] };
  let e2 = null;
  try { parseInventory(JSON.stringify({ ...v1Full, inventoryDigest: computeInventoryDigest(v1Full) })); } catch (e) { e2 = e; }
  assert.ok(e2 && new RegExp(UNSUPPORTED_POPULATED).test(e2.message), "legacy populated is still fail-closed");

  // in-between shapes: a discriminator with the wrong key set, and a v2-ish shape with no discriminator
  for (const [doc, label] of [
    [JSON.stringify({ inventoryVersion: 2, baseTreeOid: OID40, entries: [], inventoryDigest: DIG_HEAD }), "a discriminator over a v1 key set"],
    [JSON.stringify({ ...seal({}), inventoryVersion: 7 }), "an unknown version alongside the v2 key set"],
    [JSON.stringify({ baseTreeOid: OID40, entries: [], inventoryDigest: DIG_HEAD, registryDigest: DIG_REGISTRY }), "a v2-ish shape with no discriminator"],
  ]) {
    let err = null;
    try { parseInventory(doc); } catch (e) { err = e; }
    assert.ok(err, `${label}: fail-closed`);
    assert.strictEqual(err.name, "InventoryError", `${label}: as an InventoryError`);
    assert.ok(!new RegExp(UNSUPPORTED_POPULATED).test(err.message), `${label}: refused for its shape, not as unsupported`);
  }
});
