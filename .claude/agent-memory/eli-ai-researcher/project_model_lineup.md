---
name: Tripplet Model Lineup
description: Current model IDs, API model strings, and UI descriptions for all three Tripplet models as of March 2026
type: project
---

Tripplet ships three models defined in `src/lib/ai/models.ts`:

- **Taipei 3.1** (`tura-3`) — API: `internal-model` — Description: "Advanced reasoning and analysis"
- **Majuli 3.1** (`majuli-3`) — API: `internal-model` — Description: "Fast and concise responses"
- **Suzhou 3.1** (`suzhou-3`) — API: `internal-model` — Description: "Creative and detailed generation" (also the guest-mode model)

Vision model: `internal-model`

**Why:** These are brand aliases over Tripplet models. The naming follows a geographic/city theme — Taipei (Taiwan), Majuli (island in India), Suzhou (city in China).

**How to apply:** When explaining the models to users, emphasize what each one *feels like* to use, not just the raw API backing. The descriptions are currently minimal and could be more evocative.
