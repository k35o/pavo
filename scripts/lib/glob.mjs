// Minimal glob matching for ignore patterns (no dependencies).
//
// Supported syntax: `**` (any path segments), `*` (within a segment),
// `?` (single character). A pattern without `/` matches the basename,
// so `*.lock` matches `sub/dir/x.lock`. A trailing `/` matches the
// directory and everything under it.

function segmentToRegex(segment) {
  let regex = '';
  for (const char of segment) {
    if (char === '*') regex += '[^/]*';
    else if (char === '?') regex += '[^/]';
    else regex += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return regex;
}

/**
 * @param {string} pattern
 * @returns {RegExp}
 */
export function globToRegExp(pattern) {
  let normalized = pattern.trim();
  if (normalized.endsWith('/')) normalized += '**';

  // Build per path segment so `**` means "zero or more whole segments":
  // `a/**/b` must match `a/b` and `a/x/b` but not `a/xb`.
  const segments = normalized.split('/');
  let regex = '^';
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    const isLast = i === segments.length - 1;
    if (segment === '**') {
      regex += isLast ? '.*' : '(?:[^/]+/)*';
    } else {
      regex += segmentToRegex(segment) + (isLast ? '' : '/');
    }
  }
  return new RegExp(`${regex}$`);
}

/**
 * @param {string} filePath repo-relative path with `/` separators
 * @param {string} pattern
 * @returns {boolean}
 */
export function matchesGlob(filePath, pattern) {
  const normalized = pattern.trim();
  if (!normalized) return false;
  const target = normalized.includes('/')
    ? filePath
    : filePath.split('/').at(-1);
  return globToRegExp(normalized).test(target);
}

/**
 * @param {string} filePath
 * @param {string[]} patterns
 * @returns {boolean}
 */
export function matchesAnyGlob(filePath, patterns) {
  return patterns.some((pattern) => matchesGlob(filePath, pattern));
}
