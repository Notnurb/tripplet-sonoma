/**
 * layout.js — geometry.
 *
 * A single full-width column for the conversation, with one status row pinned
 * to the bottom. Anything that used to live in a side rail is either in the
 * status bar (model, effort, context, changed files) or one command away
 * (`/status`, `/files`, `/cost`).
 */

import { run, pad, truncate, width as lw } from './text.js';

export const MAIN_MIN_COLS = 30;

export function computeLayout({ cols, rows }) {
  return {
    cols,
    rows,
    mainW: Math.max(MAIN_MIN_COLS, cols),
    contentH: Math.max(1, rows - 1),   // last row is the status bar
    statusRow: rows - 1,
  };
}

/**
 * @param {object} o  { layout, main: Line[], status: Line }
 * @returns {Line[]} exactly `layout.rows` entries, each exactly `cols` wide
 */
export function composeFrame({ layout, main, status }) {
  const { rows, cols, contentH } = layout;
  const frame = new Array(rows);
  for (let y = 0; y < contentH; y++) {
    frame[y] = pad(truncate(main[y] || [], cols, '…'), cols);
  }
  frame[rows - 1] = pad(truncate(status || [], cols, '…'), cols);
  return frame;
}

/**
 * Stack lines into a fixed-height region, anchored to the bottom so the newest
 * output is always visible, with `scroll` lines held back.
 * @returns {{lines: Line[], offset: number, maxOffset: number}}
 */
export function viewport(lines, height, scroll = 0) {
  const maxOffset = Math.max(0, lines.length - height);
  const offset = Math.max(0, Math.min(scroll, maxOffset));
  const start = maxOffset - offset;
  const view = lines.slice(start, start + height);
  while (view.length < height) view.push([]);
  return { lines: view, offset, maxOffset };
}

/** Pad a region to `height` rows by prepending blanks (content sits low). */
export function bottomAlign(lines, height) {
  if (lines.length >= height) return lines.slice(lines.length - height);
  return [...new Array(height - lines.length).fill(null).map(() => []), ...lines];
}

/** The full-width footer: keybinding hints on the left, state on the right. */
export function statusBar({ layout, left = [], right = [] }) {
  const l = left.flat();
  const r = right.flat();
  const room = layout.cols - lw(r) - 2;
  const clipped = lw(l) > room ? truncate(l, Math.max(0, room), '…') : l;
  const gap = Math.max(1, layout.cols - lw(clipped) - lw(r) - 1);
  return [run(' '), ...clipped, run(' '.repeat(gap)), ...r];
}

/** `ctrl+p commands · ctrl+j newline · esc interrupt` */
export function hints(theme, pairs) {
  const out = [];
  for (let i = 0; i < pairs.length; i++) {
    if (i) out.push(run('  ·  ', { fg: theme.faint }));
    out.push(
      run(pairs[i][0], { fg: theme.rainbow ? theme.pulse(i * 40) : theme.dim, bold: true }),
      run(` ${pairs[i][1]}`, { fg: theme.faint }),
    );
  }
  return out;
}
