---
name: Reasoning vs. Non-Reasoning Prompt Patterns — Tripplet Models
description: How to differentiate system prompt construction for reasoning (tura-3) vs. non-reasoning (majuli-3, suzhou-3) Tripplet models
type: reference
---

**Core principle:** Reasoning models (internal-model / tura-3) perform internal chain-of-thought before generating output. Giving them verbose procedural instructions ("break down your thinking step by step") is largely redundant and wastes context window. The model already does this internally.

**For reasoning models (tura-3):**
- Keep system prompt SHORT and high-signal: define role, constraints, output format
- Avoid "think step by step" type instructions — the model's reasoning substrate handles this
- Use temperature 0.1–0.3 max; higher temps fight the deterministic internal reasoning trace
- Do NOT include the full PLANNING_INSTRUCTIONS block unless the task specifically needs markdown plan output
- Think Mode on tura-3 is somewhat redundant — the value is in making the reasoning visible to the user, not in triggering reasoning (it already reasons)

**For non-reasoning models (majuli-3, suzhou-3):**
- Rich system prompts with explicit behavioral instructions work well
- Chain-of-thought prompting ("let's think step by step") is genuinely additive
- Temperature range can be used fully: 0.3 for accuracy tasks, 0.7–0.9 for creative tasks
- Suzhou-3 is experimental/creative — it benefits most from open-ended, evocative system prompts rather than structured rule lists

**Streaming considerations:**
- Both model types stream well via SSE; reasoning models may have a longer initial latency before the first token due to internal reasoning budget
- For tura-3, the extended thinking budget (if exposed) should be treated as a separate token pool from the output tokens
- The current chat-client.ts streamChat implementation correctly handles SSE parsing; no changes needed there

**How to apply:** When reviewing or suggesting changes to sprompts/*.md files, always check which model the prompt targets and adjust verbosity accordingly.
