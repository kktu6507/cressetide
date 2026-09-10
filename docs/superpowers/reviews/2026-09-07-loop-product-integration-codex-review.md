# TP1.21 D11 product integration: independent implementation review

Decision: **ACCEPT the D11 Vigil, review-packet, reviewer-selection, test-reviewer, arbiter, runtime and ledger contract integration.** Together with the separately accepted D11.1 collector, the product now describes the controller's seven-step TP-active loop, exact reviewer transport, mandatory real test-reviewer rule and fresh read-only arbiter gate. This decision does not establish that an actual external reviewer completed a positive, negative or fixed-point workflow. It also does not establish Linux behavior or whole-flow readiness.

Real local Claude Code used `claude-opus-5` with `xhigh` in the persistent project session. Codex planned both releases, held corrections until the disagreements below were discussed, reviewed the final source and tests independently, and ran the fixed candidate. Claude's completion reports were treated as implementation evidence, not as agreement or acceptance.

## Release 1 discussion and correction

The first reviewer-transport implementation was structurally green but incomplete. Codex found four issues before acceptance: the empty-inventory qualifier accidentally constrained non-TP substitution; the reviewer received only an inventory summary while the returned batch requires the complete emitted envelope and exact task/base claims; the packet mixed production and classification in one overlapping enum; and the permission-carrier test used a global match count that already missed the test-reviewer carrier.

In the read-only phase14e round, Claude agreed with each issue and gave the reason for each position. In particular, Claude confirmed that no approved clause imposed an inventory prerequisite on non-TP work, that a controller-created artifact pointer is an authoritative reviewer input rather than an external proposal path, and that the green aggregate test concealed a live coverage gap. Only after that discussion did phase14f change the five affected carriers/tests. The corrected contract supplies exact task, base, emitted inventory and digest inputs; embeds the closed nested batch grammar in the test-reviewer prompt; separates `empty`, `non-empty` and `unestablished`; scopes substitution to TP-active work; and charges every permission carrier separately.

## Release 2 discussion and correction

Claude first designed and implemented the seven-step caller and arbiter integration in phases15a–15c. A read-only authority round resolved two preliminary questions before editing: `${CLAUDE_PLUGIN_ROOT}` is supported in a shipped subagent prompt, and the authoritative controller specification is `2026-09-06-test-provenance-loop-amendment.md` with SHA-256 `522d436ee89ea5e51c188707281986768503cadbbad2192da8b368a0945d5527`.

Codex then found six substantive problems in the phase15c candidate. The TP-active established-empty lane still allowed reviewer substitution even though no authorized actor could originate the required reviewer-owned batch; the arbiter ignored payload/exit incoherence and claimed stream attribution its surface may not preserve; the exact evaluate command test accepted suffix flags and duplicates; ledger assertions were section-global; several promised mutants were not actually applied; and runtime tests did not bind file roles to owners.

Claude answered each finding before further changes. Claude agreed that the frozen controller has no empty-inventory skip, that every TP-active loop therefore needs a real reviewer returning `results: []`, and that a non-TP run retains the ordinary fast lane. Claude also agreed to judge payload and exit status together, make the command an exact one-line equality with a single occurrence, scope every counter to its owning statement, apply the missing mutations, and bind runtime roles to owners. A second read-only sweep expanded the correction allowlist from Claude's initially incomplete proposal to all six live carriers. Phase15e then implemented only that settled scope.

## Accepted behavior

Generic verification still runs before the conditional TP-active sub-loop. A TP-active run opens the controller and performs the seven ordered operations: emit, build the Review Packet, invoke one real test-reviewer, submit, commit, verify with the existing Step 6 consumer, and let the arbiter run one fresh evaluate call. The main thread owns mutations; the arbiter writes and reconciles nothing. `inspect` remains diagnostic and `open-epoch` recovery-only. The ordinary repair cap of two and controller cap of eight remain separate.

Every TP-active run with an established inventory invokes the real test-reviewer, including a zero-entry inventory and a governance-affected-only non-empty inventory. A zero-entry review returns a complete reviewer-authored batch with `results: []`; an unestablished inventory fails the earlier required-check gate and produces no reviewer handoff. A non-TP run has no inventory precondition and retains the existing evidence-substitution rules.

The arbiter runs exactly this one command per TP-active arbiter pass:

```
node ${CLAUDE_PLUGIN_ROOT}/skills/vigil/scripts/test-provenance-loop.mjs evaluate --cwd <repo-root> --task <task-id>
```

It requires one coherent payload/exit pair: `combined:true` with exit 0, `combined:false` with exit 1, or a no-`combined` refusal with exit 1 that is not a gate result. Missing, unparseable, duplicated or incoherent evidence blocks `READY`. It reports loop and provenance halves separately, and neither a corrupt loop state nor the ledger may replace or erase the fresh result.

The runtime contract now documents all controller file roles, ownership, hard head-view exclusion, hygiene dependency and loss semantics. The ledger contract assigns each of the five loop counters to its exact source and keeps ledger projection independent from the arbiter gate. The validator's arbiter prompt cap is 30,000 bytes; the accepted prompt is 29,913 bytes, leaving 87 bytes of headroom.

## Independent fixed-candidate evidence

The final 102-file phase15e candidate completed at `2026-09-07T03:02:12.778Z`. The verification runner checked the synchronized manifest before and after all commands, and Codex separately compared all 102 original workspace files to that manifest with zero mismatches.

- `node --test`: 1912 tests, 1900 passed, 12 existing Windows-platform skips, 0 failed, exit 0;
- `node .github/scripts/validate-structure.mjs`: exit 0;
- `node eval/run-eval.mjs`: exit 0;
- independent targeted run: workflow contracts 51/51, agent manifest 8/8 and structure mutations 55/55, total 114/114;
- `node --check test/workflow-contracts.test.mjs`, direct structure validation and `git diff --check`: exit 0.

Primary receipts are `.ctide/collaboration/phase15e-fixed102-verification.json`, its three command logs, `verification-sync-manifest.json`, the phase14e/14f and phase15a–15e discussion/guard records, and `.ctide/collaboration/loop-product-integration-acceptance.json`. This review and the acceptance receipt are created after candidate verification and are outside their own accepted manifest.

| Integration file | SHA-256 |
|---|---|
| `.github/scripts/validate-structure-core.mjs` | `cc4bc0a9fd5d6025c74ddd4a7b1b6775ad10ab3436ddceca8307f7c883992561` |
| `cressetide/agents/arbiter.agent.md` | `22b902eabcb4d4b22ed37e6bd9c266e13f590c81f206c56849af3350f67dc938` |
| `cressetide/agents/test-reviewer.agent.md` | `4a07325fb293ecaa3b0fb1e235ff85e37044784baa03f21806885dc6db2f74ac` |
| `cressetide/skills/vigil/SKILL.md` | `52a340de3fba3b3de0557363e3a8ee4a7c9285c7f7ac2fedf2c23d0958ae1f77` |
| `cressetide/skills/vigil/references/review-packet.md` | `8d01fd4a597febc383132e6e9eab35d20b91540e20c8fc1b93a66dd577a27e0f` |
| `cressetide/skills/vigil/references/reviewer-selection.md` | `2ada00d50c26367af7a168a3342602837b69eacc22f7b312db6b1cf37d3d49f8` |
| `cressetide/skills/vigil/references/run-ledger.md` | `74364c890c3cb45a85e6962458524d3c7506f98221967aff8e1f6a775ae009d9` |
| `docs/runtime-contract.md` | `5ef805cd9bc795b07591841a5132d37ddf571b9da7102c4ca67d42dd24536ddd` |
| `test/workflow-contracts.test.mjs` | `343dc769a42a4913558abb95af9e217c2de9d0fb197780e2ef73b91d906f5e74` |

All runtime evidence is from this Windows machine. The Stop hook cannot itself observe TP-active state, so the no-substitution rule is carried by the workflow and enforced by arbiter sufficiency review. The executable empty-inventory check drives real loop ingestion; it is not an actual external reviewer invocation. Those remaining workflow and platform boundaries are not part of this acceptance.
