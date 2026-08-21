// buildGovernanceSeedPreimage() -- TP approved v1.15 §11b.10c, on shared approved v1.15 §2/§9.
//
// SCOPE, stated up front so a green run of this file is not misread. This builds the
// GovernanceSeedPreimage and nothing else. produceChangedTestInventoryV2(), the governance reverse
// closure, entry projection, the v2 envelope and every piece of product wiring are NOT here and are
// NOT started. A green run does not satisfy AC118, AC136, AC137 or AC138, does not lift the
// unsupported-populated-inventory gate, does not make a populated inventory acceptable, and does
// not mean Phase 2 is ready. AC172 and AC173 are out of scope for this slice.
//
// The carrier is four keys, in memory only. Nothing here writes the store, .ctide/output/**, the
// explicit config or the registry, and no failure returns a partial carrier.
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  CANONICAL_STORE_PATH, PROVENANCE_VERSION, LEGACY_PROVENANCE_VERSION,
  emptyStore, canonicalStoreBytes, storeDigest, parseStore, canonicalJson, canonicalText,
  compareCodePoint, sha256Hex, validateAll, validateLegacyV1, parseCanonicalExpiry,
} from "./provenance-store.mjs";
import { withStableHeadView } from "./head-view-snapshot.mjs";
// The fixed internal store-loader import AC171 (vii)'s shape-B proxy points at. One import, one
// call site, one read per capture -- see current-store-load.mjs for why it is its own module.
import { readCurrentStoreFile } from "./current-store-load.mjs";

export class GovernanceSeedPreimageError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = "GovernanceSeedPreimageError";
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}
const fail = (code, message, detail) => new GovernanceSeedPreimageError(code, message, detail);

const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const execFileAsync = promisify(execFile);

// Every alias §11b.10c enumerates, named individually so the refusal can say WHICH one was supplied
// rather than only that the key set was wrong. A caller who can hand in any of these can decide what
// the envelope's freshness carrier attests to, which is the whole reason the request is closed.
const FORBIDDEN_KEYS = [
  "preimage", "discoveryPreimage", "discoveryAnalysisPreimage", "governanceSeedPreimage", "seed",
  "baseModules", "headModules", "declarations", "registry", "registryPath", "registryRoot",
  "registryDigest", "parser", "ignoreMatcher", "gitExecutable", "git", "env", "environment",
  "fs", "filesystem", "config", "configPath", "explicitConfig", "modulePaths", "candidates",
  "view", "contentView", "adapterContentView", "snapshot", "headViewSnapshot", "headViewDigest",
  "storeBytes", "store", "parsedStore", "storeDigest", "inputProvenanceStoreDigest", "storePath",
  "lifecycleAffectedClauses", "governanceHit", "hitSet", "reverseClosure", "closure",
  "matcherResult", "pairs", "entries", "inventoryDigest",
  "clock", "now", "timestamp", "date", "Date", "dateProvider", "clockProvider", "T0",
  "captureHook", "hook", "componentModulePath", "modulePath", "outputPath", "output",
];

// shared §2 canonical ClauseRef grammar. The ULID authority stays in intent-scan §8; this only
// spells the ("REQ"|"DEC"|"ASSUM") "-" ULID shape the carrier is allowed to carry.
const CLAUSE_REF = /^(?:REQ|DEC|ASSUM)-[0-9A-HJKMNP-TV-Z]{26}$/;

const IMMUTABLE_SECTIONS = ["sources", "clauses", "transitions", "records"];
const ID_KEY = { sources: "sourceId", clauses: "id", transitions: "id", records: "recordId" };

// --- request ---------------------------------------------------------------------------------

function requireRequest(request, argumentCount) {
  if (argumentCount !== 1) {
    throw fail("E_API_ARGUMENTS",
      "buildGovernanceSeedPreimage takes exactly one argument; a second argument is not a place to "
      + "put a preimage, a store, a registry, a clock or a capture hook");
  }
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    throw fail("E_API_ARGUMENTS", "buildGovernanceSeedPreimage expects a request object");
  }
  const keys = Object.keys(request);
  for (const key of keys) {
    if (FORBIDDEN_KEYS.includes(key)) {
      throw fail("E_API_ARGUMENTS",
        `buildGovernanceSeedPreimage refuses the injected key ${JSON.stringify(key)}: the producer `
        + "observes every input itself, so a caller cannot supply a preimage, seed, store, digest, "
        + "hit set, entries, registry, parser, view, snapshot, clock, capture hook or module path",
        { key });
    }
  }
  const sorted = [...keys].sort();
  if (sorted.length !== 2 || sorted[0] !== "baseTreeOid" || sorted[1] !== "repoRoot") {
    throw fail("E_API_ARGUMENTS",
      `buildGovernanceSeedPreimage expects exactly ["baseTreeOid","repoRoot"]; got ${JSON.stringify(sorted)}`,
      { keys: sorted });
  }
  const { repoRoot, baseTreeOid } = request;
  if (typeof repoRoot !== "string" || repoRoot.length === 0) {
    throw fail("E_API_ARGUMENTS", `repoRoot must be a non-empty string; got ${JSON.stringify(repoRoot)}`);
  }
  if (typeof baseTreeOid !== "string" || !OID.test(baseTreeOid)) {
    throw fail("E_BASE_TREE_OID",
      `baseTreeOid must be 40 or 64 lowercase hex; got ${JSON.stringify(baseTreeOid)}. `
      + "An abbreviated OID, a ref name or a revision expression is refused rather than resolved",
      { baseTreeOid });
  }
  return { repoRoot: path.resolve(repoRoot), baseTreeOid };
}

// --- stores ----------------------------------------------------------------------------------

// The one canonical empty store, taken from shared §2 through provenance-store rather than
// re-spelled here: a second literal would be a second authority for what "empty" means.
const EMPTY = () => emptyStore();
const EMPTY_DIGEST = () => storeDigest(emptyStore());

// One capture = one read. The parsed store, its canonical digest and (for G1) the seed derivation
// all come from THIS object; nothing re-reads the file between them.
function captureCurrentStore(repoRoot, label) {
  const text = readCurrentStoreFile(repoRoot);
  if (text === null) {
    // Absence is not a signal of its own: it maps onto the canonical empty v2 store, and its digest
    // is that store's digest -- not null, not the empty string.
    return { present: false, store: EMPTY(), digest: EMPTY_DIGEST() };
  }
  let store;
  try {
    store = parseStore(text);
  } catch (error) {
    throw fail("E_CURRENT_STORE_SCHEMA",
      `${label}: the current provenance store at ${CANONICAL_STORE_PATH} is not readable as a store `
      + `(${error && error.message}); this is a schema failure, not a presence failure`,
      { label, cause: error && error.code });
  }
  if (store.provenanceVersion === LEGACY_PROVENANCE_VERSION) {
    throw fail("E_CURRENT_STORE_VERSION",
      `${label}: the current store is provenanceVersion ${LEGACY_PROVENANCE_VERSION}. It must go `
      + "through the existing migration transaction first; this producer does not migrate and does "
      + "not write back",
      { label, provenanceVersion: store.provenanceVersion });
  }
  if (store.provenanceVersion !== PROVENANCE_VERSION) {
    throw fail("E_CURRENT_STORE_VERSION",
      `${label}: the current store declares provenanceVersion ${JSON.stringify(store.provenanceVersion)}; `
      + `only ${PROVENANCE_VERSION} is a current store`,
      { label, provenanceVersion: store.provenanceVersion });
  }
  return { present: true, store, digest: sha256Hex(canonicalStoreBytes(store)) };
}

// B comes from the exact tree named in the request and from nowhere else. Reading the live current
// store as a stand-in would compare the run against itself and make lifecycleAffectedClauses
// permanently empty -- which is why this never touches the working tree.
async function captureBaseStore(repoRoot, baseTreeOid) {
  const run = async (args) => {
    const { stdout } = await execFileAsync("git", args, {
      cwd: repoRoot, encoding: "buffer", maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_CONFIG_GLOBAL: path.join(repoRoot, ".git", "ctide-absent-config"), GIT_CONFIG_SYSTEM: "" },
    });
    return stdout;
  };
  let type;
  try {
    type = (await run(["cat-file", "-t", baseTreeOid])).toString("utf8").trim();
  } catch (error) {
    throw fail("E_BASE_TREE_OID", `baseTreeOid ${baseTreeOid} is not an object in this repository`,
      { baseTreeOid, cause: error && error.code });
  }
  // The object's OWN type. A commit or tag that peels to a tree is a different witness.
  if (type !== "tree") {
    throw fail("E_BASE_TREE_OID",
      `baseTreeOid ${baseTreeOid} is a ${type}, not a tree; an object that merely PEELS to a tree is not the tree`,
      { baseTreeOid, type });
  }

  const listing = (await run(["ls-tree", "-z", "--full-tree", baseTreeOid, "--", CANONICAL_STORE_PATH]))
    .toString("utf8").replace(/\0+$/, "");
  if (listing.length === 0) {
    return { present: false, store: EMPTY(), digest: EMPTY_DIGEST() };
  }
  const tab = listing.indexOf("\t");
  if (tab < 0) throw fail("E_GIT_OUTPUT", "an ls-tree record carries no tab separator");
  const [mode, objectType, oid] = listing.slice(0, tab).split(" ");
  if (objectType !== "blob" || (mode !== "100644" && mode !== "100755")) {
    throw fail("E_BASE_STORE_ENTRY",
      `${CANONICAL_STORE_PATH} in tree ${baseTreeOid} is mode ${mode} (${objectType}); only a regular blob is a base store`,
      { mode, objectType });
  }
  const text = (await run(["cat-file", "blob", oid])).toString("utf8");
  let store;
  try {
    store = parseStore(text);
  } catch (error) {
    throw fail("E_BASE_STORE_SCHEMA",
      `the base governance state in tree ${baseTreeOid} is not readable as a store (${error && error.message})`,
      { baseTreeOid, cause: error && error.code });
  }
  // Historical, immutable, read-only: 1 and 2 are both analysable here. The migration-only
  // restriction belongs to the CURRENT mutable store and must not be pushed onto a base tree.
  if (store.provenanceVersion !== PROVENANCE_VERSION && store.provenanceVersion !== LEGACY_PROVENANCE_VERSION) {
    throw fail("E_BASE_STORE_VERSION",
      `the base store declares provenanceVersion ${JSON.stringify(store.provenanceVersion)}, which is not analysable`,
      { provenanceVersion: store.provenanceVersion });
  }
  return { present: true, store, digest: sha256Hex(canonicalStoreBytes(store)) };
}

// --- cross-snapshot immutability ---------------------------------------------------------------

function typedIndex(store, side) {
  const map = new Map();
  for (const section of IMMUTABLE_SECTIONS) {
    for (const item of store[section] || []) {
      const id = item[ID_KEY[section]];
      const typed = `${section}:${id}`;
      if (map.has(typed)) {
        throw fail("E_DUPLICATE_TYPED_ID", `${side} carries ${typed} twice`, { side, typed });
      }
      map.set(typed, canonicalJson(item));
    }
  }
  return map;
}

// Typed-ID set difference plus a shared-ID exact-equality assertion, which shared v1.15 §9 names as
// the ONE algorithm. Same id with a different payload violates INV-3, so it is an integrity failure
// and never a lifecycle seed -- a legitimate semantic update is always a NEW Clause.
function assertCrossSnapshotImmutability(base, current) {
  const b = typedIndex(base, "the base store");
  const c = typedIndex(current, "the current store");
  for (const [typed, payload] of b) {
    const here = c.get(typed);
    if (here === undefined) {
      throw fail("E_BASE_OBJECT_MISSING",
        `${typed} exists in the base store but not in the current store; immutable objects are append-only (INV-3), so this is an integrity failure, not a lifecycle seed`,
        { typed });
    }
    if (here !== payload) {
      throw fail("E_IMMUTABLE_DIVERGED",
        `${typed} has a different payload in the base and current stores; same id with different bytes violates INV-3, so this is an integrity failure, not a lifecycle seed`,
        { typed });
    }
  }
  return { b, c };
}

// --- the four sets -----------------------------------------------------------------------------

const clauseIds = (store) => (store.clauses || []).map((c) => c.id);

function semanticallyChangedClauses(base, current) {
  const before = new Set(clauseIds(base));
  return clauseIds(current).filter((id) => !before.has(id));
}

function transitionedClauses(base, current) {
  const beforeIds = new Set((base.transitions || []).map((t) => t.id));
  const fresh = (current.transitions || []).filter((t) => !beforeIds.has(t.id));
  const clauses = new Set(clauseIds(current));
  const effective = new Map();
  const out = [];
  for (const t of fresh) {
    if (!t.subject || !clauses.has(t.subject)) {
      throw fail("E_TRANSITION_DANGLING",
        `transition ${t.id} names subject ${JSON.stringify(t.subject)}, which is not a clause in the current store`,
        { transition: t.id, subject: t.subject });
    }
    if (effective.has(t.subject)) {
      throw fail("E_TRANSITION_DUPLICATE",
        `clause ${t.subject} has more than one newly effective transition (${effective.get(t.subject)} and ${t.id}); at most one is allowed`,
        { subject: t.subject });
    }
    effective.set(t.subject, t.id);
    out.push(t.subject);
  }
  // The successor is deliberately NOT added: a successor that is a new Clause is already carried by
  // semanticallyChangedClauses, and adding it here would be transitive guessing.
  return out;
}

// The direct Source set, exact and NOT recursive: a REQ's sourceRef, and for DEC/ASSUM only those
// basisRefs members whose discriminated union says Source. RecordRefs, ObservationalRefs, DPs,
// transitions and free text are never followed.
function directSourceRefs(clause) {
  if (clause.id.startsWith("REQ-")) return clause.sourceRef ? [clause.sourceRef] : [];
  const refs = [];
  for (const basis of clause.basisRefs || []) {
    if (basis && typeof basis === "object" && basis.kind === "source" && typeof basis.ref === "string") refs.push(basis.ref);
  }
  return refs;
}

// Check B against H, on H's captured regular blob bytes only. Nothing is re-read from disk, no
// symlink, junction or submodule is followed, and the locator is a stale-tolerant hint that never
// restricts which paths are searched.
//
// Boundary, stated rather than papered over: the needle is the CANONICAL excerpt bytes and the
// haystack is the blob's RAW bytes, which is what the spec says in both halves. A file stored with
// CRLF therefore will not match an excerpt whose canonical form uses LF. Normalising the haystack
// would be this layer inventing a rule the spec does not give it.
function countOccurrences(snapshot, needle) {
  let total = 0;
  for (const p of snapshot.paths()) {
    const entry = snapshot.entry(p);
    if (entry.type !== "blob") continue; // symlinks are not content; their bytes are a target string
    const hay = snapshot.read(p);
    let from = 0;
    for (;;) {
      const at = hay.indexOf(needle, from);
      if (at < 0) break;
      total += 1;
      from = at + 1; // every (path, byteStart) counts, so overlapping matches each count
    }
  }
  return total;
}

function driftedClauses(current, snapshot) {
  const sources = new Map((current.sources || []).map((s) => [s.sourceId, s]));
  const out = [];
  for (const clause of current.clauses || []) {
    let drifted = false;
    for (const ref of directSourceRefs(clause)) {
      const source = sources.get(ref);
      if (source === undefined) {
        throw fail("E_SOURCE_DANGLING",
          `clause ${clause.id} names source ${JSON.stringify(ref)}, which is not in the current store`,
          { clause: clause.id, source: ref });
      }
      if (source.driftMode !== "repo-file") continue; // snapshot-only NEVER drifts
      if (typeof source.excerpt !== "string") {
        throw fail("E_SOURCE_UNANALYSABLE",
          `source ${source.sourceId} has no string excerpt, so Check B cannot be evaluated; this fails closed rather than defaulting to not-drift`,
          { source: source.sourceId });
      }
      const needle = Buffer.from(canonicalText(source.excerpt), "utf8");
      if (needle.length === 0) {
        throw fail("E_SOURCE_UNANALYSABLE",
          `source ${source.sourceId} has an empty canonical excerpt, so an occurrence count is meaningless; this fails closed`,
          { source: source.sourceId });
      }
      // 0 -> drift. 1 -> not drift even if the locator points elsewhere. 2+ -> an anchor-ambiguity
      // observation, and explicitly NOT drift.
      if (countOccurrences(snapshot, needle) === 0) drifted = true;
    }
    if (drifted) out.push(clause.id);
  }
  return out;
}

function expiredClauses(current, t0) {
  const sources = new Map((current.sources || []).map((s) => [s.sourceId, s]));
  const out = [];
  for (const clause of current.clauses || []) {
    if (!clause.id.startsWith("REQ-")) continue; // a DEC/ASSUM never expires through its basisRefs
    const source = sources.get(clause.sourceRef);
    if (source === undefined || source.contentKind !== "exception-grant") continue;
    // The exact grammar from shared v1.15 §2, through the one authority. A legacy Date.parse
    // reading is not the v1.15 authority and is never consulted here.
    const at = parseCanonicalExpiry(source.expiry);
    if (at === null) {
      throw fail("E_EXPIRY_GRAMMAR",
        `source ${source.sourceId} has a non-canonical expiry ${JSON.stringify(source.expiry)}; a malformed chain is a validation failure, not a membership answer`,
        { source: source.sourceId });
    }
    if (at <= t0) out.push(clause.id); // equality counts as expired
  }
  return out;
}

function canonicalUnion(...sets) {
  const seen = new Set();
  for (const set of sets) for (const id of set) seen.add(id);
  const out = [...seen];
  for (const id of out) {
    if (!CLAUSE_REF.test(id)) {
      throw fail("E_CLAUSE_REF_GRAMMAR",
        `${JSON.stringify(id)} is not a canonical ClauseRef ("REQ"|"DEC"|"ASSUM" then "-" then a ULID)`,
        { clauseRef: id });
    }
  }
  out.sort(compareCodePoint);
  return out;
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return value;
}

// --- the operation -------------------------------------------------------------------------------

export async function buildGovernanceSeedPreimage(request) {
  const { repoRoot, baseTreeOid } = requireRequest(request, arguments.length);

  const base = await captureBaseStore(repoRoot, baseTreeOid);

  // One head view, stability-checked across S1/S2. The whole governance analysis happens inside,
  // so an unstable head view stops the run instead of producing a carrier from two different heads.
  const stable = await withStableHeadView({
    repoRoot,
    evaluate: async (snapshot) => {
      // G1: ONE fresh load. This parsed store serves validation, the digest and the derivation --
      // nothing between them reads the file again.
      const g1 = captureCurrentStore(repoRoot, "G1");

      // T0 is sampled HERE: after G1's parse and schema validation, before the first
      // time-dependent decision. Date.now() already returns a timezone-independent instant, so no
      // conversion or localisation is applied, and it is never sampled at import time.
      const t0 = Date.now();

      if (g1.present) validateAll(g1.store, { now: t0 });
      if (base.present) {
        if (base.store.provenanceVersion === LEGACY_PROVENANCE_VERSION) validateLegacyV1(base.store, { now: t0 });
        else validateAll(base.store, { now: t0 });
      }

      assertCrossSnapshotImmutability(base.store, g1.store);

      const lifecycleAffectedClauses = canonicalUnion(
        semanticallyChangedClauses(base.store, g1.store),
        transitionedClauses(base.store, g1.store),
        driftedClauses(g1.store, snapshot),
        expiredClauses(g1.store, t0),
      );

      // G2: the second and last fresh load, after the closure and before returning. It applies the
      // SAME current-store version rule as G1 -- so a v1 or unsupported G2 is a version/schema
      // failure on its own layer -- and only then are the canonical digests compared.
      const g2 = captureCurrentStore(repoRoot, "G2");
      // Presence is not an independent signal: a missing store and an explicitly canonical-empty
      // one hash to the same value, so both directions of missing<->empty pass here. A
      // missing->present transition fails only when the digests actually differ.
      if (g2.digest !== g1.digest) {
        throw fail("E_STORE_MOVED",
          `the current provenance store changed while the governance seed was being derived (G1 ${g1.digest}, G2 ${g2.digest}); no carrier is produced`,
          { g1: g1.digest, g2: g2.digest });
      }

      return { inputProvenanceStoreDigest: g1.digest, lifecycleAffectedClauses };
    },
  });

  return deepFreeze({
    baseTreeOid,
    headViewDigest: stable.snapshot.headViewDigest,
    inputProvenanceStoreDigest: stable.value.inputProvenanceStoreDigest,
    lifecycleAffectedClauses: stable.value.lifecycleAffectedClauses,
  });
}
