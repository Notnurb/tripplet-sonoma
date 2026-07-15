// Rate limiting with a pluggable counter store.
//
// Two backends behind one interface:
//   1. RedisRestStore — used automatically when Upstash / Vercel KV REST env
//      vars are present (UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/
//      TOKEN). Counters are then GLOBAL across serverless instances and
//      survive cold starts. Implemented over the plain REST pipeline API —
//      no SDK dependency.
//   2. LruStore — in-memory fallback for local dev and un-configured deploys.
//      Per-instance only: on multi-instance serverless the effective global
//      limit is (limit × instances). Acceptable as an abuse brake.
//
// If Redis is configured but a call fails (outage, bad token), the check
// FAILS OPEN into the local LRU store rather than blocking users or letting
// traffic through uncounted.

import { LRUCache } from 'lru-cache';
import { NextRequest, NextResponse } from 'next/server';

interface CounterStore {
    /** Increment `key`, setting expiry `ttlMs` on first touch. Returns the new count. */
    incr(key: string, ttlMs: number): Promise<number>;
}

class LruStore implements CounterStore {
    private cache: LRUCache<string, number>;
    constructor(ttlMs: number, maxKeys: number) {
        this.cache = new LRUCache({ max: maxKeys, ttl: ttlMs, ttlResolution: 1000 });
    }
    async incr(key: string, _ttlMs: number): Promise<number> {
        // TTL is fixed per store instance (set on the LRU cache) — the
        // parameter exists to satisfy the shared CounterStore interface.
        void _ttlMs;
        const next = (this.cache.get(key) ?? 0) + 1;
        this.cache.set(key, next);
        return next;
    }
}

export class RedisRestStore implements CounterStore {
    constructor(
        private url: string,
        private token: string,
        private fetchImpl: typeof fetch = fetch,
    ) {}

    async incr(key: string, ttlMs: number): Promise<number> {
        // Single round-trip: INCR the counter, then attach the window expiry
        // only if the key has none yet (NX), so the window never slides.
        const res = await this.fetchImpl(`${this.url}/pipeline`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify([
                ['INCR', key],
                ['PEXPIRE', key, String(ttlMs), 'NX'],
            ]),
            signal: AbortSignal.timeout(2000),
        });
        if (!res.ok) throw new Error(`rate-limit store ${res.status}`);
        const data = (await res.json()) as Array<{ result?: unknown; error?: string }>;
        const count = Number(data?.[0]?.result);
        if (!Number.isFinite(count)) throw new Error('rate-limit store bad response');
        return count;
    }
}

export function redisRestFromEnv(env: Record<string, string | undefined> = process.env): RedisRestStore | null {
    const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
    const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
    if (url && token) return new RedisRestStore(url.replace(/\/$/, ''), token);
    return null;
}

const sharedRedis = redisRestFromEnv();
let warnedRedisDown = false;

type RateLimitOptions = {
    interval: number; // Time window in ms
    uniqueTokenPerInterval: number; // Max unique tokens tracked (LRU backend)
};

export function rateLimit(options: RateLimitOptions) {
    const interval = options.interval || 60000;
    const lru = new LruStore(interval, options.uniqueTokenPerInterval || 10000);

    return {
        check: async (limit: number, token: string): Promise<void> => {
            // Namespace by window length so limiters with different intervals
            // sharing one Redis never collide on a token.
            const key = `rl:${interval}:${token}`;
            let count: number;
            if (sharedRedis) {
                try {
                    count = await sharedRedis.incr(key, interval);
                } catch {
                    if (!warnedRedisDown) {
                        warnedRedisDown = true;
                        console.error('[rate-limit] Redis store unavailable — failing open to per-instance limits.');
                    }
                    count = await lru.incr(key, interval);
                }
            } else {
                count = await lru.incr(key, interval);
            }
            if (count > limit) throw new Error('Rate limit exceeded');
        },
    };
}

// Pre-configured limiters — intentionally very high to avoid blocking legitimate users
export const chatLimiter = rateLimit({ interval: 60 * 60 * 1000, uniqueTokenPerInterval: 10000 });
export const imageLimiter = rateLimit({ interval: 60 * 60 * 1000, uniqueTokenPerInterval: 10000 });
export const titleLimiter = rateLimit({ interval: 60 * 60 * 1000, uniqueTokenPerInterval: 10000 });
export const searchLimiter = rateLimit({ interval: 60 * 60 * 1000, uniqueTokenPerInterval: 10000 });
export const devKeyLimiter = rateLimit({ interval: 60 * 60 * 1000, uniqueTokenPerInterval: 10000 });
export const profileLimiter = rateLimit({ interval: 60 * 60 * 1000, uniqueTokenPerInterval: 10000 });

// Auth-specific limiters — intentionally strict to block brute-force and abuse.
export const loginLimiter = rateLimit({ interval: 15 * 60 * 1000, uniqueTokenPerInterval: 10000 }); // 15 min window
export const registerLimiter = rateLimit({ interval: 60 * 60 * 1000, uniqueTokenPerInterval: 10000 });
export const forgotPasswordLimiter = rateLimit({ interval: 60 * 60 * 1000, uniqueTokenPerInterval: 10000 });

// x402 store limiters. Buy covers 402 challenges AND paid attempts (agents
// retry legitimately, so it's roomy); chat covers the paid inference endpoint
// where every allowed request is either settling money or burning credits.
export const x402BuyLimiter = rateLimit({ interval: 60 * 60 * 1000, uniqueTokenPerInterval: 10000 });
export const x402ChatLimiter = rateLimit({ interval: 60 * 60 * 1000, uniqueTokenPerInterval: 10000 });

// Limits per hour per token (user ID or IP).
// Set conservatively — these are real guard rails, not rubber stamps.
// Authenticated users are keyed by stable userId so IP rotation does not help an attacker.
export const LIMITS = {
    chat: 100,          // 100 completions/hr — comfortably above normal usage
    image: 50,          // 50 image generations/hr
    title: 200,         // 200 title generations/hr (short, cheap)
    search: 200,        // 200 search queries/hr
    devKey: 20,         // 20 key management operations/hr
    profile: 30,        // 30 profile updates/hr
    login: 10,          // 10 login attempts per 15 min per IP
    register: 5,        // 5 registration attempts/hr per IP
    forgotPassword: 3,  // 3 reset requests/hr per IP — tight to prevent email flooding
    x402Buy: 120,       // 120 store challenges/purchases per hour — agents retry
    x402Chat: 600,      // 600 paid inference calls/hr — paying traffic, keep roomy
};

/** Returns a 429 response with standard headers. */
export function rateLimitResponse() {
    return NextResponse.json(
        { error: 'Too many requests. Please slow down.' },
        {
            status: 429,
            headers: { 'Retry-After': '60' },
        }
    );
}

/**
 * Extract a stable rate-limit token from the request.
 *
 * Priority:
 *  1. userId (from the app's own auth) — most reliable; authenticated users
 *     are always keyed by ID.
 *  2. x-real-ip — set by trusted reverse proxies (Vercel, nginx) and harder to spoof.
 *  3. The LAST entry in x-forwarded-for — this is the IP added by the outermost
 *     trusted proxy, not the first entry which is attacker-controlled (a malicious
 *     client can inject arbitrary values at position 0 of that header).
 *  4. 'unknown' as a last resort so the limiter still fires rather than skipping.
 *
 * NOTE: If you ever run behind a proxy that does NOT set x-real-ip, verify that
 * you trust ALL hops in x-forwarded-for before switching back to [0].
 */
export function getRateLimitToken(req: NextRequest, userId?: string | null): string {
    if (userId) return `user:${userId}`;

    const realIp = req.headers.get('x-real-ip');
    if (realIp) return `ip:${realIp.trim()}`;

    const forwarded = req.headers.get('x-forwarded-for');
    if (forwarded) {
        const ips = forwarded.split(',').map(s => s.trim()).filter(Boolean);
        // Default: the rightmost (outermost-proxy-appended) IP, never the
        // leftmost (client-supplied, trivially spoofable) one. If the operator
        // KNOWS how many trusted proxies append to this header, they set
        // RATE_LIMIT_TRUSTED_PROXY_HOPS=N to pick the Nth-from-right entry (the
        // real client as seen just inside the trust boundary). Making the trust
        // depth an explicit, declared value beats relying on a code comment —
        // an out-of-range value clamps to the leftmost real entry rather than
        // silently reading an attacker-controlled position.
        const hops = Number(process.env.RATE_LIMIT_TRUSTED_PROXY_HOPS ?? '1');
        const fromRight = Number.isFinite(hops) && hops >= 1 ? Math.floor(hops) : 1;
        const idx = Math.max(0, ips.length - fromRight);
        const ip = ips[idx] ?? 'unknown';
        return `ip:${ip}`;
    }

    return 'ip:unknown';
}
