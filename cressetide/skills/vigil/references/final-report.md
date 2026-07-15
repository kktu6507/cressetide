# Final Report Contract

The end-of-run report emitted at final delivery. Load this at final delivery time; the during-verification rules stay in `references/verification-gate.md`.

For substantial tasks, end with the single report below. Write the labels and prose in the **user's language**; the machine-checked literals and the three sentinel lines follow the footer contract stated after the templates (verbatim tokens, always the **last lines**). Same threshold throughout — omit the whole report for trivial edits and pure Q&A (which emit no sentinel tokens).

The report has two renderings. **Compact is the default.** Emit the detailed tables only when the run was invoked with `--report full`.

## Default (compact)

Emitted unless `--report full` was passed. Summary one-liner · a Verification block (Checks table + acceptance-criteria line + a one-line cost summary) · a Findings severity table · the Final Verdict · then the three sentinel lines last. On a **real run** (see *Evidence Record* below), the `### Live run` evidence block **MUST** be emitted just above the footer — it is **not optional on a real run**; the Stop hook (`orchestration-check.js`, advisory 4) reminds you if a real, verified, delivered run omits it.

~~~markdown
## Summary
- what was implemented (and the net effect), one line

## Verification

**Checks** (exit status, not opinion):

| Check | Result |
|---|---|
| `<command>` | ✅ pass / ❌ fail / ⚠️ unrun |

- Acceptance criteria: ✅ <N/N met> · list any unmet/deferred (note user-consented deferrals) · "n/a" for trivial work — an unmet, non-deferred criterion is incompatible with READY
- Cost: ~<new tokens> new tokens · tier: <lite | default | deep> (observed where surfaced, orchestrator estimated; no telemetry)
- Panel: <full, or name each evidence-substituted reviewer + the evidence that qualified it (fast lane — `references/reviewer-selection.md`)> — mirrored by the `ctide:panel=` footer line
- External capabilities: only when a required MCP / skill / subagent was unavailable — name it, the local fallback, and the resulting verification gap (omit the line entirely when none were needed or all were available). A real capability gap is decision-relevant, so it stays visible even in the compact report.
- Migration status: only when NOT migrated (this run consulted a legacy-only `ai/FAILURE_MEMORY.md` but the one-time `git mv` to `.ctide/memory/FAILURE_MEMORY.md` was not performed) — name the outstanding `git mv` action for the main thread (omit the line entirely when migrated or not applicable). A NOT-migrated state is a required post-verdict action, not a nice-to-know, so it stays visible even in the compact report.

## Findings

| Severity | n | Detail |
|---|--:|---|
| 🔴 blocker | <n> | <one line, or "none"> |
| 🟠 major | <n> | <one line, or "none"> |
| 🟡 minor | <n> | <one line, or "none"> |

## Final Verdict
- pick one: ✅ **READY** · ⚠️ **FIX REQUIRED** · 🔴 **NOT READY**

ctide:verify=<pass|fail|unrun|na>
ctide:delivery=<held|shipped>
ctide:panel=<full|substituted:comma-separated-names>
~~~

If blocked, add a `## Stuck Summary` (above the footer) with the unresolved blocker, attempted remedies, why progress is blocked, and what is needed next. On a real run, the `### Live run` block (see *Evidence Record* below) **MUST** be emitted just above the footer.

## `--report full`

Opt in with `--report full` for the detailed tables. This is the compact report **plus** an Outcome table, a per-agent activity table, a Files Changed table, the full Cost table (with the `█`/`░` Share bar + Source + ~Cost columns), and Assumptions / Missing Tests / Risks / Failure Memory sections. The sentinel footer is still the last thing emitted.

~~~markdown
## Summary
- what was implemented (and the net effect)

**Outcome** — requirement → change → effect (verified effects only, else "to be confirmed"):

| Requirement / acceptance criterion | What changed | Effect (before → after) |
|---|---|---|
| <the ask / AC1> | <the change> | <what is better now> |

**Per-agent activity** (one row per agent/phase that actually ran):

| Agent | What it did | Found | Fixed |
|---|---|---|---|
| implementer | <the change> | — | — |
| intent-reviewer | <scope reviewed> | 🟠 <n major> · 🟡 <n minor> (or "none") | ✅ <applied, if any> |
| arbiter | aggregated findings + verdict | <verdict + per-criterion acceptance> | — |

## Files Changed

| File | What / why |
|---|---|
| `<path>` | <one line> |

## Assumptions
- assumptions that affected design or implementation

## Verification

**Checks** (exit status, not opinion):

| Check | Result |
|---|---|
| `<command>` | ✅ pass / ❌ fail / ⚠️ unrun |

- Not run / uncertainty: exact blockers and remaining uncertainty for required checks not run
- Acceptance criteria: ✅ <N/N met> · list any unmet/deferred (note user-consented deferrals) · "n/a" for trivial work — an unmet, non-deferred criterion is incompatible with READY
- External capabilities: MCP / skills / subagents used; any unavailable, the local fallback, and the resulting verification gap — or "none"
- UI/UX evidence: for UI work, embed the **final (post-fix) after-change screenshot of each *changed* UI state** as a clickable relative path — `![after](.ctide/output/evidence/<state>.png)` — plus a one-line before → after and the tool used (drive per `references/browser-evidence.md`). **Changed states only** (never unchanged screens); only a screen you actually captured — never fabricate one. These are kept evidence under `.ctide/output/evidence/` (the Artifact Hygiene carve-out in `references/verification-gate.md`), not scratch. They **may contain secrets/PII and inherit this report's distribution** — do not embed sensitive states in a `--report full` you paste into a public PR/issue (`references/browser-evidence.md`, *Data sensitivity*); the relative links resolve only on the local working tree (*Storage* there). "no UI/UX impact" otherwise.

**Cost** (no telemetry — observed vs estimated). Tokens are itemized by **billable component** — they price differently (see the `claude-api` skill / pricing: output ≈ 5× input; cache-write ≈ 1.25× input; cache-read ≈ 0.1× input). `New` = Input + Output + Cache-write (first-time tokens); **Cache-read** is shown separately because the cached context re-bills it every turn (the ~20–30× inflator) but at ~1/10 the input rate. `Share` is a 10-cell `█`/`░` bar of the row's share of **New** tokens, from observed figures only:

| Agent / phase | Input | Output | Cache-write | Cache-read | New | Share | Source | ~Cost |
|---|--:|--:|--:|--:|--:|---|---|--:|
| <subagent> | <n> | <n> | <n> | <n> | <n> | `███░░░░░░░` <%> | observed | <~$ or —> |
| orchestrator (main thread) | <n> | <n> | <n> | <n> | <n> | `███░░░░░░░` <%> | estimate | … |
| **Total** | **<n>** | **<n>** | **<n>** | **<n>** | **<sum>** | `██████████` 100% | observed + estimate | **<~$ band>** · tier: <lite \| default \| deep> |

Per-component basis: the harness rarely surfaces a per-subagent Input/Output/Cache split — tag any component you did not observe `estimate` (apportioned) or `not reported`; never present an apportioned split as `observed`. State the per-model rate(s) assumed + the date, or give tokens only and write "× your plan's rate".

## Findings

| Severity | n | Detail |
|---|--:|---|
| 🔴 blocker | <n> | <one line, or "none"> |
| 🟠 major | <n> | <one line, or "none"> |
| 🟡 minor | <n> | <one line, or "none"> |

## Missing Tests
- required tests that do not exist (or "none")

## Risks
- known limitations or uncertainty (including any unresolved major + deferred items)

## Failure Memory

| Field | Value |
|---|---|
| Required | required / not required |
| Reason | <why> |
| Entry added | yes / no — <target file path when applicable> |
| Migration status | migrated / NOT migrated / n/a — when NOT migrated, the named `git mv` action for the main thread |

## Final Verdict
- pick one: ✅ **READY** · ⚠️ **FIX REQUIRED** · 🔴 **NOT READY**

ctide:verify=<pass|fail|unrun|na>
ctide:delivery=<held|shipped>
ctide:panel=<full|substituted:comma-separated-names>
~~~

If blocked, add a `## Stuck Summary` (above the footer) with the unresolved blocker, attempted remedies, why progress is blocked, and what is needed next. On a real run, the `### Live run` block (see *Evidence Record* below) **MUST** be emitted just above the footer.

The footer restates the report's decision so the human-readable report and the machine rollup cannot silently disagree: `ctide:delivery=` mirrors the Final Verdict (`held` unless the verdict is READY and you are shipping), `ctide:verify=` is the verification rollup — `pass` only when every required check actually ran and exited zero, `fail` on a non-zero required check, `unrun` when a required check was claimed but never ran, `na` when no command checks were required — and `ctide:panel=` states which review panel actually ran: `full`, or `substituted:` plus the comma-separated evidence-substituted reviewer names (`references/reviewer-selection.md`, *Evidence substitution*). The command exit status is authority over reviewer prose: a `fail` / `unrun` required check is incompatible with READY and shipping. Keep all three tokens and their values verbatim (machine-checked, like the verdict). This is true in **both** the compact and `--report full` renderings — the sentinel footer is always the last thing emitted.

Cost honesty (no telemetry) — **every figure carries its basis**. Tag each figure `observed` (the per-agent number the harness surfaces for a finished subagent) or `estimate` (the orchestrator / main-thread figure, and anything derived from it); **never present an estimate as observed**. If no figure is surfaced for a subagent, write `not reported` — do not guess. Because the grand total includes the orchestrator figure, it is never pure `observed` — the `--report full` Total row tags it `observed + estimate`, and it must never be shown as plain `observed`. An estimate must **state its assumption**: figures are **new tokens** — the billable `/cost` total re-counts cached context every turn (~20–30× in tokens, but cache reads bill at ~a tenth of the input rate, so the dollar cost scales much closer to the new-token figure; don't over-scare) — and `~Cost` is a rough band, not a bill, so state the assumed per-model rate(s) and date, or give tokens only and write "× your plan's rate". In the compact report this collapses to the one-line cost summary (new tokens + tier, with its basis named); `--report full` expands it into the per-agent Cost table whose `Source` column carries each row's basis. The full table now itemizes **Input / Output / Cache-write / Cache-read** (they bill at different rates) alongside the New-tokens total, and each component carries its own `observed` / `estimate` / `not reported` basis — an unobserved per-subagent split is never shown as `observed`.

**Presentation.** Prefer tables for the list-like sections (Files Changed, Checks, Cost, Findings, Per-agent activity, Outcome, Failure Memory); keep Assumptions / Missing Tests / Risks as bullets — they are narrative, and a table would be forced. Add light, terminal-renderable cues: the `█`/`░` Share bar in the cost table (observed figures only — never bar an estimate or a "not reported"), and status glyphs (✅ pass · ❌ fail · ⚠️ unrun; 🔴 blocker · 🟠 major · 🟡 minor; ✅ / ⚠️ / 🔴 before the verdict). **Glyphs are decoration only — keep the machine-checked literals as plain words beside them** (the verdicts, severities, and `ctide:` sentinels per the footer contract above); replacing a literal with only a glyph blinds the Stop hook. Never let a table or bar imply precision the figures do not have (no telemetry).

## Evidence Record (real runs only)

When ctide actually ran the workflow on a **real task in an actual project** (not a throwaway demo or a benchmark experiment), it **MUST** also emit a compact, paste-ready evidence record so the run can be logged with no reformatting — on a real run this is **required, not optional**. This is the only way real-use evidence gets logged: ctide ships no telemetry, so a run that isn't written down does not count. The **`### Live run` header is kept verbatim** (English, exactly `### Live run`) regardless of the report's language — it is a tooling-read marker, like the `ctide:` sentinels: the Stop hook (`orchestration-check.js`, advisory 4) detects a real, verified, delivered run that omitted the block by matching it, and will remind you to add it. Emit:
- the **`### Live run` block** below — paste it into the project's `EVIDENCE.md` *Real-world runs* section (or a PR that adds that section), and into the [`Verified ctide run`](https://github.com/kktu6507/cressetide/issues/new?template=verified-run.yml) issue form's **The run** box;
- a **one-line share link** directly under the block, in the user's language, so filing the run is one click while the evidence is in hand — point at the prefilled form: `https://github.com/kktu6507/cressetide/issues/new?template=verified-run.yml` (e.g. *"Share this run — no telemetry, so a run only counts if logged: <link> · pick run type + verdict, paste the block above"*). This line is emitted **only on a real run** (never for trivial edits, pure Q&A, or benchmark runs) and stays **one line** — no nagging, no per-run cost beyond it;
- a short **issue-form sheet** — the two form choices the block doesn't carry (run type, verdict), so the whole run files in two picks and one paste.

```markdown
### Live run — <YYYY-MM-DD> · <project / stack> (<language>) · verified live task
- Task: <one line: what ctide was asked to do>
- Intent given: <the requirement / contract handed in — and how specific it was>
- Reviewers: <which reviewers ran> · Verdict: <READY / FIX REQUIRED / NOT READY>
- Verification: <commands / browser checks / tests actually run>
- Caught: <real, valid findings ctide raised that were acted on>
- Missed: <none known at finish — to confirm in follow-up use>
- False alarms: <none, or describe any finding that was not a real defect>
- Outcome after follow-up: <to be confirmed by the user once the change has lived in the codebase>
- Cost: <~tokens / wall-clock> · Evidence: <commit / PR / sanitized log>
```

### Verified-run issue form — two picks + one paste

The [`Verified ctide run`](https://github.com/kktu6507/cressetide/issues/new?template=verified-run.yml) form is short: two dropdowns and one **The run** box that takes the whole `### Live run` block above (the block already carries the reviewers, the evidence link, and the Missed / False alarms / Outcome lines). Field names are the form's exact labels — keep them and the option literals verbatim:

```text
1. Run type — [select] Live task
2. Final ctide verdict — [select] READY | FIX REQUIRED | NOT READY | No formal verdict
3. The run — [paste] the whole `### Live run` block above (its header already carries date · stack · language; keep the Reviewers · Evidence · Missed / False alarms / Outcome lines)
```

- Marker words and prose follow the **user's language** (e.g. 〔貼〕 paste / 〔選〕 select / 〔勾〕 check); the **field names and option literals stay verbatim** so they match the GitHub form.
- Keep this list in sync with [`.github/ISSUE_TEMPLATE/verified-run.yml`](https://github.com/kktu6507/cressetide/blob/master/.github/ISSUE_TEMPLATE/verified-run.yml) — that form is the source of truth for the fields and options.

Rules: emit these records only when the workflow genuinely ran and verification was attempted; report findings and the verdict exactly as they were. **Never fabricate an outcome.** The *Missed* and *Outcome after follow-up* fields are honestly left for the user to fill later — ctide cannot know at finish time what (if anything) escaped the verdict. Omit them for trivial edits, pure Q&A, and benchmark runs.
