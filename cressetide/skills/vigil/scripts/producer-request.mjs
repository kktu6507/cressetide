// The public request contracts of the two §11b.10c logical operations, and the ONE anti-injection
// list they share. A second copy of that list is the same hazard as a second copy of a grammar: the
// weaker copy is the one an attacker -- or a well-meaning caller -- finds, and nothing announces the
// divergence.
//
// TP approved v1.17: the two requests are NO LONGER the same. §7's REQ@DP binding needs
// currentTaskDpIds, which lives on a TaskState, and a store may hold several -- so the producer
// takes taskId as a fact the caller states (it supplies no observed input, so it is not an
// injection). buildGovernanceSeedPreimage() takes exactly two keys and never selects a TaskState:
// under v1.16's shared three-key request an absent or canonically-empty current store had no
// TaskState to resolve, so AC171 (B)(ix)/(xi) -- which require exactly that store to SUCCEED --
// could not be reached at all. taskId is therefore in the seed's refused set.
export const PRODUCER_REQUEST_KEYS = ["baseTreeOid", "repoRoot", "taskId"];
export const SEED_REQUEST_KEYS = ["baseTreeOid", "repoRoot"];

// Every alias §11b.10c enumerates, named individually so a refusal can say WHICH one was supplied
// rather than only that the key set was wrong. A caller who can hand in any of these decides what
// the envelope's freshness carrier attests to, which is the whole reason the request is closed.
export const FORBIDDEN_REQUEST_KEYS = [
  "preimage", "discoveryPreimage", "discoveryAnalysisPreimage", "governanceSeedPreimage", "seed",
  "baseModules", "headModules", "declarations", "registry", "registryPath", "registryRoot",
  "registryDigest", "parser", "ignoreMatcher", "gitExecutable", "git", "env", "environment",
  "fs", "filesystem", "config", "configPath", "explicitConfig", "modulePaths", "candidates",
  "view", "contentView", "adapterContentView", "snapshot", "headViewSnapshot", "headViewDigest",
  "storeBytes", "store", "parsedStore", "storeDigest", "inputProvenanceStoreDigest", "storePath",
  "lifecycleAffectedClauses", "governanceHit", "hitSet", "reverseClosure", "closure",
  "matcherResult", "pairs", "entries", "inventoryDigest", "inventory", "envelope",
  "clock", "now", "timestamp", "date", "Date", "dateProvider", "clockProvider", "T0",
  "captureHook", "hook", "componentModulePath", "modulePath", "outputPath", "output",
];

const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export class ProducerRequestError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = "ProducerRequestError";
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

// Returns { repoRoot, baseTreeOid, taskId } or throws. `operation` only names the caller in the
// message; it grants no behaviour of its own beyond the exact key set, so the shared half of what
// the two operations accept cannot drift apart.
export function checkProducerRequest(request, argumentCount, operation) {
  return checkRequest(request, argumentCount, operation, PRODUCER_REQUEST_KEYS);
}

// The seed's exact two keys. taskId joins the refused set here: this operation resolves no task,
// and accepting the key would re-create the v1.16 coupling AC171 (B)(ix)/(xi) fails on.
export function checkSeedRequest(request, argumentCount, operation) {
  return checkRequest(request, argumentCount, operation, SEED_REQUEST_KEYS);
}

function checkRequest(request, argumentCount, operation, wanted) {
  if (argumentCount !== 1) {
    throw new ProducerRequestError("E_API_ARGUMENTS",
      `${operation} takes exactly one argument; a second argument is not a place to put a preimage, `
      + "a store, a registry, a clock or a capture hook");
  }
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    throw new ProducerRequestError("E_API_ARGUMENTS", `${operation} expects a request object`);
  }
  // Reflect.ownKeys, not Object.keys: a non-enumerable or symbol own key is still an own key, and the
  // contract is "exactly these". Symbols are refused AFTER the two specific string diagnostics below,
  // so a request carrying a forbidden string key still reports that key, and BEFORE the sort and the
  // message, which are defined over strings.
  const ownKeys = Reflect.ownKeys(request);
  const keys = ownKeys.filter((key) => typeof key === "string");
  const takesTask = wanted.includes("taskId");
  for (const key of keys) {
    if (key === "taskId" && !takesTask) {
      throw new ProducerRequestError("E_API_ARGUMENTS",
        `${operation} refuses the key "taskId": this operation resolves no task and reads no TaskState, `
        + "so naming one would make an absent or canonically-empty current store fail where the spec "
        + "requires it to succeed",
        { key });
    }
    if (FORBIDDEN_REQUEST_KEYS.includes(key)) {
      throw new ProducerRequestError("E_API_ARGUMENTS",
        `${operation} refuses the injected key ${JSON.stringify(key)}: the producer observes every `
        + "input itself, so a caller cannot supply a preimage, seed, store, digest, hit set, entries, "
        + "registry, parser, view, snapshot, clock, capture hook or module path",
        { key });
    }
  }
  const symbolKeys = ownKeys.filter((key) => typeof key !== "string");
  if (symbolKeys.length > 0) {
    throw new ProducerRequestError("E_API_ARGUMENTS",
      `${operation} refuses the symbol-keyed own properties (${symbolKeys.map(String).join(", ")}): the request is `
      + `exactly ${JSON.stringify(wanted)}, and a key the enumerable view hides is still a key`,
      { symbols: symbolKeys.map(String) });
  }
  const sorted = [...keys].sort();
  if (sorted.length !== wanted.length || sorted.some((k, i) => k !== wanted[i])) {
    throw new ProducerRequestError("E_API_ARGUMENTS",
      `${operation} expects exactly ${JSON.stringify(wanted)}; got ${JSON.stringify(sorted)}`,
      { keys: sorted });
  }
  const { repoRoot, baseTreeOid, taskId } = request;
  if (typeof repoRoot !== "string" || repoRoot.length === 0) {
    throw new ProducerRequestError("E_API_ARGUMENTS", `repoRoot must be a non-empty string; got ${JSON.stringify(repoRoot)}`);
  }
  if (typeof baseTreeOid !== "string" || !OID.test(baseTreeOid)) {
    throw new ProducerRequestError("E_BASE_TREE_OID",
      `baseTreeOid must be 40 or 64 lowercase hex; got ${JSON.stringify(baseTreeOid)}. `
      + "An abbreviated OID, a ref name or a revision expression is refused rather than resolved",
      { baseTreeOid });
  }
  if (takesTask && (typeof taskId !== "string" || taskId.length === 0)) {
    throw new ProducerRequestError("E_API_ARGUMENTS",
      `taskId must be a non-empty string; got ${JSON.stringify(taskId)}. It names which TaskState in the `
      + "current store carries the currentTaskDpIds §7 resolves REQ@DP against, and a store may hold several",
      { taskId });
  }
  return takesTask ? { repoRoot, baseTreeOid, taskId } : { repoRoot, baseTreeOid };
}
