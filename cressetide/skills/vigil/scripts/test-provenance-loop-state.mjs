// TP v1.21 §D1/§D2: the review-loop controller's durable state — where it lives, what it may say,
// and how it is read and published.
//
// This module owns addressing (§D1.1), the closed schema (§D2.1), containment/lock/publication
// ownership (§D2.4-2.5) and the typed loop error. It performs no semantic work: ingestion is §D5's,
// the operations are §D3's.
//
// TWO KINDS OF RULE, CHARGED IN TWO PLACES. §D2.2's twelve invariants are not all decidable from one
// state, and pretending otherwise would either under-check or invent history a single file cannot
// prove:
//
//   - `describeState` is shown ONE state and charges everything that is a property of that state --
//     the closed §D2.1 shapes, and invariants 1, 2, 5, 6, 8, 9, 11, 12 plus the finiteness half of 4
//     and the sorted/unique half of 7. `publishState` runs it before the write and again on the
//     re-read, so an invalid state never reaches the filesystem and a published state is one that was
//     actually parsed back;
//   - `advance` is shown the state being REPLACED and charges the rest -- monotonicity (4), the
//     epoch-reset discipline (3), append-only baselines (7) and slot discipline (10). §D2.2:230 says
//     these hold "across cooperating transitions" only, and this module claims no more than that: it
//     is not a proof against hostile wholesale rewriting of the file.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import { canonicalJson, sha256Hex } from "./canonical-json.mjs";
// TP §6:537's closed finding-kind enum, as the store already declares it. It is imported rather than
// restated: a fifth copy of the four values could drift from the writer's and the consumer's while
// each looked correct alone. This is a frozen constant, not behaviour, and it introduces no cycle —
// `provenance-store.mjs` imports only `canonical-json.mjs`, `changed-test-inventory.mjs` and
// `batch-result-binding.mjs`, none of which reach this module.
import { FINDING_KIND_ORDER } from "./provenance-store.mjs";

export class LoopError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = "LoopError";
    this.code = code;
    this.detail = detail;
  }
}

export const fail = (code, message, detail = null) => new LoopError(code, message, detail);

// --- §D1 placement and addressing ------------------------------------------------------------------

export const LOOP_PREFIX = ".ctide/test-provenance-loop";
export const LOOP_CONTROL_VERSION = 1;
export const MAX_EPOCH_ADMISSIONS = 8;

// §D1.1: the address hashes canonicalJson(taskId), NEVER the raw taskId. sha256Hex canonicalises its
// input -- a leading BOM is stripped and CRLF/CR fold to LF -- and Node's encoder maps a lone
// surrogate to U+FFFD, so three pairs of distinct legal TaskState keys collide under direct hashing.
// JSON.stringify escapes CR, LF and lone surrogates and puts a quote in front of any BOM, so none of
// the three survives. The filename is an INDEX, never an identity: every load re-compares the exact
// taskId string and the full base witness.
export const taskHash = (taskId) => sha256Hex(canonicalJson(taskId));

export const loopPaths = (repoRoot, taskId) => {
  const h = taskHash(taskId);
  const dir = path.join(repoRoot, ...LOOP_PREFIX.split("/"));
  return {
    dir,
    emitLock: path.join(dir, "emit.lock"),
    state: path.join(dir, `task-${h}.json`),
    taskLock: path.join(dir, `task-${h}.lock`),
    review: path.join(dir, `task-${h}.review.json`),
    governance: path.join(dir, `task-${h}.governance.json`),
    payload: (admissionId) => path.join(dir, `task-${h}.${admissionId}.payload.json`),
    hash: h,
  };
};

export const newId = () => crypto.randomBytes(16).toString("hex");
export const rawSha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

// --- §D2.4 containment ------------------------------------------------------------------------------

// Walk each EXISTING component from the repository root: refuse a symlink or non-directory, and
// refuse a resolved path outside the repository. This runs before lock creation and before every read
// and write. A read-only operation stops here and creates nothing.
export function assertContainedPrefix(repoRoot, { create = false } = {}) {
  const root = path.resolve(repoRoot);
  let current = root;
  let rootReal;
  try {
    rootReal = fs.realpathSync.native(root);
  } catch {
    throw fail("E_LOOP_IO", `the repository root ${root} does not resolve`, { path: root });
  }
  for (const segment of LOOP_PREFIX.split("/")) {
    current = path.join(current, segment);
    let stat = null;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error && error.code === "ENOENT") {
        if (!create) return { present: false, dir: current };
        try {
          fs.mkdirSync(current);
        } catch (e) {
          if (!e || e.code !== "EEXIST") {
            throw fail("E_LOOP_IO", `cannot create ${current} (${e && e.code})`, { path: current });
          }
        }
        stat = fs.lstatSync(current);
      } else {
        throw fail("E_LOOP_IO", `cannot inspect ${current} (${error && error.code})`, { path: current });
      }
    }
    if (stat.isSymbolicLink()) {
      throw fail("E_LOOP_IO", `${current} is a symbolic link; the control prefix is refused rather than followed`, { path: current });
    }
    if (!stat.isDirectory()) {
      throw fail("E_LOOP_IO", `${current} is occupied by a non-directory`, { path: current });
    }
    const real = fs.realpathSync.native(current);
    if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
      throw fail("E_LOOP_IO", `${current} resolves outside the repository`, { path: current });
    }
  }
  return { present: true, dir: current };
}

export function assertRegularOrAbsent(file, what) {
  let stat = null;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    throw fail("E_LOOP_IO", `cannot inspect ${what} (${error && error.code})`, { path: file });
  }
  if (!stat.isFile()) {
    throw fail("E_LOOP_IO", `${what} is not a regular file`, { path: file });
  }
  return true;
}

// --- §D2.5 locks --------------------------------------------------------------------------------------

// The per-task lock spans the WHOLE read/validate/mutate/publish sequence INCLUDING awaited regions.
// Diagnose only: there is no automatic break and no break command. Release unlinks only a lock this
// acquisition still owns, so one holder's cleanup can never delete another's.
export async function withLock(file, body) {
  const token = `${process.pid}:${crypto.randomBytes(8).toString("hex")}`;
  let handle;
  try {
    handle = fs.openSync(file, "wx");
    fs.writeSync(handle, `${canonicalJson({ token, pid: process.pid, hostname: os.hostname(), startedAt: Date.now() })}\n`);
    fs.closeSync(handle);
    handle = undefined;
  } catch (error) {
    if (handle !== undefined) { try { fs.closeSync(handle); } catch { /* nothing to salvage */ } }
    if (error && error.code === "EEXIST") {
      let owner = "";
      try { owner = fs.readFileSync(file, "utf8").trim(); } catch { /* diagnosis is best effort */ }
      throw fail("E_LOOP_LOCK_HELD",
        `another operation holds ${file}${owner ? ` (${owner})` : ""}; recovery is an operator process, never an automatic break`,
        { path: file });
    }
    if (error instanceof LoopError) throw error;
    throw fail("E_LOOP_IO", `cannot acquire ${file} (${error && error.code})`, { path: file });
  }
  try {
    return await body();
  } finally {
    // EXACT ownership, not a substring sighting. §D2.5's operator process verifies "token and file
    // identity", and cleanup owes the same standard: parse the file and require the recorded token to
    // BE ours. Malformed content is not ours either -- a file this acquisition wrote is parseable, so
    // anything that is not parseable was written by something else and is left in place to be
    // diagnosed. Deleting an unrelated holder's lock is strictly worse than leaving one behind.
    try {
      if (fs.existsSync(file)) {
        let held = null;
        try {
          held = JSON.parse(fs.readFileSync(file, "utf8"));
        } catch { /* not parseable, therefore not ours */ }
        if (held !== null && typeof held === "object" && held.token === token) {
          fs.rmSync(file, { force: true });
        }
      }
    } catch { /* best effort: never mask the original outcome */ }
  }
}

// --- §D2.1 the closed schema -------------------------------------------------------------------------

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isSafeCount = (v) => Number.isSafeInteger(v) && v >= 0;
const HEX32 = /^[0-9a-f]{32}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const isHex32 = (v) => typeof v === "string" && HEX32.test(v);
const isHex64 = (v) => typeof v === "string" && HEX64.test(v);
const isText = (v) => typeof v === "string" && v !== "";
const isNullableText = (v) => v === null || isText(v);

// §D2.1 is a CLOSED schema: "every field declared". An undeclared member is a contract violation, not
// a tolerated extra, so every shape below is charged as an EXACT own-key set. Optional members are
// passed separately and are exactly the two the document declares optional -- `binding.dpRef` and
// `Chosen.compatibility`, which §D5.5 says is "omitted entirely" unless §D9.1 requires it.
//
// `hasOwnProperty` rather than a value test, because a key present holding `undefined` is a third
// state: canonicalJson would silently drop it at publication, so a state carrying one must be refused
// BEFORE the write rather than published as a state missing a declared field.
function keySetFault(what, value, required, optional = []) {
  if (!isPlainObject(value)) return `${what} must be a JSON object`;
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) return `${what} is missing ${key}`;
  }
  const declared = new Set([...required, ...optional]);
  const undeclared = Object.keys(value).filter((k) => !declared.has(k)).sort();
  if (undeclared.length > 0) return `${what} carries undeclared member(s) ${undeclared.join(", ")}`;
  return null;
}

const fields = (what, value, spec) => {
  for (const [key, ok, expected] of spec) {
    if (!ok(value[key])) return `${what}.${key} must be ${expected}`;
  }
  return null;
};

// A closed variant union, keyed on `kind`. An unknown kind names no shape at all.
function variantFault(what, value, table) {
  if (!isPlainObject(value)) return `${what} must be a JSON object`;
  const shape = Object.prototype.hasOwnProperty.call(table, value.kind) ? table[value.kind] : null;
  if (shape === null) return `${what} has unknown kind ${JSON.stringify(value.kind)}`;
  const set = keySetFault(`${what} (kind ${value.kind})`, value, shape.required, shape.optional || []);
  if (set !== null) return set;
  return shape.check ? shape.check(value) : null;
}

const listFault = (what, value, each) => {
  if (!Array.isArray(value)) return `${what} must be an array`;
  for (let i = 0; i < value.length; i += 1) {
    const fault = each(`${what}[${i}]`, value[i]);
    if (fault !== null) return fault;
  }
  return null;
};

const sortedUniqueFault = (what, value) => {
  if (!Array.isArray(value) || value.some((v) => !isText(v))) return `${what} must be an array of non-empty strings`;
  const keys = value.map((v) => canonicalJson(v));
  if (canonicalJson(keys) !== canonicalJson([...keys].sort())) return `${what} must be sorted`;
  if (new Set(keys).size !== keys.length) return `${what} must be unique`;
  return null;
};

const baseProvenanceFault = (what, v) => keySetFault(what, v, ["treeOid", "storePath", "storeDigest"])
  || fields(what, v, [
    ["treeOid", isText, "a non-empty string"],
    ["storePath", isText, "a non-empty string"],
    ["storeDigest", isText, "a non-empty string"],
  ]);

export const typedRefFault = (what, v) => keySetFault(what, v, ["kind", "ref"])
  || fields(what, v, [["kind", isText, "a non-empty string"], ["ref", isText, "a non-empty string"]]);

// §D2.1: ONE FindingIdentity everywhere a finding is named, with `binding` present as a declared
// member whose value may be null. A 4-tuple omitting `binding` is forbidden.
//
// Exported because §D5.5 names the SAME type in a `GovernancePackage` and a `PendingDeclaration`. A
// second copy in the review module could drift from this one and the two would then disagree about
// what identifies a finding — which is precisely the collapse §D2.1:134 forbids.
export function findingIdentityFault(what, v) {
  const set = keySetFault(what, v, ["testRef", "kind", "binding"]);
  if (set !== null) return set;
  const ref = keySetFault(`${what}.testRef`, v.testRef, ["path", "adapterId", "structuralId"])
    || fields(`${what}.testRef`, v.testRef, [
      ["path", isText, "a non-empty string"],
      ["adapterId", isText, "a non-empty string"],
      ["structuralId", isText, "a non-empty string"],
    ]);
  if (ref !== null) return ref;
  // §D2.1:130 says `kind` is "a TP §6 finding kind", and §6:537 declares that as a CLOSED four-value
  // enum. A non-empty-string check accepted a fifth value, so a state naming a finding kind no
  // reviewer contract defines read as valid. §D2.3 makes a schema failure corruption, and that has to
  // hold on every read whatever wrote the bytes: the admission scan already refuses an unknown kind,
  // so this is the second line of defence against a state that never came through it.
  if (!FINDING_KIND_ORDER.includes(v.kind)) {
    return `${what}.kind must be one of ${FINDING_KIND_ORDER.join(", ")}`;
  }
  if (v.binding === null) return null;
  return keySetFault(`${what}.binding`, v.binding, ["clauseRef"], ["dpRef"])
    || fields(`${what}.binding`, v.binding, [["clauseRef", isText, "a non-empty string"]])
    || (Object.prototype.hasOwnProperty.call(v.binding, "dpRef") && !isText(v.binding.dpRef)
      ? `${what}.binding.dpRef, when stated, must be a non-empty string` : null);
}

const witnessRefFault = (what, v) => keySetFault(what, v, ["branch", "source", "recordId", "packageDigest"])
  || fields(what, v, [
    ["branch", (x) => WITNESS_BRANCHES.includes(x), `one of ${WITNESS_BRANCHES.join(", ")}`],
    ["source", (x) => WITNESS_SOURCES.includes(x), `one of ${WITNESS_SOURCES.join(", ")}`],
    ["recordId", isText, "a non-empty string"],
    ["packageDigest", (x) => x === null || isHex64(x), "hex64 or null"],
  ]);

const tailEntryFault = (what, v) => keySetFault(what, v, ["fingerprint", "epochOrdinal", "admissionId"])
  || fields(what, v, [
    ["fingerprint", isHex64, "hex64"],
    ["epochOrdinal", isSafeCount, "a non-negative safe integer"],
    ["admissionId", isHex32, "hex32"],
  ]);

// §D5.5's PendingDeclaration. `governance` is a two-variant closed union; `Chosen.compatibility` is
// the one genuinely optional member and is omitted entirely unless §D9.1 requires it.
const GOVERNANCE_VARIANTS = {
  undecided: { required: ["kind"] },
  chosen: {
    required: ["kind", "action", "successor", "requiredAuthorityKind", "reroutedPrincipal", "witness"],
    optional: ["compatibility"],
    check: (v) => fields("Chosen", v, [
      ["action", (x) => ["supersede", "retire", "revise"].includes(x), "supersede, retire or revise"],
      ["successor", isNullableText, "a clause id or null"],
      ["requiredAuthorityKind", (x) => ["user", "discipline", "arbiter", "source-authority"].includes(x),
        "user, discipline, arbiter or source-authority"],
      ["reroutedPrincipal", (x) => x === null || isPlainObject(x), "a ReviewerPrincipal or null"],
    ])
      || (Object.prototype.hasOwnProperty.call(v, "compatibility")
        ? keySetFault("Chosen.compatibility", v.compatibility, ["impact", "disposition"]) : null)
      || variantFault("Chosen.witness", v.witness, {
        absent: { required: ["kind"] },
        persisted: { required: ["kind", "recordId"], check: (w) => (isText(w.recordId) ? null : "Chosen.witness.recordId must be a non-empty string") },
        draft: {
          required: ["kind", "recordId", "packageDigest"],
          check: (w) => fields("Chosen.witness", w, [
            ["recordId", isText, "a non-empty string"], ["packageDigest", isHex64, "hex64"]]),
        },
      }),
  },
};

export const pendingDeclarationFault = (what, v) => keySetFault(what, v, ["identity", "governance"])
  || findingIdentityFault(`${what}.identity`, v.identity)
  || variantFault(`${what}.governance`, v.governance, GOVERNANCE_VARIANTS);

const VERDICT_KEYS = ["taskId", "committedBatchRef", "batchDigest", "inventoryDigest",
  "baseTreeOid", "headViewDigest", "registryDigest"];

// §D2.1: the projection holds exactly the consumer's seven identity fields. `converged` is NOT among
// them, and a stored copy would be a second authority for a verdict only a fresh run can establish.
const verdictFault = (what, v) => keySetFault(what, v, VERDICT_KEYS)
  || typedRefFault(`${what}.committedBatchRef`, v.committedBatchRef)
  || fields(what, v, [
    ["taskId", isText, "a non-empty string"],
    ["batchDigest", isHex64, "hex64"],
    ["inventoryDigest", isHex64, "hex64"],
    ["baseTreeOid", isText, "a non-empty string"],
    ["headViewDigest", isHex64, "hex64"],
    ["registryDigest", isHex64, "hex64"],
  ]);

const refusedCheck = (what) => (v) => fields(what, v, [
  ["class", isText, "a non-empty string"],
  ["code", isNullableText, "a non-empty string or null"],
]);

const attemptOutcomeFault = (what, v) => variantFault(what, v, {
  ok: { required: ["kind"] },
  refused: { required: ["kind", "class", "code"], check: refusedCheck(what) },
  pass: { required: ["kind", "verdict"], check: (o) => verdictFault(`${what}.verdict`, o.verdict) },
  unknown: { required: ["kind"] },
});

const attemptSlotFault = (what, v) => keySetFault(what, v,
  ["attemptId", "at", "epochOrdinal", "emissionId", "admissionId", "headRef", "phase", "outcome"])
  || fields(what, v, [
    ["attemptId", isHex32, "hex32"],
    ["at", isSafeCount, "a non-negative safe integer"],
    ["epochOrdinal", isSafeCount, "a non-negative safe integer"],
    ["emissionId", (x) => x === null || isHex32(x), "hex32 or null"],
    ["admissionId", (x) => x === null || isHex32(x), "hex32 or null"],
    ["phase", (x) => x === "pending" || x === "completed", "pending or completed"],
  ])
  || (v.headRef === null ? null : typedRefFault(`${what}.headRef`, v.headRef))
  // §D2.1 states the coupling as an iff: `outcome: null` exactly when phase is "pending".
  || (v.phase === "pending"
    ? (v.outcome === null ? null : `${what} is pending, so it carries no outcome`)
    : (v.outcome === null ? `${what} is completed, so it states an outcome` : attemptOutcomeFault(`${what}.outcome`, v.outcome)));

// `expectedBatchRecord` is a COMPLETE STORE RECORD, whose shape the provenance store owns. Charging a
// closed key set on it here would create a second and competing record schema, so only the members
// this controller itself reads are charged; the store's own validation remains the authority.
const storeRecordFault = (what, v) => (isPlainObject(v) && isText(v.recordId) && isText(v.kind)
  ? null : `${what} must be a store record stating recordId and kind`);

const commitIntentFault = (what, v) => keySetFault(what, v,
  ["admissionId", "batchRecordId", "expectedPreviousBatchRef", "expectedInputProvenanceStoreDigest",
    "inventoryDigest", "expectedBatchRecord", "payloadRawDigest", "retainedPayloadPath", "phase",
    "attemptedAt", "outcome"])
  || fields(what, v, [
    ["admissionId", isHex32, "hex32"],
    ["batchRecordId", isText, "a non-empty string"],
    ["expectedInputProvenanceStoreDigest", isHex64, "hex64"],
    ["inventoryDigest", isHex64, "hex64"],
    ["payloadRawDigest", isHex64, "hex64"],
    ["retainedPayloadPath", isText, "a non-empty string"],
    ["phase", (x) => x === "prepared" || x === "attempted", "prepared or attempted"],
    ["attemptedAt", (x) => x === null || isSafeCount(x), "a non-negative safe integer or null"],
  ])
  || (v.expectedPreviousBatchRef === null ? null : typedRefFault(`${what}.expectedPreviousBatchRef`, v.expectedPreviousBatchRef))
  || storeRecordFault(`${what}.expectedBatchRecord`, v.expectedBatchRecord)
  || (v.outcome === null ? null : variantFault(`${what}.outcome`, v.outcome, {
    committed: { required: ["kind"] },
    refused: { required: ["kind", "class", "code"], check: refusedCheck(`${what}.outcome`) },
    unknown: { required: ["kind"] },
  }));

const committedFault = (what, v) => keySetFault(what, v,
  ["admissionId", "headRef", "batchDigest", "inventoryDigest", "baseProvenance", "headViewDigest",
    "registryDigest", "payloadRawDigest", "fingerprint", "expectedBatchRecord"])
  || fields(what, v, [
    ["admissionId", isHex32, "hex32"],
    ["batchDigest", isHex64, "hex64"],
    ["inventoryDigest", isHex64, "hex64"],
    ["headViewDigest", isHex64, "hex64"],
    ["registryDigest", isHex64, "hex64"],
    ["payloadRawDigest", isHex64, "hex64"],
    ["fingerprint", isHex64, "hex64"],
  ])
  || typedRefFault(`${what}.headRef`, v.headRef)
  || baseProvenanceFault(`${what}.baseProvenance`, v.baseProvenance)
  || storeRecordFault(`${what}.expectedBatchRecord`, v.expectedBatchRecord);

const emissionFault = (what, v) => keySetFault(what, v,
  ["emissionId", "request", "returned", "artifactRawDigest", "artifactHeader", "storeTextDigest",
    "capturedHeadViewDigest", "capturedRegistryDigest", "observation"])
  || fields(what, v, [
    ["emissionId", isHex32, "hex32"],
    ["artifactRawDigest", isHex64, "hex64"],
    ["storeTextDigest", isHex64, "hex64"],
    ["capturedHeadViewDigest", isHex64, "hex64"],
    ["capturedRegistryDigest", isHex64, "hex64"],
  ])
  || keySetFault(`${what}.request`, v.request, ["repoRoot", "baseTreeOid", "taskId"])
  || fields(`${what}.request`, v.request, [
    ["repoRoot", isText, "a non-empty string"],
    ["baseTreeOid", isText, "a non-empty string"],
    ["taskId", isText, "a non-empty string"],
  ])
  || keySetFault(`${what}.returned`, v.returned, ["path", "inventoryDigest"])
  || fields(`${what}.returned`, v.returned, [
    ["path", isText, "a non-empty string"], ["inventoryDigest", isHex64, "hex64"]])
  || keySetFault(`${what}.artifactHeader`, v.artifactHeader,
    ["baseTreeOid", "headViewDigest", "registryDigest", "inputProvenanceStoreDigest", "inventoryDigest"])
  || fields(`${what}.artifactHeader`, v.artifactHeader, [
    ["baseTreeOid", isText, "a non-empty string"],
    ["headViewDigest", isHex64, "hex64"],
    ["registryDigest", isHex64, "hex64"],
    ["inputProvenanceStoreDigest", isHex64, "hex64"],
    ["inventoryDigest", isHex64, "hex64"],
  ])
  || (v.observation === null ? null
    : keySetFault(`${what}.observation`, v.observation, ["inventoryDigest", "oracleDepTriggered"])
      || fields(`${what}.observation`, v.observation, [
        ["inventoryDigest", isHex64, "hex64"],
        // A COUNT of tests drawn in by an effective-oracle dependency, which the observer degrades to
        // the string "unknown" when its sidecar is unreadable — "a sidecar fault never sinks a
        // record". Both are recorded as observed; neither is normalised into the other.
        ["oracleDepTriggered", (x) => x === "unknown" || isSafeCount(x), 'a non-negative safe integer or "unknown"'],
      ]));

const admissionFault = (what, v) => keySetFault(what, v,
  ["admissionId", "at", "epochOrdinal", "emissionId", "reviewRawDigest", "governanceRawDigest",
    "fingerprint", "commitReady", "batchRecordId", "retainedPayloadPath", "payloadRawDigest",
    "admittedClaims", "findingIdentities", "phase", "closeReason"])
  || fields(what, v, [
    ["admissionId", isHex32, "hex32"],
    ["at", isSafeCount, "a non-negative safe integer"],
    ["epochOrdinal", isSafeCount, "a non-negative safe integer"],
    ["emissionId", isHex32, "hex32"],
    ["reviewRawDigest", isHex64, "hex64"],
    ["governanceRawDigest", isHex64, "hex64"],
    ["fingerprint", isHex64, "hex64"],
    ["commitReady", (x) => typeof x === "boolean", "a boolean"],
    ["batchRecordId", isText, "a non-empty string"],
    ["retainedPayloadPath", isText, "a non-empty string"],
    ["payloadRawDigest", isHex64, "hex64"],
    ["phase", (x) => ADMISSION_PHASES.includes(x), `one of ${ADMISSION_PHASES.join(", ")}`],
  ])
  || keySetFault(`${what}.admittedClaims`, v.admittedClaims, ["taskId", "baseProvenance", "inventoryDigest"])
  || fields(`${what}.admittedClaims`, v.admittedClaims, [
    ["taskId", isText, "a non-empty string"], ["inventoryDigest", isHex64, "hex64"]])
  || baseProvenanceFault(`${what}.admittedClaims.baseProvenance`, v.admittedClaims.baseProvenance)
  || listFault(`${what}.findingIdentities`, v.findingIdentities, findingIdentityFault)
  || (v.closeReason === null ? null
    : keySetFault(`${what}.closeReason`, v.closeReason, ["stage", "kind", "class", "code"])
      || fields(`${what}.closeReason`, v.closeReason, [
        ["stage", (x) => CLOSE_STAGES.includes(x), `one of ${CLOSE_STAGES.join(", ")}`],
        ["kind", (x) => CLOSE_KINDS.includes(x), `one of ${CLOSE_KINDS.join(", ")}`],
        ["class", isNullableText, "a non-empty string or null"],
        ["code", isNullableText, "a non-empty string or null"],
      ])
      // §D3.1: a KNOWN refusal always names its class; both-null belongs to `unknown` and to the
      // explicitly non-error not-ready / repeat dispositions.
      || (v.closeReason.kind === "refused" && v.closeReason.class === null
        ? `${what}: a known refused closeReason always carries a class` : null));

const lockFault = (what, v) => keySetFault(what, v, ["reason", "fingerprint", "at", "duplicateOf", "lockedFindings"])
  || fields(what, v, [
    ["reason", (x) => LOCK_REASONS.includes(x), `one of ${LOCK_REASONS.join(", ")}`],
    ["fingerprint", isHex64, "hex64"],
    ["at", isSafeCount, "a non-negative safe integer"],
  ])
  || (v.duplicateOf === null ? null
    : keySetFault(`${what}.duplicateOf`, v.duplicateOf, ["epochOrdinal", "admissionId"])
      || fields(`${what}.duplicateOf`, v.duplicateOf, [
        ["epochOrdinal", isSafeCount, "a non-negative safe integer"], ["admissionId", isHex32, "hex32"]]))
  || listFault(`${what}.lockedFindings`, v.lockedFindings, findingIdentityFault);

const consumedWitnessFault = (what, v) => keySetFault(what, v, ["recordId", "packageDigest", "branch", "atEpoch"])
  || fields(what, v, [
    ["recordId", isText, "a non-empty string"],
    ["packageDigest", (x) => x === null || isHex64(x), "hex64 or null"],
    ["branch", (x) => WITNESS_BRANCHES.includes(x), `one of ${WITNESS_BRANCHES.join(", ")}`],
    ["atEpoch", isSafeCount, "a non-negative safe integer"],
  ]);

const counterFault = (what, v) => keySetFault(what, v, ["observed", "uncertain"])
  || fields(what, v, [
    ["observed", isSafeCount, "a non-negative safe integer"],
    ["uncertain", (x) => typeof x === "boolean", "a boolean"],
  ]);

const STATE_KEYS = [
  "loopControlVersion", "revision", "taskId", "baseProvenance", "createdAgainstStoreDigest",
  "knownRecordIds", "knownDraftIds", "consumedWitnesses", "epoch", "closedEpochAdmissions",
  "observedIterations", "observedEpochs", "priorHistory", "lastTwo", "currentAdmissionId", "lock",
  "pending", "lastEmission", "attempts", "pendingCommit", "committed", "currentPassInvalidated",
  "counters", "status",
];

export const ADMISSION_PHASES = ["open", "committed", "verified", "refused", "closed"];
export const TERMINAL_PHASES = ["verified", "refused", "closed"];
export const CLOSE_STAGES = ["not-ready", "preview", "writer", "verification"];
export const CLOSE_KINDS = ["not-ready", "repeat", "refused", "unknown"];
export const LOCK_REASONS = ["repeat", "cap-exhausted"];
export const WITNESS_BRANCHES = ["transition-governance", "semantic-reconsideration"];
export const WITNESS_SOURCES = ["persisted", "draft"];
export const SLOT_NAMES = ["emit", "observe", "verification"];

export function initialState({ taskId, baseProvenance, createdAgainstStoreDigest, knownRecordIds, knownDraftIds }) {
  return {
    loopControlVersion: LOOP_CONTROL_VERSION,
    revision: 1,                       // §D5.1: revision counts successful publications
    taskId,
    baseProvenance: { ...baseProvenance },
    createdAgainstStoreDigest,
    knownRecordIds: [...knownRecordIds].sort(),
    knownDraftIds: [...knownDraftIds].sort(),
    consumedWitnesses: [],
    epoch: { ordinal: 1, openedBy: null, admitted: [] },
    closedEpochAdmissions: 0,
    observedIterations: 0,
    observedEpochs: 1,
    priorHistory: "unknown",
    lastTwo: [null, null],
    currentAdmissionId: null,
    lock: null,
    pending: [],
    lastEmission: null,
    attempts: { emit: null, observe: null, verification: null },
    pendingCommit: null,
    committed: null,
    currentPassInvalidated: true,
    counters: {
      adapterMisses: { observed: 0, uncertain: false },
      staleBatchRejections: { observed: 0, uncertain: false },
      lastStaleSubject: null,
    },
    status: "open",
  };
}

function shapeFault(state) {
  const root = keySetFault("the control state", state, STATE_KEYS);
  if (root !== null) return root;
  const scalars = fields("the control state", state, [
    ["loopControlVersion", (x) => x === LOOP_CONTROL_VERSION, `${LOOP_CONTROL_VERSION}`],
    ["revision", (x) => isSafeCount(x) && x >= 1, "a positive safe integer"],
    ["taskId", isText, "a non-empty string"],
    ["createdAgainstStoreDigest", isHex64, "hex64"],
    ["closedEpochAdmissions", isSafeCount, "a non-negative safe integer"],
    ["observedIterations", isSafeCount, "a non-negative safe integer"],
    ["observedEpochs", isSafeCount, "a non-negative safe integer"],
    ["priorHistory", (x) => x === "unknown", '"unknown"'],
    ["currentAdmissionId", (x) => x === null || isHex32(x), "hex32 or null"],
    ["currentPassInvalidated", (x) => typeof x === "boolean", "a boolean"],
    ["status", (x) => x === "open" || x === "locked", '"open" or "locked"'],
  ]);
  if (scalars !== null) return scalars;

  const parts = [
    baseProvenanceFault("baseProvenance", state.baseProvenance),
    // §D2.2 invariant 7's state-decidable half. `consumedWitnesses` is sorted and unique on its whole
    // entry, not merely on `recordId`: the same record may not be consumed twice in one control life.
    sortedUniqueFault("knownRecordIds", state.knownRecordIds),
    sortedUniqueFault("knownDraftIds", state.knownDraftIds),
    listFault("consumedWitnesses", state.consumedWitnesses, consumedWitnessFault),
    keySetFault("epoch", state.epoch, ["ordinal", "openedBy", "admitted"]),
  ];
  for (const fault of parts) if (fault !== null) return fault;

  const witnessKeys = state.consumedWitnesses.map((c) => canonicalJson(c));
  if (canonicalJson(witnessKeys) !== canonicalJson([...witnessKeys].sort())) return "consumedWitnesses must be sorted";
  if (new Set(witnessKeys).size !== witnessKeys.length) return "consumedWitnesses must be unique";

  if (!isSafeCount(state.epoch.ordinal)) return "epoch.ordinal must be a non-negative safe integer";
  if (state.epoch.openedBy !== null) {
    const fault = witnessRefFault("epoch.openedBy", state.epoch.openedBy);
    if (fault !== null) return fault;
  }
  const admitted = listFault("epoch.admitted", state.epoch.admitted, admissionFault);
  if (admitted !== null) return admitted;

  if (!Array.isArray(state.lastTwo) || state.lastTwo.length !== 2) return "lastTwo must hold exactly two slots";
  for (let i = 0; i < 2; i += 1) {
    if (state.lastTwo[i] === null) continue;
    const fault = tailEntryFault(`lastTwo[${i}]`, state.lastTwo[i]);
    if (fault !== null) return fault;
  }
  if (state.lock !== null) {
    const fault = lockFault("lock", state.lock);
    if (fault !== null) return fault;
  }
  const pending = listFault("pending", state.pending, pendingDeclarationFault);
  if (pending !== null) return pending;

  if (state.lastEmission !== null) {
    const fault = emissionFault("lastEmission", state.lastEmission);
    if (fault !== null) return fault;
  }
  const slots = keySetFault("attempts", state.attempts, SLOT_NAMES);
  if (slots !== null) return slots;
  for (const slot of SLOT_NAMES) {
    if (state.attempts[slot] === null) continue;
    const fault = attemptSlotFault(`attempts.${slot}`, state.attempts[slot]);
    if (fault !== null) return fault;
  }
  if (state.pendingCommit !== null) {
    const fault = commitIntentFault("pendingCommit", state.pendingCommit);
    if (fault !== null) return fault;
  }
  if (state.committed !== null) {
    const fault = committedFault("committed", state.committed);
    if (fault !== null) return fault;
  }
  return keySetFault("counters", state.counters, ["adapterMisses", "staleBatchRejections", "lastStaleSubject"])
    || counterFault("counters.adapterMisses", state.counters.adapterMisses)
    || counterFault("counters.staleBatchRejections", state.counters.staleBatchRejections)
    || (isNullableText(state.counters.lastStaleSubject) ? null
      : "counters.lastStaleSubject must be a non-empty string or null");
}

// §D2.2, the STATE-DECIDABLE rules only. One published state is all this function is shown, so it
// establishes 1, 2, 5, 6, 8, 9, 11 and 12 in full, and the per-state half of 4 (finiteness, above)
// and 7 (sorted and unique, above).
//
// The remaining content of 3, 4 and 7 and the whole of 10 are HISTORY, not properties of a single
// state: monotonicity, the epoch-reset discipline, append-only baselines and slot discipline each
// compare a state with the one it replaced. They are charged by `transitionFault` on every `advance`,
// which §D2.2:230 is explicit about -- "enforced across cooperating transitions… not a proof against
// hostile wholesale rewriting of the file". `lastTwo` is transition-enforced for the same reason.
function invariantFault(state) {
  const admitted = state.epoch.admitted;
  if (admitted.length > MAX_EPOCH_ADMISSIONS) return "1: epoch.admitted exceeds the cap";
  if (state.observedIterations !== state.closedEpochAdmissions + admitted.length) {
    return "2: observedIterations must equal closedEpochAdmissions + epoch.admitted.length";
  }
  if ((state.lock !== null) !== (state.status === "locked")) return "5: lock and status must agree";
  if (state.committed !== null && state.pendingCommit !== null) return "6: committed implies no pendingCommit";
  const byId = new Map(admitted.map((a) => [a.admissionId, a]));
  if (state.currentAdmissionId !== null && !byId.has(state.currentAdmissionId)) {
    return "8: currentAdmissionId must name an Admission in this epoch";
  }
  if (admitted.filter((a) => a.phase === "open").length > 1) return "9: at most one Admission may be open";
  if (state.committed !== null && !byId.has(state.committed.admissionId)) {
    return "11: committed.admissionId must name an Admission in this epoch";
  }
  if (state.status === "locked") {
    if (state.currentAdmissionId === null) return "12: a locked state names its locking admission";
    const locking = byId.get(state.currentAdmissionId);
    if (!locking) return "12: currentAdmissionId must name an Admission in this epoch";
    if (state.lock.fingerprint !== locking.fingerprint) {
      return "12: lock.fingerprint must equal the locking admission's fingerprint";
    }
  }
  return null;
}

export function describeState(state) {
  const shape = shapeFault(state);
  if (shape !== null) return { ok: false, reason: shape };
  const invariant = invariantFault(state);
  if (invariant !== null) return { ok: false, reason: `invariant ${invariant}` };
  return { ok: true };
}

// --- reading and publishing ---------------------------------------------------------------------------

// §D2.3: a corrupt state is diagnosed, never repaired and never replaced by a clean zero state, and
// `corrupt` is a READ PROJECTION -- no mutator ever persists it as a status value.
export function readState(repoRoot, taskId, { create = false } = {}) {
  const paths = loopPaths(repoRoot, taskId);
  const prefix = assertContainedPrefix(repoRoot, { create });
  if (!prefix.present) return { present: false, state: null, paths };
  if (!assertRegularOrAbsent(paths.state, "the control state")) return { present: false, state: null, paths };
  let text;
  try {
    text = fs.readFileSync(paths.state, "utf8");
  } catch (error) {
    throw fail("E_LOOP_IO", `cannot read the control state (${error && error.code})`, { path: paths.state });
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw fail("E_LOOP_STATE_CORRUPT", `the control state is not valid JSON: ${error.message}`, { path: paths.state });
  }
  const described = describeState(parsed);
  if (!described.ok) {
    throw fail("E_LOOP_STATE_CORRUPT", `the control state violates its contract (${described.reason})`, { path: paths.state });
  }
  return { present: true, state: parsed, paths };
}

// §D2.4 publication: canonical bytes -> exclusive temp -> fsync -> re-read and re-parse -> rename.
// The state is validated BEFORE the write, so an invalid state never reaches the filesystem, and the
// re-read is validated again so a published state is one that was actually parsed back.
export function publishState(paths, next) {
  const described = describeState(next);
  if (!described.ok) {
    throw fail("E_LOOP_STATE_CORRUPT",
      `refusing to publish a state that violates its contract (${described.reason})`, { path: paths.state });
  }
  const bytes = `${canonicalJson(next)}\n`;
  let temporary;
  let handle;
  let owned = false;
  let lastError;
  for (let attempt = 0; attempt < 3 && !owned; attempt += 1) {
    temporary = path.join(paths.dir, `task-${paths.hash}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`);
    try {
      handle = fs.openSync(temporary, "wx");
      owned = true;
    } catch (error) {
      lastError = error;
    }
  }
  if (!owned) {
    throw fail("E_LOOP_IO", `could not create a staging file (${lastError && lastError.code})`, { path: paths.dir });
  }
  try {
    fs.writeFileSync(handle, bytes, "utf8");
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = undefined;
    const back = JSON.parse(fs.readFileSync(temporary, "utf8"));
    const reread = describeState(back);
    if (!reread.ok) {
      throw fail("E_LOOP_IO", `the staged state did not parse back to a valid state (${reread.reason})`, { path: temporary });
    }
    fs.renameSync(temporary, paths.state);
    temporary = null;
    return back;
  } catch (error) {
    if (error instanceof LoopError) throw error;
    throw fail("E_LOOP_IO", `could not publish the control state (${error && error.code})`, { path: paths.state });
  } finally {
    if (handle !== undefined) { try { fs.closeSync(handle); } catch { /* best effort */ } }
    if (temporary) { try { fs.rmSync(temporary, { force: true }); } catch { /* best effort */ } }
  }
}

// §D2.2's HISTORY rules — 3, the monotonic half of 4, the append-only half of 7, and 10. Each needs
// the state being replaced, so none of them can live in `describeState`, which is shown one state.
function transitionFault(prior, next) {
  for (const name of ["revision", "observedIterations", "observedEpochs", "closedEpochAdmissions"]) {
    if (next[name] < prior[name]) return `4: ${name} is monotonically non-decreasing (${prior[name]} -> ${next[name]})`;
  }
  for (const name of ["adapterMisses", "staleBatchRejections"]) {
    if (next.counters[name].observed < prior.counters[name].observed) {
      return `4: counters.${name}.observed is monotonically non-decreasing`;
    }
  }

  // 3: `closedEpochAdmissions` increases ONLY in the same published transition that resets
  // `epoch.admitted` and opens the next epoch (§D9.5). Never at lock time, never on its own.
  if (next.epoch.ordinal === prior.epoch.ordinal) {
    if (next.closedEpochAdmissions !== prior.closedEpochAdmissions) {
      return "3: closedEpochAdmissions moves only in the publication that opens the next epoch";
    }
  } else {
    if (next.epoch.ordinal !== prior.epoch.ordinal + 1) return "3: an epoch opens exactly one ordinal at a time";
    if (next.epoch.admitted.length !== 0) return "3: the epoch-opening publication resets epoch.admitted";
    if (next.closedEpochAdmissions !== prior.closedEpochAdmissions + prior.epoch.admitted.length) {
      return "3: closedEpochAdmissions absorbs exactly the closing epoch's admissions";
    }
  }

  // 7: append-only within one control file's life. A baseline REFRESH is a union, never a
  // replacement: a draft id that vanished because the governance file was edited must stay known, or
  // §D9's novelty test would let the same witness be offered again as new.
  for (const [name, before, after] of [
    ["knownRecordIds", prior.knownRecordIds, next.knownRecordIds],
    ["knownDraftIds", prior.knownDraftIds, next.knownDraftIds],
    ["consumedWitnesses", prior.consumedWitnesses, next.consumedWitnesses],
  ]) {
    const seen = new Set(after.map((v) => canonicalJson(v)));
    for (const entry of before) {
      if (!seen.has(canonicalJson(entry))) {
        return `7: ${name} is append-only; ${canonicalJson(entry)} was dropped`;
      }
    }
  }

  for (const slot of SLOT_NAMES) {
    const fault = slotTransitionFault(prior.attempts[slot], next.attempts[slot], slot);
    if (fault !== null) return fault;
  }
  return null;
}

// 10 / §D4.1, in its settled form. A slot whose occupant is `completed` may be reused freely by a new
// attempt. A slot found `pending` holds evidence of an attempt that actually started: it may be left
// exactly as it is, or COMPLETED — same `attemptId`, same bindings, with an outcome. What it may not
// do is disappear, change phase to anything else, or be replaced by a different attempt.
//
// This is deliberately NOT a ban on `pending -> completed`: publications B and D of §D4 are exactly
// that transition on the same attempt, and refusing them would break every emission.
function slotTransitionFault(before, after, slot) {
  if (before === null || before.phase !== "pending") return null;
  if (canonicalJson(before) === canonicalJson(after)) return null;
  if (after === null) return `10: attempts.${slot} holds pending evidence that may not be discarded`;
  if (after.attemptId !== before.attemptId) {
    return `10: a different attempt may not replace the pending attempts.${slot}; reconcile it first`;
  }
  if (after.phase !== "completed") return `10: a pending attempts.${slot} may only transition to completed`;
  if (after.outcome === null) return `10: completing attempts.${slot} states its outcome`;
  for (const field of ["at", "epochOrdinal", "emissionId", "admissionId", "headRef"]) {
    if (canonicalJson(before[field]) !== canonicalJson(after[field])) {
      return `10: completing attempts.${slot} preserves its ${field}`;
    }
  }
  return null;
}

// One publication, one revision. Callers hand in the FINAL next state; there is no partial publish.
// The transition is charged HERE rather than at publication, so a caller that would build an illegal
// history is refused while its own call site is still on the stack.
export function advance(state, changes) {
  const next = { ...state, ...changes, revision: state.revision + 1 };
  const fault = transitionFault(state, next);
  if (fault !== null) {
    throw fail("E_LOOP_STATE_CORRUPT",
      `refusing a transition that violates §D2.2 (invariant ${fault})`, { taskId: state.taskId });
  }
  return next;
}

export const cloneJson = (value) => (value === undefined ? undefined : JSON.parse(canonicalJson(value)));

export const admissionOf = (state, admissionId) =>
  state.epoch.admitted.find((a) => a.admissionId === admissionId) || null;

export const currentAdmission = (state) =>
  (state.currentAdmissionId === null ? null : admissionOf(state, state.currentAdmissionId));

export const isTerminal = (admission) => admission !== null && TERMINAL_PHASES.includes(admission.phase);
