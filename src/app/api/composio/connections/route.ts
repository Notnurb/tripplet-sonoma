// /api/composio/connections — manage the signed-in user's app connections.
//
//   GET              → list this user's connections
//   POST {app}       → start connecting an app; returns the hosted OAuth URL
//   DELETE ?id=…     → disconnect (ownership-checked)
//
// All Composio calls are scoped by the authenticated userId — the client
// never supplies a user id, and connection ids are verified to belong to the
// caller before deletion.

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/session';
import { env } from '@/lib/env';
import {
    composioEnabled,
    deleteConnectedAccount,
    getConnectedAccount,
    initiateConnection,
    listConnectedAccounts,
} from '@/lib/composio/client';
import { invalidateComposioConnections } from '@/lib/composio/tools';
import { connectorLimiter, LIMITS, rateLimitResponse, getRateLimitToken } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';

// Toolkit slugs are lowercase identifiers ("github", "googlecalendar");
// connection ids are nanoids. Reject anything shaped differently before it
// reaches an outbound URL.
const APP_SLUG_RE = /^[a-z0-9_-]{1,64}$/i;
const CONNECTION_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

async function guard(req: NextRequest): Promise<{ userId: string } | NextResponse> {
    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ error: 'Sign in to manage connectors' }, { status: 401 });
    }
    try {
        await connectorLimiter.check(LIMITS.connector, getRateLimitToken(req, userId));
    } catch {
        return rateLimitResponse();
    }
    if (!composioEnabled()) {
        return NextResponse.json(
            {
                error: 'Connectors are not configured on this deployment. Set COMPOSIO_API_KEY (from composio.dev) to enable them.',
                code: 'NOT_CONFIGURED',
            },
            { status: 503 },
        );
    }
    return { userId };
}

export async function GET(req: NextRequest) {
    const ctx = await guard(req);
    if (ctx instanceof NextResponse) return ctx;
    try {
        // Someone viewing their connections has often just changed them (the
        // OAuth return lands here) — drop the cached tool scope so the next
        // chat request sees the fresh ACTIVE set instead of a stale 60s entry.
        invalidateComposioConnections(ctx.userId);
        const connections = (await listConnectedAccounts(ctx.userId)).map((c) => ({
            id: c.id,
            app: c.toolkitSlug,
            status: c.status,
            statusReason: c.statusReason,
            createdAt: c.createdAt,
            isDisabled: c.isDisabled,
        }));
        return NextResponse.json({ connections });
    } catch (e) {
        return NextResponse.json(
            { error: e instanceof Error ? e.message : 'Could not list connections' },
            { status: 502 },
        );
    }
}

export async function POST(req: NextRequest) {
    const ctx = await guard(req);
    if (ctx instanceof NextResponse) return ctx;

    let body: { app?: unknown; returnTo?: unknown };
    try {
        body = (await req.json()) as { app?: unknown; returnTo?: unknown };
    } catch {
        return NextResponse.json({ error: 'Bad JSON' }, { status: 400 });
    }
    const app = typeof body.app === 'string' ? body.app.trim().toLowerCase() : '';
    if (!APP_SLUG_RE.test(app)) {
        return NextResponse.json({ error: 'Invalid app' }, { status: 400 });
    }

    // Where to land after the OAuth consent (e.g. back on /chat when the
    // connection was started from the chat composer). Strictly a same-origin
    // path: a single leading slash (no `//host` authority form), safe chars,
    // no query/hash — anything else falls back to /settings rather than
    // becoming an open redirect through the OAuth callback.
    const rawReturnTo = typeof body.returnTo === 'string' ? body.returnTo : '';
    const returnTo =
        rawReturnTo.length <= 200 && /^\/(?!\/)[A-Za-z0-9\-._~/]*$/.test(rawReturnTo)
            ? rawReturnTo
            : '/settings';

    // Composio sends the user's browser back here after the OAuth consent.
    const origin = env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;
    const callbackUrl = `${origin.replace(/\/$/, '')}${returnTo}?connector=done`;

    try {
        const initiated = await initiateConnection(ctx.userId, app, callbackUrl);
        invalidateComposioConnections(ctx.userId);
        return NextResponse.json({
            id: initiated.id,
            redirectUrl: initiated.redirectUrl,
            status: initiated.status,
        });
    } catch (e) {
        return NextResponse.json(
            { error: e instanceof Error ? e.message : 'Could not start the connection' },
            { status: 502 },
        );
    }
}

export async function DELETE(req: NextRequest) {
    const ctx = await guard(req);
    if (ctx instanceof NextResponse) return ctx;

    const id = req.nextUrl.searchParams.get('id') ?? '';
    if (!CONNECTION_ID_RE.test(id)) {
        return NextResponse.json({ error: 'Invalid connection id' }, { status: 400 });
    }

    try {
        // Ownership check: deleting by raw id would let any signed-in user
        // disconnect other people's accounts. Unknown and foreign ids get the
        // same 404 so ids can't be probed.
        const existing = await getConnectedAccount(id);
        if (!existing || existing.userId !== ctx.userId) {
            return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
        }
        await deleteConnectedAccount(id);
        invalidateComposioConnections(ctx.userId);
        return NextResponse.json({ ok: true });
    } catch (e) {
        return NextResponse.json(
            { error: e instanceof Error ? e.message : 'Could not remove connection' },
            { status: 502 },
        );
    }
}
