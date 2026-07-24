/**
 * highlight.js — a compact hand-rolled syntax highlighter.
 *
 * There is no tokeniser to depend on, so this is a single-pass character
 * scanner driven by a small per-language spec (comment markers, quote styles,
 * keyword sets), plus a few dedicated scanners for languages whose shape does
 * not fit that mould (CSS, HTML, YAML, TOML, Markdown).
 *
 * It is deliberately approximate — the goal is a readable code block in a
 * terminal, not a compiler front end. Every scanner degrades gracefully:
 * unterminated strings stop at the end of the line rather than swallowing the
 * rest of the file, and an unknown language falls back to plain text.
 */

import { run, compact } from './text.js';

// ── token colours ───────────────────────────────────────────────────────────

/**
 * Token type -> style. A missing theme field simply yields `fg: undefined`,
 * which `toAnsi` treats as "no colour", so this is safe with a bare object.
 */
function palette(theme = {}) {
  return {
    ws: {},
    plain: { fg: theme.text },
    keyword: { fg: theme.accent },
    literal: { fg: theme.warn },
    number: { fg: theme.warn },
    string: { fg: theme.code },
    regex: { fg: theme.success },
    comment: { fg: theme.faint, italic: true },
    function: { fg: theme.primary },
    type: { fg: theme.info },
    builtin: { fg: theme.tool },
    property: { fg: theme.tool },
    variable: { fg: theme.info },
    attr: { fg: theme.tool },
    tag: { fg: theme.primary },
    operator: { fg: theme.dim },
    punct: { fg: theme.dim },
    heading: { fg: theme.primary, bold: true },
    strong: { fg: theme.text, bold: true },
    em: { fg: theme.text, italic: true },
    link: { fg: theme.info, underline: true },
    code: { fg: theme.code },
  };
}

// ── language ids ────────────────────────────────────────────────────────────

const ALIASES = {
  javascript: 'js', node: 'js', mjs: 'js', cjs: 'js', es6: 'js',
  typescript: 'ts', mts: 'ts', cts: 'ts',
  jsonc: 'json', json5: 'json',
  python: 'py', python3: 'py', pyw: 'py',
  shell: 'sh', bash: 'sh', zsh: 'sh', ksh: 'sh', console: 'sh', 'shell-session': 'sh',
  markdown: 'md', mdx: 'md', mkd: 'md',
  htm: 'html', xhtml: 'html', vue: 'html', svelte: 'html',
  scss: 'css', less: 'css', sass: 'css',
  golang: 'go',
  rs: 'rust',
  yml: 'yaml',
  c: 'clike', h: 'clike', cc: 'clike', cpp: 'clike', hpp: 'clike', cxx: 'clike',
  java: 'clike', cs: 'clike', swift: 'clike', kt: 'clike', kts: 'clike',
  scala: 'clike', dart: 'clike', proto: 'clike',
  txt: 'text', plain: 'text', plaintext: 'text', '': 'text',
};

const BASENAMES = {
  '.bashrc': 'sh', '.zshrc': 'sh', '.profile': 'sh', '.bash_profile': 'sh',
  '.env': 'sh', dockerfile: 'text', makefile: 'text', '.gitignore': 'text',
  'package.json': 'json', 'tsconfig.json': 'json', '.prettierrc': 'json',
};

/** Canonical language id, or 'text' when we have nothing useful for it. */
function normLang(lang) {
  const k = String(lang ?? '').trim().toLowerCase();
  const mapped = ALIASES[k] ?? k;
  return SPECS[mapped] || mapped === 'text' ? mapped : 'text';
}

/** Guess a language id from a file name (extension first, then well-known names). */
export function detectLang(filename) {
  const base = String(filename ?? '').split(/[\\/]/).pop().toLowerCase();
  if (!base) return 'text';
  if (BASENAMES[base]) return BASENAMES[base];
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return 'text';
  return normLang(base.slice(dot + 1));
}

// ── scanning primitives ─────────────────────────────────────────────────────

const WS = new Set([' ', '\t', '\n', '\r']);
const PUNCT_CHARS = new Set(['{', '}', '[', ']', '(', ')', ';', ',', '.', ':']);
const OP_CHARS = new Set(['+', '-', '*', '/', '%', '=', '<', '>', '!', '&', '|', '^', '~', '?', '@', '#']);

const isDigit = (c) => c >= '0' && c <= '9';
const isIdentStart = (c) => !!c && /[A-Za-z_$À-￿]/.test(c);
const isIdentPart = (c) => !!c && /[A-Za-z0-9_$À-￿]/.test(c);

const set = (s) => new Set(String(s).split(/\s+/).filter(Boolean));

/** End index (exclusive) of a quoted string starting at `i`. */
function scanQuoted(src, i, opt) {
  const q = opt.q;
  const esc = opt.esc !== false;
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (esc && c === '\\') { j += 2; continue; }
    if (c === q) return j + 1;
    // an unterminated string should not eat the rest of the file
    if (c === '\n' && !opt.multiline) return j;
    j++;
  }
  return src.length;
}

/** Template literals, tracking `${ }` so a nested backtick does not end it. */
function scanTemplate(src, i) {
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') { j += 2; continue; }
    if (c === '`') return j + 1;
    if (c === '$' && src[j + 1] === '{') {
      let depth = 1;
      j += 2;
      while (j < src.length && depth > 0) {
        const k = src[j];
        if (k === '{') depth++;
        else if (k === '}') depth--;
        else if (k === '`') { j = scanTemplate(src, j) - 1; }
        else if (k === '"' || k === "'") { j = scanQuoted(src, j, { q: k, esc: true }) - 1; }
        j++;
      }
      continue;
    }
    j++;
  }
  return src.length;
}

const NUMBER_RE =
  /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*)?\.?\d[\d_]*(?:[eE][+-]?\d+)?)[nLlUuFf]?/;

function scanNumber(src, i) {
  const m = NUMBER_RE.exec(src.slice(i, i + 64));
  return m ? i + m[0].length : i + 1;
}

/** End of a regex literal, or -1 if this `/` was really a division. */
function scanRegex(src, i) {
  let j = i + 1;
  let inClass = false;
  if (src[j] === '/' || src[j] === '*' || src[j] === undefined) return -1;
  while (j < src.length) {
    const c = src[j];
    if (c === '\n') return -1;
    if (c === '\\') { j += 2; continue; }
    if (inClass) { if (c === ']') inClass = false; }
    else if (c === '[') inClass = true;
    else if (c === '/') {
      j++;
      while (j < src.length && /[a-z]/i.test(src[j])) j++;
      return j;
    }
    j++;
  }
  return -1;
}

const NO_REGEX_AFTER = new Set([')', ']', '}']);

/** Can a `/` here start a regex literal? Decided from the previous token. */
function regexPos(prev) {
  if (!prev) return true;
  if (prev.type === 'keyword') return prev.text !== 'this';
  if (prev.type === 'operator') return true;
  if (prev.type === 'punct') return !NO_REGEX_AFTER.has(prev.text);
  return false;
}

/** Can a `<` here open a JSX element rather than being a comparison? */
function exprPos(prev) {
  if (!prev) return true;
  if (prev.type === 'keyword') return true;
  if (prev.type === 'operator') return true;
  if (prev.type === 'punct') return !NO_REGEX_AFTER.has(prev.text) || prev.text === '}';
  return false;
}

function startsComment(src, i, spec) {
  for (const p of spec.lineComment || []) if (src.startsWith(p, i)) return true;
  for (const pair of spec.blockComment || []) if (src.startsWith(pair[0], i)) return true;
  return false;
}

// declaration keywords decide what the identifier after them is
const DECL_TYPE = set('class interface struct enum type extends implements new impl trait namespace');
const DECL_FN = set('function def func fn sub');

// ── the generic scanner ─────────────────────────────────────────────────────

function scanCode(src, spec) {
  const out = [];
  const n = src.length;
  let i = 0;
  let prev = null;      // last significant token (whitespace/comments excluded)
  let jsxTag = false;   // inside `<tag ...>`, where bare words are attributes
  let jsxBrace = 0;     // inside `{ ... }` within a JSX tag: back to real code

  const emit = (type, from, to) => {
    if (to <= from) return;
    const tk = { type, text: src.slice(from, to) };
    out.push(tk);
    if (type !== 'ws' && type !== 'comment') prev = tk;
  };

  outer: while (i < n) {
    const c = src[i];

    if (WS.has(c)) {
      let j = i + 1;
      while (j < n && WS.has(src[j])) j++;
      emit('ws', i, j);
      i = j;
      continue;
    }

    for (const p of spec.lineComment || []) {
      if (src.startsWith(p, i)) {
        let j = src.indexOf('\n', i);
        if (j === -1) j = n;
        emit('comment', i, j);
        i = j;
        continue outer;
      }
    }

    for (const [open, close] of spec.blockComment || []) {
      if (src.startsWith(open, i)) {
        const k = src.indexOf(close, i + open.length);
        const j = k === -1 ? n : k + close.length;
        emit('comment', i, j);
        i = j;
        continue outer;
      }
    }

    if (spec.jsx) {
      if (jsxTag && jsxBrace === 0) {
        if (c === '>') { emit('tag', i, i + 1); jsxTag = false; i++; continue; }
        if (c === '/' && src[i + 1] === '>') { emit('tag', i, i + 2); jsxTag = false; i += 2; continue; }
        if (c === '{') { jsxBrace++; emit('punct', i, i + 1); i++; continue; }
        if (isIdentStart(c)) {
          let j = i + 1;
          while (j < n && (isIdentPart(src[j]) || src[j] === '-' || src[j] === ':')) j++;
          emit('attr', i, j);
          i = j;
          continue;
        }
      } else if (jsxBrace > 0) {
        if (c === '{') { jsxBrace++; emit('punct', i, i + 1); i++; continue; }
        if (c === '}') { jsxBrace--; emit('punct', i, i + 1); i++; continue; }
      }
      if (c === '<' && !jsxTag && exprPos(prev) && /[A-Za-z_/>]/.test(src[i + 1] || '')) {
        let j = i + 1;
        if (src[j] === '/') j++;
        while (j < n && (isIdentPart(src[j]) || src[j] === '.' || src[j] === '-' || src[j] === ':')) j++;
        emit('tag', i, j);
        jsxTag = true;
        i = j;
        continue;
      }
    }

    if (spec.triple) {
      let hit = null;
      for (const q of spec.triple) if (src.startsWith(q, i)) { hit = q; break; }
      if (hit) {
        const k = src.indexOf(hit, i + hit.length);
        const j = k === -1 ? n : k + hit.length;
        emit('string', i, j);
        i = j;
        continue;
      }
    }

    // Rust: `'a` is a lifetime, `'a'` is a char literal
    if (spec.lifetimes && c === "'") {
      const m = /^'([A-Za-z_][A-Za-z0-9_]*)/.exec(src.slice(i, i + 64));
      if (m && src[i + m[0].length] !== "'") {
        emit('type', i, i + m[0].length);
        i += m[0].length;
        continue;
      }
    }

    const quote = (spec.strings || []).find((s) => s.q === c);
    if (quote) {
      const j = quote.template ? scanTemplate(src, i) : scanQuoted(src, i, quote);
      emit('string', i, j);
      i = j;
      continue;
    }

    if (spec.regex && c === '/' && regexPos(prev)) {
      const j = scanRegex(src, i);
      if (j !== -1) { emit('regex', i, j); i = j; continue; }
    }

    // shell-style `$VAR`, `${VAR}` — `$(` falls through so the inside is scanned
    if (spec.sigil && c === spec.sigil) {
      if (src[i + 1] === '{') {
        let depth = 1;
        let j = i + 2;
        while (j < n && depth > 0) {
          if (src[j] === '{') depth++;
          else if (src[j] === '}') depth--;
          j++;
        }
        emit('variable', i, j);
        i = j;
        continue;
      }
      const nx = src[i + 1] || '';
      if (isIdentStart(nx) || /[0-9@#?!*]/.test(nx)) {
        let j = i + 1;
        if (isIdentStart(nx)) { while (j < n && isIdentPart(src[j])) j++; } else j++;
        emit('variable', i, j);
        i = j;
        continue;
      }
    }

    if (spec.flags && c === '-' && (i === 0 || WS.has(src[i - 1])) && /[A-Za-z-]/.test(src[i + 1] || '')) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_-]/.test(src[j])) j++;
      emit('attr', i, j);
      i = j;
      continue;
    }

    if (spec.decorator && c === '@' && isIdentStart(src[i + 1] || '')) {
      let j = i + 1;
      while (j < n && (isIdentPart(src[j]) || src[j] === '.')) j++;
      emit('function', i, j);
      i = j;
      continue;
    }

    if (isDigit(c) || (c === '.' && isDigit(src[i + 1] || ''))) {
      const j = scanNumber(src, i);
      emit('number', i, j);
      i = j;
      continue;
    }

    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < n && isIdentPart(src[j])) j++;
      const word = src.slice(i, j);

      // Rust raw strings: r"..", r#".."#
      if (spec.rawString && /^b?r$/.test(word) && (src[j] === '"' || src[j] === '#')) {
        let h = j;
        while (src[h] === '#') h++;
        if (src[h] === '"') {
          const term = `"${'#'.repeat(h - j)}`;
          const k = src.indexOf(term, h + 1);
          const end = k === -1 ? n : k + term.length;
          emit('string', i, end);
          i = end;
          continue;
        }
      }

      // Python string prefixes: f"", rb'', """ … """
      if (spec.stringPrefix && spec.stringPrefix.test(word) && (src[j] === '"' || src[j] === "'")) {
        const tri = (spec.triple || []).find((q) => src.startsWith(q, j));
        let end;
        if (tri) {
          const k = src.indexOf(tri, j + tri.length);
          end = k === -1 ? n : k + tri.length;
        } else {
          end = scanQuoted(src, j, { q: src[j], esc: true });
        }
        emit('string', i, end);
        i = end;
        continue;
      }

      let type = 'plain';
      if (spec.keywords.has(word)) type = 'keyword';
      else if (spec.literals && spec.literals.has(word)) type = 'literal';
      else if (spec.types && spec.types.has(word)) type = 'type';
      else if (spec.builtins && spec.builtins.has(word)) type = 'builtin';
      else if (prev && prev.type === 'keyword' && DECL_TYPE.has(prev.text)) type = 'type';
      else if (prev && prev.type === 'keyword' && DECL_FN.has(prev.text)) type = 'function';
      else {
        let k = j;
        while (k < n && (src[k] === ' ' || src[k] === '\t')) k++;
        if (src[k] === '(') type = 'function';
        else if (spec.macro && src[j] === '!') type = 'function';
        else if (spec.capitalTypes && /^[A-Z]/.test(word)) type = 'type';
      }
      emit(type, i, j);
      i = j;
      continue;
    }

    if (PUNCT_CHARS.has(c)) { emit('punct', i, i + 1); i++; continue; }

    if (OP_CHARS.has(c)) {
      let j = i + 1;
      while (j < n && OP_CHARS.has(src[j]) && !startsComment(src, j, spec)) j++;
      emit('operator', i, j);
      i = j;
      continue;
    }

    emit('plain', i, i + 1);
    i++;
  }
  return out;
}

/** JSON/CSS-ish: a string immediately followed by `:` is a key, not a value. */
function markKeys(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'string') continue;
    let j = i + 1;
    while (j < tokens.length && tokens[j].type === 'ws') j++;
    if (tokens[j] && tokens[j].type === 'punct' && tokens[j].text === ':') tokens[i].type = 'property';
  }
  return tokens;
}

// ── dedicated scanners ──────────────────────────────────────────────────────

function scanCss(src) {
  const out = [];
  const n = src.length;
  let i = 0;
  let depth = 0;      // inside a declaration block?
  let inValue = false;
  const emit = (type, from, to) => { if (to > from) out.push({ type, text: src.slice(from, to) }); };

  while (i < n) {
    const c = src[i];
    if (WS.has(c)) {
      let j = i + 1;
      while (j < n && WS.has(src[j])) j++;
      emit('ws', i, j); i = j; continue;
    }
    if (src.startsWith('/*', i)) {
      const k = src.indexOf('*/', i + 2);
      const j = k === -1 ? n : k + 2;
      emit('comment', i, j); i = j; continue;
    }
    if (c === '"' || c === "'") {
      const j = scanQuoted(src, i, { q: c, esc: true });
      emit('string', i, j); i = j; continue;
    }
    if (c === '@') {
      let j = i + 1;
      while (j < n && /[\w-]/.test(src[j])) j++;
      emit('keyword', i, j); i = j; continue;
    }
    if (c === '{') { depth++; inValue = false; emit('punct', i, i + 1); i++; continue; }
    if (c === '}') { depth = Math.max(0, depth - 1); inValue = false; emit('punct', i, i + 1); i++; continue; }
    if (c === ';') { inValue = false; emit('punct', i, i + 1); i++; continue; }
    if (c === ':' && depth > 0) { inValue = true; emit('punct', i, i + 1); i++; continue; }
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1] || ''))) {
      let j = scanNumber(src, i);
      while (j < n && /[a-z%]/i.test(src[j])) j++;
      emit('number', i, j); i = j; continue;
    }
    if (c === '#') {
      let j = i + 1;
      while (j < n && /[\w-]/.test(src[j])) j++;
      emit(inValue ? 'number' : 'type', i, j); i = j; continue;
    }
    if (c === '!') {
      let j = i + 1;
      while (j < n && /[a-z]/i.test(src[j])) j++;
      emit('keyword', i, j); i = j; continue;
    }
    if (c === '.' && depth === 0) {
      let j = i + 1;
      while (j < n && /[\w-]/.test(src[j])) j++;
      emit('type', i, j); i = j; continue;
    }
    if (c === ':') {   // pseudo-class / pseudo-element in a selector
      let j = i;
      while (j < n && src[j] === ':') j++;
      while (j < n && /[\w-]/.test(src[j])) j++;
      emit('function', i, j); i = j; continue;
    }
    if (isIdentStart(c) || (c === '-' && /[\w-]/.test(src[i + 1] || ''))) {
      let j = i;
      while (j < n && /[\w-]/.test(src[j])) j++;
      const word = src.slice(i, j);
      let type;
      if (word.startsWith('--')) type = 'variable';
      else if (src[j] === '(') type = 'function';
      else if (depth > 0 && !inValue) type = 'property';
      else if (depth > 0) type = 'literal';
      else type = 'tag';
      emit(type, i, j); i = j; continue;
    }
    emit('punct', i, i + 1);
    i++;
  }
  return out;
}

function scanHtml(src) {
  const out = [];
  const n = src.length;
  let i = 0;
  const emit = (type, from, to) => { if (to > from) out.push({ type, text: src.slice(from, to) }); };

  while (i < n) {
    if (src.startsWith('<!--', i)) {
      const k = src.indexOf('-->', i);
      const j = k === -1 ? n : k + 3;
      emit('comment', i, j); i = j; continue;
    }
    if (src.startsWith('<!', i) || src.startsWith('<?', i)) {
      const k = src.indexOf('>', i);
      const j = k === -1 ? n : k + 1;
      emit('keyword', i, j); i = j; continue;
    }
    if (src[i] === '<' && /[A-Za-z/]/.test(src[i + 1] || '')) {
      let j = i + 1;
      if (src[j] === '/') j++;
      const nameAt = j;
      while (j < n && /[\w:.-]/.test(src[j])) j++;
      const name = src.slice(nameAt, j).toLowerCase();
      emit('tag', i, j);
      i = j;
      while (i < n && src[i] !== '>') {
        const c = src[i];
        if (WS.has(c)) {
          let k = i + 1;
          while (k < n && WS.has(src[k])) k++;
          emit('ws', i, k); i = k; continue;
        }
        if (c === '"' || c === "'") {
          const k = scanQuoted(src, i, { q: c, esc: false, multiline: true });
          emit('string', i, k); i = k; continue;
        }
        if (c === '=') { emit('operator', i, i + 1); i++; continue; }
        if (c === '/') { emit('tag', i, i + 1); i++; continue; }
        if (/[\w@:.{}-]/.test(c)) {
          let k = i + 1;
          while (k < n && /[\w@:.{}-]/.test(src[k])) k++;
          emit('attr', i, k); i = k; continue;
        }
        emit('plain', i, i + 1); i++;
      }
      if (i < n) { emit('tag', i, i + 1); i++; }

      // hand <script>/<style> bodies to the right scanner
      if (name === 'script' || name === 'style') {
        const rel = src.slice(i).search(new RegExp(`</${name}`, 'i'));
        const end = rel === -1 ? n : i + rel;
        const inner = src.slice(i, end);
        if (inner) {
          const sub = name === 'script' ? scanCode(inner, SPECS.js) : scanCss(inner);
          for (const tk of sub) out.push(tk);
        }
        i = end;
      }
      continue;
    }
    let j = src.indexOf('<', i + 1);
    if (j === -1) j = n;
    emit('plain', i, j);
    i = j;
  }
  return out;
}

/** Line-oriented languages share this shell: one scanner call per source line. */
function byLine(src, scanLine) {
  const out = [];
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (i) out.push({ type: 'ws', text: '\n' });
    const push = (type, text) => { if (text) out.push({ type, text }); };
    scanLine(lines[i], push);
  }
  return out;
}

const YAML_SCALAR = /^(true|false|null|yes|no|on|off|~)$/i;

function yamlValue(v, push) {
  const lead = /^\s*/.exec(v)[0];
  push('ws', lead);
  let s = v.slice(lead.length);
  if (!s) return;
  if (s.startsWith('#')) { push('comment', s); return; }
  let trailing = '';
  const cm = /\s#(\s|$)/.exec(s);
  if (cm) { trailing = s.slice(cm.index); s = s.slice(0, cm.index); }
  if (/^["']/.test(s)) push('string', s);
  else if (/^[&*!]/.test(s)) push('type', s);
  else if (YAML_SCALAR.test(s)) push('literal', s);
  else if (/^-?\d[\d_.eE+-]*$/.test(s)) push('number', s);
  else if (/^[|>][-+\d]*$/.test(s)) push('operator', s);
  else push('plain', s);
  if (trailing) push('comment', trailing);
}

function scanYamlLine(l, push) {
  const lead = /^\s*/.exec(l)[0];
  push('ws', lead);
  let r = l.slice(lead.length);
  if (!r) return;
  if (r.startsWith('#')) { push('comment', r); return; }
  if (/^(---|\.\.\.)\s*$/.test(r)) { push('punct', r); return; }
  while (r === '-' || r.startsWith('- ')) {
    if (r === '-') { push('punct', '-'); return; }
    push('punct', '- ');
    r = r.slice(2);
    const gap = /^\s*/.exec(r)[0];
    push('ws', gap);
    r = r.slice(gap.length);
  }
  const km = /^([^\s#][^:#]*?)(\s*):(\s|$)/.exec(r);
  if (km) {
    push('property', km[1]);
    push('ws', km[2]);
    push('punct', ':');
    yamlValue(r.slice(km[1].length + km[2].length + 1), push);
    return;
  }
  yamlValue(r, push);
}

function tomlValue(v, push) {
  const lead = /^\s*/.exec(v)[0];
  push('ws', lead);
  let s = v.slice(lead.length);
  if (!s) return;
  let trailing = '';
  const cm = /\s#/.exec(s);
  if (cm && !/^["']/.test(s)) { trailing = s.slice(cm.index); s = s.slice(0, cm.index); }
  if (/^["']/.test(s)) push('string', s);
  else if (/^(true|false)$/.test(s)) push('literal', s);
  else if (/^[+-]?[\d_]/.test(s)) push('number', s);
  else push('plain', s);
  if (trailing) push('comment', trailing);
}

function scanTomlLine(l, push) {
  const lead = /^\s*/.exec(l)[0];
  push('ws', lead);
  const r = l.slice(lead.length);
  if (!r) return;
  if (r.startsWith('#')) { push('comment', r); return; }
  if (r.startsWith('[')) { push('type', r); return; }
  const m = /^([^=]+?)(\s*)=(\s*)/.exec(r);
  if (m) {
    push('property', m[1]);
    push('ws', m[2]);
    push('operator', '=');
    push('ws', m[3]);
    tomlValue(r.slice(m[0].length), push);
    return;
  }
  push('plain', r);
}

const MD_INLINE = /(`+[^`]*`+)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(!?\[[^\]]*\]\([^)]*\))|(https?:\/\/[^\s)]+)/g;

function mdInline(text, push) {
  let last = 0;
  MD_INLINE.lastIndex = 0;
  let m;
  while ((m = MD_INLINE.exec(text))) {
    if (m.index > last) push('plain', text.slice(last, m.index));
    const type = m[1] ? 'code' : m[2] ? 'strong' : m[3] ? 'em' : 'link';
    push(type, m[0]);
    last = m.index + m[0].length;
  }
  if (last < text.length) push('plain', text.slice(last));
}

function scanMd(src) {
  const out = [];
  const lines = src.split('\n');
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    if (i) out.push({ type: 'ws', text: '\n' });
    const push = (type, text) => { if (text) out.push({ type, text }); };
    const l = lines[i];
    const fm = /^(\s*)(```+|~~~+)(.*)$/.exec(l);
    if (fm) {
      push('ws', fm[1]);
      push('punct', fm[2]);
      push('attr', fm[3]);
      fenced = !fenced;
      continue;
    }
    if (fenced) { push('plain', l); continue; }
    if (/^\s{0,3}#{1,6}\s/.test(l)) { push('heading', l); continue; }
    if (/^\s{0,3}([-*_])\s*(?:\1\s*){2,}$/.test(l)) { push('punct', l); continue; }
    if (/^\s{0,3}>/.test(l)) { push('comment', l); continue; }
    const lm = /^(\s*)([-*+]|\d+[.)])(\s+)/.exec(l);
    let at = 0;
    if (lm) {
      push('ws', lm[1]);
      push('punct', lm[2]);
      push('ws', lm[3]);
      at = lm[0].length;
    }
    mdInline(l.slice(at), push);
  }
  return out;
}

// ── language specs ──────────────────────────────────────────────────────────

const JS = {
  lineComment: ['//'],
  blockComment: [['/*', '*/']],
  strings: [{ q: "'", esc: true }, { q: '"', esc: true }, { q: '`', template: true }],
  keywords: set(`as async await break case catch class const continue debugger default delete do
    else export extends finally for from function get if import in instanceof let new of return set
    static super switch this throw try typeof var void while with yield`),
  literals: set('true false null undefined NaN Infinity'),
  builtins: set(`console process require module exports globalThis Object Array String Number Boolean
    Symbol BigInt Math JSON Promise Map Set WeakMap WeakSet Date RegExp Error TypeError RangeError
    Proxy Reflect Buffer document window fetch structuredClone setTimeout setInterval clearTimeout
    clearInterval queueMicrotask`),
  regex: true,
  capitalTypes: true,
  jsx: true,
};

const TS = {
  ...JS,
  jsx: false,
  keywords: new Set([...JS.keywords, ...set(`abstract asserts declare enum implements infer interface
    is keyof namespace never override private protected public readonly satisfies type unique`)]),
  types: set(`any bigint boolean number object string symbol unknown void Array Record Partial Required
    Readonly Pick Omit Exclude Extract Parameters ReturnType Awaited`),
};

const PY = {
  lineComment: ['#'],
  strings: [{ q: "'", esc: true }, { q: '"', esc: true }],
  triple: ['"""', "'''"],
  stringPrefix: /^[rbufRBUF]{1,2}$/,
  decorator: true,
  keywords: set(`and as assert async await break class continue def del elif else except finally for
    from global if import in is lambda nonlocal not or pass raise return try while with yield match case`),
  literals: set('True False None NotImplemented Ellipsis'),
  builtins: set(`self cls print len range int str float list dict set tuple bool bytes open enumerate
    zip map filter sum min max abs sorted reversed type isinstance issubclass getattr setattr hasattr
    super repr format input any all round divmod id hash iter next staticmethod classmethod property
    Exception ValueError TypeError KeyError IndexError RuntimeError`),
  capitalTypes: true,
};

const SH = {
  lineComment: ['#'],
  strings: [{ q: "'", esc: false, multiline: true }, { q: '"', esc: true, multiline: true }],
  sigil: '$',
  flags: true,
  keywords: set(`if then else elif fi for while until do done case esac in function select time
    return exit break continue local export readonly declare typeset source alias unalias set unset
    shift trap eval exec wait`),
  literals: set('true false'),
  builtins: set(`echo printf read cd pwd ls cat rm rmdir mkdir cp mv touch ln chmod chown find grep
    rg sed awk sort uniq head tail wc which env sudo curl wget tar git npm npx pnpm yarn node deno
    bun make docker kill ps sleep xargs jq`),
};

const GO = {
  lineComment: ['//'],
  blockComment: [['/*', '*/']],
  strings: [{ q: '"', esc: true }, { q: '`', esc: false, multiline: true }, { q: "'", esc: true }],
  keywords: set(`break case chan const continue default defer else fallthrough for func go goto if
    import interface map package range return select struct switch type var`),
  literals: set('true false nil iota'),
  types: set(`any bool byte complex64 complex128 error float32 float64 int int8 int16 int32 int64
    rune string uint uint8 uint16 uint32 uint64 uintptr`),
  builtins: set('append cap close copy delete len make new panic print println recover'),
};

const RUST = {
  lineComment: ['//'],
  blockComment: [['/*', '*/']],
  strings: [{ q: '"', esc: true, multiline: true }, { q: "'", esc: true }],
  lifetimes: true,
  macro: true,
  rawString: true,
  keywords: set(`as async await break const continue crate dyn else enum extern fn for if impl in
    let loop match mod move mut pub ref return self Self static struct super trait type unsafe use
    where while`),
  literals: set('true false None Some Ok Err'),
  types: set(`bool char f32 f64 i8 i16 i32 i64 i128 isize str u8 u16 u32 u64 u128 usize String Vec
    Option Result Box Rc Arc RefCell HashMap HashSet`),
  capitalTypes: true,
};

const CLIKE = {
  lineComment: ['//'],
  blockComment: [['/*', '*/']],
  strings: [{ q: '"', esc: true }, { q: "'", esc: true }],
  keywords: set(`abstract assert auto break case catch char class const constexpr continue default
    delete do double else enum export extends extern final finally float for friend goto if implements
    import inline instanceof int interface let long namespace new operator override package private
    protected public register return short signed sizeof static struct super switch synchronized
    template this throw throws try typedef typename union unsigned using var virtual void volatile while`),
  literals: set('true false null nullptr NULL nil'),
  capitalTypes: true,
};

const JSON_SPEC = {
  strings: [{ q: '"', esc: true }],
  keywords: set(''),
  literals: set('true false null'),
  keyBeforeColon: true,
};

const SPECS = {
  js: JS,
  jsx: { ...JS, jsx: true },
  ts: TS,
  tsx: { ...TS, jsx: true },
  json: JSON_SPEC,
  py: PY,
  sh: SH,
  go: GO,
  rust: RUST,
  clike: CLIKE,
  css: { scan: scanCss },
  html: { scan: scanHtml },
  yaml: { scan: (s) => byLine(s, scanYamlLine) },
  toml: { scan: (s) => byLine(s, scanTomlLine) },
  md: { scan: scanMd },
};

// ── entry point ─────────────────────────────────────────────────────────────

/** Tabs break cell arithmetic, so they are expanded before anything else. */
function prepare(code) {
  let s = String(code ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, '  ');
  if (s.endsWith('\n')) s = s.slice(0, -1);   // a trailing newline is a terminator
  return s;
}

function toLines(tokens, colours) {
  const out = [];
  let cur = [];
  for (const tk of tokens) {
    const style = colours[tk.type] || colours.plain;
    const parts = tk.text.split('\n');
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) { out.push(compact(cur)); cur = []; }
      if (parts[i]) cur.push(run(parts[i], style));
    }
  }
  out.push(compact(cur));
  return out;
}

/**
 * Highlight `code` as `lang`, one Line per source line.
 * Unknown languages come back as plain text, never as an error.
 */
export function highlight(code, lang, theme) {
  const colours = palette(theme);
  const src = prepare(code);
  const spec = SPECS[normLang(lang)];
  if (!spec) return src.split('\n').map((l) => (l ? [run(l, colours.plain)] : []));
  const tokens = spec.scan ? spec.scan(src) : scanCode(src, spec);
  if (spec.keyBeforeColon) markKeys(tokens);
  return toLines(tokens, colours);
}
