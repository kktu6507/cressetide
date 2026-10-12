# Efficiency investigation — final disposition

**Decision: retain the current default and adopt neither investigated candidate. This closes the
investigation; it does not complete the efficiency roadmap.** No distributed byte changed, and none
is proposed. Two stages remain unexecuted and are labelled as such below, not as passed.

Evidence: [final native evidence](2026-09-10-efficiency-final-native-evidence.json) (root-authored;
source for the native-observation and offline-acceptance figures). The reviewer-output trial's own
numbers come from its [disposition](2026-09-09-reviewer-output-trial-disposition.md) and
[receipt](2026-09-09-reviewer-output-trial-evidence.json), and the cumulative exploratory estimate
from the [exploratory disposition](2026-09-09-efficiency-exploratory-disposition.md).

## What was decided, and what was not

| | |
|---|---|
| **Final** | Do not adopt the input-consolidation candidate. Do not adopt the reviewer-output candidate. Retain the original prompts and the current default. |
| **Not decided** | Whether the whole workflow's default configuration is economically better than an alternative. That decision was never executed. |
| **Not established** | Any measured saving, plugin efficacy, native full-flow cost, real-world benefit, cross-platform behaviour, or any GPT-6 Astra result. |

The two candidates failed for different reasons, and neither reason is "the hypothesis was
disproven". The input-consolidation candidate was **retired at design**: its built two-pair form
measured **15 bytes of 7,877 (≈0.19%)**, which is not an economic cause worth confirming. The
reviewer-output candidate was **partially tested and then terminated by its own frozen quality
stop** after **10 actual role calls** — 3 reviewer pairs, 2 pairs judged, all 4 judges hit/pass, case
3 retained unjudged, **0 confirmation calls** — at a recorded **US$1.145441** CLI estimate. Its
stop was caused by two observed candidate-arm faults; attribution to the appended guidance remains
**unestablished in either direction**. Retaining the original is what the roadmap's own decision
rules require when cost does not improve and quality is inconclusive; it does not disprove broader
context-compression hypotheses, which remain untested at any meaningful scale.

## The two native observations

Both ran on `claude-opus-5` (requested) at `xhigh`, CLI 2.1.263
(`0b35df94c1307004f07b738390bfef8dfca5e9af29aaf6517f305bf086b95b03`). Child effort was requested,
never observed. Both used the same private controller and a separately frozen synthetic fixture on
Windows. Both starting fixtures were 4 public tests, 2 pass / 2 fail. Neither produced a delivered
implementation, an approved plan, a formal panel, a verdict, or a worker hidden grade.

| | phase32 | phase33 |
|---|---|---|
| State / consistent / accepted | BLOCKED / true / false | BLOCKED / **false** / false |
| Reached | plan only | incomplete plan, one navigator in progress |
| Top-level calls | 1 | 1 |
| Elapsed | 146,244 ms | 300,477 ms (timeout) |
| Cost | **US$0.719042**, observed CLI estimate | **unknown** |
| Skill activation | matching successful result | matching successful result |
| Agent calls | 0 | 1 (`ctide:navigator`), 41 child frames |
| Closed by | global failure-memory `Glob` outside the declared read roots, refused by the CLI | child compound `Bash` refused by the guard; 300-second timeout with no final result |

**phase33's cost is unknown, not zero.** The reducer's `spentUsd: 0` is the accumulator's value in
the absence of a result and is not spend; the run was not free. `consistent: false` here is a
`final-cost-invalid` transition fault — there were no chain, binding or current-tree faults. The
parser's `missing:session-id` follows from the absent final result; the init surface and the actual
argv both carried a known session identity.

Because phase33's cost is unknown, **no total is computable**. The figures stay separate:
US$1.145441 (reviewer-output trial), US$0.719042 (phase32), and no figure at all for phase33,
against the earlier cumulative US$4.4346125 for the closed exploratory experiments. The **available**
amounts are CLI price-table estimates rather than billing; phase33's cost is **unavailable** — not an
estimate, and not zero. None is a comparison result. These are separately recorded figures, **not a
complete project-spend accounting**: phase28's US$0.518038 is not among them, and every
implementation and discussion session is excluded by construction.

## Mechanism actually observed in phase33

The plugin loaded and `ctide:vigil` activated with a matching successful result. The protected
zero-byte project memory file was read **in scope**, with no out-of-root probe — the one thing the
phase33 prompt correction targeted, and it held. The plugin elected plan-grounding Stage A and
dispatched a real `ctide:navigator`. The main thread forwarded the exact command list, the readable
roots and the temporal no-repair boundary **verbatim** into the child's prompt. The strict Bash
guard refused a non-listed compound command issued by the child actor. Two genuine `node --test`
runs, one from the main thread and one from the child, each returned 4 tests / 2 pass / 2 fail, and
the recorder classified both red exits as verification-outcome candidates rather than tool failures.

Two things this does **not** show. The child attempted
`cd "…" && node --test 2>&1 | tail -40` despite receiving the exact list verbatim: that is genuine
non-adherence to an explicit instruction **and** a consequence of our unusually strict whole-string
allowlist, which ordinary shell practice does not resemble. Both readings hold; neither excuses the
other. And the Agent result returned **async launch metadata** — the input carried no
`run_in_background` option — with progress but no completion notification, so no grounded report was
returned. Launch is not completion. **No causal relation between the refusal and the timeout is
claimed**; the counterfactual is unavailable.

One recorded artefact, not a repair: the guard's refusal text reads "this handoff allows exactly two
commands", which is hardcoded wording. Source checks confirm the configured `allowedCommands` were
used for the decision. This is stale diagnostic wording only; the frozen guard is not modified and
nothing is re-run.

## Stage status

The original Stages, Exit conditions and Decision rules in the
[roadmap spec](../specs/2026-09-08-cressetide-efficiency-roadmap.md) are unchanged.

| Stage | Label | Basis |
|---|---|---|
| L0 | **PARTIAL** | Accounting instrumentation established. Native full-flow accounting is still missing, and phase33's final cost was never emitted. Not upgraded to broadly established. |
| L1a | **CLOSED via the exit condition's explicit measurement-limit branch** | Its own exit text permits "an explicit measurement limit". No full-flow cost or final quality evidence follows. |
| L1b | **ACCEPTED, bounded** | Seven observed reviewer/judge pairs and four-case calibration. Bounded discrimination evidence, not general judge accuracy. |
| L2 | **TERMINAL, explicitly inconclusive; no accepted candidate** | The original exit condition permits evidence that "explicitly remains inconclusive", and that is the branch taken. One candidate was retired at design; the other was **selected, built and partially tested** before its quality stop. No measured avoidable cause exists, and neither candidate qualified for confirmation or adoption. |
| L3 | **UNEXECUTED, due to upstream stops** | Not passed, not failed. **No candidate qualified for held-out confirmation**: one was retired at design before selection, the other was selected, built and partially tested but stopped by its own quality gate before confirmation. Absence of an established eligible real-task dataset separately blocks real-world claims. |
| L4 | **Scoped decision FINAL; broad decision UNEXECUTED** | Final: do not adopt either candidate, retain the current default. Unexecuted: the whole-workflow default-benefit decision, which depends on L3. |

Confirmation is a precondition for **adoption**, not for declining to adopt. That is why L4 can close
finally in its scoped form while L3 remains unexecuted — and why the roadmap as a whole is **not**
complete or validated.

## What would actually be needed

- **A candidate that qualifies for confirmation** — one that survives its own quality gate with
  evidence supporting a bounded comparison. Selection alone is not enough, and one candidate was
  selected. This is not a resourcing gap.
- **Eligible closed-task records.** Any existing path holding source-bound closed-task execution,
  verification and usage records can be assessed — this is not restricted to one ledger directory.
  No eligible real-task dataset has been established and no additional path has been supplied, so
  **the data question is pending and has not been answered**; that is not a finding that no such
  records exist anywhere. They cannot be fabricated from synthetic fixtures.
- **A comparative design** with predeclared sample size, primary outcome, quality margin and
  uncertainty analysis, before any whole-workflow claim. Small exploratory runs have no authority to
  change the default or establish noninferiority.

No further experiment is proposed here, and no new gate — platform or otherwise — is introduced.
Linux was already outside this scope by the roadmap's own terms; that is unchanged, not a new
requirement.

## Chronology and authorship

Each step followed the same order: root findings → Claude read-only reasons → root adjudication →
separate bounded implementation GO → independent root verification. phase32a–f were **offline**: the
two-profile refactor, root's five counterexample findings and the later two, and offline acceptance.
The **live** phase32 plan observation ran after 32f. Its semantic adjudication — risk classification,
the plan-grounding Stage A/B obligations and the Tier-1 mislabelling — took place in **phase33a**,
with the follow-up precision points in 33b, before the phase33c GO covering the read-scope transport,
the empty-memory short-circuit and the fresh public contract. phase34a produced the read-only reasons
behind this disposition.

In the **phase33c scope** Claude authored three private files: the prompt-transport section of the
native profile, the phase33 fixture, and the profile's test file. The earlier phase32 scopes involved
a wider private file set, including the driver, the native profile, its tests, the phase32 fixture and
its design note.

Root authored the protocol, the live wrapper, all receipts and the evidence JSON, **dispatched** both
observations and ran the **independent acceptance and verification**. That is not the same as running
everything: Claude ran the offline self-checks during the phase32 turns, while every phase33 check was
root-side; and inside each observation the native **main thread and its child executed their own
recorded tool calls**. That actor distinction is what the verification-candidate and guard-refusal
evidence rests on, so it is preserved rather than collapsed.

## Validation and source preservation

Offline acceptance: phase32 **87 tests / 86 pass / 1 Windows privilege skip / 0 fail** with 26/26
root counterexamples; phase33 **90 / 89 / 1 / 0** with 26/26, plus compiled-root checks, an actual
empty-memory tamper that refuses dispatch, and a 127-file archive preserving the phase32 replay
against its original bytes. All **123 protected sources are unchanged**. Hidden checks stayed
root-frozen and unexposed, executed only on authored controls and untouched faulty starting
fixtures.

One provenance note: an earlier root audit script wrote to a fixed phase32 output path, so that
receipt is a **reconstruction** from the untouched phase32f captured output. It is accurate but it
is not the original file, and it should not be described as untouched.

## Non-claims

This disposition establishes no saving, no efficacy, no cost direction, no native full-flow result,
no real-world outcome, no cross-platform behaviour and no GPT-6 Astra benefit. Two blocked synthetic
observations on Windows, neither reaching implementation, cannot support any of those. The
investigation is complete and its decisions are final; the roadmap is not.
