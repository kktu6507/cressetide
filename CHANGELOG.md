# Changelog

All notable changes to Cressetide will be documented in this file.

## [Unreleased]

## [0.1.1] - 2026-07-16

- 將 CI 工作流程中的 `actions/setup-node` 從 6.4.0 升級到 7.0.0（Dependabot）。
- 修正 `release setup-node` 快取合約的測試，改以比對任一 40 碼 hex SHA 取代寫死單一版本的 SHA，避免每次 action 版本更新都導致驗證失敗。

## [0.1.0] - 2026-07-15

- 發布 Cressetide 的 `vigil`、`salvage`、`map`、`doctor` 四個公開 Skill 與十一個 agent roster。
- 提供 plan gate、task contract、驗證、風險式 review panel、incident response、system map 與本機 Doctor 流程。
- 加入六個 fail-open hooks、`.ctide/` 專案狀態契約、結構與文字完整性驗證、測試及 eval。
- 強化 immutable tag、deterministic archive、exact asset inventory、checksum 與 provenance attestation 的 release 流程。
