# Test-Provenance Implementation Spec

- 狀態：draft v0.1 —— 審閱中
- 日期：2026-07-25
- 上游：`2026-07-25-shared-decision-provenance-model.md`（**approved v1.6**）。不重新定義任何 shared concept；附加欄位一律標為 annotation 且不改上游語義。
- 姊妹 spec：`2026-07-25-intent-scan-spec.md`（**approved v1.0**）。provenance store、store script、gate scope、task manifest、Review Packet 接線由該 spec 定義，本文**消費而不重定義**。

## 1. 目的與範圍

落地方案三的另一半：**斷言來源標記**與**沉默即不斷言**，並把上游 §9 的三層檢查接進 `contract-check.mjs`。

治的是 demo1 實測到的具體病灶：CTide 寫 258 個測試、對 frozen oracle 有 23 個不相容，全部是「規格沒點名的情況，自行決定答案後用測試釘死」；其中 10 條 Retry-After 測試無一碰到規格寫著的 `plain-object` 邊界 —— 規格原文的修飾詞在走到測試的路上蒸發。

**不含**：intent scan、DP 分流、治理 checkpoint、store script 命令面（皆屬 intent-scan spec）。

## 2. Tag 語法與粒度

粒度取 **test 層級**（一個 `test`／`it`／`def test_`／`#[test]` 宣告一個 tag）。斷言層級太細 —— 258 個測試底下約 800 個斷言，逐條標會變成新的儀式。

```
// @src REQ-01J9XKQ…      ← 緊鄰宣告的前一行，中間不得有空行
test("duplicate eventId 回傳同一個 promise，不會再送一次", …)
```

- **合法值**：`REQ-<ULID>` | `DEC-<ULID>` | `ASSUM-<ULID>` | `EXPL`（上游 §1 四種權威）。
- **每個 test 恰好一個 tag**。需要引用兩個來源者，**必須拆成兩個 test** —— 拆出來的那個得自己找來源，這正是攔截「掛名 AC、實際釘設計選擇」的結構。
- Parameterized／table-driven 測試：一個宣告一個 tag，涵蓋其全部 case。
- 測試檔內的 helper、fixture、共用 setup 不需 tag。

**宣告偵測（per-language，closed config）**：checker 以一份可擴充的語言 pattern 表定位測試宣告（`js/ts: test(|it(|describe(`、`python: def test_`、`go: func Test`、`rust: #[test]`、`java: @Test`…）。**變更的測試檔語言不在表內 → fail-closed**（訊息指明可在 config 註冊 pattern）—— fail-open 會靜默豁免整個檔案，正是本 spec 要防的。

## 3. 沉默即不斷言（減法規則）

**引不出 `REQ-`／`DEC-`／`ASSUM-` id，就不要寫這個斷言。**

寫測試時撞到「想斷言但引不出來」，處置依上游分流（intent-scan spec §5–§6）：

| 情境 | 處置 |
|---|---|
| 規格明文可推導 | 該條款應已是 REQ；引它 |
| 規格沉默、屬產品語義 | intent fork → **回 plan gate**（test-time 發現的 intent fork 必經 plan gate，上游規定） |
| 規格沉默、屬實作選擇 | implementation DP → 依上游 row 5／7；**要斷言才建檔**（ephemeral 不入模型） |
| 只是想探索行為 | `EXPL`，且依 §5 決定是否進必要 suite |

**這條規則是減法。**demo1 中 CTide 多寫的 189 個測試多殺 **0** 個 mutant（實測 adjusted mutation 兩組皆 10/10），卻夾帶 22 個多餘假設把 oracle eligibility gate 弄掛 —— 零上檔、全部下檔。少寫這些測試同時提高分數與速度。

## 4. Tag scope 約束（本 spec 的核心語義規則）

**一個 test 的所有斷言都必須落在其 tag 所指 clause 的範圍內。**

反例（demo1 實錄）：測試名為 `a duplicate eventId returns the exact same promise and never re-sends`（去重），斷言卻包含 `attempts: 0, inFlight: 0` —— 那是實作自選的 `await null` 時序，不是去重契約。此測試對 frozen oracle 失敗，而失敗原因與它宣稱測試的東西無關。

- 混了範圍 → **拆成兩個 test**，各自找來源。
- 這是**語義判斷**，歸 `test` discipline（上游 §11）；機械層只驗 tag 存在與 id 可解析（§6、§9 assurance boundary）。

## 5. 紅燈處置（suite 一律綠；tag 表權威，不表 CI 行為）

上游 §1 的四種權威決定紅燈的**合法處置集合**，不決定 exit code —— 必要 suite 內一律綠：

| tag | 紅燈合法處置 |
|---|---|
| `REQ` | 修實作；或依上游 §7 走**授權**的 clause 變更（supersede／retire Transition，witness 齊備） |
| `DEC` | 恢復行為；或由同／更高治理權威（`approvedBy` principal 或 arbiter）建 supersede Transition |
| `ASSUM` | 恢復行為；或建 revise／retire Transition（`governedBy` principal 或 arbiter，ackRef 附具名理由）—— **不得稱為 requirement regression** |
| `EXPL` | 更新或刪除自由 |

`EXPL` 二選一：進必要 suite 就得保綠；要真 non-gating 就放在必要 suite 之外。

**機械化的部分**（其餘歸 test-reviewer）：

```
gate scope 內，本次刪除或修改了 @src ASSUM-x 的測試
  ∧ 該 ASSUM 的選定讀法實際改變
  → ASSUM-x 必須有本 run 的 revise／retire Transition（含 ackRef）  ← 缺 → fail-closed
gate scope 內，本次刪除了 @src REQ-x 的測試
  → REQ-x 必須已 superseded／retired（Transition witness 齊備）      ← 缺 → fail-closed
```

前者的「讀法實際改變」是語義判斷（test-reviewer 認定）；**一旦認定，Transition 的存在與 witness 完整性是機械檢查**。這讓「revision-allowed」不等於「可以無聲改掉」。

## 6. `contract-check.mjs` 落地上游三層檢查

上游 §9 已定義層次與 fail 行為；本節只定義接線。checker 讀 `.ctide/provenance.json`（tracked）與 scratch manifest，**不自行寫入**。

| 層 | 本 checker 做什麼 | 失敗 |
|---|---|---|
| 結構 | 變更測試的 tag 存在、可解析到 clause、clause `active ∧ mechanicallyApplicable`；exception-backed 另驗 `scopeRulingRef`（`by=intent` ∧ `subjectRef==DP`）；§5 的兩條 Transition 存在性檢查 | **fail-closed** |
| 來源 | Source 存在、Check A（snapshot 自洽）、Check B（`driftMode=repo-file` 的 live drift）、exception expiry／`targetConstraintRef`／`grantAuthorityRef == ownerRef` | **fail-closed** |
| 語義 | 不做 —— 移交 test-reviewer（§7） | — |
| Legacy | gate scope 外：允許全量觀測，findings **observe-only**，不阻擋本 run | fail-open |

**Gate scope 沿用 intent-scan spec §9 的單值定義**（本次新增／修改的測試 ∪ 其 `@src` 直接引用的 clause 與 Source ∪ 本次新增／修改的 clause／Source／Transition ∪ INV-4 影響閉包）。本 spec 不另立範圍。

**既有 machine block 相容**：`acceptanceCriteria[]`／`assumptions[]` 由 store 導出（intent-scan spec §8），checker 既有的 presence-only 判斷不變；本 spec 新增的是上表結構／來源兩層。

## 7. test-reviewer 的語義審查（改變被問的問題）

現行 test-reviewer 被問「哪裡覆蓋不足」。demo1 顯示它在這個提問下什麼也沒抓到 —— 因為問題不在覆蓋率，在**多出來的東西**。改問四件事：

1. 每個變更測試的 tag 是否正確（引的 clause 真的支持這些斷言）。
2. 有無斷言**超出 tag 範圍**（§4）—— 需要拆分的地方。
3. 有無斷言**引不出來源**卻仍存在（§3 減法規則）。
4. `ASSUM` 測試的讀法是否已實際改變而未走 revise／retire Transition（§5 語義前提）。

覆蓋率仍是它的職責，但不再是唯一提問；**per-AC 紅→綠要求不變**（§8）。

## 8. 與 `verification-gate.md` 的關係

**本 spec 不削弱任何既有要求**：`REQ(kind=acceptance)` 的 behavior-changing criterion 仍需示範 red→green，仍是 arbiter bidirectional traceability 的輸入。本 spec 加的是**第三個方向**：

```
既有：criterion → verifying test（覆蓋）
既有：changed file → criterion（scope creep，檔案粒度）
新增：test → source（assumption creep，斷言粒度）
```

demo1 的 23 個假設全數通過前兩個方向 —— 它們是「額外的」測試，落在合法變更的測試檔內。第三個方向是唯一能看見它們的角度。

## 9. Assurance boundary（明文）

- 機械層止於：tag 存在／可解析、clause active ∧ mechanicallyApplicable、Source 檢查、Transition 存在與 witness 完整性。
- **不宣稱**：斷言是否真被 clause 蘊含（語義蘊含）、tag 是否選對、`ASSUM` 讀法是否改變 —— 皆歸 test discipline。
- presence 級檢查**不得**被報成 provenance 完整保證（failure memory：presence-only check 曾被當 coverage 讀）。

## 10. Run ledger 觀測（非 gate，一 run 一 record）

snapshot 寫入 scratch，於既有 verdict 後的**單一** run record 無條件帶入（不綁報告格式 sentinel）：

```
testProvenance: {
  taggedTests: { REQ: n, DEC: n, ASSUM: n, EXPL: n },
  untaggedChangedTests: n,        // 應為 0（否則 fail-closed 已擋）
  assumRevisionTransitions: n,
  splitForScopeViolation: n,      // test-reviewer 認定後實際拆分數
  droppedForNoSource: n,          // 依 §3 減法規則未寫成的斷言（自陳）
  languagePatternMisses: n
}
```

觀測值永不當 gate；`droppedForNoSource` 上升是紀律生效的訊號，不是退步。

## 11. 修改檔案清單

| 檔案 | 變更 |
|---|---|
| `cressetide/skills/vigil/references/test-provenance.md` | **新增** —— §2–§5、§7 協定本體（plugin 慣用英文） |
| `cressetide/skills/vigil/scripts/contract-check.mjs` | 新增結構／來源兩層（§6）；既有 presence-only 判斷不變 |
| `cressetide/skills/vigil/scripts/test-language-patterns.json` | **新增** —— §2 的 closed 語言 pattern config（可擴充） |
| `cressetide/agents/test-reviewer.agent.md` | §7 的四個提問；覆蓋率不再是唯一提問 |
| `cressetide/skills/vigil/references/verification-gate.md` | 明文記載第三個 traceability 方向；紅→綠要求不變 |
| `cressetide/agents/arbiter.agent.md` | traceability 加 `test → source` 方向；讀 checker 的結構／來源層報告 |
| `cressetide/skills/vigil/references/review-packet.md` | packet 帶變更測試的 tag 清單與其 clause |
| `cressetide/skills/vigil/references/test-layer-boundaries.md` | 澄清：本 spec 管 tag 與來源，不改「哪一層」的判斷 |
| `cressetide/skills/vigil/scripts/run-ledger.mjs` ＋ `references/run-ledger.md` | `testProvenance` 欄位 |

## 12. 驗收條件

1. **HeaderBag 重演**：以 demo1 webhook 案例重跑，`Retry-After` 相關測試必須各自引用條款；引用「plain-object response headers 以 `Object.entries()` 順序…」的那條在撰寫時即暴露 `plain` 修飾詞。
2. **範圍違規可見**：`duplicate eventId` 測試若含 `attempts: 0` 斷言，test-reviewer 判為超出 tag 範圍並要求拆分。
3. **無來源斷言不存在**：13 條 constructor error-type 測試（規格只寫「`TypeError`／`RangeError`」未給映射）引不出 clause → 不寫，或先經 plan gate 成為 REQ／ASSUM。
4. **未標記即擋**：變更測試缺 `@src` → 結構層 fail-closed。
5. **失效 clause 即擋**：`@src` 指向 superseded／retired／非 applicable clause → fail-closed，要求 retag 或重新裁決。
6. **語言未註冊即擋**：變更的測試檔語言不在 pattern config → fail-closed（非靜默略過）。
7. **ASSUM 無聲修改被擋**：修改 `@src ASSUM-x` 測試且讀法改變、卻無 revise／retire Transition → fail-closed；補上含 ackRef 的 Transition 後通過。
8. **REQ 測試刪除**：刪除 `@src REQ-x` 的測試而 REQ 未 superseded／retired → fail-closed。
9. **Legacy 不阻擋**：gate scope 外的既有未標記測試產生 observe-only findings，不阻擋本 run。
10. **紅→綠不被削弱**：behavior-changing 的 `REQ(kind=acceptance)` 仍需示範 red→green；缺少時 arbiter 不出 `READY`。
11. **EXPL 二選一**：`EXPL` 測試在必要 suite 內保綠；宣稱 non-gating 卻留在必要 suite → 由 test-reviewer 指出。
12. **Assurance boundary 不誇大**：checker 報告明示「presence／resolution 級」，未宣稱語義蘊含已驗。
13. **Ledger 單筆**：`testProvenance` 只出現在最終 run record，不因報告 sentinel 缺失而遺漏。

## 13. 邊界與非目標

- 不動 intent scan、DP 分流、治理 checkpoint、store script 命令面（intent-scan spec）。
- **不設測試數量上限** —— demo1 實測顯示數量不是正確的打擊目標（69 vs 258，兩組 mutation 皆 10/10）；治的是來源，不是數量。
- 不管 gate scope 外的既有測試（brownfield 邊界）。
- 語義判斷不宣稱機械保證（§9）。
