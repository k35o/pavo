# Next.js 観点

App Router を前提に確認してください。先に `package.json` の `next` のバージョンと `next.config` の設定
（`cacheComponents`、`reactCompiler` など）を確認し、そのバージョンにない機能を前提にした指摘はしない。
Next.js 16 で名前や挙動が変わったもの（`middleware` → `proxy`、同期的な request API の廃止）は積極的に指摘する。

## 観点

- **Server / Client Component の境界**
  - `'use client'` の範囲が広すぎないか（leaf に近い場所に置く）
  - Client Component に重い依存を import していないか
  - Server Component から Client Component に渡す props がシリアライズ可能か
  - children の合成で Server / Client を混ぜているか（Client が Server をラップしない）
  - サーバー専用のモジュール（DB クライアント、シークレットを読むコード）に `import 'server-only'` があるか
- **request API**
  - `params` / `searchParams` / `cookies()` / `headers()` / `draftMode()` を `await` して使っているか（16 で同期アクセスは削除）
  - 型を `PageProps<'/path'>` / `LayoutProps<'/path'>` などの生成型で受けているか
- **キャッシュとデータフェッチ**
  - `cacheComponents` が有効なプロジェクトでは、キャッシュしたい処理を `'use cache'` で明示し、`cacheLife` / `cacheTag` を付けているか。動的な値（`cookies()` など）を読む部分が `<Suspense>` の内側にあるか
  - `cacheComponents` が無効なプロジェクトでは、`fetch` は既定でキャッシュされない（15 以降）前提で、`cache` / `next.revalidate` / `next.tags` を要件どおりに指定しているか
  - Server Function の中で自分が書いた値を直後に読ませたいときは `updateTag`、裏で再検証すればよいときは `revalidateTag(tag, profile)` を使っているか（16 では第 2 引数に cacheLife のプロファイルを渡し、1 引数の形は非推奨）
  - 同一リクエスト内のフェッチ重複は React の `cache()` で排除されているか
  - レスポンス後でよい処理（ログ、計測）を `after()` に逃がせないか
- **Server Functions（Server Actions）**
  - `'use server'` の関数が公開エンドポイントとして安全か（入力検証、認可チェック）。export しただけで外部から呼べる前提で読む
  - フォーム送信は `<form action>` + Server Function、状態は `useActionState`、pending は `useFormStatus`、楽観的更新は `useOptimistic`
- **ルーティング**
  - `layout` / `template` / `loading` / `error` / `not-found` の役割が適切に分かれているか
  - Parallel Routes の各スロットに `default.js` があるか（16 では無いとビルドが失敗する）
  - 動的ルートは `generateStaticParams` で静的化を検討
  - `generateMetadata` でページごとのメタデータを返しているか
- **proxy（旧 middleware）**
  - 16 では `middleware.ts` ではなく `proxy.ts`（export する関数も `proxy`）で書かれているか
  - 認証の確認や redirect だけにとどめ、重い処理やデータ取得を入れていないか。認可はページや Server Function 側でも確認しているか
  - `matcher` が必要なパスにだけ当たっているか
- **組み込みコンポーネント**
  - 画像は `next/image`、リンクは `next/link`、フォントは `next/font` を使用
  - LCP になる画像に `preload`（15 までは `priority`）が付いているか
  - `next/script` の `strategy` が適切か
- **環境変数**
  - クライアントに露出する変数は `NEXT_PUBLIC_` プレフィックスのみ
  - サーバー専用の値が誤って Client Component に流れていないか
