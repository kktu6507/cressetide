// buildGovernanceSeedPreimage() -- TP approved v1.17 §11b.10c, on shared approved v1.15 §2/§9.
//
// This path is the PUBLIC FACADE and is deliberately nothing else. The implementation lives in
// governance-producer-core.mjs, which owns both §11b.10c logical operations and the module-private
// orchestration they share. v1.16 shared that orchestration through an exported
// runWithGovernanceContext(request, …, work) that handed the retained context to a caller-supplied
// callback; §11b.10c v1.17 forbids that shape outright -- it is simultaneously a new public
// operation and a ready-made test seam -- so the continuation is now internal to the core module
// and nothing here re-exports it.
//
// The request is EXACTLY { repoRoot, baseTreeOid }. This operation resolves no task and selects no
// TaskState, which is what lets an absent or canonically-empty current store succeed as AC171
// (B)(ix)/(xi) require; whole-store schema validation still covers taskStates.
//
// SCOPE, stated up front so a green run of this file is not misread. This builds the
// GovernanceSeedPreimage and nothing else. A green run does not establish AC118, AC136, AC137 or
// AC138, and does not mean Phase 2 is ready. (It used to add that it does not lift the
// unsupported-populated-inventory gate; that gate is retired, and this module was never on its path.)
//
// The carrier is four keys, in memory only. Nothing here writes the store, .ctide/output/**, the
// explicit config or the registry, and no failure returns a partial carrier.
export {
  buildGovernanceSeedPreimage, GovernanceSeedPreimageError,
} from "./governance-producer-core.mjs";
