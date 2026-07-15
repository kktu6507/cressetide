---
name: doctor
description: Self-check ctide's hooks + environment and print a paste-able health report. Only runs when the user invokes /ctide:doctor. No telemetry — local, on-demand, user-initiated.
disable-model-invocation: true
---

# ctide doctor — local self-check

Run an on-demand diagnostic of ctide's own hooks and environment, then print a **paste-able
health report**. This exists because ctide ships **no telemetry**: when a hook fails open in a
real session, nothing surfaces. This is the opt-in, local substitute — never a background or
network call.

Be concise; this is a diagnostic, not a workflow. Run read-only checks only; do **not** modify the
project. If a step can't run, say why and continue.

## Steps

1. **Plugin root.** Resolve `$CLAUDE_PLUGIN_ROOT` (else `$COPILOT_PLUGIN_ROOT`, else `$PLUGIN_ROOT`).
   If none is set, report that hooks can't be located from here and stop with that finding. Do
   **not** fall back to searching the filesystem for ctide installations: a copy found by search
   (an old marketplace cache, another runtime's install such as `~/.copilot/…`) is not the copy this
   session runs, and diagnosing it produces a false health report — worse than no report. A live
   search can cause a stale copy to be reported as "DEGRADED". Note which variable supplied the
   root; the report prints it.

2. **Node.** Run `node --version`. If `node` is **absent**, this is the single most common silent
   failure — **all six hooks no-op** (fail-open by design). Report it as the top finding.

3. **Hook files present.** Confirm `hooks/plan-gate.js`, `destructive-guard.js`, `contract-guard.js`,
   `load-failure-memory.js`, `compact-fidelity.js`, `orchestration-check.js` all exist under the root.

4. **Each hook fires + fails open.** Pipe a synthetic event to each hook with `CTIDE_HOOK_DEBUG=1`
   and capture the **exit code** and **stderr** (the debug trace writes a `[ctide <hook>] …` line to
   stderr). For each: confirm **exit 0** (the fail-open invariant) and that a `[ctide …]` line shows
   it actually **processed** the event (not a silent no-op). Suggested probes (adapt to the shell;
   `$R` = the resolved root):
   - `printf '{"tool_name":"Write","tool_input":{},"permission_mode":"plan"}' | CTIDE_HOOK_DEBUG=1 node "$R/hooks/plan-gate.js"` — expect a `permissionDecision` of `deny` (a plan-mode write).
   - `printf '{"tool_name":"Bash","tool_input":{"command":"git reset --hard"}}' | CTIDE_HOOK_DEBUG=1 node "$R/hooks/destructive-guard.js"` — expect `permissionDecision: "ask"`.
   - `printf '{"tool_name":"Write","tool_input":{"file_path":".ctide/output/contract.md","content":"x"}}' | CTIDE_HOOK_DEBUG=1 node "$R/hooks/contract-guard.js"` — expect exit 0 and a `[contract-guard] …` debug line (no prior file ⇒ first-write case, always allowed unless a populated contract sits at the other watched path — then it asks).
   - `printf '{"source":"compact"}' | CTIDE_HOOK_DEBUG=1 node "$R/hooks/compact-fidelity.js"` — expect **valid JSON** with `hookSpecificOutput.additionalContext` (the exact shape that broke under `PreCompact`), and a `[compact-fidelity] emitted preservation block` line.
   - `printf '{}' | CTIDE_HOOK_DEBUG=1 node "$R/hooks/load-failure-memory.js"` — exit 0; emits a digest only if a `FAILURE_MEMORY.md` exists.
   - `printf '{}' | CTIDE_HOOK_DEBUG=1 node "$R/hooks/orchestration-check.js"` — exit 0 (advisory/silent on an empty event).

   On Windows PowerShell, use `'{"source":"compact"}' | node "$R\hooks\compact-fidelity.js"` with
   `$env:CTIDE_HOOK_DEBUG='1'`.

5. **Enabled?** Note that hooks only run when the plugin is **enabled** (`/plugin` → Installed →
   ctide on); if the user reports nothing happening in real sessions, confirm enablement and that
   `node` is on the PATH **the editor/agent launched with** (not just the terminal's).

## Report

Print a compact table — one row per hook: `OK` (fired, exit 0) / `no-op` (exit 0 but never processed
— usually no Node) / `FAIL` (non-zero exit, or wrong output shape) — plus the Node status and the
plugin root **with which env var supplied it** (or `none — not diagnosable from here`). End with a
one-line verdict (**healthy** / **degraded** / **broken**) and, if degraded/broken,
the most likely cause and fix. Tell the user they can paste this report into a
[`Verified ctide run`](https://github.com/kktu6507/cressetide/issues/new?template=verified-run.yml)
issue or a bug report — it is the only health signal ctide has, since it sends none on its own.
