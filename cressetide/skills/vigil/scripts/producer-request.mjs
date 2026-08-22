// The ONE public request contract the two §11b.10c logical operations share.
//
// buildGovernanceSeedPreimage() and produceChangedTestInventoryV2() take the same exact request and
// refuse the same injection aliases, so the rule lives in one place. A second copy of an
// anti-injection list is the same hazard as a second copy of a grammar: the weaker copy is the one
// an attacker -- or a well-meaning caller -- finds, and nothing announces the divergence.
// TP approved v1.16: three keys, not two. §7's REQ@DP binding needs currentTaskDpIds, which lives
// on a TaskState, and a store may hold several -- so { repoRoot, baseTreeOid } cannot say which task
// is current, and guessing is the move this model fails closed on everywhere else. taskId is a fact
// the caller must state; it supplies no observed input, so it is not an injection.
export const PRODUCER_REQUEST_KEYS = ["baseTreeOid", "repoRoot", "taskId"];

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

// Returns { repoRoot, baseTreeOid } or throws. `operation` only names the caller in the message;
// it grants no behaviour of its own, so the two operations cannot drift apart in what they accept.
export function checkProducerRequest(request, argumentCount, operation) {
  if (argumentCount !== 1) {
    throw new ProducerRequestError("E_API_ARGUMENTS",
      `${operation} takes exactly one argument; a second argument is not a place to put a preimage, `
      + "a store, a registry, a clock or a capture hook");
  }
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    throw new ProducerRequestError("E_API_ARGUMENTS", `${operation} expects a request object`);
  }
  const keys = Object.keys(request);
  for (const key of keys) {
    if (FORBIDDEN_REQUEST_KEYS.includes(key)) {
      throw new ProducerRequestError("E_API_ARGUMENTS",
        `${operation} refuses the injected key ${JSON.stringify(key)}: the producer observes every `
        + "input itself, so a caller cannot supply a preimage, seed, store, digest, hit set, entries, "
        + "registry, parser, view, snapshot, clock, capture hook or module path",
        { key });
    }
  }
  const sorted = [...keys].sort();
  if (sorted.length !== PRODUCER_REQUEST_KEYS.length || sorted.some((k, i) => k !== PRODUCER_REQUEST_KEYS[i])) {
    throw new ProducerRequestError("E_API_ARGUMENTS",
      `${operation} expects exactly ${JSON.stringify(PRODUCER_REQUEST_KEYS)}; got ${JSON.stringify(sorted)}`,
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
  if (typeof taskId !== "string" || taskId.length === 0) {
    throw new ProducerRequestError("E_API_ARGUMENTS",
      `taskId must be a non-empty string; got ${JSON.stringify(taskId)}. It names which TaskState in the `
      + "current store carries the currentTaskDpIds §7 resolves REQ@DP against, and a store may hold several",
      { taskId });
  }
  return { repoRoot, baseTreeOid, taskId };
}
