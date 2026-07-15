# System Map template

> Fictional template only. Replace every placeholder with current repository
> evidence. Do not treat this file as an operational assertion.

Map schema: 1
Repository root: <repository-name>
Verified at commit: <SHA or UNBORN>
Working tree fingerprint: sha256:<64 lowercase hex characters>
Last updated: <ISO-8601 date>

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

## Refresh notes

- Remove or replace generated claims whose source path no longer exists.
- Explain conflicts with human-verified operational notes.
- Verify touched or incident-affected areas directly even when commit metadata matches.

<!-- CTIDE:MANUAL-NOTES:START -->
## Human-verified operational knowledge

Record only current, human-verified operational knowledge here. Refresh preserves
this bounded section verbatim and reports conflicts rather than silently choosing.
<!-- CTIDE:MANUAL-NOTES:END -->
