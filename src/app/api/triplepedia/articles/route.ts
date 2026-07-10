import { NextRequest, NextResponse } from 'next/server';
import { isDbConfigured, query } from '@/lib/db/neon';
import { listPublishedArticles, type TriplepediaSortMode } from '@/lib/triplepedia/server';
import { searchLimiter, LIMITS, rateLimitResponse, getRateLimitToken } from '@/lib/security/rate-limit';

export async function GET(req: NextRequest) {
    try {
        if (!isDbConfigured()) {
            return NextResponse.json(
                { articles: [], total: 0, available: false, error: 'Database not configured' },
                { status: 503 }
            );
        }

        const params = req.nextUrl.searchParams;
        const sort = (params.get('sort') || 'newest') as TriplepediaSortMode;
        const limit = Math.min(Number(params.get('limit')) || 24, 50);
        const offset = Math.max(Number(params.get('offset')) || 0, 0);
        const query = params.get('q')?.trim() || undefined;

        const result = await listPublishedArticles({
            sort: sort === 'most_viewed' ? 'most_viewed' : 'newest',
            limit,
            offset,
            query,
        });

        if (result.error) {
            console.error('[triplepedia/articles] failed to load articles', result.error);
            return NextResponse.json(
                { articles: [], total: 0, available: false, error: 'Failed to load Triplepedia articles' },
                { status: 503 }
            );
        }

        return NextResponse.json({
            articles: result.articles,
            total: result.total,
            available: true,
            degraded: result.degraded,
        });
    } catch (error) {
        console.error('[triplepedia/articles] unexpected error', error);
        return NextResponse.json(
            { articles: [], total: 0, available: false, error: 'Failed to load Triplepedia articles' },
            { status: 503 }
        );
    }
}

// POST: insert a published article. Used by the Triplepedia capture/training
// tools and the public "suggest article" form (previously these wrote to the
// database directly from the browser via the Supabase client).
export async function POST(req: NextRequest) {
    try {
        const token = getRateLimitToken(req);
        try {
            await searchLimiter.check(LIMITS.search, token);
        } catch {
            return rateLimitResponse();
        }

        if (!isDbConfigured()) {
            return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
        }

        const body = await req.json() as Record<string, unknown>;

        // Batch insert: { articles: [...] }. Used by the high-throughput "turbo"
        // capture tool. Inserts up to 500 rows per request, skipping duplicates.
        if (Array.isArray(body.articles)) {
            const items = body.articles.slice(0, 500) as Array<Record<string, unknown>>;
            let inserted = 0;
            for (const item of items) {
                const t = typeof item.title === 'string' ? item.title.trim() : '';
                const s = typeof item.slug === 'string' ? item.slug.trim() : '';
                if (!t || !s) continue;
                const rows = await query<{ id: string }>(
                    `INSERT INTO triplepedia_articles
                        (title, slug, summary, sections, infobox, category, tags, submitted_by, status)
                     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7::text[], $8, $9)
                     ON CONFLICT (slug) DO NOTHING
                     RETURNING id`,
                    [
                        t,
                        s,
                        typeof item.summary === 'string' ? item.summary : '',
                        JSON.stringify(Array.isArray(item.sections) ? item.sections : []),
                        JSON.stringify(Array.isArray(item.infobox) ? item.infobox : []),
                        typeof item.category === 'string' ? item.category : null,
                        Array.isArray(item.tags) ? item.tags.filter((x) => typeof x === 'string') : [],
                        typeof item.submitted_by === 'string' ? item.submitted_by : null,
                        item.status === 'pending' ? 'pending' : 'published',
                    ],
                );
                if (rows.length > 0) inserted += 1;
            }
            return NextResponse.json({ ok: true, inserted });
        }

        const title = typeof body.title === 'string' ? body.title.trim() : '';
        const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
        if (!title || !slug) {
            return NextResponse.json({ error: 'title and slug are required' }, { status: 400 });
        }

        const summary = typeof body.summary === 'string' ? body.summary : '';
        const sections = Array.isArray(body.sections) ? body.sections : [];
        const infobox = Array.isArray(body.infobox) ? body.infobox : [];
        const category = typeof body.category === 'string' ? body.category : null;
        const tags = Array.isArray(body.tags) ? body.tags.filter((t) => typeof t === 'string') : [];
        const submittedBy = typeof body.submitted_by === 'string' ? body.submitted_by : null;
        const status = body.status === 'pending' ? 'pending' : 'published';

        const rows = await query<{ id: string; slug: string }>(
            `INSERT INTO triplepedia_articles
                (title, slug, summary, sections, infobox, category, tags, submitted_by, status)
             VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7::text[], $8, $9)
             ON CONFLICT (slug) DO NOTHING
             RETURNING id, slug`,
            [
                title,
                slug,
                summary,
                JSON.stringify(sections),
                JSON.stringify(infobox),
                category,
                tags,
                submittedBy,
                status,
            ],
        );

        if (rows.length === 0) {
            return NextResponse.json({ error: 'An article with that slug already exists', duplicate: true }, { status: 409 });
        }

        return NextResponse.json({ ok: true, id: rows[0].id, slug: rows[0].slug });
    } catch (error) {
        console.error('[triplepedia/articles] insert failed', error);
        return NextResponse.json({ error: 'Failed to save article' }, { status: 500 });
    }
}
