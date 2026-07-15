# FAILURE_MEMORY

Reusable failure lessons. Newest first. Keep entries concise and prevention-oriented.

> This is a **sample** file showing the expected shape. It is not a real incident log.
> Copy this structure to `.ctide/memory/FAILURE_MEMORY.md` (project) or `~/.claude/FAILURE_MEMORY.md` (global)
> the first time an entry is needed. See `skills/vigil/references/verification-gate.md`
> for the read/write rules.
>
> To **retire** a lesson, append `(expired)` (the prerequisite behind a one-time failure is resolved) or
> `(superseded by <date / short title>)` (a newer rule replaced it) to the **end of its `###` title** — the
> SessionStart digest then skips it, so a stale lesson stops surfacing even before consolidation deletes it.

## Entry Template

### <YYYY-MM-DD> — <short title>
- **Context / intended method**: what was being attempted and the original approach that could not proceed.
- **What blocked it**: the abnormality, error, or rejection (command, runtime, tool, encoding, reviewer blocker, etc.).
- **Root cause**: why it actually failed.
- **Fix applied**: what made the repaired path valid.
- **Prevention rule**: the reusable rule that avoids this next time.
- **Tags**: language / area / error-type (used by the startup digest and targeted retrieval).
- **Scope**: project-specific or cross-project.
- **Recurrence**: note and increment if this lesson recurs (e.g. "seen again 2026-06-19").

---

## Example entries

### 2026-06-18 — `npm test` failed: jsdom not installed in CI
- **Context / intended method**: run the existing unit suite via `npm test` to verify a login-form change.
- **What blocked it**: tests aborted with `Cannot find module 'jsdom'`; the package was a transitive dev dependency missing after a clean install.
- **Root cause**: `jsdom` was relied on implicitly but never declared in `devDependencies`, so a clean `npm ci` did not install it.
- **Fix applied**: added `jsdom` to `devDependencies` and pinned it; `npm ci && npm test` then passed.
- **Prevention rule**: any test-only runtime dependency must be an explicit `devDependency`; verify with a clean `npm ci`, not an incremental install.
- **Tags**: node / dependencies / ci-test-failure.
- **Scope**: project-specific.
- **Recurrence**: first occurrence.

### 2026-06-12 — Build broke on Windows due to hardcoded `/` paths
- **Context / intended method**: run the build script that concatenated output paths with `"dist/" + name`.
- **What blocked it**: the build wrote to the wrong location on Windows and a downstream step could not find the artifact.
- **Root cause**: path was assembled with a hardcoded POSIX separator instead of the platform path API.
- **Fix applied**: switched to the platform path join (`path.join`) so separators are correct on every OS.
- **Prevention rule**: never hardcode path separators; always join paths via the platform/path API. Applies to any cross-platform tooling.
- **Tags**: cross-language / build-tooling / cross-platform-path.
- **Scope**: cross-project.
- **Recurrence**: seen again 2026-06-15 (different repo) — confirms the cross-project prevention rule.
