# Intent-Scan Implementation Spec

- 狀態：draft v0.4 —— 三輪修訂（scope ruling 前移 pre-gate、row 7 四分含 re-gate、governance-ruling contract、provenance-store script、contract 生成時序、撤並行）；審閱中
- 日期：2026-07-25
- 上游：`2026-07-25-shared-decision-provenance-model.md`（**approved v1.6**）。本 spec 只落地其 intent-scan 半邊；不重新定義任何 shared concept，附加的實作欄位一律以「annotation」標示且不改變上游欄位語義。
- 姊妹 spec：test-provenance（未寫）。§8 的 provenance store 與 store script 是兩者共用的 shared infrastructure，test-provenance spec 消費、不重定義。

## 1. 目的與範圍

把 shared model 的 DP 發現（七維度 scan）、pre-gate 治理（layer 分類＋scope ruling）、分流、Ask 批次、post-approval row-7 checkpoint、contract 生成與 plan gate 接線落到 CTide vigil 流程。**不含**：test tag 語法、contract-check 三層檢查、test-reviewer prompt（皆屬 test-provenance spec）。

## 2. 觸發

於 vigil **plan 階段、ExitPlanMode 之前**執行。觸發判準與 implementation risk（Risk Matrix）**完全無關**：

- **執行**：變更會改變外部可觀察行為 —— 下列任一：公開 API 表面（export、endpoint、CLI、error contract）、使用者可見行為或 UI 語義、持久化資料形狀或保留、對外副作用（通知、webhook、金流）、權限／角色行為。
- **不執行**：純內部 refactor（上列皆否）→ ledger 記 `intent-scan: skipped-no-observable-change`（宣告而非默過）。
- `--lite` **不豁免** scan —— 成本控制是 all-N/A 短路本身，不是跳過。
- 全維度 N/A → 輸出 `intent-scan: no-applicable-dimension` 合法結束；**不得推出 task trivial**（上游 §10）。

## 3. 執行位置（不新增 pass、plan 階段 read-only）

**scan 的執行者一律是 main thread** —— 它需要 AskUserQuestion、需求整合與 plan gate，這些職責 navigator 不能擁有（`plan-grounding.md` 既有分工）：

| 風險 | Stage A（code grounding） | intent scan |
|---|---|---|
| 低／中 | 不執行（既有規則不變） | main thread inline，於 `SKILL.md` plan 步驟起草時順做 |
| 高／correctness-critical | **navigator**（既有 Stage A，不變） | **main thread** 於既有 **Stage B** 執行；Stage A 輸出作為證據輸入，同次完成不重複 |

Plan 階段允許的唯一 subagent 呼叫是 §4 的 **conditional pre-gate intent-reviewer call**（read-only proposal，不寫 store）。與 `hooks/plan-gate.js` 相容：plan 階段零 store 寫入；一切落檔在 post-approval（§6）。

## 4. 七維度協定與 pre-gate 治理

closed set（上游 §2 DP.dimension）。逐維度先判 applicable，applicable 者枚舉 0..n 個 DP —— 三態在 **DP 上**，不在維度上。

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

建檔門檻：寫不出 distinguishingScenario 即不建。建檔時完成 layer 分類（decision-authority 判準）。

**Pre-gate 治理（conditional、read-only、一次 call）**：存在「無法分類的 DP」或「exception-backed row-1 候選」時，spawn intent-reviewer 一次，帶回：

```
layer-classification proposals（classifiedLayer＋basis）
scope-coverage proposals（scopeCovers=true|false，明示，DP-bound）
→ main thread 於 plan 內採用並揭露
→ 跑 routing（layer 決定 row 6 或 row 7；scopeCovers 決定 row 1 或 row 2）
→ 所有 row 2／4／6 Ask 於 gate 前完成
→ ExitPlanMode
```

Proposal 在 plan mode 只存在於 plan 文本；核准後才由 main thread 固化 record（§6 步驟 1）。**核准後不存在「回頭 Ask」的 scope 路徑** —— 這正是前移的目的。

## 5. Routing 執行（上游 §5 逐 DP）

- **row 1（一般 binding clause）**：cite 進 plan。
- **row 1（exception-backed REQ）**：需 §4 pre-gate 的 DP-bound `scopeCovers=true` proposal；`false` → row 2（pre-gate Ask）；無 proposal 不得走 row 1。
- **rows 2／4／6（Ask）**：全部收進 ask batch，**於 gate 前完成**。`AskUserQuestion` 每輪 ≤4 題：header=dimension、選項=alternatives（各附一行 scenario 摘要）；超過 4 題分輪，ask-tagged 一題不減。回答／明示延後於 §6 步驟 1 固化。
- **row 5（safeToAssume）**：ASSUM，`governedBy` 依上游固定映射。
- **row 7（¬safe ∧ implementation）**：plan 揭露候選＋annotation `pendingReview: <discipline>`；裁決依 §6 checkpoint，**受影響實作在 outcome active ∧ applicable 前不得開始**。

## 6. Post-approval 序列（single-writer；implementer 最後才進場）

```
1. main thread 落檔（經 §8 store script）：鑄造 taskId＋task manifest（scratch）、
   Sources（需求固化）、本 task DP、pre-gate ask 回答 → user-answer records → 新 REQ、
   明示延後 → ASSUM＋user-ack、row 5 → ASSUM、
   pre-gate scope-coverage proposals → review-ruling records。
   一般核准是流程事件，不建 RecordRef；plan-gate record 僅 row 3 supersede proposal。
2. 存在 pendingReview DP —— row-7 checkpoint（上游四分逐支明列）：
   spawn 對應 discipline reviewer（Governance Packet，見下）→ ruling proposal →
   main thread 依 rulingKind 固化：
     binding-policy       → 政策固化為 Source＋新 REQ → resolved
     technical-decision   → DEC → decided
     approved-provisional → ASSUM → assumed
     product-tradeoff     → **回 plan mode：row 6 Ask → 重新 ExitPlanMode**；
                            新核准前受影響實作保持鎖定
   初次（open DP）不建 Transition；reopen 替換既有 terminal 才建
   successor → Transition(subject=舊 terminal) → 上游原子協定。
3. pending 清零（含 product-tradeoff 的重新核准完成）
   → 由 final currentTaskDpIds 導出 contract.md（§8 規則）
   → implementer 才開始實作。
```

**v1 不做 partial contract**：撤掉「無關工作可先行」——並行需要 partial-contract 版本與更新規則，複雜度不值得；治理完成 → contract 一次導出 → 實作開始。

**Governance-ruling contract**（`references/governance-ruling.md`，所有 discipline 同一 schema；orchestrator 統一組裝 packet，reviewer 不自行決定寫哪種物件）：

```
輸入（Governance Packet）：
  DP id、scenario、alternatives、layer＋classificationBasis、
  materialReasons、basisRefs／relevant Sources、requested discipline
輸出（ruling proposal）：
  by: ReviewerPrincipal
  subjectRef: DP id
  rulingKind: binding-policy | technical-decision | approved-provisional |
              product-tradeoff | scope-coverage | layer-classification
  decision ／ scopeCovers ／ classifiedLayer（依 rulingKind 擇一必填）
  basis
```

`scope-coverage`／`layer-classification` 由 §4 pre-gate 消費；其餘四種由步驟 2 消費。

## 7. Plan gate 接線

ExitPlanMode 的 plan 內容新增 intent-scan 節：維度 applicability 一覽、resolved citations（含 scope-coverage 判定與依據）、layer 分類揭露、ask 問答結果、ASSUM 清單（text＋alternative）、`pendingReview` 清單與候選、沿用清單（§9）、或 `no-applicable-dimension`／`skipped-no-observable-change` 宣告。一般核准是流程事件，不鑄造 RecordRef。

## 8. 產物：provenance store（shared infrastructure）

| 檔案 | 分類 | 內容 |
|---|---|---|
| `.ctide/provenance.json` | **tracked canonical semantic state（committed）** | sources／clauses／transitions／records／DPs —— 與引用它們的程式／測試一起提交；fresh clone／CI 必須能解析完整 chain |
| `.ctide/output/pending-governance.json` | per-run scratch（untracked） | task manifest（taskId＋currentTaskDpIds）、pending annotations |
| ledger | 既有分類不變 | 觀測 telemetry（§11） |

- **ID**：`<PREFIX>-<ULID>`。**ULID 只保證新 object id 不碰撞，不簡化 Git merge**：不同 id 的 immutable 物件可自動 set-union；同 subject 多 Transition、同 DP 不同 outcome、同 id 不同 payload **必須 fail-closed reconciliation**。
- **Store script（新增 `cressetide/skills/vigil/scripts/provenance-store.mjs`；main thread 不得徒手 Edit tracked JSON）**：

```
命令面：validate | init-task | append-source | append-clause |
        append-record | append-transition | set-dp-outcome | reopen-dp
寫入流程：load＋validate → 記錄原檔 digest → 套用單一 operation
        → 驗 refs＋Transition matrix＋INV-1..4 → CAS（原檔 digest 未變）
        → 同目錄 temp write＋atomic replace
```

- Writer 拒絕：immutable object 修改、同 subject 第二個 Transition、CAS mismatch。
- **Loader 誠實邊界**：只驗 snapshot 內部一致性，**不能靠單次載入證明歷史從未被改寫**；跨 commit 的 immutable-mutation 檢查由 test-provenance gate 補。

**Contract derivation**：

- task manifest：`currentTaskDpIds ＝ 本 task 新建 ∪ 沿用 ∪ reopen 的所有 DP id`；**`currentTaskRef == task manifest.taskId`**（Review Packet 同名同物）。沿用時不篡改 immutable clause 的原 `taskRef`。
- annotation `taskRef`（建立時 authored，永不改寫）；annotation `REQ.acceptance: { behaviorChanging, verification }`。
- 導出（union 依 clause id 去重）：

```
acceptanceCriteria = currentTaskDpIds[].resolvedBy → active REQ(kind=acceptance)
                   ∪ 本 task 直接建立（taskRef==currentTaskId）的 plan-approved AC REQ
assumptions        = currentTaskDpIds[].assumedAs → active ASSUM
                   ∪ 本 task 直接建立的 ASSUM
decidedBy          → Review Packet／governance context，不導出成 assumptions
```

- **非-intent AC 不消失**：skip-scan task 的 plan-approved AC 一律仍建 REQ(kind=acceptance)，sourceRef 指固化需求 Source。
- **時序**：contract.md 於 §6 步驟 3（pending 清零後）由 main thread 一次導出，**早於 implementer**；implementer 不再手寫 machine block。

## 9. 沿用與 reopen

scan 開始前先讀 tracked store：同一 DP 已有 active 且 applicable outcome 且無 reopen trigger → **必須沿用 cite，不重問**；沿用 DP 計入 manifest。reopen 依 closed trigger list，重入記 `reopenedBy`；intent fork 重入重經 plan-gate routing。DP 同一性判定是語義判斷 —— main thread 判、plan 揭露、使用者可推翻；機械層不宣稱。

## 10. Review Packet 與 arbiter 接線

`references/review-packet.md` 增列 packet 必帶：store path、`currentTaskRef`（==manifest.taskId）、本 task 相關 DP／clause／record id 清單、pending governance 現況。Writer 協定：**reviewer 產生 ruling proposal → main thread 固化 ruling＋outcome，僅替換既有 terminal 時建立 Transition → arbiter 讀 store 驗 terminal state**（pending 清零、INV-1..4、terminal ref active ∧ applicable）。

## 11. Run ledger 觀測（非 gate）

```
intentScan: {
  outcome: completed | no-applicable-dimension | skipped-no-observable-change,
  dpCounts: { byLayer, byStatus, byDiscoveredAt, reopened },
  askCount, assumeCount, pendingReviewCount,
  scopeRulings: { true: n, false: n },
  otherDimensionUsed: bool
}
```

流程副作用即 append，不綁報告格式 sentinel（failmem 教訓）；觀測值永不當 gate。

## 12. 修改檔案清單

| 檔案 | 變更 |
|---|---|
| `cressetide/skills/vigil/references/intent-scan.md` | **新增** —— §2–§7、§9 協定本體（plugin 慣用英文） |
| `cressetide/skills/vigil/references/governance-ruling.md` | **新增** —— §6 的 Governance Packet 與 ruling proposal schema |
| `cressetide/skills/vigil/scripts/provenance-store.mjs`（＋tests） | **新增** —— §8 命令面、CAS、atomic write、invariant validation |
| `cressetide/skills/vigil/references/reviewer-selection.md` | intent-scan 觸發與風險脫鉤；Stage A 維持 high-risk gated |
| `cressetide/skills/vigil/references/plan-grounding.md` | Stage B（main thread）引用 intent-scan 協定；Stage A 不變 |
| `cressetide/skills/vigil/SKILL.md` | plan 步驟接 scan＋pre-gate 治理；post-approval 序列 |
| `cressetide/skills/vigil/references/task-contract.md` | machine block 由 store 導出、derivation 時序（§8） |
| `cressetide/skills/vigil/references/review-packet.md` | packet 增列 §10 四項 |
| `cressetide/skills/vigil/references/reviewer-common.md` | governance-ruling contract 的共用引用（各 discipline 不自行發明格式） |
| `docs/runtime-contract.md` | **state-class 正式住所**：provenance.json＝committed semantic state；pending-governance＝per-run scratch |
| `cressetide/skills/vigil/references/runtime-policy.md` | 補 single-writer 邊界，不承載 state-class |
| `cressetide/agents/navigator.agent.md` | 澄清：僅 Stage A，不執行 scan |
| `cressetide/agents/intent-reviewer.agent.md` | pre-gate 分類與 scope-coverage proposal、ask 擬題 |
| `cressetide/agents/arbiter.agent.md` | pending 清零＋INV＋terminal state 讀 store 驗證 |
| `cressetide/skills/vigil/scripts/run-ledger.mjs` ＋ `references/run-ledger.md` | `intentScan` 欄位 |

## 13. 驗收條件

1. **綠地訂閱**：material forks 全數於 gate 前進 ask batch；零 caller 不影響判定。
2. **顯示名稱**：唯一性、歷史顯示 → Ask；冷卻期 → `ASSUM(intent, governedBy=intent)`。
3. **demo1 webhook**：`no-applicable-dimension` 或全 resolved；不標 trivial；panel 不縮。
4. **Fresh clone**：`@src REQ-<id>` 測試可解析完整 provenance chain。
5. **Row 7 checkpoint**：`pendingReview` 未裁決時受影響實作未開始。
6. **Exception 前移**：scope ruling 於 pre-gate 取得；無 DP-bound `scopeCovers=true` 不得走 row 1。
7. **高風險路徑**：Stage A=navigator、scan=main thread，不重複。
8. **Contract derivation**：只取 manifest 可達的 active clause；`behaviorChanging`／`verification` 保留；歷史條款不滲入；skip-scan AC 仍為 REQ。
9. 機械可驗：ledger `intentScan` entry；plan 文本含 scan 節；plan 階段零 store 寫入。
10. **初次 outcome 無 Transition**；reopen 替換才有 Transition(subject=舊 clause)。
11. **plan-gate record 限 supersede**：非 supersede task 全程不建立；row 3 三欄完整。
12. **Pre-gate false 路徑**：scope ruling 於 pre-gate 判 `false` → Ask 完成後才出現可核准的 plan。
13. **Merge reconciliation**：兩 branch 同 clause 各建 Transition → 任一 loader fail-closed。
14. **Product-tradeoff re-gate**：row-7 回報產品取捨 → 重新進 plan gate，不建 DEC／REQ 直接實作。
15. **同一 schema**：每個 discipline 對同一 Governance Packet 產出同一 ruling schema。
16. **Writer 拒絕**：CAS mismatch、immutable mutation、同 subject 雙 Transition 皆拒寫。
17. **Contract 時序**：row-7 產生的 ASSUM 出現在最終 contract assumptions，且 contract 寫入早於 implementer 開工。

## 14. 邊界與非目標

- 不動 test tag／contract-check／test-reviewer（test-provenance spec）。
- 不削弱 `verification-gate.md` 紅→綠。
- 不新增 reviewer pass；pre-gate 分類／scope call 與 row-7 checkpoint 都是上游本就要求的裁決，條件執行、read-only proposal，寫 store 永遠是 main thread。
- **Partial contract 明文排除於 v1**：要恢復並行，須另立 partial-contract 版本與更新規則的 spec 變更。
- 語義判斷明文不宣稱機械保證：DP 同一性（§9）、受影響範圍判定（§6）、layer 初判（§4）；loader 只證 snapshot 一致性（§8）。
