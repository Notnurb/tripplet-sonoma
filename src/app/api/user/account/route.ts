import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/session';
import { query, queryOne } from '@/lib/db/neon';
import { verifyPassword } from '@/lib/auth/password';
import prisma from '@/lib/db/prisma';
import { clearMemories } from '@/lib/db/user-memory';
import { composioEnabled, listConnectedAccounts, deleteConnectedAccount } from '@/lib/composio/client';
import { profileLimiter, LIMITS, rateLimitResponse, getRateLimitToken } from '@/lib/security/rate-limit';
import { invalidateSessionsNow } from '@/lib/auth/session-store';

export const runtime = 'nodejs';

// Best-effort cleanup for state this app writes but doesn't own via a Prisma
// FK: Composio connections live entirely on Composio's side (keyed by our
// userId), and developer keys / OAuth tokens live in raw (non-Prisma) tables
// keyed by email (see db/schema.sql). None of these block the account delete
// if they fail — an orphaned Composio connection or dead API key is far less
// harmful than refusing to let someone delete their account.
async function bestEffortCleanup(userId: string, email: string): Promise<void> {
    if (composioEnabled()) {
        try {
            const connections = await listConnectedAccounts(userId);
            await Promise.all(connections.map((c) => deleteConnectedAccount(c.id).catch(() => { })));
        } catch {
            // Composio unreachable — leave connections for manual cleanup.
        }
    }

    await clearMemories(userId).catch(() => { });

    await query(`UPDATE developer_api_keys SET is_revoked = true WHERE user_email = $1`, [email]).catch(() => { });
    await query(`DELETE FROM oauth_access_tokens WHERE user_email = $1`, [email]).catch(() => { });
    await query(`DELETE FROM oauth_authorization_codes WHERE user_email = $1`, [email]).catch(() => { });
}

export async function DELETE(req: NextRequest) {
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

    let body: { password?: unknown };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const password = typeof body.password === 'string' ? body.password : '';
    if (!password) {
        return NextResponse.json({ error: 'Current password required to delete your account' }, { status: 400 });
    }

    const user = await queryOne<{ id: string; email: string; passwordHash: string | null }>(
        `SELECT id, email, "passwordHash" FROM "User" WHERE id = $1 LIMIT 1`,
        [userId],
    );
    if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const ok = await verifyPassword(password, user.passwordHash ?? '');
    if (!ok) {
        return NextResponse.json({ error: 'Password is incorrect' }, { status: 400 });
    }

    await bestEffortCleanup(userId, user.email);

    try {
        await prisma.$transaction([
            // AIUsage has no onDelete: Cascade on its User relation — it would
            // block the user delete below with a FK violation if left in place.
            prisma.aIUsage.deleteMany({ where: { userId } }),
            // TelegramBot/MessageFeedback have no FK to User at all (plain
            // userId columns), so they'd silently survive as orphans otherwise.
            prisma.telegramBot.deleteMany({ where: { userId } }),
            prisma.messageFeedback.deleteMany({ where: { userId } }),
            // Cascades to Conversation→Message, FileUpload, PasswordResetToken,
            // AuthSession, and Account via their onDelete: Cascade FKs.
            prisma.user.delete({ where: { id: userId } }),
        ]);
    } catch {
        return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 });
    }

    await invalidateSessionsNow(userId).catch(() => { });

    const response = NextResponse.json({ ok: true });
    response.cookies.set('auth_token', '', {
        httpOnly: true,
        expires: new Date(0),
        path: '/',
    });
    return response;
}
