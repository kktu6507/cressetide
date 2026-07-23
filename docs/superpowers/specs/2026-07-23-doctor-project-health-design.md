# Doctor Project Health Check — Design Spec

## Problem

`doctor.mjs` diagnoses one thing only: is the `ctide` plugin itself correctly installed (manifest
identity, hook wiring, hook fail-open behavior, Node version, skill/agent roster completeness). It
never looks at the consuming project's own `.ctide/` runtime state. Direct code review confirmed
two real, currently-uncovered gaps — not the mostly-already-covered general case (map staleness is
already handled by `map verify`; ledger/escaped-closure health already surfaces automatically on
every real vigil run via `run-consolidate.mjs`):

- **`FAILURE_MEMORY.md` consolidation health has no on-demand entry point.** `failure-consolidate.mjs`
  already computes retirement/expiry/tag-recurrence candidates, but it only runs incidentally, as
  part of a vigil run's own failure-memory write step — never as something a user can check anytime.
- **Open `.ctide/incidents/` journals have no cross-time visibility.** The only existing mention of
  "open incident journal" is `compact-fidelity.js`'s compaction reminder, scoped to the current
  session immediately after its own compaction — not a standing way to ask "is there an incident
  from three weeks ago that never actually got closed."

## Non-goals

- Not a fix-applying tool — purely diagnostic, reporting facts only, matching `doctor`'s existing
  character (it has never mutated user state).
- Not folded into the default `/ctide:doctor` invocation — a separate `--project` flag; the
  existing, already-shipped, already-tested plugin-health report stays byte-for-byte unchanged when
  the flag is absent.
- Not a new FAILURE_MEMORY health metric — reuses `failure-consolidate.mjs`'s existing
  `consolidationReport()` and `tagRecurrenceCandidates()` directly; no duplicated logic.
- Not a threshold/anomaly judgment on incident age — reports status and age-in-days as facts only;
  the human decides what counts as "too long."
- Not a new skill or command — an additive flag on the existing `doctor` skill (the candidate's own
  name, "doctor 延伸," names this as an extension, not a new surface).

## Architecture

`doctor.mjs` gains two new flags: `--project` (opt-in; adds the two checks below on top of the
existing plugin-health checks — additive, never a replacement) and `--cwd <path>` (project-root
override, resolution order `--cwd` → `CLAUDE_PROJECT_DIR` → `process.cwd()`, matching
`failure-consolidate.mjs`'s/`run-consolidate.mjs`'s own existing precedent for this exact concept).

**`failure-memory-health`.** Resolves the project's `FAILURE_MEMORY.md` the same way
`failure-consolidate.mjs`'s own `resolveMemoryFile(cwd)` already does (reused directly, not
reimplemented). Calls the existing `consolidationReport()` and `tagRecurrenceCandidates()` against
it and summarizes the result into one detail line (e.g. "2 expire candidates, 1 tag-recurrence
pair" or "clean"). No `FAILURE_MEMORY.md` found → `unverified` (fail-open, mirroring that file's own
"no usage data ⇒ no claim" honesty discipline). Status is `pass` whenever the check successfully
ran, regardless of what it found — this check answers "did I successfully determine the state," the
same semantics the existing `node`/`telemetry` checks already use, not a pass/fail grade on the
project.

**`incident-journals`.** Scans `.ctide/incidents/*.md`. No such directory → `unverified`. For each
journal, reads the existing `Status: open | mitigated | closed` field (`salvage`'s own schema,
`references/reentry-and-closure.md` — not a new convention) and, for anything not `closed`, computes
age-in-days from the filename's `<YYYYMMDD>` and emits its own `incident:<slug>` check entry (one
entry per item, mirroring the existing `hook:<name>` pattern), detail carrying status + age. Zero
non-`closed` journals found → a single summary entry, `incident-journals: pass, 0 open`. A journal
whose `Status:` line is missing or unparseable is reported as its own distinct "status unknown"
finding — never silently treated as either open or closed, since guessing either way could hide a
real problem or manufacture a false one.

**Guidance extension (added after direct user feedback on the design).** `doctor`'s existing report
ends with a `guidance` array of actionable next steps (currently install/enable instructions only).
When `--project` was passed and either check found something actionable, the report appends
project-specific guidance naming the actual owner of the next step — never inventing a new
remediation path, only naming the existing ones:
- Any `FAILURE_MEMORY.md` finding (expire candidates, retired entries, tag-recurrence pairs): "hand
  this to a `vigil` run to consolidate (or edit directly for a trivial single-entry cleanup)" —
  mirrors `docs/advanced/retro-practice.md`'s own established principle that changes to the
  project's own state/policy go through the normal plan → approval → implementation → review
  pipeline, not a shortcut.
- Any non-`closed` incident journal: "re-enter `salvage`'s closure flow to close it properly" —
  closing an incident is `salvage`'s own stage-7 closure checklist (postmortem review, mitigations
  restored, `Status` flipped to `closed`); `doctor` only surfaces that one is still open, it never
  closes one itself.
No guidance lines are added when nothing actionable was found — conditional-only, matching this
session's established "omit the line entirely when clean" pattern (`final-report.md`'s Migration
status/Decision memory/Tag recurrence fields all follow the same rule).

**Open verification point (disclosed, not guessed).** `failure-consolidate.mjs`'s exported functions
live under `cressetide/skills/vigil/scripts/`; `doctor.mjs` lives under
`cressetide/skills/doctor/scripts/`. Whether a direct cross-skill-directory import is the right
shape here, versus invoking `failure-consolidate.mjs` as a subprocess (which would need a `--json`
output mode it does not currently have) or relocating the shared functions somewhere both skills can
import from equally, is a real implementation question this spec does not resolve — verify during
`vigil`'s own planning-grounding rather than assume either answer.

## Data flow

`/ctide:doctor` (no flag): unchanged, byte-for-byte identical to today.
`/ctide:doctor --project [--cwd <path>]`: runs the existing plugin-health checks, then appends
`failure-memory-health` and `incident-journals` (plus one `incident:<slug>` entry per non-closed
journal), then appends the conditional guidance lines described above.

## Components

- `cressetide/skills/doctor/scripts/doctor.mjs` — `--project`/`--cwd` flag parsing (guarded by this
  file's own `KNOWN_FLAGS`-style swallow-prevention, matching the sibling-reader-sweep discipline
  this session's own `run-reconcile.mjs`/`run-consolidate.mjs`/`failure-consolidate.mjs` already
  established); the two new check functions; the guidance-array extension.
- `cressetide/skills/doctor/SKILL.md` — document the two new flags, the two new checks, and the
  guidance behavior.
- `test/doctor-project.test.mjs` — new file (the existing `test/doctor-security.test.mjs` is scoped
  to plugin-health tamper-resistance specifically; the new project checks are a different concern,
  matching this repo's existing by-concern test-file naming).

## Error handling

- No `.ctide/` directory at all: both new checks report `unverified`, no crash.
- Malformed/unreadable `FAILURE_MEMORY.md`: mirrors `failure-consolidate.mjs`'s own existing
  fail-open behavior (empty entry set, no throw).
- An incident journal with a missing or unparseable `Status:` line: reported as its own "status
  unknown" finding, never silently assumed open or closed.
- `--project` passed with no `--cwd` and no `CLAUDE_PROJECT_DIR` set: falls back to
  `process.cwd()`, same as the existing scripts' own precedent — never an error on its own.

## Testing

New `test/doctor-project.test.mjs`, mirroring `test/failure-consolidate.test.mjs`'s fixture style
(synthetic `FAILURE_MEMORY.md` content, synthetic incident-journal files under a temp directory):
no `.ctide/` → both checks `unverified`; a `FAILURE_MEMORY.md` with known expire-candidate/
tag-recurrence fixtures → correct summary and `pass` status; a mix of `open`/`mitigated`/`closed`
incident journals → only non-`closed` ones produce their own check entry, age computed correctly
from the filename date; a journal with a missing `Status:` line → reported as unknown, not dropped;
the guidance array includes the new hand-off lines only when the corresponding check actually found
something, and is absent entirely on a clean project.

## Scope check

Touches one existing script, its SKILL.md, and one new test file. No new skill, hook, or CI guard.
The one open verification point (cross-skill import shape) is explicitly deferred to implementation
grounding, not guessed here. Consistent with a single implementation plan.
