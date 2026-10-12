# Cressetide evidence

可重現的證據由本 repository 自身產生：

- `npm run validate` 驗證 plugin 結構、Cressetide identity、Map、agent/skill/hook inventory、release 契約、`.ctide/` 邊界與 UTF-8 文字完整性。
- `npm test` 執行 hooks、Doctor、publisher、validator、workflow contracts 與其他功能測試。
- `npm run eval` 執行版本控制內的 deterministic evaluation cases。
- `npx --yes @anthropic-ai/claude-code@2.1.207 plugin validate --strict ./cressetide` 驗證 nested plugin（marketplace 驗證由獨立的 `kktu6507/plugins` repo 負責）。
- `.github/workflows/release.yml` 以既有 immutable tag 為輸入，分離 validate、publish、attest 權限；publisher 產生 deterministic archive、SHA-256 checksum，並拒絕缺少、重複或額外的 release asset。

以上命令的實際執行結果必須由當次變更的 verification report 或 CI run 記錄；本檔不以靜態敘述取代執行證據。

## Release 與 CI 證據

### v0.7.2（2026-09-11）

簽章 tag 物件 `8ad5122881360ace5263a77550a44fa7f0311f29`，指向 commit `630779a628394e9d66ea07dc765caad1189c50b3`；plugin payload（`cressetide/`）tree `8eba50b35904444ffea6a93e11a4bba0d1b86efe`，110 個檔案。Release：<https://github.com/kktu6507/cressetide/releases/tag/v0.7.2>，發布於 2026-09-11T00:36:13Z。

| 項目 | 記錄 |
|---|---|
| main CI run [`34543207135`](https://github.com/kktu6507/cressetide/actions/runs/34543207135) | head 為 `630779a`，三個 hosted runner OS 全部通過：Windows 2,144 tests，2,139 pass，5 skip；Linux 與 macOS 各 2,144 tests，2,142 pass，2 skip；皆 0 fail、0 cancel。這是自動化的 OS 覆蓋，不等於完整的 Claude Code host 相容性 |
| Release workflow run [`34546988820`](https://github.com/kktu6507/cressetide/actions/runs/34546988820) | validate、publish、attest 三個 job 皆成功。Node 22 / Ubuntu：2,144 tests，2,142 pass，2 skip，0 fail，0 cancel；eval 7/7 |
| 本機驗證（同一 commit） | Node 22.23.2 / Windows：2,139 tests，2,126 pass，13 skip，0 fail，0 cancel；`npm run validate` 通過；eval 7/7 |
| Tag 簽章 | SSH 簽章。本機以原生 OpenSSH `ssh-keygen` 執行 `git verify-tag v0.7.2`，對照維護者自行掌控、存放於 repository 之外的 allowed-signers 檔案（其中的公鑰先前已另行核對）：Good signature，principal `simba6507@protonmail.com`，fingerprint `SHA256:dK2K5xtd8KaxptR0git2AcL0sL9Ly1ZUEcjDMg28uXQ`。GitHub API 另外回報 `verified: true`、`reason: valid` |
| Archive | `ctide-v0.7.2-plugin.tar.gz`，110 files，SHA-256 `c300dd4f0a6a70c6ec0bc0cc13bd770591802379e16515ff7a510afd50da2815`；兩次從 tag 建置、發布前的 preflight 建置與下載後的資產位元組一致。Release 只有兩個資產：該 archive 與 `ctide-v0.7.2-plugin.tar.gz.sha256` |
| Attestation | `gh attestation verify` 驗證通過，綁定 repository、workflow、source ref `refs/tags/v0.7.2` 與 source digest `630779a628394e9d66ea07dc765caad1189c50b3` |

**已發布 marketplace 的安裝（維護者自行回報）。** 在全新隔離的 config、專案與 TEMP 下，從已發布的 `kktu6507/plugins` marketplace 安裝並啟用 0.7.2，未使用 plugin-dir override。安裝後的 cache 與實際啟用的 plugin 共 110 個檔案，逐一等同簽章 tag 的 blob；明確的 reload 結果為 1 個 plugin、5 個 plugin skill、6 個 hook；plugin 的 agent 為 11 個（host 回報的總數包含內建 agent）。環境：Windows、PowerShell 7.6.5、Node 22.23.2、官方 Claude Code 2.1.263、`claude-opus-5`、effort xhigh。

**直接執行已安裝的 helper（只是 helper，不是 agent run）。** 預設 14 項全數通過；空專案時，`--project` 多出 3 項 `unverified`。fixture 專案的 `--project` 三項皆為 `pass`：`failure-memory-health` 找到檔案、0 筆 entry；`incident:release-smoke` 為 open（天數 0），並附 salvage 的 guidance；`ledger-health` 0 open、0 escaped，沒有可作為錨點的 run 記錄。fixture 位元組未改變。

**實際的 `/ctide:doctor` 預設執行（authenticated session）。** agent 先讀完整份診斷契約；plugin root 來自 host 展開的 skill 呼叫（canonical）；helper 執行一次，14 項通過、exit 0。agent 把兩項決策探測寫在同一個 Bash script 裡，其中 destructive-guard 的 JSON pipeline 被包在巢狀的雙引號 command substitution（`"$(…)"`）中；host 端 destructive-guard 因此回傳 `ask`（exit 0），而這個 session 沒有核准介面，所以整個 script 都沒有執行。這與發布前候選版觀察到的是同一個偏向安全的引號／headless 限制，不是新的 JavaScript 缺陷。agent 沒有重試、改寫字串或停用 guard，只另外單獨執行了不受影響的 plan-gate 合成探測：`deny`、exit 0，所用的暫存路徑在前後都不存在。隔離的 destructive-guard 探測因此**沒有執行**；最終報告判定為 degraded／未完成而不是 healthy，這個判定正確。報告中顯示的被擋指令省略了外層的 command substitution；實際被擋的是上述巢狀包裝，不是契約中的直接 pipeline。

**觀察到的真實 host 事件。** SessionStart 的 failure-memory 注入（nonce 圍欄的 digest，exit 0），以及上述 PreToolUse destructive-guard 的 `ask`（exit 0）。其他 hook 的空回應不能證明缺少的 conformance 情境（例如 Stop advisory）。

**範圍與位元組檢查。** 報告停留在該次執行之內：沒有盤點機器層級的暫存目錄，刻意留下的無關對照檔沒有被提及。安裝後的 cache 與實際啟用的來源、fixture 專案與對照檔的位元組皆未改變。這是一次有限範圍的觀察，不是普遍保證。

**這些證據不涵蓋的範圍。** 已發布版本的 smoke 只涵蓋安裝、啟用、reload 與預設的 `/ctide:doctor`；`--project` 的實際 agent run 只有發布前候選版的紀錄，已發布版本只有上述直接 helper 的結果。不構成 `docs/compatibility.md` 任何一項 checklist 的完整通過；直接的 plan-gate 合成探測也不等於 host 的 plan-mode gating。以下完全沒有記錄：host 的 plan-mode gating、Stop advisory、真實的 compaction 行為、完整的 Vigil / Map / incident 交接流程。只涵蓋 Windows 這一個 OS；模型、effort 與執行環境只描述這次有限範圍的 smoke，不建立任何成效、成本或時間結論。Real-world（Type-B）run 的記錄數仍為 0。

### v0.7.2 發布前本機候選版（歷史紀錄）

**這是發布前的本機候選版觀察，不是 release，也不是 CI run。** 當時還沒有 `v0.7.2` tag、release 資產或 attestation；安裝來源是指向候選版的本機 marketplace，不是已發布的 marketplace ref。以下的測試與驗證都是維護者當時在本機執行的 gate。候選版的 `cressetide/` tree 與後來簽章 tag 的 payload tree 相同（`8eba50b35904444ffea6a93e11a4bba0d1b86efe`），所以這些觀察針對的正是實際出貨的位元組，只是安裝來源不同。

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

**這些證據不涵蓋的範圍。** 不是已發布 marketplace ref 的安裝，也沒有驗證已發布的資產或 attestation；不構成 `docs/compatibility.md` 任何一項 checklist 的完整通過；只涵蓋 Windows 這一個 OS。模型、effort 與執行環境只描述這次有限範圍的 smoke，不建立任何成效、成本或時間結論。Real-world（Type-B）run 的記錄數仍為 0。發布後的 tag、CI、archive、attestation 與已發布 marketplace 的安裝驗證，見上方〈v0.7.2（2026-09-11）〉。

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

**Doctor 診斷契約的範圍限制。** 在 0.7.1 上，該次執行對 `references/diagnostic-contract.md` 步驟 1 的字面遵循是有限的：plugin root 是由 host 展開的 skill 呼叫以 canonical 形式提供，並經比對確認即為已安裝的副本；過程中沒有任何 filesystem 搜尋 fallback。步驟 1 的措辭已在 0.7.2 修正；上述所有觀察都來自已發布的 0.7.1，0.7.2 的觀察見上方〈v0.7.2（2026-09-11）〉與〈v0.7.2 發布前本機候選版（歷史紀錄）〉。

**v0.7.0。** tag 存在、已簽章且 GitHub 驗證為 Verified，但 release workflow 的驗證 job 失敗，沒有任何已發佈的 release 資產。該 tag 保持不變；詳見 `docs/superpowers/reviews/2026-09-11-release-recovery-review.md`。

## Real-world runs

已驗證的 real-world run 記錄於此：把 vigil final report 依 `cressetide/skills/vigil/references/final-report.md` 的 Evidence Record 契約印出的 `### Live run` block 貼在下方，或改用 [Verified ctide run issue 表單](https://github.com/kktu6507/cressetide/issues/new?template=verified-run.yml) 提交；目前尚無已記錄的 run。上一節的 release 與 CI 證據不屬於此類，也不應被當作 real-world run 計入。
