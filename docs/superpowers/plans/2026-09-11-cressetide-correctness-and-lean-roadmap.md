# Cressetide 正確性、流程完整性與減重整合計畫

日期：2026-09-11。修訂 2 狀態：**DOCUMENT COMPLETE。Claude 交叉審查提出的必要補正已由 Codex 納入並複查；roadmap 執行尚未開始。**

本計畫依使用者要求，先核對 repo 內既有規格、計畫與後續驗收，再以 2026-09-11 全 plugin 審查確認的修改項目安排工作。Codex 負責計畫、進度、分歧裁定與獨立驗證；真正的 Claude Code 使用 `claude-opus-5`、`xhigh`，負責提出意見與在範圍放行後修改程式。這份文件的撰寫不代表程式修正、合併或發布已完成。

## 1. 基準與本計畫的權限範圍

- 審查基準：main `95bd7bd6b47ca2b38126b1090a1f7a8e046f3a45`。
- 已發布版本：v0.7.2；tag 指向 `630779a628394e9d66ea07dc765caad1189c50b3`。
- 兩者的 plugin tree 相同：`8eba50b35904444ffea6a93e11a4bba0d1b86efe`，110 個出貨檔案、5 個 skill、11 個 agent、6 個 hook。
- 本次乾淨副本的選定回歸：377 tests、370 pass、7 skip、0 fail/cancel。另有隔離案例重現下列缺陷；不等於所有程式逐行驗證或實機相容性通過。
- 既有實機 smoke：Windows、Node 22.23.2、Claude Code 2.1.263、Opus 5／xhigh；涵蓋情境與缺口以 [EVIDENCE](../../../EVIDENCE.md) 及 [compatibility](../../compatibility.md) 為準。2026-09-11 查閱的官方 changelog 最新列為 2.1.268；實作時重新查核，記錄實際版本，不將「latest」當可重現識別。
- Type-B 真實專案紀錄仍為 0；未建立整體成效、成本節省或 GPT-6 Astra 執行效益證據。

本文件是**後續工作順序與進度的主要入口**。它不改寫舊規格的 normative authority、不追溯更動驗收結果、不重新啟動封存實驗。必要的契約變更須另寫明變更前後語意，經 Codex 與 Claude 討論後才實作；保留使用者既有授權，不對同一範圍重複索取確認。

**本次範圍修正**：依使用者「所有目前尚未修改的＋這次要修改的」要求，上一稿列於後續的已核准功能與未完成驗收，全部納入本 master roadmap。首批修正可先交付，但不再用它的完成代替整體完成。新構想則納入具名評估／決策工作，不因「整合」就自動決定開發或改預設。§6 定義三個不同里程碑，§7 是未結項總表。

## 2. 舊計畫盤點與處置

盤點以 Git 追蹤的 `docs/superpowers/specs/` 八份文件為主，對照公開的後續驗收、ADR、runtime／benchmark／compatibility 契約。`.ctide/collaboration/` 是維護者工作紀錄，最新 phase44 審查提供本次修正依據；舊臨時草稿與原始 transcript 不升格為現行計畫，也不開啟封存 benchmark 或 hidden grader。

| 文件／計畫 | 核對結果 | 本次處置 |
|---|---|---|
| [Shared decision provenance](../specs/2026-07-25-shared-decision-provenance-model.md)，effective v1.15 | 現行共同資料與 authority 規格；store／producer／consumer 等接受範圍由後續各 slice review 界定。規格核准本身不是全部產品流程驗收。 | C4 核對 §§1–11、invariants 與合法 producer／consumer；保留已接受部分，發現的未覆蓋義務納入相應 C／D 子項。 |
| [Intent-scan](../specs/2026-07-25-intent-scan-spec.md)，effective v1.10 | §8 store 交易等已有實作；§12 列出的 `intent-scan.md`、`governance-ruling.md` 在目前出貨樹中不存在，主要 carrier 尚未找到完整同義接線，`intentScan` ledger 欄位亦未找到。 | C3 納入**完整協定接線與驗收**，包括七維度、pre-gate、post-approval、store-derived contract、治理及 telemetry。載入／啟動策略另做明確契約決議；不能以成本疑慮默默取消已核准義務。 |
| [Test-provenance 主規格](../specs/2026-07-25-test-provenance-spec.md)＋四份 amendment，effective v1.21 | 主規格的早期檔名／`--provenance` 流程須與後來 D11 接線一起讀；不能只因舊清單檔名不存在就判定缺功能。 | 保留已接受的 component 與 D11 實作；C2 補 bootstrap、路徑、main-thread／arbiter 交接與復原，D 補普通實機流程證據。 |
| [E1 telemetry／ledger amendment](../specs/2026-09-06-test-provenance-telemetry-ledger-amendment.md)，v1.18 | 有 [E1 實作驗收](../reviews/2026-09-06-telemetry-ledger-codex-review.md)。文件當時的「D 尚未接受」已由較晚 controller／D11 驗收補上，不能當新待辦。 | 已接受的 bounded slice 不重做；C1 修改 run identity 時保留 TP 欄位來源與未知值語意。 |
| [File-preview amendment](../specs/2026-09-06-test-provenance-file-preview-amendment.md)，v1.19 | 有 [preview 實作驗收](../reviews/2026-09-06-file-preview-implementation-codex-review.md)。早期 review 的其他未結項須由後續 final acceptance 判讀。 | 保留 preview 的純讀取、原始 payload 與拒寫邊界。 |
| [Prospective-authority amendment](../specs/2026-09-06-test-provenance-prospective-authority-amendment.md)，v1.20 | 有 [prerequisite 實作驗收](../reviews/2026-09-06-prospective-authority-implementation-codex-review.md)。 | 保留 authority 與 caller 邊界；不因減重跳過它。 |
| [Review-loop amendment](../specs/2026-09-06-test-provenance-loop-amendment.md)，v1.21 | [controller](../reviews/2026-09-07-loop-controller-implementation-codex-review.md)、[D11 product integration](../reviews/2026-09-07-loop-product-integration-codex-review.md)、[actual-reviewer E2E](../reviews/2026-09-07-actual-test-reviewer-e2e-codex-review.md) 已有分別接受範圍。 | 既有 Windows component 路線已完成；本次發現是新的操作與 host 整合缺口，不撤銷過去的 bounded acceptance。 |
| [Efficiency roadmap](../specs/2026-09-08-cressetide-efficiency-roadmap.md) | [9/10 最終處置](../reviews/2026-09-10-efficiency-final-disposition.md)：調查 CLOSED；L0 partial、L1a 依 measurement-limit 分支結案、L1b bounded accepted、L2 terminal／inconclusive、L3 未執行、L4 局部不採用決定 final、整體效益決定未執行。 | 舊兩個候選不採用、原預設保留。E 是另立新 protocol 的工作，不把 L3／整體 L4 補標通過，不重跑舊封存案例。 |

補充狀態：

- [9/7 final candidate](../reviews/2026-09-07-final-candidate-codex-review.md) 完成的是當時指定的 Windows 程式修改 roadmap，不是每份較廣規格、所有 host conformance 或效益研究皆完成。
- 早期未有 Linux 的狀態，不能覆蓋後來 release 的三 OS 自動測試結果；反過來，三 OS unit tests 也不能代替原生 plugin 流程與各 acceptance criterion 的實機證據。**TP AC43／AC59 仍需成對驗收**：同一 repo 在 Windows／Linux 分別產生相同 bodyDigest、testRef 與 inventoryDigest。D5 補齊，不以 CI 綠燈直接關閉；D6 另負責獨立 writer，兩者不能互相替代。
- [9/11 release recovery](../reviews/2026-09-11-release-recovery-review.md) 明確是發布前快照。後續 v0.7.1、v0.7.2 已發布的結果看 EVIDENCE；不將舊 pending release gate 再列為待發布工作。
- [vendored parser ADR](../../adr/2026-08-09-vigil-vendored-parser-ignore-capability.md) 是能力／來源決策，不是本次要重啟的依賴安裝計畫。
- 本次又確認：D11 review 已記錄先前對 agent-body `${CLAUDE_PLUGIN_ROOT}` 的支持判斷。A／C 的檢查是**既有支持判斷的首次明確實機觀察**，不是宣稱先前判斷從未存在或所有相對引用必定失效。

## 3. 當前修改清單與事實基礎

P1 優先處理會使結案控制失去預期作用的問題；P2 是已確認的正確性／診斷問題；P3 是契約說明與流程品質。以下重現是維護者在基準 tree 的隔離檢查，不是已觀察到使用者專案出貨事故。

| ID | 優先度／證據 | 現況、影響 | 對應工作 |
|---|---|---|---|
| R1 | P1；source＋合成 transcript | `orchestration-check.js:236` 只認 Task。相同 NOT READY＋shipped，Task 會 block，Agent 只報未見 panel；Agent＋READY 亦誤報。原生各種完成格式尚待捕捉。 | A1、B1 |
| R2 | P2；既有 published host observation | Doctor 讓模型組合 probe shell，引號使外層 Bash 觸發 ask，headless probe 未執行。當時正確回報 incomplete。 | B3 |
| R3 | P2；source conflict | Tier 1 承諾 effort 不變，arbiter／security agent 卻要求 detected deep 一律 max。 | B5 |
| R4 | P2；source＋隔離 repo | release tag 後一個新 commit、無 ledger，Ship 得到 pending=[] 並可能省略其餘檢查。無紀錄不是沒有待發布變更。 | B4 |
| R5 | P3；source＋官方文件 | Map overlay 重複 lifecycle／report owner；runtime 未區分 fork；actor 欄位與固定 opus 升級說法過時。 | B5 |
| R6 | P2；source＋隔離 repo | 禁止路徑內的 untracked 新檔未被 scope／ledger 掃到；不存在的 base 也回報 scope: clean。 | B2 |
| R7 | P2；source＋純函數重現 | 同一 HEAD 的兩個 run，單一 close 使 open 由 2 變 0。自己的 delivery commit 亦可能變成 rework candidate，但不會自動成為 escaped。 | C1 |
| R8 | P2；source＋受控 TEMP 重現 | Doctor malformed child 未用 probeEnv；父環境開 debug 時，在 helper 自有 probe 目錄外的父 TEMP 寫 log。重現沒有碰機器全域 log。 | B3 |
| R9 | 操作缺口；source／待實機 | TP 假設已有 TaskState；bootstrap／review file 路徑／lock operator recovery 不完整，deep graph 未說清 TP 七步 ownership。agent 引用另需驗可達性。 | B5、C2、C3、D2 |

首批檔案定位：`cressetide/hooks/orchestration-check.js`；`cressetide/skills/vigil/scripts/{contract-check,run-ledger,run-reconcile,run-consolidate,pack-review-diff}.mjs`；`cressetide/skills/doctor/scripts/doctor.mjs`；`cressetide/skills/ship/scripts/ship.mjs`，及各自的 skill／reference／tests。每個實作 GO 再固定精確 allowlist；這份清單不是任意擴大修改的授權。

## 4. 必須保留的行為與非目標

1. 使用者核准的 AC、must-not-change、required checks、exit-status authority 與真實裁決保留。必要檢查未完成不能被文字描述成通過。
2. TP 保留來源／版本／inventory 綁定、stale／replay 拒絕、原始 reviewer batch transport、main-thread 單一寫入者，以及 arbiter 自己執行 fresh gate；loop 或 provenance 任一不通過就不能 READY。
3. TP-active 的空 inventory 仍需要真實 test-reviewer。intent-reviewer／arbiter 的現行不可 substitution 邊界不因減重改掉。既有一般 fast lane、lite、風險 panel、conditional references 不重新包裝成新功能。
4. 保留 hooks 既定 fail-open 邊界；未知不變成 pass，也不捏造負面裁決。不能為了 probe 成功而放寬 destructive regex、加入繞過權限或 actor 例外。
5. 不以縮小資料夾、JS 行數、vendor bytes 宣稱節省 model context／費用。保留 parser／provenance 核心與其來源／license 邊界。
6. live ledger、retro 與 run-consolidate 保持 facts／counts；不把 benchmark 分數、品質率、實驗選樣結果寫進 live verdict。
7. 不自行降模型、提升 effort、安裝新 host、修改全域記憶或預設啟動策略。host／外部工具操作依既有授權與具體範圍執行；本計畫不授權實際 production incident 操作。
8. 整合計畫不預先決定新增 `--lean`、全面角色合併、整個 controller 重寫或無人核准的 plan-to-production graph。完整 intent-scan 是 C3 的既有規格義務；memory、compaction、model／panel 等新政策是 H 的評估項目。修改預設必須有明確決議與驗證，不能把兩類工作混在一起。

## 5. 實作與驗收順序

### A — 基準與 host 證據（不等待所有研究才修獨立問題）

**A1：Stop transport characterization。** 在新的隔離 consumer repo／session 記錄 foreground completion、background launch＋completion、resume／superseding completion、取消／失敗、未知格式；Workflow 格式只在實際能力存在且該範圍要支援時加入。優先保留現有 2.1.263 基準與新目標 host 各自身份，不能混成同一格式。

無論是否進行 F，都記錄 target host 的 Workflow 能力：現行 Tier 1 已會在條件符合時使用模型當場生成的 Workflow，不能把它當成尚未存在的未來功能。

- 產物：去識別、可重播、附 CLI／Node／OS／來源 commit 的 fixture 與場景表；區分 stream-json 與 hook 實際讀到的 transcript JSONL。
- **AC-A1**：每筆「完成」可說明 invocation identity、完成事件、最新結果與 resume 關係；僅有 launch metadata 不算完成。未觀察格式留 unverified。
- **AC-A2**：捕捉失敗時保留原因；不假設所有 host 都相同，不碰舊 sealed fixtures，不把新合成控制稱為 Type-B。

**A2：資料／規格對位。** 固定需要變更的 caller、輸出格式、測試與文件 owner；C1 對所有 ledger consumer 列清單；C3 對 intent-scan §12／AC 做對位；C4 建立所有現行規格與 amendments 的完整覆蓋索引。先完成每批修改所需對位，不讓整份索引的剩餘審查阻擋獨立 B 修正。

同時盤點一般 agent 引用，含 navigator／cartographer 的 Map 路徑及 arbiter 的 reference：區分已 inline、host-qualified、需要 packet 交付與待實機確認。AC-C5 的 root／handoff 觀察後關閉各項，不能只驗 TP 引用就宣稱全部可達。

發現不可達的 non-TP 引用，明確交由 B5／AC-B17 修正；不是等觀察後只記一條風險。TP 專有交接同時由 C2 負責，兩者共用 A2 索引，避免漏項或各修一套。

**可並行**：A1 未完成不妨礙 B2–B5 的設計與修正。B1 的最終 supported transport 清單必須有 A1 證據。

### B — 首批正確性修正（v0.7.3 候選範圍）

**B1：Stop 完成辨識與裁決綁定。** 保留舊 Task 相容，支援已觀察 Agent transport；綁定已完成、目前有效、未被 resume 後結果取代的 arbiter verdict。

- **AC-B1**：Task／Agent 的 READY＋完整 panel 不產生假 missing-panel；NOT READY＋明確 shipped 在 opt-in enforce 下按契約 block；held 正常保留。
- **AC-B2**：launch、取消、錯誤、他人引述 verdict、錯配 ID、舊結果與重複 Stop 不誤當有效裁決；原有 verify fail／unrun 等獨立規則不回歸。
- **AC-B3**：未知格式在 delivery／review claim 或 enforce 使其相關時，最多一則清楚的「無法驗證完成狀態」訊息；不只留 debug、不指控審查缺席、不從未知推導 block。有效 async completion 可被採用，不能永久限制同步結果才算數。

本項不新增 Stop 的 TP-state authority；TP panel sufficiency 仍由既有流程與 arbiter 負責。舊 Task 已支持情境的輸出維持相容；如果修正會改變既有誤判，需逐例記錄有意差異，不能以「全部 byte-identical」遮蔽必要修正。

**B2：完整且誠實的檔案範圍證據。** 明訂 tracked／staged／unstaged／untracked 的聯集、ignored／runtime scratch 排除方式與比較基準。跨 consumer 採同一語意，不以各自猜測消除差異。

保留任務開始前的使用者修改／untracked 檔案，區分「目前 working tree 中的變更」與「可歸屬本次 run 的變更」；來源不明就揭露 attribution 限制，不指稱全部由 agent 造成。檢查器不得為了納入新檔而自行 stage、commit、移動或刪除它。

要做逐 run 歸屬，必須保留實作前的 untracked 名單及必要內容身份；沒有先前 snapshot 就不能回推作者。`git add -N` 也屬修改 index，不可當唯讀檢查的替代方法。

- **AC-B4**：禁止範圍內的新 untracked 檔能被發現；允許新檔、tracked 修改、staged 新檔、刪除、rename、Unicode／空白與平台允許的特殊檔名有明確結果。採 NUL-safe Git 路徑處理，不以 trim 或換行解析改變合法檔名。
- **AC-B5**：invalid base、Git 不可用、non-git、unborn HEAD 等逐一決定可建立的 evidence 或 unverified，絕不以 catch→[] 回報 clean。fail-open exit 與 evidence status 分開表達。
- **AC-B6**：contract-check、run-ledger 與 review packet／pack-review-diff 使用的範圍一致或明確揭露差異；新檔內容若未進 diff，packet 能指出缺口並提供有界讀取方式，不能只補檔名就宣稱完整 review。

**B3：Doctor 固定探測下沉 helper。** 由 helper 以 subprocess＋JSON stdin 執行 plan deny／destructive ask，套用現有可信 canonical root／exact wiring gate；模型讀 rows，不再組含危險字串的外層 shell。

- **AC-B7**：兩 probe 都核對 exit、JSON shape、decision；wrong／missing／unrun 分別呈現 fail 或 unverified，不報 healthy；trust gate 不符則不執行。
- **AC-B8**：decision probe 使用有界、無 project opt-out 的隔離 context；valid／malformed child 的 TEMP、debug、project root 都受控。父 debug 開啟也不在 helper 自有 probe 外產生 log；只清理自己建立且已確認的路徑。
- **AC-B9**：headless 真實 Doctor 可取得兩 decision rows，不需批准含 destructive literal 的 wrapper；`--project` additive 行為仍成立。row 數、SKILL、diagnostic contract、三語 README 與 tests 同步；直接 helper 證據仍不稱 host event。

**B4：Ship 區分資料覆蓋狀態。** 分開 absent、unreadable、present-empty／no matching READY、有效 pending、破損紀錄的處理；保留範圍有限的 READY-ledger 依據。

- **AC-B10**：新 clone／沒有 ledger／release 後有非 Vigil commit，不顯示無條件「沒有待發布變更」；改為「沒有已記錄的 READY run」並說明覆蓋限制。
- **AC-B11**：pending=0 也保留其餘 readiness checks；不從 Git commit 或 changed-file count 推導 READY，未知與 no-change 分開。

**B5：契約單一來源與 runtime 說明。** Tier 1 沿用設定；Tier 2 只在 opt-in 且 host 有相應控制時提出 effort 要求，不在 agent frontmatter 固定 max。model／effort 分 requested、configured、observed，無觀測時不猜測。

- **AC-B12**：arbiter、security、deep-mode、reviewer-selection、三語 README 的 effort／model 語意一致；固定 `opus` 不再被描述為對所有 session 一律升級；不改本次 Opus 5／xhigh 或偷偷改預設 pin。
- **AC-B13**：Map overlay 只承載 Map grounding／staleness／recon／correction；每條移出的義務有明確 owner，compact/full 與載入時機不衝突。保留 reviewer 完成不能自我登記等有效約束。
- **AC-B14**：區分 named non-fork 與 full-history fork；修正 actor 欄位的過時絕對說法，不增加角色 bypass。`/run` 目前確實存在，不能當缺陷；歷史 GA 版本斷言若無來源則收窄。
- **AC-B15**：修正 reviewer-common／review-packet 把 build/test 普遍描述成唯讀的措辭；依命令副作用區分檢視、隔離執行與共享輸出鎖。這是事實修正，不等待 E 的成本研究；最低必要審查責任不因此減少。
- **AC-B16**：過渡期保留既有 Tier 1 啟動政策；當它使用尚未支持的 Workflow completion transport，按 AC-B3 揭露無法驗證，而非宣稱未審查／已完成。若未來要暫改 opt-in，需另有明確政策變更決議，本計畫不偷偷變更預設。F 提供可重用受測 graph，不代表之前沒有 Tier 1。
- **AC-B17**：A2 的每個必要 agent-body citation 都有可驗證的交付方式：inline、root-qualified 並觀察展開，或 packet-delivered；含 navigator／cartographer 的 Map／evidence references。不能假設根目錄展開會自動修復其他相對路徑。真實 agent 在受支持 consumer layout 可取得正確版本的內容，保留唯一 owner；仍不可達則相應流程保持 BLOCKED，不能僅列風險就完成驗收。

現有 arbiter prompt 為 29,913 bytes，validator cap 30,000 bytes（本次已重讀檔案核對）；先以刪除衝突／重複敘述完成修正。若確需改 cap，提出實際新增內容、載入影響與單獨理由，不為躲過 validation 而直接放大。

### C — 執行紀錄與已核准規格的操作完整性

**C1：Run identity 與歷史相容。** 先對 `run-ledger`、`run-reconcile`、`run-consolidate`、Doctor、Ship、TP ledger projection 與文件讀寫者提出 schema 變更，再實作。run identity 與 commit identity 分開；run 的基準、交付及後續變更各自記錄。

- **AC-C1**：同一 HEAD 上兩 run 可分別 close／expire／修正 disposition；短 SHA 或不唯一 legacy ref 不可靜默批次結案。
- **AC-C2**：既有 v1 records 仍可讀；無法可靠反推 run identity 的資料保留 ambiguous／legacy 狀態，不捏造逐 run 關聯。append-only 歷史不原地改寫；若要遷移另有可預覽、可復原程序與中斷／重跑語意。
- legacy identity-ambiguous records 不可直接納入後續 real-world／efficiency dataset；取得可驗證的獨立關聯才重新評估資格。
- **AC-C3**：自己的 delivery 不自動當回歸，`fixture` 等字樣不因寬鬆 stem 產生確定因果。candidate 仍只代表待判讀，escaped 必須有 disposition 理由；Ship／Doctor／counts 與新舊混合資料一致。

**C2：TP 可操作入口與復原。** 為合法 TaskState 初始化、controller-owned 路徑取得、reviewer 原始 batch 保存、七步單一寫入者與 arbiter command 定義完整步驟；優先薄 CLI／driver，重用現有 domain transactions。

- **AC-C4**：從乾淨 consumer project 按公開步驟建立合法 task、取得確切路徑，不徒手 Edit tracked store、不猜 hash 檔名、不依賴搜尋 cache。
- **AC-C5**：觀察當前 host 的 plugin-root 展開／傳遞；reviewer 得到所需規則與原始資料，main thread 保留 exact batch，不 parse/reformat/repair reviewer-owned bytes；arbiter 自己取得 coherent payload＋exit pair。
- **AC-C6**：positive、negative→repair、empty inventory、unestablished inventory、stale replay 與 cap 情境維持已核准語意；不以 harness 完成宣稱普通模型完整流程完成。
- **AC-C7**：process/file lock 與 semantic controller lock 分開。operator recovery 驗證 holder 狀態、token 與檔案 identity；不得只看檔案年齡就刪鎖，不以 open-epoch 當萬用刪鎖；所有不確定 holder 情況拒絕破壞性復原並保留診斷。
- **AC-C10（C2 必要完成條件）**：一個乾淨 consumer project 按公開步驟完成 model-orchestrated TP-active run：main thread 保存真實 reviewer batch，submit／commit／verify 成功，arbiter 自己呼叫 evaluate 並取得 coherent payload／exit。只通過 unit tests 或 harness 不能將 C2 標 VERIFIED；實機未完成就保持 BLOCKED，與 D2 共用同一筆符合條件的證據，避免重跑同一驗收。

**C3：完整 Intent-scan 與 governance 接線。** 先辨識等價 carrier，再完成尚缺的協定；缺檔只是線索，store 已實作也不代表使用者流程已完成。依下列子批順序處理，不把七維度全文無條件塞入所有 agent。

先完成共用 governance core：principal→agent routing、per-rulingKind schema、packet／ruling identity 與未知值拒絕；C2 的 TP `assum-reading-change` 與 C3 pre-gate 共用它。這解除「TP 等完整 intent-scan、intent-scan 又等 TP」的循環。contract derivation 在 B2 範圍語意確認後完成，重新檢查 contract-guard 對 main-thread／implementer ownership 的約束。

- **C3a／AC-C8：義務索引。** 對 intent-scan §12 全部 15 個 touchpoint、§13 AC1–93 及 store-script assertions，逐項列 source、test、後續 acceptance 或具體缺口。plan-grounding assumptions 只能算部分相近；等價搬移要逐條證明義務仍存在。
- **C3a／AC-C9：觸發與權限決議。** 對齊七維度適用條件、skip-scan、零 DP、風險分類與 Stage A／B：navigator 仍只負責適用的 Stage A，scan 由 main thread 執行。列明批准規格與現行預設的差距；實作核准規格，或先提出具體 amendment。不能把「維持現行預設」當作永久省略 scan 的理由，也不能把一次 scan 膨脹成所有任務增加整套 panel。
- **C3b／AC-C11：plan 與 pre-gate。** 補 protocol／governance-ruling reference 或可證明等價的 carrier；main thread 產生 bounded scratch 與 Governance Packet，intent-reviewer 做分類、scope proposal 與 ask 擬題。涵蓋七維度、material fork、no-applicable-dimension、scope false→Ask、row 7 checkpoint、stale proposal、合法 fingerprint 進展、cap／epoch／re-gate；未收斂不能開工。plan 階段不寫 canonical store。
- **C3c／AC-C12：post-approval 交易。** 預鑄 ID、真實 user authority witness、DP／REQ／DEC／ASSUM／ruling 經既有 domain transactions 落盤。驗證一般 plan approval 與具名 clause transition 的 witness 差別、single-writer、CAS、no-write failure、resume 保留 taskId、初次 outcome 不誤建 Transition、reopen／supersede／retire 的合法路徑。不得以模型捏造批准。
- **C3d／AC-C13：contract 與 review。** machine block 由 manifest 可達的 active store state 導出，保留 behaviorChanging／verification／assumptions；零 DP 的 approved AC 仍成為 REQ。contract 在實作前建立；packet 加入 §10 四項；arbiter 以 store 驗 pending 清零、INV 與 terminal state，不能只採 coordinator 的文字保證。
- **C3e／AC-C14：狀態與 telemetry。** runtime-contract 明定 committed semantic state 與 per-run scratch，runtime-policy 保留 writer 邊界；scratch 可重建。`intentScan` 及 shared §10 適用 DP counts 從 scratch snapshot 帶入 verdict 後唯一 run record，與 C1 identity／TP projection 同時設計；完整觀測欄位、缺值語意及所有 ledger consumers 同步，計數不成為 gate，報告 sentinel 缺失也不能漏記。
- **C3f／AC-C15：整體驗收。** 按 §13 區分 deterministic assertions 與模型流程；新 consumer 情境涵蓋綠地 material fork、既有 REQ／exception、零 DP、row 7、product-tradeoff re-gate 與跨 run reopen。每一適用 AC 都要有相應證據；harness 不代替真正 main thread／reviewer／arbiter 的交接。與 C2／D2 共用符合條件的 receipt，不重複付費驗同一情境。

C2 必要 bootstrap／governance 可先從 C3 抽取有界子批交付；完整 C3 仍是整體功能完成的必要條件。TP 所需 ASSUM／DEC、DP、ruling 必須有合法 producer，缺少者不能在 C2 驗收時略過。

**C4／AC-C16：全部既有規格的覆蓋與殘留缺口。** 建立可逐條追溯的 coverage index：shared model §§1–11／INV／transition／state／authority，intent-scan 全 AC／touchpoint，TP 全 AC 及四份 amendments 的新增／替代 obligations。每列具來源版本與條款、current source、測試／實機證據、最新 review、狀態、缺口 owner／子項。狀態只能為「已接受且目前仍適用、等價搬移、待證據核對、缺實作、缺驗收、已正式替代的歷史條款」。未定位不推定缺功能；找不到證據也不推定已完成。

先處理明確 C／D 缺口；餘下未核對條目必須在功能里程碑前歸位。真正缺實作者經討論後追加 C4 的具名子批與 AC，不能用籠統的「其餘已完成」關閉。對 TP AC118／128／136／138／161，從後來已接受的 consumer、reader/writer、parser、product integration 驗證適用範圍，不照抄較早 review 的未放行快照；AC137／149／151 與跨平台要求則另見 D5／D6。本輪建立的是完整核對工作範圍，不虛稱已完成每一 AC 的 source/test 證明。

**AC-C17：status 與 carrier 對帳。** 明列 TP AC138 的六個前置條件與後來 artifact／CLI、D11／final acceptance 的對應，補 status-only addendum，保留歷史段落與 normative 條文。沒有逐 AC 編號的 review 不能直接推論未經驗收就解鎖；也不能把 component acceptance 擴張成未做的跨平台／獨立 writer 驗收。TP §12 的第三向 traceability 必須與 verification-gate 及 arbiter 的 provenance evaluate 實際語意對位，證明等價或列出缺口，不能只按標題的 two／three 判定。

規格提及的 demo／命名情境，使用新且等價的來源驗其規範結果；執行前固定情境與 normative outcome 對照，不看結果後挑等價定義。不讀取或重跑封存 benchmark。若條款真的要求不可替代的原 fixture，維持 BLOCKED 並提出 amendment，不因封存限制直接改標「歷史、不需驗」。

### D — 新的原生流程證據

依 [compatibility checklist](../../compatibility.md) 建立逐情境 ledger：觀察過才通過，未觀察列 unverified。優先支持 B／C 所改的行為；維持「自動測試」「直接 helper」「host event」「完整原生流程」「Type-B」「比較效益」六種證據區分。

- **D1／AC-D1**：乾淨安裝、enable／reload、memory 有／無／fallback、plan edit deny／非 plan allow、destructive ask／harmless allow、Stop 正反例、真實 compaction、Doctor default／project，各自記錄可觀察結果及版本。危險情境只驗證權限決策，不執行破壞性 payload。
- **D2／AC-D2**：普通 model-driven Vigil 執行 approved criteria→implement→checks→實際 reviewers→arbiter→footer→ledger，涵蓋成功與 repair／held；TP 路徑按 C2 另記，不以腳本代做 main-thread 步驟混稱完成。
- **D3／AC-D3**：Map create／refresh／stale／manual notes 與 Salvage handoff 在受控 consumer fixture 走通；事故演練清楚標示 simulated，未驗證真實 production rollback／data repair。
- **D4／AC-D4：真實資料取得與資格審查，整體必做。** 先清查已授權且可讀的已結案任務來源，不限特定 ledger 路徑；記錄納入／排除理由、source／task identity、執行與 verification、usage／缺值、後續 disposition。沒有合格歷史時，對下一個已授權真實任務安排 prospective 記錄與後續結案，未實際觀察前保持 BLOCKED。不能用 scratch、Doctor、單純維護者測試或虛構 outcome 充數；不自動擴張其他 repo／production 授權。與 E4 共用同一 data manifest。
- **D5／AC-D5（承接 TP AC43／AC59）**：使用相同來源、配置與可識別 immutable view，在 Windows／Linux 取得成對 bodyDigest／testRef／inventoryDigest 實際輸出並比對；保存來源與環境身份及負例，涵蓋 Git path、大小寫、換行與 symlink 邊界。先評估可用的既有 CI runner，無須把「本機沒有 Linux」當成唯一途徑；CI 需實際產生可配對 artifacts。任一側不可執行或輸出不可比就保持 BLOCKED／PARTIAL，不以各自 unit 綠燈替代比對。

**D6：獨立 writer conformance。** 承接 TP AC137／149／151 與 intent-scan AC36；已接受的 bounded digest oracle 保留其效力，但不冒充兩個完整合規 writer。

- **AC-D6**：先界定完整受支持 profile、source／immutable view、writer identity 與實作獨立性。第二 writer 是驗收用途，可留在 test／eval，不必出貨到 plugin；不得只是同一 producer 的 wrapper 或複製演算法再稱獨立。共用依賴及剩餘相關性須揭露，核心 canonical 推導與比較 verifier 有可審核的獨立路徑。
- **AC-D7**：TP 比對 structuralId、range/name、hook applicability、resolver、dep／oracle closure、全部相關 digest，以及 AC151 lexical accept/reject；包含 AC149 指定的錯誤 writer 反例。intent-scan packet 比對集合插入順序不變與 alternatives 順序改變的結果。每條 obligation 有具名比較，不能用幾個 digest 相等概括全部。
- **AC-D8**：將 D5 的平台矩陣與兩 writer 結果分開記錄，具條件時共用來源與執行；只驗本機或部分 profile 就保持 PARTIAL，不宣稱 AC137／149 全面完成。成本過高也不能自行撤銷已核准義務；需正式範圍變更才能排除。

**D7：新的 E2E 證據補強。** 承接舊 actual-reviewer review 的明列缺口，使用新 fixtures／receipts，不重跑或修改已封存實驗。

- **AC-D9**：新 receipt 綁定 driver、相關 helpers／guard、source、model／CLI 與實際輸出 closure；獨立驗證不能只依同一個 helper 回傳 true，加入對 digest、actor、exit／payload、raw slice 的單變數竄改控制。
- **AC-D10**：補 supplemental verification failure、terminal／cap、取消／中斷的適用流程；驗證 required checks 未完成不能 READY、無額外 commit／ledger 寫入、合法復原不吃掉原始否決證據。與 C2 的拒絕／復原案例共用適用證據。過去 positive／repair acceptance 不因此撤銷。

### E — 有界減重驗證與預設決策

E 是新研究，不是續跑舊 L2 候選。先證明一個可移除的重複工作，再固定原版／候選、觀察與退出條件。首批候選按順序各自評估，不一次混改：

**E0 契約審查先行。** 舊效率 roadmap 的品質／量測／default-adoption 規則仍有效，新 protocol 不得以較弱條件繞過它；需要不同規則就先提出明確 amendment。E1 涉及 D11 已接受的 inline grammar／gate contract／permission carriers，必須先記錄 TP v1.21 carrier amendment、逐條 owner 與測試對位，再改載入位置。E2 若僅沿用既有「提供的 suite evidence 或自己執行」規則，不虛構新義務；若要減少最低檢查責任或獨立性，亦須先修訂相應契約。測試跟隨已核准的新 carrier 驗證，不以刪測試解除舊約束。

1. **E1：TP 規則只在 TP-active 時交付。** 將一般 agent 不需要的 TP 長文移至有保證可達的 reference／packet，逐條保留 TP grammar／ownership／empty inventory 等義務；不得只換成無法解析的相對路徑。
2. **E2：共用已完成的驗證證據。** reviewers 讀取 coordinator 的命令／exit／來源版本證據，只對缺失或過期部分追加檢查。會寫 build/cache/snapshot 的重跑在隔離環境或序列化，不能把任何 build/test 都稱為唯讀。

**AC-E1：候選放行條件。** 固定可比的 model ID／effort、CLI、起始 bytes、AC、可見測試、權限、cache 條件與人工介入政策；provider 沒給的 model／usage／child attribution 留 unavailable，不當零。記錄 loaded input、agent/tool 次數、重試／失敗／repair、elapsed／等待、人力與可用成本；經濟結論需要完整相關 accounting，磁碟 bytes 不是主成效指標。

**AC-E2：品質與停止條件。** 先固定樣本數、主要 outcome、critical miss／false completion／invariant／false-positive 定義、品質界線、成本上限與重跑政策。候選不可讀取 hidden checks 或答案；出現關鍵退步先停止並討論，不邊看結果邊換資料或修改及格線。小探索樣本只能支持其範圍，不建立廣泛 noninferiority。

E1 若改動 TP carrier，採用前必須以新 carrier 重新滿足 AC-C10 的 model-driven TP 驗收，並涵蓋 TP empty／negative／stale 等契約控制；不能只看到 non-TP input 變少就採用。這次重驗是來源改變後的驗證，不是無原因的重複檢查。

**AC-E3：三種可記錄結論。** 合格證據支持某個 task stratum 才採用；證據支持不採用就保留原版並關閉該候選；資料／量測不足則 blocked／inconclusive，保持「整體效益未驗證」。不以候選結案代表舊 L3 或所有效益目標完成。

探索期只可決定是否有資格進入 confirmation 或停止候選；正式採用減重預設須完成適用 E5／E6，不因小樣本「看起來更省」提前切換。

**E3／AC-E5：補齊 L0 的原生全流程 accounting。** D2 在新 protocol 下同時收集 top-level／child calls、usage、cache、失敗／repair、等待、人力、可得 spend 與來源身份；實驗數值留在獨立 receipt，不寫 live ledger 品質分數。先核對 provider 實際提供的欄位、累計／增量語意與去重，再發動比較。缺 child 或 final usage 就不報 aggregate cost；blocked 的舊 phase33 不追補成完整紀錄。正式 cost trial 前先滿足可用 accounting 或明列阻擋條件；已完成的 L1a measurement-limit 處置不重開。

**E4／AC-E4：真實成效資料門檻，整體必做。** 遵守 [benchmark contract](../../benchmark-contract.md)：real-world 比較資料源自合格已結案 run、凍結後由獨立 hidden checks 評估明確版本 A／B。與 D4 共用 eligibility manifest；legacy record 必須有可獨立驗證的唯一 run 關聯，不只按是否有新版 runId 欄位判定。合成案例與 prompt-drift suite 各自留在其證據範圍。未建立真實 dataset 時保持 BLOCKED，不承諾日期、不編造資料、不推出節省百分比。

在看比較 outcome 前固定 legacy linkage 方法與資格規則；identity 正確也不等於資料完整。尤其舊 B2 修正前的 files 可能漏 untracked，必須獨立檢查 scope／verification／usage 覆蓋，無法補證的資料只保留可支持的用途或排除，不拿唯一 HEAD 當萬能資格證明。

**E5／AC-E6：新 held-out confirmation，承接 L3 未結義務。** 只有新候選通過 AC-E1–E2 與事先門檻才可進入；先凍結另一組 held-out tasks、樣本數理由、quality margin、主要 spend outcome、uncertainty、失敗／timeout／重跑規則，再執行獨立 outcome grading。新 grader／新 fixtures 不能洩漏答案給 candidate，亦不接觸舊 sealed checks。沒有合格候選就記 NOT RUN／upstream BLOCKED，不能硬跑已停止候選或填 passed；這時整體效益決策仍未完成。新證據要標新 protocol 與舊 L3 義務的承接關係，不改寫舊實驗狀態。

**E6／AC-E7：整體預設效益決策，承接 broad L4。** 分開回答兩個問題：

1. **plugin 的額外價值**：native agent＋正常專案指示 vs Cressetide default，給各 arm 相同可見需求／AC、起始來源與合理工具；不故意削弱 native arm，也不因缺少 plugin 專屬 metadata 就判它產品行為失敗。
2. **減重是否值得採用**：current default vs 通過資格的新候選，或明確另立的既有 lite 比較；一次只改一項因子。不能把 lite 宣傳為新功能，或把同時降模型造成的差異歸因流程減重。

共同固定 model／effort、host、intent-scan 的版本與觸發政策、風險／TP strata、cache 與干預規則；小探索樣本不產生廣泛品質保證。C3／H 若改變適用預設，正式 baseline 必須重凍結，不沿用已不相同的成本來源。按事前門檻給出「支持某範圍採用」「有證據支持保留原版」或「資料／品質不足，BLOCKED」，列適用範圍、限制與 rollback version。E1／E2 個別 NOT ADOPTED 可成立；**兩候選退役不等於 broad L4 完成**。

沒有新候選合格時，問題 2 可按事先 protocol 改由既有 lite 的合格比較，或充分的比較證據支持保留原版；仍須滿足適用 confirmation／品質門檻，不能用退役紀錄充當比較結果。只有 E6 所需證據確實不足時才保持 BLOCKED，不要求為了完成而製造新候選。D4 的後續觀察期限按任務與 protocol 事先界定；retro 的 14 天 tripwire 不是所有 Type-B 的固定等待門檻。

本次 Claude 協作固定 Opus 5／xhigh；這個模型的結果不能推導 GPT-6 Astra 效益。若要回答 Astra 的實測效益，另凍結同一模型內 native／plugin 的配對 protocol 與 host 支持範圍，再納入 H4 決策，不把跨模型 reviewer 意見當執行證據。

### F — 可選原生 Workflow panel

F 是條件候選；必做的是完成能力／價值評估與採用決策，實作只在 ADOPT 後納入必要 gate。它不是首個修正版本的前置要求。A／B 已確定 transport，D 有普通流程基準後，先只做 non-TP selected panel→arbiter；E 至少有一份有界候選處置，避免一次混入兩種變化，不等待整體研究才可做 prototype。能力不可用時記 DEFERRED 並保留既有 fallback；要關閉此評估，可作出「對本次明定 host 範圍不採用」的有據決策，不能聲稱 graph 已落地。

- **AC-F1**：等待所有必要 reviewer 的有效 completion；null／cancel／schema failure／permission refusal 不能被 filter 掉後當完整 panel；required gap 不得 READY。
- **AC-F2**：Stop 可以辨認已支持的結果，或明確報 unsupported；不採 caller 自行宣告 panel 完成的無綁定捷徑。
- **AC-F3**：人工 plan／production 決策留在 graph 外的明確階段。未定義 TP main-thread ownership 與 raw bytes transport 前，不將 TP 納入 graph。
- **AC-F4**：採用前驗證 host 能力與替代路徑、版本與 source identity；沒有完整中途人工互動的 graph 不承接整個 Salvage 或無人發布。

### H — 其餘候選的具名評估與決策（可與 D／E 前置工作並行）

H 的必要產物是每個候選的問題依據、現行 owner、具體方案、預期收益、驗證需求與採用／不採用理由。ADOPT 才增加程式實作義務，並補精確 allowlist／AC；NOT ADOPTED 表示有據保留現況；DEFERRED 仍是未結評估，不作完成。不能把 C3 等已核准義務移到 H，再以可選名義取消。

| 工作／AC | 必須完成的判斷 | 採用時的驗收 |
|---|---|---|
| H1／AC-H1：全域 failure memory、舊路徑搬移 | 盤點 project／global read-write owner、現行 fallback、重複寫入與跨專案影響；決定維持、project-first 或具體遷移方案。 | 符合授權範圍、舊資料可讀、衝突可預覽、不中途丟資料、重跑／中斷可恢復；不自動刪全域資料或改其他專案。 |
| H2／AC-H2：compaction 僅在 ctide-active 提醒 | 定義 active state 的來源、生命週期與未知狀態，對照目前噪音及復原需求。 | 新／非 ctide／active／resume／compact 後可驗；不漏長任務必要 handoff，不把未知狀態當 inactive 靜默丟提醒。 |
| H3／AC-H3：reviewer model pin、panel／重跑政策 | 分清過時宣傳措辭（B5 必修）與實際策略更動；檢查既有 lite、fast lane、risk policy 可否已滿足需求。 | 尊重使用者模型／effort，品質與獨立性有適用 evidence；新豁免先 amendment，不能藉共用 evidence 取消必要裁決。 |
| H4／AC-H4：全面 TP Workflow、Copilot CLI、跨模型評估 | 三個子決策分列支持矩陣、需求與成本；現行可選 Codex second opinion 不等於原生 Codex／Copilot plugin conformance。先決定本 roadmap 是否採用各擴充。 | ADOPT 後另定 host／model conformance、raw bytes／writer ownership、權限／取消／fallback，補測後才列支持；沒有 evidence 就保留未支持／未證明。 |
| H5／AC-H5：shared §10 的額外 calibration audit | 區分必需的 DP facts（C3e）與只有用途描述、尚無實作規格的 capture-recapture／校準構想；提出實際必要性並決定採用與否。 | 採用才另立獨立 protocol／資料／偏誤檢查；不把估計或品質率加入 live verdict，不借用舊 sealed 樣本。 |

### G — 文件、發布與收尾（逐批適用）

每批修改同步其 owner：三語 README、command reference、runtime contract、compatibility、EVIDENCE、CHANGELOG、相關 SKILL／reference／tests；只更新受影響欄位與已證明事實，不把規劃寫成已出貨。

- **AC-G1**：三語 README 的功能／預設／限制一致；對使用者列的是「相對上一已發布版本的內容差異」，不是三種翻譯彼此的差異。
- **AC-G2**：每個 code slice 有相關正反例、結束碼與副作用驗證；候選整合後執行必要完整 regression／structure／deterministic eval／strict plugin validation，檢查 failed、cancelled、skipped，不只看 fail=0。
- **AC-G3**：三 OS CI 證據按實際 job 記錄；native host 只聲稱真正跑過的 OS／情境。不得為了綠燈任意換 runtime、刪除必要測試或放寬 guard。
- **AC-G4**：只有發布範圍被授權後才執行版本、簽章 tag、push、release／archive／checksum／attestation。沿用既有簽章需求，不重寫已發布 tag。計畫、已實作、已驗證、已 merge、已發布是不同狀態。
- **AC-G5**：若只完成 B，就只能宣稱首批缺陷修正完成；C／D／E／F／H 各自保持真實狀態。缺關鍵證據不能因時間或候選退役就把整份計畫標 COMPLETE。

## 6. 協作、進度與依賴

每個子項採相同次序：Codex 提出具體問題／重現 → Claude 唯讀說明同意或反對的原因 → 雙方釐清分歧 → Codex 記錄裁定、AC 與精確修改範圍 → Claude 實作 → Codex 在獨立副本驗證。若驗證出現新問題，**先詢問 Claude 意見並討論，不能直接要求立即修改**。Claude 的完成訊息不是獨立驗收，也不等於雙方已討論。

授權足夠的範圍由 Codex 持續推進，不反覆要求使用者確認；只有新增產品決策、外部／production 範圍或尚未授權的不可逆操作才另行處理。這一輪的授權是整理完整計畫，下面的 NOT STARTED 不代表已取得個別修正或發布的完成證據。

| 工作 | 依賴與可並行邊界 | 目前狀態 | 完成證據 |
|---|---|---|---|
| 計畫修訂 2 | phase44／45、公開 spec／review、phase46 討論 | DOCUMENT COMPLETE | 22 項登錄、三里程碑、分歧裁定、最後補正與文件驗證；不等於程式驗收 |
| A1／A2 | 新 host 範圍／現行 source；可先建立各 slice 對位 | NOT STARTED | 版本化 transport、caller 與義務索引 |
| B2–B5 | 各自 discussion／GO，不等待完整舊規格核對 | NOT STARTED | 重現轉綠、相關 regression、適用 host 證據 |
| B1 | A1、discussion／GO | NOT STARTED | source-bound completion／verdict fixtures＋host 正反例 |
| C1 | A2、B2；與 C3e 同時設計 schema | NOT STARTED | same-HEAD、legacy、完整 consumer 相容 |
| C3a／共用 governance core | A2、shared／intent authority | NOT STARTED | triggers／schema／routing 決議；TP 與 intent 共用 |
| C2／C3b–f | 共用 core；contract 依 B2、telemetry 依 C1 | NOT STARTED | 完整 scan／TP 交接、模型流程與失敗復原 |
| C4 | A2；逐批累積驗收，與 C／D 並行 | NOT STARTED | 所有 current obligations 無未歸位列；status 對帳 |
| D1–D3／D7 | 可先記錄 pre-fix baseline，接受結果依相應 B／C | NOT STARTED | 真正 host／model receipts，hardening 控制 |
| D5／D6 | 凍結 source／profile、平台及 writer 獨立性設計 | NOT STARTED；環境待確認 | 成對輸出、獨立 writer、差異控制 |
| D4／E4 | C1 唯一關聯、合格已結案任務與資料範圍 | BLOCKED：合格 dataset 未建立 | 一份共用 eligibility manifest；不製造樣本 |
| E0／E3 | 適用契約、D2 觀測與 accounting 可得性 | NOT STARTED | carrier 決議、可用全流程 accounting |
| E1／E2 | 前述量測、適用 B／C／D 基準，分批凍結候選 | NOT STARTED | 品質／成本、各候選處置；不混改 |
| E5 | 候選先通過資格；real-world arm 另依 E4 | NOT RUN：資格未建立 | fresh held-out confirmation；不得跳過前置硬跑 |
| E6 | E3／E4、適用 E5、穩定且凍結的功能／預設 | BLOCKED：比較前置未建立 | 原生 vs plugin、default vs candidate 的分開決策 |
| F／H | A／D 的適用資訊；F 依一份有界 E 處置 | NOT STARTED：待評估 | 每項決策；若 ADOPT，追加實作與獨立驗收 |
| G | 每個實際修改／發布批次 | NOT STARTED | 三語 README 對上一版差異、tests／CI、發布 receipts |

**依賴檢查結果**：B2–B5 可先修；B1 等 A1；B2／共用 governance core → C2 與 C3；C1 schema 納入 C3e 後一次處理 consumer 相容；D5／D6 可共用平台與來源，但分別驗收。D2 同時設計 E3 accounting，避免流程跑完才發現無法量測。C3 的觸發政策及任何已採用 H／F 變更須在最終 E6 比較前固定，若改變 bytes 就建立新 baseline。**E6 不反過來阻擋已核准 C3 實作**：先履行規格；若要變更規範，再以獨立 protocol 支持 amendment，避免循環依賴。

狀態字典：NOT STARTED、IN PROGRESS、DISCUSSION、BLOCKED、PARTIAL、VERIFIED、RELEASED；研究候選可 CLOSED／NOT ADOPTED，條件尚未滿足的試驗可 NOT RUN，尚未決定的新構想可 DEFERRED。每次狀態變更附日期、來源 commit／tree、receipt、未滿足 AC、owner 與下一個解鎖條件。無足夠證據不能填 VERIFIED；DEFERRED／NOT RUN 都不是 passed。

### 三個里程碑與整份計畫的完成條件

| 里程碑 | 必要範圍 | 可聲稱的結果 |
|---|---|---|
| M1：首批正確性候選 | A1 及 B 所需 A2、B1–B5 全 AC；相應 D1 host 情境；G1–G3／G5 | 首批已重現缺陷修正並驗證。暫定 v0.7.3 候選，實際版本依交付順序決定；不能稱舊規格或整體 roadmap 完成。 |
| M2：已核准功能與 conformance 完整 | M1、A2 完整索引、C1–C4 全 AC、D1–D3／D5–D7 全 AC、適用 G | 完整 intent-scan／TP／紀錄與平台、writer、實機流程都有對應驗收；不等於 real-world 效益已證明。 |
| M3：master roadmap 完成 | M2、D4／E4 合格資料、E0／E3、E1／E2 個別決策、按資格規則進行 E5、E6 broad decision、F／H 全項有據決策及已採用實作、G 文件驗證結案 | 所有已納入功能義務、缺失驗收與整體減重／價值問題已按規則處理，有明確結果與限制。|

- **MASTER COMPLETE** 要求所有必做工作與適用 AC 都有證據，且沒有 unresolved／BLOCKED／PARTIAL 的必要項。它不保證任何優化一定成功、不保證 plugin 一定有益；有充分證據的保留原版決策也可以成立。
- **候選未通過品質門檻，不得執行 E5**；可關閉該候選為 NOT ADOPTED，但缺候選／資料使 E6 不能完成時，master 仍保持 INCOMPLETE／BLOCKED。不得把「L3 不宜執行」換成「整體效益已確認」。
- D4／E4 真實資料、C3 完整協定、D5／D6 獨立證據，**不再是可排除在 MASTER COMPLETE 外的延後義務**。外部資料或環境不足時只阻擋依賴項，繼續其他可做工作；全部可做部分結束仍欠必要證據，最多報 CLOSED-PARTIAL 並列出缺口。
- F／H 的必要義務是決策；只有 ADOPT 增加相應產品實作。具名且有理由的 NOT ADOPTED 可以完成該評估；含糊的 DEFERRED 不能。不能把現有規格義務重新歸類成 optional 來縮小完成範圍。
- **DOCUMENT COMPLETE** 只表示計畫寫完並經複查，與 M1／M2／M3 執行無關。這次沒有改動產品程式，不能把文件工作算進修正完成數，也不估算沒有固定分母的「完成百分比」。
- G4 在具體批次有發布授權時納入該批 gate；同一授權不重問。簽章 tag、push、GitHub release 各自需 receipt，已驗證或已 merge 不等於已發布。不得覆寫既有已發布 tag。
- 後續若正式縮小 master 範圍，需明載使用者決定／適用 amendment、被移除義務與原來未完成的狀態；不能僅為宣告完成而改名或刪列。

## 7. 所有未結項總表

這是完整執行範圍的追蹤表，取代上一稿的「具名延後項目」。R1–R9、已核准未落地項、缺證據及新候選均有去向；細節及 AC 以 §5 為準。owner 一律為 Codex 計畫／裁定／驗收、Claude Code 意見／實作；外部資料提供者或 host availability 另記，不把阻擋責任推成程式完成。

| 登錄 ID | 來源／類別與目前缺口 | 工作／完成依據 |
|---|---|---|
| U01 | R1：Task／Agent、async／resume 裁決綁定缺陷 | A1、B1，AC-A1–A2／AC-B1–B3 |
| U02 | R6：untracked／invalid Git evidence | B2，AC-B4–B6；連動 packet 與 C1 |
| U03 | R2／R8：Doctor probe 建構及環境隔離 | B3，AC-B7–B9 |
| U04 | R4：Ship ledger 覆蓋與 pending=0 的誤導 | B4，AC-B10–B11 |
| U05 | R3／R5 及 R9 一般引用：effort、Map owner、runtime／model、agent references | B5，AC-B12–B17 |
| U06 | R7：run／commit identity 混淆、legacy 相容 | C1，AC-C1–C3，與 C3e 一次設計 |
| U07 | R9：TP bootstrap、路徑、raw batch、arbiter、locks | C2，AC-C4–C7／C10；A2 引用清單；non-TP 修正見 U05 |
| U08 | intent-scan 已批准但 protocol／governance／contract 接線未完整 | C3a–f，AC-C8–C9／C11–C15；包括 TP 共用 core |
| U09 | shared DP telemetry、state-class、合法 caller 的殘留義務 | C3e／C4，AC-C14／C16 |
| U10 | 各 spec／amendment 全 AC、TP §12 carrier／AC138 status 尚缺逐條對帳 | C4，AC-C16–C17；已接受部分不重做 |
| U11 | compatibility 逐情境及一般 model-driven Vigil／TP、Map／Salvage 證據 | D1–D3，AC-D1–D3；C2／C3 實機驗收共用 |
| U12 | TP AC43／59 缺真正成對 Windows／Linux 輸出 | D5，AC-D5 |
| U13 | TP AC137／149／151 及 intent AC36 獨立 writer 證據 | D6，AC-D6–D8；單 writer 功能與比較證據分開 |
| U14 | 舊 E2E driver binding／verifier independence／supplemental／terminal 缺口 | D7，AC-D9–D10；新 scenario，不回開封存實驗 |
| U15 | L0 全流程 accounting 未建立 | E3，AC-E5；D2 同時蒐集 |
| U16 | Type-B／real-world dataset 未建立 | D4＋E4，AC-D4／AC-E4；資料資格與缺值有 manifest |
| U17 | 當前減重候選：TP conditional carrier、共用驗證 evidence | E0–E2，AC-E1–E3；既有 carrier 變更先 amendment |
| U18 | 舊 L3 未執行／broad L4 未決的承接工作 | E5／E6，AC-E6–E7；有合格候選才確認，缺前置保持未完成 |
| U19 | 可重用 non-TP Workflow panel 新候選 | F，採用決策＋適用 AC-F1–F4 |
| U20 | memory／migration、compaction-active、model／panel 政策新候選 | H1–H3，AC-H1–H3 |
| U21 | TP Workflow、Copilot、跨模型／Astra 實測、額外校準構想 | H4–H5，逐子項決策與適用 AC-H4–H5 |
| U22 | 文件、三語 README 對上一版差異、CI、簽章發布與真實結案 | G1–G5；發布只在適用授權下執行 |

**明確不列為未完成重做項**：已接受的 producer／consumer／preview／authority／controller／D11 bounded slices；已完成的 v0.7.2 發布與既有簽章；舊報告檔案刪除工作；9/10 已關閉的兩個效率候選及其封存實驗。它們的歷史保留；新的依賴或證據缺口已由 U07–U18 單獨承接，不把先前完成的工作再包裝成新進度。

## 8. 本次計畫審查與資料來源

修訂 1 的 phase45 審查已完成；本次 phase46 按使用者擴大整合要求重新盤點與討論，以下裁定取代上一稿允許部分舊義務排除在 COMPLETE 外的規則。真正的 Claude Code 使用 `claude-opus-5`／`xhigh`，先唯讀提出兩項實質反對；Codex 採納後，又針對 legacy 資格及 AC138 的推論提出修正，Claude 回覆接受。最後完整草稿審查結果為「一項必要補正，其餘接受」：A2 缺少不可達引用的修正工作。Codex 採納並補 AC-B17，完成最後複查；不把條件接受描述成 Claude 又重讀了一遍補正後全文。產品程式未修改。

| 討論項目 | 最終裁定 |
|---|---|
| 完整 intent-scan 與 activation 可否分開後不實作 | Claude 反對，Codex 採納：trigger 是已核准規格的一部分，C3 必須實作或先正式 amendment；共用 governance core 先行解除 TP／scan 循環。 |
| C2 可否靠 tests／harness 完成 | 不可；新增 AC-C10，必須由 model main thread 與真正 arbiter 完成指定 TP 流程。 |
| Tier 1 是否可以等 F 才處理 | 不可；它現在已存在。A 記錄 capability，B 以 unsupported diagnostic 處理過渡，不未經決議改為 opt-in。 |
| E1 只驗 non-TP 是否足夠 | 不足；carrier amendment 後必須重驗 TP-active 的實機交付與必要負例。 |
| L3 是否無條件必跑 | Claude 反對，Codex 採納：沒有合格候選就不跑，記 NOT RUN／upstream BLOCKED；bounded NOT ADOPTED 不等於 broad L4 或 master 完成。 |
| Type-B 是否一定要新版 runId | Codex 修正 Claude 的說法，Claude 接受：需獨立可驗證的唯一關聯，另查舊 scope／usage 完整性；linkage 規則在 outcome 前固定。 |
| AC138 是否已證明違規解鎖 | 未證明。雙方同意以後來 artifact／CLI、D11／final acceptance 對位六前置與 AC，補 status 對帳；不因沒有 AC 編號就推論未實作或命令 rollback。 |
| 必要義務能否排除以宣告完成 | 不可。D4／E4、完整 C3、D5／D6 納入 master；缺資料只准部分里程碑完成。F／H 是新構想的決策 gate，與既有義務分開。 |
| 最後草稿是否漏掉 agent 引用修正 | Claude 指出 A2 只有盤點，Codex 同意並補 B5／AC-B17：不可達的必要引用有實作 owner，未驗可達不算完成。 |
| 初始支持判斷與實機證據 | 舊 D11 review 有支持判斷；當前 plan 要求明確、版本化的實機觀察，不稱先前設計必然壞掉。 |

本輪已複查工作範圍、已接受／未完成分類、依賴與完成規則；沒有聲稱已讀完每個 test body 或完成全部規格的逐 AC 證明，這項實作前／里程碑前核對明列 C4，任何未證條目仍未結。修訂 2 的 UTF-8／control-character、37 個本機連結、U01–U22 唯一連續編號、R1–R9 去向、三個里程碑及 whitespace 檢查通過；原效率 roadmap 除導覽註記外，歷史本文不變。乾淨副本的 plugin／extension structure validation 通過。工作區先前 structure scan 受既有 `.ctide/collaboration/*.log` 暫存檔影響，未刪除它們；驗證使用乾淨副本。這輪只改計畫，沒有修正產品、重跑全套 code regression、commit、push、tag 或 release。

技術依據除上方 repo links，還包括 2026-09-11 已查閱的官方文件：[Opus 5 prompting](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5)、[subagents](https://code.claude.com/docs/en/sub-agents)、[hooks](https://code.claude.com/docs/en/hooks)、[Workflows](https://code.claude.com/docs/en/workflows)、[commands](https://code.claude.com/docs/en/commands)、[models](https://platform.claude.com/docs/en/models/overview)。這些文件支持 runtime 與候選方向判斷，不構成 Cressetide 本身的節省／成效證據；實作時對變動的 host 契約再驗證。
