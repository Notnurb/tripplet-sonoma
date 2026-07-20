import { describe, it, expect } from 'vitest';
import { __parseExtractionForTests as parseExtraction } from '@/lib/memory/learner';

describe('memory learner extraction parsing', () => {
    it('parses a clean JSON payload', () => {
        const out = parseExtraction('{"memories": [{"content": "Prefers TypeScript", "tags": ["typescript"]}]}');
        expect(out).toEqual([{ content: 'Prefers TypeScript', tags: ['typescript'] }]);
    });

    it('tolerates a fenced JSON block', () => {
        const out = parseExtraction('```json\n{"memories": [{"content": "Works on a chess bot", "tags": ["chess", "project"]}]}\n```');
        expect(out).toHaveLength(1);
        expect(out[0].content).toBe('Works on a chess bot');
    });

    it('returns empty on junk, empty lists, and malformed entries', () => {
        expect(parseExtraction('not json at all')).toEqual([]);
        expect(parseExtraction('{"memories": []}')).toEqual([]);
        expect(parseExtraction('{"memories": [{"tags": ["no-content"]}, {"content": 42}]}')).toEqual([]);
        expect(parseExtraction('{"something": "else"}')).toEqual([]);
    });

    it('caps count, content length, and tags', () => {
        const mems = Array.from({ length: 6 }, (_, i) => ({
            content: `fact ${i} ` + 'x'.repeat(500),
            tags: ['a', 'b', 'c', 'd', 'e'],
        }));
        const out = parseExtraction(JSON.stringify({ memories: mems }));
        expect(out).toHaveLength(3);
        expect(out[0].content.length).toBeLessThanOrEqual(300);
        expect(out[0].tags).toHaveLength(3);
    });

    it('drops non-string tags and lowercases the rest', () => {
        const out = parseExtraction('{"memories": [{"content": "Likes Rust", "tags": ["RUST", 7, null]}]}');
        expect(out[0].tags).toEqual(['rust']);
    });
});
