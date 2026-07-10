import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/session';
import {
    InvalidKeyError,
    MissingTableError,
    USER_MEMORY_CREATE_SQL,
    clearMemories,
    createMemory,
} from '@/lib/db/user-memory';
import { searchLimiter, LIMITS, rateLimitResponse, getRateLimitToken } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';

const MAX_CONTENT = 8000;
const MAX_MEMORIES_PER_IMPORT = 200;
const MAX_TAGS = 12;
const MAX_TAG_LEN = 40;

interface ParsedMemory {
    content: string;
    tags: string[];
}

interface ImportShape {
    profile?: unknown;
    memories?: unknown;
}

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

// Extracts the first JSON object in the input, even if it's wrapped in a
// ```json fenced block or surrounded by commentary. Returns null if nothing
// JSON-shaped is found.
function extractJsonBlock(raw: string): unknown | null {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
        try {
            return JSON.parse(fenced[1].trim());
        } catch {
            /* fall through */
        }
    }
    // Find first balanced { ... } block at top level by greedy scan.
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start !== -1 && end > start) {
        try {
            return JSON.parse(raw.slice(start, end + 1));
        } catch {
            /* fall through */
        }
    }
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

// Falls back to interpreting the input as a plain bullet list — one fact per
// line. Lines starting with `-`, `*`, `•`, or numbered (`1.`) are stripped of
// the bullet. Empty lines are skipped.
function parseAsList(raw: string): ParsedMemory[] {
    const lines = raw.split(/\r?\n/);
    const memories: ParsedMemory[] = [];
    for (const line of lines) {
        const stripped = line.replace(/^\s*(?:[-*•]\s+|\d+[.)]\s+)/, '').trim();
        if (!stripped) continue;
        if (stripped.length > MAX_CONTENT) continue;
        memories.push({ content: stripped, tags: [] });
        if (memories.length >= MAX_MEMORIES_PER_IMPORT) break;
    }
    return memories;
}

function normalizeMemoryArray(raw: unknown): ParsedMemory[] {
    if (!Array.isArray(raw)) return [];
    const out: ParsedMemory[] = [];
    for (const item of raw) {
        if (out.length >= MAX_MEMORIES_PER_IMPORT) break;
        if (typeof item === 'string') {
            const trimmed = item.trim();
            if (trimmed && trimmed.length <= MAX_CONTENT) {
                out.push({ content: trimmed, tags: [] });
            }
            continue;
        }
        if (item && typeof item === 'object') {
            const rec = item as Record<string, unknown>;
            const content =
                typeof rec.content === 'string'
                    ? rec.content
                    : typeof rec.text === 'string'
                        ? rec.text
                        : typeof rec.fact === 'string'
                            ? rec.fact
                            : '';
            const trimmed = content.trim();
            if (!trimmed || trimmed.length > MAX_CONTENT) continue;
            out.push({ content: trimmed, tags: sanitizeTags(rec.tags) });
        }
    }
    return out;
}

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

    let body: { raw?: unknown; replace?: unknown };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const raw = typeof body.raw === 'string' ? body.raw.trim() : '';
    const replace = body.replace === true;
    if (!raw) {
        return NextResponse.json({ error: 'raw text is required' }, { status: 400 });
    }
    if (raw.length > 200_000) {
        return NextResponse.json({ error: 'Input too large' }, { status: 400 });
    }

    // Try JSON-with-{profile, memories} first; fall back to bare array, fall
    // back to bulleted list. This makes the importer tolerant of slightly
    // off-spec output from external assistants.
    let profile = '';
    let memories: ParsedMemory[] = [];

    const json = extractJsonBlock(raw);
    if (json && typeof json === 'object') {
        const shape = json as ImportShape;
        if (typeof shape.profile === 'string') {
            profile = shape.profile.trim().slice(0, MAX_CONTENT);
        }
        if (Array.isArray(shape.memories)) {
            memories = normalizeMemoryArray(shape.memories);
        } else if (Array.isArray(json)) {
            memories = normalizeMemoryArray(json);
        }
    }

    if (memories.length === 0 && !profile) {
        memories = parseAsList(raw);
    }

    if (memories.length === 0 && !profile) {
        return NextResponse.json(
            { error: 'Could not parse any memories from input. Paste either the JSON output from the export prompt, or a bullet list.' },
            { status: 400 },
        );
    }

    try {
        if (replace) {
            await clearMemories(userId);
        }

        const created: { id: string; content: string }[] = [];
        if (profile) {
            const row = await createMemory({
                userId,
                content: profile,
                tags: ['profile', 'imported'],
                source: 'auto',
            });
            created.push({ id: row.id, content: row.content });
        }
        for (const m of memories) {
            const tags = m.tags.length > 0
                ? Array.from(new Set([...m.tags, 'imported']))
                : ['imported'];
            const row = await createMemory({
                userId,
                content: m.content,
                tags,
                source: 'auto',
            });
            created.push({ id: row.id, content: row.content });
        }

        return NextResponse.json({
            ok: true,
            imported: created.length,
            replacedAll: replace,
            profileImported: Boolean(profile),
        });
    } catch (e) {
        if (e instanceof InvalidKeyError) {
            return NextResponse.json(
                {
                    error: `The database rejected the connection (${e.message}). Update DATABASE_URL in .env.`,
                    code: 'INVALID_KEY',
                },
                { status: 500 },
            );
        }
        if (e instanceof MissingTableError) {
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
        const msg = e instanceof Error ? e.message : 'Unknown error';
        return NextResponse.json(
            { error: `Import failed: ${msg.slice(0, 300)}` },
            { status: 500 },
        );
    }
}
