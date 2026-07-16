import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression test for a real gap: refresh-token rotation revoked the row
 * being rotated, but replaying an ALREADY-rotated (revoked) refresh token
 * just failed quietly — the standard signal that the token was stolen (the
 * legitimate client already moved past it) went unused. rotateRefreshToken
 * now detects that reuse and revokes the whole rotation family (family_id),
 * not just the one replayed row, forcing re-authentication instead of
 * leaving the attacker's still-valid descendant tokens alone.
 */

interface Row {
    user_email: string;
    scope: string;
    resource: string | null;
    is_revoked: boolean;
    refresh_expires_at: string;
    family_id: string | null;
    token_hash: string;
}

const db = {
    rows: new Map<string, Row>(), // keyed by refresh_token_hash
    updateCalls: [] as Array<{ sql: string; params?: unknown[] }>,
};

vi.mock('@/lib/db/neon', () => ({
    query: vi.fn(async (sql: string, params?: unknown[]) => {
        db.updateCalls.push({ sql, params });
        if (/UPDATE oauth_access_tokens SET is_revoked = true WHERE refresh_token_hash/.test(sql)) {
            const hash = params![0] as string;
            const row = db.rows.get(hash);
            if (row) row.is_revoked = true;
        }
        if (/UPDATE oauth_access_tokens SET is_revoked = true WHERE family_id/.test(sql)) {
            const familyId = params![0] as string;
            for (const row of db.rows.values()) {
                if (row.family_id === familyId) row.is_revoked = true;
            }
        }
        return { rows: [] };
    }),
    queryOne: vi.fn(async (sql: string, params?: unknown[]) => {
        if (/FROM oauth_access_tokens/.test(sql) && /refresh_token_hash = \$1/.test(sql)) {
            const hash = params![0] as string;
            return db.rows.get(hash) ?? null;
        }
        return null;
    }),
}));

import { rotateRefreshToken, sha256 } from '@/lib/mcp/oauth';

const CLIENT_ID = 'mcp_client_1';

beforeEach(() => {
    db.rows.clear();
    db.updateCalls.length = 0;
});

function seedRow(refreshToken: string, overrides: Partial<Row> = {}): void {
    const hash = sha256(refreshToken);
    db.rows.set(hash, {
        user_email: 'u@x.com',
        scope: 'mcp',
        resource: null,
        is_revoked: false,
        refresh_expires_at: new Date(Date.now() + 60_000).toISOString(),
        family_id: hash,
        token_hash: `access-${hash}`,
        ...overrides,
    });
}

describe('rotateRefreshToken', () => {
    it('rotates a valid, unrevoked token into a fresh pair carrying the same family_id', async () => {
        seedRow('rt-1');
        const result = await rotateRefreshToken('rt-1', CLIENT_ID);
        expect(result).not.toBeNull();
        expect(result!.refresh_token).toBeTruthy();
        expect(result!.refresh_token).not.toBe('rt-1');
    });

    it('detects REUSE of an already-rotated (revoked) refresh token and revokes the whole family', async () => {
        const familyId = 'family-root-hash';
        seedRow('rt-legit', { is_revoked: true, family_id: familyId, token_hash: familyId });
        // A sibling token still in the same family, currently NOT revoked —
        // simulating the attacker's still-live descendant from an earlier
        // successful (illegitimate) rotation.
        seedRow('rt-attacker-descendant', { is_revoked: false, family_id: familyId, token_hash: `access-${sha256('rt-attacker-descendant')}` });

        const result = await rotateRefreshToken('rt-legit', CLIENT_ID);
        expect(result).toBeNull(); // reuse is rejected, not silently rotated

        // The entire family — including the attacker's still-live sibling —
        // is now revoked, not just the replayed row.
        expect(db.rows.get(sha256('rt-attacker-descendant'))!.is_revoked).toBe(true);
    });

    it('returns null for an unknown refresh token (nothing to rotate or revoke)', async () => {
        const result = await rotateRefreshToken('never-issued', CLIENT_ID);
        expect(result).toBeNull();
    });

    it('returns null for an expired-but-unrevoked refresh token', async () => {
        seedRow('rt-expired', { refresh_expires_at: new Date(Date.now() - 1000).toISOString() });
        const result = await rotateRefreshToken('rt-expired', CLIENT_ID);
        expect(result).toBeNull();
    });
});
