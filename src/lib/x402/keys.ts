// Prepaid inference keys (`trpl_x4_...`) — the thing a pack purchase buys.
// Accountless by design: the key is the whole credential, delivered inside
// the payment receipt and metered by token credits.
//
// Key material is HMAC-derived from the payment row id, so:
//   - nothing secret is stored at rest (only a SHA-256 for O(1) lookup);
//   - replaying the original X-PAYMENT header re-derives the same key — a
//     lost receipt never strands the purchase, and minting is idempotent;
//   - derivation entropy comes from the payment's random uuid + JWT_SECRET.

import { createHash, createHmac } from 'crypto';
import { env } from '@/lib/env';
import { isDbConfigured, isMissingTableError, query, queryOne } from '@/lib/db/neon';
import { KEY_PREFIX } from './catalog';

const KEY_BODY_HEX_CHARS = 40; // 20 bytes

function keySecret(): string {
    // JWT_SECRET is required (min 32 chars) in prod; the fallback only exists
    // so degraded local dev without a .env keeps working.
    return env.JWT_SECRET ?? 'x402-dev-insecure-secret';
}

/** Deterministically derive the raw key for a payment row. */
export function deriveApiKey(paymentId: string): string {
    const mac = createHmac('sha256', keySecret()).update(`x402-key:${paymentId}`).digest('hex');
    return `${KEY_PREFIX}${mac.slice(0, KEY_BODY_HEX_CHARS)}`;
}

export function hashApiKey(rawKey: string): string {
    return createHash('sha256').update(rawKey).digest('hex');
}

export function looksLikeApiKey(raw: string): boolean {
    return new RegExp(`^${KEY_PREFIX}[0-9a-f]{${KEY_BODY_HEX_CHARS}}$`).test(raw.trim());
}

/** For display: enough to recognize a key, never enough to use it. */
export function keyPrefixOf(rawKey: string): string {
    return rawKey.slice(0, KEY_PREFIX.length + 6) + '…';
}

export interface PrepaidKeyRow {
    id: string;
    key_prefix: string;
    label: string;
    credits_granted: string; // bigint comes back as string from pg
    credits_remaining: string;
    is_revoked: boolean;
    created_at: Date;
    last_used_at: Date | null;
}

type Queryable = { query: typeof query; queryOne: typeof queryOne };

/**
 * Mint the key for a settled payment. Idempotent: the deterministic key_hash
 * means a crash-and-retry of the same payment upserts into the same row
 * instead of minting a second key.
 */
export async function mintKey(
    db: Queryable,
    paymentId: string,
    label: string,
    credits: number,
): Promise<{ row: PrepaidKeyRow; rawKey: string }> {
    const rawKey = deriveApiKey(paymentId);
    const row = await db.queryOne<PrepaidKeyRow>(
        `INSERT INTO x402_api_keys (key_hash, key_prefix, label, credits_granted, credits_remaining)
         VALUES ($1, $2, $3, $4, $4)
         ON CONFLICT (key_hash) DO UPDATE SET key_hash = EXCLUDED.key_hash
         RETURNING id, key_prefix, label, credits_granted, credits_remaining, is_revoked, created_at, last_used_at`,
        [hashApiKey(rawKey), keyPrefixOf(rawKey), label, credits],
    );
    if (!row) throw new Error('mintKey: upsert returned no row');
    return { row, rawKey };
}

/** Add credits to an existing key. Returns null when the key is unknown/revoked. */
export async function topUpKey(
    db: Queryable,
    keyHash: string,
    credits: number,
): Promise<PrepaidKeyRow | null> {
    return db.queryOne<PrepaidKeyRow>(
        `UPDATE x402_api_keys
         SET credits_granted = credits_granted + $2,
             credits_remaining = credits_remaining + $2
         WHERE key_hash = $1 AND is_revoked = false
         RETURNING id, key_prefix, label, credits_granted, credits_remaining, is_revoked, created_at, last_used_at`,
        [keyHash, credits],
    );
}

export type KeyAuthResult =
    | { status: 'ok'; row: PrepaidKeyRow }
    | { status: 'unknown' }
    | { status: 'revoked' }
    | { status: 'exhausted'; row: PrepaidKeyRow }
    | { status: 'db-unavailable' };

/** Look up a raw key and report exactly why it can't be used, if it can't. */
export async function authenticatePrepaidKey(rawKey: string): Promise<KeyAuthResult> {
    if (!isDbConfigured()) return { status: 'db-unavailable' };
    let row: PrepaidKeyRow | null;
    try {
        row = await queryOne<PrepaidKeyRow>(
            `SELECT id, key_prefix, label, credits_granted, credits_remaining, is_revoked, created_at, last_used_at
             FROM x402_api_keys WHERE key_hash = $1 LIMIT 1`,
            [hashApiKey(rawKey)],
        );
    } catch (e) {
        if (isMissingTableError(e)) {
            console.error('[x402] x402_api_keys table missing — run `npm run setup:db`');
        }
        return { status: 'db-unavailable' };
    }
    if (!row) return { status: 'unknown' };
    if (row.is_revoked) return { status: 'revoked' };
    if (BigInt(row.credits_remaining) <= BigInt(0)) return { status: 'exhausted', row };
    return { status: 'ok', row };
}

/**
 * Charge actual usage after a completion. Deliberately allows the balance to
 * dip below zero on a key's final call (the overdraw is bounded by the
 * request's max_tokens cap); the pre-call check in authenticatePrepaidKey
 * blocks the NEXT call. Never throws — a metering hiccup must not eat a
 * response the upstream already produced; it logs loudly instead.
 */
export async function chargeKey(keyId: string, tokens: number): Promise<bigint | null> {
    if (tokens <= 0) return null;
    try {
        const row = await queryOne<{ credits_remaining: string }>(
            `UPDATE x402_api_keys
             SET credits_remaining = credits_remaining - $2, last_used_at = now()
             WHERE id = $1
             RETURNING credits_remaining`,
            [keyId, tokens],
        );
        return row ? BigInt(row.credits_remaining) : null;
    } catch (e) {
        console.error(`[x402] CRITICAL: failed to charge key ${keyId} for ${tokens} tokens:`, e instanceof Error ? e.message : e);
        return null;
    }
}
