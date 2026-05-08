// Build the conversation reply prompt for Pavo's claude-code-action invocation.
//
// Reads inputs from environment variables and writes the composed prompt to stdout.
//
// Required env:
// - REPO: github.repository
// - PR_NUMBER: PR number
// - ROOT_ID: thread root comment id (github.event.comment.in_reply_to_id)
// - THREAD_JSON: pre-fetched JSON array of thread comments (sorted by id)
//
// Optional env:
// - FILE_PATH: path of the file the inline comment is attached to
// - PR_BODY: PR description body

import process from 'node:process';

const requireEnv = (key) => {
  const value = process.env[key];
  if (value === undefined) {
    throw new Error(`Missing required env: ${key}`);
  }
  return value;
};

const repo = requireEnv('REPO');
const prNumber = requireEnv('PR_NUMBER');
const rootId = requireEnv('ROOT_ID');
const filePath = process.env.FILE_PATH ?? '';
const prBody = process.env.PR_BODY ?? '';
const thread = JSON.parse(requireEnv('THREAD_JSON'));

const sections = [];

sections.push(
  `REPO: ${repo}\n` +
    `PR NUMBER: ${prNumber}\n` +
    `THREAD ROOT ID: ${rootId}\n` +
    `FILE: ${filePath}\n`,
);

sections.push(
  'あなたは Pavo というコードレビュー bot です。あなたが付けたインラインコメントに対してユーザーが返信しました。\n' +
    'スレッドの会話と該当ファイルを読んで、簡潔に返答してください。\n' +
    'コードの改善案を示すときはコードブロックを使ってください。\n' +
    '返信は冗長な前置きや謝辞は書かず、論点に直接答えてください。\n',
);

sections.push(
  '## 出力フォーマットのルール\n\n' +
    '- 識別子・短いシンボル名はインラインコード（バッククォート 1 個）で囲む\n' +
    '- バッククォートを含む引用や、複数行の引用、コメント文・文字列リテラルは必ずフェンス付きコードブロック（バッククォート 3 個）を使う\n' +
    '- インラインコード内でバッククォートをエスケープしようとしない（GitHub Markdown でレンダリングが壊れる）\n' +
    '- ファイル全体の参照は `**path/to/file.ts**` のように bold で示し、続けて該当箇所をフェンス付きコードブロックで引用する\n',
);

sections.push(`## PR description\n\n${prBody || '(empty)'}\n`);

sections.push(
  '## 出力言語\n\n' +
    '返答は上記 PR description の主要言語に合わせて書いてください。\n' +
    '英語の description なら英語で、日本語なら日本語で書きます。\n' +
    'description が空・不明瞭な場合は日本語で書いてください。\n',
);

const convoLines = ['## スレッドの会話\n'];
for (const c of thread) {
  const login = c.user?.login ?? '?';
  const body = c.body ?? '';
  convoLines.push(`**${login}:**\n${body}\n`);
}
sections.push(convoLines.join('\n'));

sections.push(
  '## diff\n\n' +
    `対象ファイル: \`${filePath}\`\n` +
    'diff の確認には `gh pr diff` を使ってください。\n' +
    '必要なら `Read` でファイル全体を読んでください。\n',
);

sections.push(
  '## 返信の投稿方法\n\n' +
    '以下のコマンドで thread に返信してください。本文 (body) のみあなたが書きます。\n' +
    'メッセージ本文には何も出力せず、コマンド実行のみ行ってください。\n\n' +
    '```\n' +
    `gh api --method POST /repos/${repo}/pulls/${prNumber}/comments/${rootId}/replies -f body="<返信本文>"\n` +
    '```\n',
);

process.stdout.write(sections.join('\n---\n\n'));
