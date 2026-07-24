import test from 'node:test';
import assert from 'node:assert/strict';

import { TOOLS, globToRegExp } from '../src/tools/index.js';
import { withTempDir, writeFiles, ctxFor } from './helpers.js';

const m = (pattern, s) => globToRegExp(pattern).test(s);

test('* matches within a path segment only', () => {
  assert.equal(m('*.js', 'a.js'), true);
  assert.equal(m('*.js', 'a.ts'), false);
  assert.equal(m('*.js', 'src/a.js'), false);
  assert.equal(m('src/*.js', 'src/a.js'), true);
  assert.equal(m('src/*.js', 'src/deep/a.js'), false);
});

test('** crosses directory separators', () => {
  assert.equal(m('**/*.js', 'a.js'), true);
  assert.equal(m('**/*.js', 'src/a.js'), true);
  assert.equal(m('**/*.js', 'src/deep/nested/a.js'), true);
  assert.equal(m('src/**/*.test.js', 'src/x/y/z.test.js'), true);
  assert.equal(m('src/**/*.test.js', 'lib/x.test.js'), false);
});

test('? matches exactly one character', () => {
  assert.equal(m('a?.js', 'ab.js'), true);
  assert.equal(m('a?.js', 'abc.js'), false);
  assert.equal(m('a?.js', 'a/.js'), false);
});

test('brace alternation', () => {
  assert.equal(m('*.{js,ts}', 'a.js'), true);
  assert.equal(m('*.{js,ts}', 'a.ts'), true);
  assert.equal(m('*.{js,ts}', 'a.py'), false);
  assert.equal(m('**/*.{test,spec}.{js,ts}', 'src/a.test.ts'), true);
});

test('character classes', () => {
  assert.equal(m('[abc].js', 'a.js'), true);
  assert.equal(m('[abc].js', 'd.js'), false);
  assert.equal(m('[!abc].js', 'd.js'), true);
  assert.equal(m('v[0-9].txt', 'v7.txt'), true);
});

test('regex metacharacters in a pattern are literal', () => {
  assert.equal(m('a.b.js', 'a.b.js'), true);
  assert.equal(m('a.b.js', 'axbxjs'), false);
  assert.equal(m('file(1).txt', 'file(1).txt'), true);
});

test('glob finds real files and skips vendored directories', () => withTempDir(async (dir) => {
  await writeFiles(dir, {
    'a.js': '', 'src/b.js': '', 'src/deep/c.js': '', 'src/d.ts': '',
    'node_modules/pkg/e.js': '', 'dist/f.js': '',
  });
  const r = await TOOLS.glob.run({ pattern: '**/*.js' }, ctxFor(dir));
  assert.equal(r.ok, true);
  const files = r.meta.files.sort();
  assert.deepEqual(files, ['a.js', 'src/b.js', 'src/deep/c.js']);
}));

test('glob reaches into an ignored directory when asked explicitly', () => withTempDir(async (dir) => {
  await writeFiles(dir, { 'node_modules/pkg/e.js': '', 'a.js': '' });
  const r = await TOOLS.glob.run({ pattern: 'node_modules/**/*.js' }, ctxFor(dir));
  assert.deepEqual(r.meta.files, ['node_modules/pkg/e.js']);
}));

test('grep finds matches with file and line numbers', () => withTempDir(async (dir) => {
  await writeFiles(dir, {
    'a.js': 'const x = 1\nfunction target() {}\n',
    'b.js': 'target()\n',
    'c.txt': 'nothing here\n',
  });
  const r = await TOOLS.grep.run({ pattern: 'target' }, ctxFor(dir));
  assert.equal(r.ok, true);
  assert.equal(r.meta.matches.length, 2);
  const a = r.meta.matches.find((x) => x.file === 'a.js');
  assert.equal(a.line, 2);
  assert.match(a.text, /function target/);
}));

test('grep honours a glob filter and ignoreCase', () => withTempDir(async (dir) => {
  await writeFiles(dir, { 'a.js': 'Target\n', 'b.ts': 'Target\n' });
  const filtered = await TOOLS.grep.run({ pattern: 'Target', glob: '*.ts' }, ctxFor(dir));
  assert.deepEqual(filtered.meta.files, ['b.ts']);

  const insensitive = await TOOLS.grep.run({ pattern: 'target', ignoreCase: true }, ctxFor(dir));
  assert.equal(insensitive.meta.matches.length, 2);

  const sensitive = await TOOLS.grep.run({ pattern: 'target' }, ctxFor(dir));
  assert.equal(sensitive.meta.matches.length, 0);
}));

test('grep reports an invalid pattern instead of throwing', () => withTempDir(async (dir) => {
  const r = await TOOLS.grep.run({ pattern: '([' }, ctxFor(dir));
  assert.equal(r.ok, false);
  assert.match(r.error, /invalid pattern/);
}));

test('grep skips binary files', () => withTempDir(async (dir) => {
  const { default: fs } = await import('node:fs/promises');
  const path = await import('node:path');
  await writeFiles(dir, { 'a.js': 'needle\n' });
  await fs.writeFile(path.join(dir, 'bin.dat'), Buffer.from('needle\0needle'));
  const r = await TOOLS.grep.run({ pattern: 'needle' }, ctxFor(dir));
  assert.deepEqual(r.meta.files, ['a.js']);
}));
