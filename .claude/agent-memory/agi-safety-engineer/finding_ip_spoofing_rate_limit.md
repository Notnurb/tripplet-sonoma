---
name: finding_ip_spoofing_rate_limit
description: getRateLimitToken originally used x-forwarded-for[0] (attacker-controlled); already patched in repo to prefer x-real-ip and use rightmost XFF entry
type: project
---

The original `getRateLimitToken` function in rate-limit.ts used `forwarded.split(',')[0]` — the leftmost entry of x-forwarded-for, which is set by the client and trivially spoofable. An attacker could rotate their apparent IP on every request to bypass IP-based rate limits.

When audited on 2026-03-16 the function in the live file was already updated (likely in a prior session) to:
1. Prefer `x-real-ip` (set by the outermost trusted proxy, not the client)
2. Fall back to the rightmost entry of x-forwarded-for (added by the outermost proxy)
3. Fall back to 'ip:unknown' rather than skipping the limiter

This is the correct behavior for a Vercel/nginx deployment. No further change needed, but if the reverse proxy configuration ever changes, this logic must be re-verified.
