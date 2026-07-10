---
name: Tripplet Schema Audit — Initial Findings
description: Key data infrastructure findings from first audit of prisma/schema.prisma, chat API, and history route
type: project
---

Initial audit completed (2026-04-05). Key findings for future context:

**AIUsage table is unused in practice.** The `POST /api/chat/route.ts` never writes to `AIUsage`. Token counts and costs are not being persisted. All billing analytics are blind.

**Why:** The table exists in schema but the chat route only writes to `Conversation` and `Message` via Supabase client. There is no insert into `AIUsage` anywhere in the chat flow.

**How to apply:** When building billing or model-cost dashboards, note that `AIUsage` has zero production data. Any cost analysis must be reconstructed from message content length as a proxy, or a new instrumentation point must be added in `src/app/api/chat/route.ts` after the stream closes.

**History route loads all messages for all conversations unbounded** — `src/app/api/chat/history/route.ts` fetches every conversation + every message for a user in a single query with no pagination or LIMIT. This will degrade as conversation volume grows.

**AIUsage missing FK constraint** — `AIUsage.conversationId` has no `@relation` to `Conversation`, so there is no referential integrity enforcement and no cascade delete.

**Session model is orphaned** — `Session` has no `@relation` back to `User`, so Prisma cannot enforce FK integrity. Auth is handled by Clerk; this table may be a dead artifact.

**Key analytics gaps identified:**
- No mode/tone usage tracking (which modes are actually used)
- No guest-to-registered conversion events
- No image/video generation events table
- No search usage tracking (web-search invocations)
- No message-level latency or token counts stored
- `role` and `model` in Message/Conversation are plain `String` with no enum constraint
