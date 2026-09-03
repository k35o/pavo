import assert from 'node:assert/strict';
import test from 'node:test';

import { repairLiteralEscapes } from '../scripts/lib/escapes.ts';

test('本物の改行が1つも無ければ、literal \\n / \\t を本物の文字に戻す', () => {
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

test('本物の改行があれば、literal \\n はそのままのテキストとして残す', () => {
  const output = {
    summary: '## TL;DR\n改行は `\\n` と書きます',
    comments: [{ body: '1行だけの指摘', suggestion: "const lines = text.split('\\n');" }],
  };
  const expected = structuredClone(output);
  assert.deepEqual(repairLiteralEscapes(output), expected);
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
