/**
 * input.js — the multiline prompt editor.
 *
 * Keeps text as an array of logical lines and a `{line, col}` caret. Rendering
 * soft-wraps those logical lines to the box width and maps the caret into
 * screen space, so a long paragraph behaves the way you expect without the
 * editor itself knowing anything about the terminal.
 */

import { run, pad, graphemes, strWidth } from './text.js';
import { drawBox } from './box.js';
import { isPrintable, charOf } from './keys.js';

const WORD = /[A-Za-z0-9_$-]/;

export class InputEditor {
  constructor({ history = [], maxHistory = 500 } = {}) {
    this.lines = [''];
    this.line = 0;
    this.col = 0;                 // in graphemes, not cells
    this.history = history;
    this.maxHistory = maxHistory;
    this.histIndex = -1;          // -1 = editing a fresh buffer
    this.stash = null;
    this.placeholder = 'Ask Astrocode to build, explain or fix something…';
  }

  // ── value ─────────────────────────────────────────────────────────────────

  get value() { return this.lines.join('\n'); }

  setValue(v) {
    this.lines = String(v ?? '').split('\n');
    if (!this.lines.length) this.lines = [''];
    this.line = this.lines.length - 1;
    this.col = graphemes(this.lines[this.line]).length;
    return this;
  }

  get isEmpty() { return this.lines.length === 1 && this.lines[0] === ''; }

  clear() {
    this.lines = [''];
    this.line = 0;
    this.col = 0;
    this.histIndex = -1;
    this.stash = null;
    return this;
  }

  /** The text before the caret on the current line — drives autocomplete. */
  get beforeCaret() {
    return graphemes(this.lines[this.line]).slice(0, this.col).join('');
  }

  // ── editing primitives ────────────────────────────────────────────────────

  _gs(i = this.line) { return graphemes(this.lines[i]); }

  insert(text) {
    const parts = String(text).replace(/\r\n?/g, '\n').split('\n');
    const gs = this._gs();
    const head = gs.slice(0, this.col).join('');
    const tail = gs.slice(this.col).join('');
    if (parts.length === 1) {
      this.lines[this.line] = head + parts[0] + tail;
      this.col += graphemes(parts[0]).length;
    } else {
      const mid = parts.slice(1, -1);
      const last = parts[parts.length - 1];
      this.lines.splice(this.line, 1, head + parts[0], ...mid, last + tail);
      this.line += parts.length - 1;
      this.col = graphemes(last).length;
    }
    return this;
  }

  newline() {
    const gs = this._gs();
    const head = gs.slice(0, this.col).join('');
    const tail = gs.slice(this.col).join('');
    this.lines.splice(this.line, 1, head, tail);
    this.line += 1;
    this.col = 0;
    return this;
  }

  backspace() {
    if (this.col > 0) {
      const gs = this._gs();
      gs.splice(this.col - 1, 1);
      this.lines[this.line] = gs.join('');
      this.col -= 1;
    } else if (this.line > 0) {
      const prev = this._gs(this.line - 1);
      this.col = prev.length;
      this.lines[this.line - 1] = prev.join('') + this.lines[this.line];
      this.lines.splice(this.line, 1);
      this.line -= 1;
    }
    return this;
  }

  del() {
    const gs = this._gs();
    if (this.col < gs.length) {
      gs.splice(this.col, 1);
      this.lines[this.line] = gs.join('');
    } else if (this.line < this.lines.length - 1) {
      this.lines[this.line] += this.lines[this.line + 1];
      this.lines.splice(this.line + 1, 1);
    }
    return this;
  }

  deleteWordBefore() {
    const gs = this._gs();
    let i = this.col;
    while (i > 0 && !WORD.test(gs[i - 1])) i--;
    while (i > 0 && WORD.test(gs[i - 1])) i--;
    if (i === this.col && this.col === 0) return this.backspace();
    gs.splice(i, this.col - i);
    this.lines[this.line] = gs.join('');
    this.col = i;
    return this;
  }

  killToStart() {
    const gs = this._gs();
    this.lines[this.line] = gs.slice(this.col).join('');
    this.col = 0;
    return this;
  }

  killToEnd() {
    const gs = this._gs();
    if (this.col >= gs.length && this.line < this.lines.length - 1) return this.del();
    this.lines[this.line] = gs.slice(0, this.col).join('');
    return this;
  }

  // ── caret movement ────────────────────────────────────────────────────────

  left() {
    if (this.col > 0) this.col -= 1;
    else if (this.line > 0) { this.line -= 1; this.col = this._gs().length; }
    return this;
  }

  right() {
    const n = this._gs().length;
    if (this.col < n) this.col += 1;
    else if (this.line < this.lines.length - 1) { this.line += 1; this.col = 0; }
    return this;
  }

  wordLeft() {
    const gs = this._gs();
    let i = this.col;
    while (i > 0 && !WORD.test(gs[i - 1])) i--;
    while (i > 0 && WORD.test(gs[i - 1])) i--;
    if (i === this.col) return this.left();
    this.col = i;
    return this;
  }

  wordRight() {
    const gs = this._gs();
    let i = this.col;
    while (i < gs.length && !WORD.test(gs[i])) i++;
    while (i < gs.length && WORD.test(gs[i])) i++;
    if (i === this.col) return this.right();
    this.col = i;
    return this;
  }

  up() {
    if (this.line === 0) return false;
    this.line -= 1;
    this.col = Math.min(this.col, this._gs().length);
    return true;
  }

  down() {
    if (this.line >= this.lines.length - 1) return false;
    this.line += 1;
    this.col = Math.min(this.col, this._gs().length);
    return true;
  }

  home() { this.col = 0; return this; }
  end() { this.col = this._gs().length; return this; }

  // ── history ───────────────────────────────────────────────────────────────

  remember(text) {
    const t = String(text).trim();
    if (!t) return;
    if (this.history[this.history.length - 1] === t) return;
    this.history.push(t);
    if (this.history.length > this.maxHistory) this.history.shift();
  }

  historyPrev() {
    if (!this.history.length) return false;
    if (this.histIndex === -1) {
      this.stash = this.value;
      this.histIndex = this.history.length - 1;
    } else if (this.histIndex > 0) {
      this.histIndex -= 1;
    } else {
      return true;
    }
    this.setValue(this.history[this.histIndex]);
    return true;
  }

  historyNext() {
    if (this.histIndex === -1) return false;
    if (this.histIndex < this.history.length - 1) {
      this.histIndex += 1;
      this.setValue(this.history[this.histIndex]);
    } else {
      this.histIndex = -1;
      this.setValue(this.stash ?? '');
      this.stash = null;
    }
    return true;
  }

  /**
   * Route a key event. Returns 'submit' | 'consumed' | null so the app can
   * decide what to do with anything the editor did not want.
   */
  handleKey(ev) {
    if (ev.type === 'paste') { this.insert(ev.text); return 'consumed'; }
    if (ev.type !== 'key') return null;
    const { name, ctrl, alt } = ev;

    if (ctrl) {
      switch (name) {
        case 'a': this.home(); return 'consumed';
        case 'e': this.end(); return 'consumed';
        case 'b': this.left(); return 'consumed';
        case 'f': this.right(); return 'consumed';
        case 'd': if (this.isEmpty) return null; this.del(); return 'consumed';
        case 'h': this.backspace(); return 'consumed';
        case 'k': this.killToEnd(); return 'consumed';
        case 'u': this.killToStart(); return 'consumed';
        case 'w': this.deleteWordBefore(); return 'consumed';
        case 'j': this.newline(); return 'consumed';
        case 'left': this.wordLeft(); return 'consumed';
        case 'right': this.wordRight(); return 'consumed';
        default: return null;
      }
    }

    if (alt) {
      if (name === 'left' || name === 'b') { this.wordLeft(); return 'consumed'; }
      if (name === 'right' || name === 'f') { this.wordRight(); return 'consumed'; }
      if (name === 'backspace') { this.deleteWordBefore(); return 'consumed'; }
      if (name === 'return') { this.newline(); return 'consumed'; }
      return null;
    }

    switch (name) {
      case 'return':
        // A trailing backslash means "keep going on the next line".
        if (this.lines[this.line].endsWith('\\')) {
          this.lines[this.line] = this.lines[this.line].slice(0, -1);
          this.col = Math.max(0, this.col - 1);
          this.newline();
          return 'consumed';
        }
        return 'submit';
      case 'backspace': this.backspace(); return 'consumed';
      case 'delete': this.del(); return 'consumed';
      case 'left': this.left(); return 'consumed';
      case 'right': this.right(); return 'consumed';
      case 'home': this.home(); return 'consumed';
      case 'end': this.end(); return 'consumed';
      case 'up': return this.up() ? 'consumed' : (this.historyPrev() ? 'consumed' : null);
      case 'down': return this.down() ? 'consumed' : (this.historyNext() ? 'consumed' : null);
      default:
        if (isPrintable(ev)) { this.insert(charOf(ev)); return 'consumed'; }
        return null;
    }
  }

  // ── rendering ─────────────────────────────────────────────────────────────

  /**
   * @returns {{lines: Line[], cursor: {row, col}, height: number}}
   *   `cursor` is relative to the first returned line.
   */
  render({ width, theme, prompt = '›', busy = false, maxRows = 8 }) {
    const inner = Math.max(8, width - 4 - strWidth(prompt) - 1);
    const body = [];
    let curRow = 0;
    let curCol = 0;

    const empty = this.isEmpty;
    const glyphFg = theme.rainbow ? theme.pulse(0) : (busy ? theme.warn : theme.primary);

    for (let i = 0; i < this.lines.length; i++) {
      const segs = softWrap(this.lines[i], inner);
      for (let s = 0; s < segs.length; s++) {
        const isFirst = i === 0 && s === 0;
        const head = isFirst
          ? [run(`${prompt} `, { fg: glyphFg, bold: true })]
          : [run(' '.repeat(strWidth(prompt) + 1), {})];
        const text = empty && isFirst
          ? [run(this.placeholder, { fg: theme.faint, italic: true })]
          : [run(segs[s].text, { fg: theme.user })];
        body.push([...head, ...text]);
      }
      if (i === this.line) {
        const { row, col } = locate(segs, this.col);
        curRow = body.length - segs.length + row;
        curCol = strWidth(prompt) + 1 + col;
      }
    }

    // Scroll the editor viewport when the prompt outgrows its box.
    let view = body;
    let offset = 0;
    if (body.length > maxRows) {
      offset = Math.min(body.length - maxRows, Math.max(0, curRow - maxRows + 1));
      view = body.slice(offset, offset + maxRows);
    }

    const hint = [];
    if (this.lines.length > 1 || body.length > 1) {
      hint.push(run('ctrl+j', { fg: theme.faint }), run(' newline', { fg: theme.faint }));
    }

    const boxed = drawBox(view.map((l) => pad(l, width - 4)), {
      width,
      theme,
      color: busy ? theme.borderDim : theme.border,
      footer: hint.length ? hint : undefined,
      padX: 1,
    });

    return {
      lines: boxed,
      // +1 for the box's top border, +1 for the left border + padX
      cursor: { row: curRow - offset + 1, col: curCol + 2 },
      height: boxed.length,
    };
  }
}

/** Greedy soft-wrap that also reports where each segment starts. */
function softWrap(text, w) {
  const gs = graphemes(text);
  if (!gs.length) return [{ text: '', start: 0 }];
  const out = [];
  let cur = [];
  let curW = 0;
  let start = 0;
  for (let i = 0; i < gs.length; i++) {
    const cw = strWidth(gs[i]);
    if (curW + cw > w && cur.length) {
      out.push({ text: cur.join(''), start });
      start = i;
      cur = [];
      curW = 0;
    }
    cur.push(gs[i]);
    curW += cw;
  }
  out.push({ text: cur.join(''), start });
  return out;
}

function locate(segs, col) {
  for (let i = segs.length - 1; i >= 0; i--) {
    if (col >= segs[i].start) {
      return { row: i, col: strWidth(graphemes(segs[i].text).slice(0, col - segs[i].start).join('')) };
    }
  }
  return { row: 0, col: 0 };
}

export { softWrap };
export default InputEditor;
