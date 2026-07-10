import { describe, it, expect, vi, beforeEach } from 'vitest';

// Deterministic secret for the whole suite.
vi.mock('@/lib/env', () => ({ env: { JWT_SECRET: 'unit-test-secret-at-least-32-chars-long!!' } }));

// Controllable stand-in for the request cookie store so auth() can be
// exercised without a real request context.
const cookieJar = new Map<string, string>();
vi.mock('next/headers', () => ({
    cookies: async () => ({
        get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
    }),
}));

import { signToken, verifyToken } from '@/lib/auth/jwt';
import { auth } from '@/lib/auth/session';

describe('jwt', () => {
    it('round-trips a payload', async () => {
        const token = await signToken({ userId: 'u1', email: 'a@b.c' });
        const payload = await verifyToken(token);
        expect(payload.userId).toBe('u1');
        expect(payload.email).toBe('a@b.c');
    });

    it('rejects a tampered token', async () => {
        const token = await signToken({ userId: 'u1', email: 'a@b.c' });
        const [h, p, sig] = token.split('.');
        const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
        await expect(verifyToken(`${h}.${p}.${flipped}`)).rejects.toThrow('Invalid or expired token');
    });

    it('rejects garbage', async () => {
        await expect(verifyToken('not.a.jwt')).rejects.toThrow('Invalid or expired token');
        await expect(verifyToken('')).rejects.toThrow('Invalid or expired token');
    });
});

describe('auth()', () => {
    beforeEach(() => cookieJar.clear());

    it('resolves a user from a valid auth_token cookie', async () => {
        cookieJar.set('auth_token', await signToken({ userId: 'u-42', email: 'l@x.y' }));
        expect(await auth()).toEqual({ userId: 'u-42', email: 'l@x.y' });
    });

    it('degrades to guest on an invalid token instead of throwing', async () => {
        cookieJar.set('auth_token', 'expired.or.garbage');
        expect(await auth()).toEqual({ userId: null });
    });

    it('treats no cookie as a guest', async () => {
        expect(await auth()).toEqual({ userId: null });
    });
});
