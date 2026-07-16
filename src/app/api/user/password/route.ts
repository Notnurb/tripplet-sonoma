import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/session';
import { query, queryOne } from '@/lib/db/neon';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { profileLimiter, LIMITS, rateLimitResponse, getRateLimitToken } from '@/lib/security/rate-limit';
import { passwordSchema } from '@/lib/validation';
import { invalidateSessionsNow } from '@/lib/auth/session-store';
import { signToken } from '@/lib/auth/jwt';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const limitToken = getRateLimitToken(req, userId);
    try {
        await profileLimiter.check(LIMITS.profile, limitToken);
    } catch {
        return rateLimitResponse();
    }

    let body: { currentPassword?: unknown; newPassword?: unknown };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

    if (!currentPassword) {
        return NextResponse.json({ error: 'Current password required' }, { status: 400 });
    }
    // Same policy as registration (length + common-password blocklist) — a
    // password *change* must not accept what a sign-up would reject.
    const parsed = passwordSchema.safeParse(newPassword);
    if (!parsed.success) {
        const message = parsed.error.issues[0]?.message ?? 'Invalid password';
        return NextResponse.json({ error: message }, { status: 400 });
    }

    const user = await queryOne<{ id: string; email: string; passwordHash: string | null }>(
        `SELECT id, email, "passwordHash" FROM "User" WHERE id = $1 LIMIT 1`,
        [userId],
    );

    if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const ok = await verifyPassword(currentPassword, user.passwordHash ?? '');
    if (!ok) {
        return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });
    }

    const newHash = await hashPassword(newPassword);
    try {
        await query(
            `UPDATE "User" SET "passwordHash" = $1, "updatedAt" = now() WHERE id = $2`,
            [newHash, userId],
        );
    } catch {
        return NextResponse.json({ error: 'Failed to update password' }, { status: 500 });
    }

    // Changing a password usually means "I no longer trust who might hold my
    // credentials" — revoke every already-issued token, then re-issue a fresh
    // cookie so the user's own session keeps working.
    await invalidateSessionsNow(userId).catch(() => { /* best-effort */ });
    const freshToken = await signToken({ userId, email: user.email });

    const response = NextResponse.json({ ok: true });
    response.cookies.set('auth_token', freshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 60 * 60 * 24 * 7,
        path: '/',
    });
    return response;
}
