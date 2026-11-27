import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { resolveInstructions, skillsDir } from '../scripts/lib/instructions.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

type Manifest = Record<string, { deps?: string[]; skills?: string[] }>;

const readManifest = (): Manifest =>
  JSON.parse(fs.readFileSync(path.join(ROOT, 'instructions/index.json'), 'utf8')) as Manifest;

const fileNames = (requested: string): string[] =>
  resolveInstructions(ROOT, requested).files.map((file) => path.basename(file));

test('index.json のすべてのエントリと依存に対応する .md が存在する', () => {
  const manifest = readManifest();
  for (const [name, entry] of Object.entries(manifest)) {
    assert.ok(
      fs.existsSync(path.join(ROOT, 'instructions', `${name}.md`)),
      `instructions/${name}.md が存在しない`,
    );
    for (const dep of entry.deps ?? []) {
      assert.ok(Object.hasOwn(manifest, dep), `${name} の依存 ${dep} が index.json にない`);
    }
  }
});

test('index.json が参照するスキルは vendor の practices プラグインにある', () => {
  for (const [name, entry] of Object.entries(readManifest())) {
    for (const skill of entry.skills ?? []) {
      assert.ok(
        fs.existsSync(path.join(skillsDir(ROOT), skill, 'SKILL.md')),
        `${name} のスキル ${skill} が vendor/claude-plugins にない（git submodule update --init）`,
      );
    }
  }
});

test('常時ロードされるファイルが存在する', () => {
  for (const name of ['system.md', 'formatting.md', 'conversation.md']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'instructions', name)), `instructions/${name} が存在しない`);
  }
});

test('依存が順序どおりに解決され、重複が除去される', () => {
  assert.deepEqual(fileNames('nextjs,react'), ['frontend.md', 'react.md', 'nextjs.md']);
});

test('node は typescript を先にロードする', () => {
  assert.deepEqual(fileNames('node'), ['typescript.md', 'node.md']);
});

test('依存先の観点が持つスキルも、観点の順に重複なく集める', () => {
  assert.deepEqual(resolveInstructions(ROOT, 'default,nextjs,react,testing').skills, [
    'security',
    'react',
    'testing',
  ]);
  assert.deepEqual(resolveInstructions(ROOT, 'typescript').skills, []);
});

test('未知の instruction 名は throw する（黙って観点が欠けない）', () => {
  assert.throws(() => resolveInstructions(ROOT, 'defualt'), /Unknown instruction/);
});

test('スキルの実体がない観点は throw する（submodule の取り忘れで黙って欠けない）', () => {
  const actionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pavo-skill-'));
  fs.mkdirSync(path.join(actionPath, 'instructions'));
  fs.writeFileSync(
    path.join(actionPath, 'instructions/index.json'),
    JSON.stringify({ react: { skills: ['react'] } }),
  );
  fs.writeFileSync(path.join(actionPath, 'instructions/react.md'), '# react');
  assert.throws(() => resolveInstructions(actionPath, 'react'), /Skill "react" for "react" is missing/);
});

test('循環依存は throw する', () => {
  const actionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pavo-cycle-'));
  fs.mkdirSync(path.join(actionPath, 'instructions'));
  fs.writeFileSync(
    path.join(actionPath, 'instructions/index.json'),
    JSON.stringify({ a: { deps: ['b'] }, b: { deps: ['a'] } }),
  );
  fs.writeFileSync(path.join(actionPath, 'instructions/a.md'), '# a');
  fs.writeFileSync(path.join(actionPath, 'instructions/b.md'), '# b');
  assert.throws(() => resolveInstructions(actionPath, 'a'), /Circular instruction dependency/);
});

test('workspace 相対の ./ エントリを解決する', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'pavo-test-'));
  fs.mkdirSync(path.join(workspace, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'docs/custom.md'), '# custom');
  const { files } = resolveInstructions(ROOT, 'default,./docs/custom.md', { workspace });
  assert.equal(path.basename(files[0]!), 'default.md');
  assert.equal(files[1], path.join(workspace, 'docs/custom.md'));
});

test('workspace の外に出る ./ エントリは拒否する', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'pavo-test-'));
  assert.throws(
    () => resolveInstructions(ROOT, './../etc/passwd', { workspace }),
    /escapes the workspace/,
  );
});

test('workspace 外を指す symlink の ./ エントリは拒否する', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'pavo-test-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'pavo-outside-'));
  fs.writeFileSync(path.join(outside, 'secret.md'), 'secret');
  fs.symlinkSync(path.join(outside, 'secret.md'), path.join(workspace, 'link.md'));
  assert.throws(
    () => resolveInstructions(ROOT, './link.md', { workspace }),
    /escapes the workspace/,
  );
});

test('instructions/*.md は常時ロード分を除きすべて index.json に載っている', () => {
  const manifest = readManifest();
  const alwaysLoaded = new Set(['system', 'formatting', 'conversation']);
  const names = fs
    .readdirSync(path.join(ROOT, 'instructions'))
    .filter((file) => file.endsWith('.md'))
    .map((file) => file.replace(/\.md$/, ''))
    .filter((name) => !alwaysLoaded.has(name));
  for (const name of names) {
    assert.ok(Object.hasOwn(manifest, name), `instructions/${name}.md が index.json にない`);
  }
});

test('README の観点テーブルに存在しない観点名がない', () => {
  const manifest = readManifest();
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const linked = [...readme.matchAll(/\[`([a-z-]+)`\]\(instructions\/([a-z-]+)\.md\)/g)];
  for (const [, label, file] of linked) {
    assert.equal(label, file, `README のリンク表記が不一致: ${label} -> ${file}`);
    assert.ok(Object.hasOwn(manifest, file!), `README が index.json にない観点 ${file} を参照`);
  }
});
