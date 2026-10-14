> P3 修復（P3-R1～R8）的 red→green 與六個結案條件紀錄（原檔是 gitignored 的 `.ctide/output/review/p3r-evidence.md`）。依 P3 中途 review arbiter 的要求放進受版控的交接資料。

> 協調者獨立重跑（2026-10-14）：條件 1 範圍 4 檔、既有斷言與 regex 無刪改；條件 2 抽查 R2（CLI exit 0）與 R3（拿掉 core.abbrev）兩個 mutant 各自變紅；條件 3 全新 TEMP 全套 973/967/0/6、殘留 0、validate 0、contract-check --base 53b2e18 0、cressetide/ 無變動；條件 4 set H + core.abbrev=12 下 8 個測試檔 365/365、殘留 0；條件 5 icacls 拒讀兩個植入檔 → CLI exit 1、stdout 空、stderr 有 FAILED 與兩行 cannot read …: EPERM（可讀對照組同樣失敗）；條件 6 沿用 implementer 的 Node 22.23.3 紀錄（本機未安裝 Node 22）。

# P3 repair evidence — P3-R1 … P3-R8 (after the P3 interim review, FIX REQUIRED, no blockers)

Branch `refactor/v0.8-slim`, HEAD `016c671` (P3 = `53b2e18`). Nothing staged or committed. Machine: Windows 11
Pro 10.0.26200, git 2.55.0.windows.5, Node v24.19.0 (plus a portable Node v22.23.3 for condition 6). Every test
run used TEMP/TMP/TMPDIR = a fresh `mktemp -d` directory, deleted by exact path afterwards. R8 was added
mid-task by the coordinator (owner decision 2026-10-14).

## 0. Files changed (exactly four)

| File | Purpose |
|---|---|
| `.github/scripts/validate-structure-core.mjs` | R1 `diskReader` returns null only for "absent" codes and rethrows the rest; `validate()` reads only through one guarded accessor that records `cannot read <rel>: <code>` once per path. R5 exports `readerFiles(read, dir)` (the SKIP_DIRS walk; `validate`'s `listFiles` delegates to it). R6 `TypeError` for `read` without `files`. R8 raw `##` count in §8. |
| `test/validate-structure.test.mjs` | R5 header comment + overlay keeps deleted tracked paths in both lists + fallback uses `readerFiles`; 6 new tests (R1 ×2, R2, R5, R6, R8). |
| `test/helpers.mjs` | R3 repo-local `core.abbrev 7` in `makeRepo`; R4 strip list + `core.hooksPath` pin; R7 wrapper (`fn.length === 2`, carries `fn.name`). |
| `test/helpers.test.mjs` | 6 new tests (R3, R4 ×3, R7 ×2); shared `setProcessEnv(t, vars)`, also used by the existing hostile test (setup only). |

Test count: 961 → **973** (+12): validate-structure 77 → 83, helpers 8 → 14.

## 1. Scope (condition 1)

`git diff --stat` restricted to my files:

```
 .github/scripts/validate-structure-core.mjs |  88 +++++++++++++++++------
 test/helpers.mjs                            |  29 ++++++--
 test/helpers.test.mjs                       |  96 ++++++++++++++++++++++---
 test/validate-structure.test.mjs            | 108 ++++++++++++++++++++++++----
 4 files changed, 270 insertions(+), 51 deletions(-)
```

- The working tree also shows `docs/handoff/README.md` and `docs/handoff/progress.md` as modified. **Those are
  not mine** (they appeared during this task; README.md:78 already lists R1–R8, i.e. the coordinator's own
  handoff edit). I did not read-modify or revert them.
- `git diff --quiet -- .github/scripts/validate-structure.mjs package.json .github/workflows cressetide eval` → 0
  (CLI, package.json, workflows, plugin, eval untouched).
- Every removed line (`git diff -U0 | grep '^-'`) was reviewed: **no `assert.*` line and no test regex removed or
  changed.** Removed lines are: comments (core reader/validate docs; helpers wrapper/env comments; both test file
  headers — the validate-structure header is the R5-sanctioned correction), import lists (names added), the old
  `diskReader` catch-alls and the inline `listFiles` (R1/R5), the old wrapper body (R7), one strip-list line (R4,
  re-wrapped), the R5-sanctioned overlay lines (`hidden`, `tracked:`) and the fallback `walk` in `baseFiles()`
  (R5: replaced by `readerFiles(base)`), and — disclosed — the existing hostile test's inline 7-line
  process.env save/restore, now `setProcessEnv(t, hostile.env)` (identical behaviour; its assertions unchanged).
- R6 caller grep (`validate({` outside docs/.ctide): CLI `validate({ root, files })`; tests `validate({ root })`,
  `validate({})`, `check` = `validate({ root, ...overlay() })` (overlay returns `read` + `files`), new R1 test
  `validate({ root, read: reader, files })`, two `validate({ root, read, files: null })`; the only `read` without
  `files` is the R6 test itself. Nothing else imports the core (`git grep validate-structure-core`).
- R8 / R1 message-collision check (P3a regex-collision lesson): every regex passed to `assert.match` while
  `test/validate-structure.test.mjs` runs was recorded at runtime (98 distinct) and tested against 8 candidate
  messages (two R8 messages with real counts; six `cannot read …: EACCES|EPERM` messages for package.json,
  command-reference, README.md, README.ja.md, plugin.json, .gitignore) → **0 collisions**. In particular the R8
  message does not contain "README parity", so the existing section-count test still discriminates §8.

## 2. Red → green per item (condition 2)

Trees (scratch, under my own temp dir, deleted afterwards):
- **git tree** = `git clone --no-local D:/github/cressetide` checked out at `016c671`, the four working files
  copied in (byte-identical to the main checkout, `cmp`). A real work-tree top, so `gitFiles()` is non-null.
- **archive tree** = `git -C D:/github/cressetide archive HEAD | tar -x` + the four working files (not a git
  repository: exercises the non-git fallback path).

Each mutant is an exact-once string replacement (the runner refuses a find string that matches 0 or 2+ times),
applied alone, followed by a whole-file run, then the file is restored (`cmp` after all runs: identical). Every
row ran with a fresh TEMP; `ctide-*` left = 0 on every row. **The archive tree produced the identical table**
(same exit, counts and failing test names on all 43 rows — `diff` of the two tables is empty). The table below is
the git tree. Command for every row (cwd = tree): `node --test --test-reporter=tap <test file>`.

| Item | Mutant | Test file | Exit | tests/pass/fail | Failing test(s) |
|---|---|---|---|---|---|
| — | none (green control) | validate-structure | 0 | 83/83/0 | — |
| — | none (green control) | helpers | 0 | 14/14/0 | — |
| R1 | accessor swallows the error (returns null, records nothing) | validate-structure | 1 | 83/82/1 | a file that exists but cannot be read FAILS, named once, instead of reading as absent |
| R1 | no accessor at all (`const read = reader`) | validate-structure | 1 | 83/82/1 | same |
| R1 | `diskReader.file` catch-all `return null` (HEAD) | validate-structure | 1 | 83/82/1 | diskReader reads only absence as null and throws every other read error |
| R1 | `diskReader.list` catch-all `return null` (HEAD) | validate-structure | 1 | 83/82/1 | same |
| R1 | (extra) no de-duplication | validate-structure | 1 | 83/82/1 | a file that exists but cannot be read FAILS, named once, … |
| R2 | CLI `process.exitCode = 1` → `0` | validate-structure | 1 | 83/82/1 | the CLI FAILS with exit 1, the FAILED header and one '  - ' line per failure, all on stderr |
| R2 | CLI FAILED header removed | validate-structure | 1 | 83/82/1 | same |
| R2 | CLI FAILED header reworded ("failed") | validate-structure | 1 | 83/82/1 | same |
| R2 | CLI `"  - "` prefix → `" * "` | validate-structure | 1 | 83/82/1 | same |
| R2 | CLI failure lines → stdout | validate-structure | 1 | 83/82/1 | same |
| R2 | CLI header and failure lines → stdout | validate-structure | 1 | 83/82/1 | same |
| R3 | `makeRepo` `core.abbrev` pin removed | helpers | 1 | 14/13/1 | makeRepo: production's %h equals the fixture's short SHA under a developer's global core.abbrev |
| R4 | `GIT_DIR` not stripped | helpers | 1 | 14/12/2 | fixture git: … hostile global config and inherited GIT_* overrides; gitEnv: every inherited GIT_* variable in the table is stripped |
| R4 | `GIT_WORK_TREE` not stripped | helpers | 1 | 14/13/1 | gitEnv: every inherited GIT_* variable in the table is stripped |
| R4 | `GIT_INDEX_FILE` not stripped | helpers | 1 | 14/13/1 | same |
| R4 | **`GIT_OBJECT_DIRECTORY` not stripped** (P3 survivor) | helpers | 1 | 14/13/1 | same |
| R4 | `GIT_ALTERNATE_OBJECT_DIRECTORIES` not stripped | helpers | 1 | 14/13/1 | same |
| R4 | `GIT_COMMON_DIR` not stripped | helpers | 1 | 14/13/1 | same |
| R4 | `GIT_CONFIG_PARAMETERS` not stripped | helpers | 1 | 14/12/2 | fixture git: … hostile …; gitEnv: every inherited GIT_* variable … |
| R4 | `GIT_CONFIG` not stripped | helpers | 1 | 14/12/2 | gitEnv: every inherited GIT_* variable …; gitEnv: an inherited GIT_CONFIG file is never written, and makeRepo still commits |
| R4 | `GIT_NAMESPACE` not stripped | helpers | 1 | 14/13/1 | gitEnv: every inherited GIT_* variable … |
| R4 | `GIT_AUTHOR_NAME` not stripped | helpers | 1 | 14/13/1 | same |
| R4 | `GIT_AUTHOR_EMAIL` not stripped | helpers | 1 | 14/13/1 | same |
| R4 | `GIT_AUTHOR_DATE` not stripped | helpers | 1 | 14/13/1 | same |
| R4 | `GIT_COMMITTER_NAME` not stripped | helpers | 1 | 14/13/1 | same |
| R4 | `GIT_COMMITTER_EMAIL` not stripped | helpers | 1 | 14/13/1 | same |
| R4 | `GIT_COMMITTER_DATE` not stripped | helpers | 1 | 14/13/1 | same |
| R4 | (extra) `GIT_CONFIG_KEY_n`/`VALUE_n` regex strip removed | helpers | 1 | 14/13/1 | same |
| R4 | pin `commit.gpgSign` dropped | helpers | 1 | 14/13/1 | gitEnv: every pinned config key in the table reads back its pinned value |
| R4 | pin `tag.gpgSign` dropped | helpers | 1 | 14/13/1 | same |
| R4 | pin `tag.forceSignAnnotated` dropped | helpers | 1 | 14/13/1 | same |
| R4 | pin `merge.verifySignatures` dropped | helpers | 1 | 14/13/1 | same |
| R4 | pin `gc.auto` dropped | helpers | 1 | 14/13/1 | same |
| R4 | **pin `maintenance.auto` dropped** (P3 survivor) | helpers | 1 | 14/13/1 | same |
| R4 | pin `core.hooksPath` dropped | helpers | 1 | 14/13/1 | same |
| R5 | core: `if (buf === null) continue;` removed (P3 survivor S09) | validate-structure | 1 | 83/82/1 | a tracked file deleted from the working tree stays in git's lists and fails nothing |
| R5 | overlay reverted: a deleted tracked path leaves `files.scan` | validate-structure | 1 | 83/82/1 | same |
| R6 | `TypeError` for `read` without `files` removed | validate-structure | 1 | 83/82/1 | validate() with a custom reader requires explicit file lists (git's lists come from the disk) |
| R7 | wrapper callback style when `fn.length >= 2` (HEAD) | helpers | 1 | 14/13/1 | test(): a body with three parameters is not callback style (node:test: exactly two) — fails in 0.2 ms (the `done` argument is asserted absent), not by the 2 s timeout |
| R7 | wrapper does not carry `fn.name` | helpers | 1 | 14/13/1 | `<anonymous>` (the `namedBody` test loses its name) |
| R8 | raw `##` count check disabled | validate-structure | 1 | 83/82/1 | README raw ## count FAILS on a fenced ## line in one README only (the fence-skipping section count still passes) |

Extra row, today's helpers: archive tree with **HEAD `test/helpers.mjs`** and only the new `helpers.test.mjs`
copied in → exit 1, 14/8/6: all six new helper tests red (`<anonymous>`, three-parameter body, strip table, pin
table, GIT_CONFIG behaviour, core.abbrev), the 8 existing ones green, 0 left. (The validate-structure file cannot
run against HEAD's core as a whole — it imports the new `readerFiles` export — so its HEAD behaviour is covered by
the HEAD-restoring mutants above: R1 catch-alls, R5 overlay, R6, R7.)

## 3. Suite (condition 3)

Main checkout, `node --test --test-reporter=tap "test/**/*.test.mjs"`, TEMP/TMP/TMPDIR = fresh `mktemp -d`:
**exit 0 · tests 973 · pass 967 · fail 0 · skipped 6** · duration_ms 86,130 (wall 86 s) · **0 `ctide-*` left, the
temp root was empty**. Skips = the same six pre-existing win32 ones (TAP #42 permissions, #49 broken symlink,
#456 dir symlink HOME, #457 case-sensitive FS, #736 / #739 file symlinks).

`npm run validate` (main checkout) → exit 0, `Plugin structure validation passed.`

## 4. Hostile run (condition 4)

`GIT_CONFIG_GLOBAL` = set H: `merge.verifySignatures`, `commit.gpgSign`, `tag.gpgSign`, `tag.forceSignAnnotated` =
true; `gpg.program` = a missing binary; `core.hooksPath` = a dir whose `pre-commit` / `commit-msg` print and exit
1; `core.safecrlf` = true; `init.defaultBranch` = trunk; **plus `core.abbrev = 12`**. Sanity probe under H in a
throwaway repo: `init` → `trunk`; `git config --global --get core.abbrev` → 12; `git add` of an LF file → `fatal: LF
would be replaced by CRLF`; commit → `hostile pre-commit hook`; with hooks bypassed → `cannot spawn …/no-such-gpg`;
`%h` → 12 characters.

Files: ship, map, contract-check, release-publisher, release-cli, release-doctor, validate-structure, helpers.test.

| Tree | Node | Exit | tests/pass/fail | Failing | ctide-* left |
|---|---|---|---|---|---|
| main checkout (fixed) | 24.19.0 | **0** | **365/365/0** | — | 0 |
| main checkout (fixed) | 22.23.3 | 0 | 365/365/0 | — | 0 |
| control: `git clone` at 016c671 (HEAD, a real work tree) | 24.19.0 | 1 | 353/352/1 | `pending view: a tagged release followed by one new, ordinary (non-vigil) commit …` (`sha: '40add37f4c23'` vs `'40add37'`) — the MJ-3 regression | 0 |

Note (not caused by H or by this repair): in a **non-git** archive tree, 8 release-doctor tests (`release
archive is deterministic…`, `published archive verification…`, …) fail with or without H, at HEAD and with
the fix alike (`Unable to evaluate ignored archive paths: fatal: not a git repository`, because
`createArchive()` runs `git check-ignore` on the repository root). Checked: archive tree without H → release-doctor
46/38/8. That is why the control above uses a clone.

## 5. Windows reproduction of MJ-1 (condition 5)

Scratch = the git clone (top of a work tree). Planted untracked `cressetide/package.json` (`{"name":"leak"}`) and
`docs/zz-mojibake.md` containing U+FFFD (bytes `357 277 275`, written with the Write tool), then
`icacls <path> /deny "%USERNAME%:R"` on both (`cat` → `Permission denied`).

| Validator | Files | Exit | Output |
|---|---|---|---|
| HEAD (016c671) | readable | 1 | FAILED: distribution hygiene `cressetide/package.json`; text integrity U+FFFD in `docs/zz-mojibake.md` |
| HEAD (016c671) | **read denied** | **0** | `Plugin structure validation passed.` — MJ-1 reproduced (silent pass) |
| fixed | **read denied** | **1** | stdout empty; stderr: `Plugin structure validation FAILED:` / `  - cannot read cressetide/package.json: EPERM` / `  - cannot read docs/zz-mojibake.md: EPERM` |
| fixed | readable again | 1 | the two original failures (distribution hygiene, text integrity) |

ACLs restored with `icacls <path> /remove:d "%USERNAME%"` (then readable again) **before** the plants were deleted.
On Windows the denied read surfaces as `EPERM`, not `EACCES`; the unit test stubs `EACCES`, and the guard reports
whatever code the reader throws.

## 6. Node 22 (condition 6)

Portable `node-v22.23.3-win-x64.zip` from nodejs.org/dist/latest-v22.x into its own new `mktemp -d` directory,
SHA-256 verified against `SHASUMS256.txt` (`OK`), run by absolute path from the repository cwd:
`test/validate-structure.test.mjs` + `test/helpers.test.mjs` → **exit 0, 97/97/0**, 3,327 ms, 0 left (temp root
empty). Also the hostile run above on 22.23.3: 365/365/0. The download directory was deleted afterwards.

## 7. Deviations and decisions (each with its reason)

1. **R1 optional POSIX chmod-000 case not added.** On win32 it would be a 7th skipped test, and condition 3
   requires the skips to stay at 6. The portable `file("bad\u0000name")` / `list("bad\u0000name")` cases
   (`ERR_INVALID_ARG_VALUE`) already kill the catch-all mutants on every platform, and §5 above is a real
   Windows ACL reproduction.
2. **R1 dedup key = the path** (not path + method): one `cannot read <rel>` line even if both `file()` and `list()`
   fail for it. The scanned doc in the test is `docs/command-reference.md`, which §7 and the public command
   inventory both read, so the dedup is exercised (extra mutant "no de-duplication" goes red). The root path ""
   prints as `.`. A reader error without a `code` prints its message.
3. **R1 accessor shape:** `validate({ root, read: reader, files })` keeps the raw reader under `reader`; the only
   `read` in scope is `{ file, list }` over one `guarded(method, rel)` function, so every existing `read.file` /
   `read.list` call site (and any future one) goes through it without being edited.
4. **R5: exported a walk helper (`readerFiles(read, dir)`) rather than `SKIP_DIRS`** — the spec allows either; this
   removes both the duplicated skip list and the duplicated walk, and makes the test's "the validator's own
   fallback walk" comment true by construction. `validate()`'s `listFiles` now delegates to it (through the
   guarded reader).
5. **R4 is three tests**, not one: the strip table, the pin table, and the GIT_CONFIG behavioural row; both tables
   are literals in the test. The strip table also has `GIT_CONFIG_KEY_99` / `GIT_CONFIG_VALUE_99` rows (the regex
   strip). The `core.hooksPath` pin is a per-process random path, so its row asserts "absolute path to a
   directory that does not exist" rather than a literal value. The pinned path uses forward slashes.
6. **R3 value 7:** git's own minimum abbreviation — what `--short` already gives in a small fixture repo with no
   config, so every expectation written against the hermetic fixture stays valid. Repo-local config beats the
   global file, so production git (plain environment) reads the same value.
7. **R2:** the CLI already prints the FAILED header and the `  - ` lines to **stderr**; asserted as is, CLI not
   changed. The test copies only the two validator files into a `tempDir()` (not a git work tree).
8. **R8:** the old check (`git show 37ea5df:test/structure.test.mjs`, line 34) used `/^##\s+/gm` over the raw
   text, **not** a plain `/^## /m`: it also counts `##<TAB>…` and a bare `##` line (`\s+` can match the newline).
   Today all three READMEs count 17 either way. Implemented with the exact old regex; it compares the READMEs
   that are present (a missing translation is already reported by §8). Message:
   `README raw ## count differs (code fences included): README.md N, README.zh-TW.md M, README.ja.md K — a "## " line in a fenced sample must appear in every README`.
9. **R7:** the three-parameter test also asserts that the second argument is `undefined`, so the `>= 2` mutant
   fails immediately; the 2 s timeout stays as the bound.

## 8. Risks and notes

- The new CLI failure test and the existing CLI smoke test inherit the developer's environment: an inherited
  absolute `GIT_DIR` (running `npm test` from a git hook) would make `gitFiles()` see the outer repository and
  drop the not-a-work-tree notice. Same class as review F1 / code #2 (`gitFiles` inherits the GIT_DIR family),
  already routed to P4; not fixed here.
- `makeRepo` now spawns one more `git config` (6 per repository); no measurable suite-time change (86 s, within
  the P3 spread 85–93 s).
- Housekeeping: all scratch (clone, archive trees, hostile config + hooks, mutation runner, TAP logs, Node 22) lived
  in my own `mktemp -d` directories and was deleted by exact path; nothing was deleted by pattern; no file outside
  the four was edited in the repository except this evidence file.
