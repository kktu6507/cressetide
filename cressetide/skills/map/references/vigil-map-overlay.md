---
name: vigil
description: Plan-approved, evidence-gated engineering loop for non-trivial software changes, from intent through verification and readiness verdict.
user-invocable: true
---

# Vigil

Use Vigil for non-trivial feature work, bug fixes, API or business-rule changes, test changes, behavior-changing refactors, UI work, data-flow changes, and production-quality validation. Do not force it onto factual answers, pure brainstorming, or genuinely trivial edits.

## Invocation

Manual: `/ctide:vigil <task>`.

Model invocation is appropriate when a request needs implementation plus verification. `--lite` selects the smallest safe panel, `--deep` adds adversarial verification, `--no-deep` declines that tier, and `--report full` requests the detailed final report.

## Loop

1. **Understand.** Restate intent, inputs, outputs, rules, constraints, dependencies, affected runtime paths, edge inputs, and ambiguity.
2. **Ground.** Read `.ctide/map/SYSTEM_MAP.md` if present. Compare its recorded commit and cited paths to the current repository. Verify the touched area directly; a Map is evidence routing, not authority. If absent or stale, disclose the gap and run lean repository reconnaissance.
3. **Plan read-only.** Use `navigator` where available. Define numbered observable acceptance criteria, must-not-change scope, assumptions, affected files, risk, reviewer panel, checks, rollout, and rollback. No working-tree writes are allowed in plan mode.
4. **Human approval.** Pause before implementation. Material product, security, destructive, data, contract, or UX ambiguity requires a user decision.
5. **Implement.** Hand the approved plan to `implementer`. Make the smallest safe diff. Do not alter a safety guard to bypass its denial.
6. **Verify.** Run applicable build, test, lint, typecheck, integration, browser, text-integrity, and deterministic checks. Exercise implied boundary inputs. Prefer one meaningful fail-first then pass test per behavior-changing criterion; disclose criteria where that evidence class is impractical.
7. **Review.** Prepare a bounded Review Packet containing intent, criteria, scope, assumptions, diff, verification, risks, exclusions, and reviewer-specific focus. Always select `intent-reviewer` and `test-reviewer`; add only applicable discipline reviewers.
8. **Arbitrate.** After reviewers report, `arbiter` checks every criterion, command evidence, panel sufficiency, findings, and residual risk, then issues `READY`, `FIX REQUIRED`, or `NOT READY`.
9. **Repair.** For a non-ready verdict, fix confirmed findings, rerun affected checks and reviewers, then rerun `arbiter`. Run the full required suite once more before `READY`. Stop with a clear stuck summary if the same blocker category survives two repair iterations.
10. **Carry learning.** Propose concise failure-memory updates for execution abnormalities with reusable prevention value. A single coordinating writer updates `.ctide/memory/FAILURE_MEMORY.md`.

## Operating references

Read only the references needed for the current phase:

- `references/task-contract.md` before approval and implementation.
- `references/verification-gate.md` before declaring checks complete, and always for `--deep`.
- `references/reviewer-selection.md` before dispatching the panel.
- `references/review-packet.md` before any reviewer handoff.
- `references/final-report.md` before the arbiter verdict and delivery report.

## Evidence rules

- Claims cite files, commands, observed behavior, or reviewer reports.
- A failed or unrun required check blocks `READY`.
- Reviewers are read-only and cannot self-register completion.
- Browser evidence supplements tests; it does not replace them.
- Human-readable text is strict UTF-8 and must be checked for replacement characters, control corruption, and mojibake.
- Optional external capabilities follow detect, use, or explicitly disclose the fallback.

## Final contract

Report summary, checks, acceptance-criteria status, findings by `blocker` / `major` / `minor`, missing tests, risks, failure-memory decision, and the final verdict. End with literal machine lines:

```text
ctide:verify=pass|fail|unrun|na
ctide:delivery=held|shipped
ctide:panel=full|substituted:<names>
```

Use `shipped` only with `READY` and a fully passing required check set. This label describes delivery of the reviewed change; it does not claim a Git push or published release.

