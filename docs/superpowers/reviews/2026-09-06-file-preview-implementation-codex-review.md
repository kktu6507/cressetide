# File-backed preview: independent implementation review

Decision: **ACCEPT only the TP1.19 file-preview implementation**, under the user's delegation to Codex for planning, discussion and independent review. Claude Code used the real local claude-opus-5 model with xhigh effort and the existing project-only Anthropic authorization. The effective specification remains shared1.15 +intent1.10 +TP1.19. D's controller, epochs, gates and caller integration remain unapproved and unaccepted by this decision.

The helper captures its two request values once, parses its own submitted text, and shares the private loaded-file derivation with the actual writer. It returns the actual input text digest and the complete derived record without taking a lock or mutating the filesystem. Actual writers retain their own lock, validation, CAS and publication; preview is not proof of a successful write, external reviewer invocation or Step6 convergence.

Before correction, root independently reproduced three repeated property reads allowing an adversarial JavaScript getter to supply different parse and raw-validation texts. The text writer refused the duplicate inventory member while preview accepted; the store remained unchanged. This is a JavaScript API boundary issue, not a JSON CLI exploit. Root also reproduced nonenumerable and Symbol own keys bypassing the exact key guard. The phase10p2 read-only reasons discussion and separate correction release precede final implementation acceptance; their detailed record remains in the collaboration prompts/responses. Tests distinguish the old code from the corrected boundary. No broad hostile-Proxy guarantee is claimed.

## Fixed candidate evidence

Base HEAD: 7f1b3467a0a67e625f72cfd86bbaf1fe431944f8. Completed 2026-09-06T06:34:45.542Z. All checks use the same manifest, checked before and after execution and against original project bytes before acceptance.

- ℹ tests 1726
- ℹ pass 1714
- ℹ fail 0
- ℹ cancelled 0
- ℹ skipped 12
- ℹ todo 0
- ℹ duration_ms 152388.4884

Full regression, direct structure validation and deterministic evaluation passed with actual exit0 in the clean verification checkout.

| Independent plan | Plans | Rows/cases |
|---|---:|---:|
| preview | 3 | 25 rows |
| writer | 6 | 109 cases |
| consumer | 17 | 144 rows |
| integration | 7 | 96 rows |
| e1 | 6 | 41 rows |

The preview's25 independent rows include four actual Git/emitter/preview/file-text-writer/fresh-consumer workflows (canonical, pretty LF, pretty BOM/CRLF, and legal reordered inventory root),12 actual typed writer-refusal comparisons, nine API controls including the accessor discriminator. Full expected records and unchanged pre-write store bytes are checked. Synchronous filesystem mutation observation is bounded instrumentation, complemented by source review; it is not universal interception. Inventories in Claude's own suite are hand-built component fixtures; the four independent positive workflows use the actual emitter. Reviews inside all fixtures are mechanical synthetic inputs, not proof that an external reviewer ran.

Protected writer, consumer, integration and E1 suites all pass their expected plan/row counts. Included consumer observations are within the recorded workflows and must not be added as disjoint workflow counts. A separately reproduced sibling emitter request-capture defect remains tracked in request-capture-followup.md; these protected checks do not cover or resolve that later counterexample. It is outside this helper-only acceptance and must be handled before final integration acceptance. No Linux execution, whole-flow READY decision or controller approval is claimed.

The initial consumer invocation omitted the optional E1 flag, and the initial consumer/integration runners reused a historical-clock output name. Root preserved their receipts, ran the two E1 plans with the required flags and reran the two colliding historical plans into distinct outputs. The reviewed consumer/integration receipts explicitly name these component receipts and replace only those plan entries. Their final logical counts are144 and96, not the sum of original and supplementary executions. The initial writer summary was also overwritten by the consumer's shared summary name; acceptance preflight refused that missing receipt before creating any acceptance. Root reran all six writer plans under the distinct preview-writer-candidate prefix, obtaining109 passing cases and an independent complete receipt. This corrects evidence collection, not a hidden product-test failure.

Receipts: preview-candidate-verification.json and preview-candidate-preview-probes.json, preview-writer-candidate-probes.json, preview-candidate-consumer-reviewed-probes.json, preview-candidate-integration-reviewed-probes.json, preview-candidate-e1-probes.json under .ctide/collaboration, plus preview-candidate-protected-supplement.json and the preserved initial consumer/integration receipts. This review is written after verification and excluded from its own tested manifest.

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
| cressetide/skills/vigil/scripts/provenance-store.mjs | 2fe501b768475f5da418107217048b0620bd0e29a3c7f250cdef44b0b79af5f3 |
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
| docs/superpowers/reviews/2026-09-06-file-preview-implementation-dialogue.md | 768ad5222c11b7a1734c2caf53164ef2c98471f7a3b55c0dcd8f69b217b051ca |
| docs/superpowers/reviews/2026-09-06-file-preview-spec-codex-review.md | 5a3196064adad9b9f0fea2169f56db97716d0f7299912a16ae3a4595050a52e8 |
| docs/superpowers/reviews/2026-09-06-loop-ledger-design-dialogue.md | 254da6c4f83e5ab0def7c641ce8fc314b1791f970e515e2a2fb5534e0421664b |
| docs/superpowers/reviews/2026-09-06-product-integration-design-dialogue.md | 59940d70d8ff1e2a2dfe42598b807f85747cfaebb0116ca84c241f8275211dc7 |
| docs/superpowers/reviews/2026-09-06-telemetry-ledger-codex-review.md | 573782d11a35bfbc51b3b5245ce3c6bf7e093812b0fedc12dce47173c4a68f6b |
| docs/superpowers/reviews/2026-09-06-telemetry-ledger-implementation-dialogue.md | 3b5f24cddaf9115da8dc0b96027fb92d05b57c4232250eedef00039e8580dda6 |
| docs/superpowers/reviews/2026-09-06-telemetry-ledger-spec-codex-review.md | 345bb9360ea27ed979abd07f860c2347a84ce934706ee0e2e9121daa630af65b |
| docs/superpowers/specs/2026-07-25-intent-scan-spec.md | 8bef993a7178995e14c3d3b5febb03eeee9f523e7bc803b81b93da49fe1edf75 |
| docs/superpowers/specs/2026-07-25-shared-decision-provenance-model.md | 47bb900657f71f7a5f06dcec2c9802495de8839ad7d9f3cf2f329113df203057 |
| docs/superpowers/specs/2026-07-25-test-provenance-spec.md | c00b7a20ae91aff37ee9e0fd4f4d7fa4f0b5fa0fce8c444876a2ecae487ea607 |
| docs/superpowers/specs/2026-09-06-test-provenance-file-preview-amendment.md | bf71c0a8e89d56d8908536696817606c58e0fa4ad59566124799f65ab735cd4a |
| docs/superpowers/specs/2026-09-06-test-provenance-loop-amendment.md | 98832ecabccd205f81557e3e6be0401b9c68d8d875e52de9d64e16c12a759d68 |
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
| test/provenance-file-preview.test.mjs | 79707d75df665e736a91f89d14616374a79991278733fdc0561ea0b43f3e8fc3 |
| test/provenance-historical-validator.test.mjs | 521d1e67a6ccfacbaebf4ace1b1e9e5ce6417e8d463fbdf40addacde01f5bd1d |
| test/provenance-store.test.mjs | 3c2e0dc95fa8e8b209f64273bbedb2b22e0f018bac30c7aef22409d6c9c6ed43 |
| test/run-ledger.test.mjs | 1a1ff61d80be46877cadcd50a8e42ade212ba9918773840378accda7c498de57 |
| test/s3-source-freshness.test.mjs | 9daf57241439d14326a5ef71884b025c065b13a774cfd999ef476e922a79af3d |
| test/test-adapter-registry.test.mjs | 4dd664d3faf83b99fd44fe6851ce7fa8e8e3f33678732bd1b11cf804b6ac113b |
| test/test-provenance-block.test.mjs | 05c9f60e77de12efc9a2e01a398f9c4ecfec14ecd06ba86ce53be8c2824af022 |
