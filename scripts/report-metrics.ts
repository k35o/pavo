// Aggregate how Pavo's findings fared: resolve rate and 👍/👎 reactions per
// recent PR. The output is the feedback loop for tuning instructions/*.md —
// without it, viewpoint edits are guesswork.
//
// Usage: REPO=owner/name BOT_NAME='k35o-bot[bot]' node scripts/report-metrics.ts
// Optional env: PR_LIMIT (default 20)

import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { addStepSummary } from './lib/actions.ts';
import { sameLogin } from './lib/bot.ts';
import { ghJson, ghPaginatePrConnection } from './lib/gh.ts';
import { requireEnv } from './lib/env.ts';

interface ThreadStats {
  threads: number;
  resolved: number;
  thumbsUp: number;
  thumbsDown: number;
}

function fetchThreadStats(repo: string, prNumber: number, botName: string): ThreadStats {
  const [owner, name] = repo.split('/') as [string, string];
  const threads = ghPaginatePrConnection(owner, name, prNumber, {
    field: 'reviewThreads',
    first: 100,
    selection: `
      isResolved
      comments(first: 1) {
        nodes {
          author { login }
          reactionGroups { content reactors { totalCount } }
        }
      }`,
    maxPages: 10,
  });
  const stats: ThreadStats = { threads: 0, resolved: 0, thumbsUp: 0, thumbsDown: 0 };
  for (const thread of threads) {
    const root = thread.comments.nodes[0];
    if (!sameLogin(root?.author?.login, botName)) continue;
    stats.threads += 1;
    if (thread.isResolved) stats.resolved += 1;
    for (const group of root.reactionGroups ?? []) {
      if (group.content === 'THUMBS_UP') stats.thumbsUp += group.reactors.totalCount;
      if (group.content === 'THUMBS_DOWN') stats.thumbsDown += group.reactors.totalCount;
    }
  }
  return stats;
}

function main(): void {
  const repo = requireEnv('REPO');
  const botName = requireEnv('BOT_NAME');
  const limit = Number(process.env.PR_LIMIT ?? 20);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error(`Invalid PR_LIMIT: ${process.env.PR_LIMIT} (expected 1-100)`);
  }

  const prs = ghJson<any[]>([
    'api',
    `repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=${limit}`,
  ]);

  const rows: string[] = [];
  const total: ThreadStats = { threads: 0, resolved: 0, thumbsUp: 0, thumbsDown: 0 };
  for (const pr of prs) {
    const stats = fetchThreadStats(repo, pr.number, botName);
    if (stats.threads === 0) continue;
    rows.push(`| #${pr.number} | ${stats.threads} | ${stats.resolved} | ${stats.thumbsUp} | ${stats.thumbsDown} |`);
    total.threads += stats.threads;
    total.resolved += stats.resolved;
    total.thumbsUp += stats.thumbsUp;
    total.thumbsDown += stats.thumbsDown;
  }

  const rate = total.threads === 0 ? '-' : `${Math.round((total.resolved / total.threads) * 100)}%`;
  rows.push(
    `| **計** | **${total.threads}** | **${total.resolved}** (${rate}) | **${total.thumbsUp}** | **${total.thumbsDown}** |`,
  );
  const report =
    `## Pavo metrics: ${repo} (直近 ${limit} PR)\n\n` +
    `| PR | 指摘スレッド | resolved | 👍 | 👎 |\n| --- | --- | --- | --- | --- |\n` +
    `${rows.join('\n')}\n`;

  console.log(report);
  addStepSummary(report);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
