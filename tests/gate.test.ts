import assert from 'node:assert/strict';
import test from 'node:test';

import { decide, resolveModel } from '../scripts/gate.ts';
import type { GateDecision, GateDeps, GateEvent, GateOptions } from '../scripts/gate.ts';

const BOT = 'k35o-bot[bot]';
const REPO = 'k35o/example';
const OPTIONS: GateOptions = {
  botName: BOT,
  repository: REPO,
  skipLabel: 'pavo:skip',
  reviewDrafts: false,
  allowBots: [],
  disabled: false,
};
const DEPS: GateDeps = { fetchPullRequest: () => null };

const pr = (overrides: Record<string, unknown> = {}) => ({
  number: 7,
  title: 'feat: x',
  body: 'desc',
  draft: false,
  labels: [],
  head: { sha: 'abc123', repo: { full_name: REPO } },
  base: { repo: { full_name: REPO } },
  ...overrides,
});

const prEvent = (
  action: string,
  prOverrides: Record<string, unknown> = {},
  payloadOverrides: Record<string, unknown> = {},
): GateEvent => ({
  name: 'pull_request',
  payload: {
    action,
    sender: { type: 'User', login: 'k8o' },
    pull_request: pr(prOverrides),
    ...payloadOverrides,
  },
});

test('opened は review になる', () => {
  const result = decide(prEvent('opened'), OPTIONS, DEPS) as Extract<
    GateDecision,
    { mode: 'review' }
  >;
  assert.equal(result.mode, 'review');
  assert.equal(result.pr.number, 7);
  assert.equal(result.pr.headSha, 'abc123');
});

test('synchronize / reopened も review になる', () => {
  assert.equal(decide(prEvent('synchronize'), OPTIONS, DEPS).mode, 'review');
  assert.equal(decide(prEvent('reopened'), OPTIONS, DEPS).mode, 'review');
  assert.equal(decide(prEvent('labeled'), OPTIONS, DEPS).mode, 'skip');
});

test('draft はスキップ、review_drafts で解除、ready_for_review は review', () => {
  assert.equal(decide(prEvent('opened', { draft: true }), OPTIONS, DEPS).mode, 'skip');
  assert.equal(
    decide(prEvent('opened', { draft: true }), { ...OPTIONS, reviewDrafts: true }, DEPS).mode,
    'review',
  );
  assert.equal(decide(prEvent('ready_for_review'), OPTIONS, DEPS).mode, 'review');
});

test('skip label / cross-repo PR / kill switch はスキップ', () => {
  assert.equal(
    decide(prEvent('opened', { labels: [{ name: 'pavo:skip' }] }), OPTIONS, DEPS).mode,
    'skip',
  );
  // head が別リポジトリ（本物の fork PR）
  assert.equal(
    decide(
      prEvent('opened', { head: { sha: 'x', repo: { full_name: 'other/fork' } } }),
      OPTIONS,
      DEPS,
    ).mode,
    'skip',
  );
  // head リポジトリが削除済み（null）も安全側でスキップ
  assert.equal(
    decide(prEvent('opened', { head: { sha: 'x', repo: null } }), OPTIONS, DEPS).mode,
    'skip',
  );
  assert.equal(decide(prEvent('opened'), { ...OPTIONS, disabled: true }, DEPS).mode, 'skip');
});

test('リポジトリ自体が fork でも、同一リポジトリ内の PR はレビューされる', () => {
  // head.repo.fork ではなく full_name の一致で判定していることの回帰テスト
  const inRepo = prEvent('opened', {
    head: { sha: 'abc', repo: { full_name: REPO, fork: true } },
    base: { repo: { full_name: REPO, fork: true } },
  });
  assert.equal(decide(inRepo, OPTIONS, DEPS).mode, 'review');
});

test('bot sender は allow_bots に載っているときだけ通る（自 bot は常に拒否）', () => {
  const renovate = prEvent('opened', {}, { sender: { type: 'Bot', login: 'renovate[bot]' } });
  assert.equal(decide(renovate, OPTIONS, DEPS).mode, 'skip');
  assert.equal(decide(renovate, { ...OPTIONS, allowBots: ['renovate'] }, DEPS).mode, 'review');

  const self = prEvent('opened', {}, { sender: { type: 'Bot', login: BOT } });
  assert.equal(decide(self, { ...OPTIONS, allowBots: ['k35o-bot'] }, DEPS).mode, 'skip');
});

test('review_requested は自 bot 宛のときだけ review', () => {
  const forBot = prEvent('review_requested', {}, { requested_reviewer: { login: BOT } });
  assert.equal(decide(forBot, OPTIONS, DEPS).mode, 'review');
  const forHuman = prEvent('review_requested', {}, { requested_reviewer: { login: 'k8o' } });
  assert.equal(decide(forHuman, OPTIONS, DEPS).mode, 'skip');
});

test('/pavo コマンドは PR を取得して review（draft と skip label より優先）', () => {
  const event: GateEvent = {
    name: 'issue_comment',
    payload: {
      action: 'created',
      sender: { type: 'User', login: 'k8o' },
      comment: { body: '/pavo review', author_association: 'OWNER' },
      issue: { number: 9, pull_request: {} },
    },
  };
  const deps: GateDeps = {
    fetchPullRequest: (number) => {
      assert.equal(number, 9);
      return pr({ number: 9, draft: true, labels: [{ name: 'pavo:skip' }] });
    },
  };
  const result = decide(event, OPTIONS, deps) as Extract<GateDecision, { mode: 'review' }>;
  assert.equal(result.mode, 'review');
  assert.equal(result.onDemand, true);
});

test('/pavo は信頼できる association 以外を拒否、通常コメントは無視', () => {
  const base: GateEvent = {
    name: 'issue_comment',
    payload: {
      action: 'created',
      sender: { type: 'User', login: 'someone' },
      comment: { body: '/pavo', author_association: 'NONE' },
      issue: { number: 9, pull_request: {} },
    },
  };
  assert.equal(decide(base, OPTIONS, DEPS).mode, 'skip');
  const chatter = structuredClone(base);
  chatter.payload.comment = { body: 'LGTM!', author_association: 'OWNER' };
  assert.equal(decide(chatter, OPTIONS, DEPS).mode, 'skip');
});

test('レビューコメント返信は convo、トップレベルコメントや外部ユーザーはスキップ', () => {
  const reply: GateEvent = {
    name: 'pull_request_review_comment',
    payload: {
      action: 'created',
      sender: { type: 'User', login: 'k8o' },
      comment: { id: 22, in_reply_to_id: 11, path: 'src/a.ts', author_association: 'OWNER' },
      pull_request: pr(),
    },
  };
  const result = decide(reply, OPTIONS, DEPS) as Extract<GateDecision, { mode: 'convo' }>;
  assert.equal(result.mode, 'convo');
  assert.deepEqual(result.convo, { rootId: 11 });

  const topLevel = structuredClone(reply);
  delete topLevel.payload.comment.in_reply_to_id;
  assert.equal(decide(topLevel, OPTIONS, DEPS).mode, 'skip');

  const outsider = structuredClone(reply);
  outsider.payload.comment.author_association = 'NONE';
  assert.equal(decide(outsider, OPTIONS, DEPS).mode, 'skip');

  const crossRepo = structuredClone(reply);
  crossRepo.payload.pull_request.head.repo = { full_name: 'other/fork' };
  assert.equal(decide(crossRepo, OPTIONS, DEPS).mode, 'skip');
});

test('pavo:deep ラベルで opus に切り替わる', () => {
  assert.equal(resolveModel('sonnet', ['pavo:deep']), 'opus');
  assert.equal(resolveModel('sonnet', []), 'sonnet');
});
