import { defineTool } from 'eve/tools';
import { z } from 'zod';

import { postReview, type ReviewPolicy } from '../lib/review.ts';

// The model supplies findings; this tool owns every side effect (filtering,
// anchor validation, the single POST + salvage, APPROVE decision, stale
// dismissals, thread resolution). Runs in the app runtime — the installation
// token never reaches the model or the sandbox.

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

export default defineTool({
  description:
    'レビュー結果を GitHub に投稿する。1 回のレビューセッションで必ず 1 回だけ、最後に呼ぶこと。' +
    '投稿・絵文字付与・APPROVE 判定・古い承認の整理はシステム側が行う。',
  inputSchema: z.object({
    repo: z.string().describe('owner/name 形式。コンテキストに示された値をそのまま使う'),
    pr_number: z.number().int(),
    head_sha: z.string().describe('コンテキストに示されたレビュー対象 commit SHA'),
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
  async execute(input) {
    const allowlist = (process.env.PAVO_EVE_REPOS ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (!allowlist.includes(input.repo)) {
      return { posted: false, error: `repo ${input.repo} is not in PAVO_EVE_REPOS` };
    }

    const policy: ReviewPolicy = {
      ignore: (process.env.PAVO_EVE_IGNORE ?? '*.lock,pnpm-lock.yaml,package-lock.json,dist/**,build/**,**/__snapshots__/**')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
      minSeverity: 'suggestion',
      approve: (process.env.PAVO_EVE_APPROVE ?? 'true') === 'true',
    };

    const result = await postReview({
      repo: input.repo,
      prNumber: input.pr_number,
      headSha: input.head_sha,
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
