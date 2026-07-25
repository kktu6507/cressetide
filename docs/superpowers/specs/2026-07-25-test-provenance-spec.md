# Test-Provenance Implementation Spec

- 狀態：draft v0.4 —— 三輪修訂（ASSUM Transition 的治理 witness 路由、finding 陣列化、outcome→disposition gate、effective-oracle 依賴閉包）；審閱中
- **上游依賴**：本文依賴 shared model **v1.7**（provenance binding 變動的測試納入 gate scope；binding 拆 pre／post 兩相，現時效力只課於後態）。**v1.7 未過 panel 前本文不得放行。**本文的 inventory 欄位對映上游語義：`tagBefore → preChangeBinding`、`tagAfter → postChangeBinding`。
- 日期：2026-07-25
- 上游：`2026-07-25-shared-decision-provenance-model.md`（**draft v1.7**，前一放行版本 approved v1.6）。不重新定義任何 shared concept；附加欄位一律標為 annotation 且不改上游語義。
- 姊妹 spec：`2026-07-25-intent-scan-spec.md`（**approved v1.0**）。provenance store、store script 命令面、task manifest、Review Packet 接線由該 spec 定義，本文消費而不重定義。**Gate scope 直接消費 shared model §9 的 canonical 定義**（不在本文改寫或摘要）。

## 1. 目的與範圍

落地方案三的另一半：**斷言來源標記**與**沉默即不斷言**，並把上游 §9 的結構／來源兩層接進 `contract-check.mjs`。

治的是 demo1 實測到的具體病灶：CTide 寫 258 個測試、對 frozen oracle 有 23 個不相容，全部是「規格沒點名的情況，自行決定答案後用測試釘死」；其中 10 條 Retry-After 測試無一碰到規格寫著的 `plain-object` 邊界 —— 規格原文的修飾詞在走到測試的路上蒸發。

**不含**：intent scan、DP 分流、治理 checkpoint、store script 命令面（皆屬 intent-scan spec）。

## 2. Tag 語法、粒度與偵測

粒度取 **test 層級**（一個測試宣告一個 tag）。斷言層級太細 —— 258 個測試底下約 800 個斷言，逐條標會變成新的儀式。

```
// @src REQ-01J9XKQ…            ← 緊鄰宣告的前一行，中間不得有空行
test("duplicate eventId 回傳同一個 promise，不會再送一次", …)
```

- **Canonical grammar（唯一形式；inventory、batch、checker 共用）**：

```
tag        := clauseTag | "EXPL"
clauseTag  := clauseRef [ "@" dpRef ]
clauseRef  := ("REQ" | "DEC" | "ASSUM") "-" ULID
dpRef      := "DP-" ULID
解析結果一律表示為 { clauseRef, dpRef? } | { expl: true }

解析層拒絕（fail-closed，不留到後續檢查）：
  DEC-…@DP-…       ← DEC 不得帶 qualifier
  ASSUM-…@DP-…     ← ASSUM 不得帶 qualifier
  非 exception-backed 的 REQ-…@DP-…
  即：`@dpRef` **僅** exception-backed REQ 合法（§7）
```
- **每個測試恰好一個 tag**。需要兩個來源者**必須拆成兩個測試** —— 這正是攔截「掛名 AC、實際釘設計選擇」的結構。
- **Parameterized／table-driven**：一個宣告一個 tag 涵蓋其全部 row；**但若不同 row 的期望來自不同 clause，必須拆成不同宣告** ——「一宣告一 tag」不使 mixed-source table 合法。
- **exception-backed REQ 的限定形式**：`@src REQ-x@DP-y`（見 §7 Blocker 4 規則）。
- helper、fixture、共用 setup 不需 tag，**但其變更必須經由 effective-oracle 依賴閉包反推到受影響測試**（§6）—— 否則改一個帶斷言的 helper 就能在 inventory 為空的情況下改變測試語義。

**偵測單位是 framework adapter，不是 per-language regex**：

```
adapter = { adapterId, language, framework,
            testDeclarationPatterns,
            containerPatterns（不承載 tag，如 describe/context/suite）,
            attachmentRule（前置註解｜decorator｜attribute｜annotation）,
            structuralId(decl)  ← 見下方 identity }
```

- `describe(`／`context(`／`suite(` 等是 **container**，不承載 tag，也不因未標而報錯。
- decorator／attribute 型（`@Test`、`#[test]`、`@pytest.mark.parametrize`）由 `attachmentRule` 指定 tag 註解相對於 decorator 的位置。
- 註冊單位是 **framework**：`js/ts` 已註冊不代表 Jest／Vitest／Playwright 都被涵蓋。

**Adapter discovery contract（closed evidence，依 precedence）**：

```
1. 明示 config（repo 內指定 path → adapterId）
2. package manifest 依賴（package.json devDependencies、pyproject、go.mod、Cargo.toml…）
3. 測試檔內 import／require／use 語句
4. file pattern（*.spec.ts、*_test.go、test_*.py…）
零個命中 → fail-closed；多個命中且 precedence 無法唯一決定 → fail-closed
```

**Test identity（`testRef`）**：`{ path, adapterId, structuralId }`。

`structuralId` 由 adapter 定義為 **path-independent** 的檔內結構鍵（container chain ＋正規化宣告名稱），**不得只用 declarationName** —— 同檔同名、generated／dynamic name 都會碰撞。path 不入 `structuralId`，因此**單純搬檔仍保持 identity**（`status=moved`）。

檔內結構重整（container 改名／嵌套改變）會使 `structuralId` 變動，此時：

```
matching 必須 one-to-one；任何一對多或多對一 → fail-closed
無法唯一配對時，作者可在宣告上加明示穩定 ID（adapter 定義之 annotation）
  → 該 ID 優先於推導的 structuralId
仍無法唯一配對 → fail-closed（不得猜測，也不得降級成 added＋deleted）
```

**`inventoryDigest` 的 canonical encoding（不可只寫「同上游」）**：

```
entries 依 (path, structuralId) 的 Unicode code point 序排序
每個 entry 的 object key 依 code point 排序
bodyDigest 的 body span ＝ adapter 定義的宣告完整範圍
  （含 decorator／attribute／attachmentRule 所涵蓋的前置區塊，不含前後空白行）
body 正規化：UTF-8 無 BOM、LF、不 trim 內部空白
inventoryDigest ＝ sha256(canonical JSON of entries[])
```

## 3. 沉默即不斷言（減法規則）

**引不出 `REQ-`／`DEC-`／`ASSUM-` id，就不要寫這個斷言。**

| 情境 | 處置 |
|---|---|
| 規格明文可推導 | 該條款應已是 REQ；引它 |
| 規格沉默、屬產品語義 | intent fork → **回 plan gate**（test-time 發現的 intent fork 必經 plan gate，上游規定） |
| 規格沉默、屬實作選擇 | implementation DP → 依上游 row 5／7；要斷言才建檔（ephemeral 不入模型） |
| 只是想探索行為 | `EXPL`，依 §5 決定是否進必要 suite |

**這條規則是減法。**demo1 中 CTide 多寫的 189 個測試多殺 **0** 個 mutant（實測 adjusted mutation 兩組皆 10/10），卻夾帶 22 個多餘假設把 oracle eligibility gate 弄掛 —— 零上檔、全部下檔。

## 4. Tag scope 約束（核心語義規則）

**一個測試的所有斷言都必須落在其 tag 所指 clause 的範圍內。**

反例（demo1 實錄）：測試名為 `a duplicate eventId returns the exact same promise and never re-sends`（去重），斷言卻含 `attempts: 0, inFlight: 0` —— 那是實作自選的 `await null` 時序，不是去重契約。

混了範圍 → 拆成兩個測試，各自找來源。這是**語義判斷**，歸 test discipline，以 §6 的 typed finding 交付；機械層只驗 tag 存在與 id 可解析（§10）。

## 5. 紅燈處置與 clause 生命週期（兩者**不**綁定）

上游 §1 的四種權威決定紅燈的**合法處置集合**，不決定 exit code —— 必要 suite 內一律綠：

| tag | 紅燈合法處置 |
|---|---|
| `REQ` | 修實作；或依上游 §7 走**授權**的 clause 變更（supersede／retire Transition，witness 齊備） |
| `DEC` | 恢復行為；或由 `approvedBy` principal 或 arbiter 建 supersede Transition |
| `ASSUM` | 恢復行為；建 revise／retire Transition；**或 supersede → REQ｜DEC**（上游允許的升級收斂路徑，authority 依上游 matrix）。升級後依上游 retag 至後繼 clause，或對新 REQ 重做 red→green。**不得稱為 requirement regression** |
| `EXPL` | 更新或刪除自由 |

`EXPL` 二選一：進必要 suite 就保綠；要真 non-gating 就置於必要 suite 之外。

### 測試生命週期 **不**驅動 clause 生命週期

**刪除、retag、改名、搬檔、換 verification layer 永不要求 clause Transition。**拆分（§4）本身就會刪掉舊測試 —— 若刪除即要求 supersede REQ，本 spec 的核心規則會與自己衝突。

```
刪除／retag 一個 @src REQ-x 的測試
  → 只觸發 criterion → test mapping **重算**
  → 同 run 內有合法 replacement／split／move → REQ 維持 active
  → 只有 behavior-changing criterion 在 **after-state** 失去必要 verification evidence
    → fail-closed（這是既有 verification-gate 的要求，非新增的 clause 生命週期規則）
```

**After-state coverage 的合法 evidence（單靠 head inventory 不足）**：

```
head 側存在 tag 指向該 criterion 的測試
∧ 該 tag 的語義有效（§6 batch 中該 entry 的 findings 為空）
∧ 現行 criterion → test mapping 承認它
∧ 具備 red→green 證據，或 verification-gate 允許的替代證據
四者缺一 → 不算覆蓋
```

**DEC 不設對應規則**：DEC 測試消失可能造成 coverage gap，但不等於 DEC 生命週期改變 —— 補一條「DEC test 刪除 ⇒ DEC Transition」會重犯同一個型別錯誤。

### 唯一與 clause 生命週期連動的機械規則

```
候選集合 ＝ gate scope 內所有 tagBefore == ASSUM-x 的 entry，
            status ∈ { modified, deleted, retagged }
            （**含 deleted 與 retagged** —— 否則「改行為 → 刪測試／改標成 EXPL」可完全繞過）
對每個候選，§6 batch 必須有 outcome：
  findings 含 assum-reading-change
    → 依 §6 治理路由取得**符合 Transition matrix 的 witness**（非 test discipline 的 ruling）
    → ASSUM-x 必須有本 run 的 revise／retire／supersede Transition（ackRef 為該治理 witness）
    → 缺 → fail-closed
  findings 為空（純搬檔／換 coverage／換層，選定讀法仍為 A）
    → 不建 Transition
```

**這不是「刪 test ⇒ Transition」**（那是前一輪已修掉的型別錯誤）——deleted／retagged 只是**進入語義審查的候選**，是否需要 Transition 由 reviewer 判定選定讀法是否真的 A→B。語義前提由 test discipline 認定並以 typed batch 交付；**一旦認定，Transition 的存在與 witness 完整性是機械檢查** —— 讓「revision-allowed」不等於「可以無聲改掉」。

## 6. 輸入契約（checker 的 canonical 輸入；無此二者則 §5／§12 不可實作）

### `ChangedTestInventory`（per-run scratch，由 base／head 兩側內容導出）

```
inventoryDigest:  對整份 entries 正規化後的雜湊（canonical encoding 同上游 §9）
entries[]:
  testRef:        { path, adapterId, structuralId }（deleted 者取 base 側，§2 identity）
  status:         added | modified | deleted | retagged | moved
  tagBefore:      { clauseRef, dpRef? } | { expl: true } | null
  tagAfter:       同上 | null
  baseBodyDigest: 宣告本體 canonical digest（status ≠ added 時必填）
  headBodyDigest: 同上（status ≠ deleted 時必填）
  framework:      adapter 回報
matching 規則（closed，依序；結果必須 **one-to-one**，任何歧義 fail-closed）：
  1. (path, structuralId) 相等                    → modified／retagged
  2. structuralId 相等但 path 不同                → moved
  3. 其餘 head-only → added；base-only → deleted
```

Inventory 是**機械導出**，不含語義判斷。

**Effective-oracle 依賴閉包（否則間接變更完全隱形）** —— 測試的判準未必寫在宣告本體內：assertion-bearing helper、fixture／setup、snapshot／golden file、外部 parameterized expected-data，改動任一者都可能改變測試語義而宣告本體毫無變動。

```
adapter 必須提供 effectiveOracleDeps(decl) → [檔案／區段 ref]
  涵蓋：被呼叫的 assertion helper、fixture／setup chain、
        snapshot／golden 檔、外部 expected-data（table／fixture 檔）
inventory 產生時：
  上述任一 dep 於本次變更 → 受影響測試以 status=modified 進 inventory，
  並將 dep digest 納入該 entry 的 bodyDigest 計算
adapter 無法可靠歸屬的 assertion style（動態組裝、反射式斷言…）
  → **fail-closed**，不得視為 inventory empty
```

### `TestSemanticReviewBatch`（current task 一份；test discipline 的 typed 輸出）

逐 finding 的設計無法區分「審過且乾淨」與「漏審」—— 改為 **batch＋完整性不變量**：

```
taskId
inventoryDigest             ← 綁定當下 inventory 全文
results[]:                  ← 對 inventory entry 一對一
  testRef
  clauseRef?                ← EXPL entry **省略此欄**（上游：EXPL 無 clause）
  dpRef?                    ← exception-backed（§7）
  observedBaseBodyDigest?   ← reviewer 所見 base 側宣告本體（含 oracle deps）
  observedHeadBodyDigest?   ← 同上 head 側
  tagBefore, tagAfter
  findings: Finding[]       ← **陣列**；`clean` ⇔ findings 為空
    Finding:
      kind: wrong-tag | missing-source | scope-violation | assum-reading-change
      binding?: { clauseRef, dpRef? }   ← 該 finding 所涉綁定
      evidence: 具體指認（斷言位置、超界的斷言、引不出的來源…）
      disposition: unresolved | resolved   ← 見 §8 disposition 表
```

**四個 reviewer 問題彼此獨立**，同一測試可能同時 wrong-tag、missing-source、scope-violation **並且**改變 ASSUM 讀法 —— 單一 enum 必然丟失其中幾項，故改為陣列。

**不變量**：`results` 與 inventory `entries` **一對一且完全覆蓋**。缺任一 entry → 視同語義審查未完成 → **fail-closed**（reviewer 跑了但漏審四個測試，不得被讀成 reviewed-clean）。

**Freshness（intent-scan 用 `inputPacketDigest` 解過的同一問題）** —— checker 消費前重算比對：

```
batch.taskId          == current taskId
batch.inventoryDigest == 重算的 current inventoryDigest
每筆 observedBase/HeadBodyDigest == 重算的 current body digest
tagBefore／tagAfter    == current inventory
任一不符 → fail-closed
```

因此：測試在 review 後又被修改、沿用同一 test 的**舊 run** ruling、或借用**其他 test** 的 ruling，全部擋下。

**Proposal 與 persisted shape 分離** —— reviewer 的 proposal **不含 `rulingRef`**（那是 main thread 尚未鑄造的東西）：

```
reviewer  → batch proposal（上列欄位，無 rulingRef）
main thread → batch 落 per-run scratch
            → 對含 assum-reading-change finding 的項，另建 review-ruling record
              （by = {discipline: test}；subjectRef = 該 ASSUM clause ref；
               testRef 與 body digests 置於 payload）
              → **此 record 是 semantic evidence，不是治理授權**（見下）
checker／arbiter 只消費 batch 與 ruling records，**不讀 reviewer 敘述**
```

### ASSUM Transition 的治理 witness 路由（test discipline 無權授權）

上游 Transition matrix 規定 ASSUM 的 revise／retire 須由該 ASSUM 的 `governedBy` principal 或 arbiter 授權；supersede → REQ 須 user。**test discipline 只能認定「讀法變了」，不能批准撤銷一個 `governedBy=security` 的假設。**

```
1. test-reviewer 的 assum-reading-change ruling ＝ **semantic evidence only**
2. main thread 依該 ASSUM 的 governedBy 路由治理裁決：
     revise／retire        → governedBy principal 或 arbiter
     supersede → REQ       → user（plan 具名揭露 subject → successor，
                             核准後鑄 target == subject 的 plan-gate witness）
     supersede → DEC       → governedBy 或 arbiter，或**經正式 rerouting 的
                             current review principal**（上游 domain transfer 規則，
                             需 DP-bound review-ruling witness）
3. 取得符合 matrix 的治理 witness 後，main thread 才寫 Transition
4. 治理 witness 缺席 → Transition 不得建立 → §5 的存在性檢查 fail-closed
```

semantic evidence 與治理 witness 是**兩筆不同的 record**，前者不得充當後者的 `ackRef`。

## 7. exception-backed REQ 的 test → DP 綁定

上游 applicability 是 `applicable(clause, DP)`，`scopeRulingRef` 也掛在 DP 上；tag 只有 `REQ-x` 時，一個 exception-backed REQ 若 resolve 多個 DP，checker 無法知道該驗哪個。**closed rule**：

```
限定形式 @src REQ-x@DP-y（§2 canonical grammar）必驗全部五項：
  DP-y ∈ currentTaskDpIds                    ← 只查 current task
  DP-y.status == resolved
  DP-y.resolvedBy == REQ-x
  applicable(REQ-x, DP-y)                    ← 上游 §2 謂詞
  DP-y.scopeRulingRef.subjectRef == DP-y
  任一不成立 → fail-closed（不得把任意或仍 assumed 的 DP 接上去就算合法）

裸形式 @src REQ-x：
  **僅在 currentTaskDpIds 內**反推 resolvedBy == REQ-x 的 DP（歷史 DP 不列入，
  避免製造假歧義）
  恰好一個候選 → 自動綁定，續驗上列五項
  零個或多個候選 → fail-closed（訊息要求改用限定形式）

非 exception-backed 的 REQ 不需 DP 綁定；inventory 的 tagBefore／tagAfter
保留 { clauseRef, dpRef? } 兩欄，qualifier 因此 end-to-end 可見
```

## 8. Orchestrator 順序（寫進 `SKILL.md`）與 `contract-check.mjs` 落地

現行 Vigil 流程是**先跑 contract-check、再開 reviewer**；`--provenance` 必須在語義審查**之後**執行，因此**不能沿用既有 contract-check 的位置**。正式順序：

```
1. ChangedTestInventory 產生（main thread）
2. → Review Packet（帶 inventory 摘要、tag／clause、pending governance）
3. → test-reviewer 產出 TestSemanticReviewBatch proposal（read-only）
4. → main thread 固化：batch 落 scratch、assum-reading-change 另建 review-ruling record、
     必要的 revise／retire／supersede Transition（single-writer，經 store script）
5. → contract-check --provenance
6. → pass 後才進 arbiter
```

既有的 pre-review contract-check 呼叫**位置與 exit-0 契約皆不變**；`--provenance` 是新增的第 5 步。步驟 4 的 single-writer 落檔點必須明列於 `SKILL.md`。

checker 讀 `.ctide/provenance.json`（tracked）、scratch manifest、`ChangedTestInventory`、`TestSemanticReviewBatch` 與已固化的 review-ruling records，**不自行寫入**。

| 層 | 內容 | 失敗 |
|---|---|---|
| 結構（`REQ`／`DEC`／`ASSUM`） | tag 存在、grammar 合法（§2）、可解析到 clause、clause `active ∧ mechanicallyApplicable`（per-kind，上游 §2）；exception-backed 依 §7 綁定 DP 並驗五項；§5 的 ASSUM Transition 存在性 | **fail-closed** |
| Batch 完整性與新鮮度 | `results` ↔ inventory entries 一對一完全覆蓋；`taskId`／`inventoryDigest`／各 body digest／tag 前後值重算相符（§6） | **fail-closed** |
| **Finding disposition** | 每個 finding 依下表有對應處置且 `disposition == resolved`；**任一 `unresolved` → `status=fail`** | **fail-closed** |
| 結構（`EXPL`） | **不做 clause／Source resolution** —— 只驗 tag 語法與必要-suite policy | fail-closed（僅語法／policy） |
| 來源 | Source 存在、Check A、Check B（`driftMode=repo-file`）；`contentKind=exception-grant` **完整鏈**：resolve `targetConstraintRef` → target 必須是 `authority=hard-constraint` 的 REQ → `grantAuthorityRef == target.ownerRef` → 未過期 | **fail-closed** |
| 語義（認定本身） | 不做 —— 認定移交 test-reviewer（§9）；但其**結果的處置**由上一列機械強制 | — |
| Legacy | gate scope 外：允許全量觀測，findings **observe-only** | fail-open |

### Finding → disposition（closed；任一 unresolved 即 `--provenance` fail）

| finding kind | 合法處置（達成後 `disposition=resolved`） |
|---|---|
| `wrong-tag` | retag 至正確 clause；或拆分；或恢復原斷言使既有 tag 重新成立 |
| `missing-source` | 刪除該斷言；或縮小到既有 clause 支持的範圍；或先走 plan／DP routing 取得 REQ／ASSUM 後再引 |
| `scope-violation` | 拆分成各自有來源的測試；或把超界斷言縮回 tag 範圍 |
| `assum-reading-change` | 依 §6 路由取得治理 witness 後建立 revise／retire／supersede Transition |

**沒有「已知悉但不處理」這個選項** —— fresh 且完整的 batch 只要含任一 `unresolved` finding，`--provenance` 即 `status=fail`，arbiter 不得 `READY`。v0.3 把語義列寫成「不做」，使含 `scope-violation` 的 batch 仍可能 pass，本版修正。

**機械結果與阻擋層**（既有 `contract-check.mjs` 明寫 fail-open、git 錯誤回空集合、永遠 exit 0 —— 不可依賴其現行 exit code 表達 fail-closed）：

```
新增 --provenance 模式：
  輸出 machine result { provenance: { status: pass|fail, violations[] } }
  gate scope 內的結構／來源違規、batch 不完整或不新鮮、**任一 unresolved finding**
    → status=fail ∧ **exit code 非 0**
既有預設模式：exit-0 契約不變（向後相容，既有呼叫端不受影響）
arbiter：執行 --provenance；status=fail → **不得 READY**（與 exit code 雙重把關）
git 錯誤或無法判定 gate scope → status=fail（不得回空集合當作通過）
```

## 9. test-reviewer：改變提問，且**不可 substitution**

現行提問是「哪裡覆蓋不足」。demo1 顯示它在此提問下什麼也沒抓到 —— 問題不在覆蓋率，在**多出來的東西**。改問四件事，並以 §6 的 typed finding 交付：

1. 每個變更測試的 tag 是否正確（引的 clause 真的支持這些斷言）。
2. 有無斷言**超出 tag 範圍**（§4）→ `scopeViolation`。
3. 有無斷言**引不出來源**卻仍存在（§3）。
4. `ASSUM` 測試的讀法是否已實際改變 → `readingChanged`。

**Substitution 例外（改 `reviewer-selection.md`）**：current task 的 `ChangedTestInventory` **只要非空**（任一 added／modified／deleted／retagged／moved），`test-reviewer` **一律不得** evidence-substituted。現行規則允許低／中風險以 red→green＋full-suite green 跳過它，那會繞過本 spec **唯一**的語義控制點。

v0.2 的「除非已由另一個等價 typed semantic gate 完成」是**未定義的逃生口，本版刪除** —— v1 沒有 closed registry 之前不留這種例外。

## 10. 與 `verification-gate.md` 的關係、Assurance boundary

**不削弱任何既有要求**：`REQ(kind=acceptance)` 的 behavior-changing criterion 仍需示範 red→green。本 spec 加的是**第三個 traceability 方向**：

```
既有：criterion → verifying test（覆蓋）
既有：changed file → criterion（scope creep，檔案粒度）
新增：test → source（assumption creep，斷言粒度）
```

demo1 的 23 個假設全數通過前兩個方向 —— 它們是「額外的」測試，落在合法變更的測試檔內。

**Assurance boundary（明文）**：機械層止於 tag 存在／可解析、clause active ∧ mechanicallyApplicable、Source 檢查、DP 綁定唯一性、Transition 存在與 witness 完整性。**不宣稱**：斷言是否真被 clause 蘊含、tag 是否選對、`ASSUM` 讀法是否改變 —— 皆為 test discipline 的判斷，且**可能誤判**；本 spec 保證的是「該判斷不會被跳過（§9）、其結果為 typed 且其機械後果被強制執行（§5／§6）」。presence 級檢查不得被報成 provenance 完整保證。

## 11. Run ledger 觀測（非 gate，一 run 一 record）

snapshot 寫入 scratch，於既有 verdict 後的**單一** run record 無條件帶入（不綁報告格式 sentinel）：

```
testProvenance: {
  taggedTests: { REQ, DEC, ASSUM, EXPL },
  inventory: { added, modified, deleted, retagged, moved },
  findingKinds: { wrongTag, missingSource, scopeViolation, assumReadingChange },
  cleanEntries: n,                // findings 為空的 entry 數
  oracleDepTriggered: n,          // 因 effective-oracle 依賴而入 inventory 的測試數
  assumTransitions: n,
  adapterMisses: n,
  staleBatchRejections: n,
  droppedForNoSource: number | "unreported"   // disclosure-only；未回報即 "unreported"，
                                              // **不得**視為 0，永不參與 gate
}
```

## 12. 修改檔案清單

| 檔案 | 變更 |
|---|---|
| `cressetide/skills/vigil/references/test-provenance.md` | **新增** —— §2–§7、§9 協定本體（plugin 慣用英文） |
| `cressetide/skills/vigil/scripts/contract-check.mjs` | 新增 `--provenance` 模式與結構／來源兩層（§8）；預設模式 exit-0 契約不變 |
| `cressetide/skills/vigil/scripts/test-adapters.json` | **新增** —— §2 framework adapter registry |
| `cressetide/skills/vigil/scripts/changed-test-inventory.mjs`（＋tests） | **新增** —— §6 base／head 導出、one-to-one matching、inventoryDigest |
| `cressetide/skills/vigil/SKILL.md` | **§8 六步順序**；`--provenance` 的新位置（不沿用既有 contract-check 位置）；步驟 4 的 single-writer 落檔點 |
| `cressetide/agents/test-reviewer.agent.md` | §9 四個提問；typed finding 輸出格式 |
| `cressetide/skills/vigil/references/reviewer-selection.md` | §9 的 substitution 例外 |
| `cressetide/skills/vigil/references/verification-gate.md` | 記載第三個 traceability 方向；紅→綠不變 |
| `cressetide/agents/arbiter.agent.md` | `test → source` 方向；執行並讀 `--provenance` 機械結果 |
| `cressetide/skills/vigil/references/review-packet.md` | packet 帶 inventory 摘要與變更測試的 tag／clause |
| `cressetide/skills/vigil/references/test-layer-boundaries.md` | 澄清：本 spec 管 tag 與來源，不改「哪一層」的判斷 |
| `docs/runtime-contract.md` | tracked store 與 per-run scratch（inventory、batch）的 state-class 正式登記 |
| `cressetide/skills/vigil/references/runtime-policy.md` | single-writer 邊界：reviewer propose／main thread persist，涵蓋 batch 與治理 witness |
| `cressetide/skills/vigil/scripts/run-ledger.mjs` ＋ `references/run-ledger.md` | `testProvenance` 欄位 |

## 13. 驗收條件

1. **HeaderBag 重演**：demo1 webhook 案例重跑，引用「plain-object response headers 以 `Object.entries()` 順序…」的測試在撰寫時即暴露 `plain` 修飾詞。
2. **範圍違規可見且會擋**：`duplicate eventId` 測試含 `attempts: 0` 斷言 → finding `scope-violation`；未拆分（`disposition=unresolved`）時 `--provenance` **fail**，arbiter 不出 `READY`；拆分後通過。
3. **無來源斷言不存在**：13 條 constructor error-type 測試引不出 clause → 不寫，或先經 plan gate 成為 REQ／ASSUM。
4. **未標記即擋**：變更測試缺 `@src` → 結構層 fail-closed。
5. **失效 clause 即擋**：`@src` 指向 superseded／retired／非 applicable clause → fail-closed。
6. **Adapter 未註冊即擋**：變更測試檔的 **framework** 未涵蓋（如已註冊 js/ts 但未涵蓋 Playwright 語法）→ fail-closed，非靜默略過。
7. **拆分不誤殺 REQ**：把一個 mixed-scope REQ 測試拆成兩個（舊宣告刪除、兩個新宣告加入），REQ **維持 active**、**不要求任何 Transition**；after-state 每個 behavior-changing criterion 仍有 verification evidence → 通過。
8. **After-state 失覆蓋才擋**：刪除某 behavior-changing criterion 的唯一測試且無替代 → fail-closed（依 verification-gate，非 clause 生命週期規則）。
9. **DEC 無對應規則**：刪除 `@src DEC-x` 測試不要求 DEC Transition；若造成 coverage gap 則由 test-reviewer 以一般覆蓋率職責提出。
10. **ASSUM 無聲修改被擋**：修改 `@src ASSUM-x` 測試且 outcome `assum-reading-change`、卻無 revise／retire／supersede Transition → fail-closed；補上含 ackRef 的 Transition 後通過。
10b. **ASSUM delete／retag 不可繞過**：行為由 A 改為 B 後（i）刪除該 ASSUM 測試、（ii）retag 成 `EXPL` —— 兩種情形皆進入候選集合、皆需 batch result；含 `assum-reading-change` finding 而無治理 witness 支撐的 Transition → fail-closed。純搬檔／換層且行為仍為 A → `findings` 為空，**不要求** Transition。
11. **ASSUM 升級**：`ASSUM → REQ` supersede 後，原測試 retag 至新 REQ 或對其重做 red→green，兩者皆為合法終局。
12. **EXPL 不被誤擋**：`@src EXPL` 測試通過結構層（不做 clause resolution），僅受語法與必要-suite policy 約束。
13. **exception-backed 綁定**：裸 `@src REQ-x` 在 current task 有兩個 DP resolve 到該 REQ 時 → fail-closed；改用 `REQ-x@DP-y` 後通過；恰一個候選時裸形式自動綁定成功。
14. **Exception chain 完整**：`targetConstraintRef` 指向非 hard-constraint REQ、`grantAuthorityRef != ownerRef`、或已過期 → 三種情形各自 fail-closed。
15. **Substitution 被擋**：低風險 run 有 tagged test 變更時，即使 red→green 齊備且 full suite 綠，`test-reviewer` 仍必須執行。
16. **機械結果會阻擋**：結構／來源違規時 `--provenance` 回 `status=fail` 且 **exit code 非 0**，arbiter 不出 `READY`；預設模式的 exit-0 契約未改變。
17. **git 錯誤不放行**：無法取得 base 側或判定 gate scope 時 → `status=fail`，不得回空集合當通過。
18. **Parameterized 混來源**：table 內不同 row 期望來自不同 clause → 必須拆成不同宣告，否則 typed finding 判 `scopeViolation`。
19. **Legacy 不阻擋**：gate scope 外的既有未標記測試產生 observe-only findings。
20. **紅→綠不被削弱**：behavior-changing 的 `REQ(kind=acceptance)` 仍需 red→green；缺少時 arbiter 不出 `READY`。
21. **Ledger 誠實**：`droppedForNoSource` 未回報時為 `"unreported"`（非 0），且不參與任何 gate；`testProvenance` 只出現在最終 run record。
22. **逐 test completeness**：inventory 有 12 個 entry、batch 只回 8 個 result → fail-closed（不得讀成 reviewed-clean）；補齊 12 個後通過。
23. **Stale batch 被拒**：batch 產出後測試又被修改（headBodyDigest 變動）→ fail-closed；重跑語義審查後通過。
24. **Borrowed ruling 被拒**：（i）沿用同一 test 的**舊 run** ruling（taskId 不符）、（ii）借用**其他 test** 的 ruling（testRef／body digest 不符）→ 兩者皆 fail-closed。
25. **錯誤 DP qualifier**：`REQ-x@DP-y` 中 DP-y 不在 currentTaskDpIds／status 非 resolved／`resolvedBy != REQ-x`／不 applicable／`scopeRulingRef.subjectRef != DP-y` → 五種情形各自 fail-closed。
26. **Duplicate／dynamic test name**：同檔兩個同名宣告、以及 runtime 產生名稱的宣告，均由 `structuralId` 區分；matching 若出現一對多或多對一 → fail-closed。
27. **Move + retag**：測試同時搬檔並改 tag → inventory 正確產出單一 entry（`status=moved`＋`tagBefore`≠`tagAfter`），不被拆成 added＋deleted。
28. **Adapter 多重命中**：兩個 adapter 皆命中同一檔且 precedence 無法唯一決定 → fail-closed；零命中亦然。
29. **順序正確**：`--provenance` 在 test-reviewer 產出並固化後才執行；在該步之前執行時，因 batch 不存在而 `status=fail`（證明它未沿用既有 pre-review 位置）。
30. **治理授權分離**：`ASSUM.governedBy = security` 的假設讀法改變時，僅有 test discipline 的 semantic ruling **不足以**建立 Transition → fail-closed；取得 security（或 arbiter）的治理 witness 後才通過。`supersede → REQ` 需 user／plan-gate witness。
31. **同時多問題不遺失**：一個測試同時 wrong-tag、missing-source、scope-violation 且改變 ASSUM 讀法 → batch 該 entry 的 `findings` 含四筆，各自需處置；只處理其中三筆 → 仍 fail。
32. **未處置即擋**：batch fresh 且完整、但含一筆 `disposition=unresolved` 的 `scope-violation` → `--provenance` `status=fail`（v0.3 此情形會誤 pass）。
33. **間接 oracle 變更被捕獲**：（i）修改帶斷言的 helper、（ii）修改 fixture／setup、（iii）更新 snapshot／golden 檔、（iv）改動外部 parameterized expected-data —— 四者皆使受影響測試以 `status=modified` 進 inventory 並需語義審查；宣告本體未動不構成豁免。
34. **無法歸屬即擋**：adapter 無法可靠解析的 assertion style（動態組裝／反射式斷言）→ fail-closed，**不得**視為 inventory empty。
35. **Grammar 解析層拒絕**：`DEC-x@DP-y`、`ASSUM-x@DP-y`、非 exception-backed 的 `REQ-x@DP-y` → 解析層即 fail-closed。
36. **結構重整可救**：container 改名使 `structuralId` 變動且無法唯一配對 → fail-closed；加上明示穩定 ID 後配對成功。單純搬檔（僅 path 變）→ `status=moved`，identity 維持。
37. **前態不被課現時效力**（上游 v1.7）：把測試從 inactive／superseded clause retag 到 active successor、或移除引用過期 exception-backed REQ 的測試 → **通過**，不因舊 binding 失效而被擋。

## 14. 邊界與非目標

- 不動 intent scan、DP 分流、治理 checkpoint、store script 命令面（intent-scan spec）。
- **不設測試數量上限** —— demo1 實測顯示數量不是正確的打擊目標（69 vs 258，兩組 adjusted mutation 皆 10/10）；治的是來源，不是數量。
- 不管 gate scope 外的既有測試（brownfield 邊界，範圍定義見 shared model §9）。
- 語義判斷不宣稱機械保證（§10）；本 spec 保證的是它不被跳過、結果為 typed、機械後果被強制執行。
