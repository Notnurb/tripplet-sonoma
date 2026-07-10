import { NextRequest, NextResponse } from 'next/server';
import { isDbConfigured } from '@/lib/db/neon';
import { fetchRandomPublishedArticle } from '@/lib/triplepedia/server';

export async function GET(req: NextRequest) {
    try {
        if (!isDbConfigured()) {
            return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
        }

        const category = req.nextUrl.searchParams.get('category') || null;
        const result = await fetchRandomPublishedArticle(category);

        if (result.error) {
            console.error('[triplepedia/random] failed to fetch random article', result.error);
            return NextResponse.json({ error: 'Failed to fetch random article' }, { status: 503 });
        }

        if (!result.article) {
            return NextResponse.json({ error: 'No articles found' }, { status: 404 });
        }

        return NextResponse.json({
            ...result.article,
            degraded: result.degraded,
        });
    } catch (error) {
        console.error('[triplepedia/random] unexpected error', error);
        return NextResponse.json({ error: 'Failed to fetch random article' }, { status: 500 });
    }
}
