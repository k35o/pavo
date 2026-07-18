// Bot login comparison across API surfaces.
//
// REST returns App users as `slug[bot]` but GraphQL `author { login }` returns
// the bare `slug` — comparing either side against the other verbatim silently
// never matches. Normalize both sides instead. Logins are also lowercased
// because GitHub treats them as case-insensitive (`allow_bots: Renovate` must
// match `renovate[bot]`).

export function normalizeLogin(login: string): string {
  return login.toLowerCase().replace(/\[bot\]$/, '');
}

export function sameLogin(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normalizeLogin(a) === normalizeLogin(b);
}
