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
| `ctide.planGate` | Require plan approval before non-trivial implementation. |
| `ctide.contractGuard` | Check task scope and acceptance-criteria contract evidence. |
| `ctide.destructiveGuard` | Intercept supported destructive mutations for advisory review. |
| `ctide.preserveOnCompact` | Preserve bounded workflow state across conversation compaction. |

Agents must not edit settings to bypass a guard.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `CTIDE_HOOK_DEBUG` | Enable bounded local hook diagnostics when set to any non-empty value; only an unset or empty value disables them. |
| `CTIDE_REPAIR_PUBLISHED_RELEASE_ASSETS` | Explicitly authorize the reviewed release-asset repair path. |

Doctor and release diagnostic summaries must not expose environment values,
secrets, tokens, settings payloads, or unredacted sensitive paths. The hook debug sink is separately opt-in and may include a bounded
raw command fragment;
do not enable or collect `CTIDE_HOOK_DEBUG` where commands
may contain credentials.

## Hooks

The plugin wires exactly six fail-open hooks:

| Hook | Debug prefix | Responsibility |
| --- | --- | --- |
| `plan-gate.js` | `[ctide plan-gate]` | Preserve the read-only plan and approval boundary. |
| `destructive-guard.js` | `[ctide destructive-guard]` | Review supported destructive filesystem, Git, or infra/data-store actions. |
| `contract-guard.js` | `[ctide contract-guard]` | Check changed-path and acceptance-criteria scope evidence. |
| `load-failure-memory.js` | `[ctide load-failure-memory]` | Route relevant repository-local prevention lessons. |
| `compact-fidelity.js` | `[ctide compact-fidelity]` | Preserve bounded state needed to continue safely. |
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

This root spans three state classes: committed semantic state (`map/`,
`memory/`, `design/`, `incidents/`, `decisions/` — tracked by Git in the
consuming project), untracked-but-persistent episodic state (`ledger/` —
self-gitignored via its own nested `.gitignore`, survives across runs, never
overwritten or truncated), and untracked per-run scratch (`output/` —
self-gitignored, overwritten each run).

Two canonical paths the provenance layer owns:

- `.ctide/provenance.json` — tracked committed canonical semantic state, holding Sources, Clauses,
  Transitions, Records, DecisionPoints and TaskStates. It is committed alongside the code and tests
  that reference it, so a fresh clone or CI run can resolve the whole chain. Only
  `provenance-store.mjs`'s single-writer domain transactions may modify it; it is not per-run
  scratch, and no checker ever writes to it. "Tracked" describes the CONSUMING project — this tool
  repository ignores its own `/.ctide/` when dogfooding, which is not an exception to the rule but a
  statement about whose state root is whose.
- `.ctide/output/changed-test-inventory.json` — per-run derived scratch, produced by the
  ChangedTestInventory producer from the Git base and head. It is rebuildable, never a semantic
  truth source, consumed read-only by the checker, and not committed.

```text
.ctide/
  provenance.json
  map/
    SYSTEM_MAP.md
  memory/
    FAILURE_MEMORY.md
    EXPERIENCE.md
  design/
    design.md
  incidents/
    INCIDENT-<date>-<slug>.md
  decisions/
    DECISION-<date>-<slug>.md
  ledger/
    runs.jsonl
  output/
    changed-test-inventory.json
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
