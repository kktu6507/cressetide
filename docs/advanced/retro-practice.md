# Retro practice: cases first, paired counts, never a dashboard

A retro looks back over several already-closed run-ledger entries (`references/run-ledger.md`) to ask
whether a recurring pattern of rework, escape, or drift should change a policy rule — a reviewer's
scope, a checklist item, a plan-gate question. Its output is a set of **cases** (short narratives: what
happened, what the run ledger shows, what changed as a result) plus, where warranted, **policy-rule
edits**. It is never a dashboard, a trend line, or a scorecard. This page states the practice; it coins
no new command and adds no new fixtures.

## When a retro triggers

The trigger signal is `run-consolidate.mjs`'s tripwire: **14 days / ≥3 escaped closures**
(`references/run-ledger.md`, *Consolidation*). When a vigil run's final report shows a `Ledger:` line
with `— retro suggested` (`references/final-report.md`), that is the cue to schedule a retro — not an
automatic action, and not something the run in progress reasons about itself
(`references/run-ledger.md`, *The post-verdict boundary*). A retro is deliberately something a human
schedules after reading the disclosure, not something the tripwire launches on its own.

## Cases first

Start from the actual `escaped` (and, where relevant, `survived` / `superseded` / `building-upon`)
closures in the window, read each one's ledger `run` record and its `close` event's `reason`
(`references/run-ledger.md`), and write each as a short case: what the run intended, what actually
required rework, and why. A case is a narrative with evidence — the ledger's `head`/`files`/`findings`
fields, the commit(s) that reworked it, the disposition reason — not a bucketed statistic. Group cases
by pattern only after reading them individually; do not start from a count and back-fill a story to
match it.

## Paired-count discipline

Any rate or count a retro cites must appear **alongside its counterpart** in the same breath. A
first-pass-clean count is never shown without the escaped-rework count next to it; an "N runs closed
`survived`" count is never shown without also naming how many closed `escaped` in the same window. A
lone number that implies a trend — "clean rate is up" with no paired figure — is exactly the failure
mode this practice exists to avoid: a single number invites a reader to infer a direction from it alone,
and a direction is exactly what a score (never stored here) would also invite. Pairing keeps every
figure a fact about a specific, bounded set of already-closed events, never a rate standing in for
a trend.

## How a retro's findings land: through a normal vigil run

A retro's cases and any resulting policy-rule edit are not applied by hand-editing a skill or reference
file directly outside the normal pipeline. They land the same way any other change to cressetide's own
behavior does: **plan → approval → implementation → review** — a normal vigil run, with the retro's
cases serving as the requirement and evidence for that run's plan. This keeps a policy change subject to
the same plan gate, acceptance criteria, and review panel as any other change to `SKILL.md`, an
`agents/*.agent.md` file, or a `references/*.md` file — a retro's conclusion is an input to that process,
never a bypass of it.

## Why this whole system avoids scores

This repo's actor-reviewer distance is close to zero — one person, largely one model family,
implementing and reviewing its own work across runs. A score (an estimate that declares a direction and
invites optimization toward it) has no job to do here that a **count** (an event fact that invites
investigation, not optimization) doesn't already do more safely. Scores belong to closed worlds — frozen
fixtures, hidden checks, a fixed A-vs-B comparison (`docs/benchmark-contract.md`) — where the thing being
measured cannot bend the measurement itself. Live, open-ended work has no such fixed denominator, so a
retro reads cases and paired counts, never a percentage.
