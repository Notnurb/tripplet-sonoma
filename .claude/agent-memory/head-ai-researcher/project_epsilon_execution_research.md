---
name: Epsilon Execution Architecture Research
description: Research findings on Python execution, file downloads, and user-facing Supabase DB operations for Tripplet's AI code generation platform (Epsilon/Coder feature)
type: project
---

Epsilon (the code generation feature at /api/code) currently only generates code files in-browser — it does not execute Python, create downloadable files, or expose DB operations to users. Research was conducted on 2026-03-17 into three extension areas.

**Key existing facts:**
- `pg` package is already installed (v8.18.0) — direct Postgres access is available server-side
- `@supabase/supabase-js` v2 and `@supabase/ssr` already installed
- Supabase uses service-role key server-side (full access, RLS bypassed) and anon key browser-side
- No Python execution infrastructure exists today
- Rate limiting uses LRU-cache pattern in `src/lib/security/rate-limit.ts` — easy to extend for new routes
- Auth via Clerk `auth()` — all new execution routes must gate on `userId`

**Why:** User wants to extend Epsilon so the AI can run generated code, create downloadable artifacts, and interact with a user-scoped database — making it a true AI-powered development environment.

**How to apply:** When suggesting implementation plans for Epsilon execution features, build on the existing `pg`, Supabase, and rate-limit infrastructure. Do not suggest adding redundant packages for things already covered.
