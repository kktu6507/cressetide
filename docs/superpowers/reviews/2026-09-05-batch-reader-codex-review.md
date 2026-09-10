# Persisted provenance-batch reader: independent implementation review

Decision: **ACCEPT the submitted reader slice**, 2026-09-05. Codex makes this stage decision under the user's existing delegation to plan and independently review Claude Code's implementation. This is not a new direct user approval or a panel decision. Claude Code used claude-opus-5 with xhigh effort.

The accepted scope is the versioned persisted reader, the historical legacy boundary and original-text inventory ingestion. It includes the dependency-free canonical primitive extraction with existing store re-exports, plus three narrowly scoped scratch-layout dependency-list updates. The producer acceptance status additions are non-normative. Effective specifications remain shared v1.15, intent-scan v1.10 and test-provenance v1.17.

This candidate builds on the previously accepted producer implementation and its full remediation ancestry, recorded in 2026-09-05-producer-implementation-codex-review.md. It is the complete submitted working tree above HEAD 7f1b3467a0a67e625f72cfd86bbaf1fe431944f8, identified by the hashes below; no individual historical commit is credited with the whole implementation.

## Findings and independent evidence

- R-10: the complete nested inventory is checked using its original source slice and the existing canonical inventory parser. Independent populated controls pass; duplicate member names in entries, escaped tags, testRef and implementationIdentity fail; existing entry-key reordering fails E_ORDER; inventory root reordering and unrelated legacy duplicates remain readable.
- R-11: unknown/non-integer versions, missing or malformed snapshots, stale self-digests and derived-digest mismatches fail closed. Required batch inventoryDigest, taskId, results array and base-tree agreement are checked. Missing/falsy/wrong-kind predecessor refs fail, while explicit-null roots, legal links, populated historical metadata and v2-after-legacy pass. Legacy-after-v2 fails. Legacy readability supplies no inventory-preimage authority.
- R-12: one local span tree is built per original store document, outside the batch loop. Each inventory slice is independently passed to the canonical authority; no global cache survives ingestion. Diagnostic 25/50/100/200-record runs measured 1.62/1.53/2.58/5.26 ms, versus the former 7.13/22.46/75.45/285.13 ms. These measurements support source inspection and are not CI timing thresholds.
- R-13: source-order evidence changes actual existing keys while preserving the key set and values. The root-order positive is no longer a no-op; the entry-order negative no longer relies on an unrelated unknown-field rejection.

Independent receipts: .ctide/collaboration/phase4-reader-submitted.jsonl, phase4-reader-deep-final.jsonl and phase4-reader-scaling-final.jsonl. The new reader suite passes 22/22; existing affected store, inventory, registry, freshness, producer, seed and historical suites pass. The exact submitted candidate was then synchronized into the clean verification worktree; unrelated project artifacts were excluded.

## Full verification

Completed 2026-09-05T13:26:54.762Z. Actual node test summary:

- ℹ tests 1556
- ℹ pass 1545
- ℹ fail 0
- ℹ cancelled 0
- ℹ skipped 11
- ℹ todo 0
- ℹ duration_ms 196037.1845

All three commands exited 0: node --test, node .github/scripts/validate-structure.mjs (both stages), and node eval/run-eval.mjs (7/7). The receipt is .ctide/collaboration/reader-candidate-verification.json, with tests/validate/eval .txt logs beside it. Candidate hashes were verified before and after the clean run and against the original submitted files before this decision. git diff --check also passed. This review file was created after the run and is not claimed to be part of its tested manifest.

## Scope remaining

The writer is still the historical writer at this decision; enabling v2 writes is the next authorized slice. Exact result-to-entry coverage, transaction-time captured-file CAS, actual raw payload ingestion, successor/resolution atomicity and downstream Step 6 consumption remain separate obligations. batchInventoryPreimage is used only after store/record validation; a getter alone is not validation or freshness proof.

Producer prerequisites remain 6/6. The product populated-inventory gate stays closed, and Phase 2 is not READY. This decision does not claim AC118/128/136/137/138 product-wide completion, persisted-head consumption, scratch-loss recovery, ledger/arbiter integration or Windows/Linux execution.

## Exact tested candidate

| File | SHA-256 |
|---|---|
| cressetide/skills/vigil/scripts/canonical-json.mjs | 0d99f6af645715a095c211d5494680e38a4804db50283d54d3cdb16494ba7d6e |
| cressetide/skills/vigil/scripts/changed-test-inventory-producer.mjs | 334f44e2d4dae7ff04d6ee22c40a68e6e1f800cd8f51784e00c784c88236dcf1 |
| cressetide/skills/vigil/scripts/changed-test-inventory.mjs | 1103003576866f506c03b4b50953903705bb80eb950c2ff9103d9979c8278885 |
| cressetide/skills/vigil/scripts/governance-producer-core.mjs | c4d2eb8ff4fb3009b1ba006ab5e11448c3e7376e2d030ea98c5e24a0b0129608 |
| cressetide/skills/vigil/scripts/governance-seed-preimage.mjs | 49ebfba53c4a9b280c5ce119e4be7a65939caf08c71f375711731bc6ecf396c6 |
| cressetide/skills/vigil/scripts/producer-request.mjs | 8469bac16bdbc8890add0d1e4304f1ee78ba9e706deb14726f452c120ecacd4d |
| cressetide/skills/vigil/scripts/provenance-store.mjs | 7f64357084be2c161a21151deb438ea38c357fd85761e0646263ea029b55060e |
| docs/superpowers/reviews/2026-09-05-producer-implementation-codex-review.md | 0cabc1dded50752b7b0f6d919b26bd12355ef8f74e1120206c281044f644ab66 |
| docs/superpowers/reviews/2026-09-05-test-provenance-v1.17-codex-review.md | 73019789b8f2cdae70e89fa9848f53608d656764a8af38ff46d99867df11a005 |
| docs/superpowers/specs/2026-07-25-intent-scan-spec.md | 3a788efe0a07052905faeb2587ff6853e64f54d0804d542c33a41ced07bf1035 |
| docs/superpowers/specs/2026-07-25-shared-decision-provenance-model.md | f4a98299a2a2de7f96944da0ff1fa48e33bf31e3beb6b1442eb9a9517f6538a9 |
| docs/superpowers/specs/2026-07-25-test-provenance-spec.md | dd194b6a29ab7dfa8a6d4b3bc21e49fcec4cf27cc805a957c25ee75a5967fffe |
| test/adapter-discovery-preimage.test.mjs | 5cc8859248de11f6c259f964a7235a72580994b7801dd7873ce85991c7e1453d |
| test/changed-test-inventory-producer-binding.test.mjs | d9bcd419533fcdc492c9631012bea795b6fab0c2531c70eb3572850918bb5a8e |
| test/changed-test-inventory-producer-matrix.test.mjs | b92d2d5806e14920614b3df51ec5ad0d9d4038d0278a0be0dcce42984c21eda4 |
| test/changed-test-inventory-producer.test.mjs | 416fd58984b1775ff8b233073d2e304c68c423dd5585660bb262ed6e64c69c54 |
| test/governance-seed-preimage.test.mjs | 6fe797be62ef872c4c3a3e9e8c58f3e55121902b0ead6b512edddea34c63dd1a |
| test/provenance-batch-reader.test.mjs | 088886656a6fae88bdc3b8a96e5f4376c3cb71ad5740355f258798f403d0d8a7 |
| test/provenance-historical-validator.test.mjs | d86ee42b5aa1d0c803935660e498f7d86bf6bea08a6bb777af31451bd31fbfb0 |
| test/s3-source-freshness.test.mjs | dd7dd326c1586e0a3fe1388be0193bb35e167532ec63e9a3c2fd1f31b9f6cb5d |
| test/test-adapter-registry.test.mjs | 964b1e245d669d48fd3c6572a15f13e87fd2001ba477a68672630e898e420be0 |
