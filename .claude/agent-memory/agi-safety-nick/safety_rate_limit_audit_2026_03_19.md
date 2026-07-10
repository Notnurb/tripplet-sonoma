---
name: Rate Limit & Access Control Audit 2026-03-19
description: Full audit of rate limiting, abuse prevention, and access control — findings, severities, and mitigations for all API routes
type: project
---

Full audit of src/lib/security/rate-limit.ts, src/proxy.ts, and all API routes. Date: 2026-03-19.

## Key Findings

### Critical
- /api/chat guest message limit is enforced by counting user-role messages in the client-supplied messages array. An attacker can simply omit prior messages and bypass the 15-message cap entirely.
- SubscriptionContext.tsx hardcodes plan='max' and credits=999999 client-side. This is dead code that provides no real enforcement — the concern is whether any server-side route gates on a subscription check. Currently none does.

### High
- LRU cache rate limiters are in-process memory. On Vercel serverless, each Lambda cold start gets a fresh empty cache. Rate limits reset on every new function instance. Not effective against sustained abuse from a single IP/user if Vercel spins up fresh lambdas.
- /api/search is public (no auth) — listed in proxy.ts isPublicRoute and the route itself does not require userId. 200 searches/hr rate limit applies by IP only, which resets on cold starts.
- /api/chat is public (no auth) — listed in proxy.ts isPublicRoute. Guests can call it. Model is locked to suzhou-3 and message count is enforced, but the enforcement is bypassable (see Critical).
- /api/image-proxy is listed as public in proxy.ts but the route handler requires auth. This inconsistency is a logic smell — middleware lets it through unauthenticated, route then rejects. Should be removed from public list.
- /api/vision has no rate limiter at all — authenticated users can call it without limit.
- /api/code has no rate limiter at all — can make multiple sequential calls to the inference backend per single user request (one planning call + N code generation calls per file).
- /api/execute has no rate limiter at all.
- /api/agents has no rate limiter at all.

### Medium
- Guest multi-session abuse: guests are tracked by IP only. Fresh incognito window or VPN gives a fresh IP and a fresh 15-message budget. No cookie or fingerprinting ties sessions together cross-IP.
- /api/code allows user-supplied cloudConfig.apiKey to be passed through to OpenAI/Anthropic. If a user provides their own key, the server makes calls with it. This is by design but means the server acts as an unconstrained proxy for external API keys — no validation that the key format is correct, and error messages from those providers may leak information.
- looptrain/start admin check: ADMIN_USER_IDS defaults to empty string. If ADMIN_USER_IDS env var is not set, the check `ADMIN_USER_IDS.length > 0` is false and ALL authenticated users can start the looptrain process (spawning a Python child process on the server). This is a privilege escalation risk.

### Low
- Retry-After header on 429 says 60 seconds but the rate limit window is 1 hour. Misleading to clients.
- /api/chat/title is listed as public. If abused, it burns title-generation API calls without authentication.

## Mitigations Recommended

1. Fix guest message cap: server must not trust the client-supplied messages array for counting. Store a signed server-side count (e.g., in a short-lived JWT or DB record keyed by IP+session fingerprint).
2. Move rate limiters to Redis or Vercel KV to survive cold starts.
3. Add rate limiters to /api/vision, /api/code, /api/execute, /api/agents.
4. Remove /api/image-proxy from public route list in proxy.ts (or keep it but add a signed URL check).
5. Fix looptrain ADMIN_USER_IDS: if the env var is unset, the route should default to DENY all, not allow all.
6. Fix Retry-After header to match actual window (3600).
