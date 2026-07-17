import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_IGNORE, resolveConfig, severityRank } from '../scripts/lib/config.mjs';

test('デフォルト値', () => {
  const config = resolveConfig({}, null);
  assert.equal(config.instructions, 'default');
  assert.equal(config.language, 'auto');
  assert.equal(config.approve, true);
  assert.equal(config.minSeverity, 'suggestion');
  assert.equal(config.model, 'sonnet');
  assert.deepEqual(config.ignore, DEFAULT_IGNORE);
});

test('リポジトリ設定が inputs より優先される', () => {
  const config = resolveConfig(
    { instructions: 'default,react', model: 'sonnet', approve: 'true' },
    { instructions: 'default,nextjs', model: 'opus', approve: false, min_severity: 'warning' },
  );
  assert.equal(config.instructions, 'default,nextjs');
  assert.equal(config.model, 'opus');
  assert.equal(config.approve, false);
  assert.equal(config.minSeverity, 'warning');
});

test('ignore は defaults + inputs + repo config の合算', () => {
  const config = resolveConfig({ ignorePaths: 'docs/**' }, { ignore: ['*.gen.ts'] });
  assert.ok(config.ignore.includes('docs/**'));
  assert.ok(config.ignore.includes('*.gen.ts'));
  assert.ok(config.ignore.includes('pnpm-lock.yaml'));
});

test('不正な値は throw する', () => {
  assert.throws(() => resolveConfig({ language: 'fr' }, null), /Invalid language/);
  assert.throws(() => resolveConfig({ minSeverity: 'praise' }, null), /Invalid min_severity/);
  assert.throws(() => resolveConfig({}, { model: 'opus; rm -rf /' }), /Invalid model/);
});

test('severityRank の順序', () => {
  assert.ok(severityRank('critical') > severityRank('warning'));
  assert.ok(severityRank('warning') > severityRank('suggestion'));
  assert.ok(severityRank('suggestion') > severityRank('praise'));
});
