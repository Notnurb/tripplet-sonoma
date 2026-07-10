# External Backend (`BACKEND_URL`)

A separate Python service — `services/backend` in this repo, but deployed independently — reached via `backendFetch()` (`src/lib/backend.ts`). It is **optional**: the app is designed to degrade gracefully when it's absent.

## What it backs

| Endpoint | Called from | Purpose |
|---|---|---|
| `POST /memory/add` | `/api/chat` | Persist a new memory entry after a conversation turn |
| `POST /memory/search` | MCP tools | Retrieve relevant memories for context injection |
| `POST /search/combined` | `/api/search` | Combined web search (aggregates multiple providers) |
| `POST /search/exa` | `/api/search` | Exa-specific search |
| `POST /search/firecrawl` | `/api/search` | Firecrawl-specific search/scrape |

It also backs Agents, LoopTrain, and the Triplepedia knowledge base — anything that needs server-side state or credentials the Next.js app itself doesn't hold.

The backend runs its own inference through a **provider-neutral, OpenAI-compatible client** (`services/backend/services/llm_client.py`) configured entirely by environment (`LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`, optional `LLM_SYNTHESIS_MODEL`) — the single indirection point if the backend's model host ever moves, mirroring `resolveBackend()` on the Next.js side. Memory embeddings use a **local sentence-transformers model** (`EMBEDDING_MODEL`, default `all-MiniLM-L6-v2`), so no external embedding provider is required; web search additionally uses optional Exa / Firecrawl keys.

## Graceful degradation

- **Web search**: the Sonoma tool loop's search tool (`src/lib/ai/websearch.ts`) falls back to keyless DuckDuckGo scraping when `BACKEND_URL` isn't configured or the backend call fails. Zero API keys required for basic search to work.
- **Memory**: simply switches off — no error surfaced to the user, the system prompt just doesn't get memory context injected.

## Configuration

```
BACKEND_URL=http://localhost:8000
BACKEND_API_KEY=shared-secret-between-next-and-backend
```

Both optional (see `.env.template`). `BACKEND_API_KEY` is a shared secret authenticating the Next.js app to the backend service — rotate it if it's ever exposed the same way any other credential would be (see [Security](./Security.md) incident history).
