// Connector access for Tripplet Computer, proxied server-side.
//
// The desktop app holds no Composio credential. It names an action, this route
// performs the real Composio call with the server's key, scoped to the calling
// install's Composio user id. That keeps the key off every user's disk and
// makes connector access revocable per install.
//
// Only the actions below are reachable — the app cannot ask this route to make
// an arbitrary Composio request.

import { NextRequest, NextResponse } from 'next/server';
import { attestComputer } from '@/lib/computer/attest';
import {
    composioEnabled,
    listToolkits,
    listConnectedAccounts,
    listToolkitTools,
    initiateConnection,
    deleteConnectedAccount,
    getConnectedAccount,
    executeTool,
} from '@/lib/composio/client';
import { connectorLimiter } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 120;

const RATE_LIMIT = 300;
const ACTIONS = ['toolkits', 'connections', 'tools', 'connect', 'disconnect', 'execute'] as const;
type Action = (typeof ACTIONS)[number];

function bad(message: string, status: number) {
    return NextResponse.json({ error: { message } }, { status });
}

function str(body: Record<string, unknown>, key: string): string {
    return typeof body[key] === 'string' ? (body[key] as string) : '';
}

function clampLimit(body: Record<string, unknown>, fallback: number, max: number): number {
    const raw = Number(body.limit);
    return Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), max) : fallback;
}

export async function POST(request: NextRequest, context: { params: Promise<{ action: string }> }) {
    const raw = await request.text();
    const attested = await attestComputer(request, raw);
    if ('response' in attested) return attested.response;
    const { install } = attested;

    const { action } = await context.params;
    if (!ACTIONS.includes(action as Action)) return bad(`Unknown connector action "${action}".`, 404);

    if (!composioEnabled()) {
        return bad('Connectors are not configured on this deployment.', 503);
    }

    try {
        await connectorLimiter.check(RATE_LIMIT, `computer-composio:${install.id}`);
    } catch {
        return bad('Rate limit exceeded for this install.', 429);
    }

    let body: Record<string, unknown> = {};
    if (raw.trim()) {
        try {
            body = JSON.parse(raw) as Record<string, unknown>;
        } catch {
            return bad('Invalid JSON body.', 400);
        }
    }

    // Every call is scoped to the install's own Composio user id, so one
    // install can never reach another's connected accounts.
    const userId = install.composio_user_id;

    try {
        switch (action as Action) {
            case 'toolkits': {
                const search = str(body, 'search');
                const items = await listToolkits(search || undefined, clampLimit(body, 24, 100));
                return NextResponse.json({ items });
            }

            case 'connections': {
                const items = await listConnectedAccounts(userId);
                return NextResponse.json({ items });
            }

            case 'tools': {
                const slug = str(body, 'toolkit_slug');
                if (!slug) return bad('`toolkit_slug` is required.', 400);
                // Only tools of an app this install has actually connected.
                const connections = await listConnectedAccounts(userId);
                const connected = connections.some((c) => c.toolkitSlug === slug && c.status === 'ACTIVE');
                if (!connected) return NextResponse.json({ items: [] });
                const items = await listToolkitTools(slug, clampLimit(body, 8, 32));
                return NextResponse.json({ items });
            }

            case 'connect': {
                const slug = str(body, 'toolkit_slug');
                if (!slug) return bad('`toolkit_slug` is required.', 400);
                const initiated = await initiateConnection(
                    userId,
                    slug,
                    'https://tripplet.lol/computer/connected',
                );
                return NextResponse.json({
                    connected_account_id: initiated.id,
                    redirect_url: initiated.redirectUrl,
                });
            }

            case 'disconnect': {
                const id = str(body, 'connection_id');
                if (!id) return bad('`connection_id` is required.', 400);
                // Ownership check before deletion — an install must not be able
                // to delete a connection it does not own by guessing an id.
                const account = await getConnectedAccount(id);
                if (!account || account.userId !== userId) return bad('Unknown connection.', 404);
                await deleteConnectedAccount(id);
                return NextResponse.json({ ok: true });
            }

            case 'execute': {
                const slug = str(body, 'tool_slug');
                if (!slug) return bad('`tool_slug` is required.', 400);
                const args = (body.arguments ?? {}) as Record<string, unknown>;
                if (typeof args !== 'object' || Array.isArray(args)) {
                    return bad('`arguments` must be an object.', 400);
                }
                // Composio resolves the account from the user id, which is what
                // stops one install executing against another's tokens.
                const result = await executeTool(slug, userId, args);
                return NextResponse.json(result);
            }
        }
    } catch (err) {
        const detail = err instanceof Error ? err.message : 'Connector request failed.';
        return bad(detail.slice(0, 200), 502);
    }

    return bad('Unhandled connector action.', 500);
}
