/**
 * markdown.js — renders the assistant's markdown into terminal lines.
 *
 * A two-pass design: `parse()` folds the source into blocks (paragraph, list,
 * fence, quote, table, heading, rule), then each block renders itself at the
 * requested width. Inline emphasis is handled by a small scanner rather than
 * regexes so nesting and escapes behave.
 *
 * The hard guarantee callers rely on: no returned Line is ever wider than
 * `width` cells.
 */

import { run, wrap, wrapText, truncate, pad, width as lw, strWidth } from './text.js';
import { highlight, detectLang } from './highlight.js';

// ── block parsing ───────────────────────────────────────────────────────────

const FENCE = /^(\s*)(`{3,}|~{3,})\s*([\w+.-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const BULLET = /^(\s*)([-*+])\s+(.*)$/;
const ORDERED = /^(\s*)(\d{1,3})[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/;

export function parse(src) {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') { i++; continue; }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[2][0];
      const body = [];
      i++;
      while (i < lines.length) {
        const end = FENCE.exec(lines[i]);
        if (end && end[2][0] === marker && end[2].length >= fence[2].length) { i++; break; }
        body.push(lines[i]);
        i++;
      }
      blocks.push({ type: 'code', lang: fence[3] || '', body });
      continue;
    }

    const h = HEADING.exec(line);
    if (h) { blocks.push({ type: 'heading', level: h[1].length, text: h[2].trim() }); i++; continue; }

    if (RULE.test(line)) { blocks.push({ type: 'rule' }); i++; continue; }

    if (QUOTE.test(line)) {
      const body = [];
      while (i < lines.length && (QUOTE.test(lines[i]) || (body.length && lines[i].trim() && !isBlockStart(lines[i])))) {
        const m = QUOTE.exec(lines[i]);
        body.push(m ? m[1] : lines[i].trim());
        i++;
      }
      blocks.push({ type: 'quote', body: parse(body.join('\n')) });
      continue;
    }

    // table: a header row followed by a separator row
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      const header = splitRow(line);
      const align = splitRow(lines[i + 1]).map(alignOf);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ type: 'table', header, align, rows });
      continue;
    }

    if (BULLET.test(line) || ORDERED.test(line)) {
      const items = [];
      while (i < lines.length) {
        const b = BULLET.exec(lines[i]);
        const o = ORDERED.exec(lines[i]);
        if (!b && !o) {
          // a lazy continuation line belongs to the previous item
          if (items.length && lines[i].trim() !== '' && !isBlockStart(lines[i])) {
            items[items.length - 1].text += ` ${lines[i].trim()}`;
            i++;
            continue;
          }
          break;
        }
        const m = b || o;
        items.push({
          indent: Math.floor(m[1].replace(/\t/g, '  ').length / 2),
          marker: b ? '•' : `${o[2]}.`,
          ordered: !b,
          text: m[3],
        });
        i++;
      }
      blocks.push({ type: 'list', items });
      continue;
    }

    // paragraph
    const para = [];
    while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i])) {
      para.push(lines[i].trim());
      i++;
    }
    if (para.length) blocks.push({ type: 'para', text: para.join(' ') });
    else i++;
  }
  return blocks;
}

function isBlockStart(line) {
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) ||
    BULLET.test(line) || ORDERED.test(line) || QUOTE.test(line);
}

const splitRow = (line) =>
  line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());

function alignOf(spec) {
  const s = spec.trim();
  if (s.startsWith(':') && s.endsWith(':')) return 'center';
  if (s.endsWith(':')) return 'right';
  return 'left';
}

// ── inline scanning ─────────────────────────────────────────────────────────

/**
 * Turn inline markdown into runs. Handles `code`, **bold**, *italic*, _italic_,
 * ~~strike~~, [text](url), autolinks and backslash escapes.
 */
export function renderInline(src, theme, base = {}) {
  const out = [];
  const text = String(src ?? '');
  let buf = '';
  let i = 0;

  const flush = () => { if (buf) { out.push(run(buf, { fg: theme.text, ...base })); buf = ''; } };

  while (i < text.length) {
    const c = text[i];

    if (c === '\\' && i + 1 < text.length) { buf += text[i + 1]; i += 2; continue; }

    if (c === '`') {
      let n = 1;
      while (text[i + n] === '`') n++;
      const marker = '`'.repeat(n);
      const end = text.indexOf(marker, i + n);
      if (end !== -1) {
        flush();
        out.push(run(` ${text.slice(i + n, end).trim()} `, { fg: theme.code, bg: theme.panel, ...base }));
        i = end + n;
        continue;
      }
    }

    if ((c === '*' || c === '_') && text[i + 1] === c) {
      const end = findClose(text, i + 2, c.repeat(2));
      if (end !== -1) {
        flush();
        out.push(...renderInline(text.slice(i + 2, end), theme, { ...base, bold: true, fg: theme.text }));
        i = end + 2;
        continue;
      }
    }

    if (c === '~' && text[i + 1] === '~') {
      const end = findClose(text, i + 2, '~~');
      if (end !== -1) {
        flush();
        out.push(...renderInline(text.slice(i + 2, end), theme, { ...base, strike: true }));
        i = end + 2;
        continue;
      }
    }

    if ((c === '*' || c === '_') && text[i + 1] !== ' ') {
      const end = findClose(text, i + 1, c);
      if (end !== -1 && end > i + 1) {
        flush();
        out.push(...renderInline(text.slice(i + 1, end), theme, { ...base, italic: true }));
        i = end + 1;
        continue;
      }
    }

    if (c === '[') {
      const close = matchBracket(text, i);
      if (close !== -1 && text[close + 1] === '(') {
        const paren = text.indexOf(')', close + 2);
        if (paren !== -1) {
          flush();
          const label = text.slice(i + 1, close);
          const url = text.slice(close + 2, paren);
          out.push(...renderInline(label, theme, { ...base, fg: theme.info, underline: true }));
          if (url && url !== label) out.push(run(` (${url})`, { fg: theme.faint, ...base }));
          i = paren + 1;
          continue;
        }
      }
    }

    if (c === 'h' && (text.startsWith('http://', i) || text.startsWith('https://', i))) {
      let j = i;
      while (j < text.length && !/[\s)\]]/.test(text[j])) j++;
      flush();
      out.push(run(text.slice(i, j), { fg: theme.info, underline: true, ...base }));
      i = j;
      continue;
    }

    buf += c;
    i++;
  }
  flush();
  return out.length ? out : [run('', base)];
}

/** Find a closing marker, skipping over code spans and escapes. */
function findClose(text, from, marker) {
  let i = from;
  while (i < text.length) {
    if (text[i] === '\\') { i += 2; continue; }
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end === -1) return -1;
      i = end + 1;
      continue;
    }
    if (text.startsWith(marker, i)) return i;
    i++;
  }
  return -1;
}

function matchBracket(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '\\') { i++; continue; }
    if (text[i] === '[') depth++;
    else if (text[i] === ']') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// ── block rendering ─────────────────────────────────────────────────────────

/**
 * @param {string} src
 * @param {number} width
 * @param {object} theme
 * @param {object} [opts] {indent}
 * @returns {Line[]}
 */
export function renderMarkdown(src, width, theme, opts = {}) {
  const w = Math.max(8, width | 0);
  const blocks = parse(src);
  const out = [];
  for (let i = 0; i < blocks.length; i++) {
    if (i > 0) out.push([]);
    out.push(...renderBlock(blocks[i], w, theme, opts));
  }
  // Guarantee the width contract even if a renderer above slipped.
  return out.map((l) => (lw(l) > w ? truncate(l, w, '…') : l));
}

function renderBlock(b, w, theme, opts) {
  switch (b.type) {
    case 'heading': return renderHeading(b, w, theme);
    case 'para': return wrap(renderInline(b.text, theme), w);
    case 'list': return renderList(b, w, theme);
    case 'code': return renderCode(b, w, theme);
    case 'quote': return renderQuote(b, w, theme, opts);
    case 'rule': return [[run('─'.repeat(w), { fg: theme.borderDim })]];
    case 'table': return renderTable(b, w, theme);
    default: return [];
  }
}

function renderHeading(b, w, theme) {
  const fg = b.level === 1 ? theme.primary : b.level === 2 ? theme.accent : theme.text;
  const prefix = b.level <= 2 ? '' : '';
  const body = renderInline(b.text, theme, { fg, bold: true });
  const lines = wrap([run(prefix, { fg }), ...body], w);
  if (b.level === 1) {
    lines.push([run('═'.repeat(Math.min(w, Math.max(4, lw(lines[0])))), { fg: theme.borderDim })]);
  } else if (b.level === 2) {
    lines.push([run('─'.repeat(Math.min(w, Math.max(4, lw(lines[0])))), { fg: theme.borderDim })]);
  }
  return lines;
}

function renderList(b, w, theme) {
  const out = [];
  for (const item of b.items) {
    const indent = Math.min(item.indent, 4) * 2;
    const marker = item.ordered ? item.marker : '•';
    const head = [
      run(' '.repeat(indent), {}),
      run(`${marker} `, { fg: theme.accent }),
    ];
    const headW = lw(head);
    const body = wrap(renderInline(item.text, theme), Math.max(4, w - headW));
    out.push([...head, ...(body[0] || [])]);
    for (const l of body.slice(1)) out.push([run(' '.repeat(headW), {}), ...l]);
  }
  return out;
}

function renderCode(b, w, theme) {
  const lang = b.lang || '';
  const inner = Math.max(4, w - 2);
  const code = b.body.join('\n');
  const hl = highlight(code, lang || detectLang(`x.${lang}`), theme);
  const bar = (fg) => run('▏ ', { fg });
  const out = [];

  if (lang) {
    out.push([
      run('▏ ', { fg: theme.borderDim }),
      run(lang, { fg: theme.faint, italic: true }),
    ]);
  }
  for (const line of hl) {
    out.push([bar(theme.borderDim), ...truncate(line, inner, '…')]);
  }
  return out.length ? out : [[bar(theme.borderDim)]];
}

function renderQuote(b, w, theme, opts) {
  const inner = Math.max(4, w - 2);
  const body = [];
  for (let i = 0; i < b.body.length; i++) {
    if (i > 0) body.push([]);
    body.push(...renderBlock(b.body[i], inner, theme, opts));
  }
  return body.map((l) => [run('▌ ', { fg: theme.accent }), ...l]);
}

function renderTable(b, w, theme) {
  const cols = Math.max(b.header.length, ...b.rows.map((r) => r.length));
  const cells = [b.header, ...b.rows].map((r) => {
    const out = [];
    for (let c = 0; c < cols; c++) out.push(r[c] ?? '');
    return out;
  });

  // Width each column to its content, then shrink the widest until it fits.
  const widths = new Array(cols).fill(0);
  for (const row of cells) {
    for (let c = 0; c < cols; c++) widths[c] = Math.max(widths[c], strWidth(stripInline(row[c])));
  }
  const chrome = cols * 3 + 1;
  let total = widths.reduce((a, x) => a + x, 0) + chrome;
  let guard = 0;
  while (total > w && guard++ < 500) {
    const widest = widths.indexOf(Math.max(...widths));
    if (widths[widest] <= 3) break;
    widths[widest] -= 1;
    total -= 1;
  }

  const line = (l, m, r) => [run(l + widths.map((x) => '─'.repeat(x + 2)).join(m) + r, { fg: theme.borderDim })];
  const rowOf = (row, style) => {
    const out = [run('│', { fg: theme.borderDim })];
    for (let c = 0; c < cols; c++) {
      const content = truncate(renderInline(row[c], theme, style), widths[c], '…');
      const align = b.align[c] || 'left';
      const padding = widths[c] - lw(content);
      const left = align === 'right' ? padding : align === 'center' ? Math.floor(padding / 2) : 0;
      out.push(
        run(' '.repeat(left + 1), {}),
        ...content,
        run(' '.repeat(Math.max(0, padding - left) + 1), {}),
        run('│', { fg: theme.borderDim }),
      );
    }
    return out;
  };

  return [
    line('┌', '┬', '┐'),
    rowOf(b.header, { bold: true, fg: theme.primary }),
    line('├', '┼', '┤'),
    ...b.rows.map((r) => rowOf(r, {})),
    line('└', '┴', '┘'),
  ];
}

const stripInline = (s) => String(s ?? '').replace(/[*_`~]/g, '');

/** Plain-text rendering, used by headless/JSON output. */
export function markdownToText(src, width = 80) {
  const blocks = parse(src);
  const out = [];
  for (const b of blocks) {
    switch (b.type) {
      case 'heading': out.push(`${'#'.repeat(b.level)} ${b.text}`, ''); break;
      case 'para': out.push(...softWrapPlain(stripInline(b.text), width), ''); break;
      case 'list':
        for (const it of b.items) {
          out.push(`${' '.repeat(it.indent * 2)}${it.ordered ? it.marker : '-'} ${stripInline(it.text)}`);
        }
        out.push('');
        break;
      case 'code': out.push(`\`\`\`${b.lang}`, ...b.body, '```', ''); break;
      case 'quote': out.push(...markdownToText(b.body.map(() => '').join(''), width)); break;
      case 'rule': out.push('-'.repeat(Math.min(width, 40)), ''); break;
      case 'table':
        out.push(`| ${b.header.join(' | ')} |`);
        for (const r of b.rows) out.push(`| ${r.join(' | ')} |`);
        out.push('');
        break;
      default: break;
    }
  }
  return out;
}

function softWrapPlain(text, width) {
  const words = text.split(/\s+/).filter(Boolean);
  const out = [];
  let cur = '';
  for (const word of words) {
    if (cur && cur.length + 1 + word.length > width) { out.push(cur); cur = word; }
    else cur = cur ? `${cur} ${word}` : word;
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}

export { wrapText, pad };
