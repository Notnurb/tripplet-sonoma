/**
 * theme.js — palettes, plus the rainbow easter egg.
 *
 * The default palette ("astro") is tuned to look like the Kimi CLI: a deep
 * near-black canvas with a single confident blue used for every border, and a
 * violet accent for the agent's own voice.
 *
 * `--rainbow` does not swap the palette. It installs a *gradient generator*
 * that decorative surfaces (borders, the logo, the sidebar hatching, the
 * prompt glyph) opt into via `theme.gradient()`. Content colours stay put so
 * text remains readable.
 */

import { toRgb } from './text.js';

const PALETTES = {
  astro: {
    name: 'astro',
    label: 'Astro (default)',
    bg: '#0b0e14',
    panel: '#11151c',
    text: '#d5dbe5',
    dim: '#6e7681',
    faint: '#4b525c',
    border: '#3d7dff',
    borderDim: '#243b63',
    primary: '#4d9dff',
    accent: '#a78bfa',
    success: '#4ade80',
    warn: '#fbbf24',
    error: '#f87171',
    info: '#38bdf8',
    thinking: '#7c8595',
    user: '#e6edf3',
    tool: '#22d3ee',
    add: '#4ade80',
    del: '#f87171',
    hunk: '#8b5cf6',
    code: '#e3b341',
    logo: '#2f81f7',
    logoEye: '#ffffff',
    hatch: '#3d7dff',
    selection: '#1d2b45',
  },
  crush: {
    name: 'crush',
    label: 'Crush (hot pink)',
    bg: '#0b0b10',
    panel: '#14121c',
    text: '#e5e0ec',
    dim: '#6b6480',
    faint: '#4a4460',
    border: '#ff5fd7',
    borderDim: '#5c2a52',
    primary: '#ff5fd7',
    accent: '#22d3ee',
    success: '#4ade80',
    warn: '#fbbf24',
    error: '#fb7185',
    info: '#22d3ee',
    thinking: '#8b82a8',
    user: '#f3eefb',
    tool: '#22d3ee',
    add: '#4ade80',
    del: '#fb7185',
    hunk: '#c084fc',
    code: '#fde047',
    logo: '#ff5fd7',
    logoEye: '#0b0b10',
    hatch: '#ff5fd7',
    selection: '#2a1f3d',
  },
  ember: {
    name: 'ember',
    label: 'Ember (warm)',
    bg: '#0f0d0b',
    panel: '#181310',
    text: '#e8ded4',
    dim: '#8a7a6c',
    faint: '#5c5147',
    border: '#d97757',
    borderDim: '#5e3627',
    primary: '#d97757',
    accent: '#e3b341',
    success: '#7bb661',
    warn: '#e3b341',
    error: '#e05252',
    info: '#63a2c9',
    thinking: '#8a7a6c',
    user: '#f5ece2',
    tool: '#63a2c9',
    add: '#7bb661',
    del: '#e05252',
    hunk: '#c98a5e',
    code: '#e3b341',
    logo: '#d97757',
    logoEye: '#0f0d0b',
    hatch: '#d97757',
    selection: '#33241c',
  },
  mono: {
    name: 'mono',
    label: 'Mono (no colour)',
    bg: '#000000',
    panel: '#0a0a0a',
    text: '#e0e0e0',
    dim: '#8a8a8a',
    faint: '#5a5a5a',
    border: '#c0c0c0',
    borderDim: '#4a4a4a',
    primary: '#ffffff',
    accent: '#c0c0c0',
    success: '#d0d0d0',
    warn: '#d0d0d0',
    error: '#ffffff',
    info: '#c0c0c0',
    thinking: '#8a8a8a',
    user: '#ffffff',
    tool: '#c0c0c0',
    add: '#e0e0e0',
    del: '#8a8a8a',
    hunk: '#a0a0a0',
    code: '#e0e0e0',
    logo: '#e0e0e0',
    logoEye: '#000000',
    hatch: '#8a8a8a',
    selection: '#2a2a2a',
  },
};

export const themeNames = () => Object.keys(PALETTES);
export const themeList = () =>
  Object.values(PALETTES).map((p) => ({ name: p.name, label: p.label }));

// ── HSL helpers for the rainbow ─────────────────────────────────────────────

function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const hex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** Blend two colours. `t` = 0 -> a, 1 -> b. */
export function mix(a, b, t) {
  const ra = toRgb(a) || [0, 0, 0];
  const rb = toRgb(b) || [0, 0, 0];
  const h = (i) => Math.round(ra[i] + (rb[i] - ra[i]) * t).toString(16).padStart(2, '0');
  return `#${h(0)}${h(1)}${h(2)}`;
}

// ── theme object ────────────────────────────────────────────────────────────

export class Theme {
  constructor(name = 'astro', { rainbow = false } = {}) {
    this.setPalette(name);
    this.rainbow = rainbow;
    this.phase = 0;
  }

  setPalette(name) {
    const p = PALETTES[name] || PALETTES.astro;
    this.palette = p;
    Object.assign(this, p);
    return this;
  }

  /** Advance the rainbow animation. Called by the app's ticker. */
  tick(dt = 1) {
    if (this.rainbow) this.phase = (this.phase + dt * 6) % 360;
    return this;
  }

  /** Should the app run an animation timer? */
  get animated() { return this.rainbow; }

  /**
   * Colour for cell `i` of `n` on a decorative surface.
   * Plain themes return the fixed colour; rainbow mode sweeps the spectrum.
   */
  gradient(i, n, fallback) {
    if (!this.rainbow) return fallback ?? this.border;
    const spread = 300;
    const h = this.phase + (n > 1 ? (i / n) * spread : 0);
    return hslToHex(h, 0.92, 0.66);
  }

  /** A single animated colour (no positional sweep) — for accents & glyphs. */
  pulse(offset = 0, fallback) {
    if (!this.rainbow) return fallback ?? this.primary;
    return hslToHex(this.phase + offset, 0.9, 0.68);
  }

  /** Paint a plain string one grapheme at a time along the gradient. */
  paint(str, style = {}, fallback) {
    if (!this.rainbow) return [{ t: str, fg: fallback ?? this.border, ...style }];
    const chars = Array.from(str);
    return chars.map((c, i) => ({ t: c, fg: this.gradient(i, chars.length, fallback), ...style }));
  }
}

export function createTheme(name, opts) {
  return new Theme(name, opts);
}
