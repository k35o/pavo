// Invisible per-finding calibration marker embedded in each inline comment.
//
// post-review.ts writes it, report-metrics.ts reads it back to correlate
// resolve / reaction rates with severity and confidence — the two knobs that
// decide what gets posted but are otherwise discarded after the gate.

export const FINDING_MARKER_PATTERN = /<!-- pavo:finding (\{.*?\}) -->/gs;

export function renderFindingMarker(severity: string, confidence: number): string {
  return `<!-- pavo:finding ${JSON.stringify({ severity, confidence })} -->`;
}

export function parseFindingMarker(
  body: string | null | undefined,
): { severity: string; confidence: number } | null {
  const match = [...(body ?? '').matchAll(FINDING_MARKER_PATTERN)].at(-1);
  if (!match) return null;
  try {
    const meta = JSON.parse(match[1]!);
    if (typeof meta.severity === 'string' && typeof meta.confidence === 'number') {
      return { severity: meta.severity, confidence: meta.confidence };
    }
  } catch {
    // A corrupted marker only loses this thread's calibration data point.
  }
  return null;
}

/** Remove markers before a body is quoted into a prompt or summary. */
export function stripFindingMarkers(body: string): string {
  return body.replace(FINDING_MARKER_PATTERN, '').trimEnd();
}
