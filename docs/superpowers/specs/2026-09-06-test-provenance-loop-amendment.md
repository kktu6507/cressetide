# Test-Provenance D amendment — the review-loop controller

> **TP v1.20 scope notice.** The pure prospective-authority prerequisite was independently approved as the [TP v1.20 prospective-authority amendment](2026-09-06-test-provenance-prospective-authority-amendment.md). That amendment is authoritative for that operation's contract, signature and pipeline. §D9.1a below *references* it and adds only the controller-owned steps that surround it; it defines no competing helper.

> **TP v1.19 scope notice.** The file-owned preview contract formerly described in §D8.2 was independently extracted and approved as the [TP v1.19 file-preview amendment](2026-09-06-test-provenance-file-preview-amendment.md). That amendment is authoritative for that helper. This amendment only *calls* it and neither restates, extends nor modifies it.

> **Approval scope.** This TP v1.21 amendment approves the controller contract, state, operations, CLI, admission/cap/epoch rules, recovery, witness unlock, HEAD-view prefix and ledger/caller integration specified below. Code is released in bounded slices and requires separate independent acceptance. No implementation or readiness is accepted by this specification decision. [Independent approval](../reviews/2026-09-06-loop-controller-spec-codex-review.md).

**Status: APPROVED — test-provenance v1.21, effective 2026-09-06.** Independently reviewed candidate: revision s6. Implementation acceptance is separate.

The effective coupled set is **shared decision-provenance model v1.15 + intent-scan v1.10 + test-provenance v1.21**: the TP v1.17 base plus approved E1 v1.18, file-preview v1.19, prospective-authority v1.20 and this v1.21 controller amendment. Codex approves this contract under the user's delegated planning and review authority after the recorded real Claude Code discussions and independent review; this is neither a new direct user approval nor a panel decision. TP §8's seven-step loop and hard lock remain effective subject to the explicit deltas below, including §D7's cap tie ordering. The ordinary repair cap of 2, existing mint permissions, final Step 6 contract and historical-validation boundaries are unchanged.

Written by Claude Code (claude-opus-5, xhigh) under the user's existing project-only authorization, incorporating the settled phase9d1–d8 and D10–D14 positions and the r3/r4 publication and adapter corrections (later rounds overriding earlier ones). Superseded rules are removed rather than annotated; the separate review records own the history of how each was settled.

**Approved normative deltas are collected in §D15.** The independent decision records the reviewed candidate and scope; historical source-line references identify discussion checkpoints, and the named current source predicates remain authoritative.

---

## §D0. Scope

**In.** One durable controller for TP §8's loop: where its state lives, what it records, which operations exist, how an iteration is admitted and capped, how an epoch is unlocked, how a crash is reconciled, which counters it feeds, and how the existing callers integrate.

**Out.** The approved TP v1.19 preview helper and the approved TP v1.20 prospective-authority operation, which this amendment only *calls*. Producer, discovery, adapter, writer and committed-batch-consumer semantics and public requests; every existing writer entry point, option and diagnostic precedence; the head-view exclusion set except for the one prefix in §D1; the eighteen §11 ledger key names and types; the base content view; ignore authority and config observability; the ordinary repair cap of 2; the writer's clause-mint permissions; Step 6's own obligations.

---

## §D1. Placement, addressing, identifiers, and one exclusion delta

```
.ctide/test-provenance-loop/
  emit.lock                                   # the single global emission lock
  task-<h>.json                               # durable control state          (controller)
  task-<h>.lock                               # per-task operation lock        (controller)
  task-<h>.<pid>.<rand>.tmp                   # staging, ownership-gated       (controller)
  task-<h>.review.json                        # the reviewer's returned bytes  (main thread)
  task-<h>.governance.json                    # the governance draft input     (main thread)
  task-<h>.<admissionId>.payload.json         # the retained writer payload    (controller)
```

### D1.1 The task-file address

```
h = sha256Hex(canonicalJson(taskId))
```

**Not** `sha256Hex(taskId)`. `sha256Hex(text)` is `sha256(canonicalText(text))` (`canonical-json.mjs:78-80`), and `canonicalText` (`:41-44`) strips a **leading** BOM and folds `\r\n`/`\r` to `\n`; Node's UTF-8 encoder additionally replaces a lone surrogate with U+FFFD. Three pairs of **distinct, valid** TaskState keys therefore collide under direct hashing, and raw UTF-8 hashing repairs only the first two:

| pair | why `sha256Hex(taskId)` collides | why `sha256Hex(canonicalJson(taskId))` does not |
|---|---|---|
| `"a\r\nb"` vs `"a\nb"` | `canonicalText` folds CRLF to LF | `JSON.stringify` escapes both, so no CR or LF remains to fold |
| `"﻿x"` vs `"x"` | leading BOM stripped | the JSON text begins with `"`, so the BOM is no longer **leading** |
| two distinct lone surrogates | both encode to U+FFFD | well-formed `JSON.stringify` escapes each as literal `\udXXX` |

`canonicalJson(string)` is `JSON.stringify(string)` (`canonical-json.mjs:68`). This claims nothing about arbitrary cryptographic collision resistance. The filename is an **index, never an identity**: every load re-compares the exact `taskId` string and the full `{treeOid, storePath, storeDigest}` witness (§D2.3).

**`taskId` is an opaque store key.** No sentinel value is reserved: `"unknown"` is a legal task name, and no operation may treat it as an absence marker. Absence is reported by a typed refusal or an explicit `null`, never by a magic string.

### D1.2 Identifier grammars — only the new ones are constrained

| identifier | grammar | owner |
|---|---|---|
| `admissionId`, `emissionId`, `attemptId` | 32 lowercase hex, controller-minted | **new here** |
| `batchRecordId` | `R-<ULID>` via the existing `makeIdFactory()` (`:216-219`) | existing store mechanism |
| `taskId` | **opaque store key**; no grammar | existing |
| every existing record id, clause id, DP id, transition id | their own existing schemas | existing |

**No new grammar is imposed on anything that already exists.**

### D1.3 Digest notations

| value | notation |
|---|---|
| `reviewRawDigest`, `governanceRawDigest`, `artifactRawDigest`, `payloadRawDigest` | **raw** `sha256(bytes)` — file identity |
| store pre-state | `loadStore().digest` = `sha256(canonicalText(file text))` — **semantics unchanged** |
| inventory digests | the canonical v2 formula — unchanged |
| batch/snapshot digests | `digestOf` — unchanged |
| `packageDigest` | §D9.3 formula |

Two files whose bytes differ but whose `canonicalText` agrees are **domain-equal and byte-different**; this document never calls them byte-identical.

### D1.4 Exclusion delta

Add `.ctide/test-provenance-loop/` to §11b.10's closed hard-exclusion prefix set, evaluated at **step 1, before trackedness** — so content deliberately committed under it is invisible to the head view, the accepted cost for a tool-owned path. This is the **only** head-universe change.

Unchanged and normative here too: the base content view still enumerates **all** committed leaves with no head exclusions; `.ctide/test-adapters-config.json` keeps its exact-path observability exception; ignore authority remains tracked `.gitignore` bytes in S1.

Ordinary `.ctide/output/` loss preserves the control prefix entirely. Loss of the whole prefix is a limitation (§D16).

---

## §D2. Durable state

### D2.1 Closed schema — every field declared

```
{ loopControlVersion: 1,
  revision: <int>,
  taskId: <string>,
  baseProvenance: { treeOid, storePath, storeDigest },
  createdAgainstStoreDigest: <hex64>,
  knownRecordIds: [<string>…],                  // sorted, unique
  knownDraftIds:  [<string>…],                  // sorted, unique
  consumedWitnesses: [ { recordId, packageDigest|null, branch, atEpoch:<int> } … ],
  epoch: { ordinal:<int>, openedBy: WitnessRef|null, admitted: [Admission…] },   // ≤8
  closedEpochAdmissions: <int>,
  observedIterations: <int>,
  observedEpochs: <int>,
  priorHistory: "unknown",
  lastTwo: [ TailEntry|null, TailEntry|null ],
  currentAdmissionId: <hex32>|null,
  lock: Lock|null,
  pending: [ PendingDeclaration… ],
  lastEmission: Emission|null,
  attempts: { emit: AttemptSlot|null, observe: AttemptSlot|null, verification: AttemptSlot|null },
  pendingCommit: CommitIntent|null,
  committed: Committed|null,
  currentPassInvalidated: <bool>,
  counters: { adapterMisses:        { observed:<int>, uncertain:<bool> },
              staleBatchRejections: { observed:<int>, uncertain:<bool> },
              lastStaleSubject: <string>|null },
  status: "open"|"locked" }
```

**`createdAgainstStoreDigest`** is a creation-time provenance note for diagnostics only. It is never a CAS comparand and no operation compares against it.

**`status` is persisted as exactly `open` or `locked`.** Corruption is a *read projection* (§D2.3), never a persisted value: no mutating operation can legitimately publish "this state is invalid" through a path that validates states before publishing, and every mutator refuses `E_LOOP_STATE_CORRUPT` before it could reach a publication.

```
FindingIdentity = { testRef: { path, adapterId, structuralId },
                    kind,                                   // a TP §6 finding kind
                    binding: { clauseRef, dpRef? } | null }
```

**One `FindingIdentity` is used everywhere a finding is named** — in a retained `Admission`, in `pending`, in a `GovernancePackage` and in a `Lock`. It is normalized by **named field extraction** of exactly `path`, `adapterId` and `structuralId` from `result.testRef`; a whole-object reuse that could carry an extra member is not a normalization. A 4-tuple omitting `binding` is forbidden: two findings identical but for their binding are two identities, and a key that cannot tell them apart collapses them.

**A `FindingIdentity` carries no body digests, deliberately.** Where an unlock needs authoritative body comparands, they are read from the locking admission's retained payload (§D9.1b), never fetched from a `FindingIdentity` field that does not exist and never taken from a current file.

```
Admission = { admissionId:<hex32>, at:<int>, epochOrdinal:<int>, emissionId:<hex32>,
              reviewRawDigest:<hex64>, governanceRawDigest:<hex64>, fingerprint:<hex64>,
              commitReady:<bool>,
              batchRecordId:<string>,                       // allocated BEFORE payload construction
              retainedPayloadPath:<string>,
              payloadRawDigest:<hex64>,
              admittedClaims: { taskId, baseProvenance:{treeOid,storePath,storeDigest},
                                inventoryDigest:<hex64> },
              findingIdentities: [ FindingIdentity… ],      // EVERY finding of the admitted review
              phase: "open"|"committed"|"verified"|"refused"|"closed",
              closeReason: null | { stage: "not-ready"|"preview"|"writer"|"verification",
                                    kind:  "not-ready"|"repeat"|"refused"|"unknown",
                                    class: <string>|null, code: <string>|null } }

TailEntry = { fingerprint:<hex64>, epochOrdinal:<int>, admissionId:<hex32> }

Lock = { reason: "repeat" | "cap-exhausted",              // EXACTLY these two
         fingerprint:<hex64>, at:<int>,
         duplicateOf: { epochOrdinal:<int>, admissionId:<hex32> } | null,
         lockedFindings: [ FindingIdentity… ] }           // §D9.2

WitnessRef = { branch: "transition-governance"|"semantic-reconsideration",
               source: "persisted"|"draft", recordId:<string>, packageDigest:<hex64>|null }

Emission = { emissionId:<hex32>,
             request:{ repoRoot, baseTreeOid, taskId },        // the EXACT 3-key call
             returned:{ path, inventoryDigest },               // the ACTUAL emitter return
             artifactRawDigest:<hex64>,
             artifactHeader:{ baseTreeOid, headViewDigest, registryDigest,
                              inputProvenanceStoreDigest, inventoryDigest },
             storeTextDigest:<hex64>,
             capturedHeadViewDigest:<hex64>, capturedRegistryDigest:<hex64>,
             observation: { inventoryDigest, oracleDepTriggered } | null }

AttemptSlot = { attemptId:<hex32>, at:<int>, epochOrdinal:<int>,
                emissionId:<hex32>|null,        // emit/observe: the emission being attempted
                admissionId:<hex32>|null,       // verification: the admission being verified
                headRef:{kind,ref}|null,        // verification only
                phase: "pending"|"completed",
                outcome: null                                  // iff phase === "pending"
                  | { kind:"ok" }
                  | { kind:"refused", class:<string>, code:<string>|null }
                  | { kind:"pass", verdict: CommittedVerdictProjection }
                  | { kind:"unknown" } }

CommitIntent = { admissionId:<hex32>, batchRecordId:<string>,
                 expectedPreviousBatchRef:{kind,ref}|null,
                 expectedInputProvenanceStoreDigest:<hex64>,
                 inventoryDigest:<hex64>,
                 expectedBatchRecord: <complete record, §D8.2>,
                 payloadRawDigest:<hex64>, retainedPayloadPath:<string>,
                 phase: "prepared"|"attempted", attemptedAt:<int>|null,
                 outcome: null | {kind:"committed"}
                        | {kind:"refused", class:<string>, code:<string>|null}
                        | {kind:"unknown"} }

Committed = { admissionId:<hex32>, headRef:{kind,ref}, batchDigest:<hex64>,
              inventoryDigest:<hex64>, baseProvenance:{treeOid,storePath,storeDigest},
              headViewDigest:<hex64>, registryDigest:<hex64>,
              payloadRawDigest:<hex64>, fingerprint:<hex64>,
              expectedBatchRecord: <complete record> }
```

**`CommittedVerdictProjection`** is an explicit projection **derived by the controller after an actual successful consumer run**, holding exactly the consumer's seven identity fields:

```
CommittedVerdictProjection = { taskId, committedBatchRef:{kind,ref}, batchDigest,
                               inventoryDigest, baseTreeOid, headViewDigest, registryDigest }
```

The actual `verifyCommittedBatch` return carries **thirteen** keys: `converged`, those seven, and five further reporting fields (`historicalVersion`, `priorStateExists`, `entryCount`, `resolvedFindingCount`, `sourceObservations`). This slot is **not** that return, is never called the complete consumer return, and the full object is never inserted into it. `converged` is not stored: a stored copy would be a second authority for a verdict only a fresh consumer run can establish. No caller-injected verdict is ever admitted.

`PendingDeclaration`, `GovernancePackage` and `Chosen` are given in §D5.5.

### D2.2 Invariants — must hold in EVERY published state

Every publication is a state a reader may observe. There is no transient exemption, and recovery publications are included.

1. `epoch.admitted.length <= 8`.
2. **`observedIterations === closedEpochAdmissions + epoch.admitted.length`.**
3. `closedEpochAdmissions` increases **only** in the same published transition that resets `epoch.admitted` and opens the next epoch (§D9.5). Never at lock time.
4. `revision`, `observedIterations`, `observedEpochs`, `closedEpochAdmissions` and both `observed` counters are finite non-negative safe integers, monotonically non-decreasing. What an epoch transition resets and what it preserves is enumerated exhaustively in §D9.5; no other operation resets any of them.
5. `lock !== null` ⟺ `status === "locked"`, and `lock.reason ∈ {repeat, cap-exhausted}`.
6. `committed !== null` ⟹ `pendingCommit === null`. The prior `committed` is therefore cleared in the **same publication** that first writes `pendingCommit{phase:"prepared"}` (§D8.1), never afterwards.
7. `knownRecordIds`, `knownDraftIds` and `consumedWitnesses` are sorted, unique and append-only within one control file's life.
8. `currentAdmissionId`, when non-null, names an `Admission` in `epoch.admitted` **whatever its phase**. It is not a synonym for "an open admission".
9. At most one `Admission` has `phase === "open"`.
10. `attempts.*` slots are independent: a slot in `phase:"pending"` is never overwritten (§D4.1).
11. `committed !== null` ⟹ `committed.admissionId` names an `Admission` in `epoch.admitted`. This is what makes §D12's `committed.admissionId === currentAdmissionId` meaningful, and it is why §D9.5 clears `committed` rather than weakening this rule.
12. **`status === "locked"` ⟹ `currentAdmissionId !== null`, it names an `Admission` in `epoch.admitted`, and `lock.fingerprint === admission(currentAdmissionId).fingerprint`.** While locked, `currentAdmissionId` therefore names the **locking** admission, which is what makes §D9.1b's retained-payload read well defined. Every path that publishes a lock enforces this **within** that publication: §D7.3's single admission publication writes the appended admission, `currentAdmissionId` and the `repeat` or `cap-exhausted` lock together; the eighth's later outcome locks (§D7.2) are set where `currentAdmissionId` already names that admission; and `runProposalIteration`'s cap lock (§D4 step 2) is taken **before** the clearing publication, never after.

Monotonicity in 4 is enforced **across cooperating transitions**. It is not a proof against hostile wholesale rewriting of the file.

**`lastTwo` is transition-enforced.** It holds the two most recent admissions **across epochs** and survives an epoch reset. Its entries are self-describing, so a reader can say *what* they name; a published state does not by itself prove they are the true two most recent. That property holds across cooperating transitions only.

### D2.3 State phases

| situation | detection | disposition |
|---|---|---|
| **absent** | no state file | `beginTaskLoop` creates the fully-initialized state (§D5.1) |
| **valid, same task + full base witness** | schema, types, invariants pass; exact `taskId` and `canonicalJson(baseProvenance)` equality | idempotent; returned unchanged |
| **valid, different task or base witness** | either equality fails | `E_LOOP_CONTEXT`. **Refused without any reset**: the state is left exactly as found |
| **corrupt** | unparseable, schema/type failure, or any invariant violated | `E_LOOP_STATE_CORRUPT` from a mutating operation; a **derived projection** from `inspectLoopState`. Never repaired, never replaced by a clean zero state, and never persisted as a status value |
| **unknown task** | no TaskState in the validated store | `E_LOOP_UNKNOWN_TASK` |

### D2.4 Path checks, locks and publication

**Order, normative.** For every operation: (1) containment checks on the prefix — walk each existing component from the repository root, `lstat`, refuse a symlink or non-directory, refuse a resolved path outside the repository; (2) **only a mutating operation** may then create an absent prefix, component by component, each checked before creation; (3) acquire locks in the total order `emit.lock` → `task-<h>.lock` → the store lock inside the writer, only those the operation needs; (4) do the work; (5) release in reverse.

**Path checks precede lock creation and every read and write.** A **read-only operation creates nothing** — no prefix, no lock, no temp; an absent prefix is simply reported as absent state.

The per-task lock spans the **whole** read → validate → mutate → publish sequence **including awaited regions**, not merely the write. **No store lock is ever held across an `await`. No lock of any kind is held across the external reviewer wait.**

Publication: serialize canonically → uniquely named temp with exclusive `wx` create (≤3 attempts, then `E_LOOP_IO`) → fsync → re-read and re-parse → atomic rename → clear ownership. `revision` increments on success. Failure before the rename leaves the previous state **byte-identical** and removes only this operation's temp.

**Combine publications wherever no external event separates them.** Two states a reader has no need to observe separately, whose combination satisfies every §D2.2 invariant, are one publication. Only an **external event** — an emitter call, an observer call, a writer call, a consumer call — forces a boundary, because evidence must be durable on both sides of it.

### D2.5 Lock diagnosis

Each lock file carries `{token, pid, hostname, startedAt}`. Default is **diagnose only**: `E_LOOP_LOCK_HELD` naming the owner. There is **no automatic break and no convenience break command.** Recovery is a documented operator process verifying same-host process absence, token and file identity, and a bounded path inside the reserved prefix, refusing live, inaccessible, remote or uncertain ownership.

---

## §D3. Public API, the finite matrix, and the CLI

Each operation takes exactly the declared keys; **none accepts a caller boolean, verdict, metric, digest, cached authority, store, index, clock or file path.** Every top-level operation performs its own `loadStore` → `validateStoreSchema` → `validateAll` → `indexStore` and resolves the named TaskState itself.

**Return versus throw.** An **owned attempt** that produced durable bookkeeping — a commit attempt, a verification attempt — **returns** a structured outcome carrying the actual `stage`, `class` and `code` and the recorded state, because throwing would discard the `revision`, `admissionId` and `phase` the caller needs and which the exception cannot carry. Every **precondition** — API shape, context, corruption, lock, legality, IO — **throws**, because nothing was attempted and nothing was recorded. Upstream typed causes keep their identity: class and code are preserved verbatim in the returned outcome, which is what §D13's "propagate unchanged" means at these two boundaries. Where an upstream cause genuinely carries no `code` — a plain `Error` or `TypeError` — `code` is `null` while `class` and `message` are still reported; **no code is ever fabricated.**

**One escape rule for the two read-only diagnostic operations.** `inspectLoopState` and `evaluateGate` report **every** evaluated cause inside their own closed diagnostic shape and throw **only** `E_API_ARGUMENTS`, which precedes the operation. There is no second rule anywhere in this document.

### D3.1 The finite operation matrix

| # | operation | request | kind | legal when | effect | refusals |
|---|---|---|---|---|---|---|
| 1 | `beginTaskLoop` | `{repoRoot, taskId}` | mutating | always | create fully-initialized state, or reconcile (§D8.3); resolve every `pending` slot to `completed/unknown`, set its uncertainty flag, **and close the admission a resolved verification slot names**, in **one** publication **before** any reuse | `E_LOOP_UNKNOWN_TASK`, `E_LOOP_CONTEXT`, `E_LOOP_STATE_CORRUPT` |
| 2 | `runProposalIteration` | `{repoRoot, taskId}` | mutating | `status:"open"` ∧ `pendingCommit === null` ∧ (`currentAdmissionId === null` ∨ its phase ∈ {`verified`,`refused`,`closed`}) — **terminal only** | §D4 | `E_LOOP_LOCKED`, `E_LOOP_INTENT_UNRESOLVED`, `E_LOOP_ADMISSION_OPEN`, `E_LOOP_CAP`, upstream causes |
| 3 | `submitReviewedProposal` | `{repoRoot, taskId}` | mutating | `status:"open"` ∧ `lastEmission !== null` ∧ no `Admission` references this `emissionId` (unless an exact retry, §D7.1) | §D7 | `E_LOOP_LOCKED`, `E_LOOP_NO_EMISSION`, `E_LOOP_EMISSION_SPENT`, `E_LOOP_CAP`, `E_LOOP_REVIEW_INVALID`, `E_LOOP_CLAIM_MISMATCH`, `E_LOOP_ARTIFACT_MOVED`, `E_LOOP_PRESTATE_MOVED`, `E_LOOP_ID_EXHAUSTED` |
| 4 | `commitReviewedBatch` | `{repoRoot, taskId}` | mutating | current admission `phase:"open"` ∧ `commitReady` ∧ (`pendingCommit === null` ∨ (`pendingCommit.admissionId === currentAdmissionId` ∧ `phase:"prepared"`)) | §D8.1; returns a structured outcome | throws `E_LOOP_NOT_COMMIT_READY`, `E_LOOP_ATTEMPT_SPENT`, `E_LOOP_COMMIT_CONFLICT` |
| 5 | `recordVerification` | `{repoRoot, taskId}` | mutating | current admission `phase:"committed"`; **or** `attempts.verification.admissionId === currentAdmissionId` with `currentAdmissionId !== null` (historical) | one owned attempt, or the recorded slot with `historical:true` | throws `E_LOOP_NO_COMMIT` |
| 6 | `openEpoch` | `{repoRoot, taskId, witness}` | mutating | `status:"locked"` ∧ state valid | §D9 | `E_LOOP_NOT_LOCKED`, `E_LOOP_WITNESS_NOT_NEW`, `E_LOOP_WITNESS_UNAUTHORIZED`, `E_LOOP_INTENT_UNRESOLVED`, `E_LOOP_PAYLOAD_MOVED`, `E_LOOP_CLAIM_MISMATCH` |
| 7 | `inspectLoopState` | `{repoRoot, taskId}` | **read-only** | any | frozen snapshot; **writes nothing, reconciles nothing**, reports a `pending` slot as it stands | only `E_API_ARGUMENTS` escapes; every other cause is reported in `diagnostic` |
| 8 | `evaluateGate` | `{repoRoot, taskId}` | **read-only** | any | §D12.1; **writes nothing, reconciles nothing** | only `E_API_ARGUMENTS` escapes; every other cause is reported in `provenance.diagnostic` |

**A historical verification outcome belongs to the CURRENT admission only.** A completed `AttemptSlot` survives an epoch transition and reports its own `epochOrdinal`, which exists precisely so a reader can tell a surviving slot from a current one. Once §D9.5 clears `currentAdmissionId`, `recordVerification` refuses `E_LOOP_NO_COMMIT` and never reaches the historical branch: a prior-epoch outcome is readable through `inspectLoopState` and is never returned as this task's verification.

**Admission phase transitions**

An admission is appended **already in its final phase** by §D7.3's single publication, so `submit` has three direct arrows and never publishes an intermediate `open` state for a repeat or an unready proposal:

```
(none) --submit: unique ∧ commitReady---> open
(none) --submit: wasSeen (repeat)-------> closed   (stage "not-ready", kind "repeat";
                                                    lock "repeat"; commitReady recorded as computed)
(none) --submit: !commitReady-----------> closed   (stage "not-ready", kind "not-ready";
                                                    lock "cap-exhausted" only on the eighth)
open   --commit: retained payload moved-> closed   (stage "preview", kind "refused",
                                                    code E_LOOP_PAYLOAD_MOVED)
open   --commit: admitted claim moved---> closed   (stage "preview", kind "refused",
                                                    code E_LOOP_CLAIM_MISMATCH)
open   --commit: preview refused--------> closed   (stage "preview", kind "refused",
                                                    upstream class/code)
open   --commit: writer refused---------> refused  (stage "writer", kind "refused")
open   --commit: writer succeeded-------> committed
committed --verify pass-----------------> verified
committed --verify refused--------------> refused  (stage "verification", kind "refused")
committed --verify misbound-------------> refused  (stage "verification", kind "refused",
                                                    code E_LOOP_VERIFICATION_MISBOUND)
committed --verify unknown--------------> refused  (stage "verification", kind "unknown",
                                                    class null, code null)
```

`closed`, `refused` and `verified` are terminal. `committed` is **not** terminal, which is why row 2 excludes it: a `committed` admission still owns one verification chance, and emitting would clear `currentAdmissionId` and orphan it.

**`class` and `code` nullability, one rule.** A **known refused** outcome always carries `class: <string>`; only its `code` may be `null`, and only when the actual upstream cause has none. Both `class` and `code` are `null` in exactly two places: a `kind:"unknown"` outcome, where no cause was observed at all, and the explicitly non-error `not-ready` / `repeat` `closeReason`, which records a disposition rather than a failure. `closeReason.kind` exists so those cases stay distinguishable from a known refusal.

**New-cycle reference clearing, at one declared safe point.** `runProposalIteration` clears `lastEmission` and `currentAdmissionId` **after** its containment checks, its cap check and its `currentPassInvalidated:true`, and **only** when row 2's legality holds. Payload cleanup is a separate filesystem action governed by §D8.5 and is never bundled into a state publication.

### D3.2 Response shapes (closed, with nullability)

```
beginTaskLoop  -> { revision, status, epochOrdinal, observedIterations, observedEpochs,
                    closedEpochAdmissions, currentAdmissionId|null, lock: Lock|null,
                    reconciled: "none"|"created"|"prepared-resumable"|"adopted"
                              |"attempt-unknown"|"conflict",
                    resolvedPendingSlots: [ "emit"|"observe"|"verification" … ] }

runProposalIteration -> { revision, emissionId, inventoryDigest, artifactRawDigest,
                          emitOutcome:   {kind:"ok"}
                                       | {kind:"refused", class:<string>, code:<string>|null}
                                       | {kind:"unknown"},
                          observeOutcome:{kind:"ok"}
                                       | {kind:"refused", class:<string>, code:<string>|null}
                                       | {kind:"unknown"},
                          observation: {inventoryDigest, oracleDepTriggered}|null }

submitReviewedProposal -> { revision, admissionId, fingerprint, commitReady, wasSeen,
                            admittedCount, retry:<bool>, status, lock: Lock|null,
                            phase: "open"|"closed" }

commitReviewedBatch -> { ok:true,  revision, admissionId, batchRecordId, headRef,
                         batchDigest, inventoryDigest, phase:"committed" }
                     | { ok:false, revision, admissionId, stage:"preview"|"writer",
                         class:<string>, code:<string>|null,
                         phase:"closed"|"refused", writerInvoked:<bool> }

recordVerification -> { ok:<bool>,                       // DERIVED: outcome.kind === "pass"
                        revision, admissionId, attemptId, historical:<bool>,
                        stage: "verification",           // OUTER field, always present
                        outcome: {kind:"pass", verdict: CommittedVerdictProjection}
                               | {kind:"refused", class:<string>, code:<string>|null}
                               | {kind:"unknown"},
                        currentPassInvalidated:<bool>, phase:"verified"|"refused" }

openEpoch -> { revision, epochOrdinal, openedBy: WitnessRef, closedEpochAdmissions, observedEpochs }

inspectLoopState -> { present:<bool>, corrupt:<bool>,
                      diagnostic: null | { origin: "loop"|"upstream",
                                           code: <string>|null,
                                           class: <string>,
                                           message: <string>,
                                           loopCode: "E_LOOP_STATE_CORRUPT"|"E_LOOP_CONTEXT"
                                                   |"E_LOOP_UNKNOWN_TASK"|"E_LOOP_IO" },
                      revision|null, status|null, epochOrdinal|null, admittedCount|null,
                      closedEpochAdmissions|null, observedIterations|null, observedEpochs|null,
                      priorHistory:"unknown", lastTwo, lock: Lock|null,
                      taskId: <string>|null,
                      baseProvenance: {treeOid, storePath, storeDigest}|null,
                      currentAdmissionId|null, currentAdmissionPhase|null,
                      currentPassInvalidated|null,
                      committed: { admissionId, headRef, batchDigest, inventoryDigest,
                                   baseProvenance, headViewDigest, registryDigest,
                                   expectedBatchRecord }|null,
                      counters: null | { adapterMisses:        {observed:<int>, uncertain:<bool>},
                                         staleBatchRejections: {observed:<int>, uncertain:<bool>},
                                         lastStaleSubject: <string>|null },
                      unresolvedSlots: [ "emit"|"observe"|"verification" … ] }

evaluateGate -> { loop:       { pass:<bool>, reason:<string>|null, revision|null,
                                epochOrdinal|null, admissionId|null },
                  provenance: { pass:<bool>,
                                diagnostic: null | { origin:"loop"|"upstream",
                                                     code:<string>|null, class:<string>,
                                                     message:<string> },
                                headRef|null, verdict: CommittedVerdictProjection|null },
                  combined:<bool> }
```

`recordVerification.ok` is **derived** from the outcome it already reports — `outcome.kind === "pass"` — including on a `historical:true` response, whose `attemptId` is the **existing** slot's id (no id is minted). It is not a second authority and no caller may supply it.

**`inspectLoopState`'s identity projection is what the ledger collector needs.** `taskId`, `baseProvenance`, `committed.admissionId` and the complete `committed.expectedBatchRecord` are present precisely because §D11.1's collector must perform §D12's field-level comparisons without calling `evaluateGate` and without a caller verdict. A shortened `committed` projection would make that collector impossible to write correctly.

**Diagnostics: a closed SHAPE with an open cause, in both read-only operations.** Each performs its own `loadStore` → `validateStoreSchema` → `validateAll`, which can raise the store's own typed codes, containment codes or plain IO errors, so a closed *code enum* cannot name them and must not relabel them. `origin:"loop"` carries a controller refusal with `loopCode === code`. `origin:"upstream"` preserves the actual `class`, `code` and `message` verbatim; **`code` is `null` when the cause genuinely has none** — a plain `Error` or `TypeError` has no code, and inventing one would be a fabrication — while `class` and `message` are always present. `loopCode` is the separately declared controller classification and is always present on `inspect`, so a reader always gets a classification even for a codeless cause. Containment failures classify `E_LOOP_IO`. Store corruption is never relabelled as unknown-task.

**`counters: null` is the unavailable variant**, never zeroed counters: zero is a measurement and absence is not. When the state is readable, inspect reports the **raw** `{observed, uncertain}` pairs and `lastStaleSubject`; only the ledger collector projects `"unknown"` (§D10), so the projection has exactly one owner.

`loop.reason` is a closed enum: `null` (pass), `no-loop-state`, `corrupt-loop-state`, `context-mismatch`, `locked`, `no-current-admission`, `admission-not-verified`, `pass-invalidated`, `committed-identity-mismatch`, `state-changed-during-evaluation`.

### D3.3 CLI

`scripts/test-provenance-loop.mjs <operation>`, spelled exactly `begin`, `emit`, `submit`, `commit`, `verify`, `open-epoch`, `inspect`, `evaluate`.

| operation | legal flags |
|---|---|
| `begin`, `emit`, `submit`, `commit`, `verify`, `inspect`, `evaluate` | `--cwd`, `--task` |
| `open-epoch` | `--cwd`, `--task`, `--witness-branch`, `--witness-source`, `--witness-record` |

`--task` required everywhere; `--cwd` optional, defaulting to the actual working directory. For `open-epoch` all three witness flags are required; `--witness-branch` takes exactly `transition-governance` or `semantic-reconsideration`, `--witness-source` exactly `persisted` or `draft`. **Neither is inferred, and there is no `packageDigest` flag**: for a draft witness the controller derives the digest itself from the named package (§D9.1), consistent with this section's rule that no operation accepts a caller-supplied digest. Each flag at most once, values present, non-empty and not flag-like; no bare positionals; unknown flags refused. Every argument fault is `E_API_ARGUMENTS`, raised **before** anything runs, with parsing inside the caught boundary.

**Streams and exits, one rule.** Exit **1** iff the operation **threw** or **returned an owned failure** — `ok === false`, or `combined === false` for `evaluate`. A thrown refusal prints `{ok:false, code, message, detail}` on **stderr**; a returned failure prints its exact response fields on **stderr**; everything else prints its response JSON on **stdout** and exits **0**. `evaluate` is not an exception to this rule, and neither is a refused, misbound or unknown verification. A corrupt or absent control state is reported in `loop.reason` and in the diagnostic fields, not as a suppression of `provenance`.

---

## §D4. Emission and observation

`runProposalIteration`, holding `emit.lock` then `task-<h>.lock` across the whole awaited region:

1. containment checks; legality per §D3.1 row 2;
2. **cap check, before any external work and before any clearing.** If `epoch.admitted.length >= 8`, publish `lock{reason:"cap-exhausted", fingerprint: <the last admission's>, duplicateOf:null, lockedFindings: <that admission's retained `findingIdentities`>}` with `status:"locked"`, **in a state where `currentAdmissionId` still names that admission so invariant 12 holds**, and refuse `E_LOOP_CAP`. **Nothing is counted**: no `observedIterations` change, no attempt slot, no pass invalidation, no emitter call. Requesting a new cycle is what spends the epoch, so a verified eighth admission converges until a new cycle is requested — and once it is, `evaluateGate.loop.pass` becomes false with `loop.reason:"locked"`, which is the intended consequence of asserting that the work is not done.

Then **four publications**, each separated from the next by work that can fail independently — an external call for A→B and C→D, and the fallible artifact-binding and authority-sampling reads for B→C:

| pub | contents | boundary |
|---|---|---|
| **A** | `currentPassInvalidated:true`; `lastEmission:null`; `currentAdmissionId:null`; `attempts.emit = {phase:"pending", emissionId:<new>}` | the **emitter call** |
| **B** | `attempts.emit` `completed` with its outcome **and** the `counters.adapterMisses` aggregation, in this one publication. If the emitter threw, B is published **first** and the actual cause is then re-thrown unchanged | the **fallible** binding and sampling reads of steps 6–7 |
| **C** | the **complete** `lastEmission` (every §D2.1 field) **and** refreshed `knownRecordIds`/`knownDraftIds` **and** `attempts.observe = {phase:"pending"}` | the **observer call** |
| **D** | `attempts.observe` `completed` with its outcome, its aggregation and `Emission.observation` | — |

A and C are each combined rather than split because no reader needs an intermediate and each combined state satisfies every invariant. **B is separate from C not because a call sits between them but because steps 6–7 can throw**: the emitter has already run, and an aborted binding or sampling read must not discard the outcome B journalled. A and C are each durable before an external call, so a crash cannot leave a stale pass or an unrecorded attempt.

Between B and C:

6. **bind the returned artifact before sampling any authority**: read it at the returned `path`, compute `artifactRawDigest`, parse with the canonical v2 reader, require `artifact.baseTreeOid === TaskState.baseProvenance.treeOid === request.baseTreeOid` and `artifact.inventoryDigest === returned.inventoryDigest`; record `artifactHeader`;
7. **only then** sample authority: `storeTextDigest = loadStore().digest`, plus fresh `capturedHeadViewDigest` / `capturedRegistryDigest`; require each to equal the artifact header's counterpart. Sampling after emission does not bind them; these equalities do.

The emitter is called as `emitChangedTestInventory({repoRoot, baseTreeOid, taskId})` and the observer as `observeInventoryTelemetry({repoRoot, baseTreeOid, taskId})` — exactly three keys each, `baseTreeOid` from the **validated** TaskState. **Observer failure is non-gating** and is reported in `observeOutcome`. `emit.lock` is released **before** any reviewer wait.

A failed emitter leaves `lastEmission` null, so `submit` refuses `E_LOOP_NO_EMISSION`; a failed observer leaves `Emission.observation` null and the iteration proceeds.

### D4.1 Slot discipline

Three independent slots, so an emit and an observe never overwrite each other's pending evidence. A slot may be overwritten **only** when its occupant is `phase:"completed"`; aggregation happens in the same publication that sets `completed`, so `completed` implies durably aggregated.

Occupants found `pending` by a **mutating** operation are resolved in **one** publication before any is reused: each becomes `{phase:"completed", outcome:{kind:"unknown"}}` with its matching `uncertain` flag set, **and** — for a **verification** slot — the admission it names (`attempts.verification.admissionId`) is transitioned to `phase:"refused"` with `closeReason{stage:"verification", kind:"unknown", class:null, code:null}`. Without that closure the admission would stay `committed` forever, and since §D3.1 row 2 is terminal-only, every future emission would be blocked with no exit. Emit and observe slots name no admission and close none.

**Read-only operations never do any of this**; they report the slots in `unresolvedSlots`.

Replacing an already-aggregated **completed** detail leaves the known aggregate untouched. An **unknown** outcome is never counted as zero.

**Pre-commit only.** These are pre-commit checks and stay pre-commit. There is no post-commit producer re-run and no post-commit current-store-text equality; AC127 governs, and Step 6's own recomputation is the only post-commit protocol.

---

## §D5. Inputs, ingestion and payload construction

### D5.1 Initial state

`beginTaskLoop` on an absent file writes **every** field of §D2.1:

```
loopControlVersion:1, revision:1, taskId: <the validated request task>,
baseProvenance: <the validated TaskState's, field for field>,
createdAgainstStoreDigest: loadStore().digest at creation,
epoch:{ordinal:1, openedBy:null, admitted:[]}, closedEpochAdmissions:0,
observedIterations:0, observedEpochs:1, priorHistory:"unknown",
lastTwo:[null,null], currentAdmissionId:null, lock:null, pending:[],
lastEmission:null, attempts:{emit:null, observe:null, verification:null},
pendingCommit:null, committed:null, currentPassInvalidated:true,
counters:{adapterMisses:{observed:0,uncertain:false},
          staleBatchRejections:{observed:0,uncertain:false}, lastStaleSubject:null},
knownRecordIds: every record id in the current validated store, sorted,
knownDraftIds:  every GovernancePackage.recordId in the governance file, or [] when absent,
consumedWitnesses:[], status:"open"
```

`revision` is the count of successful publications; the creating publication is the first, so a freshly created state reads `revision:1`.

**Governance at first read.** An **absent** governance file is legal and yields `knownDraftIds: []`. A **present** one is put through its **full structural, raw and schema validation**: the raw duplicate-member scan; `governanceVersion`; `taskId` equality with the request; and the complete declared shape of `pendingDeclarations`, `packages`, `recordsToCreate`, `resolutions` and `resolutionCarrierUpdates`, including **each drafted record's actual id and shape** through `recordPayloadComplete` and each `ResolutionGroupDraft`'s required fields and unique `subjectRef`. **Only** the current-emission binding is omitted — `inventoryDigest` is compared to nothing and no `Emission` need exist, which is what makes the read non-circular. Anything else failing is `E_LOOP_REVIEW_INVALID` at begin; an id-grammar check alone is not sufficient.

`submit` refuses `E_LOOP_NO_EMISSION` until `emit` has run. `openEpoch` applies **only** to a valid **locked** state.

### D5.2 Ownership and the proof limit

The test-reviewer is read-only and **returns** the TP §6 batch. The **main thread** persists those exact returned bytes to `task-<h>.review.json` and separately persists the governance input. The controller writes only its own state and its generated payload. There is no external proposal-path input.

**File validation cannot mechanically attest that the reviewer ran.** That invocation is a workflow obligation carried by §D12, and no controller response may present a validated review file as evidence of it.

**Repairs between admission and commit are expected and safe.** The commit re-reads neither input file; what binds it is the retained payload text and its `payloadRawDigest` (§D6).

### D5.3 The review file — the exact TP6 batch

`task-<h>.review.json` holds the actual `TestSemanticReviewBatch`, whose five fields TP §6:509-534 lists exactly:

```
{ taskId,
  baseProvenance,        // inline witness; must equal the tracked TaskState's,
                         // and treeOid == inventorySnapshot.baseTreeOid
  inventorySnapshot,     // the complete typed ChangedTestInventoryV2 envelope
  inventoryDigest,       // REQUIRED claim; must equal inventorySnapshot.inventoryDigest
                         // and its recomputation
  results: [ { testRef, clauseRef?, dpRef?, observedBaseBodyDigest?, observedHeadBodyDigest?,
               tagBefore, tagAfter,
               findings: [ { kind, binding?, evidence, resolutionRef? } … ] } … ] }
```

**No wrapper, no `proposalVersion`, no batch-level `resolutions`.** Per-finding `resolutionRef` (§6:534) is a different thing and applies **only** to `assum-reading-change`. Group drafts belong to governance and to the controller payload; `batchSnapshot.resolutions` is **derived** by the writer from top-level drafts (`provenance-store.mjs:3731-3738`).

The stated `taskId`, `baseProvenance` and `inventoryDigest` claims are **required and compared** (§D5.6) **before** the writer's canonical derivation. What §6:519-521 forbids is a caller-supplied value being *taken as* a second authority — not the claim itself. A mismatch is refused, never rewritten away.

### D5.4 The governance file

```
{ governanceVersion: 1, taskId, inventoryDigest,
  pendingDeclarations: [ PendingDeclaration … ],
  packages:            [ GovernancePackage … ],          // DRAFT witnesses only — §D5.5
  recordsToCreate:     [ <record> … ],
  resolutions:         [ ResolutionGroupDraft … ],
  resolutionCarrierUpdates: [ CarrierUpdate … ] }
```

**`ResolutionGroupDraft`** — the writer's required fields (`:3571`): `subjectRef`, `semanticEvidenceRefs` (non-empty; each resolvable in pre-state or `recordsToCreate`), `governanceWitnessRef`, `transitionDraft` (requiring `id`, `subject`, `action`, with `subject === subjectRef`), plus optional `successorClauseDraft`. `subjectRef` is **unique** across groups (`:3589-3595`): sibling findings aggregate into one group with several evidence refs.

**`CarrierUpdate`** — `CARRIER_ACTIONS` is `["preserve","replace","clear","unchanged-null"]` (`:2409`), and the key set is **closed in both directions per action** (`:2432-2437`):

| action | exact keys |
|---|---|
| `replace` | `action`, `dpId`, `rulingRef` (typed `review-ruling` ref; consumed, `:1870-1878`) |
| `preserve` | `action`, `dpId` |
| `clear` | `action`, `dpId` |
| `unchanged-null` | `action`, `dpId` |

All four are legal for `commit-test-provenance-batch` (`:2418`). The array is a **per-`dpId` map** with per-entry scoping (`:2403-2407`). It is **required** whenever any DP's terminal identity moved and legitimately **absent** when none did (`:2533-2535`).

### D5.5 Pending declarations, packages, witnesses

```
PendingDeclaration = { identity: FindingIdentity,
                       governance: Undecided | Chosen }

Undecided = { kind:"undecided" }

Chosen = { kind:"chosen",
           action: "supersede"|"retire"|"revise",
           successor: <clauseId>|null,
           compatibility: {impact, disposition},           // PRESENT ONLY when required — §D9.1
           requiredAuthorityKind: "user"|"discipline"|"arbiter"|"source-authority",
           reroutedPrincipal: <ReviewerPrincipal>|null,
           witness: {kind:"absent"}
                  | {kind:"persisted", recordId}
                  | {kind:"draft", recordId, packageDigest} }
```

**A `GovernancePackage` exists ONLY for `source:"draft"`, and BOTH branches carry an actual `witnessDraft`.** There is no persisted package, no nullable `witnessDraft` and therefore no unowned null variant. A persisted witness is read directly from the validated store (§D9.1, §D9.2).

```
GovernancePackage (branch "transition-governance") =
  { recordId,                                   // the ACTUAL id that will be persisted
    branch: "transition-governance",
    findingKeys: [ FindingIdentity… ],          // NON-EMPTY subset of the locked ASSUM identities
    transitionDraft: <complete draft>,
    successorClauseDraft: <clause>|null,        // §D9.1a states exactly when each is required
    witnessDraft: <review-ruling|plan-gate record>,        // REQUIRED, never null
    semanticEvidenceRefs: [ {kind,ref} … ] }               // NON-EMPTY

GovernancePackage (branch "semantic-reconsideration") =
  { recordId,
    branch: "semantic-reconsideration",
    findingKeys: [ FindingIdentity… ],          // EQUAL to the locked general subset (§D9.2)
    transitionDraft: null,
    successorClauseDraft: null,
    witnessDraft: <the loopReconsideration review-ruling, §D9.4>,   // REQUIRED, never null
    semanticEvidenceRefs: [] }
```

`Chosen.compatibility` is **omitted entirely** unless §D9.1 requires it. `state.pending` is exactly this `PendingDeclaration` list, cross-checked against the validated store and the review; it is **never invented from findings**, and the controller never appends a `resolutionRef` a reviewer did not write.

**No undeclared field exists on a package.** `requiredAuthorityKind` and `reroutedPrincipal` are **derived** at unlock from `transitionDraft.authorityRef.kind`, the action, the successor and `clauseKindOf(successor)`; declared copies would be a second authority for the same fact and would have to enter §D9.3's digest.

**Coverage:** `pendingDeclarations` must correspond one-to-one with the admitted review's **unresolved `assum-reading-change` findings**, by full `FindingIdentity`. An entry naming a finding the review does not contain is `E_LOOP_CLAIM_MISMATCH`; a **missing** entry is also `E_LOOP_CLAIM_MISMATCH` — a not-ready admission with missing coverage would spend budget while leaving nothing to unlock with. A required field being absent is never read as "clean". **Neither pending list selects an unlock's `findingKeys`**: §D9.1 derives that set from the retained `lock`, for the reasons stated there.

### D5.6 Ingestion, allocation and admission order

1. **raw duplicate-member checks on BOTH documents** — `assertUniqueJsonMembers` from the existing shared `json-unique-members.mjs` (already reused by `adapter-registry.mjs:28` and `explicit-config.mjs:14`; **reused as-is, no extraction, no policy change**). `scanJsonSpans` is a structure-only locator (`provenance-store.mjs:287`) and charges no duplicate policy;
2. **raw inventory subtree** — locate `inventorySnapshot` with `scanJsonSpans`/`sliceJsonValue` and validate that slice with `parseCanonicalInventoryV2`, which charges **the canonical parser's actual entry and nested member ordering**. The **root** member order is free — `changed-test-inventory.mjs:67-68`: "the order of the members in the FILE is not a rejection reason, only the key set is". Duplicate scanning is orthogonal to ordering, and **no all-root-keys-sorted restriction is imposed, now or ever**;
3. **parse both enclosing documents into objects**;
4. **validate the original claims**: `batch.taskId === taskId`; `canonicalJson(batch.baseProvenance) === canonicalJson(TaskState.baseProvenance)`; `baseProvenance.treeOid === inventorySnapshot.baseTreeOid`; `batch.inventoryDigest === inventorySnapshot.inventoryDigest` and equals its recomputation; `inventorySnapshot.inventoryDigest === Emission.returned.inventoryDigest`; every result's full `testRef`, tags and observed body digests equal the emitted entry's; results cover entries one-to-one;
5. **pre-admission resolution validation** (§D5.8b). An invalid or false resolution claim refuses here, before anything is counted;
6. **allocate `batchRecordId`** as `R-<ULID>` through `makeIdFactory()`, collision-checked against the current **global** record ids, three bounded attempts then `E_LOOP_ID_EXHAUSTED`. The allocation-time check is a courtesy; the writer's own duplicate-record refusal remains the authority;
7. **construct the deterministic payload text** — which requires the id from step 6 — and create it at `task-<h>.<admissionId>.payload.json` with an **exclusive `wx` open**, refusing rather than overwriting if the name is taken;
8. **admit in ONE publication** (§D7.3), recording `batchRecordId`, `retainedPayloadPath`, `payloadRawDigest`, `admittedClaims`, the full `findingIdentities` and the computed `commitReady` alongside the existing admission fields. The admission is appended **already in its final phase**; no earlier publication carries a temporary `open` state.

Steps 6–8 are what make §D6's retention claim true rather than aspirational: a payload whose identity is minted only at commit time cannot detect its own substitution. Step 7's `wx` creation precedes the publication and stays a separate filesystem action under §D8.5.

### D5.7 The generated writer payload

```
{ taskId, batchRecordId, expectedInputProvenanceStoreDigest,
  batchSnapshot: { taskId, baseProvenance, inventoryDigest, inventorySnapshot, results },
  recordsToCreate: [ … ],
  resolutions:     [ ResolutionGroupDraft … ],      // TOP LEVEL, never inside batchSnapshot
  resolutionCarrierUpdates: [ CarrierUpdate … ] }
```

The writer derives `batchSnapshot.resolutions`, `baseProvenance` and `inventoryDigest` itself.

**`baseProvenance` and `inventoryDigest` live only inside `batchSnapshot`.** At top level, `baseProvenance` is an optional legacy supplemental (`:3532`) and `inventoryDigest` is **forbidden outright** (`:3516`, `E_PAYLOAD_FORBIDDEN`). No rule in this document may grant either top-level field authority; §D8.1 and §D9.1b name the exact nested paths every claim comparison uses.

### D5.8 `commitReady` — exactly the writer's gating set

`commitReady` is **not** inferred from a `resolutionRef` being present. It is true iff: no general finding (`wrong-tag`, `missing-source`, `scope-violation`) appears anywhere in `results`; **and** `pending` is empty; **and** every `assum-reading-change` finding satisfies the checks the writer actually charges inside `commit-test-provenance-batch` → `assertResultsCoverInventory` → `assertFindingResolution`:

**Both modes** (`:3245-3276`): `transitionRef` resolves in pre-state **or** is minted by this transaction; `finding.binding` is present; `transition.subject === finding.binding.clauseRef`.

**`historical-convergence`** — the writer returns here (`:3277-3282`). The closed shape `{mode, transitionRef}` and a resolvable transition are all this layer charges. **No `semanticEvidenceRef` is present or required; no carrier check; no group membership; no new group is invented for a prior transition.**

**`this-round`** (`:3284-3394`), all **gating**: `semanticEvidenceRef` is a typed RecordRef resolvable in pre-state or `recordsToCreate`; `evidence.kind === "review-ruling"`; `principalsEqual(evidence.by, {kind:"discipline", discipline:"test"})`; `finding.binding.clauseRef` is a canonical ASSUM; `evidence.subjectRef === finding.binding.clauseRef`; **`evidence.taskId === payload.taskId`** (`:3353`); **`evidence.testRef === result.testRef`** (`:3360`); **`evidence.findingKind === "assum-reading-change"`** (`:3366`); **`evidence.binding === finding.binding`** (`:3372`); and **both body digests against the result's observed digests, on exactly the sides that exist** (`:3381-3393`, with the deliberate `baseBodyDigest`/`observedBaseBodyDigest` name asymmetry).

**Group membership only when minted here** (`:3341-3346`): charged only when `mintedEvidenceByTransition` holds the transition. A valid this-round reference to a **prior** transition requires no new group.

**Coverage** (`:3401-3432`): one-to-one with entries, exact declared testRef type, and tag / observed-digest equality against the entry.

These are writer-layer obligations and are therefore **gating**; no non-gating diagnostic substitute exists. **True historical-base membership, the successor chain, post-binding and source freshness remain Step 6's.**

### D5.8b Invalid versus legitimately unresolved

The check list of §D5.8 is unchanged and remains writer-owned; the controller runs the identical evaluation earlier only to decide **admission**, and never replaces the writer's own charge at commit time. The writer's full per-finding obligations stay intact at **both** boundaries.

**The scan is EXHAUSTIVE over every finding of every result, and never short-circuits.** A valid unresolved finding sets `commitReady:false` and the scan **continues**; a general finding does the same. Only after every finding of every result has been evaluated is the disposition decided. Any finding meeting a refusal condition below refuses the **whole submission**, wherever it sits in the batch — before any id is allocated, any payload is retained, any count moves and any admission is published. An early general or unresolved finding therefore cannot hide a later false resolution claim, which a first-failure scan would allow.

**Refused before admission** (`E_LOOP_REVIEW_INVALID`; nothing counted, no id allocated, no payload retained, no identities minted):

- a `resolutionRef` outside the closed union, or with an inexact key set for its mode;
- a non-string `transitionRef`, or an untyped `semanticEvidenceRef`;
- an `assum-reading-change` finding whose `binding` is absent or whose `binding.clauseRef` is not a canonical ASSUM;
- an unresolvable evidence ref, an evidence record whose `kind` is not `review-ruling`, or a non-test principal;
- an **evaluable but false** claim — `evidence.taskId`, `evidence.testRef`, `evidence.findingKind`, `evidence.binding` or a body digest that does not match. A false claim of resolution is forgery, and admitting it would let a forger consume an epoch slot and move the loop toward its cap.

**Admitted, counted, `commitReady:false`**: a valid `assum-reading-change` finding carrying **no** `resolutionRef`; any general finding; a non-empty `pending`. These are legitimate reviewer output and the loop's normal not-ready path, and each unresolved finding must carry its declared `PendingDeclaration` (§D5.5).

---

## §D6. Identities — three, kept separate

1. **Semantic fingerprint** — `sha256Hex(canonicalJson([...]))` over: the verified `inventoryDigest`; per result sorted by testRef tuple, the full `testRef`, `tagBefore`, `tagAfter`, `observedBaseBodyDigest`, `observedHeadBodyDigest`, and per finding `kind`, `binding`, `resolutionRef{mode, transitionRef, semanticEvidenceRef}`; and the normalized `pending` projection including principal and witness state. **`finding.evidence` prose is excluded.** Derived persisted groups are excluded. This mirrors TP §8:716-720.
2. **Raw input identity** — `reviewRawDigest`, `governanceRawDigest`.
3. **Generated payload and expected committed identity** — `payloadRawDigest` plus §D8's complete `expectedBatchRecord`.

The payload text is constructed and retained **at admission**, and its `payloadRawDigest`, `retainedPayloadPath` and `admittedClaims` are recorded in the same admission publication. The commit uses **that retained text**, comparing its bytes before interpreting them (§D8.1), so a later edit to the caller's files — or to the retained file itself — cannot change what is committed without being detected. The same retained text, through the same hash-then-claims gate, is the only source of body comparands at unlock (§D9.1b).

`Admission.findingIdentities` retains the full `FindingIdentity` of **every** finding in the admitted review, not only the unresolved ones: a `cap-exhausted` lock after a clean round needs `[]` to be a *true* empty list, and a mixed round needs its general subset. It is deliberately not enough to reconstruct the review; the full contents stay protected by `payloadRawDigest`.

---

## §D7. Admission, cap and repeat

TP §8:726-727 is the authority: a repeated fingerprint within the epoch, or the cap (default 8), yields `converged=false` and the hard gate lock. Ordinary findings and a stale Step 6 route back to emission (§8:703). **`lock.reason` is therefore exactly `repeat` or `cap-exhausted`; there is no first-failure lock.**

`submitReviewedProposal`, in order; every earlier failure consumes nothing:

1. state valid, not corrupt, `status:"open"` (else `E_LOOP_LOCKED`);
2. **retry check** (§D7.1) — an exact retry returns idempotently and stops;
3. `lastEmission !== null` (else `E_LOOP_NO_EMISSION`); no existing `Admission` references this `emissionId` (else `E_LOOP_EMISSION_SPENT`);
4. ingestion §D5.6 steps 1–4 on both files;
5. emission binding: `artifactRawDigest` re-read now equals the recorded one (`E_LOOP_ARTIFACT_MOVED`); §D4 step 7's authority equalities still hold (`E_LOOP_PRESTATE_MOVED`);
6. **pre-admission resolution validation** (§D5.8b); then compute `fingerprint` and `commitReady` (§D5.8);
7. **cap**: if `epoch.admitted.length >= 8` → `E_LOOP_CAP`, **no admission**. A ninth is never admitted;
8. **`wasSeen` on the PRE-admission history**: `wasSeen = epoch.admitted.some(a => a.fingerprint === fingerprint)`;
9. **decide the FINAL disposition, still in memory**: `phase`, `closeReason`, `status`, `lock`, the `pending` list and the retained `findingIdentities`, from the table below;
10. **allocate and retain** (§D5.6 steps 6–7). The exclusive `wx` payload creation is a filesystem action owned by §D8.5 and happens **before** the publication, never inside it;
11. **publish ONCE** (§D7.3). There is no second admission publication.

**The disposition table.** `wasSeen` is the step-8 value, computed on the **pre-append** history; `commitReady` is the step-6 value and is **recorded as computed**:

| `wasSeen` | `commitReady` | eighth | `phase` | `closeReason` | `lock` | `status` |
|---|---|---|---|---|---|---|
| **true** | either value | any | `closed` | `{stage:"not-ready", kind:"repeat", class:null, code:null}` | `{reason:"repeat", fingerprint, duplicateOf, lockedFindings}` | `locked` |
| false | `false` | no | `closed` | `{stage:"not-ready", kind:"not-ready", class:null, code:null}` | `null` | `open` |
| false | `false` | yes | `closed` | `{stage:"not-ready", kind:"not-ready", class:null, code:null}` | `{reason:"cap-exhausted", …}` (§D7.2) | `locked` |
| false | `true` | any | **`open`** | `null` | `null` | `open` |

**A repeat's `commitReady` is recorded exactly as step 6 computed it, including `true`.** A repeated proposal may be perfectly commit-ready as a review; what forbids the writer is its `phase:"closed"` and the `repeat` lock, not a rewritten boolean. Overwriting it to `false` would misstate a recorded fact about the admitted review — `commitReady` is an observation of §D5.8's gating set, not a control flag — and §D3.2's `submitReviewedProposal` response returns it, so the caller would be told a ready review was unready. `closeReason.stage:"not-ready"` here labels a **pre-writer admission disposition** — the admission never reached a preview, writer or verification stage — and `kind:"repeat"` carries the actual reason; `class` and `code` are `null` because a repeat is not an error outcome.

Below the cap, a `closed` not-ready admission leaves `status:"open"` and `lock:null`, and a new `emit` + review may proceed. Only the fourth row publishes `phase:"open"`, which is exactly the case §D3.1 row 4 is meant to permit.

### D7.3 The single admission publication

§D2.4 requires publications to be combined wherever no external event separates them, and nothing external separates the append from the disposition. Splitting them would durably publish a temporary `phase:"open"` state for a repeated or unready proposal, and an interruption there is not recoverable by any declared path:

- a **repeat** left `open` and `commitReady` satisfies §D3.1 row 4 — `phase:"open"` ∧ `commitReady` ∧ `pendingCommit === null` — so it would get the writer chance §D7's repeat rule forbids. Every invariant would still hold, `beginTaskLoop` would find no intent and no pending slot, and nothing would close it;
- an **unready** one left `open` cannot commit (row 4 needs `commitReady`), cannot emit (row 2 is terminal-only), cannot unlock (`status:"open"` → `E_LOOP_NOT_LOCKED`), and an identical resubmit is an **exact retry** under §D7.1 — which matches `phase === "open"` and returns idempotently without closing anything. The task would have no typed exit.

This is an application of §D2.4, not a new rule, and it needs **no new flag, invariant or recovery phase**. Making the intermediate state an invariant violation instead would be worse: §D2.3 makes that `E_LOOP_STATE_CORRUPT`, "never repaired, never replaced", so a crash would brick the task rather than mis-permit one commit.

**ONE publication carries all of:**

- the appended `Admission`, **already in its final `phase`** with its final `closeReason` and its full identity fields (`batchRecordId`, `retainedPayloadPath`, `payloadRawDigest`, `admittedClaims`, `findingIdentities`, the recorded `commitReady`);
- `observedIterations += 1`;
- the rolled `lastTwo`;
- `currentAdmissionId` set to this admission;
- the cross-checked `pending` declarations (§D5.5);
- the final `status` and `lock`;
- the `knownRecordIds` / `knownDraftIds` baseline refresh §D9 requires at each lock and each successful submit.

Invariant 12 is satisfied **within** this publication on both locking rows, because `currentAdmissionId` and `lock.fingerprint` are written together.

**Crash outcomes.**

| interruption | durable result |
|---|---|
| **before** the publication | the authoritative state is unchanged; `observedIterations` did not move; the `emissionId` is unspent and no `Admission` records these digests, so a resubmit is an ordinary new submission and **not** a §D7.1 retry. Only the `wx`-created payload may survive, handled by §D8.5's immediate-failure cleanup or disclosed as a retained orphan (§D16). The create-to-publication window is unchanged in kind and length by this rule |
| **after**, repeat | `closed` + `lock{repeat}` + `locked`: row 4 refuses (not `open`), row 2 refuses `E_LOOP_LOCKED`, `openEpoch` is the declared exit. **No writer chance**, whatever `commitReady` recorded |
| **after**, not-ready below cap | `closed` + `open` + `lock:null`: `closed` is terminal, so row 2 permits a new emit. **No dead end** |
| **after**, not-ready eighth | `closed` + `lock{cap-exhausted}` + `locked`: `openEpoch` is the exit |
| **after**, commit-ready | `open` + `commitReady:true` + `open`: row 4 permits the single intended commit chance |

A consequence worth stating: §D7.1's `phase === "open"` predicate now matches **only** the commit-ready row, which is the only case where an idempotent retry is meaningful. Every closed case correctly routes a resubmit to `E_LOOP_EMISSION_SPENT` and therefore to a new emission.

### D7.1 Retry versus new cycle

A call is an **exact retry** iff `emissionId`, `reviewRawDigest` and `governanceRawDigest` all equal a recorded admission whose `phase === "open"`. It consumes no count, returns `retry:true`, and is **independent of whether `pendingCommit` exists**.

Otherwise it is a **new cycle**, which **requires a new emission**: changed bytes under an already-admitted `emissionId` are refused `E_LOOP_EMISSION_SPENT`, never admitted as a second admission. Identical bytes under a **new** `emissionId` are a new cycle whose fingerprint will be `wasSeen`, taking the repeat row of §D7's disposition table. A changed `resolutionRef` is new governance content, so it needs a new emission and a newly admitted review.

### D7.2 The eighth

The eighth admission is admitted normally (`epoch.admitted.length` becomes 8), through the same single publication of §D7.3. If it is admitted `open` and commit-ready it gets **at most one writer invocation and one owned verification attempt**; a verified `pass` may converge and `status` stays `"open"`. **Every other outcome — non-commit-ready, preview refusal, retained-payload or admitted-claim mismatch, writer refusal, verification refusal, verification misbinding or unknown — sets `lock{reason:"cap-exhausted"}`** with `lockedFindings` taken from that admission's retained `findingIdentities`, never from a re-read of the input files, in a publication where `currentAdmissionId` names that admission so invariant 12 holds. For the non-commit-ready case that lock is decided at §D7 step 9 and published by §D7.3's single publication, not afterwards. A ninth submission is refused `E_LOOP_CAP`, and a further **emission** request takes §D4 step 2's cap lock before any external work.

---

## §D8. Commit: reconciliation, preview, intent, writer, recovery

### D8.1 Order

1. **named-record reconciliation, before any disposal.** Read the current validated store and look up `pendingCommit.batchRecordId` when an intent exists. **Present and matching** the retained `expectedBatchRecord` field by field → adopt as `committed`, clear `pendingCommit`, admission `committed`; the store, not the retained bytes, is the authority for what was written. **Present and conflicting** → throw `E_LOOP_COMMIT_CONFLICT`, fail closed, dispose nothing. **Absent** → continue. This step comes first because disposal is only safe once it is known that no write landed;
2. **hash before parse.** Read the retained payload's bytes and compare their raw `sha256` with `payloadRawDigest`. **No parse yet** — a byte comparison is what makes the parse safe to perform. A mismatch is a preflight refusal with `class:"LoopError", code:"E_LOOP_PAYLOAD_MOVED"`;
3. **parse, then compare EVERY admitted claim** at its exact nested path. All of these, not a subset:

```
parsed.taskId                                        === admittedClaims.taskId
parsed.batchSnapshot.taskId                          === admittedClaims.taskId
canonicalJson(parsed.batchSnapshot.baseProvenance)   === canonicalJson(admittedClaims.baseProvenance)
parsed.batchSnapshot.inventoryDigest                 === admittedClaims.inventoryDigest
parsed.batchRecordId                                 === Admission.batchRecordId
parsed.expectedInputProvenanceStoreDigest            === CommitIntent.expectedInputProvenanceStoreDigest
                                                        // resumed prepared intent only
```

   Any mismatch is a preflight refusal with `class:"LoopError", code:"E_LOOP_CLAIM_MISMATCH"`. The forbidden top-level `inventoryDigest` remains the writer's own charge, and no top-level `baseProvenance` is given authority;
4. **preview** — the approved TP v1.19 helper, called as `previewTestProvenanceBatch({repoRoot, payloadText})` with the retained text. The helper throws; the controller **catches** its typed cause, preserving `class` and `code` **verbatim**. A refusal here is a preflight refusal;
5. **every preflight refusal — from step 2, 3 or 4 — publishes ONE state**: the admission `phase:"closed"` with `closeReason{stage:"preview", kind:"refused", class, code}` carrying the actual cause; **and `pendingCommit: null` iff step 1 proved the named record absent AND `pendingCommit.phase === "prepared"`** — proven unattempted. Without that clearing, a resumed prepared intent would survive its own refusal and §D3.1 row 2 would block every future emission with `E_LOOP_INTENT_UNRESOLVED` and no exit. If `pendingCommit.phase` was `attempted`, an absent record is **not** proof of non-attempt: §D8.3's `attempt-unknown` row applies instead, the intent is resolved as **spent**, and it is never cleared as unattempted or made retriable. §D7.2's eighth locking applies in this same publication. No `CommitIntent` is created and no writer is invoked. The response is `{ok:false, stage:"preview", class, code, phase:"closed", writerInvoked:false}`. Payload deletion is a separate action under §D8.5;
6. **one publication** carrying `committed: null` **and** `pendingCommit{phase:"prepared"}` with the retained payload identity and the complete `expectedBatchRecord`. Clearing the prior `committed` here is what keeps invariant 6 true at every boundary;
7. update to `phase:"attempted"` and publish — **before** the writer call, because a writer call is an external event;
8. call `runTransactionFromPayloadText(repoRoot, "commit-test-provenance-batch", retainedPayloadText)`;
9. record the outcome. On success publish `committed` and `pendingCommit: null` and return `{ok:true, …}`. On a typed refusal set admission `refused`, `closeReason{stage:"writer", kind:"refused", class, code}`, clear the intent, and return `{ok:false, stage:"writer", phase:"refused", writerInvoked:true}`.

**Response phase matches the persisted phase**: `stage:"preview"` ⟹ `phase:"closed"`; `stage:"writer"` ⟹ `phase:"refused"`.

**One owned chance per admission**: at most one writer invocation. A failed preflight is not an obligation to invoke the writer, and `E_LOOP_ATTEMPT_SPENT` refuses a second.

### D8.2 The preview helper

The controller **calls** the approved TP v1.19 contract and restates nothing about it. That amendment is authoritative for the helper's request shape, its return, its no-write/no-lock limits and the reasons the object-based preview was removed. This draft adds only the controller-side handling in §D8.1 steps 4–5.

### D8.3 Recovery, at `beginTaskLoop`

| durable state | evidence | `reconciled` | disposition |
|---|---|---|---|
| no intent | — | `none` / `created` | nothing to do |
| `prepared`, named record **absent** | intent only | `prepared-resumable` | the **same** retained payload and id may be resumed **once** through `commitReviewedBatch` (legal per §D3.1 row 4). No new admission, no duplicate write. A resumed attempt re-runs §D8.1 steps 2–4; if the captured pre-state has moved, the preview refuses and §D8.1 step 5 closes the admission **and clears the intent** in one publication |
| `prepared`, named record **present and matching** | defensive | `adopted` | adopt without re-writing |
| `attempted`, named record present and matching | full-record comparison | `adopted` | adopt as `committed` |
| `attempted`, named record **absent** | none | `attempt-unknown` | outcome `unknown`; admission → `refused` (`closeReason{stage:"writer", kind:"unknown", class:null, code:null}`); the intent is resolved as **spent**; a fresh review/admission is required. **Never a known non-attempt, never retriable, never reset to `prepared`** |
| `attempted`, record present but head or digest conflicts | mismatch | `conflict` | `E_LOOP_COMMIT_CONFLICT`, fail closed, no repair |
| known writer refusal recorded | typed code | `none` | a **completed** attempt; the admission is spent |

Matching means the **named** record only — no task or digest search — compared **field by field against the retained `expectedBatchRecord`**, including `kind`, `batchRecordVersion` and `relatedRefs`. `payloadRawDigest` is input identity and never substitutes for that object comparison.

A resumed `prepared` intent re-runs §D8.1 steps 2–4 before its prepare→attempted transition; that transition **is** the consumption of the single resume, so a second attempt finds `attempted` and takes the rows above.

An unrelated valid append moves the store text but not the named record or head, so it cannot defeat correct same-head recovery; whole-store equality is not required.

**What recovery proves:** the immutable named batch record, its `taskId`, `inventoryDigest`, `previousBatchRef` and the head pointing at it. It does **not** prove historical carrier effects, and **no current mutable DP or carrier equality rule is imposed** — a later legitimate DP update may differ from the preview while the same correctly committed named batch remains right.

### D8.4 Verification

`recordVerification` publishes `attempts.verification = {phase:"pending", admissionId, headRef}` **before** calling the consumer, then evaluates the binding below, then publishes `completed` with the outcome and its aggregation in one publication.

**The consumer resolves its own head.** `verifyCommittedBatch({repoRoot, taskId})` reads `ts.committedProvenanceBatchRef` from the **current** store (`committed-batch-consumer.mjs:112`), and a per-task controller lock does not lock out other store writer paths. A `converged:true` for a head some other path installed is not a success for **this** admission, and task-string agreement is not identity. Two checks are therefore required **before** any phase change or `ok:true`, both inside the held task lock:

**(a) the seven actual consumer identities, first:**

```
verdict.taskId                              === state.taskId
canonicalJson(verdict.committedBatchRef)    === canonicalJson(committed.headRef)
committed.headRef.ref                       === Admission.batchRecordId
verdict.batchDigest                         === committed.batchDigest
verdict.inventoryDigest                     === committed.inventoryDigest
verdict.baseTreeOid                         === committed.baseProvenance.treeOid
verdict.headViewDigest                      === committed.headViewDigest
verdict.registryDigest                      === committed.registryDigest
```

**(b) then a FULLY VALIDATED store after-read** — `loadStore` → `validateStoreSchema` → `validateAll` → `indexStore` — comparing the **full** identity, not a bare head ref: `ts.taskId`, `canonicalJson(ts.baseProvenance)`, `canonicalJson(ts.committedProvenanceBatchRef)` against `committed.headRef`, and `canonicalJson(index.records.get(committed.headRef.ref))` against `committed.expectedBatchRecord`. A **store** error from this read preserves its own actual class and code. No whole-store-byte equality is required, so an unrelated valid append does not fail it.

Outcomes:

- `pass` (both checks hold) → the slot carries the `CommittedVerdictProjection` derived from the actual consumer success; admission `verified`; `currentPassInvalidated = false`; response `ok:true`;
- **identity mismatch in (a) or (b)** → admission `refused`, `closeReason{stage:"verification", kind:"refused", class:"LoopError", code:"E_LOOP_VERIFICATION_MISBOUND"}`, `currentPassInvalidated` stays true, response `ok:false`. It is **not** counted as `staleBatchRejections`, and **no counter is fabricated for it**. This must be detected here, not first in read-only §D12;
- `refused` → admission `refused` (`closeReason{stage:"verification", kind:"refused", class, code}`); `currentPassInvalidated` stays true; if the refusal is `E_STEP6_SOURCE_STALE`, `counters.staleBatchRejections.observed += 1` and `lastStaleSubject` is set to the **named head ref string**; response `ok:false`;
- `unknown` → admission `refused` (`closeReason{stage:"verification", kind:"unknown", class:null, code:null}`); `staleBatchRejections.uncertain = true`, because the count of stale refusals can no longer be known complete; response `ok:false`.

In every case `committed` is **retained** — a failed Step 6 does not discard named committed evidence; only the pass claim is withheld.

**A second call returns the recorded slot with `historical:true`**, its **existing** `attemptId` (no id is minted), its derived `ok`, no consumer run and no count — including after the admission has closed or been refused. It applies to the **current** admission only (§D3.1). It is never accepted in place of a fresh `evaluateGate`.

### D8.5 Retained payload ownership and cleanup

A fresh id plus an exclusive `wx` create proves that **this invocation created a file at that name at that moment**. It does not prove that the file now at that name is the same file, and it does not prove that no state publication has adopted it. Ownership is therefore not decidable from the name.

**Immediate failed-publication cleanup only.** The invocation that created a retained payload may unlink it **while it still holds the task lock**, and only when all of the following hold: it performed the successful `wx` create in this invocation; its own state publication is confirmed **not** to have landed; the currently parsed authoritative state contains no `Admission` and no `pendingCommit` referencing that `admissionId`; and its own creation-identity check still matches. If the rename outcome is uncertain or the identity check is inconclusive, the file is **retained and diagnosed**, never unlinked — deleting an adopted or peer artifact is strictly worse than leaving an orphan.

**State publication and unlink are separate actions.** The authoritative state is published first; cleanup follows. A cleanup failure is diagnosed and cannot undo that state, cannot make the operation retryable, and cannot leave an admission open.

**Resolved historical payloads are retained.** There is no unconditional deletion at the new-cycle clearing point and **no orphan sweep**: absence of an id from the currently parsed state is not an ownership fact. Retention is also load-bearing rather than merely tolerated — §D9.1b reads the locking admission's retained payload for body comparands available nowhere else. The accumulation cost is disclosed in §D16. A later bounded cleanup mechanism, if one is wanted, must establish its own ownership facts and is outside this amendment.

---

## §D9. Epoch unlock

`openEpoch({repoRoot, taskId, witness})` applies only to a valid **locked** state. `witness` is exactly `{branch, source, recordId}`; for `source:"draft"` the controller **derives** `packageDigest` from the named package by §D9.3 and no caller supplies it.

1. containment checks; read and validate the store and the governance file;
2. **evaluate the offered candidate against the OLD baseline, before any union**:
   `isNew = !knownRecordIds.includes(recordId) && !knownDraftIds.includes(recordId) && !consumedWitnesses.some(c => c.recordId === recordId)`; for a draft its derived `packageDigest` must also be unconsumed. Otherwise `E_LOOP_WITNESS_NOT_NEW`.

   **`knownRecordIds` is a baseline snapshot, not the current store.** A persisted witness must exist in `preIndex.records` (TP v1.20's R3) and must be **absent** from `knownRecordIds`; those are consistent because the baseline is the set captured at the last refresh — at each lock and each successful `runProposalIteration` / `submitReviewedProposal`. A record persisted **after** that refresh is in the store now and not in the baseline, which is exactly what makes it new;
3. **authorize by branch**, else `E_LOOP_WITNESS_UNAUTHORIZED`. **transition-governance** (§D9.1) runs §D9.1b's retained-payload read, §D9.1c's per-finding evidence checks and §D9.1a's approved operation. **semantic-reconsideration** (§D9.2) invokes **none of §D9.1a, §D9.1b or §D9.1c**: it checks §D9.4's carrier and annotation against the exact general locked set, including the genuine empty-whole-set rule, and nothing else;
4. **then** union every record id in the validated store into `knownRecordIds`, every `GovernancePackage.recordId` into `knownDraftIds`, and append `{recordId, packageDigest, branch, atEpoch}` to `consumedWitnesses`;
5. resolve any pending intent and any pending attempt slot, then close and open atomically (§D9.5).

Baselines are also refreshed at each **lock** and at each successful `runProposalIteration` / `submitReviewedProposal`, so a record visible during one epoch cannot masquerade as new for the next.

### D9.1 Branch — transition-governance

The two sources are **separate paths**, and neither dereferences a member the other does not have.

**`source: "persisted"` — no package is involved at all.**

- The record must exist in the validated store under `recordId`, and be a `review-ruling` or `plan-gate`. `WitnessRef.packageDigest = null`.
- **Group selection and the complete typed comparison.** Select by `ref` alone, then charge the rest as refusals, so a wrongly advertised `kind` is a **refusal** rather than a group that silently fails to match:

```
resolved = preIndex.records.get(recordId)                          // R3 already requires it to exist
matches  = governance.resolutions.filter(g => g.governanceWitnessRef.ref === recordId)
matches.length !== 1                                               -> E_LOOP_WITNESS_UNAUTHORIZED
group    = matches[0]
canonicalJson(group.governanceWitnessRef)
  !== canonicalJson({kind: resolved.kind, ref: recordId})           -> E_LOOP_WITNESS_UNAUTHORIZED
canonicalJson(group.transitionDraft.ackRef)
  !== canonicalJson(group.governanceWitnessRef)                     -> E_LOOP_WITNESS_UNAUTHORIZED
```

  Both comparisons are over the **complete typed ref**, mirroring the writer's own rules: `:3927` compares `governanceWitnessRef` with `{kind, ref}` of the transition's `ackRef`, and `:3935-3936` resolves the ack by **id and kind**. The middle check is load-bearing in a case nothing else covers — a group advertising `{plan-gate, R-w}` for a persisted `review-ruling` while `transitionDraft.ackRef` is correct would pass TP v1.20's R4 and be refused only later by the writer, i.e. an epoch budget granted on a group that cannot commit.
- That group supplies `subjectRef`, `transitionDraft` and `semanticEvidenceRefs`. Its `successorClauseDraft` is converted under the rule below.
- `findingKeys` are derived from the **retained lock**:

```
findingKeys = lock.lockedFindings.filter(i =>
    i.kind === "assum-reading-change"
    && i.binding !== null
    && i.binding.clauseRef === group.subjectRef)
require findingKeys.length > 0                    // the non-empty ASSUM subset, unchanged
```

  **Neither pending list selects this set.** `state.pending` is reset at epoch open (§D9.5) and `governance.pendingDeclarations` is a caller-editable current file, so either could be stale or emptied while a perfectly valid persisted witness is offered. The retained `lock` already owns the locked identity, is unaffected by caller edits to those files, and is bound by invariant 12 to the admission that produced it — so selecting from it cannot block a valid candidate and weakens no coverage. It is authoritative **while locked**, which is exactly when `openEpoch` reads it; §D9.5 clears it to `null` in the same transition that opens the next epoch, so it does not survive epoch opening and nothing later depends on it. A `PendingDeclaration` for the same identity remains informational; `governance.kind === "undecided"` is **not** a refusal reason, since an undecided declaration is often exactly why the epoch locked.
- **`successorClauseDraft`: charge the ORIGINAL presence, then convert only absence.** The writer's own gate is `clauseDraft !== undefined` (`:3948-3957`), so an **absent** optional field skips it while a **stated `null`** enters it and is refused on retire and on an already-existing successor. TP v1.20's candidate, by contrast, requires `successorDraft: null` in exactly those two cases. The adapter must therefore charge the original before converting:

```
stated = Object.prototype.hasOwnProperty.call(group, "successorClauseDraft")
if (stated) {                                       // mirrors :3953 and :3956
  successorId === null                              -> E_LOOP_WITNESS_UNAUTHORIZED   // retire
  preIndex.clauses.has(successorId)                 -> E_LOOP_WITNESS_UNAUTHORIZED   // already exists
}
candidate.successorDraft = stated ? group.successorClauseDraft : null
```

  Only an **absent** field becomes `null`. A stated `null` on the mint path needs no controller charge: TP v1.20's R2 already refuses "no `successorDraft` mints it" with `E_API_ARGUMENTS`. The two clauses above are the source's own rule, and the preferred implementation **reuses the writer's predicate** — factored privately as a boolean or descriptor so each boundary raises its own declared refusal — rather than restating it. Reuse must not remap a thrown upstream cause, must preserve the writer's existing refusal codes and their order, and must leave the writer's `!== undefined` behaviour unchanged for direct object callers; the controller can distinguish absent from stated `null` because it ingests JSON, so no older object API changes and no new public endpoint or input option is added.
- **The later writer payload keeps the original group**, with `successorClauseDraft` still **absent**. The normalized `null` exists only as the pure operation's candidate value and is never written back into the group.
- `citedRecords = governance.recordsToCreate`; `witness.record = null`.

**`source: "draft"` — the package supplies everything.**

- `package = governance.packages.find(p => p.recordId === recordId)`; absent ⟹ `E_LOOP_WITNESS_UNAUTHORIZED`.
- `package.witnessDraft` is required and non-null; `witnessDraft.recordId === package.recordId`; `recordId ∉ index.records`.
- `WitnessRef.packageDigest = packageDigest(package)` **derived internally** (§D9.3), and that value must be unconsumed against the OLD `consumedWitnesses`.
- `transitionDraft`, `successorClauseDraft`, `findingKeys` and `semanticEvidenceRefs` come from the package; `findingKeys` must still be a **non-empty subset** of the locked `assum-reading-change` identities, compared as full `FindingIdentity` values. `GovernancePackage.successorClauseDraft` is a **declared nullable field** (§D5.5), so it passes to `candidate.successorDraft` as it stands and needs no absence conversion.
- `citedRecords = governance.recordsToCreate`; `witness.record = package.witnessDraft`.

**Both sources then share, in this order:**

1. the **relationship set**: `transitionDraft.ackRef ≡ {kind: <the resolved witness record's actual kind>, ref: recordId}`; every `semanticEvidenceRefs` entry resolvable in the validated store or among `governance.recordsToCreate`;
2. **§D9.1b**, the retained-payload read that supplies the authoritative body comparands;
3. **§D9.1c**, the per-finding semantic-evidence equalities, **then** the shared `resolutionGroupDigest` comparison;
4. **the ORIGINAL validated `transitionDraft` object, passed through unmodified.**

```
candidate.transitionDraft = <the original object: group.transitionDraft (persisted)
                                                 or package.transitionDraft (draft)>
```

The controller **may not add, remove, reorder or normalize any own property of it**, and it reads derived values — the required authority kind, the rerouted principal — *from* it without writing them back. The same object is what later reaches the writer, so one object satisfies both layers and no second authority exists.

**Why no reconstruction.** `assertCompatibilityPresence:1315-1330` tests `Object.prototype.hasOwnProperty`, not nullishness: `stated = hasOwnProperty(t, "compatibility")`, and `!required && stated` is `E_COMPAT_FORBIDDEN`. Rebuilding `t` from named fields and re-adding `compatibility` only on a supersede-to-REQ would **silently drop** a caller's `compatibility: null` on retire, revise or a non-REQ successor, leaving `stated === false` so the sanitized candidate authorizes — contrary to the explicit forbidden-presence rule. The hazard is not confined to that one field: named-field reconstruction drops **every** undeclared own property, so any present or future `hasOwnProperty`-shaped rule would be equally defeated. Retaining the original removes the class, not the instance.

The three paths, all charged by the existing predicate inside the shared matrix row, with no competing validator and no widened mint permission:

| original `transitionDraft` | outcome |
|---|---|
| supersede → REQ carrying a real `compatibility {impact, disposition}` | `required ∧ usable` → passes; the same object later lets `assertUserClauseWitness` compare `impact`/`disposition` against the plan-gate |
| any own `compatibility` property on retire, revise or a non-REQ successor — **including `null`** | `!required ∧ stated` → **`E_COMPAT_FORBIDDEN`** |
| supersede → REQ with `compatibility` **absent**, or stated but not a usable object | `required ∧ !usable` → **`E_COMPAT_MISSING`** |

`authorityRef` is the transition's authority union (`user | discipline | arbiter | source-authority`); `ReviewerPrincipal` is the `by` on a review-ruling. **They are distinct unions and are never interchanged.**

5. **then** run §D9.1a's approved pure authority operation.

**Scope boundary.** This is pure matrix authorization granting epoch budget. It **does not expand the writer's mint permissions** — no new DEC mint permission follows — authorizes no semantic write in Step 4, and requires neither a pre-committed Transition nor an existing successor.

### D9.1a The prospective authority operation — approved separately as TP v1.20

The operation is **[TP v1.20](2026-09-06-test-provenance-prospective-authority-amendment.md)**, which is authoritative for its contract. This section defines **no competing helper** and restates none of its internals. Its signature is:

```
assertProspectiveTransitionAuthority(preIndex, candidate) -> void     // synchronous, pure
candidate own keys, exactly: { transitionDraft, successorDraft, witness, citedRecords }
witness   own keys, exactly: { source, recordId, record }
```

`preIndex` is the index of the controller's **own** fully validated current store, obtained after `validateStoreSchema` and `validateAll`; supplying it is the caller's precondition, and the operation validates no current store for anyone. `candidate.citedRecords` is `governance.recordsToCreate`; the witness travels separately in `witness.record` and must not also appear in that array.

Its own steps, per that amendment: candidate relationships R1–R4; a global id claim against **all six** raw pre-state sections then every candidate drafted object, **before any candidate indexing**; source-owned transition, optional clause and basic-record obligations on the new objects; a store-shaped staging union `U`; `validateRefs`, `validateGovernanceRulings` and `validateRoutingOrigins` on `indexStore(U)`, plus `basisRefsResolvable` against that staged index; `newlyConsumedRulingRefs(preIndex.store, U)` resolved in the staged index, filtered to actual typed review-rulings, then `assertRulingPacketFresh(preIndex, record)`; and the **shared** transition-matrix row called **once** with the staged index.

**There is no `successorKind` argument, and the row is never called with `preIndex`.** The matrix row resolves the actual successor and witness objects from the index it is given, which is what makes an unminted ASSUM-to-DEC successor — including a valid rerouted principal — reachable without weakening any row. Persisted validation calls the same shared row with its own index, for every existing transition, in the original order; typed packet validation stays at `validateGovernanceRulings` after the matrix, and persisted id claims stay interleaved with their object checks.

**Refusal-code distinction, preserved:** R1–R4 argument and relationship misuse is `E_API_ARGUMENTS`; a global id collision keeps the source-owned `E_DUPLICATE_ID` / `E_ID_PAYLOAD_CONFLICT` and is never relabelled as API misuse. `validateAll` and `validateStoreSchema` are never run on `U`, and the excluded future-lifecycle checks are enumerated in that amendment.

**What the operation does not own, and this controller therefore does itself:** per-finding evidence coverage (§D9.1c), the body comparands it needs (§D9.1b), witness novelty (§D9 step 2), task/fingerprint binding (§D9.2, §D9.4) and the shared `resolutionGroupDigest` comparison. The operation is not given the semantic-evidence list those checks need, and no success of it may be presented as covering them.

### D9.1b The authoritative body comparands

`FindingIdentity` deliberately carries no body digests, and a locked not-ready review may have no committed batch — so there is no committed record to read them from. The one already-declared retained owner is the **locking admission's retained payload**, and invariant 12 is what makes "the locking admission" well defined.

```
lockingAdmission = admission(currentAdmissionId)     // invariant 12: exists in epoch.admitted, and
                                                     // lock.fingerprint === its fingerprint
bytes  = read(lockingAdmission.retainedPayloadPath)
require rawSha256(bytes) === lockingAdmission.payloadRawDigest        // HASH BEFORE PARSE
                                                                     // else E_LOOP_PAYLOAD_MOVED
parsed = JSON.parse(bytes)
require EVERY §D8.1 step 3 admitted claim at its exact nested path, including
        parsed.batchRecordId === lockingAdmission.batchRecordId       // else E_LOOP_CLAIM_MISMATCH
```

Then, **per `findingKeys` identity**:

```
matches = parsed.batchSnapshot.results
            .filter(r => canonicalJson(r.testRef) === canonicalJson(identity.testRef))
require matches.length === 1                    // a UNIQUE result, not merely one that exists
result  = matches[0]
require result.findings.some(f =>
          f.kind === identity.kind
          && canonicalJson(f.binding ?? null) === canonicalJson(identity.binding))
```

Both requirements come **before** any evidence comparison: a duplicate `testRef` would make "the" result ambiguous, and a result carrying no finding of that kind and binding is not the retained finding at all. `result.observedBaseBodyDigest` and `result.observedHeadBodyDigest` are then the authoritative comparands, on exactly the sides that exist.

**The current review file and current source are never consulted for these values.** Both are legitimately editable after admission (§D5.2), which is the entire reason the payload was retained. This read is bounded to `openEpoch` while `status === "locked"`, for the admission `currentAdmissionId` names, and §D16 states it as the one exception to "a terminal admission's payload is not read again". §D8.5's unlink ownership rule is unchanged by it.

### D9.1c Per-finding semantic-evidence equality, before the group digest

Computing `resolutionGroupDigest` over a declared ref list proves the witness cites *that list*. It proves nothing about whether the list covers the advertised findings. The coverage connection is therefore made **first**, for **both** persisted and draft candidates, using the predicates the writer already charges in `assertFindingResolution`.

For each `identity ∈ findingKeys`, at least one `ref ∈ semanticEvidenceRefs` must resolve — in the validated store or among `governance.recordsToCreate` — to a record `ev` satisfying **all** of:

| check | source predicate |
|---|---|
| `ev.kind === "review-ruling"` | `:3284-3290` |
| `principalsEqual(ev.by, {kind:"discipline", discipline:"test"})` | `principalsEqual`, `:3300` |
| `ev.subjectRef === identity.binding.clauseRef` | `:3300` |
| `ev.taskId === state.taskId` | `:3353` |
| `canonicalJson(ev.testRef) === canonicalJson(identity.testRef)` | `:3360` |
| `ev.findingKind === identity.kind` | `:3366` |
| `canonicalJson(ev.binding) === canonicalJson(identity.binding)` | `:3372` |
| both body digests against §D9.1b's comparands, on exactly the sides that exist | `:3381-3393` |

Any uncovered `identity` is `E_LOOP_WITNESS_UNAUTHORIZED`. **Only then** is `resolutionGroupDigest({subjectRef, action, successor, semanticEvidenceRefs})` computed and compared with the resolved witness's own coverage digest — the same `E_WITNESS_COVERAGE` rule the writer charges, so an advertised witness cannot differ from the cited one. The group is **never** derived from "every cited record".

All of §D9.1b and §D9.1c is controller-owned. The approved operation of §D9.1a owns none of it, and no value is fetched from a `FindingIdentity` field that does not exist.

### D9.2 Branch — semantic-reconsideration, and the locked set

`Lock.lockedFindings` is taken **from the locking admission's retained `findingIdentities`**, never from a re-read of the input files — a `cap-exhausted` lock can occur long after admission, and re-reading would let a later edit move it. Entries are `FindingIdentity`, sorted by `canonicalJson([testRef.path, testRef.adapterId, testRef.structuralId, kind, binding])` and **deduplicated on the full tuple including `binding`**: two findings identical but for their binding are two entries and are never collapsed. Two entries identical in every member follow the reviewer's own duplicate contract; where that contract does not permit them, the review is rejected `E_LOOP_REVIEW_INVALID` rather than silently merged.

- **`semantic-reconsideration`** compares against the **general subset** — `kind ∈ {wrong-tag, missing-source, scope-violation}` — and `findingKeys` must equal it exactly.
- **`transition-governance`** uses a **non-empty subset** of the `assum-reading-change` identities.

**Its two sources, finitely.** `source:"persisted"` reads the `loopReconsideration` carrier **directly** from the validated store under `recordId`; §D9.4's checks run against that stored record and `packageDigest = null`. `source:"draft"` uses `package.witnessDraft` as the carrier, with the digest derived internally. Neither path dereferences a package member that does not exist.

**This branch invokes NONE of §D9.1a, §D9.1b or §D9.1c.** It authorizes no transition, so there is nothing for the pure operation to charge; it declares no `semanticEvidenceRefs`, so §D9.1c has nothing to iterate; and it needs no body comparands, so §D9.1b's retained-payload read must not run — gating an empty-whole-locked-set unlock on a payload read it has no use for would be a requirement with no purpose. Its whole content is §D9.4's carrier and annotation checks against the exact general locked set, including the genuine empty-whole-set rule below. It grants review budget only.

**The empty locked set.** Two states legitimately reach a lock with `lockedFindings: []` — an eighth clean review that commits and then fails Step 6 on freshness, and an eighth clean review that verifies and is then cap-locked by §D4 step 2. The rule turns on **why** the general subset is empty:

- **the ENTIRE locked set is empty** — nothing was found, so nothing is being waived, and `findings: []` is a *true* statement about the locked set. A genuinely new, task- and fingerprint-bound `loopReconsideration` (§D9.4) **authorizes** another budget;
- **the locked set is non-empty but purely `assum-reading-change`** — the general subset is empty only *because every finding is an ASSUM finding*. `findings: []` would then name none of the real findings while granting budget past all of them. **Refused**, `E_LOOP_WITNESS_UNAUTHORIZED`. Those go through transition-governance, which has a non-empty subset to work with;
- **mixed** — the general subset is non-empty and must be matched exactly, as above.

Budget approval resolves no ASSUM obligation and no Step 6 obligation. An empty-lock unlock grants another review; the freshness failure that caused the lock survives it, and the next round must actually converge.

The retained locked identity is **never modified**: the package supplies the **new** chosen action and witness, matched against it. A locked entry is not required to have already carried a witness.

**No `plan-resume` record kind exists.** A legitimate `plan-gate` or `review-ruling` may be cited; a `resume-task` membership change is not a witness; `append-source` alone unlocks nothing; an inventory edit alone unlocks nothing.

### D9.3 `packageDigest` — non-circular

```
packageDigest = sha256Hex(canonicalJson({
  recordId, branch, findingKeys: <sorted FindingIdentity list>, transitionDraft,
  successorClauseDraft, witnessDraft, semanticEvidenceRefs: sortTypedRefs(...) }))
```

It covers the package's **declared** fields only and never any `pending` field, so `Chosen.witness = {kind:"draft", recordId, packageDigest}` is a one-way reference with no circularity. **No undeclared field enters this hash**: any value the algorithms need is either already in this preimage or is derived from it, and adding a new one requires declaring it in §D5.5 and adding it here in the same edit. A persisted witness has no package and therefore no digest.

### D9.4 The `loopReconsideration` annotation

A downstream annotation on the **existing** `review-ruling` carrier. `recordPayloadComplete` (`:692-710`) tolerates extra fields by design and requires only `{recordId, by, subjectRef, ruling}` with a reviewer principal — **no new `rulingKind` enum, no store schema change**.

```
review-ruling {
  recordId, by, subjectRef, ruling,
  loopReconsideration: {                       // CLOSED: exactly these four members
    taskId, lockedFingerprint,
    findings: [ FindingIdentity … ],
    decision: "re-review" } }
```

Checks: `by` is exactly `{kind:"discipline", discipline:"test"}` or `{kind:"arbiter"}`; `subjectRef === taskId`; exactly the four members; **`taskId === state.taskId`**; `lockedFingerprint === lock.fingerprint`; `decision === "re-review"`; `findings` equals the **general subset** of `lock.lockedFindings`, **and if `findings` is empty then `lock.lockedFindings` must itself be empty**; and the carrier is new-and-unconsumed per §D9 step 2.

It grants **another review budget only**: it resolves no finding, approves no clause change, supplies no ASSUM governance and waives no Source or plan rule.

### D9.5 The atomic close/open transition

Any pending intent and any pending attempt slot are resolved first (§D4.1, including the admission closure a resolved verification slot forces). Then, in **one** published state:

**Reset:** `epoch = {ordinal: previous+1, openedBy: witness, admitted: []}`; `closedEpochAdmissions += <the closed epoch's admitted count>`; `observedEpochs += 1`; `lock = null`; `status = "open"`; `currentAdmissionId = null`; **`committed = null`**; **`lastEmission = null`**; **`pending = []`**; **`currentPassInvalidated = true`**.

**Preserved:** `observedIterations`; both `counters.*.observed` and `counters.*.uncertain`; **`counters.lastStaleSubject`**; `lastTwo`; `knownRecordIds`; `knownDraftIds`; `consumedWitnesses`; completed `attempts.*` slots with their own `epochOrdinal`.

`committed` is cleared rather than weakening invariant 11: the record and the TaskState head live in the store, so no evidence is lost — `committed` is controller bookkeeping, and a cross-epoch copy of it would let a stale identity satisfy §D12's gate.

**`pending` is cleared** because it is exactly the declarations cross-checked against the *admitted review of the epoch just closed* (§D5.5), and `commitReady` reads "`pending` is empty" (§D5.8). Carrying stale declarations forward would let the closed epoch's coverage satisfy or block the next one. Nothing depends on its survival: §D9.1 derives unlock coverage from the retained `lock`, never from `pending`.

**`lastStaleSubject` is preserved because it is telemetry, not an association.** `lastEmission`, `currentAdmissionId` and `committed` are pointers into the epoch just closed and would dangle. `lastStaleSubject` sits beside a cumulative, monotonic `staleBatchRejections.observed` whose scope is the retained controller window (§D10); clearing it would publish "three stale refusals happened and none had a subject".

Invariant 2 holds before and after because the transfer and the reset are the same transition; invariants 11 and 12 hold vacuously; invariant 8 holds because `currentAdmissionId` is null.

---

## §D10. Counters and the ledger

The eighteen §11 keys keep their **names and types** exactly. This amendment changes the **ownership and scope** of the following five and of the combined convergence result, and no other key's semantics or literals move:

| key | change |
|---|---|
| `reviewLoopIterations` | = `observedIterations`, scoped to the retained controller window |
| `convergenceEpochs` | = `observedEpochs`, cumulative across all epochs of that window |
| `adapterMisses` | scope fixed to actual observed pipeline invocations under the approved E1 allowlist |
| `staleBatchRejections` | scope fixed to main-thread `recordVerification` consumer refusals with `E_STEP6_SOURCE_STALE` **only**; a §D8.4 misbinding is never counted here and fabricates no counter |
| `lastStaleSubject` | the **named head ref string**, `string | null`, never a typed object |

- Both loop counters are documented as **"since this loop control was established"**, `priorHistory` stays `"unknown"`, and both report `"unknown"` when the control evidence is unavailable, invalid or corrupt.
- **Available for validated tasks with a null head, a legacy head, or a failed emission** — loop metrics do not depend on a v2 head, and no semantic inventory fact is invented in those states.
- `adapterMisses` counts **actual observed pipeline invocations**, each contributing its own **first** `(class, code)` under the approved E1 allowlist. The **emit** call and the **observe** call are two separate invocations. **Only an approved `(class, code)` refusal counts**; every other observer failure is non-gating and contributes **0**. Store, producer, registry, artifact and Git errors stay excluded, as do `E_API_ARGUMENTS` and `E_VIEW_INPUT`.
- Each counter is `{observed, uncertain}`; **the ledger collector is the only place that projects `"unknown"`** — it reports `observed` when `uncertain === false`, else `"unknown"`. `inspectLoopState` reports the raw pair (§D3.2). Known counts stay monotonic; an unknown outcome is **never** zero, and replacing an already-aggregated completed detail changes no known count.
- `evaluateGate` and `inspectLoopState` **write no counter** and claim no attempt a past main thread did not make.

`converged` remains the required combined boolean: the collector's own independent current-consumer identity proof **plus** a read-only loop inspection. Both must hold.

---

## §D11. Integration

- **`vigil/SKILL.md`** — the seven-step order with the controller operations named. The pre-review default `contract-check` keeps its position and its exit 0; the ordinary repair cap of 2 stays a separate counter.
- **`references/review-packet.md`, `references/reviewer-selection.md`, `agents/test-reviewer.agent.md`** — **TP §9: a real test-reviewer runs whenever the current inventory is non-empty, including a governance-affected-only inventory.** No evidence substitution and no undefined "equivalent semantic gate". The reviewer returns its batch; the main thread persists the exact bytes.
- **`agents/arbiter.agent.md`** — the arbiter is **read-only** and makes one `evaluateGate` call, which **must** run a fresh named Step 6 consumer for a `provenance` pass and returns separate `loop` and `provenance` predicates. Never a cached result, a ledger value or a caller boolean.
- **`docs/runtime-contract.md`, `references/run-ledger.md`** — the reserved prefix, its exclusion and its precedence over trackedness; the controller's files; the counter scope.

### D11.1 The ledger collector

**Five high-level observations, in this order.** They are not five filesystem reads: `inspectLoopState` performs its own validated store read, so the literal count is higher. What this section fixes is the **order**, the **two** inspections and the **exactly one** consumer:

1. `inspect₁ = inspectLoopState({repoRoot, taskId})`;
2. its **own** validated store read — `loadStore` → `validateStoreSchema` → `validateAll` → `indexStore`;
3. **exactly one** `verifyCommittedBatch({repoRoot, taskId})`;
4. a **fully validated** store after-read, the same four calls again — retained from the accepted E1 collector, because it is what refuses a preserved ref whose typed kind, record or base validity changed while still **accepting an unrelated valid append**. A bare re-read cannot distinguish those, and whole-store-byte equality would reject the legitimate append;
5. `inspect₂ = inspectLoopState({repoRoot, taskId})`.

The collector **never** calls `recordVerification`, **never** calls `evaluateGate` (which would run a second consumer), never mutates and never accepts a caller verdict.

**Movement gate:** `inspect₁` and `inspect₂` must agree on `revision`, `status`, `epochOrdinal`, `currentAdmissionId`, `currentAdmissionPhase`, `currentPassInvalidated` and `canonicalJson(committed)`. Disagreement fails the **loop** half only.

**Loop half**, from `inspect₁` plus the collector's own store read: `status === "open"`; `currentAdmissionId !== null`; `currentAdmissionPhase === "verified"`; `currentPassInvalidated === false`; `committed !== null`; `committed.admissionId === currentAdmissionId`; `canonicalJson(committed.headRef) === canonicalJson(ts.committedProvenanceBatchRef)`; `canonicalJson(committed.expectedBatchRecord) === canonicalJson(index.records.get(committed.headRef.ref))`; `inspect₁.taskId === taskId`; `canonicalJson(inspect₁.baseProvenance) === canonicalJson(ts.baseProvenance)`. Those last four comparisons are why §D3.2's inspect projection carries `taskId`, `baseProvenance`, `committed.admissionId` and the complete `committed.expectedBatchRecord`.

**Provenance half**, computed independently from the collector's own verdict and its own store reads: the seven identity fields against the TaskState, the named record and `batchInventoryPreimage`, plus the step-4 after-read. **Loop-state movement invalidates the loop half only** and never a provenance result the collector proved itself.

`converged = loopHalf && provenanceHalf`. **Metric cases.** With `present === true` and `diagnostic === null`, `reviewLoopIterations`/`convergenceEpochs` come from `observedIterations`/`observedEpochs` and both counters project by their `uncertain` flags — available for a null head, a legacy head or a failed emission, with `converged: false` simply because there is no consumer pass. With `present === false` **or** `diagnostic !== null`, `counters === null`, every loop metric projects `"unknown"` (never zero), `converged: false`, and the remaining keys keep their own unavailable semantics. All eighteen names and types are unchanged.

---

## §D12. The gate procedure

### D12.1 `evaluateGate`

**Sources, each named and ordered:**

0. **before-inspection** — a read-only load of the control state capturing `revision`, `status`, `epoch.ordinal`, `currentAdmissionId`, that admission's `phase`, `lock`, `currentPassInvalidated` and `committed`. Without a declared baseline, "unchanged" below would have nothing to compare against;
1. **validated current store** — own `loadStore` → `validateStoreSchema` → `validateAll` → `indexStore`;
2. **TaskState** — `taskId`, full `baseProvenance`, typed `committedProvenanceBatchRef`;
3. **named record** — `records[headRef.ref]`: `batchDigest`, `taskId`, `previousBatchRef`;
4. **committed inventory headers** — via `batchInventoryPreimage(record)`: `baseTreeOid`, `headViewDigest`, `registryDigest`, `inventoryDigest`. These are the H/R comparands;
5. **the fresh named consumer verdict** — required for a `provenance` pass;
6. **store after-read** — repeat 1–4 **fully validated**, not a bare re-read;
7. **control after-inspection** — repeat 0 and compare field by field with it.

**The two after-reads belong to different predicates**, and conflating them would relabel a passed consumer as failed because unrelated control state moved:

**`provenance.pass`** = the fresh verdict's seven identity fields each equal to their source in 2–4, **and source 6 unchanged**. It is computed **independently** and is still reported when `loop.pass` is false — including when the control state is absent, corrupt or context-mismatched, wherever valid metadata allows it. Its `verdict` field is the `CommittedVerdictProjection` derived from the fresh run; any cause encountered while computing it is reported in `provenance.diagnostic`, with `code: null` when the cause has none.

**`loop.pass`** =

```
status === "open"
∧ currentAdmissionId !== null ∧ admission(currentAdmissionId).phase === "verified"
∧ currentPassInvalidated === false
∧ committed !== null ∧ committed.admissionId === currentAdmissionId
∧ committed.headRef ≡ the current validated typed head
∧ committed.expectedBatchRecord ≡ the named record, field by field
∧ source 7 equals source 0        // else loop.reason = "state-changed-during-evaluation"
```

`combined = loop.pass && provenance.pass`. Read-only unknown history is **never** a known pass. No counter is written at any step, and only `E_API_ARGUMENTS` escapes.

---

## §D13. Typed failures

`E_API_ARGUMENTS`, `E_LOOP_UNKNOWN_TASK`, `E_LOOP_CONTEXT`, `E_LOOP_STATE_CORRUPT`, `E_LOOP_LOCKED`, `E_LOOP_LOCK_HELD`, `E_LOOP_NO_EMISSION`, `E_LOOP_EMISSION_SPENT`, `E_LOOP_ADMISSION_OPEN`, `E_LOOP_INTENT_UNRESOLVED`, `E_LOOP_ARTIFACT_MOVED`, `E_LOOP_PRESTATE_MOVED`, `E_LOOP_REVIEW_INVALID`, `E_LOOP_CLAIM_MISMATCH`, `E_LOOP_PAYLOAD_MOVED`, `E_LOOP_NOT_COMMIT_READY`, `E_LOOP_CAP`, `E_LOOP_ATTEMPT_SPENT`, `E_LOOP_NO_COMMIT`, `E_LOOP_VERIFICATION_MISBOUND`, `E_LOOP_NOT_LOCKED`, `E_LOOP_WITNESS_NOT_NEW`, `E_LOOP_WITNESS_UNAUTHORIZED`, `E_LOOP_COMMIT_CONFLICT`, `E_LOOP_ID_EXHAUSTED`, `E_LOOP_IO`.

**Upstream typed causes — the canonical reader's, the store's, the preview's, the prospective operation's, the writer's, the consumer's, the emitter's, the observer's — keep their identity.** Where an operation throws, they propagate unchanged. Where an owned attempt returns a structured outcome (§D3), the actual `class` and `code` are carried verbatim in that outcome, with `code: null` when the cause has none. No controller code invents, remaps or discards an upstream code.

**Claims each success may make.** `runProposalIteration`: this controller emitted, with the recorded return and the §D4 bindings — not that the world is unchanged afterwards. `submitReviewedProposal`: the bytes passed raw and canonical validation and every claim matched the emitted content — **not** that the reviewer ran. `commitReviewedBatch`: the named record exists matching the retained expected record — not a Step 6 pass and not a replay of every effect. `recordVerification` with `historical:true`: what was recorded, not a fresh evaluation. `openEpoch`: the offered witness was new, authorized and covering — not that any finding was resolved. `evaluateGate`: a fresh consumer pass **and** an unlocked, verified, identity-matched loop state.

---

## §D14. Acceptance matrix

**Positive.** The clean first cycle, and a second commit whose prepare publication clears the prior `committed` in the same state. An ordinary non-ready or refused admission below the cap leaves the epoch **open** and a new emit/review proceeds. The eighth unique commit-ready admission verifies and converges, and stays converged until a new cycle is requested. A cap-locked epoch unlocks on a fresh witness, preserving cumulative counters, `lastStaleSubject` and `lastTwo`, and clearing `pending`. An empty **whole** locked set unlocks on a genuine task- and fingerprint-bound `loopReconsideration` with `findings: []`, from a persisted carrier or a drafted one. A **persisted** transition-governance witness authorizes through its single matching `governance.resolutions` group with `findingKeys` derived from the retained lock; a **draft** one authorizes through its package with an internally derived `packageDigest`. An unrelated valid store append between the collector's reads leaves identities and counts intact. Ordinary `.ctide/output/` loss preserves locks, counters, baselines and admissions. Two tasks run concurrently on distinct `task-<h>` files. A persisted witness and a draft witness each open an epoch on their own branch, the draft's `packageDigest` derived internally. Legitimate ASSUM→DEC rerouting with an **unminted** successor authorizes. A `historical-convergence` resolution commits **without** any `semanticEvidenceRef` or new group. A valid this-round reference to a **prior** transition commits with no new group. Loop metrics are available for a validated task with a null head, a legacy head or a failed emission. A permuted inventory **root** member order is accepted.

**Negative, one variable each.** The three §D1.1 key pairs address distinct files. Cross-task or base-witness mismatch → `E_LOOP_CONTEXT`, **with no reset**. Raw duplicate member in **either** input → refused before parsing. Wrong **entry or nested** member order in the inventory subtree → refused. Missing `baseProvenance` or `inventorySnapshot` → `E_LOOP_REVIEW_INVALID`. Batch-level `resolutions` → refused as undeclared. `resolutionCarrierUpdates` with an extra or missing key for its action → refused. Incomplete one-to-one coverage → `E_LOOP_CLAIM_MISMATCH`; a missing `PendingDeclaration` for an unresolved finding → `E_LOOP_CLAIM_MISMATCH`. A forged or malformed resolution claim → `E_LOOP_REVIEW_INVALID` **before admission, nothing counted**; a valid finding with **no** `resolutionRef` → admitted, counted, `commitReady:false`. Artifact replaced with **different** bytes → `E_LOOP_ARTIFACT_MOVED`; byte-identical replacement is **undetectable** and asserted as such. Pre-state moved → `E_LOOP_PRESTATE_MOVED`. Retained payload replaced before commit → `E_LOOP_PAYLOAD_MOVED`, no preview, no writer, and a resumed prepared intent **cleared** in the same publication. An admitted claim moved at any of its nested paths → `E_LOOP_CLAIM_MISMATCH`, same disposition. `compatibility` stated on a retire/revise/non-REQ path → `E_COMPAT_FORBIDDEN`. First submission does **not** self-match. A→B→A → third admitted, counted once, `wasSeen`, appended **already** `closed` with `lock{reason:"repeat"}` in one publication, its computed `commitReady` recorded unchanged — and an interruption anywhere leaves either the untouched prior state or that final closed state, never an intermediate `open` one that row 4 would let commit. An unready proposal likewise appears only as `closed`, so it can never become the emission-blocking, commit-refusing, retry-idempotent dead end an intermediate `open` publication would create. Changed bytes under an admitted emission → `E_LOOP_EMISSION_SPENT`. Exact retry → idempotent, no second count, regardless of `pendingCommit`. Ninth submission → `E_LOOP_CAP`, no admission; a ninth **emission** request → cap lock **before** any external work, nothing counted. A new emission attempted while the current admission is `committed` → refused, so its owned verification chance is never orphaned. A drafted id colliding with **any** pre-state section, or two drafted ids colliding with each other → `E_DUPLICATE_ID` / `E_ID_PAYLOAD_CONFLICT`, detected before indexing. A recovered pending verification slot → the admission it names is **closed** in the same publication, never left `committed`. A `findings: []` reconsideration against a purely-ASSUM locked set → `E_LOOP_WITNESS_UNAUTHORIZED`. Zero or two `governance.resolutions` groups matching a persisted witness → `E_LOOP_WITNESS_UNAUTHORIZED`. A `findingKeys` identity with no **unique** matching retained result, or a result carrying no finding of that kind and binding, or an identity no declared evidence ref covers → `E_LOOP_WITNESS_UNAUTHORIZED`, **before** any group-digest comparison. A retained payload whose hash or admitted claims moved, read at unlock → `E_LOOP_PAYLOAD_MOVED` / `E_LOOP_CLAIM_MISMATCH`, no unlock. Old unconsumed record for a later epoch → `E_LOOP_WITNESS_NOT_NEW`. Wrong principal or wrong `lockedFingerprint` → `E_LOOP_WITNESS_UNAUTHORIZED`. Preview refusal → admission closed, **no writer invocation**, upstream class and code preserved in the returned outcome, epoch open below the cap. Prepared-crash with no record → resumable once, no duplicate. Prepared-crash **with** a matching record → adopted without re-writing. Attempted-crash with no record → `unknown`, **spent, never retriable and never reset to `prepared`**. Conflicting head → `E_LOOP_COMMIT_CONFLICT`. A consumer pass for a head this admission did not commit, or a validated after-read whose full task/base/head/expected-record identity disagrees → `E_LOOP_VERIFICATION_MISBOUND`, `ok:false`, **no stale counter**. A second `recordVerification` → `historical:true`, existing `attemptId`, derived `ok`, no consumer run, no count — and after an epoch open, `E_LOOP_NO_COMMIT` rather than a borrowed prior-epoch outcome. A refused, misbound or unknown verification through the CLI → stderr, exit 1. Path escape or symlinked prefix component → `E_LOOP_IO` **before any lock or read**. A store fault inside **either** read-only operation → reported in its own closed diagnostic with the actual class, message and `code` (or `code: null`), never relabelled and never escaping; only `E_API_ARGUMENTS` escapes. `evaluateGate` / `inspectLoopState` create nothing, reconcile nothing and mutate nothing; a control-state change during evaluation fails `loop` only, never a passing `provenance`. Protected A–C and E1 regressions unchanged: producer, writer, consumer, artifact, observer, collector and the head-view exclusion controls.

**Platform.** Every claim reflects actual execution on the machine the tests run on. **No Linux claim and no READY claim.**

---

## §D15. Approved normative deltas

1. The `.ctide/test-provenance-loop/` hard-exclusion prefix, before trackedness, with its stated cost.
2. The closed `loopReconsideration` annotation, including the empty-whole-locked-set rule.
3. The retained-controller-window scope for `reviewLoopIterations` and `convergenceEpochs`.
4. §D7's admission/cap/eighth rule and §D4's cap-before-external-work guard, a deliberate amendment of the cap's tie ordering.
5. §D5.6's allocate-retain-admit order, which is what makes the retained payload binding real.
6. §D8.5's immediate-only cleanup ownership rule, with resolved historical payloads retained.
7. Invariant 12, and §D9.1b's bounded terminal-payload read that depends on it.
8. §D8.4's verification-misbinding refusal and its required fully validated after-read.
9. §D9.1's persisted/draft witness split, with `findingKeys` derived from the retained lock.

TP v1.19 and TP v1.20 remain separately approved and unchanged; this amendment only calls them.

---

## §D16. Limitations

After **total** loss of the control prefix the **old baseline is gone**: `consumedWitnesses` and `knownDraftIds` history is **unknowable**, and the current record set is a **new snapshot**, not a survival. A fresh budget results. That is a disclosed limitation, not tamper-proofness.

Retained payloads accumulate. Under §D8.5 a payload is unlinked only by its own creating invocation on a proven failed publication, so resolved historical payloads remain on disk for the life of the control prefix. They are read again in exactly **one** bounded case: `openEpoch` on the **transition-governance** branch, while `status === "locked"`, reads the payload of the admission `currentAdmissionId` names — the locking admission, by invariant 12 — through §D9.1b's hash-then-claims gate, for body comparands available nowhere else. The semantic-reconsideration branch invokes §D9.1b not at all and reads no payload. No other operation reads a terminal admission's payload, and §D8.5's ownership rule for unlinking is unchanged by that read. The disk cost is accepted in exchange for never deleting an artifact whose ownership is uncertain.

A byte-identical artifact replacement is undetectable. No atomicity exists across the semantic store and this bookkeeping; §D8.3 is reconciliation from durable evidence on both sides. A lost Step 6 outcome or failure count is never reconstructed by rechecking. Monotonicity is enforced across cooperating transitions only. The approved prospective-authority operation proves matrix authority for a budget and nothing about a completed transaction, and its success is never evidence of finding coverage, witness novelty or evidence equality — all of which this controller owns.
