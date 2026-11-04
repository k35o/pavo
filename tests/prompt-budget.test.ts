import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import test from 'node:test';

import { buildPromptWithinBudget, buildReviewPrompt } from '../scripts/build-review-prompt.ts';
import type { BuildReviewPromptParams } from '../scripts/build-review-prompt.ts';
import { resolveConfig } from '../scripts/lib/config.ts';
import type { ChangedFileEntry, ReviewContext, ThreadSummary } from '../scripts/lib/types.ts';

const ROOT = new URL('..', import.meta.url).pathname;

// Linux は環境変数 1 本（`NAME=value` と終端の NUL）が 32 ページを超えるプロセスを
// E2BIG で起動しない。runner はこれを "Argument list too long" と報告する。
const MAX_ARG_STRLEN = 32 * 4096;

const envEntryBytes = (name: string, value: string): number =>
  Buffer.byteLength(`${name}=${value}`) + 1;

// claude-code-action の run ステップは prompt を PROMPT と、全 input を toJson した
// ALL_INPUTS の 2 か所で受け取る。ALL_INPUTS は runner の toJson と同じく字下げ 2 で整形する。
const allInputs = (prompt: string): string =>
  JSON.stringify(
    {
      claude_code_oauth_token: '***',
      github_token: '***',
      bot_id: '268958302',
      bot_name: 'k8o-bot[bot]',
      allowed_bots: '',
      prompt,
      claude_args: [
        '--model sonnet',
        '--max-turns 60',
        '--setting-sources user',
        '--allowedTools "Read,Grep,Glob,Bash(gh pr diff:*),Bash(gh pr view:*)"',
        '--disallowedTools "Read(./.git/**),Grep(./.git/**)"',
        `--json-schema '${JSON.stringify(JSON.parse(fs.readFileSync(`${ROOT}scripts/schemas/review.json`, 'utf8')))}'`,
      ].join('\n'),
    },
    null,
    2,
  );

const file = (
  filename: string,
  status: string,
  additions: number,
  deletions: number,
  hasPatch = true,
): ChangedFileEntry => ({ filename, status, additions, deletions, hasPatch });

const range = <T>(count: number, make: (index: number) => T): T[] =>
  Array.from({ length: count }, (_, index) => make(index));

const removed = (count: number): ChangedFileEntry[] =>
  range(count, (i) => file(`apps/main/src/app/_components/legacy-${i}/legacy-${i}.stories.tsx`, 'removed', 0, 40));

// 内容の変わらない rename（git の R100）。GitHub は patch を返さない。
const pureRenames = (count: number): ChangedFileEntry[] =>
  range(count, (i) => file(`apps/main/src/components/site/moved-${i}/moved-${i}.module.css`, 'renamed', 0, 0, false));

const modified = (count: number): ChangedFileEntry[] =>
  range(count, (i) => file(`apps/main/src/routes/page-${i}/page-${i}.tsx`, 'modified', 12, 3));

const thread = (overrides: Partial<ThreadSummary>): ThreadSummary => ({
  rootId: 1,
  path: 'src/a.ts',
  line: 1,
  isResolved: false,
  isOutdated: false,
  byPavo: true,
  repliesTruncated: false,
  comments: [{ author: 'k8o-bot', isBot: true, body: '指摘' }],
  ...overrides,
});

const context = (overrides: Partial<ReviewContext> = {}): ReviewContext => ({
  botName: 'k8o-bot[bot]',
  threads: [],
  droppedThreads: 0,
  reviews: [],
  issueComments: [],
  lastReviewedSha: null,
  sameAsLastReview: false,
  changedSinceLastReview: null,
  diffDir: '/home/runner/work/_temp/pavo/diff',
  changedFilesPath: '/home/runner/work/_temp/pavo/changed-files.txt',
  changedFiles: [],
  ...overrides,
});

const params = (overrides: Partial<BuildReviewPromptParams> = {}): BuildReviewPromptParams => ({
  actionPath: ROOT,
  workspace: null,
  config: { ...resolveConfig({}, null), instructions: 'default,nextjs,typescript' },
  repo: 'k35o/k8o',
  prNumber: '2318',
  prTitle: 'feat(main): k8o.me を Next から k8ordo に切り替える',
  prBody: '## 概要\n\n'.padEnd(3000, 'あ'),
  headSha: 'f25ce8ca47a6f68f0390490f1a9e65f46c2bb60c',
  context: null,
  onDemand: false,
  // gate.ts は規約ファイルを 8,000 文字で切る。日本語なら 24KB になる。
  conventionsMd: '# CLAUDE.md\n\n'.padEnd(8000, 'い'),
  ...overrides,
});

// k35o/k8o#2318 と同じ内訳: 1,325 件のうち削除 709・内容の変わらない rename 534。
const k8o2318 = (): ChangedFileEntry[] => [
  ...removed(709),
  ...pureRenames(534),
  ...modified(65),
  ...range(14, (i) => file(`apps/main/src/components/site/edited-${i}/edited-${i}.tsx`, 'renamed', 4, 2)),
  ...range(3, (i) => file(`apps/main/src/routes/new-${i}.tsx`, 'added', 30, 0)),
];

test('1,325 ファイルの PR でも、claude-code-action が渡す環境変数が 1 本あたりの上限に収まる', () => {
  const input = params({ context: context({ changedFiles: k8o2318() }) });

  const { prompt } = buildPromptWithinBudget(input);

  assert.ok(prompt !== null);
  assert.ok(envEntryBytes('PROMPT', prompt) <= MAX_ARG_STRLEN);
  assert.ok(envEntryBytes('ALL_INPUTS', allInputs(prompt)) <= MAX_ARG_STRLEN);
  // 縮めなければこの入力は上限を超える（試験の前提が崩れていないことの確認）
  assert.ok(envEntryBytes('ALL_INPUTS', allInputs(buildReviewPrompt(input))) > MAX_ARG_STRLEN);
});

test(
  '1,325 ファイルの PR のプロンプトを環境変数に載せても、Linux でプロセスを起動できる',
  { skip: process.platform !== 'linux' && '環境変数 1 本あたりの上限は Linux のもの' },
  () => {
    const input = params({ context: context({ changedFiles: k8o2318() }) });
    const launch = (prompt: string) =>
      spawnSync(process.execPath, ['-e', ''], { env: { PROMPT: prompt, ALL_INPUTS: allInputs(prompt) } });

    const { prompt } = buildPromptWithinBudget(input);

    assert.ok(prompt !== null);
    assert.equal(launch(prompt).error, undefined);
    assert.equal((launch(buildReviewPrompt(input)).error as NodeJS.ErrnoException | undefined)?.code, 'E2BIG');
  },
);

test('削除と内容の変わらない rename は件数だけになり、全件の一覧ファイルを案内する', () => {
  const { prompt, reductions } = buildPromptWithinBudget(
    params({ context: context({ changedFiles: k8o2318() }) }),
  );

  assert.ok(prompt !== null);
  assert.ok(prompt.includes('全 1325 件。大きいため削除 709 件・内容の変わらない rename 534 件を省略'));
  assert.ok(prompt.includes('`/home/runner/work/_temp/pavo/changed-files.txt`'));
  assert.ok(!prompt.includes('legacy-0.stories.tsx'));
  assert.ok(!prompt.includes('moved-0.module.css'));
  assert.deepEqual(reductions, ['削除されたファイルと内容の変わらない rename を件数だけにまとめた']);
});

test('内容の変わる rename・変更・追加のファイルは一覧に残る', () => {
  const { prompt } = buildPromptWithinBudget(params({ context: context({ changedFiles: k8o2318() }) }));

  assert.ok(prompt !== null);
  assert.ok(prompt.includes('`apps/main/src/components/site/edited-13/edited-13.tsx` (renamed, +4/-2)'));
  assert.ok(prompt.includes('`apps/main/src/routes/page-64/page-64.tsx` (modified, +12/-3)'));
  assert.ok(prompt.includes('`apps/main/src/routes/new-2.tsx` (added, +30/-0)'));
});

test('変更されたファイルだけで大きい PR は、一覧を先頭 100 件と残りの件数にする', () => {
  const { prompt, reductions } = buildPromptWithinBudget(
    params({ context: context({ changedFiles: modified(2000) }) }),
  );

  assert.ok(prompt !== null);
  assert.ok(prompt.includes('`apps/main/src/routes/page-99/page-99.tsx`'));
  assert.ok(!prompt.includes('`apps/main/src/routes/page-100/page-100.tsx`'));
  assert.ok(prompt.includes('全 2000 件。大きいため先頭 100 件以降の 1900 件を省略'));
  assert.deepEqual(reductions, ['変更ファイルの一覧を先頭 100 件に絞った']);
});

test('会話が大きいときは、未解決の自分のスレッドを残して解決済みとコメント履歴を省く', () => {
  const resolved = range(60, (i) =>
    thread({ rootId: 1000 + i, isResolved: true, comments: [{ author: 'k8o', isBot: false, body: '解決済みの論点'.repeat(200) }] }),
  );
  const longComments = range(30, () => ({ author: 'k8o', isBot: false, body: 'コメント履歴'.repeat(200) }));

  const { prompt, reductions } = buildPromptWithinBudget(
    params({
      context: context({
        changedFiles: modified(10),
        threads: [thread({ rootId: 101 }), ...resolved],
        issueComments: longComments,
      }),
    }),
  );

  assert.ok(prompt !== null);
  assert.ok(prompt.includes('rootId=101'));
  assert.ok(!prompt.includes('解決済みの論点'));
  assert.ok(!prompt.includes('コメント履歴'));
  assert.deepEqual(reductions, ['解決済みスレッドとコメント履歴を省いた']);
});

test('一覧と会話を縮めても収まらないときは、プロンプトを返さない', () => {
  const { prompt } = buildPromptWithinBudget(
    params({ prBody: 'あ'.repeat(40000), context: context({ changedFiles: k8o2318() }) }),
  );

  assert.equal(prompt, null);
});

test('予算は JSON にエスケープした大きさで測る（ALL_INPUTS に載るのはこちら）', () => {
  const input = params({ prBody: '"\n'.repeat(5000) });
  const rawBytes = Buffer.byteLength(buildReviewPrompt(input));

  const { prompt } = buildPromptWithinBudget(input, rawBytes);

  assert.equal(prompt, null);
});

test('予算に収まる PR はそのまま渡し、縮めたことも記録しない', () => {
  const input = params({ context: context({ changedFiles: [...removed(3), ...pureRenames(2), ...modified(5)] }) });

  const { prompt, reductions } = buildPromptWithinBudget(input);

  assert.equal(prompt, buildReviewPrompt(input));
  assert.deepEqual(reductions, []);
});

test('全件が削除と内容の変わらない rename の PR でも、件数と一覧ファイルの案内は残る', () => {
  const { prompt } = buildPromptWithinBudget(
    params({ context: context({ changedFiles: [...removed(900), ...pureRenames(900)] }) }),
  );

  assert.ok(prompt !== null);
  assert.ok(prompt.includes('全 1800 件。大きいため削除 900 件・内容の変わらない rename 900 件を省略'));
  assert.ok(prompt.includes('changed-files.txt'));
});
