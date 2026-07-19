import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/env', () => ({ env: { JWT_SECRET: 'unit-test-secret-at-least-32-chars-long!!' } }));

import { encryptText, decryptText } from '@/lib/chat/crypto';

describe('conversation at-rest crypto', () => {
    it('round-trips text', () => {
        const plain = 'hello — this is a private conversation 🤫';
        const stored = encryptText(plain);
        expect(stored).not.toBe(plain);
        expect(stored.startsWith('enc1:')).toBe(true);
        expect(decryptText(stored)).toBe(plain);
    });

    it('produces a different ciphertext per call (unique IVs)', () => {
        const a = encryptText('same input');
        const b = encryptText('same input');
        expect(a).not.toBe(b);
        expect(decryptText(a)).toBe('same input');
        expect(decryptText(b)).toBe('same input');
    });

    it('passes legacy plaintext rows through unchanged', () => {
        expect(decryptText('an old unencrypted message')).toBe('an old unencrypted message');
    });

    it('returns empty string for null/empty stored values', () => {
        expect(decryptText(null)).toBe('');
        expect(decryptText(undefined)).toBe('');
        expect(decryptText('')).toBe('');
        expect(encryptText('')).toBe('');
    });

    it('never surfaces ciphertext when the blob is tampered with', () => {
        const stored = encryptText('secret');
        const tampered = stored.slice(0, -4) + 'AAAA';
        expect(decryptText(tampered)).toBe('');
    });

    it('handles long multi-byte content', () => {
        const plain = '📚'.repeat(5000) + 'x'.repeat(50_000);
        expect(decryptText(encryptText(plain))).toBe(plain);
    });
});
