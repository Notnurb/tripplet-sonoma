---
name: Rate limit audit — 2026-03-16
description: Findings and mitigations from the rate-limit / unauth-API-surface review of March 2026
type: project
---

**Why:** Baseline safety audit of rate limiting and API authentication coverage.
**How to apply:** Reference when reviewing any new API route or when rate-limit changes are proposed.

## Findings

### CRITICAL — Unauthenticated, unrate-limited routes
- `/api/agents` (POST + GET): zero auth, zero rate limiting, proxies arbitrary queries to backend.
- `/api/looptrain/start` (POST): zero auth, zero rate limiting, spawns a Python child process (python3 scripts/looptrain.py) with attacker-controlled rps/concurrency/count values.
- `/api/vision` (POST): zero auth, zero rate limiting, calls the inference API with attacker-supplied image data.
- `/api/code` (POST): zero auth, zero rate limiting, calls the inference backend/OpenAI/Anthropic APIs with attacker-supplied API keys accepted in request body.

### HIGH — IP spoofing via X-Forwarded-For
- Original code took forwarded.split(',')[0] — the leftmost/client-controlled value.
- FIXED 2026-03-16: now takes x-real-ip first, then rightmost XFF entry.

### HIGH — Guest 15-message limit is client-only
- No server-side enforcement. Any unauthenticated caller can POST unlimited messages to /api/chat.
- Only defense is the (very high) IP-keyed rate limit: 10,000 chat calls/hour.

### HIGH — In-memory LRU cache is per-process
- Rate limits reset on every cold start, restart, or new serverless instance.
- Under multi-instance or Vercel serverless deployment, each instance has its own counter.
- Effective limit is (LIMIT * number_of_instances) per window.

### MEDIUM — Limits are extremely permissive
- chat: 10,000/hr, image: 5,000/hr, video: 2,000/hr. These are cost controls only in name.
- No per-minute burst protection. An attacker can send all 10,000 requests in the first second.

### MEDIUM — /api/code accepts third-party API keys in request body
- cloudConfig.apiKey is passed in the request body and used directly to call OpenAI/Anthropic.
- A compromised or malicious session can exfiltrate keys by injecting crafted prompts that echo them back.

### LOW — Retry-After header is hardcoded to "60" regardless of actual window (1 hour)
- Minor but misleading to legitimate clients implementing backoff.

## Mitigations implemented
- getRateLimitToken: switched to x-real-ip-first, rightmost-XFF strategy.

## Mitigations recommended but NOT yet implemented
- Add `auth()` guard + rate limiting to /api/agents, /api/vision, /api/code, /api/looptrain/start.
- Server-side guest message counter (Supabase or Redis, keyed by IP + session cookie).
- Replace LRU cache with Redis/Upstash for distributed rate limiting.
- Add per-minute burst limit (sliding window) on top of hourly quota.
- Never accept third-party API keys in request body; store in user settings server-side.
- Fix Retry-After to reflect actual window remaining.
