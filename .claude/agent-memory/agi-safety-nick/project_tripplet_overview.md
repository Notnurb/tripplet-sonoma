---
name: Tripplet platform overview
description: Key architectural facts about Tripplet relevant to safety review work
type: project
---

Tripplet is a Next.js 16 / React 19 / TypeScript multi-modal AI platform backed by Tripplet models.

**Why:** Reference for scoping safety reviews — knowing the stack, auth model, and attack surfaces avoids re-reading CLAUDE.md every session.

**How to apply:** Use when starting any new feature or API review to orient quickly.

Key facts:
- Auth: Clerk (@clerk/nextjs). API routes use `auth()` from `@clerk/nextjs/server`.
- Guest mode: unauthenticated, cookie-tracked, client-enforced 15-message limit, locked to Suzhou 3 (suzhou-3). NO server-side message counter as of 2026-03-16.
- External backend at BACKEND_URL (not in repo): handles memory, search, agents, LoopTrain, Triplepedia.
- Rate limiting: in-process LRU cache (lru-cache) — will NOT survive multi-instance / serverless deployments.
- Anura OS: prompt-level only (system addendum); the @anura trigger is not wired up — not a live VM surface.
- Web search injection: live web content injected into system prompt context — prompt injection surface.
- systemPromptOverride field in /api/chat is gated to authenticated users only.
- /api/code, /api/agents, /api/vision, /api/looptrain/start have NO auth or rate limiting as of 2026-03-16.
