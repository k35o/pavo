import assert from 'node:assert/strict';
import test from 'node:test';

import { selectThreadsToResolve } from '../scripts/lib/threads.ts';
import type { ThreadNode } from '../scripts/lib/threads.ts';

const BOT = 'k35o-bot[bot]';

const thread = (
  id: string,
  rootId: number,
  login: string,
  isResolved = false,
): ThreadNode => ({
  id,
  isResolved,
  comments: { nodes: [{ databaseId: rootId, author: { login } }] },
});

test('bot が起点の未解決スレッドだけが resolve 対象になる', () => {
  const threads = [
    // GraphQL は login を [bot] サフィックスなしで返す
    thread('T1', 101, 'k35o-bot'),
    thread('T2', 102, 'k8o'),
    thread('T3', 103, 'k35o-bot', true),
    thread('T4', 104, 'k35o-bot'),
  ];
  assert.deepEqual(selectThreadsToResolve(threads, [101, 102, 103], BOT), ['T1']);
});

test('rootIds にないスレッド・root コメントのないスレッドは対象外', () => {
  const noRoot: ThreadNode = { id: 'T0', isResolved: false, comments: { nodes: [] } };
  const threads = [noRoot, thread('T1', 101, 'k35o-bot')];
  assert.deepEqual(selectThreadsToResolve(threads, [999], BOT), []);
  assert.deepEqual(selectThreadsToResolve(threads, [], BOT), []);
});
