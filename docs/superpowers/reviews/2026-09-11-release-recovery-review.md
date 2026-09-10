# Release recovery — v0.7.0 gate failure, v0.7.1 path

**Pre-publication checkpoint, 2026-09-11.** This document records the state as of that date, before
any v0.7.1 publication. Every statement below about a pending gate is a snapshot of what was known
then — a later green run does not make those statements current, and none of them should be read as
an outcome.

**v0.7.0 was tagged and signed but never published: its release-workflow validation job failed, so
the publish and attest jobs never ran and no release assets exist.** The tag is immutable and stays
exactly as it is. Recovery is a new version, v0.7.1, carrying a one-line fix to a maintainer-only
guard. **Nothing in this document claims v0.7.1 has passed its gates** — the remaining ones had not
run when it was written.

## 1. What is confirmed about v0.7.0

| | |
|---|---|
| Tag | `v0.7.0`, annotated and **signed**, GitHub reports verified |
| Commit | `e6196ff` |
| Release workflow | run `34498819782`, Node 22 on Ubuntu — **validation job failed** |
| Test outcome there | 2,138 tests, 2,105 passing, **0 failing**, 31 **cancelled**, 2 skipped |
| First cancellation | `test/sentinel-slice.test.mjs`, *"guard: the stdin watchdog blocks rather than hanging"* |
| Runner message | promise resolution still pending while the event loop had already resolved |
| Downstream jobs | publish and attest **skipped**; no assets, no attestation |

The 30 further cancellations were `cancelledByParent` at zero duration — collateral from the first,
not a second defect. Note the shape: **zero tests failed.** The job's own exit status correctly
signalled failure; what the failure count alone hides is the cause. Inspecting the 31 cancellations,
rather than reading the failure count, is what identifies it.

## 2. Cause, reproduced

`readStreamWithTimeout` in `eval/loop-e2e/bash-guard.mjs` called `timer.unref()` on its deadline
timer. When the stream never ends, that timer is the **only** thing that can settle the promise — and
a bare stream holds no libuv handle, so with the timer unreferenced there may be nothing keeping the
event loop alive. The loop drains first, the promise never settles, and the process exits `0` having
produced no result. For a PreToolUse hook, exit `0` is the fail-open direction.

An isolated A/B pair confirmed the mechanism on **both Node 22.23.2 and 24.19.0**: a child running
`readStreamWithTimeout(new PassThrough(), 20).then(print)` exits 0 with empty stdout, while the same
child holding a referenced interval prints `timedOut: true, bytes: 0`.

That pins the classification. The defect is **latently deterministic** — present unconditionally in
the code — but **observationally scheduling-dependent**: the same in-suite test cancelled under Node
22 and passed under Node 24, because surrounding work happened to keep the loop referenced. A green
rerun would therefore have established nothing, and no Node version was changed to make a gate pass.

## 3. The fix

Remove the `unref()`. `finish()` already calls `clearTimeout` on every settle path — end, error,
oversize, and the deadline itself — so the timer can never delay a legitimate exit, which is what
`unref()` was guarding against. Removing it makes the promise settle reliably and preserves the
original intent: block after the deadline rather than hang.

Two child-process regressions cover the property an in-process test cannot settle either way, because
the surrounding suite **may incidentally** keep the loop referenced — which is precisely why the same
in-suite test cancelled under Node 22 and passed under Node 24 while the defect was present in both.
Each spawns a bare `process.execPath` with
`shell: false`, a hard 5-second timeout and no network or model, imports the guard by **file URL**,
and uses `.then` rather than top-level `await` so the module body finishes and the loop is free to
drain. **The assertion is on stdout content, not exit status**, because the defective build exits `0`
too. The second child pairs a 60-second deadline with the 5-second spawn timeout, so a timer that
failed to clear fails the test instead of hanging it. Temp fixtures are removed in `finally`.

The existing in-process timeout, error and oversize tests are retained; they cover the API contract.

## 4. Scope of the change

`eval/loop-e2e/bash-guard.mjs` is maintainer tooling under `eval/`, which never ships in the
`cressetide/` plugin tree. **The only shipped payload difference between v0.7.0 and v0.7.1 is the
version string in `cressetide/.claude-plugin/plugin.json`.** No hook, skill, agent, reference or
runtime behaviour changed, and no such claim is made.

Frozen-set effect, **independently verified**: the 127-file archive hashes are unchanged, and the
protected-123 comparison differs by exactly two files — `eval/loop-e2e/bash-guard.mjs` and
`cressetide/.claude-plugin/plugin.json`.

## 5. Verified so far, as of this checkpoint

Independently confirmed in copied clean checkouts:

- **Red.** Against the old guard, the new child regression fails in exactly the predicted way —
  empty output, promise never settled — rather than erroring for an unrelated reason.
- **Green, Node 22.** The full sentinel-slice file: 108 passing, **0 cancelled**.
- **Green, Node 24.** Both child regressions pass.
- `npm run validate` passes.

## 6. What remained pending when this was written

The full Node 22 suite was still running, and these had not run at all: three-OS validation on
`main`, the tag's own Node 22 release validation, the twice-built deterministic archive comparison
**from the v0.7.1 tag** (the v0.7.0 build cannot be carried over, since one file's bytes differ),
published-asset and attestation verification, and isolated marketplace discovery. No outcome is
claimed for any of them.

`v0.7.0` remains tagged, signed and verified at `e6196ff` with no release attached. That gap is a
retained record of a gate doing its job — not a withdrawn or deleted release.

Nothing here reopens the efficiency investigation, which stays closed with L3 unexecuted, and no
prior receipt or frozen archive is rewritten.
