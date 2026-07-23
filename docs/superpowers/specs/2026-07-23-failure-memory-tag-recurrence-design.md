# FAILURE_MEMORY Tag-Recurrence Candidates — Design Spec

## Problem

`failure-consolidate.mjs` already answers one question about `FAILURE_MEMORY.md`'s entries: "is
this entry still being used (should it retire)?" — via `retired` (explicitly marked) and
`expireCandidates` (dated, aged, zero retrieval hits). It answers nothing about a different
question: "do two entries that look unrelated on the surface actually share the same underlying
lesson-shape, recurring across subsystems?"

This gap surfaced twice in real, lived evidence rather than as a hypothetical. First: the
`point-patch-non-convergence` / `repair-loop-cap` / `stuck-summary` tag group appeared
independently in two unrelated entries — the 2026-07-19 `run-reconcile` entry and the 2026-07-16
`map` Ops-Profile trust-marker entry — the former's own prose using the word "recurring." Second,
freshly, within this same session: the "hollow-stub reviewer" entry (originally 2026-07-13) picked
up a 5th sighting during this session's own decision-record implementation — five independent
occurrences of the same failure shape across four different tasks. Both were caught only because a
human/agent happened to notice the connection while writing a new entry, never by a system-level
signal.

## Non-goals

- Not a new script or command — folds into `failure-consolidate.mjs`'s existing output.
- Not heuristic matching over `FAILURE_MEMORY.md`'s free-form prose — operates only on the
  already-structured `Tags` field (a clean, template-delimited list), exact-token comparison, never
  a guess about markdown formatting variants (the exact trap the 2026-07-16 Ops-Profile entry
  documents as non-convergent).
- Not a score, count, or dashboard — a candidate list, the same shape `expireCandidates` already
  uses: advisory only, `arbiter` and the human judge it, never an automatic action.
- Not a new path into `retro-practice.md`'s existing `run-consolidate.mjs` tripwire — no changes to
  that script or its 14-day/≥3-escape trigger; this signal surfaces through its own conditional
  report field instead (see *Data flow*).
- Not transitive clustering — reports directly-matching entry **pairs** only; if A↔B and B↔C both
  qualify independently, both surface as separate pairs, not a fused A-B-C cluster. Avoids
  building unneeded graph logic for a problem two real examples so far show as pairwise.

## Architecture

A new pure function in `failure-consolidate.mjs`, `tagRecurrenceCandidates(entries)`, alongside the
existing `consolidationReport()`. For every non-retired entry, parse its `Tags` field into a token
set (split on the template's `/` delimiter, trimmed). For every pair of distinct entries, compute
the tag-set intersection; a pair qualifies as a candidate only when the intersection has **at least
2 tags** — a single shared tag is expected noise (two entries both tagged a common language/area
like `node` share nothing meaningful), while the real motivating example shared 3 tags at once.
Threshold count is **2 entries** (not 3, unlike `run-consolidate.mjs`'s escaped-closure threshold):
the ≥2-tag-overlap filter already does the noise-reduction work escaped-closure's "wait for a 3rd
occurrence" threshold exists to do — a second, independent filter on top would double-suppress a
signal that's already fairly rare once tag-overlap ≥2 is required. **No time window** — unlike
escaped-closures (which measures *recent* operational health and needs a window for that reason),
tag recurrence is a structural/cumulative fact: two entries sharing a specific lesson-shape matters
whether they were written 2 days or 8 months apart.

Output format mirrors `expireCandidates`'s existing style:
```
tag recurrence candidates (2+ entries sharing 2+ tags):
  "<entry A title>" <-> "<entry B title>" — shared: tag1, tag2
```
`none` when no pair qualifies, matching the existing empty-list convention for `retired`/
`expireCandidates`.

## Data flow

Computed at `failure-consolidate.mjs`'s existing invocation point (the failure-memory
consolidation step), reusing the same `entries` array `parseEntries` already produces — no new
trigger, no new timing. The candidates feed into `arbiter`'s existing failure-memory decision as
additional evidence (the same "evidence, not action" posture `expireCandidates` already has). When
`arbiter` judges a candidate worth surfacing, it flows into `final-report.md`'s new conditional
field: a compact-mode bullet shown only when a candidate exists (mirroring the `Migration status` /
`Decision memory` bullets' "omit entirely when none" pattern), and a `--report full` table row
alongside the existing consolidation output.

## Components

- `cressetide/skills/vigil/scripts/failure-consolidate.mjs` — new exported `tagRecurrenceCandidates(entries)`
  pure function; `main()` calls it; `formatReport()` gains the new output block.
- `test/failure-consolidate.test.mjs` — extended, not a new file (see *Testing*).
- `cressetide/skills/vigil/references/verification-gate.md` — the Failure Memory / consolidation
  section gains a paragraph describing the new signal and its advisory-only posture.
- `cressetide/skills/vigil/references/final-report.md` — new conditional field, same mechanism as
  the `Decision Memory` field added earlier this session.
- `cressetide/agents/arbiter.agent.md` — the existing "Failure memory rules" section (not a new
  section — this feeds the *same* existing decision axis, unlike decision-record's parallel new
  axis) gains one line: consult tag-recurrence candidates when deciding whether a new entry is
  warranted.
- `docs/advanced/retro-practice.md` — a light touch: the existing tripwire definition (line 12,
  "14 days / ≥3 escaped closures") is left unchanged; add one sentence noting a second, independent
  recurrence signal exists (`failure-consolidate.mjs`'s tag-recurrence candidates), so a future
  reader isn't left wondering how the two relate. Proposed by the orchestrator, not settled by a
  prior clarifying question — drop this file from scope entirely if it reads as unnecessary.

## Error handling

Follows `failure-consolidate.mjs`'s existing fail-open conventions exactly: no entries (missing/
empty file) → no candidates, not an error; a missing or malformed `Tags` field on an entry → that
entry is skipped from pairing (treated as tag-less), never aborts the whole computation; the
comparison is a pure function with no side effects, so any unexpected internal exception falls back
to the existing `main()` try/catch's safe default.

## Testing

`tagRecurrenceCandidates()` is a new pure function, directly unit-testable: two entries sharing 2
tags (should report), sharing 1 tag (should not — proves the noise filter), sharing 3 tags (should
report, with all overlapping tags listed), one of the pair `retired` (should not count), the same
tag appearing across 3 entries forming 2 separate qualifying pairs (each pair reported
independently, no clustering), and no overlap anywhere (reports `none`). All extend the existing
`test/failure-consolidate.test.mjs` — no new test file.

## Scope check

Touches one existing script, its existing test file, and three reference/agent docs' prose. No new
script, hook, CI guard, or skill. Smaller footprint than the decision-record task. Consistent with
a single implementation plan.
