// MCP OAuth 2.1 — Authorization Server helpers (stateless).
//
// Sonoma is its own OAuth 2.1 Authorization Server AND Resource Server for the
// remote MCP endpoint (/api/mcp). There is NO database here: clients, codes,
// and tokens are all self-contained JWTs signed with JWT_SECRET — the same
// mechanism as the site session (see lib/auth/jwt.ts). Nothing to migrate,
// nothing to provision.
//
// Design:
//   • Public clients only (PKCE S256 required) — no client secrets.
//   • client_id, auth code, access token, refresh token are each a signed JWT
//     carrying a `k` (kind) claim, so one kind can never be replayed as another.
//   • Access tokens are short-lived (1h). Being stateless means they cannot be
//     revoked before expiry; that is the accepted trade for zero infrastructure.
//   • The public API below is identical to the previous DB-backed version, so
//     every route (authorize / token / register / mcp) is unchanged.

import crypto from 'crypto';
import { SignJWT, jwtVerify, type JWTPayload as JosePayload } from 'jose';
import { env } from '@/lib/env';

export const ACCESS_TOKEN_TTL_SEC = 60 * 60;            // 1 hour
export const REFRESH_TOKEN_TTL_SEC = 60 * 60 * 24 * 30; // 30 days
export const AUTH_CODE_TTL_SEC = 60;                    // 1 minute
export const CLIENT_TTL_SEC = 60 * 60 * 24 * 365;       // 1 year
export const MCP_SCOPE = 'mcp';
export const OFFLINE_ACCESS_SCOPE = 'offline_access';
export const SUPPORTED_SCOPES = new Set([MCP_SCOPE, OFFLINE_ACCESS_SCOPE]);

// ── signing ──────────────────────────────────────────────────────────────────

function key(): Uint8Array {
    return new TextEncoder().encode(env.JWT_SECRET);
}

/** Kinds of token this module mints. The claim is checked on every verify so a
 * refresh token can never be presented as an access token, and so on. */
type Kind = 'client' | 'code' | 'access' | 'refresh';

async function sign(kind: Kind, claims: JosePayload, ttlSec: number): Promise<string> {
    return new SignJWT({ ...claims, k: kind })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSec)
        .sign(key());
}

async function verify(kind: Kind, token: string): Promise<JosePayload | null> {
    try {
        const { payload } = await jwtVerify(token, key(), { algorithms: ['HS256'] });
        return payload.k === kind ? payload : null;
    } catch {
        return null; // bad signature, wrong kind, or expired — all "not valid"
    }
}

// ── scopes ────────────────────────────────────────────────────────────────────

/** True if every space-delimited scope in `requested` is one this server knows. */
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

/** Base URL / issuer for this deployment. */
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
    const a = Buffer.from(computed);
    const b = Buffer.from(challenge);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── Clients (Dynamic Client Registration) ───────────────────────────────────

const CLIENT_PREFIX = 'mcp_';

export interface OAuthClient {
    client_id: string;
    client_name: string | null;
    redirect_uris: string[];
    grant_types: string[];
    token_endpoint_auth_method: string;
}

/** The client_id IS the registration: a signed JWT carrying the approved
 * redirect_uris, so authorize/token can validate them without any lookup. */
export async function registerClient(input: {
    client_name?: string;
    redirect_uris: string[];
    grant_types?: string[];
    token_endpoint_auth_method?: string;
}): Promise<OAuthClient> {
    const grant_types = input.grant_types?.length
        ? input.grant_types
        : ['authorization_code', 'refresh_token'];
    const token = await sign('client', {
        ru: input.redirect_uris,
        cn: input.client_name ?? null,
    }, CLIENT_TTL_SEC);
    return {
        client_id: CLIENT_PREFIX + token,
        client_name: input.client_name ?? null,
        redirect_uris: input.redirect_uris,
        grant_types,
        token_endpoint_auth_method: input.token_endpoint_auth_method ?? 'none',
    };
}

export async function getClient(clientId: string): Promise<OAuthClient | null> {
    if (!clientId.startsWith(CLIENT_PREFIX)) return null;
    const payload = await verify('client', clientId.slice(CLIENT_PREFIX.length));
    if (!payload) return null;
    const ru = Array.isArray(payload.ru)
        ? (payload.ru as unknown[]).filter((u): u is string => typeof u === 'string')
        : [];
    return {
        client_id: clientId,
        client_name: typeof payload.cn === 'string' ? payload.cn : null,
        redirect_uris: ru,
        grant_types: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_method: 'none',
    };
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
    return sign('code', {
        sub: input.userEmail,
        cid: input.clientId,
        ru: input.redirectUri,
        cc: input.codeChallenge,
        ccm: input.codeChallengeMethod,
        sc: input.scope,
        res: input.resource ?? null,
    }, AUTH_CODE_TTL_SEC);
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

/** Verify a code. A JWT that verifies is within its 60s window (jose rejects
 * expired tokens), so `expired` is always false here — the field is retained
 * for API compatibility. Stateless codes are not single-use, but the 60s TTL
 * plus mandatory PKCE proof at the token endpoint makes replay impractical. */
export async function consumeAuthCode(code: string): Promise<AuthCodeRecord | null> {
    const p = await verify('code', code);
    if (!p) return null;
    return {
        client_id: String(p.cid ?? ''),
        user_email: String(p.sub ?? ''),
        redirect_uri: String(p.ru ?? ''),
        code_challenge: String(p.cc ?? ''),
        code_challenge_method: String(p.ccm ?? 'S256'),
        scope: String(p.sc ?? ''),
        resource: (p.res as string | null) ?? null,
        expired: false,
    };
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
    /** Kept for API compatibility; rotation is stateless so it is unused. */
    familyId?: string;
}): Promise<IssuedTokens> {
    const common = {
        sub: input.userEmail,
        sc: input.scope,
        res: input.resource ?? null,
        cid: input.clientId,
    };
    const [access_token, refresh_token] = await Promise.all([
        sign('access', common, ACCESS_TOKEN_TTL_SEC),
        sign('refresh', common, REFRESH_TOKEN_TTL_SEC),
    ]);
    return {
        access_token,
        refresh_token,
        expires_in: ACCESS_TOKEN_TTL_SEC,
        scope: input.scope,
        token_type: 'Bearer',
    };
}

/** Rotate a refresh token: verify it, confirm it was issued to this client,
 * and mint a fresh pair. Stateless, so an old refresh token stays valid until
 * its own 30-day expiry rather than being individually revocable. */
export async function rotateRefreshToken(
    refreshToken: string,
    clientId: string,
): Promise<IssuedTokens | null> {
    const p = await verify('refresh', refreshToken);
    if (!p) return null;
    if (p.cid && p.cid !== clientId) return null; // minted for a different client
    return issueTokens({
        clientId,
        userEmail: String(p.sub ?? ''),
        scope: String(p.sc ?? ''),
        resource: (p.res as string | null) ?? undefined,
    });
}

export interface ValidatedToken {
    userEmail: string;
    scope: string;
}

/** Validate a bearer access token for the MCP resource server. */
export async function validateAccessToken(accessToken: string): Promise<ValidatedToken | null> {
    const p = await verify('access', accessToken);
    if (!p) return null;
    return { userEmail: String(p.sub ?? ''), scope: String(p.sc ?? '') };
}
