---
name: finding_rate_limits_nominal
description: Rate limit LIMITS constants were set at 10,000–20,000/hr — functionally non-existent; reduced to meaningful values 2026-03-16
type: project
---

`/src/lib/security/rate-limit.ts` exported LIMITS with values like `chat: 10_000`, `title: 20_000`. A normal human user sends perhaps 50–100 chat messages per hour in heavy use. At 10,000/hr, the rate limiter provided essentially no protection against scripted abuse or credential stuffing.

**Fix applied 2026-03-16:** Values reduced to:
- chat: 100/hr
- image: 50/hr
- video: 20/hr
- title: 200/hr
- search: 200/hr
- devKey: 20/hr
- profile: 30/hr

These are still generous for real users and provide meaningful friction against automated abuse. Monitor 429 rates after deployment to tune if legitimate users are hitting limits.
