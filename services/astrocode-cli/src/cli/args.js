/**
 * args.js — command-line parsing and the pre-TUI help screen.
 *
 * `parseArgs` is pure: it never touches the filesystem and never exits, it just
 * reports what it understood plus `errors`/`warnings` for the caller to print.
 * That keeps `main.js` in charge of the process lifecycle and makes the parser
 * trivially testable.
 *
 * Values for enum flags are validated here and stored in canonical form (a
 * model id, an effort id, a palette name), so downstream code never has to
 * re-resolve an alias. `--rainbow` parses like any other boolean but is marked
 * hidden, which keeps it out of `--help` and out of "did you mean" suggestions.
 */

import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { run, width as lineWidth, pad, wrap, toAnsi } from '../ui/text.js';
import { drawBox, ruleHeader } from '../ui/box.js';
import { createTheme, themeNames } from '../ui/theme.js';
import { resolveModel, modelIds, modelNames } from '../core/models.js';
import { resolveEffort, effortIds } from '../core/effort.js';

// Duplicated from tools/permissions.js on purpose: parsing must stay free of
// the tool layer (which pulls in fs/child_process) so `--help` starts fast.
const PERMISSION_MODES = ['ask', 'acceptEdits', 'plan', 'yolo'];
/** `auto` follows sign-in; the other two pin it. See App#engine. */
const ENGINE_MODES = ['auto', 'local', 'remote'];

/**
 * @typedef {object} Flag
 * @property {string} long      canonical long name, without the leading `--`
 * @property {string|null} short single-letter form, case sensitive
 * @property {string|null} arg   placeholder shown in help, null for booleans
 * @property {string} desc       one-line help text
 * @property {boolean} [hidden]  kept out of --help and suggestions
 * @property {string} key        property written on the parsed `flags` object
 * @property {string} type       model|effort|theme|mode|path|text|int|bool
 * @property {boolean} [negated] the long form spells the *false* case
 * @property {string} [display]  overrides the help label
 */

/** @type {Flag[]} */
export const FLAGS = [
  {
    long: 'model', short: 'm', arg: '<name>', key: 'model', type: 'model',
    desc: 'Model to use (see --list-models)',
  },
  {
    long: 'effort', short: 'e', arg: '<level>', key: 'effort', type: 'effort',
    desc: `Reasoning effort: ${effortIds().join('|')}`,
  },
  {
    long: 'cwd', short: 'C', arg: '<dir>', key: 'cwd', type: 'path',
    desc: 'Working directory for the session',
  },
  {
    long: 'prompt', short: 'p', arg: '<text>', key: 'prompt', type: 'text',
    desc: 'Headless: run one prompt and print the result',
  },
  {
    long: 'continue', short: 'c', arg: null, key: 'continue', type: 'bool',
    desc: 'Resume the most recent session',
  },
  {
    long: 'resume', short: null, arg: '<id>', key: 'resume', type: 'text',
    desc: 'Resume a specific session by id',
  },
  {
    long: 'theme', short: null, arg: '<name>', key: 'theme', type: 'theme',
    desc: `Colour theme: ${themeNames().join('|')}`,
  },
  {
    long: 'permission-mode', short: null, arg: '<mode>', key: 'permissionMode', type: 'mode',
    desc: `Tool permissions: ${PERMISSION_MODES.join('|')}`,
  },
  {
    long: 'yolo', short: null, arg: null, key: 'yolo', type: 'bool',
    desc: 'Shorthand for --permission-mode yolo',
  },
  {
    long: 'engine', short: null, arg: '<which>', key: 'engine', type: 'engine',
    desc: `Where answers come from: ${ENGINE_MODES.join('|')}`,
  },
  {
    long: 'max-turns', short: null, arg: '<n>', key: 'maxTurns', type: 'int',
    desc: 'Cap on agent turns in headless mode',
  },
  {
    long: 'seed', short: null, arg: '<n>', key: 'seed', type: 'int',
    desc: 'Seed the simulation for reproducible runs',
  },
  {
    long: 'json', short: null, arg: null, key: 'json', type: 'bool',
    desc: 'Headless output as a single JSON object',
  },
  {
    long: 'no-welcome', short: null, arg: null, key: 'welcome', type: 'bool', negated: true,
    desc: 'Skip the welcome panel',
  },
  {
    long: 'quiet', short: 'q', arg: null, key: 'quiet', type: 'bool',
    desc: 'Minimal chrome, less decoration',
  },
  {
    long: 'no-color', short: null, arg: null, key: 'color', type: 'bool', negated: true,
    display: '--no-color / --color', desc: 'Force colour off / on',
  },
  {
    long: 'verbose', short: 'v', arg: null, key: 'verbose', type: 'bool',
    desc: 'Show full tool detail inline',
  },
  {
    long: 'list-models', short: null, arg: null, key: 'listModels', type: 'bool',
    desc: 'Print the model table and exit',
  },
  {
    long: 'version', short: 'V', arg: null, key: 'version', type: 'bool',
    desc: 'Print the version and exit',
  },
  {
    long: 'help', short: 'h', arg: null, key: 'help', type: 'bool',
    desc: 'Show this help and exit',
  },
  {
    long: 'rainbow', short: null, arg: null, key: 'rainbow', type: 'bool', hidden: true,
    desc: 'Animate every decorative surface',
  },
];

// ── lookup tables ───────────────────────────────────────────────────────────

/** `--permissionMode` and `--PERMISSION-MODE` both land on `permission-mode`. */
const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/_/g, '-').toLowerCase();

const LONG = new Map();   // name -> { flag, invert }
const SHORT = new Map();  // letter -> { flag, invert:false }

for (const f of FLAGS) {
  LONG.set(f.long, { flag: f, invert: Boolean(f.negated) });
  if (f.type === 'bool') {
    // Every boolean gets both polarities: `--no-welcome` has a `--welcome`,
    // `--json` has a `--no-json`.
    const other = f.negated ? f.long.replace(/^no-/, '') : `no-${f.long}`;
    if (!LONG.has(other)) LONG.set(other, { flag: f, invert: !f.negated });
  }
  if (f.short) SHORT.set(f.short, { flag: f, invert: Boolean(f.negated) });
}

/** Long names worth offering as a correction (hidden flags stay secret). */
const SUGGESTABLE = FLAGS.filter((f) => !f.hidden)
  .flatMap((f) => (f.negated ? [f.long, f.long.replace(/^no-/, '')] : [f.long]));

// ── small helpers ───────────────────────────────────────────────────────────

/** Classic Levenshtein, two rows. Short inputs only, so no need to be clever. */
export function editDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let cur = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** Nearest candidates by edit distance, with prefix matches always winning. */
function nearest(input, candidates, max = 3) {
  const q = String(input || '').toLowerCase();
  if (!q) return [];
  const limit = Math.max(2, Math.floor(q.length / 3));
  return candidates
    .map((c) => {
      const t = String(c).toLowerCase();
      const d = editDistance(q, t);
      const prefix = t.startsWith(q) || q.startsWith(t);
      return { c, d: prefix ? Math.min(d, 1) : d };
    })
    .filter((x) => x.d <= limit)
    .sort((a, b) => a.d - b.d || String(a.c).length - String(b.c).length)
    .slice(0, max)
    .map((x) => x.c);
}

function didYouMean(names) {
  if (!names.length) return '';
  if (names.length === 1) return ` Did you mean ${names[0]}?`;
  const head = names.slice(0, -1).join(', ');
  return ` Did you mean ${head} or ${names[names.length - 1]}?`;
}

const asInt = (raw) => {
  const s = String(raw).trim();
  if (!/^[+-]?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
};

const BOOL_WORDS = {
  true: true, yes: true, on: true, 1: true,
  false: false, no: false, off: false, 0: false,
};

// ── parsing ─────────────────────────────────────────────────────────────────

/**
 * @param {string[]} argv already sliced (i.e. `process.argv.slice(2)`)
 * @returns {{flags: object, positionals: string[], errors: string[], warnings: string[]}}
 */
export function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  const positionals = [];
  const errors = [];
  const warnings = [];
  const seen = new Map();     // Flag -> { token, invert }
  const given = new Set();    // long names the user actually typed

  const set = (flag, value, token, invert) => {
    const prev = seen.get(flag);
    // Repeating a boolean is harmless; flipping it, or restating a value, is not.
    if (prev && (flag.arg || prev.invert !== invert)) {
      warnings.push(prev.token === token
        ? `${token} was given more than once — using the last value.`
        : `${prev.token} and ${token} conflict — using ${token}.`);
    }
    seen.set(flag, { token, invert });
    given.add(flag.long);
    flags[flag.key] = value;
  };

  /**
   * A near-miss gets a "did you mean"; a wild guess gets the whole menu,
   * because pointing at three arbitrary ids would only mislead.
   */
  const unknownValue = (kind, plural, v, near, all) => {
    const useful = near.length > 0 && near.length < all.length;
    errors.push(`Unknown ${kind} '${v}'.`
      + (useful ? didYouMean(near.slice(0, 3)) : ` Valid ${plural}: ${all.join(', ')}.`));
    return { ok: false };
  };

  /** Coerce + validate a raw string for a value-taking flag. */
  const coerce = (flag, raw, token) => {
    const v = String(raw);
    switch (flag.type) {
      case 'model': {
        const { model, suggestions } = resolveModel(v);
        if (model) return { ok: true, value: model.id };
        return unknownValue('model', 'models', v, suggestions.map((m) => m.id), modelIds());
      }
      case 'effort': {
        const { effort, suggestions } = resolveEffort(v);
        if (effort) return { ok: true, value: effort.id };
        return unknownValue('effort', 'levels', v, suggestions.map((e) => e.id), effortIds());
      }
      case 'theme': {
        const names = themeNames();
        const hit = names.find((n) => n === v.trim().toLowerCase());
        if (hit) return { ok: true, value: hit };
        return unknownValue('theme', 'themes', v, nearest(v, names), names);
      }
      case 'mode': {
        const hit = PERMISSION_MODES.find((m) => m.toLowerCase() === v.trim().toLowerCase());
        if (hit) return { ok: true, value: hit };
        return unknownValue(
          'permission mode', 'modes', v, nearest(v, PERMISSION_MODES), PERMISSION_MODES,
        );
      }
      case 'engine': {
        const hit = ENGINE_MODES.find((m) => m === v.trim().toLowerCase());
        if (hit) return { ok: true, value: hit };
        return unknownValue('engine', 'engines', v, nearest(v, ENGINE_MODES), ENGINE_MODES);
      }
      case 'int': {
        const n = asInt(v);
        if (n === null) {
          errors.push(`${token} expects a whole number, got '${v}'.`);
          return { ok: false };
        }
        if (flag.key === 'maxTurns' && n < 1) {
          errors.push(`${token} must be at least 1, got '${v}'.`);
          return { ok: false };
        }
        return { ok: true, value: n };
      }
      case 'path':
        return { ok: true, value: path.resolve(v) };
      default:
        return { ok: true, value: v };
    }
  };

  const applyValue = (flag, raw, token, invert) => {
    const res = coerce(flag, raw, token);
    if (!res.ok) return;
    set(flag, res.value, token, invert);
  };

  const applyBool = (flag, on, token, invert) => {
    const value = invert ? !on : on;
    set(flag, value, token, invert);
    // `--yolo` is sugar, so it writes the mode it stands for as well.
    if (flag.key === 'yolo' && value === true) flags.permissionMode = 'yolo';
  };

  let i = 0;
  while (i < argv.length) {
    const tok = String(argv[i]);

    if (tok === '--') {
      for (let j = i + 1; j < argv.length; j++) positionals.push(String(argv[j]));
      i = argv.length;
      break;
    }

    if (tok.startsWith('--')) {
      const eq = tok.indexOf('=');
      const rawName = eq === -1 ? tok.slice(2) : tok.slice(2, eq);
      const inline = eq === -1 ? undefined : tok.slice(eq + 1);
      const name = kebab(rawName);
      const hit = LONG.get(name);

      if (!hit) {
        const near = nearest(name, SUGGESTABLE).map((n) => `--${n}`);
        errors.push(`Unknown option '--${rawName}'.${didYouMean(near)}`);
        i++;
        continue;
      }

      const { flag, invert } = hit;
      const token = `--${rawName}`;

      if (flag.arg) {
        let value = inline;
        if (value === undefined) {
          const next = i + 1 < argv.length ? String(argv[i + 1]) : undefined;
          if (isValueLike(next, flag)) { value = next; i++; }
        }
        if (value === undefined || value === '') {
          errors.push(`${token} requires a value ${flag.arg}.`);
        } else {
          applyValue(flag, value, token, invert);
        }
      } else if (inline !== undefined) {
        const b = BOOL_WORDS[inline.trim().toLowerCase()];
        if (b === undefined) errors.push(`${token} is a switch — use ${token} or ${token}=false.`);
        else applyBool(flag, b, token, invert);
      } else {
        applyBool(flag, true, token, invert);
      }
      i++;
      continue;
    }

    // A lone '-' and negative numbers are values, not flags.
    if (tok.length > 1 && tok[0] === '-' && !/^-\d/.test(tok)) {
      // `-model` is a long name typed with one dash — far likelier than the
      // getopt reading (`-m odel`), so say so instead of failing obscurely.
      const asLong = kebab(tok.slice(1));
      if (tok.length > 2 && LONG.has(asLong)) {
        errors.push(`Unknown option '${tok}'. Did you mean --${asLong}?`);
        i++;
        continue;
      }
      i = takeCluster(tok, i);
      continue;
    }

    positionals.push(tok);
    i++;
  }

  /** Boolean shorts cluster (`-qv`); the first value-taking short ends it. */
  function takeCluster(tok, index) {
    for (let j = 1; j < tok.length; j++) {
      const ch = tok[j];
      const hit = SHORT.get(ch);
      if (!hit) {
        const swapped = ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase();
        const alt = SHORT.get(swapped) && !SHORT.get(swapped).flag.hidden ? [`-${swapped}`] : [];
        const near = alt.length ? alt : nearest(ch, SUGGESTABLE).map((n) => `--${n}`);
        errors.push(`Unknown option '-${ch}'.${didYouMean(near)}`);
        continue;
      }
      const { flag, invert } = hit;
      const token = `-${ch}`;
      if (!flag.arg) { applyBool(flag, true, token, invert); continue; }

      // Value shorts swallow the rest of the cluster: `-mastro`, `-m=astro`, `-m astro`.
      let value = tok.slice(j + 1);
      if (value.startsWith('=')) value = value.slice(1);
      if (value === '') {
        const next = index + 1 < argv.length ? String(argv[index + 1]) : undefined;
        if (isValueLike(next, flag)) { value = next; index++; }
      }
      if (value === '' || value === undefined) errors.push(`${token} requires a value ${flag.arg}.`);
      else applyValue(flag, value, token, invert);
      return index + 1;
    }
    return index + 1;
  }

  // ── cross-flag sanity ──
  if (given.has('yolo') && given.has('permission-mode') && flags.permissionMode !== 'yolo') {
    warnings.push(`--yolo was overridden by --permission-mode ${flags.permissionMode}.`);
  }
  if (given.has('continue') && given.has('resume')) {
    warnings.push(`--continue and --resume conflict — resuming '${flags.resume}'.`);
    flags.continue = false;
  }
  if (flags.json && !flags.prompt) {
    warnings.push('--json only affects headless runs; add -p/--prompt.');
  }
  if (given.has('max-turns') && !flags.prompt) {
    warnings.push('--max-turns only applies to headless runs; add -p/--prompt.');
  }
  if (flags.quiet && flags.verbose) {
    warnings.push('--quiet and --verbose pull in opposite directions; --verbose wins for tool detail.');
  }

  return { flags, positionals, errors, warnings };
}

/**
 * Would `next` serve as this flag's value? Anything starting with `-` is a
 * flag, unless it is a lone dash or a negative number for a numeric flag.
 */
function isValueLike(next, flag) {
  if (next === undefined) return false;
  if (next === '-') return true;
  if (!next.startsWith('-')) return true;
  return flag.type === 'int' && /^-\d+$/.test(next);
}

// ── help ────────────────────────────────────────────────────────────────────

let cachedVersion = null;

function version() {
  if (cachedVersion) return cachedVersion;
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(path.join(here, '..', '..', 'package.json'), 'utf8'));
    cachedVersion = pkg.version || '0.0.0';
  } catch {
    cachedVersion = '0.0.0'; // running from somewhere without the manifest
  }
  return cachedVersion;
}

/** `astrocode --version` — one line, easy to grep. */
export function versionText(v) {
  return `Astrocode ${v || version()} (node ${process.version}, ${process.platform}-${process.arch})`;
}

const EXAMPLES = [
  ['astrocode', 'Start the TUI here'],
  ['astrocode -m taipei-4 -e low', 'Fast model, light reasoning'],
  ['astrocode -p "fix the failing test" --json', 'Headless, JSON on stdout'],
  ['astrocode --permission-mode plan', 'Read-only planning session'],
  ['astrocode -c -v', 'Resume the last session'],
];

/**
 * Two aligned columns with a hanging wrap. Falls back to stacked rows when the
 * terminal is too narrow to leave the description room to breathe.
 */
function twoCol(rows, total, { indent = 2, gap = 2 } = {}) {
  const labelW = rows.reduce((w, r) => Math.max(w, lineWidth(r.label)), 0);
  const descCol = indent + labelW + gap;
  const stacked = total - descCol < 24;
  const out = [];
  for (const r of rows) {
    if (stacked) {
      out.push([run(' '.repeat(indent)), ...r.label]);
      for (const l of wrap(r.desc, Math.max(8, total - indent - 4))) {
        out.push([run(' '.repeat(indent + 4)), ...l]);
      }
      continue;
    }
    const lines = wrap(r.desc, total - descCol);
    out.push([run(' '.repeat(indent)), ...pad(r.label, labelW), run(' '.repeat(gap)), ...lines[0]]);
    for (const cont of lines.slice(1)) out.push([run(' '.repeat(descCol)), ...cont]);
  }
  return out;
}

/**
 * The screen printed by `--help`, before the alternate buffer is entered.
 * Returns ANSI-ready text; hidden flags (i.e. `--rainbow`) never appear.
 */
export function helpText(theme) {
  const t = theme || createTheme('astro');
  const cols = Number(process.stdout && process.stdout.columns) || 80;
  const total = Math.max(44, Math.min(92, cols - 2));
  const inner = total - 4; // borders + one cell of padding either side

  const out = [];
  const push = (...lines) => out.push(...lines);

  const banner = [
    ...wrap([
      run('An agentic coding CLI by ', { fg: t.text }),
      run('Tripplet', { fg: t.accent, bold: true }),
      run('.', { fg: t.text }),
    ], inner),
    ...wrap([
      run('Models: ', { fg: t.dim }),
      run(modelNames().join(' · '), { fg: t.text }),
    ], inner, { hanging: 8 }),
  ];
  push(...drawBox(banner, {
    width: total,
    theme: t,
    title: t.paint('Astrocode', { bold: true }, t.primary),
    titleFg: t.primary,
    footer: [run(`v${version()}`, { fg: t.dim })],
    padY: 1,
  }));
  push([]);

  push(ruleHeader('USAGE', total, { theme: t, labelFg: t.primary, bold: true }));
  push([
    run('  astrocode ', { fg: t.text }),
    run('[options] ', { fg: t.dim }),
    run('[prompt]', { fg: t.dim }),
  ]);
  push(...wrap([
    run('Anything after ', { fg: t.faint }),
    run('--', { fg: t.dim }),
    run(' is taken as the prompt, verbatim.', { fg: t.faint }),
  ], total, { indent: 2 }));
  push([]);

  push(ruleHeader('FLAGS', total, { theme: t, labelFg: t.primary, bold: true }));
  const rows = FLAGS.filter((f) => !f.hidden).map((f) => ({
    label: [
      run(f.short ? `-${f.short}, ` : '    ', { fg: t.primary }),
      run(f.display || `--${f.long}`, { fg: t.primary }),
      ...(f.arg ? [run(` ${f.arg}`, { fg: t.dim })] : []),
    ],
    desc: [run(f.desc, { fg: t.text })],
  }));
  push(...twoCol(rows, total));
  push([]);

  push(ruleHeader('EXAMPLES', total, { theme: t, labelFg: t.primary, bold: true }));
  push(...twoCol(
    EXAMPLES.map(([cmd, desc]) => ({
      label: [run(cmd, { fg: t.code })],
      desc: [run(desc, { fg: t.dim })],
    })),
    total,
  ));
  push([]);
  push(...wrap([
    run('Inside the TUI, ', { fg: t.faint }),
    run('/help', { fg: t.primary }),
    run(' lists the slash commands.', { fg: t.faint }),
  ], total, { indent: 2 }));
  push(...wrap(
    [run('The models are simulated locally; the tools are real.', { fg: t.faint })],
    total,
    { indent: 2 },
  ));

  return out.map((l) => toAnsi(l)).join('\n');
}
