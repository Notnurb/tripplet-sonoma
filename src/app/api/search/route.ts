import { NextRequest, NextResponse } from 'next/server';
import { searchLimiter, LIMITS, rateLimitResponse, getRateLimitToken } from '@/lib/security/rate-limit';
import { auth } from '@/lib/auth/session';
import { backendFetch } from '@/lib/backend';

export const runtime = 'nodejs';

const ALLOWED_SOURCES = new Set(['combined', 'exa', 'firecrawl']);

export async function POST(request: NextRequest) {
    try {
        const { userId } = await auth();
        const token = getRateLimitToken(request, userId);

        try {
            await searchLimiter.check(LIMITS.search, token);
        } catch {
            return rateLimitResponse();
        }

        const body = await request.json() as {
            query?: unknown;
            num_results?: unknown;
            category?: unknown;
            source?: unknown;
        };

        const { query, num_results = 10, category, source = 'combined' } = body;

        if (!query || typeof query !== 'string' || query.trim().length === 0) {
            return NextResponse.json({ error: 'Query is required' }, { status: 400 });
        }

        if (query.length > 500) {
            return NextResponse.json({ error: 'Query too long (max 500 characters)' }, { status: 400 });
        }

        const sourceStr = typeof source === 'string' ? source : 'combined';
        if (!ALLOWED_SOURCES.has(sourceStr)) {
            return NextResponse.json({ error: 'Invalid source' }, { status: 400 });
        }

        let endpoint = '/search/combined';
        if (sourceStr === 'exa') endpoint = '/search/exa';
        if (sourceStr === 'firecrawl') endpoint = '/search/firecrawl';

        const resp = await backendFetch(endpoint, {
            method: 'POST',
            body: JSON.stringify({
                query: query.trim(),
                num_results: Math.min(Math.max(Number(num_results) || 10, 1), 20),
                category
            }),
            signal: AbortSignal.timeout(10_000),
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'Backend error' })) as { error?: string };
            return NextResponse.json({ error: err.error || 'Search failed' }, { status: resp.status });
        }

        const data = await resp.json();
        return NextResponse.json(data);
    } catch {
        return NextResponse.json({ error: 'Search service unavailable' }, { status: 502 });
    }
}
