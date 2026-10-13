> 逐步進度紀錄（原檔 `.ctide/output/progress.md`，gitignored）。接手後繼續往下附加，並同步回這份。

# v0.8 slim refactor progress (plan: docs/handoff/plan.md)

- acbe433 · P0 ff main→origin/main, tag archive/v0.7.2-full (local only), branch refactor/v0.8-slim · verify=n/a · -
- acbe433 · P0 baseline: 2146 tests, 2134 pass, 6 fail (all wall-clock timing tests; external 3dview vitest load), 6 skip, 6527s · baseline-before.txt
- acbe433 · P0 forced-ref bytes baseline = 181,334 (SKILL + 9 refs + vigil-map-overlay) → target ≤ 108,800
- acbe433 · P0 probe plugin strict-validates on 2.1.272 (args hooks, skills:, workflows/ accepted)
- acbe433 · P0 live probes BLOCKED: `claude -p` OAuth expired; user asked to run `claude auth login`
- P1 in progress (implementer)
- cd8a02d · P1 committed · verify=validate pass, plugin validate pass, npm test 2140/2132 pass (2 timing fails pre-existing; pass in isolation)
- (P0) live probes done after user re-login (CLI 2.1.296): all 7 probes resolved, receipts .ctide/output/probes.md, spend ≈ US$0.28; plan-gate edit branch KEPT as backstop (interactive bypass gap untested) — disclosed deviation
- 5afc115 · P2 committed · verify=validate pass, plugin validate pass, npm test 905/899 pass, 3 load-timeouts pass in isolation (doctor-security, session-memory-hooks, structure)
- 5afc115 · Review round 1 (intent/test/code/arch + arbiter) → FIX REQUIRED: M1 ship disclaimer contains READY (Stop hook false advisory), M2 two tag definitions, M3 shallow subdir/worktree, M4 unverified branch untested, M5 assertion-source rule vs edge-input mandate, M6 edge tests; repair list R1–R8 in arbiter report
- owner decisions: D-1 EVIDENCE.md historical rows added to AC2 exclusions; D-2 three wall-clock tests = disclosed exception until P3/P5 in-process; D-3 shared isShallowClone fix approved (marker/tagReady side effect)
- note: archive/v0.7.2-full is PGP-signed (git tag.gpgSign=true) — harmless, disclosed
- 72b01a0 · round-1 repair R1–R7 committed · verify=validate 0, plugin validate@2.1.272 0, focused 293/292 (1 skip), npm test 917/910, 4 timing fails pass alone (3 accepted D-2 + plan-gate F1 dd 3078ms/3000 not on the accepted list → arbiter to rule)
- 72b01a0 · handoff: docs/handoff/ (README, plan, contract, progress, probes, review-round1) committed; branch + archive tag pushed for machine switch · next: round-1 re-check (intent/test/code + arbiter on 5afc115..72b01a0, rule on plan-gate F1 timing), then P3
- 2306078 · (new machine, Node 24.19.0) round-1 re-check verification in a clean detached worktree (main checkout's gitignored .ctide/collaboration dogfood data fails validate 20× — pre-existing validator scans ignored files; owner: fold tracked+unignored-only scan into P3) · verify=validate 0, plugin validate@2.1.272 0, npm test 917/911 pass 0 fail 6 skip (platform) in 87 s, plan-gate F1 dd 134.7 ms, contract-check --base 5afc115 clean · re-check panel intent/test/code spawned
- owner (2026-10-13, new machine): sign with local GPG key C446A14B5ED9EB97 (repo-local commit.gpgsign/tag.gpgSign)
- 2306078 · round-1 re-check verdict (arbiter): FIX REQUIRED — no blocker; majors: column.ui/column.tag=always regression (72b01a0), log.showSignature fake commit row (P2), README×3:200 stale READY paraphrase (incomplete R1), shallow probe unknown→"not shallow"; AC-13 unmet under column.* config; repair list R2-1..R2-5; routed F-j/leads→P4, F-k→P6, F-l→P8 · verify=pass · panel=full
- owner (2026-10-14): R2 doc wording approved (items 1–12); D-4 = the four plan-gate F1 timing tests are a disclosed exception until P5 (P5 must time in-process and prove red with the bound removed); user asked to keep cleaning leftover files every phase; %TEMP% ctide-* backlog (114,517) cleanup started via the user's own command
- R2 in progress (implementer)
- ec91bf6 · round-1 repair R2-1..R2-5 + owner-approved add-ons (tagReady --untracked-files=normal; contract pending commands synced; "unknown" shallow only inside a work tree) committed, signed with C446A14B · verify (clean worktree) = validate 0, plugin validate@2.1.272 0, npm test 932/926 pass 0 fail 6 skip (platform) 90 s, contract-check --base 2306078 clean · red→green per item in docs/handoff/r2-redgreen.md (HEAD+new tests 90/81/9 red → 93/93 green; every item's mutants red) · full suite leaks ~750 ctide-* temp dirs per run (P3 fixes) · next: narrow re-check-2 (intent/test/code + arbiter) on 2306078..ec91bf6
