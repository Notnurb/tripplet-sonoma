// OAuth 2.1 Authorization endpoint (authorization-code + PKCE).
//
// GET  — entered by the MCP client (browser navigation). Validates the client
//        and redirect_uri, then forwards to the consent page (/oauth/consent).
// POST — called by the consent page once the signed-in user approves/denies.
//        Issues a single-use authorization code bound to the PKCE challenge.

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/session';
import { getClient, issueAuthCode, MCP_SCOPE } from '@/lib/mcp/oauth';

export const runtime = 'nodejs';

function errorPage(message: string, status = 400): Response {
    return new Response(
        `<!doctype html><meta charset="utf-8"><title>Authorization error</title>` +
            `<body style="font-family:system-ui;padding:40px;max-width:32rem;margin:auto">` +
            `<h1 style="font-size:1.25rem">Authorization error</h1><p>${message}</p></body>`,
        { status, headers: { 'Content-Type': 'text/html' } },
    );
}

function redirectWithError(redirectUri: string, error: string, state: string | null): Response {
    const url = new URL(redirectUri);
    url.searchParams.set('error', error);
    if (state) url.searchParams.set('state', state);
    return NextResponse.redirect(url.toString());
}

export async function GET(request: NextRequest) {
    const p = request.nextUrl.searchParams;
    const responseType = p.get('response_type');
    const clientId = p.get('client_id');
    const redirectUri = p.get('redirect_uri');
    const codeChallenge = p.get('code_challenge');
    const codeChallengeMethod = p.get('code_challenge_method') || 'S256';
    const state = p.get('state');

    if (!clientId) return errorPage('Missing client_id.');
    const client = await getClient(clientId);
    if (!client) return errorPage('Unknown client_id. Register the client first.');

    if (!redirectUri || !client.redirect_uris.includes(redirectUri)) {
        // Never redirect to an unregistered URI — render an error instead.
        return errorPage('redirect_uri is missing or not registered for this client.');
    }
    // From here, param errors CAN be reported back to the (verified) redirect_uri.
    if (responseType !== 'code') return redirectWithError(redirectUri, 'unsupported_response_type', state);
    if (!codeChallenge) return redirectWithError(redirectUri, 'invalid_request', state);
    if (codeChallengeMethod !== 'S256') return redirectWithError(redirectUri, 'invalid_request', state);

    // Forward the (validated) request to the consent UI, preserving all params.
    const consent = request.nextUrl.clone();
    consent.pathname = '/oauth/consent';
    return NextResponse.redirect(consent.toString());
}

interface ApprovalBody {
    client_id?: string;
    redirect_uri?: string;
    code_challenge?: string;
    code_challenge_method?: string;
    scope?: string;
    state?: string;
    resource?: string;
    approve?: boolean;
}

export async function POST(request: NextRequest) {
    let body: ApprovalBody;
    try {
        body = (await request.json()) as ApprovalBody;
    } catch {
        return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    }

    const { client_id, redirect_uri, code_challenge } = body;
    if (!client_id || !redirect_uri || !code_challenge) {
        return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    }

    const client = await getClient(client_id);
    if (!client || !client.redirect_uris.includes(redirect_uri)) {
        return NextResponse.json({ error: 'invalid_client' }, { status: 400 });
    }
    if ((body.code_challenge_method || 'S256') !== 'S256') {
        return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    }

    // The consenting user must be signed in to Sonoma (cookie-based).
    const { email } = await auth();
    if (!email) {
        return NextResponse.json({ error: 'login_required' }, { status: 401 });
    }

    // User denied → bounce back with access_denied.
    if (body.approve === false) {
        const url = new URL(redirect_uri);
        url.searchParams.set('error', 'access_denied');
        if (body.state) url.searchParams.set('state', body.state);
        return NextResponse.json({ redirect: url.toString() });
    }

    const scope = body.scope?.trim() || MCP_SCOPE;
    const code = await issueAuthCode({
        clientId: client_id,
        userEmail: email,
        redirectUri: redirect_uri,
        codeChallenge: code_challenge,
        codeChallengeMethod: 'S256',
        scope,
        resource: body.resource,
    });

    const url = new URL(redirect_uri);
    url.searchParams.set('code', code);
    if (body.state) url.searchParams.set('state', body.state);
    return NextResponse.json({ redirect: url.toString() });
}
