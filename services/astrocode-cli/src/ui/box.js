/**
 * box.js — border drawing. Rounded frames like the Kimi CLI welcome panel,
 * plus the trailing-rule section headers the CRUSH sidebar uses.
 *
 * Every function returns `Line[]` (arrays of runs), never strings, so borders
 * can be painted per-cell when `--rainbow` is on.
 */

import { run, width as lineWidth, pad, truncate } from './text.js';

export const BORDERS = {
  round: { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' },
  sharp: { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│' },
  heavy: { tl: '┏', tr: '┓', bl: '┗', br: '┛', h: '━', v: '┃' },
  double: { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║' },
};

/**
 * @param {Array<Array<object>>} content  inner lines (will be padded/truncated)
 * @param {object} opts
 *   width     total outer width
 *   theme     Theme instance (for rainbow gradients)
 *   title     Line[] | string shown inline in the top border
 *   titleFg   colour for a string title
 *   color     border colour (defaults to theme.border)
 *   style     'round' | 'sharp' | 'heavy' | 'double'
 *   padX      horizontal padding inside the border (default 1)
 *   padY      blank lines above/below content (default 0)
 *   footer    Line[] | string shown inline in the bottom border
 */
export function drawBox(content, opts = {}) {
  const {
    width: total, theme, title, footer, titleFg, style = 'round',
    padX = 1, padY = 0,
  } = opts;
  const b = BORDERS[style] || BORDERS.round;
  const color = opts.color ?? theme?.border ?? undefined;
  const inner = Math.max(1, total - 2 - padX * 2);
  const out = [];

  const hRun = (n, offset) => {
    if (n <= 0) return [];
    if (theme?.rainbow) {
      return Array.from({ length: n }, (_, i) => ({
        t: b.h, fg: theme.gradient(offset + i, total, color),
      }));
    }
    return [run(b.h.repeat(n), { fg: color })];
  };

  const corner = (ch, i) => ({
    t: ch, fg: theme?.rainbow ? theme.gradient(i, total, color) : color,
  });

  // top
  const titleRuns = normalise(title, titleFg ?? theme?.primary);
  if (titleRuns.length) {
    const tw = lineWidth(titleRuns);
    const lead = 1;
    const rest = Math.max(0, total - 2 - lead - tw - 2);
    out.push([
      corner(b.tl, 0),
      ...hRun(lead, 1),
      run(' ', { fg: color }),
      ...titleRuns,
      run(' ', { fg: color }),
      ...hRun(rest, 1 + lead + tw + 2),
      corner(b.tr, total - 1),
    ]);
  } else {
    out.push([corner(b.tl, 0), ...hRun(total - 2, 1), corner(b.tr, total - 1)]);
  }

  const bodyRow = (l) => {
    const clipped = truncate(l, inner, '…');
    return [
      { t: b.v, fg: theme?.rainbow ? theme.gradient(0, total, color) : color },
      run(' '.repeat(padX)),
      ...pad(clipped, inner),
      run(' '.repeat(padX)),
      { t: b.v, fg: theme?.rainbow ? theme.gradient(total - 1, total, color) : color },
    ];
  };

  for (let i = 0; i < padY; i++) out.push(bodyRow([]));
  for (const l of content) out.push(bodyRow(l));
  for (let i = 0; i < padY; i++) out.push(bodyRow([]));

  // bottom
  const footRuns = normalise(footer, theme?.dim);
  if (footRuns.length) {
    const fw = lineWidth(footRuns);
    const rest = Math.max(0, total - 2 - 1 - fw - 2);
    out.push([
      corner(b.bl, 0),
      ...hRun(1, 1),
      run(' ', { fg: color }),
      ...footRuns,
      run(' ', { fg: color }),
      ...hRun(rest, 4 + fw),
      corner(b.br, total - 1),
    ]);
  } else {
    out.push([corner(b.bl, 0), ...hRun(total - 2, 1), corner(b.br, total - 1)]);
  }
  return out;
}

function normalise(v, fg) {
  if (!v) return [];
  if (typeof v === 'string') return [run(v, { fg, bold: true })];
  return v;
}

/**
 * A section header with a rule trailing off to the right:
 *   `Modified Files ─────────────────`
 */
export function ruleHeader(label, total, opts = {}) {
  const { theme, labelFg, ruleFg, bold = false } = opts;
  const fg = labelFg ?? theme?.dim;
  const rf = ruleFg ?? theme?.borderDim;
  const head = [run(label, { fg, bold })];
  const used = lineWidth(head) + 1;
  const n = Math.max(0, total - used);
  if (n === 0) return head;
  const dash = theme?.rainbow
    ? Array.from({ length: n }, (_, i) => ({ t: '─', fg: theme.gradient(used + i, total, rf) }))
    : [run('─'.repeat(n), { fg: rf })];
  return [...head, run(' '), ...dash];
}

/** A plain horizontal rule. */
export function rule(total, opts = {}) {
  const { theme, color, char = '─' } = opts;
  const fg = color ?? theme?.borderDim;
  if (theme?.rainbow) {
    return Array.from({ length: total }, (_, i) => ({ t: char, fg: theme.gradient(i, total, fg) }));
  }
  return [run(char.repeat(total), { fg })];
}

/** A left gutter bar, used for quoted user prompts (`▌ text`). */
export function gutter(lines, opts = {}) {
  const { theme, color, char = '▌' } = opts;
  const fg = color ?? theme?.primary;
  return lines.map((l, i) => [
    { t: char, fg: theme?.rainbow ? theme.pulse(i * 14, fg) : fg },
    run(' '),
    ...l,
  ]);
}
