# Pavo on eve（shadow デプロイ）

GitHub Actions 版 Pavo（リポジトリルート）と並走する、[eve](https://github.com/vercel/eve) ベースの実装。
webhook 駆動なので **対象リポジトリに workflow ファイルが不要**になる（App のインストールだけで有効）。

現在は shadow 運用中: `PAVO_EVE_REPOS` の allowlist に載ったリポジトリにしか反応しない。

## 構成

| パス | 役割 |
| --- | --- |
| `agent/instructions.md` | レビュー persona（Actions 版 system.md の移植。信頼境界・rubric・confidence・verdict） |
| `agent/channels/github.ts` | App webhook の受信 + dispatch ゲート（gate.ts の decide() 移植: draft / skip label / Bot / cross-repo / allowlist） |
| `agent/tools/submit_review.ts` | レビュー投稿ツール。モデルは findings を渡すだけで、フィルタ・アンカー検証・投稿・APPROVE 判定はここ（app runtime）が実行 |
| `agent/lib/review.ts` | post-review.ts の移植（confidence / min_severity / 422 サルベージ / dismiss 後置 / auto-resolve） |
| `agent/lib/github.ts` | App JWT → installation token の fetch ベース GitHub クライアント |
| `agent/agent.ts` | モデル定義。Sakana Fugu を OpenAI 互換 API 直指定（サブスク定額。Gateway 経由だと従量になるので注意） |
| `evals/` | `eve eval`。live smoke（fugu 実打で submit_review が 1 回で締まるか） |
| `tests/` | 決定的ロジックの unit tests（`node --test`） |

## 運用

- デプロイ: `pnpm exec vercel deploy --prod`（プロジェクト `pavo-eve`、https://pavo-eve-k8o.vercel.app）
- 検証: `pnpm typecheck` / `node --test 'tests/*.test.ts'` / `fnox exec -- pnpm exec eve eval --strict`（live・数分かかる）
- kill switch: Vercel env `PAVO_EVE_DISABLED=true`（webhook を App 設定で Active off にしても止まる）
- 対象リポジトリの追加: Vercel env `PAVO_EVE_REPOS`（カンマ区切り full name）に追記して redeploy

## 環境変数（Vercel / production）

`GITHUB_APP_ID`（client ID 可） / `GITHUB_APP_PRIVATE_KEY` / `GITHUB_WEBHOOK_SECRET`（fnox の
`K35O_BOT_WEBHOOK_SECRET` と同値） / `GITHUB_APP_SLUG` / `GITHUB_APP_INSTALLATION_ID` /
`SAKANA_API_KEY` / `PAVO_EVE_REPOS` / `PAVO_EVE_MODEL`（default: fugu-ultra） /
`PAVO_EVE_APPROVE` / `PAVO_EVE_IGNORE` / `PAVO_EVE_DISABLED`

## GitHub App 側の設定（手動）

App `k8o-bot` の Webhook を Active にし、URL に `https://pavo-eve-k8o.vercel.app/eve/v1/github`、
secret に `fnox get -P bot K35O_BOT_WEBHOOK_SECRET` の値を設定する。イベント購読は現状の
`pull_request` / `pull_request_review_comment` で自動レビューと返信が動く（`/pavo` 相当の
コマンドを eve 側でもやる場合は `Issue comment` の購読を追加）。

**Actions 版への影響はない**（Actions は webhook を使わない）。webhook を Active off に戻せば
eve 側だけが完全に停止する。

## 既知の制約（v0）

- 会話の resolve_thread / remember（learnings）は未移植（eve のセッション永続を活かした形で Phase 2 で設計し直す）
- Fugu の Chat Completions は response_format を無視するため、構造化データは必ずツール入力で受ける（eve のターン outputSchema には依存しない）
- fugu-ultra のレイテンシは数分〜。非同期レビューでは許容、対話的な返信では体感が重い可能性
