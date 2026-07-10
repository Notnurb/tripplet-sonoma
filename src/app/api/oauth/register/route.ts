// Dynamic Client Registration (RFC 7591).
// MCP clients POST their metadata (redirect_uris, client_name) and receive a
// client_id. Public clients only — no secret is issued (PKCE is required).

import { NextRequest } from 'next/server';
import { isDbConfigured } from '@/lib/db/neon';
import { registerClient } from '@/lib/mcp/oauth';
import { corsJson, preflight } from '@/lib/mcp/http';

export const runtime = 'nodejs';

export function OPTIONS() {
    return preflight();
}

export async function POST(request: NextRequest) {
    if (!isDbConfigured()) {
        return corsJson({ error: 'server_error', error_description: 'Not configured.' }, { status: 503 });
    }

    let body: {
        redirect_uris?: unknown;
        client_name?: unknown;
        grant_types?: unknown;
        token_endpoint_auth_method?: unknown;
    };
    try {
        body = await request.json();
    } catch {
        return corsJson({ error: 'invalid_client_metadata', error_description: 'Invalid JSON.' }, { status: 400 });
    }

    const redirectUris = Array.isArray(body.redirect_uris)
        ? body.redirect_uris.filter((u): u is string => typeof u === 'string')
        : [];
    if (redirectUris.length === 0) {
        return corsJson(
            { error: 'invalid_redirect_uri', error_description: 'At least one redirect_uri is required.' },
            { status: 400 },
        );
    }
    // Each redirect_uri must be an absolute http(s) URL, or a custom app scheme
    // (e.g. `myapp://callback`) per RFC 8252. Reject dangerous schemes like
    // `javascript:`/`data:` that could execute in the browser on redirect.
    for (const uri of redirectUris) {
        let parsed: URL;
        try {
            parsed = new URL(uri);
        } catch {
            return corsJson(
                { error: 'invalid_redirect_uri', error_description: `Not a valid URL: ${uri}` },
                { status: 400 },
            );
        }
        const scheme = parsed.protocol.toLowerCase();
        const isHttp = scheme === 'https:' || scheme === 'http:';
        const isCustomScheme = /^[a-z][a-z0-9+.-]*:$/.test(scheme) && !['javascript:', 'data:', 'vbscript:', 'file:'].includes(scheme);
        if (!isHttp && !isCustomScheme) {
            return corsJson(
                { error: 'invalid_redirect_uri', error_description: `Unsupported redirect_uri scheme: ${uri}` },
                { status: 400 },
            );
        }
    }

    const client = await registerClient({
        client_name: typeof body.client_name === 'string' ? body.client_name : undefined,
        redirect_uris: redirectUris,
        grant_types: Array.isArray(body.grant_types)
            ? body.grant_types.filter((g): g is string => typeof g === 'string')
            : undefined,
        token_endpoint_auth_method:
            typeof body.token_endpoint_auth_method === 'string'
                ? body.token_endpoint_auth_method
                : 'none',
    });

    return corsJson(
        {
            client_id: client.client_id,
            client_name: client.client_name,
            redirect_uris: client.redirect_uris,
            grant_types: client.grant_types,
            token_endpoint_auth_method: client.token_endpoint_auth_method,
            // Public client: no secret. Advertise that it never expires.
            client_id_issued_at: Math.floor(Date.now() / 1000),
        },
        { status: 201 },
    );
}
