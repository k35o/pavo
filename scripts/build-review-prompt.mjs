// Build the review prompt for Pavo's claude-code-action invocation.
//
// Reads inputs from environment variables and writes the composed prompt to stdout.
//
// Required env:
// - ACTION_PATH: path to pavo repo checkout (typically `${{ github.action_path }}`)
// - INSTRUCTIONS: comma-separated instruction names
// - REPO: github.repository
// - PR_NUMBER: PR number
// - EXISTING: pre-fetched JSON summary of the bot's existing comments
//
// Optional env:
// - EXTRA_PROMPT: repo-specific additional context
// - PR_BODY: PR description body

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/**
 * Resolve the instruction dependency graph from instructions/index.json.
 * @param {string} actionPath
 * @param {string} requested
 * @returns {string[]} names in load order with duplicates removed
 */
function resolveInstructions(actionPath, requested) {
  const manifestPath = path.join(actionPath, 'instructions', 'index.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const seen = new Set();
  const order = [];

  const visit = (raw) => {
    const name = raw.trim();
    if (!name || seen.has(name)) return;
    if (!Object.hasOwn(manifest, name)) {
      console.error(`::warning::Unknown instruction: ${name}`);
      return;
    }
    for (const dep of manifest[name]) {
      visit(dep);
    }
    seen.add(name);
    order.push(name);
  };

  for (const raw of requested.split(',')) {
    visit(raw);
  }
  return order;
}

const requireEnv = (key) => {
  const value = process.env[key];
  if (value === undefined) {
    throw new Error(`Missing required env: ${key}`);
  }
  return value;
};

const actionPath = requireEnv('ACTION_PATH');
const instructions = process.env.INSTRUCTIONS ?? 'default';
const extraPrompt = process.env.EXTRA_PROMPT ?? '';
const repo = requireEnv('REPO');
const prNumber = requireEnv('PR_NUMBER');
const prBody = process.env.PR_BODY ?? '';
const existing = process.env.EXISTING ?? '';

const sections = [];

sections.push(`REPO: ${repo}\nPR NUMBER: ${prNumber}\n`);

sections.push(
  'PR ブランチは現在のワーキングディレクトリにチェックアウト済みです。\n' +
    'diff を確認するときは `gh pr diff` を使ってください。\n',
);

sections.push(`## PR description\n\n${prBody || '(empty)'}\n`);

sections.push(
  '## 出力言語\n\n' +
    'レビューコメントは上記 PR description の主要言語に合わせて書いてください。\n' +
    '英語の description なら英語で、日本語なら日本語で書きます。\n' +
    'description が空・コードのみ・言語不明瞭の場合は日本語で書いてください。\n',
);

for (const name of resolveInstructions(actionPath, instructions)) {
  const file = path.join(actionPath, 'instructions', `${name}.md`);
  if (fs.existsSync(file)) {
    sections.push(`${fs.readFileSync(file, 'utf8').trimEnd()}\n`);
  }
}

if (extraPrompt) {
  sections.push(
    `## このリポジトリの追加コンテキスト\n\n${extraPrompt.trimEnd()}\n`,
  );
}

sections.push(
  '## 既にあなたが投稿したコメント\n\n' +
    '以下は同じ PR にあなた（Pavo）が過去のレビュー実行で投稿したコメント一覧です。\n' +
    '同じ場所・同じ趣旨のコメントを再投稿しないでください。\n' +
    '新しい変更や、まだ指摘していない点に集中してください。\n\n' +
    '```json\n' +
    `${existing}\n` +
    '```\n',
);

sections.push(
  '## コメントの投稿方法\n\n' +
    '- 行単位の指摘: `mcp__github_inline_comment__create_inline_comment` (`confirmed: true`)\n' +
    '- 全体への要約: `gh pr comment` を 1 度だけ使う\n' +
    'コメントは GitHub 上にのみ投稿し、本文をメッセージとして返さないでください。\n',
);

process.stdout.write(sections.join('\n---\n\n'));
