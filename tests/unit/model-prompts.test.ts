import { describe, it, expect } from 'vitest';
import { MODEL_SYSTEM_PROMPTS, getModelSystemPrompt } from '@/lib/ai/model-prompts';
import { CHAT_MODELS, DEEP_CODE_PERSONA } from '@/lib/ai/models';

describe('persona prompt catalog', () => {
    it('every prompt is substantial and identity-bearing', () => {
        for (const [id, prompt] of Object.entries(MODEL_SYSTEM_PROMPTS)) {
            expect(prompt.length, `${id} prompt too short`).toBeGreaterThan(200);
            expect(prompt).toContain('Tripplet');
        }
    });

    it('every chat-page persona has a dedicated prompt (no silent identity fallback)', () => {
        for (const m of CHAT_MODELS) {
            expect(MODEL_SYSTEM_PROMPTS[m.id], `${m.id} missing persona prompt`).toBeDefined();
        }
    });

    it('the DeepCode persona prompt enforces pipeline secrecy', () => {
        const p = MODEL_SYSTEM_PROMPTS[DEEP_CODE_PERSONA];
        expect(p).toContain('never discuss your internal architecture');
    });

    it('unknown/missing ids fall back to the flagship voice', () => {
        expect(getModelSystemPrompt(undefined)).toBe(MODEL_SYSTEM_PROMPTS['astro-5']);
        expect(getModelSystemPrompt('made-up-model')).toBe(MODEL_SYSTEM_PROMPTS['astro-5']);
    });

    it('no persona prompt leaks an upstream provider name', () => {
        for (const [id, prompt] of Object.entries(MODEL_SYSTEM_PROMPTS)) {
            expect(prompt, `${id} leaks a provider`).not.toMatch(/groq|llama|glm|opencode|x\.ai|openai|anthropic/i);
        }
    });
});
