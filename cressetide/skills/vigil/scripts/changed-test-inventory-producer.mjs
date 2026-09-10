// produceChangedTestInventoryV2() -- TP approved v1.17 §11b.10c, §6 ordered classification,
// §11b.9c envelope, on shared approved v1.15 §9.
//
// This path is the PUBLIC FACADE and is deliberately nothing else. The implementation lives in
// governance-producer-core.mjs together with buildGovernanceSeedPreimage(): the two operations share
// one ordering (G1 → T0 → task resolution → seed → binding validation → G2) and §11b.10c requires
// that sharing to be a module-private helper with an internal continuation, never an exported
// context or callback. The producer therefore derives its governance seed INLINE through that
// helper; it never calls the finished public seed operation, which would put G2 before binding
// validation and hand back no TaskState.
//
// The request is EXACTLY { repoRoot, baseTreeOid, taskId }; the two preimages are obtained from its
// { repoRoot, baseTreeOid } projection.
//
// SCOPE. This produces the in-memory ChangedTestInventoryV2 and nothing else. It does not establish
// AC118, AC136, AC137 or AC138, and does not mean Phase 2 is ready.
//
// STATUS, corrected. This used to say the product path goes on refusing every v2 envelope, including
// one this function just produced -- the unsupported-populated-inventory gate AC173 (j) paired with
// production. That gate is retired: parseInventory returns the canonical v2 result for empty and
// populated envelopes alike and refuses v1 ones instead. The producer's own boundary is unchanged
// and is the part that still matters here: it returns an in-memory envelope and writes NOTHING under
// .ctide/output/**. Publishing it is a separate operation, changed-test-inventory-artifact.mjs.
//
// Nothing here writes: not the store, not the explicit config, not the registry, not
// .ctide/output/**. The envelope is a return value.
export {
  produceChangedTestInventoryV2, InventoryProducerError,
} from "./governance-producer-core.mjs";
