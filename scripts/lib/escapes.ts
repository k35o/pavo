// Repair a structured output whose escape sequences arrived as literal text.
//
// A newline inside the review body travels as `\n` in the structured-output
// JSON. Models occasionally write that escape as two characters *inside* the
// string, so JSON.parse hands it back verbatim and GitHub renders the whole
// review as one paragraph with a visible \n.

function eachString(value: unknown, visit: (text: string) => void): void {
  if (typeof value === 'string') visit(value);
  else if (Array.isArray(value)) for (const item of value) eachString(item, visit);
  else if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) eachString(item, visit);
  }
}

function mapStrings<T>(value: T, map: (text: string) => string): T {
  if (typeof value === 'string') return map(value) as T;
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, map)) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, mapStrings(item, map)]),
    ) as T;
  }
  return value;
}

/**
 * Turn a literal `\n` / `\t` in a parsed structured output back into the
 * character it stands for.
 *
 * The decision is made over the whole output rather than per string: a model
 * that writes one field this way writes them all that way, so a `\n` sitting
 * next to real line breaks is text that means those two characters — a
 * `text.split('\n')` suggestion must survive untouched.
 */
export function repairLiteralEscapes<T>(output: T): T {
  let literal = false;
  let real = false;
  eachString(output, (text) => {
    literal ||= text.includes('\\n');
    real ||= text.includes('\n');
  });
  if (!literal || real) return output;
  return mapStrings(output, (text) => text.replaceAll('\\n', '\n').replaceAll('\\t', '\t'));
}
