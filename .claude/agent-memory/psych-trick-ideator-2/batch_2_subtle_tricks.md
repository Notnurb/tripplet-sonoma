---
name: Batch 2 — Five Subtle Psych Tricks (2026-03-16)
description: Five small surgical psychological UX tricks implemented for guest retention, identity attachment, and conversion. Covers Zeigarnik draft persistence, endowment memory language, variable-reward tab titles, identity-mirror sidebar copy, and loss-aversion guest card framing.
type: project
---

## Implemented Tricks

### 1. The Phantom Draft (Zeigarnik Effect)
- **File:** `src/components/Chat/InputBox.tsx`
- **What:** Saves textarea content to localStorage on every keystroke (debounced 400ms). On return, content is restored and placeholder reads "Pick up where you left off..." instead of the rotating generic placeholders.
- **Why:** Unfinished tasks nag the brain. Seeing your half-typed message pulls you back into engagement.
- **Status:** Implemented

### 2. Your AI Remembers (Endowment Effect via System Prompt)
- **File:** `src/app/api/chat/route.ts`
- **What:** For signed-in users with memory context, the system prompt now encourages the AI to occasionally (1 in 8-10 exchanges) reference something it remembers, making the user feel ownership. For guests with 6+ messages, the AI can mention (once per conversation) that a free account would let it remember them.
- **Why:** Endowment effect — once you feel the AI "knows" you, switching away feels like abandoning a relationship.
- **Status:** Implemented

### 3. The Return Whisper (Variable Reward Tab Titles)
- **File:** `src/components/ui/tab-visibility.tsx`
- **What:** When the user switches to another tab, after 4 seconds the tab title starts rotating through 7 curiosity-gap messages every 4s. Each glance at the tab shows a different message.
- **Why:** Variable reward schedule (slot machine principle) — unpredictable rewards are more engaging than predictable ones. The user never knows what the tab will say.
- **Status:** Implemented

### 4. The Identity Mirror (Identity-Based Framing)
- **File:** `src/components/Sidebar/Sidebar.tsx`
- **What:** Guest sidebar section dynamically labels the user based on conversation count: "Guest mode" (0-1), "You're getting the hang of this" (2-4), "You're a power user" (5+). CTA copy also adapts.
- **Why:** Identity-based motivation — when behavior is framed as "who you are" vs "what you should do," compliance jumps. Calling someone a power user makes them want to act like one.
- **Status:** Implemented

### 5. The Goodbye Tax (Loss Aversion)
- **File:** `src/components/Chat/GuestConversionCard.tsx`
- **What:** Once a guest has 3+ conversations, the card switches from gain-framed copy ("get features") to loss-framed copy ("You have X conversations that will disappear"). At 8+ messages, it counts their messages as "context your AI can't remember yet."
- **Why:** Loss aversion — losses hurt ~2x more than equivalent gains. "You'll lose 5 conversations" hits harder than "You'll get conversation history."
- **Status:** Implemented

## Compound Effects
- Tricks 1+5 stack: the Phantom Draft restores their half-typed thought, then the Goodbye Tax card reminds them their conversations will vanish. Double Zeigarnik + loss aversion.
- Tricks 2+4 stack: the AI mentioning memories (endowment) + sidebar calling them a "power user" (identity) creates a sense of belonging that transcends feature comparison.
- Trick 3 works independently as a persistent background pull regardless of conversion state.
