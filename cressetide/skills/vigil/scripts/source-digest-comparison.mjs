// TP §11b.9c's source-freshness comparison, as pure data.
//
// WHY SHARED. Two components ask the same question of the same two digests: the accepted
// verifySourceFreshness facade, and the Step 6 committed consumer, which must capture ONE S3 and use
// it for both this comparison and Source Check B. The comparison itself is arithmetic over four
// strings; duplicating it would let the two components disagree about what "stale" means while each
// looked correct in isolation.
//
// WHAT THIS MODULE DOES NOT DO. It captures nothing, reads nothing and raises nothing. Both
// comparisons are always evaluated and both results are returned, because "the head view moved" and
// "the registry moved" are two different facts about the world and a caller that only ever hears
// about the first cannot tell them apart. Each caller renders the verdict in its OWN error
// namespace, which is why the facade keeps E_STALE and the consumer raises its own code.

/**
 * @param {{headViewDigest: string, registryDigest: string}} declared the envelope's two digests.
 * @param {{headViewDigest: string, registryDigest: string}} actual the values recomputed from S3.
 * @returns {{fresh: boolean, stale: string[], detail: object}} `detail` is frozen and is the exact
 *   shape both callers report; `stale` names the fields that did not match, in a fixed order.
 */
export function compareSourceDigests(declared, actual) {
  const headMatches = declared.headViewDigest === actual.headViewDigest;
  const registryMatches = declared.registryDigest === actual.registryDigest;
  const detail = Object.freeze({
    headViewDigest: Object.freeze({
      declared: declared.headViewDigest, actual: actual.headViewDigest, matches: headMatches,
    }),
    registryDigest: Object.freeze({
      declared: declared.registryDigest, actual: actual.registryDigest, matches: registryMatches,
    }),
  });
  const stale = [
    headMatches ? null : "headViewDigest",
    registryMatches ? null : "registryDigest",
  ].filter(Boolean);
  return { fresh: stale.length === 0, stale, detail };
}
