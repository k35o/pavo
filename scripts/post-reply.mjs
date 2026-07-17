// Post Claude's structured conversation reply to the review thread.
//
// JSON goes to the API via stdin (execFile, no shell), which removes the whole
// class of quoting/command-substitution bugs the old `-f body="..."` template had.
//
// Required env: REPO, PR_NUMBER, ROOT_ID, BOT_NAME, STRUCTURED_OUTPUT

import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { addStepSummary, notice, warning } from './lib/actions.mjs';
import { sameLogin } from './lib/bot.mjs';
import { gh, ghGraphql, ghJson } from './lib/gh.mjs';
import { requireEnv } from './env.mjs';

const LEARNINGS_PATH = '.github/pavo-learnings.md';

/**
 * Append a learning to .github/pavo-learnings.md on the default branch.
 * Requires Contents: Read & write on the GitHub App; degrades gracefully.
 * @returns {boolean} whether the learning was saved
 */
function saveLearning(repo, prNumber, learning) {
  const existing = ghJson(['api', `repos/${repo}/contents/${LEARNINGS_PATH}`], {
    allowFailure: true,
  });
  const previous = existing?.content
    ? Buffer.from(existing.content, 'base64').toString('utf8')
    : '# Pavo learnings\n\nレビューのやり取りから蓄積された、このリポジトリ固有の方針メモ。\n';
  const date = new Date().toISOString().slice(0, 10);
  const next = `${previous.trimEnd()}\n\n- ${date} (#${prNumber}): ${learning.trim()}\n`;

  const payload = {
    message: `chore(pavo): record a review learning from #${prNumber}`,
    content: Buffer.from(next, 'utf8').toString('base64'),
    ...(existing?.sha ? { sha: existing.sha } : {}),
  };
  const result = gh(
    ['api', '--method', 'PUT', `repos/${repo}/contents/${LEARNINGS_PATH}`, '--input', '-'],
    { input: JSON.stringify(payload), allowFailure: true },
  );
  if (!result.ok) {
    warning(`Failed to save learning (Contents: write required?): ${result.stderr}`);
  }
  return result.ok;
}

function resolveThread(repo, prNumber, rootId, botName) {
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
  let cursor = null;
  for (let page = 0; page < 10; page += 1) {
    const data = ghGraphql(query, {
      owner,
      name,
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

function main() {
  const repo = requireEnv('REPO');
  const prNumber = requireEnv('PR_NUMBER');
  const rootId = requireEnv('ROOT_ID');
  const botName = requireEnv('BOT_NAME');
  const output = JSON.parse(requireEnv('STRUCTURED_OUTPUT'));

  let body = String(output.body ?? '').trim();
  if (!body) throw new Error('Structured output has no reply body.');

  let learningSaved = false;
  if (output.remember) {
    learningSaved = saveLearning(repo, prNumber, String(output.remember));
    if (!learningSaved) {
      body +=
        '\n\n> [!NOTE]\n> この方針を learnings に保存しようとしましたが、GitHub App に `Contents: Read & write` 権限がないため保存できませんでした。';
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
