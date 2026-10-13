> Task contract（high-risk，24 條 AC）。原檔是 gitignored 的 `.ctide/output/contract.md`；接手時請複製回去：`cp docs/handoff/contract.md .ctide/output/contract.md`。

# Task contract — cressetide v0.8 瘦身重構（plan: docs/handoff/plan.md）

```json
{
  "ctideContract": 1,
  "risk": "high",
  "acceptanceCriteria": [
    { "id": "AC-1", "text": "每個 phase 的 commit 都讓三項驗證全綠：npm run validate、npm test、plugin validate --strict（升級後的 pin 2.1.272）", "behaviorChanging": true, "verification": "command: npm run validate; npm test; npx --yes @anthropic-ai/claude-code@2.1.272 plugin validate --strict ./cressetide" },
    { "id": "AC-2", "text": "git grep 找 TP、ledger、Copilot、EXPERIENCE 識別字，除 CHANGELOG 舊條目、EVIDENCE.md 歷史紀錄段落（owner D-1, 2026-10-13）與 docs/history.md 外零命中；archive/v0.7.2-full tag 解得到且包含所有被移除的檔案", "behaviorChanging": true, "verification": "command: git grep -nE '<TP|ledger|Copilot|EXPERIENCE identifiers>' -- . ':!CHANGELOG.md' ':!EVIDENCE.md' ':!docs/history.md'; git ls-tree -r archive/v0.7.2-full" },
    { "id": "AC-3", "text": "test-reviewer 與 verification-gate 含三條審查規則（規格沒寫的不斷言、斷言不超出來源範圍、要找多出來的斷言）與 test→source traceability", "behaviorChanging": false, "verification": "observed: cressetide/agents/test-reviewer.agent.md 與 verification-gate.md 內文（P2）" },
    { "id": "AC-4", "text": "npm test 只跑 test/**/*.test.mjs；runtime script、test/helpers.mjs、test/support.mjs、test/fixtures/* 不再被當成測試檔執行", "behaviorChanging": true, "verification": "command: npm test 的 TAP 頂層檔案清單對照 git ls-files 'test/**/*.test.mjs'（P1）" },
    { "id": "AC-5", "text": "hook 入口在 lib 不存在、stdin 格式錯、stdin 超過 5MB 三種情況都 exit 0；輸出永不含 permissionDecision:\"allow\"；hooks.json 不含 COPILOT 或 PLUGIN_ROOT", "behaviorChanging": true, "verification": "test/hooks.test.mjs spawn 冒煙三案例（P5）" },
    { "id": "AC-6", "text": "debug log 不出現明文 Bearer <token>；CTIDE_HOOK_DEBUG=0 時不寫 log", "behaviorChanging": true, "verification": "test/hooks.test.mjs debug 遮蔽與關閉案例（P5）" },
    { "id": "AC-7", "text": "Stop/SubagentStop 涵蓋：Agent 派出且 READY 且 panel 齊全、NOT READY+shipped 在 enforce 下 block、背景工作還在跑、resume 以最新為準、prose 引述的 verdict 不算數；全部不讀 transcript_path，且 P12 實機觀察到", "behaviorChanging": true, "verification": "test/orchestration-check.test.mjs + test/documented-facts.test.mjs classifyStop（P6）; observed: P12 host smoke receipt" },
    { "id": "AC-8", "text": "用 ## 與用 ### 寫 entry 的 failure memory 檔都注入「標題＋tags」；沒有 entry 時只注入指標；retrieve 與 consolidate 也都認得", "behaviorChanging": true, "verification": "test/session-memory-hooks.test.mjs + test/failure-retrieve.test.mjs + test/failure-consolidate.test.mjs（P5）" },
    { "id": "AC-9", "text": "isInvokedDirectly、parser、遮蔽 regex 鏈、OPS_TRUST_TAG、git wrapper、debug、stdin reader 只在 cressetide/lib/ 出現一次，9d guard 已移除；每支 script 有綁定測試證明接到正確的 lib 函式", "behaviorChanging": true, "verification": "command: git grep 單一定義檢查; 各 script 綁定測試（P4/P5）" },
    { "id": "AC-10", "text": "contract-check 抓得到禁止路徑裡的 untracked 新檔；base 無效時回報 unverified", "behaviorChanging": true, "verification": "test/contract-check.test.mjs（P7）" },
    { "id": "AC-11", "text": "regression-delta 把之前通過、之後消失的測試列為 missing，missing 非空時不輸出 no regression", "behaviorChanging": true, "verification": "test/regression-delta.test.mjs（P7）" },
    { "id": "AC-12", "text": "Map：write、commit、verify 之後為 fresh；改到被引用檔案時只有那一段變 stale；gitignore 的檔案不出現", "behaviorChanging": true, "verification": "test/map.test.mjs（P7）" },
    { "id": "AC-13", "text": "Ship：在 tag 之後新增一個非 vigil commit，它出現在 pending 裡且不宣稱 READY", "behaviorChanging": true, "verification": "test/ship.test.mjs（P2）" },
    { "id": "AC-14", "text": "Doctor（headless）有 deny/ask 決策列，探測過程沒有模型自組的 shell；所有探測都用 probeEnv；沒有 telemetry 列，也沒有 --plugin-root", "behaviorChanging": true, "verification": "test/doctor-security.test.mjs + test/doctor-project.test.mjs（P5/P7）" },
    { "id": "AC-15", "text": "MCP 文件前綴正確（mcp__plugin_<plugin>_<server>__* 與 mcp__<server>__*），不再教使用者改已安裝 plugin 的檔案，reviewer 改由 packet 拿到 MCP 證據", "behaviorChanging": false, "verification": "observed: external-capabilities / review-packet 內文 + git grep（P8）" },
    { "id": "AC-16", "text": "實測 /agents 列出 11 個 ctide: agent；reviewer 確實收到預載的契約，不行時有寫明的退路", "behaviorChanging": true, "verification": "observed: P0-3/P0-4 與 P12 實機 receipt" },
    { "id": "AC-17", "text": "vigil 中風險 run 強制載入的 reference 位元組數比 P0 基線（181,334）少 40% 以上；拿掉「最大推理強度」prose；test-reviewer 與 navigator 的 description 各 ≤ 250 字", "behaviorChanging": false, "verification": "command: 位元組量測（目標 ≤ 108,800）+ npm run validate description 長度檢查（P8）" },
    { "id": "AC-18", "text": "cressetide/workflows/vigil-review.js 存在，deep-mode 有用到它，P12 實際跑過一次", "behaviorChanging": true, "verification": "ESM 語法 + schema 對位測試（P9）; observed: P12 workflow run receipt" },
    { "id": "AC-19", "text": "eval：efficiency 與 model-provenance 已刪；claude plugin eval 冒煙成功；CI 不再跑 eval", "behaviorChanging": true, "verification": "command: git grep + claude plugin eval --runs 1 --max-cost-usd 3 receipt（P10/P12）" },
    { "id": "AC-20", "text": "validator 負向測試不再複製整個 repo；跑完測試後 temp 目錄沒有殘留（前後數量比對）；只改文件的 PR 拿得到 7 個 required context；附 Windows 全套測試時間前後對照", "behaviorChanging": true, "verification": "test/validate-structure.test.mjs overlay reader（P3）; command: temp 目錄前後計數; observed: CI changes job（P11）" },
    { "id": "AC-21", "text": "死碼移除：publish-release-core、s3、examples 重複的部分都已刪掉", "behaviorChanging": false, "verification": "command: git ls-files / git grep 零命中（P4/P7）" },
    { "id": "AC-22", "text": "文件：runtime-contract 是唯一出處；三語 README parity 通過；過時描述清單修完；有 docs/history.md；CHANGELOG 與版本是 0.8.0；有遷移說明", "behaviorChanging": false, "verification": "command: npm run validate（README parity、版本一致）; observed: 文件內容（P11）" },
    { "id": "AC-23", "text": "Logo 總大小 ≤ 300KB", "behaviorChanging": false, "verification": "command: .github/assets logo 檔案大小加總（P11）" },
    { "id": "AC-24", "text": "P0 實測、P12 smoke、A/B 都有紀錄並附 CLI 版本；A/B 花費 ≤ US$20", "behaviorChanging": false, "verification": "observed: docs/compatibility.md 與 docs/history.md 紀錄（P0/P12）" }
  ],
  "allowedPaths": [
    "cressetide/**",
    "test/**",
    "eval/**",
    "docs/**",
    ".github/**",
    "examples/**",
    "README*.md",
    "ARCHITECTURE.md",
    "CHANGELOG.md",
    "CONTRIBUTING.md",
    "EVIDENCE.md",
    "RELEASING.md",
    "SECURITY.md",
    "package.json",
    "typos.toml",
    ".gitignore",
    ".lycheeignore"
  ],
  "forbiddenPaths": ["LICENSE", "cressetide/LICENSE", ".git/**"],
  "mustNotChange": [
    "hooks 的 fail-open 邊界：任何載入失敗、輸入格式錯誤或非預期錯誤都 exit 0，不阻斷 session",
    "ctide.* opt-out settings 語意：planGate / destructiveGuard / contractGuard / preserveOnCompact 設為 false 才停用，預設開啟",
    "三個 sentinel 的 token 與值",
    "verdict tokens（READY / NOT READY 等 arbiter 判決字樣）",
    "intent-reviewer 永遠不被替代",
    "arbiter 逐條 AC 檢查"
  ],
  "assumptions": [
    { "text": "Node 下限寫成 engines \">=22.12\"，doctor 以完整 semver 比對 22.12.0", "alternative": "只寫 major 下限 >=22", "basis": "plan 設計重點明寫 Node 下限 >=22.12；major-only 比對無法擋下 22.0–22.11" },
    { "text": "EVIDENCE.md 裡「Node 20」的 CI run 紀錄是歷史事實，不改寫", "alternative": "一併改成 Node 22", "basis": "那是某次已發生 CI run 的紀錄，改寫會變成偽造證據；CHANGELOG 歷史同理" }
  ]
}
```

## Requirement

做出更小、更正確、盡量用 Claude Code 原生能力的 **v0.8.0**（breaking release，這次不發布）：修掉所有把關失效的 bug（Stop hook 只認 `Task`、failure memory 摘要其實是全文等），封存移除用不到的子系統（TP、ledger/reconcile/consolidate、Copilot、EXPERIENCE），工具函式收斂成 `cressetide/lib/` 共用模組，降低 vigil 的 context 成本與 CI 時間。分 P0–P13 階段，每階段驗證全綠才 commit，不 push。

## In scope

- `cressetide/**`（hooks、skills、agents、lib、workflows、evals、manifest）
- `test/**`、`eval/**`、`docs/**`、`.github/**`（workflows、scripts、assets、CODEOWNERS）、`examples/**`
- 根目錄文件：README×3、ARCHITECTURE、CHANGELOG、CONTRIBUTING、EVIDENCE、RELEASING、SECURITY
- `package.json`、`typos.toml`、`.gitignore`、`.lycheeignore`

## Out of scope（含延後）

- push、簽章 tag、發布（含 push `archive/v0.7.2-full` tag，留給之後）
- 使用者全域記憶檔的內容
- 本機 `.ctide/` 的 dogfood 資料（含 `.ctide/ledger`）
- LICENSE 檔
- CHANGELOG 既有歷史條目的內容

## Implied edge checklist

- 刪除後 `git grep` 零命中要排除 CHANGELOG 舊條目與 `docs/history.md`。
- 三語 README 的 `##` 段落數與行結構要一致（validator parity 檢查）。
- 封存文件的連結一律用 tag permalink；之後 push 時要先 push archive tag，否則 link-check 失敗。
- `npm test` 的 quoted glob 需要 Node 21 以上，所以 `package.json` 與 `validate.yml` 的 Node 版本必須同一個 commit 改。
- hook 入口只靜態 import node 內建模組；lib 動態載入失敗一律 exit 0。
- Windows（Git Bash 與 PowerShell）、路徑含空白的 consumer repo 都要能跑。
- 計時類測試在機器負載高時可能誤紅，要分辨是負載還是真回歸。

## Risk flags

- 高風險：hook 會在每個使用者的每個 session 執行；涉及 secret 遮蔽、CI、release，以及大量刪除。
- 抽共用模組可能帶進新錯誤：每支 script 要有綁定測試，hook 入口 lib 載入失敗 fail-open 並做 revert-to-red 驗證。
- 文件裡「工具會／不會做 X」的說法都要先對照程式碼確認。
- P0 live probes 目前被擋（`claude -p` OAuth 過期），依賴 P0 實測結果的決定（P0-1～P0-7）尚未定案。

## Open decisions

- hooks.json 指令形式（shell 或 exec）：依 P0-1。
- `skills:` 預載名稱寫法：依 P0-3。
- 是否保留 `agents[]`：依 P0-4。
- 是否出 plugin workflow：依 P0-5。
- plan-gate 的 edit 分支是否拿掉：依 P0-6。
- agent 內文 `${CLAUDE_PLUGIN_ROOT}` 是否展開：依 P0-7。

## Assumptions

- Node 下限是 `>=22.12`，doctor 以完整 semver（major/minor/patch）比對 22.12.0，而不是只看 major。
- EVIDENCE.md 中記錄某次 CI run 用 Node 20 的那一列是歷史事實，不改寫。
