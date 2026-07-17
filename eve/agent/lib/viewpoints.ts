// Review viewpoints, ported from instructions/*.md (the Actions
// incarnation). Injected deterministically per repository by the GitHub
// channel — not model-discovered skills — so coverage does not depend on
// the model choosing to load them.

export const VIEWPOINT_DEPS: Record<string, string[]> = {"default": [], "frontend": [], "react": ["frontend"], "nextjs": ["frontend", "react"], "typescript": [], "node": ["typescript"], "github-actions": []};

export const VIEWPOINTS: Record<string, string> = {
  "default": `
# デフォルトのレビュー観点

プロンプト冒頭の「レビューの進め方」と組み合わせて、以下の観点を確認してください。

## 観点

- **バグや不具合**: ロジックエラー、境界条件、null/undefined の扱い、型不整合、async/await の漏れ
- **可読性・保守性**: 命名、関数分割、重複、過度な抽象化、責務の混在
- **テスト**: 変更に対するテストが足りているか、既存テストへの影響、エッジケース
- **ドキュメント**: 公開 API・behavior の変更にドキュメント更新が必要か
- **PR description との整合**: description が宣言している変更が実装されているか、宣言されていない大きな変更が紛れ込んでいないか

## セキュリティ

セキュリティ問題は 🔴 Critical 候補。確信が持てる場合のみ報告する。

- **入力検証**: ユーザー入力や外部 API レスポンスを信頼していないか
- **認証・認可**: 認証チェックの漏れ、権限昇格の可能性
- **機密情報**: シークレット、API キー、個人情報のログ出力・クライアント露出
- **インジェクション**: SQL / コマンド / HTML / プロンプトインジェクションの可能性
- **依存関係**: 新規追加された依存にセキュリティ上の懸念がないか
- **HTTPS / CORS**: 通信経路と同一生成元ポリシーの扱い
`,
  "frontend": `
# フロントエンド観点

ブラウザで動く UI 全般に関わる観点。フレームワークを問わず適用できる。

## 観点

- **アクセシビリティ (a11y)**
  - セマンティック HTML を使っているか（\`<button>\`, \`<a>\`, \`<nav>\`, \`<main>\`, \`<dialog>\` 等）
  - ARIA は補助であり、ネイティブ要素を優先しているか
  - キーボードのみで操作完結できるか（focus 順序、\`:focus-visible\`、focus trap）
  - 画像の \`alt\`、フォームの \`label\`、見出しの階層が論理的か
  - 色のみに頼らず、コントラスト比 4.5:1 以上を確保しているか
  - 動的更新は \`aria-live\` 等で支援技術に伝わるか
- **フォーム**
  - ネイティブの validation 属性 (\`required\`, \`type\`, \`pattern\`, \`min\`/\`max\`) を活用しているか
  - エラーメッセージが該当フィールドに \`aria-describedby\` 等で紐づいているか
  - submit 時の二重送信防止と pending 表示があるか
- **パフォーマンス**
  - 画像は適切なフォーマット (AVIF / WebP)、\`loading="lazy"\`、\`width\`/\`height\` 指定があるか
  - クリティカル JS / CSS が肥大化していないか
  - 大きな依存は dynamic import で必要時に遅延読み込みできているか
  - レイアウトシフト (CLS) を防ぐスペース予約があるか
- **国際化 / 文字**
  - ハードコード文字列が翻訳可能な構造になっているか
  - 日付・数値・通貨は \`Intl\` 系 API で整形しているか
  - 文字方向 (RTL) の前提が壊れていないか
- **エラー UX**
  - ローディング・空状態・失敗状態がそれぞれ用意されているか
  - 楽観的更新の失敗時にロールバックできるか
- **クライアント状態**
  - URL に持たせるべき状態 (フィルタ、タブ、ページング) が State に閉じ込められていないか
  - \`localStorage\` 等の永続化キーに命名規則・バージョン互換が考慮されているか
- **互換性**
  - サポート対象ブラウザで動く API を使っているか
  - polyfill は必要な箇所だけに限定されているか
`,
  "react": `
# React 観点

React (>= 19) のモダンな書き方に沿っているか確認してください。
古い慣習（過剰な \`useEffect\`、\`forwardRef\`、\`useMemo\` 乱用）は積極的に指摘する。

## 観点

- **\`useEffect\` の濫用を疑う**
  - 派生 state を \`useEffect\` + \`setState\` で計算していないか → 描画中の計算 or \`useMemo\`
  - イベントへの応答を \`useEffect\` で書いていないか → イベントハンドラに直接書く
  - props 変化に応じた state リセットを \`useEffect\` で書いていないか → \`key\` を変えてリセット
  - 親→子 への state 同期を \`useEffect\` で行っていないか → lifting up
  - 外部ストアの購読は \`useSyncExternalStore\` を検討
  - \`useEffect\` が必要なのは「外部システムとの同期」のみという前提で読む
- **Concurrent Mode 対応**
  - 重い更新は \`startTransition\` / \`useDeferredValue\` で分離されているか
  - Suspense 境界が適切に設置されているか（データ・コンポーネント単位）
  - データフェッチは Promise を投げて \`use()\` で受ける形を検討
- **React 19 の新機能**
  - フォーム送信は \`<form action>\` + Server Action / \`useActionState\`
  - 楽観的更新は \`useOptimistic\`
  - フォーム状態は \`useFormStatus\`
  - \`forwardRef\` は不要、ref を通常の prop として受け取る
  - context は \`<Context value={...}>\` 直接で Provider として使う
  - \`<title>\` \`<meta>\` \`<link>\` をコンポーネント内に直接書ける
- **Hook の使い分け**
  - 描画間で値を保持するだけで再描画不要なら \`useState\` ではなく \`useRef\`
  - 計算結果のキャッシュは \`useMemo\`、関数のキャッシュは \`useCallback\`（過剰使用は逆効果）
  - 状態の初期化が重い場合は \`useState(() => ...)\` で遅延初期化
  - \`useMemo\` を使う前に「子コンポーネントの memo 化や props 構造の見直し」で済まないか
- **render 安定性**
  - リストの \`key\` が安定しているか（index は最後の手段）
  - render 中に副作用（\`setState\`、外部 mutate、Date.now 等の非決定値）がないか
  - StrictMode で 2 度実行されても安全か（init/cleanup の対称性）
- **コンポーネント設計**
  - ロジックは custom hook に切り出されているか
  - props drilling は context や composition で解消されているか
  - children パターンを活用して再利用しやすい構造にしているか
  - 1 コンポーネントが多すぎる責務を持っていないか
`,
  "nextjs": `
# Next.js 観点

App Router (>= 14) を前提に確認してください。

## 観点

- **Server / Client Component の境界**
  - \`'use client'\` の範囲が広すぎないか（leaf に近い場所に置く）
  - Client Component に重い依存を import していないか
  - Server Component から Client Component に渡す props がシリアライズ可能か
  - children の合成で Server / Client を混ぜているか（Client が Server をラップしない）
- **データフェッチ**
  - Server Component で直接 \`fetch\` する設計になっているか
  - \`fetch\` の \`cache\` / \`next.revalidate\` / \`next.tags\` が要件に合っているか
  - 同一リクエスト内のフェッチ重複は React の \`cache()\` で排除されているか
  - クライアント側の重複フェッチが起きていないか
- **Server Actions**
  - \`'use server'\` の関数が公開境界として安全か（入力検証、認可チェック）
  - フォーム送信は \`<form action>\` + Server Action パターンか
  - 状態は \`useActionState\`、pending は \`useFormStatus\`、楽観的更新は \`useOptimistic\`
  - キャッシュ無効化は \`revalidatePath\` / \`revalidateTag\` で適切に行われているか
- **ルーティング**
  - \`layout\` / \`template\` / \`loading\` / \`error\` / \`not-found\` の役割が適切に分かれているか
  - 動的ルートは \`generateStaticParams\` で静的化を検討
  - \`generateMetadata\` でページごとのメタデータを返しているか
  - Parallel Routes / Intercepting Routes が必要以上に複雑になっていないか
- **レンダリング戦略**
  - Static / Dynamic / Streaming の選択が要件に合っているか
  - \`dynamic = 'force-dynamic'\` 等の宣言が必要最小限か
  - Suspense 境界で streaming を活用しているか
- **組み込みコンポーネント**
  - 画像は \`next/image\`、リンクは \`next/link\`、フォントは \`next/font\` を使用
  - \`next/script\` の \`strategy\` が適切か
- **middleware**
  - 認証や redirect だけで、重い処理を入れていないか
  - matcher が必要なパスにだけ当たっているか
- **環境変数**
  - クライアントに露出する変数は \`NEXT_PUBLIC_\` プレフィックスのみ
  - サーバー専用の値が誤って Client Component に流れていないか
`,
  "typescript": `
# TypeScript 観点

型設計と TypeScript イディオム全般に関わる観点。フロントエンド / バックエンドを問わず適用できる。
古い慣習（\`any\` での逃げ、型アサーション頼み、数値 \`enum\`）は積極的に指摘する。

## 観点

- **型の抜け穴 (\`any\` / \`as\` / \`!\`)**
  - 新たに書かれた \`any\` は \`unknown\` + 絞り込みで書き直せないか
  - \`as\` アサーションは型ガード・\`satisfies\`・上流の型修正で消せないか（\`as unknown as T\` の二段アサーションは設計の歪みのサイン）
  - \`!\`（non-null assertion）の根拠が同じスコープ内で実際に保証されているか
  - \`@ts-expect-error\` は抑制ではなく原因の修正で解消できないか。残す場合も抑制範囲が最小か
  - \`Function\` 型や \`(...args: any[]) => void\` でシグネチャ検査を放棄せず、実際の呼び出し形に合った関数型を書けないか
  - tsconfig の \`strict\` や \`noUncheckedIndexedAccess\` 等の検査オプションを緩める変更が紛れ込んでいないか
- **ユニオン型と網羅性**
  - 状態を boolean の組み合わせではなく判別可能ユニオン（discriminated union）で表現しているか
  - ユニオンを分岐する \`switch\` に網羅性検査（\`default\` で \`never\` へ代入、または \`satisfies never\`）があり、ケース追加漏れをコンパイルエラーにできるか
  - 型注釈やアサーションの代わりに \`satisfies\` で「検査しつつ推論を保つ」形にできないか
  - 不正な状態が型として表現できてしまっていないか（例: \`data\` と \`error\` が同時に存在しうる型）
- **unknown と型ガード**
  - 外部境界（API レスポンス、\`JSON.parse\`、環境変数）の値を \`unknown\` として受け、検証してから使っているか
  - ランタイム検証（zod / valibot 等のスキーマ）と静的型が一致しているか（\`as T\` で信用していないか）
  - ユーザー定義型ガード（\`is\`）の実装が、宣言した型を実際に保証する判定になっているか
- **null / undefined**
  - optional chaining の連鎖（\`a?.b?.c?.d\`）が「本来 null になり得ない」構造の歪みを覆い隠していないか
  - \`||\` のフォールバックで \`0\` や \`''\` などの有効な falsy 値が意図せず潰れないか（nullish だけを埋めたいなら \`??\`）
  - 「値がない」の表現が \`undefined\` / \`null\` / 空配列で無秩序に混在していないか
  - \`Record<string, T>\` の index アクセス結果を存在チェックなしで使っていないか
- **公開 API の型**
  - export する関数の戻り値が推論任せで、内部実装の型が公開 API に漏れていないか（境界では戻り値型の明示を検討）
  - 引数は必要十分に広く、戻り値は必要十分に狭いか（\`string\` で足りる引数に具体型を要求する、\`unknown\` に近い広い型を返す等）
  - 呼び出し側で毎回絞り込みが必要になる型を返していないか
- **immutability**
  - 変更しない配列・オブジェクトを \`readonly\` / \`Readonly<T>\` / \`as const\` で表明しているか
  - 受け取った引数を mutate していないか（\`sort\` / \`reverse\` / \`splice\` は \`toSorted\` / \`toReversed\` / \`toSpliced\` を検討）
- **ジェネリクス**
  - 1 箇所でしか現れない型パラメータはないか（具体型やユニオンで十分でないか）
  - 同じ構造の型を複数コピペしておりジェネリクスで統一すべき箇所はないか
  - \`extends\` 制約が緩すぎて実装内に \`as\` が必要になっていないか。逆に狭すぎて呼び出し側を不要に縛っていないか
- **enum vs union**
  - 新規の \`enum\` はリテラルユニオン（+ 必要なら \`as const\` オブジェクト）で代替できないか（特に数値 enum は避ける）
  - \`const enum\` を使っていないか（isolatedModules 前提のビルドと相性が悪い）
- **utility type**
  - 既存の型から導出できるものを手書きで複製していないか（\`Pick\` / \`Omit\` / \`Partial\` / \`Parameters\` / \`ReturnType\` 等）
  - 型の source of truth が 1 箇所に保たれているか（スキーマや定数からの \`typeof\` 導出を含む）

`,
  "node": `
# Node.js 観点

Node.js (>= 20) で動くサーバー・CLI・スクリプトに関わる観点。
古い慣習（callback スタイル、標準モジュールで代替できる定番パッケージ）は積極的に指摘する。

## 観点

- **モジュールと import**
  - ESM / CJS の境界を越える箇所で解釈違いが起きていないか（CJS の \`require\` で ESM を読む、\`default\` export の二重ラップ）
  - ESM で \`__dirname\` / \`__filename\` を前提にしていないか → \`import.meta.dirname\` / \`import.meta.filename\`
- **async の落とし穴**
  - 投げっぱなしの Promise（\`await\` も \`.catch()\` もない呼び出し）が unhandled rejection にならないか
  - 依存関係のない \`await\` が直列に並んでいないか → \`Promise.all\` で並行化
  - 一部の失敗を許容すべき箇所で \`Promise.all\` を使っていないか → \`Promise.allSettled\`
  - \`forEach\` / \`map\` に async 関数を渡して、完了を待たずに次へ進んでいないか
- **stream とメモリ**
  - 大きなファイルやレスポンスを \`readFile\` 等で全量メモリに載せていないか → stream で処理
  - stream の連結はエラーが伝播しない \`pipe\` ではなく \`node:stream/promises\` の \`pipeline\` を使っているか
  - backpressure を無視して \`write\` を繰り返していないか → \`drain\` を待つか \`pipeline\` に寄せる
- **child_process**
  - 外部入力が混ざるコマンド実行に \`exec\` や \`shell: true\` を使っていないか → \`execFile\` / \`spawn\` に引数配列で渡す
  - 子プロセスの終了コードと stderr を確認しているか
- **環境変数と設定**
  - \`process.env\` の参照が起動時に検証・集約されているか（利用箇所に散らばっていないか）
  - 必須の環境変数が欠けたとき、起動時に明確なエラーで落ちるか
  - シークレットを子プロセスの引数に載せていないか（\`ps\` で他プロセスから見える）→ 環境変数か stdin で渡す
- **プロセスのライフサイクル**
  - サーバーは SIGTERM / SIGINT で graceful shutdown しているか（新規受付停止 → 処理中の完了 → リソース解放）
  - \`process.exit()\` の即時呼び出しで、書き込みやフラッシュ中の処理を打ち切っていないか
  - \`uncaughtException\` を握りつぶして処理を続行していないか（ログ後に終了が原則）
- **パスと fs**
  - パスの結合を文字列連結でしていないか → \`path.join\` / \`path.resolve\` / \`new URL(..., import.meta.url)\`
  - \`process.cwd()\` 依存の相対パスがエントリポイント以外に紛れ込んでいないか
  - サーバーのリクエスト処理内で \`*Sync\` 系 fs API を使っていないか（CLI・起動時の初期化は許容）
  - 外部入力からパスを組み立てる箇所で path traversal を考慮しているか
- **依存追加の妥当性**
  - 標準機能で足りるものに依存を追加していないか（\`fetch\`, \`node:test\`, \`util.parseArgs\`, \`util.styleText\`, \`--env-file\` 等）
  - 標準 API で代替できるパッケージ（\`mkdirp\` → \`fs.mkdir\` の \`recursive\`、\`rimraf\` → \`fs.rm\`）や、メンテが止まったパッケージ（\`request\` 等）を新規に持ち込んでいないか
- **npm scripts とエントリポイント**
  - \`package.json\` の \`exports\` / \`bin\` / \`main\` がビルド成果物の実体と一致しているか
  - scripts がクロスプラットフォームで動くか（シェル固有の記法、環境変数の渡し方）
  - \`engines\` の宣言と、使用している Node API のバージョン前提が揃っているか

`,
  "github-actions": `
# GitHub Actions 観点

Workflow YAML・composite action・CI 用シェルスクリプトに関わる観点。
非推奨の \`::set-output\` / \`::set-env\` やタグ参照のままのサードパーティ action など、古い慣習は積極的に指摘する。

## 観点

- **Script injection**
  - \`\${{ }}\` の式を \`run:\` のシェルへ直接埋め込んでいないか（PR タイトル・本文・ブランチ名・コミットメッセージ等の \`github.event.*\` は攻撃者が制御できる）
  - 信頼できない値は \`env:\` で環境変数に渡し、シェル内では \`"$VAR"\` として参照しているか
  - \`actions/github-script\` や composite action の \`inputs\` に渡した値が、その先で式やシェルに再展開されていないか
- **危険なトリガー**
  - \`pull_request_target\` / \`workflow_run\` で fork 由来のコード（PR head の checkout、そのビルドスクリプトの実行）を secrets・write 権限と同居させていないか
  - \`workflow_run\` で前段 workflow の artifact や head ref を無検証に信頼していないか
  - ラベル付与やコメントコマンドを実行条件にする場合、それを発火できる人の権限を確認しているか
- **\`permissions\` の最小化**
  - トップレベルは \`permissions: {}\` か read のみに絞り、書き込みが必要な job だけに個別付与しているか
  - \`GITHUB_TOKEN\` に用途を超えた \`contents: write\` / \`pull-requests: write\` 等が付いていないか
  - PAT や App トークンを、より権限の弱い \`GITHUB_TOKEN\` で置き換えられないか
- **secrets の扱い**
  - secrets がログに出うる経路がないか（\`echo\`・デバッグ出力・エラーメッセージ・\`set -x\` 経由）
  - 自動マスクが値の完全一致に依存することを考慮しているか（JSON 等の構造化データを secret として登録した場合や、base64 等で加工した値を出力した場合はマスクされない）
  - fork からの PR で実行されるパスに secrets が流れていないか（\`pull_request\` では渡らない前提が崩れていないか）
- **サプライチェーン**
  - サードパーティ action を full-length SHA でピンし、バージョンをコメントで併記しているか（タグ・ブランチ参照は後から書き換え可能）
  - キャッシュキーに信頼できない入力が混ざり、汚染されたキャッシュが信頼される job に流入する余地がないか
  - \`actions/checkout\` は push が不要な job で \`persist-credentials: false\` にしているか
- **シェルの堅牢性**
  - \`shell: bash\` を明示しているか（暗黙のデフォルトは \`pipefail\` なしで pipe の失敗を握りつぶす）
  - スクリプトファイル側には \`set -euo pipefail\` 相当の保護があるか
  - 変数展開のクォート漏れや、複数行・任意文字列の受け渡しで heredoc を使わず壊れる箇所がないか
  - 複雑になったインラインスクリプトはファイルに切り出して単体で実行・テストできる形にしているか
- **\`GITHUB_OUTPUT\` / \`GITHUB_ENV\` への書き込み**
  - 複数行や任意文字列を書き込むとき、値と衝突しないデリミタの heredoc 形式を使っているか
  - 信頼できない値を \`GITHUB_ENV\` に書くと後続 step への injection になりうることを考慮しているか
- **実行制御**
  - すべての job に \`timeout-minutes\` が設定されているか（デフォルトの 360 分は事故時に高くつく）
  - \`concurrency\` の group 設計と \`cancel-in-progress\` が用途に合っているか（PR の CI はキャンセルしてよいが、デプロイの途中キャンセルは危険）
  - \`if:\` 条件が前提とするイベントと実際のトリガーが一致しているか（\`github.event\` の構造はイベントごとに異なり、存在しないフィールドは黙って空になる）
  - matrix の \`fail-fast\` が意図と合っているか（全組み合わせの結果が欲しいのに途中で止めていないか）

`,
};

/** Resolve names + dependencies into ordered, de-duplicated viewpoint bodies. */
export function resolveViewpoints(requested: string): string[] {
  const seen = new Set<string>();
  const bodies: string[] = [];
  const visit = (raw: string, stack: string[]): void => {
    const name = raw.trim();
    if (!name || seen.has(name)) return;
    if (stack.includes(name)) {
      throw new Error(`Circular viewpoint dependency: ${[...stack, name].join(' -> ')}`);
    }
    if (!(name in VIEWPOINTS)) {
      throw new Error(`Unknown viewpoint: ${name} (known: ${Object.keys(VIEWPOINTS).join(', ')})`);
    }
    for (const dep of VIEWPOINT_DEPS[name] ?? []) visit(dep, [...stack, name]);
    seen.add(name);
    bodies.push(VIEWPOINTS[name] ?? '');
  };
  for (const raw of requested.split(',')) visit(raw, []);
  return bodies;
}
