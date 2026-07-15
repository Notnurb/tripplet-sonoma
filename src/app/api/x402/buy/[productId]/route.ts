// The x402-gated pack purchase endpoint — accountless by design. Without an
// X-PAYMENT header it answers 402 + PaymentRequirements (the machine-readable
// price tag); with one it verifies, settles on-chain via the facilitator, and
// returns a receipt whose grant.apiKey is a prepaid `trpl_x4_` bearer key
// (+ X-PAYMENT-RESPONSE header). Send an existing key in X-Tripplet-Key to
// top it up instead of minting. Replays of the same payment return the
// original receipt AND the key — agent retries are free and safe.
//
// GET and POST are equivalent on purpose: standard x402 clients re-issue
// whatever method hit the 402, and agents probe with GET. All pipeline logic
// lives in src/lib/x402/payments.ts.

import { NextRequest, NextResponse } from 'next/server';
import {
    LIMITS,
    getRateLimitToken,
    rateLimitResponse,
    x402BuyLimiter,
} from '@/lib/security/rate-limit';
import { handlePackPurchase } from '@/lib/x402/payments';
import { X402_CORS_HEADERS, x402Preflight } from '@/lib/x402/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(
    req: NextRequest,
    { params }: { params: Promise<{ productId: string }> },
): Promise<NextResponse> {
    try {
        await x402BuyLimiter.check(LIMITS.x402Buy, `x402buy:${getRateLimitToken(req, null)}`);
    } catch {
        return rateLimitResponse();
    }

    const { productId } = await params;
    const result = await handlePackPurchase(req, productId);
    return NextResponse.json(result.body, {
        status: result.status,
        headers: {
            ...X402_CORS_HEADERS,
            'Cache-Control': 'no-store',
            ...result.headers,
        },
    });
}

export { handle as GET, handle as POST };

export function OPTIONS(): Response {
    return x402Preflight();
}
