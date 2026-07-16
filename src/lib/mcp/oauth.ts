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
export const OFFLINE_ACCESS_SCOPE = 'offline_access';
export const SUPPORTED_SCOPES = new Set([MCP_SCOPE, OFFLINE_ACCESS_SCOPE]);

/** True if every space-delimited scope in `requested` is one this server
 * actually knows about. Used at authorize-time so a client can't mint a
 * token carrying an arbitrary scope string that later gets trusted verbatim. */
export function isValidScope(requested: string): boolean {
    const scopes = requested.trim().split(/\s+/).filter(Boolean);
    return scopes.length > 0 && scopes.every((s) => SUPPORTED_SCOPES.has(s));
}

/** True if `tokenScope` (space-delimited) grants `required`. */
export function hasScope(tokenScope: string, required: string): boolean {
    return tokenScope.trim().split(/\s+/).includes(required);
}

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
    /** Root token_hash of this grant's rotation chain. Omit for a brand-new
     * grant (the new row becomes its own family root); pass the parent row's
     * family_id when rotating, so reuse detection can revoke the whole chain. */
    familyId?: string;
}): Promise<IssuedTokens> {
    const accessToken = randomToken(32);
    const refreshToken = randomToken(32);
    const tokenHash = sha256(accessToken);
    await query(
        `INSERT INTO oauth_access_tokens
           (token_hash, client_id, user_email, scope, resource, refresh_token_hash,
            expires_at, refresh_expires_at, family_id)
         VALUES ($1, $2, $3, $4, $5, $6,
            now() + ($7 || ' seconds')::interval,
            now() + ($8 || ' seconds')::interval,
            $9)`,
        [
            tokenHash,
            input.clientId,
            input.userEmail,
            input.scope,
            input.resource ?? null,
            sha256(refreshToken),
            String(ACCESS_TOKEN_TTL_SEC),
            String(REFRESH_TOKEN_TTL_SEC),
            input.familyId ?? tokenHash,
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

/** Revoke every token in a rotation family — called when a refresh token is
 * REUSED (presented again after it was already rotated away), the standard
 * signal that the token was stolen: the legitimate client already rotated
 * past it, so whoever is presenting it now isn't the legitimate client. */
async function revokeFamily(familyId: string): Promise<void> {
    await query(`UPDATE oauth_access_tokens SET is_revoked = true WHERE family_id = $1`, [familyId]);
}

/** Rotate a refresh token: validate it, revoke the old row, issue a new pair.
 * Detects reuse of an already-rotated refresh token and revokes the entire
 * family in response, rather than just rejecting the one replayed request. */
export async function rotateRefreshToken(
    refreshToken: string,
    clientId: string,
): Promise<IssuedTokens | null> {
    const refreshHash = sha256(refreshToken);
    const row = await queryOne<{
        user_email: string; scope: string; resource: string | null;
        is_revoked: boolean; refresh_expires_at: string; family_id: string | null; token_hash: string;
    }>(
        `SELECT user_email, scope, resource, is_revoked, refresh_expires_at, family_id, token_hash
         FROM oauth_access_tokens
         WHERE refresh_token_hash = $1
           AND client_id = $2
         LIMIT 1`,
        [refreshHash, clientId],
    );
    if (!row) return null; // unknown token — nothing to rotate or revoke

    const familyId = row.family_id ?? row.token_hash;

    if (row.is_revoked) {
        // Reuse of an already-rotated token: assume compromise, kill the
        // whole chain so the legitimate holder is forced to re-authenticate.
        await revokeFamily(familyId);
        return null;
    }
    if (new Date(row.refresh_expires_at) <= new Date()) return null;

    // Revoke this row, then mint a fresh pair carrying the same family_id.
    await query(
        `UPDATE oauth_access_tokens SET is_revoked = true WHERE refresh_token_hash = $1`,
        [refreshHash],
    );
    return issueTokens({
        clientId,
        userEmail: row.user_email,
        scope: row.scope,
        resource: row.resource ?? undefined,
        familyId,
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
