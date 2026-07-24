/**
 * screen.js — alternate-screen renderer with a per-row diff.
 *
 * The app hands us a full frame (one entry per terminal row) every time
 * anything changes; we only emit escape sequences for rows that actually
 * differ from what is already on screen. That keeps streaming output smooth
 * without any of the flicker you get from clearing and repainting.
 */

import { toAnsi, pad, truncate } from './text.js';

const ESC = '\x1b';
const CSI = `${ESC}[`;

export const seq = {
  altOn: `${CSI}?1049h`,
  altOff: `${CSI}?1049l`,
  hideCursor: `${CSI}?25l`,
  showCursor: `${CSI}?25h`,
  clear: `${CSI}2J`,
  home: `${CSI}H`,
  reset: `${CSI}0m`,
  eraseLine: `${CSI}K`,
  pasteOn: `${CSI}?2004h`,
  pasteOff: `${CSI}?2004l`,
  moveTo: (row, col) => `${CSI}${row + 1};${col + 1}H`,
  title: (t) => `${ESC}]0;${t}\x07`,
};

export class Screen {
  constructor(stream = process.stdout) {
    this.out = stream;
    this.prev = [];
    this.active = false;
    this.cursor = null;
    this._resizeHandlers = new Set();
    this._onResize = () => {
      this.prev = [];              // force a full repaint after a resize
      for (const h of this._resizeHandlers) h(this.cols, this.rows);
    };
  }

  get cols() { return Math.max(20, this.out.columns || 80); }
  get rows() { return Math.max(6, this.out.rows || 24); }

  onResize(fn) {
    this._resizeHandlers.add(fn);
    return () => this._resizeHandlers.delete(fn);
  }

  enter({ title } = {}) {
    if (this.active) return this;
    this.active = true;
    this.prev = [];
    let s = seq.altOn + seq.hideCursor + seq.pasteOn + seq.reset + seq.clear + seq.home;
    if (title) s += seq.title(title);
    this.out.write(s);
    this.out.on('resize', this._onResize);
    return this;
  }

  exit() {
    if (!this.active) return this;
    this.active = false;
    this.out.removeListener('resize', this._onResize);
    this.out.write(seq.reset + seq.pasteOff + seq.showCursor + seq.altOff);
    this.prev = [];
    return this;
  }

  /**
   * @param {Array<Array<object>>} frame  one Line (array of runs) per row
   * @param {{row:number,col:number}|null} cursor
   */
  render(frame, cursor = null) {
    if (!this.active) return;
    const { cols, rows } = this;
    const buf = [];
    const next = new Array(rows);

    for (let y = 0; y < rows; y++) {
      const src = frame[y] || [];
      const clamped = truncate(pad(src, 0), cols, '');
      const ansi = toAnsi(clamped);
      next[y] = ansi;
      if (this.prev[y] !== ansi) {
        buf.push(seq.moveTo(y, 0), ansi, seq.reset, seq.eraseLine);
      }
    }

    // A shrunken frame can leave stale rows below.
    for (let y = rows; y < this.prev.length; y++) {
      buf.push(seq.moveTo(y, 0), seq.reset, seq.eraseLine);
    }

    const cursorChanged =
      (cursor?.row ?? -1) !== (this.cursor?.row ?? -1) ||
      (cursor?.col ?? -1) !== (this.cursor?.col ?? -1);

    if (buf.length || cursorChanged) {
      if (cursor) {
        const row = Math.max(0, Math.min(rows - 1, cursor.row));
        const col = Math.max(0, Math.min(cols - 1, cursor.col));
        buf.push(seq.moveTo(row, col), seq.showCursor);
      } else {
        buf.push(seq.hideCursor, seq.moveTo(rows - 1, 0));
      }
      this.out.write(buf.join(''));
    }

    this.prev = next;
    this.cursor = cursor;
  }

  /** Write text below the TUI — only valid while not in the alt screen. */
  writeRaw(str) {
    this.out.write(str);
  }
}

export default Screen;
