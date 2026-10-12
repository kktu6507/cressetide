# Reviewer-output trial: terminated on a quality stop

The phase30 reviewer-output comparison was **stopped by its own frozen quality rule** after ten
actual role calls, on two faults in the candidate arm's third-case review. The candidate is archived
**partially tested / not adopted**. No saving and no efficacy conclusion follows, and **no
prompt-caused comparative regression is established** — two quality faults were observed in the
candidate arm's third case and are the reason for the stop, but their attribution to the appended
guidance is unestablished in either direction. The comparison never reached a result, and its cost
figures are not a comparison outcome.

The candidate was the shipped `cressetide/agents/code-reviewer.agent.md` plus one appended paragraph
in `## Required output`, permitting a role field whose substance is already stated to give its
disposition plus a **specific** pointer instead of restating evidence, while forbidding omission and
bare "see above". **No distributed byte was ever changed.** The candidate lives only in
`.ctide/collaboration/phase30-code-reviewer-candidate.agent.md`.

## The two stopping faults

**1 — an unsafe method substitution (candidate, case 3).** The fixture intent is explicit about the
verb: *"`isUp(url)` returns true iff **a GET** to `url` succeeds with HTTP 200."* The candidate
review offered, in Analysis, *"The idiomatic fix is `io.Copy(io.Discard, resp.Body)` before `Close`,
or a `HEAD` request"*, and in its findings index *"…or use `http.Head`"* — presenting the two as
interchangeable remedies for the same `minor`.

They are not interchangeable. Draining preserves the predicate; HEAD may invert it. Root ran a local
HTTP counterexample — a real server answering **GET 200 / HEAD 405** — so the substitution flips the
function's result from `true` to `false` on a class of real servers. (That counterexample exercises
HTTP method handling in Node; it is **not** an execution of the Go fixture.)

*Strongest counterargument, and why it fails.* HEAD may well be appropriate for a *generic* liveness
probe; the suggestion was attached to a `minor` and demoted to "optional polish"; and the excerpt
supplies no server, with undefined externals to be treated as correct. But this contract does not
describe a generic probe — it explicitly requires GET, and the counterexample showed the result
flip. Severity cannot rescue that, because the objection is not that the change is too aggressive —
it is that the change is **not equivalent to the remedy it is offered as an alternative to**. It also
runs against the reviewer file's own Core standard: *"Preserve intended business logic unless the
current implementation is clearly incorrect, unsafe, or materially hard to maintain."* The change is
silent in kind: it can alter the predicate's value without changing the function's signature or its
`bool` return type, so the divergence would surface only as a wrong answer at runtime.

**2 — an unobserved build claim (candidate, case 3).** `## Minimum diligence` states: *"never assert
\"compiles/passes\" you did not see."* The candidate review wrote: *"No lint/typecheck/build summary
line was supplied in the packet and I ran none, so I assert nothing about whether this builds clean
(it does compile — this is a runtime fault, not a type error)."* That disclaims and asserts inside
one sentence.

The distinction that matters is between **correctness of the reasoning** and **compliance with the
evidence rule**. Characterising the defect as a runtime fault rather than a type error is correct and
useful source-level reasoning; the compliant form was available at zero cost by dropping the
parenthetical. The rule is about the provenance of a claim, not its truth. Additionally, the artifact
the reviewer read is a bare function with no `package` clause and no `import` — the review itself
confirms the on-disk copy matches the excerpt byte-for-byte — so the file as given would not build,
and the assertion is not safely true even on its own terms.

## What was actually run

| | Reviewer calls | Judge calls | Reviewer estimate | All-calls estimate |
|---|---:|---:|---:|---:|
| A (original) | 3 | 2 | US$0.485406 | US$0.588318 |
| B (candidate) | 3 | 2 | US$0.453834 | US$0.557123 |
| **Total** | **6** | **4** | — | **US$1.145441** |

Three reviewer pairs (cases 01, 02, 03); two pairs independently judged; **all four completed judges
returned hit/pass**. Case 3 retained both reviewer outputs and was **not** judged. Confirmation:
**0 calls** — the held-out package remains sealed at
`5d64c6b34b967e3d361f4911f0d14fc13cd53811197d9007d05acd5187e7342f`, unexposed to the candidate
author. Root's receipt re-derived every raw stream, manifest, source hash and cost:
`mechanicalEvidenceConsistent: true`, `faults: []`, all **123 protected sources unchanged**.

**The cost figures are not a result.** Four hit/pass grades across two of seven cases are not a
completed seven-case outcome, `reviewerEconomicDecision` is recorded as *unavailable*, and the
per-arm totals must not be read as a saving in either direction. Estimates use the pinned CLI price
table — not billing, not a subscription charge — and are separate from the closed pilot's
US$4.4346125 and phase28's US$0.518038. All collaboration sessions are excluded from every figure
here.

## Verification scope — read this precisely

Existing driver and parser tests passed **89/89**, and the root orchestrator's syntax check passed.
**No full product regression was required or run, because no distributed byte changed.** The 89
focused tests do **not** stand in for, replace or refresh the historical full Windows regression
(126 files, 2,132 tests, 2,120 passes, 12 skips, zero failures), which remains a separate receipt
covering a different scope at a different time.

## Errata against earlier working notes

- **Arm attribution.** The correct per-arm record is: A case 1 Express runtime extras (explicitly
  severed from its own core finding); **B** case 2 broad linter assertion; A case 3 unsupported
  "caller has no way to bound it". An earlier Claude note aggregated these as a "3/3 baseline"
  pattern by misattributing the case-2 item to A. **No such rate exists**, and no frequency or
  apparatus-power conclusion is drawn from a three-case partial trial plus a design screen.
- **Attribution of the stop.** The two faults occurred in the Analysis channel and findings index,
  which the appended paragraph does not govern. That fact **neither establishes independence nor
  makes causal influence doubtful** — a system instruction can affect a whole response. Attribution
  to the candidate text is simply **unestablished**, in both directions. An earlier Claude note
  called it "affirmatively doubtful"; that phrasing is withdrawn.
- **Required-output completeness.** `## Required output` and its four-item list already require all
  four fields. The phrase *"without an explicit completeness requirement"* in the frozen
  `phase30-obligation-map.md` is **withdrawn as a normative reading** and corrected here rather than
  by editing that file, so its launch hash stays valid. Consequently the baseline's observed field
  omissions in cases 01, 02 and 04 are **non-compliance with the existing contract**, not
  beyond-spec extra work by the candidate.
- **No missing-policy claim.** Earlier Claude notes said no rule requires a proposed fix to preserve
  the stated contract and none forbids unsupported negatives about unseen code. Both are too broad
  and are withdrawn. Core standards already require preserving intended business logic;
  `reviewer-common.md`'s admission and omission discipline already require a falsifiable claim, an
  anchor, the confirmation performed, reading both sides of a crossed contract, and grep-verifying
  before asserting an omission; `## Minimum diligence` already forbids unobserved compile claims.
  **These are response-level failures to follow existing guidance, not evidence of missing policy**,
  and **no quality-contract amendment is authorised or proposed.** Nothing here fixes model
  behaviour; the findings are recorded, not remediated.
- **Prior grades.** The historical 5/5 hit and 2/2 clean-control result remains seed-rubric evidence
  only. It measured defect detection and false-positive avoidance; it never established output
  completeness or advice safety.
- The baseline's case-3 timeout `major` has a plausible named resource mechanism, an unsupported
  "caller has no way to bound it" clause and debatable severity. It is recorded as reasoned in the
  read-only discussion and was **not** made a preservation target for the candidate.

## Stage disposition

Two L2 hypotheses have now been carried to a definite end: the input-duplication candidate was
**retired at design** — the built two-pair candidate measured **15 bytes of 7,877, 0.19%**, below any
threshold worth paying to measure — and this output-restatement candidate was **terminated by the
quality stop**. There is **no measured avoidable economic cause and no accepted optimization**. L3
confirmation was not executed because the quality stop preceded it; eligible closed-task history
remains unavailable. For this candidate the scoped L4 decision is final: **do not adopt; retain the
original**. The original whole-workflow default-benefit decision remains **unexecuted**.

**The efficiency roadmap is not complete.** Native-activation and full-flow cost/control
observations remain missing, and no skipped gate is marked passed. The old L1a measurement-limit
exit stays closed on its original terms.

## Remaining branches

**Executable now, without new data and without a new harness:**

- Record the observed reviewer-output findings as findings — four distinct response-level failures to
  follow existing guidance (unsafe non-equivalent remedy; unobserved build claim; unsupported
  negative about unseen code; required role fields omitted in three of seven historical outputs).
  Recording is not remediation and implies no prompt change.
- Complete the retain/close bookkeeping for this candidate and its two frozen private snapshots.

**Blocked on inputs that do not exist yet:**

- Any real-world net-benefit claim, and L3's real-world branch, need eligible closed-task history or
  a genuine upcoming development task. Neither is available.

**Available but deliberately not proposed here:** a native-activation or full-flow observation is
technically runnable and would need its own prospective design, grader and budget. It would produce
synthetic full-flow numbers and still could not answer the real-world question, so it is recorded as
an open option rather than a recommendation. No further single-role cost variant is proposed, no
generic harness is proposed, and no effective compression is promised.

## Sources

- Receipt (byte copy of `phase30-partial-audit.json`):
  [`2026-09-09-reviewer-output-trial-evidence.json`](2026-09-09-reviewer-output-trial-evidence.json)
- Root audit, protocol, pre-launch acceptance, candidate, obligation map, retained case-3 reviews and
  the HTTP counterexample: `.ctide/collaboration/phase30-partial-audit.json`,
  `phase30-prospective-protocol.md`, `phase30-prelaunch-acceptance.md`,
  `phase30-code-reviewer-candidate.agent.md`, `phase30-obligation-map.md`,
  `phase30-case3-A-review.txt`, `phase30-case3-B-review.txt`,
  `phase30-get-head-counterexample.mjs` / `.json`
- Retired input candidate (unlaunched): `phase29-code-reviewer-candidate.agent.md`,
  `phase29-obligation-map.md`
- Fixture: `eval/fixtures/03-go-nil-before-check.md`
- Prior closed work: [exploratory disposition](2026-09-09-efficiency-exploratory-disposition.md),
  [plan-review live capability](2026-09-09-plan-review-live-capability-codex-review.md)
