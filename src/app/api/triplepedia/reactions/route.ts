import { NextRequest, NextResponse } from 'next/server';
import { isDbConfigured, query } from '@/lib/db/neon';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/triplepedia/reactions?articleId=...  → reaction counts for an article.
// Replaces the browser-side Supabase read in useTriplepediaReactions.
export async function GET(req: NextRequest) {
    if (!isDbConfigured()) {
        return NextResponse.json({ reactions: [] });
    }

    const articleId = req.nextUrl.searchParams.get('articleId')?.trim();
    if (!articleId || !UUID_RE.test(articleId)) {
        return NextResponse.json({ error: 'Invalid articleId' }, { status: 400 });
    }

    try {
        const reactions = await query<{ reaction_type: string; count: number }>(
            `SELECT reaction_type, count FROM triplepedia_reactions WHERE article_id = $1`,
            [articleId],
        );
        return NextResponse.json({ reactions });
    } catch (error) {
        console.error('[triplepedia/reactions] failed', error);
        return NextResponse.json({ reactions: [] });
    }
}
