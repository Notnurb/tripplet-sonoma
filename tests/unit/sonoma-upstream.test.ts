// streamOnce: the upstream SSE parser for the Sonoma tool loop. Tests drive it
// with a mocked fetch returning a ReadableStream of SSE lines and assert the
// emitted event sequence — content/thinking deltas, cross-chunk tool-call
// accumulation, malformed-line tolerance, and the provider-secrecy error path.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { streamOnce, type UpstreamEvent } from '@/lib/sonoma/upstream';
import type { BackendTarget } from '@/lib/ai/llm';

const TARGET: BackendTarget = {
    provider: 'opencode-zen',
    url: 'https://upstream.example/v1/chat/completions',
    model: 'test-model',
    apiKey: 'k',
} as BackendTarget;

function sseResponse(chunks: string[], init: ResponseInit = {}): Response {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
        start(controller) {
            for (const c of chunks) controller.enqueue(enc.encode(c));
            controller.close();
        },
    });
    return new Response(body, { status: 200, ...init });
}

function chunk(obj: unknown): string {
    return `data: ${JSON.stringify(obj)}\n`;
}

async function collect(gen: AsyncGenerator<UpstreamEvent>): Promise<UpstreamEvent[]> {
    const events: UpstreamEvent[] = [];
    for await (const e of gen) events.push(e);
    return events;
}

const fetchMock = vi.fn();

beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
    vi.unstubAllGlobals();
});

describe('streamOnce', () => {
    it('emits content and thinking deltas in stream order', async () => {
        fetchMock.mockResolvedValue(sseResponse([
            chunk({ choices: [{ delta: { reasoning_content: 'hmm ' } }] }),
            chunk({ choices: [{ delta: { content: 'Hello' } }] }),
            chunk({ choices: [{ delta: { content: ' world' } }] }),
            'data: [DONE]\n',
        ]));
        const events = await collect(streamOnce([], false, 'chat', TARGET, []));
        expect(events).toEqual([
            { type: 'thinking', delta: 'hmm ' },
            { type: 'content', delta: 'Hello' },
            { type: 'content', delta: ' world' },
        ]);
    });

    it('accumulates tool-call argument fragments across chunks per index', async () => {
        fetchMock.mockResolvedValue(sseResponse([
            chunk({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'web_search', arguments: '{"que' } }] } }] }),
            chunk({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ry":"cats"}' } }] } }] }),
            'data: [DONE]\n',
        ]));
        const events = await collect(streamOnce([], false, 'chat', TARGET, []));
        expect(events).toEqual([
            { type: 'tool_call', id: 'call_1', name: 'web_search', args: { query: 'cats' } },
        ]);
    });

    it('a tool call with unparseable accumulated args falls back to {}', async () => {
        fetchMock.mockResolvedValue(sseResponse([
            chunk({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c', function: { name: 'run_python', arguments: '{broken' } }] } }] }),
        ]));
        const [ev] = await collect(streamOnce([], false, 'chat', TARGET, []));
        expect(ev).toMatchObject({ type: 'tool_call', name: 'run_python', args: {} });
    });

    it('skips malformed JSON lines and nameless tool accumulations', async () => {
        fetchMock.mockResolvedValue(sseResponse([
            'data: {not json}\n',
            chunk({ choices: [{ delta: { tool_calls: [{ index: 3, id: 'ghost', function: { arguments: '{}' } }] } }] }), // no name → dropped
            chunk({ choices: [{ delta: { content: 'ok' } }] }),
        ]));
        const events = await collect(streamOnce([], false, 'chat', TARGET, []));
        expect(events).toEqual([{ type: 'content', delta: 'ok' }]);
    });

    it('handles SSE frames split mid-line across network chunks', async () => {
        const full = chunk({ choices: [{ delta: { content: 'split-safe' } }] });
        fetchMock.mockResolvedValue(sseResponse([full.slice(0, 12), full.slice(12)]));
        const events = await collect(streamOnce([], false, 'chat', TARGET, []));
        expect(events).toEqual([{ type: 'content', delta: 'split-safe' }]);
    });

    it('non-OK upstream throws a generic message that never leaks provider detail', async () => {
        fetchMock.mockResolvedValue(new Response('secret-provider-slug model x-123 not found', { status: 429 }));
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const gen = streamOnce([], false, 'chat', TARGET, []);
        await expect(collect(gen)).rejects.toThrow('The model backend returned an error (429). Please try again.');
        // The raw upstream body goes to the server log only.
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('secret-provider-slug'));
        consoleSpy.mockRestore();
    });

    it('code workspace lowers temperature and raises max_tokens', async () => {
        fetchMock.mockResolvedValue(sseResponse(['data: [DONE]\n']));
        await collect(streamOnce([], false, 'code', TARGET, []));
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.temperature).toBe(0.3);
        expect(body.max_tokens).toBe(8192);

        fetchMock.mockResolvedValue(sseResponse(['data: [DONE]\n']));
        await collect(streamOnce([], false, 'chat', TARGET, []));
        const body2 = JSON.parse(fetchMock.mock.calls[1][1].body);
        expect(body2.temperature).toBe(0.7);
        expect(body2.max_tokens).toBeUndefined();
    });
});
