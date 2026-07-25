# Doctor `--project` ledger-health Check — Design Spec

## Problem

The prior `doctor-project-health` spec (2026-07-23) explicitly scoped ledger/escaped-closure health
*out* of `--project`'s two new checks, reasoning that it "already surfaces automatically on every
real vigil run via `run-consolidate.mjs`." That assumption held only conditionally — on the final
report actually being emitted with its `ctide:verify=` sentinel, which is what gates both the
`### Live run` block and the `run-ledger.mjs append` call (`references/final-report.md`). This
session found a concrete case where that gate silently never fired: four real, reviewed, delivered
commits landed on `main` after the last ledger entry (2026-07-23, the `doctor-project-health` run's
own still-`open` window) without a single new `run` record — because the orchestrator's own final
messages substituted casual prose summaries for the mandated sentinel-line report, so
`ctide:verify=pass` was never present for the Stop hook's advisory 4 (`orchestration-check.js`) to
even key off. The hook's own design is deliberately sentinel-gated with no prose fallback (avoiding
false positives), so total sentinel *absence* — as opposed to a wrong sentinel value — is a
structural blind spot it cannot close by design.

The gap splits into two distinct, independently-real facts:

1. **Reconciliation debt** — an existing ledger `run` record's observation window goes unclosed past
   what a normal planning-round `run-reconcile.mjs scan` would have caught, simply because no new
   planning round happened to trigger a scan. `run-reconcile.mjs`'s own `scan`/`consolidateState`
   logic already computes this correctly; nothing new needs to be built for it, only surfaced
   on-demand.
2. **Missing append** — real work landed without ever producing a `run` record at all. `scan` cannot
   detect this by construction (it reconciles existing records against later commits; a commit with
   no corresponding record has nothing to reconcile from). No mechanical signal can safely classify
   *which* commits should have had a ledger entry (indistinguishable from a legitimately-trivial,
   non-vigil commit without prose inference) — the same ambiguity `orchestration-check.js` already
   avoids by design. This spec reports the plain fact (commit count since the ledger's last known
   `head`) and stops there.

## Non-goals

- Not a fix-applying tool — purely diagnostic, matching `doctor`'s existing character and the two
  sibling `--project` checks.
- Not a new score, ratio, or judgment on the commits-since-last-entry count — reported as a neutral,
  git-derived fact only; the human decides whether it is concerning. No closed-set is ever collapsed
  into a pass/fail verdict here.
- Not a replacement for, or a trigger of, `run-reconcile.mjs close`/`expire` — this check only reads;
  it never disposes a ledger window itself. Disposal stays the disposing agent's job at the next real
  planning round, per `references/run-ledger.md`'s single-writer discipline.
- Not injected into `SessionStart` or any live vigil run's working context — manually invoked only
  (`/ctide:doctor --project`), consistent with this repo's own settled design decision that the
  ledger must never be fed back into a run's own scope/risk/panel decisions, and that an agent must
  not read back a self-referential health signal inside the same working context.
  (`docs/advanced/retro-practice.md` / the run-ledger post-verdict-boundary rule.)
- Not a new Stop-hook advisory. A hook-side check for total sentinel-absence was considered and
  rejected for this task: it would reintroduce the prose/behavior-inference risk
  `orchestration-check.js`'s authors explicitly designed away from. Out of scope here; the actual
  fix for that gap is the orchestrator reliably emitting the existing sentinel contract, which is a
  process-discipline correction, not a new mechanism.
- Not per-item enumeration of every open ledger window (unlike `incident-journals`' per-item
  `incident:<slug>` rows). A single aggregate line is proportionate here because open windows already
  auto-resolve via `expire` within their window, unlike incidents, which have no such backstop; adding
  enumeration would require new logic beyond what `consolidateState`/`formatDigest` already provide.

## Architecture

One new check function, `checkLedgerHealth(cwd, checks, now)`, added to `doctor.mjs` alongside the
two existing `--project` checks, same signature shape and `result(name, status, detail)` contract.

**Data sources — all reused, none reimplemented.** Three new lazy dynamic-import constants
(`VIGIL_LEDGER_MODULE`, `VIGIL_CONSOLIDATE_MODULE` — already exists for `failure-memory-health`, not
duplicated — `VIGIL_RECONCILE_MODULE`), matching the existing `VIGIL_RETRIEVE_MODULE` pattern:

- `runsLedgerPath(cwd)` / `readRunsLedger(text)` (`run-ledger.mjs`) — locate and parse the ledger.
- `readLedgerTailCapped(file)` (`run-consolidate.mjs`) — same tail-cap read already used for an
  oversized ledger; no new read path.
- `consolidateState(records, { now, windowDays, threshold })` and `formatDigest(state)`
  (`run-consolidate.mjs`) — the existing open/closedByType/escapedInWindow/alarm/insufficientHistory
  computation and its human-readable summary line, used exactly as `run-consolidate.mjs`'s own CLI
  uses them.
- `runRecords(records)` (`run-reconcile.mjs`) — filters to `run`-type entries; the ledger is
  append-only and chronological, so the last element is the most recent run's record.

**The one genuinely new piece**: from the most recent `run` record's `head`, run
`git log <head>..HEAD --oneline` against `cwd` (spawnSync, explicit argv array, matching this repo's
established git-shelling safety convention — no shell interpolation) and count the output lines. This
does not need `run-reconcile.mjs`'s `parseCommitLog`/`overlapFiles`/`classifyRun` (those exist to
classify *which* commits touched *which* run's files — a different, heavier question); a line count
answers only "how far has HEAD moved past what the ledger last recorded," nothing more.

**Combining into one check row**, matching `failure-memory-health`'s established precedent (multiple
facts folded into one detail string, not split into separate check entries):

```
ledger-health: pass, "0 open, 0 escaped/14d; 2 commits since last entry (a1b2c3d)"
ledger-health: pass, "1 open, 0 escaped/14d — retro suggested; 4 commits since last entry (9b40071)"
```

The `— retro suggested` suffix is lifted verbatim from `references/final-report.md`'s own Ledger
bullet convention (emitted only past the alarm threshold), not a newly invented phrase.

**Status vocabulary** — identical three-state contract as the two sibling checks: `unverified` (no
ledger file at all — fail-open, no claim), `fail` (ledger file exists but a genuine read error
occurred — permissions/I/O), `pass` (the check itself completed, regardless of what it found; this
measures successful diagnosis, not a grade).

**`actionable`** is `true` only when `state.open > 0 || state.alarm` — the commits-since-last-entry
count never flips it by itself. An active repo will almost always show a nonzero count between two
`doctor` runs; treating that alone as actionable would manufacture noise and dilute the signal the
existing `open`/`alarm` facts already carry cleanly.

## Data flow

`/ctide:doctor` (no flag): unchanged.
`/ctide:doctor --project [--cwd <path>]`: existing plugin-health checks, then
`failure-memory-health`, then `incident-journals` (unchanged order), then the new `ledger-health`
appended last. Guidance-array extension: when `ledger-health` is `actionable`, append one line naming
the existing remedy ("run reconciliation disposal via the next `vigil` planning round, or
`run-reconcile.mjs close`/`scan` directly") — never a new remediation path. No guidance line for the
commits-since fact alone, consistent with it never setting `actionable`.

## Components

- `cressetide/skills/doctor/scripts/doctor.mjs` — `checkLedgerHealth`, the three new lazy-import
  constants, the guidance-array addition.
- `cressetide/skills/doctor/SKILL.md` — document the third `--project` check.
- `test/doctor-project.test.mjs` — **extends** the existing file (not a new file; this is the same
  file the sibling two checks already live in).

## Error handling

- No `.ctide/ledger/runs.jsonl`: `unverified`, no crash.
- File exists but unreadable (permissions/I/O): `fail`, named specifically — mirrors
  `failure-memory-health`'s found-but-unreadable distinction.
- Ledger exists but contains zero `run` records (defensive; should not occur since `append` is the
  only writer of that type): the commits-since sub-fact reports "no run records to anchor from";
  `consolidateState` on an empty/close-only record set naturally reports `0 open`.
- Most recent `head` no longer resolves in the current git history (rebase, squash, or a ledger
  carried over from a different clone): the `git log` range query fails; caught and degraded to
  `pass` with the limitation named in the detail text ("cannot compare — last entry's head not found
  in history"), never `fail` — fail-open, same discipline the sibling checks already use for their
  own edge cases.
- `cwd` is not inside a git repository, or `git` is unavailable: same degrade-and-disclose path as
  above, not a crash.

## Testing

Extends `test/doctor-project.test.mjs` with six new cases, matching the file's existing fixture style
(synthetic ledger files under a temp directory, no real repo state touched):

1. No ledger directory → `unverified`.
2. Clean ledger (0 open, `HEAD` equals the last record's `head`) → `pass`, exact detail text, `actionable=false`.
3. An open run record past its window with no overlap configured → `pass`, alarm reflected in text once threshold met, `actionable=true`.
4. Synthetic commits added after the last record's `head` → `pass`, correct count and short-SHA in text, `actionable` stays `false` when nothing else is actionable.
5. Ledger file present but unreadable (simulated permissions failure) → `fail`.
6. Last record's `head` rewritten to a SHA not present in the test fixture's git history → `pass` with the disclosed-limitation text, no crash.

## Scope check

Touches one existing script, its `SKILL.md`, and extends one existing test file — no new file, no new
skill, hook, or CI guard. Every reused function (`consolidateState`, `formatDigest`, `runRecords`,
`readRunsLedger`, `runsLedgerPath`, `readLedgerTailCapped`) already exists and is already tested by
its own script's test suite; the only new logic is a single bounded `git log` line count. Consistent
with a single implementation plan, same size class as the original two-check feature it extends.
