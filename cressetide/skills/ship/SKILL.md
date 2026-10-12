---
name: ship
description: Reads the run ledger, project manifest(s), CHANGELOG.md history, git tags, and the Map's Rollback section since the last release tag, and reports a read-only release-readiness decision card. Never executes build/test/deploy; never writes anything.
user-invocable: true
disable-model-invocation: true
---

# Ship

Invoke manually as `/ctide:ship`.

Run the deterministic helper first:

```text
node "${CLAUDE_PLUGIN_ROOT}/skills/ship/scripts/ship.mjs" --cwd <repository> --json
```

Pass `--artifact <path> --checksum <path>` together to additionally verify an already-built release
artifact against its checksum file (both required together, or neither — `ship` never scans a
directory to guess which file is a build artifact). The helper is entirely read-only: no working-tree
mutation, no `.ctide/` write, no state-changing git command, ever.

Read `references/ship-contract.md` before assembling the report — it defines all five checks'
`pass` / `fail` / `not-applicable` / `unverified` semantics, the release-marker resolution rule, and
the two binding scope decisions (checksum verification is CLI-flag-only; version-consistency reads
`package.json` only).

## What the coordinating thread does

The script computes facts; only these two steps need judgment, and belong to the coordinating thread,
never the script:

1. **Rollback relevance.** Read `checks.migrationCompat.rollbackText` (the raw Rollback-section prose)
   against the pending batch's touched files and state, specifically, whether it actually bears on
   this batch — never just that the field happens to be filled in.
2. **Remediation routing.** A `versionConsistency` or `changelogTouched` `fail` is a code/documentation
   gap → recommend `/ctide:vigil --lite`. A `checksumVerify` `fail` means the artifact is stale or the
   build was wrong, never a code bug → recommend re-running the project's own build/release pipeline
   and re-verifying, never a `vigil` fix.

## Report shape

1. **Pending changes** first, default all-selected — the human may exclude entries before the rest of
   the report is generated. Zero pending → state "nothing pending to ship" as one line, not an empty
   card.
2. **Each check**, in order (`versionConsistency`, `changelogTouched`, `tagReady`, `migrationCompat`,
   `checksumVerify`), stated plainly with its status and cited evidence.
3. **A remediation recommendation** on any `fail`, per *Remediation routing* above.

`ship` never picks or bumps a version, never drafts `CHANGELOG.md` content, never computes a score or
percentage, and performs no action on approval beyond finalizing what it already reported — there is
nothing for it to execute. It is a pre-flight checklist read before using whatever a project already
uses to actually publish, not a replacement for that pipeline.
