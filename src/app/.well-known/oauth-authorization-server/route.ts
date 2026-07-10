// OAuth 2.0 Authorization Server Metadata (RFC 8414).
// MCP clients fetch this to discover the authorize/token/registration endpoints.

import { NextRequest } from 'next/server';
import { baseUrlFrom, MCP_SCOPE } from '@/lib/mcp/oauth';
import { corsJson, preflight } from '@/lib/mcp/http';

export const runtime = 'nodejs';

export function OPTIONS() {
    return preflight();
}

export function GET(request: NextRequest) {
    const base = baseUrlFrom(request);
    return corsJson({
        issuer: base,
        authorization_endpoint: `${base}/api/oauth/authorize`,
        token_endpoint: `${base}/api/oauth/token`,
        registration_endpoint: `${base}/api/oauth/register`,
        scopes_supported: [MCP_SCOPE, 'offline_access'],
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
    }, {
        // Static per-origin discovery metadata — cacheable, unlike the
        // no-store default corsJson applies to token/authorize responses.
        headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' },
    });
}
