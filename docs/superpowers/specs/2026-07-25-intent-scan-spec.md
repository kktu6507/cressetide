# Intent-Scan Implementation Spec

- 狀態：draft v0.1 — 審閱中
- 日期：2026-07-25
- 上游：`2026-07-25-shared-decision-provenance-model.md`（**approved v1.6**）。本 spec 只落地其 intent-scan 半邊；不重新定義任何 shared concept，附加的實作欄位以「annotation」標示且不改變上游欄位語義。
- 姊妹 spec：test-provenance（未寫）。本文 §7 的 provenance store 是兩者共用的 shared infrastructure，test-provenance spec 消費、不重定義。

## 1. 目的與範圍

把 shared model 的 DP 發現（七維度 scan）、分流（§5 routing）、Ask 批次與 plan gate 接線落到 CTide vigil 流程。**不含**：test tag 語法、contract-check 三層檢查、test-reviewer prompt（皆屬 test-provenance spec）。

## 2. 觸發

於 vigil **plan 階段、ExitPlanMode 之前**執行。觸發判準與 implementation risk（Risk Matrix）**完全無關**：

- **執行**：變更會改變外部可觀察行為 —— 下列任一：公開 API 表面（export、endpoint、CLI、error contract）、使用者可見行為或 UI 語義、持久化資料形狀或保留、對外副作用（通知、webhook、金流）、權限／角色行為。
- **不執行**：純內部 refactor（上列皆否）→ ledger 記 `intent-scan: skipped-no-observable-change`（宣告而非默過）。
- `--lite` **不豁免** scan —— 成本控制是 all-N/A 短路本身，不是跳過。
- 全維度 N/A → 輸出 `intent-scan: no-applicable-dimension` 合法結束；**不得推出 task trivial**（上游 §10）。

## 3. 執行位置（不新增 agent、不新增 pass、plan 階段 read-only）

| 風險 | 執行者 | 位置 |
|---|---|---|
| 低／中 | orchestrator inline | `SKILL.md` plan 步驟的 acceptance-criteria 定義處，起草 contract 時順做 |
| 高／correctness-critical | navigator | 併入 `plan-grounding.md` Stage B 的 assumption register —— 同一次完成，不重複執行 |

與 `hooks/plan-gate.js` 相容：scan 在 plan 階段**只產出內容**（進 plan 文本與 gate 揭露）；provenance store 的實體寫入發生在 **post-approval 第一步**，由 implementer 與 `.ctide/output/contract.md` 同批落檔（沿用 `task-contract.md` 既有的 read/write split）。

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

每個 DP 依上游 §2 建檔門檻：寫不出 distinguishingScenario 即不建。建檔時完成 layer 分類（decision-authority 判準；無法判別 → intent discipline，操作上＝orchestrator 於 plan 揭露並在 review 階段由 intent-reviewer 確認分類）。

## 5. Routing 執行（上游 §5 逐 DP；本節只定義流程對應）

- **row 1**（binding clause 可裁）：cite 進 plan；exception-backed 需 scopeCovers ruling —— plan 階段由 intent discipline 出 ruling 的操作對應為：**review 階段 intent-reviewer 補 ruling record**，plan 先揭露暫判（annotation `pendingScopeRuling`），arbiter 於 gate 檢查 ruling 已落檔。
- **rows 2／4／6**（Ask）：全部收進 **ask batch**。`AskUserQuestion` 每輪 ≤4 題：header=dimension、每個選項附一行 scenario 摘要、alternatives 為選項；超過 4 題分輪 —— ask-tagged **一題不減**（`plan-grounding.md` 既有規則）。回答 → `user-answer` record（subjectRef=該 DP）→ 新 REQ（authority=approved-requirement；成為驗收條件者 kind=acceptance，其餘 specification）。使用者明示延後 → ASSUM＋user-ack。
- **row 5**（safeToAssume）：建 ASSUM，`governedBy` 依上游固定映射（intent→`{discipline: intent}`；implementation→`{discipline: code}`）。
- **row 7**（¬safe ∧ implementation）：plan 階段**沒有 reviewer ruling 可用** —— DP 保持 `open` 並加 annotation `pendingReview: <discipline>`；plan 揭露該 fork 與**暫用候選**，實作依暫用候選進行；review 階段由對應 discipline reviewer 裁決 → ruling record → DEC（或推翻 → repair loop）。**arbiter gate**：存在未裁決的 `pendingReview` DP → 不得 `READY`（納入既有 panel-gap 邏輯）。

## 6. Plan gate 接線

ExitPlanMode 的 plan 內容新增 intent-scan 節，含：維度 applicability 一覽、resolved citations、ask 批次的問答結果（或待問清單）、ASSUM 清單（text＋alternative）、`pendingReview` 清單與暫用候選、或 `no-applicable-dimension`／`skipped-no-observable-change` 宣告。核准即上游 §2 所稱 plan-gate 核准紀錄的建立時點（`plan-gate` record 於 post-approval 落檔）。

## 7. 產物：provenance store（shared infrastructure）

`.ctide/provenance.json` —— **durable、跨 run 存活**（DP 沿用需要），gitignored（與 `.ctide/output` 同策略）。已知取捨：不 commit ⇒ 跨 clone 沿用遺失，屬 v1 揭露的限制；重建由 reopen triggers（來源 drift 等）自然吸收。

```json
{
  "provenanceVersion": 1,
  "sources": [],        // S-n，append-only
  "clauses": [],        // REQ-n | DEC-n | ASSUM-n，append-only、immutable
  "transitions": [],    // T-n，append-only
  "records": [],        // R-n（user-answer | review-ruling | plan-gate | …），append-only
  "decisionPoints": []  // DP-n，可變工作紀錄（上游 §2）
}
```

- id 鑄造：per-prefix 單調遞增，跨 run 續號；run 內外皆唯一。
- 上游 minimum payloads 逐欄照收；**annotation 欄位**（`pendingReview`、`pendingScopeRuling`）為本 spec 附加，不改上游語義。
- `contract.md` machine block 相容性：`acceptanceCriteria[]` 由 `REQ(kind=acceptance)` **導出**、`assumptions[]` 由 ASSUM 導出（保留既有欄位形狀，附 id 對映）—— 既有 `contract-check.mjs` 不需本 spec 改動；正式三層檢查屬 test-provenance spec。

## 8. 沿用與 reopen

scan 開始前先讀 store：同一 DP（scenario 語義相同）已有 active 且 applicable 的 outcome 且無 reopen trigger → **沿用 cite，不重問**（上游 §8）。reopen 依 closed trigger list，重入記 `reopenedBy`；intent fork 重入重經 plan-gate routing（僅在仍無 binding 裁決時才 ask）。DP 同一性判定（「同一個 DP」）是語義判斷 —— 由 orchestrator 判、plan 揭露沿用清單，使用者可推翻；不做機械 scenario 比對（誠實列為 assurance boundary）。

## 9. Run ledger 觀測（非 gate）

scan 完成即 append（**流程副作用，不綁報告格式 sentinel** —— failmem 教訓）：

```
intentScan: {
  outcome: completed | no-applicable-dimension | skipped-no-observable-change,
  dpCounts: { byLayer, byStatus, byDiscoveredAt, reopened },
  askCount, assumeCount, pendingReviewCount,
  otherDimensionUsed: bool
}
```

觀測值永不當 gate；數字上升可能是偵測變好（上游 §10）。

## 10. 修改檔案清單

| 檔案 | 變更 |
|---|---|
| `cressetide/skills/vigil/references/intent-scan.md` | **新增** —— 本 spec §2–§6、§8 的協定本體（plugin 慣用英文撰寫） |
| `cressetide/skills/vigil/references/reviewer-selection.md` | Plan Grounding 段落：intent-scan 子集全域化（觸發與風險脫鉤）；Stage A 維持 high-risk gated |
| `cressetide/skills/vigil/references/plan-grounding.md` | Stage B assumption register 改為引用 intent-scan 協定（高風險＝完整版，含 Stage A grounding） |
| `cressetide/skills/vigil/SKILL.md` | plan 步驟：非高風險 inline scan 指令＋plan gate 揭露節 |
| `cressetide/skills/vigil/references/task-contract.md` | machine block 與 provenance store 的導出對映 |
| `cressetide/agents/navigator.agent.md` | Stage B 內含 scan（高風險路徑） |
| `cressetide/agents/intent-reviewer.agent.md` | layer 分類 fallback 確認、scopeCovers ruling、ask 擬題職責 |
| `cressetide/agents/arbiter.agent.md` | `pendingReview`／`pendingScopeRuling` 未落檔 → 不得 READY |
| `cressetide/skills/vigil/scripts/run-ledger.mjs` ＋ `references/run-ledger.md` | `intentScan` 欄位 |

## 11. 驗收條件

1. **綠地訂閱**（人類一句話需求）：money／lifecycle／actor／external／failure／time 維度產出 material forks，全部進 ask batch；零 caller 不影響任何判定。
2. **顯示名稱可編輯**：唯一性、歷史顯示 → Ask；冷卻期 → `ASSUM(layer=intent, governedBy=intent)`；既有 code 只作為證據揭露。
3. **demo1 webhook TASK.md**：輸出 `no-applicable-dimension` 或全 resolved；**不標 trivial**；Risk Matrix 仍獨立判 correctness-critical、panel 不縮。
4. 機械可驗：ledger 出現 `intentScan` entry（不依賴報告 sentinel）；plan 文本含 scan 節；store 落檔於 post-approval 且 plan 階段零寫入（plan-gate.js 無觸發）。
5. `pendingReview` DP 未裁決時 arbiter 不出 `READY`（以一個 row-7 案例演練）。

## 12. 邊界與非目標

- 不動 test tag／contract-check／test-reviewer（test-provenance spec）。
- 不削弱 `verification-gate.md` 紅→綠。
- 不新增 reviewer pass；scan 是 plan 階段的枚舉紀律，不是新 agent。
- DP 同一性（§8）與 layer 初判是語義判斷，機械層不宣稱 —— assurance boundary 與上游一致。
