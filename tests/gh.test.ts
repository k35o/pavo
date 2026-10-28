import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { failureDetail, gh } from '../scripts/lib/gh.ts';

// What the real `gh api` printed for a 422 (`gh api 'search/issues?q='`):
// a bare summary on stderr, GitHub's response body on stdout.
const SUMMARY = 'gh: Validation Failed (HTTP 422)';
const BODY =
  '{"message":"Validation Failed","errors":[{"resource":"Search","field":"q","code":"missing"}],"documentation_url":"https://docs.github.com/v3/search","status":"422"}';

let fakeBin: string;
let originalPath: string | undefined;

before(() => {
  fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'pavo-fake-gh-'));
  fs.writeFileSync(
    path.join(fakeBin, 'gh'),
    `#!/bin/sh\nprintf '%s' '${BODY}'\necho '${SUMMARY}' >&2\nexit 1\n`,
    { mode: 0o755 },
  );
  originalPath = process.env.PATH;
  process.env.PATH = `${fakeBin}${path.delimiter}${originalPath ?? ''}`;
});

after(() => {
  process.env.PATH = originalPath;
  fs.rmSync(fakeBin, { recursive: true, force: true });
});

test('gh: HTTP エラーで投げる例外に stderr の要約と stdout のレスポンス本文を両方含める', () => {
  assert.throws(
    () => gh(['api', 'search/issues?q=']),
    (error: Error) => error.message.includes(SUMMARY) && error.message.includes(BODY),
  );
});

test('failureDetail: allowFailure で受けた失敗からもレスポンス本文を落とさない', () => {
  const result = gh(['api', 'search/issues?q='], { allowFailure: true });

  const detail = failureDetail(result);

  assert.ok(detail.includes(SUMMARY));
  assert.ok(detail.includes(BODY));
});
