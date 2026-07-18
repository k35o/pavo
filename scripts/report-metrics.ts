// Aggregate how Pavo's findings fared: resolve rate and 👍/👎 reactions per
// recent PR, plus calibration tables sliced by the severity / confidence
// recorded in each comment's invisible pavo:finding marker. The output is the
// feedback loop for tuning instructions/*.md and the confidence threshold —
// without it, viewpoint edits are guesswork.
//
// Usage: REPO=owner/name BOT_NAME='k35o-bot[bot]' node scripts/report-metrics.ts
// Optional env: PR_LIMIT (default 20)

import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { addStepSummary } from './lib/actions.ts';
import { sameLogin } from './lib/bot.ts';
import { ghJson, ghPaginatePrConnection } from './lib/gh.ts';
import { parseFindingMarker } from './lib/markers.ts';
import { requireEnv } from './lib/env.ts';

interface ThreadRecord {
  isResolved: boolean;
  thumbsUp: number;
  thumbsDown: number;
  finding: { severity: string; confidence: number } | null;
}

interface Tally {
  threads: number;
  resolved: number;
  thumbsUp: number;
  thumbsDown: number;
}

const newTally = (): Tally => ({ threads: 0, resolved: 0, thumbsUp: 0, thumbsDown: 0 });

function addTo(tally: Tally, record: ThreadRecord): void {
  tally.threads += 1;
  if (record.isResolved) tally.resolved += 1;
  tally.thumbsUp += record.thumbsUp;
  tally.thumbsDown += record.thumbsDown;
}

function fetchThreadRecords(repo: string, prNumber: number, botName: string): ThreadRecord[] {
  const [owner, name] = repo.split('/') as [string, string];
  const threads = ghPaginatePrConnection(owner, name, prNumber, {
    field: 'reviewThreads',
    first: 100,
    selection: `
      isResolved
      comments(first: 1) {
        nodes {
          author { login }
          body
          reactionGroups { content reactors { totalCount } }
        }
      }`,
    maxPages: 10,
  });
  const records: ThreadRecord[] = [];
  for (const thread of threads) {
    const root = thread.comments.nodes[0];
    if (!sameLogin(root?.author?.login, botName)) continue;
    let thumbsUp = 0;
    let thumbsDown = 0;
    for (const group of root.reactionGroups ?? []) {
      if (group.content === 'THUMBS_UP') thumbsUp += group.reactors.totalCount;
      if (group.content === 'THUMBS_DOWN') thumbsDown += group.reactors.totalCount;
    }
    records.push({
      isResolved: thread.isResolved,
      thumbsUp,
      thumbsDown,
      finding: parseFindingMarker(root.body),
    });
  }
  return records;
}

function main(): void {
  const repo = requireEnv('REPO');
  const botName = requireEnv('BOT_NAME');
  const limit = Number(process.env.PR_LIMIT ?? 20);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error(`Invalid PR_LIMIT: ${process.env.PR_LIMIT} (expected 1-100)`);
  }

  const prs = ghJson<any[]>([
    'api',
    `repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=${limit}`,
  ]);

  const rows: string[] = [];
  const total = newTally();
  const bySeverity = new Map<string, Tally>();
  const byBand = new Map<string, Tally>();
  let unmarked = 0;
  for (const pr of prs) {
    const records = fetchThreadRecords(repo, pr.number, botName);
    if (records.length === 0) continue;
    const stats = newTally();
    for (const record of records) {
      addTo(stats, record);
      addTo(total, record);
      if (!record.finding) {
        unmarked += 1;
        continue;
      }
      const { severity, confidence } = record.finding;
      if (!bySeverity.has(severity)) bySeverity.set(severity, newTally());
      addTo(bySeverity.get(severity)!, record);
      const band = confidence >= 90 ? '90-100' : confidence >= 80 ? '80-89' : '<80';
      if (!byBand.has(band)) byBand.set(band, newTally());
      addTo(byBand.get(band)!, record);
    }
    rows.push(`| #${pr.number} | ${stats.threads} | ${stats.resolved} | ${stats.thumbsUp} | ${stats.thumbsDown} |`);
  }

  const rate = (tally: Tally): string =>
    tally.threads === 0 ? '-' : `${Math.round((tally.resolved / tally.threads) * 100)}%`;
  rows.push(
    `| **計** | **${total.threads}** | **${total.resolved}** (${rate(total)}) | **${total.thumbsUp}** | **${total.thumbsDown}** |`,
  );
  let report =
    `## Pavo metrics: ${repo} (直近 ${limit} PR)\n\n` +
    `| PR | 指摘スレッド | resolved | 👍 | 👎 |\n| --- | --- | --- | --- | --- |\n` +
    `${rows.join('\n')}\n`;

  if (bySeverity.size > 0) {
    const tallyRow = ([key, tally]: [string, Tally]): string =>
      `| ${key} | ${tally.threads} | ${tally.resolved} (${rate(tally)}) | ${tally.thumbsUp} | ${tally.thumbsDown} |`;
    const severityOrder = ['critical', 'warning', 'suggestion', 'praise'];
    const severityRows = [...bySeverity.entries()]
      .sort((a, b) => severityOrder.indexOf(a[0]) - severityOrder.indexOf(b[0]))
      .map(tallyRow);
    const bandRows = [...byBand.entries()].sort().map(tallyRow);
    report +=
      `\n### 較正（pavo:finding マーカー付きの指摘のみ）\n\n` +
      `| severity | threads | resolved | 👍 | 👎 |\n| --- | --- | --- | --- | --- |\n${severityRows.join('\n')}\n\n` +
      `| confidence | threads | resolved | 👍 | 👎 |\n| --- | --- | --- | --- | --- |\n${bandRows.join('\n')}\n` +
      (unmarked > 0 ? `\nマーカーなしの旧指摘: ${unmarked} スレッド\n` : '');
  }

  console.log(report);
  addStepSummary(report);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
