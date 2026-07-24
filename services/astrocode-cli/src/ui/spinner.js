/**
 * spinner.js — the "working" indicator.
 *
 * Frames advance off the app's animation tick rather than their own timer, so
 * a busy render loop can never get out of step with the spinner.
 */

import { run } from './text.js';

export const FRAMES = {
  dots: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  orbit: ['◐', '◓', '◑', '◒'],
  star: ['✶', '✸', '✹', '✺', '✹', '✷'],
  pulse: ['·', '∴', '✦', '✧', '✦', '∴'],
  bar: ['▁', '▃', '▄', '▅', '▆', '▇', '▆', '▅', '▄', '▃'],
};

/** Rotating verbs, so a long turn does not look stuck. */
const VERBS = [
  'Thinking', 'Reasoning', 'Considering', 'Planning', 'Working', 'Reading',
  'Composing', 'Deliberating', 'Calculating', 'Orbiting', 'Triangulating',
];

export class Spinner {
  constructor({ frames = 'dots', label = 'Thinking' } = {}) {
    this.frames = FRAMES[frames] || FRAMES.dots;
    this.label = label;
    this.tick = 0;
    this.startedAt = 0;
    this.verbIndex = 0;
  }

  start(label) {
    if (label) this.label = label;
    this.startedAt = Date.now();
    this.tick = 0;
    return this;
  }

  stop() { this.startedAt = 0; return this; }

  get running() { return this.startedAt > 0; }
  get elapsedMs() { return this.startedAt ? Date.now() - this.startedAt : 0; }

  advance(n = 1) {
    this.tick += n;
    // A new verb every ~4s keeps long turns feeling alive.
    this.verbIndex = Math.floor(this.elapsedMs / 4000) % VERBS.length;
    return this;
  }

  /** @returns {Line} */
  render(theme, { label, showElapsed = true, tokens = 0 } = {}) {
    const f = this.frames[this.tick % this.frames.length];
    const fg = theme.rainbow ? theme.pulse(this.tick * 12) : theme.primary;
    const text = label ?? (this.label === 'auto' ? VERBS[this.verbIndex] : this.label);
    const secs = Math.floor(this.elapsedMs / 1000);
    const out = [
      run(`${f} `, { fg }),
      run(text, { fg: theme.text }),
      run('…', { fg: theme.dim }),
    ];
    if (showElapsed && secs > 0) out.push(run(`  ${secs}s`, { fg: theme.faint }));
    if (tokens > 0) out.push(run(` · ${tokens} tokens`, { fg: theme.faint }));
    out.push(run('  (esc to interrupt)', { fg: theme.faint }));
    return out;
  }
}

export default Spinner;
