# API Routes

`src/app/api/` has ~30 top-level route groups covering ~56 individual routes. Grouped by purpose — verified against the actual directory listing.

## Core chat

- `/api/chat` — legacy chat endpoint (memory/search injection, streaming)
- `/api/chat/title`, `/api/chat/history` — title generation, conversation history
- `/api/sonoma` — the modern agentic endpoint (tool loop, DeepCode). See [Architecture](./Architecture.md)
- `/api/execute` — real Python execution (`src/lib/python/run.ts`)
- `/api/code` — Code workspace support endpoints

## Auth

`/api/auth/{register,login,logout,me,forgot-password,reset-password}` — see [Auth](./Auth.md). Note: `forgot-password` currently generates a reset token but does not yet send the email (`TODO` in the route).

## Developer API & OAuth/MCP (security-relevant)

- `/api/oauth/{authorize,register,token}` + `/api/mcp` — OAuth2 + MCP server (`src/lib/mcp/*`)
- `/api/v1/chat/completions` + `/api/v1/models` — OpenAI-compatible developer API, keyed by `/api/developer/keys`. `models` returns a real 200 list; **`chat/completions` currently returns 503** — the surface and key management exist but inference is disabled.
- `/.well-known/*`, `/oauth`, `/mcp` paths are intentionally pre-auth in `middleware.ts` (OAuth discovery/handshake has to work before the caller has a session)

## Knowledge base

`/api/triplepedia/*` — backs the `/triplepedia` pages, an AI-fact-checked encyclopedia. Content operations go through the external backend (`BACKEND_URL`).

## Integrations

- `/api/telegram/*` — Telegram bot webhook + management (see `TelegramBot`/`TelegramMessage` in [Database](./Database.md))
- `/api/connect/*` — OpenSonoma device pairing (`/installconnect` is the companion installer page); see `src/lib/connect/pairing.ts` for the XXX-XXX pairing code format
- `/api/cloud-env/*` — server-side Python workspace execution, admin/user-gated (see [Security](./Security.md))
- `/api/looptrain/*` — admin-only load-testing process spawner

## Supporting / utility

`/api/agents`, `/api/dev`, `/api/deploy`, `/api/environment`, `/api/faces`, `/api/feedback`, `/api/health`, `/api/hyperagent`, `/api/image-proxy`, `/api/memory`, `/api/plan`, `/api/sandbox`, `/api/search`, `/api/user`, `/api/vision` — one route group each, scoped to their name. `/api/health` is the uptime probe target; `/api/faces` serves the avatar images now under `assets/faces/`.

## Experimental / one-off surfaces (may be stale)

Pages, not necessarily backed by dedicated API routes: `/hivemind`, `/pixel`, `/spark`, `/studio`, `/skins`, `/generate`, `/environment`, `/tgrablockbatch`, `/trippletgrabthing`, `/v1/chat`, `/v2/chat`. Per `CLAUDE.md`, treat these as prototypes unless a task specifically names one — don't assume they're load-bearing or well-tested.
