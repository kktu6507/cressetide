// Bounded shared primitives over a TP §6 review batch, used at BOTH boundaries the loop controller
// owns: admission (TP v1.21 §D5.8b) and epoch unlock (§D9.1c).
//
// WHY THESE LIVE TOGETHER. §D9.1c requires the unlock to charge the same per-finding equalities the
// writer charges inside `assertFindingResolution`, against body comparands read from the locking
// admission's retained payload. If admission and unlock each carried their own copy, the two could
// drift and the second would stop meaning what the first meant. These are DESCRIPTORS: they report
// the first failing equality and throw nothing, so each caller raises its own declared refusal and no
// upstream cause is ever remapped.
//
// These are internal predicates for the loop controller's own modules. They are not a public caller
// operation, they take no callback, resolver, clock or option, and they replace no writer validation:
// `commit-test-provenance-batch` still charges its own full gating set at commit time.
import { canonicalJson } from "./canonical-json.mjs";
import { isCanonicalClauseRef, principalsEqual } from "./provenance-store.mjs";

export const TEST_PRINCIPAL = { kind: "discipline", discipline: "test" };
export const GENERAL_FINDING_KINDS = ["wrong-tag", "missing-source", "scope-violation"];
export const RESOLUTION_MODES = ["historical-convergence", "this-round"];

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// §D2.1's ONE FindingIdentity, built by NAMED FIELD EXTRACTION of exactly the three testRef members.
// A whole-object reuse that could carry an extra member is not a normalization, and a 4-tuple that
// omits `binding` would collapse two findings identical but for their binding.
export function normalizeFindingIdentity(testRef, finding) {
  return {
    testRef: {
      path: testRef.path,
      adapterId: testRef.adapterId,
      structuralId: testRef.structuralId,
    },
    kind: finding.kind,
    binding: finding.binding === undefined || finding.binding === null ? null : { ...finding.binding },
  };
}

export const findingIdentityKey = (identity) => canonicalJson([
  identity.testRef.path, identity.testRef.adapterId, identity.testRef.structuralId,
  identity.kind, identity.binding,
]);

export const sameFindingIdentity = (a, b) => findingIdentityKey(a) === findingIdentityKey(b);

// Sorted and deduplicated on the FULL tuple including binding (§D9.2).
export function sortFindingIdentities(identities) {
  const seen = new Map();
  for (const identity of identities) {
    const key = findingIdentityKey(identity);
    if (!seen.has(key)) seen.set(key, identity);
  }
  return [...seen.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([, v]) => v);
}

// The closed `resolutionRef` union, charged on SHAPE alone. §D5.8b refuses a claim that is not
// evaluable before admission, so this reports the fault rather than deciding the disposition.
export function resolutionRefShapeFault(resolutionRef) {
  if (!isPlainObject(resolutionRef)) return "resolutionRef must be an object";
  const keys = Object.keys(resolutionRef).sort();
  if (!RESOLUTION_MODES.includes(resolutionRef.mode)) return `unknown resolutionRef.mode ${JSON.stringify(resolutionRef.mode)}`;
  if (typeof resolutionRef.transitionRef !== "string" || resolutionRef.transitionRef === "") {
    return "resolutionRef.transitionRef must be a non-empty string";
  }
  if (resolutionRef.mode === "historical-convergence") {
    if (canonicalJson(keys) !== canonicalJson(["mode", "transitionRef"])) {
      return "a historical-convergence resolutionRef declares exactly {mode, transitionRef}";
    }
    return null;
  }
  if (canonicalJson(keys) !== canonicalJson(["mode", "semanticEvidenceRef", "transitionRef"])) {
    return "a this-round resolutionRef declares exactly {mode, transitionRef, semanticEvidenceRef}";
  }
  const ref = resolutionRef.semanticEvidenceRef;
  if (!isPlainObject(ref) || typeof ref.kind !== "string" || typeof ref.ref !== "string") {
    return "resolutionRef.semanticEvidenceRef must be a typed {kind, ref}";
  }
  return null;
}

// An `assum-reading-change` finding's binding, charged before anything is read from it.
export function assumBindingFault(finding) {
  if (!isPlainObject(finding.binding)) return "an assum-reading-change finding states its binding";
  if (!isCanonicalClauseRef(finding.binding.clauseRef)) {
    return `binding.clauseRef ${JSON.stringify(finding.binding.clauseRef)} is not a canonical clause id`;
  }
  if (!String(finding.binding.clauseRef).startsWith("ASSUM-")) {
    return `binding.clauseRef ${finding.binding.clauseRef} is not an ASSUM`;
  }
  return null;
}

// The per-finding evidence equalities `assertFindingResolution` charges for a this-round claim,
// reported as a descriptor. `bodies` supplies the authoritative observed digests: at admission they
// come from the result being scanned, and at unlock from §D9.1b's retained-payload lookup.
//
// The side rule is the writer's own, and it is SYMMETRIC: a side is skipped only when NEITHER the
// evidence nor the reviewed result states it. Guarding on the result alone let a drafted evidence
// record invent a side the entry does not have — on a head-only or base-only entry that is a claim
// about a body that was never under review — while the writer refuses it E_EVIDENCE_BINDING. §D5.8
// and §D9.1c both say "on exactly the sides that exist". The deliberate baseBodyDigest /
// observedBaseBodyDigest NAME asymmetry is preserved; only the presence rule is symmetric.
export function evidenceCoverageFault(evidence, identity, taskId, bodies) {
  if (!isPlainObject(evidence)) return "the semantic evidence does not resolve to a record";
  if (evidence.kind !== "review-ruling") return `evidence ${evidence.recordId} is a ${evidence.kind}, not a review-ruling`;
  if (!principalsEqual(evidence.by, TEST_PRINCIPAL)) return `evidence ${evidence.recordId} is not issued by the test discipline`;
  if (identity.binding === null) return "the finding states no binding";
  if (evidence.subjectRef !== identity.binding.clauseRef) {
    return `evidence ${evidence.recordId} is bound to ${evidence.subjectRef}, not ${identity.binding.clauseRef}`;
  }
  if (evidence.taskId !== taskId) return `evidence ${evidence.recordId} names task ${JSON.stringify(evidence.taskId)}`;
  if (canonicalJson(evidence.testRef) !== canonicalJson(identity.testRef)) {
    return `evidence ${evidence.recordId} names a different testRef`;
  }
  if (evidence.findingKind !== identity.kind) {
    return `evidence ${evidence.recordId} answers findingKind ${JSON.stringify(evidence.findingKind)}`;
  }
  if (canonicalJson(evidence.binding) !== canonicalJson(identity.binding)) {
    return `evidence ${evidence.recordId} carries a different binding`;
  }
  for (const [carried, side] of [["baseBodyDigest", "base"], ["headBodyDigest", "head"]]) {
    if (evidence[carried] === undefined && bodies[side] === undefined) continue;
    if (evidence[carried] !== bodies[side]) {
      return `evidence ${evidence.recordId} states ${carried} ${JSON.stringify(evidence[carried] ?? null)} `
        + `against the reviewed ${JSON.stringify(bodies[side] ?? null)}; the evidence must be about the body under `
        + "review, on exactly the sides that exist";
    }
  }
  return null;
}

// The observed body sides a result actually states. Absent sides stay absent.
export function observedBodies(result) {
  const bodies = {};
  if (result.observedBaseBodyDigest !== undefined) bodies.base = result.observedBaseBodyDigest;
  if (result.observedHeadBodyDigest !== undefined) bodies.head = result.observedHeadBodyDigest;
  return bodies;
}

// §D9.1b: exactly ONE result in the retained payload may carry an identity's testRef, and that result
// must actually carry a finding of the identity's kind and binding. A duplicate testRef would make
// "the" result ambiguous; a result with no such finding is not the retained finding at all.
export function retainedResultFault(results, identity) {
  if (!Array.isArray(results)) return "the retained batchSnapshot carries no results array";
  const matches = results.filter((r) => canonicalJson(r.testRef) === canonicalJson(identity.testRef));
  if (matches.length === 0) return `no retained result names ${canonicalJson(identity.testRef)}`;
  if (matches.length > 1) return `${matches.length} retained results name ${canonicalJson(identity.testRef)}; the match must be unique`;
  const result = matches[0];
  const carried = (result.findings || []).some((f) =>
    f.kind === identity.kind
    && canonicalJson(f.binding === undefined ? null : f.binding) === canonicalJson(identity.binding));
  if (!carried) return `the retained result for ${canonicalJson(identity.testRef)} carries no ${identity.kind} finding with that binding`;
  return null;
}

export function retainedResultFor(results, identity) {
  return results.find((r) => canonicalJson(r.testRef) === canonicalJson(identity.testRef)) || null;
}
