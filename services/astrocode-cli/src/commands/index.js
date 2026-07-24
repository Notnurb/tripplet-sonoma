/**
 * commands/index.js — every slash command, in one registry.
 *
 * A command never touches the terminal directly: it builds `Line[]` and hands
 * them to `ctx.print`, so the app decides whether that lands in the transcript,
 * a headless log or a test buffer. Nothing here calls `process.exit` either —
 * `/quit` asks the app to unwind via `ctx.quit()` so the alt-screen is restored.
 *
 * The session/app objects are read defensively (`??` chains) because a command
 * may run before the engine has ever produced a turn, and in headless mode there
 * is no `app` at all.
 */

import fs from 'node:fs/promises';
import { constants as FS } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { MODELS, DEFAULT_MODEL_ID, getModel, resolveModel, describeModel } from '../core/models.js';
import { EFFORTS, DEFAULT_EFFORT, getEffort, resolveEffort, cycleEffort } from '../core/effort.js';
import * as git from '../git/git.js';
import { makeCommit, summariseChanges } from '../git/commit.js';
import { drawBox, ruleHeader, rule } from '../ui/box.js';
import {
  run, width as lineWidth, strWidth, pad, padStart, truncate, wrapText, getDepth, DEPTH,
} from '../ui/text.js';
import { renderDiff } from '../ui/diffview.js';
import { renderMarkdown } from '../ui/markdown.js';
import { themeList } from '../ui/theme.js';

const execFileP = promisify(execFile);

// ── shared constants ────────────────────────────────────────────────────────

/** Order of the sections in `/help`. */
const GROUPS = ['Account', 'Session', 'Model', 'Project', 'Git', 'System'];

/** Tools are described by `describe(input)`, which needs an input — so the
 *  registry listing carries its own one-liners. */
const TOOL_BLURBS = {
  read: 'Read a file from disk, with line numbers',
  write: 'Create or overwrite a file',
  edit: 'Replace an exact string inside a file',
  multiedit: 'Apply several edits to one file, all or nothing',
  bash: 'Run a shell command in the working directory',
  ls: 'List one directory level',
  glob: 'Find files by glob pattern, newest first',
  grep: 'Search file contents with a regular expression',
  todo: 'Track the task list for the current turn',
};

const PERMISSION_MODES = [
  { id: 'ask', desc: 'Reads run freely; every write, edit or command asks first.' },
  { id: 'acceptEdits', desc: 'File edits are auto-approved; shell commands still ask.' },
  { id: 'plan', desc: 'Read-only. Every mutating tool is denied — good for exploring.' },
  { id: 'yolo', desc: 'Everything is approved, except the hard-denied destructive commands.' },
];

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_PATH = path.resolve(HERE, '..', '..', 'package.json');

const ok = (message) => ({ ok: true, message });
const fail = (message) => ({ ok: false, message });

// ── tiny helpers ────────────────────────────────────────────────────────────

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function argsOf(argv) {
  if (Array.isArray(argv)) return argv.map((a) => String(a)).filter((a) => a.length > 0);
  if (typeof argv === 'string') return argv.split(/\s+/).filter(Boolean);
  return [];
}

/** A blank Line — an explicit empty run, so `print` never sees an ambiguous []. */
const blank = () => [run('')];

/**
 * Every command that takes one of a fixed set of values behaves the same way:
 * given the value, apply it; given nothing (or something invalid), let the user
 * arrow through the options.
 *
 * Falls back to printing the list when there is no interactive picker attached
 * — headless runs and tests still get something useful.
 *
 * @param {object} ctx
 * @param {object} o  {title, items:[{label,value,desc,color,current}], footer, printList}
 * @returns {Promise<*|null>} the chosen value, or null if cancelled/unavailable
 */
async function pick(ctx, { title, items, footer, printList }) {
  if (typeof ctx.select === 'function' && items.length) {
    return ctx.select({ title, items, footer });
  }
  if (typeof printList === 'function') printList();
  return null;
}

/** True when this session can show an arrow-key picker. */
const canPick = (ctx) => typeof ctx.select === 'function';

function viewWidth(ctx, max = 96) {
  const raw = ctx?.app?.width ?? ctx?.app?.cols ?? ctx?.app?.screen?.cols ?? process.stdout?.columns;
  const n = Number.isFinite(Number(raw)) && Number(raw) > 0 ? Number(raw) : 80;
  return Math.max(32, Math.min(max, n - 2));
}

function cwdOf(ctx) {
  return ctx?.cwd || ctx?.session?.cwd || process.cwd();
}

function tildify(p) {
  const home = os.homedir();
  if (home && p.startsWith(home)) return `~${p.slice(home.length)}`;
  return p;
}

function inside(target, root) {
  const r = path.resolve(root);
  const t = path.resolve(target);
  return t === r || t.startsWith(r + path.sep);
}

function currentModel(ctx) {
  const m = ctx?.session?.model ?? ctx?.config?.model ?? ctx?.app?.model;
  if (m && typeof m === 'object' && m.id) return m;
  return getModel(m) || getModel(DEFAULT_MODEL_ID);
}

function currentEffort(ctx) {
  const e = ctx?.session?.effort ?? ctx?.config?.effort ?? ctx?.app?.effort;
  if (e && typeof e === 'object' && e.id) return e;
  return getEffort(e) || getEffort(DEFAULT_EFFORT);
}

function transcript(ctx) {
  const s = ctx?.session || {};
  const t = s.messages ?? s.transcript ?? s.history ?? [];
  return Array.isArray(t) ? t : [];
}

function messageRole(m) {
  if (typeof m === 'string') return 'note';
  return String(m?.role ?? m?.type ?? m?.kind ?? 'note').toLowerCase();
}

function messageText(m) {
  if (typeof m === 'string') return m;
  const v = m?.text ?? m?.markdown ?? m?.content ?? m?.body ?? '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    return v.map((p) => (typeof p === 'string' ? p : String(p?.text ?? ''))).join('');
  }
  return '';
}

/** True when `usage` is keyed by model id rather than being flat totals. */
function isPerModel(u) {
  if (u instanceof Map) return true;
  if (!u || typeof u !== 'object') return false;
  const values = Object.values(u);
  return values.length > 0 && values.every((v) => v && typeof v === 'object' &&
    ('input' in v || 'output' in v || 'inputTokens' in v || 'outputTokens' in v));
}

function usageOf(ctx) {
  const raw = ctx?.session?.usage ?? {};
  if (isPerModel(raw)) {
    // Session.usage is a Map of modelId -> {input, output}; sum it.
    const entries = raw instanceof Map ? [...raw.values()] : Object.values(raw);
    const input = entries.reduce((a, v) => a + num(v.input ?? v.inputTokens), 0);
    const output = entries.reduce((a, v) => a + num(v.output ?? v.outputTokens), 0);
    return { input, output, total: input + output };
  }
  const input = num(raw.input ?? raw.inputTokens ?? raw.prompt);
  const output = num(raw.output ?? raw.outputTokens ?? raw.completion);
  const total = num(raw.total) || input + output;
  return { input, output, total };
}

/** Per-model token totals; falls back to attributing everything to the current model. */
function usageByModel(ctx) {
  const s = ctx?.session || {};
  const src = s.usageByModel ?? s.byModel ?? (isPerModel(s.usage) ? s.usage : null);
  const rows = [];
  if (src) {
    const entries = src instanceof Map ? [...src.entries()] : Object.entries(src);
    for (const [id, u] of entries) {
      const m = getModel(id);
      if (!m || !u || typeof u !== 'object') continue;
      rows.push({
        model: m,
        input: num(u.input ?? u.inputTokens),
        output: num(u.output ?? u.outputTokens),
      });
    }
  }
  if (!rows.length) {
    const u = usageOf(ctx);
    if (u.input || u.output) rows.push({ model: currentModel(ctx), input: u.input, output: u.output });
  }
  return rows;
}

function costOf(model, input, output) {
  const p = model?.pricing || { input: 0, output: 0 };
  return (input / 1e6) * num(p.input) + (output / 1e6) * num(p.output);
}

/** Models used this session, in first-use order. */
function modelsUsed(ctx) {
  const s = ctx?.session || {};
  const raw = s.modelsUsed ?? s.models ?? null;
  const out = [];
  const push = (v) => {
    const m = typeof v === 'object' && v?.id ? v : getModel(v);
    if (m && !out.includes(m)) out.push(m);
  };
  if (Array.isArray(raw)) raw.forEach(push);
  else if (raw instanceof Set) [...raw].forEach(push);
  else if (raw instanceof Map) [...raw.keys()].forEach(push);
  if (!out.length) push(currentModel(ctx));
  return out;
}

function filesTouched(ctx) {
  const s = ctx?.session || {};
  const holder = s.files ?? s.fileTracker ?? ctx?.app?.fileTracker ?? null;
  if (!holder) return [];
  const raw = holder.files ?? holder.touched ?? holder.entries ?? holder;
  const out = [];
  if (raw instanceof Map) out.push(...[...raw.keys()].map(String));
  else if (raw instanceof Set) out.push(...[...raw].map(String));
  else if (Array.isArray(raw)) out.push(...raw.map((k) => (typeof k === 'string' ? k : String(k?.path ?? ''))));
  else if (raw && Object.getPrototypeOf(raw) === Object.prototype) out.push(...Object.keys(raw));
  return out.filter(Boolean);
}

function todosOf(ctx) {
  const t = ctx?.session?.todos;
  return Array.isArray(t) ? t : [];
}

function toolList(ctx) {
  const t = ctx?.tools;
  if (!t) return [];
  const isTool = (v) => v && typeof v === 'object' && typeof v.run === 'function' && v.name;
  if (Array.isArray(t)) return t.filter(isTool);
  if (t instanceof Map) return [...t.values()].filter(isTool);
  if (t.TOOLS && typeof t.TOOLS === 'object') return Object.values(t.TOOLS).filter(isTool);
  return Object.values(t).filter(isTool);
}

function startedAt(ctx) {
  const s = ctx?.session || {};
  const v = s.startedAt ?? s.createdAt ?? s.start ?? s.began;
  const n = v instanceof Date ? v.getTime() : num(v);
  if (n > 0) return n;
  return Date.now() - Math.round(process.uptime() * 1000);
}

// ── formatting ──────────────────────────────────────────────────────────────

function fmtTokens(n) {
  const v = num(n);
  if (v <= 0) return '0';
  if (v < 1000) return String(Math.round(v));
  if (v < 1_000_000) return `${(v / 1000).toFixed(v < 10_000 ? 2 : 1)}k`;
  return `${(v / 1_000_000).toFixed(2)}M`;
}

function fmtUsd(n) {
  const v = num(n);
  if (v === 0) return '$0.00';
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

function fmtDuration(ms) {
  const s = Math.max(0, Math.round(num(ms) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

function fmtBytes(n) {
  const v = num(n);
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / 1024 / 1024).toFixed(1)} MB`;
}

const fmtCtx = (n) => (n >= 1_000_000 ? `${n / 1_000_000}M` : `${Math.round(n / 1000)}K`);

// ── layout helpers ──────────────────────────────────────────────────────────

/**
 * Aligned two-column rows — the shape `/help` and `/status` share.
 * `left` may be a string or a Line so a command name and its `<args>` can be
 * styled differently while still measuring as one column.
 */
function columnRows(items, w, theme, opts = {}) {
  const indent = opts.indent ?? 2;
  const gap = opts.gap ?? 2;
  const maxLeft = opts.maxLeft ?? 26;
  const leftStyle = opts.leftStyle ?? { fg: theme?.primary };
  const rightStyle = opts.rightStyle ?? { fg: theme?.dim };

  const lines = items.map((it) => (Array.isArray(it.left) ? it.left : [run(it.left, it.leftStyle ?? leftStyle)]));
  const leftW = Math.min(maxLeft, lines.reduce((a, l) => Math.max(a, lineWidth(l)), 0));
  const rightW = Math.max(12, w - indent - leftW - gap);

  const rows = [];
  items.forEach((it, i) => {
    const left = pad(truncate(lines[i], leftW), leftW);
    const text = it.right ?? '';
    const wrapped = Array.isArray(text) ? [text] : wrapText(String(text), rightW, it.rightStyle ?? rightStyle);
    wrapped.forEach((l, j) => {
      rows.push(j === 0
        ? [run(' '.repeat(indent)), ...left, run(' '.repeat(gap)), ...l]
        : [run(' '.repeat(indent + leftW + gap)), ...l]);
    });
  });
  return rows;
}

function heading(label, w, theme) {
  return ruleHeader(label, w, { theme, labelFg: theme?.accent, bold: true });
}

function note(text, w, theme, style) {
  return wrapText(text, w, style ?? { fg: theme?.faint });
}

/** A tick/cross/warn glyph row for `/doctor`. */
function checkRow(status, label, detail, theme) {
  const g = status === 'ok' ? '✔' : status === 'warn' ? '!' : '✘';
  const fg = status === 'ok' ? theme?.success : status === 'warn' ? theme?.warn : theme?.error;
  return [
    run('  '), run(g, { fg, bold: true }), run('  '),
    ...pad([run(label, { fg: theme?.text })], 22),
    run(String(detail ?? ''), { fg: theme?.dim }),
  ];
}

// ── /help ───────────────────────────────────────────────────────────────────

async function cmdHelp(ctx, argv) {
  const theme = ctx.theme;
  const w = viewWidth(ctx);
  const args = argsOf(argv);
  const out = [];

  if (args.length) {
    const c = getCommand(args[0]);
    if (!c) return fail(`No command \`/${args[0]}\` — try /commands for the full list.`);
    out.push(heading(`/${c.name}`, w, theme), blank());
    out.push(...note(c.summary, w - 2, theme, { fg: theme.text }).map((l) => [run('  '), ...l]));
    out.push(blank());
    const rows = [
      { left: 'usage', right: `/${c.name}${c.args ? ` ${c.args}` : ''}` },
    ];
    if (c.aliases?.length) rows.push({ left: 'aliases', right: c.aliases.map((a) => `/${a}`).join(', ') });
    rows.push({ left: 'group', right: c.group ?? 'System' });
    out.push(...columnRows(rows, w, theme, { maxLeft: 10, leftStyle: { fg: theme.dim } }));
    ctx.print(out);
    return ok(`/${c.name}`);
  }

  out.push(heading('Astrocode commands', w, theme));
  const visible = COMMANDS.filter((c) => !c.hidden);
  for (const group of GROUPS) {
    const inGroup = visible.filter((c) => (c.group ?? 'System') === group);
    if (!inGroup.length) continue;
    out.push(blank());
    out.push([run('  '), run(group, { fg: theme.accent, bold: true })]);
    out.push(...columnRows(inGroup.map((c) => ({
      left: [
        run(`/${c.name}`, { fg: theme.primary }),
        ...(c.args ? [run(` ${c.args}`, { fg: theme.faint })] : []),
      ],
      right: c.summary,
    })), w, theme, { indent: 4, gap: 2, maxLeft: 24 }));
  }
  out.push(blank());
  out.push(...note(
    'Type / at an empty prompt for autocomplete, or /help <command> for detail. '
    + 'Anything that is not a command is sent to the model.',
    w - 2, theme,
  ).map((l) => [run('  '), ...l]));
  ctx.print(out);
  return ok(`${visible.length} commands`);
}

// ── /model ──────────────────────────────────────────────────────────────────

/** Apply a model and confirm it. Shared by the picker and the direct form. */
function applyModel(ctx, picked) {
  const theme = ctx.theme;
  if (typeof ctx.setModel === 'function') ctx.setModel(picked);
  else if (ctx.session) ctx.session.model = picked;
  if (ctx.config && typeof ctx.config === 'object') ctx.config.model = picked.id;

  ctx.print([[
    run('Model  ', { fg: theme.dim }),
    run(picked.name, { fg: picked.accent, bold: true }),
    run('  ', {}),
    run(describeModel(picked).split(' · ').slice(1).join(' · '), { fg: theme.faint }),
  ]]);
  return ok(`Model set to ${picked.name}`);
}

async function cmdModel(ctx, argv) {
  const theme = ctx.theme;
  const w = viewWidth(ctx);
  const args = argsOf(argv);
  const active = currentModel(ctx);

  const listItems = () => MODELS.map((m) => ({
    label: m.name,
    value: m.id,
    color: m.accent,
    current: m.id === active?.id,
    desc: `${fmtCtx(m.context)} ctx · $${m.pricing.input}/$${m.pricing.output} · ${m.tagline}`,
  }));

  if (!args.length) {
    if (canPick(ctx)) {
      const chosen = await pick(ctx, { title: 'Select a model', items: listItems() });
      if (!chosen) return ok('unchanged');
      return applyModel(ctx, getModel(chosen));
    }
    const out = [heading('Models', w, theme), blank()];
    MODELS.forEach((m, i) => {
      const on = m.id === active?.id;
      out.push([
        run('  '),
        run(on ? '●' : '○', { fg: on ? m.accent : theme.faint }),
        run(' '),
        run(String(i + 1), { fg: theme.faint }),
        run('  '),
        ...pad([run(m.name, { fg: on ? m.accent : theme.text, bold: on })], 16),
        run(`${fmtCtx(m.context)} ctx`, { fg: theme.dim }),
        run('  ·  ', { fg: theme.faint }),
        run(`$${m.pricing.input}/$${m.pricing.output} per Mtok`, { fg: theme.dim }),
      ]);
      out.push(...wrapText(m.tagline, w - 8, { fg: theme.faint }).map((l) => [run('        '), ...l]));
    });
    out.push(blank());
    out.push(...note('Switch with /model <name> or /model <number> — e.g. /model taipei, /model 3.', w - 2, theme)
      .map((l) => [run('  '), ...l]));
    ctx.print(out);
    return ok(active ? active.name : 'no model selected');
  }

  const query = args.join(' ');
  let picked;
  if (/^\d+$/.test(query)) picked = MODELS[Number(query) - 1];
  if (!picked) {
    const { model, suggestions } = resolveModel(query);
    if (!model) {
      ctx.print([[run('Unknown model ', { fg: theme.error }), run(query, { fg: theme.error, bold: true })]]);
      // Rather than dead-ending on a typo, offer the list to arrow through.
      if (canPick(ctx)) {
        const chosen = await pick(ctx, { title: 'Select a model', items: listItems() });
        if (!chosen) return fail(`Unknown model: ${query}`);
        return applyModel(ctx, getModel(chosen));
      }
      const list = suggestions.length ? suggestions : MODELS;
      ctx.print([blank(),
        ...columnRows(list.map((m) => ({ left: m.name, right: m.aliases.slice(0, 3).join(', ') })), w, theme)]);
      return fail(`Unknown model: ${query}`);
    }
    picked = model;
  }
  return applyModel(ctx, picked);
}

// ── /effort ─────────────────────────────────────────────────────────────────

/** Apply an effort level and confirm it. */
function applyEffort(ctx, picked) {
  const theme = ctx.theme;
  if (typeof ctx.setEffort === 'function') ctx.setEffort(picked);
  else if (ctx.session) ctx.session.effort = picked;
  if (ctx.config && typeof ctx.config === 'object') ctx.config.effort = picked.id;

  ctx.print([[
    run('Effort  ', { fg: theme.dim }),
    run(picked.glyph, { fg: picked.color }),
    run(' '),
    run(picked.label, { fg: picked.color, bold: true }),
    run('   '),
    run(picked.tagline, { fg: theme.faint }),
  ]]);
  return ok(`Effort set to ${picked.id}`);
}

async function cmdEffort(ctx, argv) {
  const theme = ctx.theme;
  const w = viewWidth(ctx);
  const args = argsOf(argv);
  const active = currentEffort(ctx);

  const listItems = () => EFFORTS.map((e) => ({
    label: `${e.glyph} ${e.label}`,
    value: e.id,
    color: e.color,
    current: e.id === active?.id,
    desc: e.tagline,
  }));

  if (!args.length) {
    if (canPick(ctx)) {
      const chosen = await pick(ctx, { title: 'Select reasoning effort', items: listItems() });
      if (!chosen) return ok('unchanged');
      return applyEffort(ctx, getEffort(chosen));
    }
    const out = [heading('Reasoning effort', w, theme), blank()];
    for (const e of EFFORTS) {
      const on = e.id === active?.id;
      out.push([
        run('  '),
        run(on ? '●' : '○', { fg: on ? e.color : theme.faint }),
        run('  '),
        run(e.glyph, { fg: e.color }),
        run(' '),
        ...pad([run(e.label, { fg: on ? e.color : theme.text, bold: on })], 10),
        run(e.tagline, { fg: theme.dim }),
      ]);
    }
    out.push(blank());
    out.push(...note('Set with /effort <level>, or step with /effort up | /effort down.', w - 2, theme)
      .map((l) => [run('  '), ...l]));
    ctx.print(out);
    return ok(active ? active.id : DEFAULT_EFFORT);
  }

  const word = args[0].toLowerCase();
  let picked;
  if (word === 'up' || word === '+' || word === 'more') picked = cycleEffort(active?.id, 1);
  else if (word === 'down' || word === '-' || word === 'less') picked = cycleEffort(active?.id, -1);
  else {
    const { effort, suggestions } = resolveEffort(word);
    if (!effort) {
      ctx.print([[run('Unknown effort ', { fg: theme.error }), run(word, { fg: theme.error, bold: true })]]);
      if (canPick(ctx)) {
        const chosen = await pick(ctx, { title: 'Select reasoning effort', items: listItems() });
        if (!chosen) return fail(`Unknown effort: ${word}`);
        return applyEffort(ctx, getEffort(chosen));
      }
      ctx.print([[run('  levels: ', { fg: theme.dim }),
        run(suggestions.map((e) => e.id).join(', '), { fg: theme.text })]]);
      return fail(`Unknown effort: ${word}`);
    }
    picked = effort;
  }
  return applyEffort(ctx, picked);
}

// ── /clear + /compact ───────────────────────────────────────────────────────

function resetCounters(ctx) {
  const s = ctx?.session;
  if (!s) return;
  if (s.usage && typeof s.usage === 'object') s.usage = { input: 0, output: 0, total: 0 };
  if (s.usageByModel instanceof Map) s.usageByModel.clear();
  else if (s.usageByModel && typeof s.usageByModel === 'object') s.usageByModel = {};
  if (typeof s.cost === 'number') s.cost = 0;
}

async function cmdClear(ctx) {
  const s = ctx.session;
  if (s) {
    if (Array.isArray(s.messages)) s.messages.length = 0;
    if (Array.isArray(s.transcript)) s.transcript.length = 0;
    if (Array.isArray(s.history)) s.history.length = 0;
  }
  resetCounters(ctx);
  if (typeof ctx.clear === 'function') ctx.clear();
  ctx.print([[run('Transcript cleared. Token counters reset.', { fg: ctx.theme.dim })]]);
  return ok('cleared');
}

function synthesiseSummary(ctx) {
  const msgs = transcript(ctx);
  const users = msgs.filter((m) => messageRole(m) === 'user');
  const assistants = msgs.filter((m) => ['assistant', 'model', 'agent'].includes(messageRole(m)));
  const tools = new Map();
  for (const m of msgs) {
    const name = m?.tool ?? (messageRole(m) === 'tool' ? m?.name : null);
    if (!name) continue;
    tools.set(String(name), (tools.get(String(name)) ?? 0) + 1);
  }
  const files = filesTouched(ctx);
  const todos = todosOf(ctx);
  const clip = (t, n) => {
    const flat = String(t).replace(/\s+/g, ' ').trim();
    return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
  };

  const md = [];
  md.push('## Conversation summary', '');
  if (users.length) md.push(`**Goal.** ${clip(messageText(users[0]), 240)}`, '');
  md.push('**What happened**', '');
  md.push(`- ${msgs.length} messages (${users.length} from you, ${assistants.length} from the model)`);
  if (tools.size) {
    md.push(`- Tools: ${[...tools.entries()].map(([k, v]) => `${k}×${v}`).join(', ')}`);
  }
  if (files.length) {
    md.push(`- Files touched: ${files.slice(0, 8).map((f) => `\`${f}\``).join(', ')}${files.length > 8 ? ` +${files.length - 8} more` : ''}`);
  }
  const last = assistants[assistants.length - 1];
  if (last) md.push('', '**Where we left off**', '', clip(messageText(last), 500));
  const open = todos.filter((t) => t.status !== 'completed');
  if (open.length) {
    md.push('', '**Open items**', '');
    for (const t of open) md.push(`- [ ] ${t.content}${t.status === 'in_progress' ? ' _(in progress)_' : ''}`);
  }
  return md.join('\n');
}

async function cmdCompact(ctx) {
  const theme = ctx.theme;
  const w = viewWidth(ctx);
  const s = ctx.session || {};
  const summary = synthesiseSummary(ctx);

  // Spreading a Map yields {}, so snapshot by kind rather than by shape.
  const snapshot = (v) => {
    if (v instanceof Map) return new Map(v);
    if (v && typeof v === 'object') return { ...v };
    return null;
  };
  const usageSnap = snapshot(s.usage);
  const byModelSnap = snapshot(s.usageByModel);
  const turnsSnap = s.turns;

  const entry = { role: 'summary', kind: 'summary', text: summary, content: summary, at: Date.now() };
  if (typeof ctx.app?.compact === 'function') {
    ctx.app.compact(summary);
  } else {
    if (Array.isArray(s.messages)) s.messages.splice(0, s.messages.length, entry);
    if (Array.isArray(s.transcript)) s.transcript.splice(0, s.transcript.length, entry);
    if (typeof ctx.clear === 'function') ctx.clear();
  }
  s.summary = summary;
  // /compact keeps the counters — restore whatever the app's clear may have wiped
  if (usageSnap) s.usage = usageSnap;
  if (byModelSnap) s.usageByModel = byModelSnap;
  if (typeof turnsSnap === 'number') s.turns = turnsSnap;
  // ctx.clear() may have emptied the transcript entirely; the summary is the
  // whole point of /compact, so make sure it survives.
  if (Array.isArray(s.transcript) && !s.transcript.length) s.transcript.push(entry);

  const body = renderMarkdown(summary, w - 4, theme);
  ctx.print(drawBox(body, { width: w, theme, title: 'Compacted', footer: 'context preserved' }));
  return ok('compacted');
}

// ── /init ───────────────────────────────────────────────────────────────────

const CODE_LANGS = {
  '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.jsx': 'JavaScript (JSX)',
  '.ts': 'TypeScript', '.tsx': 'TypeScript (TSX)', '.py': 'Python', '.go': 'Go', '.rs': 'Rust',
  '.rb': 'Ruby', '.java': 'Java', '.kt': 'Kotlin', '.swift': 'Swift', '.c': 'C', '.h': 'C',
  '.cc': 'C++', '.cpp': 'C++', '.hpp': 'C++', '.cs': 'C#', '.php': 'PHP', '.sh': 'Shell',
  '.bash': 'Shell', '.zsh': 'Shell', '.sql': 'SQL', '.css': 'CSS', '.scss': 'SCSS',
  '.html': 'HTML', '.vue': 'Vue', '.svelte': 'Svelte', '.lua': 'Lua', '.ex': 'Elixir',
  '.exs': 'Elixir', '.zig': 'Zig', '.dart': 'Dart', '.scala': 'Scala', '.hs': 'Haskell',
  '.pl': 'Perl', '.r': 'R', '.m': 'Objective-C',
};
const DOC_LANGS = { '.md': 'Markdown', '.json': 'JSON', '.yml': 'YAML', '.yaml': 'YAML', '.toml': 'TOML' };
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'coverage', '.cache', 'vendor', 'target', '__pycache__', '.venv', 'venv']);

async function readdirSafe(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    // unreadable directory (permissions, race with a delete) — treat as empty
    void err;
    return [];
  }
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    // missing or malformed manifest — callers treat null as "not present"
    void err;
    return null;
  }
}

async function exists(p) {
  try {
    await fs.access(p, FS.F_OK);
    return true;
  } catch (err) {
    void err;
    return false;
  }
}

/** Shallow-ish repo scan used by /init and /doctor. */
async function scanProject(cwd) {
  const scan = {
    dir: cwd,
    name: path.basename(cwd),
    version: null,
    description: '',
    manifest: null,
    manager: null,
    scripts: [],
    languages: [],
    entries: [],
    dirs: [],
    deps: [],
    devDeps: [],
    engines: null,
    esm: false,
    fileCount: 0,
    git: null,
  };

  const top = (await readdirSafe(cwd)).map((d) => d.name);
  const has = (f) => top.includes(f);

  const pkg = has('package.json') ? await readJson(path.join(cwd, 'package.json')) : null;
  if (pkg) {
    scan.manifest = 'package.json';
    scan.name = pkg.name || scan.name;
    scan.version = pkg.version || null;
    scan.description = pkg.description || '';
    scan.esm = pkg.type === 'module';
    scan.engines = pkg.engines?.node || null;
    scan.scripts = Object.entries(pkg.scripts || {});
    scan.deps = Object.keys(pkg.dependencies || {});
    scan.devDeps = Object.keys(pkg.devDependencies || {});
    if (pkg.main) scan.entries.push({ path: pkg.main, why: 'main' });
    if (typeof pkg.bin === 'string') scan.entries.push({ path: pkg.bin, why: 'bin' });
    else if (pkg.bin) for (const [k, v] of Object.entries(pkg.bin)) scan.entries.push({ path: v, why: `bin: ${k}` });
    scan.manager = has('bun.lockb') ? 'bun'
      : has('pnpm-lock.yaml') ? 'pnpm'
        : has('yarn.lock') ? 'yarn'
          : 'npm';
  } else if (has('pyproject.toml')) {
    scan.manifest = 'pyproject.toml';
    scan.manager = has('poetry.lock') ? 'poetry' : has('uv.lock') ? 'uv' : 'pip';
  } else if (has('requirements.txt')) {
    scan.manifest = 'requirements.txt';
    scan.manager = 'pip';
  } else if (has('Cargo.toml')) {
    scan.manifest = 'Cargo.toml';
    scan.manager = 'cargo';
  } else if (has('go.mod')) {
    scan.manifest = 'go.mod';
    scan.manager = 'go';
  } else if (has('Gemfile')) {
    scan.manifest = 'Gemfile';
    scan.manager = 'bundler';
  }

  for (const c of ['index.js', 'main.py', 'main.go', 'src/main.rs', 'src/index.ts', 'src/index.js', 'app.py', 'Makefile']) {
    if (await exists(path.join(cwd, c))) scan.entries.push({ path: c, why: 'entry' });
  }
  const seen = new Set();
  scan.entries = scan.entries.filter((e) => e.path && !seen.has(e.path) && seen.add(e.path));

  // walk for language counts + per-directory file counts
  const counts = new Map();
  const dirCounts = new Map();
  const stack = [{ dir: cwd, depth: 0, top: null }];
  while (stack.length && scan.fileCount < 6000) {
    const cur = stack.pop();
    for (const ent of await readdirSafe(cur.dir)) {
      if (ent.name.startsWith('.') && ent.name !== '.github') continue;
      const full = path.join(cur.dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        if (cur.depth < 4) stack.push({ dir: full, depth: cur.depth + 1, top: cur.top ?? ent.name });
      } else if (ent.isFile()) {
        scan.fileCount++;
        const ext = path.extname(ent.name).toLowerCase();
        const lang = CODE_LANGS[ext] || DOC_LANGS[ext];
        if (lang) counts.set(lang, (counts.get(lang) ?? 0) + 1);
        const bucket = cur.top ?? '.';
        dirCounts.set(bucket, (dirCounts.get(bucket) ?? 0) + 1);
      }
    }
  }
  const codeOnly = [...counts.entries()].filter(([l]) => Object.values(CODE_LANGS).includes(l));
  const ranked = (codeOnly.length ? codeOnly : [...counts.entries()]).sort((a, b) => b[1] - a[1]);
  scan.languages = ranked.slice(0, 5).map(([lang, n]) => ({ lang, count: n }));
  scan.dirs = [...dirCounts.entries()].filter(([d]) => d !== '.').sort((a, b) => b[1] - a[1]).slice(0, 10);

  const branch = await git.branch(cwd).catch(() => null);
  if (branch) scan.git = { branch };
  return scan;
}

function astroMarkdown(scan) {
  const L = [];
  const date = new Date().toISOString().slice(0, 10);
  L.push('# ASTRO.md');
  L.push('');
  L.push('Working notes for **' + scan.name + '**, generated by `/init` on ' + date + '.');
  L.push('Astrocode reads this file at the start of every session — keep it short and true.');
  L.push('');
  L.push('## Overview');
  L.push('');
  if (scan.description) L.push(scan.description, '');
  if (scan.languages.length) {
    L.push('- **Languages:** ' + scan.languages.map((l) => l.lang + ' (' + l.count + ')').join(', '));
  }
  L.push('- **Files tracked:** ' + scan.fileCount);
  if (scan.manifest) L.push('- **Manifest:** `' + scan.manifest + '`' + (scan.version ? ' (v' + scan.version + ')' : ''));
  if (scan.manager) L.push('- **Package manager:** ' + scan.manager);
  if (scan.engines) L.push('- **Node:** ' + scan.engines);
  if (scan.manifest === 'package.json') L.push('- **Modules:** ' + (scan.esm ? 'ESM (`import`/`export`)' : 'CommonJS (`require`)'));
  if (scan.git?.branch) L.push('- **Git branch:** `' + scan.git.branch + '`');
  L.push('');

  if (scan.scripts.length) {
    L.push('## Commands');
    L.push('');
    L.push('| Task | Command |');
    L.push('| --- | --- |');
    const runner = scan.manager === 'npm' ? 'npm run' : (scan.manager || 'npm') + ' run';
    for (const [name, body] of scan.scripts.slice(0, 12)) {
      const invoke = name === 'test' || name === 'start' ? (scan.manager || 'npm') + ' ' + name : runner + ' ' + name;
      L.push('| `' + name + '` | `' + invoke + '` — ' + String(body).replace(/\|/g, '\\|') + ' |');
    }
    L.push('');
  }

  if (scan.entries.length) {
    L.push('## Entry points');
    L.push('');
    for (const e of scan.entries.slice(0, 8)) L.push('- `' + e.path + '` — ' + e.why);
    L.push('');
  }

  if (scan.dirs.length) {
    L.push('## Layout');
    L.push('');
    for (const [d, n] of scan.dirs) L.push('- `' + d + '/` — ' + n + ' file' + (n === 1 ? '' : 's'));
    L.push('');
  }

  L.push('## Dependencies');
  L.push('');
  if (scan.deps.length) L.push('- **Runtime:** ' + scan.deps.slice(0, 12).map((d) => '`' + d + '`').join(', '));
  else if (scan.manifest === 'package.json') L.push('- **Runtime:** none — this project is dependency-free.');
  if (scan.devDeps.length) L.push('- **Dev:** ' + scan.devDeps.slice(0, 12).map((d) => '`' + d + '`').join(', '));
  L.push('');

  L.push('## Conventions');
  L.push('');
  if (scan.manifest === 'package.json') {
    L.push(scan.esm
      ? '- ESM only: use `import`/`export` and `node:` prefixes for builtins.'
      : '- CommonJS: use `require`/`module.exports`.');
  }
  if (!scan.deps.length && scan.manifest === 'package.json') {
    L.push('- Keep the dependency list empty — prefer the standard library.');
  }
  L.push('- Match the surrounding file: indentation, quote style and naming.');
  L.push('- Run the test command above before declaring anything done.');
  L.push('');
  L.push('## Notes');
  L.push('');
  L.push('- Add anything Astrocode should always know about this repo here.');
  L.push('');
  return L.join('\n');
}

async function cmdInit(ctx, argv) {
  const theme = ctx.theme;
  const w = viewWidth(ctx);
  const args = argsOf(argv);
  const cwd = cwdOf(ctx);
  const dest = path.join(cwd, 'ASTRO.md');
  const force = args.includes('--force') || args.includes('-f');

  if (!force && await exists(dest)) {
    ctx.print([[run('ASTRO.md already exists. ', { fg: theme.warn }),
      run('Run /init --force to regenerate it.', { fg: theme.dim })]]);
    return fail('ASTRO.md already exists');
  }

  let md;
  try {
    const scan = await scanProject(cwd);
    md = astroMarkdown(scan);
    await fs.writeFile(dest, md, 'utf8');
  } catch (err) {
    ctx.print([[run(`Could not write ASTRO.md: ${err.message}`, { fg: theme.error })]]);
    return fail(`Could not write ASTRO.md: ${err.message}`);
  }

  const preview = renderMarkdown(md, w - 4, theme).slice(0, 22);
  const out = drawBox(preview, {
    width: w, theme, title: 'ASTRO.md', footer: `${fmtBytes(Buffer.byteLength(md))} · ${tildify(dest)}`,
  });
  out.push(...note('Preview truncated — open ASTRO.md to edit it.', w, theme).map((l) => [run(' '), ...l]));
  ctx.print(out);
  return ok(`Wrote ${dest}`);
}

// ── /status ─────────────────────────────────────────────────────────────────

async function cmdStatus(ctx) {
  const theme = ctx.theme;
  const w = viewWidth(ctx);
  const cwd = cwdOf(ctx);
  const model = currentModel(ctx);
  const effort = currentEffort(ctx);
  const usage = usageOf(ctx);
  const s = ctx.session || {};

  let gitLine = [run('not a git repository', { fg: theme.faint })];
  const isRepo = await git.isRepo(cwd).catch(() => false);
  if (isRepo) {
    const [branch, st] = await Promise.all([
      git.branch(cwd).catch(() => null),
      git.status(cwd).catch(() => null),
    ]);
    const dirty = st ? (st.staged?.length ?? 0) + (st.unstaged?.length ?? 0) + (st.untracked?.length ?? 0) : 0;
    gitLine = [
      run(branch || 'detached', { fg: theme.text }),
      run('  ·  ', { fg: theme.faint }),
      dirty
        ? run(`${dirty} change${dirty === 1 ? '' : 's'}`, { fg: theme.warn })
        : run('clean', { fg: theme.success }),
    ];
  }

  const pct = model?.context ? Math.min(100, (usage.total / model.context) * 100) : 0;
  const rows = [
    { left: 'Model', right: [run(model?.name ?? 'unknown', { fg: model?.accent ?? theme.text }),
      run(`  ${fmtCtx(model?.context ?? 0)} ctx`, { fg: theme.faint })] },
    { left: 'Effort', right: [run(`${effort?.glyph ?? ''} `, { fg: effort?.color }),
      run(effort?.label ?? DEFAULT_EFFORT, { fg: theme.text })] },
    { left: 'Permissions', right: [run(ctx.permissions?.mode ?? 'ask', { fg: theme.text })] },
    { left: 'Theme', right: [run(theme?.name ?? 'astro', { fg: theme.text }),
      ...(theme?.rainbow ? [run('  rainbow', { fg: theme.pulse(0) })] : [])] },
    { left: 'Directory', right: [run(tildify(cwd), { fg: theme.text })] },
    { left: 'Git', right: gitLine },
    { left: 'Session', right: [run(String(s.id ?? '—'), { fg: theme.text }),
      run(`  up ${fmtDuration(Date.now() - startedAt(ctx))}`, { fg: theme.faint })] },
    { left: 'Messages', right: [run(String(transcript(ctx).length), { fg: theme.text })] },
    { left: 'Tokens', right: [
      run(`${fmtTokens(usage.input)} in`, { fg: theme.text }),
      run('  ·  ', { fg: theme.faint }),
      run(`${fmtTokens(usage.output)} out`, { fg: theme.text }),
      run('  ·  ', { fg: theme.faint }),
      run(`${pct.toFixed(1)}% of context`, { fg: pct > 80 ? theme.warn : theme.dim }),
    ] },
    { left: 'Cost', right: [
      run(fmtUsd(usageByModel(ctx).reduce((a, r) => a + costOf(r.model, r.input, r.output), 0)), { fg: theme.text }),
      run('  simulated', { fg: theme.faint }),
    ] },
  ];

  const body = columnRows(rows, w - 4, theme, { indent: 0, gap: 2, maxLeft: 12, leftStyle: { fg: theme.dim } });
  ctx.print(drawBox(body, { width: w, theme, title: 'Status' }));
  return ok(`${model?.name} · ${effort?.label}`);
}

// ── /cost ───────────────────────────────────────────────────────────────────

async function cmdCost(ctx) {
  const theme = ctx.theme;
  const w = viewWidth(ctx, 84);
  const rows = usageByModel(ctx);
  const out = [heading('Session cost', w, theme), blank()];

  if (!rows.length) {
    out.push([run('  No tokens used yet this session.', { fg: theme.dim })]);
    ctx.print(out);
    return ok('$0.00');
  }

  const nameW = Math.max(12, ...rows.map((r) => strWidth(r.model.name)));
  const colW = 11;
  out.push([
    run('  '), ...pad([run('Model', { fg: theme.faint })], nameW),
    ...padStart([run('input', { fg: theme.faint })], colW),
    ...padStart([run('output', { fg: theme.faint })], colW),
    ...padStart([run('cost', { fg: theme.faint })], colW),
  ]);

  let totalIn = 0;
  let totalOut = 0;
  let totalUsd = 0;
  for (const r of rows) {
    const usd = costOf(r.model, r.input, r.output);
    totalIn += r.input;
    totalOut += r.output;
    totalUsd += usd;
    out.push([
      run('  '), ...pad([run(r.model.name, { fg: r.model.accent })], nameW),
      ...padStart([run(fmtTokens(r.input), { fg: theme.text })], colW),
      ...padStart([run(fmtTokens(r.output), { fg: theme.text })], colW),
      ...padStart([run(fmtUsd(usd), { fg: theme.text })], colW),
    ]);
  }

  out.push([run('  '), ...rule(nameW + colW * 3, { theme })]);
  out.push([
    run('  '), ...pad([run('total', { fg: theme.dim, bold: true })], nameW),
    ...padStart([run(fmtTokens(totalIn), { fg: theme.text, bold: true })], colW),
    ...padStart([run(fmtTokens(totalOut), { fg: theme.text, bold: true })], colW),
    ...padStart([run(fmtUsd(totalUsd), { fg: theme.success, bold: true })], colW),
  ]);
  out.push(blank());
  out.push(...note('Pricing is simulated from the model table — Astrocode makes no API calls.', w - 2, theme)
    .map((l) => [run('  '), ...l]));
  ctx.print(out);
  return ok(fmtUsd(totalUsd));
}

// ── /tools ──────────────────────────────────────────────────────────────────

async function cmdTools(ctx) {
  const theme = ctx.theme;
  const w = viewWidth(ctx);
  const tools = toolList(ctx);
  const out = [heading('Tools', w, theme), blank()];

  if (!tools.length) {
    out.push([run('  No tool registry attached to this session.', { fg: theme.dim })]);
    ctx.print(out);
    return fail('no tools');
  }

  const sorted = [...tools].sort((a, b) => Number(a.mutating) - Number(b.mutating) || a.name.localeCompare(b.name));
  out.push(...columnRows(sorted.map((t) => ({
    left: [
      run(t.title || t.name, { fg: t.mutating ? theme.warn : theme.tool }),
      run(t.mutating ? ' ✎' : '', { fg: theme.faint }),
    ],
    right: t.summary || TOOL_BLURBS[t.name] || 'No description',
  })), w, theme, { maxLeft: 14 }));
  out.push(blank());
  out.push(...note(
    `✎ marks a mutating tool. Permission mode is ${ctx.permissions?.mode ?? 'ask'} — see /permissions.`,
    w - 2, theme,
  ).map((l) => [run('  '), ...l]));
  ctx.print(out);
  return ok(`${tools.length} tools`);
}

// ── /commands ───────────────────────────────────────────────────────────────

async function cmdCommands(ctx) {
  const theme = ctx.theme;
  const w = viewWidth(ctx);
  const visible = COMMANDS.filter((c) => !c.hidden);
  const out = [heading('All commands', w, theme), blank()];
  out.push(...columnRows(visible.map((c) => ({
    left: [
      run(`/${c.name}`, { fg: theme.primary }),
      ...(c.aliases?.length ? [run(` ${c.aliases.map((a) => `/${a}`).join(' ')}`, { fg: theme.faint })] : []),
    ],
    right: c.summary,
  })), w, theme, { maxLeft: 28 }));
  ctx.print(out);
  return ok(`${visible.length} commands`);
}

// ── /permissions ────────────────────────────────────────────────────────────

function listOf(v) {
  if (!v) return [];
  if (v instanceof Set) return [...v].map(String);
  if (v instanceof Map) return [...v.keys()].map(String);
  if (Array.isArray(v)) return v.map(String);
  return [];
}

async function cmdPermissions(ctx, argv) {
  const theme = ctx.theme;
  const w = viewWidth(ctx);
  const args = argsOf(argv);
  const p = ctx.permissions;
  const norm = (s) => String(s).toLowerCase().replace(/[-_]/g, '');

  if (args.length) {
    const wanted = PERMISSION_MODES.find((m) => norm(m.id) === norm(args[0]));
    if (!wanted) {
      ctx.print([[run(`Unknown mode `, { fg: theme.error }), run(args[0], { fg: theme.error, bold: true }),
        run(`  — try ${PERMISSION_MODES.map((m) => m.id).join(', ')}`, { fg: theme.dim })]]);
      return fail(`Unknown permission mode: ${args[0]}`);
    }
    if (typeof p?.setMode !== 'function') return fail('No permission layer attached to this session.');
    p.setMode(wanted.id);
    if (ctx.config && typeof ctx.config === 'object') ctx.config.permissionMode = wanted.id;
    ctx.print([[run('Permission mode  ', { fg: theme.dim }), run(wanted.id, { fg: theme.primary, bold: true }),
      run(`   ${wanted.desc}`, { fg: theme.faint })]]);
    return ok(`Permission mode: ${wanted.id}`);
  }

  const active = p?.mode ?? 'ask';

  if (canPick(ctx)) {
    const chosen = await pick(ctx, {
      title: 'Select permission mode',
      items: PERMISSION_MODES.map((m) => ({
        label: m.id,
        value: m.id,
        current: m.id === active,
        color: m.id === 'yolo' ? theme.error : m.id === 'plan' ? theme.info : theme.primary,
        desc: m.desc,
      })),
      footer: 'Destructive commands stay denied in every mode',
    });
    if (!chosen) return ok(active);
    return cmdPermissions(ctx, [chosen]);
  }

  const out = [heading('Permissions', w, theme), blank()];
  for (const m of PERMISSION_MODES) {
    const on = m.id === active;
    out.push([
      run('  '), run(on ? '●' : '○', { fg: on ? theme.primary : theme.faint }), run('  '),
      ...pad([run(m.id, { fg: on ? theme.primary : theme.text, bold: on })], 13),
      run(m.desc, { fg: theme.dim }),
    ]);
  }
  const allow = listOf(p?.allow ?? p?.allowed ?? p?.allowRules);
  const deny = listOf(p?.deny ?? p?.denied ?? p?.denyRules);
  const session = listOf(p?.sessionAllows ?? p?.session ?? p?.granted);
  const extra = [
    ['always allow', allow], ['always deny', deny], ['granted this session', session],
  ].filter(([, v]) => v.length);
  for (const [label, items] of extra) {
    out.push(blank());
    out.push([run('  '), run(label, { fg: theme.faint })]);
    for (const it of items.slice(0, 12)) out.push([run('    '), run(it, { fg: theme.text })]);
  }
  out.push(blank());
  out.push(...note('Switch with /permissions <mode>. Destructive commands stay denied in every mode.', w - 2, theme)
    .map((l) => [run('  '), ...l]));
  ctx.print(out);
  return ok(active);
}

// ── /theme ──────────────────────────────────────────────────────────────────

async function cmdTheme(ctx, argv) {
  const theme = ctx.theme;
  const w = viewWidth(ctx);
  const args = argsOf(argv);
  const all = themeList();
  const themeItems = () => all.map((t) => ({
    label: t.name,
    value: t.name,
    current: t.name === theme?.name,
    desc: t.label,
  }));

  if (!args.length) {
    if (canPick(ctx)) {
      const chosen = await pick(ctx, { title: 'Select a theme', items: themeItems() });
      if (!chosen) return ok(theme?.name ?? 'astro');
      return cmdTheme(ctx, [chosen]);
    }
    const out = [heading('Themes', w, theme), blank()];
    for (const t of all) {
      const on = t.name === theme?.name;
      out.push([
        run('  '), run(on ? '●' : '○', { fg: on ? theme.primary : theme.faint }), run('  '),
        ...pad([run(t.name, { fg: on ? theme.primary : theme.text, bold: on })], 10),
        run(t.label, { fg: theme.dim }),
      ]);
    }
    out.push(blank());
    out.push(...note('Switch with /theme <name>.', w - 2, theme).map((l) => [run('  '), ...l]));
    ctx.print(out);
    return ok(theme?.name ?? 'astro');
  }

  const wanted = all.find((t) => t.name === args[0].toLowerCase());
  if (!wanted) {
    ctx.print([[run('Unknown theme ', { fg: theme.error }), run(args[0], { fg: theme.error, bold: true })]]);
    if (canPick(ctx)) {
      const chosen = await pick(ctx, { title: 'Select a theme', items: themeItems() });
      if (!chosen) return fail(`Unknown theme: ${args[0]}`);
      return cmdTheme(ctx, [chosen]);
    }
    ctx.print([[run(`  try ${all.map((t) => t.name).join(', ')}`, { fg: theme.dim })]]);
    return fail(`Unknown theme: ${args[0]}`);
  }
  theme.setPalette(wanted.name);
  if (ctx.config && typeof ctx.config === 'object') ctx.config.theme = wanted.name;
  ctx.app?.refresh?.();
  ctx.print([[run('Theme  ', { fg: theme.dim }), run(wanted.label, { fg: theme.primary, bold: true })]]);
  return ok(`Theme set to ${wanted.name}`);
}

// ── /session ────────────────────────────────────────────────────────────────

async function cmdSession(ctx) {
  const theme = ctx.theme;
  const w = viewWidth(ctx);
  const s = ctx.session || {};
  const msgs = transcript(ctx);
  const files = filesTouched(ctx);
  const todos = todosOf(ctx);
  const used = modelsUsed(ctx);

  const rows = [
    { left: 'id', right: [run(String(s.id ?? '—'), { fg: theme.text })] },
    { left: 'started', right: [run(new Date(startedAt(ctx)).toLocaleString(), { fg: theme.text }),
      run(`  (${fmtDuration(Date.now() - startedAt(ctx))} ago)`, { fg: theme.faint })] },
    { left: 'directory', right: [run(tildify(cwdOf(ctx)), { fg: theme.text })] },
    { left: 'models', right: [run(used.map((m) => m.name).join(', '), { fg: theme.text })] },
    { left: 'effort', right: [run(currentEffort(ctx)?.label ?? DEFAULT_EFFORT, { fg: theme.text })] },
    { left: 'messages', right: [run(String(msgs.length), { fg: theme.text })] },
    { left: 'files', right: [run(files.length ? files.slice(0, 6).join(', ') : 'none touched', {
      fg: files.length ? theme.text : theme.faint,
    })] },
  ];
  if (s.file || s.path) rows.push({ left: 'saved to', right: [run(tildify(String(s.file ?? s.path)), { fg: theme.text })] });

  const out = [...drawBox(
    columnRows(rows, w - 4, theme, { indent: 0, gap: 2, maxLeft: 11, leftStyle: { fg: theme.dim } }),
    { width: w, theme, title: 'Session' },
  )];

  if (todos.length) {
    out.push(blank(), heading('Todos', w, theme));
    for (const t of todos) {
      const mark = t.status === 'completed' ? '✔' : t.status === 'in_progress' ? '◐' : '○';
      const fg = t.status === 'completed' ? theme.success : t.status === 'in_progress' ? theme.warn : theme.dim;
      out.push([run('  '), run(mark, { fg }), run('  '),
        run(String(t.content ?? ''), { fg: t.status === 'completed' ? theme.faint : theme.text, strike: t.status === 'completed' })]);
    }
  }
  out.push(blank());
  out.push(...note(`Resume later with: astrocode --resume ${s.id ?? '<id>'}`, w - 2, theme).map((l) => [run('  '), ...l]));
  ctx.print(out);
  return ok(String(s.id ?? 'session'));
}

// ── /export ─────────────────────────────────────────────────────────────────

function transcriptMarkdown(ctx) {
  const s = ctx.session || {};
  const model = currentModel(ctx);
  const usage = usageOf(ctx);
  const L = [];
  L.push(`# Astrocode session ${s.id ?? ''}`.trim());
  L.push('');
  L.push(`- **Exported:** ${new Date().toISOString()}`);
  L.push(`- **Directory:** ${cwdOf(ctx)}`);
  L.push(`- **Models:** ${modelsUsed(ctx).map((m) => m.name).join(', ')}`);
  L.push(`- **Effort:** ${currentEffort(ctx)?.label ?? DEFAULT_EFFORT}`);
  L.push(`- **Tokens:** ${usage.input} in / ${usage.output} out`);
  L.push('');
  L.push('---');
  L.push('');

  const msgs = transcript(ctx);
  if (!msgs.length) L.push('_No messages in this session._', '');
  for (const m of msgs) {
    const role = messageRole(m);
    const text = messageText(m).trim();
    if (role === 'user') {
      L.push('## You', '', text || '_(empty)_', '');
    } else if (role === 'tool') {
      const name = m?.tool ?? m?.name ?? 'tool';
      const arg = m?.describe ?? m?.summary ?? '';
      L.push(`> **${name}** ${arg}`.trim(), '');
      if (text) L.push('```', text, '```', '');
    } else if (role === 'thinking') {
      if (text) L.push('<details><summary>Thinking</summary>', '', text, '', '</details>', '');
    } else if (role === 'summary') {
      L.push(text, '');
    } else {
      L.push(`## ${m?.model?.name ?? model?.name ?? 'Assistant'}`, '', text || '_(empty)_', '');
    }
  }
  L.push('---', '');
  L.push('Generated by Astrocode — an agentic coding CLI by Tripplet.');
  L.push('');
  return L.join('\n');
}

async function cmdExport(ctx, argv) {
  const theme = ctx.theme;
  const args = argsOf(argv);
  const cwd = cwdOf(ctx);
  const s = ctx.session || {};
  const id = String(s.id ?? Date.now().toString(36));
  const rel = args[0] || `astrocode-session-${id}.md`;
  const dest = path.resolve(cwd, rel);
  if (!inside(dest, cwd)) return fail('Refusing to export outside the working directory.');

  const md = transcriptMarkdown(ctx);
  try {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, md, 'utf8');
  } catch (err) {
    ctx.print([[run(`Export failed: ${err.message}`, { fg: theme.error })]]);
    return fail(`Export failed: ${err.message}`);
  }
  ctx.print([[
    run('Exported  ', { fg: theme.dim }),
    run(path.relative(cwd, dest) || path.basename(dest), { fg: theme.primary }),
    run(`   ${transcript(ctx).length} messages · ${fmtBytes(Buffer.byteLength(md))}`, { fg: theme.faint }),
  ]]);
  return ok(`Wrote ${dest}`);
}

// ── /diff ───────────────────────────────────────────────────────────────────

const MAX_DIFF_ROWS = 500;

async function cmdDiff(ctx, argv) {
  const theme = ctx.theme;
  const w = viewWidth(ctx, 120);
  const args = argsOf(argv);
  const cwd = cwdOf(ctx);
  const staged = args.some((a) => a === '--staged' || a === '--cached');

  if (!await git.isRepo(cwd).catch(() => false)) return fail('Not a git repository.');
  let text;
  try {
    text = await git.diff(cwd, { staged });
  } catch (err) {
    return fail(`git diff failed: ${err.message}`);
  }
  if (!text || !text.trim()) {
    ctx.print([[run(staged ? 'Nothing staged.' : 'No unstaged changes.', { fg: theme.dim })]]);
    return ok('no changes');
  }

  const rendered = renderDiff(text, w, theme, { staged });
  const out = [heading(staged ? 'Staged diff' : 'Working diff', w, theme), blank()];
  out.push(...rendered.slice(0, MAX_DIFF_ROWS));
  if (rendered.length > MAX_DIFF_ROWS) {
    out.push(blank());
    out.push([run(`  … ${rendered.length - MAX_DIFF_ROWS} more lines — run \`git diff\` for the rest.`, { fg: theme.faint })]);
  }
  ctx.print(out);
  return ok(`${rendered.length} lines`);
}

// ── /files ──────────────────────────────────────────────────────────────────

const fileOf = (e) => (typeof e === 'string' ? e : String(e?.path ?? e?.file ?? e?.name ?? ''));
const codeOf = (e) => (typeof e === 'string' ? '' : String(e?.status ?? e?.code ?? ''));

async function cmdFiles(ctx) {
  const theme = ctx.theme;
  const w = viewWidth(ctx);
  const cwd = cwdOf(ctx);
  const out = [];

  const isRepo = await git.isRepo(cwd).catch(() => false);
  let total = 0;
  if (isRepo) {
    const st = await git.status(cwd).catch(() => null);
    const groups = [
      ['staged', st?.staged ?? [], theme.add],
      ['modified', st?.unstaged ?? [], theme.warn],
      ['untracked', st?.untracked ?? [], theme.dim],
    ].filter(([, items]) => items.length);
    total = groups.reduce((a, [, items]) => a + items.length, 0);

    out.push(ruleHeader('Modified Files', w, { theme, labelFg: theme.accent, bold: true }));
    if (!groups.length) {
      out.push(blank(), [run('  Working tree is clean.', { fg: theme.dim })]);
    }
    for (const [label, items, fg] of groups) {
      out.push(blank());
      out.push([run('  '), run(label, { fg: theme.faint }), run(`  ${items.length}`, { fg: theme.faint })]);
      for (const e of items.slice(0, 60)) {
        const code = codeOf(e);
        out.push([
          run('    '),
          ...pad([run(code || (label === 'untracked' ? '?' : 'M'), { fg })], 3),
          run(fileOf(e), { fg: theme.text }),
        ]);
      }
      if (items.length > 60) out.push([run(`    … ${items.length - 60} more`, { fg: theme.faint })]);
    }
  } else {
    out.push(ruleHeader('Modified Files', w, { theme, labelFg: theme.accent, bold: true }));
    out.push(blank(), [run('  Not a git repository.', { fg: theme.dim })]);
  }

  const touched = filesTouched(ctx);
  if (touched.length) {
    out.push(blank(), heading('Touched this session', w, theme), blank());
    for (const f of touched.slice(0, 40)) {
      out.push([run('    '), run('·', { fg: theme.tool }), run('  '), run(f, { fg: theme.text })]);
    }
  }
  ctx.print(out);
  return ok(`${total} changed`);
}

// ── /commit ─────────────────────────────────────────────────────────────────

async function cmdCommit(ctx, argv) {
  const theme = ctx.theme;
  const w = viewWidth(ctx);
  const cwd = cwdOf(ctx);
  const args = argsOf(argv);

  if (!await git.isRepo(cwd).catch(() => false)) return fail('Not a git repository.');
  const st = await git.status(cwd).catch(() => null);
  if (st && st.clean) {
    ctx.print([[run('Nothing to commit — the working tree is clean.', { fg: theme.dim })]]);
    return fail('nothing to commit');
  }

  let subject = args.join(' ').trim() || null;
  let body = null;
  if (!subject) {
    const diffText = await git.diff(cwd, { staged: false }).catch(() => '');
    const guess = summariseChanges(st, diffText) || {};
    subject = guess.subject || 'chore: update working tree';
    body = guess.body || null;
  }

  let res;
  try {
    res = await makeCommit({ cwd, model: currentModel(ctx), session: ctx.session, git, subject, body });
  } catch (err) {
    ctx.print([[run(`Commit failed: ${err.message}`, { fg: theme.error })]]);
    return fail(`Commit failed: ${err.message}`);
  }

  const message = String(res?.message ?? '');
  const msgLines = message.split('\n').map((l, i) => {
    const trailer = /^(🚀 Generated with Astrocode|Co-Authored by )/.test(l);
    return [run(l, { fg: trailer ? theme.faint : i === 0 ? theme.text : theme.dim, bold: i === 0 })];
  });

  const out = drawBox(msgLines, {
    width: w,
    theme,
    title: res?.ok ? 'Committed' : 'Commit message',
    footer: res?.hash ? String(res.hash).slice(0, 12) : undefined,
    color: res?.ok ? theme.success : theme.border,
  });
  if (!res?.ok) out.push([run(`  ${res?.error ?? 'commit failed'}`, { fg: theme.error })]);
  ctx.print(out);
  return res?.ok ? ok(`Committed ${String(res.hash ?? '').slice(0, 8)}`) : fail(res?.error ?? 'commit failed');
}

// ── /cwd ────────────────────────────────────────────────────────────────────

async function cmdCwd(ctx, argv) {
  const theme = ctx.theme;
  const args = argsOf(argv);
  const cwd = cwdOf(ctx);

  if (!args.length) {
    const root = await git.rootOf(cwd).catch(() => null);
    const out = [[run('Directory  ', { fg: theme.dim }), run(tildify(cwd), { fg: theme.text })]];
    if (root && path.resolve(root) !== path.resolve(cwd)) {
      out.push([run('Git root   ', { fg: theme.dim }), run(tildify(root), { fg: theme.faint })]);
    }
    ctx.print(out);
    return ok(cwd);
  }

  const target = path.resolve(cwd, args.join(' ').replace(/^~(?=$|\/)/, os.homedir()));
  try {
    const st = await fs.stat(target);
    if (!st.isDirectory()) return fail(`Not a directory: ${target}`);
  } catch (err) {
    ctx.print([[run(`No such directory: ${target}`, { fg: theme.error })]]);
    return fail(`No such directory: ${target} (${err.code ?? err.message})`);
  }

  if (typeof ctx.app?.setCwd === 'function') {
    ctx.app.setCwd(target);
  } else {
    try {
      process.chdir(target);
    } catch (err) {
      return fail(`Could not change directory: ${err.message}`);
    }
    if (ctx.session) ctx.session.cwd = target;
    if (ctx.config && typeof ctx.config === 'object') ctx.config.cwd = target;
  }
  ctx.print([[run('Directory  ', { fg: theme.dim }), run(tildify(target), { fg: theme.primary })]]);
  return ok(target);
}

// ── /doctor ─────────────────────────────────────────────────────────────────

const DEPTH_LABEL = {
  [DEPTH.NONE]: 'no colour',
  [DEPTH.BASIC]: '16 colours',
  [DEPTH.ANSI256]: '256 colours',
  [DEPTH.TRUECOLOR]: 'truecolor (24-bit)',
};

async function cmdDoctor(ctx) {
  const theme = ctx.theme;
  const w = viewWidth(ctx);
  const cwd = cwdOf(ctx);
  const rows = [];

  const [maj, min] = process.versions.node.split('.').map((n) => parseInt(n, 10));
  const nodeOk = maj > 18 || (maj === 18 && min >= 17);
  rows.push([nodeOk ? 'ok' : 'bad', 'node', `v${process.versions.node}${nodeOk ? '' : ' — Astrocode needs >= 18.17'}`]);

  const depth = getDepth();
  rows.push([depth === DEPTH.NONE ? 'warn' : 'ok', 'colour', DEPTH_LABEL[depth] ?? String(depth)]);

  const tty = Boolean(process.stdout.isTTY);
  rows.push([tty ? 'ok' : 'warn', 'terminal', tty
    ? `${process.stdout.columns ?? '?'}×${process.stdout.rows ?? '?'} · ${process.env.TERM || 'unknown'}`
    : 'not a TTY — the TUI needs an interactive terminal']);

  let gitVersion = null;
  try {
    const { stdout } = await execFileP('git', ['--version'], { timeout: 4000 });
    gitVersion = stdout.trim();
  } catch (err) {
    // git missing or not executable — /commit and /diff degrade, everything else is fine
    gitVersion = null;
    void err;
  }
  rows.push([gitVersion ? 'ok' : 'warn', 'git', gitVersion ?? 'not found on PATH — /commit and /diff are unavailable']);

  const repoRoot = await git.rootOf(cwd).catch(() => null);
  rows.push([repoRoot ? 'ok' : 'warn', 'repository', repoRoot ? tildify(repoRoot) : 'not a git repository']);

  let writable = true;
  try {
    await fs.access(cwd, FS.W_OK);
  } catch (err) {
    writable = false;
    void err;
  }
  rows.push([writable ? 'ok' : 'bad', 'cwd writable', `${tildify(cwd)}${writable ? '' : ' — read-only'}`]);

  const hasAstro = await exists(path.join(cwd, 'ASTRO.md'));
  rows.push([hasAstro ? 'ok' : 'warn', 'ASTRO.md', hasAstro ? 'present' : 'missing — run /init to generate it']);

  rows.push(['ok', 'platform', `${process.platform} ${process.arch} · shell ${path.basename(process.env.SHELL || 'sh')}`]);
  rows.push(['ok', 'permissions', String(ctx.permissions?.mode ?? 'ask')]);
  rows.push(['ok', 'network', 'never used — models are simulated locally']);

  const out = [heading('Doctor', w, theme), blank()];
  for (const [status, label, detail] of rows) out.push(checkRow(status, label, detail, theme));
  const bad = rows.filter((r) => r[0] === 'bad').length;
  const warn = rows.filter((r) => r[0] === 'warn').length;
  out.push(blank());
  out.push([run('  '), run(
    bad ? `${bad} problem${bad === 1 ? '' : 's'} found` : warn ? `${warn} thing${warn === 1 ? '' : 's'} to look at` : 'Everything checks out.',
    { fg: bad ? theme.error : warn ? theme.warn : theme.success },
  )]);
  ctx.print(out);
  return bad ? fail(`${bad} problems`) : ok('healthy');
}

// ── /about ──────────────────────────────────────────────────────────────────

let pkgCache = null;

async function readPkg() {
  if (pkgCache) return pkgCache;
  try {
    pkgCache = JSON.parse(await fs.readFile(PKG_PATH, 'utf8'));
  } catch (err) {
    // version is cosmetic — a moved or bundled install still gets a sane header
    void err;
    pkgCache = { name: 'astrocode', version: '0.0.0', description: '' };
  }
  return pkgCache;
}

async function cmdAbout(ctx) {
  const theme = ctx.theme;
  const w = viewWidth(ctx, 80);
  const pkg = await readPkg();
  const body = [];

  body.push([...theme.paint('Astrocode', { bold: true }, theme.primary),
    run(`  v${pkg.version}`, { fg: theme.faint })]);
  body.push([run('An agentic coding CLI by ', { fg: theme.dim }), run('Tripplet', { fg: theme.accent })]);
  body.push(blank());
  body.push(...wrapText(
    'Real tools on your real filesystem, gated by a permission layer. The models are '
    + 'simulated locally: Astrocode never opens a network connection.',
    w - 4, { fg: theme.text },
  ));
  body.push(blank());
  body.push([run('Models', { fg: theme.faint })]);
  for (const m of MODELS) {
    body.push([
      run('  '), run('●', { fg: m.accent }), run('  '),
      ...pad([run(m.name, { fg: theme.text })], 16),
      run(`${fmtCtx(m.context)} ctx`, { fg: theme.dim }),
      run('  ·  ', { fg: theme.faint }),
      run(m.tier, { fg: theme.faint }),
    ]);
  }
  body.push(blank());
  body.push([run('node ', { fg: theme.faint }), run(process.version, { fg: theme.dim }),
    run('  ·  ', { fg: theme.faint }), run(`${process.platform}-${process.arch}`, { fg: theme.dim })]);

  ctx.print(drawBox(body, { width: w, theme, title: 'About', footer: 'zero dependencies' }));
  return ok(`Astrocode v${pkg.version}`);
}

// ── /login, /logout, /whoami ────────────────────────────────────────────────

async function cmdLogin(ctx, argv) {
  const theme = ctx.theme;
  const args = argsOf(argv);
  const { DEFAULT_BASE_URL } = await import('../auth/oauth.js');
  const { loadAuth, isSignedIn, clearAuth } = await import('../auth/store.js');

  // `/login --url https://…` switches deployment; the old token is not valid
  // there, so drop it rather than leaving a confusing half state.
  let baseUrl = ctx.config?.authUrl || DEFAULT_BASE_URL;
  const urlIdx = args.findIndex((a) => a === '--url' || a === '-u');
  if (urlIdx !== -1 && args[urlIdx + 1]) {
    baseUrl = args[urlIdx + 1].replace(/\/+$/, '');
    if (ctx.config) ctx.config.authUrl = baseUrl;
    clearAuth();
  } else if (args.length && /^https?:\/\//i.test(args[0])) {
    baseUrl = args[0].replace(/\/+$/, '');
    if (ctx.config) ctx.config.authUrl = baseUrl;
    clearAuth();
  }

  const existing = loadAuth();
  if (isSignedIn(existing) && !args.includes('--force') && existing.baseUrl === baseUrl) {
    ctx.print([[
      run('Already signed in', { fg: theme.success }),
      run(existing.email ? `  ${existing.email}` : '', { fg: theme.text }),
      run(`  ${existing.baseUrl}`, { fg: theme.faint }),
    ], [run('  /login --force to sign in again, /logout to sign out.', { fg: theme.faint })]]);
    return ok('already signed in');
  }

  if (typeof ctx.app?.runLogin !== 'function') {
    ctx.print([[run('Run `astrocode login` from a terminal to sign in.', { fg: theme.warn })]]);
    return fail('no interactive session');
  }
  // A bare /login offers the deployment picker; /login --url skips straight in.
  const explicitUrl = urlIdx !== -1 || (args.length && /^https?:\/\//i.test(args[0]));
  const res = explicitUrl
    ? await ctx.app.runLogin({ baseUrl })
    : await ctx.app.promptLogin();
  return res.ok ? ok('signed in') : fail(res.skipped ? 'skipped' : (res.error || 'sign-in failed'));
}

async function cmdLogout(ctx) {
  const theme = ctx.theme;
  const { loadAuth, clearAuth } = await import('../auth/store.js');
  const auth = loadAuth();
  if (!auth) {
    ctx.print([[run('Not signed in.', { fg: theme.dim })]]);
    return ok('not signed in');
  }
  const res = clearAuth();
  if (ctx.app) ctx.app.authed = false;
  if (!res.ok) return fail(`Could not remove credentials: ${res.error}`);
  ctx.print([[
    run('Signed out', { fg: theme.success }),
    run(auth.email ? `  ${auth.email}` : '', { fg: theme.faint }),
  ]]);
  return ok('signed out');
}

async function cmdWhoami(ctx) {
  const theme = ctx.theme;
  const w = viewWidth(ctx);
  const { loadAuth, isExpired } = await import('../auth/store.js');
  const auth = loadAuth();

  if (!auth) {
    ctx.print([
      [run('Not signed in.', { fg: theme.warn })],
      [run('  Run ', { fg: theme.faint }), run('/login', { fg: theme.primary }),
        run(' to connect to Tripplet.', { fg: theme.faint })],
    ]);
    return ok('not signed in');
  }

  const stale = isExpired(auth, 0);
  const rows = [
    { left: 'account', right: [run(auth.email || 'unknown', { fg: theme.text })] },
    { left: 'server', right: [run(auth.baseUrl || '—', { fg: theme.text })] },
    { left: 'scope', right: [run(auth.scope || '—', { fg: theme.dim })] },
    {
      left: 'token',
      right: [run(
        stale ? (auth.refreshToken ? 'expired — will refresh on next use' : 'expired') : 'valid',
        { fg: stale ? (auth.refreshToken ? theme.warn : theme.error) : theme.success },
      )],
    },
    { left: 'signed in', right: [run(auth.signedInAt ? new Date(auth.signedInAt).toLocaleString() : '—', { fg: theme.dim })] },
  ];
  ctx.print([heading('Account', w, theme), blank(),
    ...columnRows(rows, w, theme, { maxLeft: 12, leftStyle: { fg: theme.dim } })]);
  return ok(auth.email || 'signed in');
}

// ── /usage ──────────────────────────────────────────────────────────────────

/** `████████░░░░░░░░` — a bar wide enough to read at a glance, no more. */
function usageBar(percent, width, theme) {
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width);
  const fg = percent >= 80 ? theme.error : percent >= 50 ? theme.warn : theme.success;
  return [
    run('█'.repeat(filled), { fg }),
    run('░'.repeat(Math.max(0, width - filled)), { fg: theme.faint }),
  ];
}

/** "in 2h 15m" — the only number that matters when you have run out. */
function untilText(iso) {
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return 'unknown';
  if (ms <= 0) return 'now';
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return mins % 60 ? `${hours}h ${mins % 60}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days}d ${hours % 24}h` : `${days}d`;
}

async function cmdUsage(ctx) {
  const theme = ctx.theme;
  const w = viewWidth(ctx, 84);
  const { loadAuth } = await import('../auth/store.js');

  if (!loadAuth()) {
    ctx.print([
      [run('Not signed in — usage limits apply to your Tripplet account.', { fg: theme.warn })],
      [run('  Run ', { fg: theme.faint }), run('/login', { fg: theme.primary }),
        run(' to connect, then /usage again.', { fg: theme.faint })],
    ]);
    return ok('not signed in');
  }

  let summary;
  try {
    const { fetchUsage } = await import('../core/api.js');
    summary = await fetchUsage();
  } catch (err) {
    ctx.print([[run(err.message, { fg: theme.error })],
      ...(err.hint ? [[run(`  ${err.hint}`, { fg: theme.faint })]] : [])]);
    return fail('could not load usage');
  }

  const barW = Math.max(12, Math.min(28, w - 46));
  const out = [heading('Usage', w, theme), blank()];
  out.push([run('  plan  ', { fg: theme.dim }), run(summary.plan || 'free', { fg: theme.accent, bold: true })]);
  out.push(blank());

  for (const [label, win] of [['5 hours', summary.fiveHour], ['7 days', summary.weekly]]) {
    if (!win) continue;
    out.push([
      run('  '), ...pad([run(label, { fg: theme.faint })], 9),
      ...usageBar(win.percent, barW, theme),
      run('  '),
      run(`${win.used}/${win.limit}`, { fg: theme.text }),
      run(` (${win.percent}%)`, { fg: theme.dim }),
    ]);
    out.push([
      run('  '), ...pad([run('', {})], 9), run(' '.repeat(barW)), run('  '),
      run(`${win.remaining} left · resets in ${untilText(win.resetsAt)}`, { fg: theme.faint }),
    ]);
  }

  out.push(blank());
  out.push([run('  Limits are per message, counted once per turn however many tools it uses.', { fg: theme.faint })]);
  ctx.print(out);
  return ok(`${summary.fiveHour?.used ?? 0}/${summary.fiveHour?.limit ?? 0} this window`);
}

// ── /quit ───────────────────────────────────────────────────────────────────

async function cmdQuit(ctx) {
  ctx.print([[run('Goodbye.', { fg: ctx.theme.dim })]]);
  if (typeof ctx.quit === 'function') ctx.quit();
  else return fail('No quit handler attached — press ctrl+c twice.');
  return ok('quitting');
}

// ── /rainbow (hidden) ───────────────────────────────────────────────────────

async function cmdRainbow(ctx, argv) {
  const theme = ctx.theme;
  const args = argsOf(argv);
  const word = (args[0] || 'toggle').toLowerCase();
  const on = word === 'on' || word === 'true' ? true
    : word === 'off' || word === 'false' ? false
      : !theme.rainbow;
  theme.rainbow = on;
  if (!on) theme.phase = 0;
  if (ctx.config && typeof ctx.config === 'object') ctx.config.rainbow = on;
  ctx.app?.setAnimated?.(on);
  ctx.app?.refresh?.();
  ctx.print([on
    ? [...theme.paint('Rainbow mode engaged. Hold on to something.', { bold: true }, theme.primary)]
    : [run('Rainbow mode off.', { fg: theme.dim })]]);
  return ok(`rainbow ${on ? 'on' : 'off'}`);
}

// ── registry ────────────────────────────────────────────────────────────────

/**
 * @typedef {object} Command
 * @property {string} name
 * @property {string[]} aliases
 * @property {string} summary
 * @property {string} [args]
 * @property {boolean} [hidden]
 * @property {string} [group]
 * @property {(ctx: object, argv: string[]) => Promise<{ok: boolean, message?: string}>} run
 */

/** @type {Command[]} */
export const COMMANDS = [
  { name: 'help', aliases: ['h', '?'], group: 'System', args: '[command]', summary: 'Show this list, or detail for one command', run: cmdHelp },
  { name: 'model', aliases: ['m'], group: 'Model', args: '[name]', summary: 'Show the model picker, or switch model', run: cmdModel },
  { name: 'effort', aliases: ['e', 'think'], group: 'Model', args: '[level]', summary: 'Show or set reasoning effort (low…max)', run: cmdEffort },
  { name: 'theme', aliases: [], group: 'Model', args: '[name]', summary: 'Show or switch the colour theme', run: cmdTheme },
  { name: 'clear', aliases: ['reset'], group: 'Session', summary: 'Clear the transcript and reset token counters', run: cmdClear },
  { name: 'compact', aliases: [], group: 'Session', summary: 'Replace the transcript with a summary, keeping counters', run: cmdCompact },
  { name: 'status', aliases: ['st'], group: 'Session', summary: 'Model, effort, tokens, git and session at a glance', run: cmdStatus },
  { name: 'cost', aliases: [], group: 'Session', summary: 'Token and USD breakdown per model, this session', run: cmdCost },
  { name: 'session', aliases: [], group: 'Session', summary: 'Details of the current session, including todos', run: cmdSession },
  { name: 'export', aliases: [], group: 'Session', args: '[file]', summary: 'Write the transcript to a markdown file', run: cmdExport },
  { name: 'init', aliases: [], group: 'Project', args: '[--force]', summary: 'Scan the repo and write ASTRO.md', run: cmdInit },
  { name: 'files', aliases: ['changed'], group: 'Project', summary: 'List modified and untracked files', run: cmdFiles },
  { name: 'cwd', aliases: ['cd', 'pwd'], group: 'Project', args: '[dir]', summary: 'Show or change the working directory', run: cmdCwd },
  { name: 'tools', aliases: [], group: 'Project', summary: 'List the tools the model can call', run: cmdTools },
  { name: 'permissions', aliases: ['perms', 'mode'], group: 'Project', args: '[mode]', summary: 'Show or set the permission mode', run: cmdPermissions },
  { name: 'diff', aliases: [], group: 'Git', args: '[--staged]', summary: 'Render the working (or staged) diff', run: cmdDiff },
  { name: 'commit', aliases: [], group: 'Git', args: '[subject]', summary: 'Stage everything and commit with an Astrocode trailer', run: cmdCommit },
  { name: 'commands', aliases: ['cmds'], group: 'System', summary: 'Flat list of every command and its aliases', run: cmdCommands },
  { name: 'doctor', aliases: [], group: 'System', summary: 'Check node, colour, terminal, git and permissions', run: cmdDoctor },
  { name: 'about', aliases: ['version'], group: 'System', summary: 'About Astrocode, Tripplet and the four models', run: cmdAbout },
  { name: 'login', aliases: ['signin'], group: 'Account', args: '[--url <base>]', summary: 'Sign in to Tripplet with your browser', run: cmdLogin },
  { name: 'logout', aliases: ['signout'], group: 'Account', summary: 'Forget the stored credentials', run: cmdLogout },
  { name: 'whoami', aliases: ['account'], group: 'Account', summary: 'Show the signed-in account and token status', run: cmdWhoami },
  { name: 'usage', aliases: ['limits'], group: 'Account', summary: 'Plan limits and how much of them you have used', run: cmdUsage },
  { name: 'quit', aliases: ['exit', 'q'], group: 'System', summary: 'Leave Astrocode', run: cmdQuit },
  { name: 'rainbow', aliases: [], group: 'Model', args: '[on|off]', hidden: true, summary: 'Animate every decorative surface', run: cmdRainbow },
];

const BY_NAME = new Map();
for (const c of COMMANDS) {
  BY_NAME.set(c.name, c);
  for (const a of c.aliases ?? []) if (!BY_NAME.has(a)) BY_NAME.set(a, c);
}

const cleanName = (s) => String(s ?? '').replace(/^\/+/, '').trim().toLowerCase();

/** Exact lookup by name or alias. Leading slashes are tolerated. */
export function getCommand(name) {
  const n = cleanName(name);
  if (!n) return undefined;
  return BY_NAME.get(n);
}

function scoreCommand(q, c) {
  if (c.name === q) return 100;
  if (c.name.startsWith(q)) return 80;
  for (const a of c.aliases ?? []) {
    if (a === q) return 70;
    if (a.startsWith(q)) return 55;
  }
  if (c.name.includes(q)) return 40;
  let i = 0;
  for (const ch of c.name) if (ch === q[i]) i++;
  if (i === q.length) return 20;
  if ((c.summary || '').toLowerCase().includes(q)) return 10;
  return 0;
}

/**
 * Fuzzy lookup for the autocomplete popup. Empty prefix lists every visible
 * command in registry order; hidden commands only surface on a deliberate
 * three-character prefix of their real name.
 */
export function matchCommands(prefix = '') {
  const q = cleanName(String(prefix).split(/\s+/)[0]);
  if (!q) return COMMANDS.filter((c) => !c.hidden);
  const scored = [];
  for (const c of COMMANDS) {
    if (c.hidden && (q.length < 3 || !c.name.startsWith(q))) continue;
    const s = scoreCommand(q, c);
    if (s > 0) scored.push({ c, s });
  }
  scored.sort((a, b) => b.s - a.s || a.c.name.localeCompare(b.c.name));
  return scored.map((x) => x.c);
}
