import { NextRequest, NextResponse } from 'next/server';
import { isDbConfigured, query } from '@/lib/db/neon';
import { auth } from '@/lib/auth/session';
import crypto from 'crypto';
import { devKeyLimiter, LIMITS, rateLimitResponse, getRateLimitToken } from '@/lib/security/rate-limit';

function hashKey(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
}

function generateKey(): string {
    return 'trpl_sk_' + crypto.randomBytes(20).toString('hex');
}

async function getAuthenticatedEmail(req: NextRequest): Promise<{ email: string } | NextResponse> {
    const { userId, email } = await auth();
    if (!userId) {
        return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }

    const token = getRateLimitToken(req, userId);
    try {
        await devKeyLimiter.check(LIMITS.devKey, token);
    } catch {
        return rateLimitResponse();
    }

    if (!email) {
        return NextResponse.json({ error: 'User email not found.' }, { status: 400 });
    }

    return { email };
}

// ── GET: List keys for authenticated user ──────────────────────────────────

export async function GET(req: NextRequest) {
    const result = await getAuthenticatedEmail(req);
    if (result instanceof NextResponse) return result;
    const { email } = result;

    if (!isDbConfigured()) return NextResponse.json({ error: 'Not configured.' }, { status: 503 });

    try {
        const data = await query(
            `SELECT id, key_prefix, name, created_at, last_used_at, is_revoked
             FROM developer_api_keys
             WHERE user_email = $1
             ORDER BY created_at DESC`,
            [email],
        );
        return NextResponse.json({ keys: data });
    } catch {
        return NextResponse.json({ error: 'Failed to fetch keys.' }, { status: 500 });
    }
}

// ── POST: Create a new key ───────────────────────────────────────────────────

export async function POST(req: NextRequest) {
    const result = await getAuthenticatedEmail(req);
    if (result instanceof NextResponse) return result;
    const { email } = result;

    let name = 'Default';
    try {
        const body = await req.json() as { name?: string };
        name = body.name?.trim() || 'Default';
    } catch {
        // Use default name
    }

    if (!isDbConfigured()) return NextResponse.json({ error: 'Not configured.' }, { status: 503 });

    try {
        const countRows = await query<{ count: string }>(
            `SELECT COUNT(*)::int AS count FROM developer_api_keys
             WHERE user_email = $1 AND is_revoked = false`,
            [email],
        );
        if (Number(countRows[0]?.count ?? 0) >= 5) {
            return NextResponse.json({ error: 'Maximum 5 active keys. Revoke one first.' }, { status: 400 });
        }

        const raw = generateKey();
        const hash = hashKey(raw);
        const prefix = raw.slice(0, 12) + '...' + raw.slice(-4);

        const rows = await query<Record<string, unknown>>(
            `INSERT INTO developer_api_keys (user_email, key_hash, key_prefix, name)
             VALUES ($1, $2, $3, $4)
             RETURNING id, key_prefix, name, created_at`,
            [email, hash, prefix, name],
        );

        return NextResponse.json({ key: raw, ...rows[0] });
    } catch {
        return NextResponse.json({ error: 'Failed to create key.' }, { status: 500 });
    }
}

// ── DELETE: Revoke a key ─────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
    const result = await getAuthenticatedEmail(req);
    if (result instanceof NextResponse) return result;
    const { email } = result;

    let keyId: string;
    try {
        const body = await req.json() as { id?: string };
        keyId = body.id?.trim() ?? '';
        if (!keyId) throw new Error();
    } catch {
        return NextResponse.json({ error: 'Key ID required.' }, { status: 400 });
    }

    if (!isDbConfigured()) return NextResponse.json({ error: 'Not configured.' }, { status: 503 });

    try {
        // user_email match ensures a user can only revoke their own keys
        await query(
            `UPDATE developer_api_keys SET is_revoked = true WHERE id = $1 AND user_email = $2`,
            [keyId, email],
        );
        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: 'Failed to revoke key.' }, { status: 500 });
    }
}
