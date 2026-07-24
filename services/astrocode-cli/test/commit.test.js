/**
 * The commit trailer is a product requirement, not an implementation detail:
 * every commit Astrocode makes has to be attributable to the model that made
 * it. These assertions are deliberately literal.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCommitMessage, summariseChanges, stripTrailer } from '../src/git/commit.js';
import { getModel, commitAuthor } from '../src/core/models.js';

test('the trailer names the model exactly, followed by Tripplet', () => {
  const msg = buildCommitMessage({
    subject: 'feat: add the thing',
    model: getModel('astro-5-code'),
  });
  assert.ok(msg.includes('Co-Authored by Astro 5 Code - Tripplet'), msg);
  assert.ok(msg.includes('🚀 Generated with Astrocode'), msg);
  assert.ok(
    msg.indexOf('🚀 Generated with Astrocode') < msg.indexOf('Co-Authored by'),
    'the generated-with line comes first',
  );
  assert.ok(msg.startsWith('feat: add the thing'));
});

test('each model produces its own display name in the trailer', () => {
  const expected = {
    'astro-5-code': 'Co-Authored by Astro 5 Code - Tripplet',
    'taipei-4': 'Co-Authored by Taipei 4 - Tripplet',
    'majuli-4': 'Co-Authored by Majuli 4 - Tripplet',
    'suzhou-4': 'Co-Authored by Suzhou 4 - Tripplet',
  };
  for (const [id, line] of Object.entries(expected)) {
    const msg = buildCommitMessage({ subject: 'chore: x', model: getModel(id) });
    assert.ok(msg.includes(line), `${id} -> ${line}\n${msg}`);
    assert.equal(commitAuthor(getModel(id)), line.replace('Co-Authored by ', ''));
  }
});

test('a multi-model session emits one trailer per model in first-use order', () => {
  const used = ['majuli-4', 'taipei-4', 'suzhou-4', 'astro-5-code'].map(getModel);
  const msg = buildCommitMessage({ subject: 'feat: many hands', model: used[0], coAuthors: used });
  const lines = msg.split('\n').filter((l) => l.startsWith('Co-Authored by'));
  assert.deepEqual(lines, [
    'Co-Authored by Majuli 4 - Tripplet',
    'Co-Authored by Taipei 4 - Tripplet',
    'Co-Authored by Suzhou 4 - Tripplet',
    'Co-Authored by Astro 5 Code - Tripplet',
  ]);
});

test('a model is never listed twice', () => {
  const a = getModel('taipei-4');
  const msg = buildCommitMessage({ subject: 'fix: dedupe', model: a, coAuthors: [a, a, getModel('majuli-4'), a] });
  const lines = msg.split('\n').filter((l) => l.startsWith('Co-Authored by'));
  assert.deepEqual(lines, [
    'Co-Authored by Taipei 4 - Tripplet',
    'Co-Authored by Majuli 4 - Tripplet',
  ]);
});

test('the body sits between the subject and the trailer', () => {
  const msg = buildCommitMessage({
    subject: 'feat: layered',
    body: '- one\n- two',
    model: getModel('suzhou-4'),
  });
  const iSubject = msg.indexOf('feat: layered');
  const iBody = msg.indexOf('- one');
  const iTrailer = msg.indexOf('Co-Authored by');
  assert.ok(iSubject < iBody && iBody < iTrailer, msg);
  assert.ok(msg.includes('\n\n- one'), 'blank line after the subject');
});

test('the message ends with exactly one newline and no trailing blanks', () => {
  const msg = buildCommitMessage({ subject: 'chore: tidy', model: getModel('taipei-4') });
  assert.ok(!/\n\n$/.test(msg), 'no double newline at the end');
  assert.ok(!/[ \t]+\n/.test(msg), 'no trailing whitespace on any line');
});

test('stripTrailer is the inverse of adding one', () => {
  const msg = buildCommitMessage({ subject: 'feat: round trip', body: 'details here', model: getModel('astro-5-code') });
  const bare = stripTrailer(msg);
  assert.ok(!bare.includes('Co-Authored by'));
  assert.ok(!bare.includes('Generated with Astrocode'));
  assert.ok(bare.includes('feat: round trip'));
  assert.ok(bare.includes('details here'));
});

test('summariseChanges writes a conventional subject from real status', () => {
  const status = {
    staged: [], unstaged: [], untracked: [],
    files: [
      { path: 'src/feature.js', status: 'added', code: 'A' },
      { path: 'src/other.js', status: 'modified', code: 'M' },
    ],
    clean: false,
  };
  const { subject, body } = summariseChanges(status, '');
  assert.equal(typeof subject, 'string');
  assert.ok(subject.length > 0 && subject.length <= 72, `subject: "${subject}"`);
  assert.match(subject, /^(feat|fix|docs|test|chore|refactor|style|build|ci)(\(.+\))?: /);
  assert.equal(typeof body, 'string');
});

test('a docs-only change is classified as docs', () => {
  const status = {
    staged: [], unstaged: [], untracked: [],
    files: [
      { path: 'README.md', status: 'modified', code: 'M' },
      { path: 'docs/guide.md', status: 'modified', code: 'M' },
    ],
    clean: false,
  };
  assert.match(summariseChanges(status, '').subject, /^docs/);
});

test('a test-only change is classified as test', () => {
  const status = {
    staged: [], unstaged: [], untracked: [],
    files: [{ path: 'test/a.test.js', status: 'added', code: 'A' }],
    clean: false,
  };
  assert.match(summariseChanges(status, '').subject, /^test/);
});
