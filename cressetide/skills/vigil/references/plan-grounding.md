# Plan Grounding & Intent Sharpening

A conditional, read-only step that runs **before plan approval** on high-risk work. It strengthens the plan with two kinds of *new information* — the code's reality and a sharpened contract — and surfaces them at the plan gate so the user approves with the full picture. It does **not** replace the human approval, and it does **not** add reviewers.

This step addresses two high-impact review risks (see `references/reviewer-selection.md`, *Multi-lens review rationale*): **omission** (missing behavior versus the intent) can originate in the plan, and reviewers cannot judge contract-dependent behavior without contract-level intent in the Review Packet. An omission is cheapest to fix at the plan, before any code is written; sharpen the intent before approval.

## When it runs (risk gate)

Run this step only when the task is high-risk, **reusing the existing risk definitions** in `references/reviewer-selection.md` — do not invent a new standard. Trigger when any of these holds:

- the task is in the **High risk** row of the Risk Matrix (auth/authz, schema/migration, destructive operations, cross-module orchestration, deploy/rollback, external integration, ambiguous user-facing UX); or
- the task is **correctness-critical** (parsing, numeric/encoding/overflow handling, concurrency, security/trust boundaries, data integrity, or any non-obvious-edge path); or
- the selection already triggers a correctness- or safety-relevant conditional reviewer (`security-reviewer` / `architecture-reviewer` / `operability-reviewer`) — that is itself a high-risk signal.

Default to **skipping** it for low/medium-risk work (a checkbox, a copy edit, a rename). A false trigger does not just cost tokens — it makes the user wait before approval — so bias toward not running it, consistent with the usability-over-strictness principle. The taxonomy is the same one the orchestrator applies when selecting reviewers, evaluated here at plan time — not a second, separate standard.

Skipping this step also means low/medium-risk work does not get this Stage A version of the reconciliation scan (`references/run-ledger.md`) — it instead gets a lighter, main-thread-only scan wired directly in `SKILL.md`'s lifecycle step 2 (per the approved plan's scan-scope decision); see there for that path.

## Stage A — Grounding (bring the code's reality)

Follow `Detect → Use → Else-Disclose` (see `references/external-capabilities.md`).

- **Use** a single, focused read-only grounding subagent — **prefer the dedicated `navigator`** (`agents/navigator.agent.md`; it runs this Stage A and also returns a draft plan, an advisory panel pre-selection, and a `design.md` detection), else a generic `Explore` pass — not a fan-out, because the user is waiting to approve.
- **Inputs**: the restated requirement plus the affected area/files.
- **Outputs (Grounding Findings, each anchored to `file:line` evidence)**:
  - the real call sites and entry points of the code being changed;
  - the edge/boundary handling that **already exists** (so the plan does not redo what is covered);
  - the real contracts, types, and data shapes touched;
  - adjacent code that constrains the change (invariants, locks, transaction boundaries);
  - the **callers/callees of the touched symbols** — a lean `Grep`-level coupling scan (not a full call-graph) — so the plan does not miss coupled code that must change too (a top omission source);
  - the unknowns the scout could **not** confirm (state them honestly; do not guess);
  - for UI / design-system / interaction scope, whether a `design.md` design contract exists and applies (`references/design-spec.md`) — and, when one is needed but absent, a recommendation to establish one (the scout detects and recommends; it does not author it).
  - the disposition of any still-open ledger runs whose observation window overlaps this task's touched files (`references/run-ledger.md`) — run `run-reconcile.mjs scan` and dispose each flagged candidate with a reason (escaped / survived / superseded / building-upon); ambiguous overlap is reported as `needs human review`, never silently resolved to clean.
- **Anti-hallucination**: a claim about the code is usable only with concrete `file:line` evidence; mark anything unverified as unverified and do not fold it into the contract (the same evidence discipline as `references/reviewer-common.md`).
- **Else** (no grounding subagent capability — neither `navigator` nor `Explore`): the main thread does a best-effort local grounding (read the key files, locate call sites, and still run `run-reconcile.mjs scan` itself per `references/run-ledger.md`) and **discloses** that grounding ran without an independent subagent, with the resulting lower coverage and remaining uncertainty. Never hard-depend on the subagent; never error on its absence.

## Stage B — Intent Sharpening + Edge Enumeration (main thread)

The main thread synthesizes the following from Stage A's facts plus the requirement. Its job is to **produce artifacts** (a contract and checklists), **not** to issue an opinion or a verdict — a second opinion on the same plan brings no new information and is the failure mode this step avoids.

Produce:

1. **Sharpened contract** — replace each vague verb in the requirement with a checkable must-do, anchored to the requirement or Stage A evidence. (E.g. "refresh when the token expires" → "expired = within 30s of expiry; refresh before the call, not after a 401; if refresh itself fails, route to login; concurrent refreshes serialize under a lock and fire once".)
2. **Implied edge checklist** — enumerate the boundary inputs this change implies (empty / zero / overflow / very-large, multibyte / non-ASCII, null / empty / duplicate / multiple, malformed, by-value vs receiver, concurrent), each tagged with the expected result **or** "needs user decision".
3. **Open product decisions** — every ambiguity the contract surfaces becomes an `AskUserQuestion` option at the plan gate. Do **not** decide product behavior unilaterally.
4. **Assumption register** — first **enumerate** the points where the requirement underdetermines behavior (the same enumerate-then-tag discipline as item 2's implied edge checklist — do not rely on ambiguities "surfacing" on their own), then tag each point one of two ways: **ask** (product-impacting divergence — reasonable interpretations differ in user-visible behavior — routed to item 3's `AskUserQuestion` options, and **all** ask-tagged points are asked: batch across further `AskUserQuestion` rounds when they exceed one dialog — a product-impacting ambiguity is never demoted to the register for volume reasons, because asking is how the user sharpens their own intent) or **record** (a non-product-impacting interpretive choice — reasonable readings do **not** differ in user-visible behavior — as an explicit assumption entry: the chosen default + the rejected alternative interpretation + the basis for choosing — a requirement quote, a repo convention, or a stated default). Silently resolving an interpretive ambiguity — baking a plausible reading into the contract without asking or recording — is a planning defect. The register is a disclosure channel, not an ask-avoidance channel.
5. **Gaps vs intent** — anything the requirement implies that the draft plan does not yet cover; fold these into the plan before presenting it.
6. **Contract-readiness check (high-risk, soft).** Before presenting the plan, assert the contract has (a) at least one *observable* acceptance criterion **and that each stated criterion is itself measurable — it has an observable pass/fail (a test, a command, or an observable state that decides it); flag any criterion with no such outcome as `not measurable`**, (b) a `must-not-change` / scope statement, and (c) a verification path for each behavior-changing criterion. If any is missing, surface a `not contract-ready` disclosure at the plan gate naming the gap, e.g.:

   `This task is not contract-ready. Missing: observable AC · a measurable outcome for criterion N · must-not-change scope · verification path.`

   Flag a criterion `not measurable` only when it has genuinely no observable outcome — never one that is merely terse but checkable (no subjective 'could be clearer').

   This is a **disclosure + request to fill**, not a hard block — the user may still approve with the gap disclosed (usability-over-strictness). It runs **only** on the high-risk path this step already gates; low/medium-risk work never triggers it.

## Where the outputs go

| Output | Routed to | Effect |
|--------|-----------|--------|
| Sharpened contract | the Review Packet's Task / Acceptance criteria / Reviewer scope (`references/review-packet.md`) — on high-risk work it **is** the user-approved acceptance criteria the arbiter checks per-item | gives every reviewer the contract-level intent required to detect omissions and spec-dependent defects |
| Implied edge checklist | the Verification Gate's "exercise the change's risky inputs" (`references/verification-gate.md`) and the `test-reviewer` scope (`references/review-packet.md`) | the edge tests are enumerated at plan time, not improvised at verification time |
| Open product decisions | `AskUserQuestion` at the plan gate | the user decides the product behavior |
| Assumption register | the contract body's Assumptions section + the optional machine-block `assumptions` array (`references/task-contract.md`) and the Review Packet's *Assumptions* field (`references/review-packet.md`) | non-product-impacting defaulted interpretations are visible at the plan gate and become first-class review targets instead of hardening silently into the contract |
| Gaps vs intent | the plan itself, before `ExitPlanMode` | omissions are closed before any code is written |
| Reconciliation dispositions | `SKILL.md`'s Implementation step 3 ("Execute reconciliation dispositions"), post-approval | closes out prior runs' observation windows using this run's evidence — `navigator` only disposes with reasons; it never writes `close`/`expire` itself (read-only invariant preserved) |
| All of the above | presented at `ExitPlanMode` | the user approves seeing the real call sites, the precise contract, the implied edges, and the open decisions |

## Invariants

- **Read-only.** This step runs in plan mode and writes nothing to the working tree; the `plan-gate.js` hook still applies.
- **Assists, never replaces, human approval.** Its outputs are material for the user's decision at `ExitPlanMode`; ambiguities become `AskUserQuestion`; it never auto-decides product behavior.
- **Depth, not breadth.** It does not change reviewer selection (still the smallest sufficient set) and adds **no new reviewer** — Stage A runs as a single focused grounding subagent (`navigator`, else `Explore`), not a fan-out, and Stage B runs on the main thread. `navigator` is a *planning* agent (it only *recommends* the panel), never a reviewer added to it.
- **Never a hard dependency.** With no exploration subagent, the main thread falls back to local grounding and discloses; absence never raises an error.
- **Language.** Per `SKILL.md` *Language And Text Integrity* — user-facing text follows the user's language; technical contracts verbatim.

## Deep mode

In a detected/opted-in deep mode (`references/deep-mode.md`), Stage A grounding may run as a read-only Workflow agent node; Stage B and the open-decision gate are unchanged. This step does not change reviewer selection in either mode.
