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

import { requireEnv } from './env.mjs';

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

const actionPath = requireEnv('ACTION_PATH');
const instructions = process.env.INSTRUCTIONS ?? 'default';
const extraPrompt = process.env.EXTRA_PROMPT ?? '';
const repo = requireEnv('REPO');
const prNumber = requireEnv('PR_NUMBER');
const prBody = process.env.PR_BODY ?? '';
const existing = process.env.EXISTING ?? '';

const sections = [];

// system.md is always loaded first: it carries the persona and the
// "how to review" rules that apply regardless of the requested viewpoint.
const systemPath = path.join(actionPath, 'instructions', 'system.md');
sections.push(`${fs.readFileSync(systemPath, 'utf8').trimEnd()}\n`);

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
  '## レビューの投稿方法\n\n' +
    'PR レビューは GitHub の **Pull Request Review** として 1 件にまとめて投稿する。\n\n' +
    '**最重要ルール: `gh api ... /reviews` は 1 PR につき 1 回しか呼ばない。** ' +
    '複数回呼ぶと UI に独立した Review が並んで台無しになる。' +
    '全 inline 指摘とサマリ本文は **必ず 1 つの payload にまとめる**。\n\n' +
    '**手順:**\n' +
    '1. diff を読み、対象行ごとの指摘（バグ・命名・設計・パフォーマンス・テスト不足・改善提案）を全部洗い出す\n' +
    '2. 各指摘を `{ path, line, side, body }` の形で集める（変更行は `"RIGHT"`、削除行を指すときだけ `"LEFT"`）\n' +
    '3. PR 全体のサマリ本文を必ず 1 つ書く（指摘がない場合も「確認した観点」+「特に問題なし」を 1 行）\n' +
    '4. すべての指摘とサマリを 1 つの payload にまとめて `gh api` を **1 回だけ** 呼ぶ:\n\n' +
    '```bash\n' +
    `gh api --method POST /repos/${repo}/pulls/${prNumber}/reviews --input - <<'JSON'\n` +
    '{\n' +
    '  "body": "<必ず埋める。空文字 \\"\\" 禁止>",\n' +
    '  "event": "COMMENT",\n' +
    '  "comments": [\n' +
    '    {"path": "...", "line": 42, "side": "RIGHT", "body": "🔵 ..."},\n' +
    '    {"path": "...", "line": 88, "side": "RIGHT", "body": "🟡 ..."}\n' +
    '  ]\n' +
    '}\n' +
    'JSON\n' +
    '```\n\n' +
    '**禁止事項:**\n' +
    '- `gh api ... /reviews` を 2 回以上呼ぶ（1 件ずつ別 Review として投稿しない）\n' +
    '- `body` を空文字で送る（必ずサマリを書く）\n' +
    '- `gh pr comment` や `mcp__github_inline_comment__create_inline_comment` を使う（Review にぶら下げる UI を壊す）\n' +
    '- `event` を `APPROVE` / `REQUEST_CHANGES` にする（人間レビュアー専用、必ず `COMMENT`）\n\n' +
    '**JSON の注意:**\n' +
    '- heredoc は必ず `<<\'JSON\'`（シングルクォート版）を使う。変数展開を防ぎ、本文の `$` や `` ` `` をそのまま渡せる\n' +
    '- `comments[].body` 内のダブルクォートは `\\"` にエスケープする\n\n' +
    '**inline 指摘が 0 件のとき:**\n' +
    '`"comments": []` でサマリだけの Review を投稿する。それでも `gh api` は 1 回だけ呼ぶ。\n\n' +
    'レビューは GitHub 上にのみ投稿し、本文をメッセージとして返さないでください。\n',
);

process.stdout.write(sections.join('\n---\n\n'));
