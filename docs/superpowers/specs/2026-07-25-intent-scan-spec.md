# Intent-Scan Implementation Spec

- 狀態：draft v0.6 —— 五輪修訂（create-requirement、fingerprint 收斂判準與 gate lock、packetDigest 新鮮度、re-gate 重入 fixed point、binding-policy 需既存 binding authority、classificationBasis 型別回歸）；審閱中
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

## 3. 執行位置（plan 階段 read-only）

**scan 的執行者一律是 main thread** —— 它需要 AskUserQuestion、需求整合與 plan gate，這些職責 navigator 不能擁有（`plan-grounding.md` 既有分工）：

| 風險 | Stage A（code grounding） | intent scan |
|---|---|---|
| 低／中 | 不執行（既有規則不變） | main thread inline，於 `SKILL.md` plan 步驟起草時順做 |
| 高／correctness-critical | **navigator**（既有 Stage A，不變） | **main thread** 於既有 **Stage B** 執行；Stage A 輸出作為證據輸入，同次完成不重複 |

除既有 Stage A navigator 外，本 spec 於 plan 階段新增的唯一 subagent 呼叫是 §4 的 **conditional pre-gate intent-reviewer call**（read-only proposal，不寫 store）。與 `hooks/plan-gate.js` 相容：plan 階段零 store 寫入；一切落檔在 post-approval（§6）。

## 4. 七維度協定、ID 預鑄與 pre-gate 收斂迴圈

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

**ID 預鑄（plan mode 不寫 store，但 ID 已是 final）**：

```
plan mode：main thread 在記憶中預鑄 DP 的 final ULID；
           Governance Packet 與 plan 文本一律使用該 final ID
post-approval：init-task 接受並持久化同一批預鑄 ID，不重新鑄造
```

這讓 pre-gate ruling 的 `subjectRef` 從一開始就綁定到最終持久化的那個 DP。**迴圈中被消除的預鑄 DP 及其 proposal 一律不得落檔。**

**Proposal 新鮮度（packetDigest）** —— ID 綁定只保證「同一個 DP」，不保證「內容沒變」：Ask 回答可修改 `scenario`／`alternatives`，同一 ULID 的舊 classification／scope proposal 會在只驗 subjectRef 時蒙混過關。因此 Governance Packet、proposal 與落檔 ruling **三者都帶 `packetDigest`**（對 packet 的裁決相關欄位正規化後取 sha256）：

```
main thread 只接受 packetDigest == 目前 canonical packet 的 proposal；
任何影響裁決的欄位變動 → 舊 proposal 失效 → 重出 ruling
```

**Pre-gate 收斂迴圈（conditional、read-only、直到 fixed point）**：

```
iterate:
  1. scan／rescan（首輪全量；後續只重算受回答影響的維度與 DP）
  2. pre-gate governance call —— 僅針對「未分類 DP」∪「exception-backed row-1 候選」，
     一次 intent-reviewer call 帶回：
       layer-classification proposals（classifiedLayer＋basis）
       scope-coverage proposals（scopeCovers=true|false，明示，DP-bound）
  3. routing（layer 決定 row 6 或 row 7；scopeCovers 決定 row 1 或 row 2）
  4. Ask batch（rows 2／4／6）
  5. 依回答更新：alternatives／scenario 修訂、DP 新增或消除、
     新取得 exception → 標記需 scope ruling、layer 依據改變 → 標記需重新分類
  6. 仍有「未分類 ∨ 待 scope ruling ∨ 未問」→ goto 1（只重算受影響部分）
fixed point → ExitPlanMode
```

**收斂判準：state fingerprint，不用集合大小** —— 數量不是 progress metric（例：Ask 取得 exception 後下一輪才需 scope ruling，此時未決 DP 數不減、也無新 DP，但這是**合法進展**）。

```
fingerprint(state) ＝ 對下列內容正規化後取雜湊：
  每個 live DP 的 { id、scenario、alternatives、layer、classificationBasis、
                   pending flags（未分類／待 scope ruling／未問／pendingReview）、
                   適用的 binding clause 與 exception 集合 }
  ＋ 已回答問題集合（question → answer）

fingerprint 與上一輪不同        → 有進展，繼續
fingerprint 與任何前輪重複      → 打轉 → converged=false
達 iteration cap（預設 8，揭露） → converged=false
```

**`converged=false` 是 gate lock，不只是揭露**：

```
converged=false ⇒ 禁止 ExitPlanMode、禁止 contract derivation、implementer 不得開工
使用者提供新裁決時 → 記為該 DP 的問答結果並**重入迴圈**
                    （post-approval 才固化為 user-answer record）
單純核准 plan **不構成** DP 的解決 —— 一般核准不是 user-answer record
```

不會死鎖：使用者的新裁決或**明示延後**（→ ASSUM＋user-ack）都是合法答案，兩者都能讓該 DP 離開未決集合。ledger 記 `preGateIterations` 與 `converged`。

Proposal 在 plan mode 只存在於 plan 文本；核准後才由 main thread 固化（§6 步驟 1）。**核准後不存在「回頭 Ask」的 scope 路徑** —— 這正是前移的目的。

## 5. Routing 執行（上游 §5 逐 DP）

- **row 1（一般 binding clause）**：cite 進 plan。
- **row 1（exception-backed REQ）**：需 §4 pre-gate 的 DP-bound `scopeCovers=true` proposal；`false` → row 2（迴圈內 Ask）；無 proposal 不得走 row 1。
- **rows 2／4／6（Ask）**：全部收進 ask batch，**於 gate 前完成**。`AskUserQuestion` 每輪 ≤4 題：header=dimension、選項=alternatives（各附一行 scenario 摘要）；超過 4 題分輪，ask-tagged 一題不減。
- **row 5（safeToAssume）**：ASSUM，`governedBy` 依上游固定映射。
- **row 7（¬safe ∧ implementation）**：plan 揭露候選＋annotation `pendingReview: <discipline>`（discipline 依 §6 routing table）；裁決依 §6 checkpoint，**受影響實作在 outcome active ∧ applicable 前不得開始**。

## 6. Post-approval 序列（single-writer；implementer 最後才進場）

```
1. main thread 落檔（一律經 §8 store script）：
   init-task（持久化預鑄 taskId 與 DP ID）、Sources（需求固化）、本 task DP、
   pre-gate ask 回答 → user-answer records → 新 REQ（create-initial-outcome）、
   明示延後 → ASSUM＋user-ack、row 5 → ASSUM、
   pre-gate 的 layer-classification 與 scope-coverage proposals → **各建 review-ruling record**
   （`DP.classificationRulingRef`／`DP.scopeRulingRef` 指向之；上游的
   `DP.classificationBasis` **維持人可讀理由**，不改型別）。
   一般核准是流程事件，不建 RecordRef；plan-gate record 僅 row 3 supersede proposal。
2. 存在 pendingReview DP —— row-7 checkpoint（上游四分逐支）：
   spawn 對應 discipline reviewer（Governance Packet）→ ruling proposal →
   main thread 依 rulingKind 固化：
     binding-policy       → Source＋REQ＋resolve（單一 create-initial-outcome transaction）
     technical-decision   → DEC → decided
     approved-provisional → ASSUM → assumed
     product-tradeoff     → reclassify-dp（layer=intent；classificationBasis 更新為人可讀
                            理由，classificationRulingRef 指向該 ruling）
                            → 回 row 6 Ask → **重入 §4 fixed-point 迴圈**（回答仍可能新增 DP、
                            取得 exception、或改變其他 DP 的分類／scope）
                            → 收斂後才 **重新 ExitPlanMode** → 核准後 resume-task
                            → 新核准前受影響實作保持鎖定
   初次（open DP）不建 Transition；reopen 替換既有 terminal 走 replace-terminal transaction。
3. pending 清零（含 product-tradeoff 的重新核准完成）
   → 由 final currentTaskDpIds 導出 contract.md（§8 規則）
   → implementer 才開始實作。
```

**v1 不做 partial contract**：不允許「無關工作先行」——並行需要 partial-contract 版本與更新規則，複雜度不值得；治理完成 → contract 一次導出 → 實作開始。

### Governance-ruling contract（`references/governance-ruling.md`）

所有 discipline 同一 schema；orchestrator 統一組裝 packet，reviewer 不自行決定寫哪種物件。

```
輸入（Governance Packet）：
  packetDigest（裁決相關欄位的正規化雜湊）、DP id（final ULID）、scenario、alternatives、
  layer＋classificationBasis、materialReasons、basisRefs／relevant Sources、requested discipline

輸出（ruling proposal）：
  by: ReviewerPrincipal          必須 == requested principal
  subjectRef: DP id              必須 == packet.DP
  packetDigest                   必須 == 目前 canonical packet（§4 新鮮度）
  rulingKind: 下表六選一
  basis
  ＋ 依 rulingKind 的必填 payload：
    binding-policy       bindingSourceRef（見下，須為**既存 binding authority**）、
                         clauseText、authority（由該 binding authority 衍生）
    technical-decision   selectedAlternative
    approved-provisional selectedAlternative、rejectedAlternative、basis
    product-tradeoff     productQuestion、alternatives
    scope-coverage       scopeCovers: boolean
    layer-classification classifiedLayer
```

Payload 缺項、`by`／`subjectRef`／`packetDigest` 不符 → **fail-closed，退回重出 ruling**。`scope-coverage`／`layer-classification` 由 §4 pre-gate 消費；其餘四種由步驟 2 消費。

**`binding-policy` 的 authority 驗證（防 observational 升格）** —— 「有來源」不等於「有權威」：

```
bindingSourceRef 必須解析到**既存 binding authority**：
  active 的 hard-constraint／approved-requirement／compatibility clause，
  或既有核准來源的 Source
  —— 僅「可解析的 Source」不足（repo 內未核准的 policy 檔不算）
authority 必須由該 binding authority 衍生，**不得 reviewer 自填**
authority=approved-requirement 只能源自既有核准來源，或 user／plan-gate
找不到既存 binding authority → **不得回 binding-policy**，
  只能落 technical-decision／approved-provisional／product-tradeoff
```

observational → binding 的唯一路徑仍是上游 §1：plan gate 核准的 compatibility clause，一次一條。

### Row-7 discipline routing table（closed）

| DP 的主要 concern | discipline |
|---|---|
| trust boundary、authn/authz、secrets、注入、加密參數 | security |
| runtime 行為、部署、rollback、resilience、可觀測性 | operability |
| 跨元件結構、分層、相依方向 | architecture |
| UI 實作語義 | ui-ux |
| 其餘 implementation fork | code |
| 命中 ≥2 且裁決可能衝突 | **arbiter** |

`test` 與 `intent` 不出現在本表：`test` 治理的是斷言蘊含（上游 §11），`intent` 依定義不會走到 row 7（那是 layer=intent）。

## 7. Plan gate 接線

ExitPlanMode 的 plan 內容新增 intent-scan 節：維度 applicability 一覽、resolved citations（含 scope-coverage 判定與依據）、layer 分類揭露、ask 問答結果、ASSUM 清單（text＋alternative）、`pendingReview` 清單與候選、沿用清單（§9）、迴圈收斂情形（未收斂時含卡住的 DP）、或 `no-applicable-dimension`／`skipped-no-observable-change` 宣告。一般核准是流程事件，不鑄造 RecordRef。

## 8. 產物：provenance store（shared infrastructure）

| 檔案 | 分類 | 內容 |
|---|---|---|
| `.ctide/provenance.json` | **tracked canonical semantic state（committed）** | sources／clauses／transitions／records／DPs —— 與引用它們的程式／測試一起提交；fresh clone／CI 必須能解析完整 chain |
| `.ctide/output/pending-governance.json` | per-run scratch（untracked） | task manifest（taskId＋currentTaskDpIds）、預鑄 ID、pending annotations、intentScan snapshot |
| ledger | 既有分類不變 | 觀測 telemetry（§11） |

- **ID**：`<PREFIX>-<ULID>`，plan mode 預鑄、post-approval 持久化同一批。**ULID 只保證新 object id 不碰撞，不簡化 Git merge**：不同 id 的 immutable 物件可自動 set-union；同 subject 多 Transition、同 DP 不同 outcome、同 id 不同 payload **必須 fail-closed reconciliation**。

### Store script（新增 `scripts/provenance-store.mjs`；main thread 不得徒手 Edit tracked JSON）

命令面全部是 **domain transaction** —— 沒有能製造懸空 DP 的裸操作：

```
validate                  唯讀：refs＋Transition matrix＋INV-1..4＋merge reconciliation
init-task                 持久化預鑄 taskId 與 DP ID（首次核准）
resume-task               沿用既有 taskId／currentTaskDpIds（product-tradeoff re-gate 後）：
                          可加入該輪新預鑄的 final DP ID；**不刪除／不重寫**已持久化物件；
                          原 persisted DP 必須取得 terminal outcome 或合法明示延後，
                          不得因回答而「消失」
append-source             immutable Source（不被 DP terminal ref 引用，可獨立）
append-record             immutable Record（同上）
create-requirement        **DP 無關**的 REQ（plan-approved AC；kind=acceptance｜specification）
                          ＋`taskRef`；可同一交易攜帶其 Source。
                          不設 DP terminal、不建 Transition ——
                          零 DP／skip-scan task 的唯一合法 AC 建立路徑
create-initial-outcome    open DP → clause＋terminal ref（**不建 Transition**）；
                          可同一交易攜帶必要 Source／Record（如 binding-policy）
replace-terminal          successor＋Transition(subject=舊 terminal)＋
                          **所有**引用該 terminal 的 DP repoint／reopen
supersede-requirement     replace-terminal 的 row-3 變體：plan-gate witness＋compatibility block
resolve-exception         exception-grant Source＋REQ＋scope ruling record＋DP resolve
reclassify-dp             DP.layer＋classificationBasis（指向 layer-classification ruling）
reopen-dp                 記錄 closed trigger 的 reopen
```

**移除**裸 `append-clause`／`append-transition`／`set-dp-outcome` —— 它們無法在不違反 INV-4 的前提下單獨完成 terminal replacement。

每個命令是**一筆交易**：

```
load＋validate → 記錄原檔 digest → 在記憶體套用該交易的全部變更
→ 驗 **final snapshot**（refs＋Transition matrix＋INV-1..4；不驗中間態）
→ CAS（原檔 digest 未變）→ 同目錄 temp write＋atomic replace
```

- 中途狀態永不落盤，因此外部觀察者看不到部分套用的 terminal replacement。
- Writer 拒絕：immutable object 修改、同 subject 第二個 Transition、CAS mismatch、payload 缺項。
- **Loader 誠實邊界**：只驗 snapshot 內部一致性，**不能靠單次載入證明歷史從未被改寫**；跨 commit 的 immutable-mutation 檢查由 test-provenance gate 補。

### Contract derivation

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

- **非-intent AC 不消失**：skip-scan task 的 plan-approved AC 一律仍建 REQ(kind=acceptance)，sourceRef 指固化需求 Source —— 經 `create-requirement` 交易（零 DP task 亦適用）。
- **時序**：contract.md 於 §6 步驟 3（pending 清零後）由 main thread 一次導出，**早於 implementer**；implementer 不再手寫 machine block。

## 9. 沿用與 reopen

scan 開始前先讀 tracked store：同一 DP 已有 active 且 applicable outcome 且無 reopen trigger → **必須沿用 cite，不重問**；沿用 DP 計入 manifest。reopen 依 closed trigger list，重入記 `reopenedBy`；intent fork 重入重經 plan-gate routing。DP 同一性判定是語義判斷 —— main thread 判、plan 揭露、使用者可推翻；機械層不宣稱。

## 10. Review Packet 與 arbiter 接線

`references/review-packet.md` 增列 packet 必帶：store path、`currentTaskRef`（==manifest.taskId）、本 task 相關 DP／clause／record id 清單、pending governance 現況。Writer 協定：**reviewer 產生 ruling proposal → main thread 經 store script 固化 ruling＋outcome，僅替換既有 terminal 時建立 Transition → arbiter 讀 store 驗 terminal state**（pending 清零、INV-1..4、terminal ref active ∧ applicable）。

## 11. Run ledger 觀測（非 gate，一 run 一 record）

scan／checkpoint 階段把 snapshot 寫入 **pending-governance scratch**，不提前 append；既有「verdict locked 後 append 單一 run record」時點**無條件**把 snapshot 帶入該筆 record（**不受報告格式 sentinel 成敗影響** —— failmem 教訓保留，一 run 一 record 也保留）：

```
intentScan: {
  outcome: completed | no-applicable-dimension | skipped-no-observable-change,
  dpCounts: { byLayer, byStatus, byDiscoveredAt, reopened },
  askCount, assumeCount,
  detectedPendingReviewCount,   // 發現時
  finalPendingReviewCount,      // 收尾時；READY 應為 0
  scopeRulings: { true: n, false: n },
  preGateIterations, converged, reGateRounds,
  staleProposalRejections,
  otherDimensionUsed: bool
}
```

觀測值永不當 gate；數字上升可能是偵測變好（上游 §10）。

## 12. 修改檔案清單

| 檔案 | 變更 |
|---|---|
| `cressetide/skills/vigil/references/intent-scan.md` | **新增** —— §2–§7、§9 協定本體（plugin 慣用英文） |
| `cressetide/skills/vigil/references/governance-ruling.md` | **新增** —— Governance Packet、per-rulingKind payload、discipline routing table |
| `cressetide/skills/vigil/scripts/provenance-store.mjs`（＋tests） | **新增** —— §8 domain transaction 命令面、CAS、atomic write、invariant validation |
| `cressetide/skills/vigil/references/reviewer-selection.md` | intent-scan 觸發與風險脫鉤；Stage A 維持 high-risk gated |
| `cressetide/skills/vigil/references/plan-grounding.md` | Stage B（main thread）引用 intent-scan 協定；Stage A 不變 |
| `cressetide/skills/vigil/SKILL.md` | plan 步驟接 scan＋pre-gate 迴圈；post-approval 序列 |
| `cressetide/skills/vigil/references/task-contract.md` | machine block 由 store 導出、derivation 時序（§8） |
| `cressetide/skills/vigil/references/review-packet.md` | packet 增列 §10 四項 |
| `cressetide/skills/vigil/references/reviewer-common.md` | governance-ruling contract 的共用引用 |
| `docs/runtime-contract.md` | **state-class 正式住所**：provenance.json＝committed semantic state；pending-governance＝per-run scratch |
| `cressetide/skills/vigil/references/runtime-policy.md` | 補 single-writer 邊界，不承載 state-class |
| `cressetide/agents/navigator.agent.md` | 澄清：僅 Stage A，不執行 scan |
| `cressetide/agents/intent-reviewer.agent.md` | pre-gate 分類與 scope-coverage proposal、ask 擬題 |
| `cressetide/agents/arbiter.agent.md` | pending 清零＋INV＋terminal state 讀 store 驗證 |
| `cressetide/skills/vigil/scripts/run-ledger.mjs` ＋ `references/run-ledger.md` | `intentScan` 欄位、由 scratch snapshot 帶入單一 run record |

## 13. 驗收條件

1. **綠地訂閱**：material forks 全數於 gate 前進 ask batch；零 caller 不影響判定。
2. **顯示名稱**：唯一性、歷史顯示 → Ask；冷卻期 → `ASSUM(intent, governedBy=intent)`。
3. **demo1 webhook**：`no-applicable-dimension` 或全 resolved；不標 trivial；panel 不縮。
4. **Fresh clone**：`@src REQ-<id>` 測試可解析完整 provenance chain。
5. **Row 7 checkpoint**：`pendingReview` 未裁決時受影響實作未開始。
6. **Exception 前移**：scope ruling 於 pre-gate 取得；無 DP-bound `scopeCovers=true` 不得走 row 1。
7. **高風險路徑**：Stage A=navigator、scan=main thread，不重複。
8. **Contract derivation**：只取 manifest 可達的 active clause；`behaviorChanging`／`verification` 保留；歷史條款不滲入；skip-scan AC 仍為 REQ。
9. 機械可驗：plan 文本含 scan 節；plan 階段零 store 寫入。
10. **初次 outcome 無 Transition**；reopen 替換才有 Transition(subject=舊 clause)。
11. **plan-gate record 限 supersede**：非 supersede task 全程不建立；row 3 三欄完整。
12. **Pre-gate false 路徑**：scope ruling 於 pre-gate 判 `false` → Ask 完成後才出現可核准的 plan。
13. **Merge reconciliation**：兩 branch 同 clause 各建 Transition → 任一 loader fail-closed。
14. **Product-tradeoff re-gate**：先 `reclassify-dp` 到 `layer=intent` 才回 row 6；重新核准後走 `resume-task`，**沿用同 taskId**，不重建既有 Source／DP／ruling。
15. **同一 schema**：每個 discipline 對同一 Governance Packet 產出同一 ruling schema；`by`／`subjectRef` 與 packet 相符。
16. **Writer 拒絕**：CAS mismatch、immutable mutation、同 subject 雙 Transition、payload 缺項皆拒寫。
17. **Contract 時序**：row-7 產生的 ASSUM 出現在最終 contract assumptions，且 contract 寫入早於 implementer 開工。
18. **交易原子性**：`replace-terminal` 對多個引用 DP 只做**一次** atomic commit；中途狀態不可見（並行 loader 只會看到套用前或套用後）。
19. **ID 同一性**：pre-gate proposal 的 `subjectRef` 與 post-approval 持久化的 DP 是同一個 ULID。
20. **迴圈收斂**：Ask 新增 exception 後會重新取得 scope ruling，再進 ExitPlanMode；**該輪未決 DP 數不減也無新 DP，仍須判為合法進展**（fingerprint 已變）。
21. **binding-policy fail-closed**：proposal 缺 payload 時退回重出；**repo 內存在未核准的 policy 檔時不得據以建立 REQ**，只能落 DEC／ASSUM／product-tradeoff。
22. **Ledger 單筆**：`intentScan` 只出現在最終那筆 run-ledger record，不提前建立半成品；且不因報告格式 sentinel 缺失而遺漏。
23. **零 DP task**：skip-scan、零 DP、一條 plan-approved AC 的 task 可經 `create-requirement` 建立 `REQ(kind=acceptance)`，並出現在導出的 contract `acceptanceCriteria`。
24. **Gate lock**：`converged=false` 時 ExitPlanMode、contract derivation、implementer 全部被鎖；使用者新裁決重入迴圈後才解鎖，單純核准 plan 不解鎖。
25. **Proposal 新鮮度**：Ask 修改 `scenario`／`alternatives` 後，舊 classification／scope proposal 因 `packetDigest` 不符被拒，重出後才落檔；被消除的預鑄 DP 及其 proposal 不落檔。
26. **classificationBasis 型別**：`DP.classificationBasis` 維持人可讀理由（上游語義不變），ruling 由 `classificationRulingRef` 承載並驗 `by`／`subjectRef`／`packetDigest`。

## 14. 邊界與非目標

- 不動 test tag／contract-check／test-reviewer（test-provenance spec）。
- 不削弱 `verification-gate.md` 紅→綠。
- **scan 本身不新增 unconditional pass**；治理 call（pre-gate 分類／scope、row-7 裁決）僅在對應 DP 存在時條件執行，且均為 read-only proposal —— 寫 store 的永遠是 main thread。
- **Partial contract 明文排除於 v1**：要恢復並行，須另立 partial-contract 版本與更新規則的 spec 變更。
- 語義判斷明文不宣稱機械保證：DP 同一性（§9）、受影響範圍判定（§6）、layer 初判（§4）；loader 只證 snapshot 一致性（§8）。
