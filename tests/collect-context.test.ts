import assert from 'node:assert/strict';
import test from 'node:test';

import { sameLogin } from '../scripts/lib/bot.ts';
import { extractLastReviewedSha, summarizeThreads } from '../scripts/collect-context.ts';

// GraphQL は Bot の login を `[bot]` サフィックスなしで返す（REST は付き）。
// フィクスチャは実 API に合わせてサフィックスなしにしてある。
const BOT_NAME = 'k35o-bot[bot]';

test('sameLogin は GraphQL / REST の表記差を吸収する', () => {
  assert.ok(sameLogin('k35o-bot', 'k35o-bot[bot]'));
  assert.ok(sameLogin('k35o-bot[bot]', 'k35o-bot[bot]'));
  assert.ok(sameLogin('k35o-bot', 'k35o-bot'));
  assert.ok(!sameLogin('renovate', 'k35o-bot[bot]'));
  assert.ok(!sameLogin(null, 'k35o-bot[bot]'));
});

test('extractLastReviewedSha: サフィックスなし login の bot レビューからマーカーを拾う', () => {
  const reviews = [
    { author: { login: 'k35o-bot' }, body: 'old <!-- pavo:meta {"sha":"aaaaaaa"} -->' },
    { author: { login: 'k8o' }, body: 'human <!-- pavo:meta {"sha":"1234abc"} -->' },
    { author: { login: 'k35o-bot' }, body: 'new <!-- pavo:meta {"sha":"bbbbbbb"} -->' },
  ];
  assert.equal(extractLastReviewedSha(reviews, BOT_NAME), 'bbbbbbb');
  assert.equal(extractLastReviewedSha([], BOT_NAME), null);
  assert.equal(
    extractLastReviewedSha([{ author: { login: 'k35o-bot' }, body: 'no marker' }], BOT_NAME),
    null,
  );
});

test('extractLastReviewedSha: commit 形式でない sha のマーカーは無視して古い正当なマーカーに戻る', () => {
  // レビュー本文は後から編集できるため、compare API のパスに流れる sha は形式検証する
  const reviews = [
    { author: { login: 'k35o-bot' }, body: '<!-- pavo:meta {"sha":"aaaaaaa"} -->' },
    { author: { login: 'k35o-bot' }, body: '<!-- pavo:meta {"sha":"../../evil"} -->' },
  ];
  assert.equal(extractLastReviewedSha(reviews, BOT_NAME), 'aaaaaaa');
});

test('summarizeThreads: byPavo / isBot がサフィックスなし login でも立ち、切り詰めを記録する', () => {
  const threads = [
    {
      isResolved: false,
      isOutdated: false,
      path: 'src/a.ts',
      line: 3,
      originalLine: 3,
      comments: {
        totalCount: 12,
        nodes: [
          { databaseId: 101, author: { login: 'k35o-bot' }, body: '指摘' },
          { databaseId: 102, author: { login: 'k8o' }, body: '返信' },
        ],
      },
    },
    {
      isResolved: true,
      isOutdated: true,
      path: 'src/b.ts',
      line: null,
      originalLine: 9,
      comments: {
        totalCount: 1,
        nodes: [{ databaseId: 201, author: { login: 'k35o-bot' }, body: '解決済み' }],
      },
    },
  ];
  const { threads: shaped, dropped } = summarizeThreads(threads, BOT_NAME);
  assert.equal(dropped, 0);
  assert.equal(shaped[0]!.byPavo, true);
  assert.equal(shaped[0]!.rootId, 101);
  assert.equal(shaped[0]!.repliesTruncated, true);
  assert.equal(shaped[0]!.comments[0]!.isBot, true);
  assert.equal(shaped[0]!.comments[1]!.isBot, false);
  // 解決済みスレッドは 1 コメントの要約に圧縮され、outdated は originalLine にフォールバック
  assert.equal(shaped[1]!.isResolved, true);
  assert.equal(shaped[1]!.line, 9);
  assert.equal(shaped[1]!.comments.length, 1);
});
