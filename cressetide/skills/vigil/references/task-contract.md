# Task Contract (`.ctide/output/contract.md` — the per-run, persisted plan contract)

Externalizes the constructs ctide already produces at the plan gate (sharpened intent, acceptance
criteria, scope, implied edge checklist) into one re-runnable, diff-able artifact — the UI-less
counterpart to `references/design-spec.md`: a durable statement the Review Packet derives from and
the deterministic `scripts/contract-check.mjs` reads. No new ceremony — the content is what the
plan already contains; this just writes it down.

## Where it lives (per-run scratch, gitignored — NOT committed)

`.ctide/output/contract.md`, under the top-level `.ctide/output/.gitignore` (`*` then `!.gitignore`,
`references/verification-gate.md`, Artifact Hygiene). Compatibility home: `.ctide/legacy-output/contract.md`
— `contract-check.mjs` still discovers it and `hooks/contract-guard.js` still guards it until the run's
first scratch write migrates the whole legacy tree (Artifact Hygiene, one-time migration); new writes
always target the new path. Unlike `design.md` (a committed cross-task contract), this is one run's
scratch — never committed into the consuming repo.

## Machine block (JSON — dependency-free, parsed by contract-check.mjs)

The FIRST ` ```json ` fenced block is the machine-readable contract. JSON (not YAML) so it parses
with zero dependencies. All fields optional except as noted; an absent block ⇒ the checker makes no
deterministic claim (fail-open).

```json
{
  "ctideContract": 1,
  "risk": "high",
  "acceptanceCriteria": [
    { "id": "AC-1", "text": "expired access token is refreshed once before retry", "behaviorChanging": true, "verification": "test/auth/refresh.test.mjs::refreshes once" }
  ],
  "allowedPaths": ["src/auth/**", "test/auth/**"],
  "forbiddenPaths": ["src/billing/**"],
  "mustNotChange": ["public signature of AuthService.request"],
  "assumptions": [
    { "text": "expired = within 30s of expiry", "alternative": "expired = past expiry only", "basis": "requirement silent; matches refresh-ahead convention in src/auth/refresh.ts" }
  ]
}
```

- `risk` — `high` | `medium` | `low` (reuse `references/reviewer-selection.md` Risk Matrix).
- `acceptanceCriteria[].behaviorChanging` — `true` ⇒ a `verification` mapping is required (the
  checker flags an empty/missing one; the `arbiter` makes the final per-criterion ruling).
- `acceptanceCriteria[].verification` — a test id, `command: …`, or `observed: …` (UI/copy/config
  with no red-green, per `references/verification-gate.md`).
- `allowedPaths` / `forbiddenPaths` — glob lists (`**` crosses segments, `*` is segment-local).
  Empty `allowedPaths` ⇒ no allow-list claim (forbidden is still checked).
- `assumptions` — optional intent-assumption register entries (`references/plan-grounding.md`
  Stage B): the chosen default (`text`), the rejected alternative interpretation (`alternative`),
  and the `basis` for choosing. `contract-check.mjs` makes **no claim** on this field and
  `contract-guard.js` does not guard it — fail-open; it exists for disclosure at the plan gate and
  for review (the Review Packet's Assumptions field derives from it).

## Body (human-readable, follows the user's language)

Requirement · In scope · Out of scope (incl. deferred) · Implied edge checklist · Risk flags ·
Open decisions · Assumptions (defaulted interpretations). On high-risk work these mirror the
`references/plan-grounding.md` sharpened contract — do not duplicate, route the same content here.

## Risk-proportional fill

- **High risk:** full machine block + full body (allowedPaths/forbiddenPaths/mustNotChange populated).
- **Low / medium risk:** reduced subset — Requirement, acceptanceCriteria, and verification only;
  scope globs optional. Do not force a heavy form onto a small change (the usability-over-strictness
  axiom; a false-heavy contract makes the user wait for no gain).

## Lifecycle (read/write split — same rule as design.md / asset generation)

1. **Detect / draft** *(plan, read-only)* — assembled from the plan + `plan-grounding` outputs.
2. **Bless** *(ExitPlanMode)* — approved as part of the plan; no separate approval step.
3. **Write** *(post-approval implementation)* — the `implementer` writes `.ctide/output/contract.md`
   so plan mode stays read-only (`hooks/plan-gate.js` still applies). `hooks/contract-guard.js` asks for
   confirmation before a later Write/Edit/MultiEdit would remove or loosen a previously recorded acceptance
   criterion, `mustNotChange` entry, scope path, or downgrade `risk`.
4. **Consume** — the Review Packet points at it (`references/review-packet.md`); `contract-check.mjs`
   reads the machine block; the `arbiter` reads the checker's report.

## Invariants

- **Never a hard dependency.** No contract ⇒ checker makes no claim, arbiter uses prose judgment.
- **Gitignored, never committed** into the consuming repo.
- **Language.** Per `SKILL.md` *Language And Text Integrity* — user-facing text follows the user's language; technical contracts verbatim.
