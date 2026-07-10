import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/session';
import { query, queryOne } from '@/lib/db/neon';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { profileLimiter, LIMITS, rateLimitResponse, getRateLimitToken } from '@/lib/security/rate-limit';

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
    if (newPassword.length < 8) {
        return NextResponse.json({ error: 'New password must be at least 8 characters' }, { status: 400 });
    }
    if (newPassword.length > 256) {
        return NextResponse.json({ error: 'Password too long' }, { status: 400 });
    }

    const user = await queryOne<{ id: string; passwordHash: string | null }>(
        `SELECT id, "passwordHash" FROM "User" WHERE id = $1 LIMIT 1`,
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

    return NextResponse.json({ ok: true });
}
