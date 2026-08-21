import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MODELS, CHAT_MODELS, DEEP_CODE_MODELS, LEGACY_MODELS, DEEP_CODE_PERSONA, modelsForPage, getModel } from '@/lib/ai/models';

describe('model catalog integrity', () => {
    it('has unique ids across the full catalog', () => {
        const ids = MODELS.map((m) => m.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('never leaks upstream provider model names to client-facing lists', () => {
        // apiModel must stay unset on personas shipped to the browser — real
        // provider ids are resolved server-side only (src/lib/ai/llm.ts).
        for (const m of [...CHAT_MODELS, ...DEEP_CODE_MODELS, ...LEGACY_MODELS]) {
            expect(m.apiModel, `${m.id} leaks an upstream model name`).toBeUndefined();
        }
    });

    it('deep-code lineup is headlined by the pipeline persona', () => {
        expect(DEEP_CODE_MODELS[0].id).toBe(DEEP_CODE_PERSONA);
    });
});

describe('modelsForPage', () => {
    it('deepCode swaps the lineup on chat AND code pages (history reopens on /chat)', () => {
        expect(modelsForPage('chat', false, true)[0].id).toBe(DEEP_CODE_PERSONA);
        expect(modelsForPage('code', false, true)[0].id).toBe(DEEP_CODE_PERSONA);
    });

    it('legacy models only appear when requested', () => {
        const withoutLegacy = modelsForPage('chat', false, false).map((m) => m.id);
        const withLegacy = modelsForPage('chat', true, false).map((m) => m.id);
        for (const legacy of LEGACY_MODELS) {
            expect(withoutLegacy).not.toContain(legacy.id);
            expect(withLegacy).toContain(legacy.id);
        }
    });
});

describe('getModel', () => {
    it('resolves known ids and falls back to the flagship for unknown ones', () => {
        expect(getModel(DEEP_CODE_PERSONA).id).toBe(DEEP_CODE_PERSONA);
        expect(getModel('no-such-model')).toBe(MODELS[0]);
    });
});

/**
 * Custom picker models arrive as NEXT_PUBLIC_CUSTOM_MODELS — a JSON list that
 * next.config.mjs builds from src/config.md entries with `show in picker: yes`.
 * The env var is read at module load, so each case stubs then imports fresh.
 */
describe('custom models from src/config.md', () => {
    beforeEach(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    it('appends new ids to every workspace lineup', async () => {
        vi.stubEnv('NEXT_PUBLIC_CUSTOM_MODELS', JSON.stringify([
            { id: 'my-gpt', name: 'My GPT', description: 'Test model' },
        ]));
        const m = await import('@/lib/ai/models');
        for (const list of [m.CHAT_MODELS, m.CODE_MODELS, m.AGENT_MODELS, m.DEEP_CODE_MODELS, m.MODELS]) {
            expect(list.some((x) => x.id === 'my-gpt' && x.name === 'My GPT')).toBe(true);
        }
    });

    it('drops entries that shadow built-in ids and survives malformed JSON', async () => {
        vi.stubEnv('NEXT_PUBLIC_CUSTOM_MODELS', JSON.stringify([{ id: 'astro-5', name: 'Impostor' }]));
        const shadowed = await import('@/lib/ai/models');
        expect(shadowed.MODELS.filter((x) => x.id === 'astro-5')).toHaveLength(1);
        expect(shadowed.getModel('astro-5').name).toBe('Max');

        vi.resetModules();
        vi.stubEnv('NEXT_PUBLIC_CUSTOM_MODELS', 'not json at all {');
        const malformed = await import('@/lib/ai/models');
        expect(malformed.CUSTOM_MODELS).toHaveLength(0);
    });
});
