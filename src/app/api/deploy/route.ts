import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { isDbConfigured, query } from '@/lib/db/neon';
import { auth } from '@/lib/auth/session';
import { searchLimiter, LIMITS, rateLimitResponse, getRateLimitToken } from '@/lib/security/rate-limit';

function slugify(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 40)
        .replace(/^-+|-+$/g, '');
}

function randomSuffix(): string {
    return randomBytes(3).toString('hex');
}

export async function POST(req: NextRequest) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
        }

        const token = getRateLimitToken(req, userId);
        try {
            await searchLimiter.check(LIMITS.search, token);
        } catch {
            return rateLimitResponse();
        }

        const { html, name } = await req.json();
        if (typeof html !== 'string' || html.length === 0) {
            return NextResponse.json({ error: 'html is required' }, { status: 400 });
        }
        if (html.length > 2 * 1024 * 1024) {
            return NextResponse.json({ error: 'html too large (max 2 MB)' }, { status: 413 });
        }
        if (name !== undefined && typeof name !== 'string') {
            return NextResponse.json({ error: 'name must be a string' }, { status: 400 });
        }

        if (!isDbConfigured()) {
            // Fallback: return a data URL that can be opened directly
            const encoded = encodeURIComponent(html);
            return NextResponse.json({
                url: `data:text/html;charset=utf-8,${encoded}`,
                slug: null,
                fallback: true,
            });
        }

        const baseSlug = name ? slugify(name) : 'project';
        let slug = `${baseSlug}-${randomSuffix()}`;

        let rows: Array<{ slug: string }>;
        try {
            rows = await query<{ slug: string }>(
                `INSERT INTO deployed_projects (slug, html, name)
                 VALUES ($1, $2, $3)
                 RETURNING slug`,
                [slug, html, name ?? 'Untitled'],
            );
        } catch {
            // Table may not exist — return a shareable data URL as fallback
            const encoded = Buffer.from(html).toString('base64');
            return NextResponse.json({
                url: `data:text/html;base64,${encoded}`,
                slug: null,
                fallback: true,
                note: 'Database not set up — using inline URL. Run the setup SQL to enable persistent deploys.',
            });
        }

        slug = rows[0].slug;
        const origin = req.headers.get('origin') ?? req.nextUrl.origin;
        return NextResponse.json({ url: `${origin}/p/${slug}`, slug });

    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Deploy failed';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
