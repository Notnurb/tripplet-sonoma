# Auth

> ⚠️ **NOT Clerk, NOT Better Auth.** One live auth system: first-party JWT.

## The JWT system

- `AuthPage.tsx` POSTs to `/api/auth/register` and `/api/auth/login`.
- Those routes hash passwords with bcrypt (cost 12) and write to the `public.User` table via `prisma.user.*` (`src/lib/auth/user-store.ts`).
- On success, a signed `auth_token` cookie is set — HS256 via `jose`, implemented in `src/lib/auth/jwt.ts`.
- Session reads go through `GET /api/auth/me`; logout via `POST /api/auth/logout`.
- Server-side helper: `auth()` in `src/lib/auth/session.ts`, used by ~35 API routes. It **degrades to guest on any failure** rather than throwing — routes that need a hard-required user must check `userId` explicitly (see `src/app/api/looptrain/start/route.ts` for an example that also checks an admin allowlist).
- `middleware.ts` verifies the cookie Edge-side for page redirects (keeps unauthenticated users off `(app)` route-group pages without a round trip to a Node runtime).
- `src/lib/auth/password.ts` — password policy, including a NIST-style breached-password blocklist.
- `src/lib/auth/auth-error-context.ts` / `src/lib/auth/log.ts` — structured auth error context and logging, kept separate so failures are diagnosable without leaking details to the client.

## Guest mode

Cookie-tracked, capped at 15 messages, locked to Suzhou 4 (persona id `suzhou-3`). No account required — this is the default first-touch experience.

## Better Auth — removed, not forgotten

Better Auth was **fully mounted but never called by the UI**, and was removed in July 2026 as deliberate de-risking (one less live auth path to secure). Do not reintroduce it casually.

Its Prisma tables still exist in `prisma/schema.prisma` and the DB, and are annotated in the schema as legacy:
- `Account` — hashed passwords / OAuth tokens, Better-Auth field names preserved exactly
- `AuthSession` — kept distinct from the app's own `Session` model to avoid collisions
- `Verification` — email verification / password reset tokens

Nothing reads them today. `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` env vars are no longer required.

## `neon_auth` schema — legacy, not live

A leftover from an earlier Supabase → Neon migration. The app does **not** point at it. Don't assume it's live, don't build against it.

## OAuth2 / MCP (separate from user auth)

`/api/oauth/{authorize,register,token}` + `/api/mcp` implement a standalone OAuth2 + MCP server (`src/lib/mcp/*`) for the developer API surface — this is a different concern from user login. The `/.well-known`, `/oauth`, `/mcp` paths are intentionally pre-auth in `middleware.ts`. See [API Routes](./API-Routes.md).
