import { describe, it, expect, beforeEach } from 'vitest';
import { checkDevPassword, createDevToken, verifyDevToken } from '@/lib/devAccess';

describe('devAccess', () => {
    beforeEach(() => {
        process.env.DEV_PANEL_PASSWORD = 'test-password-123';
    });

    it('accepts the correct password and rejects wrong ones', () => {
        expect(checkDevPassword('test-password-123')).toBe(true);
        expect(checkDevPassword('wrong')).toBe(false);
        expect(checkDevPassword('')).toBe(false);
        // Same length as the real one but different content.
        expect(checkDevPassword('test-password-124')).toBe(false);
    });

    it('round-trips a token', () => {
        expect(verifyDevToken(createDevToken())).toBe(true);
    });

    it('rejects garbage, empty, and structurally invalid tokens', () => {
        expect(verifyDevToken(undefined)).toBe(false);
        expect(verifyDevToken(null)).toBe(false);
        expect(verifyDevToken('')).toBe(false);
        expect(verifyDevToken('no-dot-here')).toBe(false);
        expect(verifyDevToken('123.')).toBe(false);
        expect(verifyDevToken('abc.def')).toBe(false);
    });

    it('rejects a tampered signature', () => {
        const token = createDevToken();
        const [exp, mac] = token.split('.');
        const flipped = (mac[0] === 'a' ? 'b' : 'a') + mac.slice(1);
        expect(verifyDevToken(`${exp}.${flipped}`)).toBe(false);
    });

    it('rejects an expired token even with a valid-looking shape', () => {
        const token = createDevToken();
        const mac = token.split('.')[1];
        const past = String(Date.now() - 1000);
        expect(verifyDevToken(`${past}.${mac}`)).toBe(false);
    });

    it('invalidates tokens when the password rotates', () => {
        const token = createDevToken();
        process.env.DEV_PANEL_PASSWORD = 'rotated-password-456';
        expect(verifyDevToken(token)).toBe(false);
    });
});
