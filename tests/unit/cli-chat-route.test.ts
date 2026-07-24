import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * /api/cli/chat is the Astrocode CLI's inference endpoint. Two things about it
 * are easy to get wrong and expensive to get wrong in production:
 *
 *  1. Metering. One agentic turn must cost ONE message however many tool rounds
 *     it takes, so a request that continues a turn (last message role 'tool')
 *     must not consume the budget a second time — and a request that starts one
 *     must always consume it.
 *  2. Failure shape. An upstream error has to arrive as an SSE `error` event.
 *     The bodyless 500 is the exact failure mode that took the OAuth routes
 *     down, and a CLI cannot show the user anything useful from one.
 */

const upstreamEvents = vi.hoisted(() => ({
    current: [] as Array<Record<string, unknown>>,
    throws: null as Error | null,
}));

const usage = vi.hoisted(() => ({
    allowed: true as boolean,
    checks: 0,
    records: 0,
    finalized: [] as Array<{ id: string; chars: number }>,
}));

const bearer = vi.hoisted(() => ({ user: { userId: 'u1', email: 'u@x.com', scope: 'mcp' } as unknown }));

vi.mock('@/lib/mcp/bearer', () => ({
    resolveBearerUser: vi.fn(async () => bearer.user),
    bearerUnauthorized: vi.fn(() => new Response(
        JSON.stringify({ error: 'invalid_token', error_description: 'Missing or invalid access token.' }),
        { status: 401, headers: { 'WWW-Authenticate': 'Bearer resource_metadata="http://localhost/.well-known/oauth-protected-resource"' } },
    )),
}));

vi.mock('@/lib/usage/tracker', () => ({
    checkUsageAllowance: vi.fn(async () => {
        usage.checks++;
        return usage.allowed
            ? { allowed: true }
            : { allowed: false, scope: '5-hour', resetsAt: '2026-01-01T00:00:00.000Z', message: 'out of messages' };
    }),
    usageLimitResponse: vi.fn((block: { message: string; scope: string; resetsAt: string }) => new Response(
        JSON.stringify({ error: block.message, code: 'usage_limit', scope: block.scope, resetsAt: block.resetsAt }),
        { status: 429, headers: { 'Content-Type': 'application/json' } },
    )),
    recordUsage: vi.fn(async () => { usage.records++; return 'rec_1'; }),
    finalizeUsage: vi.fn(async (id: string, chars: number) => { usage.finalized.push({ id, chars }); }),
}));

const backend = vi.hoisted(() => ({ apiKey: 'k' as string }));

vi.mock('@/lib/ai/llm', () => ({
    DEEP_CODE_PERSONA: 'astro-5-code',
    envVarFor: () => 'OPENCODE_ZEN_API_KEY',
    resolveBackend: vi.fn(() => ({
        provider: 'opencode-zen',
        url: 'https://example.test/v1/chat/completions',
        apiKey: backend.apiKey,
        model: 'test-model',
        keyEnvName: 'OPENCODE_ZEN_API_KEY',
    })),
}));

vi.mock('@/lib/sonoma/upstream', () => ({
    streamOnce: vi.fn(async function* () {
        if (upstreamEvents.throws) throw upstreamEvents.throws;
        for (const ev of upstreamEvents.current) yield ev;
    }),
}));

import { POST } from '@/app/api/cli/chat/route';

type Msg = { role: string; content: string; tool_call_id?: string };

function req(body: unknown, { auth = true }: { auth?: boolean } = {}): NextRequest {
    return new NextRequest('http://localhost/api/cli/chat', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-real-ip': `10.0.0.${Math.floor(Math.random() * 200) + 1}`,
            ...(auth ? { authorization: 'Bearer tok' } : {}),
        },
        body: JSON.stringify(body),
    });
}

const userTurn = (content = 'hello'): Msg[] => [{ role: 'user', content }];
const continuation = (): Msg[] => [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: '' },
    { role: 'tool', content: 'file contents', tool_call_id: 'c1' },
];

/** Collect an SSE body into the objects it carries. */
async function events(res: Response): Promise<Array<Record<string, unknown>>> {
    const text = await res.text();
    return text
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => JSON.parse(l.slice(5).trim()));
}

beforeEach(() => {
    upstreamEvents.current = [{ type: 'content', delta: 'hi' }];
    upstreamEvents.throws = null;
    usage.allowed = true;
    usage.checks = 0;
    usage.records = 0;
    usage.finalized = [];
    bearer.user = { userId: 'u1', email: 'u@x.com', scope: 'mcp' };
    backend.apiKey = 'k';
});

describe('POST /api/cli/chat — authentication', () => {
    it('401s without a resolvable bearer, and says where to authenticate', async () => {
        bearer.user = null;
        const res = await POST(req({ messages: userTurn() }));
        expect(res.status).toBe(401);
        expect(res.headers.get('WWW-Authenticate')).toContain('oauth-protected-resource');
    });

    it('never reaches inference when unauthenticated', async () => {
        bearer.user = null;
        await POST(req({ messages: userTurn() }));
        expect(usage.records).toBe(0);
    });
});

describe('POST /api/cli/chat — request validation', () => {
    it.each([
        ['no messages', { messages: [] }],
        ['not an array', { messages: 'hi' }],
        ['bad role', { messages: [{ role: 'root', content: 'x' }] }],
        ['non-string content', { messages: [{ role: 'user', content: 42 }] }],
        ['tool message without an id', { messages: [{ role: 'tool', content: 'x' }] }],
        ['system only', { messages: [{ role: 'system', content: 'x' }] }],
        ['too many messages', { messages: Array.from({ length: 121 }, () => ({ role: 'user', content: 'x' })) }],
    ])('400s on %s', async (_label, body) => {
        const res = await POST(req(body));
        expect(res.status).toBe(400);
    });

    it('400s on an oversized message rather than forwarding it', async () => {
        const res = await POST(req({ messages: [{ role: 'user', content: 'x'.repeat(64_001) }] }));
        expect(res.status).toBe(400);
        expect(usage.records).toBe(0);
    });
});

describe('POST /api/cli/chat — usage metering', () => {
    it('meters a new turn (last message is from the user)', async () => {
        const res = await POST(req({ messages: userTurn() }));
        await events(res);
        expect(usage.checks).toBe(1);
        expect(usage.records).toBe(1);
    });

    it('does NOT meter a continuation (last message is a tool result)', async () => {
        const res = await POST(req({ messages: continuation() }));
        await events(res);
        expect(usage.checks).toBe(0);
        expect(usage.records).toBe(0);
    });

    it('429s a user over their limit, with a code the CLI can render', async () => {
        usage.allowed = false;
        const res = await POST(req({ messages: userTurn() }));
        expect(res.status).toBe(429);
        const body = await res.json();
        expect(body.code).toBe('usage_limit');
        expect(body.resetsAt).toBeTruthy();
        expect(usage.records).toBe(0);
    });

    it('lets a turn already in flight finish even when the budget is gone', async () => {
        usage.allowed = false;
        const res = await POST(req({ messages: continuation() }));
        expect(res.status).toBe(200);
    });

    it('finalizes the record with the characters actually streamed', async () => {
        upstreamEvents.current = [
            { type: 'content', delta: 'abc' },
            { type: 'content', delta: 'de' },
        ];
        const res = await POST(req({ messages: userTurn() }));
        await events(res);
        expect(usage.finalized).toEqual([{ id: 'rec_1', chars: 5 }]);
    });

    it('does not charge for a request an unconfigured backend rejects', async () => {
        backend.apiKey = '';
        const res = await POST(req({ messages: userTurn() }));
        expect(res.status).toBe(503);
        expect(usage.records).toBe(0);
    });
});

describe('POST /api/cli/chat — streaming', () => {
    it('streams thinking, content and tool_call, then done', async () => {
        upstreamEvents.current = [
            { type: 'thinking', delta: 'pondering' },
            { type: 'content', delta: 'Here.' },
            { type: 'tool_call', id: 'c1', name: 'read', args: { path: 'a.js' } },
        ];
        const res = await POST(req({ messages: userTurn() }));
        expect(res.headers.get('Content-Type')).toBe('text/event-stream');
        expect(await events(res)).toEqual([
            { type: 'thinking', delta: 'pondering' },
            { type: 'content', delta: 'Here.' },
            { type: 'tool_call', id: 'c1', name: 'read', args: { path: 'a.js' } },
            { type: 'done', finish: 'tool_calls' },
        ]);
    });

    it('reports finish "stop" when the model just answered', async () => {
        const got = await events(await POST(req({ messages: userTurn() })));
        expect(got.at(-1)).toEqual({ type: 'done', finish: 'stop' });
    });

    it('splits an inline <think> block into thinking and content', async () => {
        upstreamEvents.current = [{ type: 'content', delta: '<think>quietly</think>out loud' }];
        const got = await events(await POST(req({ messages: userTurn() })));
        expect(got).toContainEqual({ type: 'thinking', delta: 'quietly' });
        expect(got).toContainEqual({ type: 'content', delta: 'out loud' });
    });

    it('turns an upstream failure into an SSE error, never a bodyless 500', async () => {
        upstreamEvents.throws = new Error('The model backend returned an error (502).');
        const res = await POST(req({ messages: userTurn() }));
        expect(res.status).toBe(200);
        const got = await events(res);
        expect(got[0]).toEqual({ type: 'error', message: 'The model backend returned an error (502).' });
        expect(got.at(-1)).toMatchObject({ type: 'done' });
    });

    it('still finalizes usage when the stream fails', async () => {
        upstreamEvents.throws = new Error('boom');
        await events(await POST(req({ messages: userTurn() })));
        expect(usage.finalized).toHaveLength(1);
    });
});
