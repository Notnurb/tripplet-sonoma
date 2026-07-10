---
name: Tripplet Mode System Architecture
description: Technical details of Tripplet's chat mode system — temperatures, token limits, conflicts, and resolution logic
type: project
---

Tripplet has four composable chat modes defined in `src/lib/ai/modes.ts`, with system prompt addendums in `src/lib/ai/system-prompt.ts`:

- **think** — temp 0.3, no web search, step-by-step reasoning mode
- **deep-research** — temp 0.5, 8192 max tokens, multi-angle long-form analysis
- **web-search** — temp 0.7, web search enabled, current info retrieval
- **study** — temp 0.4, tutor mode with follow-up questions

**Why:** Modes are composable toggles that adjust temperature + system prompt without swapping models. `resolveSettings()` picks the lowest temperature and highest maxTokens across all active modes when multiple are stacked.

**Conflict rules:** `deep-research` and `study` are mutually exclusive. No other hard conflicts enforced.

**Mode/tone conflict resolution:** When a depth mode (think, deep-research, study) and a brevity tone (concise, minimal) are both active, an explicit resolution prompt is injected: mode governs length/structure, tone governs register/style.

**Client management:** `useChat.ts` passes `activeModes` array to `/api/chat`. Shimmer labels per mode are used while waiting for first token.

**Missing modes identified in research review (2026-03-24):** code, creative/brainstorm, debate/steelman, translation/localization, and an ELI5 (explain like I'm 5) mode.
