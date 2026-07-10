import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth/session';
import { CodeFile, CodePublishMetadata } from '@/types';
import {
    getPublishedSite,
    listPublishedSites,
    normalizeSlug,
    savePublishedSite,
} from '@/lib/coder/publish-store';
import { searchLimiter, LIMITS, rateLimitResponse, getRateLimitToken } from '@/lib/security/rate-limit';

interface PublishBody {
    metadata: CodePublishMetadata;
    html: string;
    files: CodeFile[];
    publishedAt?: string;
}

function escapeAttr(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function injectMetadata(html: string, metadata: CodePublishMetadata): string {
    let result = html || '<!DOCTYPE html><html><head></head><body></body></html>';
    const ensureHead = /<head>/i.test(result) ? result : result.replace(/<html[^>]*>/i, '$&<head></head>');
    result = ensureHead;

    if (metadata.title) {
        const safeTitle = escapeAttr(metadata.title);
        if (/<title>[\s\S]*?<\/title>/i.test(result)) {
            result = result.replace(/<title>[\s\S]*?<\/title>/i, `<title>${safeTitle}</title>`);
        } else {
            result = result.replace(/<head>/i, `<head><title>${safeTitle}</title>`);
        }
    }

    if (metadata.description) {
        const safeDescription = escapeAttr(metadata.description);
        if (/<meta\s+name=["']description["'][^>]*>/i.test(result)) {
            result = result.replace(
                /<meta\s+name=["']description["'][^>]*>/i,
                `<meta name="description" content="${safeDescription}" />`
            );
        } else {
            result = result.replace(/<head>/i, `<head><meta name="description" content="${safeDescription}" />`);
        }
    }

    if (metadata.favicon) {
        const safeFavicon = escapeAttr(metadata.favicon);
        if (/<link\s+rel=["']icon["'][^>]*>/i.test(result)) {
            result = result.replace(/<link\s+rel=["']icon["'][^>]*>/i, `<link rel="icon" href="${safeFavicon}" />`);
        } else {
            result = result.replace(/<head>/i, `<head><link rel="icon" href="${safeFavicon}" />`);
        }
    }

    if (metadata.image) {
        const safeImage = escapeAttr(metadata.image);
        if (/<meta\s+property=["']og:image["'][^>]*>/i.test(result)) {
            result = result.replace(
                /<meta\s+property=["']og:image["'][^>]*>/i,
                `<meta property="og:image" content="${safeImage}" />`
            );
        } else {
            result = result.replace(/<head>/i, `<head><meta property="og:image" content="${safeImage}" />`);
        }
    }

    return result;
}

export async function GET(request: NextRequest) {
    const slug = request.nextUrl.searchParams.get('slug')?.trim();
    if (!slug) {
        const all = await listPublishedSites();
        return Response.json({ sites: all.map((s) => ({ ...s, html: undefined })) });
    }

    const normalized = normalizeSlug(slug);
    const site = await getPublishedSite(normalized);
    if (!site) {
        return Response.json({ error: 'Published app not found' }, { status: 404 });
    }

    return Response.json(site);
}

export async function POST(request: NextRequest) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return Response.json({ error: 'Authentication required' }, { status: 401 });
        }

        const limitToken = getRateLimitToken(request, userId);
        try {
            await searchLimiter.check(LIMITS.search, limitToken);
        } catch {
            return rateLimitResponse();
        }

        const body: PublishBody = await request.json();
        const metadata = body.metadata;

        if (!metadata?.slug || !metadata?.title) {
            return Response.json({ error: 'slug and title are required' }, { status: 400 });
        }

        const slug = normalizeSlug(metadata.slug);
        if (!slug || slug.length < 2) {
            return Response.json({ error: 'slug must be at least 2 characters' }, { status: 400 });
        }

        const existing = await getPublishedSite(slug);
        if (existing && existing.metadata.ownerUserId && existing.metadata.ownerUserId !== userId) {
            return Response.json({ error: 'That slug is already taken' }, { status: 409 });
        }

        const finalMetadata: CodePublishMetadata = {
            ...metadata,
            slug,
            title: metadata.title.trim(),
            ownerUserId: userId,
        };

        const html = injectMetadata(body.html || '', finalMetadata);
        const publishedAt = body.publishedAt || new Date().toISOString();

        await savePublishedSite({
            metadata: finalMetadata,
            html,
            files: body.files || [],
            publishedAt,
        });

        return Response.json({
            slug,
            url: `/${slug}`,
            metadata: finalMetadata,
            publishedAt,
        });
    } catch (error: unknown) {
        return Response.json(
            { error: error instanceof Error ? error.message : 'Failed to publish app' },
            { status: 500 }
        );
    }
}
