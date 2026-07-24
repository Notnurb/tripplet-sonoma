/**
 * keys.js — turn raw stdin bytes into key events.
 *
 * Emits:
 *   { type: 'key',   name, ctrl, alt, shift, seq }
 *   { type: 'paste', text }
 *
 * `name` is one of: a single printable grapheme, or one of the well-known
 * names below (up/down/left/right/home/end/pageup/pagedown/insert/delete/
 * backspace/return/tab/escape/space/f1..f12).
 */

const NAMES = {
  A: 'up', B: 'down', C: 'right', D: 'left',
  H: 'home', F: 'end', Z: 'tab', // Z is shift+tab, flagged below
  P: 'f1', Q: 'f2', R: 'f3', S: 'f4',
};

const TILDE = {
  1: 'home', 2: 'insert', 3: 'delete', 4: 'end', 5: 'pageup', 6: 'pagedown',
  11: 'f1', 12: 'f2', 13: 'f3', 14: 'f4', 15: 'f5', 17: 'f6', 18: 'f7',
  19: 'f8', 20: 'f9', 21: 'f10', 23: 'f11', 24: 'f12',
};

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

const mods = (n) => {
  const m = (n | 0) - 1;
  return { shift: !!(m & 1), alt: !!(m & 2), ctrl: !!(m & 4) };
};

const key = (name, extra = {}) => ({
  type: 'key', name, ctrl: false, alt: false, shift: false, seq: '', ...extra,
});

export class KeyDecoder {
  constructor() {
    this.buf = '';
    this.pasting = false;
    this.pasteBuf = '';
  }

  /** Feed a chunk; returns an array of events. */
  push(chunk) {
    this.buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    const events = [];
    // Guard against a pathological loop on an unparseable byte.
    let guard = 0;
    while (this.buf.length && guard++ < 100000) {
      if (this.pasting) {
        const end = this.buf.indexOf(PASTE_END);
        if (end === -1) {
          this.pasteBuf += this.buf;
          this.buf = '';
          break;
        }
        this.pasteBuf += this.buf.slice(0, end);
        this.buf = this.buf.slice(end + PASTE_END.length);
        this.pasting = false;
        events.push({ type: 'paste', text: this.pasteBuf });
        this.pasteBuf = '';
        continue;
      }
      const before = this.buf.length;
      const ev = this._next();
      if (ev === null) break;               // incomplete sequence, wait for more
      if (ev !== undefined) events.push(...(Array.isArray(ev) ? ev : [ev]));
      if (this.buf.length === before) break; // no progress; bail rather than spin
    }
    return events;
  }

  _take(n) {
    const s = this.buf.slice(0, n);
    this.buf = this.buf.slice(n);
    return s;
  }

  _next() {
    const b = this.buf;
    const c = b[0];

    if (c === '\x1b') {
      if (b.startsWith(PASTE_START)) {
        this._take(PASTE_START.length);
        this.pasting = true;
        return undefined;
      }
      if (b.length === 1) {
        // Bare ESC: only surface it once we're sure nothing follows.
        this._take(1);
        return key('escape', { seq: '\x1b' });
      }
      if (b[1] === '[' || b[1] === 'O') return this._csi();
      // alt + <char>
      const rest = b.slice(1);
      const g = firstGrapheme(rest);
      this._take(1 + g.length);
      const inner = decodeChar(g);
      return { ...inner, alt: true, seq: '\x1b' + g };
    }

    const g = firstGrapheme(b);
    if (!g) return null;
    this._take(g.length);
    return decodeChar(g);
  }

  _csi() {
    const b = this.buf;
    const isSS3 = b[1] === 'O';
    let i = 2;
    let params = '';
    while (i < b.length && /[0-9;?]/.test(b[i])) params += b[i++];
    if (i >= b.length) return null;                 // still arriving
    const final = b[i];
    const raw = this._take(i + 1);

    const [p1, p2] = params.split(';');

    if (final === '~') {
      const name = TILDE[Number(p1)];
      if (!name) return key('unknown', { seq: raw });
      return key(name, { ...mods(p2), seq: raw });
    }

    if (final === 'Z') return key('tab', { shift: true, seq: raw });

    const name = NAMES[final];
    if (name) {
      const m = isSS3 ? {} : mods(p2 ?? (p1 && !p2 ? undefined : undefined));
      // xterm sends CSI 1;5A for ctrl+up
      const m2 = p2 ? mods(p2) : m;
      return key(name, { ...m2, seq: raw });
    }
    return key('unknown', { seq: raw });
  }
}

function firstGrapheme(s) {
  if (!s) return '';
  const cp = s.codePointAt(0);
  let n = cp > 0xffff ? 2 : 1;
  // absorb combining marks / variation selectors / ZWJ sequences
  for (;;) {
    const next = s.codePointAt(n);
    if (next === undefined) break;
    if (next === 0x200d) {
      n += 1;
      const after = s.codePointAt(n);
      if (after === undefined) break;
      n += after > 0xffff ? 2 : 1;
      continue;
    }
    if ((next >= 0xfe00 && next <= 0xfe0f) || (next >= 0x0300 && next <= 0x036f)) {
      n += 1;
      continue;
    }
    break;
  }
  return s.slice(0, n);
}

function decodeChar(g) {
  const code = g.codePointAt(0);
  if (code === 0x0d) return key('return', { seq: g });
  if (code === 0x0a) return key('return', { seq: g });
  if (code === 0x09) return key('tab', { seq: g });
  if (code === 0x7f || code === 0x08) return key('backspace', { seq: g });
  if (code === 0x20) return key('space', { seq: g });
  if (code === 0x00) return key('space', { ctrl: true, seq: g });
  if (code < 0x20) {
    const letter = String.fromCharCode(code + 96);
    return key(letter, { ctrl: true, seq: g });
  }
  return key(g, { seq: g });
}

/** Compact printable description, e.g. "ctrl+p", "shift+tab", "a". */
export function describe(ev) {
  if (ev.type !== 'key') return ev.type;
  let s = '';
  if (ev.ctrl) s += 'ctrl+';
  if (ev.alt) s += 'alt+';
  if (ev.shift && ev.name.length > 1) s += 'shift+';
  return s + ev.name;
}

/** True when the event inserts a literal character. */
export function isPrintable(ev) {
  return (
    ev.type === 'key' &&
    !ev.ctrl &&
    !ev.alt &&
    (ev.name === 'space' || (ev.name.length >= 1 && ev.name.codePointAt(0) >= 0x20 &&
      !['up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown', 'insert',
        'delete', 'backspace', 'return', 'tab', 'escape', 'unknown'].includes(ev.name)))
  );
}

export const charOf = (ev) => (ev.name === 'space' ? ' ' : ev.name);
