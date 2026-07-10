import { describe, it, expect, vi } from 'vitest';
import { RedisRestStore, redisRestFromEnv } from '@/lib/security/rate-limit';

function fetchReturning(payload: unknown, status = 200): typeof fetch {
    return vi.fn(async () =>
        new Response(JSON.stringify(payload), { status }),
    ) as unknown as typeof fetch;
}

describe('RedisRestStore', () => {
    it('sends a single INCR+PEXPIRE pipeline and returns the count', async () => {
        const f = fetchReturning([{ result: 3 }, { result: 1 }]);
        const store = new RedisRestStore('https://kv.example.test', 'tok', f);
        const count = await store.incr('rl:60000:ip:1.2.3.4', 60_000);
        expect(count).toBe(3);

        const [url, init] = (f as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
        expect(url).toBe('https://kv.example.test/pipeline');
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
        const body = JSON.parse(String(init.body));
        expect(body[0]).toEqual(['INCR', 'rl:60000:ip:1.2.3.4']);
        // PEXPIRE ... NX so the window is fixed, not sliding.
        expect(body[1]).toEqual(['PEXPIRE', 'rl:60000:ip:1.2.3.4', '60000', 'NX']);
    });

    it('throws on HTTP errors so callers can fail open', async () => {
        const store = new RedisRestStore('https://kv.example.test', 'tok', fetchReturning({}, 500));
        await expect(store.incr('k', 1000)).rejects.toThrow('rate-limit store 500');
    });

    it('throws on malformed responses instead of returning NaN', async () => {
        const store = new RedisRestStore('https://kv.example.test', 'tok', fetchReturning([{ error: 'bad' }]));
        await expect(store.incr('k', 1000)).rejects.toThrow('bad response');
    });
});

describe('redisRestFromEnv', () => {
    it('is null when unconfigured (LRU fallback)', () => {
        expect(redisRestFromEnv({})).toBeNull();
    });

    it('detects Upstash env vars', () => {
        expect(redisRestFromEnv({
            UPSTASH_REDIS_REST_URL: 'https://u.example.test/',
            UPSTASH_REDIS_REST_TOKEN: 't',
        })).toBeInstanceOf(RedisRestStore);
    });

    it('detects Vercel KV env vars', () => {
        expect(redisRestFromEnv({
            KV_REST_API_URL: 'https://kv.example.test',
            KV_REST_API_TOKEN: 't',
        })).toBeInstanceOf(RedisRestStore);
    });

    it('requires BOTH url and token', () => {
        expect(redisRestFromEnv({ KV_REST_API_URL: 'https://kv.example.test' })).toBeNull();
    });
});
