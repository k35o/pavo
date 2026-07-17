import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveViewpoints, VIEWPOINTS } from '../agent/lib/viewpoints.ts';

test('依存が順序どおり解決され重複除去される', () => {
  const bodies = resolveViewpoints('default,nextjs,react');
  assert.equal(bodies.length, 4); // default, frontend, react, nextjs
  assert.ok(bodies[1]!.includes('フロントエンド観点'));
  assert.ok(bodies[3]!.includes('Next.js 観点'));
});

test('未知の観点名は throw する', () => {
  assert.throws(() => resolveViewpoints('default,defualt'), /Unknown viewpoint/);
});

test('全観点の本文が空でない', () => {
  for (const [name, body] of Object.entries(VIEWPOINTS)) {
    assert.ok(body.trim().length > 100, `${name} が短すぎる`);
  }
});
