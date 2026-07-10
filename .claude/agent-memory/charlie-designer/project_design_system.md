---
name: Tripplet Design System Tokens
description: Core design tokens, typography, color system, animation conventions, and landing page layout patterns from globals.css and existing pages
type: project
---

Design system is defined in `src/app/globals.css` using CSS custom properties.

**Typography**
- Font sans: Outfit (via `--font-outfit`)
- Font mono: Geist Mono (via `--font-geist-mono`)
- Icon library: HugeIcons (`@hugeicons/react`) as primary; Lucide as secondary
- H1 hero: `gradient-text text-4xl font-bold tracking-tight md:text-5xl lg:text-6xl`
- H2 section: `text-2xl font-bold tracking-tight md:text-3xl`
- Eyebrow: `text-sm font-medium text-muted-foreground mb-4`
- Body: `text-muted-foreground leading-relaxed`
- `gradient-text` = animated linear-gradient cycling foreground → muted-foreground, 8s

**Color Tokens (key ones)**
- `--brand`: #0a0a0a (light) / #f5f5f5 (dark) — used for active states, links, accents
- `--background`, `--foreground`, `--card`, `--muted`, `--accent`, `--border`, `--ring`
- Sidebar has its own token set: `--sidebar`, `--sidebar-foreground`, `--sidebar-accent`, `--sidebar-border`
- 15 themes via `[data-theme]` attribute — dark, midnight, arctic, rose, brown, volcano, ocean, forest, sunset, grape, amber, slate, crimson, emerald
- Forest theme bg: `#040d06`; Emerald theme bg: `#040e08` — closest existing green themes for reference

**Radius**
- `--radius: 1.125rem` base
- Scale: sm = radius-8px, md = radius-4px, lg = radius, xl = radius+4px, 2xl = radius+8px, 3xl = radius+12px, 4xl = radius+16px

**Animations (keyframes in globals.css)**
- `blink` — 1s step-start — used for streaming cursor
- `shimmer` — 3s ease-in-out infinite
- `float` — 4s ease-in-out
- `glow-pulse` — 3s ease-in-out
- `gradient-flow` — 6s ease
- `pulse-ring` — 2s cubic-bezier
- `grain` — 8s steps(10) — premium texture overlay
- Easing constant used across all pages: `[0.25, 0.46, 0.45, 0.94]`

**Landing Page Animation Patterns**
- Hero entry: `opacity 0→1, y: 20→0, filter: blur(10px)→blur(0)`, duration 0.6–0.7s, staggered delays 0.1–0.4s
- Scroll sections: `whileInView`, `viewport={{ once: true, margin: '-60px' }}` or `'-40px'`
- Card hover: `whileHover={{ y: -3 }}`, `transition: { duration: 0.25 }`
- Icon hover: `whileHover={{ scale: 1.1, rotate: 5 }}`, spring stiffness 400 damping 15
- Feature alternate-side: `initial={{ opacity: 0, x: isEven ? -28 : 28, filter: 'blur(6px)' }}`
- Timeline dot: scale 0→1, spring stiffness 300
- Timeline line: `scaleY: 0→1`, 1.2s, `originY: 0`

**Layout Conventions**
- Max width: `max-w-5xl` for all landing sections
- Section padding: `px-4 py-20 md:py-28`
- Hero padding: `pt-32 pb-20 md:pt-40 md:pb-28`
- Stats pillars grid: `grid-cols-2 md:grid-cols-4`, border-y + border-r dividers, `py-10`
- Values/cards grid: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`, `gap-4`
- Two-column feature blocks: `md:grid-cols-2 gap-12 md:gap-16`, alternating image side via `md:[&>:first-child]:order-last`

**Component Patterns**
- Cards: `rounded-2xl border border-border bg-card p-6 card-hover`
- Icon containers: `h-10 w-10 rounded-xl border border-border bg-background flex items-center justify-center`
- Pill/badge: `rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground`
- CTA buttons: `rounded-full`, with `ArrowRight` + `group-hover:translate-x-0.5`
- Stat tiles: `rounded-2xl border border-border bg-card px-4 py-3 text-center`
- Feature label: `inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground`

**Texture & Effects**
- `grain-overlay` class on page root div
- `card-hover` CSS class: translateY(-2px) + shadow on hover (dark: shadow 0 8px 30px -12px rgba(0,0,0,0.5), border-color #404040)
- `grid-bg` + `grid-bg-fade` for masked grid backgrounds

**Nav (LandingHeader) — how to add/style a link**
- Nav links are hardcoded in `src/components/ui/landing-header.tsx` in the `links` array
- All nav links share `buttonVariants({ variant: 'ghost', size: 'sm' })` + underline pseudo-element
- To visually distinguish one link (e.g., green for Environment), pass extra className inline to that specific `motion.a` — do NOT change the shared variant call
- Mobile menu also renders from the same `links` array — any addition appears in both

**Footer**
- Footer columns in `src/components/ui/landing-footer.tsx` — add links in `columns` array
- Copyright area has an easter egg on hover

**Focus rings**
- `*:focus-visible` → 2px solid `--ring`, offset 2, radius-sm

**Selection**
- `::selection` background = `--brand`, color = `--brand-foreground`

**Why this matters:** All component suggestions should use these tokens and patterns. The easing constant and animation structure must match exactly — pages that deviate feel like a different product.

**How to apply:** When designing or reviewing any Tripplet landing page, match these values precisely. Introduce new values only for strong page-specific reasons and scope them inline or in a page-level component, never in globals.css unless they belong to the whole system.
