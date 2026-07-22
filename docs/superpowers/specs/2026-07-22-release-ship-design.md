# `ship`: a manually-triggered release-readiness checklist

Status: approved design, not yet implemented. Companion to `README.md`'s four-skill roster (`vigil`,
`salvage`, `map`, `doctor`) — this spec adds a fifth: `ship`.

## Problem

`vigil` ends at a `READY` verdict. Nothing in cressetide owns what happens after that — version bump,
changelog entry, tag readiness, whether a migration in this batch is actually safe to roll back, whether
a build artifact's checksum still matches. `ARCHITECTURE.md`'s own Trust model section states this
boundary explicitly: "`ctide:delivery=shipped` describes delivery of reviewed work, not a Git push or
published release." `RELEASING.md` is cressetide's own release process for publishing the plugin itself —
proof that this kind of rigor (deterministic build compare, checksum, provenance) matters, but it is
heavier than a user project should have to copy by hand, and it is scoped to this repository, not a
consuming project.

`map`'s `references/operational-readiness.md` already collects a Rollback section (`Schema migrations in
recent deploys`, `New-format data`) as part of peacetime preparation. That data currently has no consumer
at ship time.

## Non-goals

Stated up front because they were the load-bearing constraints for every design decision below:

- Never executes build, test, or deploy. `ship` reads and reports; it does not run a user's build
  pipeline. Crossing this line turns `ship` into "just another CI tool," which cressetide has already
  ruled out for the whole plugin (`README.md`).
- Never auto-triggered. Manual only, via `/ctide:ship` — the same quadrant `map` and `doctor` already
  occupy (`user-invocable: true`, `disable-model-invocation: true`), not the auto-engaging quadrant
  `vigil`/`salvage` occupy.
- Never generates changelog content. Checks whether `CHANGELOG.md` was touched since the last release
  marker; never drafts the entry itself.
- Never a dashboard, score, or percentage. Every check reports a status
  (`pass` / `fail` / `not-applicable` / `unverified`) with cited evidence, not a number.
- Never writes anything, anywhere. No working-tree mutation, no `.ctide/` write, no git command that
  changes state. This is stricter than "read-only by convention" — see *Error handling*, zero-writes
  invariant.
- Not a replacement for the user's own CI or release pipeline. `ship` is a pre-flight checklist a human
  reads before using whatever they already use to actually publish.

## Scope decisions

Resolved during brainstorming Q&A; recorded here so the reasoning survives past this conversation:

1. **Batch, not single-change, and it's one mechanism, not two.** `ship` always reads "every `READY`
   `run` record in `.ctide/ledger/runs.jsonl` since the last release marker." A single pending change is
   just the case where only one happened to accumulate — there is no separate "single-change mode."
2. **Default include-all, exclude on the decision card.** The pending list is presented with everything
   selected; the human can exclude specific entries before the rest of the report is generated. This
   reuses the existing decision-card review-before-approval shape rather than inventing a selection UI.
3. **Checksum/provenance is read-only verification only, and conditional.** Computing a fresh checksum
   requires a build, which is out of bounds per the non-goals above. `ship` verifies an *already-existing*
   artifact and checksum file against each other when both are present; when neither is present, the
   check is `not-applicable`, not a failure.
4. **v1 core checklist is four items; checksum is a conditional fifth.** Version-number consistency,
   whether `CHANGELOG.md` was touched, tag readiness, and the Map-derived migration-compatibility check
   are the core set — each has direct evidence for why it matters (cressetide's own `CHANGELOG.md` history
   records a real version-string drift incident; `SYSTEM_MAP.md`'s Rollback section already exists and is
   otherwise unused for this purpose). Checksum verification only applies to projects that produce a
   verifiable build artifact, so it is conditional rather than core.
5. **Changelog: check-only.** `ship` confirms `CHANGELOG.md` changed since the marker; it does not draft
   or suggest entry text. Keeps `ship` a checklist tool, not a content-generation tool — a different
   product shape than what a decision-card tool should be.

**Explicitly deferred, not silently dropped:** a planned-maintenance-window / downtime-coordination
variant of shipping was raised as an open question before Q&A began. It never resurfaced as a requirement
during the Q&A and is out of v1 scope. If it turns out to be needed, the natural shape is a branch inside
`ship`'s existing decision-card flow (a card that names the migration as requiring a window), not a
separate skill or mode — but that is a future spec's decision, not this one's.

## Architecture

New skill directory `cressetide/skills/ship/`. `SKILL.md` frontmatter matches `map`/`doctor` exactly:
`user-invocable: true`, `disable-model-invocation: true`. Command: `/ctide:ship`.

**No new agent.** `ship`'s job — read existing data, assemble a decision card — matches `doctor`'s shape
(no dedicated persona agent, the coordinating thread runs a deterministic script and reports) rather than
`map`'s (which needs `cartographer` because it does open-ended repository discovery). The plugin's agent
count stays at 11.

**Rejected alternatives**, recorded so they aren't re-litigated later:

- *New mode of `map`* (`map ship`). Rejected: `map`'s entire contract is one persistent, git-committed,
  periodically-refreshed document about repository structure and ops readiness. `ship`'s output is a
  point-in-time report about a specific pending batch of changes that goes stale the moment the next
  change lands — a fundamentally different shape than what `map.mjs` exists to produce. Forcing it in
  would give `map.mjs` a second, unrelated code path (read the ledger, compare manifest versions) that has
  nothing to do with repository cartography.
- *New mode of `vigil`* (offered right after a `READY` verdict). Rejected on two counts: `vigil` is
  scoped to one run's one change; `ship`'s entire point is operating across the *multiple* runs
  accumulated since the last release, a scope no single `vigil` run can see from inside itself. And
  `vigil` is explicitly auto-engaging while `ship` was explicitly agreed to be manual-only — attaching
  it to `vigil` blurs that line. `vigil/SKILL.md` also just went through a deliberate size-reduction pass
  (29341 → 23611 bytes, `CHANGELOG.md` 0.4.0); adding a new multi-run-spanning capability fights that
  direction.

## Components

- **`SKILL.md`** — thin entry point. Target: comfortably under the 500-line body ceiling Anthropic's
  official skill-authoring guidance recommends (cross-checked against this repo's own four existing
  skills: `doctor` ~35 lines, `map` ~59, `salvage` ~93, `vigil` ~172 — all well under the ceiling by
  pushing detail into `references/`). Given `ship`'s complexity (five check units plus decision-card
  assembly rules) sits above `doctor`/`map` but should stay near or under `salvage`, a reasonable target
  is roughly 60–120 lines; the actual check definitions live in `references/ship-contract.md`, not inline.
- **`references/ship-contract.md`** — the check schema and definitions, mirroring `doctor`'s
  `references/diagnostic-contract.md` and `map`'s `references/system-map-contract.md`.
- **`scripts/ship.mjs`** — deterministic helper, single mode (no `create`/`refresh`/`verify` split is
  needed — every invocation recomputes current status). Supports `--json` for machine-readable output,
  mirroring `run-consolidate.mjs`.
- **Check units inside `ship.mjs`**, each independently testable:
  - Release-marker resolver — latest tag matching `vX.Y.Z` (optionally without the `v` prefix), the same
    tag shape `RELEASING.md` already defines for this repository's own releases; ordered by
    version/ancestry, not lexicographic string sort.
  - Pending-changes reader — filters `runs.jsonl` to `verdict: READY` `run` records after the marker.
  - Version-consistency checker — **candidate reuse, not confirmed:** `map.mjs` has an existing
    `packageFacts()`-style manifest reader (`CHANGELOG.md` 0.3.1), but that entry documents it reading
    `bin` / `scripts` / `dependencies` / `description` — it does not confirm `version` is among the fields
    read today. Implementation planning must open `map.mjs` and verify whether `packageFacts()` reads
    `version`, extend it if not, and only then decide whether `ship.mjs` calls it directly or needs its
    own reader. Do not assume the reuse without that check. Once resolved: compares declared versions
    across whichever manifest files the project actually has.
  - Changelog-touched checker — git-diff-based: did `CHANGELOG.md` change since the marker.
  - Tag-readiness checker — "target version" means whatever version is currently declared in the
    project's manifest(s) *after* the version-consistency check — `ship` checks readiness for that
    already-declared number, it never picks or bumps one itself. Reports whether a tag for that version
    already exists and whether the tree is clean. **Depends on version-consistency passing first:** if
    manifests disagree, there is no single target version to check tag-readiness against — this check
    reports `unverified` ("blocked by version-consistency failure") rather than guessing which manifest to
    trust.
  - Migration-compatibility reader — parses `SYSTEM_MAP.md`'s Rollback section and its existing
    `<!-- CTIDE:TRUST:tier[:date] -->` markers; reuses Map's confidence vocabulary rather than inventing
    a new one.
  - Checksum verifier (conditional) — runs only when both an artifact and a checksum file are detected.
- **Coordinating thread** (no new agent) — reads `ship.mjs`'s structured output, performs the one step
  that needs judgment rather than mechanics (reading the Rollback section's actual prose to judge
  relevance to this batch, not just whether the field is filled in), assembles the decision card(s), and
  for any fixable gap attaches a recommendation (see *Error handling*, remediation shape).

## Data flow

1. `/ctide:ship` is invoked manually.
2. `ship.mjs` runs a single read-only pass: resolve the release marker → filter the ledger to the pending
   list → run the four core checks plus the conditional fifth against real files (manifests,
   `CHANGELOG.md`'s diff, git tag/tree state, `SYSTEM_MAP.md`'s Rollback fields, optional checksum files)
   → emit one structured result: `{ marker, pending: [...], checks: { versionConsistency,
   changelogTouched, tagReady, migrationCompat, checksumVerify? } }`. Each check carries a status
   (`pass` / `fail` / `not-applicable` / `unverified`) and cited evidence.
3. The coordinating thread reads this result, does the Rollback-prose relevance judgment, and assembles
   decision cards: first the pending-changes list (default all-selected, exclude before proceeding), then
   the check results in order, each stated plainly with its evidence; any `fail` carries a recommendation
   (see *Error handling*).
4. The user reviews and responds. `ship` performs no action on approval beyond finalizing what it already
   reported — there is nothing for it to execute.

## Error handling

**Universal invariant:** `ship.mjs` never throws. Every fs/git/parse failure swallows to a disclosed gap;
the CLI always exits 0 — the same fail-open contract every existing cressetide script already follows
(`map.mjs`, `doctor.mjs`, the `run-ledger.mjs` family).

**Missing-prerequisite disclosures** (name the gap, keep going):

- No prior tag found → treat the full ledger history as pending, and say so.
- No ledger, or an empty one → report "nothing pending" rather than an error.
- No `SYSTEM_MAP.md` → skip the migration-compatibility check, recommend running `/ctide:map` — the exact
  behavior `salvage` already uses when it enters wartime without a Map (`SKILL.md`'s Mode detection: name
  the gap, don't stop to build one, continue).
- `SYSTEM_MAP.md` present but stale → the migration-compatibility card explicitly flags staleness, reusing
  `operational-readiness.md`'s existing staleness convention verbatim rather than a new one.
- Shallow clone → git-derived checks disclose "history truncated — weak-signal only," the same wording
  `run-reconcile.mjs` already uses for the identical situation.

**`not-applicable` and `unverified` are distinct and must not be conflated.** Zero or one manifest found
→ version-consistency check is `not-applicable` (no card noise for projects that don't have this concept).
A manifest exists but fails to parse → `unverified`, with the parse error named as the specific blocker —
never silently treated as consistent.

**Remediation recommendation shape depends on failure type.** Version drift and an untouched changelog
are code/documentation gaps → recommend handing off to `/ctide:vigil --lite`. A checksum mismatch is not
a code bug — it means the build artifact is stale or the build was wrong → recommend re-running the
project's own build/release pipeline and re-verifying, never a `vigil` fix (there is no code fix for a
stale artifact).

**Clean edge case:** zero pending changes since the marker → a single line, "nothing pending to ship,"
not an empty decision card.

## Testing

Per-check unit tests (`test/ship.test.mjs`, matching the granularity of `test/run-ledger.test.mjs` /
`test/run-reconcile.test.mjs`):

- Marker resolution: multiple tags ordered correctly by version, not lexicographic sort (`v9.0.0` must not
  sort after `v10.0.0`); no-tag fallback.
- Pending-changes filter: only `READY` records included, `FIX REQUIRED`/`NOT READY` excluded; malformed
  ledger lines skipped without crashing the scan.
- Version consistency: matching / mismatched / 0–1 manifest (`not-applicable`) / malformed manifest
  (`unverified`) — all four covered.
- Changelog check: touched / not touched / no `CHANGELOG.md` in the repo at all (`not-applicable`).
- Tag readiness: clean and ready / target version already tagged (catches a real duplicate-tag mistake,
  not just a hypothetical one) / dirty tree / upstream version-consistency failure correctly produces
  `unverified` here instead of guessing a target version.
- Migration compatibility: relevant fresh Rollback content / Map absent / Map stale / Rollback content
  itself marked `UNVERIFIED` — each maps to the disclosure behavior defined in *Error handling*.

**Zero-writes invariant, machine-verified, not just asserted.** Reuses `run-reconcile.mjs`'s own technique
for proving `scan` is read-only: snapshot the ledger, working tree, and `.ctide/` tree before running
`ship.mjs`, byte-compare after. Proves the design invariant instead of trusting the prose description of
it.

**Fail-open test**, matching `doctor.mjs`'s existing pattern: feed `ship.mjs` a missing git repo, a
missing ledger, and corrupt JSON; confirm exit code 0 every time, no uncaught exceptions.

**Judgment-level behavior is not a unit test.** Reading Rollback prose for relevance and choosing which
remediation recommendation applies are language-understanding behaviors, not mechanical ones —
`docs/benchmark-contract.md` already draws this line: mechanical behavior goes in CI-run `test/*.mjs` with
literal comparison, judgment behavior goes in `eval/cases/*.json` reviewed by an LLM judge. This spec adds
a new eval case rather than forcing judgment into a unit test.

**Existing-test debt this change creates**, so it isn't discovered mid-implementation:

- `doctor.mjs`'s "confirm the four public skill directories" assertion becomes five.
- Any `test/structure.test.mjs`-style validator that hardcodes "four skills" needs the same update.
- Plugin manifest needs the fifth skill registered.
- The trilingual README parity discipline this repo already enforces (`README.md` / `README.zh-TW.md` /
  `README.ja.md`) applies to whatever documentation changes land with this feature — a content detail for
  the implementation plan, not this spec, but worth naming so it isn't missed.

## Scope check

This is one cohesive capability — a single new skill, its script, its reference contract, and the
handful of existing touch-points it necessarily updates (`doctor.mjs`, structure tests, the plugin
manifest). It is not decomposing into independent subsystems the way, for example, "chat plus billing
plus analytics" would; every piece here exists only to support the one `/ctide:ship` command. Appropriately
scoped for a single implementation plan.
