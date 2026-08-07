import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * resolveBackend() is the single source of truth for persona → inference-backend
 * routing. These tests pin (a) that every shipped persona routes to OpenCode Zen
 * and only unmapped ids fall back to Groq — matching the wiki docs — and (b) the
 * missing-key contract: it still resolves the provider (apiKey: '') so callers
 * can fail loud gracefully (e.g. /api/sonoma → 503), and envVarFor() names the
 * exact variable to surface.
 *
 * The provider keys are read at module load, so each case stubs env then
 * imports the module fresh via resetModules.
 */

describe('resolveBackend', () => {
    beforeEach(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    it('routes all four workspace personas (+ legacy tier) to OpenCode Zen', async () => {
        vi.stubEnv('OPENCODE_ZEN_API_KEY', 'zen_key');
        vi.stubEnv('GROQ_API_KEY', 'groq_key');
        const { resolveBackend, OPENCODE_ZEN_API_URL } = await import('@/lib/ai/llm');
        for (const id of ['astro-5', 'taipei4', 'majuli4', 'suzhou4', 'legacy-taipei-3']) {
            const t = resolveBackend(id);
            expect(t.provider).toBe('opencode-zen');
            expect(t.url).toBe(OPENCODE_ZEN_API_URL);
            expect(t.apiKey).toBe('zen_key');
            expect(t.model).toBeTruthy();
        }
    });

    it('maps personas to distinct upstream models', async () => {
        vi.stubEnv('OPENCODE_ZEN_API_KEY', 'zen_key');
        vi.stubEnv('GROQ_API_KEY', 'groq_key');
        const { resolveBackend } = await import('@/lib/ai/llm');
        expect(resolveBackend('majuli4').model).toBe('claude-sonnet-4-6');
        expect(resolveBackend('suzhou4').model).toBe('nemotron-3-ultra-free');
    });

    it('falls back to Groq only for an unmapped persona id', async () => {
        vi.stubEnv('OPENCODE_ZEN_API_KEY', 'zen_key');
        vi.stubEnv('GROQ_API_KEY', 'groq_key');
        const { resolveBackend, LLM_API_URL } = await import('@/lib/ai/llm');
        const t = resolveBackend('totally-unmapped-id');
        expect(t.provider).toBe('groq');
        expect(t.url).toBe(LLM_API_URL);
        expect(t.apiKey).toBe('groq_key');
    });

    it('resolves the provider with an empty apiKey when its key is missing (caller guards)', async () => {
        vi.stubEnv('OPENCODE_ZEN_API_KEY', '');
        vi.stubEnv('GROQ_API_KEY', 'groq_key');
        const { resolveBackend, envVarFor } = await import('@/lib/ai/llm');
        const t = resolveBackend('astro-5');
        expect(t.provider).toBe('opencode-zen');
        expect(t.apiKey).toBe('');
        expect(envVarFor(t.provider)).toBe('OPENCODE_ZEN_API_KEY');
    });

    it('envVarFor names the exact variable for the Groq fallback', async () => {
        vi.stubEnv('OPENCODE_ZEN_API_KEY', 'zen_key');
        vi.stubEnv('GROQ_API_KEY', '');
        const { resolveBackend, envVarFor } = await import('@/lib/ai/llm');
        const t = resolveBackend('unmapped-id');
        expect(t.provider).toBe('groq');
        expect(t.apiKey).toBe('');
        expect(envVarFor(t.provider)).toBe('GROQ_API_KEY');
    });
});

/**
 * Custom model backends declared in src/config.md take precedence over the
 * built-in provider tables: a config id matching a built-in persona reroutes
 * it, a new id defines a new backend, and disabled entries are invisible.
 * The API key comes from the env var the entry names (literal `key` is the
 * fallback), and keyEnvName rides along so the /api/sonoma 503 can name it.
 */
describe('resolveBackend — src/config.md custom entries', () => {
    const mockConfig = (models: object[]) => {
        vi.doMock('@/lib/config-md.mjs', () => ({
            loadAppConfig: () => ({
                app: { name: 'Test', tagline: '', description: '', port: 3000 },
                models,
            }),
        }));
    };

    beforeEach(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    afterEach(() => {
        vi.doUnmock('@/lib/config-md.mjs');
    });

    it('routes a new config id to its endpoint with the named env key', async () => {
        vi.stubEnv('MY_GPT_API_KEY', 'custom_key');
        mockConfig([{
            id: 'my-gpt',
            endpoint: 'http://localhost:9999/v1/chat/completions',
            model: 'my-upstream',
            keyEnv: 'MY_GPT_API_KEY',
        }]);
        const { resolveBackend } = await import('@/lib/ai/llm');
        const t = resolveBackend('my-gpt');
        expect(t.provider).toBe('custom');
        expect(t.url).toBe('http://localhost:9999/v1/chat/completions');
        expect(t.model).toBe('my-upstream');
        expect(t.apiKey).toBe('custom_key');
        expect(t.keyEnvName).toBe('MY_GPT_API_KEY');
    });

    it('overrides a built-in persona when the config id matches', async () => {
        vi.stubEnv('OPENCODE_ZEN_API_KEY', 'zen_key');
        mockConfig([{ id: 'astro-5', endpoint: 'https://my.gateway/v1/chat/completions', model: 'better-astro' }]);
        const { resolveBackend } = await import('@/lib/ai/llm');
        const t = resolveBackend('astro-5');
        expect(t.provider).toBe('custom');
        expect(t.url).toBe('https://my.gateway/v1/chat/completions');
        expect(t.model).toBe('better-astro');
    });

    it('ignores disabled entries and falls back to built-in routing', async () => {
        vi.stubEnv('OPENCODE_ZEN_API_KEY', 'zen_key');
        mockConfig([{ id: 'astro-5', endpoint: 'https://my.gateway/v1', enabled: false }]);
        const { resolveBackend } = await import('@/lib/ai/llm');
        expect(resolveBackend('astro-5').provider).toBe('opencode-zen');
    });

    it('uses the literal key only when the named env var is unset', async () => {
        mockConfig([{
            id: 'my-gpt',
            endpoint: 'http://localhost:9999/v1/chat/completions',
            keyEnv: 'UNSET_VAR_FOR_TEST',
            key: 'literal-fallback',
        }]);
        const { resolveBackend } = await import('@/lib/ai/llm');
        expect(resolveBackend('my-gpt').apiKey).toBe('literal-fallback');
    });
});
