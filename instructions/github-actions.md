# GitHub Actions 観点

Workflow YAML・composite action・CI 用シェルスクリプトに関わる観点。
非推奨の `::set-output` / `::set-env` やタグ参照のままのサードパーティ action など、古い慣習は積極的に指摘する。

## 観点

- **Script injection**
  - `${{ }}` の式を `run:` のシェルへ直接埋め込んでいないか（PR タイトル・本文・ブランチ名・コミットメッセージ等の `github.event.*` は攻撃者が制御できる）
  - 信頼できない値は `env:` で環境変数に渡し、シェル内では `"$VAR"` として参照しているか
  - `actions/github-script` や composite action の `inputs` に渡した値が、その先で式やシェルに再展開されていないか
- **危険なトリガー**
  - `pull_request_target` / `workflow_run` で fork 由来のコード（PR head の checkout、そのビルドスクリプトの実行）を secrets・write 権限と同居させていないか
  - `workflow_run` で前段 workflow の artifact や head ref を無検証に信頼していないか
  - ラベル付与やコメントコマンドを実行条件にする場合、それを発火できる人の権限を確認しているか
- **`permissions` の最小化**
  - トップレベルは `permissions: {}` か read のみに絞り、書き込みが必要な job だけに個別付与しているか
  - `GITHUB_TOKEN` に用途を超えた `contents: write` / `pull-requests: write` 等が付いていないか
  - PAT や App トークンを、より権限の弱い `GITHUB_TOKEN` で置き換えられないか
- **secrets の扱い**
  - secrets がログに出うる経路がないか（`echo`・デバッグ出力・エラーメッセージ・`set -x` 経由）
  - 自動マスクが値の完全一致に依存することを考慮しているか（JSON 等の構造化データを secret として登録した場合や、base64 等で加工した値を出力した場合はマスクされない）
  - fork からの PR で実行されるパスに secrets が流れていないか（`pull_request` では渡らない前提が崩れていないか）
- **サプライチェーン**
  - サードパーティ action を full-length SHA でピンし、バージョンをコメントで併記しているか（タグ・ブランチ参照は後から書き換え可能）
  - キャッシュキーに信頼できない入力が混ざり、汚染されたキャッシュが信頼される job に流入する余地がないか
  - `actions/checkout` は push が不要な job で `persist-credentials: false` にしているか
- **シェルの堅牢性**
  - `shell: bash` を明示しているか（暗黙のデフォルトは `pipefail` なしで pipe の失敗を握りつぶす）
  - スクリプトファイル側には `set -euo pipefail` 相当の保護があるか
  - 変数展開のクォート漏れや、複数行・任意文字列の受け渡しで heredoc を使わず壊れる箇所がないか
  - 複雑になったインラインスクリプトはファイルに切り出して単体で実行・テストできる形にしているか
- **`GITHUB_OUTPUT` / `GITHUB_ENV` への書き込み**
  - 複数行や任意文字列を書き込むとき、値と衝突しないデリミタの heredoc 形式を使っているか
  - 信頼できない値を `GITHUB_ENV` に書くと後続 step への injection になりうることを考慮しているか
- **実行制御**
  - すべての job に `timeout-minutes` が設定されているか（デフォルトの 360 分は事故時に高くつく）
  - `concurrency` の group 設計と `cancel-in-progress` が用途に合っているか（PR の CI はキャンセルしてよいが、デプロイの途中キャンセルは危険）
  - `if:` 条件が前提とするイベントと実際のトリガーが一致しているか（`github.event` の構造はイベントごとに異なり、存在しないフィールドは黙って空になる）
  - matrix の `fail-fast` が意図と合っているか（全組み合わせの結果が欲しいのに途中で止めていないか）

