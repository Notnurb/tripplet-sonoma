import { describe, it, expect } from 'vitest';
import { makeThinkSplitter } from '@/lib/ai/thinkSplitter';

// Feed a full message through in chunks of a given size and collect the split.
function runChunks(text: string, size: number) {
    const s = makeThinkSplitter();
    let thinking = '';
    let content = '';
    for (let i = 0; i < text.length; i += size) {
        const r = s.feed(text.slice(i, i + size));
        thinking += r.thinking;
        content += r.content;
    }
    const f = s.flush();
    return { thinking: thinking + f.thinking, content: content + f.content };
}

describe('makeThinkSplitter', () => {
    const message = '<think>plan the fix</think>Here is the answer.';

    it('splits a well-formed message', () => {
        const r = runChunks(message, message.length);
        expect(r.thinking).toBe('plan the fix');
        expect(r.content).toBe('Here is the answer.');
    });

    it('is invariant to chunk size (tags split mid-delta)', () => {
        for (const size of [1, 2, 3, 5, 7, 11]) {
            const r = runChunks(message, size);
            expect(r.thinking, `chunk size ${size}`).toBe('plan the fix');
            expect(r.content, `chunk size ${size}`).toBe('Here is the answer.');
        }
    });

    it('passes through messages with no think block', () => {
        const r = runChunks('Just an answer, no reasoning.', 4);
        expect(r.thinking).toBe('');
        expect(r.content).toBe('Just an answer, no reasoning.');
    });

    it('treats an unclosed think block as thinking at flush', () => {
        const r = runChunks('<think>never closed', 3);
        expect(r.thinking).toBe('never closed');
        expect(r.content).toBe('');
    });

    it('emits content before the think block too', () => {
        const r = runChunks('preface <think>t</think>body', 2);
        expect(r.thinking).toBe('t');
        expect(r.content).toBe('preface body');
    });

    it('does not swallow a partial tag that never completes', () => {
        const r = runChunks('answer ends with <thin', 5);
        expect(r.content).toBe('answer ends with <thin');
    });
});
