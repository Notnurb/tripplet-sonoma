// OAuth 2.0 Protected Resource Metadata (RFC 9728).
// The MCP resource server (/api/mcp) points clients here (via WWW-Authenticate)
// so they can discover which authorization server to use.

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
        resource: `${base}/api/mcp`,
        authorization_servers: [base],
        scopes_supported: [MCP_SCOPE],
        bearer_methods_supported: ['header'],
    }, {
        // Static per-origin discovery metadata — cacheable, unlike the
        // no-store default corsJson applies to token/authorize responses.
        headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' },
    });
}
