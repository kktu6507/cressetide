> P0 實機探測紀錄（原檔 `.ctide/output/probes.md`）。

# P0 live probe receipts (2026-10-13)

Host: Windows 11, Claude Code 2.1.296 (auto-updated from 2.1.272 during the session), Node v24.14.0, `claude -p --model haiku`,
all other plugins disabled via --settings, standalone CLI env (CLAUDE_CODE_* host vars unset), consumer repo path contains spaces.
Probe plugin: scratchpad/probe plugin/ctprobe (strict-validates on 2.1.272 and runs on 2.1.296). Total spend ≈ US$0.28.

| Probe | Result | Evidence |
|---|---|---|
| P0-1 hook command forms | shell form via default shell (Git Bash), shell form with `"shell":"powershell"`, and exec form (`command:"node", args:["${CLAUDE_PLUGIN_ROOT}/hooks/log.mjs"]`) ALL fire for PreToolUse on Bash/Edit/Write; CLAUDE_PLUGIN_ROOT is substituted (backslash Windows path with spaces) and exported | probeA.log / probeD.log: 2× each tag |
| P0-2 SubagentStop | fires for foreground subagents, a background subagent (run_in_background true), and a Workflow `agent()` call. Input keys: agent_id, agent_transcript_path, agent_type (e.g. `ctprobe:echo-agent`), background_tasks, cwd, effort, hook_event_name, last_assistant_message, permission_mode, prompt_id, session_crons, session_id, stop_hook_active, transcript_path. | probeA.log, probeB.log |
| Stop input | keys: background_tasks, cwd, effort, hook_event_name, last_assistant_message, permission_mode, prompt_id, session_crons, session_id, stop_hook_active, transcript_path. Stop fired while a background subagent was still running with `background_tasks: []` → background_tasks is NOT a reliable in-flight signal at Stop. | probeA.log first stop record |
| P0-3 skills preload | agent frontmatter `skills: [contract-probe]` (bare) AND `skills: [ctprobe:contract-probe]` (namespaced) both inject the skill body at start; skill has `user-invocable: false` (model-invocable) | probeA step3/step4 = PROBE-TOKEN-7731 |
| P0-4 agent discovery | no `agents[]` in plugin.json; `agents/*.agent.md` auto-discovered as `ctprobe:<name>` (4/4) | probeA step7 |
| P0-5 plugin workflow | `workflows/probe-wf.js` discovered; Workflow tool accepts name `ctprobe:probe-wf`; `args` object delivered; `agent(prompt,{agentType:'ctprobe:echo-agent'})` runs the plugin agent; the workflow is also listed as a skill `ctprobe:probe-wf` | probeB result `{"gotArgs":{"x":1},"agentReply":"ECHO-OK"}` |
| P0-6 native plan mode | `--permission-mode plan` headless: Edit and Write denied by the host even with `--allowedTools Edit Write` ("Cannot write to … while in plan mode"); PreToolUse hooks still ran first with permission_mode=plan. NOT tested: interactive session with bypass-permissions available (docs say plan-mode edit blocks are instructions-only there). | probeD permission_denials |
| P0-7 `${CLAUDE_PLUGIN_ROOT}` in agent body | expanded (forward-slash path) and the agent could Read the file | probeA step5 = path + REF-TOKEN-4402 |
| CLAUDE_PLUGIN_DATA | exported to hooks: `~/.claude/plugins/data\ctprobe-inline` | probeA.log env_data |

Decisions taken from these probes:
- hooks.json: shell form `node "${CLAUDE_PLUGIN_ROOT}/hooks/<x>.mjs"` (works on bash + powershell; broadest client support).
- Drop plugin.json `agents[]` (auto-discovery proven).
- reviewer contract via agent `skills:` preload (bare name).
- Ship `workflows/vigil-review.js`; agent() uses agentType 'ctide:<reviewer>'.
- SubagentStop recorder in CLAUDE_PLUGIN_DATA (tmp fallback); Stop must not rely on background_tasks alone.
- navigator/cartographer may cite `${CLAUDE_PLUGIN_ROOT}/skills/map/references/...` (expansion proven).
- plan-gate: native headless plan mode blocks edits, but the documented interactive bypass-available gap is untested → KEEP a slim edit branch as backstop (deviation from the plan's literal "remove if native blocks"; disclosed).
