// Adversarial second-pass verification of critical/warning findings.
//
// The review session's own self-refutation (system.md step 5) is weakened by
// anchoring on its own reasoning; a fresh session that sees only the findings
// is a stronger false-positive filter. build-verify-prompt.ts composes the
// prompt from selectBlocking()'s list, and post-review.ts applies the
// verdicts with applyVerifyVerdicts() — both sides must index the same list.

import type { ReviewFinding } from './types.ts';

export interface VerifyVerdict {
  index: number;
  verdict: 'confirmed' | 'refuted' | 'uncertain';
  note?: string;
}

/** The findings worth a verification pass: the ones that block APPROVE. */
export function selectBlocking(rawComments: Record<string, any>[] | null | undefined): Record<string, any>[] {
  return (rawComments ?? []).filter(
    (comment) => comment?.severity === 'critical' || comment?.severity === 'warning',
  );
}

const sameFinding = (shaped: ReviewFinding, raw: Record<string, any>): boolean =>
  shaped.path === String(raw.path ?? '') &&
  shaped.line === Number(raw.line) &&
  shaped.severity === raw.severity &&
  shaped.body === String(raw.body ?? '').trim();

/**
 * Apply verifier verdicts to a partitioned review: refuted findings move to
 * the collapsed section with the refuter's note (auditable, nothing silently
 * lost), uncertain ones are dropped like a sub-threshold confidence.
 *
 * @returns counts for the run log
 */
export function applyVerifyVerdicts(
  partition: {
    inline: ReviewFinding[];
    demoted: { comment: ReviewFinding; reason: string }[];
    dropped: { comment: ReviewFinding; reason: string }[];
  },
  rawComments: Record<string, any>[] | null | undefined,
  verdicts: VerifyVerdict[],
): { refuted: number; uncertain: number } {
  const blocking = selectBlocking(rawComments);

  // Pair each blocking finding with its inline entry BEFORE mutating,
  // walking both lists in original order — content matching alone would
  // send a verdict to the wrong copy when two findings read identically.
  const inlineIndexByBlocking = new Map<number, number>();
  const taken = new Set<number>();
  blocking.forEach((rawComment, blockingIndex) => {
    const at = partition.inline.findIndex(
      (comment, i) => !taken.has(i) && sameFinding(comment, rawComment),
    );
    if (at !== -1) {
      inlineIndexByBlocking.set(blockingIndex, at);
      taken.add(at);
    }
  });

  const removals: { at: number; verdict: 'refuted' | 'uncertain'; note?: string | undefined }[] = [];
  const seenIndexes = new Set<number>();
  for (const { index, verdict, note } of verdicts) {
    if (verdict === 'confirmed' || seenIndexes.has(index)) continue;
    seenIndexes.add(index);
    const at = inlineIndexByBlocking.get(index);
    if (at === undefined) continue;
    removals.push({ at, verdict, note });
  }

  const counts = { refuted: 0, uncertain: 0 };
  // Splice from the back so earlier indexes stay valid.
  removals.sort((a, b) => b.at - a.at);
  for (const { at, verdict, note } of removals) {
    const [comment] = partition.inline.splice(at, 1);
    if (verdict === 'refuted') {
      counts.refuted += 1;
      partition.demoted.push({
        comment: {
          ...comment!,
          body: `${comment!.body}${note ? ` — 検証セッションの反証: ${note}` : ''}`,
        },
        reason: 'refuted by verifier',
      });
    } else {
      counts.uncertain += 1;
      partition.dropped.push({ comment: comment!, reason: 'verifier uncertain' });
    }
  }
  return counts;
}
