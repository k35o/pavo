// Gate: decide from the event payload whether this run reviews, replies, or
// skips — and resolve the effective per-repo configuration.
//
// All trigger logic lives here (not in action.yml conditions) so it can be
// unit-tested against fixture payloads.
//
// Repo-side configuration (.github/pavo.json / pavo.md / pavo-learnings.md)
// is read from the DEFAULT branch, not the PR head: a PR must not be able to
// weaken the rules it is reviewed under.
//
// Required env: GITHUB_EVENT_NAME, GITHUB_EVENT_PATH, GITHUB_REPOSITORY,
//   APP_SLUG, OUT_DIR
// Inputs via env: SKIP_LABEL, INSTRUCTIONS, EXTRA_PROMPT, MODEL, LANGUAGE,
//   APPROVE, MIN_SEVERITY, IGNORE_PATHS, ALLOW_BOTS, REVIEW_DRAFTS, PAVO_DISABLED

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { setOutputs, notice } from './lib/actions.mjs';
import { resolveConfig } from './lib/config.mjs';
import { ghJson } from './lib/gh.mjs';
import { requireEnv } from './env.mjs';

const TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
const COMMAND_PATTERN = /^\/pavo(?:\s+review)?\s*$/;
const DEEP_LABEL = 'pavo:deep';
const PR_BODY_LIMIT = 16000;

const skip = (reason) => ({ mode: 'skip', reason });

function normalizeBotLogin(login) {
  return login.replace(/\[bot\]$/, '');
}

function labelNames(labels) {
  return (labels ?? []).map((label) => label.name);
}

/**
 * A PR whose head lives in another repository (true fork PR) runs without
 * secrets. Note `head.repo.fork` is NOT this: it flags whether the head repo
 * itself is a fork of something, which is true for every in-repo PR on a
 * forked repository. A deleted head repo (null) is treated as cross-repo.
 */
function isCrossRepo(pr, repository) {
  const headRepo = pr.head?.repo?.full_name;
  const baseRepo = pr.base?.repo?.full_name ?? repository;
  return !headRepo || headRepo !== baseRepo;
}

/**
 * @param {{name: string, payload: any}} event
 * @param {{botName: string, repository: string, skipLabel: string,
 *   reviewDrafts: boolean, allowBots: string[], disabled: boolean}} options
 * @param {{fetchPullRequest: (number: number) => any}} deps
 * @returns {{mode: 'review' | 'convo' | 'skip', reason?: string,
 *   pr?: {number: number, headSha: string, labels: string[], title: string, body: string},
 *   convo?: {rootId: number}, onDemand?: boolean}}
 */
export function decide(event, options, deps) {
  const { name, payload } = event;
  const { botName, repository, skipLabel, reviewDrafts, allowBots, disabled } = options;

  if (disabled) return skip('kill switch (PAVO_DISABLED)');

  const sender = payload.sender ?? {};
  if (sender.type === 'Bot') {
    if (sender.login === botName) return skip('event triggered by Pavo itself');
    if (!allowBots.includes(normalizeBotLogin(sender.login ?? ''))) {
      return skip(`sender is a bot not in allow_bots (${sender.login})`);
    }
  }

  const shapePr = (pr, extra = {}) => ({
    mode: 'review',
    pr: {
      number: pr.number,
      headSha: pr.head.sha,
      labels: labelNames(pr.labels),
      title: pr.title ?? '',
      body: pr.body ?? '',
    },
    ...extra,
  });

  if (name === 'pull_request') {
    const pr = payload.pull_request;
    const action = payload.action;
    if (action === 'review_requested') {
      if (payload.requested_reviewer?.login !== botName) {
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
    return shapePr(pr);
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
    return shapePr(pr, { onDemand: true });
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
    return { ...shapePr(pr), mode: 'convo', convo: { rootId: comment.in_reply_to_id } };
  }

  return skip(`unsupported event: ${name}`);
}

/**
 * Pick the model: the pavo:deep label forces a deep review regardless of
 * the configured default.
 * @param {string} configuredModel
 * @param {string[]} labels
 * @returns {string}
 */
export function resolveModel(configuredModel, labels) {
  return labels.includes(DEEP_LABEL) ? 'opus' : configuredModel;
}

function fetchRepoFile(repository, filePath) {
  const file = ghJson(['api', `repos/${repository}/contents/${filePath}`], {
    allowFailure: true,
  });
  if (!file?.content) return null;
  return Buffer.from(file.content, 'base64').toString('utf8');
}

function fetchRepoConfig(repository) {
  const raw = fetchRepoFile(repository, '.github/pavo.json');
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch (cause) {
    throw new Error('.github/pavo.json is not valid JSON', { cause });
  }
}

function main() {
  const payload = JSON.parse(fs.readFileSync(requireEnv('GITHUB_EVENT_PATH'), 'utf8'));
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
  let repoConfig = null;
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
      allowBots: (process.env.ALLOW_BOTS ?? '')
        .split(',')
        .map((name) => normalizeBotLogin(name.trim()))
        .filter(Boolean),
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

  const outDir = requireEnv('OUT_DIR');
  fs.mkdirSync(outDir, { recursive: true });
  const sideFiles = {};
  for (const [key, filePath] of [
    ['repo_context_file', '.github/pavo.md'],
    ['learnings_file', '.github/pavo-learnings.md'],
  ]) {
    const content = fetchRepoFile(repository, filePath);
    if (content === null) {
      sideFiles[key] = '';
      continue;
    }
    const target = path.join(outDir, path.basename(filePath));
    fs.writeFileSync(target, content);
    sideFiles[key] = target;
  }

  const body = decision.pr.body ?? '';
  setOutputs({
    mode: decision.mode,
    pr_number: String(decision.pr.number),
    head_sha: decision.pr.headSha,
    pr_title: decision.pr.title,
    pr_body: body.length > PR_BODY_LIMIT ? `${body.slice(0, PR_BODY_LIMIT)}…(truncated)` : body,
    on_demand: decision.onDemand ? 'true' : 'false',
    root_id: decision.convo ? String(decision.convo.rootId) : '',
    model,
    config: JSON.stringify({ ...config, model }),
    ...sideFiles,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
