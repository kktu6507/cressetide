# Plan-review feasibility: independent acceptance

Accepted on Windows for the private offline protocol only, 2026-09-09. This completes the phase27 capability repair, not the efficiency roadmap, a product optimization, native Vigil integration, or a model-effectiveness experiment.

Subsequent phase28 work added declared-origin metadata in two source files and completed a separately frozen live capability observation; see the [live acceptance](2026-09-09-plan-review-live-capability-codex-review.md). This phase27 receipt retains its original source hashes and test counts; its exact three accepted files are archived under `.ctide/collaboration/phase27-accepted/` rather than retroactively relabeled.

The driver now represents fresh plan → reviewer findings → separate read-only opinion → reviewer resolution → revised plan → approval of the latest exact plan → implementation carrying that plan and resolution in actual stdin. It does not decide whether an opinion is persuasive or whether the implemented behavior is correct; those judgments remain external.

## Discussion before correction

Codex planned and independently verified; real Claude Code implemented using requested `claude-opus-5` / `xhigh`. The completed collaboration results identify only Opus5 model usage. Effort is requested configuration, not independently observed runtime metadata.

| Evidence | Review outcome and subsequent authorization |
|---|---|
| phase27a/b/c | Read-only design discussion before separate phase27d implementation GO. |
| phase27e | Root reproduced corrupt prior raw still authorizing implementation, ambiguous failure replay, unapproved source drift, and illegal history transitions. The nonempty-root case preserved existing content; an overwrite was **not** confirmed. |
| phase27f → phase27g | Claude agreed and explained that authorization bypassed the replay verifier. Separate GO authorized the shared reducer, transition validation, preflight and per-call identity repair. |
| phase27h/i | Initial 20 independent checks passed, then four further source-review concerns were reproduced: noncanonical historical config with matching copied hashes, unvalidated final prompt digest, stale current-tree acceptance, and an exception on malformed record fields. |
| phase27j/k → phase27l | Separate read-only discussion covered all four. Claude withdrew the position that current-tree drift should leave progress eligibility true. Both agreed legal close may ignore current drift, but cannot bypass active/terminal-state restrictions. Separate GO preceded the related fixes. |
| phase27m | Root reran the final suite and all 26 independent cases; all earlier reproduced gaps are rejected by the final candidate. |

Phase27d included two extra read-only shell commands (`ls` and `wc -l`) outside its exact self-check list. Claude disclosed and acknowledged this procedural deviation. It does not establish a write or data-scope violation. Subsequent completed repair phases used the prescribed self-check command strings; read-only review phases had no Bash calls. These facts are retained rather than describing the initial round as perfectly compliant.

## Independent verification

- Targeted suite: **53 tests, 52 passed, 1 skipped, 0 failed**, actual exit0. The skip is consumer symlink creation, unavailable under current Windows privileges.
- Root audit: **26 cases passed, 0 failed**, actual exit0. It uses independently constructed synthetic transcripts and the accepted `runCall` seam. The full sequence captured the bytes actually passed to `child.stdin.end`, checked exact template equality, and rebound them to the start-record digest. It also rejected superseded approval.
- **123 protected files matched their pinned hashes**, including all110 distributed plugin files and accepted instrumentation dependencies. No distributed runtime behavior changed in this slice.
- Final code/fixture identities are in the [acceptance receipt](2026-09-09-plan-review-feasibility-evidence.json). The detailed root evidence and the retained failures are **private maintainer receipts, retained outside this repository and not published with it**: `phase27m-root-audit-results.json` (root audit), with `phase27e-root-repro-results.json` and `phase27i-root-audit-results.json` recording the retained failures. They are named here for provenance only; the repository ignores that runtime root, so no link to them can resolve for a reader.

The historical126-file regression (2,132 tests, 2,120 passes, 12 skips) was not rerun for this private, isolated addition. Its old receipt does not cover the new driver. Verification here is the targeted suite plus independent audit and protected-source comparison, not a new repository-wide regression claim.

## Enforced boundaries

Authorization and replay share the verified reducer. Historical transitions, raw output, canonical settings/configuration, source/CLI/guard copies, session, prompt/argv, accounting and current file state are checked. Each of the six possible calls owns separate settings and audit paths. Any pre-dispatch source change refuses execution; only the completed implementation may contain allowed scoped changes. An outstanding start or terminal failure cannot be revived by discussion, close or reopen.

`consistent` describes reconciled historical evidence; `accepted` additionally requires completed mechanical flow and an unchanged current result; `dispatchable` means nonterminal progress eligibility, not permission for an immediate spawn. Current consumer-tree drift is reported separately and invalidates acceptance/progress. Other immutable evidence drift, such as altered raw/config/source bindings, still invalidates consistency. Root actions retain their own legal-state checks.

The implementation has grown beyond the original size estimate. No reduced maintenance cost or token saving is inferred from this work. It remains an optional maintainer tool outside the shipped plugin.

## Remaining evidence gates

No live consumer call ran in this slice. Offline stand-ins do not prove Claude resume behavior, native Vigil integration, correct delivered behavior, GPT-6 Astra runtime benefit, or comparative efficiency. Read-target checking is post-hoc observation, not a preventive read sandbox. Historical process and tree snapshots are recorded observations, not externally authenticated facts. Concurrent mutation between checks remains possible; the Windows symlink branch is unverified here.

The old S2/S3 pilot stays closed, including its original failure/rejection outcomes. Its exposed hidden checks must not seed new blind confirmation. Its US$4.4346125 experimental estimate is unchanged and excludes **all** implementation/discussion sessions; it is not billing or total collaboration spend.

L2 still lacks a measured avoidable cause and selected candidate; L3 lacks independent confirmation and eligible closed-task history; L4 provisionally retains the current default. The next full-flow observation requires a separate prospective protocol integrating the review channel with the actual workflow, fresh independent grading, and a frozen budget. Eligible real-task history remains a separate unresolved input. This offline capability acceptance satisfies none of those evidence gates by itself.
