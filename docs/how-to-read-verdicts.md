# How to read ctide verdicts

`READY`, `FIX REQUIRED`, and `NOT READY` are release-readiness decisions. They are not absolute proof that every possible bug is gone.

If you are reading a verdict from a real project, you can help the evidence log by opening a [Verified ctide run issue](https://github.com/kktu6507/cressetide/issues/new?template=verified-run.yml) and pasting the `### Live run` block with misses, false alarms, cost, and follow-up outcome intact.

## READY

`READY` means:

- the stated acceptance criteria are satisfied
- required verification evidence is present
- no unresolved blocker or major finding remains
- the arbiter considers the change responsible to deliver under the stated scope

`READY` does not mean:

- guaranteed zero bugs
- CI, linters, static analysis, or human review can be skipped
- unrelated risk outside the task scope was exhaustively searched

## FIX REQUIRED

`FIX REQUIRED` means:

- a concrete issue blocks release readiness
- a repair loop is expected to fix the issue and rerun relevant verification/review

Common causes:

- an acceptance criterion is unmet
- a regression test or edge-case check is missing
- a reviewer found a blocker or major issue
- the verification command failed or the browser evidence does not cover the changed behavior

## NOT READY

`NOT READY` means ctide cannot responsibly deliver the work in the current state.

Common causes:

- requirement or product behavior is too ambiguous
- required environment, dependency, or verification path is unavailable
- migration, security, destructive-operation, or rollout risk is unresolved
- the same blocker persists through the repair cap

`NOT READY` is not a product failure by itself. It is the workflow refusing to pretend release evidence exists.

## Sentinels

Substantial final reports include machine-readable sentinels:

```text
ctide:verify=pass
ctide:delivery=shipped
ctide:panel=full
```

These mean verification passed, delivery is being made, and the full selected review panel ran.

```text
ctide:verify=unrun
ctide:delivery=held
```

These mean required verification did not run, or delivery is intentionally held. The Stop hook reads these exact literals; keep them unchanged.

The panel line may instead read `ctide:panel=substituted:test-reviewer` — the run replaced `test-reviewer` with its own execution evidence (every behavior-changing criterion red→green + full suite green; only valid alongside `ctide:verify=pass`, and never for `intent-reviewer` or `arbiter`).

## Evidence weight

When reading examples or `EVIDENCE.md`, keep the evidence tier in mind:

- **Publicly verifiable**: a public PR, commit, release, or log can be inspected.
- **Self-attested (private)**: a sanitized private summary is useful but carries less public weight.
- **Illustrative**: useful for learning the shape of a run, but not counted as Type-B evidence.
