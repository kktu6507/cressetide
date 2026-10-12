# Ship contract

`ship.mjs` is a single read-only pass over existing evidence: it never executes a build, test, or
deploy step, and it never writes anything — no working-tree mutation, no `.ctide/` write, no
state-changing git command. Every check reports one status — `pass` / `fail` / `not-applicable` /
`unverified` — with cited evidence; `ship` never computes a score, rate, or percentage
(`docs/benchmark-contract.md`).

`not-applicable` and `unverified` are distinct and must never be conflated: `not-applicable` means the
underlying concept genuinely does not apply to this project (no card noise). `unverified` means the
concept applies but the evidence could not be confirmed — a real gap, always disclosed, never silently
treated as clean.

## Two resolved scope decisions (binding for v1, not just implementation notes)

1. **Checksum verification is CLI-flag-only.** The checksum check runs only when the caller passes
   both `--artifact <path>` and `--checksum <path>` explicitly. `ship.mjs` never scans a directory
   heuristically to guess which file is a build artifact — guessing wrong would silently verify the
   wrong file against the wrong checksum. Neither flag supplied → `not-applicable`. Exactly one
   supplied → `unverified` (the pair is required together).
2. **Version-consistency reads `package.json` only.** No `pyproject.toml`, `Cargo.toml`, `go.mod`, or
   other manifest ecosystem is read, even when present. This is a v1 scope limit, not an oversight: a
   consuming project whose primary manifest is not `package.json` gets `not-applicable` here, never a
   false `fail`/`unverified`.

## Release-marker resolution

The marker is the latest git tag matching `vX.Y.Z` (the `v` prefix is optional — the same shape
`RELEASING.md` already defines for this repository's own tags), ordered by parsed **version** (major,
then minor, then patch), never lexicographic string sort — `v9.0.0` must not outrank `v10.0.0`. No
matching tag found → fail-open: the full ledger history is treated as pending, and the gap is
disclosed in `marker.note`, never silently treated as "nothing pending." On a shallow clone
(`.git/shallow` present), a tag can exist upstream without being fetched locally, so a locally-absent
tag is never treated as confidently absent: `marker.note` and `tagReady`'s `unverified` evidence both
disclose "history truncated — weak-signal only" rather than risking a false `pass`.

## Pending-changes reader

Every `type: "run"` record in `.ctide/ledger/runs.jsonl` with `verdict: "READY"` and a timestamp
strictly after the marker's resolved commit time counts as pending. `FIX REQUIRED` and `NOT READY`
runs are never counted (a formal repair, if any, lands as its own later `READY` run). A malformed
ledger line is skipped, never aborts the scan. No ledger, or an empty one, reads as "nothing pending"
— not an error.

## The five checks

1. **`versionConsistency`** — reads every `package.json` in the repository (excluding
   `.git`/`.ctide`/`node_modules`/`dist`/`build`/`coverage`/`vendor`). 0 or 1 manifest declaring a
   `version` field → `not-applicable` (nothing to be inconsistent with — most projects have exactly
   one manifest, and that is not noise). 2+ manifests agreeing → `pass`. 2+ disagreeing → `fail`,
   naming every `file@version`. Any manifest that fails to parse → `unverified`, naming the parse
   error — never silently excluded from the comparison as if it did not exist.
2. **`changelogTouched`** — git-diff-based: did `CHANGELOG.md` change since the marker commit
   (`git diff --name-only <marker-commit>`, inclusive of uncommitted working-tree changes, mirroring
   this repository's own `git diff --name-only <base>` convention). No `CHANGELOG.md` in the
   repository at all → `not-applicable`. No marker resolved → `unverified` (no diff boundary to
   compare against).
3. **`tagReady`** — "target version" is whatever `versionConsistency` already resolved; `ship` never
   picks or bumps a version itself. Depends on `versionConsistency` first: a `fail` (manifests
   disagree) or `unverified` (a manifest failed to parse) leaves no single trustworthy target, so
   `tagReady` reports `unverified` ("blocked by …") rather than guessing which manifest to trust. No
   declared version anywhere → `not-applicable`. Otherwise: a tag (`vX.Y.Z` or `X.Y.Z`) already
   existing for the target version → `fail` (a real duplicate-tag mistake, not a hypothetical one — a
   second tag of the same version either no-ops or errors). A dirty working tree → `fail`. Clean tree,
   no existing tag → `pass`.
4. **`migrationCompat`** — reads only the `<!-- CTIDE:TRUST:tier[:date] -->` sentinel comment inside
   `SYSTEM_MAP.md`'s `## Rollback` section, never the surrounding free-form prose (the exact
   discipline `map.mjs`'s own `map verify` already uses, and for the same reason — point-patching a
   heuristic prose matcher never converges, `FAILURE_MEMORY` 2026-07-16). Presence and well-formedness
   are checked as two independent facts, matching `map.mjs`'s own split. No `SYSTEM_MAP.md` →
   `unverified`, recommend `/ctide:map`. No `## Rollback` section → `unverified`. No trust tag found →
   `unverified`. A malformed trust tag → `unverified`, naming it. Every found tag's tier is
   `unverified` → `unverified`. The Map's recorded commit does not match current `HEAD` →
   `unverified`, disclosed as stale (reusing `operational-readiness.md`'s own staleness convention: a
   stale entry is flagged on the card that relies on it, never silently trusted). Only when the Map is
   fresh, the section exists, at least one well-formed tag is present, and no tag's tier is
   `unverified` → `pass`. The raw Rollback section text is always surfaced as `rollbackText` (capped,
   never pattern-matched) for the coordinating thread's own relevance judgment — see
   *Coordinating-thread responsibilities* below. This check never reaches `not-applicable`: every
   project with a Map has a Rollback section (the `map create`/`refresh` skeleton always writes one),
   so there is no "this concept doesn't apply" state here — only "confirmed" or "could not confirm."
5. **`checksumVerify`** (conditional) — see scope decision 1 above for when it runs at all. When both
   flags are supplied: a missing artifact or checksum file, a malformed checksum file, a wrong line
   count, or a read failure → `unverified`, naming the specific blocker. The checksum file's own
   filename column (when present) naming a different file than `--artifact` → `fail`. Digest
   mismatch → `fail`. Matching digest → `pass`. The accepted checksum-file format mirrors this
   repository's own release tooling (`.github/scripts/publish-release-core.mjs`): a line reading
   `<sha256-digest>` followed by two spaces and the artifact's filename, or a bare digest-only line
   with no filename cross-check.

## Coordinating-thread responsibilities (judgment, not mechanics — never in `ship.mjs`)

`ship.mjs` never judges whether the Rollback section's content is actually *relevant* to this batch's
pending changes — that is a language-understanding judgment, not a mechanical one
(`docs/benchmark-contract.md`'s mechanical/judgment split; see `eval/cases/ship-*.json`). After running
the script, the coordinating thread:

1. **Reads `migrationCompat.rollbackText`** against `pending[].files` and states, specifically, whether
   the Rollback content actually bears on what this batch touched — never just "the field is filled
   in."
2. **Assembles the decision card**: the pending-changes list first (default all-selected — the human
   may exclude entries before the rest of the report is generated), then each check in order, stated
   plainly with its evidence.
3. **Attaches a remediation recommendation** to any `fail`, matched to *why* it failed, never a generic
   one-size fix: a `versionConsistency` or `changelogTouched` `fail` is a code/documentation gap →
   recommend `/ctide:vigil --lite`. A `checksumVerify` `fail` means the build artifact is stale or the
   build itself was wrong, not a code bug → recommend re-running the project's own build/release
   pipeline and re-verifying, never a `vigil` fix (there is no code fix for a stale artifact).
4. **Zero pending changes** since the marker → states "nothing pending to ship" as one line, never an
   empty decision card.

## Non-goals (binding)

`ship` never executes a build, test, or deploy step. It never drafts or suggests `CHANGELOG.md`
content — only whether the file changed. It never picks or bumps a version number. It never writes
anything, anywhere. It is not a replacement for a project's own CI or release pipeline — it is a
pre-flight checklist read before using whatever a project already uses to actually publish.
