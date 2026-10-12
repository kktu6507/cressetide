# Test-provenance v1.17 independent review

Date: 2026-09-05. Reviewer: Codex. Implementation partner: local Claude Code, Opus 5 with xhigh effort.

## Decision and attribution

**ACCEPT the amended v1.17 specification for promotion.** The user delegated planning, progress, feedback and review to Codex, with Claude Code implementing. This is Codex's independent review and delegated approval, not an agent-duel panel verdict and not a new direct user sign-off.

Acceptance covers the full candidate chain `8594166 -> 7bf57ab`, `7f1b346`'s status-only shared-document reference update, and the uncommitted amendments reviewed on this date. The accepted pre-promotion test-provenance file has SHA-256 `c032e7517f16834e8f7b27f2f089ed4e5aad10d29cb20da8ddd38b5bf457052c`. No individual introduction commit receives standalone acceptance.

Promotion is authorized now. The effective coupled set becomes **shared v1.15 + intent-scan v1.10 + test-provenance v1.17** after the promotion record is written. Update current status/reference carriers accordingly while preserving dated history. The older draft-review verdicts remain historical records, not the current decision.

This accepts the specification only. Producer implementation `69cff79` remains provisional / NOT ACCEPT; rollout stays **5/6**, the product gate remains, and Phase 2 is not READY. After recording promotion, Claude Code may implement the producer repairs and the three missing evidence groups required by AC178. Artifact emission, batch/consumer integration, ledger and arbiter remain behind producer acceptance.

## Findings resolved

- Requests are separated: standalone seed receives two fields and never selects a task; producer receives taskId and selects the unique G1 TaskState. Whole-store validation still covers taskStates.
- Error evidence follows the actual earliest rejection. REQ dangling Source fails store validation; nonterminal DEC/ASSUM dangling direct Source fails mandatory seed derivation. Only reachable binding failures require testRef/side/obligation detail. Upstream checks are not weakened to manufacture fixtures.
- Post-binding obligations remain per kind and per direct Source. Witness matching is per obligation, not blanket lifecycle-set exemption. Withdrawn REQ expiry case b3 stays withdrawn under INV-4 and section 7.
- Check B and its drift witness have the same predicate. Its mandatory evaluation therefore needs honestly labelled source/control-flow evidence; no nonexistent public-output discriminator is required. Non-first-Source Check A retains a behavioral discriminator.
- Check B derives search bytes from captured raw blobs by removing a leading UTF-8 BOM and normalizing CRLF/CR to LF, preserving all other bytes. This retains the existing input universe and UTF-8 text semantics without lossy decoding or rejection of unrelated binary files. Raw snapshot/digests remain unchanged.
- Historical validation excludes evaluation against current T0/H while retaining non-temporal validity and the historical version's own rules. A schema-only shortcut is rejected. Current validators/transactions retain their complete approved current semantics.
- Producer alone compares the selected TaskState's raw base witness with captured B. Standalone seed has no task-specific witness to compare. Raw B witness digest and canonicalText current-store CAS digest remain distinct.
- Both public operation paths remain, with common orchestration kept module-private. Private internal continuations are permitted; exported caller-controlled capture/context callbacks are not.

## Authorized precision corrections during promotion

These clarify the accepted interpretation without adding a new mechanism or weakening a check:

1. In shared section 9's base-witness display, change the stale `storeDigest` description from the file's "canonical bytes" to **the original bytes of that file in the named tree**, explicitly distinct from current-store canonicalText CAS. The same section's historical-read bullet and approved downstream section 11b.9c already require raw bytes. This is a consistency erratum, not a new shared-version contract.
2. Historical validation must retain the **complete existing scopeCovers predicate**, including its typed ruling and `scopeCovers == true` checks; the parenthetical examples in section 6b are not an exhaustive replacement.
3. State the historical proof boundary accurately: no historical evaluation instant is persisted here, so this validation does not attest that a grant was unexpired at some past commit time. It preserves the non-temporal rules and refuses their violations. Do not replace unknown historical time with a fabricated instant or with unconditional "unexpired" when evaluating a negated applicability condition such as a source-2 reopen cause.
4. In AC176(11a-ob5), make the remaining behavioral reference explicitly point to the **Check A** half, (11a-set-A). Check B retains structural/reachability evidence.

## Verification and implementation acceptance still required

Independent probes reproduced the original Source error layers, isolated CRLF/CR/BOM false drift, and erroneous current-time validation of historical B. A future-expiry historical terminal missing scopeRulingRef demonstrates the non-temporal check that must remain. A valid text source with an unrelated non-UTF8 blob demonstrates the input-universe boundary.

The clean tracked-source baseline at HEAD `7f1b346` completed with **1499 tests: 1488 passed, 11 skipped, 0 failed**, exit 0, approximately 148.6 seconds. The amended specification passes `git diff --check` and both stages of `npm run validate`. These results are a baseline and spec validation, not producer implementation acceptance.

The next acceptance requires the actual repaired code, the AC176 executable matrix with explicit evidence mapping, deterministic G1 -> binding -> G2 mutation evidence, and AC173(i)/(j) on a genuinely populated envelope. Tests must isolate the intended failure and assert its actual layer; fixture errors or pre-binding failures must not masquerade as post-binding coverage. Codex will review the resulting diff and independently run the affected checks before changing producer status.
