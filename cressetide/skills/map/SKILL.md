---
name: map
description: Builds, refreshes, or verifies a repository-grounded system map with cited provenance, confidence, uncertainty, and staleness handling.
user-invocable: true
disable-model-invocation: true
---

# Map

Invoke manually as `/ctide:map`, `/ctide:map refresh`, or `/ctide:map verify`.

The deterministic helper lives at `${CLAUDE_PLUGIN_ROOT}/skills/map/scripts/map.mjs`:

```text
node "${CLAUDE_PLUGIN_ROOT}/skills/map/scripts/map.mjs" create --root <repository>
node "${CLAUDE_PLUGIN_ROOT}/skills/map/scripts/map.mjs" refresh --root <repository>
node "${CLAUDE_PLUGIN_ROOT}/skills/map/scripts/map.mjs" verify --root <repository>
```

Read `references/system-map-contract.md` before writing or reviewing a Map. The helper establishes a conservative baseline; the coordinating agent enriches only claims supported by current repository evidence.

## Modes

- `map`: create `.ctide/map/SYSTEM_MAP.md` for a missing map. For a small or medium repository, keep one index document.
- `map refresh`: rescan current evidence and replace stale generated claims. Never silently retain a source path that no longer exists. Preserve only the explicitly bounded human-verified operational section described below; surface conflicts instead of overwriting it.
- `map verify`: compare the recorded commit, source paths, confidence values, and section coverage with the current repository. Report stale, missing, conflicting, and unverified sections without modifying files.

Use `cartographer` for read-only discovery when available. The coordinating thread owns the approved Map write.

Map currently supports exactly one `.ctide/map/SYSTEM_MAP.md`; split large-repository files are not implemented, created, refreshed, or verified. Human-verified operational knowledge is writable only inside the `CTIDE:MANUAL-NOTES:START` / `CTIDE:MANUAL-NOTES:END` boundary. Refresh preserves that block verbatim. Cartographer must compare it with current evidence, report conflicts, and never overwrite it.

The deterministic helper creates a heuristic inventory baseline, not a verified finished Map. Any generated statement that says evidence is required or that Cartographer must confirm a claim must use `Confidence: unverified` and an explicit `UNVERIFIED` marker. `map verify` rejects that baseline until Cartographer replaces every placeholder with concrete, cited repository facts.

## Required coverage

Record what the system is/does in one short, plain-language description, pointing into architecture boundaries and external integrations for the supporting detail rather than restating it; repository structure and languages; package/workspace boundaries; configuration, tests, and commands; modules, responsibilities, entry points, and interfaces; important request, event, job, CLI, and user flows; stores, schemas, migrations, transactions, caches, serialized formats, ownership, and trust boundaries; external integrations; build, run, deploy, health, logs, metrics, traces, rollback, feature flags, kill switches, backup and restore; high-risk modules, destructive paths, production assumptions, missing observability, and unknowns.

Do not hand-build an exhaustive call graph. Use lean caller/callee scans only for critical symbols. An existing structural index may be queried as a lead source (`references/evidence-discovery.md`); its output never lands without file-level citation.

## Provenance schema

Every important section includes:

```text
Verified at commit: <SHA or UNBORN>
Last updated: <ISO-8601 date>
Confidence: verified | derived | unverified
Source fingerprint: sha256:<digest> | UNVERIFIED
Sources:
- path/to/file:line-or-line-range
```

The document header also records `Working tree fingerprint: sha256:<digest>`. It covers scanner-visible repository paths and content, so dirty and `UNBORN` source drift remains detectable without a commit change. Source citations must name an existing repository-relative file and a positive, in-bounds line or inclusive line range; the source fingerprint binds the cited content. Refresh recomputes both fingerprint classes.

Code-side claims require current file evidence. Mark uncertain statements `UNVERIFIED`. A commit match does not excuse working-tree drift, missing source files, invalid line ranges, or source-fingerprint drift. Vigil and Salvage must verify their touched or affected area live.

## 上游 operational readiness 吸收

`references/operational-readiness.md` 保留上游操作就緒契約的全部欄位與檢查語意。System overview 現為 Map 本身的 canonical section 之一，由 `map.mjs` 直接產生於 SYSTEM_MAP.md 最前面，不再只屬於 Ops Profile。其餘 9 個 Ops Profile 欄位（Access inventory、Rollback、Feature flags & kill switches、Backups、Breach readiness、Observability inventory、Run in isolation、External dependencies、Approvals map）由 `map create`/`map refresh` 產生預設骨架，並由 `map verify` 個別檢查缺漏欄位、仍停留在 heuristic placeholder、或信任標記格式錯誤——不再只是文件上的約定，而是實際產生與檢查的行為。Map 建立或更新 `.ctide/map/SYSTEM_MAP.md` 時必須涵蓋該契約要求；操作準備只由 Map 負責，不建立第二個 preparation skill 或指令。
