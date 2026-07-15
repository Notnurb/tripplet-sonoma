// Key introspection — `GET` with `Authorization: Bearer trpl_x4_...` returns
// the key's balance. Accountless: possession of the key IS the authorization,
// exactly like checking a gift-card balance. Agents poll this to decide when
// to top up before the 402 interrupts them mid-task.

import { NextRequest, NextResponse } from 'next/server';
import {
    LIMITS,
    getRateLimitToken,
    rateLimitResponse,
    x402BuyLimiter,
} from '@/lib/security/rate-limit';
import { KEY_PREFIX } from '@/lib/x402/catalog';
import { authenticatePrepaidKey, looksLikeApiKey } from '@/lib/x402/keys';
import { getStoreConfig } from '@/lib/x402/config';
import { X402_CORS_HEADERS, x402Preflight } from '@/lib/x402/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(status: number, body: unknown): NextResponse {
    return NextResponse.json(body, {
        status,
        headers: { ...X402_CORS_HEADERS, 'Cache-Control': 'no-store' },
    });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
    try {
        await x402BuyLimiter.check(LIMITS.x402Buy, `x402key:${getRateLimitToken(req, null)}`);
    } catch {
        return rateLimitResponse();
    }

    const bearer = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (!bearer || !looksLikeApiKey(bearer)) {
        return json(401, { error: `Send the key to inspect as Authorization: Bearer ${KEY_PREFIX}...` });
    }

    const auth = await authenticatePrepaidKey(bearer);
    if (auth.status === 'db-unavailable') return json(503, { error: 'Key storage unavailable. Retry shortly.' });
    if (auth.status === 'unknown') return json(404, { error: 'Unknown key.' });
    if (auth.status === 'revoked') return json(403, { error: 'This key has been revoked.' });

    const row = auth.row; // both remaining statuses (ok | exhausted) carry it
    const config = getStoreConfig();
    return json(200, {
        keyPrefix: row.key_prefix,
        label: row.label,
        creditsGranted: Number(row.credits_granted),
        creditsRemaining: Number(row.credits_remaining),
        exhausted: auth.status === 'exhausted',
        createdAt: row.created_at.toISOString(),
        lastUsedAt: row.last_used_at?.toISOString() ?? null,
        topUp: {
            how: `Pay any pack at ${config.appUrl}/api/x402/buy/{packId} with this key in the X-Tripplet-Key header.`,
            catalog: `${config.appUrl}/api/x402/catalog`,
        },
    });
}

export function OPTIONS(): Response {
    return x402Preflight();
}
