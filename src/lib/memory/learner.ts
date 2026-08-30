// Autonomous memory learner — the brains behind the Memory skill.
//
// After a Sonoma exchange finishes, this runs big-pickle (OpenCode Zen) over
// the exchange in the background and extracts durable facts about the user
// (preferences, identity, ongoing projects), saving them to the UserMemory
// table with source 'auto'. No user confirmation — the skill toggle in
// Settings → Skills is the consent switch. Everything here is fire-and-forget:
// any failure is swallowed so learning can never break or slow down chat.

import { OPENCODE_ZEN_API_URL, OPENCODE_ZEN_API_KEY, resolveBackend } from '@/lib/ai/llm';
import { listMemories, createMemory, deleteMemory, type UserMemoryRow } from '@/lib/db/user-memory';

export const MEMORY_LEARNER_MODEL = process.env.MEMORY_LEARNER_MODEL || 'big-pickle';

const MAX_MEMORIES_PER_EXCHANGE = 3;
const MAX_STORED_MEMORIES = 200;
const MAX_INPUT_CHARS = 6_000;
// How many known memories go into the extraction prompt. Deduping looks at
// every stored memory (cheap, in-process); the prompt only gets the most
// recent slice so the token cost stays flat as the profile grows.
const MAX_KNOWN_IN_PROMPT = 60;

const EXTRACTION_SYSTEM_PROMPT = `You extract durable facts about a user from one chat exchange.

A durable fact is something worth remembering in FUTURE conversations: their name, role, expertise level, preferences (tone, language, tools), ongoing projects, goals, or constraints. NOT: the topic of this one question, transient tasks, or anything the assistant said.

Rules:
- Return STRICT JSON: {"memories": [{"content": "...", "tags": ["..."]}]} and nothing else.
- 0 to ${MAX_MEMORIES_PER_EXCHANGE} memories. Most exchanges contain ZERO — an empty list is the normal answer.
- Each content is one short third-person sentence ("Prefers TypeScript over JavaScript"), max 200 chars.
- 1-3 lowercase single-word tags each.
- Never repeat or rephrase a fact from the KNOWN list.
- Never store secrets, passwords, API keys, or payment details.`;

export interface LearnInput {
    userId: string;
    userMessage: string;
    assistantMessage: string;
}

interface ExtractedMemory {
    content: string;
    tags: string[];
}

function parseExtraction(raw: string): ExtractedMemory[] {
    try {
        // Tolerate models that wrap JSON in a fence.
        const jsonText = raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
        const parsed = JSON.parse(jsonText) as { memories?: unknown };
        if (!Array.isArray(parsed.memories)) return [];
        return parsed.memories
            .filter((m): m is { content: string; tags?: unknown } =>
                typeof m === 'object' && m !== null && typeof (m as { content?: unknown }).content === 'string')
            .map((m) => ({
                content: m.content.trim().slice(0, 300),
                tags: Array.isArray(m.tags)
                    ? m.tags.filter((t): t is string => typeof t === 'string').map((t) => t.toLowerCase().slice(0, 32)).slice(0, 3)
                    : [],
            }))
            .filter((m) => m.content.length > 0)
            .slice(0, MAX_MEMORIES_PER_EXCHANGE);
    } catch {
        return [];
    }
}

// Stopwords that carry no identifying signal — dropped before comparing two
// memories so "User prefers TypeScript" and "Prefers TypeScript over JS"
// register as the same fact rather than two.
const STOPWORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'has', 'have',
    'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'their', 'they', 'this',
    'to', 'user', 'users', 'was', 'were', 'with',
]);

function significantTokens(text: string): Set<string> {
    return new Set(
        text
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
    );
}

/**
 * True when `candidate` says substantially the same thing as `existing`.
 * Jaccard-style overlap on significant tokens: ≥70% of the shorter fact's
 * meaningful words appearing in the other means it is a rephrasing, not news.
 */
export function isNearDuplicate(candidate: string, existing: string): boolean {
    const a = significantTokens(candidate);
    const b = significantTokens(existing);
    if (a.size === 0 || b.size === 0) return false;
    let shared = 0;
    for (const t of a) if (b.has(t)) shared++;
    return shared / Math.min(a.size, b.size) >= 0.7;
}

/**
 * Free room for `needed` new memories once the cap is reached by deleting the
 * OLDEST auto-learned rows. Explicit memories (typed by the user or imported)
 * are never evicted — only the profile the learner built itself rolls over.
 * Returns the rows that remain.
 */
async function pruneForRoom(
    userId: string,
    existing: UserMemoryRow[],
    needed: number,
): Promise<UserMemoryRow[]> {
    const overBy = existing.length + needed - MAX_STORED_MEMORIES;
    if (overBy <= 0) return existing;

    // listMemories returns newest-first, so the tail is the oldest.
    const evictable = existing.filter((m) => m.source === 'auto').slice(-overBy);
    if (evictable.length === 0) return existing; // all explicit — leave them alone
    const evicted = new Set<string>();
    for (const row of evictable) {
        if (await deleteMemory(userId, row.id)) evicted.add(row.id);
    }
    return existing.filter((m) => !evicted.has(m.id));
}

// Where the extraction call goes. Prefers the dedicated OpenCode Zen learner
// model; falls back to the default inference backend so memory keeps learning
// on deploys that only have a Groq key configured. Null when nothing is set up.
function learnerTarget(): { url: string; apiKey: string; model: string } | null {
    if (OPENCODE_ZEN_API_KEY) {
        return { url: OPENCODE_ZEN_API_URL, apiKey: OPENCODE_ZEN_API_KEY, model: MEMORY_LEARNER_MODEL };
    }
    const fallback = resolveBackend(undefined);
    if (!fallback.apiKey) return null;
    return { url: fallback.url, apiKey: fallback.apiKey, model: fallback.model };
}

/**
 * Run the extraction model over one exchange and return the candidate
 * memories. Shared by the account-wide learner below and the project learner
 * (src/lib/memory/project-learner.ts). Never throws — returns [] on any
 * failure, so learning can't break chat.
 */
export async function extractMemories(params: {
    userMessage: string;
    assistantMessage: string;
    known: string[];
    systemPrompt?: string;
}): Promise<ExtractedMemory[]> {
    try {
        const target = learnerTarget();
        if (!target || !params.userMessage.trim()) return [];
        const known =
            params.known.slice(0, MAX_KNOWN_IN_PROMPT).map((c) => `- ${c}`).join('\n') || '(none yet)';

        const res = await fetch(target.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${target.apiKey}`,
            },
            body: JSON.stringify({
                model: target.model,
                stream: false,
                temperature: 0.1,
                max_tokens: 300,
                messages: [
                    { role: 'system', content: params.systemPrompt ?? EXTRACTION_SYSTEM_PROMPT },
                    {
                        role: 'user',
                        content:
                            `KNOWN memories:\n${known}\n\n` +
                            `USER said:\n${params.userMessage.slice(0, MAX_INPUT_CHARS)}\n\n` +
                            `ASSISTANT replied:\n${params.assistantMessage.slice(0, MAX_INPUT_CHARS)}`,
                    },
                ],
            }),
            signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) return [];
        const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        return parseExtraction(json.choices?.[0]?.message?.content ?? '');
    } catch {
        return [];
    }
}

/**
 * Extract and persist memories from one finished exchange. Resolves to the
 * number of memories saved; never throws.
 */
export async function learnFromExchange({ userId, userMessage, assistantMessage }: LearnInput): Promise<number> {
    try {
        const target = learnerTarget();
        if (!userId || !target || !userMessage.trim()) return 0;

        // Full set for deduping; only the recent slice goes into the prompt.
        const existing = await listMemories(userId, MAX_STORED_MEMORIES);
        const known =
            existing.slice(0, MAX_KNOWN_IN_PROMPT).map((m) => `- ${m.content}`).join('\n') || '(none yet)';

        const res = await fetch(target.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${target.apiKey}`,
            },
            body: JSON.stringify({
                model: target.model,
                stream: false,
                temperature: 0.1,
                max_tokens: 300,
                messages: [
                    { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
                    {
                        role: 'user',
                        content:
                            `KNOWN memories:\n${known}\n\n` +
                            `USER said:\n${userMessage.slice(0, MAX_INPUT_CHARS)}\n\n` +
                            `ASSISTANT replied:\n${assistantMessage.slice(0, MAX_INPUT_CHARS)}`,
                    },
                ],
            }),
            signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) return 0;

        const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const extracted = parseExtraction(json.choices?.[0]?.message?.content ?? '');
        if (extracted.length === 0) return 0;

        // Duplicate guards on top of the prompt-level dedupe: exact match first
        // (cheap), then a rephrasing check against every stored memory.
        const kept: string[] = existing.map((m) => m.content);
        const fresh = extracted.filter((mem) => {
            const content = mem.content.trim();
            if (!content) return false;
            if (kept.some((k) => k.trim().toLowerCase() === content.toLowerCase())) return false;
            if (kept.some((k) => isNearDuplicate(content, k))) return false;
            kept.push(content); // also dedupe within this batch
            return true;
        });
        if (fresh.length === 0) return 0;

        // Make room rather than stopping forever at the cap — memory should
        // keep learning for the life of the account, rolling the oldest
        // auto-learned facts out as newer ones arrive.
        await pruneForRoom(userId, existing, fresh.length);

        let saved = 0;
        for (const mem of fresh) {
            await createMemory({ userId, content: mem.content, tags: mem.tags, source: 'auto' });
            saved++;
        }
        return saved;
    } catch {
        return 0; // learning must never break chat
    }
}

export { parseExtraction as __parseExtractionForTests };
