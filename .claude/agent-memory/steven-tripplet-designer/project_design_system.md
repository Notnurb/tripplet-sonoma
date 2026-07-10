---
name: Tripplet Design System Tokens
description: Core design tokens, spacing conventions, color palette, and typography observed in globals.css and across components
type: project
---

## Typography
- Font: Outfit (--font-sans), Geist Mono (--font-mono)
- Base radius: 1.125rem (--radius), with computed variants: sm, md, lg, xl, 2xl, 3xl, 4xl
- Font smoothing: antialiased applied globally

## Color System (Dark mode — primary surface)
- Background: #0a0a0a
- Card: #141414
- Border: #2a2a2a
- Muted foreground: #a0a0a0
- Auth modal uses hardcoded #111113 (slightly lighter than card, intentional dark glass look)
- Input fields in auth use bg-white/5 + border-white/8 — glass-style against dark backdrop

## Component Patterns
- Cards: rounded-2xl border border-border bg-card p-6 with card-hover class
- Buttons (primary): bg-foreground text-background, h-11 rounded-xl
- Buttons (OAuth in login): h-10 rounded-xl bg-white/5 border-white/8 — glass style
- Buttons (OAuth in register): h-11 rounded-xl bg-card border-border — solid style (INCONSISTENT with login)
- Form inputs: h-11 rounded-xl, px-3.5, focus:border transitions
- Focus rings: 2px solid var(--ring), offset 2, border-radius var(--radius-sm)

## Special Utilities
- .grain-overlay::after — animated film grain texture, opacity 0.025 (light) / 0.04 (dark)
- .gradient-text — animated shimmer gradient on text
- .card-hover — subtle lift + shadow on hover
- .grid-bg / .grid-bg-fade — grid pattern backgrounds
- .animate-shimmer, .animate-float, .animate-glow-pulse, .animate-gradient-flow

## Landing Pages
- Max-width container: max-w-5xl with px-4
- Header height: h-14, sticky top-0 z-50
- Scroll-triggered border/blur: border-border + backdrop-blur-lg when scrolled
- Footer: 4-column grid (2 cols on mobile), py-12
- About page uses grain-overlay class on root div

## Auth Pages
- Login: Uses AuthModal component — dark card overlay over BinaryBackground (fullscreen)
- Register: Bare centered layout (flex min-h-svh items-center justify-center bg-background p-6) — NO grain, NO binary bg
- These two pages have completely different visual presentations — this is the single biggest inconsistency

## 15 Themes
- Defined via [data-theme] attribute selectors in globals.css
- Themes: dark, midnight, light, arctic, rose, brown, volcano, ocean, forest, sunset, grape, amber, slate, crimson, emerald
- Most dark themes have radial-gradient body backgrounds for ambient color
