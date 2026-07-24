/**
 * Every slash command is run for real against a temp repo. Commands print via
 * ctx.print and must never throw, never call process.exit, and never leave the
 * session in a broken state.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { COMMANDS, getCommand, matchCommands } from '../src/commands/index.js';
import { Session } from '../src/core/session.js';
import { DEFAULTS } from '../src/core/config.js';
import { createTheme } from '../src/ui/theme.js';
import { Permissions } from '../src/tools/permissions.js';
import { TOOLS } from '../src/tools/index.js';
import { getModel } from '../src/core/models.js';
import { getEffort } from '../src/core/effort.js';
import * as git from '../src/git/git.js';
import { withTempDir, writeFiles } from './helpers.js';

function contextFor(dir) {
  const session = new Session({ cwd: dir, model: 'taipei-4', effort: 'low' });
  const printed = [];
  let quit = null;
  const ctx = {
    app: null,
    session,
    config: { ...DEFAULTS, autosave: false },
    theme: createTheme('astro'),
    permissions: new Permissions({ mode: 'yolo', cwd: dir }),
    tools: TOOLS,
    cwd: dir,
    version: '0.1.0',
    git,
    print: (l) => printed.push(Array.isArray(l) && Array.isArray(l[0]) ? l : [l]),
    notice: (text) => printed.push([[{ t: String(text) }]]),
    setModel: (m) => session.setModel(typeof m === 'string' ? getModel(m) : m),
    setEffort: (e) => session.setEffort(typeof e === 'string' ? getEffort(e) : e),
    setTheme: (n) => ctx.theme.setPalette(n),
    toggleRainbow: (on) => { ctx.theme.rainbow = on ?? !ctx.theme.rainbow; return ctx.theme.rainbow; },
    select: async () => null,
    clear: () => session.clear(),
    quit: (code) => { quit = code ?? 0; },
    refreshGit: async () => {},
  };
  const text = () => printed
    .flat(1)
    .map((line) => line.map((r) => r.t ?? '').join(''))
    .join('\n');
  return { ctx, session, text, printed, getQuit: () => quit };
}

const initRepo = (dir) => {
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
};

test('the registry is well formed', () => {
  assert.ok(COMMANDS.length >= 15);
  const names = new Set();
  for (const c of COMMANDS) {
    assert.equal(typeof c.name, 'string', 'name');
    assert.ok(c.name.length > 0);
    assert.equal(typeof c.summary, 'string', `${c.name} summary`);
    assert.equal(typeof c.run, 'function', `${c.name} run`);
    assert.ok(!names.has(c.name), `${c.name} is unique`);
    names.add(c.name);
  }
  for (const required of ['help', 'model', 'effort', 'clear', 'init', 'status', 'commit', 'quit']) {
    assert.ok(getCommand(required), `/${required} exists`);
  }
});

test('aliases resolve and never collide with a real name', () => {
  const names = new Set(COMMANDS.map((c) => c.name));
  for (const c of COMMANDS) {
    for (const a of c.aliases || []) {
      assert.ok(!names.has(a), `alias ${a} of /${c.name} shadows a command`);
      assert.equal(getCommand(a).name, c.name, `alias ${a} resolves`);
    }
  }
});

test('matchCommands ranks the canonical name above an alias', () => {
  const hits = matchCommands('mod');
  assert.ok(hits.length > 0);
  assert.equal(hits[0].name, 'model');
});

test('/rainbow exists but is hidden from the listing', () => {
  const c = getCommand('rainbow');
  assert.ok(c, 'the command exists');
  assert.equal(c.hidden, true, 'and stays out of /help');
});

test('every command runs without throwing', () => withTempDir(async (dir) => {
  await writeFiles(dir, { 'a.js': 'export const a = 1\n', 'package.json': '{"name":"x"}' });
  initRepo(dir);
  for (const c of COMMANDS) {
    if (c.name === 'quit' || c.name === 'exit') continue;
    const { ctx } = contextFor(dir);
    await assert.doesNotReject(
      async () => { await c.run(ctx, []); },
      `/${c.name} threw`,
    );
  }
}));

test('/help lists commands with their summaries', () => withTempDir(async (dir) => {
  const { ctx, text } = contextFor(dir);
  await getCommand('help').run(ctx, []);
  const out = text();
  assert.match(out, /\/model/);
  assert.match(out, /\/commit/);
  assert.match(out, /\/effort/);
  assert.ok(!/\/rainbow/.test(out), 'the secret command stays secret');
}));

test('/model with an argument switches, and reports a bad one', () => withTempDir(async (dir) => {
  const { ctx, session, text } = contextFor(dir);
  await getCommand('model').run(ctx, ['majuli']);
  assert.equal(session.model.id, 'majuli-4');

  const bad = contextFor(dir);
  await getCommand('model').run(bad.ctx, ['notamodel']);
  assert.equal(bad.session.model.id, 'taipei-4', 'unchanged after a bad name');
  assert.match(bad.text(), /notamodel|Unknown|not recognise|Did you mean/i);
}));

test('/model with no argument opens the picker when one is available',
  () => withTempDir(async (dir) => {
    const { ctx, session } = contextFor(dir);
    let opened = null;
    ctx.select = async (opts) => { opened = opts; return 'majuli-4'; };

    await getCommand('model').run(ctx, []);
    assert.ok(opened, 'a picker was offered');
    assert.equal(opened.items.length, 4);
    assert.deepEqual(opened.items.map((i) => i.label),
      ['Astro 5 Code', 'Taipei 4', 'Majuli 4', 'Suzhou 4']);
    assert.equal(opened.items.filter((i) => i.current).length, 1, 'exactly one is current');
    assert.equal(opened.items.find((i) => i.current).value, 'taipei-4');
    assert.equal(session.model.id, 'majuli-4', 'the choice was applied');
  }));

test('cancelling the picker leaves the model alone', () => withTempDir(async (dir) => {
  const { ctx, session } = contextFor(dir);
  ctx.select = async () => null;
  await getCommand('model').run(ctx, []);
  assert.equal(session.model.id, 'taipei-4');
}));

test('/model with no argument and no picker falls back to a printed list',
  () => withTempDir(async (dir) => {
    const { ctx, text } = contextFor(dir);
    delete ctx.select;                       // headless: nothing to arrow through
    await getCommand('model').run(ctx, []);
    const out = text();
    for (const n of ['Astro 5 Code', 'Taipei 4', 'Majuli 4', 'Suzhou 4']) {
      assert.match(out, new RegExp(n));
    }
  }));

test('every value-taking command offers a picker with a current item',
  () => withTempDir(async (dir) => {
    for (const [name, count] of [['model', 4], ['effort', 5], ['theme', 4], ['permissions', 4]]) {
      const { ctx } = contextFor(dir);
      let opened = null;
      ctx.select = async (opts) => { opened = opts; return null; };
      await getCommand(name).run(ctx, []);
      assert.ok(opened, `/${name} offered a picker`);
      assert.equal(opened.items.length, count, `/${name} listed every option`);
      assert.equal(opened.items.filter((i) => i.current).length, 1, `/${name} marks one current`);
      for (const i of opened.items) {
        assert.equal(typeof i.label, 'string', `/${name} item has a label`);
        assert.ok(i.value != null, `/${name} item has a value`);
      }
    }
  }));

test('/effort switches and validates', () => withTempDir(async (dir) => {
  const { ctx, session } = contextFor(dir);
  await getCommand('effort').run(ctx, ['xhigh']);
  assert.equal(session.effort.id, 'xhigh');
  await getCommand('effort').run(ctx, ['nonsense']);
  assert.equal(session.effort.id, 'xhigh', 'unchanged after a bad level');
}));

test('/clear empties the transcript', () => withTempDir(async (dir) => {
  const { ctx, session } = contextFor(dir);
  session.user('something');
  assert.ok(session.transcript.length > 0);
  await getCommand('clear').run(ctx, []);
  assert.equal(session.transcript.length, 0);
}));

test('/init writes an ASTRO.md describing the project', () => withTempDir(async (dir) => {
  await writeFiles(dir, {
    'package.json': JSON.stringify({ name: 'demo', scripts: { test: 'node --test' } }),
    'src/index.js': 'export const x = 1\n',
  });
  const { ctx } = contextFor(dir);
  await getCommand('init').run(ctx, []);
  const md = await fs.readFile(path.join(dir, 'ASTRO.md'), 'utf8');
  assert.match(md, /demo/);
  assert.ok(md.length > 100, 'it is a real document');
}));

test('/status reports the live session state', () => withTempDir(async (dir) => {
  initRepo(dir);
  const { ctx, text } = contextFor(dir);
  await getCommand('status').run(ctx, []);
  const out = text();
  assert.match(out, /Taipei 4/);
  assert.match(out, /low/);
  // The path is elided to fit the box, so assert on the labels being present.
  for (const label of ['Model', 'Effort', 'Directory', 'Session', 'Tokens']) {
    assert.match(out, new RegExp(label), `${label} row`);
  }
}));

test('/cost breaks down usage per model', () => withTempDir(async (dir) => {
  const { ctx, session, text } = contextFor(dir);
  session.addUsage('taipei-4', 10_000, 2_000);
  await getCommand('cost').run(ctx, []);
  assert.match(text(), /Taipei 4/);
  assert.match(text(), /\$/);
}));

test('/commit makes a real commit carrying the trailer', () => withTempDir(async (dir) => {
  initRepo(dir);
  await writeFiles(dir, { 'file.js': 'export const a = 1\n' });
  const { ctx, session } = contextFor(dir);
  session.setModel(getModel('suzhou-4'));
  await getCommand('commit').run(ctx, []);

  const message = execFileSync('git', ['log', '-1', '--format=%B'], { cwd: dir, encoding: 'utf8' });
  assert.match(message, /Co-Authored by Suzhou 4 - Tripplet/);
  assert.match(message, /🚀 Generated with Astrocode/);
}));

test('/commit in a clean repo says so instead of failing', () => withTempDir(async (dir) => {
  initRepo(dir);
  await writeFiles(dir, { 'a.js': 'x\n' });
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir });

  const { ctx, text } = contextFor(dir);
  const res = await getCommand('commit').run(ctx, []);
  assert.match(text() + JSON.stringify(res ?? {}), /clean|nothing/i);
}));

test('/commit outside a repo reports it clearly', () => withTempDir(async (dir) => {
  const { ctx, text } = contextFor(dir);
  const res = await getCommand('commit').run(ctx, []);
  assert.match(text() + JSON.stringify(res ?? {}), /not a git repo|no git|repository/i);
}));

test('/diff renders the working tree diff', () => withTempDir(async (dir) => {
  initRepo(dir);
  await writeFiles(dir, { 'a.js': 'one\n' });
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir });
  await writeFiles(dir, { 'a.js': 'two\n' });

  const { ctx, text } = contextFor(dir);
  await getCommand('diff').run(ctx, []);
  assert.match(text(), /a\.js/);
}));

test('/export writes the transcript to disk', () => withTempDir(async (dir) => {
  const { ctx, session } = contextFor(dir);
  session.user('a question');
  const a = session.assistant();
  a.text = 'an answer';
  await getCommand('export').run(ctx, []);
  const files = await fs.readdir(dir);
  const md = files.find((f) => f.endsWith('.md'));
  assert.ok(md, `expected a markdown export, saw ${files.join(', ')}`);
  const body = await fs.readFile(path.join(dir, md), 'utf8');
  assert.match(body, /a question/);
  assert.match(body, /an answer/);
}));

test('/theme switches the palette and rejects a bad name', () => withTempDir(async (dir) => {
  const { ctx } = contextFor(dir);
  await getCommand('theme').run(ctx, ['crush']);
  assert.equal(ctx.theme.name, 'crush');
  await getCommand('theme').run(ctx, ['bogus']);
  assert.equal(ctx.theme.name, 'crush', 'unchanged after a bad name');
}));

test('/rainbow toggles the easter egg', () => withTempDir(async (dir) => {
  const { ctx } = contextFor(dir);
  assert.equal(ctx.theme.rainbow, false);
  await getCommand('rainbow').run(ctx, []);
  assert.equal(ctx.theme.rainbow, true);
}));

test('/doctor checks the environment', () => withTempDir(async (dir) => {
  const { ctx, text } = contextFor(dir);
  await getCommand('doctor').run(ctx, []);
  assert.match(text(), /node/i);
}));

test('/about names Astrocode, Tripplet and the four models', () => withTempDir(async (dir) => {
  const { ctx, text } = contextFor(dir);
  await getCommand('about').run(ctx, []);
  const out = text();
  assert.match(out, /Astrocode/);
  assert.match(out, /Tripplet/);
  for (const n of ['Astro 5 Code', 'Taipei 4', 'Majuli 4', 'Suzhou 4']) {
    assert.match(out, new RegExp(n), `${n} listed`);
  }
}));

test('/compact keeps counters but shrinks the transcript', () => withTempDir(async (dir) => {
  const { ctx, session } = contextFor(dir);
  for (let i = 0; i < 8; i++) {
    session.user(`question ${i}`);
    session.assistant().text = `answer ${i}`;
  }
  session.addUsage('taipei-4', 500, 100);
  const before = session.transcript.length;
  await getCommand('compact').run(ctx, []);
  assert.ok(session.transcript.length < before, 'the transcript shrank');
  assert.ok(session.totalTokens > 0, 'counters survived');
}));

test('/quit asks the app to exit rather than killing the process', () => withTempDir(async (dir) => {
  const { ctx, getQuit } = contextFor(dir);
  await getCommand('quit').run(ctx, []);
  assert.equal(getQuit(), 0);
}));
