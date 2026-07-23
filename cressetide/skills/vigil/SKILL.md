---
name: vigil
description: "Use for non-trivial software work needing implementation, verification, selected review, repair loops, or release-readiness judgment. Triggers: feature work, bug fixes, API or business-logic changes, test changes, behavioral refactors, frontend/UI changes, data-flow changes, production-quality validation. Do not use for simple factual Q&A, pure brainstorming with no implementation intent, or trivial edits with no meaningful verification need."
metadata:
  short-description: Risk-proportional engineering workflow (plan-gated)
---

# Cressetide

Use this workflow for non-trivial software work. The goal is to understand the requirement, plan the smallest safe change, get the plan approved, implement it, verify it, review it with the right specialists, repair findings, and finish with an evidence-based readiness judgment.

This skill owns orchestration only. Agent personas and review depth live in the configured `agents/` subagents (`navigator`, `implementer`, `intent-reviewer`, `test-reviewer`, `code-reviewer`, `security-reviewer`, `architecture-reviewer`, `operability-reviewer`, `ui-ux-reviewer`, `arbiter`, `cartographer`).

## Scope

Use this skill for:
- feature implementation
- bug fixes with behavioral impact
- API, business-rule, or data-flow changes
- tests or verification updates
- refactors with behavioral impact
- frontend, UI, or user-facing workflow changes
- implementation work that should not be considered complete without verification

Do not use this skill for:
- simple factual answers
- explanations with no implementation
- pure brainstorming
- trivial one-line edits with no meaningful verification need

If the task is borderline, prefer this workflow.

## Reference Loading

Keep `SKILL.md` as the lightweight entry point. Read these references only when needed:

- `references/review-packet.md`: before reviewer spawn or handoff.
- `references/task-contract.md`: before writing `.ctide/output/contract.md` or running `scripts/contract-check.mjs`.
- `references/reviewer-common.md`: the shared reviewer contract — source of the verbatim handoff block.
- `references/reviewer-selection.md`: before selecting or re-running a panel.
- `references/plan-grounding.md`: before presenting a high-risk plan (Stage A via `navigator`, else `Explore`).
- `references/design-spec.md`: before UI / design-system / interaction work — the `design.md` contract.
- `references/expand-migrate-contract.md`: before a large/breaking schema, API, or interface change.
- `references/runtime-policy.md`: before using, waiting on, or closing subagents.
- `references/verification-gate.md`: before verification or failure-memory updates.
- `references/run-ledger.md`: before ledger appends, the reconciliation scan, or final consolidation.
- `references/experience-memory.md`: before consulting/proposing `.ctide/memory/EXPERIENCE.md` entries.
- `references/decision-record.md`: before consulting or proposing a `.ctide/decisions/` entry.
- `references/test-layer-boundaries.md`: before choosing or reviewing the test layer for a behavior-changing criterion.
- `references/language-integrity.md`: the full language / text-integrity contract behind the stub below.
- `references/final-report.md`: at final delivery (compact default; `--report full` for tables).
- `references/external-capabilities.md`: before any MCP tool / external subagent / external skill (incl. `ui-ux-pro-max`).
- `references/deep-mode.md`: the deterministic-Workflow panel — Tier-1 auto-engages on high-risk / correctness-critical work when the Workflow capability is present (opt-out); Tier-2 is explicit opt-in.
- `references/browser-evidence.md`: before driving a live browser; in `--deep` + UI in scope the drive is required (else disclosed gap).
- `references/app-launch.md`: bringing a live process up in `--deep` (via `/run`); standard mode never auto-launches.

Do not deep-chain references. All required workflow references are linked from this file.

## Plan Gate (approve before any change)

Non-trivial work must pass an explicit plan gate before implementation. Two layers: ctide drives Claude Code's native plan mode so planning is genuinely read-only, and the `plan-gate.js` PreToolUse hook denies Write/Edit/MultiEdit/NotebookEdit while permission mode is `plan`.

1. **Enter plan mode first** (Detect → Use → Else-Disclose — `references/external-capabilities.md`, "Native plan mode"): already in plan mode → proceed; a plan-mode entry (e.g. EnterPlanMode) exists → enter it; else proceed read-only by discipline and **disclose** that the hook's enforcement is not active this session (recommend a default plan mode in settings).
2. Run requirement understanding and planning while in plan mode. The hook blocks structured edit tools and obvious Bash writes, but it is a narrow tripwire, not full shell coverage (interpreter one-liners still slip) — during planning use read-only Bash only; never modify the working tree via Bash.
3. Present the plan for approval using **ExitPlanMode**; proceed to implementation only after the user approves.
4. When a decision has discrete options (competing designs, ambiguous business behavior, destructive vs. non-destructive paths), surface them with **AskUserQuestion** rather than guessing; on high-risk work the plan-grounding step enumerates these options and the implied edge inputs so approval is informed.
5. Do not spawn `implementer` until the plan is approved and plan mode is exited.
6. On the high-risk plan-grounding path, run the **contract-readiness check** (`references/plan-grounding.md`, Stage B): if the contract lacks an observable AC, a must-not-change scope, or a per-criterion verification path, disclose `not contract-ready` and the missing piece at the gate — soft (the user may still approve), high-risk only, never blocking low/medium work.

## Core Rules

- Understand before coding.
- Plan before coding, and get the plan approved at the plan gate.
- For non-trivial work, define a user-approved **acceptance criteria** checklist at the plan gate; `arbiter` verifies each criterion before `READY` (step 2).
- Make the smallest safe change.
- Modify only requested scope unless a broader change is required for correctness, safety, buildability, or testability.
- Verify with commands, browser evidence, text-integrity checks, or explicit blockers as applicable.
- Use the smallest sufficient formal review panel when subagents are authorized and available.
- Cost is risk-proportional and **user-adjustable** (`--lite` / `--deep` / `--no-deep`); state the selected panel + cost tier at the plan gate and recap it in the final report (full semantics: step 2's cost bullet).
- Do not spawn non-applicable reviewers merely to satisfy process.
- Do not use full thread history as the default reviewer input.
- Do not present local self-review as formal multi-agent review.
- Do not mark work ready while blocker or unresolved major findings remain.
- Do not create or edit a `ctide.*` safety-guard setting (`contractGuard` / `destructiveGuard` / `planGate` / `preserveOnCompact`) to unblock an action a guard just asked or denied about — treat the ask/deny as a stop condition and wait for the user's actual response; a clear, freestanding, unrelated human instruction to configure a project this way is still honored normally.
- For any optional external capability (MCP / subagent / skill), detect availability first; if unavailable, do the work locally and disclose the gap (`references/external-capabilities.md`).
- Record failure memory for any execution abnormality that blocks, disrupts, or forces repair of the originally intended method (spec: `references/verification-gate.md`, *Failure Memory*).
- Identify the repository's architecture and primary language/framework first, then implement to that framework's official best practices and the repo's existing conventions. Surface material divergence at the plan gate with concrete corrections instead of refactoring beyond the requested scope; broad refactors require explicit user approval and are never bundled into the current task.

## Language And Text Integrity

User-facing communication (the plan at the gate, AskUserQuestion prompts, surfaced findings, the final summary) follows the user's language; repository content follows the file's/repo's existing language (default English when undeterminable). Keep technical contracts verbatim; **never translate the machine-checked tokens**: severities `blocker` / `major` / `minor`, verdicts `READY` / `FIX REQUIRED` / `NOT READY`, sentinels `ctide:delivery=` / `ctide:verify=` / `ctide:panel=`. Full contract (mojibake / text-integrity checks): `references/language-integrity.md`.

## Lifecycle

1. Requirement understanding
   - Restate the requirement.
   - Identify the repository's architecture and primary language/framework, plus existing conventions (analyzers, formatter/lint config, project style).
   - Identify inputs, outputs, business rules, constraints, edge cases, dependencies, affected users, systems, and runtime paths.
   - State assumptions and ambiguity.
   - Stop for user input (AskUserQuestion) when ambiguity materially affects business behavior, contracts, destructive operations, security posture, or user-visible UX flow.

2. Planning (plan mode)
   - For high-risk or correctness-critical work (`references/reviewer-selection.md` Risk Matrix), first run **plan-grounding & intent-sharpening** (`references/plan-grounding.md`); route its **sharpened contract** into the Review Packet's intent, its edge-input checklist into the verification gate, and product ambiguity into AskUserQuestion at the gate. It assists the approval decision, never replaces it; skip it on low/medium risk.
   - Define affected modules or files, implementation approach, data/control-flow impact, risks, verification commands, expected tests, and rollout or rollback concerns when relevant.
   - For UI work, include target screens, states, responsive/accessibility concerns, and browser verification target or blocker; then follow `references/external-capabilities.md` (*ui-ux-pro-max* — required on design-generation / design-system scope) and `references/design-spec.md`.
   - Before non-trivial implementation, consult failure memory — project `.ctide/memory/FAILURE_MEMORY.md`; the legacy `ai/FAILURE_MEMORY.md` as fallback for that tier; else `~/.claude/FAILURE_MEMORY.md`. **Reading the legacy file means you MUST perform the one-time migration to the new path before finishing this run — unconditionally, even on a clean success** (procedure: `references/verification-gate.md`, *Failure Memory*). The SessionStart digest is only an index — read the full relevant entries. When `.ctide/memory/EXPERIENCE.md` exists, consult relevant `standard`-tier entries read-only (`references/experience-memory.md`; no migration duty, never auto-injected).
   - When `.ctide/decisions/` exists, consult entries relevant to this task's area (filter by `Tags`) read-only before non-trivial planning (`references/decision-record.md`) — folds into plan reasoning only, never auto-applied. If the plan would concretely reverse an `active` decision, that is an instance of Step 1's existing AskUserQuestion rule (ambiguity materially affecting business behavior), not new gate machinery.
   - **Reconciliation scan (read-only).** Run `run-reconcile.mjs scan` for still-open ledger windows (`references/run-ledger.md`): on the high-risk plan-grounding path it rides `navigator`'s Stage A, which disposes each candidate with a reason in its draft; on low/medium risk, run it directly here and dispose inline with a reason. All writes (`close`/`expire`) happen post-approval on the main thread only — single writer, same discipline as failure memory.
   - **Define acceptance criteria.** For non-trivial work, turn the requirement into a short, numbered checklist of observable / verifiable outcomes that define done, presented **as part of the plan** at ExitPlanMode (no separate approval step). On high-risk work these *are* the plan-grounding **sharpened contract** (do not duplicate); skip for trivial work. Route ambiguous criteria through AskUserQuestion; carry the approved list into the Review Packet; the `arbiter` checks each at the gate (step 7). The deepest release signal is not "no bugs" — it is "did what you asked, and confirmed it."
   - **State the cost up-front.** Cost stays risk-proportional and user-adjustable: the panel auto-scales to risk; `--lite` forces the smallest panel and skips the costlier deep-mode **Tier 2** (with a safety floor); `--deep` (Tier 2) / `--no-deep` tune deep mode. Name the selected panel + cost tier (lite / default / deep) in the plan so the user can adjust before approving, and name any reviewer expected to be **evidence-substituted** so the fast lane is visible at approval time (`references/reviewer-selection.md`, *Lite path* / *Evidence substitution*).
   - Present the plan via ExitPlanMode **in the user's language** (identifiers, file names, commands, and verdict tokens verbatim — see Language And Text Integrity) and wait for approval (Plan Gate).

3. Implementation
   - Use the `implementer` subagent (only after plan approval).
   - **Execute reconciliation dispositions (post-approval).** The main thread executes each disposition step 2 gathered: `run-reconcile.mjs close --ref <head-sha> --as <escaped|survived|superseded|building-upon> --reason <text>` for every candidate the disposing agent classified (`references/run-ledger.md`), and `run-reconcile.mjs expire` once to auto-close any no-overlap-detected, past-window runs (the one deliberate exception — no reason needed). A `needs human review` candidate is surfaced to the user instead of auto-closed via either command.
   - **On `--deep` or high-risk runs only**, capture the pre-change test-suite output to `.ctide/output/baseline-before.txt` before spawning the `implementer` — the baseline the regression ratchet diffs against (step 4). Run it in the **foreground** — a lingering test child holding the pipe stalls the run. Standard / low-risk runs skip this (the ratchet stays opportunistic); fail-open — no producible baseline means the ratchet makes no claim.
   - Keep the diff scoped and traceable.
   - Follow repository conventions first, then the project language/framework's official best practices.
   - For UI/frontend work, prefer `ui-ux-pro-max` tokens/guidance when available; otherwise implement for usability and maintainability and disclose the fallback.
   - When the approved plan establishes or changes a design contract, the `implementer` writes / updates `design.md` **post-approval** — the blessed bootstrap draft, or a design-system change recorded in the same PR (`references/design-spec.md`).
   - Post-approval, the `implementer` writes the **task contract** to `.ctide/output/contract.md` — full machine block on high-risk, the reduced Requirement/AC/Verification subset on low/medium (schema: `references/task-contract.md`); gitignored run scratch, never committed.
   - Surface newly discovered risk immediately.

4. Verification
   - Run applicable build, test, lint, typecheck, migration, integration, browser, or repo-specific checks.
   - For local browser-visible UI changes, drive the browser per `references/browser-evidence.md` (Detect → Use → Else-Disclose; the evidence fields to record live there). In `--deep` + UI in scope the live drive is a **required** verification step (absence is a disclosed gap); standard mode stays best-effort.
   - In `--deep`, bring a needed, not-yet-running process up per `references/app-launch.md` (via `/run`; discloses; tears down only what it started); an unlaunchable app is a disclosed gap, never an error.
   - For human-readable content, run text-integrity checks.
   - When the task contract exists (`.ctide/output/contract.md`, or the legacy path pre-migration), run `node ${CLAUDE_PLUGIN_ROOT}/skills/vigil/scripts/contract-check.mjs --base <pre-implementation-ref>` and carry its report into the Review Packet for the `arbiter`; fail-open — an absent/unparseable contract makes no claim.
   - **On `--deep` or high-risk runs** with a step-3 baseline: capture the post-change output to `.ctide/output/baseline-after.txt`, run `node ${CLAUDE_PLUGIN_ROOT}/skills/vigil/scripts/regression-delta.mjs .ctide/output/baseline-before.txt .ctide/output/baseline-after.txt`, and hand the report to the `arbiter` (fail-open; `references/verification-gate.md`, *Regression ratchet*).
   - If a command or check cannot run, state the exact blocker and remaining uncertainty.
   - **A red required check gates the panel:** when a required check fails (or was claimed but never ran), return to implementation and fix it first — reviewers review verified work; the panel is not a debugging aid.

5. Review panel selection
   - Always include `intent-reviewer` for non-trivial formal review — never substituted. `test-reviewer` runs by default and may be **evidence-substituted** on low/medium-risk work (conditions, exclusions, and the 1C small-diff clause live in `references/reviewer-selection.md`, *Evidence substitution*); disclose every substitution (plan-gate cost line, final report, `ctide:panel=` sentinel).
   - Add conditional reviewers only when their risk criteria apply.
   - The panel size is risk-proportional and user-adjustable: `--lite` forces the smallest sufficient panel (core + `code-reviewer` when code changed) and skips deep-mode Tier 2, except it keeps a directly-relevant safety reviewer when a high-risk signal is present and discloses it (`references/reviewer-selection.md`, *Lite path*).
   - Prepare a Review Packet before reviewer handoff, and fill the "Shared reviewer contract" block into each handoff verbatim (a spawned reviewer cannot reach `references/reviewer-common.md` by path).

6. Parallel review
   - Run selected reviewers in parallel when possible and authorized (spawn rules: `references/runtime-policy.md`).
   - If runtime or policy prevents subagent use, state that limitation and continue with local evidence without calling it formal multi-agent review.
   - **Prefer deterministic enforcement on high-risk work.** With the Workflow capability on high-risk / correctness-critical work, express the panel + arbiter barrier as a deterministic Workflow — deep-mode **Tier 1** (opt-out `--no-deep`, ≈ standard cost); **Tier 2** stays explicit opt-in (`--deep`). `references/deep-mode.md`.

7. Conflict resolution and arbiter
   - Compare reviewer findings by evidence, not tone.
   - Overlap ownership (`architecture-reviewer` = structure/boundaries; `code-reviewer` = local implementation quality): `references/review-packet.md`, *Reviewer-Specific Scope*.
   - Run `arbiter` only after selected reviewers finish.
   - `arbiter` decides `READY`, `FIX REQUIRED`, or `NOT READY` and whether failure memory is required.
   - `arbiter` also decides whether this run produced a decision worth recording, per the four signal criteria in `references/decision-record.md`.
   - `arbiter` **checks each user-approved acceptance criterion** (met / unmet / deferred); an `unmet`, non-deferred criterion blocks `READY` (see `agents/arbiter.agent.md`).

8. Auto-fix loop
   - If verdict is `FIX REQUIRED` or `NOT READY`: fix concrete findings, rerun relevant verification (only failing / changed-path checks — `references/verification-gate.md`, *Repair-iteration scoping*; the full required set re-runs once pre-`READY` so `ctide:verify=` rests on a real full-suite green), rerun only affected reviewers, rerun `arbiter`, repeat until `READY` or clearly blocked.
   - If a fix introduces a new risk category, add the corresponding conditional reviewer.
   - On evidence-substituted work: if `intent-reviewer` reports a blocker/major, or the `arbiter` judges a coverage gap, spawn the substituted reviewer before `READY` (`references/reviewer-selection.md` — escalation; a fast lane, not a waiver).
   - **Validate each blocker, then tag each fix** — the `arbiter` confirms each `blocker` with one independent check and tags each applied fix Safe / Extended-Safe / Residual (a Residual fix is never auto-applied): `agents/arbiter.agent.md`, *Auto-fix loop rules*.
   - **Iteration cap:** if the same blocker category persists across two consecutive iterations, produce a Stuck Summary (including the `arbiter`'s converging-vs-drifted judgment — `references/verification-gate.md`, *Repair-iteration scoping*) and stop. A hard cap, not "loop until solved" — surface the blocker for the user rather than spending unbounded iterations/tokens.
   - **Long-run progress ledger (optional).** On a long run, keep a one-line-per-step ledger at `.ctide/output/progress.md` (`<sha> · <step> · verify=<pass|fail> · <verdict-so-far>`); after a compaction re-read it (and `git log`) before redoing work — kept, gitignored; `compact-fidelity.js` re-injects a reminder.
   - **Cost control:** Tier 1 needs no confirmation; confirm with the user before any **Tier-2 / opus-heavy escalation** (`references/deep-mode.md`). A user-enabled, available Codex may give one independent diagnosis before declaring stuck; otherwise continue locally and disclose (off by default; absence never errors — `references/external-capabilities.md`).

9. Final delivery
   - Follow the final output contract in `references/final-report.md`: one report, **compact by default**; `--report full` opts into the detailed tables; machine-checked literals stay plain words, and the three-sentinel footer is the last lines in both renderings.
   - Leave the working tree clean: remove temporary verification scaffolding and never commit the workflow's runtime output (e.g. `FAILURE_MEMORY.md`) into a distributed tool/plugin repo — *Artifact Hygiene*, `references/verification-gate.md`.
   - The compact default covers Summary, verification, findings, and the verdict; Files Changed, assumptions, missing tests, risks, and the failure-memory decision surface under `--report full`. A required-but-unavailable external capability is still disclosed compactly as a verification gap, and the failure-memory *write* happens regardless of report mode.
   - **Decision-record write (when proposed).** When `arbiter` proposed a `.ctide/decisions/` entry (`references/decision-record.md`), the main thread writes it after the verdict — and, on supersede, updates the old file's `Status` line in the same write step — the same single-writer discipline and timing as the failure-memory write.
   - **Run ledger + consolidation (real runs only).** On a real run (same gate as the `### Live run` block), run `run-ledger.mjs append ...` (fail-open; schema: `references/run-ledger.md`) — a git/contract-derived event, never agent-typed files or head SHA. Then run `run-consolidate.mjs --json` and relay its counts, unreasoned, as a one-line `Ledger:` bullet (`references/final-report.md`) — strictly after the verdict above is locked; its output is for the user's reading only and must never be fed back into this run's own scope, risk tier, or panel.
   - End with the **three sentinel lines, adjacent**, tokens and values verbatim (machine-checked; the Stop hook reads them; full semantics in `references/final-report.md`'s footer contract): `ctide:delivery=held|shipped` — `shipped` only with `READY` and actual delivery, else `held`; `ctide:verify=pass|fail|unrun|na` — `pass` only when every required check (build/test/typecheck on behavior-changing code) ran and exited zero, exit status is authority over reviewer prose, `fail`/`unrun` is incompatible with `READY`/shipping; `ctide:panel=full|substituted:<names>` — emitted whenever the other two are; a disclosed, eligible substitution is exempt from the Stop hook's panel advisory only via this line.

## Cressetide 名稱與 Map 擴充

- 本 skill 的公開名稱與指令固定為 `vigil`／`/ctide:vigil`；手動啟動語意完整保存在 `references/manual-invocation.md`，不另建立 `run` skill。
- 進入規劃前，必須套用 `../map/references/vigil-map-overlay.md` 中的 Map grounding 規則：讀取 `.ctide/map/SYSTEM_MAP.md`、檢查其新鮮度，並把 Map 當作證據路由而非權威。The Map is evidence routing, not authority.
- Map 缺漏或過期時，先做 lean repository reconnaissance；任何行為變更仍須 human approval，並由既有 verification、review 與 repair loop 判定。
- 這個擴充只承載已核准的 Cressetide skill 名稱與 Map 架構；lifecycle 內容由 Cressetide 自身維護與演進，不再對應任何上游映射。
