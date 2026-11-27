# Next.js 観点

App Router を前提に確認してください。先に `package.json` の `next` のバージョンと `next.config` の設定
（`cacheComponents`、`partialPrefetching`、`reactCompiler` など）を確認し、そのバージョンにない機能を前提にした指摘はしない。
Next.js 16 で名前や挙動が変わったもの（`middleware` → `proxy`、同期的な request API の廃止、`priority` → `loading="eager"`）は積極的に指摘する。
16.4 からは Cache Components が全アプリへの推奨になり、`create-next-app` でも既定で有効になっている。

## 観点

- **Server / Client Component の境界**
  - `'use client'` の範囲が広すぎないか（leaf に近い場所に置く）
  - Client Component に重い依存を import していないか
  - Server Component から Client Component に渡す props がシリアライズ可能か
  - Client Component から Server Component を import していないか。Server Component は Client Component の `children` や props として渡す
  - サーバー専用のモジュール（DB クライアント、シークレットを読むコード）に `import 'server-only'` があるか
- **request API**
  - `params` / `searchParams` / `cookies()` / `headers()` / `draftMode()` を `await` して使っているか（16 で同期アクセスは削除）。metadata の画像生成関数が受け取る `params` / `id` と、sitemap の `id` も Promise
  - 型を `PageProps<'/path'>` / `LayoutProps<'/path'>` などの生成型で受けているか
- **キャッシュとデータフェッチ（Cache Components が有効なとき）**
  - `next.config` で `cacheComponents: true` と一緒に `partialPrefetching` を明示しているか（未指定だと警告が出る。`false` は Partial Prefetching より前に Cache Components を入れたアプリの移行中だけ）
  - キャッシュしたい処理を `'use cache'` で明示し、すべての `'use cache'` のスコープで `cacheLife` を指定しているか。`cacheLife` のない外側のキャッシュに寿命の短いキャッシュを入れ子にすると、プリレンダーでエラーになる
  - 動的な値（`cookies()` など）を読む部分が `<Suspense>` の内側にあるか
  - route segment config の `dynamic` / `revalidate` / `fetchCache` / `dynamicParams` を使っていないか（Cache Components では削除済み）。静的であることを保証したいルートは `ensureStatic` を使う
  - ファイル先頭に `'use cache'` を書いたモジュールの export は、Client Component から呼ぶとサーバーで実行される。Server Function と同じく、外部から呼ばれる前提で認可を確認しているか
  - 前のルートは unmount されず `<Activity>` の hidden 状態で残る。unmount で state が消える前提のコードになっていないか
  - `'use cache'` の中では React の `cache()` が外側と分離され、外で入れた値は見えない。外側の `cache()` に頼っていないか
- **キャッシュとデータフェッチ（Cache Components が無効なとき）**
  - `fetch` は既定でキャッシュされない（15 以降）前提で、`cache` / `next.revalidate` / `next.tags` を要件どおりに指定しているか
- **キャッシュの失効**
  - Server Action の中で自分が書いた値を直後に読ませたいときは `updateTag`、裏で再検証すればよいときは `revalidateTag(tag, profile)` を使っているか。`profile` は cacheLife のプロファイル名か `{ expire }` で、1 引数の形は型エラーになる
  - `updateTag` は Server Action 専用で、Route Handler から呼ぶと例外になる。Webhook などで即座に失効させたいときは `revalidateTag(tag, { expire: 0 })` を使っているか
  - キャッシュしていないデータの更新を画面に反映するだけなら、`next/cache` の `refresh()` を使えないか
- **重複排除と後処理**
  - GET の `fetch` は同一リクエスト内で自動でメモ化される。`fetch` 以外の取得（DB、SDK）の重複は React の `cache()` で排除されているか
  - レスポンス後でよい処理（ログ、計測）を `after()` に逃がせないか
- **Server Functions（Server Actions）**
  - `'use server'` の関数が公開エンドポイントとして安全か（入力検証、認可チェック）。export しただけで外部から呼べる前提で読む
  - フォーム送信は `<form action>` + Server Function、状態は `useActionState`、pending は `useFormStatus`、楽観的更新は `useOptimistic`
- **ルーティング**
  - `layout` / `template` / `loading` / `error` / `not-found` の役割が適切に分かれているか
  - `error.js` の回復には `reset` ではなく `retry` を使っているか（16.3 から。`reset` はデータを取り直さない）。`error` を `unknown` として扱い、絞り込んでから使っているか
  - Parallel Routes の各スロット（暗黙の `children` を含む）に `default.js` があるか（16 では無いとエラーになる）
  - 動的ルートは `generateStaticParams` で静的化を検討
  - `generateMetadata` でページごとのメタデータを返しているか
- **proxy（旧 middleware）**
  - 16 では `middleware.ts` ではなく `proxy.ts`（default export か、名前付きの `proxy`）で書かれているか。設定の `skipMiddlewareUrlNormalize` も `skipProxyUrlNormalize` に変わっている
  - proxy は Node.js ランタイム固定で、`runtime` を書くと例外になる。Edge ランタイムが必要な middleware を機械的に `proxy.ts` へ改名していないか（その場合は非推奨の `middleware.ts` のまま残す）
  - proxy の中で `'use cache'` / `cacheLife` / `cacheTag` / `revalidateTag` を使っていないか（効かないか例外になる）
  - 認証の確認や redirect だけにとどめ、重い処理やデータ取得を入れていないか。認可はページや Server Function 側でも確認しているか
  - `matcher` が必要なパスにだけ当たっているか
- **組み込みコンポーネント**
  - 画像は `next/image`、リンクは `next/link`、フォントは `next/font` を使用
  - LCP になる画像は `loading="eager"`（必要なら `fetchPriority="high"` を足す）で遅延読み込みを外しているか。`priority` は 16 で非推奨。`preload` は LCP の画像が viewport によらず 1 枚に決まるときだけで、`loading` / `fetchPriority` とは併用しない
  - `next/script` の `strategy` が適切か
- **設定**
  - `next.config` に削除済みの experimental フラグ（`experimental.viewTransition`、`experimental.appNewScrollHandler` など）が残っていないか
  - `serverExternalPackages` は 16.1 から間接依存にも効く。間接依存を `package.json` に足すだけの回避策が新たに入っていないか
- **環境変数**
  - クライアントに露出する変数は `NEXT_PUBLIC_` プレフィックスのみ
  - サーバー専用の値が誤って Client Component に流れていないか
