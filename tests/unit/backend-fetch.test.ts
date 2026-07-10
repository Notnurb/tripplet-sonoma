import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/env', () => ({
    env: {
        BACKEND_URL: 'https://backend.example.test',
        BACKEND_API_KEY: 'unit-backend-key',
    },
}));

import { backendFetch } from '@/lib/backend';

const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}', { status: 200 }));

beforeEach(() => {
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe('backendFetch', () => {
    it('prefixes the backend base URL and attaches the bearer key', async () => {
        await backendFetch('/memory/search', { method: 'POST', body: '{"q":1}' });
        const [url, init] = fetchSpy.mock.calls[0];
        expect(url).toBe('https://backend.example.test/memory/search');
        expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer unit-backend-key');
    });

    it('sets JSON content-type for string bodies but never clobbers an explicit one', async () => {
        await backendFetch('/a', { method: 'POST', body: '{}' });
        let init = fetchSpy.mock.calls[0][1]!;
        expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');

        await backendFetch('/b', { method: 'POST', body: 'x', headers: { 'Content-Type': 'text/plain' } });
        init = fetchSpy.mock.calls[1][1]!;
        expect((init.headers as Record<string, string>)['Content-Type']).toBe('text/plain');
    });

    it('passes through method and body untouched', async () => {
        await backendFetch('/c', { method: 'PUT', body: 'payload' });
        const init = fetchSpy.mock.calls[0][1]!;
        expect(init.method).toBe('PUT');
        expect(init.body).toBe('payload');
    });
});
