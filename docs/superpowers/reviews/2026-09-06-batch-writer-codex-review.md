# V2 batch writer: independent implementation review

Decision: **ACCEPT the submitted writer slice**, 2026-09-06. Codex makes this stage decision under the user's existing delegation to plan, discuss and independently review Claude Code's implementation. This is not a new direct user or panel approval. Claude Code used claude-opus-5 with xhigh effort.

The scope is commit-test-provenance-batch's complete v2 writer contract and its actual file/object/text/CLI boundaries, plus scoped test-fixture migration. Effective specifications remain shared v1.15, intent-scan v1.10 and test-provenance v1.17. The accepted producer and reader remain prerequisites; their prior review records identify the full remediation ancestry. The tested candidate is the working tree above HEAD 7f1b3467a0a67e625f72cfd86bbaf1fe431944f8, with exact hashes below.

## Discussion and corrections

The design dialogue is recorded separately in 2026-09-05-batch-writer-design-dialogue.md. Codex adopted Claude's named raw-text entry point, two-sided projection, legitimate prior-transaction references and actual-ack identity/coverage correction. Claude withdrew the claimed absence of semantic-evidence and plan-gate carriers after inspecting the specifications and executable controls.

During implementation, Codex's independent probes exposed missing required null-side tags, insufficient prior-record evidence carrier checks, incomplete result.testRef shape checks and lost CLI error causes. A subsequent review dialogue resolved those items before the final corrections. The first independent CLI repair did not count as prior discussion; the record explicitly acknowledges the missed inbox cadence and the separate read-only checkpoint. The final representation decisions cover own undefined fields, optional DP qualifier type/presence and the ASSUM-only evidence claim without restricting generic resolution groups.

## Accepted behavior and independent evidence

- The file writer carries the digest from the actual single locked load in a private context. Canonical, pretty and BOM/CRLF controls pass; a parsed-object digest cannot substitute for captured text. Caller options cannot replace that context. A real intervening writer separates stale caller CAS (E_CAS_MISMATCH) from fresh caller CAS with stale inventory (E_INVENTORY_BINDING). Refusals preserve bytes/head/other-writer state and remove lock/temp files.
- The named text API derives its object from one raw input, and both CLI forms preserve nested duplicate and recursive entry-key-order evidence. The canonical reader's typed errors survive the CLI boundary. Valid populated inputs and legal inventory-root reordering pass. The object API refuses unsorted entry keys; actual producer output succeeds through explicit caller canonical serialization, with no change to the accepted producer contract.
- Required proposal fields are compared rather than invented, the complete snapshot is validated, record.inventoryDigest is derived and every new batch has version 2. The optional old top-level base check is supplemental and cannot replace the required batch witness. Legacy records retain historical readability without a live legacy-write mode.
- Results completely and uniquely cover entries, with exact identity, required side tags/body observations, typed optional projections, findings and closed resolution variants. Every this-round evidence claim checks its fixed test-discipline review-ruling/ASSUM carrier and its task/test/body/finding/binding/subject equalities. Missing, substituted or borrowed claim fields refuse. Legitimate prior-transaction refs still pass; the current group's evidence membership is required only when that transaction mints the transition.
- A transition's actual acknowledgement covers its group and names the same witness as the group, for review-ruling and plan-gate alike. Real new ASSUM and REQ successors, transitions, DP updates and committed heads land atomically. A generic DEC group remains valid while a purported ASSUM evidence claim against it is refused.
- Historical consumer test fixtures were compared with actual accepted pre-writer first/second batch output; they preserve that read lane and do not claim a new v2 workflow. Fixed inventory fixtures do not regenerate expected entries from arbitrary result overrides.

Independent probe receipt: .ctide/collaboration/writer-candidate-probes.json and its named JSONL files. Each negative was checked for the intended diagnostic family, not merely a nonzero exit. Probe coverage is scoped to the writer and the explicitly identified producer-to-writer checks:

| Probe | Cases | Exit |
|---|---:|---:|
| file-cas | 13 | 0 |
| raw-cli | 9 | 0 |
| raw-library | 9 | 0 |
| intervening-writer | 3 | 0 |
| resolution | 70 | 0 |
| producer-writer | 5 | 0 |

## Full verification

Completed 2026-09-06T00:02:04.088Z. Actual node test summary:

- ℹ tests 1595
- ℹ pass 1584
- ℹ fail 0
- ℹ cancelled 0
- ℹ skipped 11
- ℹ todo 0
- ℹ duration_ms 206004.7091

All three commands exited 0: node --test, node .github/scripts/validate-structure.mjs (both stages) and node eval/run-eval.mjs. Full receipt: .ctide/collaboration/writer-candidate-verification.json, with tests/validate/eval .txt logs. The clean checkout excluded unrelated artifacts. Probe/full-run manifests match; candidate hashes were checked before/after verification and against the original files before this decision. This review file was created afterward and is not claimed to be part of the tested manifest.

## Remaining scope

Persistence of a well-formed nonconverged finding is not a convergence verdict. Full outcome/post-binding correspondence, mode-specific historical base-store and successor-chain proof, one authoritative S3 used for both freshness and source checks, and scratch-independent committed-head consumption belong to Step 6. The legacy product consumer remains a separate lane until reviewed integration.

Step 6, artifact emission, Vigil, ledger, arbiter, final independent derivation and fixed-point coverage remain unaccepted. Product populated-inventory gate stays closed. Phase 2 is not READY. This review does not claim product-wide AC118/128/136/137/138 completion or Windows/Linux execution.

## Exact tested candidate

| File | SHA-256 |
|---|---|
| cressetide/skills/vigil/scripts/canonical-json.mjs | 0d99f6af645715a095c211d5494680e38a4804db50283d54d3cdb16494ba7d6e |
| cressetide/skills/vigil/scripts/changed-test-inventory-producer.mjs | 334f44e2d4dae7ff04d6ee22c40a68e6e1f800cd8f51784e00c784c88236dcf1 |
| cressetide/skills/vigil/scripts/changed-test-inventory.mjs | 1103003576866f506c03b4b50953903705bb80eb950c2ff9103d9979c8278885 |
| cressetide/skills/vigil/scripts/governance-producer-core.mjs | c4d2eb8ff4fb3009b1ba006ab5e11448c3e7376e2d030ea98c5e24a0b0129608 |
| cressetide/skills/vigil/scripts/governance-seed-preimage.mjs | 49ebfba53c4a9b280c5ce119e4be7a65939caf08c71f375711731bc6ecf396c6 |
| cressetide/skills/vigil/scripts/producer-request.mjs | 8469bac16bdbc8890add0d1e4304f1ee78ba9e706deb14726f452c120ecacd4d |
| cressetide/skills/vigil/scripts/provenance-store.mjs | 45c86d902a50bb67b2b784937ee89332f59c92bdec4c98ab8c54f338ba13e5fe |
| docs/superpowers/reviews/2026-09-05-batch-reader-codex-review.md | f615b7c739d328f86ade9c2dadffb848a16b8d96cfe1d314e7928d7aaf8e5258 |
| docs/superpowers/reviews/2026-09-05-batch-writer-design-dialogue.md | e15b20b8bd225461e5f0c78ca4be44f7813a513f0a7afb32f55eb455647ba035 |
| docs/superpowers/reviews/2026-09-05-batch-writer-review-dialogue.md | 2867e8f7b5dde2322d9b67318e72e837bb97e5d1fbb7dce1957bfd8e7237f6b7 |
| docs/superpowers/reviews/2026-09-05-producer-implementation-codex-review.md | 0cabc1dded50752b7b0f6d919b26bd12355ef8f74e1120206c281044f644ab66 |
| docs/superpowers/reviews/2026-09-05-test-provenance-v1.17-codex-review.md | 73019789b8f2cdae70e89fa9848f53608d656764a8af38ff46d99867df11a005 |
| docs/superpowers/specs/2026-07-25-intent-scan-spec.md | 3a788efe0a07052905faeb2587ff6853e64f54d0804d542c33a41ced07bf1035 |
| docs/superpowers/specs/2026-07-25-shared-decision-provenance-model.md | f4a98299a2a2de7f96944da0ff1fa48e33bf31e3beb6b1442eb9a9517f6538a9 |
| docs/superpowers/specs/2026-07-25-test-provenance-spec.md | 7da5ded5b25846b1496c1a693aad624e16aa24c54a840db2abd279fb9ca73819 |
| test/adapter-discovery-preimage.test.mjs | 5cc8859248de11f6c259f964a7235a72580994b7801dd7873ce85991c7e1453d |
| test/changed-test-inventory-producer-binding.test.mjs | d9bcd419533fcdc492c9631012bea795b6fab0c2531c70eb3572850918bb5a8e |
| test/changed-test-inventory-producer-matrix.test.mjs | b92d2d5806e14920614b3df51ec5ad0d9d4038d0278a0be0dcce42984c21eda4 |
| test/changed-test-inventory-producer.test.mjs | 416fd58984b1775ff8b233073d2e304c68c423dd5585660bb262ed6e64c69c54 |
| test/governance-seed-preimage.test.mjs | 6fe797be62ef872c4c3a3e9e8c58f3e55121902b0ead6b512edddea34c63dd1a |
| test/provenance-base-consumer.test.mjs | e4fee6a926133be224331879c75de02c78a2feee65f3e5a4c8fc3aeb4f5bdb15 |
| test/provenance-batch-reader.test.mjs | c6c552ade8954f54d3cbf0a494e667fb02aa08c9e13a9e35af14571351a3dbbb |
| test/provenance-batch-writer.test.mjs | f5e214fe99615ae98709da057599e4c3d8cdc9c489c8f4925c56aaa7328f391c |
| test/provenance-historical-validator.test.mjs | d86ee42b5aa1d0c803935660e498f7d86bf6bea08a6bb777af31451bd31fbfb0 |
| test/provenance-store.test.mjs | 3c2e0dc95fa8e8b209f64273bbedb2b22e0f018bac30c7aef22409d6c9c6ed43 |
| test/s3-source-freshness.test.mjs | dd7dd326c1586e0a3fe1388be0193bb35e167532ec63e9a3c2fd1f31b9f6cb5d |
| test/test-adapter-registry.test.mjs | 964b1e245d669d48fd3c6572a15f13e87fd2001ba477a68672630e898e420be0 |
