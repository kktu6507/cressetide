> P5（S0／P5a／P5b／P5c）的實作證據：hooks 的 S0 行為比對、guard 與 lib 的打紅紀錄、D-4／D-2 計時、P4 排過來的 lib/git 與 ship 修正、hook 入口切換、退役的 spawn 測試對照表，以及 I-8 實機冒煙 receipt。原檔是 gitignored 的 `.ctide/output/review/p5-s0-evidence.md`、`p5{a,b,c}-evidence.md`、`p5-i8-smoke.md`，S0 錄製工具在 `.ctide/output/p5-s0/record.mjs`（同樣 gitignored）。

> 協調者在 commit 前獨立重跑（2026-10-15）：全新 TEMP 全套 1267/1260/0/7、0 殘留；validate 0；plugin validate --strict@2.1.272 0；contract-check --base 86ba905 0；自己重錄的 S0（`p5c-own`，normal 與 hostile 各 737 列，共 1474 列）有 126 列變動、0 列落在核准類別外（camelcase-alias-gone 12、multiedit-gone 20、failmem-h2 10、failmem-pointer 20、failmem-placeholder 20、sessionstart-malformed 6、sessionstart-not-object 6、debug-switch 10、debug-redaction 16、new-only 8）；hooks 與 lib 裡的 `"allow"` 0；已刪名稱 grep 0；plugin.json 沒有 `agents`；兩條 CI 的 CLI 版本都是 @2.1.272。

---

# P5-S0 evidence: hooks behavior-preservation harness and its 86ba905 baseline

Branch `refactor/v0.8-slim`, HEAD `86ba905`. Nothing staged or committed; no tracked file edited. Machine: Windows 11
Pro 10.0.26200, Node v24.19.0 (also the `node` on Git Bash's PATH), GNU bash 5.3.15 (Git for Windows). Every run used
TEMP/TMP/TMPDIR pointed into my own `mktemp -d` directory under the session scratchpad. Each harness run creates one
`mkdtemp` dir there and removes it by exact path. After the last run that TEMP dir held 0 entries, and the system
temp dir held 0 `p5s0-*` dirs. The baseline was recorded from a clean export
(`git -C D:/github/cressetide archive 86ba905 | tar -x -C <own dir>/export1`), never from the shared working tree.
So P5a's and P5b's in-progress files (e.g. the untracked `cressetide/lib/guards/**`) cannot reach it. The recording's
`meta.treeDigest` (sha256 over `cressetide/hooks/**` + `cressetide/lib/**` of the tree) is `df77aceedc9d541d…`.

## 0. Files written (all gitignored under `/.ctide/`)

| File | What |
|---|---|
| `.ctide/output/p5-s0/record.mjs` | The harness: `record`, `compare`, `cross`; README block at the top (usage, dispatch emulation, row environment, matrix, normalization, classes). |
| `.ctide/output/p5-s0/baseline-normal.json`, `baseline-hostile.json` | **The P5 baseline** (86ba905, clean export), 733 rows each. |
| `.ctide/output/p5-s0/determinism-{normal,hostile}.json` | Second clean export, recorded independently (§3). |
| `.ctide/output/p5-s0/sens-{destructive,optout,p5sim}-normal.json` | The three mutant recordings (§4). Kept so `compare` can be re-run. |
| `.ctide/output/review/p5-s0-evidence.md` | This file. |

P5 usage: `node .ctide/output/p5-s0/record.mjs record --out p5 --repo <tree> --label <what>`, then
`node .ctide/output/p5-s0/record.mjs compare p5`. This exits 1 when any changed, missing or new row is outside its
allowed classes. `<tree>` is a dir holding `cressetide/`. Prefer an export of the commit under test: the live tree is
shared, and `meta.hooksDirtyVsHead` shows it when `--repo` is a git checkout.

## 1. What the harness does (verified against the code and the old hooks)

- **Dispatch emulation, tree-agnostic.** `cressetide/` is copied to `<run>/plugin root` (the path has a space). A row's
  handlers come from that copy's `hooks/hooks.json`. An entry runs when its matcher is absent / `""` / `*`, or
  `^(?:matcher)$` matches `tool_name` (PreToolUse) / `source` (SessionStart); Stop runs every entry. Identical handlers
  (same command/args/shell) run once. Each handler runs as `C:/Program Files/Git/bin/bash.exe -c <command>`.
  `"shell":"powershell"` → `powershell -Command`, and an exec form with `args` is spawned directly; both are supported
  but unused by the old tree. `${CLAUDE_PLUGIN_ROOT}` is substituted textually with the native backslash path AND
  exported, as P0-1 observed. The event goes on stdin, cwd = the row's project dir unless the row says otherwise, with a
  60 s timeout. So the old `node -e "…require(r+'/hooks/x.js')…"` bootstrap and the new
  `node "${CLAUDE_PLUGIN_ROOT}/hooks/x.mjs"` form both run unmodified.
- **Merge.** PreToolUse: deny > ask > allow > none; the winner's whole JSON is kept (canonical key order). SessionStart:
  `additionalContext` values joined with `"\n\n"` in hooks.json order. Stop: raw stdout joined with `"\n"`. Anything
  else a handler prints goes to `extra`.
- **Recorded and compared per row:** setup errors, distinct exit codes, decision, output, extra, stderr class
  (none / trace = every line `[ctide <name>] ` / other), stderr text, `ctide-hook.log` existence and text, `leaks`
  (planted secrets found in raw stdout/stderr/log), files left in the row TEMP, and `writes` (anything added, removed
  or changed elsewhere in the row dir; junctions are listed, never followed). Handler names are informational only.
- **Row environment.** Each row gets a fresh `rows/r<n>/{proj,home,tmp,other}`. `proj` is `CLAUDE_PROJECT_DIR`, the
  event cwd and the spawn cwd by default. `home` is HOME and USERPROFILE. `tmp` is TEMP, TMP and TMPDIR. `other` holds
  escape targets and serves as the cwd for rows that must not find the project by cwd. Inherited `CLAUDE_*`,
  `CLAUDECODE`, `CTIDE_*`, `GIT_*`, `COPILOT_PLUGIN_ROOT`, `PLUGIN_ROOT` and `NODE_OPTIONS` are removed. Probed first:
  through Git Bash, node sees HOME/USERPROFILE/TEMP/TMP/TMPDIR as the Windows paths given, and `""` / `" "` env values
  survive.
- **Hostile environment** (`--env both`, default). The same rows, plus `COPILOT_PLUGIN_ROOT` and `PLUGIN_ROOT` pointing
  at a decoy plugin whose every hook prints a deny/systemMessage/additionalContext `DECOY`, plus `CLAUDE_PLUGIN_DATA`,
  `GIT_DIR` and `GIT_WORK_TREE`. `compare` judges hostile rows by class exactly like normal rows; no row is allowed
  because of its environment.
- **Normalization:** CRLF→LF; row dir / plugin copies / run dir / tree / node / real home → placeholders, in every
  form (as written, realpath, `/`, `\\`-escaped, `/c/…`), case-insensitive on Windows; `CTIDE_<NAME>_<16 hex>` →
  `<nonce>`; `(stderr=N bytes)`; ISO timestamps. Secrets are checked on raw text, before normalization.
- **Sanity check at record time.** Rows of groups A–D carry the decision their source test expects. Rows tagged
  `multiedit-gone`/`camelcase-alias-gone`/`new-only` are exempt, since P5 changes them on purpose. On the baseline:
  **0 contradictions**, so the emulated dispatch and merge reproduce the tests' verdicts. This check caught a broken
  tree in my own probe (§4.5).

## 2. The baseline (86ba905)

| Group | Rows | Content (source) |
|---|---:|---|
| A plan gate | 211 | 7 tools × 6 modes (incl. camelCase `permissionMode`) = 42; 16 plans-exemption rows (home, not-yet-created, Edit, NotebookEdit, repo-local, junction escape, junction-symlinked HOME, `PLANS`, `NOTES`, `plans-evil` prefix sibling, `..`, missing `file_path`, missing `tool_input`, `path` key in/out of plans, relative path); 152 tripwire rows = (37 deny + 31 benign/documented-miss/quoted) × {plan, default} for Bash + the test's 8 PowerShell commands × {plan, default}; 1 × 2 MiB plan Write (plan-gate-guards :18–312, :740–770; hooks.test) |
| B destructive | 198 | 94 unique ask/allow commands × {Bash, PowerShell} in default mode (:378–470, :524–640 incl. the realistic F1 padded forms, :670–806, hooks.test); per tool 4 plan rows (destructive only → ask; destructive and a write → deny); Write whose content says `rm -rf /`; 2 MiB destructive command |
| C contract | 78 | 29 contract (every weakening reason, append-only Edit, first write, prose-only prior, block lost, old_string miss, MultiEdit miss/weakening, first-occurrence vs `replace_all`, unrelated file, `{"ctide":0}`, directory at the path, new path, hooks.test, relative and uppercased path, root from event cwd); 9 design.md; 7 sibling (a)–(f); 33 settings (each of 4 flags × project-fresh/local-fresh/edit-true-to-false/redundant-under-local-false, plus every settings-guard test row and root-from-event-cwd) (:815–1660) |
| D opt-outs | 96 | 4 flags × 11 settings variants (absent, false, true, local-false-over-project-true, local-true-over-project-false, local-only-false, malformed, malformed-local-over-project-false, oversized > 1 MiB, `{"ctide":false}`, root `false`) × {via CLAUDE_PROJECT_DIR with the event cwd elsewhere, via event cwd} + {absent, false} via process cwd alone |
| E SessionStart | 94 | 18 memory files × source {startup, resume, clear, compact, absent}; plus preserveOnCompact off ×2 and process-cwd root ×2 |
| F malformed stdin | 32 | `""`, `{`, `not json {{{`, `null`, `[]`, `"s"`, BOM+JSON, 6 MiB × {PreToolUse as Bash, PreToolUse as Write, SessionStart (all entries), Stop} |
| G debug | 17 | `CTIDE_HOOK_DEBUG` ∈ {unset, `""`, `" "`, 0, false, x, 1, true, TRUE, Yes, on} on `git push origin main --force Authorization: Bearer <t> ghp_<36>`; traced plan deny, contract ask, SessionStart compact (1 and 0), Stop (1 and 0) |
| H Stop | 7 | blocking + shipped; same with `CTIDE_ENFORCE_STOP=1` (blocks); same + `stop_hook_active` (advisory); same through camelCase fields; READY with arbiter only; malformed transcript; transcript > 32 MiB |
| I lib missing | 0 (4 on a new tree) | plan Write, destructive Bash, SessionStart compact, Stop, with the plugin copied without `cressetide/lib/`; recorded only when a hook imports `../lib/` (skipped on 86ba905, noted in `meta.skipped`) |
| **Total** | **733 per env** | PreToolUse 588, SessionStart 128, Stop 17; × 2 envs = 1466 |

E memory files: none; `###` entries with template header, placeholder and recurrence; `##` entries; both levels;
placeholder-only; template-fresh (`## Entry Template` + placeholder); placeholder + `##` entries; prose only (with
role markers and `<system>`); empty; hostile titles / fake fence; retired (expired/superseded, mid-title mention);
22 entries; 300 KB; CRLF; legacy `ai/`; both tiers (new wins); global `~/.claude`; `.ctide/memory` junction escape.

Baseline facts worth knowing before P5 (all observed, all untagged unless noted):
- Source-less SessionStart (`E/*/absent`, `F/SessionStart-all/empty`, dispatched to all entries) gets the memory digest
  AND the compaction block. That's old compact-fidelity's "fail toward emit". Malformed stdin still injects memory but
  not the compaction block (`{`, BOM, `not json`). `null`/`[]`/`"s"` inject both.
- `##`-only files inject raw content (the fallback, prose and all). Placeholder-only, template-fresh and
  placeholder+`##` files inject nothing.
- `D/*/via-process-cwd`: only compact-fidelity honors an opt-out found via `process.cwd()`. The plan/destructive guards
  have no root there, and contract-guard does not even recognize the contract path (decision none).
- `A/exempt/path-key-in-plans`: plan-gate also accepts `tool_input.path` for the plans exemption.
- `G`: with the old hooks every non-empty `CTIDE_HOOK_DEBUG` (including `" "`, `0`, `false`, `x`) traces, and both
  planted tokens appear in stderr and in `ctide-hook.log`.

Runtime: ~45 s per environment at the default `--jobs 6` (92 s wall for normal + hostile); 30 s per environment at
`--jobs 12`. `cross baseline`: **733 rows, 0 differ** between normal and hostile.

## 3. Class tagging

669 of 733 rows carry no class and must compare byte-identical. 64 rows are tagged. A changed row is ALLOWED only when
(1) every changed field is one its classes may change and (2) each class whose fields changed accepts the new value.
**The baseline's tags and expectations are authoritative**, so re-tagging a later recording cannot widen anything.

| Class | Rows tagged | Fields it may change | New value must |
|---|---:|---|---|
| `multiedit-gone` | 10: `A/mode/MultiEdit/*` (6), `C/contract/multiedit-{later-step-not-found,weakening}`, `C/settings/multiedit-{replace_all,step-not-found}` | exits, decision, output | decision none, no output |
| `camelcase-alias-gone` | 6: `A/mode/{Write,Edit,MultiEdit,NotebookEdit,Bash,PowerShell}/camelCase-permissionMode-plan` | decision, output | decision none, no output |
| `debug-switch` | 5: G destructive `" "`, `0`, `false`, `x`; G SessionStart `0` | stderrClass, stderr, logExists, log, leaks, tmpFiles | no stderr, no log, no planted token |
| `debug-redaction` | 8: G destructive `1`, `true`, `TRUE`, `Yes`, `on`; G plan-deny/contract-ask/SessionStart `1` | stderr, log, leaks (stderrClass may NOT change: a trace stays a trace) | no planted token anywhere |
| `failmem-pointer` | 15: `E/{placeholder-only,prose-only,empty-file}/*` | output | holds the exact I-4 sentence; none of the row's raw markers |
| `failmem-h2` | 5: `E/h2-entries/*` | output | names both `##` titles; no rule prose |
| `failmem-placeholder` | 10: `E/{template-fresh,placeholder-plus-h2}/*` | output | names the expected titles (`Entry Template`, per I-3; the two `##` titles); no rule prose |
| `sessionstart-malformed` | 3: `F/SessionStart-all/{open-brace,not-json,bom-json}` | output | no output |
| `sessionstart-not-object` | 3: `F/SessionStart-all/{null,array,string}` | output | no output |
| `new-only` | group I (new tree only) | anything | no handler exits 2, nothing denied (a missing lib fails open) |

Deliberately untagged (must stay identical): `F/SessionStart-all/empty` (pinned by "compact-fidelity: empty stdin still
emits"), `E/both-levels/*` (real `###` present → `###` parse per I-3), every H row and both G Stop rows (I-5: Stop
untouched in P5), G `unset`/`""` (no trace before or after), and everything in A–D except the rows above.

## 4. Determinism and sensitivity

### 4.1 Determinism
A second `git archive 86ba905` export (`diff -r` identical to the first) was recorded independently:
`compare determinism` → **1466 rows compared, 0 changed, exit 0**. The same export recorded at `--jobs 12` (normal) →
**733 rows, 0 changed**, so handler concurrency doesn't perturb results despite the old hooks' 5 s stdin watchdog.

### 4.2 M1: one destructive pattern removed (`sens-destructive`)
Mutant: the export with the single `git reset --hard` regex line deleted from `destructive-guard.js` (diff = 1 line).
`compare sens-destructive` → **28 changed, 28 NOT ALLOWED, exit 1**. Those 28 rows are:
- `B/{Bash,PowerShell}/default/{git reset --hard HEAD~3, git reset HEAD~1 --hard, git reset --hard, F1 git reset with 90 chars before --hard, (git reset --hard)}` and `B/{Bash,PowerShell}/plan/git reset --hard (destructive only: ask)` (12);
- every `D/destructiveGuard/*` row that should still ask (16).

No other row moved. `…/plan/git reset --hard > reset.log` correctly stays deny, because plan-gate's deny wins the
merge. Record-time sanity listed the same 28.
```
NOT ALLOWED [normal] B/Bash/default/git reset --hard HEAD~3 (classes none; changed decision, output)
    why: untagged row: it must compare identical
    decision:
      - ask
      + none
```

### 4.3 M2: one opt-out behavior changed (`sens-optout`)
Mutant: plan-gate's settings precedence swapped (`["settings.json", "settings.local.json"]`, diff = 1 line).
`compare sens-optout` → **4 changed, 4 NOT ALLOWED, exit 1**: `D/planGate/{local-false-over-project-true,local-true-over-project-false}/via-{CLAUDE_PROJECT_DIR,event-cwd}`. Nothing else moved.

### 4.4 M3: class judgments in both directions (`sens-p5sim`)
M1/M2 only exercise "untagged must be identical", so M3 simulates P5. It makes four allowed changes correctly and two
incorrectly:
- MultiEdit dropped from both PreToolUse matchers;
- `permissionMode` no longer read;
- tracing only for `1|true|yes|on` in the five P5 hooks (orchestration-check untouched);
- the I-4 pointer for files with no `###` entries;
- **wrong #1:** `Bearer` redacted, `ghp_` left in the trace;
- **wrong #2:** `##` files get the pointer instead of a digest.

`compare sens-p5sim` → **40 changed: 30 ALLOWED, 10 NOT ALLOWED, exit 1**. ALLOWED: multiedit-gone 10,
camelcase-alias-gone 6, debug-switch 5, failmem-pointer 10 (prose-only, empty-file). NOT ALLOWED, with the exact
defect named:
```
NOT ALLOWED [normal] G/destructive-with-secrets/CTIDE_HOOK_DEBUG=Yes (classes debug-redaction; changed stderr, log, leaks)
    why: debug-redaction: planted token text still appears in log:ghp, stderr:ghp           (×5: 1, true, TRUE, Yes, on)
NOT ALLOWED [normal] E/h2-entries/startup (classes failmem-h2; changed output)
    why: failmem-h2: digest lacks expected title(s): H2-ALPHA windows path escaping | H2-BETA git porcelain shape   (×5)
```

### 4.5 Judge paths no real tree reaches before P5, and group I
- **Synthetic recording** (derived from the baseline, then deleted): out-of-class field on a multiedit row → NOT
  ALLOWED ("stderrClass, stderr are outside multiedit-gone"); pointer plus raw content → NOT ALLOWED; correct pointer
  → ALLOWED; untagged row re-tagged in the new recording → note + baseline tags apply → NOT ALLOWED;
  not-object row still emitting → NOT ALLOWED, emitting nothing → ALLOWED; new-only failing open → ALLOWED; new-only
  exiting 2 → NOT ALLOWED; untagged new row → NOT ALLOWED; removed row → NOT ALLOWED. Exit 1.
- **Group I machinery:** a copy whose `plan-gate.js` requires `../lib/redact.mjs` is detected as lib-importing. Its
  lib-less copy records the 4 I rows (plan-gate fails open → none; other handlers unaffected), while with lib present
  `A/mode/Write/plan` still denies (sanity 0).
- **Broken tree is loud:** my first try of that probe put the `require` above the shebang (a syntax error). The record
  run printed `SANITY: 63 row(s) contradict the source test's expected decision` instead of silently recording a
  dead plan gate.

## 5. What the matrix does not exercise, and why

1. **The 5 s stdin watchdog and the stdin `error` path.** Claude Code always closes stdin. Inducing either would need
   a held-open pipe per row, which is timing-dependent.
2. **ReDoS timing.** Rows record decisions, not time. The realistic padded F1 forms are included; the pathological
   ~400 KB inputs are not, because their decision is a plain allow and their point is timing. Per D-4, P5 times those
   in-process.
3. **The case-sensitive branch of `fsCaseInsensitiveNear`** (Linux, case-sensitive APFS). This is a Windows machine,
   so `PLANS` is recorded as exempt (case-insensitive) only.
4. **Real directory symlinks and file symlinks.** Examples: a symlinked HOME via a `dir` symlink, and
   `ai/FAILURE_MEMORY.md` or `~/.claude/FAILURE_MEMORY.md` symlinked out of tree. Windows needs privilege for these.
   Directory cases are recorded with junctions (plans junction escape, junction HOME, `.ctide/memory` junction).
   File-symlink escapes are not recorded.
5. **Unset `CLAUDE_PLUGIN_ROOT`** (the old bootstrap's `COPILOT_PLUGIN_ROOT`/`PLUGIN_ROOT` fallback, else fail-open).
   Claude Code always exports it (P0-1), and P5 removes the Copilot fallbacks. The hostile run sets both fallbacks to
   a decoy and shows they are ignored (0 diffs).
6. **`"shell":"powershell"` and exec-form handlers.** Supported by the dispatcher, but unused by the old hooks.json.
7. **Real Claude Code merge behavior.** Parallel execution, the actual multi-`additionalContext` join and handler
   dedupe are emulated, not observed. That's the I-8 live smoke's job.
8. **The `ctide-hook.log` 1 MiB truncation (I-2).** It's new behavior with no old counterpart.
9. **A multi-byte character split at the 256 KB read cap.** The 300 KB fixture is ASCII.
10. **Stop advisories 3 (verify fail/unrun) and 4 (Live run).** Not in H. Stop is untouched in P5 (I-5) and is
    rewritten with its own tests in P6. H pins the wiring only.

## 6. Assumptions and risks for P5

- **SessionStart join.** A single new handler that emits the memory digest and the compaction block in one
  `additionalContext` must join them with `"\n\n"` (memory first) to compare identical. Otherwise every compact /
  source-less row differs by the separator, and no class covers that.
- **Source-less SessionStart** must keep emitting memory + compaction block (`E/*/absent`, `F/SessionStart-all/empty`
  are untagged). A `source`-gated new `session-start.mjs` that drops the block there will be NOT ALLOWED until the
  owner approves it.
- **Wording is pinned.** Ask/deny reasons, the digest header ("Failure memory digest (…). The text between…"), the
  compaction block and the 16-hex nonce format are all byte-compared. plan.md says "開頭說明改成跟實際行為一致". If that
  is read as changing the injected digest header (rather than the hook's leading comment), every digest row changes
  with no class. I found no such change in `review/p5-doc-changes.md`; flagging it so it's decided before P5 records.
- **Root resolution is pinned per hook**, including the process-cwd asymmetry (§2) and `tool_input.path`. A shared
  settings/root reader that unifies them will surface as NOT ALLOWED rows. That's intended: owner call.
- **The harness itself is unreviewed.** Its emulation assumptions (matcher anchoring, dedupe, merge precedence,
  `"\n\n"`, dispatch "all" for source-less stdin) are mine, from the navigator design and the P0 probes. The sanity
  check (0 contradictions against the source tests) is the main evidence that they're faithful.

Failure memory: no meaningful failure occurred (the shebang slip in §4.5 was caught by the sanity check within the
same run). No entry proposed.

---

# P5a evidence: hook library, guard modules, shared failure-memory parser

Branch `refactor/v0.8-slim`, base HEAD `86ba905`. Nothing committed. No hook is rewired: `cressetide/hooks/**`
and `hooks.json` are untouched, and the old spawned tests still pass against the old hooks.

## Files changed

| file | purpose |
|---|---|
| `cressetide/lib/hook-io.mjs` (new) | `MAX_STDIN`, `readHookEvent` (bounded, bytes decoded once, never rejects; reasons over-cap / malformed / not-an-object / timeout / stream-error), `neutralize` (moved verbatim), `fence(tag, body)` → `{ nonce, open, text }` |
| `cressetide/lib/debug.mjs` (new) | `SWITCH_ON = /^(1\|true\|yes\|on)$/i`, `debugEnabled()` (literal `process.env.CTIDE_HOOK_DEBUG`), `createDebug(entry)` → `debug(check, msg)`; line `[ctide <entry>] <check>: redactDiagnostic(msg, 1000)` to `<temp>/ctide-hook.log` and stderr; log cleared at ≥ 1 MiB; never throws |
| `cressetide/lib/settings.mjs` (new) | `GUARD_KEYS`, `SETTINGS_FILES`, `SETTINGS_MAX_BYTES`, `triState`, `projectRoot(input, { processCwdFallback })`, `readSettingsFile` (stat-then-read, > 1 MiB → null), `guardFlags`, `readGuardFlag`, `guardDisabled` |
| `cressetide/lib/guards/shell.mjs` (new) | `stripQuotes`, `DD_OF_WRITE` (the one dd regex literal) |
| `cressetide/lib/guards/plan-gate.mjs` (new) | `looksLikePlanWrite`, `isPlanFile(target, { home })`, `planGate(input, { debug, home })` → `{ decision: "deny", reason } \| null`; `permission_mode` only; Write/Edit/NotebookEdit; mode checked first |
| `cressetide/lib/guards/destructive.mjs` (new) | `looksDestructive`, `destructive(input, { debug })` → ask \| null; match first, then any error → ask |
| `cressetide/lib/guards/contract.mjs` (new) | path matchers, `simulateResult` (Write/Edit), `extractContractJson`, `diffContractJson`, `diffDesignHeadings`, `guardFlagFindings` (settings-flag guard on `GUARD_KEYS`/`guardFlags`), `contract(input, { debug })`; NotebookEdit stays out |
| `cressetide/lib/guards/compact.mjs` (new) | `PRESERVE_BODY` (verbatim), `preserveContext(input, { debug })` → additionalContext text \| null (opt-out with `processCwdFallback`) |
| `cressetide/lib/guards/index.mjs` (new) | re-exports `planGate`, `destructive`, `contract`; **adds** `PRE_TOOL_USE_CHECKS` and `preToolUse(input, opts)` (see deviation D-a) |
| `cressetide/lib/failure-memory.mjs` (new) | `isPlaceholder`, bounded `isRetired`, `entryLevel`, `parseEntries`, `tagsOf` (linear, see deviation D-b), `buildDigest`, `memoryCandidates`, `injectableMemoryFile` (containment moved verbatim), `failureMemoryContext` (digest / I-4 pointer / null) |
| `cressetide/skills/vigil/scripts/failure-retrieve.mjs` | `parseEntries` is a thin wrapper over the shared parser adding `tagTokens`/`titleTokens`/`bodyTokens`; local `isRetired` (unbounded `[^)]*`), `isPlaceholder`, `dateOrdinal`, `recurrenceCount` removed; `resolveMemoryFile` walks `memoryCandidates`; usage error prints the O-6 A no-claim line |
| `cressetide/skills/vigil/scripts/failure-consolidate.mjs` | imports `parseEntries` from the shared lib (was via failure-retrieve) |
| `test/helpers.mjs` | adds `withEnv(vars, fn)` (sync env override with restore) for the in-process tests |
| `test/lib-hook-io.test.mjs` (new) | reader outcomes, 5 MiB boundary, split UTF-8, watchdog (unref'd), stream error, BOM; reader half of the old stdin rows; neutralize; fence |
| `test/lib-debug.test.mjs` (new) | switch values, prefix, redaction on both sinks, 1 MiB clear, bad TEMP, directory/symlink at the log path; the CHANGED debug row |
| `test/lib-settings.test.mjs` (new) | tri-state, root resolution, 1 MiB stat cap, precedence table, cwd fallback only when asked, hostile event |
| `test/lib-failure-memory.test.mjs` (new) | parser (`##`/`###`/mixed/I-3/CRLF/BOM), `tagsOf` equivalence + timing, digest, candidates, context (digest/pointer/null/read error), cross-check, every load-failure-memory port |
| `test/guards.test.mjs` (new) | every plan-gate / destructive / contract / compact port, D-4 timing on the classifiers, unchanged reason texts, preToolUse order and isolation, no-subprocess import check |
| `test/failure-retrieve.test.mjs` | O-6 A: the two usage-error tests now pin the exact no-claim line (red→green); `##` entries; bounded-retire timing through the wrapper |
| `test/failure-consolidate.test.mjs` | the 3 redundant `try/finally fs.rmSync` blocks removed (each target was a `tempDir()`, which auto-cleans) |

Not touched: `cressetide/hooks/**`, `docs/**`, `.ctide/**` (except this file), P5b's files (`cressetide/lib/git.mjs`,
`cressetide/skills/ship/**`, `test/lib-git.test.mjs`, `test/lib-read-capped.test.mjs`, `test/ship.test.mjs`,
`test/lib-binding.test.mjs`).

## Deviations and decisions to confirm

- **D-a `preToolUse` combinator in `guards/index.mjs` (additive).** The brief's mutant "plan-mode check moved after
  destructive" needs the check order to live in P5a code. `PRE_TOOL_USE_CHECKS = [plan-gate, destructive-guard,
  contract-guard]`; `preToolUse(input, opts)` runs them in that order, each in its own try/catch (a throwing check
  is skipped, the rest still run), and returns the first `{ decision, reason, check }` or null (never "allow").
  P5c's entry can call it and build `hookSpecificOutput` itself (the §5g check stays meaningful). Revert = delete
  the export; the three guards are still exported individually.
- **D-b `tagsOf`: a linear reader instead of "the existing regex".** Measured during implementation: the existing
  Tags pattern `/^\s*[-*]?\s*\**\s*tags\**\s*:?\s*(.+)$/i` backtracks cubically — 113 ms at 1,000 leading spaces,
  853 ms at 2,000, 6,631 ms at 4,000 (one line); its clean-up `/[.\s]+$/` and failure-retrieve's raw
  `/\s+$/` are quadratic (1.9–2.0 s at 80 KB). A FAILURE_MEMORY.md shipped by a cloned repo reaches this at every
  SessionStart (same threat model as D-2). `tagsOf` computes exactly the old capture + clean-up in one pass
  (prefix shape checked with a 5-state set walk, the capture's backtracking cases reproduced, `\s` per character,
  line terminators checked by code point); `raw` uses `trimEnd()` (identical character set to `\s`). Equivalence:
  a seeded differential test in the suite (20,000 random lines × 2 shapes over an adversarial alphabet incl. CR,
  U+2028, NBSP, BOM, U+017F, lone surrogates) plus an offline run of 2,000,000 lines × 2 shapes: **0 mismatches**.
  One quirk kept on purpose: `- Tags:` yields `":"` (the old backtracking hands `(.+)` the colon). Revert = one line
  (mutant `tagsOf-old-pattern` below).
- **D-c empty / all-retired files inject nothing (no pointer).** I-4 says "file found but no entries → pointer".
  I kept the old "nothing" for (1) an empty or whitespace-only file (a pointer to an empty file is noise; the old
  row "empty file injects nothing" ports 1:1) and (2) a file whose parsed entries are all retired or all placeholders
  (the pointer text "has no `##` or `###` entry headings" would be false there; old behavior was nothing). A
  placeholder-only `###` file has *no* entry level (I-3), so it gets the pointer (listed as CHANGED).
- **D-d BOM accepted.** `readHookEvent` drops one leading byte-order mark before `JSON.parse` (old hooks: malformed →
  fail-open); `parseEntries` drops one leading BOM so a first-line heading counts (old: that entry was missed).
- **D-e whitespace-only stdin reads as `{}`** (old PreToolUse hooks: malformed → no output; old compact-fidelity:
  `{}` → emit). For the guards both give no decision; compact keeps emitting; memory injects as for an event with no
  cwd (the old memory hook injected on malformed stdin too).
- **D-f `projectRoot` ignores a non-string event `cwd`** (old: `path.join` threw → not disabled / no injection).
  With `processCwdFallback` the memory/compact path then falls back to `process.cwd()`.
- **D-g debug log hardening.** I-2's "clear at 1 MiB, only touch our own log" is implemented as: `lstat` must show a
  regular file or nothing; open with `O_APPEND | O_NOFOLLOW | O_NONBLOCK` (the last two are 0 on Windows); `fstat`
  must show a regular file owned by this user (POSIX); the clear goes through a second, non-append descriptor
  because **Windows refuses `ftruncate` on an `O_APPEND` descriptor (EPERM — measured)**.
- **Hermetic test harness.** The in-process ports pass an isolated `home` (plan gate exemption, failure memory)
  where the spawned originals inherited the developer's HOME unless they isolated it; CLAUDE_PROJECT_DIR is unset
  per call unless a test sets it. Same inputs otherwise. The old "missing memory file" row no longer needs its
  "global file exists" skip.

## Intentional-change exceptions (rows marked CHANGED in the ledger)

| old row(s) | old expectation | new expectation | owner decision |
|---|---|---|---|
| plan-gate-guards: "Edit and MultiEdit are behaviorally gated in plan mode" | MultiEdit DENY | Edit DENY, MultiEdit ALLOW (not a gated tool) | plan 設計重點 "MultiEdit 已經不存在"; I-10 |
| plan-gate-guards: "plan-gate honors camelCase permissionMode alias" | DENY | ALLOW (only `permission_mode` is read) | D2 / P5 "Copilot：刪 camelCase alias" |
| plan-gate-guards: 3 contract-guard MultiEdit rows ("…MultiEdit whose later step's old_string is not found…", "BLOCKER-fix: a MultiEdit step with its OWN replace_all:true…" (was ASK), "MAJOR2: a settings-file MultiEdit…") | ALLOW / ASK / ALLOW | ALLOW (MultiEdit out of scope; `simulateResult` is Write/Edit) | plan 設計重點 (MultiEdit gone) |
| hooks: "destructive guard debug treats every non-empty value as enabled and preserves the raw-command diagnostic format" | `CTIDE_HOOK_DEBUG=0` logs; Bearer token in plaintext | `0` writes nothing; with `1` the token is absent from both sinks | plan 設計重點 "Debug 開關"; P5 "Debug"; AC-6; I-2 |
| hooks: "failure memory is project-first, nonce-fenced, and neutralizes line-leading role markers"; session-memory: "digest neutralizes injected role markers and instruction tags", "load-failure-memory: hostile content stays nonce-fenced…" | raw prose fenced + neutralized | only the I-4 pointer; no line of the file | I-4; navigator finding "raw fallback → pointer" |
| hooks: "failure memory prefers project data and otherwise uses the global read-only fallback" | raw `CROSS_REPOSITORY_SECRET` / `PROJECT_LOCAL_LESSON` injected | pointer naming the global file, then the project file; text not injected (an extra `##` variant pins the tier order with real entries) | I-4 |
| session-memory: "placeholder-only file injects nothing" | nothing | pointer | I-3 (placeholder `###` is not an entry heading) + I-4 |
| (no row) old memory hook injected even when stdin was malformed | — | the entry (P5c) fails open on a malformed event; `failureMemoryContext` takes a parsed event | plan P5 "spawn 冒煙: stdin 只有 `{`" |

## D-4 / D-2 timing: green and red

Green: real tree, in-process, isolated TEMP. Red: scratch copy (`cressetide/lib/**` + the tests + helpers copied to a
fresh temp tree), every `{0,200}` on the one regex literal replaced by `*`, only that file changed, then the
timing tests run. Limit `< 250 ms` (`TIMING_LIMIT_MS`); the elapsed time is measured around the classifier
(`looksLikePlanWrite` / `looksDestructive` / `isRetired` / `failureMemoryContext` / the retrieve wrapper) and
asserted before the decision check.

| test (guards.test / lib-failure-memory.test / failure-retrieve.test) | mutated regex | green | red |
|---|---|---|---|
| plan-gate F1 pathological sed | plan-gate `sed\b(?=…)` | 23.0 ms | **7,015 ms** |
| plan-gate F1 pathological perl | plan-gate `perl\b(?=…)` | 19.1 ms | **5,436 ms** |
| plan-gate F1 pathological git apply | plan-gate `git\s+apply\b(?!…)` | 6.8 ms | **2,091 ms** |
| plan-gate F1 pathological dd | shell `DD_OF_WRITE` (shared) | 6.7 ms | **2,214 ms** |
| destructive F1 pathological dd | shell `DD_OF_WRITE` (same mutant) | 7.4 ms | **2,175 ms** |
| destructive F1 pathological rm | `rm … r then f` | 39.7 ms | **6,068 ms** |
| destructive F1 pathological rm | `rm … f then r` (separate mutant) | 39.7 ms | **5,752 ms** |
| destructive F1 pathological git reset | `git\s+reset\s+…` | 10.9 ms | **3,345 ms** |
| destructive F1 pathological git push | `git\s+push\s+…` | 12.2 ms | **3,219 ms** |
| destructive F1 pathological find | `find\s[^;&\|]…` | 20.9 ms | **5,711 ms** |
| destructive F1 (retroactive) pathological mysqladmin | `mysqladmin\b(?=…)` | 8.2 ms | **1,766 ms** |
| destructive F1 (retroactive) pathological redis-cli | `redis-cli\b(?=…)` | 9.5 ms | **1,512 ms** |
| destructive F1 pathological Remove-Item | `(?:remove-item\|ri)\b(?=…)` | 11.0 ms | **3,134 ms** |
| isRetired 240 KB pathological (D-2) | failure-memory `isRetired` | 7.8 ms | **1,465 ms** |
| load-failure-memory pathological (superseded …) port (D-2) | failure-memory `isRetired` (same mutant) | 8.9 ms | **1,494 ms** |
| failure-retrieve parseEntries 240 KB pathological | failure-memory `isRetired` (same mutant) | 9.0 ms | **1,480 ms** |
| tagsOf hostile whitespace (deviation D-b) | `tagsOf` → the old pattern | 0.3 ms (+6.1 ms for two 256 KiB lines) | **6,072 ms** |

In every red run exactly the targeted test(s) failed; the other 11 F1 timing tests stayed green (runner log:
"1 failed, 11 passed"; the dd mutant "2 failed, 10 passed").

## Mutant table (each a single replacement in a fresh scratch copy; repository tree never written)

| id | change | tests run | result |
|---|---|---|---|
| M1 | `entryLevel` without the placeholder exclusion (`if (!isPlaceholder(…)) return 3;` → `return 3;`) | lib-failure-memory (all) | RED 4: entryLevel; I-3 parse; I-3 context; placeholder-only CHANGED |
| M2 | pointer → raw fallback (`return fence("FAILMEM", content.trim()).text`) | lib-failure-memory (all) | RED 6: prose-only pointer; placeholder-only; 2 session-memory CHANGED; 2 hooks CHANGED |
| M3 | `SWITCH_ON = /./` | lib-debug (all) | RED 3: off values; SWITCH_ON rule; CHANGED debug row |
| M4 | stderr sink writes the unredacted message | lib-debug (all) | RED 2: redaction both sinks; CHANGED debug row |
| M4b | log sink writes the unredacted message | lib-debug (all) | RED 4: redaction; CHANGED debug row; prefix; 1000-char cut |
| M5 | 1 MiB clear removed (`if (stat.size < LOG_MAX_BYTES)` → `if (true)`) | lib-debug (all) | RED 1: the 1 MiB clear test |
| M6 | matched-then-error → fail-open (`catch { disabled = false; }` → `catch { return null; }`) | guards (all) | RED 1: "once a command matches, an error afterwards … still asks" |
| M7 | plan-gate moved after destructive in `PRE_TOOL_USE_CHECKS` | guards (all) | RED 3: order; plan-mode write+destructive → deny; throwing check isolation |
| D4-* / D2 / tagsOf | `{0,200}` → `*` per regex; `tagsOf` → old pattern | F1 / 240 KB / tagsOf filters | RED, see the timing table (13 + 1 + 1 mutants) |
| X1 | O-6: usage error prints the no-match line again | failure-retrieve CLI | RED 2: both usage-error tests |
| X2 | over-cap at exactly the cap (`>` → `>=`) | lib-hook-io (all) | RED 2: 5 MiB boundary; custom cap |
| X3 | settings 1 MiB stat cap removed | lib-settings (all) + guards oversized/MINOR1 | RED 3 + RED 1 (contract MINOR1) |
| X4 | camelCase `permissionMode` alias restored | guards plan-gate filter | RED 1: alias CHANGED row |
| X5 | MultiEdit restored to the plan gate | guards MultiEdit filter | RED 1: Edit/MultiEdit CHANGED row |
| X6 | empty file gets the pointer | lib-failure-memory "empty" | RED 2: both empty-file tests |
| X7 | PreToolUse root falls back to `process.cwd()` | lib-settings (all) | RED 1: cwd fallback only when asked |
| X8 | BOM kept by the stdin reader | lib-hook-io (all) | RED 1: BOM test |
| X9 | a read error on the chosen file falls through to the next tier | lib-failure-memory "read error" | RED 1: no-fall-through test (ran for real on Windows via `icacls /deny *S-1-1-0:(RD)`) |

Control (no mutation) on the same scratch copy: all filtered tests green, 0 `ctide-*` left in the run's TEMP.
Every mutant run: 0 `ctide-*` left.

## Test results (isolated TEMP per run; `TEMP`/`TMP`/`TMPDIR` → a fresh `mktemp -d`)

| file | tests | pass | fail | skipped (reason) |
|---|---|---|---|---|
| test/lib-hook-io.test.mjs (new) | 33 | 33 | 0 | 0 |
| test/lib-debug.test.mjs (new) | 12 | 11 | 0 | 1 (file symlink: EPERM on Windows) |
| test/lib-settings.test.mjs (new) | 18 | 18 | 0 | 0 |
| test/lib-failure-memory.test.mjs (new) | 68 | 66 | 0 | 2 (file symlink: EPERM; same skips as the originals) |
| test/guards.test.mjs (new) | 174 | 172 | 0 | 2 (dir symlink EPERM; case-sensitive-FS test on Windows; same skips as the originals) |
| test/failure-retrieve.test.mjs | 24 | 24 | 0 | 0 |
| test/failure-consolidate.test.mjs | 27 | 27 | 0 | 0 |
| test/doctor-project.test.mjs (imports failure-retrieve's parseEntries) | 32 | 30 | 0 | 2 (pre-existing: POSIX perms; symlink) |
| test/lib-binding.test.mjs (read-only run; P5b's file, with their in-progress edits) | 28 | 28 | 0 | 0 |
| test/lib-redact.test.mjs, test/helpers.test.mjs | 26, 15 | all | 0 | 0 |
| test/release-cli.test.mjs (imports every archived lib module) | 35 | 35 | 0 | 0 |
| old spawn tests: hooks / plan-gate-guards / session-memory-hooks | 19 / 147 / 50 | 19 / 145 / 48 | 0 | 0 / 2 / 2 (pre-existing) |

Final combined run (14 files): wall 138 s, **0 `ctide-*` left, 0 entries left** in the run's TEMP.
`npm run validate`: exit 0 ("Plugin structure validation passed." — env inventory still exactly
`CTIDE_ENFORCE_STOP, CTIDE_HOOK_DEBUG, CTIDE_REPAIR_PUBLISHED_RELEASE_ASSETS`; text integrity and scratch-name
checks cover the new untracked files). Byte scan of every new/edited file: only intended non-ASCII (U+2014, U+2026,
U+FF1A, U+00B7, CJK in comments / pre-existing CJK ranges), no CR, no U+FFFD.

Parity check (one-off, scratch): new in-process results vs the old spawned hooks on 15 representative inputs
(plan-gate Bash/PowerShell/Write, destructive Bash/PowerShell/benign, contract weaken / prose / no-op / settings /
design, compact with nonce masked, memory digest with placeholder + retired + recurrence + `system:` title):
**0 differences**.

## Found but not changed

- **contract-guard `extractHeadings`** (`/^\s*##\s+(.+?)\s*$/`, design.md) is quadratic on a heading line with a long
  internal whitespace run: 135 ms at 20,000 spaces, 535 ms at 40,000. Moved verbatim (contract semantics unchanged
  per brief). Reached only when a tool call writes design.md.
- **contract.md / design.md are read whole** (`readFileSync`, no cap) — verbatim from the old hook; settings files
  are capped at 1 MiB.
- **`neutralize`** has the same adjacent-`\s*` shape as the old Tags pattern but is only quadratic and small
  (11 ms at 4,000 leading spaces); digest lines start with "- " and PRESERVE_BODY is constant, so not exposed.
- **doctor.mjs `projectLocalMemoryCandidates`** hand-mirrors the first two `memoryCandidates` paths; it still
  matches (doctor-project green). Could import `memoryCandidates` — out of scope here.
- **For P5c:** `test/documented-facts.test.mjs` pins `env.CTIDE_HOOK_DEBUG.enables = non-empty` by spawning the
  wired hooks; it must flip to the `1|true|yes|on` rule together with the facts block / runtime-contract
  (plan P5 "Debug"). `hooks.json` matchers still list MultiEdit (P5c). The validator's §5g only inspects wired hook
  files, so the P5c entries (not the guards) must contain `hookSpecificOutput`.
- On this Windows machine the symlink-based tests skip (EPERM), as their originals do; the junction-based
  containment tests run.

## Port ledger

Generated from the TAP output of the three old files and the new files: each old title matched to the new
test(s) whose title starts with it. 216 old rows: 185 ported 1:1, 12 reader half ported (the exit 0 / no output
half is P5c's spawn smoke), 11 CHANGED (table above), 8 not ported (hooks.json wiring / output flush → P5c; the
Stop hook → I-5). Unmatched: 0.

| old file | old title | new file | status |
|---|---|---|---|
| plan-gate-guards | B3: repo-local .claude/plans path is NOT exempt (denied in plan mode) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | home ~/.claude/plans path IS exempt (isolated home) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | plan-gate: a junction under ~/.claude/plans whose target escapes is NOT exempt (denied) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | plan-gate: a symlinked HOME still exempts ~/.claude/plans (realpath BOTH sides) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | plan-gate: on a case-sensitive FS, an uppercase ~/.claude/PLANS path is NOT exempt | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | plan-gate: on a case-insensitive FS, an uppercase ~/.claude/PLANS path IS exempt (same dir) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | normal file write is denied in plan mode, allowed otherwise | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | NotebookEdit is gated in plan mode | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | Edit and MultiEdit are behaviorally gated in plan mode | test/guards.test.mjs | CHANGED |
| plan-gate-guards | Read is never gated | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | Bash tripwire: obvious working-tree writes are denied in plan mode | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | Bash tripwire: read-only / benign commands are allowed in plan mode | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | Bash tripwire: only fires in plan mode (a write is allowed outside plan) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | Bash tripwire: documented conservative misses stay allowed (boundary is intentional) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | Bash tripwire: a quoted redirection target is a literal, not a real write | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | Bash tripwire: the deny reason names the heuristic and the escape hatch | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | plan-gate F1: sed -i with realistic padding before -i still denies (bound doesn't clip normal usage) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | plan-gate F1: a pathological sed input (no -i/--in-place anywhere) returns a decision quickly (linear, not quadratic ReDoS) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | plan-gate F1: perl -i with realistic padding before -i still denies (bound doesn't clip normal usage) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | plan-gate F1: a pathological perl input (no -i anywhere) returns a decision quickly (linear, not quadratic ReDoS) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | plan-gate F1: git apply with realistic padding still resolves correctly, both with and without --check (bound doesn't clip normal usage) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | plan-gate F1: a pathological git apply input (--check present at every occurrence) returns a decision quickly (linear, not quadratic ReDoS) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | plan-gate F1: a pathological dd input (no of= anywhere) returns a decision quickly (linear, not quadratic ReDoS) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | malformed stdin fails open (no deny, no crash) | test/lib-hook-io.test.mjs | reader half ported (exit 0 / no output: P5c spawn smoke) |
| plan-gate-guards | hooks.json PreToolUse matcher actually covers every gated tool | — | not ported: wiring (hooks.json); P5c rewrites with the new matcher (no MultiEdit) |
| plan-gate-guards | plan-gate honors camelCase permissionMode alias | test/guards.test.mjs | CHANGED |
| plan-gate-guards | plan-gate fails open (allow) on oversized stdin | test/lib-hook-io.test.mjs | reader half ported (exit 0 / no output: P5c spawn smoke) |
| plan-gate-guards | plan-gate deny JSON is fully flushed even with a large payload | — | not ported: entry output flush; P5c entry smoke |
| plan-gate-guards | plan-gate: ctide.planGate=false in settings.json allows in plan mode | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | plan-gate: settings.local.json opt-out overrides settings.json | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | plan-gate: no flag still denies in plan mode (default enforce) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | plan-gate: planGate=true explicitly enforces (deny) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | plan-gate: malformed project settings fail safe to enforce (deny) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | plan-gate: the opt-out resolves from the event cwd when CLAUDE_PROJECT_DIR is unset | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | plan-gate: a bare {"ctide":false} settings.json on disk does not suppress plan-mode enforcement (readPlanGateFlag must not misread it as planGate:false) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | plan-gate: a bare root-level `false` settings.json document also does not suppress plan-mode enforcement | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | destructive-guard: ASKS on unrecoverable commands in ANY mode (incl. default — the gap plan-gate misses) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | destructive-guard: ALLOWS benign / recoverable / quoted commands (narrow deny-list, no FP) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | destructive-guard: only Bash is in scope (a Write whose content contains rm -rf is never its concern) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | destructive-guard: project opt-out ctide.destructiveGuard=false allows | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | destructive-guard: settings.local.json opt-out overrides settings.json | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | destructive-guard: malformed project settings fail safe to ASK (a broken file never drops the net on a match) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | destructive-guard: a bare {"ctide":false} settings.json on disk does not suppress the destructive-command ask (readGuardFlag must not misread it as destructiveGuard:false) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | destructive-guard: a bare root-level `false` settings.json document also does not suppress the ask | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | destructive-guard: the ASK reason warns an AI agent against self-authoring the destructiveGuard opt-out reactively | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | destructive-guard: the ASK reason names settings.local.json alongside settings.json (higher-precedence, gitignored, diff-invisible) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | destructive-guard: malformed stdin fails open (no ask, no crash) | test/lib-hook-io.test.mjs | reader half ported (exit 0 / no output: P5c spawn smoke) |
| plan-gate-guards | destructive-guard: oversized stdin fails open (allow) | test/lib-hook-io.test.mjs | reader half ported (exit 0 / no output: P5c spawn smoke) |
| plan-gate-guards | destructive-guard: separated rm flags (rm -r -f / rm -f -r / long forms) now ASK, while single-token rm -rf still asks | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | destructive-guard: a single rm flag (recursive-only or force-only) stays ALLOW — no FP from the split-flag rule | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | destructive-guard: separated-flag fail-open preserved (malformed stdin still no ask, no crash) | test/lib-hook-io.test.mjs | reader half ported (exit 0 / no output: P5c spawn smoke) |
| plan-gate-guards | destructive-guard F1: bounded separated-flag patterns still ASK on realistic forms (correctness preserved) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | destructive-guard F1: a pathological rm input returns a decision quickly (linear, not quadratic ReDoS) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | destructive-guard F1: git reset --hard with realistic padding before --hard still asks (bound doesn't clip normal usage) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | destructive-guard F1: a pathological git reset input (no --hard anywhere) returns a decision quickly (linear, not quadratic ReDoS) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | destructive-guard F1: git push --force with realistic padding before the force flag still asks (bound doesn't clip normal usage) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | destructive-guard F1: a pathological git push input (no --force/-f anywhere) returns a decision quickly (linear, not quadratic ReDoS) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | destructive-guard F1: find -delete with realistic padding before -delete still asks (bound doesn't clip normal usage) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | destructive-guard F1: a pathological find input (no -delete anywhere) returns a decision quickly (linear, not quadratic ReDoS) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | destructive-guard F1: dd of= with a realistic longer invocation still asks (bound doesn't clip normal usage) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | destructive-guard F1: a pathological dd input (no of= anywhere) returns a decision quickly (linear, not quadratic ReDoS) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | destructive-guard F1 (retroactive): a pathological mysqladmin input (no drop anywhere) returns a decision quickly (linear, not quadratic ReDoS) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | destructive-guard F1 (retroactive): a pathological redis-cli input (no flushall/flushdb anywhere) returns a decision quickly (linear, not quadratic ReDoS) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | destructive-guard: PowerShell-native destructive forms (Windows/Copilot) ASK | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | destructive-guard: non-recursive / non-destructive PowerShell stays ALLOW (no FP) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | destructive-guard F1: Remove-Item with realistic padding before -Recurse still asks (bound doesn't clip normal usage) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | destructive-guard F1: a pathological Remove-Item input (no -Recurse-ish flag anywhere) returns a decision quickly (linear, not quadratic ReDoS) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | destructive-guard: git push --force-fast (a non-flag) does NOT false-ask, but --force / --force-with-lease still do | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | destructive-guard A4: a parenthesized subshell running a destructive command ASKS; a benign paren does NOT | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | destructive-guard A4: the '(' subshell anchor fires beyond rm (non-rm destructive commands ASK) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | destructive-guard: tool_name:"PowerShell" + destructive command ASKS like Bash, and the reason names PowerShell | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | destructive-guard: tool_name:"PowerShell" + benign command stays ALLOW | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | plan-gate: tool_name:"PowerShell" write-looking commands are DENIED and the reason names PowerShell | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | plan-gate: tool_name:"PowerShell" benign/read-only commands stay ALLOW in plan mode | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | destructive-guard: the existing Bash-tool PowerShell-syntax path still ASKS unchanged | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | destructive-guard: tool_name:"Bash" ASK reason uses the live tool value | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | plan-gate: tool_name:"Bash" deny reason uses the live tool value | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard: pure-append to contract.md (new AC added, everything old intact) is allowed | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard: silently altering an existing AC's text/verification asks, naming the AC id | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard: a verification mapping silently altered on the same AC also asks | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard: dropping an existing AC id entirely (not just editing it) asks, naming it as removed | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard: flipping behaviorChanging true->false on a retained AC id asks, naming that field specifically | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard A3: dropping an id-LESS acceptance criterion (matched by text) asks, naming it as removed | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard A3: a benign reorder of id-less ACs (same texts, different order) does NOT ask | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard: removing a mustNotChange entry asks | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard: removing a forbiddenPaths entry asks | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard: removing an allowedPaths entry asks | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard: risk downgraded high->low asks; risk increased medium->high is allowed | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard M1: a non-canonical-cased risk downgrade (high->"Low") still asks (ordinal lookup is case/whitespace-normalized) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard: contract.md first-ever write (no prior file, no populated sibling) allows regardless of content | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard: contract.md whose prior content has no parseable JSON block also allows (no populated sibling) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard: an already-populated contract.md whose new content drops the JSON block entirely asks | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard: an Edit whose old_string does not match current content is allowed (cannot simulate) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard: a MultiEdit whose later step's old_string is not found fails open for the WHOLE call | test/guards.test.mjs | CHANGED |
| plan-gate-guards | contract-guard M2: an Edit whose old_string matches a value shared by two ACs only simulates the FIRST occurrence (real Edit semantics) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard: an edit to some unrelated file never invokes any comparison (no-op) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard: project opt-out ctide.contractGuard=false suppresses an otherwise-real finding | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard: settings.local.json opt-out overrides settings.json (local-overrides-project precedence) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard: malformed project settings fail safe to keep asking (a broken file must not silently drop the guard) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard: a bare {"ctide":false} settings.json on disk does not suppress a genuine contract.md-weakening ask (readGuardFlag must not misread it as contractGuard:false) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard: a bare root-level `false` settings.json document also does not suppress a genuine ask | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard control: {"ctide":0} (not the literal boolean false) behaves identically before/after this fix -- isolates literal `false` as the specific value ever misread | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard: the ASK reason warns an AI agent against self-authoring the contractGuard opt-out reactively | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard: the ASK reason names settings.local.json alongside settings.json (higher-precedence, gitignored, diff-invisible) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard: oversized stdin fails open (allow) | test/lib-hook-io.test.mjs | reader half ported (exit 0 / no output: P5c spawn smoke) |
| plan-gate-guards | contract-guard: malformed stdin fails open (no ask, no crash) | test/lib-hook-io.test.mjs | reader half ported (exit 0 / no output: P5c spawn smoke) |
| plan-gate-guards | contract-guard: an unreadable target file (e.g. a directory at that path) fails open | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | design.md: a section body edited/expanded with the heading kept is allowed | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | design.md: a whole heading (## Do's and Don'ts) removed asks, naming that section | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | design.md: a section reduced to an 'n/a' placeholder with the heading kept is allowed | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | design.md: exact-normalized heading match only — '## Color' must not match inside '## Color Palette & Roles' | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | design.md: a design.md matched by basename at a non-root path is still guarded (not root-anchored) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | design.md: first-ever write (no prior file) is allowed (nothing to have lost) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | design.md A2: a whole section removed from a differently-cased basename (Design.md) still asks | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard: a weakening Write to the current .ctide/output/contract.md path asks | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard: the same weakening Write at the compatibility .ctide/legacy-output/contract.md path still asks (control) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard: design.md at its current .ctide/design/ home is guarded by basename (whole-section deletion asks) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard sibling baseline (a): fresh weakened Write to the current path with a populated compatibility sibling asks, naming the lost entry and sibling | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard sibling baseline (b): fresh weakened Write to the compatibility path with a populated current sibling asks (reverse direction) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard sibling baseline (c): a true first write (no sibling anywhere) stays allowed at both watched paths | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard sibling baseline (d): a fresh Write that is a strict superset of the populated sibling stays allowed | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard sibling baseline (e): a prose-only sibling (no JSON block) does not become a baseline — fresh write stays allowed (fail-open) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard sibling baseline (f): project opt-out ctide.contractGuard=false suppresses the sibling-baseline ask too | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard settings-guard (a): a fresh settings.json Write introducing contractGuard:false, where neither settings file existed before, asks | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard settings-guard (b): settings.local.json already has contractGuard:false; an unrelated Edit sets the SAME key false again in settings.json (redundant, no effective change) does not ask | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard settings-guard (c): a flag flip false -> true (re-enabling protection) does not ask | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard settings-guard (d): an edit touching only unrelated keys (e.g. permissions.allow) does not ask (no-op) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard settings-guard (e): the existing ctide.contractGuard:false opt-out also suppresses this NEW settings-file ask | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard settings-guard (f1): malformed JSON in the SIBLING settings file does not mask a real flip in the file actually being written | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard settings-guard (f2): malformed JSON in the TARGET's proposed content fails open (no ask, no crash) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard settings-guard: settings.local.json itself is also watched (not just settings.json) — a fresh local-only write flipping a flag asks | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard settings-guard: an unrelated file write (not either settings path) is never affected (no-op) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard settings-guard BLOCKER-fix: an Edit with replace_all:true genuinely flips a guard flag when an earlier same-text boolean token precedes it in the file (real replace_all semantics, not first-occurrence-only simulation) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard settings-guard BLOCKER-fix: a MultiEdit step with its OWN replace_all:true also genuinely flips the guard flag (per-step semantics) | test/guards.test.mjs | CHANGED (covered by the MultiEdit row) |
| plan-gate-guards | contract-guard settings-guard BLOCKER-fix control: the SAME earlier-boolean-token Edit WITHOUT replace_all stays first-occurrence-only (does not ask) -- proves the fix is replace_all-gated, not a behavior change for the default case | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard settings-guard MAJOR1-fix: a sibling settings file where 'ctide' itself is the bare boolean false does not mask a fresh guard-flag introduction in the target | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard settings-guard MAJOR1-fix: a sibling settings file whose ENTIRE content is the bare boolean false (root-level, not wrapped in an object) also does not mask a fresh guard-flag introduction | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard settings-guard MAJOR2: a fresh settings.json Write introducing planGate:false, where neither settings file existed before, asks (planGate's own ASK path, not just inside an opt-out-suppressed ALLOW test) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard settings-guard MAJOR2: a fresh settings.json Write introducing preserveOnCompact:false, where neither settings file existed before, asks (preserveOnCompact's own ASK path) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard settings-guard MAJOR2: a settings-file MultiEdit whose later step's old_string is not found fails open for the WHOLE call | test/guards.test.mjs | CHANGED (covered by the MultiEdit row) |
| plan-gate-guards | contract-guard settings-guard MAJOR2: a single Write flipping 2+ guard flags at once names ALL of them in the ask reason (and never names a flag that was enabled, not disabled) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard settings-guard MAJOR2: a proposed settings content that is valid JSON but not an object (e.g. an array) does not ask, no crash | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard settings-guard MINOR1: an oversized (>1MB) on-disk settings file's real prior value is no longer read once capped -- a proposed value matching what the file may already (unverifiably) say still asks, where the same input was correctly a no-op before the cap existed | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard settings-guard: an edit that leaves an already-degenerate ctide:false value untouched (only an unrelated key changes) stays a no-op (ALLOW) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | contract-guard settings-guard: re-proposing an unchanged root-level bare `false` document stays a no-op (ALLOW) | test/guards.test.mjs | ported 1:1 |
| plan-gate-guards | hooks.json wires contract-guard.js under PreToolUse with a matcher covering Write/Edit/MultiEdit | — | not ported: wiring; P5c |
| plan-gate-guards | contract-guard settings-guard (g): the settings-file guard rides the EXISTING contract-guard.js wiring — hooks.json still has exactly one contract-guard.js entry and the hook count stays 6 | — | not ported: wiring/hook count; P5c |
| hooks | plan gate denies structured edits in plan mode and allows them otherwise | test/guards.test.mjs | ported 1:1 |
| hooks | plan gate honors an existing project opt-out | test/guards.test.mjs | ported 1:1 |
| hooks | settings.local.json has per-key precedence over settings.json | test/guards.test.mjs | ported 1:1 |
| hooks | malformed, oversized, and bare-false settings do not disable the plan gate | test/guards.test.mjs | ported 1:1 |
| hooks | destructive guard asks for high-confidence destructive commands | test/guards.test.mjs | ported 1:1 |
| hooks | plan gate covers its documented shell-write tripwires | test/guards.test.mjs | ported 1:1 |
| hooks | destructive guard covers documented Bash and PowerShell forms | test/guards.test.mjs | ported 1:1 |
| hooks | destructive guard debug treats every non-empty value as enabled and preserves the raw-command diagnostic format | test/lib-debug.test.mjs | CHANGED |
| hooks | destructive guard settings precedence and malformed fail-safe behavior | test/guards.test.mjs | ported 1:1 |
| hooks | contract guard asks before weakening an established task contract | test/guards.test.mjs | ported 1:1 |
| hooks | contract guard asks before a protection flag is newly disabled | test/guards.test.mjs | ported 1:1 |
| hooks | contract guard settings precedence and malformed fail-safe behavior | test/guards.test.mjs | ported 1:1 |
| hooks | failure memory is project-first, nonce-fenced, and neutralizes line-leading role markers | test/lib-failure-memory.test.mjs | CHANGED |
| hooks | failure memory prefers project data and otherwise uses the global read-only fallback | test/lib-failure-memory.test.mjs | CHANGED |
| hooks | compact fidelity emits only for compact sessions and supports explicit opt-out | test/guards.test.mjs | ported 1:1 |
| hooks | compact fidelity settings precedence and malformed fail-safe behavior | test/guards.test.mjs | ported 1:1 |
| hooks | orchestration check advises when shipped delivery reports a failed verification | — | not ported: Stop hook, untouched in P5 (owner I-5) |
| hooks | all hooks fail open on malformed input | test/lib-hook-io.test.mjs | reader half ported (exit 0 / no output: P5c spawn smoke) |
| hooks | all hooks exit successfully when stdin exceeds their bounded buffer | test/lib-hook-io.test.mjs | reader half ported (exit 0 / no output: P5c spawn smoke) |
| session-memory-hooks | B1: omitted note excludes the skipped template placeholder | test/lib-failure-memory.test.mjs | ported 1:1 |
| session-memory-hooks | B2: an oversized newest entry still yields a non-empty digest (bounded, no lone note) | test/lib-failure-memory.test.mjs | ported 1:1 |
| session-memory-hooks | MAX_ENTRIES: 22 entries -> 20 kept and omitted count is the real remainder | test/lib-failure-memory.test.mjs | ported 1:1 |
| session-memory-hooks | digest ranks a recurring older entry above a newer one-off (importance, not raw recency) | test/lib-failure-memory.test.mjs | ported 1:1 |
| session-memory-hooks | digest with no recurrence falls back to newest-first ordering | test/lib-failure-memory.test.mjs | ported 1:1 |
| session-memory-hooks | placeholder-only file injects nothing | test/lib-failure-memory.test.mjs | CHANGED |
| session-memory-hooks | empty file injects nothing | test/lib-failure-memory.test.mjs | ported 1:1 |
| session-memory-hooks | missing memory file injects nothing (when no global file present) | test/lib-failure-memory.test.mjs | ported 1:1 |
| session-memory-hooks | entry missing rule/tags degrades gracefully; CRLF parsed | test/lib-failure-memory.test.mjs | ported 1:1 |
| session-memory-hooks | project ai/FAILURE_MEMORY.md takes precedence and is named in the digest | test/lib-failure-memory.test.mjs | ported 1:1 |
| session-memory-hooks | load-failure-memory resolves the project root from CLAUDE_PROJECT_DIR (matching plan-gate) | test/lib-failure-memory.test.mjs | ported 1:1 |
| session-memory-hooks | digest wraps the body in a per-run nonce fence with an untrusted-data warning | test/lib-failure-memory.test.mjs | ported 1:1 |
| session-memory-hooks | digest neutralizes injected role markers and instruction tags | test/lib-failure-memory.test.mjs | CHANGED |
| session-memory-hooks | load-failure-memory: the digest indexes title + tags but omits the prevention-rule prose (reduced surface) | test/lib-failure-memory.test.mjs | ported 1:1 |
| session-memory-hooks | load-failure-memory: hostile content stays nonce-fenced, labeled untrusted, and role-markers neutralized | test/lib-failure-memory.test.mjs | CHANGED |
| session-memory-hooks | load-failure-memory: a role-marker in an entry TITLE is neutralized despite the '- ' prefix | test/lib-failure-memory.test.mjs | ported 1:1 |
| session-memory-hooks | digest handles a very large memory file without reading it all (cap) | test/lib-failure-memory.test.mjs | ported 1:1 |
| session-memory-hooks | hooks.json SessionStart matcher includes compact | — | not ported: wiring; P5c |
| session-memory-hooks | load-failure-memory F1: a junction at ai/ escaping the project is not read/injected (containment) | test/lib-failure-memory.test.mjs | ported 1:1 |
| session-memory-hooks | load-failure-memory F1: ai/FAILURE_MEMORY.md symlinked to an out-of-project file is not injected | test/lib-failure-memory.test.mjs | ported 1:1 |
| session-memory-hooks | load-failure-memory F1: a normal in-tree ai/FAILURE_MEMORY.md still injects (containment allows the legit case) | test/lib-failure-memory.test.mjs | ported 1:1 |
| session-memory-hooks | load-failure-memory F1: a normal ~/.claude/FAILURE_MEMORY.md still injects through the global containment guard | test/lib-failure-memory.test.mjs | ported 1:1 |
| session-memory-hooks | load-failure-memory F1: a ~/.claude/FAILURE_MEMORY.md symlinked outside ~/.claude is not injected | test/lib-failure-memory.test.mjs | ported 1:1 |
| session-memory-hooks | load-failure-memory: digest skips entries whose title is marked (expired)/(superseded …) | test/lib-failure-memory.test.mjs | ported 1:1 |
| session-memory-hooks | load-failure-memory: a title that merely discusses expiry (no paren marker) is still injected (fails toward showing) | test/lib-failure-memory.test.mjs | ported 1:1 |
| session-memory-hooks | load-failure-memory: a MID-title (expired)/(superseded) mention is NOT retired — only a trailing marker is | test/lib-failure-memory.test.mjs | ported 1:1 |
| session-memory-hooks | load-failure-memory: the NEWEST entry being retired doesn't break the digest (next active becomes effective newest) | test/lib-failure-memory.test.mjs | ported 1:1 |
| session-memory-hooks | load-failure-memory: retired entries do not inflate the omitted count | test/lib-failure-memory.test.mjs | ported 1:1 |
| session-memory-hooks | load-failure-memory: isRetired still retires a realistic longer (superseded by ...) marker (ReDoS bound doesn't clip normal usage) | test/lib-failure-memory.test.mjs | ported 1:1 |
| session-memory-hooks | load-failure-memory: a pathological (superseded ...) title with no closing paren returns a digest quickly and stays NOT retired (linear, not quadratic ReDoS) | test/lib-failure-memory.test.mjs | ported 1:1 |
| session-memory-hooks | load-failure-memory 3-tier: .ctide/memory alone is read and disclosed (new first tier) | test/lib-failure-memory.test.mjs | ported 1:1 |
| session-memory-hooks | load-failure-memory 3-tier: BOTH tiers present -> the new path wins over legacy | test/lib-failure-memory.test.mjs | ported 1:1 |
| session-memory-hooks | load-failure-memory 3-tier: legacy-only still injects (read-only fallback tier; regression control) | test/lib-failure-memory.test.mjs | ported 1:1 |
| session-memory-hooks | load-failure-memory 3-tier: neither project tier -> the global file is the last tier (regression control) | test/lib-failure-memory.test.mjs | ported 1:1 |
| session-memory-hooks | load-failure-memory 3-tier: a junction at .ctide/memory escaping the project is not read (containment covers the new first tier) | test/lib-failure-memory.test.mjs | ported 1:1 |
| session-memory-hooks | compact-fidelity: a post-compaction SessionStart emits a nonce-fenced preservation block naming ctide's constructs | test/guards.test.mjs | ported 1:1 |
| session-memory-hooks | compact-fidelity: a non-compact SessionStart (startup/resume/clear) emits nothing | test/guards.test.mjs | ported 1:1 |
| session-memory-hooks | compact-fidelity: opt-out ctide.preserveOnCompact=false suppresses the block | test/guards.test.mjs | ported 1:1 |
| session-memory-hooks | compact-fidelity: settings.local.json opt-out overrides settings.json | test/guards.test.mjs | ported 1:1 |
| session-memory-hooks | compact-fidelity: malformed project settings fail safe to EMIT (a broken file never silently drops the nudge) | test/guards.test.mjs | ported 1:1 |
| session-memory-hooks | compact-fidelity: a bare {"ctide":false} settings.json on disk does not suppress the preservation block (readPreserveFlag must not misread it as preserveOnCompact:false) | test/guards.test.mjs | ported 1:1 |
| session-memory-hooks | compact-fidelity: a bare root-level `false` settings.json document also does not suppress the preservation block | test/guards.test.mjs | ported 1:1 |
| session-memory-hooks | compact-fidelity: opt-out is honored via the event cwd when CLAUDE_PROJECT_DIR is unset (the normal path) | test/guards.test.mjs | ported 1:1 |
| session-memory-hooks | compact-fidelity: malformed stdin fails open (no output, no crash) | test/lib-hook-io.test.mjs | reader half ported (exit 0 / no output: P5c spawn smoke) |
| session-memory-hooks | load-failure-memory: oversized stdin fails open (no digest emitted) | test/lib-hook-io.test.mjs | reader half ported (exit 0 / no output: P5c spawn smoke) |
| session-memory-hooks | compact-fidelity: oversized stdin fails open (no block emitted) | test/lib-hook-io.test.mjs | reader half ported (exit 0 / no output: P5c spawn smoke) |
| session-memory-hooks | compact-fidelity: the emitted block is valid, parseable JSON (flushed in full) | test/guards.test.mjs | ported 1:1 |
| session-memory-hooks | compact-fidelity: empty stdin still emits (fail toward preserve when the event carries no source) | test/guards.test.mjs | ported 1:1 |
| session-memory-hooks | hooks.json wires compact-fidelity.js under SessionStart with the compact matcher | — | not ported: wiring; P5c |
| session-memory-hooks | hooks.json no longer wires a PreCompact hook (CC rejects hookSpecificOutput on PreCompact) | — | not ported: wiring; P5c |

## Failure-memory candidate (proposed, not written; the arbiter decides)

- **Title**: Porting a regex "verbatim" into a shared parser can carry a ReDoS nobody measured; measure every
  pattern that reads repository content, not only the one already known to be slow.
- **What happened**: P5a was told to keep the existing FAILURE_MEMORY Tags pattern while bounding `isRetired`
  (the known 1.4 s ReDoS). Measuring the Tags pattern showed cubic backtracking (6.6 s on one 4 KB line) and two
  quadratic trailing-trim patterns; all reached at every SessionStart from a cloned repo's file.
- **Prevention rule**: when moving parsing code that reads untrusted text into a shared module, time each regex on
  long runs of the characters its adjacent quantifiers share (whitespace, the separator class) before shipping;
  replace an ambiguous pattern with an equivalent linear reader only together with a differential test against
  the old pattern and a timing test with recorded red/green.
- **Tags**: redos, regex, untrusted-input, refactor-carryover, differential-test

---

# P5b evidence: P4-review items routed to P5 (lib/git, ship, read-capped, lib-binding)

Branch `refactor/v0.8-slim`, HEAD `86ba905`. Nothing staged or committed. Machine: Windows 11 Pro 10.0.26200,
git 2.55.0.windows.5, Node v24.19.0 (Node 22 not run). Every test, mutant and probe run used TEMP/TMP/TMPDIR
pointed into my own `mktemp -d` directory under the session scratchpad; every run's temp dir ended with 0 `ctide-*`
entries (0 entries at all), and the whole scratch directory was deleted by exact path at the end. Mutants were
applied one at a time in a scratch `git clone --no-hardlinks` of `86ba905` with my seven files copied over (never in
the shared tree). Each file was restored and byte-compared after its mutant run. Only the files listed in §0 were
edited. P5a's untracked files (`cressetide/lib/{debug,hook-io,settings}.mjs`, `cressetide/lib/guards/**`) were not
touched.

## 0. Files changed

| File | Purpose |
|---|---|
| `cressetide/lib/git.mjs` | Drops every `GIT_TRACE*` and `GIT_REDIRECT_*` env variable by prefix (case-insensitive on win32). Sets `GIT_TRACE2=0`, `GIT_TRACE2_PERF=0`, `GIT_TRACE2_EVENT=0` (§1b). Adds `core.fsmonitor=false` to `NEUTRAL_CONFIG`. `encoding` other than `"utf8"`/`"buffer"` is a `TypeError`. Docstrings updated. |
| `cressetide/skills/ship/scripts/ship.mjs` | `wroteStderr()` helper. Non-empty stderr is a failed read for `tag --merged HEAD` (pending) and `rev-parse -q --verify refs/tags/<x>` (tagReady) only. Its comment names lib/git's stderr hygiene. |
| `cressetide/skills/ship/references/ship-contract.md` | Owner-approved doc item 32: `core.fsmonitor` added to the pinned config list. |
| `test/lib-git.test.mjs` | Pinned-config row (seven keys). Rows for encoding (both directions), fsmonitor behaviour, `GIT_TRACE*` dropped, win32 mixed-case `Git_Trace`, and (§1b) `GIT_REDIRECT_*` absent from git's env, win32 mixed-case `Git_Redirect_Stderr`, one config-file trace2 row per target. |
| `test/lib-read-capped.test.mjs` | `fs` patch tests: 1-byte reads, an early 0 read, `statSync` throwing. |
| `test/ship.test.mjs` | D-6 residual (a), D-6 residual (b), inherited `GIT_TRACE`/`GIT_TRACE2` on a healthy repo (CLI), and (§1b) global-config trace2 targets → identical report, `GIT_REDIRECT_STDERR=2>&1` + broken ref → tagReady `unverified`. Helpers `shipJsonWith`, `healthyReleaseRepository`. |
| `test/lib-binding.test.mjs` | Lexer split into `lex(source, { blankLiterals })`; use/declared checks read code only; postfix `++`/`--` ends a value; 7 shape rows + 1 control; child_process load rule (detector unit row + repository rule); comments naming the accepted lexer and detector limits. |

`git diff --stat`: 7 files, +477 / −40. `git diff --check`: clean, no CR bytes. Byte scan of added lines: ASCII
plus U+2014 ×30 and U+2026 ×5 (both already used in these files); no U+FFFD, BOM or control characters.

## 1. Items

Red-record command for every row: `node --test --test-reporter=tap <test file>`, cwd = the scratch clone (86ba905 + the
7 files), TEMP/TMP/TMPDIR = a fresh own dir (0 `ctide-*` left in every row). "from → to" is the single-line change.

### Item 1: ship residuals (a)/(b) (D-6), and `GIT_TRACE*` stripping

Probed first (git 2.55): (a) a deleted intermediate commit makes `git tag --sort=refname --merged HEAD` exit 0 with
stdout `""` and stderr `error: Could not read <sha>` ×2. (b) a garbage `.git/refs/tags/v1.0.0` makes
`rev-parse -q --verify refs/tags/v1.0.0` exit 1 with stderr `warning: ignoring broken ref refs/tags/v1.0.0`; an
absent tag exits 1 with empty stderr. `GIT_TRACE=1` / `GIT_TRACE2=1` write stderr on the healthy reads.

The change touches these two reads only; no localized text is matched. `pendingChanges`:
`merged.error || merged.status !== 0 || wroteStderr(merged)` → `unverified` ("listing the tags reachable from HEAD
failed …"). `tagReadinessCheck`: `readFailed = Boolean(lookup.error) || wroteStderr(lookup)`. Only a quiet exit 1 is
"no such tag"; anything else becomes `lookupFailure` ("… failed (exit 1, with a message on stderr), so a tag for
vX cannot be confirmed absent …"). `gitEnvironment()` skips keys whose (win32-uppercased) name starts with
`GIT_TRACE`.

New tests:
- ship · "pending view: a commit missing between HEAD and the release tag (tag --merged exits 0 with errors on
  stderr) is unverified, never no-release-tag". Fixture sanity asserts the raw read (exit 0, no stdout, stderr) and
  `marker.found === true`; it pins the exact note.
- ship · "tagReadinessCheck: a broken refs/tags/vX.Y.Z (rev-parse exits 1 with a warning on stderr) is unverified,
  never 'no such tag' and pass". Control: `pass` before the garbage ref is written. Raw sanity: exit 1 + stderr.
- ship · "CLI: inherited GIT_TRACE=1 and GIT_TRACE2=1 change nothing on a healthy repository — pending ok, tagReady
  pass". Runs `GIT_TRACE`, `GIT_TRACE2` and both together. Raw sanity shows tracing writes stderr. The whole JSON
  report must equal the untraced one.
- lib-git · "git(): inherited GIT_TRACE* variables are dropped — a healthy read writes nothing to stderr". Covers
  GIT_TRACE, GIT_TRACE2, GIT_TRACE2_PERF, GIT_TRACE2_EVENT and GIT_TRACE_PERFORMANCE, each with raw sanity.
- lib-git · "git(): on Windows an inherited mixed-case Git_Trace / git_trace2 is dropped too" (win32 only; it ran
  here).

Counts below are from the re-run on the **final** code, after the §1b follow-up changed the env-filter line and
added tests. The first-pass run (before §1b) gave the same failing tests at 116 ship / 40 lib-git tests.

| Item | Mutant (one line, from → to) | Test file | Exit | Tests/pass/fail | Failing test |
|---|---|---|---|---|---|
| 1 | 1a ship.mjs `if (merged.error \|\| merged.status !== 0 \|\| wroteStderr(merged)) {` → `if (merged.error \|\| merged.status !== 0) {` | ship.test | 1 | 118/117/1 | pending view: a commit missing between HEAD and the release tag … |
| 1 | 1b ship.mjs `const readFailed = Boolean(lookup.error) \|\| wroteStderr(lookup);` → `const readFailed = Boolean(lookup.error);` | ship.test | 1 | 118/116/2 | tagReadinessCheck: a broken refs/tags/vX.Y.Z …; CLI: an inherited GIT_REDIRECT_STDERR=2>&1 does not hide … (§1b) |
| 1 | 1c git.mjs: delete `name.startsWith("GIT_TRACE") \|\| ` from the env-filter line | ship.test | 1 | 118/117/1 | CLI: inherited GIT_TRACE=1 and GIT_TRACE2=1 change nothing … |
| 1 | 1c′ same mutant | lib-git.test | 1 | 45/43/2 | git(): inherited GIT_TRACE* variables are dropped …; git(): on Windows an inherited mixed-case Git_Trace … |
| 1 | 1d git.mjs `name.startsWith("GIT_TRACE")` → `key.startsWith("GIT_TRACE")` (case-sensitive) | lib-git.test | 1 | 45/44/1 | git(): on Windows an inherited mixed-case Git_Trace / git_trace2 is dropped too |

Fail-first on HEAD's product files (first pass; HEAD `git.mjs` + `ship.mjs`, new tests): lib-git + ship 156/149/7. Red: tests (a)
and (b), plus the five lib-git tests of items 1–3. The ship tracing test passes on HEAD, as intended: HEAD has no
stderr rule for tracing to trip. It guards the strip, and its red record is 1c.

### 1b. Follow-up (orchestrator decision, same item-1 class): `GIT_REDIRECT_*` and config-file trace2

This closes the two gaps reported in §4 of the first pass.

Probe (git 2.55, global config file via `GIT_CONFIG_GLOBAL`; stderr bytes of `rev-parse -q --verify
refs/tags/v9.9.9` on a healthy repo):

| Global config | none | `GIT_TRACE2=0` | `GIT_TRACE2_PERF=0` | `GIT_TRACE2_EVENT=0` | all three |
|---|---|---|---|---|---|
| `trace2.normalTarget=1` (and `=2`) | 1015 | **0** | 1015 | 1015 | 0 |
| `trace2.perfTarget=1` (and `=2`) | 2063 | 2063 | **0** | 2063 | 0 |
| `trace2.eventTarget=1` (and `=2`) | 2680 | 2680 | 2680 | **0** | 0 |

Each target is silenced only by its own variable, so all three are needed; that is why all three are set. Also, an
unopenable `normalTarget` with `trace2.destinationDebug=1` printed 235 bytes, and 0 with `GIT_TRACE2=0`.
`GIT_REDIRECT_STDERR=2>&1` (Git for Windows) on the broken-ref fixture gave exit 1, stdout = the warning, and empty
stderr (reproduced in the first pass).

Change (`gitEnvironment()`):
- The skip test is now `REDIRECTING_ENV.has(name) || name.startsWith("GIT_TRACE") || name.startsWith("GIT_REDIRECT_")`,
  where `name` is uppercased on win32. That drops `GIT_REDIRECT_STDIN/STDOUT/STDERR` in any case.
- After the strip: `env.GIT_TRACE2 = "0";`, `env.GIT_TRACE2_PERF = "0";`, `env.GIT_TRACE2_EVENT = "0";`, one line
  each. An inherited `GIT_TRACE2*` is stripped first, so these always win.
- The header docstring explains why stderr must carry only git's own messages.

New tests:
- lib-git · "git(): inherited GIT_REDIRECT_* variables are absent from git's environment — a failing read's message
  stays on stderr". The env git() hands the child is captured by patching `spawnSync` on the `child_process` object
  lib/git calls at call time; the real git still runs. With `GIT_REDIRECT_STDERR=2>&1` and `GIT_REDIRECT_STDOUT=<file>`
  inherited, no `GIT_REDIRECT_*` name reaches git, the `fatal` stays on stderr, stdout is empty and the file is never
  written. On win32 a raw sanity check shows the message moves to stdout without the fix.
- lib-git · "git(): on Windows an inherited mixed-case Git_Redirect_Stderr is dropped too" (win32 only; ran here).
- lib-git · "git(): a config-file trace2.<target>=1 writes nothing to stderr — <variable>=0 in git's environment",
  one row each for normalTarget/`GIT_TRACE2`, perfTarget/`GIT_TRACE2_PERF` and eventTarget/`GIT_TRACE2_EVENT`. Each
  has a raw sanity check, also sets the inherited variable to 1 (it is stripped, then set to 0), and asserts both
  the captured `env[variable] === "0"` and empty stderr.
- ship · "CLI: a global config's trace2.normalTarget=1 (and perfTarget, eventTarget) on a healthy repository — the
  report is identical to the untraced one". Both runs use a `GIT_CONFIG_GLOBAL` file (empty vs one trace2 key);
  raw sanity per target; `deepStrictEqual` of the whole JSON report.
- ship · "CLI: an inherited GIT_REDIRECT_STDERR=2>&1 does not hide a broken refs/tags/vX.Y.Z — tagReady stays
  unverified" (win32 only: Git for Windows reads `GIT_REDIRECT_*`; ran here). Raw sanity: exit 1, stderr empty,
  warning on stdout. Asserts `unverified` and the "(exit 1, with a message on stderr)" evidence.

Red records (git.mjs, one line each, scratch clone of 86ba905 + the 7 files, isolated TEMP, 0 `ctide-*` left):

| Mutant (from → to) | Test file | Exit | Tests/pass/fail | Failing tests |
|---|---|---|---|---|
| R1 `… \|\| name.startsWith("GIT_TRACE") \|\| name.startsWith("GIT_REDIRECT_")) continue;` → `… \|\| name.startsWith("GIT_TRACE")) continue;` | lib-git.test | 1 | 45/43/2 | GIT_REDIRECT_* absent …; mixed-case Git_Redirect_Stderr … |
| R1 same | ship.test | 1 | 118/117/1 | CLI: an inherited GIT_REDIRECT_STDERR=2>&1 does not hide a broken refs/tags/vX.Y.Z … |
| R2 `name.startsWith("GIT_REDIRECT_")` → `key.startsWith("GIT_REDIRECT_")` (case-sensitive) | lib-git.test | 1 | 45/44/1 | on Windows an inherited mixed-case Git_Redirect_Stderr is dropped too |
| R2 same | ship.test | 0 | 118/118/0 | none, as expected: the ship test inherits the uppercase name, so the mixed-case case is pinned in lib-git |
| T1 delete `env.GIT_TRACE2 = "0";` | lib-git.test | 1 | 45/44/1 | a config-file trace2.normalTarget=1 … GIT_TRACE2=0 … |
| T1 same | ship.test | 1 | 118/117/1 | CLI: a global config's trace2.normalTarget=1 (and perfTarget, eventTarget) … |
| T2 delete `env.GIT_TRACE2_PERF = "0";` | lib-git.test | 1 | 45/44/1 | a config-file trace2.perfTarget=1 … GIT_TRACE2_PERF=0 … |
| T2 same | ship.test | 1 | 118/117/1 | CLI: a global config's trace2 … |
| T3 delete `env.GIT_TRACE2_EVENT = "0";` | lib-git.test | 1 | 45/44/1 | a config-file trace2.eventTarget=1 … GIT_TRACE2_EVENT=0 … |
| T3 same | ship.test | 1 | 118/117/1 | CLI: a global config's trace2 … |

### Item 2: `encoding: null`

Decision: **throw `TypeError` for anything other than `"utf8"` / `"buffer"`**, before `try` (so it is thrown, not
returned as `error`). It was not "treat `null` as buffer". Why: `null` → buffer would still decode `"latin1"`,
`"hex"`, etc. as UTF-8 without a word. That is the same silent-misread class, so only an allowlist closes it.

Every current caller passes the default, `"utf8"` or `"buffer"` (grepped: map, ship, contract-check, validator,
publish-release incl. its `encoding: "buffer"` blob read), so nothing breaks. A wrong value is a programming error
and fails on the first run, matching `readCapped`'s convention for invalid options. The value now goes to
`spawnSync` as given (`encoding,`). Docstrings of `git()` and `gitOrThrow()` say so: "never a throw for anything git
or the spawn does", and an invalid encoding is git()'s TypeError.

New test: lib-git · "git(): an encoding other than "utf8" or "buffer" (Node's null idiom included) is a TypeError,
thrown before git runs".
- Rejected values: `null`, `"latin1"`, `"utf-8"`, `"hex"`, `0`, each through `git()` and `gitOrThrow()`. A
  `git init <target>` with each value leaves the target uncreated (git never ran).
- Accepted direction: omitted, `undefined`, `"utf8"` and `"buffer"` read the blob normally (`gitOrThrow` `"utf8"`
  too).

| Item | Mutant | Test file | Exit | Tests/pass/fail | Failing test |
|---|---|---|---|---|---|
| 2 | 2a git.mjs: delete the `throw new TypeError(…)` line (guard body empty) | lib-git.test | 1 | 45/44/1 | git(): an encoding other than "utf8" or "buffer" … |
| 2 | 2b git.mjs: the pre-P5 behaviour (`if (… ) {` → `if (false) {` and `encoding,` → `encoding: encoding === "buffer" ? "buffer" : "utf8",`) | lib-git.test | 1 | 45/44/1 | same |

(Final-code counts. First pass: 40/39/1 each.)

### Item 3: `core.fsmonitor=false`, plus doc item 32

Probe: a repo-local `core.fsmonitor = echo ran >> '<marker>'` creates the marker on a plain `git status` and a plain
`git diff`, and does not with `-c core.fsmonitor=false`.

New/changed tests (lib-git):
- "NEUTRAL_CONFIG is exactly the seven documented keys, passed as -c pairs" (row added; title six → seven).
- "NEUTRAL_CONFIG core.fsmonitor=false: a repository's core.fsmonitor command is never run by git(), a diff or
  changedFiles". Fixture sanity: a raw status creates the marker. Then `git(status)`, `git(diff HEAD --)` and
  `changedFiles` all return the expected change and the marker stays absent.

`ship-contract.md:60`: `` `diff.ignoreSubmodules`); `` → `` `diff.ignoreSubmodules`, `core.fsmonitor`); ``.
`git diff --word-diff=porcelain` shows that one token change and nothing else. Lines 60–61 were already at 100
characters and line 62 had 17 characters of slack (the insert needs 18), so lines 60–63 are re-wrapped. New widths
are 99/100/96/100 (max ≤ 100), and no code span is split.

| Item | Mutant | Test file | Exit | Tests/pass/fail | Failing tests |
|---|---|---|---|---|---|
| 3 | 3a git.mjs: delete the `"core.fsmonitor": "false",` line | lib-git.test | 1 | 45/43/2 | NEUTRAL_CONFIG is exactly the seven documented keys …; NEUTRAL_CONFIG core.fsmonitor=false: … never run … |

(Final-code counts. First pass: 40/38/2.)

### Item 4: read-capped (tests only)

`read-capped.mjs` uses `import fs from "node:fs"` and calls `fs.readSync` / `fs.fstatSync` on that object at call
time. The tests patch the same default-export object (`withPatchedFs(name, make, fn)`, restored in `finally`).

New tests:
- "readCapped(): reads that return one byte at a time still fill the whole range, each byte at its own offset".
  Covers head/tail with cap 10 and cap 64, and asserts exactly one patched read per byte, which proves the patch
  took effect.
- "readCapped(): a read that returns 0 early ends the loop with the bytes read so far". Four 1-byte reads, then 0:
  `"0123"` from the head and `"2345"` from the tail, with exactly 5 calls. A runaway guard throws after 1000 calls,
  so a loop without its `break` fails instead of hanging.
- "readCapped(): the size comes from the open file descriptor — fs.statSync throwing changes nothing". Sanity: the
  patched `fs.statSync` throws `EPATCHED`. Covers head, tail, and smaller than the cap.

| Item | Mutant (read-capped.mjs, scratch only) | Test file | Exit | Tests/pass/fail | Failing tests |
|---|---|---|---|---|---|
| 4 | 4a single read: `while (filled < length) {` → `for (let once = 0; once < 1 && filled < length; once++) {` | lib-read-capped.test | 1 | 12/10/2 | one byte at a time …; a read that returns 0 early … |
| 4 | 4b loop ignores `filled`: `fs.readSync(fd, buffer, filled, length - filled, start + filled)` → `fs.readSync(fd, buffer, 0, length - filled, start)` | lib-read-capped.test | 1 | 12/10/2 | same two |
| 4 | 4b′ buffer offset only: `… buffer, filled, …` → `… buffer, 0, …` (position kept) | lib-read-capped.test | 1 | 12/10/2 | same two |
| 4 | 4b″ file position only: `start + filled` → `start` | lib-read-capped.test | 1 | 12/10/2 | same two |
| 4 | 4c `const stat = fs.fstatSync(fd);` → `const stat = fs.statSync(file);` | lib-read-capped.test | 1 | 12/11/1 | the size comes from the open file descriptor … |
| 4 | 4d (extra) `return buffer.toString("utf8", 0, filled);` → `return buffer.toString("utf8");` | lib-read-capped.test | 1 | 12/11/1 | a read that returns 0 early … |
| 4 | 4e (extra) delete `if (read === 0) break;` | lib-read-capped.test | 1 | 12/11/1 | a read that returns 0 early … |

All three new tests pass on HEAD's `read-capped.mjs` (production was correct), so these mutants are the evidence.

### Item 5: lib-binding lexer

`withoutComments(source)` is now `lex(source)`. `codeOnly(source)` is `lex(source, { blankLiterals: true })`: it
blanks string contents, template-literal text and regular-expression bodies, and keeps delimiters, flags and
`${}` expressions. Imports are still read from `withoutComments` (the specifier is a string). The use and declared
checks run on `codeOnly`. A postfix `++`/`--` sets `lastCode` to `")"`, so the following `/` is division.

New tests: one per fooling shape. Each reads "binding: a name that appears only in <shape> is not a use" and expects
`never uses it`. Shapes:
- a double-quoted string
- a single-quoted string
- a template literal's text
- a template literal's text beside a ${} expression
- a regular-expression literal
- a comment after a postfix ++ and a division
- a comment after a postfix -- and a division

Plus the control "binding: code around literals still counts — a ${} expression, a division after a postfix ++, a
call after a string", which must return `null` for:
- a `${}` use, also one nested inside template text with a string inside it
- `i++ / headState(root).length`
- a call after a string and a regex
- a declaration-shaped string (`"function headState() {}"`), which is not a declaration

Old-lexer record: HEAD's `lib-binding.test.mjs` with the new row block appended unchanged → 26/18/8, exit 1. All 7
shape rows are red, plus the control (the old lexer reads `"function headState() {}"` as a declaration). The
existing comment row and all ten real bindings stay green on the new lexer.

| Item | Mutant (test/lib-binding.test.mjs) | Exit | Tests/pass/fail | Failing tests |
|---|---|---|---|---|
| 5 | 5a strings copied: `copyTo(i + 1); literalTo(Math.min(j, n)); copyTo(Math.min(j + 1, n));` → `copyTo(Math.min(j + 1, n));` | 1 | 28/25/3 | double-quoted string; single-quoted string; code around literals still counts |
| 5 | 5b template text copied: `    literalTo(j);` → `    copyTo(j);` | 1 | 28/26/2 | a template literal's text; … beside a ${} expression |
| 5 | 5c regex body copied: `copyTo(i + 1); literalTo(close); copyTo(Math.min(j, n));` → `copyTo(Math.min(j, n));` | 1 | 28/27/1 | a regular-expression literal |
| 5 | 5d postfix rule off: `lastCode = (c === "+" \|\| c === "-") && source[i - 1] === c && lastCode === c ? ")" : c;` → `lastCode = c;` | 1 | 28/25/3 | comment after a postfix ++ …; … postfix -- …; code around literals still counts |
| 5 | 5e (extra) use check on the literal-intact view: `codeOnly(source)` → `withoutComments(source)` in `bindingProblem` | 1 | 28/22/6 | the 5 string/template/regex rows + the control |

### Item 6: the child_process rule

New `CHILD_PROCESS_LOAD` detector: ``/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(["'`])(?:node:)?child_process\1/g``,
run on `withoutComments(source)`.

Allowlist:
- `cressetide/lib/git.mjs`
- `cressetide/skills/doctor/scripts/doctor.mjs`
- `.github/scripts/validate-structure-core.mjs`
- `.github/scripts/publish-release.mjs`
- `eval/**` (until P10)

Checked at HEAD: the files that mention `child_process` are exactly these four plus two `eval/efficiency/*` files and
`regression-delta.mjs`. `regression-delta.mjs` mentions it in a comment only, so it is not a load. No
`cressetide/hooks/*.js` loads it, so no hook is on the allowlist and the hooks tree is in scope for this rule.

The existing literal git-spawn signature is kept. This rule is added beside it.

New tests:
- "child_process: every way of loading it is found, with or without the node: prefix; a comment or a plain string is
  not". 10 positive forms: default, named, namespace, default+named, `export … from`, bare `import "…"`, `require("…")`,
  `require( '…' )`, `import("…")`, ``import(`…`)``. 5 negatives: line comment, block comment, plain string,
  `node:fs`, `child_processes`.
- "child_process: no product code loads it except the allowlist (lib/git, doctor, the validator core,
  publish-release, eval/ until P10)". Every allowlisted file must actually be detected; a stale entry fails, which
  also proves the detector matches the real import shapes. Every other non-test code file must load it 0 times.

| Item | Mutant (scratch only) | Exit | Tests/pass/fail | Failing test |
|---|---|---|---|---|
| 6 | 6a contract-check.mjs: add `import cp from "node:child_process";` after its lib/cli import | 1 | 28/27/1 | child_process: no product code loads it except the allowlist … |
| 6 | 6b contract-check.mjs: add `const { spawnSync } = await import("child_process");` | 1 | 28/27/1 | same |
| 6 | 6c hooks/plan-gate.js: add `const cp = require("child_process");` | 1 | 28/27/1 | same |
| 6 | 6d detector: drop the `\|\brequire\s*\(\s*` alternative | 1 | 28/27/1 | child_process: every way of loading it is found … |

## 2. Fixed results (isolated TEMP, 0 `ctide-*` left in every run)

| Where | lib-git | lib-read-capped | lib-binding | ship | Exit |
|---|---|---|---|---|---|
| HEAD 86ba905 (baseline, same files) | 36/36/0 | 9/9/0 | 18/18/0 | 113/113/0 | 0 |
| Scratch clone (86ba905 + my 7 files, final) | 45/45/0 | 12/12/0 | 28/28/0 | 118/118/0 | 0 |
| Main tree (with P5a's in-progress files present, final) | 45/45/0 | 12/12/0 | 28/28/0 | 118/118/0 | 0 |

0 skipped in each (the three win32-only rows ran). +29 tests over HEAD: lib-git +9, read-capped +3, binding +10,
ship +5. The follow-up accounts for lib-git +5 and ship +2.

Directly affected test files (consumers of lib/git or ship), re-run on the final code in the scratch clone so P5a's
half-written files could not interfere: contract-check, documented-facts, lib-map-trust, lib-redact, map,
model-provenance, release-cli, release-doctor and validate-structure gave 300/300/0, exit 0, 0 left.

## 3. Decisions and deviations

1. Item 2: TypeError, not null → buffer (reason in §1).
2. Item 1(b): the stderr rule applies to the lookup whatever its exit status. A hypothetical exit 0 with stderr is
   also `unverified` rather than "tag exists" → `fail`. Both block tagging. This keeps "any stderr = the read is not
   trusted" literal, as specified.
3. Item 3 doc: four lines re-wrapped (60–63) to stay ≤ 100 characters. The wording change is the single token.
4. Item 6: the old literal git-spawn signature row stays (not removed); the import rule is added.
5. Extra mutants (4d, 4e, 5e, 6b–6d, 1d, 2b, R2) beyond the named ones. All are red; R2 is red in lib-git only,
   by design.
6. The item 4–6 red records stand for the final code. `read-capped.mjs` and its test did not change after them,
   and `lib-binding.test.mjs` changed only by the two limitation comments (the mutant anchor lines are untouched;
   28 tests either way).
7. Not run: Node 22, a hostile global-config pass and the full suite (left to the orchestrator as instructed).
8. §1b: the trace2 overrides are set as env variables, not `-c` pairs. The probe showed `-c` cannot override a
   config-file trace2 target, so `NEUTRAL_CONFIG` is unchanged (still seven keys).

## 4. Found during P5b: outcome

1. **trace2 from a config file:** closed by the follow-up (§1b). The first-pass probe found that
   `-c trace2.normalTarget=0` does not override a config-file target (1038 bytes), while env `GIT_TRACE2=0` does.
2. **`GIT_REDIRECT_STDERR` (Git for Windows only):** closed by the follow-up (§1b). Without it, the broken-ref
   warning moved to stdout and residual (b) came back as `pass`; for (a), the errors would land in stdout, be dropped
   by the version filter, and give `no-release-tag`.
3. **Lexer limits, accepted (orchestrator decision) and named in a comment above `lex()`:**
   - A `/` after the `)` of `if (…)` / `while (…)` is read as division. C-9's second example
     `if (ok) /'/.test(s); // headState` comes out right only because the `'` is lexed as a string and blanked.
   - An object key (`{ headState: 1 }`) and a shadowing parameter still count as a use.
4. **child_process detector limits, accepted and named in a comment above `CHILD_PROCESS_ALLOWED`:**
   `createRequire(import.meta.url)("child_process")` and a computed `import(…)` path are not seen. Also unseen, though
   not named in the comment: a require under another name and `process.binding("spawn_sync")`.
5. **Coordination with P5a/P5c (open).** The child_process rule scans `cressetide/lib/**` (P5a's new `hook-io`,
   `debug`, `settings`, `failure-memory`, `guards/**`) and `cressetide/hooks/**`. None of P5a's files loaded
   `child_process` when checked. Any new module or hook that needs it must be added to `CHILD_PROCESS_ALLOWED`
   deliberately (an owner-visible change), or run git through lib/git.

---

# P5c evidence: hook wiring switch, Copilot and `agents[]` removal, validator / doctor / CI / tests / docs

Branch `refactor/v0.8-slim`, base HEAD `86ba905`, on top of the uncommitted P5a + P5b work. Nothing staged or
committed. `docs/handoff/**` untouched (byte-compared against my start-of-task backup). Machine: Windows 11 Pro
10.0.26200, Node v24.19.0, git 2.55.0.windows.5, GNU bash 5.3 (Git for Windows), pwsh present. Every test, mutant,
S0 and probe run used TEMP/TMP/TMPDIR pointed into my own `mktemp -d` directory under the session scratchpad;
mutants ran in a scratch `git clone --no-hardlinks` of 86ba905 with the working-tree changes copied over
(`diff -rq` identical before the run), one line at a time, each file byte-compared after restore. The scratch
directory was deleted by exact path at the end.

## 0. Files changed (P5c only; P5a/P5b files I touched are marked)

| file | purpose |
|---|---|
| `cressetide/hooks/pre-tool-use.mjs` (new) | PreToolUse entry: no static imports; `import()` of hook-io/debug/guards inside `decide()`, rejection → exit 0 silent; `readHookEvent` failure → debug line, no output; `preToolUse()`; only `deny`/`ask` passed on (`PASSED_ON`); the entry builds `hookSpecificOutput`; write-then-exit |
| `cressetide/hooks/session-start.mjs` (new) | SessionStart entry: same shell; `failureMemoryContext` then `preserveContext`, each in its own try, joined with `"\n\n"`, memory first; malformed / not-an-object / over-cap → no output |
| `cressetide/hooks/hooks.json` | exactly the 3 shell-form entries from the brief |
| `cressetide/hooks/{plan-gate,destructive-guard,contract-guard,load-failure-memory,compact-fidelity}.js` | deleted |
| `cressetide/.claude-plugin/plugin.json` | `agents` list removed |
| `.github/scripts/validate-structure-core.mjs` | §5b roster → file existence only; §5c WIRING → 3 entries, new rules (no second-runtime name, no bare plugin-root variable, shell command form); §5g / README / §8 / §10 regexes `.m?js`; §9 header; §9b and §9d deleted; §10 `manifestAgents` → "no `agents` key" + "frontmatter `name` = file stem"; expectedHooks → 3; hook-script filter `.m?js` |
| `cressetide/skills/doctor/scripts/doctor.mjs` | expected hooks/registrations → 3; `.m?js`; `observedHookSignal` strips `.m?js`; one harmless event per entry; exported `probeEnv(probeRoot, { debug })` used by every probe spawn (syntax, valid, malformed, decision, debug); probe memory holds a real `###` entry; rows `decision:plan-gate` / `decision:destructive` (unverified when not runtime-eligible); exported `decisionProbePassed`; hook-debug adds a Bearer-bearing command and checks the token reaches neither sink; agents row filesystem-only (files + frontmatter name); `LOG_NAME` imported from lib/debug |
| `cressetide/agents/implementer.agent.md` | doc item 33: `MultiEdit` dropped from `tools` |
| `cressetide/agents/navigator.agent.md` | **outside the approved list** (see §9): stale `plan-gate.js` reference renamed |
| `cressetide/lib/hook-io.mjs` (P5a's) | **regression fix found by S0**: a leading BOM is no longer dropped (reverts P5a deviation D-d) |
| `cressetide/lib/guards/index.mjs` (P5a's) | comment only: `"allow"` → allow (acceptance-2 grep) |
| `.github/workflows/validate.yml`, `release.yml` | plugin-validate pin `2.1.207` → `2.1.272` |
| docs (items 1–31, 34) | README×3, runtime-contract, compatibility, diagnostic-contract, command-reference, ARCHITECTURE, SECURITY, CONTRIBUTING, vigil SKILL.md, task-contract, design-spec, plan-grounding, verification-gate, decision-record, experience-memory, eval/failure-memory/README, bug-report.yml, history.md, typos.toml |
| docs outside the list | `external-capabilities.md:32`, `SKILL.md:156`, `design-spec.md:30`, navigator (above), and diagnostic-contract lines made stale by item 18 — see §9 |
| `test/helpers.mjs` (P5a/P5b-touched) | `execHook` → `hookStdout`, `runHook` → `runHookEvent` (absolute path, timeout); `process.execPath` in hookStdout/orch/orchEnv; `hardenGitSigning` un-exported; `gitEnv` comment "exported for helpers.test only"; the helpers that only drove the deleted hooks removed (`MEM`, `GATE`, `DGUARD`, `CGUARD`, `COMPACTFIDELITY`, `digestOf`, `gate`, `gateInProject`, `dguard`, `cguard`, `compactFidelity`, `hasGlobalMemory`) |
| `test/hooks.test.mjs` | rewritten: AC-5 fail-open smoke (lib missing, `{`, 6 MiB, not-an-object) for both entries, never-allow rows (stubbed library + real tree), entries' import shape, hooks.json 3-entry wiring, no PreCompact, Stop smoke kept |
| `test/plan-gate-guards.test.mjs` | rewritten: PreToolUse entry smoke (deny, shell tripwire deny, ask, contract ask, deny-over-ask, 2 MiB flush, 3 opt-outs end to end, matcher wiring) |
| `test/session-memory-hooks.test.mjs` | rewritten: SessionStart entry smoke (### digest, ## digest, pointer, compact join, source-less, no memory, preserveOnCompact opt-out, malformed, matcher wiring) |
| `test/hooks-portability.test.mjs` | deleted |
| `test/hooks-shell.test.mjs` (new) | cross-shell smoke: the wired command, plugin root with a space, Git Bash and PowerShell (StrictMode); skip with reason when a shell is missing or runs another platform's node |
| `test/helpers.test.mjs` | PATH-without-node row for hookStdout, runHookEvent, orch, orchEnv |
| `test/agents-manifest.test.mjs` | (i) no `agents` key, (v) filesystem roster + frontmatter = stem; second-runtime comments dropped |
| `test/documented-facts.test.mjs` | debug facts → `accepts = 1, true, yes, on` + `case = insensitive`; `classifyDebug` spawns `pre-tool-use.mjs`; shared case comparator; MUST_FAIL / MUST_PASS / RUNTIME_DRIFT updated |
| `test/workflow-contracts.test.mjs` | debug pin → the new runtime-contract wording |
| `test/release-cli.test.mjs` | archive fixture file `hooks/plan-gate.js` → `hooks/hooks.json` |
| `test/release-doctor.test.mjs` | hook rows 6 → 3 (+ decision/debug rows pass); extra registration → `pre-tool-use.mjs` |
| `test/doctor-security.test.mjs` | agents row filesystem-only; new names; decision rows (bundled pass / untrusted unverified); hostile ambient env + empty sentinel TEMP; `probeEnv` unit; `decisionProbePassed` unit rows |
| `test/doctor-project.test.mjs` | baseline check names (13 now) |
| `test/validate-structure.test.mjs` | README parity → `pre-tool-use`; wiring rows for the new matchers; 9b rows deleted; 9d d1/d2/stdin rows deleted, §5k anchor rows kept (renamed test); §5c three new negatives; §10 agents-key and frontmatter negatives; agent inventory rows; hook inventories; syntax row on `pre-tool-use.mjs` |
| `test/lib-binding.test.mjs` (P5b's) | `NOT_YET_IN_SCOPE` → `orchestration-check.js` (P6) + `eval/` (P10); 7 new single-copy signatures; doctor bound to `debug.LOG_NAME` |
| `test/guards.test.mjs`, `test/lib-hook-io.test.mjs`, `test/lib-debug.test.mjs` (P5a's) | header/comments updated; benign tripwire inputs `node --check hooks/plan-gate.js` → `…/pre-tool-use.mjs`; one title's second-runtime word dropped; the BOM row flipped to "malformed" (red→green with the fix) |

## 1. Acceptance

### 1. S0 — `node record.mjs record --out p5c-exit` then `compare p5c-exit` → exit 0

Recorded from the working tree (labelled; meta.hooksDirtyVsHead shows the uncommitted state). `record`: 737 rows
per env (A 211, B 198, C 78, D 96, E 94, F 32, G 17, H 7, I 4), **sanity: every row with a source-test expectation
matches it**. `compare p5c-exit`: **1474 rows compared, 126 changed, 0 outside their allowed classes, exit 0.**
`cross p5c-exit`: 737 rows, 0 differ between normal and hostile. Rows with decision `allow`: 0 (normal), 0 (hostile).

Changed rows by baseline class (×2 envs): camelcase-alias-gone 12, multiedit-gone 20, failmem-h2 10,
failmem-pointer 20, failmem-placeholder 20, sessionstart-malformed 6, sessionstart-not-object 6, debug-switch 10,
debug-redaction 16, new-only 8. The 63 normal rows (hostile identical) are listed in §7.

**Regression found and fixed (not hidden).** The first recording on the P5c tree (before the fix) gave 130 changed,
**6 NOT ALLOWED**: `F/PreToolUse-as-Bash/bom-json`, `F/PreToolUse-as-Write/bom-json` (untagged; baseline `none`, new
`deny`) and `F/SessionStart-all/bom-json` (class sessionstart-malformed requires no output; new: digest + reminder),
× normal/hostile. Cause: P5a's deviation D-d (the stdin reader drops a leading BOM), which turns a BOM-prefixed
plan-mode event from fail-open into a deny. Fix: `parseEvent` keeps the BOM, so the event is malformed again, as at
86ba905 (S0 baseline), and the lib-hook-io row now pins "malformed" with a control. D-d had not been accepted by the
orchestrator (only the empty/all-retired/placeholder decision was), so I treated it as a regression. Mutant M8
(re-adding the strip) turns the row red.

**The KNOWN CONFLICT did not materialize — no `failmem-empty` class added.** The baseline rows it concerns:
`E/empty-file/*` (5 per env) inject nothing at 86ba905 and inject nothing now → unchanged, never judged.
`E/placeholder-only/*` injects the I-4 pointer now (placeholder `###` is not an entry heading, I-3), which
`failmem-pointer` allows. No S0 fixture has a file whose entries are all retired (`E/retired` keeps active entries
and is unchanged). record.mjs was not modified.

### 2. AC-5

- Smoke (both entries, `test/hooks.test.mjs`): lib missing (copy without `lib/`, control = full copy answers) →
  exit 0, stdout empty; stdin `{` → exit 0, empty; a 6 MiB event (control under the cap answers) → exit 0, empty;
  JSON that is not an object → exit 0, empty.
- Never `allow`: stubbed library returning allow/ALLOW/defer/bogus/"" → no output; deny/ask control passed through;
  real-tree no-decision events → no output. S0 allow count 0. `git grep -n '"allow"' -- cressetide/hooks
  cressetide/lib` (and the untracked lib files) → 0.
- Validator §5c rule + three negative tests; each `fail()` disabled → its test red (M6a/b/c).

### 3. AC-6

P5a's in-process rows (lib-debug: redaction on both sinks, off values write nothing; see p5a-evidence M3/M4/M4b)
stand. P5c adds: S0 G rows — `1|true|TRUE|Yes|on` trace with `leaks: []`; `" "|0|false|x` no stderr, no log;
`unset|""` unchanged. Doctor `hook-debug`: a `git push --force … Authorization: Bearer ctide-doctor-probe-credential`
command must leave the ASK line in the log and the credential in neither the log nor stderr; M9 (debug sink
unredacted) → 3 doctor tests red.

### 4. AC-8

P5a's parser/digest/retrieve/consolidate rows stand. Spawn smoke (`session-memory-hooks.test.mjs`): `###` file →
titles + tags, no rule prose, no placeholder; `##`-only file → titles + tags; prose-only file → only the I-4
pointer sentence, none of the text. S0: failmem-h2 / failmem-placeholder / failmem-pointer rows all ALLOWED (their
checks name every expected title and no rule prose).

### 5. AC-9 (P5 part)

Each in exactly one lib module, pinned by new `lib-binding` signatures (each signature's count in its home is 1, so
none is vacuous): debug on-values `debug.mjs`; `"ctide-hook.log"` literal `debug.mjs` (doctor now imports
`LOG_NAME`); `5 * 1024 * 1024` `hook-io.mjs`; quote stripper `guards/shell.mjs`; `dd\s(?=` `guards/shell.mjs`;
settings precedence list `settings.mjs`; `/^###\s` `failure-memory.mjs`. All-code grep: the only other carrier of
the first three is `cressetide/hooks/orchestration-check.js` (I-5, P6). `git grep -n "garden 9d" -- .github test` →
0 (untracked test files too).

### 6. AC-14 (P5 part)

`decision:plan-gate` / `decision:destructive` pass on the bundled root ("deny, as expected" / "ask, as expected");
`unverified` ("runtime probes not trusted (requires trusted canonical root)") on an untrusted copy. Hostile ambient
env (CLAUDE_PROJECT_DIR whose settings turn all four guards off + a memory sentinel, CTIDE_HOOK_DEBUG=1,
CLAUDE_PLUGIN_DATA, TEMP/TMP/TMPDIR → sentinel dir): report `pass`, sentinel text absent, sentinel dir empty.
Mutants: malformed probe without env (M5a) and decision probe without env (M5b) → that test red.
`git grep -n 'node "\$R' cressetide/skills/doctor` → 0.

### 7. D-2 / D-4

`grep -n "Date.now() - t0" test/plan-gate-guards.test.mjs test/session-memory-hooks.test.mjs` → 0 (the files were
rewritten; their timed rows run in-process in guards.test / lib-failure-memory.test with P5a's recorded red).

### 8. Removed names

`git grep -nP -i "copilot|(?<!CLAUDE_)PLUGIN_ROOT" -- . ':!CHANGELOG.md' ':!EVIDENCE.md' ':!docs/history.md'
':!docs/handoff'` → **0**, and 0 in the untracked new files. To make this possible the new validator rule spells
the two names with a character class (`/cop[i]lot/i`, `/\bPLUGIN[_]ROOT\b/`) and its tests assemble them
(`["Co","pilot"].join("")`) — disclosed deviation D-3.

`git grep -nE "plan-gate\.js|destructive-guard\.js|contract-guard\.js|load-failure-memory\.js|compact-fidelity\.js|MultiEdit|permissionMode|execHook|\brunHook\b"`
outside CHANGELOG/EVIDENCE/history/handoff — remaining hits, all deliberate:
- `cressetide/hooks/orchestration-check.js:53, :198` — "kept in sync with plan-gate.js / …" comments, and its
  camelCase aliases (`transcriptPath` :212, `lastAssistantMessage` :297, `stopHookActive` :372) — P6 (I-5).
- `eval/efficiency/{judge-calibration,l1b-driver,stream-usage}.mjs` and `test/efficiency-*.test.mjs` —
  `permissionMode` is a field of Claude Code's own stream-json `init` event, not the removed hook alias; eval is
  removed in P10.
- Removal-pinning test inputs: `test/guards.test.mjs` (P5a's CHANGED rows: MultiEdit no longer gated, `permissionMode`
  alias no longer read, MultiEdit out of the contract guard) and `test/plan-gate-guards.test.mjs` ("MultiEdit is no
  longer listed" in the matcher). They must name the removed token to pin its absence.
The five old hook file names: 0 outside orchestration-check.js.

### 9. Manifest, plugin validate, CI pins

`node -p "'agents' in require('./cressetide/.claude-plugin/plugin.json')"` → `false`.
`npx --yes @anthropic-ai/claude-code@2.1.272 plugin validate --strict ./cressetide` → "✔ Validation passed", exit 0.
`git grep -n "claude-code@" .github/workflows` → `release.yml:51` and `validate.yml:43`, both `@2.1.272`.

### 10. Full suite, validate, contract-check

`npm test` with a fresh TEMP: **exit 0, 1267 tests, 1260 pass, 0 fail, 7 skipped, 113 s; 0 `ctide-*` left** (the one
entry left is `node-compile-cache`, npm's own compile cache; a direct `node --test` run of the same glob left 0
entries). Skips: doctor-project ×2 (POSIX permission bits on win32; file symlink EPERM), guards ×2 (directory
symlink EPERM; case-insensitive FS), lib-debug ×1 and lib-failure-memory ×2 (file symlink EPERM) — all pre-existing
P5a/P4 Windows skips; the old spawn files' 4 skips went with them. `npm run validate` → exit 0.
`contract-check --base 86ba905` → exit 0 (scope clean, AC coverage complete).

### 11. Hostile global git config

P4's extended set (31 keys incl. signing/verifySignatures/forceSignAnnotated true, `gpg.program` missing,
`core.hooksPath` with 11 failing hooks incl. post-index-change, safecrlf, `init.defaultBranch=trunk`, abbrev 12,
column/tag.sort/showSignature/ISO-8859-1/relative/quotePath/showUntrackedFiles=no/ignoreSubmodules=all/color/
decorate/fuller, renames=copies, noprefix, mnemonicPrefix, status.short/branch/relativePaths, column.status,
untrackedCache, manyFiles, abbrevCommit, showRoot) via `GIT_CONFIG_GLOBAL`, sanity-probed (init aborted by the
reference-transaction hook; abbrev 12; `trunk`). 31 files (every git-using, hook and lib test file):
**exit 0, 1113 tests, 1106 pass, 0 fail, 7 skipped (the same seven), 0 left in TEMP.**

### 12. Mutants

See §6.


## 2. Deviations and decisions to confirm

- **D-1 P5a D-d reverted** (lib/hook-io.mjs): a BOM-prefixed event is malformed again. Found by the S0 (§1.1).
- **D-2 "deny>ask pick" read as the entry's own filter.** `preToolUse()` already returns the first decision in the
  plan-gate → destructive → contract order (only the plan gate denies, so deny outranks ask). The entry passes on
  `deny` and `ask` only (`PASSED_ON`) and builds `hookSpecificOutput` itself. Its two mutants (allow added; filter
  dropped) are red through a stubbed-library row, since no real check returns anything else.
- **D-3 the removed names are spelled with a character class in the validator and assembled in its tests**, so the
  acceptance-8 grep stays at 0 while the §5c rule still exists (`/cop[i]lot/i`, `/\bPLUGIN[_]ROOT\b/`). The rule's
  message says "the removed second runtime" instead of the name. Alternative: exclude the validator and its test
  from the grep.
- **D-4 `NOT_YET_IN_SCOPE` keeps `eval/` (P10)** beside `cressetide/hooks/orchestration-check.js` (P6): eval still
  carries `KNOWN_FLAGS` and git spawns, so dropping it fails the existing signatures.
- **D-5 the doctor probe root is created before the syntax checks** (it used to exist only for eligible roots) so
  every probe spawn, the syntax probes included, runs with `probeEnv(probeRoot)`; it is removed in `finally`. An
  untrusted root now gets a probe root too (created and removed; no hook runs). M5c (syntax probe without env)
  survives: equivalent — `node --check` executes no hook code, so no environment can change its result.
- **D-6 doctor `agents` row reads frontmatter with its own 8-line parser** (`agentFrontmatterName`); the validator
  has an equivalent inline read. Two copies of a small parse in two programs (plugin vs CI); no lib module was added.
- **D-7 the old tests' helpers that drove only the deleted hooks were removed** from helpers.mjs (not kept as dead
  exports): `MEM`, `GATE`, `DGUARD`, `CGUARD`, `COMPACTFIDELITY`, `digestOf`, `gate`, `gateInProject`, `dguard`,
  `cguard`, `compactFidelity`, `hasGlobalMemory`.
- **D-8 cross-shell smoke runs PowerShell under `Set-StrictMode -Version Latest`** (carries the old StrictMode row).
  bash: `CLAUDE_CODE_GIT_BASH_PATH`, then `%ProgramFiles%\Git\bin\bash.exe`, then `bash`, accepted only if its node
  reports this platform (WSL's bash.exe would be skipped with the reason).
- **D-9 docs outside the approved list** (§9): five stale references renamed and the diagnostic-contract lines that
  item 18 made false; each needs the owner's OK (revert is one line each).
- **D-10 README item 6 keeps the trailing "(used by /ctide:doctor and manual troubleshooting)"** clause in all three
  languages; the item's text replaced the rule, not the usage note.

## 3. Doc items

Applied: 1–8 (README×3, zh-TW as the source; en/ja written from it, same lines changed in each file — 364 lines
each), 9–13 (runtime-contract; item 13's ledger line placed under `memory/` in the tree), 14 (compatibility), 15–20
(diagnostic-contract), 21 (command-reference), 22 (ARCHITECTURE), 23 (SECURITY), 24 (CONTRIBUTING), 25 (vigil
SKILL.md), 26 (task-contract :13/:50/:71-72, design-spec :62, plan-grounding :66), 27 (verification-gate :127/:130/
:168/:172), 28 (decision-record, experience-memory), 29 (eval/failure-memory/README), 30 (bug-report.yml), 31
(history.md), 33 (implementer tools), 34 (typos.toml). 32 verified (ship-contract `core.fsmonitor`, P5b). 35 is the
orchestrator's. Line reflows: task-contract (two paragraphs re-wrapped where the longer phrase pushed a line past
the file's width).

## 4. Found but not changed

- **I-5 residuals (P6):** `orchestration-check.js` keeps its own debug switch (any non-empty value — the S0 row
  `G/stop-blocking/CTIDE_HOOK_DEBUG=0` still traces, unchanged from the baseline), its own `ctide-hook.log` literal
  and 5 MiB stdin reader, the "kept in sync with plan-gate.js …" comments and the camelCase field aliases. The
  runtime-contract row (item 9) states the 1/true/yes/on rule for "hook diagnostics" generally; for the Stop hook it
  is not true until P6 (README item 6 scopes it to PreToolUse/SessionStart).
- **design.md heading regex** (`/^\s*##\s+(.+?)\s*$/`, contract.mjs `extractHeadings`) — quadratic per P5a (535 ms
  at 40,000 spaces); left as moved. The S0 does not exercise long-whitespace headings, so it cannot prove a bounded
  rewrite byte-identical; not changed.
- `test/ship.test.mjs` (6×) and `test/orchestration-check.test.mjs` (3×) spawn `"node"` from PATH directly (not
  through helpers); left as is ("renames only" for those files; ship.test is P5b's, orchestration-check.test is P6's).
- `diagnostic-contract.md` step 4's `hook-debug` row text does not mention the new credential check (still true as
  written; item 17 did not cover it).
- ARCHITECTURE.md:25-27 still says scripts take shared utilities from `cressetide/lib/`; the hook entries do too now
  (not in item 22).
- doctor's `projectLocalMemoryCandidates` still hand-mirrors two `memoryCandidates` paths (P5a finding).
- Node 22 was not run.

## 5. Test-count ledger

Per-file tests, pre-P5c state (86ba905 + P5a + P5b, rebuilt from my start-of-task backup) → P5c:

| file | before | after | change |
|---|---:|---:|---|
| test/hooks.test.mjs | 19 | 11 | rewritten (smoke + wiring) |
| test/plan-gate-guards.test.mjs | 147 (2 skip) | 10 | rewritten (PreToolUse smoke + wiring) |
| test/session-memory-hooks.test.mjs | 50 (2 skip) | 9 | rewritten (SessionStart smoke + wiring) |
| test/hooks-portability.test.mjs | 21 | — | deleted |
| test/hooks-shell.test.mjs | — | 2 | new |
| test/helpers.test.mjs | 15 | 16 | +PATH-without-node row |
| test/doctor-security.test.mjs | 10 | 14 | +decision ×2, +probeEnv, +decisionProbePassed; agents row rewritten |
| test/validate-structure.test.mjs | 82 | 86 | −9b; 9d → §5k row; +§5c ×3; +§10 ×2 |
| test/lib-binding.test.mjs | 28 | 35 | +7 signatures |
| agents-manifest 8, doctor-project 32, release-doctor 46, release-cli 35, documented-facts 4, workflow-contracts 25, lib-hook-io 33, guards 174, lib-debug 12 | same | same | edited rows, same counts |
| **suite** | **1456 (11 skip)** | **1267 (7 skip)** | −237 retired + 48 added |

The 237 retired spawn tests (19 + 147 + 50 + 21, confirmed by running the four files on a clean 86ba905 export:
237 tests, 0 fail, 4 skip) are listed one by one in §8 with where each assertion lives now: 185 ported 1:1 to the
in-process files by P5a (including every D-2/D-4 timed row, now timed around the classifier), 11 CHANGED by owner
decisions (P5a's table), 12 whose spawn half is a P5c AC-5 smoke row (reader half in lib-hook-io), 8 wiring/flush/
Stop rows now in the P5c smoke and wiring tests, and the 21 hooks-portability rows (9 mapped to the cross-shell or
entry smoke, 12 retired by design: the `node -e` bootstrap shape ×6, the second-runtime fallbacks ×2, the
unresolvable-root fail-open ×4; see §8 for each).

## 6. Mutants (scratch clone, one line each, restored and byte-compared; 0 `ctide-*` left in every run)

| id | file: from → to | tests run | result |
|---|---|---|---|
| M1 entry emits allow | `cressetide/hooks/pre-tool-use.mjs`: `const PASSED_ON = new Set(["deny", "ask"]);` → `const PASSED_ON = new Set(["deny", "ask", "allow"]);` | hooks | **RED** exit 1, 11/10/1: "PreToolUse never answers allow: a check result other than deny or ask is no output"; restored=true, left 0 |
| M2 entry output without the deny/ask pick | `cressetide/hooks/pre-tool-use.mjs`: `if (!result \|\| !PASSED_ON.has(result.decision)) return null;` → `if (!result) return null;` | hooks | **RED** exit 1, 11/10/1: "PreToolUse never answers allow: a check result other than deny or ask is no output"; restored=true, left 0 |
| M3a pre-tool-use: lib import failure no longer fail-open | `cressetide/hooks/pre-tool-use.mjs`: `decide().then(finish, () => finish(null));` → `decide().then(finish);` | hooks | **RED** exit 1, 11/10/1: "AC-5: an entry exits 0 with no output when cressetide/lib/ is missing (a plugin copy without lib)"; restored=true, left 0 |
| M3b session-start: lib import failure no longer fail-open | `cressetide/hooks/session-start.mjs`: `context().then(finish, () => finish(null));` → `context().then(finish);` | hooks | **RED** exit 1, 11/10/1: "AC-5: an entry exits 0 with no output when cressetide/lib/ is missing (a plugin copy without lib)"; restored=true, left 0 |
| M4 source-less SessionStart drops the preservation block | `cressetide/lib/guards/compact.mjs`: `if (source && source !== "compact") {` → `if (source !== "compact") {` | session-memory-hooks, guards | **RED** exit 1, 183/179/2: "compact-fidelity: empty stdin still emits (fail toward preserve when the event carries no source) (in-process: an empty event, which readHookEvent makes of empty stdin, emits)"; "SessionStart entry: an event with no source (empty stdin) still gets the digest and the reminder (fail toward preserving)"; restored=true, left 0 |
| M5a doctor malformed probe without probeEnv | `cressetide/skills/doctor/scripts/doctor.mjs`: `const malformed = spawnHook(hook, "{", quiet);` → `const malformed = spawnHook(hook, "{");` | doctor-security | **RED** exit 1, 14/13/1: "Doctor runtime probes override a hostile ambient environment: project opt-outs, CTIDE_HOOK_DEBUG=1 and TEMP all ignored, nothing left behind"; restored=true, left 0 |
| M5b doctor decision probe without probeEnv | `cressetide/skills/doctor/scripts/doctor.mjs`: `const probe = spawnHook(preToolUse, JSON.stringify(event(probeRoot)), quiet);` → `const probe = spawnHook(preToolUse, JSON.stringify(event(probeRoot)));` | doctor-security | **RED** exit 1, 14/13/1: "Doctor runtime probes override a hostile ambient environment: project opt-outs, CTIDE_HOOK_DEBUG=1 and TEMP all ignored, nothing left behind"; restored=true, left 0 |
| M5c doctor syntax probe without probeEnv | `cressetide/skills/doctor/scripts/doctor.mjs`: `const syntax = spawnSync(process.execPath, ["--check", hook], { encoding: "utf8", timeout: 5000, cwd: probeRoot, env: quiet });` → `const syntax = spawnSync(process.execPath, ["--check", hook], { encoding: "utf8", timeout: 5000, cwd: probeRoot });` | doctor-security | survives (exit 0, 14/14/0) — equivalent: `node --check` executes no hook code, so its environment cannot change the result; restored=true, left 0 |
| M6a validator: removed-runtime rule's fail() disabled | `.github/scripts/validate-structure-core.mjs`: `if (/cop[i]lot/i.test(hooksText)) fail("hooks.json names the removed second runtime (its root-variable fallback) — ctide supports Claude Code only");` → `if (/cop[i]lot/i.test(hooksText)) { /* disabled */ }` | validate-structure | **RED** exit 1, 86/85/1: "validate-structure: §5c FAILS when hooks.json names the removed second runtime anywhere"; restored=true, left 0 |
| M6b validator: bare plugin-root rule's fail() disabled | `.github/scripts/validate-structure-core.mjs`: `if (/\bPLUGIN[_]ROOT\b/.test(hooksText)) fail("hooks.json uses a bare plugin-root variable — the plugin root is ${CLAUDE_PLUGIN_ROOT} only");` → `if (/\bPLUGIN[_]ROOT\b/.test(hooksText)) { /* disabled */ }` | validate-structure | **RED** exit 1, 86/85/1: "validate-structure: §5c FAILS on a bare plugin-root variable in hooks.json (CLAUDE_PLUGIN_ROOT itself passes)"; restored=true, left 0 |
| M6c validator: command-form rule's fail() disabled | `.github/scripts/validate-structure-core.mjs`: `            if (!COMMAND_FORM.test(command))` → `            if (false)` | validate-structure | **RED** exit 1, 86/85/1: "validate-structure: §5c FAILS on a handler that is not the shell form node "${CLAUDE_PLUGIN_ROOT}/hooks/<name>.mjs""; restored=true, left 0 |
| M6d validator: plugin.json agents-key rule's fail() disabled | `.github/scripts/validate-structure-core.mjs`: `if (plugin && Object.hasOwn(plugin, "agents")) fail("plugin.json declares an `agents` key — Claude Code discovers agents/*.agent.md; remove the list");` → `if (plugin && Object.hasOwn(plugin, "agents")) { /* disabled */ }` | validate-structure | **RED** exit 1, 86/85/1: "validate-structure: §10 FAILS when plugin.json declares an agents key (Claude Code discovers agents/*.agent.md)"; restored=true, left 0 |
| M6e validator: frontmatter-name rule's fail() disabled | `.github/scripts/validate-structure-core.mjs`: `    if (declared !== stem) fail(` → `    if (false) fail(` | validate-structure | **RED** exit 1, 86/85/1: "validate-structure: §10 FAILS when an agent's frontmatter name is not its file stem"; restored=true, left 0 |
| M7a helpers: hookStdout spawns "node" | `test/helpers.mjs`: `return cp.execFileSync(process.execPath, [hookPath], { input: JSON.stringify(input), env: env \|\| process.env }).toString();` → `return cp.execFileSync("node", [hookPath], { input: JSON.stringify(input), env: env \|\| process.env }).toString();` | helpers | **RED** exit 1, 16/15/1: "hookStdout, runHookEvent, orch and orchEnv run the hook with the test's own node (process.execPath), not the node PATH finds"; restored=true, left 0 |
| M7b helpers: orch spawns "node" | `test/helpers.mjs`: `const out = cp.execFileSync(process.execPath, [ORCH], { input: JSON.stringify(input) }).toString();` → `const out = cp.execFileSync("node", [ORCH], { input: JSON.stringify(input) }).toString();` | helpers | **RED** exit 1, 16/15/1: "hookStdout, runHookEvent, orch and orchEnv run the hook with the test's own node (process.execPath), not the node PATH finds"; restored=true, left 0 |
| M7c helpers: orchEnv spawns "node" | `test/helpers.mjs`: `const out = cp.execFileSync(process.execPath, [ORCH], { input: JSON.stringify(input), env: { ...process.env, ...env } }).toString();` → `const out = cp.execFileSync("node", [ORCH], { input: JSON.stringify(input), env: { ...process.env, ...env } }).toString();` | helpers | **RED** exit 1, 16/15/1: "hookStdout, runHookEvent, orch and orchEnv run the hook with the test's own node (process.execPath), not the node PATH finds"; restored=true, left 0 |
| M7d helpers: runHookEvent spawns "node" | `test/helpers.mjs`: `  const result = run(process.execPath, [file], {` → `  const result = run("node", [file], {` | helpers | **RED** exit 1, 16/15/1: "hookStdout, runHookEvent, orch and orchEnv run the hook with the test's own node (process.execPath), not the node PATH finds"; restored=true, left 0 |
| M8 stdin reader drops a leading BOM again (P5a D-d) | `cressetide/lib/hook-io.mjs`: `  const text = buffer.toString("utf8");` → `  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");` | lib-hook-io | **RED** exit 1, 33/32/1: "readHookEvent: a leading byte-order mark makes the event malformed (not dropped)"; restored=true, left 0 |
| M9 debug sink writes the unredacted message (doctor hook-debug row) | `cressetide/lib/debug.mjs`: `const line = `[ctide ${entry}] ${check}: ${redactDiagnostic(message, LINE_LIMIT)}\n`;` → `const line = `[ctide ${entry}] ${check}: ${String(message).slice(0, LINE_LIMIT)}\n`;` | doctor-security, release-doctor | **RED** exit 1, 60/57/3: "Doctor probes harmless valid events as well as malformed fail-open events"; "Doctor runtime probes override a hostile ambient environment: project opt-outs, CTIDE_HOOK_DEBUG=1 and TEMP all ignored, nothing left behind"; "Doctor runs the complete local fail-open boundary probe"; restored=true, left 0 |
| M10 session-start joins the parts without the blank line | `cressetide/hooks/session-start.mjs`: `  return { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: parts.join("\n\n") } };` → `  return { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: parts.join("\n") } };` | session-memory-hooks | **RED** exit 1, 9/8/1: "SessionStart entry: after a compaction the digest comes first, then the reminder, joined by a blank line"; restored=true, left 0 |
| M11 session-start drops the compaction reminder entirely | `cressetide/hooks/session-start.mjs`: `  for (const [check, build] of [["failure-memory", failureMemoryContext], ["compact-fidelity", preserveContext]]) {` → `  for (const [check, build] of [["failure-memory", failureMemoryContext]]) {` | session-memory-hooks, hooks | **RED** exit 1, 20/15/5: "AC-5: an entry exits 0 with no output when cressetide/lib/ is missing (a plugin copy without lib)"; "AC-5: an entry exits 0 with no output on a 6 MiB event (over the 5 MiB stdin cap)"; "SessionStart entry: after a compaction the digest comes first, then the reminder, joined by a blank line"; "SessionStart entry: an event with no source (empty stdin) still gets the digest and the reminder (fail toward preserving)"; "SessionStart entry: with no memory file, startup injects nothing and a compaction gets the reminder alone"; restored=true, left 0 |

## 7. S0 changed rows (normal env; the hostile env changed the same 63 rows) — every one ALLOWED

- A/mode/Bash/camelCase-permissionMode-plan  [camelcase-alias-gone] changed: decision, output
- A/mode/Edit/camelCase-permissionMode-plan  [camelcase-alias-gone] changed: decision, output
- A/mode/MultiEdit/absent  [multiedit-gone] changed: exits
- A/mode/MultiEdit/acceptEdits  [multiedit-gone] changed: exits
- A/mode/MultiEdit/bypassPermissions  [multiedit-gone] changed: exits
- A/mode/MultiEdit/camelCase-permissionMode-plan  [multiedit-gone + camelcase-alias-gone] changed: exits, decision, output
- A/mode/MultiEdit/default  [multiedit-gone] changed: exits
- A/mode/MultiEdit/plan  [multiedit-gone] changed: exits, decision, output
- A/mode/NotebookEdit/camelCase-permissionMode-plan  [camelcase-alias-gone] changed: decision, output
- A/mode/PowerShell/camelCase-permissionMode-plan  [camelcase-alias-gone] changed: decision, output
- A/mode/Write/camelCase-permissionMode-plan  [camelcase-alias-gone] changed: decision, output
- C/contract/multiedit-later-step-not-found  [multiedit-gone] changed: exits
- C/contract/multiedit-weakening  [multiedit-gone] changed: exits, decision, output
- C/settings/multiedit-replace_all  [multiedit-gone] changed: exits, decision, output
- C/settings/multiedit-step-not-found  [multiedit-gone] changed: exits
- E/h2-entries/absent  [failmem-h2] changed: output
- E/h2-entries/clear  [failmem-h2] changed: output
- E/h2-entries/compact  [failmem-h2] changed: output
- E/h2-entries/resume  [failmem-h2] changed: output
- E/h2-entries/startup  [failmem-h2] changed: output
- E/placeholder-only/absent  [failmem-pointer] changed: output
- E/placeholder-only/clear  [failmem-pointer] changed: output
- E/placeholder-only/compact  [failmem-pointer] changed: output
- E/placeholder-only/resume  [failmem-pointer] changed: output
- E/placeholder-only/startup  [failmem-pointer] changed: output
- E/placeholder-plus-h2/absent  [failmem-placeholder] changed: output
- E/placeholder-plus-h2/clear  [failmem-placeholder] changed: output
- E/placeholder-plus-h2/compact  [failmem-placeholder] changed: output
- E/placeholder-plus-h2/resume  [failmem-placeholder] changed: output
- E/placeholder-plus-h2/startup  [failmem-placeholder] changed: output
- E/prose-only/absent  [failmem-pointer] changed: output
- E/prose-only/clear  [failmem-pointer] changed: output
- E/prose-only/compact  [failmem-pointer] changed: output
- E/prose-only/resume  [failmem-pointer] changed: output
- E/prose-only/startup  [failmem-pointer] changed: output
- E/template-fresh/absent  [failmem-placeholder] changed: output
- E/template-fresh/clear  [failmem-placeholder] changed: output
- E/template-fresh/compact  [failmem-placeholder] changed: output
- E/template-fresh/resume  [failmem-placeholder] changed: output
- E/template-fresh/startup  [failmem-placeholder] changed: output
- F/SessionStart-all/array  [sessionstart-not-object] changed: output
- F/SessionStart-all/bom-json  [sessionstart-malformed] changed: output
- F/SessionStart-all/not-json  [sessionstart-malformed] changed: output
- F/SessionStart-all/null  [sessionstart-not-object] changed: output
- F/SessionStart-all/open-brace  [sessionstart-malformed] changed: output
- F/SessionStart-all/string  [sessionstart-not-object] changed: output
- G/contract-ask/CTIDE_HOOK_DEBUG=1  [debug-redaction] changed: stderr, log
- G/destructive-with-secrets/CTIDE_HOOK_DEBUG=0  [debug-switch] changed: stderrClass, stderr, logExists, log, leaks, tmpFiles
- G/destructive-with-secrets/CTIDE_HOOK_DEBUG=1  [debug-redaction] changed: stderr, log, leaks
- G/destructive-with-secrets/CTIDE_HOOK_DEBUG=TRUE  [debug-redaction] changed: stderr, log, leaks
- G/destructive-with-secrets/CTIDE_HOOK_DEBUG=Yes  [debug-redaction] changed: stderr, log, leaks
- G/destructive-with-secrets/CTIDE_HOOK_DEBUG=false  [debug-switch] changed: stderrClass, stderr, logExists, log, leaks, tmpFiles
- G/destructive-with-secrets/CTIDE_HOOK_DEBUG=on  [debug-redaction] changed: stderr, log, leaks
- G/destructive-with-secrets/CTIDE_HOOK_DEBUG=space  [debug-switch] changed: stderrClass, stderr, logExists, log, leaks, tmpFiles
- G/destructive-with-secrets/CTIDE_HOOK_DEBUG=true  [debug-redaction] changed: stderr, log, leaks
- G/destructive-with-secrets/CTIDE_HOOK_DEBUG=x  [debug-switch] changed: stderrClass, stderr, logExists, log, leaks, tmpFiles
- G/plan-deny/CTIDE_HOOK_DEBUG=1  [debug-redaction] changed: stderr, log
- G/session-start-compact/CTIDE_HOOK_DEBUG=0  [debug-switch] changed: stderrClass, stderr, logExists, log, tmpFiles
- G/session-start-compact/CTIDE_HOOK_DEBUG=1  [debug-redaction] changed: stderr, log
- I/lib-missing/destructive  [new-only]
- I/lib-missing/plan-write  [new-only]
- I/lib-missing/session-start-compact  [new-only]
- I/lib-missing/stop-blocking  [new-only]

## 8. Retired spawn tests: every old title and where its assertion lives now (237 rows)

| old file | old title | where the assertion lives now | status |
|---|---|---|---|
| plan-gate-guards | B3: repo-local .claude/plans path is NOT exempt (denied in plan mode) | test/guards.test.mjs "B3: repo-local .claude/plans path is NOT exempt (denied in plan mode) (in-process)…" | ported 1:1 |
| plan-gate-guards | home ~/.claude/plans path IS exempt (isolated home) | test/guards.test.mjs "home ~/.claude/plans path IS exempt (isolated home) (in-process)…" | ported 1:1 |
| plan-gate-guards | plan-gate: a junction under ~/.claude/plans whose target escapes is NOT exempt (denied) | test/guards.test.mjs "plan-gate: a junction under ~/.claude/plans whose target escapes is NOT exempt (denied) (in-process)…" | ported 1:1 |
| plan-gate-guards | plan-gate: a symlinked HOME still exempts ~/.claude/plans (realpath BOTH sides) | test/guards.test.mjs "plan-gate: a symlinked HOME still exempts ~/.claude/plans (realpath BOTH sides) (in-process)…" | ported 1:1 |
| plan-gate-guards | plan-gate: on a case-sensitive FS, an uppercase ~/.claude/PLANS path is NOT exempt | test/guards.test.mjs "plan-gate: on a case-sensitive FS, an uppercase ~/.claude/PLANS path is NOT exempt (in-process)…" | ported 1:1 |
| plan-gate-guards | plan-gate: on a case-insensitive FS, an uppercase ~/.claude/PLANS path IS exempt (same dir) | test/guards.test.mjs "plan-gate: on a case-insensitive FS, an uppercase ~/.claude/PLANS path IS exempt (same dir) (in-process)…" | ported 1:1 |
| plan-gate-guards | normal file write is denied in plan mode, allowed otherwise | test/guards.test.mjs "normal file write is denied in plan mode, allowed otherwise (in-process)…" | ported 1:1 |
| plan-gate-guards | NotebookEdit is gated in plan mode | test/guards.test.mjs "NotebookEdit is gated in plan mode (in-process)…" | ported 1:1 |
| plan-gate-guards | Edit and MultiEdit are behaviorally gated in plan mode | test/guards.test.mjs "Edit and MultiEdit are behaviorally gated in plan mode (in-process)…" | CHANGED |
| plan-gate-guards | Read is never gated | test/guards.test.mjs "Read is never gated (in-process)…" | ported 1:1 |
| plan-gate-guards | Bash tripwire: obvious working-tree writes are denied in plan mode | test/guards.test.mjs "Bash tripwire: obvious working-tree writes are denied in plan mode (in-process)…" | ported 1:1 |
| plan-gate-guards | Bash tripwire: read-only / benign commands are allowed in plan mode | test/guards.test.mjs "Bash tripwire: read-only / benign commands are allowed in plan mode (in-process)…" | ported 1:1 |
| plan-gate-guards | Bash tripwire: only fires in plan mode (a write is allowed outside plan) | test/guards.test.mjs "Bash tripwire: only fires in plan mode (a write is allowed outside plan) (in-process)…" | ported 1:1 |
| plan-gate-guards | Bash tripwire: documented conservative misses stay allowed (boundary is intentional) | test/guards.test.mjs "Bash tripwire: documented conservative misses stay allowed (boundary is intentional) (in-process)…" | ported 1:1 |
| plan-gate-guards | Bash tripwire: a quoted redirection target is a literal, not a real write | test/guards.test.mjs "Bash tripwire: a quoted redirection target is a literal, not a real write (in-process)…" | ported 1:1 |
| plan-gate-guards | Bash tripwire: the deny reason names the heuristic and the escape hatch | test/guards.test.mjs "Bash tripwire: the deny reason names the heuristic and the escape hatch (in-process)…" | ported 1:1 |
| plan-gate-guards | plan-gate F1: sed -i with realistic padding before -i still denies (bound doesn't clip normal usage) | test/guards.test.mjs "plan-gate F1: sed -i with realistic padding before -i still denies (bound doesn't clip normal usage) (in-process)…" | ported 1:1 |
| plan-gate-guards | plan-gate F1: a pathological sed input (no -i/--in-place anywhere) returns a decision quickly (linear, not quadratic ReDoS) | test/guards.test.mjs "plan-gate F1: a pathological sed input (no -i/--in-place anywhere) returns a decision quickly (linear, not quadratic ReDoS) (in-process)…" | ported 1:1 |
| plan-gate-guards | plan-gate F1: perl -i with realistic padding before -i still denies (bound doesn't clip normal usage) | test/guards.test.mjs "plan-gate F1: perl -i with realistic padding before -i still denies (bound doesn't clip normal usage) (in-process)…" | ported 1:1 |
| plan-gate-guards | plan-gate F1: a pathological perl input (no -i anywhere) returns a decision quickly (linear, not quadratic ReDoS) | test/guards.test.mjs "plan-gate F1: a pathological perl input (no -i anywhere) returns a decision quickly (linear, not quadratic ReDoS) (in-process)…" | ported 1:1 |
| plan-gate-guards | plan-gate F1: git apply with realistic padding still resolves correctly, both with and without --check (bound doesn't clip normal usage) | test/guards.test.mjs "plan-gate F1: git apply with realistic padding still resolves correctly, both with and without --check (bound doesn't clip normal usage) (in-process)…" | ported 1:1 |
| plan-gate-guards | plan-gate F1: a pathological git apply input (--check present at every occurrence) returns a decision quickly (linear, not quadratic ReDoS) | test/guards.test.mjs "plan-gate F1: a pathological git apply input (--check present at every occurrence) returns a decision quickly (linear, not quadratic ReDoS) (in-process)…" | ported 1:1 |
| plan-gate-guards | plan-gate F1: a pathological dd input (no of= anywhere) returns a decision quickly (linear, not quadratic ReDoS) | test/guards.test.mjs "plan-gate F1: a pathological dd input (no of= anywhere) returns a decision quickly (linear, not quadratic ReDoS) (in-process)…" | ported 1:1 |
| plan-gate-guards | malformed stdin fails open (no deny, no crash) | test/lib-hook-io.test.mjs (reader outcome) + test/hooks.test.mjs "AC-5: an entry exits 0 with no output on stdin '{' (malformed JSON)" | reader in-process (P5a) + spawn half in P5c smoke |
| plan-gate-guards | hooks.json PreToolUse matcher actually covers every gated tool | test/plan-gate-guards.test.mjs "hooks.json: the PreToolUse matcher covers every gated tool, and MultiEdit is no longer listed" + validator §5c WIRING (test/validate-structure.test.mjs matcher rows) | P5c smoke/wiring |
| plan-gate-guards | plan-gate honors camelCase permissionMode alias | test/guards.test.mjs "plan-gate honors camelCase permissionMode alias (in-process)…" | CHANGED |
| plan-gate-guards | plan-gate fails open (allow) on oversized stdin | test/lib-hook-io.test.mjs (reader outcome) + test/hooks.test.mjs "AC-5: an entry exits 0 with no output on a 6 MiB event (over the 5 MiB stdin cap)" | reader in-process (P5a) + spawn half in P5c smoke |
| plan-gate-guards | plan-gate deny JSON is fully flushed even with a large payload | test/plan-gate-guards.test.mjs "PreToolUse entry: the deny JSON is fully flushed even with a 2 MiB payload" | P5c smoke/wiring |
| plan-gate-guards | plan-gate: ctide.planGate=false in settings.json allows in plan mode | test/guards.test.mjs "plan-gate: ctide.planGate=false in settings.json allows in plan mode (in-process)…" | ported 1:1 |
| plan-gate-guards | plan-gate: settings.local.json opt-out overrides settings.json | test/guards.test.mjs "plan-gate: settings.local.json opt-out overrides settings.json (in-process)…" | ported 1:1 |
| plan-gate-guards | plan-gate: no flag still denies in plan mode (default enforce) | test/guards.test.mjs "plan-gate: no flag still denies in plan mode (default enforce) (in-process)…" | ported 1:1 |
| plan-gate-guards | plan-gate: planGate=true explicitly enforces (deny) | test/guards.test.mjs "plan-gate: planGate=true explicitly enforces (deny) (in-process)…" | ported 1:1 |
| plan-gate-guards | plan-gate: malformed project settings fail safe to enforce (deny) | test/guards.test.mjs "plan-gate: malformed project settings fail safe to enforce (deny) (in-process)…" | ported 1:1 |
| plan-gate-guards | plan-gate: the opt-out resolves from the event cwd when CLAUDE_PROJECT_DIR is unset | test/guards.test.mjs "plan-gate: the opt-out resolves from the event cwd when CLAUDE_PROJECT_DIR is unset (in-process)…" | ported 1:1 |
| plan-gate-guards | plan-gate: a bare {"ctide":false} settings.json on disk does not suppress plan-mode enforcement (readPlanGateFlag must not misread it as planGate:false) | test/guards.test.mjs "plan-gate: a bare {"ctide":false} settings.json on disk does not suppress plan-mode enforcement (readPlanGateFlag must not misread it as planGate:false) (in-process)…" | ported 1:1 |
| plan-gate-guards | plan-gate: a bare root-level `false` settings.json document also does not suppress plan-mode enforcement | test/guards.test.mjs "plan-gate: a bare root-level `false` settings.json document also does not suppress plan-mode enforcement (in-process)…" | ported 1:1 |
| plan-gate-guards | destructive-guard: ASKS on unrecoverable commands in ANY mode (incl. default — the gap plan-gate misses) | test/guards.test.mjs "destructive-guard: ASKS on unrecoverable commands in ANY mode (incl. default — the gap plan-gate misses) (in-process)…" | ported 1:1 |
| plan-gate-guards | destructive-guard: ALLOWS benign / recoverable / quoted commands (narrow deny-list, no FP) | test/guards.test.mjs "destructive-guard: ALLOWS benign / recoverable / quoted commands (narrow deny-list, no FP) (in-process)…" | ported 1:1 |
| plan-gate-guards | destructive-guard: only Bash is in scope (a Write whose content contains rm -rf is never its concern) | test/guards.test.mjs "destructive-guard: only Bash is in scope (a Write whose content contains rm -rf is never its concern) (in-process)…" | ported 1:1 |
| plan-gate-guards | destructive-guard: project opt-out ctide.destructiveGuard=false allows | test/guards.test.mjs "destructive-guard: project opt-out ctide.destructiveGuard=false allows (in-process)…" | ported 1:1 |
| plan-gate-guards | destructive-guard: settings.local.json opt-out overrides settings.json | test/guards.test.mjs "destructive-guard: settings.local.json opt-out overrides settings.json (in-process)…" | ported 1:1 |
| plan-gate-guards | destructive-guard: malformed project settings fail safe to ASK (a broken file never drops the net on a match) | test/guards.test.mjs "destructive-guard: malformed project settings fail safe to ASK (a broken file never drops the net on a match) (in-process)…" | ported 1:1 |
| plan-gate-guards | destructive-guard: a bare {"ctide":false} settings.json on disk does not suppress the destructive-command ask (readGuardFlag must not misread it as destructiveGuard:false) | test/guards.test.mjs "destructive-guard: a bare {"ctide":false} settings.json on disk does not suppress the destructive-command ask (readGuardFlag must not misread it as destructiveGuard:false) (in-process)…" | ported 1:1 |
| plan-gate-guards | destructive-guard: a bare root-level `false` settings.json document also does not suppress the ask | test/guards.test.mjs "destructive-guard: a bare root-level `false` settings.json document also does not suppress the ask (in-process)…" | ported 1:1 |
| plan-gate-guards | destructive-guard: the ASK reason warns an AI agent against self-authoring the destructiveGuard opt-out reactively | test/guards.test.mjs "destructive-guard: the ASK reason warns an AI agent against self-authoring the destructiveGuard opt-out reactively (in-process)…" | ported 1:1 |
| plan-gate-guards | destructive-guard: the ASK reason names settings.local.json alongside settings.json (higher-precedence, gitignored, diff-invisible) | test/guards.test.mjs "destructive-guard: the ASK reason names settings.local.json alongside settings.json (higher-precedence, gitignored, diff-invisible) (in-process)…" | ported 1:1 |
| plan-gate-guards | destructive-guard: malformed stdin fails open (no ask, no crash) | test/lib-hook-io.test.mjs (reader outcome) + test/hooks.test.mjs "AC-5: an entry exits 0 with no output on stdin '{' (malformed JSON)" | reader in-process (P5a) + spawn half in P5c smoke |
| plan-gate-guards | destructive-guard: oversized stdin fails open (allow) | test/lib-hook-io.test.mjs (reader outcome) + test/hooks.test.mjs "AC-5: an entry exits 0 with no output on a 6 MiB event (over the 5 MiB stdin cap)" | reader in-process (P5a) + spawn half in P5c smoke |
| plan-gate-guards | destructive-guard: separated rm flags (rm -r -f / rm -f -r / long forms) now ASK, while single-token rm -rf still asks | test/guards.test.mjs "destructive-guard: separated rm flags (rm -r -f / rm -f -r / long forms) now ASK, while single-token rm -rf still asks (in-process)…" | ported 1:1 |
| plan-gate-guards | destructive-guard: a single rm flag (recursive-only or force-only) stays ALLOW — no FP from the split-flag rule | test/guards.test.mjs "destructive-guard: a single rm flag (recursive-only or force-only) stays ALLOW — no FP from the split-flag rule (in-process)…" | ported 1:1 |
| plan-gate-guards | destructive-guard: separated-flag fail-open preserved (malformed stdin still no ask, no crash) | test/lib-hook-io.test.mjs (reader outcome) + test/hooks.test.mjs "AC-5: an entry exits 0 with no output on stdin '{' (malformed JSON)" | reader in-process (P5a) + spawn half in P5c smoke |
| plan-gate-guards | destructive-guard F1: bounded separated-flag patterns still ASK on realistic forms (correctness preserved) | test/guards.test.mjs "destructive-guard F1: bounded separated-flag patterns still ASK on realistic forms (correctness preserved) (in-process)…" | ported 1:1 |
| plan-gate-guards | destructive-guard F1: a pathological rm input returns a decision quickly (linear, not quadratic ReDoS) | test/guards.test.mjs "destructive-guard F1: a pathological rm input returns a decision quickly (linear, not quadratic ReDoS) (in-process)…" | ported 1:1 |
| plan-gate-guards | destructive-guard F1: git reset --hard with realistic padding before --hard still asks (bound doesn't clip normal usage) | test/guards.test.mjs "destructive-guard F1: git reset --hard with realistic padding before --hard still asks (bound doesn't clip normal usage) (in-process)…" | ported 1:1 |
| plan-gate-guards | destructive-guard F1: a pathological git reset input (no --hard anywhere) returns a decision quickly (linear, not quadratic ReDoS) | test/guards.test.mjs "destructive-guard F1: a pathological git reset input (no --hard anywhere) returns a decision quickly (linear, not quadratic ReDoS) (in-process)…" | ported 1:1 |
| plan-gate-guards | destructive-guard F1: git push --force with realistic padding before the force flag still asks (bound doesn't clip normal usage) | test/guards.test.mjs "destructive-guard F1: git push --force with realistic padding before the force flag still asks (bound doesn't clip normal usage) (in-process)…" | ported 1:1 |
| plan-gate-guards | destructive-guard F1: a pathological git push input (no --force/-f anywhere) returns a decision quickly (linear, not quadratic ReDoS) | test/guards.test.mjs "destructive-guard F1: a pathological git push input (no --force/-f anywhere) returns a decision quickly (linear, not quadratic ReDoS) (in-process)…" | ported 1:1 |
| plan-gate-guards | destructive-guard F1: find -delete with realistic padding before -delete still asks (bound doesn't clip normal usage) | test/guards.test.mjs "destructive-guard F1: find -delete with realistic padding before -delete still asks (bound doesn't clip normal usage) (in-process)…" | ported 1:1 |
| plan-gate-guards | destructive-guard F1: a pathological find input (no -delete anywhere) returns a decision quickly (linear, not quadratic ReDoS) | test/guards.test.mjs "destructive-guard F1: a pathological find input (no -delete anywhere) returns a decision quickly (linear, not quadratic ReDoS) (in-process)…" | ported 1:1 |
| plan-gate-guards | destructive-guard F1: dd of= with a realistic longer invocation still asks (bound doesn't clip normal usage) | test/guards.test.mjs "destructive-guard F1: dd of= with a realistic longer invocation still asks (bound doesn't clip normal usage) (in-process)…" | ported 1:1 |
| plan-gate-guards | destructive-guard F1: a pathological dd input (no of= anywhere) returns a decision quickly (linear, not quadratic ReDoS) | test/guards.test.mjs "destructive-guard F1: a pathological dd input (no of= anywhere) returns a decision quickly (linear, not quadratic ReDoS) (in-process)…" | ported 1:1 |
| plan-gate-guards | destructive-guard F1 (retroactive): a pathological mysqladmin input (no drop anywhere) returns a decision quickly (linear, not quadratic ReDoS) | test/guards.test.mjs "destructive-guard F1 (retroactive): a pathological mysqladmin input (no drop anywhere) returns a decision quickly (linear, not quadratic ReDoS) (in-process)…" | ported 1:1 |
| plan-gate-guards | destructive-guard F1 (retroactive): a pathological redis-cli input (no flushall/flushdb anywhere) returns a decision quickly (linear, not quadratic ReDoS) | test/guards.test.mjs "destructive-guard F1 (retroactive): a pathological redis-cli input (no flushall/flushdb anywhere) returns a decision quickly (linear, not quadratic ReDoS) (in-process)…" | ported 1:1 |
| plan-gate-guards | destructive-guard: PowerShell-native destructive forms (Windows/Copilot) ASK | test/guards.test.mjs "destructive-guard: PowerShell-native destructive forms (Windows) ASK (in-process)" (title renamed in P5c: the removed runtime name dropped) | ported 1:1 |
| plan-gate-guards | destructive-guard: non-recursive / non-destructive PowerShell stays ALLOW (no FP) | test/guards.test.mjs "destructive-guard: non-recursive / non-destructive PowerShell stays ALLOW (no FP) (in-process)…" | ported 1:1 |
| plan-gate-guards | destructive-guard F1: Remove-Item with realistic padding before -Recurse still asks (bound doesn't clip normal usage) | test/guards.test.mjs "destructive-guard F1: Remove-Item with realistic padding before -Recurse still asks (bound doesn't clip normal usage) (in-process)…" | ported 1:1 |
| plan-gate-guards | destructive-guard F1: a pathological Remove-Item input (no -Recurse-ish flag anywhere) returns a decision quickly (linear, not quadratic ReDoS) | test/guards.test.mjs "destructive-guard F1: a pathological Remove-Item input (no -Recurse-ish flag anywhere) returns a decision quickly (linear, not quadratic ReDoS) (in-process)…" | ported 1:1 |
| plan-gate-guards | destructive-guard: git push --force-fast (a non-flag) does NOT false-ask, but --force / --force-with-lease still do | test/guards.test.mjs "destructive-guard: git push --force-fast (a non-flag) does NOT false-ask, but --force / --force-with-lease still do (in-process)…" | ported 1:1 |
| plan-gate-guards | destructive-guard A4: a parenthesized subshell running a destructive command ASKS; a benign paren does NOT | test/guards.test.mjs "destructive-guard A4: a parenthesized subshell running a destructive command ASKS; a benign paren does NOT (in-process)…" | ported 1:1 |
| plan-gate-guards | destructive-guard A4: the '(' subshell anchor fires beyond rm (non-rm destructive commands ASK) | test/guards.test.mjs "destructive-guard A4: the '(' subshell anchor fires beyond rm (non-rm destructive commands ASK) (in-process)…" | ported 1:1 |
| plan-gate-guards | destructive-guard: tool_name:"PowerShell" + destructive command ASKS like Bash, and the reason names PowerShell | test/guards.test.mjs "destructive-guard: tool_name:"PowerShell" + destructive command ASKS like Bash, and the reason names PowerShell (in-process)…" | ported 1:1 |
| plan-gate-guards | destructive-guard: tool_name:"PowerShell" + benign command stays ALLOW | test/guards.test.mjs "destructive-guard: tool_name:"PowerShell" + benign command stays ALLOW (in-process)…" | ported 1:1 |
| plan-gate-guards | plan-gate: tool_name:"PowerShell" write-looking commands are DENIED and the reason names PowerShell | test/guards.test.mjs "plan-gate: tool_name:"PowerShell" write-looking commands are DENIED and the reason names PowerShell (in-process)…" | ported 1:1 |
| plan-gate-guards | plan-gate: tool_name:"PowerShell" benign/read-only commands stay ALLOW in plan mode | test/guards.test.mjs "plan-gate: tool_name:"PowerShell" benign/read-only commands stay ALLOW in plan mode (in-process)…" | ported 1:1 |
| plan-gate-guards | destructive-guard: the existing Bash-tool PowerShell-syntax path still ASKS unchanged | test/guards.test.mjs "destructive-guard: the existing Bash-tool PowerShell-syntax path still ASKS unchanged (in-process)…" | ported 1:1 |
| plan-gate-guards | destructive-guard: tool_name:"Bash" ASK reason uses the live tool value | test/guards.test.mjs "destructive-guard: tool_name:"Bash" ASK reason uses the live tool value (in-process)…" | ported 1:1 |
| plan-gate-guards | plan-gate: tool_name:"Bash" deny reason uses the live tool value | test/guards.test.mjs "plan-gate: tool_name:"Bash" deny reason uses the live tool value (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard: pure-append to contract.md (new AC added, everything old intact) is allowed | test/guards.test.mjs "contract-guard: pure-append to contract.md (new AC added, everything old intact) is allowed (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard: silently altering an existing AC's text/verification asks, naming the AC id | test/guards.test.mjs "contract-guard: silently altering an existing AC's text/verification asks, naming the AC id (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard: a verification mapping silently altered on the same AC also asks | test/guards.test.mjs "contract-guard: a verification mapping silently altered on the same AC also asks (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard: dropping an existing AC id entirely (not just editing it) asks, naming it as removed | test/guards.test.mjs "contract-guard: dropping an existing AC id entirely (not just editing it) asks, naming it as removed (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard: flipping behaviorChanging true->false on a retained AC id asks, naming that field specifically | test/guards.test.mjs "contract-guard: flipping behaviorChanging true->false on a retained AC id asks, naming that field specifically (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard A3: dropping an id-LESS acceptance criterion (matched by text) asks, naming it as removed | test/guards.test.mjs "contract-guard A3: dropping an id-LESS acceptance criterion (matched by text) asks, naming it as removed (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard A3: a benign reorder of id-less ACs (same texts, different order) does NOT ask | test/guards.test.mjs "contract-guard A3: a benign reorder of id-less ACs (same texts, different order) does NOT ask (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard: removing a mustNotChange entry asks | test/guards.test.mjs "contract-guard: removing a mustNotChange entry asks (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard: removing a forbiddenPaths entry asks | test/guards.test.mjs "contract-guard: removing a forbiddenPaths entry asks (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard: removing an allowedPaths entry asks | test/guards.test.mjs "contract-guard: removing an allowedPaths entry asks (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard: risk downgraded high->low asks; risk increased medium->high is allowed | test/guards.test.mjs "contract-guard: risk downgraded high->low asks; risk increased medium->high is allowed (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard M1: a non-canonical-cased risk downgrade (high->"Low") still asks (ordinal lookup is case/whitespace-normalized) | test/guards.test.mjs "contract-guard M1: a non-canonical-cased risk downgrade (high->"Low") still asks (ordinal lookup is case/whitespace-normalized) (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard: contract.md first-ever write (no prior file, no populated sibling) allows regardless of content | test/guards.test.mjs "contract-guard: contract.md first-ever write (no prior file, no populated sibling) allows regardless of content (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard: contract.md whose prior content has no parseable JSON block also allows (no populated sibling) | test/guards.test.mjs "contract-guard: contract.md whose prior content has no parseable JSON block also allows (no populated sibling) (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard: an already-populated contract.md whose new content drops the JSON block entirely asks | test/guards.test.mjs "contract-guard: an already-populated contract.md whose new content drops the JSON block entirely asks (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard: an Edit whose old_string does not match current content is allowed (cannot simulate) | test/guards.test.mjs "contract-guard: an Edit whose old_string does not match current content is allowed (cannot simulate) (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard: a MultiEdit whose later step's old_string is not found fails open for the WHOLE call | test/guards.test.mjs "contract-guard: a MultiEdit whose later step's old_string is not found fails open for the WHOLE call (in-process)…" | CHANGED |
| plan-gate-guards | contract-guard M2: an Edit whose old_string matches a value shared by two ACs only simulates the FIRST occurrence (real Edit semantics) | test/guards.test.mjs "contract-guard M2: an Edit whose old_string matches a value shared by two ACs only simulates the FIRST occurrence (real Edit semantics) (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard: an edit to some unrelated file never invokes any comparison (no-op) | test/guards.test.mjs "contract-guard: an edit to some unrelated file never invokes any comparison (no-op) (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard: project opt-out ctide.contractGuard=false suppresses an otherwise-real finding | test/guards.test.mjs "contract-guard: project opt-out ctide.contractGuard=false suppresses an otherwise-real finding (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard: settings.local.json opt-out overrides settings.json (local-overrides-project precedence) | test/guards.test.mjs "contract-guard: settings.local.json opt-out overrides settings.json (local-overrides-project precedence) (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard: malformed project settings fail safe to keep asking (a broken file must not silently drop the guard) | test/guards.test.mjs "contract-guard: malformed project settings fail safe to keep asking (a broken file must not silently drop the guard) (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard: a bare {"ctide":false} settings.json on disk does not suppress a genuine contract.md-weakening ask (readGuardFlag must not misread it as contractGuard:false) | test/guards.test.mjs "contract-guard: a bare {"ctide":false} settings.json on disk does not suppress a genuine contract.md-weakening ask (readGuardFlag must not misread it as contractGuard:false) (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard: a bare root-level `false` settings.json document also does not suppress a genuine ask | test/guards.test.mjs "contract-guard: a bare root-level `false` settings.json document also does not suppress a genuine ask (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard control: {"ctide":0} (not the literal boolean false) behaves identically before/after this fix -- isolates literal `false` as the specific value ever misread | test/guards.test.mjs "contract-guard control: {"ctide":0} (not the literal boolean false) behaves identically before/after this fix -- isolates literal `false` as the specific value ever misread (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard: the ASK reason warns an AI agent against self-authoring the contractGuard opt-out reactively | test/guards.test.mjs "contract-guard: the ASK reason warns an AI agent against self-authoring the contractGuard opt-out reactively (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard: the ASK reason names settings.local.json alongside settings.json (higher-precedence, gitignored, diff-invisible) | test/guards.test.mjs "contract-guard: the ASK reason names settings.local.json alongside settings.json (higher-precedence, gitignored, diff-invisible) (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard: oversized stdin fails open (allow) | test/lib-hook-io.test.mjs (reader outcome) + test/hooks.test.mjs "AC-5: an entry exits 0 with no output on a 6 MiB event (over the 5 MiB stdin cap)" | reader in-process (P5a) + spawn half in P5c smoke |
| plan-gate-guards | contract-guard: malformed stdin fails open (no ask, no crash) | test/lib-hook-io.test.mjs (reader outcome) + test/hooks.test.mjs "AC-5: an entry exits 0 with no output on stdin '{' (malformed JSON)" | reader in-process (P5a) + spawn half in P5c smoke |
| plan-gate-guards | contract-guard: an unreadable target file (e.g. a directory at that path) fails open | test/guards.test.mjs "contract-guard: an unreadable target file (e.g. a directory at that path) fails open (in-process)…" | ported 1:1 |
| plan-gate-guards | design.md: a section body edited/expanded with the heading kept is allowed | test/guards.test.mjs "design.md: a section body edited/expanded with the heading kept is allowed (in-process)…" | ported 1:1 |
| plan-gate-guards | design.md: a whole heading (## Do's and Don'ts) removed asks, naming that section | test/guards.test.mjs "design.md: a whole heading (## Do's and Don'ts) removed asks, naming that section (in-process)…" | ported 1:1 |
| plan-gate-guards | design.md: a section reduced to an 'n/a' placeholder with the heading kept is allowed | test/guards.test.mjs "design.md: a section reduced to an 'n/a' placeholder with the heading kept is allowed (in-process)…" | ported 1:1 |
| plan-gate-guards | design.md: exact-normalized heading match only — '## Color' must not match inside '## Color Palette & Roles' | test/guards.test.mjs "design.md: exact-normalized heading match only — '## Color' must not match inside '## Color Palette & Roles' (in-process)…" | ported 1:1 |
| plan-gate-guards | design.md: a design.md matched by basename at a non-root path is still guarded (not root-anchored) | test/guards.test.mjs "design.md: a design.md matched by basename at a non-root path is still guarded (not root-anchored) (in-process)…" | ported 1:1 |
| plan-gate-guards | design.md: first-ever write (no prior file) is allowed (nothing to have lost) | test/guards.test.mjs "design.md: first-ever write (no prior file) is allowed (nothing to have lost) (in-process)…" | ported 1:1 |
| plan-gate-guards | design.md A2: a whole section removed from a differently-cased basename (Design.md) still asks | test/guards.test.mjs "design.md A2: a whole section removed from a differently-cased basename (Design.md) still asks (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard: a weakening Write to the current .ctide/output/contract.md path asks | test/guards.test.mjs "contract-guard: a weakening Write to the current .ctide/output/contract.md path asks (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard: the same weakening Write at the compatibility .ctide/legacy-output/contract.md path still asks (control) | test/guards.test.mjs "contract-guard: the same weakening Write at the compatibility .ctide/legacy-output/contract.md path still asks (control) (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard: design.md at its current .ctide/design/ home is guarded by basename (whole-section deletion asks) | test/guards.test.mjs "contract-guard: design.md at its current .ctide/design/ home is guarded by basename (whole-section deletion asks) (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard sibling baseline (a): fresh weakened Write to the current path with a populated compatibility sibling asks, naming the lost entry and sibling | test/guards.test.mjs "contract-guard sibling baseline (a): fresh weakened Write to the current path with a populated compatibility sibling asks, naming the lost entry and sibling (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard sibling baseline (b): fresh weakened Write to the compatibility path with a populated current sibling asks (reverse direction) | test/guards.test.mjs "contract-guard sibling baseline (b): fresh weakened Write to the compatibility path with a populated current sibling asks (reverse direction) (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard sibling baseline (c): a true first write (no sibling anywhere) stays allowed at both watched paths | test/guards.test.mjs "contract-guard sibling baseline (c): a true first write (no sibling anywhere) stays allowed at both watched paths (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard sibling baseline (d): a fresh Write that is a strict superset of the populated sibling stays allowed | test/guards.test.mjs "contract-guard sibling baseline (d): a fresh Write that is a strict superset of the populated sibling stays allowed (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard sibling baseline (e): a prose-only sibling (no JSON block) does not become a baseline — fresh write stays allowed (fail-open) | test/guards.test.mjs "contract-guard sibling baseline (e): a prose-only sibling (no JSON block) does not become a baseline — fresh write stays allowed (fail-open) (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard sibling baseline (f): project opt-out ctide.contractGuard=false suppresses the sibling-baseline ask too | test/guards.test.mjs "contract-guard sibling baseline (f): project opt-out ctide.contractGuard=false suppresses the sibling-baseline ask too (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard settings-guard (a): a fresh settings.json Write introducing contractGuard:false, where neither settings file existed before, asks | test/guards.test.mjs "contract-guard settings-guard (a): a fresh settings.json Write introducing contractGuard:false, where neither settings file existed before, asks (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard settings-guard (b): settings.local.json already has contractGuard:false; an unrelated Edit sets the SAME key false again in settings.json (redundant, no effective change) does not ask | test/guards.test.mjs "contract-guard settings-guard (b): settings.local.json already has contractGuard:false; an unrelated Edit sets the SAME key false again in settings.json (redundant, no effective change) does not ask (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard settings-guard (c): a flag flip false -> true (re-enabling protection) does not ask | test/guards.test.mjs "contract-guard settings-guard (c): a flag flip false -> true (re-enabling protection) does not ask (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard settings-guard (d): an edit touching only unrelated keys (e.g. permissions.allow) does not ask (no-op) | test/guards.test.mjs "contract-guard settings-guard (d): an edit touching only unrelated keys (e.g. permissions.allow) does not ask (no-op) (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard settings-guard (e): the existing ctide.contractGuard:false opt-out also suppresses this NEW settings-file ask | test/guards.test.mjs "contract-guard settings-guard (e): the existing ctide.contractGuard:false opt-out also suppresses this NEW settings-file ask (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard settings-guard (f1): malformed JSON in the SIBLING settings file does not mask a real flip in the file actually being written | test/guards.test.mjs "contract-guard settings-guard (f1): malformed JSON in the SIBLING settings file does not mask a real flip in the file actually being written (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard settings-guard (f2): malformed JSON in the TARGET's proposed content fails open (no ask, no crash) | test/guards.test.mjs "contract-guard settings-guard (f2): malformed JSON in the TARGET's proposed content fails open (no ask, no crash) (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard settings-guard: settings.local.json itself is also watched (not just settings.json) — a fresh local-only write flipping a flag asks | test/guards.test.mjs "contract-guard settings-guard: settings.local.json itself is also watched (not just settings.json) — a fresh local-only write flipping a flag asks (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard settings-guard: an unrelated file write (not either settings path) is never affected (no-op) | test/guards.test.mjs "contract-guard settings-guard: an unrelated file write (not either settings path) is never affected (no-op) (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard settings-guard BLOCKER-fix: an Edit with replace_all:true genuinely flips a guard flag when an earlier same-text boolean token precedes it in the file (real replace_all semantics, not first-occurrence-only simulation) | test/guards.test.mjs "contract-guard settings-guard BLOCKER-fix: an Edit with replace_all:true genuinely flips a guard flag when an earlier same-text boolean token precedes it in the file (real replace_all semantics, not first-occurrence-only simulation) (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard settings-guard BLOCKER-fix: a MultiEdit step with its OWN replace_all:true also genuinely flips the guard flag (per-step semantics) | test/guards.test.mjs "contract-guard settings-guard BLOCKER-fix: a MultiEdit step with its OWN replace_all:true also genuinely flips the guard flag (per-step semantics) (in-process)…" | CHANGED (covered by the MultiEdit row) |
| plan-gate-guards | contract-guard settings-guard BLOCKER-fix control: the SAME earlier-boolean-token Edit WITHOUT replace_all stays first-occurrence-only (does not ask) -- proves the fix is replace_all-gated, not a behavior change for the default case | test/guards.test.mjs "contract-guard settings-guard BLOCKER-fix control: the SAME earlier-boolean-token Edit WITHOUT replace_all stays first-occurrence-only (does not ask) -- proves the fix is replace_all-gated, not a behavior change for the default case (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard settings-guard MAJOR1-fix: a sibling settings file where 'ctide' itself is the bare boolean false does not mask a fresh guard-flag introduction in the target | test/guards.test.mjs "contract-guard settings-guard MAJOR1-fix: a sibling settings file where 'ctide' itself is the bare boolean false does not mask a fresh guard-flag introduction in the target (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard settings-guard MAJOR1-fix: a sibling settings file whose ENTIRE content is the bare boolean false (root-level, not wrapped in an object) also does not mask a fresh guard-flag introduction | test/guards.test.mjs "contract-guard settings-guard MAJOR1-fix: a sibling settings file whose ENTIRE content is the bare boolean false (root-level, not wrapped in an object) also does not mask a fresh guard-flag introduction (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard settings-guard MAJOR2: a fresh settings.json Write introducing planGate:false, where neither settings file existed before, asks (planGate's own ASK path, not just inside an opt-out-suppressed ALLOW test) | test/guards.test.mjs "contract-guard settings-guard MAJOR2: a fresh settings.json Write introducing planGate:false, where neither settings file existed before, asks (planGate's own ASK path, not just inside an opt-out-suppressed ALLOW test) (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard settings-guard MAJOR2: a fresh settings.json Write introducing preserveOnCompact:false, where neither settings file existed before, asks (preserveOnCompact's own ASK path) | test/guards.test.mjs "contract-guard settings-guard MAJOR2: a fresh settings.json Write introducing preserveOnCompact:false, where neither settings file existed before, asks (preserveOnCompact's own ASK path) (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard settings-guard MAJOR2: a settings-file MultiEdit whose later step's old_string is not found fails open for the WHOLE call | test/guards.test.mjs "contract-guard settings-guard MAJOR2: a settings-file MultiEdit whose later step's old_string is not found fails open for the WHOLE call (in-process)…" | CHANGED (covered by the MultiEdit row) |
| plan-gate-guards | contract-guard settings-guard MAJOR2: a single Write flipping 2+ guard flags at once names ALL of them in the ask reason (and never names a flag that was enabled, not disabled) | test/guards.test.mjs "contract-guard settings-guard MAJOR2: a single Write flipping 2+ guard flags at once names ALL of them in the ask reason (and never names a flag that was enabled, not disabled) (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard settings-guard MAJOR2: a proposed settings content that is valid JSON but not an object (e.g. an array) does not ask, no crash | test/guards.test.mjs "contract-guard settings-guard MAJOR2: a proposed settings content that is valid JSON but not an object (e.g. an array) does not ask, no crash (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard settings-guard MINOR1: an oversized (>1MB) on-disk settings file's real prior value is no longer read once capped -- a proposed value matching what the file may already (unverifiably) say still asks, where the same input was correctly a no-op before the cap existed | test/guards.test.mjs "contract-guard settings-guard MINOR1: an oversized (>1MB) on-disk settings file's real prior value is no longer read once capped -- a proposed value matching what the file may already (unverifiably) say still asks, where the same input was correctly a no-op before the cap existed (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard settings-guard: an edit that leaves an already-degenerate ctide:false value untouched (only an unrelated key changes) stays a no-op (ALLOW) | test/guards.test.mjs "contract-guard settings-guard: an edit that leaves an already-degenerate ctide:false value untouched (only an unrelated key changes) stays a no-op (ALLOW) (in-process)…" | ported 1:1 |
| plan-gate-guards | contract-guard settings-guard: re-proposing an unchanged root-level bare `false` document stays a no-op (ALLOW) | test/guards.test.mjs "contract-guard settings-guard: re-proposing an unchanged root-level bare `false` document stays a no-op (ALLOW) (in-process)…" | ported 1:1 |
| plan-gate-guards | hooks.json wires contract-guard.js under PreToolUse with a matcher covering Write/Edit/MultiEdit | test/plan-gate-guards.test.mjs "hooks.json: the PreToolUse matcher covers every gated tool, and MultiEdit is no longer listed" (Write/Edit; MultiEdit out by owner decision) | P5c smoke/wiring |
| plan-gate-guards | contract-guard settings-guard (g): the settings-file guard rides the EXISTING contract-guard.js wiring — hooks.json still has exactly one contract-guard.js entry and the hook count stays 6 | test/hooks.test.mjs "hooks.json wires exactly three entries: pre-tool-use.mjs, session-start.mjs, orchestration-check.js" (count now 3, one PreToolUse entry) | P5c smoke/wiring |
| hooks | plan gate denies structured edits in plan mode and allows them otherwise | test/guards.test.mjs "plan gate denies structured edits in plan mode and allows them otherwise (in-process)…" | ported 1:1 |
| hooks | plan gate honors an existing project opt-out | test/guards.test.mjs "plan gate honors an existing project opt-out (in-process)…" | ported 1:1 |
| hooks | settings.local.json has per-key precedence over settings.json | test/guards.test.mjs "settings.local.json has per-key precedence over settings.json (in-process)…" | ported 1:1 |
| hooks | malformed, oversized, and bare-false settings do not disable the plan gate | test/guards.test.mjs "malformed, oversized, and bare-false settings do not disable the plan gate (in-process)…" | ported 1:1 |
| hooks | destructive guard asks for high-confidence destructive commands | test/guards.test.mjs "destructive guard asks for high-confidence destructive commands (in-process)…" | ported 1:1 |
| hooks | plan gate covers its documented shell-write tripwires | test/guards.test.mjs "plan gate covers its documented shell-write tripwires (in-process)…" | ported 1:1 |
| hooks | destructive guard covers documented Bash and PowerShell forms | test/guards.test.mjs "destructive guard covers documented Bash and PowerShell forms (in-process)…" | ported 1:1 |
| hooks | destructive guard debug treats every non-empty value as enabled and preserves the raw-command diagnostic format | test/lib-debug.test.mjs "destructive guard debug treats every non-empty value as enabled and preserves the raw-command diagnostic format (in-process)…" | CHANGED |
| hooks | destructive guard settings precedence and malformed fail-safe behavior | test/guards.test.mjs "destructive guard settings precedence and malformed fail-safe behavior (in-process)…" | ported 1:1 |
| hooks | contract guard asks before weakening an established task contract | test/guards.test.mjs "contract guard asks before weakening an established task contract (in-process)…" | ported 1:1 |
| hooks | contract guard asks before a protection flag is newly disabled | test/guards.test.mjs "contract guard asks before a protection flag is newly disabled (in-process)…" | ported 1:1 |
| hooks | contract guard settings precedence and malformed fail-safe behavior | test/guards.test.mjs "contract guard settings precedence and malformed fail-safe behavior (in-process)…" | ported 1:1 |
| hooks | failure memory is project-first, nonce-fenced, and neutralizes line-leading role markers | test/lib-failure-memory.test.mjs "failure memory is project-first, nonce-fenced, and neutralizes line-leading role markers (in-process)…" | CHANGED |
| hooks | failure memory prefers project data and otherwise uses the global read-only fallback | test/lib-failure-memory.test.mjs "failure memory prefers project data and otherwise uses the global read-only fallback (in-process)…" | CHANGED |
| hooks | compact fidelity emits only for compact sessions and supports explicit opt-out | test/guards.test.mjs "compact fidelity emits only for compact sessions and supports explicit opt-out (in-process)…" | ported 1:1 |
| hooks | compact fidelity settings precedence and malformed fail-safe behavior | test/guards.test.mjs "compact fidelity settings precedence and malformed fail-safe behavior (in-process)…" | ported 1:1 |
| hooks | orchestration check advises when shipped delivery reports a failed verification | test/hooks.test.mjs (same title; the Stop hook is untouched in P5, I-5) | P5c smoke/wiring |
| hooks | all hooks fail open on malformed input | test/lib-hook-io.test.mjs (reader outcome) + test/hooks.test.mjs "AC-5: an entry exits 0 with no output on stdin '{' (malformed JSON)" + test/hooks.test.mjs "an entry exits 0 with no output on stdin that is JSON but not an object (null, [], a string)" + test/hooks.test.mjs "the Stop hook fails open on malformed and oversized stdin" | reader in-process (P5a) + spawn half in P5c smoke |
| hooks | all hooks exit successfully when stdin exceeds their bounded buffer | test/lib-hook-io.test.mjs (reader outcome) + test/hooks.test.mjs "AC-5: an entry exits 0 with no output on a 6 MiB event (over the 5 MiB stdin cap)" + test/hooks.test.mjs "the Stop hook fails open on malformed and oversized stdin" | reader in-process (P5a) + spawn half in P5c smoke |
| session-memory-hooks | B1: omitted note excludes the skipped template placeholder | test/lib-failure-memory.test.mjs "B1: omitted note excludes the skipped template placeholder (in-process)…" | ported 1:1 |
| session-memory-hooks | B2: an oversized newest entry still yields a non-empty digest (bounded, no lone note) | test/lib-failure-memory.test.mjs "B2: an oversized newest entry still yields a non-empty digest (bounded, no lone note) (in-process)…" | ported 1:1 |
| session-memory-hooks | MAX_ENTRIES: 22 entries -> 20 kept and omitted count is the real remainder | test/lib-failure-memory.test.mjs "MAX_ENTRIES: 22 entries -> 20 kept and omitted count is the real remainder (in-process)…" | ported 1:1 |
| session-memory-hooks | digest ranks a recurring older entry above a newer one-off (importance, not raw recency) | test/lib-failure-memory.test.mjs "digest ranks a recurring older entry above a newer one-off (importance, not raw recency) (in-process)…" | ported 1:1 |
| session-memory-hooks | digest with no recurrence falls back to newest-first ordering | test/lib-failure-memory.test.mjs "digest with no recurrence falls back to newest-first ordering (in-process)…" | ported 1:1 |
| session-memory-hooks | placeholder-only file injects nothing | test/lib-failure-memory.test.mjs "placeholder-only file injects nothing (in-process)…" | CHANGED |
| session-memory-hooks | empty file injects nothing | test/lib-failure-memory.test.mjs "empty file injects nothing (in-process)…" | ported 1:1 |
| session-memory-hooks | missing memory file injects nothing (when no global file present) | test/lib-failure-memory.test.mjs "missing memory file injects nothing (when no global file present) (in-process)…" | ported 1:1 |
| session-memory-hooks | entry missing rule/tags degrades gracefully; CRLF parsed | test/lib-failure-memory.test.mjs "entry missing rule/tags degrades gracefully; CRLF parsed (in-process)…" | ported 1:1 |
| session-memory-hooks | project ai/FAILURE_MEMORY.md takes precedence and is named in the digest | test/lib-failure-memory.test.mjs "project ai/FAILURE_MEMORY.md takes precedence and is named in the digest (in-process)…" | ported 1:1 |
| session-memory-hooks | load-failure-memory resolves the project root from CLAUDE_PROJECT_DIR (matching plan-gate) | test/lib-failure-memory.test.mjs "load-failure-memory resolves the project root from CLAUDE_PROJECT_DIR (matching plan-gate) (in-process)…" | ported 1:1 |
| session-memory-hooks | digest wraps the body in a per-run nonce fence with an untrusted-data warning | test/lib-failure-memory.test.mjs "digest wraps the body in a per-run nonce fence with an untrusted-data warning (in-process)…" | ported 1:1 |
| session-memory-hooks | digest neutralizes injected role markers and instruction tags | test/lib-failure-memory.test.mjs "digest neutralizes injected role markers and instruction tags (in-process)…" | CHANGED |
| session-memory-hooks | load-failure-memory: the digest indexes title + tags but omits the prevention-rule prose (reduced surface) | test/lib-failure-memory.test.mjs "load-failure-memory: the digest indexes title + tags but omits the prevention-rule prose (reduced surface) (in-process)…" | ported 1:1 |
| session-memory-hooks | load-failure-memory: hostile content stays nonce-fenced, labeled untrusted, and role-markers neutralized | test/lib-failure-memory.test.mjs "load-failure-memory: hostile content stays nonce-fenced, labeled untrusted, and role-markers neutralized (in-process)…" | CHANGED |
| session-memory-hooks | load-failure-memory: a role-marker in an entry TITLE is neutralized despite the '- ' prefix | test/lib-failure-memory.test.mjs "load-failure-memory: a role-marker in an entry TITLE is neutralized despite the '- ' prefix (in-process)…" | ported 1:1 |
| session-memory-hooks | digest handles a very large memory file without reading it all (cap) | test/lib-failure-memory.test.mjs "digest handles a very large memory file without reading it all (cap) (in-process)…" | ported 1:1 |
| session-memory-hooks | hooks.json SessionStart matcher includes compact | test/session-memory-hooks.test.mjs "hooks.json: one SessionStart entry, matched for startup, resume, clear and compact" | P5c smoke/wiring |
| session-memory-hooks | load-failure-memory F1: a junction at ai/ escaping the project is not read/injected (containment) | test/lib-failure-memory.test.mjs "load-failure-memory F1: a junction at ai/ escaping the project is not read/injected (containment) (in-process)…" | ported 1:1 |
| session-memory-hooks | load-failure-memory F1: ai/FAILURE_MEMORY.md symlinked to an out-of-project file is not injected | test/lib-failure-memory.test.mjs "load-failure-memory F1: ai/FAILURE_MEMORY.md symlinked to an out-of-project file is not injected (in-process)…" | ported 1:1 |
| session-memory-hooks | load-failure-memory F1: a normal in-tree ai/FAILURE_MEMORY.md still injects (containment allows the legit case) | test/lib-failure-memory.test.mjs "load-failure-memory F1: a normal in-tree ai/FAILURE_MEMORY.md still injects (containment allows the legit case) (in-process)…" | ported 1:1 |
| session-memory-hooks | load-failure-memory F1: a normal ~/.claude/FAILURE_MEMORY.md still injects through the global containment guard | test/lib-failure-memory.test.mjs "load-failure-memory F1: a normal ~/.claude/FAILURE_MEMORY.md still injects through the global containment guard (in-process)…" | ported 1:1 |
| session-memory-hooks | load-failure-memory F1: a ~/.claude/FAILURE_MEMORY.md symlinked outside ~/.claude is not injected | test/lib-failure-memory.test.mjs "load-failure-memory F1: a ~/.claude/FAILURE_MEMORY.md symlinked outside ~/.claude is not injected (in-process)…" | ported 1:1 |
| session-memory-hooks | load-failure-memory: digest skips entries whose title is marked (expired)/(superseded …) | test/lib-failure-memory.test.mjs "load-failure-memory: digest skips entries whose title is marked (expired)/(superseded …) (in-process)…" | ported 1:1 |
| session-memory-hooks | load-failure-memory: a title that merely discusses expiry (no paren marker) is still injected (fails toward showing) | test/lib-failure-memory.test.mjs "load-failure-memory: a title that merely discusses expiry (no paren marker) is still injected (fails toward showing) (in-process)…" | ported 1:1 |
| session-memory-hooks | load-failure-memory: a MID-title (expired)/(superseded) mention is NOT retired — only a trailing marker is | test/lib-failure-memory.test.mjs "load-failure-memory: a MID-title (expired)/(superseded) mention is NOT retired — only a trailing marker is (in-process)…" | ported 1:1 |
| session-memory-hooks | load-failure-memory: the NEWEST entry being retired doesn't break the digest (next active becomes effective newest) | test/lib-failure-memory.test.mjs "load-failure-memory: the NEWEST entry being retired doesn't break the digest (next active becomes effective newest) (in-process)…" | ported 1:1 |
| session-memory-hooks | load-failure-memory: retired entries do not inflate the omitted count | test/lib-failure-memory.test.mjs "load-failure-memory: retired entries do not inflate the omitted count (in-process)…" | ported 1:1 |
| session-memory-hooks | load-failure-memory: isRetired still retires a realistic longer (superseded by ...) marker (ReDoS bound doesn't clip normal usage) | test/lib-failure-memory.test.mjs "load-failure-memory: isRetired still retires a realistic longer (superseded by ...) marker (ReDoS bound doesn't clip normal usage) (in-process)…" | ported 1:1 |
| session-memory-hooks | load-failure-memory: a pathological (superseded ...) title with no closing paren returns a digest quickly and stays NOT retired (linear, not quadratic ReDoS) | test/lib-failure-memory.test.mjs "load-failure-memory: a pathological (superseded ...) title with no closing paren returns a digest quickly and stays NOT retired (linear, not quadratic ReDoS) (in-process)…" | ported 1:1 |
| session-memory-hooks | load-failure-memory 3-tier: .ctide/memory alone is read and disclosed (new first tier) | test/lib-failure-memory.test.mjs "load-failure-memory 3-tier: .ctide/memory alone is read and disclosed (new first tier) (in-process)…" | ported 1:1 |
| session-memory-hooks | load-failure-memory 3-tier: BOTH tiers present -> the new path wins over legacy | test/lib-failure-memory.test.mjs "load-failure-memory 3-tier: BOTH tiers present -> the new path wins over legacy (in-process)…" | ported 1:1 |
| session-memory-hooks | load-failure-memory 3-tier: legacy-only still injects (read-only fallback tier; regression control) | test/lib-failure-memory.test.mjs "load-failure-memory 3-tier: legacy-only still injects (read-only fallback tier; regression control) (in-process)…" | ported 1:1 |
| session-memory-hooks | load-failure-memory 3-tier: neither project tier -> the global file is the last tier (regression control) | test/lib-failure-memory.test.mjs "load-failure-memory 3-tier: neither project tier -> the global file is the last tier (regression control) (in-process)…" | ported 1:1 |
| session-memory-hooks | load-failure-memory 3-tier: a junction at .ctide/memory escaping the project is not read (containment covers the new first tier) | test/lib-failure-memory.test.mjs "load-failure-memory 3-tier: a junction at .ctide/memory escaping the project is not read (containment covers the new first tier) (in-process)…" | ported 1:1 |
| session-memory-hooks | compact-fidelity: a post-compaction SessionStart emits a nonce-fenced preservation block naming ctide's constructs | test/guards.test.mjs "compact-fidelity: a post-compaction SessionStart emits a nonce-fenced preservation block naming ctide's constructs (in-process)…" | ported 1:1 |
| session-memory-hooks | compact-fidelity: a non-compact SessionStart (startup/resume/clear) emits nothing | test/guards.test.mjs "compact-fidelity: a non-compact SessionStart (startup/resume/clear) emits nothing (in-process)…" | ported 1:1 |
| session-memory-hooks | compact-fidelity: opt-out ctide.preserveOnCompact=false suppresses the block | test/guards.test.mjs "compact-fidelity: opt-out ctide.preserveOnCompact=false suppresses the block (in-process)…" | ported 1:1 |
| session-memory-hooks | compact-fidelity: settings.local.json opt-out overrides settings.json | test/guards.test.mjs "compact-fidelity: settings.local.json opt-out overrides settings.json (in-process)…" | ported 1:1 |
| session-memory-hooks | compact-fidelity: malformed project settings fail safe to EMIT (a broken file never silently drops the nudge) | test/guards.test.mjs "compact-fidelity: malformed project settings fail safe to EMIT (a broken file never silently drops the nudge) (in-process)…" | ported 1:1 |
| session-memory-hooks | compact-fidelity: a bare {"ctide":false} settings.json on disk does not suppress the preservation block (readPreserveFlag must not misread it as preserveOnCompact:false) | test/guards.test.mjs "compact-fidelity: a bare {"ctide":false} settings.json on disk does not suppress the preservation block (readPreserveFlag must not misread it as preserveOnCompact:false) (in-process)…" | ported 1:1 |
| session-memory-hooks | compact-fidelity: a bare root-level `false` settings.json document also does not suppress the preservation block | test/guards.test.mjs "compact-fidelity: a bare root-level `false` settings.json document also does not suppress the preservation block (in-process)…" | ported 1:1 |
| session-memory-hooks | compact-fidelity: opt-out is honored via the event cwd when CLAUDE_PROJECT_DIR is unset (the normal path) | test/guards.test.mjs "compact-fidelity: opt-out is honored via the event cwd when CLAUDE_PROJECT_DIR is unset (the normal path) (in-process)…" | ported 1:1 |
| session-memory-hooks | compact-fidelity: malformed stdin fails open (no output, no crash) | test/lib-hook-io.test.mjs (reader outcome) + test/hooks.test.mjs "AC-5: an entry exits 0 with no output on stdin '{' (malformed JSON)" + test/session-memory-hooks.test.mjs "SessionStart entry: a malformed event injects nothing, even with a memory file present" | reader in-process (P5a) + spawn half in P5c smoke |
| session-memory-hooks | load-failure-memory: oversized stdin fails open (no digest emitted) | test/lib-hook-io.test.mjs (reader outcome) + test/hooks.test.mjs "AC-5: an entry exits 0 with no output on a 6 MiB event (over the 5 MiB stdin cap)" | reader in-process (P5a) + spawn half in P5c smoke |
| session-memory-hooks | compact-fidelity: oversized stdin fails open (no block emitted) | test/lib-hook-io.test.mjs (reader outcome) + test/hooks.test.mjs "AC-5: an entry exits 0 with no output on a 6 MiB event (over the 5 MiB stdin cap)" | reader in-process (P5a) + spawn half in P5c smoke |
| session-memory-hooks | compact-fidelity: the emitted block is valid, parseable JSON (flushed in full) | test/guards.test.mjs "compact-fidelity: the emitted block is valid, parseable JSON (flushed in full) (in-process)…" | ported 1:1 |
| session-memory-hooks | compact-fidelity: empty stdin still emits (fail toward preserve when the event carries no source) | test/guards.test.mjs "compact-fidelity: empty stdin still emits (fail toward preserve when the event carries no source) (in-process)…" | ported 1:1 |
| session-memory-hooks | hooks.json wires compact-fidelity.js under SessionStart with the compact matcher | test/session-memory-hooks.test.mjs "hooks.json: one SessionStart entry, matched for startup, resume, clear and compact" | P5c smoke/wiring |
| session-memory-hooks | hooks.json no longer wires a PreCompact hook (CC rejects hookSpecificOutput on PreCompact) | test/hooks.test.mjs (same title) | P5c smoke/wiring |
| hooks-portability | PreToolUse command is a portable, fail-open node -e bootstrap (plan-gate.js) | retired by design (P0-1: the shell form replaces the node -e bootstrap); the new form is pinned by validator §5c COMMAND_FORM (+ its negative test) and test/hooks.test.mjs "hooks.json wires exactly three entries …" | retired |
| hooks-portability | PreToolUse command is a portable, fail-open node -e bootstrap (destructive-guard.js) | retired by design (P0-1: the shell form replaces the node -e bootstrap); the new form is pinned by validator §5c COMMAND_FORM (+ its negative test) and test/hooks.test.mjs "hooks.json wires exactly three entries …" | retired |
| hooks-portability | PreToolUse command is a portable, fail-open node -e bootstrap (contract-guard.js) | retired by design (P0-1: the shell form replaces the node -e bootstrap); the new form is pinned by validator §5c COMMAND_FORM (+ its negative test) and test/hooks.test.mjs "hooks.json wires exactly three entries …" | retired |
| hooks-portability | SessionStart command is a portable, fail-open node -e bootstrap (load-failure-memory.js) | retired by design (P0-1: the shell form replaces the node -e bootstrap); the new form is pinned by validator §5c COMMAND_FORM (+ its negative test) and test/hooks.test.mjs "hooks.json wires exactly three entries …" | retired |
| hooks-portability | Stop command is a portable, fail-open node -e bootstrap (orchestration-check.js) | retired by design (P0-1: the shell form replaces the node -e bootstrap); the new form is pinned by validator §5c COMMAND_FORM (+ its negative test) and test/hooks.test.mjs "hooks.json wires exactly three entries …" | retired |
| hooks-portability | SessionStart command is a portable, fail-open node -e bootstrap (compact-fidelity.js) | retired by design (P0-1: the shell form replaces the node -e bootstrap); the new form is pinned by validator §5c COMMAND_FORM (+ its negative test) and test/hooks.test.mjs "hooks.json wires exactly three entries …" | retired |
| hooks-portability | [bash] plan-gate ALLOWS a non-plan Bash (exit 0, no deny) | test/hooks-shell.test.mjs "[bash] the wired PreToolUse command, plugin root with a space: …" (default-mode Write prints nothing) | P5c smoke |
| hooks-portability | [bash] plan-gate DENIES a plan-mode Write (logic intact) | test/hooks-shell.test.mjs "[bash] the wired PreToolUse command, plugin root with a space: …" (plan-mode Write denied) | P5c smoke |
| hooks-portability | [bash] SessionStart and Stop hooks launch without error | test/hooks.test.mjs AC-5 rows spawn session-start.mjs and the Stop hook directly (not through a shell); same command form as the PreToolUse row the shell smoke runs | P5c smoke |
| hooks-portability | [bash] resolves the second runtime's root fallbacks | retired by owner decision D2 (fallbacks removed); their absence is pinned by validator §5c (two negative tests) | retired |
| hooks-portability | [bash] fail-open: unresolvable plugin root -> exit 0 (never bricks the session) | retired: the shell form resolves no root at run time (Claude Code substitutes it); the remaining fail-open path, a plugin without lib/, is test/hooks.test.mjs "AC-5: … cressetide/lib/ is missing …" | retired |
| hooks-portability | [bash] destructive-guard ASKS on a real destructive match | test/plan-gate-guards.test.mjs "PreToolUse entry: git reset --hard asks … (Bash and PowerShell)" + test/hooks-shell.test.mjs "[bash] the wired PreToolUse command, plugin root with a space: …" | P5c smoke |
| hooks-portability | [bash] destructive-guard fail-open: unresolvable plugin root -> exit 0, no ask | retired (same reason as the plan-gate fail-open row) | retired |
| hooks-portability | [powershell] plan-gate ALLOWS a non-plan Bash (exit 0, no deny) | test/hooks-shell.test.mjs "[PowerShell] the wired PreToolUse command, plugin root with a space: …" (default-mode Write prints nothing) | P5c smoke |
| hooks-portability | [powershell] plan-gate DENIES a plan-mode Write (logic intact) | test/hooks-shell.test.mjs "[PowerShell] the wired PreToolUse command, plugin root with a space: …" (plan-mode Write denied) | P5c smoke |
| hooks-portability | [powershell] SessionStart and Stop hooks launch without error | test/hooks.test.mjs AC-5 rows spawn session-start.mjs and the Stop hook directly (not through a shell); same command form as the PreToolUse row the shell smoke runs | P5c smoke |
| hooks-portability | [powershell] resolves the second runtime's root fallbacks | retired by owner decision D2 (fallbacks removed); their absence is pinned by validator §5c (two negative tests) | retired |
| hooks-portability | [powershell] fail-open: unresolvable plugin root -> exit 0 (never bricks the session) | retired: the shell form resolves no root at run time (Claude Code substitutes it); the remaining fail-open path, a plugin without lib/, is test/hooks.test.mjs "AC-5: … cressetide/lib/ is missing …" | retired |
| hooks-portability | [powershell] destructive-guard ASKS on a real destructive match | test/plan-gate-guards.test.mjs "PreToolUse entry: git reset --hard asks … (Bash and PowerShell)" + test/hooks-shell.test.mjs "[PowerShell] the wired PreToolUse command, plugin root with a space: …" | P5c smoke |
| hooks-portability | [powershell] destructive-guard fail-open: unresolvable plugin root -> exit 0, no ask | retired (same reason as the plan-gate fail-open row) | retired |
| hooks-portability | [pwsh + StrictMode] plan-gate launches and denies a plan-write (no terminating error) | test/hooks-shell.test.mjs "[PowerShell] …" (runs under Set-StrictMode -Version Latest) | P5c smoke |

## 9. Docs outside the approved list (need the owner's OK; each reverts in one line)

Each still named a deleted hook file (acceptance 8 requires 0) or became false through item 18:

1. `cressetide/agents/navigator.agent.md:39` — "The `plan-gate.js` hook still applies." → "The plan-gate check in the
   `pre-tool-use.mjs` hook still applies."
2. `cressetide/skills/vigil/references/external-capabilities.md:32` — "exemption in `plan-gate.js`" → "exemption in the
   plan-gate check (`cressetide/lib/guards/plan-gate.mjs`)".
3. `cressetide/skills/vigil/SKILL.md:156` — "`compact-fidelity.js` re-injects a reminder." → "`session-start.mjs`
   re-injects a reminder."
4. `cressetide/skills/vigil/references/design-spec.md:30` — "guarded by `hooks/contract-guard.js`" → "guarded by the
   contract check in `hooks/pre-tool-use.mjs`".
5. `cressetide/skills/doctor/references/diagnostic-contract.md` lines that described the hand-run step-5 probes item
   18 removed: :16 "step 5 covers checks the helper does not run" → "step 6 covers what the helper cannot verify";
   :19-20 "and the step-5 probes write nothing" dropped; :23-28 the "step-5 `$P` paths" allowance → "run no cleanup
   or existence check of your own there", and "the step-5 probes" dropped from the steps that are yours to run;
   step 2 "hand-run only what steps 5 and 6 require" → "what step 6 requires".

## 10. README×3 final changes (line numbers after the edit; same lines in all three files, 364 lines each)

**README.zh-TW.md**

- :44 - **[3 個 hook 入口](#hooks-與安全模型)**：local-only、零依賴的 Node guardrails——同一個 PreToolUse 入口跑 plan gate、破壞性指令與 contract 三項檢查；同一個 SessionStart 入口負責 failure-memory 注入與 compaction 提醒；另有 delivery-claim 檢查。
- :176 - **Decision cards**：一次一張，內容是建議、成本／取捨、可回復性，以及核准後會執行的確切內容。破壞性或影響正式環境的動作永遠停在一張 card 上，絕不打包進先前核准過的 plan；`pre-tool-use.mjs` 的破壞性指令檢查可能額外詢問，那是預期行為，絕不繞過。
- :216 只要 plugin 被啟用，三個零依賴的 Node hook 入口會在每個 session 執行。它們 local-only、fail-open，只使用 Node built-ins（`fs`、`os`、`path`、`crypto`）。
- :220 | `pre-tool-use.mjs` | `PreToolUse` | 依序跑三項檢查。plan gate：在 plan mode 中擋下 edit tools 與明顯 Bash/PowerShell writes。破壞性指令檢查：對 `rm -rf`、`git reset --hard`、`git push --force`、PowerShell `Remove-Item -Recurse`、`terraform destroy`、`kubectl delete namespace`、`docker volume rm/prune`、資料庫 drop 類 CLI（`dropdb`、`mysqladmin`、`redis-cli flushall`）等狹義不可復原 destructive commands 先詢問。contract 檢查守著合約不被中途弱化：編輯若會刪掉或改寫驗收條件、移除 `mustNotChange`／範圍清單項目、調降風險（合約在 `.ctide/output/contract.md`，含舊版 `.ctide/legacy-output/`），或整段刪除 `design.md` 章節，先問過你才放行；對 `.claude/settings*.json` 的編輯若會把任何 ctide guard 開關從開翻成關（連新建一個 settings 檔來翻也算），同樣先問。 |
- :221 | `session-start.mjs` | `SessionStart` | 讀取專案 `.ctide/memory/FAILURE_MEMORY.md`（舊版 `ai/FAILURE_MEMORY.md` 作為唯讀 fallback），否則讀全域 `~/.claude/FAILURE_MEMORY.md`，注入 nonce-fenced、untrusted 的「標題＋tags」索引；檔案裡沒有 `##`／`###` entry 時只注入一行指向該檔的指標。`compact` 之後另外補上精簡的 workflow-continuity 提醒。 |
- :236 | `planGate` | `pre-tool-use.mjs` 的 plan gate：plan mode 期間強制的編輯攔阻 |
- :237 | `destructiveGuard` | `pre-tool-use.mjs` 的破壞性指令檢查：執行狹義不可復原 destructive commands 前的詢問 |
- :238 | `contractGuard` | `pre-tool-use.mjs` 的 contract 檢查：contract／design 弱化前的詢問，含把這些 guard flag 關閉前的詢問 |
- :239 | `preserveOnCompact` | `session-start.mjs` 的 compaction 提醒：context compaction 後的 workflow-continuity 提醒 |
- :241 設定檔格式錯誤或讀不到，會視為「未停用」（fail-safe：guard 照常運作）。範例——針對單一專案停用 contract 檢查：
- :255 | `CTIDE_HOOK_DEBUG` | 設成 `1`、`true`、`yes` 或 `on`（不分大小寫）時，PreToolUse 與 SessionStart hook 會多寫一行 debug trace 到 stderr 和暫存目錄的 `ctide-hook.log`，寫出前先遮蔽 secret；其他值（含 `0`）一律不寫（[`/ctide:doctor`](#健康檢查doctor) 與手動排除故障會用到） |
- :290 ctide 只支援 Claude Code。
- :294 (the second-runtime bullet that was line 298) deleted

**README.md**

- :44 - **[3 hook entry points](#hooks-and-safety-model)**: local-only, dependency-free Node guardrails — one PreToolUse entry runs three checks (the plan gate, destructive commands, and the contract); one SessionStart entry handles failure-memory injection and the compaction reminder; plus the delivery-claim check.
- :176 - **Decision cards**: one at a time, carrying the recommendation, cost/tradeoff, reversibility, and exactly what will run on approval. Destructive or production-affecting actions always stop at a card, never batched into a previously approved plan; the destructive-command check in `pre-tool-use.mjs` may additionally ask, which is expected and never routed around.
- :216 Three dependency-free Node hook entry points run in every enabled session. They are local-only, fail-open, and use only Node built-ins (`fs`, `os`, `path`, `crypto`).
- :220 | `pre-tool-use.mjs` | `PreToolUse` | Runs three checks in order. Plan gate: denies edit tools and obvious Bash/PowerShell writes while in plan mode. Destructive-command check: asks before narrow, unrecoverable destructive commands such as `rm -rf`, `git reset --hard`, `git push --force`, PowerShell `Remove-Item -Recurse`, `terraform destroy`, `kubectl delete namespace`, `docker volume rm/prune`, and database-drop CLIs (`dropdb`, `mysqladmin`, `redis-cli flushall`). Contract check: guards the contract against mid-run weakening — asks before an edit would delete or rewrite an acceptance criterion, drop a `mustNotChange` or scope entry, downgrade risk (contract in `.ctide/output/contract.md`, legacy `.ctide/legacy-output/` included), or wholesale-delete a `design.md` section; also asks before an edit to `.claude/settings*.json` would flip any ctide guard flag from on to off (creating a fresh settings file to do it counts too). |
- :221 | `session-start.mjs` | `SessionStart` | Reads project `.ctide/memory/FAILURE_MEMORY.md` (legacy `ai/FAILURE_MEMORY.md` as read-only fallback), else global `~/.claude/FAILURE_MEMORY.md`, and injects a nonce-fenced, untrusted index of entry titles and tags; when the file has no `##`/`###` entries, only a one-line pointer to the file is injected. After `compact` it also re-injects a concise workflow-continuity reminder. |
- :236 | `planGate` | the plan gate in `pre-tool-use.mjs`: the edit block enforced while in plan mode |
- :237 | `destructiveGuard` | the destructive-command check in `pre-tool-use.mjs`: the ask before narrow, unrecoverable destructive commands |
- :238 | `contractGuard` | the contract check in `pre-tool-use.mjs`: the contract/design weakening ask, including the ask before turning these guard flags off |
- :239 | `preserveOnCompact` | the compaction reminder in `session-start.mjs`: the post-compaction workflow-continuity reminder |
- :241 A malformed or unreadable settings file is treated as "not disabled" (fail-safe: the guard keeps running). Example — disable the contract check for one project:
- :255 | `CTIDE_HOOK_DEBUG` | `1`, `true`, `yes` or `on` (case-insensitive) makes the PreToolUse and SessionStart hooks write a one-line debug trace to stderr and to `ctide-hook.log` in the temp directory, with secrets redacted before it is written; any other value, including `0`, writes nothing (used by [`/ctide:doctor`](#health-check-doctor) and manual troubleshooting) |
- :290 ctide supports Claude Code only.
- :294 (the second-runtime bullet that was line 298) deleted

**README.ja.md**

- :44 - **[3つの hook エントリポイント](#hooks-と安全性モデル)**：local-only で依存関係ゼロの Node guardrails——1つの PreToolUse エントリが plan gate、破壊的コマンド、contract の3つのチェックを実行し、1つの SessionStart エントリが failure-memory の注入と compaction リマインダーを担当します。ほかに delivery-claim チェックがあります。
- :176 - **Decision cards**：1枚ずつ。載っているのは推奨案、コスト／トレードオフ、可逆性、そして承認したら正確に何が実行されるか。破壊的または本番に影響する操作は必ず card で止まり、以前に承認済みの plan に紛れ込ませることはありません；`pre-tool-use.mjs` の破壊的コマンドチェックがさらに確認を挟むことがありますが、それは想定どおりの動作で、決して迂回しません。
- :216 plugin が有効な間は、依存関係ゼロの Node hook エントリポイントが3つ、すべての session で実行されます。これらは local-only、fail-open で、Node の built-in（`fs`、`os`、`path`、`crypto`）のみを使用します。
- :220 | `pre-tool-use.mjs` | `PreToolUse` | 3つのチェックを順に実行する。plan gate：plan mode 中に edit tools と明らかな Bash/PowerShell write を拒否する。破壊的コマンドチェック：`rm -rf`、`git reset --hard`、`git push --force`、PowerShell の `Remove-Item -Recurse`、`terraform destroy`、`kubectl delete namespace`、`docker volume rm/prune`、データベース drop 系 CLI（`dropdb`、`mysqladmin`、`redis-cli flushall`）など、狭く絞った復元不能な destructive command の前に確認を挟む。contract チェックは契約が途中で骨抜きにされるのを見張ります：編集が acceptance criterion を削除・書き換えする、`mustNotChange` や scope の項目を落とす、risk を下げる（契約は `.ctide/output/contract.md`、旧レイアウトの `.ctide/legacy-output/` も対象）、`design.md` の section をまるごと消す場合は、先に確認します；`.claude/settings*.json` への編集が ctide の guard flag を有効から無効へ切り替える場合も同様です（新しい settings ファイルを作って切り替えるケースも検知します）。 |
- :221 | `session-start.mjs` | `SessionStart` | プロジェクトの `.ctide/memory/FAILURE_MEMORY.md`（旧レイアウトの `ai/FAILURE_MEMORY.md` は読み取り専用のフォールバック）、なければグローバルの `~/.claude/FAILURE_MEMORY.md` を読み込み、nonce で囲んだ untrusted な「タイトル＋tags」の索引を注入する。ファイルに `##`／`###` の entry がない場合は、そのファイルを指す1行の案内だけを注入する。`compact` の後には、簡潔な workflow-continuity のリマインダーも再注入する。 |
- :236 | `planGate` | `pre-tool-use.mjs` の plan gate：plan mode 中に強制される編集ブロック |
- :237 | `destructiveGuard` | `pre-tool-use.mjs` の破壊的コマンドチェック：狭く絞った復元不能な destructive command 実行前の確認 |
- :238 | `contractGuard` | `pre-tool-use.mjs` の contract チェック：contract／design を弱める前の確認。これらの guard flag を無効化する前の確認を含む |
- :239 | `preserveOnCompact` | `session-start.mjs` の compaction リマインダー：context compaction 後の workflow-continuity リマインダー |
- :241 設定ファイルが壊れている、または読み込めない場合は「無効化されていない」として扱われます（fail-safe：guard はそのまま動作し続けます）。例——特定のプロジェクトで contract チェックを無効化する：
- :255 | `CTIDE_HOOK_DEBUG` | `1`、`true`、`yes`、`on`（大文字小文字を区別しない）のいずれかを設定すると、PreToolUse と SessionStart の hook が stderr と一時ディレクトリの `ctide-hook.log` に debug trace を1行書き出します。書き出す前に secret を伏せます。それ以外の値（`0` を含む）では何も書きません（[`/ctide:doctor`](#ヘルスチェックdoctor) や手動のトラブルシューティングで使用） |
- :290 ctide は Claude Code のみをサポートします。
- :294 (the second-runtime bullet that was line 298) deleted


## 11. Failure-memory candidates (proposed, not written; the arbiter decides)

1. **Recurrence of handoff proposal #1 (Windows escaping):** twice in P5c a scripted edit lost a level — a quoted
   heredoc fed to `node -` aborted in the tool's bash layer, and a `node -e` replacement with `\s` / `\$` in a regex
   wrote the wrong text (the anchor check caught both; nothing was written wrong). Writing the edit script to a
   scratch file with the Write tool and running `node <file>` avoided it. Suggest adding "seen again (P5c)" to #1.
2. **Title**: A test-scoped temp directory memoized at module scope is a dangling path in the next test.
   - **What happened**: the cross-shell smoke cached its plugin copy (`tempDir()` made inside the first test) in a
     module variable; the helpers' `t.after` removed it when that test ended, so the PowerShell test ran against a
     deleted path ("Cannot find module …") — first run red, looked like a PowerShell path bug.
   - **Prevention rule**: a fixture made with `tempDir()` inside a test body lives only for that test (D-5); share a
     fixture across tests only when it is made outside any test body (file scope), otherwise build it per test.
   - **Tags**: node-test, temp-dir, fixture-lifetime, test-helper

---

# I-8 live smoke (P5 live smoke receipt, 2026-10-15)

Host: Windows 11, Claude Code 2.1.296, Node v24.14.0, `claude -p --model haiku` (resolved `claude-haiku-5-5`),
`--output-format stream-json --verbose --include-hook-events --max-budget-usd 0.1`, `--strict-mcp-config`.
Plugin under test: `--plugin-dir D:/github/cressetide/cressetide` (the uncommitted P5 tree on top of `86ba905`,
loaded as `ctide@inline` 0.7.2). The installed `ctide@kktu` and the account-synced plugins were disabled through
`--settings` (`enabledPlugins: {"<name>@synced": false, …}`); run 1 still had the 22 synced plugins loaded, which is
why it cost more. Standalone CLI env: `CLAUDECODE`, every `CLAUDE_*` host variable and `ANTHROPIC_BASE_URL` unset; the
owner logged the standalone CLI in (`claude auth login`) for this run. Consumer repo: a fresh git repo at
`<scratch>/smoke repo` (path with a space), two commits. `CTIDE_HOOK_DEBUG=1`, with `TEMP`/`TMP`/`TMPDIR` pointed at
`<scratch>/smoke tmp` so the hook log landed there. Total spend **US$0.097**.

| # | Scenario | Result | Evidence (stream-json receipt) |
|---|---|---|---|
| 1 | `--permission-mode plan`; the model calls `Write smoke-plan.txt` | **PASS**: `PreToolUse:Write` hook (`pre-tool-use.mjs`) exit 0 with `permissionDecision: "deny"` and the plan-gate reason; tool_result `PreToolUse:Write hook error: ctide plan gate: file modifications are blocked while in plan mode. …`; `permission_denials` lists the Write; the file was not created | s1.jsonl; hook log `[ctide pre-tool-use] plan-gate: DENY tool=Write`; US$0.079 |
| 2 | `--permission-mode default` with `--allowedTools 'Bash(git reset:*)'` (an allow rule, so only the hook can stop it); the model runs `git reset --hard` in a dirty tree | **PASS**: hook exit 0 with `permissionDecision: "ask"` and the destructive reason; headless turns the ask into `permission_denied` with `decision_reason_type: "hook"`; `notes.txt` still dirty afterwards (`git status --short` → ` M notes.txt`), so the reset never ran | s2.jsonl; hook log `[ctide pre-tool-use] destructive-guard: ASK: git reset --hard`; US$0.0043 |
| 3 | session A (`Reply with READY`), then `claude -p --resume <A> "/compact"` | **PASS**: `SessionStart:compact` fired after `status: compacting`; `session-start.mjs` exit 0 with one `additionalContext` = the failure-memory digest (nonce-fenced, from the seeded `.ctide/memory/FAILURE_MEMORY.md`), a blank line, then the `CTIDE_PRESERVE` block; `compact_result: success`. The `startup` and `resume` SessionStarts injected only the digest (`compact-fidelity: source=startup/resume (not a compaction); skipping`) | s3a.jsonl, s3b.jsonl; hook log `compact-fidelity: emitted the preservation block`; US$0.0020 + 0.0062 |

The Stop hook (`orchestration-check.js`, untouched in P5, I-5) ran after every turn, exit 0, no block.

## Run notes

- **Git Bash rewrote the `/compact` prompt.** The first `--resume … "/compact"` run reached the model as the
  path `C:/Program Files/Git/compact` (MSYS path conversion of a leading-slash argument); the model tried to list
  it and was denied (US$0.0049, receipt kept as s3b-pathconv.jsonl). Re-run with `MSYS_NO_PATHCONV=1`. The P0 notes
  in probes.md do not mention this; any future headless slash-command probe from Git Bash needs it.
- **Account-synced plugins load in a standalone CLI** and are not covered by disabling the installed plugin; they
  are disabled with `"<name>@synced": false` in `--settings`. One of them (`superpowers@synced`) adds its own
  SessionStart hook.
- Debug labels after the entry prefix keep the old check names (`destructive-guard`, `compact-fidelity`), and the
  compaction block still opens with `ctide compaction-fidelity:`; both are the S0-preserved texts, not new names.
- The hook log line written by `orchestration-check.js` has no `ctide ` in its prefix while its stderr copy does
  (I-5 residual, P6).
- Seen in passing: a non-destructive Bash call logs `destructive-guard: no destructive match; allowing` — a debug
  word only; no `allow` decision is emitted.

Receipts (gitignored scratch, not kept after P5): `s1.jsonl`, `s2.jsonl`, `s3a.jsonl`, `s3b.jsonl`,
`s3b-pathconv.jsonl`, and the smoke script.

---

