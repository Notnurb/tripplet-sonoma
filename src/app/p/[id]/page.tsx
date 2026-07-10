import { isDbConfigured, queryOne } from '@/lib/db/neon';
import { notFound } from 'next/navigation';

interface Props {
    params: Promise<{ id: string }>;
}

async function getProject(slug: string) {
    if (!isDbConfigured()) return null;
    try {
        const data = await queryOne<{ html: string; name: string }>(
            `SELECT html, name FROM deployed_projects WHERE slug = $1 LIMIT 1`,
            [slug],
        );
        return data;
    } catch {
        return null;
    }
}

export async function generateMetadata({ params }: Props) {
    const { id } = await params;
    return { title: `${id} — Tripplet` };
}

export default async function DeployedProjectPage({ params }: Props) {
    const { id } = await params;
    const project = await getProject(id);

    if (!project) notFound();

    // Serve the HTML directly via a full-page iframe that fills the screen
    return (
        <html>
            <head>
                <meta charSet="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>{project.name} — Tripplet</title>
                <style>{`
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    html, body { width: 100%; height: 100%; overflow: hidden; }
                    iframe { width: 100%; height: 100%; border: none; display: block; }
                `}</style>
            </head>
            <body>
                <iframe
                    srcDoc={project.html}
                    sandbox="allow-scripts allow-forms allow-popups"
                    title={project.name}
                />
            </body>
        </html>
    );
}
