---
name: vigil
description: Manually start the Cressetide on the current task. Only runs when the user invokes /ctide:vigil.
disable-model-invocation: true
---

# Run Cressetide

Start the `vigil` workflow for the following task: "$ARGUMENTS"

Proceed through its full lifecycle: requirement understanding, planning in plan mode, plan-gate approval via ExitPlanMode, implementation with the `implementer` subagent, verification, the smallest sufficient review panel, the `arbiter` readiness verdict, and the final output contract. Honor the plan gate — enter plan mode first (per the Plan Gate's Detect → Use → Else-Disclose steps) and do not modify files before the plan is approved.

Deep mode has two tiers (see `../vigil/references/deep-mode.md`). **Tier 1** — the selected panel and `arbiter` run as a deterministic Workflow (same reviewers, same effort, just graph-enforced) — **auto-engages on high-risk / correctness-critical tasks when the Workflow capability is available**; pass `--no-deep` (or `--shallow`) in `$ARGUMENTS` to opt out. **Tier 2** — adversarial verification of blocker/major findings, maximum reasoning effort, and (when a needed live process is not already running) **bringing the app up for verification** per `../vigil/references/app-launch.md` (delegates to `/run`; discloses; tears down only what it started) — is **explicit opt-in**: request it when `$ARGUMENTS` begins with `--deep`, `deep:`, or `ultra:`. In either tier, if the Workflow capability is unavailable, run the standard prose flow and disclose that the deterministic Workflow was unavailable (the panel still runs, just model-orchestrated). Never hard-depend on it and never error when it is absent.

A downward cost knob complements deep mode: when `$ARGUMENTS` contains the `--lite` token (as a flag, not inside the quoted task text), force the **smallest sufficient panel** (core `intent-reviewer` + `test-reviewer`, plus `code-reviewer` if code changed), skip the other conditional reviewers, and skip the costlier deep-mode **Tier 2** — but keep the one directly-relevant safety reviewer and disclose it when a genuine high-risk signal is present (see `../vigil/references/reviewer-selection.md`, *Lite path*). `--lite` and `--deep` are opposite ends of the same cost knob; the unflagged default stays risk-proportional. State the selected panel and cost tier (lite / default / deep) up-front at the plan gate and recap it in the final report. A separate report-verbosity knob: when `$ARGUMENTS` contains the `--report full` token (as a flag, not inside the quoted task text), emit the detailed end-of-run report per `../vigil/references/final-report.md`; the default is the compact report.
