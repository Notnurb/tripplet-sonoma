# Agent Memory Index

This index organizes persistent memories for cross-conversation context. Memories are grouped by type and topic for quick retrieval.

## User Profile & Preferences
*Information about the user's role, expertise, goals, and collaboration preferences*

- [user_role.md](./user_role.md) — Alex B (Notnurb), founder and AI researcher at Tripplet AI; deep technical knowledge, prefers direct communication and autonomous execution
## Feedback & Behavioral Guidance
*Corrections, preferences, and lessons learned about how to work with this user*

- [feedback_communication_style.md](./feedback_communication_style.md) — Avoid theatrical language, performative enthusiasm, and childish analogies; be professional and capable
- [feedback_system_prompts.md](./feedback_system_prompts.md) — When improving system prompts: prioritize structure, remove redundancy, fix awkward phrasing, and eliminate cringe

## Project Context & Decisions
*Strategic decisions, ongoing initiatives, known issues, and their rationale*

### Tripplet Platform Architecture
- [project_temperature_strategy.md](./project_temperature_strategy.md) — Temperature parameter assignments per mode/model and analysis of their correctness
- [project_system_prompt_architecture.md](./project_system_prompt_architecture.md) — How system-prompt.ts constructs prompts; architectural patterns and identified gaps
- [project_model_catalog.md](./project_model_catalog.md) — Taipei 3.1 (reasoning/autonomous), Majuli 3.1 (fast), Suzhou 3.1 (creative/brief/guest); capabilities and use cases
- [project_ui_rules.md](./project_ui_rules.md) — Hard constraints: no suggestion chips near chat input, no depth pill; rationale and enforcement points
- [project_auth_flow.md](./project_auth_flow.md) — Clerk authentication + guest mode (15 message limit, Suzhou-only); conversion funnel considerations

### Feature Development
- [project_epsilon_execution_research.md](./project_epsilon_execution_research.md) — Python execution backend, file download mechanisms, and user-facing Supabase DB design for Epsilon code workspace feature
- [project_anura_os_integration.md](./project_anura_os_integration.md) — Anura OS is prompt-level only today; the @anura trigger and in-browser VM are not wired up
- [project_extended_thinking.md](./project_extended_thinking.md) — Extended reasoning mode implementation; when it activates and how it differs from standard think mode

### Research & Analysis
- [research_reasoning_vs_nonreasoning_prompts.md](./research_reasoning_vs_nonreasoning_prompts.md) — System prompt differentiation strategy for reasoning vs. non-reasoning Tripplet models

### Strategic Priorities
- [project_guest_conversion_strategy.md](./project_guest_conversion_strategy.md) — Guest-to-paid conversion is top priority; current blockers and proposed improvements to onboarding funnel
- [project_competitive_differentiation.md](./project_competitive_differentiation.md) — Key differentiators vs. ChatGPT/Claude.ai; feature gaps and opportunities for unique value props

## External References
*Pointers to where information lives in external systems*

- [reference_backend_services.md](./reference_backend_services.md) — BACKEND_URL endpoints for memory, search, and agents; API contract and expected behavior
- [reference_supabase_schema.md](./reference_supabase_schema.md) — Key Supabase tables for chat persistence, user data, and Epsilon workspaces; schema evolution notes

---

**Memory Management Guidelines:**
- Update this index when creating, renaming, or removing memory files
- Keep descriptions specific enough to judge relevance from the index alone
- Archive or remove outdated memories rather than letting them accumulate
- Organize semantically by topic, not chronologically
- If a memory grows stale or is superseded by code changes, mark it as deprecated or remove it

