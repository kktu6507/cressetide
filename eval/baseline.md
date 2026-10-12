# Behavioral regression baseline

A first model-backed reference is recorded. Read the **Scope and method** section before
comparing anything to it: this is a *constrained-excerpt replay* baseline, not a run of the
procedure in [`README.md`](README.md), and the two are not comparable.

- **Date:** 2026-09-08
- **Reviewer under test:** `shipped code-reviewer prompt-body replay` on `claude-opus-5`
- **Effort:** `xhigh` · **CLI:** `2.1.263`
- **Independent judge:** separate fresh `claude-opus-5` / `xhigh` session, own neutral system
  prompt, no plugin, no ctide prompt, structured-output grade only

## Scores

| Metric | Result |
|---|---:|
| Hit recall | 5/5 |
| Clean-control acceptance | 2/2 |

*"Clean-control acceptance" is the fraction of `clean` controls on which the reviewer raised no
confident blocker or major. Earlier revisions of this file called it "Clean precision"; it is
not a true precision, and the row was renamed rather than left mislabelled.*

## Per-fixture outcomes

| Fixture | Lang | Expected | Result | Pass |
|---|---|---|---|:--:|
| `01-js-missing-return` | JavaScript | hit | hit | yes |
| `02-py-off-by-one` | Python | hit | hit | yes |
| `03-go-nil-before-check` | Go | hit | hit | yes |
| `04-py-mutable-default` | Python | hit | hit | yes |
| `05-js-foreach-await` | JavaScript | hit | hit | yes |
| `06-clean-js-guard` | JavaScript | clean | clean-ok | yes |
| `07-clean-py-bounds` | Python | clean | clean-ok | yes |

## Scope and method

The reviewer was the shipped `code-reviewer` **prompt body**, delivered through
`--system-prompt`, which replaces the CLI's entire default system prompt. No plugin was loaded
and no `--agent` was passed, so **native plugin activation is unverified and not claimed**. The
available tool surface was closed to `Read`/`Grep`/`Glob` with no Bash, in a neutral temp
directory holding only the excerpt.

**This does not follow [`README.md`](README.md)'s procedure**, which hands fixtures to the
`ctide:code-reviewer` plugin agent with its full declared tool set via
`fixture-eval.workflow.js`. A future run following that procedure is **not comparable** to these
numbers; a difference would not be evidence of prompt drift. The method binds the comparison —
re-run this same replay method, or record a separate baseline.

## Limitations

- The fixtures' `Intent` lines state the contract precisely and may make defects easier to find
  than unhinted review; direction plausibly optimistic, magnitude unmeasured.
- Five `hit` fixtures and two `clean` controls: one judge call each, so a single fixture moves a
  rate by 1/5 or 1/2.
- **The judge is uncalibrated on negatives.** Codex independently checked all seven final
  outputs against the fixture ground truth and agrees with the seven grades, so the evidence does
  support these actual outcomes. But no `miss` or `false-positive` was ever produced in a live
  run, so a constant-pass judge would yield the same aggregate. Offline schema and negative-record
  tests are not semantic discrimination evidence. **Negative calibration is required before
  relying on this baseline for drift detection.** Treat it as a scoped observed reference, not
  as validated detection sensitivity.
- Both roles used fresh separate sessions on the same model and provider; role separation is not
  statistical independence.
- Some calls ran concurrently with the local regression suite, so elapsed times are not a latency
  benchmark. Cache-read counts across sequential same-prefix calls may be a harness artifact; no
  causal attribution is measured.
- Reviewer final text is model-produced evidence, not verified execution. Raw thinking is not
  published.
- No efficacy, workflow, safety, native-agent comparison, held-out evaluation, GPT-6 Astra
  runtime trial or stronger-model equivalence claim follows from this run.

## Cost

CLI bundled-price-table **estimates**, not provider billing, and excluding all implementation and
discussion sessions:

| Item | Estimate (USD) |
|---|---:|
| 14 completed baseline role calls (7 reviewer + 7 judge) | 1.4056655 |
| Retained failed pilot (1 reviewer call, refused by the strict model gate, not scored or replaced) | 0.1671225 |
| **Combined** | **1.572788** |

There were no implicit retries: the failed pilot is retained unchanged and accounted separately.

## Evidence and reproducibility

- Full evidence, per-call accounting and reviewer outputs:
  [`../docs/superpowers/reviews/2026-09-08-efficiency-l1b-evidence.json`](../docs/superpowers/reviews/2026-09-08-efficiency-l1b-evidence.json)
- Protocol, boundaries and disclosures:
  [`../docs/efficiency-measurement.md`](../docs/efficiency-measurement.md)
- Frozen identity for this run — manifest file SHA-256
  `759d5d15444d8093cae1698a6a5fd1507dffd095b8cb314ea9f46d11756f546e`, reviewer system prompt
  `c09639569335c220a9580784c6be9816e1beb91af35d8fd0380e1bd332b466e0`, shared reviewer contract
  `741e2b3d4c313f9c0ee807003fb3ba1ae09f6e8b2dabb17f197f18ac7a9155a6`, CLI executable
  `0b35df94c1307004f07b738390bfef8dfca5e9af29aaf6517f305bf086b95b03`. The evidence file carries
  the full source-hash set.

`check-model-provenance.mjs` now has a recorded model to compare against; a mismatch means these
numbers may not hold and the suite should be re-run under the same replay method before they are
trusted.
