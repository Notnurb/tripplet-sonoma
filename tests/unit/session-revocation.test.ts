import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Regression test for a real gap: sessions are stateless JWTs with no
 * server-side session table, so logout only ever deleted the browser cookie
 * — a copy of the token taken before logout (stolen, synced elsewhere) kept
 * working for its full 7-day life. `session-store.ts` adds a per-user
 * invalidation cutoff; `auth()` and the logout route now enforce it.
 */

vi.mock('@/lib/env', () => ({ env: { JWT_SECRET: 'unit-test-secret-at-least-32-chars-long!!' } }));

import { signToken } from '@/lib/auth/jwt';
import { POST as logout } from '@/app/api/auth/logout/route';
import { invalidateSessionsNow, sessionsInvalidatedAt } from '@/lib/auth/session-store';

function reqWithCookie(path: string, token?: string): NextRequest {
    const headers: Record<string, string> = {};
    if (token) headers['cookie'] = `auth_token=${token}`;
    return new NextRequest(`http://localhost${path}`, { method: 'POST', headers });
}

describe('session-store: invalidateSessionsNow / sessionsInvalidatedAt', () => {
    it('starts at 0 (never revoked) and becomes a real timestamp after invalidation', async () => {
        const userId = `u-${Math.random()}`;
        expect(await sessionsInvalidatedAt(userId)).toBe(0);
        const before = Date.now();
        await invalidateSessionsNow(userId);
        const cutoff = await sessionsInvalidatedAt(userId);
        // The cutoff is floored to the second (JWT iat precision), so compare
        // against the floored "before" rather than the raw millisecond clock.
        expect(cutoff).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
        expect(cutoff).toBeLessThanOrEqual(Date.now());
        expect(cutoff % 1000).toBe(0);
    });

    it('is scoped per user — revoking one user does not affect another', async () => {
        const a = `u-a-${Math.random()}`;
        const b = `u-b-${Math.random()}`;
        await invalidateSessionsNow(a);
        expect(await sessionsInvalidatedAt(b)).toBe(0);
    });
});

describe('POST /api/auth/logout revokes the session, not just the cookie', () => {
    it('sets an invalidation cutoff for the token’s userId', async () => {
        const userId = `u-logout-${Math.random()}`;
        const token = await signToken({ userId, email: 'x@x.com' });
        expect(await sessionsInvalidatedAt(userId)).toBe(0);

        const res = await logout(reqWithCookie('/api/auth/logout', token));
        expect(res.status).toBe(200);

        expect(await sessionsInvalidatedAt(userId)).toBeGreaterThan(0);
    });

    it('is a no-op (no crash, no revocation) when no session cookie is present', async () => {
        const res = await logout(reqWithCookie('/api/auth/logout'));
        expect(res.status).toBe(200);
    });

    it('does not crash on a garbage/invalid cookie value', async () => {
        const res = await logout(reqWithCookie('/api/auth/logout', 'not-a-real-jwt'));
        expect(res.status).toBe(200);
    });
});
