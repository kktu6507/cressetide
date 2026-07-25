# Shared Decision & Provenance Model（共同決策與溯源模型）

- 狀態：**draft v1.7 — 修訂待 panel**（前一放行版本：approved v1.6）。本次變更集中於 §9：測試集合納入移除／改綁／移動，並把綁定拆成 **pre-change／post-change 兩相**（前態只驗可解析與 snapshot integrity，現時效力只課於後態）；其餘章節未動。本文件為 intent-scan 與 test-provenance 兩份 implementation spec 的共同上游；下游 spec 不得重新定義本文概念，可附加實作欄位但不得改變本文欄位語義。
- 日期：2026-07-25
- 範圍：只定義模型 —— 物件、權威、分流、狀態、不變量。scan 觸發與流程、檢查器實作、reviewer prompt 調整、hook 接線屬於下游 spec。
- 背景：源自 demo1 webhook-dispatcher A/B 實驗的失敗分析 —— 23 個未申報假設以測試形式被釘死（oracle 不相容 23:1）、規格沉默區被單方面填補後用綠色測試鎖死。本模型同時治理「猜錯」（intent 層）與「猜了沒說」（provenance 層）。

## 1. 權威層級

四種 test tag，對應「誰擁有這個決定」：

| tag | 擁有者 | 語義 | 紅燈合法處置 |
|---|---|---|---|
| `REQ-n` | 產品／契約 | binding 裁決結果 | 修實作，或授權契約變更（§7 supersede） |
| `DEC-n` | 工程治理 | discipline reviewer／arbiter 審查後的刻意技術裁決 | 恢復行為，或由同／更高治理權威建立 supersede Transition |
| `ASSUM-n` | 無權威背書 | 暫定讀法：revision-allowed、acknowledgement-required | 恢復行為，或建立 revise／retire Transition（附 ackRef） |
| `EXPL` | — | 探索性，無 clause | 更新或刪除自由 |

`@src REQ-n | DEC-n | ASSUM-n | EXPL` —— tag 表規範權威，不表 CI 行為；必要 suite 內一律綠（exit code 與權威性分離）。EXPL 要 non-gating 就置於必要 suite 之外。

### Discipline 與治理順序

```
discipline ∈ { security | architecture | code | test | operability | ui-ux | intent }

ReviewerPrincipal ＝ { kind: discipline, discipline: 上列 enum }
                  | { kind: arbiter }
```

`DEC.approvedBy`、`ASSUM.governedBy`、Transition 權威、row 7 與 rerun routing **全部共用 `ReviewerPrincipal`** —— arbiter-owned outcome 因此可直接寫進 schema。shared model 只使用 discipline／principal，不綁 agent 名稱；下游 spec 負責映射到具體 reviewer。`intent` discipline 擁有 requirement-fidelity 與產品語義判斷：layer 分類 fallback、ASSUM(intent) 治理、row 2／4／6 的 Ask 擬題。

治理順序（供 Transition 權威判定）：同 discipline 互為同級；**arbiter** 為跨 discipline 的最終裁決者，視為較高。

### 來源權威（衝突裁決規則 —— 無自動優先序）

三種 binding authority 是分類，不構成自動覆蓋鏈：

- **hard-constraint**（法規、組織安全政策、外部契約）：不可被 requirement supersede；普通 user 亦**不可 retire**（見 §2 Transition 有效性表 —— 僅 constraint owner 的撤回憑據可使其失效）。與 requirement 衝突且無涵蓋本 DP 的有效例外 → Ask「改需求或取得有效例外」，不給選邊。
  **有效例外**：固化為 `exception-grant` Source（§2，必含 targetConstraintRef、grantAuthorityRef、scope、expiry；grantAuthorityRef **必須匹配該 constraint 的 `ownerRef`**，§9 機械驗證 —— user／discipline／arbiter 不可冒充 constraint owner），再建立 REQ 引用之。**存在 applicable（§2：mechanicallyApplicable ∧ scopeCovers）的 exception-backed REQ 時 → 本 DP 於例外 scope 內走 row 1 resolved，不重複 Ask；scope 外仍由原 hard-constraint 裁決。**例外只建立 scoped exception，永不退役原 constraint。
- **approved-requirement vs compatibility**：無自動優先。無 plan-gate 核准的 supersede proposal → Ask（row 4）；持完整 proposal（§7）→ row 3。
- **同層衝突** → Ask。
- **observational**（code、tests、callers、資料現況）：只是證據，單向升高風險，永不裁決 intent。升格 binding 的唯一路徑：plan gate 核准的 compatibility clause，一次一條。
- 字面規則（規格中每個修飾詞都承重）僅適用於單一 binding source 內部、無內部矛盾時；字面裁不動＝未裁決。

## 2. 物件

Provenance 物件（Source、Clause、Transition）**完全 immutable**；DecisionPoint 是流程工作紀錄，可變。

### Source（固化來源快照，immutable）

```
sourceId:     S-n
contentKind:  requirement | policy | external-contract | exception-grant
driftMode:    repo-file | snapshot-only
locator:      repo 路徑#anchor（driftMode=repo-file）或 snapshot 位置（查找輔助，允許 stale，不回寫）
excerpt:      被引用的 anchored 內文（存於模型內，即 immutable snapshot payload）
digest:       sha256(canonical(excerpt))，§9
--- contentKind=exception-grant 必含 ---
targetConstraintRef:  REQ-n（authority=hard-constraint，被例外的對象）
grantAuthorityRef:    {kind: source-authority, ref} —— 必須與 targetConstraintRef 所指 REQ 的
                      ownerRef 相等（§9 機械比對；user／discipline／arbiter 不可冒充）
scope:                適用範圍
expiry:               期限
```

語義與 drift 檢查解耦：repo 內的 policy 檔 → `contentKind=policy, driftMode=repo-file`（執行 Check B）；對話需求 → `contentKind=requirement, driftMode=snapshot-only`。需求一律先固化；新 clause 不存在「來源不可取得」。

### Clause：REQ（immutable，無生命週期欄位）

```
id:         REQ-n
authority:  hard-constraint | approved-requirement | compatibility
kind:       acceptance | specification
text:       條款內文
sourceRef:  S-n（＋locator）
ownerRef:   {kind: source-authority, ref}（authority=hard-constraint 必填 ——
            constraint 的現實擁有者：監管機關、外部契約方、組織政策擁有者，固化為 stable record）
```

### Clause：DEC（immutable）

```
id:          DEC-n
layer:       implementation（固定 —— intent 層的裁決屬產品，走 REQ）
derivedFrom: DP-n
decision:    選定方案
alternatives: [...]
basisRefs:   [S-n | RecordRef(review-ruling) | ObservationalRef]
approvedBy:  ReviewerPrincipal（§1）
```

### Clause：ASSUM（immutable）

```
id:          ASSUM-n
layer:       intent | implementation（承自 DP）
derivedFrom: DP-n
text:        選定讀法
alternative: 被否決讀法（必填）
basis:       選擇依據
basisRefs:   [S-n | RecordRef(user-answer | review-ruling) | ObservationalRef]
             （row 6 明示延後時含 user-answer RecordRef）
scenario:    distinguishingScenario（intent 層必填）
governedBy:  ReviewerPrincipal —— 治理此假設的權威：
             row 7 產生 → 繼承審查它的 principal（可為 arbiter）
             row 5 產生 → 固定映射：layer=intent → {discipline: intent}；
                          layer=implementation → {discipline: code}
```

### Transition（append-only event log —— 生命週期的唯一真相）

```
id:        T-n
subject:   REQ-n | DEC-n | ASSUM-n
action:    revise | supersede | retire
successor: clause ref（retire 無後繼 → ∅）
authorityRef:（宣告的權威 principal —— 本身不是獨立 witness，效力由 ackRef 建立）
  kind:       user | discipline | arbiter | source-authority
  discipline: §1 enum（kind=discipline 必填；kind∈{discipline, arbiter} 的組合即 ReviewerPrincipal，
              與 DEC.approvedBy／ASSUM.governedBy 同型別）
  ref:        僅 kind=source-authority 必填 —— constraint owner record（R-n），
              必須等於 target REQ 的 ownerRef
ackRef:     RecordRef（kind: user-answer | review-ruling | plan-gate | exception-grant |
            constraint-revocation；依 External-record contract 解析）——
            授權本 Transition 的 witness
compatibility:（僅 subject=REQ ∧ action=supersede，必填）impact 陳述 ＋ disposition（§7）
```

有效性規則：

| subject | action | authorityRef 要求 | 備註 |
|---|---|---|---|
| REQ（approved-requirement／compatibility） | supersede | kind=user（經 plan gate） | §7 proposal 必備；ackRef.kind=plan-gate |
| REQ（approved-requirement／compatibility） | retire | kind=user 授權撤除 | |
| REQ（**hard-constraint**） | supersede | **禁止** | 只能走 scoped exception（§1） |
| REQ（**hard-constraint**） | retire | kind=source-authority ∧ **匹配該 REQ 的 ownerRef** | ackRef.kind=constraint-revocation，撤回文件固化為 Source；user／discipline／arbiter 不可冒充 |
| REQ | revise | **不存在** —— REQ 語義變更一律走 supersede | |
| DEC | supersede / retire | 同 discipline 或 arbiter | successor=REQ 時為 kind=user（產品裁決） |
| ASSUM | revise / retire | **governedBy 的同一 principal，或 arbiter**；ackRef 必附具名理由 | 防止他 discipline 撤銷 security／operability 治理的暫定假設 |
| ASSUM | supersede | successor=REQ → kind=user；successor=DEC → 原 governedBy principal ∨ arbiter ∨ **經正式 rerouting 的 current review principal**（需 review-ruling witness：`by == DEC.approvedBy == authorityRef principal`，subjectRef 綁定本 DP） | 升級收斂；防任意跨 discipline 覆寫，同時容許 reopen 後的 domain transfer |

- Transition 僅在 subject 當時為 active 時有效；**每個 clause 至多一個生效 Transition**（單終態）。
- `authorityRef` 與 `ackRef` 為每筆 Transition 必填。**Witness binding** —— authority 的效力由 ackRef 指向的 witness payload 建立，任意合法 record 不可借用：

```
kind=discipline|arbiter → ackRef.kind=review-ruling
                          ∧ review-ruling.by == authorityRef principal
                          ∧ review-ruling.subjectRef 綁定本 Transition 的 subject 或其 DP
kind=user             → 依 action：supersede／retire → plan-gate record，
                          target == subject（supersede 另含 §7 三欄一致）；
                          ask 回答產生的轉移 → user-answer record，subjectRef == 該 DP
kind=source-authority → ackRef.kind=constraint-revocation
                          ∧ ack.authorityRef == target REQ.ownerRef == authorityRef.ref
```

**Derived fields（read model 推導，不再是 authored 欄位）**：

```
status(c)       ＝ active（無生效 Transition）| revised | superseded | retired（依生效 Transition.action）
revisedBy(c)    ＝ T.successor where T.subject=c ∧ action=revise
supersededBy(c) ＝ T.successor where T.subject=c ∧ action=supersede
mechanicallyApplicable(c) —— per kind（下游不得自行猜測「來源檢查」對 DEC／ASSUM 的意思）：
  REQ:   status=active ∧ 來源檢查通過（§9 Check A/B）
         ∧（exception-backed 時：未過期 ∧ targetConstraintRef 可解析）
  DEC:   status=active ∧ approvedBy principal 合法（§1 型別）∧ derivedFrom DP 可解析
         ∧ basisRefs 中的 S-n／RecordRef 可解析（ObservationalRef 不解析）
  ASSUM: status=active ∧ governedBy principal 合法 ∧ derivedFrom DP 可解析
         ∧ basisRefs 中的 S-n／RecordRef 可解析（ObservationalRef 不解析）
scopeCovers(c, DP)        ＝ intent discipline 的語義判斷 —— 僅 exception-backed REQ 非恆真，
                            ruling 以 DP.scopeRulingRef 留存 stable ref
applicable(c, DP)         ＝ mechanicallyApplicable(c) ∧ scopeCovers(c, DP)
```

### External-record contract（RecordRef —— 跨物件共用的可解析引用）

```
RecordRef:
  kind: source-authority | user-answer | review-ruling | plan-gate |
        constraint-revocation | exception-grant
  ref:  stable record id（R-n；kind=exception-grant 例外 —— 解析到 Source namespace 的 S-n）
```

- **Namespace 與 lookup 邊界**：R-n 與 S-n／REQ-n／DEC-n／ASSUM-n／DP-n／T-n 同屬本 repo 的 provenance store；解析只在 store 內進行。repo 外的 URL／文件不是可解析 ref —— 需先固化為 Source。實體儲存與 id 鑄造由下游 spec 定，**payload 要求不得更動**。
- **Immutability**：record 一經建立即 immutable；更正＝新 record，既有 ref 不改指。
- **「可解析」成功條件**：record 存在於 store ∧ kind 與期待相符 ∧ minimum payload 齊備。
- **Minimum payloads**（全部隱含 immutable）：

```
source-authority:      recordId, authorityIdentity（constraint 擁有者身分，固化描述）
user-answer:           recordId, subjectRef（DP-n）, answer
review-ruling:         recordId, by: ReviewerPrincipal, subjectRef（DP-n | clause ref）, ruling
plan-gate:             recordId, target, impact, disposition, approvedBy（user）
constraint-revocation: recordId, targetConstraintRef, authorityRef（source-authority，
                       匹配 ownerRef）, effectiveAt
exception-grant:       ＝ Source（contentKind=exception-grant；payload 見 Source schema）
```

- **ObservationalRef**：對觀察性證據（code path、caller、資料現況）的描述性指標 —— **明文不解析**，disclosure-only；不屬 RecordRef，不參與機械 resolution。
- **Non-adversarial boundary**：checker 證明 record 存在、型別正確、ref 相等，不證明現實身分。

### DecisionPoint（流程工作紀錄，可變）

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
reopenedBy:          reopen trigger（§8 closed list；重入時必填）
status:              open | asked | resolved | decided | assumed
resolvedBy:          REQ-n（status=resolved 必填，INV-2）
decidedBy:           DEC-n（status=decided 必填，INV-2）
assumedAs:           ASSUM-n（status=assumed 必填，INV-1）
scopeRulingRef:      RecordRef(kind=review-ruling)
                     ∧ record.by == {kind: discipline, discipline: intent}
                     ∧ record.subjectRef == 本 DP（他 DP 的合法 intent ruling 不可借用）
                     （resolvedBy 為 exception-backed REQ 時必填 —— scopeCovers 的可追溯憑據）
```

## 3. layer 判準（decision authority）

```
intent:          選邊會決定 stakeholder 的權利、義務、產品政策或核心承諾，
                 且現有契約未把這類決定授權給工程端。
implementation:  所有選項都維持既有產品承諾；
                 工程端可依技術標準、相容性、效能、慣例選邊。
```

- 七維度是 discovery taxonomy，**不具分類權威**（await-null 可塞 time、error class 可塞 failure —— 維度歸屬不能定 layer）。
- 無法判別 → intent discipline 分類，永不預設 implementation。
- 開發者 API 也是產品：error class 等 API 表面是否 intent，看是否已形成 caller recovery contract；若已形成，通常已被 source 裁決，到不了 layer 判斷。
- test-time／review 發現的 intent fork 必須重開 plan gate（＝AskUserQuestion，回答固化為 REQ）。discoveredAt 不參與 layer 或處置。

## 4. safeToAssume

```
safeToAssume ＝ 低成本可回復
             ∧ 不涉 protected domains（金錢、權限、資料遺失、隱私、法規、安全、外部契約）
             ∧ 不形成難遷移的相容承諾
             ∧ 不改變核心產品承諾
```

materiality 是衍生值：`materialReasons[]` ＝ 失敗的 conjunct 清單；不另設獨立布林。「選擇與 alternative 明文記錄」「不偽裝成 REQ」是 Record 動作本身的義務，非路由條件。

## 5. 分流表（互斥、可到達、完備；逐 persisted DP 依序判定）

| # | 前提 | 路由 | 產物 |
|---|---|---|---|
| 1 | 有適用 active 且 **applicable** binding clause 且無衝突（含字面規則；exception-backed REQ 需 scopeCovers ruling，記入 DP.scopeRulingRef） | resolved | cite REQ-n |
| 2 | 衝突涉 hard-constraint，**且無涵蓋本 DP 的有效例外** | Ask「改需求／取得例外」（不給選邊） | 回答 → 新 REQ，或 exception-grant Source＋引用它的 REQ（此後同類 DP 於 scope 內走 row 1） |
| 3 | requirement vs compatibility，**已有 plan-gate 核准的 supersede proposal**（§7：具名 target＋impact＋disposition 完整） | 執行 supersede＋揭露 | 建立新 REQ＋supersede Transition（完成後即 effective supersede）；舊 clause 轉 superseded（derived） |
| 4 | 其他 clause 衝突（同層；或 proposal 不完整） | Ask | 回答 → proposal 核准／需求修訂 → 新 REQ |
| 5 | 未裁決 ∧ safeToAssume | assume | ASSUM（INV-1；governedBy 依 §2 固定映射；ephemeral candidate 見 §6） |
| 6 | 未裁決 ∧ ¬safeToAssume ∧ layer=intent | Ask | 回答 → 新 REQ；明示延後 → ASSUM（basisRefs 含 user answer snapshot） |
| 7 | 未裁決 ∧ ¬safeToAssume ∧ layer=implementation | 技術審查（依 domain 之 discipline 或 arbiter） | 四分，見下 |

row 7 審查結果四分：

```
找到既有 binding technical policy → resolved(REQ)   ← 政策固化為 Source，新 REQ cite 之
正式工程裁決                      → decided(DEC)
證據不足、僅核准暫定預設           → assumed(ASSUM，governedBy=審查 principal)
浮現產品取捨                      → 轉 row 6（asked）
```

material implementation fork 不自動丟使用者；只有浮現產品取捨或需額外授權才 Ask。

## 6. 持久化規則與不變量

- plan-scan 產出的 DP 一律持久（受 closed 維度清單約束，不會爆量）。
- test-time implementation fork：無斷言 ∧ 無 reviewer 要求 ∧ 無追蹤需求 → **整筆不入模型**（ephemeral candidate）。「無 artifact」是入不入模型的決定，不是 assumed 狀態的一種結果。ephemeral 不逐筆持久化；漏抓率由 downstream audit／capture-recapture 處理。
- **INV-1**：persisted DP 之 `status=assumed` ⇒ `assumedAs: ASSUM-n` 必填（杜絕 silent assumption 復活）。
- **INV-2**：`status=decided` ⇒ `decidedBy` 必填；`status=resolved` ⇒ `resolvedBy` 必填（INV-1 的對稱閉合）。
- **INV-3**：Source、Clause、Transition 皆 append-only 且 immutable；clause 不含生命週期 authored 欄位，`status`／`revisedBy`／`supersededBy` 一律為 Transition 推導的 derived fields。
- **INV-4**：每個 persisted DP 至多一個 **current applicable outcome** —— `resolvedBy`／`decidedBy`／`assumedAs` 三者互斥，且必須指向 active 且 applicable（§2 derived 定義）的 clause。terminal clause 失效（retire、supersede、source drift、exception expiry）→ DP 必須 repoint 至後繼；無後繼則 reopen（§8 trigger）。

## 7. supersede（proposal 為前置授權，Transition 為完成態）

```
supersede proposal（pre-state；以 plan-gate 核准紀錄存在，ackRef.kind=plan-gate 指向之）＝
    具名 target: REQ-n
  ∧ 明示 compatibility impact
  ∧ 核准的 disposition ∈ {
      migration | version-boundary | deprecation-window |
      coordinated-cutover | no-affected-dependents |
      backward-compatible | accepted-breaking }
缺任一 → 不構成 proposal，回落 Ask（row 4）

effective supersede（post-state）＝ 依 proposal 執行的 Transition(action=supersede)，
    compatibility block 抄錄 proposal 內容
```

- **Proposal record 是 typed external interface**（不新增模型物件）：`ackRef(kind=plan-gate)` 指向的紀錄必須可解析出 target／impact／disposition 三欄，且與 Transition 的 `subject`／`compatibility` block **完全一致**（§9 機械比對）。只驗「存在」不足 —— 否則任何不相關的 plan-gate 核准都能被拿來當授權。

- 不存在「較新所以自動覆蓋」。
- disposition 全覆蓋且必填 —— 沉默永不代表無影響：零 dependents → `no-affected-dependents`；有 dependents 但不破壞 → `backward-compatible`；major 版本 → `version-boundary`；破壞且明示接受 → `accepted-breaking`。
- hard-constraint 不可被 supersede；只能取得 scoped exception（§1）或由 constraint owner 撤回（§2 有效性表）。

## 8. 生命週期

**DecisionPoint**

```
建立（plan-scan | test-time | review；定 layer＋classificationBasis；ephemeral 不入模型）
open ─ row1/3 ──→ resolved(resolvedBy: REQ-n)
open ─ row2/4/6 → asked ─┬─ 回答 ────→ resolved(新 REQ)
│                        └─ 明示延後 → assumed(assumedAs: ASSUM-n)
open ─ row5 ───→ assumed(assumedAs: ASSUM-n)
open ─ row7 ───→ 技術審查 ─┬─ resolved(REQ)
│                          ├─ decided(decidedBy: DEC-n)
│                          ├─ assumed(assumedAs: ASSUM-n)
│                          └─ asked（產品取捨）
resolved | assumed | decided ─ terminal outcome 失效（INV-4）─→
    successor applicable ? repoint（維持對應 status） : open（reopen）
assumed | decided ─ 其他 reopen trigger ─→ open 重入分流
    （intent fork 重入必須重經 plan-gate routing 揭露；
      僅在仍未被 binding source 裁決時才進 row 2/4/6 asked ——
      新 applicable binding authority 已裁決時直接 row 1 resolved）
assumed ─ 使用者裁決 → resolved；原 ASSUM 經 Transition(supersede, successor=REQ-m)
decided ─ 產品裁決 → resolved；原 DEC 經 Transition(supersede, successor=REQ-m)
```

**DP 沿用與 reopen（防重複裁決）**

同一 DP 已有 active 且 applicable 的 DEC／ASSUM 且無 reopen trigger → **必須沿用**（cite 既有 clause），不重入分流；rerun／review 回到該 clause 的 `governedBy`／`approvedBy` principal（arbiter-owned outcome 回 arbiter）。reopen triggers（closed list，重入時記入 `reopenedBy`）：

```
新 dependent／caller 出現            review 證據推翻 basis
稽核（capture-recapture）判 material  使用者指示
引用來源 drift（§9 Check B）          safeToAssume conjunct 因情境改變而翻轉
terminal clause 失效且無後繼（INV-4）  新 applicable binding authority 出現
```

**Terminal clause 替換（含 row 3 的 REQ supersede、reopen 產生新結果、ASSUM 修訂）一律原子執行：**

```
1. 建立 successor clause（先建 —— Transition 永不指向尚不存在的 successor）
2. successor 為 exception-backed REQ 時：對每個可能 repoint 的 DP 建立／取得
   scope ruling（須滿足 §2 綁定：by == intent ∧ subjectRef == 該 DP ——
   憑據在 repoint 前備妥，否則 repoint 當下即違反 INV-4；
   ruling 存在但指向他 DP 者不算備妥）
3. 對舊 terminal clause（REQ | DEC | ASSUM）建立 supersede／revise／retire Transition
4. 原子處理所有引用 subject 的 DP：
   - successor applicable 且（如適用）scopeRulingRef 完整（含 subjectRef == 該 DP）→ repoint 並設定對應 status
     （successor 為 REQ → resolved；DEC → decided；ASSUM → assumed）
   - 否則（無後繼、不 applicable、或 scope ruling 缺）→ reopen（§8 trigger）
```

**Clause 生命週期**（全部經 Transition，§2 有效性表；status 為 derived）：

```
REQ:   active → superseded(REQ-m) | retired
DEC:   active → superseded(DEC-m | REQ-m) | retired
ASSUM: active → revised(ASSUM-m) | superseded(REQ-m | DEC-m) | retired
```

升級碰測試：`@src ASSUM-n`／`DEC-n` 的測試 retag 至後繼 clause（裁決與原選擇一致時），或依 verification-gate 對新 REQ 重做紅→綠（裁決選了 alternative 時）。

## 9. 來源檢查契約與檢查分層

**Canonical excerpt bytes**：UTF-8（無 BOM）、換行正規化為 LF、其餘不轉換（不 trim、不折疊大小寫 —— 修飾詞承重）。`digest ＝ sha256(canonical(excerpt))`。

**Check A — snapshot integrity**（一律執行）：對模型內儲存的 excerpt（immutable snapshot payload）重算 digest 比對。保證：模型自身的快照未被竄改。gate scope 內 fail-closed。

**Check B — live-source drift**（僅 `driftMode=repo-file`）：在目前 repo 檔案的 canonical bytes 中搜尋 excerpt：

| 情況 | 處置 |
|---|---|
| 唯一匹配，位置 ≠ locator | 通過；locator 僅查找輔助，stale 不失效、不回寫 |
| 零匹配 | **drift**：gate scope 內 fail-closed（重新固化：新 Source＋supersede Transition，或 retire）；scope 外 observe |
| 多重匹配 | 內文仍在，裁決有效；記 anchor-ambiguity 觀測。**新建** Source 時要求唯一（擴大 excerpt 至唯一匹配，否則 fail-closed） |

- `driftMode=snapshot-only`（對話、repo 外 policy、external-contract 等）：僅 Check A。**明文非聲稱**：對 snapshot-only 來源不偵測 live drift。
- `contentKind=exception-grant` 加查 expiry 與 targetConstraintRef 可解析：逾期 → 引用它的 REQ 對任何 DP 不再 applicable，gate scope 內 fail-closed。

**Gate scope（brownfield，單值化）**：

```
gate scope ＝ **本次 provenance binding 有變動的測試**
             （新增、移除、binding 改變、或位置移動 —— v1.7 擴充：舊版只列「新增／修改」，
              會使移除或改綁的測試落到 scope 外 observe-only。此集合的機械導出方式
              由下游 implementation spec 定義，本文不依賴其欄位名）
           ∪ 這些測試的 **preChangeBinding 與 postChangeBinding** 所引用的 clause
             及其 sourceRef／basisRefs Source（含 Transition 推導的 status 與 applicable）
             —— 前態必須在 scope 內，否則「改綁即脫逃」
           ∪ 本次新增／修改的 clause／Source／Transition
           ∪ 所有 current terminal ref 指向本次 changed／transitioned／drifted／expired
             clause 的 DP（INV-4 影響閉包）
```

### 綁定兩相（v1.7）—— 前態不受現時效力課責

**existence 必須進型別** —— 只用 `null` 會把「測試已移除」與「測試還在、但把綁定拿掉了」混為一談，後者正是最該擋的逃逸路徑（拆掉 tag 即跳過 post 驗證）：

```
binding   ＝ { clauseRef, dpRef? } | EXPL
preState  ＝ { exists: false, binding: null }                 ← 本次新增的測試
            | { exists: true,  binding: binding | null }      ← 既有測試；null ＝ 未標記 legacy
postState ＝ { exists: false, binding: null }                 ← 測試已移除
            | { exists: true,  binding: binding }             ← **不允許 null**

preChangeBinding  ＝ preState.binding
postChangeBinding ＝ postState.binding

INV-B1：postChangeBinding == null  ⇔  post-state 測試不存在
INV-B2：post-state 測試存在 ⇒ binding 必為 clause binding 或 EXPL
```

**非對稱是刻意的**：`preState` 允許「存在且未標記」（brownfield legacy 合法）；`postState` 不允許 —— 一個落入 gate scope 的測試在變更後必須有綁定。連帶後果：**修改一個未標記的 legacy 測試會強制為它補上綁定**（既有 ratchet，非本版新增）。

| 相 | 課予的條件 | 用途 |
|---|---|---|
| **preChangeBinding** | clause 與 Source **可解析** ∧ immutable snapshot integrity（Check A）成立。**不要求** active／mechanicallyApplicable／Source live-current／exception 未過期 | scope closure、語義審查輸入 |
| **postChangeBinding**（非 null 且非 EXPL） | clause `active ∧ mechanicallyApplicable`（per-kind §2）∧ Source 檢查（Check A/B）∧ exception chain 有效（owner 相符、未過期） | 現時效力 |
| **postState.exists == false**（測試已移除） | **無 post 驗證**；「tag 必須存在」不適用。判定依 `exists`，**不得**由 `binding == null` 反推（INV-B1／B2） | — |
| **postChangeBinding == EXPL** | 不做 clause／Source resolution | — |

**理由**：前態是歷史事實，合法修復正是「從失效的綁定移走」。若對前態課現時效力，模型會反過來擋掉它應該鼓勵的修復。

**State matrix（合法性判定）**：

| preChangeBinding | postChangeBinding | 判定 |
|---|---|---|
| inactive／superseded clause | active successor clause | **通過** —— 前態只驗可解析＋snapshot；後態驗全套 |
| inactive clause | `EXPL` | **通過** —— 後態不做 clause resolution |
| 失效 clause（stale tagged test 移除） | `null` | **通過** —— 無 post 驗證 |
| `null`（未標記 legacy 移除） | `null` | **通過** —— pre 為 null 是合法狀態 |
| clause A | clause B（同時移動位置） | 前態驗 A、後態驗 B，兩相獨立 |
| 已過期 exception-backed REQ | 替換的 clause 或 `null` | **通過** —— 過期只擋後態，不擋前態 |
| 任意 | active 但 **Source drift** 的 clause | **fail-closed**（後態課責） |
| clause A | **測試仍存在但綁定被移除** | **fail-closed** —— `postState.exists == true` 時 binding 不得為 null（INV-B2）；不得被誤讀成「已移除」 |
| clause A | clause A（**僅位置移動**） | **通過** —— identity 維持，前後同綁定 |

### 檢查分層

| 層 | 內容 | 失敗行為 | 範圍 |
|---|---|---|---|
| 結構（**postChangeBinding**） | binding 非 null 且非 EXPL 時：tag 存在、ID 可解析、clause **active ∧ mechanicallyApplicable**（per-kind，§2）；exception-backed 另驗 `scopeRulingRef` 可解析 ∧ `record.by == {discipline: intent}` ∧ **`record.subjectRef == current DP`**（否則 retag 至後繼或重新裁決）。binding 為 `null`（測試已移除）→ 本列不適用；`EXPL` → 不做 clause resolution | fail-closed | gate scope |
| 結構（**preChangeBinding**） | 僅驗 clause／Source **可解析** ＋ snapshot integrity（Check A）。**不課** active／applicable／live-current／未過期 —— 前態是歷史事實，合法修復正是從失效綁定移走 | fail-closed（僅可解析性） | gate scope |
| 結構（Transition） | 對每筆本次新增 Transition 驗 §2 合法性表的 `subject × action × successor × authority` **全矩陣**，含 **witness binding**（§2：ackRef payload 與 authorityRef principal／subject 的綁定 —— review-ruling.by 與 subjectRef、user-answer.subjectRef == 該 DP、plan-gate target 與三欄一致 §7、constraint-revocation 與 ownerRef 相等）、ASSUM 的 governedBy／domain-transfer 治理；ackRef 依 External-record contract 解析 | fail-closed | gate scope |
| 來源 | Source 存在、Check A（一律）；**Check B 與 exception 現時效力只課於 postChangeBinding 所引用者**：`contentKind=exception-grant` 完整鏈 —— resolve targetConstraintRef → target 必須是 `authority=hard-constraint` 的 REQ → `grantAuthorityRef == target.ownerRef` → 未過期，任一失敗 fail-closed。preChangeBinding 所引用的 Source 只課 Check A | fail-closed | gate scope |
| DP 完整性 | 對 gate scope 內每個 DP（含 INV-4 影響閉包）：terminal refs 三者互斥、status 與 terminal ref 型別一致（resolved↔REQ、decided↔DEC、assumed↔ASSUM）、terminal ref 指向 active ∧ applicable clause、有 applicable successor 時已全部 repoint、無 applicable successor 時已全部 reopen | fail-closed | gate scope |
| 語義 | assertion 是否被 clause 蘊含、是否超出 tag 範圍 | test discipline 判斷 | 全部 |
| Legacy | gate scope 以外的既有測試／條款 | 允許全量語義觀測；findings **observe-only**，不阻擋本次 run | scope 外 |

**v1.7 驗收案例**（gate 契約層）：① inactive clause → active successor：通過；② inactive clause → `EXPL`：通過；③ 移除引用失效 clause 的 stale tagged test：通過；④ 移除未標記 legacy test（`preState = {exists:true, binding:null}`）：通過；⑤ move ＋ 改綁：前後兩相各自驗證；⑥ 過期 exception-backed REQ → 替換或移除：通過；⑦ 後態 clause 有 Source drift：fail-closed；⑧ **move-only**（綁定 A→A、僅位置變動）：identity 維持，通過；⑨ **過期 exception 的 DP 收斂**：有 applicable successor → 所有受影響 DP repoint；無 → reopen（INV-4 影響閉包）；⑩ **malformed／dangling 原始 tag**（語法不合法、或 ID 解析不到任何 clause）：**在映射為 binding 之前** fail-closed —— 不得先當成 `binding == null` 再走 existence 分支，那會把語法錯誤誤讀成「測試不存在」。

**Assurance boundary（明文）**：機械檢查止於 presence／resolution／digest／status／mechanicallyApplicable／ref 一致性比對。**scopeCovers 是 intent discipline 的語義判斷**（機械層驗 ruling 存在、intent principal、及 `record.subjectRef == current DP`；不判斷 scopeCovers 的語義真實性）；語義蘊含由 test discipline 審；ownerRef 匹配驗的是模型內 ref 相等，**不驗現實身分**（non-adversarial 邊界，同 demo1 receipt 的定位）。presence 級檢查不得宣稱為完整 provenance 保證（failure memory：presence-only check 曾被當 coverage 讀）。

## 10. 觀測（非 gate）

- DP 計數（layer × status × discoveredAt × reopenedBy）進 run ledger：觀測值，永不當 gate —— 數字上升可能代表偵測變好。append 為流程副作用，不綁報告格式 sentinel（failure memory：run-ledger append 曾被 format-gated 餓死）。
- `intent-scan: no-applicable-dimension` 是合法結束狀態，**不得推出 task trivial**；implementation risk 由 Risk Matrix 獨立判定。
- discoveredAt 分布餵 capture-recapture 稽核（獨立 blind reader、Chao1 估計母體）的校準。

## 11. 邊界

- 不削弱 `verification-gate.md`：REQ（kind=acceptance）照規定紅→綠。
- brownfield：gate scope 如 §9 單值定義；scope 外 observe-only。
- reviewer 路由以 principal 表述：ASSUM → 其 `governedBy`；DEC → 其 `approvedBy`（arbiter-owned outcome 路由到 arbiter）；與既有 repair-loop rerun 規則一致。§9 的語義蘊含檢查恆屬 test discipline —— 「治理假設內容」與「審測試蘊含」是兩個不同職責。下游 spec 映射 principal → 具體 agent。
- 下游分工：**intent-scan spec**（觸發條件、七維度流程、Ask 批次、plan gate 接線）；**test-provenance spec**（tag 語法、contract-check 三層檢查、test discipline prompt、ledger 接線）。
