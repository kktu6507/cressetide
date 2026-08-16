# Test-Provenance Implementation Spec

- 狀態：**draft v1.14 — 未審核**（2026-08-16 由使用者明確核准起草本次 spec-only closure；**尚未 promotion、未經 panel 放行、未經使用者核准為 approved**）。**最後 approved baseline 仍為 test-provenance approved v1.13，未撤回、未取代。** **current approved coupled set 仍為 shared approved v1.14 ＋ intent-scan approved v1.10 ＋ test-provenance approved v1.13**；candidate 對位則為 **shared v1.14 ＋ intent-scan v1.10 ＋ test-provenance draft v1.14**。**v1.14 只有在後續另行 promotion 後才會成為 coupled set 的生效版本；在此之前其新增契約一律不得實作。** **v1.14 delta**：一處，為 §6 rule 1「`(path, structuralId)` 相等 → **modified／retagged**」的**選言未收斂** —— 配對成功之後，既有 approved 文字**從未**決定同一對 declaration 該落在 `modified` 還是 `retagged`，兩個都說得通的 producer 會對同一份 preimage 寫出不同的 persisted status。**已自行核對的前提**：上游 shared approved v1.14 只擁有 `ChangedTestInventoryV2` 的 persisted envelope 與 raw duplicate-member contract，**不擁有** entry status classification（`modified`／`retagged`／`moved`／`governance-affected` 在該文件出現 0 次），因此本文件 §6 是這六個 status 的**唯一** authority；而 `bodyDigest(tree) ＝ sha256(canonical JSON { declarationDigest, effectiveOracleDigest })` **已經**同時承載「declaration 本體變動」與「effective-oracle closure 變動」，所以本版**不新增** `oracleChanged` persisted field、alias、migration record、第二套 digest 或任何自由格式 metadata。本版在 §6 matching 之後新增**唯一、有序**的 **paired-declaration classification** 演算法（added／deleted residual → `moved` → `modified` → `retagged` → `governance-affected` → 省略），每個 logical test **至多一筆 entry**；並在 §6 schema 不變量新增兩條 **reader 可機械驗證**的 observable invariant（`modified` ⇒ 兩個 body digest 不同；`retagged` ⇒ 兩個 body digest 相同且 tag 不同），同時明寫 reader 單憑一筆 entry **無法**重建 base path、matcher relation、完整 preimage 或 governance reverse closure，那些仍由 producer 對 captured preimage 負責。同輪在 effective-oracle 段落補一句交叉引用：oracle dependency 變動**不建立**額外分類訊號，它經由 `bodyDigest` inequality 進入上表，因此 same-path 的 oracle-only change **必為** `modified`；而不在 `effectiveOracleDeps` closure 內的 SUT-only change **仍不得**使 test 成為 `modified`（AC109／AC147 **不弱化**）。同輪**新增 AC169–AC170**；**AC1–AC168 的編號與文字一字未動**。**本版只閉合 classification authority**：**不代表** populated inventory producer 已實作；**不得**接受 populated inventory；**不得**解除 `unsupported-populated-inventory`；**AC118／AC136／AC137／AC138 一律不得宣稱已滿足**；**Phase 2 不得宣稱 READY**。既有的 base／head matcher、`AdapterContentView`、`DiscoveryAnalysisPreimage`、canonical v2 reader 與 S3 component acceptance **一律不撤回**；但 canonical reader 若要宣稱符合日後 promoted 的 v1.14，**仍須另行 remediation 與獨立審查** —— 本 spec-only commit **不修改任何 implementation**。 **以下為 approved v1.13 及更早的既有狀態敘述，原文保留：** **approved v1.13**（2026-08-15 由使用者明確核准；前置 draft 內容已由獨立 Codex 審查並 ACCEPT；**本次未執行 agent-duel panel，因此不稱為 panel 放行**）。前一 approved baseline 為 **test-provenance approved v1.12**。**current approved coupled set 現為 shared approved v1.14 ＋ intent-scan approved v1.10 ＋ test-provenance approved v1.13**；三者為同一生效集合，不得分開採用。**本次 approval 只涵蓋 spec authority。**commit `898f81c` 的 base／head declaration matcher **不因本次 promotion 成為 ACCEPT，也不因本次 promotion 被修復** —— 該 promotion-time boundary **不撤回**，`898f81c` **單獨看仍是 provisional、known nonconforming、未 ACCEPT** 的實作。**promotion 之後**（status，非 normative；截至 2026-08-15）：matcher 已由 `a3ad6dd` 依 approved v1.13 完成 residual-side exclusivity remediation、再由 `5f339a9` 恢復既有 `E_PAIR_IDENTITY` error carrier 並補上其 regression evidence，**最終由 `a3ad6dd` ＋ `5f339a9` 收斂出的 matcher component 已另行通過獨立審查並 ACCEPT**。**這是 promotion 之後才另行取得的 implementation acceptance**，**不得**倒寫成 v1.13 promotion 自動造成，**也不得**宣稱 `898f81c` 單獨獲得 ACCEPT。`modified`／`retagged` 的 classification authority **仍未定案**，matcher 也未決定它。其餘 rollout／gate 邊界一律不變。 **v1.13 delta**：一處，為 §6 rule 3 與 §2／§11b.8「結構重整不得降級成 added＋deleted」之間的**直接對撞** —— 兩個都說得通的 writer 對同一份 preimage 會得出不同輸出，而既有 approved 文字無法唯一決定。**已實測重現**：base `a.test.mjs` 帶 `s:["old-container","same-test"]`、head 同 path 帶 `s:["new-container","same-test"]`，tag 與 bodyDigest 完全不變 —— §6 rule 3 逐字套用得到 **added ＋ deleted**，§2「仍無法唯一配對 → fail-closed（不得猜測，也不得降級成 added＋deleted）」與 §11b.8「不得降級成 added＋deleted」則要求 **fail-closed**。本版以**可機械判定、且不猜測**的 **residual-side exclusivity gate** 閉合：Phase 1（exact）與 Phase 2（moved）**完全不變**，Phase 3 改為只在 residual **單側存在**時才產生 added／deleted；**兩側同時仍有 residual → `unresolved-identity-drift`，整輪 fail-closed**，不回傳 partial pairing、不以 path／bodyDigest／tag／framework／identity／宣告順序／筆數猜測對位。理由：同一份 observable preimage 可同時代表「container rename／nesting change 造成的 structuralId drift」與「真正的 delete ＋ add」，現有 carrier **無法**區分兩者，而 §2／AC36 明文禁止猜測與降級。**已知代價，刻意接受**：真正需要在同一輪同時 delete 與 add 的變更，必須拆成兩個以不同 base 為界的 run，使每輪 residual 只存在一側；**不得**為了便利而放寬本 gate。同輪釘死 **`@tid` rescue 的 exact boundary**：只有當同一 literal `tid:<ID>` **在 base 已存在**且於 head 保留時，才構成合法 same-path／moved pair；**只在 head 新增 `@tid`（base 仍為 `s:…`）不是 adoption proof、也不是合法 bridge**，兩者仍各自落入兩側 residual 而 fail-closed —— 理由是 §11b.10b 的 preimage 只保留最終 `structuralId`、`tag` 與 `bodyDigest`，既無 alias／adoption carrier，§11b.8b 又刻意把 `@tid` 排除在 `bodyDigest` 之外，因此 head 單方面新增的 `tid:` **在可觀測資料上無法證明**它與哪一筆 base declaration 是同一 identity。本版**不新增** alias carrier、migration record、persisted field 或新的 inventory status。同輪**修改 §2 結構重整段、§6 matching block、§11b.8「其餘性質」、AC36、AC104**，**新增 AC167–AC168**；其餘 AC 編號與文字一字未動（含 AC138 與 AC166）。**本版只閉合 residual matching 與 `@tid` 採用邊界的 authority**：**不代表** matcher remediation 已實作 —— commit `898f81c` 的 base／head declaration matcher **仍是 provisional、未 ACCEPT**，且在 v1.13 下**已知不符**（它對上述 fixture 輸出 added＋deleted）；`modified`／`retagged` 的分類問題**本版不處理、也不順手決定**；populated inventory producer、governance reverse closure、artifact emission 與 Step 5／6、ledger、arbiter wiring 一項都未完成；**不得**接受 populated inventory；**不得**解除 `unsupported-populated-inventory`；**AC118／AC136／AC137／AC138 一律不得宣稱已滿足**；**Phase 2 不得宣稱 READY**。 **以下為 approved v1.12 及更早的既有狀態敘述，原文保留：** **approved v1.12**（2026-08-14 由使用者明確核准；前置 draft 內容已由獨立 Codex 審查並 ACCEPT；**本次未執行 agent-duel panel，因此不稱為 panel 放行**）。前一 approved baseline 為 **test-provenance approved v1.11**。**current approved coupled set 現為 shared approved v1.14 ＋ intent-scan approved v1.10 ＋ test-provenance approved v1.12**；三者為同一生效集合，不得分開採用。 **v1.12 delta**：三處，皆為「base-tree immutable content view ＋ adapter discovery」實作前的 authority 缺口 —— 兩個都說得通的 writer 會對同一個 repo 得出不同輸出，而既有 approved 文字無法唯一決定。(A) **§11b.4 candidate universe**：舊文只定義單一 path 的 discovery 函式，並把「三級皆無 evidence」一律讀成 **whole-run fail-closed**，卻從未定義**哪些 path 會被送進該函式**；逐字套用會讓任何一個普通 helper module 使整輪失敗，而 §11b.3 早已刪除唯一的 path predicate 且禁止以 registry 欄位復活它。本版新增 closed 的 **probe universe** 與 **candidate universe** 兩層，並把 discovery 的 logical output 改為三值 **`adapterId | not-a-candidate | fail-closed`**；`.mjs`／`.js` suffix **只**決定是否做 AST import-evidence probe，**不是** framework evidence、**不是** adapter selector、**不是** registry pattern ID —— `filePatternIds` 與 `mjs-test-suffix` 均不得復活。(B) **§11b.10 AdapterContentView**：舊文只說「base view ＝ 那棵 exact immutable Git tree」，沒有定義交給 adapter 的 carrier shape，也沒說 base 是否套用 head 的 hard exclusion／`.gitignore`，更沒說 symlink 是「在 view 內但被拒」還是「不在 view 內」。本版新增 branded、in-memory 的 **`AdapterContentView`**（`size`／`paths()`／`has()`／`entry()`／`read()`），base 與 head 共用同一 interface，並明定 base projection、head projection 與 entry type 的消費規則；既有 canonical map 與 `headViewDigest` 公式**完全不變**。同輪把 explicit-config carrier 依 base／head **分層**：base 以 tree membership ＋ blob 為 committed carrier，head 完整保留 v1.11 的 tracked 規則，`registryDigest` 仍**只**含 head explicitConfig。(C) **§11b.10b DiscoveryAnalysisPreimage**：新增純 in-memory、非 persisted 的 exact 契約（request 恰為 `{ repoRoot, baseTreeOid }`），定義 root／module／declaration 的 exact key set、canonical ordering、deep freeze、跨 view adapter 分歧的拒絕層級與 no-partial-result 邊界。 同輪**修改 AC28、AC87、AC88、AC89、AC90、AC92、AC93、AC133**，**新增 AC163–AC166**；其餘 AC 編號與文字一字未動（含 AC138）。 **本版只閉合 candidate universe、adapter-facing view 與 discovery-analysis preimage 的 authority**：**不代表** populated inventory producer、base／head one-to-one matcher、governance reverse closure、artifact emission 或 Step 5／6、ledger、arbiter wiring 已實作；**不得**接受 populated inventory；**不得**解除 `unsupported-populated-inventory`；**AC118／AC136／AC137／AC138 一律不得宣稱已滿足**；**Phase 2 不得宣稱 READY**。 **以下為 approved v1.11 及更早的既有狀態敘述，原文保留：** **approved v1.11**（2026-08-14 由使用者明確核准；前置 draft 內容已由獨立 Codex 審查並 ACCEPT；**本次未執行 agent-duel panel，因此不稱為 panel 放行**。前一 approved baseline 為 **test-provenance approved v1.10**）。**current approved coupled set ＝ shared approved v1.14 ＋ intent-scan approved v1.10 ＋ test-provenance approved v1.11**；三者為同一生效集合，不得分開採用。 **Live implementation-status addendum（截至 2026-08-15；status carrier，非 normative algorithm）** —— **這是最新現況；本行其後保留的 2026-08-13 addendum 描述的是當時的狀態，已不再是 current-state carrier。** 除先前已接受的 adapter registry、parser／gitignore wrapper、node-test-v1 component 與 HeadViewSnapshot S1／S2 ＋ `headViewDigest` 之外，另有五項**已另行實作、修正並經獨立審查接受**：**(1) canonical v2 inventory reader**（commit `52fe0e0`，其後由 `4f44b6e` 修正為「v2 envelope 一律停在 consumer gate 之前」，產品 populated gate 保留）；**(2) S3 source-freshness component**（commit `711ec14`，其後依 approved v1.11 由 `d2a5319` 完成 registry／config carrier remediation；`f0681df` 只對齊 authority 註解，不改行為）。**(3) AdapterContentView（§11b.10 的 base／head content view）**（commit `87cf425` 為初始 component，其後由 `54e4581` 與 `28562b6` 收斂其 trust boundary）—— 提供**共用且不可偽造的 content-view brand**（node-test-v1 component 不再自持第二個 brand）、**`baseTreeOid` 所指 exact immutable tree 的 base projection**（bytes 只從 object database 取得，不 checkout、不讀同名 live worktree 檔案；refs/replace 與 partial-clone lazy fetch 皆關閉，且以 command-line option ＋ environment 雙重施加，缺失的 promisor object **fail-closed 而不下載**）、**對已捕捉 HeadViewSnapshot 的 head projection**，以及**以 HeadViewSnapshot 既有 WeakSet identity 建立的 real brand bridge**（成員齊全的 caller-crafted snapshot 無法被 launder 成 branded view）；**(4) DiscoveryAnalysisPreimage（§11b.10b）**（commit `87cf425`，AC165 要求的 executable evidence 由 `54e4581` 補齊）—— 以 exact request `{ repoRoot, baseTreeOid }` 提供 **candidate discovery**（§11b.4a–4c 的 probe／candidate universe 與三值輸出）、**base／head 各自的 adapter-facing content view**，以及 **declaration-analysis preimage**。**(5) base／head one-to-one matcher（§6 matching）**（commit `898f81c` 為最初的 provisional implementation，其後由 `a3ad6dd` 依 approved v1.13 完成 residual-side exclusivity remediation，再由 `5f339a9` 恢復既有 `E_PAIR_IDENTITY` error carrier 並補上其 regression evidence；**已接受的是 `a3ad6dd` ＋ `5f339a9` 收斂出的 component，`898f81c` 單獨並未獲得 ACCEPT**）—— 保留 Phase 0 stable-ID uniqueness、Phase 1 exact `(path, structuralId)`、Phase 2 unique moved；**Phase 3 只在 residual 單側存在時**產出 added／deleted，**base／head 兩側 residual 同時非空即以 `E_UNRESOLVED_IDENTITY_DRIFT` 整輪 fail-closed**，**不回傳任何 partial pairing**（已成立的 exact／moved pair 亦不回傳）；**head 單方面新增的 `tid:` 不得收養或 bridge base 的 `s:`**；`E_PAIR_IDENTITY` 的既有 message 與 detail carrier **原樣保留**。**它只輸出 one-to-one matching relation，並未實作、也未決定 `modified`／`retagged` classification**；**尚未 product-wired**，**也不是** populated inventory producer。**(3)(4) 是 v1.12 promotion 之後才另行取得的 implementation acceptance**，**不得**倒寫成 v1.12 promotion 當時即已實作 —— AC166 記錄的正是 promotion 當下「不因本次 promotion 成為已實作或 ACCEPT、仍須另行取得 component implementation 授權並通過獨立審查」的事實，該記錄**仍然成立**。**(3)(4) 是 producer／matcher 的 foundation，本身不是 producer／matcher**，下方「仍未完成」清單**不因它們縮短**；**(5) 則是其後另行接受的 matcher 本身**，因此「仍未完成」清單中僅 `base／head one-to-one matcher` 一項移除。**(3)(4)(5) 三者都不是 populated inventory producer**，也都不使它自動完成。**(1)(2) 這兩項 acceptance 都是後續 implementation review 的結果，不是 v1.10／v1.11 spec promotion 自動造成的** —— 特別是 `711ec14` 在 v1.11 promotion **當下確實仍是 provisional、未 ACCEPT**（AC162 記錄的即是該事實，仍然成立），是其後的 remediation 才被接受。**已接受的 S3 範圍僅止於 §11b.9c 的 source-freshness 重算**：當下 HeadViewSnapshot S3 capture、每次 invocation 重讀 shipped registry、tracked explicit-config carrier、registry／config raw duplicate 拒絕、`headViewDigest`／`registryDigest` 比對與 mismatch evidence，且**不讀、不比較 provenance store**；它**不是**完整 Step 6，**也尚未** wired 到 populated inventory consumer。**仍未完成**：populated inventory producer、governance reverse closure、artifact emission，以及 Step 5／6、ledger、arbiter wiring。因此 `unsupported-populated-inventory` gate **仍為必要且不得解除**，populated inventory **仍不得接受**，**AC118／AC136／AC137／AC138 一律不得宣稱已滿足**，**Phase 2 不得宣稱 READY**。本 addendum **只更新 implementation status**，未改動任何 normative algorithm、AC 或 coupled-set 版本。 **v1.11 delta**：三處，皆為 S3 source-freshness 的 registry／config carrier authority 缺口 —— 兩個都說得通的 reader 會得出不同結果，而既有 approved 文字無法唯一決定。(A) **§11b.9c**：`registryDigest` 的 registry 半邊必須是**當下**的 shipped registry —— 每次 S3 invocation 重新讀取一次，schema validation 與 digest preimage 用**同一次讀取的同一個 parsed root**，且**不得**跨 invocation 沿用 cached root／descriptor／digest（一般 adapter loader 自己的 cache 不因此撤回，但不得充當 S3 的 current observation）。(B) **§11b.4 ＋ §11b.10**：`.ctide/test-adapters-config.json` 只有 **tracked** 時才是合法 explicit-config carrier；`tracked` 定義為該 path 位於**本次 snapshot 捕捉的 Git index stage-0 path set**，並由 §11b.10 明定為 snapshot 的 immutable metadata（唯一 carrier `entry(path).tracked`），**不進** canonical map、**不改** `headViewDigest` 公式；並以獨立的 **`configCarrierState`**（absent／untracked／tracked）併入 **S1／S2 穩定條件**，使「S1、S2 之間只翻動 config 的 tracked 狀態」不再對 stability gate 隱形 —— 該 carrier **不進** fingerprint、**不進** `headViewDigest`、**不新增** persisted inventory 欄位。同輪修正由此暴露的一項**規格矛盾**：真實 consuming project 幾乎都以 `/.ctide/` 之類的規則忽略整個 `.ctide/`（本 repo 的 tracked `.gitignore` 即是），而舊文無條件的「exclusion 先於 inclusion」會讓**純 untracked 的 config 根本不在 snapshot 內** —— `tracked == false` 因而永遠不可觀測，會被誤讀成「config 不存在」；而一旦 `git add -f`，該 path 才首次進入 canonical map，`headViewDigest` 隨之改變，直接牴觸 AC160。§11b.10 的判定順序因此改寫為 **hard exclusion → exact config-path observability exception → tracked `.gitignore` exclusion → closed inclusion** 四步；該 config path 成為 ignore exclusion 的**唯一** exact-path 例外，**不得**推廣為 `.ctide/**` 或任何前綴，`.git/**`、`.ctide/provenance.json`、`.ctide/output/**` 三項 hard exclusion **不放寬**，其餘被忽略的 path 照舊排除。(C) **§11b.3 ＋ §11b.4**：registry 與 explicit config 的 raw JSON duplicate member **由本文件自持**並一律 fail-closed —— 上游 SM v1.14 的 duplicate-member contract 範圍**不變**，仍只擁有完整 `ChangedTestInventoryV2`，本版不修改 shared spec、也不宣稱它已涵蓋這兩個 carrier。同輪修改 **AC92**、**AC118**、**AC130**、**AC131**、**AC134** 並新增 **AC159–AC162**；其餘 AC 編號與文字一字未動。 **本次 approval 只涵蓋 spec authority；promotion 不修改、不修正也不接受任何 implementation**：commit `711ec14` 的 S3 component **不因本次 promotion 成為 ACCEPT**，仍是 **provisional、未 ACCEPT** 的實作；canonical v2 reader（commit `4f44b6e`）的既有 acceptance **不因本次 promotion 撤回**。**不得**描述為 panel released 或 implementation READY；`unsupported-populated-inventory` 仍不得解除，populated inventory 仍不得接受，**AC118／AC136／AC137／AC138 一律不得宣稱已滿足**，**Phase 2 不得宣稱 READY**。 **以下為 approved v1.10 及更早的既有狀態敘述，原文保留：** **approved v1.10**（2026-08-13 由使用者明確核准；前置 draft 內容已由獨立 Codex 審查並 ACCEPT；**本次未執行 agent-duel panel，因此不稱為 panel 放行**。前一 approved baseline 為 **approved v1.9**）。**current approved coupled set ＝ shared approved v1.14 ＋ intent-scan approved v1.10（內容不變）＋ test-provenance approved v1.10**；三者是同一生效集合，不得分開採用。 **本次核准只涵蓋 canonical-reader 的 spec authority**，不得據此宣稱任何 implementation 自動完成或被接受：**canonical v2 inventory parser 仍未實作**，**populated inventory 仍不得接受**，`unsupported-populated-inventory` gate **仍為必要且不得解除**，producer、base／head one-to-one matcher、governance reverse closure、**S3 consumer freshness 重算**與 artifact emission／wiring 亦一項都未完成；**AC118／AC136／AC137／AC138 一律不得宣稱已滿足**，**Phase 2 不得宣稱 READY**。其餘未實作與 readiness boundary 一律不變。 **v1.10 delta**：只有兩處，皆為 v2 canonical reader 的 authority 缺口 —— (1) **§6 entry exact schema**：entry 的 key set 先前從未被宣告為 closed —— §6「v2 envelope（closed，exact key set）」一語已由 **AC116／AC126 明確界定為 root 恰七欄**，不及於 entry；而 `baseBodyDigest`／`headBodyDigest` 只寫「status ≠ added／deleted 時必填」，並未使用上游 SM 在同類情形固定採用的「其餘一律不得出現」句式，於是「added 仍可帶 `baseBodyDigest`」與「必須缺席」兩種 reader 都成立，且兩者對同一份邏輯 inventory 算出**不同的 `inventoryDigest`**。本版把 common seven、依 status 分派的 exact key set、「必須缺席**不是** `null`」、body digest 的 64 lowercase hex 拼法，以及 `testRef`／clause tag／`EXPL`／`implementationIdentity` 的 nested exact shape 全部定案。(2) **§2 entry source-key ordering**：既有「每個 entry 的 object key 依 code point 排序」未說明是否遞迴、以何種形式比較，本版明定遞迴範圍（entry root、`testRef`、`tagBefore`、`tagAfter`、`implementationIdentity`）、escape 解碼後比較、嚴格遞增，並明確把 root envelope 的 source-key order 與 JSON whitespace 排除於 gate 之外；duplicate member name 由上游 **SM approved v1.14** 在此之前拒絕。同輪新增 **AC155–AC158**，**AC1–AC154 的編號與文字一字未動**。 **canonical v2 inventory parser 仍未實作** —— 本版閉合的是 reader authority（規格），不是 reader 實作；`unsupported-populated-inventory` gate 仍為必要且不得解除，populated inventory 仍不得接受，producer、base／head one-to-one matcher、governance reverse closure、**S3 consumer freshness 重算**與 artifact emission／wiring 亦一項都未完成；**AC118／AC136／AC137／AC138 一律不得宣稱已滿足**，**Phase 2 不得宣稱 READY**。 **以下為 approved v1.9 及更早的既有狀態敘述，原文保留（其中 2026-08-13 的 Live implementation-status addendum **仍然有效**，並由本 v1.10 delta 補上「canonical v2 inventory parser 仍未實作」一句）：** **approved v1.9**（2026-08-12 由使用者明確核准；前置 draft 內容已由獨立 Codex 審查並 ACCEPT；**本次未執行 agent-duel panel，因此不稱為 panel 放行**。前一 approved 版本為 **approved v1.8**，2026-08-10 由使用者明確核准）。**current approved coupled set ＝ shared-decision-provenance-model approved v1.13 ＋ intent-scan approved v1.10 ＋ test-provenance approved v1.9。**本次核准的內容是：§11b.9 snapshot-golden 的 `new URL(<string literal>, import.meta.url)` 之 path literal → canonical repo-relative path 的**唯一** resolution algorithm，該 authority 自即日起生效。**該次核准只涵蓋 spec authority**，本身並未接受任何 implementation：promotion 當下，commit `4585812` 的 node-test-v1 component 仍是待修、未接受的 provisional implementation，且仍接受不帶 `./`／`../` 前綴的 snapshot literal，與當時剛生效的 v1.9 prefix gate 直接衝突，因此必須依 approved v1.9 修正並重新審查。**那是 promotion 當下的事實，不是現況。****Live implementation-status addendum（截至 2026-08-13；status carrier，非 normative algorithm）** —— 上述 remediation 其後已完成，並經**獨立審查**接受。**這是後續 implementation review 的結果，不是本次 spec promotion 自動造成的。** 目前**已實作並已接受**者：**adapter registry**（`test-adapters.json` ＋ `adapter-registry.mjs`，含 closed implementationId → component mapping；registry identity 與 shipped vendor manifest 逐欄相符）、**parser／gitignore 的 authorization、vendoring 與 wrapper**（無 runtime install、無 runtime network；exact identities、members、hashes、wrapper settings 與 resource limits 的**唯一** machine-readable authority 仍只在 shipped vendor manifest，本文件不複製）、**node-test-v1 executable component**（declaration recognition、canonical declaration range／bytes、`structuralId`、`@src`／`@tid` attachment 與 accounting、fixture-hook deps、local assertion helper 與 oracle closure、snapshot-golden resolution、`effectiveOracleDeps`；snapshot prefix-gate 衝突已修正）、**HeadViewSnapshot S1／S2 ＋ `headViewDigest` component**（immutable capture、stable-head-view 比較、environment／config isolation）。**這些 component acceptance 一律不代表** populated inventory producer、v2 canonical inventory parser、base／head one-to-one matcher、governance reverse closure、**S3 consumer freshness 重算**、artifact emission 或 Step 5／6、ledger、arbiter wiring 已完成 —— 六者**一項都未實作**。特別注意：**HeadViewSnapshot 提供的是 S1／S2，不是 S3**。因此 `unsupported-populated-inventory` gate **仍為必要且不得解除**，populated inventory **仍不得接受**，**AC118／AC136／AC137／AC138 一律不得宣稱已滿足**，**Phase 2 不得宣稱 READY**。本 addendum 只更新 implementation status，**未改動任何 normative algorithm、AC 編號或 coupled-set 版本**。**既有歷史的時間界線** —— 本行其後保留的 v1.8、v1.7、v1.6 及更早段落，其中「三項 executable capability 一項都未實作」等敘述描述的是**該次 promotion 當下**的狀態，屬原文保留的歷史紀錄，**不得**讀成現況；現況一律以上方 addendum 為準。**v1.9 delta**：只有三處改動 —— (1) §11b.9 snapshot-golden 契約新增 **snapshot path 的唯一 resolution algorithm**：AST carrier 的逐節點 exactness（未被 shadow 的 `URL`、恰兩個 argument、plain string literal、逐節點 `import.meta.url`），加上 `./`／`../` prefix gate、decoded StringValue、POSIX lexical segment stack、**明文共用**（而非留給實作者類推）§11b.9f 的消解規則，並明文否定 WHATWG URL parsing 與 percent decoding —— `new URL` 在本契約中只是固定的 syntax carrier，不是 resolution authority；(2) **AC108** 的正例由 `"fixtures/golden.txt"` 改為 `"./fixtures/golden.txt"`，並補上 decoded StringValue、module-relative lexical resolution、exact `import.meta.url`，以及「不用 process cwd／不讀 live filesystem／不用 WHATWG URL resolution」三項；(3) 新增 **AC153**（可區分兩個錯誤 writer 的 executable matrix）與 **AC154**（approval／implementation boundary）。**AC108 是本輪唯一被修改的既有 AC**；**AC1–107 與 AC109–152 一字未動**，其中 **AC138／AC151／AC152 逐 byte 相同**；§11b.9 以外的 normative 演算法未改；intent-scan 的 canonical ULID authority **未被複製也未被重定義**；**本輪未執行 panel**。**v1.8 delta**：本輪**只做兩件事** —— (1) §2 的 `clauseRef`／`dpRef` 中那個 `ULID` 改為**唯一引用 intent-scan approved v1.10 §8** 的 canonical ULID grammar，本文件**不複製**第二份 alphabet 或 regex authority；(2) 新增 **AC151**（adapter 對 canonical ULID 的 accounting：三條正例，以及 overflow／長度／case／alias／whitespace／非 ASCII／suffix 等十五條必須 fail-closed 的 candidate 負例）與 **AC152**（approval／rollout boundary）。**本輪不代表 node-test-v1 executable component 已實作**；**截至該次 v1.8 promotion 當下**，`structuralId`、tag attachment、`effectiveOracleDeps` 三項 capability **一項都未實作**（其後的 current status 見本行的 live implementation-status addendum）；**AC136／AC137／AC138 仍未滿足**；`unsupported-populated-inventory` **仍不得解除**；**不**代表 Phase 2 READY。**AC1–150 的編號與文字一字未動**，AC138 未弱化；本輪**未修改任何程式或測試**。current coupled set：**shared-decision-provenance-model approved v1.13（內容未變）** ＋ **intent-scan approved v1.10** ＋ **test-provenance approved v1.8**。以下為 v1.7 及更早的既有歷史，原文保留：**approved v1.7**（2026-08-10 由使用者明確核准；前置 draft 內容已經過獨立 Codex 審查；**本次未執行 agent-duel panel，因此不稱為 panel 放行**。前一放行版本為 **approved v1.6**，2026-08-09 panel 放行）。**本次核准只涵蓋 spec authority**：它**不**代表 implementation READY，**不**代表 AC136／AC137／AC138 已滿足，**不**使 populated inventory 可被接受，**不**解除 `unsupported-populated-inventory`，**不**代表 Phase 2 READY；三項 executable capability（`structuralId`、tag attachment、`effectiveOracleDeps`）在本版之後仍**一項都未實作**。**v1.7 delta（authority closure，只補規則，不新增能力）**：v1.6 之下，兩個獨立 writer 對 node-test-v1 的 executable adapter **不可能**算出相同結果 —— declaration 長在哪裡、帶什麼參數才算 declaration 沒有規則；attachment block 的掃描與 `@src`／`@tid` 的 lexical form 只有敘述；`declarationDigest` 的 range 沒有指名 AST node；fixture hook 的「body span」與「同 container chain」都不足以決定一組 depRef；local-assertion-helper 的「可靜態解析的函式」是個沒有演算法的占位詞，跨 module 更沒有 resolver。本版新增四節把這些收斂成 closed 規則：**§11b.6b**（declaration placement、test／container／hook 的 argument 與 callback profile、以 decoded StringValue 為 declaration name）、**§11b.8c**（attachment block 的 maximal 掃描、directive accounting、`@src`／`@tid` 的唯一 lexical form、`REQ@DP` 的 adapter／pipeline 分層、canonical declaration range 取最外層 `ExpressionStatement`）、**§11b.9e**（fixture-hook 的 byte-range span 與 closed applicability）、**§11b.9f**（local-assertion-helper 的 callable 子集與 closed relative-module resolver）。新增 **AC139–150**，每條都帶可區分錯誤實作的單變數正／負例。**`REQ@DP` 的最終合法集合未放寬** —— 分層只改變拒絕發生的層級（DEC／ASSUM qualifier 仍由 adapter 直接拒絕；非 exception-backed 的 REQ 由 pipeline 以同一份 captured store pre-state 在 entry emission 之前拒絕）。**AC138 的 gate 未弱化**，`unsupported-populated-inventory` 仍不得移除，三項 executable capability（`structuralId`、tag attachment、`effectiveOracleDeps`）在本版之後仍**一項都未實作**。以下為 v1.6 及更早的既有歷史，原文保留：**approved v1.6**（2026-08-09 panel 放行；前一放行版本 approved v1.5）。實作以本文為準；變更需重新過 panel。本版與 **shared-decision-provenance-model v1.13**、**intent-scan v1.9** 為 **coupled set**，2026-08-09 panel 同輪一併放行；三者不得分開採用。 **本次放行只核准規格本身**，不代表 implementation、populated inventory、migration、push 或 Phase 2 已就緒；AC138 的限制持續有效 —— AC128 的 legacy boundary 尚未實作並通過前，不得宣稱 Phase 1／2A 完全不受影響。 v1.6 **只補 authority，不授權任何 dependency，也不宣告任何實作就緒**：Phase 2B1 的 direct inspect 證實 §2 的 adapter 契約在形式上無法落地 —— `structuralId(decl)` 是函式卻被要求序列化進 `test-adapters.json`，`testDeclarationPatterns`／`containerPatterns` 只有欄位名而無語言，`attachmentRule` 只有四個字詞而非 closed enum，明示穩定 ID 被整個委派給一個不存在的 adapter，effective-oracle 只有例子而無 closed edge contract，base/head content view 從未定義。新增 **§11b**（registry exact schema 與 closed pattern-ID table、`implementationId` 綁定表、discovery precedence 與 explicit-config carrier、`attachmentRule` closed enum 與 tag cardinality、node:test v1 profile 含 `node:assert`／hook import form、stable-ID `@tid` 實際語法、`structuralId` 演算法、`@tid` canonical-byte 排除、兩類 oracle edge 的 closed table、`implementationIdentity` per-entry carrier、HeadViewSnapshot S1／S2 協定與 ignore authority、parser 能力契約與 rollout boundary）與 **AC84–138**。**第二輪修訂（panel REVISE 後）**再閉合七處：tag cardinality 改為恰好一筆 `@src`（與 §2 一致，不再允許多筆並正規化）；pattern ID 由欄位名補成有 predicate 的 closed table 並綁定 `node-test-v1`；`implementationIdentity` 由散文落成 inventory entry 欄位並經 `inventoryDigest` 進 freshness；移除詞法序號消歧（前插同名 test 會靜默錯配 identity），duplicate name 一律要求 `@tid` 且 uniqueness scope 擴至 matching universe；oracle edge 拆成 traversal 與 oracle dependency 兩類，SUT import 不再進 closure；head 讀取改為 S1／S2 原子 snapshot 並明定 ignore authority；`@tid` 的 digest 排除補上 exact bytes 演算法。**第三輪修訂（panel REVISE 後）**再閉合七處：`implementationIdentity` 補上 **registry 側** carrier，並撤回「已可完整寫出正式 registry」的宣稱；新增 **v2 versioned inventory envelope**（`inventoryVersion`／`registryDigest`／`headViewDigest`）與 consumer 的 **S3** 完整-universe freshness 協定，legacy v1 以顯式 discriminator 拒絕、`entries: []` 不得成為 populated coverage bypass；`node-test-v1` 的 mapping 收斂為唯一組合，`.test.mjs` 降為 eligibility filter 而非 framework evidence；assertion 名稱與 snapshot-golden 的 fs API／path 形式各補 closed allowlist，並誠實寫明結構分類會把任何含 assertion 的 reachable callable 保守視為 oracle contributor；stable-ID uniqueness 改為 base／head **分別**檢查；canonical bytes 在建立 range **之前**先正規化行終止符；gitignore 語義列為與 AST parser 同一次 dependency authorization 的能力。**第四輪修訂（panel REVISE 後）**再閉合五處：以 direct inspect 上游 store 的 CAS 為據，把 **source freshness** 與 **provenance-store freshness** 分離 —— `headViewDigest` 取得 closed 的 exclusion／inclusion 規則並排除 `.ctide/provenance.json`，store 的新鮮度改由新欄位 `inputProvenanceStoreDigest` 承載並進入 `inventoryDigest`，其上游 precondition 為 intent-scan draft v1.9 的必填 payload 欄位 `expectedInputProvenanceStoreDigest`（該輪同時宣稱「shared model 不需修改」，**已於第五輪撤回**，見下）；assertion binding 分為 assertion-object 與 assertion-function 兩類，strict alias 明列；死 token `mjs-test-suffix` 與 `filePatternIds` 欄位一併刪除；半開的 `external-expected-data` edge 與未授權的 re-export capability 各自移除；version dispatch 改為誠實表述（v2 有 explicit discriminator，v1 只能以 exact absence shape 辨識），`registryDigest` 亦改為涵蓋整份 registry root 與 head-view config 的唯一公式。**第五輪修訂（panel REVISE 後）**閉合最後一個綁定缺口：前一稿宣稱 `expectedInputProvenanceStoreDigest` 已由 `inventoryDigest` 遞移持久化、Step 6 可事後證明 pre-state、shared model 不需修改 —— **三項宣稱全數撤回**。`inventoryDigest` 是 opaque 值，caller 可讓 payload 追上實際 pre-state（D1）卻仍送出以 D0 為 preimage 的舊 digest，writer 兩段等式都驗得過而事後查不出。修正是把 **preimage 本身持久化**：`batchSnapshot` 新增完整 typed **`inventorySnapshot: ChangedTestInventoryV2`**（唯一 authority），`record.inventoryDigest` 由它派生，writer 在同一筆交易內重算並強制三段等式，Step 6 改讀該 snapshot 重播綁定。持久化欄位屬上游 record 形狀，因此 **shared model 一併退回 draft v1.13**、intent-scan 續為 **draft v1.9**。**第六輪修訂（panel REVISE 後）**收尾五處：intent-scan 仍是 live normative text 的舊宣稱（opaque digest 足以證明 pre-state、shared 不需 persisted field）**刪除**；§6 的 freshness 明定為 **Step 5 前 proposal-time**，checker 分層表改為分階段，**禁止**把 current-inventory 重算引入 post-commit（正常 D0→D1 提交會被誤判 stale）；上游新增 **`batchRecordVersion` discriminator** 與 legacy boundary（legacy 可讀範圍、不得冒充 Phase 2 proof、v2 缺 snapshot／未知版本／malformed 一律 fail-closed、chain 版本單調不減）；Step 6 的事後證明改為**誠實劃界** —— 可重算 snapshot digest 與 derived equality、可視 snapshot 為 committed witness，但**不能**獨立重新觀察歷史 `loadedStoreDigest`／payload，也不能只憑 digest 判斷其記法；`inventorySnapshot` 的最小 authoritative envelope **上提至 shared**，本文只保留計算語義。§11b.11 的 dependency 段落為 **non-normative 且未核准**。**核准後 `parseInventory()` 的 populated gate 仍不得移除**（解除條件見 §11b.12 的六項）；本版亦不改動 Phase 1 與 Phase 2A 既有的 READY 狀態。前一放行版本說明：approved v1.5（2026-08-08 panel 放行；前一放行版本 approved v1.4）。實作以本文為準；變更需重新過 panel。v1.5 **確有語義變更**（初稿宣稱「不改任何語義或 AC」，那已不誠實）：(1) 本文消費的 **canonical empty store** 改為上游 SM §2 的唯一定義，其 `provenanceVersion` 為 **2**；(2) `baseProvenance` checker 對 **historical immutable base-tree store** 新增明確的 read-only 版本行為 —— 該 tree 的 store 可能是 v1 或 v2，checker 驗其**原始** bytes 的 `storeDigest`，**不遷移、不回寫**，也不得拿 normalized bytes 比對 raw digest；current store 的版本與它無關；(3) **AC60 已改寫**，新增 historical v1／v2 的版本分支（原始 bytes digest 優先、normalize 不得充當比對依據、historical v1 不遷移不回寫、無 store 檔時引用上游唯一的 v2 canonical empty store）；current v1 的 migration 仍由 intent-scan AC89 負責，兩條路徑不得混用。上游 v1.12 已於同輪核准，本文連同該版本邊界一併放行。前一放行版本說明：approved v1.4（2026-08-02 panel 放行；前一放行版本 approved v1.0，2026-07-26 panel 放行，自 draft v0.10 經九輪修訂）。實作以本文為準；變更需重新過 panel。**曾退回 draft 的原因**：v1.0 的 `assum-reading-change` 路徑要求「本 run 內產生 revise Transition」，而 revise 的 successor 依定義是尚不存在的新 clause；姊妹 spec intent-scan v1.2 同時寫死「`commit-test-provenance-batch` 不得鑄造任何 clause」，兩者合起來使該路徑**形式上不可達**。v1.1 隨 intent-scan v1.3 的 `successorClauseDraft` 補齊 **ASSUM successor** 的 Step 5 與 AC。v1.2 續修兩處：(1) §6 與 Step 4b 把 `ASSUM.governedBy` 當成可以是 `user`／`plan-gate` 的分支條件 —— 它的型別是 **ReviewerPrincipal**（discipline | arbiter），該比對恆為 false，會讓 REQ 的退出重審路徑**靜默失效**；改以 **`transition.successor`** 決定是否退出，`governedBy` 只決定 reviewer-side principal；(2) 隨當時的 intent-scan v1.4 補上 `ASSUM|DEC supersede → REQ` 的端到端 AC，與 sibling 聚合／重複 subject／carrier 覆蓋的負向 AC（AC76 改寫，新增 AC77 起）。v1.3 修 v1.2 草案一處：Step 5 正文仍把 `successorClauseDraft` 敘述成只鑄造 successor ASSUM，與已放寬的 REQ 契約不符；改寫為**通則**（不在 pre-state 即必須帶 draft；ASSUM 驗 `routingOrigin` 等義務；REQ 驗 rule 6 的 user／plan-gate／四欄／tier 義務；其他 clause 類型未授權即 fail-closed），並補 `DEC → 新 REQ` 的完整成功 AC 與 adopt 的正向 carrier AC（新增 AC78、AC80，其後順延至 AC83）。v1.4 修 v1.3 草案一處：§8 的 typed transaction summary 仍寫「revise group 帶 `successorClauseDraft`（鑄造 successor ASSUM）」，位置在契約摘要而非歷史註解，會把已放寬的合法 REQ successor 重新說窄；改為與 Step 5 完全一致的通則。草案審閱期間，本版新增契約不得實作；該限制已隨 v1.4 核准解除。
- 日期：2026-07-25
- 上游：`2026-07-25-shared-decision-provenance-model.md`（**approved v1.14**；shared v1.14 與 test-provenance v1.10 於 2026-08-13 由使用者**同步明確核准**，**並非 panel 同輪放行**）—— 提供 gate scope、pre／post binding 兩相、**base provenance witness**、`provenance-batch` record kind 與 chain head 規則。不重新定義任何 shared concept；附加欄位一律標為 annotation 且不改上游語義。inventory 欄位對映上游語義：`tagBefore → preChangeBinding`、`tagAfter → postChangeBinding`。
- 姊妹 spec：`2026-07-25-intent-scan-spec.md`（**approved v1.10**，2026-08-10 與本文件同步由使用者明確核准；**兩者並非 panel 同輪放行**；前一 approved 版本為 approved v1.9）—— 提供 provenance store、store script 命令面（含 `commit-test-provenance-batch`、`successor=null` retire）、task manifest、Review Packet 接線；本文消費而不重定義。**Gate scope 直接消費 shared model §9 的 canonical 定義**（不在本文改寫或摘要）。
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

拒絕（fail-closed，不留到後續檢查；分兩層，見 §11b.8c）：
  DEC-…@DP-…       ← DEC 不得帶 qualifier          ← 純結構，adapter 層即拒
  ASSUM-…@DP-…     ← ASSUM 不得帶 qualifier        ← 同上
  非 exception-backed 的 REQ-…@DP-…                ← 需 store context，
                                                     由 inventory pipeline 以同一份
                                                     captured pre-state 判定並拒絕
  即：`@dpRef` **僅** exception-backed REQ 合法（§7）——
      最終合法集合不變，只是後者的拒絕發生在有 store context 的那一層
```

> **`ULID` 的 authority 在上游（v1.8 新增）** —— 上式中的 `ULID` **唯一引用 intent-scan approved v1.10 §8 的 canonical ULID grammar**。
> **本文件不重定義、不複製、不放寬**其 alphabet、長度、overflow 或 case 規則；此處刻意不列出完整字元集或 regex，
> 否則就會出現第二份 machine-readable authority，而兩份遲早會漂移。要驗收請用例子（見 AC151），normative 定義只指向 intent-scan §8。
>
> - intent-scan **v1.10** 與 test-provenance **v1.8** 已於 2026-08-10 **同步由使用者明確核准**（非 panel 放行）。current coupled authority ＝ **shared approved v1.13 ＋ intent-scan approved v1.10 ＋ test-provenance approved v1.8**；canonical ULID grammar **現已是生效的 spec authority**。但 **spec 生效不等於任何 validator／adapter 已實作** —— 本次不新增任何實作授權，也不宣稱 readiness。
> - adapter 端的後果（§11b.8c directive-intent predicate）：一行**一旦成為 directive-intent candidate**，其 tag token 內的 ULID 只要不吻合上游 grammar，
>   該行就是 **malformed candidate → fail-closed**。**不得**把 malformed 的 `@src` 當成普通註解略過。
> - `EXPL` 不含 ULID，**不受**本次 grammar 收斂影響。
> - `@tid` 仍使用 **§11b.7 自己的 stable-ID grammar**，與 ULID 無關 —— **不得**把 ULID grammar 誤套到 `@tid`。
> - `REQ@DP` 的 exception-backed 分層與**最終合法集合不變**：adapter 只做 lexical／structural parsing，
>   是否確為 exception-backed 仍由 inventory pipeline 以同一份 captured store pre-state 判定。
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

> **v1.6 起本區塊由 §11b 取代為可落地的形式。**上式把 `structuralId(decl)` 寫成 adapter 的一個欄位，
> 但它是函式，JSON registry 承載不了；`testDeclarationPatterns`／`containerPatterns` 也只有欄位名而
> 無語言。§11b.2–11b.3 把資料與能力分開：registry 只承載 data 與 algorithm IDs，三項 capability 由
> closed `implementationId` → implementation module 的映射提供。本區塊保留為沿革，**不再是 authority**。

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

> **v1.6 起**：node:test v1 的實際演算法見 §11b.8。同一 container chain 內的**重複名稱不以位置消歧** ——
> 該 duplicate group 的每一筆都必須帶唯一 `@tid`，否則 fail-closed（理由與反例見 §11b.8）。

檔內結構重整（container 改名／嵌套改變）會使 `structuralId` 變動，此時：

```
matching 必須 one-to-one；任何一對多或多對一 → fail-closed
無法唯一配對時，作者可在宣告上加明示穩定 ID（adapter 定義之 annotation）
  → 該 ID 優先於推導的 structuralId
  → **v1.6 起**：node:test v1 的該 annotation 由 §11b.7 實際定義為 `// @tid <ID>`；
    「由 adapter 定義」不再是可接受的 authority，優先權規則本身不變
  → **v1.13 起**：該 ID 必須**在被比較的 base 側就已經是它的 identity**。
    只在 head 新增 `@tid`（base 仍為 `s:…`）**不是**追認，也**不是**合法 bridge ——
    preimage 只保留最終 `structuralId`，沒有 alias／adoption carrier，
    而 `@tid` 依 §11b.8b 不進 `bodyDigest`，
    因此 head 單方面新增的 `tid:` 在可觀測資料上**無法證明**它與哪一筆 base declaration 同一 identity。
    既有 unannotated declaration 若日後要做 structural refactor，
    如何安全導入 `@tid` 需**另立 migration authority**；v1.13 不自行發明。
仍無法唯一配對 → fail-closed（不得猜測，也不得降級成 added＋deleted）
```

**v1.13 定案 —— 這條「不得降級成 added＋deleted」與 §6 rule 3 的邊界在哪裡**：兩者先前**直接對撞**（rule 3 逐字套用會對 container rename 產出 added＋deleted，本節與 §11b.8 則禁止），由 §6 的 **residual-side exclusivity gate** 唯一決定：Phase 1／2 之後，只有當 residual **單側存在**時才落入 rule 3；**兩側同時仍有 residual 即 fail-closed**。原因是同一份 observable preimage 可同時代表 structuralId drift 與真正的 delete＋add，現有 carrier 無法區分，於是「猜測」與「降級」都不被允許。完整判定表見 §6。

**`inventoryDigest` 的 canonical encoding（唯一公式，不可只寫「同上游」）**：

```
inventoryDigest ＝ 依 envelope 版本分派（**每個版本各恰一條公式，不並存**）:
  v1（legacy）: sha256(canonicalJson({ baseTreeOid, entries }))
  v2          : sha256(canonicalJson({ inventoryVersion, baseTreeOid, registryDigest,
                                       headViewDigest, inputProvenanceStoreDigest, entries }))
                ← v1.6 新增；完整公式與理由見 §11b.9c
  ← **每個版本的公式唯一**。舊版一處寫「只 hash entries[]」、另一處說「envelope 含 baseTreeOid」，
    兩式並存會讓「同一批 entries、不同 base tree 是否同 digest」沒有答案，
    base-tree proof 因而不可機械驗證

entries 依 (path, adapterId, structuralId) 的 Unicode code point 序排序
每個 entry 的 object key 依 code point 排序  ← v1.10：exact 範圍與判定方式見下方「Entry source-key ordering」
bodyDigest 的 body span ＝ adapter 定義的宣告完整範圍
  （含 decorator／attribute／attachmentRule 所涵蓋的前置區塊，不含前後空白行）
  ← v1.7：node:test v1 的**唯一** exact 定義（最外層 ExpressionStatement ＋
    attachment block 起點）見 §11b.8c；本行不再是該 range 的 authority
body 正規化：UTF-8 無 BOM、LF、不 trim 內部空白
  ← v1.6：hashing 前對合法附著之 @tid 行的移除，唯一演算法見 §11b.8b
```

**Entry source-key ordering（exact；v1.10 新增）** —— 上式「每個 entry 的 object key 依 code point 排序」是 **reader 的 accept／reject gate**，不是只給 writer 的產出建議（AC126 已要求「送入未排序的 entries → fail-closed，不得由 writer 就地排序後放行」）。其 exact 範圍與判定方式：

```
適用範圍（遞迴，涵蓋每一筆 entry 的完整 object subtree）:
  entry root、testRef、tagBefore、tagAfter、implementationIdentity
判定方式:
  每個 object 的 member name **先做 JSON escape 解碼**，
  再依 exact Unicode code point 序**嚴格遞增**；
  不做 normalization、不 case-fold。
  duplicate member name 已由上游 SM v1.14 的 duplicate-member contract
  在此之前拒絕，本 gate 只判順序。
未排序 → fail-closed；reader **不得**先排序再接受。

不在本 gate 範圍:
  root envelope 的 source-key order —— root 的 exact key set 照驗，
    digest canonicalization 仍由 canonicalJson 排序。
  JSON whitespace，以及在 duplicate 與 decoded-order 判定之外
    等價的 member-name escape 拼法 —— 兩者本身不影響 acceptance。

entries[] 本身:
  仍依 (path, adapterId, structuralId) 的 Unicode code point tuple **嚴格遞增**；
  相同 testRef（即相同的排序 tuple）重複 → fail-closed，
  **不得**去重或重排後接受。
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

**Envelope 版本邊界（v1.6 新增）** —— 本 artifact 有兩個 shape，以**顯式 discriminator** 區分，
**不以欄位有無猜測**：

```
v2 文件         : 帶 explicit discriminator `inventoryVersion: 2`
legacy v1 文件  : **沒有** discriminator —— 只能以 **exact absence shape** 辨識：
                  root key set 恰為 { baseTreeOid, inventoryDigest, entries }，
                  且不含 inventoryVersion。這是誠實的表述：v1 從未帶版本欄位，
                  它的辨識靠的是「恰好缺這一欄且整體形狀完全吻合」，
                  **不是**一個 v1 自己宣告的 discriminator。
其他情形        : 缺 inventoryVersion 但形狀不吻合 v1 exact shape → fail-closed
                  inventoryVersion 為 2 以外的值或非整數           → fail-closed
```

**v1（legacy，Phase 2A clean-only）**

```
baseTreeOid:      本次盤點所用的 Git base tree，供 checker 機械驗證
                  `baseProvenance.treeOid == baseTreeOid`
inventoryDigest:  sha256(canonicalJson({ baseTreeOid, entries }))
entries:          必為 []（populated 者由 unsupported-populated-inventory 擋下）
```

v1 **只在 §11b.12 的 populated gate 仍在位時有效**。**v2 rollout 啟用後，v1 一律拒絕並要求重產** ——
**`entries: []` 的 legacy 文件不得被當成「已涵蓋、無變更」而成為 populated coverage 的 bypass**：
它缺 `registryDigest` 與 `headViewDigest`，根本無法證明自己涵蓋了什麼。

**v2 envelope（closed，exact key set）**

```
inventoryVersion: 2
baseTreeOid:      同上
registryDigest:   sha256(canonicalJson({ registry, explicitConfig }))  ← §11b.9c
headViewDigest:   由 S1 完整 canonical map 計算（**不含** provenance store）← §11b.10
inputProvenanceStoreDigest:
                  inventory 產生當下 current `.ctide/provenance.json` 的 digest ← §11b.9c
                  —— provenance-store freshness 的**唯一** carrier
inventoryDigest:  **唯一公式** ＝ sha256(canonicalJson({
                    inventoryVersion, baseTreeOid, registryDigest, headViewDigest,
                    inputProvenanceStoreDigest, entries }))
                  —— 涵蓋 version、base、registry、完整 head universe、
                     產生當下的 store 狀態，與 entries；
                     per-entry identity **不足以**構成 freshness proof
entries[]:
  testRef:        { path, adapterId, structuralId }（deleted 者取 base 側，§2 identity）
  status:         added | modified | deleted | retagged | moved | governance-affected
                  （**governance-affected**：body 與 binding 皆未變，但其綁定的 clause
                   於本次 changed／transitioned／drifted／expired —— 由上游 clause → test
                   反向閉包產生。未被改動的 sibling 測試因此仍須進 fixed-point review）
  reason:         content-change | governance-affected
  tagBefore:      { clauseRef, dpRef? } | { expl: true } | null
  tagAfter:       同上 | null
  baseBodyDigest: §2 bodyDigest（status ≠ added 時必填；status == added 時**必須缺席**）
  headBodyDigest: 同上（status ≠ deleted 時必填；status == deleted 時**必須缺席**）
  framework:      adapter 回報
  implementationIdentity:                                        ← v1.6 新增，必填
                  { implementationId, parserId, parserVersion }
                  exact key set，三欄皆非空字串；必須等於當次 registry 中
                  該 adapterId 綁定的 identity。完整規則見 §11b.9b。
                  因 entry 進 inventoryDigest，identity 變動必然使舊 batch stale。

entry exact key set（v1.10 定案；依 status 分派，恰為下列其一）:
  common seven（**永遠**恰有這七個；缺一或多一皆 fail-closed）:
    testRef、status、reason、tagBefore、tagAfter、framework、implementationIdentity
  status == added   : common seven ＋ headBodyDigest
                      baseBodyDigest **必須缺席**
  status == deleted : common seven ＋ baseBodyDigest
                      headBodyDigest **必須缺席**
  status ∈ { modified, retagged, moved, governance-affected }:
                      common seven ＋ baseBodyDigest ＋ headBodyDigest

  「必須缺席」**不是** null —— 該 key 本身不得出現。
  body digest 一旦存在，必須吻合 ^[0-9a-f]{64}$（上游 SM v1.14 的 digest carrier grammar）；
    null、空字串、uppercase 或其他拼法一律非法。
  reader **不得**補欄、刪欄、把 null 讀成 absence，或反向 normalize。

nested exact shapes（多一 key、缺一 key 一律 fail-closed）:
  testRef                : exact key set { path, adapterId, structuralId }
  implementationIdentity : exact key set { implementationId, parserId, parserVersion }
                           registry 逐欄相等義務不變（§11b.9b）
  clause tag（無 DP）    : exact key set { clauseRef }
  clause tag（帶 DP）    : exact key set { clauseRef, dpRef }
  EXPL                   : exact key set { expl }，且 expl **恰為** true

schema 不變量（**鏡射上游 INV-B1／B2，寫死在 schema，不靠 AC 補救**）：
  status == deleted  ⇔  tagAfter == null
  status != deleted  ⇒  tagAfter != null（必為 clause binding 或 EXPL）
  status == added  ⇒  tagBefore == null                      ← v1.10 明確化
  status == governance-affected  ⇔  reason == governance-affected
  status != governance-affected  ⇒  reason == content-change  ← v1.10 明確化
    —— 這一條是既有 iff 與 reason closed enum 的蘊含，寫出來是為了讓 reader 無須自行推導
  reason == governance-affected ⇒ tagBefore == tagAfter ∧ baseBodyDigest == headBodyDigest
  governance-affected 的 seed 是上游 **lifecycleAffectedClauses** 的反向閉包
    —— 與上游同一集合，不得各自定義
  ⇒ 「測試仍存在但把 @src 拿掉」在 schema 層即非法，不會被誤讀成已刪除
  tagBefore == null 僅表示「本次新增」或「既有未標記 legacy」，兩者皆合法
  status == modified ⇒ baseBodyDigest != headBodyDigest              ← v1.14 新增
  status == retagged ⇒ baseBodyDigest == headBodyDigest
                       ∧ canonicalJson(tagBefore) != canonicalJson(tagAfter)  ← v1.14 新增
    —— modified **可以**同時 tagBefore != tagAfter；retagged **必須**是 body digest 相同的 tag-only change；
       moved 的 body／tag 可同可不同；governance-affected 的既有 equality 不變。
       這兩條是 reader 可機械驗證的 persisted invariant，見「Paired-declaration classification」
matching 規則（closed，依序；結果必須 **one-to-one**，任何歧義 fail-closed）：
  0. **stable-ID uniqueness**（§11b.7）：同一 view 內同一 `tid:` 出現兩次以上
       → **matching 之前**即 fail-closed。base／head 各自檢查。
  1. (path, structuralId) 相等                    → modified／retagged
  2. structuralId 相等但 path 不同                → moved
       —— 1、2 皆以 exact Unicode code point 相等判定；
          bodyDigest、tag、宣告順序不參與 identity。
          同一 structuralId 出現一對多／多對一／多對多 → fail-closed。
  3. **residual-side exclusivity（v1.13 定案，取代舊的無條件 rule 3）**：
       令 Ubase ＝ 1、2 之後仍未配對的 base declarations
          Uhead ＝ 1、2 之後仍未配對的 head declarations
       Ubase ＝ [] 且 Uhead ＝ []  → 無 residual 輸出
       Ubase ＝ [] 且 Uhead ≠ []  → Uhead 每筆 added
       Ubase ≠ [] 且 Uhead ＝ []  → Ubase 每筆 deleted
       Ubase ≠ [] 且 Uhead ≠ []  → **unresolved-identity-drift，整輪 fail-closed**
```

**Rule 3 的 v1.13 判定表與理由（normative）** —— 舊的無條件 rule 3 與 §2／§11b.8 的「結構重整不得降級成 added＋deleted」**直接對撞**：base `a.test.mjs` 帶 `s:["old-container","same-test"]`、head 同 path 帶 `s:["new-container","same-test"]`、tag 與 `bodyDigest` 完全不變時，rule 3 逐字套用得到 added ＋ deleted，而 §2 要求 fail-closed。**同一份 observable preimage 無法區分**「container rename／nesting change 造成的 structuralId drift」與「真正的 delete ＋ add」—— `path`、`bodyDigest`、`tag`、`framework`、`implementationIdentity`、宣告順序與筆數**沒有一個**能證明兩側 residual 的 identity 關係。因此：

```
兩側同時有 residual 時 **必須** fail-closed，且:
  **不得**回傳任何 partial matching result（已成立的 exact／moved pair 也不得回傳）
  **不得** emit added／deleted
  **不得**以 path、bodyDigest、tag、framework、implementationIdentity、
        宣告順序或筆數猜測對位
  **不得**因恰為 1 base ＋ 1 head 就猜成同一 declaration
  **不得**因 path 相同或不同而改變結果
  **不得**因 bodyDigest／tag 相同或不同而改變結果
  **不得**描述成普通的一對多 —— 它是「現有 carrier 無法證明兩側 residual 的
        identity 關係」，是一個具名的 unresolved-identity-drift
```

**已知代價，刻意接受**：一次真正同時包含 delete 與 add 的變更，會落在 fail-closed 這一格。這類變更**必須拆成兩個以不同 base 為界的 run**，使每輪的 residual 只存在單側（先以原 base 跑出只有 base residual 的 delete，再以其結果為新 base 跑出只有 head residual 的 add）。**不得**為了便利放寬本 gate：放寬等於允許 matcher 猜測 identity，而那正是 §2、§11b.8 與 AC36 從一開始就禁止的事。

### Paired-declaration classification（closed，ordered；v1.14 新增）

§6 rule 1 只寫「`(path, structuralId)` 相等 → **modified／retagged**」，那是一個**選言**，不是判定。配對成功之後究竟落在哪一個，既有 approved 文字**從未**決定，於是兩個都說得通的 producer 會對同一份 preimage 寫出不同的 persisted status。本節把它收斂成**唯一、有序**的演算法。

**可用訊號**（每個 matched pair 各求一次；**不得**新增其他訊號）：

```
relation      ＝ matcher 產生的 relation（same-path 或 moved）
bodyChanged   ＝ base.bodyDigest !== head.bodyDigest
tagChanged    ＝ canonicalJson(base.tag) !== canonicalJson(head.tag)
governanceHit ＝ 該 test 的 binding 命中 lifecycleAffectedClauses 的 reverse closure
```

`tagChanged` 比較的是 **typed logical value** —— `null`、`{ expl: true }`、`{ clauseRef }`、`{ clauseRef, dpRef }` —— 以既有 canonical JSON ＋ exact code point 字串相等判定；**不受** JSON source key order、whitespace 或 object identity 影響。**不得**新增 persisted field、alias、migration record、第二個 digest 或自由格式 metadata：declaration 本體與 effective-oracle closure 的變動**都已**由同一個 `bodyDigest` inequality 承載。

**唯一優先序（先命中者勝；每個 logical test 至多一筆 entry，不得多 status、不得重複 entry）**：

```
1. matcher 的 head-only residual                     → added
2. matcher 的 base-only residual                     → deleted

3. relation == moved                                 → moved
     —— 不論 bodyChanged、tagChanged、governanceHit 為何

4. relation == same-path 且 bodyChanged              → modified
     —— tagChanged 或 governanceHit **不得**覆蓋 modified

5. relation == same-path 且 !bodyChanged 且 tagChanged
                                                     → retagged
     —— governanceHit **不得**覆蓋 retagged

6. relation == same-path 且 !bodyChanged 且 !tagChanged 且 governanceHit
                                                     → governance-affected

7. relation == same-path 且 !bodyChanged 且 !tagChanged 且 !governanceHit
                                                     → unchanged，自 entries **省略**
     —— **不是** modified；**不得** emit placeholder entry
```

由此**推導**（非另立規則）：

```
move ＋ body change                → moved
move ＋ retag                      → moved（AC27 原結果保留）
move ＋ body change ＋ retag       → moved
same-path body change ＋ retag     → modified
same-path 只有 tag 改變            → retagged
same-path oracle dependency 改變   → effectiveOracleDigest 改變 ⇒ bodyDigest 改變 ⇒ modified
```

**governance reverse closure 不得為已由 added／deleted／moved／modified／retagged 收錄的 test 再新增第二筆 entry** —— 它只在第 6 格生效。一般變更的 `reason` 維持 `content-change`；**只有** `governance-affected` 使用 `reason == governance-affected`（既有 iff 不變）。**優先序不抹掉伴隨的差異**：`tagBefore`／`tagAfter` 與兩個 body digest 仍各自保存實際的 before／after 值，`modified` 的 entry 因此**可以**同時帶 `tagBefore != tagAfter`。

**Reader 能驗什麼、不能驗什麼（v1.14 明確化）**

```
reader **可以**只憑一筆 persisted entry 驗證:
  status == modified  ⇒ baseBodyDigest != headBodyDigest
  status == retagged  ⇒ baseBodyDigest == headBodyDigest
                        ∧ canonicalJson(tagBefore) != canonicalJson(tagAfter)
  以及既有的 governance-affected equality（不變）

reader **無法**只憑一筆 entry 重建，因此**不得**假裝能驗證:
  moved 的 base／head path 關係（entry 的 testRef 只有一個 path）
  unchanged 的 pair 是否被正確省略（省略的東西不在文件裡）
  完整的 classification precedence
  完整 preimage 與 governance reverse closure
  —— 以上一律由 **producer 對 captured preimage** 負責
```

上列兩條 observable invariant 是**新增的 reader 義務**：目前已接受的 canonical v2 reader **尚未**驗證它們，因此 v1.14 一旦 promotion，reader **需另行 remediation 與獨立審查**。本節只記錄這項 implementation boundary，**不修改任何程式**。

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

**與 classification 的交叉引用（v1.14）** —— oracle dependency 的變動**不建立**額外的分類訊號，也**不需要**第二個 persisted carrier：它改變 `effectiveOracleDigest`，因而改變同一個 `bodyDigest`，於是直接落入上面 ordered table 的 `bodyChanged` 一格。**因此 same-path 的 oracle-only change 必為 `modified`。**反向亦成立且**不弱化**：不在該 declaration `effectiveOracleDeps` closure 內的 **SUT-only change 仍不得**使 test 成為 `modified`（AC109 的單變數對照與 AC147 的 contributor 判準原樣有效）。本段**不重新定義** effective-oracle closure。

### `TestSemanticReviewBatch`（current task 一份；test discipline 的 typed 輸出）

逐 finding 的設計無法區分「審過且乾淨」與「漏審」—— 改為 **batch＋完整性不變量**：

```
taskId
baseProvenance              ← 上游 §9 **inline** witness（treeOid／storePath／storeDigest）；
                              必須等於 tracked TaskState.baseProvenance，且
                              treeOid == inventory.baseTreeOid
inventorySnapshot           ← **v1.6 新增，必填**：完整 typed ChangedTestInventoryV2
                              （exact v2 envelope 全文，非 digest）。這是 inventory 的
                              **唯一** authority；提交後隨 batchSnapshot 持久化，
                              scratch 刪除後，仍可驗 persisted witness、derived equalities、
                              batchDigest coverage 與 S3 freshness（可驗範圍見 §11b.9c 證明邊界）。
inventoryDigest             ← **derived**：必須等於 inventorySnapshot.inventoryDigest，
                              且等於由 inventorySnapshot 重算所得的值。
                              **不得**由 caller 獨立提供成為第二份 authority
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

**Freshness —— 本節是 Step 5 之前的 proposal-time validation，不是 post-commit 檢查（v1.6 修正）**

```
適用時機: **Step 5 提交之前**，對尚未 commit 的 batch proposal 求值
batch.taskId          == current taskId
batch.inventoryDigest == 重算的 current inventoryDigest
每筆 observedBase/HeadBodyDigest == 重算的 current body digest
tagBefore／tagAfter    == current inventory
任一不符 → fail-closed
```

因此：測試在 review 後又被修改、沿用同一 test 的**舊 run** ruling、或借用**其他 test** 的 ruling，全部擋下。

> **本節不得被引入 post-commit（Step 6）。** `batch.inventoryDigest == 重算的 current inventoryDigest` 只在 store 尚未被 Step 5 改動時成立：正常提交會把 store 由 D0 推進到 D1，於是「當下重算」的 inventory digest 必然不同於 H0，**每一筆正常 batch 都會被誤判 stale**。post-commit 的對位規則**唯一**來源是 §11b.9c 的 Step 6 snapshot 協定 —— 讀 committed `batchSnapshot.inventorySnapshot`、重算其自身 digest、驗 derived equality，S3 只重算 `headViewDigest`／`registryDigest`。

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
| Batch 完整性與新鮮度 | `results` ↔ inventory entries 一對一完全覆蓋（兩階段皆驗）。**分階段**：**Step 5 之前（proposal-time）**依 §6 重算 `taskId`／`inventoryDigest`／各 body digest／tag 前後值；**Step 6（post-commit）**改依 §11b.9c 的 snapshot 協定 —— 讀 committed `batchSnapshot.inventorySnapshot`、重算其 `inventoryDigest`、驗 record 的 derived equality，並以 S3 重算 `headViewDigest`／`registryDigest`。**post-commit 不得引入 §6 的 current-inventory 重算**（Step 5 的合法 store 推進會使它必然不符） | **fail-closed** |
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

## 11b. Adapter registry、node:test v1 profile 與 oracle edge contract（v1.6 新增）

本章關閉 Phase 2B1 的 direct inspect 所證實的六個 authority／carrier 缺口，以及 panel 於第一輪 REVISE 指出的七處（tag cardinality、pattern-ID closed set、`implementationIdentity` carrier、duplicate-name identity、oracle edge 分類、head snapshot 原子性、`@tid` 的 digest 排除演算法），與第二輪 REVISE 指出的七處（registry 側 identity carrier、versioned envelope 與完整-universe freshness、`node-test-v1` 唯一 mapping、assertion／fs allowlist 閉合、per-view stable-ID uniqueness、行終止符正規化順序、gitignore engine 的授權範圍），以及第三輪 REVISE 指出的五處（兩種 freshness 的分離與上游 pre-state precondition、head universe 的 closed 範圍、assertion binding 分類、死 token 與半開 edge 的移除、version dispatch 與 `registryDigest` 的誠實公式）。**它只補契約，不授權任何 dependency，也不宣告任何實作就緒。**

### 11b.1 為何需要本章

v1.5 的 §2 把 adapter 寫成

```
adapter = { adapterId, language, framework, testDeclarationPatterns,
            containerPatterns, attachmentRule, structuralId(decl) }
```

而 §12 又要求把它落成 `test-adapters.json`。兩者形式上互斥：**`structuralId(decl)` 是一個函式**，JSON 承載不了。同樣地 `testDeclarationPatterns`／`containerPatterns` 只有欄位名而無語言（regex？AST matcher？哪種方言？），`attachmentRule` 只有括號內四個字詞而非 closed enum，而「明示穩定 ID（**adapter 定義之** annotation）」把語法整個委派給一個不存在的 adapter。實作者要動手，只能自行發明 —— 那正是本模型反覆拒絕的東西。

### 11b.2 Registry 是資料，能力在 shipped code

**分工（normative）**：

```
test-adapters.json  只承載 DATA 與 ALGORITHM IDs
shipped code        以 closed implementationId → implementation module 的映射
                    提供三項 capability：
                      structuralId(decl)
                      tag attachment
                      effectiveOracleDeps(node, tree)
```

**registry 一律不得**以任意 module path、`eval`、function source、caller-provided code 或自由格式 regex 取得可執行行為。實作模組的集合是**編譯期閉合**的：一個未列於 closed mapping 的 `implementationId` 是 fail-closed，不是動態載入的機會。

### 11b.3 `test-adapters.json` exact schema

```
root（exact key set）:
  registryVersion : 整數，本版為 1
  adapters        : 陣列，長度 >= 1

adapters[]（exact key set；每個字串欄位必填且非空）:
  adapterId                 : ID token
  language                  : language enum
  framework                 : framework enum
  implementationId          : implementation enum（closed）
  implementationIdentity    : { implementationId, parserId, parserVersion }
                              exact key set，三欄皆必填非空字串；
                              implementationIdentity.implementationId
                                **必須等於** adapter.implementationId（不等 → fail-closed）
                              parserId／parserVersion 的實際值由後續 dependency
                                authorization 提供（11b.11），本 spec 不指定
  testDeclarationPatternIds : ID token 陣列，長度 >= 1
  containerPatternIds       : ID token 陣列，長度 >= 1
  attachmentRule            : attachment enum（closed，見 11b.5）
  stableIdRule              : stableId enum（closed，見 11b.7）
  discovery                 : discovery 物件（見 11b.4）

ID token 文法（所有 ID 共用）: ^[a-z][a-z0-9]*(-[a-z0-9]+)*$

closed enums（v1）:
  language         : "javascript"
  framework        : "node:test"
  implementationId : "node-test-v1"
  attachmentRule   : "leading-line-comments"
  stableIdRule     : "line-comment-tid-v1"

陣列 canonical form（三個 pattern array 與 discovery 的字串陣列共用）:
  去重後依 Unicode code point 序遞增排列。
  未排序、含重複、含未知 ID → 各自 fail-closed（不得由 writer 就地排序後放行）。

唯一性:
  adapterId 在 registry 內唯一 —— 重複 → fail-closed
  (implementationId, framework) 唯一 —— 重複 → fail-closed
```

**Raw JSON duplicate-member 規則（v1.11 新增；本文件自持）** —— 上游 **SM v1.14** 的 duplicate-member contract 以其自身標題限定於「適用於完整 `ChangedTestInventoryV2` 文件」，**不涵蓋** registry；**不得**宣稱它已涵蓋，也不因此修改 shared spec。本節自持同一語義：

```
適用範圍   : 該檔內的**每一個** JSON object。
規則       : 同一個 object 內**不得**出現 duplicate member name。
比較對象   : member name 經 JSON escape 解碼後的 StringValue。
比較方式   : exact Unicode code points；不做 normalization、不 case-fold。
             ⇒ "a" 與 "\u0061" 是同一個名稱。
任一 duplicate → fail-closed。

判定順序   : duplicate 判定**先於** exact key set、field value 與任何 digest 判斷。
reader 義務: 必須在**仍保留全部 member occurrence** 的階段完成本檢查。
             單獨使用會 last-write-wins 的 JSON.parse、再對其結果檢查，
             **不能**滿足本義務 —— 被覆蓋的 occurrence 在那個階段已不可觀察。
不得       : 修補、擇 first、擇 last、去重，或重新序列化後放行。
             任何失敗都**不得**改動 carrier bytes。

本節的適用對象:
             root、每個 adapters[] element、implementationIdentity、discovery，
             以及任何其他 nested object。
```

**`implementationId` 綁定表（closed；v1 只有一列）** —— 這張表閉合的是 **semantic algorithm tokens**，**不是**一份可落檔的 registry：`implementationIdentity.parserId`／`parserVersion` 的值尚待 dependency authorization（§11b.11、§11b.12）。各欄皆為 `adapters[]` 的頂層欄位：

| `implementationId` | `framework` | `language` | `testDeclarationPatternIds` | `containerPatternIds` | `attachmentRule` | `stableIdRule` |
|---|---|---|---|---|---|---|
| `node-test-v1` | `node:test` | `javascript` | 恰為 `["node-test-call"]` | 恰為 `["node-test-describe"]` | `leading-line-comments` | `line-comment-tid-v1` |

**任何其他 `framework` 搭配 `node-test-v1` → fail-closed**；表中未列的欄位組合亦 fail-closed。每一欄都是**恰為**，不是「子集」或「可為空」—— v1 只有一個合法組合，registry 沒有自由度。

**`discovery.filePatternIds` 與 `mjs-test-suffix` 均已刪除（v1.6 第三輪修正）** —— 初稿允許 `["mjs-test-suffix"]`，那讓副檔名單獨構成 framework evidence。**`.test.mjs` 不是 framework 證據**：Playwright、Vitest 及其他 runner 同樣使用該副檔名。第二輪把它降為 eligibility filter，但**沒有任何欄位可以選用它** —— 那是一個死 token；本輪**從 pattern table、registry schema、discovery 與 AC 全部移除**，且**不新增另一個欄位只為保留它**。**node:test 只由 explicit config 或 static import `"node:test"` 選定。**

**`implementationIdentity` 亦是 registry 欄位（v1.6 修正）** —— 只放在 inventory entry 不夠：沒有 registry 側的宣告，entry 的 identity 就無可比對的權威。兩處必須逐欄相等（§11b.9b）。

**Closed pattern-ID table（v1；恰兩個 AST predicate，無 path predicate）** —— 每個 ID 都有完整語義，不是留待實作填空的名字：

| Pattern ID | 類別 | 語義（predicate） |
|---|---|---|
| `node-test-call` | test declaration | AST `CallExpression`，callee 解析到 §11b.6 所定義的 `node:test` **test binding**（含 `.only`／`.skip`／`.todo` 成員），且第一引數為字串字面值或無插值模板字串 |
| `node-test-describe` | container | AST `CallExpression`，callee 解析到 `node:test` 的 **describe binding**（含同組 modifier），第一引數同上 |

未列於本表的 pattern ID → fail-closed。**registry 一律不接受自由格式 regex 作為 authority。**

**registry 不得**以任意 module path、`eval`、function source、caller-provided code 取得可執行行為；實作模組集合為編譯期閉合，未列於 closed mapping 的 `implementationId` 是 fail-closed，不是動態載入的機會。

### 11b.4 Discovery：exact input／output 與 precedence

```
discovery（exact key set）:
  explicitConfigPath   : canonical repo-relative path | null
  manifestDependencies : 字串陣列（canonical form；node-test-v1 綁定為 []）
  importSpecifiers     : 字串陣列（canonical form）

node-test-v1 的綁定值（closed）:
  manifestDependencies 恰為 []          —— node:test 是 Node 內建，沒有 manifest 依賴證據
  importSpecifiers     恰為 ["node:test"] —— 不得以任意非空字串冒充

輸入（logical，**恰兩欄**；v1.12 收斂）: { view, path }
      view ＝ base | head 的 AdapterContentView（見 11b.10；兩側各自求值，不得混用）
      —— sourceText **不是**獨立或 caller-provided carrier：
         它必須由**同一個** view 的 view.read(path) 導出。
      —— manifest **不是**獨立 carrier：
         它必須依本節「最近祖先 package.json」規則、
         在**同一個** view 內解析而得。
輸出（logical，**恰三值**；v1.12 收斂）: adapterId | not-a-candidate | fail-closed
      —— 三值的完整語義見 11b.4c；本行與 11b.4a–4c 及 AC28／AC88／AC89／AC90 完全一致。
```

**Precedence（依序，先命中者勝；v1 只有三級）**：explicit config → manifest 依賴 → import specifier。

**沒有 file-pattern 這一級（v1.6 第三輪修正；v1.12 收斂結果）** —— discovery 只有上列三級，**副檔名不參與 adapter 選定**。反例：一個 `.test.mjs` 檔只 import Playwright／Vitest 風格的 API 而**沒有** `node:test` 的 static import → 三級皆無 evidence → **`not-a-candidate`**（v1.12：**不是** whole-run fail-closed，見下方 §11b.4c），**不得**因副檔名而被選成 `node-test-v1`。

**`manifest` 的解析（每個 view 各自）** —— 由測試檔所在目錄向 repo root 逐層尋找**最近祖先**的 `package.json`，取第一個命中者；base 與 head **各自解析**，不得混用（head 新增或刪除 `package.json` 會改變 head 的最近祖先，那正是要偵測的變化）。找不到任何 `package.json` → 該級零命中（非錯誤），續評下一級。

**Explicit config carrier**：路徑固定 `.ctide/test-adapters-config.json`，exact shape

```
{ "configVersion": 1, "assignments": [ { "path": <canonical path>, "adapterId": <ID token> } ] }
```

`assignments[].path` 唯一；重複、未知 `adapterId`、未宣告 key、`configVersion != 1` → 各自 fail-closed。

此檔是 **tracked committed project configuration**，屬 consuming project 所有，隨 base／head 兩個 view 各自取值；**producer 對它 read-only**，任何情況下都不得建立、改寫或補齊它。它同時是 §11b.9c 的 `registryDigest` 輸入之一。

**`tracked` 是合法 carrier 的必要條件（v1.11 定案；唯一規則）** —— 「tracked committed project configuration」自 v1.6 起即是本檔的定性，AC92 也一直要求「另驗它是 tracked」；但在 v1.11 之前，該判定**沒有任何可用的 carrier**（head view 依 §11b.10 含 untracked 檔，且不暴露 tracked 狀態），於是「只接受 tracked carrier」與「接受 head view 中同路徑的 untracked carrier」兩種 reader 都說得通。本版定案：

```
tracked 的精確定義（**head view 專用**；base 側見下方 §11b.4d）:
  該 canonical path 存在於**本次 snapshot 捕捉的 Git index stage-0 path set**。
  —— staged addition 即為 tracked；純 untracked path 為 untracked。
  —— index conflict（非 stage-0 entry）仍依 §11b.10 既有規則 fail-closed，
     本節**不另發明**處置。

合法 explicit-config carrier 的判定（依序；唯一）:
  1. 該 path **不在** S3 snapshot 內   → explicitConfig **恰為 null**
       —— 依 §11b.10 判定順序第 2 步，該 path 只要在 worktree 中存在就**必然**
          在 snapshot 內（即使被 tracked .gitignore 忽略）；
          因此「不在 snapshot 內」**⇔**「該 path 實際不存在」。
  2. 在 snapshot 內且 tracked == false → **invalid config carrier，fail-closed**
       —— **不得**接受；
       —— **不得**視為「config 不存在」；
       —— **不得**以 explicitConfig: null 續行；
       —— **不得** git add／建立／刪除／改寫或修補任何檔案。
  3. 在 snapshot 內且 tracked == true  → 仍必須是 blob，
       且必須通過上列 exact shape 與下列 duplicate-member 規則。

判定資料來源:
  只用 §11b.10 的 snapshot metadata（entry(path).tracked）。
  consumer **不得**在 snapshot 建立後再做第二次 Git 或 filesystem discovery。
```

**「進入 head universe」不等於「有資格成為 carrier」** —— untracked 的同路徑檔案仍依 §11b.10 的完整 universe 規則**進入 `headViewDigest`**（那是 source-content 完整性的判準），但它**不是**合法的 explicit-config carrier（那是 carrier validity 的判準）。兩個判準各自獨立，任一方都**不得**代換另一方；兩句話同時成立，並不衝突。

**Raw JSON duplicate-member 規則（v1.11 新增；本文件自持）** —— 理由同 §11b.3：**SM v1.14** 的 contract 只擁有完整 `ChangedTestInventoryV2`，**不涵蓋** explicit config。

```
適用範圍   : 該檔內的**每一個** JSON object。
規則       : 同一個 object 內**不得**出現 duplicate member name。
比較對象   : member name 經 JSON escape 解碼後的 StringValue。
比較方式   : exact Unicode code points；不做 normalization、不 case-fold。
             ⇒ "a" 與 "\u0061" 是同一個名稱。
任一 duplicate → fail-closed。

判定順序   : duplicate 判定**先於** exact key set、field value 與任何 digest 判斷。
reader 義務: 必須在**仍保留全部 member occurrence** 的階段完成本檢查。
             單獨使用會 last-write-wins 的 JSON.parse、再對其結果檢查，
             **不能**滿足本義務 —— 被覆蓋的 occurrence 在那個階段已不可觀察。
不得       : 修補、擇 first、擇 last、去重，或重新序列化後放行。
             任何失敗都**不得**改動 carrier bytes。

本節的適用對象:
             root、每個 assignments[] element，以及任何其他 nested object。
```

**Fail-closed**：同級命中兩個**不相等**的 `adapterId`；較高級已唯一命中則不再評估較低級。**（v1.12 收斂）**「三級皆無 evidence」**不再**是本行的 whole-run fail-closed 理由 —— 其唯一處置見下方 **§11b.4c**：ordinary probe subject 零 evidence 為 **`not-a-candidate`**，forced explicit-config subject 的失敗則各有具名理由。Evidence 必須可重現 —— 只讀該 view 內的內容與路徑，不依賴 process 環境、時間、網路或已安裝的 node_modules。

**跨 view framework migration 是 v1 的刻意邊界**：同一 path 在 base 與 head 導出**不同** `adapterId` → fail-closed。這**不是**「identity 漂移」的泛稱，而是明確拒絕把 framework 遷移猜成 `moved`／`retagged` —— 兩個 adapter 的 `structuralId` 演算法不同，跨 adapter 比較沒有共同定義域。日後若要支援，必須另立 **typed cross-adapter identity contract**（明確定義兩個 adapter 之間的 identity 對映與其 witness），v1 不提供。**v1 可達性（v1.12 誠實化）** —— 本條是 **defensive／future invariant**，在**目前的 v1 closed registry 下無法由 conforming public input 達成**：§11b.3 的 closed table 只有**一個**合法的 implementation／framework 組合，而同一次 preimage invocation 又對 base 與 head 使用**同一份 fresh registry root**（§11b.10b 第 1 步），因此兩側可解析出的 `adapterId` 必然相同。**不得**為了製造該情境而新增第二個 adapter、registry override、caller injection 或 test-only public seam，**也不得**放寬 closed mapping —— 那會破壞 §11b.3 的閉合性，代價遠大於這條 invariant 的可測性。因此：該 invariant **必須被實作**（見 §11b.10b 與 AC93），但**不得宣稱**已以 v1 end-to-end fixture 實跑過。

#### 11b.4a Adapter probe universe（closed；v1.12 新增）

舊文定義了「給定一個 path 如何選 adapter」，卻從未定義**哪些 path 會被送進去**。§11b.3 已刪除唯一的 path predicate（`filePatternIds`／`mjs-test-suffix`）並禁止以任何 registry 欄位復活它，於是 candidate 的來源完全沒有 authority。本節閉合它。

```
probe universe（**每個 base／head view 各自建立，互不混用**）恰為以下兩者的聯集:

  1. 該 view 的 AdapterContentView（§11b.10）中，同時滿足:
       entry.type == "blob"
       canonical Git-literal path 以 lowercase literal suffix ".mjs" 或 ".js" 結尾
     —— suffix 比對 **case-sensitive**，**不 case-fold**：".MJS"、".Js" 皆不命中。

  2. 該 view 的**合法** explicit config 中，每一個 assignments[].path
     —— 即使不是 .mjs／.js，仍是 **forced discovery subject**；
     —— 後續 executable adapter 仍可因 module format 不受支援而 fail-closed；
     —— assigned path 不存在於該 view、entry.type != "blob"（含 symlink）
          或其他 unsupported entry → **fail-closed**（不是 not-a-candidate）。
```

**suffix 的地位（明文，不得再被誤讀）** —— `.mjs`／`.js` **只**決定「是否需要對這個 path 做 AST import-evidence probe」。它**不是** framework evidence、**不是** adapter selector、**不是** registry pattern ID，也**不會**單獨讓任何 path 成為 candidate。因此：

```
filePatternIds        : **不得復活**，registry 仍無任何欄位可承載 path predicate。
mjs-test-suffix       : **不得復活**。
".test.mjs"           : **不具任何特殊地位** —— 它與 "helper.mjs" 在本節完全同權。
helper.mjs            : 只要具備合法的 node:test static import evidence，
                        與 a.test.mjs **完全同樣**可被選定。
沒有 evidence 的 .test.mjs : **不得**因檔名被選定。
```

與 §11b.3 的關係：§11b.3「本輪從 pattern table、registry schema、discovery 與 AC 全部移除」指的是移除**可由 registry 承載、且能單獨構成 framework evidence** 的 path predicate 欄位。本節的 suffix gate **不是欄位、不是 evidence、不是 selector**，因此 §11b.3 末句「**node:test 只由 explicit config 或 static import `"node:test"` 選定**」在 v1.12 下**逐字仍然成立**。

#### 11b.4b Probe 與 candidate 是兩個集合（v1.12 新增）

對 probe universe 中**非** explicit-assigned 的 `.mjs`／`.js` blob，逐一執行 import-evidence probe：

```
1. 只讀**同一份 immutable AdapterContentView** 的 raw bytes（§11b.10）。
2. 以 §11b.11 已授權的 parser 將其解析為 **module source**。
3. syntax error／parser refusal → **fail-closed**；
   **不得**當成「沒有 import」，也**不得**退回 not-a-candidate。
4. import evidence **只**取 Program body 的 **top-level static ImportDeclaration**。
5. 取該 ImportDeclaration.source 的 **decoded StringValue**。
6. 以下**都不是** discovery import evidence:
     dynamic import()、require()、export … from、export * from、
     comment 內的字樣、任何普通 string literal。
7. 與 registry 的 discovery.importSpecifiers **exact 比對** ——
   不 trim、不 normalize、不做 URL／path 解讀、不做前後綴匹配。
```

**candidate module universe** 恰為：

```
  合法 explicit config assignment 命中的 forced subject
∪ probe 後**至少一個** manifest／import evidence level 命中的 path
```

**v1 shipped registry 的結構事實**：`manifestDependencies` 恰為 `[]`，因此 manifest level 在 v1 **結構上存在但不可能命中**。本版**不得**自行定義 package dependency field 的 union；日後若 registry 要出現非空 `manifestDependencies`，**必須先另立 authority**。

#### 11b.4c 三值輸出與零-evidence 的唯一處置（v1.12 定案）

§11b.4 的 logical output 由兩值改為**三值**：

```
discovery(view, path) -> adapterId | not-a-candidate | fail-closed

not-a-candidate:
  **只**適用於「ordinary probe subject 完成完整 probe 後，三級皆無 evidence」。
  該 path 自 candidate universe **省略**，**不是錯誤**，**不得**使整輪 fail-closed。

adapterId:
  path 因任一 evidence 成為 candidate 後，才執行既有 precedence:
    explicit config → manifest dependency → import specifier
  同級命中兩個**不相等**的 adapterId              → fail-closed
  同級多筆 evidence 但都指向**同一** adapterId    → 視為唯一命中
  較高級已唯一命中                                 → 不再評估較低級

fail-closed（各有**具名理由**，**不得**以「三級皆無 evidence」籠統代稱）:
  malformed explicit config、config 內 unknown adapterId、duplicate assignment path
  parser error／unsupported syntax
  同級 ambiguous evidence
  forced explicit-config subject 的 path missing／非 blob／symlink／
    module format 不受支援／指定 component 拒絕
```

**不得**把 `not-a-candidate` 用來寬容上列任一 fail-closed 情形。**不得**接受 caller-provided `modulePaths`（或任何等價的 caller 提供集合）作為 candidate authority —— candidate universe **只**由本節的 probe ＋ evidence 導出。**不得**以 `language: "javascript"` 已註冊、副檔名或 caller 提供的清單，把零 evidence 的 path 變成 candidate。

#### 11b.4d Explicit-config carrier 的 base／head 分層（v1.12 定案）

v1.11 把 `tracked` 定義成「本次 snapshot 捕捉的 Git index **stage-0** path set」。exact base tree **沒有 index、沒有 stage-0**，該定義對 base 側不可適用。兩側因此**分開定案**：

```
Base（來源：baseTreeOid 指向的 exact immutable Git tree）:
  config path 不在 base AdapterContentView 內      → base explicitConfig **恰為 null**
  config path 在 base view 且 entry.type == "blob"  → **tree membership 本身即為 committed carrier**
                                                      （tree 內的一切都是 committed 的）
                                                      仍必須通過 exact schema 與
                                                      §11b.4 的 raw duplicate-member 規則
  entry.type == "symlink" 或其他 type               → **fail-closed**
  **不得**讀 head 的 index／stage-0 來推導 base carrier validity。

Head（完整保留 approved v1.11 規則，一字不改）:
  absent（不在 S1 內）        → null
  present 且 tracked == false → **fail-closed**
  present 且 tracked == true  → 驗 blob、exact schema 與 duplicate-member 規則
  只讀 S1 的 entry(path).tracked；**不得**在 snapshot 之後做 live Git probe。
```

`registryDigest` 的 preimage **仍只包含 head explicitConfig**；base 側的 config 由 `baseTreeOid` 綁定（§11b.9c），**既有公式不得修改**。

### 11b.5 `attachmentRule` closed enum 與 tag cardinality

v1 唯一值 `leading-line-comments`：

```
位置      : tag 位於 declaration 起始 token 之前，其間只允許連續單行註解 (//)、空白與縮排
中介註解  : 允許 —— 連續單行註解構成一個 attachment block，tag 可在其中任一行
空白行    : **不允許** —— block 與 declaration 之間出現任何空白行即未附著
container : container declaration **永不**承載 tag —— 附著於 container 的 tag → fail-closed
malformed : block 內語法不合法的 tag、或同一 block 歧義地附著於兩個 declaration → fail-closed
```

**Tag cardinality（承 §2:41「每個測試恰好一個 tag」，不得放寬）**：

```
一個 declaration 的 attachment block 內 **最多且最終恰好一筆 @src**。
第二筆 @src → fail-closed，**不論內容是否與第一筆相同**（相同不是「無害重複」，
  它同樣違反「恰好一個 tag」，且會讓正規化悄悄吞掉作者的錯誤）。
@tid **不計入** tag cardinality —— 它是 identity hint，不是 tag。
head 中仍存在的 test 若零 @src → 依既有 INV-B2 fail-closed。
pre-state legacy 的零 tag 合法性仍由既有 preState 規則處理，**不得反向放寬 head**。
```

decorator／attribute／annotation 三種 attachmentRule 在 v1 **未定義**，登記即 fail-closed。

> **v1.7 起**：attachment block 的 exact 掃描規則、directive accounting，以及 `@src`／`@tid`
> 的唯一 lexical form，全部由 **§11b.8c** 定義。本節其餘敘述為沿革，遇歧義以 §11b.8c 為準。

### 11b.6 node:test v1 adapter profile

本 profile 是**本 spec 自行選定的穩定子集**，不是「本機 Node 恰好 export 什麼」。未列舉語法一律 `unsupported-syntax` fail-closed，**禁止以 regex 猜測**。

```
implementationId : "node-test-v1"
module format    : ESM only（.mjs，或 package type=module 下的 .js）。CommonJS → unsupported

合法 node:test import（top-level static import；specifier 必須恰為 "node:test"）:
  import test from "node:test";
  import { test } from "node:test";
  import { test, describe } from "node:test";
  import { before, after, beforeEach, afterEach } from "node:test";
  import test, { before, after, beforeEach, afterEach } from "node:test";
  —— default 與 named 可於同一 import 併用；允許 `as` 別名
     （例：import { test as it } from "node:test"）。
  —— adapter 依 **import binding** 解析實際識別字，不比對字面名稱。
  —— 裸 "test" specifier（無 node: 前綴）→ unsupported

binding 分類:
  test binding      : default import，或 named "test"（含別名）
  describe binding  : named "describe"（含別名）
  hook binding      : named "before" / "after" / "beforeEach" / "afterEach"（含別名）

合法 assertion import（specifier 恰為 "node:assert" 或 "node:assert/strict"）:
  import assert from "node:assert";              ← default binding
  import assert from "node:assert/strict";       ← default binding
  import * as assert from "node:assert";         ← namespace binding
  import { strict as assert } from "node:assert";← named binding（別名）
  import { ok, deepStrictEqual } from "node:assert";
  import { ok, deepStrictEqual } from "node:assert/strict";
  —— 兩個 specifier 皆支援 default／namespace／named binding，允許 `as` 別名。

binding 分類（決定合法呼叫形式，兩類不可互換）:
  assertion-object binding   : default binding（import assert from "node:assert"）
                               namespace binding（import * as assert from "node:assert"）
                               named strict binding（import { strict as assert } from "node:assert"）
                               —— 三者都綁定「assert 物件」，**可做 allowlisted member call**
  assertion-function binding : 直接具名匯入的單一 assertion 函式
                               （import { ok, deepStrictEqual } from "node:assert"）
                               —— 只能**直接呼叫**；對它做 member call（ok.strict(...)）→ unsupported

assertion 名稱 allowlist（closed；v1 恰為下列 17 個，不使用省略號）:
  ok                     equal              notEqual
  strictEqual            notStrictEqual     deepEqual
  notDeepEqual           deepStrictEqual    notDeepStrictEqual
  throws                 doesNotThrow       rejects
  doesNotReject          match              doesNotMatch
  fail                   ifError
  —— 不在此表的名稱（含未來 Node 版本新增者）→ unsupported fail-closed，
     不得以「看起來像 assertion」放行。

assertion call 的精確定義:
  (a) 對 **assertion-object binding** 的成員呼叫，成員名 ∈ allowlist   → assert.ok(...)
      —— 三種 object binding 皆適用，含 strict alias：
         import { strict as assert } from "node:assert";  assert.ok(...)
  (b) 對 **assertion-function binding** 的直接呼叫，原名 ∈ allowlist   → ok(...)
  (c) 對 default binding 的直接呼叫                                   → assert(...)
      —— node:assert 的 default export 本身可呼叫，等義於 ok
      —— namespace binding **不可**直接呼叫（namespace object 非 callable）→ unsupported
  callee 都必須解析回上列 import binding；computed member（assert[expr]）→ unsupported

test declaration      : test binding 的直接呼叫，第一引數為字串字面值
                        —— placement、argument 數量與 callback profile 見 §11b.6b（closed）
container declaration : describe binding 的直接呼叫，第一引數為字串字面值
                        —— 同上，見 §11b.6b
modifier              : .only / .skip / .todo 支援（同一 declaration，modifier 不進 identity）；
                        其他成員存取 → unsupported
nested container      : 支援任意深度；container chain 依詞法巢狀由外而內
hooks                 : hook binding 的直接呼叫即 fixture declaration —— **只有**經上列合法
                        static binding 取得者才算；不承載 tag，但參與 oracle closure（11b.9）
                        —— argument 與 callback profile 見 §11b.6b；
                           span 與 applicability 見 §11b.9e
```

**明文 unsupported（全部 fail-closed）**：第一引數非字串字面值（變數、含插值模板、串接、函式回傳）；迴圈／map／工廠產生的 parameterized 或 generated declaration；computed member；經物件屬性的間接別名；CommonJS `require`；`import()`；reflection 或執行期組出的 declaration。無插值的模板字串（`` `name` ``）視同字串字面值，允許。

**其他 assertion library**（chai、expect…）在本 profile 維持 unsupported fail-closed，除非另立 adapter／profile。

### 11b.6b Declaration placement 與 callback profile（closed；v1.7 新增）

§11b.6 說了什麼是 `node:test` binding，卻沒說一個**呼叫**要長在哪裡、帶什麼參數才算 declaration。兩個 writer 因此可以對同一份 source 得到不同的 declaration 集合。本節是這件事的**唯一** normative 規則。

**合法 declaration placement**

```
test／container／hook declaration 必須是一個完整的外層 ExpressionStatement，且只能是：
  (a) Program.body 的直接元素；或
  (b) 某個已合法辨識之 container callback 的 BlockStatement.body 直接元素。

不得跨越普通 function、class、if、switch、loop（for／while／do）、try／catch／finally、
非 container 的 callback，或任何其他控制結構，把其中的呼叫推測成靜態 declaration。

辨識到 node:test binding 的呼叫但 placement 不符 → unsupported-syntax fail-closed。
—— 不是「略過」：一個看得見的 test 呼叫沒有被登記，正是本模型要防的靜默漏審。
```

**test／container 的 argument 與 callback profile**

test binding、其 `.only`／`.skip`／`.todo`，以及 describe binding 的合法呼叫：

```
arguments        : 恰兩個
argument 0       : §11b.6 已允許的字串 literal 或無插值 template literal
argument 1       : FunctionExpression 或 ArrowFunctionExpression
callback body    : 必須是 BlockStatement
async            : true 或 false 皆可
generator        : FunctionExpression.generator 必須為 false
parameters       : 零個以上的簡單 Identifier；default、rest、destructuring 不支援
```

**hook 的 argument**

`before`／`after`／`beforeEach`／`afterEach` 的合法呼叫：

```
arguments : 恰一個
argument 0: 與上方**完全相同**的 callback profile（BlockStatement body、非 generator、
            簡單 Identifier parameters、async 可有可無）
```

**全部 unsupported（fail-closed，不得寬容解析）**：options argument（無論第幾個位置）、spread argument、缺 callback、多餘 argument、concise arrow expression body（`() => expr`）、generator callback、default／rest／destructuring parameter。

**Declaration name（structuralId 的名稱來源）**

```
名稱 ＝ ECMAScript 解碼後的 StringValue：
  string literal            → parser 回報的 decoded string value
  無插值 template literal   → cooked value
不使用 raw token、不使用引號形式、不使用 escape 拼法。
decoded value 不 trim、不 case-fold。
```

因此 `"same"`、`'same'`、`` `same` ``、`"\x73ame"` 四種**不同的 source 拼法**得到**同一個名稱**；只有實際 StringValue 不同才是不同名稱。這條與 §11b.8 的 duplicate-name 規則直接相扣：拼法不同但 StringValue 相同者，屬同一 duplicate group，因而各自需要唯一 `@tid`。

### 11b.7 Stable test ID（node:test v1）

```
stableIdRule    : "line-comment-tid-v1"
exact syntax    : 單行註解中一整行恰為   @tid <ID>
                  —— v1.7：唯一 lexical form（兩個分隔位置各恰一個 U+0020、
                     ID 後不得有任何內容）見 §11b.8c；本行為沿革敘述
ID grammar      : ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$
位置            : 與 @src 同一 attachment block（11b.5），block 與 declaration 間無空白行
與 @src 的順序  : 不拘（digest 不受影響，由 11b.8b 的 byte 演算法實際保證）
uniqueness scope: **在 base view 內唯一，且在 head view 內唯一 —— 兩個 view 分別檢查**。
                  範圍是該 adapter 在該 view 涵蓋的所有檔案，不只是單一檔案。
                  同一個 @tid 在 base 恰一次、在 head 恰一次，是**合法的 matching pair**
                  （unchanged 與 moved 的常態），**不得**判為 duplicate ——
                  duplicate 的判準是「單一 view 內出現兩次以上」。
                  跨檔重複必須在 **matching 之前** fail-closed，
                  否則 move-only 無法可靠使用 path-independent ID。
```

**fail-closed**：同一 declaration 兩筆 `@tid`；**同一個 view 內**兩個 declaration 使用相同 `@tid`（duplicate，含跨檔）；`@tid` 附著於 container（borrowed）；ID 不符 grammar 或該行含額外內容；`@tid` 與 declaration 之間有空白行。

**定位**：stable ID 存在時優先於推導的 `structuralId`。它是 **identity hint，不是 provenance binding** —— 不表示任何 clause 綁定、**不得取代 `@src`**、不計入 tag cardinality，且依 11b.8b 不進入 `declarationDigest`／`bodyDigest`。

### 11b.8 `structuralId` 演算法（node:test v1）

```
輸入 : 一個 test declaration 的 AST 節點與其詞法 container chain
輸出 : path-independent 的檔內結構鍵

  1. 帶合法 @tid → structuralId ＝ "tid:" + <ID>，結束
  2. 否則取 container chain（由外而內）與該 declaration 的宣告名，
     名稱原樣取用（不 trim、不 case-fold），以 canonicalJson 編碼
  3. structuralId ＝ "s:" + canonicalJson([...chainNames, declName])
  4. **同一 container chain 內若有兩個以上 declaration 產生相同的 step-3 鍵，
     該 duplicate group 的每一筆都必須帶唯一合法 @tid；缺任一筆 → fail-closed。**
```

**為何不用詞法序號（v1.6 修正）** —— 初稿以 `#n`（詞法出現順序）為 duplicate 消歧，那會**靜默錯配 identity**：

```
base:  test("same", A) → #0        head:  test("same", NEW) → #0
       test("same", B) → #1               test("same", A)   → #1
                                          test("same", B)   → #2
```

前插一筆同名 test 後，base 的 A 被配給 head 的 NEW、base 的 B 被配給 head 的 A，**全程 one-to-one、沒有任何 collision 可觸發 fail-closed**，於是兩筆 provenance 被無聲借用。序號是位置，不是身分。因此 duplicate name 一律要求 `@tid`，且**不得**以位置、body digest 或降級成 added＋deleted 來猜測。

**其餘性質**：path 不入 `structuralId` ⇒ 純搬檔保持 identity（`status=moved`）；reorder 不改 identity（`s:` 鍵不含位置，`tid:` 鍵不含位置）；container 改名／巢狀改變使 `structuralId` 變動，走 §6 既有 matching 規則。**Matching 必須 one-to-one**；collision、一對多、多對一全部 fail-closed，不得降級成 added＋deleted。**v1.13 明確化**：「走 §6 既有 matching 規則」與「不得降級成 added＋deleted」先前對撞 —— container rename 在舊 rule 3 下恰好會產出 added＋deleted。§6 的 **residual-side exclusivity gate** 是唯一裁定：rule 3 只在 residual 單側存在時適用，兩側同時有 residual 即 `unresolved-identity-drift` 整輪 fail-closed。因此本句的「不得降級」在 v1.13 下**逐字成立**，不再需要讀者自行調和。排序與編碼依上游 SM §2 canonical JSON 與 Unicode code point 序。

### 11b.8b Canonical declaration bytes 與 `@tid` 排除（exact）

§2 的 body span 含 attachment block，而 11b.7 要求 `@tid` 不進 digest。兩者只能有**一個** byte 演算法：

```
步驟 0（前置）  : **先**把該 view 的 sourceText 正規化為 UTF-8 無 BOM、行終止符一律 LF，
                 **再**交給 parser 建立 range。range、行號、span 皆定義在正規化後的 bytes 上。
                 —— 順序不可顛倒：先切 range 再逐行移除，CRLF 檔案會留下孤立 CR。
source range   : 仍包含完整 attachment block（供 tag／stable-ID parser 使用）
                 —— v1.7：其 exact 起點與終點由 §11b.8c 定義（最外層 ExpressionStatement）
hashing 之前   : 自該 range 逐行掃描，移除**合法且已附著**的 @tid 行，
                 連同其（已為 LF 的）行終止符；檔尾最後一行則無終止符可移。
                 移除後**不得留下任何 CR**。
其餘           : 其他註解、@src 行、declaration bytes 一律保留，
                 之後套用 §2 既有 canonical 規則（不 trim 內部空白）
不得移除       : malformed @tid（不符 grammar／行內有其他內容）
                 unattached @tid（與 declaration 之間有空白行）
                 —— 兩者本來就已 fail-closed，不會走到 hashing
```

由此**推導**（非散文宣稱）：同一份邏輯內容分別以 LF 與 CRLF 存檔，經步驟 0 後 bytes 完全相同 ⇒ 兩者所有 digest 相同（見 CRLF／LF 等價 AC）。`@tid` 與 `@src` 換序後，被移除的恰是同一組 `@tid` 行，剩餘 bytes 逐字相同 ⇒ `declarationDigest` 相同。`@tid` 的值或位置改變會改變 identity，但**不改** `declarationDigest`；任何一般註解的改動仍會改變 digest。

### 11b.8c Attachment block、directive 語法與 canonical declaration range（exact；v1.7 新增）

本節所有 range 都在 **§11b.8b 步驟 0 的 UTF-8／LF 正規化完成後**計算。它是 attachment 與 declaration range 的**唯一** authority；§11b.5 與 §11b.7 的敘述性條文以本節為準。

**Attachment block 的掃描規則**

```
基準       : declaration 起始的實體行（physical line）
方向       : 由該行向前逐行掃描
每一行必須 : 只含可選的 SP／HTAB indentation，加上一個 // single-line comment
相鄰       : 與下一行直接相鄰（中間沒有空白行、沒有非 line-comment 行）
停止條件   : 遇到空白行、非 line-comment 行，或檔案開頭
結果       : 距 declaration 最近的那個 **maximal 連續 block**
```

**只有這個 maximal block 能附著。**更早、且被空白行或任何非 line-comment 行隔開的 directive 是 **unattached**。

**Directive accounting（不得靜默忽略）**

```
每一個「看起來意圖使用 @src 或 @tid」的 line comment 都必須得到唯一歸屬。
以下全部 fail-closed：
  malformed（有 directive 意圖但不符下方 exact syntax）
  unattached（不在任何 declaration 的 maximal block 內）
  ambiguous（同時可歸屬兩個 declaration）
  borrowed（附著到 container、hook 或普通 helper —— 三者皆不得承載 @src 或 @tid）
**不得**因為某一行「沒有成功附著」就當成普通註解而略過。
```

**`@src` 的唯一 lexical form**

```
physical line（不含結尾 LF）:
  [SP|HTAB]*  "// @src "  <§2 canonical tag token>
  ── "//" 之後恰一個 U+0020
  ── "@src" 之後恰一個 U+0020
  ── token 之後不得有任何空白、註解或其他內容
```

**`@tid` 的唯一 lexical form**

```
physical line（不含結尾 LF），語義即 ^[\x20\t]*// @tid <ID>$ :
  兩個固定分隔位置各恰一個 U+0020
  <ID> 依 §11b.7 的既有 ID grammar
  ID 之後不得有 trailing whitespace 或任何其他內容
```

**Directive-intent predicate（唯一判準）**

前面說「看起來意圖使用 `@src` 或 `@tid`」，但沒說怎麼判。兩個 writer 會在這裡分歧，所以判準本身必須是演算法：

```
1. 取 physical line，先移除 line-start indentation（零個以上 SP／HTAB）。
2. 其後必須緊接著 "//"；否則不是 line comment，不進入本判準。
3. payload ＝ "//" 之後、LF 之前的**原始 bytes**（不做任何轉換）。
4. **僅為判斷 intent**：對 payload 移除零個以上 leading SP／HTAB。
5. 若剩餘 bytes 以 literal "@src" 或 "@tid" 開頭 → 這一行是 **directive-intent candidate**。

成為 candidate 之後，**仍必須讓整個原始 physical line 逐 byte 吻合上方 exact lexical form**。
**不得**拿步驟 4 那個 trim 過的內容放行 —— 那個 trim 只存在於 intent 判定，不參與合法性判定。
```

由此**推導**（非個案列舉）：`//@src …`、`//  @src …`、`//\t@src …`、`// @src  TOKEN` 四者**都是 candidate**（步驟 4 之後都以 `@src` 開頭），但都不吻合 exact form，因此**都是 malformed，全部 fail-closed**。反之 `// explanation of @src` 在步驟 4 之後以 `explanation` 開頭，**不是 candidate**，就是一般註解。`@tid` 同理。

tag token 與 ID 的文法**不在此重複**：`@src` 的 token 引 §2 唯一 grammar，`@tid` 的 ID 引 §11b.7。

**`@src REQ-…@DP-…` 的分層（adapter 與 pipeline 的職責切分）**

adapter capability 在解析 tag 時**沒有** provenance-store context，卻被舊文字要求判斷「是否 exception-backed」。該職責切分如下：

```
adapter 負責（純 lexical／structural，不需 store）:
  attachment、cardinality、上方 exact lexical grammar
  DEC-…@DP-… 與 ASSUM-…@DP-… 的結構拒絕（這兩者永遠不得帶 qualifier）
  把 REQ-…@DP-… 解析成 { clauseRef, dpRef }

inventory pipeline 負責（需要 store）:
  以**同一份 captured provenance-store pre-state** 驗該 REQ 是否確為 exception-backed，
  並依 §7 驗其五項綁定
  —— 在此 semantic validation 通過之前，**不得接受或 emit 任何 inventory entry**
```

**這不是放寬**：最終合法集合與 §2／§7 完全相同，非 exception-backed 的 `REQ-x@DP-y` 仍然 fail-closed，只是拒絕發生在有 store context 的那一層。「adapter 不驗 store」**不得**被讀成端到端 fail-closed 被放寬。

**Canonical declaration range（唯一定義）**

```
syntactic declaration range
  ＝ pinned parser 回報的**最外層 ExpressionStatement** 的 [byteStart, byteEnd)
  ── 原始語法若有 semicolon，它位於該 ExpressionStatement range 之內，因此**進 digest**
  ── trailing whitespace、行終止符、statement 之後的 trailing inline comment 都**不在** range

canonical source range
  start : 有 attachment block → 該 maximal block **第一行的 line-start byte**（含該行 indentation）
          無 attachment block → ExpressionStatement.byteStart
  end   : 永遠是 ExpressionStatement.byteEnd
  ── range 包含 block 與 declaration 之間的 LF、indentation，以及所有非 directive 的 line comment

其後才依 §11b.8b 移除**合法且已附著**的完整 @tid physical line（連同其 LF）。
@src 行、一般註解、semicolon 與其餘 declaration bytes 全部保留。
```

**不得**以內層 `CallExpression`、callback function 或 callback body 作為 `declarationDigest` 的 range —— 那會讓「只增刪一個 semicolon」或「改動 callback 外的 bytes」不改變 digest。

### 11b.9 Effective-oracle edge contract（closed）

**兩類 edge，只有一類進 digest** —— 初稿把 static-local-import 無條件計入，那會把「被測程式改了」偷換成「oracle 改了」：幾乎每個測試都 import SUT，於是任何實作變更都把測試標成 `modified`，反向閉包失去鑑別力。

```
traversal / resolution edge  : 供解析 binding 與 call target 之用。
                               **本身不產生 depRef，不進 effectiveOracleDigest。**
oracle dependency edge       : 產生 depRef 並進 digest。
```

**Oracle dependency edge（closed；恰三列，其餘一律不進 closure）**：

> **`external-expected-data` 已從 node:test v1 移除（v1.6 第三輪）** —— 它原本只說「`import` 一個以 `.json` 結尾的 specifier」，缺 import form、import attribute（`with { type: "json" }`）、specifier 解析與 repo boundary，是一條**半開的 edge**。要嘛補完整的 static JSON import 契約，要嘛移除；本版選擇**移除**，因為 expected data 的可重現讀法已由 **snapshot-golden** 完整承載（它有 exact specifier、API allowlist、引數位置、模組相對解析根與 repo boundary）。因此 JSON import 落入 unsupported edge，**fail-closed**，不會被靜默略過。

| # | Edge kind | 產生條件 | depRef.path | depRef.span |
|---|---|---|---|---|
| 1 | local-assertion-helper | 呼叫一個同 view 內可靜態解析的函式，其遞迴展開含 11b.6 定義的 assertion call —— **callable 子集與 module resolver 的 closed 定義見 §11b.9f** | 被呼叫函式所在檔 | `{ kind: "whole-file" }` |
| 2 | fixture-hook | 經合法 hook binding 取得的 before／after／beforeEach／afterEach —— **applicability 的 closed 規則見 §11b.9e** | 宣告所在檔 | callback `BlockStatement` 的 byte-range（含大括號）；**exact 形狀見 §11b.9e** |
| 3 | snapshot-golden | 下方 snapshot-golden 契約所定義的 fs 讀取 | 解析出的 canonical repo-relative path | `{ kind: "whole-file" }` |


**snapshot-golden 的 exact 契約（closed）**：

```
module specifier : 恰為 "node:fs" 或 "node:fs/promises"
合法 import form : default binding、namespace binding（import * as fs）、
                   named binding（含 as 別名）；三者皆須解析回上述 specifier
API allowlist    : readFileSync（來自 node:fs）
                   readFile    （來自 node:fs 或 node:fs/promises）
                   —— 恰為此二者；其餘 fs API 一律 unsupported
path 引數位置    : index 0，且必須是下列**唯一**合法形式：
                     new URL(<plain string literal>, import.meta.url)
                   —— 選此形式是因為它是**固定且可重現的 syntax carrier**，與 process cwd 無關；
                      裸的 cwd-relative 字面值（readFileSync("fixtures/a.json")）
                      **unsupported**，它的意義取決於呼叫者的工作目錄，不可重現。
                   —— **v1.9**：該 literal 的 StringValue 必須先通過 `./`／`../` prefix gate；
                      AST carrier 的逐節點 exactness 與 path resolution 的**唯一**演算法
                      見下方專節，**本行不再是該演算法的 authority**。
相對解析根       : 該 snapshot call **實際所在** module 在**同一 view** 內的 canonical path
                   —— **v1.9** 收斂：是該 call 所在的 module，**不是** root test module（專節第 10 步）
repo boundary    : 解析結果必須落在 repo root 之內；任何逃逸（../ 越界、絕對路徑、
                   symlink 指出 repo）→ fail-closed
未列 API、computed path、變數 path、模板插值 path → 一律 unsupported fail-closed
```

**snapshot path 的唯一 resolution algorithm（exact；v1.9 新增）**

v1.8 定死了 `new URL(<string literal>, import.meta.url)` 這個形式，也說了結果必須是 repo 內的 canonical
repo-relative path，卻**沒有**說那個 literal 怎麼變成那個 path。同一個字串因此至少有三種讀法 —— WHATWG URL
解析後 percent decode、視為字面 POSIX 文字、或套 §11b.9f 的 lexical 演算法。反例：
`readFileSync(new URL("fix%74ures/g.txt", import.meta.url))` 在三者之下分別得到 `fixtures/g.txt`、
`fix%74ures/g.txt` 與 fail-closed —— 三個都是「合規」的讀法，因為以前根本沒有規則。本節是這件事的**唯一**
normative 規則。

**AST carrier 的逐節點 exactness**

```
snapshot call  : 仍必須是上表 allowlist 內、且解析回 node:fs／node:fs/promises 的 fs binding
path 引數位置  : index 0
callee         : Identifier `URL`，且**未被**任何 local、import 或 parameter binding shadow
                 —— 一旦被 shadow，該 identifier 指向什麼是執行期的事 → **unsupported**
arguments 數量 : **恰兩個**
argument 0     : **plain string literal**。template literal（**含無插值者**）、變數、串接、
                 或任何其他 expression → **一律 unsupported**
                 —— 此處刻意**不**沿用 §11b.6b 對 declaration name 的 template 寬容：
                    那條寬容只適用於名稱，不適用於會解析成檔案路徑的字串
argument 1     : 逐節點**恰為**
                   MemberExpression(
                     object   = MetaProperty(meta     = Identifier "import",
                                             property = Identifier "meta"),
                     property = Identifier "url",
                     computed = false
                   )
                 —— `new.target.url`（MetaProperty 為 new.target）、
                    `import.meta["url"]`（computed = true）、
                    其他 MetaProperty、其他 property name → **一律 unsupported**
```

**Path resolution（十步，依序；唯一演算法）**

```
1.  取 parser **解碼後**的 argument 0 StringValue。
    判定一律依 **decoded StringValue**，**不**依 raw token 的拼法。
2.  StringValue 必須以 literal "./" 或 "../" 開頭，否則 **unsupported**。
    因此下列全部拒絕：
      "fixtures/golden.txt"        ← 無前綴，讀起來就是 cwd-relative
      "/absolute/golden.txt"
      "C:/golden.txt"
      "file:golden.txt"
      "mailto:golden"
      "https://example/golden"
3.  將 StringValue 視為 **POSIX path 文字**。
4.  **不**呼叫 WHATWG URL parser、**不**呼叫 URL constructor、**不**呼叫 fileURLToPath、
    **不**做 percent decoding。
    `new URL` 在本契約中只是**固定且可重現的 syntax carrier**，**不是** resolution authority ——
    它在此**不提供** WHATWG resolution semantics。
5.  出現下列任一項即 **unsupported**：
      "%"  ／  "\"  ／  "?"  ／  "#"
      合法開頭的 "."／".." traversal 以外的**空 segment**
6.  以該 snapshot call **所在 module** 的 canonical POSIX dirname 初始化 segment stack。
7.  以 segment stack **lexical** 消解 "." 與 ".."；任何 pop 超出 repo root → **立即 fail-closed**。
8.  結果必須**同時**滿足：
      canonical repo-relative POSIX path
      不含任何 dot segment
      **不**經 Windows case-folding、**不**經 OS path normalization
      **精確命中**同一 captured immutable view 內的 entry
9.  全程**只讀該 view**：**不讀 live filesystem**、**不跟隨 symlink**；
    entry type 與 symlink 的處理沿用 **§11b.10** 既有 authority，本節不另立。
10. module 相對根**必須是該 snapshot call 實際所在的 module**。
    跨 module helper 內的 snapshot **不得**錯用 root test module 的路徑 ——
    兩者 dirname 不同時，錯用會安靜地解析到另一個檔案而**不會**報錯。
```

**與 §11b.9f 的關係（明文共用，不是實作者的類推）**

```
第 3、5、7 步的 lexical segment-stack 規則與 §11b.9f「Relative specifier 的 lexical normalization」
**是同一套**；本節**明文共用**它，兩處因此不得各自演化。
—— 這是**明文共用**，**不是**留給實作者自行類推：v1.8 之下 §11b.9f 的標題與內文都只涵蓋
   **module specifier**，而 snapshot path **不是** module specifier；
   任何「照抄過來」的作法在 v1.9 之前**都沒有規則支撐**。

兩者仍有**一處刻意不同**，不得互相覆蓋：
  §11b.9f（module specifier）: 前綴必須是 "./" 或 "../"，且副檔名**必須明寫** .mjs ／ .js
  §11b.9 （snapshot path）   : 前綴同樣必須是 "./" 或 "../"（本輪新增的 gate），
                               但**不限副檔名** —— golden 檔可以是任何副檔名
```

**assertion-root 不再產生 depRef** —— declaration 本體內的 assertion call 是**分類證據**（用來判定某個 helper 是否 assertion-bearing），root bytes 已由 `declarationDigest` 承載，再放一次 depRef 是重複計入。

**static / local import 只有在**該 imported binding 位於上表某條 oracle contributor 路徑上時才進 closure。**單純 import 或呼叫被測 production module 不進 oracle closure。**

**關於「assertion-bearing production callable」的誠實邊界** —— v1 採**結構分類**：判準是「該 callable 的遞迴展開內是否出現 11b.6 allowlist 的 assertion call」，**不是**它在專案裡的真實角色。因此，任何**可達且含 supported assertion 的 callable 都會被保守地視為 oracle contributor**，即使作者認為它是 production code（例如以 `node:assert` 寫 invariant 檢查的 production 模組）。這是刻意選擇的保守側：漏標 oracle 會讓 provenance 失效，多標只會讓該測試多進一次 review。**機械層不知道、也不宣稱知道**某個 callable 真實的 helper／SUT 身分；任何相反的敘述都是過度宣稱。要排除這類 callable，只能靠它不含 allowlist 內的 assertion，或日後另立 typed 標註契約 —— v1 不提供後者。

**Unsupported edge（全部 fail-closed，不得以空 closure 代替）**：`import()`／`require()`；未列於 allowlist 的 fs API；computed、變數化或模板插值的 fs 路徑；裸 cwd-relative 路徑字面值；reflection、執行期組出的 assertion；無法唯一解析的 import binding；指向該 view 外或不存在的 specifier。

**「看不到 assertion」不得自動解讀成空 closure** —— 只有「每條 edge 都成功解析且集合確實為空」才是空 closure。

**遞迴與去重**：非 root 節點沿用**同一**展開規則；`cycle` 以已訪問集合終止，不重複計入、不報錯；結果依 canonical `depRef`（先 `path` 後 `span`）以 code point 序排序去重，**插入順序不影響 digest**。

**base／head 各自展開**，絕不混用。

### 11b.9b `implementationIdentity`：registry 與 entry 兩側 carrier

初稿只在散文寫下這個值，registry 與 inventory 都不承載它 —— parser 換版後 checker 無從得知 artifact 是哪個 parser 產生的。v1.6 把它同時落成 **registry `adapters[]` 欄位**與 **inventory entry 欄位**：

```
adapter.implementationIdentity（§11b.3）:
  { implementationId, parserId, parserVersion }
  implementationIdentity.implementationId == adapter.implementationId  （不等 → fail-closed）

entry.implementationIdentity（exact key set，三欄皆必填非空字串）:
  { implementationId, parserId, parserVersion }
  必須**逐欄等於**該 entry 之 adapterId 所對應 adapter 的 implementationIdentity
  不等、未宣告 key、缺 key、空字串 → 各自 fail-closed
```

只放 entry 側是不夠的：沒有 registry 側的宣告，entry 的 identity 就沒有可比對的權威，任何值都能自洽。

**Consumer 有三處**：(i) registry binding —— adapter 自身的 `implementationId` 一致性；(ii) inventory entry —— 上述 exact shape 與逐欄相等；(iii) freshness —— entry 進 `inventoryDigest`（§11b.9c 公式），identity 改變**必然**改變 digest，於是既有的 batch↔inventory 對位（AC60／§8）自動使舊 batch 變 stale。

**TestSemanticReviewBatch 不另複製這三欄** —— 它已由 `inventoryDigest` 綁定；複製會製造第二個 authority。**clean `entries=[]` 的既有 Phase 2A（v1 envelope）artifact 不受影響**（沒有 entry 就沒有這個欄位）。

`parserId`／`parserVersion` 的**實際值**由後續 dependency authorization 提供（§11b.11）；本 spec 閉合的是 carrier 與相等性義務，不是值。

### 11b.9c Envelope digests 與 consumer freshness（完整 universe）

**per-entry identity 不足以構成 freshness proof** —— 它只證明「已列出的 entry 是誰產生的」，不證明「該列出的都列了」。v2 envelope 因此另立兩個涵蓋完整 universe 的 digest：

```
registryDigest  = sha256(canonicalJson({
                    registry       : <完整 exact test-adapters.json root，含 registryVersion；
                                      每次 S3 重新讀取的 current root，見下 v1.11>,
                    explicitConfig : <head-view exact config object> | null
                  }))
  —— registry 取整份 root（不是只有 adapters），因為 registryVersion 同樣影響解讀。
  —— explicitConfig 指 **head view** 的 .ctide/test-adapters-config.json 完整物件，
     **且該 path 必須 tracked**（v1.11；carrier 判定見 §11b.4）；
     該 path 不在 snapshot 內時為 null —— 存在但 untracked 是 **fail-closed**，
     不是 null。**base view 的 config 由 baseTreeOid 綁定**，
     已含於 base tree 的 immutability 內，不重複進本 digest。

headViewDigest  = sha256(canonicalJson(<S1 canonical map>))        ← S1 見 §11b.10

inputProvenanceStoreDigest
                = inventory 產生當下 current .ctide/provenance.json 的 digest
  —— digest 記法必須與 store 自身的 CAS 記法相同（direct-inspect 結論，見下）。

inventoryDigest = sha256(canonicalJson({
                    inventoryVersion, baseTreeOid, registryDigest,
                    headViewDigest, inputProvenanceStoreDigest, entries }))
  —— 這是 v2 的**唯一**公式；任何只涵蓋 { baseTreeOid, entries } 的算法都是 v1 legacy。
```

**每次 S3 都必須重新觀測 registry（v1.11 定案；唯一規則）** —— `registryDigest` 的 registry 半邊是「**當下**的 shipped registry」。跨 invocation 沿用一份已快取的 root，會讓第二次 S3 對一份**已經改過**的 registry 回報 fresh —— 那正是 AC118(c) 想擋而擋不到的失敗面：

```
每一次 consumer S3 verification invocation:
  必須**重新讀取** shipped test-adapters.json。
  該 invocation 內**只讀一次** —— §11b.3 schema validation 與 registryDigest
    preimage 必須使用**同一次讀取的同一個 parsed root**。
  **不得**在「被驗證的 bytes」與「被雜湊的 bytes」之間再讀第二次
    —— 那會在兩者之間開出 TOCTOU 窗口。
  **不得**跨 S3 invocation 沿用 cached registry root、descriptor 或 digest。

與一般 loader cache 的關係:
  一般 adapter resolution loader **仍可**保留自己的 cache；本規則**不撤回**它。
  但該 cache **不得**充當 S3 的 current-registry observation。

validate-before-hash（唯一順序）:
  schema-invalid 的 current root → 先依 §11b.3 fail-closed；
    **不得**對未通過 schema 的內容計算 registryDigest。
  只有 schema-valid 的 current root 才能進入 registryDigest preimage。
  ⇒ schema-valid mutation 必然成為 **registryDigest mismatch**；
    schema-invalid mutation 必然成為 **registry schema failure**。
```

**`inputProvenanceStoreDigest` 的 digest 記法（direct-inspect 結論）** —— 本欄的用途是與上游交易的 pre-state 比對，因此它**必須與 store 自身 CAS 使用同一種記法**，否則兩個值永遠不可能相等：

```
記法         : sha256(canonicalText(檔案文字))
               canonicalText ＝ 去 BOM、CRLF/CR → LF
               —— 即上游 store 載入時所得的 digest，也正是其 CAS 的比對對象
store 不存在 : 取上游 canonical empty store 的 digest（**不是** null、不是空字串）
               —— 上游對缺檔已有明確定義，下游不得另立第三種語義
不得混用     : baseProvenance.storeDigest（historical immutable base tree 的 store）
               驗的是 **raw bytes** digest —— 不同對象、不同記法的另一個檢查。
               把 raw-bytes 記法套到 current store 上，會在任何帶 BOM 或非 LF 的
               檔案上與上游 CAS 永久不一致，且失敗看起來像 race 而非記法錯誤。
```

**Preimage 必須被持久化（v1.6 第四輪修正）** —— `inventoryDigest` 是 opaque 值。只持久化它，**證明不了它的 preimage 用的是哪一個 store pre-state**：

```
1. inventory I0 記錄 inputProvenanceStoreDigest = D0，inventoryDigest = H0 = hash(… D0 …)
2. Step 5 之前 store 變為 D1
3. caller 只把 payload.expectedInputProvenanceStoreDigest 改成 D1，batch／record 仍送 H0
4. writer 驗得過「expected == 實際 pre-state == D1」，但 H0 是不透明的 ——
   它沒有 typed preimage 可驗 H0 裡用的是 D0
5. committed record 沒有保存實際使用的 D1
6. Step 6 只看到 batch.H0 == inventory.H0，**永遠發現不了 D1 != D0**
```

因此以下三項都不成立，全部撤回：「`expectedInputProvenanceStoreDigest` 已由 `inventoryDigest` 遞移持久化」、「Step 6 可事後證明交易確實以該 inventory pre-state 提交」、「shared model 完全不需修改」。

修正方式是**把 preimage 本身持久化**：

```
batchSnapshot.inventorySnapshot : ChangedTestInventoryV2（完整 exact v2 envelope）
  —— 唯一 authority；record.inventoryDigest 由它派生。
  —— **exact key set 與 inventoryDigest 唯一公式的 authority 在上游 SM v1.13**
     （本文是 downstream，不得自持進入 persisted record 的形狀）；
     本節定義的是四個 digest 各自的**計算語義**。
  —— 它必須通過：exact key set、inventoryDigest 唯一公式重算、
     inputProvenanceStoreDigest 的 digest 記法、entries canonicalization。
  —— record 另必須帶 SM v1.13 的 batchRecordVersion: 2；legacy 記錄的
     可讀範圍、禁止用途與 chain 行為見 SM 的 legacy boundary。

交易內強制等式（intent-scan §8；任一不符 → 整筆 no-write）:
  loadedStoreDigest
    == payload.expectedInputProvenanceStoreDigest
    == batchSnapshot.inventorySnapshot.inputProvenanceStoreDigest
  provenanceBatch.inventoryDigest
    == batchSnapshot.inventorySnapshot.inventoryDigest
    == 由 inventorySnapshot 重算所得的 inventoryDigest
  invocation option --expect-digest 若存在，也必須等於同一值。
```

**不得**改以「把 pre-state digest 複製到 record top-level」代替 —— 那仍證明不了它參與過 preimage，且會製造**第三個** authority。上游因此連同修訂並與本文同輪放行：**shared model v1.13**（`inventorySnapshot` 的持久化、最小 authoritative envelope 與 `inventoryDigest` 的 derived 語義）、**intent-scan v1.9**（payload 欄位與交易內等式鏈）。三者為 coupled set，不得分開採用。

### 11b.9d 兩種 freshness 必須分離

`headViewDigest` 與 `inputProvenanceStoreDigest` 檢查的是**不同對象，時間語義也不同**：

```
source freshness  : head 的 source／config／oracle universe ＋ registry
                    —— consumer 以**當下**狀態（S3）重算並要求相等。
                       它們在 Step 5 不應改變；改變即代表世界動了。
provenance-store
freshness         : inventory 產生當下的 store 狀態
                    —— **Step 5 自己就會合法改寫 store**，因此
                       **絕不能**拿當下 store 與它比對。
                       它只作為交易的 pre-state precondition，
                       以及事後「該 batch 由哪個 pre-state 產生」的證明。
```

兩者混為一談會二選一地壞掉：把 store 併入 `headViewDigest`，Step 5 自己的合法寫入就讓 Step 6 必然 stale；兩者都不查，則 `governance-affected` entry（由 clause → test 反向閉包產生，其唯一輸入就是 store）完全失去 freshness。**因此 store 被排除於 `headViewDigest` 之外，但由 `inputProvenanceStoreDigest` 獨立承載 —— 排除不等於放棄。**

**上游對位（direct inspect，非發明）** —— 本欄不是只在 test-provenance 這一側新增的跨交易欄位：

```
上游現況 : provenance-store 已有 transaction 層 CAS，但它是 **invocation option**
           （expectedStoreDigest / --expect-digest）：可省略、caller 給定、且**不落盤**。
           它能擋住 race，卻**無法在事後證明**某個成功 batch 是由哪個 pre-state 產生的。
本輪變更 : intent-scan 的 commit-test-provenance-batch **payload** 新增 typed
           expectedInputProvenanceStoreDigest（必填），語義見 intent-scan §8。
           它必須同時等於 (i) 交易的 pre-state canonical store digest，
           與 (ii) 本 inventory 的 inputProvenanceStoreDigest。
持久化   : **前一稿宣稱「已由 inventoryDigest 遞移持久化、shared model 不需修改」——
           該宣稱撤回，它不成立。** 見下「preimage 必須被持久化」。
```

**Consumer freshness 協定（Step 6）**：consumer（`--provenance` checker 與 batch 消費端）在接受任何 inventory／batch **之前**，必須：

```
1. 以**當下** repo 狀態建立第三份 snapshot S3，重算 headViewDigest 與 registryDigest，
   與 envelope 內的值比對 —— 任一不符 → stale fail-closed。
   —— v1.11：registry 必須是**本次 invocation 重新讀取**的 current root
      （不得沿用跨 invocation cache），且 explicit config 必須先通過
      §11b.4 的 **tracked** carrier 判定。S3 仍**只有一份 snapshot**，
      本步驟**不**讀 current provenance store（見下第 3 點）。
2. 讀 **committed batchSnapshot.inventorySnapshot**（不是 opaque digest），並：
     a. 重算其 inventoryDigest，與 inventorySnapshot.inventoryDigest 比對；
     b. 驗 record top-level 的 derived equality：
        record.inventoryDigest == inventorySnapshot.inventoryDigest；
     c. 確認 inputProvenanceStoreDigest 位於 committed snapshot 之內，
        且該 snapshot 受 batchDigest 承諾（因而不可事後竄改）。
        —— 歷史三段等式（loadedStoreDigest == payload == snapshot）是
           **writer 的 transaction-time invariant**，**不由 Step 6 重新求值**：
           historical loadedStoreDigest 與 payload 都不是 persisted state。
3. **不得**把當下 store digest 與 inputProvenanceStoreDigest 比對 ——
   Step 5 對 provenance.json 的合法 mutation **必然**使兩者不同，
   拿它當 staleness 判準會讓每一筆正常 batch 都被誤判。
   S3 只重算 current headViewDigest／registryDigest，不觸碰 store。
```

S1／S2 保證 producer 讀到的是同一瞬間，S3 保證 consumer 消費的仍是同一世界。

**Step 6 的證明邊界（誠實表述；v1.6 修正）** —— 前一稿說「刪除 scratch 後可重播整條等式鏈」，那說得過強。實際可分兩類：

```
Step 6 事後**可以**做的:
  重算 committed inventorySnapshot 自身的 inventoryDigest，並與其宣告值比對
  驗 record.inventoryDigest 與 snapshot.inventoryDigest 的 derived equality
  驗 batchDigest 涵蓋 batchSnapshot（因而涵蓋 inventorySnapshot）
  把 snapshot 視為 **writer 交易當下完成驗證後留下的 committed witness**
  以 S3 重算 current headViewDigest／registryDigest（source freshness）

Step 6 事後**不能**做的（不得宣稱）:
  獨立重新觀察歷史的 loadedStoreDigest 或當時的 payload
    —— 兩者都不是 persisted state，交易結束即不可觀察
  只憑一個 digest 字串判斷它當初是以 canonicalText 還是 raw bytes 算出
    —— digest 不自帶記法標記
```

因此三段等式中，`loadedStoreDigest == payload == snapshot` 這一段是 **writer 在交易當下的義務**，其可信度來自 writer 實作通過對應 AC，而非事後可重新推導；Step 6 承接的是**已持久化的 witness 與由它導出的等式**。AC122／AC126 逐字對齊此界線。

**必須被擋下的三個反例（entries 本身完全不變）**：

```
(a) S2 之後新增一個測試檔          → S3 的 headViewDigest 改變 → stale
(b) S2 之後修改 explicit config    → S3 的 registryDigest 改變 → stale
(c) S2 之後修改 test-adapters.json → S3 的 registryDigest 改變 → stale
(d) inventory 之後、Step 5 之前，**其他 writer** 改動 provenance store
    → 交易的 pre-state digest != expectedInputProvenanceStoreDigest
    → 上游 CAS／precondition fail-closed、**整筆 no-write**
       （這條**不**由 S3 擋 —— 它是 Step 5 的 precondition，見 11b.9d）
```

三者若只靠 per-entry identity 或只靠 `{ baseTreeOid, entries }`，**全部會靜默通過** —— 既有 entry 沒變，digest 就沒變，而新增的測試從未被審。這正是本節存在的理由。

**Legacy v1 的處置**：v2 rollout 啟用後，凡符合 v1 exact absence shape 的文件一律**拒絕並要求重產**，不遷移、不推斷。**`entries: []` 的 v1 文件尤其不得被當成「已涵蓋、無變更」** —— 它沒有 `headViewDigest` 也沒有 `inputProvenanceStoreDigest`，無法證明 universe 為空，接受它等於為 populated coverage 開一個 bypass。判別方式依 §2 envelope 版本邊界：**v2 有 explicit discriminator，v1 只能以 exact absence shape 辨識**；形狀不吻合者一律 fail-closed，**不以 optional field 猜測**。

### 11b.9e Fixture-hook 的 span 與 applicability（exact；v1.7 新增）

§11b.9 表格第 2 列原本只寫「該 hook 的 body span」與「同 container chain」，兩者都不足以讓兩個 writer 得到同一組結果。本節是 fixture-hook 的**唯一** normative 規則。

**depRef 形狀**

```
{
  path: <hook declaration 所在的 canonical module path>,
  span: {
    kind: "byte-range",
    startInclusive: callback.body.byteStart,
    endExclusive:   callback.body.byteEnd
  }
}
```

`callback.body` 必須是 §11b.6b 所定義之合法 callback 的 `BlockStatement`。該 range **包含** `{` 與 `}`，**不包含** function／arrow 的 parameters，**也不是**大括號內部（不是 body 內容的 span）。

**Applicable hook 集合（closed）**

```
1. Program scope 的直接 hook（即 Program.body 的直接元素）
   → 適用於該 module 的**所有** test。
2. 每一個 ancestor container callback 的 **direct body** 中的 hook
   → 適用於該 container 的**完整 subtree**。
3. 一個 test 的集合 ＝ Program scope
                     ＋ 由外而內**所有** ancestor container scope
                     ＋ current container scope。
4. sibling container、descendant container，以及任何普通 function 內的 hook → **不適用**。
5. before／after／beforeEach／afterEach 使用**完全相同**的靜態 applicability 規則
   —— v1 不區分「每次」與「一次」的執行語義，那是 runtime 行為，不是靜態依賴。
6. 合法 scope 內的 hook，**不因**位於 test declaration 之前或之後而改變 applicability
   —— 位置是詞法巧合，不是依賴關係。
7. hook declaration 本身產生上述 fixture-hook byte-range depRef。
8. hook body **還必須**依 §11b.9／§11b.9f 的同一套 oracle traversal 規則遞迴展開，
   把它觸及的 helper 與 snapshot dependency 一併納入。
9. applicable hook 集合依 canonical depRef 排序去重，**不得**依發現順序輸出。
```

### 11b.9f local-assertion-helper 的 callable 子集與 module resolution（closed；v1.7 新增）

§11b.9 表格第 1 列的「同 view 內**可靜態解析**的函式」是一個沒有演算法的占位詞。本節把它收斂成封閉子集，並補上跨 module 的 resolver。

**合法 callable binding**

只支援 **direct identifier call**（`helper(...)`），且該 identifier 必須唯一解析至下列之一：

```
1. FunctionDeclaration
2. const <Identifier> = <FunctionExpression | ArrowFunctionExpression>

function／arrow 的 body 必須是 BlockStatement；generator 不支援。
```

**不在 v1 子集（全部 unsupported）**：`let`／`var` function binding、assignment 或任何 reassignment、destructured binding、object／class method、member／computed／optional-chain call target、runtime factory 產生的 function、ambiguous binding。

同一 module 內依 **ECMAScript lexical scope** 選最近的合法 binding。binding 不唯一、target 不符上述 closed form，或該 binding 存在 reassignment → **fail-closed**。

**分析 callable body 時**

```
掃描所有**可能執行**的 expression 與控制流程分支
  —— 不得因某個靜態條件「看起來為 false」而略過分支。
不自動進入**未被呼叫**的 nested function 或 class body。
只有經合法 direct identifier call 解析到的 callable 才遞迴展開。

每個 reachable CallExpression 都必須被分類為下列四者之一：
  1. §11b.6 的 assertion call
  2. §11b.9 的 snapshot-golden fs call
  3. 合法的 local callable（本節上方子集）
  4. 已明文列出的 unsupported form
未分類、dynamic、computed 或 ambiguous 的 call
  → **不得**以「它不是 oracle」為由靜默略過，一律 fail-closed。
```

**Closed relative-module resolution**

跨 module helper 只支援 **top-level static ESM relative import**：

```
specifier   : 字串 literal，且以 "./" 或 "../" 開頭
副檔名      : 必須明寫 .mjs 或 .js
不做        : extension probing、directory-index、package-exports resolution
禁止        : 反斜線、query、fragment、absolute path、repo-root escape
解析基準    : importer 的 canonical POSIX dirname
命中要求    : 結果必須精確命中**同一 captured S1／base view** 內的 blob
symlink     : 不跟隨，且不得作為 executable helper module
.js 的模式  : 依下方 package boundary 判定；.mjs 直接為 ESM
讀取來源    : parsing、binding 與 resolution 全程**只讀指定的 immutable view**，
              不讀 live filesystem
```

**`.js` helper 的 package boundary（closed）**

```
搜尋起點 : **resolved target helper module 所在的目錄** —— 不是 test 的目錄，也不是 importer 的目錄
搜尋方式 : 在**同一份指定的 immutable view** 內，自該目錄逐層向 repo root 尋找最近祖先 package.json
讀取來源 : 只讀該 view；**不讀 live filesystem**
判定     : 該 .js 只有在「最近的 manifest 能依本 spec 規則成功解析」∧「root 為 object」
           ∧「type 恰為字串 "module"」三者同時成立時，才是 ESM
fail-closed: manifest 不存在、malformed、缺 type、type 非字串、或 type 不是 "module"
           → 該 .js helper **unsupported fail-closed**
nested   : nested package boundary **覆蓋** root package 的判定 ——
           helper 目錄下方較近的 manifest 勝過 repo root 的那一份
```

**Relative specifier 的 lexical normalization（唯一演算法）**

```
1. 取 parser **解碼後**的 specifier StringValue。
2. 視為 **POSIX path 文字**：不做 URL 解析，不做 percent decoding。
3. specifier 內出現 "%" → **直接 unsupported** ——
   否則同一字串會有「URL escape」與「literal path」兩種讀法，兩個 writer 必然分歧。
4. 以 "/" 切 segment。除開頭合法的 "." ／ ".." traversal 外，**空 segment unsupported**
   （因此 "./a//h.mjs" fail-closed）。
5. 以 segment stack **lexical** 消解 "." 與 ".."；任何 pop 超出 repo root → **立即 fail-closed**。
6. 最終結果必須是**不含任何 dot-segment** 的 canonical repo-relative POSIX path，
   且精確命中該 view 內的 blob。
7. **不得**由 OS path normalization 或 Windows case-folding 改寫任何 segment。
```

**支援的 import form**：named import（允許 `as` alias）、default import。

**支援的 target export form**：

```
export function name() {}
export const name = <FunctionExpression | ArrowFunctionExpression>
export { local }            ← 不帶 from 的 local export list
export { local as exported } ← 同上
export default function ...
export default <FunctionExpression | block-bodied ArrowFunctionExpression>
```

**Unsupported**：namespace import、`export *`、任何**帶 `source`** 的 re-export、CommonJS、dynamic import、bare-package helper、extensionless import、不唯一的 export。`node:test`／`node:assert`／`node:fs` 的既有 closed 特例**不受本節影響**。

**只存在但未進入 traversal path 的 import 不自行產生 depRef。**當某個 imported binding 位於 reachable call path 上時，**必須**使用上述 resolver；解析不到**不得**當成 empty closure。

**Contributor 與 depRef**

```
若某 callable 自身、或其遞迴 reachable callable，含 §11b.6 allowlist 的 assertion：
  traversal path 上**每一個**符合此判準的 callable 都是 local-assertion-helper contributor；
  每個 contributor 產生其**所在 module** 的 { kind: "whole-file" } depRef；
  root test declaration 本身仍**不**產生 assertion-root depRef（§11b.9 既有規則）；
  同檔 contributor 仍產生該檔的 whole-file depRef；
  cycle 依既有 visited-set 終止 —— 可確定解析的 cycle **不是**錯誤；
  結果依既有 canonical depRef 排序與去重。
```

**只有**在「所有 reachable edge 都被完整、無歧義地分類」且「確實沒有 assertion、fixture 或 snapshot dependency」時，才可得到 empty closure。

### 11b.10 Base／head content view 與 snapshot 協定

```
base view ＝ baseProvenance.treeOid 指向的 EXACT immutable Git tree
            （型別必須精確為 tree；可 peel 成 tree 的 commit／tag 不等價）
```

**Head view 以不可變 snapshot 承載（v1.6 修正）** —— 初稿只要求「前後各取一次指紋」，卻沒說中間讀的是什麼；parsing 與 digest 仍可能各自去讀 live worktree。協定改為：

```
1. 建立 immutable in-memory HeadViewSnapshot S1:
     一次列舉全部 canonical paths；
     一次讀取每個 entry 的 mode / type / bytes；
     fingerprint（＝ headViewDigest）由這份 map 本身計算，不另外 stat。

   S1 canonical map 的唯一形狀與公式:
     map ＝ path → { mode, type, contentDigest }
       path          : canonical repo-relative，POSIX 分隔符，Git literal case
       mode           : Git 檔案模式字串（"100644" / "100755" / "120000"）
       type           : "blob" | "symlink"
       contentDigest  : sha256Hex(raw bytes)  —— symlink 取 link target 的 raw bytes，
                        **不跟隨**；raw bytes 指未經任何行終止符或 BOM 轉換的原始位元組
     排序             : 依 path 的 Unicode code point 序遞增；object key 亦然
     headViewDigest   = sha256(canonicalJson(map))
     —— 涵蓋**完整 universe**：新增、刪除、改名、模式變更、內容變更皆改變此值。
     —— 注意與 §11b.8b 的分工：contentDigest 用 raw bytes（偵測任何實體變動），
        declaration digest 用步驟 0 正規化後的 bytes（LF/CRLF 等價）。兩者刻意不同。
2. declaration parsing、dependency resolution、所有 digest 與 inventory emission
   **只能讀 S1**，不得再讀 live worktree。
3. 完成前建立第二份 snapshot S2，並計算其 fingerprint 與 configCarrierState。
4. 穩定條件（v1.11 定案；**兩項必須同時成立**）:
     S1.fingerprint         == S2.fingerprint
     configCarrierState(S1) == configCarrierState(S2)
   任一不相等 → head-view-unstable，**不產生任何 artifact**。
5. 兩項皆相等 → artifact 使用的 bytes 必須逐項等於 S1。
```

**Snapshot 的 `tracked` metadata（v1.11 新增；不進 canonical map）** —— §11b.4 要求「只有 tracked 的 config 才是合法 carrier」，而該判定必須能由**只持有 snapshot** 的 consumer 完成，否則就會退化成 snapshot 之後的第二次 live Git probe：

```
carrier       : HeadViewSnapshot 對每個 path 保留 immutable tracked: boolean，
                公開 metadata carrier **唯一**為 entry(path).tracked。
                —— 「實作可自行取得」**不是**可接受的表述：那不是 carrier。
來源          : 由**建立 snapshot 當次已捕捉的 index observation** 導出；
                snapshot 建立後**不得**再做 live Git probe。
定義          : tracked == true ⇔ 該 canonical path 位於本次捕捉的
                Git index **stage-0** path set。
                staged addition 為 tracked；純 untracked path 為 untracked；
                index conflict（非 stage-0）仍依本節既有規則 fail-closed。
**不進 digest**: canonical map 仍**恰為** path → { mode, type, contentDigest }；
                headViewDigest 公式**完全不變**。
                理由：tracked 是 **config-carrier validity metadata**，
                不是 source-content digest 的第四欄。
                ⇒ 同一份 bytes 由 untracked 變成 staged，
                  headViewDigest **必須不變**，而該 path 的 carrier
                  資格由 false 變 true。
```

**Head view 成分（v1.11：與下方四步 precedence 完全一致）**：staged／unstaged／**一般** untracked 且未被忽略者**納入**；工作區已刪除者視為該 path 不存在；**一般**被 tracked `.gitignore` 忽略者**排除**（判定順序第 3 步）；**唯一例外**是 worktree 中確實存在的 `.ctide/test-adapters-config.json` —— 依判定順序**第 2 步**，即使被忽略也**必須納入**（其 `tracked` 由 captured index stage-0 set 決定）；`.git/**`、`.ctide/provenance.json`、`.ctide/output/**` 三項 **hard exclusion 不受該例外影響**（第 1 步先於第 2 步）。path／case 取 **Git literal**；symlink **不跟隨**，只讀 link entry 本身的 bytes。

**`configCarrierState`：獨立的 stability comparison carrier（v1.11 新增）** —— fingerprint **就是** `headViewDigest`，而 `tracked` 刻意**不**進 `headViewDigest`（AC160）。於是 config 在 S1 與 S2 之間**只**改變 tracked 狀態時（純 index 操作，worktree 的 bytes／mode／type 完全不變），fingerprint 會完全相同，但 explicit-config 的 **carrier validity 已經翻面** —— 舊的 stability gate 看不見這個變化。本版以一個**獨立的比較 carrier** 補上，**不**把 `tracked` 塞進 fingerprint 或 `headViewDigest`：

```
configCarrierState(snapshot) —— 唯一定義，恰三值:
  config path 不在 snapshot      → "absent"
  entry(path).tracked == false   → "untracked"
  entry(path).tracked == true    → "tracked"
  （config path 恆為 .ctide/test-adapters-config.json；
    它是否在 snapshot 內，依下方判定順序第 1／2 步。）

比較範圍（closed）:
  **只**比較上述 config path 的 carrier state。
  其餘 path 的 tracked 狀態**不影響**本 spec 的任何語義，
  **不得**擴大比較範圍 —— 那會把與 head universe 無關的 index 操作
  誤判成 head-view-unstable。

與 digest 的分工（**兩者都不得互相代換**）:
  canonical map 仍**恰為** path → { mode, type, contentDigest }；
  headViewDigest 公式**完全不變**；tracked **不得**進入任一者。
  configCarrierState 是**第二個、獨立的**穩定性比較對象 ——
  它不是 fingerprint 的一部分，也**不**新增任何 persisted inventory 欄位。
```

**Head view universe 的 closed 範圍（v1.6 第三輪）** —— `headViewDigest` 涵蓋的是 **head 的 source／config／oracle universe**，不是整個工作目錄。範圍以**封閉規則**界定，**不得**以「必要檔案」之類的模糊集合代替：

```
判定順序（v1.11 定案；**四步，依序，先命中者勝**）:

1. hard exclusion —— 無條件排除，**不得放寬**、**不得**被任何例外覆蓋:
     .git/**                       —— Git 內部狀態，非 source；每次操作都在變
     .ctide/provenance.json        —— 交易語義狀態；其 freshness 由
                                      inputProvenanceStoreDigest 獨立承載（11b.9d）。
                                      若納入，Step 5 自己的合法寫入必然使 Step 6 stale。
     .ctide/output/**              —— per-run derived scratch（含 inventory 自身）；
                                      納入會讓 digest 自我指涉

2. exact config-path observability exception —— **唯一一條 exact path**:
     .ctide/test-adapters-config.json
     該 path 只要在 worktree 中**存在**就**必須納入** snapshot，
     **即使**它被 tracked .gitignore 忽略（例如一條 /.ctide/ 規則）。
     —— 純 untracked 時 entry(path).tracked == false；
        位於 captured index stage-0 set 時 entry(path).tracked == true。
     —— 這是 ignore exclusion 的**唯一** exact-path 例外：
        **不得**推廣為 .ctide/**、任何前綴、任何 glob 或任何其他 path。
     —— 理由見下「為何需要這條例外」。

3. tracked .gitignore exclusion —— 適用於**其餘所有** path:
     通過第 1／2 步後**其餘所有** path 中，被 tracked .gitignore 忽略者**排除**
     （ignore authority 見下）。**本步不適用於第 2 步已納入的 exact config path。**

4. closed inclusion —— 通過前三步者:
     測試檔與其 helper 模組
     被 oracle closure 觸及的 golden／expected-data 檔案
     任何層級的 package.json（影響 manifest 解析）
     tracked .gitignore（其變動改變 universe 邊界）
     上述以外、未被第 1 或第 3 步命中的一切 repo 內 path

四步皆為封閉列舉。新增第五類（例如「其他工具的 scratch」）
必須先在本節明文增列，**不得**由實作端就地判斷。
**不得**再把本節讀成無條件的「exclusion 先於 inclusion」——
第 2 步刻意排在第 3 步之前；兩個 writer 依此四步順序**必得出同一個 universe**。
```

**為何需要 exact config-path 例外（v1.11）** —— §11b.4 要求「只有 tracked 的 `.ctide/test-adapters-config.json` 才是合法 explicit-config carrier」，而該判定必須能由 snapshot metadata 單獨完成。但真實的 consuming project 幾乎都以一條 `/.ctide/` 規則忽略整個 `.ctide/`（本 repo 的 tracked `.gitignore` 就是如此）。若沒有第 2 步的例外，會同時壞掉兩件事：

```
(i)  純 untracked 的 config 根本不在 snapshot 內
     ⇒ entry(path).tracked == false **永遠不可觀測**，
       §11b.4 的第 2 種情形（存在但 untracked → fail-closed）
       會被誤讀成第 1 種（不存在 → explicitConfig: null），
       正好放行本規則要擋的東西。
(ii) 一旦以 git add -f 強制 stage，該 path 才**首次**進入 canonical map，
     headViewDigest 因而改變 —— 直接牴觸 AC160
     「staging 不得改變 headViewDigest」。

有了第 2 步，該 path 在 untracked 與 staged 兩態**都**在 map 內；
bytes／mode／type 不變時，staging **只**改 entry(path).tracked，
canonical map 與 headViewDigest **完全不變**。
```

**排除 `.ctide/provenance.json` 不等於放棄它的 freshness** —— `governance-affected` entry 的唯一輸入正是該 store，其新鮮度改由 `inputProvenanceStoreDigest` 承載並進入 `inventoryDigest`（見 11b.9d）。兩者缺一，該類 entry 就會失去 freshness 證明。

**Ignore authority（closed）**：只採 **repo-controlled** 的 ignore surface —— repo 內受版控的 `.gitignore` 檔案。使用者 global excludes（`core.excludesFile`）與 process environment **不得**影響輸出；`.git/info/exclude` **不屬** authority，因此**不得**偷偷影響輸出。所採用的 `.gitignore` 檔案本身**納入 S1 與 fingerprint**，使 ignore 規則的變動同樣被 TOCTOU 協定涵蓋。**唯一例外（v1.11）**：`.ctide/test-adapters-config.json` 依上列判定順序第 2 步，即使被 tracked `.gitignore` 忽略也**必須納入**；其餘被忽略的 path 一律照第 3 步排除。

**Ignore matching 的 engine boundary（唯一語義）**：pattern 語義為 **gitignore 語義**（前綴 `/`、後綴 `/`、`*`／`?`／`**`、字元類、`!` 反否定、較後規則勝、巢狀 `.gitignore` 以其所在目錄為根）。求值只以 S1 內的 `.gitignore` bytes 與候選 path 為輸入。**本 spec 不指定實作此語義的手段** —— 自行實作與採用既有 library 都可能；若採後者，該 library **與 AST parser 一併列入同一次 dependency authorization**（§11b.11）。**不得**宣稱「只差一個 AST package」：ignore 語義與 AST parser 是**同一次 authorization 的兩項能力**，把它藏在 fs 呼叫背後或以近似的 glob 冒充，都會讓 head universe 的邊界失去定義。**（status，非 normative；截至 2026-08-13）** 該 coupled authorization、vendoring 與 wrapper **已完成並經獨立審查接受**；exact operational authority（identities、members、hashes、settings、limits）**只在 shipped vendor manifest**，本 spec 不複製、不承載第二份。日後任何 identity、version 或 member 變更**仍須另行 authorization 與 review**；上述 semantic contract **不因實作已存在而放寬**。**untracked path 的 case 取實際 directory entry 字面值**，不得由 Windows case-folding 重寫。


**`AdapterContentView`：交給 adapter 的 exact carrier（v1.12 新增）** —— 既有 canonical map 與 `headViewDigest` 公式**完全不變**；本節新增的是**另一個**、純 in-memory、**不進任何 digest** 的投影。它存在的理由是：§11b.9f 要求 module resolution「必須精確命中該 view 內的 **blob**」且「symlink 不得作為 executable helper module」，而一個只有 `path → bytes` 的載體**無法讓 adapter 分辨** symlink 與 blob —— 省略 symlink 會讓它等同 missing path，保留 raw bytes 又會讓它看起來像 source。

```
AdapterContentView（base 與 head **共用同一 interface**；opaque／branded）:
  size                -> 整數
  paths()             -> **frozen** canonical path 陣列，依 Unicode code point 遞增
  has(path)           -> boolean
  entry(path)         -> **frozen** exact object { mode, type } —— 恰兩欄
  read(path)          -> raw bytes 的 **copy**（每次呼叫回新 copy）

observable semantics（v1.12 閉合；**不改**下列既有規則：raw-byte copy、branding、
mode／type mapping、base／head projection）:

  size **恰為** view 內 entry 的數量，且**必須等於** paths().length。

  **兩個判準必須分開，且依序求值** —— 第一步只看 argument 的字面形狀，
  第二步只看 exact key 是否存在。把「大小寫與 view 內某個 key 不同」歸入第一步是錯的：
  那需要先 case-fold 才知道有沒有「近似命中」，而 case-fold 正是本節禁止的動作。

  第 1 步 —— canonical path validity（**只由 lexical grammar 判定，與 view membership 無關**）:
    非空的 repo-relative 字串
    POSIX 分隔符 "/"
    無前導 "/"
    無 drive prefix（例如 "C:/…"）
    無反斜線 "\"
    無空 segment（"a//b"）、無 "." segment、無 ".." segment
    code points **原樣保留**：**不** normalize、**不** case-fold。
    —— 不符合上列任一項者為 **non-canonical**：
       has ／ entry ／ read **三者各自 fail-closed**，
       **不得** normalize、**不得** case-fold、**不得**以 OS path 規則修補後再查。
    —— 大小寫**不**參與本步判定：任何大小寫組合只要形狀合法就是 canonical。

  第 2 步 —— lookup（**一律只做 exact Unicode code-point key matching**）:
    canonical P 在 view 內有 **exact key**  -> has(P) 為 true；entry(P)／read(P) 正常回傳。
    canonical P 在 view 內**沒有** exact key -> has(P) **恰為 false**（不是 throw、不是 undefined）；
                                              entry(P)／read(P) **依 absent 規則 fail-closed**
                                              （**不得**回 null／undefined／空 buffer，
                                                那會讓「不存在」與「存在但空」無法分辨）。
    **不得**搜尋、偵測或修補 differently-cased near miss。

  case 的唯一 authority ＝ **exact key**，不做任何轉換:
    view 內只有 "Dir/File.js" 而查詢 "dir/file.js" 時 ——
      "dir/file.js" 形狀合法，因此是 **canonical**（第 1 步通過）；
      view 內沒有該 exact key，因此 has() **必須 false**，
      entry()／read() **必須依 absent 規則 fail-closed**。
    **不得**先 case-fold 找到 "Dir/File.js"，**也不得**改寫查詢後命中。

branding:
  只有本 spec 授權的建構路徑產出的 view 才是 view。
  caller 自製、duck-typed、spread／clone 的 look-alike **不得**冒充 captured view
  —— 消費端必須能拒絕它，而不是比較兩個來歷不明的物件。

entry() 的封閉欄位:
  **不含** tracked      —— tracked 仍**只**屬 HeadViewSnapshot 的 config-carrier metadata
                           （§11b.10 tracked metadata ／ §11b.4d），不進 AdapterContentView。
  **不含** contentDigest —— digest 是 headViewDigest 的事，不是 adapter 的輸入。

read() 的不可變性:
  每次回傳 copy；caller 對回傳 buffer 的任何修改**不得**影響下一次讀取。

path:
  canonical、POSIX 分隔符、**Git literal case**（不 case-fold）。

mode → type 的 exact mapping（closed）:
  "100644" / "100755" -> type: "blob"
  "120000"            -> type: "symlink"
  "160000"（gitlink／submodule）或其他 leaf mode -> **fail-closed**
symlink 的 read() bytes ＝ **link target 的 raw bytes**，**不跟隨**。
```

**Base projection（v1.12）**

```
來源      : 恰為 baseTreeOid 指向的 **exact immutable Git tree**。
前置檢查  : 先完成 shared v1.14 的 repository-semantic checks（缺一 → fail-closed）:
              OID 長度符合該 repository 實際採用的 object format
              該 object 確實存在
              該 object **自身的 type 恰為 tree**
              —— commit／tag **可以 peel 成 tree 不算數**
列舉      : 遞迴列舉該 tree 的**全部 leaf entries**。
            tree（directory）本身**不**作為 path entry，只遞迴進去。
**不**套用 : head 的 hard exclusions（.git/**、.ctide/provenance.json、.ctide/output/**）
**不**套用 : 任何 .gitignore
理由      : base 是 **immutable committed tree**；§11b.10 的四步 precedence 處理的是
            **working-tree／index／untracked** universe，那些概念在一棵已提交的 tree 上
            **不存在**，把它們倒灌到 base 會憑空刪掉 committed 內容。
讀取來源  : 所有 Git object bytes **只從 object database 讀** ——
            **不 checkout**、**不讀同名的 live worktree 檔案**。
```

**Head projection（v1.12）**

```
恰為      : S1 **已捕捉**的 paths／mode／type／bytes 的投影。
**不**做  : 第二次 enumerate、stat、Git probe 或 filesystem read。
**不**再套用另一層 filter —— head universe 已由 §11b.10 的四步 precedence 決定。
**不得**把 S2 的 bytes 混進分析。
S1／S2 stability 與 configCarrierState 規則**原樣保留**，本節不修改。
```

**Entry type 的消費規則（closed；v1.12）**

```
必須命中 type == "blob" 者:
  executable test module、helper module、package.json（manifest）
symlink:
  **不得**作為 executable module／helper／package manifest
  snapshot／golden 的 whole-file dependency **可以**命中 symlink，
    但**只** digest 該 link entry 的 raw bytes，**不跟隨**
**不得**以「從 view 省略 symlink」代替 type check ——
  symlink **必須留在 view 中**且**可被辨識為 symlink**，
  否則「存在但不是合法 module」與「根本不存在」會變成同一件事。
**不得**把 symlink 的 raw target bytes 當成 JavaScript source 去 parse。
```

### 11b.10b `DiscoveryAnalysisPreimage`（純 in-memory exact 契約；v1.12 新增）

本節定義的是一個 **logical operation** 與其回傳形狀。它**不是** persisted artifact、**不**直接作為任何 digest 的 carrier、**不**新增任何 inventory 欄位，也**不**定義 matching 或 status 分類。

```
buildDiscoveryAnalysisPreimage({ repoRoot, baseTreeOid })

request exact key set 恰為 { repoRoot, baseTreeOid }。**不得**接受:
  caller-provided registry／registry path／registry root
  parser 或 ignore matcher
  Git executable 或 environment
  filesystem adapter
  config object 或 config path
  modulePaths（或任何等價的 caller 提供 candidate 清單）
  component module path
  capture hook
  prebuilt view／snapshot
```

操作順序（唯一）：

```
1. **每次 invocation** fresh-read 並驗證 shipped registry（§11b.9c v1.11）；
   **同一次** parsed root 同時供 discovery、implementationIdentity projection
   與 registryDigest 使用 —— 不得在其間再讀一次。
2. 建立 **base AdapterContentView**（§11b.10 Base projection）。
3. 透過既有 stable-head protocol 建立 S1，並**在 evaluate 之內**建立
   **head AdapterContentView**。
4. base／head **各自**：解析 explicit config（§11b.4d）、建立 probe universe 與
   candidate universe（§11b.4a／4b）、resolve adapter（§11b.4c）、
   呼叫 closed implementationId mapping 所指的 component。
5. 全部分析**只讀各自的 view**。
6. **S2 stability 成功後**才回傳 preimage；head-view-unstable 或任何錯誤 →
   **不回傳 partial result**、**no-write**。
```

回傳 root 的 **exact shape**：

```
{
  baseTreeOid,
  headViewDigest,
  registryDigest,
  baseModules,
  headModules
}
```

`baseModules[]`／`headModules[]` 的 **exact shape**：

```
{
  path,
  adapterId,
  framework,
  implementationIdentity,   // exact shape 沿用 registry：
                            // { implementationId, parserId, parserVersion }
  declarations
}
```

`declarations[]` 的 **exact shape**：

```
{
  structuralId,
  tag,          // { clauseRef, dpRef? } | { expl: true } | null
  bodyDigest    // 必須是 adapter 對**該 view** 算出的結果（§6 bodyDigest）
}
```

其餘規則：

```
空 declarations:
  一個 module 即使 declarations 為空，只要已被 evidence 選成 candidate，
  **仍保留該 module record**。
  —— 「candidate 必須至少有一個 declaration」**不是**本 spec 的規則，
     空 test module 是否含 declaration **不是** discovery evidence 判準。

**不得**輸出:
  parser AST、source bytes、canonical declaration bytes、
  evidenceLevel、component module path，或任何自由格式 metadata。

canonical ordering:
  baseModules／headModules : 依 (path, adapterId) 的 Unicode code point tuple **嚴格遞增**
  declarations             : 依 structuralId 的 Unicode code point 序**嚴格遞增**
immutability:
  所有 array、object 與 nested 的 identity／tag **深度 frozen**。
回傳前 fail-closed:
  duplicate path／module，或同一 module 內 duplicate structuralId → fail-closed。

跨 view 規則（**defensive／future invariant**）:
  若**內部已解析**的結果出現：同一 canonical path 在 base 與 head **都**被選為 candidate
  且 adapterId **不同**
    → **在本 preimage component 內 fail-closed，回傳前終止**；
      **不得**回傳 partial preimage，
      **不得**留給 matcher 猜成 moved／retagged（§11b.4 跨 view framework migration）。

  **v1 可達性**: 在目前的 v1 closed registry 下，本情境**無法由 conforming public input 達成**
    —— §11b.3 只有一個合法 implementation／framework 組合，且本操作第 1 步對兩側
       使用**同一份 fresh registry root**，兩側可解析出的 adapterId 必然相同。
    因此本條**必須被實作**，但**不得**為了觸發它而新增第二個 adapter、registry override、
    caller injection 或 test-only public seam，**也不得**放寬 closed mapping；
    **更不得**宣稱已以 v1 end-to-end fixture 實跑過。

  只有**一側**被選為 candidate 時**不**套用本條 ——
    added／deleted 的最終分類仍屬 matcher，**本輪不定義**。
```

**不新增 `headTreeOid` carrier**：head view 是 invocation-local 的一次讀取，穩定性由 S1/S2 保證；head universe 的完整性改由 `headViewDigest` 承載（§11b.9c），它進入 `inventoryDigest` 且由 consumer 以 S3 重算。日後若確有需要 `headTreeOid` 的 consumer，必須先在 spec 明文建模並指名該 consumer。

### 11b.11 Parser engine boundary（能力契約，非套件選擇）

```
支援 11b.6 的 node:test v1 profile（ESM、static import binding 解析、node:assert 兩個 specifier）
提供 source range（供 declaration／hook 的 body span 與 canonical bytes 切分）
提供 AST 節點 identity 與 import binding 解析（同檔內的 `as` 別名）
  —— **不含 re-export**：跨模組 re-export 的解析在 v1 profile 與 discovery 皆未授權，
     列為 capability 只會製造沒有規則支撐的期待；遇到經 re-export 取得的 binding → unsupported
對 syntax error、unsupported syntax、ambiguous binding 一律 fail-closed
**不允許** regex-only fallback 冒充 AST
```

`implementationIdentity ＝ { implementationId, parserId, parserVersion }`，其 carrier 為 registry 與 inventory entry 兩側，見 11b.9b。**`parserId`／`parserVersion` 的實際值必須在 dependency authorization 時一併決定並寫入 registry** —— 在此之前，正式的 `test-adapters.json` 不得落檔（§11b.12）。**（status，非 normative；截至 2026-08-13）** 該前置條件**其後已滿足**：identity 已獲授權，正式 registry 已落檔並經獨立審查接受。current shipped registry 的 `implementationIdentity` **必須逐欄吻合 shipped vendor manifest 的 authority**，registry 不得自行發明 identity；任何 identity drift **fail-closed**，且 identity 變更**仍須重新 authorization 與 review**。**兩個合規 writer 對同一 source 與同一 view，必須得到相同的 `structuralId`、dep closure 與所有 digest。** ——
v1.7 起，這個承諾所依賴的 declaration range、declaration name、hook applicability、callable 子集與
module resolver 各有唯一定義（§11b.6b、§11b.8c、§11b.9e、§11b.9f）；在 v1.6 下它們尚未閉合，
因此該承諾當時不可能被兩個獨立實作滿足。

> **Non-normative implementation note（current status；截至 2026-08-13）** —— coupled 的 parser ＋ gitignore packet **已授權並 vendored**，shipped wrapper 執行時**不需 runtime install，也不需網路**。**shipped vendor manifest 是 exact identities、members、hashes、wrapper settings 與 resource limits 的唯一 machine-readable operational authority**；wrapper、formal adapter registry 與 node-test-v1 executable component 均已經獨立審查接受。
> **本段是敘述性狀態，不是 authority** —— 日後升級**不得**由本段（或本 spec 任何散文）的敘述值悄悄取代 manifest，也**不得**在此複製 package hash、version 或 resource 數值。**本段不構成新的 package／version selection authority；任何 identity 變更仍須另行授權與審查。**

### 11b.12 Rollout boundary

```
v1.6 核准前 : parseInventory() 對 populated entries 的
              unsupported-populated-inventory gate **不得移除**。
v1.6 核准後 : 仍不等於 dependency 已授權，也不等於 implementation READY。
正式 registry  : `test-adapters.json` 的 **semantic algorithm tokens 已閉合**
              （framework、pattern IDs、attachmentRule、stableIdRule 皆由 §11b.3 唯一決定）。
              v1.6 核准當下 `implementationIdentity.parserId`／`parserVersion` 的值尚未存在，
              因此**當時**正式 registry 不得落檔。
              —— v1.6 第一輪曾宣稱「現在已可完整寫出正式 registry」，該宣稱**撤回**：
                 可完整寫出的是語義 token，不是整份可落檔的 registry。
              —— status（截至 2026-08-13）：該 identity 其後已獲授權，正式 registry
                 **已落檔並經獨立審查接受**；其 identity 必須逐欄吻合 shipped vendor
                 manifest，identity 變更仍須重新授權與審查。
接受 populated inventory 的條件（全部滿足）:
              adapter registry（含已核准的 parser identity）、parser、
              gitignore engine、producer、canonical parser、
              consumer freshness（S3 重算）六者皆已實作並通過其對應 AC。
不受影響    : clean historical consumer（v1 envelope）與 Phase 1 的既有 READY 狀態。
v2 rollout   : 啟用後 v1 envelope 一律拒絕並重產；entries=[] 的 v1 文件
              **不得**成為 populated coverage 的 bypass（§11b.9c）。
```

**Current implementation status（status carrier，非 normative；截至 2026-08-15）** —— 上表六項前置條件的現況：**六項 rollout 前置條件已有五項實作並接受，只剩 producer。五項完成**仍不放寬**「六項全部滿足才可接受 populated inventory」的規則。**

**AdapterContentView、DiscoveryAnalysisPreimage 與 base／head one-to-one matcher 都是已接受的 supporting component，**都不是**新的 rollout 前置條件** —— 上表六項前置條件的內容、「已有五項實作並接受、只剩 producer」的計數與語義**完全不變**，**matcher 也不新增第七項 rollout prerequisite**；三者都**不使** populated inventory producer 自動完成。

```
implemented and accepted:
  adapter registry（含已核准的 parser identity，與 shipped manifest 逐欄相符）
  parser wrapper（authorized／vendored／wrapper）
  gitignore wrapper（authorized／vendored／wrapper）
  node-test-v1 executable component
  HeadViewSnapshot S1／S2 與 headViewDigest      ← S1／S2，**不是** S3
  canonical v2 inventory parser／reader
  consumer source freshness（S3 recomputation component）
                                                ← 只是 §11b.9c 的 source-freshness
                                                  step，**不是**完整 Step 6，
                                                  **也尚未** product-wired
  AdapterContentView base／head projections     ← 共用 content-view brand ＋ base tree
                                                  projection ＋ head projection ＋
                                                  real HeadViewSnapshot brand bridge；
                                                  foundation，**不是**新的 rollout 前置條件
  DiscoveryAnalysisPreimage                     ← candidate discovery ＋ adapter-facing
                                                  base／head content view ＋
                                                  declaration-analysis preimage；
                                                  **不使** producer 自動完成
  base／head one-to-one matcher（§6 matching）    ← Phase 0／1／2 保留；Phase 3 只在 residual
                                                  單側存在時產出 added／deleted，兩側 residual
                                                  同時非空即 E_UNRESOLVED_IDENTITY_DRIFT
                                                  整輪 fail-closed，**不回傳** partial pairing；
                                                  head-only `tid:` **不得** bridge base 的 `s:`。
                                                  **只輸出 matching relation**，**未決定**
                                                  `modified`／`retagged`；**不是** producer、
                                                  **不是**完整 Step 5／6，**也尚未** product-wired

not implemented:
  populated inventory producer
  governance reverse closure
  artifact emission 與 Step 5／6、ledger、arbiter wiring

gate:
  unsupported-populated-inventory 仍為必要，不得解除；
  populated inventory 仍不得接受；
  AC118／AC136／AC137／AC138 不得宣稱已滿足；Phase 2 不得宣稱 READY。
```
## 12. 修改檔案清單

| 檔案 | 變更 |
|---|---|
| `cressetide/skills/vigil/references/test-provenance.md` | **新增** —— §2–§7、§9 協定本體（plugin 慣用英文） |
| `cressetide/skills/vigil/scripts/contract-check.mjs` | 新增 `--provenance` 模式與結構／來源兩層（§8）；預設模式 exit-0 契約不變 |
| `cressetide/skills/vigil/scripts/test-adapters.json` | **新增** —— §2 framework adapter registry |
| `.ctide/test-adapters-config.json`（consuming project） | **新增（§11b.4）** —— tracked committed project configuration，explicit adapter 指派；**producer read-only**，任何情況下都不得建立或改寫；為 `registryDigest` 的第二個輸入 |
| `cressetide/skills/vigil/scripts/changed-test-inventory.mjs`（＋tests） | **新增** —— §6 base／head 導出、one-to-one matching、inventoryDigest |
| `cressetide/skills/vigil/SKILL.md` | **§8 七步 fixed-point loop**；`--provenance` 的新位置（第 6 步，不沿用既有 contract-check 位置）；第 5 步的 single-writer 落檔點＝呼叫 `commit-test-provenance-batch` |
| `cressetide/skills/vigil/scripts/provenance-store.mjs` | **（intent-scan v1.7 範圍）** `commit-test-provenance-batch`（含 `successorClauseDraft`、`resolutionCarrierUpdates[]`）、`successor=null` retire |
| `cressetide/agents/test-reviewer.agent.md` | §9 四個提問；typed finding 輸出格式 |
| `cressetide/skills/vigil/references/reviewer-selection.md` | §9 的 substitution 例外 |
| `cressetide/skills/vigil/references/verification-gate.md` | 記載第三個 traceability 方向；紅→綠不變 |
| `cressetide/agents/arbiter.agent.md` | `test → source` 方向；執行並讀 `--provenance` 機械結果 |
| `cressetide/skills/vigil/references/review-packet.md` | packet 帶 inventory 摘要與變更測試的 tag／clause |
| `cressetide/skills/vigil/references/test-layer-boundaries.md` | 澄清：本 spec 管 tag 與來源，不改「哪一層」的判斷 |
| `docs/runtime-contract.md` | tracked store 與 per-run scratch（inventory、batch）的 state-class 正式登記 | **後續最小接線 touchpoint（v1.6 登記，本輪不修改）**：`.ctide/test-adapters-config.json` 需登記為 tracked committed project configuration；`ChangedTestInventory` 的 v2 envelope 取代 v1 clean-only shape 時需更新其 state-class 說明。
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
28. **Adapter 多重命中與零-evidence 的分層**（carrier：§11b.4c 三值輸出）：**(1)** 同一 candidate path 在**同一** precedence level 命中兩個**不相等**的 `adapterId`，precedence 無法唯一決定 → **fail-closed**；**(2)** 同級多筆 evidence 但**全部指向同一** `adapterId` → **視為唯一命中**；**(3)** ordinary `.mjs`／`.js` probe subject 經**完整** probe 後**零 framework evidence** → **`not-a-candidate`**，自 candidate universe 省略，**不得**使整輪 fail-closed；**(4)** malformed config、config 內 unknown `adapterId`、parser failure、同級 ambiguous evidence，或 forced explicit-config subject 無法交給指定 component → **各自 fail-closed**，**不得**偽裝成 `not-a-candidate`；**(5)** **不得**以 `language: "javascript"` 已註冊、副檔名，或 caller-supplied `modulePaths` 把零 evidence 的 path 變成 candidate。**可區分單變數對照（三者只差一個變數）** —— (i) `lib/helper.mjs` 不含任何 registered framework evidence → `not-a-candidate`，**整輪繼續**；(ii) 同一檔**只**加入一行合法的 static `node:test` `ImportDeclaration` → **candidate**，選定 `node-test-v1`；(iii) 同一檔改成 parser-invalid source → **fail-closed**，**不是** `not-a-candidate`。
29. **順序正確**：`--provenance` 在 test-reviewer 產出並固化後才執行；在該步之前執行時，因 batch 不存在而 `status=fail`（證明它未沿用既有 pre-review 位置）。
30. **治理授權分離**：`ASSUM.governedBy = security` 的假設讀法改變時，僅有 test discipline 的 semantic ruling **不足以**建立 Transition → fail-closed；取得 security（或 arbiter）的治理 witness 後才通過。`supersede → REQ` 需 user／plan-gate witness。
31. **同時多問題不遺失**：一個測試同時 wrong-tag、missing-source、scope-violation 且改變 ASSUM 讀法 → batch 該 entry 的 `findings` 含四筆，各自需處置；只處理其中三筆 → 仍 fail。
32. **未處置即擋，且不可自陳**：batch fresh 且完整但含 `scope-violation` → `status=fail`；把該 finding **標成已處理卻未實際修復**同樣 fail（判準是 fresh batch 中不存在該 finding，不是 flag）。
33. **間接 oracle 變更被捕獲**：（i）修改帶斷言的 helper、（ii）修改 fixture／setup、（iii）更新 snapshot／golden 檔、（iv）改動外部 parameterized expected-data —— 四者皆使受影響測試以 `status=modified` 進 inventory 並需語義審查；宣告本體未動不構成豁免。
34. **無法歸屬即擋**：adapter 無法可靠解析的 assertion style（動態組裝／反射式斷言）→ fail-closed，**不得**視為 inventory empty。
35. **Qualifier 拒絕（分層；最終合法集合不變）**：`DEC-x@DP-y` 與 `ASSUM-x@DP-y` 為純結構違規 → **解析層即 fail-closed**（不需 store）。非 exception-backed 的 `REQ-x@DP-y` 需要 store context → 由 inventory pipeline 以**同一份 captured provenance-store pre-state** 判定，並在**產生任何 inventory entry 之前** fail-closed（§11b.8c 分層規則）。三者最終皆不合法，與 §2／§7 完全相同。
36. **結構重整可救，但只在 identity 於 base 側已經確立時**：container 改名使 `structuralId` 變動且**兩側同時留下 residual** → **fail-closed**（§6 rule 3 的 residual-side exclusivity；具名理由為 `unresolved-identity-drift`，**不得**降級成 added＋deleted，**不得**以 path、`bodyDigest`、`tag` 或筆數猜測）。**「加上明示穩定 ID 後配對成功」的 exact 條件（v1.13 收斂）**：該 `@tid` 必須**在被比較的 base 側就已存在**且於 head 保留 —— 此時兩側 `structuralId` 同為 `tid:<ID>`，container 改名不影響鍵，於 rule 1／2 直接配對成功。**單變數負例**：base 仍為 `s:…`、只在 head 這一次 diff 新增 `@tid` → **仍 fail-closed**，因為 preimage 無 alias／adoption carrier，且 `@tid` 依 §11b.8b 不進 `bodyDigest`，head 單方面新增的 `tid:` **無法證明**它與哪一筆 base declaration 同一 identity。為既有 unannotated declaration 導入 `@tid` 需**另立 migration authority**，本版不發明。單純搬檔（僅 path 變）→ `status=moved`，identity 維持。
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
60. **Base witness 負向與 historical 版本分支**：既有六項不變 —— （i）batch 缺 inline `baseProvenance` → fail；（ii）`treeOid != inventory.baseTreeOid` → fail；（iii）`storeDigest` 不符 → fail；（iv）`treeOid` 中無 store 檔 → 採 canonical empty store，前態存在性一律為否（非 fail）；（v）`resume-task` 改換 base → 拒絕；（vi）batch 的 witness ≠ tracked `TaskState.baseProvenance` → fail。 **v1.5 新增的 historical 版本分支**（base tree 是 immutable 物件，其版本與 current store 無關）：（vii）historical base-tree store 為 **v1** 且**原始 bytes** 的 `storeDigest` 相符 → **通過**，之後依上游 **approved v1.11** 做 **read-only legacy validation**；（viii）historical base-tree store 為 **v2** 且原始 bytes 的 `storeDigest` 相符 → **通過**；（ix）**digest 必須先比對原始 bytes** —— 刻意製造「raw digest 不符、normalize 之後才相符」的 historical v1 → **必須拒絕**，不得以 normalize 後的 bytes 充當比對依據；（x）historical v1 **不得 migration、不得回寫、不得修改 base-tree bytes**，亦**不得** normalize 成 v2 或補 `reopenCauseRef: null` —— normalize-null 只屬於 **current mutable v1 的 migration**，與 historical read 路徑完全分離（current v1 migration 由 intent-scan AC89 負責，兩者不得混用）；（xi）base tree 內**沒有** store 檔 → 採上游 SM §2 **唯一**的 canonical empty store 定義（`provenanceVersion: 2`），本文不另寫 literal。
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
> **AC84–138 的證據形式**：全部是**可執行** AC —— 每條都需要真實 fixture 與斷言。**文字搜尋（grep）、fence 檢查、`npm run validate` 綠燈，都不構成任何一條的證據**；它們只證明文件形狀，不證明行為。每個 blocker 至少有一個正例與一個**單變數**負例（除了被驗的那一項，其餘輸入完全相同）。

84. **Registry exact shape、未知 implementation ID 與缺 identity carrier**（carrier：§11b.3）：root 或 `adapters[]` 出現未宣告 key、缺 key、`registryVersion != 1`、空字串欄位、ID token 不符文法 → 各自 fail-closed；`implementationId` 不在 closed 集合內 → fail-closed，且**不得**退化為動態載入某個 module path。**單變數負例：一份其餘完全合法、只缺 `adapters[].implementationIdentity` 的 registry → fail-closed**（registry 側沒有 identity carrier，entry 側的值就無權威可比）；另驗 `implementationIdentity.implementationId != adapter.implementationId` → fail-closed。
85. **Adapter 唯一性**（carrier：§11b.3 唯一性規則）：`adapterId` 重複 → fail-closed；`(implementationId, framework)` 重複 → fail-closed。
86. **`implementationId` 綁定表為 closed；semantic tokens 與 implementation identity 是兩個 carrier**（carrier：§11b.3 綁定表 ＋ §11b.12）：`node-test-v1` 必須恰好綁定 `framework: "node:test"`、`language: "javascript"`、`testDeclarationPatternIds: ["node-test-call"]`、`containerPatternIds: ["node-test-describe"]`、`attachmentRule: "leading-line-comments"`、`stableIdRule: "line-comment-tid-v1"`；每一欄都是**恰為**。搭配任何其他 `framework` → fail-closed；表中未列的組合（如 `containerPatternIds: []`）→ fail-closed。**本 AC 不主張任何形式的「registry 已完全由 spec 決定」—— 該宣稱已全數撤回**：由 spec 閉合的只有 **semantic algorithm tokens**，`implementationIdentity` 是**另一個 carrier**，其值來自 dependency authorization 而非本 spec。**歷史**：v1.6 promotion 當下 `parserId`／`parserVersion` 尚未核准，因此**當時**正式 `test-adapters.json` 不得落檔。**現況（截至 2026-08-13）**：該 identity authorization 已完成，正式 registry 已落檔並經獨立審查接受；其 `implementationIdentity` **必須逐欄吻合 shipped vendor manifest**，registry **不得自行發明** identity，任何 future identity drift **fail-closed**。
87. **Pattern-ID closed table 與 canonical array form**（carrier：§11b.3 ＋ §11b.4a suffix 地位）：`node-test-call`／`node-test-describe` 各依表列 predicate 判定（v1 恰兩個 AST predicate，**無 path predicate**；`mjs-test-suffix` 已刪除，registry 亦無 `filePatternIds` 欄位可承載它，**且 v1.12 不得復活任何一者**）；未列於表的 pattern ID → fail-closed；陣列**反序**、**含重複**各自 fail-closed（不得由 writer 就地排序或去重後放行）。**v1.12 澄清**：`.mjs`／`.js` 是 §11b.4a 的**固定 syntax-probe eligibility**，**不是** pattern ID、**不是** registry 欄位、**不是** framework evidence，也**不會**單獨讓任何 path 成為 candidate；`.test.mjs` **不具任何特殊地位**（與 `helper.mjs` 同權）。**單變數負例**：任何把 suffix 當成選定依據、或新增 registry 欄位承載 path predicate 的實作 → fail-closed。
88. **Discovery 的三值輸出：executable matrix**（carrier：§11b.4a–4c）：**(a)** 普通 `lib/helper.mjs`，三級皆零 evidence → **`not-a-candidate`**，**整輪不得 fail**，其餘 candidate 照常產出；**(b)** 同一 candidate 在同級命中兩個**不相等**的 `adapterId` → **fail-closed**；**(c)** 同級多筆 evidence 但都指向**同一** `adapterId` → **唯一命中**並通過；**(d)** 較高 level（explicit config）已唯一命中 → **較低 level 不再評估**（以「較低級若被評估會得出不同 adapterId」的 fixture 證明它確實沒被評估）；**(e)** **parser error 不得偽裝成 `not-a-candidate`** —— probe subject 的 syntax error／parser refusal 必須以具名 parser 理由 **fail-closed**。另須斷言：`not-a-candidate` **只**能由「完整 probe 後零 evidence」產生，**不得**用來寬容 malformed config、unknown `adapterId`、ambiguous evidence 或 forced subject failure。
89. **`discovery.importSpecifiers` 綁定與 framework 不可冒充**（carrier：§11b.4 綁定值 ＋ §11b.4c）：`node-test-v1` 的 `importSpecifiers` 必須恰為 `["node:test"]`、`manifestDependencies` 恰為 `[]`；以任意非空字串（`["test"]`、`["my-runner"]`）冒充 → fail-closed。**不得**只因 `language` 是 `javascript` 就選定 framework。**v1.12 取代舊句（該句把「只能推導出 language 而推導不出 framework 的檔案」判為 whole-run fail-closed），唯一規則為**：ordinary probe subject 若**只能確定 JavaScript eligibility**、但**沒有** registered framework evidence → **`not-a-candidate`**；**不得**選成 `node-test-v1`，**也不得**使整輪 fail-closed。`language` **只**提供 probe eligibility，**永遠不能**成為 framework evidence。**forced explicit-config subject 不適用這個寬免** —— config 已明示 `adapterId`，它**就是** candidate；其 path missing、非 blob、symlink、module format 不受支援或指定 component 拒絕 → **各自 fail-closed**，**不得**退回 `not-a-candidate`。**三個單變數 fixture（同一份 repo，只差一個變數）**：(i) 一個 `.mjs`、無任何 `node:test` evidence → `not-a-candidate`；(ii) 同一檔加入 exact static `"node:test"` import → 選定 `node-test-v1`；(iii) **同一份無 evidence 的 bytes**，但被**合法** explicit config 指派給 node-test adapter → discovery **不得**將它略過，必須進入指定 component；其後若沒有合法的 executable declaration，**可以**回傳空 `declarations`，但 module／syntax／carrier 不合法仍 **fail-closed**。（本 AC **不**建立「candidate 必須至少有一個 declaration」的規則 —— 空 test module 是否含 declaration **不是** discovery evidence 判準。）
90. **副檔名不參與 adapter 選定，且不因此使整輪失敗**（carrier：§11b.4a suffix 地位 ＋ §11b.4c 三值輸出）：**單變數對照（除指名的一行以外完全相同）** —— (i) `a.test.mjs` 具 `import { test } from "node:test"` → **選定 `node-test-v1`**；(ii) 同名風格的 `b.test.mjs` **只** import Playwright／Vitest 風格的 API、**無** `node:test` static import → **probed but `not-a-candidate`** —— **不是** `node-test-v1`，且**不得**使整輪失敗（v1.12 取代舊的 whole-run fail-closed 判定）；(iii) `lib/helper.mjs` 具**同一行** `node:test` static import → **同樣選定 `node-test-v1`**，證明 `.test.mjs` 不具特殊地位；(iv) 一個 `.txt` 檔內含 `import "node:test"` 的 bytes → **不進 probe universe**（suffix 不符），因此不產生任何 evidence；(v) `node:test` 字樣出現在 comment、普通 string literal、`import()`、`require()` 或 `export … from` 之中 → **都不構成 evidence**，該檔為 `not-a-candidate`。
91. **`package.json` 的 per-view 最近祖先解析**（carrier：§11b.4 manifest 解析）：由測試檔所在目錄向 repo root 逐層尋找，取**最近祖先**的 `package.json`；base 與 head **各自解析**。**單變數負例**：head 於測試檔的中間目錄新增一個 `package.json`，其餘不變 → head 的 manifest 來源改變，**不得**沿用 base 的解析結果。完全找不到 `package.json` → 該級零命中（非錯誤），續評下一級。
92. **Explicit config carrier 與 read-only 邊界（base／head 分層）**（carrier：§11b.4d ＋ §11b.10 snapshot metadata）：`.ctide/test-adapters-config.json` 的 `configVersion != 1`、未宣告 key、`assignments[].path` 重複、`adapterId` 未註冊 → 各自 fail-closed。**producer 對它 read-only** —— 檔案不存在時**不得**自動建立，內容不合法時**不得**改寫或補齊，只能 fail-closed。**Head（完整保留 v1.11 的三個可區分案例；fixture 必須帶含 `/.ctide/` 的 tracked `.gitignore`）**：(i) tracked control（`entry(path).tracked == true`）→ **合法 carrier**，其 parsed object 進入 `registryDigest` preimage；(ii) 純 untracked、同 path、逐 byte 相同 → **invalid config carrier，fail-closed**（不得接受、不得視為不存在、不得以 `null` 續行、不得 `git add` 或修補；失敗前後 bytes 逐字相同）；(iii) 該 path 實際不存在 → 此時、也只有此時 `explicitConfig` 恰為 `null`。判定只用 snapshot metadata，**不得**在 snapshot 之後做第二次 Git 或 filesystem discovery。**v1.12 新增 Base（exact base tree 沒有 index／stage-0 概念）**：(iv) config blob 存在於 base tree（`entry.type == "blob"`）→ **tree membership 本身即為 committed valid carrier**，仍須通過 exact schema 與 raw duplicate-member 規則；(v) base tree 內不存在該 path → base `explicitConfig` **恰為 `null`**；(vi) base tree 內該 path 是 **symlink**（或其他非 blob type）→ **fail-closed**。**另須斷言**：**不得**拿 head 的 index／stage-0 去判 base 的 tracked／committed 性；且 `registryDigest` 的 preimage **仍只含 head explicitConfig**（base config 由 `baseTreeOid` 綁定，公式不變）。
93. **跨 view framework migration 是刻意的 v1 邊界，且由 preimage component 擋下**（carrier：§11b.4 最後一段 ＋ §11b.10b 跨 view 規則）：若同一 canonical path 在 base view 與 head view **都**被選為 candidate 而導出**不同**的 `adapterId` → **fail-closed 且 no-write**。**不得**猜成 `moved` 或 `retagged`；理由必須落在「兩個 adapter 的 `structuralId` 演算法不同，跨 adapter 比較沒有共同定義域」。**具名拒絕層級**：該 fail-closed **必須發生在 `buildDiscoveryAnalysisPreimage` 之內、回傳之前** —— **不得**回傳 partial preimage，**不得**把該狀況留給下游 matcher 判斷。**v1 可達性（誠實化）**：本條是 **defensive／future invariant**。§11b.3 的 closed table 在 v1 只有**一個**合法 implementation／framework 組合，且單次 preimage invocation 對 base 與 head 使用**同一份 fresh registry root**，因此**沒有任何 conforming public input 能在 v1 下達成該情境**。本 AC 因此**要求該 invariant 被實作並可由 code 檢視**，但**不要求**、也**不得宣稱**提供 v1 end-to-end executable fixture；**不得**為了製造該 fixture 而新增第二個 adapter、registry override、caller injection 或 test-only public seam，**也不得**放寬 closed mapping。**邊界對照（此項可、且必須實跑）**：只有**一側**被選為 candidate（另一側為 `not-a-candidate` 或該 path 不存在）→ **不**套用本條；added／deleted 的最終分類仍屬 matcher，**本輪不定義**。
94. **node:test import alias、modifier 與 nested container**（carrier：§11b.6）：`import { test as it } from "node:test"` 經 binding 解析後仍被辨識；`.only`／`.skip`／`.todo` 視為同一 declaration 且 modifier **不進** identity；任意深度 nested container 的 chain 由外而內；裸 `"test"` specifier、CommonJS、`.foo` 成員 → 各自 unsupported fail-closed。
95. **hook import form 與 `node:assert` 兩個 specifier**（carrier：§11b.6）：`import test, { before, after } from "node:test"`（default 與 named 併用）必須支援，`beforeEach`／`afterEach` 同；經此類**合法 static binding** 取得的 hook 才算 fixture declaration，非 static 取得者 → fail-closed。assertion 端：`node:assert` 與 `node:assert/strict` 的 default／namespace／named binding（含 `as` 別名）皆須支援。profile **不得**一面聲稱 hook supported、一面禁止能取得 hook binding 的 import form。其他 assertion library 維持 unsupported fail-closed。
96. **Assertion binding 分類與 closed allowlist**（carrier：§11b.6 binding 分類 ＋ 17 名 allowlist）：**正例** —— 三種 assertion-object binding 各驗一次成員呼叫：`import assert from "node:assert"; assert.ok(...)`、`import * as assert from "node:assert"; assert.deepStrictEqual(...)`，以及**必須實跑的 strict alias**：`import { strict as assert } from "node:assert"; assert.ok(...)`；另加 assertion-function binding 的直接呼叫 `ok(...)` 與 default binding 的直接呼叫 `assert(...)`。**單變數負例** —— (i) 其餘完全相同，只把成員名換成 allowlist 外的名稱（`assert.partialDeepStrictEqual(...)`）→ unsupported fail-closed，不得因「看起來像 assertion」放行；(ii) 對 **assertion-function binding** 做成員呼叫（`ok.strict(...)`）→ unsupported，該類 binding 只能直接呼叫；(iii) 對 **namespace binding** 直接呼叫（`assert(...)`，其中 `assert` 來自 `import * as`）→ unsupported，namespace object 非 callable；(iv) `assert[expr]` computed member → unsupported。
97. **Unsupported dynamic declaration**（carrier：§11b.6 明文 unsupported 清單）：第一引數為變數、含插值的模板字串、串接或函式回傳值；迴圈／map／工廠產生的 parameterized declaration；computed member；經物件屬性的間接別名 → **全部** `unsupported-syntax` fail-closed，**不得**以 regex 猜測。無插值的模板字串視同字串字面值並通過。
98. **Tag cardinality：恰好一筆 `@src`**（carrier：§11b.5 ＋ §2:41）：一個 declaration 的 attachment block 內出現**第二筆 `@src`** → fail-closed —— 分別驗**內容不同**與**內容完全相同**兩種情形，**兩者都必須 fail-closed**。同一 block 內的 `@tid` **不計入** cardinality，`@tid` ＋ 單一 `@src` 為合法。head 中仍存在而零 `@src` 的 test → 依既有 INV-B2 fail-closed；pre-state legacy 的零 tag 合法性仍由既有 preState 規則處理，**不得**反向放寬 head。
99. **Stable ID 正例與四種負例**（carrier：§11b.7）：正例 —— `// @tid <ID>` 與 `@src` 同一 leading comment block、無空白行分隔 → 該 ID 優先於推導的 `structuralId`。負例 —— 同一 declaration 兩筆 `@tid`；**同一個 view 內**兩個 declaration 使用相同 `@tid`；`@tid` 附著於 container（borrowed）；ID 不符 grammar 或該行含額外內容（malformed）→ 各自 fail-closed。另驗 `@tid` 與 declaration 之間有空白行時**不視為附著**。
100. **Stable ID 的定位**（carrier：§11b.7 最後一段）：`@tid` 是 identity hint —— **不**表示任何 clause 綁定，**不得**取代 `@src`，不計入 tag cardinality，且不進入 `declarationDigest`／`bodyDigest`。只有 `@tid` 而無 `@src` 的 declaration 在 tag 層仍視為未標記。
101. **Stable ID uniqueness 按 view 分別檢查**（carrier：§11b.7 uniqueness scope）：**正例 (i) unchanged** —— 同一個 `@tid` 在 base 恰一次、head 恰一次 → 合法 matching pair，**不得**判為 duplicate；**正例 (ii) moved** —— 同一 `@tid` 在 base 於 A 檔、head 於 B 檔各一次（bytes 不變）→ `status=moved`，仍不判 duplicate。**單變數負例**：把 head 那一筆複製成兩筆（base 不動）→ **head view 內**出現兩次 → 必須在 matching **之前** fail-closed；base 側同理。
102. **Duplicate literal name 必須帶 `@tid`：前插同名 test 反例**（carrier：§11b.8 步驟 4）：
     ```
     base:  test("same", A)          head:  test("same", NEW)
            test("same", B)                 test("same", A)
                                            test("same", B)
     ```
     若以詞法序號消歧，base A 會被配給 head NEW、base B 被配給 head A，**全程 one-to-one、無 collision 可觸發 fail-closed**，兩筆 provenance 被無聲借用。要求：此 fixture **必須 fail-closed**；補齊三筆唯一 `@tid` 後正確配對；**只補其中兩筆 → 仍 fail-closed**。**不得**以位置、body digest 或降級成 added＋deleted 猜測。
103. **Unique name 的 `s:` 鍵與 reorder／move 不變性**（carrier：§11b.8 步驟 2–3）：container chain 內名稱唯一者以 `"s:" + canonicalJson([...chain, name])` 為鍵；純搬檔（path 變、內容不變）→ `structuralId` 不變、`status=moved`；**同檔內重排順序不改變 identity**。
104. **Matching 必須 one-to-one，且 residual 必須單側**（carrier：§11b.8 Matching ＋ §6 rule 3）：collision、一對多、多對一 → 全部 fail-closed，**不得**降級成 added＋deleted。**v1.13 新增的第四種 fail-closed**：Phase 1／2 之後 `Ubase` 與 `Uhead` **同時非空** → `unresolved-identity-drift`，**整輪** fail-closed；**不得**回傳任何 partial matching result（已成立的 exact／moved pair 亦不得回傳），**不得** emit added／deleted，**不得**因恰為 1 base ＋ 1 head 就猜成同一 declaration。residual **單側**存在時仍照 rule 3 產出：只有 `Uhead` → 全為 added；只有 `Ubase` → 全為 deleted。
105. **`@tid` 的 canonical-byte 排除**（carrier：§11b.8b）：合法附著的 `@tid` 行連同其行終止符在 hashing 前被移除，其餘 bytes 原樣保留。因此 —— (i) 修改 `@tid` 的**值**或**位置** → `structuralId` 改變，`declarationDigest`／`bodyDigest` **不變**；(ii) `@tid` 與 `@src` **互換順序** → digest 相同（須由 byte 演算法推出，不得只以散文宣稱）；(iii) 同 block 內一般註解的任何改動 → digest **改變**；(iv) malformed 或 unattached 的 `@tid` **不得**被移除。
106. **CRLF 與 LF 的 digest 等價**（carrier：§11b.8b 步驟 0）：同一份邏輯內容的兩個檔案，唯一差異是行終止符（一份全 LF、一份全 CRLF）→ 經步驟 0 正規化後，`declarationDigest`、`bodyDigest`、`effectiveOracleDigest` **全部相同**。另驗：正規化後的 canonical bytes **不含任何 CR**（含 `@tid` 行被移除處的接縫）。反向確認：`headViewDigest` 的 `contentDigest` 取 **raw bytes**，因此兩檔的 `headViewDigest` **不同** —— 兩者刻意不同層，AC 必須同時驗出這個差異。
107. **Oracle dependency edge 恰三類**（carrier：§11b.9 表格 1–3）：local-assertion-helper、fixture-hook、snapshot-golden 各自產生預期的 `depRef.path`／`span` 並進入閉包。**單變數負例**：測試改以 `import expected from "./expected.json"` 取得預期資料 → `external-expected-data` 已從 v1 移除，該 edge 落入 unsupported → **fail-closed**，**不得**被靜默略過；改寫為 snapshot-golden 形式後通過。另驗 ——**assertion-root 不產生 depRef**（root bytes 已由 `declarationDigest` 承載）。
108. **snapshot-golden 的 exact 契約**（carrier：§11b.9 snapshot-golden 區塊 ＋ §11b.9 snapshot path 的唯一 resolution algorithm）：正例 —— `readFileSync(new URL("./fixtures/golden.txt", import.meta.url))`，specifier 為 `node:fs`，path 引數在 index 0；判定取 argument 0 的 **decoded StringValue**（**不**依 raw token 的拼法），以該 snapshot call **所在 module** 的 canonical POSIX dirname 為根做 **lexical** 解析，argument 1 必須逐節點**恰為** `import.meta.url` → 產生預期 `depRef`。另須明確驗到：解析**不**使用 process cwd、**不**讀 live filesystem、**不**使用 WHATWG URL resolution 或 percent decoding。**單變數負例（其餘皆同）**：(i) 改用未列於 allowlist 的 fs API（例如 `readdirSync`）→ unsupported fail-closed；(ii) 改成裸 cwd-relative 字面值 `readFileSync("fixtures/golden.txt")` → unsupported（意義取決於 process cwd，不可重現）；(iii) 改成 computed 或變數 path → unsupported；(iv) path 逃逸 repo root → fail-closed。**完整的正負例矩陣見 AC153**，本 AC 不重複列舉。
109. **SUT import 與 oracle helper 的分界**（carrier：§11b.9 兩類 edge）：**單變數對照** —— (i) **只**修改測試所 import 的被測 production module（SUT）內容 → 該 test **不得**因 oracle dependency 規則被標為 `modified`；(ii) **只**修改測試所 import 的 assertion-bearing helper 內容 → 該 test **必須**被標為 `modified`。traversal／resolution edge 只用於解析 binding 與 call target，**本身不產生 depRef、不進 `effectiveOracleDigest`**。
110. **assertion-bearing production callable 的保守分類**（carrier：§11b.9 誠實邊界段）：一個 production 模組若其可達展開內含 allowlist 的 assertion call（例如以 `node:assert` 寫 invariant），**必然**被分類為 oracle contributor，改動它會使測試 `modified`。AC 要求把這個結果**明確斷言為預期行為**，而非缺陷；同時要求實作與文件**不得宣稱**機械層知道該 callable 的真實 helper／SUT 身分。
111. **Dynamic／reflection edge fail-closed**（carrier：§11b.9 unsupported 清單）：`import()`、`require()`、`.json` static import、未列於 allowlist 的 fs API、computed／變數／模板插值 path、裸 cwd-relative 字面值、reflection、無法唯一解析的 import binding、指向該 view 外的 specifier → 各自 fail-closed；**「看不到 assertion」不得產生空 closure** —— 只有每條 edge 都成功解析且集合確實為空才是空 closure。
112. **Cycle 終止與 dedup**（carrier：§11b.9 遞迴與去重）：`A → B → A` 的閉包以已訪問集合終止，不報錯、不重複計入；結果依 canonical `depRef`（先 path 後 span）以 **code point** 序排序去重，插入順序不影響 digest。
113. **base／head 各自展開閉包**（carrier：§11b.9 ＋ §11b.10）：同一 declaration 在兩個 view 內容不同的 helper 上得到不同的 `effectiveOracleDigest`；head 的 helper 內容**不得**參與 base 閉包，反之亦然。
114. **`implementationIdentity` 為兩側 carrier**（carrier：§11b.9b）：registry `adapters[]` 與 inventory entry 兩處都必須帶 exact key set `{ implementationId, parserId, parserVersion }`、三欄非空；entry 的值必須**逐欄等於**其 `adapterId` 對應 adapter 的宣告值。**單變數負例**：只把 entry 的 `parserVersion` 改成與 registry 不同 → **consumer fail-closed**。`TestSemanticReviewBatch` **不得**複製這三欄。clean `entries: []` 的既有 v1 artifact 不受影響。
115. **Identity 變動必然改變 `inventoryDigest`**（carrier：§11b.9b ＋ §11b.9c 公式）：其他輸入完全不變，僅將某 entry 與其 adapter 的 `parserVersion` 一致地改成新值 → 重算的 `inventoryDigest` **必然不同**，既有 batch 因此 stale，必須重產 inventory 後才可續行。
116. **v2 envelope 的 exact shape**（carrier：§2 envelope 版本邊界 ＋ §11b.9c）：v2 文件必須帶 `inventoryVersion: 2`、`baseTreeOid`、`registryDigest`、`headViewDigest`、`inputProvenanceStoreDigest`、`entries`、`inventoryDigest`，exact key set；缺任一、多出未宣告 key、`inventoryVersion` 為其他值或非整數 → 各自 fail-closed。`inventoryDigest` 必須等於 `sha256(canonicalJson({ inventoryVersion, baseTreeOid, registryDigest, headViewDigest, inputProvenanceStoreDigest, entries }))`；**單變數負例**：其餘完全相同，只把公式換成不含 `inputProvenanceStoreDigest` 的版本 → 值不同 → fail-closed。
117. **版本判別的誠實形式**（carrier：§2 envelope 版本邊界）：**v2 有 explicit discriminator `inventoryVersion: 2`；v1 沒有 discriminator，只能以 exact absence shape 辨識** —— root key set 恰為 `{ baseTreeOid, inventoryDigest, entries }` 且不含 `inventoryVersion`。**單變數負例**：一份缺 `inventoryVersion`、但多帶一個 key（形狀不吻合 v1 exact shape）的文件 → fail-closed，**不得**被寬容成 v1。rollout 後符合 v1 exact shape 者一律拒絕重產；**`entries: []` 的 v1 文件不得被當成「已涵蓋、無變更」** —— 它既無 `headViewDigest` 也無 `inputProvenanceStoreDigest`，無法證明 universe 為空。rollout 前 v1 仍是 Phase 2A clean-only 路徑的合法輸入（該既有 READY 不受影響）。
118. **Consumer S3 source freshness：三個 entries-不變的反例**（carrier：§11b.9c consumer 協定第 1 步）：consumer 在接受 inventory／batch 前以當下狀態建立 **S3**、重算 `headViewDigest` 與 `registryDigest`。三個負例中 `entries` 完全不變 —— (a) 新增一個測試檔 → `headViewDigest` 不符 → stale fail-closed；(b) 修改 `.ctide/test-adapters-config.json` → `registryDigest` 不符 → stale；(c) 修改 `test-adapters.json` → `registryDigest` 不符 → stale。正例：三者皆未變 → 接受。另須斷言：若 freshness 只比對 per-entry identity 或只比對 `{ baseTreeOid, entries }`，三個負例**全部會靜默通過**。**v1.11 強化 (c)：same-process fresh registry observation** —— 本案必須在**同一 process、同一 module instance** 內依序執行：① 第一次 S3 讀取 registry 並成功；② 其後對**同一份** shipped scratch layout 的 `test-adapters.json` 做 **schema-valid** 修改（例如改 `adapterId`）；③ 第二次 S3 **必須看見新的 root** 並判舊 envelope **stale**。**不得**以「mutation 之後重新 `import` 該 module」或「另啟一個 process」代替 —— 那樣每個 module instance 都帶著全新的 cache，真正的失敗面（**先 cache、後 mutate**）根本不會被觸及。另保留 **schema-invalid mutation 的 validate-before-hash 負例**：該 registry 必須先依 §11b.3 fail-closed，**不得**對未通過 schema 的內容計算任何 digest。完整規則見 AC161。
119. **`registryDigest` 的唯一公式**（carrier：§11b.9c）：`sha256(canonicalJson({ registry: <完整 exact test-adapters.json root，含 registryVersion>, explicitConfig: <head-view exact config object> | null }))`。**單變數負例**：(i) 只改 `registryVersion`（adapters 完全不變）→ digest **必須改變**（證明取的是整份 root 而非只有 `adapters`）；(ii) config 檔不存在時 `explicitConfig` 必須是 `null`，以 `{}` 代替 → digest 不同 → fail-closed。另須斷言：**base view 的 config 由 `baseTreeOid` 綁定**，不重複進本 digest —— 只改 base tree 內的 config 而 head 未變時，`registryDigest` **不變**，該變動由 `baseTreeOid` 承載。
120. **`inputProvenanceStoreDigest` 的記法必須與上游 CAS 對位**（carrier：§11b.9c digest 記法）：值為 `sha256(canonicalText(檔案文字))`（去 BOM、CRLF/CR → LF），即上游 store 載入所得、也是其 CAS 比對的 digest。**單變數負例**：同一份 store 檔改以 **raw-bytes** digest 計算 → 在帶 BOM 或含 CRLF 的檔案上與上游 pre-state 值不同 → 交易 precondition **必然失敗**；AC 必須實際造出這種檔案並驗出不相等，證明兩種記法不可互換。另驗：store 檔**不存在**時本欄取上游 **canonical empty store** 的 digest（**不是** `null`、不是空字串），以 `null` 代之 → fail-closed。
121. **Step 5 pre-state precondition：inventory 後、Step 5 前被其他 writer 改動**（carrier：intent-scan §8 `expectedInputProvenanceStoreDigest` ＋ §11b.9d）：inventory 產生後、`commit-test-provenance-batch` 提交前，**另一個 writer** 合法改動 `.ctide/provenance.json` → 交易 pre-state digest 不等於 payload 宣告值 → **CAS／precondition fail-closed 且整筆 no-write**（store bytes 不變、`TaskState.committedProvenanceBatchRef` 不變、無任何 record 落盤）。另驗：payload 缺該欄位 → fail-closed；同時提供 invocation option `--expect-digest` 且與 payload 值不相等 → fail-closed。
122. **正常路徑端到端成功，且刪除 scratch 後仍可驗 persisted witness**（carrier：§8 七步 ＋ §11b.9c Step 6 協定與證明邊界）：**正例 (i) clean batch** —— Step 1 產生 inventory（`inputProvenanceStoreDigest` ＝ D0，`inventoryDigest` ＝ H0）→ Step 5 以 `expectedInputProvenanceStoreDigest = D0` 並帶 `inventorySnapshot`（其 `inputProvenanceStoreDigest` ＝ D0、`inventoryDigest` ＝ H0）提交零筆 resolution 的 batch，store 由 D0 變為 D1 → **Step 6 必須成功**。**正例 (ii) resolution batch** —— 同一時序但含至少一筆 ResolutionGroup（Transition ＋ DP repoint），store 同樣由 D0 變為 D1 → **Step 6 必須成功**。兩個正例都必須在刪除 `.ctide/output/**` 全部 scratch 後重跑 Step 6 並通過，此時可驗的**恰為**：重算 committed `inventorySnapshot` 自身的 `inventoryDigest`、record 與 snapshot 的 derived equality、`batchDigest` 涵蓋 `batchSnapshot`、以及以 S3 重算 `headViewDigest`／`registryDigest`。**本 AC 明確不主張**能事後獨立重新觀察歷史 `loadedStoreDigest` 或當時 payload，也不主張能只憑 digest 判斷它以 `canonicalText` 或 raw bytes 算出 —— 那一段是 writer 交易當下的義務（AC121／AC123／AC120 各自涵蓋），Step 6 承接的是 committed witness。另須斷言：**Step 5 自己對 `provenance.json` 的合法 mutation 不得造成 stale**。
123. **`inventorySnapshot` 是 inventory 的唯一 authority：payload 追上 pre-state 也不得放行**（carrier：§11b.9c preimage 段 ＋ intent-scan §8 等式鏈）：**關鍵反例** —— inventory I0 的 `inputProvenanceStoreDigest` ＝ D0、`inventoryDigest` ＝ H0；Step 5 之前 store 變為 **D1**；caller 只把 `payload.expectedInputProvenanceStoreDigest` 改成 **D1**（因此 `loadedStoreDigest == payload` 成立、CAS 通過），但 `batchSnapshot.inventorySnapshot` 仍是 **D0／H0** → 第三段等式 `payload == inventorySnapshot.inputProvenanceStoreDigest` 不成立 → **fail-closed 且整筆 no-write**（store bytes 不變、`TaskState.committedProvenanceBatchRef` 不變、無任何 record 落盤）。**本 AC 不得與 AC121 合併**：AC121 抓的是 **CAS mismatch**（payload 沒追上 pre-state），本 AC 抓的是 **inventory-binding mismatch**（payload 追上了，inventory 沒有）；兩者是不同的失敗面。另驗：`batchSnapshot` 缺 `inventorySnapshot` → fail-closed。
124. **`record.inventoryDigest` 是 derived，不是第二份 authority**（carrier：SM v1.13 record shape ＋ §2 `TestSemanticReviewBatch`）：**單變數負例** —— 其餘完全相同，只把 `provenanceBatch.inventoryDigest` 改成不等於 `batchSnapshot.inventorySnapshot.inventoryDigest` 的值 → **fail-closed**。另驗：caller 不得以「只提供 top-level digest 而不提供 snapshot」的方式提交；亦不得改以「把 `expectedInputProvenanceStoreDigest` 複製到 record top-level」代替 snapshot —— 該做法證明不了它參與過 preimage，且會製造第三個 authority，必須被拒絕。
125. **改動 snapshot 欄位而未重算 digest 必須被抓出**（carrier：§11b.9c 重算義務）：**單變數負例** —— 其餘完全相同，只把 `inventorySnapshot.inputProvenanceStoreDigest` 改成另一個值，**不**重算 `inventorySnapshot.inventoryDigest` → writer 重算所得與宣告值不符 → **fail-closed 且整筆 no-write**。對稱負例：只改 `entries` 內任一欄而不重算 → 同樣 fail-closed。**正例**：一致地改動欄位並重算 `inventoryDigest`、且三段等式仍成立 → 通過。
126. **`inventorySnapshot` 的形狀與正規化義務，及其 authority 歸屬**（carrier：**SM v1.13 最小 authoritative envelope** ＋ §11b.9c 的計算語義）：exact key set（恰七欄）與 `inventoryDigest` 唯一公式的 authority 在**上游 shared model**；本 spec 只定義四個 digest 各自的計算語義。writer 與 Step 6 都必須驗 —— (i) **exact key set**（缺 key、多出未宣告 key 各自 fail-closed）；(ii) **`inventoryDigest` 唯一公式重算**相符；(iii) **`entries` canonicalization** 依 `(path, adapterId, structuralId)` code point 序且 object key 已排序（送入未排序的 entries → fail-closed，**不得**由 writer 就地排序後放行）。(iv) **`inputProvenanceStoreDigest` 的 digest 記法**（`sha256(canonicalText(…))`、缺檔取 canonical empty store digest）是 **writer 交易當下**的義務 —— **Step 6 不得宣稱**能從 digest 字串本身驗出它用了哪種記法；該項由 AC120 在 writer 側涵蓋。
127. **§6 freshness 是 proposal-time，不得引入 post-commit**（carrier：§6 適用時機 ＋ §11b.9c Step 6 協定 ＋ checker 分層表）：**正例** —— Step 5 之前，測試在 review 後被修改／沿用舊 run ruling／借用其他 test 的 ruling，各自由 §6 的 current-inventory 重算擋下。**關鍵負例** —— 一筆**完全正常**的提交（store 由 D0 推進到 D1、snapshot 為 D0／H0），若 Step 6 引入 §6 的 `batch.inventoryDigest == 重算的 current inventoryDigest`，則因當下重算必然不等於 H0 而被誤判 stale → **本 AC 要求 Step 6 通過**，任何把 §6 帶入 post-commit 的實作都必須被它抓出。checker 分層表的「Batch 完整性與新鮮度」一列必須分階段求值。
128. **Batch record discriminator 與 legacy boundary**（carrier：SM v1.13 `batchRecordVersion` 與 legacy boundary）：**v2 正例** —— 帶 `batchRecordVersion: 2` 且 `batchSnapshot` 含合法 `inventorySnapshot` → 通過。**單變數負例** —— (i) 帶 `batchRecordVersion: 2` 但缺 `inventorySnapshot` → fail-closed，**不得**降級成 legacy 讀法；(ii) `batchRecordVersion` 為未知值或非整數 → fail-closed；(iii) record malformed → fail-closed。**legacy 正例／禁止** —— 一筆 v1.12 legacy record（無版本欄位、root key set 恰為 v1.12 exact absence shape）：其 `recordId`／`taskId`／`batchDigest`／`relatedRefs`／`previousBatchRef`／chain 位置**可讀**，但任何需要 inventory preimage 的判定（pre-state 綁定、derived equality、post-commit inventory 對位）一律視為**無證據 fail-closed**，**不得冒充 Phase 2 proof**；缺版本欄位而 root shape 又不吻合者 → fail-closed。**chain 行為** —— v2 接在 legacy head 之後 → **通過**（就地升級，歷史不遷移不回寫）；legacy 接在 v2 之後 → **fail-closed**（版本必須單調不減，這正是「新 writer 漏寫欄位」的可偵測訊號）。
129. **排除 provenance store 不得使 `governance-affected` 失去 freshness**（carrier：§11b.9d ＋ §11b.10 closed exclusion）：`.ctide/provenance.json` 被排除於 `headViewDigest` 之外。**單變數負例**：inventory 產生後、Step 5 提交前，store 中某個 clause 的生命週期被改動（其反向閉包會產生不同的 `governance-affected` entry 集合）→ 該 inventory **必須**被擋下（由 `inputProvenanceStoreDigest` 經 pre-state precondition 與 AC123 的 binding 等式共同承載），**不得**因「store 不在 head universe 內」而靜默通過。本 AC 直接驗證「排除不等於放棄」。
130. **head view 成分與 ignore authority**（carrier：§11b.10）：staged、unstaged、untracked 且未被忽略者**納入**；工作區已刪除者視為該 path 不存在；受版控 `.gitignore` 忽略者**排除**（**唯一 exact-path 例外見下**）；path／case 取 Git literal。**單變數負例**：只在 `core.excludesFile` 指向的 global excludes 或 `.git/info/exclude` 中加入一條規則 → 輸出**不得**改變（兩者皆非 authority）。所採用的 `.gitignore` 本身納入 S1 與 fingerprint。untracked path 的 case 取實際 directory entry 字面值，**不得**由 Windows case-folding 重寫。**v1.11 新增：ignored-path exclusion 的唯一 exact-path 例外** —— `.ctide/test-adapters-config.json` 只要在 worktree 中存在就**必須納入 snapshot**，**即使**被 tracked `.gitignore`（例如 `/.ctide/`）忽略；純 untracked 時 `entry(path).tracked == false`，位於 index stage-0 時為 `true`。該例外**不得**推廣為 `.ctide/**`、任何前綴或任何其他 path，且 `.git/**`、`.ctide/provenance.json`、`.ctide/output/**` 三項 hard exclusion **不得**因此放寬（判定順序第 1 步先於第 2 步）。**單變數負例**：把該例外實作成前綴（於是 `.ctide/output/**` 或 `.ctide/provenance.json` 也被納入）→ AC131 的 exclusion 正例必然失敗，本 AC 必須抓出。
131. **head view universe 的 closed exclusion／inclusion**（carrier：§11b.10 closed 範圍）：**exclusion 正例** —— 只改動 `.git/**` 內容、只改動 `.ctide/provenance.json`、只改動 `.ctide/output/**`（含 inventory 自身）三者，各自**不得**改變 `headViewDigest`。**inclusion 正例** —— 只改動測試檔、helper 模組、golden／expected-data 檔、`.ctide/test-adapters-config.json`（**v1.11：即使 repo 的 tracked `.gitignore` 以 `/.ctide/` 之類的規則忽略它，它仍必須被納入，改動它仍必須改變 `headViewDigest`** —— 本項的 fixture **必須實際帶那條 ignore 規則**，否則測到的是一個沒有 ignore 規則的世界，§11b.10 判定順序第 2 步根本不會被觸及）、任一層級的 `package.json`、tracked `.gitignore` 六者，各自**必須**改變 `headViewDigest`。**負例**：實作以「必要檔案」之類的啟發式取代封閉列舉（例如只收 `*.test.mjs`）→ 上述 inclusion 正例中的 helper／golden／`package.json` 會漏，本 AC 必須抓出。
132. **gitignore matching 的唯一語義**（carrier：§11b.10 engine boundary）：前綴 `/`、後綴 `/`、`*`／`?`／`**`、字元類、`!` 反否定、較後規則勝、巢狀 `.gitignore` 以其所在目錄為根 —— 各以 fixture 驗證。求值只以 S1 內的 `.gitignore` bytes 與候選 path 為輸入。以近似 glob 冒充（`**` 與 `*` 不分、忽略 `!`）→ 必須被本 AC 抓出。
133. **Symlink 不跟隨，且 base／head type-aware parity**（carrier：§11b.10 ＋ §11b.10 AdapterContentView）：head view 中的 symlink 只讀 link entry 本身的 bytes，不解析目標；其 `type` 記為 `"symlink"`、`mode` 為 `"120000"`；base view 沿用 §2 既有規則。**v1.12 新增（base 與 head 各驗一次，行為必須一致）**：(i) symlink **留在 `AdapterContentView` 中**且 `entry(path).type == "symlink"`，`read(path)` 回傳 **link target 的 raw bytes**；(ii) snapshot／golden 的 whole-file dependency **可以**命中該 symlink，並**以那份 raw bytes** 計 digest（仍不跟隨）；(iii) executable test module、helper module 與 package manifest **必須拒絕** symlink（§11b.9f「命中必須是 blob」）；(iv) **不得**以「從 view 省略 symlink」代替 type check —— 省略會讓「存在但不是合法 module」與「根本不存在」變成同一件事；(v) **不得** follow，**也不得**把 raw target 字串當成 JavaScript source 去 parse。**另驗**：`160000`（gitlink／submodule）或其他 leaf mode → **fail-closed**。
134. **HeadViewSnapshot S1／S2 原子讀取**（carrier：§11b.10 snapshot 協定 ＋ `configCarrierState`）：(i) parsing、dependency resolution、digest 與 emission **只讀 S1** —— 驗法：S1 建立後、emission 前竄改 worktree，artifact bytes 仍須逐項等於 S1；(ii) 完成前取 S2，**穩定條件為兩項同時成立** —— `S1.fingerprint == S2.fingerprint` **且** `configCarrierState(S1) == configCarrierState(S2)`；**任一**不相等 → `head-view-unstable` 且**不產生任何 artifact**；(iii) **不得**把兩個時間點的 bytes 寫進同一份 inventory。允許呼叫端整批重試。**v1.11 新增可區分案例（fixture 必須帶含 `/.ctide/` 的 tracked `.gitignore`）**：S1 當下 `.ctide/test-adapters-config.json` 為 **tracked**；S1 之後以**純 index 操作**（例如 `git rm --cached`）使它變成 **untracked**，worktree 的 bytes、mode、type **完全不變**。於是 **S2 的 `headViewDigest` 必須與 S1 相同**（依判定順序第 2 步，該 path 在兩態下都在 canonical map 內，且三欄未變），但 `configCarrierState` 由 `"tracked"` 變成 `"untracked"` → **仍必須 `head-view-unstable`、不得產生任何 artifact**。**只比較 `headViewDigest` 的錯誤實作會在此靜默通過**，本 AC 必須抓出它。**不得**為了通過本案而把 `tracked` 加進 canonical map、fingerprint 或 `headViewDigest` —— 那會直接違反 AC160；**AC134 與 AC160 必須同時成立**。
135. **`headViewDigest` 涵蓋完整 universe**（carrier：§11b.10 canonical map 公式）：map 為 `path → { mode, type, contentDigest }`，依 path code point 序排序，`contentDigest` 取 **raw bytes**。四個**單變數**變動各自**必須**改變 `headViewDigest`：新增檔案、刪除檔案、改名（同內容）、只改檔案模式（`100644` → `100755`）。同時驗 entries 不變時這四者仍被 AC118 的 S3 擋下。
136. **Parser 能力契約 fail-closed，且不含 re-export**（carrier：§11b.11）：syntax error、unsupported syntax、ambiguous binding → 各自 fail-closed；**regex-only fallback 不得冒充 AST**。**單變數負例**：測試經跨模組 **re-export** 取得 `test` 或 assertion binding（其餘寫法皆合法）→ **unsupported fail-closed** —— re-export 解析在 v1 profile 與 discovery 皆未授權，列為 capability 只會製造沒有規則支撐的期待。`parserId`／`parserVersion` 變動即視為 implementation 變動（carrier 見 AC114–115）。
137. **兩個獨立 writer 結果一致**（carrier：§11b.8 canonical encoding ＋ §11b.9 排序 ＋ §11b.11 最後一句）：同一 source 與同一 view 下，兩個合規 writer 必須得到相同的 `structuralId`、dep closure 與所有 digest。**跨平台（Windows／Linux）未實跑者只能標為本機 deterministic contract evidence，不得宣稱 AC59 已滿足。**
138. **Populated gate 在實作完整前仍 fail-closed**（carrier：§11b.12 rollout boundary）：v1.6 核准本身**不**解除 `parseInventory()` 的 `unsupported-populated-inventory`；只有 adapter registry（含已核准的 parser identity）、parser、gitignore engine、producer、canonical parser、consumer freshness 六者皆實作並通過其 AC 後才可接受 populated inventory。**另**：v1.13／v1.9／v1.6 三份 draft 核准後，Phase 1 與 Phase 2A 的既有 approved 狀態雖不撤回，但在 AC128 的 legacy boundary 實作並通過之前，**不得宣稱「新 draft promotion 後 Phase 1／2A 完全不受影響」** —— legacy batch record 的可讀範圍與禁止用途是新增的 consumer 義務。

139. **Declaration range 是最外層 `ExpressionStatement`**（carrier：§11b.8c canonical declaration range）：**單變數** —— 在一個合法 test declaration 尾端**只增或只刪一個 semicolon**，其餘 bytes 完全不動 → `declarationDigest` **必須改變**（semicolon 落在 `ExpressionStatement` range 之內）。**反例實作**：以內層 `CallExpression`、callback function 或 callback body 作為 range 者，該 digest 會**不變** —— 本 AC 必須抓出。另驗：statement 之後的 trailing inline comment 與行終止符改動 → digest **不變**（不在 range 內）。
140. **Canonical range 的起點與邊界**（carrier：§11b.8c）：有 attachment block 時，range **起於該 maximal block 第一行的 line-start byte**。**單變數正例** —— 只改該行的 indentation（空白多寡）→ digest **改變**；只改 block 與 declaration 之間某個一般 line comment 的內容 → digest **改變**。**單變數負例** —— 只改 statement 之後的 trailing inline comment，或只改 statement 之後的行終止符數量 → digest **不變**。無 attachment block 時起點為 `ExpressionStatement.byteStart`。
141. **Directive-intent predicate、exact lexical form 與 accounting**（carrier：§11b.8c directive-intent predicate ＋ exact lexical form）：**正例** —— `// @src <token>` 兩個分隔位置各恰一個 U+0020，token 後無任何內容。**candidate 但 malformed（四個單變數負例，其餘完全相同）** —— `//@src …`（`//` 後無空格）、`//  @src …`（`//` 後兩個空格）、`//\t@src …`（`//` 後 HTAB）、`// @src  TOKEN`（`@src` 後兩個空格） → 四者在 intent 判定移除 leading SP／HTAB 後都以 `@src` 開頭，**都是 candidate**，但都不吻合 exact form → **各自 malformed fail-closed，不得降級為普通註解**。另加 `// @src <token> `（trailing space）與 `// @src <token> // note`（token 後有內容）。**非 candidate 的關鍵對照** —— `// explanation of @src` 移除 leading 空白後以 `explanation` 開頭 → **不是 directive-intent candidate**，就是一般註解，**不得** fail-closed。`//\t@src` 必須 fail 與 `// explanation of @src` 必須通過，這一對正是用來區分「以 payload 開頭判 intent」與「在整行任意位置搜尋 `@src`」兩種錯誤實作。`@tid` 全部同構。另驗四類歸屬失敗 —— **orphan**（被空白行隔開）、**malformed**、**ambiguous**（同時可歸屬兩個 declaration）、**borrowed**（附著於 container／hook／普通 helper）→ 全部 fail-closed。
142. **test／container／hook 的 argument 與 callback closed profile**（carrier：§11b.6b）：**正例** —— 兩個 argument、字串 literal ＋ block-bodied arrow／function callback，`async` 有無皆可，零個或多個簡單 Identifier parameter。**單變數負例** —— options argument（`test("n", { skip: true }, fn)`）、缺 callback（`test("n")`）、多餘 argument（`test("n", fn, extra)`）、spread（`test(...args)`）、concise arrow expression body（`test("n", () => expr)`）、generator callback（`function* () {}`）、default parameter（`(t = 1) => {}`）、rest parameter（`(...a) => {}`）、destructuring parameter（`({ t }) => {}`）→ 各自 unsupported fail-closed。hook 端：恰一個 argument，`before(fn)` 通過；`before({}, fn)`、`before()`、`before(fn, extra)` 各自 fail-closed。**placement 負例** —— 同一個 `test(...)` 呼叫置於 `if`／`for`／`try`／普通 function／非 container callback 之內 → 各自 unsupported fail-closed，**不得**被推測成靜態 declaration。
143. **Declaration name 取 decoded StringValue**（carrier：§11b.6b declaration name）：`test("same", …)`、`test('same', …)`、`` test(`same`, …) ``、`test("\x73ame", …)` **四種確實不同的 source 拼法**（雙引號、單引號、無插值 template、hex escape）→ decoded StringValue 皆為 `same`，因此 → **derived structuralId 相同**（因而落入同一 duplicate group，各自需要唯一 `@tid`）。**單變數負例** —— `test("same ", …)`（尾隨空格）、`test("Same", …)`（大小寫不同）→ StringValue 不同 ⇒ **名稱不同、structuralId 不同**（不 trim、不 case-fold）。
144. **Fixture-hook 的 span 與 applicability**（carrier：§11b.9e）：**span 正例** —— depRef 為 `{ kind: "byte-range", startInclusive: callback.body.byteStart, endExclusive: callback.body.byteEnd }`，**包含** `{` 與 `}`。**span 是 normalized module 內的絕對 byte offset**，所以「parameters 不在 span 內」**不表示** parameter 的長度不影響其後的 offset —— 兩個對照必須分開驗：**(a) 等長改名** `(ctx) => { … }` → `(arg) => { … }`，`ctx` 與 `arg` 同為 3 bytes ⇒ body 起點與終點不變 ⇒ depRef span **不變**；**(b) 不等長改名** `(ctx) => { … }` → `(t) => { … }`，body 文字完全相同但 parameter 少 2 bytes ⇒ `startInclusive` 與 `endExclusive` **各向前移 2 bytes** ⇒ depRef span **必須改變**。把 span 實作成大括號**內部**者，會在只改 `{`／`}` 相鄰 bytes 時失準，本 AC 須抓出。**applicability 六案** —— (i) Program scope hook → 適用該 module 所有 test；(ii) ancestor container hook → 適用其完整 subtree；(iii) current container hook → 適用；(iv) **sibling** container hook → **不適用**；(v) **descendant** container hook → **不適用**；(vi) 同一合法 scope 內，hook 置於 test **之前**與**之後**兩種排列 → applicability **完全相同**。另驗 hook body 內的 helper／snapshot dependency 一併被遞迴展開，且集合依 canonical depRef 排序去重（非發現順序）。
145. **同 module callable binding 的 closed 子集**（carrier：§11b.9f）：**正例** —— `function helper() {}` 與 `const helper = () => {}`／`const helper = function () {}`，皆為 block-bodied，經 direct identifier call 解析。**單變數負例** —— `let helper = …`、`var helper = …`、宣告後再 `helper = other`（reassignment）、object method（`obj.helper()`）、class method、computed call target（`obj[k]()`）、member call target、optional-chain call（`obj?.helper()`）、destructured binding（`const { helper } = …`）、runtime factory 產物、同名兩個合法 binding（ambiguous）→ 各自 fail-closed。另驗 generator function binding 不支援。
146. **Relative-module resolver 的 closed 形式**（carrier：§11b.9f）：**正例** —— `import { helper } from "./h.mjs"`、`import { helper as h } from "../lib/h.js"`、`import helper from "./h.mjs"`；target 端 `export function`／`export const`／`export { local }`／`export { local as exported }`／`export default function`／`export default` 的 function／block-bodied arrow 皆可解析。**單變數負例** —— extensionless（`"./h"`）、directory index（`"./lib"` 期待 `lib/index.mjs`）、namespace import（`import * as h`）、帶 `source` 的 re-export（`export { helper } from "./h.mjs"`）、`export *`、bare package（`"lodash"`）、repo-root escape（`"../../../outside.mjs"`）、反斜線／query／fragment specifier、指向 symlink 的 helper module、`.js` 依最近祖先 `package.json` 判定為 CommonJS、以及解析結果不在同一 captured view 內 → 各自 fail-closed。另驗 resolver **只讀 immutable view**：把同名檔案只放在 live filesystem 而不在該 view 內 → 仍 fail-closed，**不得**解析成功。**`.js` package boundary 的單變數對照**（carrier：§11b.9f package boundary）—— repo root 的 `package.json` 為 `"type": "module"`，一個 `./h.js` helper 因此合法；**只在 helper 所在目錄新增**一份更近的 `{ "type": "commonjs" }` manifest（其餘一切不動）→ 同一個 helper **必須由合法變成 unsupported fail-closed**。**反向** —— root 為 `commonjs` 而 helper 目錄有一份更近的 `{ "type": "module" }` → 同一 helper **必須由 unsupported 變成合法**。兩者共同證明搜尋起點是 **helper 所在目錄**（不是 test 或 importer 的目錄）且 nested boundary 覆蓋 root。另驗 manifest 缺失、malformed、缺 `type`、`type` 非字串、`type` 為 `"module"` 以外的值 → 各自 fail-closed。**Lexical normalization 的單變數對照**（carrier：§11b.9f 唯一演算法）—— `"./%68.mjs"` 含 `%` → **直接 unsupported**（不得被 URL 解讀成 `./h.mjs`）；`"./a//h.mjs"` 空 segment → **unsupported**；`"./lib/../h.mjs"` 與 `"./lib/./h.mjs"` 經 lexical 消解後必須得到與 `"./h.mjs"` **相同的 canonical path**；`"../../../outside.mjs"` 的 pop 超出 repo root → **立即 fail-closed**。這一組專門用來抓「一邊用 URL／path library、一邊用自寫 lexical 消解」的 writer 分歧。
147. **Contributor 判準、SUT 排除、同檔、cycle 與 dedup**（carrier：§11b.9f contributor 段）：**正例** —— test → `a()` → `b()`，且只有 `b` 含 allowlist assertion → `a` 與 `b` **都是** contributor（`a` 在 traversal path 上且其遞迴展開含 assertion），各自產生所在 module 的 whole-file depRef；同檔 contributor 仍產生該檔 whole-file depRef；`a → b → a` 的 cycle 以 visited-set 終止且**不是錯誤**；同一 module 的多個 contributor 去重後只留一筆 whole-file depRef。**單變數負例** —— 只修改測試所呼叫的**不含 assertion** 的 SUT callable → 該 test **不得**因 oracle 規則被標為 `modified`。**關鍵負例** —— traversal path 上出現一個未分類／dynamic／computed／ambiguous 的 `CallExpression` → **fail-closed**，**不得**回傳 empty closure。
148. **`REQ@DP` 的分層與最終合法集合不變**（carrier：§11b.8c 分層段 ＋ §2 ＋ §7）：**adapter 層** —— `REQ-x@DP-y` 被解析成 `{ clauseRef, dpRef }` 並通過 lexical／structural 檢查；`DEC-x@DP-y` 與 `ASSUM-x@DP-y` 仍由 adapter **直接拒絕**（不需 store）。**pipeline 層** —— 以**同一份 captured provenance-store pre-state** 驗該 REQ 是否確為 exception-backed；**單變數負例**：`REQ-x` 非 exception-backed 而 tag 寫成 `REQ-x@DP-y` → **在 entry emission 之前 fail-closed**，且**不得**產生任何 inventory entry。本 AC 必須斷言最終合法集合與 §2／§7 **完全相同**——分層只改變拒絕發生的層級，不放寬端到端 fail-closed。
149. **兩個獨立 writer 對新增規則產生相同結果**（carrier：§11b.6b ＋ §11b.8c ＋ §11b.9e ＋ §11b.9f）：同一 normalized source 與同一 immutable view 下，兩個合規 writer 必須對 **declaration range、declaration name、hook applicability、callable／module resolver 與 oracle closure** 全部產生相同結果。**單變數負例** —— 兩個實作若在下列任一處分歧：range 取 `CallExpression` vs `ExpressionStatement`、name 取 raw token vs decoded StringValue、hook 只取 current container vs 取完整 ancestor chain、resolver 做 extension probing vs 不做 → 本 AC 必須產生不同輸出而被抓出。**跨平台（Windows／Linux）未實跑者只能標為本機 deterministic contract evidence**，不得宣稱 AC59／AC137 已滿足。
150. **規格放行不等於實作放行**（carrier：本文件 live status ＋ §11b.12 rollout boundary）：v1.7 已於 **2026-08-10 經使用者明確核准**（前置 draft 內容經獨立 Codex 審查；**本次未執行 agent-duel panel**），前一 approved 版本為 **v1.6**。**此 approval 只涵蓋 spec authority。****不得**因本次 promotion 宣稱 node-test-v1 executable component 已實作，**不得**宣稱 AC136／AC137／AC138 已滿足，**不得**解除 `unsupported-populated-inventory`，**不得**接受 populated inventory，**不得**宣稱 Phase 2 READY。**AC138 及其附加限制不因本次 promotion 而弱化。****截至該次 v1.7 promotion 當下**，三項 executable capability —— `structuralId`、tag attachment、`effectiveOracleDeps` —— **一項都未實作**，規格閉合的是「兩個獨立 writer 該算出什麼」，不是「已經有人算出來了」。**其後的 implementation acceptance 不由該次 promotion 推出**；current status 見本文件 live status 的 implementation-status addendum 與 AC154。
151. **Adapter 對 canonical ULID 的 accounting**（carrier：§2 上游引用 ＋ §11b.8c directive-intent predicate）：**正例（三條各自被接受，並解析出預期的 `{ clauseRef }`／`{ clauseRef, dpRef }`）** —— `// @src REQ-00000000000000000000000000`、`// @src DEC-7ZZZZZZZZZZZZZZZZZZZZZZZZZ`、`// @src REQ-00000000000000000000000000@DP-7ZZZZZZZZZZZZZZZZZZZZZZZZZ`。**負例 —— 每一條都必須先被判為 directive-intent candidate，再因 ULID 不吻合而 malformed → fail-closed**（不得降級為普通註解，也不得 normalize 後接受）：(i) clause ULID 首字元 `8`（overflow）；(ii) dpRef ULID 首字元 `8`；(iii) clause ULID 少 1 byte、(iv) clause ULID 多 1 byte；(v) dpRef ULID 少 1 byte、(vi) dpRef ULID 多 1 byte；(vii) 任一處 lowercase；(viii) 含 `I`、(ix) 含 `L`、(x) 含 `O`、(xi) 含 `U`；(xii) 含 whitespace、(xiii) 含非 ASCII、(xiv) token 之後有額外 suffix；(xv) 需要先 case-fold 或做 alias 替換才吻合者。**必須明確驗到**：parser **不得只驗 prefix**；`// @src REQ-abc` **不得**被當成合法；malformed candidate **不得**被略過；**兩個獨立 writer 必須產生相同的 accept／reject 結果**。`REQ@DP` 在 adapter 層仍**只做 lexical／structural parsing** —— exception-backed 狀態仍由 pipeline 以 captured store pre-state 判定，本 AC 不涉及該判定。
152. **規格放行不等於實作放行**（carrier：本文件 live status ＋ §11b.12 rollout boundary）：v1.8 已於 **2026-08-10 經使用者明確核准**（前置 draft 內容經獨立 Codex 審查並 ACCEPT；**本次未執行 agent-duel panel**），前一 approved 版本為 **v1.7**。**此 approval 只涵蓋 spec authority。****截至該次 v1.8 promotion 當下**，node-test-v1 executable component **尚未實作**；`structuralId`、tag attachment、`effectiveOracleDeps` 的 implementation readiness **不得由本次 promotion 推出**。**其後的 implementation acceptance 同樣不由該次 promotion 推出**；current status 見本文件 live status 的 implementation-status addendum 與 AC154。**AC136／AC137／AC138 未因此滿足**；`unsupported-populated-inventory` **不得解除**；**不得**宣稱 Phase 2 READY。**AC1–151 未被修改，AC138 未弱化。**
153. **snapshot path resolution 的 executable matrix**（carrier：§11b.9 snapshot path 的唯一 resolution algorithm）：每個案例**只改動該案例明示的單一維度**；除案例明示的 argument 0 StringValue、AST carrier、module location、captured-view entry presence 或 enclosing scope binding 外，其餘輸入必須與對應 **control fixture** 完全相同。
     **正例（四項，各須實際解析出 canonical repo-relative path 並產生 `depRef`）** —— (a) `"./fixtures/golden.txt"` → 以該 module 的 dirname 為根的 module-relative canonical path；(b) nested module（例如 `deep/nest/a.test.mjs`）中的 `"../fixtures/golden.txt"`，未逃逸 repo → canonical path —— 此例證明根是**該 module 的 dirname**，既不是 repo root 也不是 process cwd；(c) `"./lib/../fixtures/golden.txt"` 與 `"./fixtures/./golden.txt"` 經 lexical normalization 後 → 與 (a) **同一個** canonical path，三者的 `depRef` 必須逐欄相等；(d) **escaped source spelling** —— 若 decoded StringValue 恰為合法的 `./…`（例如 `"\x2e/fixtures/golden.txt"`），則依 **decoded StringValue** 判定並**通過**，**不得**因 raw token 的拼法而拒絕。
     **逐項單變數負例（十七項；每一項都必須 fail-closed，且**不得**以另一個 path 猜測、修復或降級）** —— (1) `"fixtures/golden.txt"`（缺 `./`／`../` 前綴）；(2) `"fix%74ures/golden.txt"`；(3) `"./fix%74ures/golden.txt"`；(4) `"C:/golden.txt"`；(5) `"file:fixtures/golden.txt"`（刻意選這個拼法：錯誤的 WHATWG writer 會依 file URL semantics 相對 module directory 解析到 **`fixtures/golden.txt`**，亦即與 positive control **同一個、且確實存在**的 target，因此它會**接受**這一案 —— 唯一能拒絕它的理由是 prefix gate，不是「檔案不存在」）；(6) `"mailto:golden"`；(7) `"/absolute/golden.txt"`；(8) `"./a//golden.txt"`（空 segment）；(9) `"./golden.txt?x"`；(10) `"./golden.txt#x"`；(11) StringValue 內含反斜線 —— 精確為 `"./dir\\golden.txt"`（**source token 內兩個 U+005C，decoded StringValue 內恰一個 U+005C**）；此案的 `./` prefix **仍然合法**，因此它**只**驗 backslash rejection，不與 (1) 的 prefix gate 混淆；(12) repo-root escape（例如 `"../../../outside.txt"`）；(13) normalized target 在該 captured view 內**不存在**；(14) argument 1 改為 `new.target.url`；(15) argument 1 改為 `import.meta["url"]`；(16) 同 scope 內以 local binding shadow 掉 `URL`（例如 `const URL = …`）；(17) argument 0 改為 template literal（**含無插值者**）或變數。
     **本矩陣必須同時點名並拒絕兩個錯誤 writer** —— **(A) WHATWG URL／percent-decoding writer**：(2)／(3) 會被 percent-decode 成 `fixtures/golden.txt`，亦即 positive control 的既有 target，因此可能被**錯誤接受**；修改後的 (5) `"file:fixtures/golden.txt"` 依 WHATWG file URL semantics 相對 module directory 解析，得到**同一個既有 target**，同樣可能被**錯誤接受**。**真正能區分這個 writer 的案例恰為 (2)、(3)、(5)。** (4)／(6) 在該 writer 之下會變成**非 file scheme**（`C:` 被讀成 scheme、`mailto:` 本身就是 scheme），一個仍堅持要拿到 filesystem path 的錯誤 writer **可能照樣拒絕**它們 —— 因此**不得**宣稱 (4)／(6) 單獨區分得出 WHATWG writer；它們仍是必跑的 fail-closed 負例，只是不承擔區分職責。(7) `"/absolute/golden.txt"` 是 **repo-boundary negative**：合規 writer 與**帶 boundary guard 的** WHATWG writer **都會**拒絕，因此**不得**宣稱它單獨區分兩者。**(B) 任意 literal-as-POSIX writer（未要求 `./`／`../` 前綴）**：它會把 (1) `"fixtures/golden.txt"` 解析到與 positive control **同一個、確實存在**的 target 而**錯誤接受**；因此**真正能區分這個 writer 的案例恰為 (1)**。(4)／(5)／(6) 雖會被它視為普通 segment，但在 unchanged control fixture 中**不命中既有 entry**，保留 **exact-view existence gate** 的錯誤 writer 仍可能拒絕它們；**不得**宣稱這三案單獨區分得出 writer (B)。它們仍是必跑的 scheme-like／prefix-boundary fail-closed 負例，只是不承擔 writer (B) 的區分職責。
     兩個錯誤 writer 在正例 (a)–(d) 上與合規實作**看起來完全一致** —— 只有上列負例能把三者分開。這正是本 AC 必須**逐項實跑**、不得只驗正例的理由。
154. **規格放行不等於實作放行**（carrier：本文件 live status ＋ §11b.12 rollout boundary）：v1.9 已於 **2026-08-12 經使用者明確核准**（前置 draft 內容經獨立 Codex 審查並 ACCEPT；**本次未執行 agent-duel panel，因此不稱為 panel 放行**），前一 approved baseline 為 **v1.8**；current approved coupled set 現為 **shared approved v1.13 ＋ intent-scan approved v1.10 ＋ test-provenance approved v1.9**。**此 approval 只涵蓋 spec authority。** commit `4585812` 的 node-test-v1 component **不因本次 promotion 成為 ACCEPT** —— **promotion 當下**它是待修、未接受的 provisional implementation，且仍接受不帶 `./`／`../` 前綴的 snapshot literal，與當時剛生效的 approved prefix gate 直接衝突，因此必須修正並重新審查。**這是 promotion 當下的事實。****現況（截至 2026-08-13；status，非 promotion 的推論）**：該 snapshot prefix-gate 衝突**其後已修正**，node-test-v1 executable component 已**另經獨立 review 接受**；parser／ignore wrapper、formal adapter registry 與 HeadViewSnapshot S1／S2 ＋ `headViewDigest` component 亦各自有其獨立 acceptance。**這些都是後續 implementation review 的結果，不是本次 spec promotion 自動造成的。****即便如此**：populated inventory producer、v2 canonical inventory parser、base／head one-to-one matcher、governance reverse closure、**S3 consumer freshness 重算**與 artifact emission／wiring **一項都未完成**（HeadViewSnapshot 提供 S1／S2，**不是** S3）；**AC118／AC136／AC137／AC138 一律不得宣稱已滿足**，**不得**接受 populated inventory，**不得**解除 `unsupported-populated-inventory`，**不得**宣稱 Phase 2 READY。**AC138 及其附加限制不因本次 promotion 或其後的 implementation acceptance 而弱化。**
155. **Entry exact shape 與 conditional body-digest presence**（carrier：§6 entry exact key set ＋ nested exact shapes）：每筆 entry **永遠**恰有 common seven（`testRef`、`status`、`reason`、`tagBefore`、`tagAfter`、`framework`、`implementationIdentity`），body digest 依 `status` 分派。**正例（各自被接受）**：(a) `added` —— 帶 `headBodyDigest`、**無** `baseBodyDigest` key、`tagBefore == null`；(b) `deleted` —— 帶 `baseBodyDigest`、**無** `headBodyDigest` key、`tagAfter == null`；(c) `modified`／`retagged`／`moved` —— 兩個 body digest 皆存在；(d) `governance-affected` —— 兩個 body digest 皆存在、`reason == governance-affected`、且 `tagBefore == tagAfter ∧ baseBodyDigest == headBodyDigest`（§6 既有 invariant，未改）。**負例（每條各自 fail-closed，且每條只改動一個變數）**：(i) `added` 帶 `baseBodyDigest`；(ii) `added` 的 `baseBodyDigest` 為 `null`；(iii) `deleted` 帶 `headBodyDigest`；(iv) `deleted` 的 `headBodyDigest` 為 `null`；(v) 該 status 下必填的 body digest 缺失；(vi) 該 body digest 為 `null`；(vii) entry 多一個未宣告 key；(viii) entry 缺一個 common key；(ix) `testRef` 多一 key、(x) `testRef` 缺一 key；(xi) clause tag 多一 key（例如 `{ clauseRef, dpRef, extra }`）、(xii) clause tag 缺 `clauseRef`；(xiii) `EXPL` 多一 key、(xiv) `EXPL` 的 `expl` 非 `true`；(xv) `implementationIdentity` 多一 key、(xvi) 缺一 key；(xvii) `added` 的 `tagBefore` 非 `null`；(xviii) `deleted` 的 `tagAfter` 非 `null`；(xix) 非 `deleted` 的 `tagAfter` 為 `null`；(xx) `status == governance-affected` 而 `reason == content-change`；(xxi) `status == modified` 而 `reason == governance-affected`。**「必須缺席」不是 `null`**：(i) 與 (ii) 必須是**兩條各自成立**的負例 —— reader 不得把 `null` 讀成 absence，也不得補欄、刪欄或反向 normalize。本 AC **不**新增 `retagged`／`moved` 的 body-digest equality 語義，亦**不**新增任何 producer classification 規則；只閉合既有 schema carrier。
156. **OID 與 digest 的 canonical spelling**（carrier：SM v1.14 carrier lexical grammar ＋ `baseTreeOid` 的 repository-semantic 邊界）：**正例** —— `baseTreeOid` 分別為 40 個 lowercase hex 與 64 個 lowercase hex，兩者**各自**通過 lexical 檢查（40 對應 SHA-1 object format，64 對應 Git SHA-256 object format）；四個 digest carrier（`registryDigest`、`headViewDigest`、`inputProvenanceStoreDigest`、`inventoryDigest`）各以 64 個 lowercase hex 通過。**負例（各自 fail-closed）** —— `baseTreeOid`：abbreviated OID、uppercase、含非 hex 字元、長度 39／41／63／65；digest carrier：uppercase、帶 `sha256:` prefix、含前後或內嵌 whitespace、長度 63／65。**另必須明確驗到**：(a) `inventoryDigest` 通過 `^[0-9a-f]{64}$` 但與唯一公式重算結果不符 → **仍 fail-closed**（lexical grammar **不取代**重算）；(b) isolated canonical reader **不得**因 `baseTreeOid` 通過 lexical grammar 而宣稱該 object 存在、或宣稱其 type 為 tree —— 「長度符合該 repo 的 object format、object 存在、object 自身 type **恰為** tree（**不得**只驗它可以 peel 成 tree）」三項是**有 captured repository context 的 consumer** 的義務；(c) reader 亦不得只憑 `registryDigest`／`headViewDigest`／`inputProvenanceStoreDigest` 三個字串宣稱已驗證其 preimage 或 freshness。
157. **Raw duplicate member 與遞迴 entry-key ordering**（carrier：SM v1.14 duplicate-member contract ＋ §2 Entry source-key ordering）：**負例（各自 fail-closed）** —— (i) root 出現 duplicate member；(ii) 某 entry 出現 duplicate member；(iii) `testRef`／clause tag／`implementationIdentity` 任一 nested object 出現 duplicate member；(iv) 兩個 member 的 raw spelling 不同但**解碼後名稱相同**（例如 `"path"` 與 `"\u0070ath"`）→ 仍屬 duplicate；(v) entry top-level key 未依解碼後 code point 序**嚴格遞增**；(vi) `testRef`／`tagBefore`／`tagAfter`／`implementationIdentity` 任一 nested object 的 key 未排序；(vii) `entries[]` 逆序；(viii) `entries[]` 出現相同的 `(path, adapterId, structuralId)` tuple。**必須被測試實際抓出的兩個實作缺陷** —— (α) 只用 `JSON.parse`（last-write-wins）之後再對其結果檢查、而未在**仍保有全部 member occurrence** 的階段判定 duplicate；(β) reader 先排序（或去重）再接受本應 fail-closed 的輸入。**正例（不得單獨因此被拒絕）** —— (a) canonical entry subtree（每一層 key 皆已排序）；(b) root 的 key 順序與宣告順序不同，但 root exact key set 與其餘內容相同；(c) 僅 JSON whitespace 不同的兩份等價文件。
158. **Approval／implementation boundary（shared v1.14 ＋ test-provenance v1.10）**（carrier：兩份文件的 live status ＋ §11b.12 rollout boundary）：**shared v1.14 與 test-provenance v1.10 已於 2026-08-13 由使用者明確核准**（前置 draft 內容已由獨立 Codex 審查並 ACCEPT；**本次未執行 agent-duel panel，因此不稱為 panel 放行**）。**前一 approved baseline 為 shared approved v1.13 ＋ intent-scan approved v1.10 ＋ test-provenance approved v1.9**；**current approved coupled set 現為 shared approved v1.14 ＋ intent-scan approved v1.10 ＋ test-provenance approved v1.10**，三者是同一生效集合，不得分開採用，**intent-scan 本輪內容不變**。**此 approval 只涵蓋 reader 的 spec authority，不是 reader implementation。**因此：**不代表** canonical v2 inventory parser 已實作；**不得**接受 populated inventory；**不得**解除 `unsupported-populated-inventory`；**不代表** populated inventory producer、base／head one-to-one matcher、governance reverse closure、**S3 consumer freshness 重算**或 artifact emission／Step 5／6、ledger、arbiter wiring 已完成。**AC118／AC136／AC137／AC138 一律不得宣稱已滿足**，**Phase 2 不得宣稱 READY**；**AC138 及其附加限制不因本次 promotion 而弱化**（AC138 本輪 byte-identical）。
159. **Registry 與 explicit config 的 raw duplicate-member matrix**（carrier：§11b.3 ＋ §11b.4 的 duplicate-member 規則。**本 authority 由本文件自持**：上游 **SM v1.14** 的 duplicate-member contract 範圍不變，仍只擁有完整 `ChangedTestInventoryV2`，本輪不修改 shared spec，也**不得**宣稱它已涵蓋這兩個 carrier）：**負例（每條各自 fail-closed）** —— (i) registry root 出現重複的 `registryVersion`，**前值非法、後值合法**；(ii) registry 某個 `adapters[]` element 內出現重複的 `adapterId`，兩處 raw spelling 相同；(iii) registry 的 nested object（`implementationIdentity` 或 `discovery`）以 **escape alias** 重複某 member（例如 `"parserId"` 與 `"\u0070arserId"`）；(iv) config root 出現重複的 `configVersion`，**前值非法、後值合法**；(v) 同一個 `assignments[]` element 內重複 `path`；(vi) config 的 nested object 以 escape alias 重複某 member。**(i) 與 (iv) 刻意把合法值放在後面**：任何「`JSON.parse` 之後才檢查」的 reader 都會取到合法末值而放行，本 AC 必須把它抓出。另須斷言：duplicate 判定**先於** exact key set、field value 與任何 digest 判斷；reader **不得**修補、擇 first、擇 last、去重或重新序列化後放行；**所有失敗都不得改動 carrier bytes**（每案比對失敗前後的檔案內容逐字相同）。
160. **`tracked` 是 carrier-validity metadata，不是 digest 的第四欄**（carrier：§11b.10 snapshot metadata ＋ §11b.4）：HeadViewSnapshot 對每個 path 保留 immutable `tracked: boolean`，由**建立 snapshot 當次已捕捉的 index observation** 導出，並以**唯一**公開 carrier `entry(path).tracked` 暴露。**正例（單變數；fixture 必須帶含 `/.ctide/` 的 tracked `.gitignore`）** —— 以 `.ctide/test-adapters-config.json` 為對象：先讓它是純 untracked（依 §11b.10 判定順序第 2 步，它**仍在** snapshot 內，`entry(path).tracked == false`），再以 **`git add -f`** 強制 stage —— bytes、mode、type **完全不變** → `entry(path).tracked` 由 `false` 變 `true`，而 **canonical map 與 `headViewDigest` 必須完全不變**，因為 map 仍**恰為** `path → { mode, type, contentDigest }` 三欄，且該 path 在**兩態下都已經在 map 內**。**若沒有第 2 步的例外**，untracked 態的該 path 根本不在 map 內，`git add -f` 會使它首次進入 map 並改變 `headViewDigest` —— 本正例即會失敗，這正是該例外存在的理由。**負例** —— 任何把 `tracked` 併入 canonical map 或 `headViewDigest` 公式的實作 → 上述正例會失敗，本 AC 必須抓出。**另驗**：同一份 bytes 的 config 在 tracked 與 untracked 兩態下 `headViewDigest` **相同**，但**只有 tracked 態**是合法 explicit-config carrier（AC92）—— 兩個判準各自獨立、互不代換；且 consumer **不得**在 snapshot 建立之後再做 live Git probe 取得 `tracked`。**與 AC134 的分工**：本 AC 要求 `headViewDigest` 對 tracked 變化**不敏感**；AC134 則要求 S1／S2 之間的 config carrier state 變化**必須**被獨立的 `configCarrierState` 比較擋下。兩者**必須同時成立** —— 為了通過 AC134 而把 `tracked` 加進 canonical map 或 digest，本 AC 必然失敗。
161. **每次 S3 都必須重新觀測 registry，且驗證與雜湊用同一次讀取**（carrier：§11b.9c consumer 協定第 1 步 ＋ `registryDigest` 定義）：每一次 consumer S3 verification invocation **必須重新讀取** shipped `test-adapters.json`；該 invocation 內**只讀一次**，§11b.3 schema validation 與 `registryDigest` preimage **必須使用同一次讀取的同一個 parsed root**；**不得**在「被驗證的 bytes」與「被雜湊的 bytes」之間再讀第二次；**不得**跨 S3 invocation 沿用 cached registry root、descriptor 或 digest。**關鍵負例（同一 process、同一 module instance）** —— 先完成一次成功的 S3，再對**同一份** shipped layout 做 schema-valid 修改，第二次 S3 若仍回報 fresh → 本 AC 必須抓出；這正是 cached root 的實際失敗面，**不得**以重新 import 或另啟 process 規避。**正例** —— 一般 adapter resolution loader **仍可**保留自己的 cache，本 AC **不撤回**它；但該 cache **不得**充當 S3 的 current-registry observation。**另驗 validate-before-hash**：schema-invalid 的 current root 必須先依 §11b.3 fail-closed，**不得**對未驗證內容取 digest；schema-valid 的修改則必須成為 `registryDigest` mismatch。
162. **Approval／implementation boundary（test-provenance v1.11）**（carrier：本文件 live status ＋ §11b.12 rollout boundary）：**v1.11 已於 2026-08-14 由使用者明確核准**（前置 draft 內容已由獨立 Codex 審查並 ACCEPT；**本次未執行 agent-duel panel，因此不稱為 panel 放行**）；前一 approved baseline 為 **test-provenance approved v1.10**，**current approved coupled set 現為 shared approved v1.14 ＋ intent-scan approved v1.10 ＋ test-provenance approved v1.11**，三者為同一生效集合，不得分開採用。**此 approval 只涵蓋 spec authority。**commit `711ec14` 的 S3 source-freshness component **不因本次 promotion 成為 ACCEPT** —— 它仍是 **provisional、未 ACCEPT** 的實作；canonical v2 reader（commit `4f44b6e`）的既有 acceptance **不因本次 promotion 撤回**。本次 promotion **不修改、不修正也不接受任何 implementation**，因此：**不代表**完整 Step 6、populated inventory producer、base／head one-to-one matcher、governance reverse closure 或 artifact emission／Step 5／6、ledger、arbiter wiring 已實作；**不得**接受 populated inventory；**不得**解除 `unsupported-populated-inventory`；**AC118／AC136／AC137／AC138 一律不得宣稱已滿足**；**Phase 2 不得宣稱 READY**；**AC138 及其附加限制不因本次 promotion 而弱化**（AC138 本輪 byte-identical）。
163. **Candidate-universe discriminator**（carrier：§11b.4a probe universe ＋ §11b.4b probe／candidate ＋ §11b.4c 三值輸出）：以**同一份 view**、單變數 fixtures 完整驗出：(i) **suffix 只決定 probe** —— `.mjs`／`.js` 進 probe universe，`.txt`／`.json` 不進；suffix 比對 **case-sensitive**（`.MJS` 不命中）；suffix 本身**不**產生任何 evidence；(ii) **只有 Program body 的 top-level static `ImportDeclaration` 是 evidence** —— dynamic `import()`、`require()`、`export … from`、`export * from`、comment 與普通 string literal **全部不是**；(iii) specifier 以 **decoded StringValue** 與 registry 的 `discovery.importSpecifiers` **exact 比對**（不 trim、不 normalize、不做 URL／path 解讀；`"node:test/reporters"` 不命中 `"node:test"`）；(iv) **零 evidence → `not-a-candidate`**，整輪繼續；(v) **syntax error／parser refusal → fail-closed**，具名 parser 理由，**不是** `not-a-candidate`；(vi) **explicit assignment 是 forced subject** —— 即使該 path 沒有任何 import evidence、甚至不是 `.mjs`／`.js`，仍必須進入指定 component；其 path missing／非 blob／symlink → fail-closed；(vii) **caller 提供的 `modulePaths`（或任何等價清單）沒有 candidate authority** —— 提供它**不得**使任何零 evidence 的 path 成為 candidate。另驗 base 與 head **各自**建立 probe／candidate universe，互不混用。
164. **`AdapterContentView` 的 base／head carrier 與 observable semantics**（carrier：§11b.10 AdapterContentView）：**base** 恰為 `baseTreeOid` 那棵 tree 的**全部 leaf entries**（先通過 shared v1.14 的 OID 長度、object 存在、**自身 type 恰為 tree**、**peel 不算**四項），**head** 恰為 **S1 已捕捉**的投影（不做第二次 enumerate／stat／Git probe／filesystem read）。**逐項驗**：(i) `entry(path)` 恰為 `{ mode, type }` 兩欄 —— **不含** `tracked`、**不含** `contentDigest`；(ii) `mode → type` 的 exact mapping（`100644`／`100755` → `"blob"`；`120000` → `"symlink"`）；`read()` 回傳 **raw bytes**，symlink 為 link target 的 raw bytes；(iii) `read()` 每次回傳 **copy** —— 修改回傳的 buffer **不得**影響下一次讀取；`paths()`、`entry()` 與 view 本身 **deep immutable**；(iv) **symlink 留在 view 中**且可被辨識，但**不得**作為 executable module／helper／manifest；(v) `160000` gitlink 或其他 leaf mode → **fail-closed**；(vi) caller 自製、duck-typed 或 spread／clone 的 **look-alike view 必須被拒絕**（branding）；(vii) **base 不套用** head 的 hard exclusions 與 `.gitignore` —— 以一個 committed 的 `.ctide/output/**` 或被 `.gitignore` 命中的 committed 檔案為 fixture，證明它**仍在** base view 內；(viii) base 的 bytes **只從 object database 讀**，不 checkout、不讀同名 live worktree 檔案（以 worktree 側同名檔內容不同的 fixture 證明）。**v1.12 新增 observable semantics（base 與 head 各驗一次，行為必須一致）**：(ix) `size` **恰為** view 內 entry 數，且 `size === paths().length`；(x) **lookup 一律只做 exact Unicode code-point key matching** —— 對一個 **canonical 但在 view 內沒有 exact key** 的 path：`has()` **恰為 `false`**（不是 throw、不是 `undefined`），而 `entry()` 與 `read()` **各自依 absent 規則 fail-closed** —— **不得**回 `null`／`undefined`／空 buffer，否則「不存在」與「存在但空」無法分辨。**必要的單變數 fixture（case 專用）** —— view 內**只有** `Dir/File.js`，查詢 `dir/file.js`：該查詢**形狀合法、因此是 canonical**（不得判為 non-canonical），`has("dir/file.js")` **必須為 `false`**，`entry()`／`read()` **必須依 absent 規則 fail-closed**；**不得**先 case-fold 找到 `Dir/File.js`，**也不得**改寫查詢後命中，**更不得**搜尋、偵測或修補 differently-cased near miss。以「若 case-fold 就會命中」證明它確實沒有被 fold；(xi) **canonical validity 只由 lexical grammar 判定，與 view membership 無關** —— 對**非** canonical repo-relative Git path（含 `\`、前導 `/`、drive prefix（`C:/…`）、`.` 或 `..` segment、空 segment（`a//b`）、空字串）—— `has()`／`entry()`／`read()` **三者各自 fail-closed**，且**不得** normalize、**不得** case-fold、**不得**以 OS path 規則修補後再查（以「修補後本會命中」的單變數 fixture 證明它確實沒有被修補）。**明確界線**：**大小寫不參與本項判定** —— 任何大小寫組合只要形狀合法就是 canonical，其命中與否**只**由 (x) 的 exact key matching 決定；把 wrong-case 歸入 non-canonical 是錯的，因為那需要先 case-fold 才知道有沒有近似命中。
165. **`DiscoveryAnalysisPreimage` 的 exact shape、ordering 與綁定**（carrier：§11b.10b）：**逐項驗**：(i) **request exact key set 恰為 `{ repoRoot, baseTreeOid }`** —— registry／parser／Git executable／environment／filesystem adapter／config／`modulePaths`／component path／capture hook／prebuilt view 逐一被拒；(ii) root exact key set 恰為 `{ baseTreeOid, headViewDigest, registryDigest, baseModules, headModules }`；module 恰為 `{ path, adapterId, framework, implementationIdentity, declarations }`；declaration 恰為 `{ structuralId, tag, bodyDigest }`；`implementationIdentity` 恰為 `{ implementationId, parserId, parserVersion }`；(iii) **同一次 fresh-read 的 registry root** 同時供 discovery、identity projection 與 `registryDigest` 使用（以「兩次 invocation 之間修改 shipped registry」的 fixture 證明第二次看見新 root）；(iv) **base 與 head 各自求值（單變數，且可由 §6 公式推出）** —— 取一個 candidate declaration，使其 `effectiveOracleDeps` closure 內**恰有一個**合法的 local-assertion-helper，該 helper 的 **canonical bytes 在 base 與 head 不同**、其餘（declaration 本體、其他 deps、path、`structuralId`）完全相同 → 依 §6 公式 `depDigest` 不同 ⇒ `effectiveOracleDigest` 不同 ⇒ 兩側 `bodyDigest` **必須不同**。**明確界線**：一般**不在**該 declaration `effectiveOracleDeps` closure 內的 SUT helper，其內容改變**不承擔**本項的判別責任 —— 它不進閉包就不進 digest，**不得**把「任意 helper 內容不同就必然改變 `bodyDigest`」當成本 AC 的斷言；(v) **canonical ordering** —— `baseModules`／`headModules` 依 `(path, adapterId)` code point tuple **嚴格遞增**，`declarations` 依 `structuralId` **嚴格遞增**；逆序或 duplicate（同 path／module，或同 module 內同 `structuralId`）→ **回傳前 fail-closed**；(vi) 回傳值**深度 frozen**；(vii) **跨 view adapter 分歧的 invariant（defensive／future）** —— 若同一 path 在 base／head 都是 candidate 而 `adapterId` 不同，必須**回傳前 fail-closed**（AC93）；**在 v1 closed registry 下此情境無法由 conforming public input 達成**（只有一個合法 implementation／framework 組合，且兩側共用同一份 fresh registry root），因此本項**只要求該 invariant 存在且可由 code 檢視**，**不要求**、也**不得宣稱**提供 v1 end-to-end executable fixture，**更不得**為此新增第二個 adapter、registry override、caller injection 或 test-only public seam；只有一側是 candidate 時**不**套用（此邊界對照可、且必須實跑）；(viii) head-view-unstable 或任何錯誤 → **不回傳 partial result、no-write**（以 evaluate 內改動 worktree 的 fixture 證明）；(ix) 回傳值**不含** parser AST、source bytes、canonical declaration bytes、`evidenceLevel`、component path 或任何自由格式 metadata；(x) candidate module 即使 `declarations` 為空**仍保留 module record**。
166. **Approval／implementation boundary（test-provenance v1.12）**（carrier：本文件 live status ＋ §11b.12 rollout boundary）：**v1.12 已於 2026-08-14 由使用者明確核准**（前置 draft 內容已由獨立 Codex 審查並 ACCEPT；**本次未執行 agent-duel panel，因此不稱為 panel 放行**）；前一 approved baseline 為 **test-provenance approved v1.11**，**current approved coupled set 現為 shared approved v1.14 ＋ intent-scan approved v1.10 ＋ test-provenance approved v1.12**，三者為同一生效集合，不得分開採用。**此 approval 只涵蓋 spec authority。**§11b.4a–4d 的 probe／candidate universe、§11b.10 的 `AdapterContentView` 與 §11b.10b 的 `DiscoveryAnalysisPreimage` **不因本次 promotion 成為已實作或 ACCEPT**；它們仍須另行取得 component implementation 授權、完成實作並通過獨立審查。本次 promotion **不修改、不修正也不接受任何 implementation**。**仍未完成**：populated inventory producer、base／head one-to-one matcher、governance reverse closure、artifact emission，以及 Step 5／6、ledger、arbiter wiring。因此：**不得**接受 populated inventory；**不得**解除 `unsupported-populated-inventory`；**AC118／AC136／AC137／AC138 一律不得宣稱已滿足**；**Phase 2 不得宣稱 READY**；**AC138 及其附加限制不因本次 promotion 而弱化**（AC138 本輪 byte-identical）。
167. **Residual-side exclusivity 的 executable matrix**（carrier：§6 rule 3 ＋ §2 結構重整段 ＋ §11b.8）：本 AC 的每一格都必須以真實可執行的 case 覆蓋，且必須抓得出 **commit `898f81c` 的 provisional matcher**（它對第 3–8 格輸出 added＋deleted，因而不符）。**單側 residual（正例）**：(1) 只有 `Uhead` → 每筆 added；(2) 只有 `Ubase` → 每筆 deleted。**兩側 residual（一律 fail-closed，且每格只改動一個變數）**：(3) 同 path、`tag` 與 `bodyDigest` 完全相同、`s:` structuralId 不同 → fail-closed；(4) 不同 path、`tag` 與 `bodyDigest` 完全相同、structuralId 不同 → fail-closed；(5) 同 path 且 `tag` 與 `bodyDigest` **也**改變、structuralId 不同 → **仍** fail-closed（證明結果不因 tag／body 是否相同而改變）；(6) 恰一筆 base residual ＋ 恰一筆 head residual，**即使看起來就是 genuine delete ＋ add** → fail-closed（證明不因 1:1 就猜成同一 declaration）；(7) 多筆 base residual ＋ 多筆 head residual → fail-closed；(8) 已有成立的 exact／moved pair，另**同時**留下兩側 residual → **整輪** fail-closed，**且不得回傳那些已成立的 pair**。**`@tid` 邊界**：(9) 同一 `tid:` 在 base／head 各一次且 path 相同 → 合法 exact pair；(10) 同一 `tid:` 在 base／head 各一次且 path 不同 → 合法 moved pair；(11) base 為 `s:…`、**只在 head 新增** `tid:…`（path、`tag`、`bodyDigest` 皆不變）→ **fail-closed**，**不得** adoption、**不得**因 path／`tag`／`bodyDigest`／宣告名相同而自動建立 `s:` → `tid:` alias；(12) base 與 head **兩側都已**帶同一 `tid:`，同時 container 改名 → `structuralId` 兩側皆為該 `tid:`、不受改名影響，配對成功。**拆分是可達路徑（必須實跑，不得只以散文宣稱）**：(13) 一次真正的 delete ＋ add 拆成兩個以不同 base 為界的 run —— 第一輪只剩 `Ubase` → deleted；以其結果為新 base 重跑，第二輪只剩 `Uhead` → added。**通則**：(14) 上列任一 fail-closed 都**不得** emit partial inventory 或 partial pairing result。本 AC **不**新增 `modified`／`retagged` 分類規則，**不**新增 alias carrier、migration record 或 persisted 欄位。
168. **Approval／implementation boundary（test-provenance v1.13）**（carrier：本文件 live status ＋ §11b.12 rollout boundary）：**v1.13 已於 2026-08-15 由使用者明確核准**（前置 draft 內容已由獨立 Codex 審查並 ACCEPT；**本次未執行 agent-duel panel，因此不稱為 panel 放行**）；前一 approved baseline 為 **test-provenance approved v1.12**，**current approved coupled set 現為 shared approved v1.14 ＋ intent-scan approved v1.10 ＋ test-provenance approved v1.13**，三者為同一生效集合，不得分開採用。**此 approval 只涵蓋 spec authority。**本次 promotion **不修改、不修正也不接受任何 implementation**：commit `898f81c` 的 base／head declaration matcher **不因本次 promotion 成為 ACCEPT，也不因本次 promotion 被修復**，仍是 **provisional、known nonconforming、未 ACCEPT** 的實作（residual 兩側同時存在時它輸出 added＋deleted，不符 §6 rule 3 的 residual-side exclusivity）；**matcher remediation 尚未實作**，須另行取得 component implementation 授權、完成實作並通過獨立審查。`modified`／`retagged` 的分類問題**仍未閉合，本次 promotion 也未順手決定**。**仍未完成**：populated inventory producer、governance reverse closure、artifact emission，以及 Step 5／6、ledger、arbiter wiring。因此：**不得**接受 populated inventory；**不得**解除 `unsupported-populated-inventory`；**AC118／AC136／AC137／AC138 一律不得宣稱已滿足**；**Phase 2 不得宣稱 READY**；**AC138 及其附加限制不因本次 promotion 而弱化**（AC138 本輪 byte-identical，AC166 與 AC167 亦 byte-identical）。
169. **Paired-declaration classification 的 executable matrix**（carrier：§6 Paired-declaration classification ＋ §6 schema 不變量）：本 AC 定義的是**未來 producer 與 canonical reader 的 executable contract**；**本輪 spec-only，不代表下列任何一格已有測試、已實作或已通過**。**Producer 側 —— evidence shape（三類，**不是**每格都只改動一個變數）**：**(a) anchor／control（相對「same-path 且 body、tag、governance 全部不變」的基線，恰只啟用一個訊號，或一個都不啟用）**：(1)、(2)、(4)、(5)、(7)、(10)、(14)、(15) —— 其中 (4) 是零訊號的 control，(5) 的單一變數是 effective-oracle dependency 的 bytes（`bodyDigest` 改變是它的**後果**，不是第二個輸入）。**(b) pairwise precedence（刻意同時啟用兩個訊號，各以一個 anchor 為 control，單變數差只存在於該 anchor 與本格之間）**：(3) 以 (2) tag-only 為 control，再加入 body change；(6) 以 (2) tag-only 為 control，再加入 oracle-induced body change；(8) 以 (7) governance-only 為 control，再加入 body change；(9) 以 (7) governance-only 為 control，再加入 tag change；(11) 以 (10) moved 為 control，再加入 body change；(12) 以 (10) moved 為 control，再加入 tag change。**(c) compound stress（刻意 all-on，**明確不是** single-variable case）**：(13) 同時啟用 moved、body change、tag change 與 governance hit，用途是驗證 `moved` 在四個訊號全開時**仍然優先**，且**仍然只產生一筆** entry。**不得**把 (b)、(c) 的 multi-signal case 描述成單變數 case。以下為各格的輸入與預期結果：(1) same-path、body 不同、tag 相同 → `modified`；(2) same-path、body 相同、tag 不同 → `retagged`；(3) same-path、body 與 tag **都**不同 → `modified`（tag 差異**不得**把它變成 retagged）；(4) same-path、body 與 tag 皆相同且無 governance hit → **自 entries 省略**（**不是** modified，**不得** emit placeholder）；(5) same-path、**只有** effective-oracle dependency 的 bytes 改變 → `effectiveOracleDigest` 不同 ⇒ `bodyDigest` 不同 ⇒ `modified`；(6) same-path、oracle change ＋ tag change → `modified`；(7) same-path、body 與 tag 皆相同、**只有** governance hit → `governance-affected`；(8) same-path、body change ＋ governance hit → `modified`，且**只有一筆** entry；(9) same-path、tag-only change ＋ governance hit → `retagged`，且**只有一筆** entry；(10) moved、body 與 tag 皆相同 → `moved`；(11) moved ＋ body change → `moved`；(12) moved ＋ tag change → `moved`；(13) moved ＋ body change ＋ tag change ＋ governance hit → `moved`，且**只有一筆** entry；(14) head-only residual → `added`；(15) base-only residual → `deleted`。**Reader 側（只憑一筆 persisted entry 即可判定）**：(16) `status == modified` 而兩個 body digest **相等** → **拒絕**；(17) `status == retagged` 而兩個 body digest **不等** → **拒絕**；(18) `status == retagged` 而 `canonicalJson(tagBefore) == canonicalJson(tagAfter)` → **拒絕**；(19) `status == modified` ＋ body digest 不等 ＋ tag 也改變 → **接受**（modified 允許伴隨 tag 變動）；(20) `status == retagged` ＋ body digest 相等 ＋ tag 改變 → **接受**。**通則**：(21) 任一 logical test **不得**產生重複 entry，也**不得**帶第二個 status；governance reverse closure **不得**為已由 added／deleted／moved／modified／retagged 收錄的 test 再新增一筆。**既有結果不被推翻**：AC27（move ＋ retag 仍是單一 `moved`）、AC33（四類間接 oracle 變更仍使測試 `modified`）、AC109（**只**改 SUT **不得**使測試 `modified`；**只**改 assertion-bearing helper **必須**使其 `modified`）、AC110（assertion-bearing production callable 的保守分類）與 AC147（contributor 判準）**一律原樣有效**，本 AC 不弱化其中任何一條。本 AC **不**新增 persisted field、alias、migration record、第二個 digest 或自由格式 metadata。
170. **Draft／implementation boundary（test-provenance v1.14）**（carrier：本文件 live status ＋ §11b.12 rollout boundary）：**v1.14 仍是 draft、未審核、未 promotion** —— 2026-08-16 由使用者明確核准起草，**尚未經 panel 放行、未經使用者核准為 approved**；**本輪未執行 agent-duel panel，因此不得稱為 panel 放行**。**current approved baseline 仍為 test-provenance approved v1.13**，**current approved coupled set 仍為 shared approved v1.14 ＋ intent-scan approved v1.10 ＋ test-provenance approved v1.13**，未撤回、未取代；v1.14 只有在後續另行 promotion 後才會成為生效版本。**本輪只建立 spec authority，未修改任何 implementation。****populated inventory producer 尚未實作**；**canonical v2 reader 尚未實作 v1.14 新增的兩條 observable invariant**（`modified` ⇒ 兩個 body digest 不同；`retagged` ⇒ 兩個 body digest 相同且 tag 不同），其既有 acceptance **不因本 draft 撤回**，但若要宣稱符合日後 promoted 的 v1.14，**仍須另行 remediation 並通過獨立審查**。既有的 base／head one-to-one matcher、`AdapterContentView`、`DiscoveryAnalysisPreimage` 與 S3 source-freshness component 的 acceptance **一律不撤回**。**仍未完成**：populated inventory producer、governance reverse closure、artifact emission，以及 Step 5／6、ledger、arbiter wiring。因此：**不得**接受 populated inventory；**不得**解除 `unsupported-populated-inventory`；**AC118／AC136／AC137／AC138 一律不得宣稱已滿足**；**Phase 2 不得宣稱 READY**；**AC1–AC168 全部 byte-identical**（含 AC27、AC33、AC36、AC104、AC109、AC110、AC138、AC147、AC155、AC165、AC166、AC167、AC168）。

## 14. 邊界與非目標

- 不動 intent scan、DP 分流、治理 checkpoint。**store script 命令面例外**：本 spec 需要 intent-scan v1.7 的 `commit-test-provenance-batch`（0..N ResolutionGroup、`successorClauseDraft`、`resolutionCarrierUpdates[]`）與 `successor=null` retire（v0.5 的「不改命令面」宣稱已撤回）。
- **不設測試數量上限** —— demo1 實測顯示數量不是正確的打擊目標（69 vs 258，兩組 adjusted mutation 皆 10/10）；治的是來源，不是數量。
- 不管 gate scope 外的既有測試（brownfield 邊界，範圍定義見 shared model §9）。
- 語義判斷不宣稱機械保證（§10）；本 spec 保證的是它不被跳過、結果為 typed、機械後果被強制執行。
