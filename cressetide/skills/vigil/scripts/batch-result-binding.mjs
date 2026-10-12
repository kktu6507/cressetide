// The per-result binding rules of TP §2's TestSemanticReviewBatch, as PURE PREDICATES over one
// result and the inventory entry it reviews.
//
// WHY SHARED, AND WHY AS DATA. The writer charges these at mint time and the Step 6 consumer charges
// them again over a persisted store it may not assume any writer produced. A second implementation
// would let the two disagree about what a valid review is while each looked correct alone. But the
// two components have different, separately reviewed diagnostic surfaces, so nothing here carries a
// code or a message: each predicate answers `null` for "no fault" or a small data object naming the
// KIND of fault and the values a caller needs to phrase its own diagnosis. The writer keeps every
// message it was accepted with; the consumer writes its own.
//
// THE ONE IDEA BEHIND ALL OF THEM. A caller's object says three different things about a field: the
// key is absent, the key is present holding `undefined`, or the key is present holding a value.
// TP §2:325 forbids reading null as absence and forbids reverse-normalising, so none of the three may
// be folded into another -- and `x ?? null` folds the first into the third, which is exactly how a
// required null-side tag became satisfiable by omitting it.
//
// SCOPE. No store, no index, no claims map, no resolver, no callback. A predicate that needed to
// resolve a record would need one of those, so resolution proof deliberately lives with each caller.
import { canonicalJson, compareCodePoint } from "./canonical-json.mjs";

export const statesValue = (o, k) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;

// The key set the canonical inventory reader was ACTUALLY shown. It validated TEXT -- the raw payload
// slice on the text path, JSON.stringify(snapshot) on the object path -- and both drop own properties
// whose value is undefined, so a live entry object can carry a key the validator never saw. Its
// unfiltered Object.keys is therefore NOT the validated set: comparing against it would reject a
// correct result, or force one to mirror the ghost. Filtering reconstructs the representation that was
// checked; it grants the result no annotation of its own.
export const representedKeys = (o) => Object.keys(o).filter((k) => o[k] !== undefined).sort(compareCodePoint);

export const clauseTagOf = (tag) => (
  tag && typeof tag === "object" && typeof tag.clauseRef === "string" ? tag : null);

// TP §2:327-328 declares `testRef` a nested EXACT shape -- { path, adapterId, structuralId }, with
// "多一 key、缺一 key 一律 fail-closed" -- and results carry that same declared type. Exactness is
// DERIVED from the entry the canonical reader already validated, so there is no second key table here
// and the accepted inventory parser is untouched.
export function refTypeFault(supplied, validated) {
  if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)) return { kind: "not-object" };
  const ghosts = Object.keys(supplied).filter((k) => supplied[k] === undefined).sort(compareCodePoint);
  if (ghosts.length) return { kind: "ghosts", ghosts };
  const suppliedKeys = representedKeys(supplied);
  const validatedKeys = representedKeys(validated);
  if (canonicalJson(suppliedKeys) !== canonicalJson(validatedKeys)) {
    return { kind: "keys", suppliedKeys, validatedKeys };
  }
  if (canonicalJson(supplied) !== canonicalJson(validated)) return { kind: "values" };
  return null;
}

// TP §2:526 lists tagBefore/tagAfter WITHOUT the `?` that six of their neighbours in the same block
// carry, so both are REQUIRED on every result, and §2:546 states the obligation as an equality --
// which presupposes both operands exist. The ENTRY side needs no presence guard: the canonical reader
// already enforced the common-seven exact key set, so both keys are present there.
export function tagFault(result, entry, side) {
  if (!statesValue(result, side)) return { kind: "absent" };
  if (canonicalJson(result[side]) !== canonicalJson(entry[side])) {
    return { kind: "value", stated: result[side], carried: entry[side] };
  }
  return null;
}

export const OBSERVED_BY_SIDE = Object.freeze({
  base: Object.freeze({ observed: "observedBaseBodyDigest", carried: "baseBodyDigest" }),
  head: Object.freeze({ observed: "observedHeadBodyDigest", carried: "headBodyDigest" }),
});

// A side exists on the entry or it does not; an `added` entry has no base side at all, so a stated
// observation there describes a body that was never under review, and an unstated one where the side
// does exist cannot be checked against anything.
export function sideObservationFault(result, entry, side) {
  const { observed, carried } = OBSERVED_BY_SIDE[side];
  const has = entry[carried] !== undefined;
  const stated = result[observed] !== undefined;
  if (has && !stated) return { kind: "missing", observed };
  if (!has && stated) return { kind: "extra", observed };
  if (has && result[observed] !== entry[carried]) {
    return { kind: "different", observed, stated: result[observed], carried: entry[carried] };
  }
  return null;
}

// TP §2's `clauseRef?` / `dpRef?` are a SHORTHAND PROJECTION of the entry's binding, and an entry has
// TWO sides. A single-side rule is refutable in both directions: `added` has no base clause, and a
// `deleted` ASSUM test -- which AC10b still requires a result for -- has no post-state clause. So the
// pair must jointly match ONE actual side; a clause from one side with the DP of the other describes
// a binding that never existed. The DP half is matched by PRESENCE, not by `?? null`: TP §2:331-332
// gives the clause tag exactly two shapes and the canonical reader requires a real DP ref inside the
// second, so no side can carry a null qualifier and a projection claiming one projects nothing.
export function projectionFault(result, entry) {
  for (const field of ["clauseRef", "dpRef"]) {
    if (Object.prototype.hasOwnProperty.call(result, field) && result[field] === undefined) {
      return { kind: "undefined-field", field };
    }
  }
  const sides = [clauseTagOf(entry.tagBefore), clauseTagOf(entry.tagAfter)].filter((t) => t !== null);
  const hasClause = statesValue(result, "clauseRef");
  const hasDp = statesValue(result, "dpRef");
  if (sides.length === 0) return (hasClause || hasDp) ? { kind: "no-side" } : null;
  if (!hasClause) return hasDp ? { kind: "dp-alone" } : null;
  const matched = sides.some((tag) => tag.clauseRef === result.clauseRef
    && (hasDp ? tag.dpRef === result.dpRef : !statesValue(tag, "dpRef")));
  if (!matched) {
    return {
      kind: "unmatched",
      stated: hasDp ? { clauseRef: result.clauseRef, dpRef: result.dpRef } : { clauseRef: result.clauseRef },
    };
  }
  return null;
}

// `binding?: { clauseRef, dpRef? }` (TP §2:530) is the same declared type as §2:301's tag, and
// §2:327-332 gives that type exactly two shapes -- no null variant. A SUPPLIED qualifier is therefore
// a non-empty string, while null and a present-but-undefined key state nothing.
//
// DELIBERATELY NOT CHARGED HERE, and not implied: the inventory's DP-ref grammar (the store defines no
// DP grammar and its own DP ids are not canonical ULIDs, so importing that grammar would create a
// second and stricter DP authority), the "only a REQ may carry @DP" rule, and any exception-backed
// test, which needs store pre-state.
export function bindingShapeFault(binding) {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)
      || typeof binding.clauseRef !== "string") {
    return { kind: "not-binding" };
  }
  const keys = Object.keys(binding).sort(compareCodePoint);
  if (keys.some((k) => k !== "clauseRef" && k !== "dpRef")) return { kind: "undeclared-key", keys };
  if (Object.prototype.hasOwnProperty.call(binding, "dpRef")
      && (typeof binding.dpRef !== "string" || binding.dpRef === "")) {
    return { kind: "dp-ref", value: binding.dpRef ?? null };
  }
  return null;
}
