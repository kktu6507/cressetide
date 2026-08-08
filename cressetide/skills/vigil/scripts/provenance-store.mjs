#!/usr/bin/env node
// ctide provenance-store: the single writer for `.ctide/provenance.json`, the tracked canonical
// semantic state defined by docs/superpowers/specs/2026-07-25-shared-decision-provenance-model.md
// (approved v1.11) and given its command surface by 2026-07-25-intent-scan-spec.md (approved v1.6) §8.
//
// Session-time helper (NOT a Claude Code hook, NOT CI-only): the main thread calls one domain
// transaction per mutation. There are deliberately NO bare append-clause / append-transition /
// set-dp-outcome commands — none of them can complete a terminal replacement without transiently
// violating INV-4 (intent-scan §8), so every mutation is a whole-transaction command instead.
//
// DELIBERATE DIVERGENCE FROM THE SIBLING SCRIPTS' fail-open CONTRACT: contract-check.mjs,
// run-ledger.mjs and friends swallow errors and always exit 0. This script is **fail-closed** — a
// rejected transaction leaves the canonical store byte-identical and exits non-zero with a typed
// error code (shared model §9; intent-scan §8 "Writer 拒絕"). A store that cannot be proven
// consistent must never be silently accepted.
//
// Dependency-free (Node built-ins only). Layering, innermost first: canonical encoding/digest →
// store schema + loader → immutable model index + derived fields → invariants → Transition matrix +
// witness binding → pure domain transactions (store → store, no I/O) → CAS/atomic-replace runner →
// CLI. Every mutation path funnels through the SAME validateAll(); no command, loader or CLI keeps
// its own copy of an invariant. All layers are exported for the test suite; main() wraps the CLI
// under the import.meta.url guard.
//
// Implementation determinism note (not a model rule): the spec fixes the canonical ordering of
// `taskStates` (by taskId), of `relatedRefs` (by kind then ref), and of the batchSnapshot arrays.
// It leaves the other store sections unordered. Because `baseProvenance.storeDigest` is defined
// over "the file's canonical bytes", this writer additionally serialises every section sorted by
// object id so the on-disk bytes — and therefore that digest — are reproducible. Sorting is a
// serialisation choice only; it changes no field semantics.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

// --- errors ------------------------------------------------------------------------------------
// Every rejection carries a machine-readable code so callers (and the tests) can assert on the
// reason rather than on prose. `detail` names the offending object wherever one exists.

export class ProvenanceError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = "ProvenanceError";
    this.code = code;
    this.detail = detail;
  }
}

export function reject(code, message, detail = null) {
  throw new ProvenanceError(code, message, detail);
}

// --- canonical encoding & digest ---------------------------------------------------------------
// shared model §9: UTF-8 (no BOM), LF, no trimming, no case folding — modifiers are load-bearing.
// §2 batchDigest: object keys sorted by Unicode code point, no insignificant whitespace. Arrays
// preserve the order they are given; callers pre-sort the arrays the spec assigns a total order to.

export function canonicalText(value) {
  if (typeof value !== "string") reject("E_CANON_TYPE", "canonicalText expects a string");
  return value.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

// TRUE code-point order. JavaScript's `<` on strings compares UTF-16 code UNITS, which orders any
// non-BMP character (a surrogate pair, lead unit 0xD800-0xDBFF) BEFORE U+E000-U+FFFF — the opposite
// of code-point order. The spec says "Unicode code point", so iterate by code point.
export function compareCodePoint(a, b) {
  const x = Array.from(String(a));
  const y = Array.from(String(b));
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const cx = x[i].codePointAt(0);
    const cy = y[i].codePointAt(0);
    if (cx !== cy) return cx < cy ? -1 : 1;
  }
  return x.length === y.length ? 0 : x.length < y.length ? -1 : 1;
}

export function canonicalJson(value) {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "boolean" || t === "number") {
    if (t === "number" && !Number.isFinite(value)) reject("E_CANON_NUMBER", "non-finite number is not canonicalisable");
    return JSON.stringify(value);
  }
  if (t === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (t === "object") {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort(compareCodePoint);
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  reject("E_CANON_TYPE", `value of type ${t} is not canonicalisable`);
  return "";
}

export function sha256Hex(text) {
  return crypto.createHash("sha256").update(canonicalText(text), "utf8").digest("hex");
}

export function digestOf(value) {
  return sha256Hex(canonicalJson(value));
}

// RecordRef / typed-ref ordering: by kind, then ref, code-point order, deduplicated (shared §2 —
// relatedRefs and sortedSemanticEvidenceRefs both use this; without it the same set submitted in a
// different order hashes differently and the coverage check is decorative).
export function sortTypedRefs(refs) {
  const seen = new Set();
  const out = [];
  for (const r of refs || []) {
    if (!r || typeof r !== "object") reject("E_REF_SHAPE", "typed ref must be an object {kind, ref}", r);
    if (typeof r.kind !== "string" || typeof r.ref !== "string") {
      reject("E_REF_SHAPE", "typed ref requires string kind and ref", r);
    }
    // Key on the canonical pair rather than a delimiter-joined string: no separator can collide
    // with an id, and the source stays free of control characters (the repo text-integrity gate).
    const key = canonicalJson({ kind: r.kind, ref: r.ref });
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: r.kind, ref: r.ref });
  }
  out.sort((a, b) => compareCodePoint(a.kind, b.kind) || compareCodePoint(a.ref, b.ref));
  return out;
}

// shared §2 batchDigest total order. The caller's insertion order must NOT reach the digest:
// results sort by the canonical testRef triple, findings by (closed kind order, binding, full
// canonical bytes) with a null binding first.
export const FINDING_KIND_ORDER = ["wrong-tag", "missing-source", "scope-violation", "assum-reading-change"];

function findingSortKey(finding) {
  const kindIndex = FINDING_KIND_ORDER.indexOf(finding && finding.kind);
  return [
    kindIndex < 0 ? FINDING_KIND_ORDER.length : kindIndex,          // unknown kinds sort last, deterministically
    finding && finding.binding === undefined ? 0 : 1,               // null-first
    finding && finding.binding === undefined ? "" : canonicalJson(finding.binding),
    canonicalJson(finding),                                          // final tie-break: full canonical bytes
  ];
}

function compareKeys(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (typeof a[i] === "number") { if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; continue; }
    const c = compareCodePoint(a[i], b[i]);
    if (c !== 0) return c;
  }
  return 0;
}

export function canonicalizeBatchSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return snapshot;
  const out = { ...snapshot };
  if (Array.isArray(out.results)) {
    out.results = out.results
      .map((r) => {
        const copy = { ...r };
        if (Array.isArray(copy.findings)) {
          copy.findings = [...copy.findings].sort((x, y) => compareKeys(findingSortKey(x), findingSortKey(y)));
        }
        return copy;
      })
      .sort((x, y) => compareKeys(
        [String(x.testRef?.path ?? ""), String(x.testRef?.adapterId ?? ""), String(x.testRef?.structuralId ?? "")],
        [String(y.testRef?.path ?? ""), String(y.testRef?.adapterId ?? ""), String(y.testRef?.structuralId ?? "")],
      ));
  }
  return out;
}

// shared §2: resolutionGroupDigest = sha256(canonicalJson({subjectRef, action, successor,
// sortedSemanticEvidenceRefs})). This is the ONLY carrier for "one witness covers this whole
// evidence set" — a missing sibling changes the digest, which is exactly the intended failure.
export function resolutionGroupDigest({ subjectRef, action, successor, semanticEvidenceRefs }) {
  return digestOf({
    subjectRef,
    action,
    successor: successor === undefined ? null : successor,
    sortedSemanticEvidenceRefs: sortTypedRefs(semanticEvidenceRefs),
  });
}

// --- ids ---------------------------------------------------------------------------------------
// `<PREFIX>-<ULID>` (intent-scan §8). ULID keeps ids branch-safe: different ids never collide, so
// immutable objects merge by set-union. It does NOT make merges automatic — same-subject
// transitions, divergent DP outcomes and same-id/different-payload all still fail closed.

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function encodeUlidTime(ms) {
  let out = "";
  let t = ms;
  for (let i = 0; i < 10; i++) {
    out = CROCKFORD[t % 32] + out;
    t = Math.floor(t / 32);
  }
  return out;
}

export function ulid(now = Date.now(), randomBytes = crypto.randomBytes) {
  const bytes = randomBytes(10);
  let rand = "";
  for (let i = 0; i < 16; i++) {
    // 16 chars * 5 bits = 80 bits = the 10 random bytes, read as a bit stream.
    const bit = i * 5;
    const byte = bit >> 3;
    const shift = bit & 7;
    const chunk = ((bytes[byte] << 8) | (bytes[byte + 1] || 0)) >> (11 - shift);
    rand += CROCKFORD[chunk & 31];
  }
  return encodeUlidTime(now) + rand;
}

export function makeIdFactory(options = {}) {
  const mint = options.ulid || ulid;
  return (prefix) => `${prefix}-${mint()}`;
}

// --- store schema, empty store, canonical bytes --------------------------------------------------

export const PROVENANCE_VERSION = 1;
export const STORE_SECTIONS = ["sources", "clauses", "transitions", "records", "decisionPoints", "taskStates"];

// shared §9: the canonical empty store, used verbatim when baseProvenance.treeOid has no store file.
export function emptyStore() {
  return {
    provenanceVersion: PROVENANCE_VERSION,
    sources: [],
    clauses: [],
    transitions: [],
    records: [],
    decisionPoints: [],
    taskStates: [],
  };
}

export function storePath(cwd) {
  return path.join(cwd, ".ctide", "provenance.json");
}

// The canonical store path is FIXED (shared §9 base witness): a caller-supplied path would let a
// witness point at an arbitrary file.
export const CANONICAL_STORE_PATH = ".ctide/provenance.json";

// Each section keys off its OWN id field — records use recordId, not id. Getting this wrong makes
// the section fall back to `undefined`, silently preserving insertion order and breaking the
// reproducibility of `baseProvenance.storeDigest`.
function sectionSortKey(section, item) {
  if (section === "sources") return item.sourceId;
  if (section === "taskStates") return item.taskId;
  if (section === "records") return item.recordId;
  return item.id;
}

export function canonicalStoreBytes(store) {
  const ordered = { provenanceVersion: store.provenanceVersion };
  for (const section of STORE_SECTIONS) {
    const items = [...(store[section] || [])];
    items.sort((a, b) => compareCodePoint(sectionSortKey(section, a), sectionSortKey(section, b)));
    ordered[section] = items;
  }
  return `${canonicalJson(ordered)}\n`;
}

export function storeDigest(store) {
  return sha256Hex(canonicalStoreBytes(store));
}

export function parseStore(text) {
  let raw;
  try {
    raw = JSON.parse(canonicalText(text));
  } catch (e) {
    reject("E_STORE_MALFORMED", `provenance store is not valid JSON: ${e.message}`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    reject("E_STORE_MALFORMED", "provenance store must be a JSON object");
  }
  if (raw.provenanceVersion !== PROVENANCE_VERSION) {
    reject("E_STORE_VERSION", `unsupported provenanceVersion ${JSON.stringify(raw.provenanceVersion)}`);
  }
  const store = { provenanceVersion: PROVENANCE_VERSION };
  for (const section of STORE_SECTIONS) {
    const v = raw[section];
    if (v === undefined) reject("E_STORE_MALFORMED", `provenance store is missing section "${section}"`);
    if (!Array.isArray(v)) reject("E_STORE_MALFORMED", `provenance store section "${section}" must be an array`);
    store[section] = v;
  }
  return store;
}

export function loadStore(cwd) {
  const file = storePath(cwd);
  if (!fs.existsSync(file)) {
    const store = emptyStore();
    return { store, bytes: null, digest: storeDigest(store), exists: false, file };
  }
  const bytes = fs.readFileSync(file, "utf8");
  return { store: parseStore(bytes), bytes, digest: sha256Hex(bytes), exists: true, file };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// --- model index & derived fields ----------------------------------------------------------------

export const CLAUSE_PREFIXES = { "REQ-": "REQ", "DEC-": "DEC", "ASSUM-": "ASSUM" };

export function clauseKindOf(id) {
  if (typeof id !== "string") return null;
  for (const [prefix, kind] of Object.entries(CLAUSE_PREFIXES)) {
    if (id.startsWith(prefix)) return kind;
  }
  return null;
}

export const DISCIPLINES = ["security", "architecture", "code", "test", "operability", "ui-ux", "intent"];
export const RECORD_KINDS = [
  "source-authority", "user-answer", "review-ruling", "plan-gate",
  "constraint-revocation", "exception-grant", "provenance-batch",
];
export const TRANSITION_ACTIONS = ["revise", "supersede", "retire"];
export const AUTHORITY_KINDS = ["user", "discipline", "arbiter", "source-authority"];
export const REQ_AUTHORITIES = ["hard-constraint", "approved-requirement", "compatibility"];
export const REQ_KINDS = ["acceptance", "specification"];
export const SOURCE_CONTENT_KINDS = ["requirement", "policy", "external-contract", "exception-grant"];
export const DRIFT_MODES = ["repo-file", "snapshot-only"];
export const DP_DIMENSIONS = ["actor", "lifecycle", "data", "money", "external", "failure", "time", "OTHER"];
export const DP_STATUSES = ["open", "asked", "resolved", "decided", "assumed"];
export const DP_LAYERS = ["intent", "implementation"];
export const SUPERSEDE_DISPOSITIONS = [
  "migration", "version-boundary", "deprecation-window", "coordinated-cutover",
  "no-affected-dependents", "backward-compatible", "accepted-breaking",
];
// shared §8 closed reopen-trigger list.
export const REOPEN_TRIGGERS = [
  "new-dependent", "review-evidence-overturns-basis", "audit-material", "user-instruction",
  "source-drift", "safe-to-assume-flipped", "terminal-invalidated-no-successor",
  "new-applicable-binding-authority",
];

export function indexStore(store) {
  const index = {
    store,
    sources: new Map(),
    clauses: new Map(),
    transitions: new Map(),
    records: new Map(),
    dps: new Map(),
    taskStates: new Map(),
    transitionBySubject: new Map(),
  };
  for (const s of store.sources) index.sources.set(s.sourceId, s);
  for (const c of store.clauses) index.clauses.set(c.id, c);
  for (const t of store.transitions) {
    index.transitions.set(t.id, t);
    const list = index.transitionBySubject.get(t.subject) || [];
    list.push(t);
    index.transitionBySubject.set(t.subject, list);
  }
  for (const r of store.records) index.records.set(r.recordId, r);
  for (const d of store.decisionPoints) index.dps.set(d.id, d);
  for (const ts of store.taskStates) index.taskStates.set(ts.taskId, ts);
  return index;
}

// shared §2 derived fields. status(c) = active when no effective Transition; every clause has at
// most ONE (single terminal state), which validateMergeReconciliation enforces.
export function effectiveTransition(index, clauseId) {
  const list = index.transitionBySubject.get(clauseId) || [];
  return list.length === 1 ? list[0] : list.length === 0 ? null : list[0];
}

export function statusOf(index, clauseId) {
  const t = effectiveTransition(index, clauseId);
  if (!t) return "active";
  return t.action === "revise" ? "revised" : t.action === "supersede" ? "superseded" : "retired";
}

export function successorOf(index, clauseId) {
  const t = effectiveTransition(index, clauseId);
  return t && t.successor ? t.successor : null;
}

// Walk the successor chain to its active end (used by post-binding alignment and by the
// historical-convergence branch downstream). Cycle-safe.
export function activeSuccessorChainEnd(index, clauseId) {
  const seen = new Set();
  let current = clauseId;
  while (current && !seen.has(current)) {
    seen.add(current);
    if (statusOf(index, current) === "active") return current;
    const next = successorOf(index, current);
    if (!next) return null;
    current = next;
  }
  return null;
}

function sourceOfClause(index, clause) {
  if (!clause || !clause.sourceRef) return null;
  return index.sources.get(clause.sourceRef) || null;
}

export function isExceptionBacked(index, clause) {
  const src = sourceOfClause(index, clause);
  return !!(src && src.contentKind === "exception-grant");
}

// shared §9 Check A — snapshot integrity: recompute the digest over the stored excerpt. Always run.
export function checkSourceIntegrity(source) {
  if (!source) return { ok: false, reason: "missing-source" };
  if (typeof source.excerpt !== "string" || typeof source.digest !== "string") {
    return { ok: false, reason: "malformed-source" };
  }
  return sha256Hex(source.excerpt) === source.digest
    ? { ok: true }
    : { ok: false, reason: "check-a-digest-mismatch" };
}

// shared §2 mechanicallyApplicable, per clause kind. Deliberately NOT one shared predicate: the
// spec spells out three different meanings so downstream cannot guess what "source check" means
// for a DEC or an ASSUM.
export function mechanicallyApplicable(index, clauseId, now = Date.now()) {
  const clause = index.clauses.get(clauseId);
  if (!clause) return { ok: false, reason: "unknown-clause" };
  if (statusOf(index, clauseId) !== "active") return { ok: false, reason: "not-active" };
  const kind = clauseKindOf(clauseId);

  if (kind === "REQ") {
    const src = sourceOfClause(index, clause);
    const integrity = checkSourceIntegrity(src);
    if (!integrity.ok) return { ok: false, reason: integrity.reason };
    if (src.contentKind === "exception-grant") {
      if (!index.clauses.get(src.targetConstraintRef)) return { ok: false, reason: "exception-target-unresolvable" };
      // An unparseable expiry must NOT fail open: Date.parse returns NaN and every comparison with
      // NaN is false, which would silently read as "not expired".
      const expiresAt = Date.parse(src.expiry);
      if (!Number.isFinite(expiresAt)) return { ok: false, reason: "exception-expiry-unparseable" };
      if (expiresAt <= now) return { ok: false, reason: "exception-expired" };
    }
    return { ok: true };
  }

  if (kind === "DEC") {
    if (!isReviewerPrincipal(clause.approvedBy)) return { ok: false, reason: "bad-approvedBy" };
    if (!index.dps.get(clause.derivedFrom)) return { ok: false, reason: "derivedFrom-unresolvable" };
    const basis = basisRefsResolvable(index, clause.basisRefs);
    if (!basis.ok) return basis;
    return { ok: true };
  }

  if (kind === "ASSUM") {
    if (!isReviewerPrincipal(clause.governedBy)) return { ok: false, reason: "bad-governedBy" };
    if (!index.dps.get(clause.derivedFrom)) return { ok: false, reason: "derivedFrom-unresolvable" };
    const basis = basisRefsResolvable(index, clause.basisRefs);
    if (!basis.ok) return basis;
    return { ok: true };
  }

  return { ok: false, reason: "unknown-clause-kind" };
}

// ObservationalRef is disclosure-only and explicitly never resolved (shared §2).
function basisRefsResolvable(index, basisRefs) {
  for (const ref of basisRefs || []) {
    if (typeof ref === "string") {
      if (ref.startsWith("S-")) {
        if (!index.sources.get(ref)) return { ok: false, reason: `basisRef unresolvable: ${ref}` };
      }
      continue; // free-form ObservationalRef string — not resolved, by design
    }
    if (ref && typeof ref === "object" && ref.kind === "observational") continue;
    if (ref && typeof ref === "object" && typeof ref.ref === "string") {
      const resolved = resolveRecordRef(index, ref);
      if (!resolved.ok) return { ok: false, reason: `basisRef unresolvable: ${ref.kind}/${ref.ref}` };
      continue;
    }
    return { ok: false, reason: "malformed basisRef" };
  }
  return { ok: true };
}

export function isReviewerPrincipal(p) {
  if (!p || typeof p !== "object") return false;
  if (p.kind === "arbiter") return true;
  if (p.kind === "discipline") return DISCIPLINES.includes(p.discipline);
  return false;
}

export function principalsEqual(a, b) {
  if (!isReviewerPrincipal(a) || !isReviewerPrincipal(b)) return false;
  if (a.kind !== b.kind) return false;
  return a.kind === "arbiter" ? true : a.discipline === b.discipline;
}

// External-record contract (shared §2): resolvable = present ∧ kind matches ∧ minimum payload
// complete. exception-grant is the documented exception — it resolves into the Source namespace.
export function resolveRecordRef(index, ref) {
  if (!ref || typeof ref !== "object" || typeof ref.kind !== "string" || typeof ref.ref !== "string") {
    return { ok: false, reason: "malformed-ref" };
  }
  if (!RECORD_KINDS.includes(ref.kind)) return { ok: false, reason: "unknown-record-kind" };
  if (ref.kind === "exception-grant") {
    const src = index.sources.get(ref.ref);
    if (!src) return { ok: false, reason: "unresolvable" };
    if (src.contentKind !== "exception-grant") return { ok: false, reason: "kind-mismatch" };
    return { ok: true, value: src };
  }
  const rec = index.records.get(ref.ref);
  if (!rec) return { ok: false, reason: "unresolvable" };
  if (rec.kind !== ref.kind) return { ok: false, reason: "kind-mismatch" };
  const payload = recordPayloadComplete(rec);
  if (!payload.ok) return { ok: false, reason: payload.reason };
  return { ok: true, value: rec };
}

// shared §2 minimum payloads. Unknown EXTRA fields are tolerated on purpose: the model explicitly
// allows downstream specs to attach annotations (taskRef, REQ.acceptance, priorTerminalRef,
// classificationRulingRef, inputPacketSnapshot …). Unknown ENUM VALUES are not tolerated.
export function recordPayloadComplete(rec) {
  const need = (fields) => {
    for (const f of fields) {
      if (rec[f] === undefined || rec[f] === null) return { ok: false, reason: `record ${rec.recordId} missing ${f}` };
    }
    return { ok: true };
  };
  switch (rec.kind) {
    case "source-authority": return need(["recordId", "authorityIdentity"]);
    case "user-answer": return need(["recordId", "subjectRef", "answer"]);
    case "review-ruling": {
      const base = need(["recordId", "by", "subjectRef", "ruling"]);
      if (!base.ok) return base;
      if (!isReviewerPrincipal(rec.by)) return { ok: false, reason: `record ${rec.recordId} has malformed by` };
      return { ok: true };
    }
    case "plan-gate": {
      const base = need(["recordId", "target", "impact", "disposition", "approvedBy"]);
      if (!base.ok) return base;
      // §7: the proposal is a USER approval. Presence alone would let any value stand in.
      const approver = rec.approvedBy;
      const isUser = approver === "user" || (approver && typeof approver === "object" && approver.kind === "user");
      if (!isUser) return { ok: false, reason: `plan-gate ${rec.recordId} approvedBy must denote the user` };
      if (!SUPERSEDE_DISPOSITIONS.includes(rec.disposition)) {
        return { ok: false, reason: `plan-gate ${rec.recordId} has unknown disposition ${rec.disposition}` };
      }
      return { ok: true };
    }
    case "constraint-revocation": return need(["recordId", "targetConstraintRef", "authorityRef", "effectiveAt"]);
    case "provenance-batch": {
      const base = need(["recordId", "taskId", "inventoryDigest", "batchSnapshot", "batchDigest", "relatedRefs"]);
      if (!base.ok) return base;
      const witness = rec.batchSnapshot && rec.batchSnapshot.baseProvenance;
      if (!witness || typeof witness !== "object" || typeof witness.treeOid !== "string") {
        return { ok: false, reason: `provenance-batch ${rec.recordId} snapshot is missing its inline baseProvenance witness` };
      }
      if (rec.batchDigest !== digestOf(rec.batchSnapshot)) {
        return { ok: false, reason: `provenance-batch ${rec.recordId} batchDigest does not match its snapshot` };
      }
      return { ok: true };
    }
    default: return { ok: false, reason: `unknown record kind ${rec.kind}` };
  }
}

// shared §2 DP.scopeRulingRef binding: by == {discipline: intent} ∧ subjectRef == THIS DP. Another
// DP's legitimate intent ruling must not be borrowable.
export function scopeCovers(index, clauseId, dp) {
  const clause = index.clauses.get(clauseId);
  if (!clause) return { ok: false, reason: "unknown-clause" };
  if (clauseKindOf(clauseId) !== "REQ" || !isExceptionBacked(index, clause)) return { ok: true };
  const ref = dp && dp.scopeRulingRef;
  if (!ref) return { ok: false, reason: "scope-ruling-missing" };
  const resolved = resolveRecordRef(index, ref);
  if (!resolved.ok || ref.kind !== "review-ruling") return { ok: false, reason: "scope-ruling-unresolvable" };
  const ruling = resolved.value;
  // A plain intent ruling is NOT a scope-coverage determination. The spec's scopeCovers is the
  // intent discipline's explicit verdict, so the ruling has to be that typed verdict and has to
  // say true — otherwise "an intent reviewer once said something about this DP" would suffice.
  if (ruling.rulingKind !== "scope-coverage") return { ok: false, reason: "scope-ruling-not-scope-coverage" };
  if (ruling.scopeCovers !== true) return { ok: false, reason: "scope-ruling-says-not-covered" };
  if (!principalsEqual(ruling.by, { kind: "discipline", discipline: "intent" })) {
    return { ok: false, reason: "scope-ruling-not-intent" };
  }
  if (ruling.subjectRef !== dp.id) return { ok: false, reason: "scope-ruling-subject-mismatch" };
  return { ok: true };
}

export function applicable(index, clauseId, dp, now = Date.now()) {
  const mech = mechanicallyApplicable(index, clauseId, now);
  if (!mech.ok) return mech;
  return scopeCovers(index, clauseId, dp);
}

export const TERMINAL_FIELD_BY_KIND = { REQ: "resolvedBy", DEC: "decidedBy", ASSUM: "assumedAs" };
export const STATUS_BY_KIND = { REQ: "resolved", DEC: "decided", ASSUM: "assumed" };
export const TERMINAL_FIELDS = ["resolvedBy", "decidedBy", "assumedAs"];

export function currentTerminalRef(dp) {
  const set = TERMINAL_FIELDS.filter((f) => dp[f]);
  return set.length === 1 ? dp[set[0]] : null;
}

// --- validators ----------------------------------------------------------------------------------
// One validateAll(); every transaction runs it over its FINAL snapshot only (intent-scan §8 — the
// intermediate states of a terminal replacement are never validated and never hit disk).

function validateStructure(store) {
  const seen = new Map();
  const claim = (id, payload, what) => {
    if (id === undefined || id === null || typeof id !== "string" || !id) {
      reject("E_ID_MISSING", `${what} is missing its id`, payload);
    }
    const canon = canonicalJson(payload);
    if (seen.has(id)) {
      // Same id twice: identical payload is a merge duplicate we still refuse (append-only sections
      // must not carry it); different payload is the same-id/different-payload reconciliation case.
      reject(
        seen.get(id) === canon ? "E_DUPLICATE_ID" : "E_ID_PAYLOAD_CONFLICT",
        `duplicate id ${id} in the store`,
        id,
      );
    }
    seen.set(id, canon);
  };

  for (const s of store.sources) {
    claim(s.sourceId, s, "source");
    if (!SOURCE_CONTENT_KINDS.includes(s.contentKind)) reject("E_ENUM", `source ${s.sourceId} has unknown contentKind ${s.contentKind}`, s.sourceId);
    if (!DRIFT_MODES.includes(s.driftMode)) reject("E_ENUM", `source ${s.sourceId} has unknown driftMode ${s.driftMode}`, s.sourceId);
    if (typeof s.excerpt !== "string") reject("E_SHAPE", `source ${s.sourceId} needs a string excerpt`, s.sourceId);
    if (typeof s.digest !== "string") reject("E_SHAPE", `source ${s.sourceId} needs a digest`, s.sourceId);
    if (s.contentKind === "exception-grant") {
      for (const f of ["targetConstraintRef", "grantAuthorityRef", "scope", "expiry"]) {
        if (s[f] === undefined || s[f] === null) reject("E_SHAPE", `exception-grant source ${s.sourceId} missing ${f}`, s.sourceId);
      }
      // Structural, not usage-gated: an unparseable expiry must never enter the canonical store,
      // even on a grant nothing currently cites. Rejecting it only where a terminal happens to use
      // it leaves an un-evaluatable grant sitting in tracked state waiting to be adopted.
      if (!Number.isFinite(Date.parse(s.expiry))) {
        reject("E_SHAPE", `exception-grant source ${s.sourceId} has an unparseable expiry ${JSON.stringify(s.expiry)}`, s.sourceId);
      }
    }
  }

  for (const c of store.clauses) {
    claim(c.id, c, "clause");
    const kind = clauseKindOf(c.id);
    if (!kind) reject("E_ID_PREFIX", `clause ${c.id} has no recognised REQ-/DEC-/ASSUM- prefix`, c.id);
    // INV-3: clauses carry NO authored lifecycle fields; status/revisedBy/supersededBy are derived.
    for (const forbidden of ["status", "revisedBy", "supersededBy"]) {
      if (c[forbidden] !== undefined) reject("E_INV3_AUTHORED_LIFECYCLE", `clause ${c.id} must not author ${forbidden} (INV-3: derived from Transitions)`, c.id);
    }
    if (kind === "REQ") {
      if (!REQ_AUTHORITIES.includes(c.authority)) reject("E_ENUM", `REQ ${c.id} has unknown authority ${c.authority}`, c.id);
      if (!REQ_KINDS.includes(c.kind)) reject("E_ENUM", `REQ ${c.id} has unknown kind ${c.kind}`, c.id);
      if (typeof c.text !== "string") reject("E_SHAPE", `REQ ${c.id} needs text`, c.id);
      if (typeof c.sourceRef !== "string") reject("E_SHAPE", `REQ ${c.id} needs sourceRef`, c.id);
      if (c.authority === "hard-constraint") {
        if (!c.ownerRef || c.ownerRef.kind !== "source-authority" || typeof c.ownerRef.ref !== "string") {
          reject("E_SHAPE", `hard-constraint REQ ${c.id} needs ownerRef {kind:"source-authority", ref}`, c.id);
        }
      }
    }
    if (kind === "DEC") {
      if (c.layer !== "implementation") reject("E_ENUM", `DEC ${c.id} must have layer "implementation"`, c.id);
      if (!isReviewerPrincipal(c.approvedBy)) reject("E_SHAPE", `DEC ${c.id} needs a ReviewerPrincipal approvedBy`, c.id);
      if (typeof c.derivedFrom !== "string") reject("E_SHAPE", `DEC ${c.id} needs derivedFrom`, c.id);
      if (c.decision === undefined) reject("E_SHAPE", `DEC ${c.id} needs decision`, c.id);
      if (!Array.isArray(c.alternatives)) reject("E_SHAPE", `DEC ${c.id} needs alternatives[]`, c.id);
    }
    if (kind === "ASSUM") {
      if (!DP_LAYERS.includes(c.layer)) reject("E_ENUM", `ASSUM ${c.id} has unknown layer ${c.layer}`, c.id);
      if (!isReviewerPrincipal(c.governedBy)) reject("E_SHAPE", `ASSUM ${c.id} needs a ReviewerPrincipal governedBy`, c.id);
      if (typeof c.derivedFrom !== "string") reject("E_SHAPE", `ASSUM ${c.id} needs derivedFrom`, c.id);
      if (c.text === undefined) reject("E_SHAPE", `ASSUM ${c.id} needs text`, c.id);
      if (c.alternative === undefined) reject("E_SHAPE", `ASSUM ${c.id} needs alternative (the rejected reading)`, c.id);
      if (c.layer === "intent" && !c.scenario) reject("E_SHAPE", `intent-layer ASSUM ${c.id} needs scenario`, c.id);
    }
  }

  for (const t of store.transitions) {
    claim(t.id, t, "transition");
    if (!TRANSITION_ACTIONS.includes(t.action)) reject("E_ENUM", `transition ${t.id} has unknown action ${t.action}`, t.id);
    if (typeof t.subject !== "string") reject("E_SHAPE", `transition ${t.id} needs subject`, t.id);
    if (!t.authorityRef || !AUTHORITY_KINDS.includes(t.authorityRef.kind)) {
      reject("E_ENUM", `transition ${t.id} has unknown authorityRef.kind`, t.id);
    }
    if (t.authorityRef.kind === "discipline" && !DISCIPLINES.includes(t.authorityRef.discipline)) {
      reject("E_ENUM", `transition ${t.id} has unknown authorityRef.discipline`, t.id);
    }
    if (t.authorityRef.kind === "source-authority" && typeof t.authorityRef.ref !== "string") {
      reject("E_SHAPE", `transition ${t.id} source-authority authorityRef needs ref`, t.id);
    }
    if (!t.ackRef || typeof t.ackRef.kind !== "string") reject("E_SHAPE", `transition ${t.id} needs ackRef`, t.id);
    if (t.action === "retire" && t.successor !== null && t.successor !== undefined) {
      reject("E_SHAPE", `retire transition ${t.id} must have no successor`, t.id);
    }
    if (t.action !== "retire" && typeof t.successor !== "string") {
      reject("E_SHAPE", `transition ${t.id} (${t.action}) needs a successor clause ref`, t.id);
    }
  }

  for (const r of store.records) {
    claim(r.recordId, r, "record");
    if (!RECORD_KINDS.includes(r.kind)) reject("E_ENUM", `record ${r.recordId} has unknown kind ${r.kind}`, r.recordId);
    const payload = recordPayloadComplete(r);
    if (!payload.ok) reject("E_RECORD_PAYLOAD", payload.reason, r.recordId);
  }

  for (const d of store.decisionPoints) {
    claim(d.id, d, "decisionPoint");
    if (!DP_DIMENSIONS.includes(d.dimension)) reject("E_ENUM", `DP ${d.id} has unknown dimension ${d.dimension}`, d.id);
    if (!DP_STATUSES.includes(d.status)) reject("E_ENUM", `DP ${d.id} has unknown status ${d.status}`, d.id);
    if (!DP_LAYERS.includes(d.layer)) reject("E_ENUM", `DP ${d.id} has unknown layer ${d.layer}`, d.id);
    if (!d.scenario) reject("E_SHAPE", `DP ${d.id} needs a distinguishingScenario`, d.id);
    if (!d.classificationBasis) reject("E_SHAPE", `DP ${d.id} needs classificationBasis`, d.id);
    if (d.reopenedBy !== undefined && d.reopenedBy !== null && !REOPEN_TRIGGERS.includes(d.reopenedBy)) {
      reject("E_ENUM", `DP ${d.id} has reopenedBy outside the closed trigger list: ${d.reopenedBy}`, d.id);
    }
  }

  for (const ts of store.taskStates) {
    claim(ts.taskId, ts, "taskState");
    if (!Array.isArray(ts.currentTaskDpIds)) reject("E_SHAPE", `taskState ${ts.taskId} needs currentTaskDpIds[]`, ts.taskId);
    const base = ts.baseProvenance;
    if (!base || typeof base !== "object") reject("E_SHAPE", `taskState ${ts.taskId} needs baseProvenance`, ts.taskId);
    for (const f of ["treeOid", "storePath", "storeDigest"]) {
      if (typeof base[f] !== "string") reject("E_SHAPE", `taskState ${ts.taskId} baseProvenance needs ${f}`, ts.taskId);
    }
    if (base.storePath !== CANONICAL_STORE_PATH) {
      reject("E_BASE_STORE_PATH", `taskState ${ts.taskId} baseProvenance.storePath must be the canonical ${CANONICAL_STORE_PATH}`, ts.taskId);
    }
    if (ts.committedProvenanceBatchRef !== null && ts.committedProvenanceBatchRef !== undefined) {
      const ref = ts.committedProvenanceBatchRef;
      if (!ref || ref.kind !== "provenance-batch" || typeof ref.ref !== "string") {
        reject("E_SHAPE", `taskState ${ts.taskId} committedProvenanceBatchRef must be a provenance-batch RecordRef or null`, ts.taskId);
      }
    }
  }
}

function validateRefs(index) {
  for (const c of index.store.clauses) {
    const kind = clauseKindOf(c.id);
    if (kind === "REQ" && !index.sources.get(c.sourceRef)) {
      reject("E_DANGLING_REF", `REQ ${c.id} sourceRef ${c.sourceRef} does not resolve`, c.id);
    }
    if (kind === "REQ" && c.authority === "hard-constraint") {
      const owner = resolveRecordRef(index, c.ownerRef);
      if (!owner.ok || c.ownerRef.kind !== "source-authority") {
        reject("E_DANGLING_REF", `hard-constraint REQ ${c.id} ownerRef does not resolve to a source-authority record`, c.id);
      }
    }
    if ((kind === "DEC" || kind === "ASSUM") && !index.dps.get(c.derivedFrom)) {
      reject("E_DANGLING_REF", `${kind} ${c.id} derivedFrom ${c.derivedFrom} does not resolve`, c.id);
    }
  }
  for (const s of index.store.sources) {
    if (s.contentKind !== "exception-grant") continue;
    const target = index.clauses.get(s.targetConstraintRef);
    if (!target) reject("E_DANGLING_REF", `exception-grant ${s.sourceId} targetConstraintRef does not resolve`, s.sourceId);
    if (target.authority !== "hard-constraint") {
      reject("E_EXCEPTION_TARGET", `exception-grant ${s.sourceId} must target an authority=hard-constraint REQ`, s.sourceId);
    }
    if (canonicalJson(s.grantAuthorityRef) !== canonicalJson(target.ownerRef)) {
      reject("E_EXCEPTION_OWNER", `exception-grant ${s.sourceId} grantAuthorityRef must equal the target REQ's ownerRef`, s.sourceId);
    }
  }
  for (const t of index.store.transitions) {
    if (!index.clauses.get(t.subject)) reject("E_DANGLING_REF", `transition ${t.id} subject ${t.subject} does not resolve`, t.id);
    if (t.successor && !index.clauses.get(t.successor)) {
      reject("E_DANGLING_REF", `transition ${t.id} successor ${t.successor} does not resolve`, t.id);
    }
    const ack = resolveRecordRef(index, t.ackRef);
    if (!ack.ok) reject("E_DANGLING_REF", `transition ${t.id} ackRef does not resolve (${ack.reason})`, t.id);
  }
  for (const d of index.store.decisionPoints) {
    for (const f of TERMINAL_FIELDS) {
      if (d[f] && !index.clauses.get(d[f])) reject("E_DANGLING_REF", `DP ${d.id} ${f} ${d[f]} does not resolve`, d.id);
    }
    if (d.priorTerminalRef && !index.clauses.get(d.priorTerminalRef)) {
      reject("E_DANGLING_REF", `DP ${d.id} priorTerminalRef does not resolve`, d.id);
    }
    if (d.scopeRulingRef) {
      const r = resolveRecordRef(index, d.scopeRulingRef);
      if (!r.ok) reject("E_DANGLING_REF", `DP ${d.id} scopeRulingRef does not resolve (${r.reason})`, d.id);
    }
  }
  for (const ts of index.store.taskStates) {
    for (const dpId of ts.currentTaskDpIds) {
      if (!index.dps.get(dpId)) reject("E_DANGLING_REF", `taskState ${ts.taskId} membership ${dpId} does not resolve`, ts.taskId);
    }
    if (ts.committedProvenanceBatchRef) {
      const r = resolveRecordRef(index, ts.committedProvenanceBatchRef);
      if (!r.ok) reject("E_DANGLING_REF", `taskState ${ts.taskId} committed batch ref does not resolve`, ts.taskId);
    }
  }
}

// shared §2 validity table + witness binding. Every legal row has a positive path here; every
// authority boundary rejects. Witness binding is what stops a legitimate-but-unrelated record
// from being borrowed as authorisation.
function validateTransitionMatrix(index) {
  for (const t of index.store.transitions) {
    const subject = index.clauses.get(t.subject);
    const kind = clauseKindOf(t.subject);
    const auth = t.authorityRef;
    const ackResolved = resolveRecordRef(index, t.ackRef);
    if (!ackResolved.ok) reject("E_WITNESS_UNRESOLVABLE", `transition ${t.id} ackRef unresolvable`, t.id);
    const ack = ackResolved.value;

    if (kind === "REQ") {
      if (t.action === "revise") {
        reject("E_MATRIX_FORBIDDEN", `transition ${t.id}: REQ revise does not exist — REQ semantic change goes through supersede`, t.id);
      }
      if (subject.authority === "hard-constraint") {
        if (t.action === "supersede") {
          reject("E_MATRIX_FORBIDDEN", `transition ${t.id}: a hard-constraint REQ cannot be superseded — only a scoped exception or an owner revocation`, t.id);
        }
        // retire: source-authority matching ownerRef, witnessed by constraint-revocation.
        if (auth.kind !== "source-authority") {
          reject("E_MATRIX_AUTHORITY", `transition ${t.id}: retiring a hard-constraint needs authorityRef.kind=source-authority`, t.id);
        }
        if (auth.ref !== subject.ownerRef.ref) {
          reject("E_OWNER_MISMATCH", `transition ${t.id}: authorityRef.ref must equal the constraint's ownerRef`, t.id);
        }
        if (t.ackRef.kind !== "constraint-revocation") {
          reject("E_WITNESS_KIND", `transition ${t.id}: hard-constraint retire needs a constraint-revocation witness`, t.id);
        }
        if (canonicalJson(ack.authorityRef) !== canonicalJson(subject.ownerRef)) {
          reject("E_OWNER_MISMATCH", `transition ${t.id}: constraint-revocation.authorityRef must equal the constraint's ownerRef`, t.id);
        }
        if (ack.targetConstraintRef !== t.subject) {
          reject("E_WITNESS_TARGET", `transition ${t.id}: constraint-revocation targets a different constraint`, t.id);
        }
        continue;
      }
      // approved-requirement | compatibility
      if (auth.kind !== "user") {
        reject("E_MATRIX_AUTHORITY", `transition ${t.id}: REQ ${t.action} needs authorityRef.kind=user`, t.id);
      }
      assertUserClauseWitness(index, t, ack);
      continue;
    }

    if (kind === "DEC") {
      if (t.action === "revise") reject("E_MATRIX_FORBIDDEN", `transition ${t.id}: DEC has no revise action`, t.id);
      const successorKind = t.successor ? clauseKindOf(t.successor) : null;
      if (successorKind === "REQ") {
        if (auth.kind !== "user") reject("E_MATRIX_AUTHORITY", `transition ${t.id}: DEC → REQ is a product ruling and needs authorityRef.kind=user`, t.id);
        assertUserClauseWitness(index, t, ack);
        continue;
      }
      assertGoverningPrincipal(index, t, ack, subject.approvedBy, "DEC");
      continue;
    }

    if (kind === "ASSUM") {
      const successorKind = t.successor ? clauseKindOf(t.successor) : null;
      if (t.action === "supersede" && successorKind === "REQ") {
        if (auth.kind !== "user") reject("E_MATRIX_AUTHORITY", `transition ${t.id}: ASSUM → REQ needs authorityRef.kind=user`, t.id);
        assertUserClauseWitness(index, t, ack);
        continue;
      }
      if (t.action === "supersede" && successorKind === "DEC") {
        // governedBy ∨ arbiter ∨ formally rerouted current review principal — the last needs a
        // review-ruling whose by == the new DEC.approvedBy == authorityRef principal, bound to the DP.
        const successor = index.clauses.get(t.successor);
        const asPrincipal = authorityAsPrincipal(auth);
        const rerouted = isReviewerPrincipal(asPrincipal)
          && principalsEqual(asPrincipal, successor.approvedBy)
          && t.ackRef.kind === "review-ruling"
          && principalsEqual(ack.by, asPrincipal)
          && ack.subjectRef === subject.derivedFrom;
        if (!rerouted) assertGoverningPrincipal(index, t, ack, subject.governedBy, "ASSUM");
        else assertRulingSubjectBinding(index, t, ack, subject);
        continue;
      }
      // revise | retire
      assertGoverningPrincipal(index, t, ack, subject.governedBy, "ASSUM");
      continue;
    }

    reject("E_MATRIX_SUBJECT", `transition ${t.id}: unknown subject clause kind`, t.id);
  }
}

function authorityAsPrincipal(auth) {
  if (auth.kind === "arbiter") return { kind: "arbiter" };
  if (auth.kind === "discipline") return { kind: "discipline", discipline: auth.discipline };
  return null;
}

// intent-scan §6 as amended + AC54: a clause supersede/retire carried by user authority is
// witnessed by a plan-gate record, never by a bare user-answer. user-answer remains the witness
// for transitions an Ask answer produces directly, which the matrix does not currently reach.
function assertUserClauseWitness(index, t, ack) {
  if (t.ackRef.kind !== "plan-gate") {
    reject(
      "E_WITNESS_KIND",
      `transition ${t.id}: a user-authority clause ${t.action} must be witnessed by a plan-gate record (a user-answer may feed the gate but cannot stand in for it)`,
      t.id,
    );
  }
  if (ack.target !== t.subject) {
    reject("E_WITNESS_TARGET", `transition ${t.id}: plan-gate target ${ack.target} does not name the subject ${t.subject}`, t.id);
  }
  if (t.action === "supersede" && clauseKindOf(t.subject) === "REQ") {
    // §7: the proposal's three fields must match the Transition's compatibility block exactly.
    const compat = t.compatibility;
    if (!compat || typeof compat !== "object") {
      reject("E_COMPAT_MISSING", `transition ${t.id}: REQ supersede needs a compatibility block`, t.id);
    }
    if (!SUPERSEDE_DISPOSITIONS.includes(compat.disposition)) {
      reject("E_ENUM", `transition ${t.id}: unknown compatibility disposition ${compat.disposition}`, t.id);
    }
    if (compat.impact !== ack.impact || compat.disposition !== ack.disposition) {
      reject("E_PROPOSAL_MISMATCH", `transition ${t.id}: compatibility block does not match the plan-gate proposal (impact/disposition)`, t.id);
    }
  }
}

function assertGoverningPrincipal(index, t, ack, governing, label) {
  const asPrincipal = authorityAsPrincipal(t.authorityRef);
  if (!asPrincipal) {
    reject("E_MATRIX_AUTHORITY", `transition ${t.id}: ${label} ${t.action} needs a discipline or arbiter authority`, t.id);
  }
  const allowed = asPrincipal.kind === "arbiter" || principalsEqual(asPrincipal, governing);
  if (!allowed) {
    reject(
      "E_MATRIX_AUTHORITY",
      `transition ${t.id}: ${label} ${t.action} must come from its governing principal or arbiter, not ${canonicalJson(asPrincipal)}`,
      t.id,
    );
  }
  if (t.ackRef.kind !== "review-ruling") {
    reject("E_WITNESS_KIND", `transition ${t.id}: a discipline/arbiter authority is witnessed by a review-ruling`, t.id);
  }
  if (!principalsEqual(ack.by, asPrincipal)) {
    reject("E_WITNESS_PRINCIPAL", `transition ${t.id}: review-ruling.by does not equal the declared authority principal`, t.id);
  }
  assertRulingSubjectBinding(index, t, ack, index.clauses.get(t.subject));
}

// shared §2: the ruling must be bound to THIS transition's subject or its DP — a legitimate ruling
// about something else is not authorisation.
function assertRulingSubjectBinding(index, t, ack, subject) {
  const dpId = subject && subject.derivedFrom;
  if (ack.subjectRef !== t.subject && (!dpId || ack.subjectRef !== dpId)) {
    reject("E_WITNESS_SUBJECT", `transition ${t.id}: review-ruling.subjectRef is bound to neither the subject clause nor its DP`, t.id);
  }
}

// shared §6 INV-1..4.
function validateInvariants(index, now) {
  for (const d of index.store.decisionPoints) {
    const set = TERMINAL_FIELDS.filter((f) => d[f]);
    if (set.length > 1) {
      reject("E_INV4_EXCLUSIVE", `INV-4: DP ${d.id} has more than one terminal ref (${set.join(", ")})`, d.id);
    }
    if (d.status === "assumed" && !d.assumedAs) reject("E_INV1", `INV-1: DP ${d.id} is assumed with no assumedAs`, d.id);
    if (d.status === "decided" && !d.decidedBy) reject("E_INV2", `INV-2: DP ${d.id} is decided with no decidedBy`, d.id);
    if (d.status === "resolved" && !d.resolvedBy) reject("E_INV2", `INV-2: DP ${d.id} is resolved with no resolvedBy`, d.id);
    if (set.length === 1) {
      const ref = d[set[0]];
      const kind = clauseKindOf(ref);
      if (TERMINAL_FIELD_BY_KIND[kind] !== set[0]) {
        reject("E_INV4_TYPE", `INV-4: DP ${d.id} holds ${ref} in ${set[0]} — type mismatch`, d.id);
      }
      if (d.status !== STATUS_BY_KIND[kind]) {
        reject("E_INV4_STATUS", `INV-4: DP ${d.id} status ${d.status} disagrees with terminal ${ref}`, d.id);
      }
      const app = applicable(index, ref, d, now);
      if (!app.ok) {
        reject("E_INV4_NOT_APPLICABLE", `INV-4: DP ${d.id} terminal ${ref} is not active+applicable (${app.reason})`, d.id);
      }
    } else if (["resolved", "decided", "assumed"].includes(d.status)) {
      reject("E_INV4_MISSING_TERMINAL", `INV-4: DP ${d.id} claims status ${d.status} with no terminal ref`, d.id);
    }
  }
}

// intent-scan §8 ID bullet: different-id immutable objects merge by set-union, but these three
// shapes must fail closed rather than be silently reconciled.
function validateMergeReconciliation(index) {
  for (const [subject, list] of index.transitionBySubject) {
    if (list.length > 1) {
      reject(
        "E_MULTIPLE_TRANSITIONS",
        `clause ${subject} has ${list.length} transitions — a clause has at most one effective transition (single terminal state)`,
        subject,
      );
    }
  }
  // duplicate ids (identical or divergent payloads) are caught in validateStructure's claim().
}

// shared §2 TaskState head three-state.
function validateTaskStatesAndHeads(index) {
  const batchesByTask = new Map();
  for (const r of index.store.records) {
    if (r.kind !== "provenance-batch") continue;
    const list = batchesByTask.get(r.taskId) || [];
    list.push(r);
    batchesByTask.set(r.taskId, list);
  }
  for (const [taskId, batches] of batchesByTask) {
    const owner = index.taskStates.get(taskId);
    if (!owner) {
      reject("E_BATCH_ORPHAN_TASK", `provenance-batch records exist for unknown task ${taskId}`, taskId);
    }
    // SM §9: "任何 batch 內攜帶的 witness 必須等於 tracked TaskState.baseProvenance；不等即
    // fail-closed". Checking this only when the batch is minted is not enough — an edited snapshot
    // with a recomputed batchDigest is internally consistent and would otherwise load cleanly.
    for (const b of batches) {
      const witness = b.batchSnapshot && b.batchSnapshot.baseProvenance;
      if (canonicalJson(witness) !== canonicalJson(owner.baseProvenance)) {
        reject(
          "E_BATCH_BASE_MISMATCH",
          `provenance-batch ${b.recordId}: its inline baseProvenance witness does not equal task ${taskId}'s tracked baseProvenance`,
          b.recordId,
        );
      }
    }
    for (const b of batches) {
      if (!b.previousBatchRef) continue;
      const prev = index.records.get(b.previousBatchRef.ref);
      if (!prev || prev.kind !== "provenance-batch") {
        reject("E_CHAIN_BROKEN", `batch ${b.recordId} previousBatchRef does not resolve to a provenance-batch`, b.recordId);
      }
      if (prev.taskId !== taskId) {
        reject("E_CHAIN_CROSS_TASK", `batch ${b.recordId} chains to a batch of a different task (${prev.taskId})`, b.recordId);
      }
    }
  }
  for (const ts of index.store.taskStates) {
    const batches = batchesByTask.get(ts.taskId) || [];
    const committed = ts.committedProvenanceBatchRef ? ts.committedProvenanceBatchRef.ref : null;
    if (batches.length === 0) {
      if (committed !== null) {
        reject("E_HEAD_STATE", `task ${ts.taskId} has no provenance-batch but committedProvenanceBatchRef is set`, ts.taskId);
      }
      continue; // legitimate un-submitted state
    }
    const referenced = new Set(batches.filter((b) => b.previousBatchRef).map((b) => b.previousBatchRef.ref));
    const tips = batches.filter((b) => !referenced.has(b.recordId)).map((b) => b.recordId);
    if (tips.length === 0) reject("E_HEAD_STATE", `task ${ts.taskId} batch chain has no tip (broken chain)`, ts.taskId);
    if (tips.length > 1) reject("E_HEAD_STATE", `task ${ts.taskId} batch chain has ${tips.length} tips — reconciliation required`, ts.taskId);
    if (committed !== tips[0]) {
      reject("E_HEAD_STATE", `task ${ts.taskId} committedProvenanceBatchRef does not equal the unique chain tip`, ts.taskId);
    }
  }
}

// IS §6 per-rulingKind postconditions + AC41 anti-borrowing. A governance ruling that merely EXISTS
// proves nothing: without these field comparisons another DP's perfectly legitimate ruling can be
// pinned to a freshly-minted clause. "The DEC this ruling created" is not a stored field, so the
// binding has to be reconstructed from comparable fields.
export const RULING_KINDS = [
  "binding-policy", "technical-decision", "approved-provisional",
  "product-tradeoff", "scope-coverage", "layer-classification",
];
// Closed allowlists for the two places a DP points at a ruling.
export const CLASSIFICATION_RULING_KINDS = ["layer-classification", "product-tradeoff"];

// IS §4 canonical payload — a CLOSED required shape. Checking only digest/principal let a packet
// carrying almost nothing but requestedPrincipal mint a DEC: the freshness comparison skipped every
// absent field, so "fewer fields" meant "fewer checks".
export const PACKET_REQUIRED_FIELDS = [
  "dpId", "scenario", "alternatives", "layer", "classificationBasis",
  "materialReasons", "requestedPrincipal", "basisRefs",
];

// IS §6 governance-ruling contract: the per-rulingKind output payload. A ruling that omits its own
// kind's fields cannot be applied, so the omission must fail rather than skip.
export const RULING_OUTPUT_FIELDS = {
  "binding-policy": ["bindingClauseRef"],
  "technical-decision": ["selectedAlternative"],
  "approved-provisional": ["selectedAlternative", "rejectedAlternative", "basis"],
  "product-tradeoff": ["productQuestion", "alternatives"],
  "scope-coverage": ["scopeCovers"],
  "layer-classification": ["classifiedLayer"],
};

// SM §4 says materialReasons is "the list of failed conjuncts" but declares no machine-readable
// member set, so membership CANNOT be enforced here without inventing spec content downstream —
// that gap is raised for the spec, not papered over. What is enforceable without inventing
// anything: element type, no duplicates, and canonical ordering.
function assertMaterialReasonsCanonical(rec, reasons) {
  for (const r of reasons) {
    if (typeof r !== "string" || r.length === 0) {
      reject("E_RULING_PACKET_INCOMPLETE", `review-ruling ${rec.recordId}: every materialReasons entry must be a non-empty string`, rec.recordId);
    }
  }
  const canonical = [...new Set(reasons)].sort(compareCodePoint);
  if (canonicalJson(reasons) !== canonicalJson(canonical)) {
    reject(
      "E_RULING_PACKET_ORDER",
      `review-ruling ${rec.recordId}: materialReasons must be deduplicated and in canonical order, or the same set hashes differently`,
      rec.recordId,
    );
  }
}

// IS §4: basisRefs normalise to [(sourceId, digest) | RecordRef | ObservationalRef]. Anything else —
// including a bare null — is not a basis reference.
function basisRefSortKey(ref) {
  if (typeof ref === "string") return ["observational", ref];
  if (ref && typeof ref.sourceId === "string") return ["source", ref.sourceId];
  if (ref && ref.kind === "observational") return ["observational", canonicalJson(ref)];
  return [String(ref && ref.kind), String(ref && ref.ref)];
}

function assertPacketBasisRefsCanonical(rec, refs) {
  for (const ref of refs) {
    const ok = (typeof ref === "string" && ref.length > 0)
      || (ref && typeof ref === "object" && typeof ref.sourceId === "string" && typeof ref.digest === "string")
      || (ref && typeof ref === "object" && ref.kind === "observational")
      || (ref && typeof ref === "object" && RECORD_KINDS.includes(ref.kind) && typeof ref.ref === "string");
    if (!ok) {
      reject(
        "E_RULING_PACKET_INCOMPLETE",
        `review-ruling ${rec.recordId}: ${JSON.stringify(ref)} is not a normalised basisRef ({sourceId,digest} | RecordRef | ObservationalRef)`,
        rec.recordId,
      );
    }
  }
  const sorted = [...refs].sort((a, b) => {
    const ka = basisRefSortKey(a);
    const kb = basisRefSortKey(b);
    return compareCodePoint(ka[0], kb[0]) || compareCodePoint(ka[1], kb[1]);
  });
  if (canonicalJson(refs) !== canonicalJson(sorted)) {
    reject("E_RULING_PACKET_ORDER", `review-ruling ${rec.recordId}: basisRefs must be in canonical order (kind, then id/description)`, rec.recordId);
  }
}

function assertTypedRulingComplete(rec) {
  if (rec.inputPacketSnapshot === undefined || rec.inputPacketDigest === undefined) {
    reject(
      "E_RULING_PACKET_MISSING",
      `review-ruling ${rec.recordId} declares rulingKind=${rec.rulingKind} but carries no inputPacketSnapshot/inputPacketDigest — a typed ruling without its packet cannot be checked`,
      rec.recordId,
    );
  }
  if (digestOf(rec.inputPacketSnapshot) !== rec.inputPacketDigest) {
    reject("E_RULING_SNAPSHOT", `review-ruling ${rec.recordId}: inputPacketDigest does not match its own inputPacketSnapshot`, rec.recordId);
  }
  const packet = rec.inputPacketSnapshot;
  // CLOSED means closed in both directions: an undeclared extra key is as illegal as a missing one,
  // or the "canonical payload" is merely a minimum and anything may ride along inside the digest.
  const keys = Object.keys(packet).sort(compareCodePoint);
  const expected = [...PACKET_REQUIRED_FIELDS].sort(compareCodePoint);
  if (canonicalJson(keys) !== canonicalJson(expected)) {
    const extra = keys.filter((k) => !expected.includes(k));
    const missing = expected.filter((k) => !keys.includes(k));
    reject(
      "E_RULING_PACKET_INCOMPLETE",
      `review-ruling ${rec.recordId}: the input packet's key set is not the canonical closed set`
      + `${missing.length ? ` (missing: ${missing.join(", ")})` : ""}${extra.length ? ` (undeclared: ${extra.join(", ")})` : ""}`,
      rec.recordId,
    );
  }
  for (const field of PACKET_REQUIRED_FIELDS) {
    if (packet[field] === undefined || packet[field] === null) {
      reject("E_RULING_PACKET_INCOMPLETE", `review-ruling ${rec.recordId}: its input packet is missing the required field "${field}"`, rec.recordId);
    }
  }
  // Per-field types, not merely presence.
  if (typeof packet.dpId !== "string" || typeof packet.scenario !== "string"
      || typeof packet.classificationBasis !== "string") {
    reject("E_RULING_PACKET_INCOMPLETE", `review-ruling ${rec.recordId}: dpId, scenario and classificationBasis must be strings`, rec.recordId);
  }
  if (!DP_LAYERS.includes(packet.layer)) {
    reject("E_ENUM", `review-ruling ${rec.recordId}: the packet's layer must be intent or implementation`, rec.recordId);
  }
  if (!isReviewerPrincipal(packet.requestedPrincipal)) {
    reject("E_RULING_PACKET_INCOMPLETE", `review-ruling ${rec.recordId}: the packet's requestedPrincipal is not a ReviewerPrincipal`, rec.recordId);
  }
  for (const field of ["alternatives", "materialReasons", "basisRefs"]) {
    if (!Array.isArray(packet[field])) {
      reject("E_RULING_PACKET_INCOMPLETE", `review-ruling ${rec.recordId}: the packet's ${field} must be an array`, rec.recordId);
    }
  }
  assertMaterialReasonsCanonical(rec, packet.materialReasons);
  assertPacketBasisRefsCanonical(rec, packet.basisRefs);
  // The ruling's subject and its packet's DP are ONE identity. Left unbound, freshness checks the
  // packet's DP while anti-borrowing checks the subject — two different DPs, each check satisfied.
  if (rec.subjectRef !== packet.dpId) {
    reject(
      "E_RULING_SUBJECT_PACKET_MISMATCH",
      `review-ruling ${rec.recordId}: subjectRef ${rec.subjectRef} and the packet's dpId ${packet.dpId} name different DPs — a typed ruling's subject IS its packet's DP`,
      rec.recordId,
    );
  }
  // IS §4: the packet names the principal the ruling was requested from; a ruling issued by
  // somebody else is not an answer to that packet.
  if (!principalsEqual(packet.requestedPrincipal, rec.by)) {
    reject(
      "E_RULING_PRINCIPAL",
      `review-ruling ${rec.recordId}: the packet's requestedPrincipal does not equal the ruling's by`,
      rec.recordId,
    );
  }
  if (rec.basis === undefined || rec.basis === null) {
    reject("E_RULING_OUTPUT_INCOMPLETE", `review-ruling ${rec.recordId}: a typed ruling must state its basis`, rec.recordId);
  }
  for (const field of RULING_OUTPUT_FIELDS[rec.rulingKind] || []) {
    if (rec[field] === undefined || rec[field] === null) {
      reject("E_RULING_OUTPUT_INCOMPLETE", `review-ruling ${rec.recordId} (${rec.rulingKind}) is missing its required output field "${field}"`, rec.recordId);
    }
  }
  if (rec.rulingKind === "scope-coverage" && typeof rec.scopeCovers !== "boolean") {
    reject("E_RULING_OUTPUT_INCOMPLETE", `review-ruling ${rec.recordId}: scope-coverage must state scopeCovers as a boolean`, rec.recordId);
  }
  if (rec.rulingKind === "layer-classification" && !DP_LAYERS.includes(rec.classifiedLayer)) {
    reject("E_ENUM", `review-ruling ${rec.recordId}: classifiedLayer must be intent or implementation`, rec.recordId);
  }
}

// IS §4 freshness, checked BEFORE the mutation lands: the packet the reviewer answered must still
// describe the DP as it stands. Only the DP-derived fields are reconstructible here — `basisRefs`
// lives in the orchestrator's packet, not on the DP, so it is outside this script's reach and is
// stated as such rather than pretended.
export const PACKET_DP_FIELDS = ["scenario", "alternatives", "layer", "classificationBasis", "materialReasons"];

export function assertRulingPacketFresh(preIndex, rec) {
  const snapshot = rec.inputPacketSnapshot;
  const dpId = snapshot.dpId;
  const dp = preIndex.dps.get(dpId);
  if (!dp) {
    reject("E_RULING_PACKET_STALE", `review-ruling ${rec.recordId}: its packet names DP ${dpId}, which does not exist`, rec.recordId);
  }
  for (const field of PACKET_DP_FIELDS) {
    // The packet's shape is closed and already validated, so every field is present: a missing one
    // can no longer buy an exemption from the comparison.
    const current = field === "materialReasons" ? (dp[field] ?? []) : dp[field];
    if (canonicalJson(snapshot[field]) !== canonicalJson(current)) {
      reject(
        "E_RULING_PACKET_STALE",
        `review-ruling ${rec.recordId}: the packet's ${field} no longer matches DP ${dpId} — the ruling answered an earlier state and must be re-issued`,
        rec.recordId,
      );
    }
  }
}

// Which rulings does THIS transaction consume? Freshness is a property of the moment of use, not of
// the moment of creation: a ruling persisted while the DP said one thing must not be spendable
// after the DP says another. Collect every ruling newly pointed at by this transaction.
export function newlyConsumedRulingRefs(store, next) {
  const refs = new Set();
  const add = (ref) => {
    if (ref && typeof ref === "object" && ref.kind === "review-ruling" && typeof ref.ref === "string") refs.add(ref.ref);
  };
  const beforeClauses = new Set(store.clauses.map((c) => c.id));
  for (const c of next.clauses) {
    if (beforeClauses.has(c.id)) continue;
    for (const ref of c.basisRefs || []) add(ref);
  }
  const beforeTransitions = new Set(store.transitions.map((t) => t.id));
  for (const t of next.transitions) {
    if (beforeTransitions.has(t.id)) continue;
    add(t.ackRef);
  }
  const beforeDps = new Map(store.decisionPoints.map((d) => [d.id, d]));
  for (const d of next.decisionPoints) {
    const was = beforeDps.get(d.id);
    for (const field of ["classificationRulingRef", "scopeRulingRef", "resolutionRulingRef"]) {
      if (!d[field]) continue;
      // canonicalJson refuses `undefined` by design (it is not a JSON value), so normalise the
      // absent pre-state to null rather than throwing on the very common "field appears for the
      // first time" case.
      const wasValue = was && was[field] !== undefined ? was[field] : null;
      if (canonicalJson(wasValue) === canonicalJson(d[field])) continue; // unchanged, already vetted
      add(d[field]);
    }
  }
  return refs;
}

// A carrier `replace` is a CONSUMPTION, and consumption is DECLARED by the payload — it cannot be
// inferred from whether the stored ref changed. Re-affirming the same ruling after the DP has moved
// spends it again, yet produces no diff, so the walk above would silently skip freshness (IS AC63).
// This is a UNION with that walk, not a replacement: the diff still covers paths that set a carrier
// without a carrier-update entry (a DP arriving through init-task / resume-task, say).
export function carrierConsumedRulingRefs(payload) {
  const refs = new Set();
  for (const u of (payload && payload.resolutionCarrierUpdates) || []) {
    if (!u || u.action !== "replace") continue;
    const ref = u.rulingRef;
    if (ref && typeof ref === "object" && ref.kind === "review-ruling" && typeof ref.ref === "string") {
      refs.add(ref.ref);
    }
  }
  return refs;
}

function validateGovernanceRulings(index) {
  for (const rec of index.store.records) {
    if (rec.kind !== "review-ruling" || rec.rulingKind === undefined) continue;
    if (!RULING_KINDS.includes(rec.rulingKind)) {
      reject("E_ENUM", `review-ruling ${rec.recordId} has unknown rulingKind ${rec.rulingKind}`, rec.recordId);
    }
    assertTypedRulingComplete(rec);
  }

  for (const c of index.store.clauses) {
    const kind = clauseKindOf(c.id);
    if (kind !== "DEC" && kind !== "ASSUM") continue;

    // SM §5 row 7: a DEC is a FORMAL engineering ruling. It may not exist without the typed ruling
    // that produced it — otherwise the whole postcondition apparatus is opt-in.
    if (kind === "DEC") {
      const typed = (c.basisRefs || []).some((r) => {
        if (!r || typeof r !== "object" || r.kind !== "review-ruling") return false;
        const rec = index.records.get(r.ref);
        return rec && rec.rulingKind === "technical-decision";
      });
      if (!typed) {
        reject(
          "E_DEC_RULING_REQUIRED",
          `DEC ${c.id} cites no technical-decision ruling — a DEC is a formal engineering ruling (SM §5 row 7) and cannot be minted without one`,
          c.id,
        );
      }
    }

    for (const ref of c.basisRefs || []) {
      if (!ref || typeof ref !== "object" || ref.kind !== "review-ruling") continue;
      const rec = index.records.get(ref.ref);
      if (!rec) continue; // resolvability is validateRefs'/mechanicallyApplicable's business
      // Anti-borrowing applies to EVERY cited ruling, typed or not: an untyped ruling about
      // another DP is exactly as much of a forgery as a typed one.
      if (rec.subjectRef !== c.derivedFrom && rec.subjectRef !== c.id) {
        reject(
          "E_RULING_BORROWED",
          `${kind} ${c.id} cites review-ruling ${rec.recordId}, which is bound to ${rec.subjectRef} — neither this clause nor its DP`,
          c.id,
        );
      }
      if (rec.rulingKind === undefined) continue; // bound, but carries no typed postcondition
      const alternatives = rec.inputPacketSnapshot ? rec.inputPacketSnapshot.alternatives : undefined;

      if (kind === "DEC" && rec.rulingKind === "technical-decision") {
        if (c.decision !== rec.selectedAlternative) {
          reject("E_RULING_POSTCONDITION", `DEC ${c.id}.decision does not equal the ruling's selectedAlternative`, c.id);
        }
        if (alternatives !== undefined && canonicalJson(c.alternatives) !== canonicalJson(alternatives)) {
          reject("E_RULING_POSTCONDITION", `DEC ${c.id}.alternatives does not equal the ruling's input snapshot alternatives`, c.id);
        }
        if (!principalsEqual(c.approvedBy, rec.by)) {
          reject("E_RULING_POSTCONDITION", `DEC ${c.id}.approvedBy does not equal the ruling's by`, c.id);
        }
        // store-script assertion (IS §13): the selection must come from the offered alternatives.
        if (alternatives !== undefined && !alternatives.some((a) => canonicalJson(a) === canonicalJson(rec.selectedAlternative))) {
          reject("E_RULING_SELECTION", `technical-decision ${rec.recordId}: selectedAlternative is not one of the input snapshot's alternatives`, rec.recordId);
        }
      }

      if (kind === "ASSUM" && rec.rulingKind === "approved-provisional") {
        if (c.text !== rec.selectedAlternative) {
          reject("E_RULING_POSTCONDITION", `ASSUM ${c.id}.text does not equal the ruling's selectedAlternative`, c.id);
        }
        if (c.alternative !== rec.rejectedAlternative) {
          reject("E_RULING_POSTCONDITION", `ASSUM ${c.id}.alternative does not equal the ruling's rejectedAlternative`, c.id);
        }
        if (rec.basis !== undefined && c.basis !== rec.basis) {
          reject("E_RULING_POSTCONDITION", `ASSUM ${c.id}.basis does not equal the ruling's basis`, c.id);
        }
        if (!principalsEqual(c.governedBy, rec.by)) {
          reject("E_RULING_POSTCONDITION", `ASSUM ${c.id}.governedBy does not equal the ruling's by`, c.id);
        }
        // store-script assertions (IS §13): distinct, and both drawn from the alternatives.
        if (canonicalJson(rec.selectedAlternative) === canonicalJson(rec.rejectedAlternative)) {
          reject("E_RULING_SELECTION", `approved-provisional ${rec.recordId}: selected and rejected alternatives must differ`, rec.recordId);
        }
        if (alternatives !== undefined) {
          for (const [label, value] of [["selected", rec.selectedAlternative], ["rejected", rec.rejectedAlternative]]) {
            if (!alternatives.some((a) => canonicalJson(a) === canonicalJson(value))) {
              reject("E_RULING_SELECTION", `approved-provisional ${rec.recordId}: the ${label} alternative is not in the input snapshot's alternatives`, rec.recordId);
            }
          }
        }
        const dp = index.dps.get(c.derivedFrom);
        if (dp && c.layer !== dp.layer) {
          reject("E_RULING_POSTCONDITION", `ASSUM ${c.id}.layer (${c.layer}) disagrees with its DP's layer (${dp.layer})`, c.id);
        }
      }
    }
  }

  // The binding-policy postcondition used to live here as a UNIVERSAL over every binding-policy
  // ruling bound to the DP. It has been WITHDRAWN: a universal over an append-only evidence set
  // says "every historical record must still describe the present", which permanently froze
  // DP.resolvedBy — a legitimate REQ-a → REQ-b supersede was refused by a ruling that had stopped
  // being current, and it contradicted this file's own rule that a ruling no longer referenced by a
  // current ref gets snapshot/digest self-consistency only. It is replaced by the single typed
  // CURRENT carrier checked in validateCarrierCoherence(). Rulings reachable only as history keep
  // the typed-shape and packet checks above and are never compared against a mutable current DP.

  for (const d of index.store.decisionPoints) {
    if (!d.classificationRulingRef) continue;
    const resolved = resolveRecordRef(index, d.classificationRulingRef);
    if (!resolved.ok || d.classificationRulingRef.kind !== "review-ruling") {
      reject("E_DANGLING_REF", `DP ${d.id} classificationRulingRef does not resolve to a review-ruling`, d.id);
    }
    const rec = resolved.value;
    // An explicit allowlist, not an accident of "only these two kinds carry extra postconditions":
    // a technical-decision ruling for the same DP would otherwise pass as a classification witness.
    if (!CLASSIFICATION_RULING_KINDS.includes(rec.rulingKind)) {
      reject(
        "E_RULING_KIND_NOT_ALLOWED",
        `DP ${d.id}: classificationRulingRef must name a ${CLASSIFICATION_RULING_KINDS.join(" or ")} ruling, got ${rec.rulingKind === undefined ? "an untyped ruling" : rec.rulingKind}`,
        d.id,
      );
    }
    if (rec.subjectRef !== d.id) {
      reject("E_RULING_BORROWED", `DP ${d.id} cites classification ruling ${rec.recordId}, which is bound to ${rec.subjectRef}`, d.id);
    }
    if (rec.rulingKind === "layer-classification" && d.layer !== rec.classifiedLayer) {
      reject("E_RULING_POSTCONDITION", `DP ${d.id}.layer (${d.layer}) does not equal the ruling's classifiedLayer (${rec.classifiedLayer})`, d.id);
    }
    if (rec.rulingKind === "product-tradeoff" && d.layer !== "intent") {
      reject("E_RULING_POSTCONDITION", `DP ${d.id}: a product-tradeoff ruling implies layer=intent, found ${d.layer}`, d.id);
    }
    if (rec.basis !== undefined && d.classificationBasis !== rec.basis) {
      reject("E_RULING_POSTCONDITION", `DP ${d.id}.classificationBasis does not equal the ruling's basis`, d.id);
    }
  }
}

// SM v1.11 §2/§9 "Carrier coherence". DP.resolutionRulingRef is the one CURRENT application
// carrier, and the binding-policy postcondition applies to it ALONE. This is a gate check, not
// merely a transaction-entry check: a state constructed around the command surface has to be
// refused too, or the invariant is only as strong as the writers that happen to go through it.
// It runs before validateRefs so an incoherent carrier is reported as such rather than as whatever
// dangling ref the same tampering happens to leave behind.
function validateCarrierCoherence(index) {
  for (const d of index.store.decisionPoints) {
    const carrier = d.resolutionRulingRef;
    if (carrier === undefined || carrier === null) continue;
    if (typeof carrier !== "object" || carrier.kind !== "review-ruling" || typeof carrier.ref !== "string") {
      reject("E_SHAPE", `DP ${d.id} resolutionRulingRef must be a review-ruling RecordRef or null`, d.id);
    }
    // carrier != null ⇒ status = resolved ∧ resolvedBy exists. (Its contrapositive is the other
    // stated direction: status != resolved ⇒ carrier = null.)
    if (d.status !== "resolved" || !d.resolvedBy) {
      reject(
        "E_CARRIER_STATUS",
        `DP ${d.id} keeps resolutionRulingRef ${carrier.ref} while status=${d.status} and resolvedBy=${d.resolvedBy || "absent"} — a carrier exists only on a resolved DP`,
        d.id,
      );
    }
    const resolved = resolveRecordRef(index, carrier);
    if (!resolved.ok) {
      reject("E_DANGLING_REF", `DP ${d.id} resolutionRulingRef ${carrier.ref} does not resolve to a review-ruling`, d.id);
    }
    const rec = resolved.value;
    if (rec.rulingKind !== "binding-policy") {
      reject(
        "E_CARRIER_RULING_KIND",
        `DP ${d.id}: resolutionRulingRef must name a binding-policy ruling, got ${rec.rulingKind === undefined ? "an untyped ruling" : rec.rulingKind}`,
        d.id,
      );
    }
    if (rec.subjectRef !== d.id) {
      reject("E_CARRIER_BORROWED", `DP ${d.id} cites binding-policy ruling ${rec.recordId}, which is bound to ${rec.subjectRef}`, d.id);
    }
    // Resolved through the ACTIVE successor chain, so a legal supersede may keep its carrier;
    // direct equality is the zero-length case of the same walk.
    const end = activeSuccessorChainEnd(index, rec.bindingClauseRef);
    if (end !== d.resolvedBy) {
      reject(
        "E_CARRIER_POSTCONDITION",
        `DP ${d.id} holds ${d.resolvedBy} while its current carrier ${rec.recordId} names ${rec.bindingClauseRef}, whose active successor chain ends at ${end === null ? "nothing active" : end}`,
        d.id,
      );
    }
  }
}

// IS v1.7 source 2 post-state coherence, checked on the SNAPSHOT so a state built around the
// command surface is refused too. The source-2 shape is identifiable without any transaction
// context: a DP left open whose priorTerminalRef has an effective Transition WITH a successor. The
// retire row (successor null) and reopen-dp on a still-active terminal (no effective Transition)
// fall outside this branch and keep their existing behaviour untouched.
function validateReopenCoherence(index, now) {
  for (const d of index.store.decisionPoints) {
    if (d.status !== "open" || !d.priorTerminalRef) continue;
    const t = effectiveTransition(index, d.priorTerminalRef);
    if (!t || !t.successor) continue;
    if (d.reopenedBy !== REOPEN_TRIGGER_SERIALIZATION) {
      reject(
        "E_REOPEN_TRIGGER_MISMATCH",
        `DP ${d.id} was reopened while ${d.priorTerminalRef} was replaced by ${t.successor}, so its reopenedBy must be the v1 serialization "${REOPEN_TRIGGER_SERIALIZATION}" of "terminal clause invalidated with no successor" — found "${d.reopenedBy}", which is a different cause`,
        d.id,
      );
    }
    const app = applicable(index, t.successor, d, now);
    if (app.ok) {
      reject(
        "E_REOPEN_PRIOR_INCOHERENT",
        `DP ${d.id} records a reopen against ${d.priorTerminalRef}, but that clause's successor ${t.successor} IS applicable to this DP — such a DP is repointed, so the recorded prior does not evidence the reopen`,
        d.id,
      );
    }
  }
}

export function validateAll(store, options = {}) {
  const now = options.now === undefined ? Date.now() : options.now;
  validateStructure(store);
  const index = indexStore(store);
  validateCarrierCoherence(index);
  validateReopenCoherence(index, now);
  validateRefs(index);
  validateMergeReconciliation(index);
  validateTransitionMatrix(index);
  validateGovernanceRulings(index);
  validateInvariants(index, now);
  validateTaskStatesAndHeads(index);
  return { ok: true, index };
}

// --- shared transaction helpers --------------------------------------------------------------------

function requireFields(payload, fields, command) {
  for (const f of fields) {
    if (payload[f] === undefined) reject("E_PAYLOAD_MISSING", `${command}: payload is missing "${f}"`, f);
  }
}

function findDp(draft, dpId, command) {
  const dp = draft.decisionPoints.find((d) => d.id === dpId);
  if (!dp) reject("E_UNKNOWN_DP", `${command}: DP ${dpId} does not exist`, dpId);
  return dp;
}

function setTerminal(dp, clauseId) {
  for (const f of TERMINAL_FIELDS) delete dp[f];
  const kind = clauseKindOf(clauseId);
  if (!kind) reject("E_ID_PREFIX", `cannot set a terminal to ${clauseId}: unrecognised clause prefix`, clauseId);
  dp[TERMINAL_FIELD_BY_KIND[kind]] = clauseId;
  dp.status = STATUS_BY_KIND[kind];
}

// IS §8 / AC35: a reopened DP whose prior terminal is STILL ACTIVE may only be settled through
// replace-terminal, which mints the Transition that takes the old clause out of active state.
// Every no-Transition path has to refuse it, not just adopt-existing-outcome.
function refuseReopenedWithActivePrior(draft, dp, command) {
  if (!dp.priorTerminalRef) return;
  if (statusOf(indexStore(draft), dp.priorTerminalRef) !== "active") return;
  reject(
    "E_REOPENED_NEEDS_TRANSITION",
    `${command}: DP ${dp.id} was reopened and its priorTerminalRef ${dp.priorTerminalRef} is still active — use replace-terminal so the old clause actually leaves active state`,
    dp.id,
  );
}

function reopenDpInPlace(dp, priorTerminalRef, trigger) {
  for (const f of TERMINAL_FIELDS) delete dp[f];
  dp.status = "open";
  dp.priorTerminalRef = priorTerminalRef;
  dp.reopenedBy = trigger;
}

// shared §8 "Terminal clause 替換 … 一律原子執行" step 4: every DP whose current terminal is the
// subject is repointed (successor applicable) or reopened, in the SAME transaction.
function applyDependentClosure(draft, subjectId, successorId, options = {}) {
  const { now, trigger = "terminal-invalidated-no-successor", strictDpIds = [] } = options;
  const index = indexStore(draft);
  const affected = draft.decisionPoints.filter((d) => currentTerminalRef(d) === subjectId);
  const strict = new Set(strictDpIds);
  for (const dp of affected) {
    let repointed = false;
    if (successorId) {
      const app = applicable(index, successorId, dp, now);
      repointed = app.ok;
      if (!repointed && strict.has(dp.id)) {
        reject(
          "E_INITIATING_DP_NOT_APPLICABLE",
          `successor ${successorId} is not applicable to initiating DP ${dp.id} (${app.reason}) — the whole transaction is rejected rather than superseding the clause and reopening the DP`,
          dp.id,
        );
      }
    } else if (strict.has(dp.id)) {
      reject("E_INITIATING_DP_NOT_APPLICABLE", `retire leaves initiating DP ${dp.id} with no successor`, dp.id);
    }
    if (repointed) {
      dp.priorTerminalRef = subjectId;
      setTerminal(dp, successorId);
    } else {
      reopenDpInPlace(dp, subjectId, trigger);
    }
  }
  // Initiating DPs that were NOT pointing at the subject still have to land on the successor
  // (intent-scan §8 supersede-requirement: "clause 已 supersede、initiating DP 仍 open" is the bug).
  for (const dpId of strict) {
    const dp = findDp(draft, dpId, "terminal-replacement");
    if (currentTerminalRef(dp) === successorId) continue;
    if (affected.some((a) => a.id === dpId)) continue;
    if (!successorId) reject("E_INITIATING_DP_NOT_APPLICABLE", `retire leaves initiating DP ${dpId} with no successor`, dpId);
    const app = applicable(indexStore(draft), successorId, dp, now);
    if (!app.ok) {
      reject("E_INITIATING_DP_NOT_APPLICABLE", `successor ${successorId} is not applicable to initiating DP ${dpId} (${app.reason})`, dpId);
    }
    dp.priorTerminalRef = currentTerminalRef(dp) || dp.priorTerminalRef;
    setTerminal(dp, successorId);
  }
}

// --- IS §8 carrier update contract ----------------------------------------------------------------
// resolutionCarrierUpdates[] is a per-dpId MAP, and every predicate below is scoped to its own
// entry. Writing any of them transaction-globally (for example "this transaction supplies no
// rulingRef") breaks the legitimate mixed case: one batch may hold DP-A resolving by direct
// citation with `clear` beside DP-B resolving under a policy ruling with `replace`, and DP-B's
// rulingRef must not fail DP-A's clear.

export const CARRIER_ACTIONS = ["preserve", "replace", "clear", "unchanged-null"];

const CARRIER_ACTIONS_BY_COMMAND = {
  "replace-terminal": ["preserve", "replace", "clear", "unchanged-null"],
  "supersede-requirement": ["preserve", "replace", "clear", "unchanged-null"],
  "reopen-dp": ["clear", "unchanged-null"],
  // adopt takes an initial-open or invalidated-terminal DP, so `preserve` has nothing to preserve
  // and `clear` is unreachable (such a DP is not resolved, hence its carrier is already null).
  "adopt-existing-outcome": ["replace", "unchanged-null"],
  "commit-test-provenance-batch": ["preserve", "replace", "clear", "unchanged-null"],
};

function terminalIdentity(dp) {
  return canonicalJson({
    status: dp.status,
    resolvedBy: dp.resolvedBy === undefined ? null : dp.resolvedBy,
    decidedBy: dp.decidedBy === undefined ? null : dp.decidedBy,
    assumedAs: dp.assumedAs === undefined ? null : dp.assumedAs,
  });
}

// Closed in both directions, per action: an undeclared key is as illegal as a missing one, or the
// entry shape is merely a minimum and anything may ride along.
const CARRIER_UPDATE_KEYS = {
  replace: ["action", "dpId", "rulingRef"],
  preserve: ["action", "dpId"],
  clear: ["action", "dpId"],
  "unchanged-null": ["action", "dpId"],
};

// IS v1.7 §8 clear source 2. Upstream SM §8's closed list defines the SEMANTIC MEMBER "terminal
// clause invalidated with no successor (INV-4)"; the string below is intent-scan v1's SERIALIZATION
// of that member, whose authority is the intent-scan spec. It is not a new trigger member, and
// shared model does not define the literal.
export const REOPEN_TRIGGER_SERIALIZATION = "terminal-invalidated-no-successor";

// Every clause transition this command carries, whichever shape it arrives in.
function transitionsOf(payload, command) {
  const out = [];
  if (command === "replace-terminal" || command === "supersede-requirement") {
    if (payload.transition) out.push(payload.transition);
  }
  if (command === "commit-test-provenance-batch") {
    for (const g of payload.resolutions || []) if (g && g.transitionDraft) out.push(g.transitionDraft);
  }
  return out;
}

// Which clauses does this transaction RETIRE? A dependent DP that ends up open because its terminal
// was retired is the retire/reopen row of the carrier table, not either restricted-clear row.
function retiredSubjects(payload, command) {
  const out = new Set();
  for (const t of transitionsOf(payload, command)) {
    if (typeof t.subject === "string" && (t.successor === null || t.successor === undefined)) out.add(t.subject);
  }
  return out;
}

// subject → successor, for the transitions that DO carry one. Source 2 only applies to these.
function supersedingSubjects(payload, command) {
  const out = new Map();
  for (const t of transitionsOf(payload, command)) {
    if (typeof t.subject === "string" && typeof t.successor === "string") out.set(t.subject, t.successor);
  }
  return out;
}

function carrierOf(dp) {
  return dp && dp.resolutionRulingRef !== undefined && dp.resolutionRulingRef !== null
    ? dp.resolutionRulingRef
    : null;
}

// IS v1.7 source 2, conditions 1-3 and 5-8. Conditions 1 and 2 are the security boundary: the
// caller can neither assert membership nor assert that a successor did not fit. Conditions 5-7 are
// the closure's own output, asserted here so a writer bug cannot pass silently, and condition 8 is
// WRITTEN by us — a caller-supplied reopenTrigger never survives on a source-2 DP.
function assertReopenedDependent({ command, dpId, dp, preDp, preTerminal, superseding, postIndex, now }) {
  const where = `${command}: DP ${dpId} declares clear with status=${dp.status}`;
  // 1. subject-dependent membership, from the PRE-state terminal — not from anything declared.
  if (preTerminal === null || !superseding.has(preTerminal)) {
    reject(
      "E_CARRIER_CLEAR",
      `${where}, but its pre-state terminal ${preTerminal || "(none)"} is not a subject this transaction supersedes — source 2 requires subject-dependent membership, and a non-resolved post-state has no other approved row`,
      dpId,
    );
  }
  const successor = superseding.get(preTerminal);
  // 2. the successor must genuinely not fit this DP; re-derived, never taken on trust.
  const app = applicable(postIndex, successor, preDp, now);
  if (app.ok) {
    reject(
      "E_CARRIER_CLEAR",
      `${where}, but successor ${successor} IS applicable to it — the closure repoints such a DP rather than reopening it, so source 2 does not apply`,
      dpId,
    );
  }
  // 3/5/6/7: what the dependent closure actually produced.
  if (dp.status !== "open") reject("E_CARRIER_CLEAR", `${where}: source 2 requires an open post-state`, dpId);
  if (currentTerminalRef(dp) !== null) {
    reject("E_CARRIER_CLEAR", `${where}: source 2 requires every terminal ref to be null`, dpId);
  }
  if (dp.priorTerminalRef !== preTerminal) {
    reject(
      "E_CARRIER_CLEAR",
      `${where}: priorTerminalRef is ${dp.priorTerminalRef} but this transaction's subject for it is ${preTerminal}`,
      dpId,
    );
  }
  // 8. Deterministic write. Whatever reopenTrigger the caller passed, the persisted value is the
  // v1 serialization of "terminal clause invalidated with no successor".
  dp.reopenedBy = REOPEN_TRIGGER_SERIALIZATION;
}

// The affected set is DERIVED by diffing pre- and post-state terminals rather than taken from the
// caller: dependent-DP closure reopens or repoints DPs the caller never named, and a contract that
// trusted a declared list would let exactly those slip through uncovered.
function applyCarrierUpdates(store, draft, payload, command, now) {
  const before = new Map(store.decisionPoints.map((d) => [d.id, d]));
  const mutated = new Set();
  for (const d of draft.decisionPoints) {
    const was = before.get(d.id);
    if (!was || terminalIdentity(was) !== terminalIdentity(d)) mutated.add(d.id);
  }
  const updates = payload.resolutionCarrierUpdates;
  if (updates === undefined || updates === null) {
    if (mutated.size === 0) return; // nothing moved (e.g. a clean batch): nothing to declare
    reject(
      "E_CARRIER_UPDATES_MISSING",
      `${command}: resolutionCarrierUpdates[] is required — ${[...mutated].join(", ")} had a terminal mutated and every such DP must declare its carrier disposition`,
      command,
    );
  }
  if (!Array.isArray(updates)) {
    reject("E_CARRIER_UPDATES_MISSING", `${command}: resolutionCarrierUpdates must be an array`, command);
  }
  const allowed = CARRIER_ACTIONS_BY_COMMAND[command];
  const seen = new Set();
  for (const u of updates) {
    if (!u || typeof u.dpId !== "string") {
      reject("E_SHAPE", `${command}: every resolutionCarrierUpdates entry needs a dpId`, u);
    }
    if (seen.has(u.dpId)) {
      reject("E_CARRIER_COVERAGE", `${command}: DP ${u.dpId} appears more than once in resolutionCarrierUpdates — the map is exactly one entry per DP`, u.dpId);
    }
    seen.add(u.dpId);
    if (!mutated.has(u.dpId)) {
      reject(
        "E_CARRIER_COVERAGE",
        `${command}: resolutionCarrierUpdates names DP ${u.dpId}, whose terminal this transaction does not mutate — the array may not be used to rewrite an unrelated DP's carrier`,
        u.dpId,
      );
    }
    if (!allowed.includes(u.action)) {
      reject("E_CARRIER_ACTION", `${command}: carrier action "${u.action}" is not one of ${allowed.join(", ")} for this transaction`, u.dpId);
    }
    const keys = Object.keys(u).sort(compareCodePoint);
    const expected = [...CARRIER_UPDATE_KEYS[u.action]].sort(compareCodePoint);
    if (canonicalJson(keys) !== canonicalJson(expected)) {
      const extra = keys.filter((k) => !expected.includes(k));
      const missing = expected.filter((k) => !keys.includes(k));
      reject(
        "E_CARRIER_SHAPE",
        `${command}: DP ${u.dpId}: a "${u.action}" carrier update's key set is not the canonical closed set`
        + `${missing.length ? ` (missing: ${missing.join(", ")})` : ""}${extra.length ? ` (undeclared: ${extra.join(", ")})` : ""}`,
        u.dpId,
      );
    }
  }
  for (const dpId of mutated) {
    if (!seen.has(dpId)) {
      reject("E_CARRIER_COVERAGE", `${command}: DP ${dpId} has its terminal mutated but is absent from resolutionCarrierUpdates`, dpId);
    }
  }

  const postIndex = indexStore(draft);
  const retired = retiredSubjects(payload, command);
  const superseding = supersedingSubjects(payload, command);
  for (const u of updates) {
    const dp = draft.decisionPoints.find((d) => d.id === u.dpId);
    const pre = carrierOf(before.get(u.dpId));
    const post = dp.resolvedBy === undefined ? null : dp.resolvedBy;

    if (u.action === "unchanged-null") {
      if (pre !== null) {
        reject(
          "E_CARRIER_UNCHANGED_NULL",
          `${command}: DP ${u.dpId} declares unchanged-null while its pre-state carrier is ${pre.ref} — unchanged-null asserts "this DP never had a carrier", it does not skip one`,
          u.dpId,
        );
      }
      delete dp.resolutionRulingRef;
      continue;
    }

    if (u.action === "clear") {
      if (pre === null) {
        reject("E_CARRIER_CLEAR", `${command}: DP ${u.dpId} declares clear while its pre-state carrier is already null — declare unchanged-null`, u.dpId);
      }
      const preDp = before.get(u.dpId);
      const preTerminal = preDp ? currentTerminalRef(preDp) : null;

      if (dp.status === "resolved") {
        // Source 1 (resolved-direct), unchanged by v1.7. A repointed DP taking the successor by
        // direct citation is exactly AC67's positive case, so this branch adds no condition.
      } else if (command === "reopen-dp" || retired.has(dp.priorTerminalRef)) {
        // Source 3: retire / reopen-dp. Untouched by v1.7.
      } else {
        // Source 2 (reopened-dependent). Every condition below is DERIVED here; nothing the caller
        // sent is consulted, and the persisted trigger is written by us, not accepted from them.
        assertReopenedDependent({
          command, dpId: u.dpId, dp, preDp, preTerminal, superseding, postIndex, now,
        });
      }
      delete dp.resolutionRulingRef;
      continue;
    }

    if (u.action === "preserve") {
      if (pre === null) reject("E_CARRIER_PRESERVE", `${command}: DP ${u.dpId} declares preserve but has no pre-state carrier`, u.dpId);
      const rec = postIndex.records.get(pre.ref);
      const end = rec ? activeSuccessorChainEnd(postIndex, rec.bindingClauseRef) : null;
      if (!rec || end !== post) {
        reject(
          "E_CARRIER_PRESERVE",
          `${command}: DP ${u.dpId} declares preserve, but its carrier ${pre.ref} names ${rec ? rec.bindingClauseRef : "an unresolvable clause"}, whose active successor chain ends at ${end === null ? "nothing active" : end} rather than the post-state ${post === null ? "absent terminal" : post}`,
          u.dpId,
        );
      }
      dp.resolutionRulingRef = pre;
      continue;
    }

    // replace
    const ref = u.rulingRef;
    if (!ref || typeof ref !== "object" || ref.kind !== "review-ruling" || typeof ref.ref !== "string") {
      reject("E_CARRIER_REPLACE", `${command}: DP ${u.dpId} declares replace but carries no review-ruling rulingRef`, u.dpId);
    }
    const resolved = resolveRecordRef(postIndex, ref);
    if (!resolved.ok) {
      reject("E_CARRIER_REPLACE", `${command}: DP ${u.dpId}: replacement carrier ${ref.ref} does not resolve to a review-ruling`, u.dpId);
    }
    const rec = resolved.value;
    if (rec.rulingKind !== "binding-policy") {
      reject(
        "E_CARRIER_RULING_KIND",
        `${command}: DP ${u.dpId}: a replacement carrier must be a binding-policy ruling, got ${rec.rulingKind === undefined ? "an untyped ruling" : rec.rulingKind}`,
        u.dpId,
      );
    }
    if (rec.subjectRef !== u.dpId) {
      reject("E_CARRIER_BORROWED", `${command}: DP ${u.dpId}: replacement carrier ${rec.recordId} is bound to ${rec.subjectRef}`, u.dpId);
    }
    // The chain-end postcondition and freshness are re-checked on the final snapshot
    // (validateCarrierCoherence / the consumption-time freshness pass in applyTransaction).
    dp.resolutionRulingRef = { kind: "review-ruling", ref: ref.ref };
  }
}

function pushSource(draft, source) {
  const s = { ...source };
  if (typeof s.excerpt === "string" && s.digest === undefined) s.digest = sha256Hex(s.excerpt);
  draft.sources.push(s);
  return s;
}

function pushRecords(draft, records, command) {
  const created = [];
  for (const r of records || []) {
    if (!r || typeof r.recordId !== "string") reject("E_PAYLOAD_MISSING", `${command}: recordsToCreate entry needs a recordId`, r);
    created.push(r);
    draft.records.push(r);
  }
  return created;
}

// --- domain transactions (pure: store → store) --------------------------------------------------
// Every transaction returns a NEW store. None of them touch the filesystem; runTransaction() owns
// CAS, temp write and atomic replace. Intermediate states exist only in memory.

export const TRANSACTIONS = {};

function defineTransaction(name, apply) {
  TRANSACTIONS[name] = apply;
}

defineTransaction("validate", (store) => store);

defineTransaction("init-task", (store, payload) => {
  requireFields(payload, ["taskId", "baseProvenance"], "init-task");
  const draft = clone(store);
  if (draft.taskStates.some((t) => t.taskId === payload.taskId)) {
    reject("E_TASK_EXISTS", `init-task: task ${payload.taskId} already exists (use resume-task)`, payload.taskId);
  }
  for (const dp of payload.decisionPoints || []) draft.decisionPoints.push(dp);
  draft.taskStates.push({
    taskId: payload.taskId,
    baseProvenance: payload.baseProvenance,
    currentTaskDpIds: [...(payload.currentTaskDpIds || [])],
    committedProvenanceBatchRef: null,
  });
  return draft;
});

defineTransaction("resume-task", (store, payload) => {
  requireFields(payload, ["taskId"], "resume-task");
  const draft = clone(store);
  const ts = draft.taskStates.find((t) => t.taskId === payload.taskId);
  if (!ts) reject("E_UNKNOWN_TASK", `resume-task: task ${payload.taskId} does not exist`, payload.taskId);
  if (payload.baseProvenance !== undefined
      && canonicalJson(payload.baseProvenance) !== canonicalJson(ts.baseProvenance)) {
    reject("E_BASE_IMMUTABLE", `resume-task: baseProvenance is immutable for the life of a task — reseating the base is refused`, payload.taskId);
  }
  for (const dp of payload.decisionPoints || []) draft.decisionPoints.push(dp);
  const before = new Set(ts.currentTaskDpIds);
  for (const id of payload.addDpIds || []) if (!before.has(id)) ts.currentTaskDpIds.push(id);
  if (payload.currentTaskDpIds !== undefined) {
    const next = new Set(payload.currentTaskDpIds);
    for (const id of before) {
      if (!next.has(id)) reject("E_MEMBERSHIP_SHRINK", `resume-task: membership is add-only — ${id} may not be dropped`, id);
    }
    for (const id of payload.currentTaskDpIds) if (!ts.currentTaskDpIds.includes(id)) ts.currentTaskDpIds.push(id);
  }
  return draft;
});

defineTransaction("append-source", (store, payload) => {
  requireFields(payload, ["source"], "append-source");
  const draft = clone(store);
  pushSource(draft, payload.source);
  return draft;
});

defineTransaction("append-record", (store, payload) => {
  requireFields(payload, ["record"], "append-record");
  const draft = clone(store);
  draft.records.push(payload.record);
  return draft;
});

// intent-scan §8: the ONLY legal path to a plan-approved AC on a zero-DP / skip-scan task. Pinned
// to approved-requirement so this door cannot mint a hard-constraint or a compatibility clause.
defineTransaction("create-requirement", (store, payload) => {
  requireFields(payload, ["requirement"], "create-requirement");
  const req = payload.requirement;
  if (clauseKindOf(req.id) !== "REQ") reject("E_ID_PREFIX", "create-requirement: id must be a REQ-…", req.id);
  if (req.authority !== "approved-requirement") {
    reject(
      "E_CREATE_REQ_AUTHORITY",
      `create-requirement may only mint authority=approved-requirement (got ${req.authority}) — hard-constraint and compatibility need their own authorised path`,
      req.id,
    );
  }
  requireFields(req, ["kind", "text", "sourceRef", "taskRef"], "create-requirement.requirement");
  if (req.kind === "acceptance" && (!req.acceptance || typeof req.acceptance !== "object")) {
    reject("E_PAYLOAD_MISSING", "create-requirement: an acceptance REQ needs the REQ.acceptance annotation", req.id);
  }
  const draft = clone(store);
  if (payload.source) pushSource(draft, payload.source);
  draft.clauses.push(req);
  return draft;
});

// intent-scan §8: open DP → NEW clause + terminal ref, no Transition (an initial outcome has no
// prior clause to be a transition's subject).
defineTransaction("create-initial-outcome", (store, payload) => {
  requireFields(payload, ["dpId", "clause"], "create-initial-outcome");
  const draft = clone(store);
  for (const s of payload.sources || []) pushSource(draft, s);
  pushRecords(draft, payload.records, "create-initial-outcome");
  const dp = findDp(draft, payload.dpId, "create-initial-outcome");
  if (currentTerminalRef(dp)) {
    reject("E_DP_HAS_TERMINAL", `create-initial-outcome: DP ${dp.id} already has a terminal outcome`, dp.id);
  }
  refuseReopenedWithActivePrior(draft, dp, "create-initial-outcome");
  draft.clauses.push(payload.clause);
  if (payload.scopeRulingRef) dp.scopeRulingRef = payload.scopeRulingRef;
  setTerminal(dp, payload.clause.id);
  return draft;
});

// intent-scan §8: initial-open DP → EXISTING clause. No clause, no Transition. A reopened DP whose
// prior terminal is still active must go through replace-terminal instead, or the superseded
// DEC/ASSUM would silently stay active.
defineTransaction("adopt-existing-outcome", (store, payload, ctx) => {
  requireFields(payload, ["dpId", "clauseRef"], "adopt-existing-outcome");
  const draft = clone(store);
  pushRecords(draft, payload.records, "adopt-existing-outcome");
  const dp = findDp(draft, payload.dpId, "adopt-existing-outcome");
  if (currentTerminalRef(dp)) {
    reject("E_DP_HAS_TERMINAL", `adopt-existing-outcome: DP ${dp.id} already has a terminal outcome`, dp.id);
  }
  refuseReopenedWithActivePrior(draft, dp, "adopt-existing-outcome");
  const preIndex = indexStore(draft);
  if (!preIndex.clauses.get(payload.clauseRef)) {
    reject("E_UNKNOWN_CLAUSE", `adopt-existing-outcome: clause ${payload.clauseRef} does not exist`, payload.clauseRef);
  }
  if (payload.scopeRulingRef) dp.scopeRulingRef = payload.scopeRulingRef;
  const app = applicable(indexStore(draft), payload.clauseRef, dp, ctx.now);
  if (!app.ok) reject("E_NOT_APPLICABLE", `adopt-existing-outcome: ${payload.clauseRef} is not applicable to DP ${dp.id} (${app.reason})`, dp.id);
  setTerminal(dp, payload.clauseRef);
  applyCarrierUpdates(store, draft, payload, "adopt-existing-outcome", ctx.now);
  return draft;
});

// intent-scan §8: terminal replacement. successor may be new or existing; successor=null is retire.
// casMode is explicit — the writer never guesses which CAS shape applies.
defineTransaction("replace-terminal", (store, payload, ctx) => {
  requireFields(payload, ["dpId", "casMode", "transition"], "replace-terminal");
  const draft = clone(store);
  for (const s of payload.sources || []) pushSource(draft, s);
  pushRecords(draft, payload.records, "replace-terminal");
  if (payload.successorClause) draft.clauses.push(payload.successorClause);
  const dp = findDp(draft, payload.dpId, "replace-terminal");
  const subject = payload.transition.subject;
  const preIndex = indexStore(draft);

  if (payload.casMode === "current-terminal") {
    requireFields(payload, ["expectedCurrentTerminalRef"], "replace-terminal(current-terminal)");
    const actual = currentTerminalRef(dp);
    if (actual !== payload.expectedCurrentTerminalRef) {
      reject("E_CAS_TERMINAL", `replace-terminal: DP ${dp.id} currentTerminalRef is ${actual}, expected ${payload.expectedCurrentTerminalRef}`, dp.id);
    }
    if (subject !== payload.expectedCurrentTerminalRef) {
      reject("E_SUBJECT_MISMATCH", `replace-terminal: transition subject ${subject} must be the expected current terminal`, dp.id);
    }
  } else if (payload.casMode === "reopened-prior") {
    requireFields(payload, ["expectedPriorTerminalRef"], "replace-terminal(reopened-prior)");
    if (dp.status !== "open") reject("E_CAS_TERMINAL", `replace-terminal(reopened-prior): DP ${dp.id} is not open`, dp.id);
    if (currentTerminalRef(dp) !== null) {
      reject("E_CAS_TERMINAL", `replace-terminal(reopened-prior): DP ${dp.id} still has a current terminal`, dp.id);
    }
    if (dp.priorTerminalRef !== payload.expectedPriorTerminalRef) {
      reject("E_CAS_PRIOR_TERMINAL", `replace-terminal(reopened-prior): DP ${dp.id} priorTerminalRef is ${dp.priorTerminalRef}, expected ${payload.expectedPriorTerminalRef}`, dp.id);
    }
    if (!REOPEN_TRIGGERS.includes(dp.reopenedBy)) {
      reject("E_REOPEN_TRIGGER", `replace-terminal(reopened-prior): DP ${dp.id} reopenedBy is not a closed trigger`, dp.id);
    }
    if (statusOf(preIndex, payload.expectedPriorTerminalRef) !== "active") {
      reject("E_PRIOR_NOT_ACTIVE", `replace-terminal(reopened-prior): prior terminal ${payload.expectedPriorTerminalRef} is no longer active — use adopt-existing-outcome`, dp.id);
    }
    if (subject !== payload.expectedPriorTerminalRef) {
      reject("E_SUBJECT_MISMATCH", `replace-terminal: transition subject ${subject} must be the expected prior terminal`, dp.id);
    }
  } else {
    reject("E_ENUM", `replace-terminal: casMode must be "current-terminal" or "reopened-prior"`, payload.casMode);
  }

  draft.transitions.push(payload.transition);
  const successorId = payload.transition.successor || null;
  applyDependentClosure(draft, subject, successorId, {
    now: ctx.now,
    trigger: payload.reopenTrigger || "terminal-invalidated-no-successor",
  });
  // A reopened-prior DP is not "currently pointing at" the subject, so the generic closure above
  // does not touch it; land it explicitly.
  if (payload.casMode === "reopened-prior") {
    if (successorId) {
      const app = applicable(indexStore(draft), successorId, dp, ctx.now);
      if (!app.ok) reject("E_NOT_APPLICABLE", `replace-terminal: successor ${successorId} is not applicable to DP ${dp.id} (${app.reason})`, dp.id);
      dp.priorTerminalRef = subject;
      setTerminal(dp, successorId);
    } else {
      reopenDpInPlace(dp, subject, payload.reopenTrigger || "terminal-invalidated-no-successor");
    }
  }
  applyCarrierUpdates(store, draft, payload, "replace-terminal", ctx.now);
  return draft;
});

// intent-scan §8 row-3 variant: plan-gate witness + compatibility block + initiatingDpIds. An
// initiating DP the successor cannot cover rejects the WHOLE transaction — never supersede first
// and reopen after.
defineTransaction("supersede-requirement", (store, payload, ctx) => {
  requireFields(payload, ["transition", "initiatingDpIds"], "supersede-requirement");
  if (!Array.isArray(payload.initiatingDpIds)) {
    reject("E_PAYLOAD_MISSING", "supersede-requirement: initiatingDpIds must be an array", payload.initiatingDpIds);
  }
  const draft = clone(store);
  for (const s of payload.sources || []) pushSource(draft, s);
  pushRecords(draft, payload.records, "supersede-requirement");
  if (payload.successorClause) draft.clauses.push(payload.successorClause);
  const t = payload.transition;
  if (t.action !== "supersede") reject("E_SHAPE", "supersede-requirement: transition.action must be supersede", t.id);
  if (clauseKindOf(t.subject) !== "REQ") reject("E_SHAPE", "supersede-requirement: subject must be a REQ", t.subject);
  draft.transitions.push(t);
  applyDependentClosure(draft, t.subject, t.successor || null, {
    now: ctx.now,
    trigger: payload.reopenTrigger || "terminal-invalidated-no-successor",
    strictDpIds: payload.initiatingDpIds,
  });
  applyCarrierUpdates(store, draft, payload, "supersede-requirement", ctx.now);
  return draft;
});

// intent-scan §8: exception-grant Source + REQ + scope ruling record + DP resolve, atomically.
defineTransaction("resolve-exception", (store, payload, ctx) => {
  requireFields(payload, ["dpId", "source", "requirement", "scopeRuling"], "resolve-exception");
  const draft = clone(store);
  const src = pushSource(draft, payload.source);
  if (src.contentKind !== "exception-grant") {
    reject("E_SHAPE", "resolve-exception: source.contentKind must be exception-grant", src.sourceId);
  }
  draft.records.push(payload.scopeRuling);
  draft.clauses.push(payload.requirement);
  const dp = findDp(draft, payload.dpId, "resolve-exception");
  if (currentTerminalRef(dp)) reject("E_DP_HAS_TERMINAL", `resolve-exception: DP ${dp.id} already has a terminal outcome`, dp.id);
  refuseReopenedWithActivePrior(draft, dp, "resolve-exception");
  dp.scopeRulingRef = { kind: "review-ruling", ref: payload.scopeRuling.recordId };
  const app = applicable(indexStore(draft), payload.requirement.id, dp, ctx.now);
  if (!app.ok) reject("E_NOT_APPLICABLE", `resolve-exception: ${payload.requirement.id} is not applicable to DP ${dp.id} (${app.reason})`, dp.id);
  setTerminal(dp, payload.requirement.id);
  return draft;
});

// intent-scan §8: atomic layer + classificationBasis (human-readable, upstream semantics unchanged)
// + classificationRulingRef.
defineTransaction("reclassify-dp", (store, payload) => {
  // classificationRulingRef is REQUIRED: a reclassification is a governance ruling's postcondition
  // (IS annotation table), so reclassifying with no witness would let anything become layer=intent.
  requireFields(payload, ["dpId", "layer", "classificationBasis", "classificationRulingRef"], "reclassify-dp");
  if (!DP_LAYERS.includes(payload.layer)) reject("E_ENUM", `reclassify-dp: unknown layer ${payload.layer}`, payload.layer);
  const draft = clone(store);
  pushRecords(draft, payload.records, "reclassify-dp");
  const dp = findDp(draft, payload.dpId, "reclassify-dp");
  dp.layer = payload.layer;
  dp.classificationBasis = payload.classificationBasis;
  dp.classificationRulingRef = payload.classificationRulingRef;
  return draft; // validateGovernanceRulings() enforces by / subjectRef / postconditions
});

// intent-scan §8: only when there is no successor to hand and the open state must genuinely
// persist (possibly across runs). With a successor in hand, go straight to replace-terminal —
// reopening first would be two transactions and a visible intermediate state.
defineTransaction("reopen-dp", (store, payload, ctx) => {
  requireFields(payload, ["dpId", "trigger", "expectedCurrentTerminalRef"], "reopen-dp");
  if (!REOPEN_TRIGGERS.includes(payload.trigger)) {
    reject("E_REOPEN_TRIGGER", `reopen-dp: ${payload.trigger} is not in the closed reopen-trigger list`, payload.trigger);
  }
  const draft = clone(store);
  const dp = findDp(draft, payload.dpId, "reopen-dp");
  const actual = currentTerminalRef(dp);
  if (actual !== payload.expectedCurrentTerminalRef) {
    reject("E_CAS_TERMINAL", `reopen-dp: DP ${dp.id} currentTerminalRef is ${actual}, expected ${payload.expectedCurrentTerminalRef}`, dp.id);
  }
  if (!actual) reject("E_DP_NO_TERMINAL", `reopen-dp: DP ${dp.id} has no terminal to reopen`, dp.id);
  reopenDpInPlace(dp, actual, payload.trigger);
  applyCarrierUpdates(store, draft, payload, "reopen-dp", ctx.now);
  return draft;
});

// intent-scan §8: 0..N ResolutionGroupDraft. A clean batch is resolutions=[] — it must not invent
// a Transition. Siblings on one subject share one Transition; two groups demanding different
// successors or actions for one subject reject the whole batch.
defineTransaction("commit-test-provenance-batch", (store, payload, ctx) => {
  requireFields(payload, ["taskId", "batchSnapshot", "inventoryDigest", "batchRecordId"], "commit-test-provenance-batch");
  const resolutions = payload.resolutions || [];
  if (!Array.isArray(resolutions)) reject("E_PAYLOAD_MISSING", "commit-test-provenance-batch: resolutions must be an array", resolutions);
  const draft = clone(store);
  const ts = draft.taskStates.find((t) => t.taskId === payload.taskId);
  if (!ts) reject("E_UNKNOWN_TASK", `commit-test-provenance-batch: unknown task ${payload.taskId}`, payload.taskId);
  if (payload.baseProvenance !== undefined
      && canonicalJson(payload.baseProvenance) !== canonicalJson(ts.baseProvenance)) {
    reject("E_BASE_MISMATCH", "commit-test-provenance-batch: the batch's baseProvenance must equal the tracked TaskState witness", payload.taskId);
  }

  // 2) mint the records this transaction creates, so every ref below can resolve.
  const created = pushRecords(draft, payload.recordsToCreate, "commit-test-provenance-batch");
  // Resolution must match KIND as well as id — a typed ref naming a real record of a different
  // kind is not resolvable (External-record contract, shared §2).
  const byId = new Map([...store.records, ...created].map((r) => [r.recordId, r]));
  const resolvableRecord = (ref) => {
    const rec = byId.get(ref.ref);
    return !!rec && rec.kind === ref.kind;
  };

  const relatedRefs = [];
  for (const r of created) relatedRefs.push({ kind: r.kind, ref: r.recordId });

  const bySubject = new Map();
  const persistedGroups = [];
  for (const group of resolutions) {
    requireFields(group, ["subjectRef", "semanticEvidenceRefs", "governanceWitnessRef", "transitionDraft"], "ResolutionGroupDraft");
    const evidence = sortTypedRefs(group.semanticEvidenceRefs);
    if (evidence.length === 0) reject("E_PAYLOAD_MISSING", "ResolutionGroupDraft needs at least one semanticEvidenceRef", group.subjectRef);
    for (const ref of [...evidence, group.governanceWitnessRef]) {
      if (!resolvableRecord(ref)) {
        reject("E_REF_UNRESOLVABLE", `commit-test-provenance-batch: ${ref.kind}/${ref.ref} is neither in pre-state nor in recordsToCreate`, ref.ref);
      }
      relatedRefs.push({ kind: ref.kind, ref: ref.ref });
    }
    const draftT = group.transitionDraft;
    requireFields(draftT, ["id", "subject", "action"], "transitionDraft");
    if (draftT.subject !== group.subjectRef) {
      reject("E_SUBJECT_MISMATCH", `ResolutionGroupDraft: transitionDraft.subject ${draftT.subject} does not match subjectRef ${group.subjectRef}`, group.subjectRef);
    }
    const shape = canonicalJson({ action: draftT.action, successor: draftT.successor === undefined ? null : draftT.successor });
    if (bySubject.has(group.subjectRef)) {
      if (bySubject.get(group.subjectRef).shape !== shape) {
        reject(
          "E_SUBJECT_CONFLICT",
          `commit-test-provenance-batch: subject ${group.subjectRef} is asked for two different action/successor combinations — the whole batch is rejected`,
          group.subjectRef,
        );
      }
      // Siblings share the ONE transition already minted for this subject.
      const existing = bySubject.get(group.subjectRef);
      existing.evidence.push(...evidence);
      existing.witnesses.push(group.governanceWitnessRef);
      continue;
    }
    bySubject.set(group.subjectRef, {
      shape, transition: draftT, evidence: [...evidence], witnesses: [group.governanceWitnessRef],
    });
  }

  for (const [subjectRef, group] of bySubject) {
    const evidence = sortTypedRefs(group.evidence);
    const expected = resolutionGroupDigest({
      subjectRef,
      action: group.transition.action,
      successor: group.transition.successor === undefined ? null : group.transition.successor,
      semanticEvidenceRefs: evidence,
    });
    for (const witnessRef of group.witnesses) {
      const rec = draft.records.find((r) => r.recordId === witnessRef.ref);
      if (!rec) reject("E_REF_UNRESOLVABLE", `governance witness ${witnessRef.ref} does not resolve`, witnessRef.ref);
      if (rec.resolutionGroupDigest !== expected) {
        reject(
          "E_WITNESS_COVERAGE",
          `governance witness ${witnessRef.ref} does not cover this resolution group — resolutionGroupDigest mismatch (a missing sibling evidence ref, or a different action/successor, changes the digest)`,
          witnessRef.ref,
        );
      }
    }
    draft.transitions.push(group.transition);
    relatedRefs.push({ kind: "transition", ref: group.transition.id });
    applyDependentClosure(draft, subjectRef, group.transition.successor || null, {
      now: ctx.now,
      trigger: payload.reopenTrigger || "terminal-invalidated-no-successor",
    });
    persistedGroups.push({
      subjectRef,
      semanticEvidenceRefs: evidence,
      governanceWitnessRef: group.witnesses[0],
      transitionRef: group.transition.id,
    });
  }

  // 3-4) canonical digest, then the batch record and its chain link to the PRE-STATE head. The
  // committed snapshot carries the inline base witness (SM §9) taken from the tracked TaskState —
  // a batch that does not record which base it was computed against cannot be re-checked later.
  const snapshot = canonicalizeBatchSnapshot({
    ...payload.batchSnapshot,
    baseProvenance: ts.baseProvenance,
    resolutions: persistedGroups,
  });
  const previousBatchRef = ts.committedProvenanceBatchRef || null;
  if (payload.previousBatchRef !== undefined
      && canonicalJson(payload.previousBatchRef || null) !== canonicalJson(previousBatchRef)) {
    reject("E_CHAIN_LINK", "commit-test-provenance-batch: previousBatchRef must equal the pre-state committed head", payload.batchRecordId);
  }
  const batchRecord = {
    recordId: payload.batchRecordId,
    kind: "provenance-batch",
    taskId: payload.taskId,
    inventoryDigest: payload.inventoryDigest,
    batchSnapshot: snapshot,
    batchDigest: digestOf(snapshot),
    relatedRefs: sortTypedRefs(relatedRefs),
    previousBatchRef,
  };
  if (payload.relatedRefs !== undefined
      && canonicalJson(sortTypedRefs(payload.relatedRefs)) !== canonicalJson(batchRecord.relatedRefs)) {
    reject(
      "E_RELATED_REFS",
      "commit-test-provenance-batch: relatedRefs must equal the derived set (recordsToCreate ∪ resolution refs ∪ this transaction's Transition refs)",
      payload.batchRecordId,
    );
  }
  draft.records.push(batchRecord);
  // 5) atomically advance the head.
  ts.committedProvenanceBatchRef = { kind: "provenance-batch", ref: batchRecord.recordId };
  applyCarrierUpdates(store, draft, payload, "commit-test-provenance-batch", ctx.now);
  return draft;
});

// --- CAS, temp write, atomic replace ---------------------------------------------------------------

export function applyTransaction(store, command, payload, options = {}) {
  const apply = TRANSACTIONS[command];
  if (!apply) reject("E_UNKNOWN_COMMAND", `unknown command "${command}"`, command);
  const ctx = { now: options.now === undefined ? Date.now() : options.now };
  const preIndex = indexStore(store);
  const next = apply(store, payload || {}, ctx);

  // IS §4: freshness is a PRE-mutation check applied at every CONSUMPTION, not once at creation.
  // Checking only newly-minted records meant a ruling could be persisted, the DP could then move,
  // and the stale ruling could still be spent later — exactly what freshness exists to stop.
  const nextRecords = new Map(next.records.map((r) => [r.recordId, r]));
  const existing = new Set(store.records.map((r) => r.recordId));
  const toCheck = new Set([
    ...newlyConsumedRulingRefs(store, next),
    ...carrierConsumedRulingRefs(payload || {}),
  ]);
  for (const rec of next.records) {
    if (!existing.has(rec.recordId) && rec.kind === "review-ruling" && rec.rulingKind !== undefined) {
      toCheck.add(rec.recordId); // newly minted: vet it even before anything cites it
    }
  }
  for (const recordId of toCheck) {
    const rec = nextRecords.get(recordId);
    if (!rec || rec.kind !== "review-ruling" || rec.rulingKind === undefined) continue;
    assertTypedRulingComplete(rec);
    assertRulingPacketFresh(preIndex, rec);
  }

  validateAll(next, { now: ctx.now });
  return next;
}

// The full protocol: load+validate pre-state → CAS → apply in memory → validate FINAL snapshot →
// temp write in the same directory → atomic replace. On any failure the canonical bytes are
// untouched and no usable temp file survives.
// A digest re-check immediately before renameSync still leaves a window: another writer can land
// between the check and the swap and be silently clobbered. An exclusive lock closes that window
// for every writer that goes through this script — which, by the single-writer contract, is all of
// them. Honest boundary (same non-adversarial posture as the rest of the model): a process that
// bypasses this script is not defended against, and a stale lock is reported rather than broken,
// because auto-breaking would reintroduce exactly the race the lock exists to remove.
export function withStoreLock(file, fn) {
  const lock = `${file}.lock`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // A per-acquisition token: on release we only unlink a lock we still own. Without it, writer A's
  // cleanup can delete the lock writer B just created, letting C in alongside B — the very race the
  // lock exists to remove, reappearing at release time.
  const token = `${process.pid}:${crypto.randomBytes(8).toString("hex")}`;
  let fd;
  try {
    fd = fs.openSync(lock, "wx");
    fs.writeSync(fd, `${token}\n`);
    fs.closeSync(fd);
    fd = undefined;
  } catch (e) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* nothing to salvage */ } }
    if (e && e.code === "EEXIST") {
      reject(
        "E_STORE_LOCKED",
        `another writer holds ${lock}; the provenance store has a single writer by contract — remove the lock only after confirming no writer is live`,
        lock,
      );
    }
    reject("E_IO", `could not acquire the store lock (${e && e.code}): ${e && e.message}`, lock);
  }
  try {
    return fn();
  } finally {
    try {
      if (fs.existsSync(lock) && fs.readFileSync(lock, "utf8").trim() === token) fs.rmSync(lock, { force: true });
    } catch { /* best effort: never mask the original error */ }
  }
}

export function runTransaction(cwd, command, payload, options = {}) {
  return withStoreLock(storePath(cwd), () => runTransactionLocked(cwd, command, payload, options));
}

function runTransactionLocked(cwd, command, payload, options = {}) {
  const loaded = loadStore(cwd);
  if (options.expectedStoreDigest !== undefined && options.expectedStoreDigest !== loaded.digest) {
    reject("E_CAS_MISMATCH", `store digest is ${loaded.digest}, expected ${options.expectedStoreDigest}`, loaded.digest);
  }
  validateAll(loaded.store, { now: options.now });
  if (command === "validate") {
    return { command, changed: false, storeDigest: loaded.digest, path: loaded.file };
  }

  const next = applyTransaction(loaded.store, command, payload, options);
  const bytes = canonicalStoreBytes(next);

  const dir = path.dirname(loaded.file);
  fs.mkdirSync(dir, { recursive: true });
  const temporary = path.join(dir, `.provenance.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  try {
    // Re-read immediately before the swap: a concurrent writer between our load and here must not
    // be clobbered (CAS is only meaningful if it is checked at the last possible moment). The lock
    // above should make this unreachable for cooperating writers; it stays as defence in depth.
    fs.writeFileSync(temporary, bytes, "utf8");
    const nowOnDisk = fs.existsSync(loaded.file) ? sha256Hex(fs.readFileSync(loaded.file, "utf8")) : storeDigest(emptyStore());
    if (nowOnDisk !== loaded.digest) {
      reject("E_CAS_MISMATCH", "the provenance store changed underneath this transaction", nowOnDisk);
    }
    fs.renameSync(temporary, loaded.file);
  } catch (e) {
    // A bare fs failure here (EPERM/EBUSY on a concurrently-opened target, ENOENT on a vanished
    // directory) must surface as a typed, diagnosable rejection — never as E_UNEXPECTED, which
    // tells a caller nothing and hides real contention behaviour.
    if (e instanceof ProvenanceError) throw e;
    reject("E_IO", `could not commit the store (${e && e.code}): ${e && e.message}`, loaded.file);
  } finally {
    if (fs.existsSync(temporary)) {
      try { fs.rmSync(temporary, { force: true }); } catch { /* best effort: never mask the original error */ }
    }
  }
  return { command, changed: true, storeDigest: sha256Hex(bytes), path: loaded.file };
}

// --- CLI ---------------------------------------------------------------------------------------

export function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0];
  const options = {};
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const value = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true";
    options[key] = value;
  }
  return { command, options };
}

export function main(argv) {
  const { command, options } = parseArgs(argv);
  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(`Usage: provenance-store.mjs <command> [--payload <json>] [--payload-file <path>] [--cwd <dir>] [--expect-digest <sha256>]\n\nCommands: ${Object.keys(TRANSACTIONS).join(", ")}\n`);
    process.exit(command ? 0 : 2);
  }
  const cwd = options.cwd || process.cwd();
  let payload = {};
  try {
    if (options["payload-file"]) payload = JSON.parse(fs.readFileSync(options["payload-file"], "utf8"));
    else if (options.payload) payload = JSON.parse(options.payload);
  } catch (e) {
    process.stderr.write(`${canonicalJson({ ok: false, code: "E_PAYLOAD_JSON", message: e.message })}\n`);
    process.exit(2);
  }
  try {
    const result = runTransaction(cwd, command, payload, {
      expectedStoreDigest: options["expect-digest"],
    });
    process.stdout.write(`${canonicalJson({ ok: true, ...result })}\n`);
    process.exit(0);
  } catch (e) {
    const code = e instanceof ProvenanceError ? e.code : "E_UNEXPECTED";
    process.stderr.write(`${canonicalJson({ ok: false, code, message: e.message, detail: e.detail ?? null })}\n`);
    process.exit(1);
  }
}

// isInvokedDirectly() kept in sync with the other CLI entry points (documented copy — see garden hash guard)
function isInvokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isInvokedDirectly()) main(process.argv);
