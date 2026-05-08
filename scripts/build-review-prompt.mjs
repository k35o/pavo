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
    '### 鉄則: `gh api ... /reviews` の呼び出しは review session で 1 回だけ\n\n' +
    'inline 指摘が N 件あっても、N 回でも N+1 回でもなく、**1 回**呼ぶ。' +
    '複数回呼ぶと PR の timeline に独立した Review が並んで UI が台無しになる。' +
    '`gh api` を呼ぶのは review session の **最後の操作**であり、それ以前に呼んではいけない。\n\n' +
    '### 投稿パターン（厳守）\n\n' +
    '**フェーズ 1 (収集):** diff を読み、対象行ごとの指摘を全部頭の中で集める。' +
    '各指摘は `{ path, line, side, body }` として scratchpad に保持する。' +
    '**この段階では gh api を呼ばない。**\n\n' +
    '**フェーズ 2 (サマリ作成):** 収集した指摘を踏まえて PR 全体のサマリ本文を 1 つ書く。' +
    '指摘 0 件のときも「特に問題なし + 確認した観点」を 1 行で必ず書く。' +
    '**この段階では gh api を呼ばない。**\n\n' +
    '**フェーズ 3 (一括投稿):** フェーズ 1 と 2 の結果を 1 つの JSON payload にまとめて `gh api` を 1 回だけ呼ぶ:\n\n' +
    '```bash\n' +
    `gh api --method POST /repos/${repo}/pulls/${prNumber}/reviews --input - <<'JSON'\n` +
    '{\n' +
    '  "body": "<フェーズ 2 のサマリ。空文字 \\"\\" 禁止>",\n' +
    '  "event": "COMMENT",\n' +
    '  "comments": [\n' +
    '    {"path": "...", "line": 42, "side": "RIGHT", "body": "🔵 ..."},\n' +
    '    {"path": "...", "line": 88, "side": "RIGHT", "body": "🟡 ..."},\n' +
    '    {"path": "...", "line": 130, "side": "RIGHT", "body": "🔴 ..."}\n' +
    '  ]\n' +
    '}\n' +
    'JSON\n' +
    '```\n\n' +
    '指摘が 10 件あっても 1 件だけでも 0 件でも、`gh api` の呼び出し回数は 1 回で固定。' +
    'inline 0 件のときは `"comments": []` で送る。\n\n' +
    '### `event` の選び方\n\n' +
    '- `"APPROVE"` — inline 指摘 0 件かつ全体として問題なしと確信できるとき。' +
    'サマリ本文には「特に問題なし」+ 確認した観点を簡潔に書く\n' +
    '- `"COMMENT"` — inline 指摘がある、または「気になる点があるが blocker ではない」「確信が持てない」場合。' +
    '迷ったらこちらを選ぶ（中立な観察として残す）\n' +
    '- `"REQUEST_CHANGES"` は使わない（人間レビュアー専用。AI が PR を機械的にブロックすると承認フローが壊れる）\n\n' +
    '`APPROVE` を選ぶときの追加ルール:\n' +
    '- 確認のフローで diff の主要部分を読んでいること（軽い目通しだけでの APPROVE は禁止）\n' +
    '- `🔵 Suggestion` レベルの観察も持っていない場合のみ APPROVE\n' +
    '- 観察を持っているのに省略して APPROVE するのは禁止（その場合は `COMMENT` で観察を inline に出す）\n\n' +
    '### よくある失敗パターン（絶対やらない）\n\n' +
    '- ❌ サマリだけ先に `gh api` で投稿し、その後 inline を別の `gh api` 呼び出しで追加する\n' +
    '- ❌ inline 指摘を 1 件ずつ独立した Review として投稿する（指摘 4 件 = `gh api` 4 回 はバグ）\n' +
    '- ❌ JSON が大きいから／複雑だからと言って `comments` 配列を分割して複数回投稿する\n' +
    '- ❌ `gh pr comment` や `mcp__github_inline_comment__create_inline_comment` を使う（UI が壊れる）\n' +
    '- ❌ inline 指摘が 1 件以上あるのに `event: APPROVE` にする（「直したほうが良い」と書きながら承認は矛盾）\n' +
    '- ❌ `event: REQUEST_CHANGES` を使う\n\n' +
    '### JSON の注意\n\n' +
    '- heredoc は必ず `<<\'JSON\'`（シングルクォート版）を使う。変数展開を防ぎ、本文の `$` や `` ` `` をそのまま渡せる\n' +
    '- `comments[].body` 内のダブルクォートは `\\"` にエスケープする\n' +
    '- 改行を含む `body` は heredoc の中でそのまま改行を書ける\n\n' +
    'レビューは GitHub 上にのみ投稿し、本文をメッセージとして返さないでください。\n',
);

process.stdout.write(sections.join('\n---\n\n'));
