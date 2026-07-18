// Shared building blocks for the review / conversation prompt builders.

import fs from 'node:fs';

// Neutralize 閉じタグ偽装: untrusted テキストが自分を囲むフェンスを閉じられないようにする。
export const sanitizeUntrusted = (text: string | null | undefined): string =>
  (text ?? '').replaceAll('</pavo-', '<\\/pavo-');

export const readIfExists = (file: string): string | null =>
  fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trimEnd() : null;

export function prDescriptionSection(prTitle: string, prBody: string): string {
  return (
    '## PR タイトルと description\n\n' +
    '<pavo-pr-description>\n' +
    `タイトル: ${sanitizeUntrusted(prTitle) || '(なし)'}\n\n` +
    `${sanitizeUntrusted(prBody) || '(empty)'}\n` +
    '</pavo-pr-description>\n'
  );
}

export function repoContextSection(
  repoContextMd: string | null | undefined,
  extraPrompt: string,
): string | null {
  const parts: string[] = [];
  if (repoContextMd) parts.push(repoContextMd.trimEnd());
  if (extraPrompt) parts.push(extraPrompt.trimEnd());
  if (parts.length === 0) return null;
  return `## このリポジトリの追加コンテキスト\n\n${parts.join('\n\n')}\n`;
}
