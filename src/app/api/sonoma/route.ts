// Sonoma agentic chat endpoint. Streams SSE events the ChatShell can render:
//   { type: 'activity', tool, label, status, data? }
//   { type: 'thinking', delta }
//   { type: 'content', delta }
//   { type: 'done' }
//   { type: 'error', message }
//
// This file is deliberately thin: request validation, auth/rate limiting,
// backend selection, and the top-level tool loop. The heavy lifting lives in
// src/lib/sonoma/* (prompt, tools, upstream streaming, deep-code pipeline).

import { NextRequest } from 'next/server';
import { resolveBackend, envVarFor, type BackendTarget, LLM_API_URL, DEEP_CODE_PERSONA } from '@/lib/ai/llm';
import { makeThinkSplitter, type ThinkSplitter } from '@/lib/ai/thinkSplitter';
import { auth } from '@/lib/auth/session';
import { OUTAGE_ACTIVE } from '@/lib/outage';
import { verifyDevToken, DEV_UNLOCK_COOKIE } from '@/lib/devAccess';
import { chatLimiter, LIMITS, rateLimitResponse, getRateLimitToken } from '@/lib/security/rate-limit';
import { buildSonomaSystemPrompt, type SonomaPage } from '@/lib/sonoma/prompt';
import { SONOMA_TOOLS, runTool, type ToolCall } from '@/lib/sonoma/tools';
import { getComposioToolset } from '@/lib/composio/tools';
import { streamOnce } from '@/lib/sonoma/upstream';
import { runDeepCodePipeline } from '@/lib/sonoma/deepcode';
import { listMemories } from '@/lib/db/user-memory';
import { learnFromExchange } from '@/lib/memory/learner';
import { sanitizeExternalContent } from '@/lib/security/sanitize';

export const runtime = 'nodejs';
// Deep Code pipelines run several sequential model stages — give them room.
export const maxDuration = 300;

interface RouteBody {
    messages: { role: 'user' | 'assistant' | 'system'; content: string }[];
    reason?: boolean;
    browse?: boolean;
    code?: boolean;
    // DeepCode toggle (code page). The 'astro-5-code' persona always runs the
    // deep pipeline; for other personas this just raises the rigor bar.
    deepCode?: boolean;
    // Tripplet Sandboxed Linux skill. When enabled (settings toggle), the
    // `run_bash` tool is offered to the model; commands actually execute in the
    // user's in-browser Linux VM (client-side), so the server tool just
    // acknowledges and the client streams the real output into the card.
    sandbox?: boolean;
    // Memory skill (settings toggle, default on). When enabled for a signed-in
    // user, stored memories are injected into the system prompt and, after the
    // exchange, big-pickle autonomously extracts new durable facts about the
    // user in the background (src/lib/memory/learner.ts).
    memory?: boolean;
    page?: SonomaPage;
    // Persona id (e.g. 'astro-5', 'tura-3'). Selects the upstream backend.
    model?: string;
    // /dev panel only (src/app/dev/page.tsx): routes this request through a
    // user-supplied key + model id instead of the normal server-side backend.
    // Requires OUTAGE_ACTIVE and the HttpOnly dev-unlock cookie set by
    // POST /api/dev/unlock — the password itself never leaves the server.
    dev?: { apiKey: string; modelId: string };
}

const MAX_MESSAGES = 60;
const MAX_MESSAGE_CHARS = 32_000;
// How many sequential tool-calling turns the model gets before it must answer.
// Kept modest for latency/cost, but a genuine research task (search + read a
// few pages) needs more than a couple; once exhausted we still force a final
// answer rather than dead-ending (see the synthesis turn below).
const MAX_TOOL_ROUNDS = 6;

export async function POST(req: NextRequest) {
    // Authentication is optional — guests are allowed but get a strict per-IP cap.
    const { userId } = await auth();

    const token = getRateLimitToken(req, userId);
    try {
        // Guests share an IP bucket; authed users get a per-user bucket.
        const cap = userId ? LIMITS.chat : Math.min(LIMITS.chat, 30);
        await chatLimiter.check(cap, token);
    } catch {
        return rateLimitResponse();
    }

    let body: RouteBody;
    try {
        body = (await req.json()) as RouteBody;
    } catch {
        return new Response('Bad JSON', { status: 400 });
    }
    const { messages, reason = false, browse = false, code = false, deepCode = false, sandbox = false, memory = true, page = 'chat', model, dev } = body;
    // The run_bash tool is only offered when the Sandboxed Linux skill is on.
    const builtinTools = sandbox ? SONOMA_TOOLS : SONOMA_TOOLS.filter((t) => t.function.name !== 'run_bash');
    // Connector (Composio) tools for the apps this user has linked in
    // Settings → Connectors. Guests and un-configured deploys get none, and
    // any Composio failure degrades to none — chat must never block on it.
    // Started concurrently with the memory fetch below so pre-stream latency
    // is the slower of the two, not their sum.
    const composioPromise = getComposioToolset(userId);
    const memoriesPromise: Promise<string[]> =
        memory && userId
            ? listMemories(userId, 25)
                  .then((rows) => rows.map((m) => sanitizeExternalContent(m.content)))
                  .catch(() => [])
            : Promise.resolve([]);
    const composio = await composioPromise;
    const activeTools = [...builtinTools, ...(composio?.defs ?? [])];
    if (!Array.isArray(messages) || messages.length === 0) {
        return new Response('messages required', { status: 400 });
    }
    if (messages.length > MAX_MESSAGES) {
        return new Response('Too many messages', { status: 400 });
    }
    for (const m of messages) {
        if (!m || typeof m.content !== 'string') {
            return new Response('Invalid message', { status: 400 });
        }
        if (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'system') {
            return new Response('Invalid role', { status: 400 });
        }
        if (m.content.length > MAX_MESSAGE_CHARS) {
            return new Response('Message too long', { status: 400 });
        }
    }
    // System messages are stripped before reaching the model (see below), so a
    // request made entirely of them has nothing left to answer.
    if (!messages.some((m) => m.role !== 'system')) {
        return new Response('messages required', { status: 400 });
    }
    if (page !== 'chat' && page !== 'code' && page !== 'agent') {
        return new Response('Invalid page', { status: 400 });
    }

    // /dev panel override — a locked-down escape hatch that only works while
    // the site is in outage mode, only for the plain tool-loop path (never
    // the DeepCode pipeline), and only with a valid dev-unlock cookie (signed,
    // expiring, set server-side by /api/dev/unlock after a password check).
    let target: BackendTarget;
    if (dev && OUTAGE_ACTIVE && model !== DEEP_CODE_PERSONA) {
        if (!verifyDevToken(req.cookies.get(DEV_UNLOCK_COOKIE)?.value)) {
            return new Response('Dev panel not unlocked', { status: 403 });
        }
        if (!dev.apiKey || !dev.modelId) {
            return new Response('Dev override requires apiKey and modelId', { status: 400 });
        }
        target = {
            provider: 'groq',
            url: LLM_API_URL,
            apiKey: dev.apiKey,
            model: dev.modelId,
        };
    } else {
        // Per-persona backend routing (see resolveBackend).
        target = resolveBackend(model);
    }
    if (!target.apiKey) {
        return new Response(
            `Inference backend not configured: set ${target.keyEnvName || envVarFor(target.provider)} to use ${model || 'this model'}.`,
            { status: 503 },
        );
    }

    // Memory skill: stored facts about this user go into the system prompt.
    // Signed-in users only; any DB problem degrades to "no memories".
    const memoryOn = memory && !!userId;
    const userMemories: string[] = await memoriesPromise;

    // After the reply finishes, learn about the user in the background —
    // never awaited on the hot path, never allowed to throw.
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const learnInBackground = (assistantText: string) => {
        if (!memoryOn || !assistantText.trim()) return;
        void learnFromExchange({
            userId: userId!,
            userMessage: lastUserMessage,
            assistantMessage: assistantText,
        });
    };

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const enqueue = (obj: Record<string, unknown>) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
            };

            // Astro 5 Code is a staged pipeline, not a single model — it gets
            // its own THINK ⇄ ROUTE → CODE flow instead of the tool loop.
            if (model === DEEP_CODE_PERSONA) {
                try {
                    await runDeepCodePipeline(enqueue, messages);
                    enqueue({ type: 'done' });
                } catch (e) {
                    const message = e instanceof Error ? e.message : 'Unknown error';
                    enqueue({ type: 'error', message });
                }
                controller.close();
                return;
            }

            // Client-supplied system messages would sit alongside the server's
            // own system prompt with equal authority (persona, injection
            // guardrails), so they are dropped — same policy as the DeepCode
            // pipeline. The app's own client never sends them anyway.
            const history: Array<Record<string, unknown>> = [
                { role: 'system', content: buildSonomaSystemPrompt(page, reason, browse, code, model, deepCode, sandbox, composio?.apps ?? [], userMemories) },
                ...messages.filter((m) => m.role !== 'system'),
            ];

            // Everything streamed to the user this request — fed to the
            // background memory learner once the reply completes.
            let fullReply = '';

            try {
                for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
                    let assistantContent = '';
                    const turnToolCalls: ToolCall[] = [];
                    const turnToolMessages: Array<Record<string, unknown>> = [];
                    // Only the code workspace uses the <think> CoT protocol.
                    // Other pages stream content through unchanged.
                    const splitter: ThinkSplitter | null =
                        page === 'code' ? makeThinkSplitter() : null;

                    for await (const ev of streamOnce(history, reason, page, target, activeTools)) {
                        if (ev.type === 'content') {
                            if (splitter) {
                                const { thinking, content } = splitter.feed(ev.delta);
                                if (thinking) enqueue({ type: 'thinking', delta: thinking });
                                if (content) {
                                    assistantContent += content;
                                    enqueue({ type: 'content', delta: content });
                                }
                            } else {
                                assistantContent += ev.delta;
                                enqueue({ type: 'content', delta: ev.delta });
                            }
                        } else if (ev.type === 'thinking') {
                            enqueue({ type: 'thinking', delta: ev.delta });
                        } else if (ev.type === 'tool_call') {
                            turnToolCalls.push({ id: ev.id, name: ev.name, args: ev.args });
                        }
                    }

                    // Drain anything held back by the splitter (incomplete tag
                    // detection at the very end of the stream).
                    if (splitter) {
                        const { thinking, content } = splitter.flush();
                        if (thinking) enqueue({ type: 'thinking', delta: thinking });
                        if (content) {
                            assistantContent += content;
                            enqueue({ type: 'content', delta: content });
                        }
                    }

                    fullReply += assistantContent;

                    if (turnToolCalls.length === 0) {
                        enqueue({ type: 'done' });
                        controller.close();
                        learnInBackground(fullReply);
                        return;
                    }

                    // Push the assistant turn with its tool calls into history.
                    history.push({
                        role: 'assistant',
                        content: assistantContent || null,
                        tool_calls: turnToolCalls.map((tc) => ({
                            id: tc.id,
                            type: 'function',
                            function: {
                                name: tc.name,
                                arguments: JSON.stringify(tc.args),
                            },
                        })),
                    });

                    // Run each tool, emit activity, append tool message.
                    for (const tc of turnToolCalls) {
                        enqueue({
                            type: 'activity',
                            id: tc.id,
                            tool: tc.name,
                            status: 'running',
                            args: tc.args,
                        });
                        // Connector calls route through Composio (per-user
                        // scoping lives server-side there); everything else is
                        // a built-in tool.
                        const out = composio?.canRun(tc.name)
                            ? await composio.run(tc)
                            : await runTool(tc);
                        let parsed: unknown = out;
                        try {
                            parsed = JSON.parse(out);
                        } catch {
                            /* keep raw string */
                        }
                        enqueue({
                            type: 'activity',
                            id: tc.id,
                            tool: tc.name,
                            status: 'done',
                            args: tc.args,
                            result: parsed,
                        });
                        turnToolMessages.push({
                            role: 'tool',
                            tool_call_id: tc.id,
                            content: out,
                        });
                    }
                    history.push(...turnToolMessages);
                }

                // Round budget exhausted while the model was still calling
                // tools (e.g. a failing web_search it kept retrying). Instead of
                // dead-ending with no reply, do one final turn with tools
                // disabled so the model MUST synthesize an answer from whatever
                // it gathered — the user always gets a real response.
                const finalSplitter: ThinkSplitter | null =
                    page === 'code' ? makeThinkSplitter() : null;
                let answered = false;
                const emitContent = (delta: string) => {
                    if (finalSplitter) {
                        const { thinking, content } = finalSplitter.feed(delta);
                        if (thinking) enqueue({ type: 'thinking', delta: thinking });
                        if (content) { answered = true; fullReply += content; enqueue({ type: 'content', delta: content }); }
                    } else {
                        answered = true;
                        fullReply += delta;
                        enqueue({ type: 'content', delta });
                    }
                };
                for await (const ev of streamOnce(history, reason, page, target, [])) {
                    if (ev.type === 'content') emitContent(ev.delta);
                    else if (ev.type === 'thinking') enqueue({ type: 'thinking', delta: ev.delta });
                    // tool_call events can't occur — no tools were offered.
                }
                if (finalSplitter) {
                    const { thinking, content } = finalSplitter.flush();
                    if (thinking) enqueue({ type: 'thinking', delta: thinking });
                    if (content) { answered = true; enqueue({ type: 'content', delta: content }); }
                }
                if (!answered) {
                    // Defensive: model returned nothing even without tools.
                    enqueue({
                        type: 'content',
                        delta: `_I wasn't able to finish this with the tools available. Please try rephrasing._`,
                    });
                }
                enqueue({ type: 'done' });
                controller.close();
                learnInBackground(fullReply);
            } catch (e) {
                const message = e instanceof Error ? e.message : 'Unknown error';
                enqueue({ type: 'error', message });
                controller.close();
            }
        },
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
        },
    });
}
