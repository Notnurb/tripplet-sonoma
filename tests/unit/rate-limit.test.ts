import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { rateLimit, getRateLimitToken } from '@/lib/security/rate-limit';

describe('rateLimit', () => {
    it('allows up to the limit then rejects', async () => {
        const limiter = rateLimit({ interval: 60_000, uniqueTokenPerInterval: 100 });
        for (let i = 0; i < 3; i++) {
            await expect(limiter.check(3, 'user:a')).resolves.toBeUndefined();
        }
        await expect(limiter.check(3, 'user:a')).rejects.toThrow('Rate limit exceeded');
    });

    it('tracks tokens independently', async () => {
        const limiter = rateLimit({ interval: 60_000, uniqueTokenPerInterval: 100 });
        await limiter.check(1, 'user:a');
        await expect(limiter.check(1, 'user:a')).rejects.toThrow();
        // A different token has its own bucket.
        await expect(limiter.check(1, 'user:b')).resolves.toBeUndefined();
    });
});

describe('getRateLimitToken', () => {
    const req = (headers: Record<string, string>) =>
        new NextRequest('http://localhost/api/x', { headers });

    it('prefers the user id over any header', () => {
        expect(getRateLimitToken(req({ 'x-real-ip': '1.2.3.4' }), 'u1')).toBe('user:u1');
    });

    it('uses x-real-ip when unauthenticated', () => {
        expect(getRateLimitToken(req({ 'x-real-ip': '1.2.3.4' }))).toBe('ip:1.2.3.4');
    });

    it('uses the RIGHTMOST x-forwarded-for entry (spoof-resistant)', () => {
        expect(
            getRateLimitToken(req({ 'x-forwarded-for': 'evil-injected, 10.0.0.1, 5.6.7.8' })),
        ).toBe('ip:5.6.7.8');
    });

    it('falls back to a fixed bucket so limiting still applies', () => {
        expect(getRateLimitToken(req({}))).toBe('ip:unknown');
    });
});
