// Surface the real reason a claude-code-action step failed.
//
// The action's step log sanitizes every result message down to counters
// ({subtype, is_error, total_cost_usd, ...}), so e.g. a revoked OAuth token is
// indistinguishable from any other failure without forensics on cost and
// duration. The unsanitized message log survives on the runner as
// claude-execution-output.json — extract the result error text and the last
// assistant message into an ::error:: annotation and the step summary.
// Diagnostics must never mask the original failure: every problem in here
// downgrades to a ::warning:: and exit 0.
//
// Optional env: EXECUTION_FILE (falls back to $RUNNER_TEMP/claude-execution-output.json)

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { addStepSummary, error, warning } from './lib/actions.ts';

const TEXT_LIMIT = 2000;

// The runner masks *registered* secrets in both stdout and the step summary,
// but this script is the first place raw model/API text reaches either sink,
// and a token echoed inside an error body was never registered with the
// masker. Redact recognizable credential shapes ourselves.
const SECRET_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
];

export interface Diagnosis {
  annotation: string;
  summary: string;
}

function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((acc, pattern) => acc.replaceAll(pattern, '***'), text);
}

function truncate(text: string): string {
  return text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}…(truncated)` : text;
}

/** Fence with more backticks than any run inside the text, so it cannot escape. */
function fenced(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}\n${text}\n${fence}`;
}

function lastAssistantText(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.type !== 'assistant') continue;
    const content = message.message?.content;
    const text = (Array.isArray(content) ? content : [])
      .filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
      .map((block: any) => block.text)
      .join('\n')
      .trim();
    if (text) return text;
  }
  return '';
}

/**
 * Build the ::error:: annotation and step-summary Markdown from the raw
 * message array in claude-execution-output.json.
 */
export function diagnose(messages: any[]): Diagnosis {
  const result = messages.findLast((message) => message?.type === 'result');
  const assistantText = lastAssistantText(messages);

  const errorTexts: string[] = [];
  if (typeof result?.result === 'string' && result.result.trim()) {
    errorTexts.push(result.result.trim());
  }
  if (Array.isArray(result?.errors) && result.errors.length > 0) {
    errorTexts.push(
      result.errors
        .map((entry: unknown) => (typeof entry === 'string' ? entry : JSON.stringify(entry)))
        .join(', '),
    );
  }
  const errorText = errorTexts.join('\n');

  let headline: string;
  let annotation: string;
  if (!result) {
    headline = 'Claude が result メッセージを返さずに終了しました（プロセスが途中で落ちた可能性）。';
    annotation = assistantText
      ? `${headline} 直前のアシスタントメッセージ: ${truncate(assistantText)}`
      : headline;
  } else if (result.is_error === true || result.subtype !== 'success') {
    // subtype "success" + is_error:true is how the CLI reports e.g. auth
    // failures; without this note the pair reads as a contradiction.
    const label =
      result.subtype === 'success' && result.is_error === true
        ? 'subtype "success" は CLI の表示仕様で、is_error: true が実際の結果'
        : `subtype: ${result.subtype}`;
    headline = `Claude 実行がエラー終了しました（${label}）。`;
    annotation = `${headline} ${truncate(errorText || assistantText || 'エラーメッセージなし')}`;
    if (result.total_cost_usd === 0 && typeof result.num_turns === 'number' && result.num_turns <= 1) {
      annotation += ' / API 呼び出しが成立していません（cost $0）。CLAUDE_CODE_OAUTH_TOKEN の失効・無効の可能性があります。';
    }
  } else {
    headline =
      'Claude は正常終了しました（is_error: false）が、構造化出力（--json-schema）が返されなかった可能性があります。';
    annotation = `${headline} 最終メッセージ: ${truncate(assistantText || 'なし')}`;
  }

  const lines = ['### Pavo: Claude 実行の失敗診断', '', headline, ''];
  if (result) {
    const duration =
      typeof result.duration_ms === 'number' ? `${(result.duration_ms / 1000).toFixed(1)}s` : '-';
    lines.push(
      '| subtype | is_error | turns | cost (USD) | duration |',
      '| --- | --- | --- | --- | --- |',
      `| ${result.subtype ?? '-'} | ${result.is_error ?? '-'} | ${result.num_turns ?? '-'} | ${result.total_cost_usd ?? '-'} | ${duration} |`,
      '',
    );
  }
  if (errorText) {
    lines.push('**result:**', '', fenced(truncate(errorText)), '');
  }
  if (assistantText) {
    lines.push('**アシスタント最終メッセージ:**', '', fenced(truncate(assistantText)), '');
  }
  return { annotation: redactSecrets(annotation), summary: redactSecrets(lines.join('\n')) };
}

function main(): void {
  const file =
    process.env.EXECUTION_FILE ||
    (process.env.RUNNER_TEMP ? path.join(process.env.RUNNER_TEMP, 'claude-execution-output.json') : '');
  if (!file || !fs.existsSync(file)) {
    warning(`Claude の実行ログが見つかりません（${file || 'EXECUTION_FILE / RUNNER_TEMP が未設定'}）。追加の診断情報はありません。`);
    return;
  }
  let messages: unknown;
  try {
    messages = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (cause) {
    warning(`Claude の実行ログを parse できません: ${(cause as Error).message}`);
    return;
  }
  if (!Array.isArray(messages)) {
    warning('Claude の実行ログが配列ではありません。追加の診断情報はありません。');
    return;
  }
  const diagnosis = diagnose(messages);
  error(diagnosis.annotation);
  addStepSummary(diagnosis.summary);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (cause) {
    warning(`diagnose-claude-failure が失敗しました: ${(cause as Error).message}`);
  }
}
