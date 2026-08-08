# Shared Decision & Provenance Model（共同決策與溯源模型）

- 狀態：**draft v1.12 — 修訂待 panel**（前一放行版本：approved v1.11）。v1.12 一處：§2 DP 新增 **`reopenCauseRef`**（TransitionRef | null）作為 reopen 成因的 **persisted causal witness**，並在 §9 新增 `Reopen cause coherence` 一列；同時於 typed refs 區正式定義可重用的 **TransitionRef** exact shape，並寫明 **legacy absence 的 upgrade boundary**（採 normalize-absent-to-null，附「不存在 durable pre-v1.12 source-2 state」的證據與適用範圍）。下游 IS v1.7 曾以 `status=open ∧ prior 有 effective Transition ∧ successor != null` 從 snapshot **反推**來源 2 的成因；該推斷不成立，且擋掉兩條合法收斂（明示 `reopen-dp` 後 prior 日後才被 supersede；兩個 DP 對同一 prior deferred reopen）。成因是歷史事實，只能讀持久化 witness，不得由 current graph 形狀反推。v1.11 內容不變：實作以本文為準；變更需重新過 panel。v1.11 關閉兩個**型別缺口** —— 下游已被要求驗證的東西，上游 schema 卻無法表示（下游不得自行補欄位，故一律回上游）：(1) `Transition.compatibility` 原限定 `僅 subject=REQ ∧ action=supersede`，但 matrix 早已允許 `ASSUM|DEC supersede → REQ` 走 kind=user，該路徑的 impact／disposition **無處存放**；適用條件改綁 **successor**（`action=supersede ∧ successor 為 REQ`），相容性義務來自「一條 REQ 開始生效」而非「被取代的是不是 REQ」。(2) plan-gate payload 無 `successor`，故一筆核准「取代 ASSUM-x」的 record 可授權換成**任何** REQ；新增 typed `successor: ClauseRef | null` 並定義必填條件，§7 proposal 的 target 放寬為 clause ref、新增具名 successor，witness binding 與 §9 機械比對由三欄擴為**四欄**。v1.10 一處：§9 檢查分層新增 **`Carrier coherence`** 一列 —— v1.9 把 carrier 宣告為 loader／final-snapshot invariant，但 §9 的 `DP 完整性` 只驗 terminal／status／successor，該 invariant 從未進入正式 gate contract，繞過交易入口構造的不一致狀態不會被擋。v1.9 修 v1.8 草案自身的三個缺口：carrier 與 `status` 的關係改寫為精確蘊含（「同生同滅」是錯的 —— row 1 direct citation 允許 `resolvedBy` 非空而 carrier 為 null）；`unrelated re-adopt` 收窄為 **binding-policy 驅動**，direct citation 改為清除並保持 null；`packetBasisRef` 補上完整 **total-order tuple**（原本無 `digest` tie-break，同 `sourceId` 不同 `digest` 的兩筆無法定序）。v1.8 變更四處，皆為下游實作暴露的 carrier／契約缺口：§2 `ASSUM` 新增三值 `routingOrigin`（authored、immutable，附 loader-level 全生命週期 invariant）；§2 `DP` 新增 `resolutionRulingRef` **current application carrier**（取代對歷史 binding-policy ruling 的全稱量化 —— 那條規則會永久凍結 `resolvedBy` 並牴觸「歷史 ruling 只驗 snapshot 自洽」）；§2 補上 `ObservationalRef` 與 Governance Packet `basisRefs` 的 **exact discriminated union**；§4 `materialReasons` 補 closed member set 並宣告本文為定序的**唯一** authoritative 定義。草案審閱期間，本版新增契約不得由下游實作；該限制已隨 v1.11 核准解除。
- 前一版狀態：**approved v1.7**（2026-07-26 panel 放行；前一放行版本 approved v1.6）。v1.7 變更：§9 gate scope 改為具名 closed set（含 body／oracle 變更）＋ `lifecycleAffectedClauses` 反向閉包；綁定拆 **pre-change／post-change 兩相**；§9 新增 **base provenance witness**（inline、storePath 固定、immutable）；§2 新增 **TaskState**（tracked canonical task membership 與 committed head）與 `provenance-batch` RecordRef kind（canonical `batchDigest` total order、derived `relatedRefs`、chain 連結約束、committed head 三分）；review-ruling／plan-gate 新增 `resolutionGroupDigest` 作為 witness coverage 的 carrier。本文件為 intent-scan 與 test-provenance 兩份 implementation spec 的共同上游；下游 spec 不得重新定義本文概念，可附加實作欄位但不得改變本文欄位語義。
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
routingOrigin: safe-default | user-deferred | reviewed-provisional
             ← **authored at creation、immutable 的控制狀態**（v1.8 新增）
```

**為何需要 `routingOrigin`（v1.8）** —— row 5／6／7 產出的 ASSUM 在持久狀態上完全同形，機械層因此無法區分「合法地沒有 ruling」與「該有 ruling 卻沒有」。DEC 沒有這個歧義（只由 row 7 產生），故可強制其 witness；ASSUM 不能，缺口因而無法關閉。**不得**從 `basisRefs` 或 `governedBy` 反推 —— 前者是證據欄、後者是權威欄，兩者都不是 routing 的控制狀態。

**這些是 loader／final-snapshot invariant，不是 constructor 說明** —— 每次載入都必須成立，否則一個繞過交易入口寫進去的 ASSUM 就永遠不會被複驗：

| routingOrigin | 只允許來自 | `layer` | `governedBy` | `basisRefs` |
|---|---|---|---|---|
| `safe-default` | §5 row 5（safeToAssume） | `intent` 或 `implementation` 皆可 | 依固定映射：intent→`{discipline:intent}`；implementation→`{discipline:code}` | **不要求** review ruling |
| `user-deferred` | §5 row 6 使用者明示延後 | **必須 `intent`**（row 6 前提即 layer=intent） | **必須** `{kind: discipline, discipline: intent}` | **必含**綁定同一 DP（`subjectRef == ASSUM.derivedFrom`）的 `user-answer` RecordRef |
| `reviewed-provisional` | §5 row 7「證據不足、僅核准暫定預設」 | **必須 `implementation`**（row 7 前提即 layer=implementation） | **必須等於**該 ruling 的 `by` | **必含** `rulingKind=approved-provisional` 且綁定同一 DP 的 review-ruling |

任一條不成立 → fail-closed。三值互斥且窮盡：ASSUM 只由 row 5／6／7 產生。

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
compatibility:（**`action=supersede ∧ successor 為 REQ`** 時必填；其餘一律不得出現）
            impact 陳述 ＋ disposition（§7）
            ← 適用條件綁 **successor**，不綁 subject（v1.11）：downstream 相容性義務
              來自「一條 REQ 開始生效」，而不是「被取代的是不是 REQ」。原本寫
              `僅 subject=REQ` 使 matrix 已允許的 `ASSUM|DEC supersede → REQ`
              無處存放 impact／disposition，該路徑因此在型別層不可表示
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
                          target == subject；
                          supersede 另含 §7 **四欄**一致（v1.11 由三欄擴充）：
                            plan-gate.target      == Transition.subject
                            plan-gate.successor   == Transition.successor
                            plan-gate.impact      == Transition.compatibility.impact
                            plan-gate.disposition == Transition.compatibility.disposition
                          —— 少了 successor 對位時，一筆核准「取代 ASSUM-x」的 record
                          可授權把 ASSUM-x 換成**任何** REQ；
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
        constraint-revocation | exception-grant | provenance-batch
  ref:  stable record id（R-n；kind=exception-grant 例外 —— 解析到 Source namespace 的 S-n）
```

- **Namespace 與 lookup 邊界**：R-n 與 S-n／REQ-n／DEC-n／ASSUM-n／DP-n／T-n 同屬本 repo 的 provenance store；解析只在 store 內進行。repo 外的 URL／文件不是可解析 ref —— 需先固化為 Source。實體儲存與 id 鑄造由下游 spec 定，**payload 要求不得更動**。
- **Immutability**：record 一經建立即 immutable；更正＝新 record，既有 ref 不改指。
- **「可解析」成功條件**：record 存在於 store ∧ kind 與期待相符 ∧ minimum payload 齊備。
- **Minimum payloads**（全部隱含 immutable）：

```
source-authority:      recordId, authorityIdentity（constraint 擁有者身分，固化描述）
user-answer:           recordId, subjectRef（DP-n）, answer
review-ruling:         recordId, by: ReviewerPrincipal, subjectRef（DP-n | clause ref）, ruling,
                       resolutionGroupDigest?（見下 —— 作為 resolution group 的治理 witness 時必填）
plan-gate:             recordId, target, impact, disposition, approvedBy（user）,
                       **successor**: ClauseRef | null（v1.11 —— 見下必填條件）,
                       resolutionGroupDigest?（同上）

  `plan-gate.successor` 的必填條件（typed，非自由欄）:
    授權的是 clause transition ∧ action=supersede
      → **必填**，且必須是 clause ref；為 null 即該 record 不構成 supersede proposal
    授權的是 retire（successor 依定義不存在）
      → **必須**為 null
    非 clause transition 的 plan gate（例如純 routing 揭露）
      → **必須**為 null
  舊 record 只有 target／impact／disposition 三欄，無法區分「核准 target 被取代」
  與「核准 target 被某一條**具名** clause 取代」—— 下游因此無從機械驗證
  successor 對位，只能自行發明欄位。本欄關閉該缺口
constraint-revocation: recordId, targetConstraintRef, authorityRef（source-authority，
                       匹配 ownerRef）, effectiveAt
exception-grant:       ＝ Source（contentKind=exception-grant；payload 見 Source schema）
provenance-batch:      recordId, taskId, inventoryDigest,
                       batchSnapshot（完整內容，非僅 digest —— scratch 遺失時須可由 tracked 重建）,
                       batchDigest（定義見下）,
                       relatedRefs[]（typed；見下）,
                       previousBatchRef: RecordRef(provenance-batch) | null（chain）
```

**`batchDigest` canonicalization**（不得留給實作猜測）：

```
batchDigest ＝ sha256(canonicalJson(batchSnapshot))

canonicalJson 沿用本文既有規則（UTF-8 無 BOM、LF、object key 依 code point 排序、
無多餘空白、字串不 trim），另加下列 array 定序（**必須是 total order**）：
  batchSnapshot.results   依 canonical testRef ＝ (path, adapterId, structuralId) 三元組，
                          逐欄 Unicode code point 序
  每筆 result 的 findings 依 (closed kind order, binding, 完整 canonical finding bytes)：
                          binding **缺席者排在所有具 binding 者之前**（null-first）；
                          同 kind 同 binding 時以完整 canonical finding bytes 作最後 tie-break
  relatedRefs             typed ref（{kind, ref}），依 (kind, ref) 排序並**去重**
```

**Batch chain 與 committed head**（scratch 全失後的單一可信依據）：

```
task 尚無 provenance-batch：
  committedHead ＝ null ∧ TaskState.committedProvenanceBatchRef ＝ null   → **合法**

task 已有 provenance-batch：
  必須**恰有一個**未被任何 previousBatchRef 引用的 tip
  ∧ TaskState.committedProvenanceBatchRef == 該 tip
  零個 tip（chain 斷裂）或多個 tip（reconciliation required）→ fail-closed

scratch 只快取 head 的 ref；遺失後可由 tracked chain 完整重建
消費者一律使用**明確的 `provenanceBatchRef`**，不得以 (taskId, inventoryDigest, batchDigest)
模糊搜尋「對應 record」
```

「零個 head 一律 fail-closed」是舊條文，與下方 TaskState 的三態互相否定 —— 未提交過的 task 本來就沒有 tip。以本節為準。

**Chain 連結約束**（否則 `previousBatchRef` 可指向他 task 的 batch，或自己 task 的歷史非 head batch，使 stale 的 explicit ref 仍能通過自身 digest 驗證）：

```
首筆 batch： previousBatchRef == null
後續 batch： previousBatchRef == **pre-state 的 TaskState.committedProvenanceBatchRef**
           ∧ referencedBatch.taskId == current taskId
checker：   provenanceBatchRef == TaskState.committedProvenanceBatchRef
           ∧ provenanceBatchRef == 推導出的唯一 tip
```

**`relatedRefs[]` 是精確的 derived set**（非自由欄位）：

```
relatedRefs ＝ 本交易 recordsToCreate 的全部 ref
             ∪ resolutions 中出現的全部 ref（semanticEvidenceRefs、governanceWitnessRef）
             ∪ 本交易建立的 Transition refs
依 (kind, ref) 排序並去重；與上述集合不符 → fail-closed
```

- **TransitionRef（exact shape，v1.12）**：指向本 store 內一筆 **immutable Transition** 的 typed ref。`reopenCauseRef` 與**所有後續 consumer** 一律引用本定義，**不得各自重述**：

```
TransitionRef ＝ { kind: "transition", ref: <Transition id> }

規則（全部 fail-closed）：
  kind 必須**精確**為 "transition"（其他 kind 即使 id 存在也不解析）
  ref 必須是**非空**字串，且是 store-local 的合法 Transition id
  **不允許 undeclared keys**（key set 必須恰為 {kind, ref}）
  必須解析到一筆**存在且 immutable** 的 Transition
  malformed／wrong kind／dangling → 各自 fail-closed
```

- **ObservationalRef（exact shape，v1.8）**：對觀察性證據（code path、caller、資料現況）的描述性指標 —— **明文不解析**，disclosure-only；不屬 RecordRef，不參與機械 resolution。先前只有這句散文而無 schema，下游因此無從驗證其形狀：

```
ObservationalRef ＝ { kind: "observational", description: string }
                    description 非空；**不允許 undeclared keys**
```

- **Governance Packet 的 `basisRefs` normalization（exact discriminated union，v1.8）** —— 這是 **packet** 的正規化表示，與 `clause.basisRefs` 的既有寬鬆表示**不是同一個東西**，不得混用：

```
packetBasisRef ＝
  | { sourceId: string, digest: string }                    ← Source snapshot ref
  | { kind: <RecordRef kind>, ref: string }                 ← RecordRef，沿用其 exact shape
  | { kind: "observational", description: string }          ← ObservationalRef

規則（全部 fail-closed）：
  **不允許 undeclared keys**（三個變體各自的 key set 必須完全相等）
  必填字串**不得為空**
  canonical bytes 相同的 ref **不得重複** —— 先做這一步，再排序
```

**排序：完整 tuple，必須是 total order。**先前只寫「variant 判別鍵 ＋ id／description」，對 `{sourceId:"S-1", digest:"aaa"}` 與 `{sourceId:"S-1", digest:"bbb"}` 這兩筆合法且相異的 ref 不能定序，兩個 writer 仍會輸出不同順序：

```
source        → [0, sourceId, digest]
record        → [1, kind, ref]
observational → [2, description]

先比 tuple[0]（數值）；其後每個字串欄位依 Unicode code point 序逐一比較。
變體判別鍵在前，因此三類永不交錯。**下游 spec 只引用本定義，不得另寫第二套排序。**
```
- **`resolutionGroupDigest`（witness coverage 的 carrier）** —— 「一個 witness 必須涵蓋某組 evidence 的全部」若沒有欄位承載，就無法機械驗證：

```
resolutionGroupDigest ＝ sha256(canonicalJson({
  subjectRef, action, successor, sortedSemanticEvidenceRefs
}))

sortedSemanticEvidenceRefs ＝ 依 **RecordRef.kind，再依 ref**，以 Unicode code point 序
                             排序並**去重** —— 未定義排序則同一組 refs 的不同輸入順序
                             會算出不同 digest，coverage 檢查形同虛設
```

  作為 resolution group 治理 witness 的 review-ruling／plan-gate record **必須攜帶相同 digest**；checker 驗**完全相等** —— 少一筆 sibling evidence 即 digest 不同即 fail。本模型採此方案；**不得**同時再宣稱「由 batch 的 resolution envelope 承擔對位」，兩種擇一，不可混寫。
- **Non-adversarial boundary**：checker 證明 record 存在、型別正確、ref 相等，不證明現實身分。

### TaskState（**tracked canonical state**，非 scratch）

task membership 與 committed head 是**權威狀態**，不能只存在於 per-run scratch：`resume-task` 需要它、exception-backed DP 驗證需要它、沿用的 DP 不改原 `taskRef` 因此無法從 tracked 物件反推 —— scratch 遺失後 batch 可重建，**task membership 卻不能**。

```
TaskState:
  taskId
  baseProvenance                                   ← immutable（見 §9 witness）
  currentTaskDpIds[]
  committedProvenanceBatchRef: RecordRef(provenance-batch) | null
```

操作規則：

```
init-task    建立 TaskState（含 baseProvenance）
resume-task  **只能新增** membership；**不得改動 baseProvenance**（改換 base 一律拒絕）
commit-test-provenance-batch
             原子更新 committedProvenanceBatchRef
post-commit consumer（checker／arbiter）
             只讀 TaskState 指向的 committed batch；scratch 僅為 proposal／cache，
             **不得成為第二個 truth source**
```

**Store carrier** —— TaskState 必須有可序列化的位置，否則 fresh clone 無處讀取：

```
canonical store ＝ { provenanceVersion, sources, clauses, transitions,
                    records, decisionPoints, **taskStates** }

taskStates      ＝ 陣列，依 taskId 之 Unicode code point 序排序；taskId **唯一**
                  （重複 taskId → fail-closed）
loader／CAS／init-task／resume-task／commit-test-provenance-batch
                  一律讀寫**同一位置**，不另設副本
```

**Head 狀態封閉**（三分，無其他合法組合）：

```
零 batch ∧ committedRef == null                    → 尚未提交，合法重跑
已有 batch ∧ 唯一 tip == committedRef              → valid
已有 batch ∧（零 tip ∨ 多 tip ∨ ref != tip）        → fail-closed
```

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
reopenCauseRef:      **TransitionRef**（exact shape 見上 typed refs 區）| null
                     ← **persisted causal witness**（v1.12 新增）。只在「本次 dependent
                       closure 因 successor 對本 DP 不 applicable 而 reopen」時由 writer
                       設定，指向造成該 reopen 的 Transition；其餘一切 reopen 成因為 null。
status:              open | asked | resolved | decided | assumed
resolvedBy:          REQ-n（status=resolved 必填，INV-2）
decidedBy:           DEC-n（status=decided 必填，INV-2）
assumedAs:           ASSUM-n（status=assumed 必填，INV-1）
scopeRulingRef:      RecordRef(kind=review-ruling)
                     ∧ record.by == {kind: discipline, discipline: intent}
                     ∧ record.subjectRef == 本 DP（他 DP 的合法 intent ruling 不可借用）
                     （resolvedBy 為 exception-backed REQ 時必填 —— scopeCovers 的可追溯憑據）
resolutionRulingRef: RecordRef(kind=review-ruling) | null   ← **current application carrier**（v1.8）
                     指向「授權本 DP **當前** resolution 的那一筆 ruling」，唯一且 typed
```

**為何需要 `resolutionRulingRef`（v1.8）** —— 沒有 current carrier 時，唯一能表達「這筆 binding-policy ruling 說了算」的方式是對**所有** `subjectRef` 指向該 DP 的 binding-policy ruling 做全稱量化，要求 `DP.resolvedBy == ruling.bindingClauseRef` 恆成立。那條規則會把 `resolvedBy` **永久凍結**：一旦 REQ-a 經合法 binding-policy 被採用，之後任何合法的 `REQ-a → REQ-b` supersede 都會與那筆**歷史** ruling 衝突而被拒。它同時牴觸 §9／IS §4 的既定契約 —— 不再被 current ref 引用的歷史 ruling **只驗 immutable snapshot／digest 自洽，不得與 mutable current DP 比較**。全稱量化因此撤回；current carrier 取而代之。

**生命週期（closed）**：

```
initial adopt（由 binding-policy ruling 驅動）
  → 同一交易原子設定 resolutionRulingRef

loader postcondition —— **只**對 current carrier 套用：
  carrier.rulingKind == binding-policy
  ∧ carrier.subjectRef == 本 DP
  ∧ carrier.bindingClauseRef 經**有效 Transition successor chain** 解析後 == DP.resolvedBy
    （直接相等是 chain 長度為 0 的特例，因此合法 supersede 後 carrier 可沿用）

合法 supersede／repoint —— 二擇一，交易必須明示走哪一支：
  (a) 沿用 carrier：上式的 successor-chain 條件必須成立
  (b) 同交易原子替換 carrier 為新的 binding-policy ruling

retire／reopen 且無 current resolution
  → 同交易清除 resolutionRulingRef（null）

unrelated re-adopt
  → **binding-policy 驅動**時：必須提供新的 current carrier，不得沿用舊 ruling
  → **direct row-1 citation**（無 policy ruling）時：清除舊 carrier 並保持 null

歷史 ruling（存在於 store 但不被任何 DP 的 resolutionRulingRef 引用）
  → **只**驗 immutable snapshot／digest 自洽；不與任何 current DP 比較
```

**Carrier 與 status 的精確關係**（「同生同滅」是錯的措辭 —— row 1 的 direct citation 允許 `resolvedBy` 非空而 carrier 為 null）：

```
resolutionRulingRef != null  ⇒  status == resolved ∧ resolvedBy 存在
status != resolved           ⇒  resolutionRulingRef == null
status == resolved ∧ direct citation（無 binding-policy ruling 驅動）
                             ⇒  resolutionRulingRef **可以**為 null，本節不課條件
```

### `reopenCauseRef` —— reopen 成因的持久化 witness（v1.12）

**為何需要它** —— 「這次 reopen 是由某筆 Transition 的 dependent closure 造成的」是**歷史因果**，不是 final snapshot 的結構屬性。下游曾嘗試從 snapshot 反推：`status=open ∧ priorTerminalRef 有 effective Transition ∧ successor != null`。該推斷不成立，且會**擋掉合法收斂**：

```
反例 1  DP 先以 reopen-dp(trigger=new-dependent) 明示重入；
        prior clause 日後才被合法 supersede → 該 DP 被誤判為 source-2 reopen。
反例 2  兩個 DP 對同一 prior 各自 deferred reopen；其一以 reopened-prior 建立
        Transition 後，另一個尚待 adopt-existing-outcome 收斂的 DP 被誤判。
```

兩者的共同點：舊 reopen 發生時 prior 還沒有 successor，snapshot 事後無法分辨兩種歷史。因此**因果必須被持久化**，不得由圖形反推。

**Closed lifecycle**：

```
設定  只由 writer 在 dependent closure 因 successor 對本 DP 不 applicable 而 reopen 時寫入，
      且必須指向**本次交易**的該筆 Transition。caller 不得提供。
禁止  明示 reopen-dp、retire 造成的 reopen，以及任何其他 reopen 成因 → 必須為 null。
清除  DP 被 repoint、resolve（任一 terminal 落定），或因**其他**成因再次 reopen → 清為 null。
替換  再次發生 source-2 reopen → 換成新的 TransitionRef。
```

**Loader／gate invariant —— 只對 `reopenCauseRef != null` 的 DP 執行**：

```
ref 可解析為 Transition T
∧ T.subject == DP.priorTerminalRef
∧ T.successor != null
∧ applicable(T.successor, DP) == false      ← 現時重新求值
∧ DP.reopenedBy == 「terminal clause 失效且無後繼（INV-4）」的下游序列化
∧ DP.status == open ∧ 三個 terminal ref 皆 null ∧ resolutionRulingRef == null
```

**`reopenCauseRef == null` 的 DP 一律不被歸類為該情形**，且**不因 prior clause 日後取得 Transition 而被重新分類** —— 這正是上述兩個反例得以合法的原因。

**Ownership** —— `reopenCauseRef` 是 **writer-owned** 的 persisted causal witness，與 `resolutionRulingRef` 的 caller-declared 模型**不同**，兩者不共用命令面：

```
caller **不得**提供、覆寫，或以任何未宣告欄位影響 reopenCauseRef。
它沒有對應的 caller-facing action 詞彙（沒有 preserve／replace／clear 宣告），
writer 依 §2 lifecycle 自行設定、清除或替換；
loader／gate 由 §9 的 **Reopen cause coherence** 一列驗證 —— **不是** Carrier coherence，
後者只管 resolutionRulingRef。
```

**Legacy absence 與 upgrade boundary（v1.12）** —— 新增 persisted 欄位必須定義舊 snapshot 缺欄位時的行為，否則三種狀態會被壓成同一種：合法的非 source-2 reopen、舊實作產生但無 witness 的 source-2 reopen、以及新 writer 漏寫欄位的實作錯誤。本模型採 **normalize-absent-to-null**，並附證據：

```
主張    不存在任何 durable pre-v1.12 source-2 state。
證據    (1) 能產生該狀態的唯一程式路徑是 clear 來源 2，首次實作於 cressetide
            commit 6c743e7；
        (2) 該 commit 與其整條開發線**從未 push／釋出**，因此沒有任何 consumer
            能執行到它；
        (3) 本 repo 內不存在任何 tracked 或 on-disk 的 `.ctide/provenance.json`；
        (4) 規格在 v1.7 核准前明文禁止實作來源 2，核准與實作皆發生於同一日且未釋出。
適用範圍 僅限上述證據成立的情形。若日後有任何已釋出 writer 曾產生 source-2 state，
        本正規化即不適用，必須改走 migration／store-version 路徑：ambiguous open DP
        **不得**由 current graph 回填成因（那正是本版在修的錯誤），必須 fail-closed
        並重新 routing／固化，之後才轉為顯式 null 或有效 TransitionRef。
規則    pre-v1.12 snapshot 缺欄位 → 正規化為 null；
        **所有 v1.12 writer 一律顯式寫入 null 或 TransitionRef**，
        因此「缺欄位」在 v1.12 之後即為實作錯誤，而非 legacy。
```

`resolutionRulingRef`（**與本節無關的另一個 carrier**）的語義定義於上一節；承載它的**命令面**在 IS §8「carrier 更新契約」（逐 DP 的 `resolutionCarrierUpdates[]`），**執行它的檢查**在 §9 的 `Carrier coherence` 一列。三者缺一即失效：缺命令面則 preserve／replace／clear 無交易可執行；缺 §9 一列則該式只是散文，繞過交易入口直接構造的不一致狀態不會被擋。

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

materiality 是衍生值：`materialReasons[]` ＝ 失敗的 conjunct 清單；不另設獨立布林。**closed member set（v1.8 新增）** —— 先前只有散文描述四個 conjunct，沒有 machine-readable 值，下游因此無法在不自行發明內容的前提下驗證成員資格：

```
materialReasons[] ∈ {
  not-low-cost-reversible      （低成本可回復 失敗）
  protected-domain             （涉及金錢／權限／資料遺失／隱私／法規／安全／外部契約）
  hard-to-migrate-commitment   （形成難遷移的相容承諾）
  changes-core-product-promise （改變核心產品承諾）
}
去重，依 Unicode code point 序排序（否則同一組理由會算出不同 packet digest）
```

**本文是 `materialReasons` 定序的唯一 authoritative 定義。**下游 spec 不得另立版本 —— 兩處若各寫一套（例如一邊 code-point 序、一邊 enum 宣告序），兩個 writer 就會對同一組理由算出不同 digest，而 digest 正是用來證明兩者看到同一份 packet 的東西。「選擇與 alternative 明文記錄」「不偽裝成 REQ」是 Record 動作本身的義務，非路由條件。

## 5. 分流表（互斥、可到達、完備；逐 persisted DP 依序判定）

| # | 前提 | 路由 | 產物 |
|---|---|---|---|
| 1 | 有適用 active 且 **applicable** binding clause 且無衝突（含字面規則；exception-backed REQ 需 scopeCovers ruling，記入 DP.scopeRulingRef） | resolved | cite REQ-n |
| 2 | 衝突涉 hard-constraint，**且無涵蓋本 DP 的有效例外** | Ask「改需求／取得例外」（不給選邊） | 回答 → 新 REQ，或 exception-grant Source＋引用它的 REQ（此後同類 DP 於 scope 內走 row 1） |
| 3 | requirement vs compatibility，**已有 plan-gate 核准的 supersede proposal**（§7：具名 target＋具名 successor＋impact＋disposition 完整） | 執行 supersede＋揭露 | 建立新 REQ＋supersede Transition（完成後即 effective supersede）；舊 clause 轉 superseded（derived） |
| 4 | 其他 clause 衝突（同層；或 proposal 不完整） | Ask | 回答 → proposal 核准／需求修訂 → 新 REQ |
| 5 | 未裁決 ∧ safeToAssume | assume | ASSUM（INV-1；governedBy 依 §2 固定映射；**`routingOrigin=safe-default`**；ephemeral candidate 見 §6） |
| 6 | 未裁決 ∧ ¬safeToAssume ∧ layer=intent | Ask | 回答 → 新 REQ；明示延後 → ASSUM（basisRefs 含該 DP 的 user-answer；**`routingOrigin=user-deferred`**） |
| 7 | 未裁決 ∧ ¬safeToAssume ∧ layer=implementation | 技術審查（依 domain 之 discipline 或 arbiter） | 四分，見下 |

row 7 審查結果四分：

```
找到既有 binding technical policy → resolved(REQ)   ← 政策固化為 Source，新 REQ cite 之
正式工程裁決                      → decided(DEC)
證據不足、僅核准暫定預設           → assumed(ASSUM，governedBy=審查 principal，
                                          **routingOrigin=reviewed-provisional**)
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
    具名 target: **clause ref**（REQ | DEC | ASSUM —— v1.11 放寬；
      matrix 早已允許 `DEC supersede → REQ` 與 `ASSUM supersede → REQ` 走 kind=user，
      原本寫死 `REQ-n` 使該兩列無合法 proposal 可用）
  ∧ 具名 successor: **REQ ref**（v1.11 新增，必填）
  ∧ 明示 compatibility impact
  ∧ 核准的 disposition ∈ {
      migration | version-boundary | deprecation-window |
      coordinated-cutover | no-affected-dependents |
      backward-compatible | accepted-breaking }
缺任一 → 不構成 proposal，回落 Ask（row 4）

effective supersede（post-state）＝ 依 proposal 執行的 Transition(action=supersede)，
    compatibility block 抄錄 proposal 內容
```

- **Proposal record 是 typed external interface**（不新增模型物件）：`ackRef(kind=plan-gate)` 指向的紀錄必須可解析出 **target／successor／impact／disposition 四欄**，且與 Transition 的 `subject`／`successor`／`compatibility` block **完全一致**（§9 機械比對）。只驗「存在」不足 —— 否則任何不相關的 plan-gate 核准都能被拿來當授權；只驗三欄亦不足 —— 核准「取代 ASSUM-x」的 record 會授權把它換成任何 REQ。

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

### Base provenance witness（前態的 typed 依據）

判斷「某物在本輪之前就已存在」不能靠敘述，必須有可解析的前態輸入：

```
baseProvenance:
  treeOid      ← **與 gate scope 測試變更集合所用的同一個 Git base tree**
                 （「Git base snapshot」與「task-start snapshot」不得混用為同義詞；
                  本文選定前者為 canonical basis）
  storePath    ← **固定為 runtime contract 的 canonical store path**（`.ctide/provenance.json`），
                 不由 caller 自填 —— 可任填等於讓 witness 指向任意檔案
  storeDigest  ← 該檔 canonical bytes 的 sha256
```

- checker **必須**自 `treeOid` 讀出 canonical provenance store、驗 `storeDigest` 相符後，才據以判斷任何「前態存在性」。
- 該路徑在 `treeOid` 中不存在時，採 **canonical empty store**：`{ provenanceVersion: 1, sources: [], clauses: [], transitions: [], records: [], decisionPoints: [], taskStates: [] }`，其 digest 亦依 canonical 規則計算。
- **witness 是 inline 值，不是 ref** —— 統一以 inline `baseProvenance` 傳遞；不引入 `baseProvenanceRef`（那需要另一個 record kind 承載，本版不新增）。
- **resume 同一 task 時不得改換 base** —— `treeOid` 隨 `TaskState.baseProvenance` 於 task 起始固定且 immutable；`resume-task` 嘗試改動即**拒絕**。
- 任何 batch 內攜帶的 witness **必須等於** tracked `TaskState.baseProvenance`；不等即 fail-closed。
- 下游的變更盤點必須攜帶 `baseTreeOid` 並納入其 digest envelope，checker 據以機械驗證 `baseProvenance.treeOid == 盤點所用的 Git base tree`。
- 缺 witness、witness 指向錯誤 tree／store、或 digest 不符 → **fail-closed**（不得退化為「當作不存在」或「當作存在」）。

**Gate scope（brownfield，單值化）**：

```
gate scope ＝ **provenanceRelevantTestChanges**（closed set）
             ＝ existence change            （新增／移除）
             ∪ binding change              （改綁，含改成／改自 EXPL）
             ∪ identity／location change   （改名／搬移）
             ∪ **declaration body change**  （tag 不變、斷言改了）
             ∪ **effective-oracle dependency change**
                                           （tag 與宣告本體皆不變，但 helper／fixture／
                                            snapshot／golden／外部 expected-data 改了）
             後兩者為 v1.7 補列 —— 若只寫「binding 有變動」，**最常見的改斷言**
             反而落到 scope 外 observe-only。此集合的機械導出方式由下游
             implementation spec 定義，本文不依賴其欄位名
           ∪ 這些測試的 **preChangeBinding 與 postChangeBinding** 所引用的 clause
             及其 sourceRef／basisRefs Source（含 Transition 推導的 status 與 applicable）
             —— 前態必須在 scope 內，否則「改綁即脫逃」
           ∪ 本次新增／修改的 clause／Source／Transition
           ∪ 所有 current terminal ref 指向本次 changed／transitioned／drifted／expired
             clause 的 DP（INV-4 影響閉包）
           ∪ **reverseClosure**（clause → test 反向閉包，seed 具名如下）

lifecycleAffectedClauses ＝ semanticallyChangedClauses   （本次內容語義變更者）
                         ∪ transitionedClauses          （本次有生效 Transition 者）
                         ∪ driftedClauses               （Check B drift）
                         ∪ expiredClauses               （exception 逾期）
reverseClosure ＝ 目前綁定指向 **lifecycleAffectedClauses** 的所有測試

**seed 必須具名，不得用「上述 clause」代稱** —— 後者會把「僅因某個變更測試的 pre／post
binding 而進 scope、但生命週期毫無變動」的 clause 也算進去，於是一次普通的改斷言就會
擴散成該 clause 全體 sibling 的 review。反向閉包只由生命週期事件觸發。
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
| **preChangeBinding ＝ clause binding** | clause 與 Source **可解析** ∧ immutable snapshot integrity（Check A）成立。**不要求** active／mechanicallyApplicable／Source live-current／exception 未過期 | scope closure、語義審查輸入 |
| **preChangeBinding ＝ null** | **不做** clause／Source resolution。僅在 `preState` 定義的兩種情形合法：測試本次新增（`exists:false`）、或既有未標記 legacy（`exists:true`） | 同上 |
| **preChangeBinding ＝ EXPL** | **不做** clause／Source resolution | 同上 |
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
| `null`（`exists:false`，**本次新增**） | clause 或 `EXPL` | **通過** —— 前態不做 resolution |
| `null`（`exists:true`，**未標記 legacy 被修改**） | clause 或 `EXPL` | **通過** —— 前態不做 resolution；後態必須有綁定（INV-B2 的 ratchet） |
| `EXPL` | clause 或 `EXPL` | **通過** —— 前態不做 resolution |

### 檢查分層

| 層 | 內容 | 失敗行為 | 範圍 |
|---|---|---|---|
| 結構（**postChangeBinding**） | binding 非 null 且非 EXPL 時：tag 存在、ID 可解析、clause **active ∧ mechanicallyApplicable**（per-kind，§2）；exception-backed 另驗 `scopeRulingRef` 可解析 ∧ `record.by == {discipline: intent}` ∧ **`record.subjectRef == current DP`**（否則 retag 至後繼或重新裁決）。binding 為 `null`（測試已移除）→ 本列不適用；`EXPL` → 不做 clause resolution | fail-closed | gate scope |
| 結構（**preChangeBinding**） | binding 為 **clause** 時：僅驗 clause／Source **可解析** ＋ snapshot integrity（Check A）；**不課** active／applicable／live-current／未過期 —— 前態是歷史事實，合法修復正是從失效綁定移走。binding 為 **null**（本次新增／未標記 legacy）或 **EXPL** 時：**不做 clause／Source resolution**，本列僅驗該前態符合 `preState` 型別 | fail-closed（僅可解析性／型別合法性） | gate scope |
| 結構（Transition） | 對每筆本次新增 Transition 驗 §2 合法性表的 `subject × action × successor × authority` **全矩陣**，含 **witness binding**（§2：ackRef payload 與 authorityRef principal／subject 的綁定 —— review-ruling.by 與 subjectRef、user-answer.subjectRef == 該 DP、plan-gate 與 §7 **四欄**一致（target／successor／impact／disposition）、constraint-revocation 與 ownerRef 相等）、ASSUM 的 governedBy／domain-transfer 治理；ackRef 依 External-record contract 解析 | fail-closed | gate scope |
| 來源 | Source 存在、Check A（一律）；**Check B 與 exception 現時效力只課於 postChangeBinding 所引用者**：`contentKind=exception-grant` 完整鏈 —— resolve targetConstraintRef → target 必須是 `authority=hard-constraint` 的 REQ → `grantAuthorityRef == target.ownerRef` → 未過期，任一失敗 fail-closed。preChangeBinding 所引用的 Source 只課 Check A | fail-closed | gate scope |
| DP 完整性 | 對 gate scope 內每個 DP（含 INV-4 影響閉包）：terminal refs 三者互斥、status 與 terminal ref 型別一致（resolved↔REQ、decided↔DEC、assumed↔ASSUM）、terminal ref 指向 active ∧ applicable clause、有 applicable successor 時已全部 repoint、無 applicable successor 時已全部 reopen | fail-closed | gate scope |
| **Carrier coherence**（§2 `resolutionRulingRef`） | 對同一組 DP：① `resolutionRulingRef != null` ⇒ `status == resolved` ∧ `resolvedBy` 存在；② `status != resolved` ⇒ `resolutionRulingRef == null`；③ carrier 非 null 時，該 record 必須 `rulingKind == binding-policy` ∧ `subjectRef == 本 DP` ∧ `activeSuccessorChainEnd(bindingClauseRef) == DP.resolvedBy`。**只對 current carrier 套用**；不再被任何 carrier 引用的歷史 ruling 依 §2 僅驗 snapshot／digest 自洽 | fail-closed | gate scope |
| **Reopen cause coherence**（§2 `reopenCauseRef`） | **只對 `reopenCauseRef != null` 的 DP 執行**：ref 可解析為 Transition T ∧ `T.subject == DP.priorTerminalRef` ∧ `T.successor != null` ∧ `applicable(T.successor, DP) == false`（現時重新求值）∧ `reopenedBy` 為「terminal clause 失效且無後繼」的下游序列化 ∧ `status == open` ∧ 三個 terminal ref 皆 null ∧ `resolutionRulingRef == null`。**`reopenCauseRef == null` 者不在本列範圍內**，且不得因 prior clause 日後取得 Transition 而被重新分類 —— 成因是歷史事實，只能讀持久化的 witness，不得由 current graph 形狀反推 | fail-closed | gate scope |
| 語義 | assertion 是否被 clause 蘊含、是否超出 tag 範圍 | test discipline 判斷 | 全部 |
| Legacy | gate scope 以外的既有測試／條款 | 允許全量語義觀測；findings **observe-only**，不阻擋本次 run | scope 外 |

**v1.7 驗收案例**（gate 契約層）：① inactive clause → active successor：通過；② inactive clause → `EXPL`：通過；③ 移除引用失效 clause 的 stale tagged test：通過；④ 移除未標記 legacy test（`preState = {exists:true, binding:null}`）：通過；⑤ move ＋ 改綁：前後兩相各自驗證；⑥ 過期 exception-backed REQ → 替換或移除：通過；⑦ 後態 clause 有 Source drift：fail-closed；⑧ **move-only**（綁定 A→A、僅位置變動）：identity 維持，通過；⑨ **過期 exception 的 DP 收斂**：有 applicable successor → 所有受影響 DP repoint；無 → reopen（INV-4 影響閉包）；⑩ **malformed／dangling 原始 tag**（語法不合法、或 ID 解析不到任何 clause）：**在映射為 binding 之前** fail-closed —— 不得先當成 `binding == null` 再走 existence 分支，那會把語法錯誤誤讀成「測試不存在」；⑪ **added test**（`exists:false, null` → `exists:true, clause|EXPL`）：通過，前態不做 resolution；⑫ **修改未標記 legacy**（`exists:true, null` → `exists:true, clause|EXPL`）：通過，且後態必須有綁定；⑬ **sibling 反向閉包**：兩測試同綁 `ASSUM-x`，只改其中一個並使 `ASSUM-x` 發生 Transition → 未被改動的 sibling 仍進 gate scope；⑭ **body-only 變更**：tag 不變、只改斷言 → 入 scope（不得因 binding 未變而落到 observe-only）；⑮ **oracle-only 變更**：tag 與宣告本體皆不變、只改 golden 或 helper → 入 scope；⑯ **clause 穩定時不擴散**：普通改斷言且其 clause 無生命週期事件 → **不**觸發 reverseClosure，sibling 不被拉入；⑰ **`EXPL` → deleted**：前態為 `EXPL` 的測試被移除 → 通過（前態不做 resolution，後態 `exists:false`）；⑱ **base witness 缺席／錯指／digest 不符** → 三者各自 fail-closed，不得退化為預設判斷；⑲ **canonical empty store**：`treeOid` 中無 store 檔 → 採空 store 且 digest 可驗，前態存在性一律為否；⑳ **head 規則**：**尚無 batch 時 head=null 且 TaskState ref=null 為合法**；已有 batch 時零個 tip 或兩個以上 tip → fail-closed；㉑ **base 不得暗換**：`resume-task` 嘗試改動 `TaskState.baseProvenance` → 拒絕；②② **TaskState 為權威**：刪除全部 scratch 後，`taskId`／`currentTaskDpIds`／committed head 仍可由 tracked TaskState 取得；②③ **chain 連結**：`previousBatchRef` 指向他 task 的 batch、或指向自己 task 的歷史非 head batch → 兩者各自 fail-closed；②④ **首筆 batch**：`previousBatchRef == null` 且 `committedRef` 由 null 原子更新為該 batch；②⑤ **witness coverage**：治理 witness 的 `resolutionGroupDigest` 與該 group 重算值不等（例如少一筆 sibling evidence）→ fail-closed；②⑥ **evidence ref permutation**：同一組 `semanticEvidenceRefs` 以不同輸入順序（或含重複）提交 → 排序去重後 `resolutionGroupDigest` **相同**；②⑦ **TaskState carrier**：fresh clone 自 `taskStates` 讀回 TaskState；重複 taskId → fail-closed。

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
