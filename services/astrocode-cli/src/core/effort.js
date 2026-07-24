/**
 * effort.js — reasoning effort levels.
 *
 * Effort scales how long the model "thinks" before answering and how much of
 * that reasoning is surfaced. It is orthogonal to the model choice: any model
 * can run at any effort, though each has a sensible default.
 */

export const EFFORTS = [
  {
    id: 'low',
    label: 'low',
    aliases: ['l', 'fast', 'quick', 'min', 'minimal', '1'],
    thinkBudget: 400,
    steps: [1, 2],
    showThinking: false,
    glyph: '·',
    color: '#6e7681',
    tagline: 'Answer immediately. Barely any planning.',
  },
  {
    id: 'medium',
    label: 'medium',
    aliases: ['m', 'med', 'normal', 'default', 'balanced', '2'],
    thinkBudget: 2_000,
    steps: [2, 4],
    showThinking: true,
    glyph: '∴',
    color: '#38bdf8',
    tagline: 'A short plan, then act. The everyday setting.',
  },
  {
    id: 'high',
    label: 'high',
    aliases: ['h', 'hi', 'deep', '3'],
    thinkBudget: 8_000,
    steps: [3, 6],
    showThinking: true,
    glyph: '✦',
    color: '#a78bfa',
    tagline: 'Plans carefully, checks its own work.',
  },
  {
    id: 'xhigh',
    label: 'xhigh',
    aliases: ['x', 'xh', 'extra', 'veryhigh', 'very-high', '4'],
    thinkBudget: 24_000,
    steps: [4, 8],
    showThinking: true,
    glyph: '✧',
    color: '#f0abfc',
    tagline: 'Explores alternatives before committing.',
  },
  {
    id: 'max',
    label: 'max',
    aliases: ['ultra', 'maximum', 'ultrathink', '5'],
    thinkBudget: 64_000,
    steps: [6, 12],
    showThinking: true,
    glyph: '★',
    color: '#fbbf24',
    tagline: 'Everything it has. Slow, thorough, expensive.',
  },
];

export const DEFAULT_EFFORT = 'medium';

const byName = new Map();
for (const e of EFFORTS) {
  byName.set(e.id, e);
  for (const a of e.aliases) byName.set(a, e);
}

export function getEffort(name) {
  if (!name) return undefined;
  return byName.get(String(name).trim().toLowerCase());
}

export function resolveEffort(name) {
  const hit = getEffort(name);
  if (hit) return { effort: hit, suggestions: [] };
  const n = String(name ?? '').trim().toLowerCase();
  const near = EFFORTS.filter((e) => e.id.startsWith(n) || e.aliases.some((a) => a.startsWith(n)));
  return { effort: undefined, suggestions: near.length ? near : EFFORTS };
}

export const effortIds = () => EFFORTS.map((e) => e.id);
export const effortIndex = (id) => EFFORTS.findIndex((e) => e.id === id);

/** Next level up/down, for the ctrl+e / shift+tab style cycles. */
export function cycleEffort(id, dir = 1) {
  const i = effortIndex(id);
  const n = EFFORTS.length;
  return EFFORTS[((i === -1 ? 1 : i) + dir + n) % n];
}
