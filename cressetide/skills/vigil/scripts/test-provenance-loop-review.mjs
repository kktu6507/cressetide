// TP v1.21 §D5: ingesting the reviewer's returned batch and the governance input, computing the three
// identities of §D6, deciding `commitReady` against the writer's own gating set, and constructing the
// deterministic writer payload.
//
// PROOF LIMIT, stated because nothing here can establish it: file validation cannot attest that a
// reviewer ran. This module proves that the persisted bytes passed raw and canonical validation and
// that every stated claim matched the emitted content. That is all a success here means.
import fs from "node:fs";

import { canonicalJson, sha256Hex } from "./canonical-json.mjs";
import { assertUniqueJsonMembers } from "./json-unique-members.mjs";
import {
  scanJsonSpans, sliceJsonValue, parseCanonicalInventoryV2, computeInventoryV2Digest,
} from "./changed-test-inventory.mjs";
import {
  GENERAL_FINDING_KINDS, assumBindingFault, evidenceCoverageFault, normalizeFindingIdentity,
  observedBodies, resolutionRefShapeFault, sortFindingIdentities,
} from "./batch-review-validation.mjs";
// The per-result binding rules as the writer and the Step 6 consumer already charge them. Reused as
// pure predicates so this boundary cannot drift from theirs; each reports a fault KIND and this module
// phrases its own diagnosis, exactly as `batch-result-binding.mjs` intends.
import {
  refTypeFault, tagFault, sideObservationFault, projectionFault, bindingShapeFault, statesValue,
} from "./batch-result-binding.mjs";
import { recordPayloadComplete, carrierUpdateShapeFault } from "./provenance-store.mjs";
import {
  fail, rawSha256, findingIdentityFault, typedRefFault, pendingDeclarationFault,
} from "./test-provenance-loop-state.mjs";

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isText = (v) => typeof v === "string" && v !== "";

// A closed key set, in both directions. §D5.3's review root and §D5.4's governance shapes are
// declared exhaustively, so an undeclared member is refused rather than ignored: `buildPayload`
// reconstructs its output from named fields, which means anything not charged here would be silently
// dropped and never reach the writer that would have rejected it.
function keySetFault(what, value, required, optional = []) {
  if (!isPlainObject(value)) return `${what} must be a JSON object`;
  const missing = required.filter((k) => !Object.prototype.hasOwnProperty.call(value, k));
  if (missing.length > 0) return `${what} is missing ${missing.join(", ")}`;
  const declared = new Set([...required, ...optional]);
  const undeclared = Object.keys(value).filter((k) => !declared.has(k)).sort();
  if (undeclared.length > 0) return `${what} carries undeclared member(s) ${undeclared.join(", ")}`;
  return null;
}

function readRequired(file, what) {
  let bytes;
  try {
    bytes = fs.readFileSync(file);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw fail("E_LOOP_REVIEW_INVALID", `${what} is not present at ${file}`, { path: file });
    }
    throw fail("E_LOOP_IO", `cannot read ${what} (${error && error.code})`, { path: file });
  }
  return { bytes, text: bytes.toString("utf8"), rawDigest: rawSha256(bytes) };
}

// --- §D5.6 steps 1-4: the ingestion order ------------------------------------------------------------

export function ingestInputs({ paths, taskId, taskState, emission }) {
  const review = readRequired(paths.review, "the review file");
  const governanceExists = fs.existsSync(paths.governance);
  const governance = governanceExists
    ? readRequired(paths.governance, "the governance file")
    : { bytes: Buffer.alloc(0), text: null, rawDigest: sha256Hex("") };

  // 1. raw duplicate-member checks on BOTH documents, through the existing shared scanner. Reused
  //    as-is: no extraction, no policy change, and its own typed cause propagates unchanged.
  assertUniqueJsonMembers(review.text, "the review file");
  if (governance.text !== null) assertUniqueJsonMembers(governance.text, "the governance file");

  // 2. the raw inventory subtree, validated by the canonical v2 reader, which charges the parser's
  //    actual ENTRY and NESTED member ordering. The ROOT member order is free and no all-root-keys
  //    -sorted restriction is imposed here or anywhere.
  const spans = scanJsonSpans(review.text);
  if (spans === null) {
    throw fail("E_LOOP_REVIEW_INVALID", "the review file is not JSON", { path: paths.review });
  }
  const slice = sliceJsonValue(review.text, spans, ["inventorySnapshot"]);
  if (slice === null) {
    throw fail("E_LOOP_REVIEW_INVALID", "the review file states no inventorySnapshot", { path: paths.review });
  }
  const inventorySnapshot = parseCanonicalInventoryV2(slice);

  // 3. parse both enclosing documents.
  let batch;
  try {
    batch = JSON.parse(review.text);
  } catch (error) {
    throw fail("E_LOOP_REVIEW_INVALID", `the review file is not valid JSON: ${error.message}`, { path: paths.review });
  }
  let governanceDoc = null;
  if (governance.text !== null) {
    try {
      governanceDoc = JSON.parse(governance.text);
    } catch (error) {
      throw fail("E_LOOP_REVIEW_INVALID", `the governance file is not valid JSON: ${error.message}`, { path: paths.governance });
    }
    // The SAME complete validation begin and openEpoch run, plus the one part they cannot: here an
    // Emission exists, so §D5.4's declared `inventoryDigest` is bound to the inventory actually under
    // review. That binding is a CLAIM, and a mismatch is E_LOOP_CLAIM_MISMATCH, not a shape fault.
    assertGovernanceShape(governanceDoc, taskId, { inventoryDigest: inventorySnapshot.inventoryDigest });
  }

  // 4a. §D5.3's review root, EXACTLY the five declared fields. "No wrapper, no proposalVersion, no
  //     batch-level resolutions" is a shape rule, and it has to be charged here: `buildPayload`
  //     rebuilds `batchSnapshot` from named fields, so an undeclared root member would be silently
  //     dropped on the way to the writer and could never be refused by it.
  const rootFault = keySetFault("the review", batch,
    ["taskId", "baseProvenance", "inventorySnapshot", "inventoryDigest", "results"]);
  if (rootFault !== null) throw fail("E_LOOP_REVIEW_INVALID", rootFault, { path: paths.review });

  // 4. the original claims, compared and never rewritten.
  const claim = (condition, message) => {
    if (!condition) throw fail("E_LOOP_CLAIM_MISMATCH", message, { taskId });
  };
  claim(batch.taskId === taskId, `the review states task ${JSON.stringify(batch.taskId)}, not ${JSON.stringify(taskId)}`);
  claim(canonicalJson(batch.baseProvenance) === canonicalJson(taskState.baseProvenance),
    "the review's baseProvenance does not equal the tracked TaskState witness");
  claim(batch.baseProvenance.treeOid === inventorySnapshot.baseTreeOid,
    "the review's baseProvenance.treeOid does not equal inventorySnapshot.baseTreeOid");
  claim(batch.inventoryDigest === inventorySnapshot.inventoryDigest,
    "the review's inventoryDigest does not equal its own inventorySnapshot");
  claim(inventorySnapshot.inventoryDigest === computeInventoryV2Digest(inventorySnapshot),
    "the inventorySnapshot's digest does not equal its recomputation");
  claim(inventorySnapshot.inventoryDigest === emission.returned.inventoryDigest,
    "the reviewed inventory is not the one this emission produced");
  if (!Array.isArray(batch.results)) {
    throw fail("E_LOOP_REVIEW_INVALID", "the review states no results array", { path: paths.review });
  }
  assertResultCoverage(batch.results, inventorySnapshot);

  return {
    batch,
    governance: governanceDoc,
    inventorySnapshot,
    reviewRawDigest: review.rawDigest,
    governanceRawDigest: governance.rawDigest,
  };
}

// §D5.1's first-read schema, charged IDENTICALLY on every later read — begin, submit and openEpoch.
// The complete declared shape: the raw duplicate scan (the caller's, before parsing), the exact root
// and nested key sets, each drafted record's ACTUAL shape through the store's own
// `recordPayloadComplete`, each group's required fields and unique subjectRef, and each carrier
// update's per-action closed key set through the writer's own factored descriptor.
//
// ONLY the current-emission binding is optional, and that is what makes the read non-circular: at
// begin and at openEpoch no Emission need exist, so `inventoryDigest` is compared to nothing. At
// submit the caller supplies it and the binding is charged. An id-grammar check alone is never
// sufficient (§D5.1:477).
const HEX64 = /^[0-9a-f]{64}$/;
const GOVERNANCE_KEYS = ["governanceVersion", "taskId", "inventoryDigest", "pendingDeclarations",
  "packages", "recordsToCreate", "resolutions", "resolutionCarrierUpdates"];
const PACKAGE_KEYS = ["recordId", "branch", "findingKeys", "transitionDraft", "successorClauseDraft",
  "witnessDraft", "semanticEvidenceRefs"];

export function assertGovernanceShape(doc, taskId, { inventoryDigest = null } = {}) {
  const bad = (message) => { throw fail("E_LOOP_REVIEW_INVALID", message, { taskId }); };
  const check = (fault) => { if (fault !== null) bad(fault); };

  check(keySetFault("the governance file", doc, GOVERNANCE_KEYS));
  if (doc.governanceVersion !== 1) bad("unknown governanceVersion");
  if (doc.taskId !== taskId) bad(`the governance file states task ${JSON.stringify(doc.taskId)}`);
  if (typeof doc.inventoryDigest !== "string" || !HEX64.test(doc.inventoryDigest)) {
    bad("governance.inventoryDigest must be a hex64 digest");
  }
  if (inventoryDigest !== null && doc.inventoryDigest !== inventoryDigest) {
    throw fail("E_LOOP_CLAIM_MISMATCH",
      `the governance file states inventoryDigest ${doc.inventoryDigest}, which is not the reviewed emission's `
      + `${inventoryDigest}`, { taskId });
  }
  for (const field of ["pendingDeclarations", "packages", "recordsToCreate", "resolutions", "resolutionCarrierUpdates"]) {
    if (!Array.isArray(doc[field])) bad(`governance.${field} must be an array`);
  }

  for (let i = 0; i < doc.pendingDeclarations.length; i += 1) {
    check(pendingDeclarationFault(`governance.pendingDeclarations[${i}]`, doc.pendingDeclarations[i]));
  }

  const draftIds = new Set();
  for (const p of doc.packages) {
    check(keySetFault("a GovernancePackage", p, PACKAGE_KEYS));
    if (!isText(p.recordId)) bad("a GovernancePackage needs a recordId");
    if (draftIds.has(p.recordId)) bad(`duplicate GovernancePackage recordId ${p.recordId}`);
    draftIds.add(p.recordId);
    if (p.branch !== "transition-governance" && p.branch !== "semantic-reconsideration") {
      bad(`GovernancePackage ${p.recordId} has an unknown branch`);
    }
    if (!Array.isArray(p.findingKeys)) bad(`GovernancePackage ${p.recordId} needs findingKeys[]`);
    for (let i = 0; i < p.findingKeys.length; i += 1) {
      check(findingIdentityFault(`GovernancePackage ${p.recordId} findingKeys[${i}]`, p.findingKeys[i]));
    }
    // §D5.5: a package exists ONLY for a draft witness, and BOTH branches carry an actual one. There
    // is no nullable witnessDraft and therefore no unowned null variant. Its shape is a store record,
    // so the store's own completeness rule is what charges it.
    if (!isPlainObject(p.witnessDraft)) {
      bad(`GovernancePackage ${p.recordId} needs a witnessDraft; packages exist only for a draft witness`);
    }
    const witness = recordPayloadComplete(p.witnessDraft);
    if (!witness.ok) bad(`GovernancePackage ${p.recordId} witnessDraft is not a complete record: ${witness.reason}`);
    if (!Array.isArray(p.semanticEvidenceRefs)) bad(`GovernancePackage ${p.recordId} needs semanticEvidenceRefs[]`);
    for (let i = 0; i < p.semanticEvidenceRefs.length; i += 1) {
      check(typedRefFault(`GovernancePackage ${p.recordId} semanticEvidenceRefs[${i}]`, p.semanticEvidenceRefs[i]));
    }
    if (p.branch === "semantic-reconsideration") {
      if (p.transitionDraft !== null || p.successorClauseDraft !== null || p.semanticEvidenceRefs.length !== 0) {
        bad(`GovernancePackage ${p.recordId}: a semantic-reconsideration package drafts no transition, successor or evidence`);
      }
    } else {
      if (!isPlainObject(p.transitionDraft)) bad(`GovernancePackage ${p.recordId} needs a complete transitionDraft`);
      check(transitionDraftFault(`GovernancePackage ${p.recordId} transitionDraft`, p.transitionDraft));
      if (p.findingKeys.length === 0) bad(`GovernancePackage ${p.recordId} needs a non-empty findingKeys[]`);
      if (p.semanticEvidenceRefs.length === 0) bad(`GovernancePackage ${p.recordId} needs a non-empty semanticEvidenceRefs[]`);
    }
  }

  const subjects = new Set();
  for (const g of doc.resolutions) {
    check(keySetFault("a ResolutionGroupDraft", g,
      ["subjectRef", "semanticEvidenceRefs", "governanceWitnessRef", "transitionDraft"], ["successorClauseDraft"]));
    if (!isText(g.subjectRef)) bad("a ResolutionGroupDraft needs a subjectRef");
    if (subjects.has(g.subjectRef)) bad(`ResolutionGroupDraft subjectRef ${g.subjectRef} appears more than once`);
    subjects.add(g.subjectRef);
    if (!Array.isArray(g.semanticEvidenceRefs) || g.semanticEvidenceRefs.length === 0) {
      bad(`ResolutionGroupDraft ${g.subjectRef} needs a non-empty semanticEvidenceRefs[]`);
    }
    for (let i = 0; i < g.semanticEvidenceRefs.length; i += 1) {
      check(typedRefFault(`ResolutionGroupDraft ${g.subjectRef} semanticEvidenceRefs[${i}]`, g.semanticEvidenceRefs[i]));
    }
    check(typedRefFault(`ResolutionGroupDraft ${g.subjectRef} governanceWitnessRef`, g.governanceWitnessRef));
    check(transitionDraftFault(`ResolutionGroupDraft ${g.subjectRef} transitionDraft`, g.transitionDraft));
    if (g.transitionDraft.subject !== g.subjectRef) {
      bad(`ResolutionGroupDraft ${g.subjectRef} needs a transitionDraft whose subject is the group's subjectRef`);
    }
  }

  // Each drafted record's ACTUAL id and shape, through the store's own predicate rather than a
  // second and looser copy of it.
  for (const r of doc.recordsToCreate) {
    if (!isPlainObject(r) || !isText(r.recordId)) bad("every governance.recordsToCreate entry needs a recordId");
    const complete = recordPayloadComplete(r);
    if (!complete.ok) bad(`governance.recordsToCreate: ${complete.reason}`);
  }

  // The per-action closed key set, from the writer's own factored descriptor. Per-DP coverage stays
  // the writer's: it is derived from what a transaction actually mutates, and there is no transaction
  // here to derive it from.
  for (const u of doc.resolutionCarrierUpdates) {
    const fault = carrierUpdateShapeFault(u);
    if (fault === null) continue;
    if (fault.kind === "not-object") bad("every resolutionCarrierUpdates entry must be an object");
    if (fault.kind === "dp-id") bad("every resolutionCarrierUpdates entry needs a dpId");
    if (fault.kind === "unknown-action") bad(`carrier action ${JSON.stringify(fault.action)} is not a declared action`);
    bad(`DP ${u.dpId}: a "${u.action}" carrier update's key set is not the canonical closed set`
      + `${fault.missing.length ? ` (missing: ${fault.missing.join(", ")})` : ""}`
      + `${fault.extra.length ? ` (undeclared: ${fault.extra.join(", ")})` : ""}`);
  }
  return [...draftIds].sort();
}

// The governance file's COMPLETE read — raw duplicate scan, parse, then the full §D5.1 schema — as
// ONE function, because it is read at three boundaries: `beginTaskLoop`, `submitReviewedProposal` and
// `openEpoch`. Two of them used to parse it with a bare JSON.parse, so a duplicate member was refused
// at submit and silently accepted at begin and at unlock, and the last member of a duplicated pair
// won. §D5.1:477 requires the same full structural, raw and schema validation at every read.
export function parseGovernanceDocument(text, taskId, file, { inventoryDigest = null } = {}) {
  assertUniqueJsonMembers(text, "the governance file");
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (error) {
    throw fail("E_LOOP_REVIEW_INVALID", `the governance file is not valid JSON: ${error.message}`, { path: file });
  }
  assertGovernanceShape(doc, taskId, { inventoryDigest });
  return doc;
}

// A transitionDraft is a COMPLETE STORE DRAFT whose full shape `assertProspectiveTransitionAuthority`
// owns. Only the three members this controller itself reads are charged here; imposing a closed key
// set would create a second and competing transition schema.
const transitionDraftFault = (what, v) => {
  if (!isPlainObject(v)) return `${what} must be a JSON object`;
  if (!isText(v.id)) return `${what}.id must be a non-empty string`;
  if (!isText(v.subject)) return `${what}.subject must be a non-empty string`;
  if (!isText(v.action)) return `${what}.action must be a non-empty string`;
  return null;
};

// §D5.3's declared result and finding shapes, and §D5.8:619's coverage obligation — "one-to-one with
// entries, exact declared testRef type, and tag / observed-digest equality against the entry".
//
// The three hard parts are delegated to the predicates the writer and the Step 6 consumer already
// share, so this boundary charges the same rule rather than a second approximation of it:
// `refTypeFault` for the exact testRef type (including a key present holding `undefined`, which the
// canonical reader never saw), `tagFault` for required tags, and `sideObservationFault` for the body
// sides — which is a PRESENCE rule in both directions, not merely an equality where stated.
const RESULT_REQUIRED = ["testRef", "tagBefore", "tagAfter", "findings"];
const RESULT_OPTIONAL = ["clauseRef", "dpRef", "observedBaseBodyDigest", "observedHeadBodyDigest"];

function assertResultCoverage(results, inventorySnapshot) {
  const invalid = (message) => { throw fail("E_LOOP_REVIEW_INVALID", message); };
  const mismatch = (message) => { throw fail("E_LOOP_CLAIM_MISMATCH", message); };
  const key = (ref) => canonicalJson([ref.path, ref.adapterId, ref.structuralId]);
  const entries = new Map(inventorySnapshot.entries.map((e) => [key(e.testRef), e]));
  const seen = new Set();

  for (const result of results) {
    const shape = keySetFault("a result", result, RESULT_REQUIRED, RESULT_OPTIONAL);
    if (shape !== null) invalid(shape);
    if (!isPlainObject(result.testRef)) invalid("every result states a testRef object");
    const id = key(result.testRef);
    const entry = entries.get(id);
    if (entry === undefined) mismatch(`result ${id} names no entry in the emitted inventory`);
    if (seen.has(id)) mismatch(`entry ${id} has more than one result`);
    seen.add(id);

    const refFault = refTypeFault(result.testRef, entry.testRef);
    if (refFault !== null) {
      if (refFault.kind === "values") mismatch(`result ${id} states a testRef that is not the emitted entry's`);
      invalid(`result ${id} testRef is not the declared exact { path, adapterId, structuralId } type `
        + `(${refFault.kind}${refFault.ghosts ? `: ${refFault.ghosts.join(", ")}` : ""})`);
    }
    for (const side of ["tagBefore", "tagAfter"]) {
      const fault = tagFault(result, entry, side);
      if (fault === null) continue;
      if (fault.kind === "absent") invalid(`result ${id} states no ${side}; both tags are required on every result`);
      mismatch(`result ${id} ${side} does not equal the emitted entry's`);
    }
    // A side EXISTS on the entry or it does not. An `added` entry has no base body, so a stated
    // observation there describes a body that was never reviewed; an unstated one where the side does
    // exist cannot be compared to anything and is not "clean".
    for (const side of ["base", "head"]) {
      const fault = sideObservationFault(result, entry, side);
      if (fault === null) continue;
      if (fault.kind === "different") mismatch(`result ${id} ${fault.observed} does not equal the emitted entry's`);
      invalid(fault.kind === "missing"
        ? `result ${id} omits ${fault.observed}, which the emitted entry carries`
        : `result ${id} states ${fault.observed}, which the emitted entry does not have`);
    }
    const projection = projectionFault(result, entry);
    if (projection !== null) {
      invalid(`result ${id} clauseRef/dpRef projection does not name one actual side of the entry's binding (${projection.kind})`);
    }

    if (!Array.isArray(result.findings)) invalid(`result ${id} states no findings array`);
    for (const finding of result.findings) {
      const fault = keySetFault(`a finding of result ${id}`, finding, ["kind", "evidence"], ["binding", "resolutionRef"]);
      if (fault !== null) invalid(fault);
      if (!isText(finding.kind)) invalid(`a finding of result ${id} states no kind`);
      // §D5.3 lists `evidence` WITHOUT the `?` its neighbours carry: a finding that asserts something
      // about a test states why. It is excluded from the fingerprint as PROSE (§D6) — which is a
      // reason to leave it out of an identity, not a reason to let it be absent or empty.
      if (!isText(finding.evidence)) {
        invalid(`finding ${finding.kind} of result ${id} states no evidence; it is required and non-empty`);
      }
      if (statesValue(finding, "binding")) {
        const bindingFault = bindingShapeFault(finding.binding);
        if (bindingFault !== null) {
          invalid(`finding ${finding.kind} of result ${id} has a malformed binding (${bindingFault.kind})`);
        }
      }
    }
  }
  if (seen.size !== inventorySnapshot.entries.length) {
    mismatch(`results cover ${seen.size} of ${inventorySnapshot.entries.length} entries; coverage is one-to-one`);
  }
}

// --- §D5.8 / §D5.8b: the EXHAUSTIVE per-finding scan ---------------------------------------------------

// Every finding of every result is evaluated; the scan NEVER short-circuits. A valid unresolved
// finding sets commitReady false and the scan continues, so an early general or unresolved finding
// cannot hide a later false resolution claim. Any refusal condition refuses the whole submission,
// wherever it sits — before any id is allocated, any payload retained, any count moved.
export function evaluateFindings({ batch, taskId, preIndex, recordsToCreate, resolutions }) {
  const drafted = new Map((recordsToCreate || []).map((r) => [r.recordId, r]));
  const resolveRecord = (ref) => {
    if (!isPlainObject(ref) || typeof ref.kind !== "string" || typeof ref.ref !== "string") return null;
    const record = drafted.get(ref.ref) || preIndex.records.get(ref.ref) || null;
    if (record === null || record.kind !== ref.kind) return null;
    return record;
  };
  // The writer accepts a transitionRef that resolves in the pre-state OR is MINTED by this
  // transaction, so the pre-admission scan must consider the governance groups' own transitionDrafts.
  // The GROUP is carried alongside, not merely the id: a minted transition's verified witness
  // coverage is exactly its group's declared evidence set, and that set is what bounds what may be
  // cited against it. Their full validity stays the writer's charge at commit.
  const mintedByTransition = new Map();
  for (const group of resolutions || []) {
    if (isPlainObject(group.transitionDraft) && typeof group.transitionDraft.id === "string") {
      mintedByTransition.set(group.transitionDraft.id, group);
    }
  }
  const resolveTransition = (id) => {
    if (mintedByTransition.has(id)) {
      const group = mintedByTransition.get(id);
      return { transition: group.transitionDraft, group };
    }
    const transition = preIndex.transitions.get(id);
    return transition === undefined ? null : { transition, group: null };
  };
  const refKey = (ref) => canonicalJson({ kind: ref.kind, ref: ref.ref });

  const identities = [];
  const unresolved = [];
  const refusals = [];
  let commitReady = true;

  for (const result of batch.results) {
    const bodies = observedBodies(result);
    for (const finding of result.findings || []) {
      if (!isPlainObject(finding) || typeof finding.kind !== "string") {
        refusals.push("a finding states no kind");
        continue;
      }
      const identity = normalizeFindingIdentity(result.testRef, finding);
      identities.push(identity);

      // The writer's FIRST charge in `assertFindingResolution`: only an assum-reading-change finding
      // carries a resolutionRef. It has to run before the general-kind not-ready path, or a general
      // finding smuggling a resolution claim is admitted here and only refused later by the writer —
      // after the id, the retained payload and the count have all been spent.
      if (finding.resolutionRef !== undefined && finding.kind !== "assum-reading-change") {
        refusals.push(`only an assum-reading-change finding carries a resolutionRef; ${finding.kind} attached one`);
        continue;
      }
      if (GENERAL_FINDING_KINDS.includes(finding.kind)) {
        commitReady = false;                       // a general finding is never ready; keep scanning
        continue;
      }
      if (finding.kind !== "assum-reading-change") {
        refusals.push(`unknown finding kind ${JSON.stringify(finding.kind)}`);
        continue;
      }
      const bindingFault = assumBindingFault(finding);
      if (bindingFault !== null) { refusals.push(bindingFault); continue; }

      if (finding.resolutionRef === undefined) {
        commitReady = false;                       // legitimately unresolved; keep scanning
        unresolved.push(identity);
        continue;
      }
      const shapeFault = resolutionRefShapeFault(finding.resolutionRef);
      if (shapeFault !== null) { refusals.push(shapeFault); continue; }

      const resolved = resolveTransition(finding.resolutionRef.transitionRef);
      if (resolved === null) {
        refusals.push(`resolutionRef.transitionRef ${finding.resolutionRef.transitionRef} resolves to no transition`);
        continue;
      }
      // §D5.8:611, charged for BOTH modes because the writer charges it before its
      // historical-convergence return: a resolution names the binding it resolves, and the contract
      // compares that binding's clauseRef against the Transition's subject.
      if (resolved.transition.subject !== finding.binding.clauseRef) {
        refusals.push(`the finding resolves ${finding.binding.clauseRef} through transition `
          + `${finding.resolutionRef.transitionRef}, whose subject is ${JSON.stringify(resolved.transition.subject)}`);
        continue;
      }
      if (finding.resolutionRef.mode === "historical-convergence") continue;   // the writer returns here

      const evidence = resolveRecord(finding.resolutionRef.semanticEvidenceRef);
      if (evidence === null) {
        refusals.push(`semanticEvidenceRef ${canonicalJson(finding.resolutionRef.semanticEvidenceRef)} resolves to no record`);
        continue;
      }
      const coverageFault = evidenceCoverageFault(evidence, identity, taskId, bodies);
      if (coverageFault !== null) { refusals.push(coverageFault); continue; }

      // §D5.8:617 — group membership ONLY when this transaction mints the transition. Then the
      // group's evidence set is known and its coverage digest is what the witness acknowledges, so a
      // ref outside that set is provably uncovered. A pre-existing transition carries no such set and
      // demanding one would reject a legitimate reference.
      if (resolved.group !== null) {
        const declared = new Set((resolved.group.semanticEvidenceRefs || []).map(refKey));
        if (!declared.has(refKey(finding.resolutionRef.semanticEvidenceRef))) {
          refusals.push(`the finding claims ${finding.resolutionRef.semanticEvidenceRef.ref} against transition `
            + `${finding.resolutionRef.transitionRef}, which this transaction mints — but that resolution group's `
            + "verified witness coverage does not include it");
        }
      }
    }
  }

  return {
    commitReady,
    refusals,                                       // EVERY refusal found, not merely the first
    findingIdentities: sortFindingIdentities(identities),
    unresolvedIdentities: sortFindingIdentities(unresolved),
  };
}

// §D5.5: `pending` corresponds ONE-TO-ONE with the unresolved assum-reading-change findings, by full
// FindingIdentity. A missing or surplus entry is a claim mismatch — a not-ready admission with
// missing coverage would spend budget while leaving nothing to unlock with.
export function reconcilePending(unresolvedIdentities, governance) {
  const declared = (governance && governance.pendingDeclarations) || [];
  const declaredKeys = new Map();
  for (const entry of declared) {
    if (!isPlainObject(entry) || !isPlainObject(entry.identity) || !isPlainObject(entry.governance)) {
      throw fail("E_LOOP_REVIEW_INVALID", "every pendingDeclaration states {identity, governance}");
    }
    const identity = normalizeFindingIdentity(entry.identity.testRef || {}, entry.identity);
    const key = canonicalJson(identity);
    // ONE-TO-ONE means one declaration per finding. A Map that simply overwrote let a second
    // declaration for the same identity vanish, and the surviving one then satisfied the coverage
    // check below — so two contradictory governance decisions for one finding read as one settled
    // decision, and the one that silently won was whichever the file happened to list last.
    if (declaredKeys.has(key)) {
      throw fail("E_LOOP_CLAIM_MISMATCH",
        `two pendingDeclarations name the same finding ${key}; coverage is one-to-one and they are not merged`);
    }
    declaredKeys.set(key, entry);
  }
  const wanted = new Map(unresolvedIdentities.map((i) => [canonicalJson(i), i]));
  for (const key of declaredKeys.keys()) {
    if (!wanted.has(key)) {
      throw fail("E_LOOP_CLAIM_MISMATCH", `a pendingDeclaration names a finding the review does not contain: ${key}`);
    }
  }
  for (const key of wanted.keys()) {
    if (!declaredKeys.has(key)) {
      throw fail("E_LOOP_CLAIM_MISMATCH", `an unresolved finding has no pendingDeclaration: ${key}`);
    }
  }
  return unresolvedIdentities.map((identity) => ({
    identity,
    governance: declaredKeys.get(canonicalJson(identity)).governance,
  }));
}

// --- §D6 identity 1: the semantic fingerprint ----------------------------------------------------------

// finding.evidence PROSE is excluded, and derived persisted groups are excluded. Results are sorted by
// the testRef tuple so a caller's array order cannot move the identity.
export function computeFingerprint({ inventoryDigest, batch, pending }) {
  const results = [...batch.results]
    .sort((a, b) => {
      const ka = canonicalJson([a.testRef.path, a.testRef.adapterId, a.testRef.structuralId]);
      const kb = canonicalJson([b.testRef.path, b.testRef.adapterId, b.testRef.structuralId]);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    })
    .map((r) => ({
      testRef: { path: r.testRef.path, adapterId: r.testRef.adapterId, structuralId: r.testRef.structuralId },
      tagBefore: r.tagBefore === undefined ? null : r.tagBefore,
      tagAfter: r.tagAfter === undefined ? null : r.tagAfter,
      observedBaseBodyDigest: r.observedBaseBodyDigest === undefined ? null : r.observedBaseBodyDigest,
      observedHeadBodyDigest: r.observedHeadBodyDigest === undefined ? null : r.observedHeadBodyDigest,
      findings: (r.findings || []).map((f) => ({
        kind: f.kind,
        binding: f.binding === undefined ? null : f.binding,
        resolutionRef: f.resolutionRef === undefined ? null : {
          mode: f.resolutionRef.mode,
          transitionRef: f.resolutionRef.transitionRef,
          semanticEvidenceRef: f.resolutionRef.semanticEvidenceRef === undefined
            ? null : f.resolutionRef.semanticEvidenceRef,
        },
      })),
    }));
  const pendingProjection = pending.map((p) => ({
    identity: p.identity,
    governance: p.governance,
  }));
  return sha256Hex(canonicalJson([inventoryDigest, results, pendingProjection]));
}

// --- §D5.7 the generated writer payload ----------------------------------------------------------------

// baseProvenance and inventoryDigest live ONLY inside batchSnapshot. A top-level baseProvenance is the
// writer's optional legacy supplemental and a top-level inventoryDigest is forbidden outright, so
// neither is emitted here.
export function buildPayload({ taskId, batchRecordId, expectedInputProvenanceStoreDigest, batch, governance }) {
  const payload = {
    taskId,
    batchRecordId,
    expectedInputProvenanceStoreDigest,
    batchSnapshot: {
      taskId,
      baseProvenance: batch.baseProvenance,
      inventoryDigest: batch.inventoryDigest,
      inventorySnapshot: batch.inventorySnapshot,
      results: batch.results,
    },
  };
  if (governance) {
    if (governance.recordsToCreate.length > 0) payload.recordsToCreate = governance.recordsToCreate;
    if (governance.resolutions.length > 0) payload.resolutions = governance.resolutions;
    if (governance.resolutionCarrierUpdates.length > 0) {
      payload.resolutionCarrierUpdates = governance.resolutionCarrierUpdates;
    }
  }
  return canonicalJson(payload);
}
