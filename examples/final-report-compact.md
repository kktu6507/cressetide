# Compact final report example (abbreviated)

Source: illustrative Cressetide report shape. This is an **abbreviated** illustration, not a complete report. Values in angle brackets must be replaced by observed evidence.

The complete contract is [`cressetide/skills/vigil/references/final-report.md`](../cressetide/skills/vigil/references/final-report.md); this example does not duplicate the source of truth. A real compact report additionally carries the **acceptance-criteria line**, the **one-line cost summary** and the **panel line** in Verification, and on a real run the **`### Live run`** evidence block just above the footer.

## Summary

- Implemented `<approved change>` in `<files or module>`.

## Verification

| Check | Result |
|---|---|
| `<focused check>` | `<observed result>` |
| `npm run validate` | `<observed result>` |
| `npm test` | `<observed result>` |
| `npm run eval` | `<observed result>` |

## Findings

| Severity | Detail |
|---|---|
| blocker | `<none or finding>` |
| major | `<none or finding>` |
| minor | `<none or finding>` |

## Final Verdict

- **`<READY, FIX REQUIRED, or NOT READY>`**

```text
ctide:verify=<pass, fail, unrun, or na>
ctide:delivery=<shipped or held>
ctide:panel=<full or documented substitution>
```
