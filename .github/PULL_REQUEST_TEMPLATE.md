<!-- Keep this short. Delete sections that don't apply. -->

## What & why

<!-- What does this change do, and why? Link any issue (e.g. Closes #12). -->

## How tested

<!-- The commands you ran and their result. For a change to the shipped cressetide/ tree:
     node --test  AND  node .github/scripts/validate-structure.mjs -->

## Checklist

- [ ] `node --test` and `node .github/scripts/validate-structure.mjs` pass locally
- [ ] No machine literal changed unintentionally — verdicts (`READY` / `FIX REQUIRED` / `NOT READY`), severities (`blocker` / `major` / `minor`), the `ctide:` sentinels, or the opt-out keys
- [ ] Every hook still fails open (an unreadable / malformed / oversized input still exits 0)
- [ ] Version bumped + a `CHANGELOG.md` entry added **iff** the change is perceptible to a user running ctide (see [`RELEASING.md`](../RELEASING.md), *When to bump the version*)
- [ ] Docs kept in sync when the surface changed — README ×3 (EN / zh-TW / ja), `ARCHITECTURE.md`, `SECURITY.md`
