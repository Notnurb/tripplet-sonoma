import type { MetadataRoute } from 'next';

const BASE = 'https://tripplet.ai';

export default function sitemap(): MetadataRoute.Sitemap {
    const now = new Date().toISOString();

    // ── Static marketing / public pages ─────────────────────────────────────
    const staticPages: MetadataRoute.Sitemap = [
        { url: `${BASE}`,                changeFrequency: 'daily',   priority: 1.0,  lastModified: now },
        { url: `${BASE}/about`,           changeFrequency: 'monthly', priority: 0.8,  lastModified: now },
        { url: `${BASE}/features`,        changeFrequency: 'monthly', priority: 0.9,  lastModified: now },
        { url: `${BASE}/changelog`,       changeFrequency: 'weekly',  priority: 0.7,  lastModified: now },
        { url: `${BASE}/privacy`,         changeFrequency: 'yearly',  priority: 0.3,  lastModified: now },
        { url: `${BASE}/terms`,           changeFrequency: 'yearly',  priority: 0.3,  lastModified: now },
        { url: `${BASE}/insiders`,        changeFrequency: 'monthly', priority: 0.6,  lastModified: now },
        { url: `${BASE}/skins`,           changeFrequency: 'monthly', priority: 0.5,  lastModified: now },
    ];

    // ── Auth pages ──────────────────────────────────────────────────────────
    const authPages: MetadataRoute.Sitemap = [
        { url: `${BASE}/login`,           changeFrequency: 'yearly',  priority: 0.5,  lastModified: now },
        { url: `${BASE}/register`,        changeFrequency: 'yearly',  priority: 0.5,  lastModified: now },
        { url: `${BASE}/sign-in`,         changeFrequency: 'yearly',  priority: 0.4,  lastModified: now },
        { url: `${BASE}/forgot-password`, changeFrequency: 'yearly',  priority: 0.2,  lastModified: now },
    ];

    // ── Product / app pages ─────────────────────────────────────────────────
    const productPages: MetadataRoute.Sitemap = [
        { url: `${BASE}/chat`,            changeFrequency: 'daily',   priority: 0.9,  lastModified: now },
        { url: `${BASE}/code`,            changeFrequency: 'daily',   priority: 0.8,  lastModified: now },
        { url: `${BASE}/generate`,        changeFrequency: 'daily',   priority: 0.7,  lastModified: now },
        { url: `${BASE}/agents`,          changeFrequency: 'weekly',  priority: 0.7,  lastModified: now },
        { url: `${BASE}/hivemind`,        changeFrequency: 'weekly',  priority: 0.7,  lastModified: now },
        { url: `${BASE}/studio`,          changeFrequency: 'weekly',  priority: 0.6,  lastModified: now },
        { url: `${BASE}/coder`,           changeFrequency: 'daily',   priority: 0.7,  lastModified: now },
        { url: `${BASE}/spark`,           changeFrequency: 'weekly',  priority: 0.6,  lastModified: now },
        { url: `${BASE}/looptrain`,       changeFrequency: 'weekly',  priority: 0.6,  lastModified: now },
        { url: `${BASE}/subscribe`,       changeFrequency: 'monthly', priority: 0.7,  lastModified: now },
        { url: `${BASE}/profile`,         changeFrequency: 'monthly', priority: 0.3,  lastModified: now },
        { url: `${BASE}/api-dashboard`,   changeFrequency: 'weekly',  priority: 0.5,  lastModified: now },
        { url: `${BASE}/environment`,     changeFrequency: 'monthly', priority: 0.5,  lastModified: now },
        { url: `${BASE}/environment/report`, changeFrequency: 'monthly', priority: 0.4, lastModified: now },
        { url: `${BASE}/arena`,             changeFrequency: 'daily',   priority: 0.7,  lastModified: now },
        { url: `${BASE}/usage`,             changeFrequency: 'daily',   priority: 0.6,  lastModified: now },
    ];

    // ── Triplepedia (knowledge base) ────────────────────────────────────────
    const triplepediaPages: MetadataRoute.Sitemap = [
        { url: `${BASE}/triplepedia`,     changeFrequency: 'daily',   priority: 0.8,  lastModified: now },
    ];

    // ── Blog index + individual posts ───────────────────────────────────────
    const blogSlugs = [
        'march-2026-stability',
        'introducing-v3-1-models',
        'building-the-code-workspace',
        'extended-thinking-explained',
        'why-we-open-sourced',
        'model-routing-architecture',
        'web-search-integration',
    ];

    const blogPages: MetadataRoute.Sitemap = [
        { url: `${BASE}/blog`,            changeFrequency: 'weekly',  priority: 0.8,  lastModified: now },
        ...blogSlugs.map((slug) => ({
            url: `${BASE}/blog/${slug}`,
            changeFrequency: 'monthly' as const,
            priority: 0.6,
            lastModified: now,
        })),
    ];

    return [
        ...staticPages,
        ...authPages,
        ...productPages,
        ...triplepediaPages,
        ...blogPages,
    ];
}
