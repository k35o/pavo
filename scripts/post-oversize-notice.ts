// Tell the PR that it was not reviewed because its prompt cannot fit
// claude-code-action's env limit even after build-review-prompt.ts shrank it.
// The run itself succeeds: a PR that is merely too large is not a failure.
//
// Every push reruns the review path, so the notice is a single comment that
// later runs update in place instead of stacking a new one per push.
//
// Required env: GH_TOKEN (for gh), REPO, PR_NUMBER, HEAD_SHA, BOT_NAME
// Optional env: RUN_URL

import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { notice } from './lib/actions.ts';
import { sameLogin } from './lib/bot.ts';
import { gh, ghPaginate } from './lib/gh.ts';
import { requireEnv } from './lib/env.ts';

const OVERSIZE_MARKER = '<!-- pavo:oversize -->';

export function buildOversizeNotice({ headSha, runUrl }: { headSha: string; runUrl: string }): string {
  return (
    `⚠️ この PR はレビューに渡す情報が大きすぎるため、Pavo はレビューしませんでした（head \`${headSha.slice(0, 7)}\`）。\n\n` +
    '変更ファイルの一覧と既存の会話を縮めても、claude-code-action に渡せる大きさに収まりませんでした。' +
    'PR を分けるか description を短くすると、次の push でレビューされます。\n\n' +
    (runUrl ? `${runUrl}\n\n` : '') +
    OVERSIZE_MARKER
  );
}

/**
 * @param comments REST issue comments, oldest first
 * @returns id of the notice an earlier run posted, if any
 */
export function findOversizeNotice(
  comments: { id: number; user?: { login?: string } | null; body?: string | null }[],
  botName: string,
): number | null {
  const own = comments.find(
    (comment) => sameLogin(comment.user?.login, botName) && (comment.body ?? '').includes(OVERSIZE_MARKER),
  );
  return own?.id ?? null;
}

function main(): void {
  const repo = requireEnv('REPO');
  const prNumber = requireEnv('PR_NUMBER');
  const input = JSON.stringify({
    body: buildOversizeNotice({ headSha: requireEnv('HEAD_SHA'), runUrl: process.env.RUN_URL ?? '' }),
  });
  const existing = findOversizeNotice(
    ghPaginate(`repos/${repo}/issues/${prNumber}/comments`),
    requireEnv('BOT_NAME'),
  );
  if (existing === null) {
    gh(['api', '--method', 'POST', `repos/${repo}/issues/${prNumber}/comments`, '--input', '-'], { input });
    notice('Posted the oversize notice; the review is skipped.');
  } else {
    gh(['api', '--method', 'PATCH', `repos/${repo}/issues/comments/${existing}`, '--input', '-'], { input });
    notice(`Updated the oversize notice ${existing}; the review is skipped.`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
