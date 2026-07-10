---
name: prompt_injection_vectors
description: Memory and web-search injection into system prompt — current state as of 2026-03-28 audit
type: project
---

Both `getMemoryContext()` and `fetchWebSearchResults()` in `/src/app/api/chat/route.ts` inject external content into the system prompt. As of 2026-03-28 both injection points have mitigations applied. Confirmed still present and mitigated as of 2026-04-05 audit.

**Memory injection point:** `getMemoryContext()` sanitizes each entry via `sanitizeExternalContent()` and wraps the block in `<memory_context type="user_data" trust="low">` with an explicit preamble declaring the content is factual data only.

**Search injection point:** `fetchWebSearchResults()` sanitizes each result via `sanitizeExternalContent()` and wraps in `<web_search_results type="external_data" trust="untrusted">` with the same preamble.

**`sanitizeExternalContent()` function:** Strips our own XML tag names (prevents tag-escape attacks) and applies a regex covering common "ignore previous instructions" injection phrases. Pattern is reasonable but not exhaustive — Unicode homoglyph evasion, multi-language injections, and split-across-line patterns are not covered.

**Mode/tone injection:** Client-supplied `activeModes` and `activeTone` values are looked up against hardcoded server-side dictionaries (`MODE_PROMPTS`, `TONE_PROMPTS`). Unrecognized values are silently dropped. This is safe — no user string is inserted raw into the prompt.

**`systemPromptOverride`:** Accepted from authenticated users only (line 274). Guest override is silently dropped. Authenticated users can supply arbitrary system prompt text — this is an intentional privileged feature but carries insider/SSRF risk if the override isn't logged.

**Auto-detected modes:** String list of mode names appended verbatim at line 381-382 of system-prompt.ts. The `modeList` is constructed from `autoDetectedModes.join(', ')` which comes from `detectSkillsFromMessage()` — need to verify that function cannot produce attacker-controlled strings.

**Residual risks:**
- MEDIUM: XML wrapping is a soft boundary. Sophisticated multi-step injection through poisoned memory can still influence behavior.
- LOW-MEDIUM: `systemPromptOverride` for authenticated users is unlogged — no audit trail of overrides.
- LOW: `autoDetectedModes` mode name list injected into prompt text — safe only if `detectSkillsFromMessage` returns only known ChatMode enum values.

**Long-term recommendation:** Move search/memory retrieval into structured tool-call responses rather than inline system prompt concatenation. This is the only durable fix.
