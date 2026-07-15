# Wartime stages 1–4 (triage → evidence → mitigate → diagnose)

Loaded at the start of any wartime run. Consult `.ctide/map/SYSTEM_MAP.md` throughout (trust and staleness rules in `../../map/references/operational-readiness.md`); if it is missing, run the 2–3 minute rapid recon from `SKILL.md` and continue with the gap named.

## Stage 1 — Triage (evidence-driven, not an interview)

The user likely cannot answer "is data corrupting?" — do not interrogate them. Propose and run checks instead: hit health endpoints, read error rates from the profile's observability inventory, check dependency status pages listed in the profile. Establish four facts:

1. **Severity tier.**
   - SEV1 — active data loss, full outage, or suspected security breach.
   - SEV2 — a major function down, but a workaround exists.
   - SEV3 — degraded: slow, partial, or cosmetic-but-live.
2. **Blast radius.** Which users, functions, and systems are affected — and is it growing?
3. **Is data actively being corrupted?** Check writes, not just reads: do recent records look sane, do logs show failed or partial writes? If plausibly yes, the mitigation options MUST include stop-writes / maintenance mode, presented as an owner-level decision card: deliberate downtime versus ongoing corruption. That tradeoff belongs to the owner, never to the agent.
4. **The security branch.** Ask one explicit question: "could this be an intrusion?" (unexpected admin activity, unknown outbound traffic, defaced content, impossible logins). If plausibly yes, switch posture:
   - preserve forensic evidence — do not wipe or restart what you would normally recycle;
   - avoid tipping off the attacker — no loud configuration changes on the compromised surface;
   - rotate exposed credentials — leaked API keys committed to git are common in AI-written repos; check history, not just the current tree;
   - escalate any breach/data-exposure notification decision to the named legal/privacy owner (`../../map/references/operational-readiness.md`'s Breach readiness) — the agent surfaces the situation and evidence, it never decides or sends a legally-required disclosure itself; that call belongs to the owner, never to the agent;
   - recommend professional salvage support for anything beyond containment.
   Contain; do not play forensics lab (see Non-goals in `SKILL.md`).

## Stage 2 — Preserve evidence (~1 minute, non-skippable)

BEFORE any state-changing action — a restart wipes the crime scene — capture:

- log excerpts around the failure and the exact error messages,
- timestamps: when it started, when it was detected, what changed near that time,
- the currently running version/commit and the last deploy time.

Sanitize (mask PII and secrets), then append to the journal. This is one of the two anti-panic minimums; it happens even when the user is shouting.

## Stage 3 — Mitigate (a loop, not a step)

Goal: stop the harm with reversible, no-new-code actions. Preferred moves, roughly in order: rollback via the profile's verified path, feature-flag off, degrade gracefully, scale up, maintenance mode.

**Rollback safety pre-check** before proposing any rollback: did deploys since the target version carry schema migrations, or write new-format data the old code cannot read? Answer from the profile's rollback intel; if unknown, say exactly that on the card ("migration status unknown — rollback may break reads of new-format rows").

One action per loop iteration:

1. decision card — recommendation, cost, reversibility, exact steps;
2. execute — or hand the human precise instructions and wait for their pasted result;
3. verify recovery — re-run the stage-1 triage checks;
4. journal the action and its result;
5. not recovered → next hypothesis, next card.

Never stack simultaneous changes: with two changes in flight you cannot know which one worked — or which one made it worse.

The instinct to "have the AI write a quick fix and push straight to production" is named here so it can be refused: hot-patching unreviewed code during an incident is the classic second disaster. Code changes go through stage 6 (the dev-flow handoff, `references/reproduction-and-repair.md`) after mitigation — not instead of it.

## Stage 4 — Diagnose (fault domain first, after stable)

Root-cause work happens AFTER the system is stable (mitigated), not before. Classify the fault domain first; each domain gets a different playbook line:

- **Code** — a defect in the application: proceed to reproduction (`references/reproduction-and-repair.md`).
- **Config / environment** — wrong value, missing env var, botched secret rotation: remediate directly — still via a decision card, per the anti-panic minimum set; the fixed-check is the currently failing health check turning green.
- **Infrastructure** — disk full, memory exhaustion, expired certificate, quota hit: remediate directly (clear, expand, renew, raise — still via a decision card, per the anti-panic minimum set) and define "how we'll know it's fixed" (the metric back under threshold, the new certificate expiry, headroom restored).
- **External dependency** — provider outage or API change: mitigate around it (degrade, queue, failover per the profile) and watch the dependency's status page; a provider outage has no local code fix.
- **Data** — bad or corrupted records: proceed to reproduction AND the data-repair track (`references/reproduction-and-repair.md`).

Only the code and data domains continue into stage 5. The others get direct remediation plus their own verification check, then jump to production re-entry and closure.
