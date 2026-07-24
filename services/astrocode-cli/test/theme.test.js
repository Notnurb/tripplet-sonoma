/**
 * The --rainbow easter egg, and the palette contract the whole UI leans on.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createTheme, themeNames, themeList, mix, Theme } from '../src/ui/theme.js';
import { renderWelcome } from '../src/ui/welcome.js';
import { drawBox, ruleHeader } from '../src/ui/box.js';
import { Session } from '../src/core/session.js';
import { width, toRgb } from '../src/ui/text.js';

const KEYS = [
  'bg', 'panel', 'text', 'dim', 'faint', 'border', 'borderDim', 'primary',
  'accent', 'success', 'warn', 'error', 'info', 'thinking', 'user', 'tool',
  'add', 'del', 'hunk', 'code', 'logo', 'logoEye', 'hatch', 'selection',
];

test('every palette defines every colour the UI asks for', () => {
  assert.deepEqual(themeNames(), ['astro', 'crush', 'ember', 'mono']);
  for (const name of themeNames()) {
    const t = createTheme(name);
    for (const k of KEYS) {
      assert.match(t[k], /^#[0-9a-f]{6}$/i, `${name}.${k} is a hex colour`);
    }
  }
  assert.equal(themeList().length, 4);
});

test('setPalette swaps every colour at once', () => {
  const t = createTheme('astro');
  const before = t.primary;
  t.setPalette('crush');
  assert.notEqual(t.primary, before);
  assert.equal(t.name, 'crush');
  // An unknown name falls back rather than producing undefined colours.
  t.setPalette('nonexistent');
  assert.match(t.primary, /^#[0-9a-f]{6}$/i);
});

test('a plain theme is static and needs no animation timer', () => {
  const t = createTheme('astro');
  assert.equal(t.rainbow, false);
  assert.equal(t.animated, false);
  const before = t.phase;
  t.tick(10);
  assert.equal(t.phase, before, 'phase does not advance without rainbow');
  assert.equal(t.gradient(0, 10), t.gradient(5, 10), 'no positional sweep');
  assert.equal(t.gradient(0, 10, '#123456'), '#123456', 'the fallback wins');
});

test('rainbow sweeps colour across a surface', () => {
  const t = createTheme('astro', { rainbow: true });
  assert.equal(t.animated, true);
  const colours = new Set();
  for (let i = 0; i < 20; i++) colours.add(t.gradient(i, 20));
  assert.ok(colours.size >= 10, `expected a spread, saw ${colours.size} distinct colours`);
  for (const c of colours) assert.match(c, /^#[0-9a-f]{6}$/i);
});

test('rainbow animates over time', () => {
  const t = createTheme('astro', { rainbow: true });
  const first = t.gradient(0, 10);
  t.tick(5);
  assert.notEqual(t.gradient(0, 10), first, 'the phase moved');
  assert.ok(t.phase > 0 && t.phase < 360, 'phase stays in range');
  for (let i = 0; i < 200; i++) t.tick(3);
  assert.ok(t.phase >= 0 && t.phase < 360, 'phase wraps rather than growing');
});

test('paint() colours each character individually only in rainbow mode', () => {
  const plain = createTheme('astro').paint('/////', {});
  assert.equal(plain.length, 1, 'a plain theme emits one run');

  const rainbow = createTheme('astro', { rainbow: true }).paint('/////', {});
  assert.equal(rainbow.length, 5, 'rainbow emits one run per character');
  assert.equal(new Set(rainbow.map((r) => r.fg)).size, 5, 'each is a different colour');
  assert.equal(rainbow.map((r) => r.t).join(''), '/////', 'the text is unchanged');
});

test('pulse gives an animated single colour', () => {
  const t = createTheme('astro', { rainbow: true });
  const a = t.pulse(0);
  const b = t.pulse(120);
  assert.notEqual(a, b, 'the offset shifts the hue');
  assert.equal(createTheme('astro').pulse(0, '#abcdef'), '#abcdef', 'plain uses the fallback');
});

test('mix blends two colours', () => {
  assert.equal(mix('#000000', '#ffffff', 0), '#000000');
  assert.equal(mix('#000000', '#ffffff', 1), '#ffffff');
  const mid = toRgb(mix('#000000', '#ffffff', 0.5));
  assert.ok(mid[0] > 120 && mid[0] < 136, `midpoint was ${mid[0]}`);
});

test('rainbow never changes layout widths', () => {
  const session = new Session({ cwd: '/tmp', model: 'astro-5-code', effort: 'high' });
  void session;
  for (const w of [40, 80, 120]) {
    const plain = renderWelcome({ theme: createTheme('astro'), session, cwd: '/tmp', width: w });
    const rain = renderWelcome({ theme: createTheme('astro', { rainbow: true }), session, cwd: '/tmp', width: w });
    assert.equal(plain.length, rain.length, `row count at width ${w}`);
    for (let i = 0; i < plain.length; i++) {
      assert.equal(width(plain[i]), width(rain[i]), `row ${i} width at ${w}`);
      assert.equal(width(plain[i]), w, `row ${i} fills width ${w}`);
    }
  }
});

test('boxes stay exactly as wide as asked, in both modes', () => {
  for (const rainbow of [false, true]) {
    const t = createTheme('crush', { rainbow });
    for (const w of [20, 40, 77]) {
      const box = drawBox([[{ t: 'body' }]], { width: w, theme: t, title: 'Title', footer: 'foot' });
      for (const row of box) assert.equal(width(row), w, `rainbow=${rainbow} width=${w}`);
    }
  }
});

test('ruleHeader fills the width it is given', () => {
  for (const rainbow of [false, true]) {
    const t = createTheme('astro', { rainbow });
    for (const w of [16, 32]) {
      assert.equal(width(ruleHeader('Files', w, { theme: t })), w);
    }
  }
});

test('the welcome panel renders in every theme at every sane width', () => {
  const session = new Session({ cwd: '/tmp/x', model: 'taipei-4', effort: 'low' });
  for (const name of themeNames()) {
    for (const rainbow of [false, true]) {
      const theme = createTheme(name, { rainbow });
      for (const w of [40, 60, 96]) {
        const lines = renderWelcome({ theme, session, cwd: '/tmp/x', width: w, version: '0.1.0' });
        for (const l of lines) assert.equal(width(l), w, `${name} rainbow=${rainbow} w=${w}`);
      }
    }
  }
});

test('Theme is constructible directly as well as through the factory', () => {
  const t = new Theme('ember', { rainbow: true });
  assert.equal(t.name, 'ember');
  assert.equal(t.rainbow, true);
});
