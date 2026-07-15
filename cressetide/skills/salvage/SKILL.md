---
name: salvage
description: "Use for live/production incidents: outage, downtime, severe malfunction, or data corruption in a deployed/live system — including urgent 'production is broken', 'the site is down', 'users are blocked' language. Preparation requests belong to map; do not invoke Salvage for them. Do not use for ordinary development-time bug fixes, feature work, or code review — those belong to vigil. Also runs manually via /ctide:salvage."
metadata:
  short-description: Production incident response (mitigate first, fix last)
---

# Incident Response

This is the dev flow inverted: **mitigate first, diagnose second, formal fix last.** The Vigil optimizes for shipping the right change; this skill optimizes for stopping harm in a live system, then feeding the fix back through that flow. It is built for operators who did not write the code — the normal case for AI-written systems: every human interaction is a decision card, and the human only approves or rejects. Running an incident must never require the human to read code.

## Mode detection

- Preparation intent → hand off to `/ctide:map`; Salvage does not implement a separate prepare mode.
- Anything else → **wartime**: run the stages below in order.
- Wartime when `.ctide/map/SYSTEM_MAP.md` is absent or stale: do not stop to build one. Spend 2–3 minutes on rapid recon (deploy mechanism, where logs live, rollback candidates), name the gap out loud ("no operational Map — working from rapid recon"), and continue. After closure, remind the user to run Map preparation.

## Operational layout

This skill owns two locations in the consuming project's `.ctide/` tree and shares two more with the dev flow:

```
<target repo>/.ctide/
  map/SYSTEM_MAP.md            # this skill's peacetime map (Map owns and refreshes it)
  incidents/INCIDENT-*.md       # this skill's incident journals — committed, they are the audit trail
  memory/FAILURE_MEMORY.md      # shared with the dev flow (closure proposes entries; main thread writes)
  output/                       # run scratch (never committed; self-gitignored)
```

## Stage index (wartime)

1. **Triage** — severity, blast radius, corruption check, intrusion check → `references/wartime.md`
2. **Preserve evidence** — the ~1-minute snapshot, non-skippable → `references/wartime.md`
3. **Mitigate** — a loop of reversible actions → `references/wartime.md`
4. **Diagnose** — fault-domain classification first → `references/wartime.md`
5. **Reproduce** — red evidence before any fix → `references/reproduction-and-repair.md`
6. **Fix** — handoff to `vigil` → `references/reproduction-and-repair.md`
   - **Data repair** (conditional, when corruption occurred) → `references/reproduction-and-repair.md`
   - **Production re-entry verification** → `references/reproduction-and-repair.md`
Route formal repairs through `/ctide:vigil`; Salvage never hot-patches the product.

7. **Closure + postmortem** → `references/reentry-and-closure.md`

## Decision-card protocol

Present **one decision at a time** — via AskUserQuestion when available, else a compact prose question (Detect → Use → Else-Disclose, per `../vigil/references/external-capabilities.md`). Every card carries:

- the recommendation (one line, with why),
- cost / tradeoff (downtime, data-loss window, effort),
- reversibility (can this be undone, and how),
- exactly what will happen on approval (the commands or steps, verbatim).

Destructive or production-affecting actions **always** stop at a card — never batched into a previously approved "plan". Actions the agent cannot perform (dashboard-only settings, human-only credentials) become precise human instructions: "click X, run Y, paste the result back." The plugin's destructive-guard hook will additionally ask before narrowly destructive commands — that is expected behavior; never route around it.

## Anti-panic minimum set

Even if the user says "skip everything and just fix it", two things never compress:

1. the ~1-minute evidence snapshot (stage 2) before any mitigation, and
2. a decision card before any destructive or production-affecting action.

Everything else legitimately compresses under pressure (shorter cards, tighter checks). These two do not: skipping the snapshot destroys the ability to diagnose; skipping the card is acting on production without consent.

## Wartime output discipline

Short turns. One decision card per turn during active mitigation. No essays and no multi-page analyses until the postmortem. Incident-stage output never asserts ship-ready claims and never emits the dev flow's machine sentinels or verdict tokens — those belong exclusively to the `vigil` run inside the fix stage. This skill reports facts and asks for decisions; the readiness verdict is the dev flow's arbiter's to give, in that run.

## Incident journal

Every stage appends to `.ctide/incidents/INCIDENT-<YYYYMMDD>-<slug>.md` (schema in `references/reentry-and-closure.md`). Sanitize before writing — mask PII and secrets in log excerpts; the journal is committed as the audit trail, so nothing unmasked goes in. It is also the resume and handoff artifact: on session resume, re-read the open journal first, before doing anything else.

## Language and text integrity

Skill content is English. User-facing runtime communication — cards, questions, status summaries — follows the language the user is communicating in (default to English when undeterminable). Keep technical identifiers, commands, log excerpts, file names, and API fields verbatim regardless of the surrounding language, mirroring vigil's Language And Text Integrity rule.

## Non-goals

- on-call rotation or paging integrations
- status-page automation
- SLO management suites
- full RBAC / permission management
- DFIR-grade forensics — classify, contain, and recommend professionals only
- multi-repo incident command

## Reference loading

Keep this file as the lightweight entry point; load per stage, not all up front:

- `../map/references/operational-readiness.md` — Map preparation; the `SYSTEM_MAP.md` contract, legacy migration, staleness rules.
- `references/wartime.md` — stages 1–4: triage, evidence preservation, the mitigation loop, diagnosis.
- `references/reproduction-and-repair.md` — stages 5–6, the production-data safety gate, conditional data repair, production re-entry.
- `references/reentry-and-closure.md` — stage 7: closure checklist, journal schema, postmortem, failure-memory closure loop.
