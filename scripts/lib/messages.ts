import type { Language } from './types.ts';

interface Messages {
  unanchoredHeading: (count: number) => string;
  otherNotes: (count: number) => string;
  heldByThreads: (count: number) => string;
  reducedNotice: (reductions: string[]) => string;
  refutedNote: (note: string) => string;
  oversizeNotice: (shortSha: string) => string;
  learningSaved: (file: string, branch: string) => string;
  learningFailed: (failure: string) => string;
  learningBranchFailed: (branch: string) => string;
  learningForbidden: string;
  learningApiError: (detail: string) => string;
}

/** Fixed text Pavo posts on a pull request, per resolved language. */
export const MESSAGES: Record<Language, Messages> = {
  ja: {
    unanchoredHeading: (count) => `### 行に付けられなかった指摘 (${count})`,
    otherNotes: (count) => `その他の観察 (${count})`,
    heldByThreads: (count) =>
      `> 前回までのレビューで指摘した 🔴 / 🟡 のスレッドが ${count} 件未解決のため、承認していません。` +
      '対応してスレッドを resolve したら、`/pavo` とコメントすると再レビューします。',
    reducedNotice: (reductions) =>
      `> ℹ️ この PR は大きいため、レビューに渡す情報を縮めました: ${reductions.join('、')}`,
    refutedNote: (note) => ` — 検証セッションの反証: ${note}`,
    oversizeNotice: (shortSha) =>
      `⚠️ この PR はレビューに渡す情報が大きすぎるため、Pavo はレビューしませんでした（head \`${shortSha}\`）。\n\n` +
      '変更ファイルの一覧と既存の会話を縮めても、claude-code-action に渡せる大きさに収まりませんでした。' +
      'PR を分けるか description を短くすると、次の push でレビューされます。',
    learningSaved: (file, branch) =>
      `\`${file}\`（\`${branch}\` ブランチ）に記録しました。以後のレビューに反映されます。`,
    learningFailed: (failure) => `この方針を learnings に保存しようとしましたが、失敗しました: ${failure}`,
    learningBranchFailed: (branch) =>
      `ブランチ \`${branch}\` を作成できませんでした（App の \`Contents: Read & write\` 権限を確認してください）`,
    learningForbidden: 'App の `Contents: Read & write` 権限が必要です',
    learningApiError: (detail) => `保存 API がエラーを返しました: ${detail}`,
  },
  en: {
    unanchoredHeading: (count) => `### Findings not attached to a line (${count})`,
    otherNotes: (count) => `Other notes (${count})`,
    heldByThreads: (count) =>
      `> Not approving: ${count} 🔴 / 🟡 thread(s) from earlier reviews are still unresolved. ` +
      'Once they are addressed and resolved, comment `/pavo` for a fresh review.',
    reducedNotice: (reductions) =>
      `> ℹ️ This PR is large, so the review was given less context: ${reductions.join('; ')}`,
    refutedNote: (note) => ` — refuted on re-check: ${note}`,
    oversizeNotice: (shortSha) =>
      `⚠️ Pavo did not review this PR because its context is too large (head \`${shortSha}\`).\n\n` +
      'Even with the changed-file list and the existing conversation trimmed, it does not fit what claude-code-action can take. ' +
      'Split the PR or shorten the description, and the next push will be reviewed.',
    learningSaved: (file, branch) =>
      `Recorded in \`${file}\` (on the \`${branch}\` branch). Future reviews will follow it.`,
    learningFailed: (failure) => `Tried to save this as a learning, but it failed: ${failure}`,
    learningBranchFailed: (branch) =>
      `Could not create the \`${branch}\` branch (check that the App has \`Contents: Read & write\`)`,
    learningForbidden: 'The App needs `Contents: Read & write`',
    learningApiError: (detail) => `The contents API returned an error: ${detail}`,
  },
};
