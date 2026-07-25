import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultRelayUrl, isLoopbackHost, resolveRelayUrl } from '@/lib/connect/relay-url';

describe('isLoopbackHost', () => {
    it('accepts localhost, loopback IPs, and *.localhost', () => {
        for (const h of ['localhost', 'LocalHost', '127.0.0.1', '127.5.5.5', '::1', 'db.localhost']) {
            expect(isLoopbackHost(h)).toBe(true);
        }
    });

    it('rejects public hosts', () => {
        for (const h of ['relay.tripplet.ai', 'example.com', '8.8.8.8', '10.0.0.5']) {
            expect(isLoopbackHost(h)).toBe(false);
        }
    });
});

describe('resolveRelayUrl transport-encryption policy', () => {
    it('allows wss:// to a public host', () => {
        const r = resolveRelayUrl('wss://relay.tripplet.ai/ws');
        expect(r).toEqual({ url: 'wss://relay.tripplet.ai/ws', secure: true, loopback: false });
    });

    it('allows ws:// only to loopback', () => {
        const r = resolveRelayUrl('ws://127.0.0.1:8080/ws');
        expect(r.secure).toBe(false);
        expect(r.loopback).toBe(true);
    });

    it('refuses plaintext ws:// to a public host', () => {
        expect(() => resolveRelayUrl('ws://relay.tripplet.ai/ws')).toThrow(/unencrypted relay/i);
    });

    it('rejects non-ws schemes', () => {
        expect(() => resolveRelayUrl('https://relay.tripplet.ai/ws')).toThrow(/ws:\/\/ or wss:\/\//i);
    });

    it('rejects malformed URLs', () => {
        expect(() => resolveRelayUrl('not a url')).toThrow(/invalid/i);
    });
});

describe('defaultRelayUrl', () => {
    const saved = { url: process.env.OPENSONOMA_RELAY_URL, node: process.env.NODE_ENV };
    beforeEach(() => {
        delete process.env.OPENSONOMA_RELAY_URL;
    });
    afterEach(() => {
        if (saved.url === undefined) delete process.env.OPENSONOMA_RELAY_URL;
        else process.env.OPENSONOMA_RELAY_URL = saved.url;
        (process.env as Record<string, string | undefined>).NODE_ENV = saved.node;
    });

    it('prefers the configured URL', () => {
        process.env.OPENSONOMA_RELAY_URL = 'wss://my-relay.example.com/ws';
        expect(defaultRelayUrl()).toBe('wss://my-relay.example.com/ws');
    });

    it('defaults to the managed TLS relay in production', () => {
        (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
        expect(defaultRelayUrl()).toBe('wss://relay.getsonoma.lol/ws');
        // ...and the production default satisfies the encryption policy.
        expect(resolveRelayUrl(defaultRelayUrl()).secure).toBe(true);
    });

    it('defaults to a local relay outside production', () => {
        (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
        expect(defaultRelayUrl()).toBe('ws://127.0.0.1:8080/ws');
    });
});
