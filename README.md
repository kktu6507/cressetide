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

ctide covers development through production with two flows. The **dev flow** is a plan-gated code-review and release-readiness workflow: plan → approve → implement → verify → risk-selected review → verdict. The **incident flow** is that flow inverted for live production emergencies: mitigate first, diagnose second, hand the formal fix back to the dev flow, then close with a postmortem.

ctide is not a bug scanner, linter, static analyzer, CI replacement, or zero-bug guarantee.

Its job is to make AI-made changes traceable: stated intent, acceptance criteria, smallest safe implementation, real verification evidence, risk-selected review, and an arbiter verdict.

```text
Dev flow       Task -> Understand -> Plan (no code yet) -> YOU APPROVE plan + acceptance criteria
                    -> smallest safe change -> build / test / lint / browser evidence
                    -> risk-selected reviewers -> Gatekeeper verdict
                           READY / FIX REQUIRED / NOT READY -> repair loop when needed

Incident flow  Alert -> Triage -> preserve evidence -> MITIGATE FIRST (reversible, one decision card at a time)
                     -> diagnose -> red repro -> fix via the dev flow above (--lite)
                     -> production re-entry + observation window -> postmortem

Learning loop  run verdict -> ledger record -> the next planning reconciles: escaped / survived?
               incident postmortem -> FAILURE_MEMORY -> the next dev-flow planning reads it
```

## What's inside

<p align="center">
  <img src=".github/assets/flow_overview.svg" alt="Cressetide component flow: the vigil run contains plan-implement-verify and the risk-selected subagent panel; salvage, map, committed memory files, and the local run ledger feed it" width="100%">
</p>

- **Two flows**: dev ([`vigil`](#the-dev-flow-vigil)) and incident ([`salvage`](#the-incident-flow-salvage)). An incident's formal fix is handed back to the dev flow as a `--lite` run with the incident reproduction as its primary acceptance criterion.
- **Four skills**: `vigil` and `salvage` engage on their own (anything beyond a small edit / incident-sounding language); [`map`](#the-ops-map-map) and [`doctor`](#health-check-doctor) start manually (`/ctide:map`, `/ctide:doctor`).
- **[11 subagents](#the-dev-flow-vigil)**: a navigator, an implementer, seven risk-selected reviewers, a cartographer, and the arbiter that decides readiness.
- **[6 hooks](#hooks-and-safety-model)**: local-only, dependency-free Node guardrails, covering the plan gate, destructive-command guard, contract guard, failure-memory injection, compaction reminder, and delivery-claim check.
- **[A learning loop](#the-learning-loop)**: every run ends with a ledger record; the next run starts by checking whether past verdicts actually held.

### Project layout

Everything ctide keeps in your project lives under one root folder:

```text
.ctide/
  memory/     # FAILURE_MEMORY.md + EXPERIENCE.md — lessons + validated patterns the next plan reads (committed)
  design/     # design.md — the UI design contract (committed)
  map/        # SYSTEM_MAP.md — repository and operational-readiness Map (committed)
  incidents/  # INCIDENT-<date>-<slug>.md journals — the audit trail (committed)
  ledger/     # runs.jsonl — append-only run history (persists across runs, self-gitignored)
  output/     # per-run scratch: contract.md, evidence, review diffs (never committed, self-gitignored)
```

Legacy layouts (`ai/FAILURE_MEMORY.md`, a repo-root `design.md`, `.ctide/legacy-output/`) are migrated only once, by the workflow itself, and every move is spelled out in the run that performs it.

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
| **First minutes** | An evidence snapshot (~1 minute, non-skippable), then reversible mitigations, one decision card at a time; you never have to read code. |
| **After stable** | Diagnose by fault domain, then a red→green reproduction gate before any fix. |
| **The fix** | Handed to the dev flow above; the incident skill never hot-patches production. |
| **After closure** | The postmortem feeds failure memory, so the next dev-flow plan already knows. |

**Use ctide** when "done" must mean release-ready: merging to `main`, shipping a change users will see, or touching auth, data, API/schema contracts, migrations, production behavior, or high-risk UI flows.

**Skip it** for typos, pure formatting, and other zero-risk edits; cheap, deterministic tools like linters and formatters go first.

ctide is **not** a CI replacement, a linter or static analyzer, or a zero-bug guarantee, and it will not scan every file line by line. Keep your tests, linters, static analysis, and dependency scanners, and keep human review for high-risk releases. Mechanical problems are their job; what ctide judges is whether this AI-made change actually does what you asked, and whether it can ship.

> Live demo: [ctide-public-demo](https://github.com/kktu6507/ctide-public-demo) captures one `/ctide:vigil` end to end.

## Quick start

Prerequisites: **Claude Code** + `node` on `PATH`. The hooks are Node scripts; without Node they simply do nothing, and never raise an error.

```text
# in your project directory, inside Claude Code:
/plugin marketplace add kktu6507/plugins
/plugin install ctide@kktu
# ctide is DISABLED after install - enable it: /plugin -> Installed -> toggle ctide on
#   or: claude plugin enable ctide@kktu
/reload-plugins

# hand it a task:
/ctide:vigil Fix the login flow so expired access tokens are refreshed once before retrying the failed request.

# before you need it: build the incident ops map (where logs live, rollback paths, kill switches)
/ctide:map

# during an incident, plain language is enough — the skill auto-engages on incident language:
production is down, checkout returns 500s since the last deploy
```

> New to ctide? Walk through [your first run, end to end](docs/tutorial-first-run.md).

- **Install does not enable the plugin.** Until enabled, ctide's hooks and skills do nothing.
- **Marketplace name is `kktu`.** The install id is `ctide@kktu`.
- **Update:** `/plugin marketplace update kktu` (refresh the catalog) → `/plugin update ctide@kktu` → `/reload-plugins`.
- **Health check:** run [`/ctide:doctor`](#health-check-doctor) when the gate never blocks, hooks seem silent, or Node may be missing.

## The dev flow (vigil)

A run walks through these phases:

| Phase | What happens |
|---|---|
| **Understand** | Restate the requirement; ask only when ambiguity changes behavior, contracts, destructive operations, security, or UX. |
| **Plan** | Stay read-only, check the approach against what the repo actually looks like, and produce acceptance criteria. |
| **Approval** | No code changes before you approve the plan and criteria. |
| **Implement** | `implementer` applies the smallest safe change and writes the per-run task contract (`.ctide/output/contract.md`). |
| **Verify** | Run build / test / lint / typecheck / browser evidence as applicable; command exit status is authority. |
| **Review** | Only risk-relevant reviewers run, using a focused Review Packet instead of full thread history. |
| **Gatekeeper** | Aggregate findings, re-rate by impact, check each acceptance criterion, and decide `READY` / `FIX REQUIRED` / `NOT READY`. |

Verdicts are release-readiness decisions, not absolute truths. See [`docs/how-to-read-verdicts.md`](docs/how-to-read-verdicts.md).

**The reviewer panel.** You do not pick reviewers; ctide assembles the panel by **risk**: a typo engages no one, an authentication change pulls in the security reviewer. The full roster:

| Agent | Role | When it's added | Model |
|---|---|---|---|
| `navigator` | checks the plan against real code, drafts approach + panel, detects `design.md` (read-only; feeds plan approval, never replaces it) | high-risk / correctness-critical planning | inherit |
| `implementer` | smallest safe change; never self-certifies | after plan approval | inherit |
| `intent-reviewer` | requirement / business-rule / contract fidelity | core (non-trivial) | inherit |
| `test-reviewer` | missing tests, weak verification, edges, regressions | core; evidence-substitutable on low/medium risk | inherit |
| `code-reviewer` | local quality, maintainability, framework use, efficiency | non-trivial code | inherit |
| `security-reviewer` | auth/authz, input handling, secrets, trust boundaries | security-relevant risk | **opus** |
| `architecture-reviewer` | layering, boundaries, dependency direction, placement | structural concerns | inherit |
| `operability-reviewer` | observability, retries/timeouts, deploy, rollback | runtime/prod impact | inherit |
| `ui-ux-reviewer` | usability, interaction, states, accessibility; consistency vs `design.md` | UI impact | inherit |
| `cartographer` | builds, refreshes, and verifies the repository-grounded Map | map creation / refresh / verification | inherit |
| `arbiter` | aggregates, re-rates by impact, decides readiness | after reviewers finish | **opus** |

- **Reviewers hold no editor tools**: `Read` / `Grep` / `Glob` / `Bash` for inspection only; review-only behavior is enforced by policy and context isolation, not a hard read-only capability boundary (see [`ARCHITECTURE.md`](ARCHITECTURE.md)). They propose the fix; the `implementer` applies it.
- **Correctness-critical paths receive ≥2 independent lenses**: parsing, numeric / encoding / overflow, concurrency, security, and data integrity, so the panel does not share one blind spot on high-impact work.

**Writing good tasks.** ctide reviews against the intent you state, so the best tasks include the requirement, acceptance criteria, must-not-change scope, expected verification, and risk areas. Templates and bad / better / best examples: [`docs/task-writing-guide.md`](docs/task-writing-guide.md).

**Per-run flags.** `--lite` (smallest panel), `--deep` (adversarial verification), `--report full` (detailed report); details in [Configuration reference](#configuration-reference).

## The incident flow (salvage)

Production is broken and the person at the keyboard did not write the code — for AI-written systems, that is the normal case. `salvage` is the dev flow inverted: **mitigate first, diagnose second, formal fix last.**

It engages automatically on incident language ("production is down", "users are blocked") or manually via `/ctide:salvage`. Every human interaction is a decision card; running an incident never requires you to read code.

| Stage | What happens |
|---|---|
| **1 · Triage** | Evidence-driven, not an interview: health/error checks establish severity (SEV1–3), blast radius, whether data is actively corrupting, and one explicit "could this be an intrusion?" check. |
| **2 · Preserve evidence** | The ~1-minute snapshot (logs, timestamps, the running version) *before* anything restarts. Non-skippable, even under pressure. |
| **3 · Mitigate (loop)** | Reversible, no-new-code actions: rollback (after a migration-compatibility pre-check), feature-flag off, degrade, scale, maintenance mode. One at a time, each verified. Hot-patching unreviewed code into production is called out as the classic second disaster and refused. |
| **4 · Diagnose** | Fault-domain classification first: code, config/environment, infrastructure, external dependency, or data. Only code and data continue to a reproduction; the others get direct remediation plus a declared fixed-check. |
| **5 · Reproduce** | A red reproduction, with the failing output recorded in the journal, before any fix. An always-green check proves nothing. |
| **6 · Fix** | Handed to the dev flow: a `vigil --lite` run with "the incident repro turns green" as the primary acceptance criterion. |
| **— Data repair** *(when corruption occurred)* | The code fix stops new corruption; it does not repair the damage. Corruption window → affected-record counts → repair script proven red→green on an extracted copy → human-approved production run. |
| **— Production re-entry** | Deploy through the normal path, verify the declared fixed-check, hold an observation window, then restore mitigations one at a time. |
| **7 · Closure + postmortem** | A closure checklist (mitigations restored, data repaired, extracted data deleted, journal closed), plus a short, blame-free postmortem with a gate-gap analysis that feeds [the learning loop](#the-learning-loop). |

- **Decision cards**: one at a time, carrying the recommendation, cost/tradeoff, reversibility, and exactly what will run on approval. Destructive or production-affecting actions always stop at a card, never batched into a previously approved plan; the `destructive-guard.js` hook may additionally ask, which is expected and never routed around.
- **Incident journal**: every stage appends to `.ctide/incidents/INCIDENT-<date>-<slug>.md`, a committed audit trail (timeline, who approved each action, evidence, the red→green record). Sanitize-before-write: PII and secrets are masked before anything enters the journal.
- **Production-data safety gate**: when a reproduction needs real data, extraction stays minimal (only the implicated records, never a dump), masking happens *before* the data enters the AI context, a synthetic-data fallback covers policies that forbid production data, and extracted data is ephemeral; never committed, deleted at closure.

What it does not do, in one line: no paging/on-call rotation, no status-page automation, no SLO suite, no full RBAC layer, no DFIR-grade forensics (it classifies, contains, and recommends professionals), no multi-repo incident command. The full stage contracts live in [`cressetide/skills/salvage/references/`](cressetide/skills/salvage/references/): `wartime.md`, `reproduction-and-repair.md`, `reentry-and-closure.md`.

## The ops map (map)

**Prepare before you need it.** `/ctide:map` builds `.ctide/map/SYSTEM_MAP.md`: the peacetime map that makes wartime start at 30 seconds instead of 30 minutes. It holds an access inventory marked agent-runnable vs human-only, rollback steps with schema-migration compatibility intel, feature flags, backups, and observability.

Every entry carries a trust marker (`verified: <date>`, `dry-run-verified: <date>`, or `UNVERIFIED`); an unverified rollback command is flagged on the decision card that relies on it, never silently trusted.

Map reports readiness gaps honestly ("no backups found, a restore is impossible today").

Map owns the operational-preparation contract: [`operational-readiness.md`](cressetide/skills/map/references/operational-readiness.md).

## Health check (doctor)

`/ctide:doctor` runs a local, read-only self-check of the hooks and environment (plugin identity, Node availability, whether the hooks are wired up), and transmits nothing (no telemetry). Run it when the gate never blocks, hooks seem silent, or Node may be missing.

## The learning loop

From run to run, ctide carries forward what it learned — the losses and the wins:

- **Every run ends with a ledger record.** After the verdict locks, one event-fact line is appended to `.ctide/ledger/runs.jsonl`: task, changed files (computed from `git diff`, never taken from an agent's claim), verdict, verification status, panel, repair count, findings, and planned scope vs observed drift. Facts only: the ledger never stores a score, rate, or percentage.
- **The next run starts by checking whether past verdicts held.** Planning scans later commits for rework of each recorded run's files and disposes it as `escaped` / `survived` / `superseded` / `building-upon`. Overlap it cannot judge is marked "needs human review" and handed to a person, never silently passed. Three `escaped` closures within 14 days makes the end-of-run report suggest a retro ([`docs/advanced/retro-practice.md`](docs/advanced/retro-practice.md)). These counts exist to inform you, appear only after the verdict is locked, and never adjust the current run's scope, panel, or verdict.
- **The lessons live in two committed memory files.** `.ctide/memory/FAILURE_MEMORY.md` holds prevention rules (from incident postmortems and escaped defects); a SessionStart hook injects an untrusted digest so the next plan reads it. `.ctide/memory/EXPERIENCE.md` holds validated positive patterns (`candidate → validated → standard`; `standard` requires a linked executable asset, and prose alone never gets promoted).

Full contracts: [`run-ledger.md`](cressetide/skills/vigil/references/run-ledger.md) · [`experience-memory.md`](cressetide/skills/vigil/references/experience-memory.md).

## Hooks and safety model

Six dependency-free Node hooks run in every enabled session. They are local-only, fail-open, and use only Node built-ins (`fs`, `os`, `path`, `crypto`).

| Hook | Event | Purpose |
|---|---|---|
| `plan-gate.js` | `PreToolUse` | Denies edit tools and obvious Bash/PowerShell writes while in plan mode. |
| `destructive-guard.js` | `PreToolUse` | Asks before narrow, unrecoverable destructive commands such as `rm -rf`, `git reset --hard`, `git push --force`, PowerShell `Remove-Item -Recurse`, `terraform destroy`, `kubectl delete namespace`, `docker volume rm/prune`, and database-drop CLIs (`dropdb`, `mysqladmin`, `redis-cli flushall`). |
| `contract-guard.js` | `PreToolUse` | Guards the contract against mid-run weakening: asks before an edit would delete or rewrite an acceptance criterion, drop a `mustNotChange` or scope entry, downgrade risk (contract in `.ctide/output/contract.md`, legacy `.ctide/legacy-output/` included), or wholesale-delete a `design.md` section; also asks before an edit to `.claude/settings*.json` would flip any ctide guard flag from on to off (creating a fresh settings file to do it counts too). |
| `load-failure-memory.js` | `SessionStart` | Reads project `.ctide/memory/FAILURE_MEMORY.md` (legacy `ai/FAILURE_MEMORY.md` as read-only fallback), else global `~/.claude/FAILURE_MEMORY.md`, and injects a nonce-fenced, untrusted digest. |
| `compact-fidelity.js` | `SessionStart` · `compact` | Re-injects a concise workflow-continuity reminder after compaction. |
| `orchestration-check.js` | `Stop` | Advises when delivery claims contradict missing panel, blocking verdict, failed/unrun verification, or missing live-run evidence. |

These hooks never delete files, change system settings, alter permissions, run subprocesses, download code, or transmit code/transcripts. They are guardrails, not a sandbox; see [`SECURITY.md`](SECURITY.md) and [`ARCHITECTURE.md`](ARCHITECTURE.md).

Hooks also never migrate, write, or delete ctide's project files; the one-time legacy-layout migration is performed by the workflow itself, as visible tool actions in your session. Each hook that can prompt or restrict has a per-project opt-out, listed in the [Configuration reference](#configuration-reference).

## Configuration reference

Everything below is optional. ctide's default behavior needs no configuration at all.

**Persistent settings**: `.claude/settings.json` or `.claude/settings.local.json` (local takes precedence), all under an `"ctide": { ... }` object. Each is **on by default**; set to `false` to opt out for that project:

| Key | Disables |
|---|---|
| `planGate` | `plan-gate.js`: the edit block enforced while in plan mode |
| `destructiveGuard` | `destructive-guard.js`: the ask before narrow, unrecoverable destructive commands |
| `contractGuard` | `contract-guard.js`: the contract/design weakening ask, including the ask before turning these guard flags off |
| `preserveOnCompact` | `compact-fidelity.js`: the post-compaction workflow-continuity reminder |

A malformed or unreadable settings file is treated as "not disabled" (fail-safe: the guard keeps running). Example — disable `contract-guard.js` for one project:

```json
// .claude/settings.json
{
  "ctide": { "contractGuard": false }
}
```

**Environment variables** (unset by default):

| Variable | Effect when set |
|---|---|
| `CTIDE_ENFORCE_STOP` | any non-empty value makes the `orchestration-check.js` Stop hook hard-block delivery on a verdict/evidence mismatch, instead of only advising |
| `CTIDE_HOOK_DEBUG` | `1` makes every hook append a one-line debug trace (used by [`/ctide:doctor`](#health-check-doctor) and manual troubleshooting) |

```bash
CTIDE_ENFORCE_STOP=1 claude            # bash/zsh
```

```powershell
$env:CTIDE_ENFORCE_STOP = "1"; claude  # PowerShell
```

**Per-task capabilities**: off by default, enabled only when that task says so, never a hard dependency:

| Capability | How to enable |
|---|---|
| Codex cross-model second opinion | say so in the task (e.g. "use Codex if the repair loop gets stuck"); see [`references/external-capabilities.md`](cressetide/skills/vigil/references/external-capabilities.md) |
| MCP tools per reviewer | ships with an empty `.mcp.json`; add a server (see [`mcp.example.json`](cressetide/mcp.example.json)) and uncomment the matching `mcp__*` line in that reviewer's frontmatter |

**Per-run flags** (passed as arguments to `/ctide:vigil`):

| Flag | Effect |
|---|---|
| `--deep` (or a `deep:` / `ultra:` prefix) | opts into deep-mode Tier 2: adversarial verification of findings + maximum reasoning effort for `arbiter`/`security-reviewer`; raises cost, never auto-engaged |
| `--no-deep` / `--shallow` | opts out of deep-mode Tier 1's deterministic panel enforcement, which otherwise auto-engages on high-risk/correctness-critical work |
| `--lite` | forces the smallest sufficient review panel and skips Tier 2, keeping a directly-relevant safety reviewer when a high-risk signal is present |
| `--report full` | the detailed end-of-run report (per-agent activity, full token/cost table) instead of the compact default |

```text
/ctide:vigil --deep Refactor the payment retry logic so a network timeout retries once with backoff.
/ctide:vigil --lite Fix the typo in the error message copy.
```

## Compatibility

ctide targets Claude Code. It also runs under GitHub Copilot CLI, with caveats: the plugin format loads, but some Claude-Code-only hook outputs never arrive.

Compatibility and conformance smoke details live in [`docs/compatibility.md`](docs/compatibility.md). The highlights:

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

The quick-start marketplace command is the convenient path, and it follows whatever state the marketplace and repo are in at that moment.

Release checksums integrity-check the published archive; authenticity still depends on a signed tag or pinned SHA. They do not authenticate the default clone path, so use a tagged/SHA checkout or compare the verified archive against the installed `cressetide/` tree when you need pinning.

## Cost

Typical real-app runs cost more than a one-shot AI review because ctide plans, verifies, reviews, and may repair. Rough orders of magnitude:

| Task | Reviewers | New tokens | Wall-clock |
|---|---|---|---|
| Light | `--lite`, core only | ~0.5-2M | a few minutes |
| Typical | 3-5 reviewers + one repair pass | ~2-7M | ~5-15 minutes |
| Deep | `--deep`, several repair loops | >10M | ~20-40 minutes |

The incident flow is cheap where it matters: wartime turns are short (one decision card at a time, no essays), the formal fix costs one normal `--lite` run, and a Map refresh only scans a bounded slice of the repo.

An automatic **fast lane** goes one step further on small low/medium-risk changes: when execution evidence already answers the reviewer's question (every behavior-changing criterion has a red→green test and the full required suite is green), `test-reviewer` is evidence-substituted and disclosed via `ctide:panel=substituted:test-reviewer`. Same evidence, fewer agents; high-risk and deep runs never take the fast lane.

## Examples and evidence

These show what the reports look like; they are not verbatim transcripts:

- [`examples/ready-run.md`](examples/ready-run.md), [`examples/fix-required-run.md`](examples/fix-required-run.md), [`examples/not-ready-run.md`](examples/not-ready-run.md) - the three verdict outcomes, including a `FIX REQUIRED -> READY` repair loop.
- [`examples/review-packet.md`](examples/review-packet.md), [`examples/final-report-compact.md`](examples/final-report-compact.md), [`examples/final-report-full.md`](examples/final-report-full.md) - contract-field examples for reviewer input and delivery output.

Real-world validation is tracked manually because ctide ships **no telemetry**. [`EVIDENCE.md`](EVIDENCE.md) is the source of truth:

| Track-2 metric | Current status |
|---|---|
| Type-B verified live runs | 0 recorded |
| Distinct real projects | 0 recorded |
| Non-maintainer runs | 0 / 1 |

Most valuable contribution: run ctide on real work and open a [Verified ctide run issue](https://github.com/kktu6507/cressetide/issues/new?template=verified-run.yml). Paste the `### Live run` block that ctide prints at the end. Keep misses, false alarms, cost, and follow-up outcome in the report; honest negatives are the point.

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
