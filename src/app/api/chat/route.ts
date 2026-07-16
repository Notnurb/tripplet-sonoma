import { NextRequest } from 'next/server';
import { streamChatEvents, ChatMessage as ProviderChatMessage, ChatToolCall } from '@/lib/ai/chat-client';
import { getSystemPrompt } from '@/lib/ai/system-prompt';
import { resolveSettings } from '@/lib/ai/modes';
import { ChatMode, ToneType, CodeExecution } from '@/types';
import { auth } from '@/lib/auth/session';
import { query, queryOne, withTransaction } from "@/lib/db/neon";
import {
    InvalidKeyError,
    MissingTableError,
    createMemory,
    deleteMemory,
    updateMemory,
    type UserMemoryRow,
} from '@/lib/db/user-memory';
import { detectSkillsFromMessage } from '@/lib/ai/modes';
import { getFeedbackSignals } from '@/lib/ai/feedback-signals';
import { LRUCache } from 'lru-cache';
import { chatLimiter, LIMITS, rateLimitResponse, getRateLimitToken } from '@/lib/security/rate-limit';
import { serializeMessageMetadata } from '@/lib/chat/message-metadata';
import { parseBody, chatSchema } from '@/lib/validation';
// The tool schemas, run_code execution streamer, memory block/mirroring, and
// web-search injection live in src/lib/chat/* — this file holds request flow.
import { RUN_CODE_TOOL, REMEMBER_TOOL, FORGET_TOOL, UPDATE_TOOL, buildCodeExecutionToolInstructions } from '@/lib/chat/tools';
import { executeRunCodeTool } from '@/lib/chat/execution';
import { getMemoryRows, buildMemoryBlock, storeMemory } from '@/lib/chat/memory';
import { fetchWebSearchResults } from '@/lib/chat/search';

export const runtime = 'nodejs';
// Allow long streaming responses (extended thinking / deep research) — without
// this, serverless platforms kill the function at their short default timeout.
export const maxDuration = 300;

const MAX_TOOL_ROUNDS = 3;

const guestMessageCache = new LRUCache<string, number>({
    max: 50000,
    ttl: 24 * 60 * 60 * 1000,
});


export async function POST(request: NextRequest) {
    try {
        const { userId } = await auth();
        const token = getRateLimitToken(request, userId);

        try {
            await chatLimiter.check(LIMITS.chat, token);
        } catch {
            return rateLimitResponse();
        }

        const { data: body, error: validationError } = await parseBody(request, chatSchema);
        if (validationError) return validationError;

        const {
            messages,
            model,
            extendedThinking,
            tone,
            activeModes,
            activeTone,
            anura,
            imageDescription,
            conversationId,
            isHivemind,
            systemPromptOverride,
            autoSkillSetting,
        } = body;

        // Unauthenticated access control
        if (!userId) {
            if (model !== 'suzhou-3') {
                return new Response(
                    JSON.stringify({ error: 'Login required to use this model. Only Suzhou 4 is available for guests.' }),
                    { status: 403, headers: { 'Content-Type': 'application/json' } }
                );
            }

            // Server-side guest message cap — we track per-IP in an LRU cache rather
            // than trusting the client-supplied message history length (which is trivially
            // bypassed by sending a truncated array). Each POST carries the full history,
            // so we can't just count messages. Instead we increment on each unique request
            // so a guest sending 1 message = +1, regardless of what they send in the body.
            const GUEST_MESSAGE_LIMIT = 15;
            const guestKey = `guest:${token}`;
            const currentCount = guestMessageCache.get(guestKey) || 0;
            if (currentCount >= GUEST_MESSAGE_LIMIT) {
                // `code` lets the client tell "you hit the free limit" apart from a
                // real failure and render a sign-up path instead of an error state.
                return new Response(
                    JSON.stringify({
                        error: "You've used all 15 free messages — create a free account (it takes a few seconds) to keep going right where you left off.",
                        code: 'guest_limit',
                    }),
                    { status: 403, headers: { 'Content-Type': 'application/json' } }
                );
            }
            guestMessageCache.set(guestKey, currentCount + 1);
        }

        if (userId && conversationId) {
            // Ownership check: look up the conversation scoped to this userId so that
            // a logged-in user cannot write messages into another user's conversation
            // (IDOR). `queryOne` here returning null is ambiguous — the id may not
            // exist at all (create it), OR it may belong to a DIFFERENT user (reject
            // it) — those two cases previously collapsed into the same "insert" branch,
            // which relied on a PRIMARY KEY collision to fail closed. That's not safe:
            // the conversation-upsert and message-insert below used to run as two
            // INDEPENDENT autocommitted statements (Promise.all provides no shared
            // transaction), so a colliding conversationId could make the conversation
            // insert reject on the unique-key violation while the message insert still
            // committed — silently injecting an attacker-authored message into another
            // user's conversation even though the request as a whole errored out.
            // Fixed by (1) explicitly distinguishing "doesn't exist" from "exists,
            // owned by someone else" and refusing to write in the latter case, and
            // (2) wrapping both writes in one real DB transaction so a partial failure
            // can never leave one write committed without the other.
            const owned = await queryOne<{ id: string }>(
                `SELECT id FROM "Conversation" WHERE id = $1 AND "userId" = $2 LIMIT 1`,
                [conversationId, userId],
            );

            if (!owned) {
                const existsForAnyone = await queryOne<{ id: string }>(
                    `SELECT id FROM "Conversation" WHERE id = $1 LIMIT 1`,
                    [conversationId],
                );
                if (existsForAnyone) {
                    return new Response(
                        JSON.stringify({ error: 'This conversation does not belong to you.' }),
                        { status: 403, headers: { 'Content-Type': 'application/json' } }
                    );
                }
            }

            const lastUserMsg = messages?.[messages.length - 1];

            await withTransaction(async (tx) => {
                if (!owned) {
                    await tx.query(
                        `INSERT INTO "Conversation" (id, "userId", title, model, "createdAt", "updatedAt")
                         VALUES ($1, $2, $3, $4, now(), now())`,
                        [
                            conversationId,
                            userId,
                            messages?.[messages.length - 1]?.content.slice(0, 30) || 'New Chat',
                            model || 'tura-3',
                        ],
                    );
                } else {
                    await tx.query(
                        `UPDATE "Conversation" SET "updatedAt" = now() WHERE id = $1 AND "userId" = $2`,
                        [conversationId, userId],
                    );
                }

                if (lastUserMsg && lastUserMsg.role === 'user') {
                    await tx.query(
                        `INSERT INTO "Message" (id, "conversationId", role, content, tone, "extendedThink", "createdAt")
                         VALUES (gen_random_uuid()::text, $1, 'user', $2, $3, $4, now())`,
                        [conversationId, lastUserMsg.content, activeTone || tone, extendedThinking || false],
                    );
                }
            });
        }

        // Auto-skill detection: merge auto-detected skills with explicit activeModes
        let effectiveModes = [...activeModes];
        let autoDetectedModes: ChatMode[] = [];

        if (autoSkillSetting === 'auto') {
            const lastMsg = messages?.filter(m => m.role === 'user').pop()?.content || '';
            autoDetectedModes = detectSkillsFromMessage(lastMsg, activeModes);
            if (autoDetectedModes.length > 0) {
                effectiveModes = [...new Set([...activeModes, ...autoDetectedModes])];
            }
        }

        const modeSettings = resolveSettings(effectiveModes);
        const effectiveTone = activeTone || tone || null;

        const lastUserMsgContent = messages?.filter(m => m.role === 'user').pop()?.content || '';

        // Only use hivemind if authenticated to prevent memory poisoning
        const memoryUserId = (isHivemind && userId) ? 'collective-hivemind' : userId;
        const memoryRows: UserMemoryRow[] = memoryUserId ? await getMemoryRows(memoryUserId) : [];

        // systemPromptOverride is a privileged operation — only authenticated users may use it,
        // and the override is silently dropped for guest sessions to prevent injection attacks
        // from unauthenticated callers replacing the safety-critical guest-mode prompt.
        const allowedOverride = userId ? systemPromptOverride : undefined;

        let systemPrompt = allowedOverride ?? getSystemPrompt({
            modelId: model || 'tura-3',
            tone: effectiveTone as ToneType | null,
            activeModes: effectiveModes,
            anuraActive: anura || false,
            extendedThinking: extendedThinking || false,
            autoActivatedModes: autoDetectedModes.length > 0 ? autoDetectedModes : undefined,
            lastUserMessage: lastUserMsgContent,
        });

        // 'ask' mode: instruct AI to suggest skills naturally in its response
        if (autoSkillSetting === 'ask') {
            systemPrompt += `\n\nYou have access to the following AI skills that the user can toggle: think, deep-research, web-search, study, code, creative, summarize, eli5, brainstorm, roleplay, debate, translate, fact-check, freestyle. If the user's message would strongly benefit from one of these skills being activated, briefly suggest it at the end of your response in a natural way (e.g., "Tip: Try turning on the **Code** skill for better code help!"). Only suggest when clearly beneficial — do not suggest skills every message.`;
        }

        systemPrompt += `\n\n${buildCodeExecutionToolInstructions()}`;

        if (userId) {
            systemPrompt += `\n\n## Long-term Memory Tools (USE LIBERALLY)

Memory is one of your most important skills — use these tools on EVERY conversation where the user reveals anything durable about themselves. Treat memory like the \`run_code\` tool: when the situation calls for it, just use it, don't ask permission, don't announce it.

- \`remember_fact({fact, tags?})\`: save a new durable fact. Call this any time the user shares something a future assistant would want to know — name, role, location, projects, tools they use, languages they speak, preferences (formal vs casual, short vs long answers, dark vs light mode, etc.), recurring goals, ongoing struggles, recent wins, family/pet names, anything they've expressed strong opinions about. Aim for 1–3 saves per substantive conversation when there's new ground covered. Write each fact as a single short statement in third person (e.g. "User is a senior Go engineer at a fintech in Berlin").
- \`update_fact({memory_id, fact, tags?})\`: revise an existing memory IN PLACE when something changes. Prefer this over delete+re-add. Example: if you remembered "User uses VSCode" and they mention they switched to Cursor, call \`update_fact\`.
- \`forget_fact({memory_id})\`: delete a memory. Use when the user explicitly asks to forget, OR when a memory is now false and there's nothing to update (e.g. they moved on from a project entirely).

Rules:
- The ids come from the \`# Memorys #\` JSON block at the end of this prompt — copy them verbatim.
- Do NOT save sensitive credentials, passwords, tokens, full financial info, or anything the user wouldn't want shown to another AI assistant.
- Do NOT save ephemeral stuff ("today's weather", "we just discussed X").
- Skip duplicates — if a fact is already in \`# Memorys #\`, don't save it again.
- Do NOT narrate the save unless the user asks ("don't say 'I'll remember that' — just remember it").
- These tools are SILENT — they return a status, but the user doesn't see your tool calls. Just keep talking after.`;
        }

        // Inject feedback-derived behavioural hints (length preference,
        // satisfaction skew) so thumbs-up/down actually steer how Tripplet
        // talks. Authenticated users only — no signals to derive for guests.
        if (userId) {
            const feedbackBlock = await getFeedbackSignals(userId);
            if (feedbackBlock) {
                systemPrompt += `\n\n${feedbackBlock}`;
            }
        }

        if (!userId) {
            // Guest endowment nudge: once they have 6+ messages in the conversation,
            // the AI can mention (very rarely) that a free account would let it remember them.
            const totalMsgs = messages?.length ?? 0;
            if (totalMsgs >= 6) {
                systemPrompt += `\n\nNote: This user is a guest. You do NOT have any memory of past conversations. If the user asks a question that would benefit from knowing their background, preferences, or prior discussions, you may mention once (no more than once per conversation) that creating a free account would let you remember them across sessions. Keep it brief and helpful, never pushy.`;
            }
        }

        const qLowerCase = lastUserMsgContent.toLowerCase();
        // Only auto-search when the query looks like a factual/temporal question —
        // not conversational phrases like "how are you" or "what do you think"
        const hasFactualKeyword = /\b(search|latest|current|recent|price|news|today|2024|2025|2026|weather|stock|score|release|update|announce|launch|trending|statistics|stats|compare|versus|vs|ranking|results)\b/.test(qLowerCase);
        const hasFactualQuestion = qLowerCase.includes('?') && (
            /^(who is|who was|who are|what is|what are|what was|what's|where is|where do|where can|when did|when is|when does|when was|why did|why is|why does|why are|how much|how many|how does|how do|how did|how to|how can|is there|are there|can you find|do you know|tell me about)/.test(qLowerCase)
        );
        const shouldAutoSearch = qLowerCase.length > 10 && (
            hasFactualKeyword ||
            hasFactualQuestion
        );

        const searchStats = { count: 0, failed: false };

        if (modeSettings.enableWebSearch || shouldAutoSearch) {
            const searchResults = await fetchWebSearchResults(lastUserMsgContent);
            if (searchResults.text) {
                systemPrompt += `\n${searchResults.text}`;
                searchStats.count = searchResults.count;
            } else if (modeSettings.enableWebSearch) {
                // The user explicitly enabled web search and got nothing back.
                // Tell the model, so it does not present training-data facts as
                // current, and flag it for the client.
                searchStats.failed = true;
                systemPrompt += `\n\nNOTE: Live web search was requested for this turn but ${searchResults.failed ? 'the search service failed' : 'returned no results'}. You have NO current web data. When the answer depends on recent information, say briefly that you could not verify it, and do not present training-data facts as current.`;
            }
        }

        // Memorys block — ALWAYS at the very end of the system prompt so it's
        // the last thing the model sees before user turns. Authenticated users
        // only (guests have no persistent memory).
        if (userId) {
            systemPrompt += `\n\n${buildMemoryBlock(memoryRows)}`;
        }

        const apiMessages: ProviderChatMessage[] = [
            { role: 'system' as const, content: systemPrompt },
        ];

        for (const msg of messages || []) {
            if (msg.role === 'user' || msg.role === 'assistant') {
                let content = msg.content;
                if (msg === messages?.[messages.length - 1] && msg.role === 'user' && imageDescription) {
                    content = `[The user uploaded an image. Image analysis: ${imageDescription}]\n\n${content}`;
                }
                apiMessages.push({ role: msg.role as 'user' | 'assistant', content });
            }
        }

        let fullResponse = '';
        const stream = new ReadableStream({
            async start(controller) {
                const encoder = new TextEncoder();
                const codeExecutions: CodeExecution[] = [];
                // Heartbeat: emit a ping during silent gaps (long model "thinking",
                // tool execution) so proxies/clients don't idle-timeout the stream.
                let streamClosed = false;
                const heartbeat = setInterval(() => {
                    if (streamClosed) return;
                    try {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'ping' })}\n\n`));
                    } catch {
                        // Controller already closed (client disconnected) — stop pinging.
                        clearInterval(heartbeat);
                    }
                }, 15_000);
                try {
                    const enqueueEvent = (payload: Record<string, unknown>) => {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
                    };

                    if (searchStats.count > 0 || searchStats.failed) {
                        enqueueEvent({ type: 'search_stats', count: searchStats.count, failed: searchStats.failed });
                    }

                    if (autoDetectedModes.length > 0) {
                        enqueueEvent({ type: 'auto_skills', modes: autoDetectedModes });
                    }

                    // Token budget rules:
                    //  - Taipei (tura-3): NEVER cap. Unlimited thinking budget — the
                    //    model self-scales reasoning length based on the complexity
                    //    instruction injected in the system prompt. Mode caps (like
                    //    deep-research's 8192) are also ignored here so Taipei can
                    //    keep going on heavy builds.
                    //  - Majuli (majuli-3): default-cap at 2048 for concise replies
                    //    unless a mode explicitly overrides.
                    //  - Suzhou + everything else: honor mode caps; otherwise no cap.
                    const isTaipei = model === 'tura-3';
                    const effectiveMaxTokens = isTaipei
                        ? undefined
                        : (modeSettings.maxTokens
                            ?? ((model === 'majuli-3') ? 2048 : undefined));

                    const conversationMessages: ProviderChatMessage[] = [...apiMessages];

                    for (let toolRound = 0; toolRound < MAX_TOOL_ROUNDS; toolRound += 1) {
                        let roundToolCalls: ChatToolCall[] = [];

                        for await (const event of streamChatEvents({
                            messages: conversationMessages,
                            modelId: model || 'tura-3',
                            temperature: modeSettings.temperature,
                            maxTokens: effectiveMaxTokens,
                            tools: userId
                                ? [RUN_CODE_TOOL, REMEMBER_TOOL, UPDATE_TOOL, FORGET_TOOL]
                                : [RUN_CODE_TOOL],
                        })) {
                            if (event.type === 'content') {
                                fullResponse += event.content;
                                enqueueEvent({ content: event.content });
                                continue;
                            }

                            if (event.type === 'tool_calls') {
                                roundToolCalls = event.toolCalls;
                            }
                        }

                        if (roundToolCalls.length === 0) {
                            break;
                        }

                        conversationMessages.push({
                            role: 'assistant',
                            content: '',
                            tool_calls: roundToolCalls,
                        });

                        for (const toolCall of roundToolCalls) {
                            const name = toolCall.function.name;
                            let parsedArgs: Record<string, unknown> = {};
                            try {
                                parsedArgs = JSON.parse(toolCall.function.arguments || '{}');
                            } catch {
                                conversationMessages.push({
                                    role: 'tool',
                                    tool_call_id: toolCall.id,
                                    content: JSON.stringify({ status: 'error', error: 'Tool arguments were invalid JSON.' }),
                                });
                                continue;
                            }

                            // Shared helper: parse + normalize tags from a memory tool call.
                            const normalizeTags = (raw: unknown): string[] => {
                                const arr = Array.isArray(raw) ? raw : [];
                                return arr
                                    .filter((t): t is string => typeof t === 'string')
                                    .map((t) => t.trim().toLowerCase())
                                    .filter((t) => t.length > 0 && t.length <= 40)
                                    .slice(0, 12);
                            };

                            const pushToolResult = (payload: Record<string, unknown>) => {
                                conversationMessages.push({
                                    role: 'tool',
                                    tool_call_id: toolCall.id,
                                    content: JSON.stringify(payload),
                                });
                            };

                            // Map errors from the user-memory helper to user-friendly tool
                            // results. The model will see these and can adapt mid-turn.
                            const memoryError = (e: unknown): string => {
                                if (e instanceof InvalidKeyError) return 'Memory store auth failed (DATABASE_URL). Tell the user to fix it in Settings → Memory & Profile.';
                                if (e instanceof MissingTableError) return 'UserMemory table missing in the database. Tell the user to run the CREATE TABLE SQL in Settings → Memory & Profile.';
                                return e instanceof Error ? e.message : 'Memory store error';
                            };

                            if (name === 'remember_fact') {
                                if (!userId) {
                                    pushToolResult({ status: 'error', error: 'Guests have no long-term memory.' });
                                    continue;
                                }
                                const fact = typeof parsedArgs.fact === 'string' ? parsedArgs.fact.trim() : '';
                                if (!fact || fact.length > 1000) {
                                    pushToolResult({ status: 'error', error: 'remember_fact requires a non-empty fact under 1000 chars.' });
                                    continue;
                                }
                                const tags = normalizeTags(parsedArgs.tags);
                                try {
                                    const created = await createMemory({
                                        userId: memoryUserId || userId,
                                        content: fact,
                                        tags,
                                        source: 'auto',
                                    });
                                    enqueueEvent({ type: 'memory_saved', id: created.id, content: created.content, tags: created.tags });
                                    pushToolResult({ status: 'ok', id: created.id });
                                } catch (e) {
                                    pushToolResult({ status: 'error', error: memoryError(e) });
                                }
                                continue;
                            }

                            if (name === 'update_fact') {
                                if (!userId) {
                                    pushToolResult({ status: 'error', error: 'Guests have no long-term memory.' });
                                    continue;
                                }
                                const memId = typeof parsedArgs.memory_id === 'string' ? parsedArgs.memory_id : '';
                                const fact = typeof parsedArgs.fact === 'string' ? parsedArgs.fact.trim() : '';
                                if (!memId || !fact) {
                                    pushToolResult({ status: 'error', error: 'update_fact requires memory_id and fact.' });
                                    continue;
                                }
                                if (fact.length > 1000) {
                                    pushToolResult({ status: 'error', error: 'fact too long (max 1000 chars).' });
                                    continue;
                                }
                                const tags = parsedArgs.tags !== undefined ? normalizeTags(parsedArgs.tags) : undefined;
                                try {
                                    const updated = await updateMemory({
                                        userId: memoryUserId || userId,
                                        id: memId,
                                        content: fact,
                                        tags,
                                    });
                                    enqueueEvent({ type: 'memory_updated', id: updated.id, content: updated.content, tags: updated.tags });
                                    pushToolResult({ status: 'ok', id: updated.id });
                                } catch (e) {
                                    pushToolResult({ status: 'error', error: memoryError(e) });
                                }
                                continue;
                            }

                            if (name === 'forget_fact') {
                                if (!userId) {
                                    pushToolResult({ status: 'error', error: 'Guests have no long-term memory.' });
                                    continue;
                                }
                                const memId = typeof parsedArgs.memory_id === 'string' ? parsedArgs.memory_id : '';
                                if (!memId) {
                                    pushToolResult({ status: 'error', error: 'memory_id is required.' });
                                    continue;
                                }
                                try {
                                    const removed = await deleteMemory(memoryUserId || userId, memId);
                                    if (!removed) {
                                        pushToolResult({ status: 'error', error: 'Memory not found.' });
                                        continue;
                                    }
                                    enqueueEvent({ type: 'memory_deleted', id: memId });
                                    pushToolResult({ status: 'ok' });
                                } catch (e) {
                                    pushToolResult({ status: 'error', error: memoryError(e) });
                                }
                                continue;
                            }

                            if (name !== 'run_code') {
                                conversationMessages.push({
                                    role: 'tool',
                                    tool_call_id: toolCall.id,
                                    content: JSON.stringify({ status: 'error', error: `Unknown tool: ${name}` }),
                                });
                                continue;
                            }

                            const language = parsedArgs.language as 'python' | 'bash' | undefined;
                            const code = typeof parsedArgs.code === 'string' ? parsedArgs.code : '';

                            if ((language !== 'python' && language !== 'bash') || !code) {
                                conversationMessages.push({
                                    role: 'tool',
                                    tool_call_id: toolCall.id,
                                    content: JSON.stringify({ status: 'error', error: 'run_code requires a valid language and code.' }),
                                });
                                continue;
                            }

                            const execution = await executeRunCodeTool({
                                sessionId: conversationId || `guest-${token}`,
                                toolCallId: toolCall.id,
                                language,
                                code,
                                onEvent: enqueueEvent,
                            });
                            codeExecutions.push(execution);

                            conversationMessages.push({
                                role: 'tool',
                                tool_call_id: toolCall.id,
                                content: JSON.stringify({
                                    status: execution.status,
                                    language: execution.language,
                                    stdout: execution.stdout || '',
                                    stderr: execution.stderr || '',
                                    output: execution.output || '',
                                    error: execution.error || null,
                                    sandbox_id: execution.sandboxId || null,
                                }),
                            });
                        }
                    }

                    if (!fullResponse.trim() && codeExecutions.length > 0) {
                        const fallback = codeExecutions.some((execution) => execution.status === 'error')
                            ? 'I ran the code in the sandbox, but it hit an execution error.'
                            : 'I ran the code in the sandbox successfully.';
                        fullResponse = fallback;
                        enqueueEvent({ content: fallback });
                    }

                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));

                    if (memoryUserId) {
                        storeMemory(memoryUserId, lastUserMsgContent, fullResponse).catch((e) => console.error('[memory] store failed:', e.message));

                        if (conversationId) {
                            query(
                                `INSERT INTO "Message" (id, "conversationId", role, content, attachments, "createdAt")
                                 VALUES (gen_random_uuid()::text, $1, 'assistant', $2, $3::jsonb, now())`,
                                [
                                    conversationId,
                                    fullResponse,
                                    serializeMessageMetadata({ codeExecutions }),
                                ],
                            ).catch((error) => {
                                console.error('Failed to save assistant message:', error);
                            });
                        }
                    }
                } catch (error: unknown) {
                    const message = error instanceof Error ? error.message : 'Stream error';
                    const errData = `data: ${JSON.stringify({ error: message })}\n\n`;
                    try {
                        controller.enqueue(encoder.encode(errData));
                    } catch {
                        // Controller already closed — nothing to report to.
                    }
                } finally {
                    streamClosed = true;
                    clearInterval(heartbeat);
                    try {
                        controller.close();
                    } catch {
                        // Already closed.
                    }
                }
            },
        });

        return new Response(stream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Internal Server Error';
        return new Response(
            JSON.stringify({ error: message }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
}
