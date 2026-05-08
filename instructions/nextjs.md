# Next.js 観点

App Router (>= 14) を前提に確認してください。

## 観点

- **Server / Client Component の境界**
  - `'use client'` の範囲が広すぎないか（leaf に近い場所に置く）
  - Client Component に重い依存を import していないか
  - Server Component から Client Component に渡す props がシリアライズ可能か
  - children の合成で Server / Client を混ぜているか（Client が Server をラップしない）
- **データフェッチ**
  - Server Component で直接 `fetch` する設計になっているか
  - `fetch` の `cache` / `next.revalidate` / `next.tags` が要件に合っているか
  - 同一リクエスト内のフェッチ重複は React の `cache()` で排除されているか
  - クライアント側の重複フェッチが起きていないか
- **Server Actions**
  - `'use server'` の関数が公開境界として安全か（入力検証、認可チェック）
  - フォーム送信は `<form action>` + Server Action パターンか
  - 状態は `useActionState`、pending は `useFormStatus`、楽観的更新は `useOptimistic`
  - キャッシュ無効化は `revalidatePath` / `revalidateTag` で適切に行われているか
- **ルーティング**
  - `layout` / `template` / `loading` / `error` / `not-found` の役割が適切に分かれているか
  - 動的ルートは `generateStaticParams` で静的化を検討
  - `generateMetadata` でページごとのメタデータを返しているか
  - Parallel Routes / Intercepting Routes が必要以上に複雑になっていないか
- **レンダリング戦略**
  - Static / Dynamic / Streaming の選択が要件に合っているか
  - `dynamic = 'force-dynamic'` 等の宣言が必要最小限か
  - Suspense 境界で streaming を活用しているか
- **組み込みコンポーネント**
  - 画像は `next/image`、リンクは `next/link`、フォントは `next/font` を使用
  - `next/script` の `strategy` が適切か
- **middleware**
  - 認証や redirect だけで、重い処理を入れていないか
  - matcher が必要なパスにだけ当たっているか
- **環境変数**
  - クライアントに露出する変数は `NEXT_PUBLIC_` プレフィックスのみ
  - サーバー専用の値が誤って Client Component に流れていないか
