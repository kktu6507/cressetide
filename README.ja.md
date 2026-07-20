<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/logo_mono.png">
    <img src=".github/assets/logo_color.png" alt="Cressetide のロゴ" width="240">
  </picture>
</p>

# ctide — Cressetide（Claude Code プラグイン）

[![Validate](https://github.com/kktu6507/cressetide/actions/workflows/validate.yml/badge.svg)](https://github.com/kktu6507/cressetide/actions/workflows/validate.yml)

[English](README.md) · [繁體中文](README.zh-TW.md) · **日本語**

**ctide は Claude Code を慎重なリリースエンジニアのように振る舞わせます：** まず計画し、承認を得てから変更し、証拠で検証し、最後に `READY` / `FIX REQUIRED` / `NOT READY` を判定します。

ctide は、開発から本番までを2つのフローでカバーします。**dev flow** は plan をゲートにしたコードレビュー & リリース可否判定ワークフローです：plan → 承認 → 実装 → 検証 → リスクに応じたレビュー → verdict。**incident flow** はそのフローを反転させ、本番の緊急事態に使うものです：まず被害を止め（mitigate first）、次に診断し、正式な修正は dev flow に戻して行い、最後に postmortem で締めます。

ctide は bug scanner でも、linter でも、static analyzer でも、CI の代替でも、zero-bug の保証でもありません。

その役割は、AI が行った変更を追跡可能にすることです：明示された意図、acceptance criteria、最小限の安全な実装、実際の検証証拠、リスクに応じたレビュー、そして arbiter の verdict。

```text
Dev flow       タスク -> 要件理解 -> Plan（まだコード変更なし）-> あなたが plan + acceptance criteria を承認
                     -> 最小限の安全な変更 -> build / test / lint / browser evidence
                     -> リスクに応じた reviewer -> Gatekeeper verdict
                            READY / FIX REQUIRED / NOT READY -> 必要なら repair loop へ

Incident flow  アラート -> Triage -> 証拠保全 -> まず止血（可逆な操作を、decision card 1枚ずつ）
                      -> 診断 -> red repro -> 上の dev flow 経由で修正（--lite）
                      -> 本番への再投入 + 観察期間 -> postmortem

学習ループ      run verdict -> ledger 記録 -> 次の planning が照合：escaped / survived？
               incident postmortem -> FAILURE_MEMORY -> 次の dev flow の planning がそれを読む
```

## 同梱されているもの

<p align="center">
  <img src=".github/assets/flow_overview.svg" alt="Cressetide のコンポーネントフロー：vigil の run には plan-implement-verify とリスクに応じた subagent パネルが含まれ、salvage、map、committed なメモリファイル、ローカルの run ledger がそこに供給します" width="100%">
</p>

- **2つのフロー**：dev（[`vigil`](#開発フローvigil)）と incident（[`salvage`](#インシデントフローsalvage)）。インシデントの正式な修正は、「インシデントの reproduction がグリーンになる」を主要な acceptance criterion として `--lite` run で dev flow に戻されます。
- **4つの skill**：`vigil` と `salvage` は自動で起動します（小さな修正を超える開発作業で／インシデントらしい言葉づかいで）；[`map`](#ops-マップmap) と [`doctor`](#ヘルスチェックdoctor) は手動で開始します（`/ctide:map`、`/ctide:doctor`）。
- **[11個の subagent](#開発フローvigil)**：navigator、implementer、リスクに応じて選ばれる7人の reviewer、cartographer、そして readiness を判定する arbiter。
- **[6つの hook](#hooks-と安全性モデル)**：local-only で依存関係ゼロの Node guardrails。plan gate、破壊的コマンドの guard、contract guard、failure-memory の注入、compaction リマインダー、delivery-claim チェックをカバーします。
- **[学習ループ](#学習ループ)**：すべての run は ledger への記録で終わり、次の run は過去の verdict が実際に持ちこたえたかの確認から始まります。

### プロジェクトレイアウト

ctide があなたのプロジェクト内に保持するものは、すべて1つのルートフォルダの下にまとまります：

```text
.ctide/
  memory/     # FAILURE_MEMORY.md + EXPERIENCE.md — 次の plan が読む教訓 + 検証済みパターン（committed）
  design/     # design.md — UI の design contract（committed）
  map/        # SYSTEM_MAP.md — リポジトリと運用準備の Map（committed）
  incidents/  # INCIDENT-<date>-<slug>.md journals — 監査証跡（committed）
  ledger/     # runs.jsonl — append-only の実行履歴（実行をまたいで永続、自前の gitignore 付き）
  output/     # 実行ごとのスクラッチ：contract.md、evidence、review diffs（決して commit しない、自前の gitignore 付き）
```

旧レイアウト（`ai/FAILURE_MEMORY.md`、リポジトリ直下の `design.md`、`.ctide/legacy-output/`）の移行は一度だけ。workflow 自身が移動し、何を動かしたかはその実行の中で説明されます。

## 30秒で理解する

ctide がすることは3つです：

| タイミング | ctide が加えるもの |
|---|---|
| **コーディング前** | Claude が要件を re-state し、plan と acceptance criteria にまとめ、あなたの承認を待ちます。 |
| **コーディング中** | `implementer` は最小限の安全な変更のみを行い、自己承認はしません。 |
| **納品前** | リスクに応じて選ばれた reviewer があなたの意図に照らして変更を検査し、最後に `arbiter` が `READY` / `FIX REQUIRED` / `NOT READY` を判定します。 |

本番インシデントの最中は、`salvage` が同じ規律を火中でも守らせます：

| タイミング | ctide が加えるもの |
|---|---|
| **最初の数分** | 証拠スナップショット（約1分、スキップ不可）、その後に可逆な止血策を decision card 1枚ずつ；あなたがコードを読む必要はありません。 |
| **安定した後** | fault domain で診断し、どんな修正の前にも red→green の reproduction ゲートを通します。 |
| **正式な修正** | 上の dev flow に渡されます；incident skill が本番に hot-patch を当てることはありません。 |
| **クローズ後** | postmortem が failure memory に供給され、次の dev flow の plan は最初からそれを知っています。 |

**ctide を使う場面**：「完了」が「リリース可能」を意味しなければならないとき。`main` へのマージ、ユーザーの目に触れる変更のリリース、auth、data、API/schema contract、migration、production behavior、高リスクな UI flow に触れるとき。

**省いてよい場面**：typo や純粋なフォーマットのようなリスクゼロの小変更にはわざわざ使わない。linter や formatter のような安くて確実なツールが先です。

ctide は CI の代替でも、linter や static analyzer でも、zero-bug の保証でも**ありません**。全ファイルを一行ずつスキャンすることもしません。tests、linters、static analysis、dependency scanners はそのまま使い、high-risk な release には human review も入れてください。機械的な問題はそれらの仕事です。ctide が見るのは「この AI の変更は、頼んだことを本当に満たしているか、ship できるか」です。

> ライブデモ：[ctide-public-demo](https://github.com/kktu6507/ctide-public-demo) に、`/ctide:vigil` を最初から最後まで記録した一例があります。

## クイックスタート

前提条件：**Claude Code** と、`PATH` 上に `node` があること。hooks は Node スクリプトなので、Node がない場合は何もしません（エラーも出しません）。

```text
# プロジェクトディレクトリで、Claude Code 内から：
/plugin marketplace add kktu6507/plugins
/plugin install ctide@kktu
# ctide は初期状態では無効です - /plugin -> Installed -> ctide を有効化
#   または：claude plugin enable ctide@kktu
/reload-plugins

# タスクを渡す：
/ctide:vigil ログインフローを修正し、期限切れの access token を、失敗した request をリトライする前に一度だけ refresh するようにして。

# 必要になる前に：インシデント用の ops マップを作る（ログの場所、rollback 経路、kill switch）
/ctide:map

# インシデントの最中は、普通の言葉で十分です——skill はインシデントの言葉づかいで自動的に起動します：
本番が落ちてる。直近の deploy 以降、checkout が 500 を返し続けてる
```

> ctide は初めてですか？[最初の実行を最初から最後まで](docs/tutorial-first-run.md)たどってみましょう。

- **インストールしただけでは有効になりません。** 有効化するまで、ctide の hooks と skills は何もしません。
- **Marketplace 名は `kktu` です。** インストール id は `ctide@kktu`。
- **更新：** `/plugin marketplace update kktu`（marketplace のカタログを更新）→ `/plugin update ctide@kktu` → `/reload-plugins`。
- **ヘルスチェック：** gate が一度も block しない、hooks が無反応、あるいは Node が入っていない可能性があるときは [`/ctide:doctor`](#ヘルスチェックdoctor) を実行してください。

## 開発フロー（vigil）

1回の run はこれらのフェーズを順に進みます：

| フェーズ | 何が起きるか |
|---|---|
| **Understand** | 要件を re-state する；曖昧さが behavior、contracts、destructive operations、security、UX を左右する場合のみ質問する。 |
| **Plan** | 読み取り専用のまま、アプローチを repo の実態に照らして確かめ、acceptance criteria をまとめる。 |
| **Approval** | あなたが plan と criteria を承認するまで、コードは変更しない。 |
| **Implement** | `implementer` が最小限の安全な変更を適用し、今回の実行分の task contract（`.ctide/output/contract.md`）を書き出す。 |
| **Verify** | 必要に応じて build / test / lint / typecheck / browser evidence を実行する；command の exit status が権威となる。 |
| **Review** | リスクに関係する reviewer だけが実行され、thread 全体の履歴ではなく、焦点を絞った Review Packet を使う。 |
| **Gatekeeper** | findings を集約し、impact に応じて再評価し、acceptance criteria を1つずつ確認し、`READY` / `FIX REQUIRED` / `NOT READY` を判定する。 |

Verdicts は release-readiness の判断であり、絶対的な真実ではありません。詳しくは [`docs/how-to-read-verdicts.md`](docs/how-to-read-verdicts.md)（英語）を参照してください。

**レビューパネル。** reviewer を選ぶのはあなたではありません。ctide が**リスク**に応じてパネルを組みます：typo なら誰も動かず、認証まわりの変更なら security reviewer が加わります。全メンバーは以下の通りです：

| Agent | 役割 | いつ加わるか | モデル |
|---|---|---|---|
| `navigator` | 実際のコードで plan が成り立つかを確かめ、方針とパネルを草案し、`design.md` を検出する（読み取り専用；plan 承認の材料であり、承認そのものを代替しない） | 高リスク／正確性が重要な場面の planning | inherit |
| `implementer` | 最小限の安全な変更；自己承認は絶対にしない | plan 承認後 | inherit |
| `intent-reviewer` | 要件／ビジネスルール／contract との整合性 | core（非瑣末） | inherit |
| `test-reviewer` | テスト漏れ、弱い検証、エッジケース、regression | core；低／中リスクではエビデンス代替可 | inherit |
| `code-reviewer` | ローカルな品質、保守性、フレームワークの使い方、効率性 | 非瑣末なコード変更 | inherit |
| `security-reviewer` | auth/authz、入力処理、secret、trust boundary | セキュリティに関わるリスク | **opus** |
| `architecture-reviewer` | 層構造、境界、依存方向、配置 | 構造上の懸念 | inherit |
| `operability-reviewer` | observability、retry/timeout、deploy、rollback | runtime／本番環境への影響 | inherit |
| `ui-ux-reviewer` | usability、interaction、states、accessibility；`design.md` が存在する場合はそれとの整合性も | UI への影響 | inherit |
| `cartographer` | repo-grounded Map を作成・更新・検証する | Map の作成／更新／検証時 | inherit |
| `arbiter` | 集約し、impact で再評価し、readiness を判定する | reviewer 終了後 | **opus** |

- **reviewer は editor 系ツールを持ちません**：検査用に `Read` / `Grep` / `Glob` / `Bash` のみ。review-only という振る舞いは政策とコンテキスト分離によって強制されているのであり、厳密な read-only の権限境界ではありません（詳細は [`ARCHITECTURE.md`](ARCHITECTURE.md)）。修正案を提案するのは reviewer で、実際に適用するのは `implementer` です。
- **正確性が重要な経路には、独立した視点を2つ以上割り当てます**：parsing、数値／エンコーディング／overflow、並行処理、セキュリティ、データ整合性。パネル全員が同じ盲点を共有しないためです。

**良いタスクの書き方。** ctide はあなたが明示した意図に照らしてレビューするため、最良のタスクには要件、acceptance criteria、変更禁止範囲、期待する検証、リスク領域が書かれています。テンプレートと bad / better / best の例：[`docs/task-writing-guide.md`](docs/task-writing-guide.md)（英語）。

**実行単位のフラグ。** `--lite`（最小パネル）、`--deep`（adversarial verification）、`--report full`（詳細レポート）；詳細は「設定リファレンス」の節へ。

## インシデントフロー（salvage）

本番が壊れているのに、キーボードの前の人はそのコードを書いていない——AI が書いたシステムでは、それが普通のケースです。`salvage` は dev flow の反転です：**まず止血、次に診断、正式な修正は最後。**

インシデントの言葉づかい（「production is down」「ユーザー全員がブロックされている」）で自動的に起動し、`/ctide:salvage` で手動でも起動できます。人とのやり取りはすべて decision card で行われ、インシデント対応であなたがコードを読む必要は決してありません。

| ステージ | 何が起きるか |
|---|---|
| **1 · Triage** | 証拠駆動で、質問攻めにはしない：health/error チェックを実行して、深刻度（SEV1–3）、影響範囲、データが現在進行形で壊れていないか、そして「これは侵入では？」という明示的な確認を1つ行う。 |
| **2 · 証拠保全** | 何かが再起動される*前に*、約1分のスナップショット（ログ、タイムスタンプ、稼働中のバージョン）。スキップ不可、どれほど切迫していても。 |
| **3 · Mitigate（ループ）** | 可逆で、新しいコードを書かない操作：rollback（migration 互換性の事前チェック後）、feature flag オフ、degrade、スケールアップ、メンテナンスモード。1つずつ、それぞれ検証してから次へ。「レビューされていないコードを本番に hot-patch する」ことは、古典的な二次災害として名指しされ、拒否されます。 |
| **4 · 診断** | まず fault domain を分類：code、config／環境、インフラ、外部依存、data。reproduction に進むのは code と data のみ；それ以外は直接の是正措置と、事前に宣言された fixed-check で対応。 |
| **5 · Reproduce** | どんな修正よりも先に red reproduction。失敗する出力を journal に記録します。一度も赤くならなかったチェックは何も証明しません。 |
| **6 · Fix** | dev flow に渡します：「インシデントの repro がグリーンになる」を主要な acceptance criterion とする `vigil --lite` の run。 |
| **— データ修復** *（破損が起きた場合）* | コードの修正は新たな破損を止めるだけで、既に生じた損害は直せません。破損ウィンドウ → 影響レコード数 → 修復スクリプトを抽出したコピー上で red→green で証明 → 人間の承認を得てから本番に適用。 |
| **— 本番への再投入** | 通常の deploy 経路でデプロイし、宣言済みの fixed-check を検証し、観察期間を置いてから、止血策を1つずつ解除します。 |
| **7 · クローズ + postmortem** | クローズのチェックリスト（止血策の全解除、データ修復の完了、抽出データの削除、journal のクローズ）に加え、短く、誰も責めない postmortem。[学習ループ](#学習ループ)に供給される gate-gap 分析を含みます。 |

- **Decision cards**：1枚ずつ。載っているのは推奨案、コスト／トレードオフ、可逆性、そして承認したら正確に何が実行されるか。破壊的または本番に影響する操作は必ず card で止まり、以前に承認済みの plan に紛れ込ませることはありません；`destructive-guard.js` hook がさらに確認を挟むことがありますが、それは想定どおりの動作で、決して迂回しません。
- **インシデント journal**：すべてのステージが `.ctide/incidents/INCIDENT-<date>-<slug>.md` に追記します。committed な監査証跡（タイムライン、各操作と承認者、証拠、red→green の記録）です。書く前にサニタイズ：journal に入る前に PII と secrets はマスクされます。
- **本番データの安全ゲート**：reproduction に実データが必要なときは、抽出を最小限にとどめ（証拠が指すレコードだけ、決して全 dump しない）、データが AI のコンテキストに入る*前*にマスクし、ポリシーが本番データを禁じる場合は synthetic data で代替します；抽出データは一時的なもので、決して commit せず、クローズ時に削除します。

やらないことを一行で：paging/on-call なし、status-page 自動化なし、SLO スイートなし、完全な RBAC なし、DFIR 級のフォレンジックなし（分類し、封じ込め、専門家を推奨するまで）、マルチリポジトリのインシデント指揮なし。各ステージの完全な契約は [`cressetide/skills/salvage/references/`](cressetide/skills/salvage/references/) にあります：`wartime.md`、`reproduction-and-repair.md`、`reentry-and-closure.md`。

## Ops マップ（map）

**必要になる前に準備する。** `/ctide:map` は `.ctide/map/SYSTEM_MAP.md` を作ります：戦時を30分ではなく30秒から始められるようにする平時マップです。中身は、agent-runnable か human-only かを明記したアクセス一覧、schema-migration 互換性の情報付き rollback 手順、feature flags、バックアップ、observability。

各エントリには信頼マーカー（`verified: <date>`、`dry-run-verified: <date>` または `UNVERIFIED`）が付きます；未検証の rollback コマンドはそれに依存する decision card 上で明示され、黙って信頼されることはありません。

Map は運用準備のギャップを正直に報告します（「バックアップが見つからない。今日 restore は不可能」）。

Map は operational-preparation の契約を担います：[`operational-readiness.md`](cressetide/skills/map/references/operational-readiness.md)（英語）。

## ヘルスチェック（doctor）

`/ctide:doctor` は hooks と環境のローカルで読み取り専用のセルフチェック（plugin の同一性、Node の有無、hook がつながっているか）を行い、何も送信しません（telemetry なし）。gate が一度も block しない、hooks が無反応、あるいは Node が入っていない可能性があるときに実行してください。

## 学習ループ

run と run のあいだで、ctide は学んだことを持ち越します——負けも勝ちも：

- **すべての run は ledger への記録で終わります。** verdict が確定した後、event-fact の1行が `.ctide/ledger/runs.jsonl` に追記されます：タスク、変更されたファイル（`git diff` から算出され、agent の申告は決して信用しない）、verdict、検証ステータス、パネル、repair 回数、findings、計画された scope と観測された drift。事実のみ：ledger がスコア、率、パーセンテージを保存することはありません。
- **次の run は、過去の verdict が持ちこたえたかの確認から始まります。** planning は、記録された各 run のファイルがその後の commit で手直しされていないかをスキャンし、その run を `escaped` / `survived` / `superseded` / `building-upon` として処置します。判断がつかない重なりは「needs human review」として人に渡し、黙って合格にはしません。14日以内に `escaped` のクローズが3件になると、最終レポートが retro を提案します（[`docs/advanced/retro-practice.md`](docs/advanced/retro-practice.md)（英語））。この集計はあなたに知らせるためのもので、verdict の確定後にだけ現れ、現在の run の scope、パネル、verdict を調整することは決してありません。
- **教訓は、git 管理される2つのメモリファイルが記憶します。** `.ctide/memory/FAILURE_MEMORY.md` は prevention rule（インシデントの postmortem と escaped な欠陥から）を保持し、SessionStart hook が untrusted な digest を注入して次の plan が読みます。`.ctide/memory/EXPERIENCE.md` は検証済みのポジティブなパターンを保持します（`candidate → validated → standard`；`standard` にはリンクされた実行可能アセットが必須で、文章だけでは決して昇格しません）。

完全な契約：[`run-ledger.md`](cressetide/skills/vigil/references/run-ledger.md)（英語）· [`experience-memory.md`](cressetide/skills/vigil/references/experience-memory.md)（英語）。

## Hooks と安全性モデル

plugin が有効な間は、依存関係ゼロの Node hooks が6つ、すべての session で実行されます。これらは local-only、fail-open で、Node の built-in（`fs`、`os`、`path`、`crypto`）のみを使用します。

| Hook スクリプト | 発火イベント | 用途 |
|---|---|---|
| `plan-gate.js` | `PreToolUse` | plan mode 中に edit tools と明らかな Bash/PowerShell write を拒否する。 |
| `destructive-guard.js` | `PreToolUse` | `rm -rf`、`git reset --hard`、`git push --force`、PowerShell の `Remove-Item -Recurse` など、狭く絞った復元不能な destructive command の前に確認を挟む。 |
| `contract-guard.js` | `PreToolUse` | 契約が途中で骨抜きにされるのを見張ります：編集が acceptance criterion を削除・書き換えする、`mustNotChange` や scope の項目を落とす、risk を下げる（契約は `.ctide/output/contract.md`、旧レイアウトの `.ctide/legacy-output/` も対象）、`design.md` の section をまるごと消す場合は、先に確認します；`.claude/settings*.json` への編集が ctide の guard flag を有効から無効へ切り替える場合も同様です（新しい settings ファイルを作って切り替えるケースも検知します）。 |
| `load-failure-memory.js` | `SessionStart` | プロジェクトの `.ctide/memory/FAILURE_MEMORY.md`（旧レイアウトの `ai/FAILURE_MEMORY.md` は読み取り専用のフォールバック）、なければグローバルの `~/.claude/FAILURE_MEMORY.md` を読み込み、nonce で囲んだ untrusted な digest を注入する。 |
| `compact-fidelity.js` | `SessionStart` · `compact` | context compaction の直後に、簡潔な workflow-continuity のリマインダーを再注入する。 |
| `orchestration-check.js` | `Stop` | delivery の主張が、missing panel、blocking verdict、failed/unrun verification、missing live-run evidence と矛盾している場合に警告する。 |

これらの hooks は、ファイルの削除、システム設定の変更、権限の変更、subprocess の実行、コードのダウンロード、コードや transcript の送信を一切行いません。あくまで guardrail であり、sandbox ではありません；詳細は [`SECURITY.md`](SECURITY.md) と [`ARCHITECTURE.md`](ARCHITECTURE.md) を参照してください。

hooks が ctide のプロジェクトファイルを移行・書き込み・削除することも決してありません；旧レイアウトの一度きりの移行は、workflow 自身があなたの session 内で目に見える tool 操作として実行します。確認や制限を行う各 hook はプロジェクト単位に opt-out できます。「設定リファレンス」の節を参照してください。

## 設定リファレンス

以下はすべてオプションです。ctide のデフォルト動作には設定は一切不要です。

**永続的な設定**：`.claude/settings.json` または `.claude/settings.local.json`（local が優先）、すべて `"ctide": { ... }` の下に置きます。それぞれ**デフォルトで有効**で、`false` に設定するとそのプロジェクトで opt-out できます：

| Key | 無効化される対象 |
|---|---|
| `planGate` | `plan-gate.js`：plan mode 中に強制される編集ブロック |
| `destructiveGuard` | `destructive-guard.js`：狭く絞った復元不能な destructive command 実行前の確認 |
| `contractGuard` | `contract-guard.js`：contract／design を弱める前の確認。これらの guard flag を無効化する前の確認を含む |
| `preserveOnCompact` | `compact-fidelity.js`：context compaction 後の workflow-continuity リマインダー |

設定ファイルが壊れている、または読み込めない場合は「無効化されていない」として扱われます（fail-safe：guard はそのまま動作し続けます）。例——特定のプロジェクトで `contract-guard.js` を無効化する：

```json
// .claude/settings.json
{
  "ctide": { "contractGuard": false }
}
```

**環境変数**（デフォルトは未設定）：

| 変数 | 設定した場合の効果 |
|---|---|
| `CTIDE_ENFORCE_STOP` | 空でない値を設定すると、`orchestration-check.js` の Stop hook が verdict/evidence の矛盾時に警告するだけでなく、delivery を強制的にブロックするようになります |
| `CTIDE_HOOK_DEBUG` | `1` に設定すると、各 hook が debug trace を1行追加出力します（[`/ctide:doctor`](#ヘルスチェックdoctor) や手動のトラブルシューティングで使用） |

```bash
CTIDE_ENFORCE_STOP=1 claude            # bash/zsh
```

```powershell
$env:CTIDE_ENFORCE_STOP = "1"; claude  # PowerShell
```

**タスク単位の機能**：デフォルトはオフ。そのタスクで明示的に有効化したときだけ動き、ハード依存には決してなりません：

| 機能 | 有効化する方法 |
|---|---|
| Codex によるクロスモデルのセカンドオピニオン | タスク内でそう伝える（例：「repair loop が詰まったら Codex を使ってよい」）；[`references/external-capabilities.md`](cressetide/skills/vigil/references/external-capabilities.md) 参照 |
| レビュアーごとの MCP ツール | デフォルトでは `.mcp.json` は空です。サーバーを追加し（[`mcp.example.json`](cressetide/mcp.example.json) 参照）、該当レビュアーの frontmatter 内の対応する `mcp__*` 行のコメントを解除してください |

**実行単位のフラグ**（`/ctide:vigil` への引数）：

| フラグ | 効果 |
|---|---|
| `--deep`（または `deep:` / `ultra:` プレフィックス） | deep-mode Tier 2 を有効化：発見事項の adversarial verification と `arbiter`/`security-reviewer` の最大推論強度；コストは上がり、自動的には有効化されません |
| `--no-deep` / `--shallow` | deep-mode Tier 1 の決定論的パネル実行（高リスク／correctness-critical な作業で本来自動的に有効化される）を無効化します |
| `--lite` | 必要最小限のレビューパネルを強制し、Tier 2 をスキップしますが、高リスクのシグナルがある場合は関連する safety reviewer は維持します |
| `--report full` | コンパクトなデフォルトの代わりに詳細な最終レポート（エージェントごとの活動、完全な token/cost 表）を出力します |

```text
/ctide:vigil --deep ネットワークタイムアウト時に一度だけバックオフ付きで再試行するよう、決済のリトライロジックをリファクタリングして。
/ctide:vigil --lite エラーメッセージの文言にある typo を直して。
```

## 互換性

ctide は Claude Code を主対象としています。GitHub Copilot CLI でも動きますが、割り引いて考えてください：plugin 形式は読み込めるものの、Claude Code 専用の hook 出力の一部は届きません。

Compatibility と conformance smoke の詳細は [`docs/compatibility.md`](docs/compatibility.md)（英語）にあります。要点は以下の通りです：

- Claude Code が主要な runtime です。
- GitHub Copilot CLI は skills、subagents、一部の PreToolUse decision をロードしますが、injected された `SessionStart` と `Stop` の output は no-op になることがあります。
- Cressetide 固有の Copilot CLI live run はまだ記録されていません。新しい証拠が得られるまでは unverified と扱います。
- Claude Code の hook/agent contract は moving target です；release smoke の記録は [`RELEASING.md`](RELEASING.md) にあります。

## 信頼性とリリース

ctide は有効化されると hooks が auto-execute されるため、install の integrity が重要になります。

推奨される安全なインストール手順：

1. tagged release または pinned commit からインストールする。
2. 有効化する前に、配布される plugin の `hooks/` ディレクトリを確認する（repo path：`cressetide/hooks/`）。
3. インストール後に `/ctide:doctor` を実行する。
4. signed tag がある場合は `git verify-tag vX.Y.Z` で検証する。
5. release アセットに SHA-256 checksum がある場合は、公開されている `.sha256` ファイルと突き合わせて検証する。

trust model については [`SECURITY.md`](SECURITY.md)（英語）を、release checklist、live smoke、signed tag のセットアップ、checksum 検証については [`RELEASING.md`](RELEASING.md)（英語）を参照してください。

クイックスタートの marketplace command は便利さ優先の経路で、その時点の marketplace / repo の状態に追随します。

Release checksum はあくまで整合性チェックです：ダウンロードした archive が公開された release asset と一致するかを確認するだけで、真正性は signed tag や pinned SHA に依存したままです。デフォルトの clone path 自体は認証しないため、pinning が必要な場合は tagged/SHA checkout を使うか、検証済み archive とインストール後の `cressetide/` tree を比較してください。

## コスト

典型的な real-app での run は、ctide が plan、verify、review を行い、場合によっては repair も行うため、一回きりの AI review より高くつきます。おおよその目安：

| タスク規模 | Reviewer | 新規トークン | 所要時間 |
|---|---|---|---|
| 軽量 | `--lite`、core のみ | ~0.5-2M | 数分 |
| 典型 | 3-5 reviewers + repair 1回 | ~2-7M | ~5-15分 |
| 深掘り | `--deep`、repair 複数回 | >10M | ~20-40分 |

incident flow は要所で安く済みます：戦時のターンは短く（decision card 1枚ずつ、長文なし）、正式な修正にかかるのは通常の `--lite` run 1回分、Map の更新は限られた範囲の repo スキャンだけです。

小さな低／中リスクの変更では、自動の **fast lane** がさらに一歩進みます：実行エビデンスがすでに reviewer の問いに答えている場合（behavior-changing な基準すべてに red→green テストがあり、full required suite がグリーン）、`test-reviewer` はエビデンスで代替され、`ctide:panel=substituted:test-reviewer` として開示されます。同じエビデンスで、より少ない agents。高リスクと deep run は fast lane を通りません。

## サンプルとエビデンス

これらはレポートの見た目を示すサンプルで、逐語的な transcript ではありません：

- [`examples/ready-run.md`](examples/ready-run.md)、[`examples/fix-required-run.md`](examples/fix-required-run.md)、[`examples/not-ready-run.md`](examples/not-ready-run.md)（英語）- 3種類の verdict の結果。`FIX REQUIRED -> READY` の repair loop を含みます。
- [`examples/review-packet.md`](examples/review-packet.md)、[`examples/final-report-compact.md`](examples/final-report-compact.md)、[`examples/final-report-full.md`](examples/final-report-full.md)（英語）- reviewer への入力と delivery output の contract-field の例。

ctide には **telemetry がない**ため、real-world での検証は手動記録によって追跡されています。[`EVIDENCE.md`](EVIDENCE.md) が唯一の正となる記録です：

| Track-2 指標 | 現在の状況 |
|---|---|
| Type-B verified live runs | 0 recorded |
| Distinct real projects | 0 recorded |
| Non-maintainer runs | 0 / 1 |

最も価値のある貢献：実際の作業で ctide を動かし、[Verified ctide run issue](https://github.com/kktu6507/cressetide/issues/new?template=verified-run.yml) を開いてください。ctide が最後に出力する `### Live run` block を貼り付け、misses、false alarms、cost、follow-up outcome をそのまま記録してください。正直なネガティブ情報こそが evidence の要点です。

## ドキュメント

- [`docs/tutorial-first-run.md`](docs/tutorial-first-run.md)（英語）- ctide の最初の実行を、最初から最後まで。
- [`docs/task-writing-guide.md`](docs/task-writing-guide.md)（英語）- ctide が検証できるタスクの書き方。
- [`docs/how-to-read-verdicts.md`](docs/how-to-read-verdicts.md)（英語）- `READY` / `FIX REQUIRED` / `NOT READY` の意味。
- [`docs/compatibility.md`](docs/compatibility.md)（英語）- tested runtime と conformance smoke checklist。
- [`docs/advanced/external-capabilities.md`](docs/advanced/external-capabilities.md)（英語）- optional な MCP、Codex、browser、design capabilities。
- [`cressetide/examples/FAILURE_MEMORY.sample.md`](cressetide/examples/FAILURE_MEMORY.sample.md)（英語）- 記入済みの failure-memory サンプル（entry template + retire markers）。
- [`EVIDENCE.md`](EVIDENCE.md)（英語）- Cressetide の verification と live-run evidence log。
- [`ARCHITECTURE.md`](ARCHITECTURE.md)（英語）- component map、stable contract、limits。
- [`SECURITY.md`](SECURITY.md)（英語）- trust model、安全なインストール、vulnerability reporting。
- [`RELEASING.md`](RELEASING.md)（英語）- release automation、live smoke、signed tag、checksum。

## ライセンス

[MIT](LICENSE) · バージョン履歴は [CHANGELOG.md](CHANGELOG.md)。
