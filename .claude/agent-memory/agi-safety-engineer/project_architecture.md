---
name: project_architecture
description: Core architecture of Tripplet/x1-chat — tech stack, AI models, auth, external services
type: project
---

**Stack:** Next.js 16 + React 19 + TypeScript. Deployed on Vercel.

**AI:** Tripplet models via the inference backend. Three model aliases: tura-3 (reasoning), majuli-3 (fast), suzhou-3 (creative/guest). Vision via internal-model Image/video gen via separate the inference backend endpoints.

**Auth:** Clerk (@clerk/nextjs). API routes use `auth()` from `@clerk/nextjs/server`. Guest mode is cookie-tracked client-side.

**Database:** PostgreSQL via Prisma ORM, hosted on Supabase. Browser client: src/lib/supabase/client.ts. Server admin client: src/lib/db/supabase.ts (uses service role key).

**External BACKEND_URL:** Separate service (not in repo) handles memory storage/retrieval, web search, agents, LoopTrain, Triplepedia. Called from src/app/api/chat/route.ts.

**Special features:**
- Anura OS: prompt-level only (system addendum); no @anura trigger or VM iframe wired up
- Hivemind: shared collective memory pool (uses 'collective-hivemind' user ID — only for authenticated users)
- LoopTrain: spawns server-side Python process — restricted to ADMIN_USER_IDS after 2026-03-16 audit
- Developer API keys: stored hashed (SHA-256) in Supabase developer_api_keys table

**System prompts:** Loaded from /sprompts/*.md files at runtime (not bundled). Files: taipei.md, majuli.md, suzhou.md + extended variants (taipeix.md, etc.).

**Key safety files:**
- src/app/api/chat/route.ts — main chat endpoint, memory/search injection, guest mode
- src/lib/ai/system-prompt.ts — system prompt builder
- src/lib/security/rate-limit.ts — LRU-cache based per-user/IP rate limiting
