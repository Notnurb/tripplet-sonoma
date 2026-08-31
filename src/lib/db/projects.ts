// Projects — named workspaces that own their own chats and their own memory.
//
// Lives in raw SQL (db/schema.sql, `npm run setup:db`) rather than Prisma so
// the Prisma-owned "Conversation" table needs no migration: membership is a
// join table. Memory content is encrypted at rest with the same
// JWT_SECRET-derived key as UserMemory and the conversation store, and is
// decrypted here so callers only ever see plaintext.

import { query, queryOne, isMissingTableError } from './neon';
import { encryptText, decryptText } from '@/lib/chat/crypto';

export const MAX_PROJECT_NAME = 80;
export const MAX_PROJECT_DESCRIPTION = 500;
export const MAX_PROJECT_MEMORY_CHARS = 500;
// Cap per project, same spirit as the 200-row UserMemory cap: the oldest
// auto-learned rows roll out to make room for newer ones.
export const MAX_PROJECT_MEMORIES = 200;

export interface ProjectRow {
    id: string;
    userId: string;
    name: string;
    description: string;
    createdAt: string;
    updatedAt: string;
}

export interface ProjectMemoryRow {
    id: string;
    projectId: string;
    content: string;
    source: 'explicit' | 'auto';
    createdAt: string;
}

interface RawProject {
    id: string;
    user_id: string;
    name: string;
    description: string;
    created_at: string;
    updated_at: string;
}

interface RawMemory {
    id: string;
    project_id: string;
    content: string;
    source: 'explicit' | 'auto';
    created_at: string;
}

function toProject(r: RawProject): ProjectRow {
    return {
        id: r.id,
        userId: r.user_id,
        name: r.name,
        description: r.description,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}

function toMemory(r: RawMemory): ProjectMemoryRow {
    return {
        id: r.id,
        projectId: r.project_id,
        content: decryptText(r.content),
        source: r.source,
        createdAt: r.created_at,
    };
}

/** Raised when the projects tables haven't been created yet. */
export class ProjectsTableMissingError extends Error {
    constructor() {
        super('Projects tables are missing — run `npm run setup:db`.');
        this.name = 'ProjectsTableMissingError';
    }
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
    try {
        return await fn();
    } catch (error) {
        if (isMissingTableError(error)) throw new ProjectsTableMissingError();
        throw error;
    }
}

export async function listProjects(userId: string): Promise<ProjectRow[]> {
    const rows = await run(() =>
        query<RawProject>(
            `SELECT id, user_id, name, description, created_at, updated_at
               FROM projects WHERE user_id = $1 ORDER BY updated_at DESC`,
            [userId],
        ),
    );
    return rows.map(toProject);
}

export async function getProject(userId: string, id: string): Promise<ProjectRow | null> {
    const row = await run(() =>
        queryOne<RawProject>(
            `SELECT id, user_id, name, description, created_at, updated_at
               FROM projects WHERE id = $1 AND user_id = $2`,
            [id, userId],
        ),
    );
    return row ? toProject(row) : null;
}

export async function createProject(params: {
    userId: string;
    name: string;
    description?: string;
}): Promise<ProjectRow> {
    const row = await run(() =>
        queryOne<RawProject>(
            `INSERT INTO projects (user_id, name, description)
             VALUES ($1, $2, $3)
             RETURNING id, user_id, name, description, created_at, updated_at`,
            [
                params.userId,
                params.name.slice(0, MAX_PROJECT_NAME),
                (params.description ?? '').slice(0, MAX_PROJECT_DESCRIPTION),
            ],
        ),
    );
    if (!row) throw new Error('Insert returned no row');
    return toProject(row);
}

export async function updateProject(params: {
    userId: string;
    id: string;
    name?: string;
    description?: string;
}): Promise<ProjectRow | null> {
    const sets: string[] = ['updated_at = now()'];
    const values: unknown[] = [];
    if (params.name !== undefined) {
        values.push(params.name.slice(0, MAX_PROJECT_NAME));
        sets.push(`name = $${values.length}`);
    }
    if (params.description !== undefined) {
        values.push(params.description.slice(0, MAX_PROJECT_DESCRIPTION));
        sets.push(`description = $${values.length}`);
    }
    values.push(params.id);
    const idIdx = values.length;
    values.push(params.userId);

    const row = await run(() =>
        queryOne<RawProject>(
            `UPDATE projects SET ${sets.join(', ')}
              WHERE id = $${idIdx} AND user_id = $${values.length}
              RETURNING id, user_id, name, description, created_at, updated_at`,
            values,
        ),
    );
    return row ? toProject(row) : null;
}

export async function deleteProject(userId: string, id: string): Promise<boolean> {
    const rows = await run(() =>
        query<{ id: string }>(`DELETE FROM projects WHERE id = $1 AND user_id = $2 RETURNING id`, [
            id,
            userId,
        ]),
    );
    return rows.length > 0;
}

// ── Project memory ─────────────────────────────────────────────────────────

export async function listProjectMemories(
    projectId: string,
    limit = 50,
): Promise<ProjectMemoryRow[]> {
    const rows = await run(() =>
        query<RawMemory>(
            `SELECT id, project_id, content, source, created_at
               FROM project_memories WHERE project_id = $1
              ORDER BY created_at DESC LIMIT $2`,
            [projectId, limit],
        ),
    );
    return rows.map(toMemory);
}

export async function createProjectMemory(params: {
    projectId: string;
    userId: string;
    content: string;
    source: 'explicit' | 'auto';
}): Promise<ProjectMemoryRow> {
    const row = await run(() =>
        queryOne<RawMemory>(
            `INSERT INTO project_memories (project_id, user_id, content, source)
             VALUES ($1, $2, $3, $4)
             RETURNING id, project_id, content, source, created_at`,
            [
                params.projectId,
                params.userId,
                encryptText(params.content.slice(0, MAX_PROJECT_MEMORY_CHARS)),
                params.source,
            ],
        ),
    );
    if (!row) throw new Error('Insert returned no row');
    return toMemory(row);
}

export async function deleteProjectMemory(projectId: string, id: string): Promise<boolean> {
    const rows = await run(() =>
        query<{ id: string }>(
            `DELETE FROM project_memories WHERE id = $1 AND project_id = $2 RETURNING id`,
            [id, projectId],
        ),
    );
    return rows.length > 0;
}

/**
 * Drop the oldest auto-learned rows so `incoming` new ones fit under the cap.
 * Explicit (user-written) memories are never pruned.
 */
export async function pruneProjectMemories(projectId: string, incoming: number): Promise<void> {
    if (incoming <= 0) return;
    await run(() =>
        query(
            `DELETE FROM project_memories
              WHERE id IN (
                  SELECT id FROM project_memories
                   WHERE project_id = $1 AND source = 'auto'
                   ORDER BY created_at ASC
                   LIMIT GREATEST(
                       0,
                       (SELECT count(*) FROM project_memories WHERE project_id = $1) + $2 - $3
                   )
              )`,
            [projectId, incoming, MAX_PROJECT_MEMORIES],
        ),
    );
}

// ── Project ⇄ conversation membership ──────────────────────────────────────

export async function linkConversationToProject(params: {
    conversationId: string;
    projectId: string;
    userId: string;
}): Promise<void> {
    await run(() =>
        query(
            `INSERT INTO project_conversations (conversation_id, project_id, user_id)
             VALUES ($1, $2, $3)
             ON CONFLICT (conversation_id) DO UPDATE SET project_id = excluded.project_id`,
            [params.conversationId, params.projectId, params.userId],
        ),
    );
}

export async function listProjectConversationIds(projectId: string): Promise<string[]> {
    const rows = await run(() =>
        query<{ conversation_id: string }>(
            `SELECT conversation_id FROM project_conversations
              WHERE project_id = $1 ORDER BY created_at DESC`,
            [projectId],
        ),
    );
    return rows.map((r) => r.conversation_id);
}
