# Changelog

All notable changes to Cressetide will be documented in this file.

## [Unreleased]

## [0.3.0] - 2026-07-18

- 最終報告新增獨立、條件式的 `Live-verification gap` 欄位（`references/final-report.md`，compact 與 `--report full` 皆有）：當 UI 或可觀察執行行為的驗收條件因 Detect→Use→Else-Disclose 找不到 live-verification 能力（瀏覽器或 `app-launch.md` 涵蓋的非 UI live process）時，明確具名揭露，不再淹沒在泛用的 External capabilities 欄位裡；`arbiter.agent.md` 同步新增對應規則，涵蓋 UI 與非 UI 兩種情境。
- `arbiter` 的修復迴圈卡住判斷（連續 2 次同類 blocker → Stuck Summary）新增 drift 判斷：沿用既有的 `contract-check.mjs` scope-diff 與 bidirectional traceability 證據，揭露這次修復是否仍在收斂到原始 acceptance criteria、或已經漂移——純揭露性質，既有的連續 2 次觸發門檻不變；`verification-gate.md`、`SKILL.md`、`vigil-map-overlay.md` 同步更新以保持一致。
- 新增 `references/test-layer-boundaries.md`：定義 unit/integration/E2E 三層的責任邊界、mocking boundary 與判斷法則，並涵蓋 Python、TypeScript/JavaScript 兩種生態系的具體慣例；由 `SKILL.md` 的 Reference Loading 清單與 `test-reviewer.agent.md` 引用。
- 修正 `doctor/SKILL.md`、`docs/command-reference.md`、`docs/compatibility.md`、`map/SKILL.md`、`map/references/system-map-contract.md`、`docs/map-contract.md`、`docs/runtime-contract.md` 共 7 處殘留自 0.1.0、在 0.2.0 bump 時未同步更新的版號字串；目前沒有 CI guard 涵蓋此類散文版號一致性。

## [0.2.0] - 2026-07-16

- Salvage 的 wartime 流程新增對 Map canonical section 的引用：Stage 1 的 Blast radius 引用 `Architecture boundaries` 與 `Execution flows`，入侵研判問題引用 `Data flows` 的 Trust boundary 欄，Stage 4 diagnose 開場先查閱 `Risk and uncertainty` 已記錄的高風險模組、破壞性路徑與 production-only 假設，再進行故障分類。
- Map 新增 canonical 的 `System overview` section，產生於 SYSTEM_MAP.md 最前面（`Repository structure` 之前），並吸收原本僅屬於 Ops Profile 的 System overview 內容，改為一行描述加上指向 `Architecture boundaries`（元件與進入點）與 `External integrations`（外部相依）的導覽，避免同一事實在兩處維護。
- `map verify` 新增對 Ops Profile 其餘 9 個欄位（Access inventory、Rollback、Feature flags & kill switches、Backups、Breach readiness、Observability inventory、Run in isolation、External dependencies、Approvals map）的檢查：缺漏欄位、仍停留在 heuristic placeholder、信任標記格式錯誤、或已填寫內容卻缺少對應機器可讀信任標記（`missing trust tag`）都會回報對應的 finding；`map create`/`map refresh` 同步產生這 9 個欄位的預設骨架，並與其餘 canonical section 一樣在每次 refresh 時重新產生。

## [0.1.1] - 2026-07-16

- 將 CI 工作流程中的 `actions/setup-node` 從 6.4.0 升級到 7.0.0（Dependabot）。
- 修正 `release setup-node` 快取合約的測試，改以比對任一 40 碼 hex SHA 取代寫死單一版本的 SHA，避免每次 action 版本更新都導致驗證失敗。

## [0.1.0] - 2026-07-15

- 發布 Cressetide 的 `vigil`、`salvage`、`map`、`doctor` 四個公開 Skill 與十一個 agent roster。
- 提供 plan gate、task contract、驗證、風險式 review panel、incident response、system map 與本機 Doctor 流程。
- 加入六個 fail-open hooks、`.ctide/` 專案狀態契約、結構與文字完整性驗證、測試及 eval。
- 強化 immutable tag、deterministic archive、exact asset inventory、checksum 與 provenance attestation 的 release 流程。
