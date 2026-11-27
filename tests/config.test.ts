import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_IGNORE,
  parseRepoConfig,
  resolveConfig,
  resolveLanguage,
  severityRank,
} from '../scripts/lib/config.ts';

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

test('pavo.json の未知キーは throw する（typo が黙ってデフォルトに落ちない）', () => {
  assert.throws(() => resolveConfig({}, { min_severty: 'warning' }), /Unknown key .*min_severty/);
  // $schema はエディタ支援の慣習として許容する
  assert.equal(resolveConfig({}, { $schema: 'https://example.com/pavo.json' }).approve, true);
});

test('parseRepoConfig: オブジェクト以外の JSON と壊れた JSON は throw する', () => {
  assert.deepEqual(parseRepoConfig('{"approve": false}'), { approve: false });
  assert.throws(() => parseRepoConfig('["approve"]'), /must be a JSON object/);
  assert.throws(() => parseRepoConfig('"approve"'), /must be a JSON object/);
  assert.throws(() => parseRepoConfig('null'), /must be a JSON object/);
  assert.throws(() => parseRepoConfig('{broken'), /not valid JSON/);
});

test('resolveLanguage: auto はタイトルか description にかなか漢字があれば ja', () => {
  assert.equal(resolveLanguage('auto', 'feat: add x', 'x を追加する'), 'ja');
  assert.equal(resolveLanguage('auto', 'fix: 型を直す', ''), 'ja');
  assert.equal(resolveLanguage('auto', 'feat: 追加', 'Adds x.'), 'ja');
});

test('resolveLanguage: auto でかなも漢字もなければ en', () => {
  assert.equal(resolveLanguage('auto', 'chore(deps): update storybook', 'This PR updates storybook.'), 'en');
  assert.equal(resolveLanguage('auto', '', ''), 'en');
});

test('resolveLanguage: PR テンプレートの HTML コメントにある日本語は数えない', () => {
  const body = '<!-- 変更の概要を書いてください -->\nAdds a mock for Date.now().';
  assert.equal(resolveLanguage('auto', 'feat: mock Date.now', body), 'en');
});

test('resolveLanguage: ja / en の指定は本文に関係なくそのまま使う', () => {
  assert.equal(resolveLanguage('ja', 'chore(deps): update storybook', ''), 'ja');
  assert.equal(resolveLanguage('en', 'feat: 追加', 'x を追加する'), 'en');
});

test('severityRank の順序', () => {
  assert.ok(severityRank('critical') > severityRank('warning'));
  assert.ok(severityRank('warning') > severityRank('suggestion'));
  assert.ok(severityRank('suggestion') > severityRank('praise'));
});
