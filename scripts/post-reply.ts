// Post Claude's structured conversation reply to the review thread.
//
// JSON goes to the API via stdin (execFile, no shell), which removes the whole
// class of quoting/command-substitution bugs the old `-f body="..."` template had.
//
// Required env: REPO, PR_NUMBER, ROOT_ID, BOT_NAME, STRUCTURED_OUTPUT

import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { addStepSummary, notice, warning } from './lib/actions.ts';
import { sameLogin } from './lib/bot.ts';
import { gh, ghGraphql, ghJson } from './lib/gh.ts';
import { requireEnv } from './env.ts';

const LEARNINGS_PATH = '.github/pavo-learnings.md';
// A dedicated branch, not the default branch: rulesets like "changes must be
// made through a pull request" reject direct commits to main with HTTP 409.
const LEARNINGS_BRANCH = 'pavo/learnings';

/** Structured conversation output validated against schemas/reply.json. */
interface ReplyOutput {
  body: string;
  resolve_thread: boolean;
  remember?: string;
}

function ensureLearningsBranch(repo: string): boolean {
  const existing = ghJson<{ ref?: string }>(
    ['api', `repos/${repo}/git/ref/heads/${LEARNINGS_BRANCH}`],
    { allowFailure: true },
  );
  if (existing?.ref) return true;
  const repoInfo = ghJson<{ default_branch?: string }>(['api', `repos/${repo}`], {
    allowFailure: true,
  });
  if (!repoInfo?.default_branch) return false;
  const base = ghJson<{ object?: { sha?: string } }>(
    ['api', `repos/${repo}/git/ref/heads/${repoInfo.default_branch}`],
    { allowFailure: true },
  );
  if (!base?.object?.sha) return false;
  const created = gh(
    [
      'api',
      '--method',
      'POST',
      `repos/${repo}/git/refs`,
      '-f',
      `ref=refs/heads/${LEARNINGS_BRANCH}`,
      '-f',
      `sha=${base.object.sha}`,
    ],
    { allowFailure: true },
  );
  return created.ok;
}

/**
 * Append a learning to .github/pavo-learnings.md on the pavo/learnings branch.
 * Requires Contents: Read & write on the GitHub App; degrades gracefully.
 * @returns an error description, or null on success
 */
function saveLearning(repo: string, prNumber: string, learning: string): string | null {
  if (!ensureLearningsBranch(repo)) {
    warning(`Failed to create the ${LEARNINGS_BRANCH} branch (Contents: write required?).`);
    return `ブランチ \`${LEARNINGS_BRANCH}\` を作成できませんでした（App の \`Contents: Read & write\` 権限を確認してください）`;
  }
  const existing = ghJson<{ content?: string; sha?: string }>(
    ['api', `repos/${repo}/contents/${LEARNINGS_PATH}?ref=${LEARNINGS_BRANCH}`],
    { allowFailure: true },
  );
  const previous = existing?.content
    ? Buffer.from(existing.content, 'base64').toString('utf8')
    : '# Pavo learnings\n\nレビューのやり取りから蓄積された、このリポジトリ固有の方針メモ。\n';
  const date = new Date().toISOString().slice(0, 10);
  const next = `${previous.trimEnd()}\n\n- ${date} (#${prNumber}): ${learning.trim()}\n`;

  const payload = {
    message: `chore(pavo): record a review learning from #${prNumber}`,
    content: Buffer.from(next, 'utf8').toString('base64'),
    branch: LEARNINGS_BRANCH,
    ...(existing?.sha ? { sha: existing.sha } : {}),
  };
  const result = gh(
    ['api', '--method', 'PUT', `repos/${repo}/contents/${LEARNINGS_PATH}`, '--input', '-'],
    { input: JSON.stringify(payload), allowFailure: true },
  );
  if (!result.ok) {
    warning(`Failed to save learning: ${result.stderr}`);
    return result.stderr.includes('403') || result.stderr.includes('Resource not accessible')
      ? 'App の `Contents: Read & write` 権限が必要です'
      : `保存 API がエラーを返しました: ${result.stderr.slice(0, 200).replaceAll('\n', ' ')}`;
  }
  return null;
}

function resolveThread(repo: string, prNumber: string, rootId: string, botName: string): boolean {
  const [owner, name] = repo.split('/');
  const query = `
    query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          reviewThreads(first: 100, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              isResolved
              comments(first: 1) { nodes { databaseId author { login } } }
            }
          }
        }
      }
    }`;
  let cursor: string | null = null;
  for (let page = 0; page < 10; page += 1) {
    const data: any = ghGraphql(query, {
      owner: owner!,
      name: name!,
      number: Number(prNumber),
      ...(cursor ? { cursor } : {}),
    });
    const connection = data.repository.pullRequest.reviewThreads;
    for (const thread of connection.nodes) {
      const root = thread.comments.nodes[0];
      if (root?.databaseId !== Number(rootId)) continue;
      if (!sameLogin(root.author?.login, botName) || thread.isResolved) return false;
      ghGraphql(
        'mutation($threadId: ID!) { resolveReviewThread(input: {threadId: $threadId}) { thread { id } } }',
        { threadId: thread.id },
      );
      return true;
    }
    if (!connection.pageInfo.hasNextPage) break;
    cursor = connection.pageInfo.endCursor;
  }
  return false;
}

function main(): void {
  const repo = requireEnv('REPO');
  const prNumber = requireEnv('PR_NUMBER');
  const rootId = requireEnv('ROOT_ID');
  const botName = requireEnv('BOT_NAME');
  const output = JSON.parse(requireEnv('STRUCTURED_OUTPUT')) as ReplyOutput;

  let body = String(output.body ?? '').trim();
  if (!body) throw new Error('Structured output has no reply body.');

  let learningSaved = false;
  if (output.remember) {
    const failure = saveLearning(repo, prNumber, String(output.remember));
    learningSaved = failure === null;
    if (failure) {
      body += `\n\n> [!NOTE]\n> この方針を learnings に保存しようとしましたが、失敗しました: ${failure}`;
    } else {
      body += `\n\n> [!NOTE]\n> \`${LEARNINGS_PATH}\`（\`${LEARNINGS_BRANCH}\` ブランチ）に記録しました。以後のレビューに反映されます。`;
    }
  }

  ghJson(
    [
      'api',
      '--method',
      'POST',
      `repos/${repo}/pulls/${prNumber}/comments/${rootId}/replies`,
      '--input',
      '-',
    ],
    { input: JSON.stringify({ body }) },
  );
  notice(`Replied to thread ${rootId}.`);

  let resolved = false;
  if (output.resolve_thread === true) {
    resolved = resolveThread(repo, prNumber, rootId, botName);
    if (resolved) notice(`Resolved thread ${rootId}.`);
  }

  addStepSummary(
    `### Pavo reply\n\nthread ${rootId} に返信しました（resolve: ${resolved}, learning: ${learningSaved ? 'saved' : output.remember ? 'failed' : 'none'}）。\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
