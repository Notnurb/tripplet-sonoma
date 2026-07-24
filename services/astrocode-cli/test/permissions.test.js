import test from 'node:test';
import assert from 'node:assert/strict';

import { Permissions, MODES, isReadOnlyCommand } from '../src/tools/permissions.js';

const P = (mode, extra = {}) => new Permissions({ mode, cwd: '/tmp/project', ...extra });

test('every advertised mode is accepted', () => {
  assert.deepEqual(MODES, ['ask', 'acceptEdits', 'plan', 'yolo']);
  for (const m of MODES) assert.equal(P(m).mode, m);
});

test('read-only tools are allowed in every mode', () => {
  for (const mode of MODES) {
    for (const tool of ['read', 'ls', 'glob', 'grep', 'todo']) {
      assert.equal(P(mode).check(tool, { path: 'a.js', pattern: 'x' }), 'allow',
        `${tool} in ${mode}`);
    }
  }
});

test('ask mode asks before mutating', () => {
  const p = P('ask');
  assert.equal(p.check('write', { path: 'a.js', content: '' }), 'ask');
  assert.equal(p.check('edit', { path: 'a.js' }), 'ask');
  assert.equal(p.check('bash', { command: 'npm install' }), 'ask');
});

test('acceptEdits auto-allows file writes but still asks for shell', () => {
  const p = P('acceptEdits');
  assert.equal(p.check('write', { path: 'a.js', content: '' }), 'allow');
  assert.equal(p.check('edit', { path: 'a.js' }), 'allow');
  assert.equal(p.check('multiedit', { path: 'a.js', edits: [] }), 'allow');
  assert.equal(p.check('bash', { command: 'rm a.js' }), 'ask');
});

test('plan mode denies every mutation', () => {
  const p = P('plan');
  for (const [tool, input] of [
    ['write', { path: 'a.js', content: '' }],
    ['edit', { path: 'a.js' }],
    ['multiedit', { path: 'a.js', edits: [] }],
    ['bash', { command: 'npm install' }],
  ]) {
    assert.equal(p.check(tool, input), 'deny', `${tool} must be denied in plan mode`);
  }
  // …but a read-only shell command is still fine
  assert.equal(p.check('bash', { command: 'git status' }), 'allow');
});

test('yolo allows ordinary mutations', () => {
  const p = P('yolo');
  assert.equal(p.check('write', { path: 'a.js', content: '' }), 'allow');
  assert.equal(p.check('bash', { command: 'npm install' }), 'allow');
});

test('catastrophic commands are denied even under yolo', () => {
  const p = P('yolo');
  for (const command of [
    'rm -rf /',
    'rm -rf ~',
    'sudo rm -rf / --no-preserve-root',
    ':(){ :|:& };:',
    'mkfs.ext4 /dev/sda1',
    'dd if=/dev/zero of=/dev/sda',
  ]) {
    assert.equal(p.check('bash', { command }), 'deny', `${command} must be denied`);
    assert.equal(p.isDestructiveCommand(command).danger, true, `${command} flagged`);
  }
});

test('writes outside the working directory are denied in every mode', () => {
  for (const mode of MODES) {
    const p = P(mode);
    assert.equal(p.check('write', { path: '/etc/passwd', content: 'x' }), 'deny', mode);
    assert.equal(p.check('edit', { path: '../../secrets.env' }), 'deny', mode);
  }
});

test('isReadOnlyCommand distinguishes inspection from mutation', () => {
  for (const c of ['ls -la', 'git status', 'git log --oneline', 'git diff', 'cat a.js',
    'pwd', 'grep -r x .', 'node --version', 'which node', 'wc -l a.js']) {
    assert.equal(isReadOnlyCommand(c), true, `${c} is read-only`);
  }
  for (const c of ['rm a.js', 'npm install', 'git commit -m x', 'git push',
    'echo hi > file', 'cat a.js > b.js', 'ls && rm -rf x', 'mv a b']) {
    assert.equal(isReadOnlyCommand(c), false, `${c} is not read-only`);
  }
});

test('a session grant stops the prompting for that key', () => {
  const p = P('ask');
  const key = p.keyFor('bash', { command: 'npm test' });
  assert.equal(p.check('bash', { command: 'npm test' }), 'ask');
  p.allowSession(key);
  assert.equal(p.check('bash', { command: 'npm test' }), 'allow');
  // …but an unrelated command still asks
  assert.equal(p.check('bash', { command: 'npm publish' }), 'ask');
});

test('explain returns a decision, a reason and a stable key', () => {
  const p = P('ask');
  const v = p.explain('write', { path: 'src/a.js', content: 'x' });
  assert.ok(['allow', 'deny', 'ask'].includes(v.decision));
  assert.equal(typeof v.reason, 'string');
  assert.equal(typeof v.key, 'string');
  assert.equal(v.key, p.explain('write', { path: 'src/a.js', content: 'y' }).key,
    'the key must not depend on file contents');
});

test('setMode switches behaviour at runtime', () => {
  const p = P('plan');
  assert.equal(p.check('write', { path: 'a.js', content: '' }), 'deny');
  p.setMode('yolo');
  assert.equal(p.check('write', { path: 'a.js', content: '' }), 'allow');
});
