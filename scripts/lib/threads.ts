// Resolve Pavo-owned review threads via GraphQL.
//
// Shared by post-review.ts (bulk resolve after posting a review) and
// post-reply.ts (single thread after a reply). Only threads whose root
// comment Pavo itself wrote are ever resolved — never human discussions.

import { warning } from './actions.ts';
import { sameLogin } from './bot.ts';
import { ghGraphql, ghPaginatePrConnection } from './gh.ts';

export interface ThreadNode {
  id: string;
  isResolved: boolean;
  comments: { nodes: { databaseId: number; author?: { login?: string } | null }[] };
}

/**
 * Pick the thread ids to resolve: only threads rooted at one of `rootIds`,
 * started by `botName` (never a human discussion) and not already resolved.
 */
export function selectThreadsToResolve(
  threads: ThreadNode[],
  rootIds: number[],
  botName: string,
): string[] {
  const wanted = new Set(rootIds);
  return threads
    .filter((thread) => {
      const root = thread.comments.nodes[0];
      if (!root || !wanted.has(root.databaseId)) return false;
      return sameLogin(root.author?.login, botName) && !thread.isResolved;
    })
    .map((thread) => thread.id);
}

/**
 * Resolve the review threads rooted at the given comment ids. Any GraphQL
 * failure (listing or mutation) is downgraded to a warning: the review/reply
 * is already posted at this point, so resolution must not fail the run.
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
  let threads: ThreadNode[];
  try {
    threads = ghPaginatePrConnection<ThreadNode>(owner, name, Number(prNumber), {
      field: 'reviewThreads',
      first: 100,
      selection: 'id isResolved comments(first: 1) { nodes { databaseId author { login } } }',
      maxPages: 10,
    });
  } catch (error) {
    warning(`Failed to list review threads: ${(error as Error).message}`);
    return 0;
  }

  let resolvedCount = 0;
  for (const threadId of selectThreadsToResolve(threads, rootIds, botName)) {
    try {
      ghGraphql(
        'mutation($threadId: ID!) { resolveReviewThread(input: {threadId: $threadId}) { thread { id } } }',
        { threadId },
      );
      resolvedCount += 1;
    } catch (error) {
      warning(`Failed to resolve thread ${threadId}: ${(error as Error).message}`);
    }
  }
  return resolvedCount;
}
