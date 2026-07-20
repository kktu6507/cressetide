# Optional external capabilities (reader guide)

These capabilities are **optional, off by default, and opt-in**. ctide runs fully standalone without them; when one is present it is used, and when it is absent the work is done locally and the gap is disclosed (the **Detect → Use → Else-Disclose** protocol).

> This page is a **reader guide**. The rules ctide actually follows at runtime live in the shipped reference [`cressetide/skills/vigil/references/external-capabilities.md`](../../cressetide/skills/vigil/references/external-capabilities.md) — that file is the operational source of truth; this one just explains setup and trade-offs in one place so the main README stays short.

## ui-ux-pro-max (preferred design source for UI work)

If the `ui-ux-pro-max` skill is installed, ctide consults it first for UI design decisions (styles, palettes, font pairings, UX guidelines, accessibility/contrast checks) during planning and before UI implementation, and folds its guidance into `ui-ux-reviewer`. If it is unavailable, ctide falls back to a built-in baseline (WCAG AA contrast, ≥44px targets, required interaction states) and discloses that ui-ux-pro-max was not used.

Note: ui-ux-pro-max may run a local Python helper; if Python is unavailable the detect step fails gracefully and the fallback applies. Treat it like any optional capability — it executes local code and may perform network/data egress depending on its implementation.

## MCP per reviewer (opt-in, read-only)

MCP is high context cost, so it ships **disabled**: the plugin's `cressetide/.mcp.json` has no active servers, and each reviewer's `tools:` list keeps its `mcp__*` allow-line commented out.

To enable one for a reviewer:

1. Copy the server entry from [`cressetide/mcp.example.json`](../../cressetide/mcp.example.json) into `cressetide/.mcp.json`'s `mcpServers`.
2. Uncomment the matching `mcp__*` line in that reviewer's frontmatter `tools:` list.
3. Keep reviewers **read-only** — grant only read-type MCP tools, and never give a reviewer access to secrets.

> **Avoid the `mcp__<server>__*` wildcard for servers that have write tools.** The wildcard grants *every* tool the server exposes, including mutating ones (a GitHub MCP's create-PR / comment / merge tools, for example), which breaks the read-only contract. List the specific read tools the reviewer needs instead — e.g. `mcp__github__get_pull_request`, `mcp__github__get_pull_request_diff` rather than `mcp__github__*`.

Suggested read-only mapping:

| Reviewer | MCP | Purpose |
|---|---|---|
| `security-reviewer` | `mcp__semgrep`, `mcp__osv` | SAST, CVE / dependency scanning (never secrets) |
| `test-reviewer` / `ui-ux-reviewer` | `mcp__playwright` | browser evidence |
| `code-reviewer` | `mcp__github` | diff / PR context |
| `operability-reviewer` | observability MCP (Sentry / Datadog / Grafana) | production signals — read-only, minimal scope |
| `intent-reviewer` | issue / PM tracker MCP (Jira / Linear / GitHub Issues) | requirement context |

## Structural code indexes (optional lead source)

If a structural index already exists for the repo — an LSP server or a code-review-graph database — cartographer (Map enrichment) and navigator (plan grounding) may query it for candidate entry points, callers, flows, and hotspots. Leads only: every claim still gets verified in the real file and cited path:line before it lands, the index never becomes part of the Map, and a missing index is not a gap (lean grep is the baseline). Prefer querying the CLI on demand over enabling such a tool's MCP server, and do not run its agent-integration installer.

## Codex (optional cross-model second opinion / rescue)

Codex is an optional cross-model (OpenAI GPT-family) "second opinion / rescue" capability. It is **off by default**, is never required, and is never a hard dependency.

- **Per-task opt-in.** ctide does not use Codex unless you explicitly enable it for the task — not even if it is installed and the repair loop is stuck. Without that opt-in, ctide continues locally and (where relevant) notes that Codex was available but not enabled.
- **When it's used.** Only at high-leverage moments — primarily when the repair loop is stuck (the same blocker persists across two iterations and a Stuck Summary is imminent), or when a high-risk verdict genuinely needs an independent cross-model review. Never a routine step.
- **Data egress.** Enabling Codex means consenting to send the relevant code/context to an external (OpenAI) model runtime — a third party — at additional cost. Only opt in when that is acceptable for the repository's data sensitivity.
- **Installed-but-cannot-execute.** If Codex is installed but a `codex` invocation fails to run (e.g. a Windows `CreateProcessAsUserW` / process-spawn error from `[windows] sandbox = "elevated"` in `~/.codex/config.toml`, or an auth/`codex login` problem), ctide discloses it as "Codex detected but could not execute (reason)" and points at `~/.codex/config.toml` / `codex login` — **not** as "not installed". A not-enabled or unavailable Codex is a non-blocking, disclosed gap; ctide always reaches a verdict without it.
