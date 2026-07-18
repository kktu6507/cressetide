# Browser Evidence (live UI verification via Claude in Chrome)

Loaded only when a task has **browser-visible UI changes** and verification needs live evidence. This is the live-drive companion to `references/verification-gate.md`'s *Browser Evidence* section: that section lists *what to record*; this file defines *how to actually drive a real browser* and *when it is required*.

## When it applies (two levels)

- **Standard mode (best-effort).** For any local browser-visible UI change, capture browser evidence if a browser capability is present; if not, record the exact blocker and fallback (unchanged from `references/verification-gate.md`). Absence is a documented gap, not a hard stop.
- **Tier-2 `--deep` + UI in scope (required).** When deep mode (`references/deep-mode.md`) is engaged and the change touches UI, actually driving the browser is a **required** verification step: real navigation + interaction + a screenshot of each changed state. If the web app is not already running, ctide first **brings it up** per `references/app-launch.md` (delegates to `/run`; discloses; tears down only what it started). If no live browser capability is available — or the app cannot be launched — this becomes a **disclosed verification gap** the `arbiter` weighs; it does not silently pass. Never a hard dependency: absence is disclosed, never an error.

## Detect → Use → Else-Disclose

Follow the protocol in `references/external-capabilities.md`.

1. **Detect** a live browser capability, in preference order:
   - **Chrome-extension server** (e.g. `mcp__claude-in-chrome__*`) — navigate; find / read_page / get_page_text; computer / form_input for interaction; read_console_messages; read_network_requests; screenshot. Preferred for a web app on the user's real Chrome.
   - **A server exposing `preview_start`** (e.g. `mcp__Claude_Browser__*` — preview_start / preview_navigate / preview_screenshot) when a built dev-server preview is the right surface.
   - **Playwright MCP** — `mcp__playwright__*` when a reviewer/host has it wired (headless automation).
2. **Use** the first available: first ensure the app is reachable (attach, else in `--deep` bring it up per `references/app-launch.md`) — then navigate to the changed route/screen, exercise the changed state(s), capture a screenshot, and read console + network for errors.
3. **Else** (none connected): do not claim a live check ran. Record the exact blocker, do the best local fallback (e.g. a component/render test), and disclose the gap + remaining uncertainty. In `--deep` + UI this is the disclosed gap above. If the Chrome extension is installed but cannot drive (no connected tab, permission/tier error), disclose it as **detected-but-could-not-execute, with the reason** (per `references/external-capabilities.md`), not as "not installed".

## Who drives it (reviewer independence + token economy)

The **orchestrator / main thread drives the browser during Verification** — not the reviewers. Reviewers run in isolated, read-only contexts and must not drive the user's real Chrome; they *assess* the captured evidence handed to them in the Review Packet. This preserves reviewer independence and keeps the expensive browser/MCP context in **one** place instead of fanned out to every reviewer.

## Screenshot budget (no silent caps)

- Capture **one canonical screenshot per *changed* UI state** — derive the changed states from the diff (touched routes / components / states). A *changed state* = each distinct rendered condition the diff touches (e.g. empty / error / success / focus / disabled when the change affects them), **not** one shot per component. Do **not** crawl the app or screenshot unchanged screens.
- If states were sampled (too many to capture all), say so — name what was covered and what was skipped (the "no silent caps" discipline). Never imply coverage you did not capture.
- Screenshots are **vision tokens**: capture them only in `--deep` / when `--report full` will embed them. The compact/default path stays text-only (a one-line observed-result reference, no embedded image).

## Evidence distillation (the boundary that keeps it cheap)

Capture once on the main thread, then **distill before the evidence enters the Review Packet**. Hand reviewers only:
- the screenshot **path** (not re-inlined pixels),
- the route/state and a **one-line observed result**,
- **console/network anomalies only** (errors/warnings — not the full log).

Do **not** fan raw DOM dumps or full-page vision to every reviewer — the same "filtered diff once by the orchestrator" / "filter noise, not signal" discipline applied to browser evidence. A reviewer who needs more follows the pointer (the saved path / a re-run), exactly like the filtered-diff pointer.

## Storage (kept evidence, not scratch)

Write screenshots to **`.ctide/output/evidence/`** in the *consuming* project, and **create `.ctide/output/evidence/.gitignore` (with the two lines `*` then `!.gitignore`, so the ignore file itself is committed and travels to clones/CI) as part of using it** so the screenshots are never committed. They are **kept *local* evidence**, not throwaway verification scaffolding (see the Artifact Hygiene carve-out in `references/verification-gate.md`) — but also not tracked artifacts. The same captured final-state screenshots are what `--report full` embeds (`references/final-report.md`, UI/UX evidence) — capture once, two uses. The embedded **relative links resolve only against the local working tree where capture happened**, so a report pasted into a PR / CI / fresh clone shows dangling links — treat them as local-only evidence pointers, and if the report must travel, attach the screenshots out-of-band.

## What to record

Record the fields in `references/verification-gate.md` *Browser Evidence* (target URL/route, scenario/state, observed result, tool used, screenshot path, focus/hover/keyboard/clipboard when relevant, exact blocker + fallback when it could not run). Browser evidence **supplements** automated tests; it does not replace them when automated checks are practical.

## Data sensitivity (read before pointing this at a real app)

Driving a **real, authenticated** browser is a sensitive capability — treat it like the other egress-bearing capabilities in `references/external-capabilities.md` (Codex, `ui-ux-pro-max`, observability):

- **Authenticated-session exposure.** `get_page_text` / `read_network_requests` / `read_console_messages` read whatever the logged-in session can see — session cookies, bearer tokens in requests, PII in payloads/console. Use the live drive only when that is acceptable for the app's data sensitivity, and **prefer a non-production / disposable target**.
- **Screenshots may capture secrets/PII** (token / API-key screens, OTPs, account data). **Avoid capturing secret-bearing states; redact when unavoidable.** Because `--report full` embeds these screenshots and the Evidence Record flow (`references/final-report.md`) pastes the report into PRs / issues, an embedded screenshot **inherits the report's distribution** — a sensitive screenshot leaks into a public PR even when the file itself is gitignored. **Do not paste a `--report full` containing sensitive screenshots into a public PR / issue.**
- **No destructive interaction.** Live interaction (`computer` / `form_input`) is a real side-effect on live data. **Avoid destructive / irreversible actions** (submit / delete / send / pay); prefer non-mutating navigation and reads, or use a disposable / non-production target — the read-only-reviewer spirit extends to not mutating the user's live data during verification.

## Invariants

- Never a hard dependency: no browser capability → disclose and continue; never error.
- **Available means mandatory in `--deep` + UI.** When a live browser capability is detected and reachable (a connected tab is present), the live drive is a required step you must actually run — it may be downgraded to a disclosed gap **only** when the capability is genuinely *unavailable* (Detect failed, or detected-but-could-not-execute with the recorded reason, per `references/external-capabilities.md`). You may **not** skip a runnable live drive by assuming the user will self-verify, or by letting reviewers infer visual correctness from CSS/markup — neither establishes the rendered result, and "the user will verify" is a `deferred` status that requires the user's explicit, verbatim-recorded consent (see `agents/arbiter.agent.md`), never an inferred one.
- This drives a real authenticated browser and stores screenshots — treat the session reads and the captured images as **sensitive** (see *Data sensitivity* above); never paste sensitive evidence into a public report.
- Reviewers stay read-only and isolated; only the main thread drives the browser.
- Vision cost stays in `--deep` / `--report full`; the compact path is text-only.
- Language: per `SKILL.md` *Language And Text Integrity* — user-facing text follows the user's language; technical contracts verbatim.
- A disclosed live-drive gap renders in the final report as the `Live-verification gap` field (`references/final-report.md`) — see there for the exact wording and placement.
