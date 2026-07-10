import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/session';
import { query, queryOne } from '@/lib/db/neon';
import { verifyPassword } from '@/lib/auth/password';
import { profileLimiter, LIMITS, rateLimitResponse, getRateLimitToken } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

    let body: { email?: unknown; password?: unknown };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!email || !EMAIL_RE.test(email) || email.length > 254) {
        return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
    }
    if (!password) {
        return NextResponse.json({ error: 'Current password required to change email' }, { status: 400 });
    }

    const user = await queryOne<{ id: string; email: string; passwordHash: string | null }>(
        `SELECT id, email, "passwordHash" FROM "User" WHERE id = $1 LIMIT 1`,
        [userId],
    );

    if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (user.email === email) {
        return NextResponse.json({ ok: true, email });
    }

    const ok = await verifyPassword(password, user.passwordHash ?? '');
    if (!ok) {
        return NextResponse.json({ error: 'Password is incorrect' }, { status: 400 });
    }

    const existing = await queryOne<{ id: string }>(
        `SELECT id FROM "User" WHERE email = $1 LIMIT 1`,
        [email],
    );

    if (existing && existing.id !== userId) {
        return NextResponse.json({ error: 'Email already in use' }, { status: 409 });
    }

    try {
        await query(
            `UPDATE "User" SET email = $1, "updatedAt" = now() WHERE id = $2`,
            [email, userId],
        );
    } catch {
        return NextResponse.json({ error: 'Failed to update email' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, email });
}
