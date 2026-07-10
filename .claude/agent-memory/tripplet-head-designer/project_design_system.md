---
name: Tripplet Design System Tokens
description: Core color tokens, typography, spacing, and animation conventions from globals.css and component patterns
type: project
---

## Tailwind Configuration
- **No tailwind.config.ts** — project uses Tailwind v4. All theme config lives in `@theme` and `@theme inline` blocks inside `/src/app/globals.css`. This is the single source of truth for all design tokens.
- tw-animate-css and shadcn/tailwind.css are imported at the top of globals.css.
- `@custom-variant dark (&:is(.dark *))` — dark mode is class-based.

## Color Tokens (CSS Variables)

### Dark Mode (primary aesthetic)
- `--background: #000000` — pure black (dark) / `#ffffff` (light)
- `--foreground: #f5f5f5` — near-white
- `--card: #141414` — elevated surface
- `--border: #2a2a2a` — subtle dividers
- `--muted: #1e1e1e` — muted surface
- `--muted-foreground: #a0a0a0` — secondary text
- `--brand: #f5f5f5` (dark) / `#0a0a0a` (light) — primary brand color matches foreground
- `--sidebar: #0f0f0f` — sidebar surface

### Status Colors (in components)
- Emerald: `text-emerald-400` — success/complete states
- Red: `text-red-400` — failure/error states
- Amber: `text-amber-400` — warnings/adapted states
- Purple: `text-purple-400` / `bg-purple-500/10` — Anura feature badge

## Typography
- Font: Outfit (sans), Geist Mono (mono)
- Text scale: text-[10px], text-xs, text-sm, text-base, text-lg, text-3xl
- Font weights: font-medium, font-semibold
- Tracking: tracking-tight (headings), tracking-wider (uppercase labels)

## Border Radius
- `--radius: 1.125rem` — large, premium feel
- Components use: rounded-xl, rounded-2xl, rounded-3xl, rounded-full

## Animation Conventions (framer-motion)
- Standard enter: `{ opacity: 0, y: 8 }` → `{ opacity: 1, y: 0 }`, duration 0.25–0.3
- Exit: often scale 0.98 or y: -8
- Spring for count/badge pops: `{ type: 'spring', stiffness: 500, damping: 18 }`
- Step/list stagger: delay: index * 0.04–0.08
- Height collapse: `{ height: 0, opacity: 0 }` → `{ height: 'auto', opacity: 1 }`, duration 0.2

## Spacing Patterns
- Panel padding: px-4 py-3 (headers), px-4 py-4 (content areas)
- Input areas: px-3 pb-3 pt-2
- Gap between items: gap-2, gap-2.5, gap-3, gap-4

## Common Component Patterns
- Hover states: `hover:bg-accent/80` or `hover:bg-foreground/10`
- Active/selected: `bg-brand/10` or `bg-brand/15` with `text-brand`
- Muted label caps: `text-xs font-semibold uppercase tracking-wider text-foreground/80`
- Mono metadata: `text-[10px] font-mono text-muted-foreground`
- Border dividers: `border-b border-border`

## Themes
The app supports 15 themes via `[data-theme]` attribute on root. Midnight theme uses indigo-tinged darks (#05050f bg, #0a0a1c card). All themes honor the same CSS variable names.

## Landing Page Animation System (page.tsx + about/page.tsx)
- **Ease constant:** `[0.25, 0.46, 0.45, 0.94]` — defined once as `const ease` and reused everywhere
- **BlurFade component:** `opacity 0→1, y 24→0, blur 10px→0, duration 0.7s` for above-fold hero elements
- **ScrollBlurFade component:** same but `whileInView`, `once: true`, `margin: '-80px'`, duration 0.6s
- **Section stagger:** cards use `delay: i * 0.08–0.12`
- **Card whileHover:** `y: -4, duration: 0.2` on feature/model cards
- **Icon whileHover:** `scale: 1.12, rotate: 6, spring stiffness: 400, damping: 15`
- **Timeline vertical line:** `scaleY: 0→1, originY: 0, duration: 1.2s` — dramatic entrance
- **Trilo float animation:** `y: [0, -10, 0], duration: 3.5s, repeat: Infinity, easeInOut`
- **Trilo entrance:** `x: -32→0, rotate: -6→0, duration: 0.7s`

## Landing Page Layout Patterns
- Container: `mx-auto w-full max-w-5xl px-4`
- Section separation: `border-t border-border` + `py-20 md:py-28`
- Hero padding: `pt-32 pb-24 md:pt-40 md:pb-32`
- Decorative side borders: `w-px bg-foreground/10` with mask-y fade
- "How it works" panel: `grid gap-px bg-border` — uses border color as the gap itself (no explicit divider elements)
- Stats grid: `grid-cols-2 md:grid-cols-4` with `[&:nth-child(2)]:border-r-0 md:[&:nth-child(2)]:border-r` trick for responsive border removal
- `grain-overlay` class on landing wrapper for film grain texture

## Chat Empty State Design
- BinaryBackground: `font-mono text-[8.5px] text-foreground/[0.045]`, radial gradient fade overlay center
- Greeting h1: `text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight` — changes per hour/day
- Subtitle: `text-muted-foreground max-w-lg text-base md:text-lg font-semibold` — rotates every minute
- Input group: `max-w-3xl` (empty) → `max-w-4xl` (with messages), transitions with duration-500
- Idle pulse after 40s: `animate-[pulse_1.2s_ease-in-out_2]` on input wrapper
- Keyboard shortcut hint: fixed bottom-24, rounded-full pill, backdrop-blur, fades in 3s after first message

## Inline Code Style
`bg-accent px-1.5 py-0.5 rounded-md font-mono text-[0.9em]`

## CodeBlock (Chat/CodeBlock.tsx)
- Wrapper: `rounded-2xl border border-border bg-card`
- Header: `bg-accent/30 border-b border-border px-4 py-2`
- Language label: `text-xs font-mono uppercase tracking-wider text-muted-foreground`
- Syntax: vscDarkPlus theme, fontSize 0.85rem, lineHeight 1.6, showLineNumbers, wrapLongLines
- Copy button: HugeiconsIcon (not lucide) — `Tick02Icon`, `Copy01Icon`
- NOTE: CodeBlock uses HugeiconsIcon while MessageBubble action row uses lucide-react — icon library mismatch between these two components

## Message Bubble Patterns
- **User:** right-aligned, `max-w-[72%]`, `bg-accent/70`, `rounded-3xl rounded-br-lg`, `px-5 py-3 text-sm`
- **Assistant:** no background bubble, left-aligned, `h-7 w-7` avatar with "AI" fallback text
- **Avatar sparkle:** `ring-2 ring-violet-400/40` on ~12.5% of messages (message ID hash % 8 === 0)
- **Action row:** `opacity-0 group-hover:opacity-100`, `text-[11px]`, buttons at `px-2 py-1 rounded-lg`
- **Streaming cursor:** `w-[3px] h-[1em] bg-foreground/60 rounded-[1px]` blinking inline-block
- **Search indicator:** `bg-indigo-500/10 border border-indigo-500/20`, `text-indigo-300/400`
- **Sign-in placeholder:** `max-w-[300px]` centered card with LockIcon

## About Page
- Timeline: alternating left/right on md+, `md:left-1/2` vertical line, dot `border-2 border-border bg-background`
- gradient-text class used on main h1 (animated shimmer)
- Pillars: text-3xl values vs text-2xl on landing stats — slight inconsistency

## Header (landing-header.tsx)
- Sticky, h-14, backdrop-blur-lg on scroll, border fades in on scroll
- Nav link underline: `after:` pseudo-element h-px, w-0→w-3/4 on hover
- MobileMenu: portal to document.body, fixed top-14, full-screen overlay

## Footer (landing-footer.tsx)
- 4-col grid (2+1+1+1): brand col spans 2 on mobile
- Footer link underline: same `after:` pseudo trick as nav
- Copyright easter egg: hover swaps to "Made with questionable sleep schedules..." via AnimatePresence

## Arena Page (arena/page.tsx)
- Header: plain `text-2xl font-bold tracking-tight` — no icon, no badge, misses the visual identity
- Leaderboard rank colors: amber-400 (1st), zinc-400 (2nd), orange-700 (3rd) — orange-700 is far too dark in dark mode; should be orange-600 or orange-400
- Arena response panels: `min-h-[200px] max-h-[400px]` fixed — AI Arena is a standalone context; the hard `max-h-[400px]` with overflow-y creates a cramped reading experience for longer responses
- Voting buttons: all three ("A is better", "Tie", "B is better") share the same hover color (emerald); Tie should be amber. A visual distinction matters for UX signal.
- No scrollbar-thin on the response panels
- Suggestion chips here are contextually appropriate (it is a battle input context, not a chat input), so they are fine

## Usage Page (usage/page.tsx)
- Header is left-aligned; Arena header is center-aligned — inconsistent page header alignment between sibling pages
- Stat cards use `rounded-xl` consistently — good
- Bar chart label truncates at `w-20` (fixed-width right-aligned), model names can clip
- ActivityGrid cells use `w-3 h-3` (12px) — small on dense weeks, could be `w-[11px] h-[11px]` with rounded-sm consistently
- No empty-state for when conversations === 0; user sees "0" everywhere with no explanation
- BarChart bar `bg-violet-500/60` is good but no hover tooltip on individual bars — missed opportunity
- Loading spinner: `border-foreground/20 border-t-foreground/60` — fine but inconsistent with other loading patterns across app

## Dark Mode Token Issue
- `--background: #000000` (pure black) in .dark, but `--background: #000000` is ONLY in .dark override; the base :root is #ffffff. Theme system is correct.
- CodeBlock hardcodes `vscDarkPlus` syntax theme regardless of current app theme — in light themes (Arctic, Rose, Brown, Light), the code block stays dark. This creates jarring contrast violation.

## Sidebar Issues (2026-03-28 audit)
- Icon inconsistency: nav uses HugeiconsIcon for Agents/Generate/Code but Settings uses lucide-react `Settings` and `Code2`, `BookOpen`, `Cloud` — mixed icon libraries in the same component. Should unify to HugeiconsIcon.
- "⌘K to jump anywhere" hint at text-[9px] is barely legible — no command palette actually exists yet, so it's false affordance
- SocialProofLine renders at `text-[9px] text-muted-foreground/30` — nearly invisible. If it's meant to convert, 30% opacity defeats the purpose.

## InputBox Issues (2026-03-28 audit)
- Contextual hint banner uses hardcoded `text-violet-400` / `text-indigo-400` — in light themes these are too dark/saturated against light card backgrounds
- The `border-2` on the input container in focused state, combined with `scale(1.005)` motion, can cause micro-jitter on some GPU compositing paths — visually fine in most cases but worth monitoring
- Mode pills use `bg-foreground text-background` — correct inversion for dark mode, correct in light mode too

## MessageBubble Issues (2026-03-28 audit)
- ActionButton row has no background hover state — just `hover:text-foreground`. Consistent with design system but feels a bit bare.
- The avatar sparkle (violet ring on ~12.5% of messages) is based on message.id string hash — this creates the same messages always having the ring, which breaks the "random" feel. Low priority.
- `transition-all duration-600` on Avatar — `duration-600` is not a standard Tailwind class (steps are 500, 700). Should be duration-500 or duration-700.

## Chat Page Issues (chat/[id]/page.tsx)
- Empty state subtitle rotates by `new Date().getMinutes() % 6` — this is server-rendered-safe but means the subtitle only changes on page reload (or minute boundary). Not truly dynamic.
- Export button at `top-2 right-4` absolute-positioned — when the chat area is very short, this can overlap message content.
- Grammar error in guest nudge toast at message #8: "Your using our older model" — should be "You're".

**Why:** Recorded from globals.css and full component survey (2026-03-19, updated 2026-03-28).
**How to apply:** Always use CSS variable-based Tailwind classes (bg-background, text-foreground, border-border etc.) rather than hardcoded neutrals like neutral-950. The CoderWorkspace and ChatSidebar currently violate this by using bg-neutral-950/bg-neutral-900 — flag when touching those files.
