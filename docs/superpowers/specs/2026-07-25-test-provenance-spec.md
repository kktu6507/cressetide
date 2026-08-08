# Test-Provenance Implementation Spec

- 狀態：**draft v1.5 — 修訂待 panel**（前一放行版本：approved v1.4）。v1.5 **不改本文任何語義或 AC**，僅因上游 SM draft v1.12 把 `provenanceVersion` 升為 2 而必須一併標回 draft：本文消費的 **canonical empty store** 與 **`baseProvenance.storeDigest`** 是對 canonical bytes 計算的，version 欄位在其中，因此 v1 與 v2 的 digest 必然不同 —— 維持 approved 會是**假相容**。上游核准後，本文連同該版本邊界一併重新過 panel。前一放行版本說明：approved v1.4（2026-08-02 panel 放行；前一放行版本 approved v1.0，2026-07-26 panel 放行，自 draft v0.10 經九輪修訂）。實作以本文為準；變更需重新過 panel。**曾退回 draft 的原因**：v1.0 的 `assum-reading-change` 路徑要求「本 run 內產生 revise Transition」，而 revise 的 successor 依定義是尚不存在的新 clause；姊妹 spec intent-scan v1.2 同時寫死「`commit-test-provenance-batch` 不得鑄造任何 clause」，兩者合起來使該路徑**形式上不可達**。v1.1 隨 intent-scan v1.3 的 `successorClauseDraft` 補齊 **ASSUM successor** 的 Step 5 與 AC。v1.2 續修兩處：(1) §6 與 Step 4b 把 `ASSUM.governedBy` 當成可以是 `user`／`plan-gate` 的分支條件 —— 它的型別是 **ReviewerPrincipal**（discipline | arbiter），該比對恆為 false，會讓 REQ 的退出重審路徑**靜默失效**；改以 **`transition.successor`** 決定是否退出，`governedBy` 只決定 reviewer-side principal；(2) 隨當時的 intent-scan v1.4 補上 `ASSUM|DEC supersede → REQ` 的端到端 AC，與 sibling 聚合／重複 subject／carrier 覆蓋的負向 AC（AC76 改寫，新增 AC77 起）。v1.3 修 v1.2 草案一處：Step 5 正文仍把 `successorClauseDraft` 敘述成只鑄造 successor ASSUM，與已放寬的 REQ 契約不符；改寫為**通則**（不在 pre-state 即必須帶 draft；ASSUM 驗 `routingOrigin` 等義務；REQ 驗 rule 6 的 user／plan-gate／四欄／tier 義務；其他 clause 類型未授權即 fail-closed），並補 `DEC → 新 REQ` 的完整成功 AC 與 adopt 的正向 carrier AC（新增 AC78、AC80，其後順延至 AC83）。v1.4 修 v1.3 草案一處：§8 的 typed transaction summary 仍寫「revise group 帶 `successorClauseDraft`（鑄造 successor ASSUM）」，位置在契約摘要而非歷史註解，會把已放寬的合法 REQ successor 重新說窄；改為與 Step 5 完全一致的通則。草案審閱期間，本版新增契約不得實作；該限制已隨 v1.4 核准解除。
- 日期：2026-07-25
- 上游：`2026-07-25-shared-decision-provenance-model.md`（**現行生效契約：approved v1.11**；另有 **draft v1.12 — 待 panel**）—— 提供 gate scope、pre／post binding 兩相、**base provenance witness**、`provenance-batch` record kind 與 chain head 規則。不重新定義任何 shared concept；附加欄位一律標為 annotation 且不改上游語義。inventory 欄位對映上游語義：`tagBefore → preChangeBinding`、`tagAfter → postChangeBinding`。
- 姊妹 spec：`2026-07-25-intent-scan-spec.md`（**現行生效契約：approved v1.7**；另有 **draft v1.8 — 待 panel**，只改來源 2 的因果 witness，不改本文消費的任何命令形狀）—— 提供 provenance store、store script 命令面（含 `commit-test-provenance-batch`、`successor=null` retire）、task manifest、Review Packet 接線；本文消費而不重定義。**Gate scope 直接消費 shared model §9 的 canonical 定義**（不在本文改寫或摘要）。
- **三份互相依賴，皆須通過各自 panel**；v0.5 曾宣稱「不改 store script 命令面」，**該宣稱撤回**。

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

**`testRef.path` 完整沿用 §6 `depRef.path` 的 canonical 規則**：repo-relative Git tree path、分隔符 `/`、禁 dot-segment、大小寫取 Git tree 字面值、symlink 不跟隨 —— 它參與 identity、matching、排序與 `inventoryDigest`，不 canonical 則 Windows 與 Linux 會算出不同結果。

`structuralId` 由 adapter 定義為 **path-independent** 的檔內結構鍵（container chain ＋正規化宣告名稱），**不得只用 declarationName** —— 同檔同名、generated／dynamic name 都會碰撞。path 不入 `structuralId`，因此**單純搬檔仍保持 identity**（`status=moved`）。

檔內結構重整（container 改名／嵌套改變）會使 `structuralId` 變動，此時：

```
matching 必須 one-to-one；任何一對多或多對一 → fail-closed
無法唯一配對時，作者可在宣告上加明示穩定 ID（adapter 定義之 annotation）
  → 該 ID 優先於推導的 structuralId
仍無法唯一配對 → fail-closed（不得猜測，也不得降級成 added＋deleted）
```

**`inventoryDigest` 的 canonical encoding（唯一公式，不可只寫「同上游」）**：

```
inventoryDigest ＝ sha256(canonicalJson({ baseTreeOid, entries }))
  ← **唯一正式公式**。舊版一處寫「只 hash entries[]」、另一處說「envelope 含 baseTreeOid」，
    兩式並存會讓「同一批 entries、不同 base tree 是否同 digest」沒有答案，
    base-tree proof 因而不可機械驗證

entries 依 (path, adapterId, structuralId) 的 Unicode code point 序排序
每個 entry 的 object key 依 code point 排序
bodyDigest 的 body span ＝ adapter 定義的宣告完整範圍
  （含 decorator／attribute／attachmentRule 所涵蓋的前置區塊，不含前後空白行）
body 正規化：UTF-8 無 BOM、LF、不 trim 內部空白
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
候選集合 ＝ gate scope 內**所有** tagBefore == ASSUM-x 的 entry
            —— **不依 status 枚舉**。inventory 只收錄有變動者，因此凡出現即為候選，
               涵蓋 body／binding／existence／location 任一變動。
               （v0.4 列 { modified, deleted, retagged } 會漏掉 **moved**：
                搬檔＋retag EXPL＋讀法 A→B 只產生一筆 status=moved，直接繞過整條規則）

對每個候選，§6 batch 必有一筆 result，依其 findings 分三支（完備）：
  ① findings 含 assum-reading-change
     → 依 §6 治理路由取得**符合 Transition matrix 的 witness**（非 test discipline 的 ruling）
     → ASSUM-x 必須有本 run 的 revise／retire／supersede Transition（ackRef 為該治理 witness）
     → 缺 → fail-closed
  ② findings 不含 assum-reading-change，但含其他 kind
     → **不因 ASSUM lifecycle 要求 Transition**
     → 各 finding 依 §8 的一般終局規則收斂
  ③ findings 為空（純搬檔／換 coverage／換層，選定讀法仍為 A）
     → 不建 Transition，無其他要求
```

**這不是「刪 test ⇒ Transition」**（那是前一輪已修掉的型別錯誤）——deleted／retagged 只是**進入語義審查的候選**，是否需要 Transition 由 reviewer 判定選定讀法是否真的 A→B。語義前提由 test discipline 認定並以 typed batch 交付；**一旦認定，Transition 的存在與 witness 完整性是機械檢查** —— 讓「revision-allowed」不等於「可以無聲改掉」。

## 6. 輸入契約（checker 的 canonical 輸入；無此二者則 §5／§12 不可實作）

### `ChangedTestInventory`（per-run scratch，由 base／head 兩側內容導出）

```
baseTreeOid:      本次盤點所用的 Git base tree，供 checker 機械驗證
                  `baseProvenance.treeOid == baseTreeOid`
inventoryDigest:  依 **§2 的唯一公式** `sha256(canonicalJson({ baseTreeOid, entries }))`
entries[]:
  testRef:        { path, adapterId, structuralId }（deleted 者取 base 側，§2 identity）
  status:         added | modified | deleted | retagged | moved | governance-affected
                  （**governance-affected**：body 與 binding 皆未變，但其綁定的 clause
                   於本次 changed／transitioned／drifted／expired —— 由上游 clause → test
                   反向閉包產生。未被改動的 sibling 測試因此仍須進 fixed-point review）
  reason:         content-change | governance-affected
  tagBefore:      { clauseRef, dpRef? } | { expl: true } | null
  tagAfter:       同上 | null
  baseBodyDigest: §2 bodyDigest（status ≠ added 時必填）
  headBodyDigest: 同上（status ≠ deleted 時必填）
  framework:      adapter 回報

schema 不變量（**鏡射上游 INV-B1／B2，寫死在 schema，不靠 AC 補救**）：
  status == deleted  ⇔  tagAfter == null
  status != deleted  ⇒  tagAfter != null（必為 clause binding 或 EXPL）
  status == governance-affected  ⇔  reason == governance-affected
  reason == governance-affected ⇒ tagBefore == tagAfter ∧ baseBodyDigest == headBodyDigest
  governance-affected 的 seed 是上游 **lifecycleAffectedClauses** 的反向閉包
    —— 與上游同一集合，不得各自定義
  ⇒ 「測試仍存在但把 @src 拿掉」在 schema 層即非法，不會被誤讀成已刪除
  tagBefore == null 僅表示「本次新增」或「既有未標記 legacy」，兩者皆合法
matching 規則（closed，依序；結果必須 **one-to-one**，任何歧義 fail-closed）：
  1. (path, structuralId) 相等                    → modified／retagged
  2. structuralId 相等但 path 不同                → moved
  3. 其餘 head-only → added；base-only → deleted
```

Inventory 是**機械導出**，不含語義判斷。

**Effective-oracle 依賴閉包（否則間接變更完全隱形）** —— 測試的判準未必寫在宣告本體內：assertion-bearing helper、fixture／setup、snapshot／golden file、外部 parameterized expected-data，改動任一者都可能改變測試語義而宣告本體毫無變動。

```
adapter 必須提供 effectiveOracleDeps(decl) → [depRef]
  涵蓋：被呼叫的 assertion helper、fixture／setup chain、
        snapshot／golden 檔、外部 expected-data（table／fixture 檔）
inventory 產生時：
  上述任一 dep 於本次變更 → 受影響測試以 status=modified 進 inventory
adapter 無法可靠歸屬的 assertion style（動態組裝、反射式斷言…）
  → **fail-closed**，不得視為 inventory empty
```

**Digest 必須可重現**（否則兩個 writer 算不出同一個 `bodyDigest`）：

```
depRef.path       ＝ **repo-relative Git tree path**，分隔符固定 "/"；
                     不得含 "." / ".." dot-segment；大小寫**依 Git tree 記錄的字面值**
                     （不做 case-folding —— 跨 Windows／macOS／Linux 才會一致）；
                     **symlink 不跟隨**，以 tree 中的 link entry 本身計 digest
depRef.span       ＝ closed schema：{ kind: "whole-file" }
                                  | { kind: "byte-range", startInclusive, endExclusive }
                                  | { kind: "anchor", anchorId }（adapter 定義）
canonical bytes   ＝ UTF-8 無 BOM、LF、不 trim 內部空白（同 §2 body 正規化）

edge contract     ＝ 所有節點（root 宣告與非 root dep）共用同一 effectiveOracleDeps 展開規則
                     —— 非 root 節點不得改用其他展開方式
deps(node, tree)  ＝ 於**指定 tree** 內遞迴展開；依 canonical depRef（path 再 span）
                     Unicode code point 序排序並去重；
                     **cycle**：已訪問集合終止遞迴，不重複計入、不報錯

declarationDigest(tree) ＝ sha256(canonical declaration bytes)       ← §2 body span
depDigest(d, tree)      ＝ sha256(canonical bytes of d in tree)
effectiveOracleDigest(tree) ＝ sha256(canonical JSON [{ref, digest}, …])
bodyDigest(tree)  ＝ sha256(canonical JSON { declarationDigest, effectiveOracleDigest })

baseBodyDigest ＝ bodyDigest(base tree)      ← 兩棵樹**各自**求閉包，不混用
headBodyDigest ＝ bodyDigest(head tree)
```

動態依賴無法解析時依上述規則 **fail-closed**，不得以空閉包充數。

### `TestSemanticReviewBatch`（current task 一份；test discipline 的 typed 輸出）

逐 finding 的設計無法區分「審過且乾淨」與「漏審」—— 改為 **batch＋完整性不變量**：

```
taskId
baseProvenance              ← 上游 §9 **inline** witness（treeOid／storePath／storeDigest）；
                              必須等於 tracked TaskState.baseProvenance，且
                              treeOid == inventory.baseTreeOid
inventoryDigest             ← 綁定當下 inventory 全文
results[]:                  ← 對 inventory entry 一對一
  testRef
  clauseRef?                ← EXPL entry **省略此欄**（上游：EXPL 無 clause）
  dpRef?                    ← exception-backed（§7）
  observedBaseBodyDigest?   ← reviewer 所見 base 側宣告本體（含 oracle deps）
  observedHeadBodyDigest?   ← 同上 head 側
  tagBefore, tagAfter
  findings: Finding[]       ← **陣列**；無 finding ⇔ 該 entry 乾淨
    Finding:
      kind: wrong-tag | missing-source | scope-violation | assum-reading-change
      binding?: { clauseRef, dpRef? }   ← 該 finding 所涉綁定
      evidence: 具體指認（斷言位置、超界的斷言、引不出的來源…）
      resolutionRef?: Resolution        ← **僅** assum-reading-change 適用（§8 反借用契約）
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
reviewer    → batch proposal（上列欄位，無 rulingRef）—— **僅 in-memory／scratch proposal**
main thread → Step 4 只做 in-memory 準備：semantic evidence draft
              （by = {discipline: test}；subjectRef = 該 ASSUM clause ref；
               testRef 與 body digests 置於 payload）與治理 witness draft
            → **Step 5 才原子持久化**（單一 `commit-test-provenance-batch`）
              —— 不再「batch 先落 scratch、另建 review-ruling」
semantic evidence **不是治理授權**（見下）
checker／arbiter 只消費 **committed batch** 與其中的 records，**不讀 reviewer 敘述**
```

### ASSUM Transition 的治理 witness 路由（test discipline 無權授權）

上游 Transition matrix 規定 ASSUM 的 revise／retire 須由該 ASSUM 的 `governedBy` principal 或 arbiter 授權；supersede → REQ 須 user。**test discipline 只能認定「讀法變了」，不能批准撤銷一個 `governedBy=security` 的假設。**

```
1. test-reviewer 的 assum-reading-change ruling ＝ **semantic evidence only**
2. main thread 依 **successor**（不是 governedBy）決定授權來源；`governedBy`
   只決定 reviewer-side principal，其型別 ReviewerPrincipal 使它**永遠不可能**
   是 user 或 plan-gate：
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

**這是 fixed-point loop，不是直線** —— 一般 finding 的修復會改動 tag／body，必然使 batch stale，因此必須回到起點重算：

```
loop:
  1. ChangedTestInventory 產生／重新產生（main thread）
  2. → Review Packet（帶 inventory 摘要、tag／clause、pending governance）
  3. → test-reviewer 產出 TestSemanticReviewBatch proposal（read-only）
  4. → 分流：
       a. 含 wrong-tag／missing-source／scope-violation
          → 修復（retag／拆分／刪斷言／縮範圍／走 plan-DP routing）
          → **goto 1**（inventory 與 batch 都必須重算）
       b. 含 assum-reading-change → **兩個獨立維度**，不可混為一軸：
            (i) **誰是 reviewer-side principal** ← `ASSUM.governedBy`
                （型別為 ReviewerPrincipal ＝ discipline | arbiter，
                  **永遠不可能**是 user 或 plan-gate）
            (ii) **是否需要 user／plan gate** ← `transition.successor` 與上游
                 authority matrix，**與 governedBy 無關**
          → 依 successor 分支：
              successor = 新 ASSUM（revise）／retire
                → governedBy principal 或 arbiter，同一 run 內取得 ruling witness
              successor = DEC
                → governedBy 或 arbiter，或經正式 rerouting 的 current review
                  principal（需 DP-bound review-ruling witness）
              successor = **REQ**
                → **退出本輪 review**（因為 successor 是 REQ，不是因為
                  「governedBy 是 user」—— 後者是不可能型別），
                  plan 具名揭露 subject → successor → 重新核准 → resume-task
                → 回到本 loop（同一 taskId，不重建既有物件）
          → 取得 witness 後 main thread 建 Transition，finding 保留並填 resolutionRef
       c. 無 finding → 續行
  5. → main thread 呼叫 **單一** `commit-test-provenance-batch`（intent-scan v1.7）：
       batchSnapshot ＋ resolutions: **ResolutionGroupDraft**[0..N]（依 subject clause 分組）
       clean batch ＝ `resolutions=[]`，仍提交 provenance-batch record
       **successorClauseDraft 通則**（不限 ASSUM）：
         successor 不存在於 pre-state → **必須**帶 draft，且
           `successorClauseDraft.id == transitionDraft.successor`
         successor = **ASSUM** → 驗 `routingOrigin` 必填，及該值的
           `layer`／`governedBy`／`basisRefs` 義務全備
         successor = **REQ** → 驗 intent-scan rule 6 的封閉條件：
           action=supersede ∧ subject ∈ {ASSUM, DEC}
           ∧ `authorityRef.kind == user` ∧ `ackRef.kind == plan-gate`
           ∧ plan-gate 四欄（target／successor／impact／disposition）與 Transition
             及其 compatibility block 逐欄相等（上游 §7）
           ∧ REQ tier ∈ {approved-requirement, compatibility}
         successor = 其他 clause 類型 → 本交易**未授權鑄造** → fail-closed
         retire（`successor=null`）與 successor 已存在於 pre-state 者 → **不得**帶 draft
       —— 一律不得先另起一筆交易鑄造 clause，那會產生可見中間態並違反本步的原子性
       ＋ `resolutionCarrierUpdates[]`：本交易改動 terminal 的每個 DP 逐一宣告
         `preserve | replace | clear | unchanged-null`（intent-scan §8 carrier 契約）
       交易內完成全部 evidence／witness／successor clause／Transition
       ／dependent DP repoint-or-reopen／carrier 更新
       ／provenance-batch record 與 chain relation／TaskState head
       scratch 僅快取本輪的 `provenanceBatchRef`（衍生 cache）
  6. → contract-check --provenance
       stale（inventory／body digest 不符）或存在未收斂 finding → **goto 1**
  7. → pass 後才進 arbiter
```

**持久化：單筆 typed 交易，scratch 只是衍生 cache** —— v0.6 用「scratch 先寫、tracked 補 commitMarker」的散落欄位方案有四個相連的洞：`commitMarker` 不屬任何既有 schema；scratch batch 會引用下一步才鑄造的 ref；tracked 只留 digest 時內容不可復原；且**命令面根本沒有能原子處理 `ASSUM retire` 的交易**（`replace-terminal` 當時必須有 successor）。四者同源，故改為 typed 交易：

```
main thread 呼叫 intent-scan spec v1.7 的
  commit-test-provenance-batch           ← 單筆 CAS 交易；resolutions: ResolutionGroupDraft[0..N]
                                           （`ResolutionGroup` 僅用於 committed batchSnapshot）
                                           successor 不在 pre-state 的 group 必須帶
                                             successorClauseDraft（見上通則：
                                             ASSUM → 驗 routingOrigin／layer／governedBy
                                                      ／basisRefs；
                                             REQ   → 驗 rule 6 的 action／subject tier
                                                      ／user authority／plan-gate 四欄
                                                      ／REQ tier；
                                             其他未授權 clause 類型 → fail-closed；
                                             retire 或 successor 已存在 → 不得帶 draft）
                                           ＋ resolutionCarrierUpdates[]（逐 DP carrier 宣告）
    clean batch ＝ resolutions=[]（**不虛構** Transition），仍提交 provenance-batch record
    每個 group（**輸入型別** `ResolutionGroupDraft`）：subjectRef、semanticEvidenceRefs[1..N]、
      governanceWitnessRef、**transitionDraft**；提交後 batchSnapshot 內為
      **`ResolutionGroup.transitionRef`**（持久型別）
    交易內完成所有 dependent DP 的 repoint／reopen 與 chain relation

committed 判準：該交易成功 ⇔ 已提交（單一事實來源，無跨界 marker）
crash 後 resume：以 **tracked `TaskState.committedProvenanceBatchRef`** 為準（上游 §2 三態）
  ref == null ∧ 該 task 尚無 batch  → **合法未提交**，直接重跑 loop（非 fail）
  ref != null ∧ == 唯一 tip          → 已提交；**scratch 全失時可由 chain 的
                                       batchSnapshot 完整重建**
  已有 batch 但零 tip／多 tip／ref != tip → fail-closed
  ref 未含本輪                        → 交易未發生；scratch 視為 orphan，忽略並重跑 loop
checker：消費**明確的 `provenanceBatchRef`**（不以 taskId／inventoryDigest／batchDigest
         模糊搜尋「對應 record」），驗 batchDigest 與 batchSnapshot 相符；
         ref 缺席或不符 → status=fail（不採信孤兒 scratch）
```

**user／plan-gate 分支不假設 main thread 當場拿得到 witness** —— 它可以離開 review、重新核准後以 `resume-task` 回到同一 task（intent-scan spec 既有機制）。

**成功終止條件**：fresh batch 無一般 finding 且所有 `assum-reading-change` 皆有通過驗證的 `resolutionRef`。

**非收斂終局（比照 intent-scan §4，不能只有遙測）**：

```
fingerprint(state) ＝ 雜湊( inventoryDigest
  ＋ sorted( 每筆 result 的 { testRef, tagBefore, tagAfter,
                             findings(kind, binding) 集合,
                             resolution(mode, transitionRef, semanticEvidenceRef),
                             pending governance 狀態(principal, witness 是否到位) } ) )
```

只含 `inventoryDigest ＋ finding kind`（v0.6）會**誤判合法進展**：治理 witness 從缺到齊、resolution 從無到有，這些都不改變 inventory 與 kind 集合，卻是實實在在的前進。

```
本 epoch 內 fingerprint 重複，或迭代數達 cap（預設 8，揭露） → converged=false
converged=false ⇒ **hard gate lock**：禁止 arbiter READY、禁止交付
  （與 --provenance status=fail 並行，不倚賴任何一方）
**任何當下有權治理的 principal** 所產生的新 ruling／witness → 構成進展，**可開新 epoch**
  —— 不限 user／arbiter；`governedBy` 為 security／architecture／operability 等時同樣適用
開新 epoch：重置本 epoch 的 fingerprint history 與 budget（總迭代數仍累加）
揭露：卡住的 findings（testRef＋kind）與**最後兩次 fingerprint**，避免無限震盪不可診斷
```

既有的 pre-review contract-check 呼叫**位置與 exit-0 契約皆不變**；`--provenance` 是新增的**第 6 步**。**第 5 步**的 single-writer 落檔點必須明列於 `SKILL.md`。

checker 讀 `.ctide/provenance.json`（tracked）、`ChangedTestInventory`，**不自行寫入**。

**提交後的單一 truth source**（scratch proposal 不得成為第二個）：

```
TaskState.committedProvenanceBatchRef
  → tracked provenance-batch.batchSnapshot          ← checker 讀的 batch
驗：該 ref == 推導出的唯一 chain tip（上游 §2 head 三分）
   batchDigest 與 batchSnapshot 相符
   batchSnapshot.baseProvenance == TaskState.baseProvenance == inventory.baseTreeOid 對應
scratch 的 batch proposal **僅供 Step 3–4 的迴圈使用**；Step 6 之後一律不讀
```

| 層 | 內容 | 失敗 |
|---|---|---|
| 結構（`REQ`／`DEC`／`ASSUM`） | tag 存在、grammar 合法（§2）、可解析到 clause、clause `active ∧ mechanicallyApplicable`（per-kind，上游 §2）；exception-backed 依 §7 綁定 DP 並驗五項；§5 的 ASSUM Transition 存在性 | **fail-closed** |
| Batch 完整性與新鮮度 | `results` ↔ inventory entries 一對一完全覆蓋；`taskId`／`inventoryDigest`／各 body digest／tag 前後值重算相符（§6） | **fail-closed** |
| **Finding 終局** | fresh batch 中不得存在 `wrong-tag`／`missing-source`／`scope-violation`；`assum-reading-change` 須有通過驗證的 `resolutionRef`（見下表） | **fail-closed** |
| 結構（`EXPL`） | **不做 clause／Source resolution** —— 只驗 tag 語法與必要-suite policy | fail-closed（僅語法／policy） |
| 來源 | Source 存在、Check A、Check B（`driftMode=repo-file`）；`contentKind=exception-grant` **完整鏈**：resolve `targetConstraintRef` → target 必須是 `authority=hard-constraint` 的 REQ → `grantAuthorityRef == target.ownerRef` → 未過期 | **fail-closed** |
| 語義（認定本身） | 不做 —— 認定移交 test-reviewer（§9）；但其**結果的處置**由上一列機械強制 | — |
| Legacy | gate scope 外：允許全量觀測，findings **observe-only** | fail-open |

### Finding 的終局（closed；`resolved` 不是自陳，是可驗事實）

`wrong-tag`／`missing-source`／`scope-violation` 的**合法修復都會改動 tag 或 body**，因而使當時的 batch 立刻 stale。它們的正確終局不是被標成 `resolved`，而是**在重新產生的 fresh batch 中消失**：

| finding kind | 合法修復 | 終局判準（checker 驗的東西） |
|---|---|---|
| `wrong-tag` | retag 至正確 clause；拆分；或恢復原斷言使既有 tag 重新成立 | **final fresh batch 中不存在該 finding** |
| `missing-source` | 刪除該斷言；縮小到既有 clause 支持的範圍；或先走 plan／DP routing 取得 REQ／ASSUM 後再引 | 同上 |
| `scope-violation` | 拆分成各自有來源的測試；把超界斷言縮回 tag 範圍 | 同上 |
| `assum-reading-change` | 依 §6 路由取得治理 witness 後建立 revise／retire／supersede Transition | **可保留該 finding**，但須通過下方**反借用契約** |

**reviewer 或 main thread 不得把同一筆 finding 直接翻成已處理** —— 語義**認定**可以是 reviewer judgment，處置**已完成**不能只是 reviewer judgment，否則本 spec 宣稱的機械強制落空。

### `resolutionRef` 反借用契約（只驗 Transition 本身不足）

只驗 `subject`／`authority`／`ackRef`／witness binding，證明的是「這是一筆合法處理該 ASSUM 的 Transition」—— **不能**證明它處理的是本 task、本 test、本組 body digest、本 finding、本次 post binding。同一 ASSUM 的舊 Transition，或 sibling test 已用過的 Transition，仍可被借來交差。改為 discriminated union：

```
Resolution ＝
  | { mode: "this-round",
      transitionRef, semanticEvidenceRef }
  | { mode: "historical-convergence",
      transitionRef }
```

**`this-round`**（本輪產生的 Transition）—— checker 驗全部：

```
semanticEvidence.taskId        == current taskId
semanticEvidence.testRef       == 本 result.testRef
semanticEvidence.base/headBodyDigest == 本 result 的對應值
semanticEvidence.findingKind   == assum-reading-change
semanticEvidence.binding       == finding.binding
T.subject                      == finding.binding.clauseRef
T.ackRef 的治理 witness **明確引用** semanticEvidenceRef
outcome 對位：
  post binding 為 clause → T.successor 或其 active successor chain == post binding
  post 為 EXPL 或 deleted → 落入允許的 cleanup 終局（下一支）
```

**`historical-convergence`**（清理歷史 stale test）—— 不得要求它回頭引用尚不存在的本輪 evidence，但**必須以 typed 前態輸入證明 T 真的是歷史的**：

```
checker 依上游 §9 的 baseProvenance witness（treeOid／storePath／storeDigest）
  讀出 base provenance store 並驗 digest；缺席／錯指／不符 → fail-closed
T **以及**用來對位 post binding 的**完整** successor chain
  必須**逐一**存在於該 base store        ← 部分存在亦 fail-closed
∧ tagBefore == T.subject
∧（post binding == T 的 active successor chain，或 post 為 EXPL／deleted）

base store 中不存在的 Transition **一律只能走 this-round**
```

`baseProvenance.treeOid` **與 `ChangedTestInventory` 使用同一個 Git base tree**（上游已選定此為 canonical basis，不再與「task-start snapshot」混用）。

少了 base 條件，本輪剛建立的合法 `T` 只要把 `mode` 寫成 `historical-convergence`，就能跳過 task／testRef／body digest／semantic evidence 的全部綁定。

這支存在的理由：把一個引用早已 superseded ASSUM 的舊測試 retag 到後繼或刪除，是**合法清理**，不應被反借用防線擋住。

`--provenance` 的判準因此是：

```
final fresh batch 中存在 wrong-tag | missing-source | scope-violation  → status=fail
assum-reading-change 缺 resolutionRef，或其 Resolution 未通過上述任一支 → status=fail
```

**機械結果與阻擋層**（既有 `contract-check.mjs` 明寫 fail-open、git 錯誤回空集合、永遠 exit 0 —— 不可依賴其現行 exit code 表達 fail-closed）：

```
新增 --provenance 模式：
  輸出 machine result { provenance: { status: pass|fail, violations[] } }
  gate scope 內的結構／來源違規、batch 不完整或不新鮮、
  fresh batch 仍存在一般 finding、或 assum-reading-change 的 resolutionRef 缺席／不通過
    → status=fail ∧ **exit code 非 0**
既有預設模式：exit-0 契約不變（向後相容，既有呼叫端不受影響）
arbiter：執行 --provenance；status=fail → **不得 READY**（與 exit code 雙重把關）
git 錯誤或無法判定 gate scope → status=fail（不得回空集合當作通過）
```

## 9. test-reviewer：改變提問，且**不可 substitution**

現行提問是「哪裡覆蓋不足」。demo1 顯示它在此提問下什麼也沒抓到 —— 問題不在覆蓋率，在**多出來的東西**。改問四件事，並以 §6 的 typed finding 交付：

1. 每個變更測試的 tag 是否正確（引的 clause 真的支持這些斷言）。
2. 有無斷言**超出 tag 範圍**（§4）→ `scope-violation`。
3. 有無斷言**引不出來源**卻仍存在（§3）。
4. `ASSUM` 測試的讀法是否已實際改變 → `assum-reading-change`。

**Substitution 例外（改 `reviewer-selection.md`）**：current task 的 `ChangedTestInventory` **只要非空 —— 包含只有 `governance-affected` entry 的情形**，`test-reviewer` **一律不得** evidence-substituted。（sibling 未被改動不代表它仍指向有效的 clause，那正是要審的東西。）現行規則允許低／中風險以 red→green＋full-suite green 跳過它，那會繞過本 spec **唯一**的語義控制點。

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
  findingKinds: {                 // 鍵名即 §6 的 kind 值
    "wrong-tag": n, "missing-source": n,
    "scope-violation": n, "assum-reading-change": n
  },
  entriesWithoutFindings: n,
  oracleDepTriggered: n,          // 因 effective-oracle 依賴而入 inventory 的測試數
  governanceAffectedEntries: n,   // 由 clause → test 反向閉包拉進來的 sibling
  reviewLoopIterations: n,        // 總輪數，跨 epoch 累加
  convergenceEpochs: n, converged: bool,
  taskId, inventoryDigest, batchDigest,
  provenanceBatchRef,                     // **明確 ref** —— 事故診斷不必回頭做被禁止的
                                          // (taskId, inventoryDigest, batchDigest) 查找
  lastStaleSubject: string | null         // 最後一次判 stale 的對象
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
| `cressetide/skills/vigil/SKILL.md` | **§8 七步 fixed-point loop**；`--provenance` 的新位置（第 6 步，不沿用既有 contract-check 位置）；第 5 步的 single-writer 落檔點＝呼叫 `commit-test-provenance-batch` |
| `cressetide/skills/vigil/scripts/provenance-store.mjs` | **（intent-scan v1.7 範圍）** `commit-test-provenance-batch`（含 `successorClauseDraft`、`resolutionCarrierUpdates[]`）、`successor=null` retire |
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
2. **範圍違規可見且會擋**：`duplicate eventId` 測試含 `attempts: 0` 斷言 → finding `scope-violation`；未修復時 `--provenance` **fail**，arbiter 不出 `READY`；拆分後**重算 inventory 與 batch**、該 finding 消失才通過。
3. **無來源斷言不存在**：13 條 constructor error-type 測試引不出 clause → 不寫，或先經 plan gate 成為 REQ／ASSUM。
4. **未標記即擋**：變更測試缺 `@src` → 結構層 fail-closed。
5. **失效 clause 即擋**：`@src` 指向 superseded／retired／非 applicable clause → fail-closed。
6. **Adapter 未註冊即擋**：變更測試檔的 **framework** 未涵蓋（如已註冊 js/ts 但未涵蓋 Playwright 語法）→ fail-closed，非靜默略過。
7. **拆分不誤殺 REQ**：把一個 mixed-scope REQ 測試拆成兩個（舊宣告刪除、兩個新宣告加入），REQ **維持 active**、**不要求任何 Transition**；after-state 每個 behavior-changing criterion 仍有 verification evidence → 通過。
8. **After-state 失覆蓋才擋**：刪除某 behavior-changing criterion 的唯一測試且無替代 → fail-closed（依 verification-gate，非 clause 生命週期規則）。
9. **DEC 無對應規則**：刪除 `@src DEC-x` 測試不要求 DEC Transition；若造成 coverage gap 則由 test-reviewer 以一般覆蓋率職責提出。
10. **ASSUM 無聲修改被擋**：修改 `@src ASSUM-x` 測試且 outcome `assum-reading-change`、卻無 revise／retire／supersede Transition → fail-closed；補上含 ackRef 的 Transition 後通過。
10b. **ASSUM delete／retag 不可繞過**：行為由 A 改為 B 後（i）刪除該 ASSUM 測試、（ii）retag 成 `EXPL` —— 兩種情形皆進入候選集合、皆需 batch result；含 `assum-reading-change` finding 而無通過反借用契約的 `resolutionRef` → fail-closed。純搬檔／換層且行為仍為 A → `findings` 為空，**不要求** Transition。
11. **ASSUM 升級**：`ASSUM → REQ` supersede 後，原測試 retag 至新 REQ 或對其重做 red→green，兩者皆為合法終局。
12. **EXPL 不被誤擋**：`@src EXPL` 測試通過結構層（不做 clause resolution），僅受語法與必要-suite policy 約束。
13. **exception-backed 綁定**：裸 `@src REQ-x` 在 current task 有兩個 DP resolve 到該 REQ 時 → fail-closed；改用 `REQ-x@DP-y` 後通過；恰一個候選時裸形式自動綁定成功。
14. **Exception chain 完整**：`targetConstraintRef` 指向非 hard-constraint REQ、`grantAuthorityRef != ownerRef`、或已過期 → 三種情形各自 fail-closed。
15. **Substitution 被擋**：低風險 run 有 tagged test 變更時，即使 red→green 齊備且 full suite 綠，`test-reviewer` 仍必須執行。
16. **機械結果會阻擋**：結構／來源違規時 `--provenance` 回 `status=fail` 且 **exit code 非 0**，arbiter 不出 `READY`；預設模式的 exit-0 契約未改變。
17. **git 錯誤不放行**：無法取得 base 側或判定 gate scope 時 → `status=fail`，不得回空集合當通過。
18. **Parameterized 混來源**：table 內不同 row 期望來自不同 clause → 必須拆成不同宣告，否則 finding 判 `scope-violation`。
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
32. **未處置即擋，且不可自陳**：batch fresh 且完整但含 `scope-violation` → `status=fail`；把該 finding **標成已處理卻未實際修復**同樣 fail（判準是 fresh batch 中不存在該 finding，不是 flag）。
33. **間接 oracle 變更被捕獲**：（i）修改帶斷言的 helper、（ii）修改 fixture／setup、（iii）更新 snapshot／golden 檔、（iv）改動外部 parameterized expected-data —— 四者皆使受影響測試以 `status=modified` 進 inventory 並需語義審查；宣告本體未動不構成豁免。
34. **無法歸屬即擋**：adapter 無法可靠解析的 assertion style（動態組裝／反射式斷言）→ fail-closed，**不得**視為 inventory empty。
35. **Grammar 解析層拒絕**：`DEC-x@DP-y`、`ASSUM-x@DP-y`、非 exception-backed 的 `REQ-x@DP-y` → 解析層即 fail-closed。
36. **結構重整可救**：container 改名使 `structuralId` 變動且無法唯一配對 → fail-closed；加上明示穩定 ID 後配對成功。單純搬檔（僅 path 變）→ `status=moved`，identity 維持。
37. **前態不被課現時效力**（上游 v1.7）：把測試從 inactive／superseded clause retag 到 active successor、或移除引用過期 exception-backed REQ 的測試 → **通過**，不因舊 binding 失效而被擋。
38. **拆掉 tag 不能脫逃**（上游 INV-B2 鏡射）：測試仍存在但移除 `@src` → inventory schema 層即非法（`status != deleted ⇒ tagAfter != null`），不得被誤讀成已刪除而跳過 post 驗證。
39. **move+retag 不繞過 ASSUM**：`@src ASSUM-x` 的測試同時搬檔、retag 成 `EXPL`、且讀法 A→B → 僅產生一筆 `status=moved`，但因 `tagBefore == ASSUM-x` 仍入候選；判 `assum-reading-change` 而無治理 witness → fail-closed。
40. **ASSUM 第二分支**：`@src ASSUM-x` 測試只有 `wrong-tag`（讀法仍為 A）→ **不**要求 ASSUM Transition；該 finding 依一般規則收斂即可。
41. **Fixed-point 閉環**：修復 `scope-violation` 後未重算 inventory／batch 即跑 `--provenance` → stale → fail；重算後通過。`supersede → REQ` 的 user witness 路徑可離開 review、重新核准後 `resume-task` 回到同一 taskId 繼續迴圈。
42. **effectiveOracleDigest 可重現**：兩個獨立 writer 對同一測試與其遞迴 dep 閉包算出相同 `bodyDigest`；dep 之間存在循環引用時不報錯、不重複計入；動態 dep 無法解析時 fail-closed。
43. **跨平台 digest 一致**：同一 repo 於 Windows 與 Linux 各算一次 `bodyDigest` 相同 —— path 為 repo-relative Git path、分隔符 `/`、大小寫取 Git tree 字面值、symlink 不跟隨。
44. **base／head 各自求閉包**：dep 在 base 與 head 有不同內容時，`baseBodyDigest` 與 `headBodyDigest` 分別以各自的 tree 計算，不得混用。
45. **反借用 — 舊 Transition**：同一 ASSUM 的**前一個 run** 的 Transition 被填入 `resolutionRef(mode="this-round")` → `semanticEvidence.taskId` 不符 → fail-closed。
46. **反借用 — sibling 挪用**：sibling test 已用過的 Transition 被另一個 test 填入 → `semanticEvidence.testRef`／body digest 不符 → fail-closed。
47. **反借用 — 治理 witness 未引用 evidence**：Transition 本身合法但其 `ackRef` 的治理 witness 未引用本輪 `semanticEvidenceRef` → fail-closed。
48. **Outcome 對位**：post binding 為 clause 但 `T.successor`（含 active successor chain）不等於該 clause → fail-closed；post 為 `EXPL`／deleted 時落入 cleanup 終局 → 通過。
49. **Historical-convergence 不被誤擋**：把引用早已 superseded ASSUM 的舊測試 retag 到其 active successor、或刪除 → `mode="historical-convergence"` 通過，**不要求**本輪 semantic evidence。
50. **Sibling 反向閉包**：兩測試同綁 `ASSUM-x`，只改其中一個並使 `ASSUM-x` 發生 Transition → 未改動的 sibling 以 `status=governance-affected`／`reason=governance-affected` 進 inventory 並須有 batch result；忽略它 → batch 不完整 → fail-closed。
51. **非收斂 hard lock**：迭代達 cap 或 fingerprint 重複 → `converged=false` → arbiter 不得 `READY`（即使 `--provenance` 因其他原因未 fail）；**任何當下具治理權的 principal**（user、arbiter，或該 clause 的 `governedBy` discipline）提供新 ruling／witness 即可開新 epoch 並解鎖；揭露含卡住 findings 與最後兩次 fingerprint。
52. **Crash recovery（逐邊界）**：（i）交易前 crash → tracked 無 `provenance-batch` record → scratch 一律視為 orphan、忽略重跑；（ii）交易後、scratch 收尾前 crash → tracked 有 record → 已提交；（iii）**tracked commit 存在但 scratch 全失** → 由 `provenance-batch` 的 snapshot **完整重建** batch 內容（非僅 digest）；（iv）batch 的 `batchDigest` 與 tracked record 不符 → checker `status=fail`。
53. **Canonical scope 涵蓋主要變更**（上游 v1.7）：（i）tag 不變、只改斷言；（ii）tag 與宣告本體皆不變、只改 golden／helper —— 兩者都必須進 canonical gate scope，不得落到 observe-only。
54. **穩定 clause 不擴散**：普通測試修改且其 clause 無生命週期事件 → **不**觸發反向閉包，其他 sibling 不進 inventory；只有 clause 發生 Transition／drift／expiry／語義變更才拉入。
55. **本輪 T 冒充 historical 被拒**：本輪剛建立的 Transition 填成 `mode="historical-convergence"` → 因 T 不存在於 base provenance snapshot → **fail-closed**；改走 `this-round` 並補齊綁定後通過。
56. **只有 governance-affected 也要審**：inventory 僅含 `governance-affected` entry 的 run，`test-reviewer` 仍不可 evidence-substituted，且 batch 必須覆蓋這些 entry。
57. **Discipline ruling 構成進展**：`governedBy = security` 的 ASSUM，其 security ruling／witness 從缺到齊 → fingerprint 前進（不判打轉）；於 `converged=false` 後提供該 ruling → **可開新 epoch**。
58. **Retire 原子性**：`ASSUM retire` 與其**所有** dependent DP 的 reopen 於**單筆** `commit-test-provenance-batch` 完成；中途狀態不可見。
59. **跨平台 testRef 一致**：同一 repo 於 Windows 與 Linux 產生相同的 `testRef` 與 `inventoryDigest`。
60. **Base witness 負向**：（i）batch 缺 inline `baseProvenance` → fail；（ii）`treeOid != inventory.baseTreeOid` → fail；（iii）`storeDigest` 不符 → fail；（iv）`treeOid` 中無 store 檔 → 採 canonical empty store，前態存在性一律為否（非 fail）；（v）`resume-task` 改換 base → 拒絕；（vi）batch 的 witness ≠ tracked `TaskState.baseProvenance` → fail。
61. **Successor chain 部分存在**：`T` 在 base store 中，但用來對位 post binding 的 successor chain **只有部分**在 base → **fail-closed**（不得只驗 T 本身）。
62. **Batch cardinality**：（i）clean batch 以 `resolutions=[]` 提交且**不**產生 Transition；（ii）兩個不同 ASSUM 的 finding → 兩個 group、兩筆 Transition；（iii）三個 sibling test 指向同一 ASSUM → 一個 group、三筆 `semanticEvidenceRefs`、共用一筆 Transition；（iv）同一 subject 的兩個 group 要求不同 successor／action → 整筆 fail-closed。
63. **明確 ref，不模糊搜尋**：checker 以 `provenanceBatchRef` 定位 batch；刻意造出 `(taskId, inventoryDigest, batchDigest)` 相同但內容不同的兩筆 record 時，仍能唯一定位且不誤採。
64. **Chain head**：（i）**該 task 尚無 batch ∧ committedRef == null → 合法未提交**，重跑而非 fail；（ii）已有 batch 但零個 tip → fail-closed；（iii）兩個以上 tip → fail-closed（reconciliation required）；（iv）`committedRef != 唯一 tip` → fail-closed；（v）scratch 全失後由 `TaskState` 取得 head 並重建。
65. **testRef／path 負向**：（i）`structuralId` 碰撞或配對歧義 → fail-closed；（ii）path 含 `\`、`./`、`..` → 拒絕；（iii）大小寫與 Git tree 記錄不符 → 拒絕；（iv）跟隨 symlink 產生的 path → 拒絕。
66. **單一 truth source**：Step 6 之後 checker **只讀** `TaskState.committedProvenanceBatchRef` 指向的 batchSnapshot；刻意讓 scratch proposal 與 committed batch 內容不同時，以 committed 為準且不因 scratch 而通過。
67. **Stale non-head ref**：`provenanceBatchRef` 指向自己 task 的**歷史非 head** batch（其自身 digest 正確）→ 因 `!= TaskState.committedProvenanceBatchRef` 且 `!=` 唯一 tip → **fail-closed**。
68. **Cross-task chain**：`previousBatchRef` 指向**他 task** 的 batch → fail-closed。
69. **首筆 batch**：`previousBatchRef == null` 且 pre-state `committedRef == null` → 通過並原子更新；若 pre-state 已有 head 而 `previousBatchRef` 仍為 null → fail-closed。
70. **Ledger 有明確 ref**：`testProvenance.provenanceBatchRef` 存在，事故診斷不需回頭做被禁止的 digest tuple 查找。
71. **inventoryDigest 唯一公式**：`entries` **完全相同**但 `baseTreeOid` 不同 → `inventoryDigest` **必須不同**（證明 base-tree proof 真的進入 envelope）。
72. **Draft／persisted 欄位同步**：本文與 intent-scan 對同一 payload 使用相同型別名 —— 輸入 `ResolutionGroupDraft.transitionDraft`、持久 `ResolutionGroup.transitionRef`。
73. **`assum-reading-change` 端到端可達**：一個含 `assum-reading-change` finding 的 run，在**單一** `commit-test-provenance-batch` 內同時鑄造 successor ASSUM、revise Transition、DP repoint 與 batch record 後通過 Step 6；全程無第二筆交易、無中間態落盤。此 AC 為 v1.0→v1.1 退版的直接對應測試，**必須實際執行該路徑**，不得以「相關不變量已被其他測試覆蓋」替代。
74. **revise successor 的 ASSUM 欄位全驗**：批次鑄造的 successor ASSUM 缺 `routingOrigin`、或其值的 `layer`／`governedBy`／`basisRefs` 義務未滿足 → fail-closed；`successorClauseDraft.id != transitionDraft.successor` → fail-closed。
75. **retire 路徑不得帶 draft**：`assum-reading-change` 收斂為 retire（`successor=null`）時附 `successorClauseDraft` → fail-closed；carrier 僅接受 `clear`／`unchanged-null`。
76. **退出條件由 successor 決定，不由 `governedBy` 決定**：`transition.successor` 為 REQ 時走 §6 退出重審路徑，即使 `governedBy` 是 `{kind: discipline, discipline: security}`；反之 successor 為新 ASSUM／DEC 時**不**退出。任何把 `governedBy` 比對成 `user`／`plan-gate` 的實作 → 視為錯誤（ReviewerPrincipal 無此構造子，該比對恆為 false，會使退出路徑靜默失效）。
77. **`ASSUM → 新 REQ` 端到端可達**：plan gate 核准後 `resume-task` 回到同一 taskId，在**單一** `commit-test-provenance-batch` 內同時鑄造新 REQ、supersede Transition、DP 更新、semantic evidence、plan-gate witness 綁定與 batch record，並通過 Step 6。**必須實跑該路徑**，不得以「REQ 已預先存在」的窄案例替代。
78. **`DEC → 新 REQ` 端到端可達**：同上，subject 改為 DEC（上游 matrix 的 `DEC supersede，successor=REQ → kind=user` 一列）。此列與 ASSUM 一列的授權來源相同但 subject tier 不同，**必須各自實跑**，不得只測其一。
79. **REQ 鑄造的 witness 負向**：`authorityRef.kind != user`、`ackRef.kind != plan-gate`、plan-gate 的 `target`／`successor`／`impact`／`disposition` 任一與 Transition 不符、REQ tier 不在 {approved-requirement, compatibility}、或 subject 不是 ASSUM／DEC → **整筆 no-write fail-closed**，store bytes 與 `TaskState.committedProvenanceBatchRef` 皆完全不變。特別是 **successor 對位**：一筆核准「取代 ASSUM-x」但 `successor` 指向 REQ-a 的 plan-gate record，用來授權 `ASSUM-x → REQ-b` → fail-closed。
80. **未授權的 clause 類型**：`successorClauseDraft` 的 tier 既非 ASSUM 亦非合法 REQ（例如 DEC successor 卻缺其 matrix 所需 witness）→ fail-closed；批次不得鑄造 rule 6 未列舉的任何 clause 類型。
81. **sibling 聚合**：三筆綁同一 `ASSUM-x` 的 sibling findings → **一個** group、**一個** successor、**一筆** Transition、三筆 `semanticEvidenceRefs`，且 witness 的 `resolutionGroupDigest` 涵蓋全部三筆。
82. **重複 subject 與衝突 payload**：`resolutions[]` 出現兩筆相同 `subjectRef`（不論 payload 是否一致，含 successor／action 相同而 `text`／`routingOrigin`／`basisRefs` 不同者）→ fail-closed 且 **store bytes 完全不變**；writer 不得隱式合併或擇一。
83. **carrier updates 覆蓋負向**：`resolutionCarrierUpdates[]` 少一個 dependent DP、或多一個未改動 terminal 的 DP → 兩者各自 fail-closed 且 **no-write**。

## 14. 邊界與非目標

- 不動 intent scan、DP 分流、治理 checkpoint。**store script 命令面例外**：本 spec 需要 intent-scan v1.7 的 `commit-test-provenance-batch`（0..N ResolutionGroup、`successorClauseDraft`、`resolutionCarrierUpdates[]`）與 `successor=null` retire（v0.5 的「不改命令面」宣稱已撤回）。
- **不設測試數量上限** —— demo1 實測顯示數量不是正確的打擊目標（69 vs 258，兩組 adjusted mutation 皆 10/10）；治的是來源，不是數量。
- 不管 gate scope 外的既有測試（brownfield 邊界，範圍定義見 shared model §9）。
- 語義判斷不宣稱機械保證（§10）；本 spec 保證的是它不被跳過、結果為 typed、機械後果被強制執行。
