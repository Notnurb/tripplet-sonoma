# Architecture

*See also: [docs/ARCHITECTURE.md](../ARCHITECTURE.md) for the canonical Sonoma request-flow diagram this page expands on.*

## Layers

**Next.js App Router** (`src/app/`) — pages under route groups `(app)` (authenticated shell) and `(auth)` (login/register), plus `src/app/api/*` for all ~56 API routes. `middleware.ts` handles Edge-side JWT cookie verification for page redirects and pre-auths a few intentionally public paths (`/.well-known`, `/oauth`, `/mcp`).

**`src/lib/`** — the actual logic, kept out of route handlers where possible:
- `ai/` — model registry (`models.ts`), system-prompt builders (`system-prompt.ts` for legacy `/api/chat`, `model-prompts.ts` for the modern Sonoma path), the streaming client (`chat-client.ts`), web search (`websearch.ts`)
- `auth/` — first-party JWT session handling ([Auth](./Auth.md))
- `db/` — raw `pg` pool wrapper (`neon.ts`) for non-Prisma tables
- `sonoma/` — the agentic tool-loop stack: `prompt.ts`, `tools.ts`, `upstream.ts`, `deepcode.ts`, `stream.ts` (client-side SSE reader)
- `security/` — `rate-limit.ts`, `sanitize.ts`
- `python/run.ts` — real CPython execution (Pyodide/WASM) in a worker thread
- `sandbox/trippletLinux.ts` — the v86 browser Linux VM driver

**`services/`** — subprojects outside the Next.js app: `backend` (optional Python memory/search service), `opensonoma-agent` (vendored CLI, bundled into `public/opensonoma.tar.gz` at build time), `tools` (internal benchmarks).

**`prisma/schema.prisma` + `db/schema.sql`** — see [Database](./Database.md).

## Two chat paths

There are two distinct chat request paths in this codebase, and it matters which one you're editing:

1. **Legacy `/api/chat`** — used by the original chat UI. Builds its system prompt via `src/lib/ai/system-prompt.ts`, which loads persona identities from `sprompts/*.md` on disk (Taipei/Majuli/Suzhou; Astro falls back to a generic identity here since it predates Astro).
2. **Modern `/api/sonoma`** (agentic) — used by the Code/Agent workspaces. Thin route handler (`src/app/api/sonoma/route.ts`) delegates to `src/lib/sonoma/*` for prompt composition, the tool loop, and upstream SSE streaming. Uses `src/lib/ai/model-prompts.ts` for persona identities, which has full identities including Astro.

Both terminate in `resolveBackend()` (`src/lib/ai/llm.ts`), which picks Groq or OpenCode Zen per persona — never a hardcoded provider URL.

## Chat data flow (legacy `/api/chat`)

1. Client `useChat` hook (`src/hooks/useChat.ts`) → `POST /api/chat`
2. Server fetches user memory + web search results from the external `BACKEND_URL` backend, injects into the system prompt
3. Streams the response as SSE from whichever backend `resolveBackend()` selects
4. Client parses SSE chunks via `ReadableStream` + `TextDecoder`, buffers with `requestAnimationFrame`
5. Messages persisted to Neon; title generated via `/api/chat/title` on the first message

## Sonoma agentic flow (`/api/sonoma`)

```
Browser → POST /api/sonoma → auth · rate limit · validation
  → (persona = astro-5-code) → deepcode.ts: THINK ⇄ ROUTE → CODE pipeline
  → (everything else) → tool loop (max 4 rounds)
       → upstream.ts (SSE) → content / thinking / tool_call
       → tools.ts executes: websearch (SSRF-guarded), python/run.ts (real CPython),
         run_bash (acknowledged server-side, executed client-side in the v86 VM)
       → external content passes through sanitize.ts before re-entering model context
  → SSE events → Browser (single reader: lib/sonoma/stream.ts)
```

## Trust boundaries

1. **Client → server**: every payload is validated (roles, sizes, counts); client-supplied `system` messages are stripped server-side so external callers can't override persona/guardrails.
2. **Model → tools**: tool arguments are model-chosen from untrusted context, hence the SSRF guard on fetches and WASM/worker isolation on Python.
3. **Web → model**: search/fetch results are sanitized (directive stripping, envelope-tag removal) before entering context; the system prompt declares them untrusted.
4. **Server → client**: upstream provider names/errors stay server-side; the client only ever sees persona ids.

## Deployment shape

Vercel serverless. Files read from disk at runtime (`sprompts/`, `assets/faces/`, pyodide assets) are traced per-route in `next.config.mjs`. `OUTAGE_ACTIVE` (`src/lib/outage.ts`) is the site-wide kill switch — see [Deployment](./Deployment.md).
