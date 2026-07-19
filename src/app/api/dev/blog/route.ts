import { NextRequest, NextResponse } from 'next/server';
import { isDevModeActive } from '@/lib/dev-mode';
import { createBlogPost } from '@/lib/dev-blog';

export const dynamic = 'force-dynamic';

// Dev-mode blog authoring (called by the DevModePanel "q" popup). Writes the
// new post into the real blog source files — see src/lib/dev-blog.ts — so it
// hot-reloads locally and ships with the next commit.
//
// Hard-gated: outside dev-mode on the dev server this route plays dead with a
// 404. It can never write files on a deployed build.
export async function POST(req: NextRequest) {
    if (!isDevModeActive() || process.env.NODE_ENV !== 'development') {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    let payload: Record<string, unknown>;
    try {
        payload = (await req.json()) as Record<string, unknown>;
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const title = readString(payload.title, 120);
    const excerpt = readString(payload.excerpt, 500);
    const body = readString(payload.body, 20_000);
    const category = readString(payload.category, 40) ?? 'Engineering';

    if (!title) return NextResponse.json({ error: 'Title is required (max 120 chars).' }, { status: 400 });
    if (!excerpt) return NextResponse.json({ error: 'Excerpt is required (max 500 chars).' }, { status: 400 });
    if (!body) return NextResponse.json({ error: 'Body is required (max 20,000 chars).' }, { status: 400 });

    try {
        const result = await createBlogPost({ title, category, excerpt, body });
        return NextResponse.json(result);
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to write the post.' },
            { status: 500 },
        );
    }
}

function readString(value: unknown, maxLength: number): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > maxLength) return null;
    return trimmed;
}
