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
| P3 validator 合併、overlay 負向測試、測試共用工具（含使用者追加項目） | 完成，**待中途 review** | `53b2e18` |
| P4 → P13 | 未開始 | — |

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

1. **第 1 輪已結案（READY，2026-10-14）**：複審 2 的 R3 修復在 `64c2564` 完成，arbiter 列的四個「只憑證據結案」條件都逐條核對成立，見 [review-round1.md](review-round1.md) 的「Round-1 closure」和 [r2-redgreen.md](r2-redgreen.md) 的 R3 一節。下一步是 P3。
2. **P3**：validator 合併成 `validate({root, read})`，負向測試改用 overlay reader，不再複製整個 repo；`helpers.mjs` 和 `support.mjs` 合併，只留一個 `makeRepo`，temp 目錄要清掉。另外兩項要求：
   - **temp helper 要涵蓋所有沒清理的測試檔**：`ship.test.mjs`、`contract-check.test.mjs`、`support.mjs`、`helpers.mjs` 等所有 `mkdtempSync` 都改走同一個會自動清理的 helper（`t.after`），並用全套 `npm test` 前後的 `ctide-*` 目錄數量比對來證明（AC-20）。
   - **validator 只掃追蹤中、未被忽略的檔案**（使用者 2026-10-14 核准）：scratch 檔與文字完整性檢查改用 `git ls-files -co --exclude-standard`，本機 gitignored 的 `.ctide/collaboration/` dogfood 資料才不會讓 `npm run validate` 失敗。最終報告列為核准的順手修正。
   - **測試用的 git 要密封**（複審 2）：fixture 裡的 git 不受開發者全域設定影響，例如 `merge.verifySignatures=true` 會讓 `ship.test.mjs` 的 merge fixture 假紅（新舊測試都有）。用一個集中的 fixture-git helper 處理，不要逐個測試補旗標。
   - **SSH 簽章測試的 skip 要看能力**（複審 2）：除了 `ssh-keygen` 能不能啟動，git < 2.34 或 OpenSSH < 8.1 也要說明原因後 skip，不能直接紅燈。
3. **P4**：建立共用模組 `cressetide/lib/`，刪掉 publish-release-core。期限在這一階段的待辦：
   - `git()` 的 1 MiB maxBuffer
   - contract-check 移除 flag 的 CLI 測試
   - Doctor node 列的綁定測試
4. **P5**：重寫 hooks、移除 Copilot、debug 遮蔽 secret、failure memory 支援 `##`／`###`。期限在這一階段的待辦：
   - failure memory 的 `--log` usage 檔要寫進狀態模型。
   - **D-4 的硬性要求**：plan-gate 的 4 個 F1 計時測試（sed / perl / git apply / dd）改成 in-process 量 classifier 時間（例如 `< 250 ms`），並在 scratch 副本拿掉 `{0,200}` 上限時錄到紅燈；做不到紅燈就不算完成。
5. **P6**：SubagentStop 紀錄器加上新的 Stop；要包含一個 ship session 的回歸案例。這個案例的 commit subject 要含 `READY`、`major`、`minor`，報告裡也要有否定句「never means 'safe to ship'」，新的 Stop 都必須保持安靜（第 1 輪複審 F-k）。
6. **P7 → P13**：照計畫做。注意 **P8 第一次改 prose 之前**，要先把被刪掉的 fast-lane 和 test-reviewer QA 輸出的 prose 守衛補回來（拿掉 TP 的部分）。同一個期限內，還要替低／中風險 run 定義實作階段可引用的 edge 來源（第 1 輪複審 F-l）。
   - **P4** 另外要處理：`counted.status` 的 fault-injection 測試，並把 `rev-list --count` 改成嚴格解析 `/^\d+$/`（F-j）；ship 搬到 `lib/git` 時，逐一檢查 code-reviewer 留下的四條線索（resolveMarker 讀 tag 清單失敗、tagReady 的 rev-parse 失敗、子目錄 `--cwd` 的 changelogTouched、HEAD 損壞被標成 `no-release-tag`）。
   - **P4 的 lib/git 要集中中和使用者 git 設定**（複審 2）：用明確的 `-c key=value` 覆寫，包括 `i18n.logOutputEncoding`，並補一個非 ASCII commit 標題的測試。**不要**用 `GIT_CONFIG_GLOBAL`／`NOSYSTEM` 整個隔離，否則會丟掉 `safe.directory`，遇到「dubious ownership」的 repo 每次讀取都會失敗。
   - **P4 計畫核准時請使用者決定**：要不要用 `--ignore-submodules=none` 覆寫 `diff.ignoreSubmodules`。不覆寫的話，submodule 被移動時 tagReady 可能誤判 `pass`，pending 也會漏列 gitlink；覆寫的話，連專案自己在 `.gitmodules` 設的 `ignore` 也會被蓋掉。
   - **P11** 改 README 時：`ship.test.mjs` 的 README 測試只讀每個標題下的第一行，段落重新換行時要一起檢查。

每個階段的共同要求：`npm run validate`、`npm test`、`npx --yes @anthropic-ai/claude-code@2.1.272 plugin validate --strict ./cressetide` 三項都要綠，用 `git grep` 確認該清的東西零命中，然後 commit。只有 D-2 那三個、D-4 那四個計時測試例外。在這台機器上，因為本機有 `.ctide/collaboration/` dogfood 資料，P3 修好 validator 之前，三項驗證都要在乾淨的 detached worktree 裡跑。每個階段結束時，順手清掉多餘的檔案（scratch 副本、用完的 worktree、測試漏掉的 `ctide-*` 暫存目錄）。

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
6. **第 1 輪之後多了兩次窄範圍複審與修復（R2、R3），P3 之後再加一輪中途 review。** 計畫原本只排 P2、P6、P13 三輪；前者是 arbiter 判 FIX REQUIRED 的修復迴圈，後者是使用者 2026-10-14 核准的追加。
7. **D-2 的 structure 計時測試在 P3 提早退役**：validator 改成 in-process 呼叫後，這個測試不再計時（`53b2e18`）。

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
   - 預防：含反斜線的改動用 Write/Edit 工具做，或寫成獨立 script 檔再執行；每次用 script 改完都讀回檢查。
   - tags: windows, git-bash, escaping, scripted-edits
2. **否定句裡的判決 token 仍然是那個 token。** ship 規定要逐字附上的免責聲明「no READY verdict is implied」裡有 `READY`，plugin 自己的 Stop hook 把它當成宣稱 READY，每個 ship session 都會跳出假警告。對應的測試拿模組自己匯出的常數比對，還在掃描前先把聲明切掉，等於自己驗自己。
   - 預防：要求模型逐字轉述的文字裡，不放機器解析的 token；測試用文件上的字面值，掃描整份輸出不切任何區段；另寫一個端到端測試，把真實的最後訊息餵給真的 hook，並加一個對照組證明 hook 確實會觸發。改寫機器解析 token 的措辭時，要 grep 所有文件、所有語言裡的轉述（例如 README×3），不只逐字引用的那幾處。
   - tags: machine-token, verbatim-disclaimer, hook-false-positive, tautological-oracle
3. **解析 porcelain 指令的輸出時，使用者的 git 設定會改變輸出形狀。** `column.ui=always` 讓 `git tag` 把所有 tag 印成一行，`log.showSignature=true` 在 `git log --format` 前面多印簽章結果，`tag.sort` 改變同版號 tag 的先後。修 M2 時改用 `git tag --merged HEAD`，在預設設定下全綠，卻在這些設定下把原本 `ok` 的結果變成 `no-release-tag`。
   - 預防：程式要解析的 git 輸出，一律明確關掉會改形狀的設定（`--no-column`、`--sort=<key>`、`--no-show-signature`），或改用 plumbing（`for-each-ref`）；測試裡要有一個在敵意設定（`column.ui=always`、`tag.sort=-refname`、`log.showSignature=true`）下跑的案例。會改變輸出「內容」的設定也一樣（`i18n.logOutputEncoding`、`status.showUntrackedFiles`、`diff.ignoreSubmodules`）；在 git 包裝層用明確的 `-c key=value` 集中中和，不要整個隔離使用者設定（會丟掉 `safe.directory`）。
   - tags: git-porcelain, user-config, output-parsing, regression-from-fix
4. **「其他一律算未知」的規則，每一種「其他」都要各自有測試；情境檢查不能擋在權威探測前面。** R2-3 的三態 shallow 探測只測了四種非答案中的兩種（回顯旗標、逾時）；把「非零結束」或「空輸出」改回「不是 shallow」的 mutant 93/93 全綠，卻產生 R2-3 要消除的假 `tagReady: pass`。同一次修正為了不在非 git 目錄印出「可能被截斷」，先問 `--is-inside-work-tree` 再問探測，結果 bare shallow clone 和 `<clone>/.git` 裡探測明明答 `true`，「history truncated」也被吃掉（從 2306078 退步）。
   - 預防：規格列舉的每一種輸入（含每一種非答案）各一個測試，斷言使用者看得到的結果，每個分支各跑一個 mutant、分開記錄；先問權威探測，只有它沒答案時才用情境檢查來分類。
   - tags: tri-state, unknown-branch, mutation-survivor, guard-ordering, regression-from-fix

## 這個資料夾的檔案

- [plan.md](plan.md)：已核准的計畫全文
- [contract.md](contract.md)：task contract，24 條 AC，已含 D-1
- [progress.md](progress.md)：逐步進度
- [probes.md](probes.md)：P0 實機探測紀錄
- [review-round1.md](review-round1.md)：第 1 輪 review 的判決、packet、findings，以及第 1 輪複審（2026-10-14）
- [r2-redgreen.md](r2-redgreen.md)：R2 修復逐項的 red→green 與 mutant 紀錄
