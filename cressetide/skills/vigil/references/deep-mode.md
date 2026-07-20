# Deep Mode (ultracode / Workflow leverage)

Deep mode makes the review/repair core **deterministic** instead of model-followed prose: the selected reviewer panel, the arbiter barrier, and the repair loop are expressed as a Workflow so they actually run. It follows ctide's Detect → Use → Else-Disclose protocol and never becomes a hard dependency. A skill cannot enable ultracode (it is a harness mode); deep mode only detects the signal and adapts.

Deep mode raises **depth, not breadth.** The reviewer *selection* is unchanged — still the smallest sufficient set from `reviewer-selection.md`. It never adds reviewers. Conversely, the *evidence-substitution fast lane* never applies to deep-mode work — either tier, including Tier-1 auto-engaged work (exclusion owned by `reviewer-selection.md`, *Evidence substitution*): deep signals exactly the risk class where substituting a reviewer is not allowed.

The downward cost knob is separate: `--lite` (`reviewer-selection.md`, *Lite path* — smallest panel, skips the costlier deep-mode **Tier 2**, safety floor kept and disclosed) lowers **breadth**, the counterpart to `--deep` raising depth: deep manages the depth ceiling, lite the breadth floor. Both are opt-in and orchestrator-followed.

## Two tiers (enforcement is cheap; extra effort is not)

Deep mode is split into two tiers so its *enforcement* benefit can be had cheaply without paying its *cost*:

- **Tier 1 — deterministic enforcement.** Express the **already-selected** panel as a Workflow `parallel` barrier and the arbiter as a `pipeline` barrier, so the panel actually runs and arbiter only runs after it. **Same reviewers, same model, same reasoning effort** as the standard flow — the only change is that the orchestration is *enforced by the graph* rather than left to model self-discipline. Because it adds no effort, its token cost is ≈ the standard flow. **This is the tier that may auto-engage** (see Detect).
- **Tier 2 — deeper verification (raises cost).** On top of Tier 1, add **adversarial verification** of blocker/major findings, **loop-until-dry** repair, and **maximum reasoning effort** for `arbiter` / `security-reviewer`. This materially raises tokens/wall-clock, so it stays **explicit opt-in** (per the Auto-fix loop's cost-control rule in `SKILL.md`) — never auto-engaged.

## Detect

Signals (none a hard dependency):

1. A session-level ultracode signal (e.g. a SessionStart `additionalContext` / system-reminder indicating ultracode is on).
2. An explicit per-task opt-in: `/ctide:vigil` arguments beginning with `--deep`, `deep:`, or `ultra:` (this requests **Tier 2**).
3. The concrete Workflow-tool-presence check (`references/external-capabilities.md`, Detect → Use → Else-Disclose): a tool named `Workflow` is present in the current tool list.

How the signals map to the tiers:

- **Tier 1 auto-engages** when the task is **high-risk or correctness-critical** (per the `reviewer-selection.md` Risk Matrix) **and** the Workflow capability is available (signal 1 or 3). No `--deep` needed. It is **opt-out**: a `--no-deep` / `--shallow` argument — or simply no Workflow capability — falls back to the standard prose flow. Because Tier 1 doesn't raise effort, auto-engaging it does **not** trip the "confirm before an opus-heavy pass" cost rule.
- **Tier 2 requires explicit opt-in** (signal 2, or a user confirmation) **and** the Workflow capability. Intent without capability → fall back and disclose.

For low/medium-risk work neither tier auto-engages — the standard prose flow runs unless `--deep` is given.

## Use

When the Workflow capability is available:

**Tier 1 (enforcement — auto or opted in):**
1. **Panel as a `parallel` barrier** — the selected reviewers each run as a Workflow agent that returns a schema-validated finding set. Reuse the existing output contract in `reviewer-common.md`; do not invent a new schema, and keep any free-form field (the analysis channel) **bounded** so a large answer cannot overflow the call. **On a schema / structured-output failure, fall back to that reviewer's native two-channel output** (`reviewer-common.md`, *Shared output contract*) rather than dropping the reviewer — a non-completing reviewer is a panel gap the `arbiter` must catch (Detect → Use → Else-Disclose), never a silent omission. This is likeliest on a **max-effort** reviewer (Tier 2, item 5), whose long output is the one that overflows a single rigid schema call. Each agent still receives only its own focused Review Packet, preserving reviewer independence.
2. **Gatekeeper as a `pipeline` barrier** — arbiter runs only after the panel barrier completes (encoding the `runtime-policy.md` rule as control flow, not prose).

**Tier 2 (only when explicitly opted in — adds cost):**
3. **Adversarial verification** — for each blocker/major finding, fan out 2–3 independent verifiers and keep only findings supported by a majority. This is the fuller form of the lean, always-on rule that the `arbiter` runs in **every** mode (`agents/arbiter.agent.md`, *Auto-fix loop rules*: validate each blocker with **one** independent check, and tag each applied fix Safe / Extended-Safe / **Residual**); Tier 2 deepens that single check into a multi-verifier majority, it does not replace it. Prefer the **factored** form when a finding can be cleanly rephrased: instead of handing each verifier the *claim* ("is X a real bug?"), turn it into a neutral, context-free sub-question answered **blind to the claim** ("in `<file>`, what happens when `<condition>`?") and compare the independent answer against the claim — a verifier that never sees the claim cannot inherit its framing (Chain-of-Verification). Fall back to direct refutation when a finding can't be cleanly factored. This complements the refutation verifiers; it does not replace them.
4. **Loop-until-dry repair** — implement → verify → review repeats until a round produces no new blocker/major (still subject to the Auto-fix loop's hard iteration cap and Stuck Summary).
5. **Effort** — run `arbiter` and `security-reviewer` at maximum reasoning effort; low-risk leaf reviewers use the default. Their larger output is the most likely to overflow a schema-validated call, so honor the Tier-1 fallback (item 1) — native two-channel prose, never a dropped reviewer.
6. **App launch** — when verification needs a live process (a web app for browser evidence, or a backend/API server for integration checks) that is **not already running**, bring it up per `references/app-launch.md` (delegates to `/run`; discloses; tears down only what it started). An app that cannot be launched is a disclosed gap the arbiter weighs — never an error.
7. **Live browser evidence** — when UI is in scope, drive the real browser (`references/browser-evidence.md`) as a *required* verification step (Detect → Use → Else-Disclose), after the app is reachable (item 6); an unavailable browser capability is a disclosed gap the arbiter weighs. This adds vision-token cost, consistent with Tier 2 being the cost-raising, opt-in tier.

## Else (no Workflow capability, or opted out)

Run exactly the standard prose flow. **The enforcement guarantee is bounded to Workflow-capable sessions:** without the capability ctide cannot make the panel run deterministically — it falls back to model-orchestrated prose (the panel is still *selected* and *run*, just not graph-enforced). If Tier 1 would have auto-engaged (high-risk) but no capability exists, or if `--deep` (Tier 2) was requested and is unavailable, add one line of disclosure: the deterministic Workflow was unavailable, so the standard flow ran and the panel was model-orchestrated rather than graph-enforced. Never error on absence.

When `--deep` was requested, the **app-launch obligation (Tier 2, item 6) and the live browser-evidence obligation (Tier 2, item 7) still apply in this fallback** — they are verification steps keyed on `--deep` + a needed live process / UI scope, not graph-enforcement nodes, so only the graph-enforcement is lost; an app that cannot be launched, or an unavailable browser, remains a disclosed gap the `arbiter` weighs.

## Invariants in both modes

- The plan gate and failure-memory hooks are active in both modes; deep mode changes neither hook and the hooks must never depend on deep mode.
- Plan approval (ExitPlanMode) stays human-in-the-loop; the Workflow does not take it over.
- **Cost stays proportional.** Tier 1 adds enforcement at ≈ standard cost and may auto-engage on high-risk work; Tier 2 raises effort and is **never** auto-engaged — it needs `--deep` or an explicit confirmation, honoring the `SKILL.md` Auto-fix loop cost-control rule.
- The conditional plan-grounding step (`references/plan-grounding.md`) runs the same in both modes; in deep mode its Stage A grounding may run as a read-only Workflow agent node, but it never changes reviewer selection.
- Roles, severity vocabulary (`blocker`/`major`/`minor`), and the verdict set (`READY`/`FIX REQUIRED`/`NOT READY`) are unchanged, so a deep run and a standard run are directly comparable — only enforcement, verification depth, and effort differ.
