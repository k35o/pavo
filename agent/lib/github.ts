// Minimal GitHub client for the eve runtime: App JWT -> installation token,
// REST and GraphQL over fetch. Replaces scripts/lib/gh.ts (gh CLI) from the
// Actions incarnation; everything downstream of it ported unchanged.
//
// Tokens live only in the app runtime — never in the sandbox or the model
// context (eve's security model does the same for channel-managed auth).

import crypto from 'node:crypto';

const API = 'https://api.github.com';

export interface GhResponse<T = any> {
  ok: boolean;
  status: number;
  body: T;
  errorText: string;
}

function appJwt(): string {
  const clientId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!clientId || !privateKey) {
    throw new Error('GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY are required');
  }
  const b64url = (value: string): string => Buffer.from(value).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: clientId }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(privateKey, 'base64url')}`;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

/** Mint (and briefly cache) an installation access token for the App. */
export async function installationToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - Date.now() > 60_000) return cachedToken.value;
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID;
  if (!installationId) throw new Error('GITHUB_APP_INSTALLATION_ID is required');
  const res = await fetch(`${API}/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${appJwt()}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`installation token: HTTP ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { token: string; expires_at: string };
  cachedToken = { value: data.token, expiresAt: Date.parse(data.expires_at) };
  return data.token;
}

export async function rest<T = any>(
  method: string,
  path: string,
  body?: unknown,
): Promise<GhResponse<T>> {
  const token = await installationToken();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { ok: res.ok, status: res.status, body: parsed as T, errorText: res.ok ? '' : text };
}

/** Fetch every page of a REST list endpoint (`path` without query string). */
export async function paginate<T = any>(
  path: string,
  { perPage = 100, maxPages = 20 }: { perPage?: number; maxPages?: number } = {},
): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const res = await rest<T[]>('GET', `${path}?per_page=${perPage}&page=${page}`);
    if (!res.ok || !Array.isArray(res.body)) break;
    items.push(...res.body);
    if (res.body.length < perPage) break;
  }
  return items;
}

export async function graphql<T = any>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const token = await installationToken();
  const res = await fetch(`${API}/graphql`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const data = (await res.json()) as { data: T; errors?: unknown[] };
  if (!res.ok || data.errors?.length) {
    throw new Error(`GraphQL failed (${res.status}): ${JSON.stringify(data.errors ?? data)}`);
  }
  return data.data;
}
