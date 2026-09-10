# Efficiency instrumentation and observed baseline: Codex review

Accepted on Windows: the maintainer measurement tooling and a seven-case constrained reviewer reference. This completes the first execution slice of the [efficiency roadmap](../specs/2026-09-08-cressetide-efficiency-roadmap.md), not the whole optimization track. No distributed `cressetide/` source changed during this slice.

## Changes and verification

Real Claude Code `claude-opus-5` / `xhigh` implemented the metadata parser, frozen fixture/prompt protocol and bounded L1b driver under `eval/efficiency/`, two offline test suites, and the [measurement documentation](../../efficiency-measurement.md). Codex directed the scope, investigated failures, reviewed the implementation and ran verification independently. The tooling records source/model/CLI identity, separate usage surfaces, unknown costs, timeout/process status, raw record hashes and fresh role sessions. It refuses unexpected model/tool activity, source/input drift, malformed records and budget overshoot; it re-derives grades and accounting from raw results rather than trusting mutable summary claims. Seals detect edits, not malicious authorship; process facts and inherited settings are not independently authenticated.

The frozen117-file full candidate passed2,107 tests:2,095 passed,12 Windows skips,0 failures. Structure and deterministic seven-case dataset checks exited0. Codex compared all117 files against the main workspace with zero mismatches at acceptance. Focused measurement tests passed89/89, and separate offline probes confirmed rejection of altered history, noncanonical manifests, missing identities and last-call budget overshoot. Local receipts: `.ctide/collaboration/efficiency-instrumentation-candidate-verification.json`, `phase19p-repro.json`, `phase19s-instrumentation-acceptance.json`.

The subsequent baseline, README, measurement links and roadmap/status edits are documentation only and are outside that historical full-run receipt. Final documentation/provenance tests passed15/15; direct structure, dataset and diff checks exited0. The model-provenance CLI reports MATCH for `claude-opus-5`; this is model identity matching, not an efficacy verdict. Final file hashes and remaining boundaries are recorded in `.ctide/collaboration/phase20b-final-acceptance.json`.

## Actual execution evidence

The [baseline](../../../eval/baseline.md) and [per-call receipt](2026-09-08-efficiency-l1b-evidence.json) record14 fresh calls:7 reviewers and7 separate judges, all on Opus5/xhigh with CLI2.1.263. Defect hits were5/5; clean-control acceptance was2/2. Codex read every final review against its fixture and checked the seven grades, then independently rebound raw final sessions, costs and grades. The driver's final summary also re-derived the full history under the frozen protocol.

This used the shipped prompt body as a replacement system prompt, a neutral excerpt and Read/Grep/Glob. Native plugin activation, full-workflow behavior, held-out reliability and GPT-6 Astra runtime efficacy were not tested. The seven positive grades do not demonstrate that the live judge rejects intentionally missed defects or false positives; negative calibration is required before relying on this reference as a drift detector. Final reviewer prose is preserved as model output, not asserted as verified execution or a guarantee that every incidental statement is correct.

The formal batch cost estimate was US$1.4056655 against a US$3 cap. An earlier one-reviewer pilot stopped on unexpected Haiku usage despite zero child counters; its US$0.1671225 remains separate and unscored. Combined estimate:US$1.572788. These are CLI price-table estimates, exclude development/discussion sessions, and are not subscription billing. No additional model appeared in the14 accepted calls with contextual title generation disabled; the earlier extra call's purpose remains a hypothesis. Some calls overlapped local regression execution, so latency is not an isolated benchmark.

## Discussion and dispositions

The phase19a/b discussion preceded implementation; subsequent source corrections followed phase19d/e/g/i exchanges. In phase19m/n, Claude and Codex agreed to retain the strict single-model gate and suppress contextual title traffic through one documented environment override. Claude questioned the observed `default` permission mode; official documentation established that the requested `manual` flag is its alias. Claude withdrew the alleged ignored-flag defect, and the implementation added a check for the canonical observed mode. Codex rejected an unnecessary generic secret-key filter because an exact one-key override comparison already supplied the boundary; Claude agreed before editing.

In phase19v/w, both sides agreed to rename the misleading clean precision label, distinguish replay from native activation and record the judge-calibration gap. Claude challenged describing long required tails as an established adherence failure; Codex withdrew that framing. Claude also withdrew the stronger claim that mandated field names make all repeated content mandatory. No product edit followed from either hypothesis.

The [offline output audit](2026-09-08-efficiency-output-audit.json) found44,551 retained final-text characters:31,625 before the index and12,926 in the index/role tail. Only60 after-part characters matched under the narrow exact12-word-span detector. Paraphrases are not counted, required evidence can legitimately repeat, and characters are not billed tokens. Neither an adherence failure nor removable cost was established.

## Next gates

1. Freeze and run a small semantic negative judge-calibration package with known misses, false positives and correct controls, under a separate budget and receipt.
2. Demonstrate whole-query child and auxiliary accounting before the2-3task non-TP cost observation. Freeze task context, independent hidden checks and eligible-control denominators first.
3. Select one measured cause for L2; preserve protected Analysis, reviewer floors and TP gates. L2-L4 are not started. No new mode, role deletion or default downgrade follows from this reference.

The original fixed109 implementation remains historical Windows evidence. Linux/cross-platform readiness and comparative development efficacy remain unestablished.
