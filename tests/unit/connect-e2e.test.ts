import { describe, expect, it } from 'vitest';
import { generateKeyPair, open, seal, sealToString, type SealedBox } from '@/lib/connect/e2e';

describe('OpenSonoma end-to-end sealed box', () => {
    it('round-trips a sealed message to the recipient', () => {
        const device = generateKeyPair();
        const box = seal(device.publicKeyB64, 'hunter2');
        expect(open(device.privateKey, box).toString('utf8')).toBe('hunter2');
    });

    it('produces a fresh ephemeral key (and thus different ciphertext) each seal', () => {
        const device = generateKeyPair();
        const a = seal(device.publicKeyB64, 'same-plaintext');
        const b = seal(device.publicKeyB64, 'same-plaintext');
        expect(a.epk).not.toBe(b.epk);
        expect(a.ct).not.toBe(b.ct);
        // ...yet both decrypt to the same plaintext.
        expect(open(device.privateKey, a).toString('utf8')).toBe('same-plaintext');
        expect(open(device.privateKey, b).toString('utf8')).toBe('same-plaintext');
    });

    it('cannot be opened by a different key (a relay/attacker without the private key)', () => {
        const device = generateKeyPair();
        const attacker = generateKeyPair();
        const box = seal(device.publicKeyB64, 'secret');
        expect(() => open(attacker.privateKey, box)).toThrow();
    });

    it('rejects a tampered ciphertext', () => {
        const device = generateKeyPair();
        const box = seal(device.publicKeyB64, 'secret');
        const ct = Buffer.from(box.ct, 'base64');
        ct[0] ^= 0xff;
        const tampered: SealedBox = { ...box, ct: ct.toString('base64') };
        expect(() => open(device.privateKey, tampered)).toThrow();
    });

    it('binds additional authenticated data (AAD)', () => {
        const device = generateKeyPair();
        const aad = Buffer.from('device-123:op-456');
        const box = seal(device.publicKeyB64, 'secret', aad);
        expect(open(device.privateKey, box, aad).toString('utf8')).toBe('secret');
        // Wrong AAD must fail authentication.
        expect(() => open(device.privateKey, box, Buffer.from('device-123:op-999'))).toThrow();
        // Missing AAD must also fail.
        expect(() => open(device.privateKey, box)).toThrow();
    });

    it('rejects malformed boxes', () => {
        const device = generateKeyPair();
        const empty: SealedBox = { v: 1, epk: '', iv: '', ct: '', tag: '' };
        expect(() => open(device.privateKey, empty)).toThrow(/malformed|bad|invalid/i);
    });

    it('sealToString yields JSON that parses back into a valid box', () => {
        const device = generateKeyPair();
        const s = sealToString(device.publicKeyB64, 'via-json');
        const box = JSON.parse(s) as SealedBox;
        expect(box.v).toBe(1);
        expect(open(device.privateKey, box).toString('utf8')).toBe('via-json');
    });
});
