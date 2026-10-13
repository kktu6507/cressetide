> 已核准的計畫全文（2026-10-13 ExitPlanMode 核准）。原檔在原機器的 `~/.claude/plans/`，複製到這裡供交接用。

# cressetide v0.8 瘦身重構計畫

## Context

2026-10-13 的全 repo 盤點（324 個檔逐一讀完，並對照現行 Claude Code 原生功能）找出三類問題：

1. **把關失效的 bug**
   - Stop hook 只認 `Task`，現在 Claude Code 用的是 `Agent`。
   - failure memory 的「摘要」其實是整段原文直接塞進去。
2. **完全用不到的子系統**：test-provenance（TP）佔 vigil scripts 的 85–90%，但沒有任何出貨入口會呼叫它。
3. **成本偏高**：每跑一次 vigil 都要付不少 context，CI 也很慢。

使用者已做決定，要求所有 bug 都修掉、盤點報告提到的項目全部做完。這份計畫的目標是做出更小、更正確、盡量用原生能力的 **v0.8.0**（breaking release，這次不發布）。

| # | 已核准的決定 |
|---|---|
| D1 | **TP 全部封存移除。** TP 程式、測試、vendor、TP spec 與 review，加上 intent-scan、shared-decision spec 和 9/11 master roadmap，都放進 archive tag 後從 main 刪掉。TP 裡三個有用的觀念寫進 test-reviewer。 |
| D2 | 不支援 Copilot CLI，相關程式全部拿掉。 |
| D3 | **ledger、reconcile、consolidate 整套移除。** ship 的「待出貨」改由 git 推得，並明說這不代表 READY。 |
| D4 | 工具函式改成共用模組 `cressetide/lib/`，不再複製一份再用 hash 守住。 |
| D5 | 保留全域 failure memory，程式改成 `##`、`###` 兩種標題都認。 |
| Q3 | 小實測照做。A/B 也做，花費上限 US$20，到上限就停下來回報。 |
| Q4 | 從最新的 origin/main 開 branch，每個階段驗證過就 commit 一次，不 push。 |

### 上游 9/11 roadmap 的處理

- **拿來用**：B 段 R1–R8 跟這次的 bug 清單重疊，直接沿用它的 AC 細節：
  - 處理 untracked 檔案時不准用 `git add -N`。
  - base 不存在時回報 unverified，不能回 clean。
  - 沒有 ledger 時不能宣稱「沒有待出貨」。
  - Tier 1 沿用 session 的 effort 設定。
- **跟著封存**：其餘段落因 D1–D3 已經不適用，原文保存在 archive tag 裡。

## 設計重點（以下決定已併入計畫，核准時可以提出異議）

- **共用模組 `cressetide/lib/*.mjs`（ESM），每種工具只留一份。**
  - 模組清單：`cli`、`git`、`read-capped`、`redact`、`map-trust`、`settings`、`hook-io`、`debug`、`failure-memory`、`guards/*`、`orchestration`。
  - `cli`：`isMain`，加上 `parseArgs` 的 strict 包裝。每支 script 原本的 exit code 約定不變；unknown flag 在「永遠 exit 0」的 script 裡印 stderr，並回報 no-claim。
  - `git.changedFiles(base)`：tracked、staged、unstaged、untracked（`ls-files -o --exclude-standard -z`）全部取聯集，用 NUL 分隔；不碰 index（不用 `git add -N`）。base 無效、不是 git repo、還沒有 commit 的 HEAD，都回 `unverified`。
  - env 一律寫成字面 `process.env.CTIDE_*`，讓 env 清單檢查抓得到。
- **Hooks 改成 4 個薄 ESM 入口**：`pre-tool-use`、`session-start`、`stop`、`subagent-stop`。
  - 入口只靜態 import node 內建模組。lib 在 try/catch 裡用 `await import()` 載入，失敗就 exit 0（維持 fail-open）。
  - PreToolUse 只起一個 process，三項檢查各自 try/catch。
  - 永遠不輸出 `allow`，交給 Claude Code 自己合併 deny > ask。
  - plan mode 判斷放在最前面。destructive 命中後，任何錯誤都走 ask。
  - matcher：`Edit|Write|NotebookEdit|Bash|PowerShell`。MultiEdit 已經不存在。
- **hooks.json 指令形式：由 P0 實測決定。**
  - 預設用 shell 形式 `node "${CLAUDE_PLUGIN_ROOT}/hooks/x.mjs"`：Claude Code 會先替換變數，舊版 client 也能跑。
  - exec 形式（`args`）在不支援的舊版 client 上會變成光跑 `node`，hook 靜默失效，所以只在 P0 證明 CI pin 跟本機都支援時才採用。
  - hooks.json 不再出現 `COPILOT` / `PLUGIN_ROOT`。
- **SubagentStop 紀錄存放位置**：放 `${CLAUDE_PLUGIN_DATA}`，拿不到就退到 OS temp。
  - 依 session_id 分檔，每檔有大小上限，超過 7 天自動清掉。
  - 不寫進使用者專案。
- **MCP（修正盤點時的建議）**：plugin agent 本身不吃 `mcpServers`，reviewer 的 tools allowlist 也拿不到 MCP 工具，所以改成：
  - 由主執行緒收集 MCP 證據，放進 Review Packet 交給 reviewer。
  - 刪掉 `cressetide/.mcp.json`、`mcp.example.json`、agent 檔裡註解掉的 `mcp__` 行，以及「去改已安裝 plugin 檔案」的教學。
  - 文件寫明 plugin 自帶 server 的前綴是 `mcp__plugin_<plugin>_<server>__*`，使用者自己設定的 server 是 `mcp__<server>__*`。
- **Doctor**：
  - manifest 和 hook wiring 這兩列保留，它們是 runtime probe 的信任閘門。
  - 只刪和 `claude plugin validate --strict` 重複的 skills、agents「存在與否」檢查，以及寫死的 telemetry 列、`--plugin-root`。
- **plugin eval 案例放在 `cressetide/evals/`**（plugin eval 規定案例要在 plugin 底下），會隨 plugin 出貨。都是小型文字檔，可以接受；`results/` 加進 gitignore。
- **reviewer 共用契約改成內部 skill**：新增 `skills/reviewer-contract`（`user-invocable: false`），用 `skills:` 預載。validator 和 doctor 的 skill 清單拆成 public 5 個、internal 1 個。
- **Failure memory 標題層級逐檔判斷**：檔案裡有 `###` 就以 `###` 當 entry（範本是把 entry 放在 `##` 段落底下），沒有才用 `##`。
- **Debug 開關**：只有 `1|true|yes|on`（不分大小寫）算開啟，跟 `CTIDE_ENFORCE_STOP` 同一套規則。log 寫出前先過 `redact`。
- **Logo**：縮到 480px（240px 顯示的兩倍，HiDPI 用），去掉 metadata。
- **Node 下限**：`>=22.12`。CI 的 plugin validate pin 從 2.1.207 升到本機實測過的 2.1.272。
- **封存的文件**：連結一律用 tag permalink。注意：**之後 push 時要先 push `archive/v0.7.2-full` tag**，不然 link-check 會失敗。

## 階段

### 每個階段共通的做法

- **驗證三項全綠**：
  - `npm run validate`
  - `npm test`
  - `npx --yes @anthropic-ai/claude-code@2.1.272 plugin validate --strict ./cressetide`
- **清理檢查**：`git grep` 確認該階段移除的名稱已經零命中（CHANGELOG 的歷史條目除外）。
- **commit**：驗證通過才 commit 一次。
- **實作分工**：每個階段派一個 implementer subagent 做。
- **輸出規則**：測試輸出不經過 `| tail`，exit code 直接讀。

### P0：基線、實測、archive tag（不改產品）

1. **更新 main**：`git merge --ff-only origin/main`。
2. **打 tag 開 branch**：
   - 打 annotated tag `archive/v0.7.2-full`（本機）。
   - 開 branch `refactor/v0.8-slim`。
3. **前景跑測試基線**，期間不同時派其他 agent：
   - 輸出存成 `.ctide/output/baseline-before.txt`。
   - 記錄測試數量和耗時。
   - 量測 vigil 中風險 run 會強制載入的 reference 位元組數。
4. **實測**：用一次性的 scratch consumer repo（路徑含空白），以 `claude -p --plugin-dir` 搭配便宜的 model 跑，預算約 US$2–5。

   | 編號 | 要確認的事 | 不成立時的退路 |
   |---|---|---|
   | P0-1 | hook shell 形式與 exec 形式，在 Windows（Git Bash 和 PowerShell）、CI pin、本機上各自能不能跑 | 擇一使用 |
   | P0-2 | SubagentStop 對前景 subagent、背景 subagent、Workflow `agent()` 會不會觸發，欄位是什麼 | Workflow 的完成狀態在報告裡標成「無法驗證」 |
   | P0-3 | `skills:` 預載的名稱要寫 `reviewer-contract` 還是 `ctide:reviewer-contract` | 保留在 packet 裡逐字貼上 |
   | P0-4 | 拿掉 `agents[]` 後，`/agents` 還能不能列出 11 個 `ctide:` agent | 保留 `agents[]`，並改寫成非 Copilot 用途的理由 |
   | P0-5 | plugin `workflows/` 會不會被找到、能不能拿到 `args` | 不出 workflow |
   | P0-6 | 原生 plan mode 不靠 plan-gate 擋不擋得住 Edit | — |
   | P0-7 | agent 內文裡的 `${CLAUDE_PLUGIN_ROOT}` 會不會展開 | 改由 packet 交付 |

5. **紀錄**：結果和 CLI 版本寫進 `docs/compatibility.md`。

### P1：Node 下限與測試入口

- **改動**：
  - `package.json`：`engines >=22.12`，`"test": "node --test \"test/**/*.test.mjs\""`。這樣 runtime script 不會再被當成測試檔跑。
  - `validate.yml` 改用 Node 22。glob 寫法需要 Node 21 以上，所以必須在同一個 commit 一起改。
  - Doctor 的版本檢查改成 semver。
  - README×3、tutorial（順便修「少了 Node 會失去一半護欄」這句）、compatibility、ARCHITECTURE、diagnostic-contract 同步更新。

### P2：一起移除 TP 和 ledger（兩者互相 import，必須同時刪）

- **刪除**：
  - 34 支 TP script、`vendor/`、`eval/loop-e2e/`、vendored-parser ADR、`test/fixtures/`
  - 31 個 TP 測試檔
  - run-ledger、reconcile、consolidate 三支 script 和它們的測試
  - `run-ledger.md`、`retro-practice.md`
  - `docs/superpowers` 底下的 TP 檔、intent-scan、shared-decision、9/11 roadmap
- **contract-check**：拿掉 `--provenance`、`--inventory`、`--task`。
- **測試同步**：
  - workflow-contracts：刪 D11 區塊和兩個 TP import。
  - validate-structure.test：刪碰到 TP 或 ledger 的 9d 案例。
  - release-cli：刪 vendored-member 測試。
- **Prose**：
  - SKILL：第 2、3 步（scan 和 close）、4b、第 9 步（ledger），以及 110／174／178／192／197 行的 TP 子句。
  - arbiter：刪 TP gate。
  - test-reviewer：刪 TP 段，改寫成三條審查規則：
    - 規格沒寫的不斷言。
    - 斷言不能超出來源範圍。
    - 要找多出來的斷言，不只找漏掉的。

    另外加上 test→source traceability；implementer 和 verification-gate 各補一行。
  - review-packet、reviewer-selection 刪掉 TP 段落。evidence-substitution fast lane 保留，改成不提 TP 的說法。
  - final-report 刪 `Ledger:`（34／98／167 行）；plan-grounding 刪 33、65 行。
  - navigator：刪交付項 6 和 dispositions。
- **Doctor**：刪 ledger-health；facts 改成 `doctor.project.checks = failure-memory-health, incident-journals`。
- **Ship**：`pending` 改成「上一個 `vX.Y.Z` tag 之後的 commit 和變更檔」，標明這不是 readiness claim。沒有 tag、shallow clone、狀態無法判斷這三種情況，都直接揭露，不回傳空清單。
- **文件**：runtime-contract、SECURITY、ARCHITECTURE、CONTRIBUTING、command-reference、how-to-read-verdicts、benchmark-contract、README×3、`flow_overview.svg` 和它的 alt text、typos.toml。三語 README 的 `##` 段落數要一致。
- **▶ Review 第 1 輪**：intent、test、code、architecture，加上 arbiter。

### P3：Validator 重整與測試共用工具

- **Validator**：
  - core 和 extensions 合併成一個模組 `validate({root, read})`，CLI 只是一層薄包裝。
  - 統一 root 的解析方式：現在一邊用 cwd，一邊用 `import.meta`。
  - 負向測試改用 overlay reader，不再每個 case 複製整個 repo（目前約 92 次）。現有的每個負向案例都要 1:1 移植。
  - 刪掉 `structure.test.mjs` 裡重複的檢查，只留 `ctide@kktu` 那條並移進 validator。
- **測試共用工具**：
  - `helpers.mjs` 和 `support.mjs` 合成一份。
  - 只留一個 `makeRepo`（內建 `hardenGitSigning`、git 設定走 env）和一個會自動清理的 temp helper，用 `t.after` 收尾。

### P4：給 script 用的共用 lib，刪掉 release 死碼

- **`lib/` 先上這幾個模組**：`cli`、`read-capped`、`redact`（合併 doctor 和 publish-release 的兩份）、`map-trust`、`git`。
- **改用 lib 的 script**：map、ship、doctor、contract-check、pack-review-diff、regression-delta、failure-*、`.github/scripts/publish-release.mjs`。
- **刪除**：
  - garden 9d 的 d4／d5 和對應測試。
  - 每個 script 的 `KNOWN_FLAGS` 加 `get()`，以及它們的 flag 矩陣測試。
- **publish-release-core**：`normalizeGzipOsByte` 併進 `publish-release.mjs`，其餘刪掉，`release-publisher.test.mjs` 也刪。
- **release-cli 測試**：補一條斷言，確認 release archive 有包含 `lib/`。
- **CODEOWNERS**：加 `/cressetide/lib/`、`/cressetide/workflows/`。

### P5：Hooks 重寫與移除 Copilot

- **新入口**：`pre-tool-use.mjs`、`session-start.mjs`。hooks.json 的指令形式依 P0-1 結果決定。
- **檢查邏輯搬到 `lib/guards/*`**：
  - plan-gate：依 P0-6 結果，原生 plan mode 擋得住就拿掉 edit 分支，只留 Bash tripwire。
  - destructive、contract 搬過去，語意不變。
- **Copilot**：刪 camelCase alias、`hooks-portability.test.mjs`、README×3 的 Copilot 段、compatibility、diagnostic-contract 的 root fallback 說明。`agents[]` 依 P0-4 結果決定刪不刪；validator 改成看檔案系統和 frontmatter roster。
- **Debug**：
  - 改用 `lib/debug`。
  - `hooks.test` 原本鎖住「log 裡出現明文 Bearer」，改成驗證已被遮蔽。
  - facts block、runtime-contract、workflow-contracts:231-237 同步修改。
- **Failure memory**：hook、retrieve、consolidate 共用同一個 parser。
  - 沒有 entry 時，只注入「去讀這個檔」的指標，開頭說明改成跟實際行為一致。
  - failure-retrieve 的 `--log` 會吃掉下一個參數：用 `parseArgs` 修掉。
  - verification-gate 兩處 `--log` 寫法統一。
- **validator 與 doctor**：
  - 刪 9d d1／d2。
  - hook 解析支援新形式。
  - doctor 期待的 hook 清單改成新的。
  - 兩個 deny／ask 決策探測搬進 `doctor.mjs`，所有探測都用 `probeEnv`。
  - 升 CI pin。
  - README×3 的 hook 名稱同步。
- **compact-fidelity**：併進 `session-start`，依 `source` 分流。
- **測試**：
  - 每項檢查都有 in-process 單元測試，ReDoS 計時也在 process 內跑，不另起 node。
  - spawn 冒煙涵蓋三種情況：lib 不存在、stdin 只有 `{`、stdin 超過 5MB。

### P6：SubagentStop 紀錄器與 Stop

- **`subagent-stop.mjs`**（matcher `^ctide:`）：記錄 `{session_id, agent_id, agent_type, verdict token, ts}`。id 先清理過，檔案有大小上限，會自動清除舊紀錄。
- **`stop.mjs`**：
  - 先看 `last_assistant_message`。沒有 READY、`ctide:` 或 ship 字樣就直接結束，**不讀 transcript**。
  - 有字樣才讀這個 session 的紀錄和 `background_tasks`。
  - 背景工作還在跑時，不提 panel 或 verdict，最多一行「完成狀態尚無法觀察」。
  - resume 時以最新的 arbiter 紀錄為準。
  - 看不懂的格式只回一則「無法驗證」，不指控 panel 沒跑。
  - enforce 模式的語意不變。
- **測試**：用真實的 input 形式重寫 orchestration-check 測試和 documented-facts 的 `classifyStop`。
- **▶ Review 第 2 輪**：intent、test、code、security、architecture、operability，加上 arbiter。

### P7：script 正確性

- **untracked 與 scope**：
  - contract-check 改用 `changedFiles`，抓得到禁止路徑裡的 untracked 檔。無法判斷時回 `scope: unverified`。
  - packet 的作法和 pack-review-diff（新增 `--base` 模式）會帶上 untracked 檔：有上限、已遮蔽 secret；內容沒附上時明確標出缺口。
- **regression-delta**：新增 `missing`，指「之前通過、之後不見」的測試。只要 missing 不是空的，就不會輸出 no regression。verification-gate 和 arbiter 對這點的說法統一。
- **Map**：
  - 檔案清單改用 `git ls-files -co --exclude-standard`。
  - 新鮮度看各段落引用來源的指紋；commit 和工作樹的漂移只當參考資訊。
  - 支撐不了該段結論的引用標成 UNVERIFIED，並修掉會誤判的 regex。
  - 原本 ship 和 map 的兩項檢查互相衝突，一起解掉。
  - eval case `map-stale-source` 同步修改。
- **Doctor**：刪 telemetry 那一列和 `--plugin-root`（doctor-security.test、SKILL、command-reference 一起改），skills、agents 的存在檢查交給 plugin validate。
- **examples**：
  - 三份 incident schema 合成一份，以 reentry-and-closure 為準。
  - `examples/settings.json` 跟 `cressetide/examples/settings.json` 一模一樣，刪掉根目錄那份。
  - gatekeeper、fork_context 這類舊名稱一起修。
- **cartographer 和 Explore 說法矛盾**：以 cartographer 為準，修改 operational-readiness:59。

### P8：vigil 與 agent 的 prose、減少 context

- **reviewer 共用契約**：
  - 新增 `skills/reviewer-contract`，7 個 reviewer 用 `skills:` 預載（依 P0-3）。
  - 刪掉 `reviewer-common.md`、packet 裡逐字貼上的段落、validator 雙寫 guard（core:403-460）；`CONTRACT_INVARIANTS` 改指向新位置。
- **effort**：
  - 刪掉 arbiter:155、security:15、deep-mode:14、:42 的「最大推理強度」。
  - 只有 Tier 2 才在派工時傳 effort。
  - 拿掉 ultracode 訊號。
- **刪除的 reference**：
  - 兩份 map overlay。Map 規則併進 SKILL 和 navigator 各一句；navigator、cartographer 的引用依 P0-7 改用可達的方式。
  - `manual-invocation.md`：`--shallow` 併進 SKILL。
  - EXPERIENCE 功能整個拿掉：`experience-memory.md`，以及 decision-record 裡約 15 處引用。
- **拆成需要時才讀**：
  - final-report 的 full 模板（compact 那段 5d 圍欄保留）。
  - verification-gate 的 legacy 遷移段（98-108）。
  - external-capabilities 的 MCP 和 Codex 段。
- **其他精簡**：
  - map 的 `system-map-contract.md` 併回 SKILL。
  - salvage 要讀的 operational-readiness，只留戰時需要的部分。
  - test-reviewer、navigator 的 description 各 ≤ 250 字，拿掉 TP 和 D11 術語。
- **MCP**：依「設計重點」那節處理。

### P9：Tier-1 workflow

- **新增 `cressetide/workflows/vigil-review.js`**：
  - `meta` 寫成純字面值。
  - packet 由 `args` 傳入。
  - reviewer 用 `agent({agentType:'ctide:…', schema})` 平行跑，再交給 arbiter。
  - Tier 2 才另外傳 effort。
- **deep-mode.md** 改成指向這個 workflow。
- **測試**：ESM 語法檢查加 schema 對位；實際能不能跑交給 P0-5 和 P12 的實測確認。

### P10：Eval

- **刪除**：`eval/efficiency/` 和它的 3 支測試、`check-model-provenance` 和它的測試、`run-eval.mjs`，以及 `package.json`、validate.yml、release.yml 裡的 eval 步驟。
- **改寫成 `cressetide/evals/<id>/{prompt.md,graders/*.md}`**，原本的資料都轉進來：
  - `eval/cases`：用 regex grader 檢查必要詞和禁用詞。禁用詞要寫成肯定句式，避免文字否定時誤判。
  - reviewer-drift fixtures：用 llm grader 判斷有沒有命中、乾淨的案例有沒有誤報。
  - `manifest.yaml`、`fixture-eval.workflow.js`、eval-manifest 測試一起刪掉。
- **搬移**：`eval/failure-memory` 移到 `test/fixtures/`。
- **封存**：`eval/baseline.md`。
- **gitignore**：`cressetide/evals/results/`。

### P11：CI、logo、文件收斂、版本

- **CI**：
  - 加一個 `changes` job，其他 job 用 job 層的 `if:` 決定要不要跑。跳過的 job 仍算通過 required check，只改文件的 PR 也能拿到 7 個 required context。
  - 只改文件時只跑 ubuntu 的快速 job。
  - zizmor 照同樣方式處理。
  - 清掉過時的註解：zizmor.yml、typos.yml、validator 開頭、validate.yml 的 Windows timeout 說明。
- **Logo**：縮到 480px，總大小 ≤ 300KB。
- **docs/superpowers**：剩下的效率相關文件全部封存。
  - 新寫 `docs/history.md`：決策摘要、archive tag 位置、效率實驗的結論。
  - `efficiency-measurement.md` 併進去。
  - EVIDENCE:79、benchmark-contract 的連結改成 tag permalink。
- **runtime-contract 成為唯一出處**：settings key、env、hooks、flags、sentinel、`.ctide` 目錄樹都只寫在這裡。README 和 ARCHITECTURE 各留一行摘要加連結。
- **修掉盤點列出的過時描述**：
  - runtime-contract 對 contract-guard 和 compact-fidelity 的描述。
  - compatibility 裡指向不存在的 `test/conformance`，以及寫死的版本號。
  - EVIDENCE 的「15 項檢查」。
  - judge calibration「尚未執行」的描述（跟著封存）。
  - CONTRIBUTING 的「a arbiter」，並在 README Docs 加上 CONTRIBUTING 的連結。
  - efficiency-measurement 的空白錯字（跟著併入 history）。
  - 刪除舊專案留下的 `.ctide/ledger`、`provenance.json`、`test-provenance-loop/`、`EXPERIENCE.md` 時，寫一份遷移說明。
- **README×3**：照你的偏好，先列出 zh-TW 為準的編號改動清單，你確認後才動手，en 和 ja 再依 zh-TW 改寫。
- **版本**：CHANGELOG 加 `[0.8.0]`，標出 breaking 項目；plugin.json 和 package.json 改成 0.8.0。

### P12：實機驗證與 A/B

- **Host smoke**：用 branch 上的 plugin，在 scratch consumer repo 跑：
  - plan 模式下擋 Edit 和 Bash 寫入。
  - destructive 指令會 ask，無害指令放行。
  - contract 被削弱時會 ask。
  - failure memory：`##`、`###`、全域那一層三種情況。
  - compaction 後會提醒。
  - Stop：前景和背景 reviewer 都要測；READY 不誤報；NOT READY 加 shipped 在 enforce 模式下會 block。
  - Doctor：預設模式和 `--project`。
  - Map：write、commit、verify。
  - Ship：tag 之後的 commit。
  - `/agents` 列出 11 個 agent。
  - vigil-review workflow 實際跑一次。
- **plugin eval 冒煙**：`--runs 1 --max-cost-usd 3`。
- **A/B**：
  - 3 個小型合成任務 × 兩組，每組各跑一次，固定 model 和 effort。
    - A 組：停用 ctide，用原生 plan mode 加 `/code-review`。
    - B 組：`/ctide:vigil`。
  - 用隱藏檢查評分，記錄成本和時間。
  - 累計到 US$20 就停下來回報。
  - 結果寫進 `docs/history.md`。

### P13：正式 review 與交付

- **▶ Review 第 3 輪**：用新的 `vigil-review` workflow 跑，順便 dogfood；核准這份計畫即視為同意使用 Workflow。成員：intent、test、code、security、architecture、operability，加上 arbiter。
- **收尾**：
  - 用 regression-delta 比對 baseline：刪掉的測試只能出現在 missing，不准出現 green→red。
  - 跑 `contract-check --base <P0 sha>`。
  - 輸出 final report 和三個 sentinel。

## 驗收條件

1. 每個 phase 的 commit 都讓三項驗證全綠：validate、test、plugin validate（升級後的 pin）。
2. `git grep` 找 TP、ledger、Copilot、EXPERIENCE 的識別字，除了 CHANGELOG 舊條目和 `history.md`，全部零命中；archive tag 解得到，內容包含所有被移除的檔案。
3. test-reviewer 和 verification-gate 含有三條審查規則和 test→source traceability。
4. `npm test` 只跑 `test/**/*.test.mjs`。
5. hook 入口在三種情況下都 exit 0：lib 不存在、stdin 格式錯、stdin 超過 5MB。輸出永遠不含 `permissionDecision:"allow"`。hooks.json 不含 `COPILOT` 或 `PLUGIN_ROOT`。
6. debug log 不出現明文 `Bearer <token>`，`CTIDE_HOOK_DEBUG=0` 時不寫 log。
7. Stop／SubagentStop 涵蓋下列情境：
   - 以 `Agent` 派出、READY、panel 齊全
   - NOT READY 加 shipped，enforce 模式下 block
   - 背景工作還在跑
   - resume 時以最新的為準
   - 引述在 prose 裡的 verdict 不算數

   而且都不讀 `transcript_path`；這些情境在 P12 實機上都觀察到。
8. 用 `##` 寫 entry 和用 `###` 寫 entry 的檔案，都注入「標題＋tags」；沒有 entry 時只注入指標；retrieve 和 consolidate 也都認得。
9. 共用 lib：`isInvokedDirectly`、parser、遮蔽 regex 鏈、`OPS_TRUST_TAG`、git wrapper、debug、stdin reader 全部只在 `lib/` 出現一次，9d guard 已移除。每個 script 都有綁定測試，證明接到的是正確的 lib 函式，不只是有沒有呼叫。
10. contract-check 能抓到禁止路徑裡的 untracked 新檔；base 無效時回報 unverified。
11. regression-delta 把消失的測試列為 missing。
12. Map：write、commit、verify 之後狀態是 fresh；改到被引用的檔案時，只有那一段變 stale；gitignore 的檔案不出現。
13. Ship：在 tag 之後新增一個非 vigil 的 commit，它會出現在 pending 裡，而且不宣稱 READY。
14. Doctor（headless）有 deny／ask 決策列，探測過程中沒有模型自組的 shell；所有探測都用 `probeEnv`；沒有 telemetry 列，也沒有 `--plugin-root`。
15. MCP 文件前綴正確，不再教使用者改已安裝 plugin 的檔案，reviewer 改由 packet 拿到 MCP 證據。
16. 實測 `/agents` 列出 11 個 `ctide:` agent；reviewer 確實收到預載的契約，不行時有寫明的退路。
17. vigil 中風險 run 強制載入的 reference 位元組數比 P0 基線少 40% 以上；拿掉「最大推理強度」的 prose；test-reviewer 和 navigator 的 description 各 ≤ 250 字。
18. workflow 檔存在，deep-mode 有用到它，P12 實際跑過一次。
19. eval：`efficiency` 和 `model-provenance` 已刪；`claude plugin eval` 冒煙成功；CI 不再跑 eval。
20. validator 負向測試不再複製整個 repo；跑完測試後 temp 目錄沒有殘留（前後數量比對）；只改文件的 PR 拿得到 7 個 required context；報告附上 Windows 全套測試時間的前後對照。
21. 死碼移除：publish-release-core、s3、examples 重複的部分都已刪掉。
22. 文件：runtime-contract 是唯一出處；三語 README parity 通過；過時描述清單都修完；有 `history.md`；CHANGELOG 和版本是 0.8.0；有遷移說明。
23. Logo 總大小 ≤ 300KB。
24. P0 實測、P12 smoke、A/B 都有紀錄並附上 CLI 版本；A/B 花費 ≤ US$20。

## 驗證方式

- **每個 phase**：三項驗證，加上 `git grep` 零命中檢查。
- **P0 和 P12**：用 `claude -p --plugin-dir` 跑實機，保留 receipt。
- **最後**：前景跑一次 `baseline-after`，再跑 regression-delta 和 contract-check。

## Review 與成本

- **風險**：高。hook 會在每個使用者的每個 session 執行，加上 secret 遮蔽、CI、release，以及大量刪除。
- **Review**：共 3 輪，分別在 P2、P6、P13 之後；ui-ux reviewer 不需要。
- **成本等級**：default。第 1、2 輪不用 Workflow，改用平行 Agent，並在報告裡揭露；第 3 輪用新的 workflow。
- **實機費用**：實測約 US$5，加 eval 冒煙 ≤ US$3，加 A/B ≤ US$20。

## Reconcile 處置

scan 標出 1 個候選：94f1a31 對 1afe708。兩者是不同面向的問題，判定為 survived。

D3 要移除整個 ledger，所以這筆不寫 close，本機的 `.ctide/ledger` 也不動，最後在報告裡揭露。

## 風險與退路

- **抽出共用模組可能帶進新的錯誤**：每個 script 都要有綁定測試；hook 入口的 lib 載入失敗一律 fail-open，並做 revert-to-red 驗證。
- **文件說法要有程式碼根據**：任何「工具會／不會做 X」的寫法，都先對照程式碼確認。
- **回滾**：每個 phase 一個 commit，可以單獨 revert。archive tag 保有全部舊內容。
- **這次不做**：
  - 不 push、不打簽章 tag、不發布。
  - 不改你全域記憶檔的內容。
  - 不刪本機 `.ctide/` 的 dogfood 資料。
