---
name: ship
description: Lists the commits and changed files since the last release tag (a pending view, never a readiness claim), reads project manifest(s), CHANGELOG.md history, git tags, and the Map's Rollback section, and reports a read-only release-readiness decision card. Never executes build/test/deploy; never writes anything.
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
`pass` / `fail` / `not-applicable` / `unverified` semantics, the release-marker resolution rule, the
pending view's states, and the two binding scope decisions (checksum verification is CLI-flag-only;
version-consistency reads `package.json` only).

## What the coordinating thread does

The script computes facts; only these two steps need judgment, and belong to the coordinating thread,
never the script:

1. **Rollback relevance.** Read `checks.migrationCompat.rollbackText` (the raw Rollback-section prose)
   against `pending.files` (the files changed since the last release tag) and state, specifically,
   whether it actually bears on this batch — never just that the field happens to be filled in. When
   `pending.state` is not `ok`, say the changed files are unknown and why, instead of judging against
   an empty list.
2. **Remediation routing.** A `versionConsistency` or `changelogTouched` `fail` is a code/documentation
   gap → recommend `/ctide:vigil --lite`. A `checksumVerify` `fail` means the artifact is stale or the
   build was wrong, never a code bug → recommend re-running the project's own build/release pipeline
   and re-verifying, never a `vigil` fix.

## Report shape

1. **Pending changes** first: the commits and changed files since the last release tag, introduced
   with `pending.disclaimer` verbatim — "changes since the last release tag — not a readiness claim;
   no READY verdict is implied". Nothing in this list has been reviewed by being listed. A non-`ok`
   `pending.state` (`no-release-tag`, `shallow-clone`, `not-a-git-repo`, `git-unavailable`,
   `unverified`) is stated with its `pending.note` — never as "nothing pending". `ok` with zero commits
   → state "no commits since <tag>" as one line. A truncated list says so, with the total.
2. **Each check**, in order (`versionConsistency`, `changelogTouched`, `tagReady`, `migrationCompat`,
   `checksumVerify`), stated plainly with its status and cited evidence.
3. **A remediation recommendation** on any `fail`, per *Remediation routing* above.

`ship` never picks or bumps a version, never drafts `CHANGELOG.md` content, never computes a score or
percentage, and performs no action on approval beyond finalizing what it already reported — there is
nothing for it to execute. It is a pre-flight checklist read before using whatever a project already
uses to actually publish, not a replacement for that pipeline.
