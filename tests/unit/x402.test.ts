// Unit tests for the pure x402 pieces: money math, header codecs, local
// payment validation, and prepaid-key derivation. The settlement pipeline and
// paid inference are exercised end-to-end against a dev server (they need a
// DB + facilitator); everything here is dependency-free and deterministic.

import { describe, expect, it } from 'vitest';
import {
    CALLABLE_MODELS,
    CREDIT_PACKS,
    KEY_PREFIX,
    formatUsdcAtomic,
    usdToUsdcAtomic,
} from '@/lib/x402/catalog';
import {
    decodePaymentHeader,
    encodePaymentHeader,
    validatePaymentAgainstRequirements,
    type PaymentPayload,
    type PaymentRequirements,
} from '@/lib/x402/types';
import { deriveApiKey, hashApiKey, keyPrefixOf, looksLikeApiKey } from '@/lib/x402/keys';

// ─── Money math ──────────────────────────────────────────────────────────────

describe('usdToUsdcAtomic', () => {
    it('converts whole and fractional dollars exactly', () => {
        expect(usdToUsdcAtomic('12.00')).toBe('12000000');
        expect(usdToUsdcAtomic('0.99')).toBe('990000');
        expect(usdToUsdcAtomic('48')).toBe('48000000');
        expect(usdToUsdcAtomic('0.000001')).toBe('1');
    });

    it('never loses float precision (the classic 0.1 + 0.2 trap)', () => {
        expect(usdToUsdcAtomic('0.30')).toBe('300000');
        expect(usdToUsdcAtomic('19.99')).toBe('19990000');
    });

    it('rejects malformed amounts', () => {
        for (const bad of ['', '1.2345678', '-5', '1,00', '$4', '1e3', '.5']) {
            expect(() => usdToUsdcAtomic(bad)).toThrow();
        }
    });

    it('parses every catalog price (packs + per-call)', () => {
        for (const p of CREDIT_PACKS) expect(() => usdToUsdcAtomic(p.priceUsd)).not.toThrow();
        for (const m of CALLABLE_MODELS) expect(() => usdToUsdcAtomic(m.pricePerCallUsd)).not.toThrow();
    });
});

describe('formatUsdcAtomic', () => {
    it('renders money with at least cents', () => {
        expect(formatUsdcAtomic('12000000')).toBe('12.00');
        expect(formatUsdcAtomic('990000')).toBe('0.99');
        expect(formatUsdcAtomic('1')).toBe('0.000001');
    });

    it('roundtrips the catalog price range', () => {
        for (const usd of ['0.99', '4.99', '19.99', '0.01', '0.03']) {
            expect(formatUsdcAtomic(usdToUsdcAtomic(usd))).toBe(usd);
        }
    });
});

// ─── Header codecs + validation ──────────────────────────────────────────────

const REQUIREMENTS: PaymentRequirements = {
    scheme: 'exact',
    network: 'base-sepolia',
    maxAmountRequired: '990000',
    resource: 'https://example.com/api/x402/buy/starter',
    description: 'test',
    mimeType: 'application/json',
    payTo: '0x1111111111111111111111111111111111111111',
    maxTimeoutSeconds: 300,
    asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    extra: { name: 'USDC', version: '2' },
};

const NOW = 1_800_000_000;

function payment(overrides: Partial<PaymentPayload['payload']['authorization']> = {}): PaymentPayload {
    return {
        x402Version: 1,
        scheme: 'exact',
        network: 'base-sepolia',
        payload: {
            signature: '0x' + 'ab'.repeat(65),
            authorization: {
                from: '0x2222222222222222222222222222222222222222',
                to: '0x1111111111111111111111111111111111111111',
                value: '990000',
                validAfter: String(NOW - 600),
                validBefore: String(NOW + 300),
                nonce: '0x' + '11'.repeat(32),
                ...overrides,
            },
        },
    };
}

describe('payment header codec', () => {
    it('roundtrips a spec-shaped payload', () => {
        const decoded = decodePaymentHeader(encodePaymentHeader(payment()));
        expect(decoded.ok).toBe(true);
        if (decoded.ok) expect(decoded.payload.payload.authorization.value).toBe('990000');
    });

    it('rejects garbage, oversized, and mis-shaped headers', () => {
        expect(decodePaymentHeader('not base64 json!').ok).toBe(false);
        expect(decodePaymentHeader('x'.repeat(10_000)).ok).toBe(false);
        const missingSig = payment() as unknown as { payload: { signature?: string } };
        delete missingSig.payload.signature;
        const encoded = Buffer.from(JSON.stringify(missingSig)).toString('base64');
        const decoded = decodePaymentHeader(encoded);
        expect(decoded.ok).toBe(false);
        if (!decoded.ok) expect(decoded.error).toContain('signature');
    });
});

describe('validatePaymentAgainstRequirements', () => {
    it('accepts a matching payment', () => {
        expect(validatePaymentAgainstRequirements(payment(), REQUIREMENTS, NOW)).toBeNull();
    });

    it('accepts payTo in a different case (addresses are case-insensitive)', () => {
        const req = { ...REQUIREMENTS, payTo: '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01' };
        const p = payment({ to: '0xabcdef0123456789abcdef0123456789abcdef01' });
        expect(validatePaymentAgainstRequirements(p, req, NOW)).toBeNull();
    });

    it('rejects wrong network, wrong recipient, wrong amounts', () => {
        const wrongNet = { ...payment(), network: 'base' };
        expect(validatePaymentAgainstRequirements(wrongNet, REQUIREMENTS, NOW)).toContain('network');
        expect(
            validatePaymentAgainstRequirements(
                payment({ to: '0x3333333333333333333333333333333333333333' }),
                REQUIREMENTS,
                NOW,
            ),
        ).toContain('payTo');
        // Underpay AND overpay both rejected — `exact` settles the full value.
        expect(validatePaymentAgainstRequirements(payment({ value: '980000' }), REQUIREMENTS, NOW)).toContain('exactly');
        expect(validatePaymentAgainstRequirements(payment({ value: '1990000' }), REQUIREMENTS, NOW)).toContain('exactly');
    });

    it('rejects authorizations outside their validity window', () => {
        expect(
            validatePaymentAgainstRequirements(payment({ validAfter: String(NOW + 60) }), REQUIREMENTS, NOW),
        ).toContain('not valid yet');
        expect(
            validatePaymentAgainstRequirements(payment({ validBefore: String(NOW + 2) }), REQUIREMENTS, NOW),
        ).toContain('expires too soon');
    });
});

// ─── Prepaid key derivation ──────────────────────────────────────────────────

describe('prepaid keys', () => {
    it('derives a stable, well-formed key per payment id', () => {
        const key = deriveApiKey('pay_abc123');
        expect(key).toMatch(new RegExp(`^${KEY_PREFIX}[0-9a-f]{40}$`));
        expect(deriveApiKey('pay_abc123')).toBe(key); // deterministic → idempotent replays
        expect(deriveApiKey('pay_other')).not.toBe(key);
    });

    it('shape-checks keys strictly', () => {
        const key = deriveApiKey('pay_abc123');
        expect(looksLikeApiKey(key)).toBe(true);
        expect(looksLikeApiKey(` ${key} `)).toBe(true); // trims
        expect(looksLikeApiKey('trpl_sk_' + 'a'.repeat(40))).toBe(false); // developer keys are not store keys
        expect(looksLikeApiKey(KEY_PREFIX + 'a'.repeat(39))).toBe(false);
        expect(looksLikeApiKey(KEY_PREFIX + 'A'.repeat(40))).toBe(false); // lowercase hex only
        expect(looksLikeApiKey('')).toBe(false);
    });

    it('hashes deterministically and displays only a prefix', () => {
        const key = deriveApiKey('pay_abc123');
        expect(hashApiKey(key)).toBe(hashApiKey(key));
        expect(hashApiKey(key)).toMatch(/^[0-9a-f]{64}$/);
        const prefix = keyPrefixOf(key);
        expect(prefix.length).toBeLessThan(20);
        expect(key.startsWith(prefix.replace('…', ''))).toBe(true);
    });
});
