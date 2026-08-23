// Verification for signed requests from Tripplet Computer.
//
// The desktop app has no user API key. It generates an Ed25519 keypair on
// first run, registers the public half, and signs every request. This module
// is the other half of that: it authenticates a request to a known install,
// rejects replays, and hands the caller a record it can scope work to.
//
// ## Threat model — read before relying on this
//
// This authenticates an **install**, not a person, and it is abuse control
// rather than a trust boundary. The bootstrap secret that authorises a first
// registration is compiled into a binary that users hold, so anyone willing to
// disassemble it can register a install of their own. Treat a verified install
// as "probably our app, definitely this specific client" — enough to rate
// limit, meter, attribute and revoke, never enough to skip a real
// authorisation check on anything that matters.
//
// The upgrade path is Apple App Attest, which needs a Developer ID the desktop
// build does not have yet.

import crypto from 'crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { isDbConfigured, query, queryOne } from '@/lib/db/neon';

/** Requests dated further than this from now are refused. */
export const MAX_CLOCK_SKEW_SECONDS = 300;

/** DER prefix that turns a raw 32-byte Ed25519 key into an SPKI key. */
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export interface ComputerInstall {
    id: string;
    public_key: string;
    app_version: string;
    is_revoked: boolean;
    composio_user_id: string;
}

export type AttestResult = { install: ComputerInstall } | { response: NextResponse };

function deny(message: string, status = 401, code?: string): { response: NextResponse } {
    return {
        response: NextResponse.json({ error: { message, code } }, { status }),
    };
}

export function hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
}

export function bootstrapSecret(): string {
    return process.env.TRIPPLET_COMPUTER_BOOTSTRAP || '';
}

/**
 * The exact bytes the client signed. Must match `attest::canonical_string` in
 * the Rust app byte for byte — any divergence and every signature fails.
 */
export function canonicalString(
    method: string,
    path: string,
    timestamp: string,
    nonce: string,
    body: string,
): string {
    const bodyHash = crypto.createHash('sha256').update(body, 'utf8').digest('hex');
    return [method.toUpperCase(), path, timestamp, nonce, bodyHash].join('\n');
}

/** Constant-time compare that tolerates unequal lengths. */
export function safeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
}

/** Verify a raw base64 Ed25519 signature over `message`. */
export function verifySignature(publicKeyB64: string, message: string, signatureB64: string): boolean {
    try {
        const raw = Buffer.from(publicKeyB64, 'base64');
        if (raw.length !== 32) return false;
        const signature = Buffer.from(signatureB64, 'base64');
        if (signature.length !== 64) return false;

        const key = crypto.createPublicKey({
            key: Buffer.concat([SPKI_ED25519_PREFIX, raw]),
            format: 'der',
            type: 'spki',
        });
        // Ed25519 takes no separate digest — the algorithm argument is null.
        return crypto.verify(null, Buffer.from(message, 'utf8'), key, signature);
    } catch {
        return false;
    }
}

/**
 * Verify the HMAC proving a registration came from a Tripplet Computer build.
 *
 * With no `TRIPPLET_COMPUTER_BOOTSTRAP` configured this returns false for
 * everything: an unconfigured deployment must refuse registrations outright
 * rather than accept any client that turns up.
 */
export function verifyBootstrap(
    installId: string,
    publicKey: string,
    timestamp: number,
    proof: string,
): boolean {
    const secret = bootstrapSecret();
    if (!secret) return false;
    const expected = crypto
        .createHmac('sha256', secret)
        .update(`${installId}.${publicKey}.${timestamp}`)
        .digest('base64');
    return safeEqual(expected, proof);
}

export function withinSkew(timestamp: number, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
    if (!Number.isFinite(timestamp)) return false;
    return Math.abs(nowSeconds - timestamp) <= MAX_CLOCK_SKEW_SECONDS;
}

/**
 * Record a nonce, returning false if it has been seen before.
 *
 * Uniqueness is enforced by the primary key rather than a read-then-write, so
 * two concurrent replays cannot both pass the check.
 */
export async function claimNonce(nonce: string, installId: string): Promise<boolean> {
    try {
        const rows = await query<{ nonce: string }>(
            `insert into computer_nonces (nonce, install_id)
             values ($1, $2)
             on conflict (nonce) do nothing
             returning nonce`,
            [nonce, installId],
        );
        if (rows.length === 0) return false;
        // Opportunistic sweep; cheap because of the seen_at index.
        if (Math.random() < 0.02) {
            await query(
                `delete from computer_nonces where seen_at < now() - interval '1 hour'`,
                [],
            ).catch(() => {});
        }
        return true;
    } catch {
        // A nonce table that is unavailable must not silently disable replay
        // protection — fail closed.
        return false;
    }
}

/**
 * Authenticate a signed request from the desktop app.
 *
 * `rawBody` must be the exact string the route read, because the signature
 * covers its hash.
 */
export async function attestComputer(request: NextRequest, rawBody: string): Promise<AttestResult> {
    if (!isDbConfigured()) {
        return deny('Tripplet Computer is not available on this deployment.', 503);
    }

    const installId = request.headers.get('x-tripplet-install') || '';
    const token = request.headers.get('x-tripplet-token') || '';
    const timestampHeader = request.headers.get('x-tripplet-timestamp') || '';
    const nonce = request.headers.get('x-tripplet-nonce') || '';
    const signature = request.headers.get('x-tripplet-signature') || '';

    if (!installId || !token || !timestampHeader || !nonce || !signature) {
        return deny('Missing request signature.', 401, 'signature_missing');
    }
    if (nonce.length < 16 || nonce.length > 128) {
        return deny('Malformed nonce.', 401, 'signature_invalid');
    }

    const timestamp = Number(timestampHeader);
    if (!withinSkew(timestamp)) {
        return deny(
            'Request timestamp is outside the accepted window. Check this machine’s clock.',
            401,
            'timestamp_skew',
        );
    }

    let install: ComputerInstall | null;
    try {
        install = await queryOne<ComputerInstall>(
            `select id, public_key, app_version, is_revoked, composio_user_id
             from computer_installs where id = $1`,
            [installId],
        );
    } catch {
        return deny('Could not verify this install.', 503);
    }

    // An unknown install gets 401 so the client re-registers and recovers on
    // its own; a revoked one gets 403 so it does not loop trying.
    if (!install) return deny('Unknown install.', 401, 'install_unknown');
    if (install.is_revoked) return deny('This install has been revoked.', 403, 'install_revoked');

    const expectedToken = await queryOne<{ token_hash: string }>(
        `select token_hash from computer_installs where id = $1`,
        [installId],
    );
    if (!expectedToken || !safeEqual(expectedToken.token_hash, hashToken(token))) {
        return deny('Invalid install token.', 401, 'token_invalid');
    }

    const path = new URL(request.url).pathname;
    const message = canonicalString(request.method, path, timestampHeader, nonce, rawBody);
    if (!verifySignature(install.public_key, message, signature)) {
        return deny('Invalid request signature.', 401, 'signature_invalid');
    }

    // Signature is valid — only now is it worth spending a write on the nonce.
    if (!(await claimNonce(nonce, installId))) {
        return deny('Replayed request.', 401, 'nonce_replayed');
    }

    // Best-effort telemetry; never fail a good request over it.
    query(
        `update computer_installs
         set last_seen_at = now(), request_count = request_count + 1, app_version = $2
         where id = $1`,
        [installId, request.headers.get('x-tripplet-client') || install.app_version],
    ).catch(() => {});

    return { install };
}
