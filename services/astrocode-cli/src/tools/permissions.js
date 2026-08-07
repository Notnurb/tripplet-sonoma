/**
 * permissions.js — the gate every tool call passes through.
 *
 * `check()` is a pure, synchronous function of (mode, rules, tool, input): the
 * UI needs a decision to render *now*, and a pure decision is the only kind
 * that is honestly testable.
 *
 * Two things ignore the mode entirely, `yolo` included: catastrophic shell
 * commands, and file mutations that land outside the working directory. Those
 * are safety rails, not policy. Everything else is policy.
 *
 * The read-only classifier is a conservative allowlist on the first token (plus
 * a subcommand for drivers like git/npm). Unknown commands are never read-only,
 * because the cost of guessing wrong is asymmetric.
 */

import path from 'node:path';
import os from 'node:os';

export const MODES = ['ask', 'acceptEdits', 'plan', 'yolo'];

const MODE_ALIASES = new Map([
  ['ask', 'ask'], ['default', 'ask'], ['prompt', 'ask'], ['confirm', 'ask'],
  ['acceptedits', 'acceptEdits'], ['accept-edits', 'acceptEdits'], ['edits', 'acceptEdits'],
  ['auto', 'acceptEdits'], ['acceptedit', 'acceptEdits'],
  ['plan', 'plan'], ['planning', 'plan'], ['readonly', 'plan'], ['read-only', 'plan'],
  ['yolo', 'yolo'], ['bypass', 'yolo'], ['bypasspermissions', 'yolo'], ['danger', 'yolo'],
  ['dangerous', 'yolo'], ['all', 'yolo'],
]);

/** Canonical mode name, or undefined. Accepts `accept-edits`, `AcceptEdits`, ... */
export function normaliseMode(mode) {
  const n = String(mode ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  return MODE_ALIASES.get(n) || MODE_ALIASES.get(n.replace(/-/g, ''));
}

// ── tool taxonomy ───────────────────────────────────────────────────────────

const TOOL_TITLES = {
  read: 'Read', write: 'Write', edit: 'Edit', multiedit: 'MultiEdit',
  bash: 'Bash', ls: 'List', glob: 'Glob', grep: 'Grep', todo: 'Todo',
};

/** Tools that only ever observe. `bash` is judged per command instead. */
const READ_ONLY_TOOLS = new Set(['read', 'ls', 'glob', 'grep', 'todo']);
/** Tools that touch the filesystem. */
const MUTATING_TOOLS = new Set(['write', 'edit', 'multiedit']);

const TOOL_ALIASES = new Map();
for (const [id, title] of Object.entries(TOOL_TITLES)) {
  TOOL_ALIASES.set(id, id);
  TOOL_ALIASES.set(title.toLowerCase(), id);
}
TOOL_ALIASES.set('multi-edit', 'multiedit');
TOOL_ALIASES.set('multi_edit', 'multiedit');
TOOL_ALIASES.set('shell', 'bash');
TOOL_ALIASES.set('todowrite', 'todo');
TOOL_ALIASES.set('todos', 'todo');

const toolId = (name) => {
  const raw = String(name ?? '').trim().toLowerCase();
  return TOOL_ALIASES.get(raw) || raw;
};

/** The single argument a permission rule is written against. */
function targetOf(tool, input = {}) {
  const i = input || {};
  if (tool === 'bash') return String(i.command ?? '');
  if (tool === 'glob' || tool === 'grep') return String(i.pattern ?? '');
  return String(i.path ?? i.file_path ?? i.file ?? '');
}

// ── shell lexing ────────────────────────────────────────────────────────────

/**
 * Split a command line into simple commands on `;` `|` `&&` `||` `&` and
 * newlines, respecting quotes. Redirection operators stay inside the segment.
 */
function segments(cmd) {
  const out = [];
  let cur = '';
  let quote = null;
  const push = () => { const s = cur.trim(); if (s) out.push(s); cur = ''; };
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote) {
      if (c === '\\' && quote === '"') { cur += c + (cmd[i + 1] ?? ''); i++; continue; }
      cur += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === '\\') { cur += c + (cmd[i + 1] ?? ''); i++; continue; }
    if (c === '\'' || c === '"') { quote = c; cur += c; continue; }
    if (c === '&' && cmd[i + 1] === '>') { cur += '&>'; i++; continue; }
    if ((c === '&' && cmd[i + 1] === '&') || (c === '|' && cmd[i + 1] === '|')) { push(); i++; continue; }
    if (c === ';' || c === '|' || c === '&' || c === '\n') { push(); continue; }
    cur += c;
  }
  push();
  return out;
}

const SUBST_RE = /\$\(([^()]*)\)|`([^`]*)`/g;

/** Bodies of `$(...)` / backtick substitutions, so they can be judged too. */
function substitutions(cmd) {
  const out = [];
  SUBST_RE.lastIndex = 0;
  let m;
  while ((m = SUBST_RE.exec(cmd))) out.push(m[1] ?? m[2] ?? '');
  return out;
}

const stripSubstitutions = (cmd) => cmd.replace(SUBST_RE, ' ');

/** Words (quotes removed) plus output redirections for one simple command. */
function lex(seg) {
  const words = [];
  const redirects = [];
  let cur = '';
  let started = false;
  let quote = null;
  const flush = () => { if (started) { words.push(cur); cur = ''; started = false; } };
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (quote) {
      if (c === quote) { quote = null; continue; }
      if (c === '\\' && quote === '"') { cur += seg[i + 1] ?? ''; i++; started = true; continue; }
      cur += c; started = true; continue;
    }
    if (c === '\\') { cur += seg[i + 1] ?? ''; i++; started = true; continue; }
    if (c === '\'' || c === '"') { quote = c; started = true; continue; }
    if (c === ' ' || c === '\t') { flush(); continue; }
    if (c === '>' || c === '<') {
      let op = c;
      if (seg[i + 1] === '>') { op = '>>'; i++; }
      else if (seg[i + 1] === '&') { op = c + '&'; i++; }
      // a bare fd prefix (`2>`) belongs to the operator, not to the argv
      if (started && /^\d$/.test(cur)) { cur = ''; started = false; } else flush();
      let j = i + 1;
      while (seg[j] === ' ' || seg[j] === '\t') j++;
      let target = '';
      let q2 = null;
      while (j < seg.length) {
        const d = seg[j];
        if (q2) { if (d === q2) q2 = null; else target += d; j++; continue; }
        if (d === '\'' || d === '"') { q2 = d; j++; continue; }
        if (d === ' ' || d === '\t' || d === '>' || d === '<') break;
        target += d; j++;
      }
      redirects.push({ op, target });
      i = j - 1;
      continue;
    }
    cur += c; started = true;
  }
  flush();
  return { words, redirects };
}

/** Drop `FOO=bar` prefixes; return the argv proper. */
function argv(words) {
  let i = 0;
  while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i++;
  return words.slice(i);
}

// ── read-only classification ────────────────────────────────────────────────

const READ_ONLY = new Set([
  'ls', 'll', 'la', 'cat', 'bat', 'pwd', 'echo', 'printf', 'head', 'tail', 'wc',
  'which', 'whereis', 'type', 'file', 'stat', 'du', 'df', 'tree', 'grep', 'egrep',
  'fgrep', 'rg', 'ag', 'ack', 'sort', 'uniq', 'cut', 'tr', 'rev', 'nl', 'tac',
  'column', 'fold', 'expand', 'unexpand', 'join', 'paste', 'comm', 'diff', 'cmp',
  'basename', 'dirname', 'realpath', 'readlink', 'date', 'cal', 'seq', 'whoami',
  'id', 'groups', 'hostname', 'uname', 'printenv', 'locale', 'ps', 'uptime',
  'free', 'jobs', 'history', 'man', 'info', 'less', 'more', 'xxd', 'od', 'strings',
  'base64', 'md5', 'md5sum', 'shasum', 'sha1sum', 'sha256sum', 'cksum', 'jq', 'yq',
  'true', 'false', 'test', 'sleep', 'pgrep', 'lsof', 'tty', 'arch', 'nproc',
  'dircolors', 'getconf',
]);

/** First token allowed only when every remaining word is a version/help flag. */
const VERSION_ONLY = new Set([
  'node', 'python', 'python3', 'ruby', 'java', 'javac', 'gcc', 'g++', 'clang',
  'rustc', 'tsc', 'make', 'cmake', 'php', 'perl', 'swift', 'dotnet', 'mvn',
  'gradle', 'esbuild', 'vite', 'webpack', 'jest', 'vitest', 'eslint', 'prettier',
]);

const VERSION_FLAGS = new Set(['--version', '-v', '-V', '--help', '-h', 'version', 'help']);

const GIT_READ = new Set([
  'status', 'log', 'diff', 'show', 'describe', 'rev-parse', 'ls-files', 'ls-tree',
  'ls-remote', 'blame', 'annotate', 'shortlog', 'cat-file', 'name-rev',
  'whatchanged', 'grep', 'count-objects', 'symbolic-ref', 'var', 'check-ignore',
  'verify-commit', 'for-each-ref', 'merge-base', 'rev-list', 'show-ref',
  'diff-tree', 'diff-index', 'help', 'version',
]);

/** git subcommands that are read-only only under a guard. */
const GIT_GUARDED = {
  branch: (a) => !a.some((w) => !w.startsWith('-')) && !a.some(isBranchMutation),
  tag: (a) => !a.some((w) => !w.startsWith('-')) && !a.some(isBranchMutation),
  remote: (a) => a.filter((w) => !w.startsWith('-')).every((w) => w === 'show' || w === 'get-url'),
  config: (a) => a.some((w) => ['--get', '--get-all', '--get-regexp', '--list', '-l'].includes(w)),
  stash: (a) => ['list', 'show'].includes(a.find((w) => !w.startsWith('-')) ?? ''),
  worktree: (a) => a.find((w) => !w.startsWith('-')) === 'list',
  submodule: (a) => ['status', 'summary'].includes(a.find((w) => !w.startsWith('-')) ?? ''),
  notes: (a) => ['list', 'show'].includes(a.find((w) => !w.startsWith('-')) ?? ''),
  bisect: (a) => a.find((w) => !w.startsWith('-')) === 'log',
  reflog: (a) => !['delete', 'expire'].includes(a.find((w) => !w.startsWith('-')) ?? ''),
};

const isBranchMutation = (w) =>
  /^-[a-zA-Z]*[dDmMcCf]$/.test(w) ||
  ['--delete', '--move', '--copy', '--force', '--set-upstream-to', '--unset-upstream',
    '--edit-description'].includes(w);

const SUBCOMMANDS = {
  npm: {
    read: new Set(['ls', 'list', 'll', 'la', 'view', 'info', 'show', 'search', 'outdated',
      'why', 'whoami', 'root', 'prefix', 'bin', 'ping', 'doctor', 'explain', 'fund', 'docs', 'help']),
    guarded: {
      config: (a) => ['get', 'list', 'ls'].includes(a[0]),
      pkg: (a) => a[0] === 'get',
      audit: (a) => a[0] !== 'fix',
    },
  },
  pnpm: {
    read: new Set(['ls', 'list', 'why', 'outdated', 'info', 'view', 'licenses', 'root', 'bin', 'help']),
    guarded: { audit: (a) => a[0] !== '--fix' },
  },
  yarn: {
    read: new Set(['why', 'info', 'list', 'bin', 'versions', 'outdated', 'help']),
    guarded: {},
  },
  bun: { read: new Set(['pm', 'outdated', 'why', 'info', 'help']), guarded: {} },
  cargo: {
    read: new Set(['tree', 'metadata', 'search', 'help', 'locate-project', 'verify-project',
      'read-manifest', 'pkgid']),
    guarded: {},
  },
  go: { read: new Set(['version', 'list', 'doc']), guarded: { env: (a) => !a.some((w) => w === '-w' || w === '-u') } },
  docker: {
    read: new Set(['ps', 'images', 'version', 'info', 'inspect', 'logs', 'stats', 'top',
      'port', 'history', 'search', 'diff']),
    guarded: {},
  },
  kubectl: {
    read: new Set(['get', 'describe', 'logs', 'explain', 'version', 'api-resources',
      'api-versions', 'top', 'cluster-info']),
    guarded: {},
  },
  brew: { read: new Set(['list', 'info', 'search', 'outdated', 'config', 'deps', 'home', 'help']), guarded: {} },
  pip: { read: new Set(['list', 'show', 'freeze', 'search', 'check', 'help']), guarded: {} },
  pip3: { read: new Set(['list', 'show', 'freeze', 'search', 'check', 'help']), guarded: {} },
  deno: { read: new Set(['info', 'doc', 'help']), guarded: {} },
};

/** `find` writes when asked to; `sed -i` and `awk '{print > f}'` too. */
function guardedSingleton(cmd, rest) {
  if (cmd === 'find') {
    return !rest.some((w) => ['-delete', '-exec', '-execdir', '-ok', '-okdir', '-fls',
      '-fprint', '-fprintf', '-fprint0'].includes(w));
  }
  if (cmd === 'sed') return !rest.some((w) => w === '-i' || w === '--in-place' || /^-[a-zA-Z]*i$/.test(w));
  if (cmd === 'awk' || cmd === 'gawk' || cmd === 'mawk') return !rest.some((w) => w.includes('>'));
  if (cmd === 'env') return rest.length === 0;
  return null;
}

function isReadOnlySegment(seg) {
  const { words, redirects } = lex(seg);
  for (const r of redirects) {
    if (r.op !== '>' && r.op !== '>>') continue;
    if (!/^\/dev\/(null|stdout|stderr|fd\/\d+)$/.test(r.target)) return false;
  }
  const a = argv(words);
  if (!a.length) return words.length === 0;
  if (a.some((w) => w === '--output' || w.startsWith('--output='))) return false;

  const cmd = path.basename(a[0]);
  const rest = a.slice(1);

  const guard = guardedSingleton(cmd, rest);
  if (guard !== null) return guard;

  if (cmd === 'git') return isReadOnlyGit(rest);

  const table = SUBCOMMANDS[cmd];
  if (table) {
    const sub = rest.find((w) => !w.startsWith('-'));
    if (!sub) return rest.every((w) => VERSION_FLAGS.has(w));
    if (table.read.has(sub)) return true;
    const g = table.guarded[sub];
    return g ? g(rest.slice(rest.indexOf(sub) + 1)) : false;
  }

  if (READ_ONLY.has(cmd)) return true;
  if (VERSION_ONLY.has(cmd)) return rest.length > 0 && rest.every((w) => VERSION_FLAGS.has(w));
  return false;
}

function isReadOnlyGit(rest) {
  // skip the global options that take a value before the subcommand
  let i = 0;
  while (i < rest.length) {
    const w = rest[i];
    if (w === '-C' || w === '-c' || w === '--git-dir' || w === '--work-tree') { i += 2; continue; }
    if (w.startsWith('-')) {
      if (VERSION_FLAGS.has(w)) return true;
      i++;
      continue;
    }
    break;
  }
  const sub = rest[i];
  if (!sub) return true; // bare `git` prints usage
  const args = rest.slice(i + 1);
  if (GIT_READ.has(sub)) return true;
  const g = GIT_GUARDED[sub];
  return g ? g(args) : false;
}

/**
 * Conservative: true only when every simple command (including anything inside
 * a `$(...)`) is on the allowlist and nothing redirects into a file.
 */
export function isReadOnlyCommand(command) {
  const text = String(command ?? '').trim();
  if (!text) return false;
  const segs = segments(text);
  for (const inner of substitutions(text)) segs.push(...segments(inner));
  if (!segs.length) return false;
  // an unbalanced or nested substitution is beyond this parser — refuse it
  if (/\$\(|`/.test(stripSubstitutions(text))) return false;
  return segs.every(isReadOnlySegment);
}

// ── destructive command detection ───────────────────────────────────────────

const PROTECTED_ROOTS = new Set([
  'bin', 'boot', 'dev', 'etc', 'home', 'lib', 'lib32', 'lib64', 'opt', 'proc',
  'root', 'sbin', 'srv', 'sys', 'usr', 'var', 'private', 'Users', 'Applications',
  'System', 'Library', 'Volumes', 'Windows',
]);

/** Prefixes that just run another command — look past them. */
const RUNNERS = new Set(['sudo', 'doas', 'nice', 'nohup', 'ionice', 'stdbuf', 'command', 'exec']);

function expandHome(p, home) {
  return String(p)
    .replace(/^~(?=$|\/)/, home)
    .replace(/\$\{HOME\}|\$HOME(?=$|\/)/g, home);
}

/** Is this path the filesystem root, a system root, or the user's home? */
function isProtectedPath(raw, home) {
  let p = expandHome(raw, home).replace(/^['"]|['"]$/g, '');
  if (!p) return false;
  p = p.replace(/\/(\*|\.\*|\.)$/, '/');
  if (!p.startsWith('/')) return false;
  const norm = path.posix.normalize(p).replace(/\/+$/, '') || '/';
  if (norm === '/') return true;
  const homeNorm = home.replace(/\/+$/, '');
  if (homeNorm && norm === homeNorm) return true;
  const parts = norm.split('/').filter(Boolean);
  return parts.length === 1 && PROTECTED_ROOTS.has(parts[0]);
}

const hasFlag = (words, short, long) =>
  words.some((w) => (w.startsWith('--') ? w === long : /^-[a-zA-Z]+$/.test(w) && w.includes(short)));

function destructiveSegment(seg, home) {
  const { words, redirects } = lex(seg);
  let a = argv(words);
  while (a.length && RUNNERS.has(path.basename(a[0]))) a = a.slice(1);
  if (!a.length) {
    for (const r of redirects) {
      if ((r.op === '>' || r.op === '>>') && /^\/dev\/(sd|nvme|hd|disk|rdisk|mmcblk)/.test(r.target)) {
        return 'writing straight to a block device destroys the disk';
      }
    }
    return null;
  }
  const cmd = path.basename(a[0]);
  const rest = a.slice(1);
  const positional = rest.filter((w) => !w.startsWith('-'));

  for (const r of redirects) {
    if ((r.op === '>' || r.op === '>>') && /^\/dev\/(sd|nvme|hd|disk|rdisk|mmcblk)/.test(r.target)) {
      return 'writing straight to a block device destroys the disk';
    }
  }

  if (cmd === 'rm') {
    if (rest.includes('--no-preserve-root')) return '`rm --no-preserve-root` is never survivable';
    const recursive = hasFlag(rest, 'r', '--recursive') || hasFlag(rest, 'R', '--recursive');
    const target = positional.find((p) => isProtectedPath(p, home));
    if (target && (recursive || target === '/')) {
      return `\`rm\` would recursively delete ${target}`;
    }
  }
  if (cmd.startsWith('mkfs')) return `\`${cmd}\` would reformat a filesystem`;
  if (cmd === 'dd') {
    const of = rest.find((w) => w.startsWith('of='));
    if (of && /^of=\/dev\//.test(of)) return '`dd` writing to a device node overwrites the disk';
  }
  if (cmd === 'shred' && positional.some((p) => p.startsWith('/dev/'))) {
    return '`shred` on a device node destroys the disk';
  }
  if ((cmd === 'chmod' || cmd === 'chown') && hasFlag(rest, 'R', '--recursive')) {
    if (positional.some((p) => isProtectedPath(p, home))) {
      return `recursive \`${cmd}\` on a system directory breaks the machine`;
    }
  }
  if (cmd === 'mv' && positional.length >= 2 && isProtectedPath(positional[0], home)) {
    return `moving ${positional[0]} would break the machine`;
  }
  return null;
}

// ── permission rules ────────────────────────────────────────────────────────

const GLOB_CHARS = /[*?[\]{}]/;

// Windows paths are case-insensitive; comparing raw strings there would let a
// rule like `Write(Src/Foo.js)` silently fail to protect (or approve) a path
// typed with different casing. On POSIX paths stay case-sensitive.
const IS_WIN = process.platform === 'win32';
const pathEq = (a, b) => (IS_WIN ? a.toLowerCase() === b.toLowerCase() : a === b);
const pathStarts = (a, b) =>
  IS_WIN ? a.toLowerCase().startsWith(b.toLowerCase()) : a.startsWith(b);

/**
 * Minimal pattern -> RegExp. `**` crosses separators, `*` does not (unless
 * `anySlash`, which is what command patterns want).
 */
function ruleRegExp(pattern, anySlash = false, ci = false) {
  const star = anySlash ? '.*' : '[^/]*';
  let re = '';
  let depth = 0;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') { re += escapeRe(pattern[i + 1] ?? ''); i++; continue; }
    if (c === '*') {
      if (pattern[i + 1] === '*') { while (pattern[i + 1] === '*') i++; re += '.*'; continue; }
      re += star;
      continue;
    }
    if (c === '?') { re += anySlash ? '.' : '[^/]'; continue; }
    if (c === '{') { depth++; re += '(?:'; continue; }
    if (c === '}' && depth) { depth--; re += ')'; continue; }
    if (c === ',' && depth) { re += '|'; continue; }
    if (c === '[') {
      const end = pattern.indexOf(']', pattern[i + 1] === ']' ? i + 2 : i + 1);
      if (end === -1) { re += '\\['; continue; }
      let body = pattern.slice(i + 1, end);
      const neg = body[0] === '!' || body[0] === '^';
      if (neg) body = body.slice(1);
      re += `[${neg ? '^' : ''}${body.replace(/\\/g, '\\\\')}]`;
      i = end;
      continue;
    }
    re += escapeRe(c);
  }
  while (depth-- > 0) re += ')';
  return new RegExp(`^${re}$`, ci ? 'i' : '');
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Rule syntax:
 *   `*`                  everything
 *   `Bash`               any use of the tool
 *   `Bash(npm test:*)`   command prefix
 *   `Write(src/**)`      path glob (relative to cwd, or absolute)
 *   `/abs/path`          bare path, any tool
 */
function parseRule(rule) {
  const s = String(rule ?? '').trim();
  if (!s) return null;
  if (s === '*') return { tool: '*', pattern: '*', source: s };
  const m = /^([A-Za-z][\w-]*)\s*\(([\s\S]*)\)$/.exec(s);
  if (m) return { tool: toolId(m[1]), pattern: m[2].trim(), source: s };
  if (/^[A-Za-z][\w-]*$/.test(s)) return { tool: toolId(s), pattern: '*', source: s };
  return { tool: '*', pattern: s, source: s };
}

const compileRules = (rules) => (Array.isArray(rules) ? rules : [rules])
  .map(parseRule)
  .filter(Boolean);

function matchCommandPattern(pattern, command) {
  const p = pattern.trim();
  const c = command.trim();
  if (p === '*') return true;
  if (p.endsWith(':*')) {
    const prefix = p.slice(0, -2).trim();
    return c === prefix || c.startsWith(`${prefix} `);
  }
  if (GLOB_CHARS.test(p)) return ruleRegExp(p, true).test(c);
  return c === p;
}

function matchPathPattern(pattern, target, cwd, home) {
  const p = expandHome(pattern.trim(), home);
  if (p === '*' || p === '**') return true;
  if (!target) return false;
  const abs = path.resolve(cwd, expandHome(target, home));
  const rel = toPosix(path.relative(cwd, abs));
  if (GLOB_CHARS.test(p)) {
    const re = ruleRegExp(toPosix(p), false, IS_WIN);
    return re.test(rel) || re.test(toPosix(abs));
  }
  const ruleAbs = path.resolve(cwd, p);
  return pathEq(abs, ruleAbs) || pathStarts(abs, ruleAbs + path.sep);
}

const toPosix = (p) => p.split(path.sep).join('/');

// ── the gate ────────────────────────────────────────────────────────────────

export class Permissions {
  constructor({ mode = 'ask', allow = [], deny = [], cwd = process.cwd() } = {}) {
    this.cwd = path.resolve(cwd);
    this.home = os.homedir() || '';
    this.mode = normaliseMode(mode) || 'ask';
    this.allow = compileRules(allow);
    this.deny = compileRules(deny);
    /** Grants that last the whole session ("yes, don't ask again"). */
    this.session = [];
    /** One-shot grants ("yes"), cleared by `consumeOnce`. */
    this.once = [];
  }

  setMode(mode) {
    const m = normaliseMode(mode);
    if (!m) throw new Error(`unknown permission mode: ${mode} (expected ${MODES.join(', ')})`);
    this.mode = m;
    return this.mode;
  }

  /** @returns {'allow'|'deny'|'ask'} */
  check(toolName, input) {
    return this.explain(toolName, input).decision;
  }

  /**
   * The same decision as `check`, plus why. Kept separate so `check` can keep
   * the exact signature the rest of the app codes against.
   * @returns {{decision:'allow'|'deny'|'ask', reason:string, key:string}}
   */
  explain(toolName, input = {}) {
    const tool = toolId(toolName);
    const key = this.keyFor(tool, input);
    const target = targetOf(tool, input);
    const out = (decision, reason) => ({ decision, reason, key });

    if (tool === 'bash') {
      const danger = this.isDestructiveCommand(target);
      if (danger.danger) return out('deny', danger.reason);
      const badCwd = input && input.cwd && !this.#inside(input.cwd);
      if (badCwd) return out('deny', 'that working directory is outside the project');
    }

    const denied = this.deny.find((r) => this.#matches(r, tool, target));
    if (denied) return out('deny', `blocked by the deny rule ${denied.source}`);

    const granted = [...this.allow, ...this.session, ...this.once]
      .find((r) => this.#matches(r, tool, target));
    if (granted) return out('allow', `allowed by ${granted.source}`);

    if (MUTATING_TOOLS.has(tool) && target && !this.#inside(target)) {
      return out('deny', `${target} is outside the working directory`);
    }

    if (this.mode === 'yolo') return out('allow', 'yolo mode allows everything');

    const readOnly = READ_ONLY_TOOLS.has(tool)
      || (tool === 'bash' && isReadOnlyCommand(target));

    if (readOnly) return out('allow', 'read-only');

    if (this.mode === 'plan') {
      return out('deny', tool === 'bash'
        ? 'plan mode only runs read-only commands'
        : 'plan mode does not change files');
    }
    if (this.mode === 'acceptEdits' && MUTATING_TOOLS.has(tool)) {
      return out('allow', 'acceptEdits allows file changes');
    }
    return out('ask', 'needs your approval');
  }

  /** Remember a "yes" for the next matching call. */
  allowOnce(key) {
    const r = parseRule(key);
    if (r) this.once.push(r);
    return this;
  }

  /** Remember a "yes, don't ask again" for the rest of the session. */
  allowSession(key) {
    const r = parseRule(key);
    if (r) this.session.push(r);
    return this;
  }

  /**
   * Drop a one-shot grant once it has been used. `check` stays pure, so the
   * caller decides when a grant is spent.
   */
  consumeOnce(key) {
    const i = this.once.findIndex((r) => r.source === String(key));
    if (i !== -1) this.once.splice(i, 1);
    return this;
  }

  /** `Write(src/foo.js)`, `Bash(npm test:*)`, `Read(README.md)`. */
  keyFor(toolName, input = {}) {
    const tool = toolId(toolName);
    const title = TOOL_TITLES[tool] || (tool ? tool[0].toUpperCase() + tool.slice(1) : 'Tool');
    if (tool === 'bash') return `${title}(${commandPrefix(targetOf(tool, input))}:*)`;
    const target = targetOf(tool, input);
    if (!target) return `${title}()`;
    if (tool === 'glob' || tool === 'grep') return `${title}(${target})`;
    return `${title}(${this.#display(target)})`;
  }

  /** @returns {{danger:boolean, reason?:string}} */
  isDestructiveCommand(cmd) {
    const text = String(cmd ?? '');
    if (!text.trim()) return { danger: false };
    if (/:\s*\(\s*\)\s*\{/.test(text)) {
      return { danger: true, reason: 'that is a fork bomb' };
    }
    const segs = segments(text);
    for (const inner of substitutions(text)) segs.push(...segments(inner));
    for (const seg of segs) {
      const reason = destructiveSegment(seg, this.home);
      if (reason) return { danger: true, reason };
    }
    return { danger: false };
  }

  // ── internals ─────────────────────────────────────────────────────────────

  #matches(rule, tool, target) {
    if (rule.tool !== '*' && rule.tool !== tool) return false;
    if (rule.pattern === '*') return true;
    if (tool === 'bash') return matchCommandPattern(rule.pattern, target);
    if (tool === 'glob' || tool === 'grep') {
      return rule.pattern === target || matchPathPattern(rule.pattern, target, this.cwd, this.home);
    }
    return matchPathPattern(rule.pattern, target, this.cwd, this.home);
  }

  #inside(target) {
    const abs = path.resolve(this.cwd, expandHome(target, this.home));
    if (pathEq(abs, this.cwd)) return true;
    const rel = path.relative(this.cwd, abs);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  }

  #display(target) {
    const abs = path.resolve(this.cwd, expandHome(target, this.home));
    const rel = path.relative(this.cwd, abs);
    return rel && !rel.startsWith('..') ? toPosix(rel) : target;
  }
}

/** Drivers whose second word is part of the command's identity. */
const DRIVERS = new Set([
  'git', 'npm', 'pnpm', 'yarn', 'bun', 'npx', 'cargo', 'go', 'docker', 'kubectl',
  'brew', 'pip', 'pip3', 'make', 'deno', 'gh', 'apt', 'apt-get', 'systemctl',
  'terraform', 'poetry', 'uv', 'rustup', 'nvm',
]);

/** `npm test --watch` -> `npm test`; `ls -la` -> `ls`. */
function commandPrefix(command) {
  const first = segments(String(command ?? ''))[0] ?? '';
  const a = argv(lex(first).words);
  if (!a.length) return '';
  const head = a[0];
  if (DRIVERS.has(path.basename(head))) {
    const sub = a.slice(1).find((w) => !w.startsWith('-'));
    if (sub) return `${head} ${sub}`;
  }
  return head;
}
