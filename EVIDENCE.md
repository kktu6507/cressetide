# Cressetide evidence

可重現的證據由本 repository 自身產生：

- `npm run validate` 驗證 plugin 結構、Cressetide identity、Map、agent/skill/hook inventory、release 契約、`.ctide/` 邊界與 UTF-8 文字完整性。
- `npm test` 執行 hooks、Doctor、publisher、validator、workflow contracts 與其他功能測試。
- `npm run eval` 執行版本控制內的 deterministic evaluation cases。
- `npx --yes @anthropic-ai/claude-code@2.1.207 plugin validate --strict ./cressetide` 驗證 nested plugin（marketplace 驗證由獨立的 `kktu6507/plugins` repo 負責）。
- `.github/workflows/release.yml` 以既有 immutable tag 為輸入，分離 validate、publish、attest 權限；publisher 產生 deterministic archive、SHA-256 checksum，並拒絕缺少、重複或額外的 release asset。

以上命令的實際執行結果必須由當次變更的 verification report 或 CI run 記錄；本檔不以靜態敘述取代執行證據。

## Release 與 CI 證據

### v0.7.1（2026-09-11）

Commit `889481fd09ae4e4100dcca6419c8ea7a9e2dc3c0`；release：<https://github.com/kktu6507/cressetide/releases/tag/v0.7.1>。

| 項目 | 記錄 |
|---|---|
| main CI run [`34501377103`](https://github.com/kktu6507/cressetide/actions/runs/34501377103) | 三個 hosted runner OS，Node 20，全部通過。這是自動化的 OS 覆蓋，不等於完整的 Claude Code host 相容性 |
| Release workflow run [`34502796774`](https://github.com/kktu6507/cressetide/actions/runs/34502796774) | Node 22.23.2 / Ubuntu：2,140 tests，2,138 pass，2 skip，0 fail，0 cancel |
| 本機 tag 驗證 | Node 22.23.2 / Windows：2,135 tests，2,122 pass，13 skip，0 fail，0 cancel |
| `npm run validate`、`npm run eval` | 皆通過；eval 7/7 |
| Tag | SSH 簽章，GitHub 顯示 Verified |
| Archive | 110 files，SHA-256 `187fb9e61994548d9bce853aa9d1feac9bc84479de1da87a6b8f176406c03d15`；兩次建置與下載後的位元組一致；attestation 驗證通過 |

**已驗證的安裝後行為（維護者自行回報，Windows）。** 在 authenticated Claude Code 2.1.263 / Opus 5 / effort xhigh 下，對已發佈的 marketplace 安裝執行 `/ctide:doctor`：15 項 helper 檢查全數通過；6 個 hook 全部被直接處理；24 個 degenerate input 全部 exit 0，符合 fail-open 不變式。實際在該 session 中觸發的真實 hook **只有兩個**：SessionStart 的 failure-memory 注入，以及 PreToolUse 的 destructive-guard。

**這些證據不涵蓋的範圍。** 上述是**個別觀察到的情境**，不是 `docs/compatibility.md` 任何一項 checklist 的完整通過——例如第 2 項還需要 fallback 與「沒有 memory 檔時保持安靜」，第 4 項還需要無害指令放行，第 1 項需要明確的 reload；helper 的直接探測也不等於 host 事件。不是 real-world 的 Vigil Type-B run，不建立任何 efficacy 或成本結論。以下完全沒有記錄：plan-mode gating、真實的 compaction 行為、Stop hook、完整的 Vigil / Map / incident 交接流程。

**Doctor 診斷契約的範圍限制。** 在 0.7.1 上，該次執行對 `references/diagnostic-contract.md` 步驟 1 的字面遵循是有限的：plugin root 是由 host 展開的 skill 呼叫以 canonical 形式提供，並經比對確認即為已安裝的副本；過程中沒有任何 filesystem 搜尋 fallback。步驟 1 的措辭已在 0.7.2 修正——0.7.2 目前是**未發布**的開發版本，上述所有觀察都來自已發布的 0.7.1，尚未在 0.7.2 上實測。

**v0.7.0。** tag 存在、已簽章且 GitHub 驗證為 Verified，但 release workflow 的驗證 job 失敗，沒有任何已發佈的 release 資產。該 tag 保持不變；詳見 `docs/superpowers/reviews/2026-09-11-release-recovery-review.md`。

## Real-world runs

已驗證的 real-world run 記錄於此：把 vigil final report 依 `cressetide/skills/vigil/references/final-report.md` 的 Evidence Record 契約印出的 `### Live run` block 貼在下方，或改用 [Verified ctide run issue 表單](https://github.com/kktu6507/cressetide/issues/new?template=verified-run.yml) 提交；目前尚無已記錄的 run。上一節的 release 與 CI 證據不屬於此類，也不應被當作 real-world run 計入。
