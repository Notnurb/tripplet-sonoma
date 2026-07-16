import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Regression test for a real gap: OAuth Dynamic Client Registration
 * (RFC 7591, /api/oauth/register) is open and unauthenticated by design —
 * any MCP client self-registers before a human approves anything — but had
 * NO rate limit, so a single IP could register unbounded client rows for
 * free. Now capped per-IP like every other pre-auth endpoint.
 */

vi.mock('@/lib/db/neon', () => ({
    isDbConfigured: () => true,
    query: vi.fn(async () => ({ rows: [] })),
    queryOne: vi.fn(async () => null),
}));

vi.mock('@/lib/mcp/oauth', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/mcp/oauth')>();
    return {
        ...actual,
        registerClient: vi.fn(async (input: { redirect_uris: string[] }) => ({
            client_id: 'mcp_test',
            client_name: 'test',
            redirect_uris: input.redirect_uris,
            grant_types: ['authorization_code'],
            token_endpoint_auth_method: 'none',
        })),
    };
});

import { POST } from '@/app/api/oauth/register/route';
import { LIMITS } from '@/lib/security/rate-limit';

function req(ip: string): NextRequest {
    return new NextRequest('http://localhost/api/oauth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-real-ip': ip },
        body: JSON.stringify({ redirect_uris: ['https://client.example/cb'], client_name: 'x' }),
    });
}

describe('POST /api/oauth/register rate limiting', () => {
    it(`allows up to ${LIMITS.oauthRegister} registrations then 429s the next one, per IP`, async () => {
        const ip = '203.0.113.44';
        for (let i = 0; i < LIMITS.oauthRegister; i++) {
            const res = await POST(req(ip));
            expect(res.status).toBe(201);
        }
        const limited = await POST(req(ip));
        expect(limited.status).toBe(429);
    });

    it('a different IP is not affected by another IP exhausting its limit', async () => {
        const res = await POST(req('203.0.113.99'));
        expect(res.status).toBe(201);
    });
});
