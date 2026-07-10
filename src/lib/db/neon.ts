import { Pool, type QueryResultRow } from 'pg';

// Singleton Neon (PostgreSQL) connection pool, reused across hot reloads in dev.
// Neon speaks the standard Postgres wire protocol, so the `pg` driver connects
// to it directly using the DATABASE_URL connection string (the pooled endpoint).
const globalForPool = globalThis as unknown as { __neonPool?: Pool };

function createPool(): Pool {
    const connectionString = process.env.DATABASE_URL;
    const isLocal = !connectionString || /localhost|127\.0\.0\.1/.test(connectionString);
    return new Pool({
        connectionString,
        max: 10,
        // Neon requires TLS. Local Postgres typically does not.
        ssl: isLocal ? false : { rejectUnauthorized: true },
    });
}

export const pool = globalForPool.__neonPool ?? createPool();

if (process.env.NODE_ENV !== 'production') globalForPool.__neonPool = pool;

/** Returns true when a database connection string is configured. */
export function isDbConfigured(): boolean {
    return Boolean(process.env.DATABASE_URL);
}

/** Runs a parameterized query and returns the rows. */
export async function query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
): Promise<T[]> {
    const result = await pool.query<T>(text, params as unknown[]);
    return result.rows;
}

/** Runs a query and returns the first row, or null when there are none. */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
): Promise<T | null> {
    const rows = await query<T>(text, params);
    return rows[0] ?? null;
}

/** True when the error is Postgres "undefined_table" (42P01). */
export function isMissingTableError(error: unknown): boolean {
    const code = (error as { code?: string } | null)?.code;
    return code === '42P01';
}

/**
 * Runs `fn` inside a single Postgres transaction (BEGIN/COMMIT, ROLLBACK on
 * throw) using one checked-out client for every query `fn` issues.
 *
 * `query()`/`queryOne()` each grab a connection from the pool independently,
 * so two "related" writes issued back-to-back (even via Promise.all) are NOT
 * atomic — a unique-constraint failure on one does not undo a already-committed
 * write from the other. Use this whenever multiple writes must succeed or fail
 * together (e.g. upserting a parent row + inserting a child row keyed to it).
 */
export async function withTransaction<T>(
    fn: (client: { query: typeof query; queryOne: typeof queryOne }) => Promise<T>,
): Promise<T> {
    const client = await pool.connect();
    const txQuery = async <R extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<R[]> => {
        const result = await client.query<R>(text, params as unknown[]);
        return result.rows;
    };
    const txQueryOne = async <R extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []): Promise<R | null> => {
        const rows = await txQuery<R>(text, params);
        return rows[0] ?? null;
    };
    try {
        await client.query('BEGIN');
        const result = await fn({ query: txQuery as typeof query, queryOne: txQueryOne as typeof queryOne });
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK').catch(() => { /* connection may already be dead */ });
        throw err;
    } finally {
        client.release();
    }
}
