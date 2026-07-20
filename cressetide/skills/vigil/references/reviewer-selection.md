# Reviewer Selection

Select the smallest sufficient panel that preserves release quality. Expand only when risk increases or evidence shows a missing discipline.

## Core Reviewers

For non-trivial formal review:

- `intent-reviewer` — always runs, never substituted: it is the only omission lens ("what is missing vs the intent"), and execution evidence cannot answer that question.
- `test-reviewer` — runs by default; on low/medium-risk work it may be **evidence-substituted** when the *Evidence substitution (fast lane)* conditions below hold (disclosed, escalatable).

## Conditional Reviewers

Add `code-reviewer` when the task touches (except a qualifying tiny diff, which the *Evidence substitution* 1C clause below lets the `arbiter` review in-packet instead — disclosed):
- non-trivial source-code changes
- maintainability-sensitive refactors
- framework or library usage
- async, concurrency, cancellation, or resource lifecycle handling
- error handling, logging, configuration patterns — when `catch`/`except`/retry/fallback paths change, `code-reviewer` runs its **silent-failure lens** (empty catch, swallowed/broad catch, prod fallback-to-mock, silent retry exhaustion, log-and-continue; see `agents/code-reviewer.agent.md`)
- data access, serialization, mapping, or performance-sensitive paths
- code-quality or simplification claims on changed paths

Add `security-reviewer` when the task touches:
- authentication or authorization
- input validation, parsing, deserialization, or injection risk
- secrets, tokens, credentials, or unsafe logging
- trust boundaries, data exposure, external calls
- filesystem, system, privilege-sensitive, or destructive behavior

Add `architecture-reviewer` when the task touches:
- cross-module structure
- boundaries, layering, orchestration placement
- significant refactors or new abstractions
- dependency direction or structural maintainability

Add `operability-reviewer` when the task touches:
- background jobs
- retries, timeouts, cancellation, resilience
- logging, observability, diagnostics
- configuration, deployment, migration, rollback
- external dependency reliability
- encoding, locale, or runtime text-processing interoperability

Add `ui-ux-reviewer` when the task touches:
- UI/frontend rendering
- interaction flow, layout, styling
- user-facing states
- component behavior
- usability, accessibility, responsive behavior
- user-visible copy or presentation quality

Use `arbiter` after selected reviewers finish.

## Risk Matrix

- Low risk: narrow behavior change, no contracts, no security boundary, no UI. Use core reviewers plus `code-reviewer` if code changed.
- Medium risk: shared behavior, data flow, UI workflow, background behavior, or config changes. Add the directly relevant conditional reviewers.
- High risk: auth/authz, schema or migration, destructive operations, cross-module orchestration, deployment/rollback, external integration, or ambiguous user-facing UX. Add all directly relevant conditional reviewers and pause for user input when product or release safety depends on the answer.
- **Correctness-critical logic** — parsing, numeric / encoding / overflow handling, concurrency, security or trust boundaries, data integrity, or any path with non-obvious edge cases — gets **at least two independent lenses** (not a lone reviewer), since single-reviewer recall on subtle defects is low and a second lens recovers defects the first rationalizes as fine (see *Multi-lens review rationale*).

## Lite path (cost floor)

The Risk Matrix above auto-scales the panel to the task's risk — that *is* the default cost control. For a change the user knows is small, `--lite` (passed to `/ctide:vigil`) forces the **smallest sufficient panel** explicitly and skips the costlier deep-mode **Tier 2** (adversarial verification / maximum effort): core `intent-reviewer` + `test-reviewer` only (plus `code-reviewer` when code changed), no other conditional reviewers. Within that floor the *Evidence substitution (fast lane)* below still applies — it may additionally substitute `test-reviewer` out of the lite panel, only when its evidence conditions hold, disclosed as always. (Tier 1 deterministic enforcement costs ≈ the standard flow and only auto-engages on high-risk work — which `--lite` is not for.) It is the downward counterpart to `--deep` (the upward knob); the unflagged default stays risk-proportional.

**Safety floor — `--lite` does not hide real risk.** When a genuine high-risk signal is present (auth/authz, secrets, schema/migration, destructive operations, or other Risk-Matrix High signals), keep the one directly-relevant safety reviewer (`security-reviewer` / `architecture-reviewer` / `operability-reviewer`) even under `--lite`, and disclose it (e.g. "kept `security-reviewer` despite `--lite` — auth touched; the rest ran lite"). `--lite` lowers cost for genuinely low-risk work; it is a **disclosed** recall/cost tradeoff, not a license to skip a discipline the risk demands. If the task is High risk overall, tell the user `--lite` is not appropriate here rather than silently dropping coverage. When the safety floor retains a reviewer on a high-risk signal, Tier-1 deterministic enforcement still applies to that minimal retained panel — `--lite` lowers breadth and cost, not enforcement.

## Evidence substitution (fast lane)

One step below `--lite`: when the run's own execution evidence has already answered a reviewer's question, that reviewer is not spawned — automatic, disclosed, escalatable. Eligibility is **evidence completeness**, never a mechanical risk score, and only `test-reviewer` is substitutable:

- **Two conditions, both required:** (1) every behavior-changing acceptance criterion has a **demonstrated red→green test** (and at least one exists; a hollow always-green test does not count — `references/verification-gate.md`), and (2) the **full required suite is green** (`ctide:verify=pass`; `na` never qualifies — no required checks means no positive evidence). Full-suite green already implies no newly-failing test — the regression ratchet (operative on `--deep` / high-risk runs, `references/verification-gate.md`) would find nothing on a green suite — so that is not a third condition.
- **Exclusions:** never on High-risk or correctness-critical work, and never in deep mode — either tier, including work where Tier 1 auto-engages (`references/deep-mode.md`).
- **The floor:** `intent-reviewer` is never substituted (the only omission lens — execution evidence cannot answer "what is missing vs the intent"); `arbiter` is never substituted (deterministic evidence is an input to its verdict, not the verdict).
- **Disclosure:** state every substitution in the plan-gate cost line and the final report, and always emit the machine sentinel `ctide:panel=full|substituted:<comma-separated-names>` in the footer (unconditional — `full` when nothing was substituted; the Stop hook reads it).
- **Escalation:** if `intent-reviewer` reports a blocker/major, or the `arbiter` judges a coverage gap, spawn the substituted reviewer before `READY` — a fast lane, not a waiver.
- **1C — small-diff code review by the arbiter:** when a change is ~≤40 changed lines across ≤2 files with no new dependency and lint/typecheck/build green, `code-reviewer` may fold into the `arbiter`, which reviews the packet's complete diff directly and discloses that it did. Thresholds are deliberately coarse; on any boundary doubt, spawn `code-reviewer` as usual.

## Plan Grounding (high-risk, pre-approval)

The same risk signals above also gate the conditional **plan-grounding & intent-sharpening** step (`references/plan-grounding.md`), which runs *before plan approval* — it is not a reviewer. Run it when the task is High risk or correctness-critical (or already triggers `security-reviewer` / `architecture-reviewer` / `operability-reviewer`); skip it for low/medium-risk work. It adds depth at the plan stage — grounding the plan in the code's reality and sharpening the intent into a contract plus an edge checklist — **not** breadth: reviewer selection is unchanged.

## Repair Loop

- Rerun reviewers whose discipline is affected by the fix.
- Rerun `code-reviewer` after material code changes.
- Rerun `ui-ux-reviewer` after UI-related fixes.
- Rerun `security-reviewer` after trust-boundary or validation fixes.
- Rerun `architecture-reviewer` after boundary, layering, or abstraction changes.
- Rerun `operability-reviewer` after runtime, config, deployment, logging, or resilience fixes.
- Always rerun `arbiter` after reviewer findings are updated.

Do not rerun unrelated reviewers merely for ceremony. If a fix introduces a new risk category, add that reviewer for the next review pass.

## Model Tiers (single source of truth)

Most agents inherit the session model. Two run on `opus` because they are the highest-leverage, hardest-to-get-right roles: `security-reviewer` (adversarial reasoning where a miss is most costly) and `arbiter` (the release authority aggregating and adjudicating). If `opus` is unavailable, those steps fall back to the available model and must state the model used and that confidence may be reduced. Other files should reference this section rather than restating the rationale.

**Tiering down (cost, bounded — policy, not a frontmatter pin).** The cheap tier *is* the session model, reached via `model: inherit` — already the default for every agent except the two above, so on any non-`opus` session the leaf reviewers already run the cheaper model with nothing extra to do. Do **not** pin a cheaper-than-session model (`model: haiku`/`sonnet`) in agent frontmatter: that would force a sub-session model even on a Sonnet session and make a leaf a permanent cheap single reviewer — which the multi-lens rationale below rejects for correctness-critical work. The one place a deliberate down-tier helps is an **`opus` session run with `--lite`**: there the panel is already just `intent-reviewer` + `test-reviewer` (+ `code-reviewer` when code changed), and `test-reviewer` / `code-reviewer` MAY run at the session's default (non-`opus`) tier to cut cost. Keep `intent-reviewer` at `inherit` (omission/intent is the recall-critical lens), keep `security-reviewer` + `arbiter` up-tiered unconditionally, and **disclose** the per-reviewer model whenever a non-default tier was applied.

## Multi-lens review rationale

One reviewer can miss subtle defects outside its primary lens — language idioms (value/identity/receiver semantics, encoding, ownership/lifetimes, overflow), **omissions** ("what is missing vs the intent"), and spec/domain-dependent bugs. Use structure and intent context to reduce those correlated misses:

- For correctness-critical changes, do not rely on a lone reviewer — include the directly-relevant **multi-lens panel** (a defect one discipline rationalizes as "fine", another flags). The *Evidence substitution* fast lane never applies here.
- Give each reviewer the **requirement/intent**, not just the diff — omission and spec-dependent defects are invisible without it.
- Use **Deep Mode** (adversarial verification) for the hardest changes.

Breadth of lenses and intent context are the control used here; do not replace them with an instruction for one reviewer to "try harder". *Evidence substitution* (above) is consistent with this: it replaces a reviewer whose question the run's evidence has **already answered** (per-criterion red→green + a green required suite) — completed evidence, not a withdrawn lens; the two-lens rule for correctness-critical work is untouched.

## Deep Mode

Deep mode does **not** change reviewer selection — the panel is still the smallest sufficient set chosen above; the two tiers and their mechanics live in `references/deep-mode.md`. The rule owned here (stated in *Evidence substitution*, Exclusions): the fast lane never applies in deep mode — either tier, including Tier-1 auto-engaged work.
