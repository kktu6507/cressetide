# Review round 1 (P1 + P2) — packet, findings, arbiter verdict, repair status

> 原檔在 gitignored 的 `.ctide/output/review/`。這裡是交接用的合併版。

## Arbiter verdict (round 1, HEAD 5afc115): FIX REQUIRED

- Blockers: none. Majors (all confirmed by the arbiter's own reproduction):
  - **M1** ship disclaimer contained the machine token `READY` → the plugin's own Stop hook (`orchestration-check.js`) emitted a false "panel did not run" advisory on every ship session; the test was tautological (compared against the module's own export, stripped before scanning).
  - **M2** two release-tag definitions (pending used a `git describe` glob; marker used `TAG_VERSION_RE`) → pre-release / four-part tags hid unreleased commits; bare `1.0.0` reported `no-release-tag`.
  - **M3** `isShallowClone` checked `<cwd>/.git/shallow` → subdirectory / worktree `--cwd` of a shallow clone reported `ok` with a silent undercount.
  - **M4** the `unverified` read-failure branch of `pendingChanges` had no test.
  - **M5** the new "assert only what a source states" rule contradicted the existing implied-edge-input mandate (arbiter withholds READY without edge tests).
  - **M6** edge-checklist inputs untested (Unicode+space names, empty repo, exact caps).
- AC check: AC1 unmet as evidenced (npm test exit 1 from load-timing tests); AC2 met (archive tag holds 146/146 deleted paths) pending D-1; AC3 met on content (M5 separately); AC4 met; AC13 unmet (M1–M3); AC22 partial met.
- Rulings: (a) drop the unapproved severity mapping in the ported test-reviewer rules; (b) EVIDENCE.md historical rows stay unchanged → owner decision D-1; (c) plugin validate re-run on the pinned 2.1.272 passed at both commits; npm test exit 1 is authoritative → owner decision D-2; (d) arbiter cap 27000 kept (P8 shrinks the arbiter).
- Owner decisions (2026-10-13): **D-1** EVIDENCE.md historical-record sections added to AC2's exclusion list; **D-2** the three named wall-clock tests (session-memory-hooks ReDoS 800ms, structure 10s validator timeout, doctor-security `--plugin-root` probe) are a disclosed exception until P3/P5 move them in-process; **D-3** the shared `isShallowClone` fix may also correct marker/tagReady (approved).
- Repair list R1–R8 → **implemented and committed in 72b01a0** (see the commit message and `progress.md`). Red→green evidence was recorded per item by the implementer.
- Riding items with deadlines (not yet done): code#5 1 MiB maxBuffer → P4; test#7 contract-check removed-flags CLI test → P4; test#9 Doctor node-row binding test → P4; arch#3 failure-memory `--log` usage file missing from the state model → P5; arch#7 README×3 should link `docs/history.md` instead of the archive permalink → P11; test#8 port TP-free fast-lane + test-reviewer QA-output prose guards → **before the first P8 prose edit**; P6 note: the Stop rewrite needs a ship-session regression case.
- Open item for the round-1 re-check: `plan-gate F1 … dd …` timed 3078 ms vs a `< 3000` bound in the post-repair full run (passes alone in 549 ms; also failed at baseline). It is the same load-timing class but NOT on the owner's D-2 list — the re-check arbiter must rule (or the owner extends D-2). → Ruled in the re-check below; owner approved **D-4**.

## Round-1 re-check (2026-10-14, new machine) — arbiter verdict on 5afc115..72b01a0: FIX REQUIRED

- Panel: intent, test, code (all real, none substituted) + arbiter. Packet and full reports: gitignored `.ctide/output/review/packet-recheck.md` and `recheck-findings.md` on the new machine.
- Verification (clean detached worktree of 2306078, Node 24.19.0): `npm run validate` 0; `plugin validate --strict` on the pinned 2.1.272 0; `npm test` 0 — 917 tests, 911 pass, 0 fail, 6 skip (platform-only), 87 s; `contract-check --base 5afc115` 0, scope clean. In the main checkout `npm run validate` exits 1 only because of gitignored `.ctide/collaboration/` dogfood data (validator scans ignored files; fix folded into P3 with owner approval).
- Round-1 majors: all six closed in substance; M1 (README×3 doc sync), M2 (fix introduced the `column.*` regression) and M3 (unknown probe answer) leave work for R2. Test-reviewer reproduced the missing red runs: 5afc115 ship.mjs under the new tests → 17/78 fail.
- AC check: AC-1 met (no exception needed in this run); AC-3 met (N5 wording gap → P8); **AC-13 unmet** under `column.ui=always` / `column.tag=always` (met under default config); AC-2 slice met; AC-22 slice partial (README×3:200).
- No blockers. Majors (re-rated by the arbiter from reviewer minors, each reproduced by the arbiter):
  1. `column.ui|column.tag=always` columnizes `git tag` → pending `no-release-tag` (regression from 72b01a0; 5afc115 was `ok`).
  2. `log.showSignature=true` adds a fake row to `pending.commits` (from P2).
  3. README×3:200 still paraphrases the old disclaimer with `READY` (incomplete R1 doc sync; trips the Stop hook).
  4. Shallow probe treats any answer other than `true` (git < 2.15 echoing the flag, a timeout) as "not shallow" → silent undercount and `tagReady: pass`; contradicts ship-contract.md:63.
- Repair list (owner approved the doc wording 2026-10-14):
  - **R2-1** [Safe] `git tag --no-column --sort=refname` on both tag reads; `--no-show-signature` on the pending `git log`; tests under hostile config, version ordering end-to-end (v9→v10, merged-back v1.9.5), SSH-signed commit.
  - **R2-2** [Safe, doc] README×3:200 → "not a readiness claim; nothing listed here has been reviewed or approved" (localized); real-hook silence test per README with the firing control.
  - **R2-3** [Extended-Safe, disclosed] tri-state shallow probe: unknown → pending `unverified`, tagReady `unverified`, marker note says history may be truncated; no old-git fallback; tests via a probe-only preload (echo / timeout) and a real shallow clone from `src/` and a linked worktree.
  - **R2-4** [Safe] `pendingChanges(root, marker.found ? marker.tag : null)`; `no-release-tag` note names an unreachable resolvable marker; ship-contract.md:52 / command-reference.md:132-133 narrowed; ship-contract.md §1 gains the N-of-M clause.
  - **R2-5** [Safe, test] pin `core.quotePath=true` in the Unicode fixture.
- Routed with deadlines: F-j `counted.status` fault-injection + strict count parse → P4; code-reviewer's four untouched leads (resolveMarker tag-list failure, tagReady rev-parse failure, subdir `--cwd` changelogTouched, corrupt HEAD label) → P4; F-k READY/major/minor in commit subjects and the negated "safe to ship" trip the Stop hook (advisory only) → P6 ship-session case; F-l edge-source definition for low/medium runs → P8 (with test#8); F-m red-run records → replaced by recording R2 red→green in `docs/handoff/progress.md`.
- Temp-dir leak: P3's auto-cleaning helper must cover every test file that calls `mkdtempSync` without cleanup (ship.test.mjs, contract-check.test.mjs, support.mjs, helpers.mjs, …), proven by a before/after `ctide-*` count around a full `npm test`. The existing %TEMP% backlog (~114.5k dirs) is machine state, out of scope (the owner cleaned it separately).
- Failure memory: proposed only (item 3 in `docs/handoff/README.md`, plus an extension to item 2); the owner's global file is not written in this plan.
- `ctide:delivery=held` · `ctide:verify=pass` · `ctide:panel=full` (re-check run).

### DECISION-20261014-plan-gate-f1-timing-class (owner-approved as D-4)

- **Status**: active
- **Context**: The four plan-gate F1 ReDoS tests (sed / perl / git apply / dd) time a spawned node child — more than 90% of the window is process startup (bare `node -e 0` 118–139 ms vs `gate()` 133–152 ms vs in-process classifier ~7 ms). dd hit 3078 ms against a 3000 ms bound under load on the original machine, and stays green with the `{0,200}` bound removed on a fast machine (2414–2468 ms).
- **Decision**: Same load-timing class as D-2; disclosed exception until P5; the 3000 ms threshold is never edited. P5 must replace them with in-process classifier timing (e.g. `< 250 ms`) and record a red run with the bound removed.
- **Alternatives considered**: raise the threshold (hides load flakiness, still blind to the regression); an arbiter-granted exception (relaxes an approved AC without owner consent); a linear-growth ratio check now (noisy at single-digit ms; belongs in-process).
- **Consequences**: a full-run timeout of any of the four is a disclosed exception, not AC-1 red, until P5; P5 carries a hard in-process requirement.
- **Revisit trigger**: P5 lands the in-process tests, or any of the four fails when run alone.
- **Tags**: tests / plan-gate / timing-exception

## Round-1 re-check 2 (2026-10-14) — arbiter verdict on 2306078..ec91bf6: FIX REQUIRED

- Panel: intent, test, code (all real) + arbiter. Packet and consolidated reports: gitignored `.ctide/output/review/packet-recheck2.md` and `recheck2-findings.md`.
- Verification (clean worktree with exactly the ec91bf6 content; re-run independently by the arbiter): `npm run validate` 0; `plugin validate --strict` on 2.1.272 0; `npm test` 0 — 932 tests, 926 pass, 0 fail, 6 skip, 90 s (no D-2/D-4 exception needed); `contract-check --base 2306078` 0; `test/ship.test.mjs` 93/93; 0 residue hits.
- AC check: AC-13 met (incl. every hostile config in the edge list); AC-1 met; **AC-22 slice unmet (partial)** — ship-contract.md:32-36 false for bare / `.git`, add-on A undocumented, command-reference.md:131-133 over-broad; AC-2 slice met.
- R2 closure: R2-1, R2-2, R2-5, add-on B, add-on C closed; R2-4 closed in code and contract (command-reference residual); **R2-3 and add-on A partial**.
- Majors (both reproduced by the arbiter):
  - **MJ-1** (test #1/#2, code N6): the tri-state probe's non-answers are mostly unpinned — mutants "non-zero exit → not shallow" (M8), "empty output → not shallow" (M9) and "any spawn error on the work-tree check → no-work-tree" (M11) each pass `test/ship.test.mjs` 93/93 while producing a false `tagReady: pass`; the preload loop only has `echo` and `timeout`.
  - **MJ-2** (intent #1, code N1 + N2): add-on A's work-tree check runs before the probe, so a bare shallow clone and `<clone>/.git` (probe `true`, work-tree `false`) lose the "history truncated — weak-signal only" marker note that 2306078 printed; pendingChanges also spawns the work-tree check twice.
- Repair list (owner approved W1/W2 wording 2026-10-14):
  - **R3-1** [Extended-Safe, disclosed] probe first: literal `true`/`false` is final; probe ENOENT → no-work-tree; any other answer → ask `--is-inside-work-tree` (ENOENT → no-work-tree; other spawn error → unknown; `true` → unknown; else no-work-tree). No `--git-dir`. Within owner add-on A (its stated target was the pre-R2 wording and no *false* clause where there is no history).
  - **R3-2** [Safe, test] preload modes `nonzero`, `empty`, probe+work-tree both timing out; a non-shallow bare repo with `echo` (no clause); a real bare `--depth 2` clone and `<depth-1 clone>/.git` (clause regained, red on ec91bf6); each mutant recorded separately.
  - **R3-3** [Safe, doc] W1 (ship-contract.md:36-40, "unknown" only inside a git work tree; outside / bare / `.git` / git missing → no clause unless the probe says `true`; a work-tree check that times out → unknown) and W2 (command-reference.md:131-133, "…names it whenever the state is `ok` or `no-release-tag`"), byte-exact.
  - **R3-4** [Safe, comment] ship.mjs:105-109 no longer overclaims ("other keys, e.g. `i18n.logOutputEncoding`, are not neutralized yet").
  - **R3-5** [Safe, test fixture] `--no-column` on the fixture's `git tag --merged`; repo-local `gpg.ssh.program ssh-keygen` in the SSH fixture.
- Routed: `i18n.logOutputEncoding` + central `-c key=value` neutralization in lib/git (not `GIT_CONFIG_GLOBAL` isolation — it drops `safe.directory`) → P4 exit; `diff.ignoreSubmodules` → **owner decision at P4 plan approval**; hermetic fixture git (`merge.verifySignatures`, shared with older tests) → P3 exit; SSH test capability-probe skip (git < 2.34, OpenSSH < 8.1) → P3 exit; README tests read only the first line under each heading → re-check at P11.
- **Evidence-only closure** (arbiter): R3 closes round 1 as READY without another reviewer run if all hold — (1) the diff touches only ship.mjs (:50-72, :105-109), test/ship.test.mjs, ship-contract.md (W1) and command-reference.md (W2), W1/W2 byte-exact; (2) ec91bf6's code + the new tests turns R3-2(d) red, and M8, M9, M11 and a `--git-dir` mutant are each red on their own against the fix, all green with it; (3) the arbiter's 15-cell behavior matrix is unchanged except bare / `.git` regaining the clause; (4) clean-worktree validate, plugin validate, npm test, contract-check all exit 0, and the hostile `GIT_CONFIG_GLOBAL` runs of R3-5 are green. Otherwise: narrow re-check with test-reviewer + arbiter.
- Failure memory: proposed only (item 4 and an extension to item 3 in `docs/handoff/README.md`).
- `ctide:delivery=held` · `ctide:verify=pass` · `ctide:panel=full` (re-check-2 run).

### DECISION-20261014-shallow-probe-answer-first

- **Status**: active (arbiter ruling under owner add-on A; W1 wording owner-approved 2026-10-14)
- **Context**: Add-on A was implemented as a work-tree check before the shallow probe. That check also overrides the probe's literal `true` in a bare shallow repo or `<clone>/.git`, dropping the disclosure 2306078 printed and ship-contract.md:32-36 promises.
- **Decision**: Ask the probe first; its literal `true`/`false` is final everywhere. Consult the work-tree check only on a non-answer: inside a work tree → unknown; outside, or git missing → no clause; the check's own non-ENOENT failure → unknown.
- **Alternatives considered**: narrow the contract to "inside a work tree" (declined — removes a true disclosure, contradicts add-on A's "pre-R2 wording"); a `--git-dir` fallback (declined — puts "unknown" in bare repos, outside add-on A, would need a new owner ruling); keep the duplicate work-tree check (declined — +2–3 spawns per report for no behavior).
- **Consequences**: spawn counts inside repositories return to 2306078 levels; a non-git directory costs +2; "unknown" stays confined to work trees, and every non-answer is pinned by a test.
- **Revisit trigger**: P4's lib/git changes how git context is detected, or the owner wants "unknown" in bare repos.
- **Tags**: ship / shallow-probe / add-on-A / guard-ordering

## Round-1 closure (2026-10-14) — READY by evidence, per the re-check-2 arbiter's conditions

R3-1…R3-5 landed in `64c2564` (signed). The orchestrator checked each of the arbiter's four conditions itself rather than relying on the implementer's record alone:

1. **Diff scope**: `ship.mjs` hunks only at :55-75 (`shallowState` + comment) and :109-114 (comment); `test/ship.test.mjs`; one hunk each in ship-contract.md (W1) and command-reference.md (W2). W1 and W2 verified verbatim (whitespace-normalized, count 1 each) and the replaced sentences gone.
2. **Red → green**: reproduced independently in scratch copies — ec91bf6's code with the new tests fails exactly the bare/`.git` test (96/95/1); the fixed code with mutant M8 fails exactly the non-answer loop (96/95/1). The implementer's record shows M9, M11 and the `--git-dir` fallback each red on their own, green with the fix (`r2-redgreen.md` § R3).
3. **Behavior matrix**: the 15 cells are identical to ec91bf6 except the bare shallow clone and `<shallow clone>/.git`, which regain "history truncated — weak-signal only".
4. **Clean worktree**: `npm run validate` 0; `plugin validate --strict` on 2.1.272 0; `npm test` 0 — 935 tests, 929 pass, 0 fail, 6 skip, 89 s; `contract-check --base ec91bf6` 0; `test/ship.test.mjs` 96/96 under `GIT_CONFIG_GLOBAL` with `column.ui = always` and with a missing `gpg.ssh.program`.

All four hold, so round 1 (P1 + P2 and its repairs R1–R7, R2-1…R2-5, R3-1…R3-5) is **READY**. Items routed to P3 / P4 / P5 / P6 / P8 / P11 keep their deadlines (see `README.md` 下一步).

`ctide:delivery=held` · `ctide:verify=pass` · `ctide:panel=full`

---

## Review Packet — v0.8 slim refactor, review round 1 (phases P1 + P2)

Task: Phases P1 (Node floor 22.12 + `npm test` scoped to `test/**/*.test.mjs`) and P2 (remove the test-provenance (TP) subsystem and the run-ledger subsystem; ship "pending" becomes git-derived; docs/superpowers archived) of the owner-approved plan `docs/handoff/plan.md` (zh-TW). Commits: cd8a02d (P1), 5afc115 (P2). Base: acbe433. Branch refactor/v0.8-slim. Removed content is preserved in the local annotated tag `archive/v0.7.2-full`.

Owner decisions in force (not up for review): D1 remove TP entirely (incl. intent-scan / shared-decision specs, 9/11 roadmap); D3 remove ledger/reconcile/consolidate entirely, ship pending git-derived and explicitly NOT a readiness claim; port three TP ideas into ordinary test review.

Acceptance criteria in scope for this round (numbering = plan AC list):
1. (P1/P2 portion) each phase commit leaves `npm run validate`, `npm test`, `claude plugin validate --strict ./cressetide` green.
2. (TP + ledger portion) `git grep` for TP and run-ledger identifiers returns nothing outside CHANGELOG history and docs/history.md (archive permalinks allowed); the archive tag contains every removed file.
3. test-reviewer and verification-gate carry the three rules (silence is not an assertion; stay inside the source's scope; look for extra assertions, not only missing ones) and test→source traceability.
4. `npm test` runs only `test/**/*.test.mjs`.
13. Ship: after a release tag plus one non-vigil commit, that commit is listed as pending and no READY claim is made.
22. (partial) docs no longer describe TP/ledger; docs/history.md exists.
Task contract: `.ctide/output/contract.md` (high-risk, 24 ACs; other ACs belong to later phases).

In scope: everything changed in acbe433..HEAD (67 modified/added files; 146 deletions listed in `.ctide/output/review/deleted-r1.txt`).

Out of scope (deferred to later phases — deferred ≠ missing): Copilot removal and hooks rewrite (P5), shared `cressetide/lib/` extraction and garden-9d deletion (P4), Stop/SubagentStop rewrite incl. the Task-vs-Agent bug (P6), failure-memory `##`/`###` parsing and raw-prose fallback (P5), debug redaction (P5), untracked files in contract-check/pack-review-diff, map freshness, regression-delta missing tests, doctor probes (P7), reviewer-contract skill / effort prose / context splits / EXPERIENCE removal / map overlays (P8), workflow (P9), eval/efficiency removal and plugin-eval conversion (P10), CI path filters, logos, README voice pass, CHANGELOG 0.8.0, version bump (P11). Known pre-existing wall-clock timing tests that fail only under load.

Must-not-change (invariants): hooks' fail-open boundary; `ctide.*` opt-out settings semantics; the three sentinel tokens/values (`ctide:delivery=` / `ctide:verify=` / `ctide:panel=`) and `### Live run`; verdict tokens READY / FIX REQUIRED / NOT READY and severities; intent-reviewer is never substituted; the arbiter's per-acceptance-criterion check; the evidence-substitution fast lane for ordinary (non-TP) runs; contract-check default mode's always-exit-0 fail-open contract; ship's five readiness checks and its always-exit-0 CLI.

Edge checklist: ship pending — no release tag; repo with no commits; shallow clone; non-git dir; git binary missing; 0 commits since tag; >200 commits / >500 files caps + truncation note; `--cwd` pointing at a subdirectory; Unicode/space file names (NUL-separated). contract-check — removed flags (`--provenance`, `--inventory`, `--task`) now unknown. Doctor `--project` — exactly two added checks. Node floor — 22.11.99 fails, 22.12.0-rc.1 fails, 22.12.0 passes, unparsable fails without throwing. README×3 parity (17 `##` sections each). Archive permalinks 404 until the tag is pushed (owner pushes later; expected).

Assumptions: Ship pending uses `git describe` nearest reachable `vX.Y.Z` tag, while the readiness marker keeps the highest-version tag (unchanged check) — they can differ on unusual branch layouts and both name their tag; ship's old "human may exclude ledger entries" step was dropped because excluding commits from a git range has no meaning (direct consequence of D3); the ship JSON `pending` field changed from array to object (breaking; CHANGELOG in P11).

Implementation summary: P1 — engines >=22.12, test glob, CI Node 22, Doctor semver node row + boundary test, docs synced. P2 — deleted 37 vigil scripts (34 TP + run-ledger/reconcile/consolidate), vendor/, eval/loop-e2e/, the vendored-parser ADR, test/fixtures/, 34 test files, references/run-ledger.md, docs/superpowers/** (61 files), docs/efficiency-measurement.md, docs/advanced/retro-practice.md; contract-check lost `--provenance`; Doctor lost ledger-health; ship.mjs pending = `pendingChanges()` (git-derived, disclaimer, states, caps); SKILL steps 2/3/4b/9 and TP clauses removed; arbiter TP gate removed (cap 30000→27000); test-reviewer TP section replaced by "Assertion discipline"; implementer + verification-gate gained one traceability line each; navigator lost reconcile deliverable; references (review-packet, reviewer-selection, final-report, plan-grounding, experience-memory, decision-record) cleaned; README×3/ARCHITECTURE/SECURITY/CONTRIBUTING/runtime-contract/command-reference/how-to-read-verdicts/benchmark-contract/evaluation/examples cleaned; flow_overview.svg ledger shape removed; docs/history.md added; typos.toml trimmed; validator ENTRY_POINT lists and counts fixed.

Changed files: see `git diff --stat acbe433..HEAD` (key code: cressetide/skills/ship/scripts/ship.mjs, cressetide/skills/doctor/scripts/doctor.mjs, cressetide/skills/vigil/scripts/contract-check.mjs, .github/scripts/validate-structure-core.mjs; key prose: cressetide/skills/vigil/SKILL.md, cressetide/agents/{arbiter,test-reviewer,implementer,navigator}.agent.md, cressetide/skills/vigil/references/*.md, cressetide/skills/ship/{SKILL.md,references/ship-contract.md}, cressetide/skills/doctor/{SKILL.md,references/diagnostic-contract.md}; tests: test/ship.test.mjs, test/doctor-project.test.mjs, test/release-doctor.test.mjs, test/contract-check.test.mjs, test/documented-facts.test.mjs, test/workflow-contracts.test.mjs, test/validate-structure.test.mjs, test/release-cli.test.mjs).

Changed diff (filtered): `.ctide/output/review/diff-r1.patch` (4835 lines; added/modified/renamed files only, packed by pack-review-diff.mjs)
— Trimmed: pure deletions excluded (list in `.ctide/output/review/deleted-r1.txt`; their old content: `git show acbe433:<path>`).
— Regenerate (same scope): `git diff --diff-filter=AMR acbe433..HEAD`; full incl. deletions: `git diff acbe433..HEAD`.

Verification evidence:
| command | type | required | ran | exit | note |
|---|---|---|---|---|---|
| `npm run validate` | structure | yes | yes | 0 | after P2 |
| `claude plugin validate --strict ./cressetide` (CLI 2.1.296) | plugin schema | yes | yes | 0 | "Validation passed" |
| `node --test --test-reporter=tap "test/**/*.test.mjs"` | test | yes | yes | 1 | 905 tests, 899 pass, 3 fail, 3 skip; the 3 fails (doctor-security "statically inspects --plugin-root", session-memory-hooks ReDoS 800ms bound, structure 10s validator timeout) are child-process timeouts under load, all pre-existing in the P0 baseline, and each file passes alone: doctor-security 8/8, session-memory-hooks 49/49(+1 skip), structure 4/4 |
| `node cressetide/skills/vigil/scripts/contract-check.mjs --base acbe433` | scope/AC | yes | yes | 0 | scope clean; every behavior-changing AC maps to a verification entry |
| `git grep` TP/ledger identifiers (excl. CHANGELOG, EVIDENCE, docs/history.md, eval/efficiency, archive permalinks) | residue | yes | yes | 0 hits | |
Summary: required checks green except load-induced timing timeouts that pass in isolation.

Known risks: archive permalinks 404 until the owner pushes `archive/v0.7.2-full`; eval/efficiency still references docs/superpowers in a SHA-frozen JSON (P10 deletes eval/efficiency); wall-clock tests flaky under load (P3/P5 move them in-process).

Context exclusions: the upstream 2026-09-11 master roadmap (archived; superseded by the owner's D1–D5 decisions) — do not treat its TP/intent-scan/ledger obligations as requirements.

External-capability notes: none used by the implementation; live host probes for later phases are recorded in `.ctide/output/probes.md` (context only).

Design contract (design.md path, or "none"): none (no UI).

Migration status: n/a (no legacy `ai/FAILURE_MEMORY.md` in this repo).

---

# Round-1 reviewer findings (P1 + P2, acbe433..5afc115) — consolidated by the orchestrator, indexes reproduced from each reviewer

## intent-reviewer
1. major · ship.mjs:117 + ship SKILL.md:46 vs hooks/orchestration-check.js:83-84,104-106,395 · the mandatory verbatim disclaimer "…no READY verdict is implied" contains the machine-checked READY token; the plugin's own Stop hook reads it as an asserted READY and emits the false "panel did not run" advisory on every ship session; AC13 broken at the machine-token level · anchored+reproduced (hook fed the disclaimer → systemMessage; control silent) · fix: reword without uppercase READY (e.g. "…not a readiness claim; nothing listed here has been reviewed or approved"), sync README×3/command-reference/ship-contract, make the test forbid READY anywhere.
2. major · ship.mjs:121,153-154 vs parseVersionTag/pickLatestVersionTag + ship-contract.md:40,48 · pending boundary glob accepts v1.3.0-rc1 / v1.2.3.4 (under-lists unreleased commits) and rejects bare 1.2.0 that the marker accepts; contract's "same tag on linear history" false · anchored+reproduced · fix: derive the pending tag via `git tag --merged HEAD` + existing pickLatestVersionTag (one grammar); correct ship-contract:48.
3. major · test-reviewer.agent.md:42-43, implementer.agent.md:36 vs verification-gate.md:16, arbiter.agent.md:70 · "assert only what a source states" conflicts with the existing mandate to test implied edge inputs (e.g. sum([])===0 stated by no source): implementer told not to pin, test-reviewer flags over-specification, arbiter blocks READY without it · anchored (prose both sides) · fix: name implied edge expectations / the contract assumption register / the edge checklist as admissible sources that must be cited.
4. minor · ship.mjs:55-57,149 · isShallowClone checks `<cwd>/.git/shallow`; subdir/worktree of a shallow clone → no-release-tag instead of shallow-clone · reproduced · fix: `git rev-parse --is-shallow-repository`.
5. minor · ship.mjs:153-154 · any `git describe` failure incl. timeout maps to no-release-tag; contract table says read failures/timeouts are unverified · anchored · fix: only "no names found"/no HEAD → no-release-tag; else unverified.
6. minor · test-reviewer.agent.md:42 · the severity mapping (minor default, major when freezing accidental behavior) is not among the owner's three rules; major blocks READY → new release-affecting obligation not approved · anchored · fix: surface to owner or drop the mapping.
7. minor · docs/history.md:19 · "about 6.5k tokens and 4–5 tool calls per run" has no source (0 grep hits); :55 "saved 15 bytes" but candidate never adopted · fix: label as estimate from reference size or remove; "would have removed".
8. minor · AC2 vs EVIDENCE.md:30,50 · residue grep exclusion widened to EVIDENCE.md (2 historical ledger-health mentions) and eval/efficiency; AC text allows only CHANGELOG + history.md · fix: explicit owner/arbiter ruling or amend AC2.
9. minor · AC1 evidence · npm test exit 1 at both phase commits (load-timing fails pass in isolation; packet defers); plugin validate ran on CLI 2.1.296 not the plan's pinned 2.1.272 · fix: arbiter rules on deferral; rerun strict validate on 2.1.272.
10. minor · ship SKILL.md:33-36,50 · rollback relevance judged on pending.files even when filesTruncated (>500) · fix: relevance statement must say it covered N of M files.

## architecture-reviewer
1. major · ship.mjs:121,153 vs :63,84 (+ ship-contract.md:39,47-48, docs/command-reference.md:128) · two release-tag definitions; bare `1.0.0`+1 commit → marker 1.0.0 but pending NO-RELEASE-TAG (AC13 unmet for an accepted tag shape); v1.0.0→a→v1.1.0-rc.1→b → pending ok lists only b · reproduced · fix: pendingChanges picks tag via `git tag --merged HEAD` → pickLatestVersionTag; note when pending.tag ≠ marker.tag; fix contract/command-reference wording; bare-tag + prerelease tests.
2. minor · ship.mjs:55-57 · isShallowClone subdir --cwd (same as intent #4) · reproduced.
3. minor · runtime-contract.md:93, ARCHITECTURE.md:130, SECURITY.md:47 vs failure-retrieve.mjs:191-193,219 · "memory/ is committed" yet `--log` writes untracked `.ctide/memory/.failure-memory-usage.jsonl` (gitignore required per verification-gate.md:172-174, no self-gitignore); pre-existing · fix: one line in the state model, or defer to P5 explicitly.
4. minor · implementer.agent.md:36, test-reviewer.agent.md:42-45, verification-gate.md:14 · assertion-source list omits the contract assumptions register and the edge-input checklist (same root as intent #3) · fix: add "a recorded contract assumption or the run's edge-input checklist" in all three.
5. minor · EVIDENCE.md:30,50 · AC2 literal residue (same as intent #8) · fix: ruling to amend AC2 exclusion for historical records.
6. minor · docs/history.md:29 · says the tag "holds the full v0.7.2 tree" but it points at acbe433 (v0.7.2 + 7 commits) · fix: "main at acbe433, just before the v0.8 refactor".
7. minor · README×3:321 · links the archive permalink directly instead of in-tree docs/history.md · fix: point README×3 at docs/history.md#the-efficiency-investigation.

## code-reviewer
1. major · ship.mjs:121,153 vs :63, ship-contract.md:47-49 · two tag definitions (same as above) · reproduced; `--exclude 'v*[!0-9.]*'` and two-`--match` variants each fixed one case · fix: one definition via `git tag --merged HEAD` + pickLatestVersionTag.
2. minor · ship.mjs:55-57 (used :149) · isShallowClone subdir/worktree (same as above) · reproduced (root/subdir/worktree) · fix: `git rev-parse --is-shallow-repository` (also fixes marker + tagReady paths).
3. minor · ship.mjs:163 · rename detection on → renamed migration lists only the new path; Rollback relevance matches against pending.files · reproduced (`git mv`) · fix: `--no-renames`.
4. minor · ship.mjs:163 · user `diff.relative=true` + subdir --cwd → fileCount 0 · reproduced · fix: `-c diff.relative=false`.
5. minor · ship.mjs:44-48 with :163 · NUL file list unbounded vs Node default 1 MiB maxBuffer → >~15k files gives unverified instead of "showing 500 of N" · mechanism confirmed (ENOBUFS), e2e masked by timeout · fix: larger maxBuffer for that call, or state the limit in the contract's unverified row.
6. minor · validate-structure-core.mjs:667-671 · arbiter 26,798 vs cap 27,000 (202 B headroom) contradicts the 9c header "caps leave headroom" · fix: say the cap is deliberately tight, or confirm with owner.

## test-reviewer
1. major · test/ship.test.mjs:649-650 (+:629,:670,:833) · disclaimer / no-READY checks compare against the module's own exported PENDING_DISCLAIMER and strip it before scanning for /READY/ → a disclaimer that itself claims readiness passes · reproduced (mutant "READY — safe to ship…" → 9/9 pass) · fix: assert the literal (as in ship-contract.md:43), strip only the literal negation phrase before the scan, add /not a readiness claim/.
2. major · ship.mjs:55-57,149 · shallow subdir/worktree → `ok` with undercounted list (depth-4 clone: root shallow-clone; src/ ok count 5 vs true 7; worktree ok 5) — the silent undercount the state exists to prevent; no subdir test · reproduced · fix: `--is-shallow-repository` + subdir/worktree tests.
3. major · ship.mjs:164-167 · the `unverified` read-failure branch has no test; a mutant returning ok passed 12/12; real fixture (delete tag root tree object) shows HEAD unverified vs mutant ok · reproduced · fix: add that fixture test (state unverified, commitCount null, five checks ran, text UNVERIFIED).
4. minor · ship.test.mjs:786-818 · caps only at cap+1; `>=` mutant survives; truncated case doesn't assert five checks; subject/path caps untested · reproduced · fix: 500-file case expects filesTruncated false; assertFiveChecksRan in caps test.
5. minor · ship.mjs:163,172 · NUL-separated list and empty repo untested; no-`-z` mutant passes 12/12 and on a real repo mangles a Unicode+space name · reproduced · fix: Unicode+space filename test, empty-repo test.
6. minor · process · no recorded red-before-change run in the packet/artifacts (reviewer reproduced AC13 red itself: 3/3 fail on base) · fix: record red runs for AC13, node floor, Doctor exact set.
7. minor · contract-check.mjs:123 · removed flags (--provenance/--inventory/--task) now fall through to default report exit 0 (base exited 1) — untested · fix: CLI test exit 0 + default report + no provenance JSON.
8. minor · test/workflow-contracts.test.mjs · D11 removal took out the only prose guards that each fast-lane document still grants evidence substitution, the general fast lane is preserved, and test-reviewer's Required output keeps Missing required tests / Regression risks / Confidence · grep confirmed no other guard · fix: port TP-free per-document assertions + QA-output assertion before P8.
9. minor · doctor.mjs:460 · no test that the node row actually uses nodeVersionMeetsFloor (revert to major>=20 stays green on Node ≥22.12) · fix: assert the row detail contains `requires Node >=22.12.0`.
10. minor · assertion discipline · ship.test.mjs:685,:701,:706,:732,:749,:783,:672 pin wording/labels/layout no source documents · fix: assert `out.includes(json.pending.note)` and state names case-insensitively.
