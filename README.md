<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/logo_mono.png">
    <img src=".github/assets/logo_color.png" alt="Cressetide logo" width="240">
  </picture>
</p>

# ctide - Cressetide (Claude Code plugin)

[![Validate](https://github.com/kktu6507/cressetide/actions/workflows/validate.yml/badge.svg)](https://github.com/kktu6507/cressetide/actions/workflows/validate.yml)

**English** · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md)

**ctide makes Claude Code behave like a cautious release engineer:** plan first, change only after approval, verify with evidence, then decide `READY` / `FIX REQUIRED` / `NOT READY`.

ctide covers development through production with two flows. The **dev flow** is a plan-gated code-review and release-readiness workflow: plan → approve → implement → verify → risk-selected review → verdict. The **incident flow** is that flow inverted for live production emergencies: mitigate first, diagnose second, hand the formal fix back to the dev flow, then close with a postmortem. ctide is not a bug scanner, linter, static analyzer, CI replacement, or zero-bug guarantee. Its job is to make AI-made changes traceable: stated intent, acceptance criteria, smallest safe implementation, real verification evidence, risk-selected review, and a arbiter verdict.

```text
Dev flow       Task -> Understand -> Plan (no code yet) -> YOU APPROVE plan + acceptance criteria
                    -> smallest safe change -> build / test / lint / browser evidence
                    -> risk-selected reviewers -> Gatekeeper verdict
                           READY / FIX REQUIRED / NOT READY -> repair loop when needed

Incident flow  Alert -> Triage -> preserve evidence -> MITIGATE FIRST (reversible, one decision card at a time)
                     -> diagnose -> red repro -> fix via the dev flow above (--lite)
                     -> production re-entry + observation window -> postmortem

Learning loop  incident postmortem -> FAILURE_MEMORY -> the next dev-flow planning reads it
```

## What's inside

Four skills, two of which engage on their own:

| Skill | Purpose | Details |
|---|---|---|
| `vigil` | The dev flow. Auto-engages on non-trivial dev work: plan-gated implement → verify → risk-selected review → verdict. Manual start: `/ctide:vigil`. | [How it works](#how-it-works) |
| `salvage` | The incident flow. Auto-engages on production-incident language: mitigate first, then hand the fix to the dev flow. Manual: `/ctide:salvage`; operational preparation belongs to `/ctide:map`. | [The incident flow](#the-incident-flow-salvage) |
| `map` | Repository-grounded system and operational-readiness map (`/ctide:map`); owns the operational-preparation contract. | [Quick start](#quick-start) |
| `doctor` | Local health self-check of the hooks + environment (`/ctide:doctor`); no telemetry. | [Quick start](#quick-start) |

The two flows feed each other: an incident's formal fix is handed to the dev flow as a `--lite` run with the incident reproduction as its primary acceptance criterion, and the incident postmortem writes a prevention rule into `FAILURE_MEMORY.md` — which dev-flow planning reads before the next change.

### Project layout

Everything ctide keeps in a consuming project lives under one root folder:

```text
.ctide/
  memory/     # FAILURE_MEMORY.md + EXPERIENCE.md — lessons + validated patterns the next plan reads (committed)
  design/     # design.md — the UI design contract (committed)
  map/        # SYSTEM_MAP.md — repository and operational-readiness Map (committed)
  incidents/  # INCIDENT-<date>-<slug>.md journals — the audit trail (committed)
  ledger/     # runs.jsonl — append-only run history (persists across runs, self-gitignored)
  output/     # per-run scratch: contract.md, evidence, review diffs (run scratch — never committed, self-gitignored)
```

Documented compatibility layouts (`ai/FAILURE_MEMORY.md`, a repo-root `design.md`, and `.ctide/legacy-output/`) are migrated one time: the workflow moves each file to its current home, removes the migrated copy, and discloses the move in-run.

## 30-second version

ctide does three things:

| Moment | What ctide adds |
|---|---|
| **Before coding** | Claude restates the requirement, turns it into a plan and acceptance criteria, and waits for approval. |
| **During coding** | `implementer` makes the smallest safe change and does not self-certify. |
| **Before delivery** | Risk-selected reviewers inspect the change against your intent, then `arbiter` decides `READY` / `FIX REQUIRED` / `NOT READY`. |

During a production incident, `salvage` adds the same discipline under fire:

| Moment | What ctide adds |
|---|---|
| **First minutes** | An evidence snapshot (~1 minute, non-skippable), then reversible mitigations — one decision card at a time; you approve or reject, and never have to read code. |
| **After stable** | Diagnose by fault domain, then a red→green reproduction gate before any fix. |
| **The fix** | Handed to the dev flow above — the incident skill never hot-patches production. |
| **After closure** | The postmortem feeds failure memory, so the next dev-flow plan already knows. |

Use ctide when "done" must mean release-ready: merging to `main`, shipping a user-facing change, or touching authentication, data, contracts, migrations, production behavior, or high-risk UI flow.

Skip ctide for typo fixes, pure formatting, very small no-risk edits, or quick looks. Use cheaper deterministic tools first when they fit.

> Live demo: [ctide-public-demo](https://github.com/kktu6507/ctide-public-demo) captures one `/ctide:vigil` end to end.

## Quick start

Prerequisites: **Claude Code** + `node` on `PATH`. The hooks are Node scripts; with no Node they silently no-op.

```text
# in your project directory, inside Claude Code:
/plugin marketplace add kktu6507/plugins
/plugin install ctide@kktu
# ctide ships DISABLED - enable it: /plugin -> Installed -> toggle ctide on
#   or: claude plugin enable ctide@kktu
/reload-plugins

# hand it a task:
/ctide:vigil Fix the login flow so expired access tokens are refreshed once before retrying the failed request.

# before you need it: build the incident ops map (where logs live, rollback paths, kill switches)
/ctide:map

# during an incident, plain language is enough — the skill auto-engages on incident language:
production is down — checkout returns 500s since the last deploy
```

> New to ctide? Walk through [your first run, end to end](docs/tutorial-first-run.md).

- **Install does not enable the plugin.** Until enabled, ctide's hooks and skills do nothing.
- **Marketplace name is `kktu`.** The install id is `ctide@kktu`.
- **Update:** `/plugin marketplace update kktu` (refresh the catalog) → `/plugin update ctide@kktu` → `/reload-plugins`.
- **Health check:** run `/ctide:doctor` when the gate never blocks, hooks seem silent, or Node may be missing.

## Good tasks

ctide works best when the task includes intent, acceptance criteria, must-not-change scope, expected verification, and risk areas.

```text
/ctide:vigil <change request>

Requirement:
- ...

Acceptance criteria:
- ...

Must not change:
- ...

Verification expected:
- ...

Risk areas:
- auth / data / contract / UI / performance / rollback
```

See [`docs/task-writing-guide.md`](docs/task-writing-guide.md) for bad / better / best examples and task templates for auth, API contracts, UI states, and migrations.

## When to use it

| Use ctide for | Usually skip ctide for |
|---|---|
| auth / authz changes | typos |
| API or schema contract changes | pure formatting |
| DB migration / data-integrity work | trivial local copy edits |
| UI flow, accessibility, or browser-visible states | quick non-release review |
| release-bound work needing stronger evidence | mechanical checks already covered by CI/linter |

## Anti-goals

ctide is not:

- a replacement for CI
- a replacement for linters or static analysis
- a guarantee of zero bugs
- a tool for exhaustive mechanical scanning
- meant for every tiny edit

The incident flow has its own non-goals — it is not:

- a paging or on-call rotation, nor status-page automation
- an SLO management suite or a full RBAC/permission layer
- a DFIR forensics lab (it classifies, contains, and recommends professionals)
- a multi-repo incident commander

Use ctide with:

- unit and integration tests
- linters and formatters
- static analysis and dependency scanners
- human review for high-risk releases
- controlled live-environment evidence when external systems matter

Linters catch mechanical issues. Tests catch known expected behavior. Static analysis catches known vulnerability patterns. ctide judges whether the AI-made change satisfies the stated intent and is ready to ship.

## How it works

One run, phase by phase (the dev flow):

| Phase | What happens |
|---|---|
| **Understand** | Restate the requirement; ask only when ambiguity changes behavior, contracts, destructive operations, security, or UX. |
| **Plan** | Stay read-only, ground the approach in the repo, and produce acceptance criteria. |
| **Approval** | No code changes before you approve the plan and criteria. |
| **Implement** | `implementer` applies the smallest safe change and writes the per-run task contract (`.ctide/output/contract.md`). |
| **Verify** | Run build / test / lint / typecheck / browser evidence as applicable; command exit status is authority. |
| **Review** | Only risk-relevant reviewers run, using a focused Review Packet instead of full thread history. |
| **Gatekeeper** | Aggregate findings, re-rate by impact, check each acceptance criterion, and decide `READY` / `FIX REQUIRED` / `NOT READY`. |

Verdicts are release-readiness decisions, not absolute truths. See [`docs/how-to-read-verdicts.md`](docs/how-to-read-verdicts.md).

## The incident flow (salvage)

Production is broken and the person at the keyboard did not write the code — the normal case for AI-written systems. `salvage` is the dev flow inverted: **mitigate first, diagnose second, formal fix last.** It engages automatically on incident language ("production is down", "users are blocked") or manually via `/ctide:salvage`. Every human interaction is a decision card; running an incident never requires you to read code.

| Stage | What happens |
|---|---|
| **1 · Triage** | Evidence-driven, not an interview: run health/error checks to establish severity (SEV1–3), blast radius, whether data is actively corrupting, and one explicit "could this be an intrusion?" check. |
| **2 · Preserve evidence** | The ~1-minute snapshot (logs, timestamps, running version) *before* anything restarts — non-skippable, even under pressure. |
| **3 · Mitigate (loop)** | Reversible, no-new-code actions — rollback (after a migration-compatibility pre-check), feature-flag off, degrade, scale, maintenance mode — one at a time, each verified before the next. Hot-patching unreviewed code into production is named as the classic second disaster and refused. |
| **4 · Diagnose** | Fault-domain classification first: code, config/environment, infrastructure, external dependency, or data. Only code and data continue to a reproduction; the others get direct remediation plus a declared fixed-check. |
| **5 · Reproduce** | A red reproduction — the failing output recorded in the journal — before any fix. An always-green check proves nothing. |
| **6 · Fix** | Handed to the dev flow: a `vigil --lite` run with "the incident repro turns green" as the primary acceptance criterion. `--lite` still keeps a directly-relevant safety reviewer on genuine high-risk signals — incident fixes usually carry them. |
| **— Data repair** *(when corruption occurred)* | The code fix stops new corruption; it does not repair the damage. Corruption window → affected-record counts → repair script proven red→green on an extracted copy → human-approved production run. |
| **— Production re-entry** | Deploy through the normal path, verify the declared fixed-check, hold an observation window, then restore mitigations one at a time. |
| **7 · Closure + postmortem** | A closure checklist (mitigations restored, data repaired, extracted data deleted, journal closed) plus a short, blame-free postmortem. |

**Prepare before you need it.** `/ctide:map` builds `.ctide/map/SYSTEM_MAP.md` — the peacetime map that makes wartime start at 30 seconds instead of 30 minutes: an access inventory marked agent-runnable vs human-only, rollback steps with schema-migration compatibility intel, feature flags, backups, and observability. Every entry carries a trust marker — `verified: <date>`, `dry-run-verified: <date>`, or `UNVERIFIED` — and an unverified rollback command is flagged on the decision card that relies on it, never silently trusted. Map reports readiness gaps honestly ("no backups found — a restore is impossible today").

**Decision cards.** One at a time: the recommendation, cost/tradeoff, reversibility, and exactly what will run on approval. Destructive or production-affecting actions always stop at a card — never batched into a previously approved plan. The `destructive-guard.js` hook will additionally ask before narrowly destructive commands; that is expected, never routed around.

**Incident journal.** Every stage appends to `.ctide/incidents/INCIDENT-<date>-<slug>.md` — a committed audit trail (timeline, actions with who approved each, evidence, the red→green record). Sanitize-before-write: PII and secrets are masked before anything enters the journal.

**Production-data safety gate.** When a reproduction needs real data: minimal extraction (only the implicated records, never a dump), PII/secrets masked *before* the data enters the AI context, a synthetic-data fallback when policy forbids production data, and extracted data is ephemeral — never committed, deleted at closure.

**The learning loop.** The postmortem includes a gate-gap analysis — *which dev-flow gate should have caught this before ship?* — answered with a concrete prevention rule and proposed as a failure-memory entry, which dev-flow planning reads before the next change.

Non-goals, briefly: no paging/on-call, no status-page automation, no SLO suite, no full RBAC, no DFIR-grade forensics, no multi-repo incident command (see [Anti-goals](#anti-goals)). The full stage contracts live in the skill's references (`cressetide/skills/salvage/references/`): `wartime.md`, `reproduction-and-repair.md`, `reentry-and-closure.md`; Map operational readiness: `cressetide/skills/map/references/operational-readiness.md`.

## The 11 subagents

You do not select reviewers manually; ctide assembles the panel by **risk** — a typo engages none, an authentication change engages the security reviewer. The full roster:

| Agent | Role | When it's added | Model |
|---|---|---|---|
| `navigator` | grounds the plan in real code, drafts the approach, pre-selects the panel, detects/recommends `design.md` (bootstrap from an existing UI) (read-only; feeds plan approval, never replaces it) | high-risk / correctness-critical planning | inherit |
| `implementer` | smallest safe change; never self-certifies | after plan approval | inherit |
| `intent-reviewer` | requirement / business-rule / contract fidelity | core (non-trivial) | inherit |
| `test-reviewer` | missing tests, weak verification, edges, regressions | core (non-trivial); evidence-substitutable on low/medium risk (fast lane) | inherit |
| `code-reviewer` | local quality, maintainability, framework use, efficiency | non-trivial code | inherit |
| `security-reviewer` | auth/authz, input handling, secrets, trust boundaries | security-relevant risk | **opus** |
| `architecture-reviewer` | layering, boundaries, dependency direction, placement | structural concerns | inherit |
| `operability-reviewer` | observability, retries/timeouts, deploy, rollback | runtime/prod impact | inherit |
| `ui-ux-reviewer` | usability, interaction, layout, states, accessibility; consistency vs `design.md` when present | UI impact | inherit |
| `cartographer` | builds, refreshes, and verifies the repository-grounded Map | map creation / refresh / verification | inherit |
| `arbiter` | aggregates, re-rates by impact, decides readiness | after reviewers finish | **opus** |

- **Reviewers hold no editor tools** — `Read` / `Grep` / `Glob` / `Bash` for inspection; review-only behavior is enforced by policy and context isolation, not a hard read-only capability boundary (see [`ARCHITECTURE.md`](ARCHITECTURE.md)). They propose the fix; the `implementer` applies it.
- **Correctness-critical paths receive ≥2 independent lenses** — parsing, numeric / encoding / overflow, concurrency, security, and data integrity — to reduce correlated misses on high-impact work.

## Examples and evidence

- [`examples/ready-run.md`](examples/ready-run.md) - illustrative `READY` report shape.
- [`examples/fix-required-run.md`](examples/fix-required-run.md) - illustrative `FIX REQUIRED -> READY` repair-loop shape.
- [`examples/not-ready-run.md`](examples/not-ready-run.md) - illustrative `NOT READY` report shape.
- [`examples/review-packet.md`](examples/review-packet.md), [`examples/final-report-compact.md`](examples/final-report-compact.md), and [`examples/final-report-full.md`](examples/final-report-full.md) show contract-field examples for reviewer input and delivery output; they are illustrative, not verbatim transcripts.

Real-world validation is tracked manually because ctide ships **no telemetry**. `EVIDENCE.md` is the source of truth:

| Track-2 metric | Current status |
|---|---|
| Type-B verified live runs | 0 recorded |
| Distinct real projects | 0 recorded |
| Non-maintainer runs | 0 / 1 |

Most valuable contribution: run ctide on real work and open a [Verified ctide run issue](https://github.com/kktu6507/cressetide/issues/new?template=verified-run.yml). Paste the `### Live run` block that ctide prints at the end. Keep misses, false alarms, cost, and follow-up outcome in the report; honest negatives are the point.

## Hooks and safety model

Six dependency-free Node hooks run in every enabled session. They are local-only, fail-open, and use only Node built-ins (`fs`, `os`, `path`, `crypto`).

| Hook | Event | Purpose |
|---|---|---|
| `plan-gate.js` | `PreToolUse` | Denies edit tools and obvious Bash/PowerShell writes while in plan mode. |
| `destructive-guard.js` | `PreToolUse` | Asks before narrow, unrecoverable destructive commands such as `rm -rf`, `git reset --hard`, `git push --force`, and PowerShell `Remove-Item -Recurse`. |
| `contract-guard.js` | `PreToolUse` | Asks before a Write/Edit/MultiEdit would remove/loosen a previously recorded contract acceptance criterion, `mustNotChange` entry, or scope path, downgrade `risk`, or wholesale-delete a `design.md` section. Watches `.ctide/output/contract.md` plus the legacy `.ctide/legacy-output/contract.md`. Also asks before a Write/Edit/MultiEdit to `.claude/settings.json` or `.claude/settings.local.json` would flip any of the four guard flags below from enabled to disabled in their effective, precedence-resolved value — including via a brand-new settings file. |
| `load-failure-memory.js` | `SessionStart` | Reads project `.ctide/memory/FAILURE_MEMORY.md` (legacy `ai/FAILURE_MEMORY.md` as a read-only fallback), else global `~/.claude/FAILURE_MEMORY.md`, and injects a nonce-fenced, untrusted digest. |
| `compact-fidelity.js` | `SessionStart` · `compact` | Re-injects a concise workflow-continuity reminder after compaction. |
| `orchestration-check.js` | `Stop` | Advises when delivery claims contradict missing panel, blocking verdict, failed/unrun verification, or missing live-run evidence. |

Each hook that can prompt or restrict has a per-project opt-out — see [Configuration reference](#configuration-reference) below.

These hooks never delete files, change system settings, alter permissions, run subprocesses, download code, or transmit code/transcripts. They are guardrails, not a sandbox. See [`SECURITY.md`](SECURITY.md) and [`ARCHITECTURE.md`](ARCHITECTURE.md). Hooks also never migrate, write, or delete ctide's project files — the one-time legacy-layout migration is performed by the workflow itself, as visible tool actions in your session.

## Configuration reference

Everything below is optional. ctide's default behavior needs no configuration at all.

**Persistent settings** — `.claude/settings.json` or `.claude/settings.local.json` (local takes precedence), all under an `"ctide": { ... }` object. Each is **on by default**; set to `false` to opt out for that project:

| Key | Disables |
|---|---|
| `planGate` | `plan-gate.js` — the edit-block enforced while in plan mode |
| `destructiveGuard` | `destructive-guard.js` — the ask before narrow, unrecoverable destructive commands |
| `contractGuard` | `contract-guard.js` — the ask before a Write/Edit/MultiEdit would weaken `.ctide/output/contract.md` (or the legacy `.ctide/legacy-output/contract.md`) or delete a `design.md` section; also the ask before a Write/Edit/MultiEdit to `.claude/settings.json` / `.claude/settings.local.json` would turn any of these four guard flags off |
| `preserveOnCompact` | `compact-fidelity.js` — the post-compaction workflow-continuity reminder |

A malformed or unreadable settings file is treated as "not disabled" (fail-safe: the guard keeps running). Example — disable `contract-guard.js` for one project:

```json
// .claude/settings.json
{
  "ctide": { "contractGuard": false }
}
```

**Environment variables** — unset (empty) by default:

| Variable | Effect when set |
|---|---|
| `CTIDE_ENFORCE_STOP` | any non-empty value makes the `orchestration-check.js` Stop hook hard-block delivery on a verdict/evidence mismatch, instead of only advising |
| `CTIDE_HOOK_DEBUG` | `1` makes every hook append a one-line debug trace (used by [`/ctide:doctor`](#quick-start) and manual troubleshooting) |

```bash
# bash/zsh
CTIDE_ENFORCE_STOP=1 claude
```

```powershell
# PowerShell
$env:CTIDE_ENFORCE_STOP = "1"; claude
```

**Per-task capabilities** — off unless explicitly enabled for that task, never a hard dependency:

| Capability | How to enable |
|---|---|
| Codex cross-model second opinion | say so in the task (e.g. "use Codex if the repair loop gets stuck") — see [`references/external-capabilities.md`](cressetide/skills/vigil/references/external-capabilities.md) |
| MCP tools per reviewer | ships with an empty `.mcp.json`; add a server (see [`mcp.example.json`](cressetide/mcp.example.json)) and uncomment the matching `mcp__*` line in that reviewer's frontmatter |

```text
/ctide:vigil Fix the login bug. Use Codex if the repair loop gets stuck.
```

**Per-run flags** — pass as arguments to `/ctide:vigil`:

| Flag | Effect |
|---|---|
| `--deep` (or a `deep:` / `ultra:` prefix) | opts into deep-mode Tier 2: adversarial verification of findings + maximum reasoning effort for `arbiter`/`security-reviewer` — raises cost, never auto-engaged |
| `--no-deep` / `--shallow` | opts out of deep-mode Tier 1's deterministic panel enforcement, which otherwise auto-engages on high-risk/correctness-critical work |
| `--lite` | forces the smallest sufficient review panel and skips Tier 2, keeping a directly-relevant safety reviewer when a high-risk signal is present |
| `--report full` | the detailed end-of-run report (per-agent activity, full token/cost table) instead of the compact default |

```text
/ctide:vigil --deep Refactor the payment retry logic so a network timeout retries once with backoff.
/ctide:vigil --lite Fix the typo in the error message copy.
/ctide:vigil --report full Add rate limiting to the public API.
```

## Compatibility

ctide targets Claude Code. It also degrades under GitHub Copilot CLI where the plugin format loads but some Claude-Code-only hook outputs are not surfaced.

Compatibility and conformance smoke details live in [`docs/compatibility.md`](docs/compatibility.md). The short version:

- Claude Code is the primary runtime.
- GitHub Copilot CLI loads skills, subagents, and some PreToolUse decisions, but injected `SessionStart` and `Stop` output may be no-op.
- No Cressetide-specific Copilot CLI live run is recorded yet; treat that runtime as unverified.
- Claude Code hook/agent contracts are moving targets; release smoke is recorded in [`RELEASING.md`](RELEASING.md).

## Trust and releases

ctide hooks auto-execute once the plugin is enabled, so install integrity matters.

Recommended safe install:

1. Install from a tagged release or pinned commit.
2. Review the shipped plugin's `hooks/` directory before enabling (repo path: `cressetide/hooks/`).
3. Run `/ctide:doctor` after install.
4. Verify release tags with `git verify-tag vX.Y.Z` when a signed tag is available.
5. Verify release archives against their published `.sha256` files when assets are available.

See [`SECURITY.md`](SECURITY.md) for the trust model and [`RELEASING.md`](RELEASING.md) for release checklist, live smoke, signed tag setup, and checksum verification.

The quick-start marketplace command is a convenience path and follows the marketplace/repo state. Release checksums integrity-check the published archive; authenticity still depends on a signed tag or pinned SHA. They do not authenticate the default clone path, so use a tagged/SHA checkout or compare the verified archive against the installed `cressetide/` tree when you need pinning.

## Cost

Typical real-app runs cost more than a one-shot AI review because ctide plans, verifies, reviews, and may repair. Order-of-magnitude guidance:

| Task | Reviewers | New tokens | Wall-clock |
|---|---|---|---|
| Light | `--lite`, core only | ~0.5-2M | a few minutes |
| Typical | 3-5 reviewers + one repair pass | ~2-7M | ~5-15 minutes |
| Deep | `--deep`, several repair loops | >10M | ~20-40 minutes |

The incident flow is cheap where it matters: wartime turns are short (one decision card at a time, no essays), the formal fix costs one normal ctide run (`--lite`), and Map refresh is a bounded repo scan.

Use `/ctide:vigil --lite` for cheaper runs, `--deep` for maximum scrutiny, and `--report full` when you need detailed per-agent activity and cost. An automatic **fast lane** goes one step further on small low/medium-risk changes: when execution evidence already answers the reviewer's question (every behavior-changing criterion has a red→green test and the full required suite is green), `test-reviewer` is evidence-substituted and disclosed via `ctide:panel=substituted:test-reviewer` — fewer agents on the same evidence, never on high-risk / deep runs.

## Docs

- [`docs/tutorial-first-run.md`](docs/tutorial-first-run.md) - your first ctide run, end to end.
- [`docs/task-writing-guide.md`](docs/task-writing-guide.md) - how to write tasks ctide can verify.
- [`docs/how-to-read-verdicts.md`](docs/how-to-read-verdicts.md) - what `READY` / `FIX REQUIRED` / `NOT READY` mean.
- [`docs/compatibility.md`](docs/compatibility.md) - tested runtimes and conformance smoke checklist.
- [`docs/advanced/external-capabilities.md`](docs/advanced/external-capabilities.md) - optional MCP, Codex, browser, and design capabilities.
- [`cressetide/examples/FAILURE_MEMORY.sample.md`](cressetide/examples/FAILURE_MEMORY.sample.md) - a filled-in failure-memory example (entry template + retire markers).
- [`EVIDENCE.md`](EVIDENCE.md) - Cressetide verification and live-run evidence log.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) - component map, stable contracts, and limits.
- [`SECURITY.md`](SECURITY.md) - trust model, safe install, and vulnerability reporting.
- [`RELEASING.md`](RELEASING.md) - release automation, live smoke, signed tags, and checksums.

## License

[MIT](LICENSE) · version history in [CHANGELOG.md](CHANGELOG.md).
