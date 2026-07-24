// Bearer identity for non-browser clients (the Astrocode CLI, and anything
// else holding an MCP OAuth access token).
//
// The web app authenticates with the `auth_token` cookie via lib/auth/session;
// a CLI has no cookie jar, so it presents the same access token it already
// uses for /api/mcp. This module is the single place that turns that token
// into a Sonoma user id, so routes never re-implement header parsing, the
// scope check, or the email → id lookup.

import { queryOne } from '@/lib/db/neon';
import { baseUrlFrom, validateAccessToken, hasScope, MCP_SCOPE } from '@/lib/mcp/oauth';

export interface BearerUser {
    userId: string;
    email: string;
    scope: string;
}

/**
 * The caller identified by `Authorization: Bearer <token>`, or null.
 *
 * Never throws. A malformed header, an expired token, a token minted without
 * the `mcp` scope, and a database hiccup all resolve to null so the caller
 * answers a clean 401 instead of a bodyless 500.
 */
export async function resolveBearerUser(request: Request): Promise<BearerUser | null> {
    try {
        const match = (request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
        if (!match) return null;

        const token = await validateAccessToken(match[1].trim());
        if (!token || !token.userEmail) return null;

        // Scope is checked at the point of use, not just at mint time — the day
        // a narrower scope exists, a token without `mcp` must not reach here
        // simply because it verified. Same reasoning as /api/mcp tools/call.
        if (!hasScope(token.scope, MCP_SCOPE)) return null;

        const row = await queryOne<{ id: string }>(
            `SELECT id FROM "User" WHERE email = $1 LIMIT 1`,
            [token.userEmail],
        );
        if (!row?.id) return null;

        return { userId: row.id, email: token.userEmail, scope: token.scope };
    } catch (e) {
        console.error('[bearer] resolve failed:', e instanceof Error ? e.message : e);
        return null;
    }
}

/**
 * The 401 a bearer-authenticated route returns. `resource_metadata` points the
 * client at this deployment's protected-resource document so it can discover
 * the authorization server and re-run the OAuth flow without being told where.
 */
export function bearerUnauthorized(request: Request): Response {
    return new Response(
        JSON.stringify({
            error: 'invalid_token',
            error_description: 'Missing or invalid access token.',
        }),
        {
            status: 401,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
                'WWW-Authenticate': `Bearer resource_metadata="${baseUrlFrom(request)}/.well-known/oauth-protected-resource"`,
            },
        },
    );
}
