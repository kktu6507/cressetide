// The persisted provenance-batch READER: version discriminator, v2 inventorySnapshot contract,
// legacy boundary, chain monotonicity and the raw nested-inventory ingestion boundary.
//
// SCOPE. This is the reader half only: nothing in THIS file enables a writer, and a green run
// establishes AC118/AC128/AC136/AC137/AC138 not at all and does not make Phase 2 READY. (Two dated
// clauses are dropped: the unsupported-populated-inventory product gate is retired, and the v2
// writer now exists as its own accepted component with its own suite. What the tests below assert
// about legacy records is unchanged and is stated case by case.)
//
// Spec anchors (the current approved coupled set, one effective set):
//   SM = 2026-07-25-shared-decision-provenance-model.md (approved v1.15) §2 record shape,
//        the minimal authoritative envelope, the raw duplicate-member contract, the legacy boundary
//   TP = 2026-07-25-test-provenance-spec.md (approved v1.17) §2 TestSemanticReviewBatch,
//        §11b.9c, AC124, AC125, AC126, AC128
//
// EVIDENCE SHAPES. Object-level cases go through validateAll() on a parsed store. The raw cases go
// through parseStore() on ORIGINAL TEXT, because that is the only boundary where a duplicate member
// is still observable -- and one test proves that by showing the JS-object form of the same document
// is accepted, so a fixture built from an object could never have carried the negative.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";

import {
  emptyStore, canonicalStoreBytes, storeDigest, digestOf, canonicalJson, sha256Hex, parseStore,
  validateAll, validateStoreSchema, applyTransaction, indexStore, classifyBatchRecord,
  batchInventoryPreimage, BATCH_RECORD_VERSION, CANONICAL_STORE_PATH,
} from "../cressetide/skills/vigil/scripts/provenance-store.mjs";
import { computeInventoryV2Digest } from "../cressetide/skills/vigil/scripts/changed-test-inventory.mjs";

const OPTS = { now: Date.UTC(2026, 8, 5) };
const TASK = "TASK-reader";
const TREE = "a".repeat(40);
const REQ = "REQ-01J0000000000000000000000A";

function refused(fn, code, what) {
  let error = null;
  try { fn(); } catch (e) { error = e; }
  assert.ok(error, `${what}: expected a refusal, got none`);
  assert.strictEqual(error.code, code, `${what}: expected ${code}, got ${error.code} (${error.message})`);
  return error;
}

// --- fixtures -------------------------------------------------------------------------------------

// A complete, legal ChangedTestInventoryV2 with one real entry, so the entry schema, the conditional
// body-digest fields and the entry ordering rule are all actually exercised rather than skipped by
// an empty array.
function inventory(over = {}) {
  const body = {
    inventoryVersion: 2,
    baseTreeOid: TREE,
    registryDigest: "b".repeat(64),
    headViewDigest: "c".repeat(64),
    inputProvenanceStoreDigest: storeDigest(emptyStore()),
    entries: [{
      testRef: { path: "a.test.mjs", adapterId: "node-test-v2", structuralId: 's:["alpha"]' },
      status: "added",
      reason: "content-change",
      tagBefore: null,
      tagAfter: { clauseRef: REQ },
      framework: "node-test",
      implementationIdentity: { implementationId: "node-test-v2", parserId: "p", parserVersion: "1" },
      headBodyDigest: "d".repeat(64),
    }],
    ...over,
  };
  return { ...body, inventoryDigest: computeInventoryV2Digest(body) };
}

const witness = () => ({
  treeOid: TREE, storePath: CANONICAL_STORE_PATH, storeDigest: storeDigest(emptyStore()),
});

// A v1.12 legacy record: no batchRecordVersion, and the exact absence shape -- which includes the
// serialized `kind` discriminator every persisted record carries.
function legacyRecord(over = {}) {
  const snapshot = {
    taskId: TASK, baseProvenance: witness(), inventoryDigest: "inv-legacy",
    results: over.results || [], resolutions: [],
  };
  const rec = {
    recordId: "R-legacy", kind: "provenance-batch", taskId: TASK,
    inventoryDigest: "inv-legacy", batchSnapshot: snapshot, batchDigest: digestOf(snapshot),
    relatedRefs: [], previousBatchRef: null,
  };
  delete over.results;
  return { ...rec, ...over };
}

function v2Record(over = {}, mutateSnapshot) {
  const inv = over.inventorySnapshot || inventory();
  delete over.inventorySnapshot;
  const snapshot = {
    taskId: TASK, baseProvenance: witness(), inventoryDigest: inv.inventoryDigest,
    inventorySnapshot: inv, results: [], resolutions: [],
  };
  if (mutateSnapshot) mutateSnapshot(snapshot);
  const rec = {
    recordId: "R-v2", kind: "provenance-batch", batchRecordVersion: BATCH_RECORD_VERSION,
    taskId: TASK, inventoryDigest: snapshot.inventorySnapshot ? snapshot.inventorySnapshot.inventoryDigest : inv.inventoryDigest,
    batchSnapshot: snapshot, batchDigest: digestOf(snapshot), relatedRefs: [], previousBatchRef: null,
  };
  return { ...rec, ...over };
}

// A whole store around one or more batch records, with the TaskState head pointing at the tip.
function storeWith(records) {
  const s = emptyStore();
  s.records.push(...records);
  s.taskStates.push({
    taskId: TASK, baseProvenance: witness(), currentTaskDpIds: [],
    committedProvenanceBatchRef: { kind: "provenance-batch", ref: records[records.length - 1].recordId },
  });
  return s;
}

// The batchDigest covers the snapshot, so any snapshot edit has to be followed by a recompute or the
// case would stop at the wrong rule.
const reseal = (rec) => { rec.batchDigest = digestOf(rec.batchSnapshot); return rec; };

// --- 1. the v2 contract --------------------------------------------------------------------------

test("SM v1.13: a complete v2 record validates, and its record.inventoryDigest is DERIVED", () => {
  const store = storeWith([v2Record()]);
  assert.ok(validateAll(store, OPTS).ok, "the positive control must load");
  assert.ok(validateStoreSchema(store).ok, "and the clock-free entry point agrees");

  const rec = indexStore(store).records.get("R-v2");
  assert.deepStrictEqual(classifyBatchRecord(rec), { ok: true, version: 2 });
  assert.strictEqual(rec.inventoryDigest, rec.batchSnapshot.inventorySnapshot.inventoryDigest);
});

test("AC128 (ii): an unknown, fractional, null or string batchRecordVersion is refused, never read as legacy", () => {
  for (const version of [3, 2.5, null, "2", 0, -2]) {
    const store = storeWith([reseal(v2Record({ batchRecordVersion: version }))]);
    const e = refused(() => validateAll(store, OPTS), "E_BATCH_VERSION", `version ${JSON.stringify(version)}`);
    assert.match(e.message, /refused rather than read as legacy/);
  }
});

test("AC128 (i): batchRecordVersion 2 without an inventorySnapshot fails closed, with no legacy fallback", () => {
  const store = storeWith([reseal(v2Record({}, (snap) => { delete snap.inventorySnapshot; }))]);
  const e = refused(() => validateAll(store, OPTS), "E_BATCH_SNAPSHOT_MISSING", "version without snapshot");
  assert.match(e.message, /NOT read as legacy/);
});

test("AC124: record.inventoryDigest is derived, not a second authority a caller may supply", () => {
  const store = storeWith([v2Record({ inventoryDigest: "f".repeat(64) })]);
  refused(() => validateAll(store, OPTS), "E_BATCH_DERIVED_DIGEST", "top-level digest disagreeing with the snapshot");

  // The same rule on the enclosing snapshot's own derived copy, and on its absence.
  const missing = storeWith([reseal(v2Record({}, (snap) => { delete snap.inventoryDigest; }))]);
  refused(() => validateAll(missing, OPTS), "E_BATCH_SNAPSHOT_SHAPE", "snapshot without its derived digest");
  const wrong = storeWith([reseal(v2Record({}, (snap) => { snap.inventoryDigest = "e".repeat(64); }))]);
  refused(() => validateAll(wrong, OPTS), "E_BATCH_DERIVED_DIGEST", "snapshot digest disagreeing with its inventory");
});

test("AC125: a snapshot field edited without recomputing the inventoryDigest is caught by the recompute", () => {
  const stale = inventory();
  stale.inputProvenanceStoreDigest = "e".repeat(64);        // changed; digest deliberately NOT recomputed
  const store = storeWith([reseal(v2Record({ inventorySnapshot: stale, inventoryDigest: stale.inventoryDigest }))]);
  const e = refused(() => validateAll(store, OPTS), "E_DIGEST", "stale self-digest");
  assert.match(e.message, /single formula/, "and it is the inventory authority's own message, not a paraphrase");

  // The symmetric case: an entry field edited without a recompute.
  const entryStale = inventory();
  entryStale.entries[0].headBodyDigest = "9".repeat(64);
  const s2 = storeWith([reseal(v2Record({ inventorySnapshot: entryStale, inventoryDigest: entryStale.inventoryDigest }))]);
  refused(() => validateAll(s2, OPTS), "E_DIGEST", "stale entry");

  // POSITIVE: change the field AND recompute consistently -> accepted.
  const consistent = inventory({ inputProvenanceStoreDigest: "e".repeat(64) });
  assert.ok(validateAll(storeWith([v2Record({ inventorySnapshot: consistent })]), OPTS).ok);
});

test("AC126: the inventory contract is charged by the canonical authority, not a permissive copy", () => {
  // Each of these is refused by parseCanonicalInventoryV2's own code, reached through the record.
  const cases = [
    ["exact key set: an undeclared key", (inv) => { inv.extra = 1; }, "E_ROOT_SHAPE"],
    ["exact key set: a missing key", (inv) => { delete inv.registryDigest; }, "E_ROOT_SHAPE"],
    ["lexical grammar: uppercase digest", (inv) => { inv.registryDigest = "B".repeat(64); }, "E_ROOT_FIELD"],
    ["lexical grammar: abbreviated tree oid", (inv) => { inv.baseTreeOid = "abc1234"; }, "E_ROOT_FIELD"],
    ["inventoryVersion must be the integer 2", (inv) => { inv.inventoryVersion = 3; }, "E_ROOT_FIELD"],
    ["entry conditional field: added carries no baseBodyDigest", (inv) => {
      inv.entries[0].baseBodyDigest = "e".repeat(64);
    }, "E_ENTRY_SHAPE"],
    ["entry invariant: added requires tagBefore == null", (inv) => {
      inv.entries[0].tagBefore = { clauseRef: REQ };
    }, "E_ENTRY_INVARIANT"],
  ];
  for (const [what, mutate, code] of cases) {
    const inv = inventory();
    mutate(inv);
    inv.inventoryDigest = computeInventoryV2Digest(inv);   // isolate the rule under test from the digest
    const store = storeWith([v2Record({ inventorySnapshot: inv, inventoryDigest: inv.inventoryDigest })]);
    refused(() => validateAll(store, OPTS), code, what);
  }

  // Entry ORDERING, which needs two entries.
  const unsorted = inventory();
  const second = structuredClone(unsorted.entries[0]);
  second.testRef.path = "b.test.mjs";
  unsorted.entries = [second, unsorted.entries[0]];         // descending by path
  unsorted.inventoryDigest = computeInventoryV2Digest(unsorted);
  refused(() => validateAll(storeWith([v2Record({ inventorySnapshot: unsorted, inventoryDigest: unsorted.inventoryDigest })]), OPTS),
    "E_ORDER", "entries out of (path, adapterId, structuralId) order");
});

test("TP §2 TestSemanticReviewBatch: the snapshot's own fields bind the batch to one task and one base", () => {
  const otherTask = storeWith([reseal(v2Record({}, (snap) => { snap.taskId = "TASK-other"; }))]);
  refused(() => validateAll(otherTask, OPTS), "E_BATCH_SNAPSHOT_SHAPE", "snapshot task differing from the record's");

  const noResults = storeWith([reseal(v2Record({}, (snap) => { delete snap.results; }))]);
  const e = refused(() => validateAll(noResults, OPTS), "E_BATCH_SNAPSHOT_SHAPE", "absent results[]");
  assert.match(e.message, /never reviewed/, "an absent results[] is not an empty one");

  // A self-consistent inventory computed against a DIFFERENT base than the batch witnesses. Every
  // digest here is recomputed, so only the cross-binding can catch it.
  const elsewhere = inventory({ baseTreeOid: "d".repeat(40) });
  const store = storeWith([v2Record({ inventorySnapshot: elsewhere, inventoryDigest: elsewhere.inventoryDigest })]);
  refused(() => validateAll(store, OPTS), "E_BATCH_BASE_TREE_MISMATCH", "inventory computed against another tree");
});

// --- 2. the legacy boundary ------------------------------------------------------------------------

test("AC128 legacy: a genuine v1.12 record stays readable, populated results included", () => {
  const clean = storeWith([legacyRecord()]);
  assert.ok(validateAll(clean, OPTS).ok, "a clean legacy record loads");
  assert.deepStrictEqual(classifyBatchRecord(indexStore(clean).records.get("R-legacy")), { ok: true, version: null });

  // A POPULATED historical results array is a fact about that batch, not a reason to reject it. This
  // is NOT the product parser's clean-only v1 inventory lane, and conflating the two would make real
  // history unreadable.
  const populated = storeWith([reseal(legacyRecord({
    results: [{ testRef: { path: "a.test.mjs", adapterId: "node-test-v2", structuralId: 's:["alpha"]' }, findings: [] }],
  }))]);
  assert.ok(validateAll(populated, OPTS).ok, "a populated legacy results array is historical metadata, not a defect");
});

test("AC128 legacy: no version field plus a non-legacy root shape is fail-closed", () => {
  const extra = storeWith([reseal(legacyRecord({ unexpected: true }))]);
  const e = refused(() => validateAll(extra, OPTS), "E_BATCH_LEGACY_SHAPE", "an undeclared root key");
  assert.match(e.message, /undeclared: unexpected/);
  assert.match(e.message, /omitted the version field must fail here/);

  // Absence is a shape, not a default: previousBatchRef must be PRESENT even when it is null.
  const missing = legacyRecord();
  delete missing.previousBatchRef;
  refused(() => validateAll(storeWith([reseal(missing)]), OPTS), "E_BATCH_LEGACY_SHAPE", "a missing root key");
});

test("AC128 legacy: the `kind` discriminator is part of the real absence shape, not an undeclared key", () => {
  // shared §2 lists a record's PAYLOAD fields; every persisted record additionally carries `kind`.
  // Reading that list as the literal serialized key set would condemn every legacy record ever
  // written -- including the ones this repository's own writer emits.
  const rec = legacyRecord();
  assert.ok(Object.keys(rec).includes("kind"), "the fixture is a realistically serialized record");
  assert.deepStrictEqual(classifyBatchRecord(rec), { ok: true, version: null });
});

test("AC128 legacy: readable is NOT usable -- the inventory-preimage read API refuses a legacy record", () => {
  // The explicit internal/read distinction, so a future Step 6 cannot mistake "it loaded" for proof.
  const legacy = legacyRecord();
  const e = refused(() => batchInventoryPreimage(legacy), "E_NO_INVENTORY_PREIMAGE", "legacy preimage request");
  assert.match(e.message, /NO EVIDENCE/);
  assert.match(e.message, /must not be mistaken for Phase 2 proof/);

  // And it DOES yield the snapshot for a v2 record -- the two paths are distinguished by the
  // discriminator, not by the caller's hopes.
  const v2 = v2Record();
  assert.strictEqual(batchInventoryPreimage(v2), v2.batchSnapshot.inventorySnapshot);
  refused(() => batchInventoryPreimage({ recordId: "R-x", kind: "review-ruling" }),
    "E_NO_INVENTORY_PREIMAGE", "a record that is not a batch at all");
});

// --- 3. chain monotonicity, on actual serialized records --------------------------------------------

function chainStore(first, second) {
  const s = emptyStore();
  second.previousBatchRef = { kind: "provenance-batch", ref: first.recordId };
  reseal(first); reseal(second);
  s.records.push(first, second);
  s.taskStates.push({
    taskId: TASK, baseProvenance: witness(), currentTaskDpIds: [],
    committedProvenanceBatchRef: { kind: "provenance-batch", ref: second.recordId },
  });
  return s;
}

test("SM v1.13 chain: v2 may follow legacy, and legacy may not follow v2", () => {
  // Serialized and re-read, not just held as objects: this is the shape a real store carries.
  const upgrade = chainStore(legacyRecord(), v2Record({ recordId: "R-v2" }));
  const upgradeText = canonicalStoreBytes(upgrade);
  assert.ok(validateAll(parseStore(upgradeText), OPTS).ok,
    "an in-place upgrade is allowed: history is neither migrated nor rewritten");

  const regression = chainStore(v2Record({ recordId: "R-v2" }), legacyRecord({ recordId: "R-after" }));
  const regressionText = canonicalStoreBytes(regression);
  const e = refused(() => validateAll(parseStore(regressionText), OPTS),
    "E_CHAIN_VERSION_REGRESSION", "legacy chained onto v2");
  assert.match(e.message, /never decreases/);
  assert.match(e.message, /stopped emitting the version field/);
});

test("SM §2 chain: previousBatchRef has exactly two legal shapes, and a falsy one is not 'no predecessor'", () => {
  // The chain walk treats any falsy previousBatchRef as "this batch begins the chain". So an absent
  // or falsy-but-non-null value would silently promote a record to a chain root, the tip computation
  // would stop seeing it as referenced, and a broken chain would load clean. Each of these is
  // refused on the record's own shape, before the walk ever reads it.
  const missing = v2Record();
  delete missing.previousBatchRef;
  const e = refused(() => validateAll(storeWith([reseal(missing)]), OPTS), "E_BATCH_CHAIN_SHAPE", "an absent link");
  assert.match(e.message, /a third state the model does not have/);

  for (const value of [false, 0, "", undefined]) {
    const rec = v2Record({ previousBatchRef: value });
    refused(() => validateAll(storeWith([reseal(rec)]), OPTS), "E_BATCH_CHAIN_SHAPE",
      `previousBatchRef ${JSON.stringify(value)}`);
  }

  // A typed ref names the kind it resolves to. Pointing a differently-kinded ref at a record that
  // really IS a provenance-batch must not pass: the ref itself is unresolvable (External-record
  // contract), and checking only the resolved record's kind would miss it entirely.
  const chain = chainStore(legacyRecord(), v2Record({ recordId: "R-v2" }));
  chain.records[1].previousBatchRef = { kind: "semantic-evidence", ref: "R-legacy" };
  reseal(chain.records[1]);
  const k = refused(() => validateAll(chain, OPTS), "E_BATCH_CHAIN_SHAPE", "a ref naming another kind");
  assert.match(k.message, /however real the record it points at happens to be/);

  // And the legal shapes both load: null for a first batch, a proper RecordRef for a successor.
  assert.ok(validateAll(storeWith([v2Record()]), OPTS).ok, "null is the first batch's legal value");
  assert.ok(validateAll(chainStore(legacyRecord(), v2Record({ recordId: "R-v2" })), OPTS).ok);
});

test("SM §2 chain: the existing continuity, one-tip and committed-head rules are unchanged", () => {
  const ok = chainStore(legacyRecord(), v2Record({ recordId: "R-v2" }));
  assert.ok(validateAll(ok, OPTS).ok);

  // two tips
  const forked = structuredClone(ok);
  forked.records[1].previousBatchRef = null;
  reseal(forked.records[1]);
  refused(() => validateAll(forked, OPTS), "E_HEAD_STATE", "two tips");

  // the committed head must be the tip
  const stale = structuredClone(ok);
  stale.taskStates[0].committedProvenanceBatchRef = { kind: "provenance-batch", ref: "R-legacy" };
  refused(() => validateAll(stale, OPTS), "E_HEAD_STATE", "committed head behind the tip");

  // cross-task chaining
  const crossed = structuredClone(ok);
  crossed.records[0].taskId = "TASK-other";
  reseal(crossed.records[0]);
  refused(() => validateAll(crossed, OPTS), "E_BATCH_ORPHAN_TASK", "a batch belonging to an unknown task");
});

// --- 4. the RAW nested-inventory ingestion boundary ---------------------------------------------------

// Every case here goes through parseStore(TEXT). A JS object cannot express a duplicate member, so
// the negatives could not exist in an object-built fixture -- which the last assertion demonstrates
// rather than asserts in prose.
function storeTextWith(mutate) {
  const text = canonicalStoreBytes(storeWith([v2Record()]));
  const mutated = mutate(text);
  assert.notStrictEqual(mutated, text, "the raw fixture must actually differ from the canonical bytes");
  return mutated;
}

test("SM v1.14 raw duplicate contract: a duplicate inside the inventorySnapshot is refused at ingestion", () => {
  // Root member of the inventory, spelled with an ESCAPE so the decoded-name rule is what catches it.
  const escaped = storeTextWith((t) =>
    t.replace('"inventoryVersion":2', '"inventoryVersion":2,"\\u0069nventoryVersion":2'));
  const e = refused(() => parseStore(escaped), "E_DUPLICATE_MEMBER", "an escaped duplicate root member");
  assert.match(e.message, /DECODED value/);
  assert.strictEqual(e.detail, "R-v2", "and the failure names the record it came from");

  // Nested in an entry, in its testRef, and in a tag object: the contract covers every object in the
  // subtree, not just its root.
  const inEntry = storeTextWith((t) => t.replace('"status":"added"', '"status":"added","status":"moved"'));
  refused(() => parseStore(inEntry), "E_DUPLICATE_MEMBER", "a duplicate inside an entry");

  const inTestRef = storeTextWith((t) => t.replace('"path":"a.test.mjs"', '"path":"a.test.mjs","path":"b.test.mjs"'));
  refused(() => parseStore(inTestRef), "E_DUPLICATE_MEMBER", "a duplicate inside testRef");

  const inTag = storeTextWith((t) => t.replace(`"tagAfter":{"clauseRef":"${REQ}"}`,
    `"tagAfter":{"clauseRef":"${REQ}","clauseRef":"${REQ}"}`));
  refused(() => parseStore(inTag), "E_DUPLICATE_MEMBER", "a duplicate inside a tag");
});

test("SM v1.14 raw contract: only the inventory subtree is judged by it", () => {
  // A duplicate OUTSIDE the ChangedTestInventoryV2 subtree is not this contract's business. Imposing
  // a global rule on every historical object would be an unrelated restriction adopted as a
  // shortcut, and it would retroactively condemn stores written before the rule existed.
  const store = storeWith([legacyRecord()]);
  const text = canonicalStoreBytes(store).replace('"taskId":"TASK-reader"', '"taskId":"TASK-reader","taskId":"TASK-reader"');
  const parsed = parseStore(text);
  assert.ok(validateAll(parsed, OPTS).ok, "a duplicate in an unrelated legacy record is not refused here");
});

test("SM v1.14 raw contract: whitespace and inventory ROOT member order are accepted", () => {
  // Ordinary JSON whitespace is explicitly not a rejection reason.
  const pretty = JSON.stringify(JSON.parse(canonicalStoreBytes(storeWith([v2Record()]))), null, 2);
  assert.ok(validateAll(parseStore(pretty), OPTS).ok, "pretty-printed bytes remain readable");

  // Neither is the ROOT member source order of the inventory: the rule says duplicates, and the
  // canonical digest order is canonicalJson's business, not the document's. This genuinely moves a
  // member -- the same key set, a different source order -- and it must still be accepted.
  const moved = storeTextWith((t) => t
    .replace('"inventoryVersion":2,', "")                               // out of its canonical slot
    .replace('"inventorySnapshot":{', '"inventorySnapshot":{"inventoryVersion":2,'));   // and to the front
  const snapshotOf = (t) => JSON.parse(t).records[0].batchSnapshot.inventorySnapshot;
  assert.deepStrictEqual(Object.keys(snapshotOf(moved)).sort(), Object.keys(inventory()).sort(),
    "the same key set: this moved a member, it did not add or drop one");
  assert.notDeepStrictEqual(Object.keys(snapshotOf(moved)), Object.keys(inventory()),
    "and the source order really is different");
  assert.ok(validateAll(parseStore(moved), OPTS).ok, "a re-ordered inventory root is the same document");
});

test("TP v1.10 raw contract: an entry whose members are NOT in ascending source order is refused", () => {
  // The entry-specific key ORDER rule, on the raw bytes and with the key set untouched: two existing
  // members are swapped so the entry declares them in descending code-point order. Adding or
  // removing a key would prove the exact-key-set rule instead, which is a different rule.
  const canonical = '"framework":"node-test","headBodyDigest":"' + "d".repeat(64) + '"';
  const swapped = '"headBodyDigest":"' + "d".repeat(64) + '","framework":"node-test"';
  const unsorted = storeTextWith((t) => {
    assert.ok(t.includes(canonical), "the fixture's entry really is in canonical order to begin with");
    return t.replace(canonical, swapped);
  });
  const e = refused(() => parseStore(unsorted), "E_ORDER", "an entry declaring members out of order");
  assert.match(e.message, /strictly ascending Unicode code-point order/);
  assert.match(e.message, /refuses it rather than sorting it/);
});

test("SM v1.14 raw contract: the object form of the same document CANNOT carry the negative", () => {
  // This is why the boundary is the text. JSON.parse keeps the last occurrence, so the duplicate is
  // already gone by the time any object-level validator could look -- and re-serialising the object
  // cannot bring it back. A fixture built from a JS object would silently be a positive control.
  const escaped = storeTextWith((t) =>
    t.replace('"inventoryVersion":2', '"inventoryVersion":2,"\\u0069nventoryVersion":2'));
  refused(() => parseStore(escaped), "E_DUPLICATE_MEMBER", "through the real ingestion boundary");

  const asObject = JSON.parse(escaped);                     // last-write-wins happens HERE
  assert.ok(validateAll(asObject, OPTS).ok,
    "the same document as an object is accepted: the evidence no longer exists, which is precisely "
    + "why the raw check cannot be replaced by an object-level one");
});

test("raw ingestion scans the enclosing document ONCE, and still locates every subtree correctly", () => {
  // BEHAVIOURAL half. Switching from "scan per record" to "scan once, slice many" is exactly the
  // change that can start slicing the wrong record, so this builds a long chain and plants the
  // duplicate in the LAST record: a shared span tree that mis-indexes would either miss it or
  // blame the wrong record.
  const COUNT = 40;
  const records = [];
  for (let n = 0; n < COUNT; n += 1) {
    const rec = v2Record({ recordId: `R-${String(n).padStart(3, "0")}` });
    rec.previousBatchRef = n === 0 ? null : { kind: "provenance-batch", ref: `R-${String(n - 1).padStart(3, "0")}` };
    records.push(reseal(rec));
  }
  const store = storeWith(records);
  assert.ok(validateAll(store, OPTS).ok, "a long legal v2 chain still loads");

  const text = canonicalStoreBytes(store);
  const last = `"recordId":"R-${String(COUNT - 1).padStart(3, "0")}"`;
  assert.ok(text.includes(last), "the fixture really carries the last record");
  // Plant the duplicate in the LAST record's inventory only: everything before it must be located
  // and accepted, and the failure must name that record.
  const tail = text.lastIndexOf('"inventoryVersion":2');
  const planted = `${text.slice(0, tail)}"inventoryVersion":2,"\\u0069nventoryVersion":2${text.slice(tail + '"inventoryVersion":2'.length)}`;
  const e = refused(() => parseStore(planted), "E_DUPLICATE_MEMBER", "a duplicate in the last of many records");
  assert.strictEqual(e.detail, `R-${String(COUNT - 1).padStart(3, "0")}`,
    "and the refusal names the record whose subtree actually carried it");
});

test("raw ingestion: the one-scan structure, by source inspection", () => {
  // STRUCTURAL evidence, labelled as such: a timing threshold would be flaky, and the property under
  // test is where the scan happens, not how fast a particular machine is. Scanning inside the loop
  // is quadratic in the document -- every batch record re-walks the whole store.
  const source = fs.readFileSync(
    new URL("../cressetide/skills/vigil/scripts/provenance-store.mjs", import.meta.url), "utf8");
  const start = source.indexOf("export function assertRawInventorySnapshots");
  assert.ok(start > 0, "the ingestion boundary is where this property lives");
  const body = source.slice(start, source.indexOf("export function parseStore"));
  assert.strictEqual(body.split("scanJsonSpans(").length - 1, 1, "exactly one scan of the enclosing document");
  const scanAt = body.indexOf("scanJsonSpans(");
  const loopAt = body.indexOf("for (const [i, rec] of subjects)");
  assert.ok(loopAt > 0 && scanAt < loopAt, "and it happens BEFORE the per-record loop, not inside it");
  assert.ok(!/for\s*\([^)]*\)\s*\{[^}]*scanJsonSpans\(/.test(body), "no scan survives inside any loop body");
});

// --- 5. what the writer now emits, read back through this reader ------------------------------------

test("rollout order: the writer now emits a VERSION 2 record this reader accepts, preimage and all", () => {
  // The reader landed first and needed no adaptation when the writer caught up: this asserts the two
  // halves meet on the same contract, from the writer's own output rather than a hand-built record.
  // The legacy fixtures above are untouched and still real history.
  const pre = emptyStore();
  pre.taskStates.push({
    taskId: TASK, baseProvenance: witness(), currentTaskDpIds: [], committedProvenanceBatchRef: null,
  });
  const expected = storeDigest(pre);
  // The fixtures above list an entry's members in the order the shared model documents them, which is
  // not ascending order; the object write API refuses an unsorted entry rather than sorting it in
  // place (TP AC126 (iii)), so the CALLER canonicalises first. That is the documented boundary, and
  // doing it here rather than in the writer is the point.
  const inv = JSON.parse(canonicalJson(inventory({ inputProvenanceStoreDigest: expected })));
  const post = applyTransaction(pre, "commit-test-provenance-batch", {
    taskId: TASK, batchRecordId: "R-b1", expectedInputProvenanceStoreDigest: expected,
    batchSnapshot: {
      taskId: TASK, baseProvenance: witness(), inventoryDigest: inv.inventoryDigest,
      inventorySnapshot: inv,
      results: [{
        testRef: inv.entries[0].testRef,
        tagBefore: null, tagAfter: inv.entries[0].tagAfter,
        observedHeadBodyDigest: inv.entries[0].headBodyDigest,
        findings: [],
      }],
      resolutions: [],
    },
    resolutions: [],
  }, OPTS);

  const rec = indexStore(post).records.get("R-b1");
  assert.strictEqual(rec.batchRecordVersion, BATCH_RECORD_VERSION, "the writer states the version explicitly");
  assert.deepStrictEqual(classifyBatchRecord(rec), { ok: true, version: BATCH_RECORD_VERSION });
  assert.strictEqual(rec.inventoryDigest, inv.inventoryDigest, "and derives the record digest from the preimage");
  assert.ok(validateAll(post, OPTS).ok, "the store it produces still loads");
  assert.ok(validateAll(parseStore(canonicalStoreBytes(post)), OPTS).ok, "and still loads after a round trip");
  assert.strictEqual(batchInventoryPreimage(rec), rec.batchSnapshot.inventorySnapshot,
    "a v2 record does carry inventory-preimage authority — which is the whole difference from legacy");
});

test("rollout order: a REAL v1.12 legacy record is still readable, and still supplies no preimage", () => {
  // The legacy boundary is unchanged by the writer moving to v2: history stays readable, and stays
  // unusable as an inventory preimage.
  const store = storeWith([legacyRecord()]);
  assert.ok(validateAll(store, OPTS).ok, "history still loads");
  assert.deepStrictEqual(classifyBatchRecord(store.records[0]), { ok: true, version: null });
  refused(() => batchInventoryPreimage(store.records[0]), "E_NO_INVENTORY_PREIMAGE",
    "while carrying no inventory-preimage authority whatsoever");
});
