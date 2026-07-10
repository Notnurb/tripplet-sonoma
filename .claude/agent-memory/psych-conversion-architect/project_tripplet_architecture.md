---
name: Tripplet App Architecture
description: Key files, existing psychological components, and product context for the Tripplet AI chat platform
type: project
---

Tripplet is a Next.js 16 + React 19 + TypeScript AI chat platform. Free forever model (no paid plans currently). Goal is engagement and retention, not monetization.

**Key pages:**
- Landing: `src/app/page.tsx` — hero, features grid, models section, stats, CTA
- Chat: `src/app/(app)/chat/[id]/page.tsx` + `src/components/Chat/ChatArea.tsx`
- Sign-in: `src/app/sign-in/page.tsx` — custom Clerk page with Google/Apple/X OAuth + email/pass
- App layout: `src/app/(app)/layout.tsx` — wraps chat with sidebar

**Existing psychological components (already built):**
- `GuestConversionCard` — loss-aversion framed card, shows after 3 msgs, dismissible per session
- `TabVisibility` — changes document title when tab loses focus ("Come back -- your AI is waiting")
- `useVisitStreak` — localStorage streak counter (tracks consecutive days), used in Sidebar StreakBadge
- `StreakBadge` — sidebar streak display with guest CTA to save streak via account creation
- `SocialProofLine` — rotating text in sidebar footer (50k+ users, 10 seconds, no card needed)
- `ModelSelector` — Taipei locked for guests with "Free account unlocks this" link
- Guest endowment nudge in system prompt at 6+ messages (AI may mention memory benefit once)
- First-message toast, "on a roll" toast at 4 consecutive msgs within 2min
- Persona keyword detection (localStorage), progress ring milestones
- Idle pulse on input box after 40s inactivity in empty state

**Guest restrictions:**
- 15 user-turn limit per conversation (server-enforced via message count in request body)
- Locked to Suzhou 3.1 only (403 if other model attempted)
- No image/video generation (AI returns :::sign-in-placeholder::: token)
- No persistent memory (AI cannot recall past sessions)
- Conversations in localStorage only (no server persistence)

**Error handling for guest limit:** API returns 403 JSON `{error: "Guest message limit reached"}`. Client in useChat.ts catches non-ok response, throws error, which renders as inline `Error: ...` message in chat. No redirect, no modal, no special handling.

**Models:** Taipei 3.1 (reasoning), Majuli 3.1 (fast), Suzhou 3.1 (creative)
**Auth:** Clerk, conversations saved to API for signed-in users, localStorage for guests
**Sign-in page hard-codes:** "You've reached the guest message limit" as subtitle -- always shows this even for direct navigation

**User hates:** SuggestedPrompts, SuggestionChips, depth/exchange counter pill. Do NOT add these.

**Identified gaps (2026-03-28 audit):**
- Guest limit reached = dead end. No modal, no graceful degradation, just inline error text
- GuestConversionCard is session-dismissible — once closed, no re-trigger for rest of session
- TimeSavedCard only triggers at exactly every 10th assistant message — easy to miss
- No sunk-cost visualization (guests cannot see what they will lose)
- No social proof inside the chat flow itself, only in sidebar footer
- Guest toast nudges have a typo at message 8: "Your using" should be "You're using"
- Visit streak is tracked but has no visible reward, celebration, or CTA beyond sidebar badge
- Progress ring is signed-in only — guests never see it
- No exit-intent or tab-close intervention for guests with unsaved conversations
- No "what you're missing" preview of locked features (image gen, video, memory, etc.)

**Why:** Understanding existing components prevents duplicate work and identifies gaps for new psychological interventions.
**How to apply:** Always check this list before recommending new components. Build on existing hooks (useVisitStreak) rather than creating parallel systems.
