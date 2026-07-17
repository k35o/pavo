// Parse unified diff patches (the `patch` field of GET /pulls/{n}/files)
// into commentable line maps, so review comments can be validated before
// POST /pulls/{n}/reviews — one bad anchor 422s the whole review.

/** line number -> hunk index, for each diff side */
export interface PatchLines {
  right: Map<number, number>;
  left: Map<number, number>;
}

export function parsePatchLines(patch: string | null | undefined): PatchLines {
  const right = new Map<number, number>();
  const left = new Map<number, number>();
  if (!patch) return { right, left };

  let oldLine = 0;
  let newLine = 0;
  let hunkIndex = -1;

  for (const line of patch.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      hunkIndex += 1;
      continue;
    }
    if (hunkIndex < 0) continue;
    if (line.startsWith('+')) {
      right.set(newLine, hunkIndex);
      newLine += 1;
    } else if (line.startsWith('-')) {
      left.set(oldLine, hunkIndex);
      oldLine += 1;
    } else if (line.startsWith(' ') || line === '') {
      right.set(newLine, hunkIndex);
      left.set(oldLine, hunkIndex);
      newLine += 1;
      oldLine += 1;
    }
    // Anything else ("\ No newline at end of file") advances neither side.
  }
  return { right, left };
}

export interface AnchorCandidate {
  line: number;
  side?: string | undefined;
  start_line?: number | null | undefined;
  start_side?: string | null | undefined;
}

/**
 * Check that a review comment anchor exists in the file's diff, including
 * the multi-line case (start_line and line must land in the same hunk).
 *
 * @param lines null when the file has no parseable patch (binary / too
 *   large) — then the anchor cannot be verified and is treated as valid.
 */
export function isValidAnchor(comment: AnchorCandidate, lines: PatchLines | null): boolean {
  if (!lines) return true;
  const sideMap = (side: string | null | undefined): Map<number, number> =>
    (side ?? 'RIGHT') === 'LEFT' ? lines.left : lines.right;

  const endHunk = sideMap(comment.side).get(comment.line);
  if (endHunk === undefined) return false;

  if (comment.start_line !== undefined && comment.start_line !== null) {
    if (comment.start_line >= comment.line) return false;
    const startHunk = sideMap(comment.start_side ?? comment.side).get(comment.start_line);
    if (startHunk === undefined || startHunk !== endHunk) return false;
  }
  return true;
}
