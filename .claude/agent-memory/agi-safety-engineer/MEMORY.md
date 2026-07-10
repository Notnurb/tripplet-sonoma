# Safety Engineer Memory Index — Tripplet / x1-chat

## Project

- [project_architecture.md](./project_architecture.md) — Core architecture summary: Next.js 16, Clerk auth, Tripplet models, Supabase, external BACKEND_URL for memory/search

## Findings & Patterns

- [finding_prompt_injection_vectors.md](./finding_prompt_injection_vectors.md) — Prompt injection surface: memory and web-search injection into system prompt; mitigations applied 2026-03-16
- [finding_looptrain_unauth.md](./finding_looptrain_unauth.md) — Looptrain routes spawned child processes with zero auth (CRITICAL); fixed with Clerk auth + ADMIN_USER_IDS gate 2026-03-16
- [finding_system_prompt_override.md](./finding_system_prompt_override.md) — systemPromptOverride accepted from unauthenticated callers (CRITICAL); fixed to drop override for guests 2026-03-16
- [finding_guest_mode_bypass.md](./finding_guest_mode_bypass.md) — Guest 15-msg cap was client-side cookie only; server-side enforcement added 2026-03-16
- [finding_idor_conversation.md](./finding_idor_conversation.md) — Conversation ownership check missing userId filter (HIGH/IDOR); fixed with .eq('userId', userId) 2026-03-16
- [finding_rate_limits_nominal.md](./finding_rate_limits_nominal.md) — Rate limits were 10k–20k/hr — non-functional; reduced to realistic values 2026-03-16
- [finding_ip_spoofing_rate_limit.md](./finding_ip_spoofing_rate_limit.md) — getRateLimitToken used x-forwarded-for[0] (attacker-controlled); already patched in repo to use rightmost IP
