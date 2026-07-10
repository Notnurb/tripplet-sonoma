import { query } from '@/lib/db/neon';

export type TriplepediaSortMode = 'newest' | 'most_viewed';

export interface TriplepediaArticleSummary {
    id: string;
    title: string;
    slug: string;
    summary: string;
    category: string | null;
    view_count: number;
    sections: Array<{ heading?: string; content?: string; subheadings?: Array<{ heading?: string; content?: string }> }>;
    infobox: Array<{ label?: string; value?: string | string[] }>;
    created_at: string;
}

export interface TriplepediaRandomArticle {
    id: string;
    title: string;
    slug: string;
    summary?: string;
    category: string | null;
}

export interface TriplepediaListResult {
    articles: TriplepediaArticleSummary[];
    total: number;
    degraded: boolean;
    error: Error | null;
}

export interface TriplepediaRandomResult {
    article: TriplepediaRandomArticle | null;
    degraded: boolean;
    error: Error | null;
}

function normalizeArticle(row: Record<string, unknown>): TriplepediaArticleSummary {
    return {
        id: String(row.id ?? ''),
        title: String(row.title ?? ''),
        slug: String(row.slug ?? ''),
        summary: String(row.summary ?? ''),
        category: typeof row.category === 'string' ? row.category : null,
        view_count: typeof row.view_count === 'number' ? row.view_count : Number(row.view_count ?? 0),
        sections: Array.isArray(row.sections)
            ? (row.sections as TriplepediaArticleSummary['sections'])
            : [],
        infobox: Array.isArray(row.infobox)
            ? (row.infobox as TriplepediaArticleSummary['infobox'])
            : [],
        created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ''),
    };
}

function normalizeRandomArticle(row: Record<string, unknown>): TriplepediaRandomArticle {
    return {
        id: String(row.id ?? ''),
        title: String(row.title ?? ''),
        slug: String(row.slug ?? ''),
        summary: typeof row.summary === 'string' ? row.summary : undefined,
        category: typeof row.category === 'string' ? row.category : null,
    };
}

export async function listPublishedArticles(options: {
    sort: TriplepediaSortMode;
    limit: number;
    offset: number;
    query?: string;
}): Promise<TriplepediaListResult> {
    const { sort, limit, offset, query: search } = options;
    try {
        const params: unknown[] = [];
        let where = `status = 'published'`;
        if (search) {
            params.push(`%${search}%`);
            where += ` AND title ILIKE $${params.length}`;
        }
        const orderBy = sort === 'most_viewed' ? 'view_count' : 'created_at';

        const countRows = await query<{ count: string }>(
            `SELECT COUNT(*)::int AS count FROM triplepedia_articles WHERE ${where}`,
            params,
        );
        const total = Number(countRows[0]?.count ?? 0);

        params.push(limit);
        const limitIdx = params.length;
        params.push(offset);
        const offsetIdx = params.length;

        const rows = await query<Record<string, unknown>>(
            `SELECT id, title, slug, summary, category, view_count, sections, infobox, created_at
             FROM triplepedia_articles
             WHERE ${where}
             ORDER BY ${orderBy} DESC
             LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
            params,
        );

        return {
            articles: rows.map(normalizeArticle),
            total,
            degraded: false,
            error: null,
        };
    } catch (error) {
        return { articles: [], total: 0, degraded: false, error: error as Error };
    }
}

export async function fetchRandomPublishedArticle(
    category: string | null,
): Promise<TriplepediaRandomResult> {
    try {
        const params: unknown[] = [];
        let where = `status = 'published'`;
        if (category) {
            params.push(category);
            where += ` AND category = $${params.length}`;
        }
        const rows = await query<Record<string, unknown>>(
            `SELECT id, title, slug, summary, category
             FROM triplepedia_articles
             WHERE ${where}
             ORDER BY random()
             LIMIT 1`,
            params,
        );
        const article = rows[0] ? normalizeRandomArticle(rows[0]) : null;
        return { article, degraded: false, error: null };
    } catch (error) {
        return { article: null, degraded: false, error: error as Error };
    }
}
