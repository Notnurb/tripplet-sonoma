/**
 * transcript.js — turns session blocks into screen lines.
 *
 * The visual language borrows from both references: assistant turns are marked
 * with the round bullet the Kimi CLI uses, tool calls use the status glyph +
 * indented detail that CRUSH uses, and user turns echo as a shell-style prompt
 * line so the conversation reads like a session log.
 *
 * Rendering is cached per block. Blocks only change while they are streaming,
 * so a long transcript costs almost nothing to redraw.
 */

import { run, wrapText, truncate, pad, width as lw } from './text.js';
import { renderMarkdown } from './markdown.js';
import { highlight, detectLang } from './highlight.js';
import { renderDiff } from './diffview.js';
import { renderWelcome } from './welcome.js';

const cache = new WeakMap();

const GLYPH = {
  running: '◍',
  ok: '✓',
  error: '✕',
  denied: '⊘',
  skipped: '−',
};

/**
 * @param {object[]} blocks
 * @param {object} o  {width, theme, session, verbose, user}
 * @returns {Line[]}
 */
export function renderTranscript(blocks, o) {
  const out = [];
  for (const b of blocks) {
    const sig = signature(b);
    const hit = cache.get(b);
    if (hit && hit.w === o.width && hit.sig === sig && hit.rainbow === o.theme.rainbow) {
      out.push(...hit.lines);
      continue;
    }
    const lines = renderBlock(b, o);
    if (!o.theme.rainbow) cache.set(b, { w: o.width, sig, lines, rainbow: false });
    out.push(...lines);
  }
  return out;
}

function signature(b) {
  switch (b.kind) {
    case 'text': case 'thinking': return `${b.text.length}:${b.done ? 1 : 0}`;
    case 'tool': return `${b.status}:${(b.summary || '').length}:${b.detail ? 1 : 0}`;
    case 'welcome': return 'welcome';
    default: return 'static';
  }
}

export function renderBlock(b, o) {
  switch (b.kind) {
    case 'welcome': return [
      ...renderWelcome({
        theme: o.theme,
        session: o.session,
        cwd: o.session?.cwd,
        width: Math.min(o.width, 96),
        version: o.version,
        tips: o.width >= 60,
      }),
      [],
    ];
    case 'user': return renderUser(b, o);
    case 'thinking': return renderThinking(b, o);
    case 'text': return renderText(b, o);
    case 'tool': return renderTool(b, o);
    case 'notice': return renderNotice(b, o);
    case 'lines': return [...b.lines, []];
    case 'divider': return [[run('─'.repeat(o.width), { fg: o.theme.borderDim })], []];
    default: return [];
  }
}

// ── user ────────────────────────────────────────────────────────────────────

function renderUser(b, { width, theme, user = 'you' }) {
  const host = [
    run(user, { fg: theme.rainbow ? theme.pulse(0) : theme.success, bold: true }),
    run('@', { fg: theme.faint }),
    run('Astrocode', { fg: theme.rainbow ? theme.pulse(60) : theme.primary, bold: true }),
    run('🚀', {}),
    run(' ', {}),
  ];
  const head = lw(host);
  const body = wrapText(b.text, Math.max(8, width - head), { fg: theme.user }, {});
  const out = [[...host, ...(body[0] || [])]];
  for (const l of body.slice(1)) out.push([run(' '.repeat(head)), ...l]);
  out.push([]);
  return out;
}

// ── thinking ────────────────────────────────────────────────────────────────

function renderThinking(b, { width, theme }) {
  if (!b.text) return [];
  const bullet = [run('● ', { fg: theme.rainbow ? theme.pulse(180, theme.warn) : theme.warn })];
  const w = Math.max(8, width - 2);
  const out = [];
  const paras = b.text.split('\n').filter((l) => l.trim() !== '');
  for (let i = 0; i < paras.length; i++) {
    const lines = wrapText(paras[i], w, { fg: theme.thinking, italic: true });
    out.push([...(i === 0 ? bullet : [run('  ')]), ...(lines[0] || [])]);
    for (const l of lines.slice(1)) out.push([run('  '), ...l]);
  }
  out.push([]);
  return out;
}

// ── assistant text ──────────────────────────────────────────────────────────

function renderText(b, { width, theme, session }) {
  if (!b.text) return [];
  const accent = session?.model?.accent || theme.primary;
  const bullet = [run('● ', { fg: theme.rainbow ? theme.pulse(0, accent) : accent })];
  const md = renderMarkdown(b.text, Math.max(8, width - 2), theme);
  const out = [];
  for (let i = 0; i < md.length; i++) {
    out.push(i === 0 ? [...bullet, ...md[i]] : [run('  '), ...md[i]]);
  }
  out.push([]);
  return out;
}

// ── tools ───────────────────────────────────────────────────────────────────

function renderTool(b, o) {
  const { theme, width, verbose } = o;
  const g = GLYPH[b.status] || '·';
  const fg = b.status === 'ok' ? theme.success
    : b.status === 'error' ? theme.error
      : b.status === 'denied' ? theme.warn
        : theme.tool;

  const head = [
    run('  '),
    run(`${g} `, { fg }),
    run(b.title, { fg: theme.tool, bold: true }),
    run(' ', {}),
    ...truncate([run(b.describe || '', { fg: theme.dim })], Math.max(6, width - 8 - lw([run(b.title)])), '…'),
  ];
  const out = [head];

  if (b.status === 'error' && b.summary) {
    out.push([
      run('      '),
      run(' ERROR ', { bg: theme.error, fg: '#ffffff', bold: true }),
      run(' '),
      ...truncate([run(b.summary, { fg: theme.error })], Math.max(6, width - 16), '…'),
    ]);
    out.push([]);
    return out;
  }

  if (b.status === 'denied') {
    out.push([run('      '), run(b.summary || 'Denied by permission rules', { fg: theme.warn })]);
    out.push([]);
    return out;
  }

  if (b.status === 'running') {
    out.push([]);
    return out;
  }

  const detail = renderToolDetail(b, o, verbose);
  out.push(...detail);
  if (b.summary && (!detail.length || b.tool === 'bash')) {
    out.push([run('      '), ...truncate([run(b.summary, { fg: theme.dim })], width - 8, '…')]);
  }
  out.push([]);
  return out;
}

const MAX_DETAIL = 14;

function renderToolDetail(b, { width, theme }, verbose) {
  const w = Math.max(10, width - 6);
  const indent = () => run('      ');
  const meta = b.meta || {};
  const cap = verbose ? 60 : MAX_DETAIL;

  if (Array.isArray(b.detail)) {
    return b.detail.slice(0, cap).map((l) => [indent(), ...truncate(l, w, '…')]);
  }

  if (meta.diff) {
    const lines = renderDiff(meta.diff, w, theme, { compact: !verbose });
    const shown = lines.slice(0, cap);
    const out = shown.map((l) => [indent(), ...l]);
    if (lines.length > cap) out.push([indent(), run(`…(${lines.length - cap} more lines)`, { fg: theme.faint })]);
    return out;
  }

  if (meta.lines) {
    const lang = detectLang(meta.path || '');
    const gutterW = String(meta.lines[meta.lines.length - 1]?.n ?? 0).length + 1;
    const shown = meta.lines.slice(0, cap);
    const out = shown.map(({ n, text }) => {
      const code = highlight(text, lang, theme)[0] || [run(text, { fg: theme.text })];
      return [
        indent(),
        run(String(n).padStart(gutterW), { fg: theme.faint }),
        run('  '),
        ...truncate(code, Math.max(4, w - gutterW - 2), '…'),
      ];
    });
    if (meta.lines.length > cap) {
      out.push([indent(), run(' '.repeat(gutterW)), run(`  …(${meta.lines.length - cap} lines)`, { fg: theme.faint })]);
    }
    return out;
  }

  if (meta.matches) {
    const out = [];
    for (const m of meta.matches.slice(0, cap)) {
      out.push([
        indent(),
        run(shorten(m.file), { fg: theme.tool }),
        run(':', { fg: theme.faint }),
        run(String(m.line), { fg: theme.dim }),
        run('  '),
        ...truncate([run(m.text.trim(), { fg: theme.text })], Math.max(4, w - 24), '…'),
      ]);
    }
    if (meta.matches.length > cap) {
      out.push([indent(), run(`…(${meta.matches.length - cap} more matches)`, { fg: theme.faint })]);
    }
    return out;
  }

  if (meta.files) {
    const out = [];
    const cols = Math.max(1, Math.floor(w / 28));
    for (let i = 0; i < Math.min(meta.files.length, cap * cols); i += cols) {
      const row = [indent()];
      for (const f of meta.files.slice(i, i + cols)) {
        row.push(...pad(truncate([run(f, { fg: f.endsWith('/') ? theme.accent : theme.text })], 26, '…'), 28));
      }
      out.push(row);
    }
    if (meta.files.length > cap * cols) {
      out.push([indent(), run(`…(${meta.files.length - cap * cols} more)`, { fg: theme.faint })]);
    }
    return out;
  }

  if (typeof meta.stdout === 'string' && meta.stdout.trim()) {
    const raw = meta.stdout.replace(/\s+$/, '').split('\n');
    const shown = raw.slice(0, cap);
    const out = shown.map((l) => [
      indent(),
      run('│ ', { fg: theme.borderDim }),
      ...truncate([run(l, { fg: theme.dim })], w - 2, '…'),
    ]);
    if (raw.length > cap) {
      out.push([indent(), run('│ ', { fg: theme.borderDim }), run(`…(${raw.length - cap} more lines)`, { fg: theme.faint })]);
    }
    return out;
  }

  if (typeof b.detail === 'string' && b.detail.trim()) {
    return b.detail.split('\n').slice(0, cap)
      .flatMap((l) => wrapText(l, w, { fg: theme.dim }))
      .map((l) => [indent(), ...l]);
  }

  return [];
}

const shorten = (p) => (p.length > 40 ? `…${p.slice(-39)}` : p);

export { GLYPH };

// ── notices ─────────────────────────────────────────────────────────────────

function renderNotice(b, { width, theme }) {
  const map = {
    info: ['ℹ', theme.info],
    warn: ['▲', theme.warn],
    error: ['✕', theme.error],
    success: ['✓', theme.success],
  };
  const [g, fg] = map[b.level] || map.info;
  const lines = wrapText(b.text, Math.max(8, width - 2), { fg }, {});
  const out = [[run(`${g} `, { fg }), ...(lines[0] || [])]];
  for (const l of lines.slice(1)) out.push([run('  '), ...l]);
  out.push([]);
  return out;
}
