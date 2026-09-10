# Public request capture: independent implementation review

Decision: **ACCEPT the bounded request-capture correction to the emitter, observer, consumer, collector and shared producer/seed guard.** Existing shared1.15 +intent1.10 +TP1.19 contracts remain effective. This corrects their JavaScript entry boundaries without changing domain authority, payload semantics, operation order, actual writer validation or the E1 eighteen-field definitions. D's controller and flow integration remain unaccepted by this decision.

Codex independently reproduced the actual emitter deriving in isolated repository A and publishing under B, first with a changing property accessor and then with an ordinary request object mutated during await. The latter needs no getter. The completed phase9d9 read-only discussion established the cause and scope before the phase10q1 correction release. Real local Claude Code used claude-opus-5 and xhigh effort under the user's existing project-only authorization. See the separate request-capture design dialogue for reasons, limits and chronology.

The four operations now capture their own values once after complete own-key validation and keep those captured values through all awaited work. Producer/seed preserve their existing single capture and specific forbidden-string diagnostic precedence while including hidden and Symbol keys in the request check. A complete own-key check does not require the two or three permitted keys to be enumerable. No prototype ban or hostile-Proxy guarantee is introduced.

## Independent fixed-candidate evidence

HEAD 7f1b3467a0a67e625f72cfd86bbaf1fe431944f8; full checks completed 2026-09-06T07:13:05.020Z. All manifests match, were checked before/after execution, and match original project bytes at this decision.

- ℹ tests 1736
- ℹ pass 1724
- ℹ fail 0
- ℹ cancelled 0
- ℹ skipped 12
- ℹ todo 0
- ℹ duration_ms 153251.7977

Full regression, direct structure validation and deterministic eval passed with actual exit0 in the clean checkout. Each runner used a distinct output prefix, with the explicit E1 consumer flag where required.

| Plan | Subplans | Rows/cases |
|---|---:|---:|
| request capture | 5 | 28 rows |
| preview | 3 | 25 rows |
| writer | 6 | 109 cases |
| consumer | 17 | 144 rows |
| integration | 7 | 96 rows |
| E1 | 6 | 41 rows |

The28 independent request rows include two actual emitter source/destination discriminators; two six-operation flows with enumerable and nonenumerable permitted properties (real Git, producer, emitter, observer, text writer, consumer and collector);12 hidden/Symbol refusals; and two producer/seed specific-error-precedence controls. Constant getter counts are structural capture evidence; only the two-repository controls demonstrate wrong destination in the baseline. Fixture reviewer data are mechanical synthetic inputs, not an actual external reviewer invocation. Consumer evidence includes46 E1 observations inside its workflows, not disjoint extra workflows.

The producer's no-write-on-failure order, observer's failure disclosure, collector's unavailable/absent identity distinctions, accepted preview and actual writer/consumer behavior remain protected. Lower exported helper APIs with their own direct-call request consistency concerns remain separately tracked; this slice does not claim those contracts corrected. No D controller, final READY or Linux execution claim follows.

Receipts: request-candidate-verification.json, request-candidate-request-capture-probes.json, request-candidate-preview-probes.json, request-writer-candidate-probes.json, request-consumer-candidate-probes.json, request-integration-candidate-integration-probes.json, request-e1-candidate-e1-probes.json under .ctide/collaboration. This review is created after verification and is not included in its own manifest.

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
| cressetide/skills/vigil/scripts/changed-test-inventory-artifact.mjs | c2634bbad09cb439cf9c7f4b5f0ea29892e03f64c1e4cc6eba444c43213e1bfc |
| cressetide/skills/vigil/scripts/changed-test-inventory-producer.mjs | bda981280c35a98e78db4ca0c3b68af79c775fdd60d27be1e513e926e352fa68 |
| cressetide/skills/vigil/scripts/changed-test-inventory.mjs | ffd2a30c0405855bf0ef8f95ab49a330b3b5092df753a086aa17cb6db6f590db |
| cressetide/skills/vigil/scripts/committed-batch-consumer.mjs | fd386ba87a84e15f7d2a1d7024eaa69eba4006a74deff6ea0e0525d3ba3ce0ee |
| cressetide/skills/vigil/scripts/contract-check.mjs | e5841bfde003bd009d21b1cc2c2452f80ce721e6166707c9d9e07acd81253c9b |
| cressetide/skills/vigil/scripts/exact-tree-blob.mjs | d2a5cdd5ff8ac13db6558f510564b686d3e96992636cc5d2d9f04769b9ba48ff |
| cressetide/skills/vigil/scripts/governance-producer-core.mjs | 7a68d4bb648e7674835f1c96e04ba8eb3a3655b72dd1f3b144efa1661822a0b3 |
| cressetide/skills/vigil/scripts/governance-seed-preimage.mjs | d0d754b140a5921e2f2693478bffbe78f3241b22af43d5ecc21f275c2266b8d0 |
| cressetide/skills/vigil/scripts/head-view-snapshot.mjs | e08598ad510d46449f768dafb46965bc4cbe5b90a4f76af0f65a4f9834c2312e |
| cressetide/skills/vigil/scripts/inventory-telemetry-observer.mjs | d8105ccf3e62fd23ba1f125e0d8cd61b161de01dfdbedb1a296ffc95d19f622d |
| cressetide/skills/vigil/scripts/node-test-adapter.mjs | 0ad44456f720136783e07b925abbfa3faa4302b123e3e8fb811663ca3a73bb9d |
| cressetide/skills/vigil/scripts/producer-request.mjs | 7cb1bbd6f3f8cf27ea65952e8b993d6167eeffe5bd567740f4c4121d567c6746 |
| cressetide/skills/vigil/scripts/provenance-store.mjs | 2fe501b768475f5da418107217048b0620bd0e29a3c7f250cdef44b0b79af5f3 |
| cressetide/skills/vigil/scripts/run-ledger.mjs | a41b1b63916eff67f6c0019416297e613244ef2ceda9fab79fd430ee5bd02d48 |
| cressetide/skills/vigil/scripts/s3-source-freshness.mjs | 18494f6f29543248d66d153fcf78f55676512331443d1fac1d2a028955e354ee |
| cressetide/skills/vigil/scripts/source-digest-comparison.mjs | 3e723c989fb608943918ad6c0bd51a3fe62009d30260b16c8ea8edc13bb5cc4f |
| cressetide/skills/vigil/scripts/source-occurrence.mjs | 454407e5543849987459ece255aeb2833c7805395155c2c29c208fe5460c7a0e |
| cressetide/skills/vigil/scripts/test-provenance-block.mjs | 5421929b47c6d1b90deb3279fcaa8420e251f55e8026dc0d7c5a0fcaa9d7ee0f |
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
| docs/superpowers/reviews/2026-09-06-file-preview-implementation-codex-review.md | 84095b96d95a1b64b5f225f05a8bf5b03efdaa1446eb0db2a93e749129b6cfb7 |
| docs/superpowers/reviews/2026-09-06-file-preview-implementation-dialogue.md | 768ad5222c11b7a1734c2caf53164ef2c98471f7a3b55c0dcd8f69b217b051ca |
| docs/superpowers/reviews/2026-09-06-file-preview-spec-codex-review.md | 5a3196064adad9b9f0fea2169f56db97716d0f7299912a16ae3a4595050a52e8 |
| docs/superpowers/reviews/2026-09-06-loop-ledger-design-dialogue.md | d77d73296a3129f99a73a5ed332de7e75469229f30277dac6edad450eefc0f0b |
| docs/superpowers/reviews/2026-09-06-product-integration-design-dialogue.md | 59940d70d8ff1e2a2dfe42598b807f85747cfaebb0116ca84c241f8275211dc7 |
| docs/superpowers/reviews/2026-09-06-request-capture-design-dialogue.md | 3aaec0e36d47627a815e6422b7723d171cbfd6eecc40ecb2ff21135f962fd567 |
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
| test/changed-test-inventory-artifact.test.mjs | b353faeb649437c9c526dcd361138681f5d8165745332bab00e6075c9ace0e98 |
| test/changed-test-inventory-producer-binding.test.mjs | 6129d60d5e091aff88bb48efd4d8d304fb5f6de378092c78fe4575fb24ad57d9 |
| test/changed-test-inventory-producer-matrix.test.mjs | a626c64d8a90495bab0ff334b39c1abf594d2bbf8182b28875251f907960e3a7 |
| test/changed-test-inventory-producer.test.mjs | d29a7961d7e3c578dede911593458e8a4ffcb957d2e11eee1e429c40d28a684a |
| test/changed-test-inventory.test.mjs | 95a20190dd0641f70357600aaaf5566be3a320a00b96f174750f580b77a8e7e4 |
| test/committed-batch-consumer.test.mjs | 56edc174ff4414b8cca4097a2d7e74819d566f5fad3486952bdd30ec08dad6bd |
| test/governance-seed-preimage.test.mjs | 5a999cef64414c61c88fac222f1ca574ac7b72335e06ba7614c922442ea6c9de |
| test/head-view-snapshot.test.mjs | b6a0a1b2887cf65cbc5b5563777504e07a9ae7c65f45645e0175474b7bd2ac4e |
| test/inventory-telemetry-observer.test.mjs | 272e9dc1f4937f552b497e6c8307dcce427467d89d22e84b86861ca341b9f657 |
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
| test/test-provenance-block.test.mjs | af5bb3a56f4b6c2ab088338c0e5ba846a988e6cbeee127bfa561e9f7d8939e1c |
