# Run Ledger, Reconciliation & Consolidation

Three scripts share one append-only local file, `.ctide/ledger/runs.jsonl`: `run-ledger.mjs`
appends one `run` record after a run's verdict is locked; `run-reconcile.mjs` later disposes that
run's observation window (`scan` read-only, `close`/`expire` append-only); `run-consolidate.mjs`
computes on-demand counts over both record types. Together this is cressetide's cross-run learning
loop: a place a run's *outcome* — not just its verdict — gets recorded and later checked against
what actually happened in the repository. Every field in every record is an **event fact**, never a
freehand agent claim and never a computed rate, score, or percentage. Scores belong only to a
closed-world benchmark context (`docs/benchmark-contract.md`); this ledger lives in the open world of
real, ongoing work, so it stores none.

| Script | Mode | Reads | Writes |
|---|---|---|---|
| `run-ledger.mjs` | `append` | `git` (head, diff) | one `run` record |
| `run-reconcile.mjs` | `scan` | ledger + `git log` | nothing (read-only) |
| `run-reconcile.mjs` | `close` / `expire` | ledger | one `close` event |
| `run-consolidate.mjs` | (default) | ledger (tail-capped) | nothing |

All three are dependency-free (Node built-ins only), invoked the same way `failure-retrieve.mjs` /
`failure-consolidate.mjs` already are — from skill prose, fail-open, exit 0. None is a Claude Code
hook and none runs in CI; they are session-time helpers the orchestrating thread calls directly.

## Storage

`.ctide/ledger/runs.jsonl` is append-only. The directory self-creates its own nested
`.ctide/ledger/.gitignore` on first write (`*` then `!.gitignore`) — the same footgun-guard trick
`.ctide/output/.gitignore` uses (`references/verification-gate.md`, *Artifact Hygiene*) — so this
state is never accidentally committed even in a consuming project that has not gitignored `.ctide/`
at the root.

Unlike `.ctide/output/`, this tree is **never overwritten or truncated**. `docs/runtime-contract.md`
names it the third state class: committed semantic state (`map/`, `memory/`, `design/`, `incidents/`
— tracked by Git), untracked-but-persistent **episodic** state (`ledger/` — self-gitignored, survives
across runs, never overwritten or truncated), and untracked per-run scratch (`output/` —
self-gitignored, overwritten each run). `run-consolidate.mjs` reads only the newest ~4MB of an
oversized ledger for performance (mirrors `failure-consolidate.mjs`'s own read-cap pattern) — that is
a read-time optimization only; it never truncates or rewrites the file on disk.

## Record schemas (event facts only — never a computed rate/score)

### `run` record — appended by `run-ledger.mjs append`

```json
{
  "v": 1,
  "type": "run",
  "ts": 1737331200000,
  "task": "…",
  "base": "…sha or null",
  "head": "…sha",
  "files": ["…"],
  "verdict": "READY",
  "verify": "pass",
  "panel": "full",
  "repairs": 0,
  "findings": ["…"],
  "planned": { "paths": ["…"], "risk": "high" },
  "drift": { "outOfScope": 0, "mapCorrections": "" },
  "window": { "days": 14, "status": "open" }
}
```

- `ts` — epoch milliseconds; the caller always supplies it (the script never calls `Date.now()`
  internally on the pure builder — only the CLI wrapper does, at write time).
- `task` — capped to 300 characters.
- `base` / `head` — the pre- and post-change git refs. **`head` is always computed by the script
  itself** (`git rev-parse HEAD`) and **`files` is always computed from `git diff --name-only`** —
  neither is ever accepted as a CLI flag (there is no `--head` or `--files` flag), precisely so an
  agent cannot type a plausible-looking value in their place. `base` is optional and defaults to
  `null` when absent, never guessed.
- `verdict` / `verify` / `panel` — copied verbatim from the run's own machine sentinel lines
  (`ctide:delivery=`, `ctide:verify=`, `ctide:panel=`, `references/final-report.md`), never
  paraphrased or re-derived.
- `repairs` — the observed auto-fix-loop iteration count; floored at 0.
- `findings` — up to 20 entries, each capped to 150 characters, drawn from the run's actual Findings
  table.
- `planned.paths` / `planned.risk` — the approved plan's stated scope and risk tier (e.g. the task
  contract's `allowedPaths` / `risk` fields, `references/task-contract.md`), not a fresh judgment
  call invented at ledger-write time. `planned.risk` defaults to `null` when absent.
- `drift.outOfScope` / `drift.mapCorrections` — the observed `contract-check.mjs` scope-diff count
  and any Map corrections discovered mid-run (capped to 300 characters); this is the data the
  final report's **Plan drift** bullet narrates (`references/final-report.md`).
- `window.days` — the observation window for reconciliation; defaults to 14 when absent, zero, or
  negative. `window.status` always starts `"open"` on a fresh record; the ledger has no in-place
  update, so a run's disposition lives in a *separate* `close` event, correlated by `head`, not by
  mutating this record.

Absent optional inputs become `null` (`base`, `planned.risk`) or an empty array/string (everything
else) — the script never guesses a value it was not given.

### `close` event — appended by `run-reconcile.mjs close` / `expire`

```json
{ "v": 1, "type": "close", "ts": 1737345600000, "ref": "<head-sha>", "as": "escaped", "reason": "…" }
```

- `ref` — the `head` SHA of the run record being disposed.
- `as` — exactly one of `escaped` | `survived` | `superseded` | `building-upon`. `close` rejects any
  other value and writes nothing.
- `reason` — capped to 300 characters. The disposition reason always comes from the calling agent
  (or, for `expire`'s one auto-close path below, a fixed literal); `run-reconcile.mjs` never invents
  *why* a run is being closed, only shapes and appends the event once told. `close` requires it
  non-empty after trimming whitespace — an absent or blank `--reason` is rejected and writes nothing.

No field in either schema is ever a computed rate, average, or percentage — both are raw event facts.

## Reconciliation lifecycle

`scan` → the agent disposes each flagged candidate with a reason → the main thread writes the
disposition via `close` / `expire`.

1. **`scan` (read-only, deterministic-raises).** For every ledger `run` record not yet matched by a
   `close` event, `scan` fetches `git log` since that run's own timestamp and checks file overlap
   between the run's recorded `files` and each subsequent commit's changed files. Overlap always
   outranks window status — a past-window run with real overlap is never silently folded into
   "expired." Each pending run classifies as exactly one of:
   - **candidate rework** — overlap exists and at least one overlapping commit's subject matches a
     narrow, word-boundary, case-insensitive rework pattern (`fix` / `revert` / `hotfix` / `regress`).
   - **needs human review** — overlap exists but no overlapping commit's subject matches that
     pattern. `scan` prints this as its own distinct line (never merged into "clean"): *"‑ `<head>` —
     overlap: `<files>` — commit `<sha>` "`<subject>`" (no fix/revert marker; ambiguous, not resolved
     silently)"*.
   - **expire candidate** — the run is past its `window.days` and no overlap was detected at all.
   - **open** — still within its window, no overlap; silent by design (nothing to report yet).

   `scan` is provably read-only: no code path it reaches ever calls a filesystem write, and the test
   suite pins this with a byte-comparison snapshot of the ledger before/after a scan. On a shallow
   clone it discloses `(history truncated — weak-signal only)` rather than presenting a
   possibly-incomplete `git log` as authoritative.

   **Accepted limitation — renamed files.** Overlap detection (`overlapFiles`) matches a run's recorded
   `files` against each later commit's changed-file paths by plain string equality on the **current**
   path only. A later commit that **renames** the run's file to a new path — even one that then keeps
   editing the file under its new name — never string-matches the run's original recorded path, so it
   is never counted as overlap for that run; the run can auto-`expire` as `survived` even though work
   on it effectively continued under the new name. This is an accepted v1 false-negative, not a bug:
   no rename-tracking or content-similarity heuristic is attempted, matching `parseCommitLog`'s and
   `overlapFiles`' deliberately simple, dependency-free design.

   **Closed — omitted flag values (every flag, both scripts).** Both scripts' shared flag parser
   (`get(flag, def)`) now guards the swallow at its one shared root: before ever returning the token
   that follows a flag as that flag's value, it checks whether that next token is itself one of the
   file's own recognized flag names (`KNOWN_FLAGS`, exported from each script) — if so, the value is
   treated as omitted and the flag's own default applies instead. This closes the class uniformly for
   every flag in both `run-ledger.mjs` and `run-reconcile.mjs` (`--cwd` / `--now` included), not per
   flag: an invocation that passes `--cwd` while omitting its directory argument (e.g. `close --cwd
   --ref <sha> …`) now falls back to the real cwd rather than resolving to the literal next flag
   token, so it can no longer silently write under a stray directory. A loop-based test in each
   script's own test file proves this across every (flag, swallower) pair in that file's complete
   flag set, not just the previously-patched `--ref` / `--reason` cases.

2. **The agent disposes each candidate with a reason.** On the high-risk plan-grounding path this is
   `navigator`'s Stage A, as part of its draft (`references/plan-grounding.md`); on low/medium-risk
   work it is the main-thread scan wired directly in `SKILL.md`'s lifecycle step 2. Either way the
   disposing agent chooses one of `escaped` / `survived` / `superseded` / `building-upon` per flagged
   candidate, or reports `needs human review` verbatim when the scan itself returned that status.

3. **The main thread writes `close` / `expire`, post-approval only.** This is the single-writer
   discipline `FAILURE_MEMORY.md` already uses (`references/verification-gate.md`, *Failure Memory* —
   reviewers and other agents only propose; one thread performs the actual write) applied to a second
   shared mutable file: only the main thread calls `run-reconcile.mjs close` or `run-reconcile.mjs
   expire` — `navigator` and the low/medium main-thread scan never call either themselves, which is
   what lets a grounding pass run before human approval without writing to the tree. This write is
   executed by `SKILL.md`'s Implementation step 3 ("Execute reconciliation dispositions").

   The two subcommands differ in what they require before they write, and this is stated once, here,
   deliberately — **`close` always requires the disposing agent's classification and reason in hand**;
   it never writes without being told what happened and why. **`expire` is the one deliberate,
   disclosed exception**: for the single unambiguous bucket a scan can produce — a past-window run with
   zero overlap detected at all — it auto-writes `{ "as": "survived", "reason": "window expired with no
   detected overlap" }` with **no** agent or human input, because that bucket is by construction
   uncontested: nothing happened to the run's files that any later commit touched. The alternative —
   requiring a human to confirm every boring "nothing happened" window-close — would reintroduce the
   unbounded-growing-open-window problem reconciliation exists to solve in the first place. This is the
   one exception; it does not weaken `close`'s own requirement above.

   - **`close`** is append-only and requires a valid `--ref`, one of the 4 literal `--as` values, and a
     non-empty (after trimming whitespace) `--reason`; an invalid, missing, or blank value for any of the
     three is rejected without writing anything (still exits 0).
   - **`expire`** only ever auto-closes runs classified exactly **expire candidate** (past-window
     **and** zero overlap detected at all) — a run with *any* detected overlap, even a "needs human
     review" one, is never auto-closed by `expire` (see the exception above for what it writes and why).

`scan` never resolves an ambiguous overlap to a clean pass. This mirrors the general rule
`~/.claude/FAILURE_MEMORY.md`'s 2026-07-16 Ops-Profile trust-marker entry closes on — "ambiguous /
unrecognised input must produce a loud 'needs human review' finding, never a silent clean pass" —
applied here to a different mechanism (file-overlap + commit-message heuristics, not prose-marker
parsing), but the same rule: ambiguity must surface, never vanish.

## Consolidation

`run-consolidate.mjs` recomputes the following from the ledger on every call, fresh, storing nothing:

- `open` — the count of `run` records with no matching `close` event (matched by `head`/`ref`).
- `closedByType` — a tally of every `close` event by its `as` value (`escaped` / `survived` /
  `superseded` / `building-upon`).
- `escapedInWindow` — the count of `escaped` closes whose `ts` falls within the last `windowDays` of
  `now`.
- `insufficientHistory` — `true` whenever fewer than 3 `close` events have **ever** been recorded
  (not just in-window); this is the same "no data ⇒ no claim" honesty guard `failure-consolidate.mjs`
  already uses, so a thin ledger never produces a fabricated rate.
- `alarm` — `true` only when **both** `insufficientHistory` is false **and** `escapedInWindow >=
  threshold`. `alarm` is never `true` while `insufficientHistory` is `true`, even if the raw window
  count alone would already cross the threshold.

`--json` prints exactly one line of parseable JSON and nothing else:

```
{"open":N,"closedByType":{"escaped":N,"survived":N,"superseded":N,"building-upon":N},"escapedInWindow":N,"windowDays":N,"threshold":N,"alarm":bool,"insufficientHistory":bool}
```

Defaults: `windowDays` 14, `threshold` 3 (the plan-gate-decided tripwire: **14 days / ≥3 escaped
closures**). No score, rate, or percentage is ever stored anywhere by this script — it only computes
counts on demand, purely for display.

## The post-verdict boundary

`run-consolidate.mjs` runs **strictly after `arbiter`'s verdict is already locked**. Its output is
relayed to the **report** framed for the **user's reading only** — a plain one-line fact (`Ledger: 12
open · 1 escaped/14d`, plus `— retro suggested` only past threshold, `references/final-report.md`).

It **must never be reasoned over to adjust the current run's own scope, risk tier, panel selection,
or verdict.** This is the plan's one deliberate correction of a naive "just wire it into delivery"
design: an aggregate about *past* runs is evidence for a future retro (`docs/advanced/retro-practice.md`),
never a live input the orchestrator feeds back into *this* run's decisions. A high escaped-closure
count does not retroactively change this run's risk tier, does not add or remove a reviewer from this
run's panel, and does not alter this run's verdict — it is disclosure to the human, delivered after
the decision that matters (the verdict) is already final.

## CLI invocations

```
node ${CLAUDE_PLUGIN_ROOT}/skills/vigil/scripts/run-ledger.mjs append --task <text> [--base <sha>] --verdict <text> --verify <text> --panel <text> [--repairs <n>] [--findings "a|||b"] [--planned-paths "g1,g2"] [--planned-risk <high|medium|low>] [--drift-outofscope <n>] [--drift-map <text>] [--window-days <n, default 14>] [--cwd <dir>] [--now <epoch-ms>]

node ${CLAUDE_PLUGIN_ROOT}/skills/vigil/scripts/run-reconcile.mjs scan [--cwd <dir>] [--now <epoch-ms>]
node ${CLAUDE_PLUGIN_ROOT}/skills/vigil/scripts/run-reconcile.mjs close --ref <head-sha> --as <escaped|survived|superseded|building-upon> --reason <text> [--cwd <dir>] [--now <epoch-ms>]
node ${CLAUDE_PLUGIN_ROOT}/skills/vigil/scripts/run-reconcile.mjs expire [--cwd <dir>] [--now <epoch-ms>]

node ${CLAUDE_PLUGIN_ROOT}/skills/vigil/scripts/run-consolidate.mjs [--cwd <dir>] [--window-days 14] [--threshold 3] [--json] [--now <epoch-ms>]
```

`run-ledger.mjs append` derives `head` (`git rev-parse HEAD`) and `files` (`git diff --name-only`)
itself — never pass these as flags; there is no `--head` or `--files` flag to pass them through.

`--now <epoch-ms>` (all three scripts, every subcommand) overrides the wall clock the script would
otherwise read via `Date.now()`. It is a determinism seam for the test suite — every test in
`test/run-ledger.test.mjs` / `test/run-reconcile.test.mjs` / `test/run-consolidate.test.mjs` pins it so
window/threshold comparisons never depend on real elapsed time — not for production orchestrator
invocations, which should omit it and let the script read the real clock.

## Invariants

- **Never a hard dependency.** Every write path is fail-open: an fs/git error swallows to a boolean
  or empty result rather than throwing, and the CLI always exits 0.
- **No score, rate, or percentage is ever stored.** The ledger holds only event facts; `run-consolidate.mjs`
  computes counts on demand for display only, never persisting a derived figure.
- **Gitignored, never committed** into the consuming repo — see *Storage* above.
- **Concurrent-append safety is a short-write assumption, not a size-enforced guarantee.** Two
  processes appending at once rely on each line landing under the OS's atomic-append boundary for a
  single `write()` call — the same short-write assumption `failure-retrieve.mjs` already documents in
  its own comments for its usage ledger. True in practice for every capped field (`task` / `findings` /
  `driftMap` / `planned.paths`), but not size-enforced on `files`, which tracks the real `git diff` and
  can grow past it on an unusually large change; `test/run-ledger.test.mjs`'s concurrent-append test
  exercises the common (short-line) case, not an arbitrarily large one.
- **Language.** Per `SKILL.md` *Language And Text Integrity* — user-facing text follows the user's
  language; the schema field names, the 4 `--as` literals, and the machine sentinel values copied
  into `verdict`/`verify`/`panel` stay verbatim.
