# Merge preparation — disclosure note

Documentation-only preparation for opening a pull request from the feature branch to `main`. **No
product, test, spec, driver, guard or fixture was changed, no experiment was run, and no acceptance
claim is made here.** Two things are disclosed: a path redaction applied to nine public evidence
files, and the difference between what has been verified locally and what has not yet run at all.

> **Status update, 2026-09-10.** The six checks on the final candidate `94e985c` passed, and pull
> request 7 merged to `main` as `4b570bd` with the tree unchanged from that candidate. **Every
> statement below about pending or outstanding CI is therefore a historical pre-push checkpoint**,
> retained as the record of what was known at the time rather than as current status. No release has
> been published and no tag exists as of this line.

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

## 5. First cross-platform CI, and what it found

PR CI on the first candidate ran link-check and zizmor green, with typos failing separately. Ubuntu
and macOS both reported **2,137 tests, 2,129 passing, 2 skipped, 6 failing**. Windows **completed** —
it did not time out — reporting **2,137 tests, 2,132 passing, 4 skipped, 1 failing**, with a test step
of **842,922 ms**; its single failure is the real-symlink case addressed below. Because `npm test`
failed on every platform, the evaluation step, the Linux-only plugin validation and the release
publisher's syntax check did not run anywhere in this PR.

A second run, on the diagnostic candidate, had typos, link-check and zizmor green, with Ubuntu and
macOS each reporting **2,138 tests, 2,135 passing, 2 skipped, 1 failing** — only the deliberately
retained ancestor assertion described below.

A third run, on the corrected ancestor regression, had every other check green. Ubuntu and macOS
reported **2,138 tests, 2,136 passing, 2 skipped, 0 failing**, with the evaluation cases at 7/7 and
the Linux plugin validation passing — the first time those two steps executed in this PR. Windows
reported **2,138 tests, 2,132 passing, 5 skipped, 1 failing** in 733,808 ms; its skip count moved
from 4 to 5 because the observed-mode test is gated on the worktree executable bit being observable.
That single Windows failure is described under *A second assumption in the same fixture* below.

**Five failures came from test expectations or fixtures** — assumptions encoded as universal facts.
**One came from the maintainer audit-name validator**, a genuine defect in that helper. The shipped
head-view implementation and the product contract are unchanged.

- **A real working-tree symlink** was created but never staged, while the test expected
  `tracked: true`. Trackedness is index membership, so `false` was correct. Both states are now
  asserted, before and after staging. That repair was **not complete** — see *A second assumption in
  the same fixture* below.
- **Two mode fixtures** used `update-index --chmod=+x`, which moves the index mode only. Where the
  worktree bit is observable the observed mode correctly wins, so on POSIX the digest never moved.
  One test additionally asserted the **opposite of its own title** — it claimed observed-mode
  precedence while only staging an index mode, and was green on Windows for the wrong reason. It now
  moves the worktree bit with the index left alone, asserts both directions, and a separately
  labelled fixture pins `core.filemode=false` **for itself only** to keep the index fallback covered
  without deleting the POSIX contract.
- **A hook-path fixture** hard-coded a Windows absolute path as a must-accept example. The validator
  is host-native by contract, so that path is correctly not absolute on POSIX. The fixture now uses a
  host-appropriate absolute path *containing a space*, preserving the original intent, and adds the
  POSIX-side rejection of a foreign Windows path. The validator was not broadened.
- **One genuine helper defect.** `unsafeAuditName` in `eval/loop-e2e/run-scenario.mjs` used
  host-native `path.basename`, so `..\b.json` was accepted on POSIX and would traverse on Windows —
  a validator whose verdict on identical input flips with the host. It now requires the name to be
  its own basename under **both** separator conventions, which also covers drive-qualified and UNC
  forms. The dot and NUL guards are unchanged.

**The remaining failure was held open, then resolved by evidence.** *History:* the tracked child under a
symlinked ancestor was correctly refused, while the *untracked* branch of the same test did not
reject on POSIX. Because "the capture omitted the entry" and "the capture resolved through the link"
have opposite fixes, the assertion was deliberately left failing and a temporary one-capture
diagnostic was added to record the facts rather than guess at them.

*What the diagnostic observed.* Ubuntu and macOS agree exactly: `git ls-files --others` returns
`untracked-dir` — the link itself — and no error is thrown; the entry is `120000` / `symlink` /
`tracked: false`; no descendant paths appear; the fixture sentinel is absent from every snapshot
buffer with the scan complete and zero read errors; **no content was read** beneath the link or at
its target, while readlink metadata was. Local Windows, single-capture, differs in the one fact that
matters: `--others` returns `untracked-dir/f.txt`, and the capture refuses with
`HeadViewSnapshotError` / `E_UNSUPPORTED_ENTRY` and detail
`{ path: "untracked-dir/f.txt", ancestor: "untracked-dir", reason: "ancestor-symlink" }`, again with
no watched content reads.

*Resolution — a test expectation correction, not a product change.* Git hands the capture one of two
enumerations, because `ls-files --others` does not descend a symlinked directory on POSIX but does
walk a Windows junction. Only the second presents a child under a symlinked ancestor, so only the
second is refusable; the first is an ordinary symlink leaf and is represented as one. The old
assertion demanded refusal unconditionally, encoding the junction enumeration as universal.

The regression test now branches on the **observed enumeration** — never on the platform, and never
on `linkKind`, which Node ignores off Windows and which therefore discriminates nothing. It requires
the filtered enumeration to be exactly the leaf spelling or exactly the child spelling and **fails on
any other shape**. The leaf branch positively verifies a successful capture, the exact symlink
metadata with `tracked: false`, bytes and digest matching an independent `fs.readlinkSync(…,
{ encoding: "buffer" })`, that those bytes are not the sentinel, that no descendant path exists, and
that no snapshot buffer contains the sentinel — with read failures propagating rather than being
swallowed, so an unreadable entry cannot masquerade as a clean one. The child branch requires the
exact error name, code, path, ancestor and reason, and that the sentinel never reaches the message.
Both branches require that no content was read through the link or at its target. The temporary
console diagnostic, the readlink watcher and the scan-report scaffolding are removed.

*Limits.* This establishes the property for **this fixture, on these platforms, at these Git
versions**. It is not a universal no-leak guarantee, and the safety it records rests on positive
observations — no content read, no descendants, sentinel absent under a complete scan — never on the
mere absence of an error.

**A second assumption in the same fixture.** The first privileged Windows run of the real-symlink
test left one failure after the trackedness repair: the expected `contentDigest` was
`SHA256("lib/helper.mjs")` while the observed digest was `SHA256("lib\helper.mjs")`. Windows
normalises the separator when it creates the reparse point, so the stored target differs from the
string passed to `fs.symlinkSync`. Both product read paths take the same
`fs.readlinkSync(…, { encoding: "buffer" })` branch and record those bytes unnormalised, before any
index consideration, so the head view was reporting exactly what the OS stored. **The defect was the
fixture's, in a second hardcoded value the earlier repair did not touch** — that repair corrected
trackedness and left this one standing. It is neither a containment defect nor a product regression,
and no product byte changed in response.

The fixture now takes `fs.readlinkSync(link, { encoding: "buffer" })` as ground truth for both the
unstaged and staged digests and returned buffers — the same convention the ancestor case uses — with
a separator-agnostic suffix anchor, and reads the target file independently so the no-follow
discrimination carries no hardcoded value of its own. Because both read paths reach readlink before
consulting the index, one ground truth covers both captures. The privileged Windows execution is not
skipped: it is the only reason either assumption was ever exposed.

**Typos configuration.** Two sealed upstream vendored files are excluded by exact path, because their
bytes are pinned and whitelisting their words would silence real misspellings in our own source. The
canonical `ASSUM` clause prefix is accepted as project vocabulary. Two opaque strings — a ULID-shaped
fixture id and a generated run-root suffix — are exempted as whole identifiers so the generic words
stay checked. One deliberately misspelled flag is exempted by an exact-literal regex rather than by
allowing a bare generic token. Separately, a missing space between "is" and a 40+ character hex
digest was corrected in three historical dialogue documents (eight occurrences); **every digest digit
is unchanged** and no other prose was touched.

**Windows job budget.** The validation workflow now allows Windows 20 minutes; ubuntu and macOS stay
at 15. The measured 842,922 ms test step inside a ~14m37s job left roughly 23 seconds for the later
steps. That job completed and reported a real failure, so this is prospective headroom for steps it
never reached, not a response to a timeout. No trigger, concurrency, permission, test or gate change
accompanies it.

**Frozen-set impact.** The protected-123 comparison still differs by exactly one file —
`cressetide/.claude-plugin/plugin.json` — and the 127-file archive is unchanged.
`eval/loop-e2e/run-scenario.mjs` is **not** a member of either frozen set: those pin the private
harness's own dependencies, of which this directory contributes `eval/loop-e2e/bash-guard.mjs`. The
helper is a maintainer file and is not distributed in `cressetide/`. Its new bytes are nonetheless
unverified by any prior native evidence, which predates the change and never covered this file. The
coverage they have so far is a scoped local run — **171 tests, 168 passing, 3 skipped, 0 failing** —
plus a separate set of 18 portable-basename counter-cases exercising the pure helper under both
`path.posix` and `path.win32` rules. Those 18 are not part of the Node test-runner count and were not
run on a POSIX host. Frozen archives and every published prior result are untouched, and nothing is
replayed.

CI for the exact final commit — the one carrying the corrected readlink-byte expectation — has not
run. The three CI runs recorded above were of earlier candidates; the most recent left Windows with
one failure, and **no claim is made that the new candidate passes Windows**.

The audit-name helper and its regressions shipped before that run and **did pass the actual Ubuntu
and macOS suites at 22cb8ad**, both fully green. On Windows at the same commit its cases were not
among the reported failures, though that job did not finish green, so no Windows pass is asserted for
it. What remains outstanding is **acceptance of the final candidate across all three platforms**, not
the helper's regressions in isolation. The scoped local results remain a local run rather than a
cross-platform one, and no acceptance is claimed ahead of a full validation round.

## 6. Scope boundaries

This preparation carries no efficiency claim. The efficiency investigation is closed with **L3
unexecuted** — see the [final disposition](2026-09-10-efficiency-final-disposition.md) — and merging
functional work does not change that, does not require it to change, and asserts no saving or
efficacy. It also does not claim completed cross-platform acceptance before final CI.

No raw model transcripts, reasoning traces or held-out grading material appear in the files selected
and scanned for this preparation. Unrelated maintainer material outside the repository's tracked
scope is untouched, and no historical receipt or frozen archive was rewritten.
