# Artifact, product CLI and public parser: independent review

Decision: **ACCEPT the A–C integration slice**, under the user's delegation to Codex for planning, discussion and independent review. Real Claude Code used claude-opus-5 with xhigh in the existing authorized project-only session. This is a Codex stage decision, not a new direct user or panel approval. Effective specifications remain shared v1.15, intent-scan v1.10 and test-provenance v1.17.

## Discussion and accepted behavior

Design decisions are recorded in 2026-09-06-product-integration-design-dialogue.md. Independent A1–A4 findings and their settlements are in 2026-09-06-artifact-cli-review-dialogue.md. A1–A3 include both unchanged read-only freezes. The reproduced foreign-temp hardlink corruption and permissive new CLI were discussed before fixing. Claude withdrew the unsupported claim of simultaneous in-process staging and corrected the test that had mislabeled an early target refusal as late publication failure. For A4 it explained why a broad regex accepted the earlier inventory-tree error instead of the claimed TaskState-witness error; Codex verified and accepted the isolated storeDigest mutation and exact code/exit assertions before the related test correction.

During the released A4 correction Claude also found that JavaScript evaluated the CLI invocation before its inline contextFor argument, making the purported before-bytes snapshot a post-run read. It moved those captures before each invocation; Codex checked the resulting source ordering. The submitted 25-case suite then passed with exact codes and exit1 for negatives (actual targeted exit0, 24.7 seconds). This strengthens the shipped evidence rather than changing product semantics.

- The separate exact-request emitter runs the producer first, creates/preserves output hygiene, rejects path redirection, writes a uniquely and exclusively created sibling temp, fsyncs and rereads it through the canonical v2 authority, verifies its digest and atomically publishes it. Failed production creates no output. Prepublication failures preserve old bytes. Bounded collision retries never adopt/delete foreign entries; successful rename ends ownership of the former temp path. Claims concern pre-existing wrong-type entries and accidental collisions, not universal hostile path replacement.
- The new artifact CLI validates known/single/required/nonempty arguments inside the caught boundary before production, returns machine JSON and actual exit0/1. Missing values cannot select a real task named true. Existing regular ignore bytes and repository-root ignore bytes remain unchanged.
- Product provenance mode requires a named task, rejects the old inventory argument and calls the accepted committed consumer once. Success forwards its exact verified verdict plus status/violations; failure forwards typed causes with no invented success metadata. Scratch absence/corruption does not supply or invalidate a committed-head verdict. The default contract report retains its behavior and exit0.
- Public parseInventory/loadInventory now return fully canonical-validated v2 envelopes, empty or populated. All legacy v1 envelopes refuse with the regeneration marker; malformed v2 retains its canonical diagnosis. The old unsupported-populated export and unused historical CLI helper exports are retired with replacements announced. Historical v1 B and legacy record readability remain supported; a legacy committed head cannot supply live convergence.

## Fixed-candidate verification

Base HEAD: 7f1b3467a0a67e625f72cfd86bbaf1fe431944f8. Full verification completed 2026-09-06T03:16:39.168Z.

- ℹ tests 1653
- ℹ pass 1641
- ℹ fail 0
- ℹ cancelled 0
- ℹ skipped 12
- ℹ todo 0
- ℹ duration_ms 330725.9024

Full regression, both structure-validation stages and deterministic evaluation passed with actual exits0 in the clean verification checkout. Independent integration evidence: **96 rows**, including **46 artifact cases**, **35 product-process cases outside the artifact group**, and ten bounded AST derivations sharing only the approved syntax parser. Artifact cases also invoke its actual CLI. The AST evidence is not a second general producer or cross-platform execution.

| Probe | Rows | Product cases outside artifact group | Exit |
|---|---:|---:|---:|
| artifact | 46 | 0 | 0 |
| arguments | 13 | 13 | 0 |
| scratch | 13 | 8 | 0 |
| base | 8 | 8 | 0 |
| historical-clock | 3 | 3 | 0 |
| legacy-clock | 3 | 3 | 0 |
| ast-derivation | 10 | 0 | 0 |

Artifact evidence includes real Git empty/populated production, canonical bytes, overwrite/hardlink peer preservation, no-write derivation failures, filesystem junction/nonfile refusal, exact argument rejection, child-only actual late-fault and exclusive-creation collision paths, bounded retries, ignore races and preservation of a foreign entry created after rename. Injection is explicit, isolated and does not modify shipped source. Product evidence includes scratch independence, fresh/stale source, exact metadata/error forwarding, required task/retired flag/default report, legacy/no head, malformed/missing current store, raw v1/v2 B, wrong digest/tree/mode and historical clock controls.

Protected consumer regression: **143 rows** across seventeen plans, including the one-capture and same-instance cached-registry discriminator. Protected writer regression: **109 cases** across six plans. All child exits0 and all strict checks passed. Receipts are product-candidate-verification.json, product-candidate-integration-probes.json, product-consumer-regression-probes.json and product-writer-regression-probes.json under .ctide/collaboration. Earlier evolving-draft receipts are not substituted for these.

All receipt manifests match. Tested files were checked before/after execution and against original bytes before this decision. This review is written afterward and is excluded from its own tested manifest.

## Remaining roadmap

Executable loop state, telemetry/ledger, Vigil/reviewer/arbiter flow, any explicit narrow specification clarification and final integrated workflows remain unaccepted. **Phase 2 is not READY.** Linux execution and completed cross-platform AC43/59 evidence are not claimed. The current public v2 parser/CLI rollout is accepted only within this bounded slice.

## Exact tested candidate

| File | SHA-256 |
|---|---|
| cressetide/skills/vigil/references/verification-gate.md | 1c778e38e19a33917fb9c784ed8c699801c5e2cc2c94435437ac9b452f49deb7 |
| cressetide/skills/vigil/scripts/adapter-content-view.mjs | 7c71a04c18d0fb510cea8027e846dc2abc0da20372bab1854403e28e30325fd9 |
| cressetide/skills/vigil/scripts/adapter-discovery-preimage.mjs | e9ad86823eedfdacae4b8b8ff238ba44c4fe437c458b85e7fdb6e2bac1e04003 |
| cressetide/skills/vigil/scripts/base-head-declaration-matcher.mjs | 0d2c9af7334c7e816773cdf6c2a05a7fdb3410a5505c042d7eb75e499a6856df |
| cressetide/skills/vigil/scripts/batch-result-binding.mjs | 49f15edfa62fbeacc1e391ac958c284dca5578167c9b13a4ca3b6e8b58a43b29 |
| cressetide/skills/vigil/scripts/canonical-json.mjs | 0d99f6af645715a095c211d5494680e38a4804db50283d54d3cdb16494ba7d6e |
| cressetide/skills/vigil/scripts/changed-test-inventory-artifact.mjs | e34a00ee5777b8f25381a557e822720cbba2d6cd87a8bdd087a88a96387de9fb |
| cressetide/skills/vigil/scripts/changed-test-inventory-producer.mjs | bda981280c35a98e78db4ca0c3b68af79c775fdd60d27be1e513e926e352fa68 |
| cressetide/skills/vigil/scripts/changed-test-inventory.mjs | ffd2a30c0405855bf0ef8f95ab49a330b3b5092df753a086aa17cb6db6f590db |
| cressetide/skills/vigil/scripts/committed-batch-consumer.mjs | c8b7cfedd8a3c0a52064d9b2ec3e30c58ce776d79c55e2f583876c1796595771 |
| cressetide/skills/vigil/scripts/contract-check.mjs | e5841bfde003bd009d21b1cc2c2452f80ce721e6166707c9d9e07acd81253c9b |
| cressetide/skills/vigil/scripts/exact-tree-blob.mjs | d2a5cdd5ff8ac13db6558f510564b686d3e96992636cc5d2d9f04769b9ba48ff |
| cressetide/skills/vigil/scripts/governance-producer-core.mjs | 7a68d4bb648e7674835f1c96e04ba8eb3a3655b72dd1f3b144efa1661822a0b3 |
| cressetide/skills/vigil/scripts/governance-seed-preimage.mjs | d0d754b140a5921e2f2693478bffbe78f3241b22af43d5ecc21f275c2266b8d0 |
| cressetide/skills/vigil/scripts/head-view-snapshot.mjs | eab1663e86c17c71e947cb3d661d0656e90abf3752ef12b7647a39cbff44d552 |
| cressetide/skills/vigil/scripts/node-test-adapter.mjs | 0ad44456f720136783e07b925abbfa3faa4302b123e3e8fb811663ca3a73bb9d |
| cressetide/skills/vigil/scripts/producer-request.mjs | 8469bac16bdbc8890add0d1e4304f1ee78ba9e706deb14726f452c120ecacd4d |
| cressetide/skills/vigil/scripts/provenance-store.mjs | 8b61e390689e3edc2650efdd9c3f57cd84c5b0307cb82bbbfbb201e583437344 |
| cressetide/skills/vigil/scripts/s3-source-freshness.mjs | 18494f6f29543248d66d153fcf78f55676512331443d1fac1d2a028955e354ee |
| cressetide/skills/vigil/scripts/source-digest-comparison.mjs | 3e723c989fb608943918ad6c0bd51a3fe62009d30260b16c8ea8edc13bb5cc4f |
| cressetide/skills/vigil/scripts/source-occurrence.mjs | 454407e5543849987459ece255aeb2833c7805395155c2c29c208fe5460c7a0e |
| docs/runtime-contract.md | 7e72bd33af4bf88cb4c492dab45bca9a3da11edccad98ec882ff890acc392015 |
| docs/superpowers/reviews/2026-09-05-batch-reader-codex-review.md | f615b7c739d328f86ade9c2dadffb848a16b8d96cfe1d314e7928d7aaf8e5258 |
| docs/superpowers/reviews/2026-09-05-batch-writer-design-dialogue.md | e15b20b8bd225461e5f0c78ca4be44f7813a513f0a7afb32f55eb455647ba035 |
| docs/superpowers/reviews/2026-09-05-batch-writer-review-dialogue.md | 2867e8f7b5dde2322d9b67318e72e837bb97e5d1fbb7dce1957bfd8e7237f6b7 |
| docs/superpowers/reviews/2026-09-05-producer-implementation-codex-review.md | 0cabc1dded50752b7b0f6d919b26bd12355ef8f74e1120206c281044f644ab66 |
| docs/superpowers/reviews/2026-09-05-test-provenance-v1.17-codex-review.md | 73019789b8f2cdae70e89fa9848f53608d656764a8af38ff46d99867df11a005 |
| docs/superpowers/reviews/2026-09-06-artifact-cli-review-dialogue.md | 0e4e0ea521b2fd9392b960cd3b7be302792d355a2427c5b9a8f4ccfd15f41f79 |
| docs/superpowers/reviews/2026-09-06-batch-writer-codex-review.md | 6e5c2236e75d9b7c28d07082c7fda57b8b614d949206b176d7d6f849ac33bada |
| docs/superpowers/reviews/2026-09-06-committed-consumer-codex-review.md | e6f5ab8ae0783eae5515f32fdc2fe876777d30707d43761dfd49de9435634562 |
| docs/superpowers/reviews/2026-09-06-committed-consumer-design-dialogue.md | 5c367338c94d03266168226b2632852bf76c0d12060c24df98ea28a62a56a20c |
| docs/superpowers/reviews/2026-09-06-committed-consumer-review-dialogue.md | 50fec90fa769117695c8c04dfc95490b5f6c9ce3d2028ed9a967f48cead4d7fb |
| docs/superpowers/reviews/2026-09-06-product-integration-design-dialogue.md | 59940d70d8ff1e2a2dfe42598b807f85747cfaebb0116ca84c241f8275211dc7 |
| docs/superpowers/specs/2026-07-25-intent-scan-spec.md | 3a788efe0a07052905faeb2587ff6853e64f54d0804d542c33a41ced07bf1035 |
| docs/superpowers/specs/2026-07-25-shared-decision-provenance-model.md | f4a98299a2a2de7f96944da0ff1fa48e33bf31e3beb6b1442eb9a9517f6538a9 |
| docs/superpowers/specs/2026-07-25-test-provenance-spec.md | 7da5ded5b25846b1496c1a693aad624e16aa24c54a840db2abd279fb9ca73819 |
| test/adapter-discovery-preimage.test.mjs | f3109662d96017650b795190dffabf40b9fc796b3bbd4f540a104887de64553f |
| test/base-head-declaration-matcher.test.mjs | 422ed628549f907129703f8bae6c79dc281fdc147122a61a80f5dd48fb47bf14 |
| test/changed-test-inventory-artifact.test.mjs | b0ba0f68b8d7d8e70a17e3fc2086b4139f4aee39619bc88c52a1d9cb11a0358d |
| test/changed-test-inventory-producer-binding.test.mjs | 2e0a05d6dbcc3dbbf7aab8fa17c2b1e37b92d75887679ac4514a18332abc6cf3 |
| test/changed-test-inventory-producer-matrix.test.mjs | a626c64d8a90495bab0ff334b39c1abf594d2bbf8182b28875251f907960e3a7 |
| test/changed-test-inventory-producer.test.mjs | d29a7961d7e3c578dede911593458e8a4ffcb957d2e11eee1e429c40d28a684a |
| test/changed-test-inventory.test.mjs | 95a20190dd0641f70357600aaaf5566be3a320a00b96f174750f580b77a8e7e4 |
| test/committed-batch-consumer.test.mjs | d6fd1245ae5ab8c218d1357b2df37189c320c9d0d54f9037247b1553b8153d8d |
| test/governance-seed-preimage.test.mjs | 5a999cef64414c61c88fac222f1ca574ac7b72335e06ba7614c922442ea6c9de |
| test/head-view-snapshot.test.mjs | d2a5fd9cb44cbe3b83258869cf8f952e393d68eb003ef06d8112e80203c056df |
| test/node-test-adapter.test.mjs | 38390845dda0d65d99a014333016b47f66fc2e1e09d2142a9cb0856bdade72b5 |
| test/provenance-base-consumer.test.mjs | 2232d8f09b3dacf93e5df8ac6843f7ce21444ee911ff816243fa5357c173381f |
| test/provenance-batch-reader.test.mjs | 7c7f4d42e859d6487b8f858c295fe39de836455472b8a01da8b75c20d4d57741 |
| test/provenance-batch-writer.test.mjs | d6275729879817def4e0ef99394e86757247d9eeb8e9979238d253377f705885 |
| test/provenance-historical-validator.test.mjs | 521d1e67a6ccfacbaebf4ace1b1e9e5ce6417e8d463fbdf40addacde01f5bd1d |
| test/provenance-store.test.mjs | 3c2e0dc95fa8e8b209f64273bbedb2b22e0f018bac30c7aef22409d6c9c6ed43 |
| test/s3-source-freshness.test.mjs | 9daf57241439d14326a5ef71884b025c065b13a774cfd999ef476e922a79af3d |
| test/test-adapter-registry.test.mjs | 4dd664d3faf83b99fd44fe6851ce7fa8e8e3f33678732bd1b11cf804b6ac113b |
