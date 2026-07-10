---
name: Arena, Usage, Chat, InputBox, MessageBubble, SiteMap design review
description: First-pass design review of Arena, Usage, Chat page, InputBox, MessageBubble, and SiteMap — issues, wins, and recurring patterns to watch
type: project
---

Reviewed 2026-03-28. Key findings to carry forward:

**Arena page (`src/app/(app)/arena/page.tsx`)**
- The response panels use `min-h-[200px]` hardcoded height — bad on mobile
- Voting buttons have no pressed/active state, only hover color change
- Leaderboard is hard-capped to `max-w-md` while battle area uses full width — visual rhythm mismatch
- Input uses `<input>` (single-line) instead of `<textarea>` — mismatch with the main chat InputBox aesthetic
- No loading skeleton in the response panels (just a 2px pulsing dot)
- Suggested prompts render in random order on every render (`.sort(() => Math.random() - 0.5)` inside JSX) — causes layout jump

**Usage page (`src/app/(app)/usage/page.tsx`)**
- Activity heatmap cells are 12x12px (w-3 h-3) — too small on mobile, no tap target
- The bar chart's label column is `w-20` fixed-width and right-aligned — long model names truncate awkwardly
- Stat cards use `text-2xl` values but no animation on mount — feels static compared to the rest of the platform
- The page header is left-aligned; Arena page header is center-aligned — inconsistency
- "Favorite Model" stat card can display a raw model ID (e.g. `suzhou-3`) if getModelName lookup fails

**Chat page (`src/app/(app)/chat/[id]/page.tsx`)**
- Empty state greeting is `text-4xl md:text-5xl lg:text-6xl` — the lg size at 6xl might be too dominant on wide screens
- Sub-tagline under the greeting cycles by `new Date().getMinutes() % 6` — will only change once a minute and users on the page at :00 vs :59 see identical text for the whole minute, slightly awkward
- Export button is `absolute top-2 right-4` and overlaps ChatArea scroll content at small viewport heights
- Keyboard shortcut hint tooltip appears at `bottom-24` fixed — may overlap the InputBox on small screens

**InputBox (`src/components/Chat/InputBox.tsx`)**
- Contextual hints use `bg-violet-500/8` and `bg-indigo-500/8` — hardcoded, not brand tokens. Flag per existing convention.
- The footer keyboard shortcut hint (`hidden sm:block`) disappears below sm breakpoint with no replacement affordance — users on mobile never know about Enter-to-send
- `border-2` on the wrapper is heavier than typical shadcn card borders — may look slightly chunky in light mode where borders are already visible at `#c8c8c8`
- `rounded-[20px]` is a raw pixel value, not using the `--radius` token (1.125rem = 18px, 20px is close but inconsistent)

**MessageBubble (`src/components/Chat/MessageBubble.tsx`)**
- User bubble `max-w-[72%]` — on very narrow mobile (320px), 72% is about 230px which is fine, but the value is arbitrary; `max-w-prose` or a capped pixel value would be more principled
- Action buttons (Copy, Like, Dislike, Regenerate) have `p-1.5` tap targets — that's 6px padding on a 15px icon = 27px total, right at the minimum 24px but nothing to spare. Should be `p-2` minimum.
- `ring-violet-400/40` sparkle ring on Avatar — still a hardcoded color, not brand token (matches existing tracking in design_tokens.md)
- The `liked`/`disliked` state is local component state and resets on re-render. Not persisted. Fine for now but worth noting.

**SiteMap (`src/app/site-map/page.tsx`)**
- Grid column template `grid-cols-[1fr_100px_70px]` collapses awkwardly on mobile (the URL column becomes very narrow)
- The color-coded priority system (emerald / sky / amber / zinc) is a nice touch and self-consistent
- No `noindex` signal visible in the page — a public HTML sitemap probably shouldn't be crawled itself if the XML version is the canonical

**Cross-cutting patterns identified:**
- `violet-500` and `indigo-500` are recurring as accent/UI-state colors across Arena, Usage, and InputBox. They're doing the job of what a proper `--brand-accent` token should be. Should be tokenized.
- Page headers alternate between centered (Arena) and left-aligned (Usage) for no apparent reason.
- `font-mono uppercase tracking-wider` for section labels is consistent and good — keep it.

**Why recorded:** These findings inform future review sessions and establish what "on-brand" looks like for interior app pages vs. marketing pages.
