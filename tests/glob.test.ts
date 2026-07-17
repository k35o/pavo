import assert from 'node:assert/strict';
import test from 'node:test';

import { matchesAnyGlob, matchesGlob } from '../agent/lib/glob.ts';

test('スラッシュなしのパターンは basename にマッチする', () => {
  assert.ok(matchesGlob('sub/dir/pnpm-lock.yaml', 'pnpm-lock.yaml'));
  assert.ok(matchesGlob('a/b/c.lock', '*.lock'));
  assert.ok(!matchesGlob('a/b/c.lockx', '*.lock'));
});

test('ディレクトリパターン', () => {
  assert.ok(matchesGlob('dist/index.js', 'dist/**'));
  assert.ok(matchesGlob('dist/sub/deep.js', 'dist/**'));
  assert.ok(!matchesGlob('src/dist.ts', 'dist/**'));
  assert.ok(matchesGlob('dist/x.js', 'dist/'));
});

test('** はパス区切りをまたぐ', () => {
  assert.ok(matchesGlob('src/__snapshots__/foo.snap', '**/__snapshots__/**'));
  assert.ok(matchesGlob('a/b/c/gen.ts', 'a/**/gen.ts'));
  assert.ok(matchesGlob('a/gen.ts', 'a/**/gen.ts'));
});

test('** は完全なセグメント単位でのみマッチする（過剰マッチしない）', () => {
  assert.ok(!matchesGlob('a/xb', 'a/**/b'));
  assert.ok(!matchesGlob('xfoo', '**/foo'));
  assert.ok(!matchesGlob('src/x__snapshots__/y', '**/__snapshots__/**'));
  assert.ok(!matchesGlob('a/xgen.ts', 'a/**/gen.ts'));
});

test('* はセグメント内のみ', () => {
  assert.ok(matchesGlob('foo.min.js', '*.min.js'));
  assert.ok(!matchesGlob('lib/foo.js', 'lib/*.ts'));
});

test('正規表現メタ文字をエスケープする', () => {
  assert.ok(matchesGlob('a+b.txt', 'a+b.txt'));
  assert.ok(!matchesGlob('aab.txt', 'a+b.txt'));
});

test('matchesAnyGlob', () => {
  assert.ok(matchesAnyGlob('yarn.lock', ['dist/**', '*.lock']));
  assert.ok(!matchesAnyGlob('src/main.ts', ['dist/**', '*.lock']));
});
