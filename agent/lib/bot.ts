// Bot login comparison across API surfaces.
//
// REST returns App users as `slug[bot]` but GraphQL `author { login }` returns
// the bare `slug` — comparing either side against the other verbatim silently
// never matches. Normalize both sides instead.

export function sameLogin(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const strip = (login: string): string => login.replace(/\[bot\]$/, '');
  return strip(a) === strip(b);
}
