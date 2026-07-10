import crypto from 'crypto';
import { isDbConfigured, query, queryOne } from '@/lib/db/neon';
import { NextRequest, NextResponse } from 'next/server';

export interface DeveloperApiKeyRecord {
    id: string;
    user_email: string;
    key_prefix: string;
    is_revoked: boolean;
}

function hashKey(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
}

export async function authenticateDeveloperApiKey(
    request: NextRequest
): Promise<{ key: DeveloperApiKeyRecord } | { response: NextResponse }> {
    const header = request.headers.get('authorization') || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) {
        return {
            response: NextResponse.json(
                { error: 'Missing Authorization header. Use Bearer trpl_sk_...' },
                { status: 401 }
            ),
        };
    }

    const rawKey = match[1].trim();
    if (!rawKey.startsWith('trpl_sk_')) {
        return {
            response: NextResponse.json({ error: 'Invalid API key format.' }, { status: 401 }),
        };
    }

    if (!isDbConfigured()) {
        return {
            response: NextResponse.json({ error: 'Developer API is not configured.' }, { status: 503 }),
        };
    }

    let data: DeveloperApiKeyRecord | null;
    try {
        data = await queryOne<DeveloperApiKeyRecord>(
            `SELECT id, user_email, key_prefix, is_revoked
             FROM developer_api_keys
             WHERE key_hash = $1
             LIMIT 1`,
            [hashKey(rawKey)],
        );
    } catch {
        return {
            response: NextResponse.json({ error: 'Failed to validate API key.' }, { status: 500 }),
        };
    }

    if (!data) {
        return {
            response: NextResponse.json({ error: 'Invalid API key.' }, { status: 401 }),
        };
    }

    if (data.is_revoked) {
        return {
            response: NextResponse.json({ error: 'API key has been revoked.' }, { status: 403 }),
        };
    }

    await query(
        `UPDATE developer_api_keys SET last_used_at = now() WHERE id = $1`,
        [data.id],
    ).catch(() => { /* best-effort */ });

    return {
        key: data,
    };
}
