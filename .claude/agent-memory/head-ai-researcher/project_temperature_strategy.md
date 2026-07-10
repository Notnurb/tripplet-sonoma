---
name: Temperature Strategy — Tripplet Modes
description: Current temperature assignments per mode and analysis of correctness vs. best practices
type: project
---

Current assignments in src/lib/ai/modes.ts:
- think: 0.3
- deep-research: 0.5
- web-search: 0.7
- study: 0.4
- default (no mode): 0.7

**Why:** think/study at lower temps enforces consistency in reasoning chains. deep-research at 0.5 balances coverage vs. creativity. web-search at 0.7 allows natural synthesis of live data.

**Gaps identified:**
- No model-aware temperature adjustment: tura-3 (reasoning model) should ideally receive temp 0 or very low (0.1–0.2) since reasoning models do their own internal token sampling; passing temp 0.7 wastes credits on nondeterministic output that conflicts with the chain-of-thought substrate.
- Code generation tasks have no dedicated mode — default 0.7 is too high for syntactically correct output.
- resolveSettings() takes the minimum temperature when multiple modes are active, which is correct behavior.
- deep-research at 0.5 is slightly high for factual synthesis; 0.35 would be more appropriate given that it is used for research documents not creative generation.
- Majuli gets a hard max_tokens cap of 2048 enforced in route.ts (line 340) when no mode overrides it. This is intentional to keep Majuli fast and concise.

**How to apply:** When recommending temperature changes, always check whether the target model is a reasoning variant (tura-3 / internal-model). Reasoning models should be pinned lower (0.1–0.3 max) regardless of mode. Non-reasoning models (majuli-3, suzhou-3) can use the full 0.0–1.0 range.
