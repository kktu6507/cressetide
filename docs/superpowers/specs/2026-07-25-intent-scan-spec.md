# Intent-Scan Implementation Spec

- 狀態：**draft v1.10 — 未審核**（最後 approved baseline 仍為 **approved v1.9**，2026-08-09 panel 放行）。v1.10 尚**未** approved、**未**經 panel 放行，**不**代表 implementation READY；核准之前一律以 **approved v1.9** 為生效契約。**v1.10 draft delta**：本輪**只做一件事** —— 把 §8 的 `<PREFIX>-<ULID>` 中那個從未定義的 `ULID` 收斂成 exact canonical grammar（Crockford uppercase alphabet、恰 26 ASCII bytes、首字元限 `0`–`7` 以排除 128-bit overflow、拒絕 lowercase 與 `I`／`L`／`O`／`U` alias、不 trim／不 normalize／不 case-fold、不吻合即 fail-closed），並明定它適用於**所有** authored／persisted ULID 而不只新鑄造結果，以及 `migrate-store-v1-to-v2` 遇 non-canonical id 必須 no-write fail-closed。本文件自此是該 grammar 的**唯一** normative authority；下游只引用。新增 **AC92**（grammar 與邊界，含 overflow／長度／case／alias／whitespace／非 ASCII 的單變數負例）與 **AC93**（draft／implementation boundary）。**AC1–91 的編號與文字一字未動**；ULID 的 collision、timestamp、monotonic generation 與 merge semantics 皆未改變；本輪**未修改任何程式或測試**。Draft candidate coupled set：**shared-decision-provenance-model approved v1.13（內容未變）** ＋ **intent-scan draft v1.10** ＋ **test-provenance draft v1.8**。以下為 v1.9 及更早的既有歷史，原文保留：**approved v1.9**（2026-08-09 panel 放行；前一放行版本 approved v1.8，2026-08-08 panel 放行）。實作以本文為準；變更需重新過 panel。本版與 **shared-decision-provenance-model v1.13**、**test-provenance v1.6** 為 **coupled set**，2026-08-09 panel 同輪一併放行；三者不得分開採用。 **本次放行只核准規格本身**，不代表 implementation、populated inventory、migration、push 或 Phase 2 已就緒；AC138 的限制持續有效 —— AC128 的 legacy boundary 尚未實作並通過前，不得宣稱 Phase 1／2A 完全不受影響。 v1.9 是 **command contract 變更**，因此本文退回 draft：`commit-test-provenance-batch` 的 payload 新增 typed 必填欄位 **`expectedInputProvenanceStoreDigest`**，並在 §8 新增交易內的 **inventory binding 等式鏈**。動機來自下游 test-provenance draft v1.6 的 direct inspect：現行的 pre-state 保護只有 **invocation option** `expectedStoreDigest`（`--expect-digest`）—— 可省略、caller 給定、且**不落盤**，能擋 race 卻無法在事後證明某個成功 batch 出自哪個 pre-state。**初稿曾宣稱新欄位「已由 `inventoryDigest` 遞移持久化」、因此 shared model 不需修改 —— 該宣稱撤回**：record 只存 opaque digest，writer 沒有 typed preimage 可驗該 digest 內用的是哪個 pre-state，caller 可讓 payload 追上實際 pre-state 卻仍送舊 digest 而完全不被察覺。修正方式是把 preimage 本身持久化：`batchSnapshot` 新增完整 typed `inventorySnapshot: ChangedTestInventoryV2`，`record.inventoryDigest` 由它派生，writer 在同一筆交易內重算並比對三段等式。該持久化欄位屬上游 record 形狀，因此 **shared model 一併退回 draft v1.13**。v1.9 新增契約在 draft 期間不得實作；該限制已隨 v1.9 核准解除。前一放行版本說明：approved v1.8。實作以本文為準；變更需重新過 panel。v1.8 一處：來源 2 的條件 3 改為要求 writer 把因果**持久化**為上游 SM §2 的 **`reopenCauseRef`**；AC75／77／78 收窄為只對帶該 witness 的 DP 執行；新增 §8 的 **writer lifecycle 盤點**（逐一列出每個會改動 DP terminal／status 的交易該 set／clear／replace／preserve），AC72／81 補上 witness 的明確比對，新增 AC80（歷史 reopen 不因 prior 日後取得 successor 而被重新分類）與 AC82–90（caller 不得取得 normative effect、TransitionRef 形狀負向、borrowed Transition、non-source-2 DP 帶 witness、三種生命週期轉換、legacy absence、以及每個拒絕的 no-write 邊界），原 batch 正例順延為 AC81。§8 另新增正式的 **`migrate-store-v1-to-v2`** domain transaction（含**版本分派**、**migration-only v1 pre-validator**、exact 允許變更集、CAS／lock／temp／atomic replace 與 crash／no-write 契約），AC89 改為八格可執行矩陣，並新增 AC91（未受影響 DP 的 witness preserve 正例）。v1.7 的 loader 端 graph-shape 推斷已撤回 —— 它會誤判明示 `reopen-dp` 後才被 supersede 的 DP，以及共用同一 prior 的第二個 deferred reopen。v1.8 變更在 draft 期間不得實作；該限制已隨 v1.8 核准解除。v1.7 內容：v1.7 一處，來自 Phase 1A 實作暴露的**無合法 action 狀態**：`replace-terminal`／`supersede-requirement` 的 successor 非 null，但某個持有 carrier 的 **dependent DP** 因該 successor 對它不 applicable 而被 dependent closure reopen 時，四個 carrier action 全部落空（`preserve` 無 terminal 可對齊、`replace` 會把 carrier 留在非 resolved 的 DP、`unchanged-null` 因 pre-state carrier 非 null 不成立、`clear` 因 v1.6 要求 post-state resolved 不成立）。§8 把 `clear` 拆為三個互斥且各自封閉的來源 —— **來源 1 `resolved-direct`**（v1.6 條件逐字保留）、**來源 2 `reopened-dependent`**（新增，**十項**條件＋明文安全邊界）、**來源 3** 既有 retire／`reopen-dp`（原封不動）。來源 2 適用 `replace-terminal(successor != null)`、`supersede-requirement`，以及 `commit-test-provenance-batch` 中 `successor != null` 的 ResolutionGroup —— 三者執行同一套 dependent closure，§8 另附 batch 的欄位對位。持久化的 `reopenedBy` 一律是上游 SM §8 既有 semantic member「terminal clause 失效且無後繼（INV-4）」，其 **intent-scan v1 序列化**為 `terminal-invalidated-no-successor`（該字串的 authority 在本文，shared model 定義的是語義成員而非字串）；`successor-not-applicable` 只是 writer 在交易內推導的 **transaction-local cause**，不持久化、不是 enum 成員、也不出現在任何 payload（初稿曾把它寫成 trigger 值，那等於在上游 closed list 之外發明成員）。來源 2 的 eligibility **完全由 writer 推導**（dependent membership ∧ `applicable(...) == false` ∧ closure 確實 reopen），caller payload 不參與 —— 本版**不新增也不重定義**任何 command payload 欄位。上游 SM §2 的 `status != resolved ⇒ carrier == null` 已涵蓋新來源的 post-state，該 semantic member 也已在 SM §8 的 closed list 內，**上游不需修改**。新增 AC72–80（含 AC79 的 no-caller-steering 邊界 —— 它是 **implementation-regression／compatibility** 驗收，明文**不**把 `reopenTrigger` 納入 command payload contract）。來源 2 在 draft 期間不得實作；該限制已隨 v1.7 核准解除。v1.6 一處：受限 `clear` 的條件 2 原寫「本交易未提供任何 rulingRef」，是把**逐項條件誤放到整筆交易上** —— `resolutionCarrierUpdates[]` 是逐 dpId 的 map，同一 batch 可以有 DP-A（direct citation → `clear`）與 DP-B（binding-policy → `replace`，帶 `rulingRef`）並存，原文字會讓 DP-B 的合法 `rulingRef` 錯殺 DP-A 的合法 `clear`；作用域收窄為 **per-DP**，並新增 AC67（mixed batch 正向 ＋ 自帶 `rulingRef` 卻宣告 `clear` 的反向），其後順延至 AC71。v1.5 修 v1.4 草案的兩處：(1) **AC60 與 AC65 直接互斥** —— AC60 仍寫「批次不得鑄造 REQ」，AC65 卻要求 `ASSUM|DEC supersede → REQ` 必須通過；AC60 改為依 rule 6 條件放行或拒絕，正向覆蓋 ASSUM→REQ 與 DEC→REQ 兩列，負向覆蓋四項條件各自缺漏。(2) `adopt-existing-outcome` 的 `clear` 是**死分支** —— 該交易只接受 initial-open 或舊 terminal 已失效的 DP，其 pre-state carrier 依上游 carrier–status 蘊含必為 null，而 `clear` 要求 pre-state carrier 非 null；已移除，並補上該交易的正向 carrier AC。rule 6 的 plan-gate 對位同步為上游 v1.11 的**四欄**。v1.4 修 v1.3 草案的三個缺口：(1) v1.3 的 rule 6 一律禁止批次鑄 REQ，理由「批次無 plan-gate witness」是**發明的前提** —— test-provenance 的 loop 在 `successor=REQ` 時退出走 plan gate 再 `resume-task` 回同一 taskId，witness 於 Step 5 已在 pre-state；禁令使 `ASSUM|DEC supersede → REQ` 不可達，而其餘命令都補不上（`create-requirement` 與 DP 無關且無 Transition、`supersede-requirement` 是 REQ→REQ、預建 `replace-terminal` 的 Transition 不在 Git base 故不能冒充 `historical-convergence`）。改為封閉四條件下允許；(2) carrier 契約缺 direct row-1 re-adopt 的 `clear`（`replace-terminal(successor != null)` 原本只給 `preserve|replace|unchanged-null`，上游明文要求的清除無交易可執行），並補上漏列的 `adopt-existing-outcome`；(3) same-subject 衝突只拒不同 successor／action，successor 與 action 相同而 draft payload 不同時結果未定義 —— 改為 `subjectRef` 唯一、sibling 進交易前聚合、重複一律 fail-closed。另新增 AC65–69（原 AC65 順延為 AC70）。v1.3 修 v1.2 草案的四個缺口：(1) v1.2 寫死「`commit-test-provenance-batch` 不得鑄造 clause」，使下游 test-provenance 的 `assum-reading-change` 路徑不可達 —— 改為 §8 新增封閉的 **`successorClauseDraft`**，revise group 內可原子鑄造 successor ASSUM（REQ 仍不得）；(2) 上游 carrier 無命令承載 —— §8 新增封閉的 **carrier 更新契約**（逐 DP `resolutionCarrierUpdates[]`，五交易 × 四 action × 六不變量）；(3) §5 postcondition 表的 binding-policy 一列仍是舊的無 carrier 限定寫法（會永久凍結 `resolvedBy`）—— 改為只對 current carrier 課條件並沿 active successor chain 比對；(4) §4 array table 重述的 `basisRefs` 排序鍵缺 `digest` tie-break —— 改為只引上游。另新增 AC57–65。v1.2 變更：§8 **ASSUM-minting 路徑共同規則**（`routingOrigin` 必填，逐路徑盤點）；binding-policy 的 adopt 對位改用上游 **`resolutionRulingRef` current carrier**，**撤回**初稿的全稱量化；§4 `materialReasons`／`basisRefs` 定序改以上游 SM 為唯一 authoritative 定義。草案審閱期間，本版新增契約不得由下游實作；該限制已隨 v1.6 核准解除。
- 前一版狀態：**approved v1.1**（2026-07-26 panel 放行；前一放行版本 approved v1.0，經九輪修訂）。v1.1 變更範圍：**§8** store command surface —— `replace-terminal` 支援 `successor=null`（retire；v1.0 的命令面**沒有任何交易能產生 `retire` Transition**，是既有缺口）、新增 `commit-test-provenance-batch` 複合交易（`0..N` `ResolutionGroupDraft`）、`init-task`／`resume-task` 接上 tracked TaskState；**§6** —— user-authority clause transition 的 witness 一律為 plan-gate；**§13** —— AC11 更正並新增 AC43–56。其餘章節未動。
- 日期：2026-07-25
- 上游：`2026-07-25-shared-decision-provenance-model.md`（**approved v1.13**，與本文同輪放行）。本 spec 只落地其 intent-scan 半邊；不重新定義任何 shared concept，附加的實作欄位一律以「annotation」標示且不改變上游欄位語義。
- 姊妹 spec：`2026-07-25-test-provenance-spec.md`（**approved v1.6**，與本文同輪放行；前一放行版本 approved v1.5 —— v1.6 補 Phase 2B1 的 adapter／oracle／content-view／tag-cardinality／parser-identity authority，其 `inputProvenanceStoreDigest` 所需的上游 pre-state precondition 即本文 v1.9 §8 的 payload 欄位，不在下游自行發明）。§8 的 provenance store 與 store script 是兩者共用的 shared infrastructure，test-provenance spec 消費、不重定義。

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
basisRefs 依上游 SM §2 的 packetBasisRef exact discriminated union
  （source | record | observational 三變體，欄位與排序皆以上游為準）
排除：digest 欄位自身
```

**Canonical encoding（不同 writer 必須算出同一 digest）**：UTF-8 無 BOM、換行 LF、object key 依 Unicode code point 排序、無多餘空白、字串不 trim；`digest ＝ sha256(canonical JSON)`。**Array 逐欄定序**（「builder 自行確定性」不足以讓兩個獨立 writer 一致）：

| array | 定序規則 |
|---|---|
| `alternatives` | **保留語義順序**（讀法 A／B 的先後有意義） |
| `materialReasons` | closed member set，去重，依 **Unicode code point 序**（上游 SM §4 為唯一 authoritative 定義；本表先前寫「enum 宣告序」，與上游不一致 —— 兩套定序會讓兩個 writer 對同一組理由算出不同 digest） |
| `basisRefs` | 依上游 SM §2 的 **packetBasisRef exact discriminated union 與其 total-order tuple 定義**（唯一 authoritative 來源）。本表**不重述**排序鍵 —— 重述過的舊版本缺 `source` 的 `digest` tie-break，同 `sourceId` 不同 `digest` 的兩筆無法定序 |
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
     **clause supersede／retire 的 Transition `ackRef` 一律必須是 `plan-gate`**
     （上游 witness binding）。已有指向該 DP 的明示 user-answer **可作為 plan gate 的
     輸入**，但**不能直接充當該 Transition 的 witness、不得跳過 plan gate**。
     流程固定為：plan **具名揭露 subject → successor** → 核准 → 建立 target == subject 的
     plan-gate witness（impact／disposition 描述以該 successor 取代原
     provisional／decided outcome 的效果）。
     `user-answer` 僅用於上游明定的「Ask 回答**直接產生**的轉移」，不涵蓋 clause
     supersede／retire。
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
| `binding-policy` | **只對 current carrier 課條件**：`DP.resolutionRulingRef == record` ∧ `record.rulingKind == binding-policy` ∧ `record.subjectRef == DP.id` ∧ `activeSuccessorChainEnd(record.bindingClauseRef) == DP.resolvedBy` |

`binding-policy` 一列**不是**對全部 binding-policy ruling 的全稱條件。舊寫法（`DP.resolvedBy == bindingClauseRef`，無 carrier 限定）會讓一筆歷史 ruling 永久凍結 `resolvedBy`：DP 採用 REQ-a 後，合法的 `REQ-a → REQ-b` supersede 會被那筆早已不再是 current 的 ruling 擋下。條件只對 `resolutionRulingRef` 指到的那一筆成立；其餘 ruling 依上游 SM §2 只驗 snapshot／digest 自洽。`activeSuccessorChainEnd` 沿 active Transition successor chain 前推（零長度即直接相等），因此 carrier 得以在 supersede 後保留。

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
| `.ctide/provenance.json` | **tracked canonical semantic state（committed）** | `sources`／`clauses`／`transitions`／`records`／`decisionPoints`／**`taskStates`**（上游 §2 carrier）—— 與引用它們的程式／測試一起提交；fresh clone／CI 必須能解析完整 chain 與 task membership |
| `.ctide/output/pending-governance.json` | per-run scratch（untracked） | 預鑄 ID、pending annotations、intentScan snapshot、committed head 的 **cache**。**taskId／currentTaskDpIds／baseProvenance／committed head 的權威版本在 tracked TaskState**（上游 §2）—— scratch 僅為 cache，不得成為第二個 truth source |
| ledger | 既有分類不變 | 觀測 telemetry（§11） |

- **ID**：`<PREFIX>-<ULID>`，plan mode 預鑄、post-approval 持久化同一批。本文是 repo 內 canonical ULID grammar 的**唯一** normative authority；下游 spec（含 test-provenance §2）只引用，不得複製或放寬。

  **Canonical ULID grammar（exact；v1.10 新增）**

  ```
  CROCKFORD_UPPER := "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
  ULID_FIRST      := one ASCII byte from "01234567"
  ULID_REST       := one ASCII byte from CROCKFORD_UPPER
  ULID            := ULID_FIRST ULID_REST{25}
  ```

  derived regex（與上式等價，附此僅為便利，不是第二份定義）：

  ```
  ^[0-7][0-9A-HJKMNP-TV-Z]{25}$
  ```

  - **恰 26 個 ASCII bytes**，不多不少。
  - **uppercase 是本 repo 唯一的 canonical serialization**。
  - **lowercase 不接受**，且**不得**先轉 uppercase 再放行 —— 修補後接受等於沒有 grammar。
  - **不接受 Crockford 的 human-input aliases**：`I`、`L`、`O`、`U` 一律非法（前三者在 Crockford 中原本可映射到 `1`／`1`／`0`，`U` 則是 checksum 保留字元；本 repo 一律不做該映射）。
  - **第一字元只能是 `0`–`7`**。理由：ULID 是 128-bit 值，而 26 × 5 ＝ **130 bits**，多出的 2 bits 落在最高位；因此首字元只有低 3 bits 有效，其值必須 ≤ 7。最大合法值即 `7ZZZZZZZZZZZZZZZZZZZZZZZZZ`。
  - `8…` 到 `Z…` 雖然仍是 26 字元的合法 Base32 文字，但**超過 128-bit 上限**，因此**非法**——這正是 `^[0-9A-HJKMNP-TV-Z]{26}$` **不得**被當成合法規則的原因：它會錯誤接受這些 overflow 值。
  - **不 trim、不 Unicode normalize、不 percent decode、不 locale-fold。**
  - 任一不吻合 → **fail-closed**；**不得**修補、正規化後接受，或產生部分結果。
  - 本 grammar 適用於**所有宣稱為 ULID 的 authored／persisted object id 與 ref**，不只新鑄造的結果 —— 讀取既有資料時同樣以此驗證。
  - `<PREFIX>` 的既有 namespace 語義**不在本輪改動**。
  - 規格散文中的 `REQ-n`、`DP-n`、`REQ-x`、`…` 等是 **prose metavariable／省略表示**，不是合法的 persisted bytes；不得被實作當成可接受的 id。
  - `migrate-store-v1-to-v2` **不得**藉此 re-key、case-fold 或修復 id；遇到 non-canonical ULID 必須 **no-write fail-closed**。
  - 本輪**只**閉合 serialized grammar 與 validation boundary；ULID 的 collision、timestamp、monotonic generation 與 merge semantics**一律不變**（見本條下文）。

  外部 ULID 規格只作為 rationale；真正約束本 repo 的 exact grammar 就是上面這段 tracked 文字，**不動態委派給任何外部網頁**。
**ULID 只保證新 object id 不碰撞，不簡化 Git merge**：不同 id 的 immutable 物件可自動 set-union；同 subject 多 Transition、同 DP 不同 outcome、同 id 不同 payload **必須 fail-closed reconciliation**。

### Store script（新增 `scripts/provenance-store.mjs`；main thread 不得徒手 Edit tracked JSON）

命令面全部是 **domain transaction** —— 沒有能製造懸空 DP 的裸操作：

```
validate                  唯讀：refs＋Transition matrix＋INV-1..4＋merge reconciliation
init-task                 建立 **tracked TaskState**（上游 §2）：taskId、`baseProvenance`
                          （inline、immutable）、預鑄 DP ID、`committedProvenanceBatchRef=null`
resume-task               沿用既有 taskId（product-tradeoff re-gate 後）：
                          **只能新增** `currentTaskDpIds` membership；
                          **不得改動 `baseProvenance`**（改換 base 一律拒絕）；
                          **不刪除／不重寫**已持久化物件；原 persisted DP 必須取得 terminal
                          outcome 或合法明示延後，不得因回答而「消失」
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
                          **reopened DP 且 priorTerminalRef 仍 active → 拒寫**，改走 replace-terminal。
                          **binding-policy 對位（v1.2 修正）**：由 binding-policy ruling 驅動的採用，
                          payload 必含明示的 **`resolutionRulingRef`**（上游 SM §2 current
                          application carrier），交易原子設定於 DP；loader **只**對該 current
                          carrier 套 postcondition。
                          v1.2 初稿的**全稱量化已撤回** —— 它要求所有 `subjectRef` 指向本 DP 的
                          binding-policy ruling 恆等於 `DP.resolvedBy`，會把 `resolvedBy` 永久
                          凍結（合法的 REQ-a→REQ-b supersede 之後必然與那筆歷史 ruling 衝突），
                          並牴觸 §4「歷史 ruling 只驗 snapshot／digest 自洽」
create-initial-outcome    open DP → **新** clause＋terminal ref（**不建 Transition**）；
                          可同一交易攜帶必要 Source／Record
replace-terminal          successor（**新鑄或既存 clause 皆可** —— reopened DP adopt 既存 REQ 時
                          走此路；**`successor=null` 正式表示 retire**，此時
                          Transition.action=retire、無後繼，所有 dependent DP 一律 **reopen**
                          —— v1.0 的命令面沒有任何交易能產生 retire Transition，此為補洞）
                          ＋Transition＋**所有**引用該 terminal 的 DP repoint／reopen。
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
commit-test-provenance-batch
                          **單筆 CAS 交易**，供下游 test-provenance 收斂一批語義審查結果。
                          Batch 的合法 cardinality 是 **0..N**，不是單數：clean batch 零筆、
                          不同 ASSUM 的多筆 finding 需多筆 Transition、同一 ASSUM 的多個
                          sibling test 則共用一筆 —— 單數契約會迫使 clean batch 虛構
                          Transition，或讓多 finding 被錯誤聚合／漏記。

                          payload:
                            **expectedInputProvenanceStoreDigest**  ← v1.9 新增，必填
                              typed string；本交易 **pre-state** canonical store digest。
                              記法與 store 自身 CAS 相同：sha256(canonicalText(檔案文字))
                              （去 BOM、CRLF/CR → LF）；store 不存在時為 canonical
                              empty store 的 digest。**不是** raw-bytes digest ——
                              後者是 baseProvenance.storeDigest 對 historical immutable
                              base tree 的另一個檢查，兩者不得混用。
                              不符 → CAS／precondition fail-closed、**整筆 no-write**。
                              **本欄單獨不足以證明 pre-state** —— 它只是交易當下的
                              precondition。可證明性來自下方 inventory binding 所要求的
                              持久化 preimage（batchSnapshot.inventorySnapshot），
                              不是來自本欄，也不是來自 opaque 的 inventoryDigest。
                              與既有的 invocation option expectedStoreDigest（--expect-digest）
                              的分工：後者可省略、caller 給定、不落盤，只能擋 race；
                              本欄為**本命令必填**，並與下方 inventorySnapshot 的
                              同名欄位機械綁定 —— **僅靠本欄本身仍證明不了 pre-state**
                              （見下「inventory binding」）。
                            batchSnapshot
                            **recordsToCreate[]**            ← 本交易要鑄造的新 record：
                              semantic evidence drafts
                              governance witness drafts（既存者不重建，直接引用）
                            resolutions: **ResolutionGroupDraft**[0..N] ← 依 subject clause 分組
                              ResolutionGroupDraft（**輸入型別**）:
                                subjectRef
                                semanticEvidenceRefs[1..N]
                                governanceWitnessRef
                                **transitionDraft**       ← successor=null 即 retire
                                **successorClauseDraft?** ← 見下「successor clause 鑄造」
                            **resolutionCarrierUpdates[]** ← 見下「carrier 更新契約」

                          提交後 batchSnapshot 內對應為 **ResolutionGroup**（**持久型別**），
                          其欄位為 **`transitionRef`**（交易鑄造 ID 後的實體）——
                          同一欄位不得在不同 spec 同時代表 draft 與 persisted object

                          **所有 ref 必須解析至 pre-state 或同交易的 `recordsToCreate`**
                          —— 只給 ref 而無 draft payload 時 writer 無從鑄造（v1.1 初稿的缺口）

                          **Inventory binding（v1.9；交易內強制，任一不符 → 整筆 no-write）**

                          初稿曾宣稱「expectedInputProvenanceStoreDigest 已由 inventoryDigest
                          遞移持久化」——**該宣稱撤回，它不成立**。record 只存 opaque digest 時：
                            store 在 inventory 之後由 D0 變 D1，caller 把 payload expected 改成 D1、
                            batch 仍送以 D0 為 preimage 的 H0 → writer 驗得過（expected == 實際
                            pre-state == D1），H0 卻是不透明的，writer 無 typed preimage 可驗其中
                            是 D0；committed record 也沒留下實際使用的 D1，事後只看到
                            batch.H0 == inventory.H0，**永遠發現不了 D1 != D0**。

                          因此 batchSnapshot 必須帶完整 typed
                          **inventorySnapshot: ChangedTestInventoryV2**（exact v2 envelope）。
                          **Authority 分工**：exact key set 與 inventoryDigest 唯一公式見
                          上游 **shared model v1.13**；各 digest 的計算語義與 entries
                          canonicalization 見 **test-provenance §2／§11b.9c**。
                          writer 在**同一筆
                          交易內**強制下列等式：

                            loadedStoreDigest
                              == payload.expectedInputProvenanceStoreDigest
                              == batchSnapshot.inventorySnapshot.inputProvenanceStoreDigest

                            provenanceBatch.inventoryDigest
                              == batchSnapshot.inventorySnapshot.inventoryDigest
                              == 由 inventorySnapshot **重算**所得的 inventoryDigest

                          另須驗：inventorySnapshot 的 exact key set、entries canonicalization、
                          以及 inputProvenanceStoreDigest 的 digest 記法（sha256(canonicalText(…))，
                          缺檔取 canonical empty store digest —— 與本 store 的 CAS 記法相同，
                          **不是** raw-bytes 記法）。

                          invocation option --expect-digest 若存在，**也必須等於同一值**。

                          provenanceBatch.inventoryDigest 是 **derived** 的：它由
                          inventorySnapshot 派生，**不得**由 caller 獨立提供成為第二份 authority；
                          同樣**不得**改以「把 pre-state digest 複製到 record top-level」代替 ——
                          那證明不了它參與過 preimage，且會製造第三個 authority。

                          不變量：
                            同一 subject 每輪**至多一筆** Transition
                            同一 subject 的 sibling findings 可共同引用該 Transition
                            witness 必須涵蓋該 group 的**全部** semanticEvidenceRefs ——
                              機械判準：witness record 的 `resolutionGroupDigest`
                              == sha256(canonicalJson({subjectRef, action, successor,
                                                       sortedSemanticEvidenceRefs}))（上游 §2）
                            **`resolutions[]` 的 `subjectRef` 必須唯一** —— 同一 subject 出現
                              兩筆即 fail-closed，不論 payload 是否一致。sibling findings
                              必須在**進入交易前**聚成同一 group（單一 successor、單一
                              Transition、多筆 semanticEvidenceRefs）
                            —— 只拒「不同 successor／action」不足以閉合：successor 與 action
                              相同而 `successorClauseDraft` 的 `text`／`routingOrigin`
                              ／`basisRefs` 不同時結果未定義，writer 會被迫隱式合併或擇一，
                              兩者都是 spec 未授權的行為
                            clean batch 合法表示為 `resolutions=[]`，只提交 provenance-batch record

                          交易內固定順序：
                            1) 記憶體預鑄全部 ID
                            2) 由 recordsToCreate 鑄造 record，建立完整 batchSnapshot 與 groups
                            3) 計算 canonical batchDigest（上游 §2 total order）
                            4) 建立 provenance-batch record 與 chain relation
                               （`previousBatchRef` == **pre-state** 的
                                `TaskState.committedProvenanceBatchRef`；首筆為 null）
                            5) **原子更新 `TaskState.committedProvenanceBatchRef`**
                            6) 驗 final snapshot（refs＋Transition matrix＋INV-1..4＋
                               relatedRefs derived set＋head 三分狀態＋witness digest）
                            7) CAS ＋ atomic replace

                          原子涵蓋：recordsToCreate／全部 Transition／**所有** dependent DP 的
                          repoint 或 reopen ／ provenance-batch record ／ TaskState 更新。
                          **scratch 因此降為衍生 cache** —— 遺失時可由 tracked TaskState 與
                          chain 完整重建
reopen-dp                 **限「當下沒有 successor、確實必須持久化 open 狀態」**（含跨 run）：
                          原子地保存 `priorTerminalRef` ＋清 terminal ＋記 closed trigger。
                          有 successor 時**不得**先 reopen 再 replace（那會產生兩筆交易與
                          可見中間態）—— 直接單筆 `replace-terminal(casMode=current-terminal)`。
                          日後取得 successor 時走 `casMode=reopened-prior`，
                          deferred reopen 因此可收斂
```

### `migrate-store-v1-to-v2`（v1.8 新增 domain transaction）

上游 SM §2 把 `provenanceVersion` 升為 2 並定義 legacy 補值規則，但那只是語義；**沒有命令面就沒有可執行的 migration**，AC 也無從實跑。本交易補上，並沿用與其他交易**完全相同**的原子協定：

```
作用對象  **只有** current mutable canonical store（不碰任何 historical base-tree store）
payload   { }  —— 不接受 caller 提供任何 DP cause 值或版本值
前置條件  pre-state provenanceVersion == 1，否則見下「version 2 再呼叫」
          pre-state 不得存在任何 TaskState（含 TaskState 的 v1 store 本版 unsupported，
            理由見上游 SM §2：resume-task 禁改 baseProvenance 且本版無 re-baseline command）
動作      對**每個** DP 補上 explicit `reopenCauseRef: null`
          —— **不得**由 current graph 回填成因（那是本版正在消滅的錯誤）
          原子將 provenanceVersion 改為 2
後置條件  final v2 snapshot 跑**完整** loader invariants（refs／matrix／INV-1..4／
            carrier coherence／reopen cause coherence／head 三分）
原子協定  沿用既有 single-writer：load＋validate → 記錄原檔 digest → 記憶體套用
          → 驗 final snapshot → CAS → 同目錄 temp write ＋ atomic replace ＋ lock
失敗行為  任一步失敗 → 原始 bytes **位元不變**、lock 釋放、無 temp 殘留
crash／retry  中途狀態永不落盤，因此重跑是安全的：要嘛看到未遷移的 v1，要嘛看到完整的 v2
version 2 再呼叫  **fail-closed**（二選一，本版選 fail-closed 而非 no-op：
                 no-op 會讓「已遷移」與「不需遷移」在回傳上無法區分）
```

**版本分派（closed，先於任何 command dispatch）** —— 一般 loader 依 current version 驗證，v1 會在 dispatch 前就被拒絕，migration 因此永遠進不去；若改用一個較寬鬆的 validator，那份契約必須明文存在。四步封閉：

```
1. 只解析 root、section shape 與 provenanceVersion（不套任何版本專屬規則）
2. provenanceVersion == 2 → 正常 v2 loader，一切照舊
3. provenanceVersion == 1：
     command != migrate-store-v1-to-v2 → **fail-closed**
     command == migrate-store-v1-to-v2 → 進**唯一**的 migration-only v1 decoder
4. 其餘值（含缺欄位、非整數） → **fail-closed**
```

**migration-only v1 decoder（pre-validator）** —— 只有本交易能取得它，不對外開放：

```
驗證基準  依**上游 approved v1.11** 的 schema 與 invariants 驗 pre-state，
          **不套** v1.12 的 reopenCauseRef 必填規則
          （否則 v1 store 依定義必然驗不過，migration 永遠無法開始）
額外前置  taskStates **必須為空**
v1 已帶 reopenCauseRef  → **fail-closed**，視為 mixed-version／writer defect。
          **不得覆寫既有值** —— 一個宣稱是 v1 卻已帶新欄位的 store 來歷無法確定，
          靜默覆寫等於用猜測抹掉一筆可能真實的 witness
```

**migration 的允許變更集（exact；其餘一律不得動）**：

```
允許  provenanceVersion: 1 → 2
      每個 DP **新增** reopenCauseRef: null
禁止  其他任何欄位、物件、ID 的變更
      **不得順便修復非法的 v1 state** —— pre-validator 沒過就是 fail-closed，
      migration 不是清理工具
```

**pre-validator 與 v2 final validator 的差別**：前者套上游 approved v1.11 規則且**不**要求 `reopenCauseRef`；後者是**完整的 v1.12 v2 規則**，要求每個 DP 顯式帶該欄位，並跑 refs／matrix／INV-1..4／carrier coherence／reopen cause coherence／head 三分。

**其他所有 domain command 對 current v1 store 一律 fail-closed** —— 只有本交易能進。historical immutable base-tree store 不受此限，checker 依上游 SM §9 以 read-only 方式讀取。

**移除**裸 `append-clause`／`append-transition`／`set-dp-outcome` —— 它們無法在不違反 INV-4 的前提下單獨完成 terminal replacement。

### `commit-test-provenance-batch` 的 successor clause 鑄造（v1.3）

v1.2 把本交易寫死為「不得鑄造任何 clause」，使下游 test-provenance 的 `assum-reading-change` 路徑**形式上不可達**：該路徑要求語義審查認定 ASSUM 讀法有誤時原子產生 revise Transition，而 revise 的 successor 依定義是一個尚不存在的新 ASSUM。要求「由其他交易先鑄造」等於把它拆成兩筆交易並讓中間態可見，直接牴觸 §8 的原子性契約與 AC44。因此改為：**successor clause 得在 revise group 內鑄造，但受下列封閉規則約束。**

```
successorClauseDraft 的存在條件（exact，違反即整筆 fail-closed）:

  transitionDraft.successor == null（retire）
    → **不得**提供 successorClauseDraft（清理／retire 路徑不得虛構 draft）

  transitionDraft.successor 解析得到 pre-state 既存 clause
    → **不得**提供 successorClauseDraft（既存者只指向，不重鑄）

  transitionDraft.successor 不存在於 pre-state
    → **必須**提供 successorClauseDraft
       且 successorClauseDraft.id == transitionDraft.successor（否則 fail-closed）

規則:
  1. successorClauseDraft 是 **clause draft**，其 authority tier／必填欄位一律依上游
     SM §2 該 tier 的完整 schema 驗證 —— 本交易不放寬任何一條。
  2. successor 為 **ASSUM** 時 `routingOrigin` **必填**，且該值對應的
     `layer`／`governedBy`／`basisRefs` 義務**全部驗證**（loader／final-snapshot invariant，
     不是入口寬鬆檢查）。revise 的既有語義為「沿用被修訂 ASSUM 的 routing 授權」時
     取原值，但仍是 authored 欄位，必須明寫。
  3. 同一 subject 至多一筆 group（見上「`subjectRef` 必須唯一」），因此不存在
     「多筆 draft 需比對」的情形 —— 重複 subject 在到達本規則前即 fail-closed，
     writer **不做**任何合併或擇一。
  4. 鑄造範圍在**單筆 CAS 交易**內原子完成：successor clause ＋ recordsToCreate
     ＋ Transition ＋ DP repoint-or-reopen ＋ provenance-batch record ＋ TaskState head。
  5. 鑄造出的 clause 同樣進入 final-snapshot 全量驗證（refs／matrix／INV-1..4）。
  6. successor 為 **REQ** 時，僅限 `ASSUM|DEC supersede → REQ` 一種組合，且必須同時滿足：
       transitionDraft.action == supersede
       ∧ subject 的 authority tier ∈ {ASSUM, DEC}
       ∧ transitionDraft.authorityRef.kind == user
       ∧ ackRef.kind == plan-gate，且該 plan-gate record 的
           target      == transitionDraft.subject
           successor   == transitionDraft.successor（＝ successorClauseDraft.id）
           impact／disposition 與 Transition 的 compatibility block 逐欄相等（§7）
           approvedBy  為 user
       ∧ 該 REQ 的 authority ∈ {approved-requirement, compatibility}
     四項任一不成立 → **整筆 no-write fail-closed**（不得部分套用、不得降級為警告）。
     其餘任何 REQ 鑄造仍只能走 `create-requirement`／`supersede-requirement`
     ／`resolve-exception`。
```

**為何 v1.3 的「批次一律不得鑄 REQ」是錯的** —— 該規則的理由寫成「user authority 需 plan-gate witness，批次無此 witness」，但那個前提是**發明的**：test-provenance §6 的 loop 在 `successor=REQ` 時明文退出本輪 review、由 plan gate 核准後 `resume-task` 回到**同一 taskId**，因此 Step 5 執行時 plan-gate witness 已經存在於 pre-state。禁令的實際後果是把 `ASSUM supersede → REQ` 也封死，而其餘命令都補不上這個缺口：`create-requirement` 與 DP 無關且不產生 Transition；`supersede-requirement` 是 REQ→REQ 的 row-3 變體；先用 `replace-terminal` 預建 REQ＋Transition 則與 Step 4／Step 5 的分工衝突 —— 該輪 semantic evidence 此時只在記憶體、尚未持久化，而預建的 Transition 不存在於 Git base，因此**不能**冒充 `historical-convergence`。結果只剩「successor REQ 恰好已預先存在」這個窄案例可走；plan gate 的回答本身要建立新 REQ 時無合法原子路徑。

### Carrier 更新契約（v1.3，closed）

上游 SM §2 定義 `DP.resolutionRulingRef` 的生命週期語義，但**沒有任何命令承載它** —— 未補此節則 carrier 只能在 `adopt-existing-outcome` 被設定，之後永遠無法 preserve／replace／clear，`replace-terminal`、`supersede-requirement`、`reopen-dp`、retire 全部在 post-state 違反上游條件。因此每一筆會動到 DP terminal 的交易，都必須攜帶**逐 DP 的精確 map**：

```
resolutionCarrierUpdates[]: {
  dpId,
  action: preserve | replace | clear | unchanged-null,
  rulingRef?      ← 僅 action == replace 時必填，且必須是本交易可解析的 ref
}
```

| 交易 | 允許的 action |
|---|---|
| `replace-terminal`（successor 非 null） | `preserve`（新 terminal 在原 carrier 的 active successor chain 上）／`replace`／`clear`（**來源 1 或 2**，見下）／`unchanged-null` |
| `replace-terminal`（`successor=null`，retire） | `clear`（**來源 3**）／`unchanged-null` |
| `supersede-requirement` | `preserve`／`replace`／`clear`（**來源 1 或 2**）／`unchanged-null` |
| `reopen-dp` | `clear`（**來源 3**）／`unchanged-null` |
| `adopt-existing-outcome` | `replace`（binding-policy 驅動）／`unchanged-null`（direct row-1 citation） |
| `commit-test-provenance-batch` | 上列全部，逐 DP 各自適用 |

`adopt-existing-outcome` **不是例外**：它同樣改動 DP terminal，因此同樣受本節總則約束並必須攜帶 `resolutionCarrierUpdates[]`。它只有兩個合法 action：

- **不允許 `preserve`** —— 採用一個新的既存 clause 時，舊 carrier 所指的 clause 不會恰好是新 terminal 的前驅（若恰好是，那是 supersede 而非 re-adopt）。
- **不允許 `clear`** —— 本交易只接受 initial-open 或舊 terminal 已失效的 DP，兩者的 pre-state carrier 依 §2 carrier–status 蘊含**必然已是 null**（`status != resolved ⇒ carrier == null`），而 `clear` 要求 pre-state carrier 非 null。在任何合法 snapshot 下都構造不出可達案例，是死分支。direct row-1 re-adopt 而舊 carrier 仍 active 的情形，subject 的 terminal 仍生效，本來就必須走 `replace-terminal` 的受限 `clear`。

### `clear` 的三種合法來源（v1.7）

v1.6 的 `clear` 只有**一種**受限形態（successor 非 null 且 post-state resolved），實作後暴露出一個沒有任何合法 action 的狀態：`replace-terminal`／`supersede-requirement` 的 successor 非 null，但某個 **dependent DP** 因該 successor 對它不 applicable 而被 dependent closure reopen，且它持有 carrier。四個 action 全部落空 —— `preserve` 無 terminal 可對齊、`replace` 會把 carrier 留在非 resolved 的 DP（違反上游蘊含）、`unchanged-null` 因 pre-state carrier 非 null 而不成立、`clear` 因 v1.6 要求 post-state resolved 而不成立。v1.7 把 `clear` 拆成三個**互斥且各自封閉**的來源。上游 SM §2 的 `status != resolved ⇒ resolutionRulingRef == null` 已經涵蓋此處的 post-state，故**上游不需修改**；缺的一直只是命令面。

**來源 1 — `resolved-direct`**（v1.6 原條件，逐字保留）

適用 `replace-terminal(successor != null)` 與 `supersede-requirement`。上游 SM §2 要求「由 binding-policy outcome 改採不相關的 direct row-1 citation 時清除舊 carrier 並保持 null」，而 active prior terminal 必須走 `replace-terminal`。四項條件全備才合法：

```
1. post-state DP.status == resolved
2. **該 dpId** 的 resolution 是 **direct citation**：不由任何 binding-policy ruling
   驅動，且**該 dpId 的 carrier update 自身**未帶 replacement `rulingRef`
   —— 述詞的作用域是 **per-DP，不是 transaction-global**。`resolutionCarrierUpdates[]`
   是逐 dpId 的 map，同一 batch 完全可以有 DP-A（direct citation → `clear`）
   與 DP-B（binding-policy → `replace`，帶 `rulingRef`）並存；
   寫成「本交易未提供任何 rulingRef」會讓 DP-B 的合法 `rulingRef` 錯殺 DP-A 的合法
   `clear`，是把逐項條件誤放到整筆交易上
3. post-state DP.resolutionRulingRef == null
4. pre-state carrier 非 null 且在本交易中被明確移除
   （pre-state 已是 null 者應宣告 `unchanged-null`，不是 `clear`）
```

**來源 2 — `reopened-dependent`**（v1.7 新增）

適用三處，其共同點是都會執行同一套 dependent closure：

```
replace-terminal(successor != null)
supersede-requirement
commit-test-provenance-batch 中 successor != null 的 ResolutionGroup
```

**十項條件全備才合法，缺任一即 fail-closed。第 9、10 項與前八項同為 mandatory contract，不是前八項的註解或衍生後果**：

```
 1. 該 DP 是本交易 subject terminal 的 **dependent DP**（pre-state 的 current terminal
    == 本交易 Transition.subject）
 2. 該 successor 對該 DP **不 applicable**（§8 applicable 判準）
 3. 該 reopen **由本交易的 dependent-closure 演算法導出**，**不接受 caller 自陳**
    （見下「安全邊界」），且 writer **必須**把該因果持久化為上游 SM §2 的
    **`reopenCauseRef`**，指向本次交易的該筆 Transition
    —— 成因是歷史事實，snapshot 事後無法由圖形反推（見下「為何需要持久化 witness」）
 4. pre-state carrier 非 null
 5. post-state DP.status == open
 6. post-state current terminal == null（三個 terminal 欄位皆空）
 7. post-state DP.priorTerminalRef == 本交易 Transition.subject
 8. post-state DP.reopenedBy == 上游 semantic member「**terminal clause 失效且無後繼
    （INV-4）**」，其 intent-scan v1 序列化為 **`terminal-invalidated-no-successor`**
    —— 由 writer 確定性寫入（見下 authority boundary）
 9. post-state DP.resolutionRulingRef == null
10. `resolutionCarrierUpdates` 對該 DP **必須**宣告 `clear`
    （其餘三個 action 在此狀態下仍各自 fail-closed）
```

**cause、semantic member 與 serialization 是三個不同層次，authority 各屬不同文件**（初稿把 successor-not-applicable 寫成一個 trigger 值，那會在上游 closed list 之外發明 enum 成員；接著又把序列化字串說成上游定義，那同樣越權）：

```
successor-not-applicable
  = **transaction-local cause**，由 writer 在本交易內以 applicable(...) == false 推導。
    只存在於這一次交易的推導過程，**不被持久化**，不是任何 enum 的成員，
    也不出現在任何 payload 中。

「terminal clause 失效且無後繼（INV-4）」
  = **上游 SM §8 closed list 的 semantic member**。authority 在 shared model。
    語義相符：該 DP 的 terminal 確實失效，且對它而言確實沒有可用後繼。

`terminal-invalidated-no-successor`
  = 上述 semantic member 的 **intent-scan v1 serialization**（本文的 authority）。
    它是既有語義的下游字面編碼，**不是**新的 trigger 成員，
    shared model 也**未**定義這個字串本身，因此上游不需修改。
```

### `reopenCauseRef` 的 writer lifecycle（v1.8，closed）

上游 SM §2 定義語義與 loader invariant，本節逐一盤點**每一個會改變 DP terminal／status 的 domain transaction** 該如何維護該欄位。它是 **writer-derived** 的：**caller payload 不新增 `reopenCauseRef`、`reopenTrigger` 或任何等效欄位**，也不得以未宣告欄位影響它。

| 交易／路徑 | 對受影響 DP 的 `reopenCauseRef` |
|---|---|
| `create-initial-outcome` | **clear**（DP 落定為 resolved／decided／assumed） |
| `adopt-existing-outcome` | **clear** |
| `resolve-exception` | **clear** |
| `replace-terminal`（成功 repoint 到 successor） | **clear** |
| `replace-terminal`（successor=null，retire 造成 reopen） | **clear** —— retire 是另一種成因 |
| `supersede-requirement`（成功 repoint） | **clear** |
| `reopen-dp`（explicit reopen） | **clear** —— explicit 是另一種成因 |
| `commit-test-provenance-batch`（group 使 DP repoint 或落定） | **clear** |
| `commit-test-provenance-batch`（group 的 `transitionDraft.successor == null`，retire 使 dependent DP reopen） | **clear** —— retire 是另一種成因；原本有 witness 者一律清除，不得沿用 |
| **dependent closure：successor 對該 DP 不 applicable 而 reopen** | **set／replace 為本交易的 TransitionRef**（三條 successor != null 路徑皆同） |
| 本交易**未改動** terminal／status 的 DP | **preserve**（不得順手改寫） |

閉合規則：

```
source-2 dependent reopen        → 設定；若原本已有值則替換為本交易的新 TransitionRef
repoint／任一 terminal 落定       → clear
explicit reopen-dp／retire／其他 reopen cause → clear
未受影響 DP                       → preserve
```

**為何需要持久化 witness（v1.8）** —— 初版把條件 3 只寫成「由 closure 導出」，下游因此在 loader 端以 `status=open ∧ priorTerminalRef 有 effective Transition ∧ successor != null` 反推來源 2。該推斷**不成立**，且擋掉兩條合法收斂：DP 先以 `reopen-dp(new-dependent)` 明示重入、prior 日後才被合法 supersede；以及兩個 DP 對同一 prior 各自 deferred reopen、其一以 `reopened-prior` 建立 Transition 後另一個尚待 `adopt-existing-outcome` 收斂。兩者的舊 reopen 發生時 prior 都還沒有 successor，snapshot 分辨不出。因此因果改為**持久化**於 `reopenCauseRef`，loader 只讀該欄位，不看圖形。

**batch 的欄位對位**（`commit-test-provenance-batch` 不留給讀者推論）：

```
subject      = ResolutionGroup.transitionDraft.subject
successor    = ResolutionGroup.transitionDraft.successor（非 null 時本來源才適用）
affected DP  = 由**該 group 的** dependent closure 導出
carrier action = 仍由同一筆 resolutionCarrierUpdates 逐 DP 判定

只有 dependent DP 可走來源 2；任何被該流程視為 initiating／必須落到 successor 的 DP
仍 fail-closed。atomicity、single CAS、batch head 推進與 no-write 邊界**均不變**。
```

**來源 3 — 既有 retire／`reopen-dp` 的 `clear`**

`replace-terminal(successor = null)`（retire）與 `reopen-dp` 的 `clear` 規則**原封不動**。新增來源 2 **不得**被用來放寬或重新定義這兩列 —— 它們的 post-state 同樣是 open，但成因是 terminal 被 retire 或被顯式 reopen，與「successor 存在卻不適用」是不同的來源，各自獨立判定。

**安全邊界（明文，全部 fail-closed）**

```
`reopened-dependent` **不是**「任何 open DP 都能 clear」。

writer 必須從 **pre/post terminal closure 自行導出** 受影響 DP 與其 reopen 成因。
`priorTerminalRef`、`status`、三個 terminal ref 與 `reopenedBy` **全部由 writer 寫出**，
一律不採信 caller 自陳 —— 它們是導出結果的**紀錄**，不是輸入。caller 填寫這些欄位
不能使一個非 dependent 的 DP 取得 `reopened-dependent` 資格。

**Authority boundary —— 來源 2 完全由 writer 推導，caller payload 不參與。** eligibility
只由這三件事決定，全部在交易內導出：

```
subject-dependent membership
∧ 該 successor 對該 DP applicable(...) == false
∧ 本交易的 dependent closure 確實對該 DP 執行 reopen
```

post-state 的 `reopenedBy` 由 writer **確定性寫入**上述 semantic member 的 v1 序列化；
caller 值一律不採信。本版**不新增也不重定義**任何 command payload 欄位 —— caller 是否
帶有既存的實作欄位，**不構成**來源 2 的授權或判定條件。把某個 payload 欄位寫成來源 2
的判定輸入，等於在 closed command contract 之外新增 caller-visible schema，而 §8 的
payload 契約才是宣告命令形狀的地方；test-provenance 也明文倚賴「v1.7 不改它消費的
命令 shape」。

initiating DP 的 successor 不 applicable **仍維持整筆 no-write**
（§8 `E_INITIATING_DP_NOT_APPLICABLE`）。該規則**不得**被 `reopened-dependent` 吸收：
initiating DP 是交易明示要落在 successor 上的 DP，落不上就是交易錯了；
dependent DP 只是被連帶影響，reopen 是它的正常收斂終局。

下列一律 fail-closed：
  unrelated DP（pre-state current terminal 不是本交易 subject）
  successor 其實對該 DP applicable（它應被 repoint，不是 reopen）
  pre-state carrier 已是 null（應宣告 `unchanged-null`）
  post-state priorTerminalRef 不等於本交易 Transition.subject
  post-state reopenedBy 不等於「terminal clause 失效且無後繼」的 v1 序列化
    （含其他合法 closed trigger 的序列化 —— 合法不等於對位）
```

不變量（全部 fail-closed）：

```
1. 覆蓋完整性：交易改動 terminal 的**每一個** DP 都必須在本陣列中恰好出現一次；
   缺漏或重複 dpId 皆 fail-closed（含 dependent DP 的 repoint-or-reopen）。
2. 不得出現未改動 terminal 的 dpId（防止借道本陣列改寫無關 DP 的 carrier）。
3. `unchanged-null` 只在 pre-state carrier 已是 null 時合法；否則 fail-closed。
   —— 它是「本 DP 本來就沒有 carrier」的明示宣告，不是「跳過」。
4. `preserve` 只在 `activeSuccessorChainEnd(carrier.bindingClauseRef) == post-state
   DP.resolvedBy` 時合法 —— 即新 terminal 確實是原 ruling 所指 clause 的後繼。
5. `replace` 的 `rulingRef` 必須滿足 §「rulingKind 套用後條件」表的 binding-policy 一列
   全部條件（含 `subjectRef == dpId`），並通過 freshness（consumption 時對 pre-state 檢查）。
6. post-state 必須滿足上游 SM §2 的 carrier–status 蘊含：
   `resolutionRulingRef != null ⇒ status == resolved ∧ resolvedBy 存在`，且
   `status != resolved ⇒ resolutionRulingRef == null`。
```

### ASSUM-minting 路徑的共同規則（v1.2；末列於 v1.3 改寫）

`routingOrigin`（上游 SM §2 三值）是 **authored 控制狀態**，必須由鑄造該 ASSUM 的交易寫入，**不得**從 `basisRefs`（證據欄）或 `governedBy`（權威欄）反推。適用於**每一條**能鑄造 ASSUM 的路徑 —— 只寫在 `create-initial-outcome` 會漏掉其餘兩條：

| 路徑 | 能否鑄造 ASSUM | `routingOrigin` |
|---|---|---|
| `create-initial-outcome` | 可（`payload.clause`） | **必填** |
| `replace-terminal` | 可（`payload.successorClause`，如 ASSUM 修訂） | **必填** |
| `supersede-requirement` | 否 —— successor 必為 REQ（row 3 變體） | 不適用 |
| `resolve-exception` | 否 —— 產物固定為 exception-backed REQ | 不適用 |
| `adopt-existing-outcome` | 否 —— 只指向既存 clause，不鑄造 | 不適用（既存 ASSUM 的值於其鑄造時已 authored） |
| `create-requirement` | 否 —— **REQ-only**，`authority` 釘死 approved-requirement | 不適用 |
| `commit-test-provenance-batch` | **可** —— 在 revise group 內經 `successorClauseDraft` 鑄造 successor ASSUM；REQ 僅限 `ASSUM\|DEC supersede → REQ` 且四項條件全備（見上節 rule 6） | **必填**（successor 為 ASSUM 時），且該值的 `layer`／`governedBy`／`basisRefs` 義務全驗 |

值與 row 的對應：row 5 → `safe-default`；row 6 → `user-deferred`；row 7 → `reviewed-provisional`。三值各自的 `layer`／`governedBy`／`basisRefs` 強制條件見上游 SM §2，且為 **loader／final-snapshot invariant**，不是僅在交易入口檢查。

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
11. **plan-gate record 的建立時機**：一般 ExitPlanMode 核准**不**建立 plan-gate record；**row 3 supersede proposal**，以及**上游 Transition matrix 要求 user authority 的具名 clause transition**（ASSUM／DEC supersede → REQ）才建立，且 target／impact／disposition 三欄完整。（v1.0 的「限 supersede、非 supersede task 全程不建立」與正文及 AC38 矛盾，本版更正。）
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

### v1.1 新增驗收

43. **Retire 有路徑**：`replace-terminal(successor=null)` 產生 `action=retire` 的 Transition，所有 dependent DP **reopen**（無後繼可 repoint）；v1.0 命令面無法達成此結果。
44. **批次提交原子性**：`commit-test-provenance-batch` 於**單筆** CAS 交易內完成全部 evidence／witness／Transition／DP repoint-or-reopen／`provenance-batch` record；中途狀態不可見。
45. **Scratch 可重建**：刪除全部 scratch 後，由 tracked chain 的 `provenance-batch` snapshot 可完整重建 batch 內容（非僅 digest）。
46. **Cardinality 0..N**：（i）clean batch 以 `resolutions=[]` 提交，**不虛構** Transition；（ii）兩個不同 ASSUM 的 finding → 兩個 ResolutionGroup、兩筆 Transition；（iii）同一 ASSUM 的三個 sibling test → 一個 group、三筆 `semanticEvidenceRefs`、共用一筆 Transition。
47. **同 subject 衝突整筆拒**：同一 subject 的兩個 group 要求不同 successor 或不同 action → 整筆 fail-closed，store 不變。
48. **Witness 涵蓋性**：`governanceWitnessRef` 未涵蓋該 group 全部 `semanticEvidenceRefs` → fail-closed。
49. **Chain head 唯一**：交易後該 task 的 `provenance-batch` chain 恰有一個 tip 且 == `TaskState.committedProvenanceBatchRef`；人為造出零個或兩個 tip、或 ref ≠ tip → loader fail-closed。
50. **Draft payload 可實作**：`resolutions` 引用的 evidence／witness 若既不在 pre-state、也不在 `recordsToCreate` → fail-closed；提供 draft 後，交易鑄造出的 record id 與 `semanticEvidenceRefs`／`governanceWitnessRef` 一致。
51. **TaskState 為權威**：刪除全部 scratch 後，`taskId`／`currentTaskDpIds`／`baseProvenance`／committed head 仍可由 tracked TaskState 取得；`resume-task` 嘗試改動 `baseProvenance` → 拒絕。
52. **Witness digest 對位**：`governanceWitnessRef` 的 `resolutionGroupDigest` 與該 group 重算值不等（少一筆 sibling evidence、或 successor／action 不同）→ fail-closed。
53. **relatedRefs derived**：`relatedRefs` 與「recordsToCreate ∪ resolutions 中出現的 ref ∪ 本交易 Transition refs」排序去重後不符 → fail-closed。
54. **user witness 一律 plan-gate**：`ASSUM／DEC supersede → REQ` 僅提供既有 `user-answer` 而無 plan-gate record → **fail-closed**；補上具名揭露與核准後的 plan-gate witness 才通過。Ask 回答直接產生的轉移仍以 `user-answer` 為 witness。
55. **Draft／persisted 型別分離**：交易輸入為 `ResolutionGroupDraft.transitionDraft`；提交後 batchSnapshot 內為 `ResolutionGroup.transitionRef`，指向實際鑄造的 Transition。
56. **taskStates carrier**：`init-task` 寫入 `.ctide/provenance.json` 的 `taskStates`；fresh clone 可讀回 taskId／membership／baseProvenance／committed head。
57. **ASSUM revise 可達**：`commit-test-provenance-batch` 於 revise group 內以 `successorClauseDraft` 鑄造新 ASSUM，與 Transition／DP repoint／batch record／TaskState head 在**同一筆** CAS 交易完成；無任何中間態落盤，亦不需前置交易。
58. **successorClauseDraft 存在條件**：successor 為 pre-state 既存 clause 或 `null`（retire）時提供 draft → fail-closed；successor 不存在於 pre-state 而未提供 draft → fail-closed；提供但 `id != transitionDraft.successor` → fail-closed。
59. **批次鑄造 ASSUM 的 routingOrigin 全驗**：批次鑄造的 ASSUM 缺 `routingOrigin`、或其值對應的 `layer`／`governedBy`／`basisRefs` 義務未滿足 → fail-closed，且該檢查在 **final-snapshot loader** 層成立（非僅入口）。
60. **批次鑄 REQ 依 rule 6 條件放行或拒絕**（**不是**一律拒絕）：正向 —— (i) `ASSUM supersede → 新 REQ`、(ii) `DEC supersede → 新 REQ`，兩者在條件全備時**必須通過**並原子落檔。負向 —— 缺 `authorityRef.kind == user`、缺 `ackRef.kind == plan-gate`、plan-gate 四欄（`target`／`successor`／`impact`／`disposition`）任一與 Transition 不符、`successorClauseDraft.authority` 不在 {approved-requirement, compatibility}、或 action 非 supersede → 各自 **no-write fail-closed**。
61. **carrier 覆蓋完整性**：任一改動 DP terminal 的交易，其 `resolutionCarrierUpdates[]` 若缺漏該 dpId、重複該 dpId、或含未改動 terminal 的 dpId → fail-closed。
62. **carrier preserve 條件**：`action=preserve` 而 `activeSuccessorChainEnd(carrier.bindingClauseRef) != post-state DP.resolvedBy` → fail-closed；chain 成立時（含零長度直接相等）通過，合法 supersede 因此**不被凍結**。
63. **carrier replace 與 clear**：`action=replace` 缺 `rulingRef`、或該 ruling 不滿足 binding-policy 套用後條件（含 `subjectRef == dpId`）、或 freshness 對 pre-state 不成立 → fail-closed；`reopen-dp` 與 retire 路徑僅接受 `clear`／`unchanged-null`，post-state carrier 必為 null。
64. **`unchanged-null` 非跳過**：pre-state carrier 非 null 而宣告 `unchanged-null` → fail-closed。
65. **批次鑄 REQ 的封閉條件**：`ASSUM|DEC supersede → REQ` 且 `authorityRef.kind == user` ∧ `ackRef.kind == plan-gate` ∧ plan-gate 的 `target`／`successor`／`impact`／`disposition` 與 Transition 逐欄相等 → 通過並原子落檔；任一項不成立 → **整筆 no-write fail-closed**。非 supersede、或 subject 非 ASSUM／DEC 的 REQ 鑄造請求 → fail-closed。
66. **`clear` 來源 1（`resolved-direct`）**：`replace-terminal(successor != null)` 或 `supersede-requirement` 宣告 `clear` 且 post-state 為 resolved 時，四項條件（post-state resolved、direct citation、post-state carrier null、pre-state carrier 非 null 且被移除）全備 → 通過；缺任一 → fail-closed。特別是 pre-state carrier 已為 null 而宣告 `clear` → fail-closed（該情形應宣告 `unchanged-null`）。**本 AC 的語義不因 v1.7 新增來源 2 而改變** —— 來源 2 只涵蓋 post-state 為 open 的 dependent reopen，兩者互斥。
67. **`clear` 的作用域是 per-DP**：**正向** —— 同一筆 batch 內 DP-A 宣告 `clear`（direct citation、自身無 `rulingRef`）、DP-B 宣告 `replace`（binding-policy，帶合法 `rulingRef`），兩者各自條件全備 → **整筆通過**，DP-A 的 post-state carrier 為 null、DP-B 指向該 ruling。DP-B 的 `rulingRef` **不得**使 DP-A 的 `clear` 失敗。**反向** —— DP-A 自身的 carrier update 帶 replacement `rulingRef` 卻宣告 `clear` → **整筆 no-write fail-closed**。
68. **`adopt-existing-outcome` 不是 carrier 例外**：**正向** —— binding-policy 驅動的採用宣告 `replace` 並附合法 `rulingRef` → 通過且 post-state carrier 指向該 ruling；direct row-1 citation 宣告 `unchanged-null` → 通過且 post-state carrier 為 null。**負向** —— 缺 `resolutionCarrierUpdates[]`、宣告 `preserve`（新 terminal 不會是舊 carrier 所指 clause 的後繼，若是則應走 supersede）、或宣告 `clear`（pre-state carrier 依 §2 蘊含必為 null，該分支不可達）→ 各自 fail-closed。
69. **carrier coherence 在 gate 層成立**：SM §9 的三條 carrier 條件由 gate 檢查實際執行 —— 構造一個 `status=assumed` 卻帶非 null carrier 的 store → gate fail-closed，且**不是**僅由交易入口攔下（繞過入口直接構造亦須被擋）。
70. **`subjectRef` 唯一性**：`resolutions[]` 重複 `subjectRef` → fail-closed 且 store bytes 不變，不論兩筆 payload 是否相同。
71. **packetBasisRef total order**：`{source, sourceId:"S-1", digest:"a…"}` 與 `{source, sourceId:"S-1", digest:"b…"}` 兩筆合法相異 ref，兩個獨立 writer 依上游 tuple 定序必得同一順序與同一 digest；canonical-bytes 重複則在排序前 fail-closed。
72. **`clear` 來源 2（`reopened-dependent`）正例**：`supersede-requirement`／`replace-terminal(successor != null)` 中，一個持有 carrier 的 dependent DP 因 successor 對它不 applicable 而被 dependent closure reopen —— 該 DP 宣告 `clear` 時，**十項**條件全備 → **通過**，post-state 為 `status=open`、三個 terminal 欄位皆空、`priorTerminalRef == Transition.subject`、**`reopenedBy == terminal-invalidated-no-successor`**（明確斷言該值，不是「屬 closed list 即可」）、**`reopenCauseRef` == 本交易建立的該筆 TransitionRef**（明確比對 Transition id，不是「非 null 即可」）、carrier 為 null。驗收必須證明 eligibility 是由本交易的 `applicable(...) == false` 與 dependent closure 推導而來，**不得**僅因看到該 trigger token 就通過。同一狀態下 `preserve`／`replace`／`unchanged-null` **仍各自 fail-closed**（分別因無 terminal 可對齊、carrier 會留在非 resolved 的 DP、pre-state carrier 非 null）。
73. **initiating DP 不被來源 2 吸收**：交易明示的 initiating DP 若 successor 對它不 applicable → **整筆 no-write fail-closed**，不得改以 `reopened-dependent` 收斂為 reopen。store bytes 與 `TaskState.committedProvenanceBatchRef` 皆不變。
74. **條件 1 與 exact-coverage 的機械邊界**：在目前 domain transaction 契約下，source-2 條件 1 **不具有可獨立觀測的 command-level 反例**。pre-state current terminal 不是本交易 `Transition.subject` 的 DP 不屬於 affected／dependent set；若 caller 仍在 `resolutionCarrierUpdates[]` 為它宣告 `clear`，必須由 **AC61 exact coverage** 以 extra／unaffected dpId fail-closed，且**整筆 no-write**。若該 DP 是 initiating DP，則依 **AC73／initiating-DP guard** fail-closed。**不得**把上述拒絕誤報為獨立的 source-2 condition-1 guard，也**不得**為了製造獨立 fixture 而放寬 AC61、carrier/status invariant 或 command shape。

    **不可達性的推導**（四條路皆不通，故本 AC 記錄邊界而非構造反例）：替非 dependent DP 宣告 `clear` → AC61 先以 extra dpId 拒絕；不替它宣告 → 條件 10（必須明示 `clear`）無法滿足；改用 initiating DP → 先撞 AC73；而 open／reopened 的 initiating DP 依上游 carrier–status 蘊含（`status != resolved ⇒ carrier == null`）不可能持有來源 2 所需的 non-null pre-state carrier。

    **驗收需證明**：非 dependent DP 被放入 `resolutionCarrierUpdates[]` 時**實際命中 AC61 exact coverage**（而非任何 source-2 guard）；store bytes 與 `TaskState.committedProvenanceBatchRef` 皆不變；initiating DP 情境仍由 AC73 負責；**不再宣稱條件 1 有獨立 error code 或獨立 guard**；不新增任何 caller payload 欄位。
75. **條件 2（successor 不 applicable）獨立成立**：**本 AC 只對 `reopenCauseRef != null` 的 DP 執行**（上游 SM §2）；成因是持久化事實，不得由 current graph 形狀反推。 與 AC77／78 同樣是**單一變數**反例 —— DP 確實是 subject-dependent、dependent closure 確實處理該 DP、**pre-state carrier 非 null**，其餘條件（post-state open、terminal refs 皆空、`priorTerminalRef` 對位、`reopenedBy` 的 semantic member 與 v1 序列化對位、carrier 為 null、明示 `clear`）**全部對位**，唯一翻轉的是 successor 對該 DP **確實 applicable** → fail-closed（它應被 repoint，正確宣告是 `preserve`／`replace`／`unchanged-null` 之一）。驗收必須確認拒絕來自條件 2，**不得**由 carrier（條件 4）、shape、membership（條件 1）、prior（條件 7）或 trigger（條件 8）任一 guard 提前拒絕 —— 尤其不得讓 fixture 的 pre-state carrier 為 null 而先在條件 4 失敗。
76. **來源 2 的 pre-state carrier 不得為 null**：被 reopen 的 dependent DP 若 pre-state carrier 已是 null 卻宣告 `clear` → fail-closed（應宣告 `unchanged-null`）。此條與 AC66 的同名條件分屬兩個來源，各自獨立成立。
77. **條件 7（`priorTerminalRef` 對位）獨立成立**：**本 AC 只對 `reopenCauseRef != null` 的 DP 執行**（上游 SM §2）；成因是持久化事實，不得由 current graph 形狀反推。 DP **確實**是 dependent、successor **確實**對它不 applicable、pre-state carrier 非 null —— 前六項全部成立，僅 post-state `priorTerminalRef != Transition.subject` → **loader／gate fail-closed**。驗收必須確認拒絕來自 prior 對位這一條，**不得**由 unrelated／shape 等更早的 guard 代替。
78. **條件 8（trigger 序列化對位）獨立成立**：**本 AC 只對 `reopenCauseRef != null` 的 DP 執行**（上游 SM §2）；成因是持久化事實，不得由 current graph 形狀反推。 DP 確實是 dependent、subject 與 `priorTerminalRef` 均正確對位 —— 僅 post-state `reopenedBy` **不是**「terminal clause 失效且無後繼（INV-4）」的 v1 序列化 `terminal-invalidated-no-successor`（含其他合法 closed trigger 的序列化，例如 `new-dependent`）→ fail-closed。驗收驗的是 **post-state serialization 對位**；authority 分層依 §8 —— semantic member 屬上游 SM §8，序列化字串屬本文。驗收必須確認拒絕來自 trigger 對位這一條。
79. **No caller steering（implementation-regression／compatibility boundary，非 command schema）**：正文承諾「來源 2 完全由 writer 推導，caller 不得影響 eligibility 或 persisted `reopenedBy`」，而現行實作**仍會讀** `payload.reopenTrigger`。本 AC 直接驗這個承諾。對任一 source-2-capable transaction，runtime 收到既有實作中存在、但**本規格未宣告**的 caller field `reopenTrigger` 時，**兩種結果皆合法**：
    - **結果 A** —— closed-shape validation 將它拒絕，**整筆 no-write**；驗 store bytes 與 `TaskState.committedProvenanceBatchRef` 皆不變。
    - **結果 B** —— 實作忽略它對來源 2 的影響，post-state `reopenedBy` 由 writer 確定性寫入 semantic member「terminal clause 失效且無後繼（INV-4）」的 v1 序列化 `terminal-invalidated-no-successor`；驗該值確為 writer-derived。

    **絕對禁止**（三者任一發生即 fail）：caller 值改變來源 2 的 eligibility；caller 值改寫 persisted `reopenedBy`；caller 值使非 dependent DP 取得資格。

    **本 AC 不把 `reopenTrigger` 納入正式 command payload contract**，也不改 test-provenance 消費的命令 shape —— 它驗的是「未宣告欄位不得取得 normative 效力」這條邊界本身。
80. **歷史 reopen 不因 prior 日後取得 successor 而被重新分類**：(i) DP 先以 `reopen-dp(trigger=new-dependent)` 明示重入（`reopenCauseRef` 為 null），prior clause **日後**才被合法 supersede → **通過**，該 DP 的 `reopenedBy` 維持 `new-dependent`，不被課以來源 2 的任何條件；(ii) 兩個 DP 對同一 prior 各自 deferred reopen，其一以 `casMode=reopened-prior` 建立 Transition 後，另一個仍可由 `adopt-existing-outcome` 收斂 → **通過**。兩例在 v1.7 的 graph-shape 推斷下都會被誤報，v1.8 以 `reopenCauseRef` 關閉。
81. **來源 2 在 `commit-test-provenance-batch` 內同樣成立**：另必須明示驗 **`reopenCauseRef` == 該 ResolutionGroup 的 `transitionDraft` 最終鑄造出的 TransitionRef**。一個 `successor != null` 的 ResolutionGroup，其 dependent closure 使某個持有 carrier 的 dependent DP reopen —— 該 DP 宣告 `clear` → **通過**，且 `preserve`／`replace`／`unchanged-null` 三者**仍各自 fail-closed**。欄位對位依 §8 batch mapping（subject／successor 取自 `transitionDraft`，affected DP 由該 group 的 closure 導出）。atomicity、single CAS、batch head 推進與 no-write 邊界不變；同 batch 內被視為必須落到 successor 的 DP 仍 fail-closed。
82. **caller 不得取得 `reopenCauseRef` 的 normative effect**：payload 提供或偽造 `reopenCauseRef`（或任何等效未宣告欄位）→ 兩種結果皆合法，與 AC79 同一 compatibility boundary：closed-shape validation 拒絕並**整筆 no-write**，或實作忽略之而由 writer 確定性寫入正確值。**絕對禁止**：caller 值成為 witness、改寫 writer 導出的值、或使非 source-2 DP 取得 witness。
83. **TransitionRef 形狀負向**：`reopenCauseRef` 為 malformed（key set 非恰為 {kind, ref}、`ref` 為空字串或非字串）、wrong kind（`kind != "transition"`，即使 id 存在）、或 dangling（解析不到 Transition）→ 各自 fail-closed，依上游 SM typed refs 區的 TransitionRef 定義。
84. **borrowed Transition**：`reopenCauseRef` 指向一筆真實存在但 `subject != DP.priorTerminalRef` 的 Transition（他 DP 的收斂、或 subject 不對位）→ fail-closed。
85. **witness coherence 是 loader 的職權上限**：**正向拒絕** —— DP 為 resolved／decided／assumed 卻帶 non-null `reopenCauseRef`，或其 subject／successor／applicability／trigger／status／terminal／carrier 任一不一致 → **loader／gate fail-closed**（繞過交易入口直接構造亦須被擋）。**明文不宣稱** —— 一筆結構完全自洽的 witness（subject == priorTerminalRef ∧ successor != null ∧ applicable == false ∧ trigger 序列化正確 ∧ status=open ∧ terminal 與 resolution carrier 皆 null）**無法**被 loader 分類回 explicit reopen／retire；模型沒有第二份歷史來源，這屬上游 SM §2 的 non-adversarial assurance boundary。非 source-2 路徑輸出 null 由 **command-time lifecycle** 保證，實測見 AC87。
86. **repoint／resolve 時清除**：帶 witness 的 open DP 之後被 repoint 或落定為任一 terminal → post-state `reopenCauseRef` 必為 null。
87. **explicit reopen／retire 時清除**：帶 witness 的 DP 之後經 `reopen-dp` 或 retire 造成的 reopen → post-state `reopenCauseRef` 必為 null（成因已改變，舊 witness 不得殘留）。
88. **第二次 source-2 reopen 時替換**：同一 DP 再次因 source-2 而 reopen → `reopenCauseRef` 必**替換**為新交易的 TransitionRef，且不得殘留舊值。
89. **版本邊界為可執行矩陣**：驗收必須驅動**持久化的 `provenanceVersion`** 與**真實的** `migrate-store-v1-to-v2` 交易，不得靠兩份形狀相同的手工 snapshot 加測試名稱區分。八格全覆蓋：
    (i) **v1 current store、無 TaskState、DP 缺欄位** → migration **成功**：post-state 為 version 2，且**每個** DP 帶 explicit `reopenCauseRef: null`；
    (ii) **v2 current store、DP 缺欄位** → **fail-closed**（writer defect）；
    (iii) **v1 current store 含 TaskState** → 依本版明訂的 unsupported policy **fail-closed／no-write**（理由是無 re-baseline command，**不得**再引用「base digest 必然 stale」）；
    (iv) **正常 domain command 直接操作 current v1 store** → **fail-closed**，只有 migration 交易可進；
    (v) **current store 已是 v2，但 `baseProvenance.treeOid` 指向歷史 v1 store** → read-only checker 能驗該歷史 tree 的**原始** v1 `storeDigest` 並通過，**不遷移**該 tree、不回寫、不拿 normalized bytes 比對 raw digest；
    (vi) **migration 失敗／中途 crash** → store bytes 位元不變、`TaskState.committedProvenanceBatchRef` 未變、lock 釋放、無 temp 殘留。另驗 version 2 再次呼叫 migration → **fail-closed**。
    (vii) **`provenanceVersion` 缺席／未知值／非整數** → **dispatch 階段 fail-closed**，不得進入 v1 decoder 也不得進入 v2 loader（版本判定先於任何 version-specific 驗證）；
    (viii) **current v1 store 的任一 DP 已帶 `reopenCauseRef`** —— 至少分別測 **explicit null** 與**合法形狀的 TransitionRef** 兩種值 → **migration-only pre-validator fail-closed**，既有值**不得被覆寫或移除**（宣稱是 v1 卻已帶新欄位者來歷不明，靜默覆寫等於用猜測抹掉可能真實的 witness）。
    (vii)、(viii) 兩格同樣沿用 **AC90** 的 no-write 斷言：store bytes 位元不變、`committedProvenanceBatchRef` 維持原狀（原本缺席者仍缺席）、lock 釋放、無 temp 殘留，且**不得執行任何 partial migration**。
90. **拒絕即 no-write**：AC82–89 的**每一個**拒絕案例都必須驗 store bytes 位元相同、`TaskState.committedProvenanceBatchRef` 未變、lock 已釋放且無 temp 檔殘留。
91. **未受影響 DP 的 witness 必須原封不動（preserve 正例）**：pre-state 放一個持有合法 non-null `reopenCauseRef` 的 DP-X；執行任一只影響 DP-Y 的交易或 batch → post-state DP-X 的 `reopenCauseRef` 必須維持**同一筆** TransitionRef，不得被清除、替換或重寫，且 DP-X 的其餘 causal 欄位（`status`、三個 terminal ref、`priorTerminalRef`、`reopenedBy`、`resolutionRulingRef`）亦不得被順手改動。
92. **Canonical ULID grammar 與其邊界**（carrier：§8 canonical ULID grammar）：**正例** —— `00000000000000000000000000`（下界）、`7ZZZZZZZZZZZZZZZZZZZZZZZZZ`（上界）、以及一筆由既有 mint algorithm 實際產生且吻合本 grammar 的 ULID（證明 grammar 未把自家鑄造結果排除在外）。**單變數負例，每一條都必須 fail-closed，且不得 normalize 後接受** —— (i) `80000000000000000000000000`：26 字元且字元全合法，但首字元 `8` 使值超過 128-bit 上限 → **overflow，非法**；(ii) 少 1 byte（25 字元）；(iii) 多 1 byte（27 字元）；(iv) 任一字元為 lowercase（例如 `0000000000000000000000000a`）→ **不得**先 upper-case 再放行；(v) 含 `I`、(vi) 含 `L`、(vii) 含 `O`、(viii) 含 `U` → 四個 Crockford human-input alias **各自非法**，**不得**做 `I`→`1`／`L`→`1`／`O`→`0` 的替換後接受；(ix) 含 `_`、(x) 含 `-`、(xi) 含空白（前導、尾隨或中間）、(xii) 含非 ASCII（例如全形數字）→ 各自非法；(xiii) 「看似可修復」的值 —— 前後有空白可 trim、全小寫可 case-fold、含 alias 可替換者 —— **必須在修補之前就被拒絕**，本 AC 專門用來抓「先正規化再驗證」這個錯誤實作。另驗：`^[0-9A-HJKMNP-TV-Z]{26}$` 作為實作會在 (i) 上放行，因此**不是**合法規則。
93. **Draft／implementation boundary**（carrier：本文件 live status）：v1.10 **仍是 draft**，最後 approved baseline 仍為 **v1.9**。**不得**因本輪宣稱 store validator 已實作 canonical ULID validation —— 現行 `provenance-store.mjs` 只檢查 `REQ-`／`DEC-`／`ASSUM-` 前綴，從不驗 ULID body，本輪**未改動任何程式**。**不得**宣稱 migration、implementation 或 Phase 2 READY。在 v1.10 promotion 之前，生效契約仍是 **approved v1.9**，draft 規則**不得實作**。

### Store-script 實作層 assertion（非模型規則，直接寫進 script tests）

- `technical-decision.selectedAlternative` 必須存在於 input snapshot 的 `alternatives`。
- `approved-provisional` 的 selected／rejected 必須**互異**且**皆來自** `alternatives`；另驗 `ASSUM.layer == DP.layer`。

## 14. 邊界與非目標

- 不動 test tag／contract-check／test-reviewer（test-provenance spec）。
- 不削弱 `verification-gate.md` 紅→綠。
- **scan 本身不新增 unconditional pass**；治理 call（pre-gate 分類／scope、row-7 裁決）僅在對應 DP 存在時條件執行，且均為 read-only proposal —— 寫 store 的永遠是 main thread。
- **Partial contract 明文排除於 v1**：要恢復並行，須另立 partial-contract 版本與更新規則的 spec 變更。
- 語義判斷明文不宣稱機械保證：DP 同一性（§9）、受影響範圍判定（§6）、layer 初判（§4）；loader 只證 snapshot 一致性（§8）。
