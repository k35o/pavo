import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { setOutputs } from '../scripts/lib/actions.ts';

test('setOutputs: 単一行は key=value、複数行はランダム区切りの heredoc になる', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pavo-out-'));
  const file = path.join(dir, 'output');
  fs.writeFileSync(file, '');
  const original = process.env.GITHUB_OUTPUT;
  process.env.GITHUB_OUTPUT = file;
  try {
    setOutputs({ single: 'value', multi: 'line1\nEOF\nline2' });
  } finally {
    if (original === undefined) delete process.env.GITHUB_OUTPUT;
    else process.env.GITHUB_OUTPUT = original;
  }

  const content = fs.readFileSync(file, 'utf8');
  assert.ok(content.includes('single=value\n'));
  const heredoc = /multi<<(EOF_[0-9a-f]{32})\nline1\nEOF\nline2\n\1\n/.exec(content);
  assert.ok(heredoc, `heredoc 形式で書かれていない: ${content}`);
});
