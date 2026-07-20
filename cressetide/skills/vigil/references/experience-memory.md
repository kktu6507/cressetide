# Experience Memory (`.ctide/memory/EXPERIENCE.md`)

`EXPERIENCE.md` is `FAILURE_MEMORY.md`'s tracked sibling: where failure memory records what went
wrong and how it was prevented, experience memory records a validated **positive** pattern — an
approach, convention, or design choice that repeated real use has confirmed works. Both live under
`.ctide/memory/`; both are **committed** in the consuming project (unlike the ledger, which is
self-gitignored and untracked — `references/run-ledger.md`, *Storage*). This file defines the
`.ctide/memory/EXPERIENCE.md` contract only; it does not change failure memory's own contract or
lifecycle (`references/verification-gate.md`, *Failure Memory*).

## Lifecycle

```
candidate → validated → standard → retired
```

- **`candidate`** — a pattern proposed after one real run; not yet confirmed by independent repetition.
- **`validated`** — confirmed by at least one further, independent real run (a second data point that
  is not just a restatement of the first).
- **`standard`** — promoted only when the entry also carries a **linked executable asset**: a test, a
  validator script, or a template file path that operationalizes the pattern. **Prose alone can never
  reach `standard`**, no matter how many runs validate it — an entry with strong narrative evidence but
  no linked asset stays at `validated` until one exists.
- **`retired`** — superseded by a newer entry or no longer applicable; mirror the `FAILURE_MEMORY.md`
  title-suffix convention: mark the `###` title line with `(retired)` or `(superseded by <date / short
  title>)` so it is visibly retired rather than silently competing with the entry that replaced it
  (`references/verification-gate.md`, *Keeping the file small*).

Promotion at each step is a **human/agent judgment call recorded in prose**, not a computed score —
this file stores no rate, count, or percentage, the same discipline the run ledger holds
(`references/run-ledger.md`).

## Why `standard` requires a linked executable asset, and why that gate stays prose-only

An asset requirement (a test, validator, or template someone can point at and run) is what
distinguishes "we did this once and it felt right" from "we can mechanically re-check this is still
being followed." Without it, `standard` would mean nothing more than repeated confidence.

**This version enforces that requirement as a prose contract, checked by whoever promotes the entry —
not a machine-enforced lint.** Do not build a heuristic checker that scans free-form `EXPERIENCE.md`
markdown to verify "is there really a linked asset here." That is exactly the trap
`~/.claude/FAILURE_MEMORY.md`'s 2026-07-16 entry documents: four successive hardening rounds on a
heuristic Ops-Profile trust-marker detector over free-form human-edited prose, each round closing the
exact shape the previous reviewer named and reopening the same class of gap elsewhere (case,
whitespace, bullet-glyph, dash-variant, table-style, multi-clause, dual-marker variants), because
heuristic matching over unbounded free-form prose has an inherent recall/precision leak that
point-patching relocates rather than closes.

If a machine check is wanted later, that same entry's own resolution names the correct direction: a
**fixed-position, machine-parseable sentinel** (an HTML comment or a dedicated key an author cannot
incidentally reformat away), never prose parsing. That is future, optional hardening — **not built in
this version** — and should not be attempted as a heuristic string/regex matcher over the "Linked
executable asset" field's free text.

## Consultation (read-only, during planning)

Consult `EXPERIENCE.md` the same tiered-fallback style as `FAILURE_MEMORY.md`
(`references/verification-gate.md`, *Failure Memory*): project `.ctide/memory/EXPERIENCE.md` when it
exists, else skip — read only relevant `standard`-tier entries (filter by `Tags`, the same
targeted-retrieval discipline failure memory uses) before non-trivial planning, and treat it as
read-only material for the plan, never an auto-applied rule.

**No migration duty.** `EXPERIENCE.md` is a new path, not a renamed legacy one — there is no
compatibility predecessor to migrate from, and no one-time `git mv` procedure applies to it.
Consultation here is strictly simpler than failure memory's tiered read: check whether the file
exists, read it if so, otherwise proceed without it.

## Never auto-injected by any hook

`hooks/load-failure-memory.js` is deliberately **untouched** by this contract and continues to read
only `FAILURE_MEMORY.md` paths (project `.ctide/memory/FAILURE_MEMORY.md`, the legacy
`ai/FAILURE_MEMORY.md` fallback, then the global `~/.claude/FAILURE_MEMORY.md`) at `SessionStart`. It
does **not** read, digest, or inject `EXPERIENCE.md` in any form. State this explicitly so a future
editor does not assume `EXPERIENCE.md` belongs in that hook's read set by analogy — it does not; every
consultation of `EXPERIENCE.md` is the agent reading the file directly during planning, per the section
above, never a hook-injected digest.

## Entry template

Reuse `FAILURE_MEMORY.md`'s entry-template shape (`references/verification-gate.md`, *Failure Memory
Entry Template*), adapted for a validated pattern instead of a prevented failure:

```markdown
### <YYYY-MM-DD> — <short title>
- **Context**: what situation or task this pattern applies to.
- **Pattern**: the approach, convention, or design choice being recorded.
- **Evidence**: which real runs validated it (dates / task references) — not a synthetic example.
- **Applicability**: where this pattern is expected to hold.
- **Contraindications**: where this pattern does NOT apply, or reasonable alternatives it does not
  dominate.
- **Linked executable asset**: path to a test, validator, or template that operationalizes this
  pattern — required before this entry can reach `standard`; leave explicitly blank at `candidate` /
  `validated`.
- **Confidence tier**: candidate / validated / standard / retired.
- **Tags**: language / area / pattern-type (used the same way failure memory's tags filter targeted
  retrieval).
- **Superseded/retired marker**: append `(retired)` or `(superseded by <date / short title>)` to the
  `###` title line when this entry is no longer current — do not leave a retired entry silently
  competing with the one that replaced it.
```

When appending to an existing `EXPERIENCE.md`, reuse its existing headings exactly rather than
introducing a competing schema, the same rule `FAILURE_MEMORY.md` follows.

## Invariants

- **Prose contract, not a machine lint** — see *Why `standard` requires a linked executable asset*
  above; this is a deliberate, disclosed non-goal for this version.
- **Committed, unlike the ledger.** `EXPERIENCE.md` is tracked by Git in the consuming project, the
  same as `FAILURE_MEMORY.md`; it is not gitignored and not per-run scratch.
- **No migration duty.** New path, no legacy predecessor.
- **Never auto-injected.** No hook reads or digests it; see above.
- **No stored score/rate.** Confidence tiers and evidence are recorded in prose; nothing here is a
  computed percentage.
