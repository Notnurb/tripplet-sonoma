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

    private headers(): Record<string, string> {
        return { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' };
    }

    async incr(key: string, ttlMs: number): Promise<number> {
        // Single round-trip: INCR the counter, then attach the window expiry
        // only if the key has none yet (NX), so the window never slides.
        const res = await this.fetchImpl(`${this.url}/pipeline`, {
            method: 'POST',
            headers: this.headers(),
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

    async get(key: string): Promise<string | null> {
        const res = await this.fetchImpl(`${this.url}/get/${encodeURIComponent(key)}`, {
            headers: this.headers(),
            signal: AbortSignal.timeout(2000),
        });
        if (!res.ok) throw new Error(`kv store ${res.status}`);
        const data = (await res.json()) as { result?: string | null };
        return data.result ?? null;
    }

    async set(key: string, value: string, ttlMs: number): Promise<void> {
        const res = await this.fetchImpl(`${this.url}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}?PX=${ttlMs}`, {
            method: 'POST',
            headers: this.headers(),
            signal: AbortSignal.timeout(2000),
        });
        if (!res.ok) throw new Error(`kv store ${res.status}`);
    }

    async del(key: string): Promise<void> {
        const res = await this.fetchImpl(`${this.url}/del/${encodeURIComponent(key)}`, {
            method: 'POST',
            headers: this.headers(),
            signal: AbortSignal.timeout(2000),
        });
        if (!res.ok) throw new Error(`kv store ${res.status}`);
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

// ─── Shared counter store (get/incr/delete) ─────────────────────────────────
// Used where a caller needs to READ and CLEAR a counter, not just increment
// it (e.g. account lockout: check current count, clear on successful login).
// Same Redis-or-LRU fallback as the rate limiters above, so lockout state is
// actually shared across serverless instances when Redis is configured —
// a per-instance-only LRU here would let an attacker bypass the lockout
// simply by landing on a fresh instance.
export interface CounterKvStore {
    get(key: string): Promise<number>;
    incr(key: string, ttlMs: number): Promise<number>;
    del(key: string): Promise<void>;
}

class LruKvStore implements CounterKvStore {
    private cache = new LRUCache<string, number>({ max: 100000, ttl: 15 * 60 * 1000, ttlResolution: 1000 });
    async get(key: string): Promise<number> {
        return this.cache.get(key) ?? 0;
    }
    async incr(key: string, _ttlMs: number): Promise<number> {
        void _ttlMs;
        const next = (this.cache.get(key) ?? 0) + 1;
        this.cache.set(key, next);
        return next;
    }
    async del(key: string): Promise<void> {
        this.cache.delete(key);
    }
}

class RedisKvStore implements CounterKvStore {
    constructor(private redis: RedisRestStore) {}
    async get(key: string): Promise<number> {
        const raw = await this.redis.get(key);
        return raw ? Number(raw) || 0 : 0;
    }
    async incr(key: string, ttlMs: number): Promise<number> {
        return this.redis.incr(key, ttlMs);
    }
    async del(key: string): Promise<void> {
        await this.redis.del(key);
    }
}

const lockoutLru = new LruKvStore();
const lockoutStore: CounterKvStore = sharedRedis ? new RedisKvStore(sharedRedis) : lockoutLru;

/**
 * Shared (Redis-backed when configured, LRU fallback otherwise) counter for
 * account lockout — get the current count, increment on failure, clear on
 * success. Falls open to the LRU store on a Redis error so an outage can't
 * turn into a hard-lock of all logins.
 */
export async function lockoutGet(key: string): Promise<number> {
    try {
        return await lockoutStore.get(key);
    } catch {
        return lockoutLru.get(key);
    }
}
export async function lockoutIncr(key: string, ttlMs: number): Promise<number> {
    try {
        return await lockoutStore.incr(key, ttlMs);
    } catch {
        return lockoutLru.incr(key, ttlMs);
    }
}
export async function lockoutClear(key: string): Promise<void> {
    try {
        await lockoutStore.del(key);
    } catch {
        await lockoutLru.del(key);
    }
}

// ─── Shared generic KV (get/set string, TTL) ────────────────────────────────
// A slightly more general primitive than the counter stores above — for
// values that need to be SET to something specific (not just incremented),
// e.g. session-revocation cutoff timestamps (src/lib/auth/session-store.ts).
// Same Redis-when-configured/LRU-fallback shape as everything else here.
class LruValueStore {
    private cache = new LRUCache<string, string>({ max: 100000, ttl: 30 * 24 * 60 * 60 * 1000, ttlResolution: 1000 });
    get(key: string): string | null {
        return this.cache.get(key) ?? null;
    }
    set(key: string, value: string, ttlMs: number): void {
        this.cache.set(key, value, { ttl: ttlMs });
    }
}
const valueLru = new LruValueStore();

export async function sharedKvGet(key: string): Promise<string | null> {
    const local = valueLru.get(key);
    let remote: string | null = null;
    if (sharedRedis) {
        try {
            remote = await sharedRedis.get(key);
        } catch {
            remote = null; // Redis unreachable — trust the local value
        }
    }
    // The only consumer stores monotonic epoch-ms revocation cutoffs, where a
    // larger value is strictly more restrictive and must never regress. If a
    // prior write reached only the local LRU (the Redis write threw and was
    // swallowed in sharedKvSet), a later Redis read would return the older/
    // absent value and silently drop the revocation — re-authorizing a token
    // the user already killed. Returning the greater of the two closes that
    // window: a revocation, once written anywhere, is never lost on this
    // instance.
    if (local !== null && remote !== null) {
        const a = Number(local);
        const b = Number(remote);
        if (Number.isFinite(a) && Number.isFinite(b)) return String(Math.max(a, b));
        return remote; // non-numeric value: prefer the shared source
    }
    return remote ?? local;
}

export async function sharedKvSet(key: string, value: string, ttlMs: number): Promise<void> {
    // Always write local LRU too — if Redis is down, at least this instance
    // enforces the value immediately rather than failing open entirely.
    valueLru.set(key, value, ttlMs);
    if (sharedRedis) {
        try {
            await sharedRedis.set(key, value, ttlMs);
        } catch {
            // best-effort beyond this instance
        }
    }
}

type RateLimitOptions = {
    interval: number; // Time window in ms
    uniqueTokenPerInterval: number; // Max unique tokens tracked (LRU backend)
    // Stable per-limiter identity. On the LRU backend each rateLimit() call
    // owns a private store, so names never collide there — but on the shared
    // Redis backend every limiter writes to one keyspace, and limiters with
    // the SAME interval (e.g. all the 1-hour ones: chat/search/upload/…) would
    // otherwise hash the same token to the same counter and drain each other's
    // budgets. The name segment keeps their buckets genuinely independent.
    name?: string;
};

export function rateLimit(options: RateLimitOptions) {
    const interval = options.interval || 60000;
    const name = options.name ?? '';
    const lru = new LruStore(interval, options.uniqueTokenPerInterval || 10000);

    return {
        check: async (limit: number, token: string): Promise<void> => {
            // Namespace by limiter name AND window length so limiters sharing
            // one Redis never collide on a token — neither across different
            // intervals nor across same-interval limiters.
            const key = `rl:${name}:${interval}:${token}`;
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

// Pre-configured limiters — intentionally very high to avoid blocking legitimate users.
// Each carries a distinct `name` so its Redis bucket is independent of every
// other limiter that shares the same interval (see rateLimit()'s note).
export const chatLimiter = rateLimit({ name: 'chat', interval: 60 * 60 * 1000, uniqueTokenPerInterval: 10000 });
export const imageLimiter = rateLimit({ name: 'image', interval: 60 * 60 * 1000, uniqueTokenPerInterval: 10000 });
export const titleLimiter = rateLimit({ name: 'title', interval: 60 * 60 * 1000, uniqueTokenPerInterval: 10000 });
export const searchLimiter = rateLimit({ name: 'search', interval: 60 * 60 * 1000, uniqueTokenPerInterval: 10000 });
export const devKeyLimiter = rateLimit({ name: 'devkey', interval: 60 * 60 * 1000, uniqueTokenPerInterval: 10000 });
export const profileLimiter = rateLimit({ name: 'profile', interval: 60 * 60 * 1000, uniqueTokenPerInterval: 10000 });
// Own buckets for uploads and per-article engagement counters — sharing
// searchLimiter meant heavy searching blocked uploads (and vice versa), and
// reactions/views could be pumped up to the full search budget per article.
export const uploadLimiter = rateLimit({ name: 'upload', interval: 60 * 60 * 1000, uniqueTokenPerInterval: 10000 });
export const engagementLimiter = rateLimit({ name: 'engagement', interval: 60 * 60 * 1000, uniqueTokenPerInterval: 20000 });
// Connector (Composio) management — browsing apps, connecting, disconnecting.
export const connectorLimiter = rateLimit({ name: 'connector', interval: 60 * 60 * 1000, uniqueTokenPerInterval: 10000 });
// Usage summary reads (Settings panel polls every minute + focus refetches).
export const usageLimiter = rateLimit({ name: 'usage', interval: 60 * 60 * 1000, uniqueTokenPerInterval: 10000 });

// Auth-specific limiters — intentionally strict to block brute-force and abuse.
export const loginLimiter = rateLimit({ name: 'login', interval: 15 * 60 * 1000, uniqueTokenPerInterval: 10000 }); // 15 min window
export const registerLimiter = rateLimit({ name: 'register', interval: 60 * 60 * 1000, uniqueTokenPerInterval: 10000 });
export const forgotPasswordLimiter = rateLimit({ name: 'forgot-password', interval: 60 * 60 * 1000, uniqueTokenPerInterval: 10000 });
// OAuth Dynamic Client Registration (RFC 7591) is open and unauthenticated by
// design — any MCP client self-registers before a human ever approves
// anything. Without a limiter that's unbounded row growth for free; per-IP
// is the only signal available pre-auth.
export const oauthRegisterLimiter = rateLimit({ name: 'oauth-register', interval: 60 * 60 * 1000, uniqueTokenPerInterval: 10000 });

// x402 store limiters. Buy covers 402 challenges AND paid attempts (agents
// retry legitimately, so it's roomy); chat covers the paid inference endpoint
// where every allowed request is either settling money or burning credits.
export const x402BuyLimiter = rateLimit({ name: 'x402-buy', interval: 60 * 60 * 1000, uniqueTokenPerInterval: 10000 });
export const x402ChatLimiter = rateLimit({ name: 'x402-chat', interval: 60 * 60 * 1000, uniqueTokenPerInterval: 10000 });
export const syncLimiter = rateLimit({ name: 'sync', interval: 60 * 60 * 1000, uniqueTokenPerInterval: 10000 });

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
    oauthRegister: 20,  // 20 OAuth DCR registrations/hr per IP — generous for legitimate multi-client setup, still bounded
    upload: 30,         // 30 image uploads/hr — independent of the search budget
    engagement: 20,     // 20 reactions/views per article per hour per token — keeps counts honest
    connector: 120,     // 120 connector ops/hr — the chat composer menu lists on every open, plus connect/disconnect
    usage: 240,         // 240 usage-summary reads/hr — a 60s poll is 60/hr, leave room for focus refetches
    sync: 360,          // 360 conversation syncs/hr — debounced client pushes, one per pause in typing
};

/** Returns a 429 response with standard headers. */
export function rateLimitResponse() {
    return NextResponse.json(
        { error: "You're moving faster than we can keep up — give it a minute and try again." },
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
        // If the configured trust depth exceeds the number of entries present,
        // the Nth-from-right position doesn't exist — clamping to index 0 would
        // hand the key to the leftmost, fully client-controlled (spoofable)
        // entry, letting an attacker mint a fresh bucket per request. Fail
        // closed to a single shared bucket instead.
        if (fromRight > ips.length) return 'ip:unknown';
        const idx = ips.length - fromRight;
        const ip = ips[idx] ?? 'unknown';
        return `ip:${ip}`;
    }

    return 'ip:unknown';
}
