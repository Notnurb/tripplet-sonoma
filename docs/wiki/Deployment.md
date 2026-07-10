# Deployment

## Platform

Vercel serverless. Files read from disk at runtime (`sprompts/*.md` persona identities, `assets/faces/` avatar images, Pyodide assets) are traced per-route in `next.config.mjs` so Vercel's build tracer includes them in the deployed function bundle.

## Build pipeline

```bash
npm run prebuild   # scripts/check-env.mjs (fails loudly if required env vars are missing)
                    # + scripts/bundle-opensonoma.mjs (packs services/opensonoma-agent into public/opensonoma.tar.gz)
npm run build       # prisma migrate deploy (using DIRECT_URL) && next build
```

`prebuild` and `build` are both npm lifecycle scripts — Vercel's default `npm run build` picks up `prebuild` automatically.

## Required environment variables (production)

From `.env.template`:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Pooled Neon connection (runtime) |
| `DIRECT_URL` | Unpooled Neon connection (migrations) |
| `JWT_SECRET` | Signs the `auth_token` cookie (HS256) — generate with `openssl rand -base64 48` |
| `NEXT_PUBLIC_APP_URL` | Canonical app URL; OAuth/MCP issuer and absolute links |
| `OPENCODE_ZEN_API_KEY` | Inference backend for **all four workspace personas**, DeepCode, and the legacy tier (via `resolveBackend()`) — load-bearing for every shipped chat persona |
| `GROQ_API_KEY` | Fallback backend: fixed-model utility routes (title/sandbox/execute) and any persona id not mapped to OpenCode Zen |

At least one of `GROQ_API_KEY` / `OPENCODE_ZEN_API_KEY` must be set or chat returns 503. `scripts/check-env.mjs` enforces the required group and fails the build loudly if anything's missing — add new required vars there, not just in `.env.template`.

## Optional environment variables

| Variable | Purpose |
|---|---|
| `DEV_PANEL_PASSWORD` | Unlocks the `/dev` outage panel; without it the panel stays sealed in production |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Shared rate-limit counters across serverless instances |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Vercel KV equivalent of the above |
| `BACKEND_URL` / `BACKEND_API_KEY` | External memory/search backend — see [External Backend](./External-Backend.md) |
| `PUBLIC_APP_URL` | Public HTTPS origin for the Telegram webhook route |

## CI (`.github/workflows/ci.yml`)

Runs on every push: type-check (`tsc --noEmit`), lint (ESLint), doc freshness (`npm run check:docs` — referenced repo paths must resolve), the Vitest unit suite (`tests/unit/`), the prebuild env gate (`scripts/check-env.mjs` against a dummy prod env), a full production `next build` (compiles with dummy-but-valid env — catches build-only breakage `tsc` can't see, e.g. an unresolvable CSS `@import`), and `npm audit --omit=dev --audit-level=high` against the production dependency tree. `CONTRIBUTING.md` lists the fast local subset (type-check, lint, `check:docs`, unit tests) to run before opening a PR.

## The outage kill switch

`src/lib/outage.ts` — when `OUTAGE_ACTIVE` is true, every chat composer is disabled site-wide and an outage notice is shown. It also gates the `/dev` panel and its cookie-authenticated backend override. If a fresh clone won't accept chat input, check this first before assuming something's broken.

## Regenerating README screenshots

```bash
npx playwright install chromium   # first time only
npm run dev &
node scripts/screenshot-readme.mjs
```

Drives headless Chromium around `/`, `/sign-in`, `/chat`, `/features` and writes to `assets/screenshots/` — the README screenshots are generated, not hand-picked, so they can't go stale for long. The `/chat` capture runs as a guest (no login) — the script creates a fresh guest session before taking the shot.
