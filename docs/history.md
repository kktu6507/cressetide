# History

v0.8 removes subsystems that cost context and maintenance without feeding any decision. Nothing is
lost: every removed file is preserved in the `archive/v0.7.2-full` tag (see below).

## What v0.8 removed, and why

**Test provenance (TP).** TP bound test evidence to the source clauses it came from, so that a stale
claim would be refused. A run became TP-active only when the validated store held a current TaskState
for the task, and no shipped entry point could create that TaskState, so no real run could take the TP
path. It was still roughly 85–90% of the vigil scripts. It understood `node:test` only and failed
closed on ordinary code. Its scripts, tests, vendored parsers, specs and review records were removed.
Three review rules from it now live in `test-reviewer`: do not pin what no source states, keep each
assertion inside its source's scope, and look for extra assertions as well as missing ones.

**The run ledger.** Each vigil run appended a record to `.ctide/ledger/runs.jsonl`; the next run
reconciled earlier runs against later commits, and a consolidation step suggested a retro after
repeated escapes. That output never fed any decision: no scope, panel or verdict depended on it.
`references/run-ledger.md` was 26,177 bytes and was loaded on every run. The ledger, reconcile and
consolidate scripts, `references/run-ledger.md`, the retro practice page and Doctor's `ledger-health`
check were removed.
Ship's pending section now comes from git (commits and changed files since the last release tag) and
states that it is not a readiness claim.

**GitHub Copilot CLI support.** No Cressetide run was ever recorded under Copilot CLI. Removed in v0.8:
the Copilot root fallbacks in hooks.json, the camelCase event-field alias, the plugin.json `agents[]` list
(Claude Code discovers `agents/*.agent.md`), and the Copilot README and compatibility notes.

## Where the history lives

The annotated tag `archive/v0.7.2-full` points at main commit `acbe433` (v0.7.2 plus 7 later commits),
just before the v0.8 refactor, so it holds everything above. Read any archived file with:

```bash
git show archive/v0.7.2-full:<path>
```

or browse it at <https://github.com/kktu6507/cressetide/tree/archive/v0.7.2-full/>.

Archived areas:

- TP specs and amendments: [`docs/superpowers/specs/`](https://github.com/kktu6507/cressetide/tree/archive/v0.7.2-full/docs/superpowers/specs) (`*-test-provenance-*`).
- TP review records and the other design reviews: [`docs/superpowers/reviews/`](https://github.com/kktu6507/cressetide/tree/archive/v0.7.2-full/docs/superpowers/reviews).
- The intent-scan spec and the shared-decision provenance model: [`2026-07-25-intent-scan-spec.md`](https://github.com/kktu6507/cressetide/blob/archive/v0.7.2-full/docs/superpowers/specs/2026-07-25-intent-scan-spec.md), [`2026-07-25-shared-decision-provenance-model.md`](https://github.com/kktu6507/cressetide/blob/archive/v0.7.2-full/docs/superpowers/specs/2026-07-25-shared-decision-provenance-model.md).
- The 2026-09-11 master roadmap: [`2026-09-11-cressetide-correctness-and-lean-roadmap.md`](https://github.com/kktu6507/cressetide/blob/archive/v0.7.2-full/docs/superpowers/plans/2026-09-11-cressetide-correctness-and-lean-roadmap.md).
- The efficiency roadmap, dispositions and evidence: [`2026-09-08-cressetide-efficiency-roadmap.md`](https://github.com/kktu6507/cressetide/blob/archive/v0.7.2-full/docs/superpowers/specs/2026-09-08-cressetide-efficiency-roadmap.md), the `*-disposition.md` and `*-evidence.json` files under `docs/superpowers/reviews/`, and the measurement manual [`docs/efficiency-measurement.md`](https://github.com/kktu6507/cressetide/blob/archive/v0.7.2-full/docs/efficiency-measurement.md).
- The run-ledger contract and retro practice: [`run-ledger.md`](https://github.com/kktu6507/cressetide/blob/archive/v0.7.2-full/cressetide/skills/vigil/references/run-ledger.md), [`retro-practice.md`](https://github.com/kktu6507/cressetide/blob/archive/v0.7.2-full/docs/advanced/retro-practice.md).
- The TP and run-ledger scripts: [`cressetide/skills/vigil/scripts/`](https://github.com/kktu6507/cressetide/tree/archive/v0.7.2-full/cressetide/skills/vigil/scripts).

## The efficiency investigation

The maintainer's efficiency investigation asked whether ctide's own overhead could be cut without
losing review quality. It **closed on 2026-09-10**: the current default was kept and **neither
investigated candidate was adopted**. The roadmap it followed was not completed.

- **Input deduplication was retired at design.** Removing two apparently duplicated instruction pairs
  from the `code-reviewer` input would have removed 15 of 7,877 bytes (≈0.19%), too small to be worth
  a paid comparison.
- **The reviewer-output trial was stopped by its own frozen quality gate** after 10 role calls (3
  reviewer pairs, 2 pairs judged, 0 confirmation calls; US$1.145441 CLI estimate). Two candidate-arm
  faults triggered the stop; whether the candidate's added guidance caused them was never established.
- **The L1b reviewer replay baseline** replayed the shipped `code-reviewer` prompt on seven synthetic
  fixtures: 5/5 hits on the defect fixtures and 2/2 clean controls accepted, over 14 role calls plus
  one retained aborted pilot (US$1.572788 combined estimate). It is a prompt-drift reference, not a
  real-world recall figure.
- **Native full-flow observations were blocked.** Both runs (phase32 and phase33) ended BLOCKED on
  synthetic fixtures before any approved plan or implementation. phase32 cost US$0.719042 (estimate);
  phase33's cost is unknown, not zero.
- **Net benefit against a well-configured native agent was never measured.** The held-out
  confirmation stage never ran because no candidate qualified for it, so no saving, efficacy or
  real-world benefit is claimed.

All amounts are CLI price-table estimates, not billing, and they are never added together. Sources:
the [final disposition](https://github.com/kktu6507/cressetide/blob/archive/v0.7.2-full/docs/superpowers/reviews/2026-09-10-efficiency-final-disposition.md)
and its [evidence](https://github.com/kktu6507/cressetide/blob/archive/v0.7.2-full/docs/superpowers/reviews/2026-09-10-efficiency-final-native-evidence.json),
the [input-consolidation disposition](https://github.com/kktu6507/cressetide/blob/archive/v0.7.2-full/docs/superpowers/reviews/2026-09-09-input-consolidation-disposition.md),
the [reviewer-output trial disposition](https://github.com/kktu6507/cressetide/blob/archive/v0.7.2-full/docs/superpowers/reviews/2026-09-09-reviewer-output-trial-disposition.md),
the [L1b evidence](https://github.com/kktu6507/cressetide/blob/archive/v0.7.2-full/docs/superpowers/reviews/2026-09-08-efficiency-l1b-evidence.json),
and the [measurement manual](https://github.com/kktu6507/cressetide/blob/archive/v0.7.2-full/docs/efficiency-measurement.md).
