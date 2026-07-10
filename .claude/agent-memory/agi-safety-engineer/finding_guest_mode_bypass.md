---
name: finding_guest_mode_bypass
description: Guest 15-message cap was enforced only client-side via cookies; the API had no server-side message count check
type: project
---

The CLAUDE.md documents "Guest mode: Cookie-tracked, max 15 messages". The cookie tracking lives in the client. The `/api/chat` route had no server-side check on message count for unauthenticated sessions.

Any guest could bypass the conversion funnel by sending API requests directly (curl, Postman, etc.) without the cookie, or by manipulating the cookie value, gaining unlimited access to the Tripplet model at the platform's API cost.

**Fix applied 2026-03-16:** The POST handler now counts `user`-role messages in the submitted `messages` array. If the count exceeds 15, a 403 is returned before any API call is made. This is still bypassable by a caller who truncates the messages array, but it closes the trivial bypass and adds meaningful friction.

**Residual risk:** A sophisticated caller can send truncated message arrays (pretending each request is the first message). True enforcement requires server-side session tracking of message counts, e.g. a Redis counter keyed to a guest session token. The current fix is a significant improvement over nothing.
