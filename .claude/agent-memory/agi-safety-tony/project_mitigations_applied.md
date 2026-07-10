---
name: Accepted and shipped mitigations — x1-chat
description: Security mitigations that have been accepted and are now in the codebase, so we don't re-litigate them
type: project
---

## Mitigations shipped as of 2026-03-16

All changes are in `src/app/api/chat/route.ts`.

### 1. `systemPromptOverride` guest block (CRITICAL — fixed)
**Before:** Any unauthenticated caller could send `systemPromptOverride` in the POST body and replace the entire system prompt, bypassing the guest-mode safety addendum.
**After:** `allowedOverride = userId ? systemPromptOverride : undefined` — guests always get the standard prompt with the guest-mode addendum.

### 2. `sanitizeExternalContent()` function (HIGH — fixed)
**Before:** Memory context and web search content were embedded verbatim in the system prompt with no sanitization.
**After:** A `sanitizeExternalContent()` helper strips our own XML wrapper tag names (to prevent tag-escape) and common prompt-injection prefixes before embedding. Applied to: user profile context, individual memory entries, web search highlights/raw_content.

### 3. Structured XML trust labeling for injected content (HIGH — fixed)
**Before:** Memory context used markdown `--- delimiters ---` which are trivially spoofed by content that contains those exact strings.
**After:** Both memory context and web search results are wrapped in XML tags with explicit `trust` attributes (`trust="low"` and `trust="untrusted"` respectively) plus in-band instructions telling the model to treat the content as data, not instructions.

### 4. Conversation ownership IDOR fix (MEDIUM — fixed)
**Before:** The Conversation lookup queried only on `conversationId`, not `conversationId + userId`. An authenticated user sending a known conversation ID could write messages into that conversation regardless of owner.
**After:** Both the SELECT and the UPDATE use `.eq('userId', userId)` in addition to `.eq('id', conversationId)`.

### 5. Server-side guest message cap (MEDIUM — fixed)
**Before:** The 15-message guest limit was enforced only via a client-side cookie, trivially bypassed by any curl request.
**After:** Server-side check: count `user`-role messages in the request body; reject with 403 if count exceeds 15.

### Residual risks after these mitigations
- `systemPromptOverride` is still accepted from authenticated users without any validation of the override content. A compromised authenticated account can still inject arbitrary system prompts.
- `sanitizeExternalContent` uses a regex denylist — novel injection techniques not matching the pattern will still get through. This is defense-in-depth, not a complete solution.
- The `BACKEND_URL` service has no authentication and is fully trusted. Backend compromise = full memory poisoning for all users.
- Collective hivemind memory (`isHivemind=true`) is writable by any authenticated user. Cross-user memory poisoning via hivemind is still possible.
