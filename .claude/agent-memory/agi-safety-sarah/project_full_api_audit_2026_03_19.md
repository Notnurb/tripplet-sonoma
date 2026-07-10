---
name: Full API Security Audit — 2026-03-19
description: Complete audit of all 32 API routes, rate-limit module, iframe preview page, and auth libraries. Identifies 4 Critical, 6 High, 5 Medium, 4 Low findings.
type: project
---

Comprehensive security audit conducted 2026-03-19 covering all route.ts files, rate-limit.ts, preview/page.tsx, and src/lib/auth/*.

**Why:** El Taco all-hands team audit requested before broader deployment.

**How to apply:** Reference this audit for future PRs touching any of the flagged files. Mark findings resolved as fixes land.

## Critical Findings

1. **UNAUTHENTICATED /api/db-ops** — `src/app/api/db-ops/route.ts`: No auth check at all. Any anonymous caller can run INSERT operations against any table, and SELECT queries against any table. Service-role key may be in use.

2. **UNAUTHENTICATED /api/deploy** — `src/app/api/deploy/route.ts`: No auth check. Any caller can store arbitrary HTML (including malicious scripts) into the `deployed_projects` table.

3. **UNAUTHENTICATED /api/memory (GET + POST)** — `src/app/api/memory/route.ts`: No auth check. User IDs are caller-supplied query params (e.g. `?user_id=xxx`). Any unauthenticated caller can read or write memories for any user ID.

4. **iframe sandbox includes allow-same-origin** — `src/app/c/[slug]/preview/page.tsx:199`: `sandbox="allow-scripts allow-forms allow-popups allow-modals allow-same-origin"` combined with `allow-scripts` is equivalent to no sandbox at all. The user-generated HTML inside the iframe can access localStorage (which is exactly where the app stores CloudEnvironment data) and make same-origin API calls.

## High Findings

5. **UNAUTHENTICATED /api/execute** — `src/app/api/execute/route.ts`: No auth check. Arbitrary Python code is passed to the the model as a "simulate execution" prompt. While not real code execution, unauthenticated callers can abuse this to burn API quota at no cost. Also a potential prompt-injection surface.

6. **UNAUTHENTICATED /api/plan and /api/plan-video** — `src/app/api/plan/route.ts`, `src/app/api/plan-video/route.ts`: No auth check, no rate limiting. Unauthenticated callers can exhaust LLM API quota freely.

7. **UNAUTHENTICATED /api/code/publish (GET+POST)** — `src/app/api/code/publish/route.ts`: No auth check. Anyone can publish arbitrary HTML apps. GET with no slug lists all published sites. This enables stored XSS/phishing content to be hosted on the platform.

8. **Dual shadow auth system** — `src/app/api/auth/` routes (login, register, logout, me, forgot-password, reset-password): A full custom JWT+bcrypt auth system exists alongside Clerk. The two systems share the same Prisma `User` table but operate independently. The custom system has no rate limiting on login/register (brute-force risk), no account lockout, no email verification on register, and the forgot-password flow logs the reset URL to stdout in production (`console.log("RESET LINK:", resetUrl)`).

9. **reset-password token confusion** — `src/app/api/auth/reset-password/route.ts:20-21`: The comment says the token stored is `resetTokenHash` (SHA-256 of the original), but the lookup `findUnique({ where: { token } })` passes the raw token from the URL — which is the hash. This works accidentally but is fragile and the comment is misleading. More critically: there is no constant-time comparison; timing side-channels are possible via Prisma.

10. **health endpoint leaks env configuration** — `src/app/api/health/route.ts`: Unauthenticated GET returns which services are configured (`inference: ok/missing`, `supabase: ok/missing`, `clerk: ok/missing`). Useful reconnaissance for attackers.

## Medium Findings

11. **triplepedia/extract: SSRF via generic URL fetch** — `src/app/api/triplepedia/extract/route.ts:265-274`: The `extractGeneric()` function fetches arbitrary user-supplied URLs server-side with no hostname allowlist. An attacker can use this to probe internal services (cloud metadata at 169.254.169.254, internal microservices, etc.).

12. **systemPromptOverride accepted from ALL authenticated users** — `src/app/api/chat/route.ts:264`: The guard only blocks guests; any authenticated user can replace the entire system prompt. This is a very broad privilege — a compromised user account can completely override safety behaviors.

13. **agents route forwards full request body to backend without sanitization** — `src/app/api/agents/route.ts:22`: The `{ query, num_agents, conversation_history }` payload is forwarded to the Python backend with no size limits, no input sanitization, and no timeout. A large `conversation_history` could exhaust backend resources.

14. **LRU rate limiter is per-process, resets on restart** — `src/lib/security/rate-limit.ts`: The in-memory LRU cache is not shared across serverless function instances or after cold starts. In a Vercel deployment, each function instance has its own counter, making the limits effectively much higher than specified.

15. **image-proxy: DNS rebinding / redirect bypass possible** — `src/app/api/image-proxy/route.ts`: The allowlist check is on the parsed hostname at request time, but `fetch()` follows HTTP redirects by default. A whitelisted host that issues a redirect to an internal IP would bypass both the hostname allowlist and the private-IP check.

## Low Findings

16. **Missing Content-Security-Policy headers** — No middleware.ts was found in the project. There are no CSP, X-Frame-Options, or other security response headers being set globally.

17. **vision route: no file size or MIME type validation** — `src/app/api/vision/route.ts`: Accepts any file as `image` from formData. No size cap, no MIME type check. A 100MB upload would be read entirely into memory before the Tripplet API call.

18. **looptrain: single-instance guard is unreliable** — `src/app/api/looptrain/start/route.ts:49-55`: The `globalThis` singleton pattern for tracking the child process does not survive serverless restarts or multiple instances. Multiple concurrent looptrain processes could be spawned.

19. **Forgot-password logs reset URL to server stdout** — `src/app/api/auth/forgot-password/route.ts:44-47`: Production servers typically aggregate logs to external systems (Datadog, Logtail, etc.). Reset tokens logged here are visible to anyone with log access.

## Components Cleared (no significant issues)

- `/api/imagine` — auth, rate-limit, input validation all present and correct.
- `/api/imagine-video` — same.
- `/api/imagine-video/status` — requestId format validated against strict regex.
- `/api/chat` — robust: rate-limit, guest enforcement, IDOR check, prompt injection defense layers.
- `/api/chat/title` — rate-limited, input capped.
- `/api/chat/history` — properly scoped to userId.
- `/api/developer/keys` — auth, rate-limit, key hashing all correct.
- `/api/search` — auth, rate-limit, source allowlist, query length cap all present.
- `/api/triplepedia/upload` — auth, MIME allowlist, size cap present.
- `/api/user/profile` — auth, rate-limit, field validation present.
- `/api/looptrain/*` — admin gate is present (though reliability concern noted above).
- `src/lib/security/rate-limit.ts` — logic is sound; rightmost-IP approach is correct; main concern is in-memory only.
- `src/lib/auth/jwt.ts` — HS256 with jose, expiry enforced, algorithm pinned.
- `src/lib/auth/password.ts` — bcrypt with 12 rounds, minimum length enforced.
