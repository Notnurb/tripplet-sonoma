---
name: Tripplet Streaming Architecture
description: How Tripplet implements streaming AI responses — client hook, server route, and render layer details
type: project
---

Tripplet uses SSE (Server-Sent Events) over a ReadableStream for all AI chat streaming.

**Client-side (useChat.ts):**
- `requestAnimationFrame` batching: chunks are buffered into `latestBufferedContent` and flushed on the next rAF tick via `scheduleStreamingContent()`. This is a solid perceived-performance technique.
- Shimmer label cycling at 1200ms intervals while waiting for first token — model-specific labels (TURA_LABELS, EXTENDED_LABELS, mode-specific labels)
- 90-second hard abort timeout via `AbortController`
- `streamingContent` state is separate from final message state — cleared on completion, then committed as a `Message` object

**Server-side (api/chat/route.ts):**
- Memory + web search fetched in parallel before streaming begins (adds latency before first token)
- Web search has an 8s timeout, memory has a 3s timeout — both block the stream start
- `search_stats` sent as the first SSE event before any content tokens
- No explicit streaming backpressure or chunk size control

**Render layer (MessageBubble.tsx):**
- Full ReactMarkdown re-parse on every streaming update (no incremental/virtualized rendering)
- Blinking cursor appended inline during streaming
- Action buttons (copy, regen, thumbs) hidden behind group-hover — only visible post-stream

**Why:** Understanding this is critical for recommending streaming UX improvements. The blocking pre-stream work (memory+search) is the biggest latency gap before first token.

**How to apply:** Any streaming UX improvement suggestions should account for the rAF batching already in place, the shimmer system already built, and the blocking pre-stream fetches on the server side.
