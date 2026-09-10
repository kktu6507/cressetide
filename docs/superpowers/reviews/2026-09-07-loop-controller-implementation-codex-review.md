# Durable review-loop controller: independent implementation review

Decision: **ACCEPT the TP1.21 controller core, state, recovery and direct CLI implementation.** This decision does not accept the D11 ledger/Vigil/reviewer/arbiter integration, an actual external test-reviewer run, Linux behavior or whole-flow readiness.

Real local Claude Code implemented the bounded changes with `claude-opus-5` and `xhigh`. Codex independently reviewed the final source and tests, ran the fixed candidate, and kept correction authority separate from implementation completion. The accepted specification is `docs/superpowers/specs/2026-09-06-test-provenance-loop-amendment.md` at SHA-256 `522d436ee89ea5e51c188707281986768503cadbbad2192da8b368a0945d5527`.

## Discussion and correction record

Phase11i and phase11j settled the broad controller disagreements before phase12a correction. Claude withdrew the claim that recovery could read an undefined inventory digest, and both sides resolved pending-slot semantics, source-owned witness-coverage errors, corrupt-state reporting, duplicate declaration validation, lock projection set behavior, and package finding-key identity. Phase12b then exposed one independent defect: `FindingIdentity.kind` accepted arbitrary strings. Claude agreed in the read-only phase12c discussion that the state validator must use the exported `FINDING_KIND_ORDER`; phase12d made that bounded correction.

The first fixed-candidate run in phase12e exposed an entry-point packaging defect: recursive `node --test` discovered the production file named `test-provenance-loop.mjs`, invoked it without controller arguments, and failed with `E_API_ARGUMENTS`. Phase12k and phase12l discussed the failure and alternatives before phase12m changed the direct-invocation predicate. The accepted helper uses strict marker presence, suppresses only a no-controller-argument discovery invocation, and compares `fs.realpathSync(process.argv[1])` with `fileURLToPath(import.meta.url)`. Argument-bearing child invocations under the test marker still execute.

One procedure deviation is retained explicitly. Phase12m's R1 test removed the inherited marker from its outer nested runner even though the release text said no environment override. Claude discovered that Node otherwise exits zero after warning that recursively running files are skipped, but edited before raising the conflict. Codex did not count that edit or its green result as prior discussion. In phase12n Claude acknowledged the breach, supplied the exact failed observation, and compared alternatives; Codex then adjudicated the outer-only scrub as a valid way to let a real inner Node runner create the marker being tested. This was after-the-fact ratification, not evidence that the required discussion originally occurred.

The same phase12n review found that the first R4 test did not isolate URL percent encoding because its junction was realpathed to the repository path; its comment was therefore false and R4 duplicated R5. Claude agreed before phase12o. The bounded phase12o correction now copies the shipped Vigil tree byte-for-byte into a physical path containing a space, proves `realpathSync(path) === path`, and leaves R5 to cover a junctioned ancestor separately. Under the old hand-written direct-path predicate, R4 and R5 both fail by producing no CLI output while R1-R3 pass. Production bytes were restored exactly after the mutation control.

## Independent fixed-candidate evidence

The final 93-file candidate is the identical manifest in both phase12p and phase12q. Phase12p completed the raw repository regression with actual exit 0:

- 1868 tests
- 1856 passed
- 12 Windows-platform skips
- 0 failed, cancelled or todo
- direct structure validation: exit 0
- deterministic evaluation: exit 0

Phase12q then ran 88 controller probes in 13 groups with actual exits 0 and no failed row: flow 11, addressing 7, budget 7, reconsideration 6, API 9, admission publication 2, recovery 9, state shape 4, governance 10, admission validation 11, concurrency 6, telemetry 4 and authority sampling 2. Its candidate manifest exactly matches phase12p. The final controller suite also passed 33/33; related state 21/21, governance 13/13 and recovery 18/18 suites passed during the bounded corrections.

The independent probes cover closed and open admissions, retry and epoch budgets, semantic reconsideration, evidence and witness coverage, stale-baseline recovery, corrupt and missing state, admission publication, lock and pending projections, governance-only findings, API argument precedence, optimistic concurrency, telemetry observations, and exact prospective-authority sampling. Selected mutation controls failed when the finding-kind enum or entry-point path predicate was weakened and passed again after exact byte restoration.

Primary receipts under `.ctide/collaboration` are `phase12p-controller-candidate-verification.json` and `phase12q-controller-probes.json`. Scope and discussion records are phase11i/11j, phase12a/12c/12d, and phase12k/12l/12m/12n/12o. This review is created after verification and is not included in its own manifest.

## Accepted implementation boundary

The principal accepted source hashes are:

| File | SHA-256 |
|---|---|
| `cressetide/skills/vigil/scripts/test-provenance-loop.mjs` | `442db6888a52ea1f746a83eb70bb13f41846a399f84ab3c0482d8816971ad961` |
| `cressetide/skills/vigil/scripts/test-provenance-loop-state.mjs` | `7ac67d83b34e75f03c21018eede834a83aa01d5aab93d3603b43bfa46502f041` |
| `cressetide/skills/vigil/scripts/test-provenance-loop-review.mjs` | `9142fb5ac1029aeed86cfa2a5216b64ebf4fb461f1deb40a904c32a5be9af69e` |
| `test/test-provenance-loop.test.mjs` | `9b3e70b2fe888141541ba194dd6d227d6bf1335402911beda820b18887855c27` |
| `test/test-provenance-loop-state.test.mjs` | `82d42246d7c217aa51995ba4cbd389972db9ccd6d6f956bb653289047d1ab0e1` |
| `test/test-provenance-loop-governance.test.mjs` | `f1e6329169db89f92e452fa3a890a5fda8bff19a66044358b43570c396028ea5` |
| `test/test-provenance-loop-recovery.test.mjs` | `f9fd87c7225fe406dc5929410a5d82c663b0c9c561ebed809e59aa9a48fd0ba3` |
| `test/fixtures/test-provenance-loop-fixture.mjs` | `1f3796613108eeb80f007b97c89cb4631ef2ed9fb9bc11dc363f6d23170782d5` |

R1 is a targeted test of one discovered production file; phase12p provides the full recursive-discovery evidence. R4's copied-tree `REPO_ROOT` is not production-equivalent, but the case performs only `inspect` with absent state and fails loudly on module resolution or unexpected I/O. All execution evidence is from this Windows machine. The controller acceptance supplies no actual external reviewer judgment and does not establish final Step 6 or loop/provenance convergence integration.
