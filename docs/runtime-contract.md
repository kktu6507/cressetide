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
| `CTIDE_HOOK_DEBUG` | Enable bounded local hook diagnostics when set to any non-empty value; only an unset or empty value disables them. |
| `CTIDE_ENFORCE_STOP` | Upgrade the `orchestration-check.js` Stop hook from advisory to a hard block on a verdict/evidence mismatch. Recognized values are `1`, `true`, `yes` and `on`, matched case-insensitively; every other value, including `0`, leaves the hook advisory. |
| `CTIDE_REPAIR_PUBLISHED_RELEASE_ASSETS` | Explicitly authorize the reviewed release-asset repair path. Recognized only as the exact string `true`; every other value, including `1`, leaves repair unauthorized. It is one of several preconditions, not a switch on its own: repair additionally requires that both exact assets download successfully and that the downloaded bytes prove drift. Missing assets and transport failures never enter repair. |

The values `CTIDE_HOOK_DEBUG` and `CTIDE_ENFORCE_STOP` recognize are also listed
under [Machine-checked facts](#machine-checked-facts), which the test suite
compares against the hooks' actual behaviour.

Doctor and release diagnostic summaries must not expose environment values,
secrets, tokens, settings payloads, or unredacted sensitive paths. The hook debug sink is separately opt-in and may include a bounded
raw command fragment;
do not enable or collect `CTIDE_HOOK_DEBUG` where commands
may contain credentials.

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
env.CTIDE_HOOK_DEBUG.enables   = non-empty
doctor.project.checks          = failure-memory-health, incident-journals, ledger-health
ship.manifest.excludes         = .git, .ctide, node_modules, dist, build, coverage, vendor
```

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
- `.ctide/output/changed-test-inventory.json` — per-run derived scratch. The ChangedTestInventory
  producer derives it from the Git base and head and returns it in memory; `changed-test-inventory-artifact.mjs`
  is the one operation that writes it to this path, and the first write under `.ctide/output/` also
  creates that directory's own `.gitignore` guard. It is rebuildable, never a semantic truth source,
  and not committed.

  It is **not** an input to `contract-check.mjs --provenance`. That mode reads the version-2
  inventorySnapshot inside the task's committed provenance batch and never opens this file — passing
  `--inventory` is refused rather than quietly ignored, and `--task <id>` is required because the mode
  verifies one named task's committed head and does not infer a task from the store. Consumers of this
  artifact are the Step 1–4 path, and only a returned path/digest from an actual successful emission
  attests it: the mere presence of an older file here is not evidence that this run produced anything.

  **Two freshness boundaries, and they are not the same one.** The producer records the head-view and
  registry digests it derived the inventory *from*; the Step 6 consumer recomputes both from the
  repository as it stands at *verification* time and refuses a mismatch. A committed batch is
  therefore only ever accepted against a world that has not moved under it — which is also why an
  empty inventory is not a way to claim coverage of nothing.

**Which of these trees the head view can see.** The head universe hard-excludes `.git/`,
`.ctide/provenance.json`, `.ctide/output/**` and — since test-provenance v1.18 — `.ctide/ledger/**`.
The last was added because the ledger's own append otherwise moved `headViewDigest` in any repository
whose *tracked* `.gitignore` bytes did not cover it (the ledger's self-created nested guard is
untracked, and untracked guards are not ignore authority there), which made every committed batch
stop re-verifying after the next run appended. The exclusion is evaluated **before** trackedness, so
content deliberately committed under `.ctide/ledger/` is invisible to the head view as well. Nothing
else changed: `.ctide/test-adapters-config.json` keeps its exact-path observability exception, the
ignore authority is still tracked `.gitignore` bytes only, and the base content view still enumerates
**all** leaves of the base tree with no head exclusions applied to it.

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
  test-provenance-loop/
    emit.lock                              # the single global emission lock
    task-<h>.json                          # durable control state          (controller)
    task-<h>.lock                          # per-task operation lock        (controller)
    task-<h>.<pid>.<rand>.tmp              # staging, ownership-gated       (controller)
    task-<h>.review.json                   # the reviewer's returned bytes  (main thread)
    task-<h>.governance.json               # the governance draft input     (main thread)
    task-<h>.<admissionId>.payload.json    # the retained writer payload    (controller)
  output/
    changed-test-inventory.json
    test-provenance-observation.json
    contract.md
    progress.md
    baseline-before.txt
    baseline-after.txt
    evidence/
```

`.ctide/test-provenance-loop/` is the review-loop controller's reserved prefix: **durable, untracked,
tool-owned control state**. It is not run scratch like `.ctide/output/`, which any run may discard, and
it is not the append-only ledger. Its two main-thread files are the reviewer's persisted bytes and the
governance draft input; everything else is controller-owned.

**Git hygiene, stated exactly.** Unlike `.ctide/ledger/` and `.ctide/output/`, this prefix does **not**
create its own nested `.gitignore`, so keeping it out of a commit depends entirely on the consuming
project's own **tracked** `.gitignore`. Add one line there for this prefix and only this prefix —
`/.ctide/test-provenance-loop/`. Do **not** ignore `.ctide/` wholesale: that would also drop the
committed semantic state above (`map/`, `memory/`, `design/`, `incidents/`, `decisions/` and
`provenance.json`), which is meant to be tracked and to travel with the repository. This is Git
hygiene, and it is a dependency rather than a guarantee: in a project that adds no such rule, control
state can be committed.

That is a separate mechanism from the head-view exclusion below. The exclusion is a hard rule inside
the tool and holds whether or not the path is gitignored; the `.gitignore` line only governs what Git
will stage.

**Head-view exclusion.** The prefix is in the closed hard-exclusion set and is evaluated **before
trackedness**, so it never enters the head view and carries **zero** inventory or telemetry cost. The
accepted consequence is that content deliberately committed under it is invisible to the head view.
The base view is unchanged by this exclusion.

**Loss and recovery.** Ordinary `.ctide/output/` loss preserves this prefix, its locks, counters,
baselines and admissions. **Total** loss of the prefix is different: the old baseline is gone,
`consumedWitnesses` and `knownDraftIds` history becomes unknowable, and the current record set is a
new snapshot rather than a survival — a fresh budget results. That is a disclosed limitation, not
tamper-proofness.

`.ctide/output/test-provenance-observation.json` is the **test-provenance observation sidecar**: the
one measurement the run ledger cannot recover afterwards, because the two-sided effective-oracle
comparison needs base and head rich analyses that no longer exist once the batch is committed. It is
written by a standalone operation —
`skills/vigil/scripts/inventory-telemetry-observer.mjs --cwd <dir> --base-tree <oid> --task <id>`,
strict arguments, machine JSON with exit 0 or 1 — which must run **after a successful inventory
emission and before the committing write**, and which refuses rather than records if invoked after
that write. That sequencing is owned by the loop controller's `runProposalIteration`, which performs
the emission and the observation in one operation and records each attempt's outcome. Its absence is
still not an error — a failed or unavailable observation leaves that one field unavailable and the
record is written with every other value intact. Full field semantics live in
`skills/vigil/references/run-ledger.md`.

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
