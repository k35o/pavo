// GitHub Actions runner integration helpers.

import fs from 'node:fs';
import { randomBytes } from 'node:crypto';

/**
 * Append step outputs to $GITHUB_OUTPUT. Multiline values use a random
 * heredoc delimiter so bodies cannot terminate the block early.
 */
export function setOutputs(outputs: Record<string, string>): void {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) {
    for (const [key, value] of Object.entries(outputs)) {
      console.log(`[output] ${key}=${value}`);
    }
    return;
  }
  let content = '';
  for (const [key, value] of Object.entries(outputs)) {
    if (value.includes('\n')) {
      const delim = `EOF_${randomBytes(16).toString('hex')}`;
      content += `${key}<<${delim}\n${value}\n${delim}\n`;
    } else {
      content += `${key}=${value}\n`;
    }
  }
  fs.appendFileSync(file, content);
}

/** Append a Markdown fragment to the job summary, if available. */
export function addStepSummary(markdown: string): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  fs.appendFileSync(file, `${markdown}\n`);
}

export function notice(message: string): void {
  console.log(`::notice::${message.replaceAll('\n', ' ')}`);
}

export function warning(message: string): void {
  console.log(`::warning::${message.replaceAll('\n', ' ')}`);
}
