// Thin wrapper around the `gh` CLI.
//
// execFileSync (no shell) keeps untrusted strings (comment bodies, PR titles)
// out of shell interpretation entirely.

import { execFileSync } from 'node:child_process';

const MAX_BUFFER = 64 * 1024 * 1024;

export interface GhOptions {
  input?: string;
  allowFailure?: boolean;
}

export interface GhResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  status: number | null;
}

export function gh(args: string[], { input, allowFailure = false }: GhOptions = {}): GhResult {
  try {
    const stdout = execFileSync('gh', args, {
      encoding: 'utf8',
      input,
      maxBuffer: MAX_BUFFER,
    });
    return { ok: true, stdout, stderr: '', status: 0 };
  } catch (error) {
    const failed = error as { stdout?: unknown; stderr?: unknown; status?: number };
    const result: GhResult = {
      ok: false,
      stdout: String(failed.stdout ?? ''),
      stderr: String(failed.stderr ?? ''),
      status: failed.status ?? null,
    };
    if (allowFailure) return result;
    throw new Error(
      `gh ${args.join(' ')} failed (status=${result.status}): ${result.stderr || result.stdout}`,
    );
  }
}

/**
 * Run `gh` and parse stdout as JSON. Returns null only when `allowFailure`
 * is set and the call failed.
 */
export function ghJson<T = any>(args: string[], options: GhOptions & { allowFailure: true }): T | null;
export function ghJson<T = any>(args: string[], options?: GhOptions): T;
export function ghJson<T = any>(args: string[], options: GhOptions = {}): T | null {
  const result = gh(args, options);
  if (!result.ok) return null;
  return JSON.parse(result.stdout) as T;
}

/**
 * Fetch every page of a REST list endpoint.
 *
 * `gh api --paginate` concatenates one JSON array per page into invalid JSON,
 * so page manually instead.
 *
 * @param path endpoint without query string (e.g. `repos/o/r/pulls/1/comments`)
 */
export function ghPaginate<T = any>(
  path: string,
  { perPage = 100, maxPages = 20 }: { perPage?: number; maxPages?: number } = {},
): T[] {
  const items: T[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const chunk = ghJson<T[]>(['api', `${path}?per_page=${perPage}&page=${page}`]);
    if (!Array.isArray(chunk)) break;
    items.push(...chunk);
    if (chunk.length < perPage) break;
  }
  return items;
}

/** Run a GraphQL query via `gh api graphql`; returns the `data` field. */
export function ghGraphql<T = any>(
  query: string,
  variables: Record<string, string | number | boolean> = {},
): T {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [key, value] of Object.entries(variables)) {
    if (typeof value === 'number' || typeof value === 'boolean') {
      args.push('-F', `${key}=${value}`);
    } else {
      args.push('-f', `${key}=${value}`);
    }
  }
  const result = gh(args);
  const parsed = JSON.parse(result.stdout) as { data: T; errors?: unknown[] };
  if (parsed.errors?.length) {
    throw new Error(`GraphQL errors: ${JSON.stringify(parsed.errors)}`);
  }
  return parsed.data;
}
