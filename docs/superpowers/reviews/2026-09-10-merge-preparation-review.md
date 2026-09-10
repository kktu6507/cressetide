# Merge preparation — disclosure note

Documentation-only preparation for opening a pull request from the feature branch to `main`. **No
product, test, spec, driver, guard or fixture was changed, no experiment was run, and no acceptance
claim is made here.** Two things are disclosed: a path redaction applied to nine public evidence
files, and the difference between what has been verified locally and what has not yet run at all.

## 1. Public evidence files carry redacted paths

Nine JSON receipts under `docs/superpowers/reviews/` embedded absolute paths from the maintainer's
own machine — a personal account name, its Windows temp directory and its home directory. Those
strings are not credentials, but they do not belong in a repository that may be read publicly, and
they are meaningless to anyone else. They were replaced with two consistent placeholders:

| Original location | Placeholder |
|---|---|
| the per-run OS temporary directory | `<TMP>` |
| the user's home directory | `<HOME>` |

The nine files:

`2026-09-08-efficiency-trivial-evidence.json` ·
`2026-09-08-efficiency-known-child-evidence.json` ·
`2026-09-08-efficiency-judge-calibration-evidence.json` ·
`2026-09-08-efficiency-l1b-evidence.json` ·
`2026-09-09-efficiency-s2-plan-evidence.json` ·
`2026-09-09-efficiency-positive-v2-plan-evidence.json` ·
`2026-09-09-efficiency-resume-capability-evidence.json` ·
`2026-09-09-plan-review-live-capability-evidence.json` ·
`2026-09-09-reviewer-output-trial-evidence.json`

**What was preserved.** Only the machine-specific prefix was replaced. Every path suffix survives
verbatim — the per-run root name, the `consumer` subdirectory, the CLI plan-file directory and its
generated filename — so each record still says which run it belongs to and where inside that run it
happened. Separator style is unchanged, so a path written with backslashes still reads as a Windows
path and one written with forward slashes inside a shell command still reads as it was issued. Every
hash, count, timestamp, session identifier, tool-use identifier, cost estimate, decision, reason and
outcome is untouched.

**What this means for digests.** No hash value was altered, so every digest in these files still
refers to exactly the bytes it always referred to — a redacted location string does not change the
file it names. Correspondingly, **the published copies are not byte-identical to the private
originals**, and must not be described as such. Where a document cites a hash for a maintainer
receipt, that hash belongs to the **retained private original**, not to any public copy.

**Diagnostic meaning is unaffected.** In particular, the plan-file evidence in
`2026-09-09-efficiency-positive-v2-plan-evidence.json` still shows an attempted write into the CLI's
own plan directory under `<HOME>`, which is the point that record exists to make: the target lay
outside the confined consumer root. The redaction changes where the reader sees that directory
lives, not that it was outside.

The substitutions were made inside JSON string values only, and introduce no quotes, backslashes or
other JSON metacharacters, so document structure is unchanged by construction. Independent
verification, including re-parsing, is the maintainer's, not this note's.

## 2. Three private links replaced with named receipts

`2026-09-09-plan-review-feasibility-codex-review.md` linked three maintainer receipts through
relative paths into the ignored runtime root. That root is never committed, so those links could
never resolve for any reader. They are now **named in plain text as private retained receipts held
outside the repository**, with the reason stated. The public acceptance receipt beside them is still
a working link, and no count, hash or conclusion in that document changed.

## 3. Manifest version declared

The root `package.json` and `cressetide/.claude-plugin/plugin.json` move from `0.6.0` to `0.7.0`,
with a matching `## [0.7.0] - Unreleased` changelog section. The candidate adds user-perceptible
runtime behaviour, so the pull-request checklist requires a bump; the validator additionally requires
manifest parity and a changelog heading for the declared version, which is why the section exists
rather than a bare `Unreleased` list. `RELEASING.md` now carries the *When to bump the version*
section the checklist refers to.

**Declaring a version is not publishing a release.** No tag, archive, checksum or attestation is
created here.

Two consequences for existing records. `plugin.json` is one of the 110 distributed plugin files, so
the protected hash set differs from earlier acceptances **by exactly that one file**. Every prior
statement that the 110 plugin files or 123 protected sources were unchanged remains true as a
statement about the acceptance it describes, which was performed against the `0.6.0` manifest; none
of them is re-asserted about this tree. The closed native archive is frozen at `0.6.0` and is
deliberately left alone — its plugin copy differing from the repository is expected, not a defect to
reconcile.

## 4. Verification status

What has been verified is **local and Windows-only**, in the historically recorded regressions, and
those snapshots describe candidate trees rather than the tree a pull request would present.

**The first clean preflight of this candidate did not fully pass**, and is kept here as history. It
recorded 2,132 tests with 2,119 passing, 12 skipped and **1 failing**, alongside passing structure
validation and evaluation cases. The single failure was `parser-ignore-wrapper.test.mjs`, *"vendored
tree is committed and free of working-tree drift"*, and its cause was a **preflight fixture-setup
error**: the snapshot had been initialised as a git repository without a tracked baseline, so the
vendored tree was reported as untracked. That was a property of how the snapshot was prepared, not an
assertion about the source, and no code change followed from it. **That first attempt is not
described as all passing.**

**Pre-push verification snapshot, 2026-09-10.** The rerun from a tracked clean checkout has since
been completed. On Node 24.19.0: **2,132 tests, 2,120 passing, 12 Windows skips, 0 failing**.
Structure validation exited 0, the evaluation cases exited 0 at 7/7, and the release publisher's
syntax check exited 0.

That run was taken before three documentation files reached their final state, so it does not cover
their current bytes: `RELEASING.md` (prose correction to the *When to bump the version* section),
`2026-09-05-producer-implementation-codex-review.md` (line-ending normalisation and the trailing
blank line described below), and this note itself. Product code, tests and version metadata are
byte-bound to the run above and unchanged since it.

This section describes state **as of pre-push**. CI for the exact final commit has not run, and
nothing here asserts or predicts its outcome.

What has **not** run: the repository's own checks against the exact commit that will be proposed. No
check run exists for the current remote head. Five workflows live in `.github/workflows/`;
`validate.yml`, `link-check.yml`, `typos.yml` and `zizmor.yml` are triggered by pull requests, while
`release.yml` is not a pull-request gate. The validation workflow runs structure validation, the test
suite and the evaluation cases on ubuntu, windows and macOS under Node 20, plus a Linux-only plugin
validation and a syntax check of the release publisher.

**Historical note, for scope.** This repository's cross-platform workflow *has* run before, and has
recorded a macOS-specific failure and its subsequent fix — see the 0.6.0 entries in `CHANGELOG.md`.
So the absence of check runs at the current tip says nothing about the branch's whole history, and
nothing here predicts whether the candidate will pass or what would cause a failure if it does not.
Windows-only local acceptance is not evidence about other platforms in either direction. The
workflows running against the exact committed bytes are the binding gate; neither this note nor the
redaction above constitutes acceptance.

**Two whitespace-only changes to `2026-09-05-producer-implementation-codex-review.md`.**
`.gitattributes` normalises text to LF, and that file was the one candidate still holding CRLF, so
every line ending in it changes on commit. Separately, `git diff --check` flagged an extra blank line
at end of file, which has been removed, leaving one terminating newline.

Both are whitespace only: no sentence, table row or recorded digest changed. The hash values in that
document are digests of **other** files, which neither change touches, so every recorded digest
remains exactly as accurate as before. What does change is that document's own byte identity — and it
was going to change from normalisation regardless, which is why the blank line was removed in the
same commit rather than left as a recurring diff warning.

## 5. Scope boundaries

This preparation carries no efficiency claim. The efficiency investigation is closed with **L3
unexecuted** — see the [final disposition](2026-09-10-efficiency-final-disposition.md) — and merging
functional work does not change that, does not require it to change, and asserts no saving, efficacy
or cross-platform result.

No raw model transcripts, reasoning traces or held-out grading material appear in the files selected
and scanned for this preparation. Unrelated maintainer material outside the repository's tracked
scope is untouched, and no historical receipt or frozen archive was rewritten.
