import assert from 'node:assert/strict';
import test from 'node:test';

import { extractLastReviewedSha } from '../scripts/collect-context.ts';
import { parseFindingMarker, stripFindingMarkers } from '../scripts/lib/markers.ts';
import { parsePatchLines } from '../scripts/lib/patch.ts';
import {
  buildReviewBody,
  decideEvent,
  filterResolvableRootIds,
  isNoopSuggestion,
  partitionComments,
  renderCommentBody,
  sanitizeSuggestion,
} from '../scripts/post-review.ts';
import type { PavoConfig, ReviewFinding } from '../scripts/lib/types.ts';

const CONFIG: Pick<PavoConfig, 'ignore' | 'minSeverity' | 'approve'> = {
  ignore: ['*.lock'],
  minSeverity: 'suggestion',
  approve: true,
};

const PATCH = ['@@ -1,2 +1,3 @@', ' const a = 1;', '+const b = 2;', ' export {};'].join('\n');
const FILES = new Map([
  ['src/a.ts', parsePatchLines(PATCH)],
  ['src/nopatch.bin', null],
]);

const comment = (overrides: Partial<ReviewFinding> = {}): ReviewFinding => ({
  path: 'src/a.ts',
  line: 2,
  side: 'RIGHT',
  severity: 'warning',
  confidence: 90,
  body: 'x が漏れています',
  ...overrides,
});

test('confidence 80 未満は drop', () => {
  const { inline, dropped } = partitionComments(
    [comment({ confidence: 79 }), comment({ severity: 'suggestion', confidence: 80 })],
    CONFIG,
    FILES,
  );
  assert.equal(inline.length, 1);
  assert.equal(inline[0]!.severity, 'suggestion');
  assert.equal(dropped.length, 1);
  assert.match(dropped[0]!.reason, /confidence/);
});

test('ignore glob に一致する path は drop', () => {
  const { dropped } = partitionComments([comment({ path: 'pnpm.lock' })], CONFIG, FILES);
  assert.equal(dropped[0]!.reason, 'ignored path');
});

test('壊れた指摘（path/line/body 欠落・未知 severity）は drop', () => {
  const { inline, demoted, dropped } = partitionComments(
    [
      { line: 2, severity: 'warning', confidence: 90, body: 'path がない' },
      comment({ line: Number.NaN }),
      comment({ body: '   ' }),
      comment({ severity: 'blocker' as ReviewFinding['severity'] }),
      comment({ severity: 'praise' as ReviewFinding['severity'] }),
    ],
    CONFIG,
    FILES,
  );
  assert.equal(inline.length, 0);
  assert.equal(demoted.length, 0);
  assert.deepEqual(
    dropped.map((entry) => entry.reason),
    ['malformed', 'malformed', 'malformed', 'unknown severity: blocker', 'unknown severity: praise'],
  );
});

test('min_severity 未満は demote され、diff 外のアンカーも demote される', () => {
  const config: typeof CONFIG = { ...CONFIG, minSeverity: 'warning' };
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
  assert.equal(decideEvent('approve', [suggestion], [], CONFIG, false), 'APPROVE');
  assert.equal(decideEvent('approve', [comment()], [], CONFIG, false), 'COMMENT');
  assert.equal(
    decideEvent('approve', [], [{ comment: comment({ severity: 'critical' }) }], CONFIG, false),
    'COMMENT',
  );
  assert.equal(decideEvent('comment', [], [], CONFIG, false), 'COMMENT');
  assert.equal(decideEvent('approve', [], [], { ...CONFIG, approve: false }, false), 'COMMENT');
});

test('decideEvent: 自分が作成した PR は APPROVE できないので COMMENT', () => {
  assert.equal(decideEvent('approve', [], [], CONFIG, true), 'COMMENT');
  assert.equal(
    decideEvent('approve', [comment({ severity: 'suggestion' })], [], CONFIG, true),
    'COMMENT',
  );
});

test('sanitizeSuggestion: LEFT は落とし、誤ラップのフェンスは剥がす', () => {
  assert.equal(sanitizeSuggestion('const a = 1;', 'LEFT'), undefined);
  assert.equal(sanitizeSuggestion('', 'RIGHT'), undefined);
  assert.equal(sanitizeSuggestion('const a = 1;', 'RIGHT'), 'const a = 1;');
  assert.equal(sanitizeSuggestion('```suggestion\nconst a = 1;\n```', 'RIGHT'), 'const a = 1;');
  assert.equal(sanitizeSuggestion('```\nconst a = 1;\nconst b = 2;\n```\n', 'RIGHT'), 'const a = 1;\nconst b = 2;');
  // フェンスを含むが全体を包んでいない場合はそのまま
  assert.equal(sanitizeSuggestion('const s = `\\`\\`\\``;', 'RIGHT'), 'const s = `\\`\\`\\``;');
});

test('isNoopSuggestion: 現在の行と同一（末尾空白は無視）なら no-op', () => {
  assert.ok(isNoopSuggestion('const a = 1;', ['const a = 1;']));
  assert.ok(isNoopSuggestion('const a = 1;\n', ['const a = 1;  ']));
  assert.ok(!isNoopSuggestion('const a = 2;', ['const a = 1;']));
  assert.ok(!isNoopSuggestion('const a = 1;', ['const a = 1;', 'const b = 2;']));
});

test('filterResolvableRootIds: 変更ファイル or outdated のスレッドだけ resolve を許可', () => {
  const context = {
    sameAsLastReview: false,
    changedSinceLastReview: {
      baseSha: 'prev',
      files: [{ filename: 'src/a.ts', status: 'modified' }],
      truncated: false,
    },
    threads: [
      { rootId: 1, path: 'src/a.ts', isOutdated: false },
      { rootId: 2, path: 'src/b.ts', isOutdated: false },
      { rootId: 3, path: 'src/b.ts', isOutdated: true },
    ],
  } as Parameters<typeof filterResolvableRootIds>[1];
  const { allowed, skipped } = filterResolvableRootIds([1, 2, 3, 4], context);
  assert.deepEqual(allowed, [1, 3]);
  assert.deepEqual(
    skipped.map((entry) => entry.rootId),
    [2, 4],
  );
});

test('filterResolvableRootIds: 差分不明なら許可、同一 commit ならスキップ、context なしなら素通し', () => {
  const thread = { rootId: 1, path: 'src/a.ts', isOutdated: false };
  const base = { threads: [thread], changedSinceLastReview: null };
  const forcePush = { ...base, sameAsLastReview: false } as Parameters<typeof filterResolvableRootIds>[1];
  assert.deepEqual(filterResolvableRootIds([1], forcePush).allowed, [1]);
  const sameCommit = { ...base, sameAsLastReview: true } as Parameters<typeof filterResolvableRootIds>[1];
  assert.deepEqual(filterResolvableRootIds([1], sameCommit).allowed, []);
  assert.deepEqual(filterResolvableRootIds([1, 2], null).allowed, [1, 2]);
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
    language: 'ja',
    meta: { sha: 'abc', instructions: 'default', model: 'sonnet' },
  });
  assert.ok(body.includes('<details>'));
  assert.ok(body.includes('その他の観察 (1)'));
  assert.match(body, /<!-- pavo:meta \{"sha":"abc"/);
});

test('buildReviewBody: 行に付けられなかった 🔴/🟡 は畳まずに本文に出す', () => {
  const body = buildReviewBody({
    summary: '指摘 2 件',
    demoted: [
      { comment: comment({ severity: 'critical', line: 40, body: 'SQL を連結しています' }), reason: 'line not in diff hunks' },
      { comment: comment({ severity: 'warning', path: 'src/b.ts', body: '例外が握りつぶされます' }), reason: 'inline post failed' },
      { comment: comment({ severity: 'suggestion', body: '名前を揃えられます' }), reason: 'line not in diff hunks' },
    ],
    language: 'ja',
    meta: {},
  });
  const [visible, folded] = body.split('<details>');
  assert.ok(visible!.includes('### 行に付けられなかった指摘 (2)'));
  assert.ok(visible!.includes('- 🔴 `src/a.ts:40` — SQL を連結しています\n'));
  assert.ok(visible!.includes('- 🟡 `src/b.ts:2` — 例外が握りつぶされます\n'));
  assert.ok(folded!.includes('その他の観察 (1)'));
  assert.ok(folded!.includes('- 🔵 `src/a.ts:2` — 名前を揃えられます'));
});

test('buildReviewBody: 反証された 🔴/🟡 や min_severity 未満の 🟡 は畳む', () => {
  const body = buildReviewBody({
    summary: '指摘なし',
    demoted: [
      { comment: comment({ severity: 'critical', body: '誤検知' }), reason: 'refuted by verifier' },
      { comment: comment({ severity: 'warning', body: '設定で抑止' }), reason: 'below min_severity' },
    ],
    language: 'ja',
    meta: {},
  });
  assert.ok(!body.includes('行に付けられなかった指摘'));
  assert.ok(body.includes('その他の観察 (2)'));
});

test('buildReviewBody: en の見出しも英語で書く', () => {
  const body = buildReviewBody({
    summary: 'One finding.',
    demoted: [{ comment: comment({ severity: 'warning', line: 40, body: 'Swallows the error' }), reason: 'line not in diff hunks' }],
    language: 'en',
    meta: {},
  });
  assert.ok(body.includes('### Findings not attached to a line (1)\n\n- 🟡 `src/a.ts:40` — Swallows the error'));
});

test('buildReviewBody: en では定型文も英語で書く', () => {
  const body = buildReviewBody({
    summary: 'One finding.',
    demoted: [{ comment: comment({ severity: 'suggestion', body: 'Could share a helper' }), reason: 'below min_severity' }],
    reductions: ['left out the existing conversation'],
    language: 'en',
    meta: {},
  });
  assert.ok(body.includes('<summary>Other notes (1)</summary>'));
  assert.ok(body.includes('ℹ️ This PR is large, so the review was given less context: left out the existing conversation'));
  assert.ok(!/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(body));
});

test('buildReviewBody: プロンプトを縮めたときは、縮めた内容を本文に書く', () => {
  const body = buildReviewBody({
    summary: 'TL;DR: 問題なし',
    demoted: [],
    reductions: ['削除されたファイルと内容の変わらない rename を件数だけにまとめた', '解決済みスレッドとコメント履歴を省いた'],
    language: 'ja',
    meta: { sha: 'abc' },
  });
  assert.ok(
    body.includes(
      'ℹ️ この PR は大きいため、レビューに渡す情報を縮めました: ' +
        '削除されたファイルと内容の変わらない rename を件数だけにまとめた、解決済みスレッドとコメント履歴を省いた',
    ),
  );
  assert.ok(!buildReviewBody({ summary: 'TL;DR', demoted: [], language: 'ja', meta: {} }).includes('ℹ️'));
});

test('buildReviewBody: サマリが長くて切り詰めても、縮めた旨は残る', () => {
  const body = buildReviewBody({
    summary: 'あ'.repeat(70000),
    demoted: [],
    reductions: ['既存の会話を省いた'],
    language: 'ja',
    meta: { sha: 'abc' },
  });
  assert.ok(body.includes('…(truncated)'));
  assert.ok(body.includes('レビューに渡す情報を縮めました: 既存の会話を省いた'));
});

test('finding マーカーは parseFindingMarker で roundtrip し、strip で除去できる', () => {
  const body = renderCommentBody(comment({ severity: 'warning', confidence: 87 }));
  assert.deepEqual(parseFindingMarker(body), { severity: 'warning', confidence: 87 });
  assert.equal(parseFindingMarker('マーカーなし'), null);
  assert.ok(!stripFindingMarkers(body).includes('pavo:finding'));
});

test('meta マーカーは extractLastReviewedSha で roundtrip する', () => {
  const sha = 'f'.repeat(40);
  const body = buildReviewBody({
    summary: 'サマリ',
    demoted: [],
    language: 'ja',
    meta: { sha, instructions: 'default', model: 'sonnet' },
  });
  const reviews = [{ author: { login: 'k35o-bot' }, body }];
  assert.equal(extractLastReviewedSha(reviews, 'k35o-bot[bot]'), sha);
});
