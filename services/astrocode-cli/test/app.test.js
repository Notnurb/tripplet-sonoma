/**
 * End-to-end tests for the TUI itself: a real App, a real Session and real
 * tools, driven through a fake terminal. If these pass, the thing genuinely
 * boots, paints, accepts keystrokes and runs turns.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { App } from '../src/app.js';
import { Session } from '../src/core/session.js';
import { DEFAULTS } from '../src/core/config.js';
import { createTheme } from '../src/ui/theme.js';
import { setDepth, DEPTH, getDepth } from '../src/ui/text.js';
import { withTempDir, writeFiles, FakeStdin, FakeStdout, tick } from './helpers.js';

async function boot(dir, overrides = {}) {
  const session = new Session({ cwd: dir, model: 'taipei-4', effort: 'low' });
  // autoLogin defaults off in tests so the startup login window does not hijack
  // input; the tests that care about it opt in explicitly.
  const config = { ...DEFAULTS, autosave: false, autoLogin: false, permissionMode: 'yolo', ...overrides };
  const stdin = new FakeStdin();
  const stdout = new FakeStdout(100, 30);
  const app = new App({
    session,
    config,
    theme: createTheme(config.theme, { rainbow: !!config.rainbow }),
    version: '0.1.0',
    stdin,
    stdout,
  });
  if (overrides.signedIn !== false) app.authed = true;
  const exit = app.start();
  await tick(90);                       // let the first coalesced frame paint
  return { app, session, stdin, stdout, exit };
}

/**
 * Screen only emits rows that changed, so clearing the capture buffer and
 * re-rendering yields nothing. Dropping `prev` forces a full repaint.
 */
async function repaint(app, stdout) {
  stdout.clear();
  app.screen.prev = [];
  app.requestRender(true);
  await tick(80);
  return stdout.plain;
}

/** Everything the transcript holds, regardless of what is currently on screen. */
const transcriptText = (session) =>
  session.transcript
    .map((b) => (b.kind === 'lines'
      ? b.lines.map((l) => l.map((r) => r.t).join('')).join('\n')
      : (b.text || '')))
    .join('\n');

test('the app boots, paints a frame and shows the welcome panel', () => withTempDir(async (dir) => {
  const { app, stdout, exit } = await boot(dir);
  assert.ok(stdout.text.includes('\x1b[?1049h'), 'entered the alternate screen');
  assert.match(stdout.plain, /Welcome to Astrocode/);
  assert.match(stdout.plain, /Send \/help for help information/);
  app.stop(0);
  assert.equal(await exit, 0);
}));

test('leaving restores the terminal', () => withTempDir(async (dir) => {
  const { app, stdout, exit } = await boot(dir);
  stdout.clear();
  app.stop(0);
  await exit;
  assert.ok(stdout.text.includes('\x1b[?1049l'), 'left the alternate screen');
  assert.ok(stdout.text.includes('\x1b[?25h'), 'restored the cursor');
}));

test('typing lands in the editor and renders', () => withTempDir(async (dir) => {
  const { app, stdin, stdout, exit } = await boot(dir);
  stdin.type('hello');
  await tick(80);
  assert.equal(app.editor.value, 'hello');
  assert.match(stdout.plain, /hello/);
  app.stop(0);
  await exit;
}));

test('backspace and ctrl+u edit the buffer', () => withTempDir(async (dir) => {
  const { app, stdin, exit } = await boot(dir);
  stdin.type('abc');
  stdin.type('\x7f');
  await tick(60);
  assert.equal(app.editor.value, 'ab');
  stdin.type('\x15');            // ctrl+u
  await tick(60);
  assert.equal(app.editor.value, '');
  app.stop(0);
  await exit;
}));

test('a pasted block arrives intact', () => withTempDir(async (dir) => {
  const { app, stdin, exit } = await boot(dir);
  stdin.type('\x1b[200~line one\nline two\x1b[201~');
  await tick(60);
  assert.equal(app.editor.value, 'line one\nline two');
  app.stop(0);
  await exit;
}));

test('typing / opens the command popup and tab accepts', () => withTempDir(async (dir) => {
  const { app, stdin, stdout, exit } = await boot(dir);
  stdin.type('/mod');
  await tick(80);
  assert.ok(app.suggestion, 'a suggestion is open');
  assert.equal(app.suggestion.kind, 'command');
  assert.match(stdout.plain, /\/model/);
  stdin.type('\t');
  await tick(60);
  assert.match(app.editor.value, /^\/model/);
  app.stop(0);
  await exit;
}));

test('@ opens the file popup with real files', () => withTempDir(async (dir) => {
  await writeFiles(dir, { 'findme.js': '', 'other.txt': '' });
  const { app, stdin, exit } = await boot(dir);
  stdin.type('look at @findm');
  await tick(80);
  assert.ok(app.suggestion, 'a suggestion is open');
  assert.equal(app.suggestion.kind, 'file');
  assert.ok(app.suggestion.items.some((i) => i.label === 'findme.js'));
  app.stop(0);
  await exit;
}));

test('a slash command runs and prints into the transcript', () => withTempDir(async (dir) => {
  const { app, session, stdin, exit } = await boot(dir);
  stdin.type('/help\r');
  await tick(200);
  // The rendered viewport only shows the tail of a long listing, so assert on
  // what the command actually produced.
  const printed = transcriptText(session);
  assert.match(printed, /\/model/, 'help listed /model');
  assert.match(printed, /\/commit/, 'help listed /commit');
  app.stop(0);
  await exit;
}));

test('/model switches the active model and the status bar follows', () => withTempDir(async (dir) => {
  const { app, session, stdin, stdout, exit } = await boot(dir);
  assert.equal(session.model.id, 'taipei-4');
  stdin.type('/model suzhou\r');
  await tick(250);
  assert.equal(session.model.id, 'suzhou-4');
  assert.match(await repaint(app, stdout), /Suzhou 4/);
  app.stop(0);
  await exit;
}));

test('switching model or theme never writes to the real config when autosave is off', () => withTempDir(async (dir) => {
  const { CONFIG_PATH } = await import('../src/core/config.js');
  const fsp = await import('node:fs/promises');
  const before = await fsp.readFile(CONFIG_PATH, 'utf8').catch(() => null);

  const { app, stdin, exit } = await boot(dir);   // boot() sets autosave: false
  stdin.type('/model majuli\r');
  await tick(250);
  stdin.type('/theme crush\r');
  await tick(250);
  app.stop(0);
  await exit;

  const after = await fsp.readFile(CONFIG_PATH, 'utf8').catch(() => null);
  assert.equal(after, before, 'the user config must be untouched');
}));

test('/effort switches the reasoning level', () => withTempDir(async (dir) => {
  const { app, session, stdin, exit } = await boot(dir);
  stdin.type('/effort max\r');
  await tick(200);
  assert.equal(session.effort.id, 'max');
  app.stop(0);
  await exit;
}));

test('an unknown command reports itself rather than crashing', () => withTempDir(async (dir) => {
  const { app, stdin, stdout, exit } = await boot(dir);
  stdout.clear();
  stdin.type('/definitelynotacommand\r');
  await tick(150);
  assert.match(stdout.plain, /Unknown command/);
  app.stop(0);
  await exit;
}));

test('a full turn runs real tools and streams an answer', () => withTempDir(async (dir) => {
  await writeFiles(dir, { 'target.js': 'export const answer = 42\n' });
  const { app, session, stdin, exit } = await boot(dir, { engine: 'local' });
  stdin.type('read target.js\r');

  for (let i = 0; i < 120 && app.mode === 'busy'; i++) await tick(50);
  assert.equal(app.mode, 'input', 'the turn finished');

  const kinds = session.transcript.map((b) => b.kind);
  assert.ok(kinds.includes('user'));
  assert.ok(kinds.includes('tool'));
  assert.ok(kinds.includes('text'));

  const tool = session.transcript.find((b) => b.kind === 'tool');
  assert.equal(tool.status, 'ok');
  assert.match(tool.describe, /target\.js/);

  const answer = session.transcript.find((b) => b.kind === 'text');
  assert.ok(answer.text.length > 0, 'the model produced prose');
  app.stop(0);
  await exit;
}));

test('esc interrupts a running turn', () => withTempDir(async (dir) => {
  const { app, session, stdin, exit } = await boot(dir, { model: 'suzhou-4', engine: 'local' });
  session.setModel((await import('../src/core/models.js')).getModel('suzhou-4'));
  session.setEffort((await import('../src/core/effort.js')).getEffort('max'));
  stdin.type('explain this whole repository in detail\r');
  await tick(120);
  assert.equal(app.mode, 'busy');
  stdin.type('\x1b');                       // esc
  for (let i = 0; i < 60 && app.mode === 'busy'; i++) await tick(50);
  assert.equal(app.mode, 'input', 'the turn was interrupted');
  app.stop(0);
  await exit;
}));

test('ctrl+c needs two presses to quit, and clears a non-empty prompt first', () => withTempDir(async (dir) => {
  const { app, stdin, exit } = await boot(dir);
  stdin.type('some text');
  await tick(60);
  stdin.type('\x03');
  await tick(40);
  assert.equal(app.editor.value, '', 'the first ctrl+c cleared the buffer');
  assert.equal(app.running, true, 'and did not exit');

  stdin.type('\x03');
  await tick(40);
  assert.equal(app.running, true, 'one press on an empty buffer only warns');
  stdin.type('\x03');
  await tick(60);
  assert.equal(app.running, false, 'the second press exits');
  await exit;
}));

test('ctrl+d exits on an empty prompt', () => withTempDir(async (dir) => {
  const { app, stdin, exit } = await boot(dir);
  stdin.type('\x04');
  await tick(60);
  assert.equal(app.running, false);
  await exit;
}));

test('ctrl+r toggles rainbow mode at runtime', () => withTempDir(async (dir) => {
  const { app, stdin, exit } = await boot(dir);
  assert.equal(app.theme.rainbow, false);
  stdin.type('\x12');                        // ctrl+r
  await tick(60);
  assert.equal(app.theme.rainbow, true);
  assert.ok(app._ticker, 'the animation ticker starts with rainbow on');
  stdin.type('\x12');
  await tick(60);
  assert.equal(app.theme.rainbow, false);
  app.stop(0);
  await exit;
}));

test('the frame is exactly as wide and tall as the terminal', () => withTempDir(async (dir) => {
  const { app, exit } = await boot(dir);
  const { computeLayout, composeFrame } = await import('../src/ui/layout.js');
  const layout = computeLayout({ cols: 100, rows: 30 });
  const frame = composeFrame({ layout, main: [], status: [] });
  const { width } = await import('../src/ui/text.js');
  assert.equal(frame.length, 30);
  for (const row of frame) assert.equal(width(row), 100);
  app.stop(0);
  await exit;
}));

test('the app survives a very narrow terminal', () => withTempDir(async (dir) => {
  const session = new Session({ cwd: dir, model: 'taipei-4', effort: 'low' });
  const stdin = new FakeStdin();
  const stdout = new FakeStdout(48, 12);
  const app = new App({
    session,
    config: { ...DEFAULTS, autosave: false, autoLogin: false },
    theme: createTheme('astro'),
    version: '0.1.0',
    stdin,
    stdout,
  });
  app.authed = true;
  const exit = app.start();
  await tick(60);
  stdin.type('hello');
  await tick(80);
  assert.equal(app.editor.value, 'hello');
  app.stop(0);
  await exit;
}));

test('every theme renders without throwing, rainbow included', () => withTempDir(async (dir) => {
  const before = getDepth();
  setDepth(DEPTH.TRUECOLOR);
  try {
    for (const theme of ['astro', 'crush', 'ember', 'mono']) {
      for (const rainbow of [false, true]) {
        const { app, exit } = await boot(dir, { theme, rainbow });
        app.session.notice('a notice', 'warn');
        app.requestRender(true);
        await tick(60);
        app.stop(0);
        await exit;
      }
    }
  } finally {
    setDepth(before);
  }
}));


// ── login window ────────────────────────────────────────────────────────────

test('signed out, the app opens with a deployment picker', () => withTempDir(async (dir) => {
  const { app, stdin, exit } = await boot(dir, { signedIn: false, autoLogin: true });
  for (let i = 0; i < 40 && !app.overlay; i++) await tick(25);
  assert.ok(app.overlay, 'a login window opened');
  assert.equal(app.overlay.kind, 'select');
  assert.match(app.overlay.title, /sign in/i);
  assert.equal(app.overlay.items.length, 3, 'all three deployments offered');
  assert.deepEqual(app.overlay.items.map((i) => i.value),
    ['https://tripplet.lol', 'https://trippletspark.com', 'https://getsonoma.lol']);
  assert.equal(app.overlay.items[0].current, true, 'tripplet.lol is the default');

  stdin.type('\x1b');            // esc = skip
  await tick(80);
  assert.equal(app.overlay, null, 'skipping closes the window');
  assert.equal(app.authed, false, 'and leaves you signed out');
  app.stop(0);
  await exit;
}));

test('the login window does not appear when already signed in', () => withTempDir(async (dir) => {
  const { app, exit } = await boot(dir, { autoLogin: true });   // boot() signs in by default
  await tick(120);
  assert.equal(app.overlay, null, 'no login window when authed');
  app.stop(0);
  await exit;
}));

// ── sign-in gate ────────────────────────────────────────────────────────────

test('a prompt is refused until you sign in', () => withTempDir(async (dir) => {
  const { app, session, stdin, exit } = await boot(dir, { signedIn: false });
  assert.equal(app.authed, false);
  stdin.type('do something\r');
  await tick(200);

  assert.equal(app.mode, 'input', 'no turn was started');
  assert.equal(session.transcript.some((b) => b.kind === 'tool'), false, 'no tool ran');
  assert.match(transcriptText(session), /sign in/i);
  app.stop(0);
  await exit;
}));

test('slash commands still work while signed out', () => withTempDir(async (dir) => {
  const { app, session, stdin, exit } = await boot(dir, { signedIn: false });
  stdin.type('/help\r');
  await tick(200);
  assert.match(transcriptText(session), /\/login/, 'help mentions how to sign in');
  app.stop(0);
  await exit;
}));

// `engine: 'local'` keeps this about the turn loop rather than the network —
// a signed-in app otherwise streams from the real deployment.
test('once signed in, a prompt runs normally', () => withTempDir(async (dir) => {
  await writeFiles(dir, { 'a.js': 'export const a = 1\n' });
  const { app, session, stdin, exit } = await boot(dir, { engine: 'local' });
  stdin.type('read a.js\r');
  for (let i = 0; i < 120 && app.mode === 'busy'; i++) await tick(50);
  assert.ok(session.transcript.some((b) => b.kind === 'tool'), 'the turn ran');
  app.stop(0);
  await exit;
}));

test('the engine follows auth state, and config.engine overrides it', () => withTempDir(async (dir) => {
  const { app, exit } = await boot(dir, { signedIn: false });
  assert.equal(app.engine.constructor.name, 'Engine', 'signed out simulates locally');

  app.authed = true;
  assert.equal(app.engine.constructor.name, 'RemoteEngine', 'signing in switches to the real model');

  app.config.engine = 'local';
  assert.equal(app.engine.constructor.name, 'Engine', 'a local pin wins over being signed in');

  app.authed = false;
  app.config.engine = 'remote';
  assert.equal(app.engine.constructor.name, 'RemoteEngine', 'a remote pin wins over being signed out');

  app.stop(0);
  await exit;
}));

// ── arrow-key pickers ───────────────────────────────────────────────────────

const openPicker = async (dir, command) => {
  const ctxs = await boot(dir);
  ctxs.stdin.type(`${command}\r`);
  for (let i = 0; i < 40 && !ctxs.app.overlay; i++) await tick(25);
  return ctxs;
};

test('/model with no argument opens a picker on the current model',
  () => withTempDir(async (dir) => {
    const { app, session, stdin, exit } = await openPicker(dir, '/model');
    assert.ok(app.overlay, 'an overlay opened');
    assert.equal(app.overlay.kind, 'select');
    assert.match(app.overlay.title, /model/i);
    assert.equal(app.overlay.items.length, 4);

    // It opens on whatever is active, so enter alone changes nothing.
    assert.equal(app.overlay.items[app.overlay.selected].value, 'taipei-4');
    assert.equal(app.overlay.items.filter((i) => i.current).length, 1);

    stdin.type('\x1b[B');            // down
    await tick(60);
    const target = app.overlay.items[app.overlay.selected].value;
    stdin.type('\r');
    await tick(200);

    assert.equal(app.overlay, null, 'the overlay closed');
    assert.equal(session.model.id, target);
    app.stop(0);
    await exit;
  }));

test('/effort with no argument opens a picker of all five levels',
  () => withTempDir(async (dir) => {
    const { app, session, stdin, exit } = await openPicker(dir, '/effort');
    assert.equal(app.overlay.items.length, 5);
    assert.equal(app.overlay.items[app.overlay.selected].value, 'low', 'opens on the active level');

    stdin.type('\x1b[B\x1b[B');     // down twice
    await tick(60);
    const target = app.overlay.items[app.overlay.selected].value;
    stdin.type('\r');
    await tick(200);
    assert.equal(session.effort.id, target);
    app.stop(0);
    await exit;
  }));

test('/theme and /permissions open pickers too', () => withTempDir(async (dir) => {
  for (const [cmd, size] of [['/theme', 4], ['/permissions', 4]]) {
    const { app, stdin, exit } = await openPicker(dir, cmd);
    assert.ok(app.overlay, `${cmd} opened a picker`);
    assert.equal(app.overlay.items.length, size, `${cmd} listed every option`);
    assert.ok(app.overlay.items.some((i) => i.current), `${cmd} marks the current value`);
    stdin.type('\x1b');             // esc
    await tick(80);
    assert.equal(app.overlay, null, `${cmd} cancelled cleanly`);
    app.stop(0);
    await exit;
  }
}));

test('escape cancels a picker without changing anything', () => withTempDir(async (dir) => {
  const { app, session, stdin, exit } = await openPicker(dir, '/model');
  const before = session.model.id;
  stdin.type('\x1b[B');
  await tick(60);
  stdin.type('\x1b');
  await tick(120);
  assert.equal(app.overlay, null);
  assert.equal(session.model.id, before, 'the model is unchanged');
  app.stop(0);
  await exit;
}));

test('a number key picks that row directly', () => withTempDir(async (dir) => {
  const { app, session, stdin, exit } = await openPicker(dir, '/model');
  const third = app.overlay.items[2].value;
  stdin.type('3');
  await tick(200);
  assert.equal(app.overlay, null);
  assert.equal(session.model.id, third);
  app.stop(0);
  await exit;
}));

test('an unknown value falls through to the picker instead of dead-ending',
  () => withTempDir(async (dir) => {
    const { app, stdin, exit } = await openPicker(dir, '/model nonsense');
    assert.ok(app.overlay, 'the picker opened after the bad name');
    assert.equal(app.overlay.items.length, 4);
    stdin.type('\x1b');
    await tick(80);
    app.stop(0);
    await exit;
  }));

test('/model with a valid argument still switches without a picker',
  () => withTempDir(async (dir) => {
    const { app, session, stdin, exit } = await boot(dir);
    stdin.type('/model majuli\r');
    await tick(250);
    assert.equal(app.overlay, null, 'no picker needed');
    assert.equal(session.model.id, 'majuli-4');
    app.stop(0);
    await exit;
  }));
