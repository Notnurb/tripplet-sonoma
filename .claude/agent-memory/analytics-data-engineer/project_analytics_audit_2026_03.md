---
name: Tripplet Analytics Audit — March 2026
description: Findings from the first full analytics/data audit of the Tripplet x1-chat platform
type: project
---

Initial analytics audit completed 2026-03-19. Key findings:

**AIUsage table is never written to.** The model exists in schema.prisma but zero API routes call a Supabase insert into AIUsage. Token counts, cost estimates, model names are all flowing through the Tripplet API but being silently discarded.

**Mode and tone are not persisted at the conversation level.** The Message model stores `tone` and `extendedThink`, but there is no `activeModes` field on Message or Conversation. Which modes (think, deep-research, web-search, study) were active for a given turn is permanently lost.

**Guest-to-signup conversion is completely blind.** No event is fired when a guest hits the 15-message cap, when they see the sign-in nudge, or when they subsequently create an account. The SubscriptionContext is hardcoded to `plan: 'max'` with infinite credits — it is a stub, not real subscription tracking.

**Image and video generation routes write zero analytics.** `/api/imagine` and `/api/imagine-video` have auth, rate limiting, and business logic, but no persistence of who generated what or when. proMode usage is also untracked.

**History query is unbounded.** `/api/chat/history` fetches ALL conversations with ALL messages for a user in one query — no pagination, no message limit. This will cause P99 latency spikes as power users accumulate history.

**Schema/auth mismatch.** The schema has a custom `User` model with `passwordHash`, but the app uses Clerk for auth. The Supabase `User` table is likely never populated by Clerk users. `AIUsage.userId` references this custom User, so writing AIUsage for Clerk users would fail FK constraint.

**Why this matters:** Without AIUsage data, we cannot answer "what does a request cost?", "which model is most used?", or "are we profitable per user?". Without mode/tone tracking we cannot answer "does think mode drive retention?". Without conversion events we cannot measure guest funnel efficiency.

**How to apply:** All schema proposals and instrumentation recommendations should treat AIUsage write path and the Clerk/User FK mismatch as the two highest-priority blockers before any new analytics work.
