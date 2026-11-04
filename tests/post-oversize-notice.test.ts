import assert from 'node:assert/strict';
import test from 'node:test';

import { buildOversizeNotice, findOversizeNotice } from '../scripts/post-oversize-notice.ts';

const BOT_NAME = 'k8o-bot[bot]';
const notice = buildOversizeNotice({
  headSha: 'f25ce8ca47a6f68f0390490f1a9e65f46c2bb60c',
  runUrl: 'https://github.com/k35o/k8o/actions/runs/1',
});

test('buildOversizeNotice: レビューしなかったことと対象の commit・run を書く', () => {
  assert.ok(notice.includes('Pavo はレビューしませんでした'));
  assert.ok(notice.includes('`f25ce8c`'));
  assert.ok(notice.includes('https://github.com/k35o/k8o/actions/runs/1'));
});

test('findOversizeNotice: 自分が前に出した通知を見つけ、push のたびに増やさない', () => {
  const comments = [
    { id: 1, user: { login: 'k8o' }, body: 'レビューお願いします' },
    { id: 2, user: { login: BOT_NAME }, body: notice },
  ];
  assert.equal(findOversizeNotice(comments, BOT_NAME), 2);
});

test('findOversizeNotice: 他人のコメントは目印を含んでも対象にしない', () => {
  const comments = [{ id: 3, user: { login: 'k8o' }, body: notice }];
  assert.equal(findOversizeNotice(comments, BOT_NAME), null);
});

test('findOversizeNotice: 自分のコメントでも目印のないもの（失敗通知など）は対象にしない', () => {
  const comments = [{ id: 4, user: { login: BOT_NAME }, body: '⚠️ Pavo の実行が失敗しました: https://example.com' }];
  assert.equal(findOversizeNotice(comments, BOT_NAME), null);
});
