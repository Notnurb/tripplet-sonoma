/**
 * helpers.js — shared test scaffolding.
 *
 * `withTempDir` keeps every filesystem test inside a fresh mkdtemp so nothing
 * ever touches the real HOME, and `FakeTTY` lets the full App run headless by
 * standing in for a real terminal.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';

import { stripAnsi } from '../src/ui/text.js';

/** Run `fn` with a throwaway directory, cleaned up afterwards. */
export async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'astrocode-test-'));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export async function writeFiles(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf8');
  }
  return dir;
}

/** A minimal tool context. */
export const ctxFor = (cwd, extra = {}) => ({
  cwd,
  session: { todos: [], cwd },
  theme: null,
  signal: undefined,
  ...extra,
});

// ── fake terminal ───────────────────────────────────────────────────────────

export class FakeStdin extends EventEmitter {
  constructor() {
    super();
    this.isTTY = true;
    this.raw = false;
  }

  setRawMode(v) { this.raw = v; return this; }
  resume() { return this; }
  pause() { return this; }
  setEncoding() { return this; }
  off(ev, fn) { return this.removeListener(ev, fn); }

  /** Feed bytes as if typed. */
  type(str) { this.emit('data', str); return this; }
}

export class FakeStdout extends EventEmitter {
  constructor(columns = 100, rows = 30) {
    super();
    this.isTTY = true;
    this.columns = columns;
    this.rows = rows;
    this.chunks = [];
  }

  write(s) { this.chunks.push(s); return true; }
  get text() { return this.chunks.join(''); }
  get plain() { return stripAnsi(this.text); }
  clear() { this.chunks = []; return this; }
}

/** Let queued microtasks and timers settle. */
export const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
