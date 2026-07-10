// withTransaction: the atomicity primitive added to close the chat-route IDOR
// (see chat-route-idor.test.ts). Verifies BEGIN/COMMIT on success, ROLLBACK on
// throw, and that the client is always released back to the pool.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { client, connect, poolQuery } = vi.hoisted(() => {
    const client = {
        query: vi.fn(),
        release: vi.fn(),
    };
    const connect = vi.fn(async () => client);
    const poolQuery = vi.fn();
    return { client, connect, poolQuery };
});

vi.mock('pg', () => {
    class Pool {
        connect = connect;
        query = poolQuery;
    }
    return { Pool };
});

import { withTransaction, query, queryOne, isDbConfigured, isMissingTableError } from '@/lib/db/neon';

beforeEach(() => {
    client.query.mockReset().mockResolvedValue({ rows: [] });
    client.release.mockReset();
    connect.mockClear();
});

describe('withTransaction', () => {
    it('BEGINs, runs fn, COMMITs, and releases the client on success', async () => {
        const result = await withTransaction(async (tx) => {
            await tx.query('INSERT INTO x VALUES ($1)', ['a']);
            return 'ok';
        });
        expect(result).toBe('ok');
        const calls = client.query.mock.calls.map((c) => c[0]);
        expect(calls[0]).toBe('BEGIN');
        expect(calls[calls.length - 1]).toBe('COMMIT');
        expect(calls).not.toContain('ROLLBACK');
        expect(client.release).toHaveBeenCalledTimes(1);
    });

    it('ROLLBACKs and re-throws when fn throws, and still releases the client', async () => {
        await expect(withTransaction(async (tx) => {
            await tx.query('INSERT INTO x VALUES ($1)', ['a']);
            throw new Error('boom');
        })).rejects.toThrow('boom');

        const calls = client.query.mock.calls.map((c) => c[0]);
        expect(calls).toContain('ROLLBACK');
        expect(calls).not.toContain('COMMIT');
        expect(client.release).toHaveBeenCalledTimes(1);
    });

    it('releases the client even if ROLLBACK itself fails', async () => {
        client.query.mockImplementation(async (text: string) => {
            if (text === 'ROLLBACK') throw new Error('connection already closed');
            return { rows: [] };
        });
        await expect(withTransaction(async () => {
            throw new Error('original failure');
        })).rejects.toThrow('original failure');
        expect(client.release).toHaveBeenCalledTimes(1);
    });

    it('uses the SAME checked-out client for every query issued by fn (real atomicity)', async () => {
        await withTransaction(async (tx) => {
            await tx.query('SELECT 1');
            await tx.query('SELECT 2');
        });
        // connect() called exactly once — both queries went through the one
        // client, not two independent pool.query() calls (which would NOT be
        // transactionally linked).
        expect(connect).toHaveBeenCalledTimes(1);
    });
});

describe('query / queryOne (outside a transaction)', () => {
    beforeEach(() => {
        poolQuery.mockReset();
    });

    it('query() runs against the pool directly and returns rows', async () => {
        poolQuery.mockResolvedValue({ rows: [{ id: 1 }, { id: 2 }] });
        const rows = await query('SELECT * FROM x');
        expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
        expect(poolQuery).toHaveBeenCalledWith('SELECT * FROM x', []);
    });

    it('queryOne() returns the first row, or null when there are none', async () => {
        poolQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });
        expect(await queryOne('SELECT 1')).toEqual({ id: 1 });
        poolQuery.mockResolvedValueOnce({ rows: [] });
        expect(await queryOne('SELECT 1')).toBeNull();
    });
});

describe('isDbConfigured / isMissingTableError', () => {
    it('isDbConfigured reflects DATABASE_URL presence', () => {
        vi.stubEnv('DATABASE_URL', 'postgresql://u:p@h/db');
        expect(isDbConfigured()).toBe(true);
        vi.stubEnv('DATABASE_URL', '');
        expect(isDbConfigured()).toBe(false);
        vi.unstubAllEnvs();
    });

    it('isMissingTableError recognizes Postgres 42P01 and rejects everything else', () => {
        expect(isMissingTableError({ code: '42P01' })).toBe(true);
        expect(isMissingTableError({ code: '23505' })).toBe(false);
        expect(isMissingTableError(new Error('plain error'))).toBe(false);
        expect(isMissingTableError(null)).toBe(false);
    });
});
