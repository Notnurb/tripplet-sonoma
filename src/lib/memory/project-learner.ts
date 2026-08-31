// Project memory learner — the project-scoped sibling of learner.ts.
//
// After a Sonoma exchange inside a project, this extracts facts that matter
// for THAT project (decisions, constraints, conventions, state of the work)
// and stores them in project_memories. Fire-and-forget: every failure is
// swallowed so it can never break or slow down chat.

import { extractMemories, isNearDuplicate } from './learner';
import {
    createProjectMemory,
    listProjectMemories,
    pruneProjectMemories,
    MAX_PROJECT_MEMORIES,
} from '@/lib/db/projects';

const PROJECT_EXTRACTION_PROMPT = `You extract durable facts about a PROJECT from one chat exchange.

A durable fact is something worth remembering the next time work continues on this project: decisions made, requirements, constraints, conventions, names of files/services/people involved, and the current state of the work. NOT: how the assistant phrased something, transient questions, or general facts about the user.

Rules:
- Return STRICT JSON: {"memories": [{"content": "...", "tags": ["..."]}]} and nothing else.
- 0 to 3 memories. Most exchanges contain ZERO — an empty list is the normal answer.
- Each content is one short sentence about the project, max 200 chars.
- 1-3 lowercase single-word tags each.
- Never repeat or rephrase a fact from the KNOWN list.
- Never store secrets, passwords, API keys, or payment details.`;

export interface ProjectLearnInput {
    projectId: string;
    userId: string;
    userMessage: string;
    assistantMessage: string;
}

/**
 * Extract and persist project memories from one finished exchange. Resolves
 * to the number saved; never throws.
 */
export async function learnProjectMemory({
    projectId,
    userId,
    userMessage,
    assistantMessage,
}: ProjectLearnInput): Promise<number> {
    try {
        if (!projectId || !userId || !userMessage.trim()) return 0;
        const existing = await listProjectMemories(projectId, MAX_PROJECT_MEMORIES);
        const extracted = await extractMemories({
            userMessage,
            assistantMessage,
            known: existing.map((m) => m.content),
            systemPrompt: PROJECT_EXTRACTION_PROMPT,
        });
        if (extracted.length === 0) return 0;

        const kept = existing.map((m) => m.content);
        const fresh = extracted.filter((mem) => {
            const content = mem.content.trim();
            if (!content) return false;
            if (kept.some((k) => k.trim().toLowerCase() === content.toLowerCase())) return false;
            if (kept.some((k) => isNearDuplicate(content, k))) return false;
            kept.push(content);
            return true;
        });
        if (fresh.length === 0) return 0;

        await pruneProjectMemories(projectId, fresh.length);

        let saved = 0;
        for (const mem of fresh) {
            await createProjectMemory({ projectId, userId, content: mem.content, source: 'auto' });
            saved++;
        }
        return saved;
    } catch {
        return 0; // learning must never break chat
    }
}
