// GET /api/composio/apps — browse the Composio app catalog (most-used first,
// optional ?search=). Signed-in users only: the catalog is the entry point to
// connecting accounts, which guests don't have.

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/session';
import { composioEnabled, listToolkits } from '@/lib/composio/client';
import { connectorLimiter, LIMITS, rateLimitResponse, getRateLimitToken } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ error: 'Sign in to browse connectors' }, { status: 401 });
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

    const search = (req.nextUrl.searchParams.get('search') ?? '').trim().slice(0, 64);
    try {
        const apps = await listToolkits(search || undefined);
        return NextResponse.json({ apps });
    } catch (e) {
        return NextResponse.json(
            { error: e instanceof Error ? e.message : 'Could not list apps' },
            { status: 502 },
        );
    }
}
