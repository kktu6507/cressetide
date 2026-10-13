> R2 的 red→green 紀錄（原檔是 gitignored 的 `.ctide/output/review/r2-redgreen.md`）。依第 1 輪複審 arbiter 的要求放進受版控的交接資料。

# R2 red→green evidence (round-1 repair-2, R2-1 … R2-5)

Machine: Windows 11, git 2.55.0.windows.5, Node v24.19.0. Base: HEAD 2306078 (clean tree before R2).

Trees (both scratch, outside the main checkout, deleted after the runs):
- **HEAD** = `git -C D:/github/cressetide archive 2306078 | tar -x` + only the new `test/ship.test.mjs` copied in (HEAD code, HEAD READMEs/docs).
- **fixed** = the same archive + the R2 working-tree versions of ship.mjs, test/ship.test.mjs, ship-contract.md, command-reference.md, README×3 overlaid (byte-identical to the main checkout, checked with `cmp`).
- Mutants were applied to the **fixed** tree one at a time (exact-once string replacement, restored after each run).

Every row's command runs with cwd = the named tree: `node --test --test-name-pattern="<pattern>" test/ship.test.mjs`. Counts are `# tests / # pass / # fail` from the TAP summary.

## Whole file

| Run | Command | Exit | tests/pass/fail | Failing tests |
|---|---|---|---|---|
| HEAD code + new tests (red) | `node --test test/ship.test.mjs` (HEAD tree) | 1 | 90/81/9 | the 9 rows marked red below |
| fixed, main checkout (green) | `node --test test/ship.test.mjs` (D:\github\cressetide) | 0 | 90/90/0 | — |

78 pre-existing tests + 12 new = 90.

## R2-1 — `--no-column --sort=refname` on both `git tag` calls, `--no-show-signature` on both parsed `git log` calls

| Item · test | Tree / mutant | Pattern | Exit | t/p/f | Failing test |
|---|---|---|---|---|---|
| column.ui/column.tag=always + tag.sort=-refname | HEAD | `column\.ui/column\.tag=always` | 1 | 1/0/1 | pending view and marker: a repository's column.ui/column.tag=always and tag.sort=-refname do not hide the release tag (marker.found false) |
| same | fixed | same | 0 | 1/1/0 | — |
| same | fixed, `--no-column` dropped from resolveMarker's `tag --list` only | same | 1 | 1/0/1 | same test |
| same | fixed, `--no-column` dropped from pending's `tag --merged HEAD` only | same | 1 | 1/0/1 | same test |
| same-version tie independent of tag.sort | HEAD | `same-version tie` | 1 | 1/0/1 | marker and pending boundary break a same-version tie (v1.0.0 vs 1.0.0) the same way, whatever tag.sort says ('1.0.0' !== 'v1.0.0') |
| same | fixed | same | 0 | 1/1/0 | — |
| same | fixed, `--sort=refname` dropped from resolveMarker only | same | 1 | 1/0/1 | same test |
| same | fixed, `--sort=refname` dropped from pending only | same | 1 | 1/0/1 | same test |
| log.showSignature + SSH-signed commits | HEAD | `log\.showSignature=true` | 1 | 1/0/1 | pending view and marker: log.showSignature=true with SSH-signed commits adds no row … (marker.commit = 'No signature\n<sha>') |
| same | fixed | same | 0 | 1/1/0 | — |
| same | fixed, `--no-show-signature` dropped from resolveMarker's `log -1` only | same | 1 | 1/0/1 | same test |
| same | fixed, `--no-show-signature` dropped from pending's `log` only | same | 1 | 1/0/1 | same test |
| v9.0.0 → a → v10.0.0 → b (version order) | HEAD | `v9\.0\.0, a, v10\.0\.0, b` | 0 | 1/1/0 | — (mutation-kill test: HEAD already correct) |
| same | fixed | same | 0 | 1/1/0 | — |
| same | fixed, mutant 11: lexicographic last valid tag | same | 1 | 1/0/1 | pending view: the boundary is ordered by version — v9.0.0, a, v10.0.0, b lists only b since v10.0.0 |
| v1.9.5 merged back after v2.0.0 | HEAD | `maintenance tag merged back` | 0 | 1/1/0 | — (mutation-kill test: HEAD already correct) |
| same | fixed | same | 0 | 1/1/0 | — |
| same | fixed, mutant 12: nearest by creatordate (`--sort=-creatordate`, first valid) | same | 1 | 1/0/1 | pending view: a maintenance tag merged back after a higher release (v1.9.5 dated after v2.0.0) is not the boundary |

The SSH test was also run from PowerShell (Git's ssh-keygen) and with `C:\Windows\System32\OpenSSH` first on PATH: 1/1/0 both.

## R2-2 — README×3 ship paragraph (owner-approved wording)

| Item · test | Tree | Pattern | Exit | t/p/f | Failing tests |
|---|---|---|---|---|---|
| README ship paragraph → real Stop hook silent; control "+ Final verdict: READY" fires | HEAD | `ship section's paragraph` | 1 | 3/0/3 | README.md: …; README.zh-TW.md: …; README.ja.md: the ship section's paragraph, quoted as a final message, does not trip the Stop hook's READY/panel advisory (each: hook returned the "a READY verdict was asserted but none of the core review panel…" systemMessage) |
| same | fixed | same | 0 | 3/3/0 | — |

README edits verified byte-exact: for each file, `git show 2306078:<file>` with only the old parenthetical replaced equals the working-tree file (old text occurs once; on line 200).

## R2-3 — three-way shallow probe

| Item · test | Tree / mutant | Pattern | Exit | t/p/f | Failing test |
|---|---|---|---|---|---|
| unanswered probe (`node -r` preload: echoed flag; ETIMEDOUT) → pending + tagReady unverified, marker note "may be truncated" | HEAD | `unanswered shallow probe` | 1 | 1/0/1 | an unanswered shallow probe (flag echoed back by an older git, or a timeout) is unknown, never 'not shallow' … ("echo: pending" 'ok' !== 'unverified') |
| same | fixed | same | 0 | 1/1/0 | — |
| same | fixed, any non-answer → "not-shallow" | same | 1 | 1/0/1 | same test ("echo: pending") |
| same | fixed, only error/non-zero → "not-shallow" | same | 1 | 1/0/1 | same test ("timeout: pending") |
| same | fixed, only echoed/other stdout → "not-shallow" | same | 1 | 1/0/1 | same test ("echo: pending") |
| real shallow clone, tag not fetched, from `src/` and a linked worktree → marker.note + tagReady evidence "history truncated — weak-signal only" (D-3) | HEAD | `whose release tag was not fetched` | 0 | 1/1/0 | — (pins D-3 behavior already at HEAD) |
| same | fixed | same | 0 | 1/1/0 | — |
| same | fixed, mutant 5m: marker + tagReady probe `<cwd>/.git/shallow` | same | 1 | 1/0/1 | resolveMarker and tagReadinessCheck: from a subdirectory or a linked worktree of a real shallow clone whose release tag was not fetched, both disclose history truncation |

## R2-4 — honest "names it" note

| Item · test | Tree / mutant | Pattern | Exit | t/p/f | Failing test |
|---|---|---|---|---|---|
| release tag only on an unmerged branch → no-release-tag, note names v1.4.2 | HEAD | `only on an unmerged branch` | 1 | 1/0/1 | pending view: a release tag only on an unmerged branch is no-release-tag, and the note names that release marker |
| same | fixed | same | 0 | 1/1/0 | — |
| same | fixed, unreachable-marker clause removed | same | 1 | 1/0/1 | same test |
| tree-object tag v9.9.9 → not named in the note | HEAD | `pointing at a tree object` | 1 | 1/0/1 | pending view: a tag pointing at a tree object is never named in the pending note as the release marker (note: "… (the release marker is v9.9.9; …)") |
| same | fixed | same | 0 | 1/1/0 | — |
| same | fixed, `pendingChanges(root, marker.tag)` restored | same | 1 | 1/0/1 | same test |

## R2-5 — `core.quotePath true` pinned in the Unicode+space fixture

Mutant "no `-z`" = `-z` dropped from the pending diff and the output split by lines (`split(/\r?\n/)`).

| Config | Pin in test | Mutant | Exit | t/p/f | Result |
|---|---|---|---|---|---|
| `GIT_CONFIG_GLOBAL=<scratch>/quotepath-false.gitconfig` (global core.quotePath=false) | no | no `-z` | 0 | 1/1/0 | mutant **survives** |
| same | yes | no `-z` | 1 | 1/0/1 | mutant **killed** — pending view: a file name with spaces and non-ASCII characters is listed verbatim |
| same | yes | none (fixed code) | 0 | 1/1/0 | green |
| default config | yes | no `-z` | 1 | 1/0/1 | killed |
| `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.quotePath GIT_CONFIG_VALUE_0=false` | no | no `-z` | 0 | 1/1/0 | survives |
| same | yes | no `-z` | 0 | 1/1/0 | **survives** — see deviation |

Deviation (disclosed): the brief asked for the survive/red pair under `GIT_CONFIG_COUNT` injection. That injection is command-scope config, which git ranks above repository-local config, so no repo-local pin can win against it (verified: repo-local `core.quotePath true` + injected `false` → git prints the path unquoted). The reviewer's scenario is a developer's **global** setting; `GIT_CONFIG_GLOBAL` pointing at a scratch file with `quotePath = false` simulates exactly that, and there the pin turns the surviving mutant red. Both runs are recorded above.

## R2 follow-up (owner-approved 2026-10-14): (A) "unknown" only inside a work tree, (B) untracked files under `status.showUntrackedFiles=no`

Trees (scratch, outside the checkout, deleted after the runs): **HEAD** = archive 2306078 + the final `test/ship.test.mjs`; **pre-follow-up** = archive + the R2 working-tree files as they were before this follow-up (ship.mjs snapshot checked with `cmp`) + the final test file; **fixed** = archive + the final working-tree files. Same command shape as above (cwd = tree): `node --test --test-name-pattern="<pattern>" test/ship.test.mjs`.

Shape chosen for (A): `shallowState` runs `git rev-parse --is-inside-work-tree` first and returns a distinct `"no-work-tree"` outcome (git spawn ENOENT, a non-zero exit, or output other than `true`); callers already branch only on `"shallow"` / `"unknown"`, so `"no-work-tree"` takes the "not shallow" wording with no caller change. A non-ENOENT spawn error on that check (e.g. a timeout) stays `"unknown"`.

| Item · test | Tree / mutant | Pattern | Exit | t/p/f | Failing test (first assertion) |
|---|---|---|---|---|---|
| (A) non-git directory → no truncation clause in marker.note / tagReady evidence | pre-follow-up | `outside a git work tree, neither marker\.note` | 1 | 1/0/1 | outside a git work tree, neither marker.note nor tagReady's evidence says history is or may be truncated ("non-git directory: marker.note has no truncation clause") |
| same | HEAD | same | 0 | 1/1/0 | — (HEAD never added a clause; the regression was introduced by R2-3) |
| same | fixed | same | 0 | 1/1/0 | — |
| same | fixed, the not-inside → `"no-work-tree"` line removed | same | 1 | 1/0/1 | same test |
| (A) git missing from PATH → no truncation clause | pre-follow-up | `with git missing from PATH, neither marker\.note` | 1 | 1/0/1 | with git missing from PATH, neither marker.note nor tagReady's evidence says history is or may be truncated ("git unavailable: marker.note has no truncation clause") |
| same | HEAD | same | 0 | 1/1/0 | — |
| same | fixed | same | 0 | 1/1/0 | — |
| same | fixed, ENOENT → `"unknown"` | same | 1 | 1/0/1 | same test |
| (A) inside a work tree, unanswered probe stays unknown (existing R2-3 test) | fixed | `unanswered shallow probe` | 0 | 1/1/0 | — |
| (B) `status.showUntrackedFiles no` + only an untracked file → same tagReady status as default config (`fail`, ship-contract.md tagReady: "A dirty working tree → `fail`") | HEAD | `status\.showUntrackedFiles=no does not hide` | 1 | 1/0/1 | tagReadinessCheck: status.showUntrackedFiles=no does not hide an untracked file — same result as under default config ('pass' vs default 'fail') |
| same | pre-follow-up | same | 1 | 1/0/1 | same test |
| same | fixed | same | 0 | 1/1/0 | — |
| same | fixed, `--untracked-files=normal` dropped | same | 1 | 1/0/1 | same test |

The tagReady half of each (A) test sits behind the marker.note assertion; on the pre-follow-up code the tagReady evidence in a non-git directory read "history may be truncated — weak-signal only: could not determine whether this is a shallow clone …" (observed directly with the CLI before this follow-up).

Whole file after the follow-up, main checkout: `node --test test/ship.test.mjs` → exit 0, 93/93/0 (90 + 3 new).
