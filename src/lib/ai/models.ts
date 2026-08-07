export interface Model {
    id: string;
    name: string;
    description: string;
    // Upstream model override — client-facing lists must leave this unset so
    // real provider model names never reach the browser bundle. Server routes
    // resolve upstream models from persona ids via src/lib/ai/llm.ts instead.
    apiModel?: string;
}

export type WorkspacePage = 'chat' | 'code' | 'agent';

// Persona id for the Deep Code pipeline flagship. Defined here (client-safe)
// and consumed by the server-side routing table in src/lib/ai/llm.ts.
export const DEEP_CODE_PERSONA = 'astro-5-code';

const BASE_MODELS: Model[] = [
    {
        id: 'astro-5',
        name: 'Astro 5',
        description: 'Flagship — top reasoning and range',
    },
    {
        id: 'taipei4',
        name: 'Taipei 4',
        description: 'Advanced reasoning and analysis',
    },
    {
        id: 'majuli4',
        name: 'Majuli 4',
        description: 'Fast and concise responses',
    },
    {
        id: 'suzhou4',
        name: 'Suzhou 4',
        description: 'Creative and detailed generation',
    },
];

// Older personas, hidden by default. Users opt back in via the
// "Legacy Models" toggle in Settings → General.
export const LEGACY_MODELS: Model[] = [
    {
        id: 'legacy-synthara-5.2-plus',
        name: 'Synthara 5.2 Plus',
        description: 'Legacy — expansive general knowledge',
    },
    {
        id: 'legacy-taipei-3',
        name: 'Taipei 3',
        description: 'Legacy — reasoning and analysis',
    },
    {
        id: 'legacy-majuli-3',
        name: 'Majuli 3',
        description: 'Legacy — fast and concise',
    },
    {
        id: 'legacy-suzhou-3',
        name: 'Suzhou 3',
        description: 'Legacy — creative generation',
    },
];

// Deep Code flagship — a multi-stage coding pipeline persona, only exposed on
// the code page when the DeepCode toggle is active. The upstream models that
// power it are resolved server-side and never shown in the UI.
export const DEEP_CODE_FLAGSHIP: Model = {
    id: DEEP_CODE_PERSONA,
    name: 'Astro 5 Code',
    description: 'Deepest coding — thinks it through, then builds',
};

// Custom models declared in src/config.md (entries with `show in picker: yes`).
// next.config.mjs injects them at startup as NEXT_PUBLIC_CUSTOM_MODELS — only
// id/name/description ever reach the client; endpoints and API keys stay
// server-side in src/lib/ai/llm.ts. Ids that shadow a built-in persona are
// dropped here (the override still applies to routing, the picker entry is
// already present).
function parseCustomModels(): Model[] {
    try {
        const parsed: unknown = JSON.parse(process.env.NEXT_PUBLIC_CUSTOM_MODELS || '[]');
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter((m): m is { id: string; name?: string; description?: string } =>
                !!m && typeof m.id === 'string' && m.id.length > 0)
            .map((m) => ({
                id: m.id,
                name: m.name || m.id,
                description: m.description || 'Custom model — src/config.md',
            }));
    } catch {
        return [];
    }
}

const builtInIds = new Set([...BASE_MODELS, DEEP_CODE_FLAGSHIP, ...LEGACY_MODELS].map((m) => m.id));
export const CUSTOM_MODELS: Model[] = parseCustomModels().filter((m) => !builtInIds.has(m.id));

export const MODELS: Model[] = [...BASE_MODELS, DEEP_CODE_FLAGSHIP, ...LEGACY_MODELS, ...CUSTOM_MODELS];

const WORKSPACE_MODEL_IDS = ['astro-5', 'taipei4', 'majuli4', 'suzhou4'];

const WORKSPACE_BASE: Model[] = [
    ...BASE_MODELS.filter((m) => WORKSPACE_MODEL_IDS.includes(m.id)),
    ...CUSTOM_MODELS,
];

export const CHAT_MODELS: Model[] = WORKSPACE_BASE;
export const CODE_MODELS: Model[] = WORKSPACE_BASE;
export const AGENT_MODELS: Model[] = WORKSPACE_BASE;

// DeepCode lineup: Astro 5 Code replaces the base flagship; the rest stay.
export const DEEP_CODE_MODELS: Model[] = [
    DEEP_CODE_FLAGSHIP,
    ...BASE_MODELS.filter((m) => ['taipei4', 'majuli4', 'suzhou4'].includes(m.id)),
    ...CUSTOM_MODELS,
];

export function modelsForPage(page: WorkspacePage, includeLegacy = false, deepCode = false): Model[] {
    // deepCode applies on the chat page too: conversation history always
    // reopens at /chat/[id], and a conversation saved on Astro 5 Code must
    // keep its lineup there instead of silently downgrading to the base
    // flagship. (deepCode only ever becomes true via the code-page toggle or
    // by hydrating such a conversation.)
    const base =
        page === 'agent' ? AGENT_MODELS
            : deepCode ? DEEP_CODE_MODELS
                : page === 'code' ? CODE_MODELS : CHAT_MODELS;
    return includeLegacy ? [...base, ...LEGACY_MODELS] : base;
}

export function getModel(id: string): Model {
    return MODELS.find((m) => m.id === id) || MODELS[0];
}
