---
name: Tripplet design tokens and color conventions
description: CSS variables, color tokens, and hardcoded color anti-patterns found in the Tripplet codebase
type: project
---

Tripplet uses CSS variable-based design tokens for most colors (via Tailwind CSS variable mapping):
- `text-foreground`, `text-muted-foreground`, `bg-background`, `bg-card`, `bg-muted`, `bg-accent`
- `text-brand`, `bg-brand` — primary brand color token (violet-adjacent)
- `border-border`, `border-sidebar-border`
- Sidebar-specific: `bg-sidebar`, `text-sidebar-foreground`, `bg-sidebar-accent`
- `text-destructive` — used for delete/error states

**Known hardcoded color violations to fix:**
- `text-green-500` in CodeBlock.tsx line 57 (copied state) — should be `text-emerald-400` to match MessageBubble
- `ring-violet-400/40` in MessageBubble.tsx line 274 (Avatar sparkle ring) — should use brand token
- `bg-indigo-500/10`, `text-indigo-300/400` in MessageBubble.tsx lines 300-306 (search count pill) — acceptable but not tokenized
- `bg-violet-500/8`, `text-violet-400` in InputBox.tsx lines 427-431 (contextual hint for workspace links) — should use brand token
- `bg-indigo-500/8`, `text-indigo-400` in InputBox.tsx lines 436-440 (contextual hint for mode toggles) — should use brand token
- Sidebar.tsx guest CTA uses hardcoded `violet-500` — should use brand token

**Chat UI — spacing/layout conventions observed:**
- User bubble: `max-w-[72%]`, `rounded-3xl rounded-br-lg`, `bg-accent/70`, `px-5 py-3`
- Assistant message: no bubble, full width left-aligned, `gap-3` avatar+content layout
- Message spacing: user `mb-5`, assistant `mb-6`
- Action buttons: `p-1.5 rounded-lg`, 15px icons, `text-muted-foreground` default
- InputBox: `rounded-[20px] border-2`, max-w-3xl (empty state) / max-w-4xl (in-conversation)
- InputBox textarea: `text-[15px] font-medium`, `min-h-[44px] max-h-[220px]`
- Send button: `h-9 w-9 rounded-xl`, `bg-foreground text-background` when active

**Why:** Consistent token usage ensures a brand refresh only requires changing the token, not hunting down hardcoded values across 20 files.

**How to apply:** Always prefer `text-brand`, `bg-brand` etc. over `text-violet-*`. Flag any PR that introduces hardcoded color values where a token exists.
