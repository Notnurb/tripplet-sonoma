// UserMemory persistence via the Neon (PostgreSQL) query layer.

import { query, isMissingTableError } from './neon';

export interface UserMemoryRow {
    id: string;
    userId: string;
    content: string;
    tags: string[];
    source: 'explicit' | 'auto';
    createdAt: string;
    updatedAt: string;
}

// SQL the user can paste into the Neon SQL Editor to create the table (and
// indices) on a brand-new database. Surfaced in error responses when the table
// is missing so the user doesn't have to hunt for it.
export const USER_MEMORY_CREATE_SQL = `-- Run this once in the Neon SQL Editor to enable Memory & Profile.
create table if not exists "UserMemory" (
  id          text primary key default gen_random_uuid()::text,
  "userId"    text not null,
  content     text not null,
  tags        text[] not null default '{}',
  source      text not null default 'explicit',
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create index if not exists "UserMemory_userId_idx" on "UserMemory" ("userId");
create index if not exists "UserMemory_userId_createdAt_idx" on "UserMemory" ("userId", "createdAt" desc);
`;

export class MissingTableError extends Error {
    constructor(public readonly tableName: string) {
        super(`Table "${tableName}" does not exist in the database`);
        this.name = 'MissingTableError';
    }
}

// Raised when the database rejects our credentials. Almost always means
// DATABASE_URL in .env is wrong, expired, or points at the wrong project.
export class InvalidKeyError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'InvalidKeyError';
    }
}

function isInvalidCredentials(error: unknown): boolean {
    const code = (error as { code?: string } | null)?.code;
    // 28P01 invalid_password, 28000 invalid_authorization_specification
    return code === '28P01' || code === '28000';
}

const SELECT_COLS =
    'id, "userId", content, tags, source, "createdAt", "updatedAt"';

async function run<T>(fn: () => Promise<T>): Promise<T> {
    try {
        return await fn();
    } catch (error) {
        if (isInvalidCredentials(error)) {
            throw new InvalidKeyError(
                error instanceof Error ? error.message : 'Database rejected the credentials',
            );
        }
        if (isMissingTableError(error)) throw new MissingTableError('UserMemory');
        throw error;
    }
}

export async function listMemories(userId: string, limit = 50): Promise<UserMemoryRow[]> {
    return run(() =>
        query<UserMemoryRow>(
            `SELECT ${SELECT_COLS} FROM "UserMemory"
             WHERE "userId" = $1
             ORDER BY "createdAt" DESC
             LIMIT $2`,
            [userId, limit],
        ),
    );
}

export async function searchMemories(userId: string, queryText: string, limit = 20): Promise<UserMemoryRow[]> {
    if (!queryText) return listMemories(userId, 10);
    const ilike = `%${queryText.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    return run(() =>
        query<UserMemoryRow>(
            `SELECT ${SELECT_COLS} FROM "UserMemory"
             WHERE "userId" = $1
               AND (content ILIKE $2 OR tags @> ARRAY[$3]::text[])
             ORDER BY "createdAt" DESC
             LIMIT $4`,
            [userId, ilike, queryText.toLowerCase(), limit],
        ),
    );
}

export async function createMemory(params: {
    userId: string;
    content: string;
    tags: string[];
    source: 'explicit' | 'auto';
}): Promise<UserMemoryRow> {
    const rows = await run(() =>
        query<UserMemoryRow>(
            `INSERT INTO "UserMemory" (id, "userId", content, tags, source)
             VALUES (gen_random_uuid()::text, $1, $2, $3, $4)
             RETURNING ${SELECT_COLS}`,
            [params.userId, params.content, params.tags, params.source],
        ),
    );
    if (rows.length === 0) throw new Error('Insert returned no row');
    return rows[0];
}

export async function updateMemory(params: {
    userId: string;
    id: string;
    content?: string;
    tags?: string[];
}): Promise<UserMemoryRow> {
    const sets: string[] = ['"updatedAt" = now()'];
    const values: unknown[] = [];
    if (params.content !== undefined) {
        values.push(params.content);
        sets.push(`content = $${values.length}`);
    }
    if (params.tags !== undefined) {
        values.push(params.tags);
        sets.push(`tags = $${values.length}`);
    }
    values.push(params.id);
    const idIdx = values.length;
    values.push(params.userId);
    const userIdx = values.length;

    const rows = await run(() =>
        query<UserMemoryRow>(
            `UPDATE "UserMemory" SET ${sets.join(', ')}
             WHERE id = $${idIdx} AND "userId" = $${userIdx}
             RETURNING ${SELECT_COLS}`,
            values,
        ),
    );
    if (rows.length === 0) throw new Error('Memory not found');
    return rows[0];
}

export async function deleteMemory(userId: string, id: string): Promise<boolean> {
    const rows = await run(() =>
        query<{ id: string }>(
            `DELETE FROM "UserMemory" WHERE id = $1 AND "userId" = $2 RETURNING id`,
            [id, userId],
        ),
    );
    return rows.length > 0;
}

export async function clearMemories(userId: string): Promise<number> {
    const rows = await run(() =>
        query<{ id: string }>(
            `DELETE FROM "UserMemory" WHERE "userId" = $1 RETURNING id`,
            [userId],
        ),
    );
    return rows.length;
}
