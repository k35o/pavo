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
  - tsconfig の検査を緩める変更（`"strict": false` の追加、`noUncheckedIndexedAccess` を外すなど）が紛れ込んでいないか。6.0 から `strict` は既定で有効なので、`"strict": true` を消すだけなら緩和ではない
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
- **enum vs union と型だけで消える構文**
  - 新規の `enum` はリテラルユニオン（+ 必要なら `as const` オブジェクト）で代替できないか（特に数値 enum は避ける）
  - `const enum` を使っていないか（isolatedModules 前提のビルドと相性が悪い）
  - tsconfig に `erasableSyntaxOnly` があるプロジェクト（Node の type stripping で `.ts` を直接動かすもの）で、型を消すだけでは JS にならない構文（`enum`、ランタイムのコードを持つ `namespace` / `module`、コンストラクタの parameter properties、`import =` / `export =`、`<T>x` 形式の型アサーション）を足していないか。型だけの `namespace` は対象外
  - `verbatimModuleSyntax` が有効なら、型だけの import / export に `import type` / `export type` を使っているか
- **tsconfig と TypeScript のバージョン**（先に `package.json` の `typescript` のバージョンを確認する）
  - 6.0 で削除されたもの（`outFile`、`moduleResolution: "classic"`、`module` の `amd` / `umd` / `system` / `none`、`/// <reference no-default-lib="true"/>`）を使っていないか
  - 6.0 で非推奨になり 7.0 で削除されたもの（`baseUrl`、`moduleResolution: "node"`（node10）、`target: "es5"`、`downlevelIteration`）を使っていないか。`"ignoreDeprecations": "6.0"` で警告を黙らせただけの変更は、7.0 に上げると壊れる
  - 6.0 から `false` にできなくなった `esModuleInterop` / `allowSyntheticDefaultImports` / `alwaysStrict` を `false` にしていないか。`module Foo {}` は `namespace Foo {}`、`import … assert {}` は `with {}` に書き換えているか（7.0 では使えない）
  - 6.0 で既定が変わり、設定を書かないと壊れる箇所を手当てしているか
    - `types` の既定が `[]` になった。`process` や `describe` などのグローバル型を使うなら `"types": ["node", …]` を明示する
    - `rootDir` の既定が tsconfig のあるディレクトリになった。tsconfig が `src` の外にあると出力が `dist/src/…` にずれるので、`rootDir` を明示する
    - `noUncheckedSideEffectImports` が既定で有効になった。`import './x.css'` のような副作用 import に型宣言があるか
  - tsconfig のあるディレクトリで `tsc a.ts` のようにファイルを渡す scripts（lint-staged など）は、6.0 から TS5112 のエラーになる。`--ignoreConfig` を付けているか
  - `typescript` を 7 に上げる PR では、コンパイラの API を使うツール（typescript-eslint など）が動くか。7.0 は API を同梱しないので、そうしたツールのために `@typescript/typescript6`（実行ファイルは `tsc6`）を並べて入れる。Vue / Astro / Svelte / MDX などテンプレートの型検査も 7.0 では動かない
  - `checkJs` で JS を検査しているリポジトリでは、7.0 で JSDoc の解釈が変わる（`@enum` は特別扱いされない、Closure 形式の関数型は書けない）
  - `paths` を `baseUrl` なしで解決できる相対パスで書いているか、Node の subpath imports（`package.json` の `imports` と `#` 始まりの指定子。`#/` 始まりは 6.0 から `nodenext` / `bundler` で解決できる）で置き換えられないか
- **リソースの後始末**
  - ファイルハンドル、ロック、一時ディレクトリなど、確実に閉じたいリソースを `try` / `finally` で手書きしている箇所は `using` / `await using`（`Symbol.dispose` / `Symbol.asyncDispose`）で書けないか。実行環境（Node 24 以降、対応ブラウザ）が `using` を扱えるか合わせて確認する
- **utility type**
  - 既存の型から導出できるものを手書きで複製していないか（`Pick` / `Omit` / `Partial` / `Parameters` / `ReturnType` 等）
  - 型の source of truth が 1 箇所に保たれているか（スキーマや定数からの `typeof` 導出を含む）

