// Autonomous memory learner — the brains behind the Memory skill.
//
// After a Sonoma exchange finishes, this runs big-pickle (OpenCode Zen) over
// the exchange in the background and extracts durable facts about the user
// (preferences, identity, ongoing projects), saving them to the UserMemory
// table with source 'auto'. No user confirmation — the skill toggle in
// Settings → Skills is the consent switch. Everything here is fire-and-forget:
// any failure is swallowed so learning can never break or slow down chat.

import { OPENCODE_ZEN_API_URL, OPENCODE_ZEN_API_KEY } from '@/lib/ai/llm';
import { listMemories, createMemory } from '@/lib/db/user-memory';

export const MEMORY_LEARNER_MODEL = process.env.MEMORY_LEARNER_MODEL || 'big-pickle';

const MAX_MEMORIES_PER_EXCHANGE = 3;
const MAX_STORED_MEMORIES = 200;
const MAX_INPUT_CHARS = 6_000;

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

/**
 * Extract and persist memories from one finished exchange. Resolves to the
 * number of memories saved; never throws.
 */
export async function learnFromExchange({ userId, userMessage, assistantMessage }: LearnInput): Promise<number> {
    try {
        if (!userId || !OPENCODE_ZEN_API_KEY || !userMessage.trim()) return 0;

        const existing = await listMemories(userId, 40);
        if (existing.length >= MAX_STORED_MEMORIES) return 0;
        const known = existing.map((m) => `- ${m.content}`).join('\n') || '(none yet)';

        const res = await fetch(OPENCODE_ZEN_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${OPENCODE_ZEN_API_KEY}`,
            },
            body: JSON.stringify({
                model: MEMORY_LEARNER_MODEL,
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

        // Cheap exact-duplicate guard on top of the prompt-level dedupe.
        const knownLower = new Set(existing.map((m) => m.content.trim().toLowerCase()));
        let saved = 0;
        for (const mem of extracted) {
            if (knownLower.has(mem.content.trim().toLowerCase())) continue;
            await createMemory({ userId, content: mem.content, tags: mem.tags, source: 'auto' });
            saved++;
        }
        return saved;
    } catch {
        return 0; // learning must never break chat
    }
}

export { parseExtraction as __parseExtractionForTests };
