# Decision Record (`.ctide/decisions/`)

`.ctide/decisions/` joins `.ctide/`'s committed-semantic-state family (`map/`,
`memory/`, `design/`, `incidents/` — `docs/runtime-contract.md`, *Project state*). Where
`FAILURE_MEMORY.md` records what went wrong and `EXPERIENCE.md` records what approach repeated use
validated, a decision record captures a third, distinct axis: "we chose X over Y, here is why, here
is what would make us revisit it" — a decision that is neither a failure, nor a validated recurring
pattern, nor a live incident. This repo's own history already demonstrates the gap this closes: the
decision to reject a standalone `retro` skill and a standalone `dependency-intake` skill (both
discussed and settled in an earlier brainstorming session) left no trace anywhere in the repository —
only in a conversation transcript no future session reads by default. This file defines the
`.ctide/decisions/` contract only; it does not change `FAILURE_MEMORY.md`'s or `EXPERIENCE.md`'s own
contracts (`references/verification-gate.md`, *Failure Memory*; `references/experience-memory.md`).

## Shape: one file per decision, not a growing log

Unlike `FAILURE_MEMORY.md`/`EXPERIENCE.md` (one growing file each), `.ctide/decisions/` holds one
file per decision: `DECISION-<YYYYMMDD>-<slug>.md`, mirroring the existing
`incidents/INCIDENT-<YYYYMMDD>-<slug>.md` naming exactly. Decisions plausibly need more prose room
(context, alternatives considered, consequences) than `FAILURE_MEMORY.md`'s deliberately terse
entries; `incidents/` already establishes a one-file-per-entry sibling precedent inside `.ctide/`, so
this is not a new shape for the directory family. A shared mutable file is also a collision point
across parallel sessions/worktrees — a real risk this repo has already lived.

No ranking, retrieval, or index script exists at current volume: `Grep` across
`.ctide/decisions/*.md` is sufficient, and the `DECISION-<YYYYMMDD>-<slug>.md` filename is
self-describing and sorts chronologically without a table of contents. Revisit only if volume grows
enough to justify the maintenance cost of a script.

## Entry template

```markdown
# DECISION-<YYYYMMDD>-<slug>
- **Status**: active | superseded (by DECISION-<YYYYMMDD>-<slug>)
- **Context**: the situation, constraint, or question that prompted this.
- **Decision**: what was chosen (a decision to NOT do something is still a decision).
- **Alternatives considered**: other genuinely-viable options and why each was not chosen.
- **Consequences**: what this commits to; what becomes harder or easier as a result.
- **Revisit trigger**: what future fact or event would make this worth reopening — "none identified" if n/a.
- **Source**: vigil run <ref> | discussion (<date>) — where this was actually decided.
- **Tags**: area / component / decision-type.
```

Use this template exactly for every file written to `.ctide/decisions/` rather than inventing a
competing schema per entry — the same rule `FAILURE_MEMORY.md` and `EXPERIENCE.md` follow for
entries appended to those files.

## `Status`: two states, no automatic expiry

`Status` is deliberately a two-state field — `active` | `superseded (by <ref>)` — not
`EXPERIENCE.md`'s four-stage `candidate → validated → standard → retired` lifecycle
(`references/experience-memory.md`, *Lifecycle*): a decision is not something that gets validated
stronger by repetition; it either still governs or has been replaced. Superseding a decision means
writing a **new** file and updating the **old** file's `Status` field to point at it — never
silently leaving a stale `active` decision on disk.

`Status` never changes on a timer; there is no time-based auto-expiry mechanism. This deliberately
mirrors `EXPERIENCE.md`'s explicit "prose contract, not a machine lint" stance
(`references/experience-memory.md`, *Why `standard` requires a linked executable asset, and why that
gate stays prose-only*): judging whether a decision's premise still holds is a semantic question,
not something a heuristic parser over free-form prose should attempt — the exact failure mode the
2026-07-16 Ops-Profile trust-marker entry in global failure memory documents (four successive
hardening rounds on a heuristic detector, each round closing the exact shape the previous reviewer
named and reopening the same class of gap elsewhere). Staleness is instead caught by the `Revisit
trigger` field, surfaced naturally at the one point a relevant decision is already being read —
vigil's planning-phase consultation, below — rather than by a separate clock.

A `decision-consolidate.mjs`-style advisory script (mirroring `failure-consolidate.mjs`'s
age-plus-no-recent-match candidate list, evidence not action) is a reasonable future addition if
volume ever justifies the maintenance cost; not built in this version.

## Consultation (read-only, during planning)

**Vigil-run path.** Consult `.ctide/decisions/*.md` during vigil Step 2 (Planning) — the same
timing/tier `EXPERIENCE.md` consultation already uses: before non-trivial planning, ungated by risk
tier. Read only entries relevant to the task's area (filter by `Tags`, the same targeted-retrieval
discipline failure memory and experience memory use). The result folds into plan reasoning only —
never an auto-applied rule, consistent with the Map's own "evidence routing, not authority" stance
already stated in `SKILL.md`.

If the plan would concretely reverse an `active` decision's `Decision` field (not merely adjacent —
actually contradicting it), that is an instance of vigil's existing Step 1 rule ("ambiguity
materially affecting business behavior → AskUserQuestion"): state the conflict explicitly at the
plan gate rather than silently drifting from a past call. This is an added trigger source for an
existing rule, not new gate machinery.

**Discussion path.** No fixed vigil step exists outside a vigil run. The realistic trigger is
judgment — recognizing, mid-conversation, that a proposal might overlap a prior decision, and
checking `.ctide/decisions/`. This is a weaker guarantee than the vigil path by construction (no
forced step); it is the accepted tradeoff of a shared lightweight convention over a dedicated skill
or hook.

**No migration duty.** `.ctide/decisions/` is a new path, not a renamed legacy one — there is no
compatibility predecessor to migrate from, and no one-time `git mv` procedure applies to it.
Consultation here is strictly simple: check whether the directory exists, read relevant entries if
so, otherwise proceed without it — absence is never an error (see *Error handling* below).

## Never auto-injected by any hook

`hooks/load-failure-memory.js` is deliberately **untouched** by this contract; it continues to read
only `FAILURE_MEMORY.md` paths at `SessionStart`. It does **not** read, digest, or inject
`.ctide/decisions/` in any form. Every consultation of `.ctide/decisions/` is the agent reading the
relevant files directly during planning, per the section above, never a hook-injected digest — the
same posture `references/experience-memory.md` states for `EXPERIENCE.md`.

## Recording a decision (write side)

**Vigil-run path.** Mirrors `FAILURE_MEMORY.md`'s exact "arbiter decides, main thread writes" split
(`agents/arbiter.agent.md`, *Failure memory rules*) — the same single-writer discipline that avoids
concurrent lost-update corruption of a shared memory file. At vigil Step 7, `arbiter` decides using
**four exhaustive signal criteria** — this list is the gate, not a set of illustrative examples; a
run hitting none of them proposes no record, the deliberately bounded rule chosen over open-ended
subjective judgment to keep the record from becoming noise:

1. A reviewer suggestion was explicitly declined.
2. A residual or Extended-Safe risk was accepted instead of blocking.
3. The plan chose between two or more genuinely-viable approaches.
4. A feature or skill candidate was rejected outright.

When a signal fires, no separate user approval is required beyond the run's normal verdict flow —
the same as `FAILURE_MEMORY.md`'s write trigger. `arbiter` proposes the entry text and filename
(and, when the decision supersedes a prior `active` one, the old file's updated `Status` line too);
the main thread performs the single serialized write at Step 9, alongside the failure-memory write
and ledger append — never during the review/repair loop itself.

**Discussion path.** No prior plan-approval gate covers this write (unlike the vigil path, where the
underlying decision was already approved at `ExitPlanMode`). Get one lightweight explicit
confirmation before writing — not a full plan gate, just a "record this as a decision?" check —
consistent with `references/design-spec.md`'s bootstrap rule that a persistent, citable contract
must be a deliberate, signed-off action, never a silent side effect.

**Reading never writes.** Only the two write paths above touch `.ctide/decisions/`; the consultation
read never updates a `Status` field or any other file.

## Error handling

- **Missing `.ctide/decisions/` directory**: the first write creates it; no migration path applies —
  a new convention, same as `EXPERIENCE.md`'s "new path, no legacy predecessor."
- **Filename collision** (two decisions, same date, colliding slug): check existence before writing
  (`DECISION-<YYYYMMDD>-<slug>.md`); if taken, append `-2`, `-3`, … before the `.md` extension
  (`DECISION-<YYYYMMDD>-<slug>-2.md`).
- **Supersede**: two file touches in one write step, by the same single writer — create the new
  `active` file, update the old file's `Status` to `superseded (by <new ref>)`; never left dangling.
- **Absence of any `.ctide/decisions/` entries on read is never an error** — "no prior decisions to
  consult," the same detect-or-skip posture as `EXPERIENCE.md`.

## Invariants

- **Prose contract, not a machine lint.** See *`Status`: two states, no automatic expiry* above;
  this is a deliberate, disclosed non-goal for this version.
- **Committed, unlike the ledger.** `.ctide/decisions/` is tracked by Git in the consuming project,
  the same as `FAILURE_MEMORY.md` and `EXPERIENCE.md`; entries are not gitignored and not per-run
  scratch.
- **No migration duty.** New path, no legacy predecessor.
- **Never auto-injected.** No hook reads or digests it; see above.
- **Four exhaustive signal criteria, not examples.** The vigil-run write gate is the bounded list in
  *Recording a decision*, not open-ended judgment.
- **You decide; the main thread writes (vigil-run path).** `arbiter` proposes the entry (and, on
  supersede, the old file's updated `Status` line); the main thread performs the one serialized
  write — same discipline as failure memory.
- **Not a live decision-support or approval tool.** A decision record is written only after the
  decision is already final; it never suggests, blocks, or adjudicates a choice itself.
- **Language.** Per `SKILL.md` *Language And Text Integrity* — repository content follows this
  repo's existing language (English); technical contracts verbatim.
