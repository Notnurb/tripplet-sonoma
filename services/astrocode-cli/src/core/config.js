/**
 * config.js — layered configuration.
 *
 * Precedence, lowest to highest:
 *   built-in defaults  <  ~/.astrocode/config.json  <  ./.astrocode.json  <  CLI flags
 *
 * Everything is optional and a broken config file is a warning, never a crash —
 * you should always be able to start the CLI.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { DEFAULT_MODEL_ID } from './models.js';
import { DEFAULT_EFFORT } from './effort.js';

export const HOME_DIR = path.join(os.homedir(), '.astrocode');
export const CONFIG_PATH = path.join(HOME_DIR, 'config.json');
export const SESSIONS_DIR = path.join(HOME_DIR, 'sessions');
export const PROJECT_CONFIG = '.astrocode.json';

export const DEFAULTS = {
  model: DEFAULT_MODEL_ID,
  effort: DEFAULT_EFFORT,
  theme: 'astro',
  rainbow: false,
  permissionMode: 'ask',
  authUrl: 'https://tripplet.lol',
  autoLogin: true,
  // 'auto'  — real models when signed in, local simulation when not
  // 'local' — always simulate (offline, demos, tests)
  // 'remote'— always call Tripplet, and say so plainly when signed out
  engine: 'auto',
  showWelcome: true,
  showThinking: true,
  verbose: false,
  autosave: true,
  editorKeys: 'default',
  allow: [],
  deny: [],
  username: null,
};

function readJson(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return { data: JSON.parse(raw), error: null };
  } catch (err) {
    if (err.code === 'ENOENT') return { data: null, error: null };
    return { data: null, error: `${file}: ${err.message}` };
  }
}

/**
 * @returns {{config: object, warnings: string[], sources: string[]}}
 */
export function loadConfig({ cwd = process.cwd(), configPath = null } = {}) {
  const warnings = [];
  const sources = [];
  let config = { ...DEFAULTS };

  const userFile = configPath || CONFIG_PATH;
  const user = readJson(userFile);
  if (user.error) warnings.push(`Ignoring user config — ${user.error}`);
  if (user.data) {
    config = merge(config, sanitise(user.data, warnings, userFile));
    sources.push(userFile);
  }

  const projFile = path.join(cwd, PROJECT_CONFIG);
  const proj = readJson(projFile);
  if (proj.error) warnings.push(`Ignoring project config — ${proj.error}`);
  if (proj.data) {
    config = merge(config, sanitise(proj.data, warnings, projFile));
    sources.push(projFile);
  }

  return { config, warnings, sources };
}

const KNOWN = new Set(Object.keys(DEFAULTS));

function sanitise(obj, warnings, file) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!KNOWN.has(k)) {
      warnings.push(`${path.basename(file)}: unknown option "${k}"`);
      continue;
    }
    const expected = typeof DEFAULTS[k];
    if (DEFAULTS[k] !== null && v !== null && typeof v !== expected && !Array.isArray(DEFAULTS[k])) {
      warnings.push(`${path.basename(file)}: "${k}" should be a ${expected}`);
      continue;
    }
    out[k] = v;
  }
  return out;
}

function merge(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    if (Array.isArray(v) && Array.isArray(base[k])) out[k] = [...new Set([...base[k], ...v])];
    else if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Persist a partial update to the user-level config. */
export function saveConfig(patch, { configPath = CONFIG_PATH } = {}) {
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const { data } = readJson(configPath);
    const next = { ...(data || {}), ...patch };
    fs.writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    return { ok: true, path: configPath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function ensureDirs() {
  try {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    return true;
  } catch {
    // A read-only HOME just means no session persistence; the CLI still works.
    return false;
  }
}

/** Apply parsed CLI flags on top of a loaded config. */
export function applyFlags(config, flags) {
  const out = { ...config };
  if (flags.model) out.model = flags.model;
  if (flags.effort) out.effort = flags.effort;
  if (flags.theme) out.theme = flags.theme;
  if (flags.rainbow) out.rainbow = true;
  if (flags.permissionMode) out.permissionMode = flags.permissionMode;
  if (flags.yolo) out.permissionMode = 'yolo';
  if (flags.noWelcome) out.showWelcome = false;
  if (flags.quiet) out.showWelcome = false;
  if (flags.verbose) out.verbose = true;
  return out;
}
