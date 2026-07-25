# Intent-Scan Implementation Spec

- 狀態：draft v0.3 —— 二輪修訂（initial outcome 不建 Transition、plan-gate record 限 supersede、scope ruling 語義／格式分層、pre-gate layer 分類、task manifest 可達性、merge reconciliation 邊界）；審閱中
- 日期：2026-07-25
- 上游：`2026-07-25-shared-decision-provenance-model.md`（**approved v1.6**）。本 spec 只落地其 intent-scan 半邊；不重新定義任何 shared concept，附加的實作欄位一律以「annotation」標示且不改變上游欄位語義。
- 姊妹 spec：test-provenance（未寫）。§8 的 provenance store 是兩者共用的 shared infrastructure，test-provenance spec 消費、不重定義。

## 1. 目的與範圍

把 shared model 的 DP 發現（七維度 scan）、分流（§5 routing）、Ask 批次、post-approval 治理 checkpoint 與 plan gate 接線落到 CTide vigil 流程。**不含**：test tag 語法、contract-check 三層檢查、test-reviewer prompt（皆屬 test-provenance spec）。

## 2. 觸發

於 vigil **plan 階段、ExitPlanMode 之前**執行。觸發判準與 implementation risk（Risk Matrix）**完全無關**：

- **執行**：變更會改變外部可觀察行為 —— 下列任一：公開 API 表面（export、endpoint、CLI、error contract）、使用者可見行為或 UI 語義、持久化資料形狀或保留、對外副作用（通知、webhook、金流）、權限／角色行為。
- **不執行**：純內部 refactor（上列皆否）→ ledger 記 `intent-scan: skipped-no-observable-change`（宣告而非默過）。
- `--lite` **不豁免** scan —— 成本控制是 all-N/A 短路本身，不是跳過。
- 全維度 N/A → 輸出 `intent-scan: no-applicable-dimension` 合法結束；**不得推出 task trivial**（上游 §10）。

## 3. 執行位置（不新增 agent、不新增 pass、plan 階段 read-only）

**scan 的執行者一律是 main thread** —— 它需要 AskUserQuestion、需求整合與 plan gate，這些職責 navigator 不能擁有（`plan-grounding.md` 既有分工）：

| 風險 | Stage A（code grounding） | intent scan |
|---|---|---|
| 低／中 | 不執行（既有規則不變） | main thread inline，於 `SKILL.md` plan 步驟起草 contract 時順做 |
| 高／correctness-critical | **navigator**（既有 Stage A，不變） | **main thread** 於既有 **Stage B** 執行 —— Stage A 的 grounding 輸出作為 scan 的證據輸入；同一次完成，不重複 |

與 `hooks/plan-gate.js` 相容：plan 階段 scan **只產出內容**（進 plan 文本與 gate 揭露）；一切 store 寫入發生在 post-approval（§6），與 `task-contract.md` 既有 read/write split 一致。

## 4. 七維度協定

closed set（上游 §2 DP.dimension）。逐維度先判 applicable，applicable 者枚舉 0..n 個 DP —— 三態在 **DP 上**，不在維度上；一個 pinned 條款遮不掉同維度其他洞。

| dimension | 適用性問句 | 典型 DP 探針 |
|---|---|---|
| actor | 有不同角色／權限可觸及此行為嗎 | 誰能執行？角色間差異？未授權時的可觀察結果？ |
| lifecycle | 涉及有狀態的實體嗎 | 狀態集合？轉移觸發？建立前／刪除後的邊界行為？ |
| data | 產生／變更持久資料嗎 | 誰擁有？誰可見？保留多久？刪除語義（軟／硬）？ |
| money | 涉及金額、計費、權益嗎 | 計算規則？時點？按比例／退款？權益何時開關？ |
| external | 有對外副作用嗎 | 呼叫／通知／webhook？重試下的重複副作用語義？ |
| failure | 失敗會被外部觀察到嗎 | 使用者看到什麼？部分失敗？補償／回復路徑？ |
| time | 有時間性規則嗎 | 時區？計費錨點？冷卻／配額／期限？ |
| OTHER | — | 僅在**已有具體 distinguishingScenario** 時可用；ledger 記 `otherDimensionUsed`，事後進 taxonomy review |

每個 DP 依上游建檔門檻：寫不出 distinguishingScenario 即不建。建檔時完成 layer 分類（decision-authority 判準）。**無法判別 → conditional pre-gate 分類步驟**：spawn intent-reviewer（read-only）回傳 classification proposal，main thread 於 plan 內採用並揭露 layer＋classificationBasis，**然後才跑 routing** —— layer 決定 row 6（Ask）或 row 7（pendingReview），而 Ask batch 在 plan gate 前就需要結果，不能等 post-approval。此步驟不寫 store；正式 DP 仍於 post-approval 由 main thread 落檔。

## 5. Routing 執行（上游 §5 逐 DP；本節定義流程對應）

- **row 1（一般 binding clause）**：cite 進 plan。
- **row 1（exception-backed REQ）**：**沒有 DP-bound scope ruling 之前，scopeCovers 不成立、clause 不 applicable、不得走 row 1** —— plan 階段標 annotation `pendingScopeRuling`，處置依 §6 checkpoint；ruling 不成立則回 row 2。
- **rows 2／4／6（Ask）**：全部收進 **ask batch**。`AskUserQuestion` 每輪 ≤4 題：header=dimension、選項=alternatives（各附一行 scenario 摘要）；超過 4 題分輪，ask-tagged **一題不減**（`plan-grounding.md` 既有規則）。回答與明示延後的固化見 §6。
- **row 5（safeToAssume）**：ASSUM，`governedBy` 依上游固定映射（intent→`{discipline: intent}`；implementation→`{discipline: code}`）。
- **row 7（¬safe ∧ implementation）**：plan 階段標 annotation `pendingReview: <discipline>`，揭露候選方案；**在該 DP 的 outcome 落檔且 active ∧ applicable 之前，受影響實作不得開始**（§6 checkpoint）。

## 6. Post-approval 治理 checkpoint（conditional pre-implementation）

ExitPlanMode 核准後、受影響實作開始前，依序執行。**這不是新增 scan pass** —— row 7 的技術裁決與 exception 的 scope ruling 本來就是上游要求，只是在真的產生此類 DP 時提前到實作前：

```
1. main thread 落檔（§8）：鑄造 taskId 與 task manifest（scratch）、Sources（需求固化）、
   本 task 的 DP、ask 回答 → user-answer records → 新 REQ、
   明示延後 → ASSUM＋user-ack（user-answer record）、row 5 → ASSUM clauses。
   一般 ExitPlanMode 核准是**流程事件，不建立任何 RecordRef** ——
   RecordRef(kind=plan-gate) **僅於 row 3 supersede proposal 時鑄造**
   （target／impact／disposition 完整，上游 §7）。
2. 存在 pendingScopeRuling DP（語義／機械分層）：
   spawn intent-reviewer（read-only）→ proposal **必須明示 scopeCovers=true|false**
   → main thread 固化 review-ruling record
   → 機械驗：可解析 ∧ by == {discipline: intent} ∧ subjectRef == current DP
   → routing：格式有效 ∧ ruling.scopeCovers=true → row 1 resolved
             ruling.scopeCovers=false        → 回 row 2（Ask）
             格式無效                        → fail-closed（重出 ruling）
   checker 只消費 intent discipline 的明示裁決，不判斷其語義真實性。
3. 存在 pendingReview DP：
   spawn 對應 discipline reviewer（read-only）→ ruling proposal
   → main thread 固化 review-ruling record ＋ outcome：
   - 初次（open DP）：建 outcome clause（DEC／ASSUM／REQ）＋原子設定 DP.status
     與 terminal ref —— **不建 Transition**（無舊 clause 可作 subject；
     上游 Transition 只作用於 active clause）
   - reopen 且替換既有 terminal：先建 successor → Transition(subject=舊 terminal)
     → 依上游原子協定 repoint／reopen
   → outcome active ∧ applicable 後，該 DP 的受影響實作才解鎖
   （Ask 後由 open DP 建新 REQ 同理：初次不建 Transition。）
4. 與任何 pending DP 無關的工作可先進行，不阻擋整個 task
```

- **Single-writer 邊界**：reviewer 只回傳 proposal，**一切 store 寫入由 main thread 執行**（與既有 reviewer read-only 工具邊界一致）；arbiter 在 gate 讀 store 驗 terminal state（不是驗 reviewer 的口頭輸出）。
- **受影響範圍判定**（哪些檔案／區域屬於某 DP 的「受影響實作」）是語義判斷 —— main thread 判、plan 揭露；誠實列入 assurance boundary。
- arbiter gate 仍為最後防線：任何 pending annotation 未清 → 不得 `READY`；但 checkpoint 的目的正是讓它幾乎永遠不需要出手。

## 7. Plan gate 接線

ExitPlanMode 的 plan 內容新增 intent-scan 節，含：維度 applicability 一覽、resolved citations、ask 待問清單（或已得回答）、ASSUM 清單（text＋alternative）、`pendingReview`／`pendingScopeRuling` 清單與候選、沿用清單（§9）、或 `no-applicable-dimension`／`skipped-no-observable-change` 宣告。一般核准是**流程事件，不鑄造 RecordRef**；僅 row 3 supersede proposal 於 §6 步驟 1 鑄造完整 plan-gate record。

## 8. 產物：provenance store（shared infrastructure）

依既有 runtime contract 的三分（committed semantic state／untracked episodic／per-run scratch）：

| 檔案 | 分類 | 內容 |
|---|---|---|
| `.ctide/provenance.json` | **tracked canonical semantic state（committed）** | sources／clauses／transitions／records／DPs —— 測試 `@src` 引用鏈的全部對象，**與引用它們的程式／測試一起提交**；fresh clone／CI 必須能解析完整 chain |
| `.ctide/output/pending-governance.json` | per-run scratch（untracked） | `pendingReview`／`pendingScopeRuling`／`currentTaskRef` 等 annotation —— 不進 Git |
| ledger | 既有分類不變 | 觀測 telemetry（§10） |

- **ID 鑄造：branch-safe opaque id** —— `<PREFIX>-<ULID>`（如 `REQ-01J9XKQ…`），全 prefix 適用；上游的「n」讀作 opaque suffix，非全 repo 整數序號。**ULID 只保證新 object id 不碰撞，不簡化 Git merge**：
  - 可自動 set-union：**不同 id** 的 immutable Source／Clause／Record。
  - **必須 fail-closed reconciliation**：同 subject 的多個 Transition（違反單生效轉移）、同 DP 的不同 current outcome／status（mutable，不可聯集）、同 id 不同 payload。
  - v1 維持單一 JSON＋atomic writer；**任何 loader（scan、checker、arbiter）載入時驗上列三類＋INV-1..4，違反即 fail-closed**。文字衝突成本過高時可改 object-per-file／JSONL，屬實作層選擇，不改本契約。
- 上游 minimum payloads 逐欄照收。

**Contract derivation（`contract-check.mjs` 零修改的前提）**：

- **task manifest**（pending-governance scratch）：taskId（ULID）＋ `currentTaskDpIds ＝ 本 task 新建 ∪ 沿用 ∪ reopen 的所有 DP id`。沿用舊 DP／clause 時**不篡改** immutable clause 的原 `taskRef` —— 可達性由 manifest 決定，不靠「本 task 建立」。
- annotation `taskRef`：stamp 在本 task **建立**的 clause／record 上（建立時 authored，永不改寫）。
- annotation `REQ.acceptance: { behaviorChanging, verification }`：REQ(kind=acceptance) 必附 —— 補齊既有 `acceptanceCriteria[]` 需要的欄位。
- 導出規則：

```
acceptanceCriteria = currentTaskDpIds[].resolvedBy → active REQ(kind=acceptance)
                   ∪ 本 task 直接建立（taskRef==currentTaskId）的 plan-approved AC REQ
                   → { id, text, behaviorChanging, verification }
assumptions        = currentTaskDpIds[].assumedAs → active ASSUM
                   ∪ 本 task 直接建立的 ASSUM
                   → { id, text, alternative, basis }
decidedBy          → Review Packet／governance context，不導出成 assumptions
```

- **非-intent AC 不消失**：intent scan 被 skip（或 no-applicable-dimension）的 task，其 plan-approved acceptance criteria **一律仍建立 REQ(kind=acceptance)**，sourceRef 指向固化後的需求 Source（需求固化本來就是上游要求）。統一走 REQ 使 test-provenance 的 `@src` 解析對所有 task 一致。

## 9. 沿用與 reopen

scan 開始前先讀 tracked store：同一 DP（scenario 語義相同）已有 active 且 applicable 的 outcome 且無 reopen trigger → **必須沿用 cite，不重問**（上游 §8）；store tracked 後跨 clone 沿用成立，v0.1 的「跨 clone 遺失」限制**撤銷**。reopen 依 closed trigger list，重入記 `reopenedBy`；intent fork 重入重經 plan-gate routing。DP 同一性判定是語義判斷 —— main thread 判、plan 揭露沿用清單、使用者可推翻；機械層不宣稱。

## 10. Review Packet 與 arbiter 接線

reviewer 不依賴完整 thread history。`references/review-packet.md` 增列 packet 必帶：

```
provenance store path（.ctide/provenance.json）
currentTaskRef
本 task 相關的 DP／clause／record id 清單
pending governance items（pendingReview／pendingScopeRuling 現況）
```

Writer 協定（與 §6 一致）：**reviewer 產生 ruling proposal → main thread 固化 ruling／DEC／Transition → arbiter 讀 store 驗 terminal state**。arbiter 檢查項：pending 清零、INV-1..4、terminal ref active ∧ applicable。

## 11. Run ledger 觀測（非 gate）

scan 完成即 append（**流程副作用，不綁報告格式 sentinel** —— failmem 教訓）：

```
intentScan: {
  outcome: completed | no-applicable-dimension | skipped-no-observable-change,
  dpCounts: { byLayer, byStatus, byDiscoveredAt, reopened },
  askCount, assumeCount, pendingReviewCount, pendingScopeRulingCount,
  otherDimensionUsed: bool
}
```

觀測值永不當 gate；數字上升可能是偵測變好（上游 §10）。

## 12. 修改檔案清單

| 檔案 | 變更 |
|---|---|
| `cressetide/skills/vigil/references/intent-scan.md` | **新增** —— §2–§7、§9 協定本體（plugin 慣用英文撰寫） |
| `cressetide/skills/vigil/references/reviewer-selection.md` | Plan Grounding 段落：intent-scan 觸發與風險脫鉤；Stage A 維持 high-risk gated |
| `cressetide/skills/vigil/references/plan-grounding.md` | Stage B（main thread）改為引用 intent-scan 協定；Stage A（navigator）不變 |
| `cressetide/skills/vigil/SKILL.md` | plan 步驟：inline scan 指令＋plan gate 揭露節；post-approval checkpoint 順序 |
| `cressetide/skills/vigil/references/task-contract.md` | machine block 由 store 導出的對映（§8） |
| `cressetide/skills/vigil/references/review-packet.md` | packet 增列 §10 四項 |
| `docs/runtime-contract.md` | **state-class 正式住所**：`.ctide/provenance.json` 登記 committed semantic state；`pending-governance.json` 登記 per-run scratch |
| `cressetide/skills/vigil/references/runtime-policy.md` | 補 single-writer 邊界（reviewer propose／main thread persist），不承載 state-class |
| `cressetide/agents/navigator.agent.md` | 澄清：navigator 僅 Stage A，不執行 scan |
| `cressetide/agents/intent-reviewer.agent.md` | layer 分類確認、scope ruling proposal、ask 擬題職責 |
| `cressetide/agents/arbiter.agent.md` | pending 清零＋INV 檢查＋terminal state 讀 store 驗證 |
| `cressetide/skills/vigil/scripts/run-ledger.mjs` ＋ `references/run-ledger.md` | `intentScan` 欄位 |

## 13. 驗收條件

1. **綠地訂閱**（人類一句話需求）：money／lifecycle／actor／external／failure／time 產出 material forks，全數進 ask batch；零 caller 不影響判定。
2. **顯示名稱可編輯**：唯一性、歷史顯示 → Ask；冷卻期 → `ASSUM(layer=intent, governedBy=intent)`；既有 code 只作證據揭露。
3. **demo1 webhook TASK.md**：`no-applicable-dimension` 或全 resolved；不標 trivial；Risk Matrix 獨立判 correctness-critical、panel 不縮。
4. **Fresh clone 完整性**：已提交 `@src REQ-<id>` 的測試在 fresh clone 可解析完整 provenance chain（clause → source → record）。
5. **Row 7 checkpoint**：`pendingReview` 未裁決時，**受影響實作尚未開始**（非僅 arbiter 不出 READY）；無關工作可先行。
6. **Exception checkpoint**：exception-backed REQ 無 DP-bound ruling 時不得走 row 1、不得開始相關實作；ruling 不成立回 row 2。
7. **高風險路徑**：Stage A=navigator、scan=main thread（Stage B），scan 不重複執行。
8. **Contract derivation**：只取 currentTaskRef 可達的 active clause；`behaviorChanging`／`verification` 保留；歷史任務條款不滲入本次 contract；skip-scan task 的 AC 仍以 REQ 形式存在。
9. 機械可驗：ledger 出現 `intentScan` entry（不依賴報告 sentinel）；plan 文本含 scan 節；plan 階段零 store 寫入（plan-gate.js 無觸發）。
10. **初次 outcome 無 Transition**：open DP 首判產出 DEC 時 store 無對應 Transition；reopen 替換既有 terminal 時才出現 Transition(subject=舊 clause)。
11. **plan-gate record 限 supersede**：非 supersede task 全程不建立 RecordRef(kind=plan-gate)；row 3 時建立且 target／impact／disposition 完整。
12. **語義／格式分層**：intent ruling 格式有效但 `scopeCovers=false` → 走 row 2，不得入 row 1。
13. **Merge reconciliation**：兩 branch 對同 clause 各建 Transition，merge 後任一 loader 必須 fail-closed，不得聯集放行。

## 14. 邊界與非目標

- 不動 test tag／contract-check／test-reviewer（test-provenance spec）。
- 不削弱 `verification-gate.md` 紅→綠。
- 不新增 reviewer pass；§6 checkpoint 與 §4 的 pre-gate 分類步驟都是上游本就要求的裁決（技術裁決、layer fallback），僅在產生對應 DP 時條件執行，且均為 read-only proposal —— 寫 store 的永遠是 main thread。
- 語義判斷明文不宣稱機械保證：DP 同一性（§9）、受影響範圍判定（§6）、layer 初判（§4）。
