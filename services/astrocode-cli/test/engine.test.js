import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { Engine } from '../src/engine/engine.js';
import { classify, planFor, scaffold } from '../src/engine/planner.js';
import { voiceFor, makeRng } from '../src/engine/personas.js';
import { Session } from '../src/core/session.js';
import { Permissions } from '../src/tools/permissions.js';
import { TOOLS } from '../src/tools/index.js';
import { getModel } from '../src/core/models.js';
import { getEffort } from '../src/core/effort.js';
import { withTempDir, writeFiles } from './helpers.js';

function engineFor(cwd, { model = 'astro-5-code', effort = 'medium', mode = 'yolo', seed = 42 } = {}) {
  const session = new Session({ cwd, model, effort, seed });
  const permissions = new Permissions({ mode, cwd });
  return {
    session,
    permissions,
    engine: new Engine({ session, tools: TOOLS, permissions, seed }),
  };
}

async function collect(engine, prompt, { signal, onPermission = () => 'deny' } = {}) {
  const events = [];
  for await (const ev of engine.send(prompt, { signal })) {
    events.push(ev);
    if (ev.type === 'tool-permission') ev.resolve(onPermission(ev));
  }
  return events;
}

const textOf = (events) => events.filter((e) => e.type === 'text-delta').map((e) => e.text).join('');
const thinkOf = (events) => events.filter((e) => e.type === 'thinking-delta').map((e) => e.text).join('');

// ── classification ──────────────────────────────────────────────────────────

test('classify recognises the intents it advertises', () => {
  const cases = [
    ['read src/app.js', 'read'],
    ['explain how the router works', 'explain'],
    ['find every use of parseArgs', 'search'],
    ['run the tests', 'test'],
    ['commit this', 'commit'],
    ['hello there', 'chat'],
  ];
  for (const [prompt, intent] of cases) {
    assert.equal(classify(prompt, { cwd: process.cwd() }).intent, intent, prompt);
  }
});

test('classify extracts paths and commands from a prompt', () => {
  const c = classify('read `src/app.js` and then run `npm test`', { cwd: process.cwd() });
  assert.ok(c.entities.paths.includes('src/app.js'));
  assert.ok(c.entities.commands.some((x) => x.includes('npm test')));
  assert.ok(c.confidence > 0 && c.confidence <= 1);
});

test('a request naming a file that does not exist is a create, not a read', () => withTempDir(async (dir) => {
  assert.equal(classify('make lib/parse.js with a parseHeaders function', { cwd: dir }).intent, 'create');
  await writeFiles(dir, { 'lib/parse.js': 'x\n' });
  assert.notEqual(classify('read lib/parse.js', { cwd: dir }).intent, 'create');
}));

test('planFor refuses a path outside the working directory', () => withTempDir(async (dir) => {
  const cls = classify('read ../../etc/passwd', { cwd: dir });
  const steps = planFor(cls, { cwd: dir, model: getModel('taipei-4'), effort: getEffort('low') });
  assert.ok(steps.every((s) => s.kind !== 'tool'), 'no tool step should be planned');
  const said = steps
    .filter((s) => s.kind === 'say')
    .map((s) => (typeof s.build === 'function' ? s.build({ results: [] }) : s.markdown))
    .join('\n');
  assert.match(said, /outside/i, said);
}));

test('scaffold generates syntactically valid JavaScript', () => {
  const src = scaffold('src/thing.js', 'create a file that exports a slugify function');
  assert.ok(src.includes('slugify'), 'uses the requested symbol');
  assert.doesNotThrow(() => new Function(src.replace(/^export (default )?/gm, '')), 'parses');
});

test('scaffold picks the right shape per extension', () => {
  assert.match(scaffold('a.py', 'a helper'), /def |import /);
  assert.match(scaffold('a.sh', 'a script'), /^#!/);
  assert.doesNotThrow(() => JSON.parse(scaffold('a.json', 'config')));
  assert.match(scaffold('C.tsx', 'a React component'), /export function C\b/);
});

// ── personas ────────────────────────────────────────────────────────────────

test('each model has a distinguishable voice', () => {
  const seen = new Set();
  for (const id of ['astro-5-code', 'taipei-4', 'majuli-4', 'suzhou-4']) {
    const v = voiceFor(getModel(id), getEffort('high'), { rng: makeRng('fixed') });
    assert.ok(v.openers.length > 0, `${id} has openers`);
    seen.add(v.voice);
  }
  assert.equal(seen.size, 4, 'all four voices are distinct');
});

test('a higher effort budgets more reasoning', () => {
  const m = getModel('astro-5-code');
  const low = voiceFor(m, getEffort('low')).thinkChars;
  const high = voiceFor(m, getEffort('high')).thinkChars;
  const max = voiceFor(m, getEffort('max')).thinkChars;
  assert.ok(low < high && high < max, `${low} < ${high} < ${max}`);
});

// ── the engine loop ─────────────────────────────────────────────────────────

test('a turn emits a well-formed event stream', () => withTempDir(async (dir) => {
  await writeFiles(dir, { 'a.js': 'export const a = 1\n' });
  const { engine } = engineFor(dir, { effort: 'low' });
  const events = await collect(engine, 'read a.js');

  assert.equal(events[0].type, 'start');
  assert.equal(events[events.length - 1].type, 'done');
  assert.equal(events[events.length - 1].reason, 'end');
  assert.ok(events.some((e) => e.type === 'usage'));
  assert.ok(textOf(events).length > 0, 'the model said something');

  const starts = events.filter((e) => e.type === 'tool-start');
  const ends = events.filter((e) => e.type === 'tool-end');
  assert.equal(starts.length, ends.length, 'every tool-start has a tool-end');
  assert.deepEqual(starts.map((e) => e.id), ends.map((e) => e.id), 'ids pair up in order');
}));

test('the engine actually reads the file it was asked about', () => withTempDir(async (dir) => {
  await writeFiles(dir, { 'target.js': 'export function findMe() {}\n' });
  const { engine } = engineFor(dir);
  const events = await collect(engine, 'read target.js');
  const end = events.find((e) => e.type === 'tool-end');
  assert.equal(end.ok, true);
  assert.equal(end.meta.path, 'target.js');
  assert.match(end.meta.lines[0].text, /findMe/);
}));

test('the engine really writes files when permitted', () => withTempDir(async (dir) => {
  const { engine } = engineFor(dir, { mode: 'yolo' });
  await collect(engine, 'create a file greet.js that exports a greet function');
  const written = await fs.readFile(path.join(dir, 'greet.js'), 'utf8');
  assert.match(written, /greet/);
}));

test('plan mode refuses to write and says so', () => withTempDir(async (dir) => {
  const { engine } = engineFor(dir, { mode: 'plan' });
  const events = await collect(engine, 'create a file nope.js that exports a thing');
  const end = events.find((e) => e.type === 'tool-end');
  assert.equal(end.ok, false);
  assert.equal(end.denied, true);
  await assert.rejects(() => fs.access(path.join(dir, 'nope.js')), 'the file must not exist');
}));

test('ask mode routes through the permission event and honours a yes', () => withTempDir(async (dir) => {
  const { engine } = engineFor(dir, { mode: 'ask' });
  const events = await collect(engine, 'create a file yes.js that exports a thing', {
    onPermission: () => 'once',
  });
  const asked = events.find((e) => e.type === 'tool-permission');
  assert.ok(asked, 'the engine asked');
  assert.equal(typeof asked.request.key, 'string');
  assert.equal(await fs.readFile(path.join(dir, 'yes.js'), 'utf8').then(() => true), true);
}));

test('declining a mutation stops the turn without writing', () => withTempDir(async (dir) => {
  const { engine } = engineFor(dir, { mode: 'ask' });
  const events = await collect(engine, 'create a file no.js that exports a thing', {
    onPermission: () => 'deny',
  });
  assert.equal(events.find((e) => e.type === 'tool-end').ok, false);
  await assert.rejects(() => fs.access(path.join(dir, 'no.js')));
}));

test('a session grant means the second call does not ask again', () => withTempDir(async (dir) => {
  const { engine } = engineFor(dir, { mode: 'ask' });
  let asks = 0;
  await collect(engine, 'create a file one.js that exports a thing', {
    onPermission: () => { asks++; return 'session'; },
  });
  await collect(engine, 'create a file one.js that exports a thing', {
    onPermission: () => { asks++; return 'session'; },
  });
  assert.equal(asks, 1, 'only the first call should prompt');
}));

test('the same seed reproduces a run exactly', () => withTempDir(async (dir) => {
  await writeFiles(dir, { 'a.js': 'const a = 1\n' });
  const runs = [];
  for (let i = 0; i < 2; i++) {
    const { engine } = engineFor(dir, { seed: 1234, effort: 'high' });
    const events = await collect(engine, 'explain a.js');
    runs.push(textOf(events) + ' ' + thinkOf(events));
  }
  assert.equal(runs[0], runs[1]);
}));

test('a different seed produces different reasoning', () => withTempDir(async (dir) => {
  await writeFiles(dir, { 'a.js': 'const a = 1\n' });
  const out = [];
  for (const seed of [1, 999]) {
    const { engine } = engineFor(dir, { seed, effort: 'high' });
    out.push(thinkOf(await collect(engine, 'explain a.js')));
  }
  assert.notEqual(out[0], out[1]);
}));

test('low effort surfaces no reasoning, high effort does', () => withTempDir(async (dir) => {
  await writeFiles(dir, { 'a.js': 'const a = 1\n' });
  const low = await collect(engineFor(dir, { effort: 'low' }).engine, 'explain a.js');
  const high = await collect(engineFor(dir, { effort: 'high' }).engine, 'explain a.js');
  assert.equal(thinkOf(low).length, 0);
  assert.ok(thinkOf(high).length > 0);
}));

test('an aborted turn stops promptly and reports it', () => withTempDir(async (dir) => {
  const { engine } = engineFor(dir, { model: 'suzhou-4', effort: 'max' });
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 50);
  const events = await collect(engine, 'explain everything about this repository', { signal: ac.signal });
  assert.equal(events[events.length - 1].type, 'done');
  assert.equal(events[events.length - 1].reason, 'aborted');
}));

test('usage is reported and is non-zero', () => withTempDir(async (dir) => {
  const { engine } = engineFor(dir);
  const usage = (await collect(engine, 'hello')).find((e) => e.type === 'usage');
  assert.ok(usage.input > 0);
  assert.ok(usage.output > 0);
  assert.equal(usage.total, usage.input + usage.output);
}));

test('a bare greeting answers without touching any tool', () => withTempDir(async (dir) => {
  const { engine } = engineFor(dir);
  const events = await collect(engine, 'hi');
  assert.equal(events.filter((e) => e.type === 'tool-start').length, 0);
  assert.ok(textOf(events).length > 0);
}));
