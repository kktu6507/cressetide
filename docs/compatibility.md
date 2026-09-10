# Compatibility and conformance

Cressetide targets Claude Code first. Hook schemas, plan mode, subagent isolation, Workflow support, and Stop-hook output are runtime contracts that can change independently of this repository, so compatibility must be established from a fresh Cressetide run rather than inherited history.

## Current status

| Cressetide version | Runtime | Automated coverage | Live conformance status |
|---|---|---|---|
| current release | Claude Code | Plugin structure, hooks, agents, skills, Doctor, release tooling, validators, tests, and deterministic evals | **Partial, by observed scenario — no checklist item is claimed complete.** For `v0.7.1` a Windows run recorded: the plugin installed and loaded; one real `SessionStart` failure-memory injection; one real `PreToolUse` destructive-guard block; and `/ctide:doctor`'s own helper probes. Those are single observations, not whole checklist items — item 2 additionally requires the fallback and the no-memory silence, item 4 the harmless-command allow, item 1 an explicit reload. Direct helper probes are not host events. Nothing is recorded for plan-mode gating, the Stop advisory, real compaction, a full Vigil run, or Map and incident handoff. See `EVIDENCE.md`. |
| current release | GitHub Copilot CLI | No Cressetide-specific runtime claim is encoded by the local suite. | Unverified until a fresh Cressetide run is recorded. |
| current branch | CI / local Node.js | `npm run validate`, `npm test`, and `npm run eval` | Automated regression coverage only; it does not replace a real plugin install. |

## Runtime-specific behavior

These surfaces depend on Claude Code capabilities and may degrade elsewhere:

- `plan-gate.js` needs the permission-mode field supplied to `PreToolUse`.
- `compact-fidelity.js` relies on `SessionStart` output being surfaced after compaction.
- `orchestration-check.js` relies on `Stop` output being surfaced.
- Deep-mode Workflow requires a runtime Workflow capability.

Cressetide should fail open where its contract requires that behavior and must disclose any capability gap. A runtime is not described as supported until the corresponding Cressetide smoke evidence exists.

## Clean-profile conformance checklist

Run this checklist before publishing a live-compatibility claim. A claim is scoped to the **scenarios actually observed**, not to whole items: record what ran and what it showed, and never infer an item's remaining subcases from one observation or summarize partial coverage as "smoke passed".

1. Install, enable, and reload Cressetide from the intended marketplace or repository reference.
2. Confirm `load-failure-memory.js` injects a nonce-fenced digest when `.ctide/memory/FAILURE_MEMORY.md` exists, honors the documented compatibility fallback, and stays silent when no memory file exists.
3. Enter plan mode and confirm `plan-gate.js` denies an edit but allows the same edit outside plan mode.
4. Confirm `destructive-guard.js` asks before a narrow destructive command and allows a harmless command.
5. End a session that claims `READY` without the required review evidence and confirm `orchestration-check.js` advises.
6. Trigger compaction and confirm `compact-fidelity.js` emits the preservation block without hook-output validation errors.
7. Run `/ctide:doctor` and retain its health summary.
8. Run `/ctide:vigil <non-trivial task>` and confirm the workflow, reviewer panel, gatekeeper verdict, and final sentinels.
9. Run `/ctide:map` in a scratch project, confirm `.ctide/map/SYSTEM_MAP.md` is produced, and exercise the incident handoff described by the Map contract.

Record the runtime version, Node.js version, operating system, exact scenarios, results, and any degraded behavior in `EVIDENCE.md` or the release verification report. Until then, describe live compatibility as unverified.

## Automated regression files

The authoritative local checks are:

- `node .github/scripts/validate-structure.mjs`
- `npm test`
- `npm run eval`
- strict plugin validation of the nested plugin, `./cressetide`, only — the marketplace entry is validated separately in `kktu6507/plugins`

Optional manual smoke scenarios may be stored under `test/conformance/`; they are checklists, not proof that a live run occurred.
