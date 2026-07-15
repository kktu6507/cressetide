# Closure (stage 7): checklist, journal schema, postmortem, failure memory

Loaded when mitigations are holding and the fix or remediation is in place — or whenever the user asks to wrap up.

## Closure checklist (all required)

An incident is closed only when every line holds. This prevents the permanent-degraded-state failure mode — flags left off, maintenance mode forgotten, damaged data quietly kept:

- [ ] fix deployed, if a code or data fix exists (config / infra / external-dependency remediation may have nothing deployable)
- [ ] production-verified — the declared fixed-check ran green in production (required for every fault domain)
- [ ] observation window passed without regression
- [ ] all mitigations restored — flags back on, maintenance mode lifted, scaled back to normal
- [ ] data repaired, verified, and completeness-checked, if corruption occurred
- [ ] extracted production data deleted (the ephemeral-handling promise from `references/reproduction-and-repair.md`)
- [ ] postmortem written
- [ ] postmortem reviewed — a human has read and approved it (its gate-gap analysis and the FAILURE_MEMORY entry it proposes), and its action items have named owners and a tracked home (an issue/ticket id, or the FAILURE_MEMORY entry for a prevention rule)
- [ ] journal status flipped to `closed`

## Journal schema

One journal per incident at `.ctide/incidents/INCIDENT-<YYYYMMDD>-<slug>.md`. Every stage appends. Sanitization discipline, restated: nothing unmasked enters the journal — it is committed to git as the audit trail, so mask PII and secrets before writing, always. Before the journal (or a postmortem file) is committed, run a deterministic redaction pass — a secret/PII pattern scan (keys, tokens, passwords, emails, card-like numbers) over the file; agent judgment alone is not sufficient for a committed audit trail. Prefer a maintained pattern set over improvised regex — a secrets scanner such as gitleaks (MIT) or detect-secrets (Apache-2.0) for keys and tokens, and Microsoft Presidio (MIT) for PII such as emails, card numbers, and national IDs (scope the PII detector to those fields, so it does not strip the `approved by:` ownership the audit trail must keep); when the tool for either axis is unavailable, fall back to an explicit built-in pattern list for that axis and disclose it — the pass always covers both secrets and PII. Naming a tool is guidance, not a hard dependency — the redaction pass runs regardless of which tool backs it. At closure, offer to commit it.

~~~markdown
# INCIDENT-<YYYYMMDD>-<slug>

- Status: open | mitigated | closed
- Severity: SEV1 | SEV2 | SEV3
- Started: <timestamp> — Detected: <timestamp>
- Mitigated: <timestamp> — Resolved: <timestamp>
- Systems affected: <list>
- Current owner: <who>

## Timeline
- <timestamp> — <event / observation / action>

## Actions log
- <timestamp> — <what was done> — approved by: <who> (card: "<quoted decision-card text>") — result: <outcome>

## Evidence
- <sanitized log excerpt / exact error message>
- Fuller raw evidence (if retained): <where it lives, outside the repo>

## Fixed-check
- Declared: <the check, written before fixing>
- Red: <timestamp + failing output>
- Green: <timestamp + passing output>

## Closure checklist
- <the closure checklist above, with per-line state>
~~~

## Postmortem

Append it to the journal, or write a sibling file next to it. Factual, blame-free, short:

- **Trigger vs root cause** — distinguish them: the deploy was the trigger; the unvalidated input handling was the root cause.
- **Detection gap** — how long from start to noticed, and why: no alert, an ignored alert, no metric at all?
- **What went well / what went poorly** — two or three honest bullets each.
- **Gate-gap analysis** — the ctide-specific question: *which dev-flow gate SHOULD have caught this before ship?* A reviewer lens missing from the panel? The verification gate (a required check that never ran)? A missing acceptance criterion? An ops-profile red flag that was recorded and then ignored? Answer with a concrete, one-sentence prevention rule — not "be more careful".

**Blame-free ≠ anonymous.** Blame-free is about tone and causal framing, not erasing who did what — the actions log still records `approved by: <who>` for every action (factual ownership). This follows Google SRE's blameless model, which separates blame-toned narrative from the factual ownership fields an audit trail needs; it is accountability, not blame.

**Review before closing.** An unreviewed postmortem barely counts — the gate-gap analysis and the prevention rule it proposes are the entire point, and a human confirms or corrects them before the incident closes (the closure checklist's `postmortem reviewed` line). Authoring is not approval.

## Failure-memory closure loop

From the postmortem, PROPOSE a failure-memory entry — context, what broke, root cause, fix, prevention rule, tags — using the exact template in `../../../examples/FAILURE_MEMORY.sample.md` (or the target file's own Entry Template when it already defines one).

- The MAIN THREAD is the single writer to `.ctide/memory/FAILURE_MEMORY.md`. Never write it from a subagent — mirror vigil's single-writer rule (`../../vigil/references/verification-gate.md`, Failure Memory).
- The entry's prevention rule is what the dev flow's planning step reads before the next change: the incident feeds the exact gate that should have caught it. This loop is the point of the postmortem — without it, the lesson evaporates when the session ends.

## Lightweight comms

The journal's timeline makes stakeholder status updates a copy-edit, not a writing task. Offer to draft one, matched to the audience (internal versus customer-facing). No status-page automation — publishing an update stays a human action. For a breach or data-exposure incident, a legally-required notification is not a routine status update: the decision to notify, and the notification itself, escalate to the named legal/privacy owner (`../../map/references/operational-readiness.md`, Breach readiness) — the agent may draft factual material for that owner's review, but it never decides or sends the notification itself.
