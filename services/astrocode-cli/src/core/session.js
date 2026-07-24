/**
 * session.js — everything that makes up "the conversation so far".
 *
 * The transcript is a flat list of blocks rather than a message tree: streaming
 * appends to the tail block, tools push their own block, and the renderer walks
 * the list. That keeps the render path dumb and the state easy to persist.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { SESSIONS_DIR, ensureDirs } from './config.js';
import { getModel, DEFAULT_MODEL_ID } from './models.js';
import { getEffort, DEFAULT_EFFORT } from './effort.js';
import { estimateTokens, costOf } from './tokens.js';

let blockSeq = 0;
const nextBlockId = () => `b${++blockSeq}`;

export class Session {
  constructor({ cwd = process.cwd(), model, effort, id, seed } = {}) {
    this.id = id || crypto.randomUUID();
    this.cwd = cwd;
    this.startedAt = Date.now();
    this.model = getModel(model) || getModel(DEFAULT_MODEL_ID);
    this.effort = getEffort(effort) || getEffort(DEFAULT_EFFORT);
    this.seed = seed ?? (crypto.randomBytes(4).readUInt32BE(0) >>> 0);

    /** @type {Array<object>} */
    this.transcript = [];
    this.todos = [];
    /** path -> {added, removed, created} */
    this.files = new Map();
    /** modelId -> {input, output, turns} */
    this.usage = new Map();
    this.turns = 0;
    this.modelsUsed = [];      // display order = first-use order (commit trailers)
    this.title = null;
    this.dirty = false;

    this._noteModel(this.model);
  }

  // ── model / effort ────────────────────────────────────────────────────────

  _noteModel(m) {
    if (m && !this.modelsUsed.some((x) => x.id === m.id)) this.modelsUsed.push(m);
  }

  setModel(m) {
    if (!m) return this.model;
    this.model = m;
    this._noteModel(m);
    this.dirty = true;
    return m;
  }

  setEffort(e) {
    if (!e) return this.effort;
    this.effort = e;
    this.dirty = true;
    return e;
  }

  // ── transcript ────────────────────────────────────────────────────────────

  push(block) {
    const b = { id: nextBlockId(), at: Date.now(), ...block };
    this.transcript.push(b);
    this.dirty = true;
    return b;
  }

  user(text) {
    if (!this.title) this.title = deriveTitle(text);
    this.turns += 1;
    return this.push({ kind: 'user', text });
  }

  thinking() { return this.push({ kind: 'thinking', text: '', done: false }); }
  assistant() { return this.push({ kind: 'text', text: '' }); }

  tool(tool, title, describe) {
    return this.push({
      kind: 'tool', tool, title, describe,
      status: 'running', summary: '', detail: null, meta: null,
    });
  }

  notice(text, level = 'info') { return this.push({ kind: 'notice', level, text }); }
  lines(lines, opts = {}) { return this.push({ kind: 'lines', lines, ...opts }); }
  divider() { return this.push({ kind: 'divider' }); }

  /** The tail block, when it is of `kind` — used to append streaming deltas. */
  tailOf(kind) {
    const b = this.transcript[this.transcript.length - 1];
    return b && b.kind === kind ? b : null;
  }

  clear() {
    this.transcript = [];
    this.usage = new Map();
    this.turns = 0;
    this.files.clear();
    this.todos = [];
    this.title = null;
    this.dirty = true;
  }

  // ── accounting ────────────────────────────────────────────────────────────

  addUsage(modelId, input, output) {
    const cur = this.usage.get(modelId) || { input: 0, output: 0, turns: 0 };
    cur.input += input;
    cur.output += output;
    cur.turns += 1;
    this.usage.set(modelId, cur);
    this.dirty = true;
  }

  get totalTokens() {
    let n = 0;
    for (const u of this.usage.values()) n += u.input + u.output;
    return n;
  }

  /** Tokens currently "in context" — the whole transcript, as the model sees it. */
  get contextTokens() {
    let n = 400; // system preamble
    for (const b of this.transcript) {
      if (b.kind === 'user' || b.kind === 'text' || b.kind === 'thinking') {
        n += estimateTokens(b.text);
      } else if (b.kind === 'tool') {
        n += estimateTokens(b.describe) + estimateTokens(b.summary) + 24;
        if (b.meta?.stdout) n += estimateTokens(b.meta.stdout);
        if (b.meta?.lines) n += b.meta.lines.reduce((a, l) => a + estimateTokens(l.text), 0);
      }
    }
    return n;
  }

  get totalCost() {
    let usd = 0;
    for (const [id, u] of this.usage) usd += costOf(getModel(id), u.input, u.output);
    return usd;
  }

  get uptimeMs() { return Date.now() - this.startedAt; }

  // ── file tracking (drives the sidebar) ────────────────────────────────────

  trackFile(file, { added = 0, removed = 0, created = false } = {}) {
    const rel = path.isAbsolute(file) ? path.relative(this.cwd, file) : file;
    const cur = this.files.get(rel) || { added: 0, removed: 0, created: false };
    cur.added += added;
    cur.removed += removed;
    cur.created = cur.created || created;
    this.files.set(rel, cur);
    this.dirty = true;
  }

  get modifiedFiles() {
    return [...this.files.entries()]
      .map(([file, v]) => ({ file, ...v }))
      .sort((a, b) => (b.added + b.removed) - (a.added + a.removed));
  }

  // ── persistence ───────────────────────────────────────────────────────────

  toJSON() {
    return {
      version: 1,
      id: this.id,
      cwd: this.cwd,
      startedAt: this.startedAt,
      savedAt: Date.now(),
      title: this.title,
      seed: this.seed,
      model: this.model?.id,
      effort: this.effort?.id,
      turns: this.turns,
      modelsUsed: this.modelsUsed.map((m) => m.id),
      usage: Object.fromEntries(this.usage),
      files: Object.fromEntries(this.files),
      todos: this.todos,
      transcript: this.transcript.map(serialiseBlock),
    };
  }

  save() {
    if (!ensureDirs()) return { ok: false, error: 'session directory unavailable' };
    try {
      const file = path.join(SESSIONS_DIR, `${this.id}.json`);
      fs.writeFileSync(file, JSON.stringify(this.toJSON()), 'utf8');
      this.dirty = false;
      return { ok: true, path: file };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  static fromJSON(data) {
    const s = new Session({
      cwd: data.cwd, model: data.model, effort: data.effort, id: data.id, seed: data.seed,
    });
    s.startedAt = data.startedAt || Date.now();
    s.title = data.title || null;
    s.turns = data.turns || 0;
    s.transcript = (data.transcript || []).map((b) => ({ ...b }));
    s.todos = data.todos || [];
    s.usage = new Map(Object.entries(data.usage || {}));
    s.files = new Map(Object.entries(data.files || {}));
    s.modelsUsed = (data.modelsUsed || []).map(getModel).filter(Boolean);
    if (!s.modelsUsed.length && s.model) s.modelsUsed = [s.model];
    blockSeq = Math.max(blockSeq, s.transcript.length);
    return s;
  }

  static load(id) {
    try {
      const file = path.join(SESSIONS_DIR, `${id}.json`);
      return Session.fromJSON(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch {
      return null;
    }
  }

  /** Most recent sessions first. */
  static list(limit = 20) {
    try {
      return fs.readdirSync(SESSIONS_DIR)
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
          const p = path.join(SESSIONS_DIR, f);
          try {
            const d = JSON.parse(fs.readFileSync(p, 'utf8'));
            return {
              id: d.id, title: d.title, cwd: d.cwd, model: d.model,
              savedAt: d.savedAt || 0, turns: d.turns || 0,
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .sort((a, b) => b.savedAt - a.savedAt)
        .slice(0, limit);
    } catch {
      return [];
    }
  }

  static latest(cwd) {
    const all = Session.list(50);
    return all.find((s) => !cwd || s.cwd === cwd) || all[0] || null;
  }

  /** Markdown export used by /export. */
  toMarkdown() {
    const out = [
      `# Astrocode session${this.title ? ` — ${this.title}` : ''}`,
      '',
      `- **Session**: \`${this.id}\``,
      `- **Directory**: \`${this.cwd}\``,
      `- **Model**: ${this.model?.name}`,
      `- **Effort**: ${this.effort?.label}`,
      `- **Turns**: ${this.turns}`,
      '',
      '---',
      '',
    ];
    for (const b of this.transcript) {
      if (b.kind === 'user') out.push(`### You`, '', b.text, '');
      else if (b.kind === 'text') out.push(`### ${this.model?.name || 'Assistant'}`, '', b.text, '');
      else if (b.kind === 'thinking' && b.text) out.push(`<details><summary>Thinking</summary>`, '', b.text, '', '</details>', '');
      else if (b.kind === 'tool') out.push(`> \`${b.title}\` ${b.describe} — ${b.status}${b.summary ? `: ${b.summary}` : ''}`, '');
      else if (b.kind === 'notice') out.push(`> ${b.text}`, '');
    }
    out.push('---', '', `_Generated with Astrocode — Tripplet_`, '');
    return out.join('\n');
  }
}

function serialiseBlock(b) {
  // Pre-rendered Lines are display-only; drop them so saved sessions stay small
  // and re-render correctly at whatever width they are reloaded into.
  if (b.kind === 'lines') return { ...b, lines: undefined, kind: 'notice', level: 'info', text: b.text || '' };
  return b;
}

function deriveTitle(text) {
  const first = String(text).trim().split('\n')[0].replace(/\s+/g, ' ');
  return first.length > 60 ? `${first.slice(0, 57)}…` : first;
}

export default Session;
