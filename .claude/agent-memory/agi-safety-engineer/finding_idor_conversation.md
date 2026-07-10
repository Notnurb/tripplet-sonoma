---
name: finding_idor_conversation
description: Conversation ownership check in /api/chat omitted userId filter — an authenticated user could inject messages into any other user's conversation (IDOR)
type: project
---

Pre-fix code in `/src/app/api/chat/route.ts`:
```
.select('id')
.eq('id', conversationId)   // no .eq('userId', userId) filter
.single()
```

If a conversation with the provided `conversationId` existed but belonged to user B, user A's check returned a hit, the route skipped creation, and then appended user A's message to user B's conversation — and stored user B's assistant replies as if they were user A's.

**Fix applied 2026-03-16:** `.eq('userId', userId)` added to both the lookup query and the subsequent update query. The insert path was already safe (it writes userId from the auth token). The behavior for a tampered ID is now: lookup misses, insert creates a new conversation owned by the requesting user — which is correct and safe.

**Residual concern:** The `Message.insert` for the assistant response (inside the stream's async callback) still does not include a userId ownership re-verification. This is acceptable because the conversationId ownership was verified synchronously before the stream started, but worth noting if the stream callback logic is ever refactored.
