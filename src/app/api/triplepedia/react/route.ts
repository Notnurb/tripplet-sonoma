import { NextRequest, NextResponse } from 'next/server';
import { isDbConfigured, query } from '@/lib/db/neon';
import { searchLimiter, LIMITS, rateLimitResponse, getRateLimitToken } from '@/lib/security/rate-limit';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_REACTIONS = new Set(['mind_blown', 'til', 'want_more', 'funny']);

export async function POST(req: NextRequest) {
    try {
        const token = getRateLimitToken(req);
        try {
            await searchLimiter.check(LIMITS.search, token);
        } catch {
            return rateLimitResponse();
        }

        const { articleId, reactionType } = await req.json();

        if (!articleId || !UUID_RE.test(articleId)) {
            return NextResponse.json({ error: 'Invalid articleId' }, { status: 400 });
        }
        if (!reactionType || !VALID_REACTIONS.has(reactionType)) {
            return NextResponse.json({ error: 'Invalid reactionType' }, { status: 400 });
        }

        if (!isDbConfigured()) {
            return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
        }

        await query(
            `INSERT INTO triplepedia_reactions (article_id, reaction_type, count)
             VALUES ($1, $2, 1)
             ON CONFLICT (article_id, reaction_type)
             DO UPDATE SET count = triplepedia_reactions.count + 1`,
            [articleId, reactionType],
        );

        return NextResponse.json({ ok: true });
    } catch {
        return NextResponse.json({ error: 'Failed to record reaction' }, { status: 500 });
    }
}
