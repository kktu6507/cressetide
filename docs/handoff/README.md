# v0.8 瘦身重構：交接說明

> 這個資料夾只給工作 branch `refactor/v0.8-slim` 換機器接手用。**merge 回 main 之前要整個刪掉**（最晚在 P13 收尾時）。

## 這個 branch 在做什麼

2026-10-13 對整個 repo 做了全面盤點，使用者決定把 cressetide 瘦身成 v0.8.0：

- 把用不到的 test-provenance（TP）整套和 run ledger 拿掉。
- 不再支援 Copilot CLI。
- 重複的工具函式改成共用模組。
- 修掉所有找到的 bug。
- 能交給 Claude Code 原生功能做的，就交給原生功能。

完整計畫在 [plan.md](plan.md)，24 條驗收條件在 [contract.md](contract.md)。

## 目前做到哪裡

| 階段 | 狀態 | commit |
|---|---|---|
| P0 基線、實機探測、archive tag | 完成 | （沒有產品 diff）tag `archive/v0.7.2-full` → `acbe433` |
| P1 Node 下限 22.12、`npm test` 只跑 `test/**/*.test.mjs` | 完成 | `cd8a02d` |
| P2 移除 TP 與 run ledger、ship pending 改從 git 推得、封存 `docs/superpowers` | 完成 | `5afc115` |
| 第 1 輪 review（intent / test / code / architecture + arbiter） | **FIX REQUIRED** | — |
| 第 1 輪修復 R1–R7 | 完成 | `72b01a0` |
| 第 1 輪複審（intent / test / code + arbiter，新機器） | **FIX REQUIRED**（無 blocker；4 個 major 都很小） | — |
| 第 1 輪修復 R2-1～R2-5（含使用者核准的兩項順手修正） | 完成 | `ec91bf6` |
| 第 1 輪複審 2（intent / test / code + arbiter） | **FIX REQUIRED**（無 blocker；2 個 major，都在 ship 的淺層偵測） | — |
| 第 1 輪修復 R3-1～R3-5 | 完成；四個結案條件逐條核對成立 → **第 1 輪 READY** | `64c2564` |
| P3 validator 合併、overlay 負向測試、測試共用工具（含使用者追加項目） | 完成 | `53b2e18` |
| P3 中途 review（intent / test / code + arbiter） | **FIX REQUIRED**（無 blocker，3 個 major） | — |
| P3 修復 P3-R1～R8 | 完成；六個結案條件逐條核對成立 → **P3 READY**（見 [p3-redgreen.md](p3-redgreen.md)） | 本段 commit |
| P4 共用 `cressetide/lib/`、7 支 script 與 ship／publish-release 改用 lib、刪 publish-release-core 與 9d d4/d5（含使用者決定 Q1–Q5） | 完成；證據見 [p4-evidence.md](p4-evidence.md) | `19db2bc` |
| P4 中途 review（intent / test / code / security + arbiter） | **FIX REQUIRED**（無 blocker；1 個真 bug + 5 個測試缺口，皆為 major） | — |
| P4 修復 P4-R1～R7 | 完成；七個結案條件逐條核對成立 → **P4 READY**（見 [p4-evidence.md](p4-evidence.md) 最後一節） | 本段 commit |
| P5 hooks 改成 2 個入口＋`lib/guards`、移除 Copilot 與 `agents[]`、debug 遮蔽 secret、failure memory 支援 `##`／`###`（含使用者決定 I-1～I-10、P4 排過來的待辦） | 完成；證據見 [p5-evidence.md](p5-evidence.md)，實機冒煙 3/3 通過 | 本段 commit |
| P5 中途 review（intent / test / code / security + arbiter） | 未開始；**下一步** | — |
| P6 → P13 | 未開始 | — |

逐步紀錄在 [progress.md](progress.md)，第 1 輪 review 的完整內容在 [review-round1.md](review-round1.md)，實機探測結果在 [probes.md](probes.md)。

## 換到另一台電腦要先做的事

1. **取得 branch 和 tag**

   ```bash
   git fetch origin
   git checkout refactor/v0.8-slim
   git fetch origin tag archive/v0.7.2-full
   ```

2. **Node 22.12 以上**。用 `node --version` 確認。
3. **Claude Code CLI 已登入**：`claude auth status` 要顯示 `loggedIn: true`，版本 2.1.272 以上（plugin eval 需要 2.1.269 以上）。實機探測和 A/B 會用到 `claude -p`。
   - 原機器上，從桌面 app 的 Bash 呼叫 `claude -p` 會繼承一堆 `CLAUDE_CODE_*` 環境變數。探測時先清掉這些變數，再以獨立 CLI 執行（`probes.md` 開頭有說明）。
   - 桌面 app 的登入走 host 代理，子行程拿不到；獨立 CLI 要另外跑一次 `claude auth login`（由使用者在終端機完成）。帳號同步的 plugin 也要在 `--settings` 用 `"<name>@synced": false` 關掉（見 `probes.md` 的 I-8 一節）。
4. **GPG 簽章**：原機器設了 `commit.gpgsign=true` 和 `tag.gpgSign=true`，所以這個 branch 的 commit 都有簽章。新機器要有同一把簽章金鑰，或由使用者自己決定怎麼處理。**不要自行跳過簽章。**
5. **ctide plugin**：這次是用已安裝的 ctide plugin 的 vigil 流程在跑（原機器上安裝的是 marketplace `kktu` 的 0.5.0）。新機器也要裝。
6. **把工作檔放回 gitignored 的位置**

   ```bash
   mkdir -p .ctide/output
   cp docs/handoff/contract.md .ctide/output/contract.md
   cp docs/handoff/progress.md .ctide/output/progress.md
   ```

7. 原機器的 baseline TAP 檔（`baseline-before.txt`，約 1.3 萬行）沒有帶過來，數字都記在 `progress.md`。最後收尾時重跑一次全套，存成 `baseline-after`，再拿來比對。

## 新 session 怎麼開始

可以直接這樣跟 Claude 說：

> 繼續 cressetide v0.8 瘦身重構。先讀 `docs/handoff/README.md`、`plan.md`、`progress.md`、`review-round1.md`，從「下一步」第 1 項開始，照 ctide vigil 流程（implementer 實作 → 驗證 → reviewer → arbiter）。

計畫已在 2026-10-13 核准，**繼續實作已核准的計畫不用重新進 plan mode**。遇到計畫沒寫到、需要使用者拍板的事，用 AskUserQuestion 問。

## 下一步（依序）

1. **第 1 輪已結案（READY，2026-10-14）**：複審 2 的 R3 修復在 `64c2564` 完成，arbiter 列的四個「只憑證據結案」條件都逐條核對成立，見 [review-round1.md](review-round1.md) 的「Round-1 closure」和 [r2-redgreen.md](r2-redgreen.md) 的 R3 一節。
2. **P3 已結案（READY，2026-10-14）**：下面的修復 P3-R1～R8 已完成，六個結案條件都逐條核對成立（[p3-redgreen.md](p3-redgreen.md)）。**下一步是 P4。** 以下保留當時的判決與條件，供對照。P3 中途 review（範圍 `37ea5df..53b2e18`）判定 FIX REQUIRED，3 個 major：
   - **MJ-1**：validator 把「存在但讀不到」的檔案當成不存在，§6／§7 默默通過（舊版會失敗）。
   - **MJ-2**：CLI 的失敗路徑（exit code、`FAILED` 輸出）沒有任何測試了。
   - **MJ-3**：開發者全域 `core.abbrev=12` 會讓 `ship.test.mjs:693` 變紅（fixture 算的短 SHA 跟 production 的 `%h` 長度不同）。

   修復清單：R1 讀取錯誤只有 `ENOENT`／`ENOTDIR`／`EISDIR` 算不存在，其他回報 `cannot read <rel>: <code>`；R2 在 temp 目錄只複製兩支 validator 檔，測 CLI 失敗路徑；R3 `makeRepo` 釘住 repo-local `core.abbrev`；R4 `gitEnv` 多清 `GIT_CONFIG`、`GIT_AUTHOR_*`／`GIT_COMMITTER_*`、`GIT_NAMESPACE`，並釘住 `core.hooksPath`；R5 overlay 的刪除改成跟 `git ls-files -co` 一致，共用 `SKIP_DIRS`；R6 `validate({root, read})` 沒給 `files` 時丟 `TypeError`；R7 測試包裝只在 `fn.length === 2` 時用 callback 形式，保留函式名稱；R8（使用者 2026-10-14 決定）README 的 `##` 段落數恢復舊的原始計數比對，與 §8 略過 code fence 的比對並存。

   **只憑證據結案的六個條件**（全部成立才算，否則跑 code + test 的窄範圍複審）：(1) diff 只動 `validate-structure-core.mjs`、`validate-structure.test.mjs`、`helpers.mjs`、`helpers.test.mjs`，既有斷言與 regex 不變（R5 的 overlay 函式與標頭註解除外）；(2) 每個 R 項目的測試對每個指定 mutant 各自變紅、修好後變綠，紀錄格式同 `r2-redgreen.md`；(3) 全新 TEMP 跑全套 exit 0、0 失敗、skip 仍是 6、0 個 `ctide-*` 殘留，`npm run validate` 0，`contract-check --base 53b2e18` 0（`cressetide/` 沒變才可沿用 plugin validate 結果）；(4) 7 個用到 git 的測試檔加 `helpers.test` 在 set H 加 `core.abbrev = 12` 下全過、0 殘留；(5) 在 Windows 用 icacls 拒讀重現 MJ-1，CLI 要 exit 1 並印出 `FAILED` 與兩行 `cannot read`；(6) `validate-structure.test` 和 `helpers.test` 在 Node 22 也過。
3. **P3（已完成的內容與要求，供對照）**：validator 合併成 `validate({root, read})`，負向測試改用 overlay reader，不再複製整個 repo；`helpers.mjs` 和 `support.mjs` 合併，只留一個 `makeRepo`，temp 目錄要清掉。另外兩項要求：
   - **temp helper 要涵蓋所有沒清理的測試檔**：`ship.test.mjs`、`contract-check.test.mjs`、`support.mjs`、`helpers.mjs` 等所有 `mkdtempSync` 都改走同一個會自動清理的 helper（`t.after`），並用全套 `npm test` 前後的 `ctide-*` 目錄數量比對來證明（AC-20）。
   - **validator 只掃追蹤中、未被忽略的檔案**（使用者 2026-10-14 核准）：scratch 檔與文字完整性檢查改用 `git ls-files -co --exclude-standard`，本機 gitignored 的 `.ctide/collaboration/` dogfood 資料才不會讓 `npm run validate` 失敗。最終報告列為核准的順手修正。
   - **測試用的 git 要密封**（複審 2）：fixture 裡的 git 不受開發者全域設定影響，例如 `merge.verifySignatures=true` 會讓 `ship.test.mjs` 的 merge fixture 假紅（新舊測試都有）。用一個集中的 fixture-git helper 處理，不要逐個測試補旗標。
   - **SSH 簽章測試的 skip 要看能力**（複審 2）：除了 `ssh-keygen` 能不能啟動，git < 2.34 或 OpenSSH < 8.1 也要說明原因後 skip，不能直接紅燈。
4. **P4 已結案（READY，2026-10-15）**：實作在 `19db2bc`，修復 P4-R1～R7 已完成並逐條核對七個結案條件。P5 也已完成（見下一項）。以下保留中途 review 的判決、修復內容與條件，供對照：
   - **R1**：contract-check 明確給 `--base` 時，`git diff` 失敗會被當成 `scope: clean`（工作樹裡有個以 SHA 命名的檔案就能觸發，已重現）；revision 後面加 `--`，明確 `--base` 時 diff 失敗回報 `unverified`，`--base ""` 也算明確；`changedFiles` 一併加 `--`。
   - **R2～R4**：補上五個「程式碼正確但沒有測試釘住」的缺口（ship 不寫 index 的 CHANGELOG 未變更情境、changelogTouched 的 pathspec、headState 對 orphan branch 的規則、Q3 只把解析後的 SHA 交給 git、遮蔽規則先遮再截斷）；遮蔽規則也改成沒有結尾的私鑰區塊不會漏出內容。
   - **R5**：ship 讀 git 時 revision 後面也加 `--`。**R6**：修正註解與 7 個還寫著 `isInvokedDirectly` 的測試標題。**R7**：ship-contract.md:85 與 ARCHITECTURE.md 的目錄樹（使用者核准 O-3、O-4）。
   - **只憑證據結案的七個條件**（全部成立才算，否則請 code + test reviewer 窄範圍複審）：(1) 每個指定 mutant 都以「只還原那一行」各自打紅；(2) 全新 TEMP 全套 exit 0、0 失敗、skip 仍 6、0 殘留；(3) validate 0、plugin validate --strict 0；(4) 新的 S0 錄製對 `p4c-exit` 0 列變動、對基準 compare exit 0；(5) 擴充版敵意設定（含失敗的 `post-index-change` hook）下所有 git 與 lib 測試 0 失敗；(6) AC-9 單一副本 grep 不變，`isInvokedDirectly` 只剩 lib-binding、eval 與 CHANGELOG，arbiter 的 S-M1 重現改為回報 `forbidden-path hits`；(7) 只動 R1～R7 指定的檔案。

   原本列在這一階段的待辦（都已完成）：
   - `git()` 的 1 MiB maxBuffer。
   - contract-check 移除 flag 的 CLI 測試。
   - Doctor node 列的綁定測試。
   - `counted.status` 的 fault-injection 測試，並把 `rev-list --count` 改成嚴格解析 `/^\d+$/`（第 1 輪 F-j）。
   - ship 搬到 `lib/git` 時，逐一檢查 code-reviewer 留下的四條線索：resolveMarker 讀 tag 清單失敗、tagReady 的 rev-parse 失敗、子目錄 `--cwd` 的 changelogTouched、HEAD 損壞被標成 `no-release-tag`。
   - **lib/git 集中中和使用者 git 設定**（複審 2）：用明確的 `-c key=value` 覆寫，包括 `i18n.logOutputEncoding`，並補一個非 ASCII commit 標題的測試。**不要**用 `GIT_CONFIG_GLOBAL`／`NOSYSTEM` 整個隔離，否則會丟掉 `safe.directory`，遇到「dubious ownership」的 repo 每次讀取都會失敗。
   - **lib/git 也要丟掉繼承來的 git 環境變數**（P3 review m-1）：root 是明確給定的，所以忽略 `GIT_DIR`、`GIT_WORK_TREE`、`GIT_INDEX_FILE`、`GIT_COMMON_DIR`、`GIT_OBJECT_DIRECTORY`、`GIT_ALTERNATE_OBJECT_DIRECTORIES`；validator 的 `gitFiles` 改用同一套規則。補測試：在繼承絕對路徑 `GIT_DIR`／`GIT_INDEX_FILE` 的環境下跑 `gitFiles(fixture)` 和一條 production 路徑。
   - **P4 計畫核准時請使用者決定**：要不要用 `--ignore-submodules=none` 覆寫 `diff.ignoreSubmodules`。不覆寫的話，submodule 被移動時 tagReady 可能誤判 `pass`，pending 也會漏列 gitlink；覆寫的話，連專案自己在 `.gitmodules` 設的 `ignore` 也會被蓋掉。
5. **P5 已完成（2026-10-15），下一步是 P5 中途 review**（使用者 I-9：intent、test、code、security 加 arbiter，允許依條件只憑證據結案，套用 D-7；範圍 `86ba905..` P5 commit）。內容：hooks 改成 `pre-tool-use.mjs`、`session-start.mjs` 兩個入口（Stop 的 `orchestration-check.js` 不動，I-5），檢查邏輯搬到 `cressetide/lib/guards/` 與 `lib/{hook-io,debug,settings,failure-memory}.mjs`；S0 行為比對 1474 列、126 列變動全部落在核准的變更類別；實機冒煙 3/3 通過（[probes.md](probes.md) 的 I-8 一節）。證據全文在 [p5-evidence.md](p5-evidence.md)。下面列的待辦除了 validator 負向測試（P5d）之外都已完成。
   - **P5 發現、沒有改的項目**：
     - **交給 P5 中途 review 決定**：contract 檢查的 design.md 標題 regex `/^\s*##\s+(.+?)\s*$/` 是平方級（標題行有 4 萬個空白時 535 ms；只有寫入 design.md 的工具呼叫會碰到）；contract.md／design.md 整檔讀取沒有上限（照搬舊 hook）。
     - 其他排到 P6～P8 的項目列在各階段底下。
   - failure memory 的 `--log` usage 檔要寫進狀態模型。
   - **D-4 的硬性要求**：plan-gate 的 4 個 F1 計時測試（sed / perl / git apply / dd）改成 in-process 量 classifier 時間（例如 `< 250 ms`），並在 scratch 副本拿掉 `{0,200}` 上限時錄到紅燈；做不到紅燈就不算完成。
   - **helper 整理**（P3 review m-7）：`execHook` 和 `runHook` 名字太像、行為不同，改名（例如 `hookStdout`），改用 `process.execPath`；只在模組內用到的 `hardenGitSigning`、`gitEnv` 不再匯出，或寫明用途。
   - **P4 review 排過來的項目**（期限 P5 結束）：
     - ship 的兩個已知殘留（使用者接受到 P5，D-6）：HEAD 和 tag 之間缺 commit 時 `git tag --merged` 印錯誤卻 exit 0、被當成 `no-release-tag`；`refs/tags/` 裡有損壞的 tag 時 tagReady 判成「沒有這個 tag」。修法：stderr 非空就當讀取失敗，同時在 lib 的 `gitEnvironment()` 清掉 `GIT_TRACE*`（開 tracing 時健康的查詢也會寫 stderr）；不可比對在地化的錯誤訊息；各補一個故障測試。
     - lib/git 的 `encoding: null` 目前會被當成 utf8：改成視同 `"buffer"`，或對其他值丟 TypeError。
     - lib-binding 的「有用到」檢查會被字串、樣板字串、regex、`i++ /` 這類寫法騙過：每種寫法補一列單元測試；簽章檢查改成禁止 lib 以外 import `node:child_process`（列出明確例外）。
     - NEUTRAL_CONFIG 加 `core.fsmonitor=false`（含釘住測試）。
     - read-capped 的短讀迴圈與 fstat 沒有測試：用 patch `fs` 的方式補（一次讀 1 byte；`statSync` 丟錯時仍正常）。
     - **failure-retrieve 的用法錯誤**（使用者 O-6 A）：維持嚴格解析，但輸出改成明確的「指令列無法解析，沒有搜尋」訊息，不再跟「沒找到」一樣；以 `-` 開頭的查詢值要用 `--query=` 寫法。
   - **validator 負向測試補齊，期限在第 2 輪 review 的 packet 之前**（P3 review m-12、m-13）：擴充檢查裡沒被測到的子條件（identity 的 `pkg.name`／`plugin.name`、各 README 的 `/ctide:*` token、`map` 的 manual-only 旗標、hook 語法檢查的 ESM 分支、`.yml`／`.lycheeignore` 文字類型、U+FF82、`~` 結尾的 scratch 檔），以及 25 個從來沒有負向測試的核心檢查。優先順序：5g HSO accept-set；5f／5j／5k／9f 的檔案不存在保護；5e cannot-locate；plugin.json 欄位與 semver；frontmatter；hooks.json 引用不存在的 hook、README 的 hook 名稱與連結。9d 相關的不補（AC-9 會整個拿掉 9d）。
6. **P6**：SubagentStop 紀錄器加上新的 Stop；要包含一個 ship session 的回歸案例。這個案例的 commit subject 要含 `READY`、`major`、`minor`，報告裡也要有否定句「never means 'safe to ship'」，新的 Stop 都必須保持安靜（第 1 輪複審 F-k）。
   - **P5 排過來的項目**：`orchestration-check.js` 的殘留（I-5：自己的 debug 開關，任何非空值都算開；自己的 `ctide-hook.log` 字面值與 5 MiB stdin reader；「kept in sync with plan-gate.js」註解；camelCase 欄位別名；寫進 log 的前綴少了 `ctide `），P6 結束時驗收 AC-6／AC-9 的這幾點；`test/orchestration-check.test.mjs` 直接 spawn `"node"`（3 處），改用 `process.execPath`。
7. **P7 → P13**：照計畫做。
   - **P8 第一次改 prose 之前**，要先把被刪掉的 fast-lane 和 test-reviewer QA 輸出的 prose 守衛補回來（拿掉 TP 的部分）。同一個期限內，還要替低／中風險 run 定義實作階段可引用的 edge 來源（第 1 輪複審 F-l）。
   - **P7**（P4 review 排過來，期限 P7 結束）：contract-check 改用 `changedFiles` 之前先決定 submodule 的語意（D-6）；AC-10 的測試要斷言 index 位元組不變、沒有任何 hook 被執行（現在的 `git diff <rev>` 會改寫 index 並觸發 `post-index-change`）；map 在沒裝 git 時的 TypeError（檢查 `result.error`）；lib/git 匯出 `resolveCommit(root, rev)`，P7 結束時 lib 以外不得再有 `[a-f0-9]{40,64}` 的 regex 副本；contract-check 和 ship 的用法錯誤回顯限制在約 200 字；`changedFiles` 有了呼叫端後補一個 staged `git mv` 的 `--no-renames` 測試。P5 排過來的：doctor 的 `projectLocalMemoryCandidates` 手抄了 `memoryCandidates` 的前兩條路徑，改成 import `cressetide/lib/failure-memory.mjs`。
   - **P8**：ship 對 orphan branch 的說明改成「HEAD does not resolve to a commit (an orphan branch with no commits yet, or a broken or dangling HEAD) — commits since the last release tag are unknown」（使用者 O-2 A）；子目錄 `--cwd` 沒有自己的 CHANGELOG.md 時，evidence 改成「no CHANGELOG.md in the --cwd directory」；ship-contract.md:56 引用的 range diff 指令補上程式現在用的結尾 `--`（P4-R5 之後文件與程式差一個分隔符）。P5 排過來的：`test/ship.test.mjs` 直接 spawn `"node"`（6 處），改用 `process.execPath`；diagnostic-contract 第 4 步 `hook-debug` 列的說明補上新的遮蔽檢查；ARCHITECTURE.md:25-27 補上 hook 入口也從 `cressetide/lib/` 取共用工具。   - **P11** 改 README 時：`ship.test.mjs` 的 README 測試只讀每個標題下的第一行，段落重新換行時要一起檢查。P11 第一次跑 CI 時，量 Windows 全套測試時間離 20 分鐘上限還剩多少（P3 review c-1），並記下 Node 22 在 ubuntu／macOS／windows 的實際結果。另外（P4 review）：不帶 tag 的 `--archive` 會把未追蹤的檔案打包進去，改成只用 `git ls-files --cached`（或有未追蹤檔就拒絕），`.gitignore` 的規則改成 `**/.claude/settings.local.json`；補 publish-release 30 秒逾時的釘住測試，以及帶 tag 的封存檔也包含 `lib/` 的斷言。
   - **多餘的手動清理區塊**（P3 review m-6）：`tempDir` 已經會自動清理，下列檔案裡的 `try/finally fs.rmSync` 是重複的，哪個階段碰到該檔就順手刪掉：P4 的 release-publisher（40 個，檔案會刪）、release-cli（14）；P5 的 failure-consolidate、failure-retrieve（共 5）；P6 的 orchestration-check（5）；P7 的 map、doctor-project、regression-delta（共 9）；P10 的 model-provenance（3，檔案會刪）。**P13 收尾時 grep 要歸零**，只保留清理非 `tempDir` 目錄的區塊（例如 `globalDir`）和 orchestration-check 刻意提早釋放的那幾個。

每個階段的共同要求：`npm run validate`、`npm test`、`npx --yes @anthropic-ai/claude-code@2.1.272 plugin validate --strict ./cressetide` 三項都要綠，用 `git grep` 確認該清的東西零命中，然後 commit。例外只剩 D-2 的 doctor-security `--plugin-root` 探測（負載下可能逾時）；session-memory-hooks 的 ReDoS 計時和 D-4 的四個計時測試已在 P5 改成 in-process 量 classifier 時間，並錄到紅燈。P3 之後 validator 只掃追蹤中、未被忽略的檔案，主 checkout 可以直接驗證，不必再用乾淨的 worktree。測試的暫存殘留用「把 TEMP／TMP／TMPDIR 指到全新目錄、跑完數 `ctide-*`」來量。每個階段結束時，順手清掉多餘的檔案（scratch 副本、用完的 worktree、測試漏掉的 `ctide-*` 暫存目錄）。

## 已確定的決定（不要重新討論）

- **D1**：TP 全部封存移除。三個觀念改寫成一般 review 規則，已完成。
- **D2**：不支援 Copilot CLI。
- **D3**：ledger、reconcile、consolidate 整套移除。ship 的 pending 改從 git 推得，並明講「不代表 readiness」。
- **D4**：改用共用模組 `cressetide/lib/`，刪掉「複製一份再用 hash 守住」的寫法。
- **D5**：保留全域 failure memory，改程式讓 `##` 和 `###` 標題都認得。
- **Q3**：小實測照做；A/B 也做，上限 US$20，到了就停下來回報。
- **Q4**：開 branch，每個階段 commit。使用者在 2026-10-13 進一步要求每段落結束後 commit 加 push，方便換電腦接手。
- **D-1**：EVIDENCE.md 的歷史紀錄段落列入 AC2 的例外。
- **D-2**：三個計時測試（session-memory-hooks 的 ReDoS 800 ms、structure 的 validator 10 s timeout、doctor-security 的 `--plugin-root` 探測）在 P3/P5 改成 in-process 計時之前，當作已揭露的例外。
- **D-3**：共用的 `isShallowClone` 修正會順帶影響 marker 和 tagReady，已核准。
- **D-4**（2026-10-14）：plan-gate 的 4 個 F1 計時測試（sed / perl / git apply / dd）和 D-2 同一類（計時區間 9 成以上是啟動 node），在 P5 改成 in-process 計時之前當作已揭露的例外。門檻不改。
- **簽章**（2026-10-14，新機器）：這台機器用本機的 GPG 金鑰 `C446A14B5ED9EB97` 簽章（只設在這個 repo：`commit.gpgsign`、`tag.gpgSign`）。`2306078` 以前的 commit 是原機器的 `…1DDE4E2631D2F19D` 簽的。
- **validator 掃描範圍**（2026-10-14）：併進 P3，只掃追蹤中、未被忽略的檔案。
- **P3 範圍追加**（2026-10-14，navigator 盤點後使用者決定）：
  - 效率實驗測試（P10 會刪）漏出的約 237 個 `ctide-eff*` 暫存目錄，P3 就修到 0（對 eval/efficiency 的 driver 注入 tmpdir）。
  - validator 的擴充檢查從來沒有負向測試保護（舊測試在複製出來的 repo 裡跑 CLI，擴充檢查卻驗證真正的 repo），P3 每個擴充檢查至少補一個 overlay 負向案例。
  - P3 結束後加一輪中途 review（intent / test / code + arbiter），列為偏離計畫。
- **D-5**（2026-10-14，P3 review arbiter 裁定、使用者核准）：temp 清理續用 `helpers.mjs` 的 `test` 包裝（AsyncLocalStorage 帶 `t`，`t.after` 收尾），接受測試報告的位置都顯示 `helpers.mjs`。沒選的方案：逐點傳 `t`（約 524 處，所有 builder 都要改簽名）；root 層 `beforeEach`／`afterEach` 堆疊（Node 24 實測循序與巢狀可行，但並行測試會刪錯目錄，Node 22 未驗）。改回的條件：P11 決定 CI 需要檔案位置標註，或 node:test 提供公開的位置覆寫；屆時成本是每個檔案改一行 import。
- **README `##` 段落數比對**（2026-10-14，使用者決定）：validator §8 略過 code fence 的比對，和舊 `structure.test` 的原始計數比對兩者並存（P3-R8）。
- **P4 計畫決定**（2026-10-14，navigator 盤點後使用者決定）：
  - **Q1 `diff.ignoreSubmodules`**：lib/git 集中加 `-c diff.ignoreSubmodules=none`，只中和使用者個人設定；專案在 `.gitmodules` 宣告的 `ignore` 仍然有效。
  - **Q2 ship 子目錄 `--cwd` 的 changelogTouched**：以 `<cwd>/CHANGELOG.md` 為準，diff 判斷也用同一份。
  - **Q3 `contract-check --base` 參數注入**（已重現：`--base --output=x` 會讓 git 寫檔）：P4 就修，開頭是 `-` 的 base 一律拒收，先解析成 SHA 才交給 git。
  - **Q4 五項順手修正**：lib/git 設 `GIT_OPTIONAL_LOCKS=0`（ship 的 `git status` 不再改寫 `.git/index`）；failure-retrieve 的 `--log` 吞參數提前在 P4 修好（P5 的對應待辦改為已完成）；map 改用共用的 `headState`，HEAD 指向的物件不存在時改成報錯；read-capped 改用 fd 和 `fstat`；publish-release 的 git 呼叫加 30 秒逾時。
  - **Q5 ship-contract.md 改動**：原本的 6 項核准，commit 前把英文定稿給使用者看；定稿時又追加 2 項（changelogTouched 的讀法、用法錯誤的行為），8 項全部核准。
  - **P4 之後加中途 review**：intent、test、code、security 加 arbiter，允許依條件只憑證據結案修復；列為偏離計畫。
  - **D-6**（2026-10-15，P4 review 後使用者選 O-1 A）：`diff.ignoreSubmodules=none` 維持不變。實測 git 2.55 的內建預設在不同指令不一致：`git status` 本來就會回報 submodule 裡的未追蹤內容（等同 `none`），`git diff` 則會隱藏（等同 `untracked`），沒有單一值能同時對齊；`none` 只會多報、不會漏報。代價是使用者沒改任何設定時，contract-check 也會把含未追蹤檔的 submodule 列為變更。沒選的方案：改成 `untracked`（tagReady 的 `git status` 會比 git 預設寬鬆，是回歸）；只對 contract-check 的 diff 加 `--ignore-submodules=untracked`（會蓋掉專案 `.gitmodules`，而且 P7 會換掉這個讀法）。P7 把 contract-check 改用 `changedFiles` 之前決定完整的 submodule 語意。另外接受兩個殘留到 P5 結束：HEAD 和 tag 之間缺 commit、`refs/tags/` 裡有損壞的 tag（都需要損壞的 repo，下游也都安全失敗）。
  - **D-7**（2026-10-15，P4 review arbiter 提出、使用者核准）：「測試缺口」只有同時符合四個條件才算 major：(1) 該行為是這個階段新增或改寫的，或這個階段寫的測試聲稱有釘住它；(2) 該行為是明文的約定（使用者決定、排過來的待辦、合約文件，或程式自己的說明）；(3) 一個合理的單點修改 mutant 會造成看得到的有害結果（假的通過／乾淨、破壞「不寫入」、假的來源紀錄、密鑰外洩）；(4) 在該 mutant 下相關的整套測試仍然全綠。任何一條不符合就是 minor 並排到後面。之後所有 review 都照這個規則。
  - **O-2**（使用者選 A）：在已有 commit 的 repo 裡切到 orphan branch 時，ship 維持回報 `unverified`，P8 改說明措辭。
  - **O-6**（使用者選 A）：failure-retrieve 維持嚴格解析，P5 把用法錯誤的輸出改成明確訊息。
  - **P5 計畫決定**（2026-10-15，navigator 盤點後使用者全部照建議）：
    - **I-1**：plan-gate 的 edit 分支保留（偏離 #1 不變）。
    - **I-2**：debug log 維持 `暫存目錄/ctide-hook.log`，超過 1 MiB 清空重寫（只動自己的 log）；前綴改成 `[ctide pre-tool-use] plan-gate: …` 這種「入口＋檢查名」格式。
    - **I-3**：failure memory 判斷「有沒有 `###`」時不算範本的佔位標題（`### <YYYY-MM-DD> — …`）；這種檔改用 `##` 解析，`## Entry Template` 這類章節標題會被當成沒有 tags 的 entry，接受。
    - **I-4**：沒有 entry 時注入的指標文字：`Failure memory: <path> has no "##" or "###" entry headings this hook can index, so none of its content is injected. During planning, read the file directly for lessons relevant to the task.`
    - **I-5**：Stop hook（orchestration-check.js）在 P5 不動；它自帶的 debug 與 stdin reader 列為已揭露的殘留，P6 結束時驗收 AC-6／AC-9 的這兩點。
    - **I-6**：`--log` 用量檔只寫進 runtime-contract 的 `.ctide/` 樹，標明本機用、不 commit、請加進 .gitignore。
    - **I-7**：35 項文件改動照清單做（README 以 zh-TW 為準，commit 前給使用者看三語定稿）。
    - **I-8**：P5 結束時跑一次便宜的實機冒煙（haiku，3 個提示，約 US$0.1–0.3）。
    - **I-9**：P5 之後加中途 review（intent、test、code、security 加 arbiter），允許依條件只憑證據結案，套用 D-7。
    - **I-10**：implementer.agent.md 的 tools 拿掉 `MultiEdit`。
    - navigator 發現並併入 P5：failure-retrieve／consolidate／`doctor --project` 的退役判斷 regex 沒有上限（240 KB 標題實測 1.4 秒），改用共用的有上限 parser；doctor 的 malformed 探測沒用 `probeEnv`；failure memory 的「找不到 entry」fallback 其實塞進最多 3000 字原文，改成只注入指標。
    - **P5 執行中的決定**（orchestrator 決定並揭露；README 三語定稿與清單外 5 個檔案由使用者 2026-10-15 核准）：
      - failure memory 的 Tags 讀法改成線性 reader：原本的 regex 是立方級（一行 4 KB 要 6.6 秒），和舊 pattern 做 200 萬行差分比對 0 不一致。
      - 空的記憶檔、全部 entry 都已退役、只有範本佔位標題的記憶檔，一律不注入任何東西（連指標都不注入）。
      - lib/git 的 `encoding` 不是 `utf8` 也不是 `"buffer"` 時丟 `TypeError`（P4 排過來的兩個選項之一）。
      - hook 收到 BOM 開頭的輸入視為格式錯誤：P5a 曾改成接受，S0 抓到 plan mode 的一個事件從 fail-open 變成 deny，P5c 還原。
      - validator 的新規則用字元類別拼已刪除的名稱（`/cop[i]lot/i`、`/\bPLUGIN[_]ROOT\b/`），測試也用組字串的方式，讓「已刪名稱」的 grep 維持 0。
      - doctor 一律先建立 probe root，所有探測（含語法檢查）都用 `probeEnv`，結束時刪除；agents 列用自己的 8 行 frontmatter parser（validator 另有一份等價的，兩個程式各一份，不另開 lib 模組）。
      - lib-binding 的 `NOT_YET_IN_SCOPE` 保留 `eval/`（P10）和 `orchestration-check.js`（P6）。
      - 清單外 5 個檔案（vigil SKILL.md:156、design-spec.md:30、external-capabilities.md:32、navigator.agent.md:39、diagnostic-contract.md 描述手動第 5 步的幾行）改成新的入口名稱，避免說明變成錯的。
  - navigator 的設計假設照採用：eval 的 `KNOWN_FLAGS` 留到 P10；`changedFiles` 在 P4 建好並測試、P7 才接到 contract-check；validator 改 import `cressetide/lib/git.mjs`；`core.abbrev` 不中和；重複的旗標取最後一個值；會以 exit 1 表示失敗的 script，用法錯誤也用 exit 1；lib 檔名不可用 `_` 開頭（`.gitignore` 會忽略 `_*.mjs`）。
- **依實機探測定的設計**（見 [probes.md](probes.md)）：
  - hooks.json 用 shell 形式：`node "${CLAUDE_PLUGIN_ROOT}/hooks/<x>.mjs"`
  - 刪掉 `agents[]`，改靠 auto-discovery
  - reviewer 契約用 agent 的 `skills:` 預載，用不加前綴的名稱
  - workflow 的 `agent()` 用 `agentType: 'ctide:<agent>'`
  - SubagentStop 的紀錄放在 `CLAUDE_PLUGIN_DATA`
  - Stop 不能只靠 `background_tasks` 判斷背景工作
- **MCP**：reviewer 改由主執行緒把 MCP 證據放進 packet，刪掉「去改已安裝 plugin 檔」的教學。
- **Doctor**：manifest 和 hook wiring 兩列保留。
- **eval**：案例放在 `cressetide/evals/`。
- **arbiter 大小上限**：27000。

## 偏離計畫的地方（最終報告要揭露）

1. **plan-gate 的 edit 分支保留當備援。** 計畫寫「原生擋得住就拿掉」，但 headless 模式才實測過；文件說互動模式加上 bypass 時不會強制擋，而這個情境沒測到。
2. **`docs/superpowers` 的封存從 P11 提前到 P2 做**，避免留下壞掉的連結。
3. **`archive/v0.7.2-full` 被 `tag.gpgSign` 自動簽章。** 計畫寫的是「不打簽章 tag」；對封存用途沒有影響。
4. **ship 拿掉了「人工挑選 ledger 項目」這一步**，這是 D3 的直接結果；pending 的 JSON 型別從陣列變成物件，屬於 breaking change，P11 要寫進 CHANGELOG。
5. **reconcile 掃到 1 個候選（94f1a31 對 1afe708），判定為 survived**；因為 D3，沒有寫入 close。
6. **第 1 輪之後多了兩次窄範圍複審與修復（R2、R3），P3、P4、P5 之後各加一輪中途 review。** 計畫原本只排 P2、P6、P13 三輪；前者是 arbiter 判 FIX REQUIRED 的修復迴圈，後者是使用者核准的追加（P3、P4：2026-10-14；P5：2026-10-15，I-9）。
7. **D-2 的 structure 計時測試在 P3 提早退役**：validator 改成 in-process 呼叫後，這個測試不再計時（`53b2e18`）。
8. **P4 帶來的、使用者看得到的行為改變**（P11 寫 CHANGELOG 用；使用者 O-5 核准）：
   - 八支 script 改成嚴格解析指令列：不認得的旗標是用法錯誤，`--flag=value` 寫法有效，重複的旗標取最後一個值。
   - contract-check：明確給的 `--base` 無法解析或是空值時回報 `scope: unverified`；以 `-` 開頭的 base 是用法錯誤。
   - map：`--root X` 沒給模式時執行 `create`；HEAD 指向不存在的物件時改成報錯。
   - publish-release：模式和 `--tag` 不限順序；用法錯誤 exit 1。
   - ship：用法錯誤時不跑任何檢查；orphan branch 回報 `unverified`；staged 之後又在工作樹還原的 CHANGELOG 算作有改；子目錄 `--cwd` 用該目錄自己的 CHANGELOG。
   - failure-retrieve：`--log` 是布林旗標；以 `-` 開頭的查詢值要用 `--query=` 寫法。
   - submodule 裡有未追蹤的內容時會被列為變更（D-6）。
9. **P5 帶來的、使用者看得到的行為改變**（P11 寫 CHANGELOG 用；使用者核准的第 35 項）：
   - hooks 從 6 支檔案改成 3 個入口：`pre-tool-use.mjs`（plan gate、破壞性指令、contract 三項檢查）、`session-start.mjs`（failure memory 注入、compaction 提醒）、`orchestration-check.js`（不變）。停用開關（`planGate`、`destructiveGuard`、`contractGuard`、`preserveOnCompact`）名稱不變。
   - PreToolUse 不再接受 `MultiEdit`，也不再接受 camelCase 的事件欄位別名（`permissionMode` 等）；`implementer` agent 的 tools 拿掉 `MultiEdit`。
   - `CTIDE_HOOK_DEBUG` 只認 `1`、`true`、`yes`、`on`（不分大小寫），其他值（含 `0`）一律不寫；寫出前先遮蔽 secret；前綴改成 `[ctide <入口>] <檢查>:`；log 超過 1 MiB 清空重寫。Stop hook 要到 P6 才改用同一套規則。
   - failure memory 認得 `##` 和 `###` 標題（範本的佔位 `###` 不算）；檔案裡沒有 entry 時只注入一行指向該檔的指標，不再塞最多 3000 字原文；空檔、全部退役、只有範本標題時什麼都不注入。
   - SessionStart 收到格式錯誤、不是物件或 BOM 開頭的輸入時不注入任何東西。
   - 移除 Copilot CLI 的支援（hooks.json 的 root fallback、README 與相容性說明）；plugin.json 不再列 `agents[]`，改靠 Claude Code 自動找到 `agents/*.agent.md`。
   - doctor 新增 `decision:plan-gate`、`decision:destructive` 兩列（helper 自動用合成輸入探測，取代原本要手動跑的第 5 步）；`agents` 列只看檔案與 frontmatter 的 `name`；`hook-debug` 列會檢查 Bearer token 有被遮蔽。
   - 退役判斷 regex 改成有上限的共用 parser（failure-retrieve、failure-consolidate、`doctor --project`）；failure-retrieve 的用法錯誤改成明確的「指令列無法解析，沒有搜尋」訊息。
   - lib/git：`GIT_TRACE*`、`GIT_REDIRECT_*` 一律清掉，`GIT_TRACE2*` 設成 0，固定覆寫多了 `core.fsmonitor=false`；ship 的 `tag --merged HEAD` 和 `refs/tags` 查詢只要 stderr 有輸出就回報 `unverified`。

## 已知注意事項

- **測試很慢、容易超時**：原機器有 Trend Micro 即時掃描，全套約 1100 秒。在別台機器上數字會不一樣。
- **ship 的 pending 有兩種 tag 定義**：pending 用 reachable 的 tag，marker 用最高版本的 tag。兩者不同時，報告會把兩個都列出來，這是刻意的。
- **`eval/efficiency/judge-calibration-cases.json`** 還引用 `docs/superpowers`。這個檔案的 SHA 被凍結，不能改，P10 會整個刪掉。
- **本機 `.ctide/` 的 dogfood 資料**（ledger 等）一律不動。

## 使用者的偏好（原機器上記的，另一台不一定有）

- 回覆用繁體中文，口語、少 AI 味，段落要有呼吸空間。
- **改文件之前，先列出編號的改動清單給使用者確認，才動手。** 尤其 README；三語文件以 zh-TW 為準，en 和 ja 從 zh-TW 改寫。P11 的 README 改寫一定要走這個流程。
- 在這個 repo 跑 vigil 時，plan gate 要正式走：EnterPlanMode → ExitPlanMode。對話中口頭同意不算。
- 全域原則：
  - 架構優先。
  - 不疊床架屋，舊的修補要清乾淨。
  - 以前決定好的不准動，順手要改的先提出來。
  - 工具函式只留一份。
  - 完成後逐項比對差異。
- 這次計畫**不改使用者的全域 `~/.claude/FAILURE_MEMORY.md`**。提議的條目列在下面，由使用者自己決定要不要加。

## 提議的 failure memory 條目（尚未寫入，交給使用者決定）

1. **在 Windows Git Bash 用 `node -e '…'` 或 heredoc 帶入 JS 時，會少一層反斜線跳脫。** `\\n` 變成真的換行，`\\(` 變成 `(`，含 regex 的測試被改壞，卻沒有任何錯誤。
   - 預防：含反斜線的改動用 Write/Edit 工具做，或寫成獨立 script 檔再執行；每次用 script 改完都讀回檢查。但 Write 工具也會把 `\uXXXX` 寫成實際字元：validator 不收的字元用 `String.fromCodePoint` 組，寫完做 byte 掃描。Git Bash 裡沒有 heredoc 的 `cat > file` 會等 stdin 卡到逾時；探測指令加 `< /dev/null`。
   - P5c 又發生兩次：餵給 `node -` 的 heredoc 在工具的 bash 層中斷，`node -e` 裡含 `\s`／`\$` 的 regex 取代寫出錯的文字（都被錨點檢查擋下）。用 Write 工具寫成 scratch 檔再 `node <file>` 就沒事。
   - 同一類（P5 I-8）：Git Bash 會把開頭是 `/` 的參數改寫成 Windows 路徑，`claude -p "/compact"` 送到模型的是 `C:/Program Files/Git/compact`。傳 slash 指令或以 `/` 開頭的參數時加 `MSYS_NO_PATHCONV=1`。
   - tags: windows, git-bash, escaping, scripted-edits, tool-write, text-integrity, msys-path-conversion
2. **否定句裡的判決 token 仍然是那個 token。** ship 規定要逐字附上的免責聲明「no READY verdict is implied」裡有 `READY`，plugin 自己的 Stop hook 把它當成宣稱 READY，每個 ship session 都會跳出假警告。對應的測試拿模組自己匯出的常數比對，還在掃描前先把聲明切掉，等於自己驗自己。
   - 預防：要求模型逐字轉述的文字裡，不放機器解析的 token；測試用文件上的字面值，掃描整份輸出不切任何區段；另寫一個端到端測試，把真實的最後訊息餵給真的 hook，並加一個對照組證明 hook 確實會觸發。改寫機器解析 token 的措辭時，要 grep 所有文件、所有語言裡的轉述（例如 README×3），不只逐字引用的那幾處。
   - tags: machine-token, verbatim-disclaimer, hook-false-positive, tautological-oracle
3. **解析 porcelain 指令的輸出時，使用者的 git 設定會改變輸出形狀。** `column.ui=always` 讓 `git tag` 把所有 tag 印成一行，`log.showSignature=true` 在 `git log --format` 前面多印簽章結果，`tag.sort` 改變同版號 tag 的先後。修 M2 時改用 `git tag --merged HEAD`，在預設設定下全綠，卻在這些設定下把原本 `ok` 的結果變成 `no-release-tag`。
   - 預防：程式要解析的 git 輸出，一律明確關掉會改形狀的設定（`--no-column`、`--sort=<key>`、`--no-show-signature`），或改用 plumbing（`for-each-ref`）；測試裡要有一個在敵意設定（`column.ui=always`、`tag.sort=-refname`、`log.showSignature=true`）下跑的案例。會改變輸出「內容」的設定也一樣（`i18n.logOutputEncoding`、`status.showUntrackedFiles`、`diff.ignoreSubmodules`）；在 git 包裝層用明確的 `-c key=value` 集中中和，不要整個隔離使用者設定（會丟掉 `safe.directory`）。反過來也成立：fixture git 密封了，production 卻仍讀使用者設定時，fixture 算出的期望值會對不上（全域 `core.abbrev=12`：`%h` 是 12 碼，`rev-parse --short` 是 7 碼）。會改輸出的設定在 fixture repo 用 repo-local 釘住，敵意設定組要包含 `core.abbrev`。git 包裝層刻意把查詢旗標留給呼叫端時，測試也要帶呼叫端的旗標（例如 `--sort=refname`），否則敵意設定下紅的是測試本身。
   - tags: git-porcelain, user-config, output-parsing, regression-from-fix, hermetic-fixture
4. **「其他一律算未知」的規則，每一種「其他」都要各自有測試；情境檢查不能擋在權威探測前面。** R2-3 的三態 shallow 探測只測了四種非答案中的兩種（回顯旗標、逾時）；把「非零結束」或「空輸出」改回「不是 shallow」的 mutant 93/93 全綠，卻產生 R2-3 要消除的假 `tagReady: pass`。同一次修正為了不在非 git 目錄印出「可能被截斷」，先問 `--is-inside-work-tree` 再問探測，結果 bare shallow clone 和 `<clone>/.git` 裡探測明明答 `true`，「history truncated」也被吃掉（從 2306078 退步）。
   - 預防：規格列舉的每一種輸入（含每一種非答案）各一個測試，斷言使用者看得到的結果，每個分支各跑一個 mutant、分開記錄；先問權威探測，只有它沒答案時才用情境檢查來分類。用 regex 比對整串失敗訊息的負向測試也一樣：新增的訊息可能剛好符合舊 regex，讓舊測試失去鑑別力（P3a 實際發生過）；每個負向測試都要用「停用對應的檢查點」證明會紅。每個修正各自做「只還原這一行」的打紅，並在促成修正的那個條件下跑；整檔還原只要任何一個測試紅就算成立，會高估覆蓋（P4 的 ship.mjs 整檔還原有 18 個測試紅，五個逐行 mutant 卻全綠）。
   - tags: tri-state, unknown-branch, mutation-survivor, guard-ordering, regression-from-fix, oracle-collision, per-fix-revert
5. **把 CI 關卡重構成「讀取器＋回傳清單」時，失敗路徑在兩層都可能悄悄變成通過。** P3 的 `diskReader` 把所有讀取錯誤都當成「不存在」，讀不到的檔案讓 §6／§7 直接放行（舊版會 exit 1）；負向測試全改成 in-process 呼叫之後，把 CLI 改成永遠 exit 0 的 mutant 仍然 77/77 全綠。
   - 預防：只有 `ENOENT`／`ENOTDIR` 算不存在，其他錯誤回報成失敗，測試放一個會丟錯的 reader；薄包裝的每個結束路徑至少留一個端到端測試，用改 exit code 的 mutant 證明會紅。
   - tags: ci-gate, fail-open, error-classification, refactor-regression, exit-path-coverage
6. **`execFileSync` 的 stdin 設成 `"ignore"` 時，`input` 會被丟掉。** P3b 把 ship 的 fast-import fixture 改走共用的 `git()` 之後，fast-import 讀到空的 stdin、exit 0、什麼都沒匯入，沒有任何錯誤。
   - 預防：有 `input` 就用 `"pipe"`；fixture 要斷言結果（例如匯入後的 commit 數），不能只看 exit code。
   - tags: node, child_process, test-fixture, silent-no-op
7. **把 revision 交給會接受 pathspec 的 git 指令時沒加 `--`，工作樹裡同名的檔案會讓指令失敗；呼叫端把失敗當成「沒有變更」，就變成假的通過。** P4 把 `--base` 解析成 SHA 之後，工作樹裡一個以該 SHA 命名的檔案讓 contract-check 印出 `scope: clean`（e0e3dcb 在同一棵樹會正確回報禁止路徑被改動）。
   - 預防：`diff`／`log`／`rev-list` 的 revision 後面一律加 `--`，`rev-parse` 用 `--verify`；使用者明確給的輸入讀取失敗時回報 unverified，不套用預設模式的 fail-open；測試放一個與 revision 同名的檔案（SHA、`HEAD`、tag、`a..b`）。
   - tags: git, argv, pathspec-ambiguity, fail-open, security-fix-incomplete
8. **把 regex「照搬」進共用 parser，可能一起搬進一個沒人量過的 ReDoS。** P5a 被要求保留 FAILURE_MEMORY 的 Tags pattern、只修已知很慢的 `isRetired`（1.4 秒）；實際量了才發現 Tags pattern 是立方級回溯（一行 4 KB 要 6.6 秒），另外兩個結尾修剪的 pattern 是平方級，每次 SessionStart 讀到 clone 下來的 repo 檔案都會碰到。
   - 預防：把讀取不受信任文字的 parsing 搬進共用模組前，每個 regex 都用「相鄰量詞共用的字元」（空白、分隔字元）組成的長字串量一次時間；把有歧義的 pattern 換成等價的線性讀法時，要同時附上跟舊 pattern 的差分測試，以及錄到紅燈／綠燈的計時測試。
   - tags: redos, regex, untrusted-input, refactor-carryover, differential-test
9. **在測試內建立的 temp 目錄存進模組變數，到了下一個測試就是懸空路徑。** P5c 的跨 shell 冒煙把 plugin 副本（第一個測試裡 `tempDir()` 建的）存在模組變數；helper 的 `t.after` 在該測試結束時刪掉它，PowerShell 那個測試就對著已刪除的路徑跑（「Cannot find module …」），第一次紅燈看起來像 PowerShell 的路徑問題。
   - 預防：在測試本體裡用 `tempDir()` 建的 fixture 只活到該測試結束（D-5）；要跨測試共用，就在任何測試本體之外（檔案層級）建立，否則每個測試各建一份。
   - tags: node-test, temp-dir, fixture-lifetime, test-helper

## 這個資料夾的檔案

- [plan.md](plan.md)：已核准的計畫全文
- [contract.md](contract.md)：task contract，24 條 AC，已含 D-1
- [progress.md](progress.md)：逐步進度
- [probes.md](probes.md)：P0 實機探測紀錄，以及 P5 的 I-8 實機冒煙
- [review-round1.md](review-round1.md)：第 1 輪 review 的判決、packet、findings，以及第 1 輪複審（2026-10-14）
- [r2-redgreen.md](r2-redgreen.md)：R2、R3 修復逐項的 red→green 與 mutant 紀錄
- [p3-redgreen.md](p3-redgreen.md)：P3 修復（P3-R1～R8）的 red→green、mutant 與六個結案條件紀錄
- [p4-evidence.md](p4-evidence.md)：P4（P4a／P4b／P4c）的實作證據：S0 基準比對、lib 打紅紀錄、綁定測試與還原打紅、ship／publish-release 的修正
- [p5-evidence.md](p5-evidence.md)：P5（S0／P5a／P5b／P5c）的實作證據：hooks 的 S0 行為比對、guard 與 lib 的打紅紀錄、D-4／D-2 計時、退役的 spawn 測試對照表、I-8 實機冒煙 receipt
