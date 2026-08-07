import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { query } from '@/lib/db/neon';
import { resolveBackend } from '@/lib/ai/llm';

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

    // Per-persona backend health for clients that connect before signing in
    // (Tripplet Work's Connect screen). Mirrors the exact routing the chat
    // route will use, so "this server can actually answer me" is checkable
    // ahead of time. `ready` is false for any persona that would 503 today.
    const personas = (['astro-5', 'taipei4', 'majuli4', 'suzhou4'] as const).map((id) => {
        const target = resolveBackend(id);
        const ready = !!target.apiKey;
        return {
            persona: id,
            model: target.model,
            provider: target.provider,
            keyEnv: target.keyEnvName || (target.provider === 'opencode-zen' ? 'OPENCODE_ZEN_API_KEY' : 'GROQ_API_KEY'),
            ready,
            status: ready ? 'ok' : 'missing',
        };
    });
    const anyPersonaReady = personas.some((p) => p.ready);

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
        // The endpoint is unauthenticated — raw driver messages can leak
        // hostnames/connection details, so keep the detail generic here and
        // put the real error in the server log for the operator.
        console.error('[health] database check failed', error);
        dbDetail = 'database unreachable';
    }

    // groq/opencodeZen are informational; a degraded auth path, DB failure, or a
    // deployment with zero inference keys is what should trip the 503 so an
    // uptime probe / alert fires and the Connect screen can pre-check the server.
    const critical = checks.database === 'ok' && checks.authConfig === 'ok' && anyPersonaReady;

    return NextResponse.json(
        {
            status: critical ? 'ok' : 'degraded',
            checks,
            personas,
            ...(dbDetail ? { database: dbDetail } : {}),
            timestamp: new Date().toISOString(),
        },
        { status: critical ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
    );
}
