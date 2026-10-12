# Command reference

Cressetide exposes exactly five public Claude Code commands under the `ctide`
namespace.

## `/ctide:vigil <task>`

Use Vigil for non-trivial software changes that require implementation and
verification. Vigil may also be selected automatically for matching requests.

The loop is:

```text
Understand
→ Ground
→ Plan
→ Human approval
→ Implement
→ Verify
→ Review
→ Arbiter verdict
→ Repair loop
→ READY / FIX REQUIRED / NOT READY
```

Before implementation, Vigil defines numbered observable acceptance criteria,
must-not-change scope, assumptions, affected files, risks, checks, rollout, and
rollback. It reads `.ctide/map/SYSTEM_MAP.md` when present, verifies the touched
area directly, and pauses for material business, security, destructive, data,
contract, or user-flow ambiguity.

Every non-trivial formal review includes `intent-reviewer`, which is never
substituted. `test-reviewer` is included unless the run takes the evidence
-substitution fast lane, which is available only on low/medium-risk work whose
execution evidence already answers the question, and is disclosed as
`ctide:panel=substituted:test-reviewer`. On a **TP-active** run the real
`test-reviewer` is mandatory and the fast lane never applies, **even when the
changed-test inventory is empty**. Vigil adds only the applicable discipline
reviewers and runs `arbiter` after their reports are available. A failed or
unrun required check blocks `READY`.

Options:

- `--lite`: use the smallest safe review panel, and skip deep-mode Tier 2.
- `--deep` (or a `deep:` / `ultra:` prefix): opt into deep-mode Tier 2 —
  adversarial verification and maximum reasoning effort for `arbiter` /
  `security-reviewer`. Never auto-engaged.
- `--no-deep`, and its alias `--shallow`: opt out of deep-mode **Tier 1**, the
  deterministic panel enforcement that otherwise auto-engages on high-risk or
  correctness-critical work where the Workflow capability exists. Tier 2 is
  already opt-in, so this flag is not about the adversarial tier.
- `--report full`: request the detailed final report.

## `/ctide:salvage`

Use Salvage for an active production outage, severe malfunction, data
corruption, security incident, or explicit incident preparation. Matching
production-incident language may select Salvage automatically.

Salvage records UTC time, severity, impact, blast radius, active writes, known
unknowns, and sanitized evidence in
`.ctide/incidents/INCIDENT-<date>-<slug>.md`. It reads the Map, verifies live
production evidence, and continues with rapid reconnaissance if the Map is
missing or stale.

Each production-affecting action has one decision card containing a hypothesis,
evidence, exact action, expected effect, risk, rollback, observer, and approval.
Do not stack simultaneous mitigation changes. Formal code or data repair goes
through `/ctide:vigil`; production re-entry needs explicit criteria, named
health signals, an observation window, and rollback readiness.

## `/ctide:map`

Map is manual-only and has three modes:

| Invocation | Behavior |
| --- | --- |
| `/ctide:map` | Create `.ctide/map/SYSTEM_MAP.md` when the Map is missing. |
| `/ctide:map refresh` | Rescan current evidence, replace stale generated claims, and surface conflicts. |
| `/ctide:map verify` | Report drift, missing sources, conflicts, and uncertainty without writing files. |

Every important section records commit identity, update date, confidence, and
source paths. Claims without repository evidence are marked `UNVERIFIED`.
Neither Vigil nor Salvage treats Map content as authority.

## `/ctide:doctor`

Doctor is manual-only. It checks the plugin copy your session actually loaded —
identity and version, the Node runtime, the six hooks' wiring, fail-open
behaviour and debug isolation, the two guard decisions, and the skill and agent
inventory — and reports `pass`, `fail` or `unverified` per check, with no network
access or telemetry. It never changes your project or user configuration; its
helper creates and removes one temporary directory for its own probes.

| Command | Effect |
| --- | --- |
| `/ctide:doctor` | Plugin-health report. |
| `/ctide:doctor --project` | Adds three project-health checks; without the flag the default report is unchanged. |
| `--cwd <path>` | Points `--project` at a project other than the current directory. |

- `failure-memory-health` summarizes the project's own `FAILURE_MEMORY.md`, never
  the machine-global one.
- `incident-journals` flags any `.ctide/incidents/*.md` not confirmed `closed`.
- `ledger-health` reports reconciliation debt plus how far `HEAD` has moved past
  the ledger's last recorded commit.

The exact steps, evidence rules and report format have one owner:
[`diagnostic-contract.md`](../cressetide/skills/doctor/references/diagnostic-contract.md).
Doctor must not claim a live plugin smoke unless an authenticated Claude Code
session loaded and exercised the installed plugin.

## `/ctide:ship`

Ship is manual-only and read-only. It reports pass, fail, not-applicable, or
unverified for each of:

1. version consistency across the `package.json` files Ship discovers by walking
   the repository. The walk skips `.git`, `.ctide`, `node_modules`, `dist`,
   `build`, `coverage` and `vendor`, so a dependency's or a build output's own
   manifest is never compared against yours. That ecosystem only — not other
   manifest formats, and not ctide's own nested
   `cressetide/.claude-plugin/plugin.json`;
2. whether `CHANGELOG.md` changed since the last release tag;
3. tag readiness for the currently declared version (an existing tag for it, or
   a dirty working tree, both block readiness);
4. migration compatibility, read from `SYSTEM_MAP.md`'s Rollback section's
   `CTIDE:TRUST` sentinel, never the surrounding prose;
5. checksum verification, only when `--artifact` and `--checksum` are both
   supplied explicitly — Ship never scans a directory to guess a build
   artifact.

Ship reads every `READY` run in the ledger since the last release tag,
presents that pending batch for the human to review, and never executes a
build/test/deploy step, picks or bumps a version, drafts changelog content, or
writes anything.

## Final vocabulary

Findings use `blocker`, `major`, and `minor`. Vigil reports `READY`,
`FIX REQUIRED`, or `NOT READY` and ends with:

```text
ctide:verify=pass|fail|unrun|na
ctide:delivery=held|shipped
ctide:panel=full|substituted:<names>
```

`ctide:delivery=shipped` refers to the reviewed change handed to the user. It
does not state that a Git push, deployment, tag, or published release occurred.
