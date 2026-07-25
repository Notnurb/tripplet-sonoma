# Changelog

All notable changes to this project are documented here. Dates are in UTC.
This project does not yet publish versioned releases; entries are grouped by
date of change to `main`.

## 2026-07 — Hardening & cleanup

### Security
- **Closed a real Python sandbox escape (RCE-class).** Pyodide's `import js`
  binds to the worker's `globalThis`, and `worker_threads` workers run inside
  the real Node process — so `js.process` was a genuine, reachable Node
  `process`, and `js.process.mainModule.require('child_process')` reached
  arbitrary command execution + env-var exfiltration from user-submitted
  Python (`/api/execute` and the Sonoma `run_python` tool). Fixed:
  `src/lib/python/run.ts`'s worker now strips `process`/`require`/`global`
  from its own `globalThis` after Pyodide's setup completes and before user
  code runs. Verified with a real before/after exploit test.
- **Closed a real cross-tenant IDOR in `/api/chat` conversation persistence.**
  The conversation-upsert and message-insert ran as two independent
  autocommitted statements under `Promise.all` (no shared transaction) — a
  supplied `conversationId` belonging to another user could make the
  conversation-insert fail on a PK collision while the message-insert still
  committed, injecting an attacker message into a victim's conversation even
  though the request errored out. Fixed: the route now rejects ids owned by a
  different user with a clean 403 before any write, and both writes run in
  one real transaction via a new `withTransaction()` helper
  (`src/lib/db/neon.ts`). Verified with a real before/after exploit test.
- **`JWT_SECRET` now enforces a 32-char minimum** (was any non-empty string)
  — closes an offline weak-key-forgery path to full account takeover.
- Replaced the LLM-simulated Python "interpreter" with **real CPython**
  (Pyodide) in a memory-capped, timeout-killed worker thread — no more
  fabricated execution output.
- Moved the `/dev` panel secret fully server-side: HMAC-signed, expiring
  HttpOnly cookie issued by `/api/dev/unlock`; password never reaches the
  client bundle and is required (no fallback) in production.
- Stripped client-supplied `system` messages on the Sonoma route so external
  callers can't override persona/guardrails.
- Shared `sanitizeExternalContent` across the chat route **and** the Sonoma
  tool loop (web search / page fetch) for defense-in-depth against prompt
  injection.
- Added a **structural nonce boundary** on top of the keyword sanitizer:
  `wrapUntrusted()` (`src/lib/security/prompt-guardrails.ts`) wraps untrusted
  web content in a per-call random-nonce block the content cannot forge or
  escape. Applied to `/api/chat` search injection and Sonoma `fetch_url`;
  properties pinned by unit tests.
- Redacted leaked credentials from tracked docs and marked the incident report
  resolved. Rotate anything that ever appeared in git history.
- **Rewrote git history to purge the leaked-secrets audit doc** (independent
  cold review flagged that deleting it had left it recoverable):
  `git filter-repo` removed the file from every commit and scrubbed the leaked
  values from all other historical blobs (incl. an old `docs/planning/ISSUES.md`
  revision); rewritten history force-pushed. Verified: path in no commit,
  values in no blob. Pre-rewrite clones and un-housekept server objects still
  hold the old history, so the values remain burned — local `GROQ_API_KEY`/
  `JWT_SECRET` verified rotated; confirm `OPENCODE_ZEN_API_KEY` + deployed env.
- Added a NIST-style breached-password blocklist to the password policy.
- **Fixed a cross-tenant IDOR in `POST /api/cloud-env/command`**: the on-disk
  workspace was keyed by the client-chosen, guessable `slug` alone, so any
  signed-in user could read/overwrite/delete another user's synced workspace
  (and same-named projects collided). Now scoped under a SHA-256 hash of the
  authenticated userId (`workspaceDirFor`), with a `path.relative` traversal
  guard; pinned by `tests/unit/cloud-env-isolation.test.ts`.
- Made rate-limit proxy trust explicit: `RATE_LIMIT_TRUSTED_PROXY_HOPS`
  (default 1 = outermost-proxy IP) replaces relying on a code comment about
  which `x-forwarded-for` entry to trust (`src/lib/security/rate-limit.ts`).
- `npm audit fix` cleared 3 high dev-tree CVEs; a non-blocking full-tree audit
  step in CI now surfaces the remaining dev-only low/moderate ones (unfixable
  without a breaking Next downgrade, so accepted).
- **Closed a DNS-rebinding gap in the SSRF guard** (`src/lib/ai/websearch.ts`),
  found by an independent cold review: hostname checks were string-only, so a
  public-looking domain resolving to a private IP passed. `assertFetchableUrl`
  now resolves and validates every DNS answer (v4 private ranges, v6
  loopback/ULA/link-local, v4-mapped) on every redirect hop, failing closed on
  resolver errors. Residual connect-time TOCTOU documented in code. Pinned by
  `tests/unit/websearch-dns.test.ts`.

### Features / behavior
- **Web search works with zero API keys** via a keyless DuckDuckGo fallback.
- Sandbox Linux VM pre-boots in the background so the first `run_bash` is warm.
- Activity cards show real tool timing (`done · 1.2s`).
- **Added `/cli`**, a marketing landing page for the Astrocode CLI (hero with
  a copy-to-clipboard install command, scroll-parallax quote section). Linked
  from the shared `GlassNav` pill nav and the footer's Product column.
- **`curl -fsSL https://getsonoma.lol/installcli | bash` now actually works.**
  The Astrocode CLI source is vendored into `services/astrocode-cli/` (same
  pattern as the OpenSonoma installer) and bundled into
  `public/astrocode.tar.gz` on `prebuild`. `public/installcli.sh` finds a
  Node ≥18.17 on the machine, downloads the tarball, unpacks it to a
  persistent `~/.astrocode/cli`, and hands off to Astrocode's own installer to
  put `astrocode`/`astro` shims on PATH; `--uninstall` cleans up the source
  copy too. Served at the extensionless `/installcli` route. Verified with a
  real `curl | bash` run into an isolated `$HOME`.
- **Astrocode CLI sessions now survive a restart**, not just one process.
  `apiFetch` previously reported "run /login again" on any 401 — even one the
  local clock didn't predict (skew, or a token minted moments before restart)
  — even though a perfectly good 30-day refresh token was on disk. It now
  retries once with a forced refresh before giving up; only an actually-dead
  refresh token or an explicit `/logout` ends the session. Two new tests cover
  both outcomes (`services/astrocode-cli/test/api.test.js`).
- Nav bar: the brand wordmark + globe icon (`GlassNav`) and the signed-in
  username in `UserMenu` are now pinned to white so they stay legible
  regardless of the nav's light/dark `tone`.

### Architecture
- **Removed a legacy third-party inference/search provider across the whole
  repo.** On the Next.js side: no persona routes to it, its API-key env var and
  CSP/image-host allowances are gone, its search source was dropped, and the
  client module was renamed to the provider-neutral `chat-client.ts` (it routes
  per persona via `resolveBackend()`). In the `services/backend` Python service:
  search, mem0 memory, and multi-agent collaboration were moved onto a single
  env-driven, OpenAI-compatible `llm_client` (`LLM_API_KEY` / `LLM_BASE_URL` /
  `LLM_MODEL`), memory embeddings switched to a local sentence-transformers
  model, and the provider's batch SDK was dropped. Everything runs on Tripplet's
  own backends.
- Removed the fully-mounted-but-unused **Better Auth** system; auth is now a
  single first-party JWT path. Its empty Prisma tables remain and are harmless.
- Split the 900-line Sonoma route into `src/lib/sonoma/{prompt,tools,upstream,deepcode}.ts`.
- Split the 1008-line legacy chat route into `src/lib/chat/{tools,execution,memory,search}.ts`
  (tool schemas, run_code SSE execution, memory block/mirroring, web-search
  injection) — the route (577 lines) now holds request flow only; all four
  modules unit-tested and inside the coverage gate.
- Decomposed the 747-line `useChat` hook — the conversation domain (list, active
  id, history load/save, CRUD) moved to `src/hooks/useConversations.ts`; the hook
  now holds only the streaming concern and composes it. Public API unchanged.
- Decomposed the two oversized page files into colocated private `_`-folders,
  behavior unchanged: the 1576-line Multi-Agent page → `agents/_lib/agents-core.ts`
  + `agents/_components/AgentPanels.tsx` + `agents/_lib/commands.ts` (all 17
  slash-command behaviors as a context-driven module; page now 806 lines), and
  the 2014-line Cloud
  Environment page → `c/[slug]/_lib/cloud-core.tsx` + `c/[slug]/_components/CloudTabs.tsx`
  (184 lines), with the two largest tabs further split into sibling
  `FilesTab.tsx` / `ConsoleTab.tsx`. Largest source file dropped from 2014 → 642 lines.
- Centralized the untrusted-external-content safety instruction into a single
  shared constant (`src/lib/security/prompt-guardrails.ts`) used by both the
  Sonoma prompt builder and the `/api/chat` web-search injection block.
- Rate limiting now uses a shared Redis/KV store (Upstash or Vercel KV, REST)
  when configured — global, cold-start-proof — failing open to per-instance LRU.
- Grouped subprojects under `services/` (`backend`, `opensonoma-agent`, `tools`).

### Tooling / docs
- Added CI (`.github/workflows/ci.yml`): type-check, lint, unit tests,
  production-tree `npm audit`, a **doc-freshness gate**
  (`scripts/check-docs.mjs`) that fails when a living doc references a repo path
  that no longer exists, the prebuild env gate, a full **production
  `next build`** so build-only breakage can't land on `main` undetected, and a
  **coverage gate** (`vitest --coverage`) with ratcheted thresholds on the
  tested security/auth/validation/python/sonoma core.
- **Fixed a production-build blocker**: `src/app/globals.css` imported
  `shadcn/tailwind.css`, an uninstalled package that failed `next build` under
  webpack (dev/Turbopack tolerated it). Removed the dead import.
- Test-tooling hygiene: pinned `@vitest/coverage-v8` to the exact `vitest`
  version (removing a per-run version-drift warning) and dropped the redundant
  `esbuild` transform key from `vitest.config.ts` — `npm run test:*` is now
  warning-free. Bumped `eslint-config-next` 14.1.0 → 15.5.19 to match the
  installed Next major (lint stays clean; ESLint 9 flat-config migration is a
  separate, larger step deliberately not taken here).
- **Playwright e2e now runs in CI**: a second `e2e` job boots a `postgres:16`
  service container, applies real Prisma migrations via `npm run build`, runs
  the suite against the production server (`playwright.config.ts` switches to
  `next start` under `CI`), and enables the real register→login→session round
  trip with `AUTH_E2E=1` against the throwaway DB. The stale guest-access spec
  was fixed to pin the middleware contract both ways (guest workspaces load;
  account-only pages redirect).
- Recorded `docs/adr/0001-two-prompt-builders.md`: the legacy and Sonoma prompt
  builders stay separate by decision; shared safety wording must live in
  `prompt-guardrails.ts` only (both builders' headers link the ADR).
- Cache headers on the stable public GETs: `.well-known` OAuth discovery
  metadata (`public, max-age=3600, stale-while-revalidate=86400`) and
  `/api/v1/models` (`private, max-age=3600`).
- Grew the unit suite onto the previously-untested **auth and OAuth surfaces**:
  real-`NextRequest` handler tests for register/login/logout/me, password
  reset (enumeration resistance, token hashing), the OAuth 2.1 token endpoint,
  real PKCE S256 verification, and `resolveBackend()` persona routing.
- **Pre-warm pool for real Python**: `runPython` now keeps a pyodide-loaded
  worker on standby so a request skips the interpreter cold-load, while
  keeping the strict single-use isolation model (each worker runs one payload,
  then is terminated — verified by a no-state-leak test). Measured via
  `scripts/bench-python.ts`: ≈1.5s cold → 3-4ms warm (~440×) on a dev machine.
  The benchmark exposed a burst gap (pool of 1 made a burst's second request
  draw a still-loading refill) — fixed: pool defaults to 2 and `acquireWorker()`
  prefers a fully-loaded worker; re-measured burst worst-case 4ms.
- Removed dead `anuraTriggered`/`dismissAnura` client state that was threaded
  through context but never consumed.
- Grew the unit suite from a single test file to a full suite spanning 20+ files
  (route validation, SSRF, auth + OAuth route handlers, rate limiting, real
  Python, streaming, modes, models, persona/backend routing, and UI components).
- Removed 11 unused dependencies; added `SECURITY.md`, `CONTRIBUTING.md`,
  `LICENSE`, `tests/README.md`, and this changelog.
