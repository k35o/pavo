// Resolve Pavo-owned review threads via GraphQL.
//
// Shared by post-review.ts (bulk resolve after posting a review) and
// post-reply.ts (single thread after a reply). Only threads whose root
// comment Pavo itself wrote are ever resolved — never human discussions.

import { warning } from './actions.ts';
import { sameLogin } from './bot.ts';
import { ghGraphql, ghPaginatePrConnection } from './gh.ts';

/**
 * Resolve the review threads rooted at the given comment ids, skipping
 * threads not started by `botName` and threads already resolved. A failed
 * mutation is downgraded to a warning: the review/reply is already posted
 * at this point, so resolution must not fail the run.
 *
 * @returns the number of threads actually resolved
 */
export function resolveThreadsByRootIds(
  repo: string,
  prNumber: string | number,
  botName: string,
  rootIds: number[],
): number {
  if (rootIds.length === 0) return 0;
  const [owner, name] = repo.split('/') as [string, string];
  const wanted = new Set(rootIds);
  const threads = ghPaginatePrConnection(owner, name, Number(prNumber), {
    field: 'reviewThreads',
    first: 100,
    selection: 'id isResolved comments(first: 1) { nodes { databaseId author { login } } }',
    maxPages: 10,
  });

  let resolvedCount = 0;
  for (const thread of threads) {
    const root = thread.comments.nodes[0];
    if (!root || !wanted.has(root.databaseId)) continue;
    if (!sameLogin(root.author?.login, botName) || thread.isResolved) continue;
    try {
      ghGraphql(
        'mutation($threadId: ID!) { resolveReviewThread(input: {threadId: $threadId}) { thread { id } } }',
        { threadId: thread.id },
      );
      resolvedCount += 1;
    } catch (error) {
      warning(`Failed to resolve thread ${thread.id}: ${(error as Error).message}`);
    }
  }
  return resolvedCount;
}
