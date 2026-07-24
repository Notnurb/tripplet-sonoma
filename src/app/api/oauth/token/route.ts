// OAuth 2.1 Token endpoint.
//
// grant_type=authorization_code — exchanges a single-use code (with PKCE proof)
//   for an access + refresh token.
// grant_type=refresh_token — rotates a refresh token for a fresh pair.
//
// Public clients only: no client secret is required, PKCE is mandatory.

import { NextRequest } from 'next/server';
import {
    consumeAuthCode,
    getClient,
    issueTokens,
    rotateRefreshToken,
    sameRedirectUri,
    verifyPkceS256,
} from '@/lib/mcp/oauth';
import { corsJson, preflight } from '@/lib/mcp/http';

export const runtime = 'nodejs';

export function OPTIONS() {
    return preflight();
}

// Token endpoint accepts application/x-www-form-urlencoded (OAuth default) or JSON.
async function readParams(request: NextRequest): Promise<Record<string, string>> {
    const ct = request.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(body)) if (typeof v === 'string') out[k] = v;
        return out;
    }
    const form = await request.formData();
    const out: Record<string, string> = {};
    for (const [k, v] of form.entries()) if (typeof v === 'string') out[k] = v;
    return out;
}

export async function POST(request: NextRequest) {
    const params = await readParams(request);
    const grantType = params.grant_type;
    const clientId = params.client_id;

    if (!clientId) {
        return corsJson({ error: 'invalid_client', error_description: 'client_id is required.' }, { status: 400 });
    }
    const client = await getClient(clientId);
    if (!client) {
        return corsJson({ error: 'invalid_client', error_description: 'Unknown client.' }, { status: 401 });
    }

    // ── authorization_code ──────────────────────────────────────────────────
    if (grantType === 'authorization_code') {
        const code = params.code;
        const redirectUri = params.redirect_uri;
        const codeVerifier = params.code_verifier;

        if (!code || !redirectUri || !codeVerifier) {
            return corsJson({ error: 'invalid_request', error_description: 'Missing code, redirect_uri, or code_verifier.' }, { status: 400 });
        }

        const record = await consumeAuthCode(code);
        if (!record) {
            return corsJson({ error: 'invalid_grant', error_description: 'Authorization code is invalid or already used.' }, { status: 400 });
        }
        if (record.expired) {
            return corsJson({ error: 'invalid_grant', error_description: 'Authorization code expired.' }, { status: 400 });
        }
        if (record.client_id !== clientId) {
            return corsJson({ error: 'invalid_grant', error_description: 'Code was issued to a different client.' }, { status: 400 });
        }
        // The code is bound to the registered spelling; a native client sends
        // back the loopback host it actually listens on. See sameRedirectUri.
        if (!sameRedirectUri(record.redirect_uri, redirectUri)) {
            return corsJson({ error: 'invalid_grant', error_description: 'redirect_uri mismatch.' }, { status: 400 });
        }
        if (!verifyPkceS256(codeVerifier, record.code_challenge)) {
            return corsJson({ error: 'invalid_grant', error_description: 'PKCE verification failed.' }, { status: 400 });
        }

        const tokens = await issueTokens({
            clientId,
            userEmail: record.user_email,
            scope: record.scope,
            resource: record.resource ?? undefined,
        });
        return corsJson(tokens);
    }

    // ── refresh_token ─────────────────────────────────────────────────────────
    if (grantType === 'refresh_token') {
        const refreshToken = params.refresh_token;
        if (!refreshToken) {
            return corsJson({ error: 'invalid_request', error_description: 'refresh_token is required.' }, { status: 400 });
        }
        const tokens = await rotateRefreshToken(refreshToken, clientId);
        if (!tokens) {
            return corsJson({ error: 'invalid_grant', error_description: 'Refresh token is invalid or expired.' }, { status: 400 });
        }
        return corsJson(tokens);
    }

    return corsJson({ error: 'unsupported_grant_type' }, { status: 400 });
}
