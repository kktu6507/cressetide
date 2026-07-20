# Test Layer Boundaries (unit / integration / E2E)

`references/verification-gate.md` requires a demonstrated red→green test per behavior-changing
acceptance criterion; it does not say which layer that test lives at. Load this reference when
choosing, or reviewing, the layer (unit / integration / E2E) for a given criterion — most single-
criterion changes need exactly one obvious layer, so this is a judgment aid for the non-obvious
cases, not a mandatory three-layer checklist for every change.

## The three layers

- **Unit.** Verifies one function/class/module's own logic in isolation — branching, boundary
  values, error handling, pure transformations. Should NOT verify wiring between modules, real
  I/O, or framework behavior. **Mocking boundary:** mock everything outside the unit under test
  (collaborators, I/O, network, clock); mocking part of the subject under test itself is a smell —
  usually the unit is doing too much. Cheapest and fastest; the bulk of a change's coverage belongs
  here. No coverage on changed logic here is a verification gap (`references/verification-gate.md`).
- **Integration.** Verifies that two or more real components actually agree at their boundary — a
  repository against a real/disposable database, a client against a real handler, a producer against
  a consumer's real deserialization. Should NOT re-verify either side's internal branching (unit's
  job) or drive a full UI. **Mocking boundary:** mock only what is genuinely external to the system
  under test (a third-party API, a paid service, a non-deterministic clock) — mocking the component
  on the far side of the boundary under test defeats the layer's purpose; this is exactly the
  boundary-mismatch class `references/review-packet.md`'s "read both sides of a crossed contract"
  lens exists to catch.
- **E2E.** Verifies a real user-/client-observable flow through the assembled system — a browser
  driving the real UI (`references/browser-evidence.md`), or a black-box call through the real
  running stack. Should NOT enumerate business-rule edge cases (slow and flaky per case; that is
  unit/integration's job) — its job is confirming the assembled system behaves for a scenario a user
  actually takes. **Mocking boundary:** as close to nothing as the environment allows; a mocked E2E
  test is usually a mislabeled integration test. Slowest and priciest to write, run, and keep stable
  — spend it on the handful of flows that truly must work end-to-end.

## Decision heuristics

Pick the **lowest** layer that can actually falsify the behavior; a higher layer catching the same
defect is not "more thorough," it is slower and flakier for no added signal:

- A business rule, calculation, validation, or branch inside one component → **unit**. If a unit
  test can force the input and assert the output, stop there — a higher layer merely *executing*
  the code path does not exercise the surrounding input space (the risky-inputs list,
  `references/verification-gate.md`).
- "These two real things agree" — a schema round-trip, a producer/consumer contract, an API a
  caller depends on, an interface a large/breaking change restructures
  (`references/expand-migrate-contract.md`) → **integration**.
- Only observable by actually driving the assembled system as a user/client would → **E2E**;
  follow `references/browser-evidence.md` for the live-drive protocol when it is a browser.
- A criterion spanning a real boundary usually needs **both**: integration for the seam, unit for
  the business logic on either side — not duplication, each catches a defect class the other cannot.
- When unsure, prefer the lower layer; add a higher one only when the lower layer provably cannot
  falsify the behavior (e.g. the defect only manifests in real network/serialization behavior a mock
  would hide). Reaching for E2E by default is exactly what usability-over-strictness weighs against
  when a faster layer already proves it.

## Ecosystem guidance

- **Python.** `pytest` covers unit and integration in one runner: fixtures/`monkeypatch` hold the
  unit mocking boundary; integration uses a real or disposable (e.g. `testcontainers`-style)
  dependency, never a mocked one. Markers (`@pytest.mark.integration`, `pytest -m integration`)
  separate the two so unit stays fast in the inner loop. E2E: browser-driven (`references/browser-evidence.md`) or a
  black-box HTTP client (`httpx`/`requests`) against a real running instance — not the app's own
  in-process test client, which proves wiring, not deployed behavior. `ruff`/`mypy` (or repo
  convention) is a separate, non-substituting check, per `references/verification-gate.md`'s Command
  Evidence.
- **TypeScript / JavaScript.** Unit: the repo's configured runner (`vitest`/`jest`/`node --test`)
  with everything external mocked (`vi.mock`/`jest.mock`, or manual doubles for `node --test`).
  Integration: the same runner against a real adjacent system (a test DB/container, real route
  handlers via `supertest`-style requests) — not a mocked stand-in for the thing under test. E2E:
  Playwright/Cypress, or `references/browser-evidence.md`'s live-drive protocol against a live Chrome
  session — reserve it for flows that must work end-to-end, not per-criterion coverage.
- Other stacks follow the same three-way split with their own idiomatic tools (see
  `references/verification-gate.md`'s Command Evidence list for the common ones per stack); the
  boundary logic above is stack-agnostic.

## Interaction with the fail-first→pass requirement

This reference governs **where** the per-criterion red→green test lives, never **whether** it
exists. Choosing integration over unit does not relax `references/verification-gate.md`'s
requirement — it only changes which layer's runner produces the red→green transition. A criterion
with no red→green at any layer is still `unmet` (`agents/arbiter.agent.md`, *Acceptance-criteria
check*), however reasonable the chosen layer was.

## Interaction with review

`test-reviewer` owns whether the chosen layer(s) actually cover the criterion
(`agents/test-reviewer.agent.md`); a criterion "tested" only at a layer too coarse to exercise its
edge inputs (e.g. only E2E for a numeric-boundary rule) is the same gap class as no test at all —
file it as a missing-test finding, not a layer-mismatch nitpick. The `arbiter`'s bidirectional
traceability (criterion ↔ verifying test, `agents/arbiter.agent.md`) does not care which layer the
test lives at, only that the mapping is real and the test was confirmed red before the change.

## Invariants

- **Never a hard dependency.** Most single-criterion changes need one obvious layer; do not force a
  three-layer matrix onto a small, contained change.
- **Lowest falsifying layer wins.** A higher layer is not "more rigorous" when a lower one already
  falsifies the same behavior — it is slower and flakier for identical signal.
- **The mocking boundary defines the layer, not a style choice.** Get it backwards (mock the thing a
  layer exists to exercise) and the layer goes blind to the exact defect class it was chosen for.
- **Where, never whether.** The fail-first→pass-per-acceptance-criterion rule in
  `references/verification-gate.md` is unchanged; this reference only routes the test to a layer.
