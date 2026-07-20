import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/session';
import { queryOne, withTransaction } from '@/lib/db/neon';
import { encryptText } from '@/lib/chat/crypto';
import { syncLimiter, LIMITS, rateLimitResponse, getRateLimitToken } from '@/lib/security/rate-limit';
import { parseBody, conversationSyncSchema, conversationDeleteSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Cloud persistence for the Sonoma chat shell. The client holds the message
 * list locally while streaming and pushes the full conversation here on a
 * debounce; each push replaces the stored copy (last-write-wins), so the
 * endpoint is idempotent and safe to retry. Titles and message content are
 * encrypted at rest via src/lib/chat/crypto.ts before touching the database.
 * Reads go through the existing GET /api/chat/history, which decrypts.
 */

function toDate(value: string | number | Date | undefined, fallback: Date): Date {
    if (value === undefined) return fallback;
    const d = value instanceof Date ? value : new Date(value);
    return isNaN(d.getTime()) ? fallback : d;
}

export async function POST(request: NextRequest) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: 'Sign in to sync conversations' }, { status: 401 });
        }

        try {
            await syncLimiter.check(LIMITS.sync, getRateLimitToken(request, userId));
        } catch {
            return rateLimitResponse();
        }

        const { data, error } = await parseBody(request, conversationSyncSchema);
        if (error) return error;

        const synced: string[] = [];
        const rejected: string[] = [];

        for (const conv of data.conversations) {
            // Ownership check outside the transaction: a conversation id that
            // exists under ANOTHER user must be refused, never overwritten.
            const existing = await queryOne<{ userId: string }>(
                `SELECT "userId" FROM "Conversation" WHERE id = $1 LIMIT 1`,
                [conv.id],
            );
            if (existing && existing.userId !== userId) {
                rejected.push(conv.id);
                continue;
            }

            const now = new Date();
            const firstUser = conv.messages.find((m) => m.role === 'user');
            const title = (conv.title || firstUser?.content.trim().slice(0, 40) || 'New Chat').slice(0, 200);
            const model = conv.model || 'tura-3';
            const createdAt = toDate(conv.createdAt, now);

            await withTransaction(async (tx) => {
                if (existing) {
                    await tx.query(
                        `UPDATE "Conversation"
                         SET title = $2, model = $3, "updatedAt" = now(), "deletedAt" = NULL
                         WHERE id = $1 AND "userId" = $4`,
                        [conv.id, encryptText(title), model, userId],
                    );
                    // Replace-all keeps the stored copy identical to the client's
                    // source of truth — edits, retries, and regenerations included.
                    await tx.query(`DELETE FROM "Message" WHERE "conversationId" = $1`, [conv.id]);
                } else {
                    await tx.query(
                        `INSERT INTO "Conversation" (id, "userId", title, model, "createdAt", "updatedAt")
                         VALUES ($1, $2, $3, $4, $5, now())`,
                        [conv.id, userId, encryptText(title), model, createdAt],
                    );
                }

                for (let i = 0; i < conv.messages.length; i++) {
                    const m = conv.messages[i];
                    // Preserve ordering even when client timestamps collide by
                    // spacing rows a millisecond apart from a stable base.
                    const ts = new Date(toDate(m.timestamp, createdAt).getTime() + i);
                    const metadata =
                        (m.attachments?.length || m.codeExecutions?.length)
                            ? JSON.stringify({ attachments: m.attachments, codeExecutions: m.codeExecutions })
                            : null;
                    // Message.id is a GLOBAL primary key, but client message ids
                    // (e.g. "u_abc1234") are only unique within one conversation —
                    // namespace them so two conversations can never collide and
                    // poison this transaction. Already-namespaced ids (from a
                    // history round-trip) pass through unchanged.
                    const messageId = m.id
                        ? (m.id.startsWith(`${conv.id}:`) ? m.id : `${conv.id}:${m.id}`).slice(0, 128)
                        : null;
                    await tx.query(
                        `INSERT INTO "Message" (id, "conversationId", role, content, attachments, "createdAt")
                         VALUES (COALESCE($1, gen_random_uuid()::text), $2, $3, $4, $5::jsonb, $6)`,
                        [messageId, conv.id, m.role, encryptText(m.content), metadata, ts],
                    );
                }
            });

            synced.push(conv.id);
        }

        return NextResponse.json({ synced, rejected });
    } catch (error) {
        console.error('Conversation sync error:', error);
        return NextResponse.json({ error: 'Failed to sync conversations' }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: 'Sign in to sync conversations' }, { status: 401 });
        }

        try {
            await syncLimiter.check(LIMITS.sync, getRateLimitToken(request, userId));
        } catch {
            return rateLimitResponse();
        }

        const { data, error } = await parseBody(request, conversationDeleteSchema);
        if (error) return error;

        await queryOne(
            `UPDATE "Conversation" SET "deletedAt" = now() WHERE id = $1 AND "userId" = $2 RETURNING id`,
            [data.id, userId],
        );

        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error('Conversation delete error:', error);
        return NextResponse.json({ error: 'Failed to delete conversation' }, { status: 500 });
    }
}
