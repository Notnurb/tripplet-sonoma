import { test, expect, request } from '@playwright/test';

/**
 * End-to-end auth round trip: sign-up → sign-in → get-session.
 *
 * This exercises the flow the UI actually uses today (legacy JWT routes:
 * /api/auth/register → /api/auth/login → /api/auth/me), so a regression that
 * breaks sign-in is caught on every run instead of after a support message.
 *
 * GUARDED: it creates a real user row, so it is SKIPPED unless AUTH_E2E=1.
 * Point DATABASE_URL at a throwaway/test database before enabling it — do NOT
 * run this against the production Neon instance.
 *
 *   AUTH_E2E=1 npm run test:e2e -- auth-roundtrip
 */

const ENABLED = process.env.AUTH_E2E === '1';

test.describe('auth round trip (register → login → session)', () => {
    test.skip(!ENABLED, 'Set AUTH_E2E=1 (against a TEST db) to run this — it writes a real user.');

    test('a new user can register, log in, and read their session', async ({ baseURL }) => {
        const api = await request.newContext({ baseURL });

        // Unique-per-run email. No Math.random/Date allowed in workflow scripts,
        // but this is a plain Playwright test file, so it's fine here.
        const email = `e2e+${Date.now()}@example.test`;
        const password = 'Sup3rSecret!pw';

        // 1. Register → sets auth_token cookie.
        const reg = await api.post('/api/auth/register', {
            data: { email, password, name: 'E2E User' },
        });
        expect(reg.status(), await reg.text()).toBe(201);

        // 2. Fresh context (no cookies) logs in with the same credentials.
        const loginCtx = await request.newContext({ baseURL });
        const login = await loginCtx.post('/api/auth/login', { data: { email, password } });
        expect(login.status(), await login.text()).toBe(200);

        // 3. The login cookie yields a valid session.
        const me = await loginCtx.get('/api/auth/me');
        expect(me.status()).toBe(200);
        const body = await me.json();
        expect(body?.user?.email ?? body?.email).toBe(email);

        // 4. Wrong password is rejected.
        const bad = await request.newContext({ baseURL });
        const badLogin = await bad.post('/api/auth/login', {
            data: { email, password: 'wrong-password' },
        });
        expect(badLogin.status()).toBe(401);

        await api.dispose();
        await loginCtx.dispose();
        await bad.dispose();
    });
});
