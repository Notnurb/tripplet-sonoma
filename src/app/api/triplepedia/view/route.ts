import { NextRequest, NextResponse } from 'next/server';
import { isDbConfigured, query } from '@/lib/db/neon';
import { searchLimiter, LIMITS, rateLimitResponse, getRateLimitToken } from '@/lib/security/rate-limit';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
    try {
        const token = getRateLimitToken(req);
        try {
            await searchLimiter.check(LIMITS.search, token);
        } catch {
            return rateLimitResponse();
        }

        const { articleId } = await req.json();
        if (!articleId || !UUID_RE.test(articleId)) {
            return NextResponse.json({ error: 'Invalid articleId' }, { status: 400 });
        }

        if (!isDbConfigured()) {
            return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
        }

        await query(
            `UPDATE triplepedia_articles SET view_count = view_count + 1 WHERE id = $1`,
            [articleId],
        );

        return NextResponse.json({ ok: true });
    } catch {
        return NextResponse.json({ error: 'Failed to record view' }, { status: 500 });
    }
}
