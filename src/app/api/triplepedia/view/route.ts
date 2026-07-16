import { NextRequest, NextResponse } from 'next/server';
import { isDbConfigured, query } from '@/lib/db/neon';
import { engagementLimiter, LIMITS, rateLimitResponse, getRateLimitToken } from '@/lib/security/rate-limit';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
    try {
        const { articleId } = await req.json();
        if (!articleId || !UUID_RE.test(articleId)) {
            return NextResponse.json({ error: 'Invalid articleId' }, { status: 400 });
        }

        // Keyed per caller *per article* so a single client can't inflate one
        // article's view count up to a whole hourly budget.
        const token = getRateLimitToken(req);
        try {
            await engagementLimiter.check(LIMITS.engagement, `${token}:view:${articleId}`);
        } catch {
            return rateLimitResponse();
        }

        if (!isDbConfigured()) {
            return NextResponse.json({ error: 'Triplepedia is temporarily unavailable — please try again soon.' }, { status: 503 });
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
