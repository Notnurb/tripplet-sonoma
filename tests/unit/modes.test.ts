import { describe, it, expect } from 'vitest';
import { MODE_CONFIGS, MODE_CONFLICTS, toggleMode, resolveSettings, detectSkillsFromMessage } from '@/lib/ai/modes';
import type { ChatMode } from '@/types';

describe('MODE_CONFIGS integrity', () => {
    it('every config id matches its key and has sane values', () => {
        for (const [key, cfg] of Object.entries(MODE_CONFIGS)) {
            expect(cfg.id).toBe(key);
            expect(cfg.temperature).toBeGreaterThanOrEqual(0);
            expect(cfg.temperature).toBeLessThanOrEqual(2);
            expect(cfg.label.length).toBeGreaterThan(0);
            expect(cfg.shimmerLabels.length).toBeGreaterThan(0);
        }
    });

    it('every conflict pair references real modes', () => {
        for (const [a, b] of MODE_CONFLICTS) {
            expect(MODE_CONFIGS[a], `unknown mode ${a}`).toBeDefined();
            expect(MODE_CONFIGS[b], `unknown mode ${b}`).toBeDefined();
            expect(a).not.toBe(b);
        }
    });
});

describe('toggleMode', () => {
    it('toggles a mode on and off', () => {
        expect(toggleMode([], 'think')).toEqual(['think']);
        expect(toggleMode(['think'], 'think')).toEqual([]);
    });

    it('turning a mode on evicts its conflicts (deep-research vs study)', () => {
        expect(toggleMode(['study'], 'deep-research')).toEqual(['deep-research']);
        expect(toggleMode(['deep-research'], 'study')).toEqual(['study']);
    });

    it('leaves unrelated modes untouched', () => {
        expect(toggleMode(['web-search', 'study'], 'deep-research')).toEqual(['web-search', 'deep-research']);
    });
});

describe('resolveSettings', () => {
    it('defaults with no active modes', () => {
        expect(resolveSettings([])).toEqual({ temperature: 0.7, enableWebSearch: false });
    });

    it('uses the LOWEST temperature and enables search if any mode wants it', () => {
        const modes: ChatMode[] = ['think', 'web-search']; // 0.3 vs 0.7
        const r = resolveSettings(modes);
        expect(r.temperature).toBe(Math.min(MODE_CONFIGS.think.temperature, MODE_CONFIGS['web-search'].temperature));
        expect(r.enableWebSearch).toBe(true);
    });

    it('takes the HIGHEST maxTokens among modes that set one', () => {
        const withTokens = Object.values(MODE_CONFIGS).filter((c) => c.maxTokens);
        if (withTokens.length >= 1) {
            const r = resolveSettings(withTokens.map((c) => c.id));
            expect(r.maxTokens).toBe(Math.max(...withTokens.map((c) => c.maxTokens!)));
        }
    });
});

describe('detectSkillsFromMessage', () => {
    it('ignores very short messages', () => {
        expect(detectSkillsFromMessage('hi')).toEqual([]);
    });

    it('detects code intent', () => {
        expect(detectSkillsFromMessage('can you debug this typescript function for me?')).toContain('code');
    });

    it('resolves conflicts when merging with existing modes', () => {
        // 'summarize' conflicts with deep-research; detection must not produce both.
        const merged = detectSkillsFromMessage('give me a tldr summary of this', ['deep-research']);
        expect(merged).toContain('summarize');
        expect(merged).not.toContain('deep-research');
    });

    it('never returns duplicate modes', () => {
        const merged = detectSkillsFromMessage('summarize the key points, tldr please', []);
        expect(new Set(merged).size).toBe(merged.length);
    });
});
