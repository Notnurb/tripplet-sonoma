import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { NextRequest } from 'next/server';

/**
 * OAuth 2.1 token endpoint + PKCE crypto. This is a pre-auth, security-critical
 * surface (it mints bearer tokens for the MCP server) and previously had zero
 * unit coverage. Only the DB boundary (@/lib/db/neon) is mocked — the real
 * oauth.ts runs, so PKCE S256 verification and token/code hashing are exercised
 * for real, not stubbed.
 */

// SQL-routing DB mock. Each test scripts what the SELECT/DELETE should return.
const scripted: { client: unknown; authCode: unknown; refreshRow: unknown } = {
    client: null, authCode: null, refreshRow: null,
};
const queryCalls: Array<{ sql: string; params?: unknown[] }> = [];

vi.mock('@/lib/db/neon', () => ({
    query: vi.fn(async (sql: string, params?: unknown[]) => { queryCalls.push({ sql, params }); return { rows: [] }; }),
    queryOne: vi.fn(async (sql: string) => {
        if (/FROM oauth_clients/.test(sql)) return scripted.client;
        if (/DELETE FROM oauth_authorization_codes/.test(sql)) return scripted.authCode;
        if (/FROM oauth_access_tokens/.test(sql)) return scripted.refreshRow;
        return null;
    }),
}));

import { POST } from '@/app/api/oauth/token/route';
import { verifyPkceS256, sha256, baseUrlFrom } from '@/lib/mcp/oauth';

function pkcePair(verifier: string) {
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    return { verifier, challenge };
}

function tokenReq(body: Record<string, string>): NextRequest {
    return new NextRequest('http://localhost/api/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

const CLIENT = { client_id: 'mcp_abc', client_name: 'x', redirect_uris: ['https://app/cb'], grant_types: ['authorization_code', 'refresh_token'], token_endpoint_auth_method: 'none' };

beforeEach(() => {
    scripted.client = null; scripted.authCode = null; scripted.refreshRow = null;
    queryCalls.length = 0;
});

describe('verifyPkceS256 (real crypto)', () => {
    it('accepts a correct verifier/challenge pair', () => {
        const { verifier, challenge } = pkcePair('a-sufficiently-long-code-verifier-value-123');
        expect(verifyPkceS256(verifier, challenge)).toBe(true);
    });
    it('rejects a wrong verifier', () => {
        const { challenge } = pkcePair('the-real-verifier-abcdefghijklmnop');
        expect(verifyPkceS256('a-different-verifier-zzzzzzzzzzzz', challenge)).toBe(false);
    });
    it('rejects a length-mismatched challenge without throwing', () => {
        expect(verifyPkceS256('v', 'too-short')).toBe(false);
    });
});

describe('oauth helpers', () => {
    it('sha256 returns stable 64-char hex', () => {
        expect(sha256('x')).toMatch(/^[0-9a-f]{64}$/);
        expect(sha256('x')).toBe(sha256('x'));
        expect(sha256('x')).not.toBe(sha256('y'));
    });
    it('baseUrlFrom prefers NEXT_PUBLIC_APP_URL, else forwarded headers', () => {
        vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://tripplet.example');
        expect(baseUrlFrom(new Request('http://localhost/'))).toBe('https://tripplet.example');
        vi.unstubAllEnvs();
        const req = new Request('http://ignored/', { headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'proxied.host' } });
        expect(baseUrlFrom(req)).toBe('https://proxied.host');
    });
});

describe('POST /api/oauth/token — client validation', () => {
    it('400 invalid_client when client_id is missing', async () => {
        const res = await POST(tokenReq({ grant_type: 'authorization_code' }));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('invalid_client');
    });
    it('401 invalid_client for an unknown client', async () => {
        scripted.client = null;
        const res = await POST(tokenReq({ grant_type: 'authorization_code', client_id: 'nope' }));
        expect(res.status).toBe(401);
        expect((await res.json()).error).toBe('invalid_client');
    });
    it('400 unsupported_grant_type for a bad grant', async () => {
        scripted.client = CLIENT;
        const res = await POST(tokenReq({ grant_type: 'password', client_id: CLIENT.client_id }));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('unsupported_grant_type');
    });
});

describe('POST /api/oauth/token — authorization_code grant', () => {
    const { verifier, challenge } = pkcePair('verifier-for-the-happy-path-1234567890');
    function baseCode(overrides: Record<string, unknown> = {}) {
        return { client_id: CLIENT.client_id, user_email: 'u@x.com', redirect_uri: 'https://app/cb', code_challenge: challenge, code_challenge_method: 'S256', scope: 'mcp', resource: null, expired: false, ...overrides };
    }
    beforeEach(() => { scripted.client = CLIENT; });

    it('400 invalid_request when code/redirect_uri/verifier are missing', async () => {
        const res = await POST(tokenReq({ grant_type: 'authorization_code', client_id: CLIENT.client_id, code: 'c' }));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('invalid_request');
    });
    it('400 invalid_grant for an already-used/invalid code', async () => {
        scripted.authCode = null;
        const res = await POST(tokenReq({ grant_type: 'authorization_code', client_id: CLIENT.client_id, code: 'x', redirect_uri: 'https://app/cb', code_verifier: verifier }));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('invalid_grant');
    });
    it('400 invalid_grant for an expired code', async () => {
        scripted.authCode = baseCode({ expired: true });
        const res = await POST(tokenReq({ grant_type: 'authorization_code', client_id: CLIENT.client_id, code: 'x', redirect_uri: 'https://app/cb', code_verifier: verifier }));
        expect(res.status).toBe(400);
        expect((await res.json()).error_description).toMatch(/expired/i);
    });
    it('400 invalid_grant on client_id mismatch', async () => {
        scripted.authCode = baseCode({ client_id: 'someone-else' });
        const res = await POST(tokenReq({ grant_type: 'authorization_code', client_id: CLIENT.client_id, code: 'x', redirect_uri: 'https://app/cb', code_verifier: verifier }));
        expect(res.status).toBe(400);
        expect((await res.json()).error_description).toMatch(/different client/i);
    });
    it('400 invalid_grant on redirect_uri mismatch', async () => {
        scripted.authCode = baseCode({ redirect_uri: 'https://evil/cb' });
        const res = await POST(tokenReq({ grant_type: 'authorization_code', client_id: CLIENT.client_id, code: 'x', redirect_uri: 'https://app/cb', code_verifier: verifier }));
        expect(res.status).toBe(400);
        expect((await res.json()).error_description).toMatch(/redirect_uri/i);
    });
    it('400 invalid_grant on PKCE failure (wrong verifier)', async () => {
        scripted.authCode = baseCode();
        const res = await POST(tokenReq({ grant_type: 'authorization_code', client_id: CLIENT.client_id, code: 'x', redirect_uri: 'https://app/cb', code_verifier: 'wrong-verifier-entirely-000' }));
        expect(res.status).toBe(400);
        expect((await res.json()).error_description).toMatch(/PKCE/i);
    });
    it('issues tokens on a valid code + PKCE proof', async () => {
        scripted.authCode = baseCode();
        const res = await POST(tokenReq({ grant_type: 'authorization_code', client_id: CLIENT.client_id, code: 'x', redirect_uri: 'https://app/cb', code_verifier: verifier }));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.token_type).toBe('Bearer');
        expect(body.access_token).toBeTruthy();
        expect(body.refresh_token).toBeTruthy();
        expect(body.expires_in).toBe(3600);
        // Access token row is inserted with a HASH, never the raw token.
        const insert = queryCalls.find((c) => /INSERT INTO oauth_access_tokens/.test(c.sql));
        expect(insert).toBeTruthy();
        expect((insert!.params as unknown[])[0]).not.toBe(body.access_token);
        expect(String((insert!.params as unknown[])[0])).toMatch(/^[0-9a-f]{64}$/);
    });
});

describe('POST /api/oauth/token — refresh_token grant', () => {
    beforeEach(() => { scripted.client = CLIENT; });
    it('400 invalid_request when refresh_token is missing', async () => {
        const res = await POST(tokenReq({ grant_type: 'refresh_token', client_id: CLIENT.client_id }));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('invalid_request');
    });
    it('400 invalid_grant for an unknown/expired refresh token', async () => {
        scripted.refreshRow = null;
        const res = await POST(tokenReq({ grant_type: 'refresh_token', client_id: CLIENT.client_id, refresh_token: 'nope' }));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('invalid_grant');
    });
    it('rotates a valid refresh token into a fresh pair and revokes the old row', async () => {
        scripted.refreshRow = { user_email: 'u@x.com', scope: 'mcp', resource: null };
        const res = await POST(tokenReq({ grant_type: 'refresh_token', client_id: CLIENT.client_id, refresh_token: 'valid-refresh' }));
        expect(res.status).toBe(200);
        expect((await res.json()).access_token).toBeTruthy();
        expect(queryCalls.some((c) => /UPDATE oauth_access_tokens SET is_revoked = true/.test(c.sql))).toBe(true);
    });
});
