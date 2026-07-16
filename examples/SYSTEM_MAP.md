# System Map template

> Fictional template only. Replace every placeholder with current repository
> evidence. Do not treat this file as an operational assertion.

Map schema: 1
Repository root: <repository-name>
Verified at commit: <SHA or UNBORN>
Working tree fingerprint: sha256:<64 lowercase hex characters>
Last updated: <ISO-8601 date>

## System overview

Verified at commit: <SHA or UNBORN>
Last updated: <ISO-8601 date>
Confidence: unverified
Source fingerprint: sha256:<64 lowercase hex characters>

Sources:
- <path/to/package-or-manifest-file:line>

- What the system is/does: `UNVERIFIED`
- See Architecture boundaries for components and entry points.
- See External integrations for external dependencies.

## Repository structure

Verified at commit: <SHA or UNBORN>
Last updated: <ISO-8601 date>
Confidence: unverified
Source fingerprint: sha256:<64 lowercase hex characters>

Sources:
- <path/to/package-or-workspace-file:line>
- <path/to/build-config:line>

- Languages and frameworks: `UNVERIFIED`
- Package boundaries: `UNVERIFIED`
- Build command: `UNVERIFIED`
- Test command: `UNVERIFIED`
- Generated and vendor paths: `UNVERIFIED`

## Architecture boundaries

Verified at commit: <SHA or UNBORN>
Last updated: <ISO-8601 date>
Confidence: unverified
Source fingerprint: sha256:<64 lowercase hex characters>

Sources:
- <path/to/entry-point:line>
- <path/to/public-interface:line>

| Component | Responsibility | Entry point | Confidence |
| --- | --- | --- | --- |
| `<component>` | `UNVERIFIED` | `<path:line>` | `unverified` |

## Execution flows

Verified at commit: <SHA or UNBORN>
Last updated: <ISO-8601 date>
Confidence: unverified
Source fingerprint: sha256:<64 lowercase hex characters>

Sources:
- <path/to/flow-source:line>

```text
<entry point> → <boundary> → <side effect> → <observable result>
```

Unknown callers, async boundaries, and failure paths: `UNVERIFIED`.

## Data flows

Verified at commit: <SHA or UNBORN>
Last updated: <ISO-8601 date>
Confidence: unverified
Source fingerprint: sha256:<64 lowercase hex characters>

Sources:
- <path/to/schema-or-data-client:line>

| Data | Owner | Store or destination | Trust boundary | Confidence |
| --- | --- | --- | --- | --- |
| `<data class>` | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` | `unverified` |

## External integrations

Verified at commit: <SHA or UNBORN>
Last updated: <ISO-8601 date>
Confidence: unverified
Source fingerprint: sha256:<64 lowercase hex characters>

Sources:
- <path/to/integration-config:line>

- APIs and dependencies: `UNVERIFIED`
- Identity and authorization boundary: `UNVERIFIED`
- Health or status location: `UNVERIFIED`

## Runtime and operations

Verified at commit: <SHA or UNBORN>
Last updated: <ISO-8601 date>
Confidence: unverified
Source fingerprint: sha256:<64 lowercase hex characters>

Sources:
- <path/to/deployment-config:line>
- <path/to/observability-config:line>

- Run and deploy: `UNVERIFIED`
- Health checks, logs, metrics, and traces: `UNVERIFIED`
- Rollback and kill switches: `UNVERIFIED`
- Backup and restore validation: `UNVERIFIED`

## Risk and uncertainty

Verified at commit: <SHA or UNBORN>
Last updated: <ISO-8601 date>
Confidence: unverified
Source fingerprint: sha256:<64 lowercase hex characters>

Sources:
- <path/to/risk-evidence:line>

- High-risk and destructive paths: `UNVERIFIED`
- Production-only assumptions: `UNVERIFIED`
- Missing observability: `UNVERIFIED`
- Missing rollback validation: `UNVERIFIED`

## Access inventory
| What | Where / how to read it | Runnable by | Trust |
| --- | --- | --- | --- |
| App logs | <path / command / dashboard URL + how to filter> | agent-runnable | verified: <date> |
| Error tracking | <tool + project + how to query> | human-only | `UNVERIFIED` |
| Deploy control | <command / pipeline URL> | agent-runnable | dry-run-verified: <date> |
| DB read-only access | <connection recipe; where read-only credentials come from> | human-only | `UNVERIFIED` |

## Rollback
- Exact steps: <commands, in order> (verified: <date> | dry-run-verified: <date> | `UNVERIFIED`)
- Schema migrations in recent deploys: <yes/no — which deploys, which migrations>
- New-format data: <where data written by the new version lands that old code cannot read>

## Feature flags & kill switches
- <flag> — <what it disables> — <how to flip it> (verified: <date> | dry-run-verified: <date> | `UNVERIFIED`)

## Backups
- Exists: <yes/no> — Where: <location> — Last restore drill: <date | never>

## Breach readiness
- Secure evidence store: <where to copy logs/evidence during a suspected intrusion, outside the compromised system>
- Out-of-band comms: <channel to coordinate on if the normal one may be attacker-monitored>
- Legal/privacy owner: <name/role to notify for breach/data-exposure incidents>
- Notification threshold: <what triggers a legally-required disclosure>

## Observability inventory
- <logs / metrics / alerts that exist, and the query for each>
- <if none exist, record it: "RED FLAG: no logs/metrics — incidents will be diagnosed blind">

## Run in isolation
- <how to run the system locally or in staging, including config and seed data>

## External dependencies
- <dependency> — <health-check URL / status page>

## Approvals map
- Rollback: <who may approve>
- Maintenance mode / stop-writes: <who may approve>
- Data repair: <who may approve>

## Refresh notes

- Remove or replace generated claims whose source path no longer exists.
- Explain conflicts with human-verified operational notes.
- Verify touched or incident-affected areas directly even when commit metadata matches.

<!-- CTIDE:MANUAL-NOTES:START -->
## Human-verified operational knowledge

Record only current, human-verified operational knowledge here. Refresh preserves
this bounded section verbatim and reports conflicts rather than silently choosing.
<!-- CTIDE:MANUAL-NOTES:END -->
