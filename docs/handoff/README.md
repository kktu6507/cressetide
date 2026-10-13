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
| 第 1 輪修復 R1–R7 | 完成，**尚未複審** | `72b01a0` |
| P3 → P13 | 未開始 | — |

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

1. **第 1 輪複審**：針對 `5afc115..72b01a0`，只重跑受影響的 reviewer（intent、test、code），再由 arbiter 判定。arbiter 必須對一件事做出裁定：
   - `plan-gate F1 … dd …` 這個計時測試在修復後的全套測試中跑了 3078 ms，上限是 3000 ms；單獨跑只要 549 ms，baseline 時也失敗過。它和 D-2 屬於同一類，但**不在使用者核准的三個名單裡**。
   - 只能由 arbiter 裁定，或請使用者擴大 D-2；不要自己改門檻。
2. **P3**：validator 合併成 `validate({root, read})`，負向測試改用 overlay reader，不再複製整個 repo；`helpers.mjs` 和 `support.mjs` 合併，只留一個 `makeRepo`，temp 目錄要清掉。
3. **P4**：建立共用模組 `cressetide/lib/`，刪掉 publish-release-core。期限在這一階段的待辦：
   - `git()` 的 1 MiB maxBuffer
   - contract-check 移除 flag 的 CLI 測試
   - Doctor node 列的綁定測試
4. **P5**：重寫 hooks、移除 Copilot、debug 遮蔽 secret、failure memory 支援 `##`／`###`。期限在這一階段的待辦：failure memory 的 `--log` usage 檔要寫進狀態模型。
5. **P6**：SubagentStop 紀錄器加上新的 Stop；要包含一個 ship session 的回歸案例。
6. **P7 → P13**：照計畫做。注意 **P8 第一次改 prose 之前**，要先把被刪掉的 fast-lane 和 test-reviewer QA 輸出的 prose 守衛補回來（拿掉 TP 的部分）。

每個階段的共同要求：`npm run validate`、`npm test`、`npx --yes @anthropic-ai/claude-code@2.1.272 plugin validate --strict ./cressetide` 三項都要綠，用 `git grep` 確認該清的東西零命中，然後 commit。只有 D-2 那三個計時測試例外。

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
   - 預防：要求模型逐字轉述的文字裡，不放機器解析的 token；測試用文件上的字面值，掃描整份輸出不切任何區段；另寫一個端到端測試，把真實的最後訊息餵給真的 hook，並加一個對照組證明 hook 確實會觸發。
   - tags: machine-token, verbatim-disclaimer, hook-false-positive, tautological-oracle

## 這個資料夾的檔案

- [plan.md](plan.md)：已核准的計畫全文
- [contract.md](contract.md)：task contract，24 條 AC，已含 D-1
- [progress.md](progress.md)：逐步進度
- [probes.md](probes.md)：P0 實機探測紀錄
- [review-round1.md](review-round1.md)：第 1 輪 review 的判決、packet、findings
