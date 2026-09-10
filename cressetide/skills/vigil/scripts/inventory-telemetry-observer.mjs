#!/usr/bin/env node
// The E1 telemetry observer: TP v1.18 amendment §C.1/§C.2.
//
// WHAT IT IS. One operation that measures the ONE thing the ledger cannot recover later -- the
// two-sided effective-oracle comparison, which needs base and head rich analyses that no longer
// exist once Step 5 has committed -- and publishes it as a small bound sidecar.
//
// TIMING IS NORMATIVE. It runs AFTER a successful emission and BEFORE the Step 5 committing write.
// That is not a comment: step 4 below compares the loaded current-store TEXT digest against the
// artifact's inputProvenanceStoreDigest, and the committing write necessarily moves that digest
// (AC127), so a post-commit invocation REFUSES rather than silently recording a post-state
// observation.
//
// WHAT IT DOES NOT PROVE, stated rather than implied. It validates the artifact it reads and binds
// the observation to that artifact's identity. It does NOT prove that a fresh emitter invocation
// produced that artifact -- it has no access to the emitter's return value. And the canonical v2
// envelope has NO explicit task identity: V2_INVENTORY_KEYS is exactly seven members and none of
// them is a task, so no request-versus-artifact task comparison exists to make. The observation is
// bound to a task only transitively, through the TaskState witness of step 3; that is not a unique
// task binding and none is claimed here. Two tasks sharing a base tree are not assumed to produce
// identical derived entries either -- an entry set can depend on the requested task's DP context.
// Establishing the real invocation/proposal sequence is D's obligation.
//
// AUTHORITY BOUNDARIES. Upstream typed errors -- the canonical inventory reader's, the store's, the
// exact-tree reader's, discovery's, the adapter's -- propagate UNCHANGED. This module's own
// judgments carry E_OBS_* codes and nothing else does.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  INVENTORY_PATH, parseCanonicalInventoryV2,
} from "./changed-test-inventory.mjs";
import {
  loadStore, validateStoreSchema, validateAll, indexStore, canonicalJson, storeDigest, emptyStore,
  CANONICAL_STORE_PATH, PROVENANCE_VERSION, compareCodePoint,
} from "./provenance-store.mjs";
import { readExactTreeBlob } from "./exact-tree-blob.mjs";
import { buildDiscoveryAnalysisPreimage } from "./adapter-discovery-preimage.mjs";
import {
  captureBaseAdapterContentView, projectHeadAdapterContentView, requireAdapterContentView,
} from "./adapter-content-view.mjs";
import { captureHeadViewSnapshot } from "./head-view-snapshot.mjs";
import { readTestAdapterRegistryRootFresh, resolveAdapterComponent } from "./adapter-registry.mjs";
import { readHeadExplicitConfig, registryDigestOf } from "./explicit-config.mjs";
import { matchBaseHeadDeclarations } from "./base-head-declaration-matcher.mjs";

export class TelemetryObserverError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = "TelemetryObserverError";
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

const fail = (code, message, detail) => new TelemetryObserverError(code, message, detail);
const REQUEST_KEYS = ["baseTreeOid", "repoRoot", "taskId"];

export const OBSERVATION_PATH = ".ctide/output/test-provenance-observation.json";
export const OBSERVATION_VERSION = 1;
// The exact closed key set of the sidecar. Six, and a seventh is refused: the amendment fixes this
// shape at version 1, and any additional member needs a separately approved observationVersion.
export const OBSERVATION_KEYS = [
  "baseTreeOid", "headViewDigest", "inventoryDigest", "observationVersion", "oracleDepTriggered",
  "registryDigest",
];

const IGNORE_BODY = "*\n!.gitignore\n";
const MAX_CREATE_ATTEMPTS = 3;
const DIGEST = /^[0-9a-f]{64}$/;

// The four statuses whose entry has BOTH sides, and the matcher relation each one must pair with.
// governance-affected is one of them: §6 reaches it only after moved/modified/retagged have failed,
// so the pair is same-path and unchanged on both sides but for the seed hit.
const RELATION_FOR_STATUS = {
  added: ["added"],
  deleted: ["deleted"],
  moved: ["moved"],
  modified: ["same-path"],
  retagged: ["same-path"],
  "governance-affected": ["same-path"],
};
const TWO_SIDED = new Set(["moved", "modified", "retagged", "governance-affected"]);

// --- path discipline ------------------------------------------------------------------------------
//
// A DOCUMENTED PARALLEL of changed-test-inventory-artifact.mjs's ownership/collision/hygiene
// discipline, written here rather than extracted: the emitter is not in this release's file list, so
// factoring its guards out would edit an accepted module for a reason unrelated to its own contract.
// The rules are the same and the reasons are the same; where they must not drift is stated in the
// amendment, not enforced by a copy guard, and this file is NOT registered in the closed
// validate-structure entry-point cluster (see isInvokedDirectly below).

function assertNoRedirection(repoRoot, dir) {
  let rootReal;
  try {
    rootReal = fs.realpathSync(repoRoot);
  } catch (error) {
    throw fail("E_OBS_TARGET", `cannot resolve the repository root ${repoRoot} (${error && error.code})`,
      { path: repoRoot });
  }
  const relative = path.relative(rootReal, dir);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw fail("E_OBS_TARGET", `${dir} is not inside ${rootReal}`, { path: dir });
  }
  let cursor = rootReal;
  for (const segment of relative.split(path.sep)) {
    cursor = path.join(cursor, segment);
    let stats;
    try {
      stats = fs.lstatSync(cursor);
    } catch (error) {
      if (error && error.code === "ENOENT") return;
      throw fail("E_OBS_TARGET", `cannot inspect ${cursor} (${error && error.code})`, { path: cursor });
    }
    if (stats.isSymbolicLink()) {
      throw fail("E_OBS_TARGET", `${cursor} is a symbolic link; the observation path is never followed through one`,
        { path: cursor });
    }
    if (!stats.isDirectory()) throw fail("E_OBS_TARGET", `${cursor} exists and is not a directory`, { path: cursor });
  }
  const outReal = fs.realpathSync(dir);
  if (path.relative(rootReal, outReal).startsWith("..")) {
    throw fail("E_OBS_TARGET", `${dir} resolves to ${outReal}, outside ${rootReal}`, { path: dir, resolved: outReal });
  }
}

// Returns whether the file is there. A symlink or a non-regular entry is refused rather than
// followed -- on the READ path as well as the write path, which is why this is shared by both.
function assertRegularOrAbsent(file, what) {
  let stats;
  try {
    stats = fs.lstatSync(file);
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    throw fail("E_OBS_TARGET", `cannot inspect ${what} at ${file} (${error && error.code})`, { path: file });
  }
  if (stats.isSymbolicLink()) {
    throw fail("E_OBS_TARGET", `${what} at ${file} is a symbolic link; it is refused rather than followed`,
      { path: file });
  }
  if (!stats.isFile()) {
    throw fail("E_OBS_TARGET", `${what} at ${file} exists and is not a regular file`, { path: file });
  }
  return true;
}

function ensureIgnoreGuard(ignoreFile) {
  const what = "the .ctide/output/.gitignore";
  let lastError;
  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
    let handle;
    try {
      handle = fs.openSync(ignoreFile, "wx");
    } catch (error) {
      if (!error || error.code !== "EEXIST") {
        throw fail("E_OBS_IO", `cannot create the output hygiene guard at ${ignoreFile} (${error && error.code})`,
          { path: ignoreFile });
      }
      if (assertRegularOrAbsent(ignoreFile, what)) return;      // present and ordinary: preserved
      lastError = error;                                        // vanished under us: try again
      continue;
    }
    try {
      fs.writeFileSync(handle, IGNORE_BODY, "utf8");
    } catch (error) {
      fs.closeSync(handle);
      handle = undefined;
      try { fs.rmSync(ignoreFile, { force: true }); } catch { /* best effort */ }
      throw fail("E_OBS_IO", `cannot write the output hygiene guard at ${ignoreFile} (${error && error.code})`,
        { path: ignoreFile });
    } finally {
      if (handle !== undefined) fs.closeSync(handle);
    }
    return;
  }
  throw fail("E_OBS_IO",
    `the output hygiene guard at ${ignoreFile} was neither created nor observed in ${MAX_CREATE_ATTEMPTS} attempts `
    + `(${lastError && lastError.code})`, { path: ignoreFile });
}

// --- the sidecar ----------------------------------------------------------------------------------

function publishObservation(repoRoot, observation) {
  const target = path.join(repoRoot, ...OBSERVATION_PATH.split("/"));
  const outputDir = path.dirname(target);
  assertNoRedirection(repoRoot, outputDir);
  try {
    fs.mkdirSync(outputDir, { recursive: true });
  } catch (error) {
    throw fail("E_OBS_IO", `cannot create ${outputDir} (${error && error.code})`, { path: outputDir });
  }
  assertNoRedirection(repoRoot, outputDir);
  ensureIgnoreGuard(path.join(outputDir, ".gitignore"));
  assertRegularOrAbsent(target, "the observation sidecar");

  const text = `${canonicalJson(observation)}\n`;
  let temporary;
  let handle;
  let owned = false;
  let lastError;
  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS && !owned; attempt += 1) {
    temporary = path.join(outputDir,
      `.test-provenance-observation.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`);
    try {
      handle = fs.openSync(temporary, "wx");
      owned = true;
    } catch (error) {
      lastError = error;
      if (!error || error.code !== "EEXIST") {
        throw fail("E_OBS_IO", `cannot stage the observation at ${temporary} (${error && error.code})`,
          { path: temporary });
      }
    }
  }
  if (!owned) {
    throw fail("E_OBS_IO",
      `no unused staging name was available under ${outputDir} in ${MAX_CREATE_ATTEMPTS} attempts `
      + `(${lastError && lastError.code})`, { path: outputDir });
  }
  try {
    try {
      fs.writeFileSync(handle, text, "utf8");
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
    let readBack;
    try {
      readBack = fs.readFileSync(temporary, "utf8");
    } catch (error) {
      throw fail("E_OBS_IO", `cannot re-read the staged observation (${error && error.code})`, { path: temporary });
    }
    const reparsed = parseObservationText(readBack);
    if (canonicalJson(reparsed) !== canonicalJson(observation)) {
      throw fail("E_OBS_IO", "the staged observation does not re-read as the observation that was written",
        { path: temporary });
    }
    try {
      fs.renameSync(temporary, target);
    } catch (error) {
      throw fail("E_OBS_IO", `cannot publish the observation to ${target} (${error && error.code})`, { path: target });
    }
    owned = false;                 // our inode is the target now; the temp NAME is no longer ours
  } finally {
    if (owned) {
      try { fs.rmSync(temporary, { force: true }); } catch { /* best effort */ }
    }
  }
  return target;
}

// The shape check, shared by publication's re-read and by the collector's read. It charges the exact
// closed key set, every member's type and the version; the BINDING and the count BOUND are the
// caller's, because only a caller holding the committed inventory can check them.
export function parseObservationText(text) {
  let raw;
  try { raw = JSON.parse(text); } catch (error) {
    throw fail("E_OBS_SIDECAR", `the observation sidecar is not valid JSON: ${error.message}`);
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw fail("E_OBS_SIDECAR", "the observation sidecar must be a JSON object");
  }
  const keys = Object.keys(raw).sort(compareCodePoint);
  if (keys.length !== OBSERVATION_KEYS.length || keys.some((k, i) => k !== OBSERVATION_KEYS[i])) {
    throw fail("E_OBS_SIDECAR",
      `the observation sidecar must declare exactly ${JSON.stringify(OBSERVATION_KEYS)}; got ${JSON.stringify(keys)}`,
      { keys });
  }
  if (raw.observationVersion !== OBSERVATION_VERSION) {
    throw fail("E_OBS_SIDECAR",
      `observationVersion must be the integer ${OBSERVATION_VERSION}; got ${JSON.stringify(raw.observationVersion)}`);
  }
  for (const key of ["inventoryDigest", "headViewDigest", "registryDigest"]) {
    if (typeof raw[key] !== "string" || !DIGEST.test(raw[key])) {
      throw fail("E_OBS_SIDECAR", `${key} must be 64 lowercase hex; got ${JSON.stringify(raw[key])}`);
    }
  }
  if (typeof raw.baseTreeOid !== "string" || !/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(raw.baseTreeOid)) {
    throw fail("E_OBS_SIDECAR", `baseTreeOid must be 40 or 64 lowercase hex; got ${JSON.stringify(raw.baseTreeOid)}`);
  }
  if (!Number.isSafeInteger(raw.oracleDepTriggered) || raw.oracleDepTriggered < 0) {
    throw fail("E_OBS_SIDECAR",
      `oracleDepTriggered must be a finite non-negative safe integer; got ${JSON.stringify(raw.oracleDepTriggered)}`);
  }
  return Object.freeze({
    observationVersion: raw.observationVersion,
    inventoryDigest: raw.inventoryDigest,
    baseTreeOid: raw.baseTreeOid,
    headViewDigest: raw.headViewDigest,
    registryDigest: raw.registryDigest,
    oracleDepTriggered: raw.oracleDepTriggered,
  });
}

/**
 * Read the sidecar and bind it to a committed inventory.
 *
 * @param {string} repoRoot repository root
 * @param {object} inventory the canonical v2 inventory this observation must be about
 * @returns {Readonly<object>} the validated observation
 *
 * Refusals are TelemetryObserverError. Every caller in E1 turns any refusal into
 * `oracleDepTriggered: "unknown"` and changes nothing else -- a sidecar fault never sinks a record.
 */
export function readBoundObservation(repoRoot, inventory) {
  const root = path.resolve(repoRoot);
  const target = path.join(root, ...OBSERVATION_PATH.split("/"));
  // PARENT CONTAINMENT BEFORE THE LEAF, on the READ path exactly as on the write path (§C.2). A
  // leaf-only lstat refuses a symlinked sidecar but says nothing about `.ctide/output` itself: a
  // junction there resolves during the open, so a perfectly regular, correctly bound file OUTSIDE
  // the repository would be read and accepted. A guard that fires after the bytes were taken is not
  // a guard for those bytes.
  assertNoRedirection(root, path.dirname(target));
  if (!assertRegularOrAbsent(target, "the observation sidecar")) {
    throw fail("E_OBS_SIDECAR", `no observation sidecar at ${target}`, { path: target });
  }
  let text;
  try {
    text = fs.readFileSync(target, "utf8");
  } catch (error) {
    throw fail("E_OBS_IO", `cannot read the observation sidecar (${error && error.code})`, { path: target });
  }
  const observation = parseObservationText(text);

  // ALL FOUR bindings, never one while tolerating a contradiction in another.
  for (const key of ["inventoryDigest", "baseTreeOid", "headViewDigest", "registryDigest"]) {
    if (observation[key] !== inventory[key]) {
      throw fail("E_OBS_BINDING",
        `the observation states ${key} ${JSON.stringify(observation[key])} but the committed inventory states `
        + `${JSON.stringify(inventory[key])}; an observation of another proposal is not this head's`,
        { key });
    }
  }
  const bound = twoSidedEntryCount(inventory.entries);
  if (observation.oracleDepTriggered > bound) {
    throw fail("E_OBS_BOUND",
      `oracleDepTriggered ${observation.oracleDepTriggered} exceeds the ${bound} committed inventory entr`
      + `${bound === 1 ? "y" : "ies"} that have both a base and a head side`,
      { count: observation.oracleDepTriggered, bound });
  }
  return observation;
}

// The comparison domain: entries with BOTH sides. added and deleted are outside it and contribute 0
// -- a measurement over an empty domain, never an unknown.
export function twoSidedEntryCount(entries) {
  return entries.filter((entry) => TWO_SIDED.has(entry.status)).length;
}

// --- projection equality ---------------------------------------------------------------------------

// Discovery's public module projection, rebuilt from THIS observer's own rich analysis so the two can
// be compared member by member. Mirrors adapter-discovery-preimage's projectIdentity /
// projectDeclarations exactly: the identity reported by the component is checked against the
// registry's and the REGISTRY's is what the projection carries.
function projectModule(adapter, module) {
  for (const key of ["implementationId", "parserId", "parserVersion"]) {
    const reported = module.identity;
    if (reported === null || typeof reported !== "object" || reported[key] !== adapter.implementationIdentity[key]) {
      throw fail("E_OBS_IDENTITY",
        `${module.path} was analysed by a component reporting ${key} `
        + `${JSON.stringify(reported === null || typeof reported !== "object" ? reported : reported[key])}, but the `
        + `registry declares ${JSON.stringify(adapter.implementationIdentity[key])}`,
        { path: module.path, key });
    }
  }
  return {
    path: module.path,
    adapterId: adapter.adapterId,
    framework: adapter.framework,
    implementationIdentity: {
      implementationId: adapter.implementationIdentity.implementationId,
      parserId: adapter.implementationIdentity.parserId,
      parserVersion: adapter.implementationIdentity.parserVersion,
    },
    declarations: module.declarations
      .map((d) => ({ structuralId: d.structuralId, tag: d.tag === null ? null : { ...d.tag }, bodyDigest: d.bodyDigest }))
      .sort((a, b) => compareCodePoint(a.structuralId, b.structuralId)),
  };
}

// COMPLETE equality, not a top-level digest comparison: module set and order, path, adapterId,
// framework, all THREE implementationIdentity members and every declaration's closed
// { structuralId, tag, bodyDigest } projection. There is no stableId member in that projection and
// none is invented here.
function assertProjectionEquality(side, mine, theirs) {
  if (mine.length !== theirs.length) {
    throw fail("E_OBS_PROJECTION",
      `${side}: this observation analysed ${mine.length} module(s) where discovery projected ${theirs.length}`,
      { side, mine: mine.length, theirs: theirs.length });
  }
  for (let i = 0; i < mine.length; i += 1) {
    const a = mine[i];
    const b = theirs[i];
    for (const key of ["path", "adapterId", "framework"]) {
      if (a[key] !== b[key]) {
        throw fail("E_OBS_PROJECTION",
          `${side}[${i}]: ${key} is ${JSON.stringify(a[key])} here and ${JSON.stringify(b[key])} in discovery`,
          { side, index: i, key });
      }
    }
    for (const key of ["implementationId", "parserId", "parserVersion"]) {
      if (a.implementationIdentity[key] !== b.implementationIdentity[key]) {
        throw fail("E_OBS_PROJECTION",
          `${side} ${a.path}: implementationIdentity.${key} is ${JSON.stringify(a.implementationIdentity[key])} here `
          + `and ${JSON.stringify(b.implementationIdentity[key])} in discovery`,
          { side, path: a.path, key });
      }
    }
    if (a.declarations.length !== b.declarations.length) {
      throw fail("E_OBS_PROJECTION",
        `${side} ${a.path}: ${a.declarations.length} declaration(s) here, ${b.declarations.length} in discovery`,
        { side, path: a.path });
    }
    for (let j = 0; j < a.declarations.length; j += 1) {
      const x = a.declarations[j];
      const y = b.declarations[j];
      if (x.structuralId !== y.structuralId || x.bodyDigest !== y.bodyDigest
        || canonicalJson(x.tag ?? null) !== canonicalJson(y.tag ?? null)) {
        throw fail("E_OBS_PROJECTION",
          `${side} ${a.path}: declaration ${JSON.stringify(x.structuralId)} does not equal discovery's projection`,
          { side, path: a.path, structuralId: x.structuralId });
      }
    }
  }
}

// --- composite keys ------------------------------------------------------------------------------------
//
// Encoded as a JSON tuple rather than joined with a delimiter, the way adapter-registry.mjs already
// keys its (implementationId, framework) pairs: with no separator there is no separator to smuggle,
// so two different tuples can never collide into one key. A path containing the delimiter would
// otherwise be all it took.
const richKey = (modulePath, structuralId) => canonicalJson([modulePath, structuralId]);
const testRefKey = (l) => canonicalJson([l.path, l.adapterId, l.structuralId]);
const entryKey = (ref) => canonicalJson([ref.path, ref.adapterId, ref.structuralId]);

// --- rich analysis ----------------------------------------------------------------------------------

// One side's rich analysis, grouped the way discovery groups it: by adapterId, each group handed to
// the component that adapter's implementationId resolves to, with modulePaths taken from discovery's
// own module list and never guessed.
async function analyseSide(view, discoveryModules, registryRoot, side) {
  const byAdapter = new Map();
  for (const module of discoveryModules) {
    if (!byAdapter.has(module.adapterId)) byAdapter.set(module.adapterId, []);
    byAdapter.get(module.adapterId).push(module.path);
  }
  const rich = new Map();                       // richKey(path, structuralId) -> rich declaration
  const projected = [];
  for (const adapterId of [...byAdapter.keys()].sort(compareCodePoint)) {
    const adapter = registryRoot.adapters.find((a) => a.adapterId === adapterId);
    if (adapter === undefined) {
      throw fail("E_OBS_DISCOVERY_BINDING",
        `${side}: discovery names adapterId ${JSON.stringify(adapterId)}, which the fresh registry root does not declare`,
        { side, adapterId });
    }
    const component = resolveAdapterComponent(adapter.implementationId);
    const modulePaths = byAdapter.get(adapterId).slice().sort(compareCodePoint);
    const analysis = await component.analyzeView({ view, modulePaths });
    for (const module of analysis.modules) {
      projected.push(projectModule(adapter, module));
      for (const declaration of module.declarations) {
        rich.set(richKey(module.path, declaration.structuralId), declaration);
      }
    }
  }
  projected.sort((a, b) => compareCodePoint(a.path, b.path) || compareCodePoint(a.adapterId, b.adapterId));
  assertProjectionEquality(side, projected, discoveryModules);
  return rich;
}

// --- per-entry pairing ------------------------------------------------------------------------------

// Every entry represented in the canonical inventory must resolve to the EXACT matcher locator pair
// and the two sides must agree. A missing pair, a contradictory pair or an entry with no locator
// refuses: accepting a fabricated entry because the top-level digests agreed is insufficient even
// for a disclosure metric.
function bindEntries(entries, pairs) {
  const byIdentity = new Map();
  for (const pair of pairs) {
    const identity = pair.head === null ? pair.base : pair.head;
    byIdentity.set(testRefKey(identity), pair);
  }
  const bound = [];
  for (const entry of entries) {
    const key = entryKey(entry.testRef);
    const pair = byIdentity.get(key);
    if (pair === undefined) {
      throw fail("E_OBS_PAIRING",
        `inventory entry ${key} resolves to no base/head declaration pair`,
        { testRef: entry.testRef });
    }
    const allowed = RELATION_FOR_STATUS[entry.status];
    if (allowed === undefined || !allowed.includes(pair.relation)) {
      throw fail("E_OBS_PAIRING",
        `inventory entry ${key} states status ${JSON.stringify(entry.status)} but its pair is `
        + `${JSON.stringify(pair.relation)}`,
        { testRef: entry.testRef, status: entry.status, relation: pair.relation });
    }
    const wantsBase = entry.status !== "added";
    const wantsHead = entry.status !== "deleted";
    if ((pair.base !== null) !== wantsBase || (pair.head !== null) !== wantsHead) {
      throw fail("E_OBS_PAIRING",
        `inventory entry ${key} and its pair disagree about which sides exist`,
        { testRef: entry.testRef, status: entry.status });
    }
    if (wantsBase) {
      assertSide(entry, pair.base, "base", "tagBefore", "baseBodyDigest");
    }
    if (wantsHead) {
      assertSide(entry, pair.head, "head", "tagAfter", "headBodyDigest");
    }
    bound.push({ entry, pair });
  }
  return bound;
}

function assertSide(entry, locator, side, tagKey, digestKey) {
  const where = entryKey(entry.testRef);
  if (canonicalJson(entry[tagKey] ?? null) !== canonicalJson(locator.tag ?? null)) {
    throw fail("E_OBS_PAIRING",
      `inventory entry ${where} states a ${tagKey} the ${side}-side declaration does not carry`,
      { testRef: entry.testRef, side });
  }
  if (entry[digestKey] !== locator.bodyDigest) {
    throw fail("E_OBS_PAIRING",
      `inventory entry ${where} states ${digestKey} ${JSON.stringify(entry[digestKey])} but the ${side}-side `
      + `declaration digests to ${JSON.stringify(locator.bodyDigest)}`,
      { testRef: entry.testRef, side });
  }
  if (entry.framework !== locator.framework) {
    throw fail("E_OBS_PAIRING",
      `inventory entry ${where} states framework ${JSON.stringify(entry.framework)} but the ${side}-side declaration `
      + `is ${JSON.stringify(locator.framework)}`,
      { testRef: entry.testRef, side });
  }
  if (canonicalJson(entry.implementationIdentity) !== canonicalJson(locator.implementationIdentity)) {
    throw fail("E_OBS_PAIRING",
      `inventory entry ${where} states an implementationIdentity the ${side}-side declaration does not`,
      { testRef: entry.testRef, side });
  }
}

// --- the operation ------------------------------------------------------------------------------------

/**
 * Observe the two-sided oracle metric for the emitted inventory and publish the bound sidecar.
 *
 * @param {{ repoRoot: string, baseTreeOid: string, taskId: string }} request exact key set. No
 *   artifact path, no snapshot, no captured context, no callback, no cache: the artifact path is a
 *   fixed internal constant and every capture is this operation's own.
 * @returns {Promise<Readonly<object>>} the published observation, frozen.
 */
export async function observeInventoryTelemetry(request) {
  if (arguments.length !== 1) {
    throw fail("E_API_ARGUMENTS",
      "observeInventoryTelemetry takes exactly one argument; an artifact path, a snapshot, a preimage, a store, a "
      + "registry, a filesystem, a Git executable or a capture hook cannot be supplied");
  }
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    throw fail("E_API_ARGUMENTS", "the observeInventoryTelemetry request must be a JSON object");
  }
  // Own keys, not merely the enumerable string ones; symbols refused before the sort and the message.
  const ownKeys = Reflect.ownKeys(request);
  const symbolKeys = ownKeys.filter((key) => typeof key !== "string");
  if (symbolKeys.length > 0) {
    throw fail("E_API_ARGUMENTS",
      `the observeInventoryTelemetry request carries symbol-keyed own properties `
      + `(${symbolKeys.map(String).join(", ")}); it must declare exactly ${JSON.stringify(REQUEST_KEYS)}`);
  }
  const keys = ownKeys.sort();
  if (keys.length !== REQUEST_KEYS.length || keys.some((k, i) => k !== REQUEST_KEYS[i])) {
    throw fail("E_API_ARGUMENTS",
      `the observeInventoryTelemetry request must declare exactly ${JSON.stringify(REQUEST_KEYS)}; got `
      + `${JSON.stringify(keys)}`);
  }
  // ONE read of each owned value; every check and every use below is of the local, so nothing this
  // operation names can change across its awaits.
  const captured = {};
  for (const key of REQUEST_KEYS) captured[key] = request[key];
  for (const key of REQUEST_KEYS) {
    if (typeof captured[key] !== "string" || captured[key] === "") {
      throw fail("E_API_ARGUMENTS", `${key} must be a non-empty string`);
    }
  }
  const { baseTreeOid, taskId } = captured;
  const repoRoot = path.resolve(captured.repoRoot);

  // 1. THE ARTIFACT, at the fixed internal path, through the canonical v2 reader. Parent containment
  //    is charged FIRST, for the same reason as the sidecar read above: the publication guard at
  //    step 12 would eventually refuse a redirected `.ctide/output`, but by then this read has
  //    already taken bytes from wherever the junction pointed.
  const artifactPath = path.join(repoRoot, ...INVENTORY_PATH.split("/"));
  assertNoRedirection(repoRoot, path.dirname(artifactPath));
  if (!assertRegularOrAbsent(artifactPath, "the inventory artifact")) {
    throw fail("E_OBS_ARTIFACT", `no inventory artifact at ${artifactPath}`, { path: artifactPath });
  }
  let artifactText;
  try {
    artifactText = fs.readFileSync(artifactPath, "utf8");
  } catch (error) {
    throw fail("E_OBS_IO", `cannot read the inventory artifact (${error && error.code})`, { path: artifactPath });
  }
  const artifact = parseCanonicalInventoryV2(artifactText);        // reader's own codes propagate

  // 2. CURRENT AUTHORITY, FROM ONE LOAD. The digest and the validation must describe the same text,
  //    so the file is read once and both come from that read.
  const loaded = loadStore(repoRoot);
  if (!loaded.exists) {
    throw fail("E_OBS_AUTHORITY", `no provenance store at ${loaded.file}; there is no current authority to bind to`,
      { path: loaded.file });
  }
  if (loaded.store.provenanceVersion !== PROVENANCE_VERSION) {
    throw fail("E_OBS_AUTHORITY",
      `the current store is provenanceVersion ${JSON.stringify(loaded.store.provenanceVersion)}; this observer reads `
      + "only a current v2 store",
      { provenanceVersion: loaded.store.provenanceVersion });
  }
  validateStoreSchema(loaded.store);
  validateAll(loaded.store, { now: Date.now() });
  const index = indexStore(loaded.store);
  const ts = index.taskStates.get(taskId);
  if (ts === undefined) {
    throw fail("E_OBS_AUTHORITY", `no TaskState for taskId ${JSON.stringify(taskId)}`,
      { taskId });
  }

  // 3. WITNESS FACTS, each one named. treeOid equality ALONE is not base-witness validation.
  const base = ts.baseProvenance;
  if (base.treeOid !== baseTreeOid || base.treeOid !== artifact.baseTreeOid) {
    throw fail("E_OBS_WITNESS",
      `task ${taskId} witnesses tree ${base.treeOid}, the request names ${baseTreeOid} and the `
      + `artifact names ${artifact.baseTreeOid}; all three must be the same tree`,
      { taskId });
  }
  if (base.storePath !== CANONICAL_STORE_PATH) {
    throw fail("E_OBS_WITNESS",
      `task ${taskId} baseProvenance.storePath is ${base.storePath}, not the canonical ${CANONICAL_STORE_PATH}`,
      { taskId });
  }
  // The RAW base-store witness, mandatory. Its notation is sha256 over the bytes as they stand --
  // deliberately NOT the current-text notation of step 4 and NOT a canonical object serialisation.
  // This proves those exact witness facts and no further historical semantic invariant.
  const baseRead = await readExactTreeBlob({ repoRoot, treeOid: base.treeOid, path: base.storePath });
  if (!baseRead.present) {
    if (base.storeDigest !== storeDigest(emptyStore())) {
      throw fail("E_OBS_WITNESS",
        `base tree ${base.treeOid} holds no ${base.storePath}, so the witness digest must be the canonical empty `
        + `store's; it states ${base.storeDigest}`,
        { treeOid: base.treeOid });
    }
  } else if (baseRead.rawDigest !== base.storeDigest) {
    throw fail("E_OBS_WITNESS",
      `the base tree store's raw-byte digest ${baseRead.rawDigest} does not equal the witness ${base.storeDigest}`,
      { treeOid: base.treeOid, actual: baseRead.rawDigest });
  }

  // 4. PRE-STATE BINDING, from step 2's single load. `sha256(canonicalText(the file's actual text))`
  //    -- NOT storeDigest(<object>), which hashes a re-serialisation and would reject a legally
  //    pretty-printed store file. The committing write moves this value (AC127), which is exactly
  //    how a post-commit invocation is refused rather than silently recorded.
  if (loaded.digest !== artifact.inputProvenanceStoreDigest) {
    throw fail("E_OBS_PRESTATE",
      `the current store text digests to ${loaded.digest} but the artifact was produced against `
      + `${artifact.inputProvenanceStoreDigest}. Observe BEFORE the committing write: after it the pre-state has `
      + "moved by design",
      { loaded: loaded.digest, artifact: artifact.inputProvenanceStoreDigest });
  }

  // 5. DISCOVERY, whose public request is unchanged, then its three-way binding to the artifact.
  const preimage = await buildDiscoveryAnalysisPreimage({ repoRoot, baseTreeOid });
  for (const key of ["baseTreeOid", "headViewDigest", "registryDigest"]) {
    if (preimage[key] !== artifact[key]) {
      throw fail("E_OBS_DISCOVERY_BINDING",
        `discovery observed ${key} ${JSON.stringify(preimage[key])} while the artifact states `
        + `${JSON.stringify(artifact[key])}`,
        { key });
    }
  }

  // 6. BASE rich capture.
  const baseView = requireAdapterContentView(
    await captureBaseAdapterContentView({ repoRoot, baseTreeOid }), "the base content view");

  // 7. HEAD rich capture -- ONE additional capture, whose agreement with discovery's already
  //    stability-proved digest is the evidence. This is not a claim of continuous stability.
  const snapshot = await captureHeadViewSnapshot({ repoRoot });
  if (snapshot.headViewDigest !== preimage.headViewDigest) {
    throw fail("E_OBS_DISCOVERY_BINDING",
      `this observation's head capture digests to ${snapshot.headViewDigest} while discovery observed `
      + `${preimage.headViewDigest}; the head moved between the two reads`,
      { observed: snapshot.headViewDigest, discovery: preimage.headViewDigest });
  }
  const headView = requireAdapterContentView(projectHeadAdapterContentView(snapshot), "the head content view");

  // 8. REGISTRY then CONFIG, in that order: the config is a function of the head captured at step 7,
  //    so it cannot be read before that head exists.
  const registryRoot = readTestAdapterRegistryRootFresh();
  const registryDigest = registryDigestOf(registryRoot, readHeadExplicitConfig(snapshot, registryRoot));
  if (registryDigest !== preimage.registryDigest) {
    throw fail("E_OBS_DISCOVERY_BINDING",
      `this observation's registry/config digests to ${registryDigest} while discovery observed `
      + `${preimage.registryDigest}`,
      { observed: registryDigest, discovery: preimage.registryDigest });
  }

  // 9. RICH ANALYSIS, then COMPLETE projection equality on both sides.
  const richBase = await analyseSide(baseView, preimage.baseModules, registryRoot, "base");
  const richHead = await analyseSide(headView, preimage.headModules, registryRoot, "head");

  // 10. PER-ENTRY PAIRING through the accepted matcher, then the metric itself.
  const pairs = matchBaseHeadDeclarations(preimage);
  const bound = bindEntries(artifact.entries, pairs);
  let oracleDepTriggered = 0;
  for (const { entry, pair } of bound) {
    if (!TWO_SIDED.has(entry.status)) continue;                    // added/deleted: outside the domain
    const baseDeclaration = richBase.get(richKey(pair.base.path, pair.base.structuralId));
    const headDeclaration = richHead.get(richKey(pair.head.path, pair.head.structuralId));
    if (baseDeclaration === undefined || headDeclaration === undefined) {
      throw fail("E_OBS_PAIRING",
        `the rich analysis holds no declaration for ${entryKey(entry.testRef)}`,
        { testRef: entry.testRef });
    }
    // NON-EXCLUSIVE and TWO-SIDED: counted even when the declaration also changed, the entry moved,
    // or the tag changed. A differing effectiveOracleDigest is an observable contract difference, not
    // proof of sole semantic causation.
    if (baseDeclaration.effectiveOracleDigest !== headDeclaration.effectiveOracleDigest) oracleDepTriggered += 1;
  }
  const domain = twoSidedEntryCount(artifact.entries);
  if (oracleDepTriggered > domain) {
    throw fail("E_OBS_BOUND",
      `counted ${oracleDepTriggered} over a comparison domain of ${domain}`, { count: oracleDepTriggered, bound: domain });
  }

  // 11. SAME-TEXT RECHECK, immediately before publication. Steps 5-10 are asynchronous, so this
  //     bounds mutation of the store file to THIS operation's own span and claims nothing about any
  //     later operation: Step 5 retains its own file-backed CAS.
  const recheck = loadStore(repoRoot);
  if (!recheck.exists || recheck.digest !== loaded.digest) {
    throw fail("E_OBS_MUTATED",
      `the provenance store changed while this observation was being taken (${loaded.digest} -> `
      + `${recheck.exists ? recheck.digest : "absent"}); nothing is published`,
      { before: loaded.digest, after: recheck.exists ? recheck.digest : null });
  }

  // 12. PUBLISH.
  const observation = Object.freeze({
    observationVersion: OBSERVATION_VERSION,
    inventoryDigest: artifact.inventoryDigest,
    baseTreeOid: artifact.baseTreeOid,
    headViewDigest: artifact.headViewDigest,
    registryDigest: artifact.registryDigest,
    oracleDepTriggered,
  });
  publishObservation(repoRoot, observation);
  return observation;
}

// --- CLI --------------------------------------------------------------------------------------------

export const OBSERVER_FLAGS = ["base-tree", "cwd", "task"];
export const REQUIRED_OBSERVER_FLAGS = ["base-tree", "task"];
const flagList = () => OBSERVER_FLAGS.map((f) => `--${f}`).join(", ");

// Strict, in the discipline the artifact emitter already carries: a mistyped flag is not silently
// dropped and a missing value never becomes a literal string.
export function parseObserverArgs(argv) {
  const args = argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token.startsWith("--")) {
      throw fail("E_API_ARGUMENTS",
        `unexpected argument ${JSON.stringify(token)}; this CLI takes only ${flagList()}`, { argument: token });
    }
    const name = token.slice(2);
    if (!OBSERVER_FLAGS.includes(name)) {
      throw fail("E_API_ARGUMENTS", `unknown flag ${token}; this CLI accepts only ${flagList()}`, { flag: token });
    }
    if (Object.hasOwn(options, name)) {
      throw fail("E_API_ARGUMENTS", `${token} was given more than once`, { flag: token });
    }
    const value = args[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw fail("E_API_ARGUMENTS", `${token} requires a value`, { flag: token });
    }
    if (value === "") throw fail("E_API_ARGUMENTS", `${token} was given an empty value`, { flag: token });
    options[name] = value;
    i += 1;
  }
  for (const name of REQUIRED_OBSERVER_FLAGS) {
    if (!Object.hasOwn(options, name)) {
      throw fail("E_API_ARGUMENTS", `--${name} is required`, { flag: `--${name}` });
    }
  }
  return options;
}

export async function main(argv) {
  // Parsing lives INSIDE the caught boundary, so an argument fault reaches the operator as the same
  // machine JSON and the same exit 1 as every other refusal.
  try {
    const options = parseObserverArgs(argv);
    const result = await observeInventoryTelemetry({
      repoRoot: options.cwd ?? process.cwd(),
      baseTreeOid: options["base-tree"],
      taskId: options.task,
    });
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
    process.exit(0);
  } catch (error) {
    const code = error && typeof error.code === "string" ? error.code : "E_UNEXPECTED";
    process.stderr.write(`${JSON.stringify({
      ok: false, code, message: error && error.message, detail: (error && error.detail) ?? null,
    })}\n`);
    process.exit(1);
  }
}

// The direct-invocation guard, in the same forward-direction body the existing CLI entry points use.
// Stated accurately: validate-structure-core.mjs's garden 9d check runs over a CLOSED, hard-coded
// list of entry-point files and this new file is NOT on it, so nothing currently hash-checks this
// copy against its siblings. The body is written to match them so registering it later is a list
// edit rather than a behaviour change; the existing sites are left exactly as they are.
function isInvokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isInvokedDirectly()) main(process.argv);
