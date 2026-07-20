// UserMemory persistence via the Neon (PostgreSQL) query layer.
//
// Memory content is encrypted at rest with the same JWT_SECRET-derived
// AES-256-GCM key the conversation store uses (src/lib/chat/crypto.ts) —
// no extra env var, any deploy where auth works can encrypt. Encryption and
// decryption both live HERE so every caller (profile UI, import, chat,
// Sonoma, the memory learner) gets plaintext in and plaintext out; legacy
// unencrypted rows pass through reads untouched. Tags stay plaintext — they
// are short lowercase keywords used for filtering, not sentences about you.

import { query, isMissingTableError } from './neon';
import { encryptText, decryptText } from '@/lib/chat/crypto';

export interface UserMemoryRow {
    id: string;
    userId: string;
    content: string;
    tags: string[];
    source: 'explicit' | 'auto';
    createdAt: string;
    updatedAt: string;
}

// SQL the user can paste into the Neon SQL Editor to create OR repair the
// table. Surfaced in error responses when the table is missing so the user
// doesn't have to hunt for it. Safe to re-run. Kept to changes that match
// prisma/schema.prisma so scripts/check-migration-drift.mjs stays green.
export const USER_MEMORY_CREATE_SQL = `-- Run this once in the Neon SQL Editor to enable (or repair) Memory & Profile.
create table if not exists "UserMemory" (
  id          text primary key default gen_random_uuid()::text,
  "userId"    text not null,
  content     text not null,
  tags        text[] not null default '{}',
  source      text not null default 'explicit',
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

-- Repairs a Prisma-created table (Prisma leaves "updatedAt" with no DB
-- default, which 500s every raw-SQL insert from the deployed app).
alter table "UserMemory" alter column "updatedAt" set default now();

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

function decryptRow(row: UserMemoryRow): UserMemoryRow {
    return { ...row, content: decryptText(row.content) };
}

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
    const rows = await run(() =>
        query<UserMemoryRow>(
            `SELECT ${SELECT_COLS} FROM "UserMemory"
             WHERE "userId" = $1
             ORDER BY "createdAt" DESC
             LIMIT $2`,
            [userId, limit],
        ),
    );
    return rows.map(decryptRow);
}

export async function searchMemories(userId: string, queryText: string, limit = 20): Promise<UserMemoryRow[]> {
    if (!queryText) return listMemories(userId, 10);
    // Content is ciphertext in the database, so SQL ILIKE can't see it —
    // pull the user's recent memories, decrypt, and filter here. Memory
    // volume is capped (~200 rows), so this stays cheap.
    const rows = await listMemories(userId, 200);
    const q = queryText.toLowerCase();
    return rows
        .filter((r) =>
            r.content.toLowerCase().includes(q) ||
            (Array.isArray(r.tags) && r.tags.some((t) => t.toLowerCase() === q)),
        )
        .slice(0, limit);
}

export async function createMemory(params: {
    userId: string;
    content: string;
    tags: string[];
    source: 'explicit' | 'auto';
}): Promise<UserMemoryRow> {
    // createdAt/updatedAt are passed explicitly because the Prisma-created
    // table has no database-level default for "updatedAt" (@updatedAt is
    // filled client-side by Prisma, which this raw-SQL path bypasses).
    const rows = await run(() =>
        query<UserMemoryRow>(
            `INSERT INTO "UserMemory" (id, "userId", content, tags, source, "createdAt", "updatedAt")
             VALUES (gen_random_uuid()::text, $1, $2, $3, $4, now(), now())
             RETURNING ${SELECT_COLS}`,
            [params.userId, encryptText(params.content), params.tags, params.source],
        ),
    );
    if (rows.length === 0) throw new Error('Insert returned no row');
    return decryptRow(rows[0]);
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
        values.push(encryptText(params.content));
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
    return decryptRow(rows[0]);
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
