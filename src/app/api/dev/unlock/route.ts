// Unlock endpoint for the /dev panel. The password check lives here — server
// side only — so the password never ships in the client bundle. A successful
// unlock sets an HttpOnly cookie with a signed, expiring token; both the
// password gate (GET) and /api/sonoma's dev override verify that cookie.

import { NextRequest, NextResponse } from 'next/server';
import { checkDevPassword, createDevToken, verifyDevToken, DEV_UNLOCK_COOKIE } from '@/lib/devAccess';
import { loginLimiter, LIMITS, rateLimitResponse, getRateLimitToken } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
    const unlocked = verifyDevToken(req.cookies.get(DEV_UNLOCK_COOKIE)?.value);
    return NextResponse.json({ unlocked });
}

export async function POST(req: NextRequest) {
    // Same strict budget as login: 10 attempts per 15 minutes per IP.
    try {
        await loginLimiter.check(LIMITS.login, `dev-unlock:${getRateLimitToken(req)}`);
    } catch {
        return rateLimitResponse();
    }

    let password = '';
    try {
        const body = (await req.json()) as { password?: unknown };
        password = typeof body.password === 'string' ? body.password : '';
    } catch {
        return NextResponse.json({ error: 'Bad JSON' }, { status: 400 });
    }

    if (!checkDevPassword(password)) {
        return NextResponse.json({ unlocked: false }, { status: 403 });
    }

    const res = NextResponse.json({ unlocked: true });
    res.cookies.set(DEV_UNLOCK_COOKIE, createDevToken(), {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 8 * 60 * 60,
    });
    return res;
}
