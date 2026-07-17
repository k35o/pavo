# Pavo

[eve](https://github.com/vercel/eve)（Vercel の filesystem-first エージェントフレームワーク）で
動く、個人用の AI コードレビュー基盤。GitHub App の webhook を受けて PR をレビューする。
webhook 駆動なので **対象リポジトリに workflow ファイルは不要** — App をインストールして
`PAVO_EVE_REPOS` の allowlist に載せるだけで有効になる。

エンジンは Sakana Fugu。レビュー観点は `agent/` 配下の Markdown / TypeScript で定義する。

> 旧実装（`anthropics/claude-code-action` をラップした GitHub composite action 版）は
> git 履歴に残っている。webhook 駆動の本実装へ完全移行済み。

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

- デプロイ: main への push で Vercel が自動デプロイ（プロジェクト `pavo-eve`、https://pavo-eve-k8o.vercel.app）。手動なら `pnpm exec vercel deploy --prod`
- 検証: `pnpm typecheck` / `pnpm test` / `fnox exec -- pnpm exec eve eval --strict`（live・数分かかる）。PR ごとに `ci.yml` が typecheck + test を回す
- kill switch: Vercel env `PAVO_EVE_DISABLED=true`（webhook を App 設定で Active off にしても止まる）
- 対象リポジトリの追加: Vercel env `PAVO_EVE_REPOS`（カンマ区切り full name）に追記
- レビュー観点の割り当て: Vercel env `PAVO_EVE_INSTRUCTIONS_MAP`（repo→観点名の JSON）

## 未実装（フォローアップ）

- **credential-check / metrics**: Actions 版にあった月次のクレデンシャル疎通確認と週次の
  resolve 率集計は、eve の `agent/schedules/`（cron）として再実装予定。現状は未移植
- **convo の resolve / learnings**: スレッド返信での自動 resolve と学習メモ蓄積は、eve の
  セッション永続を活かした形で再設計予定
- **installation token の down-scope**: 現状は App の全 repo・全権限トークン

## 環境変数（Vercel / production）

`GITHUB_APP_ID`（client ID 可） / `GITHUB_APP_PRIVATE_KEY` / `GITHUB_WEBHOOK_SECRET`（fnox の
`K35O_BOT_WEBHOOK_SECRET` と同値） / `GITHUB_APP_SLUG` / `GITHUB_APP_INSTALLATION_ID` /
`SAKANA_API_KEY` / `PAVO_EVE_REPOS` / `PAVO_EVE_MODEL`（default: fugu-ultra） /
`PAVO_EVE_INSTRUCTIONS_MAP`（repo→観点名の JSON。例 `{"k35o/k8o":"nextjs,typescript"}`） /
`PAVO_EVE_APPROVE`（**default: false**。shadow 期間は COMMENT 固定でインジェクション耐性を上げる。
`true` で承認を解禁） / `PAVO_EVE_IGNORE` / `PAVO_EVE_DISABLED`

## セキュリティ

- **投稿先の束縛**: `submit_review` は投稿先 repo/PR/head sha をモデル引数から受け取らない。
  起動元 webhook の context（`ctx.session.auth.current.attributes`）に束縛し、head sha は PR API
  から解決する。これによりモデルが操られても「今レビュー中の PR」以外へ書き込めない（confused
  deputy 防止）
- **承認は既定 COMMENT**: `PAVO_EVE_APPROVE` 未設定なら COMMENT 固定。プロンプトインジェクション
  で作れる最悪ケースが「指摘の抑制」に限定され、不正な APPROVE の製造を封じる
- **信頼境界の限界（既知・上流依存）**: eve フレームワークは PR タイトル/本文/diff を
  `<github_pull_request>` ブロックとして無サニタイズでモデルに注入する（現行 API では無効化
  できない）。このため「モデルがインジェクションに従わない」ことに整合性を依存させず、投稿先束縛
  ＋COMMENT 既定＋スレッド resolve のガードという決定的レイヤーで守る
- **プライベートコードの第三者送信**: レビュー対象の diff とコードは Sakana(`api.sakana.ai`) に
  送られる。プライベートリポジトリを対象にする場合はこのデータフローを許容できることが前提
- **installation token**: 現状 App の全リポジトリ・全権限トークンを使う（down-scope は今後の
  改善。被害半径の縮小であって、上記の投稿先束縛が実際の攻撃を塞いでいる）

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
