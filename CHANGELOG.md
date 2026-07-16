# Changelog

All notable changes to Cressetide will be documented in this file.

## [Unreleased]

- Salvage 的 wartime 流程新增對 Map canonical section 的引用：Stage 1 的 Blast radius 引用 `Architecture boundaries` 與 `Execution flows`，入侵研判問題引用 `Data flows` 的 Trust boundary 欄，Stage 4 diagnose 開場先查閱 `Risk and uncertainty` 已記錄的高風險模組、破壞性路徑與 production-only 假設，再進行故障分類。
- Map 新增 canonical 的 `System overview` section，產生於 SYSTEM_MAP.md 最前面（`Repository structure` 之前），並吸收原本僅屬於 Ops Profile 的 System overview 內容，改為一行描述加上指向 `Architecture boundaries`（元件與進入點）與 `External integrations`（外部相依）的導覽，避免同一事實在兩處維護。
- `map verify` 新增對 Ops Profile 其餘 9 個欄位（Access inventory、Rollback、Feature flags & kill switches、Backups、Breach readiness、Observability inventory、Run in isolation、External dependencies、Approvals map）的檢查：缺漏欄位、仍停留在 heuristic placeholder、或信任標記格式錯誤都會回報對應的 finding；`map create`/`map refresh` 同步產生這 9 個欄位的預設骨架，並與其餘 canonical section 一樣在每次 refresh 時重新產生。

## [0.1.1] - 2026-07-16

- 將 CI 工作流程中的 `actions/setup-node` 從 6.4.0 升級到 7.0.0（Dependabot）。
- 修正 `release setup-node` 快取合約的測試，改以比對任一 40 碼 hex SHA 取代寫死單一版本的 SHA，避免每次 action 版本更新都導致驗證失敗。

## [0.1.0] - 2026-07-15

- 發布 Cressetide 的 `vigil`、`salvage`、`map`、`doctor` 四個公開 Skill 與十一個 agent roster。
- 提供 plan gate、task contract、驗證、風險式 review panel、incident response、system map 與本機 Doctor 流程。
- 加入六個 fail-open hooks、`.ctide/` 專案狀態契約、結構與文字完整性驗證、測試及 eval。
- 強化 immutable tag、deterministic archive、exact asset inventory、checksum 與 provenance attestation 的 release 流程。
