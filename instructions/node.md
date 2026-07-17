# Node.js 観点

Node.js (>= 20) で動くサーバー・CLI・スクリプトに関わる観点。
古い慣習（callback スタイル、標準モジュールで代替できる定番パッケージ）は積極的に指摘する。

## 観点

- **モジュールと import**
  - ESM / CJS の境界を越える箇所で解釈違いが起きていないか（CJS の `require` で ESM を読む、`default` export の二重ラップ）
  - ESM で `__dirname` / `__filename` を前提にしていないか → `import.meta.dirname` / `import.meta.filename`
- **async の落とし穴**
  - 投げっぱなしの Promise（`await` も `.catch()` もない呼び出し）が unhandled rejection にならないか
  - 依存関係のない `await` が直列に並んでいないか → `Promise.all` で並行化
  - 一部の失敗を許容すべき箇所で `Promise.all` を使っていないか → `Promise.allSettled`
  - `forEach` / `map` に async 関数を渡して、完了を待たずに次へ進んでいないか
- **stream とメモリ**
  - 大きなファイルやレスポンスを `readFile` 等で全量メモリに載せていないか → stream で処理
  - stream の連結はエラーが伝播しない `pipe` ではなく `node:stream/promises` の `pipeline` を使っているか
  - backpressure を無視して `write` を繰り返していないか → `drain` を待つか `pipeline` に寄せる
- **child_process**
  - 外部入力が混ざるコマンド実行に `exec` や `shell: true` を使っていないか → `execFile` / `spawn` に引数配列で渡す
  - 子プロセスの終了コードと stderr を確認しているか
- **環境変数と設定**
  - `process.env` の参照が起動時に検証・集約されているか（利用箇所に散らばっていないか）
  - 必須の環境変数が欠けたとき、起動時に明確なエラーで落ちるか
  - シークレットを子プロセスの引数に載せていないか（`ps` で他プロセスから見える）→ 環境変数か stdin で渡す
- **プロセスのライフサイクル**
  - サーバーは SIGTERM / SIGINT で graceful shutdown しているか（新規受付停止 → 処理中の完了 → リソース解放）
  - `process.exit()` の即時呼び出しで、書き込みやフラッシュ中の処理を打ち切っていないか
  - `uncaughtException` を握りつぶして処理を続行していないか（ログ後に終了が原則）
- **パスと fs**
  - パスの結合を文字列連結でしていないか → `path.join` / `path.resolve` / `new URL(..., import.meta.url)`
  - `process.cwd()` 依存の相対パスがエントリポイント以外に紛れ込んでいないか
  - サーバーのリクエスト処理内で `*Sync` 系 fs API を使っていないか（CLI・起動時の初期化は許容）
  - 外部入力からパスを組み立てる箇所で path traversal を考慮しているか
- **依存追加の妥当性**
  - 標準機能で足りるものに依存を追加していないか（`fetch`, `node:test`, `util.parseArgs`, `util.styleText`, `--env-file` 等）
  - 標準 API で代替できるパッケージ（`mkdirp` → `fs.mkdir` の `recursive`、`rimraf` → `fs.rm`）や、メンテが止まったパッケージ（`request` 等）を新規に持ち込んでいないか
- **npm scripts とエントリポイント**
  - `package.json` の `exports` / `bin` / `main` がビルド成果物の実体と一致しているか
  - scripts がクロスプラットフォームで動くか（シェル固有の記法、環境変数の渡し方）
  - `engines` の宣言と、使用している Node API のバージョン前提が揃っているか

