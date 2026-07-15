# Full final report example

Source: illustrative Cressetide report shape. It is not a historical run or evidence record.

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
ctide:verify=<pass, fail, or unrun>
ctide:delivery=<shipped or held>
ctide:panel=<full or documented substitution>
```
