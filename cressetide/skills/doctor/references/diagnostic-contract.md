---
name: doctor
description: Self-check ctide's hooks + environment and print a paste-able health report. Only runs when the user invokes /ctide:doctor. No telemetry — local, on-demand, user-initiated.
disable-model-invocation: true
---

# ctide doctor — diagnostic contract

Run an on-demand diagnostic of ctide's own hooks and environment, then print a **paste-able
health report**. This exists because ctide ships **no telemetry**: when a hook fails open in a
real session, nothing surfaces. This is the opt-in, local substitute — never a background or
network call.

**This file is the single owner** of Doctor's diagnostic steps, evidence rules and report format;
`SKILL.md` only names the entry points. **Read all of it before running the helper** — the
helper's rows are interpreted by the rules below, and step 6 covers what the helper cannot verify.

Be concise; this is a diagnostic, not a workflow. Nothing here modifies your project or your user
configuration: the helper's own temporary probe directory is created and removed inside the helper.
If a step cannot run, name the exact command, the blocker and the remaining uncertainty, and continue.

**Stay inside this run.** A passing helper row is the evidence for its check — do not re-verify it.
In particular, do not list or search machine-wide locations such as the system temporary directory,
and run no cleanup or existence check of your own there. This limits only such extra checks; the
steps below that are yours to run — resolving the root, reading this file, enablement and PATH — are
unaffected. Leftovers or activity from other processes are not
evidence about this plugin, so do not investigate or report them. Go further only when the user
asks, or when a specific check failed and its evidence points further, and tie anything you report
to this run.

## Steps

1. **Plugin root.** Resolve it from the first available canonical source, in order:

   1. **The host-expanded skill invocation.** `SKILL.md` writes `${CLAUDE_PLUGIN_ROOT}`, which the
      host substitutes into the skill text before you see it, so the path arrives already resolved
      and is passed to the helper as `--plugin-root`. The helper gives that argument precedence over
      the environment by design. This is the normal path, and it is canonical even when the variable
      is **not** set in an ad-hoc shell subprocess — a `Bash` call's environment says nothing about
      how this session located the plugin. (Substitution reference:
      <https://code.claude.com/docs/en/skills#available-string-substitutions>.)
   2. Otherwise `$CLAUDE_PLUGIN_ROOT`.

   **Record which source supplied the root**, and treat "unset in a subshell" and "unresolvable for
   this session" as different findings. If neither a canonical invocation path nor the variable
   supplies a root, report that hooks can't be located from here and stop with that finding.

   Do **not** fall back to searching the filesystem for ctide installations, and do **not** pass an
   arbitrary `--plugin-root` you chose yourself: a copy found by search or guessed (an old
   marketplace cache) is not the copy this session runs, and diagnosing it produces a false health
   report — worse than no report. A live search can cause a stale copy to be reported as "DEGRADED".

2. **Run the helper** from that root — the default command in `SKILL.md`, plus `--project` only
   when the user asked for project health. The later steps name the helper rows that are their
   evidence. **Do not re-run a probe the helper already ran**; hand-run only what step 6
   requires.

3. **Identity and Node.** Row `manifest`: `.claude-plugin/plugin.json` names `ctide` at a valid
   semantic version. Row `node`: the executable and version running the helper; **Node 22.12 or
   newer is required**, compared as a full major.minor.patch version (22.11 fails). If `node` is
   **absent** from the PATH the editor or agent launched with, that is the single most common
   silent failure — **every hook no-ops** (fail-open by design) — so report it as the top
   finding. Step 6 is how you check that PATH.

4. **Hook wiring, fail-open and debug isolation.** Reuse these helper rows:

   - `hook-wiring` — exactly the three documented hook entry points (`pre-tool-use.mjs`,
     `session-start.mjs`, `orchestration-check.js`) exist and are wired through
     `${CLAUDE_PLUGIN_ROOT}` on their documented events, with no extra hook script.
   - `hook:<name>`, one per hook — a syntax check, then a harmless bounded event **and** a malformed
     input, both of which must exit 0 (the fail-open invariant), plus a `[ctide <hook>]` debug line
     showing the hook actually processed the event. `session-start.mjs` must also return
     `hookSpecificOutput.additionalContext`.
   - `hook-debug` — with `CTIDE_HOOK_DEBUG=1` in an isolated temporary directory, the `[ctide …]`
     prefix appears and `ctide-hook.log` is written there, without exposing environment values.
   - `runtime-probes` — whether the runtime probes above ran at all.

   **`unverified` is not `pass`.** The helper executes hooks only from a root whose manifest
   identity and exact wiring pass **and** whose canonical path is its own bundled copy. Otherwise
   each `hook:<name>` row is syntax-only (`runtime=skipped`) and `runtime-probes` is `unverified`
   with the reason. Report that as unverified runtime evidence, never as healthy.

5. **Guard decisions.** Rows `decision:plan-gate` (a plan-mode Write is denied) and
   `decision:destructive` (`git reset --hard` asks): the helper sends synthetic stdin to
   `hooks/pre-tool-use.mjs` with an isolated project directory and no debug; nothing executes;
   `unverified` when runtime probes are not trusted.

6. **Enablement and the editor's PATH — not helper-verifiable.** Hooks only run when the plugin is
   **enabled** (`/plugin` → Installed → ctide on). If the user reports nothing happening in real
   sessions, confirm enablement and that `node` is on the PATH **the editor/agent launched with**
   (not just the terminal's). Explain how to install, enable and reload `ctide@kktu` — the helper's
   `guidance` lines carry the commands — and never change user configuration yourself.

7. **Inventory.** Row `skills`: the five public skill directories exist. Row `agents`: the eleven
   `*.agent.md` files in `agents/`, each with a matching frontmatter `name`.

8. **No telemetry.** Row `telemetry`: no telemetry or network probe was performed.

## Project health (`--project`)

`--project` is opt-in and additive: it appends two more checks on top of the plugin-health steps
above, which always run unconditionally either way — it is never folded into the default
`/ctide:doctor` invocation, and the plugin-health report stays byte-for-byte unchanged when the flag
is absent. `--cwd <path>` points it at a project other than the current working directory
(resolution order: `--cwd`, then `CLAUDE_PROJECT_DIR`, then `process.cwd()`). The command is in
`SKILL.md`.

- **`failure-memory-health`.** Resolves the project's `FAILURE_MEMORY.md`, reusing `failure-retrieve.mjs`'s own `resolveMemoryFile` — but scoped to its two project-local tiers only (`.ctide/memory/FAILURE_MEMORY.md`, then the legacy `ai/FAILURE_MEMORY.md`). `resolveMemoryFile`'s own third tier, the machine-global `~/.claude/FAILURE_MEMORY.md`, is deliberately never consulted here: a `--project` report must never describe machine-global state as if it were the project's own. Summarizes the resolved file's real `consolidationReport()`/`tagRecurrenceCandidates()` output — reused directly from `vigil`, never reimplemented. No project-local file found: `unverified` (this includes the case where a global file exists on the machine but the project itself has none — never silently substituted). File found: `pass`, with the entry count and any expire/retired/tag-recurrence candidates stated explicitly (never a bare "clean" that hides whether the file actually parsed). A genuine filesystem read error (permissions, I/O) on a file that was found is named specifically and reported as `fail`, distinct from the "0 entries" case. `pass` here means the check itself completed, not a grade on the project's memory-file content. `vigil`'s modules are loaded lazily, only on this code path; a load failure there is reported as this check's own `fail`, never a crash of the whole `doctor` run.
- **`incident-journals`.** Scans `.ctide/incidents/*.md`. No such directory: `unverified`. A directory that exists but cannot be read (permissions) is named specifically and reported as `fail` instead, distinct from the not-found case. Each journal's `Status:` field (`salvage`'s own schema, `references/reentry-and-closure.md`) is read under one rule: confirmed closed only when `Status:` is present and reads exactly `closed`; every other case — `open`, `mitigated`, a missing line, or one that does not parse — is not confirmed closed and gets its own `incident:<slug>` entry (mirroring the `hook:<name>` per-item pattern), naming which case applies and the age in days derived from the `INCIDENT-<YYYYMMDD>-<slug>.md` filename. Two journals that independently settle on the same descriptive slug (different filename dates) are disambiguated to `incident:<full-filename-stem>` instead of colliding on one `incident:<slug>` entry. Zero non-closed journals collapse to one summary entry, `incident-journals: pass, 0 open`, instead of per-item noise.

An unexpected internal error while running either check above (not a case either one anticipates) is caught and reported as a separate `project-health: fail` entry instead of crashing — this is a safety net naming that the `--project` machinery itself hit an unexpected internal error, not a third diagnostic check and not an aggregate/summary of the other two; it should never appear during normal operation.

When `--project` finds something actionable, the report's `guidance` array appends a pointer to the real owner of the next step — never a new remediation path of its own: `FAILURE_MEMORY.md` findings (expire candidates, retired entries, or tag-recurrence pairs) point to a `vigil` run (or a direct edit for a trivial single-entry cleanup); a non-closed incident points back to `salvage`'s closure flow. A guidance line is omitted entirely — never left as an empty placeholder — when `--project` was not passed, or was passed but found nothing actionable. Both checks are purely diagnostic, like every other `doctor` check: they report facts (counts, statuses, ages), never a threshold judgment on what counts as "too long," and they never mutate `.ctide/`.

## Report

Print a compact table with one row per hook, taken from the helper: `OK` (the row passed — fired,
exit 0, processed) / `no-op` (exit 0 but `processed=0` — the hook ran but never handled the
event) / `FAIL` (non-zero exit, or wrong output shape) / `unverified` (`runtime=skipped`).
Add the two decision rows (`decision:plan-gate`, `decision:destructive`) with their status, the Node
status, and **which source supplied the plugin root**: the host-expanded invocation,
`CLAUDE_PLUGIN_ROOT`, or `none — not diagnosable from here`. Name the source, never
its value; the helper itself reports the root only as `<bundled-plugin-root>` or `<plugin-root>`,
by design. With `--project`, add its rows and any `guidance` pointers.

End with a one-line verdict (**healthy** / **degraded** / **broken**) and, if degraded/broken, the
most likely cause and fix; a plugin whose runtime evidence is `unverified` is not **healthy**. A
**healthy** verdict adds no speculative troubleshooting for plugin checks that passed. That does not
suppress `--project` output: its rows and every `guidance` pointer the helper emits are still
reported, including for an actionable finding whose check completed with `pass`. State
that no telemetry or network probe was performed. Do not report a live plugin smoke unless an
authenticated Claude Code session actually loaded and exercised the installed plugin. Tell the user
they can paste this report into a
[`Verified ctide run`](https://github.com/kktu6507/cressetide/issues/new?template=verified-run.yml)
issue or a bug report — it is the only health signal ctide has.
