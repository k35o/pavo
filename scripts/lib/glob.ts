// Minimal glob matching for ignore patterns (no dependencies).
//
// Supported syntax: `**` (any path segments), `*` (within a segment),
// `?` (single character). A pattern without `/` matches the basename,
// so `*.lock` matches `sub/dir/x.lock`. A trailing `/` matches the
// directory and everything under it.

function segmentToRegex(segment: string): string {
  let regex = '';
  for (const char of segment) {
    if (char === '*') regex += '[^/]*';
    else if (char === '?') regex += '[^/]';
    else regex += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return regex;
}

export function globToRegExp(pattern: string): RegExp {
  let normalized = pattern.trim();
  if (normalized.endsWith('/')) normalized += '**';

  // Build per path segment so `**` means "zero or more whole segments":
  // `a/**/b` must match `a/b` and `a/x/b` but not `a/xb`.
  const segments = normalized.split('/');
  let regex = '^';
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i]!;
    const isLast = i === segments.length - 1;
    if (segment === '**') {
      regex += isLast ? '.*' : '(?:[^/]+/)*';
    } else {
      regex += segmentToRegex(segment) + (isLast ? '' : '/');
    }
  }
  return new RegExp(`${regex}$`);
}

/** @param filePath repo-relative path with `/` separators */
export function matchesGlob(filePath: string, pattern: string): boolean {
  const normalized = pattern.trim();
  if (!normalized) return false;
  const target = normalized.includes('/') ? filePath : (filePath.split('/').at(-1) ?? filePath);
  return globToRegExp(normalized).test(target);
}

export function matchesAnyGlob(filePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesGlob(filePath, pattern));
}
