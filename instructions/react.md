# React 観点

React (>= 19) のモダンな書き方に沿っているか確認してください。
古い慣習（過剰な `useEffect`、`forwardRef`、`useMemo` 乱用）は積極的に指摘する。

## 観点

- **`useEffect` の濫用を疑う**
  - 派生 state を `useEffect` + `setState` で計算していないか → 描画中の計算 or `useMemo`
  - イベントへの応答を `useEffect` で書いていないか → イベントハンドラに直接書く
  - props 変化に応じた state リセットを `useEffect` で書いていないか → `key` を変えてリセット
  - 親→子 への state 同期を `useEffect` で行っていないか → lifting up
  - 外部ストアの購読は `useSyncExternalStore` を検討
  - `useEffect` が必要なのは「外部システムとの同期」のみという前提で読む
- **Concurrent Mode 対応**
  - 重い更新は `startTransition` / `useDeferredValue` で分離されているか
  - Suspense 境界が適切に設置されているか（データ・コンポーネント単位）
  - データフェッチは Promise を投げて `use()` で受ける形を検討
- **React 19 の新機能**
  - フォーム送信は `<form action>` + Server Action / `useActionState`
  - 楽観的更新は `useOptimistic`
  - フォーム状態は `useFormStatus`
  - `forwardRef` は不要、ref を通常の prop として受け取る
  - context は `<Context value={...}>` 直接で Provider として使う
  - `<title>` `<meta>` `<link>` をコンポーネント内に直接書ける
- **Hook の使い分け**
  - 描画間で値を保持するだけで再描画不要なら `useState` ではなく `useRef`
  - 計算結果のキャッシュは `useMemo`、関数のキャッシュは `useCallback`（過剰使用は逆効果）
  - 状態の初期化が重い場合は `useState(() => ...)` で遅延初期化
  - `useMemo` を使う前に「子コンポーネントの memo 化や props 構造の見直し」で済まないか
- **render 安定性**
  - リストの `key` が安定しているか（index は最後の手段）
  - render 中に副作用（`setState`、外部 mutate、Date.now 等の非決定値）がないか
  - StrictMode で 2 度実行されても安全か（init/cleanup の対称性）
- **コンポーネント設計**
  - ロジックは custom hook に切り出されているか
  - props drilling は context や composition で解消されているか
  - children パターンを活用して再利用しやすい構造にしているか
  - 1 コンポーネントが多すぎる責務を持っていないか
