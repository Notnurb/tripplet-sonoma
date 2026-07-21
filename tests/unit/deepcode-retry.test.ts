import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runDeepCodePipeline } from '@/lib/sonoma/deepcode';

// The pipeline fires many sequential OpenCode Zen calls per request, so a
// transient upstream 429 mid-pipeline is routine. These tests drive the REAL
// pipeline against a stubbed fetch to prove a 429 heals via retry instead of
// surfacing "Deep pipeline stage failed (429)" to the user.

function sseResponse(deltas: string[]): Response {
    const body = deltas
        .map((d) => `data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}\n\n`)
        .join('') + 'data: [DONE]\n\n';
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

// Retry-After: 0 keeps the backoff instant so the test never sleeps.
const rateLimited = () => new Response('slow down', { status: 429, headers: { 'Retry-After': '0' } });

const messages = [{ role: 'user', content: 'write hello world' }];

describe('DeepCode pipeline upstream resilience', () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        fetchMock.mockReset();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('retries a 429 on the final coder stage instead of failing the pipeline', async () => {
        // Think stage: non-retryable 400 → pipeline degrades straight to coding.
        // Coder stage: 429 once, then a healthy stream.
        fetchMock
            .mockResolvedValueOnce(new Response('bad', { status: 400 }))
            .mockResolvedValueOnce(rateLimited())
            .mockResolvedValueOnce(sseResponse(['hello', ' world']));

        const events: Array<Record<string, unknown>> = [];
        await runDeepCodePipeline((e) => events.push(e), messages, 'low');

        const content = events.filter((e) => e.type === 'content').map((e) => e.delta).join('');
        expect(content).toBe('hello world');
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('surfaces a friendly capacity message when the 429 never clears', async () => {
        fetchMock
            .mockResolvedValueOnce(new Response('bad', { status: 400 }))
            .mockResolvedValue(rateLimited());

        await expect(runDeepCodePipeline(() => {}, messages, 'low')).rejects.toThrow(/over capacity/);
        // 1 think attempt + MAX_ATTEMPTS coder attempts, nothing beyond.
        expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it('does not retry non-retryable statuses', async () => {
        fetchMock
            .mockResolvedValueOnce(new Response('bad', { status: 400 }))
            .mockResolvedValueOnce(new Response('nope', { status: 401 }));

        await expect(runDeepCodePipeline(() => {}, messages, 'low')).rejects.toThrow(/failed \(401\)/);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
