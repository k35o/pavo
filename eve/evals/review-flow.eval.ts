import { defineEval } from 'eve/evals';

// Live smoke of the whole eve wiring with the real Fugu model: instructions
// drive the model to investigate and finish with exactly one submit_review
// call. PAVO_EVE_REPOS is unset during evals, so the tool rejects via the
// allowlist and nothing reaches GitHub.
export default defineEval({
  description: 'レビュー実行が submit_review 1 回で締まる（fugu 実打・投稿なし）',
  timeoutMs: 600_000,
  async test(t) {
    await t.send(
      [
        '次の Pull Request をレビューしてください。',
        '',
        '<github_context>',
        'repository: k35o/eval-fixture',
        'pull_request_number: 1',
        'head_sha: 0000000000000000000000000000000000000000',
        '</github_context>',
        '',
        '注意: この実行ではサンドボックスにリポジトリがチェックアウトされていません。',
        '以下の diff だけを根拠に判断し、確認のフローのうちファイル探索は省略して、',
        '最後に submit_review を 1 回だけ呼んでください。',
        '',
        '```diff',
        '--- a/src/user.ts',
        '+++ b/src/user.ts',
        '@@ -1,3 +1,3 @@',
        ' export function firstUserName(users: { name: string }[]): string {',
        "-  return 'unknown';",
        '+  return users[0].name;',
        ' }',
        '```',
      ].join('\n'),
    );
    t.calledTool('submit_review');
    t.maxToolCalls(6);
  },
});
