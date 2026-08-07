/**
 * tools/index.js — the real tools.
 *
 * The models are simulated; these are not. Every function here touches the
 * actual filesystem or spawns a real process, which is why the permission layer
 * sits in front of them and why every path is resolved against `ctx.cwd` and
 * rejected if it escapes.
 *
 * Each tool returns a uniform result:
 *   { ok, summary, detail?, meta?, error? }
 * `meta` is what the transcript renderer keys off to decide how to draw the
 * output (numbered source, a diff, a match list, a file grid, raw stdout).
 */

import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { unifiedDiff } from '../ui/diffview.js';

const MAX_READ_LINES = 2000;
const MAX_LINE_CHARS = 400;
const MAX_OUTPUT = 30_000;
const MAX_GLOB = 1000;

const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', '.next', 'out', 'coverage',
  '.cache', '.turbo', '.venv', 'venv', '__pycache__', 'target', '.gradle',
]);

// ── shared helpers ──────────────────────────────────────────────────────────

class ToolError extends Error {}

/** Resolve `p` inside `cwd`, refusing anything that escapes it. */
function resolveIn(cwd, p, { label = 'path' } = {}) {
  if (p === undefined || p === null || p === '') throw new ToolError(`${label} is required`);
  const root = path.resolve(cwd);
  const abs = path.resolve(root, String(p));
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new ToolError(`${p} is outside the working directory`);
  }
  return abs;
}

const rel = (cwd, abs) => path.relative(cwd, abs) || '.';

const fail = (error) => ({ ok: false, summary: error, error });

/** English plurals, enough of them: match -> matches, directory -> directories. */
function pluralise(word) {
  if (/(?:s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

const plural = (n, word) => `${n} ${n === 1 ? word : pluralise(word)}`;

async function statOrNull(p) {
  try {
    return await fs.stat(p);
  } catch {
    return null;   // caller decides whether missing is an error
  }
}

/** Null bytes in the first 8KB is the cheap, reliable binary test. */
async function looksBinary(file) {
  return new Promise((resolve) => {
    const stream = createReadStream(file, { start: 0, end: 8191 });
    let done = false;
    const finish = (v) => { if (!done) { done = true; stream.destroy(); resolve(v); } };
    stream.on('data', (chunk) => finish(chunk.includes(0)));
    stream.on('end', () => finish(false));
    stream.on('error', () => finish(false));
  });
}

function countDiff(before, after) {
  const a = before ? before.split('\n') : [];
  const b = after ? after.split('\n') : [];
  const setA = new Map();
  for (const l of a) setA.set(l, (setA.get(l) || 0) + 1);
  let same = 0;
  for (const l of b) {
    const n = setA.get(l) || 0;
    if (n > 0) { setA.set(l, n - 1); same++; }
  }
  return { added: b.length - same, removed: a.length - same };
}

// ── read ────────────────────────────────────────────────────────────────────

const read = {
  name: 'read',
  title: 'Read',
  mutating: false,
  describe: (i) => `${i.path ?? ''}${i.offset ? ` @${i.offset}` : ''}`,
  async run(input, ctx) {
    let abs;
    try {
      abs = resolveIn(ctx.cwd, input.path);
    } catch (err) {
      return fail(err.message);
    }
    const st = await statOrNull(abs);
    if (!st) return fail(`${input.path} does not exist`);
    if (st.isDirectory()) return fail(`${input.path} is a directory — use ls`);
    if (st.size > 10 * 1024 * 1024) return fail(`${input.path} is ${(st.size / 1e6).toFixed(1)}MB, too large to read`);
    if (await looksBinary(abs)) return fail(`${input.path} looks like a binary file`);

    let raw;
    try {
      raw = await fs.readFile(abs, 'utf8');
    } catch (err) {
      return fail(`could not read ${input.path}: ${err.message}`);
    }

    const all = raw.split('\n');
    // A trailing newline terminates the last line rather than starting a new
    // empty one, so counts here agree with `wc -l` and with every editor.
    if (all.length > 1 && all[all.length - 1] === '') all.pop();
    const offset = Math.max(0, (input.offset | 0) - (input.offset ? 1 : 0));
    const limit = Math.min(input.limit || MAX_READ_LINES, MAX_READ_LINES);
    const slice = all.slice(offset, offset + limit);
    const lines = slice.map((text, i) => ({
      n: offset + i + 1,
      text: text.length > MAX_LINE_CHARS ? `${text.slice(0, MAX_LINE_CHARS)}…` : text,
    }));

    const truncated = all.length > offset + slice.length;
    return {
      ok: true,
      summary: `Read ${plural(slice.length, 'line')}${truncated ? ` of ${all.length}` : ''}`,
      meta: {
        path: rel(ctx.cwd, abs), lines, totalLines: all.length,
        truncated, content: slice.join('\n'), bytes: st.size,
      },
    };
  },
};

// ── write ───────────────────────────────────────────────────────────────────

const write = {
  name: 'write',
  title: 'Write',
  mutating: true,
  describe: (i) => i.path ?? '',
  async run(input, ctx) {
    let abs;
    try {
      abs = resolveIn(ctx.cwd, input.path);
    } catch (err) {
      return fail(err.message);
    }
    const content = String(input.content ?? '');
    const st = await statOrNull(abs);
    if (st?.isDirectory()) return fail(`${input.path} is a directory`);

    let before = '';
    const created = !st;
    if (st) {
      try {
        before = await fs.readFile(abs, 'utf8');
      } catch {
        before = '';   // unreadable existing file is treated as an overwrite
      }
    }
    if (before === content) {
      return {
        ok: true,
        summary: 'No change — file already had this content',
        meta: { path: rel(ctx.cwd, abs), created: false, added: 0, removed: 0, bytes: Buffer.byteLength(content) },
      };
    }

    try {
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, 'utf8');
    } catch (err) {
      return fail(`could not write ${input.path}: ${err.message}`);
    }

    const { added, removed } = countDiff(before, content);
    const p = rel(ctx.cwd, abs);
    return {
      ok: true,
      summary: created
        ? `Created ${p} (${plural(content.split('\n').length, 'line')})`
        : `Updated ${p} (+${added} -${removed})`,
      meta: {
        path: p, created, added, removed,
        bytes: Buffer.byteLength(content),
        diff: created ? null : unifiedDiff(before, content, { path: p }),
        content: created ? content : null,
      },
    };
  },
};

// ── edit ────────────────────────────────────────────────────────────────────

function applyEdit(source, { old_string: oldStr, new_string: newStr, replace_all: all }, label) {
  if (typeof oldStr !== 'string' || oldStr === '') {
    throw new ToolError(`${label}: old_string is required`);
  }
  if (oldStr === newStr) throw new ToolError(`${label}: old_string and new_string are identical`);

  let count = 0;
  let from = 0;
  for (;;) {
    const at = source.indexOf(oldStr, from);
    if (at === -1) break;
    count++;
    from = at + oldStr.length;
    if (count > 1 && !all) break;
  }
  if (count === 0) throw new ToolError(`${label}: old_string not found`);
  if (count > 1 && !all) {
    throw new ToolError(`${label}: old_string matches ${count}+ times — pass replace_all or include more context`);
  }
  return {
    text: all ? source.split(oldStr).join(String(newStr ?? '')) : source.replace(oldStr, () => String(newStr ?? '')),
    count: all ? count : 1,
  };
}

const edit = {
  name: 'edit',
  title: 'Edit',
  mutating: true,
  describe: (i) => `${i.path ?? ''}${i.replace_all ? ' (all)' : ''}`,
  async run(input, ctx) {
    return multiedit.run(
      { path: input.path, edits: [input] },
      ctx,
      { title: 'Edit' },
    );
  },
};

const multiedit = {
  name: 'multiedit',
  title: 'Multi-Edit',
  mutating: true,
  describe: (i) => `${i.path ?? ''} (edits=${i.edits?.length ?? 0})`,
  async run(input, ctx) {
    let abs;
    try {
      abs = resolveIn(ctx.cwd, input.path);
    } catch (err) {
      return fail(err.message);
    }
    const st = await statOrNull(abs);
    if (!st) return fail(`${input.path} does not exist`);
    if (st.isDirectory()) return fail(`${input.path} is a directory`);

    let before;
    try {
      before = await fs.readFile(abs, 'utf8');
    } catch (err) {
      return fail(`could not read ${input.path}: ${err.message}`);
    }

    const edits = Array.isArray(input.edits) ? input.edits : [];
    if (!edits.length) return fail('no edits supplied');

    // Build the whole result in memory so a late failure leaves the file alone.
    let text = before;
    let replaced = 0;
    try {
      for (let i = 0; i < edits.length; i++) {
        const res = applyEdit(text, edits[i], `edit ${i + 1}`);
        text = res.text;
        replaced += res.count;
      }
    } catch (err) {
      return fail(err.message);
    }

    if (text === before) {
      return { ok: true, summary: 'No change', meta: { path: rel(ctx.cwd, abs), added: 0, removed: 0 } };
    }

    try {
      await fs.writeFile(abs, text, 'utf8');
    } catch (err) {
      return fail(`could not write ${input.path}: ${err.message}`);
    }

    const p = rel(ctx.cwd, abs);
    const { added, removed } = countDiff(before, text);
    return {
      ok: true,
      summary: `${plural(replaced, 'replacement')} in ${p} (+${added} -${removed})`,
      meta: { path: p, added, removed, created: false, diff: unifiedDiff(before, text, { path: p }) },
    };
  },
};

// ── bash ────────────────────────────────────────────────────────────────────

const bash = {
  name: 'bash',
  title: 'Bash',
  mutating: true,
  describe: (i) => String(i.command ?? '').replace(/\s+/g, ' ').slice(0, 80),
  async run(input, ctx) {
    const command = String(input.command ?? '').trim();
    if (!command) return fail('no command given');

    let cwd = ctx.cwd;
    if (input.cwd) {
      try {
        cwd = resolveIn(ctx.cwd, input.cwd);
      } catch (err) {
        return fail(err.message);
      }
    }

    const timeout = Math.min(Math.max(input.timeout || 120_000, 1000), 600_000);

    // On Windows there is no /bin/sh or $SHELL; cmd.exe is the portable shell
    // and /d /s /c swallows the command string the same way `sh -c` does.
    const isWin = process.platform === 'win32';
    const shell = isWin
      ? process.env.ComSpec || 'cmd.exe'
      : process.env.SHELL && !process.env.SHELL.includes('fish')
        ? process.env.SHELL
        : '/bin/sh';
    const shellArgs = (command) =>
      isWin ? ['/d', '/s', '/c', command] : ['-c', command];

    // Windows signals are process-local: `child.kill('SIGTERM')` would leave
    // grandchildren running (and hold the cwd lock). taskkill /t /f tears down
    // the whole tree. On POSIX the signal path works as-is.
    const killTree = (child, signal) => {
      if (isWin && child.pid) {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
          stdio: 'ignore',
        });
        killer.on('error', () => { try { child.kill('SIGKILL'); } catch { /* gone */ } });
      } else {
        try { child.kill(signal); } catch { /* already gone */ }
      }
    };

    const startedAt = Date.now();

    return new Promise((resolve) => {
      let child;
      try {
        child = spawn(shell, shellArgs(command), {
          cwd,
          env: { ...process.env, ASTROCODE: '1', TERM: process.env.TERM || 'xterm-256color' },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (err) {
        resolve(fail(`could not start shell: ${err.message}`));
        return;
      }

      let stdout = '';
      let stderr = '';
      let truncated = false;
      let timedOut = false;
      let settled = false;

      const append = (which, chunk) => {
        const s = chunk.toString('utf8');
        if (which === 'out') {
          if (stdout.length < MAX_OUTPUT) stdout += s;
          else truncated = true;
        } else if (stderr.length < MAX_OUTPUT) stderr += s;
        else truncated = true;
      };

      child.stdout.on('data', (c) => append('out', c));
      child.stderr.on('data', (c) => append('err', c));

      const kill = (signal) => killTree(child, signal);

      const timer = setTimeout(() => {
        timedOut = true;
        kill('SIGTERM');
        setTimeout(() => kill('SIGKILL'), 2000).unref?.();
      }, timeout);
      timer.unref?.();

      const onAbort = () => { kill('SIGTERM'); setTimeout(() => kill('SIGKILL'), 1000).unref?.(); };
      ctx.signal?.addEventListener('abort', onAbort, { once: true });

      const done = (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        ctx.signal?.removeEventListener('abort', onAbort);

        const durationMs = Date.now() - startedAt;
        const out = stdout.slice(0, MAX_OUTPUT);
        const err = stderr.slice(0, MAX_OUTPUT);
        const combined = [out, err].filter((s) => s.trim()).join('\n');
        const aborted = ctx.signal?.aborted;

        const meta = {
          code, stdout: combined, rawStdout: out, stderr: err,
          durationMs, timedOut, truncated, command,
        };

        if (timedOut) {
          resolve({ ok: false, summary: `Timed out after ${Math.round(timeout / 1000)}s`, error: 'timeout', meta });
          return;
        }
        if (aborted) {
          resolve({ ok: false, summary: 'Interrupted', error: 'aborted', meta });
          return;
        }
        const lines = combined ? combined.trimEnd().split('\n').length : 0;
        resolve({
          ok: code === 0,
          summary: code === 0
            ? `Exited 0 in ${fmtMs(durationMs)}${lines ? ` · ${plural(lines, 'line')}` : ''}`
            : `Exited ${code} in ${fmtMs(durationMs)}`,
          error: code === 0 ? undefined : (firstLine(err) || `exit code ${code}`),
          meta,
        });
      };

      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fail(`shell error: ${err.message}`));
      });
      child.on('close', (code, signal) => done(code === null ? (signal || 'killed') : code));
    });
  },
};

const fmtMs = (ms) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);
const firstLine = (s) => String(s || '').trim().split('\n')[0];

// ── ls ──────────────────────────────────────────────────────────────────────

const ls = {
  name: 'ls',
  title: 'List',
  mutating: false,
  describe: (i) => i.path || '.',
  async run(input, ctx) {
    let abs;
    try {
      abs = resolveIn(ctx.cwd, input.path || '.');
    } catch (err) {
      return fail(err.message);
    }
    const st = await statOrNull(abs);
    if (!st) return fail(`${input.path || '.'} does not exist`);
    if (!st.isDirectory()) return fail(`${input.path} is not a directory — use read`);

    let entries;
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch (err) {
      return fail(`could not list: ${err.message}`);
    }

    const here = path.basename(abs);
    const dirs = [];
    const files = [];
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name) && e.name !== here) continue;
      if (e.isDirectory()) dirs.push(`${e.name}/`);
      else files.push(e.name);
    }
    dirs.sort();
    files.sort();
    const all = [...dirs, ...files];

    return {
      ok: true,
      summary: `${plural(dirs.length, 'directory')}, ${plural(files.length, 'file')}`,
      meta: { path: rel(ctx.cwd, abs), files: all, dirs, fileNames: files },
    };
  },
};

// ── glob ────────────────────────────────────────────────────────────────────

/**
 * Translate a glob into a RegExp. `**` crosses separators, `*` and `?` do not.
 * Supports `{a,b}` alternation and `[...]` classes.
 */
export function globToRegExp(pattern, { dot = false } = {}) {
  const p = String(pattern);
  let re = '';
  let i = 0;
  const groups = [];

  while (i < p.length) {
    const c = p[i];
    if (c === '\\') { re += escapeRe(p[i + 1] ?? '\\'); i += 2; continue; }
    if (c === '*') {
      if (p[i + 1] === '*') {
        let j = i + 2;
        if (p[j] === '/') j++;
        // `**/` may also match zero directories
        re += p[i + 2] === '/' ? '(?:[^/]*\\/)*' : '.*';
        i = j;
        continue;
      }
      re += dot ? '[^/]*' : '(?!\\.)[^/]*';
      i++;
      continue;
    }
    if (c === '?') { re += '[^/]'; i++; continue; }
    if (c === '{') { groups.push(true); re += '(?:'; i++; continue; }
    if (c === '}' && groups.length) { groups.pop(); re += ')'; i++; continue; }
    if (c === ',' && groups.length) { re += '|'; i++; continue; }
    if (c === '[') {
      const end = p.indexOf(']', i + 1);
      if (end === -1) { re += '\\['; i++; continue; }
      let body = p.slice(i + 1, end);
      if (body[0] === '!') body = `^${body.slice(1)}`;
      re += `[${body}]`;
      i = end + 1;
      continue;
    }
    re += escapeRe(c);
    i++;
  }
  while (groups.length) { groups.pop(); re += ')'; }
  return new RegExp(`^${re}$`);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function walk(root, { onFile, skip = SKIP_DIRS, maxDepth = 12, limit = Infinity }) {
  let count = 0;
  const queue = [{ dir: root, depth: 0 }];
  while (queue.length) {
    const { dir, depth } = queue.shift();
    if (depth > maxDepth || count >= limit) break;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;   // unreadable directories are skipped, not fatal
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (skip.has(e.name)) continue;
        queue.push({ dir: full, depth: depth + 1 });
      } else if (e.isFile()) {
        count++;
        if (count > limit) return;
        await onFile(full);
      }
    }
  }
}

const glob = {
  name: 'glob',
  title: 'Glob',
  mutating: false,
  describe: (i) => `${i.pattern ?? ''}${i.path ? ` in ${i.path}` : ''}`,
  async run(input, ctx) {
    const pattern = String(input.pattern ?? '').trim();
    if (!pattern) return fail('no pattern given');
    let root;
    try {
      root = resolveIn(ctx.cwd, input.path || '.');
    } catch (err) {
      return fail(err.message);
    }

    // Honour a pattern that deliberately reaches into an ignored directory.
    const skip = new Set(SKIP_DIRS);
    for (const d of SKIP_DIRS) if (pattern.includes(d)) skip.delete(d);

    const re = globToRegExp(pattern);
    const hits = [];
    await walk(root, {
      skip,
      limit: 40_000,
      onFile: async (full) => {
        if (hits.length >= MAX_GLOB) return;
        const r = path.relative(root, full);
        if (re.test(r) || re.test(path.basename(r))) {
          const st = await statOrNull(full);
          hits.push({ file: path.relative(ctx.cwd, full), mtime: st?.mtimeMs ?? 0 });
        }
      },
    });

    hits.sort((a, b) => b.mtime - a.mtime);
    const files = hits.map((h) => h.file);
    return {
      ok: true,
      summary: files.length ? `${plural(files.length, 'file')} matched` : 'No files matched',
      meta: { pattern, files, count: files.length },
    };
  },
};

// ── grep ────────────────────────────────────────────────────────────────────

const grep = {
  name: 'grep',
  title: 'Grep',
  mutating: false,
  describe: (i) => `${i.pattern ?? ''}${i.glob ? ` (${i.glob})` : ''}${i.path ? ` in ${i.path}` : ''}`,
  async run(input, ctx) {
    const raw = String(input.pattern ?? '');
    if (!raw) return fail('no pattern given');
    let re;
    try {
      re = new RegExp(raw, input.ignoreCase ? 'gi' : 'g');
    } catch (err) {
      return fail(`invalid pattern: ${err.message}`);
    }

    let root;
    try {
      root = resolveIn(ctx.cwd, input.path || '.');
    } catch (err) {
      return fail(err.message);
    }

    const st = await statOrNull(root);
    if (!st) return fail(`${input.path} does not exist`);

    const fileRe = input.glob ? globToRegExp(input.glob) : null;
    const max = Math.min(input.maxResults || 200, 2000);
    const matches = [];
    const seenFiles = new Set();

    const scan = async (full) => {
      if (matches.length >= max) return;
      const r = path.relative(ctx.cwd, full);
      if (fileRe && !fileRe.test(path.relative(root, full)) && !fileRe.test(path.basename(full))) return;
      const s = await statOrNull(full);
      if (!s || s.size > 2 * 1024 * 1024) return;
      if (await looksBinary(full)) return;
      let text;
      try {
        text = await fs.readFile(full, 'utf8');
      } catch {
        return;   // vanished or unreadable between walk and read
      }
      const lines = text.split('\n');
      for (let i = 0; i < lines.length && matches.length < max; i++) {
        re.lastIndex = 0;
        if (re.test(lines[i])) {
          seenFiles.add(r);
          matches.push({
            file: r,
            line: i + 1,
            text: lines[i].length > MAX_LINE_CHARS ? `${lines[i].slice(0, MAX_LINE_CHARS)}…` : lines[i],
          });
        }
      }
    };

    if (st.isFile()) await scan(root);
    else await walk(root, { limit: 20_000, onFile: scan });

    return {
      ok: true,
      summary: matches.length
        ? `${plural(matches.length, 'match')} in ${plural(seenFiles.size, 'file')}`
        : 'No matches',
      meta: { pattern: raw, matches, files: [...seenFiles], count: matches.length },
    };
  },
};

// ── todo ────────────────────────────────────────────────────────────────────

const VALID_STATUS = new Set(['pending', 'in_progress', 'completed']);

const todo = {
  name: 'todo',
  title: 'Todo',
  mutating: false,
  describe: (i) => `${i.todos?.length ?? 0} items`,
  async run(input, ctx) {
    const list = Array.isArray(input.todos) ? input.todos : [];
    const clean = list
      .filter((t) => t && typeof t.content === 'string' && t.content.trim())
      .map((t) => ({
        content: t.content.trim(),
        status: VALID_STATUS.has(t.status) ? t.status : 'pending',
      }));
    if (ctx.session) ctx.session.todos = clean;
    const done = clean.filter((t) => t.status === 'completed').length;
    return {
      ok: true,
      summary: `${done}/${clean.length} complete`,
      meta: { todos: clean },
    };
  },
};

// ── registry ────────────────────────────────────────────────────────────────

export const TOOLS = { read, write, edit, multiedit, bash, ls, glob, grep, todo };

export function getTool(name) {
  return TOOLS[String(name ?? '').toLowerCase()];
}

export function toolNames() {
  return Object.keys(TOOLS);
}

/**
 * Run a tool by name with uniform error handling. Anything a tool throws
 * becomes a failed result rather than an exception the caller has to catch.
 */
export async function runTool(name, input, ctx) {
  const t = getTool(name);
  if (!t) return fail(`unknown tool "${name}"`);
  try {
    const res = await t.run(input || {}, ctx);
    return res || fail(`${name} returned nothing`);
  } catch (err) {
    return fail(err instanceof ToolError ? err.message : `${name} failed: ${err.message}`);
  }
}

export { ToolError, resolveIn, countDiff };
