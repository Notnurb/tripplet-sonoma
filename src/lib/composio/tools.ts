// Bridges Composio connectors into the Sonoma agentic tool loop.
//
// Per request, the Sonoma route asks for the user's toolset: the tools of
// every app the user has an ACTIVE Composio connection to, renamed with a
// `composio_` prefix so they can never collide with (or shadow) the built-in
// tools, plus an executor that routes those calls back through Composio.
//
// Everything here degrades to "no connectors": guests, un-configured deploys,
// and any Composio API failure all yield null rather than blocking chat.

import { LRUCache } from 'lru-cache';
import {
    composioEnabled,
    listConnectedAccounts,
    listToolkitTools,
    executeTool,
    type ComposioTool,
} from './client';
import { sanitizeExternalContent } from '@/lib/security/sanitize';
import { wrapUntrusted } from '@/lib/security/prompt-guardrails';
import type { ToolCall } from '@/lib/sonoma/tools';

export const COMPOSIO_TOOL_PREFIX = 'composio_';

// OpenAI-compatible backends reject function names longer than 64 chars.
const MAX_TOOL_NAME_LENGTH = 64;
const MAX_TOOLS_PER_TOOLKIT = 8;
const MAX_TOTAL_TOOLS = 32;
const MAX_DESCRIPTION_LENGTH = 1_000;
// Integration responses can be arbitrarily large JSON — cap what enters
// model context (same idea as fetch_url's page-text cap).
const MAX_RESULT_CHARS = 20_000;

// Connected-account lookups happen on every Sonoma request when Composio is
// configured; cache briefly per user. Connect/disconnect invalidates.
const connectionsCache = new LRUCache<string, string[]>({ max: 5_000, ttl: 60 * 1000 });
// Toolkit → tool defs. Catalog data, changes rarely — cache longer.
const toolkitToolsCache = new LRUCache<string, ComposioTool[]>({ max: 500, ttl: 10 * 60 * 1000 });

export function invalidateComposioConnections(userId: string): void {
    connectionsCache.delete(userId);
}

/** OpenAI-style function-tool definition (what streamOnce sends upstream). */
export interface ComposioToolDef {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}

export interface ComposioToolset {
    /** Tool definitions to append to the request's tool list. */
    defs: ComposioToolDef[];
    /** Connected app slugs (for the system prompt note). */
    apps: string[];
    /** True when `name` is one of this user's connector tools. */
    canRun(name: string): boolean;
    /** Execute a connector tool call; always resolves to a JSON string. */
    run(call: ToolCall): Promise<string>;
}

function toolDisplayApp(slug: string): string {
    const app = slug.split('_')[0] ?? slug;
    return app.charAt(0) + app.slice(1).toLowerCase();
}

function buildDef(tool: ComposioTool): ComposioToolDef | null {
    const name = `${COMPOSIO_TOOL_PREFIX}${tool.slug}`;
    // A truncated name would no longer round-trip back to the exact Composio
    // slug on execution — skip the (rare) over-long tool instead.
    if (name.length > MAX_TOOL_NAME_LENGTH || !/^[A-Za-z0-9_-]+$/.test(name)) return null;
    const description =
        `[${toolDisplayApp(tool.slug)} connector] ${tool.description}`.slice(0, MAX_DESCRIPTION_LENGTH);
    return {
        type: 'function',
        function: { name, description, parameters: tool.inputParameters },
    };
}

async function activeToolkitsFor(userId: string): Promise<string[]> {
    const cached = connectionsCache.get(userId);
    if (cached) return cached;
    const connections = await listConnectedAccounts(userId);
    const slugs = [
        ...new Set(
            connections
                .filter((c) => c.status === 'ACTIVE' && !c.isDisabled && c.toolkitSlug)
                .map((c) => c.toolkitSlug),
        ),
    ];
    connectionsCache.set(userId, slugs);
    return slugs;
}

async function toolsForToolkit(slug: string): Promise<ComposioTool[]> {
    const cached = toolkitToolsCache.get(slug);
    if (cached) return cached;
    const tools = await listToolkitTools(slug, MAX_TOOLS_PER_TOOLKIT);
    toolkitToolsCache.set(slug, tools);
    return tools;
}

/**
 * Build the connector toolset for one user, or null when there is nothing to
 * offer (guest, Composio not configured, no active connections, or any
 * upstream failure).
 */
export async function getComposioToolset(userId: string | null): Promise<ComposioToolset | null> {
    if (!userId || !composioEnabled()) return null;
    try {
        const toolkits = await activeToolkitsFor(userId);
        if (toolkits.length === 0) return null;

        const perToolkit = await Promise.all(
            toolkits.map(async (slug) => {
                try {
                    return await toolsForToolkit(slug);
                } catch {
                    return []; // one broken toolkit must not sink the rest
                }
            }),
        );

        const defs: ComposioToolDef[] = [];
        const slugByName = new Map<string, string>();
        for (const tools of perToolkit) {
            for (const tool of tools) {
                if (defs.length >= MAX_TOTAL_TOOLS) break;
                const def = buildDef(tool);
                if (!def || slugByName.has(def.function.name)) continue;
                defs.push(def);
                slugByName.set(def.function.name, tool.slug);
            }
        }
        if (defs.length === 0) return null;

        return {
            defs,
            apps: toolkits,
            canRun: (name) => slugByName.has(name),
            run: async (call) => {
                const slug = slugByName.get(call.name);
                if (!slug) {
                    return JSON.stringify({ error: `Unknown connector tool: ${call.name}` });
                }
                try {
                    const result = await executeTool(slug, userId, call.args);
                    if (!result.successful) {
                        return JSON.stringify({
                            successful: false,
                            error: sanitizeExternalContent(String(result.error ?? 'execution failed')).slice(0, 2_000),
                        });
                    }
                    let raw = JSON.stringify(result.data ?? null);
                    if (raw.length > MAX_RESULT_CHARS) {
                        raw = `${raw.slice(0, MAX_RESULT_CHARS)}… [truncated]`;
                    }
                    // Connector data is third-party content (emails, issues,
                    // messages — classic injection carriers): same sanitize +
                    // nonce-wrapped boundary as fetched web pages.
                    return JSON.stringify({
                        successful: true,
                        app: toolDisplayApp(slug),
                        data: wrapUntrusted(
                            sanitizeExternalContent(raw),
                            `the ${toolDisplayApp(slug)} integration response`,
                        ),
                    });
                } catch (e) {
                    return JSON.stringify({
                        successful: false,
                        error: e instanceof Error ? e.message.slice(0, 500) : 'execution failed',
                    });
                }
            },
        };
    } catch (e) {
        console.warn('[composio] toolset unavailable:', e instanceof Error ? e.message : e);
        return null;
    }
}
