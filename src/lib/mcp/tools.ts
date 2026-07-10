// MCP tool definitions + executors.
//
// Each tool wraps an existing Sonoma capability so external agents (Claude,
// Codex, Cursor, …) reach the same backends the web app uses. Tools run in the
// authenticated user's context — `userEmail` comes from the validated OAuth
// access token.

import { queryOne } from '@/lib/db/neon';
import { backendFetch } from '@/lib/backend';
import { resolveBackend } from '@/lib/ai/llm';
import { MODELS } from '@/lib/ai/models';

export interface McpToolContext {
    userEmail: string;
}

export interface McpTool {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    // Returns plain text content for the MCP `content` array.
    run: (args: Record<string, unknown>, ctx: McpToolContext) => Promise<string>;
}

function str(v: unknown): string {
    return typeof v === 'string' ? v : '';
}

async function userIdForEmail(email: string): Promise<string | null> {
    const row = await queryOne<{ id: string }>(
        `SELECT id FROM "User" WHERE email = $1 LIMIT 1`,
        [email],
    );
    return row?.id ?? null;
}

const VALID_MODEL_IDS = new Set(MODELS.map((m) => m.id));
const DEFAULT_MODEL = 'astro-5';

// ── sonoma_chat ──────────────────────────────────────────────────────────────

const sonomaChat: McpTool = {
    name: 'sonoma_chat',
    description:
        'Send a prompt to a Sonoma/Tripplet model (Astro, Taipei, Majuli, or Suzhou) and get a completion. Use for general reasoning, drafting, or asking Sonoma-hosted models directly.',
    inputSchema: {
        type: 'object',
        properties: {
            prompt: { type: 'string', description: 'The user prompt to send to the model.' },
            model: {
                type: 'string',
                description: `Model id. One of: ${MODELS.map((m) => m.id).join(', ')}. Defaults to ${DEFAULT_MODEL}.`,
            },
            system: { type: 'string', description: 'Optional system instructions.' },
        },
        required: ['prompt'],
    },
    async run(args) {
        const prompt = str(args.prompt).trim();
        if (!prompt) throw new Error('`prompt` is required.');
        const modelId = VALID_MODEL_IDS.has(str(args.model)) ? str(args.model) : DEFAULT_MODEL;
        const system = str(args.system).trim();

        const backend = resolveBackend(modelId);
        if (!backend.apiKey) throw new Error('Model provider is not configured on this server.');

        const messages: Array<{ role: string; content: string }> = [];
        if (system) messages.push({ role: 'system', content: system });
        messages.push({ role: 'user', content: prompt });

        const resp = await fetch(backend.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${backend.apiKey}`,
            },
            body: JSON.stringify({
                model: backend.model,
                messages,
                max_tokens: 2048,
                temperature: 0.7,
                stream: false,
            }),
            signal: AbortSignal.timeout(60_000),
        });

        if (!resp.ok) {
            const detail = await resp.text().catch(() => '');
            throw new Error(`Model request failed (${resp.status}): ${detail.slice(0, 200)}`);
        }
        const data = (await resp.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
        };
        const content = data.choices?.[0]?.message?.content;
        if (!content) throw new Error('Model returned no content.');
        return content;
    },
};

// ── web_search ────────────────────────────────────────────────────────────────

const webSearch: McpTool = {
    name: 'web_search',
    description:
        'Search the live web via Sonoma. Returns ranked results with titles, URLs, and snippets. Use for current events or facts beyond the model’s knowledge.',
    inputSchema: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'The search query (max 500 chars).' },
            num_results: { type: 'number', description: 'How many results to return (1–20, default 8).' },
        },
        required: ['query'],
    },
    async run(args) {
        const q = str(args.query).trim();
        if (!q) throw new Error('`query` is required.');
        if (q.length > 500) throw new Error('`query` too long (max 500 characters).');
        const n = Math.min(Math.max(Number(args.num_results) || 8, 1), 20);

        const resp = await backendFetch('/search/combined', {
            method: 'POST',
            body: JSON.stringify({ query: q, num_results: n }),
            signal: AbortSignal.timeout(10_000),
        });
        if (!resp.ok) throw new Error(`Search failed (${resp.status}).`);

        const data = (await resp.json()) as {
            results?: Array<{ title?: string; url?: string; highlights?: string[]; raw_content?: string; source?: string }>;
        };
        const results = data.results ?? [];
        if (results.length === 0) return `No results found for "${q}".`;

        return results
            .map((r, i) => {
                const snippet = (r.highlights?.join(' ') || r.raw_content?.slice(0, 500) || '').trim();
                const source = r.source ? `[${r.source}] ` : '';
                return `${i + 1}. ${source}${r.title ?? 'Untitled'}\n   ${r.url ?? ''}\n   ${snippet}`;
            })
            .join('\n\n');
    },
};

// ── memory_search ──────────────────────────────────────────────────────────────

const memorySearch: McpTool = {
    name: 'memory_search',
    description:
        'Search the signed-in Sonoma user’s persistent memory (facts they have saved). Use to recall preferences, context, or things the user told Sonoma to remember.',
    inputSchema: {
        type: 'object',
        properties: {
            query: { type: 'string', description: 'What to look for in the user’s memory.' },
            limit: { type: 'number', description: 'Max memories to return (1–20, default 5).' },
        },
        required: ['query'],
    },
    async run(args, ctx) {
        const q = str(args.query).trim();
        if (!q) throw new Error('`query` is required.');
        const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 20);

        const userId = await userIdForEmail(ctx.userEmail);
        if (!userId) throw new Error('Could not resolve the authenticated user.');

        const resp = await backendFetch('/memory/search', {
            method: 'POST',
            body: JSON.stringify({ query: q, user_id: userId, limit }),
            signal: AbortSignal.timeout(8_000),
        });
        if (!resp.ok) throw new Error(`Memory search failed (${resp.status}).`);

        const data = (await resp.json()) as {
            results?: Array<{ content?: string; memory?: string; score?: number }>;
            memories?: Array<{ content?: string; memory?: string }>;
        };
        const items = data.results ?? data.memories ?? [];
        if (items.length === 0) return `No memories found for "${q}".`;

        return items
            .map((m, i) => `${i + 1}. ${m.content ?? m.memory ?? ''}`.trim())
            .join('\n');
    },
};

export const MCP_TOOLS: McpTool[] = [sonomaChat, webSearch, memorySearch];

export function listToolSpecs() {
    return MCP_TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
    }));
}

export function findTool(name: string): McpTool | undefined {
    return MCP_TOOLS.find((t) => t.name === name);
}
