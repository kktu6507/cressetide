# FAILURE_MEMORY

Reusable failure lessons. Newest first. **This is a committed eval fixture**, not a real incident log —
it seeds the deterministic retrieval oracle (`test/failure-retrieve.test.mjs`). Each entry has an
unambiguous tag/area so a task signature can be expected to surface exactly one of them.

## Entry Template

### <YYYY-MM-DD> — <short title>
- **Prevention rule**: placeholder.
- **Tags**: lang / area / type.

## Entries

### 2026-06-24 — `pytest` failed: mutable default argument shared across calls
- **Context / intended method**: add a helper with a `def f(items=[])` default to collect results.
- **What blocked it**: the second call saw the first call's items — the default list is created once and shared.
- **Root cause**: a mutable default argument is evaluated at definition time, not per call.
- **Fix applied**: default to `None` and create the list inside the function.
- **Prevention rule**: never use a mutable default argument; default to `None` and allocate inside.
- **Tags**: python / functions / mutable-default.
- **Scope**: cross-project.
- **Recurrence**: first occurrence.

### 2026-06-18 — `npm test` failed: jsdom not installed in CI
- **Context / intended method**: run the unit suite via `npm test` to verify a login-form change.
- **What blocked it**: tests aborted with `Cannot find module 'jsdom'` after a clean install.
- **Root cause**: `jsdom` was a transitive dev dependency, never declared, so `npm ci` did not install it.
- **Fix applied**: added `jsdom` to `devDependencies` and pinned it; `npm ci && npm test` then passed.
- **Prevention rule**: any test-only runtime dependency must be an explicit `devDependency`; verify with a clean `npm ci`.
- **Tags**: node / dependencies / ci-test-failure.
- **Scope**: project-specific.
- **Recurrence**: seen again 2026-06-21 (different repo) — confirms the cross-project shape.

### 2026-06-12 — Build broke on Windows due to hardcoded `/` paths
- **Context / intended method**: run a build script that concatenated output paths with `"dist/" + name`.
- **What blocked it**: the build wrote to the wrong location on Windows; a downstream step lost the artifact.
- **Root cause**: the path used a hardcoded POSIX separator instead of the platform path API.
- **Fix applied**: switched to `path.join` so separators are correct on every OS.
- **Prevention rule**: never hardcode path separators; always join paths via the platform/path API.
- **Tags**: cross-language / build-tooling / cross-platform-path.
- **Scope**: cross-project.
- **Recurrence**: first occurrence.

### 2026-06-05 — Go nil-map write panicked before the length check
- **Context / intended method**: populate a result map returned from a helper that could return `nil`.
- **What blocked it**: a write to the `nil` map panicked at runtime before any length guard ran.
- **Root cause**: a `nil` map is readable but writes panic; the helper never initialized it on the empty path.
- **Fix applied**: initialize with `make(map[...]...)` before writing; guard the helper's empty return.
- **Prevention rule**: initialize a map with `make` before writing; a `nil` map only supports reads.
- **Tags**: go / maps / nil-panic.
- **Scope**: project-specific.
- **Recurrence**: first occurrence.

### 2026-05-30 — `forEach(async …)` did not await — writes raced (superseded by 2026-06-24 async rule)
- **Context / intended method**: persist items inside `array.forEach(async (x) => await save(x))`.
- **What blocked it**: the loop returned before the awaits settled; later code saw partial writes.
- **Root cause**: `forEach` ignores the returned promise, so the awaits are not sequenced.
- **Fix applied**: switched to a `for…of` loop with `await`.
- **Prevention rule**: never pass an async callback to `forEach`; use `for…of` with `await` to sequence.
- **Tags**: javascript / async / foreach-await.
- **Scope**: cross-project.
- **Recurrence**: first occurrence.
