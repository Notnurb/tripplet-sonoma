import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto';
import { env } from '@/lib/env';

/**
 * At-rest encryption for conversation data (titles + message content).
 *
 * The key is derived from JWT_SECRET — the same secret the auth system signs
 * sessions with — via HKDF, so no new environment variable is needed: any
 * deployment where login works can also encrypt conversations. Derivation
 * (rather than using the secret directly) keeps the JWT-signing key and the
 * storage key cryptographically independent.
 *
 * Stored format: `enc1:` + base64(iv[12] | authTag[16] | ciphertext).
 * Anything without the prefix is legacy plaintext and passes through reads
 * untouched, so pre-existing rows keep working without a migration.
 *
 * Degrades gracefully: with no JWT_SECRET (some local dev setups) writes stay
 * plaintext and reads still pass through — the app never goes down over this.
 */

const PREFIX = 'enc1:';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

let cachedKey: Buffer | null | undefined;

function getKey(): Buffer | null {
    if (cachedKey !== undefined) return cachedKey;
    const secret = env.JWT_SECRET;
    if (!secret) {
        cachedKey = null;
        return cachedKey;
    }
    cachedKey = Buffer.from(
        hkdfSync('sha256', secret, 'tripplet-conversation-at-rest', 'aes-256-gcm-v1', 32),
    );
    return cachedKey;
}

export function encryptText(plain: string): string {
    if (!plain) return plain;
    const key = getKey();
    if (!key) return plain;
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

export function decryptText(stored: string | null | undefined): string {
    if (!stored) return '';
    if (!stored.startsWith(PREFIX)) return stored; // legacy plaintext row
    const key = getKey();
    if (!key) return '';
    try {
        const blob = Buffer.from(stored.slice(PREFIX.length), 'base64');
        const iv = blob.subarray(0, IV_LENGTH);
        const tag = blob.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
        const ciphertext = blob.subarray(IV_LENGTH + TAG_LENGTH);
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
        // Wrong/rotated secret or corrupt row — never surface ciphertext.
        console.warn('[chat-crypto] failed to decrypt a stored value');
        return '';
    }
}
