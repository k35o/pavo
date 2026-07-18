// Effective review configuration: defaults <- action inputs <- .github/pavo.json.
//
// The repo-side file wins over action inputs so per-repo tuning lives next to
// the reviewed code instead of in caller workflow YAML.

import type { PavoConfig, Severity } from './types.ts';

const SEVERITIES: Severity[] = ['praise', 'suggestion', 'warning', 'critical'];

export const DEFAULT_IGNORE = [
  '*.lock',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lockb',
  'dist/**',
  'build/**',
  'out/**',
  '*.min.js',
  '*.min.css',
  '**/__snapshots__/**',
  '*.snap',
  '*.map',
];

const DEFAULTS = {
  instructions: 'default',
  extraPrompt: '',
  language: 'auto',
  approve: true,
  minSeverity: 'suggestion',
  model: 'sonnet',
  reviewDrafts: false,
} as const;

export interface ConfigInputs {
  instructions?: string | undefined;
  extraPrompt?: string | undefined;
  language?: string | undefined;
  approve?: string | undefined;
  minSeverity?: string | undefined;
  model?: string | undefined;
  reviewDrafts?: string | undefined;
  ignorePaths?: string | undefined;
}

/** Loosely-typed shape of .github/pavo.json (user-authored). */
export type RepoConfig = Record<string, unknown>;

// `$schema` is tolerated because editors commonly add it to user-authored JSON.
const REPO_CONFIG_KEYS = new Set([
  '$schema',
  'instructions',
  'ignore',
  'language',
  'approve',
  'min_severity',
  'model',
  'review_drafts',
]);

/** Parse .github/pavo.json, rejecting anything that is not a JSON object. */
export function parseRepoConfig(raw: string): RepoConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error('.github/pavo.json is not valid JSON', { cause });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('.github/pavo.json must be a JSON object');
  }
  return parsed as RepoConfig;
}

function parseBool(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return String(value).toLowerCase() === 'true';
}

export function parseList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string' || value.trim() === '') return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function resolveConfig(inputs: ConfigInputs, repoConfig: RepoConfig | null): PavoConfig {
  const repo = repoConfig ?? {};
  // A typo'd key silently reviewing with defaults is worse than a red run —
  // same policy as unknown instruction names.
  for (const key of Object.keys(repo)) {
    if (!REPO_CONFIG_KEYS.has(key)) {
      throw new Error(
        `Unknown key in .github/pavo.json: ${key} (instructions|ignore|language|approve|min_severity|model|review_drafts)`,
      );
    }
  }
  const language = String(repo.language ?? inputs.language ?? DEFAULTS.language);
  const minSeverity = String(repo.min_severity ?? inputs.minSeverity ?? DEFAULTS.minSeverity);

  if (language !== 'auto' && language !== 'ja' && language !== 'en') {
    throw new Error(`Invalid language: ${language} (auto|ja|en)`);
  }
  if (minSeverity !== 'suggestion' && minSeverity !== 'warning' && minSeverity !== 'critical') {
    throw new Error(`Invalid min_severity: ${minSeverity} (suggestion|warning|critical)`);
  }

  const config: PavoConfig = {
    instructions:
      typeof repo.instructions === 'string' && repo.instructions.trim()
        ? repo.instructions
        : inputs.instructions?.trim() || DEFAULTS.instructions,
    extraPrompt: inputs.extraPrompt ?? DEFAULTS.extraPrompt,
    language,
    approve: parseBool(repo.approve, parseBool(inputs.approve, DEFAULTS.approve)),
    minSeverity,
    model: String(repo.model ?? inputs.model ?? DEFAULTS.model),
    reviewDrafts: parseBool(
      repo.review_drafts,
      parseBool(inputs.reviewDrafts, DEFAULTS.reviewDrafts),
    ),
    ignore: [...DEFAULT_IGNORE, ...parseList(inputs.ignorePaths), ...parseList(repo.ignore)],
  };

  // The model name ends up inside claude_args; keep it a plain token so a
  // malicious .github/pavo.json cannot smuggle extra CLI flags in.
  if (!/^[a-zA-Z0-9._-]+$/.test(config.model)) {
    throw new Error(`Invalid model: ${config.model}`);
  }
  return config;
}

/** Rank for threshold comparison (praise lowest). */
export function severityRank(severity: string): number {
  const rank = SEVERITIES.indexOf(severity as Severity);
  if (rank === -1) throw new Error(`Unknown severity: ${severity}`);
  return rank;
}
