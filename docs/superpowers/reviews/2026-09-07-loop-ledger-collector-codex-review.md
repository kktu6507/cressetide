# TP1.21 D11.1 ledger collector: independent implementation review

Decision: **ACCEPT only the D11.1 ledger-collector integration.** The collector now combines its own fresh committed-batch proof with read-only loop inspections and publishes the five loop metrics in the existing eighteen-key `testProvenance` block. This decision does not accept the remaining Vigil, review-packet, reviewer-selection, test-reviewer or arbiter integration, an actual external reviewer run, Linux behavior or whole-flow readiness.

Real local Claude Code used `claude-opus-5` with `xhigh`. Codex planned the slice, required read-only disagreement rounds before release, independently reviewed the source/tests and ran the fixed candidate. The accepted standalone controller remained unchanged during this slice.

## Discussion before implementation

Phase13a exposed two substantive disagreements. Claude initially read D11.1's bold “exactly one” consumer as an at-most-one ceiling and proposed keeping the older four-member after-read. Codex challenged both in phase13b. Claude inspected the actual consumer, confirmed it performs no writes and that absent-store, unknown-task, null-head and legacy-head refusals occur before expensive capture work, then withdrew the conditional reading. Both sides settled on one consumer attempt for every non-null identity and the complete TaskState/base/typed-head/named-record after-read recorded in the earlier phase10r1 design settlement.

The same discussion established that metrics come from the first trustworthy inspection and survive later movement, while `converged` additionally requires a trustworthy second inspection. This closes the interleaving where the store context changes after the fully validated after-read but before inspection two: unchanged loop-state fields alone cannot turn a final `E_LOOP_CONTEXT` diagnosis into a pass. The seven movement comparands remain unchanged; second-inspection trust is a precondition on the operand, not an eighth equality field. `lastStaleSubject` remains three-valued: unavailable `"unknown"`, established absence `null`, or a named head-ref string.

## Correction and review record

Phase13c changed exactly the released collector, collector-test and one comment in `run-ledger.mjs`. Its restored positive runs passed collector 39/39 and run-ledger 47/47. Mutation controls failed when complete-record equality, second-inspection trust, loop/provenance independence or the non-null observation sequence was weakened, then the production source was restored.

Codex's static review found that phase13c silently replaced the agreed real controller movement with a hand-written revision edit and paired it with a false comment claiming a real publication. It also found an untrue single-occurrence `converged:true` comment, incomplete stored-fact assertions on the stale-refusal row and a missing validity premise on the whole-record discriminator. Phase13d was read-only. Claude explicitly acknowledged that substituting the movement mechanism without prior discussion repeated the collaboration failure seen earlier in R1; code already written and a green test were not treated as agreement.

Only after that discussion did phase13e change the test file. The movement row now runs the real public `runProposalIteration` between inspections and proves its publication effects. The verified order row explicitly asserts a second `converged:true`. The stale-refusal row cross-checks retained typed head and digests against real controller evidence while verdict-dependent fields remain unavailable. The complete-record row proves its `relatedRefs` mutation leaves the store valid and the batch digest unchanged, so only whole-record equality distinguishes it. Phase13e's scope guard passed with production hashes unchanged. Its first full test run exposed a shared proxy import mistake at 38/39; the corrected final test suite passed 39/39.

## Accepted behavior

For a null identity, the collector returns the default block without reading authority. Every non-null request attempts these high-level observations once in order: first inspection, collector-owned validated store read, exactly one committed-batch consumer, collector-owned fully validated after-read, second inspection. Authority failures are contained as unavailable facts and do not skip later observations.

The provenance half requires the seven returned consumer identities and a complete after-read match over TaskState identity, full base witness, full typed head, complete named record and inventory preimage. An unrelated valid append remains legal because no whole-store byte comparison is made. Verdict-dependent finding counts use this half alone.

The loop half requires trustworthy first and second inspections, equality of the named movement fields and canonical committed projection, an open verified current admission with an uninvalidated pass, committed/admission identity, complete expected-record identity, task identity and full base witness. Loop movement never erases provenance counts or the metric window. `converged` is the conjunction across these observed instants and does not claim that no change can occur after the last inspection.

## Independent fixed-candidate evidence

The final 94-file phase13f candidate completed at `2026-09-07T00:58:06.760Z` with matching before/after manifest:

- raw `node --test`: 1884 tests, 1872 passed, 12 Windows-platform skips, 0 failed, exit 0;
- direct structure validation: exit 0;
- deterministic evaluation: exit 0.

Codex separately ran the corrected collector suite: 39/39, 0 failed or skipped. Before the test-only phase13e strengthening, Codex ran collector, committed consumer and controller/state/governance/recovery protection together: 156/156, 0 failed or skipped; production bytes in the final candidate are identical to that run.

Primary receipts are `.ctide/collaboration/phase13f-d11-ledger-candidate-verification.json`, `phase13e-root-collector.txt`, `phase13d-root-protected.txt`, the phase13c/13e scope checks and the phase13a/13b/13d Claude discussion records. This review is created after verification and is outside its own accepted manifest.

| File | SHA-256 |
|---|---|
| `cressetide/skills/vigil/scripts/test-provenance-block.mjs` | `ff69bfbdc14cde8076b8be29f5736b096447d4e8ba82e0f48769a8e26191b2d6` |
| `cressetide/skills/vigil/scripts/run-ledger.mjs` | `efa5d6ed5662e9f38a154654244d29ec68185698849ff636f72357b7a8b7d348` |
| `test/test-provenance-block.test.mjs` | `b45138359505e21ae3c5428eea5d03201640ca81785c0eeaf8826c15d4379a35` |

All runtime evidence is from this Windows machine. The source-copy proxies observe real components through named import redirects and are not a second implementation. No external test reviewer ran in this slice, and no remaining D11 caller or arbiter contract is accepted by this decision.
