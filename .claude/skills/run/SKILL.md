---
name: run
description: Launch and verify the Tripplet (Sonomachat) Next.js app locally. Use when asked to run, start, or screenshot the app, or to confirm a change works end-to-end in the real app rather than just via typecheck/tests.
---

# run

Launches this repo's Next.js dev server and verifies it's actually serving before handing control back.

## Before starting

`npm run check:env` is a **no-op in dev** — it only enforces (`process.exit(1)` on missing vars) when `NODE_ENV=production`, so running it here proves nothing. Instead, confirm a local `.env` exists and spot-check the vars that fail silently at request-time in dev:

```bash
test -f .env && echo ".env present" || echo "MISSING .env — auth/db routes will 500 or 404 at request time"
```

Minimum vars this app needs even in dev (see `scripts/check-env.mjs` for the authoritative list and `CLAUDE.md`/memory `better-auth-prod-requirements` for why): `JWT_SECRET`, `DATABASE_URL`, `DIRECT_URL`, `BETTER_AUTH_SECRET`, one of `BETTER_AUTH_URL`/`NEXT_PUBLIC_APP_URL`. If any are missing, tell the user which ones instead of starting the server and letting `/api/auth/*` 404 confusingly later.

As of this writing, a fresh checkout of this repo has **no `.env`, only `.env.template`** — running `npm run dev` cold will start fine but every DB/auth-touching route will fail. If `.env` is missing, don't silently `cp .env.template .env` (it contains placeholder credentials that would connect nowhere) — tell the user it's missing and ask where real values come from (their own `.env`, a secrets manager, 1Password, etc.) rather than guessing.

## Steps

1. Start the dev server in the background (Turbopack-enabled via `next dev`):
   ```bash
   npm run dev
   ```
   `.claude/launch.json` configures port `3000` with `autoPort: true` — if 3000 is already in use, Next.js will pick the next free port and print it (`- Local: http://localhost:PORT`). Read the actual bound port from the process output; don't assume 3000.

   **Exception:** if you're about to run Playwright (`npm run test:e2e`), its `webServer` config (`playwright.config.ts`) hardcodes `baseURL: 'http://localhost:3000'` with `reuseExistingServer: true` — Playwright will happily reuse *any* server already on 3000, even one serving stale code, and will hang waiting for 3000 if `autoPort` bumped your manually-started server elsewhere. Kill any stray server first and let Playwright's own `webServer` start it, rather than pre-starting `npm run dev` yourself.

2. Poll `/api/health` instead of `/` — it's a real smoke test (`src/app/api/health/route.ts`), not just "the server accepted a TCP connection": it round-trips a query against `public."User"` and checks `JWT_SECRET`/`BETTER_AUTH_SECRET` presence, so it catches a wrong `DATABASE_URL` or missing table that a plain `curl /` would miss entirely.

   Use `-s` **without** `-f` — `/api/health` returns HTTP 503 (not 200) when degraded, and `-f` makes curl discard the body and fail silently on any non-2xx, so an `until ... -f ...` loop would spin forever on a degraded env instead of ever reaching the body you need to read:
   ```bash
   body=""
   until [ -n "$body" ]; do body=$(curl -s http://localhost:$PORT/api/health); [ -z "$body" ] && sleep 1; done
   echo "$body"
   ```
   If `"status":"ok"` isn't in `$body`, read the `checks` object before doing anything else — it names exactly which of `database`/`authConfig`/`groq`/`opencodeZen` failed, which is faster than guessing from a stack trace later.

3. Drive the *specific* flow being verified — not just the homepage:
   - Chat send/stream: load `/chat`, submit a message, confirm SSE chunks arrive (curl alone won't show this; use a browser tool).
   - Auth: hit `/api/auth/me` for session state; remember the UI calls the **legacy JWT routes** (`/api/auth/login`, `/api/auth/register`), not `authClient.signIn`/`signUp` — testing Better Auth's own endpoints won't reflect what the UI actually does.
   - Guest mode: capped at 15 messages, locked to Suzhou 3 — that cap is expected behavior, not a bug.
   - UI/visual changes: use gstack `/browse` or Playwright to actually see the rendered page — curl only proves the server responds, not that the change looks right.

4. Stop the background dev server process when done. Don't leave it running silently across turns.

## Common false positives

- `/api/auth/*` 404 or 500 → check `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL` first, not routing.
- Chat locked after ~15 messages with no login prompt shown → guest mode limit, working as intended.
- `npm run build` is **not** a verification step — it runs `prisma migrate deploy` against the real database first. Never run it just to "check things work"; use `npm run dev`.
