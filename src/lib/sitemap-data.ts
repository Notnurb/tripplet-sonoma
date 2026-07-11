export const SITE_BASE = 'https://tripplet.ai';

export type ChangeFrequency =
    | 'always'
    | 'hourly'
    | 'daily'
    | 'weekly'
    | 'monthly'
    | 'yearly'
    | 'never';

export type SitemapSection = {
    title: string;
    entries: Array<{
        path: string;
        changeFrequency: ChangeFrequency;
        priority: number;
    }>;
};

export const SITEMAP_SECTIONS: SitemapSection[] = [
    {
        title: 'Marketing',
        entries: [
            { path: '/', changeFrequency: 'daily', priority: 1.0 },
            { path: '/about', changeFrequency: 'monthly', priority: 0.8 },
            { path: '/features', changeFrequency: 'monthly', priority: 0.9 },
            { path: '/changelog', changeFrequency: 'weekly', priority: 0.7 },
            { path: '/privacy', changeFrequency: 'yearly', priority: 0.3 },
            { path: '/terms', changeFrequency: 'yearly', priority: 0.3 },
            { path: '/insiders', changeFrequency: 'monthly', priority: 0.6 },
            { path: '/skins', changeFrequency: 'monthly', priority: 0.5 },
        ],
    },
    {
        title: 'Auth',
        entries: [
            { path: '/login', changeFrequency: 'yearly', priority: 0.5 },
            { path: '/register', changeFrequency: 'yearly', priority: 0.5 },
            { path: '/sign-in', changeFrequency: 'yearly', priority: 0.4 },
            { path: '/forgot-password', changeFrequency: 'yearly', priority: 0.2 },
        ],
    },
    {
        title: 'Product',
        entries: [
            { path: '/chat', changeFrequency: 'daily', priority: 0.9 },
            { path: '/code', changeFrequency: 'daily', priority: 0.8 },
            { path: '/generate', changeFrequency: 'daily', priority: 0.7 },
            { path: '/agents', changeFrequency: 'weekly', priority: 0.7 },
            { path: '/hivemind', changeFrequency: 'weekly', priority: 0.7 },
            { path: '/studio', changeFrequency: 'weekly', priority: 0.6 },
            { path: '/coder', changeFrequency: 'daily', priority: 0.7 },
            { path: '/spark', changeFrequency: 'weekly', priority: 0.6 },
            { path: '/looptrain', changeFrequency: 'weekly', priority: 0.6 },
            { path: '/subscribe', changeFrequency: 'monthly', priority: 0.7 },
            { path: '/profile', changeFrequency: 'monthly', priority: 0.3 },
            { path: '/api-dashboard', changeFrequency: 'weekly', priority: 0.5 },
            { path: '/environment', changeFrequency: 'monthly', priority: 0.5 },
            { path: '/environment/report', changeFrequency: 'monthly', priority: 0.4 },
        ],
    },
    {
        title: 'Knowledge',
        entries: [{ path: '/triplepedia', changeFrequency: 'daily', priority: 0.8 }],
    },
    {
        title: 'Blog',
        entries: [
            { path: '/blog', changeFrequency: 'weekly', priority: 0.8 },
            { path: '/blog/march-2026-stability', changeFrequency: 'monthly', priority: 0.6 },
            { path: '/blog/introducing-v3-1-models', changeFrequency: 'monthly', priority: 0.6 },
            { path: '/blog/building-the-code-workspace', changeFrequency: 'monthly', priority: 0.6 },
            { path: '/blog/extended-thinking-explained', changeFrequency: 'monthly', priority: 0.6 },
            { path: '/blog/image-generation-pipeline', changeFrequency: 'monthly', priority: 0.6 },
            { path: '/blog/why-we-open-sourced', changeFrequency: 'monthly', priority: 0.6 },
            { path: '/blog/model-routing-architecture', changeFrequency: 'monthly', priority: 0.6 },
            { path: '/blog/web-search-integration', changeFrequency: 'monthly', priority: 0.6 },
        ],
    },
];

export function flattenSitemapEntries(): Array<{
    path: string;
    changeFrequency: ChangeFrequency;
    priority: number;
}> {
    return SITEMAP_SECTIONS.flatMap((section) => section.entries);
}
