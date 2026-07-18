// Shared shapes crossing file boundaries. GitHub API payloads are typed
// loosely (only the fields we actually touch) — mirroring the full REST/
// GraphQL schema here would be maintenance without safety.

export type Severity = 'critical' | 'warning' | 'suggestion' | 'praise';

export interface PavoConfig {
  instructions: string;
  extraPrompt: string;
  language: 'auto' | 'ja' | 'en';
  approve: boolean;
  minSeverity: Exclude<Severity, 'praise'>;
  model: string;
  reviewDrafts: boolean;
  ignore: string[];
}

/** One element of the structured review output's `comments[]`. */
export interface ReviewFinding {
  path: string;
  line: number;
  side: 'RIGHT' | 'LEFT';
  start_line?: number;
  start_side?: 'RIGHT' | 'LEFT';
  severity: Severity;
  confidence: number;
  body: string;
  suggestion?: string;
}

export interface ThreadComment {
  author: string;
  isBot: boolean;
  body: string;
}

export interface ThreadSummary {
  rootId: number | null;
  path: string;
  line: number | null;
  isResolved: boolean;
  isOutdated: boolean;
  byPavo: boolean;
  repliesTruncated: boolean;
  comments: ThreadComment[];
}

export interface ReviewSummaryEntry {
  author: string;
  isBot: boolean;
  state: string;
  body: string;
}

export interface ChangedFileEntry {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  hasPatch: boolean;
}

export interface CompareInfo {
  baseSha: string;
  files: { filename: string; status: string; hasPatch?: boolean }[];
  truncated: boolean;
  /** Directory holding per-file interdiff patches since the last review. */
  deltaDir?: string | null;
}

export interface LinkedIssue {
  number: number;
  title: string;
  body: string;
}

/** collect-context.ts output consumed by build-review-prompt.ts. */
export interface ReviewContext {
  botName: string;
  threads: ThreadSummary[];
  droppedThreads: number;
  reviews: ReviewSummaryEntry[];
  issueComments: ThreadComment[];
  lastReviewedSha: string | null;
  sameAsLastReview: boolean;
  changedSinceLastReview: CompareInfo | null;
  diffDir: string;
  changedFiles: ChangedFileEntry[];
  linkedIssues?: LinkedIssue[];
  commitMessages?: string[];
}
