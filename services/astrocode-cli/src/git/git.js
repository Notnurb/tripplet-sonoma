/**
 * git.js — a thin promise wrapper around the `git` binary.
 *
 * Everything here is best-effort: a missing binary, a directory that is not a
 * repository, or a non-zero exit all resolve to an empty/`null` value rather
 * than throwing. Callers are UI code that wants to render *something*, so a
 * failed git call must never take the TUI down with it.
 *
 * Only `runGit` touches the process boundary — parsing lives in pure helpers
 * below it so the porcelain formats are decoded in exactly one place.
 */

import { execFile } from 'node:child_process';

const TIMEOUT_MS = 20_000;
const MAX_BUFFER = 32 * 1024 * 1024;

/** Single-letter porcelain codes -> a word the UI can print. */
const STATUS_WORDS = {
  M: 'modified',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'typechange',
  U: 'unmerged',
  '?': 'untracked',
  '!': 'ignored',
};

/** One changed path. Stringifies to the path so it can be printed directly. */
export class Change {
  constructor(path, code, orig) {
    this.path = path;
    this.code = code;
    this.status = STATUS_WORDS[code] || 'modified';
    if (orig) this.orig = orig;
  }

  toString() {
    return this.path;
  }
}

/**
 * Run git in `cwd`. Never rejects.
 * @returns {Promise<{ok:boolean, code:number|string, stdout:string, stderr:string}>}
 */
export function runGit(cwd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = execFile(
      'git',
      ['--no-pager', ...args],
      {
        cwd: cwd || process.cwd(),
        timeout: opts.timeout ?? TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        encoding: 'utf8',
        windowsHide: true,
        env: {
          ...process.env,
          GIT_PAGER: 'cat',
          GIT_OPTIONAL_LOCKS: '0',
          GIT_TERMINAL_PROMPT: '0',
        },
      },
      (err, stdout, stderr) => {
        const out = stdout || '';
        const errOut = stderr || (err ? String(err.message || '') : '');
        resolve({
          ok: !err,
          code: err ? (typeof err.code === 'number' || typeof err.code === 'string' ? err.code : 1) : 0,
          stdout: out,
          stderr: errOut,
        });
      },
    );
    if (child.stdin) {
      // EPIPE happens when git exits before draining stdin; the exit code we
      // resolve with is the real signal, so the write error is not interesting.
      child.stdin.on('error', () => {});
      child.stdin.end(opts.input ?? '');
    }
  });
}

const firstLine = (s) => String(s || '').split('\n').map((l) => l.trim()).find(Boolean) || '';

/** `2.39.3`, or null when git is unavailable. */
export async function version(cwd) {
  const r = await runGit(cwd, ['--version']);
  if (!r.ok) return null;
  const m = /(\d+\.\d+(\.\d+)*)/.exec(r.stdout);
  return m ? m[1] : r.stdout.trim() || null;
}

export async function isRepo(cwd) {
  const r = await runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
  return r.ok && r.stdout.trim() === 'true';
}

/** Absolute path of the work tree root, or null. */
export async function rootOf(cwd) {
  const r = await runGit(cwd, ['rev-parse', '--show-toplevel']);
  return r.ok && r.stdout.trim() ? r.stdout.trim() : null;
}

/**
 * Current branch name. Works on an unborn branch (fresh `git init`); a detached
 * HEAD comes back as `detached@<short sha>`. null when this is not a repo.
 */
export async function branch(cwd) {
  const sym = await runGit(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (sym.ok && sym.stdout.trim()) return sym.stdout.trim();
  const short = await runGit(cwd, ['rev-parse', '--short', 'HEAD']);
  if (short.ok && short.stdout.trim()) return `detached@${short.stdout.trim()}`;
  return null;
}

/** true once the repo has at least one commit. */
export async function hasCommits(cwd) {
  const r = await runGit(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  return r.ok && Boolean(r.stdout.trim());
}

/**
 * Parse `git status --porcelain=v1 -z`.
 * In -z mode a rename/copy record is followed by a second NUL-separated field
 * holding the original path, which is why this is an index loop.
 */
function parsePorcelain(out) {
  const fields = out.split('\0');
  const entries = [];
  for (let i = 0; i < fields.length; i++) {
    const rec = fields[i];
    if (!rec || rec.length < 3) continue;
    const x = rec[0];
    const y = rec[1];
    const path = rec.slice(3);
    let orig;
    if (x === 'R' || x === 'C') orig = fields[++i] || undefined;
    entries.push({ x, y, path, orig });
  }
  return entries;
}

/**
 * @returns {Promise<{staged:Change[], unstaged:Change[], untracked:string[],
 *   conflicted:Change[], files:string[], clean:boolean}>}
 */
export async function status(cwd) {
  const empty = {
    staged: [], unstaged: [], untracked: [], conflicted: [], files: [], clean: true,
  };
  const r = await runGit(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (!r.ok) return empty;

  const staged = [];
  const unstaged = [];
  const untracked = [];
  const conflicted = [];

  for (const e of parsePorcelain(r.stdout)) {
    const { x, y, path, orig } = e;
    if (x === '?' || y === '?') {
      untracked.push(path);
      continue;
    }
    if (x === '!' || y === '!') continue;
    // Both sides dirty with the same letter, or a literal U, means a conflict.
    if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) {
      conflicted.push(new Change(path, 'U', orig));
      continue;
    }
    if (x !== ' ') staged.push(new Change(path, x, orig));
    if (y !== ' ') unstaged.push(new Change(path, y, orig));
  }

  const files = [];
  const seen = new Set();
  for (const p of [...staged, ...unstaged, ...conflicted].map((c) => c.path).concat(untracked)) {
    if (seen.has(p)) continue;
    seen.add(p);
    files.push(p);
  }

  return {
    staged,
    unstaged,
    untracked,
    conflicted,
    files,
    clean: files.length === 0,
  };
}

/**
 * Unified diff text. `{staged:true}` diffs the index against HEAD.
 * Returns '' rather than throwing when there is nothing (or no repo).
 */
export async function diff(cwd, opts = {}) {
  const args = ['diff', '--no-color', '--no-ext-diff', `--unified=${opts.context ?? 3}`];
  if (opts.staged || opts.cached) args.push('--staged');
  if (opts.stat) args.push('--stat');
  const paths = opts.paths || [];
  if (paths.length) args.push('--', ...paths);
  const r = await runGit(cwd, args);
  return r.ok ? r.stdout : '';
}

const LOG_SEP = '\x1f';

/** @returns {Promise<Array<{hash:string, subject:string, author:string, date:string}>>} */
export async function log(cwd, n = 10) {
  const count = Math.floor(Number(n) || 0);
  if (count <= 0) return [];
  const r = await runGit(cwd, [
    'log',
    `-n${count}`,
    `--pretty=format:%h${LOG_SEP}%s${LOG_SEP}%an${LOG_SEP}%aI`,
  ]);
  if (!r.ok) return [];
  return r.stdout
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [hash, subject, author, date] = l.split(LOG_SEP);
      return { hash: hash || '', subject: subject || '', author: author || '', date: date || '' };
    });
}

/** Stage every change in the work tree, including deletions and new files. */
export async function stageAll(cwd) {
  const r = await runGit(cwd, ['add', '-A', '--']);
  return r.ok ? { ok: true } : { ok: false, error: firstLine(r.stderr || r.stdout) || 'git add failed' };
}

export async function stage(cwd, paths = []) {
  const list = (Array.isArray(paths) ? paths : [paths]).map(String).filter(Boolean);
  if (!list.length) return { ok: true };
  const r = await runGit(cwd, ['add', '--', ...list]);
  return r.ok ? { ok: true } : { ok: false, error: firstLine(r.stderr || r.stdout) || 'git add failed' };
}

/**
 * Commit the index. The message goes in over stdin so its length and any shell
 * metacharacters are irrelevant, and `--cleanup=whitespace` keeps the trailer
 * blank lines exactly as `commit.js` built them.
 * @returns {Promise<{ok:boolean, hash?:string, error?:string, output?:string}>}
 */
export async function commit(cwd, message, opts = {}) {
  const text = String(message ?? '');
  if (!text.trim()) return { ok: false, error: 'empty commit message' };
  const args = ['commit', '--cleanup=whitespace', '-F', '-'];
  if (opts.allowEmpty) args.push('--allow-empty');
  if (opts.noVerify) args.push('--no-verify');
  const r = await runGit(cwd, args, { input: text.endsWith('\n') ? text : `${text}\n` });
  if (!r.ok) {
    return { ok: false, error: firstLine(r.stderr) || firstLine(r.stdout) || `git commit exited ${r.code}` };
  }
  const head = await runGit(cwd, ['rev-parse', '--short', 'HEAD']);
  return {
    ok: true,
    hash: head.ok ? head.stdout.trim() : undefined,
    output: r.stdout.trim(),
  };
}

/** Configured `user.name`, or null when unset. */
export async function userName(cwd) {
  const r = await runGit(cwd, ['config', '--get', 'user.name']);
  return r.ok && r.stdout.trim() ? r.stdout.trim() : null;
}

/** Configured `user.email`, or null when unset. */
export async function userEmail(cwd) {
  const r = await runGit(cwd, ['config', '--get', 'user.email']);
  return r.ok && r.stdout.trim() ? r.stdout.trim() : null;
}
