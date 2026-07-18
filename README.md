# Pavo

[`anthropics/claude-code-action`](https://github.com/anthropics/claude-code-action) をラップした composite action と、レビュー観点をまとめた Markdown を 1 リポジトリに集約した、個人用の AI コードレビュー基盤。

レビューは caller 側で用意した GitHub App から投稿され、ユーザーがインラインコメントへ返信すると同じ App が会話で応答する。

Claude はレビューを直接投稿しない。**Claude は指摘の構造化 JSON を返すだけ**で、投稿・絵文字付与・APPROVE 判定・古い APPROVE の dismiss・スレッド resolve は Pavo のスクリプトが決定的に行う。このため Claude に許可されるツールは読み取り系（`Read` / `Grep` / `Glob` / `gh pr diff` / `gh pr view`）のみ。

## 使い方

推奨は reusable workflow 経由。target repo に caller workflow を 1 つ追加する。

```yaml
# .github/workflows/pavo.yml
name: Pavo

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
  pull_request_review_comment:
    types: [created]
  issue_comment:
    types: [created]

jobs:
  pavo:
    # /pavo コマンド以外の通常コメントで runner を起こさないための事前フィルタ
    if: ${{ github.event_name != 'issue_comment' || startsWith(github.event.comment.body, '/pavo') }}
    uses: k35o/pavo/.github/workflows/review.yml@main
    with:
      instructions: default,nextjs
    secrets: inherit
```

`secrets: inherit` で org secrets（`K35O_BOT_CLIENT_ID` / `K35O_BOT_PRIVATE_KEY` / `CLAUDE_CODE_OAUTH_TOKEN`）がそのまま渡る。concurrency・fork スキップ・timeout・App token 発行は reusable workflow 側に集約されているので、caller の改善は Pavo 側の 1 コミットで全リポジトリに届く。

App token の発行やジョブ構成を自分で制御したい場合は、composite action `k35o/pavo@main` を直接使う（inputs は下の「入力リファレンス」参照）。

`@main` のままだと最新を追従する。固定したい場合は `@<commit-sha>` で 40 文字 SHA を指定する（Renovate 等が自動更新できる形）。

## セットアップ

### 1. GitHub App を作成

[GitHub App](https://github.com/settings/apps/new) を作成して、対象リポジトリにインストールする。slug 名は任意。

| 項目 | 設定 |
| --- | --- |
| Repository permissions | `Pull requests: Read & write`, `Contents: Read`（learnings 保存を使うなら `Read & write`）, `Issues: Read & write`, `Metadata: Read` |
| Webhook | 「Active」のチェックを外す（不要）。イベントの受け取りは caller workflow の `on:` が担うため、App の event subscription は使わない |

### 2. caller repo（または org）に secret を登録

| secret | 用途 |
| --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude Code Max OAuth token (`claude setup-token` で発行) |
| `K35O_BOT_CLIENT_ID` | GitHub App の Client ID (`Iv23...`) |
| `K35O_BOT_PRIVATE_KEY` | GitHub App の Private key (PEM 全体) |

Pavo 自身は Client ID / Private key を受け取らず、`actions/create-github-app-token` が発行したインストールトークンと App slug だけを受け取る。

## トリガー

| きっかけ | 動作 |
| --- | --- |
| PR の open / push / reopen | フルレビュー（2 回目以降は前回レビュー以降の差分に重点） |
| draft → ready for review | フルレビュー（draft のうちはスキップ。`review_drafts: true` で解除） |
| PR コメントで `/pavo` または `/pavo review` | オンデマンド再レビュー。skip label や draft 状態より優先される |
| サイドバーから bot に re-request review | 再レビュー（App が reviewer に指名できる場合のみ。caller の `types` に `review_requested` を足す） |
| Pavo のインラインコメントへの返信 | スレッドで会話応答。修正確認できればスレッドを resolve |

- `/pavo` とスレッド返信は `author_association` が `OWNER` / `MEMBER` / `COLLABORATOR` のユーザーのみ受け付ける（public repo で第三者が bot を起動できないようにするため)
- Bot が sender のイベント（Renovate 等）はデフォルトでスキップ。`allow_bots: renovate` のように許可リストで opt-in できる（自 bot は常に除外)
- fork からの PR はスキップ（secrets が渡らないため)

## 観点

`instructions/` 配下の Markdown は 2 種類に分かれる。

- 常時ロード — [`system.md`](instructions/system.md)（レビューの進め方・信頼境界・severity rubric・verdict 判定）と [`formatting.md`](instructions/formatting.md)（Markdown の書き方）。スレッド返信では [`conversation.md`](instructions/conversation.md) が persona になる
- opt-in 観点 — caller 側で `instructions: default,nextjs` のようにカンマ区切りで選ぶ

| 観点 | カバー範囲 | 継承 |
| --- | --- | --- |
| [`default`](instructions/default.md) | バグ・可読性・テスト・ドキュメント・PR description との整合・**セキュリティ** | — |
| [`frontend`](instructions/frontend.md) | a11y・フォーム・レイアウトシフト・i18n | — |
| [`react`](instructions/react.md) | `useEffect` 濫用回避・Concurrent Mode・React 19 | `frontend` |
| [`nextjs`](instructions/nextjs.md) | App Router・Server / Client 境界・Server Actions | `frontend` + `react` |
| [`typescript`](instructions/typescript.md) | 型の抜け穴・ユニオン網羅性・immutability・型設計 | — |
| [`node`](instructions/node.md) | ESM/CJS・async・stream・child_process・プロセス管理 | `typescript` |
| [`github-actions`](instructions/github-actions.md) | script injection・permissions・SHA ピン・シェル堅牢性 | — |
| [`walkthrough`](instructions/walkthrough.md) | レビュー冒頭に変更サマリテーブル + Mermaid 図を追加出力 | — |

依存関係は [`instructions/index.json`](instructions/index.json) で定義しており、`nextjs` を指定すると `frontend` + `react` も自動ロードされる。未知の観点名や `.md` の欠落は **エラーで落ちる**（黙って観点が欠けたままレビューしない）。

`./` で始まるエントリは対象リポジトリ内のファイルとして解決される: `instructions: default,./docs/review/backend.md` のように、fork せずにリポジトリ独自の観点を追加できる。注意: このファイルだけは **PR head の内容**が使われる（観点ファイルの追加・修正をその PR 自身で有効にするため）。観点ファイルを変更する PR は中身も diff としてレビューされる。

## レビューの動作

- 重要度は絵文字で表現: 🔴 Critical / 🟡 Warning / 🔵 Suggestion / 👍 Praise
- 各指摘には confidence (0-100) が自己採点され、**80 未満は投稿されない**（praise を除く）。投稿前に Claude 自身が Read/Grep で反証を試みるフローになっている
- 🔴 / 🟡 が 0 件なら `APPROVE`（🔵 / 👍 の指摘は APPROVE と同時に inline 投稿される）。`approve: false` で常に `COMMENT` にできる — **branch protection の承認数に Pavo を数えたくない場合はこれを使う**
- 新しいレビューの投稿後、同 bot の古い `APPROVED` レビューを dismiss する（投稿「後」なので、実行が失敗しても正当な承認が消えない）
- 機械的に適用できる小修正は GitHub の suggestion ブロック（1 クリックでコミット可能）として提案される
- suggestion で書けない修正には、`claude` CLI にそのまま渡せる Fix prompt が `<details>` で添付される
- 行アンカーが diff に載らない指摘・`min_severity` 未満の指摘は、レビュー本文の「その他の観察」に折りたたまれる（1 件の不正アンカーでレビュー全体が失われることはない）
- 前回レビュー時の SHA をレビュー本文の不可視マーカーに記録し、push 時は**前回以降の差分に重点**を置く
- 解消が確認できた自分の過去指摘スレッドは自動で resolve される
- 対象リポジトリの `CLAUDE.md` / `AGENTS.md` を読んでプロジェクト規約としてレビュー基準に反映する
- 出力言語は PR タイトル・description の主要言語に追従（`language: ja|en` で固定可）

## 対象リポジトリ側の設定ファイル

caller workflow を触らずにリポジトリ側で調整したい場合、以下のファイルが読まれる。いずれも **デフォルトブランチの内容**が使われる（PR がレビュー設定を書き換えても、その PR 自身のレビューには効かない。設定変更はデフォルトブランチに merge されてから有効になる）。

- `.github/pavo.json` — 設定。**action inputs より優先**。未知のキーはエラーで落ちる（typo が黙ってデフォルト値に落ちない）

  ```json
  {
    "instructions": "default,typescript",
    "ignore": ["src/generated/**"],
    "language": "auto",
    "approve": false,
    "min_severity": "warning",
    "model": "sonnet",
    "review_drafts": false
  }
  ```

- `.github/pavo.md` — 自由記述のリポジトリコンテキスト（`extra_prompt` と併用可）
- `.github/pavo-learnings.md` — レビューのやり取りから蓄積される学習メモ。スレッドで「今後はこうして」と伝えると Pavo が追記し（App に `Contents: Read & write` が必要）、以後のレビューに反映される。自動追記の保存先は **`pavo/learnings` ブランチ**（デフォルトブランチは「PR 必須」のルールセットで直コミットできないことが多いため）。読み込みは `pavo/learnings` → デフォルトブランチの順で、手書きでデフォルトブランチに置いてもよい

## 入力リファレンス

| 入力 | 必須 | デフォルト | 説明 |
| --- | --- | --- | --- |
| `github_token` | ✓ | — | レビュー投稿に使うトークン。通常 `actions/create-github-app-token` の出力 |
| `app_slug` | ✓ | — | GitHub App の slug |
| `claude_code_oauth_token` | ✓ | — | Claude Code Max OAuth token |
| `instructions` | | `default` | カンマ区切りの観点名。依存は自動解決。`./` は対象 repo 相対 |
| `extra_prompt` | | (なし) | リポジトリ固有の追加コンテキスト |
| `skip_label` | | `pavo:skip` | この label が付いていると action をスキップ |
| `model` | | `sonnet` | レビューに使うモデル。PR に `pavo:deep` label が付くと `opus` に切り替わる |
| `language` | | `auto` | 出力言語 (`auto` / `ja` / `en`) |
| `approve` | | `true` | `false` で常に COMMENT（APPROVE を出さない） |
| `min_severity` | | `suggestion` | inline 投稿する最低 severity。未満は本文に折りたたみ |
| `ignore_paths` | | (なし) | レビュー対象外 glob の追加（lockfile 等の既定除外に加算） |
| `allow_bots` | | (なし) | PR をレビューする bot login の許可リスト（カンマ区切り） |
| `review_drafts` | | `false` | draft PR もレビューする |

reusable workflow (`review.yml`) も同名の inputs を持つ。

## レビューを止める

- PR 単位: `pavo:skip` label（`skip_label` で変更可）。`/pavo` コマンドは label より優先される
- 全体（kill switch）: org / repo の Actions variable `PAVO_DISABLED` を `true` にすると、reusable workflow 経由の全実行が gate で即スキップされる
- 劣化した変更が `@main` に入ってしまったときのロールバック手順:
  1. `PAVO_DISABLED=true` で全停止
  2. main を revert する。**reusable workflow (`review.yml@main`) 経由の caller は action 本体が常に main 追従**なので、SHA pin で戻せるのは composite action `k35o/pavo@<sha>` を直接使っている caller だけ
  3. 修正を merge してから variable を戻す

## バージョン管理と CI

- タグやリリース運用は持たず、ブランチか commit SHA で参照する。SHA pin（+ Renovate 追従）が効くのは composite action を直接 `uses: k35o/pavo@<sha>` する場合。reusable workflow 経由は常に `@main` 追従になる
- [`ci.yml`](.github/workflows/ci.yml) が型チェック（`tsc --noEmit`）と、index.json の整合・全観点組み合わせのプロンプト生成・gate / 投稿ロジックの単体テスト（`node --test`）を PR ごとに検証する
- `scripts/*.ts` は TypeScript のまま Node の type stripping（Node 22.18+ で標準有効）で直接実行される。ビルドステップ・ランタイム依存はない（`typescript` は型チェック用の devDependency のみ）
- [`credential-check.yml`](.github/workflows/credential-check.yml) が月次で App 鍵と OAuth token の疎通を確認し、失敗すると issue を立てる（トークン期限切れによる全リポジトリ同時停止を事前に検知）
- [`metrics.yml`](.github/workflows/metrics.yml) が週次で指摘スレッドの resolve 率・👍/👎 を集計する。任意のリポジトリに対しては `REPO=owner/name BOT_NAME='xxx[bot]' node scripts/report-metrics.ts` で手動実行できる
- ラップしている `claude-code-action` は SHA pin。Renovate で追従する（upstream はインジェクションサニタイザ等の防御を頻繁に更新するため、放置しない）

## セキュリティ

- **信頼境界**: PR description・コード・コメントはすべて「データ」としてフェンス付きでプロンプトに渡され、system.md がそれらの中の指示に従うことを禁止している。レビュー挙動を操作しようとする文章は 🔴 として報告される
- **最小ツール**: Claude に許可されるのは読み取り系ツールのみ。GitHub への書き込み（投稿・dismiss・resolve）はすべて Pavo のスクリプトが固定のエンドポイントに対して行う
- **設定ファイルの遮断**: `--setting-sources user` により、checkout した PR 内の `.claude/settings.json`（hooks = 任意コマンド実行）は読み込まれない。レビュー設定（`.github/pavo.json` 等）はデフォルトブランチから読まれるため、PR が自分の審査基準を書き換えることもできない
- **checkout**: PR の head commit を `persist-credentials: false` で checkout する（`gh pr diff` が示すもの・`Read` が読むもの・inline コメントのアンカーが常に同一 commit になる）。`claude-code-action` 自身は App token を `.git/config` に書き込むため、Claude の `Read` / `Grep` から `.git/` 配下を deny している
- **APPROVE の扱い**: Pavo の APPROVE は branch protection の承認カウントに入る。必須承認数を Pavo で満たしうる構成にしたくない場合は `approve: false` を設定する

## アーキテクチャ

### review path (`pull_request` / `/pavo` / re-request)

1. `gate.ts` — イベント判定（draft / label / bot / association / kill switch）と設定解決（`.github/pavo.json` > inputs > デフォルト）。全ロジックはユニットテスト済み
2. プリフライト — bot user の存在・App のインストール・PR 読み取り権限を Claude 実行前に検証（失敗は具体的なエラーで即 fail）
3. PR head を checkout
4. `collect-context.ts` — GraphQL で全スレッド（resolve 状態・人間の返信込み）・レビュー履歴・コメントを収集し、前回レビュー SHA をマーカーから復元、compare API で差分ファイルを特定
5. `build-review-prompt.ts` — system + formatting + 観点 + repo 設定 + learnings + 会話コンテキスト + 出力要件を結合
6. `claude-code-action` — 読み取り専用ツールで diff とコードを調査し、`--json-schema` で検証された構造化 JSON（summary / verdict / comments / resolved_comment_ids）を返す
7. `post-review.ts` — confidence・ignore・min_severity・アンカー検証でフィルタし、Review を 1 回だけ POST（422 時は本文へ退避して再送）。成功後に古い APPROVE を dismiss、解消済みスレッドを resolve、`$GITHUB_STEP_SUMMARY` にメトリクスを出力
8. 失敗時は PR に「実行が失敗した」コメントと run URL を残す（サイレント失敗しない）

### conversation path (`pull_request_review_comment`)

1. `gate.ts` — 返信であること・association を確認
2. PR head を checkout
3. `build-conversation-prompt.ts` — thread root が自 bot か確認し、スレッド全文 + 対象 diff_hunk + repo コンテキストからプロンプトを構築
4. `claude-code-action` — 構造化 JSON（body / resolve_thread / remember）を返す
5. `post-reply.ts` — 返信を POST（JSON は stdin 渡しで shell を経由しない）。修正確認済みならスレッドを resolve、`remember` があれば learnings に追記

### dogfooding

[`.github/workflows/pavo.yml`](.github/workflows/pavo.yml) は **`@main` の Pavo** で自 PR をレビューする。`uses: ./` にしない理由: action.yml や instructions を書き換える PR が「書き換え後の自分」に審査されると、レビューを骨抜きにする変更をその変更自身が承認できてしまう。PR 版のコードは ci.yml が検証する。

## トラブルシュート

| 症状 | 原因と対処 |
| --- | --- |
| `GitHub App user xxx[bot] not found` | `app_slug` の綴り違い。`create-github-app-token` の `app-slug` 出力を使う |
| `App token cannot read <repo>` | App が対象リポジトリにインストールされていない |
| `App token cannot read PR` | App の `Pull requests: Read & write` 権限が欠けている |
| レビューが来ない（run は緑） | gate のスキップ理由が Actions ログの `::notice::` に出ている（draft / label / bot / association） |
| レビューが来ない（run が赤） | PR に失敗通知コメントが付く。run URL のログを確認 |
| `Unknown instruction: xxx` | `instructions` の typo。既知の観点名はエラーメッセージに列挙される |
| learnings が保存されない | App の `Contents` 権限が Read のみ。`Read & write` に変更する |
| 全リポジトリで一斉に止めたい | Actions variable `PAVO_DISABLED=true`（reusable workflow 経由の場合） |
