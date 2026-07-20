# Benchmark contract: where a score is safe, and where it never appears

Cressetide's live work — a real plan, a real implementation, a real review, a real verdict — never
stores or reports a score, pass-rate, or percentage. Not in the final report, not in the run ledger,
not in `run-consolidate.mjs`'s digest. This document states why, states the **one** place a score is
permitted, and points at the mechanisms that already exist there so a future benchmark effort extends
them instead of duplicating or contradicting them. It defines no new command and adds no new fixtures
— this is a policy document only.

## The rule: scores belong only to a closed world

A score (a pass-rate, a recall percentage, an average) is an estimate that declares a direction and
invites optimization toward it. That is fine — even useful — when the thing being measured is a
**closed world**: frozen fixtures, hidden acceptance checks, and a fixed comparison between two
specific versions (version A vs. version B on the same frozen inputs). A closed world is one where the
**denominator cannot be redefined mid-measurement** — the set of cases, the pass/fail rule, and what
counts as "the same test" are all fixed before the run starts. That fixedness is what makes
redefinition-gaming degrade to bounded overfitting to a known, static target, rather than an open-ended
drift in what "counts."

Cressetide's live work is the opposite of a closed world: every task is a different repository, a
different requirement, a different scope, reviewed by the same actor that (mostly) implemented it.
There is no fixed denominator — no stable population of "all tasks" to measure a rate against — and no
independent judge outside the loop. A score computed over open, ever-changing live work does not
degrade safely; it invites the scope, risk tier, or acceptance criteria of the *next* task to bend
toward whatever keeps the number looking good. That is precisely the job a **count** (an event fact
that invites investigation, not optimization) does better and more safely — see
`references/run-ledger.md` and `docs/advanced/retro-practice.md` for how counts, not scores, drive this
repo's own cross-run learning loop.

**So: live-work artifacts never carry a score, rate, or percentage.** The final report
(`references/final-report.md`), the run ledger and its `close` events (`references/run-ledger.md`), and
`run-consolidate.mjs`'s digest all report only event facts — and, when a retro looks back over several
of them, **paired counts** (e.g. a first-pass-clean count is never shown without its escaped-rework
counterpart in the same breath, `docs/advanced/retro-practice.md`). None of the three ever reports a
computed rate.

## The one place a score is permitted: a closed-world benchmark

A score is legitimate only when all three closed-world conditions hold at once:

1. **Frozen fixtures.** The input set is fixed before measurement starts and does not change based on
   how the measurement is going.
2. **Hidden acceptance checks.** The pass/fail rule for each fixture is decided independently of the
   thing being measured, so the measured system cannot see or influence its own grading criteria.
3. **Version-A-vs-version-B comparison.** The score's job is to compare two specific, named versions
   against the same frozen fixtures and checks — not to stand alone as an absolute "quality number."

Cressetide already has two mechanisms that live inside (or adjacent to) this closed world, and a
benchmark effort should **distinguish itself from and cite these accurately, not duplicate or replace
either one**:

- **`eval/cases/*.json` + `eval/run-eval.mjs`.** A deterministic dataset/rubric validator for the four
  public capabilities (`vigil`, `salvage`, `map`, `doctor`). Each case has bounded fictional evidence
  plus literal `requiredTerms` / `forbiddenTerms`; `eval/run-eval.mjs --responses <dir>` checks that a
  candidate response contains the required terms and avoids the forbidden ones — **literal term
  matching, not semantic scoring** (`docs/evaluation.md`). This runs in CI via `npm run eval`. It
  validates fixture/rubric *integrity*, not model behavior against them, by design.
- **`eval/manifest.yaml` + `eval/fixtures/*.md` + `eval/baseline.md`.** A small, committed,
  hand-validated behavioral regression suite that catches **reviewer prompt-drift**: each fixture is
  blind-reviewed by the current `code-reviewer`, then scored by an independent judge against a
  ground-truth `expected: hit | clean` label, and the `hit` recall / `clean` precision is compared to
  the recorded `baseline.md`. This is **on demand, not CI** — it costs model tokens, so it runs when a
  reviewer/agent prompt changes (or periodically), never as a per-commit gate (`eval/README.md`).
  Critically, `eval/README.md` **explicitly disclaims** being a real-world benchmark, in its own words:
  *"It is NOT a real-world recall benchmark. The set is small and partly synthetic; it measures
  stability against prompt edits, not a real-world catch rate."* That disclaimer is the reason this
  document exists: cressetide already has a rigorous, LLM-judged, scored suite, and it is explicit that
  the suite is not the thing a "does cressetide actually work on real tasks" benchmark would be.

## How a future closed-world benchmark would differ

A real-world outcome benchmark, if one is ever built, would score something the existing suite
deliberately does not: **real task outcomes**, not reviewer-prompt stability on synthetic fixtures. Its
fixtures would be **distilled from real, already-closed ledger runs** (`references/run-ledger.md`) —
runs whose `close` disposition is already known (`escaped` / `survived` / `superseded` /
`building-upon`) — frozen into a fixed benchmark set, graded by hidden acceptance checks independent of
the implementation being scored, and compared version-A-vs-version-B (e.g. a prompt/workflow change
before and after). That is a materially different instrument from `eval/manifest.yaml`'s fixtures,
which are hand-authored synthetic code snippets built to probe reviewer-prompt stability, not real
task histories. Building it is future work; this document does not build it, name a command for it, or
add fixtures toward it — it only states the boundary a future benchmark must respect: frozen inputs,
hidden checks, A-vs-B comparison, distilled from *closed* ledger history, never live/open work.

## Summary

| Context | Scores/rates permitted? | Mechanism |
|---|---|---|
| Live vigil run (final report, ledger, `run-consolidate.mjs`) | Never | event facts + counts only |
| Retro over several closed runs (`docs/advanced/retro-practice.md`) | Never a lone rate — paired counts only | cases + paired counts |
| `eval/cases/*.json` + `eval/run-eval.mjs` (CI) | N/A — deterministic term-presence check, not a score | `npm run eval` |
| `eval/manifest.yaml` + fixtures + `baseline.md` (on demand) | Yes, scoped to prompt-drift stability, explicitly not a real-world benchmark | `eval/README.md` |
| A future closed-world outcome benchmark (not yet built) | Yes, under frozen fixtures / hidden checks / A-vs-B | distilled from closed ledger runs |
