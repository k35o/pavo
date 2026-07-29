import assert from 'node:assert/strict';
import test from 'node:test';

import { diagnose } from '../scripts/diagnose-claude-failure.ts';

const resultMessage = (overrides: Record<string, unknown> = {}) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  duration_ms: 2320,
  num_turns: 1,
  total_cost_usd: 0,
  ...overrides,
});

const assistantMessage = (text: string) => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text }] },
});

test('is_error:true の result 本文を注釈と summary に出す', () => {
  const { annotation, summary } = diagnose([
    resultMessage({ is_error: true, result: 'OAuth token revoked · Please run /login' }),
  ]);
  assert.match(annotation, /OAuth token revoked/);
  assert.match(annotation, /is_error: true/);
  assert.match(summary, /OAuth token revoked/);
});

test('cost $0 かつ 1 turn 以下なら認証エラーの可能性を示す', () => {
  const { annotation } = diagnose([resultMessage({ is_error: true, result: 'x' })]);
  assert.match(annotation, /CLAUDE_CODE_OAUTH_TOKEN/);
  const paid = diagnose([
    resultMessage({ is_error: true, result: 'x', total_cost_usd: 0.5, num_turns: 12 }),
  ]);
  assert.doesNotMatch(paid.annotation, /CLAUDE_CODE_OAUTH_TOKEN/);
});

test('エラー subtype では errors 配列も本文として扱う', () => {
  const { annotation } = diagnose([
    resultMessage({ subtype: 'error_during_execution', errors: ['boom', { code: 500 }] }),
  ]);
  assert.match(annotation, /subtype: error_during_execution/);
  assert.match(annotation, /boom/);
  assert.match(annotation, /"code":500/);
});

test('正常終了なのに落ちた場合は構造化出力の欠落としてアシスタント最終メッセージを出す', () => {
  const { annotation, summary } = diagnose([
    assistantMessage('スキーマに合う出力を作れませんでした'),
    resultMessage({ result: 'done' }),
  ]);
  assert.match(annotation, /構造化出力/);
  assert.match(annotation, /スキーマに合う出力を作れませんでした/);
  assert.match(summary, /アシスタント最終メッセージ/);
});

test('result メッセージ自体がない場合もその旨を出す', () => {
  const { annotation } = diagnose([assistantMessage('途中経過')]);
  assert.match(annotation, /result メッセージ/);
  assert.match(annotation, /途中経過/);
});

test('長い本文は切り詰める', () => {
  const { annotation } = diagnose([
    resultMessage({ is_error: true, result: 'あ'.repeat(5000) }),
  ]);
  assert.ok(annotation.length < 3000);
  assert.match(annotation, /truncated/);
});

test('トークン形の文字列は注釈・summary の両方でマスクされる', () => {
  const { annotation, summary } = diagnose([
    resultMessage({
      is_error: true,
      result: 'auth failed for sk-ant-oat01-abc123XYZ_-456 with ghs_0123456789abcdefTOKEN',
    }),
  ]);
  for (const output of [annotation, summary]) {
    assert.doesNotMatch(output, /sk-ant-oat01/);
    assert.doesNotMatch(output, /ghs_0123456789/);
    assert.match(output, /auth failed for \*\*\* with \*\*\*/);
  }
});

test('本文にコードフェンスが含まれても summary のフェンスは壊れない', () => {
  const { summary } = diagnose([
    resultMessage({
      is_error: true,
      result: 'error with ```json\n{}\n```',
      num_turns: 3,
      total_cost_usd: 0.1,
    }),
  ]);
  assert.match(summary, /````\nerror with/);
});
