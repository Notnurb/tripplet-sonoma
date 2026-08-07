import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/session';
import { backendFetch } from '@/lib/backend';
import { streamChatEvents, ChatMessage as ProviderChatMessage, ChatToolCall, ChatToolDefinition } from '@/lib/ai/chat-client';
import { randomUUID } from 'crypto';
import { chatLimiter, LIMITS, rateLimitResponse, getRateLimitToken } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';
const MAX_TOOL_ROUNDS = 8;

// ─── Tool Definitions ───────────────────────────────────────────────────────

const RUN_TERMINAL: ChatToolDefinition = {
    type: 'function',
    function: {
        name: 'run_terminal',
        description: 'Execute a shell command in a real sandboxed Linux terminal. Use this for any shell operation: file manipulation, package installation, compilation, system commands, git, curl, etc. Returns real stdout, stderr, and exit code.',
        parameters: {
            type: 'object',
            properties: {
                command: {
                    type: 'string',
                    description: 'The shell command to execute (bash). Can be multi-line.',
                },
            },
            required: ['command'],
            additionalProperties: false,
        },
    },
};

const WEB_SEARCH: ChatToolDefinition = {
    type: 'function',
    function: {
        name: 'web_search',
        description: 'Search the web for real-time information. Returns actual search results with titles, URLs, and content snippets. Use this when you need current data, facts, news, documentation, or any information from the internet.',
        parameters: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'The search query.',
                },
                num_results: {
                    type: 'number',
                    description: 'Number of results to return (1-10). Default 5.',
                },
            },
            required: ['query'],
            additionalProperties: false,
        },
    },
};

const WEB_FETCH: ChatToolDefinition = {
    type: 'function',
    function: {
        name: 'web_fetch',
        description: 'Fetch and read the content of a specific web page URL. Returns the page text content. Use this to read documentation, articles, API responses, or any web page.',
        parameters: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: 'The URL to fetch.',
                },
            },
            required: ['url'],
            additionalProperties: false,
        },
    },
};

const RUN_CODE: ChatToolDefinition = {
    type: 'function',
    function: {
        name: 'run_code',
        description: 'Execute Python or Bash code in a real isolated sandbox. Returns actual stdout, stderr, and output. Use this for computations, data processing, scripting, or any code that needs real execution.',
        parameters: {
            type: 'object',
            properties: {
                language: {
                    type: 'string',
                    enum: ['python', 'bash'],
                    description: 'Which interpreter to use.',
                },
                code: {
                    type: 'string',
                    description: 'The code to execute. Raw code only, no markdown fences.',
                },
            },
            required: ['language', 'code'],
            additionalProperties: false,
        },
    },
};

const TOOLS = [RUN_TERMINAL, WEB_SEARCH, WEB_FETCH, RUN_CODE];

// ─── System Prompt ──────────────────────────────────────────────────────────

const HYPERAGENT_SYSTEM_PROMPT = `You are HyperAgent, a powerful autonomous AI agent on the Tripplet platform. You operate with 4-16 parallel agents under the hood, coordinated to solve complex tasks.

## Your Real Capabilities:
You have REAL tools — not simulated ones. Every tool call executes for real.

1. **run_terminal** — Execute real shell commands in a sandboxed Linux environment. You get real stdout/stderr back.
2. **web_search** — Search the real web. You get actual search results with real URLs and content.
3. **web_fetch** — Fetch and read real web pages. You get the actual page content back.
4. **run_code** — Execute real Python or Bash code in an isolated sandbox with real output.

## How to Work:
- When you need information, USE web_search or web_fetch. Don't guess.
- When you need to compute something, USE run_code. Don't approximate.
- When a task requires shell commands, USE run_terminal. Don't pretend.
- Think step by step. Use tools as needed. Report results honestly.
- If a tool call fails, explain what went wrong and try an alternative.
- Never fabricate tool output. If you didn't call a tool, don't claim you did.

## Important Rules:
- Be direct and concise. No unnecessary filler.
- Show your work — include relevant output from tool calls.
- For multi-step tasks, execute each step and verify before moving on.
- If you can't do something, say so honestly.`;

// ─── Tool Executors ─────────────────────────────────────────────────────────

async function executeTerminal(command: string, sessionId: string): Promise<string> {
    try {
        const resp = await backendFetch('/code/execute/stream', {
            method: 'POST',
            body: JSON.stringify({
                session_id: sessionId,
                execution_id: randomUUID(),
                language: 'bash',
                code: command,
            }),
            signal: AbortSignal.timeout(60_000),
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({})) as Record<string, unknown>;
            return `Error: ${typeof err.detail === 'string' ? err.detail : `HTTP ${resp.status}`}`;
        }

        const reader = resp.body?.getReader();
        if (!reader) return 'Error: No response stream';

        const decoder = new TextDecoder();
        let buffer = '';
        let stdout = '';
        let stderr = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith('data: ')) continue;
                const data = trimmed.slice(6);
                if (data === '[DONE]') break;
                try {
                    const parsed = JSON.parse(data) as Record<string, unknown>;
                    if (parsed.type === 'stdout' && typeof parsed.chunk === 'string') {
                        stdout += parsed.chunk;
                    } else if (parsed.type === 'stderr' && typeof parsed.chunk === 'string') {
                        stderr += parsed.chunk;
                    } else if (parsed.type === 'completed') {
                        const exec = parsed.execution as Record<string, unknown> | undefined;
                        if (exec) {
                            if (typeof exec.stdout === 'string') stdout = exec.stdout;
                            if (typeof exec.stderr === 'string') stderr = exec.stderr;
                        }
                    }
                } catch { /* skip */ }
            }
        }

        const output = [stdout, stderr].filter(Boolean).join('\n');
        return output || '(no output)';
    } catch (err) {
        return `Error: ${err instanceof Error ? err.message : 'Terminal execution failed'}`;
    }
}

async function executeWebSearch(query: string, numResults: number = 5): Promise<string> {
    try {
        const resp = await backendFetch('/search/combined', {
            method: 'POST',
            body: JSON.stringify({
                query,
                num_results: Math.min(Math.max(numResults, 1), 10),
            }),
            signal: AbortSignal.timeout(10_000),
        });

        if (!resp.ok) {
            return `Search error: HTTP ${resp.status}`;
        }

        const data = await resp.json() as { results?: Array<{ title?: string; url?: string; highlights?: string[] }> };
        const results = data.results ?? [];

        if (results.length === 0) return 'No results found.';

        return results.map((r, i) => {
            const title = r.title ?? 'Untitled';
            const url = r.url ?? '';
            const snippet = (r.highlights ?? []).join(' ').slice(0, 300);
            return `${i + 1}. ${title}\n   ${url}\n   ${snippet}`;
        }).join('\n\n');
    } catch (err) {
        return `Search error: ${err instanceof Error ? err.message : 'Search failed'}`;
    }
}

async function executeWebFetch(url: string): Promise<string> {
    try {
        const resp = await backendFetch('/search/firecrawl', {
            method: 'POST',
            body: JSON.stringify({ query: url, num_results: 1 }),
            signal: AbortSignal.timeout(15_000),
        });

        if (!resp.ok) {
            return `Fetch error: HTTP ${resp.status}`;
        }

        const data = await resp.json() as { results?: Array<{ raw_content?: string; highlights?: string[] }> };
        const result = data.results?.[0];
        if (!result) return 'Could not fetch page content.';

        const content = result.raw_content ?? (result.highlights ?? []).join('\n');
        return content.slice(0, 8000) || 'Page returned no readable content.';
    } catch (err) {
        return `Fetch error: ${err instanceof Error ? err.message : 'Page fetch failed'}`;
    }
}

async function executeCode(language: 'python' | 'bash', code: string, sessionId: string): Promise<string> {
    try {
        const resp = await backendFetch('/code/execute/stream', {
            method: 'POST',
            body: JSON.stringify({
                session_id: sessionId,
                execution_id: randomUUID(),
                language,
                code,
            }),
            signal: AbortSignal.timeout(120_000),
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({})) as Record<string, unknown>;
            return `Execution error: ${typeof err.detail === 'string' ? err.detail : `HTTP ${resp.status}`}`;
        }

        const reader = resp.body?.getReader();
        if (!reader) return 'Error: No response stream';

        const decoder = new TextDecoder();
        let buffer = '';
        let stdout = '';
        let stderr = '';
        let output = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith('data: ')) continue;
                const data = trimmed.slice(6);
                if (data === '[DONE]') break;
                try {
                    const parsed = JSON.parse(data) as Record<string, unknown>;
                    if (parsed.type === 'stdout' && typeof parsed.chunk === 'string') {
                        stdout += parsed.chunk;
                    } else if (parsed.type === 'stderr' && typeof parsed.chunk === 'string') {
                        stderr += parsed.chunk;
                    } else if (parsed.type === 'completed') {
                        const exec = parsed.execution as Record<string, unknown> | undefined;
                        if (exec) {
                            if (typeof exec.stdout === 'string') stdout = exec.stdout;
                            if (typeof exec.stderr === 'string') stderr = exec.stderr;
                            if (typeof exec.output === 'string') output = exec.output;
                        }
                    }
                } catch { /* skip */ }
            }
        }

        const result = [stdout, stderr, output].filter(Boolean).join('\n');
        return result || '(no output)';
    } catch (err) {
        return `Execution error: ${err instanceof Error ? err.message : 'Code execution failed'}`;
    }
}

// ─── Route Handler ──────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }

    const limitToken = getRateLimitToken(request, userId);
    try {
        await chatLimiter.check(LIMITS.chat, limitToken);
    } catch {
        return rateLimitResponse();
    }

    try {
        const body = await request.json();
        const { task, history = [], model = 'taipei4' } = body;

        if (!task || typeof task !== 'string') {
            return NextResponse.json({ error: 'Task description is required.' }, { status: 400 });
        }
        if (task.length > 16000) {
            return NextResponse.json({ error: 'Task too long.' }, { status: 400 });
        }
        if (!Array.isArray(history) || history.length > 100) {
            return NextResponse.json({ error: 'Invalid history.' }, { status: 400 });
        }

        const sessionId = `hyperagent-${userId}-${randomUUID().slice(0, 8)}`;

        const conversationMessages: ProviderChatMessage[] = [
            { role: 'system', content: HYPERAGENT_SYSTEM_PROMPT },
            ...history.map((m: { role: string; content: string }) => ({
                role: m.role as 'user' | 'assistant',
                content: m.content,
            })),
            { role: 'user', content: task },
        ];

        const encoder = new TextEncoder();
        const readable = new ReadableStream({
            async start(controller) {
                const enqueue = (payload: Record<string, unknown>) => {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
                };

                try {
                    let fullResponse = '';

                    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
                        let roundToolCalls: ChatToolCall[] = [];

                        for await (const event of streamChatEvents({
                            messages: conversationMessages,
                            modelId: model,
                            temperature: 0.3,
                            maxTokens: 8192,
                            tools: TOOLS,
                        })) {
                            if (event.type === 'content') {
                                fullResponse += event.content;
                                enqueue({ type: 'content', content: event.content, id: randomUUID() });
                            }
                            if (event.type === 'tool_calls') {
                                roundToolCalls = event.toolCalls;
                            }
                        }

                        if (roundToolCalls.length === 0) break;

                        // Append assistant message with tool calls
                        conversationMessages.push({
                            role: 'assistant',
                            content: fullResponse,
                            tool_calls: roundToolCalls,
                        });
                        fullResponse = '';

                        // Execute each tool call for real
                        for (const toolCall of roundToolCalls) {
                            let args: Record<string, unknown>;
                            try {
                                args = JSON.parse(toolCall.function.arguments || '{}');
                            } catch {
                                conversationMessages.push({
                                    role: 'tool',
                                    tool_call_id: toolCall.id,
                                    content: JSON.stringify({ error: 'Invalid JSON arguments' }),
                                });
                                continue;
                            }

                            let result: string;
                            const toolName = toolCall.function.name;

                            enqueue({
                                type: 'content',
                                content: `\n\n> **[${toolName}]** ${toolName === 'run_terminal' ? args.command : toolName === 'web_search' ? args.query : toolName === 'web_fetch' ? args.url : `${args.language}: ${String(args.code).slice(0, 60)}...`}\n\n`,
                                id: randomUUID(),
                            });

                            switch (toolName) {
                                case 'run_terminal':
                                    result = await executeTerminal(String(args.command ?? ''), sessionId);
                                    break;
                                case 'web_search':
                                    result = await executeWebSearch(String(args.query ?? ''), Number(args.num_results) || 5);
                                    break;
                                case 'web_fetch':
                                    result = await executeWebFetch(String(args.url ?? ''));
                                    break;
                                case 'run_code': {
                                    const lang = args.language === 'python' ? 'python' : 'bash';
                                    result = await executeCode(lang, String(args.code ?? ''), sessionId);
                                    break;
                                }
                                default:
                                    result = `Unknown tool: ${toolName}`;
                            }

                            conversationMessages.push({
                                role: 'tool',
                                tool_call_id: toolCall.id,
                                content: result,
                            });
                        }
                    }

                    enqueue({ type: 'done' });
                } catch (err) {
                    enqueue({
                        type: 'error',
                        error: err instanceof Error ? err.message : 'Stream error',
                    });
                } finally {
                    controller.close();
                }
            },
        });

        return new Response(readable, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
            },
        });
    } catch (error: unknown) {
        console.error('HyperAgent error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'HyperAgent unavailable' },
            { status: 500 },
        );
    }
}
