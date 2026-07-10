import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Route-handler tests for the /api/auth/* surface — register, login, logout, me.
 * These exercise the real handlers with real NextRequest objects and real
 * jwt/bcrypt/validation; only the DB boundary (user-store) is mocked. This is
 * the security-critical surface (credential handling, account lockout, cookie
 * flags) that previously had zero unit coverage.
 */

// Deterministic secret so signed cookies verify within the suite.
vi.mock('@/lib/env', () => ({ env: { JWT_SECRET: 'unit-test-secret-at-least-32-chars-long!!' } }));

// Silence the structured auth-failure logger.
vi.mock('@/lib/auth/log', () => ({ logAuthFailure: vi.fn() }));

// In-memory stand-in for the Prisma-backed user store (the DB boundary).
interface FakeUser { id: string; email: string; name: string | null; passwordHash: string | null; bio?: string | null; image?: string | null; }
const usersByEmail = new Map<string, FakeUser>();
const usersById = new Map<string, FakeUser>();
const DUP = Symbol('duplicate');
let createShouldThrowDuplicate = false;

vi.mock('@/lib/auth/user-store', () => ({
    findAuthUserByEmail: vi.fn(async (email: string) => usersByEmail.get(email.toLowerCase().trim()) ?? null),
    findAuthUserById: vi.fn(async (id: string) => usersById.get(id) ?? null),
    createAuthUser: vi.fn(async ({ email, passwordHash, name }: { email: string; passwordHash: string; name?: string }) => {
        if (createShouldThrowDuplicate) throw { [DUP]: true };
        const user: FakeUser = { id: `id-${email}`, email, passwordHash, name: name ?? null };
        usersByEmail.set(email.toLowerCase().trim(), user);
        usersById.set(user.id, user);
        return user;
    }),
    isDuplicateUserError: (e: unknown) => !!(e && typeof e === 'object' && (e as Record<symbol, unknown>)[DUP]),
}));

import { POST as register } from '@/app/api/auth/register/route';
import { POST as login } from '@/app/api/auth/login/route';
import { POST as logout } from '@/app/api/auth/logout/route';
import { GET as me } from '@/app/api/auth/me/route';
import { hashPassword } from '@/lib/auth/password';
import { signToken } from '@/lib/auth/jwt';

// Unique source IP per request so the module-level per-IP limiters never
// interfere across tests (getRateLimitToken prefers x-real-ip).
let ipCounter = 0;
function freshIp(): string {
    ipCounter += 1;
    return `10.50.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
}
function authReq(path: string, body: unknown, opts: { ip?: string; cookie?: string; method?: string } = {}): NextRequest {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-real-ip': opts.ip ?? freshIp(),
    };
    if (opts.cookie) headers['cookie'] = `auth_token=${opts.cookie}`;
    return new NextRequest(`http://localhost${path}`, {
        method: opts.method ?? 'POST',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

let validHash: string;
beforeAll(async () => {
    validHash = await hashPassword('correct-horse-battery');
});

beforeEach(() => {
    usersByEmail.clear();
    usersById.clear();
    createShouldThrowDuplicate = false;
});

describe('POST /api/auth/register', () => {
    it('registers a new user → 201 with an HttpOnly auth cookie', async () => {
        const res = await register(authReq('/api/auth/register', { email: 'new@x.com', password: 'correct-horse-battery' }));
        expect(res.status).toBe(201);
        expect(res.cookies.get('auth_token')?.value).toBeTruthy();
        const setCookie = res.headers.get('set-cookie') ?? '';
        expect(setCookie).toContain('auth_token=');
        expect(setCookie.toLowerCase()).toContain('httponly');
        expect(setCookie.toLowerCase()).toContain('samesite=strict');
    });

    it('rejects a duplicate email (pre-check) → 400', async () => {
        usersByEmail.set('taken@x.com', { id: 'id-taken@x.com', email: 'taken@x.com', name: null, passwordHash: validHash });
        const res = await register(authReq('/api/auth/register', { email: 'taken@x.com', password: 'correct-horse-battery' }));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('User already exists');
    });

    it('maps a create-time duplicate race to 400 (not 500)', async () => {
        createShouldThrowDuplicate = true;
        const res = await register(authReq('/api/auth/register', { email: 'race@x.com', password: 'correct-horse-battery' }));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('User already exists');
    });

    it('rejects a common/breached password via schema → 400', async () => {
        const res = await register(authReq('/api/auth/register', { email: 'weak@x.com', password: 'password123' }));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/common|guessable/i);
    });

    it('rejects an invalid email → 400', async () => {
        const res = await register(authReq('/api/auth/register', { email: 'not-an-email', password: 'correct-horse-battery' }));
        expect(res.status).toBe(400);
    });

    it('enforces the per-IP registration limit (5/hr) → 429 on the 6th', async () => {
        const ip = '203.0.113.7';
        for (let i = 0; i < 5; i++) {
            const ok = await register(authReq('/api/auth/register', { email: `bulk${i}@x.com`, password: 'correct-horse-battery' }, { ip }));
            expect(ok.status).toBe(201);
        }
        const limited = await register(authReq('/api/auth/register', { email: 'bulk6@x.com', password: 'correct-horse-battery' }, { ip }));
        expect(limited.status).toBe(429);
    });
});

describe('POST /api/auth/login', () => {
    function seed(email: string) {
        const user: FakeUser = { id: `id-${email}`, email, name: null, passwordHash: validHash };
        usersByEmail.set(email, user);
        usersById.set(user.id, user);
    }

    it('logs in valid credentials → 200 with an auth cookie', async () => {
        seed('good@x.com');
        const res = await login(authReq('/api/auth/login', { email: 'good@x.com', password: 'correct-horse-battery' }));
        expect(res.status).toBe(200);
        expect(res.cookies.get('auth_token')?.value).toBeTruthy();
    });

    it('rejects a wrong password → 401', async () => {
        seed('wrongpw@x.com');
        const res = await login(authReq('/api/auth/login', { email: 'wrongpw@x.com', password: 'not-the-password' }));
        expect(res.status).toBe(401);
        expect((await res.json()).error).toBe('Invalid email or password');
    });

    it('rejects an unknown user → 401 (same message, no user enumeration)', async () => {
        const res = await login(authReq('/api/auth/login', { email: 'ghost@x.com', password: 'correct-horse-battery' }));
        expect(res.status).toBe(401);
        expect((await res.json()).error).toBe('Invalid email or password');
    });

    it('rejects an account with no password hash → 401', async () => {
        const email = 'nopw@x.com';
        const user: FakeUser = { id: `id-${email}`, email, name: null, passwordHash: null };
        usersByEmail.set(email, user);
        usersById.set(user.id, user);
        const res = await login(authReq('/api/auth/login', { email, password: 'correct-horse-battery' }));
        expect(res.status).toBe(401);
        expect((await res.json()).error).toMatch(/does not have a password login/);
    });

    it('locks the account after 5 failed attempts → 429', async () => {
        seed('lockme@x.com');
        for (let i = 0; i < 5; i++) {
            const r = await login(authReq('/api/auth/login', { email: 'lockme@x.com', password: 'wrong' }));
            expect(r.status).toBe(401);
        }
        // 6th attempt — even with the CORRECT password — is locked out.
        const locked = await login(authReq('/api/auth/login', { email: 'lockme@x.com', password: 'correct-horse-battery' }));
        expect(locked.status).toBe(429);
        expect((await locked.json()).error).toMatch(/locked/i);
    });

    it('clears the lockout counter after a successful login', async () => {
        seed('recover@x.com');
        for (let i = 0; i < 4; i++) {
            await login(authReq('/api/auth/login', { email: 'recover@x.com', password: 'wrong' }));
        }
        const good = await login(authReq('/api/auth/login', { email: 'recover@x.com', password: 'correct-horse-battery' }));
        expect(good.status).toBe(200);
        // Counter reset — a fresh wrong attempt is a 401, not a lockout 429.
        const after = await login(authReq('/api/auth/login', { email: 'recover@x.com', password: 'wrong' }));
        expect(after.status).toBe(401);
    });

    it('rejects a missing password via schema → 400', async () => {
        const res = await login(authReq('/api/auth/login', { email: 'x@x.com' }));
        expect(res.status).toBe(400);
    });
});

describe('POST /api/auth/logout', () => {
    it('returns 200 and expires the auth cookie', async () => {
        const res = await logout();
        expect(res.status).toBe(200);
        const setCookie = res.headers.get('set-cookie') ?? '';
        expect(setCookie).toContain('auth_token=');
        // Expiry in the past (epoch) clears the cookie client-side.
        expect(setCookie).toMatch(/expires=thu, 01 jan 1970/i);
    });
});

describe('GET /api/auth/me', () => {
    it('resolves the user from a valid auth_token cookie', async () => {
        const email = 'me@x.com';
        usersById.set('id-me', { id: 'id-me', email, name: 'Mia', passwordHash: validHash, bio: null, image: null });
        const token = await signToken({ userId: 'id-me', email });
        const res = await me(authReq('/api/auth/me', undefined, { cookie: token, method: 'GET' }));
        expect(res.status).toBe(200);
        expect((await res.json()).user).toMatchObject({ id: 'id-me', email, name: 'Mia' });
    });

    it('returns { user: null } with no cookie', async () => {
        const res = await me(authReq('/api/auth/me', undefined, { method: 'GET' }));
        expect(res.status).toBe(200);
        expect((await res.json()).user).toBeNull();
    });

    it('returns { user: null } for an invalid token (signed-out, not 500)', async () => {
        const res = await me(authReq('/api/auth/me', undefined, { cookie: 'garbage.token.value', method: 'GET' }));
        expect(res.status).toBe(200);
        expect((await res.json()).user).toBeNull();
    });

    it('returns { user: null } when the token is valid but the user is gone', async () => {
        const token = await signToken({ userId: 'id-vanished', email: 'v@x.com' });
        const res = await me(authReq('/api/auth/me', undefined, { cookie: token, method: 'GET' }));
        expect(res.status).toBe(200);
        expect((await res.json()).user).toBeNull();
    });
});
