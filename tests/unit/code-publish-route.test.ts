import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Regression test for a real info-leak: the unauthenticated GET on
 * /api/code/publish returned `ownerUserId` for every published site (list
 * and single-slug lookup) and, for a single slug, the full `files[]` source
 * array — letting anyone enumerate which internal user account owns a given
 * published app and rip its exact source, when the intended public surface
 * is just the rendered HTML.
 */

const SITE = {
    metadata: { slug: 'demo', title: 'Demo App', description: 'x', ownerUserId: 'user-secret-id-123' },
    html: '<html><body>hi</body></html>',
    files: [{ path: 'src/App.tsx', content: 'SECRET SOURCE CODE', language: 'typescript' }],
    publishedAt: '2026-01-01T00:00:00.000Z',
};

vi.mock('@/lib/coder/publish-store', () => ({
    getPublishedSite: vi.fn(async (slug: string) => (slug === 'demo' ? SITE : null)),
    listPublishedSites: vi.fn(async () => [SITE]),
    normalizeSlug: (s: string) => s.toLowerCase().trim(),
    savePublishedSite: vi.fn(),
}));

import { GET } from '@/app/api/code/publish/route';

function req(qs: string): NextRequest {
    return new NextRequest(`http://localhost/api/code/publish${qs}`);
}

describe('GET /api/code/publish', () => {
    it('single-slug lookup omits ownerUserId and files[] (source code)', async () => {
        const res = await GET(req('?slug=demo'));
        const body = await res.json();
        expect(body.html).toBe(SITE.html);
        expect(body.metadata.title).toBe('Demo App');
        expect(body.metadata.ownerUserId).toBeUndefined();
        expect(body.files).toBeUndefined();
        expect(JSON.stringify(body)).not.toContain('SECRET SOURCE CODE');
        expect(JSON.stringify(body)).not.toContain('user-secret-id-123');
    });

    it('list (no slug) omits ownerUserId and html/files for every site', async () => {
        const res = await GET(req(''));
        const body = await res.json();
        expect(body.sites).toHaveLength(1);
        expect(body.sites[0].metadata.ownerUserId).toBeUndefined();
        expect(body.sites[0].html).toBeUndefined();
        expect(body.sites[0].files).toBeUndefined();
        expect(JSON.stringify(body)).not.toContain('user-secret-id-123');
    });

    it('unknown slug → 404, not a leak of internal state', async () => {
        const res = await GET(req('?slug=nope'));
        expect(res.status).toBe(404);
    });
});
