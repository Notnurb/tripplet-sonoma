import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/session';
import prisma from '@/lib/db/prisma';
import { searchLimiter, LIMITS, rateLimitResponse, getRateLimitToken } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';

const SNIPPET_MAX = 400;

interface Body {
    messageId?: unknown;
    rating?: unknown;          // 1 | -1 | 0 (0 = clear rating)
    conversationId?: unknown;
    model?: unknown;
    content?: unknown;
}

export async function POST(request: NextRequest) {
    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const limitToken = getRateLimitToken(request, userId);
    try {
        await searchLimiter.check(LIMITS.search, limitToken);
    } catch {
        return rateLimitResponse();
    }

    let body: Body;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const messageId = typeof body.messageId === 'string' ? body.messageId : '';
    if (!messageId || messageId.length > 128) {
        return NextResponse.json({ error: 'messageId is required' }, { status: 400 });
    }

    const ratingRaw = typeof body.rating === 'number' ? body.rating : NaN;
    if (![1, -1, 0].includes(ratingRaw)) {
        return NextResponse.json({ error: 'rating must be 1, -1, or 0' }, { status: 400 });
    }

    // Rating of 0 = the user un-clicked their previous rating.
    if (ratingRaw === 0) {
        await prisma.messageFeedback.deleteMany({
            where: { userId, messageId },
        });
        return NextResponse.json({ ok: true, cleared: true });
    }

    const conversationId =
        typeof body.conversationId === 'string' && body.conversationId.length <= 128
            ? body.conversationId
            : null;
    const model =
        typeof body.model === 'string' && body.model.length <= 64 ? body.model : null;
    const content = typeof body.content === 'string' ? body.content : '';
    const contentLength = content.length;
    const contentSnippet = content.slice(0, SNIPPET_MAX);

    const saved = await prisma.messageFeedback.upsert({
        where: { userId_messageId: { userId, messageId } },
        update: {
            rating: ratingRaw,
            conversationId,
            model,
            contentLength,
            contentSnippet,
        },
        create: {
            userId,
            messageId,
            conversationId,
            model,
            rating: ratingRaw,
            contentLength,
            contentSnippet,
        },
    });

    return NextResponse.json({ ok: true, id: saved.id, rating: saved.rating });
}
