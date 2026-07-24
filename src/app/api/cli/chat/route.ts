// Agentic chat endpoint for non-browser clients (the Astrocode CLI).
//
// Unlike /api/sonoma, the tool loop does NOT run here. The caller is a coding
// agent on the user's own machine: it sends its own tool definitions, we relay
// the model's tool calls back, it executes them locally (behind its own
// permission prompts) and posts the results as `tool` messages. So one HTTP
// request is exactly one model turn, and this route stays stateless.
//
// SSE events — one `data: <json>` line each, `done` always last:
//   { type: 'thinking',  delta }
//   { type: 'content',   delta }
//   { type: 'tool_call', id, name, args }
//   { type: 'done',      finish: 'stop' | 'tool_calls' }
//   { type: 'error',     message }

import { NextRequest } from 'next/server';
import { resolveBearerUser, bearerUnauthorized } from '@/lib/mcp/bearer';
import { corsJson, preflight } from '@/lib/mcp/http';
import { resolveBackend, envVarFor, DEEP_CODE_PERSONA, type BackendTarget } from '@/lib/ai/llm';
import { makeThinkSplitter } from '@/lib/ai/thinkSplitter';
import { streamOnce } from '@/lib/sonoma/upstream';
import { chatLimiter, LIMITS, rateLimitResponse, getRateLimitToken } from '@/lib/security/rate-limit';
import {
    checkUsageAllowance,
    usageLimitResponse,
    recordUsage,
    finalizeUsage,
} from '@/lib/usage/tracker';

export const runtime = 'nodejs';
// A coding turn can involve a long file read followed by a long generation.
export const maxDuration = 300;

const MAX_MESSAGES = 120;
const MAX_MESSAGE_CHARS = 64_000;
const MAX_TOTAL_CHARS = 600_000;
const MAX_TOOLS = 40;

const ROLES = new Set(['system', 'user', 'assistant', 'tool']);

interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
    tool_call_id?: string;
}

interface RouteBody {
    model?: string;
    messages?: ChatMessage[];
    tools?: Array<{ type: 'function'; function: { name: string; description?: string; parameters?: unknown } }>;
    temperature?: number;
    max_tokens?: number;
}

export function OPTIONS() {
    return preflight();
}

/** Reject early with a shape the CLI renders as a message, not a stack trace. */
function bad(error_description: string): Response {
    return corsJson({ error: 'invalid_request', error_description }, { status: 400 });
}

function validate(body: RouteBody): string | null {
    const { messages, tools } = body;
    if (!Array.isArray(messages) || messages.length === 0) return 'messages must be a non-empty array.';
    if (messages.length > MAX_MESSAGES) return `Too many messages (max ${MAX_MESSAGES}).`;
    if (tools && (!Array.isArray(tools) || tools.length > MAX_TOOLS)) {
        return `tools must be an array of at most ${MAX_TOOLS} entries.`;
    }

    let total = 0;
    for (const m of messages) {
        if (!m || typeof m !== 'object') return 'Invalid message.';
        if (!ROLES.has(m.role)) return `Invalid role "${m.role}".`;
        // An assistant message that only carries tool_calls legitimately has no
        // prose, so empty content is allowed — a non-string one is not.
        if (typeof m.content !== 'string') return 'Message content must be a string.';
        if (m.content.length > MAX_MESSAGE_CHARS) return `Message too long (max ${MAX_MESSAGE_CHARS} chars).`;
        if (m.role === 'tool' && !m.tool_call_id) return 'A tool message requires tool_call_id.';
        total += m.content.length;
    }
    if (total > MAX_TOTAL_CHARS) return `Conversation too large (max ${MAX_TOTAL_CHARS} chars).`;
    if (!messages.some((m) => m.role !== 'system')) return 'messages must contain more than system prompts.';
    return null;
}

export async function POST(request: NextRequest) {
    const user = await resolveBearerUser(request);
    if (!user) return bearerUnauthorized(request);

    try {
        await chatLimiter.check(LIMITS.chat, getRateLimitToken(request, user.userId));
    } catch {
        return rateLimitResponse();
    }

    let body: RouteBody;
    try {
        body = (await request.json()) as RouteBody;
    } catch {
        return bad('Body must be JSON.');
    }
    const invalid = validate(body);
    if (invalid) return bad(invalid);

    const messages = body.messages as ChatMessage[];
    const tools = body.tools ?? [];
    const model = typeof body.model === 'string' && body.model ? body.model : DEEP_CODE_PERSONA;

    // Metering policy: one agentic turn costs ONE message from the user's
    // budget, however many tool rounds it takes. A request whose last message
    // is `user` starts a turn and is metered; one whose last message is `tool`
    // is the CLI feeding results back mid-turn and is not. Charging per round
    // would make a single "fix this test" cost 7 of the free plan's 25, and
    // would punish exactly the thorough tool use we want. Every request is
    // still rate-limited above, and the bearer names the account, so the worst
    // case for a client that lies about continuations is bounded by LIMITS.chat.
    const isNewTurn = messages[messages.length - 1]?.role === 'user';

    if (isNewTurn) {
        const allowance = await checkUsageAllowance(user.userId);
        if (!allowance.allowed) return usageLimitResponse(allowance);
    }

    const target: BackendTarget = resolveBackend(model);
    if (!target.apiKey) {
        return corsJson(
            {
                error: 'backend_unconfigured',
                error_description: `Inference backend not configured: set ${target.keyEnvName || envVarFor(target.provider)} to use ${model}.`,
            },
            { status: 503 },
        );
    }

    // Counted only after every pre-inference rejection path, so a misconfigured
    // backend or a bad request never drains anyone's budget.
    const usageRecordId = isNewTurn
        ? await recordUsage({
              userId: user.userId,
              model,
              promptChars: messages.reduce((n, m) => n + m.content.length, 0),
          })
        : null;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            let closed = false;
            const enqueue = (obj: Record<string, unknown>) => {
                if (closed) return;
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
            };
            const close = () => {
                if (closed) return;
                closed = true;
                controller.close();
            };

            // The CLI sends its own system prompt: it knows its tools, its cwd
            // and its output conventions, none of which this server can guess.
            const history: Array<Record<string, unknown>> = messages.map((m) => {
                const out: Record<string, unknown> = { role: m.role, content: m.content };
                if (m.tool_calls) out.tool_calls = m.tool_calls;
                if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
                return out;
            });

            const splitter = makeThinkSplitter();
            let replyChars = 0;
            // Tool calls are held until the text is flushed. `streamOnce` only
            // emits them once the upstream stream ends, while the splitter is
            // still holding the last few characters of prose in case they turn
            // out to be a partial </think> — without this the tail of a short
            // answer would arrive after the calls it introduces. Clients get a
            // simple guarantee instead: in one round, all text precedes all
            // tool calls.
            const pending: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];

            try {
                for await (const ev of streamOnce(history, false, 'code', target, tools)) {
                    if (ev.type === 'content') {
                        const { thinking, content } = splitter.feed(ev.delta);
                        if (thinking) enqueue({ type: 'thinking', delta: thinking });
                        if (content) {
                            replyChars += content.length;
                            enqueue({ type: 'content', delta: content });
                        }
                    } else if (ev.type === 'thinking') {
                        enqueue({ type: 'thinking', delta: ev.delta });
                    } else if (ev.type === 'tool_call') {
                        pending.push({ id: ev.id, name: ev.name, args: ev.args });
                    }
                }
                const tail = splitter.flush();
                if (tail.thinking) enqueue({ type: 'thinking', delta: tail.thinking });
                if (tail.content) {
                    replyChars += tail.content.length;
                    enqueue({ type: 'content', delta: tail.content });
                }
                for (const call of pending) {
                    enqueue({ type: 'tool_call', id: call.id, name: call.name, args: call.args });
                }
                enqueue({ type: 'done', finish: pending.length ? 'tool_calls' : 'stop' });
            } catch (e) {
                // An upstream failure must reach the client as a readable event.
                // Throwing out of start() would abort the response body and the
                // CLI would see a truncated stream with no explanation.
                console.error('[cli/chat] stream failed:', e instanceof Error ? e.message : e);
                enqueue({ type: 'error', message: e instanceof Error ? e.message : 'Inference failed.' });
                enqueue({ type: 'done', finish: 'stop' });
            } finally {
                close();
                if (usageRecordId) void finalizeUsage(usageRecordId, replyChars);
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
