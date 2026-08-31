// OpenAI-compatible chat completions for the developer API.
//
// This is the endpoint Tripplet Computer (the macOS agent app) talks to, and
// the one third-party clients target. It is a thin proxy: authenticate the
// developer key, resolve the persona to a backend with `resolveBackend()`, and
// pipe the upstream response straight through.
//
// Proxying rather than re-parsing is deliberate — tool calls, usage blocks and
// finish reasons all survive untouched, which is what an agent client needs.
// The only field rewritten is `model`: callers send a persona id, and the real
// upstream model name is substituted here so it never reaches a client.

import { NextRequest, NextResponse } from 'next/server';
import { authenticateDeveloperApiKey } from '@/lib/developer-api/auth';
import { getPublicApiModel } from '@/lib/developer-api/catalog';
import { resolveBackend } from '@/lib/ai/llm';
import { chatLimiter } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';
// Agent turns with tool calls run long; don't let the platform cut them short.
export const maxDuration = 300;

/** Requests per key per hour. */
const RATE_LIMIT = 600;
const MAX_BODY_BYTES = 1_000_000;
const UPSTREAM_TIMEOUT_MS = 280_000;

/**
 * Persona ids used by Tripplet Computer → the persona ids `resolveBackend()`
 * already knows. The desktop app ships its own stable ids, so this mapping is
 * what lets the two evolve independently.
 */
const DESKTOP_PERSONAS: Record<string, string> = {
    'suzhou-4': 'suzhou4',
    'majuli-4': 'majuli4',
    'taipei-4': 'taipei4',
    'astro-5.1': 'astro-5',
};

/** Fields we forward upstream. Anything else is dropped rather than relayed. */
const PASSTHROUGH = [
    'messages',
    'tools',
    'tool_choice',
    'temperature',
    'top_p',
    'max_tokens',
    'stop',
    'presence_penalty',
    'frequency_penalty',
    'seed',
    'response_format',
] as const;

function error(message: string, status: number, code?: string) {
    return NextResponse.json({ error: { message, type: 'invalid_request_error', code } }, { status });
}

export async function POST(request: NextRequest) {
    const auth = await authenticateDeveloperApiKey(request);
    if ('response' in auth) return auth.response;

    try {
        await chatLimiter.check(RATE_LIMIT, `v1chat:${auth.key.id}`);
    } catch {
        return error('Rate limit exceeded. Try again shortly.', 429, 'rate_limit_exceeded');
    }

    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
        return error('Request body is too large.', 413);
    }
    let body: Record<string, unknown> | null = null;
    try {
        body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
        return error('Invalid JSON body.', 400);
    }
    if (!body || typeof body !== 'object') return error('Invalid JSON body.', 400);

    const requestedModel = typeof body.model === 'string' ? body.model : '';
    if (!requestedModel) return error('`model` is required.', 400);

    // A desktop persona, or one of the documented public catalogue ids.
    const personaId = DESKTOP_PERSONAS[requestedModel]
        ?? (getPublicApiModel(requestedModel) ? requestedModel : null);
    if (!personaId) {
        return error(`Unsupported model "${requestedModel}".`, 400, 'model_not_found');
    }

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
        return error('`messages` must be a non-empty array.', 400);
    }

    const target = resolveBackend(personaId);
    if (!target.apiKey) {
        // Fail loud and name the cause rather than letting an empty bearer
        // token produce a confusing 401 from the provider.
        return error(
            `Inference is not configured for "${requestedModel}" on this deployment.`,
            503,
            'backend_unconfigured',
        );
    }

    const stream = body.stream !== false;
    const upstreamBody: Record<string, unknown> = { model: target.model, stream };
    for (const field of PASSTHROUGH) {
        if (body[field] !== undefined) upstreamBody[field] = body[field];
    }
    // An empty `tools: []` is rejected by some OpenAI-compatible backends.
    if (Array.isArray(upstreamBody.tools) && upstreamBody.tools.length === 0) {
        delete upstreamBody.tools;
        delete upstreamBody.tool_choice;
    }

    let upstream: Response;
    try {
        upstream = await fetch(target.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${target.apiKey}`,
            },
            body: JSON.stringify(upstreamBody),
            signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });
    } catch (err) {
        const timedOut = err instanceof Error && err.name === 'TimeoutError';
        return error(
            timedOut ? 'The model timed out.' : 'Could not reach the model backend.',
            timedOut ? 504 : 502,
        );
    }

    if (!upstream.ok || !upstream.body) {
        // Surface the status but not the provider's body — it can name the
        // upstream vendor and model, which callers must never see.
        const status = upstream.status === 429 ? 429 : upstream.status >= 500 ? 502 : 400;
        return error(
            status === 429
                ? 'Rate limited by the model backend. Try again shortly.'
                : `The model backend returned ${upstream.status}.`,
            status,
        );
    }

    if (!stream) {
        const json = (await upstream.json().catch(() => null)) as Record<string, unknown> | null;
        if (!json) return error('The model backend returned a malformed response.', 502);
        // Echo the persona id the caller asked for, not the upstream name.
        return NextResponse.json({ ...json, model: requestedModel });
    }

    return new Response(upstream.body, {
        headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
        },
    });
}
