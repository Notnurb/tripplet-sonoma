---
name: System Prompt Architecture — Tripplet
description: How system-prompt.ts constructs prompts; key patterns and gaps identified
type: project
---

Construction order in getSystemPrompt():
1. Model personality base (loaded from sprompts/*.md files, hot-reloaded each call)
2. SHARED_CAPABILITIES block (planning instructions, hard task criteria, Anura intro)
3. Active mode addendums (think, deep-research, web-search, study)
4. Tone modifier
5. Anura OS instructions (conditional)

Memory + search are injected AFTER getSystemPrompt() in route.ts, appended directly to the system prompt string.

**Key gaps:**
- No model-specific system prompt STRUCTURE for reasoning vs. non-reasoning. Reasoning models (tura-3) should receive a shorter, higher-signal system prompt since they internally expand reasoning — verbose instructions can dilute the reasoning trace.
- SHARED_CAPABILITIES is appended to ALL models equally, including the very lightweight suzhou-3 guest model, which adds unnecessary token overhead.
- The planning framework emoji markers (✅ 🔄 ⏳ ❌ ⚠️) are always included even when no planning-relevant mode is active.
- Memory is injected at the very end of the system prompt, after all mode instructions. This is correct — it gives the model the most recent contextual signal closest to the conversation.

**How to apply:** When advising on prompt improvements, note that tura-3 needs a leaner base prompt and reasoning-specific instructions, not the full SHARED_CAPABILITIES block. suzhou-3 and majuli-3 benefit more from the rich structured prompt.
