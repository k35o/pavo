// Effective review configuration: defaults <- action inputs <- .github/pavo.json.
//
// The repo-side file wins over action inputs so per-repo tuning lives next to
// the reviewed code instead of in caller workflow YAML.

const SEVERITIES = ['praise', 'suggestion', 'warning', 'critical'];

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
  ignore: [],
};

function parseBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return String(value).toLowerCase() === 'true';
}

function parseList(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string' || value.trim() === '') return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * @param {Record<string, string | undefined>} inputs action inputs (raw env strings)
 * @param {Record<string, unknown> | null} repoConfig parsed .github/pavo.json, if any
 * @returns {{instructions: string, extraPrompt: string, language: string,
 *   approve: boolean, minSeverity: string, model: string, reviewDrafts: boolean,
 *   ignore: string[]}}
 */
export function resolveConfig(inputs, repoConfig) {
  const repo = repoConfig ?? {};
  const config = {
    instructions:
      typeof repo.instructions === 'string' && repo.instructions.trim()
        ? repo.instructions
        : inputs.instructions?.trim() || DEFAULTS.instructions,
    extraPrompt: inputs.extraPrompt ?? DEFAULTS.extraPrompt,
    language: String(repo.language ?? inputs.language ?? DEFAULTS.language),
    approve: parseBool(repo.approve, parseBool(inputs.approve, DEFAULTS.approve)),
    minSeverity: String(repo.min_severity ?? inputs.minSeverity ?? DEFAULTS.minSeverity),
    model: String(repo.model ?? inputs.model ?? DEFAULTS.model),
    reviewDrafts: parseBool(
      repo.review_drafts,
      parseBool(inputs.reviewDrafts, DEFAULTS.reviewDrafts),
    ),
    ignore: [...DEFAULT_IGNORE, ...parseList(inputs.ignorePaths), ...parseList(repo.ignore)],
  };

  if (!['auto', 'ja', 'en'].includes(config.language)) {
    throw new Error(`Invalid language: ${config.language} (auto|ja|en)`);
  }
  // The model name ends up inside claude_args; keep it a plain token so a
  // malicious .github/pavo.json cannot smuggle extra CLI flags in.
  if (!/^[a-zA-Z0-9._-]+$/.test(config.model)) {
    throw new Error(`Invalid model: ${config.model}`);
  }
  if (!SEVERITIES.slice(1).includes(config.minSeverity)) {
    throw new Error(`Invalid min_severity: ${config.minSeverity} (suggestion|warning|critical)`);
  }
  return config;
}

/**
 * @param {string} severity
 * @returns {number} rank for threshold comparison (praise lowest)
 */
export function severityRank(severity) {
  const rank = SEVERITIES.indexOf(severity);
  if (rank === -1) throw new Error(`Unknown severity: ${severity}`);
  return rank;
}
