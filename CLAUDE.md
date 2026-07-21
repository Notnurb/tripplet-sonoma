# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start Next.js development server (Turbopack enabled)
npm run build        # Production build
npm run lint         # ESLint
npm run type-check   # TypeScript check (tsc --noEmit)
npm run setup:db     # Run database setup scripts
./setup.sh           # Interactive setup TUI (Git Bash/WSL on Windows, or
                     # `npm run setup`) — install, run server w/ port +
                     # browser-open, per-OS tutorials, edits src/config.md
                     # (branding, port, model backends)
```

Prisma client is auto-generated on `npm install` via `postinstall`.

## Architecture Overview

**Tripplet** is a multi-modal AI platform built on Next.js 15 + React 19 + TypeScript. It runs on Tripplet's own model personas (served via OpenCode Zen and Groq behind `resolveBackend()`).
### Core Features
- **Chat** — Streaming AI conversations with composable modes and tones
- **Web Search** — Live search injected into system prompt context
- **User Memory** — Persistent memory via external `BACKEND_URL` service

### User-editable config (`src/config.md`)
Branding (app name/tagline/description), default port, and custom model
backends live in `src/config.md`, parsed by `src/lib/config-md.mjs` (single
source of truth — also used by the setup TUI). `next.config.mjs` injects
branding + picker entries as `NEXT_PUBLIC_*` env at startup (client code reads
`src/lib/branding.ts`, never fs); `resolveBackend()` in `src/lib/ai/llm.ts`
consults config entries first, so a config id matching a built-in persona
reroutes it and a new id defines a new model. Config problems always degrade
to defaults — config.md must never take the app down.

### AI Models (`src/lib/ai/models.ts`)
Persona ids are stable API identifiers; display names move independently (renames must not break saved conversations). Current lineup:
- **Astro 5** (`astro-5`) — flagship; **Astro 5 Code** (`astro-5-code`) is the DeepCode pipeline persona
- **Taipei 4** (`tura-3`)
- **Majuli 4** (`majuli-3`)
- **Suzhou 4** (`suzhou-3`)

Plus an opt-in **Legacy Models** tier (toggle in Settings; `LEGACY_MODELS` in `models.ts`, surfaced via `modelsForPage(..., includeLegacy)`): Synthara 5.2 Plus (`legacy-synthara-5.2-plus`), Taipei 3 (`legacy-taipei-3`), Majuli 3 (`legacy-majuli-3`), Suzhou 3 (`legacy-suzhou-3`).

### Chat Data Flow
1. Client `useChat` hook → `POST /api/chat`
2. Server fetches user memory + web search results from external `BACKEND_URL`, injects into system prompt
3. Streams the response as SSE from whichever backend `resolveBackend()` selects for the persona (`src/lib/ai/llm.ts`) — never a hardcoded provider URL
4. Client parses SSE chunks via `ReadableStream` + `TextDecoder`, buffers with `requestAnimationFrame`
5. Messages persisted to Neon (PostgreSQL); title generated via `/api/chat/title` on first message

### Modes & Tones (`src/lib/ai/modes.ts`, `src/lib/ai/system-prompt.ts`)
Composable toggles applied to system prompt construction:
- **Modes**: `think` (temp 0.3), `deep-research` (8k tokens, temp 0.5), `web-search` (temp 0.7), `study` (temp 0.4)
- **Tones**: formal, concise, detailed, minimal
- `deep-research` and `study` are mutually exclusive

### Auth
> ⚠️ **NOT Clerk.** One auth system: first-party JWT.

- **JWT auth**: `AuthPage.tsx` POSTs to `/api/auth/register` and `/api/auth/login`. Those routes hash with bcrypt, write to the `public.User` table via `prisma.user.*` (`src/lib/auth/user-store.ts`), and set a signed `auth_token` cookie (`src/lib/auth/jwt.ts`, HS256 via `jose`). Session read via `/api/auth/me`; logout via `/api/auth/logout`. Server-side helper: `auth()` in `src/lib/auth/session.ts` (used by ~35 API routes, degrades to guest on any failure). Middleware verifies the cookie Edge-side for page redirects.
- **Better Auth was removed (July 2026)**: it was fully mounted but never called by the UI. Its Prisma tables (`Account`, `AuthSession`, `Verification`) still exist in the schema/DB but nothing reads them; `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL` env vars are no longer required. Don't reintroduce it casually — the removal was deliberate de-risking.
- **`neon_auth` schema is legacy/unused**: a leftover from the Supabase→Neon migration. The app does **not** point at it. Don't assume it's live.
- **Route-folder naming**: the auth pages live at `(auth)/login/[[...sign-in]]` and `register/[[...sign-up]]` — a Clerk-style catch-all naming convention left over from before the JWT rewrite. It's cosmetic; no Clerk code exists (grep confirms). Don't infer Clerk from the folder names.
- **Guest mode**: Cookie-tracked, max 15 messages, locked to the Suzhou 4 model (persona id `suzhou-3`)

### Database
- **PostgreSQL** via **Prisma** ORM (`prisma/schema.prisma`) — Users, Conversations, Messages, FileUploads, AIUsage
- **Neon** is the PostgreSQL host. Prisma connects via `DATABASE_URL`/`DIRECT_URL`; raw SQL goes through the `pg` pool in `src/lib/db/neon.ts` (`query`/`queryOne`). Non-Prisma tables live in `db/schema.sql` (run via `npm run setup:db`).

### External Backend (`BACKEND_URL`)
A separate service (`services/backend` in this repo, deployed independently), reached via `backendFetch()` (`src/lib/backend.ts`). Endpoints actually called:
- Memory: `POST /memory/add` (`/api/chat`), `POST /memory/search` (MCP tools)
- Search: `POST /search/combined`, `POST /search/exa`, `POST /search/firecrawl` (`/api/search`)
- Also backs Agents, LoopTrain, and the Triplepedia knowledge base.

The app degrades gracefully when it's absent: the Sonoma web-search tool falls back to keyless DuckDuckGo (`src/lib/ai/websearch.ts`), and memory simply switches off.

### Special Features
- **Anura OS**: an `anura` boolean toggle on `/api/chat` that injects `ANURA_SYSTEM_ADDENDUM` (`src/lib/ai/system-prompt.ts`) into the system prompt, telling the model it has a task-running VM. ⚠️ **Prompt-level only right now** — the client-side VM iframe is not wired up. The dead `anuraTriggered` client state (formerly in `src/hooks/useChat.ts`, only ever *reset* to `false`, never set true, with no `@anura` trigger) was removed; the VM has never actually activated. For a *real* in-browser VM, use the **Sandboxed Linux** skill (v86 + `run_bash`, `src/lib/sandbox/trippletLinux.ts`), which actually executes.
- **Extended Thinking**: Deeper reasoning budget exposed in chat options
- **Connectors (Composio)**: Users link third-party apps (GitHub, Gmail, Notion, …) via the "Apps" menu in the chat composer (`src/components/Sonoma/ConnectorsMenu.tsx`, opt-in `connectors` prop on the Composer) or Settings → Connectors; Sonoma then gets per-user `composio_*` tools for the connected apps. `src/lib/composio/client.ts` (dependency-free v3 REST client, keyed by optional `COMPOSIO_API_KEY` — absent means feature off), `src/lib/composio/tools.ts` (tool-def bridge + sanitized/nonce-wrapped execution), `/api/composio/{apps,connections}` (auth-gated, ownership-checked). Tripplet user ids double as Composio user ids, so scoping is server-side.
- **Rate Limiting**: per-user/IP in `src/lib/security/rate-limit.ts` — shared Redis/KV store (Upstash or Vercel KV) when configured, failing open to per-instance LRU
- **Usage limits** (`src/lib/usage/`, `/api/usage`, `src/components/settings/UsagePanel.tsx`): per-user message metering on the existing `AIUsage` table (one row per admitted request, token estimates topped up post-stream). Epoch-anchored fixed windows — 5-hour and weekly — with per-plan caps in `policy.ts` (pure/client-safe; server helpers in `tracker.ts` fail open on DB errors). Every account resolves to the `free` plan until billing exists — `getUserPlan()` in `tracker.ts` is the extension point; do NOT add a `plan` column to the Prisma schema without migrating the live DB first. Enforced with 429 `code: 'usage_limit'` in `/api/chat` + `/api/sonoma`; Settings shows live bars (green <50%, yellow 50–80%, red ≥80%) with reset countdowns.
- **Dev-mode** (`src/lib/dev-mode.ts`, same flip-a-const pattern as `OUTAGE_ACTIVE`; toggle with `./dev on` / `./dev off`, `./dev` shows state): while `DEV_MODE_ACTIVE` is true **and NODE_ENV === 'development'** (hard-gated — inert on any deployed build), login is bypassed: `auth()`/`/api/auth/me`/middleware fall back to the **Tripplet Dev** account (`tripplet-dev`, upserted as a real User row for FKs; a real cookie always wins, `/login` stays reachable). Pressing `q` outside a text box toggles the global dev panel (`src/components/dev/DevModePanel.tsx`, mounted in `providers.tsx`): full-res tab screenshots (panel unmounts before capture), experiment helpers, and blog authoring via `POST /api/dev/blog` → `src/lib/dev-blog.ts`, which inserts real post entries into `src/app/blog/{page.tsx,[slug]/page.tsx}` + `src/lib/sitemap-data.ts` (marker-anchored; markers are guarded by `tests/unit/dev-blog.test.ts`), so panel-authored posts ship with the next commit.
- **x402 Store** (`/store`, `src/lib/x402`, `/api/x402/*`, `/.well-known/x402`): ACCOUNTLESS agent-first storefront — pay-per-call AI inference (`/api/x402/chat/completions`, X-PAYMENT header, USDC on Base) and prepaid `trpl_x4_` credit keys delivered inside payment receipts. No login anywhere in the loop; tables live in `db/schema.sql` (`x402_payments`, `x402_api_keys`, applied via `npm run setup:db`). Payment-integrity rules in `docs/dev/x402-store.md` — read it before touching `src/lib/x402/payments.ts` or the paid chat route.

### Application surface (~56 API routes, ~56 pages)
This repo is broad and fast-moving; not every route is load-bearing. The groups that matter:
- **Core chat**: `/api/chat`, `/api/sonoma` (agentic), `/api/chat/{title,history}`, `/api/execute` (real Python). Pages: `/chat`, `/code`, `/hyperagent`.
- **Auth**: `/api/auth/*` (register/login/logout/me/reset). See Auth above.
- **Developer API & OAuth/MCP** (security-relevant): `/api/oauth/{authorize,register,token}` + `/api/mcp` implement an OAuth2 + MCP server (`src/lib/mcp/*`); `/api/v1/chat/completions` + `/api/v1/models` form an OpenAI-compatible developer API keyed by `/api/developer/keys`. `models` returns a real 200 list, but `chat/completions` currently returns 503 — key management and the model list work, inference is disabled. The `/.well-known`, `/oauth`, `/mcp` paths are intentionally pre-auth (see `middleware.ts`).
- **Knowledge base**: `/api/triplepedia/*` + `/triplepedia` pages.
- **Integrations**: `/api/telegram/*`, `/api/connect/*` + `/installconnect` (OpenSonoma installer), `/api/cloud-env/*`, `/api/looptrain/*`.
- **Experimental / one-off surfaces** (low priority, may be stale): `/hivemind`, `/pixel`, `/spark`, `/studio`, `/skins`, `/generate`, `/environment`, `/tgrablockbatch`, `/trippletgrabthing`, `/epsilon-code` (companion-CLI promo page, `src/lib/ai/epsilon.ts`), `/v1/chat`, `/v2/chat`. Treat these as prototypes unless a task names one.

### Key Files
| File | Purpose |
|------|---------|
| `src/app/api/sonoma/route.ts` | Sonoma endpoint — validation, auth, rate limits, tool loop (thin; logic lives in `src/lib/sonoma/*`) |
| `src/lib/sonoma/` | prompt builder, tool defs+execution, upstream SSE streaming, DeepCode pipeline, client stream reader |
| `src/lib/python/run.ts` | Real Python execution (Pyodide in timeout-guarded worker threads) |
| `tests/unit/` | Vitest suite (`npm run test:unit`) — streaming, SSRF guards, auth tokens, route validation, real Python |
| `src/hooks/useChat.ts` | Main chat state, conversation CRUD, streaming |
| `src/app/api/chat/route.ts` | Chat API — memory/search injection, streaming |
| `src/lib/ai/chat-client.ts` | OpenAI-compatible streaming client — routes per persona via `resolveBackend()`. Vision/image/video generation is disabled: `analyzeImage()` is a stub that throws, and the `/api/vision` route still exists (auth-gated, rate-limited) but only returns that error. |
| `src/lib/ai/system-prompt.ts` | Legacy `/api/chat` system-prompt builder (modes/tones); loads persona identities from `sprompts/*.md` (Taipei/Majuli/Suzhou; Astro falls back to a generic identity here). The modern Sonoma path uses `src/lib/ai/model-prompts.ts` instead, which has full per-persona identities including Astro. |
| `src/types/index.ts` | All shared TypeScript types |
| `src/app/providers.tsx` | Context providers (Auth, Subscription, Tooltip) |


## Codewords

- **"El Taco"** — When the user says "El Taco", activate ALL available agents in parallel: CEO, designers (Charlie, Steven, Liam), AI researchers (Tommy, Sally, Alex, Eli, Emma, Head AI Researcher), psychologists (Olivia, psych-conversion-architect, psych-trick ideators), AGI safety team (Tony, Sarah, Nick, Lauren), data scientist, analytics engineer, idea generators, meta-idea brainstormer, assistant coder, and any other available agents. Everyone works together to find bugs, improve usability, polish UI/UX, strengthen safety, and make the platform better. This is the "all hands on deck" command.

- **"taco orange"** — Creative improvement mode: implement feature ideas, psychological conversion tricks, and UX improvements without waiting for a detailed brief.

## UI Rules — Do NOT break these

- **No suggested prompts / recommendation chips above the chat input.** The user explicitly does not want SuggestedPrompts, SuggestionChips, or any prompt grid/chip UI rendered in the chat empty state or anywhere near the input box. Do not add these, even as part of "polish" or "finishing" tasks.
