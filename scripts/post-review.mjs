// Turn Claude's structured review output into a GitHub Review, deterministically.
//
// Claude only produces findings JSON (validated by --json-schema). This script
// owns everything that must not be left to an LLM: severity emoji, confidence
// and ignore filtering, anchor validation against the actual diff, the
// APPROVE/COMMENT decision, the single POST (with a 422 fallback), dismissing
// stale APPROVEs *after* the new review exists, thread resolution, and metrics.
//
// Required env: REPO, PR_NUMBER, HEAD_SHA, BOT_NAME, CONFIG, STRUCTURED_OUTPUT
// Optional env: RUN_URL, PAVO_REF

import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { addStepSummary, notice, warning } from './lib/actions.mjs';
import { sameLogin } from './lib/bot.mjs';
import { severityRank } from './lib/config.mjs';
import { gh, ghGraphql, ghJson, ghPaginate } from './lib/gh.mjs';
import { matchesAnyGlob } from './lib/glob.mjs';
import { isValidAnchor, parsePatchLines } from './lib/patch.mjs';
import { requireEnv } from './env.mjs';

const CONFIDENCE_THRESHOLD = 80;
const REVIEW_BODY_LIMIT = 60000;
const RESOLVE_LIMIT = 20;

export const SEVERITY_EMOJI = {
  critical: '🔴',
  warning: '🟡',
  suggestion: '🔵',
  praise: '👍',
};

/**
 * Render one inline comment body: emoji prefix plus optional suggestion fence.
 * @param {{severity: string, body: string, suggestion?: string}} comment
 * @returns {string}
 */
export function renderCommentBody(comment) {
  let body = `${SEVERITY_EMOJI[comment.severity]} ${comment.body.trim()}`;
  if (comment.suggestion) {
    // A suggestion containing a triple-backtick fence needs a longer outer fence.
    const fence = comment.suggestion.includes('```') ? '````' : '```';
    body += `\n\n${fence}suggestion\n${comment.suggestion.replace(/\n$/, '')}\n${fence}`;
  }
  return body;
}

/**
 * Filter and split raw findings into inline comments and demoted notes.
 *
 * @param {Array<Record<string, any>>} rawComments
 * @param {{ignore: string[], minSeverity: string}} config
 * @param {Map<string, {right: Map<number, number>, left: Map<number, number>} | null>} fileLines
 *   per-path commentable lines; a missing path means the file is not in the diff
 * @returns {{inline: any[], demoted: {comment: any, reason: string}[],
 *   dropped: {comment: any, reason: string}[]}}
 */
export function partitionComments(rawComments, config, fileLines) {
  const inline = [];
  const demoted = [];
  const dropped = [];
  const threshold = severityRank(config.minSeverity);

  for (const raw of rawComments ?? []) {
    const comment = {
      path: String(raw.path ?? ''),
      line: Number(raw.line),
      side: raw.side === 'LEFT' ? 'LEFT' : 'RIGHT',
      start_line: raw.start_line == null ? undefined : Number(raw.start_line),
      start_side: raw.start_side === 'LEFT' ? 'LEFT' : raw.start_side === 'RIGHT' ? 'RIGHT' : undefined,
      severity: String(raw.severity ?? 'suggestion'),
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
    if (matchesAnyGlob(comment.path, config.ignore)) {
      dropped.push({ comment, reason: 'ignored path' });
      continue;
    }
    if (comment.severity !== 'praise' && comment.confidence < CONFIDENCE_THRESHOLD) {
      dropped.push({ comment, reason: `confidence ${comment.confidence} < ${CONFIDENCE_THRESHOLD}` });
      continue;
    }

    // Praise is thresholded like a suggestion: quiet configs stay quiet.
    const rank = comment.severity === 'praise' ? severityRank('suggestion') : severityRank(comment.severity);
    if (rank < threshold) {
      demoted.push({ comment, reason: 'below min_severity' });
      continue;
    }

    if (!fileLines.has(comment.path)) {
      demoted.push({ comment, reason: 'file not in diff' });
      continue;
    }
    if (!isValidAnchor(comment, fileLines.get(comment.path))) {
      demoted.push({ comment, reason: 'line not in diff hunks' });
      continue;
    }
    inline.push(comment);
  }
  return { inline, demoted, dropped };
}

/**
 * @param {string} verdict
 * @param {any[]} inline kept inline comments
 * @param {{comment: any}[]} demoted
 * @param {{approve: boolean}} config
 * @returns {'APPROVE' | 'COMMENT'}
 */
export function decideEvent(verdict, inline, demoted, config) {
  if (!config.approve || verdict !== 'approve') return 'COMMENT';
  const blocking = [...inline, ...demoted.map((entry) => entry.comment)].some((comment) =>
    ['critical', 'warning'].includes(comment.severity),
  );
  return blocking ? 'COMMENT' : 'APPROVE';
}

/**
 * @returns {string} final review body with demoted notes and the meta marker
 */
export function buildReviewBody({ summary, demoted, meta }) {
  let body = summary.trim();
  if (demoted.length > 0) {
    const items = demoted
      .map(
        ({ comment, reason }) =>
          `- ${SEVERITY_EMOJI[comment.severity]} \`${comment.path}:${comment.line}\` — ${comment.body.replaceAll('\n', ' ')}` +
          (reason === 'line not in diff hunks' || reason === 'file not in diff'
            ? ''
            : ` _(${reason})_`),
      )
      .join('\n');
    body += `\n\n<details>\n<summary>その他の観察 (${demoted.length})</summary>\n\n${items}\n\n</details>`;
  }
  if (body.length > REVIEW_BODY_LIMIT) {
    body = `${body.slice(0, REVIEW_BODY_LIMIT)}\n\n…(truncated)`;
  }
  return `${body}\n\n<!-- pavo:meta ${JSON.stringify(meta)} -->`;
}

function fetchFileLines(repo, prNumber) {
  const files = ghPaginate(`repos/${repo}/pulls/${prNumber}/files`);
  const map = new Map();
  for (const file of files) {
    map.set(file.filename, file.patch ? parsePatchLines(file.patch) : null);
  }
  return map;
}

function postReview(repo, prNumber, payload) {
  return ghJson(['api', '--method', 'POST', `repos/${repo}/pulls/${prNumber}/reviews`, '--input', '-'], {
    input: JSON.stringify(payload),
  });
}

function dismissStaleApprovals(repo, prNumber, botName, keepReviewId) {
  const reviews = ghPaginate(`repos/${repo}/pulls/${prNumber}/reviews`);
  for (const review of reviews) {
    if (review.user?.login !== botName) continue;
    if (review.state !== 'APPROVED') continue;
    if (review.id === keepReviewId) continue;
    const result = gh(
      [
        'api',
        '--method',
        'PUT',
        `repos/${repo}/pulls/${prNumber}/reviews/${review.id}/dismissals`,
        '-f',
        'message=Superseded by a fresh Pavo review.',
        '-f',
        'event=DISMISS',
      ],
      { allowFailure: true },
    );
    if (result.ok) notice(`Dismissed stale APPROVE review ${review.id}`);
    else warning(`Failed to dismiss review ${review.id}: ${result.stderr}`);
  }
}

function resolveThreads(repo, prNumber, botName, rootIds) {
  if (!rootIds?.length) return 0;
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
  const wanted = new Set(rootIds.slice(0, RESOLVE_LIMIT).map(Number));
  let resolvedCount = 0;
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
      if (!root || !wanted.has(root.databaseId)) continue;
      // Only threads Pavo itself started: never auto-resolve human discussions.
      if (!sameLogin(root.author?.login, botName) || thread.isResolved) continue;
      try {
        ghGraphql(
          'mutation($threadId: ID!) { resolveReviewThread(input: {threadId: $threadId}) { thread { id } } }',
          { threadId: thread.id },
        );
        resolvedCount += 1;
      } catch (error) {
        warning(`Failed to resolve thread ${thread.id}: ${error.message}`);
      }
    }
    if (!connection.pageInfo.hasNextPage) break;
    cursor = connection.pageInfo.endCursor;
  }
  return resolvedCount;
}

function main() {
  const repo = requireEnv('REPO');
  const prNumber = requireEnv('PR_NUMBER');
  const headSha = requireEnv('HEAD_SHA');
  const botName = requireEnv('BOT_NAME');
  const config = JSON.parse(requireEnv('CONFIG'));
  const output = JSON.parse(requireEnv('STRUCTURED_OUTPUT'));

  if (typeof output.summary !== 'string' || !output.summary.trim()) {
    throw new Error('Structured output has no summary — refusing to post an empty review.');
  }

  const fileLines = fetchFileLines(repo, prNumber);
  const { inline, demoted, dropped } = partitionComments(output.comments, config, fileLines);
  const event = decideEvent(output.verdict, inline, demoted, config);
  const body = buildReviewBody({
    summary: output.summary,
    demoted,
    meta: {
      sha: headSha,
      instructions: config.instructions,
      model: config.model,
      ref: process.env.PAVO_REF ?? '',
      run: process.env.RUN_URL ?? '',
    },
  });

  const payload = {
    commit_id: headSha,
    body,
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

  let review;
  try {
    review = postReview(repo, prNumber, payload);
  } catch (error) {
    // A single rejected anchor 422s the whole review. Salvage everything into
    // the body rather than losing the review (and the dismissed APPROVE) entirely.
    warning(`Review POST failed (${error.message}); retrying with all comments in the body.`);
    const salvaged = inline.map((comment) => ({ comment, reason: 'inline post failed' }));
    review = postReview(repo, prNumber, {
      commit_id: headSha,
      event,
      body: buildReviewBody({
        summary: output.summary,
        demoted: [...salvaged, ...demoted],
        meta: {
          sha: headSha,
          instructions: config.instructions,
          model: config.model,
          ref: process.env.PAVO_REF ?? '',
          run: process.env.RUN_URL ?? '',
        },
      }),
      comments: [],
    });
  }
  notice(`Posted review ${review.id} (${event}) with ${payload.comments.length} inline comments.`);

  dismissStaleApprovals(repo, prNumber, botName, review.id);
  const resolvedCount = resolveThreads(repo, prNumber, botName, output.resolved_comment_ids);

  const counts = { critical: 0, warning: 0, suggestion: 0, praise: 0 };
  for (const comment of inline) counts[comment.severity] += 1;
  addStepSummary(
    `### Pavo review\n\n` +
      `| event | 🔴 | 🟡 | 🔵 | 👍 | demoted | dropped | resolved |\n` +
      `| --- | --- | --- | --- | --- | --- | --- | --- |\n` +
      `| ${event} | ${counts.critical} | ${counts.warning} | ${counts.suggestion} | ${counts.praise} | ${demoted.length} | ${dropped.length} | ${resolvedCount} |\n`,
  );
  if (dropped.length > 0) {
    notice(`Dropped ${dropped.length} findings: ${dropped.map((d) => `${d.comment.path}:${d.comment.line} (${d.reason})`).join(', ')}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
