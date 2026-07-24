// Drop this into tripplet-sonoma at:
//   src/app/api/oauth/userinfo/route.ts
//
// It is the one piece Astrocode wants that your OAuth server does not already
// expose: given a bearer access token, say who it belongs to. Everything else
// (discovery, registration, authorize, token, refresh) already works as-is.
//
// Astrocode treats this endpoint as optional — sign-in succeeds without it, you
// just get "signed in" instead of "signed in as you@example.com".

import { NextRequest } from 'next/server';
import { validateAccessToken } from '@/lib/mcp/oauth';
import { corsJson, preflight } from '@/lib/mcp/http';

export const runtime = 'nodejs';

export function OPTIONS() {
    return preflight();
}

export async function GET(request: NextRequest) {
    const header = request.headers.get('authorization') || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) {
        return corsJson(
            { error: 'invalid_token', error_description: 'Missing bearer token.' },
            { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } },
        );
    }

    const token = await validateAccessToken(match[1].trim());
    if (!token) {
        return corsJson(
            { error: 'invalid_token', error_description: 'Expired or revoked token.' },
            { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } },
        );
    }

    // `sub` is the stable identifier; `email` is what the CLI displays.
    return corsJson({
        sub: token.userEmail,
        email: token.userEmail,
        scope: token.scope,
    });
}
