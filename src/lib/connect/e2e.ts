// End-to-end encryption for the OpenSonoma relay.
//
// The relay is an untrusted forwarder: it terminates TLS, so without this layer
// it can read the per-use password and command that a Sonoma session sends to a
// paired machine. This module gives the client a "sealed box" it can address to
// a specific device's public key. Only the holder of that device's private key
// (the daemon on the user's machine) can open it — the relay forwards an opaque
// blob it cannot read.
//
// Scheme (hybrid public-key encryption, libsodium `crypto_box_seal` style):
//   1. sender makes an ephemeral X25519 keypair (epk, esk)
//   2. shared   = X25519(esk, recipientPub)
//   3. key      = HKDF-SHA256(ikm=shared, salt=epk||recipientPub, info=INFO, 32)
//   4. iv       = 12 random bytes
//   5. ct,tag   = AES-256-GCM(key, iv, plaintext, aad)
//   6. send     = { v:1, epk, iv, ct, tag }   (all base64)
// The recipient recomputes the shared secret from (recipientPriv, epk) and
// decrypts. Forward secrecy comes from the ephemeral key; integrity + AAD
// binding come from GCM.
//
// The Python daemon mirrors this exact construction in `opensonoma/e2e.py`
// (using `cryptography`); the two MUST stay byte-compatible. All public keys on
// the wire are RAW 32-byte X25519 keys, base64-encoded.

import {
    createCipheriv,
    createDecipheriv,
    createPublicKey,
    diffieHellman,
    generateKeyPairSync,
    hkdfSync,
    type KeyObject,
    randomBytes,
} from 'node:crypto';

// Domain-separation string bound into the KDF. Bump the suffix if the scheme
// ever changes so old and new keys can never be confused.
const HKDF_INFO = Buffer.from('opensonoma-e2e-v1');
const KEY_LEN = 32; // AES-256
const IV_LEN = 12; // GCM standard nonce

/** A sealed box as it travels on the wire (all fields base64). */
export interface SealedBox {
    v: 1;
    /** Ephemeral X25519 public key (raw 32 bytes, base64). */
    epk: string;
    /** AES-GCM nonce (12 bytes, base64). */
    iv: string;
    /** Ciphertext (base64). */
    ct: string;
    /** GCM authentication tag (16 bytes, base64). */
    tag: string;
}

export interface KeyPair {
    /** Raw 32-byte X25519 public key, base64 — this is what goes on the wire. */
    publicKeyB64: string;
    /** Private key object, kept in memory only. */
    privateKey: KeyObject;
}

// --- raw-key helpers --------------------------------------------------------
// Node represents X25519 keys as KeyObjects; the relay protocol exchanges raw
// 32-byte keys (matching Python's `cryptography`). We convert via JWK, whose
// `x`/`d` members are the raw public/private scalars (base64url).

function rawPublicOf(key: KeyObject): Buffer {
    const jwk = key.export({ format: 'jwk' }) as { x?: string };
    if (!jwk.x) throw new Error('not an X25519 public key');
    return Buffer.from(jwk.x, 'base64url');
}

function publicKeyFromRaw(raw: Buffer): KeyObject {
    if (raw.length !== 32) throw new Error('X25519 public key must be 32 bytes');
    return createPublicKey({
        key: { kty: 'OKP', crv: 'X25519', x: raw.toString('base64url') },
        format: 'jwk',
    });
}

/** Generate a fresh X25519 identity keypair. */
export function generateKeyPair(): KeyPair {
    const { publicKey, privateKey } = generateKeyPairSync('x25519');
    return { publicKeyB64: rawPublicOf(publicKey).toString('base64'), privateKey };
}

function deriveKey(shared: Buffer, epk: Buffer, recipientPub: Buffer): Buffer {
    const salt = Buffer.concat([epk, recipientPub]);
    return Buffer.from(hkdfSync('sha256', shared, salt, HKDF_INFO, KEY_LEN));
}

/**
 * Seal `plaintext` to `recipientPublicKeyB64` (a raw 32-byte X25519 key,
 * base64). `aad` is optional additional authenticated data — bind it to
 * something like the device id or op id so a captured box can't be replayed
 * against a different target. Returns an opaque box the relay cannot read.
 */
export function seal(
    recipientPublicKeyB64: string,
    plaintext: string | Buffer,
    aad?: Buffer,
): SealedBox {
    const recipientRaw = Buffer.from(recipientPublicKeyB64, 'base64');
    const recipient = publicKeyFromRaw(recipientRaw);

    const eph = generateKeyPairSync('x25519');
    const epk = rawPublicOf(eph.publicKey);
    const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: recipient });
    const key = deriveKey(shared, epk, recipientRaw);

    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    if (aad) cipher.setAAD(aad);
    const pt = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext;
    const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
        v: 1,
        epk: epk.toString('base64'),
        iv: iv.toString('base64'),
        ct: ct.toString('base64'),
        tag: tag.toString('base64'),
    };
}

/**
 * Open a sealed box with the recipient's private key. Throws if the box is
 * malformed, was sealed to a different key, or fails authentication (tampered
 * ciphertext / wrong AAD).
 */
export function open(recipientPrivateKey: KeyObject, box: SealedBox, aad?: Buffer): Buffer {
    if (!box || box.v !== 1 || !box.epk || !box.iv || !box.ct || !box.tag) {
        throw new Error('malformed sealed box');
    }
    const epk = Buffer.from(box.epk, 'base64');
    const shared = diffieHellman({
        privateKey: recipientPrivateKey,
        publicKey: publicKeyFromRaw(epk),
    });
    const recipientPub = rawPublicOf(createPublicKey(recipientPrivateKey));
    const key = deriveKey(shared, epk, recipientPub);

    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
    if (aad) decipher.setAAD(aad);
    decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(box.ct, 'base64')), decipher.final()]);
}

/** Convenience: seal a UTF-8 string and return the box as a compact JSON string. */
export function sealToString(recipientPublicKeyB64: string, plaintext: string, aad?: Buffer): string {
    return JSON.stringify(seal(recipientPublicKeyB64, plaintext, aad));
}
