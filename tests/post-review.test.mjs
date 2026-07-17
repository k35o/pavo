import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePatchLines } from '../scripts/lib/patch.mjs';
import {
  buildReviewBody,
  decideEvent,
  partitionComments,
  renderCommentBody,
} from '../scripts/post-review.mjs';

const CONFIG = { ignore: ['*.lock'], minSeverity: 'suggestion', approve: true };

const PATCH = ['@@ -1,2 +1,3 @@', ' const a = 1;', '+const b = 2;', ' export {};'].join('\n');
const FILES = new Map([
  ['src/a.ts', parsePatchLines(PATCH)],
  ['src/nopatch.bin', null],
]);

const comment = (overrides = {}) => ({
  path: 'src/a.ts',
  line: 2,
  side: 'RIGHT',
  severity: 'warning',
  confidence: 90,
  body: 'x が漏れています',
  ...overrides,
});

test('confidence 80 未満は drop（praise は対象外）', () => {
  const { inline, dropped } = partitionComments(
    [comment({ confidence: 79 }), comment({ severity: 'praise', confidence: 0 })],
    CONFIG,
    FILES,
  );
  assert.equal(inline.length, 1);
  assert.equal(inline[0].severity, 'praise');
  assert.equal(dropped.length, 1);
  assert.match(dropped[0].reason, /confidence/);
});

test('ignore glob に一致する path は drop', () => {
  const { dropped } = partitionComments([comment({ path: 'pnpm.lock' })], CONFIG, FILES);
  assert.equal(dropped[0].reason, 'ignored path');
});

test('min_severity 未満は demote され、diff 外のアンカーも demote される', () => {
  const config = { ...CONFIG, minSeverity: 'warning' };
  const { inline, demoted } = partitionComments(
    [
      comment({ severity: 'suggestion' }),
      comment({ line: 99 }),
      comment({ path: 'src/other.ts' }),
      comment(),
    ],
    config,
    FILES,
  );
  assert.equal(inline.length, 1);
  assert.equal(demoted.length, 3);
  assert.deepEqual(
    demoted.map((entry) => entry.reason).sort(),
    ['below min_severity', 'file not in diff', 'line not in diff hunks'],
  );
});

test('patch のないファイルへのアンカーは検証不能として inline に残る', () => {
  const { inline } = partitionComments(
    [comment({ path: 'src/nopatch.bin', line: 12345 })],
    CONFIG,
    FILES,
  );
  assert.equal(inline.length, 1);
});

test('decideEvent: 🔴/🟡 があると approve でも COMMENT、approve=false なら常に COMMENT', () => {
  const suggestion = comment({ severity: 'suggestion' });
  assert.equal(decideEvent('approve', [suggestion], [], CONFIG), 'APPROVE');
  assert.equal(decideEvent('approve', [comment()], [], CONFIG), 'COMMENT');
  assert.equal(
    decideEvent('approve', [], [{ comment: comment({ severity: 'critical' }) }], CONFIG),
    'COMMENT',
  );
  assert.equal(decideEvent('comment', [], [], CONFIG), 'COMMENT');
  assert.equal(decideEvent('approve', [], [], { ...CONFIG, approve: false }), 'COMMENT');
});

test('renderCommentBody: 絵文字付与と suggestion フェンス', () => {
  const body = renderCommentBody(comment({ suggestion: 'const b = 3;' }));
  assert.ok(body.startsWith('🟡 '));
  assert.ok(body.includes('```suggestion\nconst b = 3;\n```'));

  const nested = renderCommentBody(
    comment({ severity: 'suggestion', suggestion: '```md\nx\n```' }),
  );
  assert.ok(nested.includes('````suggestion'));
});

test('buildReviewBody: demote 一覧と meta マーカーを含む', () => {
  const body = buildReviewBody({
    summary: 'TL;DR: 問題なし',
    demoted: [{ comment: comment({ severity: 'suggestion' }), reason: 'below min_severity' }],
    meta: { sha: 'abc', instructions: 'default', model: 'sonnet' },
  });
  assert.ok(body.includes('<details>'));
  assert.ok(body.includes('その他の観察 (1)'));
  assert.match(body, /<!-- pavo:meta \{"sha":"abc"/);
});
