# Full final report example (abbreviated)

Source: illustrative Cressetide report shape. This is an **abbreviated** illustration, not a complete report. It is not a historical run or evidence record.

The complete contract is [`cressetide/skills/vigil/references/final-report.md`](../cressetide/skills/vigil/references/final-report.md); this example does not duplicate the source of truth. A real `--report full` report additionally carries the **acceptance-criteria** and **external-capabilities** lines, the **plan-drift** and **ledger** lines when applicable, the **per-agent Cost table** with its component columns, `Source` basis and Share bars, and on a real run the **`### Live run`** evidence block just above the footer.

## Summary

- State exactly what was implemented and its user-visible or operational effect.

## Files Changed

| File | Reason |
|---|---|
| `<path>` | `<approved change and purpose>` |

## Assumptions

- List only assumptions that affected implementation or verification.

## Verification

| Check | Observed result |
|---|---|
| `<focused test>` | `<exit status and result>` |
| `npm run validate` | `<exit status and result>` |
| `npm test` | `<exit status and result>` |
| `npm run eval` | `<exit status and result>` |

Disclose every skipped or unavailable check and the uncertainty it leaves.

## Findings

| Severity | Finding | Disposition |
|---|---|---|
| blocker | `<none or finding>` | `<open, fixed, or accepted with reason>` |
| major | `<none or finding>` | `<open, fixed, or accepted with reason>` |
| minor | `<none or finding>` | `<open, fixed, or accepted with reason>` |

## Missing Tests

- List required coverage that does not exist, or state `none identified`.

## Risks

- List remaining limitations and operational uncertainty.

## Failure Memory

- State whether a reusable lesson is required, why, and where it was recorded.

## Final Verdict

- **`<READY, FIX REQUIRED, or NOT READY>`**

```text
ctide:verify=<pass, fail, unrun, or na>
ctide:delivery=<shipped or held>
ctide:panel=<full or documented substitution>
```
