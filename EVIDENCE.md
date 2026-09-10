# Cressetide evidence

可重現的證據由本 repository 自身產生：

- `npm run validate` 驗證 plugin 結構、Cressetide identity、Map、agent/skill/hook inventory、release 契約、`.ctide/` 邊界與 UTF-8 文字完整性。
- `npm test` 執行 hooks、Doctor、publisher、validator、workflow contracts 與其他功能測試。
- `npm run eval` 執行版本控制內的 deterministic evaluation cases。
- `npx --yes @anthropic-ai/claude-code@2.1.207 plugin validate --strict ./cressetide` 驗證 nested plugin（marketplace 驗證由獨立的 `kktu6507/plugins` repo 負責）。
- `.github/workflows/release.yml` 以既有 immutable tag 為輸入，分離 validate、publish、attest 權限；publisher 產生 deterministic archive、SHA-256 checksum，並拒絕缺少、重複或額外的 release asset。

以上命令的實際執行結果必須由當次變更的 verification report 或 CI run 記錄；本檔不以靜態敘述取代執行證據。

## Release 與 CI 證據

### v0.7.2 本機候選版（未發布）

**這不是 release，也不是 CI run。** 沒有 `v0.7.2` tag、release 資產或 attestation；安裝來源是指向候選版的本機 marketplace，不是已發布的 marketplace ref。以下的測試與驗證都是維護者在本機執行的 gate。

| 項目 | 記錄 |
|---|---|
| Plugin payload | `cressetide/` tree OID `8eba50b35904444ffea6a93e11a4bba0d1b86efe`，110 個檔案。安裝後的 plugin cache 與實際啟用的本機 marketplace 來源，都逐位元組比對等同候選版，smoke 之後也未改變 |
| 環境 | Windows、PowerShell 7.6.5、Node 22.23.2、官方 Claude Code 2.1.263、`claude-opus-5`、effort xhigh。config、專案與 TEMP 皆為全新隔離；未使用 plugin-dir override，而是透過實際安裝與 settings 啟用 |
| 載入 | reload 結果為 1 個 plugin、5 個 plugin skill、6 個 hook。helper 的 inventory 為 11 個 agent；host 回報的 agent 總數包含內建 agent，不是 plugin 的出貨數 |
| 本機 gate（最終 payload） | `npm test`：2,139 tests，2,126 pass，13 skip，0 fail，0 cancel；`npm run eval` 7/7；結構驗證與 documented-facts 測試通過；strict CLI plugin validate 通過 |
| 已安裝 helper | 預設 14 項全數通過。空專案加上 `--project` 多出 3 項 `unverified`。fixture 專案：`failure-memory-health` 找到檔案、0 筆 entry、`pass`；`incident:release-smoke` 為 open、`pass`，並附 salvage 的 guidance；`ledger-health` 為 0 open、0 escaped，沒有可作為錨點的 run 記錄、`pass`。加上 `--project` 時，既有的預設檢查與未加時相同；fixture 位元組未改變 |

**實際的 `/ctide:doctor` 預設執行（authenticated session）。** agent 先讀完最終版診斷契約，plugin root 來自 host 展開的 skill 呼叫（canonical），helper 14 項通過，隔離的 plan-gate 決策探測得到 `deny`、exit 0。隔離的 destructive-guard 探測**沒有執行**：agent 把契約中的直接 pipeline 改寫成巢狀的雙引號 command substitution（`"$(…)"`），host 端 destructive-guard 的引號判斷因此把探測字串裡的 `git reset --hard` 當成未加引號的指令，回傳 `ask`——這是偏向安全的誤判；這個 session 不接受權限提示，於是該指令被拒絕。報告正確判定為 degraded／未完成，列出被擋下的指令與未知之處，沒有改寫字串、停用 guard 或重試。這次觀察到一個真實的 host `PreToolUse` destructive-guard `ask` 事件；它不算隔離探測的通過。

**實際的 `/ctide:doctor --project` 執行（authenticated session）。** agent 先讀完最終版契約；helper 14 項通過並回報各專案列；兩項隔離決策探測在有效的重跑中分別得到 `deny` 與 `ask`，皆為 exit 0；最終判定為 healthy，所有列與 guidance 都有回報。第一次探測時，Git Bash 的路徑改寫讓探測路徑落在 TMP 之外；agent 自己察覺、沒有建立任何檔案，改用已驗證的暫存根目錄重跑兩項探測，上述結果只計入修正後的那次。fixture 檔名中的日期 `20260911` 比檢查當下的 UTC 日期晚一天，因此回報的天數為 -1；這來自 fixture 輸入與 UTC 日期計算，不是新的 plugin 回歸。

**兩次執行的範圍。** 兩份最終報告都停留在該次執行之內：刻意留在暫存目錄的無關對照檔沒有被提及，也沒有盤點機器層級的位置；專案與對照檔的位元組皆未改變。這是一次有限範圍的觀察，不是普遍保證。

**這些證據不涵蓋的範圍。** 不是已發布 marketplace ref 的安裝，也沒有驗證已發布的資產或 attestation；不構成 `docs/compatibility.md` 任何一項 checklist 的完整通過；只涵蓋 Windows 這一個 OS。模型、effort 與執行環境只描述這次有限範圍的 smoke，不建立任何成效、成本或時間結論。Real-world（Type-B）run 的記錄數仍為 0。發布後的 tag、CI、archive、attestation 與已發布 marketplace 的安裝驗證，會另外補記。

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

**Doctor 診斷契約的範圍限制。** 在 0.7.1 上，該次執行對 `references/diagnostic-contract.md` 步驟 1 的字面遵循是有限的：plugin root 是由 host 展開的 skill 呼叫以 canonical 形式提供，並經比對確認即為已安裝的副本；過程中沒有任何 filesystem 搜尋 fallback。步驟 1 的措辭已在 0.7.2 修正——0.7.2 目前是**未發布**的開發版本，上述所有觀察都來自已發布的 0.7.1；0.7.2 本機候選版的有限觀察見上方〈v0.7.2 本機候選版（未發布）〉。

**v0.7.0。** tag 存在、已簽章且 GitHub 驗證為 Verified，但 release workflow 的驗證 job 失敗，沒有任何已發佈的 release 資產。該 tag 保持不變；詳見 `docs/superpowers/reviews/2026-09-11-release-recovery-review.md`。

## Real-world runs

已驗證的 real-world run 記錄於此：把 vigil final report 依 `cressetide/skills/vigil/references/final-report.md` 的 Evidence Record 契約印出的 `### Live run` block 貼在下方，或改用 [Verified ctide run issue 表單](https://github.com/kktu6507/cressetide/issues/new?template=verified-run.yml) 提交；目前尚無已記錄的 run。上一節的 release 與 CI 證據不屬於此類，也不應被當作 real-world run 計入。
