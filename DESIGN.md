# DESIGN.md — Tripplet Design System

The single source of truth for Tripplet's (Sonomachat) visual language: typography, color,
radii, icons, motion, and component conventions. All values are driven by CSS variables in
`src/app/globals.css` (Tailwind v4, shadcn `base-maia` style).

---

## 1. Design Philosophy

- **Premium dark-first** aesthetic with light fallback. Dark mode is the default marketing
  and product experience; light mode ("Sonoma" palette) is a crisp white/cream alternative.
- **Soft, large radii** — everything feels rounded and touchable (`--radius: 14px` base).
- **Calm, monochrome surfaces** in dark mode: near-black canvas, layered charcoal cards,
  white primary buttons (inverted from typical shadcn blue-primary).
- **Subtle motion**: shimmer, float, glow-pulse, gradient-flow, grain texture, animated grid.
- **Icon library**: HugeIcons (`@hugeicons/react`), rendered via `<HugeiconsIcon>`.
- **Accessibility**: focus-visible rings, `motion-reduce` kill-switch, safe-area insets,
  16px input font floor on iOS to stop auto-zoom.

---

## 2. Typography

Loaded via `next/font/google` in `src/app/layout.tsx`. Font CSS variables defined in
`@theme` (globals.css:9-13) and bound to Tailwind utilities (`font-sans`, `font-serif`,
`font-mono`).

| Role | Font | Variable | Weights / Notes |
|------|------|----------|-----------------|
| **Sans (default UI)** | **Outfit** (primary) + **Geist** (fallback) | `--font-sans` | Outfit all weights; Geist 400/500/600. Used for body, buttons, nav. |
| **Serif (editorial/accents)** | **Newsreader** | `--font-serif` | 400/500, normal + italic. Used for `.font-serif` headings, prose accents. |
| **Mono (code)** | **JetBrains Mono** | `--font-mono` | 400/500. Code blocks, model IDs, tokens. |

Stack resolution (globals.css:10-12):
```
--font-sans:   var(--font-geist), var(--font-outfit), ui-sans-serif, system-ui, sans-serif;
--font-serif:  var(--font-newsreader), ui-serif, "Iowan Old Style", "Apple Garamond", "Baskerville", serif;
--font-mono:   var(--font-jetbrains), ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", monospace;
```
Note: `--font-sans` is listed as Geist-first in the `@theme` block even though Outfit is the
intended display face — both are loaded.

- Body base: `font-sans antialiased`, font-feature-settings `rlig`/`calt` on.
- Markdown prose (`@tailwindcss/typography`) overridden so links/bold/code inherit
  `--brand` / `--foreground` (globals.css:631-652).

---

## 3. Color System

All colors are CSS variables, themed by `:root` (light), `.dark`, and 15 `[data-theme]`
overrides. Bound to Tailwind via `@theme inline` (globals.css:537-580), e.g.
`bg-background`, `text-foreground`, `bg-card`, `text-muted-foreground`, `bg-brand`.

### Default Light (`:root`, globals.css:35-98)
| Token | Value |
|-------|-------|
| background / card / popover | `#ffffff` |
| foreground | `oklch(0.200 0.020 260)` (near-black, slight blue) |
| primary / brand | `oklch(0.500 0.150 258)` (blue-violet) |
| primary-foreground / brand-foreground | `#ffffff` |
| secondary / muted / accent | `oklch(0.970 0.008 75)` (warm off-white) |
| muted-foreground | `oklch(0.555 0.015 260)` |
| border / input | `oklch(0.910 0.010 75)` / `oklch(0.970 0.008 75)` |
| ring | `oklch(0.500 0.150 258)` |
| destructive | `oklch(0.577 0.245 27.325)` |
| sidebar | `#ffffff` |
| `--radius` | `14px` |
| `--sonoma-ok` | `oklch(0.575 0.105 145)` (green) |

### Default Dark (`.dark`, globals.css:101-142) — the signature look
| Token | Value |
|-------|-------|
| background | `#000000` (pure black) |
| foreground | `#f5f5f5` |
| card / popover | `#141414` |
| primary / brand | `#f5f5f5` (white primary — inverted) |
| primary-foreground / brand-foreground | `#0a0a0a` |
| secondary / muted / accent | `#1e1e1e` |
| muted-foreground | `#a0a0a0` |
| border | `#2a2a2a` |
| input | `#1e1e1e` |
| ring | `#404040` |
| destructive | `#ff4444` |
| sidebar | `#0f0f0f` |
| chart-1..5 | `#b388ff`, `#a0a0a0`, `#666666`, `#ffd740`, `#d4d4d4` |
| `--gradient-color` / `--sparkles-color` | `#8350e8` / `#ffffff` |

Sonoma semantic aliases (`--sonoma-bg`, `--sonoma-surface`, `--sonoma-ink`,
`--sonoma-accent`, `--sonoma-accent-soft`, `--sonoma-shadow-sm/md/lg`, etc.) are mapped
onto the active theme tokens (globals.css:73-91) and used across product UI.

### Themes (15 total, via `[data-theme]`)
Dark themes: `dark`, `midnight`, `volcano`, `ocean`, `forest`, `sunset`, `grape`, `amber`,
`slate`, `crimson`, `emerald`. Light themes: `white`, `light`, `arctic`, `rose`, `brown`.
Several apply ambient `body` background-images (radial/linear glows), e.g. `arctic`
(blue top glow), `rose` (pink), `volcano` (orange bottom), `ocean` (blue bottom),
`grape`/`emerald` (colored radial), `crimson` (red bottom), `sunset` (diagonal gradient).

Themes are applied at runtime via `applySettings` (dark themes add `.dark` class).

---

## 4. Roundedness (Radius)

Base radius drives the entire scale (globals.css:62, 559-565):

| Scale | Formula | Approx (base 14px) |
|-------|---------|--------------------|
| `--radius-sm` | `calc(var(--radius) - 8px)` | 6px |
| `--radius-md` | `calc(var(--radius) - 4px)` | 10px |
| `--radius-lg` | `var(--radius)` | 14px |
| `--radius-xl` | `+4px` | 18px |
| `--radius-2xl` | `+8px` | 22px |
| `--radius-3xl` | `+12px` | 26px |
| `--radius-4xl` | `+16px` | 30px |

Conventions observed:
- **Buttons**: `rounded-lg` (14px) standard; `rounded-md` for `xs`/`icon-xs` sizes
  (button.tsx:8,24-29).
- **Cards / popovers / inputs**: default to `rounded-lg`/`rounded-xl`.
- **Pills / badges**: `rounded-full`.
- Scrollbar thumbs: `border-radius: 999px`.

---

## 5. Icons

- **Library**: [HugeIcons](https://hugeicons.com) via `@hugeicons/react`, configured in
  `components.json` (`"iconLibrary": "hugeicons"`).
- **Usage pattern**: always rendered through the `<HugeiconsIcon>` wrapper component, e.g.
  `import { HugeiconsIcon } from '@hugeicons/react'` then `<HugeiconsIcon icon={SomeIcon} />`.
- Icons inherit `currentColor` and are constrained with `[&_svg]:pointer-events-none
  [&_svg]:shrink-0` in button styles.
- Used across Sidebar, InputBox, ModelSelector, command palette, dropdown menus, select,
  pricing cards, settings panels.

### Logo / Brand mark
- `src/components/ui/logo.tsx` renders `/public/logo.png` (the "S" mark).
- **Auto-inverts**: `dark:invert` so the white mark shows in dark mode and flips to black
  in light mode.
- Fallback: if image fails, renders a bold `T` glyph in `--foreground`.
- Favicon / OG: `/logo.png` (layout.tsx:55-59).

---

## 6. Components & UI Primitives

Built on **shadcn/ui** (`base-maia` style), React 19, Tailwind v4. Located in
`src/components/ui/`. Key primitives: `button`, `card`, `badge`, `input`, `label`,
`dialog`, `dropdown-menu`, `popover`, `select`, `combobox`, `command-palette`,
`navigation-menu`, `sheet`, `avatar`, `collapsible`, `alert-dialog`.

Notable bespoke/custom components:
- `liquid-glass-button`, `liquid-metal-button` — premium material buttons.
- `grainient`, `glowing-effect`, `animated-shiny-text`, `animated-counter`,
  `infinite-slider`, `falling-pattern` — motion/visual flair.
- `pricing-card`, `pricing-section`, `pricing-section-4`, `pricing-tab`, `pricing-nudge`.
- `landing-header`, `landing-footer`, `logo-cloud`.
- `blog-reactions`, `feature-discovery`, `exit-catch-bar`.

Button anatomy (button.tsx):
- Base: `inline-flex items-center justify-center rounded-lg text-sm font-medium
  transition-colors ... focus-visible:outline focus-visible:outline-2
  focus-visible:outline-ring/70`.
- Sizes: `xs` (h-6), `sm` (h-8), default (h-9/h-10), `lg` (h-10, px-8), icon variants.
- Variants follow shadcn `default/secondary/outline/ghost/destructive` mapped to the
  token colors above (white primary in dark mode).

---

## 7. Motion & Animation

Global `motion-reduce` rule zeroes all animation/transition durations (globals.css:20-27).
Keyframes defined in globals.css:667-718 and Sonoma set (823-834):

| Utility | Effect |
|---------|--------|
| `.animate-shimmer` | 3s shimmering gradient sweep |
| `.animate-float` | 4s gentle vertical float |
| `.animate-glow-pulse` | 3s opacity glow pulse |
| `.animate-gradient-flow` | 6s animated gradient background |
| `.animate-pulse-ring` | 2s expanding pulse ring |
| `.grain-overlay::after` | fixed fractal-noise texture (opacity .025 light / .04 dark) |
| `.grid-bg` / `.grid-bg-fade` | 64px masked grid lines |
| `.card-hover` | lift + shadow on hover (translateY -2px) |
| `.gradient-text` | animated gradient-clipped text |
| `.sm-fadeUp / .sm-fadeIn / .sm-slideIn / .sm-pop` | Sonoma enter animations |
| `.sm-stagger > *` | staggered children (6-step delays) |

`html { scroll-behavior: smooth; transition: color/bg 0.25s }` for theme transitions.

---

## 8. Surfaces, Scrollbars, Focus & Selection

- **Scrollbars** (`.scrollbar-thin` / `.sonoma-scroll`): thin (7px webkit), thumb uses
  `--border`, `border-radius: 999px`, hover → `--ring`. Hidden on mobile (≤768px).
- **Focus-visible** (globals.css:655-659): `outline: 2px solid var(--ring);
  outline-offset: 2px; border-radius: var(--radius-sm)`.
- **Selection** (`:selection`): background `--brand`, color `--brand-foreground`.
- **Shadows** (Sonoma): `--sonoma-shadow-sm/md/lg` layered soft shadows for light mode;
  dark mode uses translucent black shadows on hover.
- **Body**: `bg-background text-foreground`, antialiased, `-webkit-font-smoothing`.

---

## 9. Pages & Routes

Top-level app structure (`src/app`):

**Marketing / static**
- `/` — Landing page
- `/about`, `/features`, `/pricing`, `/changelog`, `/blog`
- `/privacy`, `/terms`, `/site-map`, `/sitemap.ts`
- `/sign-in`, `/sign-up` (under `/auth`), `/forgot-password`, `/reset-password`, `/oauth`
- `/installconnect`, `/connect`
- `/spark`, `/studio`, `/skins`, `/mcp`, `/environment`

**Product (authenticated, `(app)` group)**
- `/c` and `/chat` + `/chat/[id]` — main chat experience
- `/code`, `/epsilon-code`, `/generate`, `/pixel` — creation workspaces
- `/agents`, `/hyperagent`, `/hivemind`, `/arena` — agent surfaces
- `/looptrain`, `/triplepedia`, `/trippletgrabthing`, `/tgrablockbatch` — special features
- `/session`, `/profile`, `/settings`, `/subscribe`, `/usage`
- `/api-dashboard`, `/insiders`, `/v1`, `/v2`
- `@modal` parallel route for overlays

**System**
- `error.tsx`, `not-found.tsx` (root + `(app)`), `providers.tsx`, `layout.tsx`
- `/api/*` route handlers (chat, memory, search, title, etc.)

Layout: authenticated pages use the `Sidebar` (`src/components/Sidebar`) + main content
with the ambient grid/grain background; marketing pages use `landing-header` /
`landing-footer`.

---

## 10. Mobile & Viewport

- `html, body { overflow-x: clip; overscroll-behavior-y: none; }` (clip, not hidden, so
  sticky headers survive).
- Touch (`hover:none, pointer:coarse`): tap-highlight transparent, `touch-action:
  manipulation`.
- ≤768px: scrollbars hidden; `.sonoma-user-bubble` max-width 88%; inputs forced to
  `font-size: max(16px, 1em)` to prevent iOS zoom.
- Safe-area helpers: `.safe-top` (`env(safe-area-inset-top)`), `.safe-bottom`.
- Viewport `viewportFit: "cover"`, `interactiveWidget: "resizes-content"` so the composer
  rides above the on-screen keyboard.

---

## 11. Quick Reference

```css
/* Brand accent (default) */
--brand: oklch(0.500 0.150 258);   /* light */
--brand: #f5f5f5;                  /* dark (white primary) */

/* Radius */
--radius: 14px;  → sm 6 / md 10 / lg 14 / xl 18 / 2xl 22 / 3xl 26 / 4xl 30

/* Fonts */
sans:  Outfit + Geist
serif: Newsreader
mono:  JetBrains Mono

/* Icons */
@hugeicons/react → <HugeiconsIcon icon={...} />
```
