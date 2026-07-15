# Incident `<date>-<slug>`

> Template only. Store sanitized evidence. Do not include secrets, credentials,
> personal data, customer content, or raw environment values.

## Status

- Started at (UTC): `<timestamp>`
- Reporter: `<role or sanitized identifier>`
- Severity: `<current severity>`
- Symptoms: `<observed symptoms>`
- Impact: `UNVERIFIED`
- Blast radius: `UNVERIFIED`
- Active writes: `UNVERIFIED`
- Known unknowns: `<list>`

## Map and rapid reconnaissance

- Map path: `.ctide/map/SYSTEM_MAP.md`
- Map status: `<current | stale | missing>`
- Live paths verified: `<evidence links>`
- Coverage gaps: `<list>`

## Sanitized evidence snapshot

- Captured at (UTC): `<timestamp>`
- Sources: `<logs, metrics, traces, health checks>`
- Redactions: `<data classes removed>`
- Snapshot location: `<restricted evidence link>`

## Decision card

- Hypothesis: `<testable statement>`
- Evidence: `<current evidence>`
- Exact action: `<one production-affecting action>`
- Expected effect: `<named signal and direction>`
- Risk: `<failure mode>`
- Rollback: `<exact reversible step>`
- Observer: `<owner>`
- Approval: `<explicit authority and timestamp>`

## Timeline

| UTC | Observation or action | Evidence | Result |
| --- | --- | --- | --- |
| `<timestamp>` | `<entry>` | `<link>` | `<observed result>` |

## Fault domain

- Configuration: `UNVERIFIED`
- Infrastructure: `UNVERIFIED`
- Dependency: `UNVERIFIED`
- Data: `UNVERIFIED`
- Code: `UNVERIFIED`
- Reproduction: `<safe red reproduction or reason unavailable>`
- Formal repair: `/ctide:vigil <task>`

## Production re-entry

- Entry criteria: `<measurable criteria>`
- Staged rollout: `<plan>`
- Health signals: `<named signals>`
- Observation window: `<duration>`
- Rollback readiness: `<verified evidence>`

## Closure

- Impact: `<evidence-backed summary>`
- Root cause: `UNVERIFIED`
- Contributing factors: `<list>`
- Detection gap: `<gap>`
- Corrective actions and owners: `<list>`
- Failure-memory decision: `<required | not required and reason>`
- Map refresh: `<required | not required and reason>`
