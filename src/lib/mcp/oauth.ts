// MCP OAuth 2.1 — Authorization Server helpers.
//
// Sonoma acts as its own OAuth 2.1 Authorization Server AND Resource Server for
// the remote MCP endpoint (/api/mcp). This module owns all token/code/client
// persistence and the crypto primitives. Everything is stored hashed; raw
// secrets exist only in transit.
//
// Design choices:
//   • Public clients only (PKCE S256 required) — no client secrets to leak.
//   • Opaque random tokens stored as SHA-256 hashes — revocable + no key mgmt.
//   • Codes are single-use (deleted on exchange) and short-lived (60s).

import crypto from 'crypto';
import { query, queryOne } from '@/lib/db/neon';

export const ACCESS_TOKEN_TTL_SEC = 60 * 60;          // 1 hour
export const REFRESH_TOKEN_TTL_SEC = 60 * 60 * 24 * 30; // 30 days
export const AUTH_CODE_TTL_SEC = 60;                   // 1 minute
export const MCP_SCOPE = 'mcp';

export function sha256(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
}

function randomToken(bytes = 32): string {
    return crypto.randomBytes(bytes).toString('base64url');
}

/** Base URL / issuer for this deployment, derived from the incoming request so
 * it works across localhost, previews, and prod without extra config. */
export function baseUrlFrom(request: Request): string {
    const explicit = process.env.NEXT_PUBLIC_APP_URL;
    if (explicit) return explicit.replace(/\/$/, '');
    const h = request.headers;
    const proto = h.get('x-forwarded-proto') || 'https';
    const host = h.get('x-forwarded-host') || h.get('host') || 'localhost:3000';
    return `${proto}://${host}`;
}

// PKCE S256 verification: BASE64URL(SHA256(verifier)) === challenge.
export function verifyPkceS256(verifier: string, challenge: string): boolean {
    const computed = crypto.createHash('sha256').update(verifier).digest('base64url');
    // Constant-time compare on equal-length buffers.
    const a = Buffer.from(computed);
    const b = Buffer.from(challenge);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── Clients (Dynamic Client Registration) ───────────────────────────────────

export interface OAuthClient {
    client_id: string;
    client_name: string | null;
    redirect_uris: string[];
    grant_types: string[];
    token_endpoint_auth_method: string;
}

export async function registerClient(input: {
    client_name?: string;
    redirect_uris: string[];
    grant_types?: string[];
    token_endpoint_auth_method?: string;
}): Promise<OAuthClient> {
    const client_id = 'mcp_' + randomToken(16);
    const grant_types = input.grant_types?.length
        ? input.grant_types
        : ['authorization_code', 'refresh_token'];
    await query(
        `INSERT INTO oauth_clients (client_id, client_name, redirect_uris, grant_types, token_endpoint_auth_method)
         VALUES ($1, $2, $3, $4, $5)`,
        [
            client_id,
            input.client_name ?? null,
            input.redirect_uris,
            grant_types,
            input.token_endpoint_auth_method ?? 'none',
        ],
    );
    return {
        client_id,
        client_name: input.client_name ?? null,
        redirect_uris: input.redirect_uris,
        grant_types,
        token_endpoint_auth_method: input.token_endpoint_auth_method ?? 'none',
    };
}

export async function getClient(clientId: string): Promise<OAuthClient | null> {
    return queryOne<OAuthClient>(
        `SELECT client_id, client_name, redirect_uris, grant_types, token_endpoint_auth_method
         FROM oauth_clients WHERE client_id = $1 LIMIT 1`,
        [clientId],
    );
}

// ── Authorization codes ──────────────────────────────────────────────────────

export async function issueAuthCode(input: {
    clientId: string;
    userEmail: string;
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    scope: string;
    resource?: string;
}): Promise<string> {
    const code = randomToken(32);
    await query(
        `INSERT INTO oauth_authorization_codes
           (code_hash, client_id, user_email, redirect_uri, code_challenge, code_challenge_method, scope, resource, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + ($9 || ' seconds')::interval)`,
        [
            sha256(code),
            input.clientId,
            input.userEmail,
            input.redirectUri,
            input.codeChallenge,
            input.codeChallengeMethod,
            input.scope,
            input.resource ?? null,
            String(AUTH_CODE_TTL_SEC),
        ],
    );
    return code;
}

export interface AuthCodeRecord {
    client_id: string;
    user_email: string;
    redirect_uri: string;
    code_challenge: string;
    code_challenge_method: string;
    scope: string;
    resource: string | null;
    expired: boolean;
}

/** Atomically consume (delete) an authorization code, returning its record.
 * Single-use: a replayed code returns null because the row is already gone. */
export async function consumeAuthCode(code: string): Promise<AuthCodeRecord | null> {
    const row = await queryOne<AuthCodeRecord>(
        `DELETE FROM oauth_authorization_codes
         WHERE code_hash = $1
         RETURNING client_id, user_email, redirect_uri, code_challenge,
                   code_challenge_method, scope, resource,
                   (expires_at < now()) AS expired`,
        [sha256(code)],
    );
    return row;
}

// ── Access + refresh tokens ──────────────────────────────────────────────────

export interface IssuedTokens {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
    token_type: 'Bearer';
}

export async function issueTokens(input: {
    clientId: string;
    userEmail: string;
    scope: string;
    resource?: string;
}): Promise<IssuedTokens> {
    const accessToken = randomToken(32);
    const refreshToken = randomToken(32);
    await query(
        `INSERT INTO oauth_access_tokens
           (token_hash, client_id, user_email, scope, resource, refresh_token_hash,
            expires_at, refresh_expires_at)
         VALUES ($1, $2, $3, $4, $5, $6,
            now() + ($7 || ' seconds')::interval,
            now() + ($8 || ' seconds')::interval)`,
        [
            sha256(accessToken),
            input.clientId,
            input.userEmail,
            input.scope,
            input.resource ?? null,
            sha256(refreshToken),
            String(ACCESS_TOKEN_TTL_SEC),
            String(REFRESH_TOKEN_TTL_SEC),
        ],
    );
    return {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: ACCESS_TOKEN_TTL_SEC,
        scope: input.scope,
        token_type: 'Bearer',
    };
}

/** Rotate a refresh token: validate it, revoke the old row, issue a new pair. */
export async function rotateRefreshToken(
    refreshToken: string,
    clientId: string,
): Promise<IssuedTokens | null> {
    const row = await queryOne<{ user_email: string; scope: string; resource: string | null }>(
        `SELECT user_email, scope, resource
         FROM oauth_access_tokens
         WHERE refresh_token_hash = $1
           AND client_id = $2
           AND is_revoked = false
           AND refresh_expires_at > now()
         LIMIT 1`,
        [sha256(refreshToken), clientId],
    );
    if (!row) return null;

    // Revoke the old token family, then mint a fresh pair.
    await query(
        `UPDATE oauth_access_tokens SET is_revoked = true WHERE refresh_token_hash = $1`,
        [sha256(refreshToken)],
    );
    return issueTokens({
        clientId,
        userEmail: row.user_email,
        scope: row.scope,
        resource: row.resource ?? undefined,
    });
}

export interface ValidatedToken {
    userEmail: string;
    scope: string;
}

/** Validate a bearer access token for the MCP resource server. Returns null on
 * missing/expired/revoked. Best-effort last_used_at bump. */
export async function validateAccessToken(accessToken: string): Promise<ValidatedToken | null> {
    const row = await queryOne<{ user_email: string; scope: string }>(
        `SELECT user_email, scope
         FROM oauth_access_tokens
         WHERE token_hash = $1
           AND is_revoked = false
           AND expires_at > now()
         LIMIT 1`,
        [sha256(accessToken)],
    );
    if (!row) return null;
    await query(
        `UPDATE oauth_access_tokens SET last_used_at = now() WHERE token_hash = $1`,
        [sha256(accessToken)],
    ).catch(() => { /* best-effort */ });
    return { userEmail: row.user_email, scope: row.scope };
}
