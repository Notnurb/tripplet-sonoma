import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { query } from '@/lib/db/neon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Deploy smoke-test endpoint. Hit this after every deploy to confirm auth is
 * actually alive instead of finding out from a user's failed sign-in.
 *
 * Unlike a plain env-presence check, this executes a real query against
 * `public.User` — so it catches a wrong DATABASE_URL, an unreachable Neon
 * instance, or a missing/mis-migrated User table, all of which would break auth
 * while every env var is technically "set".
 */
export async function GET() {
    const checks: Record<string, 'ok' | 'missing' | 'error'> = {
        groq: env.GROQ_API_KEY ? 'ok' : 'missing',
        opencodeZen: env.OPENCODE_ZEN_API_KEY ? 'ok' : 'missing',
        // Env-presence of the config the auth system needs to function.
        authConfig: env.JWT_SECRET ? 'ok' : 'missing',
    };

    // Real DB round-trip against the auth table. `to_regclass` returns NULL if
    // the table doesn't exist, so we distinguish "DB unreachable" from "User
    // table missing".
    let dbDetail: string | undefined;
    try {
        const rows = await query<{ user_table: string | null }>(
            `SELECT to_regclass('public."User"')::text AS user_table`,
        );
        if (rows[0]?.user_table) {
            checks.database = 'ok';
        } else {
            checks.database = 'error';
            dbDetail = 'connected, but public."User" table is missing';
        }
    } catch (error) {
        checks.database = 'error';
        dbDetail = error instanceof Error ? error.message : 'unknown database error';
    }

    // groq/opencodeZen are informational; a degraded auth path or DB failure is
    // what should trip the 503 so an uptime probe / alert fires.
    const critical = checks.database === 'ok' && checks.authConfig === 'ok';

    return NextResponse.json(
        {
            status: critical ? 'ok' : 'degraded',
            checks,
            ...(dbDetail ? { database: dbDetail } : {}),
            timestamp: new Date().toISOString(),
        },
        { status: critical ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
    );
}
