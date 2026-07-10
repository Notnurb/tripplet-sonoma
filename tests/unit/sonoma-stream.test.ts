import { describe, it, expect } from 'vitest';
import { readSonomaStream, mergeActivity, finishBashActivity } from '@/lib/sonoma/stream';
import type { SonomaActivity } from '@/components/Sonoma/Message';

function sseBody(events: Array<Record<string, unknown>>, chunkSize = 7): ReadableStream<Uint8Array> {
    const text = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
    const bytes = new TextEncoder().encode(text);
    return new ReadableStream({
        start(controller) {
            for (let i = 0; i < bytes.length; i += chunkSize) {
                controller.enqueue(bytes.slice(i, i + chunkSize));
            }
            controller.close();
        },
    });
}

describe('readSonomaStream', () => {
    it('dispatches events split across arbitrary chunk boundaries', async () => {
        const got: string[] = [];
        await readSonomaStream(
            sseBody([
                { type: 'thinking', delta: 'hm' },
                { type: 'content', delta: 'Hello' },
                { type: 'activity', tool: 'web_search', id: 't1', status: 'running', args: { query: 'q' } },
                { type: 'error', message: 'boom' },
                { type: 'done' },
            ]),
            {
                onThinking: (d) => got.push(`think:${d}`),
                onContent: (d) => got.push(`content:${d}`),
                onActivity: (ev) => got.push(`activity:${ev.tool}:${ev.status}`),
                onError: (m) => got.push(`error:${m}`),
            },
        );
        expect(got).toEqual(['think:hm', 'content:Hello', 'activity:web_search:running', 'error:boom']);
    });

    it('skips malformed lines without dying', async () => {
        const body = new ReadableStream<Uint8Array>({
            start(c) {
                c.enqueue(new TextEncoder().encode('data: {not json}\n\ndata: {"type":"content","delta":"ok"}\n\n'));
                c.close();
            },
        });
        const got: string[] = [];
        await readSonomaStream(body, {
            onThinking: () => {},
            onContent: (d) => got.push(d),
            onActivity: () => {},
            onError: () => {},
        });
        expect(got).toEqual(['ok']);
    });
});

describe('mergeActivity', () => {
    const running = { type: 'activity', tool: 'run_python', id: 'a1', status: 'running' as const, args: { code: '1' } };

    it('adds a new running card with a start stamp', () => {
        const list = mergeActivity([], running);
        expect(list).toHaveLength(1);
        expect(list[0].status).toBe('running');
        expect(list[0].startedAt).toBeTypeOf('number');
    });

    it('completes a card and records elapsed time', () => {
        const list = mergeActivity([], running);
        list[0] = { ...list[0], startedAt: Date.now() - 500 };
        const done = mergeActivity(list, { ...running, status: 'done', result: { output: '1' } });
        expect(done[0].status).toBe('done');
        expect(done[0].result).toEqual({ output: '1' });
        expect(done[0].elapsedMs).toBeGreaterThanOrEqual(400);
    });

    it('pins run_bash to running and ignores the server placeholder result', () => {
        const ev = { type: 'activity', tool: 'run_bash', id: 'b1', status: 'done' as const, args: { command: 'ls' }, result: { note: 'placeholder' } };
        const list = mergeActivity([], ev);
        expect(list[0].status).toBe('running');
        expect(list[0].result).toBeUndefined();
    });
});

describe('finishBashActivity', () => {
    it('marks the card done with the VM output and elapsed time', () => {
        const list: SonomaActivity[] = [
            { id: 'b1', tool: 'run_bash', args: {}, status: 'running', startedAt: Date.now() - 300 },
        ];
        const done = finishBashActivity(list, 'b1', 'real stdout');
        expect(done[0].status).toBe('done');
        expect(done[0].result).toEqual({ output: 'real stdout' });
        expect(done[0].elapsedMs).toBeGreaterThanOrEqual(200);
    });
});
