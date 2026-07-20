# Repro and fix (stages 5–6, data repair, production re-entry)

Loaded when diagnosis lands in the code or data fault domain, or when any fix is ready to go back to production.

## Declare the fixed-check before fixing

Before anyone touches a fix, write in the journal the observable check that will prove the incident is fixed:

- code / data bugs → a red→green reproduction (below);
- config / infra faults → an observable health check that is currently failing and must turn green (a named metric, endpoint, or certificate date).

A fix without a pre-declared check ends in "it seems fine now" — which is how incidents reopen.

## Stage 5 — Reproduce (code and data domains)

Keep trigger vs root cause distinct from the start, not only in the postmortem (`references/reentry-and-closure.md`, *Trigger vs root cause*): the deploy that exposed the bug is not necessarily what caused it; diagnosing toward the trigger and stopping there fixes the symptom, not the disease.

Three fidelity tiers — prefer the cheapest one that captures the bug:

1. **Function/unit-level repro** with the failing input (fastest; the default).
2. **Local app run**, using the profile's run-in-isolation recipe.
3. **Staging**, when the bug needs real infrastructure shape.

**Isolate the cause before fixing.** A reproduction proves the bug exists; it does not by itself show
why. Narrow from the repro to the specific cause:

- **Bisect** — `git bisect` (or an equivalent binary search over recent history) when a range of
  changes is suspect, to the commit that introduced the bug.
- **Narrow the input/log space** — binary-search the failing input (which field, which record) or the
  log/request window (which request, which timestamp) down to the smallest case that still reproduces.
- **Single-variable instrumentation** — change or log ONE variable at a time and observe; changing
  several at once cannot tell you which one mattered.

**Hypothesize, then test the hypothesis before fixing.** From the narrowed evidence, propose 3–5
falsifiable candidate causes, then verify the leading one (a targeted log, an instrumented run, a
bisect step) BEFORE writing the fix — a fix aimed at the wrong cause reopens the incident.

**Red evidence is mandatory.** Run the repro BEFORE the fix and record the failing output in the journal. A repro that was never seen red proves nothing — an always-green check is a known trap. This mirrors the dev flow's red→green discipline.

## Production-data safety gate

When the repro needs real data:

- **Minimal extraction** — only the records implicated by the evidence; never a DB dump.
- **One-way flow** — pull data out into an isolated scratch area; never experiment inside production.
- **Sanitization gate** — mask PII and secrets BEFORE the data enters the AI context or any test fixture. Concretely: the extraction command writes straight to a file in the isolated scratch area via shell redirection (the query's raw output is never echoed into the conversation or tool output), masking runs as a small script over that file (schema/pattern-driven — prefer a maintained secret/PII pattern set over improvised regex; see the named tools in `references/reentry-and-closure.md`), and only the MASKED sample is read back into context — shown to the user for approval (decision card).
- **Policy switch** — if the org forbids production data entirely, build synthetic data shaped like the real records instead.
- **Ephemeral handling** — extracted data lives in an isolated temp location, is never committed, and is deleted at incident closure — or immediately when the incident is abandoned or goes inactive, whichever comes first. Anything archived as a permanent regression test must be the sanitized or synthetic version.

## Stage 6 — Fix (handoff to the dev flow)

The incident skill does not implement the fix itself. State to the model: **"Start the `vigil` workflow for this fix task, passing `--lite`"**, with "the incident repro turns green" as the primary acceptance criterion, plus the sanitized evidence and the fault-domain diagnosis as input.

- Caveat, verbatim from the dev flow: `--lite` keeps a directly-relevant safety reviewer when a genuine high-risk signal is present (see `../../vigil/references/reviewer-selection.md`, Lite path). Incident fixes frequently carry high-risk signals — auth, data integrity, destructive paths — so expect the safety floor to apply.
- The incident skill never asserts the dev flow's verdict itself and never emits its machine sentinels; it waits for the arbiter's readiness verdict (ready / fix-required / not-ready) from that run and records the outcome in the journal.

## Cannot reproduce — honest degradation

Say so plainly; do not fake confidence. Then:

1. strengthen observability around the suspect path (targeted logs/metrics) so the next occurrence is diagnosable;
2. ship the best-hypothesis fix through the same dev-flow handoff;
3. roll out gradually — canary or a small percentage, per the profile's deploy options;
4. watch the new signals through the observation window.

The journal explicitly marks it: "fix not repro-verified — lower confidence."

## Data repair (conditional — when corruption happened)

The code fix stops new corruption; it does not repair the damage already done. Closure requires data repaired, not just code fixed.

1. **Corruption window** — establish it from the journal timeline: first bad write → mitigation stopped the writes.
2. **Affected records** — identify rows/records via the profile's read-only DB access; record the counts.
3. **Repair source** — backup restore, recompute from surviving data, or manual entry; choose against the profile's backup reality.
4. **Repair script** — write it, then verify it on an extracted COPY first: red→green on the copy (before-state provably wrong, after-state provably correct).
5. **Decision card** — row counts, repair source, reversibility (is there a pre-repair snapshot?). Only a human-approved run touches production.
6. **Completeness check** — after the approved run, prove the repair was *complete*, not just correct: reconcile the number of records the repair actually touched against the affected-record count from step 2, or re-run the read-only query that first identified the corruption and confirm it now returns zero. Step 4 proved the script's logic on a copy; this proves every affected row in production was reached. A mismatch reopens the repair — it does not close it.
7. **Journal everything** — the script, the counts, the completeness result, the approval, the outcome.

## Production re-entry

- When a code or data fix exists, deploy it through the profile's NORMAL deploy path — never invent a bespoke emergency deploy pipeline during an incident. Config / infra / external-dependency domains may have nothing to deploy — the remediation itself is the change; the declared fixed-check and the observation window below still apply in full.
- Verify in production: run the declared fixed-check, and where possible re-run the original failing scenario read-only.
- **Observation window** — watch error rates for a defined period before declaring stable; agree on the length via a card (for a SEV1, think 30–60 minutes, not 30 seconds).
- Restore mitigations **one at a time**, each followed by a recovery check: re-enable flags, lift maintenance mode, scale back down. One at a time for the same reason as stage 3 — attribution.
