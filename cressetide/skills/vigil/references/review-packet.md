# Review Packet

Use a Review Packet before handing work to any reviewer. The packet is the reviewer source of truth. Do not use full thread history as the default reviewer input.

## Required Fields

- Task summary: one concise statement of the requested change.
- Acceptance criteria (user-approved): a numbered checklist of observable, verifiable outcomes that define done — approved by the user at the plan gate. The `arbiter` checks each item (met / unmet / deferred; see `agents/arbiter.agent.md`), and an unmet, non-deferred criterion blocks `READY`. They are approved as part of the plan at ExitPlanMode — not a separate approval step. On high-risk work these are the plan-grounding **sharpened contract**.
- Task contract pointer: when the task contract exists (`.ctide/output/contract.md`, or the legacy pre-migration path — `references/task-contract.md`), the packet's Acceptance criteria / In-Out scope / Verification evidence are **derived from it** (it is the single source), and the deterministic `scripts/contract-check.mjs` report is included as scope/AC evidence. Fill the packet fields from the contract; include the contract's path; do not paste the whole file.
- In scope: workflows, files, modules, or user-visible behavior reviewed.
- Out of scope: adjacent behavior intentionally not changed, plus work the plan/user explicitly **deferred**. Reviewers must treat these as intentional, not as missing-omissions (deferred ≠ missing — see the Shared reviewer contract).
- Must-not-change (invariants): the behaviors, contracts, and semantics the change must leave intact (from the plan / the task contract's `mustNotChange`). Reviewers check the diff against this list; the `arbiter` treats a violated invariant as release-blocking. Write "none stated" when the plan declared none.
- Edge checklist: the change's implied edge inputs (empty/zero/overflow, multibyte text, null/empty collections, duplicates, malformed input, concurrency — `references/verification-gate.md`). On high-risk work this is plan-grounding's implied edge checklist verbatim; on low/medium work list the few edges the change implies, or "n/a (trivial)".
- Assumptions: only assumptions that affected implementation or verification. When the task contract carries an assumption register (`references/task-contract.md`), fill this field from it; assumption entries are first-class review targets — an implementation faithful to a wrong assumption is still an omission vs intent (the `intent-reviewer` lens).
- Implementation summary: what changed and why.
- Changed files: paths and short purpose for each relevant changed area.
- Changed diff (filtered): a filtered, capped unified diff produced once by the orchestrator, given to every reviewer as a shared starting point so each reviewer need not re-run the base diff. State a **retrieval pointer** alongside it — what was trimmed (the cap, the path scope, excluded paths, any truncated hunks) and the exact command to regenerate the *same-scoped* untrimmed diff — so a reviewer who needs more follows a pointer instead of reconstructing what was dropped or running a bare `git diff` that yields a differently-scoped view. When the filtered diff is large enough that inlining it into every reviewer's packet is wasteful, the orchestrator MAY instead write it once to `.ctide/output/review/diff.patch` and hand that **path** (plus the same retrieval pointer); small diffs stay inline, and on any write failure fall back to inline. Path-vs-inline is a token/cache optimization only (it slims the per-reviewer prompt and keeps the shared prefix byte-stable — `references/runtime-policy.md`, Context Ordering); it never changes what a reviewer may read. The file is a kept run artifact, gitignored (`references/verification-gate.md`, Artifact Hygiene). This applies only to the diff; do not also spin out a separate "task brief" file — the Review Packet itself is the brief. The orchestrator produces this filtered diff by piping the base diff through the packer — `git diff <base> -- <paths> | node ${CLAUDE_PLUGIN_ROOT}/skills/vigil/scripts/pack-review-diff.mjs` — which reorders hunks by language/size, down-ranks (never removes) deletion-only/whitespace-only hunks, and adds new-side line numbers, with any `--max-lines` trim disclosed via the same regenerate pointer; it strengthens focus without ever hiding content, so the "starting point, not a cap" + path-vs-inline + regenerate-pointer contract above is preserved.
- Verification evidence: a structured per-check table — one row per check with command, check type (build / test / typecheck / lint / …), required? (yes/no), ran? (yes/no), real exit status (0 / non-zero / —), and blocked-with-reason when not run — plus a one-line summary. The `arbiter` reads the real exit status as authority over reviewer prose (see `agents/arbiter.agent.md`, "Command-evidence authority"); a single rollup is surfaced as `ctide:verify=pass|fail|unrun|na`.
- Known risks: remaining uncertainty, migration/rollback concern, external dependency, or runtime limitation.
- Reviewer scope: exact question each selected reviewer should answer.
- Context exclusions: stale decisions, abandoned approaches, or old logs that reviewers should not treat as current.
- External-capability notes: which optional MCP/skills/subagents were used or were unavailable, and any resulting verification gaps.
- Design contract (`design.md`): for UI scope, the **path** to the project's `design.md` when one exists (a pointer, not re-pasted content — `references/design-spec.md`), so `ui-ux-reviewer` judges consistency against it; "none" when absent.
- Migration status: whether this run consulted a legacy-only `ai/FAILURE_MEMORY.md` (`references/verification-gate.md`, *Failure Memory*) and, if so, whether the one-time `git mv` to `.ctide/memory/FAILURE_MEMORY.md` was actually performed — `migrated` / `NOT migrated` / `n/a` (tier 1 already existed, or failure memory was not consulted at all this run). The `arbiter` checks and reports this field; when `NOT migrated`, it names the outstanding `git mv` as a required post-verdict action for the main thread (auto-remediate — it does not block `READY`).

On high-risk work where the plan-grounding step ran (`references/plan-grounding.md`), populate the Acceptance criteria and Reviewer scope from its **sharpened contract**, and fill the Must-not-change and Edge checklist fields from its contract + **implied edge checklist** (also seeding Verification evidence / expected tests). This contract-level intent is the dominant recall lever (see `references/reviewer-selection.md`, *Recall vs precision*), so carry it into the packet rather than re-deriving a vaguer version.

## Handoff Template

```markdown
## Review Packet

Task:

Acceptance criteria (user-approved, numbered; arbiter checks each):

In scope:

Out of scope:

Must-not-change (invariants):

Edge checklist:

Assumptions:

Implementation summary:

Changed files:

Changed diff (filtered): <inline diff, or a path like `.ctide/output/review/diff.patch` for a large diff>
— Trimmed: <what was capped / path scope / excluded paths / truncated hunks>
— Regenerate (same scope): `<exact command, e.g. git diff <base>..<head> -- <paths>>`

Verification evidence (per-check table: command / type / required? / ran? / exit status / blocked-reason, + one-line summary):

Known risks:

Reviewer scope:

Context exclusions:

External-capability notes:

Design contract (design.md path, or "none"):

Migration status (migrated / NOT migrated / n/a):

Shared reviewer contract:
- Report findings as `blocker` / `major` / `minor`; do NOT emit a PASS/CONCERNS/BLOCK verdict — only `arbiter` issues `READY` / `FIX REQUIRED` / `NOT READY`.
- Severity definitions — `blocker`: clearly incorrect, materially unsafe, or otherwise release-blocking within your discipline. `major`: should be fixed before the work is considered ready, but not an outright block on its own. `minor`: worthwhile cleanup or polish; not release-blocking.
- Review only the selected scope; be thorough within it but do not invent unrelated concerns; if the task is materially underspecified within your discipline, say so explicitly; if your discipline has no material impact, mark it not applicable.
- Judge on merits, not pedigree: looking idiomatic/canonical/"intentional"/like a well-known library is not evidence of correctness. A defect is real only if you can name a concrete input or condition that yields a wrong result, leak, crash, or contract violation; then report it.
- Tag a genuine hunch `[unverified]`, never inflate it: if you suspect a defect but your read-only sandbox genuinely cannot run the input that would confirm it, you may surface it prefixed with the literal `[unverified]` (stating what would confirm it) but NOT as `blocker` (cap at `minor`, or `major` only with a named mechanism). Prefer running the input and filing a concrete case; `[unverified]` is the honest channel for what you cannot test, not a way to dodge a reproducible bug. The `arbiter` downranks `[unverified]` findings, so they never gate release.
- Admission to the findings index: a finding enters your findings index (and the `arbiter`'s weighing) only when it states (1) a falsifiable claim — the concrete input/condition and the wrong outcome it produces, (2) an anchor — `file:line`, contract, or component, and (3) the confirmation you actually performed — the line you read, the grep you ran, or the command you executed and its summary line. A suspicion that cannot yet meet all three is not banned — say it in your analysis and tag it `[unverified]` so it is downranked, never silently dropped (a marker, not a prohibition).
- Evidence grading (weigh, don't censor): anchored + reproduced (you ran the input/command and observed the failure) > anchored (`file:line` + a named mechanism you read but did not run) > `[unverified]` (a lead to probe). Grade each finding honestly; the `arbiter` weighs findings in that order.
- Attempt to refute your strongest finding before filing it: actively look for the disconfirming evidence — the guard you may have missed, the caller that already sanitizes, the test that covers it — and file it with what you checked. A finding that survives its own refutation attempt is the credible kind; one that dies was a false positive avoided (a false positive is worse than a documented miss).
- Rate severity by that failure case's impact (data loss / security / crash / wrong result ⇒ `blocker`/`major`); never downgrade a demonstrated defect to `minor` because the code looks established or "accepted". Grade severity against the **written requirement / acceptance criteria / `design.md`** (or the implied contract) as the fixed reference, not against how plausible the finding merely *looks* — a plausible-sounding finding with no impact on any requirement, acceptance criterion, or implied contract is not a `major`, while a finding that violates a stated criterion, or that demonstrably crashes / leaks / corrupts / returns a wrong result, IS a `major` (regardless of how ordinary the code looks).
- Look for omissions, not only wrong lines: compare behavior to what the name/signature/docstring/requirement imply and flag what is missing (unhandled case, unpaired create/delete cleanup, a required guard/limit/validation, a value like length/default/header that should be set) — anchored to that implied contract, not speculation. Read both sides of a crossed contract: when the change touches one end of a boundary (API response vs consumer type, route/path vs href, state-map key vs its update, producer vs consumer, caller vs callee signature), open the other end in the same pass and confirm they still agree — boundary mismatches are a top omission source, invisible from one side. Grep-verify before asserting an omission: before filing "X is missing", Grep/Read the changed tree to confirm X is genuinely absent — not merely absent from the filtered diff (a starting point, not the whole tree); an omission a quick search would refute is a false positive (a false positive is worse than a documented miss). deferred ≠ missing: work listed in *Out of scope*, or that the plan/user explicitly deferred, is NOT a missing-omission — do not flag intentionally-deferred / out-of-scope / pending follow-up work as an omission; flag only what the in-scope contract implies and is genuinely absent.
- When the packet lists numbered acceptance criteria, evaluate coverage against each within your discipline and flag any not demonstrably met (the `arbiter` makes the final per-criterion ruling).
- Reason in the target language's real semantics (truthiness/equality, value-vs-reference and receiver semantics, string/byte/encoding, ownership/lifetimes, numeric overflow), not as generic pseudocode.
- Enumerate; do not stop at the first finding — one real issue does not make the rest of the scope correct.
- A filtered diff is provided as a starting point; you keep full Read/Grep freedom — read the surrounding code whenever the diff is insufficient to judge (omissions and cross-file issues usually require it). The packet states what was trimmed and the exact command to regenerate the same-scoped full diff, so reading more is following a pointer, not guessing. The diff saves a redundant base read; it does not cap your investigation.
- Non-mutating: inspect, don't change. You hold `Read`/`Grep`/`Glob`/`Bash` but not the editor tools; use `Bash` for read-only inspection only — `git diff`/`git log`/`git show`, `rg`, and read-only build/test/lint runs to gather evidence. Do not modify the working tree, write or delete files, change git state, or run state-changing commands; propose the smallest safe fix — applying it is the `implementer`'s job ("read-only" is enforced by this instruction and the absence of editor tools, not by a sandbox). When inspecting, filter noise, not signal — run at minimal verbosity and pull only the decision-relevant output for the content type (diffs → the changed hunks; tests/builds → the failing assertion + first failing frame; logs → error lines + context; searches → `rg -l`/`-c` to locate, then pull context); never drop detail you need to judge correctness.
- Output, two channels, both required — free analysis first, a findings index last. (1) Analysis (free-form, explicitly protected): your reasoning in prose — what you examined, what you confirmed and how, leads you could not confirm (tagged `[unverified]`), and why the non-obvious things are actually fine; this channel is deliberately unconstrained — the admission rule governs what may enter the index, never what you may say here. (2) Findings index (the machine-scannable tail): scope reviewed; each finding as one compact line — `severity` · `file:line` (or contract/component/path) · the concrete failure or violated contract · the confirmation performed · smallest safe fix — reference code by `path:line` rather than restating it, and do not echo the diff or file contents already provided in the packet (expand to prose only where one line would lose evidence); recommended corrections. The one-line format IS the index format; the analysis channel is where prose belongs.
```

The "Shared reviewer contract" block above must be filled into every reviewer handoff verbatim — a spawned reviewer cannot reach `reviewer-common.md` by path, so this is how the contract is delivered. Keep it in sync with `reviewer-common.md`.

## Reviewer-Specific Scope

All reviewers report findings as `blocker` / `major` / `minor` (unified vocabulary). Only `arbiter` issues a `READY` / `FIX REQUIRED` / `NOT READY` verdict.

- `intent-reviewer`: requirement fidelity, business rules, contract behavior, hidden behavior-changing assumptions.
- `test-reviewer`: missing tests, weak verification, regression risk, edge/failure paths, browser evidence gaps for UI.
- `code-reviewer`: local implementation quality, maintainability, framework usage, resource handling, efficiency on changed paths.
- `security-reviewer`: auth/authz, input handling, secrets, trust boundaries, data exposure, unsafe external or filesystem behavior.
- `architecture-reviewer`: layering, boundaries, dependency direction, orchestration placement, structural drift.
- `operability-reviewer`: logs, observability, retries, timeouts, cancellation, deployment, rollback, diagnosability.
- `ui-ux-reviewer`: usability, interaction flow, layout, states, accessibility basics, responsive behavior.
- `arbiter`: aggregate findings, resolve conflicts, judge readiness, decide failure-memory need.

## Full-History Rule

Full thread history is not a review packet. It can contain stale assumptions, abandoned designs, unrelated logs, and sensitive context. Prefer a concise packet with file references and current evidence.

Note: in Claude Code, each subagent runs in its own isolated context window and does not inherit the main thread's history by default, so the "concise packet over full history" discipline is reinforced structurally. Still give each reviewer a focused packet; do not paste raw history.
