# App Launch (bringing the target runtime up for verification)

Loaded only in **`--deep` (Tier-2)** when verification needs a **live process** that is not already running — a web app for browser evidence, or a backend/API server for integration/API checks. It is the launch companion to `references/browser-evidence.md` (which assumes the app is already reachable) and `references/verification-gate.md`. Standard mode is unchanged: it never launches anything; an unreachable app stays a documented gap.

## When it applies

- **Standard mode (never launches).** ctide attaches to whatever is already running. If the app is down, that is a documented verification gap (unchanged from before) — ctide does not bring it up.
- **Tier-2 `--deep`, app not already running, and a live process is genuinely needed (UI *or* backend/API).** ctide brings the app up itself, verifies, then tears down what it started. Because `--deep` is already the explicit opt-in, this needs **no second prompt** — but ctide **discloses** that it launched the app and how. Never a hard dependency: if it cannot launch, that becomes a disclosed gap the `arbiter` weighs, never an error.

## Detect → Use → Else-Disclose

Follow the protocol in `references/external-capabilities.md`.

1. **Detect** — is the target already up? Probe the expected surface first (the dev-server URL/route responds, the API port is open, the process is already running). **If it is already running, attach — do NOT launch** (and do not tear it down afterward; you only own what you started).
2. **Use** (not reachable) — bring it up, in preference order, and record which path was used:
   - **Delegate to the built-in `/run` skill** (preferred). `/run` already resolves a project-specific launch skill if one exists, else falls back to per-stack patterns (CLI / server / TUI / Electron / browser-driven / library). ctide does **not** keep its own per-stack launch-command table — it asks `/run` to start the app and report the reachable surface (URL / port).
   - **Built dev-server preview** — a server exposing `preview_start` (e.g. `mcp__Claude_Browser__*`) when a built preview is the right surface for a web app.
   - **Documented repo run command** (fallback, only if `/run` is unavailable) — start the app's *documented* start command (README / `package.json` scripts / launch profile) in a way that leaves **no lingering child** (see *Teardown*). Do not invent a start command; if the repo documents none, treat it as the Else branch.
3. **Else** (cannot launch) — do **not** fake a live check. Disclose the exact blocker + the best local fallback (a render/component or contract test) + the remaining gap. Two distinct shapes, disclosed differently (per `references/external-capabilities.md`, *Absent vs. present-but-failing*):
   - **No launch capability** — `/run` absent and no documented start command → "could not bring the app up; verified via `<local fallback>`; live-behavior gap remains".
   - **Detected-but-could-not-execute** — a start command exists but the launch *fails* (missing config, auth, port-in-use, or a build error). This is **not** "no launch capability". Name the error and point at the fix (config / auth / env). Example: app start needs an Entra `ClientId` that isn't set, so you switched to a dev/test-auth profile to launch. When you launch under a **different auth/config profile than production**, disclose it explicitly — the live check verified the *test-auth* path, not the prod-config path. **Never silently swap profiles and present the result as if the real configuration was exercised.**

   In `--deep` + UI this is the same disclosed gap `references/browser-evidence.md` already defines; the `arbiter` weighs it and cannot reach `READY` on an unaddressed required gap.

## Teardown (own only what you started — no lingering process)

ctide owns the lifecycle of **only** the process it launched: stop it once verification completes. Leave an already-running (attached) app alone.

- Reap cleanly so nothing is left holding the output pipe — a survivor (dev server, file watcher, build server, MSBuild / `VBCSCompiler` node-reuse worker) keeps a backgrounded task stuck "running" long after it actually finished (same lesson as `references/verification-gate.md`, *Command Evidence*; for .NET use `/p:UseSharedCompilation=false /nr:false` or `MSBUILDDISABLENODEREUSE=1`).
- If `/run` started the app, stop it via the same path. If a teardown cannot be confirmed, **disclose the leftover process and how to stop it** rather than leaving it silently running.

## Who launches it (orchestrator only)

The **orchestrator / main thread** launches, drives, and tears down — never the reviewers. Reviewers stay read-only and isolated; they must not spawn processes or start the app. They only assess the distilled evidence handed to them in the Review Packet (per `references/browser-evidence.md`, *Evidence distillation*).

## Data sensitivity

Launching then driving a real, authenticated app inherits the data-sensitivity rules in `references/browser-evidence.md` (*Data sensitivity*): prefer a **non-production / disposable** target, avoid destructive interaction, and never paste secret-bearing evidence into a public report. A launch that requires production credentials is itself a strong signal to use a dev/test profile (disclosed) rather than pointing the drive at prod.

## Invariants

- **`--deep` (Tier-2) only.** Standard mode never auto-launches; this is keyed on `--deep` + a needed live process, exactly like the live-browser obligation.
- **Never a hard dependency.** No launch capability, or a launch that fails → disclose and continue; never error.
- **Own only what you started.** Attach to an already-running app and leave it running; tear down only a ctide-started process.
- **Delegate, don't hardcode.** Prefer `/run`; ctide keeps no per-stack launch-command table of its own.
- **Orchestrator launches and drives; reviewers stay read-only.**
- Language: per `SKILL.md` *Language And Text Integrity* — user-facing text follows the user's language; technical contracts verbatim.
