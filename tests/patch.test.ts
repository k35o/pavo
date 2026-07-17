import assert from 'node:assert/strict';
import test from 'node:test';

import { isValidAnchor, parsePatchLines } from '../scripts/lib/patch.ts';

const PATCH = [
  '@@ -1,4 +1,5 @@',
  ' const a = 1;',
  '-const b = 2;',
  '+const b = 20;',
  '+const c = 3;',
  ' export { a, b };',
  '@@ -10,2 +11,3 @@',
  ' function f() {',
  '+  return null;',
  ' }',
].join('\n');

test('hunk の行番号を両サイドで追跡する', () => {
  const lines = parsePatchLines(PATCH);
  // RIGHT: 1(ctx) 2(+) 3(+) 4(ctx) / 11(ctx) 12(+) 13(ctx)
  assert.deepEqual([...lines.right.keys()], [1, 2, 3, 4, 11, 12, 13]);
  // LEFT: 1(ctx) 2(-) 3(ctx) / 10(ctx) 11(ctx)
  assert.deepEqual([...lines.left.keys()], [1, 2, 3, 10, 11]);
});

test('diff 内の行アンカーは valid', () => {
  const lines = parsePatchLines(PATCH);
  assert.ok(isValidAnchor({ line: 2, side: 'RIGHT' }, lines));
  assert.ok(isValidAnchor({ line: 2, side: 'LEFT' }, lines));
  assert.ok(!isValidAnchor({ line: 7, side: 'RIGHT' }, lines));
});

test('複数行アンカーは同一 hunk 内で start < end のときのみ valid', () => {
  const lines = parsePatchLines(PATCH);
  assert.ok(isValidAnchor({ line: 3, start_line: 2, side: 'RIGHT' }, lines));
  assert.ok(!isValidAnchor({ line: 2, start_line: 3, side: 'RIGHT' }, lines));
  // hunk をまたぐ範囲は invalid
  assert.ok(!isValidAnchor({ line: 12, start_line: 4, side: 'RIGHT' }, lines));
});

test('patch がないファイルは検証不能として valid 扱い', () => {
  assert.ok(isValidAnchor({ line: 999, side: 'RIGHT' }, null));
});
