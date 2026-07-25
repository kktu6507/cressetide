---
name: doctor
description: Diagnoses local Cressetide plugin health, hook wiring, Node availability, fail-open behavior, debug output, and enablement without telemetry.
user-invocable: true
disable-model-invocation: true
---

# Doctor

Invoke manually as `/ctide:doctor`.

Run the bounded diagnostic helper first:

```text
node "${CLAUDE_PLUGIN_ROOT}/skills/doctor/scripts/doctor.mjs" --plugin-root "${CLAUDE_PLUGIN_ROOT}"
```

Use `--json` when machine-readable evidence is needed. The helper is read-only apart from isolated temporary probe files that it deletes before exit.

Perform read-only local probes and report pass, fail, or unverified for each item:

1. Resolve the plugin root from `${CLAUDE_PLUGIN_ROOT}` and confirm `.claude-plugin/plugin.json` names `ctide` at a valid semantic version.
2. Report the Node executable and version; Node 20 or newer is required.
3. Parse `hooks/hooks.json` and confirm exactly the six documented hook files are wired through `${CLAUDE_PLUGIN_ROOT}`.
4. Syntax-check each hook and invoke it with a harmless, bounded event. A probe must exit zero even for malformed input, demonstrating the fail-open invariant.
5. With `CTIDE_HOOK_DEBUG=1` in an isolated temporary directory, confirm the `[ctide ...]` debug prefix and `ctide-hook.log` behavior without exposing environment values.
6. Confirm the five public skill directories and eleven agent manifests exist.
7. Explain how to install, enable, and reload `ctide@kktu`; do not mutate user configuration automatically.
8. State that no telemetry or network probe was performed.

If a command cannot run, name the exact command, blocker, and remaining uncertainty. Do not report a live plugin smoke unless an authenticated Claude Code session actually loaded and exercised the installed plugin.

## Project health (`--project`)

`--project` is opt-in and additive: it appends three more checks on top of the eight plugin-health steps above, which always run unconditionally either way — it is never folded into the default `/ctide:doctor` invocation, and the plugin-health report stays byte-for-byte unchanged when the flag is absent. Add `--cwd <path>` to point at a project other than the current working directory (resolution order: `--cwd`, then `CLAUDE_PROJECT_DIR`, then `process.cwd()`):

```text
node "${CLAUDE_PLUGIN_ROOT}/skills/doctor/scripts/doctor.mjs" --plugin-root "${CLAUDE_PLUGIN_ROOT}" --project --json
```

9. **`failure-memory-health`.** Resolves the project's `FAILURE_MEMORY.md`, reusing `failure-retrieve.mjs`'s own `resolveMemoryFile` — but scoped to its two project-local tiers only (`.ctide/memory/FAILURE_MEMORY.md`, then the legacy `ai/FAILURE_MEMORY.md`). `resolveMemoryFile`'s own third tier, the machine-global `~/.claude/FAILURE_MEMORY.md`, is deliberately never consulted here: a `--project` report must never describe machine-global state as if it were the project's own. Summarizes the resolved file's real `consolidationReport()`/`tagRecurrenceCandidates()` output — reused directly from `vigil`, never reimplemented. No project-local file found: `unverified` (this includes the case where a global file exists on the machine but the project itself has none — never silently substituted). File found: `pass`, with the entry count and any expire/retired/tag-recurrence candidates stated explicitly (never a bare "clean" that hides whether the file actually parsed). A genuine filesystem read error (permissions, I/O) on a file that was found is named specifically and reported as `fail`, distinct from the "0 entries" case. `pass` here means the check itself completed, not a grade on the project's memory-file content. `vigil`'s modules are loaded lazily, only on this code path; a load failure there is reported as this check's own `fail`, never a crash of the whole `doctor` run.
10. **`incident-journals`.** Scans `.ctide/incidents/*.md`. No such directory: `unverified`. A directory that exists but cannot be read (permissions) is named specifically and reported as `fail` instead, distinct from the not-found case. Each journal's `Status:` field (`salvage`'s own schema, `references/reentry-and-closure.md`) is read under one rule: confirmed closed only when `Status:` is present and reads exactly `closed`; every other case — `open`, `mitigated`, a missing line, or one that does not parse — is not confirmed closed and gets its own `incident:<slug>` entry (mirroring the `hook:<name>` per-item pattern), naming which case applies and the age in days derived from the `INCIDENT-<YYYYMMDD>-<slug>.md` filename. Two journals that independently settle on the same descriptive slug (different filename dates) are disambiguated to `incident:<full-filename-stem>` instead of colliding on one `incident:<slug>` entry. Zero non-closed journals collapse to one summary entry, `incident-journals: pass, 0 open`, instead of per-item noise.
11. **`ledger-health`.** Resolves `.ctide/ledger/runs.jsonl` (`run-ledger.mjs`'s own `runsLedgerPath`/`readRunsLedger`, reused directly, never reimplemented) and folds two independently-real facts into one row, mirroring `failure-memory-health`'s own multi-fact-in-one-detail-string precedent rather than splitting into two entries: reconciliation debt (`run-consolidate.mjs`'s `consolidateState` — the same open/escaped-in-window/alarm computation that script's own CLI reports, reused directly) and how far `HEAD` has moved past the ledger's most recently recorded run (`git log <head>..HEAD --oneline` against the project, via `spawnSync` with an explicit argv array — never a shell string, never `execFileSync`/`execSync` — counting output lines; a neutral, git-derived fact, never a judgment). No ledger file at all: `unverified`. A genuine read error on a file that was found (permissions, I/O) is named specifically and reported as `fail`, distinct from the not-found case. `pass` otherwise, e.g. `0 open, 0 escaped/14d; 2 commits since last entry (a1b2c3d)`, with `— retro suggested` appended only once `run-consolidate.mjs`'s own alarm threshold is crossed. When the ledger has zero `run`-type records to anchor from, or the last recorded `head` no longer resolves in the current git history (rebase, squash, a ledger carried over from a different clone, a non-git `cwd`, or `git` itself unavailable), the commits-since fact degrades to a disclosed limitation named in the same detail string rather than a crash or a `fail`. The commits-since count is always a neutral fact, never a judgment: it never sets this check's own `actionable` by itself, which is `true` only when an open window or the alarm is present — an active repo will almost always show a nonzero commit count between two `doctor` runs, and folding that alone into `actionable` would manufacture noise.

An unexpected internal error while running any of the three checks above (not a case any of them anticipates) is caught and reported as a separate `project-health: fail` entry instead of crashing — this is a safety net naming that the `--project` machinery itself hit an unexpected internal error, not a fourth diagnostic check and not an aggregate/summary of the other three; it should never appear during normal operation.

When `--project` finds something actionable, the report's `guidance` array appends a pointer to the real owner of the next step — never a new remediation path of its own: `FAILURE_MEMORY.md` findings (expire candidates, retired entries, or tag-recurrence pairs) point to a `vigil` run (or a direct edit for a trivial single-entry cleanup); a non-closed incident points back to `salvage`'s closure flow; an open ledger window or an escaped-closure alarm points to reconciliation disposal via the next `vigil` planning round, or `run-reconcile.mjs close`/`scan` directly. A guidance line is omitted entirely — never left as an empty placeholder — when `--project` was not passed, or was passed but found nothing actionable. All three checks are purely diagnostic, like every other `doctor` check: they report facts (counts, statuses, ages), never a threshold judgment on what counts as "too long," and they never mutate `.ctide/`.

## 完整診斷契約

執行前必須讀取並套用 `references/diagnostic-contract.md` 的全部診斷步驟，包括 plugin-root 環境變數 fallback、六個 hook 的實際觸發／fail-open 證據，以及可貼入報告的逐 hook 結果。若該契約與本檔的強化檢查重疊，執行兩者中較嚴格者；不得省略任一診斷檢查。
