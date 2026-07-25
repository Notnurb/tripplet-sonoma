// Tool definitions + server-side execution for the Sonoma agentic loop.
//
// run_bash is special: it executes client-side in the user's in-browser Linux
// VM, so the server implementation only acknowledges the dispatch. run_python
// runs real CPython (Pyodide) in-process — see src/lib/python/run.ts.

import { webSearch, fetchPageText } from '@/lib/ai/websearch';
import { runPython } from '@/lib/python/run';
import { sanitizeExternalContent } from '@/lib/security/sanitize';
import { wrapUntrusted } from '@/lib/security/prompt-guardrails';
import { searchPastConversations } from '@/lib/db/conversation-search';

export const SONOMA_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'web_search',
            description:
                'Search the public web for up-to-date information. Returns a list of {title,url,snippet} results.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Search query.' },
                    max_results: {
                        type: 'integer',
                        description: 'Max results (default 5, max 8).',
                    },
                },
                required: ['query'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'fetch_url',
            description:
                'Fetch the text content of a web page (cleaned to markdown). Use after web_search to read a specific source.',
            parameters: {
                type: 'object',
                properties: {
                    url: { type: 'string', description: 'Absolute http(s) URL.' },
                },
                required: ['url'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'run_python',
            description:
                'Run a short Python snippet and capture stdout. Use for math, parsing, or quick calculations. Output is treated as the result.',
            parameters: {
                type: 'object',
                properties: {
                    code: { type: 'string', description: 'Python source.' },
                },
                required: ['code'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'run_bash',
            description:
                'Run shell commands in Tripplet Sandboxed Linux — a real, isolated in-browser x86 Linux VM (busybox). Use it to demonstrate or execute Linux/bash tasks. Commands run client-side in the user\'s VM and their real stdout is shown to the user. Provide one or more shell commands.',
            parameters: {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'Shell command(s) to run, e.g. "uname -a && ls -la /".' },
                },
                required: ['command'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'run_on_machine',
            description:
                "Run a shell command on the user's own paired computer (a real machine running the OpenSonoma agent, connected via @mention in the composer). Only call this when the user has @mentioned a paired machine in their message — never guess a device_id. The user is always shown a permission prompt (Yes / Always Accept / No) before the command actually runs; if they decline, treat it as a normal cancelled command.",
            parameters: {
                type: 'object',
                properties: {
                    device_id: { type: 'string', description: "The paired machine's device_id, from the @mention context given in the system prompt." },
                    command: { type: 'string', description: 'Shell command to run on that machine.' },
                },
                required: ['device_id', 'command'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'search_past_chats',
            description:
                "Search this user's own earlier conversations with you and read back matching excerpts. Use it whenever they refer to something from a previous chat (\"what did we decide about X\", \"the project I mentioned\", \"continue where we left off\") instead of guessing or claiming you cannot remember. Leave the query empty to list their most recent conversations.",
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description:
                            'Keywords to look for. Use distinctive nouns from the topic, not a full sentence. Omit to list recent conversations.',
                    },
                    max_results: {
                        type: 'integer',
                        description: 'Max conversations to return (default 5, max 10).',
                    },
                },
                required: [],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'mermaid_diagram',
            description:
                'Render a Mermaid diagram. Return the diagram source; the frontend will display it.',
            parameters: {
                type: 'object',
                properties: {
                    title: { type: 'string' },
                    source: {
                        type: 'string',
                        description: 'Mermaid diagram source (e.g. flowchart TD; A-->B).',
                    },
                },
                required: ['source'],
            },
        },
    },
] as const;

export interface ToolCall {
    id: string;
    name: string;
    args: Record<string, unknown>;
}

export interface ToolContext {
    /** Signed-in user, when there is one. Required by user-scoped tools. */
    userId?: string | null;
    /** The conversation being written right now — excluded from history search. */
    conversationId?: string | null;
}

export async function runTool(call: ToolCall, ctx: ToolContext = {}): Promise<string> {
    switch (call.name) {
        case 'web_search': {
            const q = String(call.args.query ?? '');
            const max = Math.min(Math.max(Number(call.args.max_results ?? 5), 1), 8);
            try {
                // Titles/snippets are attacker-controlled web content — run the
                // injection sanitizer before they enter model context (same
                // defense-in-depth as the chat route's search injection).
                const results = (await webSearch(q, max)).map((r) => ({
                    ...r,
                    title: sanitizeExternalContent(r.title),
                    snippet: sanitizeExternalContent(r.snippet),
                }));
                return JSON.stringify({ results });
            } catch (e) {
                // Surface a clear instruction alongside the error. Without this
                // the model reads a bare status code (e.g. "responded 403") as
                // transient and burns the whole tool-round budget retrying the
                // same failing search. The keyless fallback is IP-blocked from
                // datacenter hosts, so retrying can't help — answer from
                // knowledge instead.
                return JSON.stringify({
                    error: e instanceof Error ? e.message : 'search failed',
                    note: 'Web search is unavailable right now. Do not retry web_search — answer from your own knowledge and tell the user that live web results could not be retrieved.',
                });
            }
        }
        case 'fetch_url': {
            const url = String(call.args.url ?? '');
            try {
                // Full page text is the largest injection surface in the tool
                // loop. Beyond the keyword sanitizer, wrap it in a nonce-keyed
                // structural boundary the page content cannot forge or escape.
                const text = wrapUntrusted(
                    sanitizeExternalContent(await fetchPageText(url)),
                    'the fetched page text',
                );
                return JSON.stringify({ url, text });
            } catch (e) {
                return JSON.stringify({ url, error: e instanceof Error ? e.message : 'fetch failed' });
            }
        }
        case 'run_python': {
            const code = String(call.args.code ?? '');
            // Real CPython via Pyodide, called in-process — no HTTP round-trip
            // to ourselves, and no LLM-simulated fallback: if execution fails,
            // the model gets an honest error instead of a plausible guess.
            try {
                const result = await runPython(code);
                return JSON.stringify({
                    output: result.output,
                    exitCode: result.exitCode,
                    ...(result.timedOut ? { timedOut: true } : {}),
                });
            } catch (e) {
                return JSON.stringify({
                    error: e instanceof Error ? e.message : 'execution failed',
                });
            }
        }
        case 'run_bash': {
            // Execution happens client-side in the user's Tripplet Sandboxed
            // Linux VM — the browser intercepts this tool call, runs the command
            // in the VM, and renders the real stdout. The server can only
            // acknowledge; it has no access to the guest.
            return JSON.stringify({
                command: String(call.args.command ?? ''),
                executed_in: 'tripplet-sandboxed-linux',
                note: 'Command dispatched to the user\'s in-browser Linux VM; its real stdout is shown to the user.',
            });
        }
        case 'run_on_machine': {
            // Execution happens client-side, after the user approves an inline
            // permission prompt (Yes / Always Accept / No). The browser then
            // calls /api/connect/exec, which runs the command on the paired
            // device over the relay and streams real stdout back into the chat.
            return JSON.stringify({
                device_id: String(call.args.device_id ?? ''),
                command: String(call.args.command ?? ''),
                note: "Dispatched to the user's paired machine pending their approval; real stdout is shown to the user once they approve.",
            });
        }
        case 'search_past_chats': {
            if (!ctx.userId) {
                return JSON.stringify({
                    error: 'not_signed_in',
                    note: 'Past chats are only available to signed-in accounts. Tell the user that history search needs them signed in, and answer from this conversation instead.',
                });
            }
            const q = String(call.args.query ?? '');
            const max = Math.min(Math.max(Number(call.args.max_results ?? 5), 1), 10);
            try {
                const matches = await searchPastConversations(ctx.userId, {
                    query: q,
                    limit: max,
                    excludeConversationId: ctx.conversationId ?? undefined,
                });
                // The user's own history is still text they may have pasted from
                // the web — sanitize before it re-enters model context, and wrap
                // it so recalled text cannot pose as an instruction.
                const conversations = matches.map((m) => ({
                    title: sanitizeExternalContent(m.title),
                    date: m.updatedAt,
                    excerpts: m.snippets.map((s) => `${s.role}: ${sanitizeExternalContent(s.text)}`),
                }));
                if (conversations.length === 0) {
                    return JSON.stringify({
                        conversations: [],
                        note: 'No earlier conversation matched. Say so plainly rather than inventing what was discussed.',
                    });
                }
                return JSON.stringify({
                    conversations,
                    recalled: wrapUntrusted(
                        JSON.stringify(conversations),
                        "excerpts recalled from the user's past chats",
                    ),
                });
            } catch (e) {
                return JSON.stringify({
                    error: e instanceof Error ? e.message : 'history search failed',
                    note: 'Chat history could not be read. Do not retry — tell the user and continue from this conversation.',
                });
            }
        }
        case 'mermaid_diagram': {
            return JSON.stringify({
                title: String(call.args.title ?? ''),
                source: String(call.args.source ?? ''),
            });
        }
        default:
            return JSON.stringify({ error: `Unknown tool: ${call.name}` });
    }
}
