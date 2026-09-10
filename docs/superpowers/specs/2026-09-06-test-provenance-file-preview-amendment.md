# Test-Provenance file-preview amendment

**APPROVED — test-provenance v1.19, effective 2026-09-06. Implementation acceptance is separate.**

Codex approved this narrow contract under the user's delegated planning and review authority after the recorded real Claude Code Opus5/xhigh discussions and independent source checks. This is not a new direct user approval or a panel decision. The current coupled set is shared v1.15 + intent-scan v1.10 + test-provenance v1.19: the existing TP v1.17 base plus the approved E1 v1.18 amendment and ONLY this file-preview delta. All other normative requirements remain effective. The rest of the D loop amendment remains UNAPPROVED; no controller, epoch, witness-unlock, ledger-loop gate or caller-integration change is released here.

## Exact operation

The existing provenance-store module exports one read-only operation:

    previewTestProvenanceBatch({ repoRoot, payloadText })
      -> { inputProvenanceStoreDigest, expectedBatchRecord }

The request is exactly one object with those two own keys: repoRoot is a non-empty string and payloadText is a string. Empty payload text reaches the ordinary invalid-JSON check. It takes no extra positional argument, options, command, context, digest, clock, store, index, callback or verdict. API shape/type misuse is E_API_ARGUMENTS; submitted JSON and domain faults preserve their actual typed source causes.

The helper owns the current file capture through loadStore, its actual captured text digest, current-version dispatch, schema and full store validation, raw payload validation through the existing text-writer boundary, and the existing private captured-text derivation for commit-test-provenance-batch. It parses the payload itself; no paired caller object/text authority exists. A payload's required taskId, full baseProvenance and inventoryDigest claims are validated before canonical derivation, and mismatches are refused rather than overwritten into validity. Other payload checks remain exactly the writer's existing checks.

It returns the complete canonical record the actual writer derives:

    { recordId, kind: "provenance-batch", batchRecordVersion, taskId,
      inventoryDigest, batchSnapshot, batchDigest, relatedRefs, previousBatchRef }

batchSnapshot includes the actual validated inventory and derived resolution groups. inputProvenanceStoreDigest is loadStore().digest for the helper's own captured current file. The helper takes no lock and performs no filesystem mutation. It does not commit, publish, establish a successful CAS operation, prove Step6 convergence, or attest that an external reviewer ran.

## Shared derivation and protected behavior

Factor shared work beneath runTransactionLocked using private captured-file context. Keep all existing writer entry points, signatures, options (including expectedStoreDigest and supplemental options), version lanes, raw payload boundaries, validation ordering, diagnostics and publication behavior unchanged. The real writer retains its own lock, file capture, current CAS, derivation and publication. A prior preview does not replace any actual writer validation or authorize a stale write.

The helper must not use applyTransaction on a parsed current-store object as a replacement for actual loaded-text authority. A valid pretty-printed file can have loadStore().digest different from storeDigest(parsedStore), including pretty files with BOM/CRLF. BOM or line-ending changes alone are normalized by canonicalText and do not necessarily create that difference. Root inventory member order remains legal; the existing canonical parser owns entry and nested ordering and duplicate-member rules, without a new whole-payload sort policy.

## Required independent acceptance

Verify canonical, pretty LF and pretty BOM/CRLF stores with actual emission, helper preview, actual file-text writer and fresh committed consumer. Compare the FULL expected record, not only its digest, and confirm unchanged raw store bytes and absence of preview-created locks or writes. Include legal permuted inventory root order.

Verify malformed JSON, stale expected digest, wrong task/base claims, missing preimage, inventory digest disagreement, incomplete coverage, forbidden top-level digest, duplicate inventory members and noncanonical entry/nested ordering against the actual writer's typed refusal class and precedence. Reject API injection and extra arguments. Preserve all accepted writer and consumer behavior, including historical-convergence and this-round references to prior transitions. Tests run only after stable implementation; no test or code acceptance follows from this approval.

The D draft's task-control prefix exclusion, persistent state, operation machine, counters and workflow integration are not part of this delta. No Linux or whole-flow READY claim is made.

See [independent specification decision](../reviews/2026-09-06-file-preview-spec-codex-review.md).
