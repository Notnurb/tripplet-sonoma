// Keyword search over a user's own past conversations — the data layer behind
// the Past Chats skill (`search_past_chats` in src/lib/sonoma/tools.ts).
//
// Message content and conversation titles are AES-encrypted at rest (see
// src/lib/chat/crypto.ts), so SQL ILIKE cannot see inside them. Same shape as
// searchMemories in ./user-memory: pull a bounded recent window, decrypt in
// process, and score here. The window is what keeps this cheap — a user with
// thousands of conversations still only ever decrypts the newest slice.

import { query } from './neon';
import { decryptText } from '@/lib/chat/crypto';

// How many recent conversations are eligible for a search.
const CONVERSATION_WINDOW = 60;
// Per-conversation message cap, newest-first, so one enormous thread cannot
// dominate the decrypt cost.
const MESSAGES_PER_CONVERSATION = 40;
const SNIPPET_CHARS = 320;
const MAX_SNIPPETS_PER_CONVERSATION = 3;

export interface PastChatMatch {
    conversationId: string;
    title: string;
    updatedAt: string;
    /** Matching excerpts, most relevant first. */
    snippets: { role: string; text: string }[];
}

interface RawRow {
    id: string;
    title: string | null;
    updatedAt: string;
    messages: { role: string; content: string; createdAt: string }[] | null;
}

const STOPWORDS = new Set([
    'a', 'an', 'and', 'about', 'are', 'as', 'at', 'be', 'did', 'do', 'for', 'from',
    'how', 'i', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'que', 'said', 'that',
    'the', 'to', 'was', 'we', 'what', 'when', 'where', 'which', 'who', 'why', 'with', 'you',
]);

function terms(queryText: string): string[] {
    return [
        ...new Set(
            queryText
                .toLowerCase()
                .replace(/[^a-z0-9\s]/g, ' ')
                .split(/\s+/)
                .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
        ),
    ];
}

function excerpt(text: string, needles: string[]): string {
    const lower = text.toLowerCase();
    let at = -1;
    for (const n of needles) {
        const i = lower.indexOf(n);
        if (i !== -1 && (at === -1 || i < at)) at = i;
    }
    if (at === -1) return text.slice(0, SNIPPET_CHARS);
    const start = Math.max(0, at - SNIPPET_CHARS / 4);
    const slice = text.slice(start, start + SNIPPET_CHARS);
    return (start > 0 ? '…' : '') + slice + (start + SNIPPET_CHARS < text.length ? '…' : '');
}

/**
 * Search the user's past conversations. An empty query returns the most recent
 * conversations with their opening exchange — "what were we working on?" is a
 * legitimate way to use this.
 *
 * Only ever reads rows owned by `userId`; deleted conversations are excluded.
 */
export async function searchPastConversations(
    userId: string,
    opts: { query?: string; limit?: number; excludeConversationId?: string } = {},
): Promise<PastChatMatch[]> {
    const limit = Math.min(Math.max(opts.limit ?? 5, 1), 10);
    const needles = terms(opts.query ?? '');

    const rows = await query<RawRow>(
        `SELECT c.id, c.title, c."updatedAt",
                COALESCE(
                    json_agg(
                        json_build_object('role', m.role, 'content', m.content, 'createdAt', m."createdAt")
                        ORDER BY m."createdAt"
                    ) FILTER (WHERE m.id IS NOT NULL),
                    '[]'
                ) AS messages
         FROM "Conversation" c
         LEFT JOIN "Message" m ON m."conversationId" = c.id
         WHERE c."userId" = $1
           AND c."deletedAt" IS NULL
           AND ($2::text IS NULL OR c.id <> $2)
         GROUP BY c.id
         ORDER BY c."updatedAt" DESC
         LIMIT $3`,
        [userId, opts.excludeConversationId ?? null, CONVERSATION_WINDOW],
    );

    const scored: { match: PastChatMatch; score: number }[] = [];

    for (const row of rows) {
        const title = decryptText(row.title ?? '') || 'Untitled chat';
        const messages = (Array.isArray(row.messages) ? row.messages : [])
            .slice(-MESSAGES_PER_CONVERSATION)
            .map((m) => ({ role: m.role, text: decryptText(m.content) }))
            .filter((m) => m.text.trim().length > 0);

        if (needles.length === 0) {
            // No query: recency ranking, showing how the conversation opened.
            scored.push({
                match: {
                    conversationId: row.id,
                    title,
                    updatedAt: row.updatedAt,
                    snippets: messages.slice(0, 2).map((m) => ({ role: m.role, text: excerpt(m.text, []) })),
                },
                score: 1,
            });
            continue;
        }

        const titleLower = title.toLowerCase();
        // A title hit is a strong signal — it is a summary of the whole thread.
        let score = needles.filter((n) => titleLower.includes(n)).length * 3;

        const hits: { role: string; text: string; hitCount: number }[] = [];
        for (const m of messages) {
            const lower = m.text.toLowerCase();
            const hitCount = needles.filter((n) => lower.includes(n)).length;
            if (hitCount > 0) {
                score += hitCount;
                hits.push({ role: m.role, text: m.text, hitCount });
            }
        }
        if (score === 0) continue;

        hits.sort((a, b) => b.hitCount - a.hitCount);
        scored.push({
            match: {
                conversationId: row.id,
                title,
                updatedAt: row.updatedAt,
                snippets: hits
                    .slice(0, MAX_SNIPPETS_PER_CONVERSATION)
                    .map((h) => ({ role: h.role, text: excerpt(h.text, needles) })),
            },
            score,
        });
    }

    return scored
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((s) => s.match);
}
