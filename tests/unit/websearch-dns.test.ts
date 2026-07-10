// DNS-rebinding guard for fetchPageText: a public-LOOKING hostname whose DNS
// answer is a private address must be blocked before any connect. The plain
// string checks live in sonoma-modules.test.ts; this file covers the resolver
// layer with a mocked node:dns/promises.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const lookup = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', () => ({ lookup: (...a: unknown[]) => lookup(...a) }));

import { fetchPageText } from '@/lib/ai/websearch';

const fetchMock = vi.fn();

beforeEach(() => {
    lookup.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

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
            expect(fetchMock).not.toHaveBeenCalled(); // blocked BEFORE any connect
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
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('lets a publicly-resolving hostname through to the fetch', async () => {
        lookup.mockResolvedValue([
            { address: '93.184.216.34', family: 4 },
            { address: '2606:2800:220:1::1', family: 6 }, // public AAAA is fine
        ]);
        fetchMock.mockResolvedValue(new Response('<html><body><p>public page</p></body></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
        }));
        const text = await fetchPageText('https://public.example.test/');
        expect(text).toContain('public page');
        expect(lookup).toHaveBeenCalledWith('public.example.test', { all: true, verbatim: true });
    });

    it('re-validates DNS on every redirect hop', async () => {
        // Hop 1 resolves public and 302s to a host that resolves private.
        lookup.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);
        fetchMock.mockResolvedValueOnce(new Response(null, {
            status: 302,
            headers: { location: 'https://internal.example.test/admin' },
        }));
        lookup.mockResolvedValueOnce([{ address: '192.168.0.10', family: 4 }]);
        await expect(fetchPageText('https://public.example.test/start')).rejects.toThrow('This host cannot be fetched.');
        expect(fetchMock).toHaveBeenCalledTimes(1); // second hop blocked pre-connect
    });
});
