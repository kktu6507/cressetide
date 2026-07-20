# Runtime Policy

This workflow must preserve reviewer independence, context quality, and thread hygiene.

## Subagent Availability

Use formal multi-agent review only when the current runtime and higher-level tool policy allow subagent use. If subagents cannot be spawned or used, say so explicitly and do not present local self-review as formal multi-agent review.

## Context Isolation (Claude Code native)

In Claude Code, each subagent runs in its own isolated context window and returns only its result to the main thread; it does not inherit full thread history by default. This means the "do not dump full history into reviewers" discipline is enforced by the platform, not just by prose.

Therefore:
- Give each reviewer a focused Review Packet, not raw history.
- If a reviewer genuinely needs multi-turn requirement evolution, contradictory prior decisions, or historical evidence that cannot be safely summarized, include that evidence explicitly in its packet and record why it is needed and what stale/sensitive-context risk remains.
- Never route the entire conversation into a reviewer by default.

## Thread Hygiene

- Spawn only selected reviewers.
- Keep reviewer tasks concrete, bounded, and self-contained.
- Do not duplicate work between reviewers or between the main thread and subagents.
- Do not spawn `arbiter` until selected reviewer findings are available.
- Close reviewer agents when their output is no longer needed.
- Avoid repeated waits unless the next critical path step is blocked by reviewer output.
- If a spawned reviewer is stale after a material fix, send a new Review Packet or rerun the reviewer instead of relying on outdated findings.

## Context Ordering (cache-friendly)

The provider's prompt cache discounts a stable prefix heavily — cache reads bill at roughly a tenth of fresh input — so order context to keep prefixes stable across the run. This is a **cost-free** discipline: it changes ordering and timing, never content or signal (like *filter noise, not signal*, it never trades away correctness).

- Keep the stable shared preamble byte-stable. The verbatim "Shared reviewer contract" block is identical across every reviewer handoff *by design*; that byte-stability is what lets a provider reuse it, so do not reword it per-handoff.
- Load delivery-only references late. `references/final-report.md` is loaded at delivery, never up front, so the report template does not pollute the earlier prefix.
- Append, don't reorder. Reordering or rewriting earlier context invalidates the cached prefix for no gain; append new, run-specific context at the end instead.

Honest scope: the Handoff Template's field order (`references/review-packet.md`) stays as-is for readability — this principle governs load order and prefix stability across the run, not a packet-field reorder (a behavior change, out of scope here).

## Shared-State Writes (single writer)

Only one actor writes the shared failure-memory file: the **main thread**, after the verdict, from the `arbiter`'s decision — reviewers, the implementer, and the `arbiter` itself only *propose* entries (full rule + lost-update rationale and the "reread global first" merge step: `references/verification-gate.md`, *Single writer*).

## Deep Mode Enforcement

When a deep mode is detected/opted in (see `references/deep-mode.md`), the rules above — "spawn only selected reviewers", "arbiter only after reviewers", reviewer independence — are enforced by the Workflow graph (a `parallel` barrier for the panel, then a `pipeline` barrier for arbiter) rather than by prose. Reviewer independence is preserved because each Workflow agent still receives only its own focused Review Packet.

## Gatekeeper Sequencing

`arbiter` receives:

- current Review Packet
- selected reviewer list and why each was selected
- reviewer findings
- verification evidence (the structured per-check table with real command exit statuses — authoritative over reviewer prose; see `agents/arbiter.agent.md`, "Command-evidence authority")
- unresolved risks and missing tests
- external-capability disclosures (which MCP/skills/subagents were unavailable and the resulting gaps)
- conflict-resolution notes when reviewers disagree

`arbiter` must judge review sufficiency. If the selected panel omitted a necessary discipline, or a required check was skipped because an external capability was unavailable, the verdict cannot be `READY` until that gap is addressed or explicitly justified.
