# Verification Gate

Verification is required before final readiness claims. A statement like "should work" is not evidence.

## Command Evidence

Run the narrowest meaningful checks for the task:

- Backend/general: the repo's build, test, and lint commands for its stack — e.g. `dotnet build`/`dotnet test` (.NET), `npm`/`pnpm` scripts (Node), `pytest`/`ruff` (Python), `go build`/`go test` (Go) — or repo-specific focused commands when stricter.
- Frontend/UI: package install when needed, build, test, lint, typecheck, and browser evidence when browser-visible.
- Data/config/deployment: migration validation, schema guard, config checks, deployment or rollback evidence when feasible.
- Contract: when the task contract exists (`.ctide/output/contract.md`; the checker also discovers a legacy pre-migration path), run `scripts/contract-check.mjs` (`references/task-contract.md`) for deterministic scope-diff + AC-coverage evidence; fail-open (absent/unparseable ⇒ no claim).
- Additional focused tests when the changed path has targeted suites or scripts.

**Exercise the change's risky inputs — do not rely on reading the code.** Most defects that survive review are only visible when the boundary case actually *runs*: empty / zero / overflow / very-large values, multibyte or non-ASCII text, null or empty collections, duplicate or multiple values (e.g. repeated headers), malformed input, by-value vs by-reference / receiver use, and concurrent access. For behavior-changing code, add or run a focused test that feeds the specific edge inputs the change implies and assert the expected result — a test that reproduces the boundary is the oracle a static read lacks, and what catches the subtle idiom/encoding/overflow/omission bugs a reviewer rationalizes as "looks fine".

For each **behavior-changing acceptance criterion**, **generate** a demonstrating test you confirmed **fails without the change and passes with it** (run it against the pre-change state, or assert the bug-reproducing input), and **record that red→green transition** as the criterion's evidence — a test shown to fail first is the strongest proof the behavior was actually *absent* before, exactly what an omission defect needs. A produced artifact per behavior-changing criterion, not an after-the-fact check: the criterion → verifying-test mapping is what the `arbiter`'s bidirectional traceability reads (`agents/arbiter.agent.md`, *Acceptance-criteria check*), and `test-reviewer` drives the fill for any criterion still missing one. Where a clean fail-first→pass is impractical (much UI, copy, or config has no such red-green), say so rather than manufacturing one; a **preference, not a hard gate** — disclose the criterion and the captured command/observed-behavior evidence used instead. The record is double-duty: the per-criterion red→green mapping plus a green full required suite (`ctide:verify=pass`) **is** the eligibility evidence the `arbiter` checks when `test-reviewer` is evidence-substituted (`references/reviewer-selection.md`, *Evidence substitution*) — no separate artifact is produced.

On high-risk work, the plan-grounding step (`references/plan-grounding.md`) enumerates this edge-input set up front as the change's **implied edge checklist**, carried here — so the boundary tests are planned rather than improvised at verification time.

Prefer running build/test commands in the **foreground** — the runner reaps them cleanly. If you background one, make sure it leaves **no lingering child process** (a build server, file watcher, or dev server): a survivor that inherits the command's output pipe keeps the background task stuck "running" long after the command has finished. .NET is the common case — `dotnet build`/`dotnet test` spawn MSBuild node-reuse workers and the Roslyn `VBCSCompiler` server that persist for minutes; if you must background a .NET build/test, add `/p:UseSharedCompilation=false /nr:false` (or set `MSBUILDDISABLENODEREUSE=1`) so nothing is left holding the pipe.

For every skipped check, state the command or check, why it could not run, and remaining uncertainty.

Run checks at minimal verbosity and filter command output to decision-relevant content, by content type — each recipe is *how to filter without dropping signal*, not licence to trim:

- **Diffs** — `git diff --stat` to orient, *then* a targeted `git diff <path>` for the actual hunks; keep hunk headers and changed lines, skip unrelated files.
- **Test / build output** — surface failures: the failing assertion, the first failing stack frame, and the error message; on green, the summary line is enough — do not echo passing-test spam.
- **Logs** — keep the error/warning lines and the surrounding context; collapse repeated or info-level noise, but never drop the failing stanza.
- **Searches** — `rg -l`/`-c` to locate, *then* `rg -n -C<k>` to pull the matching context; do not dump whole files.

Filter noise, never signal — a smaller view is acceptable only when it preserves 100% of the decision-relevant detail (failure tracebacks, the actual changed hunks, the matching code). Never trade recall for fewer tokens.

## Repair-iteration scoping

On a **repair iteration** (the auto-fix loop, `SKILL.md` step 8), re-run only the checks the fix actually affects — the failing check(s) and the changed-path suites — not the full green suite every loop; re-running untouched, already-passing checks wastes tokens and wall-clock without adding signal. Two non-negotiables keep this honest:

1. **Re-run the full required set once more for the final pre-`READY` confirmation**, so `ctide:verify=pass` still rests on a real full-suite green. The command exit status is authority (`agents/arbiter.agent.md`, *Command-evidence authority*); a fix can introduce a regression in a path that earlier passed, so the last gate before delivery must exercise the whole required set, not trust prior green.
2. In the per-check table, mark a **carried-forward-green** check distinctly from a **re-ran-green** one — never silently present a prior pass as if it ran this iteration.

This is *filter noise, not signal* applied across iterations: it changes which checks re-run mid-loop, never the final full-suite guarantee.

**Drift-aware Stuck Summary (disclosure-only).** The 2-consecutive-iteration Stuck-Summary trigger (`agents/arbiter.agent.md`, *Auto-fix loop rules*) is unchanged; this only enriches what the Stuck Summary explains once that trigger has fired — never a new gate, timer, or threshold. When it fires, the `arbiter` additionally weighs two signals it already has:

- **`contract-check.mjs`'s scope-diff report** (`references/task-contract.md`; the same report the `arbiter` reads at *Deterministic contract-check*) — a growing `outOfScope` / `forbiddenHits` list across iterations means the repeated fix is touching more territory than the approved contract licensed, a structural drift signal.
- **The bidirectional-traceability lens** (`agents/arbiter.agent.md`, *Acceptance-criteria check*) — whether each iteration's changed files still map to an approved criterion, and whether the still-failing check(s) still trace back to the originally blocked criterion rather than one the fix introduced along the way.

The `arbiter` states in the Stuck Summary whether the pattern reads as **converging** (same criterion, narrowing scope) or **drifted** (scope creep past `allowedPaths`/`mustNotChange`, or the fix chasing a symptom outside the approved criteria). Disclosure only: neither reading blocks, extends, or shortens the loop by itself — the 2-iteration cap alone still stops it. A drifted reading signals the next step should be a scoped re-plan, surfaced as part of "what is needed next," never an automatic action.

## Regression ratchet (baseline-passing ∩ now-failing)

A fix can turn a previously-green test red. On `--deep` or high-risk runs the orchestrator captures the pre-change test output before implementation (e.g. `.ctide/output/baseline-before.txt`) and the post-change output at verify (`.ctide/output/baseline-after.txt`), then runs `scripts/regression-delta.mjs <before> <after>` — a dependency-free **pure differ** that reads each runner's own native output (node --test / jest / pytest / go test) and computes `baseline_passing ∩ now_failing`: the tests that passed on the pre-change baseline but fail now. The `arbiter` treats any non-empty intersection as a blocking regression, **naming the newly-failing tests** and classifying each green→red as an intended change or a genuine regression (`agents/arbiter.agent.md`, *Regression ratchet*). This pairs with the final full-suite re-run above: the full set runs, and the ratchet checks that nothing that used to pass now fails.

**It only ever adds safety; it never false-positives on ambiguity.** The differ mandates **no** project-side test-id schema — it parses each runner's existing output faithfully or not at all: if individual test ids cannot be parsed (an opaque runner, a summary-only count, an unparseable format, or the two captures come from different runners), it makes **no claim** rather than guessing a regression from a changed pass-count. The command exit status (above) remains the authority in that case; the ratchet is a strictly additive, name-the-regressions layer on top, not a replacement for it.

**It is gated to `--deep` / high-risk runs.** The baseline-capture step runs only on those risk tiers — standard / low-risk runs are unchanged and capture no baseline, so the ratchet makes no claim there; it is opportunistic and best-effort, firing only when a pre-change baseline was captured (an added-safety layer, not an always-on gate). The differ is fail-open: a missing baseline or an opaque runner ⇒ no claim, always exit 0, and the command exit status remains the authority.

## Browser Evidence

For the live-drive protocol (how to actually drive a real browser) and the `--deep` + UI requirement, see `references/browser-evidence.md`.

For local browser-visible UI changes with a known or safely derivable target, use Claude in Chrome, an in-app browser, or an accepted existing fallback.

Record:

- target URL, route, file, or current tab
- scenario or state exercised
- observed result
- tool used
- screenshot reference or why no screenshot was needed
- focus, hover, keyboard, clipboard, or navigation result when relevant
- exact blocker and fallback evidence if browser automation cannot run

Browser evidence supplements automated tests. It does not replace them when automated checks are practical.

## External-Capability Skips (MCP / skills / subagents)

Optional external capabilities are environment-dependent. When a check relies on one (e.g. a security MCP scan, a `ui-ux-pro-max` design audit, a Playwright browser MCP, an external reviewer subagent):

1. Verify the capability is actually available before relying on its result.
2. If it is unavailable, do NOT claim the check ran. Perform the best local fallback instead.
3. Explicitly disclose: which capability was unavailable, what verification was therefore not performed, what local fallback was used, and the remaining uncertainty.

Treat an unavailable required external capability as a verification gap, not a silent skip. See `references/external-capabilities.md`.

## Text Integrity

When touching human-readable content, check:

- required target language (per repo/user convention) when applicable
- mojibake and replacement characters
- broken or mixed character sets
- unsafe localization of technical contracts
- encoding compatibility constraints

Do not perform broad encoding conversion unless the root cause and interoperability risk are understood.

## One-time migration procedure (shared)

Legacy ctide artifacts migrate into `.ctide/` exactly once. Each call site defines the **trigger, source(s), destination, and siblings**; the move always follows these steps, in order. The workflow **main thread** performs it — hooks never migrate anything (read-only, with a documented never-write/never-delete promise; at most they read a legacy path as a fallback).

1. **Run only when the destination is absent** — the site's triggering step found only the legacy location. When **both** exist, move or overwrite nothing: the new location wins; the site's both-exist rule says what to disclose.
2. **Check each path's trackedness — never assume it.** `git ls-files --error-unmatch <path>` per path (exit 0 = tracked, non-zero = untracked); do not infer the answer from context — "normally untracked" or "normally committed" is a guess, not a check.
3. **Create each path's destination directory, with any missing intermediates, immediately before that path's move** — ahead of the tracked/untracked branch, never once flat upfront for a whole tree: neither `git mv` nor a plain copy creates intermediate directories, so one top-level directory made upfront leaves a nested path with nowhere to land.
4. **Move by trackedness.** Tracked — `git mv <path> <destination>` (the parent exists per step 3, since `git mv` does not create it; the move preserves history); manual copy+delete is never an acceptable substitute for a tracked path — it silently discards commit history, which is exactly what `git mv` exists to prevent. Untracked — copy it, verify the copy is readable, then delete the source.
5. **Migrate the site's sibling/nested content the same way**; when the source was a directory tree, remove the emptied tree (leave unrelated content alone — a single-file source has nothing to remove beyond the moved file itself).
6. **Disclose one line to the user**, and never read or write the legacy location again — everything uses the new location only.

## Failure Memory

Read before non-trivial implementation. The SessionStart hook injects only a condensed **digest** (entry titles + tags, **ranked by importance — recurrence first, then recency** — so the always-on index leads with the lessons that keep biting, not merely the newest; the prevention-rule text is read on demand, not injected) as an index — do not treat it as the full record:

1. `.ctide/memory/FAILURE_MEMORY.md` when it exists.
2. The compatibility project path (`ai/FAILURE_MEMORY.md`) when only it exists — reading it triggers the one-time migration below, **unconditionally, regardless of this run's outcome**.
3. `~/.claude/FAILURE_MEMORY.md` otherwise, including consolidated groups.

When both project tiers exist, the new path (tier 1) wins and the legacy file is ignored — any entries only it holds (e.g. rollback-era lessons) are stranded there, so disclose that state once and suggest a manual merge-then-delete.

**One-time migration — a distinct, mandatory action, separate from writing a new entry.** Reading the legacy file at tier 2 ALWAYS triggers it, even on a run that writes zero new failure-memory entries — a clean success with nothing to record still migrates ("no new entry needed" ≠ "no migration needed"; two independent obligations), and a report that only addresses the first (e.g. "Failure Memory: not required — clean success") has NOT discharged the second. At this consult step, before finishing the run, run the shared *One-time migration procedure* (above): source `ai/FAILURE_MEMORY.md` → destination `.ctide/memory/FAILURE_MEMORY.md`; both tiers exist ⇒ tier 1 wins (above); sibling: the `.failure-memory-usage.jsonl` usage ledger; disclosure e.g. "migrated failure memory to .ctide/memory/".

During planning, perform **targeted retrieval**: search the failure-memory file for entries relevant to this task's affected files, area, language, and error type (use the entry `Tags` to filter), then read those full entries. Do not rely on the startup digest alone.

To make this retrieval **deterministic instead of a best-effort grep**, run the dependency-free helper `scripts/failure-retrieve.mjs` with the task's signature — affected paths, language, area, and error-type tokens — and read the full entries it ranks back:

```
node ${CLAUDE_PLUGIN_ROOT}/skills/vigil/scripts/failure-retrieve.mjs --query "src/auth/login.ts node jsdom ci-test" [--file <path>] [--top 5]
```

It parses the same `### ` entries, scores each by tag/title/body overlap with the signature (a tag hit outweighs a title hit outweighs a body hit), drops retired (`expired`/`superseded`) and placeholder entries, and returns the top matches' verbatim markdown. Fail-open: an absent/unstructured file or no sufficiently-relevant match yields a no-claim line and exit 0 — a ranking aid, **not** a gate, never a replacement for reading the file when judgment calls for it. The retrieval recall/precision is regression-guarded in the source repo's committed oracle + tests (https://github.com/kktu6507/cressetide/tree/master/eval/failure-memory).

**Single writer:** the failure-memory file is shared mutable state and reviewers run in parallel, so only one actor writes it — the **main thread**, after the verdict, from the `arbiter`'s decision. Reviewers and the implementer only *propose* entries; the `arbiter` rules on them and proposes the exact final entry text, but does not write the file either (it holds no editor tools). This avoids lost-update / interleaved-write corruption (the "reread global first" step below is a lockless read-modify-write and is only safe with a single writer).

Before every failure-memory write:

1. Reread the global `~/.claude/FAILURE_MEMORY.md`, even when a project-specific memory file is the final write target.
2. Check whether an existing consolidated group or detailed entry already covers a similar lesson.
3. If a similar lesson exists, update or append within that same relevant section instead of creating a disconnected duplicate.
4. If the same mistake recurs, explicitly mark the recurrence on that mistake or entry; do not omit repeated failures.
5. Use the target file's existing template exactly when it defines one.

Write failure memory without requiring another explicit user approval when any execution abnormality blocks, disrupts, or forces repair of the originally intended method. Record the original method that could not proceed, why it failed, and how it was repaired. This includes:

- inability to execute a planned command, test, tool, runtime, browser, connector, build, or smoke path
- abnormal command/runtime/tool behavior, including file locks, startup failures, sandbox/runtime failures, encoding failures, or environment mismatches
- inability to start an expected service, browser, test host, local server, DB path, worker, or automation runtime
- build or test failures, including transient failures when the root cause and prevention are reusable
- blocker or major reviewer rejection, especially when the repair changes tests, parameters, files, cancellation handling, resource lifetime, telemetry, or runtime behavior
- blocked tasks with a reusable prevention lesson
- code-quality, framework-misuse, performance/resource, encoding, locale, text-integrity, or verification-evidence failures with reusable value

Do not replace failure memory with a silent fallback: when a workaround or parameter/file/configuration repair was required, record why the original path failed and what made the repaired path valid.

Prefer project-specific memory for repo-specific lessons and global memory for cross-project workflow/tooling/reviewer coordination lessons. When both apply, write the project-specific lesson and also update the global lesson if the prevention rule is reusable across repositories.

Tag each entry (`Tags`: language / area / error-type) so the startup digest and targeted retrieval can filter it.

### Keeping the file small (consolidation)

Control file size by **entry count, not by truncation** — hook truncation is only a safety net. When the file grows past a sane size (roughly 30+ entries, or whenever entries overlap):

- Merge duplicate or near-duplicate lessons into one entry and fold repeats into its `Recurrence` line.
- Drop entries that are obsolete (the code/tool/path no longer exists) or fully superseded by a broader rule.
- **Supersede a changed-mind lesson.** When a newer lesson contradicts or replaces an older rule (you changed your mind, or a broader rule subsumes it), do not leave both to compete — fold the old one into the new entry, or annotate the old entry's title with `(superseded by <date / short title>)` so it is visibly retired. Prefer one current rule over two conflicting ones.
- **Auto-expire a resolved one-time failure.** When the prerequisite behind a one-off environment/tooling failure is later satisfied (the missing runtime is installed, the directory is now a git repo, the worktree exists), the lesson no longer applies — drop it, or annotate its title with `(expired)` so a stale environment glitch stops biasing future runs.
- Keep newest first and keep each surviving entry's prevention rule and tags intact.

Consolidate as part of the write step when you notice overlap; do not let the file grow unbounded and rely on the digest cap to hide it. The SessionStart digest **skips any entry whose title ends with an `(expired)` or `(superseded …)` marker** (`hooks/load-failure-memory.js`), so a retired lesson stops being injected even before the next write deletes it — put the marker at the **end of the `###` title line** (a mid-title mention like "do not log (expired) creds" is deliberately not treated as retired) so the digest can see it.

To make consolidation **data-driven instead of by-feel**, the retrieval helper records usage and a second helper aggregates it:

- During planning, run `scripts/failure-retrieve.mjs` with **`--log`** so each entry it surfaces for a real task signature is appended to a sibling **append-only** ledger (`.failure-memory-usage.jsonl`, next to the memory file — **never** inside it; recording a hit must not touch the single-writer `FAILURE_MEMORY.md`). A "hit" means the entry was *relevant to real work*.
- At the consolidation step, run `node ${CLAUDE_PLUGIN_ROOT}/skills/vigil/scripts/failure-consolidate.mjs` for a deterministic prune advisory: it lists **retired** entries (delete on the next write) and **expire candidates** — dated entries old enough and never matched within the window. Honest by construction: an empty ledger or insufficient history makes **no** staleness claim (it never says "expire everything" from missing data), and undated or too-new entries are never flagged.
- The advisory is **evidence, not an action**: the `arbiter` decides what to actually merge/retire/delete, and the main thread (the single writer) applies those edits verbatim after the verdict. The ledger is local runtime telemetry — gitignore it; deleting it just resets the counts.

## Failure Memory Entry Template

Use the target file's existing template when it defines one. If the target `FAILURE_MEMORY.md` is new or has no template yet, seed it with the structure below and use this format for the first entry, so later entries stay consistent:

```markdown
# FAILURE_MEMORY

Reusable failure lessons. Newest first. Keep entries concise and prevention-oriented.

## Entry Template

### <YYYY-MM-DD> — <short title>
- **Context / intended method**: what was being attempted and the original approach that could not proceed.
- **What blocked it**: the abnormality, error, or rejection (command, runtime, tool, encoding, reviewer blocker, etc.).
- **Root cause**: why it actually failed.
- **Fix applied**: what made the repaired path valid.
- **Prevention rule**: the reusable rule that avoids this next time.
- **Tags**: language / area / error-type (used by the startup digest and targeted retrieval).
- **Scope**: project-specific or cross-project.
- **Recurrence**: note and increment if this lesson recurs (e.g. "seen again 2026-06-19").
```

When appending to an existing file, reuse its headings exactly; do not introduce a competing schema. Mark recurrences on the existing entry instead of creating a duplicate. A filled-in example (including the retire markers) lives at `examples/FAILURE_MEMORY.sample.md` in the shipped plugin.

## Artifact Hygiene

Leave the working tree clean. A run must not leave behind intermediate or process artifacts:

- Delete any temporary scaffolding created only to verify (one-off scripts, scratch files, temp directories) before finishing. Only intentional deliverables remain: the source changes, committed tests, and recorded failure memory.
- Distinguish throwaway artifacts (remove) from permanent assets (keep): a committed regression test suite or a documented config is an asset, not scratch.
- **Self-protect the whole `.ctide/output/` tree (footgun guard).** The first time a run writes anything under `.ctide/output/` (ledger, evidence, review diff, screenshots), create a **top-level** `.ctide/output/.gitignore` with `*` then `!.gitignore` — this ignores the **entire** run-scratch tree in one place (the rest of `.ctide/` — memory/design/ops/incidents — is deliberately committed), so a user can never accidentally commit run residue or a screenshot that may carry secrets/PII (`references/browser-evidence.md`, *Data sensitivity*). This subsumes the per-subdir `.gitignore`s below (still valid for older trees; the top-level one is the guarantee). Before finishing, if `.ctide/output/` holds artifacts but is **not** covered by gitignore (the file is missing, or git still tracks paths under it — `git check-ignore -q .ctide/output/<f>` fails, or `git status` shows them), surface a one-line **hygiene warning** in the report so the user fixes it before committing.
- **One-time migration (at the first scratch write).** Runs **only** when `.ctide/output/` is absent: when a compatibility `.ctide/legacy-output/` tree exists as a run first writes scratch, move the **whole tree** to `.ctide/output/` per the shared *One-time migration procedure* (above), each path to its **matching location**. Whole-tree deltas: the tree is gitignored so its files are normally untracked, but any path git does track must still be checked, not guessed (the shared trackedness check, step 2); it can hold **nested** content (e.g. `.ctide/legacy-output/evidence/shot.png`, `.ctide/legacy-output/review/diff.patch`), making the shared per-path directory-creation step (step 3) — immediately before the move — load-bearing: never once flat upfront for the whole tree. Delete the emptied compatibility tree afterward (leave unrelated sibling content under `output/` alone). Both trees exist ⇒ use `.ctide/output/`, move or overwrite nothing, disclose once that a compatibility copy remains for manual cleanup/merge. All scratch writes go under `.ctide/output/` only.
- Screenshots / evidence **referenced by the final report** (e.g. under `.ctide/output/evidence/`) are **kept evidence artifacts**, not throwaway scaffolding to delete; create `.ctide/output/evidence/.gitignore` (rule: `*` then `!.gitignore`, so the ignore file itself commits and travels) so they are never committed (the relative report links resolve only on the local working tree). They **may contain secrets / PII** (`references/browser-evidence.md`, *Data sensitivity*) — do not paste a report embedding them into a public PR / issue.
- A **large filtered review diff** the orchestrator hands to reviewers as a file (see `references/review-packet.md`, *Changed diff (filtered)*) lives under `.ctide/output/review/` — same posture as evidence: a **kept run artifact**, gitignored via its own `.ctide/output/review/.gitignore` (`*` then `!.gitignore`), never committed into a distributed tool/plugin repo. It can contain source under review, so treat its distribution like the report's.
- The **task contract** (`.ctide/output/contract.md`, `references/task-contract.md`) is a kept run artifact, covered by the top-level `.ctide/output/.gitignore`; never committed into a distributed repo (it is one run's scratch, not the consuming project's source).
- Do not commit the workflow's own runtime output (e.g. `FAILURE_MEMORY.md`) into a tool/library/plugin repository that gets distributed. Failure memory belongs in the project that *uses* the tool, not in the tool's own source tree; in a distributed package it is residue that ships to every user.

## Final Output Contract

The end-of-run report format lives in `references/final-report.md` (loaded at final delivery).
