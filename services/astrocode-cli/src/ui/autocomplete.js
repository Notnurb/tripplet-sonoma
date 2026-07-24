/**
 * autocomplete.js — the popup under the prompt.
 *
 * Two triggers: a leading `/` offers slash commands, and `@` anywhere offers
 * files from the working tree. Both resolve to a `{start, end, value}` splice
 * so the caller never has to reason about where the token began.
 */

import fs from 'node:fs';
import path from 'node:path';

import { run, pad, truncate, width as lw } from './text.js';

const IGNORE = new Set([
  '.git', 'node_modules', 'dist', 'build', '.next', '.cache', 'coverage',
  '.venv', 'venv', '__pycache__', '.DS_Store', 'target', 'vendor',
]);

// Walking the tree on every keystroke would be wasteful; 5s is short enough
// that a file you just created still shows up.
const CACHE_TTL = 5000;
let fileCache = { cwd: null, at: 0, files: [] };

export function indexFiles(cwd, { limit = 4000 } = {}) {
  const now = Date.now();
  if (fileCache.cwd === cwd && now - fileCache.at < CACHE_TTL) return fileCache.files;
  const out = [];
  const walk = (dir, depth) => {
    if (out.length >= limit || depth > 8) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory is simply not offered
    }
    for (const e of entries) {
      if (out.length >= limit) return;
      if (e.name.startsWith('.') && e.name !== '.github') continue;
      if (IGNORE.has(e.name)) continue;
      const full = path.join(dir, e.name);
      const rel = path.relative(cwd, full);
      if (e.isDirectory()) {
        out.push(`${rel}/`);
        walk(full, depth + 1);
      } else if (e.isFile()) {
        out.push(rel);
      }
    }
  };
  walk(cwd, 0);
  fileCache = { cwd, at: now, files: out };
  return out;
}

export function invalidateFileIndex() { fileCache = { cwd: null, at: 0, files: [] }; }

/**
 * @param {string} text     the whole editor buffer
 * @param {number} caret    caret offset within `text` (in code units)
 * @returns {{kind, items, start, end, query}|null}
 */
export function suggest(text, caret, { commands = [], cwd = process.cwd() } = {}) {
  const before = text.slice(0, caret);

  // Slash commands: only when `/` opens the buffer.
  const slash = /^\/([\w:-]*)$/.exec(before);
  if (slash && !text.slice(caret).includes(' ')) {
    const q = slash[1].toLowerCase();
    const items = commands
      .filter((c) => !c.hidden || q.length >= 2)
      .map((c) => ({ c, s: rank(q, c) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.c.name.localeCompare(b.c.name))
      .slice(0, 12)
      .map(({ c }) => ({
        value: `/${c.name}${c.args ? ' ' : ''}`,
        label: `/${c.name}`,
        args: c.args || '',
        desc: c.summary,
      }));
    return items.length ? { kind: 'command', items, start: 0, end: caret, query: q } : null;
  }

  // File references: `@` followed by a partial path.
  const at = /(^|\s)@([^\s]*)$/.exec(before);
  if (at) {
    const q = at[2];
    const start = caret - q.length - 1;
    const files = indexFiles(cwd);
    const ql = q.toLowerCase();
    const items = files
      .map((f) => ({ f, s: q ? rankPath(ql, f.toLowerCase()) : (f.includes('/') ? 1 : 2) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.f.length - b.f.length)
      .slice(0, 12)
      .map(({ f }) => ({
        value: `@${f}`,
        label: f,
        args: '',
        desc: f.endsWith('/') ? 'directory' : '',
      }));
    return items.length ? { kind: 'file', items, start, end: caret, query: q } : null;
  }

  return null;
}

function scoreName(q, name) {
  const t = String(name).toLowerCase();
  if (t === q) return 100;
  if (t.startsWith(q)) return 60 - t.length;
  if (t.includes(q)) return 30 - t.length;
  if (isSubsequence(q, t)) return 10;
  return 0;
}

// An alias match is real but weaker than the command's own name, so typing
// "mod" offers /model before /permissions (whose alias happens to be "mode").
const ALIAS_PENALTY = 8;

function rank(q, c) {
  if (!q) return 1;
  let best = scoreName(q, c.name);
  for (const a of c.aliases || []) {
    const s = scoreName(q, a);
    if (s > 0) best = Math.max(best, s - ALIAS_PENALTY);
  }
  return best;
}

function rankPath(q, f) {
  const base = f.slice(f.lastIndexOf('/') + 1);
  if (base.startsWith(q)) return 80 - base.length * 0.1;
  if (f.startsWith(q)) return 70;
  if (base.includes(q)) return 40;
  if (f.includes(q)) return 25;
  if (isSubsequence(q, base)) return 12;
  if (isSubsequence(q, f)) return 5;
  return 0;
}

function isSubsequence(q, t) {
  let i = 0;
  for (const c of t) if (c === q[i]) i++;
  return i === q.length;
}

/**
 * Render the popup. Two aligned columns, like the Claude Code command list.
 * @returns {Line[]}
 */
export function renderSuggestions(sug, { width, theme, selected = 0, max = 8 }) {
  if (!sug) return [];
  const items = sug.items;
  const start = Math.max(0, Math.min(selected - max + 1, items.length - max));
  const view = items.slice(Math.max(0, start), Math.max(0, start) + max);

  const labelW = Math.min(
    28,
    Math.max(...view.map((i) => lw([run(i.label + (i.args ? ` ${i.args}` : ''), {})]))) + 2,
  );

  const out = [];
  for (let i = 0; i < view.length; i++) {
    const it = view[i];
    const idx = Math.max(0, start) + i;
    const on = idx === selected;
    const bg = on ? theme.selection : undefined;
    const nameFg = on
      ? (theme.rainbow ? theme.pulse(i * 20) : theme.primary)
      : theme.text;
    const head = [
      run(on ? '❯ ' : '  ', { fg: on ? nameFg : theme.faint, bg }),
      run(it.label, { fg: nameFg, bold: on, bg }),
      ...(it.args ? [run(` ${it.args}`, { fg: theme.faint, bg })] : []),
    ];
    const desc = truncate([run(it.desc || '', { fg: on ? theme.dim : theme.faint, bg })],
      Math.max(4, width - labelW - 2), '…');
    out.push([...pad(head, labelW + 2, bg ? { bg } : undefined), ...pad(desc, Math.max(0, width - labelW - 2), bg ? { bg } : undefined)]);
  }

  if (items.length > view.length) {
    out.push([run(`  ${items.length - view.length} more…`, { fg: theme.faint })]);
  }
  return out;
}

/** Splice an accepted suggestion back into the buffer. */
export function applySuggestion(text, sug, item) {
  return {
    text: text.slice(0, sug.start) + item.value + text.slice(sug.end),
    caret: sug.start + item.value.length,
  };
}
