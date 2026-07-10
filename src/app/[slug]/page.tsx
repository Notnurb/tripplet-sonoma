import { notFound } from 'next/navigation';
import { getPublishedSite, normalizeSlug } from '@/lib/coder/publish-store';

export const dynamic = 'force-dynamic';

interface PublishedAppPageProps {
    params: Promise<{ slug: string }>;
}

export default async function PublishedAppPage({ params }: PublishedAppPageProps) {
    const { slug: rawSlug } = await params;
    const slug = normalizeSlug(rawSlug);
    const site = await getPublishedSite(slug);

    if (!site) {
        notFound();
    }

    return (
        <main className="h-screen w-screen bg-white">
            <iframe
                srcDoc={site.html}
                title={site.metadata.title}
                className="h-full w-full border-0"
                sandbox="allow-scripts allow-modals allow-forms"
            />
        </main>
    );
}
