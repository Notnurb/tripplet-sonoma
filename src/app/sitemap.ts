import type { MetadataRoute } from 'next';
import { SITE_BASE, flattenSitemapEntries } from '@/lib/sitemap-data';

export default function sitemap(): MetadataRoute.Sitemap {
    const now = new Date().toISOString();

    return flattenSitemapEntries().map((entry) => ({
        url: `${SITE_BASE}${entry.path}`,
        changeFrequency: entry.changeFrequency,
        priority: entry.priority,
        lastModified: now,
    }));
}
