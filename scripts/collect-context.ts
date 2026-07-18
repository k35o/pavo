// Collect PR conversation context for the review prompt.
//
// One GraphQL sweep over reviewThreads gives resolution state, outdated-ness
// and every reply (any author) — things the old REST + jq pipeline could not
// see — and sidesteps `gh api --paginate`'s concatenated-arrays output.
//
// Bodies are truncated and counts capped: this feeds a prompt, not an archive,
// and unbounded growth eventually hits the 128KB env / 1MB output limits.
//
// Also writes each changed file's patch under OUT_DIR/diff/ so Claude can read
// per-file diffs with the Read tool (`gh pr diff` has no per-file mode and its
// full output can exceed the Bash tool's output limit on large PRs).
//
// Required env: GH_TOKEN (for gh), REPO, PR_NUMBER, BOT_NAME, HEAD_SHA, OUT_DIR

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { setOutputs, notice, warning } from './lib/actions.ts';
import { sameLogin } from './lib/bot.ts';
import { ghJson, ghPaginate, ghPaginatePrConnection } from './lib/gh.ts';
import type {
  ChangedFileEntry,
  CompareInfo,
  ReviewContext,
  ReviewSummaryEntry,
  ThreadComment,
  ThreadSummary,
} from './lib/types.ts';
import { requireEnv } from './lib/env.ts';

const BODY_LIMIT = 400;
const THREAD_LIMIT = 60;
const REPLIES_PER_THREAD = 10;
const REVIEW_LIMIT = 15;
const ISSUE_COMMENT_LIMIT = 30;
const COMPARE_FILE_LIMIT = 200;

export const META_MARKER_PATTERN = /<!-- pavo:meta (\{.*?\}) -->/s;

const truncate = (body: string | null | undefined, limit: number = BODY_LIMIT): string => {
  const text = body ?? '';
  return text.length > limit ? `${text.slice(0, limit)}…(truncated)` : text;
};

function fetchThreads(owner: string, name: string, number: number): any[] {
  return ghPaginatePrConnection(owner, name, number, {
    field: 'reviewThreads',
    first: 50,
    selection: `
      isResolved
      isOutdated
      path
      line
      originalLine
      comments(first: ${REPLIES_PER_THREAD}) {
        totalCount
        nodes { databaseId author { login } body }
      }`,
  });
}

function fetchReviews(owner: string, name: string, number: number): any[] {
  return ghPaginatePrConnection(owner, name, number, {
    field: 'reviews',
    first: 100,
    selection: 'databaseId author { login } state body submittedAt',
  });
}

function fetchIssueComments(owner: string, name: string, number: number): any[] {
  return ghPaginatePrConnection(owner, name, number, {
    field: 'comments',
    first: 100,
    selection: 'author { login } body',
  });
}

/**
 * @param reviews GraphQL review nodes, in submission order
 * @param botName
 * @returns head SHA recorded by the newest Pavo review
 */
export function extractLastReviewedSha(reviews: any[], botName: string): string | null {
  for (const review of [...reviews].reverse()) {
    if (!sameLogin(review.author?.login, botName)) continue;
    const match = META_MARKER_PATTERN.exec(review.body ?? '');
    if (!match) continue;
    try {
      const meta = JSON.parse(match[1]!);
      if (typeof meta.sha === 'string' && meta.sha) return meta.sha;
    } catch {
      // A corrupted marker only costs us the incremental hint.
    }
  }
  return null;
}

export function summarizeThreads(
  threads: any[],
  botName: string,
): { threads: ThreadSummary[]; dropped: number } {
  const shaped: ThreadSummary[] = threads.map((thread) => {
    const comments = thread.comments.nodes;
    const root = comments[0] ?? {};
    return {
      rootId: root.databaseId ?? null,
      path: thread.path,
      line: thread.line ?? thread.originalLine ?? null,
      isResolved: thread.isResolved,
      isOutdated: thread.isOutdated,
      byPavo: sameLogin(root.author?.login, botName),
      repliesTruncated: (thread.comments.totalCount ?? comments.length) > comments.length,
      comments: comments.map((comment: any) => ({
        author: comment.author?.login ?? '?',
        isBot: sameLogin(comment.author?.login, botName),
        body: truncate(comment.body),
      })),
    };
  });

  // Unresolved threads carry the live discussion; resolved ones only need to
  // exist so the reviewer does not re-litigate them.
  const unresolved = shaped.filter((thread) => !thread.isResolved);
  const resolved = shaped
    .filter((thread) => thread.isResolved)
    .map((thread) => ({
      ...thread,
      comments: [
        {
          author: thread.comments[0]?.author ?? '?',
          isBot: thread.comments[0]?.isBot ?? false,
          body: truncate(thread.comments[0]?.body ?? '', 120),
        },
      ],
    }));
  const kept = [...unresolved, ...resolved].slice(0, THREAD_LIMIT);
  return { threads: kept, dropped: shaped.length - kept.length };
}

function fetchChangedSince(repo: string, base: string | null, head: string): CompareInfo | null {
  if (!base || base === head) return null;
  const compare = ghJson(['api', `repos/${repo}/compare/${base}...${head}`], {
    allowFailure: true,
  });
  if (!compare?.files) return null;
  return {
    baseSha: base,
    files: compare.files
      .slice(0, COMPARE_FILE_LIMIT)
      .map((file: any) => ({ filename: file.filename, status: file.status })),
    truncated: compare.files.length > COMPARE_FILE_LIMIT,
  };
}

function main(): void {
  const repo = requireEnv('REPO');
  const [owner, name] = repo.split('/') as [string, string];
  const number = Number(requireEnv('PR_NUMBER'));
  const botName = requireEnv('BOT_NAME');
  const headSha = requireEnv('HEAD_SHA');
  const outDir = requireEnv('OUT_DIR');

  const rawReviews = fetchReviews(owner, name, number);
  const { threads, dropped } = summarizeThreads(fetchThreads(owner, name, number), botName);
  const issueComments: ThreadComment[] = fetchIssueComments(owner, name, number)
    .slice(-ISSUE_COMMENT_LIMIT)
    .map((comment) => ({
      author: comment.author?.login ?? '?',
      isBot: sameLogin(comment.author?.login, botName),
      body: truncate(comment.body),
    }));

  const lastReviewedSha = extractLastReviewedSha(rawReviews, botName);
  const sameAsLastReview = lastReviewedSha === headSha;
  let changedSinceLastReview: CompareInfo | null = null;
  if (lastReviewedSha && !sameAsLastReview) {
    changedSinceLastReview = fetchChangedSince(repo, lastReviewedSha, headSha);
    if (!changedSinceLastReview) {
      warning('Could not compare against the last reviewed SHA (force push?); running a full review.');
    }
  }

  const reviews: ReviewSummaryEntry[] = rawReviews.slice(-REVIEW_LIMIT).map((review) => ({
    author: review.author?.login ?? '?',
    isBot: sameLogin(review.author?.login, botName),
    state: review.state,
    body: truncate(review.body, 600),
  }));

  const diffDir = path.join(outDir, 'diff');
  fs.mkdirSync(diffDir, { recursive: true });
  const changedFiles: ChangedFileEntry[] = [];
  for (const file of ghPaginate(`repos/${repo}/pulls/${number}/files`)) {
    changedFiles.push({
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      hasPatch: Boolean(file.patch),
    });
    if (!file.patch) continue;
    const target = path.resolve(diffDir, `${file.filename}.diff`);
    if (!target.startsWith(path.resolve(diffDir) + path.sep)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${file.patch}\n`);
  }

  const context: ReviewContext = {
    botName,
    threads,
    droppedThreads: dropped,
    reviews,
    issueComments,
    lastReviewedSha,
    sameAsLastReview,
    changedSinceLastReview,
    diffDir,
    changedFiles,
  };

  const contextFile = path.join(outDir, 'context.json');
  fs.writeFileSync(contextFile, JSON.stringify(context, null, 2));
  notice(
    `Context: ${threads.length} threads (${dropped} dropped), ${reviews.length} reviews, ` +
      `${issueComments.length} comments, ${changedFiles.length} changed files, ` +
      `lastReviewedSha=${lastReviewedSha ?? 'none'}`,
  );
  setOutputs({ context_file: contextFile });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
