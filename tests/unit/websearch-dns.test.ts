// DNS-rebinding guard for fetchPageText: a public-LOOKING hostname whose DNS
// answer is a private address must be blocked before any connect. The plain
// string checks live in sonoma-modules.test.ts; this file covers the resolver
// layer with a mocked node:dns/promises.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const lookup = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', () => ({ lookup: (...a: unknown[]) => lookup(...a) }));

// fetchPageText now connects DIRECTLY to the validated IP via node:https (the
// pinned-connect SSRF fix) — mock it so the success paths don't hit the wire.
const httpsRequest = vi.hoisted(() => vi.fn());
vi.mock('node:https', () => ({ request: (...a: unknown[]) => httpsRequest(...a) }));

import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { fetchPageText } from '@/lib/ai/websearch';

function fakeResponse(status: number, body: string, headers: Record<string, string> = {}) {
    const stream = Readable.from([body]);
    (stream as unknown as { statusCode: number }).statusCode = status;
    (stream as unknown as { headers: Record<string, string> }).headers = headers;
    return stream;
}

function fakeReq() {
    const req = new EventEmitter();
    (req as unknown as { end: () => void }).end = () => {};
    (req as unknown as { destroy: (err?: Error) => void }).destroy = (err?: Error) => {
        if (err) req.emit('error', err);
    };
    return req;
}

beforeEach(() => {
    lookup.mockReset();
    httpsRequest.mockReset();
});

describe('fetchPageText DNS-rebinding guard', () => {
    const blockedAnswers: Array<[string, { address: string; family: number }]> = [
        ['A record → RFC1918', { address: '10.0.0.5', family: 4 }],
        ['A record → loopback', { address: '127.0.0.1', family: 4 }],
        ['A record → link-local/metadata', { address: '169.254.169.254', family: 4 }],
        ['AAAA → v6 loopback', { address: '::1', family: 6 }],
        ['AAAA → ULA', { address: 'fd12:3456::1', family: 6 }],
        ['AAAA → v4-mapped private', { address: '::ffff:192.168.1.1', family: 6 }],
    ];
    for (const [label, answer] of blockedAnswers) {
        it(`blocks a hostname whose ${label}`, async () => {
            lookup.mockResolvedValue([answer]);
            await expect(fetchPageText('https://rebind.example.test/x')).rejects.toThrow('This host cannot be fetched.');
            expect(httpsRequest).not.toHaveBeenCalled(); // blocked BEFORE any connect
        });
    }

    it('blocks when ANY resolved address is private (multi-answer)', async () => {
        lookup.mockResolvedValue([
            { address: '93.184.216.34', family: 4 },
            { address: '10.1.1.1', family: 4 },
        ]);
        await expect(fetchPageText('https://mixed.example.test/')).rejects.toThrow('This host cannot be fetched.');
    });

    it('blocks on resolver failure instead of proceeding unvalidated', async () => {
        lookup.mockRejectedValue(new Error('ENOTFOUND'));
        await expect(fetchPageText('https://nxdomain.example.test/')).rejects.toThrow('This host cannot be fetched.');
        expect(httpsRequest).not.toHaveBeenCalled();
    });

    it('lets a publicly-resolving hostname through to the fetch', async () => {
        lookup.mockResolvedValue([
            { address: '93.184.216.34', family: 4 },
            { address: '2606:2800:220:1::1', family: 6 }, // public AAAA is fine
        ]);
        httpsRequest.mockImplementation((_options: unknown, handler: (res: unknown) => void) => {
            handler(fakeResponse(200, '<html><body><p>public page</p></body></html>'));
            return fakeReq();
        });
        const text = await fetchPageText('https://public.example.test/');
        expect(text).toContain('public page');
        expect(lookup).toHaveBeenCalledWith('public.example.test', { all: true, verbatim: true });
        // The connect must be pinned to the validated public IP, not the hostname.
        const opts = httpsRequest.mock.calls[0][0] as { host: string; servername: string; headers: Record<string, string> };
        expect(opts.host).toBe('93.184.216.34');
        expect(opts.servername).toBe('public.example.test');
        expect(opts.headers.Host).toBe('public.example.test');
    });

    it('re-validates DNS on every redirect hop', async () => {
        // Hop 1 resolves public and 302s to a host that resolves private.
        lookup.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);
        httpsRequest.mockImplementationOnce((_options: unknown, handler: (res: unknown) => void) => {
            handler(fakeResponse(302, '', { location: 'https://internal.example.test/admin' }));
            return fakeReq();
        });
        lookup.mockResolvedValueOnce([{ address: '192.168.0.10', family: 4 }]);
        await expect(fetchPageText('https://public.example.test/start')).rejects.toThrow('This host cannot be fetched.');
        expect(httpsRequest).toHaveBeenCalledTimes(1); // second hop blocked pre-connect
    });
});
