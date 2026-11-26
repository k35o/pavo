# React 観点

React (>= 19) のコードを、このプロンプトに添付した `practices:react` スキルの基準でレビューしてください。
スキルは書くときの基準なので、レビューでは次の手順で当てはめます。

## 進め方

- 先に `package.json` の `react` のバージョンを確認する。そのバージョンにない API（19.2 の `useEffectEvent` や `<Activity>` など）を前提にした指摘はしない
- `useMemo` / `useCallback` / `memo` の追加や削除を指摘する前に、React Compiler が有効か（`babel-plugin-react-compiler`、Next.js の `reactCompiler`、Vite のプラグイン設定）を確認する
- スキルの「書かないもの」に当たるコードが diff で追加されていたら指摘する。diff が触っていない既存コードの同種のパターンは指摘しない

## 指摘の重さの目安

- 🟡: 描画中の副作用、`useEffect` で派生 state を計算して余分な描画やちらつきを生む実装、index などの不安定な `key` による state の取り違え、Server Component から Client Component へ渡すシリアライズできない props、cleanup のない購読やタイマー
- 🔵: 現行の API で短く書ける箇所（`forwardRef` を ref prop に、`<Context.Provider>` を `<Context>` に、`useEffect` + `setState` をイベントハンドラや `key` に置き換える）
