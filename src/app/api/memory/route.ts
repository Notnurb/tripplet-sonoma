import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/session';
import {
    InvalidKeyError,
    MissingTableError,
    USER_MEMORY_CREATE_SQL,
    clearMemories,
    createMemory,
    deleteMemory,
    listMemories,
    searchMemories,
    updateMemory,
} from '@/lib/db/user-memory';
import { searchLimiter, LIMITS, rateLimitResponse, getRateLimitToken } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';

const MAX_CONTENT = 8000;
const MAX_TAGS = 12;
const MAX_TAG_LEN = 40;

function sanitizeTags(input: unknown): string[] {
    if (!Array.isArray(input)) return [];
    const seen = new Set<string>();
    for (const raw of input) {
        if (typeof raw !== 'string') continue;
        const t = raw.trim().toLowerCase();
        if (!t || t.length > MAX_TAG_LEN) continue;
        seen.add(t);
        if (seen.size >= MAX_TAGS) break;
    }
    return [...seen];
}

function missingTableResponse() {
    return NextResponse.json(
        {
            error:
                'Memory table not found. Open the Neon SQL Editor and run the SQL below, then refresh.',
            code: 'MISSING_TABLE',
            sql: USER_MEMORY_CREATE_SQL,
        },
        { status: 500 },
    );
}

function invalidKeyResponse(detail: string) {
    return NextResponse.json(
        {
            error: `The database rejected the connection (${detail}). The DATABASE_URL in .env is wrong, expired, or for a different project.`,
            code: 'INVALID_KEY',
            fixSteps: [
                'Open your Neon dashboard at https://console.neon.tech and select your project.',
                'Open "Connection Details" and copy the pooled connection string.',
                'Open .env and replace the value of DATABASE_URL with the copied connection string.',
                'Restart the dev server (the env is cached at startup).',
                'Click Retry below.',
            ],
        },
        { status: 500 },
    );
}

// POST — add / update / delete / clear / search memories for the authenticated user.
export async function POST(request: NextRequest) {
    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const limitToken = getRateLimitToken(request, userId);
    try {
        await searchLimiter.check(LIMITS.search, limitToken);
    } catch {
        return rateLimitResponse();
    }

    let body: { action?: unknown; content?: unknown; tags?: unknown; id?: unknown; query?: unknown; source?: unknown };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const action = typeof body.action === 'string' ? body.action : '';

    try {
        switch (action) {
            case 'add': {
                const content = typeof body.content === 'string' ? body.content.trim() : '';
                if (!content) return NextResponse.json({ error: 'content is required' }, { status: 400 });
                if (content.length > MAX_CONTENT) {
                    return NextResponse.json({ error: 'content too long' }, { status: 400 });
                }
                const tags = sanitizeTags(body.tags);
                const source = body.source === 'auto' ? 'auto' : 'explicit';
                const created = await createMemory({ userId, content, tags, source });
                return NextResponse.json({ memory: created });
            }
            case 'update': {
                const id = typeof body.id === 'string' ? body.id : '';
                if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
                const content = typeof body.content === 'string' ? body.content.trim() : undefined;
                if (content !== undefined && content.length > MAX_CONTENT) {
                    return NextResponse.json({ error: 'content too long' }, { status: 400 });
                }
                const tags = body.tags !== undefined ? sanitizeTags(body.tags) : undefined;
                const updated = await updateMemory({ userId, id, content, tags });
                return NextResponse.json({ memory: updated });
            }
            case 'delete': {
                const id = typeof body.id === 'string' ? body.id : '';
                if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
                const ok = await deleteMemory(userId, id);
                if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
                return NextResponse.json({ ok: true });
            }
            case 'clear': {
                const count = await clearMemories(userId);
                return NextResponse.json({ ok: true, deleted: count });
            }
            case 'search': {
                const query = typeof body.query === 'string' ? body.query.trim() : '';
                const results = await searchMemories(userId, query);
                return NextResponse.json({ results });
            }
            default:
                return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
        }
    } catch (e) {
        if (e instanceof InvalidKeyError) return invalidKeyResponse(e.message);
        if (e instanceof MissingTableError) return missingTableResponse();
        const msg = e instanceof Error ? e.message : 'Unknown error';
        return NextResponse.json(
            { error: `Could not ${action} memory: ${msg.slice(0, 300)}` },
            { status: 500 },
        );
    }
}

// GET — list the authenticated user's memories (most recent first).
export async function GET(request: NextRequest) {
    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const limitToken = getRateLimitToken(request, userId);
    try {
        await searchLimiter.check(LIMITS.search, limitToken);
    } catch {
        return rateLimitResponse();
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 50, 1), 200);

    try {
        const memories = await listMemories(userId, limit);
        return NextResponse.json({ memories });
    } catch (e) {
        if (e instanceof InvalidKeyError) return invalidKeyResponse(e.message);
        if (e instanceof MissingTableError) return missingTableResponse();
        const msg = e instanceof Error ? e.message : 'Unknown error';
        return NextResponse.json(
            { error: `Could not load memories: ${msg.slice(0, 300)}` },
            { status: 500 },
        );
    }
}
