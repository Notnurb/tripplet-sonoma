// Remote MCP server (Streamable HTTP transport, JSON-RPC 2.0).
//
// External AI clients (Claude, Codex, Cursor, …) connect here after completing
// the OAuth 2.1 flow. Every request carries a bearer access token, which we
// validate and map to a Sonoma user; tools then run in that user's context.
//
// Stateless: no session id is issued or required. We answer POSTed requests
// with a single JSON response (no server-initiated SSE stream).

import { NextRequest } from 'next/server';
import { baseUrlFrom, validateAccessToken } from '@/lib/mcp/oauth';
import { listToolSpecs, findTool } from '@/lib/mcp/tools';
import { CORS_HEADERS, preflight } from '@/lib/mcp/http';

export const runtime = 'nodejs';

const SERVER_INFO = { name: 'sonoma', version: '1.0.0' };
const SUPPORTED_PROTOCOLS = new Set(['2024-11-05', '2025-03-26', '2025-06-18']);
const DEFAULT_PROTOCOL = '2025-06-18';

interface JsonRpcRequest {
    jsonrpc: '2.0';
    id?: string | number | null;
    method: string;
    params?: Record<string, unknown>;
}

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS_HEADERS, ...extraHeaders },
    });
}

function rpcResult(id: JsonRpcRequest['id'], result: unknown) {
    return { jsonrpc: '2.0' as const, id: id ?? null, result };
}

function rpcError(id: JsonRpcRequest['id'], code: number, message: string) {
    return { jsonrpc: '2.0' as const, id: id ?? null, error: { code, message } };
}

function unauthorized(request: NextRequest): Response {
    const base = baseUrlFrom(request);
    return json(
        { error: 'invalid_token', error_description: 'Missing or invalid access token.' },
        401,
        {
            'WWW-Authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`,
        },
    );
}

export function OPTIONS() {
    return preflight();
}

// GET is used by Streamable HTTP for server-initiated streams. We're stateless
// and don't push, so advertise that clearly.
export function GET(request: NextRequest) {
    const auth = request.headers.get('authorization') || '';
    if (!/^Bearer\s+/i.test(auth)) return unauthorized(request);
    return json({ error: 'method_not_allowed', error_description: 'This MCP server does not support server-initiated streams.' }, 405);
}

async function handleRpc(
    msg: JsonRpcRequest,
    ctx: { userEmail: string },
): Promise<object | null> {
    const { method, id } = msg;

    // Notifications (no id) get no response body.
    const isNotification = id === undefined;

    switch (method) {
        case 'initialize': {
            const requested = (msg.params?.protocolVersion as string) || DEFAULT_PROTOCOL;
            const protocolVersion = SUPPORTED_PROTOCOLS.has(requested) ? requested : DEFAULT_PROTOCOL;
            return rpcResult(id, {
                protocolVersion,
                capabilities: { tools: { listChanged: false } },
                serverInfo: SERVER_INFO,
                instructions:
                    'Sonoma MCP server. Tools: sonoma_chat (ask a Sonoma model), web_search (live web), memory_search (the user’s saved memory).',
            });
        }

        case 'notifications/initialized':
        case 'notifications/cancelled':
            return null; // acknowledged, no response

        case 'ping':
            return rpcResult(id, {});

        case 'tools/list':
            return rpcResult(id, { tools: listToolSpecs() });

        case 'tools/call': {
            const name = msg.params?.name as string | undefined;
            const args = (msg.params?.arguments as Record<string, unknown>) || {};
            const tool = name ? findTool(name) : undefined;
            if (!tool) return rpcError(id, -32602, `Unknown tool: ${name ?? '(none)'}`);
            try {
                const text = await tool.run(args, ctx);
                return rpcResult(id, { content: [{ type: 'text', text }] });
            } catch (err) {
                // Tool errors surface as isError results (not protocol errors) so
                // the model can read and react to them.
                const message = err instanceof Error ? err.message : 'Tool execution failed.';
                return rpcResult(id, { content: [{ type: 'text', text: `Error: ${message}` }], isError: true });
            }
        }

        default:
            if (isNotification) return null;
            return rpcError(id, -32601, `Method not found: ${method}`);
    }
}

export async function POST(request: NextRequest) {
    // 1. Authenticate the bearer access token.
    const header = request.headers.get('authorization') || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) return unauthorized(request);
    const token = await validateAccessToken(match[1].trim());
    if (!token) return unauthorized(request);
    const ctx = { userEmail: token.userEmail };

    // 2. Parse the JSON-RPC message(s).
    let payload: unknown;
    try {
        payload = await request.json();
    } catch {
        return json(rpcError(null, -32700, 'Parse error'), 400);
    }

    // Batch support: an array of messages.
    if (Array.isArray(payload)) {
        const responses = (
            await Promise.all(payload.map((m) => handleRpc(m as JsonRpcRequest, ctx)))
        ).filter((r): r is object => r !== null);
        if (responses.length === 0) return new Response(null, { status: 202, headers: CORS_HEADERS });
        return json(responses);
    }

    const msg = payload as JsonRpcRequest;
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
        return json(rpcError((msg as JsonRpcRequest)?.id ?? null, -32600, 'Invalid Request'), 400);
    }

    const response = await handleRpc(msg, ctx);
    if (response === null) return new Response(null, { status: 202, headers: CORS_HEADERS });
    return json(response);
}
