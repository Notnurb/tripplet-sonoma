# New Product Idea: Tripplet Pulse — the AI that messages *you* first

> Status: PROPOSED · Owner: Alex · Generated 2026-07-07
> A brand-new idea. Nothing like this exists in the codebase today.

## 1. The one thing every chat AI gets wrong

Every AI product — Tripplet included — is **pull-only**. It sits silent until you
open it and type. The relationship is 100% user-initiated, which means the AI only
ever helps with what you already thought to ask. The most valuable help is the
thing you *didn't* think to ask about.

**Tripplet Pulse flips the direction: the AI reaches out to you first.** Not
notification spam — a single, genuinely useful daily message, written from your
own Memory, that anticipates the day instead of waiting for a prompt.

This does not exist anywhere in Tripplet today. There is no proactive layer, no
outbound message, no "what should I tell this user, unprompted" pipeline. Every
existing surface (Chat, hyperagent, @anura) is reactive.

## 2. What Pulse is

Once a day (a time the user picks), Tripplet composes and sends **one Pulse** — a
short, personal briefing that only makes sense *for this user*, built by combining
three things Tripplet already has but has never pointed at the user proactively:

- **User Memory** (`BACKEND_URL` memory service) — what the user is working on,
  cares about, keeps returning to.
- **Web Search** (`/search/combined`) — what changed in the world overnight that
  intersects those interests.
- **A model** (Astro 5 / Taipei 4) — to synthesize, not list.

Example Pulse:
> "Morning. The framework you were debugging Thursday (Next.js 16 canary) shipped
> a fix for the exact streaming bug you hit — here's the note. You said you'd
> follow up with Sam about the lease; it's been 4 days. And the one thing worth
> 10 minutes today: your deep-research on X had a gap — the pricing data. Want me
> to finish it?"

Every line is grounded in *this person's* memory. A stranger's Pulse would be
completely different. That's the moat: it's impossible to fake without the memory
graph, and impossible to commoditize because it's personal by construction.

## 3. Why this is different from "notifications" or "scheduled agents"

- It's **not a reminder app** — the user sets no reminders. Pulse infers what
  matters from behavior and memory.
- It's **not a digest of the app** — it's a digest of *the user's life through
  the app's lens*.
- It's **not the scheduled-agent idea** (TrippletSpace) — that runs tasks the user
  configured. Pulse decides, unprompted, what's even worth surfacing. It's the
  difference between an employee you assigned work and a chief-of-staff who tells
  you what you're missing.

## 4. The magic mechanic: every Pulse is a live conversation opener

A Pulse isn't a dead notification. Each item is **tap-to-continue** — tapping "Want
me to finish it?" drops you into a Tripplet chat already loaded with the context.
So Pulse is also the app's best re-engagement and re-entry surface: the AI hands
you a warm thread instead of a blank input box.

This is the psychological inverse of the empty chat screen. Empty input = "what do
I want?" (high friction). A Pulse = "here are three things, one tap each" (zero
friction). It manufactures daily sessions that would never have happened.

## 5. Why it's a growth + retention weapon

- **Retention:** a daily, genuinely-personal message is the strongest habit loop a
  software product can have — it's the reason people keep the app installed. Most
  AI apps have *zero* proactive retention surface.
- **Growth:** Pulses are quotable. "My AI told me the framework I was stuck on
  just shipped my fix" is a screenshot people share — and it ties into the
  `GROWTH_IDEA.md` Proof-Link loop (a Pulse item can mint a shareable page).
- **Revenue:** Pulse is a premium feeling. Free = weekly Pulse; Pro = daily; Max =
  multiple Pulses + deeper research per item. Slots straight into the tiers in
  `PRODUCT_PLAN.md` without inventing a new metering axis.

## 6. Trust guardrails (proactive AI is a trust minefield — make it the pitch)

- **Opt-in and quiet by default.** One message, one channel, user-chosen time.
  Never more than the user asked for.
- **Every claim cites its source** (memory item or web result) — no hallucinated
  "you said." If Memory doesn't support it, it doesn't ship.
- **One-tap "less like this / more like this"** on each Pulse item — the feedback
  trains what future Pulses surface (writes back to Memory).
- **Hard off switch**, and a visible "why am I seeing this?" on every line.

## 7. Rough shape (where it would plug in)

| Piece | Where |
|---|---|
| Nightly composer job (per opted-in user) | new backend job hitting Memory + `/search/combined` + a model |
| `Pulse` + `PulseItem` records (content, source refs, feedback, deliveredAt) | `prisma/schema.prisma` |
| Delivery channels (in-app inbox first; email/Telegram next — a Telegram webhook already exists at `src/app/api/telegram/webhook/[slug]`) | new `src/app/api/pulse/**` |
| In-app Pulse inbox + tap-to-continue → seeded chat | new `src/app/(app)/pulse/**`, reuse `useChat` seeding |
| Feedback loop writes back to Memory | existing `BACKEND_URL` memory `POST` |
| Metering (cadence per plan) | reuse `src/lib/limits/*` |

## 8. First test (cheap, ~1 week)

Ship an **in-app-only weekly Pulse** for opted-in users: one composed message,
delivered to a Pulse inbox, each item tap-to-continue into chat. No email, no
Telegram, no daily cadence yet. Measure: open rate, tap-through into chat, and
day-N return. If a weekly Pulse pulls people back, increase cadence and add
channels. If it doesn't, we spent one composer job and one inbox page to learn it.

## 9. Out of scope / follow-ups

- Multi-channel delivery (email/Telegram/push) after the in-app inbox proves value.
- Pulse "moments" beyond daily — event-triggered ("the thing you were waiting on
  just happened").
- Letting a TrippletSpace agent *be* the composer, so power users tune their own
  Pulse — the two ideas compose.
