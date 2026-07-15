---
name: doctor
description: Diagnoses local Cressetide plugin health, hook wiring, Node availability, fail-open behavior, debug output, and enablement without telemetry.
user-invocable: true
disable-model-invocation: true
---

# Doctor

Invoke manually as `/ctide:doctor`.

Run the bounded diagnostic helper first:

```text
node "${CLAUDE_PLUGIN_ROOT}/skills/doctor/scripts/doctor.mjs" --plugin-root "${CLAUDE_PLUGIN_ROOT}"
```

Use `--json` when machine-readable evidence is needed. The helper is read-only apart from isolated temporary probe files that it deletes before exit.

Perform read-only local probes and report pass, fail, or unverified for each item:

1. Resolve the plugin root from `${CLAUDE_PLUGIN_ROOT}` and confirm `.claude-plugin/plugin.json` names `ctide` at version `0.1.0`.
2. Report the Node executable and version; Node 20 or newer is required.
3. Parse `hooks/hooks.json` and confirm exactly the six documented hook files are wired through `${CLAUDE_PLUGIN_ROOT}`.
4. Syntax-check each hook and invoke it with a harmless, bounded event. A probe must exit zero even for malformed input, demonstrating the fail-open invariant.
5. With `CTIDE_HOOK_DEBUG=1` in an isolated temporary directory, confirm the `[ctide ...]` debug prefix and `ctide-hook.log` behavior without exposing environment values.
6. Confirm the four public skill directories and eleven agent manifests exist.
7. Explain how to install, enable, and reload `ctide@kktu`; do not mutate user configuration automatically.
8. State that no telemetry or network probe was performed.

If a command cannot run, name the exact command, blocker, and remaining uncertainty. Do not report a live plugin smoke unless an authenticated Claude Code session actually loaded and exercised the installed plugin.

## 完整診斷契約

執行前必須讀取並套用 `references/diagnostic-contract.md` 的全部診斷步驟，包括 plugin-root 環境變數 fallback、六個 hook 的實際觸發／fail-open 證據，以及可貼入報告的逐 hook 結果。若該契約與本檔的強化檢查重疊，執行兩者中較嚴格者；不得省略任一診斷檢查。
