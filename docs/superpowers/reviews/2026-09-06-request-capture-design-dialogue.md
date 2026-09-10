# Public request capture: reasons and correction scope

This record precedes implementation acceptance. It concerns the existing emitter, observer, committed consumer, telemetry collector and shared producer request guard. It does not approve the D controller draft or change domain authority rules. Real local Claude Code uses claude-opus-5 with xhigh effort and the existing project-only Anthropic authorization; Codex plans and independently reviews.

## Findings and prior discussion

During the read-only phase10p2 preview discussion, Claude identified that the consumer also used Object.keys and repeated request-value reads. It left that source untouched, as it was outside the released preview slice.

Codex independently reproduced a materially different emitter defect against the accepted E1 snapshot: an enumerable repoRoot getter returned isolated repository A for actual production and isolated B for the later publication. The actual emitter wrote the artifact into B and nothing into A. The probe exited1 with two reads. Both roots were checked temporary fixtures; no user repository was a destination. This demonstrates a real source/publication mismatch in the JavaScript API, not a JSON CLI exploit.

An integrated six-operation probe used constant accessors. Seed and producer each captured every field once; emitter, observer, consumer and collector reread fields. The consumer still converged in this constant-value world and the collector returned the intended task. These count failures identify capture behavior; they are not wrong domain verdicts. The test used actual production, observation, file writing and consumption.

In phase9d9, Claude inspected the source and agreed. It traced emitter production at line208 and publication-root selection at line211, separated by await. Claude explained that an accessor was one demonstration, not the only way caller values could change. Both agreed on the smallest correction: capture values once in the four affected public operations, reuse the locals across all awaits, and make their own-key guards complete. The shared producer/seed guard already captures once; change only its key coverage while preserving its specific forbidden-string and seed-task diagnostics before Symbol rejection and exact-set checks.

The phase9d9 process completed with actual exit0,12 turns,454.281 seconds. Its165-path read-only guard passed at2026-09-06T06:39:56.828Z with no changes. A Bash attempt was rejected because the tool was unavailable in that read-only invocation; no shell executed and no permission exception was granted.

## Additional independent evidence and bounded release

Before issuing the correction release, Codex reproduced the emitter defect using an ordinary mutable object: invoke emit(request) for A, assign request.repoRoot=B while production awaits, then await completion. The artifact again appeared only in B; actual exit1. No getter is required. This strengthens the evidence for the already-agreed capture fix and was included in the next release context.

Phase10q1 permits exactly five production files and their five named existing test files: changed-test-inventory-artifact, inventory-telemetry-observer, committed-batch-consumer, test-provenance-block, producer-request; tests for the first four and changed-test-inventory-producer-binding. It requires an actual two-repository mutable-object regression, focused capture/key/precedence controls, a discriminating temporary reversal, restoration and final passing targeted tests. Codex owns separate independent probes and acceptance. No controller or specification edit is included.

Lower exported APIs have similar key-guard patterns. Captured literals used by these corrected top-level callers protect their paths, but this does not establish every lower exported API's direct-call contract. That remaining consistency issue is explicitly tracked; no broad validator sweep or prototype ban is part of this slice.

The independently accepted TP1.19 preview remains unchanged. Its acceptance does not resolve this sibling issue. Implementation results and fixed-candidate acceptance will be recorded only after review and execution.

## Stable implementation submission and source review

Phase10q1 completed with actual exit0,58 turns,1510.262 seconds. The165-path guard passed at2026-09-06T07:08:59.788Z: exactly the ten released paths changed, with no outside source/test/spec changes. The accepted preview source and18-case suite retain their accepted hashes.

Codex reviewed all ten diffs against the accepted clean preview snapshot. The correction implements the agreed captures and complete own-key guards; no new blocking production issue was found in that bounded diff. Claude's final five suites total135 tests/134pass/1skip/0fail, all actual exits0. Four dependent suites total62pass, all actual exits0. The faithful old emitter boundary fails the two new source/publication regressions, actual exit1; restored final code passes.

Evidence limits: the shipped collector accessor test runs the absent-store path, not the committed consumer/after-read path. Codex's separately prepared integrated probe covers the actual committed collector. The reversal run records are for the emitter suite; the other four suites' restored passes do not establish that they ran under reversal. Claude's broader wording was corrected in the next reasons context. Neither issue changes the reviewed source result.

Independent fixed-candidate checks are the next acceptance requirement. The lower direct exported APIs have separately reproduced identity/freshness defects, retained outside q1's scope. D10's controller response is still under review and grants no controller/spec release.
