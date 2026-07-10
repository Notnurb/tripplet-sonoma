---
name: Media API Safety Audit — 2026-03-16
description: Findings and fixes from the image/video generation and proxy API safety review
type: project
---

Conducted full audit of imagine, imagine-video, image-proxy routes and chat-client.ts on 2026-03-16.

**Why:** Platform generates real media via paid external APIs; these endpoints touch billing, SSRF, and auth surfaces.

**How to apply:** Reference these findings when reviewing any new media endpoints, polling patterns, or proxy handlers.

## Critical Issues — Fixed

1. **Auth bypass on video status polling** (`/api/imagine-video/status/route.ts`): No `auth()` check. Any unauthenticated caller could poll arbitrary job IDs against the the inference API. Fixed by adding Clerk `auth()` guard.

2. **Path-traversal / URL injection via requestId** (`chat-client.ts` `pollVideoStatus`): User-supplied `requestId` was interpolated directly into `the inference backend/videos/${requestId}` with no validation. A value like `../../../admin` or a URL-encoded segment could redirect the server-side fetch. Fixed by enforcing `^[a-zA-Z0-9_-]{1,128}$` regex before the call reaches chat-client.ts.

3. **Unauthenticated image proxy** (`/api/image-proxy/route.ts`): Despite SSRF defenses (hostname whitelist, private-IP blocklist), the proxy was publicly accessible with no auth. Any anonymous actor on the internet could use Tripplet's egress IP to exfiltrate content from whitelisted domains or trigger bandwidth abuse. Fixed by adding Clerk `auth()` guard. Runtime changed from `edge` to `nodejs` to support Clerk's server-side auth.

4. **CORS wildcard fallback on authenticated proxy**: `Access-Control-Allow-Origin` defaulted to `*` when `NEXT_PUBLIC_APP_URL` was unset. This allowed any origin to read proxied image bytes via a credentialed cross-origin fetch. Fixed by defaulting to `'null'` (blocks all cross-origin reads) rather than `'*'`.

## Significant Concerns — Not Fixed (need product decision)

- **No prompt content filtering**: Neither image nor video generation APIs apply any keyword blocklist or toxicity classifier to user prompts before forwarding to the inference backend. The platform relies entirely on the inference backend's own content policy. If the inference backend's moderation fails or is bypassed, harmful content could be generated under Tripplet's API key. Recommend adding a lightweight server-side blocklist for the most severe categories (CSAM keywords, explicit violence).

- **Rate limits are nominally present but effectively unlimited**: Image limit is 5,000/hour per token; video is 2,000/hour. At typical API rates these limits allow a single authenticated user to generate thousands of dollars of media in one hour. Consider tightening to single-digit per-minute limits for non-subscribed users.

- **base64 payload size is unbounded**: `imageBase64` and `videoBase64` fields in request bodies have no size limit beyond the Next.js default body parser. A 100 MB base64 payload would be parsed in memory on the Node runtime. Recommend adding an explicit `Content-Length` check or Next.js `bodyParser.sizeLimit`.

- **`console.log` leaks prompt content**: `chat-client.ts` logs the full prompt to stdout on every image and video generation request. In a hosted environment this means user prompts flow into application logs. Redact or remove these before production.

## Safety Strengths — Pre-existing

- `storage.googleapis.com` is in the proxy allowlist but is a very broad wildcard host. Worth tightening to specific GCS bucket prefixes if known.
- HTTPS-only enforcement on the proxy is correct.
- Private-IP blocklist covers IPv4 RFC-1918 ranges and common IPv6 link-local/ULA prefixes.
- mimeType validation via regex on both image and video upload paths.
- Clerk auth on the primary generate endpoints (`/api/imagine` and `/api/imagine-video`) was already correct.
- `n` parameter for image count is clamped 1-5 at the route layer.
