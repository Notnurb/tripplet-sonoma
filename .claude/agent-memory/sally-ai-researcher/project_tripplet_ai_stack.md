---
name: Tripplet AI Stack Architecture
description: Core AI layer details — models, modes, temperatures, system prompt construction, and known architectural patterns
type: project
---

Tripplet uses three Tripplet model aliases (tura-3/reasoning, majuli-3/non-reasoning, suzhou-3/experimental) with a composable mode+tone system layered onto per-model system prompts loaded from /sprompts/ files.

Mode temperatures: think=0.3, deep-research=0.5, web-search=0.7, study=0.4. Default baseline is 0.7.
Only deep-research sets a maxTokens cap (8192). Majuli-3 gets a 2048 token cap in the API route unless a mode overrides it.

System prompt is assembled at request time: model prompt + shared capabilities + mode addendums + tone + conflict resolution (if brevity tone conflicts with depth mode) + Anura + memory context + web search results.

Memory context is injected with a trust="low" XML wrapper. Web search results use trust="untrusted". Both are sanitized for prompt injection before embedding.

The Epsilon (code workspace) subsystem uses a separate two-model architecture (text planner + code generator) defined in epsilon.ts with its own system prompts.

**Why:** First full analysis done 2026-03-24.
**How to apply:** Use when asked about model selection, temperature tuning, system prompt improvements, or mode behavior on Tripplet.
