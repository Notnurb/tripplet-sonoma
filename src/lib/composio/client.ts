// Composio (composio.dev) REST client — third-party app connectors.
//
// Composio hosts the OAuth flows and token vault for hundreds of SaaS apps
// ("toolkits": GitHub, Gmail, Notion, Slack, …) and exposes each app's
// operations as LLM-callable tools. This is a thin, dependency-free wrapper
// over their v3 REST API (https://backend.composio.dev/api/v3), authenticated
// with COMPOSIO_API_KEY. Tripplet user ids double as Composio user ids, so
// every connected account and every tool execution is scoped server-side to
// the requesting user — one user can never reach another's accounts.
//
// The integration is strictly optional: with no COMPOSIO_API_KEY configured,
// composioEnabled() is false and every caller degrades to "no connectors"
// (same policy as BACKEND_URL memory/search).

import { env } from '@/lib/env';

const COMPOSIO_API_BASE = 'https://backend.composio.dev/api/v3';
const REQUEST_TIMEOUT_MS = 15_000;
// Tool executions hit the third-party app behind Composio — give them longer.
const EXECUTE_TIMEOUT_MS = 60_000;

export function composioEnabled(): boolean {
    return Boolean(env.COMPOSIO_API_KEY);
}

export interface ComposioToolkit {
    slug: string;
    name: string;
    description: string;
    logo: string;
    categories: string[];
    noAuth: boolean;
}

export interface ComposioConnection {
    id: string;
    toolkitSlug: string;
    /** INITIALIZING | INITIATED | ACTIVE | FAILED | EXPIRED | INACTIVE | REVOKED */
    status: string;
    statusReason: string | null;
    createdAt: string;
    isDisabled: boolean;
    /** Composio-side user id — used for ownership checks, never sent to clients. */
    userId: string;
}

export interface ComposioTool {
    slug: string;
    name: string;
    description: string;
    toolkitSlug: string;
    /** JSON Schema for the tool's arguments (OpenAI function-parameters shape). */
    inputParameters: Record<string, unknown>;
}

export interface ComposioExecuteResult {
    successful: boolean;
    data: unknown;
    error: string | null;
}

async function composioFetch(
    path: string,
    init: RequestInit = {},
    timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
    const apiKey = env.COMPOSIO_API_KEY;
    if (!apiKey) throw new Error('Composio is not configured (COMPOSIO_API_KEY missing)');
    return fetch(`${COMPOSIO_API_BASE}${path}`, {
        ...init,
        headers: {
            'x-api-key': apiKey,
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
            ...(init.headers as Record<string, string> | undefined),
        },
        signal: AbortSignal.timeout(timeoutMs),
    });
}

/** Parse a Composio error response into a short, client-safe message. */
async function composioError(res: Response, fallback: string): Promise<Error> {
    let detail = '';
    try {
        const body = (await res.json()) as { error?: { message?: string } | string; message?: string };
        const raw =
            typeof body.error === 'string'
                ? body.error
                : body.error?.message || body.message || '';
        detail = String(raw).slice(0, 200);
    } catch {
        /* non-JSON body — keep the fallback */
    }
    return new Error(detail ? `${fallback}: ${detail}` : `${fallback} (${res.status})`);
}

/**
 * List available toolkits (apps), most-used first. With `search`, Composio
 * filters by name; without it this is the "popular apps" catalog.
 */
export async function listToolkits(search?: string, limit = 24): Promise<ComposioToolkit[]> {
    const params = new URLSearchParams({ limit: String(limit), sort_by: 'usage' });
    if (search) params.set('search', search);
    const res = await composioFetch(`/toolkits?${params}`);
    if (!res.ok) throw await composioError(res, 'Could not list apps');
    const body = (await res.json()) as {
        items?: Array<{
            slug?: string;
            name?: string;
            no_auth?: boolean;
            meta?: { description?: string; logo?: string; categories?: Array<{ name?: string } | string> };
        }>;
    };
    return (body.items ?? [])
        .filter((t) => t.slug && t.name)
        .map((t) => ({
            slug: String(t.slug),
            name: String(t.name),
            description: String(t.meta?.description ?? ''),
            logo: String(t.meta?.logo ?? ''),
            categories: (t.meta?.categories ?? []).map((c) =>
                typeof c === 'string' ? c : String(c?.name ?? ''),
            ).filter(Boolean),
            noAuth: Boolean(t.no_auth),
        }));
}

function mapConnection(item: {
    id?: string;
    user_id?: string;
    status?: string;
    status_reason?: string | null;
    created_at?: string;
    is_disabled?: boolean;
    toolkit?: { slug?: string };
}): ComposioConnection {
    return {
        id: String(item.id ?? ''),
        toolkitSlug: String(item.toolkit?.slug ?? ''),
        status: String(item.status ?? 'INITIALIZING'),
        statusReason: item.status_reason ?? null,
        createdAt: String(item.created_at ?? ''),
        isDisabled: Boolean(item.is_disabled),
        userId: String(item.user_id ?? ''),
    };
}

/** List the connected accounts belonging to one user. */
export async function listConnectedAccounts(userId: string): Promise<ComposioConnection[]> {
    const params = new URLSearchParams({ user_ids: userId, limit: '50' });
    const res = await composioFetch(`/connected_accounts?${params}`);
    if (!res.ok) throw await composioError(res, 'Could not list connections');
    const body = (await res.json()) as { items?: Array<Parameters<typeof mapConnection>[0]> };
    // Belt-and-braces: even though the query is user-scoped, drop anything the
    // API returns for a different user before it reaches a caller.
    return (body.items ?? []).map(mapConnection).filter((c) => c.id && c.userId === userId);
}

/** Fetch one connected account (for ownership checks). Null when missing. */
export async function getConnectedAccount(id: string): Promise<ComposioConnection | null> {
    const res = await composioFetch(`/connected_accounts/${encodeURIComponent(id)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw await composioError(res, 'Could not load connection');
    return mapConnection((await res.json()) as Parameters<typeof mapConnection>[0]);
}

/** Permanently remove a connected account. Ownership must be checked by the caller. */
export async function deleteConnectedAccount(id: string): Promise<void> {
    const res = await composioFetch(`/connected_accounts/${encodeURIComponent(id)}`, {
        method: 'DELETE',
    });
    if (!res.ok && res.status !== 404) throw await composioError(res, 'Could not remove connection');
}

/**
 * Find (or create) an auth config for a toolkit. Auth configs are org-level
 * "OAuth app" records; Composio-managed ones need zero credentials from us,
 * so first-time connects of a new app work out of the box.
 */
async function ensureAuthConfig(toolkitSlug: string): Promise<string> {
    const params = new URLSearchParams({ toolkit_slug: toolkitSlug, limit: '10' });
    const listRes = await composioFetch(`/auth_configs?${params}`);
    if (listRes.ok) {
        const body = (await listRes.json()) as {
            items?: Array<{ id?: string; status?: string; is_composio_managed?: boolean }>;
        };
        const existing =
            (body.items ?? []).find((a) => a.id && a.status !== 'DISABLED' && a.is_composio_managed) ??
            (body.items ?? []).find((a) => a.id && a.status !== 'DISABLED');
        if (existing?.id) return String(existing.id);
    }
    const createRes = await composioFetch('/auth_configs', {
        method: 'POST',
        body: JSON.stringify({
            toolkit: { slug: toolkitSlug },
            auth_config: { type: 'use_composio_managed_auth' },
        }),
    });
    if (!createRes.ok) throw await composioError(createRes, 'Could not prepare app authentication');
    const created = (await createRes.json()) as { auth_config?: { id?: string } };
    const id = created.auth_config?.id;
    if (!id) throw new Error('Composio returned no auth config id');
    return String(id);
}

export interface InitiatedConnection {
    id: string;
    /** Hosted OAuth page to send the user to. Empty for no-auth toolkits. */
    redirectUrl: string;
    status: string;
}

/**
 * Start connecting `toolkitSlug` for `userId`. Returns the hosted OAuth URL
 * the user must visit; Composio redirects back to `callbackUrl` when done.
 *
 * Uses POST /connected_accounts/link — the plain /connected_accounts create
 * endpoint returns 400 for Composio-managed OAuth configs (deprecated in
 * favor of the link-token flow).
 */
export async function initiateConnection(
    userId: string,
    toolkitSlug: string,
    callbackUrl: string,
): Promise<InitiatedConnection> {
    const authConfigId = await ensureAuthConfig(toolkitSlug);
    const res = await composioFetch('/connected_accounts/link', {
        method: 'POST',
        body: JSON.stringify({
            auth_config_id: authConfigId,
            user_id: userId,
            callback_url: callbackUrl,
        }),
    });
    if (!res.ok) throw await composioError(res, 'Could not start the connection');
    const body = (await res.json()) as {
        connected_account_id?: string;
        redirect_url?: string | null;
    };
    if (!body.connected_account_id) throw new Error('Composio returned no connection id');
    return {
        id: String(body.connected_account_id),
        redirectUrl: String(body.redirect_url ?? ''),
        status: 'INITIATED',
    };
}

/**
 * List a toolkit's tools, "important" (most-used) ones first. Falls back to
 * the default ordering for toolkits that don't flag important tools.
 */
export async function listToolkitTools(toolkitSlug: string, limit: number): Promise<ComposioTool[]> {
    const fetchTools = async (important: boolean): Promise<ComposioTool[]> => {
        const params = new URLSearchParams({ toolkit_slug: toolkitSlug, limit: String(limit) });
        if (important) params.set('important', 'true');
        const res = await composioFetch(`/tools?${params}`);
        if (!res.ok) throw await composioError(res, 'Could not list tools');
        const body = (await res.json()) as {
            items?: Array<{
                slug?: string;
                name?: string;
                description?: string;
                input_parameters?: Record<string, unknown>;
                toolkit?: { slug?: string };
            }>;
        };
        return (body.items ?? [])
            .filter((t) => t.slug)
            .map((t) => ({
                slug: String(t.slug),
                name: String(t.name ?? t.slug),
                description: String(t.description ?? ''),
                toolkitSlug: String(t.toolkit?.slug ?? toolkitSlug),
                inputParameters:
                    t.input_parameters && typeof t.input_parameters === 'object'
                        ? t.input_parameters
                        : { type: 'object', properties: {} },
            }));
    };
    const important = await fetchTools(true);
    if (important.length > 0) return important;
    return fetchTools(false);
}

/**
 * Execute one tool as `userId`. Composio resolves the user's connected
 * account for the tool's toolkit server-side — passing the user id is what
 * enforces per-user scoping.
 */
export async function executeTool(
    toolSlug: string,
    userId: string,
    args: Record<string, unknown>,
): Promise<ComposioExecuteResult> {
    const res = await composioFetch(
        `/tools/execute/${encodeURIComponent(toolSlug)}`,
        {
            method: 'POST',
            body: JSON.stringify({ user_id: userId, arguments: args }),
        },
        EXECUTE_TIMEOUT_MS,
    );
    if (!res.ok) throw await composioError(res, 'Tool execution failed');
    const body = (await res.json()) as { data?: unknown; error?: string | null; successful?: boolean };
    return {
        successful: Boolean(body.successful),
        data: body.data ?? null,
        error: body.error ?? null,
    };
}
