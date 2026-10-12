# Producer implementation independent review

Date: 2026-09-05. Reviewer: Codex. Implementer: Claude Code, claude-opus-5 with xhigh effort.

## Decision and scope

ACCEPT the submitted producer/governance implementation under the effective coupled set shared v1.15 + intent-scan v1.10 + test-provenance v1.17. Codex makes this stage decision under the user's explicit delegation of planning and independent review authority. This is not a new direct user approval or an agent-duel panel decision.

Acceptance belongs to the COMPLETE implementation/remediation ancestry and reviewed working-tree amendment, not one commit: seed chain 8da3729 / 11b2ce1 / c76a1ff / e049284, initial producer 020e7ec / 53801a9, intervening approved-spec and node-test-v2 rollout chain, provisional remediation 69cff79, then the 2026-09-05 phase3/phase3b/phase3c working-tree corrections at HEAD 7f1b346. The complete amended specification was accepted and promoted separately; see 2026-09-05-test-provenance-v1.17-codex-review.md. Earlier NOT ACCEPT judgments remain accurate historical judgments of their respective candidates.

This closes the producer prerequisite and advances the six prerequisite count from 5/6 to 6/6. It does NOT accept the remaining batch reader/writer, Step 5/6 consumption, artifact emission, ledger or arbiter integration. The populated-inventory PRODUCT gate stays closed; Phase 2 is not READY. AC118/128/136/137/138 are not accepted by this producer review. The next authorized slice is the versioned persisted-batch READER and legacy boundary, independently reviewed before the writer.

## Reviewed behavior and evidence

- The seed has exactly the two-field public request and no task selection. The producer requires exactly the three-field request, resolves the current TaskState and checks its raw base-tree witness before decoding or using historical B. Both facades reject injected second arguments/context. The shared core exports only finished operations and error classes; its context/continuation remains private.
- A single captured G1 and sampled T0 govern derivation and binding checks; G2 full validation at the same T0 occurs after the last binding use and before return. Current CAS uses the captured file text's canonicalText digest; historical base witness uses raw Git blob bytes. Raw-B pretty/BOM/CRLF controls distinguish both normalized-text and parsed-object substitutes.
- All pre/post bindings, including unchanged pairs before omission, receive the required obligations. Direct Sources are checked per member, lifecycle exemptions match only their individual permitted witnesses, and REQ@DP keeps the complete existing scope/applicability checks. Error codes/details retain the authoritative earliest store or seed refusal; binding failures carry their actual testRef/side/binding/obligation.
- Historical validation dispatches the stored version's own grammar and preserves all non-temporal rules. Unknown historical time remains distinct from an unexpired grant in both positive and negated applicability conditions. It does not attest that a grant was unexpired at an unknown past instant.
- Check B searches the specified byte-preserving BOM/newline transform without changing raw H or repository/store bytes. All five isolated newline controls now check seed AND actual producer entries. Raw read/contentDigest/headViewDigest evidence, real IO failure, empty excerpt, unrelated binary and lossy replacement discriminators are present.
- AC176's executable, structural and nonconstructible cases are distinguished in test/changed-test-inventory-producer-binding.test.mjs and the classification matrix. Structural ob-5 evidence is not falsely presented as a distinct behavioral output discriminator. AC173(i)/(j) uses a genuinely populated returned envelope: canonical v2 parsing accepts it while the product parser still refuses it.

The initial six findings and additional R-07/R-08/R-09 are closed for this candidate. Codex independently reproduced the original defects and rechecked their repairs, including three wrong-implementation probes: G2 moved before binding, lossy UTF-8 search, and unknown historical time collapsed to unexpired. In each repaired discriminator, the correct implementation passes and the wrong implementation fails at the intended assertion rather than an import, syntax or mutation-anchor failure. R-07's first false-green fixture was corrected by retaining valid scope coverage and testing the SAME store before/after expiry and historically.

## Actual verification

A clean detached verification checkout was created at HEAD 7f1b346. Baseline: 1499 tests, 1488 passed, 11 skipped, 0 failures, exit 0; deterministic eval 7/7. Only the 14 reviewed source/test/spec/review files listed below were synchronized; unrelated artifacts were excluded. Their bytes were checked against the manifest before and after verification and against the original submitted files before this decision.

Final candidate: node --test exited 0 with 1534 tests, 1523 passed, 11 skipped, 0 failed, 0 cancelled, 0 todo, duration 193717.78 ms. Direct structure validation exited 0 with both plugin and Cressetide extension stages passing. Deterministic eval exited 0 with 7/7 cases passing. git diff --check passed. Phase3c's affected suites also independently completed with 27/27 binding and 6/6 historical tests.

Machine receipts and probe logs are retained locally under .ctide/collaboration: producer-candidate-verification.json, producer-candidate-tests.txt, producer-candidate-validate.txt, producer-candidate-eval.txt, phase3b-ordering-evidence-*.txt, phase3b-byte-search-evidence-*.txt, phase3c-historical-sign-evidence-*.txt and the named independent probe scripts. The receipt includes actual process exits and the synchronized file hashes. Verification ran on Windows; no new Linux execution is claimed.

## Accepted submitted file hashes

These hashes identify the candidate actually tested, before subsequent status-only updates or downstream implementation. This review file itself was written after the tests and is not falsely included in the tested manifest.

| Path | SHA-256 |
|---|---|
| cressetide/skills/vigil/scripts/changed-test-inventory-producer.mjs | 334f44e2d4dae7ff04d6ee22c40a68e6e1f800cd8f51784e00c784c88236dcf1 |
| cressetide/skills/vigil/scripts/governance-producer-core.mjs | c4d2eb8ff4fb3009b1ba006ab5e11448c3e7376e2d030ea98c5e24a0b0129608 |
| cressetide/skills/vigil/scripts/governance-seed-preimage.mjs | 49ebfba53c4a9b280c5ce119e4be7a65939caf08c71f375711731bc6ecf396c6 |
| cressetide/skills/vigil/scripts/producer-request.mjs | 8469bac16bdbc8890add0d1e4304f1ee78ba9e706deb14726f452c120ecacd4d |
| cressetide/skills/vigil/scripts/provenance-store.mjs | 892c93243e2e254241db7d2cbd06a48aed7b0a08e05b7897278ccbbdff287434 |
| docs/superpowers/reviews/2026-09-05-test-provenance-v1.17-codex-review.md | 73019789b8f2cdae70e89fa9848f53608d656764a8af38ff46d99867df11a005 |
| docs/superpowers/specs/2026-07-25-intent-scan-spec.md | 3a788efe0a07052905faeb2587ff6853e64f54d0804d542c33a41ced07bf1035 |
| docs/superpowers/specs/2026-07-25-shared-decision-provenance-model.md | f4a98299a2a2de7f96944da0ff1fa48e33bf31e3beb6b1442eb9a9517f6538a9 |
| docs/superpowers/specs/2026-07-25-test-provenance-spec.md | f8d298993e170b19dc1efc0aa28a67df65a5f0bf15b553df9676e85c708f3964 |
| test/changed-test-inventory-producer-binding.test.mjs | d9bcd419533fcdc492c9631012bea795b6fab0c2531c70eb3572850918bb5a8e |
| test/changed-test-inventory-producer-matrix.test.mjs | b92d2d5806e14920614b3df51ec5ad0d9d4038d0278a0be0dcce42984c21eda4 |
| test/changed-test-inventory-producer.test.mjs | 416fd58984b1775ff8b233073d2e304c68c423dd5585660bb262ed6e64c69c54 |
| test/governance-seed-preimage.test.mjs | 6fe797be62ef872c4c3a3e9e8c58f3e55121902b0ead6b512edddea34c63dd1a |
| test/provenance-historical-validator.test.mjs | d86ee42b5aa1d0c803935660e498f7d86bf6bea08a6bb777af31451bd31fbfb0 |
