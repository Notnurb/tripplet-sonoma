# Tripplet SDK — Package Build Guide

> This document is a complete specification for building the official Tripplet API SDK.
> An AI or developer can follow this guide to produce a working, publishable package.

> ⚠️ **Forward-looking spec — the public API surface described here is NOT live yet.**
> This is the *target* design for a future hosted developer API (`api.tripplet.ai`),
> not a description of what responds today. Against the current codebase:
> `/api/v1/chat/completions` **always returns 503** (inference is intentionally
> disabled on the developer API right now — the `503` in the Error Codes table is
> the eventual "model temporarily unavailable" semantics, not the current
> unconditional one), `/api/v1/models` returns a real list, and the `/embeddings`
> and `/images/generations` endpoints do not exist server-side at all. The model
> ids and `api.tripplet.ai` base URL below are aspirational. Build the SDK shape
> from this if you like, but don't expect live chat/embeddings/images responses
> until the hosted API ships.

---

## Overview

Build two SDK packages:
- **`tripplet-sdk`** — JavaScript/TypeScript (npm)
- **`tripplet`** — Python (PyPI)

Both wrap the Tripplet REST API with a developer-friendly interface modeled after the OpenAI SDK pattern.

---

## API Basics

| Property | Value |
|----------|-------|
| Base URL | `https://api.tripplet.ai/v1` |
| Auth | Bearer token in `Authorization` header |
| Key format | `trpl_sk_` followed by 40 hex characters |
| Content-Type | `application/json` |
| Streaming | Server-Sent Events (SSE) via `stream: true` |
| Compatibility | OpenAI-compatible request/response format |

---

## Authentication

All requests must include:
```
Authorization: Bearer trpl_sk_YOUR_API_KEY
```

The API key can be provided via:
1. Constructor parameter: `new Tripplet({ apiKey: "trpl_sk_..." })`
2. Environment variable: `TRIPPLET_API_KEY`

If neither is provided, throw a clear error: `"Missing API key. Set TRIPPLET_API_KEY or pass apiKey to the constructor."`

---

## Endpoints

### 1. POST `/chat/completions`

Create a chat completion. Supports streaming, Extended Thinking, and tool use.

**Request Body:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `model` | string | Yes | — | Model ID (see Models section) |
| `messages` | array | Yes | — | Array of `{role, content}` message objects |
| `max_tokens` | integer | No | 1024 | Maximum tokens to generate |
| `temperature` | float | No | 0.7 | Sampling temperature (0.0–2.0) |
| `stream` | boolean | No | false | Enable SSE streaming |
| `tools` | array | No | — | Function definitions for tool use |
| `top_p` | float | No | 1.0 | Nucleus sampling |
| `stop` | string[] | No | — | Stop sequences |

**Response (non-streaming):**
```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1710000000,
  "model": "taipei-3.1",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "The response text...",
        "thinking": "Step-by-step reasoning (only for -extended models)"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 25,
    "completion_tokens": 150,
    "total_tokens": 175
  }
}
```

**Response (streaming):**
Each SSE chunk:
```
data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"token"},"finish_reason":null}]}

data: [DONE]
```

**Tool use response:**
When the model wants to call a tool:
```json
{
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": null,
        "tool_calls": [
          {
            "id": "call_abc123",
            "type": "function",
            "function": {
              "name": "web_search",
              "arguments": "{\"query\": \"latest AI news\"}"
            }
          }
        ]
      },
      "finish_reason": "tool_calls"
    }
  ]
}
```

After executing the tool, send the result back:
```json
{
  "messages": [
    ...previous_messages,
    { "role": "assistant", "tool_calls": [...] },
    { "role": "tool", "tool_call_id": "call_abc123", "content": "Tool result here" }
  ]
}
```

### 2. GET `/models`

List all available models. No parameters.

**Response:**
```json
{
  "object": "list",
  "data": [
    {
      "id": "taipei-3.1-extended",
      "object": "model",
      "owned_by": "tripplet"
    }
  ]
}
```

### 3. POST `/embeddings`

Generate text embeddings.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `model` | string | Yes | Embedding model ID |
| `input` | string \| string[] | Yes | Text to embed |

**Response:**
```json
{
  "object": "list",
  "data": [
    {
      "object": "embedding",
      "index": 0,
      "embedding": [0.0023, -0.0091, ...]
    }
  ],
  "usage": {
    "prompt_tokens": 8,
    "total_tokens": 8
  }
}
```

### 4. POST `/images/generations`

Generate images from text prompts.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `prompt` | string | Yes | — | Image description |
| `n` | integer | No | 1 | Number of images (1–4) |
| `size` | string | No | "1024x1024" | 256x256, 512x512, or 1024x1024 |

**Response:**
```json
{
  "created": 1710000000,
  "data": [
    {
      "url": "https://..."
    }
  ]
}
```

---

## Models (28 total)

### Taipei Family (Flagship)
| ID | Name | Context | Extended Thinking |
|----|------|---------|-------------------|
| `taipei-3.1-extended` | Taipei 3.1 Extended | 200K | Yes |
| `taipei-3.1` | Taipei 3.1 | 200K | No |
| `taipei-3-extended` | Taipei 3 Extended | 128K | Yes |
| `taipei-3` | Taipei 3 | 128K | No |

### Majuli Family
| ID | Name | Context | Extended Thinking |
|----|------|---------|-------------------|
| `majuli-3.1-extended` | Majuli 3.1 Extended | 200K | Yes |
| `majuli-3.1` | Majuli 3.1 | 200K | No |
| `majuli-3-extended` | Majuli 3 Extended | 128K | Yes |
| `majuli-3` | Majuli 3 | 128K | No |
| `majuli-2.5` | Majuli 2.5 | 64K | No |

### Suzhou Family
| ID | Name | Context | Extended Thinking |
|----|------|---------|-------------------|
| `suzhou-3.1-extended` | Suzhou 3.1 Extended | 200K | Yes |
| `suzhou-3.1` | Suzhou 3.1 | 200K | No |
| `suzhou-3-extended` | Suzhou 3 Extended | 128K | Yes |
| `suzhou-3` | Suzhou 3 | 128K | No |
| `suzhou-2.5` | Suzhou 2.5 | 64K | No |

### Tura Family (Legacy)
| ID | Name | Context | Extended Thinking |
|----|------|---------|-------------------|
| `tura-2.5` | Tura 2.5 | 64K | No |

### Agent Family
| ID | Name | Context |
|----|------|---------|
| `tagent-2-max` | Tripplet Agent 2 Max | 256K |
| `tagent-2-super` | Tripplet Agent 2 Super | 256K |
| `tagent-2` | Tripplet Agent 2 | 200K |
| `tagent-1.5-max` | Tripplet Agent 1.5 Max | 200K |
| `tagent-1.5-super` | Tripplet Agent 1.5 Super | 200K |
| `tagent-1.5` | Tripplet Agent 1.5 | 128K |
| `tagent-1-max` | Tripplet Agent 1 Max | 128K |
| `tagent-1-super` | Tripplet Agent 1 Super | 128K |
| `tagent-1` | Tripplet Agent 1 | 128K |
| `tagentbeta-pro` | Tripplet Agent Beta Pro | 64K |
| `tagentbeta` | Tripplet Agent Beta | 64K |
| `tagentbeta-lite` | Tripplet Agent Lite | 32K |

### Synthara Family (Experimental)
| ID | Name | Context |
|----|------|---------|
| `syn8-1` | Synthara 8.1 | 128K |

---

## Rate Limits

| Tier | Requests/min | Tokens/min |
|------|-------------|------------|
| Free | 15 | 1,000 |
| Pro | 60 | 40,000 |
| Max | 200 | 200,000 |

Rate limit info is returned in response headers:
- `X-RateLimit-Remaining` — requests remaining in current window
- `X-RateLimit-Reset` — Unix timestamp when the window resets

---

## Error Codes

| Code | Meaning |
|------|---------|
| 400 | Bad request — check parameters |
| 401 | Invalid or missing API key |
| 403 | Key revoked or insufficient permissions |
| 429 | Rate limit exceeded — slow down |
| 500 | Internal server error — retry with backoff |
| 503 | Model temporarily unavailable |

Error response format:
```json
{
  "error": {
    "message": "Human-readable error description",
    "type": "invalid_request_error",
    "code": "invalid_api_key"
  }
}
```

---

## JavaScript/TypeScript SDK Specification (`tripplet-sdk`)

### Package Setup
- Name: `tripplet-sdk`
- Runtime: Node.js 18+ and modern browsers (with fetch)
- Language: TypeScript (ship with `.d.ts` declarations)
- Module format: ESM + CJS dual export
- Zero runtime dependencies (use native `fetch`)
- Build tool: tsup or unbuild

### File Structure
```
tripplet-sdk/
├── src/
│   ├── index.ts          # Main export
│   ├── client.ts         # Tripplet class
│   ├── resources/
│   │   ├── chat.ts       # chat.completions.create()
│   │   ├── models.ts     # models.list()
│   │   ├── embeddings.ts # embeddings.create()
│   │   └── images.ts     # images.generate()
│   ├── streaming.ts      # SSE stream parser + async iterator
│   ├── types.ts          # All TypeScript interfaces
│   └── errors.ts         # Custom error classes
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── README.md
```

### Constructor

```typescript
import Tripplet from 'tripplet-sdk';

const client = new Tripplet({
  apiKey: 'trpl_sk_...',        // or reads TRIPPLET_API_KEY env var
  baseURL: 'https://api.tripplet.ai/v1',  // optional override
  timeout: 60000,                // optional, default 60s
  maxRetries: 2,                 // optional, default 2
});
```

### Methods

```typescript
// Chat completions
const response = await client.chat.completions.create({
  model: 'taipei-3.1',
  messages: [{ role: 'user', content: 'Hello' }],
  max_tokens: 1024,
  temperature: 0.7,
});

// Streaming
const stream = await client.chat.completions.create({
  model: 'taipei-3.1',
  messages: [{ role: 'user', content: 'Hello' }],
  stream: true,
});
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
}

// List models
const models = await client.models.list();

// Embeddings
const embeddings = await client.embeddings.create({
  model: 'suzhou-3.1',
  input: 'Hello world',
});

// Image generation
const images = await client.images.generate({
  prompt: 'A sunset over mountains',
  size: '1024x1024',
  n: 1,
});
```

### Error Handling

```typescript
import Tripplet, { TrippletError, RateLimitError, AuthenticationError } from 'tripplet-sdk';

try {
  const response = await client.chat.completions.create({ ... });
} catch (e) {
  if (e instanceof RateLimitError) {
    // e.status === 429
    // e.headers['x-ratelimit-reset'] available
  } else if (e instanceof AuthenticationError) {
    // e.status === 401
  } else if (e instanceof TrippletError) {
    // e.status, e.message, e.code
  }
}
```

### Error Class Hierarchy
```
TrippletError (base)
├── AuthenticationError (401)
├── PermissionError (403)
├── NotFoundError (404)
├── RateLimitError (429)
├── InternalServerError (500)
└── APIConnectionError (network failures)
```

### Retry Logic
- Retry on 429 (rate limit) and 5xx errors
- Use exponential backoff: 500ms, 1000ms, 2000ms
- Respect `Retry-After` header if present
- Do NOT retry 400, 401, 403, 404

### Streaming Implementation
- Parse SSE format: lines starting with `data: `
- Skip empty lines and comments (`:` prefix)
- Terminate on `data: [DONE]`
- Return an async iterable that yields `ChatCompletionChunk` objects
- Must support `for await...of` syntax
- Include an `abort()` method to cancel the stream

### TypeScript Types to Export

```typescript
// Core
export interface ChatCompletionCreateParams {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  stop?: string[];
  tools?: Tool[];
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ChatCompletion {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: Usage;
}

export interface ChatCompletionChoice {
  index: number;
  message: {
    role: 'assistant';
    content: string | null;
    thinking?: string | null;
    tool_calls?: ToolCall[];
  };
  finish_reason: 'stop' | 'length' | 'tool_calls';
}

export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  choices: {
    index: number;
    delta: {
      role?: string;
      content?: string;
      tool_calls?: ToolCall[];
    };
    finish_reason: string | null;
  }[];
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface Tool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface Model {
  id: string;
  object: 'model';
  owned_by: string;
}

export interface Embedding {
  object: 'embedding';
  index: number;
  embedding: number[];
}

export interface ImageGenerationResponse {
  created: number;
  data: { url: string }[];
}
```

---

## Python SDK Specification (`tripplet`)

### Package Setup
- Name: `tripplet`
- Python: 3.8+
- Dependencies: `httpx` (for async + sync support)
- Type hints: Full typing with `py.typed` marker
- Build: `pyproject.toml` with hatchling or setuptools

### File Structure
```
tripplet/
├── src/
│   └── tripplet/
│       ├── __init__.py       # Exports Tripplet class
│       ├── _client.py        # Tripplet + AsyncTripplet classes
│       ├── resources/
│       │   ├── __init__.py
│       │   ├── chat.py       # Completions resource
│       │   ├── models.py     # Models resource
│       │   ├── embeddings.py # Embeddings resource
│       │   └── images.py     # Images resource
│       ├── _streaming.py     # SSE stream parser
│       ├── types.py          # Pydantic or dataclass types
│       ├── _errors.py        # Exception classes
│       └── py.typed          # PEP 561 marker
├── pyproject.toml
├── README.md
└── tests/
```

### Usage

```python
import tripplet

# Sync client
client = tripplet.Tripplet(api_key="trpl_sk_...")

response = client.chat.completions.create(
    model="taipei-3.1",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Hello!"},
    ],
    max_tokens=512,
)
print(response.choices[0].message.content)

# Streaming
stream = client.chat.completions.create(
    model="taipei-3.1",
    messages=[{"role": "user", "content": "Tell me a story."}],
    stream=True,
)
for chunk in stream:
    content = chunk.choices[0].delta.content or ""
    print(content, end="", flush=True)

# Async client
async_client = tripplet.AsyncTripplet(api_key="trpl_sk_...")
response = await async_client.chat.completions.create(...)
```

### Error Classes
```python
class TrippletError(Exception): ...
class AuthenticationError(TrippletError): ...   # 401
class PermissionError(TrippletError): ...       # 403
class NotFoundError(TrippletError): ...         # 404
class RateLimitError(TrippletError): ...        # 429
class InternalServerError(TrippletError): ...   # 500
class APIConnectionError(TrippletError): ...    # Network
```

---

## Key Implementation Notes

1. **Extended Thinking**: Models ending in `-extended` support Extended Thinking. The response includes a `thinking` field on the message with the model's reasoning chain. No special request parameter needed — just use an extended model.

2. **Tool Use**: Follow the OpenAI tool-use pattern exactly. The SDK should pass `tools` through to the API and handle `tool_calls` in the response. The developer is responsible for executing tools and sending results back.

3. **API Key Validation**: Keys always start with `trpl_sk_`. The SDK should warn (not error) if the key doesn't match this prefix, as the format could change.

4. **Streaming**: The streaming implementation is critical. It must:
   - Handle partial SSE lines (buffering)
   - Handle `data: [DONE]` termination
   - Support cancellation/abort
   - Not buffer the entire response in memory

5. **Retry Logic**: Both SDKs should retry on transient errors (429, 500, 503) with exponential backoff. Default: 2 retries. Configurable via constructor.

6. **Timeout**: Default 60 seconds for non-streaming, 600 seconds for streaming requests.

7. **User-Agent**: Send `User-Agent: tripplet-sdk/js/{version}` or `tripplet-python/{version}`.

---

## Testing Checklist

- [ ] Constructor reads `TRIPPLET_API_KEY` from environment
- [ ] Constructor throws if no API key provided
- [ ] Non-streaming chat completion returns typed response
- [ ] Streaming chat completion yields chunks via async iterator
- [ ] `data: [DONE]` terminates the stream cleanly
- [ ] Extended model returns `thinking` field
- [ ] Tool calls are properly deserialized
- [ ] 401 throws `AuthenticationError`
- [ ] 429 throws `RateLimitError` and retries
- [ ] 500 retries with backoff then throws
- [ ] Timeout works correctly
- [ ] `models.list()` returns model array
- [ ] `embeddings.create()` returns embeddings
- [ ] `images.generate()` returns image URLs
- [ ] TypeScript types compile without errors
- [ ] Python type hints pass mypy

---

## Publishing

### npm (tripplet-sdk)
```bash
npm login
npm publish --access public
```

### PyPI (tripplet)
```bash
pip install build twine
python -m build
twine upload dist/*
```
