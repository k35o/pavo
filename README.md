# Pavo

[`anthropics/claude-code-action`](https://github.com/anthropics/claude-code-action) をラップした composite action と、レビュー観点をまとめた Markdown を 1 リポジトリに集約した、個人用の AI コードレビュー基盤。

レビューは caller 側で用意した GitHub App から投稿され、ユーザーがインラインコメントへ返信すると同じ App が会話で応答する。

## 使い方

target repo に caller workflow を 1 つ追加する。

```yaml
# .github/workflows/pavo.yml
name: Pavo

on:
  pull_request:
    types: [opened, synchronize, reopened]
  pull_request_review_comment:
    types: [created]

# Same-PR pushes cancel earlier in-flight reviews so only the latest commit is reviewed.
# event_name in the group keeps review and reply jobs from cancelling each other.
concurrency:
  group: pavo-${{ github.event_name }}-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  pavo:
    # Skip on PRs from forks: secrets are not exposed to fork workflows.
    if: ${{ github.event.pull_request.head.repo.fork != true }}
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: read
      pull-requests: write
    steps:
      - id: app-token
        uses: actions/create-github-app-token@1b10c78c7865c340bc4f6099eb2f838309f1e8c3 # v3.1.1
        with:
          client-id: ${{ secrets.K35O_BOT_CLIENT_ID }}
          private-key: ${{ secrets.K35O_BOT_PRIVATE_KEY }}

      - uses: k35o/pavo@main
        with:
          github_token: ${{ steps.app-token.outputs.token }}
          app_slug: ${{ steps.app-token.outputs.app-slug }}
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          instructions: default,nextjs
```

`@main` のままだと最新を追従する。固定したい場合は `@<commit-sha>` で 40 文字 SHA を指定する（Renovate 等が自動更新できる形）。

PR トリガー / インライン返信トリガーの分岐は action 側で `github.event_name` を見て自動切り替えするので、caller は 1 step で済む。

## セットアップ

### 1. GitHub App を作成

[GitHub App](https://github.com/settings/apps/new) を作成して、対象リポジトリにインストールする。slug 名は任意（caller ごと・プロジェクトごとに別の App でもよい）。

| 項目 | 設定 |
| --- | --- |
| Repository permissions | `Pull requests: Read & write`, `Contents: Read`, `Issues: Read & write`, `Metadata: Read` |
| Subscribe to events | `Pull request`, `Pull request review`, `Pull request review comment` |

App ID と Private key (PEM) を控えておく。

### 2. caller repo に secret を登録

1 つの App を複数 repo で使い回す場合は org secret 化するとまとめて共有できる。

| secret | 用途 |
| --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude Code Max OAuth token (`claude setup-token` で発行) |
| `K35O_BOT_CLIENT_ID` | 用意した GitHub App の Client ID (`Iv23...`) |
| `K35O_BOT_PRIVATE_KEY` | 用意した GitHub App の Private key (PEM 全体) |

caller workflow 側で `actions/create-github-app-token` に Client ID と Private key を渡してインストールトークンを発行し、Pavo にはそのトークンと App slug だけを渡す。Pavo 側は Client ID / Private key を直接受け取らない。

## 観点

`instructions/` 配下の Markdown は 2 種類に分かれる。

- [`system.md`](instructions/system.md) — **常時ロード**。レビュアーの persona・確認のフロー・severity rubric・ノイズ抑制・コメントスタイル・コード引用ルールなど「どうレビューするか」のルール
- それ以外の `*.md` — 観点の opt-in。caller 側で `instructions: default,nextjs` のようにカンマ区切りで選ぶ

| 観点 | カバー範囲 | 継承 |
| --- | --- | --- |
| [`default`](instructions/default.md) | バグ・可読性・テスト・ドキュメント・**セキュリティ** | — |
| [`frontend`](instructions/frontend.md) | a11y・フォーム・レイアウトシフト・i18n | — |
| [`react`](instructions/react.md) | `useEffect` 濫用回避・Concurrent Mode・React 19 | `frontend` |
| [`nextjs`](instructions/nextjs.md) | App Router・Server / Client 境界・Server Actions | `frontend` + `react` |

セキュリティ観点（入力検証・認証・機密情報・インジェクション等）は `default` に内包されており、常に評価される。

依存関係は [`instructions/index.json`](instructions/index.json) で定義しており、`react` を指定すると自動で `frontend` も読み込まれる。`nextjs` を指定すると `frontend` + `react` + `nextjs` がこの順でロードされる。重複は排除される。

組み合わせ例：

- React コンポーネントライブラリ → `default,react`（自動的に `frontend` も）
- Next.js アプリ → `default,nextjs`（自動的に `frontend,react` も）

レビューコメントは重要度を絵文字で区別する：🔴 Critical / 🟡 Warning / 🔵 Suggestion / 👍 Praise

inline 指摘 0 件・全体として問題なしと判断したときは `event: APPROVE` で投稿される（branch protection で「N 承認必須」を設定している場合 Pavo の APPROVE が承認カウントに加わる点に注意）。指摘がある場合や確信が持てない場合は `event: COMMENT` のまま。`REQUEST_CHANGES` は使わない。

各 review path では、新しいレビューを投稿する前に同 bot の `state: APPROVED` な過去レビューを dismiss する。これにより「commit A で APPROVE → commit B で問題発見 → COMMENT」の流れでも古い APPROVE が承認カウントに残らず、最新のレビュー結果だけが効く。再 APPROVE の場合は dismiss → 新 APPROVE になる。

出力言語は **PR description の主要言語** に合わせる。英語の description なら英語、日本語なら日本語でレビュー・返答する。description が空 or 不明瞭な場合は日本語にフォールバック。

## 入力リファレンス

| 入力 | 必須 | デフォルト | 説明 |
| --- | --- | --- | --- |
| `github_token` | ✓ | — | レビュー投稿に使うトークン。通常 `actions/create-github-app-token` の出力 |
| `app_slug` | ✓ | — | GitHub App の slug。通常 `actions/create-github-app-token` の `app-slug` 出力 |
| `claude_code_oauth_token` | ✓ | — | Claude Code Max OAuth token |
| `instructions` | | `default` | カンマ区切りの観点名。依存は自動解決 |
| `extra_prompt` | | (なし) | リポジトリ固有の追加コンテキスト |
| `skip_label` | | `pavo:skip` | この label が付いていると action をスキップ |

caller が `uses: k35o/pavo@<ref>` で呼ぶと、Pavo の repo がその commit でランナー上に checkout され、`instructions/*.md` も同じ commit のものが使われる。caller の ref が instructions のバージョンも兼ねる。

## レビューを止める

PR に `pavo:skip` label を付けると、`pull_request` / `pull_request_review_comment` 両イベントでレビュー・返信が action 内の最初の gate ステップでスキップされる。

label 名を変えたい場合は `with: skip_label: <name>` を渡す。

## バージョン管理

タグやリリース運用は持たず、ブランチか commit SHA で参照する：

- `@main` — 最新を追従。気軽に使う場合
- `@<40-char-sha>` — 完全固定。Renovate 等で `# branch: main` コメントを付けておけば、新しい commit が出るたびに PR が来る

不変タグ運用が必要になった段階で `actions/checkout` のような「sliding major + 不変タグ」方式を入れればよいが、現状は不要。

## アーキテクチャ

### `action.yml` (composite action)

caller の 1 step として動き、`github.event_name` で内部分岐する。

**review path** (`pull_request` トリガー時):

1. `gate` ステップで skip label / event 種別を判定
2. `bot` ステップで `gh api /users/<slug>[bot]` を呼んで bot user ID を取得
3. caller repo の PR ブランチを `actions/checkout` で取得
4. `gh api` で「Pavo bot が過去にこの PR に投稿したコメント一覧」を取得
5. `${GITHUB_ACTION_PATH}/instructions/system.md` を常時ロードし、`instructions/index.json` の依存グラフを解決した観点 Markdown を結合して prompt を構築
6. 同 PR にこの bot が残した `state: APPROVED` なレビューがあれば `gh api PUT /pulls/<pr>/reviews/<id>/dismissals` で dismiss（fresh review が活きるように）
7. `claude-code-action` を App token + bot identity で起動
8. Claude が `gh pr diff` を読んで指摘を集めたあと、`gh api POST /pulls/<pr>/reviews` で Review として一括投稿（PR-level body + inline comments を 1 件のレビューにバンドル）

**conversation path** (`pull_request_review_comment` トリガー時):

1. `gate` ステップで `created` && Bot 以外 && reply であることを確認
2. `bot` ステップで bot identity を取得
3. `thread` ステップで thread root のコメントが Pavo 自身のものか確認（違えば skip）
4. PR ブランチ（HEAD SHA）を checkout
5. thread の会話履歴を取得し、prompt を構築
6. `claude-code-action` を起動し、Claude が `gh api .../comments/<root>/replies` で thread に返信

### dogfooding

`.github/workflows/pavo.yml` で自分自身を呼ぶ caller workflow を同梱しており、Pavo の PR は Pavo 自身がレビューする。同 repo 内の composite action は `uses: ./` で参照する。
