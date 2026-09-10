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

All three are dependency-free at module scope (Node built-ins only), invoked the same way
`failure-retrieve.mjs` / `failure-consolidate.mjs` already are — from skill prose, fail-open, exit 0.
None is a Claude Code hook and none runs in CI; they are session-time helpers the orchestrating
thread calls directly. `run-ledger.mjs append` additionally reaches the test-provenance collector
through a **dynamic** import inside that one path, so importing its pure builders — which
`run-reconcile.mjs` and `run-consolidate.mjs` do — never loads the provenance stack.

## Storage

`.ctide/ledger/runs.jsonl` is append-only. The directory self-creates its own nested
`.ctide/ledger/.gitignore` on first write (`*` then `!.gitignore`) — the same footgun-guard trick
`.ctide/output/.gitignore` uses (`references/verification-gate.md`, *Artifact Hygiene*) — so this
state is never accidentally committed even in a consuming project that has not gitignored `.ctide/`
at the root.

Unlike `.ctide/output/`, this tree is **never overwritten or truncated**. `docs/runtime-contract.md` names
it the third state class: committed semantic state (`map/`, `memory/`, `design/`, `incidents/`, `decisions/`
— tracked by Git), untracked-but-persistent **episodic** state (`ledger/` — self-gitignored, survives across
runs), and untracked per-run scratch (`output/` — self-gitignored, overwritten each run).
`run-consolidate.mjs` reads only the newest ~4MB of an oversized ledger (mirrors
`failure-consolidate.mjs`'s own read-cap pattern) — that is a read-time optimization only; it never
truncates or rewrites the file on disk.

**This tree is outside the head-view universe** (test-provenance v1.18, §11b.10 closed exclusions).
The nested guard above protects against an accidental `git add`; it does **not** keep `runs.jsonl` out
of the head view, because the only ignore authority there is *tracked* `.gitignore` bytes and this
guard is untracked. Without the exclusion an append moved `headViewDigest`, and every committed
provenance batch stopped re-verifying as soon as any later run appended. The exclusion is evaluated
before trackedness, so content deliberately committed under `.ctide/ledger/` is invisible to the head
view too — accepted for a path the runtime contract defines as tool-owned.

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
  "window": { "days": 14, "status": "open" },
  "testProvenance": { "…": "eighteen keys — see below" }
}
```

- `ts` — epoch milliseconds; the caller always supplies it (the script never calls `Date.now()`
  internally on the pure builder — only the CLI wrapper does, at write time).
- `task` — capped to 300 characters.
- `base` / `head` — the pre- and post-change git refs. **`head` is always computed by the script
  itself** (`git rev-parse HEAD`) and **`files` is always computed from `git diff --name-only`** —
  neither is ever accepted as a CLI flag (there is no `--head` or `--files` flag), precisely so an
  agent cannot type a plausible-looking value in their place. `base` is optional and defaults to
  `null` when absent.
- `verdict` / `verify` / `panel` — copied verbatim from the run's own machine sentinel lines
  (`ctide:delivery=`, `ctide:verify=`, `ctide:panel=`, `references/final-report.md`), never
  paraphrased or re-derived.
- `repairs` — the observed auto-fix-loop iteration count; floored at 0.
- `findings` — up to 20 entries, each capped to 150 characters, drawn from the run's actual Findings
  table.
- `planned.paths` / `planned.risk` — the approved plan's stated scope and risk tier (e.g. the task
  contract's `allowedPaths` / `risk` fields, `references/task-contract.md`), not a fresh judgment
  call invented at ledger-write time.
- `drift.outOfScope` / `drift.mapCorrections` — the observed `contract-check.mjs` scope-diff count
  and any Map corrections discovered mid-run (capped to 300 characters); this is the data the
  final report's **Plan drift** bullet narrates (`references/final-report.md`).
- `window.days` — the observation window for reconciliation; defaults to 14 when absent, zero, or
  negative. `window.status` always starts `"open"` on a fresh record; the ledger has no in-place
  update, so a run's disposition lives in a *separate* `close` event, correlated by `head`, not by
  mutating this record.

- `testProvenance` — the eighteen-key test-provenance observation block (test-provenance §11 as
  amended by D10; types and absence rules fixed there). It is carried on **every** `run` record,
  unconditionally, and it is **disclosure only** — nothing in it is ever a gate input. The block is
  derived by the collector itself; the arbiter's gate never reads it.

Absent optional inputs become `null` (`base`, `planned.risk`) or an empty array/string (everything
else) — the script never guesses a value it was not given.

### `testProvenance` — derived, never supplied

Two literals, and reading one as the other is non-conforming:

- **`null` — established absence**, which arises two ways. *Request-established*: no provenance
  identity was requested, so no store was read at all and there is nothing to be absent from.
  *Authority-established*: validated authority was reached and says the thing is not there — a
  validated store with no such task, or a task whose `committedProvenanceBatchRef` is `null`.
- **`"unknown"` — unavailable observation.** The deciding authority was not reached, or its proof was
  not available. It must never be coerced to `0`, to `null` or to `false`. `droppedForNoSource` keeps
  its own unchanged §11 literal, `"unreported"`.

An identity that **was** requested but could not be collected — the store is unreadable or invalid,
or the collector itself is unavailable — leaves `taskId` **`"unknown"`**, never `null` and never the
caller's argument echoed back as a known task.

The one exception is `converged`: a **required** boolean that combines two independent gates — the
loop gate and a current committed-batch consumer pass. A gate without positive proof is not
established, so the combined result is `false`. That is a fail-closed gate answering, not an unknown
being promoted, and a `false` means *not established*, never *refuted*.

`buildRunRecord` is pure and synchronous, reads no store and takes no telemetry parameter, so the
only honest block it can produce is the **all-unavailable** one (`defaultTestProvenance()`). "All
unavailable" is not "all `"unknown"`": three members are exceptions, and each is exact —
`taskId: null` (request-established absence: nothing was asked for), `converged: false` (a required
combined fail-closed gate returning its closed default) and `droppedForNoSource: "unreported"`
(§11's own unchanged literal). Every other member is `"unknown"`.

The **`append` CLI** replaces that block with one the collector derived **itself**: the CLI accepts no
block, metric, digest or JSON parameter. `--provenance-task <id>` names the provenance TaskState to
describe; it is **independent of `--task`**, which remains capped human prose. The store treats a task
id as an opaque map key and defines no length or character grammar, so none is invented for it —
membership is decided by lookup.

Flag handling, and the three cases are not the same:

- **absent** — the ordinary no-identity path. It is **silent**: no diagnostic, and the record carries
  the no-identity block with `taskId: null`.
- **malformed when supplied** — repeated, value-less, or empty. Each produces a stderr **diagnostic**
  and the same no-identity block with `taskId: null`, because nothing usable was supplied.
- **supplied and well-formed, but not collectible** — the block keeps `taskId: "unknown"`.

In every case exactly one record is appended and the exit stays 0: the ledger never becomes a gate.

### The five loop-derived counters — exact scopes

Their names and types are §11's, unchanged; their **ownership and scope** are §11 as amended by D10:

- **`reviewLoopIterations`** — `observedIterations`, scoped to the **retained controller window**.
- **`convergenceEpochs`** — `observedEpochs`, **cumulative** across all epochs of that window.
- **`adapterMisses`** — actual observed pipeline invocations, each contributing its own **first**
  `(class, code)` under the approved E1 allowlist. The **emit** call and the **observe** call are two
  separate invocations. Only an approved pair counts; every other failure contributes 0, and store,
  producer, registry, artifact and Git errors stay excluded, as do `E_API_ARGUMENTS` and
  `E_VIEW_INPUT`.
- **`staleBatchRejections`** — **only** main-thread `recordVerification` consumer refusals with
  `E_STEP6_SOURCE_STALE`. A §D8.4 misbinding is never counted here and fabricates no counter.
- **`lastStaleSubject`** — the **named head-ref string**, or `null`. Never a typed object.

Each counter is `{observed, uncertain}` in the control state, and **the ledger collector is the only
place that projects `"unknown"`** — it reports `observed` when `uncertain === false`, else
`"unknown"`. A known count of `0` is a measurement and is written as `0`; an unknown outcome is never
zero. `priorHistory` stays `"unknown"`. Both loop counters are documented as "since this loop control
was established".

These metrics are **available for a validated task with a null head, a legacy head, or a failed
emission** — they do not depend on a v2 head — with `converged: false` there simply because there is
no consumer pass.

`evaluate` and `inspect` **write no counter** and claim no attempt a past main thread did not make.
Ledger movement is taken from the **loop half only**: a `provenance` result the collector proved
itself, and the `combined` rollup, never move these counters.

### The observation sidecar, and who runs it

`oracleDepTriggered` is the one field the ledger cannot recover on its own: the two-sided
effective-oracle comparison needs base and head rich analyses that no longer exist once the batch has
been committed. It is measured beforehand by a standalone operation and left as a small bound sidecar
at the fixed path **`.ctide/output/test-provenance-observation.json`** (inside the run-scratch tree,
which the head universe already excludes):

```
node ${CLAUDE_PLUGIN_ROOT}/skills/vigil/scripts/inventory-telemetry-observer.mjs \
  --cwd <dir> --base-tree <oid> --task <provenance-task-id>
```

Strict arguments; machine JSON on stdout with exit 0, machine JSON on stderr with exit 1. **Ordering
is normative: it runs after a successful inventory emission and before the committing write.** The
**precommit boundary** is checked rather than conventional: the observer compares the loaded
current-store text digest against the artifact's `inputProvenanceStoreDigest`, and the committing
write necessarily moves it, so a post-commit invocation refuses rather than recording a post-state
measurement. It does **not** prove that an emission preceded it — the observer never sees the
emitter's return value, and establishing the actual invocation/proposal sequence is D's.

**Nothing invokes it automatically.** Sequencing it inside the review loop, and enforcing that
sequence, belongs to the loop controller (D), which is not released. Without a sidecar the collector
simply reports `oracleDepTriggered: "unknown"` and every other field is unaffected; the sidecar is
disclosure and is never a gate input.

### `close` event — appended by `run-reconcile.mjs close` / `expire`

```json
{ "v": 1, "type": "close", "ts": 1737345600000, "ref": "<head-sha>", "as": "escaped", "reason": "…" }
```

- `ref` — the `head` SHA of the run record being disposed.
- `as` — exactly one of `escaped` | `survived` | `superseded` | `building-upon`.
- `reason` — capped to 300 characters. The disposition reason always comes from the calling agent
  (or, for `expire`'s one auto-close path below, a fixed literal); `run-reconcile.mjs` never invents
  *why* a run is being closed, only shapes and appends the event once told.

## Reconciliation lifecycle

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
   unbounded-growing-open-window problem reconciliation exists to solve in the first place. It does
   not weaken `close`'s own requirement above.

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
closures**).

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
itself — there is no `--head` or `--files` flag to pass them through.

`--now <epoch-ms>` (all three scripts, every subcommand) overrides the wall clock the script would
otherwise read via `Date.now()`. It is a determinism seam for the test suite — every test in
`test/run-ledger.test.mjs` / `test/run-reconcile.test.mjs` / `test/run-consolidate.test.mjs` pins it so
window/threshold comparisons never depend on real elapsed time — not for production orchestrator
invocations, which should omit it.

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
