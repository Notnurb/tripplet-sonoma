import type { MetadataRoute } from 'next';
import { SITE_BASE } from '@/lib/sitemap-data';

export default function robots(): MetadataRoute.Robots {
    return {
        rules: {
            userAgent: '*',
            allow: '/',
            disallow: ['/api/', '/oauth/'],
        },
        sitemap: [`${SITE_BASE}/sitemap.xml`, `${SITE_BASE}/sitemap.txt`],
        host: SITE_BASE,
    };
}
