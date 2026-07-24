/**
 * text.js — the styled-text engine that everything in the UI is built from.
 *
 * A `Run` is `{ t, fg, bg, bold, dim, italic, underline, inverse, strike }`.
 * A `Line` is an array of Runs. Widths are measured in terminal cells, using
 * grapheme clusters (so ZWJ emoji and combining marks behave), which is what
 * makes wrapping, padding and the column-zip in layout.js line up correctly.
 *
 * Nothing here writes to the terminal — `toAnsi()` is the only place that
 * turns runs into escape sequences, so colour depth is decided in exactly one
 * spot.
 */

// ── colour depth ────────────────────────────────────────────────────────────

export const DEPTH = { NONE: 0, BASIC: 1, ANSI256: 2, TRUECOLOR: 3 };

let depth = detectDepth();

function detectDepth() {
  const env = process.env;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return DEPTH.NONE;
  if (env.ASTROCODE_COLOR === '0') return DEPTH.NONE;
  if (env.FORCE_COLOR === '0' || env.FORCE_COLOR === 'false') return DEPTH.NONE;
  if (env.FORCE_COLOR === '1') return DEPTH.BASIC;
  if (env.FORCE_COLOR === '2') return DEPTH.ANSI256;
  if (env.FORCE_COLOR === '3' || env.FORCE_COLOR === 'true') return DEPTH.TRUECOLOR;
  if (!process.stdout.isTTY) return DEPTH.NONE;
  const term = env.TERM || '';
  if (term === 'dumb') return DEPTH.NONE;
  if (/truecolor|24bit/i.test(env.COLORTERM || '')) return DEPTH.TRUECOLOR;
  const prog = env.TERM_PROGRAM || '';
  if (prog === 'Apple_Terminal') return DEPTH.ANSI256;
  if (prog === 'iTerm.app' || prog === 'WezTerm' || prog === 'ghostty' || prog === 'vscode') {
    return DEPTH.TRUECOLOR;
  }
  if (env.WT_SESSION || env.KITTY_WINDOW_ID || env.ALACRITTY_LOG) return DEPTH.TRUECOLOR;
  if (/-256(color)?$/.test(term)) return DEPTH.ANSI256;
  if (/^(xterm|screen|tmux|vt100|rxvt|ansi|linux)/.test(term)) return DEPTH.ANSI256;
  return DEPTH.BASIC;
}

export const getDepth = () => depth;
export const setDepth = (d) => { depth = d; };

// ── colour parsing ──────────────────────────────────────────────────────────

const NAMED = {
  black: [0, 0, 0], red: [205, 49, 49], green: [13, 188, 121], yellow: [229, 229, 16],
  blue: [36, 114, 200], magenta: [188, 63, 188], cyan: [17, 168, 205], white: [229, 229, 229],
  gray: [128, 128, 128], grey: [128, 128, 128],
};

const rgbCache = new Map();

/** '#rrggbb' | '#rgb' | 'red' | [r,g,b] -> [r,g,b] | null */
export function toRgb(c) {
  if (c == null) return null;
  if (Array.isArray(c)) return c;
  const hit = rgbCache.get(c);
  if (hit !== undefined) return hit;
  let out = null;
  if (typeof c === 'string') {
    if (c[0] === '#') {
      const h = c.slice(1);
      if (h.length === 3) {
        out = [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
      } else if (h.length === 6) {
        out = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
      }
      if (out && out.some(Number.isNaN)) out = null;
    } else if (NAMED[c]) {
      out = NAMED[c];
    }
  }
  rgbCache.set(c, out);
  return out;
}

function rgbTo256([r, g, b]) {
  // greyscale ramp first — it is much closer for desaturated colours
  if (Math.abs(r - g) < 8 && Math.abs(g - b) < 8 && Math.abs(r - b) < 8) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return Math.round(((r - 8) / 247) * 24) + 232;
  }
  const q = (v) => (v < 48 ? 0 : v < 114 ? 1 : Math.min(5, Math.round((v - 35) / 40)));
  return 16 + 36 * q(r) + 6 * q(g) + q(b);
}

function rgbTo16([r, g, b]) {
  const bright = Math.max(r, g, b) > 150;
  const bit = (v) => (v > 90 ? 1 : 0);
  const code = bit(r) | (bit(g) << 1) | (bit(b) << 2);
  const base = [0, 1, 2, 3, 4, 5, 6, 7][code]; // r|g<<1|b<<2 maps onto ANSI order
  return (bright ? 90 : 30) + base;
}

function sgrColor(c, isBg) {
  const rgb = toRgb(c);
  if (!rgb) return '';
  if (depth === DEPTH.TRUECOLOR) return `${isBg ? 48 : 38};2;${rgb[0]};${rgb[1]};${rgb[2]}`;
  if (depth === DEPTH.ANSI256) return `${isBg ? 48 : 38};5;${rgbTo256(rgb)}`;
  const n = rgbTo16(rgb);
  return String(isBg ? n + 10 : n);
}

// ── grapheme + width ────────────────────────────────────────────────────────

let segmenter = null;
try {
  segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
} catch {
  segmenter = null;
}

/** Split a string into grapheme clusters. */
export function graphemes(str) {
  if (!str) return [];
  if (segmenter) {
    const out = [];
    for (const s of segmenter.segment(str)) out.push(s.segment);
    return out;
  }
  return Array.from(str);
}

const WIDE_RANGES = [
  [0x1100, 0x115f], [0x2329, 0x232a], [0x2e80, 0x303e], [0x3041, 0x33ff],
  [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xa960, 0xa97f],
  [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f],
  [0xff00, 0xff60], [0xffe0, 0xffe6], [0x1f004, 0x1f004], [0x1f0cf, 0x1f0cf],
  [0x1f18e, 0x1f18e], [0x1f191, 0x1f19a], [0x1f200, 0x1f320], [0x1f32d, 0x1f335],
  [0x1f337, 0x1f37c], [0x1f37e, 0x1f393], [0x1f3a0, 0x1f3ca], [0x1f3cf, 0x1f3d3],
  [0x1f3e0, 0x1f3f0], [0x1f3f4, 0x1f3f4], [0x1f3f8, 0x1f43e], [0x1f440, 0x1f440],
  [0x1f442, 0x1f4fc], [0x1f4ff, 0x1f53d], [0x1f54b, 0x1f54e], [0x1f550, 0x1f567],
  [0x1f57a, 0x1f57a], [0x1f595, 0x1f596], [0x1f5a4, 0x1f5a4], [0x1f5fb, 0x1f64f],
  [0x1f680, 0x1f6c5], [0x1f6cc, 0x1f6cc], [0x1f6d0, 0x1f6d2], [0x1f6eb, 0x1f6ec],
  [0x1f6f4, 0x1f6fc], [0x1f7e0, 0x1f7eb], [0x1f90c, 0x1f9ff], [0x1fa70, 0x1faff],
  [0x20000, 0x3fffd],
];

const ZERO_RANGES = [
  [0x0300, 0x036f], [0x0483, 0x0489], [0x0591, 0x05bd], [0x0610, 0x061a],
  [0x064b, 0x065f], [0x0670, 0x0670], [0x06d6, 0x06dc], [0x0e31, 0x0e31],
  [0x0e34, 0x0e3a], [0x0e47, 0x0e4e], [0x200b, 0x200f], [0x2028, 0x202e],
  [0x20d0, 0x20f0], [0xfe00, 0xfe0f], [0xfe20, 0xfe2f], [0xe0100, 0xe01ef],
];

function inRanges(cp, ranges) {
  let lo = 0, hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cp < ranges[mid][0]) hi = mid - 1;
    else if (cp > ranges[mid][1]) lo = mid + 1;
    else return true;
  }
  return false;
}

/** Display width of a single grapheme cluster, in terminal cells. */
export function graphemeWidth(g) {
  if (!g) return 0;
  const cp = g.codePointAt(0);
  if (cp === 0x200d) return 0;
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (cp < 0x300) return 1;
  // An emoji presentation selector forces double width.
  if (g.includes('️')) return 2;
  if (inRanges(cp, ZERO_RANGES)) return 0;
  if (inRanges(cp, WIDE_RANGES)) return 2;
  return 1;
}

/** Display width of a plain string. */
export function strWidth(str) {
  let w = 0;
  for (const g of graphemes(str)) w += graphemeWidth(g);
  return w;
}

// ── runs & lines ────────────────────────────────────────────────────────────

/** Build a run. `style` keys: fg bg bold dim italic underline inverse strike */
export function run(t, style) {
  return style ? { t, ...style } : { t };
}

export const line = (...runs) => runs.flat().filter(Boolean);

/** Total display width of a Line. */
export function width(runs) {
  let w = 0;
  for (const r of runs) w += strWidth(r.t);
  return w;
}

/** Plain text of a Line (no styling). */
export function plain(runs) {
  let s = '';
  for (const r of runs) s += r.t;
  return s;
}

const RESET = '\x1b[0m';

function sgrFor(r) {
  if (depth === DEPTH.NONE) return '';
  const parts = [];
  if (r.bold) parts.push('1');
  if (r.dim) parts.push('2');
  if (r.italic) parts.push('3');
  if (r.underline) parts.push('4');
  if (r.inverse) parts.push('7');
  if (r.strike) parts.push('9');
  if (r.fg) { const c = sgrColor(r.fg, false); if (c) parts.push(c); }
  if (r.bg) { const c = sgrColor(r.bg, true); if (c) parts.push(c); }
  return parts.length ? `\x1b[${parts.join(';')}m` : '';
}

/** Render a Line to an ANSI string. Always ends reset if anything was styled. */
export function toAnsi(runs) {
  let out = '';
  let dirty = false;
  for (const r of runs) {
    if (!r || !r.t) continue;
    const sgr = sgrFor(r);
    if (sgr) {
      // reset before each styled run so attributes never leak between runs
      out += (dirty ? RESET : '') + sgr + r.t;
      dirty = true;
    } else {
      out += (dirty ? RESET : '') + r.t;
      dirty = false;
    }
  }
  return dirty ? out + RESET : out;
}

const styleOf = (r) => {
  const s = {};
  for (const k of ['fg', 'bg', 'bold', 'dim', 'italic', 'underline', 'inverse', 'strike']) {
    if (r[k] !== undefined) s[k] = r[k];
  }
  return s;
};

const sameStyle = (a, b) => {
  for (const k of ['fg', 'bg', 'bold', 'dim', 'italic', 'underline', 'inverse', 'strike']) {
    if (a[k] !== b[k]) return false;
  }
  return true;
};

/** Merge adjacent runs that share a style — keeps frames small. */
export function compact(runs) {
  const out = [];
  for (const r of runs) {
    if (!r || r.t === '') continue;
    const last = out[out.length - 1];
    if (last && sameStyle(last, r)) last.t += r.t;
    else out.push({ ...r });
  }
  return out;
}

/** Explode a Line into `[{ g, w, style }]` cells. */
function cells(runs) {
  const out = [];
  for (const r of runs) {
    if (!r || !r.t) continue;
    const st = styleOf(r);
    for (const g of graphemes(r.t)) out.push({ g, w: graphemeWidth(g), st });
  }
  return out;
}

function cellsToLine(cs) {
  const out = [];
  for (const c of cs) {
    const last = out[out.length - 1];
    if (last && sameStyle(last, c.st)) last.t += c.g;
    else out.push({ t: c.g, ...c.st });
  }
  return out;
}

/** Pad a Line on the right to exactly `w` cells (no-op if already wider). */
export function pad(runs, w, style) {
  const cur = width(runs);
  if (cur >= w) return runs;
  return [...runs, run(' '.repeat(w - cur), style)];
}

/** Pad a Line on the left to exactly `w` cells. */
export function padStart(runs, w, style) {
  const cur = width(runs);
  if (cur >= w) return runs;
  return [run(' '.repeat(w - cur), style), ...runs];
}

/** Centre a Line inside `w` cells. */
export function center(runs, w, style) {
  const cur = width(runs);
  if (cur >= w) return runs;
  const left = Math.floor((w - cur) / 2);
  return [run(' '.repeat(left), style), ...runs, run(' '.repeat(w - cur - left), style)];
}

/** Truncate a Line to `w` cells, appending `ellipsis` when it had to cut. */
export function truncate(runs, w, ellipsis = '…') {
  if (width(runs) <= w) return runs;
  if (w <= 0) return [];
  const ew = strWidth(ellipsis);
  const budget = Math.max(0, w - ew);
  const cs = cells(runs);
  const kept = [];
  let used = 0;
  for (const c of cs) {
    if (used + c.w > budget) break;
    kept.push(c);
    used += c.w;
  }
  const out = cellsToLine(kept);
  const tail = kept.length ? kept[kept.length - 1].st : {};
  out.push(run(ellipsis, tail));
  // guard against a wide grapheme leaving us one cell short/over
  return width(out) > w ? truncate(out.slice(0, -1), w, ellipsis) : out;
}

/** Slice a Line by display columns, `[start, end)`. */
export function slice(runs, start, end = Infinity) {
  const out = [];
  let col = 0;
  for (const c of cells(runs)) {
    const next = col + c.w;
    if (next > start && col < end) out.push(c);
    col = next;
    if (col >= end) break;
  }
  return cellsToLine(out);
}

/**
 * Word-wrap a Line to `w` cells.
 * opts: { indent, hanging } — `indent` on every line, `hanging` added from the
 * second line onwards (so list bullets hang correctly).
 */
export function wrap(runs, w, opts = {}) {
  const indent = opts.indent | 0;
  const hanging = opts.hanging | 0;
  const style = opts.style;
  if (w <= 1) return [runs];

  const out = [];
  const cs = cells(runs);
  let cur = [];
  let curW = 0;
  let breakAt = -1;   // index in `cur` just after the last space
  let breakW = 0;
  let first = true;

  const avail = () => Math.max(1, w - indent - (first ? 0 : hanging));

  const flush = (upTo = cur.length, carry = []) => {
    let seg = cur.slice(0, upTo);
    while (seg.length && seg[seg.length - 1].g === ' ') seg.pop();
    const lead = indent + (first ? 0 : hanging);
    const l = cellsToLine(seg);
    out.push(lead > 0 ? [run(' '.repeat(lead), style), ...l] : l);
    first = false;
    cur = carry;
    curW = carry.reduce((a, c) => a + c.w, 0);
    breakAt = -1;
    breakW = 0;
  };

  for (const c of cs) {
    if (c.g === '\n') { flush(); continue; }
    if (curW + c.w > avail() && cur.length) {
      if (breakAt > 0) {
        const carry = cur.slice(breakAt);
        flush(breakAt, carry);
      } else {
        flush();
      }
    }
    // drop leading whitespace produced by a wrap
    if (c.g === ' ' && cur.length === 0 && !first) continue;
    cur.push(c);
    curW += c.w;
    if (c.g === ' ') { breakAt = cur.length; breakW = curW; }
  }
  if (cur.length || out.length === 0) flush();
  void breakW;
  return out;
}

/** Convenience: wrap a plain string with one style. */
export function wrapText(text, w, style, opts) {
  return wrap([run(text, style)], w, opts);
}

/** Apply/override a style across an entire Line. */
export function restyle(runs, style) {
  return runs.map((r) => ({ ...r, ...style }));
}

/** Strip ANSI escapes out of a raw string (used for export/headless output). */
export function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
}
