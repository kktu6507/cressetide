# Shared Decision & Provenance Model（共同決策與溯源模型）

- 狀態：draft v1 — 審閱中。核准後成為 intent-scan 與 test-provenance 兩份 implementation spec 的共同上游；下游 spec 不得重新定義本文概念。
- 日期：2026-07-25
- 範圍：只定義模型 —— 物件、權威、分流、狀態、不變量。scan 觸發與流程、檢查器實作、reviewer prompt 調整、hook 接線屬於下游 spec。
- 背景：源自 demo1 webhook-dispatcher A/B 實驗的失敗分析 —— 23 個未申報假設以測試形式被釘死（oracle 不相容 23:1）、規格沉默區被單方面填補後用綠色測試鎖死。本模型同時治理「猜錯」（intent 層）與「猜了沒說」（provenance 層）。

## 1. 權威層級

四種 test tag，對應「誰擁有這個決定」：

| tag | 擁有者 | 語義 | 紅燈合法處置 |
|---|---|---|---|
| `REQ-n` | 產品／契約 | binding 裁決結果 | 修實作，或授權契約變更（§7 supersede） |
| `DEC-n` | 工程治理 | reviewer／arbiter 審查後的刻意技術裁決 | 恢復行為，或由同／更高治理角色建新 DEC supersede |
| `ASSUM-n` | 無權威背書 | 暫定讀法：revision-allowed、acknowledgement-required | 恢復行為，或具名修訂／退役（附理由） |
| `EXPL` | — | 探索性，無 clause | 更新或刪除自由 |

`@src REQ-n | DEC-n | ASSUM-n | EXPL` —— tag 表規範權威，不表 CI 行為；必要 suite 內一律綠（exit code 與權威性分離）。EXPL 要 non-gating 就置於必要 suite 之外。

治理角色順序（僅供 DEC supersede 使用）：同 discipline 的 reviewer 互為同級；arbiter 視為較高（其本為 findings 的最終裁決者）。

### 來源權威

- **binding**：`hard-constraint`（法規、組織安全政策、外部契約）＞ `approved-requirement` ＞ `compatibility`（經核准凍結的觀察行為）。
- **observational**：code、tests、callers、資料現況 —— 只是證據，單向升高風險，永不裁決 intent。
- 觀察行為升格 binding 的唯一路徑：plan gate 核准的 compatibility clause，一次一條。
- 字面規則（規格中每個修飾詞都承重）僅適用於單一 binding source 內部、無內部矛盾時；字面裁不動＝未裁決。

## 2. 物件

### Source（固化來源快照）

```
sourceId:  S-n
kind:      file | conversation-snapshot | policy | external-contract
locator:   path#anchor 或 snapshot 位置（查找輔助）
excerpt:   被引用的 anchored 內文
digest:    sha256(excerpt) —— 綁內文不綁位置；來源檔無關段落的修改不波及既有 clause
```

需求一律先固化：對話需求 → snapshot。新 clause 不存在「來源不可取得」。Source append-only。

### Clause：REQ

```
id:            REQ-n
authority:     hard-constraint | approved-requirement | compatibility
kind:          acceptance | specification
text:          條款內文
sourceRef:     S-n（＋locator）
status:        active | superseded | retired
supersedes:    REQ-n?（具名）
supersededBy:  REQ-n?
compatibilityDisposition:  §7（supersedes 存在時必填）
```

### Clause：DEC

```
id:             DEC-n
layer:          implementation（固定 —— intent 層的裁決屬產品，走 REQ）
derivedFrom:    DP-n
decision:       選定方案
alternatives:   [...]
basisRefs:      [S-n | observational refs | review ruling]
approvedByRole: security_reviewer | architecture_reviewer | code_reviewer | arbiter
status:         active | superseded | retired
supersedes:     DEC-n?
supersededBy:   DEC-n | REQ-n?
```

### Clause：ASSUM

```
id:           ASSUM-n
layer:        intent | implementation（承自 DP）
derivedFrom:  DP-n
text:         選定讀法
alternative:  被否決讀法（必填）
basis:        選擇依據
basisRefs:    [S-n | observational refs]
scenario:     distinguishingScenario（intent 層必填）
status:       active | revised | superseded | retired
revises:      ASSUM-n?   ┐ 修訂鏈，雙向、
revisedBy:    ASSUM-n?   ┘ 新 ID，不用撇號表示
supersededBy: REQ-n | DEC-n?（升級收斂）
```

所有轉移 acknowledgement-required；append-only，不原地改寫。

### DecisionPoint

```
id:                  DP-n
dimension:           actor | lifecycle | data | money | external | failure | time | OTHER
                     （closed set；OTHER 需已有具體 scenario，事後進 taxonomy review）
scenario:            distinguishingScenario（建檔門檻：寫不出即不建 DP）
alternatives:        [...]
layer:               intent | implementation
classificationBasis: 為何此決定屬產品／工程權限（必填）
materialReasons[]:   safeToAssume 失敗 conjunct 的衍生清單
discoveredAt:        plan-scan | test-time | review（純遙測，不參與路由）
status:              open | asked | resolved | decided | assumed
resolvedBy:          REQ-n（status=resolved 必填，INV-2）
decidedBy:           DEC-n（status=decided 必填，INV-2）
assumedAs:           ASSUM-n（status=assumed 必填，INV-1）
```

## 3. layer 判準（decision authority）

```
intent:          選邊會決定 stakeholder 的權利、義務、產品政策或核心承諾，
                 且現有契約未把這類決定授權給工程端。
implementation:  所有選項都維持既有產品承諾；
                 工程端可依技術標準、相容性、效能、慣例選邊。
```

- 七維度是 discovery taxonomy，**不具分類權威**（await-null 可塞 time、error class 可塞 failure —— 維度歸屬不能定 layer）。
- 無法判別 → intent-reviewer 分類，永不預設 implementation。
- 開發者 API 也是產品：error class 等 API 表面是否 intent，看是否已形成 caller recovery contract；若已形成，通常已被 source 裁決，到不了 layer 判斷。
- test-time／review 發現的 intent fork 必須重開 plan gate（＝AskUserQuestion，回答固化為 REQ）。discoveredAt 不參與 layer 或處置。

## 4. safeToAssume

```
safeToAssume ＝ 低成本可回復
             ∧ 不涉 protected domains（金錢、權限、資料遺失、隱私、法規、安全、外部契約）
             ∧ 不形成難遷移的相容承諾
             ∧ 不改變核心產品承諾
```

materiality 是衍生值：`materialReasons[]` ＝ 失敗的 conjunct 清單；不另設獨立布林（消除雙重判斷）。「選擇與 alternative 明文記錄」「不偽裝成 REQ」是 Record 動作本身的義務，非路由條件。

## 5. 分流表（互斥、可到達、完備；逐 persisted DP 依序判定）

| # | 前提 | 路由 | 產物 |
|---|---|---|---|
| 1 | 有適用 binding clause 且無衝突（含字面規則） | resolved | cite REQ-n |
| 2 | 衝突涉 hard-constraint | Ask「改需求／取得例外」（不給選邊） | 回答 → 新 REQ 或例外紀錄 |
| 3 | requirement vs compatibility，新方持有效 supersede（§7 三要件） | 依 supersede 裁＋揭露 | cite 新 REQ；舊 clause → superseded |
| 4 | 其他 clause 衝突（同層；或 supersede 無效） | Ask | 回答 → supersede 授權／需求修訂 → 新 REQ |
| 5 | 未裁決 ∧ safeToAssume | assume | ASSUM（INV-1；ephemeral candidate 見 §6） |
| 6 | 未裁決 ∧ ¬safeToAssume ∧ layer=intent | Ask | 回答 → 新 REQ；明示延後 → ASSUM＋user-ack |
| 7 | 未裁決 ∧ ¬safeToAssume ∧ layer=implementation | 技術審查（依 domain：security／architecture／code reviewer 或 arbiter） | 四分，見下 |

row 7 審查結果四分：

```
找到既有 binding technical policy → resolved(REQ)   ← 政策固化為 Source，新 REQ cite 之
正式工程裁決                      → decided(DEC)
證據不足、僅核准暫定預設           → assumed(ASSUM)
浮現產品取捨                      → 轉 row 6（asked）
```

material implementation fork 不自動丟使用者；只有浮現產品取捨或需額外授權才 Ask。

## 6. 持久化規則與不變量

- plan-scan 產出的 DP 一律持久（受 closed 維度清單約束，不會爆量）。
- test-time implementation fork：無斷言 ∧ 無 reviewer 要求 ∧ 無追蹤需求 → **整筆不入模型**（ephemeral candidate）。「無 artifact」是入不入模型的決定，不是 assumed 狀態的一種結果。
- **INV-1**：persisted DP 之 `status=assumed` ⇒ `assumedAs: ASSUM-n` 必填（杜絕 silent assumption 復活）。
- **INV-2**：`status=decided` ⇒ `decidedBy` 必填；`status=resolved` ⇒ `resolvedBy` 必填（INV-1 的對稱閉合）。
- **INV-3**：Source 與所有 clause append-only；修訂＝新條目＋雙向指標，不原地改寫。

## 7. supersede（明示授權，非自動優先）

```
有效 supersede ＝ 具名 supersedes: REQ-n
              ∧ 明示 compatibility impact
              ∧ 核准的 compatibilityDisposition ∈ {
                  migration | version-boundary | deprecation-window |
                  coordinated-cutover | no-affected-dependents | accepted-breaking }
缺任一 → 回落 Ask（row 4）
```

- 不存在「較新所以自動覆蓋」。
- 「沒有 migration」不免除相容處理：未發布／零使用者 → `no-affected-dependents`；major 版本 → `version-boundary`。非破壞性換版同樣走三要件，disposition 取 `no-affected-dependents`。
- hard-constraint 不可被 supersede；只能改需求或取得有效例外。
- DEC supersede：同／更高治理角色（同 discipline reviewer，或 arbiter）。

## 8. 狀態機

**DecisionPoint**

```
建立（plan-scan | test-time | review；定 layer＋classificationBasis；ephemeral 不入模型）
open ─ row1/3 ──→ resolved(resolvedBy: REQ-n)
open ─ row2/4/6 → asked ─┬─ 回答 ────→ resolved(新 REQ)
│                        └─ 明示延後 → assumed(assumedAs: ASSUM-n＋user-ack)
open ─ row5 ───→ assumed(assumedAs: ASSUM-n)
open ─ row7 ───→ 技術審查 ─┬─ resolved(REQ)
│                          ├─ decided(decidedBy: DEC-n)
│                          ├─ assumed(assumedAs: ASSUM-n)
│                          └─ asked（產品取捨）
assumed | decided ─ 新證據（新 caller、review、稽核）→ open 重入分流
                    （intent fork 重入必經 asked ＝ plan gate 重開）
assumed ─ 使用者裁決 → resolved；原 ASSUM → superseded(supersededBy: REQ-m)
decided ─ 產品裁決 → resolved；原 DEC → superseded(supersededBy: REQ-m)
```

**REQ**：`active → superseded(REQ-m) | retired`。excerpt digest 失配 → fail-closed 重新確認 → 新 Source＋新 REQ supersede 舊條目。

**DEC**：`active → superseded(DEC-m | REQ-m) | retired`。

**ASSUM**：`active → revised(revisedBy: ASSUM-m) | superseded(supersededBy: REQ-m | DEC-m) | retired`。

升級碰測試：`@src ASSUM-n`／`DEC-n` 的測試 retag 至新 clause（裁決與原選擇一致時），或依 verification-gate 對新 REQ 重做紅→綠（裁決選了 alternative 時）。沒有升級路徑，revision-allowed 會永遠停在假設層。

## 9. 檢查分層

| 層 | 內容 | 失敗行為 | 範圍 |
|---|---|---|---|
| 結構 | 新增／修改測試的 tag 存在、ID 可解析到 clause | **fail-closed** | 本次 run |
| 來源 | Source 存在、sourceRef 可解析、excerpt digest 相符 | **fail-closed** | 本次新增／修改的 clause |
| 語義 | assertion 是否被 clause 蘊含、是否超出 tag 範圍 | test-reviewer 判斷 | 全部 |
| Legacy | 本次未觸及的既有測試／條款 | fail-open，只觀測 | 本次以外 |

**Assurance boundary（明文）**：機械檢查止於 presence／resolution／digest；語義蘊含由 test-reviewer 審。presence 級檢查不得宣稱為完整 provenance 保證（failure memory：presence-only check 曾被當 coverage 讀）。

## 10. 觀測（非 gate）

- DP 計數（layer × status × discoveredAt）進 run ledger：觀測值，永不當 gate —— 數字上升可能代表偵測變好。append 為流程副作用，不綁報告格式 sentinel（failure memory：run-ledger append 曾被 format-gated 餓死）。
- `intent-scan: no-applicable-dimension` 是合法結束狀態，**不得推出 task trivial**；implementation risk 由 Risk Matrix 獨立判定。
- discoveredAt 分布餵 capture-recapture 稽核（獨立 blind reader、Chao1 估計母體）的校準。

## 11. 邊界

- 不削弱 `verification-gate.md`：REQ（kind=acceptance）照規定紅→綠。
- brownfield：只約束本次 run 新增／修改的測試與 clause。
- reviewer 路由：ASSUM(intent) → intent-reviewer；ASSUM(implementation) → test／code-reviewer；DEC → 原 approvedByRole 的 discipline（與既有 repair-loop rerun 規則一致）。
- 下游分工：**intent-scan spec**（觸發條件、七維度流程、Ask 批次、plan gate 接線）；**test-provenance spec**（tag 語法、contract-check 三層檢查、test-reviewer prompt、ledger 接線）。
