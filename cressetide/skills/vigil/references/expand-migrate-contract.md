# Expand, Migrate, Contract (staging a breaking change safely)

A large or breaking change (a schema, API, or interface reshape) is rarely safe as one big-bang
rewrite: the old and new shapes cannot both be correct at the same instant a single commit flips
between them, so any interruption, partial rollout, or missed caller leaves the system broken mid-
flight. **Expand → migrate → contract** (a.k.a. the "parallel change" pattern) instead splits the
change into three separately-shippable, separately-verifiable steps, each leaving the system working
throughout. Use this reference when planning or reviewing a change of that shape — not as a mandatory
ceremony for every refactor.

## The three steps

- **Expand.** Add the new path, shape, field, or interface **alongside** the old one, without removing
  or breaking it. Both old and new callers keep working unchanged. This step alone should be
  low-risk and independently shippable — it adds capability, it does not yet require anyone to use it.
- **Migrate.** Move callers over to the new shape **incrementally**, verifying at each step rather than
  flipping every caller at once. Each increment is a smaller, more reviewable diff, and a fault in one
  increment does not block or corrupt the others. The old path keeps serving not-yet-migrated callers
  throughout — this is what makes the change safe to pause, observe, or partially roll back.
- **Contract.** Remove the old path **only once nothing depends on it anymore.** Before deleting it,
  check for lingering references — a grep for the old symbol/route/column, a usage/telemetry check, or
  an explicit "who still calls this" pass — not just "the migrate step said it moved everyone." Treat an
  unverified "nothing should use this" as a **finding**, not a green light: a leftover caller discovered
  only after deletion is exactly the failure mode this pattern exists to prevent. The contract step
  cannot start until the migrate step is actually confirmed complete, not merely believed complete.

## When this applies

Reach for this pattern on changes that would otherwise require a single atomic cutover with no safe
intermediate state: a breaking schema/column change, a breaking API/interface signature change, a
storage-format change, or a cross-module rename where old and new callers must coexist during rollout.
It does **not** apply to an ordinary refactor that stays behavior-preserving within one commit (rename a
private helper, restructure a single module) — forcing three separate steps onto a small, contained
change adds ceremony without reducing risk, which the usability-over-strictness axiom weighs against.
The signal to use it is the **coexistence requirement**: can the old and new shapes be made to work side
by side for a while, or does the change force an instant, all-or-nothing flip? If nothing meaningfully
depends on the old shape yet (e.g. it is not yet released, or has no real callers), expand/migrate/
contract is unnecessary ceremony — go straight to the new shape.

## Interaction with risk classification and review

A change matching *When this applies* above is very likely already **high risk** under
`references/reviewer-selection.md`'s Risk Matrix (schema/migration, cross-module orchestration, or an
external-integration contract change) — this reference does not add a new risk tier, it is the staging
discipline a plan should apply once that tier is already reached. At the plan gate, state which of the
three steps THIS change/task covers (a single task is often just one step, with the others tracked as
follow-ups) and what still depends on the old shape. `architecture-reviewer` is the primary reviewer for
whether a large/breaking change was staged safely — a same-commit removal of the old path with no
migrate step behind it, or a contract step with no lingering-reference check performed, is exactly the
structural finding it should raise (per its Review lens / How to think). `intent-reviewer` and
`test-reviewer` still own, respectively, whether the contract/acceptance criteria and verification match
whichever step is actually in scope.

## Invariants

- **Never a hard dependency.** Most changes are not this shape; do not force the three-step structure
  onto a contained, behavior-preserving refactor.
- **Coexistence, not speed, is the point.** The pattern trades a faster single cutover for a safer
  staged one — do not collapse expand+migrate+contract back into one commit to save time on a change
  that genuinely needs the coexistence window.
- **The contract step requires evidence, not belief.** Verify nothing still depends on the old path
  (grep/usage check) before removing it; "the migration should be done" is not the same as "confirmed
  done."
