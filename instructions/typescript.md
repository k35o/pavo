# TypeScript 観点

型設計と TypeScript イディオム全般に関わる観点。フロントエンド / バックエンドを問わず適用できる。
古い慣習（`any` での逃げ、型アサーション頼み、数値 `enum`）は積極的に指摘する。

## 観点

- **型の抜け穴 (`any` / `as` / `!`)**
  - 新たに書かれた `any` は `unknown` + 絞り込みで書き直せないか
  - `as` アサーションは型ガード・`satisfies`・上流の型修正で消せないか（`as unknown as T` の二段アサーションは設計の歪みのサイン）
  - `!`（non-null assertion）の根拠が同じスコープ内で実際に保証されているか
  - `@ts-expect-error` は抑制ではなく原因の修正で解消できないか。残す場合も抑制範囲が最小か
  - `Function` 型や `(...args: any[]) => void` でシグネチャ検査を放棄せず、実際の呼び出し形に合った関数型を書けないか
  - tsconfig の `strict` や `noUncheckedIndexedAccess` 等の検査オプションを緩める変更が紛れ込んでいないか
- **ユニオン型と網羅性**
  - 状態を boolean の組み合わせではなく判別可能ユニオン（discriminated union）で表現しているか
  - ユニオンを分岐する `switch` に網羅性検査（`default` で `never` へ代入、または `satisfies never`）があり、ケース追加漏れをコンパイルエラーにできるか
  - 型注釈やアサーションの代わりに `satisfies` で「検査しつつ推論を保つ」形にできないか
  - 不正な状態が型として表現できてしまっていないか（例: `data` と `error` が同時に存在しうる型）
- **unknown と型ガード**
  - 外部境界（API レスポンス、`JSON.parse`、環境変数）の値を `unknown` として受け、検証してから使っているか
  - ランタイム検証（zod / valibot 等のスキーマ）と静的型が一致しているか（`as T` で信用していないか）
  - ユーザー定義型ガード（`is`）の実装が、宣言した型を実際に保証する判定になっているか
- **null / undefined**
  - optional chaining の連鎖（`a?.b?.c?.d`）が「本来 null になり得ない」構造の歪みを覆い隠していないか
  - `||` のフォールバックで `0` や `''` などの有効な falsy 値が意図せず潰れないか（nullish だけを埋めたいなら `??`）
  - 「値がない」の表現が `undefined` / `null` / 空配列で無秩序に混在していないか
  - `Record<string, T>` の index アクセス結果を存在チェックなしで使っていないか
- **公開 API の型**
  - export する関数の戻り値が推論任せで、内部実装の型が公開 API に漏れていないか（境界では戻り値型の明示を検討）
  - 引数は必要十分に広く、戻り値は必要十分に狭いか（`string` で足りる引数に具体型を要求する、`unknown` に近い広い型を返す等）
  - 呼び出し側で毎回絞り込みが必要になる型を返していないか
- **immutability**
  - 変更しない配列・オブジェクトを `readonly` / `Readonly<T>` / `as const` で表明しているか
  - 受け取った引数を mutate していないか（`sort` / `reverse` / `splice` は `toSorted` / `toReversed` / `toSpliced` を検討）
- **ジェネリクス**
  - 1 箇所でしか現れない型パラメータはないか（具体型やユニオンで十分でないか）
  - 同じ構造の型を複数コピペしておりジェネリクスで統一すべき箇所はないか
  - `extends` 制約が緩すぎて実装内に `as` が必要になっていないか。逆に狭すぎて呼び出し側を不要に縛っていないか
- **enum vs union**
  - 新規の `enum` はリテラルユニオン（+ 必要なら `as const` オブジェクト）で代替できないか（特に数値 enum は避ける）
  - `const enum` を使っていないか（isolatedModules 前提のビルドと相性が悪い）
- **utility type**
  - 既存の型から導出できるものを手書きで複製していないか（`Pick` / `Omit` / `Partial` / `Parameters` / `ReturnType` 等）
  - 型の source of truth が 1 箇所に保たれているか（スキーマや定数からの `typeof` 導出を含む）

