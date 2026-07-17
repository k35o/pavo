// Thin wrapper around the `gh` CLI.
//
// execFileSync (no shell) keeps untrusted strings (comment bodies, PR titles)
// out of shell interpretation entirely.

import { execFileSync } from 'node:child_process';

const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Run `gh` with the given args.
 * @param {string[]} args
 * @param {{input?: string, allowFailure?: boolean}} [options]
 * @returns {{ok: boolean, stdout: string, stderr: string, status: number | null}}
 */
export function gh(args, { input, allowFailure = false } = {}) {
  try {
    const stdout = execFileSync('gh', args, {
      encoding: 'utf8',
      input,
      maxBuffer: MAX_BUFFER,
    });
    return { ok: true, stdout, stderr: '', status: 0 };
  } catch (error) {
    const result = {
      ok: false,
      stdout: error.stdout?.toString() ?? '',
      stderr: error.stderr?.toString() ?? '',
      status: error.status ?? null,
    };
    if (allowFailure) return result;
    throw new Error(
      `gh ${args.join(' ')} failed (status=${result.status}): ${result.stderr || result.stdout}`,
    );
  }
}

/**
 * Run `gh` and parse stdout as JSON.
 * @param {string[]} args
 * @param {{input?: string, allowFailure?: boolean}} [options]
 * @returns {any | null} parsed JSON, or null when allowFailure and the call failed
 */
export function ghJson(args, options = {}) {
  const result = gh(args, options);
  if (!result.ok) return null;
  return JSON.parse(result.stdout);
}

/**
 * Fetch every page of a REST list endpoint.
 *
 * `gh api --paginate` concatenates one JSON array per page into invalid JSON,
 * so page manually instead.
 *
 * @param {string} path endpoint without query string (e.g. `repos/o/r/pulls/1/comments`)
 * @param {{perPage?: number, maxPages?: number}} [options]
 * @returns {any[]}
 */
export function ghPaginate(path, { perPage = 100, maxPages = 20 } = {}) {
  const items = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const chunk = ghJson(['api', `${path}?per_page=${perPage}&page=${page}`]);
    if (!Array.isArray(chunk)) break;
    items.push(...chunk);
    if (chunk.length < perPage) break;
  }
  return items;
}

/**
 * Run a GraphQL query via `gh api graphql` with variables passed as JSON.
 * @param {string} query
 * @param {Record<string, unknown>} [variables]
 * @returns {any} the `data` field
 */
export function ghGraphql(query, variables = {}) {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [key, value] of Object.entries(variables)) {
    if (typeof value === 'number' || typeof value === 'boolean') {
      args.push('-F', `${key}=${value}`);
    } else {
      args.push('-f', `${key}=${value}`);
    }
  }
  const result = gh(args);
  const parsed = JSON.parse(result.stdout);
  if (parsed.errors?.length) {
    throw new Error(`GraphQL errors: ${JSON.stringify(parsed.errors)}`);
  }
  return parsed.data;
}
