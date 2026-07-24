/**
 * models.js — the Astrocode model registry.
 *
 * Four models, all simulated locally for now: there is no backend and no
 * network call anywhere in this codebase. Each entry carries the metadata the
 * rest of the app needs (context window, pricing, sidebar accent) plus the
 * knobs `engine/` uses to give each model a distinct feel.
 */

/**
 * @typedef {object} Model
 * @property {string} id        canonical slug, e.g. 'astro-5-code'
 * @property {string} name      display name, e.g. 'Astro 5 Code'
 * @property {string} short     sidebar/statusline name
 * @property {string} family    vendor family
 * @property {string[]} aliases accepted on --model / /model
 * @property {number} context   context window in tokens
 * @property {object} pricing   { input, output } USD per million tokens
 * @property {string} accent    hex accent colour
 * @property {string} tagline   one-liner for /model and --list-models
 * @property {string} defaultEffort
 * @property {object} persona   engine knobs (see engine/personas.js)
 */

/** @type {Model[]} */
export const MODELS = [
  {
    id: 'astro-5-code',
    name: 'Astro 5 Code',
    short: 'Astro 5',
    family: 'Astro',
    aliases: ['astro', 'astro5', 'astro-5', 'a5', 'astro5code', 'astro-5-code', 'flagship'],
    context: 500_000,
    pricing: { input: 5, output: 25 },
    accent: '#4d9dff',
    tagline: 'Flagship. Deepest reasoning, best long-horizon agentic work.',
    defaultEffort: 'high',
    tier: 'flagship',
    persona: {
      cps: 420,           // simulated characters/second of output
      thinkRatio: 1.0,    // multiplier on reasoning length
      latency: [180, 420],// first-token delay range (ms)
      verbosity: 1.0,
      voice: 'precise',
      confidence: 0.96,
    },
  },
  {
    id: 'taipei-4',
    name: 'Taipei 4',
    short: 'Taipei 4',
    family: 'Taipei',
    aliases: ['taipei', 'taipei4', 't4', 'fast'],
    context: 200_000,
    pricing: { input: 0.8, output: 4 },
    accent: '#22d3ee',
    tagline: 'Fast and cheap. Great for edits, greps and quick questions.',
    defaultEffort: 'low',
    tier: 'fast',
    persona: {
      cps: 900,
      thinkRatio: 0.35,
      latency: [60, 160],
      verbosity: 0.6,
      voice: 'terse',
      confidence: 0.86,
    },
  },
  {
    id: 'majuli-4',
    name: 'Majuli 4',
    short: 'Majuli 4',
    family: 'Majuli',
    aliases: ['majuli', 'majuli4', 'm4', 'long', 'balanced'],
    context: 1_000_000,
    pricing: { input: 2.5, output: 12 },
    accent: '#4ade80',
    tagline: 'Million-token context. Built for whole-repo reading.',
    defaultEffort: 'medium',
    tier: 'long-context',
    persona: {
      cps: 560,
      thinkRatio: 0.7,
      latency: [140, 320],
      verbosity: 1.15,
      voice: 'expansive',
      confidence: 0.9,
    },
  },
  {
    id: 'suzhou-4',
    name: 'Suzhou 4',
    short: 'Suzhou 4',
    family: 'Suzhou',
    aliases: ['suzhou', 'suzhou4', 's4', 'reason', 'thinker'],
    context: 300_000,
    pricing: { input: 3, output: 15 },
    accent: '#a78bfa',
    tagline: 'Reasoning specialist. Thinks longest, guesses least.',
    defaultEffort: 'xhigh',
    tier: 'reasoning',
    persona: {
      cps: 300,
      thinkRatio: 1.8,
      latency: [300, 700],
      verbosity: 0.95,
      voice: 'analytical',
      confidence: 0.93,
    },
  },
];

export const DEFAULT_MODEL_ID = 'astro-5-code';

const byId = new Map(MODELS.map((m) => [m.id, m]));
const byAlias = new Map();
for (const m of MODELS) {
  byAlias.set(m.id, m);
  byAlias.set(m.name.toLowerCase(), m);
  byAlias.set(m.short.toLowerCase(), m);
  for (const a of m.aliases) byAlias.set(a.toLowerCase(), m);
}

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');

/** Exact/alias lookup. Returns undefined when nothing matches. */
export function getModel(name) {
  if (!name) return undefined;
  const n = norm(name);
  return byAlias.get(n) || byId.get(n) || byAlias.get(n.replace(/-/g, ''));
}

/**
 * Forgiving lookup used by `--model` and `/model`.
 * @returns {{ model?: Model, suggestions: Model[] }}
 */
export function resolveModel(name) {
  const exact = getModel(name);
  if (exact) return { model: exact, suggestions: [] };
  const n = norm(name);
  if (!n) return { model: undefined, suggestions: MODELS };
  const scored = MODELS
    .map((m) => ({ m, s: score(n, m) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  // a single clear winner is treated as a match
  if (scored.length && (scored.length === 1 || scored[0].s >= scored[1].s + 2)) {
    return { model: scored[0].m, suggestions: [] };
  }
  return { model: undefined, suggestions: scored.map((x) => x.m).slice(0, 4) };
}

function score(q, m) {
  const hay = [m.id, m.name.toLowerCase(), m.short.toLowerCase(), ...m.aliases];
  let best = 0;
  for (const h of hay) {
    const t = norm(h);
    if (t === q) best = Math.max(best, 10);
    else if (t.startsWith(q)) best = Math.max(best, 6);
    else if (t.includes(q)) best = Math.max(best, 4);
    else if (subsequence(q, t)) best = Math.max(best, 2);
  }
  return best;
}

function subsequence(q, t) {
  let i = 0;
  for (const c of t) if (c === q[i]) i++;
  return i === q.length;
}

export const modelIds = () => MODELS.map((m) => m.id);
export const modelNames = () => MODELS.map((m) => m.name);

/** `Astro 5 Code · 500K ctx · $5/$25 per Mtok` */
export function describeModel(m) {
  const ctx = m.context >= 1_000_000
    ? `${m.context / 1_000_000}M`
    : `${Math.round(m.context / 1000)}K`;
  return `${m.name} · ${ctx} ctx · $${m.pricing.input}/$${m.pricing.output} per Mtok`;
}

/** The trailer identity used in git commits. */
export function commitAuthor(m) {
  return `${m.name} - Tripplet`;
}
