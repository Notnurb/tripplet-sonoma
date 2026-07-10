// Tool definitions + server-side execution for the Sonoma agentic loop.
//
// run_bash is special: it executes client-side in the user's in-browser Linux
// VM, so the server implementation only acknowledges the dispatch. run_python
// runs real CPython (Pyodide) in-process — see src/lib/python/run.ts.

import { webSearch, fetchPageText } from '@/lib/ai/websearch';
import { runPython } from '@/lib/python/run';
import { sanitizeExternalContent } from '@/lib/security/sanitize';
import { wrapUntrusted } from '@/lib/security/prompt-guardrails';

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

export async function runTool(call: ToolCall): Promise<string> {
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
                return JSON.stringify({ error: e instanceof Error ? e.message : 'search failed' });
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
