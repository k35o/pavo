// Gate: decide from the event payload whether this run reviews, replies, or
// skips — and resolve the effective per-repo configuration.
//
// All trigger logic lives here (not in action.yml conditions) so it can be
// unit-tested against fixture payloads.
//
// Repo-side configuration (.github/pavo.json / pavo.md) is read from the
// DEFAULT branch, not the PR head: a PR must not be able to weaken the rules
// it is reviewed under. Learnings are the exception — post-reply.ts writes
// them to the pavo/learnings branch (default branches typically reject direct
// commits), so they are read from there with a default-branch fallback.
//
// Required env: GITHUB_EVENT_NAME, GITHUB_EVENT_PATH, GITHUB_REPOSITORY,
//   APP_SLUG, OUT_DIR
// Inputs via env: SKIP_LABEL, INSTRUCTIONS, EXTRA_PROMPT, MODEL, LANGUAGE,
//   APPROVE, MIN_SEVERITY, IGNORE_PATHS, ALLOW_BOTS, REVIEW_DRAFTS, PAVO_DISABLED

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { setOutputs, notice } from './lib/actions.ts';
import { normalizeLogin, sameLogin } from './lib/bot.ts';
import { parseList, parseRepoConfig, resolveConfig, type RepoConfig } from './lib/config.ts';
import { gh, ghJson } from './lib/gh.ts';
import { requireEnv } from './lib/env.ts';

const TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
const COMMAND_PATTERN = /^\/pavo(?:\s+review)?\s*$/;
const DEEP_LABEL = 'pavo:deep';
const PR_BODY_LIMIT = 16000;
const CONVENTIONS_LIMIT = 8000;
const CONVENTION_FILES = ['CLAUDE.md', 'AGENTS.md', '.github/CLAUDE.md'];

/** Untyped webhook payload — only the fields we touch are accessed. */
type Payload = any;

export interface GateEvent {
  name: string;
  payload: Payload;
}

export interface GateOptions {
  botName: string;
  repository: string;
  skipLabel: string;
  reviewDrafts: boolean;
  allowBots: string[];
  disabled: boolean;
}

export interface GateDeps {
  fetchPullRequest: (number: number) => Payload | null;
}

export interface GatePr {
  number: number;
  headSha: string;
  labels: string[];
  title: string;
  body: string;
}

export type GateDecision =
  | { mode: 'skip'; reason: string }
  | { mode: 'review'; pr: GatePr; onDemand?: boolean }
  | { mode: 'convo'; pr: GatePr; convo: { rootId: number } };

const skip = (reason: string): GateDecision => ({ mode: 'skip', reason });

function labelNames(labels: { name: string }[] | undefined): string[] {
  return (labels ?? []).map((label) => label.name);
}

/**
 * A PR whose head lives in another repository (true fork PR) runs without
 * secrets. Note `head.repo.fork` is NOT this: it flags whether the head repo
 * itself is a fork of something, which is true for every in-repo PR on a
 * forked repository. A deleted head repo (null) is treated as cross-repo.
 */
function isCrossRepo(pr: Payload, repository: string): boolean {
  const headRepo = pr.head?.repo?.full_name;
  const baseRepo = pr.base?.repo?.full_name ?? repository;
  return !headRepo || headRepo !== baseRepo;
}

export function decide(event: GateEvent, options: GateOptions, deps: GateDeps): GateDecision {
  const { name, payload } = event;
  const { botName, repository, skipLabel, reviewDrafts, allowBots, disabled } = options;

  if (disabled) return skip('kill switch (PAVO_DISABLED)');

  const sender = payload.sender ?? {};
  if (sender.type === 'Bot') {
    if (sameLogin(sender.login, botName)) return skip('event triggered by Pavo itself');
    if (!allowBots.includes(normalizeLogin(sender.login ?? ''))) {
      return skip(`sender is a bot not in allow_bots (${sender.login})`);
    }
  }

  const shapePr = (pr: Payload): GatePr => ({
    number: pr.number,
    headSha: pr.head.sha,
    labels: labelNames(pr.labels),
    title: pr.title ?? '',
    body: pr.body ?? '',
  });

  if (name === 'pull_request') {
    const pr = payload.pull_request;
    const action = payload.action;
    if (action === 'review_requested') {
      if (!sameLogin(payload.requested_reviewer?.login, botName)) {
        return skip('review requested for someone else');
      }
    } else if (!['opened', 'synchronize', 'reopened', 'ready_for_review'].includes(action)) {
      return skip(`unsupported pull_request action: ${action}`);
    }
    if (isCrossRepo(pr, repository)) return skip('cross-repository PR (secrets unavailable)');
    if (pr.draft && !reviewDrafts) return skip('draft PR (enable with review_drafts)');
    if (labelNames(pr.labels).includes(skipLabel)) {
      return skip(`skip label present (${skipLabel})`);
    }
    return { mode: 'review', pr: shapePr(pr) };
  }

  if (name === 'issue_comment') {
    if (payload.action !== 'created') return skip(`unsupported action: ${payload.action}`);
    const comment = payload.comment ?? {};
    if (!COMMAND_PATTERN.test((comment.body ?? '').trim())) {
      return skip('not a /pavo command');
    }
    if (!payload.issue?.pull_request) return skip('/pavo on a plain issue');
    if (!TRUSTED_ASSOCIATIONS.has(comment.author_association)) {
      return skip(`author_association not trusted (${comment.author_association})`);
    }
    const pr = deps.fetchPullRequest(payload.issue.number);
    if (!pr) return skip('failed to fetch the PR for /pavo');
    if (isCrossRepo(pr, repository)) return skip('cross-repository PR (secrets unavailable)');
    // An explicit command is a stronger signal than the standing skip label
    // or draft state, so it overrides both.
    return { mode: 'review', pr: shapePr(pr), onDemand: true };
  }

  if (name === 'pull_request_review_comment') {
    if (payload.action !== 'created') return skip(`unsupported action: ${payload.action}`);
    const comment = payload.comment ?? {};
    if (!comment.in_reply_to_id) return skip('top-level review comment, not a reply');
    if (sender.type !== 'Bot' && !TRUSTED_ASSOCIATIONS.has(comment.author_association)) {
      return skip(`author_association not trusted (${comment.author_association})`);
    }
    const pr = payload.pull_request;
    if (isCrossRepo(pr, repository)) return skip('cross-repository PR (secrets unavailable)');
    if (labelNames(pr.labels).includes(skipLabel)) {
      return skip(`skip label present (${skipLabel})`);
    }
    return { mode: 'convo', pr: shapePr(pr), convo: { rootId: comment.in_reply_to_id } };
  }

  return skip(`unsupported event: ${name}`);
}

/**
 * Pick the model: the pavo:deep label forces a deep review regardless of
 * the configured default.
 */
export function resolveModel(configuredModel: string, labels: string[]): string {
  return labels.includes(DEEP_LABEL) ? 'opus' : configuredModel;
}

function fetchRepoFile(repository: string, filePath: string, ref?: string): string | null {
  const endpoint = ref
    ? `repos/${repository}/contents/${filePath}?ref=${ref}`
    : `repos/${repository}/contents/${filePath}`;
  const result = gh(['api', endpoint], { allowFailure: true });
  if (!result.ok) {
    // Only 404 means "file (or ref) does not exist". Anything else (403 from
    // a missing Contents permission, rate limit, outage) must not silently
    // review with the repo settings dropped.
    if (result.stderr.includes('HTTP 404')) return null;
    throw new Error(`Failed to read ${filePath}: ${result.stderr || result.stdout}`);
  }
  const file = JSON.parse(result.stdout) as { content?: string };
  if (!file?.content) return null;
  return Buffer.from(file.content, 'base64').toString('utf8');
}

function fetchRepoConfig(repository: string): RepoConfig | null {
  const raw = fetchRepoFile(repository, '.github/pavo.json');
  return raw === null ? null : parseRepoConfig(raw);
}

function main(): void {
  const payload = JSON.parse(fs.readFileSync(requireEnv('GITHUB_EVENT_PATH'), 'utf8')) as Payload;
  const eventName = requireEnv('GITHUB_EVENT_NAME');
  const repository = requireEnv('GITHUB_REPOSITORY');
  const appSlug = requireEnv('APP_SLUG');
  const botName = `${appSlug}[bot]`;
  const inputs = {
    instructions: process.env.INSTRUCTIONS,
    extraPrompt: process.env.EXTRA_PROMPT,
    model: process.env.MODEL,
    language: process.env.LANGUAGE,
    approve: process.env.APPROVE,
    minSeverity: process.env.MIN_SEVERITY,
    ignorePaths: process.env.IGNORE_PATHS,
    reviewDrafts: process.env.REVIEW_DRAFTS,
  };

  // The repo config can flip review_drafts, so it must be known before the
  // draft check — but only draft PRs need it that early. Everything else
  // fetches lazily after the (cheap) decision.
  let repoConfig: RepoConfig | null = null;
  let configFetched = false;
  if (eventName === 'pull_request' && payload.pull_request?.draft === true) {
    repoConfig = fetchRepoConfig(repository);
    configFetched = true;
  }
  let config = resolveConfig(inputs, repoConfig);

  const decision = decide(
    { name: eventName, payload },
    {
      botName,
      repository,
      skipLabel: process.env.SKIP_LABEL || 'pavo:skip',
      reviewDrafts: config.reviewDrafts,
      allowBots: parseList(process.env.ALLOW_BOTS).map(normalizeLogin).filter(Boolean),
      disabled: (process.env.PAVO_DISABLED || '').toLowerCase() === 'true',
    },
    {
      fetchPullRequest: (number) =>
        ghJson(['api', `repos/${repository}/pulls/${number}`], { allowFailure: true }),
    },
  );

  if (decision.mode === 'skip') {
    notice(`Pavo skipped: ${decision.reason}`);
    setOutputs({ mode: 'skip', reason: decision.reason });
    return;
  }

  if (!configFetched) {
    repoConfig = fetchRepoConfig(repository);
    config = resolveConfig(inputs, repoConfig);
  }
  const model = resolveModel(config.model, decision.pr.labels);
  const deep = decision.pr.labels.includes(DEEP_LABEL);

  const outDir = requireEnv('OUT_DIR');
  fs.mkdirSync(outDir, { recursive: true });
  const sideFiles: Record<string, string> = {};
  // Learnings live on the pavo/learnings branch (post-reply.ts writes there
  // because default branches are typically PR-only), with a default-branch
  // fallback for repos that maintain the file by hand.
  for (const [key, filePath, ref] of [
    ['repo_context_file', '.github/pavo.md', undefined],
    ['learnings_file', '.github/pavo-learnings.md', 'pavo/learnings'],
  ] as const) {
    const content =
      fetchRepoFile(repository, filePath, ref) ??
      (ref ? fetchRepoFile(repository, filePath) : null);
    if (content === null) {
      sideFiles[key] = '';
      continue;
    }
    const target = path.join(outDir, path.basename(filePath));
    fs.writeFileSync(target, content);
    sideFiles[key] = target;
  }

  // Project conventions also come from the DEFAULT branch, for the same
  // reason as pavo.json: a PR must not rewrite the conventions it is
  // reviewed under. The PR-head copy still shows up as a reviewable diff.
  sideFiles.conventions_file = '';
  for (const candidate of CONVENTION_FILES) {
    const conventions = fetchRepoFile(repository, candidate);
    if (conventions === null) continue;
    const target = path.join(outDir, 'repo-conventions.md');
    fs.writeFileSync(
      target,
      conventions.length > CONVENTIONS_LIMIT
        ? `${conventions.slice(0, CONVENTIONS_LIMIT)}…(truncated)`
        : conventions,
    );
    sideFiles.conventions_file = target;
    break;
  }

  const body = decision.pr.body ?? '';
  setOutputs({
    mode: decision.mode,
    pr_number: String(decision.pr.number),
    head_sha: decision.pr.headSha,
    pr_title: decision.pr.title,
    pr_body: body.length > PR_BODY_LIMIT ? `${body.slice(0, PR_BODY_LIMIT)}…(truncated)` : body,
    on_demand: decision.mode === 'review' && decision.onDemand ? 'true' : 'false',
    root_id: decision.mode === 'convo' ? String(decision.convo.rootId) : '',
    model,
    deep: deep ? 'true' : 'false',
    config: JSON.stringify({ ...config, model }),
    ...sideFiles,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
