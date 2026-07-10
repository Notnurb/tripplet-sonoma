import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/session';
import { env } from '@/lib/env';
import { query, isMissingTableError } from '@/lib/db/neon';

export const runtime = 'nodejs';

interface Check {
    name: string;
    status: 'ok' | 'fail' | 'warn';
    detail: string;
    fix?: string;
}

export async function GET() {
    // Auth gate so this isn't a public diagnostic. Any signed-in user is fine —
    // it doesn't return their data, just connection diagnostics.
    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ error: 'Sign in to run diagnostics' }, { status: 401 });
    }

    const url = env.DATABASE_URL;
    const checks: Check[] = [];

    // ─── 1. Connection string shape ───────────────────────────────────────
    let host = '';
    try {
        const parsed = new URL(url);
        host = parsed.hostname;
        const looksPostgres = /^postgres(ql)?:$/.test(parsed.protocol);
        checks.push({
            name: 'DATABASE_URL',
            status: looksPostgres ? 'ok' : 'fail',
            detail: looksPostgres ? `Postgres host: ${host}` : `Unexpected protocol: ${parsed.protocol}`,
            fix: looksPostgres ? undefined : 'Set DATABASE_URL to a postgresql://... connection string from Neon.',
        });
    } catch {
        checks.push({
            name: 'DATABASE_URL',
            status: 'fail',
            detail: 'Invalid or missing connection string',
            fix: 'Copy the pooled connection string from the Neon dashboard into DATABASE_URL in .env.',
        });
    }

    // ─── 2. Network probe: can we connect and run a query? ─────────────────
    let connected = false;
    try {
        await query('SELECT 1');
        connected = true;
        checks.push({
            name: 'Database connection',
            status: 'ok',
            detail: 'Connected and ran a test query',
        });
    } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        checks.push({
            name: 'Database connection',
            status: 'fail',
            detail: `Connection failed: ${detail.slice(0, 200)}`,
            fix: 'Verify DATABASE_URL is correct and the Neon project is active (not suspended).',
        });
    }

    // ─── 3. Probe the UserMemory table specifically ───────────────────────
    if (connected) {
        try {
            await query('SELECT id FROM "UserMemory" LIMIT 1');
            checks.push({
                name: 'UserMemory table',
                status: 'ok',
                detail: 'Table exists and is readable',
            });
        } catch (e) {
            if (isMissingTableError(e)) {
                checks.push({
                    name: 'UserMemory table',
                    status: 'fail',
                    detail: 'Table does not exist',
                    fix: 'Open Settings → Memory & Profile to see the CREATE TABLE SQL, run it in the Neon SQL Editor.',
                });
            } else {
                const detail = e instanceof Error ? e.message : String(e);
                checks.push({
                    name: 'UserMemory table',
                    status: 'warn',
                    detail: detail.slice(0, 200),
                });
            }
        }
    }

    const overall: 'ok' | 'fail' = checks.some((c) => c.status === 'fail') ? 'fail' : 'ok';
    return NextResponse.json({ overall, host, checks });
}
