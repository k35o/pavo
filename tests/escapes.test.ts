import assert from 'node:assert/strict';
import test from 'node:test';

import { repairLiteralEscapes } from '../scripts/lib/escapes.ts';

test('本物の改行が1つも無い文字列は、literal \\n / \\t を本物の文字に戻す', () => {
  const output = repairLiteralEscapes({
    summary: '## TL;DR\\n指摘なし\\n\\n- 観点A\\n- 観点B',
    verdict: 'approve',
    comments: [
      { path: 'src/a.ts', line: 2, body: '前段\\n後段', suggestion: 'if (a) {\\n\\treturn b;\\n}' },
    ],
  });
  assert.equal(output.summary, '## TL;DR\n指摘なし\n\n- 観点A\n- 観点B');
  assert.equal(output.verdict, 'approve');
  assert.equal(output.comments[0]!.body, '前段\n後段');
  assert.equal(output.comments[0]!.suggestion, 'if (a) {\n\treturn b;\n}');
});

test('他のフィールドに本物の改行があっても、summary だけがエスケープされていれば summary を直す', () => {
  const output = repairLiteralEscapes({
    summary: '指摘 1 件\\n\\n- `src/a.ts:2` — null チェック漏れ',
    comments: [{ body: 'null チェックが漏れています。\n\n呼び出し元を確認しました。' }],
  });
  assert.equal(output.summary, '指摘 1 件\n\n- `src/a.ts:2` — null チェック漏れ');
  assert.equal(output.comments[0]!.body, 'null チェックが漏れています。\n\n呼び出し元を確認しました。');
});

test('本物の改行がある文字列の literal \\n はテキストとして残す', () => {
  const output = {
    summary: '## TL;DR\n改行は `\\n` と書きます',
    comments: [{ body: '1行だけの指摘', suggestion: "const lines = text.split('\\n');" }],
  };
  const expected = structuredClone(output);
  assert.deepEqual(repairLiteralEscapes(output), expected);
});

test('エスケープされた文字列でも、インラインコードの中の \\n は残す', () => {
  const output = repairLiteralEscapes({
    body: "`text.split('\\n')` は CRLF を残します。\\n\\n`/\\r?\\n/` で分けてください。",
  });
  assert.equal(output.body, "`text.split('\\n')` は CRLF を残します。\n\n`/\\r?\\n/` で分けてください。");
});

test('エスケープされた文字列の中のコードフェンスは、中身ごと改行に戻す', () => {
  const output = repairLiteralEscapes({
    body: '修正案:\\n\\n```ts\\nif (!a) return;\\n```',
  });
  assert.equal(output.body, '修正案:\n\n```ts\nif (!a) return;\n```');
});

test('suggestion は同じ指摘の body がエスケープされていないときは触らない', () => {
  const output = repairLiteralEscapes({
    comments: [{ body: '`split` の区切りを直します', suggestion: "const lines = text.split('\\n');" }],
  });
  assert.equal(output.comments[0]!.suggestion, "const lines = text.split('\\n');");
});

test('literal \\n が無ければ何も書き換えない', () => {
  const output = {
    body: '指摘なし',
    resolve_thread: true,
    resolved_comment_ids: [1, 2],
    remember: null,
  };
  const expected = structuredClone(output);
  assert.deepEqual(repairLiteralEscapes(output), expected);
});
