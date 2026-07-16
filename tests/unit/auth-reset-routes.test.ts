import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Route-handler tests for the password-reset half of the auth surface:
 * /api/auth/forgot-password and /api/auth/reset-password. These cover the
 * security-load-bearing behavior — user-enumeration resistance, token *hashing*
 * before storage, and expiry handling — with the DB (raw pg) boundary mocked.
 */

vi.mock('@/lib/auth/log', () => ({ logAuthFailure: vi.fn() }));

// Mock the raw pg layer. `queryOne` is scripted per-test; `query` records calls
// so we can assert on the INSERT/DELETE/UPDATE side effects.
const queryOneImpl = { fn: vi.fn(async (_sql: string, _params?: unknown[]) => null as unknown) };
const queryCalls: Array<{ sql: string; params?: unknown[] }> = [];
vi.mock('@/lib/db/neon', () => ({
    query: vi.fn(async (sql: string, params?: unknown[]) => { queryCalls.push({ sql, params }); return { rows: [] }; }),
    queryOne: (sql: string, params?: unknown[]) => queryOneImpl.fn(sql, params),
}));

import { POST as forgot } from '@/app/api/auth/forgot-password/route';
import { POST as reset } from '@/app/api/auth/reset-password/route';
import { sessionsInvalidatedAt } from '@/lib/auth/session-store';

let ipCounter = 0;
function freshIp(): string {
    ipCounter += 1;
    return `10.60.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
}
function req(path: string, body: unknown, ip = freshIp()): NextRequest {
    return new NextRequest(`http://localhost${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-real-ip': ip },
        body: JSON.stringify(body),
    });
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

beforeEach(() => {
    queryCalls.length = 0;
    queryOneImpl.fn.mockReset();
    queryOneImpl.fn.mockResolvedValue(null);
});

describe('POST /api/auth/forgot-password', () => {
    it('returns { success: true } and writes no token for an unknown email (no enumeration)', async () => {
        queryOneImpl.fn.mockResolvedValue(null); // user not found
        const res = await forgot(req('/api/auth/forgot-password', { email: 'ghost@x.com' }));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ success: true });
        // No INSERT into PasswordResetToken for a non-existent user.
        expect(queryCalls.some((c) => /INSERT INTO "PasswordResetToken"/.test(c.sql))).toBe(false);
    });

    it('stores only a sha256 HASH of the reset token, never the raw token', async () => {
        queryOneImpl.fn.mockResolvedValue({ id: 'u1', email: 'real@x.com' });
        const res = await forgot(req('/api/auth/forgot-password', { email: 'real@x.com' }));
        expect(res.status).toBe(200);
        const insert = queryCalls.find((c) => /INSERT INTO "PasswordResetToken"/.test(c.sql));
        expect(insert).toBeTruthy();
        const storedToken = (insert!.params as unknown[])[1] as string;
        expect(storedToken).toMatch(SHA256_HEX); // 64 hex chars = sha256, not the raw 32-byte token
        // Old tokens are cleared before inserting the new one.
        expect(queryCalls.some((c) => /DELETE FROM "PasswordResetToken"/.test(c.sql))).toBe(true);
    });

    it('rejects an invalid email via schema → 400', async () => {
        const res = await forgot(req('/api/auth/forgot-password', { email: 'nope' }));
        expect(res.status).toBe(400);
    });

    it('enforces the tight per-IP limit (3/hr) → 429 on the 4th', async () => {
        const ip = '198.51.100.9';
        for (let i = 0; i < 3; i++) {
            const ok = await forgot(req('/api/auth/forgot-password', { email: `a${i}@x.com` }, ip));
            expect(ok.status).toBe(200);
        }
        const limited = await forgot(req('/api/auth/forgot-password', { email: 'a4@x.com' }, ip));
        expect(limited.status).toBe(429);
    });
});

describe('POST /api/auth/reset-password', () => {
    const strongPw = 'correct-horse-battery';

    it('rejects an unknown token → 400', async () => {
        queryOneImpl.fn.mockResolvedValue(null);
        const res = await reset(req('/api/auth/reset-password', { token: 'a'.repeat(40), password: strongPw }));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('Invalid or expired token');
    });

    it('rejects an expired token → 400 and deletes it', async () => {
        queryOneImpl.fn.mockResolvedValue({ id: 'tok1', userId: 'u1', expiresAt: new Date(Date.now() - 1000).toISOString() });
        const res = await reset(req('/api/auth/reset-password', { token: 'b'.repeat(40), password: strongPw }));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('Token expired');
        expect(queryCalls.some((c) => /DELETE FROM "PasswordResetToken" WHERE id = \$1/.test(c.sql))).toBe(true);
    });

    it('accepts a valid token → updates the password hash and clears all tokens', async () => {
        queryOneImpl.fn.mockResolvedValue({ id: 'tok2', userId: 'u2', expiresAt: new Date(Date.now() + 60_000).toISOString() });
        const res = await reset(req('/api/auth/reset-password', { token: 'c'.repeat(40), password: strongPw }));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ success: true });
        const update = queryCalls.find((c) => /UPDATE "User" SET "passwordHash"/.test(c.sql));
        expect(update).toBeTruthy();
        // The stored value is a bcrypt hash, never the raw password.
        expect((update!.params as unknown[])[0]).not.toBe(strongPw);
        expect(String((update!.params as unknown[])[0])).toMatch(/^\$2[aby]\$/);
        expect(queryCalls.some((c) => /DELETE FROM "PasswordResetToken" WHERE "userId" = \$1/.test(c.sql))).toBe(true);
    });

    it('rejects a weak password via schema → 400', async () => {
        const res = await reset(req('/api/auth/reset-password', { token: 'd'.repeat(40), password: 'password123' }));
        expect(res.status).toBe(400);
    });

    // Regression test for a real gap: resetting the password rotated the
    // hash but did nothing to already-issued JWTs — a token stolen before
    // the reset kept working for its full 7-day life. Now every reset
    // revokes all sessions for that user via the shared invalidation store.
    it('revokes all existing sessions for the user on a successful reset', async () => {
        const before = await sessionsInvalidatedAt('u-revoke-me');
        expect(before).toBe(0); // never revoked yet

        queryOneImpl.fn.mockResolvedValue({ id: 'tok3', userId: 'u-revoke-me', expiresAt: new Date(Date.now() + 60_000).toISOString() });
        const res = await reset(req('/api/auth/reset-password', { token: 'e'.repeat(40), password: strongPw }));
        expect(res.status).toBe(200);

        const after = await sessionsInvalidatedAt('u-revoke-me');
        expect(after).toBeGreaterThan(0); // cutoff now set — old tokens are revoked
    });
});
