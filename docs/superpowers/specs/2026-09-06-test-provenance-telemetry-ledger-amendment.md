# Test-Provenance E1 amendment — run-ledger telemetry types and the runtime-ledger head exclusion

**Status: APPROVED — test-provenance v1.18 (E1 amendment), effective 2026-09-06.**

Codex approved this amendment under the user's existing delegated planning/review authority after the recorded Claude Code discussions and independent source/API checks; this is not a new direct user approval or a panel decision. The current approved coupled set is **shared decision-provenance model v1.15 + intent-scan v1.10 + test-provenance v1.18**. TP v1.18 consists of the v1.17 base document with ONLY the scoped E1 deltas in this amendment applied; all other normative requirements remain effective. Upstream normative text is unchanged. Approval makes these E1 requirements effective and permits separately released implementation; it does not accept any implementation, release D loop control, or establish whole-flow readiness. See the independent decision in [the E1 specification review](../reviews/2026-09-06-telemetry-ledger-spec-codex-review.md). Earlier status statements in the base document remain historical records.

Written by Claude Code (claude-opus-5, xhigh) under the user's existing project-only authorization, against Codex's E1 settlement. Codex reviews and decides.

---

## 0. Scope

**In scope (E1).**

- TP §11's eighteen `testProvenance` field names, their declared types, their sources and their absence/unknown behaviour.
- Four metric definitions that §11 names but does not define operationally: `oracleDepTriggered`, `governanceAffectedEntries`, `assumTransitions`, `adapterMisses`.
- The E1 product boundary: one observer operation and one ledger block builder, with their exact requests, their closed shapes, and the ordering constraint that makes the observation meaningful.
- Exactly one head-universe delta at §11b.10: adding the runtime-owned ledger directory prefix to the closed hard-exclusion set, with the corresponding AC130/AC131 control obligations.

**Explicitly out of scope.**

- **D — the fixed-point / review-loop controller.** Its state placement, its persistence, its exclusions and its authority predicates remain OPEN. This amendment adds **no** loop-control exclusion, defines **no** loop-control path, and specifies **no** loop operation. Where a §11 field depends on loop evidence, this amendment specifies only its *unknown* behaviour (§A).
- **BaseAdapterContentView.** TP ~2347 states that the base capture enumerates **all leaf entries** of B and **does not** apply the head hard exclusions (`.git/**`, `.ctide/provenance.json`, `.ctide/output/**`) and **does not** apply any `.gitignore`, because B is an immutable committed tree. The §D delta below is a **head-universe** rule only and **must not** be extended to B.
- **Any broadening to `.ctide/**`.** The delta is one exact prefix.
- **Config observability and ignore authority.** The `.ctide/test-adapters-config.json` exact-path exception (§11b.10 step 2, AC130/AC131 v1.11) is unchanged, and the ignore authority remains tracked `.gitignore` bytes in S1 and nothing else.
- **Producer, writer and committed-batch consumer semantics and public requests.** Unchanged.

---

## A. TP §11 — the eighteen fields

The key names and their meanings are those of approved §11, and the table below is written in **approved §11's own order** (`taggedTests` … `droppedForNoSource`, with `governanceAffectedEntries` at position 6, before `reviewLoopIterations` and `convergenceEpochs`). A field's position carries no meaning of its own; the numbering exists only so the situation matrix and the metric sections can refer to a field without repeating its name. This amendment changes **declared types** (adding an `"unknown"` union member to fields that can be unobservable) and adds **source and absence rules**. It adds, removes and renames no key.

### A.0 Two words that must not be confused

- **`null` — established absence.** Validated authority was reached and it says the thing is not there. Example: a validated store whose TaskState carries `committedProvenanceBatchRef: null`.
- **`"unknown"` — unavailable observation.** The authority that would decide was not reached, or its proof was not available. It is a **literal string** in an explicit union, following the pattern §11 already uses for `droppedForNoSource: number | "unreported"`.

`"unknown"` **must never** be promoted to `null`, to `0`, or to `false`. A consumer that coerces `"unknown"` to a number is non-conforming.

**One exception, and only one.** `converged` (field 9) is a **combined fail-closed gate result**, not an observation. A gate whose evidence is `"unknown"` is a gate that has not been positively established, and a fail-closed gate returns `false` in that case. This is the gate returning its closed default, not the promotion of an unknown to a value. The exception applies to field 9 alone and to no other field in this block.

**Numeric constraint.** Every numeric count in the block is a finite non-negative safe integer (`Number.isSafeInteger(n) && n >= 0`). A value outside that range is not written; the field takes `"unknown"`, except `droppedForNoSource`, whose unchanged absence literal is `"unreported"`.

**Grouped counts are whole-object.** `taggedTests`, `inventory` and `findingKinds` are each produced by one traversal over one proof. When that proof is unavailable the **whole object** is `"unknown"`; individual members are never separately unknown. This is deliberate: a partially populated group would read as a measurement of the members it happens to carry.

### A.1 Per field

| # | field | declared type (v1.18 E1) | source |
|---|---|---|---|
| 1 | `taggedTests` | `{REQ,DEC,ASSUM,EXPL}` \| `"unknown"` | canonical v2 inventory entries: the **head-side** tag when present, else the **deleted base-side** tag; a `null` tag contributes to no counter; `{expl:true}` counts to `EXPL`. Not repo-wide. |
| 2 | `inventory` | `{added,modified,deleted,retagged,moved}` \| `"unknown"` | entry `status`, five of the six §6 statuses. `governance-affected` is **not** counted here (field 6). |
| 3 | `findingKinds` | `{"wrong-tag","missing-source","scope-violation","assum-reading-change"}` \| `"unknown"` | `batchSnapshot.results[].findings[].kind`, **only** after the results' structure and their one-to-one binding to inventory entries have been validated. |
| 4 | `entriesWithoutFindings` | `number` \| `"unknown"` | the same validated pairing: entries whose paired result carries an empty `findings` array. Gated with field 3 — if that proof is unavailable, so is this. |
| 5 | `oracleDepTriggered` | `number` \| `"unknown"` | the bound sidecar observation (§B.1, §C.1). |
| 6 | `governanceAffectedEntries` | `number` \| `"unknown"` | count of canonical inventory entries with `status === "governance-affected"` (§B.2). |
| 7 | `reviewLoopIterations` | `number` \| `"unknown"` | D's validated loop-control evidence. **`"unknown"` throughout E1.** |
| 8 | `convergenceEpochs` | `number` \| `"unknown"` | D's validated loop-control evidence. **`"unknown"` throughout E1.** |
| 9 | `converged` | `boolean` (required, never unknown) | the combined result of two independent gates (§B.5). |
| 10 | `taskId` | `string` \| `null` \| `"unknown"` | the provenance TaskState id, validated present in a validated store. |
| 11 | `inventoryDigest` | `string` \| `null` \| `"unknown"` | the **committed `inventorySnapshot`'s own** digest. |
| 12 | `batchDigest` | `string` \| `null` \| `"unknown"` | the exact committed head record's `batchDigest`. |
| 13 | `provenanceBatchRef` | `{kind,ref}` \| `null` \| `"unknown"` | validated `TaskState.committedProvenanceBatchRef`, read as an **exact ref**. §11's own reason stands: it exists so incident diagnosis never performs the forbidden `(taskId, inventoryDigest, batchDigest)` lookup. |
| 14 | `lastStaleSubject` | `string` \| `null` \| `"unknown"` | observed stale-rejection history. `null` = history exists and recorded none; `"unknown"` = no history. **`"unknown"` throughout E1.** |
| 15 | `assumTransitions` | `number` \| `"unknown"` | distinct validated cited transition refs (§B.3). |
| 16 | `adapterMisses` | `number` \| `"unknown"` | observed first typed refusals per attempted pipeline invocation (§B.4). **`"unknown"` throughout E1.** |
| 17 | `staleBatchRejections` | `number` \| `"unknown"` | observed stale-batch refusals across the run. **`"unknown"` throughout E1.** |
| 18 | `droppedForNoSource` | `number` \| `"unreported"` | **unchanged from approved §11.** Disclosure only; `"unreported"` is never read as `0`; never participates in any gate. |

**Fields 7, 8, 14, 16 and 17 are `"unknown"` for the whole E1 window** because their only honest source is validated evidence that D has not yet released. This amendment does not create a stub source for them. This is accepted **component-only** interim behaviour; see §H.1 for the consequence on field 9.

### A.2 Precedence, then the reachable situations

**Precedence — evaluated in this order, first match wins.**

1. **No identity input** (`provenanceTaskId === null`) → **no store read is attempted at all**. R1.
2. **Identity requested, current authority unavailable** — the store file is absent, unreadable, refused by `loadStore`/`parseStore`, refused by `validateAll`, or its `provenanceVersion` is not 2 → R2. An unmigrated **current v1 store is not silently accepted**; it yields no v2 identity claim.
3. **Identity requested, store validated and present, no TaskState with that id** — including a validated but empty store, which **proves** there is no such task → R1's block with `taskId: null`.
4. Otherwise, one of R3–R6 by the state of the task's committed head.

**Reachable situations.** There is no row for "validated store with a malformed v2 preimage": `parseStore` calls `assertRawInventorySnapshots`, which locates every persisted `inventorySnapshot` subtree and runs the canonical v2 reader over it, rethrowing that reader's error, so such a store never returns from `loadStore` at all. That state **is** R2 — no trusted metadata — and a row claiming otherwise would require a positive behaviour no API can produce.

| | situation | 10 `taskId` | 13 `provenanceBatchRef` / 12 `batchDigest` | 11 `inventoryDigest` | 1,2,6 | 3,4,15 | 9 `converged` |
|---|---|---|---|---|---|---|---|
| **R1** | no identity input, **or** validated store proves no such TaskState | `null` | `"unknown"` | `"unknown"` | `"unknown"` | `"unknown"` | `false` |
| **R2** | current authority unavailable (precedence 2) | `"unknown"` | `"unknown"` | `"unknown"` | `"unknown"` | `"unknown"` | `false` |
| **R3** | validated store, TaskState present, `committedProvenanceBatchRef === null` | `string` | `null` (established absence) | `null` | `"unknown"` | `"unknown"` | `false` |
| **R4** | validated store, **legacy (v1.12) batch record** at the head | `string` | known | `"unknown"` | `"unknown"` | `"unknown"` | `false` |
| **R5** | validated store, v2 head with a **valid canonical preimage**, consumer refuses (staleness / semantic binding) | `string` | known | known | **known** | `"unknown"` unless the result/resolution proof was independently established | `false` |
| **R6** | validated store, v2 head, canonical preimage valid, current consumer passes | `string` | known | known | known | known | per §B.5 |

**R2 rationale.** A store that does not load, does not validate, or is not v2 supplies **no trusted identity or ref**. Reporting a `taskId` from the caller's argument would attribute a name to a store nobody could read.

**R4 rationale (AC128).** "Legacy head" means the historical **v1.12 batch record format inside a validated current v2 store**. It never means an unmigrated current v1 store, which is precedence 2. A legacy record's `recordId` and `batchDigest` are readable history; its record-level `inventoryDigest` field exists but carries **no inventory preimage authority**, so field 11 is `"unknown"` and never that value. Legacy history stays readable and makes no v2 claim.

**R5 rationale.** The store validated and the preimage is canonical, so facts derived from the stored head — its ref, its digests, its canonical entry set and everything counted from that set — are facts **about that stored head** and remain known. They carry **no claim of current freshness**: field 9 is `false`, and a reader must not infer from a known `inventoryDigest` that the world still matches it. A valid stale head is deliberately kept distinct from an unreadable store. Findings and resolutions are different again: they need their own structure and binding proof (§B.3), and a stored `results[]` array alone is not that proof.

---

## B. Metric definitions

### B.1 `oracleDepTriggered` — non-exclusive, two-sided (clarification, not a rename)

The field keeps its approved name and its approved comment (*因 effective-oracle 依賴而入 inventory 的測試數*). This amendment states the operational definition it has always needed:

> Count the canonical inventory entries that have **both** a base side and a head side and whose `effectiveOracleDigest` differs between those two sides — **even when** the declaration body also changed, the entry moved, or the tag also changed.

- **Added and deleted entries contribute `0`.** They have no two-sided comparison, so they are outside the comparison domain. This is a **zero contribution, not an unknown count**.
- **Non-exclusivity is normative.** The metric does not claim sole causation. `effectiveOracleDigest` covers the dependency closure — whole files for contributing helper callables, byte ranges for applicable hooks — and includes dependency refs as well as digests, so a difference is an **observable contract difference**. Movement, byte-offset shifts and simultaneous declaration edits all move it too. A "but-for" reading is unsound and is explicitly rejected: movement already places a test in the inventory, so the counterfactual does not exist.
- Counted only over entries **represented in the canonical inventory**, using the accepted matcher's returned base/head locators (§C.1 step 9).

### B.2 `governanceAffectedEntries` — the exact status count

> The number of canonical inventory entries whose `status` is `governance-affected`.

This is the sixth §6 status, and §6's ordered precedence reaches it only after `added`, `deleted`, `moved`, `modified` and `retagged` have all failed. It therefore names exactly the **otherwise-unchanged siblings pulled in by the clause → test reverse closure**, which is what the field says.

**Explicitly not** a count of seed hits. A pair that moved, changed body or retagged *and* also hits the governance seed is classified by the higher-precedence row and is counted in field 2's five keys. Counting overlapping hits would double-count entries already counted and would inflate a "sibling" number with entries that entered on their own merits.

No extra capture is required for this observable: it is a projection of the entry set. It is `"unknown"` only when the entry set itself is unavailable (R1, R2, R3, R4), and it is **known** under R5 — a valid stale head still has a canonical entry set.

### B.3 `assumTransitions` — distinct validated cited refs, never mint history

> The number of **distinct** `transitionRef` values cited by `resolutionRef`s of `assum-reading-change` findings in the **named committed batch**, deduplicated by ref string, counted only when each citation has been validated.

A citation counts only when all of the following hold:

1. the finding's `kind` is exactly `assum-reading-change`;
2. its `resolutionRef` and its `binding` are structurally valid and bound to the entry's actual pre-side tag;
3. the referenced transition resolves in the store and its **`subject` is that finding's ASSUM clause**.

If that proof cannot be established — a refused batch, an unvalidated `results[]` — the field is `"unknown"`. It is **never** counted on trust from a stored array.

Three things it is not: it is not `resolutions.length` (equivalent duplicate groups exist); it is not a count over resolution groups generally (groups also concern DEC); and it is **not mint history** — a reference is not evidence that a transition was minted during this run.

### B.4 `adapterMisses` — observed first typed refusals per attempted invocation

> The number of **actual observed pipeline invocations** that failed, each contributing its **first** typed refusal, where that refusal's `(class, code)` pair is on the enumerated allow-list below.

- **Enumerated, never a regex.** Membership is by an explicit `(errorClass, code)` allow-list. A code-name pattern is forbidden: it would silently absorb future codes and cannot distinguish a source-form refusal from caller misuse.
- **`DiscoveryPreimageError`:** `E_PARSER`, `E_FORCED_SUBJECT`, `E_MANIFEST_LEVEL_UNAUTHORISED`, `E_AMBIGUOUS_EVIDENCE`, `E_UNKNOWN_ADAPTER`, `E_IDENTITY_DRIFT`, `E_DUPLICATE_STRUCTURAL_ID`, `E_ORDER`, `E_DUPLICATE_MODULE`, `E_CROSS_VIEW_ADAPTER`.
- **`NodeTestAdapterError`:** `E_MODULE_FORMAT`, `E_PACKAGE_BOUNDARY`, `E_ENTRY_TYPE`, `E_MODULE_MISSING`, `E_UNSUPPORTED_IMPORT`, `E_UNSUPPORTED_SYNTAX`, `E_PLACEMENT`, `E_DIRECTIVE_MALFORMED`, `E_DIRECTIVE_UNATTACHED`, `E_DIRECTIVE_AMBIGUOUS`, `E_DIRECTIVE_BORROWED`, `E_TAG_CARDINALITY`, `E_TID_CARDINALITY`, `E_STRUCTURAL_DUPLICATE`, `E_TID_DUPLICATE`, `E_ORACLE_BINDING`, `E_ORACLE_RESOLVE`, `E_ORACLE_UNCLASSIFIED`, `E_SNAPSHOT_FORM`, `E_SNAPSHOT_PATH`, `E_DEP_BYTES`, `E_PATH`, `E_SPECIFIER`, `E_ARGUMENTS`.
  The last three are included **because of their subject, not their names**: `E_ARGUMENTS` here refuses the *analysed module's* callback form, and `E_PATH`/`E_SPECIFIER` refuse paths and import specifiers *in the analysed source*. They are profile refusals about repository content.
- **`ExplicitConfigError` (repository config), included:** `E_CONFIG_SHAPE`, `E_CONFIG_FIELD`, `E_CONFIG_CARRIER`, `E_CONFIG_DUPLICATE_MEMBER` — and their `DiscoveryPreimageError` wrappers, **which must preserve the underlying `E_CONFIG_*` code**. The explicit config is the *user's repository content*, which is the same side of the line that excludes the shipped registry.
- **Excluded as caller misuse:** `E_API_ARGUMENTS` and `E_VIEW_INPUT` in every class.
- **Excluded entirely, and preserved separately:** registry/build (`E_REGISTRY_*`), provenance store, artifact emission, producer and Git failures. A registry or build-capability failure means discovery could not run **at all**, so there were no per-file observations to make; it remains a preserved typed failure reported outside this field. It is not a per-file claim.
- **Ordinary non-candidate files never count.** They produce no event and are simply absent from the discovery module sets.
- **Application point.** The predicate applies **only to actual observed pipeline failures after request validation**. A caller-submitted event, a caller-supplied count, or direct misuse of an adapter API is not an event.
- **Exhaustiveness disclaimer, normative.** This is a count of *observed attempts*, not an exhaustive count of unsupported modules in the repository. A fail-closed attempt exposes at most its first refusal.

**E1 value: `"unknown"`.** The E1 observer runs only *after a successful emission* and therefore cannot know about earlier failed attempts. Manufacturing an initialized `0` from a success-only sidecar is forbidden. A number becomes available when D supplies an invocation wrapper that records observed attempts.

### B.5 `converged` — required, combined, fail-closed

> `converged` is `true` **only if** both independent gates are positively established: (i) the loop gate — validated loop-control evidence showing an unlocked state matching this proposal — and (ii) the current consumer gate — `verifyCommittedBatch` passing against the **current** exact head. Anything else, including either gate being unknown, is `false`.

It is a required `boolean` and never `"unknown"`, because a gate is fail-closed: not-established is not-converged (§A.0's single exception). It must **not** be derived from the consumer alone. Component results are retained in **D's control evidence** for diagnosis; they are **not** carried in the version-1 sidecar, whose key set is closed at six (§C.2). Any additional member requires a separately approved `observationVersion` and its own control.

**E1 consequence, stated plainly:** with D unreleased there is no validated loop evidence, so gate (i) is never established and **`converged` is `false` on every E1 record**. This amendment does not add a stub to avoid that.

---

## C. The E1 product boundary

Two operations. Neither accepts a caller-supplied metric, digest, boolean or telemetry blob.

### C.1 `observeInventoryTelemetry({ repoRoot, baseTreeOid, taskId })`

**Exact three-key request.** No fourth input, no artifact path parameter, no snapshot, no captured context, no callback, no cache, and **no change to the producer's or discovery's request shapes**. The artifact path is a fixed internal constant.

**Timing, normative.** It runs **after a successful emission and before the Step 5 committing write**.

**What it does and does not prove.** This operation validates the artifact it reads and binds its observation to that artifact's identity. It **does not, by itself, prove that a fresh emitter invocation produced that artifact** — it has no access to the emitter's return value and must not pretend otherwise. The *caller's* sequence is what must require actual emission success; binding an invocation to a proposal is D's obligation (§H.2).

**The envelope carries no explicit task identity.** `V2_INVENTORY_KEYS` is exactly seven members — `inventoryVersion, baseTreeOid, registryDigest, headViewDigest, inputProvenanceStoreDigest, entries, inventoryDigest` — and the digest formula covers six preimage fields. None of them is a task. Three consequences, all normative:

- No comparison of a requested task against an artifact field is specified, because there is no such field. **No task member may be added to the envelope, and no hidden task input may be introduced to stand in for one.**
- The observation is bound to a task only **transitively**, through the TaskState witness of step 3. That is **not** a unique task binding, and this amendment claims none. Base equality does not prove that the requested invocation emitted this artifact.
- Equally, it must **not** be claimed that two tasks sharing a base tree always produce identical derived entries: an entry set can depend on the requested task's DP context, so sharing a base does not establish identical derived entries.

The identity check that **is** available and **is** required lives at the collector: `buildTestProvenanceBlock` requires the committed `batch.taskId` to equal the requested validated TaskState's id (§C.3).

**Ordered steps.**

1. **Artifact.** Read the fixed internal path; refuse a non-regular or redirected path; parse with the canonical v2 reader. Its own `inventoryDigest` is recomputed by that reader.
2. **Current authority, from ONE load.** `loadStore(repoRoot)` **once**, keeping both its returned `store` and its returned `digest`. Then `validateStoreSchema` → `validateAll` → `indexStore` over **that same loaded text's** parsed store. A second read for validation would let the digest describe one text and the validation another. Require a TaskState for `taskId`; refuse if absent.
3. **Witness facts, each one named. `treeOid` equality alone is NOT base-witness validation.**
   1. `TaskState.baseProvenance.treeOid === request.baseTreeOid === artifact.baseTreeOid` — three-way. A two-way check would let the request and the artifact agree about a tree the task does not witness.
   2. `TaskState.baseProvenance.storePath === CANONICAL_STORE_PATH`.
   3. **The raw base-store witness, MANDATORY** (not conditional on being claimed): read the base store blob at `baseProvenance.storePath` from `baseProvenance.treeOid` through the accepted historical exact-tree reader, and require its **raw** digest — `sha256` over the bytes as they stand, the reader's own notation — to equal `baseProvenance.storeDigest`. Legitimate absence of that blob is accepted **only** when the witness names the defined canonical-empty-store digest; any other absence refuses.
   **Scope of 3.3, stated so it is not over-read:** it proves those exact witness facts — that the named tree really carries the named bytes, or legitimately carries none. It proves **no** further historical semantic invariant about the base store.
4. **Pre-state binding — the check that makes the timing constraint enforceable.** Take the `digest` **already returned by step 2's single load** — no second read — and require it to equal `artifact.inputProvenanceStoreDigest`. That digest is `sha256(canonicalText(the store file's actual captured text))`, the notation AC120 fixes for the loader, the producer and the file-backed CAS.
   **`storeDigest(<store object>)` is NOT an accepted spelling here.** It hashes a canonical **re-serialization of the parsed object**, so a legally pretty-printed store file can digest differently under it, including a pretty-printed file carrying a BOM and CRLF endings, and would be wrongly rejected. BOM/line-ending changes alone are normalized by canonicalText and do not necessarily make the current-text and canonical-object digests differ. The two notations are different facts about different things, and the store's own writer keeps them apart for that reason.
   **Note the third notation, deliberately unmixed:** the base-store witness of 3.3 is a **raw** digest with no `canonicalText` normalisation at all. Current-text, canonical-object and raw-base are three distinct spellings and none substitutes for another.
   Before the Step 5 committing write this equality holds; **after** it the write has necessarily moved the file (AC127), so a post-commit invocation **refuses** instead of silently recording a post-state observation.
5. **Discovery.** `buildDiscoveryAnalysisPreimage({ repoRoot, baseTreeOid })` → `{baseTreeOid, headViewDigest, registryDigest, baseModules, headModules}`. API unchanged. Require its `baseTreeOid`, `headViewDigest` and `registryDigest` to equal the artifact's three corresponding fields.
6. **Base rich capture.** `captureBaseAdapterContentView({ repoRoot, baseTreeOid })`.
7. **Head rich capture.** One additional head capture. Require its `headViewDigest` to equal discovery's.
8. **Registry and config, in this order.** `readTestAdapterRegistryRootFresh()`, then `readHeadExplicitConfig(<the head snapshot captured at step 7>, registryRoot)`, then `registryDigestOf(...)`; require equality with discovery's `registryDigest`. The config read **follows** the head capture because it is a function of that captured head; listing it earlier would name a config for a head that did not exist yet.
9. **Rich analysis, then COMPLETE projection equality.** `analyzeView({ view, modulePaths })` per side, `modulePaths` taken from discovery's `baseModules`/`headModules` — never guessed. Then require equality with discovery's public projection over **all of it**:
   - the module set and its order, and per module `path`, `adapterId`, `framework`;
   - **all three** `implementationIdentity` members — `implementationId`, `parserId`, `parserVersion`;
   - the **complete** declaration list per module, each declaration compared on the closed projection `{ structuralId, tag, bodyDigest }`, with `null` staying `null`.
   No other declaration member exists in that projection and **none may be invented** — in particular there is no `stableId` field to compare. Matching only top-level digests is **not sufficient** and must not silently accept an inconsistent analysis.
10. **Per-entry pairing.** `matchBaseHeadDeclarations(preimage)`; every entry represented in the canonical inventory must resolve to the **exact matcher locator pair**, and the two sides must agree on side presence, `tagBefore`/`tagAfter`, `baseBodyDigest`/`headBodyDigest` and identity. A missing pair, a contradictory pair, or an entry with no locator **refuses**. Accepting a fabricated entry because the top-level digests matched is insufficient even for a disclosure metric.
11. **Same-text recheck.** Immediately before publication, re-read the store file and require its captured-text digest to equal the value taken at step 4. On inequality, refuse and publish nothing.
12. **Publish** the sidecar (§C.2).

**Actual cost, accounted.** `buildDiscoveryAnalysisPreimage` itself performs a stable head pair (S1 **and** S2), one adapter base capture, one fresh registry read and its own analysis. The observer adds one head capture, one adapter base capture and one registry read, plus two rich analysis passes. Separately from those, step 3.3 performs **one additional historical base-store capture through the accepted exact-tree reader, with that reader's own Git operations** — this amendment does not promise a command count for an operation whose internals it does not own. Minimum totals: **three head captures, two adapter base captures, two registry reads, one historical base-store read, and discovery's analysis plus two extra rich analyses.**

**What the equalities prove, and what the recheck bounds.** The equalities prove that the reads observed **the same content and the same config**. They do **not** prove continuous stability across all reads; nothing here claims a quiescent worktree between the first and last capture. Step 11 bounds mutation of the store file to **this operation's own span** and claims nothing about any later operation: **Step 5 retains its own file-backed CAS**, which this neither duplicates nor weakens.

### C.2 Sidecar — `.ctide/output/test-provenance-observation.json`

Location is inside `.ctide/output/`, which §11b.10 **already** hard-excludes and which `docs/runtime-contract.md` already names per-run derived scratch. **No new exclusion is required for the sidecar.**

**Closed shape.**

```
{ observationVersion: 1,
  inventoryDigest,          // the exact artifact this observation is about
  baseTreeOid,
  headViewDigest,
  registryDigest,
  oracleDepTriggered }      // finite non-negative safe integer
```

`entryCount` and `capturedAt` are **omitted**. `entryCount` is recoverable from the committed inventory at read time, so persisting it creates a second value that can disagree with the first. `capturedAt` is a timestamp, and time is not authority here — nothing in the read path is entitled to decide anything from it.

**Publication.** Canonical serialization through the one serialization authority; write to a uniquely named sibling temp with exclusive creation; fsync; re-read and re-parse; publish by rename. Any failure before the rename leaves a previous sidecar **byte-identical** and removes only this operation's own temp. Output hygiene is the accepted emitter's: the first write under `.ctide/output/` creates that directory's top-level `.gitignore` (`*` then `!.gitignore`) exclusively when absent, and never rewrites an existing one.

**Count bound, normative.** Beyond §A.0's finite non-negative safe integer:

> `0 <= oracleDepTriggered <= |{ committed inventory entries having BOTH a base and a head side }| <= entries.length`

An **empty** inventory, and one whose entries are **all added or deleted**, require exactly `0` — that is a measurement over an empty comparison domain, **not** an unknown.

**Validation on read, and the mechanical limit.** A reader must validate the **exact closed six-key set**, each member's type, `observationVersion === 1`, **all four** binding fields against the exact committed inventory — `inventoryDigest`, `baseTreeOid`, `headViewDigest`, `registryDigest` — and the count bound above. It must not accept a match on one field while tolerating a contradictory value in another.

**Path guards apply to reads as well as writes.** The read path refuses a redirected or non-regular sidecar path exactly as the write path does.

**Failure containment.** A sidecar that is missing, malformed, redirected, out of bounds, or bound to a different inventory yields `oracleDepTriggered: "unknown"` **and nothing else**: every other ledger field keeps its value and the record is still appended. A sidecar fault never sinks the run record.

> **Limit, stated rather than dressed up.** A digest binding **associates** an observation with an inventory. It does **not** prove the measurement inside the sidecar was honest. There is no checksum, signature or authenticity claim here, and a forged sidecar with correct binding fields would be accepted as an association. What the binding buys is that an observation of *some other* proposal cannot be attributed to this head. `oracleDepTriggered` is therefore **disclosure**, never a gate input.

### C.3 `buildTestProvenanceBlock({ repoRoot, provenanceTaskId })`

**Exactly two own keys.** `provenanceTaskId` is `string | null`, and `null` is the **explicit no-identity value** the default ledger CLI passes. An absent key, an extra key, or a non-string non-null value is **programmer misuse** and raises `E_API_ARGUMENTS` from the operation — it is not silently read as "no identity".

**No invented identity grammar.** The store treats a task id as an **opaque map key**: it sorts `taskStates` by it and indexes on it, and defines no length or character rule anywhere. The block therefore validates `provenanceTaskId` as a **non-empty string** and decides membership by **lookup**, nothing more. The 300-character cap belongs to the ledger's human `task` prose alone and **must not** migrate to the provenance identity.

Returns the §11 block. It owns its reads; it accepts no store, index, verdict or metric from a caller.

- **No identity.** `provenanceTaskId === null` → **no store read is attempted** and the operation returns the **R1** block: `taskId: null`, every ref and digest `"unknown"`, every grouped count `"unknown"`, `converged: false`.
- **Lookup.** Validated store → `TaskState` → **exact** `committedProvenanceBatchRef`. Never a `(taskId, inventoryDigest, batchDigest)` tuple search; never a read of malformed current JSON.
- **Committed identity check.** The committed batch record's `taskId` must equal the requested, validated TaskState's id. This is the identity binding that **is** available — the artifact has none (§C.1) — and a mismatch is refused rather than reported.
- **Canonical reading.** The committed `inventorySnapshot` is read through the accepted canonical v2 reader. A legacy head yields no preimage and no v2 claim (R4).
- **Consumer evaluation.** `verifyCommittedBatch` is run by this operation against the **current** head for gate (ii) of §B.5. The producer is **never** re-run, and nothing is re-derived against post-Step-5 state.
- **Same-head binding, normative — ALL SEVEN, then a re-read.** Compare the **returned verdict's** `taskId`, typed `committedBatchRef`, `batchDigest`, `inventoryDigest`, `baseTreeOid`, `headViewDigest` and `registryDigest` against the TaskState, head record and canonical inventory **this block loaded**. `headViewDigest` and `registryDigest` are comparable and are **not** merely recorded: the consumer's own freshness phase compares its freshly captured pair directly against the committed inventory's pair and refuses on inequality, so a **successful** verdict carries values already proved equal to the stored preimage's. **Then** re-read the current head and require it still to match.
  Both steps are required. The re-read alone is insufficient — an A→B→A change between reads leaves it satisfied while the verdict describes B, and a verdict about B can never authorize counts about A. Comparing five fields instead of seven would leave two further fields through which that substitution could pass.
  On any mismatch the producer is **not** re-run; the block keeps its canonical facts **explicitly as facts of the initially validated stored head**, sets every verdict-dependent count to `"unknown"`, and sets `converged: false`. Values from two different heads may never appear in one record.
  **Boundary:** this applies to a **successful** verdict. A refused verification returns no verdict object at all, so there is nothing to compare and the block takes the R5 path directly.
- **Sidecar consumption.** Read the sidecar under §C.2's full validation; on any failure, `oracleDepTriggered` is `"unknown"` and the rest of the block is unaffected.

---

## D. §11b.10 delta — the runtime-owned ledger prefix

### D.1 Normative change

§11b.10's closed hard-exclusion set is currently, in evaluation-order step 1:

- exact `.ctide/provenance.json`
- prefixes `.git/`, `.ctide/output/`

**Delta: add the prefix `.ctide/ledger/`.** That is the entire change. The set remains closed and remains a spec-level enumeration; an implementation may not add a fourth class.

### D.2 Exclusion precedes trackedness — and its cost

§11b.10's four-step precedence evaluates **step 1 (hard exclusion) before step 3 (tracked-`.gitignore` verdict)** and before the tracked/untracked distinction is consulted at all. Therefore:

> Content under `.ctide/ledger/` is outside the head universe **whether it is tracked or untracked**. A file a consuming project has deliberately committed under that path becomes invisible to `headViewDigest`, and changing it will not change that digest.

That is the cost of this option and it is written here rather than left to be discovered. It is accepted because `.ctide/ledger/` is defined by `docs/runtime-contract.md` and `references/run-ledger.md` as **untracked-but-persistent runtime state owned by the tool**; tracking content there is contrary to that contract. The exclusion is narrowly named for that runtime-owned directory and is not a general statement about `.ctide/`.

### D.3 Why the exclusion, and why not the alternatives

Without it, the ledger's own append perturbs the head universe in any repository whose **tracked** ignore bytes do not cover `.ctide/ledger/`. `run-ledger.mjs` creates the directory and an **untracked** nested `.gitignore` on first write; untracked ignore files are not authority under §11b.10 step 3, and the guard is itself a new untracked candidate. The consequence is durable and cross-run, not merely an intra-run ordering fault: **every committed batch stops verifying as soon as any later run appends**, because the recomputed `headViewDigest` no longer matches the committed one. In that configuration the ledger and Step 6 are mutually incompatible.

Rejected alternatives, with reasons:

- **Precreating the untracked guard before production** — insufficient, and independently disproven. The guard is not authority, and it is an additional candidate.
- **Staging the guard during a run** — mutates the user's index during a verification run; a run that dies midway leaves a staged file for the user's next commit.
- **Requiring a tracked root ignore rule** — no shipped operation establishes one today, so this is a **new obligation** on the consuming project, and if it gates the run it is itself a behavioural change. A routine warning after the exclusion has solved the problem is noise plus obligation and is not proposed.
- **Relocating ledger history under `.ctide/output/`** — that tree is overwritten each run; it would destroy the episodic history the ledger exists for.

### D.4 Control obligations

**AC131 (closed exclusion / inclusion) — extend the exclusion positives.** A change confined to `.ctide/ledger/**` — including the creation of the directory, the creation of its nested `.gitignore`, and an append to `runs.jsonl` — **must not** change `headViewDigest`. The existing three exclusion positives and all six inclusion positives are unchanged.

**AC131 — new negative.** In a repository whose tracked `.gitignore` does **not** cover `.ctide/ledger/`: capture `headViewDigest`, perform one real ledger append, recapture. An implementation that has not applied the exclusion produces a different digest and must be caught. The fixture **must** genuinely lack the tracked rule, otherwise the exclusion is never reached and the control measures a world in which the defect cannot occur.

**AC131 — tracked-content disclosure negative.** A file tracked under `.ctide/ledger/` must **not** appear in the head universe, and changing it must **not** change `headViewDigest`. This control exists to make the §D.2 cost executable rather than merely asserted.

**AC130 unchanged.** Ignore authority remains tracked `.gitignore` bytes in S1; `core.excludesFile` and `.git/info/exclude` remain non-authorities; the `.ctide/test-adapters-config.json` exact-path exception is untouched and must not be generalized to a prefix.

**Base capture unchanged.** A control must assert that `BaseAdapterContentView` still enumerates **all** leaves of B, including any under `.ctide/ledger/`, because TP ~2347 does not apply head hard exclusions to B. An implementation that applies the new prefix to the base capture must be caught.

---

## E. Compatibility effects

**Declared-type changes** (union widening only; no key added, removed or renamed):

| field | approved | proposed |
|---|---|---|
| `taggedTests`, `inventory`, `findingKinds` | object | object \| `"unknown"` |
| `entriesWithoutFindings`, `oracleDepTriggered`, `governanceAffectedEntries`, `reviewLoopIterations`, `convergenceEpochs`, `assumTransitions`, `adapterMisses`, `staleBatchRejections` | `n` | `number` \| `"unknown"` |
| `taskId`, `inventoryDigest`, `batchDigest`, `provenanceBatchRef` | (implicit) | `T` \| `null` \| `"unknown"` |
| `lastStaleSubject` | `string \| null` | `string` \| `null` \| `"unknown"` |
| `converged` | `bool` | `boolean`, **required**, combined-gate semantics stated |
| `droppedForNoSource` | `number \| "unreported"` | unchanged |

**Consumer obligations.** Any reader of the run ledger must tolerate the `testProvenance` key and must not coerce `"unknown"` to a number, to `null`, or to `false`. Existing count consumers that read only `type:"run"` / `type:"close"` event facts are unaffected.

**Head-universe effect.** The §D delta changes headViewDigest when ledger leaves were actually included in the previously captured universe. Inventories or committed batches binding such a prior digest fail freshness against the changed universe and must be regenerated through the normal flow. A repository lacking a tracked ledger-ignore rule but carrying no ledger leaves at the earlier capture need not change digest. This is a one-time, self-announcing transition and must be listed in the amendment's own rollout note.

**Ledger structural invariants preserved.** One run record per run, `testProvenance` carried unconditionally on it, append-only, fail-open, CLI exits 0. No new ledger field, no `retries`, no capability or basis field, no second record type.

---

## F. Implementation to follow approval — **implementation status is recorded separately**

Listed so review can size the change. None of this exists, and none may be written before this amendment is approved.

| file | operation |
|---|---|
| `cressetide/skills/vigil/scripts/head-view-snapshot.mjs` | add `.ctide/ledger/` to `EXCLUDED_PREFIXES`; update the closed-set comment to name it **persistent runtime state** — not a "third scratch class"; `references/run-ledger.md` records that this tree is never overwritten or truncated — and to cite the spec paragraph that authorized the addition |
| *new* `cressetide/skills/vigil/scripts/inventory-telemetry-observer.mjs` | `observeInventoryTelemetry({repoRoot, baseTreeOid, taskId})`, the sidecar shape, its atomic publication, its read-side validator, **and its own strict CLI** (below) |
| *new* `cressetide/skills/vigil/scripts/test-provenance-block.mjs` | `buildTestProvenanceBlock({repoRoot, provenanceTaskId})`, the precedence and situation table, the seven-field verdict comparison and the head re-read |
| `cressetide/skills/vigil/scripts/run-ledger.mjs` | `buildRunRecord` gains a **default `"unknown"` `testProvenance` block** and stays synchronous and pure; `appendRun`/`appendClose` keep their signatures; only `main()` becomes async, derives the real block itself, and replaces the default before appending; new `--provenance-task <id>`; `--task` remains human prose ≤300 chars |
| `cressetide/skills/vigil/references/run-ledger.md` | document the block, the `"unknown"` discipline and the new flag |
| `docs/runtime-contract.md` | record the ledger directory's head-universe status |
| *new* `test/inventory-telemetry-observer.test.mjs` | actual observer/CLI, projection, witness, digest, metric, path and atomic-publication controls |
| *new* `test/test-provenance-block.test.mjs` | reachable authority states, semantic counts, sidecar containment and seven-field/current-head binding |
| `test/head-view-snapshot.test.mjs`, `test/adapter-content-view.test.mjs` | narrow ledger HEAD exclusion and unchanged all-leaves B capture |
| `test/run-ledger.test.mjs` | unconditional eighteen-field block, CLI identity diagnostics, single fail-open append and synchronous helper compatibility |

**Compatibility helpers, stated accurately.** `buildRunRecord` is **pure and synchronous**. `appendRun` and `appendClose` are **synchronous I/O** — they write to disk and are not pure. All three are **non-authoritative** compatibility helpers that keep their current signatures, so existing callers keep working and receive the default `"unknown"` block. The **actual CLI** obtains telemetry itself; it must never accept a block, a metric, a digest or a JSON parameter from its caller.

**Observer CLI — the E1 invocation path.** `inventory-telemetry-observer.mjs` carries a strict CLI in the discipline the artifact emitter already uses: closed flag set `--cwd`, `--base-tree`, `--task`; each at most once; every value present, non-empty and not itself a flag; no bare positionals; `--base-tree` and `--task` required; `--cwd` defaulting to the working directory; every argument fault reported as `E_API_ARGUMENTS` **before** anything runs, with parsing inside the caught boundary. Success writes machine JSON to stdout and **exits 0**; a refusal writes machine JSON to stderr and **exits 1**.

**Ledger CLI exit behaviour is different and unchanged:** it remains fail-open and **always exits 0**, appending one record whatever the telemetry outcome. A malformed, repeated or value-less `--provenance-task` is a **CLI diagnostic** written to stderr; the record is still appended with the no-identity block and the exit stays 0. The ledger does not become a gate.

**A standalone operation and its CLI do not wire the seven-step flow.** Sequencing the observer between emission and the committing write, and enforcing that sequence, is D's.

---

## G. Verification obligations — **implementation status is recorded separately**

**Positive.** Each of R1–R6 produces its exact block. A complete v2 world produces known counts for fields 1–6 and 10–13, 15. The sidecar binds and is consumed. A ledger append leaves `headViewDigest` unchanged under the §D delta. `BaseAdapterContentView` still enumerates all leaves of B including `.ctide/ledger/**`. `buildRunRecord` stays synchronous and pure and its existing callers are unchanged; `appendRun` keeps its synchronous-I/O signature. The observer CLI exits 0 on success with machine JSON on stdout; the ledger CLI exits 0 in every case.

**Digest-notation controls (§C.1 step 4).** A store file that is **pretty-printed with LF**, and one carrying a **BOM with CRLF** endings, must each be **accepted**: both have `inputProvenanceStoreDigest === loadStore().digest`, and both have `inputProvenanceStoreDigest !== storeDigest(loadStore().store)`. An implementation that compares the canonical object serialization rejects both and must be caught by these two positives. A control must also assert that all three notations stay distinct: current-text, canonical-object, and the **raw** base-store digest of step 3.3.

**Base-witness controls (§C.1 step 3).** A base tree whose store blob's raw digest differs from `baseProvenance.storeDigest` **refuses**. A base tree with **no** store blob is accepted **only** when the witness names the canonical-empty digest, and refuses otherwise. A fixture that satisfies `treeOid` equality while failing the raw digest must be refused — a control that would pass under a `treeOid`-only implementation.

**Oracle-metric scenarios (§B.1), each a distinct fixture.** *oracle-only*: declaration bytes unchanged, an oracle dependency changed → counts 1. *SUT-only*: a non-oracle module changed → counts 0. *declaration-only*: the declaration body changed with no oracle change → counts 0. *moved*: the entry moved and its oracle changed → counts 1, because the definition is non-exclusive. *overlap*: declaration, tag and oracle all changed at once → counts 1, and the entry is still classified by §6 precedence in `inventory`, not in `governanceAffectedEntries`. *added* and *deleted*: contribute exactly `0`, never `"unknown"`, because they have no two-sided comparison.

**Negative — each moving one variable.** A post-Step-5 observation **refuses** on the step 4 pre-state binding rather than recording a post-state measurement. A store file mutated between step 4 and publication is caught by the step 11 same-text recheck and **nothing is published**. A sidecar whose `headViewDigest` matches but whose `registryDigest` does not is **rejected**, not partially accepted, and yields `oracleDepTriggered: "unknown"` while the rest of the record is appended intact. A sidecar with an additional seventh key, a wrong `observationVersion`, a non-integer count, or a count exceeding the two-sided entry total is rejected. A redirected or non-regular sidecar path is refused **on read** as well as on write. A rich analysis differing from discovery's projection in **any** of `path`, `adapterId`, `framework`, the three `implementationIdentity` members, or any declaration's `structuralId`/`tag`/`bodyDigest` is **refused**, not accepted on matching top-level digests. An inventory entry with no matcher locator pair, or a pair contradicting its recorded sides/tags/body digests/identity, is **refused** — a fabricated entry must not survive because the top-level digests agreed. `assumTransitions` is `"unknown"` on a refused batch and is never counted from a stored `results[]`. A legacy head yields `inventoryDigest: "unknown"` and never the record-level field; an unmigrated **current v1** store yields R2 and is never read as a legacy head. A store with a malformed persisted v2 snapshot yields **R2**, and no test may assert a validated-store row for it. A validated but **empty** store yields `taskId: null`, not `"unknown"`. A malformed store yields `taskId: "unknown"`, never the caller's argument. `"unknown"` is never emitted where established absence is provable, and `null` is never emitted where the authority was not reached. A concurrent head change between metadata load and consumer verdict produces `"unknown"` and `converged: false`, never a mixed record — including a change visible **only** in `headViewDigest` or `registryDigest`, which a five-field comparison would miss and which this control must catch. A governance-affected count that includes overlapping seed hits already counted in `inventory` is caught. `E_REGISTRY_*` never appears in `adapterMisses`, and the underlying typed failure is preserved elsewhere. A `provenanceTaskId` that is absent, an extra key, or a non-string non-null value raises `E_API_ARGUMENTS`; a malformed, repeated or value-less `--provenance-task` still appends one record and still exits 0. No identity-length limit is enforced. A repository **with** a tracked `/.ctide/` rule is unaffected by the §D delta; a repository **without** one changes behaviour exactly as §E describes.

---

## H. Remaining dependencies and unresolved paragraphs

### H.1 `converged` is `false` for the entire E1 window — dependency, not a defect

Accepted **component-only** interim behaviour. E1 does not release whole-flow readiness, and a `false` here means "not established", not "refuted". Field 9 can become true only when D supplies validated loop-control evidence.

### H.2 Fixed-point / loop integration — an explicit remaining dependency

Fields 7, 8, 14, 16 and 17, and gate (i) of field 9, have **no source in E1**. This amendment deliberately contains **no** loop-control API, no loop state path, no loop-control exclusion and no stub. Binding an emitter invocation to a proposal — which §C.1 explicitly does not do, and which no artifact field could support — is also D's obligation. D remains open, and its known blockers are recorded in the review dialogue, not here.

### H.3 An accepted documented limitation — `converged` cannot distinguish refuted from unobserved

**Settled, not open.** §B.5 makes `converged` `false` whenever either gate lacks positive proof, which folds "the consumer refused" and "the consumer could not be reached" into one value. That is correct for a fail-closed gate, and the lost distinction at this single field is an **accepted limitation** of the design, recorded here so a reader does not mistake `false` for a refutation. No tri-state, no additional field and no user-facing question is introduced. Fields 11–13 partly disambiguate the two cases for a diagnostician: R2 carries `"unknown"` refs, R5 carries known ones.

### H.4 Nothing unresolved in E1

All six settlement groups are closed. Where earlier drafts of this document conflicted with the settled design, the corrected form replaces them and the earlier form is not preserved: the canonical-object digest in place of the loaded-text digest; the unreachable validated-store/malformed-preimage row; `treeOid`-only equality described as base-witness validation; a comparison of a requested task against a non-existent artifact field; under-counted captures and a config read ordered before any head existed; an incomplete projection comparison; `entryCount`/`capturedAt` in the sidecar and a component-results escape hatch in its key set; a five-field verdict comparison; `appendRun` described as pure; and "third scratch class" applied to persistent runtime state.

The one substantive disagreement raised during review — the requested `request.taskId === artifact.taskId` comparison — was resolved against it on source evidence (`V2_INVENTORY_KEYS` has seven members and no task), and the withdrawal is reflected in §C.1 together with the limitation it leaves and the collector-side identity check that replaces it.
