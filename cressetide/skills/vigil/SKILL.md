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

- `references/review-packet.md`: before spawning reviewers or handing work to a reviewer.
- `references/task-contract.md`: before writing the post-approval `.ctide/output/contract.md` artifact and before running `scripts/contract-check.mjs` — the persisted per-run contract schema + lifecycle.
- `references/reviewer-common.md`: the shared reviewer contract (severity vocabulary, scope discipline, base output) referenced by every reviewer.
- `references/reviewer-selection.md`: before selecting or re-running a review panel.
- `references/plan-grounding.md`: before presenting the plan on high-risk work (the conditional plan-grounding / intent-sharpening step; its Stage A grounding runs via the `navigator` agent, else `Explore`).
- `references/design-spec.md`: before planning or reviewing UI / design-system / interaction work — the `design.md` design contract (detect / consume / draft lifecycle + the three-layer arbitration with `ui-ux-pro-max` and the `ui-ux-reviewer` baseline).
- `references/expand-migrate-contract.md`: before planning or reviewing a large/breaking schema, API, or interface change — the expand → migrate → contract staging pattern.
- `references/runtime-policy.md`: before using subagents, waiting on agents, or closing agents.
- `references/verification-gate.md`: before verification or failure-memory updates.
- `references/final-report.md`: at final delivery, for the end-of-run report format (compact by default; `--report full` for the detailed tables).
- `references/external-capabilities.md`: before using any MCP tool, external subagent, or external skill (including `ui-ux-pro-max` for UI work).
- `references/deep-mode.md`: before expressing the panel as a deterministic Workflow — Tier-1 enforcement auto-engages on high-risk or correctness-critical work when the Workflow capability is present (opt-out); Tier-2 deeper verification (adversarial checks, max effort) is explicit opt-in.
- `references/browser-evidence.md`: before driving a live browser for UI verification — Detect → Use → Else-Disclose for the Chrome extension; in `--deep` + UI in scope the live drive is required (else a disclosed gap).
- `references/app-launch.md`: bringing a needed live process up in `--deep` (delegates to `/run`; discloses; tears down only what it started); standard mode never auto-launches.

Do not deep-chain references. All required workflow references are linked from this file.

## Plan Gate (approve before any change)

Non-trivial work must pass an explicit plan gate before implementation begins. The gate has two layers: ctide drives Claude Code's native plan mode so the planning phase is genuinely read-only, and a plugin PreToolUse hook (`plan-gate.js`) denies Write/Edit/MultiEdit/NotebookEdit while permission mode is `plan`.

1. **Enter plan mode first**, following Detect → Use → Else-Disclose (see `references/external-capabilities.md`, "Native plan mode"):
   - If the session is already in plan mode, proceed.
   - Else if the runtime exposes a plan-mode entry (e.g. EnterPlanMode), enter it, then do requirement understanding and planning read-only.
   - Else (no programmatic switch), proceed read-only by discipline and **disclose** that the hook's read-only enforcement is not active this session; recommend setting a default plan mode in settings for a hard guarantee.
2. Run requirement understanding and planning while in plan mode. The hook enforces read-only for **structured edit tools** (Write/Edit/MultiEdit/NotebookEdit) and blocks **obvious Bash writes** (redirect-to-file, `tee`, `sed -i`, `perl -i`, `truncate`, `dd of=`, `ln`, `git apply`) — but the Bash check is a narrow tripwire, not full shell coverage (interpreter one-liners like `node -e fs.writeFileSync(...)` / `python -c "open(...,'w')"` and other non-obvious writes still slip), so do not use Bash to modify the working tree during planning; use read-only Bash only.
3. Present the plan for approval using **ExitPlanMode**. Only proceed to implementation after the user approves.
4. When a decision has discrete options (e.g. competing designs, ambiguous business behavior, destructive vs. non-destructive paths), surface them with **AskUserQuestion** rather than guessing. On high-risk work, the plan-grounding step (`references/plan-grounding.md`) enumerates these options and the change's implied edge inputs so your approval is informed.
5. Do not spawn `implementer` until the plan is approved and plan mode is exited.
6. On the high-risk plan-grounding path, run the **contract-readiness check** (`references/plan-grounding.md`, Stage B): if the contract lacks an observable AC, a must-not-change scope, or a per-criterion verification path, disclose `not contract-ready` and the missing piece at the gate before approval. It is a soft disclosure (the user may still approve), risk-proportional (high-risk only), and never blocks low/medium work.

## Core Rules

- Understand before coding.
- Plan before coding, and get the plan approved at the plan gate.
- For non-trivial work, turn the requirement into a short, user-approved **acceptance criteria** checklist at the plan gate, and have `arbiter` verify each criterion before `READY` (see `agents/arbiter.agent.md`, `references/verification-gate.md`).
- Make the smallest safe change.
- Modify only requested scope unless a broader change is required for correctness, safety, buildability, or testability.
- Verify with commands, browser evidence, text-integrity checks, or explicit blockers as applicable.
- Use the smallest sufficient formal review panel when subagents are authorized and available.
- Keep cost risk-proportional and **user-adjustable**: the panel auto-scales to risk by default; `--lite` forces the smallest panel and skips the costlier deep-mode **Tier 2** (with a safety floor — see `references/reviewer-selection.md`), and `--deep` (Tier 2) / `--no-deep` tune deep mode. State the selected panel + cost tier up-front at the plan gate and recap it in the final report.
- Do not spawn non-applicable reviewers merely to satisfy process.
- Do not use full thread history as the default reviewer input.
- Do not present local self-review as formal multi-agent review.
- Do not mark work ready while blocker or unresolved major findings remain.
- Do not create or edit a `ctide.*` safety-guard setting (`contractGuard` / `destructiveGuard` / `planGate` / `preserveOnCompact`) to unblock an action a guard just asked or denied about — treat the ask/deny as a stop condition and wait for the user's actual response; a clear, freestanding, unrelated human instruction to configure a project this way is still honored normally.
- For any optional external capability (MCP / external subagent / external skill), detect availability first; if unavailable, do the work locally and disclose the gap. See `references/external-capabilities.md`.
- Record failure memory for any execution abnormality that blocks, disrupts, or forces repair of the originally intended method; follow `references/verification-gate.md` before writing.
- Identify the repository's architecture and primary language/framework first, then implement to that language/framework's official best practices and the repo's existing conventions. When the existing code diverges materially from those best practices, surface it at the plan gate with concrete correction suggestions rather than refactoring beyond the requested scope; broad refactors require explicit user approval and are not bundled into the current task.

## Language And Text Integrity

For human-readable repository content, follow the file's and repository's existing language and the user's language; default to English when none is determinable.

The workflow's own **user-facing communication** — the plan presented at the plan gate, AskUserQuestion prompts, reviewer findings surfaced to the user, and the final summary — **follows the language the user is communicating in** (default to English when undeterminable). This is language-adaptive, not a fixed language: match the user rather than defaulting to English when the user writes in another language.

Preserve technical contracts **verbatim regardless of the surrounding language**: identifiers, API fields, database objects, configuration keys, file names, commands, protocol values, and reviewer/agent names. In particular, **never translate the machine-checked tokens** — the severity labels `blocker` / `major` / `minor`, the verdict `READY` / `FIX REQUIRED` / `NOT READY`, and the sentinel tokens `ctide:delivery=held|shipped`, `ctide:verify=pass|fail|unrun|na`, and `ctide:panel=full|substituted:<names>` — they are matched literally by tooling (e.g. the Stop orchestration-check hook) and a translation silently breaks the contract.

When touching human-readable text, check for mojibake, replacement characters, broken mixed encodings, unsafe localization of technical contracts, and inconsistent rendering of the target language. Prefer the smallest safe text fix and do not force broad encoding conversion unless the root cause and compatibility risk are understood.

## Lifecycle

1. Requirement understanding
   - Restate the requirement.
   - Identify the repository's overall architecture and primary language/framework, plus existing conventions (analyzers, formatter/lint config, project style).
   - Identify inputs, outputs, business rules, constraints, edge cases, dependencies, affected users, systems, and runtime paths.
   - State assumptions and ambiguity.
   - Stop for user input (AskUserQuestion) when ambiguity materially affects business behavior, contracts, destructive operations, security posture, or user-visible UX flow.

2. Planning (plan mode)
   - For high-risk or correctness-critical work (per the `references/reviewer-selection.md` Risk Matrix), first run the conditional **plan-grounding & intent-sharpening** step (`references/plan-grounding.md`): ground the plan in the code's reality (a read-only exploration pass, Detect → Use → Else-Disclose), then sharpen the requirement into a contract-level intent plus an implied edge-input checklist. Route the sharpened contract into the Review Packet's intent, the edge checklist into the verification gate, and any product ambiguity into AskUserQuestion at the gate. It assists the approval decision; it never replaces it. Skip it for low/medium-risk work.
   - Define affected modules or files, implementation approach, data/control-flow impact, risks, verification commands, expected tests, and rollout or rollback concerns when relevant.
   - Plan to the project language/framework's official best practices and the repo's conventions. If the existing code diverges materially from those best practices, state the gap here and propose concrete corrections; do not silently refactor beyond the requested scope.
   - For UI work, include target screens, states, responsive/accessibility concerns, and browser verification target or blocker; then follow `references/external-capabilities.md` (*ui-ux-pro-max* — required on design-generation / design-system scope) and `references/design-spec.md` (`design.md` grounding; asset / `design.md` writes are post-approval).
   - Before non-trivial implementation, consult failure memory (project `.ctide/memory/FAILURE_MEMORY.md`; a legacy `ai/FAILURE_MEMORY.md` is read as fallback for that tier — see the migration duty below; otherwise `~/.claude/FAILURE_MEMORY.md`). **Reading the legacy file means you MUST also perform the one-time migration to the new path before finishing this run — unconditionally, even on a clean success; this is not optional and not satisfied by "no new entry needed"** (procedure: `references/verification-gate.md`, *Failure Memory*). The SessionStart digest is only an index — read the full relevant entries per the same section.
   - **Define acceptance criteria.** For non-trivial work, turn the requirement into a short, numbered checklist of observable / verifiable outcomes that define done, and present it **as part of the plan** for user approval at ExitPlanMode (no separate approval step). On high-risk work these *are* the plan-grounding **sharpened contract** (do not duplicate it); skip them for trivial work. Route any ambiguous criterion through AskUserQuestion, carry the approved list into the Review Packet, and the `arbiter` checks each one at the gate (step 7). The deepest release signal is not "no bugs" — it is "did what you asked, and confirmed it."
   - **State the cost up-front.** In the plan, name the selected review panel and its cost tier (lite / default / deep) so the user sees roughly what the run will cost and can adjust it (`--lite` / `--deep` / `--no-deep`) before approving — and name any reviewer expected to be **evidence-substituted** so the fast lane is visible at approval time (see `references/reviewer-selection.md`, *Lite path* and *Evidence substitution*).
   - Present the plan via ExitPlanMode **in the user's language** (keep identifiers, file names, commands, and verdict tokens verbatim — see Language And Text Integrity) and wait for approval (Plan Gate).

3. Implementation
   - Use the `implementer` subagent (only after plan approval).
   - **On `--deep` or high-risk runs only**, before spawning the `implementer` capture the current (pre-change) test-suite output to `.ctide/output/baseline-before.txt` — the baseline the regression ratchet diffs against (step 4, `references/verification-gate.md`). Run it in the **foreground** so it fully completes and releases its output pipe before proceeding (a lingering test/build child left holding the pipe stalls the run). Standard / low-risk runs skip this and the ratchet stays opportunistic. Fail-open: if the baseline cannot be produced there is simply no baseline and the ratchet makes no claim.
   - Keep the diff scoped and traceable.
   - Follow repository conventions first, then the project language/framework's official best practices.
   - For UI/frontend work, prefer `ui-ux-pro-max` design tokens/guidance when available before writing UI; otherwise implement for usability and maintainability and disclose the fallback.
   - When the approved plan establishes or changes a design contract, the `implementer` **writes / updates `design.md`** post-approval — the blessed bootstrap draft (extracted from the existing UI), or a design-system change recorded in the same PR (`references/design-spec.md`).
   - Post-approval, the `implementer` writes the **task contract** to `.ctide/output/contract.md` (`references/task-contract.md`): the JSON machine block (acceptance criteria + verification mapping, allowed/forbidden paths, must-not-change) plus the human body. Full block on high-risk; the reduced Requirement/AC/Verification subset on low/medium. It is gitignored run scratch (`references/verification-gate.md`, Artifact Hygiene), never committed.
   - Surface newly discovered risk immediately.

4. Verification
   - Run applicable build, test, lint, typecheck, migration, integration, browser, or repo-specific checks.
   - For local browser-visible UI changes, use Claude in Chrome / in-app browser or an accepted fallback and record the target, scenario, observed result, tool used, screenshot need, and focus/hover/keyboard/clipboard behavior when relevant. In `--deep` + UI in scope, driving the live browser per `references/browser-evidence.md` is a required verification step (Detect → Use → Else-Disclose; absence is a disclosed gap); standard mode stays best-effort.
   - In `--deep`, bring a needed, not-yet-running live process up per `references/app-launch.md` (delegates to `/run`; discloses; tears down only what it started); an unlaunchable app is a disclosed gap, never an error.
   - For human-readable content, run text-integrity checks.
   - When the task contract exists (`.ctide/output/contract.md`, or the legacy path pre-migration), run the deterministic `scripts/contract-check.mjs` (`node ${CLAUDE_PLUGIN_ROOT}/skills/vigil/scripts/contract-check.mjs --base <pre-implementation-ref>`) and carry its report into the Review Packet as scope/AC evidence for the `arbiter`. It is fail-open: an absent/unparseable contract makes no claim, and the `arbiter` falls back to its prose scope/criteria judgment.
   - **On `--deep` or high-risk runs** where step 3 captured a baseline: capture the post-change test output to `.ctide/output/baseline-after.txt`, run `node ${CLAUDE_PLUGIN_ROOT}/skills/vigil/scripts/regression-delta.mjs .ctide/output/baseline-before.txt .ctide/output/baseline-after.txt`, and hand the report to the `arbiter` (fail-open; `references/verification-gate.md`, *Regression ratchet*).
   - If a command or check cannot run, state the exact blocker and remaining uncertainty.
   - **A red required check gates the panel:** when a required check fails (or was claimed but never ran), return to implementation and fix it first — do not spawn the review panel on a red build. Reviewers review verified work; the panel is not a debugging aid.

5. Review panel selection
   - Always include `intent-reviewer` for non-trivial formal review — never substituted. `test-reviewer` runs by default and may be **evidence-substituted** on low/medium-risk work per `references/reviewer-selection.md` (*Evidence substitution*: every behavior-changing acceptance criterion has a demonstrated red→green test and the full required suite is green — never on High-risk / correctness-critical / deep-mode work); disclose every substitution (plan-gate cost line, final report, `ctide:panel=` sentinel). The same section's 1C clause lets the `arbiter` review a qualifying tiny diff in-packet instead of spawning `code-reviewer` (disclosed).
   - Add conditional reviewers only when their risk criteria apply.
   - The panel size is risk-proportional and user-adjustable: `--lite` forces the smallest sufficient panel (core + `code-reviewer` when code changed) and skips deep-mode Tier 2, except it keeps a directly-relevant safety reviewer when a high-risk signal is present and discloses it (see `references/reviewer-selection.md`, *Lite path*).
   - Prepare a Review Packet before reviewer handoff, and fill the "Shared reviewer contract" block into each handoff verbatim (a spawned reviewer cannot reach `references/reviewer-common.md` by path).
   - Read `references/review-packet.md` and `references/reviewer-selection.md`.

6. Parallel review
   - Run selected reviewers in parallel when possible and authorized.
   - If runtime or policy prevents subagent use, state that limitation and continue with local evidence without calling it formal multi-agent review.
   - **Prefer deterministic enforcement on high-risk work.** With the Workflow capability on high-risk / correctness-critical work, express the panel + arbiter barrier as a deterministic Workflow — deep-mode **Tier 1** (opt-out `--no-deep`, ≈ standard cost); **Tier 2** stays explicit opt-in (`--deep`). `references/deep-mode.md`.
   - Read `references/runtime-policy.md` before spawning agents.

7. Conflict resolution and arbiter
   - Compare reviewer findings by evidence, not tone.
   - Overlap ownership (`architecture-reviewer` = structure/boundaries; `code-reviewer` = local implementation quality): `references/review-packet.md`, *Reviewer-Specific Scope*.
   - Run `arbiter` only after selected reviewers finish.
   - `arbiter` decides `READY`, `FIX REQUIRED`, or `NOT READY` and whether failure memory is required.
   - `arbiter` **checks each user-approved acceptance criterion** (met / unmet / deferred); an `unmet`, non-deferred criterion blocks `READY` (see `agents/arbiter.agent.md`).

8. Auto-fix loop
   - If verdict is `FIX REQUIRED` or `NOT READY`, fix concrete findings, rerun relevant verification (only the failing / changed-path checks, not the full green suite — see `references/verification-gate.md`, *Repair-iteration scoping*; the full required set is re-run once for the final pre-`READY` confirmation so `ctide:verify=` still rests on a real full-suite green), rerun only affected reviewers, rerun `arbiter`, and repeat until `READY` or clearly blocked.
   - If a fix introduces a new risk category, add the corresponding conditional reviewer.
   - On evidence-substituted work: if `intent-reviewer` reports a blocker/major, or the `arbiter` judges a coverage gap, spawn the substituted reviewer before `READY` (`references/reviewer-selection.md`, *Evidence substitution* — escalation; a fast lane, not a waiver).
   - **Validate each blocker, then tag each fix** — the `arbiter` confirms each `blocker` with one independent check and tags each applied fix Safe / Extended-Safe / Residual (a Residual fix is never auto-applied): `agents/arbiter.agent.md`, *Auto-fix loop rules*.
   - **Iteration cap:** if the same blocker category persists across two consecutive iterations, produce a Stuck Summary and stop. This is a hard cap, not "loop until solved" — surface the blocker for the user rather than spending unbounded iterations/tokens.
   - **Long-run progress ledger (optional).** On a long multi-iteration run, keep a one-line-per-step ledger at `.ctide/output/progress.md` (`<sha> · <step> · verify=<pass|fail> · <verdict-so-far>`); after a compaction, re-read it (and `git log`) before redoing work. Kept, gitignored (`references/verification-gate.md`, *Artifact Hygiene*); the `compact-fidelity.js` hook re-injects a post-compaction re-establish reminder.
   - **Cost control:** Tier 1 needs no confirmation; confirm with the user before any **Tier-2 / opus-heavy escalation** (`references/deep-mode.md`; manual-only invocation — README cost note). A user-enabled, available Codex may give one independent diagnosis before declaring stuck; otherwise continue locally and disclose (off by default; absence never errors — `references/external-capabilities.md`).

9. Final delivery
   - Follow the final output contract in `references/final-report.md`: one report, **compact by default**; `--report full` opts into the detailed tables; machine-checked literals stay plain words, and the three-sentinel footer is the last lines in both renderings.
   - Leave the working tree clean: remove temporary verification scaffolding and do not commit the workflow's runtime output (e.g. `FAILURE_MEMORY.md`) into a distributed tool/plugin repo — see Artifact Hygiene in `references/verification-gate.md`.
   - The compact default covers what changed (Summary), verification, findings, and the final verdict; Files Changed, assumptions, missing tests, risks, and the failure-memory decision surface under `--report full`. A required-but-unavailable external capability is still disclosed in the compact report as a verification gap (see `references/final-report.md`), and the failure-memory *write* itself still happens regardless of report mode (per `references/verification-gate.md`).
   - **End the final summary with a machine-readable delivery line** so the Stop hook reads your decision deterministically instead of inferring it from prose (this prevents false "verdict not honored" reminders, in any language): `ctide:delivery=held` when you are **not** delivering because a `FIX REQUIRED` / `NOT READY` verdict stands (or you are otherwise stopping/holding), or `ctide:delivery=shipped` when the verdict is `READY` and you are delivering. Keep the literal `ctide:delivery=` token verbatim (it is machine-checked, like the verdict tokens).
   - **Also emit the verification rollup** `ctide:verify=pass|fail|unrun|na` on its own line, adjacent to the delivery line, so the Stop hook can deterministically check that a red or unrun required check gated delivery rather than inferring it from prose: `pass` only when every required check (build/test/typecheck on behavior-changing code) actually ran and exited zero, `fail` when a required check exited non-zero, `unrun` when a required check was claimed but never actually ran, `na` when no command checks were required. The command exit status is authority over reviewer prose — a `fail` / `unrun` required check is incompatible with `READY` and shipping. Keep the literal `ctide:verify=` token and its values verbatim (machine-checked, like the verdict tokens).
   - **Also emit the panel line** `ctide:panel=full|substituted:<names>` on its own line, adjacent to the other two sentinels, stating which review panel actually ran: `full` when the full selected panel ran, or `substituted:` plus the comma-separated lowercase reviewer names that were evidence-substituted (e.g. `ctide:panel=substituted:test-reviewer` — see `references/reviewer-selection.md`, *Evidence substitution*). Emit it on every run that emits the other sentinels; keep the literal `ctide:panel=` token and the names verbatim (machine-checked — the Stop hook exempts a disclosed, eligible substitution from its panel advisory only via this line).

## Cressetide 名稱與 Map 擴充

- 本 skill 的公開名稱與指令固定為 `vigil`／`/ctide:vigil`；手動啟動語意完整保存在 `references/manual-invocation.md`，不另建立 `run` skill。
- 進入規劃前，必須套用 `../map/references/vigil-map-overlay.md` 中的 Map grounding 規則：讀取 `.ctide/map/SYSTEM_MAP.md`、檢查其新鮮度，並把 Map 當作證據路由而非權威。The Map is evidence routing, not authority.
- Map 缺漏或過期時，先做 lean repository reconnaissance；任何行為變更仍須 human approval，並由既有 verification、review 與 repair loop 判定。
- 這個擴充只承載已核准的 Cressetide skill 名稱與 Map 架構；其餘 lifecycle 以上游映射內容為準。
