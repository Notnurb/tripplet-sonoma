import { NextRequest, NextResponse } from 'next/server';
import { isDbConfigured, query } from '@/lib/db/neon';

// GET /api/triplepedia/article?slug=...  → full published article + related.
// Replaces the browser-side Supabase reads on the article page.
export async function GET(req: NextRequest) {
    if (!isDbConfigured()) {
        return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const slug = req.nextUrl.searchParams.get('slug')?.trim();
    if (!slug) {
        return NextResponse.json({ error: 'slug is required' }, { status: 400 });
    }

    try {
        const rows = await query<Record<string, unknown>>(
            `SELECT * FROM triplepedia_articles WHERE slug = $1 AND status = 'published' LIMIT 1`,
            [slug],
        );
        const article = rows[0];
        if (!article) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        let related: Record<string, unknown>[] = [];
        if (typeof article.category === 'string' && article.category) {
            related = await query<Record<string, unknown>>(
                `SELECT id, title, slug, summary, category
                 FROM triplepedia_articles
                 WHERE status = 'published' AND category = $1 AND id <> $2
                 LIMIT 4`,
                [article.category, article.id],
            );
        }

        return NextResponse.json({ article, related });
    } catch (error) {
        console.error('[triplepedia/article] failed', error);
        return NextResponse.json({ error: 'Failed to load article' }, { status: 500 });
    }
}
