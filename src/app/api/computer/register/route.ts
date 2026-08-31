// Install registration for Tripplet Computer.
//
// The app posts its install id and public key once, proves it is a Tripplet
// Computer build with an HMAC over the bootstrap secret, and receives a bearer
// token it signs alongside from then on.
//
// Re-registration is deliberately allowed for the *same* public key: it is how
// an app recovers when its token is revoked or the install table is rebuilt. A
// different key for an existing id is refused, so an attacker who learns an
// install id cannot take it over.

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { isDbConfigured, query, queryOne } from '@/lib/db/neon';
import { bootstrapSecret, hashToken, verifyBootstrap, withinSkew } from '@/lib/computer/attest';
import { devKeyLimiter } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';

/** Registrations per IP per hour. Generous for real users, flat for scripts. */
const RATE_LIMIT = 20;

function bad(message: string, status: number, code?: string) {
    return NextResponse.json({ error: { message, code } }, { status });
}

function clientIp(request: NextRequest): string {
    return (
        request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        request.headers.get('x-real-ip') ||
        'unknown'
    );
}

export async function POST(request: NextRequest) {
    if (!isDbConfigured()) {
        return bad('Tripplet Computer is not available on this deployment.', 503);
    }
    if (!bootstrapSecret()) {
        // Refuse rather than accept anyone: an unconfigured deployment that
        // registered every caller would be an open inference endpoint.
        return bad('Install registration is not configured on this deployment.', 503);
    }

    try {
        await devKeyLimiter.check(RATE_LIMIT, `computer-register:${clientIp(request)}`);
    } catch {
        return bad('Too many registrations from this address.', 429);
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return bad('Invalid JSON body.', 400);

    const installId = typeof body.install_id === 'string' ? body.install_id : '';
    const publicKey = typeof body.public_key === 'string' ? body.public_key : '';
    const bootstrap = typeof body.bootstrap === 'string' ? body.bootstrap : '';
    const timestamp = Number(body.timestamp);
    const appVersion = typeof body.app_version === 'string' ? body.app_version.slice(0, 32) : '';
    const platform = typeof body.platform === 'string' ? body.platform.slice(0, 32) : '';

    if (!/^ci_[a-f0-9]{32}$/.test(installId)) return bad('Malformed install id.', 400);
    if (Buffer.from(publicKey, 'base64').length !== 32) return bad('Malformed public key.', 400);
    if (!withinSkew(timestamp)) {
        return bad('Registration timestamp is outside the accepted window.', 400, 'timestamp_skew');
    }
    if (!verifyBootstrap(installId, publicKey, timestamp, bootstrap)) {
        return bad('This client is not a recognised Tripplet Computer build.', 403, 'bootstrap_invalid');
    }

    const existing = await queryOne<{ public_key: string; is_revoked: boolean }>(
        `select public_key, is_revoked from computer_installs where id = $1`,
        [installId],
    );
    if (existing) {
        if (existing.is_revoked) return bad('This install has been revoked.', 403, 'install_revoked');
        // Same id, different key = someone else claiming this install.
        if (existing.public_key !== publicKey) {
            return bad('This install id is already registered to another key.', 409, 'install_conflict');
        }
    }

    const token = `tci_${crypto.randomBytes(32).toString('base64url')}`;
    await query(
        `insert into computer_installs
             (id, public_key, token_hash, app_version, platform, composio_user_id)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (id) do update
             set token_hash = excluded.token_hash,
                 app_version = excluded.app_version,
                 platform = excluded.platform,
                 last_seen_at = now()`,
        [
            installId,
            publicKey,
            hashToken(token),
            appVersion,
            platform,
            // Connector accounts are scoped to the install, and the id is
            // derived so a re-registration keeps the user's connected apps.
            `tc_${crypto.createHash('sha256').update(installId).digest('hex').slice(0, 24)}`,
        ],
    );

    return NextResponse.json({ token, install_id: installId });
}
