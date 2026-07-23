# Decision Record — Design Spec

## Problem

cressetide's existing durable state each covers one axis: `FAILURE_MEMORY.md` (what went wrong,
how it was prevented), `EXPERIENCE.md` (what approach was validated by repeated use), `incidents/`
(salvage's live crisis-recovery journal). None of them capture "we chose X over Y, here is why,
here is what would make us revisit it" — a decision that is neither a failure, nor a validated
recurring pattern, nor a live incident. Today that reasoning lives only in conversation text or a
PR description; a later run (or a fresh Claude session with no memory of the conversation) has no
way to discover it and risks re-litigating a settled question.

This repo's own history already demonstrates the gap: the decision to reject a standalone `retro`
skill and a standalone `dependency-intake` skill (both discussed and settled in an earlier
brainstorming session) left no trace anywhere in the repository — only in a conversation transcript
no future session reads by default.

## Non-goals

- Not a new skill and not a new `/ctide:*` command — a shared, lightweight file convention instead.
- Not a ranking/retrieval script (à la `failure-retrieve.mjs`) — current expected volume (a handful
  of entries) does not justify one; `Grep` across `.ctide/decisions/*.md` is sufficient. Revisit if
  volume grows.
- Not an index/table-of-contents file — same reasoning; the `DECISION-<YYYYMMDD>-<slug>.md`
  filename is self-describing and sorts chronologically without one.
- Not a live decision-support or approval tool — it records a decision only after the decision is
  already final; it never suggests, blocks, or adjudicates a choice itself.
- Not auto-injected via the SessionStart hook — consulted read-only during vigil planning, the same
  tier `EXPERIENCE.md` already occupies, not force-digested like `FAILURE_MEMORY.md`.
- Not a scored, percentaged, or dashboarded view — cases only, per `docs/advanced/retro-practice.md`.
- Not a time-based auto-expiry mechanism — see *Lifecycle* below.

## Architecture

New committed directory `.ctide/decisions/`, joining the existing committed-semantic-state family
(`map/`, `memory/`, `design/`, `incidents/` — `docs/runtime-contract.md`, *Project state*). One file
per decision: `DECISION-<YYYYMMDD>-<slug>.md`, mirroring the existing
`incidents/INCIDENT-<YYYYMMDD>-<slug>.md` naming exactly, rather than a single growing file (unlike
`FAILURE_MEMORY.md`/`EXPERIENCE.md`).

Per-decision files were chosen over a single growing file because: decisions plausibly need more
prose room (context, alternatives considered, consequences) than `FAILURE_MEMORY.md`'s deliberately
terse entries; `incidents/` already establishes a one-file-per-entry sibling precedent inside
`.ctide/`, so this is not a new shape for the directory family; and a shared mutable file is a
collision point across parallel sessions/worktrees — a real, recently-lived risk in this repo (the
garden-9d worktree merge earlier this session).

Entry template:

```markdown
# DECISION-<YYYYMMDD>-<slug>

- **Status**: active | superseded (by DECISION-<YYYYMMDD>-<slug>)
- **Context**: the situation, constraint, or question that prompted this.
- **Decision**: what was chosen (a decision to NOT do something is still a decision).
- **Alternatives considered**: other genuinely-viable options and why each was not chosen.
- **Consequences**: what this commits to; what becomes harder or easier as a result.
- **Revisit trigger**: what future fact or event would make this worth reopening — "none
  identified" if not applicable.
- **Source**: vigil run <ref> | discussion (<date>) — where this was actually decided.
- **Tags**: area / component / decision-type.
```

`Status` is deliberately a two-state field (`active` / `superseded`), not `EXPERIENCE.md`'s
four-stage `candidate → validated → standard → retired` lifecycle — a decision is not something
that gets validated stronger by repetition; it either still governs or has been replaced.
Superseding a decision means writing a **new** file and updating the **old** file's `Status` field
to point at it — never silently leaving a stale `active` decision on disk.

## Lifecycle (no automatic expiry)

`Status` never changes on a timer. This deliberately mirrors `EXPERIENCE.md`'s explicit "prose
contract, not a machine lint" stance (`references/experience-memory.md`) — judging whether a
decision's premise still holds is a semantic question, not something a heuristic parser over
free-form prose should attempt (the exact failure mode the 2026-07-16 Ops-Profile trust-marker
entry in global failure memory documents). Staleness is instead caught by the `Revisit trigger`
field, surfaced naturally at the one point a relevant decision is already being read — vigil's
planning-phase consultation (below) — rather than by a separate clock.

A `decision-consolidate.mjs`-style advisory script (mirroring `failure-consolidate.mjs`'s
age-plus-no-recent-match candidate list, evidence not action) is a reasonable future addition if
volume ever justifies the maintenance cost; not built in this version.

## Data flow

**Read (vigil-run path).** During Step 2 (Planning), the same timing `EXPERIENCE.md` already uses —
before non-trivial planning, ungated by risk tier. On the high-risk plan-grounding path this rides
`navigator`'s Stage A grounding pass; on low/medium risk the orchestrator reads directly, the same
split failure-memory/experience consultation already uses. Read `.ctide/decisions/*.md`, filter by
`Tags` against the task's area (targeted read, no script at current volume). The result folds into
plan reasoning only — never an auto-applied rule, the same posture `references/experience-memory.md`
already states and consistent with the Map's own "evidence routing, not authority" stance
(`vigil/SKILL.md`).

If the plan would concretely contradict an `active` decision's `Decision` field (not merely
adjacent — actually reversing it), that is an instance of vigil's existing Step 1 rule ("ambiguity
materially affecting business behavior → AskUserQuestion"): state the conflict explicitly at the
plan gate rather than silently drifting from a past call. This is an added trigger source for an
existing rule, not new gate machinery.

**Read (discussion path).** No fixed step exists outside a vigil run. The realistic trigger is
judgment — recognizing, mid-conversation, that a proposal might overlap a prior decision, and
checking `.ctide/decisions/`. Weaker guarantee than the vigil path by construction (no forced step);
this is the accepted tradeoff of the "shared lightweight convention" choice over a dedicated skill
or hook.

**Write (vigil-run path).** Mirrors `FAILURE_MEMORY.md`'s exact "you decide, main thread writes"
split (`agents/arbiter.agent.md`, *Failure memory rules*). At Step 7, `arbiter` decides whether this
run produced a decision worth recording, using four signal criteria: (1) a reviewer suggestion was
explicitly declined, (2) a residual/Extended-Safe risk was accepted instead of blocking, (3) the
plan chose between two or more genuinely-viable approaches, (4) a feature/skill candidate was
rejected outright. `arbiter` proposes the entry text and filename (and, when this decision
supersedes a prior `active` one, the old file's updated `Status` line too); the main thread performs
the single serialized write at Step 9, alongside the failure-memory write and ledger append — never
during the review/repair loop itself.

**Write (discussion path).** No prior plan-approval gate covers this write (unlike the vigil path,
where the underlying decision was already approved at `ExitPlanMode`). Get one lightweight explicit
confirmation before writing — not a full plan gate, just a "record this as a decision?" check —
consistent with `design.md`'s bootstrap rule that a persistent, citable contract must be a
deliberate, signed-off action, never a silent side effect.

**Reading never writes.** Only the write paths above touch `.ctide/decisions/`; the consultation
read never updates a `Status` field or any other file.

## Components (files touched)

- New: `cressetide/skills/vigil/references/decision-record.md` — the contract (template, lifecycle,
  consultation, write-timing, non-goals), following this repo's existing reference-file shape.
- `cressetide/skills/vigil/SKILL.md`: add to *Reference Loading*; add the consultation bullet to
  Step 2 (next to the `EXPERIENCE.md` bullet); add the arbiter-decision bullet to Step 7 (next to
  the failure-memory bullet); add the write step to Step 9 (next to the failure-memory write /
  ledger append).
- `cressetide/agents/arbiter.agent.md`: new "Decision memory rules" section mirroring "Failure
  memory rules" 1:1 in shape (signal criteria as the trigger test, "you decide; the main thread
  writes," supersede handling); add one line to the existing top-level "Decide whether..." bullet
  list.
- `docs/runtime-contract.md`: add `decisions/` to the *Project state* prose enumeration and the
  `.ctide/` tree diagram (the canonical source `run-ledger.md` itself already cites for this exact
  list).
- `ARCHITECTURE.md`: add "decision records" to the *State and evidence* one-line enumeration.
- `docs/command-reference.md`: verify during implementation whether it documents `.ctide/` structure
  elsewhere and needs a matching touch — not committing to specifics here (mirrors how the
  `release/ship` spec flagged an uncertain touch point rather than guessing).

## Error handling

- Missing `.ctide/decisions/` directory: the first write creates it; no migration path applies (a
  new convention, same as `EXPERIENCE.md`'s "new path, no legacy predecessor").
- Filename collision (two decisions, same date, colliding slug): check existence before writing and
  append a numeric suffix, the same never-assume discipline the shared one-time-migration procedure
  already uses for trackedness checks.
- Supersede is two file touches in one write step, by the same single writer: create the new
  `active` file, update the old file's `Status` to `superseded (by <new ref>)` — never left
  dangling.
- Absence of any `.ctide/decisions/` entries on read is never an error — "no prior decisions to
  consult," the same as `EXPERIENCE.md`'s detect-or-skip.

## Testing

Primarily a documentation/convention change — no new script or branching logic needing unit tests.
The garden-9a and garden-5b CI guards generalized earlier this session already validate that
`references/decision-record.md` is reachable from `vigil/SKILL.md` and that every reference it
mentions exists — confirm `npm run validate` stays green with the new file in place, no new guard
code required. No forced end-to-end test of the write path; the first real qualifying run is the
natural first exercise (this very brainstorming session's own "one growing file vs. one file per
decision" choice would qualify as signal (3) once the feature ships).

## Scope check

Touches only vigil's own reference/lifecycle prose, one new reference file, and two canonical
`.ctide/`-structure docs. No new skill, script, hook, or CI guard. Consistent with a single
implementation plan.
