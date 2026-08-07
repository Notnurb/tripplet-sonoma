# Security Audit — 2026-08-05 (daily mode, 8/10 confidence gate)

**Scope:** full tripplet-sonoma repo (Next.js 15 RSC/Turbopack, TS, Prisma/Neon, jose JWT, AI SDK, Pyodide, Composio, Telegram, MCP OAuth 2.1, x402).
**Mode:** read-only (no code changes). Report only.
**Gate:** findings included when confidence ≥ 0.8; sub-0.8 items marked "insufficient to call".

---

## Verdict

**SEV: HIGH** — one authenticated server-side code-execution surface is confirmed
in code (`/api/cloud-env/command`), plus a relay deployment that ships in
unauthenticated dev-trust mode by default. Overall confidence in verdict: **0.85**.

Notable strengths observed (checked, no findings):
- No secrets in git history (56 commits scanned; only `.env.template` / `.env.example` tracked; no `ghp_`/`sk-`/`AKIA`/xoxb patterns).
- No hardcoded keys in `src/` or `src/config.md`.
- All SQL parameterized (no `${}` interpolation found).
- SSRF guard (`assertFetchableUrl`) is thorough (protocol, private-IP ranges incl. decimal/hex encodings, IPv6, letterless-host, DNS-rebinding re-check on every redirect hop).
- OAuth authorize validates `redirect_uri` against registered URIs before redirecting.
- MCP scope re-checked at point of use; x402 fails closed on verification/settlement.
- Sonoma tool loop wraps untrusted tool output in nonce-guarantees + sanitize; client-supplied system messages dropped.
- Auth: bcrypt rounds 12, timing-safe dummy hash, HS256 7d httpOnly cookie, session revocation, lockout, rate limits.
- Looptrain admin-gated via `ADMIN_USER_IDS` (defaults to empty → 403).

---

## Findings

### [SEV:HIGH][ID-004] Authenticated arbitrary command execution via `/api/cloud-env/command`
- **Path:** `src/app/api/cloud-env/command/route.ts`
- **Evidence:** Any authenticated user (`auth()` → 401 only, no plan/admin gate, no rate limiter) can send a command. `resolveCommand` allowlists `node`, `npm`, `npx`, `python3`, `pip3`, `go`, `cargo`, `gcc`, `git`, `xargs`, `make`, `tee`, etc. (route.ts:459-467) and, critically, resolves `python`/`python3` to a freshly-created venv Python (route.ts:425-427) — guaranteed present since the route bootstraps it. `python3 -c '...'`/`node -e '...'` therefore yield full RCE with the host's `process.env` (minus the incomplete `SENSITIVE_ENV_KEYS` blocklist, route.ts:233-243 — misses `REDIS_PASSWORD`, `POSTGRES_PASSWORD`, `COMPOSIO_API_KEY`, `BACKEND_URL`, `TELEGRAM_*`, `X402_*`, `ADMIN_USER_IDS`, `OPENCODE_*`) and full filesystem read. `pip install` in the venv then run console scripts = arbitrary code. No egress block (`curl`/`wget` are blocked, but Python/Node can open sockets and exfiltrate). Workspace dir is per-user (`workspaceDirFor(userId, slug)`) but the spawned process runs with server env + can `../..` out of it.
- **Fix:** Gate behind admin or a paid plan; drop `node`/`npx`/`xargs`/`python3` from the system allowlist (only venv tools the user installed); blocklist by suffix (`KEY`, `SECRET`, `TOKEN`, `PASSWORD`) instead of exact names; sandbox the venv (network + fs isolation) or move execution to an isolated worker; add rate limiting.
- **Confidence:** 0.9.

### [SEV:HIGH][ID-006] CI dependency-audit gate is structurally blind to the Next.js runtime; `postcss` HIGH currently fails the gate
- **Path:** `.github/workflows/ci.yml:56`, `package.json` (devDependencies)
- **Evidence:** `next` (and transitively `undici@7.28.0`, `sharp@0.34.5`, `brace-expansion@1.1.15`) live in **devDependencies**. The only blocking gate is `npm audit --omit=dev --audit-level=high`, which excludes the whole dev tree — so HIGH advisories against the shipped framework (Next.js DoS via Server Actions, SSRF in Server Actions rewrites, unauthenticated disclosure of internal Server Function endpoints; undici desync/CRLF-injection advisories) never fail the build. Verified: the prod audit currently returns **exit 1** on `postcss@8.5.16` (<=8.5.22 affected, path traversal/sourceMappingURL disclosure) — CI is red on the very gate meant to catch this.
- **Fix:** Audit the full tree (`npm audit` without `--omit=dev`, or split: gate on a curated list); `npm audit fix` for postcss; plan the Next 16 major bump for the framework advisories (no 15.x patched release exists yet).
- **Confidence:** 0.9.

### [SEV:MED][ID-005] Relay deployment ships in dev-trust auth mode (`render.yaml` omits `TRIPPLET_JWT_SECRET`)
- **Path:** `render.yaml` (only `PORT` + `RELAY_PUBLIC_URL`), `services/opensonoma-agent/relay/server.js:1041-1050`
- **Evidence:** With no `TRIPPLET_JWT_SECRET` (and no Supabase env), the relay logs "clients are DEV-TRUSTED (JWTs are NOT verified)" and `authenticateClient` trusts a caller-supplied `account_id` (server.js:467-474, memory-db authenticate). `render.yaml` — the shipped deploy config, target `wss://relay.getsonoma.lol/ws` — sets neither, so a remote attacker who connects to the relay and registers as any `account_id` can list, unpair (DoS), and re-bind (steal) that account's devices. Shell exec remains gated by the device's per-use password, but pairing ownership is not. The relay itself documents that Supabase-配置 + missing JWT exits rather than degrade (good), but nothing enforces the secret for the default free-tier deploy.
- **Fix:** Set `TRIPPLET_JWT_SECRET` (= app `JWT_SECRET`) in `render.yaml`; add a boot check that refuses dev-trust mode when `NODE_ENV=production`.
- **Confidence:** 0.7 (deploy may set the secret via dashboard — config-as-shipped is the risk). Insufficient to call HIGH.

### [SEV:MED][ID-007] CSP relies on `'unsafe-eval' 'unsafe-inline'` in `script-src`
- **Path:** `src/middleware.ts:7`
- **Evidence:** `script-src 'self' 'unsafe-eval' 'unsafe-inline' https://*.groq.com ...` — inline scripts and `eval` are allowed on every route, so CSP provides no backstop if a stored XSS is found. Systemic hardening gap only (no exploit found).
- **Fix:** Tighten per-route (`nonce`-based for pages), remove `unsafe-eval` where the runtime allows, and keep the existing `base-uri 'self'` / `object-src 'none'` / `form-action 'self'`.
- **Confidence:** 0.9.

### [SEV:LOW][ID-008] HSTS header missing on `/api/*` responses
- **Path:** `src/middleware.ts:25-33` (API branch) vs `:108-115` (page branch)
- **Evidence:** The `/api` branch sets nosniff/frame/XSS/referrer/CSP but not `Strict-Transport-Security`; the non-API branch does. API responses therefore don't advertise HSTS directly (page loads still cover the host).
- **Fix:** Add the same HSTS header to the API branch.
- **Confidence:** 0.95.

### [SEV:LOW][ID-009] DOM-XSS candidate: `status.innerHTML` interpolates an error message
- **Path:** `src/app/c/[slug]/_lib/cloud-core.tsx:390`
- **Evidence:** `status.innerHTML = '<span ...>Access denied: ' + e.message + '</span>'` — `e.message` is fetch/server error text that can echo server-side strings (e.g. `cloud-env` error messages which reflect `error.message`). If an attacker can influence that string, HTML injection into the page is possible. Client-side, low impact.
- **Fix:** Use `textContent` (or build DOM nodes) instead of `innerHTML`.
- **Confidence:** 0.8.

### [SEV:LOW][ID-010] Relay `/health` discloses operational state without auth
- **Path:** `services/opensonoma-agent/relay/server.js:1052-1067`
- **Evidence:** Unauthenticated `/health` returns `mode` (supabase|memory), `secure`, live `devices`/`clients` counts, and `public_url`. Low-sensitivity info disclosure.
- **Fix:** Gate the counters behind the relay secret, or drop device/client counts.
- **Confidence:** 0.9.

### [SEV:LOW][ID-011] SSRF guard residual DNS-rebinding TOCTOU (documented in code)
- **Path:** `src/lib/ai/websearch.ts:242-262`
- **Evidence:** `assertFetchableUrl` resolves+re-checks every address, but `fetch()` re-resolves separately — a DNS answer that flips between check and connect can still reach a private host. Acknowledged in-code; requires attacker-controlled DNS timing.
- **Fix:** Pin the resolved IP at the socket layer (custom agent/undici connector) or fetch via a dedicated egress proxy.
- **Confidence:** 0.8.

---

## Investigated — not found / accepted

- `whiteListedUrls` bypass (`/api/ai/route.ts`): **no such route or allowlist exists** in `src/`. Earlier note was a planning artifact; no finding.
- Mermaid `dangerouslySetInnerHTML` (MermaidDiagram.tsx:150): rendered SVG is produced under `securityLevel: 'strict'` (mermaid's built-in sanitization); the flagged `dompurify` LOW requires `CUSTOM_ELEMENT_HANDLING` which mermaid does not enable → accepted.
- `/api/connect/exec` ownership: relay enforces device→account binding at `forwardToDevice` (server.js:850-858); exec additionally requires the per-use device password (never persisted). OK when relay auth is configured (see ID-005).
- Pyodide sandbox, x402 pipeline, MCP OAuth, developer keys, telegram webhook, image-proxy, triplepedia/extract, memory, usage metering, docker-compose (password-required), looptrain (admin-gated): all appropriately scoped/auth/rate-limited for their threat model.
- `next`/`undici`/`sharp`/`brace-expansion` HIGH advisories are real but tracked via ID-006 (process blind spot), not new vulns in this repo.

## OWASP Top 10 (relevant)

- A03 Injection: no SQLi found; shell injection in cloud-env is by-design command execution (ID-004).
- A04 Insecure Design: accountless-exec design (ID-004), dev-trust default (ID-005).
- A06 Vulnerable Components: ID-006 (postcss HIGH live, next/undici/sharp unfixed in dev tree).
- A07 Auth failures: none found (auth reviewed); relay dev-trust is a config gap (ID-005).
- A10 SSRF: well-defended; residual TOCTOU (ID-011).

## STRIDE highlights
- Spoofing: ID-005 (relay account spoofing).
- Tampering/Repudiation: no gaps found (timingSafeEqual secret compares, per-request usage rows).
- Info disclosure: ID-009, ID-010.
- DoS: rate limits broadly present; cloud-env lacks them (part of ID-004).

## Data classification
- PII: `email`, `name`, `telegram_id` — encrypted at rest? No; stored plaintext in Postgres (standard), protected in transit by TLS + HSTS (page paths) + httpOnly cookies.
- Secrets: `JWT_SECRET` (min-32 zod-gated), provider API keys (server-only env), `trpl_sk_`/`trpl_x4_` keys (SHA-256 at rest, prefix display).
- Payment: x402 EIP-3009 headers (stateless, replay-safe via nonce), receipts = credential.

---

## Supplement — second pass, same day (independent re-verification + new coverage)

Re-ran the audit against the live tree. Confirmed ID-004, ID-005, ID-006, ID-007, ID-008
unchanged. The following were **not** in the first pass and are new.

### [SEV:HIGH][ID-012] `run_on_machine` system prompt pressures the model into executing commands on the user's machine
- **Path:** `src/lib/sonoma/prompt.ts:124-132`
- **Evidence:** When a paired machine is @mentioned, the system prompt tells the model it "DO have real, working shell/terminal access to the user's own computer right now", forbids it from ever saying it lacks access or can't run commands, and says the tool is "automatically available for the whole conversation". All injection sources are wrapped (`wrapUntrusted` — web results, composio, past-chat recalls; memory is marked non-instructional), but the prompt strongly biases the model to *act* on untrusted content rather than refuse, and the only runtime gate is a browser Yes / Always-Accept / No prompt (`src/lib/sonoma/tools.ts:81-83`) that users fatigue past. A successful prompt injection via web content therefore escalates to arbitrary command execution on a user's paired computer.
- **Fix:** Use neutral capability language ("a permission-gated tool the user may approve"), remove the instruction to conceal gating, add refusal bias for exfiltrate/install/modify-system command classes, and consider requiring per-class re-confirmation even under Always Accept.
- **Confidence:** 0.8 (design confirmed; full chain requires defeating the existing guardrails).

### [SEV:MED][ID-013] Telegram webhook auth is conditional — bots lacking a stored secret accept spoofed updates
- **Path:** `src/app/api/telegram/webhook/[slug]/route.ts:160-165`
- **Evidence:** The `x-telegram-bot-api-secret-token` check runs only `if (bot.webhookSecret)`. New bots always get a secret (connect route generates `randomBytes(24)`), but any bot row with NULL/empty secret (created before secret support) is reachable by anyone who knows/guesses the 12-char token-suffix slug (~48 bits, often shared in support/forwards). No rate limiting on the webhook either. Impact: spoofed updates burn the bot owner's model credits and let an attacker send arbitrary messages from the victim's bot.
- **Fix:** Migration to backfill secrets for existing rows; treat a missing secret as 401 unconditionally; rate-limit the webhook.
- **Confidence:** 0.85.

### [SEV:MED][ID-014] Pairing-code brute-force — no rate limit on relay or app pair/verify routes
- **Path:** `services/opensonoma-agent/relay/server.js:733-759` (`onClientPair`), `src/app/api/connect/{pair,verify}/route.ts`
- **Evidence:** Codes are 6 chars over a 31-char unambiguous alphabet ≈ 2^29.7. `onClientPair` calls `getMachineByPairingCode` with no attempt throttling, and neither the app's pair nor verify route rate-limits (pair is offline format-check only). A valid account holder can enumerate codes over parallel WS connections. Impact: hijack a pairing — unpair the legitimate owner and bind the device to the attacker's account. Exec still requires the device's local scrypt password, so this is pairing-ownership + availability, not direct RCE.
- **Fix:** Per-IP/per-account attempt limiter on both the app routes and the relay; shorten code TTL; backoff on repeated failures.
- **Confidence:** 0.8.

### [SEV:LOW][ID-015] OAuth Dynamic Client Registration accepts `http://` redirect URIs
- **Path:** `src/app/api/oauth/register/route.ts:63-72`
- **Evidence:** `http:` passes the scheme check alongside `https:` and custom schemes. On a production deploy this lets a registered client's auth code transit plaintext (LAN/wifi attacker) and lowers the bar for phishing clients. PKCE + consent still bind the code, so impact is limited.
- **Fix:** In production, accept only `https:` plus registered custom schemes.
- **Confidence:** 0.8.

### [SEV:LOW][ID-016] Stateless refresh-token rotation leaves old refresh tokens valid for 30 days
- **Path:** `src/lib/mcp/oauth.ts` (`rotateRefreshToken`)
- **Evidence:** Rotation mints a new pair without revoking the presented token (RFC 9700 §5.2.2.4 reuse-detection deviation). A stolen refresh token stays spendable until expiry. Documented statelessness tradeoff; only affects the MCP scope (chat/web_search/memory_search).
- **Fix:** Explicit jti revocation set on rotation (DB/Redis), or accept as documented risk.
- **Confidence:** 0.8 (accepted-risk → informational if intentional).

### Cleared on second pass (verified, no finding)
- `image-proxy`: hostname whitelist + HTTPS-only + `redirect:'error'` + private-IP patterns — no SSRF.
- `triplepedia/extract` + `assertFetchableUrl`: per-hop SSRF guard incl. manual redirects + bounded streaming reads.
- Pyodide `/api/execute`: `process/require/global` deleted pre-run, single-use workers, 512MB mem cap, concurrency cap, 30s kill. Residual note: `fetch` remains a worker global → user code can open network egress (matters only if the host exposes a metadata service; Vercel functions do not).
- `/p/[id]` stored-HTML pages: iframe `sandbox` without `allow-same-origin` → opaque origin, no session-cookie/API access (phishing surface only).
- Mermaid `dangerouslySetInnerHTML`: rendered under `securityLevel:'strict'` (DOMPurify).
- `x402` prepaid keys: atomic `UPDATE ... - $2`, overdraw bounded by max_tokens; per-call replay safe via chain nonce.
- Relay `forwardToDevice` (server.js:850-858): account-binding enforced — cross-user exec blocked; exec additionally needs the per-use device password.
- Git history: 56 commits, no `sk-`/`gsk_`/`AKIA`/`ghp_`/xoxb patterns; only `.env.template`/`.env.example` tracked.
- CI: pinned actions, dummy-only secrets, blocking prod-tree audit (currently red on postcss — see ID-006).
