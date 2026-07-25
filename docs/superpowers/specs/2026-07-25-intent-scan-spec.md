# Intent-Scan Implementation Spec

- 狀態：draft v1.0-rc —— 九輪修訂（deferred reopen 的 prior-terminal CAS 模式、DEC／ASSUM postcondition 機械化、驗收與 inputPacketDigest 契約對齊）；審閱中
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

**Proposal 新鮮度（`inputPacketDigest`）** —— ID 綁定只保證「同一個 DP」，不保證「內容沒變」：Ask 回答可修改 `scenario`／`alternatives`，同一 ULID 的舊 proposal 會在只驗 subjectRef 時蒙混過關。但 digest **不能拿去比對 mutable 的 current packet** —— `layer-classification`／`product-tradeoff` ruling 套用後正是會改動 `layer`／`classificationBasis`，而這兩欄在 payload 內，比對當場自我失效；DP 日後 reopen 也不該讓歷史 ruling 變成 stale。因此按時間分離：

```
inputPacketDigest ＝ reviewer 收到的 **immutable pre-state packet** 的 digest
proposal 回傳 inputPacketDigest
main thread **在 mutation 之前** 比對 inputPacketDigest == 當下 canonical packet
  相符 → 套用；不符 → 舊 proposal 失效 → 重出 ruling
落檔 ruling record 保存：canonical input packet snapshot ＋ 其 digest ＋ ruling output
```

**Loader 驗證（套用後，不再碰 current packet）**：

```
對 ruling record 內的 snapshot 重算 digest（自洽，immutable）
驗 subjectRef／by
依 **per-rulingKind postcondition table**（§6）驗 current DP 的對應欄位
**不**把歷史 inputPacketDigest 與 mutable current packet 比較
歷史 ruling（已不再被任何 current ref 引用）**只驗 snapshot／digest 自洽**，不與 current DP 比較
```

**Canonical payload（closed set；本 spec 唯一的「影響裁決欄位」清單）**：

```
DP id、scenario、alternatives、layer、classificationBasis、
materialReasons、requestedPrincipal（ReviewerPrincipal）、
basisRefs 正規化為 [(sourceId, digest) | RecordRef | ObservationalRef 描述]
排除：digest 欄位自身
```

**Canonical encoding（不同 writer 必須算出同一 digest）**：UTF-8 無 BOM、換行 LF、object key 依 Unicode code point 排序、無多餘空白、字串不 trim；`digest ＝ sha256(canonical JSON)`。**Array 逐欄定序**（「builder 自行確定性」不足以讓兩個獨立 writer 一致）：

| array | 定序規則 |
|---|---|
| `alternatives` | **保留語義順序**（讀法 A／B 的先後有意義） |
| `materialReasons` | 依 safeToAssume conjunct 的 closed enum 宣告序 |
| `basisRefs` | 依 `kind` → `sourceId`／`ref`／ObservationalRef 描述字串 排序 |
| 適用 binding／exception clause 集合 | 依 clause id 排序 |

§4 收斂 fingerprint 直接由這份清單導出 —— **不維護第二套欄位清單**。

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
fingerprint(state) ＝ 雜湊(
  sorted( 每個 live DP 的 **current** packet digest ＋ 其 routing／pending state
          （row 判定、未分類／待 scope ruling／未問／pendingReviewPrincipal、
            適用的 binding clause 與 exception 集合） )
  ＋ normalized 問答集合（question → answer）
)
```

current packet digest 已涵蓋 scenario／alternatives／layer／classificationBasis／**materialReasons**／
**basisRefs（sourceId＋digest）**／**requestedPrincipal** —— 新證據改變 materiality 而 DP 數與
scenario 不變的情形因此會被正確判為有進展。（fingerprint 用的是**當下**狀態，與 ruling 保存的
歷史 `inputPacketDigest` 是不同時間點的兩個值，互不比較。）

**Convergence epoch（讓「不會死鎖」形式成立）**：

```
fingerprint 與本 epoch 內任何前輪重複 → 打轉 → converged=false
本 epoch 迭代數達 cap（預設 8，揭露）  → converged=false
使用者於 converged=false 後提供新裁決 → **開新 epoch**：
    重置本 epoch 的 fingerprint history 與 iteration budget
    （總迭代數仍累加進 ledger）
```

cap 若是全域的，重入後會立刻再次 `converged=false`；per-epoch 才讓使用者的新裁決真正解鎖。

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

- **row 1（一般 binding clause）**：cite 進 plan；落檔走 `adopt-existing-outcome`（§8）—— 不建 clause、不建 Transition。
- **row 1（exception-backed REQ）**：需 §4 pre-gate 的 DP-bound `scopeCovers=true` proposal；`false` → row 2（迴圈內 Ask）；無 proposal 不得走 row 1。落檔同走 `adopt-existing-outcome`，**同交易攜帶 scope ruling record 與 `scopeRulingRef`**。
- **rows 2／4／6（Ask）**：全部收進 ask batch，**於 gate 前完成**。`AskUserQuestion` 每輪 ≤4 題：header=dimension、選項=alternatives（各附一行 scenario 摘要）；超過 4 題分輪，ask-tagged 一題不減。
- **row 5（safeToAssume）**：ASSUM，`governedBy` 依上游固定映射。
- **row 7（¬safe ∧ implementation）**：plan 揭露候選＋annotation `pendingReviewPrincipal`（依 §6 routing table 回傳的 ReviewerPrincipal）；裁決依 §6 checkpoint，**受影響實作在 outcome active ∧ applicable 前不得開始**。
- **reopened DP 的 row 1**：current terminal 仍 active 時**不得**走 `adopt-existing-outcome`（該路徑不建 Transition，會把舊 DEC／ASSUM 留成 active、違反 lifecycle 收斂）；改走 `replace-terminal`（successor＝該既存 clause，`expectedCurrentTerminalRef`＝scratch `pendingReopen` 記下的 terminal）。plan 階段**不預先 reopen canonical DP**。

## 6. Post-approval 序列（single-writer；implementer 最後才進場）

```
1. main thread 落檔（一律經 §8 store script）：
   init-task（持久化預鑄 taskId 與 DP ID）、Sources（需求固化）、本 task DP、
   pre-gate ask 回答 → user-answer records → 新 REQ（create-initial-outcome）、
   明示延後 → ASSUM＋user-ack、row 5 → ASSUM、
   pre-gate 的 layer-classification 與 scope-coverage proposals → **各建 review-ruling record**
   （`DP.classificationRulingRef`／`DP.scopeRulingRef` 指向之；上游的
   `DP.classificationBasis` **維持人可讀理由**，不改型別）。
   一般核准仍是流程事件、**不建 RecordRef**。plan-gate record 的鑄造時機是
   **「row 3 supersede proposal，或上游 Transition matrix 明文要求 user authority 的
   任何 clause transition」**（例：ASSUM／DEC supersede → REQ）：
     已有指向該 DP 的明示 user-answer → 以它作 witness，不另建 plan-gate record；
     否則 → plan 必須**具名揭露 subject → successor**，核准後建立 target == subject 的
            plan-gate witness（impact／disposition 描述以該 successor 取代原
            provisional／decided outcome 的效果）。
   （v0.8 的「僅 row 3」是本 spec 的過度收窄 —— 上游 witness binding 本就涵蓋這些
   transition；此處修正下游，不動上游。）
2. 存在 pendingReviewPrincipal DP —— row-7 checkpoint（上游四分逐支）：
   spawn 對應 discipline reviewer（Governance Packet）→ ruling proposal →
   main thread 依 rulingKind 固化：
     binding-policy       → **adopt-existing-outcome**（指向既存 active ∧ applicable REQ）；
                            v1 不從非-clause 外部 policy 鑄造新 REQ（見下方收窄說明）
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
輸入（Governance Packet；immutable pre-state snapshot）：
  inputPacketDigest（canonical payload 的雜湊，§4）、DP id（final ULID）、scenario、alternatives、
  layer＋classificationBasis、materialReasons、basisRefs／relevant Sources、
  **requestedPrincipal: ReviewerPrincipal**（discipline 或 arbiter）

輸出（ruling proposal）：
  by: ReviewerPrincipal          必須 == requestedPrincipal
  subjectRef: DP id              必須 == packet.DP
  inputPacketDigest              main thread 於 **mutation 前** 比對當下 canonical packet（§4）
  rulingKind: 下表六選一
  basis
  ＋ 依 rulingKind 的必填 payload：
    binding-policy       bindingClauseRef（見下，須為**既存 REQ**）
    technical-decision   selectedAlternative
    approved-provisional selectedAlternative、rejectedAlternative、basis
    product-tradeoff     productQuestion、alternatives
    scope-coverage       scopeCovers: boolean
    layer-classification classifiedLayer
```

Payload 缺項、`by`／`subjectRef`／`inputPacketDigest` 不符 → **fail-closed，退回重出 ruling**。`scope-coverage`／`layer-classification` 由 §4 pre-gate 消費；其餘四種由步驟 2 消費。

**`binding-policy` 的 v1 收窄（防 observational 升格）** —— 「有來源」不等於「有權威」。上游 Source schema 只有 `contentKind`／`driftMode`，**沒有 approval 狀態或 approval witness**，因此「已核准的來源」在機械上無法判定；若允許它衍生 REQ，reviewer 或 main thread 可自稱成立，等於在上游唯一合法路徑旁另開一道門。v1 因此收窄為：

```
bindingClauseRef 必須解析到**既存 REQ**，且
  status=active ∧ applicable(current DP) ∧ 與其他 binding clause 無衝突
→ 走 adopt-existing-outcome，**不另鑄 REQ**
（僅「可解析的 Source」不足；repo 內未核准的 policy 檔不算權威）

找不到符合的既存 REQ → **不得回 binding-policy**，
  只能落 technical-decision／approved-provisional／product-tradeoff
```

observational → binding 的唯一路徑仍是上游 §1：plan gate 核准的 compatibility clause，一次一條。

**已揭露的上游子分支收窄**：上游 §5 row 7 的「政策固化為 Source＋新 REQ cite 之」在 v1 只實作「政策已 clause 化」這個可機械驗證的子集。要支援從尚未 clause 化的外部 policy 鑄造 REQ，**必須先在 shared model 定義 typed authority witness**（類似 hard-constraint 的 `ownerRef`）；下游 spec 不得自行發明。在該 witness 存在前，此類 fork 走 DEC／ASSUM／product-tradeoff。

### Per-rulingKind postcondition table（closed；loader 套用後驗證的對象）

| rulingKind | 套用後必須成立 |
|---|---|
| `layer-classification` | `DP.layer == classifiedLayer`、`DP.classificationBasis == basis`、`DP.classificationRulingRef == record` |
| `product-tradeoff` | `DP.layer == intent`、`DP.classificationBasis == basis`、`DP.classificationRulingRef == record` |
| `scope-coverage`（true 且被採用） | `DP.scopeRulingRef == record` |
| `technical-decision` | `DP.decidedBy == DEC.id`、`DEC.derivedFrom == DP.id`、`DEC.decision == ruling.selectedAlternative`、`DEC.alternatives == inputPacketSnapshot.alternatives`、`DEC.approvedBy == ruling.by`、`DEC.basisRefs` 含本 ruling record |
| `approved-provisional` | `DP.assumedAs == ASSUM.id`、`ASSUM.derivedFrom == DP.id`、`ASSUM.text == ruling.selectedAlternative`、`ASSUM.alternative == ruling.rejectedAlternative`、`ASSUM.basis == ruling.basis`、`ASSUM.governedBy == ruling.by`、`ASSUM.basisRefs` 含本 ruling record |
| `binding-policy` | `DP.resolvedBy == bindingClauseRef` |

`product-tradeoff` 的 payload 不含 `classifiedLayer`，但套用時必然觸發 `reclassify-dp(layer=intent)` —— 本表把該隱含後果寫成機械可驗的條件。`scope-coverage=false` 不改動 DP terminal，僅作為 row 2 的依據留存。

`technical-decision`／`approved-provisional` 的條件刻意展開成 **schema 欄位比對**：「由此 ruling 建立」不是可查的欄位，只寫那句話等於允許把任意 DEC／ASSUM 配上一筆合法舊 ruling —— 與 witness 原則（任意合法 record 不可借用）相違。上列每一條都可由 loader 直接比對。

### Row-7 principal routing table（closed；回傳 **ReviewerPrincipal**，不是 discipline）

| DP 的主要 concern | 回傳 principal |
|---|---|
| trust boundary、authn/authz、secrets、注入、加密參數 | `{kind: discipline, discipline: security}` |
| runtime 行為、部署、rollback、resilience、可觀測性 | `{kind: discipline, discipline: operability}` |
| 跨元件結構、分層、相依方向 | `{kind: discipline, discipline: architecture}` |
| UI 實作語義 | `{kind: discipline, discipline: ui-ux}` |
| 其餘 implementation fork | `{kind: discipline, discipline: code}` |
| 命中 ≥2 且裁決可能衝突 | **`{kind: arbiter}`** |

回傳值一路貫穿 `pendingReviewPrincipal`（scratch）→ `requestedPrincipal`（packet）→ `ruling.by`，三者型別同一且必須相等 —— arbiter 路徑因此可完整表示（上游引入 `ReviewerPrincipal` 正為此）。

`test` 與 `intent` 不出現在本表：`test` 治理的是斷言蘊含（上游 §11），`intent` 依定義不會走到 row 7（那是 layer=intent）。

## 7. Plan gate 接線

ExitPlanMode 的 plan 內容新增 intent-scan 節：維度 applicability 一覽、resolved citations（含 scope-coverage 判定與依據）、layer 分類揭露、ask 問答結果、ASSUM 清單（text＋alternative）、`pendingReviewPrincipal` 清單與候選、沿用清單（§9）、迴圈收斂情形（未收斂時含卡住的 DP）、**需 user authority 的 clause transition 之具名 `subject → successor` 揭露**、或 `no-applicable-dimension`／`skipped-no-observable-change` 宣告。一般核准本身是流程事件、不鑄造 RecordRef；上述具名揭露經核准後才於 §6 步驟 1 鑄造 target == subject 的 plan-gate record。

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
create-requirement        **DP 無關**的 REQ（plan-approved AC）。必填：
                            authority = approved-requirement（**僅此值** ——
                              不得經此門建立 hard-constraint 或 compatibility）
                            kind = acceptance | specification
                            text、taskRef、sourceRef（Source 不存在時可同交易建立）
                            kind=acceptance 時另附 annotation REQ.acceptance
                          不設 DP terminal、不建 Transition ——
                          零 DP／skip-scan task 的唯一合法 AC 建立路徑
adopt-existing-outcome    **僅限 initial-open DP**（從未有 terminal，或 priorTerminalRef 所指
                          clause 已非 active、無需再建 Transition）→ **既存** active ∧ applicable
                          clause：設 terminal ref＋status。**不建 clause、不建 Transition**。
                          exception-backed 時同交易攜帶 DP-bound scope ruling record
                          與 `scopeRulingRef`。
                          **reopened DP 且 priorTerminalRef 仍 active → 拒寫**，改走 replace-terminal
create-initial-outcome    open DP → **新** clause＋terminal ref（**不建 Transition**）；
                          可同一交易攜帶必要 Source／Record
replace-terminal          successor（**新鑄或既存 clause 皆可** —— reopened DP adopt 既存 REQ 時
                          走此路）＋Transition＋**所有**引用該 terminal 的 DP repoint／reopen。
                          payload 必含 **`casMode`**（明示，不由 writer 推測），兩種模式：

                          casMode=current-terminal（**未持久化 reopen**：plan 只標 scratch）
                            expectedCurrentTerminalRef ＝ 舊 clause
                            writer 驗 canonical DP.currentTerminalRef == expected
                            → 不預先要求 canonical DP 上已有 priorTerminalRef，
                              「scratch 標記 → 單筆交易完成 ASSUM→REQ」因此成立

                          casMode=reopened-prior（**已持久化 reopen**，可跨 run）
                            expectedCurrentTerminalRef ＝ null
                            expectedPriorTerminalRef  ＝ 舊 clause
                            writer 驗 DP.status == open ∧ DP.currentTerminalRef == null
                              ∧ DP.priorTerminalRef == expectedPriorTerminalRef
                              ∧ reopenedBy 為 closed trigger ∧ 舊 clause 仍 active
                            → 同交易建立 Transition(subject=舊 clause)＋新 terminal

                          兩模式的 subject 都由 payload 明示並經 CAS 驗證；`priorTerminalRef`
                          在 current-terminal 模式下僅為順帶寫入的歷史 annotation，
                          在 reopened-prior 模式下是 CAS 的比對對象。
                          舊 clause 已非 active 時不需 Transition → 改走 `adopt-existing-outcome`
supersede-requirement     replace-terminal 的 row-3 變體：plan-gate witness＋compatibility block。
                          payload 另含 **`initiatingDpIds`** —— 觸發 row 3 的 open／reopened DP
                          不一定引用舊 REQ，若不處理會出現「clause 已 supersede、
                          initiating DP 仍 open」。同一交易把 initiating DP 指向 successor；
                          **initiating DP 的 successor 不 applicable → 整筆 fail-closed、
                          store 不變**（proposal 沒解決觸發 row 3 的衝突，不得先 supersede
                          clause 再把 initiating DP reopen）；
                          其餘原本引用 subject 的 dependent DP successor 不 applicable →
                          Transition 成立後依上游協定 reopen
resolve-exception         exception-grant Source＋REQ＋scope ruling record＋DP resolve
reclassify-dp             原子更新 DP.layer＋classificationBasis（人可讀）
                          ＋classificationRulingRef
reopen-dp                 **限「當下沒有 successor、確實必須持久化 open 狀態」**（含跨 run）：
                          原子地保存 `priorTerminalRef` ＋清 terminal ＋記 closed trigger。
                          有 successor 時**不得**先 reopen 再 replace（那會產生兩筆交易與
                          可見中間態）—— 直接單筆 `replace-terminal(casMode=current-terminal)`。
                          日後取得 successor 時走 `casMode=reopened-prior`，
                          deferred reopen 因此可收斂
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

### 本 spec 新增的 annotation（正式清單；上游欄位語義一律不變）

| annotation | 掛在 | 型別／值 | 必填時機 |
|---|---|---|---|
| `taskRef` | 本 task 建立的 clause／record | taskId（ULID），建立時 authored、永不改寫 | 一律 |
| `REQ.acceptance` | REQ(kind=acceptance) | `{ behaviorChanging, verification }` | kind=acceptance 時 |
| `classificationRulingRef` | DP | `RecordRef(kind=review-ruling)`，optional | 由 reviewer classification 或 product-tradeoff reclassification 產生時必填；loader 驗 `by`／`subjectRef`／snapshot 自洽＋current 欄位 == ruling output（§4） |
| `inputPacketDigest` ＋ `inputPacketSnapshot` | Governance Packet／proposal／review-ruling record | sha256(canonical payload) ＋ 該 immutable snapshot 本體，closed set 與 encoding 見 §4 | 治理 ruling 一律 |
| `pendingReviewPrincipal` | DP（scratch） | **ReviewerPrincipal**（discipline 或 arbiter） | row 7 待裁決時 |
| `pendingScopeRuling` | DP（scratch） | bool | exception-backed row-1 候選待 ruling 時 |
| `pendingReopen` | DP（scratch） | `{ trigger, expectedCurrentTerminalRef }` | plan 階段標記待 reopen，**不改動 canonical DP**；`expectedCurrentTerminalRef` 供交易做 DP 層 CAS |
| `priorTerminalRef` | DP | 前一個 terminal clause ref | `reopen-dp` 必寫；`replace-terminal(current-terminal)` 順帶寫為歷史 annotation；`replace-terminal(reopened-prior)` 以它為 **CAS 比對對象**。兩種模式的 Transition subject 都由 payload 明示，不從此欄推導 |
| `initiatingDpIds` | supersede-requirement 交易 payload | DP id 陣列 | row 3 一律 |

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
  preGateIterations,            // 總迭代數，跨 epoch 累加
  convergenceEpochs, converged, reGateRounds,
  staleProposalRejections,
  adoptedExistingCount,
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
5. **Row 7 checkpoint**：`pendingReviewPrincipal` 未裁決時受影響實作未開始。
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
25. **Proposal 新鮮度**：Ask 修改 `scenario`／`alternatives` 後，舊 proposal 於 **mutation 前**因 `inputPacketDigest` 與當下 canonical pre-state packet 不符而被拒，重出後才落檔；被消除的預鑄 DP 及其 proposal 不落檔。
26. **classificationBasis 型別**：`DP.classificationBasis` 維持人可讀理由（上游語義不變）；ruling 由 `classificationRulingRef` 承載，loader 驗 `by`／`subjectRef`、**對 record 內 snapshot 重算 digest 自洽**，並依 per-kind postcondition 驗 current 欄位 —— **不與 mutable current packet 比 digest**。
27. **row 1 可執行**：一般 row 1（cite 既有 active applicable REQ）與 exception-backed row 1（同交易帶 scope ruling＋`scopeRulingRef`）各一例，皆經 `adopt-existing-outcome` 落檔，store 內無新 clause、無 Transition。
28. **binding-policy 收窄**：ruling 指向既存 active ∧ applicable ∧ 無衝突 REQ 時 → adopt；指向非-clause 的 policy Source（含 repo 內未核准 policy 檔）時 → fail-closed，改落 DEC／ASSUM／product-tradeoff。
29. **Fingerprint 欄位域**：新證據只改變 `materialReasons`（DP 數、scenario、alternatives 不變）→ fingerprint 改變 → 判為合法進展，不誤判打轉。
30. **Epoch 解鎖**：本 epoch 迭代達 cap 後 `converged=false`；使用者新裁決開新 epoch 並重置 history／budget，迴圈得以繼續，`preGateIterations` 累加、`convergenceEpochs` +1。
31. **create-requirement authority**：僅能建立 `authority=approved-requirement`；嘗試建立 hard-constraint 或 compatibility → 拒寫。
32. **Row 3 initiating DP**：successor 對 initiating DP applicable 時，交易完成後該 DP 已指向 successor，不留下「clause 已 supersede、DP 仍 open」；**successor 對 initiating DP 不 applicable 時 → no-write assertion：整筆拒絕，store bytes 與交易前完全相同**（不得先 supersede 再 reopen）。dependent DP 的不 applicable 則於 Transition 成立後 reopen。
33. **Digest 不自我失效**：`layer-classification` ruling 套用（`reclassify-dp` 改動 layer／classificationBasis）後，loader 仍能驗證該 ruling —— 對 record 內 snapshot 重算 digest 自洽、`by`／`subjectRef` 相符、current `DP.layer` == ruling output；該 DP 之後再 reopen 也不使歷史 ruling 變 stale。
34. **Arbiter round trip**：security 與 operability 同時命中 → routing 回 `{kind: arbiter}`；`pendingReviewPrincipal`、packet 的 `requestedPrincipal`、`ruling.by` 三者皆可表示且相等，全程無需降級成 discipline。
35. **Reopen 走 Transition**：`ASSUM → reopen（保留 priorTerminalRef）→ 採用既存 REQ` 產生合法 supersede Transition(subject=舊 ASSUM)，舊 ASSUM 不再 active；同一情境呼叫 `adopt-existing-outcome` 必須被拒寫。
36. **Canonical encoding**：兩個獨立 writer 對同一 packet 內容算出相同 digest —— 特別是 `materialReasons`、`basisRefs`、binding／exception 集合以不同插入順序建構時，定序規則使 digest 相同；`alternatives` 順序不同則 digest 必須不同。
37. **單筆完成 reopen-replace**：plan scratch 標 `pendingReopen{trigger, expectedCurrentTerminalRef}` 後，**不先寫 canonical reopen**，直接由**單筆** `replace-terminal` 完成 ASSUM → 既存 REQ；`expectedCurrentTerminalRef` 與 canonical 不符時整筆拒寫。
38. **User-authorized transition 有 witness**：`ASSUM → 既存 REQ` 與 `DEC → 既存 REQ` 兩例，plan 內具名揭露 subject → successor、核准後鑄造 target == subject 的 plan-gate record，Transition 的 `authorityRef.kind=user` 通過 witness binding 驗證。
39. **Postcondition table**：`product-tradeoff` ruling 套用後，loader 驗得 `DP.layer == intent`、`classificationBasis == basis`、`classificationRulingRef == record`；已不被 current ref 引用的歷史 ruling 只驗 snapshot／digest 自洽。
40. **Deferred reopen 可收斂**：active ASSUM 執行 `reopen-dp` 後 run 結束；**下一個 run** 取得既存 REQ，以 `replace-terminal(casMode=reopened-prior)` 通過 prior-terminal CAS 完成合法 Transition，舊 ASSUM 不再 active。`casMode=current-terminal` 在此情境（current 已為 null）必須拒寫。
41. **DEC／ASSUM 綁定不可借用**：把一筆**其他 DP 的**合法 `technical-decision` ruling 配上新建 DEC → postcondition 比對（`DEC.derivedFrom`、`decision`、`alternatives`、`approvedBy`、`basisRefs`）失敗 → 拒寫。

## 14. 邊界與非目標

- 不動 test tag／contract-check／test-reviewer（test-provenance spec）。
- 不削弱 `verification-gate.md` 紅→綠。
- **scan 本身不新增 unconditional pass**；治理 call（pre-gate 分類／scope、row-7 裁決）僅在對應 DP 存在時條件執行，且均為 read-only proposal —— 寫 store 的永遠是 main thread。
- **Partial contract 明文排除於 v1**：要恢復並行，須另立 partial-contract 版本與更新規則的 spec 變更。
- 語義判斷明文不宣稱機械保證：DP 同一性（§9）、受影響範圍判定（§6）、layer 初判（§4）；loader 只證 snapshot 一致性（§8）。
