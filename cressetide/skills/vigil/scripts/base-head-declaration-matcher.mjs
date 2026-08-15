// The base/head one-to-one declaration matcher: §6's closed matching rules, and nothing past them.
// Approved test-provenance v1.13 — §2 structural-refactor boundary, §6 matching including rule 3's
// residual-side exclusivity, §11b.7 stable-ID uniqueness scope, §11b.8 one-to-one matching and the
// `@tid` boundary, §11b.9b implementationIdentity, §11b.10b DiscoveryAnalysisPreimage.
//
// WHAT IT PRODUCES: a pairing relation over declarations, and only that. Every pair says which base
// declaration corresponds to which head declaration; nothing here says what the change MEANS.
//
// WHY IT STOPS AT PAIRING, argued from the approved text rather than chosen for convenience. §6's
// matching table reads:
//
//     0. stable-ID uniqueness, checked per view BEFORE matching
//     1. (path, structuralId) 相等                    -> modified／retagged
//     2. structuralId 相等但 path 不同                -> moved
//     3. residual-side exclusivity, see below
//
// Rule 1's right-hand side is a DISJUNCTION. For a same-path pair whose bodyDigest and tag have both
// moved, the approved text does not determine which of `modified` and `retagged` the eventual entry
// carries, and two conforming writers would disagree. Choosing one here would be inventing authority.
// So this component emits `same-path` for every rule-1 pair -- unchanged, body-changed, tag-changed
// or both -- and leaves the classification to whatever gains the authority to make it. Rules 2 and 3
// ARE uniquely determined, and are emitted as `moved`, `added`, `deleted` or a refusal.
//
// RULE 3 IS NOT UNCONDITIONAL (v1.13). Emitting added and deleted for whatever is left over turns a
// container rename into a delete plus an add: base `s:["old","n"]` and head `s:["new","n"]` at the
// same path, with tag and bodyDigest untouched, are the same test, and §2 and §11b.8 both forbid
// degrading that into added + deleted. But the preimage cannot tell that case from a genuine delete
// plus add either -- path, bodyDigest, tag, framework, implementationIdentity, declaration order and
// count are all silent on it. So rule 3 fires only when the residual is ONE-SIDED, and residual on
// both sides is a named refusal, E_UNRESOLVED_IDENTITY_DRIFT. A change that really does delete and
// add must be split into two runs bounded by different bases, so each run's residual is one-sided.
//
// UNCHANGED PAIRS ARE KEPT ON PURPOSE. A pair whose bodyDigest and tag are identical on both sides
// still appears in the output. §6's governance-affected status exists precisely for tests that did
// not change but whose bound clause did, and a reverse closure cannot reach a sibling it was never
// told about. Dropping unchanged pairs would silently delete that input.
//
// WHAT THIS IS NOT. It is not the populated-inventory producer. It emits no `status`, no `reason`,
// no governance-affected, no ChangedTestInventoryV2 entry, no envelope and no inventoryDigest. It
// computes no digest of any kind, writes nothing, reads no filesystem, Git, environment, network,
// registry, config or provenance store, and never calls buildDiscoveryAnalysisPreimage: it consumes
// a preimage that already exists. A green run of this file leaves AC118, AC136, AC137 and AC138
// exactly as unsatisfied as before, leaves the unsupported-populated-inventory gate standing, and
// does not make Phase 2 READY.
//
// PURE, IN THE SENSE THAT MATTERS: one argument, one return value, no side effects, no hidden state,
// and no way to hand it a registry, a parser, a Git executable, an environment, a filesystem, a
// config, modulePaths, a view, a snapshot or a hook. The request has one key set and it is exact.

export class BaseHeadMatcherError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = "BaseHeadMatcherError";
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

const fail = (code, message, detail) => new BaseHeadMatcherError(code, message, detail);

const ROOT_KEYS = ["baseTreeOid", "headViewDigest", "registryDigest", "baseModules", "headModules"];
const MODULE_KEYS = ["path", "adapterId", "framework", "implementationIdentity", "declarations"];
const DECLARATION_KEYS = ["structuralId", "tag", "bodyDigest"];
const IDENTITY_KEYS = ["implementationId", "parserId", "parserVersion"];

// §11b.7: an explicit stable-ID carrier is exactly a structuralId spelled "tid:" + ID (§11b.8 step 1).
// A derived key is "s:" + canonicalJson([...]). The prefix is compared literally; nothing here parses
// the ID itself, which is the adapter's business.
const STABLE_ID_PREFIX = "tid:";

const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const DIGEST = /^[0-9a-f]{64}$/;

// Unicode code-point comparison, written out rather than borrowed, because this module deliberately
// depends on nothing. localeCompare is never used: it would make the order depend on the machine.
function compareCodePoint(a, b) {
  if (a === b) return 0;
  const shorter = Math.min(a.length, b.length);
  for (let i = 0; i < shorter; i += 1) {
    const x = a.codePointAt(i);
    const y = b.codePointAt(i);
    if (x !== y) return x < y ? -1 : 1;
    // Surrogate pairs advance two code units at once, so the second half is never compared alone.
    if (x > 0xffff) i += 1;
  }
  return a.length === b.length ? 0 : (a.length < b.length ? -1 : 1);
}

const compareTriple = (a, b) =>
  compareCodePoint(a.path, b.path)
  || compareCodePoint(a.adapterId, b.adapterId)
  || compareCodePoint(a.structuralId, b.structuralId);

// --- preimage validation ------------------------------------------------------------------------
//
// This MIRRORS §11b.10b's exact contract; it does not restate or extend it. Nothing below normalises,
// sorts, de-duplicates or fills in a missing key: a preimage that is not already conforming is
// refused as handed over, because a preimage this matcher quietly repaired is a preimage whose
// producer's guarantees no longer describe what was matched.

function exactKeys(value, expected, what) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw fail("E_PREIMAGE_SHAPE", `${what} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((k, i) => k !== wanted[i])) {
    const missing = wanted.filter((k) => !actual.includes(k));
    const undeclared = actual.filter((k) => !wanted.includes(k));
    throw fail("E_PREIMAGE_SHAPE",
      `${what} must declare exactly ${JSON.stringify(wanted)}`
      + `${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`
      + `${undeclared.length ? ` (undeclared: ${undeclared.join(", ")})` : ""}`);
  }
  return value;
}

function requireFrozen(value, what) {
  if (!Object.isFrozen(value)) {
    throw fail("E_PREIMAGE_FROZEN",
      `${what} is not frozen; §11b.10b returns a deeply frozen preimage, and a mutable one cannot be `
      + "shown to be the object the producer built");
  }
  return value;
}

function requireNonEmptyString(value, what) {
  if (typeof value !== "string" || value === "") throw fail("E_PREIMAGE_SHAPE", `${what} must be a non-empty string`);
  return value;
}

// §11b.10b: tag is exactly { clauseRef }, { clauseRef, dpRef }, { expl: true }, or null.
function requireTag(tag, what) {
  if (tag === null) return tag;
  requireFrozen(tag, `${what} tag`);
  if (typeof tag !== "object" || Array.isArray(tag)) throw fail("E_PREIMAGE_SHAPE", `${what} tag must be an object or null`);
  const keys = Object.keys(tag).sort();
  const shape = keys.join(",");
  if (shape === "clauseRef" || shape === "clauseRef,dpRef") {
    requireNonEmptyString(tag.clauseRef, `${what} tag.clauseRef`);
    if (shape === "clauseRef,dpRef") requireNonEmptyString(tag.dpRef, `${what} tag.dpRef`);
    return tag;
  }
  if (shape === "expl") {
    if (tag.expl !== true) throw fail("E_PREIMAGE_SHAPE", `${what} tag.expl must be exactly true`);
    return tag;
  }
  throw fail("E_PREIMAGE_SHAPE",
    `${what} tag must be exactly { clauseRef }, { clauseRef, dpRef }, { expl: true } or null; got ${JSON.stringify(keys)}`);
}

function readSide(modules, side) {
  requireFrozen(modules, `${side}Modules`);
  if (!Array.isArray(modules)) throw fail("E_PREIMAGE_SHAPE", `${side}Modules must be an array`);

  const locators = [];
  let previous = null;
  for (let i = 0; i < modules.length; i += 1) {
    const where = `${side}Modules[${i}]`;
    const module = modules[i];
    requireFrozen(module, where);
    exactKeys(module, MODULE_KEYS, where);
    requireNonEmptyString(module.path, `${where}.path`);
    requireNonEmptyString(module.adapterId, `${where}.adapterId`);
    requireNonEmptyString(module.framework, `${where}.framework`);

    const identity = module.implementationIdentity;
    requireFrozen(identity, `${where}.implementationIdentity`);
    exactKeys(identity, IDENTITY_KEYS, `${where}.implementationIdentity`);
    // §11b.9b: three fields, all non-empty. The equality against the registry is the producer's
    // obligation and is not re-derived here -- this module never reads a registry.
    for (const key of IDENTITY_KEYS) requireNonEmptyString(identity[key], `${where}.implementationIdentity.${key}`);

    // §11b.10b ordering: strictly ascending by the (path, adapterId) tuple. Strict is the operative
    // word -- an equal tuple is a duplicate module, which the producer must already have refused.
    if (previous !== null) {
      const order = compareCodePoint(previous.path, module.path) || compareCodePoint(previous.adapterId, module.adapterId);
      if (order >= 0) {
        throw fail("E_PREIMAGE_ORDER",
          `${where} breaks the (path, adapterId) strict ascent required by §11b.10b `
          + `(${previous.path}, ${previous.adapterId}) then (${module.path}, ${module.adapterId})`,
          { side, index: i, path: module.path, adapterId: module.adapterId });
      }
    }
    previous = module;

    const declarations = module.declarations;
    requireFrozen(declarations, `${where}.declarations`);
    if (!Array.isArray(declarations)) throw fail("E_PREIMAGE_SHAPE", `${where}.declarations must be an array`);
    let previousId = null;
    for (let j = 0; j < declarations.length; j += 1) {
      const at = `${where}.declarations[${j}]`;
      const declaration = declarations[j];
      requireFrozen(declaration, at);
      exactKeys(declaration, DECLARATION_KEYS, at);
      requireNonEmptyString(declaration.structuralId, `${at}.structuralId`);
      if (typeof declaration.bodyDigest !== "string" || !DIGEST.test(declaration.bodyDigest)) {
        throw fail("E_PREIMAGE_SHAPE", `${at}.bodyDigest must be 64 lowercase hex; got ${JSON.stringify(declaration.bodyDigest)}`);
      }
      requireTag(declaration.tag, at);
      if (previousId !== null && compareCodePoint(previousId, declaration.structuralId) >= 0) {
        throw fail("E_PREIMAGE_ORDER",
          `${at} breaks the structuralId strict ascent required by §11b.10b `
          + `(${JSON.stringify(previousId)} then ${JSON.stringify(declaration.structuralId)})`,
          { side, path: module.path, structuralId: declaration.structuralId });
      }
      previousId = declaration.structuralId;

      // The flattened locator: everything a downstream producer needs from this side, and nothing
      // it does not. The module's columns are carried down onto each declaration so a pair can be
      // checked for adapter agreement without reaching back into the preimage.
      locators.push(Object.freeze({
        path: module.path,
        adapterId: module.adapterId,
        framework: module.framework,
        implementationIdentity: identity,
        structuralId: declaration.structuralId,
        tag: declaration.tag,
        bodyDigest: declaration.bodyDigest,
      }));
    }
  }
  return locators;
}

// The root key set is where the two kinds of failure part company, and they are given different
// codes because they are different accusations.
//
//   an UNDECLARED root key -> E_API_ARGUMENTS. This is the one argument a caller controls, so an
//     extra key is the only way to smuggle a registry, a parser, a Git executable, an environment, a
//     filesystem, a config, modulePaths, a view, a snapshot or a hook into a component that must not
//     have one. It is refused as an argument error, by name.
//   a MISSING root key, or a wrong type -> E_PREIMAGE_SHAPE. Nothing was injected; the value simply
//     is not a §11b.10b preimage.
//
// Nested key sets stay E_PREIMAGE_SHAPE throughout: a module or a declaration is the producer's
// shape, not the caller's argument.
function requireRootKeys(preimage) {
  const actual = Object.keys(preimage).sort();
  const wanted = [...ROOT_KEYS].sort();
  const undeclared = actual.filter((k) => !wanted.includes(k));
  if (undeclared.length > 0) {
    throw fail("E_API_ARGUMENTS",
      `the preimage carries ${JSON.stringify(undeclared)}, which §11b.10b does not declare. This component takes one `
      + "DiscoveryAnalysisPreimage and nothing else: a repoRoot, a baseTreeOid from a second source, a registry, a "
      + "parser, a Git executable, an environment, a filesystem adapter, a config, modulePaths, a content view, a "
      + "snapshot or a hook cannot ride in as an extra key",
      { undeclared });
  }
  const missing = wanted.filter((k) => !actual.includes(k));
  if (missing.length > 0) {
    throw fail("E_PREIMAGE_SHAPE", `the preimage must declare exactly ${JSON.stringify(wanted)} (missing: ${missing.join(", ")})`);
  }
  return preimage;
}

function readPreimage(preimage) {
  requireFrozen(preimage, "the preimage");
  if (preimage === null || typeof preimage !== "object" || Array.isArray(preimage)) {
    throw fail("E_PREIMAGE_SHAPE", "the preimage must be an object");
  }
  requireRootKeys(preimage);
  if (typeof preimage.baseTreeOid !== "string" || !OID.test(preimage.baseTreeOid)) {
    throw fail("E_PREIMAGE_SHAPE", `baseTreeOid must be 40 or 64 lowercase hex; got ${JSON.stringify(preimage.baseTreeOid)}`);
  }
  for (const key of ["headViewDigest", "registryDigest"]) {
    if (typeof preimage[key] !== "string" || !DIGEST.test(preimage[key])) {
      throw fail("E_PREIMAGE_SHAPE", `${key} must be 64 lowercase hex; got ${JSON.stringify(preimage[key])}`);
    }
  }
  return { base: readSide(preimage.baseModules, "base"), head: readSide(preimage.headModules, "head") };
}

// --- phase 0: stable-ID uniqueness (§11b.7) ---------------------------------------------------------
//
// Scope is ONE view, across every file that view covers, and the two views are checked separately. A
// @tid appearing once in base and once in head is the ordinary unchanged-or-moved pair and must not
// be called a duplicate; a @tid appearing twice within one view must stop the run BEFORE matching,
// because after matching a path-independent ID is no longer trustworthy for move detection.
//
// Derived "s:" keys are NOT subject to this: §11b.8 makes them unique per container chain within a
// file, and the same chain and name in two different modules is perfectly legal. Treating those as
// stable-ID duplicates would fail runs that have no ambiguity in them at all.
function assertStableIdsUnique(locators, side) {
  const seen = new Map();
  for (const locator of locators) {
    if (!locator.structuralId.startsWith(STABLE_ID_PREFIX)) continue;
    const previous = seen.get(locator.structuralId);
    if (previous !== undefined) {
      throw fail("E_STABLE_ID_DUPLICATE",
        `${side} view: stable ID ${JSON.stringify(locator.structuralId)} appears in both ${previous} and `
        + `${locator.path}. §11b.7 requires it to be unique within a view, across every file that view `
        + "covers, and this is refused before any matching runs",
        { side, structuralId: locator.structuralId, paths: [previous, locator.path] });
    }
    seen.set(locator.structuralId, locator.path);
  }
}

// --- pair agreement (§11b.9b, defensive) --------------------------------------------------------------
//
// A pair whose two sides disagree about which adapter analysed them is not a move and not a retag --
// it is a cross-view framework migration, which §11b.4 does not model. Refusing is the only honest
// answer; guessing would attribute one adapter's declaration identity to another's.
//
// v1 REACHABILITY, stated plainly: under the closed v1 registry §11b.3 admits exactly one
// implementation/framework binding and the preimage resolves both sides against one fresh registry
// root, so a conforming public input cannot produce this. It is implemented because the invariant is
// required, and no second adapter, registry override, caller injection or test-only seam was added
// to reach it -- the unit test drives it with a synthetic preimage, which is this component's real
// and only input.
// `phase`, not `relation`: the value names WHICH pairing phase was attempting this pair, and calling
// it a relation would read as a pairing record leaking out of a refusal. Nothing here returns a
// pair -- the run is over.
function assertPairAgrees(base, head, phase) {
  for (const field of ["adapterId", "framework"]) {
    if (base[field] !== head[field]) {
      throw fail("E_PAIR_IDENTITY",
        `a potential ${phase} pair for ${JSON.stringify(base.structuralId)} disagrees on ${field} `
        + `(base ${JSON.stringify(base[field])}, head ${JSON.stringify(head[field])}); a cross-view framework `
        + "migration is fail-closed and is never read as a move or a retag",
        { phase, field, structuralId: base.structuralId, baseValue: base[field], headValue: head[field] });
    }
  }
  for (const field of IDENTITY_KEYS) {
    if (base.implementationIdentity[field] !== head.implementationIdentity[field]) {
      throw fail("E_PAIR_IDENTITY",
        `a potential ${phase} pair for ${JSON.stringify(base.structuralId)} disagrees on `
        + `implementationIdentity.${field} (base ${JSON.stringify(base.implementationIdentity[field])}, head `
        + `${JSON.stringify(head.implementationIdentity[field])}); identity drift across a pair is fail-closed`,
        { phase, field: `implementationIdentity.${field}`, structuralId: base.structuralId });
    }
  }
}

// One key per side for §6 rule 1. It is (path, structuralId) exactly as the rule is written -- the
// adapterId is not part of the key, it is checked for agreement afterwards. Encoded as a JSON tuple
// rather than joined with a delimiter: with no separator there is no separator to smuggle, so two
// different pairs can never collide into one key.
const exactKey = (locator) => JSON.stringify([locator.path, locator.structuralId]);

function indexByExactKey(locators, side) {
  const index = new Map();
  for (const locator of locators) {
    const key = exactKey(locator);
    const previous = index.get(key);
    if (previous !== undefined) {
      // Two declarations at one path sharing a structuralId, which can only happen when two modules
      // share a path under different adapterIds. That is an ambiguous matching key, not a pair.
      throw fail("E_AMBIGUOUS_MATCH",
        `${side} view: ${locator.path} carries ${JSON.stringify(locator.structuralId)} more than once `
        + `(adapters ${JSON.stringify(previous.adapterId)} and ${JSON.stringify(locator.adapterId)}); the §6 `
        + "matching key is ambiguous and is refused rather than guessed",
        { side, path: locator.path, structuralId: locator.structuralId });
    }
    index.set(key, locator);
  }
  return index;
}

function groupByStructuralId(locators) {
  const groups = new Map();
  for (const locator of locators) {
    if (!groups.has(locator.structuralId)) groups.set(locator.structuralId, []);
    groups.get(locator.structuralId).push(locator);
  }
  return groups;
}

/**
 * Pair base declarations against head declarations, one to one.
 *
 * @param {object} preimage a DiscoveryAnalysisPreimage (§11b.10b), exactly as its producer returned it.
 * @returns {ReadonlyArray<Readonly<object>>} frozen pairing records, strictly ascending by testRef.
 */
export function matchBaseHeadDeclarations(preimage) {
  if (arguments.length !== 1) {
    throw fail("E_API_ARGUMENTS",
      "matchBaseHeadDeclarations takes exactly one argument; a repoRoot, a baseTreeOid, a registry, a parser, a Git "
      + "executable, an environment, a filesystem adapter, a config, modulePaths, a content view, a snapshot or a "
      + "hook cannot be supplied");
  }
  const { base, head } = readPreimage(preimage);

  // Phase 0 -- §11b.7, and it runs BEFORE any matching, on each view separately.
  assertStableIdsUnique(base, "base");
  assertStableIdsUnique(head, "head");

  const baseByExact = indexByExactKey(base, "base");
  const headByExact = indexByExactKey(head, "head");

  const pairs = [];
  const matchedBase = new Set();
  const matchedHead = new Set();

  // Phase 1 -- §6 rule 1: (path, structuralId) equal. Exact Unicode code-point equality on both
  // columns; no normalisation, no case folding, no locale. bodyDigest, tag and declaration order
  // take no part in identity -- a pair whose bodies and tags are identical is still a pair, and the
  // relation stays `same-path` whether one, both or neither moved.
  for (const [key, baseLocator] of baseByExact) {
    const headLocator = headByExact.get(key);
    if (headLocator === undefined) continue;
    assertPairAgrees(baseLocator, headLocator, "same-path");
    pairs.push({ relation: "same-path", base: baseLocator, head: headLocator });
    matchedBase.add(baseLocator);
    matchedHead.add(headLocator);
  }

  // Phase 2 -- §6 rule 2: structuralId equal, path different. Only declarations Phase 1 did not
  // consume are eligible, so an exact pair always wins over a move.
  const remainingBase = base.filter((l) => !matchedBase.has(l));
  const remainingHead = head.filter((l) => !matchedHead.has(l));
  const baseGroups = groupByStructuralId(remainingBase);
  const headGroups = groupByStructuralId(remainingHead);

  for (const [structuralId, baseCandidates] of baseGroups) {
    const headCandidates = headGroups.get(structuralId);
    // No candidate on the other side is not an ambiguity: there is simply nothing to pair with, and
    // Phase 3 will report each side on its own. That is what keeps two same-named declarations in
    // different modules from being called a stable-ID duplicate when the other view has none.
    if (headCandidates === undefined) continue;
    if (baseCandidates.length !== 1 || headCandidates.length !== 1) {
      // §11b.8 and AC104: one-to-many, many-to-one and many-to-many are all fail-closed, and must
      // never be degraded into added + deleted.
      throw fail("E_AMBIGUOUS_MATCH",
        `${JSON.stringify(structuralId)} has ${baseCandidates.length} unmatched base and `
        + `${headCandidates.length} unmatched head declaration(s); matching must be one-to-one, so this is `
        + "refused rather than guessed, and it is never split into added + deleted",
        {
          structuralId,
          base: baseCandidates.map((l) => l.path),
          head: headCandidates.map((l) => l.path),
        });
    }
    const [baseLocator] = baseCandidates;
    const [headLocator] = headCandidates;
    // Defensive: an equal path would have been consumed by Phase 1, so reaching here with one means
    // the phases have drifted apart rather than that a same-path move exists.
    if (baseLocator.path === headLocator.path) {
      throw fail("E_AMBIGUOUS_MATCH",
        `${JSON.stringify(structuralId)} reached the moved phase with an equal path ${baseLocator.path}, `
        + "which the exact phase should already have consumed");
    }
    assertPairAgrees(baseLocator, headLocator, "moved");
    // A move that also retags, or also changes the body, is still ONE moved pair (AC27).
    pairs.push({ relation: "moved", base: baseLocator, head: headLocator });
    matchedBase.add(baseLocator);
    matchedHead.add(headLocator);
  }

  // Phase 3 -- §6 rule 3, residual-side exclusivity (approved v1.13).
  //
  // Rule 3 applies ONLY when the leftovers are one-sided. When both sides still hold residual, the
  // preimage cannot distinguish a structuralId drift -- a container rename or a nesting change -- from
  // a genuine delete plus add, and §2, §11b.8 and AC36 all forbid guessing. So the whole operation
  // refuses.
  const residualBase = base.filter((l) => !matchedBase.has(l));
  const residualHead = head.filter((l) => !matchedHead.has(l));

  if (residualBase.length > 0 && residualHead.length > 0) {
    // A NAMED refusal, not an ordinary ambiguity. E_AMBIGUOUS_MATCH means "one structuralId had more
    // than one candidate"; this means "nothing in the carrier can relate these two sides at all",
    // which is a different fact and gets a different code. Nothing computed so far is returned:
    // §6 says the exact and moved pairs that already succeeded must not escape either, because a
    // partial answer would read as a complete one.
    throw fail("E_UNRESOLVED_IDENTITY_DRIFT",
      `unresolved-identity-drift: ${residualBase.length} base and ${residualHead.length} head declaration(s) `
      + "remain unmatched after the exact and moved phases. The same preimage can mean a container rename or "
      + "nesting change that moved structuralId, or a genuine delete plus add, and path, bodyDigest, tag, "
      + "framework, implementationIdentity, declaration order and count can none of them tell those apart. "
      + "The whole operation is refused rather than guessed, and no partial pairing is returned. A change that "
      + "genuinely deletes and adds must be split into two runs bounded by different bases, so each run has "
      + "residual on one side only",
      Object.freeze({
        // Diagnostics only: which declarations were left over on each side. There is deliberately no
        // pairing, no partial result and no invented alias between them -- naming a correspondence
        // here would be the very guess this refusal exists to prevent.
        baseResidualCount: residualBase.length,
        headResidualCount: residualHead.length,
        baseResidual: Object.freeze(residualBase.map((l) => Object.freeze({ path: l.path, adapterId: l.adapterId, structuralId: l.structuralId }))),
        headResidual: Object.freeze(residualHead.map((l) => Object.freeze({ path: l.path, adapterId: l.adapterId, structuralId: l.structuralId }))),
      }));
  }

  // One-sided residual is not ambiguous: there is nothing on the other side to have drifted from.
  for (const locator of residualHead) pairs.push({ relation: "added", base: null, head: locator });
  for (const locator of residualBase) pairs.push({ relation: "deleted", base: locator, head: null });

  // Ordering is the canonical testRef order the eventual entries[] will use (§2): the (path,
  // adapterId, structuralId) code-point tuple, strictly ascending, taken from the base side for a
  // deleted record and from the head side otherwise -- exactly as §6 says a deleted entry's testRef
  // comes from base.
  const withKey = pairs.map((pair) => ({ pair, key: pair.relation === "deleted" ? pair.base : pair.head }));
  withKey.sort((a, b) => compareTriple(a.key, b.key));
  for (let i = 1; i < withKey.length; i += 1) {
    if (compareTriple(withKey[i - 1].key, withKey[i].key) >= 0) {
      throw fail("E_ORDER",
        `two pairing records share the testRef tuple (${withKey[i].key.path}, ${withKey[i].key.adapterId}, `
        + `${withKey[i].key.structuralId}); the order must be strictly ascending`,
        { path: withKey[i].key.path, adapterId: withKey[i].key.adapterId, structuralId: withKey[i].key.structuralId });
    }
  }

  // `relation`, deliberately not `status`: a status is a persisted inventory column with a closed
  // enum this component has no authority over, and naming the field `status` would invite exactly
  // the confusion this boundary exists to prevent.
  return Object.freeze(withKey.map(({ pair }) => Object.freeze({
    relation: pair.relation,
    base: pair.base,
    head: pair.head,
  })));
}
