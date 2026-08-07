// Centralised LLM endpoints + per-persona backend routing.
//
// The four workspace personas are served by OpenCode Zen (OpenAI-compatible):
//   astro-5  (Astro 5)  → glm-5.2               — flagship (OPENCODE_ZEN_MODEL)
//   taipei4   (Taipei 4) → glm-5.2
//   majuli4 (Majuli 4) → claude-sonnet-4-6
//   suzhou4 (Suzhou 4) → nemotron-3-ultra-free
//
// Groq (also OpenAI-compatible) remains the fallback provider for any other
// persona id and for the fixed-model utility routes (title/sandbox/execute).
// Use resolveBackend() to get the right { url, apiKey, model } for a persona
// instead of reading the provider constants directly.

import { DEEP_CODE_PERSONA } from './models';
import { loadAppConfig } from '../config-md.mjs';

export const LLM_API_URL =
    process.env.GROQ_API_BASE_URL || 'https://api.groq.com/openai/v1/chat/completions';

export const LLM_API_KEY = process.env.GROQ_API_KEY || '';

export const GROQ_MODEL_BY_PERSONA: Record<string, string> = {
    'taipei4': 'openai/gpt-oss-120b',
    'taipei-3': 'openai/gpt-oss-120b',
    'majuli4': 'llama-3.3-70b-versatile',
    'suzhou4': 'openai/gpt-oss-20b',
};

export const LLM_DEFAULT_MODEL = 'llama-3.3-70b-versatile';

// ─── OpenCode Zen ────────────────────────────────────────────────────────────
// OpenAI-compatible gateway. The four workspace personas route here.
export const OPENCODE_ZEN_API_URL =
    process.env.OPENCODE_ZEN_API_BASE_URL || 'https://opencode.ai/zen/v1/chat/completions';

export const OPENCODE_ZEN_API_KEY = process.env.OPENCODE_ZEN_API_KEY || '';

// Astro 5 flagship model (env-overridable).
export const OPENCODE_ZEN_MODEL = process.env.OPENCODE_ZEN_MODEL || 'glm-5.2';

// ─── Deep Code pipeline (Astro 5 Code) ───────────────────────────────────────
// The 'astro-5-code' persona is not a single model — it's a server-side
// multi-stage pipeline run by /api/sonoma:
//   1. THINK — the thinker model streams internal chain-of-thought
//   2. ROUTE — the router model decides "keep thinking" vs "start coding"
//      (loops back to THINK until it says code)
//   3. CODE  — the coder model writes the final answer
// The real upstream model ids below are server-only and are never surfaced
// to the frontend, which only ever sees the persona name "Astro 5 Code".
// (This module must never be imported from client code for that reason —
// the persona id itself lives in the client-safe models.ts.)
export { DEEP_CODE_PERSONA };
export const DEEP_CODE_THINKER_MODEL = process.env.DEEP_CODE_THINKER_MODEL || 'glm-5.2';
export const DEEP_CODE_ROUTER_MODEL = process.env.DEEP_CODE_ROUTER_MODEL || 'big-pickle';
export const DEEP_CODE_CODER_MODEL = process.env.DEEP_CODE_CODER_MODEL || 'kimi-k2.7-code';

// Per-persona OpenCode Zen model routing.
export const OPENCODE_ZEN_MODEL_BY_PERSONA: Record<string, string> = {
    'astro-5': OPENCODE_ZEN_MODEL,
    // Deep Code persona — the pipeline is orchestrated in /api/sonoma; this
    // mapping is the fallback for auxiliary single-shot calls (e.g. tools).
    [DEEP_CODE_PERSONA]: DEEP_CODE_CODER_MODEL,
    'taipei4': OPENCODE_ZEN_MODEL,        // Taipei
    'taipei-3': OPENCODE_ZEN_MODEL,
    'majuli4': 'claude-sonnet-4-6',     // Majuli
    'suzhou4': 'nemotron-3-ultra-free', // Suzhou
    // Legacy personas — opt-in via the "Legacy Models" setting.
    'legacy-synthara-5.2-plus': 'kimi-k2.5',    // Synthara 5.2 Plus
    'legacy-taipei-3': 'glm-5',                 // Taipei 3
    'legacy-majuli-3': 'minimax-m2.5',          // Majuli 3
    'legacy-suzhou-3': 'nemo-3-ultra-free',     // Suzhou 3
};

// Persona ids served by OpenCode Zen rather than Groq.
const OPENCODE_ZEN_PERSONAS = new Set(Object.keys(OPENCODE_ZEN_MODEL_BY_PERSONA));

export function resolveOpenCodeZenModel(personaId: string | undefined): string {
    if (!personaId) return OPENCODE_ZEN_MODEL;
    return OPENCODE_ZEN_MODEL_BY_PERSONA[personaId] || OPENCODE_ZEN_MODEL;
}

export type LLMProvider = 'groq' | 'opencode-zen' | 'custom';

export interface BackendTarget {
    provider: LLMProvider;
    url: string;
    apiKey: string;
    model: string;
    // For 'custom' targets: the env var named in src/config.md that should
    // hold the API key — lets error messages point at the right variable.
    keyEnvName?: string;
}

export function resolveGroqModel(personaId: string | undefined): string {
    if (!personaId) return LLM_DEFAULT_MODEL;
    return GROQ_MODEL_BY_PERSONA[personaId] || LLM_DEFAULT_MODEL;
}

// Resolve which provider + endpoint + upstream model a persona should use.
// The four workspace personas → OpenCode Zen; any other id → Groq fallback.
//
// Returns the target even when the provider's key is unset (apiKey: ''): callers
// are expected to check `apiKey` and fail LOUD gracefully — e.g. /api/sonoma
// returns a clear 503 naming the missing env var rather than letting an empty
// key leak through as a confusing upstream 401. `envVarFor()` gives callers the
// exact variable name to surface. The prebuild gate (scripts/check-env.mjs)
// already requires at least one inference key in production.
export function envVarFor(provider: LLMProvider): string {
    if (provider === 'custom') return 'the `api key env` variable named in src/config.md';
    return provider === 'opencode-zen' ? 'OPENCODE_ZEN_API_KEY' : 'GROQ_API_KEY';
}

// Custom backend entries from src/config.md (edited by hand or via ./setup.sh).
// An entry whose id matches a built-in persona reroutes that persona; a new id
// defines a brand-new model. Config problems degrade to null (built-in routing)
// rather than throwing — the config file must never take chat down.
function resolveCustomBackend(personaId: string): BackendTarget | null {
    try {
        const entry = loadAppConfig().models.find((m) => m.id === personaId && m.enabled !== false);
        if (!entry?.endpoint) return null;
        const keyEnv = entry.keyEnv || '';
        return {
            provider: 'custom',
            url: entry.endpoint,
            apiKey: (keyEnv && process.env[keyEnv]) || entry.key || '',
            model: entry.model || personaId,
            keyEnvName: keyEnv || undefined,
        };
    } catch {
        return null;
    }
}

export function resolveBackend(personaId: string | undefined): BackendTarget {
    if (personaId) {
        const custom = resolveCustomBackend(personaId);
        if (custom) return custom;
        if (OPENCODE_ZEN_PERSONAS.has(personaId)) {
            return {
                provider: 'opencode-zen',
                url: OPENCODE_ZEN_API_URL,
                apiKey: OPENCODE_ZEN_API_KEY,
                model: resolveOpenCodeZenModel(personaId),
            };
        }
    }
    return {
        provider: 'groq',
        url: LLM_API_URL,
        apiKey: LLM_API_KEY,
        model: resolveGroqModel(personaId),
    };
}
