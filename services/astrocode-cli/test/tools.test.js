import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { TOOLS, getTool, toolNames, runTool } from '../src/tools/index.js';
import { withTempDir, writeFiles, ctxFor } from './helpers.js';

test('the registry exposes every advertised tool', () => {
  assert.deepEqual(toolNames().sort(),
    ['bash', 'edit', 'glob', 'grep', 'ls', 'multiedit', 'read', 'todo', 'write'].sort());
  for (const name of toolNames()) {
    const t = getTool(name);
    assert.equal(typeof t.run, 'function', `${name}.run`);
    assert.equal(typeof t.describe, 'function', `${name}.describe`);
    assert.equal(typeof t.title, 'string', `${name}.title`);
  }
});

test('read returns numbered lines and real metadata', () => withTempDir(async (dir) => {
  await writeFiles(dir, { 'a.js': 'one\ntwo\nthree\n' });
  const r = await TOOLS.read.run({ path: 'a.js' }, ctxFor(dir));
  assert.equal(r.ok, true);
  assert.equal(r.meta.lines[0].n, 1);
  assert.equal(r.meta.lines[0].text, 'one');
  // A trailing newline terminates the third line; it does not add a fourth.
  assert.equal(r.meta.totalLines, 3);
  assert.match(r.summary, /Read 3 lines/);
  assert.equal(r.meta.lines[2].text, 'three');
}));

test('read reports missing files, directories and binaries clearly', () => withTempDir(async (dir) => {
  const missing = await TOOLS.read.run({ path: 'nope.txt' }, ctxFor(dir));
  assert.equal(missing.ok, false);
  assert.match(missing.error, /does not exist/);

  await fs.mkdir(path.join(dir, 'sub'));
  const isDir = await TOOLS.read.run({ path: 'sub' }, ctxFor(dir));
  assert.equal(isDir.ok, false);
  assert.match(isDir.error, /directory/);

  await fs.writeFile(path.join(dir, 'bin.dat'), Buffer.from([0x41, 0x00, 0x42]));
  const bin = await TOOLS.read.run({ path: 'bin.dat' }, ctxFor(dir));
  assert.equal(bin.ok, false);
  assert.match(bin.error, /binary/);
}));

test('every tool refuses to escape the working directory', () => withTempDir(async (dir) => {
  const cases = [
    ['read', { path: '../../etc/passwd' }],
    ['write', { path: '../escape.txt', content: 'x' }],
    ['edit', { path: '/etc/hosts', old_string: 'a', new_string: 'b' }],
    ['ls', { path: '..' }],
    ['glob', { pattern: '*', path: '../..' }],
    ['grep', { pattern: 'x', path: '../..' }],
  ];
  for (const [name, input] of cases) {
    const r = await runTool(name, input, ctxFor(dir));
    assert.equal(r.ok, false, `${name} should refuse`);
    assert.match(r.error, /outside the working directory/, `${name} reason`);
  }
  assert.equal(await fs.readdir(path.dirname(dir)).then((f) => f.includes('escape.txt')), false);
}));

test('write creates parent directories and counts the change', () => withTempDir(async (dir) => {
  const created = await TOOLS.write.run({ path: 'deep/nested/x.txt', content: 'hi\n' }, ctxFor(dir));
  assert.equal(created.ok, true);
  assert.equal(created.meta.created, true);
  assert.equal(await fs.readFile(path.join(dir, 'deep/nested/x.txt'), 'utf8'), 'hi\n');

  const updated = await TOOLS.write.run({ path: 'deep/nested/x.txt', content: 'hi\nthere\n' }, ctxFor(dir));
  assert.equal(updated.meta.created, false);
  assert.equal(updated.meta.added, 1);
  assert.ok(updated.meta.diff.includes('+there'));

  const same = await TOOLS.write.run({ path: 'deep/nested/x.txt', content: 'hi\nthere\n' }, ctxFor(dir));
  assert.match(same.summary, /No change/);
}));

test('edit replaces exactly once and rejects ambiguity', () => withTempDir(async (dir) => {
  await writeFiles(dir, { 'x.js': 'let a = 1\nlet a = 1\n' });

  const ambiguous = await TOOLS.edit.run({ path: 'x.js', old_string: 'let a = 1', new_string: 'let b = 2' }, ctxFor(dir));
  assert.equal(ambiguous.ok, false);
  assert.match(ambiguous.error, /matches 2\+ times/);
  assert.equal(await fs.readFile(path.join(dir, 'x.js'), 'utf8'), 'let a = 1\nlet a = 1\n',
    'a rejected edit must not touch the file');

  const all = await TOOLS.edit.run({ path: 'x.js', old_string: 'let a = 1', new_string: 'let b = 2', replace_all: true }, ctxFor(dir));
  assert.equal(all.ok, true);
  assert.equal(await fs.readFile(path.join(dir, 'x.js'), 'utf8'), 'let b = 2\nlet b = 2\n');

  const missing = await TOOLS.edit.run({ path: 'x.js', old_string: 'nope', new_string: 'y' }, ctxFor(dir));
  assert.equal(missing.ok, false);
  assert.match(missing.error, /not found/);
}));

test('edit does not treat $& in the replacement as a backreference', () => withTempDir(async (dir) => {
  await writeFiles(dir, { 'p.js': 'const price = TOKEN\n' });
  const r = await TOOLS.edit.run({ path: 'p.js', old_string: 'TOKEN', new_string: "'$&'" }, ctxFor(dir));
  assert.equal(r.ok, true);
  assert.equal(await fs.readFile(path.join(dir, 'p.js'), 'utf8'), "const price = '$&'\n");
}));

test('multiedit is all-or-nothing', () => withTempDir(async (dir) => {
  await writeFiles(dir, { 'm.js': 'alpha\nbeta\n' });
  const r = await TOOLS.multiedit.run({
    path: 'm.js',
    edits: [
      { old_string: 'alpha', new_string: 'ALPHA' },
      { old_string: 'nonexistent', new_string: 'x' },
    ],
  }, ctxFor(dir));
  assert.equal(r.ok, false);
  assert.equal(await fs.readFile(path.join(dir, 'm.js'), 'utf8'), 'alpha\nbeta\n',
    'the first edit must be rolled back when a later one fails');

  const ok = await TOOLS.multiedit.run({
    path: 'm.js',
    edits: [
      { old_string: 'alpha', new_string: 'ALPHA' },
      { old_string: 'beta', new_string: 'BETA' },
    ],
  }, ctxFor(dir));
  assert.equal(ok.ok, true);
  assert.equal(await fs.readFile(path.join(dir, 'm.js'), 'utf8'), 'ALPHA\nBETA\n');
}));

test('ls sorts directories first and hides noise', () => withTempDir(async (dir) => {
  await writeFiles(dir, { 'b.txt': '', 'a/x.txt': '', 'node_modules/pkg/i.js': '' });
  const r = await TOOLS.ls.run({ path: '.' }, ctxFor(dir));
  assert.equal(r.ok, true);
  assert.deepEqual(r.meta.files, ['a/', 'b.txt']);
}));

test('bash runs real commands and reports the exit code', () => withTempDir(async (dir) => {
  const ok = await TOOLS.bash.run({ command: 'echo hello' }, ctxFor(dir));
  assert.equal(ok.ok, true);
  assert.equal(ok.meta.code, 0);
  assert.match(ok.meta.stdout, /hello/);

  const bad = await TOOLS.bash.run({ command: 'exit 3' }, ctxFor(dir));
  assert.equal(bad.ok, false);
  assert.equal(bad.meta.code, 3);
}));

test('bash honours an abort signal', () => withTempDir(async (dir) => {
  const ac = new AbortController();
  const p = TOOLS.bash.run({ command: 'sleep 10' }, ctxFor(dir, { signal: ac.signal }));
  setTimeout(() => ac.abort(), 60);
  const r = await p;
  assert.equal(r.ok, false);
  assert.equal(r.error, 'aborted');
}));

test('bash honours a timeout', () => withTempDir(async (dir) => {
  const r = await TOOLS.bash.run({ command: 'sleep 5', timeout: 1000 }, ctxFor(dir));
  assert.equal(r.ok, false);
  assert.equal(r.meta.timedOut, true);
}));

test('todo stores a validated list on the session', () => withTempDir(async (dir) => {
  const ctx = ctxFor(dir);
  const r = await TOOLS.todo.run({
    todos: [
      { content: 'one', status: 'completed' },
      { content: 'two', status: 'bogus' },
      { content: '   ', status: 'pending' },
    ],
  }, ctx);
  assert.equal(r.ok, true);
  assert.equal(ctx.session.todos.length, 2);
  assert.equal(ctx.session.todos[1].status, 'pending');   // invalid status normalised
  assert.equal(r.summary, '1/2 complete');
}));

test('runTool turns an unknown tool into a result, not a throw', async () => {
  const r = await runTool('nope', {}, ctxFor(process.cwd()));
  assert.equal(r.ok, false);
  assert.match(r.error, /unknown tool/);
});
