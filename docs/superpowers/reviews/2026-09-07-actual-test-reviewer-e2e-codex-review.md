# TP1.21 actual test-reviewer E2E: independent acceptance review

Decision: **ACCEPT the Windows actual-reviewer positive and fixed-point E2E workflows, the five-file E2E harness, and the separately exercised reviewer tool boundary.** The evidence closes the D11 obligation to run the shipped `test-reviewer` through a clean success and a negative/repair/convergence loop using `claude-opus-5` with `xhigh` effort. It does not establish Linux behavior or overall repository readiness.

Real local Claude Code implemented the harness and discussed each disputed point before the related correction. Codex planned the slices, froze the edit scope, reviewed the source and tests independently, ran the actual reviewers, verified the resulting files and receipts, and made this acceptance decision. Claude completion reports were never treated as agreement or acceptance.

## Discussion before correction

The first static review found that `partialReviewRemoved` described an attempted cleanup as if a file had actually been removed, and that several prefix/history checks ran after a potentially expensive repaired reviewer invocation. Claude agreed in the read-only phase16j discussion, explained why both observations violated the evidence contract, and only then changed the shared cleanup result and added stable required-history/prefix checks in phase16k.

Live phase16l and phase16n probes then disproved the assumption that exact `--allowed-tools` Bash rules, with or without `--permission-prompts none`, formed an exclusive command allowlist in this environment. Restricted phase16o probes confined file tools but still permitted an unlisted `git status`. In phase16p, Codex and Claude therefore agreed to bind an invocation-scoped `PreToolUse` Bash hook. Phase16q added the hook and audit trail. Subsequent read-only reviews found four more evidence defects: non-Bash fallthrough order, nullable session acceptance, an undigested audit dependency, a weak audit schema, filtering that hid missing audit records, and no receipt-time closure over the audit directory. Claude agreed with the reasons in phases16r and phase16t before phase16s and phase16u corrected those exact scopes.

After the real runs, Claude performed a final read-only cross-review in phase16z. Claude agreed that both workflows satisfy the settled contract and found no release blocker. Claude also identified one claim-scope correction: all three actual E2E reviewer invocations have `denyCount: 0`, so those receipts prove hook mediation and successful use of the two authorized commands. The separate live hook probe proves denial of an unauthorized Bash command and a sibling absolute file read. This review adopts that distinction.

## Accepted harness

The harness creates separate reviewer-repository and harness roots. The reviewer repository contains the product files and neutral test capture only; packets, raw model output, slices, hook configuration and audit records remain in the harness root. The shipped test-reviewer runs in a fresh OS process and fresh Claude session for each admission, with the plugin's real reviewer contract, `claude-opus-5`, `xhigh`, restricted file tools, no MCP servers and no interactive permission prompts.

The sentinel slicer preserves exact bytes between one BEGIN/END pair. The driver binds packet, raw capture, slice, emission, submission, committed batch, fresh verification, evaluation, gate and ledger evidence. It validates the required event history before every model-bearing stage, rejects stale claims without consuming an admission or iteration, and closes the hook-audit directory over the exact per-invocation manifest union. The fixture repository is scenario-specific and the harness is not an independent implementation of the shared main-thread slicing prose.

| Accepted file | SHA-256 |
|---|---|
| `eval/loop-e2e/bash-guard.mjs` | `c59f2a507d0d0dff1a7fa42253124cf6f4e3332b7ad08e55ab2a633e95647037` |
| `eval/loop-e2e/sentinel-slice.mjs` | `28dcefc00c736b79eb92abbae2e162996843878af705e1b76b76921fc49d9cc4` |
| `eval/loop-e2e/scenario-repo.mjs` | `825df100919551379b959823649ba17f774f691a08c5df46221f06eac92ee77b` |
| `eval/loop-e2e/run-scenario.mjs` | `8b34d69d51fafcd858d3b39c04b72d4f21f144e8e8a45ac24298e2cafd673786` |
| `test/sentinel-slice.test.mjs` | `a4ff872b54df662c6465185a7a186821d240fe9b30f961e048611e6387178bc8` |

The focused harness suite passed 106/106 with zero failures. Preflight passed 9/9, both direct structure validators passed, and direct syntax/import-purity and empty/extra-audit closure probes passed.

## Live reviewer boundary

The phase16v live probe used fresh session `9ec563b7-6e8b-4ef4-83d8-bc03eb315a36` with Opus 5/xhigh. The exact diff and test commands succeeded. An attempted `git status` was denied by the Bash hook, and an attempted absolute read of a sibling file was denied by restricted file access. The process exited 0 with empty stderr and a clean stream. The three Bash decisions were session-exact, matched the transcript one-to-one, passed byte/digest re-verification, and closed the audit directory.

This proves the deny path and file confinement on this Windows machine, CLI version and probe. The actual E2E sessions below issued no unauthorized command; their audit records prove mediation and allowance, not an in-flow denial.

## Actual positive workflow

The positive run used fresh reviewer session `24ce0aa7-d567-4f41-b981-acfaf7f85cd0`. The reviewer exited 0 with empty stderr. Its 14,628-byte raw stdout has SHA-256 `bbe186c9f0be31382094c373487a409887c1bf977588338a01cd8b72af48c505`; the exact 1,746-byte reviewer batch slice has SHA-256 `908c2a364dfaf0f3f9c7297d456f17c61e4b93dc41b4c0ca798fea19b93ec681`.

The controller admitted one zero-finding batch with `commitReady: true`, committed it, performed a fresh non-historical Step 6 verification, and evaluated both loop and provenance halves true. The gate converged with admissions/iterations/epochs `1/1/1`, and only the gate appended the one ledger record. Receipt-time audit re-verification found exactly the two allowed-command audit records and no unclaimed record.

Receipt: `.ctide/collaboration/phase16w-positive-receipt.json`, SHA-256 `d10e7d8d0f2288f8c511762b06a92521c5aadd5cb4dd2e9f68ae52d02e969b11`.

## Actual negative, repair and fixed point

The negative reviewer used fresh session `422f0fa6-c319-4f76-a1d4-677f33c396dd`. Its 14,375-byte raw stdout has SHA-256 `2b75449171e63c7caac8a412c012b2b1f908e9202139323a1fc3857da305d76d`; its reviewer-authored batch slice has SHA-256 `793d552fe6fddb358db6401bb44e440cd21b8081099e9c3371ad08320096d1bf`. It returned a concrete `scope-violation` for `test/alpha.test.mjs`. Submission was admitted as not commit-ready, commit was refused with `E_LOOP_NOT_COMMIT_READY`, and evaluation was false.

The repair changed the inventory digest. Replaying the old negative slice against that new emission was refused with `E_LOOP_CLAIM_MISMATCH`, left admissions and observed iterations at `1/1`, and recorded that the stale partial review file was actually removed. The repaired reviewer then ran in new session `2809929e-d1ed-433d-82cc-664d47de6bdd`, exited 0 with empty stderr, and produced a zero-finding batch. Its 16,542-byte raw stdout has SHA-256 `8598c1b4f6a9f5f016d5f249ffe53578352d591fb99c679d2ee98e64b5948871`.

The repaired clean slice equals the positive clean slice because both scenarios intentionally converge on identical source and inventory bytes. The independent raw stdout digests and sessions are different. The repaired batch committed, fresh verification and evaluation passed, and the gate converged at admissions/iterations/epochs `2/2/1` with one ledger record. Receipt-time verification closed two distinct invocation manifests over four audit records.

Receipt: `.ctide/collaboration/phase16x-fixed-point-receipt.json`, SHA-256 `92020960249bb3cd8aeb0ec36278c1125afce5cad7ca071df11d6ba6c0bb91f7`.

## Independent evidence and limits

Codex's phase16y verifier re-read the packet, raw capture, slice, boundary and audit files, recomputed their byte lengths and digests, validated the exact history, confirmed the raw-slice-submission links, closed each audit directory, parsed the single ledger record and compared its `testProvenance` block to the gate. Both receipts passed. A repository-contamination scan found no harness path, phase label, packet, probe or hook marker in either reviewer repository outside `.git`.

The receipt does not bind the driver digest, the verifier intentionally reuses validated harness helpers, and supplemental-failure/terminal variants were not exercised. These are non-blocking hardening opportunities and do not expand this acceptance. Both ledger verdicts remain the explicit fail-closed `NOT READY`; no arbiter issued a readiness verdict in the isolated harness.

All execution evidence is Windows-only. Linux remains unverified because no WSL distribution, Docker or Podman runtime is available and runtime installation is not authorized. This decision accepts the actual external-reviewer E2E obligation only; final fixed-candidate regression and source/spec/status reconciliation remain required before a readiness decision.
