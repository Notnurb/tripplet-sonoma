// Session revocation for stateless JWTs.
//
// auth_token is a signed HS256 JWT with no server-side session row — normally
// fine, but it means logout and password-reset had nothing to actually revoke:
// a stolen token kept working for its full 7-day life even after the user
// "logged out everywhere" or reset their password.
//
// Standard fix for stateless tokens: store, per user, the timestamp before
// which any token is considered revoked. Every verify checks the token's
// `iat` (issued-at) against that cutoff — a token issued before the cutoff is
// rejected regardless of its own expiry. Shared (Redis-backed when
// configured, LRU fallback otherwise) so it works across serverless
// instances, same as rate-limit.ts.

import { sharedKvGet, sharedKvSet } from '@/lib/security/rate-limit';

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // matches the JWT's own max lifetime

function key(userId: string): string {
    return `session-invalidated-at:${userId}`;
}

/** Revoke every token issued for `userId` before right now. */
export async function invalidateSessionsNow(userId: string): Promise<void> {
    // Floor to the second: JWT `iat` has second precision, so a millisecond
    // cutoff would also reject a replacement token minted within the same
    // second (e.g. the fresh cookie issued right after a password change).
    const cutoff = Math.floor(Date.now() / 1000) * 1000;
    await sharedKvSet(key(userId), String(cutoff), TTL_MS);
}

/** Invalidation cutoff (ms epoch) for `userId`, or 0 if sessions were never revoked. */
export async function sessionsInvalidatedAt(userId: string): Promise<number> {
    const raw = await sharedKvGet(key(userId));
    return raw ? Number(raw) || 0 : 0;
}
