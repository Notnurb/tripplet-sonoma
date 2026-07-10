// Regression test for a real hardening gap: JWT_SECRET previously had no
// strength floor (z.string().min(1)) — HS256 tokens signed with a short/
// low-entropy secret are offline-brute-forceable from one captured
// auth_token, after which the attacker forges a cookie for ANY userId
// (full account takeover). env.ts now rejects anything under 32 chars.
//
// validateEnv() runs at module import time, so each case stubs process.env
// then imports src/lib/env.ts fresh via resetModules (same pattern as
// llm-backend.test.ts).

import { describe, it, expect, beforeEach, vi } from 'vitest';

const BASE_ENV = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
};

beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
});

describe('JWT_SECRET strength floor', () => {
    it('production: throws at import when JWT_SECRET is short (weak-key forgery risk)', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('DATABASE_URL', BASE_ENV.DATABASE_URL);
        vi.stubEnv('JWT_SECRET', 'too-short');
        await expect(import('@/lib/env')).rejects.toThrow(
            'Missing or invalid environment variables.',
        );
    });

    it('production: succeeds when JWT_SECRET meets the 32-char floor', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('DATABASE_URL', BASE_ENV.DATABASE_URL);
        vi.stubEnv('JWT_SECRET', 'a'.repeat(32));
        const { env } = await import('@/lib/env');
        expect(env.JWT_SECRET).toBe('a'.repeat(32));
    });

    it('dev: does not hard-crash the whole module on a short secret (fails at point of use instead)', async () => {
        vi.stubEnv('NODE_ENV', 'development');
        vi.stubEnv('DATABASE_URL', BASE_ENV.DATABASE_URL);
        vi.stubEnv('JWT_SECRET', 'x');
        const { env } = await import('@/lib/env');
        // The weak value is dropped rather than silently accepted as a valid
        // signing key — downstream JWT code fails loudly the moment it's used.
        expect(env.JWT_SECRET).toBeUndefined();
    });

    it('exactly 31 chars is rejected, exactly 32 is accepted (boundary)', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('DATABASE_URL', BASE_ENV.DATABASE_URL);
        vi.stubEnv('JWT_SECRET', 'a'.repeat(31));
        await expect(import('@/lib/env')).rejects.toThrow();

        vi.resetModules();
        vi.stubEnv('JWT_SECRET', 'a'.repeat(32));
        await expect(import('@/lib/env')).resolves.toBeDefined();
    });
});
