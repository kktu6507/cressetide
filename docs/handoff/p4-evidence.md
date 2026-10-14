> P4（P4a／P4b／P4c）的實作證據：S0 基準比對、lib 模組的打紅紀錄、各 script 的綁定測試與還原打紅、ship／publish-release 的 routed 修正。原檔是 gitignored 的 `.ctide/output/review/p4{a,b,c}-evidence.md`，S0 錄製工具在 `.ctide/output/p4-s0/record.mjs`（同樣 gitignored）。

> 協調者在 commit 前獨立重跑（2026-10-14）：全新 TEMP 全套 1106/1100/0/6、0 殘留；validate 0；plugin validate --strict@2.1.272 0；S0 `compare p4c-exit` 300 列中 129 列變動、0 列落在允許類別外（exit 0）；AC-9 單一副本 grep（工作樹）只在 lib 各一處、KNOWN_FLAGS／isInvokedDirectly／9d 殘留 0；publish-release-core 引用 0；contract-check --base e0e3dcb 0。

---

# P4a evidence: S0 baseline harness, S1 `cressetide/lib/` modules + unit tests, S2 garden 9d d4/d5 removal + binding test

Branch `refactor/v0.8-slim`, HEAD `e0e3dcb` (the orchestrator's own uncommitted `docs/handoff/**` edits were left untouched).
Nothing staged or committed. Machine: Windows 11 Pro 10.0.26200, git 2.55.0.windows.5, Node v24.19.0 (Node 22 was not
run; see §6). Every test, harness and mutant run used TEMP/TMP/TMPDIR pointed into my own `mktemp -d` directory, which
was deleted by exact path at the end. No script under `cressetide/skills/**` or `.github/scripts/publish-release*.mjs`
was changed.

## 0. Files changed

| File | Purpose |
|---|---|
| `cressetide/lib/cli.mjs` (new) | `isMain(importMetaUrl)`, `parseCli(argv, config)`, `dashValueError(values, names)` |
| `cressetide/lib/git.mjs` (new) | `git`, `gitOrThrow`, `headState`, `parseCount`, `changedFiles`, `NEUTRAL_CONFIG`, `NEUTRAL_CONFIG_ARGS` |
| `cressetide/lib/read-capped.mjs` (new) | `readCapped(file, { cap, from, onError })` (fd + fstat) |
| `cressetide/lib/redact.mjs` (new) | `redactDiagnostic(value, limit = 2000)`, the single redaction chain |
| `cressetide/lib/map-trust.mjs` (new) | `OPS_TRUST_TAG_ATTEMPT`, `OPS_TRUST_TAG_WELLFORMED`, `opsTrustTagIsWellFormed`, `isValidIsoDate`, `trustTagAttempts` |
| `test/lib-cli.test.mjs` (new, 23 tests) | parseCli error classes, last-wins, `=`/`--x=`/`--`, dash guard; isMain imported/direct/junction/`node -e`/unresolvable |
| `test/lib-git.test.mjs` (new, 34 tests) | raw result, ENOENT, one row per NEUTRAL_CONFIG key, inherited env (one row per stripped variable), GIT_OPTIONAL_LOCKS, input, buffer, gitOrThrow, parseCount, headState, changedFiles (every state, hostile H, index untouched, fault injection) |
| `test/lib-read-capped.test.mjs` (new, 9 tests) | cap / cap+1 head and tail, multi-byte cut, BOM, ENOENT / EISDIR / EACCES-EPERM in both onError modes, option validation |
| `test/lib-redact.test.mjs` (new, 24 tests) | release-doctor credential shapes, GitHub tokens, multi-line keys, rule order, temp/home with regex characters, non-string input, limit, equivalence with publish-release's copy |
| `test/lib-map-trust.test.mjs` (new, 6 tests) | map/ship trust-tag fixtures, ISO dates, repeated calls after a stray `lastIndex` |
| `test/lib-binding.test.mjs` (new, 18 tests) | (1) per-script binding to lib with explicit allowlist, (2) repo-wide signature counts with explicit allowlist; stale entries fail |
| `.github/CODEOWNERS` | `/cressetide/lib/` and `/cressetide/workflows/` → `@kktu6507` (same owner as the existing lines) |
| `.github/scripts/validate-structure-core.mjs` | 9d header rewritten; `extractSkillFn` (only d4/d5 used it), d4 and d5 removed (−98 net lines); d1/d2 and §9's header kept |
| `test/validate-structure.test.mjs` | the two d4/d5 tests removed (56 lines); the ~:696 test ("d4 (§5k extension)" = rigor-contract guard) untouched |

Not in the repo tree: `.ctide/output/p4-s0/record.mjs` + recordings (§1), this file.

Tests: **973 → 1085** (−2 removed 9d tests, +114 new lib tests).

## 1. S0: the recording harness

Path: `D:\github\cressetide\.ctide\output\p4-s0\record.mjs` (gitignored). Usage:

```
node .ctide/output/p4-s0/record.mjs record  --out <prefix> [--repo <checkout>] [--env normal|hostile|both] [--only a,b]
node .ctide/output/p4-s0/record.mjs compare <prefix> [--baseline <prefix>]     # prints only changed rows; exit 1 if any is outside the allowed classes
node .ctide/output/p4-s0/record.mjs cross   <prefix>                          # hostile vs normal rows of one recording
```

- Every run rebuilds all fixtures from scratch inside its own `mkdtemp` directory and removes it by exact path. Fixture
  git is hermetic (no global config, no inherited `GIT_*`), with fixed identity and fixed author/committer dates, plus
  repo-local `commit.gpgsign=false` / `tag.gpgSign=false`. One fixture commit carries a bogus `gpgsig` header so that
  `log.showSignature` has something to print.
- Every script runs under a `-r` clock preload that pins `Date` to 2026-10-01T00:00:00Z. Ship's routed-failure rows add
  a second preload that patches `child_process.spawnSync` for `git` by argument content, the way ship.test does, so it
  keeps matching after P4b moves the calls to lib/git.
- Normalization: the run directory becomes `<tmp>`, the checkout `<checkout>`, `process.execPath` `<node>`, the home
  dir `<home>` (native, `/`, and JSON-escaped variants, case-insensitive on Windows). CRLF becomes LF and ISO timestamps
  become `<timestamp>`.
- `publish-release.mjs` takes its repository root from its own location, so it runs from a fresh synthetic copy. The
  checkout's `.github/scripts/*.mjs` (and `cressetide/lib/` when present, git-ignored there so it never enters the
  archive) go into a fixed plugin tree with a `v0.7.2` tag, and `_release/` lands in the temp dir.
- Environments: "normal" is the developer's own environment (real global git config) minus `CLAUDE_PROJECT_DIR`,
  `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`, `CTIDE_*` and redirecting `GIT_*` variables. "hostile" is the same with
  `GIT_CONFIG_GLOBAL` set to H (all 12 keys as specified). The failure-* and doctor `--project` rows also point
  HOME/USERPROFILE at a fixture home.

Rows (identical per environment):

| Script | Rows | | Script | Rows |
|---|---|---|---|---|
| ship | 32 | | regression-delta | 12 |
| map | 19 | | failure-retrieve | 17 |
| doctor | 13 | | failure-consolidate | 11 |
| contract-check | 19 | | publish-release | 14 |
| pack-review-diff | 13 | | **total** | **150 per environment, 300 per recording** |

Each script has happy path(s), every existing flag in `--flag value` form, the `--flag=value` form (which no old parser
accepts), a missing value, an ambiguous swallow (`--a --b x`), an unknown flag / stray positional, and no args. The
git-reading scripts (ship, map, contract-check, publish-release) also have a non-git dir and git missing from PATH. The
named routed rows are: ship F-j (`count-empty`, `count-status`) and leads 1–4, contract-check `non-ascii-path`,
`base-injection` (two forms), failure-retrieve `log-swallows-positional`, and map `dangling-head` (+ `-verify`).

Recordings, each made at e0e3dcb with scripts byte-identical to e0e3dcb:

| Prefix | What | Result |
|---|---|---|
| `baseline-{normal,hostile}.json` | the baseline | 150 + 150 rows, ~84 s per environment |
| `det-e0e3dcb-{normal,hostile}.json` | second consecutive run | `compare det-e0e3dcb` → **300 rows compared, 0 changed** (determinism) |
| `p4a-exit-{normal,hostile}.json` | rerun after S1 + S2 (lib, tests, validator changed; no script) | `compare p4a-exit` → **300 rows compared, 0 changed** |

Sensitivity check: in a `git archive e0e3dcb` export, I changed one regression-delta output string and ran
`record --only regression-delta --repo <export>` → `compare` printed `NOT ALLOWED [normal] regression-delta/tap-green
(class happy)` with the ± line diff, and exited 1. The export and its recording were deleted.

`cross baseline`: 19 of 150 rows differ under H, all ship rows. The causes are `core.abbrev=12` (12-char `%h` /
`--short`), `i18n.logOutputEncoding=ISO-8859-1` (`add caf<U+FFFD> notes` — the garbled subject as printed), `diff.ignoreSubmodules=all` (the moved gitlink drops
out of `pending.files`), and lead 3, where `diff.relative=true` flips `changelogTouched` from fail to pass. map,
contract-check, doctor, failure-*, pack, regression and publish-release are unaffected by H at e0e3dcb.

Baseline facts the recordings pin (the allowed P4-exit changes should show up against these):

- **F-j** `count-empty`: `rev-list --count` printing "" gives `pending.state ok`, "no commits since v1.0.0", while
  3 commits are listed.
- **lead 1**: a failing tag list gives "no vX.Y.Z release tag found" while pending is `ok` against v1.0.0.
- **lead 2**: a timed-out `rev-parse refs/tags/…` gives `tagReady: pass`.
- **lead 3**: `--cwd <repo>/pkg` gives `changelogTouched: fail` although `pkg/CHANGELOG.md` changed.
- **lead 4**: a dangling HEAD gives pending `unverified` ("listing the tags reachable from HEAD failed").
- **contract-check** `--base --output=<file>`: git writes the file, and the report says "scope: clean". Non-git,
  git-missing and an unresolvable base also say "scope: clean". The non-ASCII forbidden path is reported quoted
  (`"caf\303\251.txt"`), so the forbidden hit is missed.
- **map** with a dangling HEAD writes `Verified at commit: 1111…` and verify accepts it.

Allowed classes in `compare` (constant `ALLOWED_AT_P4_EXIT`): the orchestrator's list plus three interpretations of
"unknown/ambiguous-flag rows":
- `flag-alt-form`: `--flag=value`, which the old parsers ignore entirely.
- `missing-value`: a value flag with nothing after it.
- `repeated-flag`: `--cwd a --cwd b`, where the old parsers take the first value and parseCli the last (the owner-approved
  last-wins rule).

Every row recorded under H counts as a hostile-config row. `contract-check/base-unresolvable` is deliberately not
allowed: if Q3's resolve-to-SHA changes it, the orchestrator decides.

## 2. S1: lib modules, APIs, fail-first proof

Byte identity with the copies they replace was checked with a scratch comparer before any test was written:
- `OPS_TRUST_TAG_ATTEMPT`, `OPS_TRUST_TAG_WELLFORMED`, `opsTrustTagIsWellFormed` and `isValidIsoDate` are identical to
  both map.mjs and ship.mjs.
- The redaction chain (`.replace` lines) and the path helper are identical to doctor.mjs and publish-release.mjs.
- `isMain`'s body is identical to `isInvokedDirectly`'s, with `import.meta.url` → parameter.

**Diff of the two redaction copies** (doctor.mjs:85-100 vs publish-release.mjs:218-235): the only differences are names
and the limit. The helper is `replaceSensitivePath` vs `replacePath`; the function is `sanitizeDiagnostic(value,
limit = 2000)` (not exported) vs `export redactReleaseDiagnostic(value)` with a hard-coded `slice(0, 2000)`; and there
is one blank line between the functions. Every regex, the order, and the tmpdir/homedir step are byte-identical.
doctor's only caller uses the default 2000.

APIs:
- **cli** — `isMain(importMetaUrl)`: today's forward form; false when argv[1] is missing; never throws.
  `parseCli(argv, { options, allowPositionals = false, positionals = Infinity, rejectDashValues = [] })` returns
  `{ values, positionals }` or `{ error, code }`; it wraps strict `parseArgs` and never throws:
  - error codes: unknown flag / missing value / ambiguous `--a --b` / boolean with value / unexpected positional use
    parseArgs's own codes; my additions are `ERR_CLI_TOO_MANY_POSITIONALS`, `ERR_CLI_DASH_VALUE`, and `ERR_CLI_ARGV`
    for non-array argv (parseArgs would silently read process.argv);
  - last value wins for a repeated flag, `--x=` gives `""`, and `--` ends the flags.
  `dashValueError(values, names)` is the dash guard; parseCli applies it to the names in `rejectDashValues` (for
  contract-check `--base`).
- **git** — `git(root, args, { input, encoding, maxBuffer = 64 MiB, timeout = 10_000 })` returns the raw spawnSync
  result and never throws (a spawnSync throw, e.g. a NUL byte, is returned in `error`). It calls `cp.spawnSync("git",
  ["-C", root, ...NEUTRAL_CONFIG_ARGS, ...args])` with stdin `pipe` only when `input` is given. The env is
  process.env minus the six redirecting variables (case-insensitive on win32) plus `GIT_OPTIONAL_LOCKS=0`.
  `GIT_CONFIG_*` is untouched. `NEUTRAL_CONFIG` holds the six keys, frozen.
  - `gitOrThrow(root, args, opts)` returns stdout. On failure it throws an Error with `.stderr` (always a string),
    `.status`, and `.code` (the spawn error code, or null when git exited non-zero); the message names the args, never
    root.
  - `headState(root)` returns `born`, `unborn` or `unknown`, using `rev-parse -q --verify HEAD^{commit}` plus map's
    40–64 hex check, then `parseCount(rev-list --all --count) === 0`.
  - `parseCount(stdout)` returns an integer for `/^\d+$/` after trim (and safe integer), else null.
  - `changedFiles(root, base = "HEAD")` is described in §5 D1/D2.
- **read-capped** — `readCapped(file, { cap, from = "head", onError = "throw" })`. open → fstat → bounded `readSync`
  loop on one fd. Decoding is `Buffer#toString("utf8")`: a head cut inside a character gives one U+FFFD; a tail cut gives
  one U+FFFD per orphaned continuation byte (tested exactly). A directory throws EISDIR (§5 D5). Invalid options throw
  TypeError regardless of `onError`.
- **redact** — `redactDiagnostic(value, limit = 2000)`, in this order:
  1. the key block;
  2. collapse `\r\n\t`;
  3. key/value secrets;
  4. Bearer;
  5. GitHub token shapes;
  6. tmpdir → `<temp>`, homedir → `~` (both `gi` on win32, regex-escaped);
  7. the slice.
- **map-trust** — the four constructs, verbatim, plus `trustTagAttempts(text)` (`String#match`, which resets
  `lastIndex` itself).

Fail-first proof. In a scratch copy of the repo (`git ls-files -co --exclude-standard` copied out, `git init`), a
runner applied **one mutant at a time** to the named file, ran the test file(s) with a fresh TEMP, recorded red/green,
and restored the file. 0 temp entries were left after every run. **28/28 mutants red; the control is green**:

| Mutant (file: change) | Red test(s) |
|---|---|
| git: delete `env.GIT_OPTIONAL_LOCKS = "0"` | "GIT_OPTIONAL_LOCKS=0 — git status leaves a stale .git/index untouched…"; "changedFiles(): leaves a stale .git/index byte-for-byte untouched…" |
| git: drop `core.quotePath` from NEUTRAL_CONFIG | its row "core.quotePath=false wins…" + the six-keys pin |
| git: drop `i18n.logOutputEncoding` | its row + pin |
| git: drop `log.showSignature` | its row + pin (gpg present here, so the row ran, not skipped) |
| git: drop `column.ui` | its row + pin + the GIT_CONFIG_PARAMETERS/COUNT row |
| git: drop `diff.relative` | its row + pin |
| git: drop `diff.ignoreSubmodules` | its row + pin + "changedFiles(): a hostile global config (set H)…" |
| git: strip set without `GIT_DIR` | "inherited GIT_DIR (absolute, with GIT_WORK_TREE)…" + "mixed-case Git_Dir" (win32) |
| git: strip set without `GIT_WORK_TREE` | "inherited GIT_WORK_TREE (absolute, alone)…" |
| git: strip set without `GIT_INDEX_FILE` | "inherited GIT_INDEX_FILE (absolute)…" |
| git: strip set without `GIT_COMMON_DIR` | "inherited GIT_COMMON_DIR…" (first version of this row survived; fixed, see §5 note) |
| git: strip set without `GIT_OBJECT_DIRECTORY` | "inherited GIT_OBJECT_DIRECTORY…" |
| git: strip set without `GIT_ALTERNATE_OBJECT_DIRECTORIES` | "inherited GIT_ALTERNATE_OBJECT_DIRECTORIES…" |
| git: changedFiles worktree side = spec-literal `diff --name-only -z --no-renames <sha>` | "changedFiles(): leaves a stale .git/index byte-for-byte untouched…" (+ fault test) |
| git: changedFiles without the leading-`-` guard | "changedFiles(): an invalid base … never reaches git as an option" (records git argv in a child) |
| git: parseCount without the `/^\d+$/` check | "parseCount(): an integer only for digits…" |
| git: headState with `HEAD` instead of `HEAD^{commit}` | "headState(): … a dangling HEAD …" + "changedFiles(): an unborn HEAD, an unreadable HEAD…" |
| read-capped: `onError` modes swapped | ENOENT, EISDIR and EACCES/EPERM tests (3) |
| read-capped: tail reads from 0 | cap+1 test + multi-byte test |
| map-trust: `trustTagAttempts` via `matchAll` (copies the shared `lastIndex`) | "repeated calls give the same answers, even after a stray .test()…" |
| map-trust: `trustTagAttempts` via an `exec` loop without a reset | same |
| cli: parseCli first-wins (string options as `multiple`, take `[0]`) | "a repeated string flag keeps its last value" |
| cli: isMain without try/catch | "isMain(): false, never a throw…" |
| redact: key-block rule moved after the key/value rules | "the key block goes before the key-value rule, so a comma inside the key leaks nothing" |
| binding: ×4 (see §3) | — |

Ship's own fault-injection preload: `shallowProbePreload` was copied verbatim out of `test/ship.test.mjs` into a scratch
child that calls lib/git. Modes echo / nonzero / empty / timeout returned `stdout "--is-shallow-repository\n"` /
`status 128` / `stdout ""` / `error ETIMEDOUT` respectively, while unpatched calls reached real git
(`--is-inside-work-tree` → `true`). Interception works without changing the preload.

## 3. S2: removed 9d d4/d5, binding test

Removed from `.github/scripts/validate-structure-core.mjs`:
- `extractSkillFn` (was 813-824, used only by d4/d5);
- d4, the map/ship construct pair (was 905-945);
- d5, the 10+1 `isInvokedDirectly` entry-point cluster (was 947-985).

The 9d header (806-810) was rewritten to say what is left. d1/d2 (dd regex, debug/neutralize, quote-stripper,
settings/stdin markers) and §9's header are kept until P5. Removed from `test/validate-structure.test.mjs` (was 724-779):
"garden 9d FAILS on drift in the map.mjs/ship.mjs mirrored skill constructs" and "garden 9d FAILS on
drift/extraction/marker-loss in the isInvokedDirectly() entry-point cluster". The cleanup grep for `extractSkillFn`,
`ENTRY_POINT_FORWARD`, `ENTRY_POINT_MARKER`, `SKILL_CONSTRUCTS` and `extractSkillConst` finds hits only in old
CHANGELOG entries.

`test/lib-binding.test.mjs`:
1. A per-script binding table (8 scripts + publish-release). Each script must import the lib name by name from the
   right module (specifier resolved from the script's directory), must use it, and must not declare it locally
   (`function`/`const`/`let`/`var`/`class`/destructuring). Alternatives such as `git|gitOrThrow` are allowed. A
   companion test checks the lib modules really export every tabled name.
2. Six signatures:
   - `realpathSync(process.argv[1])`, `KNOWN_FLAGS` and `isInvokedDirectly`, home `cli.mjs`;
   - `(spawnSync|execFileSync)("git"`, home `git.mjs`;
   - the private-key regex source, home `redact.mjs`;
   - `CTIDE:TRUST:(verified`, home `map-trust.mjs`.

   Each must appear exactly once under `cressetide/lib/`, in its home module, and nowhere else. The scope is tracked +
   untracked-not-ignored `.mjs/.js/.cjs` outside `test/`, `cressetide/hooks/` (until P5) and `eval/` (until P10).

Both allowlists are explicit literal lists: 35 `[script, requirement]` binding entries and 35 `[signature, file]`
entries, with the remaining validator `spawnSync("git"` in `gitFiles` listed for P4c. An entry that is no longer needed
fails the test.

Result on the real tree: **18/18 pass with the allowlists**. Red cases came from scratch mutants. In each, regression-delta
was migrated (it imports `isMain`/`parseCli` from `../../../lib/cli.mjs`, its `isInvokedDirectly` block is gone, and it
uses parseCli). Assertion text is quoted:

| Case | Outcome |
|---|---|
| control: migrated + its 4 allowlist entries removed | **green** 36/36 (binding 18 + regression-delta's own 18) |
| (a) + fake local `function isInvokedDirectly() { return false; }` | red: "…regression-delta.mjs carries the per-script entry-point function 1x outside cressetide/lib/ — import it from cressetide/lib/cli.mjs instead" |
| (a′) + `const isMain = () => false;` | red: "…regression-delta.mjs imports isMain from cressetide/lib/cli.mjs but also declares isMain itself" |
| (b) migrated, allowlist entries kept | red ×3: "stale allowlist entry [regression-delta.mjs, isMain]: it is bound to cressetide/lib/cli.mjs now — delete the entry" (+ parseCli), "stale allowlist entry [the entry-point realpath check, …regression-delta.mjs]: the file no longer carries it — delete the entry", same for the entry-point function |

## 4. Gates (final tree)

| Gate | Result |
|---|---|
| `npm test`, TEMP/TMP/TMPDIR = fresh dir | **exit 0**, 1085 tests / 1079 pass / 0 fail / 6 skipped, 89 s. The 6 skips are the pre-existing Windows symlink/permission/case skips. **0 `ctide-*` left**; the only entry is `node-compile-cache` (Node/npm's own compile cache, not test residue) |
| `npm run validate` | **exit 0**, "Plugin structure validation passed." |
| `npx --yes @anthropic-ai/claude-code@2.1.272 plugin validate --strict ./cressetide` | **exit 0**, "✔ Validation passed": the plugin accepts `lib/` |
| S0 `compare p4a-exit` | 300 rows, 0 changed |

New-file byte check: only ASCII plus em dash, no U+FFFD or BOM (see §6, escaping).

## 5. Deviations (each disclosed, each with evidence)

- **D1. changedFiles reads the worktree side from `git status`, not `git diff <sha>`.** A probe on git 2.55 showed that
  `git diff --name-only [-z --no-renames] <commit>` (worktree vs commit) rewrites `.git/index` when stat data is stale,
  even under `GIT_OPTIONAL_LOCKS=0`. `git status`, `diff --cached` and `ls-files` do not. I used `git status
  --porcelain=v1 -z --no-renames --untracked-files=no` and take every entry whose Y column is not a space (modified,
  deleted, type change, intent-to-add, unmerged). Since (base↔index) ∪ (index↔worktree) = (base↔index) ∪
  (base↔worktree), the union is the same set. A test asserts the index bytes and mtime are untouched, and the
  spec-literal mutant is red. All other commands are as specified. Owner/orchestrator may prefer the literal command list.
- **D2. changedFiles reasons for spawn errors.** A spawn error other than ENOENT on `--show-toplevel` (timeout, ENOBUFS)
  gives `read-failed`, not `not-a-work-tree`; a spawn error on base resolution gives `read-failed`, not `invalid-base`.
  Git's own non-zero exits map exactly as specified. This follows failure-memory lesson #4 (a non-answer is not an
  answer).
- **D3. map-trust `lastIndex`.** There is no explicit `lastIndex = 0` line to delete. The guarantee comes from
  `String#match`/`replace`, which reset `lastIndex` per the spec, plus a documented contract never to call
  `.test`/`.exec`/`matchAll` on the shared /g object. `trustTagAttempts()` was added as the safe accessor (recommended
  for ship ×1 / map ×3 in P4b). The two mutants that do leak, `matchAll` and an `exec` loop without a reset, are red.
- **D4. parseCli shape.** It returns `{ error, code }`, adding `code` so tests do not depend on Node's message wording.
  `positionals` means "the most accepted". The dash guard is exposed as the `rejectDashValues` config plus
  `dashValueError()`. Non-array argv is an error.
- **D5. readCapped and directories.** Windows opens a directory and fstat reports size 0, which would silently return
  `""` where the replaced `readFileSync` threw EISDIR. It now throws EISDIR explicitly (parity, tested). `cap` must be a
  positive integer.
- **D6. Name** `redactDiagnostic` (doctor will alias/rename `sanitizeDiagnostic`; publish-release keeps exporting
  `redactReleaseDiagnostic` for its tests until P4c decides).
- **D7. Binding test scope and table.**
  - `test/` is excluded: helpers run fixture git and tests name these utilities on purpose, and including it would need
    permanent exceptions, contradicting "P4c removes the allowlist".
  - The two eliminated names (`KNOWN_FLAGS`, `isInvokedDirectly`) satisfy "exactly once under lib" through one comment
    in `cli.mjs`.
  - The table's expectations are mine and P4b may extend them: ship git+parseCount (F-j); map git+headState (Q4); every
    script isMain+parseCli; doctor readCapped+redactDiagnostic; failure-* readCapped; publish-release git+redact. For
    example, ship may add `headState` for lead 4, or `trustTagAttempts`.
- **D8. Harness classes:** see §1. `flag-alt-form`, `missing-value` and `repeated-flag` are my reading;
  `base-unresolvable` is not allowed.
- **Note (not a deviation): two test rows were strengthened after a mutant survived or could survive.** Removing
  `GIT_COMMON_DIR` from the strip set first survived. Without `GIT_DIR`, git still takes objects and config from an
  inherited `GIT_COMMON_DIR` while refs stay local, so `rev-parse HEAD` was the wrong observable; the row now reads the
  commit subject. `GIT_WORK_TREE` got its own row, because it was only ever set together with `GIT_DIR`. The dash-guard
  test now records every git argv in a child process, because `rev-parse` itself rejects such a base and would hide the
  guard's absence.

## 6. Found but not changed

1. **ship still rewrites `.git/index` despite Q4 #1.** `changelogTouched` runs `git diff --name-only <marker commit>`,
   which compares the worktree with that commit. With stale stat data that rewrites `.git/index` even after lib/git sets
   `GIT_OPTIONAL_LOCKS=0`, so ship's "writes nothing" is not fully restored by Q4 #1 alone. contract-check's `git diff
   --name-only <base>` does the same (P7 replaces it). Suggest P4b decide; the same status-based approach as D1 works.
2. **`test/helpers.mjs` `gitEnv` strips inherited `GIT_*` case-sensitively.** On Windows a mixed-case `Git_Dir` survives
   into fixture git and points it at another repository (observed while writing the Git_Dir row). This is a one-line
   fix to the test infra (uppercase compare); it fits P5's helper cleanup (m-7) or P4b.
3. **map with git missing from PATH prints a TypeError.** The message is "Cannot read properties of undefined (reading
   'trim')" because `repositoryRoot` dereferences a null stderr. The row is recorded as `git-missing`, which may not
   differ at P4 exit; pure extraction keeps the message. Fixing it needs a decision.
4. **21 script comments are stale.** They still say "(documented copy — see garden hash guard)", but the guard for
   script copies is gone. They disappear as P4b/P4c replace the copies, and scripts were out of P4a scope.
5. **Interim window.** Between this phase and P4b, the not-yet-migrated script copies are no longer drift-guarded (d4/d5
   removed first, as ordered). P4b replaces them all.
6. **contract-check reports "scope: clean" without evidence.** This happens for a non-git dir, git missing, and an
   unresolvable `--base` (recorded rows; P7 `scope: unverified`).
7. **The lib-redact equivalence test becomes a tautology at P4c.** It imports `publish-release.mjs`'s
   `redactReleaseDiagnostic`; once P4c points that at lib/redact it compares lib with itself, and P4c can drop it.
8. **Node 22 was not run** (only v24.19.0 is installed). Nothing used is newer than Node 18 (parseArgs, RegExp
   lookbehind, `t.skip`), but this is unverified.
9. **Typos CI was not run locally** (no `typos` binary).

**Escaping hazard reproduced twice** (README proposed failure-memory entry #1):
- The Write tool turned `\uFFFD`/`\uFEFF` escapes in a test file into literal characters. Validator §text integrity
  caught it ("suspicious mojibake marker U+FFFD"); the file now builds them with `String.fromCodePoint`.
- A `sed` replacement turned `\\n` into a real newline in my scratch mutant runner (SyntaxError).

Proposed addition to that entry (not written — the arbiter decides, the main thread writes):
- **Prevention:** in any tool-written source, avoid `\uXXXX` escapes for characters the validator rejects (U+FFFD,
  U+FEFF, controls); build them with `String.fromCodePoint`. After every write, scan the bytes for code points < 0x20,
  U+FFFD and U+FEFF.
- **Tags:** windows, escaping, scripted-edits, tool-write, text-integrity.

## 7. Housekeeping

The scratch repo copy, mutant runner, probes and all temp dirs were deleted by exact path. The `.ctide/output/p4-s0/`
contents are kept on purpose: `record.mjs`, `baseline-*`, `det-e0e3dcb-*` and `p4a-exit-*` (evidence; `compare`
defaults to `baseline`).

---

# P4b evidence: S3–S6 — seven scripts migrated onto `cressetide/lib/`

Branch `refactor/v0.8-slim`, HEAD `e0e3dcb`, on top of the uncommitted P4a tree (kept as is). Nothing staged or
committed. The orchestrator's `docs/handoff/**` edits were not touched. Machine: Windows 11 Pro 10.0.26200,
git 2.55.0.windows.5, Node v24.19.0 (Node 22 not installed, not run). Every test run, harness run and mutant run
used TEMP/TMP/TMPDIR pointed into my own `mktemp -d` directory, deleted by exact path at the end. Not touched:
`ship.mjs`, `publish-release*.mjs`, `validate-structure-core.mjs`, any doc.

## 0. Files changed

| File | Purpose |
|---|---|
| `cressetide/skills/vigil/scripts/regression-delta.mjs` | `isMain` + `parseCli` (no flags, at most 2 positionals); a flag or a 3rd path → stderr line + the existing usage no-claim (exit 0) |
| `cressetide/skills/vigil/scripts/pack-review-diff.mjs` | `isMain` + `parseCli` (`--max-lines`, `--regen`); usage error → stderr line + stdin passed through unchanged; stdin read stays local/uncapped |
| `cressetide/skills/vigil/scripts/failure-retrieve.mjs` | `isMain` + `parseCli` (`--log` boolean, positionals = query); `readCapped` head 256 KiB `onError: "empty"`; usage error → stderr + no-claim, no ledger append |
| `cressetide/skills/vigil/scripts/failure-consolidate.mjs` | `isMain` + `parseCli`; `readCapped` tail 4 MiB `onError: "empty"` for memory file and ledger; usage error → stderr + no-claim line |
| `cressetide/skills/doctor/scripts/doctor.mjs` | `parseCli` once in `main()`; `resolvePluginRoot(flag)` / `resolveProjectCwd(flag)` take values and no longer read `process.argv`; `readCapped` tail 4 MiB / head 64 KiB `onError: "throw"`; `redactDiagnostic` replaces `sanitizeDiagnostic`; usage error → exit 1 |
| `cressetide/skills/vigil/scripts/contract-check.mjs` | `isMain` + `parseCli` (`rejectDashValues: ["base"]`); lib `git`, same `diff --name-only <rev>` query in the process cwd; explicit `--base` resolved with `rev-parse -q --verify <base>^{commit}` and only the SHA passed on; unresolvable → `scope: unverified`; `formatReport` gains optional `scopeUnverified` |
| `cressetide/skills/map/scripts/map.mjs` | `isMain` + `parseCli` (mode positional ≤ 1, `--root`); lib `git` + `headState`; `map-trust` imports (`trustTagAttempts` ×3, `OPS_TRUST_TAG_ATTEMPT` for the one `.replace`) |
| `test/helpers.mjs` | `gitEnv` strips inherited `GIT_*` case-insensitively on win32 |
| `test/helpers.test.mjs` | mixed-case strip row (`Git_Dir`, `git_work_tree`, `Git_Index_File`, `Git_Config_Key_7`) |
| `test/lib-binding.test.mjs` | allowlists shrunk to P4c's files; map row gains `trustTagAttempts`; header updated |
| `test/regression-delta.test.mjs` | +3 parseCli tests |
| `test/pack-review-diff.test.mjs` | −1 KNOWN_FLAGS matrix test, +3 parseCli tests |
| `test/failure-retrieve.test.mjs` | −1 KNOWN_FLAGS matrix test, +5 (parseCli ×4, readCapped head ×1) |
| `test/failure-consolidate.test.mjs` | −1 KNOWN_FLAGS matrix test, +4 (parseCli ×3, readCapped tail ×1) |
| `test/doctor-project.test.mjs` | −4 KNOWN_FLAGS tests (:557, :561, :580, :669), +6 (parseCli ×3, argv-coupling ×1, readCapped tail ×1, readCapped head ×1); header updated |
| `test/doctor-security.test.mjs` | +2 (test#9 node row; redaction of a secret in plugin.json `name`) |
| `test/contract-check.test.mjs` | −1 KNOWN_FLAGS matrix test, +7 (injection, unresolvable base, valid base, test#7, parseCli, GIT_DIR, non-ASCII) |
| `test/map.test.mjs` | +4 (parseCli ×2, GIT_DIR, dangling HEAD); stale comment in the `map` alias test reworded (comment only) |
| `test/documented-facts.test.mjs` | one comment word: "isInvokedDirectly guard" → "entry-point guard" |

Removed KNOWN_FLAGS matrix tests — all eight navigator line numbers verified before removal: contract-check.test:204,
doctor-project.test:557, :561, :580, :669, failure-retrieve.test:262, failure-consolidate.test:401,
pack-review-diff.test:261. The exported `KNOWN_FLAGS` constants are gone from all seven scripts.

All 21 P4a-reported "documented copy — see garden hash guard" comments in these seven scripts are gone (7 entry-point
comments + map's 4 construct comments + map's `git()` comment; the rest are in ship/publish-release (P4c) and hooks (P5)).

Tests: **1085 → 1112** (−8 removed, +35 added).

## 1. S0 harness

`node .ctide/output/p4-s0/record.mjs record --out p4b-exit --env both` (the harness resolves `--out` relative to its
own directory, so this is `.ctide/output/p4-s0/p4b-exit-*.json`), 150 + 150 rows, ~80 s per environment. Then
`compare p4b-exit`: **300 rows compared, 90 changed, 3 outside the harness's allowed set** (exit 1). The same 45 rows
changed in both environments; none changed only under H. `cross p4b-exit`: 19 rows differ normal↔hostile, all ship
(unchanged script, P4c) — the migrated scripts are unaffected by H.

The three "NOT ALLOWED" rows:

- `contract-check/base-unresolvable` (class `base-unresolvable`) — the orchestrator-approved Q3 consequence. The
  harness's `ALLOWED_AT_P4_EXIT` set was not edited (`.ctide/**` is off-limits). Diff:
  `- scope: clean (all changed files within allowedPaths)` → `+ scope: unverified (--base "no-such-ref" does not resolve to a commit) — NO scope or forbidden-path claim`; the AC line is unchanged.
- `doctor/plugin-root`, `doctor/plugin-root-env` (class `flag`) — **environmental, not a regression.** The only
  delta is `syntax=1(stderr=N bytes)` for the fake plugin's missing hook files, N − 3. `node --check` puts the
  absolute fixture path into that stderr, and my TEMP path is 3 characters shorter than the one the baseline was
  recorded under (the normalizer can rewrite paths, not byte counts). Proof: I exported `git archive e0e3dcb` and
  recorded its doctor rows under my TEMP (`record --only doctor --repo <export> --out p4b-ctl-e0e3dcb-doctor`):
  - `compare p4b-ctl-e0e3dcb-doctor` (e0e3dcb scripts vs baseline) shows the **same** two rows changed the same way;
  - `compare p4b-ctl-e0e3dcb-doctor --baseline p4b-exit` (e0e3dcb vs P4b, same TEMP): 26 rows, 8 changed,
    **0 outside the allowed classes** — `plugin-root` / `plugin-root-env` are byte-identical.

Every changed row (normal; hostile has the identical 45, all also hostile-config rows):

| Row | Class | Exit | What changed |
|---|---|---|---|
| map/root-without-mode | ambiguous | 1→0 | `--root X` with no mode now creates (default mode) |
| map/root-equals | flag-alt-form | 1→0 | `--root=X` honored (was ignored → cwd not a repo) |
| map/root-missing-value | missing-value | 1 | stderr: parseArgs message + usage |
| map/unknown-flag | unknown-flag | 0→1 | usage error, no map written |
| map/extra-positional | unknown-flag | 0→1 | usage error, no map written |
| map/dangling-head | map-dangling-head | 0→1 | `Cannot establish repository commit provenance: HEAD does not resolve to a readable commit (fatal: Needed a single revision)`; no `Verified at commit: 1111…` map |
| map/dangling-head-verify | map-dangling-head | 1 | `missing .ctide/map/SYSTEM_MAP.md` (the pre-create now fails) |
| doctor/plugin-root, plugin-root-env | flag | 1 | environmental, see above |
| doctor/plugin-root-missing-value | missing-value | 0→1 | usage error |
| doctor/plugin-root-swallows-project | ambiguous | 1 | usage error, no report |
| doctor/cwd-equals | flag-alt-form | 1 | `--cwd=` honored |
| doctor/unknown-flag | unknown-flag | 1 | usage error, no report |
| contract-check/contract-equals | flag-alt-form | 0 | `--contract=` honored |
| contract-check/base-missing-value, base-swallows-contract, unknown-flag, positional | missing-value / ambiguous / unknown-flag | 0 | stderr usage line + stdout no-claim line |
| contract-check/non-ascii-path | cc-quotepath | 0 | `+ forbidden-path hits: café.txt`, out-of-scope now unquoted (was `"caf\303\251.txt"`) |
| contract-check/base-injection | base-injection | 0 | usage error; **injected file no longer written** (artifact `exists: true` → `false`); no "scope: clean" |
| contract-check/base-injection-equals | base-injection | 0 | usage error (dash guard); was silently ignored |
| contract-check/base-unresolvable | (Q3, approved) | 0 | `scope: unverified`, see above |
| pack-review-diff/max-lines-equals, regen-equals | flag-alt-form | 0 | `=` form honored |
| pack-review-diff/max-lines-missing-value, max-lines-swallows-regen, max-lines-negative, unknown-flag, positional | missing-value / ambiguous / unknown-flag | 0 | stderr usage line; stdout = input unchanged |
| regression-delta/unknown-flag, unknown-short-flag, extra-positional | unknown-flag / ambiguous | 0 | stderr usage line; stdout the usage no-claim (was a computed report) |
| failure-retrieve/cwd-equals, query-equals, top-equals | flag-alt-form | 0 | `=` form honored |
| failure-retrieve/cwd-missing-value | missing-value | 0 | stderr only (stdout was already the no-match line) |
| failure-retrieve/file-swallows-query, top-negative, unknown-flag | ambiguous / unknown-flag | 0 | stderr usage + no-claim; no retrieval |
| failure-retrieve/log-swallows-positional | retrieve-log | 0 | `--log jsdom ci`: ledger `q` `"ci"` → `"jsdom ci"` |
| failure-consolidate/cwd-equals, stale-equals | flag-alt-form | 0 | `=` form honored |
| failure-consolidate/cwd-missing-value, file-swallows-ledger, unknown-flag | missing-value / ambiguous / unknown-flag | 0 | stderr usage + no-claim line |

Unchanged rows of note (not in any allowed class, verified identical): every `no-args`, `happy` and `flag` row of the
seven scripts; contract-check `non-git`, `git-missing` (no `--base`: old fail-open kept); map `git-missing` (the
P4a-noted TypeError is byte-identical, see §6); regression-delta `one-arg`, `double-dash`; pack `max-lines-not-a-number`.

## 2. Binding tests, revert-to-red, mutants

Runner: a scratch copy of the checkout (`git ls-files -co --exclude-standard`, `git init`, no commit), one change at
a time, the named test files run with a fresh TEMP, top-level `not ok` names recorded, file restored, TEMP deleted by
exact path (0 entries left besides `node-compile-cache` after every run). **Control (no mutant): 248 tests / 246 pass /
0 fail** over the ten affected test files.

**Revert each script to its e0e3dcb copy** (local `isInvokedDirectly`, `KNOWN_FLAGS`/`get()`, local utilities):

| Reverted script | Red (named) |
|---|---|
| regression-delta | 3 parseCli tests ("an unknown flag before two real captures…", "a third capture path…", "a short flag (-x)…") + lib-binding: binding row, realpath signature, entry-function signature |
| pack-review-diff | "--max-lines=4 (the `=` form) trims…", "an unknown flag, --max-lines without its value…", "a repeated --max-lines keeps its last value…" + binding row, realpath / flag-list / entry-function signatures |
| failure-retrieve | "--log is a boolean — `--log src/a.ts node`…", "an unknown flag … NO ledger line", "a value flag without its value…", "the `=` form works…" + binding row + 3 signatures |
| failure-consolidate | "an unknown flag is a usage error…", "a value flag without its value…", "the `=` form works (--file=<path>)…" + binding row + 3 signatures |
| doctor | "--cwd=<dir> --project reads the project at <dir>", usage-error test, "a repeated --cwd…", "diagnose() never reads process.argv…" + binding row + 3 signatures + private-key-regex signature |
| contract-check | injection, unresolvable base, valid base (its `=` form was ignored), test#7, parseCli, GIT_DIR, non-ASCII + binding row + 3 signatures + git-spawn signature |
| map | 2 parseCli tests, "inherited GIT_DIR … commit recorded for --root", "a HEAD naming a missing object…" + binding row + realpath / entry-function / git-spawn / trust-grammar signatures |

**Routed and extra mutants** (all red on the named test; everything else in the file stayed green):

| Mutant | Red |
|---|---|
| test#9: node row `nodeVersionMeetsFloor(...)` → `Number(major) >= 20` | "Doctor node row (diagnose): process.versions.node 22.11.0 fails and 22.12.0 passes…" |
| contract-check `rejectDashValues: ["base"]` removed | "--base injection (owner Q3)…" (`--base=--output=` then reaches rev-parse, fails to resolve → `unverified`; no file written, but no usage line naming `--base` — the test requires the usage error) |
| contract-check resolve-to-SHA removed (base passed to `git diff` as given) | "an unresolvable --base reports scope as unverified…" (back to "scope: clean") |
| failure-retrieve `log: { type: "string" }` | "--log is a boolean…" + "the `=` form works…" |
| map `repositoryCommit` back to `rev-parse --verify HEAD` + count (headState bypassed) | "a HEAD naming a missing object is an error…" — lib-binding did **not** go red, see §6 item 1 |
| failure-retrieve `from: "head"` → `"tail"` | "an over-cap memory file is read from the head…" |
| failure-consolidate `from: "tail"` → `"head"` | "an over-cap memory file is read from the tail…" |
| doctor memory read `from: "tail"` → `"head"` | "an over-cap FAILURE_MEMORY.md is read from the tail…" |
| doctor incident read `from: "head"` → `"tail"` | "an over-cap incident journal is read from the head…" |
| doctor `result()` without `redactDiagnostic` | "Doctor redacts a secret carried in plugin.json's name…" |
| helpers `gitEnv` case-sensitive again | "gitEnv: a mixed-case inherited Git_Dir (and kin) is stripped on Windows…" |

Must-not-change tests, all green in the final suite: regression-delta.test CLI tests (~:383–409); pack-review-diff.test
:129, T4/FIX1 (~:192–214), preamble (~:216–230); failure-consolidate.test :325–395; doctor-project.test :149, :156, :163,
:234, the whole `--project` suite, the junction test (now :647), vigil-broken (now :691), Fix8 (now :742); doctor-security.test
:54 (untrusted root, exit 1), :81 (sanitization); contract-check.test :154–171, :181 (non-git `--base HEAD`: exit 0,
stderr `""`, stdout mentions scope); map.test create/verify/`map` alias/junction (now :1163–1220), unborn drift (~:162),
unborn vs unreadable (~:974).

## 3. `test/lib-binding.test.mjs` allowlists after P4b

```
BINDING_ALLOWLIST   (11): [SHIP: isMain, parseCli, git|gitOrThrow, parseCount, OPS_TRUST_TAG_ATTEMPT, OPS_TRUST_TAG_WELLFORMED, opsTrustTagIsWellFormed]
                          [PUBLISH_RELEASE: isMain, parseCli, git|gitOrThrow, redactDiagnostic]
SIGNATURE_ALLOWLIST (12): realpath → SHIP, PUBLISH_RELEASE, PUBLISH_RELEASE_CORE
                          flag list → SHIP
                          entry function → SHIP, PUBLISH_RELEASE, PUBLISH_RELEASE_CORE
                          git spawn → SHIP, PUBLISH_RELEASE, VALIDATOR_CORE (gitFiles)
                          private-key regex → PUBLISH_RELEASE
                          trust grammar → SHIP
```

Only P4c's files remain. The map row now also requires `trustTagAttempts` (P4a D7 allowed P4b to extend the table).

## 4. Gates (final tree)

| Gate | Result |
|---|---|
| `npm test`, TEMP/TMP/TMPDIR = fresh dir | **exit 0**, 1112 tests / 1106 pass / 0 fail / 6 skipped (the pre-existing Windows symlink/permission skips), 90 s; TEMP afterwards holds only `node-compile-cache`, **0 `ctide-*`** |
| `npm run validate` | **exit 0**, "Plugin structure validation passed." |
| `npx --yes @anthropic-ai/claude-code@2.1.272 plugin validate --strict ./cressetide` | **exit 0**, "✔ Validation passed" |
| byte scan of every changed file | no control characters, no U+FFFD/U+FEFF; the only non-ASCII on added lines is U+2014 (em dash); the one non-ASCII path in a test is built with `String.fromCodePoint(0xe9)`; all files LF |

## 5. Deviations (each disclosed)

- **D1. regression-delta, too few paths.** 0 or 1 path keeps the old stdout usage no-claim **without** a stderr line;
  only parse errors (a flag, a third path) add the stderr line. The `no-args` / `one-arg` S0 rows (classes no-args /
  happy) must not change, and a missing argument is not a parse error.
- **D2. contract-check resolves only an explicit `--base`.** Without `--base` the query stays `diff --name-only HEAD`
  with the old fail-open (non-git and git-missing rows unchanged, per "a git failure still yields the existing
  fail-open behavior"). An explicit base that cannot be resolved — including in a non-git dir — gives
  `scope: unverified`. New stdout texts I chose: the unverified line (also suppresses the forbidden-path line; the AC
  coverage line stays because it does not depend on git) and the usage-error no-claim line.
- **D3. failure-consolidate usage error.** It had no documented no-claim line; the new stdout line is
  `ctide failure-consolidate: no claim — the command line could not be parsed, so nothing was read; this report modifies nothing.`
  failure-retrieve reuses its documented no-match no-claim line (which says "no matching … entries" although no query ran).
- **D4. map without a mode.** `map.mjs --root X` now creates (default mode) instead of failing with "usage" because
  `--root` used to land in `argv[0]`. Allowed class (`ambiguous`); the `map` alias test's comment that described the
  old behavior was reworded (comment only, assertions untouched).
- **D5. map `repositoryCommit`.** `headState` returns only the state, so a born HEAD costs one more
  `rev-parse --verify HEAD^{commit}` to get the id; the error is now
  `Cannot establish repository commit provenance: HEAD does not resolve to a readable commit (<git stderr>)`.
- **D6. stderr usage line format.** `<script>: <parseArgs message, whitespace collapsed to one line> (usage: …)`;
  map keeps its old unprefixed style: `<message>; usage: map.mjs [create|refresh|verify] [--root PATH]`. parseArgs's
  own message for unknown options with positionals allowed carries a long hint — cosmetic.
- **D7. doctor ledger read** keeps the existing `try { readCappedTail } catch { "" }` (throw-and-catch) rather than
  `onError: "empty"` — same semantics, smaller diff.
- **D8. helpers strip row** is a separate test next to the strip table, not a row inside its loop: on Windows
  `process.env` folds `Git_Dir` into the `GIT_DIR` the loop sets. Skipped on non-win32 (git never reads `Git_Dir` there).
- **D9. Two tests beyond the brief**: doctor's over-cap incident journal (head) — without it a `from` swap there
  survives; and "diagnose() never reads process.argv" — pins the coupling fix.
- **D10. Harness exit 1** with the three rows explained in §1; the extra control recording
  `p4b-ctl-e0e3dcb-doctor-{normal,hostile}.json` was written into `.ctide/output/p4-s0/` by running the harness and
  is kept as evidence.

## 6. Found but not changed

1. **lib-binding counts a mention in a comment as a use.** With map's `headState` call removed, the binding test stayed
   green because the comment above `repositoryCommit` names `headState`. The behavioral test caught it. Hardening the
   "never uses it" check (ignore comments) fits P4c, which removes the allowlist anyway.
2. **map with git missing from PATH still prints a TypeError** ("Cannot read properties of undefined (reading 'trim')",
   P4a §6 #3). lib `git` returns the same spawnSync shape, so the row is byte-identical; fixing it needs a decision.
3. **contract-check's `git diff --name-only <rev>` can rewrite `.git/index` with stale stat data** (P4a §6 #1). The same
   query was kept as instructed; P7 moves to `changedFiles`.
4. **contract-check still says "scope: clean" without `--base` in a non-git dir or without git** (P4a §6 #6; P7).
5. **Docs do not yet describe** contract-check's `scope: unverified` line or the usage-error behavior of the seven
   scripts (e.g. `cressetide/agents/arbiter.agent.md:63`, `skills/vigil/references/task-contract.md`,
   `verification-gate.md:12`). Out of my scope (no docs).
6. **ship.mjs comments now point at removed code**: `ship.mjs:13` (map.mjs's spawnSync git helper) and `:622`
   (failure-consolidate's KNOWN_FLAGS guard). P4c.
7. **Test titles** still say `isInvokedDirectly()` (doctor-project junction test, map junction test) — must-not-change
   tests, left as is.
8. Node 22 not run; typos CI not run locally.

Proposed failure-memory addition (not written; the arbiter decides): **a `cat > file` with no heredoc in Git Bash
waits on stdin and hangs the tool call for the full timeout, leaving an empty file behind.** It happened once here
(an empty `%TEMP%\probe-cli.mjs` of my own; the hung `cat` was killed and the file deleted by exact path).
Prevention: write scratch files with the Write tool or a heredoc only; run probes with `< /dev/null`.
Tags: windows, git-bash, scripted-edits, housekeeping.

## 7. Housekeeping

My `mktemp -d` work directory (scratch repo copy for mutants, the `git archive e0e3dcb` export, all per-run TEMPs,
logs) was deleted by exact path, as were my scratchpad helper scripts (mutant runner, splice helper, byte scanner,
probes). Kept on purpose in `.ctide/output/p4-s0/`: `p4b-exit-{normal,hostile}.json` and
`p4b-ctl-e0e3dcb-doctor-{normal,hostile}.json` (evidence). Nothing else under `.ctide/` was touched.

---

# P4c evidence: S7–S10 — ship and publish-release onto `cressetide/lib/`, publish-release-core deleted, validator `gitFiles` onto lib/git, binding test without allowlists

Branch `refactor/v0.8-slim`, HEAD `e0e3dcb`, on top of the uncommitted P4a + P4b tree (kept as is). Nothing staged or
committed. The orchestrator's `docs/handoff/**` edits were not touched. Machine: Windows 11 Pro 10.0.26200, git
2.55.0.windows.5, Node v24.19.0 (Node 22 not installed, not run). Every test, harness, mutant and hostile run used
TEMP/TMP/TMPDIR pointed into my own `mktemp -d` directory (`%TEMP%\p4c-work-Jg0RXy`), deleted by exact path at the end.

## 0. Files changed (P4c only)

| File | Purpose |
|---|---|
| `cressetide/skills/ship/scripts/ship.mjs` | S7a: `isMain`/`parseCli`, lib `git`, `headState`, `parseCount`, map-trust (`trustTagAttempts`, `OPS_TRUST_TAG_WELLFORMED`, `opsTrustTagIsWellFormed`); per-command neutralizers removed; usage-error path; stale comments fixed. S7b: F-j, leads 1–4, index-safe changelogTouched |
| `cressetide/skills/ship/references/ship-contract.md` | the six owner-approved edits (§5), nothing else |
| `cressetide/lib/cli.mjs` | comment only: the header no longer names the two eliminated constructs (AC-9 "0") |
| `.github/scripts/publish-release.mjs` | `parseCli` (`--archive`/`--publish`/`--tag`, order-independent, both modes = usage error, exit 1), lib `git`/`gitOrThrow` with a 30 s timeout on every git call, `redactDiagnostic` (re-exported as `redactReleaseDiagnostic`), `normalizeGzipOsByte` folded in |
| `.github/scripts/publish-release-core.mjs` | **deleted** (working tree; not staged) |
| `.github/scripts/validate-structure-core.mjs` | `gitFiles` through lib `git()` (256 MiB maxBuffer); env inventory no longer lists core |
| `test/ship.test.mjs` | −2 KNOWN_FLAGS matrix tests, +13 (3 CLI, F-j, lead 1, lead 2, lead 3, lead 4, `tag --merged` coverage, index, >1 MiB, i18n, GIT_DIR); snapshot comment updated |
| `test/release-cli.test.mjs` | 14 redundant `try/finally fs.rmSync` blocks removed (all `tempDir`/`makeRepo` targets); stale comments and core copy removed; +6 (lib in archive + extracted run, usage error, order, GIT_DIR, `normalizeGzipOsByte` ×2 ported) |
| `test/release-publisher.test.mjs` | **deleted** (24 tests, all for core's dead code except the two ported `normalizeGzipOsByte` tests) |
| `test/helpers.mjs` | dead `sha256File`, `makeReleaseRoot`, `makeReleaseRunner`, `fakeArchiveWriter` removed (`parseTar` kept) |
| `test/lib-binding.test.mjs` | allowlist mechanism removed; comment-insensitive binding check (+1 unit test); ship row gains `headState`/`trustTagAttempts`; validator row added; eliminated signatures expect 0 |
| `test/lib-redact.test.mjs` | the P4a equivalence test (a tautology now) became an identity assertion |
| `test/lib-git.test.mjs` | one row pins `--sort=refname` (hostile-run finding, §4) |
| `test/validate-structure.test.mjs` | CLI failure-path test also copies `cressetide/lib/git.mjs`; +1 inherited GIT_DIR/GIT_INDEX_FILE test |

Not in the repo tree: `.ctide/output/p4-s0/record.mjs` (harness, §2), `p4c-exit-{normal,hostile}.json`, this file.

Tests: **1112 → 1106** (−24 release-publisher, −2 ship, −2 lib-binding allowlist tests; +13 ship, +6 release-cli,
+1 validate-structure, +1 lib-binding comment test, +1 lib-binding validator row).

## 1. Red records (fail-first) and revert-to-red

Runner: a scratch copy of the checkout (`git ls-files -co --exclude-standard` copied out, `git init`, `git add -A`, no
commit), one scenario at a time: change the named file(s), run the named test files with a fresh TEMP, record the
top-level `not ok` names, restore, delete that TEMP by exact path (residue: none in every run). "Reverted" means the
file is the byte-identical e0e3dcb copy. **Control: 312 tests / 312 pass** (ship, release-cli, release-doctor,
validate-structure, lib-binding, lib-redact).

**ship.mjs reverted to e0e3dcb** — 18 red (ship.test + lib-binding), everything else green:

| Item | Red test |
|---|---|
| binding | "binding: cressetide/skills/ship/scripts/ship.mjs takes every shared utility it uses from cressetide/lib" + signatures: realpath, hand-rolled flag list, entry-point function, direct git spawn, trust-tag grammar |
| parseCli | "CLI flags: the `--flag=value` form is honored … a repeated --cwd keeps its last value"; "CLI usage error: … one no-run line on stdout — no report, no verdict word"; "CLI usage error with --json anywhere … a no-run JSON report" |
| F-j | "pending view: a commit count that is not plain digits (empty, blank, hex, exponent) is unverified — never 'no commits since <tag>' beside a listed set" |
| lead 1 | "resolveMarker: a tag list that cannot be read inside a repository is stated as a read failure in marker.note …" |
| lead 2 | "tagReadinessCheck: a tag lookup that times out or fails … is unverified, never read as 'no tag' and passed" |
| lead 3 (Q2) | "changelogTouchedCheck: with a subdirectory --cwd, <cwd>/CHANGELOG.md is the file checked and diffed — committed, staged or unstaged — whatever diff.relative says" |
| lead 4 | "pending view: a broken or dangling HEAD in a repository that has commits is unverified, never no-release-tag" (the broken-ref case read `no-release-tag`) |
| writes nothing (Q4 #1) | "ship.mjs never writes .git/index either: on a working tree with stale stat data, a full run leaves the index's bytes and mtime unchanged" |
| code#5 maxBuffer | "pending view: a changed-file list over 1 MiB (NUL-separated) is still listed — 'showing 500 of N', not unverified" (20 000 index-only paths, 1.76 MB) |
| i18n | "pending view: a non-ASCII commit subject is listed verbatim under i18n.logOutputEncoding=ISO-8859-1" |
| inherited GIT_DIR | "CLI: an inherited absolute GIT_DIR and GIT_INDEX_FILE naming another repository do not change the repository --cwd reads" |

**ship.mjs with the lib git import swapped back for a local `spawnSync("git")` copy** (everything else P4c) — 9 red:
the ship binding row, the git-spawn signature, the index, >1 MiB, i18n and GIT_DIR tests, and three pre-existing
tests that now rely on lib's fixed overrides since the per-command flags are gone: "pending view and marker: a
repository's column.ui/column.tag=always and tag.sort=-refname do not hide the release tag", "… log.showSignature=true
with SSH-signed commits …", "pending view: a repository's diff.relative=true does not relativize the paths …".

**publish-release.mjs reverted to e0e3dcb** (core restored, and release-cli's scratch roots made to copy core too, so
the old script can load) — 9 red: the publish-release binding row; signatures realpath, entry-point function, git
spawn, private-key regex; "publish-release's exported redactReleaseDiagnostic is cressetide/lib/redact.mjs's
redactDiagnostic itself"; and the three binding tests: "release CLI: a usage error — an unknown flag, both modes, --tag
without its value, a stray argument — exits 1 with the usage and builds nothing" (old: `--archive --bogus` exit 0),
"release CLI: `--tag v9.9.9 --archive` and `--archive --tag v9.9.9` both build the tag-bound archive" (old: "Unknown
mode: --tag"), "release CLI: --archive with an inherited absolute GIT_DIR … still applies the scratch repository's own
ignore rules" (old: the other repository's `.git/info/exclude` was read, so the excluded file shipped).

**publish-release.mjs with the lib redact import swapped back for the verbatim e0e3dcb chain** — 3 red: binding row,
private-key-regex signature, the identity test. All release-doctor redaction tests stay green (same chain).

**validator `gitFiles` back to `cp.spawnSync("git", …, { cwd })`** — 3 red: the validator binding row, the git-spawn
signature, "validate-structure: gitFiles(fixture) with an inherited absolute GIT_DIR and GIT_INDEX_FILE naming another
repository still returns the fixture's lists".

**Comment-insensitive binding check** (P4b §6 #1): map's `repositoryCommit` changed to bypass `headState` while the
comment above it still names it → red: "binding: cressetide/skills/map/scripts/map.mjs takes every shared utility it
uses from cressetide/lib" with `map.mjs imports headState from cressetide/lib/git.mjs but never uses it`. The same
mutant with the binding check's comment blanking removed → the map row is green again (P4b's gap reproduced) and only
the new unit test "binding: a name that appears only in a comment is not a use, and a commented-out import is not an
import" is red; that unit test alone is red without the blanking.

The lexer behind the blanking was validated in scratch on all 62 in-scope `.mjs/.js/.cjs` files: same length and line
breaks, `node --check` still passes on the blanked text, no `//` line comment survives, and every blanked character
lies inside a comment.

Not fail-first, by nature (stated, not hidden): the archive-contains-lib test (old publish-release also ships an
untracked-but-not-ignored `lib/`); the two ported `normalizeGzipOsByte` tests; the `tag --merged` coverage test (the
old code had that branch too).

## 2. S0 harness: `compare p4c-exit`

Harness changes (`.ctide/output/p4-s0/record.mjs`): `base-unresolvable` added to `ALLOWED_AT_P4_EXIT` (owner Q3
consequence); `stabilize()` rewrites `(stderr=N bytes)` to `(stderr=<n> bytes)` at record time and on both sides of a
compare, so doctor's `node --check` byte counts no longer depend on the temp-path length.

`record --out p4c-exit --env both` (150 + 150 rows, 81 s / 85 s), then `compare p4c-exit` (run from
`.ctide/output/p4-s0`): **300 rows compared, 129 changed, 0 outside the allowed P4-exit classes, exit 0.**
60 changed under normal, 69 under hostile. `doctor/plugin-root` and `plugin-root-env` are now unchanged (P4b's two
"NOT ALLOWED" rows were the byte count).

Every changed row ("both" = normal and hostile; every hostile row is also class hostile-config):

| Script | Rows | Class | Env |
|---|---|---|---|
| ship | cwd-equals, artifact-equals, json-with-value | flag-alt-form | both |
| ship | cwd-missing-value | missing-value | both |
| ship | artifact-swallows-checksum | ambiguous | both |
| ship | cwd-repeated | repeated-flag | both |
| ship | unknown-flag, positional | unknown-flag | both |
| ship | lead3-subdir-cwd | ship-routed | normal |
| ship | lead4-dangling-head, fj-count-empty, lead1-tag-list-fails, lead2-tagready-revparse-timeout | ship-routed | both |
| ship | happy-text, happy-json, env-project-dir, dirty, gitlink | happy | hostile |
| ship | no-args | no-args | hostile |
| ship | checksum-pass, checksum-mismatch, artifact-only, checksum-only | flag | hostile |
| map | root-without-mode | ambiguous | both |
| map | root-equals | flag-alt-form | both |
| map | root-missing-value | missing-value | both |
| map | unknown-flag, extra-positional | unknown-flag | both |
| map | dangling-head, dangling-head-verify | map-dangling-head | both |
| doctor | plugin-root-missing-value | missing-value | both |
| doctor | plugin-root-swallows-project | ambiguous | both |
| doctor | cwd-equals | flag-alt-form | both |
| doctor | unknown-flag | unknown-flag | both |
| contract-check | contract-equals | flag-alt-form | both |
| contract-check | base-missing-value | missing-value | both |
| contract-check | base-swallows-contract | ambiguous | both |
| contract-check | unknown-flag, positional | unknown-flag | both |
| contract-check | non-ascii-path | cc-quotepath | both |
| contract-check | base-injection, base-injection-equals | base-injection | both |
| contract-check | base-unresolvable | base-unresolvable | both |
| pack-review-diff | max-lines-equals, regen-equals | flag-alt-form | both |
| pack-review-diff | max-lines-missing-value | missing-value | both |
| pack-review-diff | max-lines-swallows-regen, max-lines-negative | ambiguous | both |
| pack-review-diff | unknown-flag, positional | unknown-flag | both |
| regression-delta | unknown-flag, unknown-short-flag | unknown-flag | both |
| regression-delta | extra-positional | ambiguous | both |
| failure-retrieve | cwd-equals, query-equals, top-equals | flag-alt-form | both |
| failure-retrieve | cwd-missing-value | missing-value | both |
| failure-retrieve | file-swallows-query, top-negative | ambiguous | both |
| failure-retrieve | unknown-flag | unknown-flag | both |
| failure-retrieve | log-swallows-positional | retrieve-log | both |
| failure-consolidate | cwd-equals, stale-equals | flag-alt-form | both |
| failure-consolidate | cwd-missing-value | missing-value | both |
| failure-consolidate | file-swallows-ledger | ambiguous | both |
| failure-consolidate | unknown-flag | unknown-flag | both |
| publish-release | tag-missing-value | missing-value | both |
| publish-release | tag-before-mode | ambiguous | both |
| publish-release | unknown-mode, unknown-flag | unknown-flag | both |

The new (P4c) rows, by what changed:
- ship flag rows: `--cwd=`/`--artifact=` honored; `--cwd a --cwd b` reads b; unknown flag, positional, missing value
  and `--artifact --checksum` print `ship: <parser message> (usage: …)` on stderr and the one-line no-run message (or,
  with `--json`/`--json=1`, the no-run JSON report); exit 0 throughout.
- ship routed: **F-j** `fj-count-empty` `ok` "no commits since v1.0.0" beside 3 listed commits → `unverified`, no
  list. **lead 1** note "no vX.Y.Z release tag found" → "the tag list could not be read (exit 128) — whether a vX.Y.Z
  release tag exists is unknown". **lead 2** tagReady `pass` → `unverified` "looking up tag v1.1.0 failed
  (ETIMEDOUT), so a tag for v1.1.0 cannot be confirmed absent — it may already exist". **lead 3** changelogTouched
  `fail` → `pass` (normal; under hostile it was already `pass` through `diff.relative=true`). **lead 4** pending note
  "listing the tags reachable from HEAD failed" → "HEAD cannot be resolved to a readable commit" (state unverified in
  both). `fj-count-status` is unchanged (already `unverified`).
- ship hostile-only: `add caf<U+FFFD> notes` → `add café notes` (i18n override) in ten rows, and `gitlink` lists `sub`
  (`diff.ignoreSubmodules` override). `cross p4c-exit`: 17 ship rows differ normal↔hostile, **all only in 12- vs 7-char
  abbreviations** (`core.abbrev`, deliberately not neutralized); `cross baseline` had 19.
- publish-release: `--archive --tag` (no value) built an untagged archive (exit 0) → usage error (exit 1, nothing
  built); `--tag v0.7.2 --archive` "Unknown mode: --tag" → builds; `--bogus` "Unknown mode" → "Unknown option
  '--bogus' (usage: …)"; `--archive --bogus` built (exit 0) → usage error (exit 1). Unchanged: archive, no-args,
  archive-tag, unknown/malformed tag, `--tag=v0.7.2`, publish rows, non-git, git-missing.
- The rest are the P4b rows, unchanged since P4b.

## 3. AC-9 / AC-21 greps; lib-binding without allowlists

Scope: tracked + untracked-not-ignored `.mjs/.js/.cjs` outside `test/`, `cressetide/hooks/` (P5) and `eval/` (P10) —
16 files.

```
realpathSync\(process\.argv\[1\]\)              cressetide/lib/cli.mjs:15        (only)
KNOWN_FLAGS                                     0
isInvokedDirectly                               0
(spawnSync|execFileSync)\(\s*"git"              cressetide/lib/git.mjs:56        (only)
-----BEGIN [^-\r\n]*PRIVATE KEY----- (fixed)     cressetide/lib/redact.mjs:25     (only)
CTIDE:TRUST:\(verified                          cressetide/lib/map-trust.mjs:21  (only)
extractSkillFn|ENTRY_POINT_|SKILL_CONSTRUCTS    0
git grep publish-release-core -- ':!CHANGELOG.md' ':!docs/handoff'     0 hits (exit 1)
```

AC-21 `git ls-files`: both files are deleted in the working tree (`git status`: ` D .github/scripts/publish-release-core.mjs`,
` D test/release-publisher.test.mjs`; `git ls-files --deleted` lists exactly these two). `git ls-files` itself still
lists them because nothing is staged (instruction: no commit); they leave the index with the orchestrator's commit.

`test/lib-binding.test.mjs`: no allowlist constant or test remains (`grep ALLOWLIST` → nothing); 18/18 pass on the
final tree (10 binding rows incl. the validator, table check, comment unit test, 6 signatures).

## 4. Gates

| Gate | Result |
|---|---|
| Hostile run: contract-check, helpers, map, release-cli, release-doctor, ship, validate-structure + all six `lib-*` test files, `GIT_CONFIG_GLOBAL` = set H + the 11 output-shaping keys (20 keys) | **exit 0, 482 tests / 482 pass**, TEMP empty afterwards. First attempt: 481/482 — `lib-git.test` "NEUTRAL_CONFIG also wins over inherited GIT_CONFIG_PARAMETERS…" listed tags without `--sort=refname`, so the global `tag.sort=-refname` reversed them (lib leaves `tag.sort` to callers by design). Fixed in the test by pinning the query flag, as every production caller does |
| `npm test`, fresh TEMP (final tree) | **exit 0, 1106 tests / 1100 pass / 0 fail / 6 skipped** (the pre-existing Windows symlink/permission skips), 95 s; TEMP afterwards: only `node-compile-cache`, **0 `ctide-*`** |
| `npm run validate` | **exit 0**, "Plugin structure validation passed." |
| `npx --yes @anthropic-ai/claude-code@2.1.272 plugin validate --strict ./cressetide` | **exit 0**, "✔ Validation passed" (re-run after the last comment edit) |
| byte scan of every touched file | UTF-8 round-trips, LF only, no control characters, no U+FFFD/U+FEFF, no tabs on added lines; non-ASCII on added lines: U+2014, U+2192 (ship-contract, as in the file), U+2026 (three test comments); the one non-ASCII test subject is built with `String.fromCodePoint(0xe9)` |

Hostile set H used: `merge.verifySignatures`, `commit.gpgSign`, `tag.gpgSign`, `tag.forceSignAnnotated` = true;
`gpg.program` = a missing exe; `core.hooksPath` = a directory of hooks that all `exit 1` (pre-commit, commit-msg,
prepare-commit-msg, post-commit, pre-merge-commit, post-checkout, post-merge, post-rewrite, reference-transaction,
pre-push — with reference-transaction even `git init` fails under it); `core.safecrlf=true`; `init.defaultBranch=trunk`;
`core.abbrev=12`; plus `column.ui=always`, `tag.sort=-refname`, `log.showSignature=true`,
`i18n.logOutputEncoding=ISO-8859-1`, `diff.relative=true`, `core.quotePath=true`, `status.showUntrackedFiles=no`,
`diff.ignoreSubmodules=all`, `color.ui=always`, `log.decorate=full`, `format.pretty=fuller`.

## 5. The six ship-contract.md edits, verbatim (old → new)

1. Pending view, git reads (was ~:50-56):

   Old:
   ```
   (`git tag --no-column --sort=refname --merged HEAD`). Then it lists the commits
   (`git log --no-show-signature --format=%h%x09%s <tag>..HEAD` — short SHA and subject) and the
   changed file paths (`git -c diff.relative=false diff --name-only --no-renames -z <tag>..HEAD` —
   always repository-relative, and a renamed file appears under both its old and its new path) in that
   range. These reads pin the flags a user's git config would otherwise change (`--no-column`,
   `--sort=refname`, `--no-show-signature`, `-c diff.relative=false`), so the pending view does not
   depend on `column.*`, `tag.sort`, `log.showSignature` or `diff.relative`. It is a plain git fact,
   ```
   New:
   ```
   (`git tag --sort=refname --merged HEAD`). Then it lists the commits
   (`git log --format=%h%x09%s <tag>..HEAD` — short SHA and subject) and the
   changed file paths (`git diff --name-only --no-renames -z <tag>..HEAD` —
   always repository-relative, and a renamed file appears under both its old and its new path) in that
   range. These reads go through the shared git layer, which pins a fixed list of config overrides
   (`core.quotePath`, `i18n.logOutputEncoding`, `log.showSignature`, `column.ui`, `diff.relative`,
   `diff.ignoreSubmodules`); with `--sort=refname` on the tag read, the pending view does not depend on
   a user's `column.*`, `tag.sort`, `log.showSignature`, `i18n.logOutputEncoding` or `diff.relative`. A
   project's own `.gitmodules` `ignore` setting still applies. It is a plain git fact,
   ```
   (`column.ui=never` on the command line also overrides a repository's `column.tag=always` — probed on git 2.55, and
   covered by the existing column test.)

2. changelogTouched (was ~:91-93):

   Old:
   ```
      this repository's own `git diff --name-only <base>` convention). No `CHANGELOG.md` in the
      repository at all → `not-applicable`. No marker resolved → `unverified` (no diff boundary to
      compare against).
   ```
   New:
   ```
      this repository's own `git diff --name-only <base>` convention). With a subdirectory `--cwd`,
      `<cwd>/CHANGELOG.md` is the file checked and diffed. No `CHANGELOG.md` there at all →
      `not-applicable`. No marker resolved → `unverified` (no diff boundary to compare against).
   ```
   ("in the repository at all" → "there at all" is part of this edit: with a subdirectory `--cwd` the existence check is
   `<cwd>/CHANGELOG.md`, so "the repository" would be wrong.)

3. tagReady (was ~:100-101):

   Old:
   ```
      second tag of the same version either no-ops or errors). A dirty working tree → `fail`. Clean tree,
      no existing tag → `pass`.
   ```
   New:
   ```
      second tag of the same version either no-ops or errors). A failure to look up the tag itself
      (anything but git reporting that no such tag exists) → `unverified`, never read as no tag. A
      dirty working tree → `fail`. Clean tree, no existing tag → `pass`.
   ```

4. Release-marker resolution (was ~:32):

   Old:
   ```
   `unverified` (no diff boundary). On a shallow clone (`git rev-parse --is-shallow-repository`
   ```
   New:
   ```
   `unverified` (no diff boundary). A failure to list the tags inside a repository is stated as such in
   `marker.note`, never as "no tag found". On a shallow clone (`git rev-parse --is-shallow-repository`
   ```

5. The `unverified` row (was ~:75):

   Old:
   ```
   | `unverified` | git started but a read failed or timed out — determining whether the history is shallow, listing the tags reachable from `HEAD`, or reading the commits or changed files since the tag (or an unexpected internal error). |
   ```
   New:
   ```
   | `unverified` | git started but a read failed or timed out — determining whether the history is shallow, listing the tags reachable from `HEAD`, or reading the commits or changed files since the tag; or `HEAD` cannot be resolved; or the commit count is not a number (or an unexpected internal error). |
   ```

6. checksumVerify (was ~:123):

   Old: ``   repository's own release tooling (`.github/scripts/publish-release-core.mjs`): a line reading``
   New: ``   repository's own release tooling (`.github/scripts/publish-release.mjs`): a line reading``

Width: every new or changed prose line is ≤ 100 characters (the longest are 100); no code span is split; the table row
is a single line like the one it replaces. `git diff --stat`: 18 insertions, 14 deletions, nothing outside these six.

## 6. Deviations (each disclosed) and decisions I made

- **D1. Usage-error output (ship).** stderr: `ship: <parser message> (usage: ship.mjs [--cwd DIR] [--artifact PATH
  --checksum PATH] [--json])`. stdout without `--json`: one line, `ctide-ship (read-only, writes nothing): usage error —
  the command line could not be parsed, so ship read nothing and ran no check (usage: …)`. With `--json` (or
  `--json=<x>`) anywhere in argv: the shape of the existing internal-error fallback — `marker` not found and `pending`
  `unverified`, both carrying that path-free note, the disclaimer, and `checks: {}` (no check runs). Exit 0.
- **D2. Lead 1 boundary.** Only on a failed tag list, ship asks `git rev-parse --git-dir`: git missing or no repository
  keeps today's "no vX.Y.Z release tag found" (the non-git / git-missing harness rows are unchanged); anything else,
  including that probe timing out, is the read-failure note. The note carries the exit status or spawn code only.
- **D3. Lead 2 order.** A lookup failure is recorded and reported after the shallow checks and the `git status` read,
  before the dirty-tree `fail`. Outside a work tree every lookup fails too, and the stated gap stays the failed `git
  status` (non-git / git-missing rows unchanged); inside one, an unresolved existence question is `unverified` even
  on a dirty tree, like the shallow case. "No such tag" is exactly `rev-parse -q --verify` exit 1.
- **D4. changelogTouched without `git diff <commit>`.** The union (marker commit vs index: `diff --cached --name-only
  -z --no-renames <commit> -- CHANGELOG.md`) ∪ (index vs working tree: `status --porcelain=v1 -z --no-renames
  --untracked-files=no -- CHANGELOG.md`, Y column), as lib's `changedFiles` reads — tighter than the brief's example
  (`diff <tag> HEAD` + status). Untracked files stay out, as with `git diff <commit>`. Pathspec relative to `--cwd`.
  One edge differs from `git diff <commit>`: a change staged and then reverted in the working tree counts as changed.
- **D5. publish-release** keeps exporting `redactReleaseDiagnostic`, now as lib's function itself (release-doctor :437,
  must-not-change, imports it); the lib-redact equivalence test became `assert.equal(redactReleaseDiagnostic,
  redactDiagnostic)` plus the input loop. Per-call maxBuffer kept as today (16 MiB text, 4 MiB JSON blob, 32 MiB archive
  blob); `check-ignore` now has lib's 64 MiB (was Node's 1 MiB) and 30 s (was 10 s). Usage errors use the existing
  `Cressetide release failed:` prefix, with `(usage: …)`. `--tag=` (empty) means "no tag".
- **D6. lib-binding.** The eliminated signatures (flag list, entry-point function) now expect 0 occurrences everywhere,
  to match AC-9's "0"; that required rewording `cli.mjs`'s header comment, which named both (comment only). Comment
  blanking uses a small lexer (strings/templates/regex literals kept); a name inside a string still counts as a use.
  Validator row and ship `headState` added.
- **D7. Extra tests beyond the brief:** the `tag --merged HEAD` fault test (the existing "a failed read of the tags
  reachable from HEAD" fixture deletes HEAD's commit, so it now stops at `headState` and that branch lost its only
  test); release-cli imports every archived `.mjs` from the extracted tree in a fresh process, besides running ship
  from it.
- **D8. Hostile set** is stronger than required (a failing `reference-transaction` hook). The `lib-git.test` fix (§4) is
  a test-hermeticity fix in a P4a file.
- **D9. AC-21 `git ls-files`**: see §3 (no staging by instruction).
- **D10. ship-contract edit 2** also says "there at all" (see §5).

## 7. Found but not changed

1. **`git tag --merged HEAD` hides a missing commit.** With an object between HEAD and the tag deleted, git 2.55 prints
   "error: Could not read <sha>" and **exits 0** with no tag listed, so pending reads `no-release-tag` (or a lower
   boundary). Probed in scratch; out of the routed list. A stderr check or `headState`-style verification would close it.
2. **A broken tag ref** (`refs/tags/vX.Y.Z` holding garbage) makes `rev-parse -q --verify` exit 1 with "warning:
   ignoring broken ref", which tagReady reads as "no such tag" (git's own exit code says so).
3. **Orphan branch.** HEAD on an unborn branch in a repository that has commits elsewhere is `headState` "unknown", so
   pending is now `unverified` ("HEAD cannot be resolved…") where it was `no-release-tag`. Cautious, and the
   direct consequence of using `headState`; the owner may prefer `no-release-tag` there.
4. **ship-contract.md still names `git diff --name-only <marker-commit>`** as changelogTouched's definition; the code
   computes the same set index-safely (D4). Wording is the owner's call; outside the six approved edits.
5. **ship's usage-error no-run report is not documented** (ship-contract.md / SKILL.md); the `unverified` row does not
   list "usage error". The seven P4b scripts' usage behavior is not documented either (P4b §6 #5).
6. changelogTouched's evidence still says "no CHANGELOG.md in this repository" for a subdirectory `--cwd` (text kept so
   harness rows stay byte-identical).
7. The F-j `unverified` note reuses "reading the commits or changed files since it failed" for an unparsable count.
8. P4b leftovers untouched: map's TypeError with git missing; contract-check's `git diff --name-only <rev>` can rewrite
   a stale index (P7); test titles naming `isInvokedDirectly()` (must-not-change tests).
9. Node 22 not run; typos CI not run locally.

Proposed failure-memory candidate (not written; the arbiter decides): **a "hostile config" run must include the
output-shaping keys a test does not pin itself** — P4a's lib-git row passed under the earlier H but failed under a
global `tag.sort`, because the test relied on git's default order for an unpinned query. Prevention: in tests of a
git layer that deliberately leaves query flags to callers, pass the same query flags the callers pass. Tags: git,
tests, hermeticity, hostile-config.

## 8. Housekeeping

My `mktemp -d` work directory (scratch repo copy, red/green runner, lexer validator, byte scanner, hostile config and
hooks, per-run TEMPs, logs, the pre-change snapshot) was deleted by exact path. Probe repositories made during the work
were created inside it and deleted with it. Kept on purpose: `.ctide/output/p4-s0/p4c-exit-{normal,hostile}.json` and
the edited `record.mjs`. Nothing else under `.ctide/` was touched.

---

## P4 修復（P4-R1～R7）與結案

> 協調者在 commit 前獨立核對七個結案條件（2026-10-15）：全新 TEMP 全套 1122/1116/0/6、0 殘留；validate 0；plugin validate --strict@2.1.272 0；自己重錄 S0（`p4r-own`）對 `p4c-exit` 300 列 0 變動、對基準 exit 0；擴充敵意設定（31 個設定 + 失敗的 pre-commit／commit-msg／post-index-change hooks）下 contract-check、ship、map、lib-*、release-cli、doctor-project 共 387 個測試 0 失敗、0 殘留；AC-9 單一副本 grep 不變，`isInvokedDirectly` 只剩 lib-binding、eval、CHANGELOG 與交接文件；親自重現 S-M1：舊版（e4518f5）印 `scope: clean`，修復後印 `forbidden-path hits: secret.txt`；抽查 headState orphan mutant（`=== 0` → `!== null`）→ lib-git＋map 5 個測試紅，含兩個新的 orphan 測試。→ **P4 READY**。

# P4-R evidence — the P4 repair list P4-R1…P4-R7 (on top of e4518f5; nothing committed)

Environment: Windows 11, git 2.55.0.windows.5, Node v24.19.0. Every test run, harness run and mutant run below
had TEMP/TMP/TMPDIR pointed at its own `mktemp -d` directory under the session scratchpad. That scratch tree,
with every clone in it, was deleted afterwards by its exact path. No file under docs/handoff/** was touched.

## Files changed

| File | Item | Purpose |
|---|---|---|
| `cressetide/skills/vigil/scripts/contract-check.mjs` | R1 | `git diff --name-only <rev> --`. An explicit `--base` (`values.base !== undefined`, the empty string included) whose diff fails → `{ unverified: "git diff against the resolved --base failed" }`. Without `--base` it still fails open to `{ paths: [] }`. Comment rewritten |
| `cressetide/lib/git.mjs` | R1, R6 | `changedFiles`' `diff --cached … <commit> --` (and its doc line); the diff.ignoreSubmodules comment (O-1 A wording); the git() result docstring (`error` first; undefined/null stdout) |
| `cressetide/lib/redact.mjs` | R4 | one private-key regex with an unterminated-block alternative; comment step 1 mentions it |
| `cressetide/skills/ship/scripts/ship.mjs` | R5 | `--` after the revision at :144, :232, :233, :237; :478 → `rev-parse -q --verify HEAD^{commit}` |
| `cressetide/skills/map/scripts/map.mjs` | R6 | :212 comment now points at `lib/read-capped.mjs` |
| `cressetide/skills/ship/references/ship-contract.md` | R7 (O-3) | :85-86 the usage-error exception (lines 99 / 30 chars) |
| `ARCHITECTURE.md` | R7 (O-4) | `│   ├── lib/` tree line + the shipped-lib paragraph (wrapped to the file's ~76 columns) |
| `test/contract-check.test.mjs` | R1 | 5 tests (1)–(5) + an argv-spy/fault preload |
| `test/lib-git.test.mjs` | R1, R3 | test (6) SHA-named file; headState orphan row |
| `test/map.test.mjs` | R3, R6 | orphan → exit 1, no map; 2 F7 comment/title lines |
| `test/ship.test.mjs` | R2, R3, R5 | 6 new tests + 2 assertions added to existing tests (the lead-4 note; tagReady under the inherited GIT_INDEX_FILE) |
| `test/lib-redact.test.mjs` | R4 | a key and a token that straddle the limit; an unterminated PEM |
| `test/doctor-project.test.mjs`, `test/release-cli.test.mjs` | R6 (F7) | title/comment/message renames only |

Tests added: 16 (contract-check 5, lib-git 2, map 1, ship 6, lib-redact 2).

## 1. Red records (condition 1)

Method: `git clone --no-local D:/github/cressetide <scratch>/cN` (HEAD e4518f5), with the 14 working files above
overlaid, nine clones run in parallel. One mutant per run. Each mutant is a line-level edit (`runner.mjs`: the
`from` text must occur exactly once on the named line). The mutated file is restored byte-for-byte afterwards, and
every clone was checked identical to the working tree after the runs. Command for each row:
`node --test --test-reporter=tap <file>` (cwd = clone). Counts are tests/pass/fail; no run left files in its TEMP.

| Item | Mutant (line-level) | File run | Exit | t/p/f | Red test(s) |
|---|---|---|---|---|---|
| R1 | fixed tree | contract-check.test | 0 | 32/32/0 | — |
| R1 | M1a: contract-check:125 drop `"--"` (both modes) | contract-check.test | 1 | 32/29/3 | (1) "--base: a working-tree file named the resolved commit id does not hide a modified forbidden file"; (2) "no --base: a working-tree file named HEAD …"; (4) "--base: only the resolved commit id reaches git diff, immediately followed by "--" …" |
| R1 | M1b: :125 `"--"` only with an explicit base (default mode loses it) | contract-check.test | 1 | 32/31/1 | (2) "no --base: a working-tree file named HEAD does not hide a modified forbidden file" |
| R1 | M1c: :125 `"--"` only without a base | contract-check.test | 1 | 32/30/2 | (1), (4) |
| R1 | M1d: :127 → `return { paths: [] };` | contract-check.test | 1 | 32/31/1 | (3) "--base: a git diff against the resolved base that fails (ENOBUFS, a corrupt index) is unverified, never "scope: clean"; …" |
| R1 (R6b) | M1e: :123 `revision = base;` (raw base reaches git) | contract-check.test | 1 | 32/31/1 | (4) |
| R1 (F6) | M1f1: :115 `explicitBase = Boolean(base)` (19db2bc's `if (base)`) | contract-check.test | 1 | 32/31/1 | (5) "an empty --base (`--base=`, `--base ""` …) is unverified, never a silent fall-back to HEAD" |
| R1 (F6) | M1f2: :165 `changedPathsFromGit(values.base \|\| "")` | contract-check.test | 1 | 32/27/5 | (2), (3) and 3 existing no-`--base` tests (":228 valid --base … no --base diffs against HEAD", ":267 inherited GIT_DIR", ":279 non-ASCII"). (5) stays green, see deviation 5 |
| R1 | fixed tree | lib-git.test | 0 | 36/36/0 | — |
| R1 (C-6) | M1g: lib/git:164 drop `"--"` | lib-git.test | 1 | 36/35/1 | (6) "changedFiles(): a working-tree file named the base commit id does not fail the read" |
| R2 | fixed tree | ship.test | 0 | 113/113/0 | — |
| R2 (T-1, R1) | M2a: ship:347 `diff --cached` → `diff` (working tree vs commit `-- CHANGELOG.md`) | ship.test | 1 | 113/112/1 | "changelogTouched: CHANGELOG.md unchanged since the tag, with stale stat data, is `fail`, and a full run leaves .git/index's bytes and mtime unchanged" |
| R2 (T-3, R1c) | M2b: ship:348 status read without `-- CHANGELOG.md` | ship.test | 1 | 113/112/1 | "changelogTouched: an unrelated dirty tracked file, with CHANGELOG.md unchanged since the tag, is `fail`" |
| R2 | M2c: ship:347 staged read without `-- CHANGELOG.md` | ship.test | 1 | 113/109/4 | "changelogTouched: an unrelated staged change, or a commit after the tag that leaves CHANGELOG.md alone, is `fail`" + the stale test + 2 existing |
| R2 | M2d: ship:353 drop the staged read (`const touched = false && …`) | ship.test | 1 | 113/110/3 | existing only: "CHANGELOG.md changed since the marker -> pass", the subdirectory `--cwd` test (committed/staged rows), ":1532 never writes .git/index". The staged-then-reverted test stays green (deviation 4) |
| R2 (dev. 4) | M2e: e0e3dcb semantics, 2 lines (ship:347 working tree vs commit; ship:354 status term `false &&`) | ship.test | 1 | 113/111/2 | "changelogTouched: a CHANGELOG.md change staged and then reverted in the working tree counts as changed — `pass`" + the stale test |
| R2 (lead 4, R5b) | M2f: ship:218 `if (false) {` (headState branch removed) | ship.test | 1 | 113/112/1 | "pending view: a broken or dangling HEAD in a repository that has commits is unverified, never no-release-tag" (the new note assertion) |
| R2 (L2) | M2g: lib/git:37 `GIT_INDEX_FILE` not stripped | ship.test | 1 | 113/112/1 | "CLI: an inherited absolute GIT_DIR and GIT_INDEX_FILE naming another repository do not change the repository --cwd reads" (tagReady) |
| R3 (L8) | M3a: lib/git:110 `=== 0` → `!== null` | lib-git / map / ship | 1 / 1 / 1 | 36/35/1 · 57/56/1 · 113/112/1 | "headState(): an orphan branch in a repository that has commits is unknown, not unborn" · "Map lib/git headState binding: an orphan branch … never "Verified at commit: UNBORN"" · "pending view: an orphan branch in a repository that has commits is unverified, never no-release-tag" |
| R3 | M3b: lib/git:110 `=== 0` → `>= 0` | lib-git / map / ship | 1 / 1 / 1 | 36/35/1 · 57/56/1 · 113/112/1 | the same three |
| R3 | fixed tree | map.test | 0 | 57/57/0 | — |
| R4 | fixed tree | lib-redact.test | 0 | 26/26/0 | — |
| R4 (L7) | M4a: redact:24 `.slice(0, limit)` before the chain | lib-redact.test | 1 | 26/25/1 | "redactDiagnostic(): a private key or a token straddling the 2000-character limit leaves no fragment". Failing assertion: the token half (`'yyyyyyyyyy ghp_A1b2C'` leaked), see deviation 6 |
| R4 | M4b: redact:25 = HEAD's line 25 (no second alternative) | lib-redact.test | 1 | 26/25/1 | "redactDiagnostic(): a private key with no END line is redacted through to the end" |
| R5 :144 | M5a: drop `"--"` after the tag in `log -1` | ship.test | 1 | 113/112/1 | "working-tree files named HEAD, v1.0.0 and v1.0.0..HEAD change nothing ship reports: …" |
| R5 :232 | M5b: drop `"--"` in `rev-list --count` | ship.test | 1 | 113/112/1 | same test |
| R5 :233 | M5c: drop `"--"` in `log --max-count … <range>` | ship.test | 1 | 113/112/1 | same test. Failing assertion: the recorded argv (`… '--format=%h%x09%s', 'v1.0.0..HEAD'` without `'--'`), see deviation 2 |
| R5 :237 | M5d: drop `"--"` in `diff --name-only … <range>` | ship.test | 1 | 113/112/1 | same test |
| R5 :478 | M5e: back to `["rev-parse", "HEAD"]` | ship.test | 1 | 113/112/1 | same test. Failing assertion: the unborn repository with a file named HEAD gives `stale: true`, "SYSTEM_MAP.md is stale (recorded commit UNBORN, current HEAD)", instead of `stale: null`, see deviation 3 |

The sequential first attempt was stopped during its fixed-tree ship run, before any mutation was applied. Its
contract-check and lib-git rows were identical to the table above. The remaining mutants were re-run in the
nine parallel clones.

## 2. Full suite, validate, plugin validate (condition 2)

- `npm test`, fresh TEMP: **exit 0, 1122 tests / 1116 pass / 0 fail / 6 skipped** (1106 + 16 added; the 6
  skips are the existing Windows ones), 114 s. TEMP afterwards holds only `node-compile-cache`, **0 `ctide-*`**.
- `npm run validate`: **exit 0**, "Plugin structure validation passed."
- `npx --yes @anthropic-ai/claude-code@2.1.272 plugin validate --strict ./cressetide`: **exit 0**,
  "✔ Validation passed".

## 3. S0 harness (condition 3; run from `.ctide/output/p4-s0`)

- `node record.mjs record --out p4r-exit --env both`: exit 0, normal 150 rows, hostile 150 rows
  (new files `p4r-exit-normal.json` / `p4r-exit-hostile.json`).
- `node record.mjs compare p4r-exit --baseline p4c-exit`: **exit 0, "300 rows compared, 0 changed"**, so 0
  changed rows in normal and 0 in hostile.
- `node record.mjs compare p4r-exit` (e0e3dcb baseline): **exit 0**, "300 rows compared, 129 changed, 0 outside
  the allowed P4-exit classes" (normal 60, hostile 69). This is the same 129 the reviewers recorded at 19db2bc.
- The harness was not edited.

## 4. Extended hostile run (condition 4)

`GIT_CONFIG_GLOBAL` held 31 keys: the 20 documented ones and the 11 extras. The 20:

- `merge.verifySignatures`, `commit.gpgSign`, `tag.gpgSign`, `tag.forceSignAnnotated` = true
- `gpg.program` = a missing exe
- `core.hooksPath` = a directory whose hooks all print and `exit 1`: pre-commit, commit-msg, prepare-commit-msg,
  post-commit, pre-merge-commit, post-checkout, post-merge, post-rewrite, reference-transaction, pre-push,
  post-index-change
- `core.safecrlf=true`, `init.defaultBranch=trunk`, `core.abbrev=12`, `column.ui=always`, `tag.sort=-refname`
- `log.showSignature=true`, `i18n.logOutputEncoding=ISO-8859-1`, `diff.relative=true`, `core.quotePath=true`
- `status.showUntrackedFiles=no`, `diff.ignoreSubmodules=all`, `color.ui=always`, `log.decorate=full`,
  `format.pretty=fuller`

The 11 extras: `diff.renames=copies`, `diff.noprefix=true`, `diff.mnemonicPrefix=true`, `status.short=true`,
`status.branch=true`, `status.relativePaths=false`, `column.status=always`, `core.untrackedCache=true`,
`feature.manyFiles=true`, `log.abbrevCommit=true`, `log.showRoot=true`.

A sanity probe under this set in a throwaway repository behaved as expected:

- `git init` failed on the reference-transaction hook; with the hooks bypassed the branch was `trunk`.
- `core.abbrev` read back 12.
- `git add` of an LF file stopped with "LF would be replaced by CRLF".
- A commit hit the missing gpg first and then the pre-commit hook.

Files: ship, map, contract-check, release-cli, release-doctor, validate-structure, helpers, doctor-project,
doctor-security, failure-retrieve, failure-consolidate, pack-review-diff, regression-delta, and lib-binding,
lib-cli, lib-git, lib-map-trust, lib-read-capped, lib-redact (19 files).

**Result: exit 0, 630 tests / 628 pass / 0 fail / 2 skipped.** Both skips are existing Windows skips in
doctor-project ("POSIX permission bits do not apply on win32"; "cannot create a file symlink here: EPERM").
TEMP was empty afterwards.

## 5. AC-9 single-copy greps (condition 5, working tree)

For each pattern, the file set matches `git grep … HEAD` (diffed: same).

- `realpathSync(process.argv[1])`: only `cressetide/lib/cli.mjs` in product code. Also in `eval/` (P10) and
  CHANGELOG prose.
- `(spawnSync|execFileSync)\("git"`: only `cressetide/lib/git.mjs` under cressetide/ and .github/. Outside
  them: test/helpers(.test) and docs/handoff prose.
- The private-key literal `-----BEGIN [^-\r\n]*PRIVATE KEY-----`: only `cressetide/lib/redact.mjs`, once.
  docs/handoff/p4-evidence.md quotes it in prose.
- `CTIDE:TRUST:(verified`: only `cressetide/lib/map-trust.mjs` (and docs/handoff prose).
- `KNOWN_FLAGS` in cressetide/ and .github/: 0.

## 6. S-M1 reproduction (condition 6)

The fixture: a repository with three commits (`secret.txt` committed in the first) and contract
`{"allowedPaths":["*.txt"],"forbiddenPaths":["secret.txt"]}`. `secret.txt` was then modified, followed by
`touch $(git rev-parse HEAD~2)` and `contract-check.mjs --base HEAD~2`:

- e4518f5 (from `git archive HEAD`): `scope: clean (all changed files within allowedPaths)`, exit 0.
- Working tree: `forbidden-path hits: secret.txt`, then `scope: clean (all changed files within allowedPaths)`,
  exit 0.
- Control: `git diff --name-only <that sha>` → "fatal: ambiguous argument '<sha>': both revision and filename".

## 7. `git diff --stat` (condition 7)

The 14 files listed under "Files changed", plus `docs/handoff/README.md` and `docs/handoff/progress.md`. Those
two are the orchestrator's own uncommitted edits; P4-R did not touch them.

## Notes

- Redaction timing on 1 MiB inputs (NOTE, not an assertion; one run of each, measured while the sequential
  mutation runner was also running, so compare only within a row):

  | Input | e4518f5 | P4-R |
  |---|---|---|
  | `-----BEGIN PRIVATE KEY-----\n` repeated, no END | 6431.6 ms | 0.8 ms |
  | one BEGIN + 1 MiB body, no END | 6.7 ms (the 2000-char output was the BEGIN line and key body, not redacted) | 0.4 ms (`[redacted private key]`) |
  | plain `x` × 1 MiB | 0.7 ms | 0.7 ms |

- Every touched file was byte-scanned. All are UTF-8 that round-trips, LF only, with no control characters and
  no U+FFFD/U+FEFF. The 318 added lines have no tabs. Their only non-ASCII characters are U+2014 and the
  ARCHITECTURE tree glyphs U+2502 / U+251C / U+2500.

## Deviations

1. **R6 git.mjs :50-53**: the arbiter's sentence is used verbatim. It is followed by the existing parenthetical
   "(any other encoding value means "utf8")", which is still true and documents C-5. It can be dropped if the
   exact text is wanted.
2. **R5 :233 (`git log … <range>`) cannot be killed by working-tree files.** git checks `log`'s `A..B` range
   against the work tree only for ambiguity. `revision.c` hands `revarg_opt` (REVARG_COMMITTISH for log) to
   `handle_dotdot` as `cant_be_filename`, so the check is skipped. Verified on 2.55: with a file named
   `v1.0.0..HEAD`, `git log v1.0.0..HEAD` exits 0 while `rev-list --count`/`diff` exit 128. The R5 test
   therefore also records git's argv in-process (patching `child_process.spawnSync`, which lib/git calls at call
   time). It pins that the pending `git log` ends with `<range>, "--"`. This is the one argv pin in that test;
   the other four sites are killed by behaviour.
3. **R5 :478 is not about files named like a revision when HEAD resolves.** `rev-parse HEAD` never reports an
   ambiguity. The motivating case is a file named `HEAD` when HEAD has no commit: plain `rev-parse HEAD` then
   prints `HEAD` and exits 0, giving a false definite "stale". The R5 test includes an unborn repository with a
   working-tree file named `HEAD` for this site.
4. **R2 "staged-then-reverted → pass" does not kill "drop the staged read" (M2d).** The index-vs-worktree read
   still flags the file, because Y=M (index ≠ working tree). M2d is killed by three existing tests (committed
   and staged CHANGELOG cases). The staged-then-reverted test kills the e0e3dcb semantics instead: one
   working-tree-vs-commit read and nothing else (M2e, a two-line mutant). That is what disclosed deviation (4)
   departs from.
5. **R1 test (5) and `|| ""`.** With `base !== undefined` as the explicit test, the `|| ""` revert in main (M1f2)
   still makes `--base ""` unverified. Test (5) therefore stays green, while every run without `--base` turns
   unverified: test (2), test (3) and 3 existing tests go red. The 19db2bc truthiness check `if (base)` (M1f1)
   is what test (5) kills.
6. **R4 straddling PEM vs L7.** With the new regex, slicing first leaves an unterminated BEGIN, which the
   second alternative redacts. The straddling-PEM half therefore passes under L7, and the token half
   (`ghp_A1b2C` leaked) is what makes the test red, as the arbiter's "(kills L7)" on the token case says.
7. **R2(a) sanity command.** It uses the arbiter's form `git diff --name-only <commit> -- CHANGELOG.md`, with
   `GIT_OPTIONAL_LOCKS=0`, verified to rewrite the index here. e0e3dcb's own changelogTouched ran
   `git diff --name-only <commit>` with no pathspec.
8. **F7 `-U0` check.** doctor-project.test and release-cli.test show only title/comment/message lines. map.test
   shows its 2 renamed lines plus the R3 orphan test, an added test (R3's map pin lives with the other map
   headState tests).
9. **contract-check test (3) also pins the must-not-change.** Without `--base`, the corrupt-index run still
   prints `scope: clean (all changed files within allowedPaths)` (fail-open). P7 (AC-10) will need to update
   that assertion.
10. Also changed in the named files: the `changedFiles` doc line (`<base> --`) and redact.mjs step 1 of its
    order comment.

## Found but not changed

- `ship-contract.md:56` still quotes `git diff --name-only --no-renames -z <tag>..HEAD` without the trailing
  `--`. R7 said to change nothing else there.
- `ship.mjs:231` `rev-parse --short <tag>^{commit}` has no `--`. rev-parse never checks a revision against the
  work tree, and `git rev-parse <rev> --` echoes `--` on stdout, so adding it would corrupt `tagCommit`.
- `git grep -n isInvokedDirectly` still hits docs/handoff/** (README, contract, p4-evidence, plan, progress), in
  addition to test/lib-binding.test.mjs (guard literal), eval/ and CHANGELOG.md. docs/handoff is off-limits
  here.
- C-5 (`encoding: null` treated as utf8) is unchanged. The lib comment still states the behaviour.

## Failure memory

No `.ctide/memory/FAILURE_MEMORY.md`, `ai/FAILURE_MEMORY.md` or `~/.claude/FAILURE_MEMORY.md` exists here.
Proposed entry, for the arbiter:

```
### 2026-10-15 — a revision passed to git without "--" becomes ambiguous when a file has its name
- **Root cause**: `git diff <rev>`, `git log -1 <rev>`, `git rev-list <A..B>` die "ambiguous argument … both
  revision and filename" when a working-tree file is named like the revision (HEAD, a tag, a commit id); a
  caller that maps a non-zero exit to "no paths" turns that into a false "scope: clean".
- **Prevention rule**: every git read that takes a revision ends its revisions with "--"; `rev-parse` takes
  `-q --verify <rev>^{commit}` instead (it never reports ambiguity, and a plain `rev-parse HEAD` with no commit
  prints the file name "HEAD" and exits 0); `git log <A..B>` skips the check entirely, so pin its "--" on the
  argument list.
- **Tags**: node / git / argv / fail-open.
```
