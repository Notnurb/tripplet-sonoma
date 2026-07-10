# Models and Personas

## The lineup (`src/lib/ai/models.ts`)

Persona ids are stable API identifiers; display names move independently of them (a rename like "Taipei 3 → 4" must never break saved conversations, since `Conversation.model` and `Message` history reference the id).

| Model | Persona ID | Best for |
|---|---|---|
| **Astro 5** | `astro-5` | Flagship — top reasoning and range |
| **Taipei 4** | `tura-3` | Advanced reasoning and analysis |
| **Majuli 4** | `majuli-3` | Fast, concise responses |
| **Suzhou 4** | `suzhou-3` | Creative, detailed generation |

There's also **Astro 5 Code** (`astro-5-code`) — not a single model but a staged pipeline (see DeepCode below). Guest mode is locked to Suzhou.

### Legacy tier (opt-in)
A **Legacy Models** toggle in Settings adds `LEGACY_MODELS` to the lineup (via `modelsForPage(page, includeLegacy)`): Synthara 5.2 Plus (`legacy-synthara-5.2-plus`), Taipei 3 (`legacy-taipei-3`), Majuli 3 (`legacy-majuli-3`), Suzhou 3 (`legacy-suzhou-3`). Off by default.

## `resolveBackend()`

Lives in `src/lib/ai/llm.ts`. Given a persona id, picks the actual inference backend and returns connection details. **All four workspace personas** (`astro-5`, `tura-3`, `majuli-3`, `suzhou-3`), the DeepCode persona, and the opt-in legacy tier route to **OpenCode Zen** (`OPENCODE_ZEN_API_KEY`) via `OPENCODE_ZEN_MODEL_BY_PERSONA`. **Groq** (`GROQ_API_KEY`) is the fallback — it serves any persona id *not* in that map plus the fixed-model utility routes (title generation, sandbox, execute). So `OPENCODE_ZEN_API_KEY` is load-bearing for every shipped chat persona today; `GROQ_API_KEY` backs the utility calls and any future unmapped persona. Callers never hardcode a provider URL; this is the single indirection point if a persona's backend ever needs to move.

`src/lib/ai/chat-client.ts` is the OpenAI-compatible streaming client that consumes whatever `resolveBackend()` returns. Vision/image/video generation code paths were removed from it in July 2026.

## Modes and tones (`src/lib/ai/modes.ts`, `src/lib/ai/system-prompt.ts`)

Composable toggles applied during system-prompt construction:

- **Modes**: `think` (temp 0.3), `deep-research` (8k tokens, temp 0.5), `web-search` (temp 0.7), `study` (temp 0.4)
- **Tones**: formal, concise, detailed, minimal
- `deep-research` and `study` are mutually exclusive — the UI should not allow both active at once.

## DeepCode pipeline (`src/lib/sonoma/deepcode.ts`)

Astro 5 Code isn't one model call — it's a staged pipeline:

1. **Thinker** reasons in rounds, streamed live into the chat's collapsible thinking pane.
2. **Router** checks after each round whether the reasoning is actually converged/done.
3. **Coder** writes the final answer using the accumulated reasoning as context — explicitly instructed to produce production-grade code (real imports, full functions, complete error handling, no `// TODO` placeholders).

The whole pipeline shares one wall-clock budget so the platform can't kill it mid-answer partway through a stage.

## Extended Thinking

A deeper reasoning budget exposed as a chat option, independent of persona — see `src/types/index.ts` for where it's threaded through the request/response shapes.
