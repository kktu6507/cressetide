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

# P5 I-8 live smoke (2026-10-15)

Host: Windows 11, Claude Code 2.1.296, Node v24.14.0, `claude -p --model haiku` (`claude-haiku-5-5`),
`--output-format stream-json --verbose --include-hook-events --max-budget-usd 0.1 --strict-mcp-config`,
`--plugin-dir <repo>/cressetide` (the P5 tree). Consumer repo path contains a space. Total spend ≈ US$0.10.

| Scenario | Result |
|---|---|
| plan mode, the model calls Write | `pre-tool-use.mjs` → `permissionDecision: "deny"` with the plan-gate reason; file not created |
| default mode with `--allowedTools 'Bash(git reset:*)'`, the model runs `git reset --hard` in a dirty tree | hook → `"ask"`, which overrides the allow rule; headless turns it into `permission_denied` (`decision_reason_type: "hook"`); the tree stayed dirty |
| `--resume <id> "/compact"` | `SessionStart:compact` → one `additionalContext`: failure-memory digest, blank line, `CTIDE_PRESERVE` block; startup/resume inject only the digest |

Setup notes for the next headless probe:
- The desktop app's login is a host proxy that a child process cannot use: the owner ran `claude auth login` for the
  standalone CLI once. Unset `CLAUDECODE`, every `CLAUDE_*` host variable and `ANTHROPIC_BASE_URL`.
- Account-synced plugins load in a standalone CLI; disable them (and the installed ctide) through `--settings`
  `{"enabledPlugins": {"ctide@kktu": false, "<name>@synced": false, …}}`, taking the names from the `init` event.
- From Git Bash, a leading-slash argument such as `"/compact"` is rewritten to a Windows path; set
  `MSYS_NO_PATHCONV=1`.

Full receipt: [p5-evidence.md](p5-evidence.md), section "I-8 live smoke".
