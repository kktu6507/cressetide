---
name: doctor
description: Diagnoses local Cressetide plugin health, hook wiring, Node availability, fail-open behavior, debug output, and enablement without telemetry.
user-invocable: true
disable-model-invocation: true
---

# Doctor

Invoke manually as `/ctide:doctor`. Add `--project` for the three opt-in project-health checks.

**Before running anything, read `references/diagnostic-contract.md` in full and follow it.** It is
the single owner of every diagnostic step, what counts as evidence, and the report format — including
how to resolve the plugin root, the checks the helper does not cover, and what `--project` adds. This
file only names the entry points.

Plugin health, which always runs:

```text
node "${CLAUDE_PLUGIN_ROOT}/skills/doctor/scripts/doctor.mjs" --plugin-root "${CLAUDE_PLUGIN_ROOT}"
```

Plugin health plus project health:

```text
node "${CLAUDE_PLUGIN_ROOT}/skills/doctor/scripts/doctor.mjs" --plugin-root "${CLAUDE_PLUGIN_ROOT}" --project --json
```

`--json` produces machine-readable evidence. `--cwd <path>` points `--project` at another project;
without it, `--project` uses `CLAUDE_PROJECT_DIR`, then the current working directory.
