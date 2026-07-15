// CORS for the x402 endpoints. The storefront is agent-first: payment-capable
// clients live anywhere (other origins, extensions, in-page agents), every
// endpoint is payment- or bearer-gated rather than cookie-gated, and nothing
// here reads a session — so a wildcard origin is safe and deliberate. The
// X-PAYMENT / X-PAYMENT-RESPONSE headers must be explicitly allowed/exposed
// or browsers strip them.

import { PAYMENT_HEADER, PAYMENT_RESPONSE_HEADER } from './types';
import { TOPUP_KEY_HEADER } from './payments';

export const X402_CORS_HEADERS: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': `Content-Type, Authorization, ${PAYMENT_HEADER}, ${TOPUP_KEY_HEADER}`,
    'Access-Control-Expose-Headers': PAYMENT_RESPONSE_HEADER,
    'Access-Control-Max-Age': '86400',
};

export function x402Preflight(): Response {
    return new Response(null, { status: 204, headers: X402_CORS_HEADERS });
}
