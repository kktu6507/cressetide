# E1 telemetry and ledger: independent implementation review

Decision: **ACCEPT the bounded E1 implementation**, under the user's delegation to Codex for planning, discussion and independent review. Real local Claude Code used claude-opus-5 with xhigh and the existing project-only Anthropic authorization. This is a stage decision by Codex, not new direct user or panel approval. Effective specifications: shared1.15, intent-scan1.10 and TP1.18 (v1.17 base plus the approved E1 amendment). **D and whole-flow readiness remain unaccepted.**

## Discussion and accepted corrections

The specification approval is in 2026-09-06-telemetry-ledger-spec-codex-review.md. Actual implementation disagreements and their reasons are in 2026-09-06-telemetry-ledger-implementation-dialogue.md. The initial eleven-file submission passed targeted tests, but root independently reproduced three defects: reading through a parent junction, extending a consumer proof after an invalid typed-head change, and reporting null instead of unknown when a requested identity's collector could not load. Claude confirmed each from source in the read-only d6 discussion.

Codex accepted the same-named-head minimum: unrelated valid appends may change current store text without invalidating counts, while invalid current authority must downgrade them. A later full validation uses its own fresh clock for its actual applicability checks; it does not repeat the consumer, check every grant, or establish continuous freshness. In d7 Claude acknowledged that its proposed successful ASSUM world could not also contain invalid/general findings, and that appending before collection could not distinguish a faulty between-read text-equality check. Positive dedup and separate negative worlds, plus an actual valid writer append between collector-owned reads, were settled before the eight-file correction release. Both read-only guards covered162 source/test/spec/runtime paths with no changes. The earlier NUL-to-JSON-tuple correction was independently discovered during implementation; its chronology is not relabelled as prior joint discussion.

The final read-only d8 discussion separated the observer's checked precommit boundary from D's still-unproved preceding emitter invocation. It also distinguished production domain transformation plus synthetic fixture persistence from the actual file-backed writer. Claude accepted both reasons before the two-file f2 release: precise documentation and runTransaction in the between-read timing control, with deliberate corruptions left explicit. The guarded correction passed21/21. Other synthetic counter fixtures are accepted as component evidence through the actual consumer, while independent producer/file-writer workflows establish the stronger integration observations.

## Accepted behavior

- The exact-request observer measures both-sided effective-oracle differences from the validated precommit artifact. It checks captured current-text authority, the full task/base witness including raw B, discovery/rich projections and entry pairing, then publishes an exact six-field sidecar with bounded containment, exclusive owned staging, reread and atomic replacement. Parent protection now precedes both sidecar and artifact reads. The observer does not itself prove the preceding emitter invocation; D still owns that sequencing. Association digests are not cryptographic authentication of the measurement; checks do not claim universal hostile-race resistance.
- The collector derives all18 existing telemetry keys from its own validated named committed head. Established absence, unavailable observations, zero measurements and the unreported literal stay distinct. Semantic counts require the actual consumer's seven matching identity fields followed by validated current typed head, base witness and derived inventory identity agreement. Invalid later authority preserves initial canonical stored facts but leaves semantic counts unknown. ASSUM counts deduplicate actual validated cited transition refs.
- Every run carries the block. Pure builders and append I/O keep synchronous signatures; the append CLI owns asynchronous collection. Human task prose and the explicit provenance-task identity remain separate. Absence is silent; malformed supplied identities diagnose and append the no-identity block. Unavailable collection with a requested identity yields unknown while retaining one fail-open append/exit0.
- The narrow ledger prefix is excluded from H before trackedness, including deliberately tracked ledger content, and B still includes all committed leaves. Neighbor paths, exact config observability and tracked-ignore authority are preserved. Standalone observer ordering and its fixed sidecar are documented.
- E1 supplies no loop history authority: reviewLoopIterations, convergenceEpochs, lastStaleSubject, adapterMisses and staleBatchRejections remain unknown; combined converged remains false pending independent D and current-consumer evidence. The ledger itself is disclosure only.

## Fixed-candidate verification

Base HEAD: 7f1b3467a0a67e625f72cfd86bbaf1fe431944f8. Completed 2026-09-06T05:09:41.361Z. All receipt manifests match; tested files were checked before/after and against original bytes before this decision.

- ℹ tests 1708
- ℹ pass 1696
- ℹ fail 0
- ℹ cancelled 0
- ℹ skipped 12
- ℹ todo 0
- ℹ duration_ms 166556.4336

Full regression, direct structure validation and deterministic evaluation passed with actual exits0 in the clean verification checkout. E1 independent checks: **41 rows** across six plans, including eight actual emitter/observer/writer/collector/ledger workflows, narrow H/B controls, absence/API/CLI states, no-read parent containment, invalid typed-head and valid-between-read append controls, and actual unavailable-module CLI behavior.

| E1 probe | Rows | Exit |
|---|---:|---:|
| ledger-prefix | 8 | 0 |
| metric-workflows | 8 | 0 |
| absence-cli | 20 | 0 |
| sidecar-read-guard | 2 | 0 |
| current-head-recheck | 2 | 0 |
| collector-unavailable | 1 | 0 |

Protected integration: 96 rows across7 plans. Protected consumer: 144 rows across17 plans, including 91 direct consumer observations and **46 additional E1 collector observations within those same workflows**; these are not disjoint extra consumer cases. Protected writer: 109 cases across6 plans. All expected counts, child exits and strict assertions passed. Labelled isolated import/read proxies perturb only disposable copies or their own child process; shipped APIs gain no test knobs.

Receipts under .ctide/collaboration: e1-candidate-verification.json, e1-candidate-e1-probes.json, e1-candidate-integration-probes.json, e1-candidate-consumer-probes.json and e1-candidate-writer-probes.json. Evolving-source diagnostics are retained separately and do not substitute for these fixed-candidate receipts.

This review is written after verification and is excluded from its own tested manifest. Linux execution and completed cross-platform AC59 evidence are not claimed. D's executable loop, reviewer/packet/arbiter flow and final integrated acceptance still remain; **Phase2 is not READY**.

## Exact tested candidate

| File | SHA-256 |
|---|---|
| cressetide/skills/vigil/references/run-ledger.md | 0291030bcc02096aee3eee97d328bfd143e6d74f8fda50bc97f05411f9dd29df |
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
| cressetide/skills/vigil/scripts/head-view-snapshot.mjs | e08598ad510d46449f768dafb46965bc4cbe5b90a4f76af0f65a4f9834c2312e |
| cressetide/skills/vigil/scripts/inventory-telemetry-observer.mjs | 8eca9e81ec0b96805d9e393837a1dfbfaa26ee96cc8f350d483e72c898e2d6bb |
| cressetide/skills/vigil/scripts/node-test-adapter.mjs | 0ad44456f720136783e07b925abbfa3faa4302b123e3e8fb811663ca3a73bb9d |
| cressetide/skills/vigil/scripts/producer-request.mjs | 8469bac16bdbc8890add0d1e4304f1ee78ba9e706deb14726f452c120ecacd4d |
| cressetide/skills/vigil/scripts/provenance-store.mjs | 8b61e390689e3edc2650efdd9c3f57cd84c5b0307cb82bbbfbb201e583437344 |
| cressetide/skills/vigil/scripts/run-ledger.mjs | a41b1b63916eff67f6c0019416297e613244ef2ceda9fab79fd430ee5bd02d48 |
| cressetide/skills/vigil/scripts/s3-source-freshness.mjs | 18494f6f29543248d66d153fcf78f55676512331443d1fac1d2a028955e354ee |
| cressetide/skills/vigil/scripts/source-digest-comparison.mjs | 3e723c989fb608943918ad6c0bd51a3fe62009d30260b16c8ea8edc13bb5cc4f |
| cressetide/skills/vigil/scripts/source-occurrence.mjs | 454407e5543849987459ece255aeb2833c7805395155c2c29c208fe5460c7a0e |
| cressetide/skills/vigil/scripts/test-provenance-block.mjs | 6ab8c83b86533ae6bf9502d415c7195e0d916704be93db2d5455c5f75f97d6e2 |
| docs/runtime-contract.md | 442ceffde43fc8c649d15d6bfec96a6b19cb7cb4890581ae62113371e2cb04e9 |
| docs/superpowers/reviews/2026-09-05-batch-reader-codex-review.md | f615b7c739d328f86ade9c2dadffb848a16b8d96cfe1d314e7928d7aaf8e5258 |
| docs/superpowers/reviews/2026-09-05-batch-writer-design-dialogue.md | e15b20b8bd225461e5f0c78ca4be44f7813a513f0a7afb32f55eb455647ba035 |
| docs/superpowers/reviews/2026-09-05-batch-writer-review-dialogue.md | 2867e8f7b5dde2322d9b67318e72e837bb97e5d1fbb7dce1957bfd8e7237f6b7 |
| docs/superpowers/reviews/2026-09-05-producer-implementation-codex-review.md | 0cabc1dded50752b7b0f6d919b26bd12355ef8f74e1120206c281044f644ab66 |
| docs/superpowers/reviews/2026-09-05-test-provenance-v1.17-codex-review.md | 73019789b8f2cdae70e89fa9848f53608d656764a8af38ff46d99867df11a005 |
| docs/superpowers/reviews/2026-09-06-artifact-cli-codex-review.md | cc47a45b30900d359707879152689d268a8c54b039c5ae9f5b2a31a1ee8cb410 |
| docs/superpowers/reviews/2026-09-06-artifact-cli-review-dialogue.md | 0e4e0ea521b2fd9392b960cd3b7be302792d355a2427c5b9a8f4ccfd15f41f79 |
| docs/superpowers/reviews/2026-09-06-batch-writer-codex-review.md | 6e5c2236e75d9b7c28d07082c7fda57b8b614d949206b176d7d6f849ac33bada |
| docs/superpowers/reviews/2026-09-06-committed-consumer-codex-review.md | e6f5ab8ae0783eae5515f32fdc2fe876777d30707d43761dfd49de9435634562 |
| docs/superpowers/reviews/2026-09-06-committed-consumer-design-dialogue.md | 5c367338c94d03266168226b2632852bf76c0d12060c24df98ea28a62a56a20c |
| docs/superpowers/reviews/2026-09-06-committed-consumer-review-dialogue.md | 50fec90fa769117695c8c04dfc95490b5f6c9ce3d2028ed9a967f48cead4d7fb |
| docs/superpowers/reviews/2026-09-06-loop-ledger-design-dialogue.md | 1812aea738a135b2195e98048b298415f05cfbe55711214de18e953831ff3c9f |
| docs/superpowers/reviews/2026-09-06-product-integration-design-dialogue.md | 59940d70d8ff1e2a2dfe42598b807f85747cfaebb0116ca84c241f8275211dc7 |
| docs/superpowers/reviews/2026-09-06-telemetry-ledger-implementation-dialogue.md | 8dbd99320c22d34e154587a0a20cb416d9a3c8cb47ecb45cbc5354d563dbfdb0 |
| docs/superpowers/reviews/2026-09-06-telemetry-ledger-spec-codex-review.md | 345bb9360ea27ed979abd07f860c2347a84ce934706ee0e2e9121daa630af65b |
| docs/superpowers/specs/2026-07-25-intent-scan-spec.md | 5c0297d57e28f9cb0169cad010759f37bfa1284d18e952169a70b2e1ad22028d |
| docs/superpowers/specs/2026-07-25-shared-decision-provenance-model.md | cb0bc637b9ccf9db49ce95d6df29be112687bc0c527ecd09daf39c90104fc7af |
| docs/superpowers/specs/2026-07-25-test-provenance-spec.md | 62c1a9685c5c74037b3809eaf71e85a8b736b5980e0dc18a0b2ec09fd63e7b48 |
| docs/superpowers/specs/2026-09-06-test-provenance-telemetry-ledger-amendment.md | e47ec701cdb3b80740eb7bc3ca9a7ccbae6fd64ac82942095230fd1234561113 |
| test/adapter-content-view.test.mjs | dd67b39cc066c93be20fe5efdd0e860567d436e224f6f645412535c8366a124a |
| test/adapter-discovery-preimage.test.mjs | f3109662d96017650b795190dffabf40b9fc796b3bbd4f540a104887de64553f |
| test/base-head-declaration-matcher.test.mjs | 422ed628549f907129703f8bae6c79dc281fdc147122a61a80f5dd48fb47bf14 |
| test/changed-test-inventory-artifact.test.mjs | b0ba0f68b8d7d8e70a17e3fc2086b4139f4aee39619bc88c52a1d9cb11a0358d |
| test/changed-test-inventory-producer-binding.test.mjs | 2e0a05d6dbcc3dbbf7aab8fa17c2b1e37b92d75887679ac4514a18332abc6cf3 |
| test/changed-test-inventory-producer-matrix.test.mjs | a626c64d8a90495bab0ff334b39c1abf594d2bbf8182b28875251f907960e3a7 |
| test/changed-test-inventory-producer.test.mjs | d29a7961d7e3c578dede911593458e8a4ffcb957d2e11eee1e429c40d28a684a |
| test/changed-test-inventory.test.mjs | 95a20190dd0641f70357600aaaf5566be3a320a00b96f174750f580b77a8e7e4 |
| test/committed-batch-consumer.test.mjs | d6fd1245ae5ab8c218d1357b2df37189c320c9d0d54f9037247b1553b8153d8d |
| test/governance-seed-preimage.test.mjs | 5a999cef64414c61c88fac222f1ca574ac7b72335e06ba7614c922442ea6c9de |
| test/head-view-snapshot.test.mjs | b6a0a1b2887cf65cbc5b5563777504e07a9ae7c65f45645e0175474b7bd2ac4e |
| test/inventory-telemetry-observer.test.mjs | 28a3953b371a762dfb90d23f69a92417035bb0074a2417da79733d2326bbff74 |
| test/node-test-adapter.test.mjs | 38390845dda0d65d99a014333016b47f66fc2e1e09d2142a9cb0856bdade72b5 |
| test/provenance-base-consumer.test.mjs | 2232d8f09b3dacf93e5df8ac6843f7ce21444ee911ff816243fa5357c173381f |
| test/provenance-batch-reader.test.mjs | 7c7f4d42e859d6487b8f858c295fe39de836455472b8a01da8b75c20d4d57741 |
| test/provenance-batch-writer.test.mjs | d6275729879817def4e0ef99394e86757247d9eeb8e9979238d253377f705885 |
| test/provenance-historical-validator.test.mjs | 521d1e67a6ccfacbaebf4ace1b1e9e5ce6417e8d463fbdf40addacde01f5bd1d |
| test/provenance-store.test.mjs | 3c2e0dc95fa8e8b209f64273bbedb2b22e0f018bac30c7aef22409d6c9c6ed43 |
| test/run-ledger.test.mjs | 1a1ff61d80be46877cadcd50a8e42ade212ba9918773840378accda7c498de57 |
| test/s3-source-freshness.test.mjs | 9daf57241439d14326a5ef71884b025c065b13a774cfd999ef476e922a79af3d |
| test/test-adapter-registry.test.mjs | 4dd664d3faf83b99fd44fe6851ce7fa8e8e3f33678732bd1b11cf804b6ac113b |
| test/test-provenance-block.test.mjs | 05c9f60e77de12efc9a2e01a398f9c4ecfec14ecd06ba86ce53be8c2824af022 |
