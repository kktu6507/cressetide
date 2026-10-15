# Runtime contract

This document is the public runtime vocabulary for Cressetide. Technical tokens
are literal and case-sensitive.

## Settings

Only the `ctide` namespace is supported:

```json
{
  "ctide": {
    "planGate": true,
    "contractGuard": true,
    "destructiveGuard": true,
    "preserveOnCompact": true
  }
}
```

| Key | Meaning |
| --- | --- |
| `ctide.planGate` | Deny edit tools, and obvious Bash/PowerShell writes, while the session is in plan mode. It keys on the session's permission mode; it does not track whether a plan was approved, and approval remains a workflow obligation. |
| `ctide.contractGuard` | Check task scope and acceptance-criteria contract evidence. |
| `ctide.destructiveGuard` | Intercept supported destructive mutations for advisory review. |
| `ctide.preserveOnCompact` | Preserve bounded workflow state across conversation compaction. |

Agents must not edit settings to bypass a guard.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `CTIDE_HOOK_DEBUG` | Enable local hook diagnostics. Recognized values are `1`, `true`, `yes` and `on`, matched case-insensitively; every other value, including `0`, leaves them off. |
| `CTIDE_ENFORCE_STOP` | Upgrade the `orchestration-check.js` Stop hook from advisory to a hard block on a verdict/evidence mismatch. Recognized values are `1`, `true`, `yes` and `on`, matched case-insensitively; every other value, including `0`, leaves the hook advisory. |
| `CTIDE_REPAIR_PUBLISHED_RELEASE_ASSETS` | Explicitly authorize the reviewed release-asset repair path. Recognized only as the exact string `true`; every other value, including `1`, leaves repair unauthorized. It is one of several preconditions, not a switch on its own: repair additionally requires that both exact assets download successfully and that the downloaded bytes prove drift. Missing assets and transport failures never enter repair. |

The values `CTIDE_HOOK_DEBUG` and `CTIDE_ENFORCE_STOP` recognize are also listed
under [Machine-checked facts](#machine-checked-facts), which the test suite
compares against the hooks' actual behaviour.

Doctor and release diagnostic summaries must not expose environment values,
secrets, tokens, settings payloads, or unredacted sensitive paths. The hook debug sink is separately opt-in and
redacts credential shapes (authorization headers, Bearer tokens, `token`/`secret`/`password`/`api key` values,
GitHub tokens, private-key blocks) and temp/home paths before writing; it is a best-effort scrub, so do not
enable `CTIDE_HOOK_DEBUG` where commands may carry other secrets.

## Machine-checked facts

The block below restates, in one language-neutral place, facts that this document,
the [command reference](command-reference.md) and the Doctor
[diagnostic contract](../cressetide/skills/doctor/references/diagnostic-contract.md)
state in prose. `test/documented-facts.test.mjs` observes the shipped runtime over
fixed test inputs and fails when a line omits or adds a value relative to that
behaviour, and it checks that the owning prose names every listed value. It does
not check README wording or translations, a claim that prose adds beyond these
values, or inputs outside the test's input set; those stay under human review.

```ctide-facts
env.CTIDE_ENFORCE_STOP.accepts = 1, true, yes, on
env.CTIDE_ENFORCE_STOP.case    = insensitive
env.CTIDE_HOOK_DEBUG.accepts   = 1, true, yes, on
env.CTIDE_HOOK_DEBUG.case      = insensitive
doctor.project.checks          = failure-memory-health, incident-journals
ship.manifest.excludes         = .git, .ctide, node_modules, dist, build, coverage, vendor
```

## Hooks

The plugin wires exactly three fail-open hook entry points:

| Hook | Debug prefix | Responsibility |
| --- | --- | --- |
| `pre-tool-use.mjs` | `[ctide pre-tool-use]` | Preserve the read-only plan and approval boundary (plan-gate check); review supported destructive filesystem, Git, or infra/data-store actions (destructive check); check changed-path and acceptance-criteria scope evidence (contract check). |
| `session-start.mjs` | `[ctide session-start]` | Route relevant repository-local prevention lessons; after a compaction, preserve bounded state needed to continue safely. |
| `orchestration-check.js` | `[ctide orchestration-check]` | Check review-panel and final-report contracts. |

Hook scripts accept bounded event input and must return control when input is
missing, malformed, oversized, unsupported, or an internal check fails. The
temporary debug log is `ctide-hook.log`.

Fail-open behavior prevents a workflow aid from trapping the host process. It
does not authorize an unsafe action and does not turn the hook into a security
boundary. An agent must repair the state, choose a narrower action, or ask the
user; it must not weaken the hook that reported the risk.

## Project state

`.ctide/` is the only project state root:

This root spans two state classes: committed semantic state (`map/`,
`memory/`, `design/`, `incidents/`, `decisions/` — tracked by Git in the
consuming project) and untracked per-run scratch (`output/` —
self-gitignored, overwritten each run).

```text
.ctide/
  map/
    SYSTEM_MAP.md
  memory/
    FAILURE_MEMORY.md
    EXPERIENCE.md
    .failure-memory-usage.jsonl  # local retrieval-usage ledger (failure-retrieve --log); not committed — add it to .gitignore
  design/
    design.md
  incidents/
    INCIDENT-<date>-<slug>.md
  decisions/
    DECISION-<date>-<slug>.md
  output/
    contract.md
    progress.md
    baseline-before.txt
    baseline-after.txt
    evidence/
```

Map currently supports only `.ctide/map/SYSTEM_MAP.md`. Split Map documents
such as `REPOSITORY.md`, `ARCHITECTURE.md`, `FLOWS.md`, and `OPERATIONS.md` are
not implemented.

## Findings and verdicts

Allowed severity tokens:

```text
blocker
major
minor
```

Allowed verdict tokens:

```text
READY
FIX REQUIRED
NOT READY
```

Allowed final sentinels:

```text
ctide:delivery=held|shipped
ctide:verify=pass|fail|unrun|na
ctide:panel=full|substituted:<names>
```

Only a fully passing required check set is compatible with `READY` and
`ctide:delivery=shipped`. The delivery sentinel does not state that Git,
deployment, or release operations occurred.

## Modes

```text
--lite
--deep
--no-deep
--report full
```

These flags tune review cost, evidence depth, and report detail. They do not
remove applicable safety review or turn missing evidence into a pass.
