# Efficiency measurement (L0 + L1b instrumentation)

Maintainer-only. This document is the L0 deliverable for the efficiency roadmap
([`docs/superpowers/specs/2026-09-08-cressetide-efficiency-roadmap.md`](superpowers/specs/2026-09-08-cressetide-efficiency-roadmap.md))
and the operating manual for the L1b driver under `eval/efficiency/`. Nothing here changes a
runtime contract, a default mode, or a model tier. `eval/` never ships in the distributed
`cressetide/` plugin tree.

> **Current status (2026-09-10):** the efficiency investigation is **closed** — retain the current
> default, adopt neither investigated candidate. That decision is final; the original roadmap is
> **not** complete or validated, and no skipped gate is marked passed. See the
> [final disposition](superpowers/reviews/2026-09-10-efficiency-final-disposition.md) and its
> [evidence](superpowers/reviews/2026-09-10-efficiency-final-native-evidence.json), plus the Final
> checkpoint below. The historical checkpoints below are retained unchanged.

## Recorded checkpoint (2026-09-08)

2026-09-09 live capability update: [phase28's separate four-call observation](superpowers/reviews/2026-09-09-plan-review-live-capability-codex-review.md) completed the actual plan/opinion/resolution/revision/approval/implementation channel with one Opus5 session. Root verified exact stdin/argv/raw/guards/tree and public tests2/2; all123 protected files remain unchanged. Reported estimates sum to US$0.518038 under the declared per-process convention, kept separate from the old pilot and excluding collaboration. No native Vigil, full-flow efficiency, hidden quality confirmation or GPT-6 Astra runtime-benefit claim follows. The origin-only patch's own acceptance is57 tests/56 passes/one Windows skip/zero failures plus26+3 independent scenarios; it does not rewrite the phase27 counts below.

2026-09-09 private capability update: the separate `plan-review-feasibility-p1` driver passed offline Windows acceptance after read-only discussion and distinct repair authorizations. Root verified53 tests (52 pass, one symlink privilege skip, zero failures),26 independent cases, and123 unchanged protected files. It captures the exact approved revised plan and root resolution at the actual injected stdin seam. This is protocol feasibility only, with no live consumer call, native Vigil integration, hidden behavior grade or efficiency claim. See the [independent review and limitations](superpowers/reviews/2026-09-09-plan-review-feasibility-codex-review.md). L2/L3 evidence gates and eligible real-task history remain unresolved; the prior pilot stays closed.

One L1b batch has run under this protocol. The reference is recorded in
[`../eval/baseline.md`](../eval/baseline.md) and the full evidence — per-call accounting, frozen
digests and reviewer outputs — in
[`superpowers/reviews/2026-09-08-efficiency-l1b-evidence.json`](superpowers/reviews/2026-09-08-efficiency-l1b-evidence.json).

Reference outcome: **5/5** on the defect fixtures and **2/2** clean-control acceptance, over **14
formal role calls** (7 reviewer + 7 judge) plus **1 retained aborted pilot** that the strict model
gate refused and which was neither scored nor replaced. Estimated cost **1.4056655 + 0.1671225 =
1.572788 USD**, CLI bundled-price-table estimates rather than provider billing, excluding all
implementation and discussion collaboration.

This is a constrained-excerpt prompt-body replay reference only. Native plugin activation remains
unverified, **global L0 and L1a remain gated** (see §5), and the judge has not been calibrated on
intentionally missed-defect or false-positive reviews — **negative calibration is required before
this baseline is relied on as a drift gate**. All caveats in §3 and §4 continue to apply.

`eval/baseline.md` is still never written by this tooling; it is updated by a person after
independent inspection.

## 1. Capability table — what the CLI actually reports

Field availability follows the Agent SDK cost-tracking documentation
(<https://code.claude.com/docs/en/agent-sdk/cost-tracking>). Scope differences are the
important part: the two usage surfaces do not measure the same thing.

| Quantity | Source field | Scope | Captured as |
|---|---|---|---|
| Fresh input tokens | `result.usage.input_tokens` | main loop only | `stream.result.usage.inputTokens` |
| Cache-write input | `result.usage.cache_creation_input_tokens` | main loop only | `…cacheCreationInputTokens` |
| Cache-read input | `result.usage.cache_read_input_tokens` | main loop only | `…cacheReadInputTokens` |
| Output tokens | `result.usage.output_tokens` | main loop only | `…outputTokens` |
| Per-model tokens | `result.modelUsage[<model>]` | whole query, **including children** | `stream.result.modelUsage` |
| Per-model estimate | `modelUsage[<model>].costUSD` (+ `costBasis`, `provider`) | whole query | `…costUsd` |
| Query estimate | `result.total_cost_usd` | whole query | `stream.result.totalCostUsd` |
| Subagent counters | `result.subagent_stats` | whole query | `stream.result.subagent` (see below) |
| Wall / API time | `result.duration_ms`, `result.duration_api_ms` | whole query | `stream.result.duration*` |
| Turns | `result.num_turns` | whole query | `stream.result.numTurns` |
| Permission denials | `result.permission_denials` | whole query | count only |
| Tool surface | `system/init.tools` | session | `stream.init.tools` |
| Loaded plugins / MCP / slash | `system/init.plugins`, `.mcp_servers`, `.slash_commands` | session | names only |
| Observed tool use | assistant `tool_use` blocks | session | names only, never inputs |
| Per-message output | `assistant.message.usage.output_tokens` | **placeholder** | diagnostics only, never summed |
| **Selected agent identity** | — | — | **not reported** (see §3) |
| **Per-child cost attribution** | — | — | **unsupported** |

Consequences fixed in code:

- A generic transcript record never requires `usage` and `modelUsage` to agree, because their
  scopes differ whenever a child ran. Equality is asserted only by `strictZeroChildFaults()`,
  for the strict zero-child profile where the two scopes coincide.
- **`subagent_stats` is a set of named counters, several of which overlap.** `spawned` alone is
  the child count; `requested` / `killed` / `refused` / `completed` / `failed` / `by_type` are
  activity evidence. They are never summed with each other, and never enter a cost figure. A
  nonzero non-`spawned` counter is treated as child *activity* — enough to refuse the strict
  zero-child profile — but is not counted as a spawned child. Three states are recorded:
  `counters`, `absent`, `unrecognized`. **Absent and unrecognized are unknown, never zero**;
  an unrecognized shape is an explicit strict fault, and an absent field is tolerated because
  the zero-child scope rests on the deliberately closed `--tools` surface with the counters as
  corroboration.
- `total_cost_usd` and `costUSD` are **client-side estimates from the CLI's bundled pricing
  table, not provider billing**, and that table travels with the CLI version. A cost figure is
  comparable only within one pinned CLI version.
- Missing non-negative numerics are `null`, never `0`. A **missing per-call cost is a hard
  stop from step 0 onward**, because it breaks the only spend control there is.
- Child attribution is declared unsupported. L1b certifies single-process, zero-child role
  invocations only. **L1a, which involves subagents, stays gated until aggregate child
  accounting is demonstrated.** A strict-profile mismatch halts the next dispatch and is
  investigated; it does not erase a recorded semantic grade, and it does not prove that
  whole-tree accounting is impossible in general.

The phase18b discrepancy that motivated this table (`usage` cache-read 2,800 vs `modelUsage`
cache-read 966,506) came from a resumed turn that included compaction. Resumed or compacted
metadata is used **only as evidence of field availability**; it is not eligible as a fresh
baseline, and no specific unobserved charge is claimed to be explained by scope semantics
alone. Observed mismatches stay disclosed as mismatches.

## 2. Control table — trigger, obligation, required evidence

Adoption is not compliance, and an artifact is not verified behaviour. Sources read:
`references/reviewer-selection.md`, `SKILL.md` §Reference Loading,
`references/verification-gate.md` §Repair-iteration scoping.

| Control | Trigger | Obligation | Evidence required to verify | Source |
|---|---|---|---|---|
| `intent-reviewer` runs | non-trivial formal review | **required, never substituted** | observed panel composition | `reviewer-selection.md:9` |
| `test-reviewer` runs | default | **required by default**, conditionally exempt | observed panel + fast-lane eligibility | `:10` |
| Evidence substitution (fast lane) | both: every behaviour-changing AC has a demonstrated red→green test (≥1 exists) **and** the full required suite is green (`ctide:verify=pass`; `na` never qualifies) | **automatic** when both hold and no exclusion applies; only `test-reviewer` | per-AC red→green observation, suite result, risk tier, TP state, deep-mode state | `:69-77` |
| Fast-lane exclusions | High risk, correctness-critical, deep mode either tier, **every TP-active run incl. a confirmed-empty inventory** | **required** | risk classification + `ChangedTestInventory` state | `:72-73` |
| Conditional reviewers (code / security / architecture / operability / ui-ux) | the named trigger lists | **automatic** | changed-path classification vs the trigger list | `:14-51` |
| Risk-Matrix panel scaling | risk tier | **automatic** — stated as *the* default cost control | assigned risk tier + observed panel | `:56-59`, `:63` |
| Correctness-critical two-lens floor | parsing, numeric/encoding/overflow, concurrency, trust boundary, data integrity | **required**, overrides cost controls | classification + observed panel ≥ 2 lenses | `:59`, `:106` |
| `--lite` | user flag | **explicit opt-in** — its absence is never noncompliance | invocation flags | `:63` |
| `--lite` safety floor | a High-risk signal present under `--lite` | **required** + disclosed | risk signal + retained reviewer + disclosure | `:65` |
| 1C arbiter fold-in | ~≤40 changed lines, ≤2 files, no new dependency, lint/typecheck/build green | **MAY**, disclosed; spawn on boundary doubt | diff size, dependency delta, check results | `:78` |
| Model down-tier | `opus` session **and** `--lite` | **MAY** for `test-reviewer` / `code-reviewer` only; `intent-reviewer` stays `inherit`; `security-reviewer` + `arbiter` stay up-tiered unconditionally; disclose | per-reviewer resolved model | `:98-100` |
| Repair-loop rerun scoping | repair iteration | **required**: affected checks only, **plus** the full required set once more before `READY`, **plus** carried-forward-green marked distinctly from re-ran-green | per-iteration check table with run/carried status | `verification-gate.md:34-41`, `reviewer-selection.md:86-94` |
| Conditional reference loading | the per-reference trigger list | **required** ("read these references only when needed"); `final-report.md` at delivery only; `reviewer-common.md` is the sync source, not runtime-loaded | observed reference reads per phase | `SKILL.md:33-55` |

**No adherence number is produced, and none is computable today.** The footer sentinel
`ctide:panel=full|substituted:<names>` (`:76`) reports a **claimed** substitution status. It
does not enumerate actual panel composition and carries no eligibility evidence, so it cannot
establish substitution adherence on its own: that would additionally need a frozen eligible
denominator plus observed AC red→green, suite result, risk tier, TP state, deep-mode state and
exclusion status. Observed or claimed **adoption** is therefore recorded separately from
compliance, and the "evidence required" column above states what each row would need.

Two rules carried from the design dialogue:

- A default run that did not choose `--lite` is **not** noncompliant.
- Two reviewers reading the same bytes may be necessary independence **or** redundancy,
  depending on purpose, freshness and cache state. A repeated path alone establishes neither.

## 3. L1b protocol freeze

### Method and its limits

The reviewer is a **replay of the shipped `code-reviewer` prompt body**, delivered through
`--system-prompt`. Per <https://code.claude.com/docs/en/cli-reference>, `--system-prompt`
replaces the **entire** default system prompt including tool guidance. That replacement is a
deliberate choice: it makes the exact bytes under test reproducible and hashable. It does not
disable the technical tool or file-root boundary.

`init` in CLI 2.1.263 lists available agents, plugins, model and tools but **not a selected
agent identity or system prompt**, and it is not a documented pre-prompt handshake. There is
therefore no way to assert that `--plugin-dir` + `--agent` resolved correctly before the prompt
is delivered, and a silent fallback to a generic assistant would produce a plausible review
indistinguishable from the real one. Replay removes the unassertable variable. No plugin is
loaded and no `--agent` is passed.

**This is a constrained-excerpt prompt-drift baseline for that exact prompt body. Native
plugin agent activation is not verified and is not claimed.** A future run is comparable to
this one only if it uses the same method.

### The method is frozen, not configured

Model (`claude-opus-5`), effort (`xhigh`), CLI version (`2.1.263`), the tool surfaces and the
whole argv are module constants. There is no operator argv, no flag remapping, no model
override — the driver exposes no way to change the method, because a configurable measurement
method is a method that can be silently changed. A different method is a deliberate source edit
and a manifest version bump.

### Frozen inputs

| Input | Rule |
|---|---|
| Fixture index | canonical `eval/manifest.yaml`; cross-checked against each fixture's frontmatter; exactly 7 entries, 5 `hit`, 2 `clean` |
| Fixture parse | deterministic, no model extract call (replaces the `Explore` agent in `eval/fixture-eval.workflow.js`) |
| Reviewer system prompt | raw bytes of `cressetide/agents/code-reviewer.agent.md` after the closing frontmatter delimiter's newline, preserving the following blank line and CRLF/LF; frontmatter hashed separately |
| Shared contract | `references/review-packet.md`, label line through last bullet, before the closing fence, verbatim, inline in the **user turn** |
| Judge | its own frozen neutral system prompt, no ctide prompt, `--json-schema` |
| Hashes | agent body, frontmatter, shared block, judge prompt, judge schema, all 7 fixtures, `eval/manifest.yaml`, the three driver modules, and the CLI executable — rechecked before every dispatch and before summarize |

### Boundaries

| Role | cwd | Available surface (`--tools`) | Permission layer (`--allowed-tools`) |
|---|---|---|---|
| Reviewer | fresh `ctide-eff-work-*` under `os.tmpdir()` holding only `snippet.<js\|py\|go>` | `Read,Grep,Glob` | same three |
| Judge | fresh empty `ctide-eff-work-*` | empty | `StructuredOutput` carrier only |

The three flags do different jobs and the distinction matters: **`--tools` sets the available
builtin surface** (empty disables all), `--allowed-tools` is only the permission allow-list, and
`--restricted` removes executable tools/WebFetch and confines file roots but is **not** an
exclusive Read/Grep/Glob surface. The closed surface comes from `--tools`; `init` and observed
tool use are checked against it after each call.

The requested permission mode is the CLI alias `--permission-mode manual`; the canonical value
the runtime reports back in `init` is `default`
(<https://code.claude.com/docs/en/permission-modes>). These are the same mode under two names,
and both are pinned: the argv keeps the alias, and the observed-mode check requires `default`,
faulting a missing or differing value. This is not a permission-mode configuration surface.

Exactly one environment variable is forced onto every child: `CHILD_ENV_OVERRIDES =
{ CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1' }`, overlaid on a **copy** of the inherited
environment. The parent environment is never mutated, and **no inherited environment is ever
recorded** — only the override map itself, checked for exact equality against the frozen
constant in the manifest and bound by digest into every start record. Exact equality is the
whole boundary; there is no env configuration surface, so no other key can exist.

Both roles: `--model claude-opus-5`, `--effort xhigh`, `--disable-slash-commands`, `--no-chrome`,
`--strict-mcp-config` with an empty MCP config, no permission prompts, a single-use session
UUID. The source workspace is never added to any reviewer root; `--add-dir`, `--plugin-dir`,
`--agent`, `--settings`, `--append-system-prompt`, `--continue`, `--resume` and `--fork-session`
are asserted absent from every assembled argv. A fresh work directory per attempt means nothing
from the previous fixture is visible. The extension comes from a frozen `lang → ext` map, never
from the fixture id. The snippet on disk and the fenced block in the prompt hold identical bytes.

Missing required `init` fields — `model`, `tools`, `mcp_servers`, `slash_commands`, `plugins` —
each fault. Absence never silently satisfies an expectation, and a present-but-malformed list
(an element this parser cannot read) is recorded as **unrecognized**, never reduced to an
apparently deliberate empty surface. Fresh-session binding is likewise explicit: the single
`init` and the single terminal must each carry their own non-empty `session_id` and must agree —
a terminal is never attributed from init's id, or the reverse. Auxiliary events may omit it.

### Integrity model, and what it is not

Recorded claims are never consumed. Every cost, grade, stream record and `ok` flag used by the
driver is **re-derived from the raw transcript** through the same functions that produced it —
there is no second checker implementation to drift — and the recorded values are compared
against that derivation (`record-derivation-mismatch:<step>:<field>`).

Past inputs are bound to sources, not to mutable claims. Every step's user prompt is
**regenerated** from inputs already known — the frozen fixture plus the shared contract for a
reviewer step, and the same fixture plus the prior step's raw reviewer response for a judge
step — and compared against both the stored bytes and the hash the start record claims, so an
edit to a prompt *and* its own recorded digest still fails. System prompts are checked against
the agent body / judge prompt recomputed from source as well as the frozen manifest digest, and
each start record's CLI hash is checked against the frozen executable. History also verifies raw
stdout/stderr digests, start↔final plan and session binding, session uniqueness across all 14
steps, the rebuilt argv, and the budget-seal binding on post-pair steps.

The sealed manifest's structure and canonical claims are validated **before any path or command
it carries is consumed**: version, method, model, effort, CLI version, per-call cap, timeout and
post-kill grace, the experiment root, the CLI block's shape and observed version, fixture ids
(traversal-rejected), the ground truth it carries — and the fixture index compared element by
element and **in order** against the canonical `eval/manifest.yaml`, so a reordered-and-resealed
index is refused rather than accepted as internally consistent.

**Scope:** the two seals (manifest and budget) detect accidental edits and corruption. They are
**not signatures and not authentication**. Someone able to rewrite the records, the raw
transcripts, the seals and this source can produce any result. Process facts (exit code,
signal, timeout, exit confirmation) cannot be derived from a transcript; they are read back
from the record, so an edit that changes a process fact and its consequences consistently is
not detectable here. Likewise the argv rebuild uses the *recorded* session id, so it cannot by
itself detect a forged one — that weight sits on the raw-session, start-binding and uniqueness
checks.

### Executable identity

At prepare, and again before every dispatch and before summarize, the driver hashes the pinned
executable at its canonical real path and runs one bounded, offline, injectable `--version`
probe of that same path (`shell: false`, `windowsHide: true`, small timeout, no model, no
network). A missing, unparseable or mismatched version refuses. **`--version` is a self-report**:
together with the file hash it detects an upgrade, a rebuild or a wrong binary. Neither is
authenticity evidence.

### Budget and stop policy

| Control | Value |
|---|---|
| Per call | `--max-budget-usd 2`, explicit 300 s deadline, finite post-kill grace |
| Batch | 14 role invocations (7 reviewer + 7 judge) |
| Aggregate | **not preset.** After exactly the first reviewer/judge pair, the operator records a bound once via `set-budget`: finite, **strictly greater** than the *re-derived* first-pair spend, ≤ 28, sealed |
| Absolute ceiling | 28 USD estimated |

The stored budget is bound to the re-derived first pair (`spentAtSet`, `firstPairCosts`) and
sealed, so a later edit to another otherwise-valid amount is detected rather than silently
accepted. Every post-pair start record binds the budget seal.

`--max-budget-usd` may not be effective on this provider or account. **Overshoot is recorded as
observed, not prevented**: a per-call cost above 2 USD faults that record, and the call that
crosses the aggregate cap faults **on itself** — the prior spend is the prefix sum over completed
steps, computed identically when the record is written and when it is re-read, so the fourteenth
call cannot pass while only a later summary refuses. There is no preventive spend guarantee.

Node's `timeout` option only sends a signal; it does not bound the wait for `close`. The driver
owns an explicit deadline plus a finite post-kill grace and resolves either way. When the grace
expires it records `exitConfirmed: false` and `descendantsKilled: "unverified"` and makes **no
claim that the process or any descendant actually died**.

Other stop conditions: any source, prompt, CLI, seal or raw-digest drift; a start marker with no
completed record (terminal-blocking); any prior non-`ok` record; a strict zero-child fault, an
unrecognized `subagent_stats` shape, or an unexpected model key; an unexpected tool in `init` or
in observed use; a missing or incoherent structured grade; an unknown cost; a per-call overshoot;
budget not set after the first pair, invalid, or exhausted. There is no implicit retry and no
overwrite: markers are exclusive (`wx`) and immutable, including for failures.

A miss or a false positive is a **normal negative grade, not a process failure**. All grades are
retained, and `summarize` emits only when all 7 pairs are complete with known, within-budget
costs — regardless of whether the grades are positive.

### Aborted first pilot (retained, separately accounted)

The first real reviewer call ran and then **failed the strict model gate**: alongside the
expected Opus 5 main-loop usage and all-zero subagent counters, the transcript carried
`claude-haiku-4-5-20251001` at 3,059 input / 13 output tokens. The gate refused the record
(`strict-multiple-models`, `strict-unexpected-model:…`) and the batch halted at step 0 — no
judge ran and no budget was set.

- **Cost of the aborted call: $0.1671225** (CLI list-price estimate), of which $0.003124 was the
  Haiku usage. It is retained unchanged, accounted separately, and counts against the overall
  **$28 ceiling**. There was no silent retry and no replacement.
- **The origin of the extra Haiku usage is hypothesised, not proven.** Headless auto-title
  generation is a *supported* hypothesis — the upstream changelog ties a fix to
  `CLAUDE_CODE_DISABLE_TERMINAL_TITLE` / `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, and the
  official env-var reference documents the former — but nothing in the captured stream
  identifies the caller. If the override removes the extra usage, the honest record is "extra
  non-Opus usage did not recur with the documented switch set", never "auto-title was the cause".
- The strict gate is **unchanged**: Haiku is not ignored and not excluded. If extra non-Opus
  usage recurs, the correct response is to halt and investigate, not to iterate paid trials.
- Adding the override changes the frozen source set, so the aborted root cannot be resumed: a
  **new `prepare` and a new root** are required. A single reviewer call also calibrates the
  earlier cent-scale guess — 14 calls at this rate is roughly $2.3, not cents.
- No efficacy, quality or drift conclusion follows from this pilot. It produced no grade.

### Judge negative-response probe (prerequisite, not yet run)

`eval/efficiency/judge-calibration.mjs` runs **four fixed judge-only calls** against the frozen,
read-only, Codex-authored `eval/efficiency/judge-calibration-cases.json` (digest
`f973d46f…4a1cad`). It answers one narrow question: given a fixture's ground truth, does the live
judge assign the grade the case expects — including the two **negative** grades (`miss`,
`false-positive`) it has never produced in a real run?

- **Two positive controls are actual captured reviewer outputs** from the L1b run; **two negatives
  are handcrafted constructions** derived from an `[unverified]` `renderRow` arity lead the real
  reviewer correctly hedged. The negatives are marked as constructions and are **not model output**;
  the case `origin` field records this faithfully.
- The judge prompt, system prompt, schema and argv are the accepted L1b protocol unchanged, and
  the process, version-probe and telemetry helpers are imported rather than copied. `expectedGrade`
  is grader-only and never enters a prompt; the four grade words are the rubric's own vocabulary
  and appear in every prompt by design.
- Caps: **0.25 USD per call, 1 USD total**, enforced at write and again on re-derivation. Four
  calls at the per-call cap total at most 1.00, so the per-call rule is the binding one.
- A `miss` or `false-positive` with `pass: false` is the **calibration target** for two cases, not
  a transport failure. A grade that disagrees with the case's expectation is **retained verbatim**,
  blocks acceptance, and is discussed — never edited away. An incoherent grade (a shape illegal for
  that fixture) is a record fault and halts the batch, as are unknown cost, overshoot, source, CLI,
  seal, prompt or raw drift.
- Acceptance requires four valid records **and** all four grade pairs matching.

**Claim boundary:** this is **negative-response evidence on four constructed cases**. It measures
grade assignment given ground truth, not blind detection. Passing excludes a constant-pass and a
constant-fail grader on these inputs and nothing more — it is not statistical calibration, not
general judge accuracy, and it does not by itself unlock drift detection in `eval/baseline.md`.

## 4. Disclosures that must travel with any recorded number

1. Constrained-excerpt code-reviewer baseline. Not a workflow, quality or safety baseline, and
   not a real-world recall benchmark.
2. System-prompt replay; `--system-prompt` replaces the entire default prompt; native plugin
   activation unverified; comparable only to the same method.
3. The reviewer's available surface was closed to `Read`/`Grep`/`Glob` with **no Bash**, unlike
   the shipped agent contract (`tools: Read, Grep, Glob, Bash`), and it ran in a neutral cwd
   rather than a repository. This deviates from `eval/README.md`'s documented procedure and from
   `eval/fixture-eval.workflow.js`, which use the plugin agent with its full declared tool set.
4. The fixtures' `Intent` lines state the contract precisely (fixture 01 ends "Exactly one
   response per call") and **may** make the defect easier to find than unhinted review. The
   direction is plausibly optimistic; the magnitude is unmeasured. This is a potential bias, not
   an observed causal effect.
5. One judge call per fixture over 5 `hit` fixtures and 2 `clean` controls: each fixture moves a
   rate by 1/5 or 1/2. The result is coarse by construction.
6. Cost figures are CLI list-price estimates, not provider billing, and are comparable only
   within the pinned CLI version.
7. Repeating one prefix across 14 sequential calls **may** produce cache reads attributable to
   the harness rather than the product. No causal attribution is measured, and these numbers are
   not evidence for or against cross-role prefix reuse in a real run.
8. "Clean precision" in `eval/baseline.md` means the fraction of clean controls that did not draw
   a confident blocker/major. It is not a true precision. This tooling reports it as
   `cleanControlAcceptance`.
9. The seven fixtures are prompt-drift evidence for the `code-reviewer` only. They are not a
   sufficient gate for `arbiter`, `test-reviewer` or orchestration changes, which additionally
   need changed-role contract checks, relevant TP E2E when touched, and independent task-outcome
   checks.
10. Context profile: this confined excerpt world is the required blinding and measures neither
    the consumer profile nor the maintainer profile. Which profile L1a uses is a separate,
    recorded planning choice.
11. CLI version is a `--version` self-report plus a file hash: drift evidence, not authenticity.
    Seals detect accidental edits and corruption only.

## 5. What L0 does *not* yet cover

The control table above covers its three named sources, and its capability table describes the
original single-process, zero-child profile. Subsequent evidence is recorded separately in the
[efficiency roadmap](superpowers/specs/2026-09-08-cressetide-efficiency-roadmap.md): one known-child
aggregate observation, with an explicit post-hoc initialization-label disposition, and a native
trivial control. These do not replace each positive workflow's own accounting validation.

**L0 is not globally complete.** The three consumer size strata are now defined, S2/S3 public
fixtures and actual visible red baselines are frozen, and the hidden task checks have a frozen
digest. Realized hidden inputs remain in root coordination memory; hidden execution is pending.
A pre-observation control table separates required, conditional, MAY and opt-in controls, but an
adherence denominator must still be established from actual eligibility. S2/S3 deliberately
request native default Vigil on synthetic non-TP tasks; they do not measure passive auto-routing
or real-run-only ledger/consolidation work. Their private two-phase harness passed independent
offline verification (37 tests,36 passes, one Windows symlink-privilege skip, zero failures).
Actual full-flow accounting, control observations and hidden behavior grades remain open. After
a prelaunch Windows identity correction, the first S2 plan ran and failed the strict profile on
blocked shell requests and unavailable native plan-file Write; its original outcome and cost are
retained. A separate fresh two-call diagnostic confirmed actual Write restoration on resume.
The [current roadmap](superpowers/specs/2026-09-08-cressetide-efficiency-roadmap.md) records the
prospective exploratory v2 discussion and implementation. No v2 model task has run yet, and no
product overhead, saving, efficacy, or directional cost bound follows from these observations.

Latest checkpoint (2026-09-09): the above pending-call statements are historical. Both prescribed v2 plan phases have now ended. S2 retains its mechanical failure; S3 passed with limitations but its proposed reviewer fold failed independent semantic review. Neither was approved or implemented. The [disposition](superpowers/reviews/2026-09-09-efficiency-exploratory-disposition.md) records the unchanged original results, missing plan-revision path and incomplete roadmap gates. Private v2 tooling passed51 tests/50 passes/one Windows skip/zero failures. Hidden checks were executed only as negative controls on untouched faulty fixtures after all blind calls closed; corrected behavior and L3 confirmation remain unexecuted. Cumulative experiments US$4.4346125 exclude all implementation/discussion sessions and are estimates, not billing.

Scoped checkpoint (2026-09-09, reviewer-prompt trial): this same L1b apparatus was reused unchanged
for a two-arm reviewer-output comparison, which was **terminated by its own frozen quality stop**
after ten role calls — three reviewer pairs, two pairs judged (all four judges hit/pass), case three
retained but unjudged, confirmation zero calls. Two candidate-arm faults triggered the stop: a
GET-to-HEAD remedy contradicting the fixture's explicit GET predicate, and an "it does compile"
assertion with no observed build summary. The candidate is archived **partially tested / not
adopted**; attribution to its appended guidance is **unestablished in either direction**. No
distributed byte changed, all 123 protected sources are unchanged, and the US$1.145441 CLI estimate
is separate from every prior figure and is **not** a comparison result — no saving and no efficacy
conclusion follows, and **no prompt-caused comparative regression is established**, while the two
observed quality faults stand as the recorded reason for the stop. The earlier 5/5 hit and 2/2 clean-control grades remain seed-rubric
evidence only: they measured detection and false-positive avoidance, never output completeness or
advice safety. See the [trial disposition](superpowers/reviews/2026-09-09-reviewer-output-trial-disposition.md)
and its [receipt](superpowers/reviews/2026-09-09-reviewer-output-trial-evidence.json).

Final checkpoint (2026-09-10): the efficiency investigation is **closed**. The decision is to
**retain the current default and adopt neither investigated candidate**; that decision is final,
while the roadmap itself is **not** complete or validated. All counts and estimates recorded above
stand unchanged. Two separately frozen native synthetic observations on Windows both ended BLOCKED
with no delivered implementation, approved plan, formal panel or worker hidden grade: phase32
(consistent, plan only, 146,244 ms, **US$0.719042** observed CLI estimate, zero Agent calls, closed
by a global failure-memory `Glob` outside the declared read roots that the CLI refused) and phase33
(**consistent false** on a `final-cost-invalid` transition fault, incomplete plan with one
`ctide:navigator` in progress, 300,477 ms timeout, **cost unknown** — the reducer's `spentUsd: 0` is
not spend and the run was not free — 41 child frames, async launch metadata without any completion
notification, and a child compound `Bash` refused by the guard; no causal link between that refusal
and the timeout is claimed). Both starting fixtures were 4 public tests, 2 pass / 2 fail. Offline
acceptance was 87/86/1 skip/0 fail and 90/89/1/0 with 26/26 root counterexamples each; all 123
protected sources remain unchanged. **Costs are never pooled and no total is computable**:
US$1.145441 and US$0.719042 are available CLI price-table estimates rather than billing, phase33 has
no figure at all, and the cumulative US$4.4346125 is separate. These are separately recorded figures,
**not a complete project-spend accounting** — phase28's US$0.518038 and every implementation and
discussion session are excluded. Stage labels: L0 partial, L1a closed via its explicit
measurement-limit branch, L1b bounded accepted, L2 terminal and explicitly inconclusive with no
accepted candidate (one retired at design, one **selected, built and partially tested** before its
quality stop), **L3 unexecuted** because no candidate qualified for held-out confirmation, L4 final in
its scoped form and unexecuted in the broad whole-workflow sense. Eligible closed-task records are not
restricted to any one ledger directory; no eligible dataset has been established and no additional
path has been supplied, so that data question stays pending — which is not a finding that no such
records exist.
No saving, efficacy, native full-flow cost, real-world, cross-platform or GPT-6 Astra claim follows.
See the [final disposition](superpowers/reviews/2026-09-10-efficiency-final-disposition.md) and its
[evidence](superpowers/reviews/2026-09-10-efficiency-final-native-evidence.json).

L1b is a bounded subset of L0, not its completion.

## 6. Usage

```bash
node eval/efficiency/l1b-driver.mjs prepare --cli-command <path> [--repo <path>]
node eval/efficiency/l1b-driver.mjs run-one-next --root <root>   # x2, then inspect
node eval/efficiency/l1b-driver.mjs set-budget   --root <root> --amount <usd>
node eval/efficiency/l1b-driver.mjs run-one-next --root <root>   # x12
node eval/efficiency/l1b-driver.mjs summarize    --root <root>
```

There are no other options: model, effort, CLI version, timeouts, tool surfaces and the argv are
frozen constants, and each command accepts only the flags listed above. An unknown, duplicate or
inapplicable flag is **refused**, not ignored — `--model other` fails rather than silently running
the pinned model while the operator believes an override applied.

`prepare` probes and pins the executable version, then creates the experiment
root itself as a direct child of `os.tmpdir()` named `ctide-eff-*` and prints the path. A root
that is not a direct temp-directory child, that lacks the prefix, or that nests with the source
workspace in either direction is refused (canonical paths are compared, so a symlink cannot
smuggle it in). Ground truth lives only in the experiment root, which the reviewer cannot reach.

Importing the driver module performs no filesystem access and starts no process; the entry-point
test is a string comparison. A non-matching invocation path simply does not run `main`.

Nothing in this tooling writes to the repository, to a product ledger, or to `eval/baseline.md`.
Updating the baseline is a separate, bounded step taken by a person after independent inspection
of these records.
