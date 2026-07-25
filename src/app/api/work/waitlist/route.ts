// Waitlist signups for Tripplet Work on Windows and Linux.
//
// The table is provisioned on first write with CREATE TABLE IF NOT EXISTS
// rather than a Prisma model, deliberately: adding a model without a matching
// migration would trip `npm run check:drift`, and this is a single flat table
// with no relations to the rest of the schema.

import { NextRequest, NextResponse } from 'next/server';
import { isDbConfigured, query } from '@/lib/db/neon';
import {
    searchLimiter,
    LIMITS,
    rateLimitResponse,
    getRateLimitToken,
} from '@/lib/security/rate-limit';

export const runtime = 'nodejs';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PLATFORMS = new Set(['windows', 'linux', 'mac', 'other']);

let tableReady = false;

async function ensureTable() {
    if (tableReady) return;
    await query(
        `CREATE TABLE IF NOT EXISTS "WorkWaitlist" (
            id         text PRIMARY KEY,
            email      text NOT NULL UNIQUE,
            platform   text NOT NULL DEFAULT 'other',
            "createdAt" timestamptz NOT NULL DEFAULT now()
        )`,
        [],
    );
    tableReady = true;
}

export async function POST(request: NextRequest) {
    try {
        await searchLimiter.check(LIMITS.search, getRateLimitToken(request));
    } catch {
        return rateLimitResponse();
    }

    let body: { email?: unknown; platform?: unknown };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email || email.length > 254 || !EMAIL.test(email)) {
        return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 });
    }

    const rawPlatform = typeof body.platform === 'string' ? body.platform.toLowerCase() : 'other';
    const platform = PLATFORMS.has(rawPlatform) ? rawPlatform : 'other';

    if (!isDbConfigured()) {
        return NextResponse.json(
            { error: 'The waitlist is not available right now. Please try again later.' },
            { status: 503 },
        );
    }

    try {
        await ensureTable();
        await query(
            `INSERT INTO "WorkWaitlist" (id, email, platform)
             VALUES ($1, $2, $3)
             ON CONFLICT (email) DO NOTHING`,
            [crypto.randomUUID(), email, platform],
        );
        // Already-on-the-list looks the same as just-joined — no way to probe
        // whether a given address has signed up.
        return NextResponse.json({ ok: true });
    } catch (e) {
        // pg connection failures often carry an empty message, which would
        // otherwise surface as a bare "Could not join the waitlist: ".
        const err = e as { message?: string; code?: string } | null;
        const detail = err?.message?.trim() || err?.code || 'Unknown error';
        console.error('POST /api/work/waitlist', e);
        return NextResponse.json(
            { error: `Could not join the waitlist: ${detail.slice(0, 200)}` },
            { status: 500 },
        );
    }
}
