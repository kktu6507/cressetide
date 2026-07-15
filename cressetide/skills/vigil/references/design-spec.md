# Design Spec (`design.md` — the project's persisted design contract)

Loaded only when a task has **UI / design-system / user-facing-interaction** scope. A `design.md` is a plain-text, version-controlled document that captures *this project's* design language so agents apply it consistently instead of re-inferring it every run. It is the UI counterpart to the contract-level intent that `references/plan-grounding.md` produces for behavior: an externalized, durable statement of design intent — the kind of intent a code read alone cannot recover.

The format follows the community `design.md` convention (Google `design.md` / VoltAgent `awesome-design-md`): a human-readable markdown document, optionally fronted by machine-readable tokens. ctide consumes it as text — there is nothing to parse or configure.

## Why it exists (the recall lever for UI)

Without a contract, `ui-ux-reviewer` judges consistency against "nearby patterns / the design language" it has to **re-infer every run** — expensive, and inconsistent between runs. A `design.md` turns that into an objective check: a finding cites the **violated token or section**, not a taste judgment. It is also a **net token saver** — it replaces per-run re-derivation of the design language with one persistent read (the same "filter/derive once, reuse" discipline as the filtered diff in `references/review-packet.md`), so its cost amortizes across every future UI task.

## Format (10 sections)

The nine community sections plus one ctide extension:

1. Visual Theme & Atmosphere
2. Color Palette & Roles — semantic names, values (hex / `rgb()` / `oklch()`), functional roles
3. Typography — families, hierarchy, sizes/weights/line-height
4. Component Stylings — buttons, cards, inputs, with states
5. Layout Principles — spacing scale, grid philosophy
6. Depth & Elevation — shadow system, surface hierarchy
7. Do's and Don'ts — guardrails and anti-patterns (these map directly to reviewer checks)
8. Responsive Behavior — breakpoints, touch targets
9. Agent Prompt Guide — quick references / how an agent should apply this file
10. **Interaction / Operation Patterns** *(ctide extension — the community format is visual-only)* — navigation model, destructive-action confirmation conventions, keyboard/focus behavior, empty/error/loading/success state conventions, and the state machines for key flows. This is the half a visual-only `design.md` omits and the half that governs "operation-mode" changes.

Machine-readable tokens (a YAML front-matter block of colors / typography / spacing / rounded / components) are **optional**: they give agents exact values while the prose says *why*. Use them when the project already has a token source to mirror; otherwise prose alone is a valid `design.md`.

## Where it lives (committed contract, not scratch)

`design.md` is a **committed** repository artifact at `.ctide/design/design.md` — it travels with the repo like source, unlike the gitignored run scratch under `.ctide/output/`. It is owned by the consuming project; ctide drafts and updates it but the project commits it. A repo-root `design.md` is the **compatibility location**: still detected (and guarded by `hooks/contract-guard.js`, which matches `design.md` by basename anywhere), but one-time-migrated on first consume (below).

**One-time migration (workflow main thread, at the detect/consume step — hooks never move files).** It runs **only** when detection finds a legacy root `design.md` and no `.ctide/design/design.md`; move it before consuming: create the destination directory (`.ctide/design/`) if it does not already exist, then determine whether it is git-tracked before choosing how to move it — run `git ls-files --error-unmatch design.md` (exit 0 = tracked, non-zero = untracked); do not assume the answer from context — git-tracked is the normal case for this committed artifact, but check rather than assume. A **tracked** file — `git mv design.md .ctide/design/design.md` (`git mv` does not create the destination directory itself, which is why it is created first; the rename preserves history and the project commits it with the PR); manual copy+delete is never an acceptable substitute for a tracked file — it silently discards the file's commit history, which is exactly what `git mv` exists to prevent. An **untracked** file — copy it, verify the copy is readable, then delete the legacy file. Disclose one line to the user (e.g. "migrated design.md to .ctide/design/"). When **both** locations exist, use `.ctide/design/design.md`, move or overwrite nothing, and disclose once that a legacy root `design.md` remains for manual cleanup/merge. After migration, never read or write the root location again — all `design.md` reads and writes use `.ctide/design/design.md` only.

## Detect → Use → Else-Disclose

Follow `references/external-capabilities.md`.

1. **Detect** — does a `design.md` exist (`.ctide/design/design.md`, else the legacy root location — a legacy hit is one-time-migrated at consume, per *Where it lives*), and is the task UI / design-system / interaction scope? (`navigator` does this during planning, `references/plan-grounding.md` Stage A.)
2. **Use** — when a `design.md` exists, it is the **consistency contract**: the planner grounds the UI plan against it, the implementer follows it, and `ui-ux-reviewer` judges the change against it (citing the violated token/section). Hand reviewers the **path** (a Review Packet pointer, `references/review-packet.md`), never the re-pasted content.
3. **Else** — when it is absent: do the UI work against the internal `ui-ux-reviewer` baseline and **disclose** that no `design.md` contract was used. If the scope warrants one, **recommend** establishing one (below) — never a hard dependency, never an error.

## Three-layer arbitration (resolving multiple design sources)

`design.md`, `ui-ux-pro-max`, and the `ui-ux-reviewer` baseline are **not competing answers** — they sit at different altitudes and answer different questions. Precedence:

| Layer | Source | Question | Authority |
|---|---|---|---|
| 🔒 Safety floor | `ui-ux-reviewer` baseline (WCAG AA contrast, ≥44px targets, required states) | "Is it below the non-negotiable bar?" | Hard minimum — nobody waives it, not even `design.md` |
| 📐 Consistency contract | **`design.md`** (project-specific) | "Does it match *our* design system?" | Authoritative for reuse / consistency |
| 🎨 Generation intelligence | `ui-ux-pro-max` (universal) | "What's good design for *net-new* work?" | Source for new design — its output flows **up** into `design.md` |

Resolution: when a relevant pattern already exists in `design.md`, **`design.md` governs** (reuse it; a generic `ui-ux-pro-max` palette does not override the project's specific one). For **net-new** design with no existing pattern, consult `ui-ux-pro-max` to design it well, then **record the decision back into `design.md`** so the one-off becomes contract — over time the project's contract absorbs good practice and `ui-ux-pro-max` is consulted less. The **safety floor always wins on the safety axis**: if a descriptively-extracted `design.md` encodes a sub-floor value (e.g. a contrast that fails AA), the reviewer flags it *and* the `design.md` is corrected. The three never collide because they are not on the same axis (safety vs consistency vs creation). This refines, not replaces, the existing `ui-ux-pro-max` boundary in `references/external-capabilities.md` (required for design-system scope; soft consult for a small tweak).

## Lifecycle (read/write split — same rule as asset generation)

`design.md` is a file **write**, so it follows the same plan-gate discipline as `ui-ux-pro-max` asset generation (`references/external-capabilities.md`): decide read-only in planning, write post-approval.

1. **Detect** *(plan, read-only)* — presence + scope (above).
2. **Draft** *(plan, read-only)* — when bootstrapping, derive the contract **descriptively from the existing UI** (role split: *Invariants* below) — read the real token sources and map them to the 10 sections per the *Extraction guide* below. The goal is to **preserve the existing design** (reuse the visual system), not to impose an external standard. A drafted `design.md` is **descriptive** — it can codify existing design debt, which is exactly why it must be blessed.
3. **Bless** *(ExitPlanMode)* — present the draft for the user's approval at the plan gate. A persistent design contract must be a deliberate, human-signed decision, never a silent side-effect of an unrelated task.
4. **Write** *(post-approval implementation)* — write `design.md` to `.ctide/design/design.md`; the `implementer` does it post-approval so plan mode stays read-only.
5. **Update** *(supersede / expire)* — when a change alters the design system, update `design.md` in the **same PR** as the code, with the same supersede/expire discipline failure memory uses (`references/verification-gate.md`) so a stale contract does not outlive the design it described. A stale `design.md` is worse than none (the reviewer judges against the wrong contract). `hooks/contract-guard.js` asks for confirmation only when a Write/Edit/MultiEdit would remove an entire `## ` section wholesale — it never flags a normal section-body rewrite, expansion, or reduction to an "n/a" placeholder, so it is compatible with this sanctioned implementer-rewrite workflow, not in conflict with it.

## Bootstrap (establishing a contract for an existing UI)

When the repo has an existing UI but no `design.md`, `navigator` **detects the gap and recommends** establishing one (role split: *Invariants* below). Prefer a **separate, explicit bootstrap pass** over auto-bundling into an unrelated task, so the "establish the contract" decision (which needs deliberate sign-off) is kept distinct from the "follow the contract" work. The user chooses: do it within the current task, or as its own pass. Either way, detection is read-only in planning, the draft is blessed at `ExitPlanMode`, and the write is post-approval.

## Extraction guide (drafting descriptively from an existing UI)

The draft is produced **as a step, not by a new agent** (role split: *Invariants* below). When `ui-ux-pro-max` is absent the extraction still works — the token sources below are read directly (mechanical) and the prose falls back to the `ui-ux-reviewer` baseline — disclose that pro-max was not used. Never a hard dependency.

**Read the real sources first (most reliable), map them to sections:**

| Source in the repo | Feeds sections |
|---|---|
| Tailwind config (`tailwind.config.*` theme) | Color (2), Typography (3), Layout/spacing (5), Depth (6), Responsive breakpoints (8) |
| CSS custom properties (`:root` / theme files) / design-token files | Color (2), Typography (3), Layout (5), Rounded/Depth (6) — and the optional YAML token block |
| Component library / design-system components (shadcn, MUI theme, Chakra, …) | Component Stylings + states (4), Do's & Don'ts (7) |
| Router config + page/screen components | **Interaction / Operation (10)** — navigation model, routes, guards |
| Component state handling (loading/empty/error/success/disabled), form validation, confirm/destructive dialogs, focus/keyboard handlers | **Interaction / Operation (10)** — state conventions, destructive-action confirmation, keyboard/focus |
| Rendered screens (browser evidence — vision-gated, `references/browser-evidence.md`) | Theme & Atmosphere (1), Responsive (8) — only when the prose can't be derived from source |

**Discipline:**
- **Tokens before prose.** Derive exact values from the real token sources; infer the *why* from how they are used. Do not invent values the code does not have.
- **Descriptive, not prescriptive.** Capture what the UI *is*, to preserve it — including inconsistencies. **Flag, don't silently "fix":** where the existing design violates the safety floor (sub-AA contrast, <44px targets), record it in *Do's and Don'ts* as a known gap to correct, rather than encoding it as the standard. The user blesses the result at `ExitPlanMode`.
- **Vision stays gated.** Screenshot only when a section genuinely cannot be derived from source, and only on the `--deep` / `--report full` path — the token economy is the existing one, not a new budget.
- **Interaction/Operation is the ctide half.** Spend the effort the community (visual-only) format skips: capture the navigation model, the empty/error/loading/success conventions, destructive-action confirmation, and keyboard/focus behavior from the real components — this is what governs "operation-mode" changes.

## Skeleton

A drafted `design.md` follows this shape (mark a section "n/a" only when the project genuinely has nothing for it):

```markdown
---
# optional machine-readable tokens — include only when a token source exists to mirror
color: { primary: "#…", surface: "#…", … }
spacing: { … }
---
# <Project> Design

## Visual Theme & Atmosphere
## Color Palette & Roles
## Typography
## Component Stylings
## Layout Principles
## Depth & Elevation
## Do's and Don'ts
## Responsive Behavior
## Agent Prompt Guide
## Interaction / Operation Patterns
```

## Source positioning (what is and isn't a dependency)

- **`awesome-design-md`** (VoltAgent) is a **design-time reference only** — it shaped the 10-section structure above and proved the "reverse-engineer from an existing UI" approach. It is **not** a runtime dependency, and its example files are **not** copied into a user's repo (they are other companies' designs; each project's `design.md` is extracted from *its own* UI). "Borrow the structure, not the content."
- **Google `design.md`** contributes the format concept (tokens + prose). Its `lint` / `diff` / `export` CLI is an **optional, user-wired check** (a project may add it as its own validation step) — never a ctide default or dependency.

## Invariants

- **Never a hard dependency.** No `design.md` → disclose and continue against the baseline; never error. Detection and drafting are read-only; the write is post-approval.
- **Human-blessed.** A drafted contract is approved at `ExitPlanMode` before it is written — a descriptive extraction is not authoritative until the user signs it.
- **`navigator` reads; the orchestrator drafts; the `implementer` writes.** The planner detects and recommends; the orchestrator drafts the contract during planning (read-only, borrowing `ui-ux-pro-max` when available); the `implementer` writes it post-approval. It is a **step, not a new agent** — no standing agent owns `design.md`.
- **Reviewers consume by pointer.** Hand `ui-ux-reviewer` the `design.md` path, not its re-pasted content (`references/review-packet.md`).
- **Safety floor is inviolable.** `design.md` is authoritative on consistency/style, never on the accessibility/usability minimums.
- **Language.** Per `SKILL.md` *Language And Text Integrity* — `design.md` follows the repository's language; technical contracts verbatim.
