// Shared HTTP helpers for the MCP OAuth + resource endpoints.
//
// These endpoints are called cross-origin by external AI clients (and their
// browsers), so every response needs permissive CORS. They are also fetched
// before any auth, so metadata/registration must be fully public.

export const CORS_HEADERS: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Protocol-Version, Mcp-Session-Id',
    'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
    'Access-Control-Max-Age': '86400',
};

export function corsJson(body: unknown, init: ResponseInit = {}): Response {
    return new Response(JSON.stringify(body), {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            ...CORS_HEADERS,
            ...(init.headers as Record<string, string> | undefined),
        },
    });
}

export function preflight(): Response {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
}
