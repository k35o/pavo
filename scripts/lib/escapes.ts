// Repair a structured output whose escape sequences arrived as literal text.
//
// A newline inside the review body travels as `\n` in the structured-output
// JSON. Models occasionally write that escape as two characters *inside* the
// string, so JSON.parse hands it back verbatim and GitHub renders the whole
// text as one paragraph with a visible \n.

const isDoubleEscaped = (text: string): boolean => !text.includes('\n') && text.includes('\\n');

const unescape = (text: string): string => text.replaceAll('\\n', '\n').replaceAll('\\t', '\t');

// Inline code keeps its literal `\n`: in `split('\n')` the two characters are
// the point. A fenced block cannot exist on a single line, so inside a
// double-escaped string it is restored along with the prose around it.
const CODE = /(```[\s\S]*?```|`[^`]+`)/;

function repairProse(text: string): string {
  return text
    .split(CODE)
    .map((part, index) => (index % 2 === 1 && !part.startsWith('```') ? part : unescape(part)))
    .join('');
}

function repair(value: unknown): unknown {
  if (typeof value === 'string') return isDoubleEscaped(value) ? repairProse(value) : value;
  if (Array.isArray(value)) return value.map(repair);
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  // A suggestion is bare code where a literal `\n` is usually meant, so it is
  // only restored when the body written alongside it was escaped too.
  const bodyEscaped = typeof record.body === 'string' && isDoubleEscaped(record.body);
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => {
      if (key !== 'suggestion') return [key, repair(item)];
      return [key, bodyEscaped && typeof item === 'string' && !item.includes('\n') ? unescape(item) : item];
    }),
  );
}

/**
 * Turn a literal `\n` / `\t` in a parsed structured output back into the
 * character it stands for. Each string is judged on its own: one field
 * written with real line breaks says nothing about the others.
 */
export function repairLiteralEscapes<T>(output: T): T {
  return repair(output) as T;
}
