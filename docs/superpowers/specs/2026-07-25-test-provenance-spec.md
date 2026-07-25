# Test-Provenance Implementation Spec

- 狀態：draft v0.2 —— 一輪修訂（REQ 生命週期解耦、ChangedTestInventory／TestSemanticFinding 輸入契約、test-reviewer 不可 substitution、exception-backed test→DP 綁定、EXPL 結構分支）；審閱中
- 日期：2026-07-25
- 上游：`2026-07-25-shared-decision-provenance-model.md`（**approved v1.6**）。不重新定義任何 shared concept；附加欄位一律標為 annotation 且不改上游語義。
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

- **合法值**：`REQ-<ULID>` | `DEC-<ULID>` | `ASSUM-<ULID>` | `EXPL`。
- **每個測試恰好一個 tag**。需要兩個來源者**必須拆成兩個測試** —— 這正是攔截「掛名 AC、實際釘設計選擇」的結構。
- **Parameterized／table-driven**：一個宣告一個 tag 涵蓋其全部 row；**但若不同 row 的期望來自不同 clause，必須拆成不同宣告** ——「一宣告一 tag」不使 mixed-source table 合法。
- **exception-backed REQ 的限定形式**：`@src REQ-x@DP-y`（見 §7 Blocker 4 規則）。
- helper、fixture、共用 setup 不需 tag。

**偵測單位是 framework adapter，不是 per-language regex**：

```
adapter = { adapterId, language, framework, testDeclarationPatterns,
            containerPatterns（不承載 tag，如 describe/context/suite）,
            attachmentRule（前置註解｜decorator｜attribute｜annotation） }
```

- `describe(`／`context(`／`suite(` 等是 **container**，不承載 tag，也不因未標而報錯。
- decorator／attribute 型（`@Test`、`#[test]`、`@pytest.mark.parametrize`）由 adapter 的 `attachmentRule` 指定 tag 註解相對於 decorator 的位置。
- **變更的測試檔找不到適用 adapter → fail-closed**（訊息指明可註冊 adapter）。註冊單位是 **framework**：`js/ts` 已註冊不代表 Jest／Vitest／Playwright 的語法都被涵蓋，未涵蓋者一律 fail-closed，不得靜默漏判。

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

**DEC 不設對應規則**：DEC 測試消失可能造成 coverage gap，但不等於 DEC 生命週期改變 —— 補一條「DEC test 刪除 ⇒ DEC Transition」會重犯同一個型別錯誤。

### 唯一與 clause 生命週期連動的機械規則

```
gate scope 內，本次修改了 @src ASSUM-x 的測試
  ∧ TestSemanticFinding.readingChanged == true（§6，由 test discipline 認定）
  → ASSUM-x 必須有本 run 的 revise／retire／supersede Transition（含 ackRef）
  → 缺 → fail-closed
```

語義前提由 reviewer 認定並以 **typed finding** 交付；**一旦認定，Transition 的存在與 witness 完整性是機械檢查** —— 讓「revision-allowed」不等於「可以無聲改掉」。

## 6. 輸入契約（checker 的 canonical 輸入；無此二者則 §5／§12 不可實作）

### `ChangedTestInventory`（per-run scratch，由 base／head 兩側內容導出）

```
entries[]:
  testRef:        { path, declarationName, adapterId }（deleted 者取 base 側）
  status:         added | modified | deleted | retagged | moved
  tagBefore:      REQ-… | DEC-… | ASSUM-… | EXPL | null
  tagAfter:       同上 | null
  framework:      adapter 回報
matching 規則（closed，依序）：
  1. (path, declarationName) 相等                → modified／retagged
  2. (tag, declarationName) 相等但 path 不同     → moved
  3. 其餘 head-only → added；base-only → deleted
```

Inventory 是**機械導出**，不含語義判斷。REQ 的 after-state coverage（§5）只需 head 側資料即可計算，rename 追蹤僅供報告與 ASSUM 候選集使用。

### `TestSemanticFinding`（test discipline 的 typed 輸出；**不解析 prose**）

```
{ testRef, clauseRef, readingChanged: bool, scopeViolation: bool,
  rulingRef: RecordRef(kind=review-ruling) }
```

- reviewer 產出 **proposal**；main thread 經 store script 固化為 review-ruling record（`by = {discipline: test}`；`subjectRef` = 該 **clause ref**，符合上游 subjectRef 型別；testRef 置於 ruling payload 內）。
- checker 與 arbiter **只消費此 typed artifact**，不讀 reviewer 敘述。
- 缺少對應 finding 的候選項（有修改的 ASSUM 測試、疑似 scope 違規）→ 視同語義審查未完成 → §8 的 non-substitutable 規則與 arbiter panel-gap 邏輯接手。

## 7. exception-backed REQ 的 test → DP 綁定

上游 applicability 是 `applicable(clause, DP)`，`scopeRulingRef` 也掛在 DP 上；tag 只有 `REQ-x` 時，一個 exception-backed REQ 若 resolve 多個 DP，checker 無法知道該驗哪個。**closed rule**：

```
限定形式 @src REQ-x@DP-y 永遠合法，且對 exception-backed REQ 為建議寫法
裸形式 @src REQ-x：
  於 current task manifest 內反推 resolvedBy == REQ-x 的 DP
  恰好一個候選 → 自動綁定該 DP
  零個或多個候選 → **fail-closed**（訊息要求改用限定形式）
非 exception-backed 的 REQ 不需 DP 綁定
```

## 8. `contract-check.mjs` 落地與機械結果

checker 讀 `.ctide/provenance.json`（tracked）、scratch manifest、`ChangedTestInventory`、已固化的 `TestSemanticFinding` ruling records，**不自行寫入**。

| 層 | 內容 | 失敗 |
|---|---|---|
| 結構（`REQ`／`DEC`／`ASSUM`） | tag 存在、可解析到 clause、clause `active ∧ mechanicallyApplicable`（per-kind，上游 §2）；exception-backed 依 §7 綁定 DP 後驗 `scopeRulingRef`（`by = {discipline: intent}` ∧ `subjectRef == 該 DP`）；§5 的 ASSUM Transition 存在性 | **fail-closed** |
| 結構（`EXPL`） | **不做 clause／Source resolution** —— 只驗 tag 語法與必要-suite policy | fail-closed（僅語法／policy） |
| 來源 | Source 存在、Check A、Check B（`driftMode=repo-file`）；`contentKind=exception-grant` **完整鏈**：resolve `targetConstraintRef` → target 必須是 `authority=hard-constraint` 的 REQ → `grantAuthorityRef == target.ownerRef` → 未過期 | **fail-closed** |
| 語義 | 不做 —— 消費 §6 的 typed finding，其認定本身移交 test-reviewer（§9） | — |
| Legacy | gate scope 外：允許全量觀測，findings **observe-only** | fail-open |

**機械結果與阻擋層**（既有 `contract-check.mjs` 明寫 fail-open、git 錯誤回空集合、永遠 exit 0 —— 不可依賴其現行 exit code 表達 fail-closed）：

```
新增 --provenance 模式：
  輸出 machine result { provenance: { status: pass|fail, violations[] } }
  gate scope 內的結構／來源違規 → status=fail ∧ **exit code 非 0**
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

**Substitution 例外（改 `reviewer-selection.md`）**：current task 只要有**新增／修改／刪除／retag 的 tagged test**，或存在未回答的 provenance-semantic question，`test-reviewer` **不得** evidence-substituted —— 除非那些判斷已由另一個等價的 typed semantic gate 完成。現行規則允許低／中風險以 red→green＋full-suite green 跳過它，那會繞過本 spec **唯一**的語義控制點。

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
  semanticFindings: { scopeViolation: n, readingChanged: n },
  assumTransitions: n,
  adapterMisses: n,
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
| `cressetide/skills/vigil/scripts/changed-test-inventory.mjs`（＋tests） | **新增** —— §6 base／head 導出 |
| `cressetide/agents/test-reviewer.agent.md` | §9 四個提問；typed finding 輸出格式 |
| `cressetide/skills/vigil/references/reviewer-selection.md` | §9 的 substitution 例外 |
| `cressetide/skills/vigil/references/verification-gate.md` | 記載第三個 traceability 方向；紅→綠不變 |
| `cressetide/agents/arbiter.agent.md` | `test → source` 方向；執行並讀 `--provenance` 機械結果 |
| `cressetide/skills/vigil/references/review-packet.md` | packet 帶 inventory 摘要與變更測試的 tag／clause |
| `cressetide/skills/vigil/references/test-layer-boundaries.md` | 澄清：本 spec 管 tag 與來源，不改「哪一層」的判斷 |
| `cressetide/skills/vigil/scripts/run-ledger.mjs` ＋ `references/run-ledger.md` | `testProvenance` 欄位 |

## 13. 驗收條件

1. **HeaderBag 重演**：demo1 webhook 案例重跑，引用「plain-object response headers 以 `Object.entries()` 順序…」的測試在撰寫時即暴露 `plain` 修飾詞。
2. **範圍違規可見**：`duplicate eventId` 測試含 `attempts: 0` 斷言 → typed finding `scopeViolation=true` → 要求拆分。
3. **無來源斷言不存在**：13 條 constructor error-type 測試引不出 clause → 不寫，或先經 plan gate 成為 REQ／ASSUM。
4. **未標記即擋**：變更測試缺 `@src` → 結構層 fail-closed。
5. **失效 clause 即擋**：`@src` 指向 superseded／retired／非 applicable clause → fail-closed。
6. **Adapter 未註冊即擋**：變更測試檔的 **framework** 未涵蓋（如已註冊 js/ts 但未涵蓋 Playwright 語法）→ fail-closed，非靜默略過。
7. **拆分不誤殺 REQ**：把一個 mixed-scope REQ 測試拆成兩個（舊宣告刪除、兩個新宣告加入），REQ **維持 active**、**不要求任何 Transition**；after-state 每個 behavior-changing criterion 仍有 verification evidence → 通過。
8. **After-state 失覆蓋才擋**：刪除某 behavior-changing criterion 的唯一測試且無替代 → fail-closed（依 verification-gate，非 clause 生命週期規則）。
9. **DEC 無對應規則**：刪除 `@src DEC-x` 測試不要求 DEC Transition；若造成 coverage gap 則由 test-reviewer 以一般覆蓋率職責提出。
10. **ASSUM 無聲修改被擋**：修改 `@src ASSUM-x` 測試且 finding `readingChanged=true`、卻無 revise／retire／supersede Transition → fail-closed；補上含 ackRef 的 Transition 後通過。
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

## 14. 邊界與非目標

- 不動 intent scan、DP 分流、治理 checkpoint、store script 命令面（intent-scan spec）。
- **不設測試數量上限** —— demo1 實測顯示數量不是正確的打擊目標（69 vs 258，兩組 adjusted mutation 皆 10/10）；治的是來源，不是數量。
- 不管 gate scope 外的既有測試（brownfield 邊界，範圍定義見 shared model §9）。
- 語義判斷不宣稱機械保證（§10）；本 spec 保證的是它不被跳過、結果為 typed、機械後果被強制執行。
