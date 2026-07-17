// Deterministic review posting, ported from scripts/post-review.ts (Actions
// incarnation). The model only supplies findings; everything that must not be
// left to an LLM happens here: confidence/ignore filtering, anchor validation
// against the real diff, the APPROVE/COMMENT decision, the single POST with a
// salvage fallback, dismissing stale APPROVEs after the new review exists,
// and resolving fixed threads.

import { sameLogin } from './bot.ts';
import { graphql, paginate, rest } from './github.ts';
import { matchesAnyGlob } from './glob.ts';
import { isValidAnchor, parsePatchLines, type PatchLines } from './patch.ts';

export type Severity = 'critical' | 'warning' | 'suggestion' | 'praise';

export interface Finding {
  path: string;
  line: number;
  side: 'RIGHT' | 'LEFT';
  start_line?: number | undefined;
  start_side?: 'RIGHT' | 'LEFT' | undefined;
  severity: Severity;
  confidence: number;
  body: string;
  suggestion?: string | undefined;
}

export interface ReviewPolicy {
  ignore: string[];
  minSeverity: Exclude<Severity, 'praise'>;
  approve: boolean;
}

const CONFIDENCE_THRESHOLD = 80;
const REVIEW_BODY_LIMIT = 60000;
const RESOLVE_LIMIT = 20;
const SEVERITY_RANK: Record<Severity, number> = { praise: 0, suggestion: 1, warning: 2, critical: 3 };

export const SEVERITY_EMOJI: Record<Severity, string> = {
  critical: '🔴',
  warning: '🟡',
  suggestion: '🔵',
  praise: '👍',
};

export function renderCommentBody(comment: Finding): string {
  let body = `${SEVERITY_EMOJI[comment.severity]} ${comment.body.trim()}`;
  if (comment.suggestion) {
    const fence = comment.suggestion.includes('```') ? '````' : '```';
    body += `\n\n${fence}suggestion\n${comment.suggestion.replace(/\n$/, '')}\n${fence}`;
  }
  return body;
}

export interface Partitioned {
  inline: Finding[];
  demoted: { comment: Finding; reason: string }[];
  dropped: { comment: Finding; reason: string }[];
}

export function partitionComments(
  rawComments: unknown[],
  policy: ReviewPolicy,
  fileLines: Map<string, PatchLines | null>,
): Partitioned {
  const inline: Finding[] = [];
  const demoted: Partitioned['demoted'] = [];
  const dropped: Partitioned['dropped'] = [];
  const threshold = SEVERITY_RANK[policy.minSeverity];

  for (const rawEntry of rawComments ?? []) {
    const raw = rawEntry as Record<string, any>;
    const comment: Finding = {
      path: String(raw.path ?? ''),
      line: Number(raw.line),
      side: raw.side === 'LEFT' ? 'LEFT' : 'RIGHT',
      start_line: raw.start_line == null ? undefined : Number(raw.start_line),
      start_side: raw.start_side === 'LEFT' ? 'LEFT' : raw.start_side === 'RIGHT' ? 'RIGHT' : undefined,
      severity: raw.severity as Severity,
      confidence: Number(raw.confidence ?? 0),
      body: String(raw.body ?? '').trim(),
      suggestion: raw.suggestion ? String(raw.suggestion) : undefined,
    };
    if (!comment.path || !Number.isFinite(comment.line) || !comment.body) {
      dropped.push({ comment, reason: 'malformed' });
      continue;
    }
    if (!(comment.severity in SEVERITY_EMOJI)) {
      dropped.push({ comment, reason: `unknown severity: ${comment.severity}` });
      continue;
    }
    if (matchesAnyGlob(comment.path, policy.ignore)) {
      dropped.push({ comment, reason: 'ignored path' });
      continue;
    }
    if (comment.severity !== 'praise' && comment.confidence < CONFIDENCE_THRESHOLD) {
      dropped.push({ comment, reason: `confidence ${comment.confidence} < ${CONFIDENCE_THRESHOLD}` });
      continue;
    }

    const rank = comment.severity === 'praise' ? SEVERITY_RANK.suggestion : SEVERITY_RANK[comment.severity];
    if (rank < threshold) {
      demoted.push({ comment, reason: 'below min_severity' });
      continue;
    }
    if (!fileLines.has(comment.path)) {
      demoted.push({ comment, reason: 'file not in diff' });
      continue;
    }
    if (!isValidAnchor(comment, fileLines.get(comment.path) ?? null)) {
      demoted.push({ comment, reason: 'line not in diff hunks' });
      continue;
    }
    inline.push(comment);
  }
  return { inline, demoted, dropped };
}

export function decideEvent(
  verdict: string,
  inline: Finding[],
  demoted: Partitioned['demoted'],
  policy: ReviewPolicy,
): 'APPROVE' | 'COMMENT' {
  if (!policy.approve || verdict !== 'approve') return 'COMMENT';
  const blocking = [...inline, ...demoted.map((entry) => entry.comment)].some((comment) =>
    comment.severity === 'critical' || comment.severity === 'warning',
  );
  return blocking ? 'COMMENT' : 'APPROVE';
}

export function buildReviewBody(options: {
  summary: string;
  demoted: Partitioned['demoted'];
  meta: Record<string, string>;
}): string {
  let body = options.summary.trim();
  if (options.demoted.length > 0) {
    const items = options.demoted
      .map(
        ({ comment, reason }) =>
          `- ${SEVERITY_EMOJI[comment.severity]} \`${comment.path}:${comment.line}\` — ${comment.body.replaceAll('\n', ' ')}` +
          (reason === 'line not in diff hunks' || reason === 'file not in diff' ? '' : ` _(${reason})_`),
      )
      .join('\n');
    body += `\n\n<details>\n<summary>その他の観察 (${options.demoted.length})</summary>\n\n${items}\n\n</details>`;
  }
  if (body.length > REVIEW_BODY_LIMIT) {
    body = `${body.slice(0, REVIEW_BODY_LIMIT)}\n\n…(truncated)`;
  }
  return `${body}\n\n<!-- pavo:meta ${JSON.stringify(options.meta)} -->`;
}

export async function fetchFileLines(repo: string, prNumber: number): Promise<Map<string, PatchLines | null>> {
  const files = await paginate<{ filename: string; patch?: string }>(`/repos/${repo}/pulls/${prNumber}/files`);
  const map = new Map<string, PatchLines | null>();
  for (const file of files) {
    map.set(file.filename, file.patch ? parsePatchLines(file.patch) : null);
  }
  return map;
}

export interface PostResult {
  reviewId: number;
  event: 'APPROVE' | 'COMMENT';
  inlineCount: number;
  demotedCount: number;
  droppedCount: number;
  dropped: { path: string; line: number; reason: string }[];
  resolvedCount: number;
  salvaged: boolean;
  skipped?: boolean;
}

export async function postReview(options: {
  repo: string;
  prNumber: number;
  headSha: string;
  botName: string;
  policy: ReviewPolicy;
  summary: string;
  verdict: string;
  comments: unknown[];
  resolvedCommentIds: number[];
  meta: Record<string, string>;
}): Promise<PostResult> {
  const { repo, prNumber, headSha, botName, policy } = options;
  if (!options.summary?.trim()) {
    throw new Error('summary is empty — refusing to post an empty review');
  }

  // Idempotency: webhook redelivery / draft⇄ready toggles re-run the same
  // head sha. If this bot already reviewed this sha, do nothing.
  const existingReviews = await paginate<{ id: number; state: string; body?: string; user?: { login?: string } }>(
    `/repos/${repo}/pulls/${prNumber}/reviews`,
  );
  const alreadyReviewed = existingReviews.some(
    (review) =>
      sameLogin(review.user?.login, botName) &&
      (review.body ?? '').includes(`<!-- pavo:meta`) &&
      (review.body ?? '').includes(`"sha":"${headSha}"`),
  );
  if (alreadyReviewed) {
    return {
      reviewId: 0,
      event: 'COMMENT',
      inlineCount: 0,
      demotedCount: 0,
      droppedCount: 0,
      dropped: [],
      resolvedCount: 0,
      salvaged: false,
      skipped: true,
    };
  }

  const fileLines = await fetchFileLines(repo, prNumber);
  const { inline, demoted, dropped } = partitionComments(options.comments, policy, fileLines);
  const event = decideEvent(options.verdict, inline, demoted, policy);
  const meta = { ...options.meta, sha: headSha };

  const payload = {
    commit_id: headSha,
    body: buildReviewBody({ summary: options.summary, demoted, meta }),
    event,
    comments: inline.map((comment) => ({
      path: comment.path,
      line: comment.line,
      side: comment.side,
      ...(comment.start_line !== undefined
        ? { start_line: comment.start_line, start_side: comment.start_side ?? comment.side }
        : {}),
      body: renderCommentBody(comment),
    })),
  };

  let salvaged = false;
  let posted = await rest('POST', `/repos/${repo}/pulls/${prNumber}/reviews`, payload);
  if (!posted.ok) {
    // A single rejected anchor 422s the whole review; salvage everything into
    // the body rather than losing the review entirely.
    salvaged = true;
    const salvagedDemoted = [
      ...inline.map((comment) => ({ comment, reason: 'inline post failed' })),
      ...demoted,
    ];
    posted = await rest('POST', `/repos/${repo}/pulls/${prNumber}/reviews`, {
      commit_id: headSha,
      event,
      body: buildReviewBody({ summary: options.summary, demoted: salvagedDemoted, meta }),
      comments: [],
    });
    if (!posted.ok) {
      throw new Error(`review POST failed twice: ${posted.status} ${posted.errorText.slice(0, 300)}`);
    }
  }
  const reviewId = (posted.body as { id: number }).id;

  // Dismiss stale APPROVEs only after the fresh review exists, keeping the
  // newest — a failed run must never strip a valid approval.
  const reviews = await paginate<{ id: number; state: string; user?: { login?: string } }>(
    `/repos/${repo}/pulls/${prNumber}/reviews`,
  );
  for (const review of reviews) {
    if (!sameLogin(review.user?.login, botName)) continue;
    if (review.state !== 'APPROVED' || review.id === reviewId) continue;
    await rest('PUT', `/repos/${repo}/pulls/${prNumber}/reviews/${review.id}/dismissals`, {
      message: 'Superseded by a fresh Pavo review.',
      event: 'DISMISS',
    });
  }

  const resolvedCount = await resolveThreads(repo, prNumber, botName, options.resolvedCommentIds);

  // Praise threads require no action by definition, yet repos with
  // "require conversation resolution" rules treat them as merge blockers.
  // Resolve them immediately after posting.
  if (!salvaged) {
    await resolvePraiseThreads(repo, prNumber, botName, reviewId);
  }

  return {
    reviewId,
    event,
    inlineCount: payload.comments.length,
    demotedCount: demoted.length,
    droppedCount: dropped.length,
    dropped: dropped.map((d) => ({ path: d.comment.path, line: d.comment.line, reason: d.reason })),
    resolvedCount,
    salvaged,
  };
}

async function resolvePraiseThreads(
  repo: string,
  prNumber: number,
  botName: string,
  reviewId: number,
): Promise<void> {
  const comments = await paginate<{ id: number; pull_request_review_id?: number; body?: string }>(
    `/repos/${repo}/pulls/${prNumber}/comments`,
  );
  const praiseRootIds = comments
    .filter(
      (comment) =>
        comment.pull_request_review_id === reviewId &&
        (comment.body ?? '').startsWith(SEVERITY_EMOJI.praise),
    )
    .map((comment) => comment.id);
  if (praiseRootIds.length === 0) return;
  await resolveThreads(repo, prNumber, botName, praiseRootIds);
}

async function resolveThreads(
  repo: string,
  prNumber: number,
  botName: string,
  rootIds: number[],
): Promise<number> {
  if (!rootIds?.length) return 0;
  const [owner, name] = repo.split('/') as [string, string];
  const wanted = new Set(rootIds.slice(0, RESOLVE_LIMIT).map(Number));
  let resolvedCount = 0;
  let cursor: string | null = null;
  for (let page = 0; page < 10; page += 1) {
    const data: any = await graphql(
      `query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
        repository(owner: $owner, name: $name) {
          pullRequest(number: $number) {
            reviewThreads(first: 100, after: $cursor) {
              pageInfo { hasNextPage endCursor }
              nodes { id isResolved comments(first: 20) { nodes { databaseId author { login } } } }
            }
          }
        }
      }`,
      { owner, name, number: prNumber, ...(cursor ? { cursor } : {}) },
    );
    const connection = data.repository.pullRequest.reviewThreads;
    for (const thread of connection.nodes) {
      const root = thread.comments.nodes[0];
      if (!root || !wanted.has(root.databaseId)) continue;
      if (!sameLogin(root.author?.login, botName) || thread.isResolved) continue;
      // Never auto-resolve a thread a human replied to: that would silently
      // close their conversation and could bypass "require conversation
      // resolution" merge gates.
      const hasHumanReply = thread.comments.nodes.some(
        (comment: { author?: { login?: string } }) => !sameLogin(comment.author?.login, botName),
      );
      if (hasHumanReply) continue;
      await graphql(
        'mutation($threadId: ID!) { resolveReviewThread(input: {threadId: $threadId}) { thread { id } } }',
        { threadId: thread.id },
      );
      resolvedCount += 1;
    }
    if (!connection.pageInfo.hasNextPage) break;
    cursor = connection.pageInfo.endCursor;
  }
  return resolvedCount;
}
