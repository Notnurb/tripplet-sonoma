/**
 * welcome.js — the panel that greets you, modelled on the Kimi CLI: a chunky
 * badge on the left, the greeting beside it, then the three facts you actually
 * want when you open a terminal (where am I, which session, which model).
 */

import { run, pad, truncate, width as lw } from './text.js';
import { drawBox } from './box.js';
import { describeModel } from '../core/models.js';

const LOGO_W = 10;

/** The Astrocode badge: a solid block with two eyes, three rows tall. */
export function logoRows(theme) {
  const bg = theme.rainbow ? theme.pulse(0, theme.logo) : theme.logo;
  const eye = theme.logoEye;
  const fill = (n) => run(' '.repeat(n), { bg });
  return [
    [fill(LOGO_W)],
    [fill(2), run('██', { bg, fg: eye }), fill(2), run('██', { bg, fg: eye }), fill(2)],
    [fill(LOGO_W)],
  ];
}

/**
 * @param {object} o  { theme, session, cwd, width, version, tips }
 * @returns {Line[]}
 */
export function renderWelcome({ theme, session, cwd, width, version = '0.1.0', tips = true }) {
  const inner = Math.max(24, width - 4);
  const logo = logoRows(theme);
  const gap = 2;
  const textW = Math.max(10, inner - LOGO_W - gap);

  const greeting = [
    [run('Welcome to Astrocode!', { fg: theme.text, bold: true })],
    [run('Send ', { fg: theme.dim }), run('/help', { fg: theme.primary }),
      run(' for help information.', { fg: theme.dim })],
    [],
  ];

  const head = logo.map((l, i) => [
    ...pad(l, LOGO_W),
    run(' '.repeat(gap)),
    ...truncate(greeting[i] || [], textW),
  ]);

  const body = [
    [],
    field('Directory', cwd, theme, inner, theme.text),
    field('Session', session?.id ?? '—', theme, inner, theme.dim),
    modelField(session, theme, inner),
  ];

  if (tips) {
    body.push(
      [],
      [run('Tips: ', { fg: theme.dim }),
        run('/init', { fg: theme.accent }), run(' scans this repo · ', { fg: theme.faint }),
        run('/model', { fg: theme.accent }), run(' switches models · ', { fg: theme.faint }),
        run('/help', { fg: theme.accent }), run(' lists it all', { fg: theme.faint })],
    );
  }

  return drawBox([...head, ...body], {
    width,
    theme,
    title: [
      run('Astrocode', { fg: theme.rainbow ? theme.pulse(0) : theme.primary, bold: true }),
      run(` v${version}`, { fg: theme.dim }),
    ],
    padX: 1,
  });
}

function field(label, value, theme, inner, valueFg) {
  const head = [run(`${label}: `, { fg: theme.dim })];
  const room = Math.max(4, inner - lw(head));
  return [...head, ...truncate([run(String(value), { fg: valueFg })], room, '…')];
}

function modelField(session, theme, inner) {
  const m = session?.model;
  const head = [run('Model: ', { fg: theme.dim })];
  if (!m) {
    return [...head, run('not set, send ', { fg: theme.warn }),
      run('/model', { fg: theme.warn, bold: true }), run(' to configure', { fg: theme.warn })];
  }
  const accent = theme.rainbow ? theme.pulse(120, m.accent) : m.accent;
  const rest = [
    run(m.name, { fg: accent, bold: true }),
    run(` (powered by ${m.id})`, { fg: theme.faint }),
  ];
  const room = Math.max(8, inner - lw(head));
  return [...head, ...truncate(rest, room, '…')];
}

/**
 * Compact banner used outside the TUI (`--help`, headless mode). Returns Lines.
 */
export function bannerLines(theme, version = '0.1.0') {
  const l = logoRows(theme);
  const words = [
    [run('Astrocode', { fg: theme.primary, bold: true }), run(`  v${version}`, { fg: theme.dim })],
    [run('An agentic coding CLI by ', { fg: theme.dim }), run('Tripplet', { fg: theme.accent })],
    [],
  ];
  return l.map((row, i) => [...pad(row, LOGO_W), run('  '), ...(words[i] || [])]);
}

export { describeModel };
