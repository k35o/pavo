// Bot login comparison across API surfaces.
//
// REST returns App users as `slug[bot]` but GraphQL `author { login }` returns
// the bare `slug` — comparing either side against the other verbatim silently
// never matches. Normalize both sides instead.

/**
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 * @returns {boolean}
 */
export function sameLogin(a, b) {
  if (!a || !b) return false;
  const strip = (login) => login.replace(/\[bot\]$/, '');
  return strip(a) === strip(b);
}
