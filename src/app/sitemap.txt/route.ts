import { SITE_BASE, flattenSitemapEntries } from '@/lib/sitemap-data';

export const dynamic = 'force-static';

export async function GET() {
    const body = flattenSitemapEntries()
        .map((entry) => `${SITE_BASE}${entry.path}`)
        .join('\n');

    return new Response(body, {
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
        },
    });
}
