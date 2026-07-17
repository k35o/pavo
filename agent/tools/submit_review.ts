import { defineTool } from 'eve/tools';
import { z } from 'zod';

import { rest } from '../lib/github.ts';
import { postReview, type ReviewPolicy } from '../lib/review.ts';

// The model supplies findings only. The review target (repo / PR / head sha)
// is NOT taken from the model — it is bound to the dispatch context of the
// turn (ctx.session.auth.current.attributes, written by defaultGitHubAuth).
// Otherwise a malicious PR could steer the model to post an APPROVE onto a
// different PR in the same allowlisted org (confused deputy). Everything that
// must not be left to an LLM (filtering, anchor validation, the single POST,
// APPROVE decision, dismissals, thread resolution) runs here, in the app
// runtime, where the installation token never reaches the model or sandbox.

const finding = z.object({
  path: z.string().describe('リポジトリルートからの相対パス'),
  line: z.number().int().describe('diff の hunk に含まれる行番号（追加/文脈行は RIGHT、削除行は LEFT）'),
  side: z.enum(['RIGHT', 'LEFT']).default('RIGHT'),
  start_line: z.number().int().optional().describe('複数行指摘のときだけ。同一 hunk 内で line より小さいこと'),
  start_side: z.enum(['RIGHT', 'LEFT']).optional(),
  severity: z.enum(['critical', 'warning', 'suggestion', 'praise']),
  confidence: z.number().int().min(0).max(100).describe('80 未満は投稿されない（praise を除く）'),
  body: z.string().describe('指摘本文。severity 絵文字は書かない（システムが付与する）'),
  suggestion: z
    .string()
    .optional()
    .describe('対象行の置換だけで完結する修正がある場合のみ、置換後のコード（フェンスで囲まない）'),
});

function attribute(ctx: unknown, key: string): string | null {
  const attrs = (ctx as { session?: { auth?: { current?: { attributes?: Record<string, unknown> } } } })
    ?.session?.auth?.current?.attributes;
  const value = attrs?.[key];
  return typeof value === 'string' && value ? value : null;
}

export default defineTool({
  description:
    'レビュー結果を GitHub に投稿する。1 回のレビューセッションで必ず 1 回だけ、最後に呼ぶこと。' +
    '投稿先の PR はこのターンの起動元に固定されており、あなたが指定する必要はない。' +
    '投稿・絵文字付与・APPROVE 判定・古い承認の整理はシステム側が行う。',
  inputSchema: z.object({
    summary: z
      .string()
      .describe('PR 全体のサマリ: TL;DR、指摘の集計行、指摘の索引、確認した観点（指摘 0 件でも根拠を書く）'),
    verdict: z
      .enum(['approve', 'comment'])
      .describe('critical / warning が 1 件でもあれば comment。suggestion / praise だけなら approve 可'),
    comments: z.array(finding),
    resolved_comment_ids: z
      .array(z.number().int())
      .default([])
      .describe('コンテキストの既存スレッド一覧のうち、現在のコードで解消済みと確認できた rootId'),
  }),
  async execute(input, ctx) {
    // Authoritative target from the dispatch context — never from the model.
    const repo = attribute(ctx, 'repository');
    const prNumber = Number(attribute(ctx, 'pull_request_number'));
    if (!repo || !Number.isInteger(prNumber) || prNumber <= 0) {
      return { posted: false, error: 'no PR is bound to this turn; refusing to post' };
    }

    const allowlist = (process.env.PAVO_EVE_REPOS ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (!allowlist.includes(repo)) {
      return { posted: false, error: `repo ${repo} is not in PAVO_EVE_REPOS` };
    }

    // head sha comes from the PR itself, not the model.
    const pr = await rest<{ head?: { sha?: string } }>('GET', `/repos/${repo}/pulls/${prNumber}`);
    const headSha = pr.ok ? pr.body.head?.sha : undefined;
    if (!headSha) {
      return { posted: false, error: `could not resolve head sha for ${repo}#${prNumber}` };
    }

    const policy: ReviewPolicy = {
      ignore: (process.env.PAVO_EVE_IGNORE ?? '*.lock,pnpm-lock.yaml,package-lock.json,dist/**,build/**,**/__snapshots__/**')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
      minSeverity: 'suggestion',
      // Default COMMENT during the shadow phase: a prompt injection can then at
      // most suppress findings, never manufacture an APPROVE.
      approve: (process.env.PAVO_EVE_APPROVE ?? 'false') === 'true',
    };

    const result = await postReview({
      repo,
      prNumber,
      headSha,
      botName: `${process.env.GITHUB_APP_SLUG ?? 'k8o-bot'}[bot]`,
      policy,
      summary: input.summary,
      verdict: input.verdict,
      comments: input.comments,
      resolvedCommentIds: input.resolved_comment_ids,
      meta: { engine: 'eve', model: process.env.PAVO_EVE_MODEL ?? 'fugu-ultra' },
    });
    return { posted: true, ...result };
  },
});
