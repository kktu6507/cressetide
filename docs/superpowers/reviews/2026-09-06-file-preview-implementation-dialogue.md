# File-preview implementation dialogue

This is the collaboration record, not implementation acceptance. Codex plans, reviews and verifies; real local Claude Code implements with claude-opus-5 and xhigh effort in the authorized persistent project session. Project-only Anthropic authorization remains the user's existing authorization. TP1.19's preview-only specification was approved separately; the remaining D controller draft is unapproved.

## Initial implementation: phase10p1

Claude delivered a stable two-file implementation: a private shared loaded-file derivation beneath the existing writer, the new readonly preview, and a focused test suite. The guarded change affected only provenance-store.mjs and provenance-file-preview.test.mjs. Claude reported334 passing tests across eight focused suites, all child exits0. Its intentionally faulty object-store preview caused six of the final14 preview tests to fail before it restored the implementation. The tests' hand-built inventory data are component fixtures; they are not actual-emitter evidence or an actual external reviewer invocation. Codex did not accept this implementation based on those tests.

## Root findings before correction

Codex independently ran an actual Git/emitter/text-writer fixture. The preview read request.payloadText three times. An enumerable JavaScript getter returned a duplicate-member inventory payload for its first two reads and valid text on the third. The actual file writer refused E_DUPLICATE_MEMBER; preview accepted, with unchanged store bytes. The probe exited1. The defect is disagreement between the parsed text and raw-validated text in the JavaScript API; it does not demonstrate a JSON CLI exploit or a bad actual write.

Two smaller controls showed an extra nonenumerable options property or Symbol own key bypassing Object.keys: malformed empty payload text reached E_PAYLOAD_JSON instead of the required earlier E_API_ARGUMENTS. The hidden fields were ignored by the implementation; the observed defect was the exact request predicate and diagnostic precedence, not an injected option being honored.

## Read-only reasons discussion: phase10p2

Claude inspected the code and agreed the repeated reads recreated the prohibited paired object/text authority. It explained why JSON.parse hid the duplicate from the parsed object and the later raw check saw a different, clean document. It also identified the reverse direction: good parsed text with subsequently bad raw text caused an unjustified refusal. Both directions should be covered.

Claude agreed to capture repoRoot and payloadText once after complete own-key validation and to use the captured locals throughout. Codex accepted this and the reverse-direction regression. Claude corrected one mechanism detail: the existing comparator calls String and can sort Symbols without throwing; unsafe direct interpolation and misleading JSON rendering are the concrete diagnostic concerns. Codex accepted that correction and retained early explicit Symbol refusal with safe rendering.

Both agreed the comment should say a legal pretty file CAN have a different loaded-text digest from its canonical object digest. BOM/line-ending changes alone remain normalized. No writer signature, option, lane, ordering or actual CAS behavior is changed.

The real Claude process completed with actual exit0,4 turns,221.796 seconds. The165-path read-only guard passed at2026-09-06T06:24:59.759Z with no changes. Only after reading these reasons did Codex release phase10p3 for the same two files, focused regressions and a temporary reverse-control demonstration followed by restoration. Finishing the later correction is not used as evidence that this discussion happened.

## Bounded correction: phase10p3

Claude completed the two-file correction with actual exit0,28 turns,299.178 seconds. The165-path guard passed at2026-09-06T06:31:12.210Z. Final source SHA256 is2fe501b768475f5da418107217048b0620bd0e29a3c7f250cdef44b0b79af5f3; the18-test file SHA256 is79707d75df665e736a91f89d14616374a79991278733fdc0561ea0b43f3e8fc3.

Corrected and finally restored code passed18/18 preview and38/38 batch-writer tests, both actual exits0. A faithful temporary reversal of only the helper boundary made the four new tests fail while all14 prior preview tests and38 writer tests still passed. An earlier reversal accidentally retained dead capture lines and observed four reads; Claude disclosed and redid it with the faithful original three-read body. Neither temporary form remains in final source. Codex checked the final single-capture code and independently reran its original actual-emitter discriminator: one text read, both preview and actual writer refuse E_DUPLICATE_MEMBER, raw store unchanged, actual exit0. Fixed-candidate regression and acceptance follow separately.

## Separately tracked sibling finding

Claude identified a related consumer request-boundary pattern without proposing an out-of-scope edit. Root then independently reproduced a stronger sibling emitter issue: in two isolated real Git repositories, a changing repoRoot accessor caused actual production from A and artifact publication under B. The accepted E1 snapshot probe exited1 with two property reads. No user repository was a probe destination. This later counterexample is tracked in .ctide/collaboration/request-capture-followup.md and requires its own reasons discussion and bounded correction before final integration acceptance. It is not resolved by preview-only changes.

Implementation acceptance, fixed-candidate counts and limitations will be recorded in a separate decision after final source review and independent execution. D, actual reviewer orchestration and Linux evidence remain outside this record.
