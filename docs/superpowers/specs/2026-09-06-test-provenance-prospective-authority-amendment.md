# Test-Provenance prospective-authority amendment

**APPROVED — test-provenance v1.20, effective 2026-09-06. Implementation acceptance is separate.**

Codex approves this narrow prerequisite under the user's delegated planning and review authority, after real Claude Code Opus5/xhigh discussions D11–D13 and independent source checks. This is not a new direct user approval or a panel decision. The effective coupled set is shared v1.15 + intent-scan v1.10 + test-provenance v1.20: the TP v1.17 base, approved E1 v1.18 and file-preview v1.19 amendments, plus only this prospective-authority operation. Existing persisted store semantics and writer mint permissions remain unchanged.

The rest of the D controller draft remains UNAPPROVED. This operation grants no epoch budget by itself: controller-owned finding/evidence coverage, witness novelty, task/fingerprint binding and actual unlock remain separate requirements. No controller, HEAD exclusion, ledger-loop integration or caller change is released here.

## Exact operation and precondition

The existing provenance-store module exports one synchronous, pure operation:

    assertProspectiveTransitionAuthority(preIndex, candidate) -> void

It takes exactly two arguments. preIndex is the index from the caller's own fully validated current store, obtained after validateStoreSchema and validateAll. It is a precondition, not an assertion that a bare caller-created index is trusted authority. The future controller must own that store capture and validation; this helper loads and validates no current store for it.

candidate has exactly four own keys:

    { transitionDraft, successorDraft, witness, citedRecords }

witness has exactly three own keys:

    { source: "persisted" | "draft", recordId, record }

citedRecords is an array of drafted records, corresponding to governance.recordsToCreate for the future controller. The witness record is separate and must not also appear in that array. No caller clock, callback, verdict, file path or semantic-evidence list is an extra argument or candidate member. Arity, object/array/type, complete own-key and candidate-relationship misuse produces the module's typed E_API_ARGUMENTS. Permitted nonenumerable own properties remain permitted; hidden or Symbol extras are refused safely. Capture the candidate's and witness's owned values once; this is not a hostile-Proxy guarantee or a promise to deep-clone the pre-index.

## Candidate relationships

Before interpreting the candidate as a transition's authority:

1. On retire, transitionDraft.successor is absent or null, and successorDraft is null.
2. On revise or supersede, transitionDraft.successor is a string. Exactly one case holds: it already exists in preIndex.clauses and successorDraft is null; or it does not exist and successorDraft is a clause object whose id equals transitionDraft.successor. A surplus, missing or differently named draft is refused.
3. A persisted witness has record:null and recordId resolves in preIndex.records. A draft witness has a record object with record.recordId === recordId, and that id does not already exist in preIndex.records.
4. The resolved witness's kind and recordId equal transitionDraft.ackRef.kind and transitionDraft.ackRef.ref. An unused declared witness cannot stand in for the one the matrix actually resolves.

Each raw drafted object appears once. That global collision obligation uses the shared id claimer below and preserves E_DUPLICATE_ID / E_ID_PAYLOAD_CONFLICT, rather than relabelling a duplicate as API misuse. Relationship checks do not replace each object's source-owned structural/domain validation.

## Shared validation and staging

Factor the existing clause obligations, transition obligations, basic-record obligations, global-id claimer and single transition-matrix row into private shared predicates. The basic record predicate contains only existing kind membership and recordPayloadComplete. Typed packet validation remains at validateGovernanceRulings in persisted validation, after the matrix. All current, historical, schema-only and writer validation paths retain their original ordering, branches, codes and results.

In particular, persisted validateStructure keeps id claims interleaved with object checks at their original sites. Do not move all persisted id claims into an early pre-pass: a store with both a malformed earlier object and a later duplicate would otherwise change its first refusal. The prospective path may use that same claimer for its separately defined raw-array pass.

The prospective pipeline, after the API/relationship checks, is:

1. Claim global ids against ALL six raw pre-state sections: sources, clauses, transitions, records, decisionPoints and taskStates. Then claim every candidate drafted object: citedRecords in supplied order, the separate draft witness once, transitionDraft and optional successorDraft. Claim actual id and payload before any candidate indexing; no Map deduplication or sorting may hide identical duplicates or conflicting declarations. Existing shared typed collision codes are preserved.
2. Apply source-owned transition, optional clause and basic-record obligations to the new objects. The resolved persisted witness has already passed current-store validation. Existing clause id grammar, forbidden authored lifecycle fields, required fields and record kind-specific payload rules remain in force.
3. Construct U as a store-shaped, in-memory staging object: pre-state provenanceVersion and the six pre-state section arrays, with transitionDraft, optional successorDraft, separate draft witness and citedRecords appended to their respective sections exactly once. Do not change a pre-state object, its arrays or index maps. Its DP terminals, carriers and task heads deliberately remain unmoved. Build stagedIndex = indexStore(U) only after global collision checks pass.
4. Call the existing validateRefs(stagedIndex), validateGovernanceRulings(stagedIndex), and validateRoutingOrigins(stagedIndex), in that order. Structural refs belong to validateRefs; clause ruling postconditions and anti-borrowing belong to validateGovernanceRulings. Separately require basisRefsResolvable(stagedIndex, successorDraft.basisRefs).ok where a new clause's source contract calls for basisRefs; use the staged index so a legal reference to a draft ruling resolves. Use the source's typed unresolved-reference refusal, not an unchecked boolean.
5. Compute newlyConsumedRulingRefs(preIndex.store, U). Resolve those recordId strings in stagedIndex.records and run assertRulingPacketFresh(preIndex, record) for each actual review-ruling whose rulingKind !== undefined. These are source-owned existing predicates. Untyped records are not sent to a typed packet reader; unused historical records are not newly consumed. Packet freshness is checked against the PRE-state even when the record is drafted. A plan-gate uses its own basic user/target/successor/impact/disposition and matrix obligations; it has no invented review-ruling packet requirement.
6. Call the shared assertTransitionMatrixRow(stagedIndex, transitionDraft) exactly once. The persisted matrix loop calls that same row with its existing index, for every existing transition, in the original order. No successorKind option is needed: the row derives kinds as before and resolves the actual successor and witness from the supplied index. This makes an unminted ASSUM-to-DEC successor, including a valid rerouted principal, reachable without weakening any matrix row.

The predicate names above denote their responsibilities; private extraction names may follow local conventions. The one public operation and its two-argument contract are fixed. No parallel copy of the authority matrix is allowed.

## Scope of the result

Success means the supplied prospective transition has structurally coherent staged objects, valid ruling/routing obligations, fresh newly consumed typed rulings and the existing matrix authority. It is not a completed transaction, applicability judgment, source-freshness verdict, successful CAS, write permission expansion or Step6 result.

Never call validateAll or validateStoreSchema on U. Excluded future lifecycle checks are validateCarrierCoherence, validateReopenCauseCoherence, validateMergeReconciliation, validateInvariants and validateTaskStatesAndHeads; also excluded are successor-chain closure beyond the immediate successor, mechanicallyApplicable and clock-dependent applicability, source drift and the actual writer's narrower clause-mint permissions. These belong to completed state or other existing owners. In particular, prospective authorization of an unminted DEC does not permit the batch writer to mint it.

The helper performs no I/O, lock, clock sampling or mutation and does not call a reviewer. The controller must separately verify each advertised finding against the declared semantic evidence, task/test/binding/body identities and shared resolutionGroupDigest coverage before using this helper in an unlock workflow. Those checks are not claimed here because the helper does not receive that evidence list.

## Independent implementation acceptance

Use actual valid pre-state fixtures to cover governed, rerouted and arbiter ASSUM-to-unminted-DEC candidates; a user plan-gate to an unminted REQ without a review packet; retire with no successor; existing and drafted witnesses and successors; candidate relationship errors; malformed clause/record/transition shapes; cross-section and cross-draft global collisions; dangling and drafted basis refs; typed packet completeness, freshness, anti-borrowing and clause postconditions; routing; matrix refusals and forbidden compatibility.

Preserve persisted multi-fault error precedence, including matrix before typed-packet checks and the original interleaving of id claims and object checks. Assert unchanged input objects/index maps and actual store bytes on both success and refusal. Run full regression and the protected writer/consumer/product/ledger checks on one stable candidate before implementation acceptance. Synthetic fixture rulings prove mechanical behavior only; no actual external reviewer, controller completion, Linux execution or whole-flow READY claim follows.

See [independent specification decision](../reviews/2026-09-06-prospective-authority-spec-codex-review.md).
