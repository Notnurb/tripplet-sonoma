---
name: High-risk surfaces in x1-chat
description: Known dangerous areas in the codebase that require extra scrutiny on every change
type: project
---

## High-risk surfaces identified as of 2026-03-16

### 1. `src/app/api/chat/route.ts` — the system prompt construction pipeline
Every piece of external content that gets appended to the system prompt is a prompt-injection surface. Three sub-surfaces:
- **Memory context** (`getMemoryContext`): fetches from `BACKEND_URL`, unsanitized content is embedded verbatim.
- **Web search results** (`fetchWebSearchResults`): live web content injected into system prompt — any page can contain adversarial instructions.
- **`systemPromptOverride` field**: client-supplied string that replaces the entire system prompt — was unguarded for unauthenticated callers.

### 2. `BACKEND_URL` external service
This is an out-of-repo service handling memory and search. It is fully trusted by `route.ts` — no authentication header, no response schema validation. A compromised or misconfigured `BACKEND_URL` can poison all users' memory contexts simultaneously.

### 3. Guest mode boundary
Guest mode is model-locked (suzhou-3 only) and message-limited (15 turns). The original code enforced the model restriction server-side but the message cap was client-side only (cookie). Server-side cap was added 2026-03-16.

### 4. `isHivemind` + collective memory
The `collective-hivemind` user ID routes to a shared memory pool. Only gated behind `userId` being non-null — meaning any authenticated user can write to the collective memory. If the hivemind memory pool is ever surfaced to other users' contexts, one authenticated user can poison it for all.

### 5. Anura OS (prompt-level only)
Prompt-level agent mode: it injects a system-prompt addendum, but the `@anura` text-trigger and the sandboxed VM iframe are NOT wired up, so there is no live VM surface today. If anyone actually wires the trigger/iframe, treat it as high-risk and scrutinize the message-passing interface. The real sandboxed VM is the Sandboxed Linux skill (v86 + run_bash).

**Why:** These are the areas most likely to produce safety-relevant bugs. Any PR touching these files should get a dedicated review pass.

**How to apply:** When reviewing a PR or change that touches `route.ts`, the Anura trigger, or `BACKEND_URL` call sites, flag it immediately and apply the full safety review template.
